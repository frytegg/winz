"""Clock work from UTC anchors at every tick (contract/MODULES.md 4 `due.py`, CLI.md `due`, ARCHITECTURE.md 7.3).

Crons are wake sources, never deadline alarms: every instant here is computed in UTC from the plan, the profile, the
policy and the status histories, whatever the machine's zone. `due` is read-only except one `due` event when
something is overdue.

Lane-rule deviation (contract question Q-B03-1): MODULES.md 8 gives `due -> plan, statusio, graph` only, while CLI.md
`due` appends an event. The state lock and the schema are reached through statusio's own imports (`statusio.locks`,
`statusio.schema`) and the event line is written in exactly the format of `events.append` (`_append_event` below)
until the edges `due -> locks, events` are added.
"""
from __future__ import annotations

import os
import re
from argparse import Namespace
from datetime import datetime, timedelta
from typing import Any, Mapping

from . import clock, jsonio, statusio
from . import plan as planmod
from .errors import ErrorItem, InternalError, UsageError, ValidationFailed
from .log import get_logger
from .model import CommandResult, Ctx, PlanModel

_LOG = get_logger("execlib.due")
TERMINAL = frozenset({"done", "cut", "superseded"})
NOT_STARTED = frozenset({"planned", "ready"})
_TASK_REF = re.compile(r"^(T[0-9]{3,})\.(ready|done)$")
_UTC = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
MAX_OCCURRENCES = 2000
# Mirror of events.AGENT_ROLES for the actor of `_append_event` (Q-B03-1); test_due asserts the two are equal and
# that `_append_event` writes what `events.append` writes, so a drift fails a test.
AGENT_ROLES = frozenset({"planner", "test-designer", "implementer", "integrator", "verifier", "reviewer", "critic",
                         "probe", "convergence"})


def _actor(ctx: Ctx) -> str:
    """events.actor_for: exec:<command>@<executor>, or agent:<role>@<executor> when --by names an agent role."""
    if ctx.executor not in ("A", "B"):
        raise InternalError("no executor for this call: pass --executor or run exec.py init first")
    if ctx.by in AGENT_ROLES:
        return f"agent:{ctx.by}@{ctx.executor}"
    return f"exec:{ctx.command}@{ctx.executor}"


def _num(tid: str) -> int:
    return int(tid[1:]) if tid[1:].isdigit() else 1 << 62


def _profile_utc(profile: Mapping | None, *keys: str) -> datetime | None:
    node: Any = profile or {}
    for k in keys:
        node = node.get(k) if isinstance(node, Mapping) else None
    return clock.parse_utc(node) if isinstance(node, str) else None


def _became(entry: Mapping, to: str) -> datetime | None:
    for h in entry.get("history") or ():
        if h.get("to") == to:
            return clock.parse_utc(h["at_utc"])
    if entry.get("status") == to and entry.get("since_utc"):
        return clock.parse_utc(entry["since_utc"])
    return None


def ref_instant(ref: str, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping | None
                ) -> datetime | None:
    """The instant an anchor reference names: event.start / event.deadline (profile), DL-<id> (plan), Tnnn.ready /
    Tnnn.done (the first such transition in the task's status history); None while unknown."""
    if ref == "event.start":
        return _profile_utc(profile, "event", "start_utc")
    if ref == "event.deadline":
        return _profile_utc(profile, "event", "deadline_utc")
    if ref.startswith("DL-"):
        return next((d.at for d in plan.deadlines if d.id == ref), None)
    m = _TASK_REF.match(ref)
    if m and m.group(1) in plan.by_id:
        entry = statusio.state_of(m.group(1), statuses, plan).raw
        return _became(entry, m.group(2))
    return None


def anchor_instant(anchor: dict, plan: PlanModel, statuses: Mapping[str, dict], profile: dict) -> datetime | None:
    """The anchor's first instant: its reference plus offset_min (None while the reference is unknown)."""
    if not anchor:
        return None
    base = ref_instant(str(anchor.get("relative_to", "")), plan, statuses, profile)
    if base is None:
        return None
    return base + timedelta(minutes=float(anchor.get("offset_min", 0)))


