"""Subprocesses, process liveness and tool lookup (contract/MODULES.md 3).

`run` never inherits stdin, decodes output as UTF-8 with replacement and, on timeout, kills the whole process tree:
on Windows `taskkill /T /F` plus a kill-on-close Job Object (Git Bash programs started through a forked bash have a
dead Windows parent, so taskkill alone misses them; the /harden gates.py pattern), on POSIX the process group
(SIGTERM then SIGKILL). `bash` is Git Bash located explicitly, never the WSL launcher in System32 or WindowsApps.
`pid_alive` never sends a signal on Windows (os.kill terminates there).
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Mapping

from .errors import EnvError
from .log import get_logger

_LOG = get_logger("execlib.procutil")


@dataclass(frozen=True)
class RunResult:
    argv: list[str] | str
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_s: float


# --- Git Bash ------------------------------------------------------------------------------------------------------

def _is_wsl_launcher(path: str) -> bool:
    low = path.replace("\\", "/").lower()
    return "/windows/system32/" in low or "/windowsapps/" in low or low.endswith("/sysnative/bash.exe")


def git_bash() -> str | None:
    """Git for Windows' bash.exe (forward slashes), never the WSL launcher; POSIX: bash from PATH."""
    if os.name != "nt":
        found = shutil.which("bash") or ("/bin/bash" if os.path.exists("/bin/bash") else None)
        return found
    candidates: list[str] = []
    git_exe = shutil.which("git")
    if git_exe:
        gp = Path(git_exe).resolve()
        for root in (gp.parent.parent, gp.parent.parent.parent):
            candidates += [str(root / "bin" / "bash.exe"), str(root / "usr" / "bin" / "bash.exe")]
    for env_var in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
        base = os.environ.get(env_var)
        if base:
            candidates.append(str(Path(base) / "Git" / "bin" / "bash.exe"))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates.append(str(Path(local) / "Programs" / "Git" / "bin" / "bash.exe"))
    which_bash = shutil.which("bash")
    if which_bash:
        candidates.append(which_bash)
    for cand in candidates:
        if cand and os.path.isfile(cand) and not _is_wsl_launcher(cand):
            return cand.replace("\\", "/")
    return None


def which(name: str) -> Path | None:
    """PATH lookup honouring PATHEXT on Windows."""
    found = shutil.which(name)
    return Path(found) if found else None


def python_exe() -> str:
    return sys.executable


# --- Windows job object --------------------------------------------------------------------------------------------

class _WinJob:
    """A kill-on-close Job Object holding one process tree (no-op off Windows or on any API failure)."""

    def __init__(self) -> None:
        self.handle: int | None = None
        self._k32: Any = None
        if os.name != "nt":
            return
        try:
            import ctypes
            from ctypes import wintypes

            k32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
            k32.CreateJobObjectW.restype = wintypes.HANDLE
            k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
            k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
            k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            k32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
            k32.CloseHandle.argtypes = [wintypes.HANDLE]

            class _Basic(ctypes.Structure):
                _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                            ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                            ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                            ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD),
                            ("SchedulingClass", wintypes.DWORD)]

            class _Extended(ctypes.Structure):
                _fields_ = [("BasicLimitInformation", _Basic), ("IoInfo", ctypes.c_uint64 * 6),
                            ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t),
                            ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

            job = k32.CreateJobObjectW(None, None)
            if not job:
                return
            info = _Extended()
            info.BasicLimitInformation.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not k32.SetInformationJobObject(job, 9, ctypes.byref(info), ctypes.sizeof(info)):
                k32.CloseHandle(job)
                return
            self.handle, self._k32 = job, k32
        except (OSError, AttributeError, ValueError, TypeError) as err:
            _LOG.debug("job object unavailable", extra={"data": {"error": str(err)}})
            self.handle = None

    def assign(self, proc: subprocess.Popen) -> None:  # type: ignore[type-arg]
        if self.handle is None:
            return
        handle = getattr(proc, "_handle", None)
        if handle is None or not self._k32.AssignProcessToJobObject(self.handle, int(handle)):
            self.close()

    def terminate(self) -> None:
        if self.handle is not None:
            self._k32.TerminateJobObject(self.handle, 1)

    def close(self) -> None:
        if self.handle is not None:
            self._k32.CloseHandle(self.handle)
            self.handle = None


def _kill_tree(proc: subprocess.Popen, job: _WinJob) -> None:  # type: ignore[type-arg]
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        job.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        return
    for sig, wait_s in ((signal.SIGTERM, 3.0), (signal.SIGKILL, 5.0)):
        try:
            os.killpg(proc.pid, sig)
        except OSError:
            pass
        try:
            proc.wait(timeout=wait_s)
            break
        except subprocess.TimeoutExpired:
            continue
    try:
        os.killpg(proc.pid, signal.SIGKILL)  # leftover group members
    except OSError:
        pass


