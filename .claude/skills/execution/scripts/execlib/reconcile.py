"""Reconciliation and the state digest: `exec.py status` (contract/CLI.md `status`, MODULES.md 5 `reconcile.py`,
SCHEMAS.md 4.2-4.4, HOOKS.md 2.3, 4.4 and 7, TWO-DEV.md 3 TD-R1/TD-R2).

`status` is converging: it imports the hook-event files (one file per event, id = first 16 hex of the content's
sha256, deleted once appended), finalises merge intents whose head reached origin/main, resolves `launching` waves
older than 10 minutes with no run id, applies every transition whose evidence now exists, imports the hooks-state
stuck record, derives `run_state` and `flags.mainnet_open`, then writes the digest (`local/digest.txt`, at most
`--max-chars`, first line = this machine's absolute exec.py command) that the SessionStart hook prints. `status
--digest` does none of the writes.
"""
from __future__ import annotations

import json
import os
import re
from argparse import Namespace
from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Mapping

from . import clock, decisions, decisionsio, events, gitutil, jsonio, plan as planmod, results, state, status, \
    statusio
from .errors import GitError, PolicyRefused, TransitionRefused, UsageError, ValidationFailed
from .model import CommandResult, Ctx, PlanModel, Task
from .paths import exec_cmd, posix

RUNTIME_STATES = frozenset({"RUNNING", "AWAITING_HUMAN", "AWAITING_DECISION", "PAUSED_QUOTA", "PAUSED_RESOURCES",
                            "STUCK", "BUILD_COMPLETE"})
LAUNCHING_GRACE = timedelta(minutes=10)
HEARTBEAT_MAX_AGE = timedelta(days=7)
LIMIT_WINDOW = timedelta(hours=5)
_HOOK_FILE_RE = re.compile(r"^[0-9A-Za-z._-]+\.json$")
_ACTOR_HOOKS = ("stop-gate", "session-start", "session-end", "stop-failure", "pre-tool-guard", "user-prompt")


def state_lock(ctx: Ctx):  # noqa: ANN201 - a context manager (re-exported for replay and resume)
    return status.state_lock(ctx)


# --- hook events --------------------------------------------------------------------------------------------------

def _existing_ids(ctx: Ctx) -> set[str]:
    out: set[str] = set()
    for _n, doc in jsonio.read_jsonl(ctx.layout.events):
        if isinstance(doc, dict) and isinstance(doc.get("id"), str):
            out.add(doc["id"])
    return out


def import_hook_events(ctx: Ctx) -> int:
    """Import local/hook-events/*.json in name order into events.jsonl (state lock held). Each event keeps the
    hook's own timestamp; a file whose id is already in events.jsonl (a crash between append and delete) is only
    deleted. An unreadable or invalid file is renamed `<name>.invalid` and an `error` event names it."""
    folder = ctx.layout.hook_events_dir
    if not folder.is_dir():
        return 0
    known = _existing_ids(ctx)
    count = 0
    for path in sorted(p for p in folder.iterdir() if p.is_file() and _HOOK_FILE_RE.match(p.name)):
        raw = path.read_bytes()
        eid = jsonio.sha256_bytes(raw)[:16]
        if eid in known:
            os.remove(path)
            continue
        problem = ""
        doc: Any = None
        try:
            doc = json.loads(raw.decode("utf-8-sig"))
            problem = status.schema_problem(doc, "local-state#/$defs/hook_event") or ""
        except (UnicodeDecodeError, ValueError) as err:
            problem = f"not JSON: {err}"
        if problem:
            os.replace(path, path.with_name(path.name + ".invalid"))
            events.append(ctx, "error", {"kind": "hook-event-invalid", "file": path.name, "problem": problem[:200]})
            continue
        hook = doc["hook"] if doc["hook"] in _ACTOR_HOOKS else "pre-tool-guard"
        data = dict(doc.get("data") or {})
        data.setdefault("hook_ts", doc["ts"])
        if doc.get("agent_type"):
            data.setdefault("agent_type", doc["agent_type"])
        hctx = replace(ctx, now=clock.parse_utc(doc["ts"][:19] + "Z") if "." in doc["ts"] else
                       clock.parse_utc(doc["ts"]))
        prior = os.environ.get("CLAUDE_CODE_SESSION_ID")
        try:
            os.environ["CLAUDE_CODE_SESSION_ID"] = str(doc["session_id"])
            events.append(hctx, doc["type"], data, actor=f"hook:{hook}@{ctx.executor}", event_id=eid)
        finally:
            if prior is None:
                os.environ.pop("CLAUDE_CODE_SESSION_ID", None)
            else:
                os.environ["CLAUDE_CODE_SESSION_ID"] = prior
        known.add(eid)
        os.remove(path)
        count += 1
    return count


