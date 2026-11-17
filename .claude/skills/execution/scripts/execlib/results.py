"""Agent results, merge receipts and merge intents (contract/MODULES.md 4 `results.py`, CLI.md `result put`).

`result put` validates an agent's result against its role's schema and moves it from the inbox into
`local/results/<wave>/` (immutable: identical bytes are a no-op, different bytes E_RESULT_IMMUTABLE, exit 4).
Merge receipts are looked up by task and attempt in ANY wave's results, never by the current wave's path only;
`finalize_merge_intents` turns an intent whose head is now on origin/main into a landed receipt (a crash after the
push). `recover_from_journal` reads results an agent returned through its schema but never put.
"""
from __future__ import annotations

import json
import os
import re
from argparse import Namespace
from pathlib import Path
from typing import Any, Iterable, Mapping

from . import clock, events, jsonio, locks, schema
from .errors import ErrorItem, GitError, ImmutableFile, UsageError, ValidationFailed
from .gitutil import Git
from .model import CommandResult, Ctx, Task
from .paths import Layout, posix

ROLE_SCHEMAS: Mapping[str, str] = {
    "planner": "result-planner",
    "test-designer": "result-test-designer",
    "implementer": "result-implementer",
    "verifier": "result-verifier",
    "reviewer": "result-reviewer",
    "convergence": "result-reviewer",
    "merge": "merge-receipt",
}
_WAVE_RE = re.compile(r"^W[0-9]{2,3}$")
_TASK_RE = re.compile(r"^T[0-9]{3,}$")
_RESULT_SCHEMA_RE = re.compile(r"^execution\.result\.(planner|test-designer|implementer|verifier|reviewer)/1$")


def _wave_num(name: str) -> int:
    try:
        return int(name[1:])
    except ValueError:
        return -1


def _read(path: Path) -> Any | None:
    try:
        return jsonio.read_json_retry(path)
    except (FileNotFoundError, ValidationFailed):
        return None


def _write_bytes_immutable(path: Path, data: bytes, what: str) -> bool:
    """Write `data` at `path` unless it exists: identical bytes are a no-op (False), other bytes E_RESULT_IMMUTABLE.
    The bytes are normalised first (no BOM, LF only, final newline: README.md 3.3), so a re-put of the same file
    compares equal."""
    data = normalize_bytes(data)
    if path.exists():
        if path.read_bytes() == data:
            return False
        raise ImmutableFile(f"{what} {posix(path)} already exists with other content", code="E_RESULT_IMMUTABLE",
                            hint="results are immutable; a rerun writes attempt or rerun keyed files")
    jsonio.write_text_atomic(path, data.decode("utf-8"))
    return True


def normalize_bytes(data: bytes) -> bytes:
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    data = data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    if data and not data.endswith(b"\n"):
        data += b"\n"
    return data


def _check_role_doc(doc: Any, role: str, where: str) -> None:
    name = ROLE_SCHEMAS.get(role)
    if name is None:
        raise UsageError(f"unknown role {role!r}", hint="roles: " + ", ".join(sorted(ROLE_SCHEMAS)))
    report = schema.validate(doc, name)
    if not report.ok:
        items = [ErrorItem("E_SCHEMA", i.message, path=i.instance_path or "/") for i in report.issues[:30]]
        raise ValidationFailed(f"{where} fails {name}.schema.json: {report.issues[0].message}", code="E_SCHEMA",
                               items=items, hint="fix the listed fields and run result put again")


