"""Quota decisions from the statusline's usage snapshot (contract/MODULES.md 4 `quota.py`, CLI.md `quota`,
ARCHITECTURE.md 8.2, SCHEMAS.md 4.4).

Rules, first match wins (CLI.md `quota`):
1. limit evidence newer than the snapshot (a `stop.failure` event with error rate_limit, or a null storm) -> pause
   until the five-hour reset (evidence + 5 h when no snapshot reset follows the evidence); once that instant has
   passed the evidence is spent and the later rules decide; with an active extra-usage override, pause until a
   snapshot newer than the evidence (open-ended);
2. five-hour used >= 100 % -> pause until its reset, unless an extra-usage override is active (then normal); a
   reading whose reset has passed is spent;
3. snapshot older than profile.quota.max_age_s (or absent) -> unknown, W_SNAPSHOT_STALE, nothing invented;
4. five-hour >= five_hour_critical_only_pct, or an active critical-only override -> critical-only;
5. the weekly window cannot cover the plan's P80 need plus weekly_reserve_pct (or weekly >= 100 %) -> pause and a
   `quota` decision draft (extra-usage, critical-only, wait); with an active extra-usage override -> normal.
`decide` is pure; `cmd_quota` reads the snapshot, the limit evidence, the projection and the override, writes
local/state.json `quota` and appends a `quota` event.

Lane-rule deviation (contract question Q-B03-1): MODULES.md 8 gives `quota -> plan, statusio` only, while CLI.md
`quota` writes local/state.json under the state lock and appends an event. The lock and the schema are reached
through statusio's own imports (`statusio.locks`, `statusio.schema`); local/state.json is rewritten whole under the
lock (validated against local-state) and the event line is written in exactly the format of `events.append`, until
the edges `quota -> locks, state, events` are added.
"""
from __future__ import annotations

import math
import os
from argparse import Namespace
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Mapping

from . import clock, jsonio, statusio
from .errors import ErrorItem, InternalError, UsageError, ValidationFailed
from .log import get_logger
from .model import CommandResult, Ctx

_LOG = get_logger("execlib.quota")
FIVE_HOUR_MIN = 300.0
# Mirror of events.AGENT_ROLES for the actor of `_append_event` (Q-B03-1); test_quota asserts the two are equal and
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


@dataclass(frozen=True)
class Snapshot:
    captured: datetime
    five_pct: float | None
    five_resets: datetime | None
    seven_pct: float | None
    seven_resets: datetime | None


def _pct(node: Any) -> float | None:
    value = node.get("used_percentage") if isinstance(node, Mapping) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or math.isnan(float(value)):
        return None
    return float(value)


def _resets(node: Any) -> datetime | None:
    value = node.get("resets_at") if isinstance(node, Mapping) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return clock.from_epoch(value)


def read_snapshot(path: Path) -> Snapshot | None:
    """~/.claude/usage-snapshot.json: {captured_at_utc, five_hour {used_percentage, resets_at (epoch s)}, seven_day
    {...}}. None when the file is absent; ValidationFailed (E_SCHEMA) when it is not that shape."""
    p = Path(path)
    if not p.exists():
        return None
    doc = jsonio.read_json_retry(p)
    if not isinstance(doc, dict) or not isinstance(doc.get("captured_at_utc"), str):
        raise ValidationFailed(f"{p.as_posix()}: not a usage snapshot (captured_at_utc missing)", code="E_SCHEMA")
    try:
        captured = clock.parse_utc(doc["captured_at_utc"])
    except UsageError as err:
        raise ValidationFailed(f"{p.as_posix()}: captured_at_utc is not a UTC instant", code="E_SCHEMA") from err
    return Snapshot(captured=captured, five_pct=_pct(doc.get("five_hour")), five_resets=_resets(doc.get("five_hour")),
                    seven_pct=_pct(doc.get("seven_day")), seven_resets=_resets(doc.get("seven_day")))


def _fmt(dt: datetime | None) -> str | None:
    return clock.format_utc(dt) if dt is not None else None


def override_active(override: Mapping | None, now: datetime) -> dict | None:
    """The override when its until_utc is still in the future, else None."""
    if not isinstance(override, Mapping) or not isinstance(override.get("until_utc"), str):
        return None
    return dict(override) if clock.parse_utc(override["until_utc"]) > now else None