# --- waves --------------------------------------------------------------------------------------------------------

def manifests(ctx: Ctx) -> list[dict]:
    folder = ctx.layout.state / "waves"
    out: list[dict] = []
    if not folder.is_dir():
        return out
    for path in sorted(folder.glob("W*.json")):
        doc = status.manifest(ctx.layout, path.stem)
        if isinstance(doc, dict) and doc.get("executor") == ctx.executor:
            out.append(doc)
    return out


def wave_activity(ctx: Ctx, wave: str) -> list[str]:
    """Files under local/inbox/<wave>/ and local/results/<wave>/ (evidence that agents ran)."""
    found: list[str] = []
    for root in (ctx.layout.inbox(wave), ctx.layout.local / "results" / wave):
        if root.is_dir():
            found += [posix(p.relative_to(ctx.layout.state)) for p in sorted(root.rglob("*")) if p.is_file()]
    return found


def resolve_launching(ctx: Ctx, doc: dict, plan: PlanModel | None) -> list[dict]:
    """`launching` waves older than 10 minutes with no run id: no inbox or results activity → abandoned (tasks back
    to ready, never re-emitted); activity without a run → a `resources` decision. Returns {wave, action, ...}."""
    out: list[dict] = []
    for man in manifests(ctx):
        if man.get("status") != "launching" or man.get("launch"):
            continue
        since = man.get("launching_utc") or man.get("created_utc")
        if since and ctx.now - clock.parse_utc(str(since)) < LAUNCHING_GRACE:
            out.append({"wave": man["wave"], "action": "record-launch"})
            continue
        activity = wave_activity(ctx, man["wave"])
        tasks = [t["task"] for t in man.get("tasks") or ()]
        if activity:
            did, _dedup = decisions.propose(
                ctx, kind="resources",
                title=f"Vague {man['wave']} : des agents ont travaillé sans lancement enregistré",
                options=decisions.default_options("resources"), tasks=tasks, deadline=None, recommended="wait")
            out.append({"wave": man["wave"], "action": "decide", "decision": did, "activity": activity[:10]})
            continue
        man = dict(man)
        man["status"] = "abandoned"
        problem = status.schema_problem(man, "wave-manifest")
        if problem:
            raise ValidationFailed(f"waves/{man['wave']}.json invalid: {problem}", code="E_STATE_INVALID")
        jsonio.write_json_atomic(ctx.layout.wave_manifest(man["wave"]), man)
        moved: list[str] = []
        if plan is not None:
            for tid in tasks:
                task = plan.by_id.get(tid)
                if task is not None and status.current_status(doc, tid) == "running":
                    status.transition(ctx, doc, task, "ready", evidence=[f"abandoned:{man['wave']}"], plan=plan)
                    moved.append(tid)
        events.append(ctx, "wave.launch-failed", {"wave": man["wave"], "abandoned": True, "tasks": moved})
        out.append({"wave": man["wave"], "action": "abandon", "tasks": moved})
    return out


# --- reruns (SCHEMAS.md 4.4) --------------------------------------------------------------------------------------

def usage_limit_evidence(ctx: Ctx, local_state: Mapping[str, Any] | None, *, snapshot: bool = True
                         ) -> datetime | None:
    """The newest usage-limit evidence in the last five hours: a `stop.failure` rate_limit event, a null storm
    (`wave.ingested` with null_storm), or a recorded usage-limit hint; with `snapshot`, a five-hour reading at
    >= 95 % counts as now (the rerun cap of SCHEMAS.md 4.4; quota rule 1 uses the events only)."""
    evs, _errs = events.read_all(ctx.layout, since=ctx.now - LIMIT_WINDOW)
    newest: datetime | None = None
    for ev in evs:
        data = ev.get("data") or {}
        hit = (ev["type"] == "stop.failure" and data.get("error") == "rate_limit") or \
              (ev["type"] == "wave.ingested" and data.get("null_storm") is True) or \
              (ev["type"] == "error" and data.get("kind") == "usage-limit")
        if hit:
            at = clock.parse_utc(str(data.get("hook_ts", ev["ts"]))[:19] + "Z")
            newest = at if newest is None or at > newest else newest
    quota = (local_state or {}).get("quota") or {}
    pct = quota.get("five_hour_pct")
    if snapshot and isinstance(pct, (int, float)) and pct >= 95:
        newest = ctx.now if newest is None or ctx.now > newest else newest
    return newest