def recurrence_instants(anchor: dict, plan: PlanModel, statuses: Mapping[str, dict], profile: dict
                        ) -> list[datetime]:
    """Every occurrence of an anchored clock task: the first instant, then every `every_min` while at or before
    `until` (an anchor reference or a UTC instant). Without recurrence: the single instant. An unknown `until`
    gives the first occurrence only (never an invented end)."""
    first = anchor_instant(anchor, plan, statuses, profile)
    if first is None:
        return []
    rec = anchor.get("recurrence")
    if not rec:
        return [first]
    until_raw = str(rec.get("until", ""))
    until = clock.parse_utc(until_raw) if _UTC.match(until_raw) else ref_instant(until_raw, plan, statuses, profile)
    if until is None:
        _LOG.warning("recurrence end unknown: first occurrence only", extra={"data": {"until": until_raw}})
        return [first]
    step = timedelta(minutes=int(rec["every_min"]))
    out: list[datetime] = []
    at = first
    while at <= until and len(out) < MAX_OCCURRENCES:
        out.append(at)
        at += step
    return out


def display_time(dt: datetime, profile: Mapping | None) -> dict[str, str]:
    """{"utc": ..., "<zone label>": "Wed 7 Oct 23:59 SGT", ...} (W_TZ_FALLBACK through clock.display)."""
    shown, _w = clock.display(dt, clock.zones_from_profile(dict(profile or {})))
    return {"utc": clock.format_utc(dt), **shown}


def _item(task: str | None, kind: str, at: datetime, now: datetime, profile: Mapping | None, **extra: Any) -> dict:
    over = clock.minutes_between(at, now)
    return {"task": task, "kind": kind, "at_utc": clock.format_utc(at), "at": display_time(at, profile),
            "overdue_min": round(over, 1) if over > 0 else 0, **extra}


def freezes(plan: PlanModel, profile: Mapping | None, policy: Mapping | None, now: datetime) -> list[dict]:
    """Every freeze with its instant and whether it is active now: profile.freezes, the policy's push freeze and
    the plan's deadlines of kind freeze."""
    rows: list[tuple[datetime, str, str]] = []
    for f in (profile or {}).get("freezes") or ():
        rows.append((clock.parse_utc(f["at_utc"]), str(f["id"]), str(f["kind"])))
    push = (((policy or {}).get("git") or {}).get("push_freeze_utc"))
    if isinstance(push, str):
        rows.append((clock.parse_utc(push), "push-freeze", "push-tag"))
    for d in plan.deadlines:
        if d.kind == "freeze":
            rows.append((d.at, d.id, "freeze"))
    return [{"id": fid, "kind": kind, "at_utc": clock.format_utc(at), "at": display_time(at, profile),
             "active": at <= now} for at, fid, kind in sorted(rows)]


