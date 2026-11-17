"""Shared machinery of the /execution hooks (contract/HOOKS.md 2-3, 10; MODULES.md 6).

Standard library only and no import of any other execlib module: the hook scripts run as `python -S` on every
matching tool call of every agent, so this module must start in well under 100 ms. It locates the run marker
(`.execution/local/active`), classifies the caller (orchestrator, binding pending, agent of this run, foreign agent,
other session), reads the few local files a hook may read (with a short PermissionError retry), writes hook events
as one file each (O_CREAT|O_EXCL, never an append to a shared file), and fails open: any exception becomes one JSON
log line and exit 0 with nothing on stdout. Bytes in, ASCII out: stdin is read as UTF-8 bytes and stdout carries
`json.dumps(..., ensure_ascii=True)` encoded as ASCII, so no console code page is ever involved.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# No `dataclasses`, `typing` or `traceback` at import time: `dataclasses` pulls `inspect` (about 20 ms with `python -S`
# on this machine), `typing` about 3 ms, and the p95 budget per hook call is 250 ms including Git Bash (HOOKS.md
# 10.1). Annotations stay strings (`from __future__ import annotations`); the typing names they use are imported for
# type checkers only, behind a local TYPE_CHECKING constant (mypy and pyright treat the name as typing's constant, and
# it costs no import). `traceback` is imported only when failing open.
TYPE_CHECKING = False
if TYPE_CHECKING:
    from typing import Any, Callable, NoReturn

SCRIPTS_DIR: Path = Path(__file__).resolve().parents[1]
SKILL_DIR: Path = SCRIPTS_DIR.parent
STATE_DIRNAME = ".execution"
MARKER_REL = (STATE_DIRNAME, "local", "active")
WALK_LIMIT = 12
READ_RETRIES = 3
RETRY_SLEEP_S = 0.02
TRACE_MAX = 4000
IS_WINDOWS = os.name == "nt"

HOOK_NAMES = ("stop-gate", "session-start", "session-end", "stop-failure", "pre-tool-guard", "user-prompt")

# The command words of CLI.md section 9 and the orchestrator-only ones (SCHEMAS.md 5.3); test_pre_tool_guard checks
# these against execlib.cli.COMMANDS so the two lists can never drift apart.
COMMAND_WORDS: tuple[str, ...] = (
    "init", "preflight", "ingest", "hooks install", "hooks canary", "hooks uninstall", "agents install",
    "agents status", "agents probe", "agents probe-check", "heartbeat plan", "heartbeat record", "sync",
    "plan instantiate", "plan emit", "validate", "catalogue", "schedule", "simulate", "due", "amend", "status",
    "governor", "quota", "manual post", "answers ingest", "decision propose", "decision resolve", "task set-status",
    "wave emit", "wave launched", "wave ingest", "result put", "merge", "snapshot", "fe-workspace", "proof run",
    "proof verdict", "completion generate", "completion run", "harden-ready", "notion diff", "notion ack",
    "notion poll-plan", "report", "handover", "fix", "events replay", "resume", "fixture new")
ORCHESTRATOR_ONLY: frozenset[str] = frozenset(w for w in COMMAND_WORDS if w not in (
    "validate", "simulate", "result put", "merge", "snapshot", "fe-workspace", "proof run", "proof verdict",
    "completion run"))

_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$")

# log.redact's shapes, repeated here because a hook may not import execlib.log (stdlib-only start-up budget).
_MNEMONIC_WORD = r"[a-z]{3,8}"
def _build_redactions() -> tuple[tuple[re.Pattern[str], str], ...]:
    """Compiled on first use only (a deny or a failed-open line): compiling them costs import time on every call."""
    return (
    (re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:.*?-----END [A-Z0-9 ]*PRIVATE KEY-----|.*\Z)", re.S),
     "[redacted:pem]"),
    (re.compile(r"(?<![0-9A-Za-z])0x[0-9a-fA-F]{64}(?![0-9A-Za-z])"), "[redacted:hex-key]"),
    (re.compile(r"(?i)((?:private|secret|signing)[ _-]?key[\"']?\s*[:=]\s*[\"']?)[0-9a-f]{64}\b"),
     r"\1[redacted:hex-key]"),
    (re.compile(r"(?i)((?:mnemonic|seed phrase|seed|recovery phrase|secret phrase)[\"']?\s*[:=]?\s*[\"']?)("
                + _MNEMONIC_WORD + r"(?: " + _MNEMONIC_WORD + r"){11,23})"), r"\1[redacted:mnemonic]"),
    (re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 [redacted:bearer]"),
    (re.compile(r"\bsk-ant-[A-Za-z0-9_-]{16,}"), "[redacted:anthropic-key]"),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), "[redacted:api-key]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"), "[redacted:github-token]"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), "[redacted:github-token]"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), "[redacted:slack-token]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[redacted:aws-key]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "[redacted:google-key]"),
    (re.compile(r"\b(?:ntn_[A-Za-z0-9]{20,}|secret_[A-Za-z0-9]{30,})\b"), "[redacted:notion-token]"),
    (re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"), "[redacted:gitlab-token]"),
    (re.compile(r"\bnpm_[A-Za-z0-9]{36}\b"), "[redacted:npm-token]"),
    (re.compile(r"(?i)\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)"
                r"[\"']?\s*[:=]\s*[\"']?)(?!\[redacted)[^\s\"',;]{8,}"), r"\1[redacted:assignment]"),
)

_STATE: dict[str, Any] = {"env": None, "started": time.perf_counter()}


def redact(text: str) -> str:
    """Mask private-key, bearer, token and assignment shapes (the execlib.log.redact family)."""
    if not text:
        return text
    if "redactions" not in _STATE:
        _STATE["redactions"] = _build_redactions()
    out = text
    for rx, repl in _STATE["redactions"]:
        out = rx.sub(repl, out)
    return out


# --- time ------------------------------------------------------------------------------------------------------------

def parse_utc(text: str) -> datetime:
    m = _ISO_RE.match(str(text or ""))
    if not m:
        raise ValueError(f"not a UTC instant: {text!r}")
    y, mo, d, h, mi, s, frac = m.groups()
    micro = int((frac or "0").ljust(6, "0"))
    return datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), micro, tzinfo=timezone.utc)


def parse_utc_or_none(text: Any) -> datetime | None:
    try:
        return parse_utc(str(text)) if text else None
    except ValueError:
        return None


def utcnow() -> datetime:
    """datetime.now(utc); EXEC_NOW is honoured only when EXEC_TEST=1 is also set (tests)."""
    if os.environ.get("EXEC_TEST") == "1" and os.environ.get("EXEC_NOW"):
        try:
            return parse_utc(os.environ["EXEC_NOW"])
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def fmt_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt_precise(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def elapsed_ms() -> float:
    return round((time.perf_counter() - _STATE["started"]) * 1000.0, 1)


# --- paths -----------------------------------------------------------------------------------------------------------

def posix(p: Path | str) -> str:
    return str(p).replace("\\", "/")


def skill_posix() -> str:
    return posix(SKILL_DIR)


def exec_cmd() -> str:
    """This machine's absolute exec.py command (paths.exec_cmd, repeated: hooks import no execlib module)."""
    py = "python" if IS_WINDOWS else "python3"
    return f'{py} "{skill_posix()}/scripts/exec.py"'