def apply_rerun(ctx: Ctx, doc: dict, task: Task, wave: str, plan: PlanModel,
                local_state: Mapping[str, Any] | None = None) -> str:
    """A null or missing agent result (state lock held): a rerun, never done. At the third consecutive rerun with
    no usage-limit evidence the task goes blocked-decision with a `retry-exhausted` proposal; with evidence it goes
    back to ready (and run_state becomes PAUSED_QUOTA at the next derivation). Returns the new status."""
    entry = status.entry_of(doc, task.id) or {}
    reaching_cap = int(entry.get("consecutive_reruns", 0)) + 1 >= status.RERUN_CAP
    if reaching_cap and usage_limit_evidence(ctx, local_state) is None:
        did, _d = decisions.propose(ctx, kind="retry-exhausted", title=f"{task.id} : relances épuisées",
                                    options=decisions.default_options("retry-exhausted"), tasks=[task.id],
                                    deadline=None, recommended="retry")
        status.transition(ctx, doc, task, "blocked-decision", evidence=[f"retry-exhausted:{wave}", f"decision:{did}"],
                          plan=plan)
        return "blocked-decision"
    status.transition(ctx, doc, task, "ready", evidence=[f"rerun:{wave}"], plan=plan)
    return "ready"


# --- transitions with evidence ------------------------------------------------------------------------------------

def _try(ctx: Ctx, doc: dict, task: Task, to: str, evidence: list[str], plan: PlanModel, git: gitutil.Git | None,
         applied: list[dict]) -> bool:
    before = status.current_status(doc, task.id)
    try:
        status.transition(ctx, doc, task, to, evidence=evidence, plan=plan, git=git)
    except TransitionRefused:
        return False
    applied.append({"task": task.id, "from": before, "to": to})
    return True


def _superseding(plan: PlanModel, task_id: str) -> str | None:
    for record in plan.raw.get("amendments") or ():
        if task_id in (record.get("superseded") or ()):
            return f"amendment:{record['plan_version']}:{record['decision']}"
    return None


def apply_evidence(ctx: Ctx, plan: PlanModel, doc: dict, git: gitutil.Git | None) -> list[dict]:
    """Every own-task transition whose evidence now exists (state lock held). Returns [{task, from, to}]."""
    applied: list[dict] = []
    own = ctx.executor
    for task in plan.tasks:
        if task.executor != own:
            continue
        cur = status.current_status(doc, task.id)
        sup = _superseding(plan, task.id)
        if sup and cur in status.NON_TERMINAL:
            _try(ctx, doc, task, "superseded", [sup], plan, git, applied)
            continue
        if cur == "planned" and plan.approved and task.anchor is None and task.template != "execution:EX-APPROVE":
            _try(ctx, doc, task, "ready", [], plan, git, applied)
            continue
        if task.kind in status.HUMAN_KINDS:
            if cur == "running":
                _try(ctx, doc, task, "done", [], plan, git, applied)
            continue
        if cur == "running" and _try(ctx, doc, task, "built", [], plan, git, applied):
            cur = "built"
        if cur == "built" and _try(ctx, doc, task, "verifying", [], plan, git, applied):
            cur = "verifying"
        if cur == "verifying":
            if not _try(ctx, doc, task, "done", [], plan, git, applied):
                _try(ctx, doc, task, "failed", [], plan, git, applied)
    return applied


def reassigned_out(ctx: Ctx, plan: PlanModel, doc: dict) -> list[str]:
    """TD-R2: entries of my status file whose plan executor is now the other one: a task.status event carrying
    attempts and reruns, then the entry is removed (state lock held)."""
    moved: list[str] = []
    for tid in sorted(list((doc.get("tasks") or {}).keys())):
        task = plan.by_id.get(tid)
        if task is None or task.executor == ctx.executor:
            continue
        entry = doc["tasks"].pop(tid)
        decision = next((r.get("decision") for r in reversed(plan.raw.get("amendments") or ())), "unknown")
        events.append(ctx, "task.status", {"task": tid, "from": entry["status"], "to": "planned",
                                           "evidence": [f"reassigned:{decision}", f"to:{task.executor}"],
                                           "attempts": entry.get("attempts", 0), "reruns": entry.get("reruns", 0)})
        moved.append(tid)
    return moved


# --- run state ----------------------------------------------------------------------------------------------------

def _heartbeat_armed(local_state: Mapping[str, Any], marker: Mapping[str, Any] | None, now: datetime) -> bool:
    hb = local_state.get("heartbeat") or {}
    if not hb.get("cron_id") or not hb.get("recorded_utc"):
        return False
    if marker is None or not marker.get("session_id") or hb.get("session_id") != marker.get("session_id"):
        return False
    return now - clock.parse_utc(str(hb["recorded_utc"])) < HEARTBEAT_MAX_AGE


def _live_waves(local_state: Mapping[str, Any], mans: list[dict]) -> list[dict]:
    live = [m for m in mans if m.get("status") in ("launching", "launched")]
    names = {m["wave"] for m in live}
    for w in local_state.get("waves") or ():
        if w.get("status") in ("launching", "launched") and w["wave"] not in names:
            live.append({"wave": w["wave"], "status": w["status"], "launch": {"run_id": w.get("run_id")},
                         "tasks": [{"task": t} for t in w.get("tasks") or ()]})
    return live