def due_items(plan: PlanModel, statuses: Mapping[str, dict], profile: dict, now: datetime, horizon_min: int, *,
              policy: Mapping | None = None) -> list[dict]:
    """Items due by now + horizon or already overdue, sorted by (instant, kind, task):
    - anchor: an anchored task not yet started whose instant is reached or near;
    - recurrence: the latest past occurrence of a recurring clock task (overdue since) and the upcoming ones;
    - latest-start: a manual or decision task not yet posted whose latest start is near or past;
    - deadline: a task deadline_utc of an unfinished task (near or past) and plan deadlines within the horizon;
    - freeze: a freeze that becomes active within the horizon."""
    horizon = now + timedelta(minutes=int(horizon_min))
    out: list[dict] = []
    for t in plan.tasks:
        state = statusio.state_of(t.id, statuses, plan).status
        if state in TERMINAL:
            continue
        if t.anchor:
            rec = t.anchor.get("recurrence")
            if rec:
                occ = recurrence_instants(t.anchor, plan, statuses, profile)
                past = [o for o in occ if o <= now]
                if past:
                    out.append(_item(t.id, "recurrence", past[-1], now, profile))
                out.extend(_item(t.id, "recurrence", o, now, profile) for o in occ if now < o <= horizon)
            elif state in NOT_STARTED:
                at = anchor_instant(t.anchor, plan, statuses, profile)
                if at is not None and at <= horizon:
                    out.append(_item(t.id, "anchor", at, now, profile))
        if t.is_human and state in NOT_STARTED and t.manual and t.manual.get("latest_start_utc"):
            at = clock.parse_utc(t.manual["latest_start_utc"])
            if at <= horizon:
                out.append(_item(t.id, "latest-start", at, now, profile))
        if t.deadline is not None and t.deadline <= horizon:
            out.append(_item(t.id, "deadline", t.deadline, now, profile))
    for d in plan.deadlines:
        if now <= d.at <= horizon:
            out.append(_item(None, "deadline", d.at, now, profile, deadline=d.id))
    for f in freezes(plan, profile, policy, now):
        at = clock.parse_utc(f["at_utc"])
        if now < at <= horizon:
            out.append(_item(None, "freeze", at, now, profile, freeze=f["id"]))
    out.sort(key=lambda i: (i["at_utc"], i["kind"], _num(i["task"]) if i["task"] else -1,
                            i.get("deadline") or i.get("freeze") or ""))
    return out


def liveness_threshold_min(profile: Mapping | None) -> int:
    """2 x heartbeat.every_min + 30 (TWO-DEV.md 8.4: crons fire up to 30 min late); 70 with the default 20."""
    every = ((profile or {}).get("heartbeat") or {}).get("every_min")
    return 2 * (int(every) if isinstance(every, int) else 20) + 30


def _newest_event(layout: Any, *, executor: str | None, type_: str | None = None) -> dict | None:
    best: dict | None = None
    if not layout.events.exists():
        return None
    for _n, doc in jsonio.read_jsonl(layout.events):
        if not isinstance(doc, dict) or not isinstance(doc.get("ts"), str):
            continue
        if executor is not None and doc.get("executor") != executor:
            continue
        if type_ is not None and doc.get("type") != type_:
            continue
        if best is None or doc["ts"] > best["ts"]:
            best = doc
    return best


def stale_items(plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping | None, local_state: Mapping | None,
                *, executor: str, now: datetime, layout: Any) -> list[dict]:
    """[{what, last_utc, age_min, threshold_min, executor?}]: the plan newer than the own status file's
    plan_version; the own status file or own events older than the liveness threshold; the Notion mirror's last ok
    (when Notion is enabled); and the other executor silent (its newest state commit on the remote, from the latest
    `sync` event, older than the threshold while its status shows a task ready or running; TWO-DEV.md 8.4)."""
    threshold = liveness_threshold_min(profile)
    out: list[dict] = []

    def add(what: str, last: datetime | None, **extra: Any) -> None:
        age = clock.minutes_between(last, now) if last is not None else None
        out.append({"what": what, "last_utc": clock.format_utc(last) if last else None,
                    "age_min": round(age, 1) if age is not None else None, "threshold_min": threshold, **extra})

    own = statuses.get(executor) or {}
    if int(own.get("plan_version", plan.version)) < plan.version:
        add("plan", clock.parse_utc(plan.raw["updated_utc"]) if plan.raw.get("updated_utc") else None)
    updated = own.get("updated_utc")
    if isinstance(updated, str) and updated != statusio.EPOCH_UTC:
        last = clock.parse_utc(updated)
        if clock.minutes_between(last, now) > threshold:
            add("status", last, executor=executor)
    ev = _newest_event(layout, executor=executor)
    if ev is not None:
        last = clock.parse_utc(ev["ts"])
        if clock.minutes_between(last, now) > threshold:
            add("events", last)
    if ((profile or {}).get("notion") or {}).get("enabled"):
        ok = (((local_state or {}).get("notion") or {}).get("last_ok_utc"))
        last = clock.parse_utc(ok) if isinstance(ok, str) else None
        if last is None or clock.minutes_between(last, now) > threshold:
            add("notion", last)
    other = "B" if executor == "A" else "A"
    other_doc = statuses.get(other) or {}
    active = sorted(tid for tid, e in (other_doc.get("tasks") or {}).items()
                    if e.get("status") in ("ready", "running"))
    if active:
        sync = _newest_event(layout, executor=executor, type_="sync")
        commit = ((sync or {}).get("data") or {}).get("other_executor_last_commit_utc")
        if isinstance(commit, str):
            last = clock.parse_utc(commit)
            if clock.minutes_between(last, now) > threshold:
                add("status", last, executor=other, silent=True, tasks=active[:10])
    return out