def norm(path: str | Path) -> str:
    """Comparison key of a path: forward slashes, no trailing slash, case-folded on Windows (no disk access)."""
    text = posix(os.path.normpath(str(path)))
    if len(text) > 1 and text.endswith("/") and not re.match(r"^[A-Za-z]:/$", text):
        text = text.rstrip("/")
    return text.lower() if IS_WINDOWS else text


def under(path: str | Path, root: str | Path) -> bool:
    """path equals root or lies inside it (whole segments, case-insensitive on Windows)."""
    p, r = norm(path), norm(root)
    if not r:
        return False
    return p == r or p.startswith(r.rstrip("/") + "/")


def rel_to(path: str | Path, root: str | Path) -> str | None:
    if not under(path, root):
        return None
    p = posix(os.path.normpath(str(path)))
    r = posix(os.path.normpath(str(root))).rstrip("/")
    return p[len(r):].lstrip("/")


def _gitdir_main_repo(directory: Path) -> Path | None:
    """A `.git` FILE `gitdir: <main>/.git/worktrees/<name>` names the main repository of a linked worktree."""
    dot_git = directory / ".git"
    try:
        if not dot_git.is_file():
            return None
        text = dot_git.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    m = re.match(r"^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$", text)
    if not m:
        return None
    main = Path(m.group(1))
    if not main.is_absolute():
        main = (directory / main).resolve()
    return main


def _walk_for_marker(start: Path) -> Path | None:
    seen: set[str] = set()
    queue: list[Path] = [start]
    while queue:
        cur = queue.pop(0)
        for _ in range(WALK_LIMIT + 1):
            key = norm(cur)
            if key in seen:
                break
            seen.add(key)
            marker = cur.joinpath(*MARKER_REL)
            if marker.is_file():
                return marker
            main = _gitdir_main_repo(cur)
            if main is not None:
                queue.append(main)
            if cur.parent == cur:
                break
            cur = cur.parent
    return None


