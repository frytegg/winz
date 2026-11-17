"""`exec.py governor`: resource readings, the launch decision and the sweep (contract/CLI.md 3, ARCHITECTURE.md 8.1,
MODULES.md 4).

One PowerShell call returns the readings as JSON (free disk on the repo's and the scratch root's drives, free RAM,
free commit charge, AC power, network availability), never Git Bash `du`. The decision: lanes = min(profile max,
floor((disk - floor) / lane footprint)), 1 when the free commit charge is under 4 GB; a pause when disk or RAM is under
its floor, on battery, without network, or while `<repo>/.harden/active` exists. The sweep lists (and with
`--apply-sweep` removes) orphan processes whose command line names this project's scratch or worktree paths and whose
parent is dead, per-task scratch of done tasks, and merged worktrees, link-safely. Nothing outside the project's
scratch root and the repo's worktrees is ever a candidate.
"""
from __future__ import annotations

import json
import math
import os
import re
import shutil
from argparse import Namespace
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

from . import clock, jsonio, paths, procutil, state
from . import events as events_mod
from .errors import EnvError, ErrorItem, GitError, UsageError
from .gitutil import Git
from .log import get_logger
from .model import CommandResult, Ctx

_LOG = get_logger("execlib.governor")
COMMIT_LOW_GB = 4.0
TASK_DIR_RE = re.compile(r"^(T[0-9]{3,})(?![0-9])")

# The state lock through state's own import of locks (MODULES.md 8 lists governor -> procutil, state, events,
# gitutil; contract question Q-B08-5).
hold_lock = state.locks.hold


@dataclass(frozen=True)
class Readings:
    disk_free_gb: float | None
    scratch_disk_free_gb: float | None
    ram_free_gb: float | None
    commit_free_gb: float | None
    ac_power: bool | None
    network: bool | None
    harden_active: bool