def run(argv: list[str] | str, *, cwd: Path, timeout_s: float, env: Mapping[str, str] | None = None,
        shell: Literal["none", "bash", "cmd"] = "none", input_text: str | None = None) -> RunResult:
    """Run a command; `env`, when given, is the complete environment of the child.

    shell none: argv is a list (argv[0] resolved through PATH/PATHEXT); bash: argv is one command string run by
    Git Bash `-c`; cmd: one string run by `cmd.exe /d /s /c`. A missing executable is EnvError(E_ENV)."""
    if shell == "none":
        if isinstance(argv, str):
            raise ValueError("shell none takes an argv list, never a command string")
        cmd: list[str] = list(argv)
        found = shutil.which(cmd[0]) if not os.path.dirname(cmd[0]) else None
        if found:
            cmd[0] = found
    elif shell == "bash":
        bash = git_bash()
        if bash is None:
            raise EnvError("Git Bash not found (never the WSL launcher)", code="E_ENV")
        text = argv if isinstance(argv, str) else subprocess.list2cmdline(argv)
        cmd = [bash, "-c", text]
    elif shell == "cmd":
        text = argv if isinstance(argv, str) else subprocess.list2cmdline(argv)
        cmd = ["cmd.exe", "/d", "/s", "/c", text]
    else:
        raise ValueError(f"unknown shell {shell!r}")
    kwargs: dict[str, Any] = {"cwd": str(cwd), "stdout": subprocess.PIPE, "stderr": subprocess.PIPE,
                              "stdin": subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
                              "env": dict(env) if env is not None else None}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    else:
        kwargs["start_new_session"] = True
    job = _WinJob()
    start = time.monotonic()
    try:
        proc = subprocess.Popen(cmd, **kwargs)
    except FileNotFoundError as err:
        job.close()
        raise EnvError(f"{cmd[0]}: executable not found", code="E_ENV") from err
    except OSError as err:
        job.close()
        raise EnvError(f"{cmd[0]}: cannot start ({err})", code="E_ENV") from err
    job.assign(proc)
    timed_out = False
    data = input_text.encode("utf-8") if input_text is not None else None
    try:
        out_b, err_b = proc.communicate(input=data, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_tree(proc, job)
        try:
            out_b, err_b = proc.communicate(timeout=10)
        except (subprocess.TimeoutExpired, ValueError, OSError):
            out_b, err_b = b"", b""
    finally:
        job.close()
    duration = time.monotonic() - start
    return RunResult(argv=argv if isinstance(argv, str) else list(argv),
                     exit_code=None if timed_out else proc.returncode,
                     stdout=(out_b or b"").decode("utf-8", errors="replace"),
                     stderr=(err_b or b"").decode("utf-8", errors="replace"),
                     timed_out=timed_out, duration_s=round(duration, 3))


def powershell(script: str, *, timeout_s: float = 30) -> RunResult:
    """powershell.exe -NoProfile -NonInteractive -Command <script>."""
    return run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], cwd=Path.cwd(),
               timeout_s=timeout_s)


# --- liveness ------------------------------------------------------------------------------------------------------

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259
_ERROR_ACCESS_DENIED = 5


def _k32() -> Any:
    import ctypes
    from ctypes import wintypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    k32.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    return k32


def pid_alive(pid: int) -> bool:
    """True when a process with this pid exists. Never sends a signal on Windows."""
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        k32 = _k32()
        handle = k32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return ctypes.get_last_error() == _ERROR_ACCESS_DENIED
        try:
            code = wintypes.DWORD()
            if not k32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == _STILL_ACTIVE
        finally:
            k32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def process_created(pid: int) -> int | None:
    """The process creation time (Windows FILETIME ticks; POSIX start time); None when the process is gone."""
    if pid <= 0:
        return None
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        k32 = _k32()
        handle = k32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return None
        try:
            code = wintypes.DWORD()
            if k32.GetExitCodeProcess(handle, ctypes.byref(code)) and code.value != _STILL_ACTIVE:
                return None
            times = [wintypes.FILETIME() for _ in range(4)]
            if not k32.GetProcessTimes(handle, *[ctypes.byref(t) for t in times]):
                return None
            created = times[0]
            return (int(created.dwHighDateTime) << 32) | int(created.dwLowDateTime)
        finally:
            k32.CloseHandle(handle)
    stat_path = Path(f"/proc/{pid}/stat")
    if stat_path.exists():
        try:
            text = stat_path.read_text(encoding="utf-8", errors="replace")
            fields = text.rsplit(")", 1)[1].split()
            return int(fields[19])
        except (OSError, IndexError, ValueError):
            return None
    if not pid_alive(pid):
        return None
    try:
        out = subprocess.run(["ps", "-o", "lstart=", "-p", str(pid)], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = out.stdout.decode("utf-8", errors="replace").strip()
    if not text:
        return None
    try:
        return int(time.mktime(time.strptime(text, "%a %b %d %H:%M:%S %Y")))
    except ValueError:
        import hashlib

        return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16)


def holder_alive(pid: int, created: int | None) -> bool:
    """The pid is alive AND has the recorded creation time (a reused pid is not the holder)."""
    if not pid_alive(pid):
        return False
    if created is None:
        return True
    return process_created(pid) == created