class HookEnv:
    """The located run: state dir, repo, marker document and `local/` (MODULES.md 6, a dataclass in spirit)."""

    __slots__ = ("state_dir", "repo", "marker", "layout_local")

    def __init__(self, state_dir: Path, repo: Path, marker: dict, layout_local: Path) -> None:
        self.state_dir = state_dir
        self.repo = repo
        self.marker = marker
        self.layout_local = layout_local

    def __repr__(self) -> str:
        return f"HookEnv(state_dir={self.state_dir!r}, repo={self.repo!r})"

    @property
    def marker_path(self) -> Path:
        return self.layout_local / "active"


def _start_dirs(payload: dict) -> list[Path]:
    out: list[Path] = []
    tool_input = payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {}
    for key in ("file_path", "notebook_path", "path"):
        val = tool_input.get(key)
        if isinstance(val, str) and val.strip():
            p = Path(to_native(val))
            if not p.is_absolute() and isinstance(payload.get("cwd"), str):
                p = Path(payload["cwd"]) / p
            out.append(p if p.is_dir() else p.parent)
    cwd = payload.get("cwd")
    if isinstance(cwd, str) and cwd.strip():
        out.append(Path(to_native(cwd)))
    return out


def locate(payload: dict) -> HookEnv | None:
    """HOOKS.md 2.1: the tool target's directory, then cwd (walking up, crossing worktree roots), then
    CLAUDE_PROJECT_DIR. The state dir and repo come from the marker itself. Raises on a corrupt marker."""
    marker_path: Path | None = None
    for start in _start_dirs(payload):
        marker_path = _walk_for_marker(start)
        if marker_path is not None:
            break
    if marker_path is None:
        proj = os.environ.get("CLAUDE_PROJECT_DIR")
        if proj:
            cand = Path(to_native(proj)).joinpath(*MARKER_REL)
            if cand.is_file():
                marker_path = cand
    if marker_path is None:
        return None
    # remember the state dir for fail_open's log before parsing (a corrupt marker is logged there)
    _STATE["log_dir"] = marker_path.parent
    marker = read_json_quiet(marker_path)
    if not isinstance(marker, dict):
        raise ValueError(f"marker {posix(marker_path)} is not a JSON object")
    for key in ("state_dir", "repo"):
        if not isinstance(marker.get(key), str) or not marker.get(key):
            raise ValueError(f"marker {posix(marker_path)} lacks {key}")
    state_dir = Path(to_native(marker["state_dir"]))
    env = HookEnv(state_dir=state_dir, repo=Path(to_native(marker["repo"])), marker=marker,
                  layout_local=state_dir / "local")
    _STATE["env"] = env
    _STATE["log_dir"] = env.layout_local
    return env


def to_native(text: str) -> str:
    """Git Bash `/c/x` -> `C:/x` on Windows; `~` expanded; otherwise unchanged."""
    t = os.path.expanduser(text.strip())
    if IS_WINDOWS:
        m = re.match(r"^/([a-zA-Z])(/.*)?$", t)
        if m:
            t = m.group(1).upper() + ":" + (m.group(2) or "/")
    return t


# --- who is calling (HOOKS.md 2.2) -----------------------------------------------------------------------------------

def is_agent(payload: dict) -> bool:
    return bool(payload.get("agent_id"))


def is_orchestrator(env: HookEnv, payload: dict) -> bool:
    sid = env.marker.get("session_id")
    return not is_agent(payload) and sid is not None and sid == payload.get("session_id")


def binding_pending(env: HookEnv, payload: dict) -> bool:
    return not is_agent(payload) and env.marker.get("session_id") is None


def other_session(env: HookEnv, payload: dict) -> bool:
    sid = env.marker.get("session_id")
    return not is_agent(payload) and sid is not None and sid != payload.get("session_id")


def local_state(env: HookEnv) -> dict:
    doc = _STATE.get("local_state")
    if doc is None:
        doc = read_json_quiet(env.layout_local / "state.json") or {}
        _STATE["local_state"] = doc
    return doc if isinstance(doc, dict) else {}


def agent_in_run(env: HookEnv, payload: dict) -> bool:
    """An agent call this run guards: its session id is the bound one or a previous one; or the run's probe has not
    shown workflow agents to be session-scoped (local state hooks.agent_session_scoped false), in which case every
    agent in the repository is guarded unless <repo>/.harden/active exists."""
    if not is_agent(payload):
        return False
    sid = payload.get("session_id")
    ids = {env.marker.get("session_id")} | set(env.marker.get("previous_session_ids") or [])
    if sid is not None and sid in ids:
        return True
    scoped = (local_state(env).get("hooks") or {}).get("agent_session_scoped") is True
    if scoped:
        return False
    return not (env.repo / ".harden" / "active").exists()