def build_complete(plan: PlanModel, doc: Mapping[str, Any], executor: str) -> bool:
    """A: the build-complete gate task (execution:EX-GATE-BUILD) of this executor is done; without one (dev B's
    share), every own task is terminal."""
    own = [t for t in plan.tasks if t.executor == executor]
    if not own:
        return False
    gates = [t for t in own if t.template == "execution:EX-GATE-BUILD"]
    if gates:
        return all(status.current_status(doc, g.id) == "done" for g in gates)
    return all(status.current_status(doc, t.id) in status.TERMINAL for t in own)


def quota_paused(local_state: Mapping[str, Any], limit_evidence: datetime | None, now: datetime) -> bool:
    quota = local_state.get("quota") or {}
    override = quota.get("override") or {}
    override_active = bool(override) and clock.parse_utc(str(override["until_utc"])) > now
    if limit_evidence is not None:
        captured = None
        if quota.get("at_utc") and isinstance(quota.get("snapshot_age_s"), int):
            captured = clock.parse_utc(str(quota["at_utc"])) - timedelta(seconds=int(quota["snapshot_age_s"]))
        resets = quota.get("five_hour_resets_utc")
        if (captured is None or limit_evidence > captured) and not (override_active and
                                                                    override.get("mode") == "extra-usage"):
            if resets is None or clock.parse_utc(str(resets)) > now:
                return True
    if quota.get("decision") == "pause":
        until = quota.get("pause_until_utc")
        return until is None or clock.parse_utc(str(until)) > now
    return False


def derive_run_state(plan: PlanModel | None, statuses: Mapping[str, dict], local_state: Mapping[str, Any],
                     hooks_state: Mapping[str, Any], *, now: datetime | None = None, open_decisions: int = 0,
                     limit_evidence: datetime | None = None, mans: list[dict] | None = None) -> str:
    """The run state from the documents: set-up and terminal states are kept; a stuck record → STUCK;
    the build gate done → BUILD_COMPLETE; limit evidence or a quota pause → PAUSED_QUOTA; a governor pause →
    PAUSED_RESOURCES; something launchable or running → RUNNING; else waiting on a decision or a human.
    The MODULES.md signature (plan, statuses, local_state, hooks_state) works as is; the keyword arguments are
    additive: `now` defaults to clock.utcnow(), the others to "nothing known"."""
    if now is None:
        now = clock.utcnow()
    cur = str(local_state.get("run_state"))
    if cur not in RUNTIME_STATES:
        return cur
    if local_state.get("stuck") or (hooks_state.get("stuck") and cur == "STUCK"):
        return "STUCK"
    executor = str(local_state.get("executor"))
    doc = statuses.get(executor) or {}
    if plan is None:
        return cur
    if build_complete(plan, doc, executor):
        return "BUILD_COMPLETE"
    if quota_paused(local_state, limit_evidence, now):
        return "PAUSED_QUOTA"
    gov = (local_state.get("governor") or {}).get("decision") or {}
    if gov.get("pause"):
        return "PAUSED_RESOURCES"
    if _live_waves(local_state, mans or []):
        return "RUNNING"
    own = [t for t in plan.tasks if t.executor == executor]
    if any(t.kind not in status.HUMAN_KINDS and status.current_status(doc, t.id) in ("ready", "built", "verifying")
           for t in own):
        return "RUNNING"
    if open_decisions or any(t.kind == "decision" and status.current_status(doc, t.id) == "running" for t in own):
        return "AWAITING_DECISION"
    if any(t.kind == "manual" and status.current_status(doc, t.id) == "running" for t in own):
        return "AWAITING_HUMAN"
    return "RUNNING"


def move_run_state(ctx: Ctx, st: dict, target: str, reason: str) -> bool:
    """Move run_state to `target`, through RUNNING when the table has no direct edge (RUN_TRANSITIONS lists the
    waiting states only as RUNNING ⇄ X, contract question Q-B01-2). False when no path exists."""
    cur = st.get("run_state")
    if cur == target:
        return True
    table = state.RUN_TRANSITIONS
    if target in table.get(str(cur), frozenset()):
        state.set_run_state(ctx, st, target, reason)
        return True
    if "RUNNING" in table.get(str(cur), frozenset()) and target in table["RUNNING"]:
        state.set_run_state(ctx, st, "RUNNING", f"{reason} (via RUNNING)")
        state.set_run_state(ctx, st, target, reason)
        return True
    ctx.log.warning("run state not moved: no path", extra={"data": {"from": cur, "to": target}})
    return False