def _ps_quote(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def readings_script(repo: Path | None, scratch_root: str | None) -> str:
    repo_txt = _ps_quote(str(repo) if repo else str(Path.cwd()))
    scratch_txt = _ps_quote(scratch_root or (str(repo) if repo else str(Path.cwd())))
    return (
        "$ErrorActionPreference='Stop';"
        "function FreeGb($p){ $root=[System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($p));"
        " $d=New-Object System.IO.DriveInfo($root); [math]::Round($d.AvailableFreeSpace/1GB,3) };"
        "$os=Get-CimInstance Win32_OperatingSystem;"
        "$bat=@(Get-CimInstance Win32_Battery);"
        "$ac=$null; if($bat.Count -eq 0){$ac=$true}else{"
        " $ac=[bool](@($bat | Where-Object { @(2,3,6,7,8,9,11) -contains [int]$_.BatteryStatus }).Count) };"
        "$net=[System.Net.NetworkInformation.NetworkInterface]::GetIsNetworkAvailable();"
        f"$o=[ordered]@{{disk_free_gb=(FreeGb {repo_txt}); scratch_disk_free_gb=(FreeGb {scratch_txt});"
        " ram_free_gb=[math]::Round($os.FreePhysicalMemory/1MB,3);"
        " commit_free_gb=[math]::Round($os.FreeVirtualMemory/1MB,3); ac_power=$ac; network=$net;"
        " battery_count=$bat.Count};"
        "$o | ConvertTo-Json -Compress"
    )


def _powershell_json(script: str) -> dict:
    """Run the readings script; EnvError(E_ENV) when PowerShell fails or prints anything but a JSON object."""
    res = procutil.powershell(script, timeout_s=45)
    if res.timed_out or res.exit_code != 0:
        raise EnvError(f"the governor's PowerShell reading failed (exit {res.exit_code}): "
                       f"{(res.stderr or res.stdout).strip()[-300:]}", code="E_ENV")
    try:
        doc = json.loads(res.stdout.strip())
    except json.JSONDecodeError as err:
        raise EnvError(f"the governor's PowerShell reading is not JSON: {res.stdout.strip()[:200]!r}",
                       code="E_ENV") from err
    if not isinstance(doc, dict):
        raise EnvError("the governor's PowerShell reading is not a JSON object", code="E_ENV")
    return doc


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if math.isnan(value) or value < 0:
        return None
    return float(value)


def _bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def readings_from(doc: dict, harden_active: bool) -> Readings:
    return Readings(disk_free_gb=_num(doc.get("disk_free_gb")), scratch_disk_free_gb=_num(doc.get("scratch_disk_free_gb")),
                    ram_free_gb=_num(doc.get("ram_free_gb")), commit_free_gb=_num(doc.get("commit_free_gb")),
                    ac_power=_bool(doc.get("ac_power")), network=_bool(doc.get("network")),
                    harden_active=harden_active)


def _posix_readings(repo: Path | None, scratch_root: str | None) -> dict:
    """Readings on a POSIX machine (no PowerShell): disk through shutil, RAM from /proc/meminfo."""
    def free(p: str | None) -> float | None:
        try:
            return round(shutil.disk_usage(p or ".").free / 1024 ** 3, 3)
        except OSError:
            return None
    ram = None
    try:
        with open("/proc/meminfo", encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("MemAvailable:"):
                    ram = round(int(line.split()[1]) / 1024 ** 2, 3)
    except OSError:
        ram = None
    return {"disk_free_gb": free(str(repo) if repo else None), "scratch_disk_free_gb": free(scratch_root),
            "ram_free_gb": ram, "commit_free_gb": None, "ac_power": None, "network": None}


def read(profile: dict, repo: Path | None, *, runner: Callable[[str], dict] | None = None) -> Readings:
    """One PowerShell call returning JSON (Windows); the harden marker is a file check."""
    machine = profile.get("machine") if isinstance(profile.get("machine"), dict) else {}
    scratch_root = machine.get("scratch_root")
    if scratch_root and not Path(scratch_root).exists():
        scratch_root = str(Path(scratch_root).anchor or scratch_root)
    harden_active = bool(repo is not None and (Path(repo) / ".harden" / "active").exists())
    if runner is None and os.name != "nt":
        return readings_from(_posix_readings(repo, scratch_root), harden_active)
    doc = (runner or _powershell_json)(readings_script(repo, scratch_root))
    return readings_from(doc, harden_active)


def decide_launch(r: Readings, profile: dict, for_what: str, *, repo: Path | None = None) -> dict:
    """CLI.md governor rules: {pause, lanes, verifiers, browser_slots, workspace_mode, reasons}."""
    m = profile["machine"]
    disk_floor = float(m["disk_floor_gb"])
    ram_floor = float(m["ram_floor_gb"])
    footprint = float(m["lane_footprint_gb"])
    reasons: list[str] = []
    pause = False
    disk = r.disk_free_gb if r.disk_free_gb is not None else 0.0
    ram = r.ram_free_gb if r.ram_free_gb is not None else 0.0
    if r.disk_free_gb is None or disk < disk_floor:
        pause = True
        reasons.append(f"free disk {disk:.2f} GB is under the floor of {disk_floor:g} GB")
    if r.scratch_disk_free_gb is not None and r.scratch_disk_free_gb < disk_floor:
        pause = True
        reasons.append(f"free disk on the scratch drive {r.scratch_disk_free_gb:.2f} GB is under the floor of "
                       f"{disk_floor:g} GB")
    if r.ram_free_gb is None or ram < ram_floor:
        pause = True
        reasons.append(f"free RAM {ram:.2f} GB is under the floor of {ram_floor:g} GB")
    if r.ac_power is not True:
        pause = True
        reasons.append("on battery" if r.ac_power is False else "AC power unknown")
    if r.network is not True:
        pause = True
        reasons.append("no network" if r.network is False else "network unknown")
    if r.harden_active:
        pause = True
        reasons.append(".harden/active exists (a /harden run owns the repository)")
    max_lanes = int(m["max_lanes"])
    if footprint <= 0:
        lanes = max_lanes
    else:
        lanes = min(max_lanes, max(0, math.floor((disk - disk_floor) / footprint)))
    if r.commit_free_gb is not None and r.commit_free_gb < COMMIT_LOW_GB and lanes > 1:
        lanes = 1
        reasons.append(f"free commit charge {r.commit_free_gb:.2f} GB is under {COMMIT_LOW_GB:g} GB: one lane")
    if lanes < 1 and not pause:
        pause = True
        reasons.append(f"free disk {disk:.2f} GB leaves no room for a lane of {footprint:g} GB above the floor")
    verifiers = min(int(m["max_verifiers"]), max(1, lanes))
    browser_slots = int(m["browser_slots"])
    if r.ram_free_gb is not None and r.ram_free_gb < 2 * ram_floor and browser_slots > 1:
        browser_slots = 1
        reasons.append("RAM is low: one browser-heavy task at a time")
    pnpm = repo is not None and (Path(repo) / "pnpm-lock.yaml").exists()
    room = disk >= disk_floor + 3 * footprint
    wanted = m.get("workspace_mode", "auto")
    if wanted == "single-tree":
        mode = "single-tree"
    elif pnpm and room:
        mode = "worktrees"
    else:
        mode = "single-tree"
        if wanted == "worktrees":
            reasons.append("worktrees need a pnpm project and free disk of floor + 3 x footprint: single-tree")
    if pause:
        lanes, verifiers, browser_slots = 0, 0, 0
    return {"pause": pause, "lanes": lanes, "verifiers": verifiers, "browser_slots": browser_slots,
            "workspace_mode": mode, "reasons": reasons, "for": for_what}


# --- sweep -----------------------------------------------------------------------------------------------------------

def _project_roots(layout: paths.Layout, profile: dict) -> list[str]:
    """The only places a sweep may touch: <scratch_root>/<project> and <repo>/.claude/worktrees."""
    roots: list[str] = []
    machine = profile.get("machine") if isinstance(profile.get("machine"), dict) else {}
    proj = profile.get("project") if isinstance(profile.get("project"), dict) else {}
    if machine.get("scratch_root") and proj.get("slug"):
        roots.append(paths.posix(Path(machine["scratch_root"]) / str(proj["slug"])))
    if layout.repo is not None:
        roots.append(paths.posix(layout.repo / ".claude" / "worktrees"))
    return roots


def _key(p: str) -> str:
    text = p.replace("\\", "/").rstrip("/")
    return text.lower() if os.name == "nt" else text


def _inside(path: str, roots: Sequence[str]) -> bool:
    k = _key(path)
    return any(k == _key(r) or k.startswith(_key(r) + "/") for r in roots)


# A root counts in a command line only as a whole path: not glued to a preceding path character, and followed by a
# separator, a quote, whitespace or the end. After `_key`, a backslash separator is already "/". So
# `<scratch>/<slug>-v2/...` and `<repo>/.claude/worktrees-archive/...` never match `<scratch>/<slug>` or
# `<repo>/.claude/worktrees` (TESTS.md 3.10: nothing outside the project's scratch or worktrees).
_ROOT_BEFORE = r"(?<![A-Za-z0-9_.\-/~])"
_ROOT_AFTER = r"(?=[/\"'\s]|$)"


def _cmd_names_root(cmd: str, roots: Sequence[str]) -> bool:
    """True when the command line names one of the roots as a whole path segment (case-insensitive on Windows)."""
    norm = _key(cmd)
    for r in roots:
        key = _key(r)
        if key and re.search(_ROOT_BEFORE + re.escape(key) + _ROOT_AFTER, norm):
            return True
    return False


def _process_list() -> list[dict]:
    if os.name != "nt":
        return []
    res = procutil.powershell("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine "
                              "| ConvertTo-Json -Compress", timeout_s=60)
    if res.exit_code != 0 or res.timed_out:
        raise EnvError("the process list could not be read", code="E_ENV")
    doc = json.loads(res.stdout.strip() or "[]")
    items = doc if isinstance(doc, list) else [doc]
    return [{"pid": int(i.get("ProcessId") or 0), "ppid": int(i.get("ParentProcessId") or 0),
             "cmd": str(i.get("CommandLine") or "")} for i in items if isinstance(i, dict)]


def _done_tasks(layout: paths.Layout) -> set[str]:
    done: set[str] = set()
    for executor in ("A", "B"):
        p = layout.status(executor)
        if not p.exists():
            continue
        doc = jsonio.read_json_retry(p)
        for tid, entry in (doc.get("tasks") or {}).items():
            if isinstance(entry, dict) and entry.get("status") == "done":
                done.add(tid)
    return done


def _merged_worktrees(layout: paths.Layout, roots: Sequence[str]) -> list[str]:
    if layout.repo is None:
        return []
    git = Git(layout.repo)
    try:
        out = git.run("worktree", "list", "--porcelain").stdout
    except GitError:
        return []
    found: list[str] = []
    cur: dict[str, str] = {}
    for line in out.split("\n") + [""]:
        if not line.strip():
            if cur.get("worktree") and cur.get("HEAD") and _inside(cur["worktree"], roots):
                head = cur["HEAD"]
                try:
                    if git.is_ancestor(head, "origin/main"):
                        found.append(paths.posix(Path(cur["worktree"])))
                except GitError:
                    pass
            cur = {}
            continue
        key, _sp, val = line.partition(" ")
        cur[key] = val.strip()
    return sorted(found)


def sweep_candidates(layout: paths.Layout, profile: dict, *, processes: list[dict] | None = None,
                     worktrees: list[str] | None = None) -> dict:
    roots = _project_roots(layout, profile)
    procs = _process_list() if processes is None else processes
    alive = {p["pid"] for p in procs}
    own = os.getpid()
    orphans: list[dict] = []
    for p in procs:
        cmd = str(p.get("cmd") or "")
        if p["pid"] in (own, 0) or not cmd:
            continue
        if not _cmd_names_root(cmd, roots):
            continue
        if p.get("ppid") in alive:
            continue
        orphans.append({"pid": p["pid"], "cmd": cmd[:200]})
    scratch: list[str] = []
    done = _done_tasks(layout)
    scratch_roots = [r for r in roots if not r.endswith("/.claude/worktrees")]
    for root in scratch_roots:
        base = Path(root)
        if base.is_dir():
            for child in sorted(base.iterdir()):
                m = TASK_DIR_RE.match(child.name)
                if child.is_dir() and m and m.group(1) in done:
                    scratch.append(paths.posix(child))
    wts = _merged_worktrees(layout, roots) if worktrees is None else [w for w in worktrees if _inside(w, roots)]
    return {"orphans": sorted(orphans, key=lambda o: o["pid"]), "scratch": scratch, "worktrees": sorted(wts),
            "applied": False, "roots": roots}


def _kill_tree(pid: int) -> bool:
    """taskkill /T /F on Windows, SIGTERM elsewhere; True when the kill was accepted."""
    if os.name == "nt":
        res = procutil.run(["taskkill", "/PID", str(pid), "/T", "/F"], cwd=Path.cwd(), timeout_s=30)
        return res.exit_code == 0
    import signal
    try:
        os.kill(pid, signal.SIGTERM)
        return True
    except OSError:
        return False


def _orphan_still_ours(orphan: dict, live: dict[int, dict], roots: Sequence[str]) -> bool:
    """Re-check a listed orphan against the live process table just before the kill: the pid still runs, its full
    command line still names a root as a whole path, it starts with the listed command (no pid reuse), and its parent
    is still dead."""
    pid = int(orphan.get("pid") or 0)
    proc = live.get(pid)
    if pid in (0, os.getpid()) or proc is None:
        return False
    cmd = str(proc.get("cmd") or "")
    if not cmd or not _cmd_names_root(cmd, roots):
        return False
    if cmd[:200] != str(orphan.get("cmd") or ""):
        return False
    return proc.get("ppid") not in live


def apply_sweep(sweep: dict, *, repo: Path | None = None, processes: list[dict] | None = None) -> dict:
    """Kill the orphans (taskkill /T /F on Windows), delete the scratch dirs and remove the worktrees link-safely;
    every orphan and every path is re-checked against the sweep's roots first (an orphan against the live process
    table, read again here unless `processes` is given)."""
    roots = sweep.get("roots") or []
    done: dict[str, list] = {"killed": [], "scratch_removed": [], "worktrees_removed": [], "refused": []}
    orphans = sweep.get("orphans", [])
    live: dict[int, dict] = {}
    if orphans:
        live = {int(p["pid"]): p for p in (_process_list() if processes is None else processes)}
    for orphan in orphans:
        pid = int(orphan["pid"])
        if not roots or not _orphan_still_ours(orphan, live, roots):
            _LOG.warning("sweep: orphan %s refused at the re-check (gone, re-parented, or not this project's)", pid)
            done["refused"].append(pid)
            continue
        (done["killed"] if _kill_tree(pid) else done["refused"]).append(pid)
    for path in sweep.get("scratch", []):
        if not _inside(path, roots):
            done["refused"].append(path)
            continue
        paths.rmtree_link_safe(Path(path))
        done["scratch_removed"].append(path)
    for path in sweep.get("worktrees", []):
        if not _inside(path, roots) or repo is None:
            done["refused"].append(path)
            continue
        Git(repo).worktree_remove_link_safe(Path(path))
        done["worktrees_removed"].append(path)
    return done


def _profile(ctx: Ctx) -> dict:
    if not ctx.layout.profile.exists():
        raise UsageError("no profile.json: the governor reads profile.machine", hint="run exec.py ingest first")
    doc = jsonio.read_json_retry(ctx.layout.profile)
    if not isinstance(doc, dict) or not isinstance(doc.get("machine"), dict):
        raise UsageError("profile.json has no machine block")
    return doc


def cmd_governor(ctx: Ctx, args: Namespace) -> CommandResult:
    profile = _profile(ctx)
    for_what = getattr(args, "for_", None) or "wave"
    r = read(profile, ctx.layout.repo)
    if r.disk_free_gb is None or r.ram_free_gb is None:
        raise EnvError("a governor reading failed (disk or RAM unreadable): launching is treated as paused",
                       code="E_ENV")
    decision = decide_launch(r, profile, for_what, repo=ctx.layout.repo)
    sweep = sweep_candidates(ctx.layout, profile)
    applied: dict | None = None
    if getattr(args, "apply_sweep", False):
        applied = apply_sweep(sweep, repo=ctx.layout.repo)
        sweep["applied"] = True
    readings = asdict(r)
    stored_decision = {k: decision[k] for k in ("pause", "lanes", "verifiers", "browser_slots", "workspace_mode",
                                                "reasons")}
    with hold_lock(ctx.layout, "state", command=ctx.command):
        st = state.load(ctx.layout)
        st["governor"] = {"at_utc": clock.format_utc(ctx.now), **readings, "decision": stored_decision}
        state.save(ctx, st)
        events_mod.append(ctx, "governor", {"for": for_what, "pause": decision["pause"], "lanes": decision["lanes"],
                                            "reasons": decision["reasons"], "sweep_applied": sweep["applied"]})
    data = {"readings": readings, "decision": stored_decision, "sweep": {k: sweep[k] for k in
                                                                         ("orphans", "scratch", "worktrees", "applied")}}
    if applied is not None:
        data["sweep"]["result"] = applied
    if decision["pause"]:
        return CommandResult(data=data, exit_code=1, errors=[
            ErrorItem("E_CHECK", "launching paused: " + "; ".join(decision["reasons"]))])
    return CommandResult(data=data)