def put(ctx: Ctx, *, wave: str | None, task: str | None, role: str, attempt: int, file: Path) -> Path:
    """Validate `file` against its role's schema and move it to local/results/<wave>/ (state lock held by the
    caller). A schema failure leaves the file where it is."""
    if not locks.is_held("state"):
        raise UsageError("results.put requires the state lock")
    wave = wave or "W00"
    if not _WAVE_RE.match(wave):
        raise UsageError(f"--wave {wave!r} is not a wave id")
    if task is not None and not _TASK_RE.match(task):
        raise UsageError(f"--task {task!r} is not a task id")
    if attempt < 1:
        raise UsageError("--attempt starts at 1")
    src = Path(file)
    if not src.is_file():
        raise UsageError(f"--file {posix(src)} does not exist")
    data = src.read_bytes()
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as err:
        raise ValidationFailed(f"{posix(src)} is not JSON: {err}", code="E_SCHEMA",
                               items=[ErrorItem("E_SCHEMA", f"not JSON: {err}", path="/")]) from err
    _check_role_doc(doc, role, posix(src))
    if isinstance(doc, dict):
        mismatch = []
        if task is not None and doc.get("task") not in (None, task):
            mismatch.append(f"task {doc.get('task')} != --task {task}")
        if doc.get("wave") not in (None, wave):
            mismatch.append(f"wave {doc.get('wave')} != --wave {wave}")
        if doc.get("attempt") not in (None, attempt):
            mismatch.append(f"attempt {doc.get('attempt')} != --attempt {attempt}")
        if mismatch:
            raise ValidationFailed(f"{posix(src)}: " + "; ".join(mismatch), code="E_SCHEMA",
                                   items=[ErrorItem("E_SCHEMA", m, path="/") for m in mismatch])
    target = ctx.layout.result(wave, task, role, attempt)
    wrote = _write_bytes_immutable(target, data, "result")
    inbox = ctx.layout.inbox(wave).resolve()
    try:
        inside_inbox = src.resolve().is_relative_to(inbox)
    except (OSError, ValueError):
        inside_inbox = False
    if inside_inbox and src.resolve() != target.resolve():
        os.remove(src)
    if wrote:
        events.append(ctx, "result.recorded", {"wave": wave, "task": task, "role": role, "attempt": attempt,
                                               "path": ctx.layout.rel(target),
                                               "sha256": jsonio.sha256_bytes(target.read_bytes())})
    return target


def load(layout: Layout, wave: str, task: str | None, role: str, attempt: int) -> dict | None:
    doc = _read(layout.result(wave, task, role, attempt))
    return doc if isinstance(doc, dict) else None


def find_any_wave(layout: Layout, task: str, role: str, attempt: int) -> tuple[str, dict] | None:
    """(wave, result) of this task's role and attempt in ANY wave, newest wave first."""
    root = layout.local / "results"
    if not root.is_dir():
        return None
    for wave_dir in sorted((d for d in root.iterdir() if d.is_dir()), key=lambda d: -_wave_num(d.name)):
        doc = _read(wave_dir / f"{task}.{role}.a{attempt}.json")
        if isinstance(doc, dict):
            return wave_dir.name, doc
    return None


def landed_receipt(layout: Layout, task: str, attempt: int | None = None) -> dict | None:
    """The latest `outcome: landed` merge receipt of the task (and attempt) in any wave."""
    root = layout.local / "results"
    if not root.is_dir():
        return None
    best: tuple[tuple[int, int, str], dict] | None = None
    for path in sorted(root.glob(f"*/{task}.merge.a*.json")):
        doc = _read(path)
        if not isinstance(doc, dict) or doc.get("task") != task or doc.get("outcome") != "landed":
            continue
        if not doc.get("landed_sha") or not schema.validate(doc, "merge-receipt").ok:
            continue
        if attempt is not None and doc.get("attempt") != attempt:
            continue
        key = (int(doc["attempt"]), int(doc.get("rerun", 0)), str(doc.get("finished_utc")))
        if best is None or key > best[0]:
            best = (key, doc)
    return best[1] if best else None


