"""Event replay and the local-state rebuild (contract/MODULES.md 5 `replay.py`, CLI.md `events replay`,
SCHEMAS.md 8 "local state").

local/state.json is a cache. `events replay --rebuild-state` rebuilds `waves`, `awaiting`, `flags`, `run_state`,
`calibration`, `events_seq` and the quota override from events.jsonl, the status files, the wave manifests, the
receipts and decisions.md. What no repository file records (the Notion page map, the heartbeat record, the hooks
record, the settings backup, the latest governor and quota readings) is kept from the existing cache when there is
one, else left at its default (the Notion map is rebuilt by one board query, NOTION.md 11.4).
"""
from __future__ import annotations

import copy
from argparse import Namespace
from dataclasses import replace
from typing import Any

from . import clock, events, jsonio, reconcile, state, statusio
from .errors import ErrorItem, UsageError
from .model import CommandResult, Ctx
from .paths import Layout

REBUILT_FIELDS: tuple[str, ...] = ("run_state", "waves", "awaiting", "flags", "calibration", "events_seq",
                                   "plan_sha256")


def _project(layout: Layout, existing: dict | None) -> str:
    if existing and existing.get("project"):
        return str(existing["project"])
    for path in (layout.active, layout.plan):
        if path.exists():
            doc = jsonio.read_json(path)
            if isinstance(doc, dict) and doc.get("project"):
                return str(doc["project"])
    if layout.profile.exists():
        prof = jsonio.read_json(layout.profile)
        slug = ((prof or {}).get("project") or {}).get("slug")
        if slug:
            return str(slug)
    raise UsageError("cannot tell the project slug: no local state, marker, plan or profile")


def _waves(ctx: Ctx, evs: list[dict], existing: dict | None) -> list[dict]:
    launched = {}
    for ev in evs:
        if ev["type"] == "wave.launched" and ev.get("executor") == ctx.executor:
            launched[ev["data"]["wave"]] = ev
    old = {w["wave"]: w for w in (existing or {}).get("waves") or ()}
    out: list[dict] = []
    for man in reconcile.manifests(ctx):
        launch = man.get("launch") or {}
        ev = launched.get(man["wave"])
        status_ = man.get("status")
        if old.get(man["wave"], {}).get("status") == "finished" and status_ == "launched":
            status_ = "finished"
        entry = {"wave": man["wave"], "status": status_,
                 "manifest": f"waves/{man['wave']}.json", "run_id": launch.get("run_id"),
                 "transcript_dir": launch.get("transcript_dir"),
                 "session_id": (ev or {}).get("session_id") or old.get(man["wave"], {}).get("session_id"),
                 "launched_utc": launch.get("at_utc"), "finished_utc": old.get(man["wave"], {}).get("finished_utc"),
                 "tasks": [t["task"] for t in man.get("tasks") or ()]}
        out.append(entry)
    return sorted(out, key=lambda w: int(w["wave"][1:]))