def quota_draft(snap: Snapshot | None, needed: float | None, available: float | None) -> dict:
    """The `quota` decision proposal of rule 5 (orchestrator: `decision propose --kind quota ...`)."""
    detail = (f"besoin P80 {needed:.1f} % de la fenêtre hebdomadaire, disponible {available:.1f} %"
              if needed is not None and available is not None else "fenêtre hebdomadaire épuisée")
    return {"kind": "quota", "title": f"Quota hebdomadaire insuffisant pour le plan ({detail})", "tasks": [],
            "options": [
                {"id": "extra-usage", "label": "J'achète de l'usage supplémentaire : continuer",
                 "consequence": "Les vagues reprennent normalement jusqu'à la remise à zéro hebdomadaire.",
                 "effects": [{"op": "quota-override", "mode": "extra-usage", "until_utc": None}]},
                {"id": "critical-only", "label": "Seulement le chemin critique",
                 "consequence": "Seules les tâches critiques sont lancées jusqu'à la remise à zéro hebdomadaire.",
                 "effects": [{"op": "quota-override", "mode": "critical-only", "until_utc": None}]},
                {"id": "wait", "label": "Attendre la remise à zéro hebdomadaire",
                 "consequence": "Aucune vague n'est lancée avant la remise à zéro.",
                 "effects": [{"op": "none"}]}],
            "recommended": None, "deadline_utc": _fmt(snap.seven_resets) if snap else None}


def decide(snap: Snapshot | None, now: datetime, profile: dict, projection: dict, *, override: dict | None,
           limit_evidence_utc: datetime | None) -> dict:
    """CLI.md quota rules 1-5. Returns {decision, pause_until_utc, reasons, rule, stale, proposal, override}."""
    q = (profile or {}).get("quota") or {}
    max_age = float(q.get("max_age_s", 900))
    critical_pct = float(q.get("five_hour_critical_only_pct", 85))
    reserve = float(q.get("weekly_reserve_pct", 10))
    active = override_active(override, now)
    extra = active is not None and active.get("mode") == "extra-usage"
    out: dict[str, Any] = {"decision": "normal", "pause_until_utc": None, "reasons": [], "rule": None,
                           "stale": False, "proposal": None, "override": active}

    def result(decision: str, rule: int, reason: str, until: datetime | None = None) -> dict:
        out.update({"decision": decision, "rule": rule, "pause_until_utc": _fmt(until)})
        out["reasons"].append(reason)
        return out

    # rule 1: limit evidence newer than the snapshot. The pause lasts until the five-hour resets_at ("launching
    # resumes on the first tick after pause_until_utc"): once that instant has passed the evidence is spent and the
    # later rules decide (a stale snapshot then gives unknown). Only the extra-usage case waits, open-ended, for a
    # snapshot newer than the evidence. A resets_at at or before the evidence belongs to an earlier window (the
    # snapshot predates the reset that the evidence followed): the window that was hit started at most five hours
    # before the evidence, so evidence + 5 h bounds its reset.
    if limit_evidence_utc is not None and (snap is None or limit_evidence_utc > snap.captured):
        if extra:
            return result("pause", 1, "usage-limit evidence newer than the snapshot; extra-usage override active: "
                                      "waiting for a newer snapshot")
        if snap is not None and snap.five_resets is not None and snap.five_resets > limit_evidence_utc:
            until = snap.five_resets
        else:
            until = limit_evidence_utc + timedelta(minutes=FIVE_HOUR_MIN)
        if now < until:
            return result("pause", 1, f"usage-limit evidence at {_fmt(limit_evidence_utc)} newer than the snapshot",
                          until)
        out["reasons"].append(f"usage-limit evidence at {_fmt(limit_evidence_utc)} expired at {_fmt(until)} "
                              "(five-hour reset passed)")
    # rule 2: five-hour window exhausted
    # (a resets_at already past means that window has reset: the snapshot is spent and the later rules decide)
    if snap is not None and snap.five_pct is not None and snap.five_pct >= 100 and \
            (snap.five_resets is None or now < snap.five_resets):
        if extra:
            return result("normal", 2, "five-hour window at 100 % with an active extra-usage override")
        return result("pause", 2, f"five-hour window at {snap.five_pct:g} %", snap.five_resets)
    # rule 3: stale or absent snapshot
    if snap is None:
        out["stale"] = True
        return result("unknown", 3, "no usage snapshot")
    age = (now - snap.captured).total_seconds()
    if age > max_age:
        out["stale"] = True
        return result("unknown", 3, f"snapshot {int(age)} s old (max {int(max_age)} s)")
    # rule 4: five-hour above the critical-only threshold, or a critical-only override
    if snap.five_pct is not None and snap.five_pct >= critical_pct and not extra:
        return result("critical-only", 4, f"five-hour window at {snap.five_pct:g} % >= {critical_pct:g} %")
    if active is not None and active.get("mode") == "critical-only":
        return result("critical-only", 4, f"critical-only override until {active.get('until_utc')}")
    # rule 5: the weekly window cannot cover the plan's P80 need plus the reserve
    needed = projection.get("weekly_pct_needed") if projection else None
    if snap.seven_pct is not None:
        available = 100.0 - snap.seven_pct - reserve
        short = snap.seven_pct >= 100 or (isinstance(needed, (int, float)) and float(needed) > available)
        if short:
            if extra:
                return result("normal", 5, "weekly window short of the plan's P80 need; extra-usage override active")
            out["proposal"] = quota_draft(snap, float(needed) if isinstance(needed, (int, float)) else None,
                                          available)
            return result("pause", 5, f"weekly window at {snap.seven_pct:g} % cannot cover the plan's P80 need "
                                      f"({needed if needed is not None else 'n/a'} %) plus the {reserve:g} % reserve",
                          snap.seven_resets)
    out["rule"] = None
    return out