def _receipt_doc(task: str, attempt: int, rerun: int, wave: str, lane: str | None, mode: str, branch: str,
                 origin_sha: str, head_before: str, landed_sha: str, push_attempts: int, now: str,
                 notes: str) -> dict:
    return {
        "schema": "execution.merge-receipt/1", "task": task, "attempt": attempt, "rerun": rerun, "wave": wave,
        "lane": lane, "mode": mode, "branch": branch, "origin_before": origin_sha, "head_before": head_before,
        "landed_sha": landed_sha, "outcome": "landed", "push_attempts": push_attempts,
        "gates": {"label": None, "result_path": None, "exit_code": None, "flaky": []},
        "task_proof": {"run": None, "exit_code": None}, "scans": [], "conflict_files": [],
        "worktree_removed": False, "started_utc": now, "finished_utc": now, "notes": notes,
    }


def write_gate_receipt(ctx: Ctx, task: Task, wave: str, attempt: int, origin_sha: str) -> Path:
    """The merge receipt of a gate task at emit (SCHEMAS.md 4.2): mode gate, landed at origin/main."""
    if not locks.is_held("state"):
        raise UsageError("results.write_gate_receipt requires the state lock")
    now = clock.format_utc(ctx.now)
    doc = _receipt_doc(task.id, attempt, 0, wave, task.lane, "gate", "main", origin_sha, origin_sha, origin_sha, 0,
                       now, "gate task: no product change; the verifier runs the gate's proof on this SHA")
    report = schema.validate(doc, "merge-receipt")
    if not report.ok:
        raise ValidationFailed(f"gate receipt invalid: {report.issues[0].message}", code="E_SCHEMA")
    path = ctx.layout.result(wave, task.id, "merge", attempt)
    data = (jsonio.dumps_document(doc)).encode("utf-8")
    if _write_bytes_immutable(path, data, "gate merge receipt"):
        events.append(ctx, "merge.landed", {"task": task.id, "attempt": attempt, "wave": wave, "mode": "gate",
                                            "landed_sha": origin_sha})
    return path


_INTENT_RE = re.compile(r"^(T[0-9]{3,})\.a([0-9]+)r([0-9]+)\.json$")


def _intent_wave(layout: Layout, task: str, attempt: int, intent: Mapping[str, Any]) -> str | None:
    wave = intent.get("wave")
    if isinstance(wave, str) and _WAVE_RE.match(wave):
        return wave
    found = find_any_wave(layout, task, "implementer", attempt)
    if found:
        return found[0]
    inbox_root = layout.local / "inbox"
    if inbox_root.is_dir():
        for wdir in sorted((d for d in inbox_root.iterdir() if d.is_dir()), key=lambda d: -_wave_num(d.name)):
            if any(p.name.startswith(f"{task}.") for p in wdir.iterdir()):
                return wdir.name
    return None


