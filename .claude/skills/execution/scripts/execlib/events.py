"""events.jsonl: append-only, the resume source (contract/MODULES.md 3, SCHEMAS.md 8, event.schema.json).

`append` requires the state lock, validates the event, takes the per-executor sequence number from
local/state.json (`events_seq`, bumped through jsonio: this module never imports `state`) and writes one canonical
line. Readers order by (ts, executor, seq) and drop duplicates by id: union merges may interleave the two executors'
lines, so the order on disk means nothing.
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from . import clock, jsonio, locks, schema
from .errors import ErrorItem, InternalError, ValidationFailed
from .model import Ctx
from .paths import Layout

AGENT_ROLES = frozenset({"planner", "test-designer", "implementer", "integrator", "verifier", "reviewer", "critic",
                         "probe", "convergence"})


def actor_for(ctx: Ctx) -> str:
    """exec:<command>@<executor>, or agent:<role>@<executor> when --by names an agent role."""
    if ctx.executor not in ("A", "B"):
        raise InternalError("no executor for this call: pass --executor or run exec.py init first")
    if ctx.by in AGENT_ROLES:
        return f"agent:{ctx.by}@{ctx.executor}"
    return f"exec:{ctx.command}@{ctx.executor}"


def _max_seq_on_disk(layout: Layout, executor: str | None) -> int:
    best = -1
    for _n, doc in jsonio.read_jsonl(layout.events):
        if isinstance(doc, dict) and doc.get("executor") == executor and isinstance(doc.get("seq"), int):
            best = max(best, doc["seq"])
    return best


def _next_seq(layout: Layout, executor: str | None) -> int:
    bumped = jsonio.bump_counter(layout.local_state, "events_seq")
    if bumped is not None:
        return bumped
    return _max_seq_on_disk(layout, executor) + 1


def _write(ctx: Ctx, type_: str, data: dict, actor: str, event_id: str | None) -> dict:
    event: dict[str, Any] = {"ts": clock.format_utc_precise(ctx.now), "actor": actor, "type": type_,
                             "data": dict(data)}
    if clock.is_overridden():
        event["data"].setdefault("clock", "override")
    if ctx.executor in ("A", "B"):
        event["executor"] = ctx.executor
    if event_id is not None:
        event["id"] = event_id
    session = os.environ.get("CLAUDE_CODE_SESSION_ID")
    if session:
        event["session_id"] = session
    report = schema.validate(event, "event")
    if not report.ok:
        items = [ErrorItem("E_EVENT_INVALID", i.message, path=i.instance_path or "/") for i in report.issues[:20]]
        raise ValidationFailed(f"event {type_} fails event.schema.json: {report.issues[0].message}",
                               code="E_EVENT_INVALID", items=items)
    event["seq"] = _next_seq(ctx.layout, ctx.executor)
    jsonio.append_jsonl(ctx.layout.events, event)
    return event


def append(ctx: Ctx, type_: str, data: dict, *, actor: str | None = None, event_id: str | None = None) -> dict:
    """Append one validated event under the state lock; returns the event as written.

    Locks broken from dead holders since the last call are written first as `error` events."""
    if not locks.is_held("state"):
        raise InternalError("events.append requires the state lock", code="E_INTERNAL")
    who = actor or actor_for(ctx)
    for record in locks.drain_broken():
        _write(ctx, "error", {"kind": "lock-broken", **record}, who, None)
    return _write(ctx, type_, data, who, event_id)


def _sort_key(ev: dict) -> tuple[datetime, str, int]:
    try:
        ts = clock.parse_utc(str(ev.get("ts")))
    except Exception:  # noqa: BLE001 - an unparsable ts was already reported by the schema check
        ts = clock.parse_utc("0001-01-01T00:00:00Z")
    seq = ev.get("seq")
    return ts, str(ev.get("executor") or ""), seq if isinstance(seq, int) and not isinstance(seq, bool) else -1


def read_all(layout: Layout, *, since: datetime | None = None) -> tuple[list[dict], list[ErrorItem]]:
    """Every valid event sorted by (ts, executor, seq), duplicates by id dropped; invalid lines reported."""
    events: list[dict] = []
    errors: list[ErrorItem] = []
    path_text = layout.events.as_posix()
    for lineno, doc in jsonio.read_jsonl(layout.events):
        if isinstance(doc, ErrorItem):
            errors.append(doc)
            continue
        report = schema.validate(doc, "event")
        if not report.ok:
            errors.append(ErrorItem("E_EVENT_INVALID", f"line {lineno}: {report.issues[0].message}",
                                    path=f"{path_text}:{lineno}"))
            continue
        events.append(doc)
    events.sort(key=_sort_key)
    seen: set[str] = set()
    out: list[dict] = []
    for ev in events:
        eid = ev.get("id")
        if isinstance(eid, str):
            if eid in seen:
                continue
            seen.add(eid)
        if since is not None and _sort_key(ev)[0] < since:
            continue
        out.append(ev)
    return out, errors
