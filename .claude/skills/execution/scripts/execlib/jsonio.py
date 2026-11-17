"""JSON and text I/O: atomic writes, canonical bytes, digests, JSON lines (contract/MODULES.md 2, SCHEMAS.md 1.2-1.4).

Writes are UTF-8 without BOM, LF only, with a final newline, through a temp file in the same directory and
`os.replace`. On Windows `os.replace` onto a file another process holds open raises PermissionError (Python opens
files without FILE_SHARE_DELETE, and the hooks read state files on every agent tool call): the replace is retried 10
times with backoff 20, 40, ... capped at 200 ms (about 1.5 s in all), then EnvError(E_ENV); the temp file is removed.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any, Callable, Iterator, TypeVar

from .errors import EnvError, ErrorItem, InternalError, ValidationFailed, warn
from .log import get_logger

BOM = b"\xef\xbb\xbf"
RETRY_DELAYS_MS: tuple[int, ...] = (20, 40, 80, 160, 200, 200, 200, 200, 200, 200)
_LOG = get_logger("execlib.jsonio")
T = TypeVar("T")


def _retry_permission(action: Callable[[], T], what: str, path: Path) -> T:
    last: PermissionError | None = None
    for attempt in range(len(RETRY_DELAYS_MS) + 1):
        try:
            return action()
        except PermissionError as err:
            last = err
            if attempt == len(RETRY_DELAYS_MS):
                break
            time.sleep(RETRY_DELAYS_MS[attempt] / 1000.0)
    raise EnvError(f"{what} {path}: held by another process after {len(RETRY_DELAYS_MS)} retries ({last})",
                   code="E_ENV", hint="a process keeps the file open; retry when it is released") from last


def _decode(raw: bytes, path: Path) -> str:
    if raw.startswith(BOM):
        item = ErrorItem("W_BOM", f"{path.as_posix()} starts with a UTF-8 BOM: stripped", path=path.as_posix())
        warn(item)
        _LOG.warning(item.message, extra={"data": {"code": item.code}})
        raw = raw[len(BOM):]
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError as err:
        raise ValidationFailed(f"{path} is not UTF-8: {err}", code="E_SCHEMA") from err


def read_json(path: Path) -> Any:
    """Parse a UTF-8 JSON file (a BOM is stripped with W_BOM). FileNotFoundError propagates unchanged."""
    p = Path(path)
    text = _decode(p.read_bytes(), p)
    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        raise ValidationFailed(f"{p} is not valid JSON: {err.msg} at line {err.lineno} column {err.colno}",
                               code="E_SCHEMA", items=[ErrorItem("E_SCHEMA", f"invalid JSON: {err.msg}",
                                                                 path=f"{p.as_posix()}:{err.lineno}")]) from err


def read_json_retry(path: Path) -> Any:
    """read_json with the bounded PermissionError retry (a reader racing an os.replace)."""
    return _retry_permission(lambda: read_json(path), "reading", Path(path))


def _write_bytes_atomic(path: Path, data: bytes) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.parent / f".{p.name}.{os.getpid()}.{time.monotonic_ns()}.tmp"
    try:
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        _retry_permission(lambda: os.replace(tmp, p), "replacing", p)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError as err:
                _LOG.warning("temp file left behind", extra={"data": {"path": str(tmp), "error": str(err)}})


def dumps_document(obj: Any, *, sort_keys: bool = True, indent: int = 2) -> str:
    return json.dumps(obj, sort_keys=sort_keys, indent=indent, ensure_ascii=False) + "\n"


def write_json_atomic(path: Path, obj: Any, *, sort_keys: bool = True, indent: int = 2) -> None:
    """Indented JSON (sorted keys by default), LF, final newline, atomically."""
    _write_bytes_atomic(Path(path), dumps_document(obj, sort_keys=sort_keys, indent=indent).encode("utf-8"))


def write_text_atomic(path: Path, text: str) -> None:
    """UTF-8 text, LF only (a carriage return is refused), final newline added when missing, atomically."""
    if "\r" in text:
        raise InternalError(f"refusing to write a carriage return to {path}: LF only")
    if text and not text.endswith("\n"):
        text += "\n"
    _write_bytes_atomic(Path(path), text.encode("utf-8"))


def canonical_bytes(obj: Any) -> bytes:
    """SCHEMAS.md 1.4: sorted keys, no spaces, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_json(obj: Any) -> str:
    return sha256_bytes(canonical_bytes(obj))


def append_jsonl(path: Path, obj: Any) -> None:
    """One os.write of canonical bytes + LF with O_APPEND, then fsync.

    Only for files with a single writer at a time (callers hold the state or notion lock): O_APPEND through the MSVC
    CRT is seek-then-write, not atomic across processes. Hooks never append (one file per event).
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = canonical_bytes(obj) + b"\n"
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_BINARY", 0)
    fd = os.open(p, flags, 0o644)
    try:
        view = memoryview(data)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def read_jsonl(path: Path) -> Iterator[tuple[int, dict | ErrorItem]]:
    """(line number, document) per non-empty line, or (line number, E_JSONL_LINE item) for a line that is not an
    object. A missing file yields nothing."""
    p = Path(path)
    if not p.exists():
        return
    raw = p.read_bytes()
    if raw.startswith(BOM):
        raw = raw[len(BOM):]
    for lineno, line in enumerate(raw.split(b"\n"), start=1):
        if not line.strip():
            continue
        try:
            doc = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as err:
            yield lineno, ErrorItem("E_JSONL_LINE", f"line {lineno} is not valid JSON: {err}",
                                    path=f"{p.as_posix()}:{lineno}")
            continue
        if not isinstance(doc, dict):
            yield lineno, ErrorItem("E_JSONL_LINE", f"line {lineno} is not a JSON object",
                                    path=f"{p.as_posix()}:{lineno}")
            continue
        yield lineno, doc


def bump_counter(path: Path, key: str, *, floor: int = 0) -> int | None:
    """Increment the integer `key` of the JSON document at `path` (at least to `floor`), write it back atomically and
    return the new value; None when the file does not exist. Callers hold the lock that protects the file (the
    events sequence of local/state.json is bumped under the state lock)."""
    p = Path(path)
    if not p.exists():
        return None
    doc = read_json_retry(p)
    if not isinstance(doc, dict):
        raise ValidationFailed(f"{p} is not a JSON object", code="E_STATE_INVALID")
    current = doc.get(key, 0)
    if isinstance(current, bool) or not isinstance(current, int):
        raise ValidationFailed(f"{p}: {key} is not an integer", code="E_STATE_INVALID")
    value = max(current, floor) + 1
    doc[key] = value
    write_json_atomic(p, doc)
    return value