def _later_stop_event(ctx: Ctx, session: str | None, after: datetime) -> bool:
    evs, _e = events.read_all(ctx.layout)
    for ev in evs:
        if not ev["type"].startswith("stop.") or ev["type"] == "stop.failure":
            continue
        if session and ev.get("session_id") != session:
            continue
        at = clock.parse_utc(str((ev.get("data") or {}).get("hook_ts", ev["ts"]))[:19] + "Z")
        if at > after:
            return True
    return False


def import_stuck(ctx: Ctx, st: dict, marker: Mapping[str, Any] | None) -> dict | None:
    """The hooks-state stuck record → local state (HOOKS.md 4.4, 7): a stop-failure record superseded by a later
    stop.* event of the same session is dropped. hooks-state.stuck is cleared once read (CLI.md status; contract
    question Q-B04-4 on SCHEMAS.md 5.1). Returns the imported record, or None."""
    hs = state.read_hooks_state(ctx.layout)
    rec = hs.get("stuck")
    if not rec:
        return None
    imported: dict | None = None
    at = clock.parse_utc(str(rec["at_utc"]))
    session = (marker or {}).get("session_id")
    if rec.get("source") == "stop-failure" and _later_stop_event(ctx, session, at):
        ctx.log.info("stop-failure stuck record dropped: the turn went on", extra={"data": {"at_utc": rec["at_utc"]}})
    else:
        imported = {"at_utc": rec["at_utc"], "reason": str(rec.get("reason", "stuck")), "source": rec["source"]}
        st["stuck"] = imported
    fresh = state.read_hooks_state(ctx.layout)
    if fresh.get("stuck") == rec:
        fresh["stuck"] = None
        jsonio.write_json_atomic(ctx.layout.hooks_state, fresh)
    return imported


def mainnet_open(plan: PlanModel | None, policy: Mapping[str, Any] | None, doc: Mapping[str, Any]) -> bool:
    mainnet = ((policy or {}).get("networks") or {}).get("mainnet") or {}
    if mainnet.get("mode") != "after-setup" or plan is None:
        return False
    setup = mainnet.get("setup_task")
    return bool(setup) and status.current_status(doc, str(setup)) == "done"


# --- rebuild helpers (used by replay, whose MODULES.md 8 edges reach the documents through this module) ------------

def load_plan(layout: Any) -> PlanModel | None:
    return planmod.load(layout) if layout.plan.exists() else None


def awaiting_from_files(ctx: Ctx, plan_tasks: Mapping[str, Task]) -> list[dict]:
    """local/state.json `awaiting` rebuilt from the status file (posted human tasks still running) and the open
    proposals of this executor's decision range."""
    out: list[dict] = []
    doc = statusio.load(ctx.layout, str(ctx.executor))
    for tid, entry in sorted((doc.get("tasks") or {}).items()):
        task = plan_tasks.get(tid)
        if task is None or task.kind not in status.HUMAN_KINDS or entry.get("status") != "running":
            continue
        posted = entry.get("posted") or {}
        out.append({"kind": "decision" if task.kind == "decision" else "manual", "ref": tid,
                    "since_utc": posted.get("at_utc") or entry["since_utc"],
                    "latest_utc": (task.manual or {}).get("latest_start_utc")})
    for prop in decisionsio.open_proposals(ctx.layout):
        if decisions.executor_of_decision(prop["id"]) == ctx.executor:
            out.append({"kind": "decision", "ref": prop["id"], "since_utc": prop["at_utc"],
                        "latest_utc": prop.get("deadline_utc")})
    return sorted(out, key=lambda a: a["ref"])


def quota_override_from_events(ctx: Ctx, evs: list[dict]) -> dict | None:
    """The newest quota override a resolved decision applied (its `quota` event), or None."""
    newest = None
    for ev in evs:
        data = ev.get("data") or {}
        if ev["type"] == "quota" and ev.get("executor") == ctx.executor and isinstance(data.get("override"), dict):
            newest = data["override"]
    if newest is None:
        return None
    _proposal, resolution = decisionsio.find(ctx.layout, str(newest.get("decision")))
    return dict(newest) if resolution is not None else None


# --- digest -------------------------------------------------------------------------------------------------------

def _hook_errors_since(ctx: Ctx, since: str | None) -> int:
    path = ctx.layout.hook_errors
    if not path.exists():
        return 0
    floor = clock.parse_utc(since) if since else None
    count = 0
    for line in path.read_bytes().decode("utf-8", errors="replace").splitlines():
        try:
            ts = str(json.loads(line).get("ts", ""))
            at = clock.parse_utc(ts[:19] + "Z")
        except Exception:  # noqa: BLE001 - a torn log line still counts as an error
            count += 1
            continue
        if floor is None or at > floor:
            count += 1
    return count