def rebuild_local_state(ctx: Ctx) -> dict:
    """Rewrite local/state.json from the repository's files (state lock held). Returns {rebuilt, diff, events}."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor")
    layout = ctx.layout
    existing = state.load(layout) if layout.local_state.exists() else None
    evs, _errors = events.read_all(layout)
    base = copy.deepcopy(existing) if existing else state.default(str(ctx.executor), _project(layout, existing),
                                                                  ctx.now)
    new = copy.deepcopy(base)
    plan = reconcile.load_plan(layout)
    plan_tasks = dict(plan.by_id) if plan else {}
    new["waves"] = _waves(ctx, evs, existing)
    new["awaiting"] = reconcile.awaiting_from_files(ctx, plan_tasks)
    run_states = [ev for ev in evs if ev["type"] == "run.state" and ev.get("executor") == ctx.executor]
    if run_states:
        last = run_states[-1]
        new["run_state"] = last["data"]["to"]
        new["previous_run_state"] = last["data"].get("from")
        new["run_state_since_utc"] = clock.format_utc(clock.parse_utc(last["ts"][:19] + "Z"))
    seqs = [ev["seq"] for ev in evs if ev.get("executor") == ctx.executor and isinstance(ev.get("seq"), int)]
    new["events_seq"] = max(seqs) if seqs else int(new.get("events_seq", 0))
    for ev in evs:
        if ev["type"] == "wave.ingested" and ev.get("executor") == ctx.executor:
            cal = ev["data"].get("calibration")
            if isinstance(cal, dict) and {"ratios", "samples", "pct_per_agent_hour"} <= set(cal):
                new["calibration"] = cal
    policy = jsonio.read_json(layout.policy) if layout.policy.exists() else None
    doc = statusio.load(layout, str(ctx.executor))
    new["flags"] = {"mainnet_open": reconcile.mainnet_open(plan, policy, doc),
                    "push_frozen": bool(((policy or {}).get("git") or {}).get("push_freeze_utc"))
                    and ctx.now >= clock.parse_utc(str(policy["git"]["push_freeze_utc"]))}
    if plan is not None and plan.approved:
        new["plan_sha256"] = plan.raw["approved"]["plan_sha256"] if not plan.raw.get("amendments") else \
            plan.raw["amendments"][-1]["plan_sha256_after"]
    override = reconcile.quota_override_from_events(ctx, evs)
    if override is not None:
        quota = new.get("quota") or {"at_utc": clock.format_utc(ctx.now), "snapshot_age_s": None,
                                     "five_hour_pct": None, "five_hour_resets_utc": None, "seven_day_pct": None,
                                     "seven_day_resets_utc": None, "decision": "unknown", "pause_until_utc": None,
                                     "limit_evidence_utc": None, "override": None}
        quota["override"] = override
        new["quota"] = quota
    elif new.get("quota"):
        new["quota"]["override"] = None
    diff = {k: [base.get(k), new.get(k)] for k in sorted(set(REBUILT_FIELDS) | {"quota", "previous_run_state"})
            if base.get(k) != new.get(k)}
    state.save(ctx, new)
    events.append(ctx, "resume", {"rebuild_state": True, "fields": sorted(diff)})
    return {"rebuilt": True, "diff": diff, "events": len(evs)}


def _duplicates(layout: Layout) -> int:
    seen: set[str] = set()
    dup = 0
    for _n, doc in jsonio.read_jsonl(layout.events):
        if isinstance(doc, dict) and isinstance(doc.get("id"), str):
            if doc["id"] in seen:
                dup += 1
            seen.add(doc["id"])
    return dup


def cmd_replay(ctx: Ctx, args: Namespace) -> CommandResult:
    """`events replay [--since ISO] [--rebuild-state]`."""
    since = clock.parse_utc(args.since) if args.since else None
    evs, errors = events.read_all(ctx.layout, since=since)
    invalid = [{"line": e.path or "", "code": e.code} for e in errors]
    data: dict[str, Any] = {"events": len(evs), "invalid": invalid, "duplicates": _duplicates(ctx.layout),
                            "rebuilt": False, "diff": {}}
    if args.rebuild_state:
        if ctx.executor not in ("A", "B"):
            # local/state.json is gone (that is why one rebuilds): the marker still names the executor
            marker = state.read_active(ctx.layout)
            if marker is not None:
                ctx = replace(ctx, executor=marker["executor"])
        with reconcile.state_lock(ctx):
            out = rebuild_local_state(ctx)
        data["rebuilt"] = True
        data["diff"] = out["diff"]
    if invalid:
        return CommandResult(data=data, exit_code=1,
                             errors=[ErrorItem("E_EVENT_INVALID", f"{len(invalid)} invalid events.jsonl line(s)",
                                               path=invalid[0]["line"])])
    return CommandResult(data=data)
