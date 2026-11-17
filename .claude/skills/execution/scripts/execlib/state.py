"""Machine-local run state: local/state.json, local/active, local/hooks-state.json (contract/MODULES.md 3).

local/state.json is a cache rebuilt by `events replay --rebuild-state`; it is written only by exec.py under the
state lock. `set_run_state` enforces RUN_TRANSITIONS and writes the `run.state` event. This module sits on the same
layer as `events` and may not import it (MODULES.md 8), so the event line is written here with the same format,
validation and sequence counter (`events_seq`, bumped through jsonio) as `events.append`.
"""
from __future__ import annotations

import os
from typing import Any, Mapping

from . import clock, jsonio, locks, schema
from .errors import ErrorItem, InternalError, TransitionRefused, UsageError, ValidationFailed
from .log import get_logger
from .model import Ctx
from .paths import Layout

_LOG = get_logger("execlib.state")

RUN_STATES: tuple[str, ...] = ("INIT", "PREFLIGHT", "INGEST", "PLAN", "AWAIT_APPROVAL", "RUNNING", "AWAITING_HUMAN",
                               "AWAITING_DECISION", "PAUSED_QUOTA", "PAUSED_RESOURCES", "STUCK", "BUILD_COMPLETE",
                               "HANDED_OVER", "FIX")
_WAITING = ("AWAITING_HUMAN", "AWAITING_DECISION", "PAUSED_QUOTA", "PAUSED_RESOURCES")
TERMINAL: frozenset[str] = frozenset({"HANDED_OVER"})


def _transitions() -> dict[str, frozenset[str]]:
    t: dict[str, set[str]] = {s: set() for s in RUN_STATES}
    t["INIT"].add("PREFLIGHT")
    t["PREFLIGHT"].add("INGEST")
    t["INGEST"].add("PLAN")
    t["PLAN"].update({"AWAIT_APPROVAL", "PLAN"})
    t["AWAIT_APPROVAL"].update({"RUNNING", "PLAN"})
    t["RUNNING"].update(_WAITING)
    for w in _WAITING:
        t[w].add("RUNNING")
    t["RUNNING"].update({"BUILD_COMPLETE", "HANDED_OVER"})
    t["BUILD_COMPLETE"].update({"HANDED_OVER", "RUNNING"})
    t["HANDED_OVER"].add("FIX")
    t["FIX"].add("RUNNING")
    t["STUCK"].add("RUNNING")
    for s in RUN_STATES:
        if s not in TERMINAL and s != "STUCK":
            t[s].add("STUCK")
    return {k: frozenset(v) for k, v in t.items()}


RUN_TRANSITIONS: Mapping[str, frozenset[str]] = _transitions()

_AGENT_ROLES = frozenset({"planner", "test-designer", "implementer", "integrator", "verifier", "reviewer", "critic",
                          "probe", "convergence"})


def default(executor: str, project: str, now: Any) -> dict:
    """A fresh local/state.json document (run_state INIT)."""
    return {
        "schema": "execution.local-state/1",
        "executor": executor,
        "project": project,
        "run_state": "INIT",
        "run_state_since_utc": clock.format_utc(now),
        "previous_run_state": None,
        "events_seq": 0,
        "plan_sha256": None,
        "waves": [],
        "awaiting": [],
        "heartbeat": {"cron_id": None, "cron_expr": None, "prompt": "", "recorded_utc": None, "session_id": None},
        "watchers": [],
        "governor": None,
        "quota": None,
        "notion": {"pages": {}, "hashes": {}, "pending_batches": [], "outbox_count": 0, "last_ok_utc": None,
                   "token_ok": None, "last_hub_text_sha256": None},
        "flags": {"mainnet_open": False, "push_frozen": False},
        "hooks": {"installed_utc": None, "settings_path": None, "canary_ok_utc": None, "permission_mode": None,
                  "probe_ok_utc": None, "agent_role_source": None, "agent_session_scoped": False},
        "calibration": {"ratios": {}, "samples": {}, "pct_per_agent_hour": None},
        "stuck": None,
        "last_tick_utc": None,
        "settings_backup": {"switchModelsOnFlag_present": False, "switchModelsOnFlag_value": None},
    }


def _check(doc: Any, name: str, what: str, code: str) -> None:
    report = schema.validate(doc, name)
    if not report.ok:
        items = [ErrorItem(code, i.message, path=i.instance_path or "/") for i in report.issues[:20]]
        raise ValidationFailed(f"{what} is invalid: {report.issues[0].message}", code=code, items=items)


def load(layout: Layout) -> dict:
    """local/state.json, validated (E_STATE_INVALID); UsageError before `exec.py init`."""
    if not layout.local_state.exists():
        raise UsageError(f"no local state at {layout.local_state.as_posix()}", hint="run exec.py init first")
    doc = jsonio.read_json_retry(layout.local_state)
    _check(doc, "local-state", "local/state.json", "E_STATE_INVALID")
    return doc


def _max_seq_in_events(layout: Layout, executor: str | None) -> int:
    """The highest `seq` of this executor's lines in events.jsonl (0 when none). Read here, not through `events`,
    which this module may not import (MODULES.md 8); unreadable lines are skipped by jsonio.read_jsonl."""
    best = 0
    for _n, doc in jsonio.read_jsonl(layout.events):
        if not isinstance(doc, dict) or doc.get("executor") != executor:
            continue
        seq = doc.get("seq")
        if isinstance(seq, int) and not isinstance(seq, bool):
            best = max(best, seq)
    return best