def _is_evidence(doc: Any) -> bool:
    if not isinstance(doc, dict) or not isinstance(doc.get("ts"), str):
        return False
    data = doc.get("data") if isinstance(doc.get("data"), dict) else {}
    return (doc.get("type") == "stop.failure" and data.get("error") == "rate_limit") or \
        (doc.get("type") == "wave.ingested" and data.get("null_storm") is True)


def limit_evidence(layout: Any, local_state: Mapping | None) -> datetime | None:
    """The newest usage-limit evidence: a `stop.failure` event with error rate_limit (in events.jsonl, or still a
    file of local/hook-events/ that `status` has not imported yet: the very next `quota` must see it, TESTS.md
    H-SF-03), a `wave.ingested` event with null_storm true, or the instant already recorded in local state."""
    found: list[datetime] = []
    recorded = ((local_state or {}).get("quota") or {}).get("limit_evidence_utc")
    if isinstance(recorded, str):
        found.append(clock.parse_utc(recorded))
    if layout.events.exists():
        for _n, doc in jsonio.read_jsonl(layout.events):
            if _is_evidence(doc):
                found.append(clock.parse_utc(doc["ts"]).replace(microsecond=0))
    folder = layout.hook_events_dir
    if folder.is_dir():
        for path in sorted(folder.glob("*.json")):
            try:
                doc = jsonio.read_json_retry(path)
            except (ValidationFailed, FileNotFoundError) as err:
                # imported and deleted by a concurrent `status`, or half-written: the import reports it
                _LOG.debug("hook event skipped", extra={"data": {"path": path.as_posix(), "error": str(err)}})
                continue
            if _is_evidence(doc):
                found.append(clock.parse_utc(doc["ts"]).replace(microsecond=0))
    return max(found, default=None)


def projection_from(layout: Any, local_state: Mapping | None) -> dict:
    """{plan_agent_hours_p80 (local/schedule.json), pct_per_agent_hour (calibration), weekly_pct_needed}."""
    hours = None
    if layout.schedule_cache.exists():
        cache = jsonio.read_json_retry(layout.schedule_cache)
        value = ((cache or {}).get("quota_projection") or {}).get("agent_hours_p80") if isinstance(cache, dict) \
            else None
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            hours = float(value)
    pct = ((local_state or {}).get("calibration") or {}).get("pct_per_agent_hour")
    pct = float(pct) if isinstance(pct, (int, float)) and not isinstance(pct, bool) else None
    needed = round(hours * pct, 3) if hours is not None and pct is not None else None
    return {"plan_agent_hours_p80": hours, "pct_per_agent_hour": pct, "weekly_pct_needed": needed}


def _display(dt: datetime | None, profile: Mapping | None) -> dict | None:
    if dt is None:
        return None
    shown, _w = clock.display(dt, clock.zones_from_profile(dict(profile or {})))
    return {"utc": clock.format_utc(dt), **shown}


def _append_event(ctx: Ctx, type_: str, data: dict) -> dict:
    """One events.jsonl line in the format of events.append (Q-B03-1: no quota -> events edge in MODULES.md 8)."""
    locks = statusio.locks
    if not locks.is_held("state"):
        raise InternalError("quota: an event requires the state lock")
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