def finalize_merge_intents(ctx: Ctx, git: Git) -> list[str]:
    """Intents (local/merge-pending/<task>.a<n>r<k>.json) whose head_sha is an ancestor of origin/main become landed
    receipts; the intent is deleted once the receipt is written. Returns the finalised `<task>.a<n>r<k>` keys.
    An intent whose head is not on origin/main is left for merge (or resume R6) to report."""
    if not locks.is_held("state"):
        raise UsageError("results.finalize_merge_intents requires the state lock")
    folder = ctx.layout.merge_pending_dir
    done: list[str] = []
    if not folder.is_dir():
        return done
    for path in sorted(folder.glob("*.json")):
        m = _INTENT_RE.match(path.name)
        intent = _read(path)
        if not m or not isinstance(intent, dict):
            ctx.log.warning("unreadable merge intent left in place", extra={"data": {"path": posix(path)}})
            continue
        task, attempt, rerun = m.group(1), int(m.group(2)), int(m.group(3))
        head = str(intent.get("head_sha", ""))
        if not re.match(r"^[0-9a-f]{40}$", head):
            ctx.log.warning("merge intent without a head_sha", extra={"data": {"path": posix(path)}})
            continue
        try:
            on_main = git.is_ancestor(head, "origin/main")
        except GitError as err:
            ctx.log.warning("merge intent not checked", extra={"data": {"path": posix(path), "error": err.message}})
            continue
        if not on_main:
            continue
        existing = landed_receipt(ctx.layout, task, attempt)
        if existing is None:
            wave = _intent_wave(ctx.layout, task, attempt, intent)
            if wave is None:
                ctx.log.warning("merge intent on origin/main but its wave is unknown; left in place",
                                extra={"data": {"path": posix(path)}})
                continue
            origin_before = str(intent.get("origin_before") or head)
            started = str(intent.get("started_utc") or clock.format_utc(ctx.now))
            doc = _receipt_doc(task, attempt, rerun, wave, intent.get("lane"), str(intent.get("mode") or
                               "single-tree"), str(intent.get("branch") or "main"), origin_before, origin_before,
                               head, 1, clock.format_utc(ctx.now),
                               f"finalised from the merge intent by exec.py {ctx.command}: the push had landed")
            doc["started_utc"] = started if re.match(r"^[0-9-]{10}T[0-9:]{8}Z$", started) else doc["started_utc"]
            report = schema.validate(doc, "merge-receipt")
            if not report.ok:
                ctx.log.warning("finalised receipt would be invalid; intent left",
                                extra={"data": {"path": posix(path), "issue": report.issues[0].message}})
                continue
            target = ctx.layout.result(wave, task, "merge", attempt)
            if target.exists():
                target = target.with_name(f"{task}.merge.a{attempt}r{rerun}.json")
            _write_bytes_immutable(target, jsonio.dumps_document(doc).encode("utf-8"), "merge receipt")
            events.append(ctx, "merge.landed", {"task": task, "attempt": attempt, "wave": wave,
                                                "landed_sha": head, "from_intent": True})
        os.remove(path)
        done.append(f"{task}.a{attempt}r{rerun}")
    return done


def _walk_results(obj: Any) -> Iterable[dict]:
    if isinstance(obj, dict):
        if isinstance(obj.get("schema"), str) and _RESULT_SCHEMA_RE.match(obj["schema"]):
            yield obj
            return
        for value in obj.values():
            yield from _walk_results(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from _walk_results(value)
    elif isinstance(obj, str) and obj.lstrip().startswith("{") and "execution.result." in obj:
        try:
            yield from _walk_results(json.loads(obj))
        except json.JSONDecodeError:
            return


def recover_from_journal(journal: Path) -> list[tuple[str, str, int, dict]]:
    """(task, role, attempt, result) for every agent result found in a workflow journal (one JSON value per line;
    a result is any object, possibly nested or JSON-encoded in a string, whose `schema` is a result schema).
    Planner results have task ''. Duplicates (same task, role, attempt and content) are returned once."""
    out: list[tuple[str, str, int, dict]] = []
    seen: set[str] = set()
    for _n, doc in jsonio.read_jsonl(Path(journal)):
        if isinstance(doc, ErrorItem):
            continue
        for res in _walk_results(doc):
            role = str(res.get("role", ""))
            task = str(res.get("task") or "")
            attempt = res.get("attempt")
            attempt = int(attempt) if isinstance(attempt, int) and not isinstance(attempt, bool) else 1
            key = jsonio.sha256_json([task, role, attempt, res])
            if key in seen:
                continue
            seen.add(key)
            out.append((task, role, attempt, res))
    return out


def cmd_put(ctx: Ctx, args: Namespace) -> CommandResult:
    """`result put --wave W --task T --role R --attempt N --file PATH`."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    with locks.hold(ctx.layout, "state", command=ctx.command):
        target = put(ctx, wave=args.wave, task=args.task, role=args.role, attempt=int(args.attempt),
                     file=Path(args.file))
    return CommandResult(data={"path": ctx.layout.rel(target), "sha256": jsonio.sha256_bytes(target.read_bytes())})
