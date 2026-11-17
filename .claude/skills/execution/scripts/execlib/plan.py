"""plan.json: load, save, digests (contract/MODULES.md 4, SCHEMAS.md 1.4 and 5.1).

`plan_digest` is what the owner approves and what amendments chain; `proof_digest` is a task proof's identity
(recording its negative control does not change it). `save` refuses an approved plan unless the caller is one of the
two writers allowed to touch it (decision resolve, amend), which pass `allow_approved=True`. The plan lock is checked
through its lock file (the module may import only `schema`, MODULES.md 8).
"""
from __future__ import annotations

import copy
import os
from typing import Any

from . import jsonio, schema
from .errors import ErrorItem, InternalError, PolicyRefused, UsageError, ValidationFailed
from .model import Ctx, PlanModel
from .paths import Layout

DIGEST_EXCLUDED: tuple[str, ...] = ("approved", "amendments", "updated_utc", "plan_version")


def _check(raw: Any, what: str) -> None:
    report = schema.validate(raw, "plan")
    if not report.ok:
        items = [ErrorItem("E_PLAN_INVALID", i.message, path=i.instance_path or "/") for i in report.issues[:50]]
        raise ValidationFailed(f"{what} fails plan.schema.json: {report.issues[0].message}", code="E_PLAN_INVALID",
                               items=items)


def load_raw(layout: Layout) -> dict:
    """plan.json, schema-checked (E_PLAN_INVALID); UsageError when absent."""
    if not layout.plan.exists():
        raise UsageError(f"no plan at {layout.plan.as_posix()}", hint="run exec.py plan instantiate first")
    raw = jsonio.read_json_retry(layout.plan)
    _check(raw, "plan.json")
    return raw


def load(layout: Layout) -> PlanModel:
    return PlanModel.from_raw(load_raw(layout))


def _holds_plan_lock(layout: Layout) -> bool:
    """True when this process holds the plan lock (its lock file names our pid). Read through jsonio: plan's only
    allowed edge is schema (MODULES.md 8), so the `locks` module is not imported here."""
    try:
        holder = jsonio.read_json(layout.lock("plan"))
    except (FileNotFoundError, ValidationFailed, PermissionError):
        return False
    return isinstance(holder, dict) and holder.get("pid") == os.getpid()


def save(ctx: Ctx, raw: dict, *, allow_approved: bool = False) -> None:
    """Write plan.json under the plan lock. An approved plan on disk is refused (E_PLAN_APPROVED) unless the caller
    is `decision resolve` or `amend` (allow_approved=True)."""
    if not _holds_plan_lock(ctx.layout):
        raise InternalError("plan.save requires the plan lock")
    path = ctx.layout.plan
    if not allow_approved and path.exists():
        current = jsonio.read_json_retry(path)
        if isinstance(current, dict) and current.get("approved") is not None:
            raise PolicyRefused("plan.json is approved: change it through exec.py amend", code="E_PLAN_APPROVED")
    _check(raw, "the plan to save")
    jsonio.write_json_atomic(path, raw)


def plan_digest(raw: dict) -> str:
    """sha256 of canonical(plan) without approved, amendments, updated_utc and plan_version."""
    body = {k: v for k, v in raw.items() if k not in DIGEST_EXCLUDED}
    return jsonio.sha256_json(body)


def proof_digest(task_raw: dict) -> str:
    """sha256 of canonical(task.proof) with negative_control.recorded removed. Accepts a task or a proof object."""
    proof = task_raw.get("proof", task_raw) if "proof" in task_raw else task_raw
    body = copy.deepcopy(proof)
    nc = body.get("negative_control") if isinstance(body, dict) else None
    if isinstance(nc, dict):
        nc.pop("recorded", None)
    return jsonio.sha256_json(body)


def max_id_num(raw: dict) -> int:
    """The highest numeric task id (0 for an empty plan)."""
    best = 0
    for t in raw.get("tasks") or ():
        tid = str(t.get("id", ""))
        if tid.startswith("T") and tid[1:].isdigit():
            best = max(best, int(tid[1:]))
    return best