def cmd_quota(ctx: Ctx, args: Namespace) -> CommandResult:
    """CLI.md `quota`: exit 0 normal, critical-only or unknown; exit 1 pause."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    if not ctx.layout.local_state.exists():
        raise UsageError(f"no local state at {ctx.layout.local_state.as_posix()}", hint="run exec.py init first")
    profile: dict = {}
    if ctx.layout.profile.exists():
        profile = jsonio.read_json_retry(ctx.layout.profile)
    else:
        # before ingest: no snapshot location is known (never the real ~/.claude guessed); limit evidence still counts
        _LOG.warning("no profile: the snapshot path is unknown, decision from limit evidence only",
                     extra={"data": {"profile": ctx.layout.profile.as_posix()}})
    configured = ((profile.get("quota") or {}).get("snapshot_path")) if isinstance(profile, dict) else None
    snap_path = Path(configured) if isinstance(configured, str) and configured else None
    warnings: list[ErrorItem] = []
    try:
        snap = read_snapshot(snap_path) if snap_path is not None else None
    except ValidationFailed as err:
        _LOG.error("usage snapshot unreadable: treated as absent (decision unknown)",
                   extra={"data": {"path": snap_path.as_posix() if snap_path else None, "error": err.message}})
        snap = None
    with statusio.locks.hold(ctx.layout, "state", command=ctx.command):
        st = jsonio.read_json_retry(ctx.layout.local_state)
        if not isinstance(st, dict):
            raise ValidationFailed("local/state.json is not an object", code="E_STATE_INVALID")
        evidence = limit_evidence(ctx.layout, st)
        projection = projection_from(ctx.layout, st)
        override = (st.get("quota") or {}).get("override")
        result = decide(snap, ctx.now, profile, projection, override=override, limit_evidence_utc=evidence)
        if result["stale"]:
            warnings.append(ErrorItem("W_SNAPSHOT_STALE", result["reasons"][0],
                                      path=snap_path.as_posix() if snap_path is not None else None,
                                      hint="the statusline refreshes the snapshot while a session renders"))
        age = int((ctx.now - snap.captured).total_seconds()) if snap is not None else None
        st["quota"] = {
            "at_utc": clock.format_utc(ctx.now), "snapshot_age_s": age,
            "five_hour_pct": snap.five_pct if snap else None, "five_hour_resets_utc": _fmt(snap.five_resets) if snap
            else None, "seven_day_pct": snap.seven_pct if snap else None,
            "seven_day_resets_utc": _fmt(snap.seven_resets) if snap else None, "decision": result["decision"],
            "pause_until_utc": result["pause_until_utc"], "limit_evidence_utc": _fmt(evidence),
            "override": override if isinstance(override, dict) else None}
        report = statusio.schema.validate(st, "local-state")
        if not report.ok:
            items = [ErrorItem("E_STATE_INVALID", i.message, path=i.instance_path or "/") for i in report.issues[:20]]
            raise ValidationFailed("local/state.json would be invalid", code="E_STATE_INVALID", items=items)
        jsonio.write_json_atomic(ctx.layout.local_state, st)
        _append_event(ctx, "quota", {"decision": result["decision"], "rule": result["rule"],
                                     "pause_until_utc": result["pause_until_utc"], "snapshot_age_s": age,
                                     "five_hour_pct": snap.five_pct if snap else None,
                                     "seven_day_pct": snap.seven_pct if snap else None})
    data = {
        "snapshot_age_s": age,
        "five_hour": {"pct": snap.five_pct if snap else None,
                      "resets": _display(snap.five_resets if snap else None, profile)},
        "seven_day": {"pct": snap.seven_pct if snap else None,
                      "resets": _display(snap.seven_resets if snap else None, profile)},
        "decision": result["decision"], "pause_until_utc": result["pause_until_utc"],
        "override": result["override"], "reasons": result["reasons"], "rule": result["rule"],
        "limit_evidence_utc": _fmt(evidence), "projection": projection, "proposal": result["proposal"],
    }
    if result["decision"] == "pause":
        return CommandResult(data=data, warnings=warnings, exit_code=1,
                             errors=[ErrorItem("E_CHECK", "quota pause: " + "; ".join(result["reasons"]),
                                               hint="no launch before pause_until_utc"
                                               + ("; propose the quota decision in data.proposal"
                                                  if result["proposal"] else ""))])
    return CommandResult(data=data, warnings=warnings)