def save(ctx: Ctx, st: dict) -> None:
    """Write local/state.json under the state lock; events_seq never moves backwards."""
    if not locks.is_held("state"):
        raise InternalError("state.save requires the state lock")
    path = ctx.layout.local_state
    if path.exists():
        problem = ""
        try:
            disk = jsonio.read_json_retry(path)
        except ValidationFailed as err:
            problem = err.message
        else:
            seq = disk.get("events_seq") if isinstance(disk, dict) else None
            if isinstance(seq, int) and not isinstance(seq, bool):
                st["events_seq"] = max(int(st.get("events_seq", 0)), seq)
            else:
                problem = "no integer events_seq in the cached document"
        if problem:
            # a corrupt cache is replaced by the validated document below; its sequence floor is recovered from
            # this executor's lines of events.jsonl so a sequence number is never reused
            floor = _max_seq_in_events(ctx.layout, ctx.executor)
            before = int(st.get("events_seq", 0))
            st["events_seq"] = max(before, floor)
            _LOG.warning("local/state.json was corrupt: replaced, events_seq floor recomputed from events.jsonl",
                         extra={"data": {"path": path.as_posix(), "error": problem, "executor": ctx.executor,
                                         "events_seq_from_events": floor, "events_seq": st["events_seq"]}})
    _check(st, "local-state", "local/state.json", "E_STATE_INVALID")
    jsonio.write_json_atomic(path, st)


def _actor(ctx: Ctx) -> str:
    if ctx.executor not in ("A", "B"):
        raise InternalError("no executor for this call: pass --executor or run exec.py init first")
    if ctx.by in _AGENT_ROLES:
        return f"agent:{ctx.by}@{ctx.executor}"
    return f"exec:{ctx.command}@{ctx.executor}"


def _write_event(ctx: Ctx, st: dict, type_: str, data: dict) -> dict:
    actor = _actor(ctx)
    pending = [("error", {"kind": "lock-broken", **rec}) for rec in locks.drain_broken()]
    written: dict = {}
    for etype, edata in pending + [(type_, data)]:
        event: dict[str, Any] = {"ts": clock.format_utc_precise(ctx.now), "actor": actor, "type": etype,
                                 "data": dict(edata), "executor": ctx.executor}
        if clock.is_overridden():
            event["data"].setdefault("clock", "override")
        session = os.environ.get("CLAUDE_CODE_SESSION_ID")
        if session:
            event["session_id"] = session
        _check(event, "event", f"event {etype}", "E_EVENT_INVALID")
        bumped = jsonio.bump_counter(ctx.layout.local_state, "events_seq", floor=int(st.get("events_seq", 0)))
        seq = bumped if bumped is not None else int(st.get("events_seq", 0)) + 1
        st["events_seq"] = seq
        event["seq"] = seq
        jsonio.append_jsonl(ctx.layout.events, event)
        written = event
    return written


def set_run_state(ctx: Ctx, st: dict, to: str, reason: str) -> None:
    """Move run_state (TransitionRefused outside RUN_TRANSITIONS) and append the run.state event; the caller saves
    `st`. A move to the current state that the table does not list is a no-op without an event."""
    if not locks.is_held("state"):
        raise InternalError("set_run_state requires the state lock")
    if to not in RUN_TRANSITIONS:
        raise UsageError(f"unknown run state {to!r}")
    cur = st.get("run_state")
    if cur == to and to not in RUN_TRANSITIONS.get(cur, frozenset()):
        return
    if cur not in RUN_TRANSITIONS or to not in RUN_TRANSITIONS[cur]:
        raise TransitionRefused(f"run state {cur} -> {to} is not allowed", code="E_TRANSITION_REFUSED",
                                hint="allowed from here: " + ", ".join(sorted(RUN_TRANSITIONS.get(cur, ()))))
    _write_event(ctx, st, "run.state", {"from": cur, "to": to, "reason": reason})
    st["previous_run_state"] = cur
    st["run_state"] = to
    st["run_state_since_utc"] = clock.format_utc(ctx.now)


def read_active(layout: Layout) -> dict | None:
    """local/active (validated against local-state#/$defs/active_marker); None when absent."""
    if not layout.active.exists():
        return None
    doc = jsonio.read_json_retry(layout.active)
    _check(doc, "local-state#/$defs/active_marker", "local/active", "E_STATE_INVALID")
    return doc


def write_active(layout: Layout, marker: dict) -> None:
    _check(marker, "local-state#/$defs/active_marker", "local/active", "E_STATE_INVALID")
    jsonio.write_json_atomic(layout.active, marker)


def hooks_state_default() -> dict:
    return {"schema": "execution.hooks-state/1", "consecutive_continuations": 0, "last_continuation_utc": None,
            "last_digest_sha256": None, "stuck": None, "last_stop_utc": None}


def read_hooks_state(layout: Layout) -> dict:
    """local/hooks-state.json, or the defaults when absent (validated when present)."""
    if not layout.hooks_state.exists():
        return hooks_state_default()
    doc = jsonio.read_json_retry(layout.hooks_state)
    _check(doc, "local-state#/$defs/hooks_state", "local/hooks-state.json", "E_STATE_INVALID")
    return doc
