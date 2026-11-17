"""File locks under <state>/local/locks/ (contract/CLI.md 0.3, MODULES.md 3).

A lock is a file created with O_CREAT|O_EXCL holding {pid, process_created, host, command, acquired_utc}. Locks are
re-entrant per process. Acquisition order is merge -> plan -> git-state -> state -> notion; acquiring a lock that
precedes one already held raises InternalError(E_LOCK_ORDER). A lock is broken only when its holder is dead (no
process with that pid AND that creation time, so a reused pid is not the holder); a live holder older than STALE_S
logs W_LOCK_OLD once and is waited for. A broken lock is queued as an `error` event that `events.append` writes
(this module sits below events and cannot append itself; `drain_broken` hands the records over). Waiting past the
timeout is LockTimeout(E_LOCK_TIMEOUT), exit 3.

Breaking is serialised and conditional, so two waiters that judged the same dead holder never both end up holding
the lock: the breaker first creates `<name>.break` with O_EXCL (the break guard, holding {pid, process_created,
token}); under the guard it re-reads the lock file, requires its bytes to equal the bytes it judged dead, re-checks
that the holder is dead, moves the file to a unique name, compares the moved bytes once more and only then deletes
it. The slower waiter therefore finds the faster one's fresh lock (other bytes) and waits for it. A guard whose own
holder died (a crash in the milliseconds a guard is held) is cleared the same way: moved aside, compared, deleted;
a file moved aside by mistake is put back without ever overwriting a file created meanwhile. Every read tolerates a
file that vanished or is pending delete on Windows (FileNotFoundError, PermissionError): the wait loop re-evaluates.
A release removes the lock file only when it still holds the exact bytes this process wrote.

Lock timestamps use the real system clock, never the --now override: staleness is real elapsed time.
"""
from __future__ import annotations

import json
import os
import socket
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Mapping

from . import procutil
from .errors import ErrorItem, InternalError, LockTimeout, warn
from .log import get_logger
from .paths import Layout

LOCK_ORDER: tuple[str, ...] = ("merge", "plan", "git-state", "state", "notion")
TIMEOUTS_S: Mapping[str, float] = {"merge": 300.0, "plan": 60.0, "git-state": 120.0, "state": 30.0,
                                   "notion": 30.0, "disk-heavy": 180.0}
STALE_S: Mapping[str, float] = {"merge": 3600.0, "plan": 600.0, "git-state": 900.0, "state": 300.0,
                                "notion": 300.0, "disk-heavy": 3600.0}
UNWRITTEN_GRACE_S = 5.0
GUARD_SUFFIX = ".break"
REMOVE_RETRY_S = 2.0
_LOG = get_logger("execlib.locks")

_held: dict[str, int] = {}
_held_paths: dict[str, Path] = {}
_held_bytes: dict[str, bytes] = {}
_broken: list[dict] = []


def is_held(name: str) -> bool:
    """True when this process holds the lock `name`."""
    return _held.get(name, 0) > 0


def drain_broken() -> list[dict]:
    """Records of dead holders' locks broken by this process since the last drain (for `error` events)."""
    out = list(_broken)
    _broken.clear()
    return out


def _utc_text() -> str:
    return f"{datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%S}Z"


def _posix(path: Path) -> str:
    return str(path).replace("\\", "/")


def _read_raw(path: Path) -> bytes | None:
    """The file's bytes; None when it is gone or pending delete (Windows PermissionError): the caller re-evaluates."""
    try:
        return path.read_bytes()
    except (FileNotFoundError, PermissionError):
        return None


def _parse(raw: bytes | None) -> dict | None:
    if raw is None or not raw.strip():
        return None
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return doc if isinstance(doc, dict) else None


def _read_holder(path: Path) -> dict | None:
    return _parse(_read_raw(path))


def _age_s(path: Path) -> float:
    try:
        return max(0.0, time.time() - path.stat().st_mtime)
    except (FileNotFoundError, PermissionError):
        return 0.0