DIGEST_WARNINGS = 6        # warning lines shown in the digest; the full list is data.warnings
DIGEST_WARNING_CHARS = 240


def digest_text(ctx: Ctx, data: Mapping[str, Any], max_chars: int) -> str:
    """Plain English, at most max_chars, first line = this machine's absolute exec.py command. The warnings of this
    tick (a failed decision-effect try, a parked one, a failed fetch) come right after the counts, so a short
    digest still shows them."""
    lines = [str(data.get("exec_cmd") or exec_cmd())]
    lines.append(f"run_state {data['run_state']} since {data.get('since')}; plan v{data.get('plan_version')} "
                 f"{'approved' if data.get('approved') else 'not approved'}; clock {data.get('clock')}")
    counts = data.get("counts") or {}
    if counts:
        lines.append("tasks: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    if data.get("stuck"):
        lines.append(f"STUCK: {data['stuck'].get('reason')} ({data['stuck'].get('source')}) — alert the owner")
    warnings = [str(w) for w in data.get("warnings") or ()]
    for w in warnings[:DIGEST_WARNINGS]:
        clipped = w if len(w) <= DIGEST_WARNING_CHARS else w[: DIGEST_WARNING_CHARS - 1].rstrip() + "…"
        lines.append(f"warning: {clipped}")
    if len(warnings) > DIGEST_WARNINGS:
        lines.append(f"warning: {len(warnings) - DIGEST_WARNINGS} more in data.warnings")
    for w in data.get("running_waves") or ():
        lines.append(f"wave {w['wave']} {w.get('status', 'launched')} run {w.get('run_id')}: "
                     + ", ".join(w.get("tasks") or []))
    if data.get("finished_waves_not_ingested"):
        lines.append("finished, not ingested: " + ", ".join(data["finished_waves_not_ingested"]))
    for a in (data.get("awaiting") or [])[:8]:
        lines.append(f"awaiting {a['kind']} {a['ref']} since {a['since']}, latest {a.get('latest')}")
    if data.get("ready_next"):
        lines.append("ready next: " + ", ".join(data["ready_next"][:12]))
    hooks = data.get("hooks") or {}
    if hooks.get("errors_since_tick"):
        lines.append(f"hooks: {hooks['errors_since_tick']} internal errors since the last tick")
    if not hooks.get("bound"):
        lines.append("hooks: not bound to a session (run hooks canary)")
    for i, action in enumerate(data.get("next_actions") or (), start=1):
        lines.append(f"next {i}: {action}")
    text = "\n".join(lines)
    if len(text) > max_chars:
        text = text[: max(0, max_chars - 1)].rstrip() + "…"
    return text


def _next_actions(run_state: str, data: Mapping[str, Any], cmd: str) -> list[str]:
    out: list[str] = []
    if data.get("stuck"):
        out.append("push the owner the STUCK alert, then resume what can run")
    for w in data.get("finished_waves_not_ingested") or ():
        out.append(f"{cmd} wave ingest --wave {w} --finished")
    if data.get("awaiting"):
        out.append("check the owner's answers (Notion poll or messages): answers ingest / decision resolve")
    if run_state == "RUNNING" and data.get("ready_next"):
        out.append(f"{cmd} schedule, then {cmd} wave emit")
    if data.get("ready_human"):
        out.append(f"{cmd} manual post --all-ready")
    if run_state in ("PAUSED_QUOTA", "PAUSED_RESOURCES"):
        out.append(f"{cmd} quota and {cmd} governor; launch nothing until the pause lifts")
    if run_state == "BUILD_COMPLETE":
        out.append(f"{cmd} completion run --phase build, {cmd} harden-ready, then {cmd} handover")
    out.append("arm the heartbeat if it is not (heartbeat plan + CronCreate) before ending the turn")
    return out


def _read_optional(path: Path) -> Any | None:
    if not path.exists():
        return None
    return jsonio.read_json_retry(path)


def collect(ctx: Ctx, *, plan: PlanModel | None, statuses: Mapping[str, dict], st: Mapping[str, Any] | None,
            marker: Mapping[str, Any] | None, max_chars: int, warnings: list[str] | None = None) -> dict:
    """The data of CLI.md `status` (read-only). `warnings`: the lines of this tick's reconciliation (one per failed
    decision-effect try, contract revision 3), shown as data.warnings and in the digest."""
    executor = str(ctx.executor)
    doc = statuses.get(executor) or {}
    counts: dict[str, int] = {}
    ready_next: list[str] = []
    ready_human: list[str] = []
    if plan is not None:
        for task in plan.tasks:
            if task.executor != executor:
                continue
            s = status.current_status(doc, task.id)
            counts[s] = counts.get(s, 0) + 1
            if s == "ready":
                (ready_human if task.kind in status.HUMAN_KINDS else ready_next).append(task.id)
    mans = manifests(ctx)
    local = dict(st or {})
    live = _live_waves(local, mans)
    running = [{"wave": m["wave"], "status": m.get("status"), "run_id": (m.get("launch") or {}).get("run_id"),
                "launched": (m.get("launch") or {}).get("at_utc"),
                "tasks": [t["task"] for t in m.get("tasks") or ()]} for m in live]
    finished = sorted({m["wave"] for m in mans if m.get("status") == "finished"}
                      | {w["wave"] for w in local.get("waves") or () if w.get("status") == "finished"})
    awaiting = [{"ref": a["ref"], "kind": a["kind"], "since": a["since_utc"], "latest": a.get("latest_utc")}
                for a in local.get("awaiting") or ()]
    due = [{"task": a["ref"], "kind": "latest-start", "at": a["latest"],
            "overdue_min": round(clock.minutes_between(clock.parse_utc(a["latest"]), ctx.now), 1)}
           for a in awaiting if a.get("latest") and clock.parse_utc(a["latest"]) < ctx.now]
    hs = state.read_hooks_state(ctx.layout)
    hooks_local = local.get("hooks") or {}
    notion = local.get("notion") or {}
    run_state = str(local.get("run_state") or "INIT")
    data: dict[str, Any] = {
        "run_state": run_state, "since": local.get("run_state_since_utc"),
        "plan_version": plan.version if plan else 0, "approved": bool(plan and plan.approved),
        "exec_cmd": exec_cmd(), "clock": "override" if clock.is_overridden() else "system",
        "counts": dict(sorted(counts.items())), "running_waves": running, "finished_waves_not_ingested": finished,
        "awaiting": awaiting, "ready_next": ready_next, "ready_human": ready_human, "due": due,
        "governor": local.get("governor"), "quota": local.get("quota"), "stuck": local.get("stuck"),
        "notion": {"outbox": int(notion.get("outbox_count", 0)), "pending_batches": list(notion.get("pending_batches")
                                                                                          or []),
                   "last_ok": notion.get("last_ok_utc")},
        "hooks": {"bound": bool((marker or {}).get("session_id")), "canary_ok_utc": hooks_local.get("canary_ok_utc"),
                  "last_stop_utc": hs.get("last_stop_utc"),
                  "errors_since_tick": _hook_errors_since(ctx, local.get("last_tick_utc")),
                  "agent_role_source": hooks_local.get("agent_role_source"),
                  "agent_session_scoped": bool(hooks_local.get("agent_session_scoped"))},
        "warnings": [str(w) for w in warnings or ()],
    }
    data["next_actions"] = _next_actions(run_state, data, exec_cmd())
    data["digest_text"] = digest_text(ctx, data, max_chars)
    return data


def reconcile(ctx: Ctx, plan: PlanModel | None, statuses: dict[str, dict]) -> dict:
    """The converging half of `status` (state lock held). Returns a summary of what was applied."""
    state.load(ctx.layout)  # UsageError before `exec.py init`
    marker = state.read_active(ctx.layout)
    summary: dict[str, Any] = {"hook_events": import_hook_events(ctx), "intents": [], "waves": [], "applied": [],
                               "reassigned": [], "stuck": None, "warnings": [], "decisions_completed": []}
    if decisions.pending_intents(ctx.layout):
        summary["decisions_completed"] = decisions.complete_pending(ctx)
        for d in summary["decisions_completed"]:
            if d["action"] == "failed":
                summary["warnings"].append(f"decision {d['id']}: effects not re-applied ({d['code']}, try "
                                           f"{d['attempts']}/{decisions.MAX_EFFECT_ATTEMPTS}): {d['message']}")
            elif d["action"] == "parked":
                summary["warnings"].append(f"decision {d['id']}: effects failed {d['attempts']} times ({d['code']}): "
                                           f"{d['message']}; decision {d['decision']} asks to retry or drop them")
            elif d["action"] == "waiting":
                summary["warnings"].append(f"decision {d['id']}: effects parked until decision {d['decision']} is "
                                           "resolved")
        plan = load_plan(ctx.layout)  # an approve-plan effect may have changed it
        statuses = statusio.load_all(ctx.layout)
    git = status.product_git(ctx.layout)
    if git is not None:
        try:
            git.fetch()
        except GitError as err:
            summary["warnings"].append(f"git fetch failed: {err.message}")
            git = None
    if git is not None:
        summary["intents"] = results.finalize_merge_intents(ctx, git)
    doc = statusio.load(ctx.layout, str(ctx.executor))
    if plan is not None:
        summary["waves"] = resolve_launching(ctx, doc, plan)
        summary["reassigned"] = reassigned_out(ctx, plan, doc)
        summary["applied"] = apply_evidence(ctx, plan, doc, git)
        if summary["applied"] or summary["reassigned"] or any(w["action"] == "abandon" for w in summary["waves"]):
            doc["plan_version"] = plan.version
            statusio.save(ctx, doc)
    statuses = dict(statuses)
    statuses[str(ctx.executor)] = statusio.load(ctx.layout, str(ctx.executor))
    st = state.load(ctx.layout)  # reload: transitions and proposals above wrote events and local state
    previous_stuck = st.get("stuck")
    new_stuck = import_stuck(ctx, st, marker)
    summary["stuck"] = new_stuck
    if previous_stuck and not new_stuck and (_heartbeat_armed(st, marker, ctx.now)
                                              or _live_waves(st, manifests(ctx))):
        st["stuck"] = None
    evidence = usage_limit_evidence(ctx, st, snapshot=False)
    if evidence is not None and st.get("quota"):
        st["quota"]["limit_evidence_utc"] = clock.format_utc(evidence)
    own_open = [p for p in decisionsio.open_proposals(ctx.layout)
                if decisions.executor_of_decision(p["id"]) == ctx.executor]
    target = derive_run_state(plan, statuses, st, state.read_hooks_state(ctx.layout), now=ctx.now,
                              open_decisions=len(own_open), limit_evidence=evidence, mans=manifests(ctx))
    if st.get("stuck"):
        target = "STUCK"
    if target != st.get("run_state") and st.get("run_state") in RUNTIME_STATES:
        reason = (st.get("stuck") or {}).get("reason") if target == "STUCK" else f"derived by status ({target})"
        move_run_state(ctx, st, target, str(reason or "derived by status"))
    policy = _read_optional(ctx.layout.policy)
    st.setdefault("flags", {"mainnet_open": False, "push_frozen": False})
    st["flags"]["mainnet_open"] = mainnet_open(plan, policy, statuses[str(ctx.executor)])
    freeze = (((policy or {}).get("git") or {}).get("push_freeze_utc"))
    st["flags"]["push_frozen"] = bool(freeze) and ctx.now >= clock.parse_utc(str(freeze))
    if plan is not None and plan.approved:
        st["plan_sha256"] = planmod.plan_digest(plan.raw)
    summary["previous_tick_utc"] = st.get("last_tick_utc")
    st["last_tick_utc"] = clock.format_utc(ctx.now)
    state.save(ctx, st)
    return summary


def run_status(ctx: Ctx, max_chars: int = 2000, *, digest_only: bool = False) -> dict:
    """`status` as a function (resume R8 calls it)."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    plan = planmod.load(ctx.layout) if ctx.layout.plan.exists() else None
    statuses = statusio.load_all(ctx.layout)
    if digest_only:
        st = state.load(ctx.layout) if ctx.layout.local_state.exists() else None
        marker = state.read_active(ctx.layout)
        data = collect(ctx, plan=plan, statuses=statuses, st=st, marker=marker, max_chars=max_chars)
        data["reconciled"] = None
        return data
    # A resolution left half-applied that approves the plan needs the plan lock, taken before `state` (LOCK_ORDER).
    plan_guard = status.plan_lock(ctx) if decisions.pending_needs_plan_lock(ctx.layout) else nullcontext()
    with plan_guard, status.state_lock(ctx):
        summary = reconcile(ctx, plan, statuses)
        plan = planmod.load(ctx.layout) if ctx.layout.plan.exists() else None
        statuses = statusio.load_all(ctx.layout)
        st = state.load(ctx.layout)
        st_for_digest = dict(st)
        st_for_digest["last_tick_utc"] = summary.get("previous_tick_utc")
        marker = state.read_active(ctx.layout)
        # contract revision 3 (Q-B04 m3): a failed decision effect never fails `status` (exit 0), and every failed
        # try is one line of data.warnings and of the digest (local/digest.txt included)
        data = collect(ctx, plan=plan, statuses=statuses, st=st_for_digest, marker=marker, max_chars=max_chars,
                       warnings=list(summary["warnings"]))
        data["reconciled"] = {k: v for k, v in summary.items() if k != "previous_tick_utc"}
        jsonio.write_text_atomic(ctx.layout.digest, data["digest_text"])
    return data


def cmd_status(ctx: Ctx, args: Namespace) -> CommandResult:
    """`status [--digest] [--max-chars N]`."""
    max_chars = int(args.max_chars)
    if max_chars < 200:
        raise UsageError("--max-chars must be at least 200")
    if not args.digest and ctx.by != "orchestrator":
        raise PolicyRefused("only `status --digest` is allowed to agents (SCHEMAS.md 5.3)", code="E_POLICY")
    return CommandResult(data=run_status(ctx, max_chars, digest_only=bool(args.digest)))