# --- I/O ------------------------------------------------------------------------------------------------------------

def read_payload() -> dict:
    raw = sys.stdin.buffer.read()
    if not raw.strip():
        return {}
    doc = json.loads(raw.decode("utf-8"))
    if not isinstance(doc, dict):
        raise ValueError("the hook payload is not a JSON object")
    return doc


def read_json_quiet(path: Path) -> Any:
    """None for a missing file; raises for a corrupt one; PermissionError retried 3 x 20 ms."""
    p = Path(path)
    for attempt in range(READ_RETRIES + 1):
        try:
            raw = p.read_bytes()
        except FileNotFoundError:
            return None
        except PermissionError:
            if attempt == READ_RETRIES:
                raise
            time.sleep(RETRY_SLEEP_S)
            continue
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        return json.loads(raw.decode("utf-8"))
    return None


def read_text_quiet(path: Path) -> str | None:
    p = Path(path)
    for attempt in range(READ_RETRIES + 1):
        try:
            return p.read_bytes().decode("utf-8", errors="replace")
        except FileNotFoundError:
            return None
        except PermissionError:
            if attempt == READ_RETRIES:
                raise
            time.sleep(RETRY_SLEEP_S)
    return None


def write_json_atomic(path: Path, obj: dict) -> None:
    """Temp file + os.replace, 3 retries 20 ms apart on PermissionError, then the error propagates (fail open)."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    tmp = p.parent / f".{p.name}.{os.getpid()}.{time.monotonic_ns()}.tmp"
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
        for attempt in range(READ_RETRIES + 1):
            try:
                os.replace(tmp, p)
                break
            except PermissionError:
                if attempt == READ_RETRIES:
                    raise
                time.sleep(RETRY_SLEEP_S)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def update_marker(env: HookEnv, fields: dict) -> dict:
    """Read-modify-write of only `fields` in local/active (re-read just before writing)."""
    current = read_json_quiet(env.marker_path)
    if not isinstance(current, dict):
        raise ValueError("the marker disappeared or is corrupt")
    current.update(fields)
    write_json_atomic(env.marker_path, current)
    return current


def hooks_state_default() -> dict:
    return {"schema": "execution.hooks-state/1", "consecutive_continuations": 0, "last_continuation_utc": None,
            "last_digest_sha256": None, "stuck": None, "last_stop_utc": None}


def read_hooks_state(env: HookEnv) -> dict:
    doc = read_json_quiet(env.layout_local / "hooks-state.json")
    if doc is None:
        return hooks_state_default()
    if not isinstance(doc, dict):
        raise ValueError("local/hooks-state.json is not an object")
    base = hooks_state_default()
    base.update({k: v for k, v in doc.items() if k in base})
    if "last_effort" in doc and last_effort_allowed():
        base["last_effort"] = doc["last_effort"]  # kept through every rewrite (contract revision 4)
    return base


def write_hooks_state(env: HookEnv, doc: dict) -> None:
    doc = dict(doc)
    doc["consecutive_continuations"] = max(0, min(8, int(doc.get("consecutive_continuations") or 0)))
    write_json_atomic(env.layout_local / "hooks-state.json", doc)


# --- the orchestrator's effort (contract revision 4: preflight PF-30 reads it) ---------------------------------------

EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")
LOCAL_STATE_SCHEMA = SKILL_DIR / "assets" / "schemas" / "local-state.schema.json"


def last_effort_allowed() -> bool:
    """Whether the installed local-state schema lets hooks-state carry `last_effort`. Revision 4 has the hooks
    record it, but `$defs/hooks_state` stays closed (additionalProperties false) until lane B01 lists the key
    (contract question Q-B08-18), and `exec.py status` validates the file against that schema: the key is never
    written before the schema allows it. Read once per process; an unreadable schema counts as "not allowed"."""
    cached = _STATE.get("last_effort_allowed")
    if cached is None:
        try:
            props = read_json_quiet(LOCAL_STATE_SCHEMA)["$defs"]["hooks_state"]["properties"]
            cached = isinstance(props, dict) and "last_effort" in props
        except (OSError, ValueError, KeyError, TypeError):
            cached = False
        _STATE["last_effort_allowed"] = cached
    return bool(cached)


def note_effort(hs: dict, payload: dict) -> bool:
    """Put the orchestrator payload's `effort` into the hooks-state `hs` as `last_effort`; True when `hs` changed.
    A payload without the field changes nothing; a value outside EFFORT_LEVELS removes the key (absent means
    unknown). Nothing at all while the schema does not list the key (last_effort_allowed)."""
    if "effort" not in payload or not last_effort_allowed():
        return False
    raw = payload.get("effort")
    value = raw.strip().lower() if isinstance(raw, str) else None
    if value in EFFORT_LEVELS:
        if hs.get("last_effort") == value:
            return False
        hs["last_effort"] = value
        return True
    if "last_effort" in hs:
        del hs["last_effort"]
        return True
    return False


def record_effort(env: HookEnv, payload: dict) -> None:
    """note_effort with its own read and write of hooks-state (SessionStart, UserPromptSubmit; the Stop gate calls
    note_effort on the state it writes anyway)."""
    if "effort" not in payload or not last_effort_allowed():
        return
    hs = read_hooks_state(env)
    if note_effort(hs, payload):
        write_hooks_state(env, hs)


def append_event(env: HookEnv, hook: str, type_: str, payload: dict, data: dict) -> Path:
    """One file per event: local/hook-events/<utc compact with microseconds>-<pid>-<n>.json, O_CREAT|O_EXCL (a
    collision retries with n+1). Never an append to a shared file."""
    now = utcnow()
    directory = env.layout_local / "hook-events"
    directory.mkdir(parents=True, exist_ok=True)
    doc: dict[str, Any] = {"ts": fmt_precise(now), "hook": hook, "session_id": str(payload.get("session_id") or ""),
                           "agent_type": payload.get("agent_type") if isinstance(payload.get("agent_type"), str)
                           else None, "type": type_, "data": data}
    body = (json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
    stamp = now.strftime("%Y%m%dT%H%M%S.%fZ")
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0)
    for n in range(1000):
        path = directory / f"{stamp}-{os.getpid()}-{n}.json"
        try:
            fd = os.open(path, flags, 0o644)
        except FileExistsError:
            continue
        except PermissionError:
            time.sleep(RETRY_SLEEP_S)
            continue
        try:
            os.write(fd, body)
        finally:
            os.close(fd)
        return path
    raise OSError("could not create a hook event file after 1000 names")


# --- output ----------------------------------------------------------------------------------------------------------

def emit(obj: dict) -> None:
    sys.stdout.buffer.write(json.dumps(obj, ensure_ascii=True).encode("ascii") + b"\n")
    sys.stdout.buffer.flush()


def emit_context(event: str, text: str) -> None:
    emit({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}})


def emit_deny(reason: str) -> None:
    emit({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                 "permissionDecisionReason": reason}})


# --- failing open (HOOKS.md 2.3) -------------------------------------------------------------------------------------

def _log_line(hook: str, exc: BaseException) -> str:
    import traceback  # only when failing open (import cost, see the module header)

    trace = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    trace = redact(trace)[-TRACE_MAX:]
    now = datetime.now(timezone.utc)
    return json.dumps({"ts": now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z",
                       "level": "error", "module": f"hook.{hook}", "msg": "internal error, failed open",
                       "exc": redact(f"{type(exc).__name__}: {exc}")[:500], "trace": trace},
                      ensure_ascii=True)


def log_error(hook: str, exc: BaseException) -> None:
    line = _log_line(hook, exc)
    log_dir = _STATE.get("log_dir")
    target = (Path(log_dir) / "hook-errors.log") if log_dir else None
    if target is None:
        cfg = os.environ.get("CLAUDE_CONFIG_DIR")
        base = Path(cfg) if cfg else Path.home() / ".claude"
        target = base / "hooks" / "execution-hooks.log"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "ab") as fh:
            fh.write(line.encode("ascii") + b"\n")
    except OSError:
        pass  # best effort: the stderr copy below still carries the line
    try:
        sys.stderr.buffer.write(line.encode("ascii") + b"\n")
        sys.stderr.buffer.flush()
    except (OSError, ValueError):
        pass


def fail_open(main: Callable[[], None], hook: str) -> NoReturn:
    """Run main; any exception -> one JSON line in <state>/local/hook-errors.log (else the user-level hooks log)
    and on stderr, then exit 0 with nothing on stdout."""
    try:
        main()
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - a hook bug must never block a tool call (HOOKS.md 2.3)
        log_error(hook, exc)
    raise SystemExit(0)


def days_old(text: Any, now: datetime) -> float | None:
    dt = parse_utc_or_none(text)
    if dt is None:
        return None
    return (now - dt) / timedelta(days=1)