def _append_event(ctx: Ctx, type_: str, data: dict) -> dict:
    """One events.jsonl line in the format of events.append (actor, ts, seq from local/state.json events_seq,
    schema-checked); the caller holds the state lock (Q-B03-1: no due -> events edge in MODULES.md 8)."""
    locks = statusio.locks
    if not locks.is_held("state"):
        raise InternalError("due: an event requires the state lock")
    actor = _actor(ctx)
    written: dict = {}
    pending = [("error", {"kind": "lock-broken", **rec}) for rec in locks.drain_broken()]
    for etype, edata in pending + [(type_, data)]:
        event: dict[str, Any] = {"ts": clock.format_utc_precise(ctx.now), "actor": actor, "type": etype,
                                 "data": dict(edata), "executor": ctx.executor}
        if clock.is_overridden():
            event["data"].setdefault("clock", "override")
        session = os.environ.get("CLAUDE_CODE_SESSION_ID")
        if session:
            event["session_id"] = session
        report = statusio.schema.validate(event, "event")
        if not report.ok:
            items = [ErrorItem("E_EVENT_INVALID", i.message, path=i.instance_path or "/") for i in report.issues[:20]]
            raise ValidationFailed(f"event {etype} fails event.schema.json", code="E_EVENT_INVALID", items=items)
        seq = jsonio.bump_counter(ctx.layout.local_state, "events_seq")
        if seq is None:
            seq = 1 + max((d["seq"] for _n, d in jsonio.read_jsonl(ctx.layout.events)
                           if isinstance(d, dict) and d.get("executor") == ctx.executor
                           and isinstance(d.get("seq"), int)), default=-1)
        event["seq"] = seq
        jsonio.append_jsonl(ctx.layout.events, event)
        written = event
    return written


def _read_optional(path: Any) -> Any:
    return jsonio.read_json_retry(path) if path.exists() else None


def cmd_due(ctx: Ctx, args: Namespace) -> CommandResult:
    """CLI.md `due`: {now, due, stale, freezes}; a `due` event only when something is overdue."""
    horizon = int(getattr(args, "horizon_min", 120) or 120)
    if horizon < 0:
        raise UsageError("--horizon-min must be >= 0")
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    plan = planmod.load(ctx.layout)
    statuses = statusio.load_all(ctx.layout)
    profile = _read_optional(ctx.layout.profile)
    policy = _read_optional(ctx.layout.policy)
    local_state = _read_optional(ctx.layout.local_state)
    items = due_items(plan, statuses, profile or {}, ctx.now, horizon, policy=policy)
    data = {"now": display_time(ctx.now, profile), "due": items,
            "stale": stale_items(plan, statuses, profile, local_state, executor=ctx.executor, now=ctx.now,
                                 layout=ctx.layout),
            "freezes": freezes(plan, profile, policy, ctx.now)}
    overdue = [i for i in items if i["overdue_min"] > 0]
    if overdue:
        with statusio.locks.hold(ctx.layout, "state", command=ctx.command):
            _append_event(ctx, "due", {"overdue": [{"task": i["task"], "kind": i["kind"], "at_utc": i["at_utc"],
                                                    "overdue_min": i["overdue_min"]} for i in overdue[:20]]})
    return CommandResult(data=data)