def _holder_dead(holder: Mapping) -> bool:
    """True when the recorded holder no longer runs (no process with that pid and that creation time)."""
    pid = holder.get("pid")
    created = holder.get("process_created")
    if not isinstance(pid, int) or isinstance(pid, bool):
        return True
    return not procutil.holder_alive(pid, created if isinstance(created, int) and not isinstance(created, bool)
                                     else None)


def _breakable(path: Path, raw: bytes) -> bool:
    """The judgement a breaker makes, repeated under the guard: an unwritten (or unreadable) file past the grace, or
    a recorded holder that is dead."""
    holder = _parse(raw)
    if holder is None:
        return _age_s(path) > UNWRITTEN_GRACE_S
    return _holder_dead(holder)


def _record_bytes(**fields: object) -> bytes:
    doc = {"pid": os.getpid(), "process_created": procutil.process_created(os.getpid()), **fields}
    return json.dumps(doc, sort_keys=True).encode("utf-8") + b"\n"


def _create_exclusive(path: Path, payload: bytes) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o644)
    except FileExistsError:
        return False
    except PermissionError:
        return False  # Windows: a file pending delete by its releaser or breaker
    try:
        os.write(fd, payload)
    finally:
        os.close(fd)
    return True


def _try_create(path: Path, command: str) -> bytes | None:
    """Create the lock file; the exact bytes written on success (a release compares them), None when it exists."""
    payload = _record_bytes(host=socket.gethostname(), command=command, acquired_utc=_utc_text())
    return payload if _create_exclusive(path, payload) else None


def _move_aside_if(path: Path, expected: bytes, tag: str) -> bool:
    """Atomically move `path` to a unique name and delete it when the moved bytes are `expected`. A file moved by
    mistake (other bytes) is put back without overwriting a file created meanwhile. True when removed."""
    aside = path.with_name(f"{path.name}.{tag}-{os.getpid()}-{uuid.uuid4().hex}")
    try:
        os.rename(path, aside)
    except (FileNotFoundError, PermissionError):
        return False
    moved = _read_raw(aside)
    if moved == expected:
        _remove_quietly(aside)
        return True
    try:
        if os.name == "nt":
            os.rename(aside, path)  # fails when a file exists there: never overwrites
        else:
            os.link(aside, path)  # fails when a file exists there: never overwrites
            os.remove(aside)
    except OSError as err:
        _LOG.error("a file moved aside by mistake could not be put back", extra={"data": {
            "path": _posix(path), "aside": _posix(aside), "error": str(err)}})
    return False


def _remove_quietly(path: Path) -> None:
    deadline = time.monotonic() + REMOVE_RETRY_S
    while True:
        try:
            os.remove(path)
            return
        except FileNotFoundError:
            return
        except PermissionError as err:
            if time.monotonic() >= deadline:
                _LOG.warning("could not remove a lock side file", extra={"data": {"path": _posix(path),
                                                                                  "error": str(err)}})
                return
        time.sleep(0.02)


def _remove_own(path: Path, own: bytes | None, what: str) -> None:
    """Remove `path` when it still holds exactly `own`; a transient Windows sharing or pending-delete error is
    retried for REMOVE_RETRY_S, then logged."""
    deadline = time.monotonic() + REMOVE_RETRY_S
    while True:
        try:
            raw = path.read_bytes()
        except FileNotFoundError:
            return
        except PermissionError as err:
            last = str(err)
        else:
            if own is None or raw != own:
                _LOG.error(f"{what} no longer holds this process's record: left in place", extra={"data": {
                    "path": _posix(path), "holder": _parse(raw)}})
                return
            try:
                os.remove(path)
                return
            except FileNotFoundError:
                return
            except PermissionError as err:
                last = str(err)
        if time.monotonic() >= deadline:
            _LOG.warning(f"could not remove {what}", extra={"data": {"path": _posix(path), "error": last}})
            return
        time.sleep(0.02)


def _guard_path(path: Path) -> Path:
    return path.with_name(path.name + GUARD_SUFFIX)


