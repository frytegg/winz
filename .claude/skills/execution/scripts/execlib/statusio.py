"""Status files status/<executor>.json: read side and raw write (contract/MODULES.md 4, SCHEMAS.md 4).

Transitions and their evidence live in `status` (B04); this module only loads (defaults when absent, schema
checked: E_STATUS_INVALID), answers a task's state (planned when absent) and saves the caller's own executor file
under the state lock with `seq + 1`.
"""
from __future__ import annotations

from typing import Mapping

from . import clock, jsonio, locks, schema
from .errors import ErrorItem, InternalError, PolicyRefused, ValidationFailed
from .model import Ctx, PlanModel, TaskState
from .paths import Layout

EPOCH_UTC = "1970-01-01T00:00:00Z"
EXECUTORS: tuple[str, ...] = ("A", "B")


def default_doc(executor: str, plan_version: int = 1) -> dict:
    return {"schema": "execution.status/1", "executor": executor, "plan_version": plan_version,
            "updated_utc": EPOCH_UTC, "seq": 0, "tasks": {}}


def _check(doc: object, what: str) -> None:
    report = schema.validate(doc, "status")
    if not report.ok:
        items = [ErrorItem("E_STATUS_INVALID", i.message, path=i.instance_path or "/") for i in report.issues[:20]]
        raise ValidationFailed(f"{what} is invalid: {report.issues[0].message}", code="E_STATUS_INVALID",
                               items=items)


def load(layout: Layout, executor: str) -> dict:
    """status/<executor>.json, or the default empty document when absent."""
    path = layout.status(executor)
    if not path.exists():
        return default_doc(executor)
    doc = jsonio.read_json_retry(path)
    _check(doc, f"status/{executor}.json")
    if doc.get("executor") != executor:
        raise ValidationFailed(f"status/{executor}.json names executor {doc.get('executor')!r}",
                               code="E_STATUS_INVALID")
    return doc


def load_all(layout: Layout) -> dict[str, dict]:
    return {ex: load(layout, ex) for ex in EXECUTORS}


def state_of(task_id: str, statuses: Mapping[str, dict], plan: PlanModel) -> TaskState:
    """The task's state from its plan executor's file; `planned` when absent."""
    task = plan.by_id.get(task_id)
    order = [task.executor] if task is not None else list(EXECUTORS)
    for ex in order:
        doc = statuses.get(ex) or {}
        entry = (doc.get("tasks") or {}).get(task_id)
        if entry is not None:
            return TaskState(status=entry["status"], since=clock.parse_utc(entry["since_utc"]),
                             attempts=int(entry.get("attempts", 0)), reruns=int(entry.get("reruns", 0)), raw=entry)
    return TaskState(status="planned", since=clock.parse_utc(EPOCH_UTC), attempts=0, reruns=0, raw={})


def save(ctx: Ctx, doc: dict) -> None:
    """Write the caller's own status file under the state lock: seq = max(disk, doc) + 1, updated_utc = now."""
    if not locks.is_held("state"):
        raise InternalError("statusio.save requires the state lock")
    executor = doc.get("executor")
    if executor != ctx.executor:
        raise PolicyRefused(f"executor {ctx.executor} may not write status/{executor}.json", code="E_POLICY",
                            hint="each orchestrator writes only its own status file")
    path = ctx.layout.status(str(executor))
    disk_seq = -1
    if path.exists():
        disk = jsonio.read_json_retry(path)
        if isinstance(disk, dict) and isinstance(disk.get("seq"), int):
            disk_seq = disk["seq"]
    doc["seq"] = max(int(doc.get("seq", 0)), disk_seq) + 1
    doc["updated_utc"] = clock.format_utc(ctx.now)
    _check(doc, f"status/{executor}.json")
    jsonio.write_json_atomic(path, doc)