def _take_guard(guard: Path) -> bytes | None:
    """The break guard's bytes when this process now holds it; None when another breaker holds it (a dead
    breaker's guard is cleared on the way, and the caller retries on its next loop)."""
    payload = _record_bytes(token=uuid.uuid4().hex, acquired_utc=_utc_text())
    if _create_exclusive(guard, payload):
        return payload
    raw = _read_raw(guard)
    if raw is not None and _breakable(guard, raw) and _move_aside_if(guard, raw, "stale"):
        _LOG.warning("cleared the break guard of a dead breaker", extra={"data": {
            "guard": _posix(guard), "holder_pid": (_parse(raw) or {}).get("pid")}})
    return None


def _break(path: Path, judged: bytes, holder: dict | None, name: str, command: str) -> bool:
    """Break the lock file at `path` only if it still holds `judged`, the bytes the caller found dead. True when this
    process broke it (and queued the `error` record); False when another breaker holds the guard, the file vanished,
    changed or came back alive: the caller re-evaluates on its next loop."""
    guard = _guard_path(path)
    token = _take_guard(guard)
    if token is None:
        return False
    try:
        current = _read_raw(path)
        if current is None or current != judged or not _breakable(path, current):
            return False
        if not _move_aside_if(path, judged, "broken"):
            return False
    finally:
        _remove_own(guard, token, "the break guard")
    record = {"lock": name, "holder": holder, "broken_by": command, "broken_pid": os.getpid(),
              "broken_utc": _utc_text()}
    _broken.append(record)
    _LOG.warning("broke the lock of a dead holder", extra={"data": {"lock": name, "holder_pid":
                                                                    (holder or {}).get("pid")}})
    return True


@contextmanager
def hold(layout: Layout, name: str, *, command: str, timeout_s: float | None = None) -> Iterator[None]:
    """Hold the lock `name` of this state directory for the duration of the block (re-entrant per process)."""
    if _held.get(name, 0) > 0:
        _held[name] += 1
        try:
            yield
        finally:
            _held[name] -= 1
        return
    if name in LOCK_ORDER:
        idx = LOCK_ORDER.index(name)
        later = sorted((h for h, n in _held.items() if n > 0 and h in LOCK_ORDER and LOCK_ORDER.index(h) > idx),
                       key=LOCK_ORDER.index)
        if later:
            raise InternalError(f"lock order violated: acquiring {name!r} while holding {', '.join(later)} "
                                f"(order {' -> '.join(LOCK_ORDER)})", code="E_LOCK_ORDER")
    path = layout.lock(name)
    limit = TIMEOUTS_S.get(name, 60.0) if timeout_s is None else float(timeout_s)
    deadline = time.monotonic() + limit
    warned_old = False
    delay = 0.02
    while True:
        mine = _try_create(path, command)
        if mine is not None:
            break
        raw = _read_raw(path)
        holder = _parse(raw)
        if raw is not None:
            if holder is None:
                if _age_s(path) > UNWRITTEN_GRACE_S and _break(path, raw, None, name, command):
                    continue
            elif _holder_dead(holder):
                if _break(path, raw, holder, name, command):
                    continue
            elif not warned_old and _age_s(path) > STALE_S.get(name, 600.0):
                warned_old = True
                item = ErrorItem("W_LOCK_OLD", f"lock {name!r} held by live pid {holder.get('pid')} "
                                               f"({holder.get('command')}) for more than "
                                               f"{int(STALE_S.get(name, 600.0))} s: waiting", path=_posix(path))
                warn(item)
                _LOG.warning(item.message, extra={"data": {"code": item.code, "lock": name}})
        if time.monotonic() >= deadline:
            who = holder.get("command") if holder else "unknown"
            raise LockTimeout(f"lock {name!r} still held by {who} after {limit:g} s", code="E_LOCK_TIMEOUT",
                              hint="a rerun, never a failed attempt")
        time.sleep(delay)
        delay = min(delay * 1.5, 0.2)
    _held[name] = 1
    _held_paths[name] = path
    _held_bytes[name] = mine
    try:
        yield
    finally:
        _held[name] = 0
        _held_paths.pop(name, None)
        _remove_own(path, _held_bytes.pop(name, None), f"lock {name!r}")
