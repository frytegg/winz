"""Waves: selection, manifest, script and briefs (`wave emit`), launch bookkeeping (`wave launched`), closing a wave
(`wave ingest`) and the planner workflow (`plan emit`). Contract: CLI.md 2 and 4, WAVES.md, SCHEMAS.md 4.2 and 7.4,
MODULES.md 5 (`wave.py`) and 7, FRONTEND.md 3, 9 and 11.

Emit is final: under the state lock it allocates the wave id (O_EXCL on `waves/Wnn.json`), renders and checks the
script (forbidden tokens in code, node syntax) and the briefs, writes the manifest with status `launching`, records
gate merge receipts, and moves the selected tasks to `running` (evidence `launch-intent:Wnn`); the orchestrator calls
Workflow right after. Selection treats every `launching` or `launched` wave of this executor as live: its tasks are
never selected again and its lanes, writes, resources and slots are occupied (SCHEMAS.md 7.4).

Ingest re-reads every fact from files (results and merge receipts of the task's attempt in any wave, proof runs,
receipts); the script's returned outcomes are a hint used only for `skipped-dep` and `infra-error`, which leave no
file. It converges: a second ingest of the same wave writes nothing. DX and claims rows are keyed by a trailing HTML
comment, calibration is recomputed from the full set of done tasks each time.

Deviations and contract questions are listed in the lane report (scratchpad build/B05.build.md); the main ones are
marked `Q-B05-n` below.
"""
from __future__ import annotations

import copy
import json
import math
import os
import re
import tempfile
from argparse import Namespace
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import (briefs, clock, decisions, events, graph as graphmod, jsonio, plan as planmod, reconcile, results,
               schedule, state, status, statusio, wavejs)
from .errors import (CheckFailed, DependencyMissing, EnvError, ErrorItem, ImmutableFile, InternalError,
                     PolicyRefused, UsageError, ValidationFailed)
from .log import get_logger, redact
from .model import CommandResult, Ctx, PlanModel, Task
from .paths import SKILL_DIR, Layout, exec_cmd, other_skill, posix

_LOG = get_logger("execlib.wave")

RANGES: Mapping[str, tuple[int, int]] = {"A": (1, 499), "B": (500, 999)}
LIVE: frozenset[str] = frozenset({"launching", "launched"})
AGENT_RESULT_ROLES: tuple[str, ...] = ("implementer", "test-designer", "verifier", "reviewer")
FIX_CHAIN_STARTS: frozenset[str] = frozenset({"implementer", "test-designer"})
PHASES: Mapping[str, str] = {"implementer": "Implement", "test-designer": "Implement", "integrator": "Integrate",
                             "verifier": "Verify", "reviewer": "Review"}
SCHEMA_OF: Mapping[str, str] = {"implementer": "result-implementer", "test-designer": "result-test-designer",
                                "integrator": "merge-result", "verifier": "result-verifier",
                                "reviewer": "result-reviewer"}
MODEL_RANK: Mapping[str, int] = {"haiku": 0, "sonnet": 1, "opus": 2}
EFFORT_RANK: Mapping[str, int] = {"low": 0, "medium": 1, "high": 2, "xhigh": 3}
DEFAULT_WAVE_P80_MIN = 90.0         # CLI.md wave emit: "what fits the P80 of about 60-90 min of wave time"
VERIFY_P50_MIN = 6.7                # assets/reference-class.json verify p50
Z80 = 0.8416                        # standard normal quantile at 0.80
OUTCOMES: tuple[str, ...] = ("done", "failed", "rerun", "blocked-manual", "blocked-decision", "built", "verifying",
                             "skipped-dep", "infra-error", "recorded")
_INBOX_RESULT_RE = re.compile(r"^(T[0-9]{3,})\.(implementer|verifier|test-designer|reviewer)\.a([0-9]+)\.json$")
_WAVE_RE = re.compile(r"^W([0-9]{2,3})$")
FE_ROLE_AGENTS: Mapping[str, dict] = {
    "critic": {"agentType": "frontend-critic", "model": "opus", "effort": "high"},
    "probe": {"agentType": "frontend-probe", "model": "opus", "effort": "high"},
    "implementer": {"agentType": "execution-implementer", "model": "opus", "effort": "high"},
    "designer": {"agentType": "execution-implementer", "model": "opus", "effort": "high"},
    "runner": {"agentType": "execution-implementer", "model": "sonnet", "effort": "low"},
    # feDirections' similar-prompt planner writes <state>/similar-prompt/tokens.json: only execution-implementer may
    # write under .execution/frontend/ (HOOKS.md B1, FRONTEND.md 3.4), and every FE agent call names a defined type
    # (WAVES.md 6.2 does not list this role: contract question Q-B05-7)
    "generic": {"agentType": "execution-implementer", "model": "opus", "effort": "high"},
}
# The agent roles each fragment reads from `input.agents` (the `settings` of /frontend's critique.js and the role
# constants of directions.js): every one gets explicit options, present in the template's input or not, so no
# fragment agent falls back to a generic workflow agent that keeps every connector (WAVES.md 6.2).
FRAGMENT_ROLES: Mapping[str, tuple[str, ...]] = {"feCritique": ("critic", "implementer", "probe", "runner"),
                                                 "feDirections": ("designer", "generic", "runner")}
RUNNER = {"agentType": "execution-implementer", "model": "sonnet", "effort": "low"}
FE_STEP: Mapping[str, str] = {"feDirections": "fe-directions", "feCritique": "fe-critique"}
FE_RECEIPT_SCHEMA: Mapping[str, str] = {"fe-directions": "directions-receipt.schema.json",
                                        "fe-critique": "critique-receipt.schema.json"}


# ================================================================================================ small helpers

def wave_name(n: int) -> str:
    return f"W{n:02d}" if n < 100 else f"W{n}"


def wave_num(wave: str) -> int:
    m = _WAVE_RE.match(wave or "")
    if not m:
        raise UsageError(f"{wave!r} is not a wave id (W01..W999)")
    return int(m.group(1))


def _check_range(wave: str, executor: str) -> None:
    lo, hi = RANGES[executor]
    if not lo <= wave_num(wave) <= hi:
        raise UsageError(f"wave {wave} is outside executor {executor}'s range W{lo:02d}-W{hi}",
                         hint="A uses W01-W499, B uses W500-W999; W00 is planning")


def _ev(prefix: str, value: str) -> str:
    """One evidence item of `status.transition`'s vocabulary (lane B04's `status.EVIDENCE`, contract question
    Q-B04-21: B05 builds its items with `status.evidence_item`)."""
    return status.evidence_item(prefix, value)


def _need_executor(ctx: Ctx) -> str:
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    return str(ctx.executor)


def _read_optional(path: Path) -> Any | None:
    try:
        return jsonio.read_json_retry(path)
    except FileNotFoundError:
        return None


def _profile(layout: Layout) -> dict:
    doc = _read_optional(layout.profile)
    if not isinstance(doc, dict):
        raise UsageError("no profile.json in the state: run exec.py ingest first")
    return doc


def _policy(layout: Layout) -> dict:
    doc = _read_optional(layout.policy)
    return doc if isinstance(doc, dict) else {}


def _manifest(layout: Layout, wave: str) -> dict | None:
    return status.manifest(layout, wave)


def _manifests(ctx: Ctx) -> list[dict]:
    return reconcile.manifests(ctx)


def _write_manifest(layout: Layout, man: dict) -> None:
    problem = status.schema_problem(man, "wave-manifest")
    if problem:
        raise InternalError(f"waves/{man.get('wave')}.json would be invalid: {problem}", code="E_INTERNAL")
    jsonio.write_json_atomic(layout.wave_manifest(man["wave"]), man)


def _exec_line(layout: Layout) -> str:
    return briefs.exec_line(layout)


def _p80(task: Task) -> float:
    p50 = max(float(task.estimate.p50), 0.1)
    p90 = max(float(task.estimate.p90), p50)
    sigma = math.log(p90 / p50) / 1.2816 if p90 > p50 else 0.0
    return p50 * math.exp(Z80 * sigma)


def _verify_p50(task: Task) -> float:
    v = (task.raw.get("params") or {}).get("verify_estimate")
    if isinstance(v, dict) and isinstance(v.get("p50_min"), (int, float)):
        return float(v["p50_min"])
    return VERIFY_P50_MIN


def _fragment_of(task: Task) -> dict | None:
    """The task's `params.fragment` (FRONTEND.md 2.4 step 9), or for an FE-03 / FE-20 task instantiated without one
    a stub whose missing `input` makes `wave emit` refuse it (E_DEPENDENCY_MISSING), never a guessed input."""
    frag = (task.raw.get("params") or {}).get("fragment")
    if isinstance(frag, dict) and frag.get("function") in FE_STEP:
        return frag
    if task.template == "frontend:FE-03":
        return {"function": "feDirections", "input": None}
    if task.template == "frontend:FE-20":
        return {"function": "feCritique", "input": None}
    return None


def chain_for(task: Task, from_status: str, *, pre_t0: bool = False) -> list[str]:
    """WAVES.md 4 and FRONTEND.md 3.1."""
    if pre_t0:
        return ["implementer"]
    if from_status in ("built", "verifying") or task.kind == "gate":
        return ["verifier"]
    frag = _fragment_of(task)
    if frag is not None:
        return [FE_STEP[frag["function"]], "integrator", "verifier"]
    if task.template == "execution:EX-FIX-CODE":
        return ["test-designer", "implementer", "verifier"]
    if task.template == "execution:EX-CONVERGE":
        return ["reviewer", "verifier"]
    if task.kind == "test" and task.raw.get("proof_author") == "test-designer":
        return ["test-designer", "integrator", "verifier"]
    return ["implementer", "verifier"]


def _override(profile: Mapping[str, Any], key: str, base: dict) -> dict:
    over = (((profile.get("models") or {}).get("overrides") or {}).get(key))
    if isinstance(over, dict) and over.get("model") and over.get("effort"):
        return dict(base, model=over["model"], effort=over["effort"])
    return base


def agent_options(task: Task, role: str, *, critical: bool, profile: Mapping[str, Any],
                  workspace_mode: str) -> dict | None:
    """manifest.tasks[].agents[role] (WAVES.md 4, AGENTS.md 2, ARCHITECTURE.md 6.7). Fragment steps have none."""
    label = f"{task.id} {role}"
    if role == "implementer":
        key = "implementer-critical" if critical else "implementer"
        base = _override(profile, key, {"model": "opus", "effort": "high" if critical else "medium"})
        return {"agentType": "execution-implementer", **base,
                "isolation": "worktree" if workspace_mode == "worktrees" else None,
                "label": label, "phase": PHASES[role], "schema": SCHEMA_OF[role]}
    if role == "test-designer":
        base = _override(profile, "test-designer", {"model": "opus", "effort": "high"})
        return {"agentType": "execution-test-designer", **base, "isolation": None, "label": label,
                "phase": PHASES[role], "schema": SCHEMA_OF[role]}
    if role == "integrator":
        base = _override(profile, "integrator", {"model": "sonnet", "effort": "low"})
        return {"agentType": "execution-implementer", **base, "isolation": None, "label": label,
                "phase": PHASES[role], "schema": SCHEMA_OF[role]}
    if role == "verifier":
        base = _override(profile, "verifier", {"model": "opus", "effort": "high"})
        v = task.raw.get("verify")
        if isinstance(v, dict) and v.get("model") and v.get("effort"):
            if task.priority == "P1":
                model = max((base["model"], v["model"]), key=lambda m: MODEL_RANK.get(m, 0))
                effort = max((v["effort"], "high"), key=lambda e: EFFORT_RANK.get(e, 0))
                base = {"model": model, "effort": effort}
            else:
                base = {"model": v["model"], "effort": v["effort"]}
        return {"agentType": "execution-verifier", **base, "isolation": None, "label": label,
                "phase": PHASES[role], "schema": SCHEMA_OF[role]}
    if role == "reviewer":
        key = "convergence" if task.template == "execution:EX-CONVERGE" else "reviewer"
        base = _override(profile, key, {"model": "opus", "effort": "high"})
        return {"agentType": "execution-reviewer", **base, "isolation": None, "label": label,
                "phase": PHASES[role], "schema": SCHEMA_OF[role]}
    return None


# ================================================================================================ wave ids

def next_wave_id(layout: Layout, executor: str) -> str:
    """Allocate the next wave id of `executor` by creating `waves/Wnn.json` with O_EXCL (state lock held)."""
    if not status.holds_state_lock():
        raise InternalError("next_wave_id requires the state lock", code="E_INTERNAL")
    lo, hi = RANGES[executor]
    folder = layout.state / "waves"
    folder.mkdir(parents=True, exist_ok=True)
    used = []
    for p in folder.glob("W*.json"):
        m = _WAVE_RE.match(p.stem)
        if m and lo <= int(m.group(1)) <= hi:
            used.append(int(m.group(1)))
    n = max(used, default=lo - 1) + 1
    while n <= hi:
        path = layout.wave_manifest(wave_name(n))
        try:
            fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            n += 1
            continue
        os.close(fd)
        return wave_name(n)
    raise UsageError(f"no wave id left in executor {executor}'s range", hint="W01-W499 for A, W500-W999 for B")


# ================================================================================================ preconditions

def _refuse(message: str, *, code: str = "E_POLICY", hint: str | None = None) -> PolicyRefused:
    return PolicyRefused(message, code=code, hint=hint)


def _canary_ok(ctx: Ctx, st: Mapping[str, Any]) -> tuple[bool, str]:
    marker = state.read_active(ctx.layout)
    if not marker or not marker.get("session_id"):
        return False, "the run is not bound to a session (no hooks canary yet)"
    bound = str(marker["session_id"])
    env_id = os.environ.get("CLAUDE_CODE_SESSION_ID")
    if env_id and env_id != bound:
        return False, f"this session ({env_id}) is not the bound one; run exec.py resume --takeover first"
    if not (st.get("hooks") or {}).get("canary_ok_utc"):
        return False, "no passing hooks canary recorded"
    evs, _errs = events.read_all(ctx.layout)
    canaries = [e for e in evs if e["type"] == "hooks.canary" and (e.get("data") or {}).get("ok") is True]
    if not canaries:
        return False, "no passing hooks.canary event"
    if (canaries[-1].get("data") or {}).get("session_id") != bound:
        return False, "the latest passing hooks canary belongs to another session"
    return True, ""


PROBE_DECISION_TITLE = "Sonde des agents"      # the title prefix of lane B10's probe-check decision (agents.py)


def _probe_ok(ctx: Ctx, st: Mapping[str, Any]) -> tuple[bool, str]:
    """CLI.md `agents probe-check`: wave emit refuses until the session's latest probe-check passed or its
    dependency-missing decision is resolved. Lane B10 records the verdict in `local/probe/check.json` (its session
    id included; local state is not written, Q-B10-1); `hooks.probe_ok_utc` in local state is accepted too."""
    if (st.get("hooks") or {}).get("probe_ok_utc"):
        return True, ""
    marker = state.read_active(ctx.layout) or {}
    check = _read_optional(ctx.layout.local / "probe" / "check.json")
    if isinstance(check, dict) and check.get("passed") is True and marker.get("session_id") and \
            check.get("session_id") == marker.get("session_id"):
        return True, ""
    checked = str(check.get("checked_utc") or "") if isinstance(check, dict) else ""
    proposals: set[str] = set()
    resolved: dict[str, str] = {}
    for doc in status.decision_headers(ctx.layout):
        if doc.get("record") == "proposal" and doc.get("kind") == "dependency-missing" \
                and str(doc.get("title", "")).startswith(PROBE_DECISION_TITLE):
            proposals.add(str(doc["id"]))
        elif doc.get("record") == "resolution":
            resolved[str(doc["id"])] = str(doc.get("at_utc") or "")
    # a resolution older than the latest (failed) check answered an earlier probe, not this one
    if any(did in resolved and resolved[did] >= checked for did in sorted(proposals)):
        return True, ""
    return False, "the session's agents probe-check has not passed and its decision is not resolved"


def _quota_state(ctx: Ctx, st: Mapping[str, Any]) -> tuple[str, str]:
    quota = st.get("quota") or {}
    decision = quota.get("decision") or "unknown"
    if decision == "pause":
        until = quota.get("pause_until_utc")
        if until and clock.parse_utc(str(until)) <= ctx.now:
            decision = "normal"
    evidence = reconcile.usage_limit_evidence(ctx, dict(st), snapshot=False)
    if reconcile.quota_paused(dict(st), evidence, ctx.now):
        decision = "pause"
    override = quota.get("override") or {}
    if decision != "pause" and override.get("mode") == "critical-only" and override.get("until_utc") and \
            clock.parse_utc(str(override["until_utc"])) > ctx.now:
        decision = "critical-only"
    return decision, str(quota.get("pause_until_utc") or "")


def check_preconditions(ctx: Ctx, plan: PlanModel, st: Mapping[str, Any], *, pre_t0: bool, force_critical: bool
                        ) -> tuple[dict, str]:
    """CLI.md wave emit preconditions (exit 4, nothing written). Returns (governor decision, quota decision)."""
    if not pre_t0 and not plan.approved:
        raise _refuse("the plan is not approved", hint="resolve the approval decision first")
    quota_decision, until = _quota_state(ctx, st)
    if quota_decision == "pause":
        raise _refuse(f"quota pause{(' until ' + until) if until else ''}: no launch",
                      hint="exec.py quota; the heartbeat resumes after the reset")
    if quota_decision == "critical-only" and not force_critical:
        raise _refuse("quota is critical-only: emit with --force-critical", hint="exec.py wave emit --force-critical")
    gov = st.get("governor")
    if not isinstance(gov, dict):
        raise _refuse("no governor reading in local state", hint="run exec.py governor --for wave first")
    decision = gov.get("decision") or {}
    if decision.get("pause") and not (force_critical and quota_decision == "critical-only"):
        raise _refuse("governor pause: " + "; ".join(decision.get("reasons") or ["no reason recorded"]),
                      hint="exec.py governor --for wave (and --apply-sweep when it helps)")
    if not pre_t0:
        ok, why = _canary_ok(ctx, st)
        if not ok:
            raise _refuse(why, hint="exec.py hooks canary --nonce <nonce> in this session")
        ok, why = _probe_ok(ctx, st)
        if not ok:
            raise _refuse(why, hint="exec.py agents probe, launch it, then exec.py agents probe-check")
    if ctx.layout.repo is not None and (Path(ctx.layout.repo) / ".harden" / "active").exists():
        raise _refuse(".harden/active exists: a /harden run owns the repository", hint="wait for /harden to finish")
    return decision, quota_decision


# ================================================================================================ selection

def _live_tasks(live: Sequence[Mapping[str, Any]]) -> set[str]:
    return {t["task"] for m in live for t in m.get("tasks") or ()}


def _open_dependency_tasks(layout: Layout) -> set[str]:
    """Tasks listed in an open dependency-missing proposal: not selected while it is open (Q-B05-2)."""
    props: dict[str, dict] = {}
    resolved: set[str] = set()
    for doc in status.decision_headers(layout):
        if doc.get("record") == "proposal":
            props[doc["id"]] = doc
        elif doc.get("record") == "resolution":
            resolved.add(doc["id"])
    out: set[str] = set()
    for did, doc in props.items():
        if did not in resolved and doc.get("kind") == "dependency-missing":
            out |= set(doc.get("tasks") or ())
    return out


def _conflicts(a: Task, b: Task, g: graphmod.Graph, *, live: bool = False) -> list[str]:
    """Runtime overlap (SCHEMAS.md 7.4) between two tasks not joined by a dependency path. Inside one wave the
    script serializes shared serialized resources (WAVES.md 3.4), so only writes and ordered resources keep two tasks
    apart; a task of a live wave (`live`) occupies every resource it holds, because two wave scripts share no
    semaphore. `browser` is the exception: live waves hold it as slots, subtracted in `compute_limits`."""
    # globs and resources reached through schedule, which imports them (MODULES.md 8 gives wave no direct edge to
    # these layer-1 modules: Q-B05-6, the pattern lane B04 used for locks)
    if g.joined(a.id, b.id):
        return []
    why = []
    if schedule.globs.overlapping(a.writes, b.writes):
        why.append("writes")
    if schedule.resources.ordered_conflicts(a.resources, b.resources):
        why.append("ordered resource")
    if live and [r for r in schedule.resources.serialized_conflicts(a.resources, b.resources) if r != "browser"]:
        why.append("serialized resource held by a live wave")
    return why


def _schedule_order(layout: Layout) -> tuple[dict[str, int], set[str]]:
    cache = _read_optional(layout.schedule_cache)
    ranks: dict[str, int] = {}
    critical: set[str] = set()
    if isinstance(cache, dict):
        for item in cache.get("ready") or ():
            if isinstance(item, dict) and item.get("task"):
                ranks[item["task"]] = int(item.get("rank", 10 ** 6))
                if item.get("critical"):
                    critical.add(item["task"])
        critical |= set(cache.get("critical_path") or ())
    return ranks, critical


def _released(task: Task, now: datetime) -> bool:
    return task.release is None or task.release <= now


def _recorded_pre_t0(layout: Layout, tid: str) -> bool:
    root = layout.local / "results"
    if not root.is_dir():
        return False
    for path in root.glob(f"*/{tid}.implementer.a*.json"):
        doc = _read_optional(path)
        if isinstance(doc, dict) and doc.get("status") == "built":
            return True
    return False


def select(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], schedule_cache: Mapping[str, Any] | None,
           governor: Mapping[str, Any] | None, live_waves: Sequence[Mapping[str, Any]], max_tasks: int | None,
           include: Sequence[str], force_critical: bool, *, pre_t0: bool = False, limits: Mapping[str, int] | None = None,
           only: Sequence[str] | None = None) -> list[Task]:
    """The tasks of the next wave, in dispatcher order (CLI.md wave emit, SCHEMAS.md 7.4)."""
    executor = _need_executor(ctx)
    doc = statuses.get(executor) or {}
    g = graphmod.Graph.of(plan)
    ranks, critical = _schedule_order(ctx.layout)
    live_ids = _live_tasks(live_waves)
    live_task_objs = [plan.by_id[t] for t in sorted(live_ids) if t in plan.by_id]
    live_lanes = {t.lane for t in live_task_objs if t.lane}
    blocked_dep = _open_dependency_tasks(ctx.layout)
    browser_free = int((limits or {}).get("browser_slots", 1))
    wanted = set(include) | set(only or ())

    def st_of(tid: str) -> str:
        task = plan.by_id[tid]
        other = statuses.get(task.executor) or {}
        return status.current_status(other, tid)

    candidates: list[tuple[Task, str]] = []
    for task in plan.tasks:
        if task.executor != executor or task.is_human or task.id in live_ids or task.id in blocked_dep:
            continue
        if wanted and task.id not in wanted:
            continue
        cur = status.current_status(doc, task.id)
        if pre_t0:
            if cur == "planned" and not _recorded_pre_t0(ctx.layout, task.id):
                candidates.append((task, "planned"))
            continue
        if cur in ("ready", "planned", "built", "verifying"):
            if cur in ("built", "verifying") and briefs.landed_info(ctx.layout, task.id,
                                                                     status.current_attempt(
                                                                         status.entry_of(doc, task.id))) is None:
                continue
            if cur == "planned" and (not plan.approved or not _released(task, ctx.now) or
                                     (task.anchor is not None and task.release is None)):
                continue
            if task.kind == "gate" and cur in ("ready", "planned") and \
                    any(st_of(d) != "done" for d in task.depends_on):
                continue        # a gate's receipt is origin/main at emit: never an in-wave dependent
            candidates.append((task, cur))
    if force_critical:
        candidates = [(t, s) for t, s in candidates if t.id in critical]

    def order_key(item: tuple[Task, str]) -> tuple:
        t, cur = item
        return (0 if t.id in set(include) else 1, ranks.get(t.id, 10 ** 6), 0 if t.id in critical else 1,
                -g.remaining_path_min(t.id, {x.id: x.estimate.p50 for x in plan.tasks}), t.num)

    candidates.sort(key=order_key)
    selected: list[Task] = []
    sel_ids: set[str] = set()
    progress = True
    pending = list(candidates)
    while progress:
        progress = False
        for item in list(pending):
            task, cur = item
            # dependencies: done, or (in-wave) selected before
            deps_ok = True
            for dep in task.depends_on:
                dep_task = plan.by_id.get(dep)
                if dep_task is None:
                    deps_ok = False
                    break
                if pre_t0:
                    if dep_task.is_human:
                        if st_of(dep) != "done":
                            deps_ok = False
                            break
                    elif not (_recorded_pre_t0(ctx.layout, dep) or dep in sel_ids):
                        deps_ok = False
                        break
                    continue
                if st_of(dep) == "done":
                    continue
                if dep in sel_ids and cur in ("planned", "ready"):
                    continue
                deps_ok = False
                break
            if not deps_ok:
                continue
            if task.lane and task.lane in live_lanes:
                continue
            if any(_conflicts(task, other, g, live=True) for other in live_task_objs):
                continue
            if any(_conflicts(task, other, g) for other in selected):
                continue
            if "browser" in task.resources and browser_free <= 0:
                continue
            selected.append(task)
            sel_ids.add(task.id)
            pending.remove(item)
            progress = True
            if max_tasks is not None and len(selected) >= max_tasks:
                return selected
            break           # restart in priority order: an in-wave dependent may now fit
    return selected


def _trim_to_budget(tasks: list[Task], writers: int, deps_in_wave: Mapping[str, list[str]]) -> list[Task]:
    """Default size: keep tasks in order while the estimated wave P80 stays within DEFAULT_WAVE_P80_MIN (the first
    task is always kept); a dropped task drops its in-wave dependents."""
    kept: list[Task] = []
    lane_sum: dict[str, float] = {}
    total = 0.0
    dropped: set[str] = set()
    for t in tasks:
        if any(d in dropped for d in deps_in_wave.get(t.id, ())):
            dropped.add(t.id)
            continue
        dur = _p80(t) + _verify_p50(t)
        lane = t.lane or t.id
        new_lane = lane_sum.get(lane, 0.0) + dur
        new_total = total + dur
        p80 = max(max(list(lane_sum.values()) + [new_lane]), new_total / max(writers, 1))
        if kept and p80 > DEFAULT_WAVE_P80_MIN:
            dropped.add(t.id)
            continue
        kept.append(t)
        lane_sum[lane] = new_lane
        total = new_total
    return kept


# ================================================================================================ limits

def compute_limits(decision: Mapping[str, Any], profile: Mapping[str, Any], live_waves: Sequence[Mapping[str, Any]]
                   ) -> tuple[dict, list[str]]:
    """The manifest `limits`: the governor budget minus the live waves' writers, verifiers and browser slots."""
    machine = profile.get("machine") or {}
    env = int(machine.get("workflow_concurrency") or 6)
    writers = min(6, int(decision.get("lanes") or 0))
    verifiers = min(4, int(decision.get("verifiers") or 0))
    browser = min(2, max(0, int(decision.get("browser_slots") or 0)))
    notes: list[str] = []
    for m in live_waves:
        lim = m.get("limits") or {}
        writers -= int(lim.get("writers") or 0)
        verifiers -= int(lim.get("verifiers") or 0)
        browser -= int(lim.get("browser_slots") or 0)
    if live_waves:
        notes.append("live waves " + ", ".join(sorted(m["wave"] for m in live_waves)) + " hold part of the budget")
    while writers + verifiers + 1 > env and (writers > 1 or verifiers > 1):
        if writers >= verifiers and writers > 1:
            writers -= 1
        else:
            verifiers -= 1
    return ({"writers": writers, "verifiers": verifiers, "integrators": 1, "browser_slots": max(0, browser),
             "concurrency_env": env}, notes)


def _workspace_mode(profile: Mapping[str, Any], decision: Mapping[str, Any], pre_t0: bool) -> str:
    if pre_t0:
        return "single-tree"
    forced = (profile.get("machine") or {}).get("workspace_mode")
    if forced in ("worktrees", "single-tree"):
        return str(forced)
    mode = decision.get("workspace_mode")
    return str(mode) if mode in ("worktrees", "single-tree") else "single-tree"


# ================================================================================================ fragments

def _profile_pointer(profile: Mapping[str, Any], dotted: str) -> tuple[bool, Any]:
    cur: Any = profile
    for part in dotted.replace("/", ".").strip(".").split("."):
        if not isinstance(cur, Mapping) or part not in cur:
            return False, None
        cur = cur[part]
    return True, cur


def _resolve_input(value: Any, profile: Mapping[str, Any], workdir: str, where: str) -> Any:
    if isinstance(value, dict):
        if set(value.keys()) == {"$from"}:
            found, got = _profile_pointer(profile, str(value["$from"]))
            if not found:
                raise DependencyMissing(f"{where}: profile field {value['$from']} is absent (fragment input)",
                                        code="E_DEPENDENCY_MISSING", data={"field": value["$from"]})
            return copy.deepcopy(got)
        return {k: _resolve_input(v, profile, workdir, where) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_input(v, profile, workdir, where) for v in value]
    if isinstance(value, str):
        return value.replace("{workdir}", workdir)
    return value


def fe_entry(ctx: Ctx, task: Task, frag: Mapping[str, Any], *, attempt: int, rerun: int, wave: str,
             profile: Mapping[str, Any]) -> tuple[dict, list[tuple[Path, str]]]:
    """EXTRA.fe[task] (WAVES.md 6.2) and the message files the emitter writes for it."""
    function = str(frag["function"])
    step = FE_STEP[function]
    if not isinstance(frag.get("input"), dict):
        raise DependencyMissing(f"{task.id}: params.fragment.input of {function} is absent (the plan task was not "
                                "instantiated through /frontend's template)", code="E_DEPENDENCY_MISSING",
                                data={"field": "params.fragment.input", "task": task.id})
    project = str(profile["project"]["slug"])
    scratch = briefs.scratch_root(profile, project)
    run_key = f"{task.id}-a{attempt}r{rerun}"
    files: list[tuple[Path, str]] = []
    if function == "feCritique":
        workdir = f"{scratch}/fe/{run_key}"
    else:
        workdir = posix(ctx.layout.repo) if ctx.layout.repo is not None else posix(ctx.layout.state)
    inp = _resolve_input(copy.deepcopy(frag["input"]), profile, workdir, task.id)
    given = inp.get("agents") if isinstance(inp.get("agents"), dict) else {}
    agents: dict[str, Any] = {}
    for role in sorted(set(given) | set(FRAGMENT_ROLES[function])):
        base = given.get(role) if isinstance(given.get(role), dict) else {}
        agents[role] = dict(base, **FE_ROLE_AGENTS[role]) if role in FE_ROLE_AGENTS else base
        if not (agents[role].get("agentType") and agents[role].get("model") and agents[role].get("effort")):
            raise DependencyMissing(f"{task.id}: fragment role {role!r} of {function} has no agent type, model and "
                                    "effort, and /execution has no definition for it", code="E_DEPENDENCY_MISSING",
                                    data={"field": f"params.fragment.input.agents.{role}", "task": task.id})
    inp["agents"] = agents
    entry: dict[str, Any] = {"fragment": function, "input": inp,
                             "receipt_inbox": briefs.inbox_file(ctx.layout, wave, f"{task.id}.{step}.a{attempt}r{rerun}.json")}
    if function == "feCritique":
        restore_msg = f"{scratch}/msg/{task.id}-restore.txt"
        cmds = dict(inp.get("commands") or {})
        cmds["restore"] = f'git revert --no-commit {{sha}}..HEAD && git commit -F "{restore_msg}"'
        inp["commands"] = cmds
        files.append((Path(restore_msg), f"revert: restore best-so-far critique round ({task.id})\n"))
        entry["prepare"] = {
            "command": (f"{_exec_line(ctx.layout)} fe-workspace --task {task.id} --attempt {attempt} --rerun {rerun} "
                        "--by implementer"),
            "worktree": workdir, "branch": f"exec/{run_key}"}
    else:
        files.append((Path(briefs.msg_file(profile, project, task.id, attempt)),
                      f"chore(frontend): record the design directions of {task.id}\n"))
    return entry, files


FRONTEND_AGENT_MARKER = "frontend-agent-template: "        # AGENTS.md 5.2 (lane B10's agents.FRONTEND_MARKER_PREFIX)


def _frontend_agent_present(path: Path, name: str) -> bool:
    """AGENTS.md 5.2: a /frontend agent is present when its file exists with the line
    `frontend-agent-template: <name> v<n>` (the same marker `agents status` reads); a file without it is not one."""
    try:
        text = path.read_bytes().decode("utf-8", errors="replace")
    except FileNotFoundError:
        return False
    except OSError as err:
        _LOG.warning("a /frontend agent definition is unreadable: counted as absent",
                     extra={"data": {"path": posix(path), "error": str(err)}})
        return False
    pattern = re.compile(r"^" + re.escape(f"{FRONTEND_AGENT_MARKER}{name} v") + r"[0-9]+\b")
    return any(pattern.match(line) for line in text.splitlines())


def _frontend_agents_missing() -> list[str]:
    """/frontend's agent definitions feCritique calls that are not installed with their marker line (AGENTS.md 5.2
    and 6: never installed here)."""
    cfg = os.environ.get("CLAUDE_CONFIG_DIR")
    root = Path(cfg) if cfg else Path.home() / ".claude"
    return [name for name in ("frontend-critic", "frontend-probe")
            if not _frontend_agent_present(root / "agents" / f"{name}.md", name)]


def _dependency_options() -> list[dict]:
    """FRONTEND.md 12: the options of every /frontend dependency-missing decision (no option builds a UI another
    way; `cut-ui` leads to a cut proposal the owner resolves, which the orchestrator opens)."""
    return [{"id": "wait", "label": "J'attends que /frontend soit réparé ; le reste du plan continue",
             "consequence": "Les tâches /frontend concernées attendent ; les autres vagues partent.",
             "effects": [{"op": "none"}]},
            {"id": "cut-ui", "label": "Couper les exigences UI concernées",
             "consequence": "Une proposition de coupe (réservée au propriétaire) est ouverte.",
             "effects": [{"op": "none"}]}]


def _propose_dependency(ctx: Ctx, title: str, tasks: list[str]) -> tuple[str, bool]:
    """(decision id, deduplicated) of a /frontend dependency-missing proposal (state lock held)."""
    return decisions.propose(ctx, kind="dependency-missing", title=title[:160], options=_dependency_options(),
                             tasks=sorted(tasks), deadline=None, recommended="wait")


def _dependency_decision(ctx: Ctx, title: str, tasks: list[str]) -> str:
    return _propose_dependency(ctx, title, tasks)[0]


# ================================================================================================ emit

def _deps_in_wave(task: Task, ids: set[str]) -> list[str]:
    return sorted((d for d in task.depends_on if d in ids), key=lambda x: int(x[1:]))


def _description(wave: str, project: str, ids: Sequence[str]) -> str:
    shown = " ".join(ids[:12]) + (" ..." if len(ids) > 12 else "")
    proj = re.sub(r"[^A-Za-z0-9 ,.:()/-]", "-", project)
    return f"Wave {wave} of {proj}: {len(ids)} tasks ({shown})"


def _fetch_origin_head(layout: Layout) -> str:
    git = status.product_git(layout)
    if git is None:
        raise UsageError("a gate task needs the product repository (origin/main)")
    git.fetch()
    return git.rev_parse("origin/main")


def build_manifest(ctx: Ctx, plan: PlanModel, tasks: Sequence[Task], *, wave: str, statuses: Mapping[str, dict],
                   limits: Mapping[str, int], workspace_mode: str, critical: set[str], profile: Mapping[str, Any],
                   pre_t0: bool, skip: Sequence[str] = (), gate_sha: str | None = None
                   ) -> tuple[dict, dict, dict[str, briefs.BriefContext]]:
    """(manifest without script hashes, EXTRA, brief contexts keyed `<task>.a<n>`)."""
    executor = _need_executor(ctx)
    doc = statuses.get(executor) or {}
    ids = {t.id for t in tasks}
    items: list[dict] = []
    extra: dict[str, Any] = {"schemas": wavejs.result_schemas(), "runner": dict(RUNNER), "fe": {},
                             "in_wave_fix": True, "fix": {}}
    bctxs: dict[str, briefs.BriefContext] = {}
    lanes: dict[str, list[str]] = {}
    for rank, task in enumerate(tasks):
        entry = status.entry_of(doc, task.id)
        cur = status.current_status(doc, task.id)
        attempt = status.current_attempt(entry)
        rerun = int((entry or {}).get("reruns", 0))
        chain = chain_for(task, cur, pre_t0=pre_t0)
        crit = task.id in critical
        agents = {}
        for role in chain:
            opts = agent_options(task, role, critical=crit, profile=profile, workspace_mode=workspace_mode)
            if opts is not None:
                agents[role] = opts
        res = {role: f"local/results/{wave}/{task.id}.{role}.a{attempt}.json"
               for role in chain if role in AGENT_RESULT_ROLES}
        if any(r in chain for r in ("implementer", "integrator")) and not pre_t0:
            res["merge"] = f"local/results/{wave}/{task.id}.merge.a{attempt}.json"
        item: dict[str, Any] = {
            "task": task.id, "lane": task.lane, "attempt": attempt, "rerun": rerun, "kind": task.kind,
            "chain": chain, "brief_path": posix(ctx.layout.brief(task.id, attempt)),
            "inbox": posix(ctx.layout.inbox(wave)), "results": res, "agents": agents,
            "deps_in_wave": _deps_in_wave(task, ids), "priority_rank": rank, "critical": crit,
            "resources": list(task.resources), "from_status": cur,
        }
        fe = None
        frag = _fragment_of(task) if not pre_t0 else None
        if frag is not None:
            fe, _files = fe_entry(ctx, task, frag, attempt=attempt, rerun=rerun, wave=wave, profile=profile)
            extra["fe"][task.id] = fe
        # In-wave fix attempts (WAVES.md 3.7) only for chains whose every `failed` outcome leaves a file `wave ingest`
        # can apply (a failed implementer result, a failed merge receipt, a fail receipt). A fragment step that
        # ends not ok leaves only its receipt, which no row of SCHEMAS.md 4.2 accepts (Q-B05-4), so the status
        # could never reach `failed` before the prepared attempt runs: those chains use the across-waves path.
        fixes = []
        if not pre_t0 and chain and chain[0] in FIX_CHAIN_STARTS:
            fixes = list(range(attempt + 1, task.max_attempts + 1))
        if fixes:
            item["fix_attempts"] = fixes
            extra["fix"][task.id] = [{"attempt": n, "brief_path": posix(ctx.layout.brief(task.id, n))}
                                     for n in fixes]
        items.append(item)
        if task.lane:
            lanes.setdefault(task.lane, []).append(task.id)
        landed = briefs.landed_info(ctx.layout, task.id, attempt) if chain == ["verifier"] else None
        if task.kind == "gate" and not pre_t0 and landed is None and gate_sha:
            landed = {"sha": gate_sha, "receipt": f"local/results/{wave}/{task.id}.merge.a{attempt}.json"}
        roles = {r: {"model": a["model"], "effort": a["effort"]} for r, a in agents.items()}
        for n in [attempt] + fixes:
            bctxs[f"{task.id}.a{n}"] = briefs.BriefContext(
                wave=wave, attempt=n, rerun=rerun, chain=tuple(chain), workspace_mode=workspace_mode,
                critical=crit, now=ctx.now, roles=roles, landed=landed if n == attempt else None, fe=fe,
                pre_t0=pre_t0, imported=bool((task.raw.get("params") or {}).get("imported")))
    workflow_name = f"execution-wave-{wave.lower()}"
    man: dict[str, Any] = {
        "schema": "execution.wave-manifest/1", "wave": wave, "executor": executor, "plan_version": plan.version,
        "plan_sha256": planmod.plan_digest(plan.raw), "created_utc": clock.format_utc(ctx.now),
        "launching_utc": clock.format_utc(ctx.now), "script_path": posix(ctx.layout.wave_script(wave)),
        "script_sha256": "0" * 64, "workflow_name": workflow_name,
        "args": {"now_utc": clock.format_utc(ctx.now), "skip": sorted(skip)}, "limits": dict(limits),
        "lanes": [{"lane": lane, "workspace_mode": workspace_mode, "tasks": ids_}
                  for lane, ids_ in sorted(lanes.items(), key=lambda kv: int(kv[0][1:]))],
        "tasks": items, "fragments": [], "launch": None, "status": "launching",
    }
    if pre_t0:
        man["pre_t0"] = True
    return man, extra, bctxs


def _brief_refs_missing(tasks: Sequence[Task]) -> list[ErrorItem]:
    out = []
    for t in tasks:
        for ref in t.raw.get("brief_refs") or ():
            if not Path(ref).exists():
                out.append(ErrorItem("E_BRIEF_REF_MISSING", f"{t.id}: brief_refs path {ref} does not exist",
                                     path=str(ref), task=t.id))
    return out


def emit(ctx: Ctx, *, max_tasks: int | None, include: Sequence[str], wave: str | None, force_critical: bool,
         pre_t0: bool) -> CommandResult:
    """CLI.md `wave emit`."""
    executor = _need_executor(ctx)
    layout = ctx.layout
    plan = planmod.load(layout)
    profile = _profile(layout)
    policy = _policy(layout)
    if max_tasks is not None and max_tasks < 1:
        raise UsageError("--max-tasks must be >= 1")
    scratch_root = (profile.get("machine") or {}).get("scratch_root")
    if not isinstance(scratch_root, str) or not re.match(r"^([A-Za-z]:/|/)", scratch_root.replace("\\", "/")):
        # required by profile.schema.json; briefs and message files live under it, so emit stops before writing
        raise ValidationFailed("profile.json has no absolute machine.scratch_root", code="E_SCHEMA",
                               items=[ErrorItem("E_SCHEMA", "machine.scratch_root is required (an absolute path)",
                                                path="/machine/scratch_root")],
                               hint="fix the profile through exec.py ingest --patch")
    for tid in include:
        if tid not in plan.by_id:
            raise UsageError(f"--include {tid}: no such task in the plan")
    warnings: list[ErrorItem] = []
    origin_head: str | None = None
    own = statusio.load(layout, executor)                  # unlocked read: only decides whether to fetch
    needs_gate = not pre_t0 and any(t.kind == "gate" and t.executor == executor and
                                    status.current_status(own, t.id) in ("ready", "planned") for t in plan.tasks)
    if needs_gate and layout.repo is not None:
        origin_head = _fetch_origin_head(layout)          # network: before the lock
    with status.state_lock(ctx):
        st = state.load(layout)
        decision, quota_decision = check_preconditions(ctx, plan, st, pre_t0=pre_t0, force_critical=force_critical)
        statuses = statusio.load_all(layout)
        live = [m for m in _manifests(ctx) if m.get("status") in LIVE]
        reemit = None
        if wave is not None:
            _check_range(wave, executor)
            reemit = _manifest(layout, wave)
            if reemit is None:
                raise UsageError(f"--wave {wave}: no such wave")
            if reemit.get("status") not in ("launch-failed", "abandoned"):
                raise _refuse(f"wave {wave} is {reemit.get('status')}: only a launch-failed or abandoned wave is "
                              "re-emitted (a launched wave is relaunched with its own script)")
            live = [m for m in live if m["wave"] != wave]
        limits, notes = compute_limits(decision, profile, live)
        if limits["writers"] < 1 or limits["verifiers"] < 1:
            return _nothing(f"no budget left: writers {limits['writers']}, verifiers {limits['verifiers']} after the "
                            "governor decision and the live waves", notes)
        only = [t["task"] for t in reemit["tasks"]] if reemit else None
        selected = select(ctx, plan, statuses, _read_optional(layout.schedule_cache), decision, live, max_tasks,
                          include, force_critical, pre_t0=pre_t0, limits=limits, only=only)
        if reemit is not None and sorted(t.id for t in selected) != sorted(only or []):
            missing = sorted(set(only or []) - {t.id for t in selected})
            return _nothing(f"wave {wave} cannot be re-emitted: {', '.join(missing)} no longer ready", notes)
        _ranks, critical = _schedule_order(layout)
        ids = {t.id for t in selected}
        if max_tasks is None and reemit is None:
            selected = _trim_to_budget(selected, limits["writers"],
                                       {t.id: _deps_in_wave(t, ids) for t in selected})
        if not selected:
            return _nothing("nothing ready fits this wave", notes)
        refs = _brief_refs_missing(selected)
        if refs:
            raise PolicyRefused(refs[0].message, code="E_BRIEF_REF_MISSING", items=refs,
                                hint="fix the path or amend the task's brief_refs")
        # /frontend fragments and agents (exit 1, a dependency-missing decision, nothing else written)
        frags: dict[str, wavejs.Fragment] = {}
        fe_tasks = [t for t in selected if _fragment_of(t) is not None and not pre_t0]
        for t in fe_tasks:
            frag = _fragment_of(t) or {}
            try:
                # always this machine's <frontend>/assets/wave-fragments/<name>.js (FRONTEND.md 9.1, WAVES.md 6.1);
                # `params.fragment.file` and `.sha256` record what instantiation saw on the planning machine
                f = wavejs.load_fragment_full(str(frag["function"]))
                if frag.get("sha256") and frag.get("sha256") != f.sha256:
                    _LOG.info("the /frontend wave fragment changed since instantiation; this wave records the new "
                              "sha256", extra={"data": {"task": t.id, "fragment": f.name,
                                                        "instantiated": frag.get("sha256"), "now": f.sha256}})
                missing_agents = _frontend_agents_missing() if frag["function"] == "feCritique" else []
                if missing_agents:
                    raise DependencyMissing(f"/frontend agents absent: {', '.join(missing_agents)}",
                                            code="E_DEPENDENCY_MISSING",
                                            hint="node <frontend>/scripts/install-agents.mjs (the owner runs it)")
                fe_entry(ctx, t, frag, attempt=1, rerun=0, wave="W01", profile=profile)   # input resolvable?
            except DependencyMissing as err:
                # the tasks that need this fragment wait under the decision; the other tasks (another fragment
                # included) are emitted by the next `wave emit` (FRONTEND.md 12)
                held = [x.id for x in fe_tasks if (_fragment_of(x) or {}).get("function") == frag.get("function")]
                did = _dependency_decision(ctx, f"Fragment /frontend indisponible : {err.message}", held)
                raise DependencyMissing(err.message, code="E_DEPENDENCY_MISSING", items=err.items(),
                                        hint=f"decision {did} is open for the owner; the next wave emit skips "
                                             f"{', '.join(held)} and emits the rest",
                                        data={"proposal": did, "tasks": held}) from err
            frags[f.name] = f
        # allocate the id, render and check before anything else is written
        if reemit is not None:
            wid = wave
        else:
            wid = next_wave_id(layout, executor)
        try:
            data, writes = _render_all(ctx, plan, selected, wid, statuses, limits, decision, profile, policy,
                                       critical, frags, pre_t0, gate_sha=origin_head)
        except BaseException:
            if reemit is None:
                _unlink_quiet(layout.wave_manifest(wid))
            raise
        warnings += writes.pop("warnings")
        # write: briefs, script, manifest, inbox, gate receipts, transitions, local state, event
        for path, text in writes["briefs"]:
            jsonio.write_text_atomic(path, text)
        for path, text in writes["files"]:
            if not path.exists():
                jsonio.write_text_atomic(path, text)
        jsonio.write_text_atomic(layout.wave_script(wid), writes["script"])
        man = writes["manifest"]
        _write_manifest(layout, man)
        layout.inbox(wid).mkdir(parents=True, exist_ok=True)
        doc = statuses.get(executor) or statusio.default_doc(executor, plan.version)
        moved: list[str] = []
        for item in man["tasks"]:
            task = plan.by_id[item["task"]]
            if task.kind == "gate" and not pre_t0:
                if results.landed_receipt(layout, task.id, item["attempt"]) is None:
                    if origin_head is None:
                        origin_head = _fetch_origin_head(layout)
                    results.write_gate_receipt(ctx, task, wid, item["attempt"], origin_head)
            if pre_t0 or item["from_status"] not in ("ready", "planned"):
                continue        # built/verifying: verifier-only chain, no transition (Q-B05-1)
            status.transition(ctx, doc, task, "running", evidence=[_ev("launch-intent", wid)], plan=plan)
            moved.append(task.id)
        if moved:
            statusio.save(ctx, doc)
        waves_list = [w for w in st.get("waves") or () if w.get("wave") != wid]
        waves_list.append({"wave": wid, "status": "launching", "manifest": f"waves/{wid}.json", "run_id": None,
                           "transcript_dir": None, "session_id": os.environ.get("CLAUDE_CODE_SESSION_ID"),
                           "launched_utc": None, "finished_utc": None,
                           "tasks": [i["task"] for i in man["tasks"]]})
        st["waves"] = sorted(waves_list, key=lambda w: wave_num(w["wave"]))
        state.save(ctx, st)
        quota = st.get("quota") or {}
        events.append(ctx, "wave.emitted", {"wave": wid, "tasks": [i["task"] for i in man["tasks"]],
                                            "script_sha256": man["script_sha256"], "pre_t0": pre_t0,
                                            "limits": man["limits"], "reemit": reemit is not None,
                                            "quota_seven_day_pct": quota.get("seven_day_pct"),
                                            "quota_decision": quota_decision})
    return CommandResult(data=data, warnings=warnings)


def _unlink_quiet(path: Path) -> None:
    try:
        if path.exists() and path.stat().st_size == 0:
            path.unlink()
    except OSError as err:
        _LOG.warning("could not remove the allocated wave id file", extra={"data": {"path": posix(path),
                                                                                    "error": str(err)}})


def _nothing(reason: str, notes: Sequence[str]) -> CommandResult:
    return CommandResult(data={"wave": None, "reason": reason, "notes": list(notes)}, exit_code=1,
                         errors=[ErrorItem("E_NOTHING_READY", reason,
                                           hint="not an error for the tick: wait for running work or the owner")])


def _render_all(ctx: Ctx, plan: PlanModel, selected: Sequence[Task], wid: str, statuses: Mapping[str, dict],
                limits: Mapping[str, int], decision: Mapping[str, Any], profile: Mapping[str, Any],
                policy: Mapping[str, Any], critical: set[str], frags: Mapping[str, wavejs.Fragment], pre_t0: bool,
                gate_sha: str | None = None) -> tuple[dict, dict]:
    layout = ctx.layout
    mode = _workspace_mode(profile, decision, pre_t0)
    man, extra, bctxs = build_manifest(ctx, plan, selected, wave=wid, statuses=statuses, limits=limits,
                                       workspace_mode=mode, critical=critical, profile=profile, pre_t0=pre_t0,
                                       gate_sha=gate_sha)
    man["fragments"] = [{"name": f.name, "source_path": posix(f.source_path), "sha256": f.sha256}
                        for f in sorted(frags.values(), key=lambda f: wavejs.FRAGMENT_ORDER.index(f.name))]
    files: list[tuple[Path, str]] = []
    for t in selected:
        frag = _fragment_of(t) if not pre_t0 else None
        if frag is not None:
            item = next(i for i in man["tasks"] if i["task"] == t.id)
            _e, fe_files = fe_entry(ctx, t, frag, attempt=item["attempt"], rerun=item["rerun"], wave=wid,
                                    profile=profile)
            files += fe_files
    project = str(plan.raw.get("project"))
    script = wavejs.render(man, list(frags.values()), extra=extra,
                           description=_description(wid, project, [i["task"] for i in man["tasks"]]))
    problems = wavejs.static_check(script, source=f"waves/{wid}.js")
    if problems:
        raise CheckFailed(problems[0].message, code="E_WAVE_FORBIDDEN_TOKEN", items=problems,
                          hint="a forbidden token reached the generated script; nothing was written")
    warnings: list[ErrorItem] = []
    check = _node_check_text(script, wid)
    if check is None:
        warnings.append(ErrorItem("W_NODE_MISSING", "node not found: the syntax check of the wave script was skipped",
                                  hint="the launch result's error field will catch a syntax error"))
    elif check.exit_code != 0:
        raise CheckFailed(f"waves/{wid}.js fails the syntax check: {_check_failure(check)}", code="E_CHECK",
                          hint="a bug in the wave template or an inlined fragment; nothing was written")
    man["script_sha256"] = jsonio.sha256_bytes(script.encode("utf-8"))
    brief_files: list[tuple[Path, str]] = []
    for t in selected:
        item = next(i for i in man["tasks"] if i["task"] == t.id)
        for n in [item["attempt"]] + list(item.get("fix_attempts") or ()):
            b = bctxs[f"{t.id}.a{n}"]
            findings = None
            if n >= 2:
                found = results.find_any_wave(layout, t.id, "verifier", n - 1)
                findings = (f"local/results/{found[0]}/{t.id}.verifier.a{n - 1}.json" if found
                            else f"local/results/{wid}/{t.id}.verifier.a{n - 1}.json")
            resume = f"briefs/{t.id}.resume.md" if (layout.state / "briefs" / f"{t.id}.resume.md").is_file() else None
            text = briefs.render(t, plan, profile, policy, layout, role=b.chain[0], attempt=n, rerun=b.rerun, wave=wid,
                                 findings=findings, resume_note=resume, bctx=b)
            brief_files.append((layout.brief(t.id, n), text))
    estimate = _estimate(selected, limits["writers"])
    data = {
        "wave": wid, "script_path": posix(layout.wave_script(wid)), "manifest_path": posix(layout.wave_manifest(wid)),
        "tasks": [{"task": i["task"], "lane": i["lane"], "chain": i["chain"], "critical": i["critical"],
                   "model": _first_agent(i).get("model"), "effort": _first_agent(i).get("effort")}
                  for i in man["tasks"]],
        "lanes": [{"lane": ln["lane"], "workspace_mode": ln["workspace_mode"]} for ln in man["lanes"]],
        "limits": man["limits"], "estimate": estimate, "pre_t0": pre_t0,
        "workflow_call": {"scriptPath": posix(layout.wave_script(wid)), "name": man["workflow_name"],
                          "args": {"now_utc": man["args"]["now_utc"], "skip": []}},
        "next": [f"Workflow(workflow_call) now, then {exec_cmd()} wave launched --wave {wid} --run-id <runId> "
                 "--transcript-dir <dir>"],
    }
    return data, {"briefs": brief_files, "files": files, "script": script, "manifest": man, "warnings": warnings}


def _first_agent(item: Mapping[str, Any]) -> dict:
    for role in item["chain"]:
        a = (item.get("agents") or {}).get(role)
        if a:
            return a
    return {}


def _estimate(tasks: Sequence[Task], writers: int) -> dict:
    lane50: dict[str, float] = {}
    lane80: dict[str, float] = {}
    tot50 = tot80 = usd = 0.0
    for t in tasks:
        d50 = float(t.estimate.p50) + _verify_p50(t)
        d80 = _p80(t) + _verify_p50(t)
        k = t.lane or t.id
        lane50[k] = lane50.get(k, 0.0) + d50
        lane80[k] = lane80.get(k, 0.0) + d80
        tot50 += d50
        tot80 += d80
        usd += float((t.raw.get("tokens_est") or {}).get("usd_list") or 0.0)
    w = max(writers, 1)
    return {"p50_min": round(max(max(lane50.values(), default=0.0), tot50 / w), 1),
            "p80_min": round(max(max(lane80.values(), default=0.0), tot80 / w), 1), "usd_list": round(usd, 2)}


def _check_failure(check: wavejs.NodeCheck) -> str:
    if check.timed_out:
        return f"node did not finish within {wavejs.NODE_TIMEOUT_S:g} s"
    return f"exit {check.exit_code}: {(check.stderr or check.stdout)[-400:]}"


def _node_check_text(script: str, wid: str) -> wavejs.NodeCheck | None:
    """The syntax check of a rendered script before anything is written (a temp copy outside the state). None when
    node is absent: the caller warns W_NODE_MISSING (WAVES.md 2.3)."""
    if wavejs.node_exe() is None:
        _LOG.warning("node not found: the syntax check of a generated script is skipped", extra={"data": {"wave": wid}})
        return None
    tmp = Path(tempfile.mkdtemp(prefix="exec-wave-"))
    try:
        path = tmp / f"{wid}.js"
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(script)
        return wavejs.node_check(path)
    finally:
        wavejs.remove_temp_dir(tmp)


def cmd_emit(ctx: Ctx, args: Namespace) -> CommandResult:
    return emit(ctx, max_tasks=getattr(args, "max_tasks", None), include=list(getattr(args, "include", []) or []),
                wave=getattr(args, "wave", None), force_critical=bool(getattr(args, "force_critical", False)),
                pre_t0=bool(getattr(args, "pre_t0", False)))


# ================================================================================================ launched

def launched(ctx: Ctx, wave: str, run_id: str | None, transcript_dir: str | None, error: str | None,
             relaunch: bool) -> CommandResult:
    """CLI.md `wave launched`."""
    executor = _need_executor(ctx)
    layout = ctx.layout
    wave_num(wave)
    with status.state_lock(ctx):
        man = _manifest(layout, wave)
        if man is None:
            raise UsageError(f"--wave {wave}: no such wave")
        if man.get("executor") != executor:
            raise PolicyRefused(f"wave {wave} belongs to executor {man.get('executor')}", code="E_POLICY")
        script = layout.wave_script(wave)
        actual = jsonio.sha256_file(script) if script.exists() else None
        if actual != man.get("script_sha256"):
            raise ImmutableFile(f"waves/{wave}.js bytes differ from the manifest's script_sha256", code="E_IMMUTABLE",
                                hint="a wave script is never edited after emission; re-emit or relaunch the original")
        plan = planmod.load(layout)
        st = state.load(layout)
        doc = statusio.load(layout, executor)
        launch = dict(man.get("launch") or {})
        cur_status = man.get("status")
        at = clock.format_utc(ctx.now)
        tdir = posix(transcript_dir) if transcript_dir else launch.get("transcript_dir")
        if tdir and not re.match(r"^([A-Za-z]:/|/)", tdir):
            raise UsageError(f"--transcript-dir {tdir} is not an absolute path")
        changed = False
        result_status = "launched"
        errors: list[ErrorItem] = []
        skip: list[str] = list((man.get("args") or {}).get("skip") or [])
        if error is not None:
            if cur_status not in ("launching", "launched"):
                raise UsageError(f"wave {wave} is {cur_status}: a launch error is recorded only on a launching wave")
            text = redact(error.strip())[:2000] or "launch error (empty text)"
            man["status"] = "launch-failed"
            man["launch"] = {"at_utc": at, "run_id": run_id, "transcript_dir": tdir, "error": text,
                             "relaunches": int(launch.get("relaunches") or 0)}
            _write_manifest(layout, man)
            moved = []
            replanned = []
            for item in man["tasks"]:
                task = plan.by_id.get(item["task"])
                if task is not None and status.current_status(doc, task.id) == "running" and not man.get("pre_t0"):
                    status.transition(ctx, doc, task, "ready", evidence=[_ev("launch-failed", wave)], plan=plan)
                    moved.append(task.id)
            # An in-wave dependent was `planned` at emit: with its dependency back to ready it is not ready
            # (SCHEMAS.md 4.1, "dependencies done"). SCHEMAS.md 4.2 gives `wave launched` only `running -> ready`, so
            # the `ready -> planned` row `schedule` applies at its next tick is applied here at once, under the same
            # lock, through that row and its own evidence check (a dependency not done); the history names that
            # row's command (contract question Q-B05-15 proposes a direct row for `wave launched`).
            as_schedule = status.with_command(ctx, "schedule")
            others: dict[str, dict] = {}

            def dep_done(dep_id: str) -> bool:
                dep = plan.by_id.get(dep_id)
                if dep is None:
                    return False
                if dep.executor == executor:
                    return status.current_status(doc, dep_id) == "done"
                if dep.executor not in others:
                    others[dep.executor] = statusio.load(layout, dep.executor)
                return status.current_status(others[dep.executor], dep_id) == "done"

            for tid in moved:
                task = plan.by_id[tid]
                if all(dep_done(d) for d in task.depends_on):
                    continue
                status.transition(as_schedule, doc, task, "planned", evidence=["dependency-not-done"], plan=plan,
                                  reason=f"launch of {wave} failed while a dependency is not done")
                replanned.append(tid)
            if moved:
                statusio.save(ctx, doc)
            events.append(ctx, "wave.launch-failed", {"wave": wave, "run_id": run_id, "tasks": moved,
                                                      "replanned": replanned})
            result_status = "launch-failed"
            errors.append(ErrorItem("E_CHECK", f"wave {wave} failed to launch: {text[:300]}",
                                    hint=f"fix the cause, then {exec_cmd()} wave emit --wave {wave}"))
            changed = True
        elif relaunch:
            if cur_status not in ("launched", "finished"):
                raise UsageError(f"wave {wave} is {cur_status}: --relaunch applies to a launched wave",
                                 hint="a launch-failed or abandoned wave is re-emitted with wave emit --wave")
            done = sorted(i["task"] for i in man["tasks"]
                          if status.current_status(doc, i["task"]) == "done")
            skip = done
            man["args"] = {"now_utc": man["args"]["now_utc"], "skip": skip}
            man["status"] = "launched"
            man["launch"] = {"at_utc": at, "run_id": run_id, "transcript_dir": tdir, "error": None,
                             "relaunches": int(launch.get("relaunches") or 0) + 1}
            _write_manifest(layout, man)
            events.append(ctx, "wave.launched", {"wave": wave, "run_id": run_id, "relaunch": True, "skip": skip})
            changed = True
        elif cur_status == "launched":
            if launch.get("run_id") != run_id:
                raise UsageError(f"wave {wave} is already launched with run {launch.get('run_id')}",
                                 hint="a second launch of the same wave is recorded with --relaunch")
        elif cur_status == "launching":
            man["status"] = "launched"
            man["launch"] = {"at_utc": at, "run_id": run_id, "transcript_dir": tdir, "error": None, "relaunches": 0}
            _write_manifest(layout, man)
            events.append(ctx, "wave.launched", {"wave": wave, "run_id": run_id})
            changed = True
        else:
            raise UsageError(f"wave {wave} is {cur_status}: nothing to record")
        if changed:
            waves_list = [w for w in st.get("waves") or () if w.get("wave") != wave]
            old = next((w for w in st.get("waves") or () if w.get("wave") == wave), {})
            waves_list.append({"wave": wave, "status": man["status"], "manifest": f"waves/{wave}.json",
                               "run_id": run_id, "transcript_dir": tdir,
                               "session_id": os.environ.get("CLAUDE_CODE_SESSION_ID") or old.get("session_id"),
                               "launched_utc": at if result_status == "launched" else old.get("launched_utc"),
                               "finished_utc": None, "tasks": [i["task"] for i in man["tasks"]]})
            st["waves"] = sorted(waves_list, key=lambda w: wave_num(w["wave"]))
            state.save(ctx, st)
        doc = statusio.load(layout, executor)
        running = sorted(i["task"] for i in man["tasks"]
                         if status.current_status(doc, i["task"]) in ("running", "built", "verifying"))
        data = {"wave": wave, "status": result_status, "tasks_running": running, "skip": skip,
                "workflow_call": {"scriptPath": man["script_path"], "name": man["workflow_name"],
                                  "args": {"now_utc": man["args"]["now_utc"], "skip": skip}}}
    if result_status == "launch-failed":
        return CommandResult(data=data, exit_code=1, errors=errors)
    if run_id is None:
        return CommandResult(data=data, warnings=[ErrorItem("W_RUN_ID_MISSING", "launch recorded without a run id",
                                                            hint="resumeFromRunId needs the run id")])
    return CommandResult(data=data)


def cmd_launched(ctx: Ctx, args: Namespace) -> CommandResult:
    error = None
    if getattr(args, "error_file", None):
        path = Path(args.error_file)
        if not path.is_file():
            raise UsageError(f"--error-file {posix(path)} does not exist")
        error = path.read_bytes().decode("utf-8", "replace")
    return launched(ctx, args.wave, getattr(args, "run_id", None), getattr(args, "transcript_dir", None), error,
                    bool(getattr(args, "relaunch", False)))


# ================================================================================================ ingest

def _md_cell(text: Any) -> str:
    s = redact(str(text if text is not None else ""))
    s = s.replace("\r", " ").replace("\n", " ").replace("|", "\\|").strip()
    return s or "-"


# /hackathon's ledger formats (assets/claims.md, assets/dx-journal.md): the header cell that opens each table, and
# the same columns as a minimal file for a machine without /hackathon (logged, never silent).
LEDGER_HEADER: Mapping[str, str] = {"claims.md": "| # |", "dx-journal.md": "| When (UTC) |"}
LEDGER_FALLBACK: Mapping[str, str] = {
    "claims.md": ("# Claims ledger\n\n| # | claim, as it will be said or shown | where it appears | evidence | status |"
                  "\n|---|---|---|---|---|\n"),
    "dx-journal.md": ("# DX journal\n\n| When (UTC) | Who | Where (page / endpoint / tool / version) | What I tried | "
                      "What happened (exact text) | Time lost |\n|---|---|---|---|---|---|\n"),
}
_TABLE_RULE_RE = re.compile(r"^\|(\s*:?-+:?\s*\|)+\s*$")


def _table_span(lines: Sequence[str], header_prefix: str) -> tuple[int, int] | None:
    """(header line index, index after the table's last row) of the first table whose header starts with
    `header_prefix`, or None."""
    for i, line in enumerate(lines):
        if line.startswith(header_prefix) and i + 1 < len(lines) and _TABLE_RULE_RE.match(lines[i + 1]):
            end = i + 2
            while end < len(lines) and lines[end].startswith("|"):
                end += 1
            return i, end
    return None


def _placeholder_row(line: str) -> bool:
    """A template row with nothing in it (`| 1 |  |  |  | unverified |`, `|  |  |  |  |  |  |`)."""
    cells = [c.strip() for c in line.strip().strip("|").split("|")]
    return not [c for c in cells if c and not re.fullmatch(r"[0-9]+", c) and c != "unverified"]


def _ledger_template(name: str) -> str:
    """A new ledger from /hackathon's template, its empty placeholder rows dropped (a ledger exec.py creates never
    holds an empty `unverified` claim); the minimal fallback when the template is unreadable or has no table."""
    path = other_skill("hackathon") / "assets" / name
    try:
        text = path.read_bytes().decode("utf-8").replace("\r\n", "\n")
    except (OSError, UnicodeDecodeError) as err:
        _LOG.warning("/hackathon's ledger template is unreadable; a minimal ledger with the same columns is used",
                     extra={"data": {"path": posix(path), "error": str(err)}})
        return LEDGER_FALLBACK[name]
    lines = text.split("\n")
    span = _table_span(lines, LEDGER_HEADER[name])
    if span is None:
        _LOG.warning("/hackathon's ledger template has no table with the expected header; a minimal ledger is used",
                     extra={"data": {"path": posix(path), "header": LEDGER_HEADER[name]}})
        return LEDGER_FALLBACK[name]
    start, end = span
    return "\n".join(lines[:start + 2] + [ln for ln in lines[start + 2:end] if not _placeholder_row(ln)]
                     + lines[end:])


def append_rows(path: Path, rows: Sequence[tuple[str, str]], *, template: str, claims: bool) -> list[str]:
    """Add keyed rows `(key, row text without the comment)` whose key is absent, inside the ledger's table, after
    its last row (the /hackathon templates go on with sections below the table). For claims the `C-{n}` first cell
    is numbered in ledger order. Returns the keys added; a ledger holding every key is left byte for byte."""
    text = path.read_bytes().decode("utf-8") if path.exists() else _ledger_template(template)
    text = text.replace("\r\n", "\n")
    present = set(re.findall(r"<!-- (exec:[^ ]+) -->", text))
    added: list[str] = []
    out_lines: list[str] = []
    n = max([int(m) for m in re.findall(r"^\| C-([0-9]+) \|", text, re.M)] or [0])
    for key, row in rows:
        if key in present:
            continue
        if claims:
            n += 1
            row = row.replace("| C-{n} |", f"| C-{n:03d} |", 1)
        out_lines.append(f"{row} <!-- {key} -->")
        present.add(key)
        added.append(key)
    if not added:
        return []
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    span = _table_span(lines, LEDGER_HEADER[template])
    if span is None:
        _LOG.warning("the ledger has no table with the expected header; one is added at its end",
                     extra={"data": {"path": posix(path), "header": LEDGER_HEADER[template]}})
        header = LEDGER_FALLBACK[template].split("\n")[2:4]
        lines += ([""] if lines and lines[-1].strip() else []) + header + out_lines
    else:
        lines = lines[:span[1]] + out_lines + lines[span[1]:]
    jsonio.write_text_atomic(path, "\n".join(lines) + "\n")
    return added


def _dx_rows(wave: str, tid: str, attempt: int, doc: Mapping[str, Any]) -> list[tuple[str, str]]:
    rows = []
    for i, r in enumerate(doc.get("dx_rows") or ()):
        key = f"exec:{wave}:{tid}:implementer:a{attempt}:{i}"
        happened = f"{_md_cell(r.get('happened'))} — reproduce: {_md_cell(r.get('reproduce'))} — UNVERIFIED"
        rows.append((key, f"| {_md_cell(r.get('when_utc'))} | execution-implementer {tid} | {_md_cell(r.get('where'))} "
                          f"| {_md_cell(r.get('tried'))} | {happened} | {_md_cell(r.get('time_lost_min'))} min |"))
    return rows


def _claim_rows(wave: str, tid: str, attempt: int, doc: Mapping[str, Any]) -> list[tuple[str, str]]:
    rows = []
    for i, r in enumerate(doc.get("claims_rows") or ()):
        key = f"exec:{wave}:{tid}:verifier:a{attempt}:{i}"
        rows.append((key, f"| C-{{n}} | {_md_cell(r.get('claim'))} | {_md_cell(r.get('where'))} | "
                          f"{_md_cell(r.get('evidence'))} | unverified |"))
    return rows


def _put_leftovers(ctx: Ctx, wave: str, man: Mapping[str, Any], journal: Path | None, errors: list[ErrorItem]) -> int:
    """Results an agent wrote in the inbox but never put, and results recovered from the workflow journal."""
    layout = ctx.layout
    ids = {t["task"] for t in man.get("tasks") or ()}
    count = 0
    if journal is not None:
        if not journal.is_file():
            raise UsageError(f"--journal {posix(journal)} does not exist")
        for tid, role, attempt, doc in results.recover_from_journal(journal):
            if tid not in ids or role not in AGENT_RESULT_ROLES or doc.get("wave") not in (None, wave):
                continue
            if results.find_any_wave(layout, tid, role, attempt) is not None:
                continue
            inbox = layout.inbox(wave) / f"{tid}.{role}.a{attempt}.json"
            if not inbox.exists():
                jsonio.write_json_atomic(inbox, doc)
    folder = layout.inbox(wave)
    if folder.is_dir():
        for path in sorted(folder.iterdir()):
            m = _INBOX_RESULT_RE.match(path.name)
            if not m or m.group(1) not in ids:
                continue
            try:
                results.put(ctx, wave=wave, task=m.group(1), role=m.group(2), attempt=int(m.group(3)), file=path)
                count += 1
            except ValidationFailed as err:
                errors += [ErrorItem("E_SCHEMA", f"{path.name}: {i.message}", path=i.path, task=m.group(1))
                           for i in err.items()][:10]
            except ImmutableFile as err:
                errors.append(ErrorItem("E_RESULT_IMMUTABLE", f"{path.name}: {err.message}", task=m.group(1)))
    return count


def _journal_errors(journal: Path | None, tid: str) -> str:
    if journal is None or not journal.is_file():
        return ""
    found = ""
    for n, doc in jsonio.read_jsonl(journal):
        if isinstance(doc, ErrorItem):
            _LOG.warning("a workflow journal line is not JSON: skipped while looking for a thrown agent call",
                         extra={"data": {"journal": posix(journal), "line": n, "task": tid, "error": doc.message}})
            continue
        text = json.dumps(doc, ensure_ascii=False)
        if tid in text and "threw" in text:
            m = re.search(re.escape(tid) + r"[^\"]*threw[^\"]*", text)
            found = redact(m.group(0) if m else text)[:300]
    return found


def _last_outcomes(layout: Layout, wave: str) -> dict[str, str]:
    evs, _e = events.read_all(layout)
    out: dict[str, str] = {}
    for ev in evs:
        if ev["type"] == "wave.ingested" and (ev.get("data") or {}).get("wave") == wave:
            out = dict((ev["data"].get("outcomes") or {}))
    return out


def _js_number(x: int | float) -> str:
    """ECMAScript Number::toString for a JSON number (what JSON.stringify prints): shortest round-trip digits,
    positional between 1e-7 and 1e21, an `e+n`/`e-n` exponent outside."""
    if isinstance(x, int):
        return str(x)
    if x != x or x in (float("inf"), float("-inf")):
        return "null"
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    text = repr(abs(x))
    mant, _e, exp_text = text.partition("e")
    whole, _dot, frac = mant.partition(".")
    raw = whole + frac
    stripped = raw.lstrip("0")
    n = len(whole) + (int(exp_text) if exp_text else 0) - (len(raw) - len(stripped))
    digits = stripped.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        body = digits + "0" * (n - k)
    elif 0 < n <= 21:
        body = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        body = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        body = (digits if k == 1 else digits[0] + "." + digits[1:]) + "e" + ("+" if e > 0 else "-") + str(abs(e))
    return sign + body


def js_stringify(obj: Any) -> str:
    """JSON.stringify(obj) with no indent, for JSON-parsed data: object keys in their insertion order (Python's
    json keeps it), numbers as JS prints them, strings escaped as JS escapes them (the same set as json.dumps with
    ensure_ascii=False). Used to recompute /frontend's receipt checksum exactly as the fragment computed it."""
    if obj is None:
        return "null"
    if obj is True:
        return "true"
    if obj is False:
        return "false"
    if isinstance(obj, (int, float)):
        return _js_number(obj)
    if isinstance(obj, str):
        return json.dumps(obj, ensure_ascii=False)
    if isinstance(obj, list):
        return "[" + ",".join(js_stringify(v) for v in obj) + "]"
    if isinstance(obj, dict):
        return "{" + ",".join(json.dumps(str(k), ensure_ascii=False) + ":" + js_stringify(v)
                              for k, v in obj.items()) + "}"
    raise InternalError(f"js_stringify: unsupported value of type {type(obj).__name__}", code="E_INTERNAL")


def fnv1a32(text: str) -> str:
    """/frontend's `fnv1a32` (critique.js): FNV-1a over the UTF-16 code units JS's charCodeAt returns, 8 hex."""
    data = text.encode("utf-16-le")
    h = 0x811C9DC5
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def critique_checksum_problem(receipt: Mapping[str, Any], layout: Layout) -> str | None:
    """FRONTEND.md 9.4 for a feCritique receipt copy: its checksum recomputed as the fragment's `seal()` does
    (`fnv1a32:` + fnv1a32 of JSON.stringify of the receipt without `checksum`) must equal its own field and the
    checksum of the fragment's receipt file. None when all three agree."""
    unsealed = {k: v for k, v in receipt.items() if k != "checksum"}
    expected = "fnv1a32:" + fnv1a32(js_stringify(unsealed))
    if receipt.get("checksum") != expected:
        return f"checksum {receipt.get('checksum')!r} does not match the recomputed {expected}"
    own = receipt.get("receipt_path")
    state_receipt = Path(own) if isinstance(own, str) and own else layout.state / "frontend" / "critique" / "receipt.json"
    try:
        written = jsonio.read_json(state_receipt)
    except FileNotFoundError:
        return f"the fragment's own receipt {posix(state_receipt)} is absent"
    except (ValidationFailed, ValueError, OSError) as err:
        return f"the fragment's own receipt {posix(state_receipt)} is unreadable: {err}"
    if not isinstance(written, dict) or written.get("checksum") != expected:
        got = written.get("checksum") if isinstance(written, dict) else None
        return f"the fragment's own receipt {posix(state_receipt)} has checksum {got!r}, not {expected}"
    return None


_FINAL: Mapping[str, str] = {"done": "done", "built": "built", "verifying": "verifying",
                             "blocked-manual": "blocked-manual", "blocked-decision": "blocked-decision",
                             "cut": "recorded", "cut-proposed": "recorded", "superseded": "recorded"}


STILL_RUNNING = "running"      # internal: a partial ingest left the task to the live wave (not an outcome)


class _Ingest:
    """One `wave ingest` pass over a manifest (state lock held). `finished` (the completion notification arrived):
    a task that left no file is a rerun (or the script's skipped-dep / infra-error hint). Without it (a partial
    reconcile after a crash) such a task is left `running` and a failed task whose prepared fix attempt may still be
    running stays `failed`: only evidence on disk moves anything."""

    def __init__(self, ctx: Ctx, man: dict, plan: PlanModel, doc: dict, st: dict, hints: Mapping[str, str],
                 journal: Path | None, finished: bool = True) -> None:
        self.ctx = ctx
        self.layout = ctx.layout
        self.man = man
        self.wave = man["wave"]
        self.plan = plan
        self.doc = doc
        self.st = st
        self.hints = hints
        self.journal = journal
        self.finished = finished
        self.git = status.product_git(ctx.layout)
        self.applied: list[dict] = []
        self.proposals: list[str] = []
        self.mismatches: list[dict] = []
        self.dirty = False

    # -- transitions ---------------------------------------------------------------------------------------------
    def _try(self, task: Task, to: str, evidence: list[str]) -> bool:
        before = status.current_status(self.doc, task.id)
        try:
            status.transition(self.ctx, self.doc, task, to, evidence=evidence, plan=self.plan, git=self.git)
        except PolicyRefused as err:
            _LOG.debug("transition not applied", extra={"data": {"task": task.id, "to": to, "why": err.message}})
            return False
        self.applied.append({"task": task.id, "from": before, "to": to})
        self.dirty = True
        return True

    def _propose(self, kind: str, title: str, tasks: list[str], options: list[dict] | None = None,
                 recommended: str | None = None) -> str:
        did, dedup = decisions.propose(self.ctx, kind=kind, title=title[:160],
                                       options=options or decisions.default_options(kind), tasks=tasks,
                                       deadline=None, recommended=recommended)
        if did not in self.proposals:
            self.proposals.append(did)
        if not dedup:
            self.dirty = True
        return did

    def _rerun(self, task: Task) -> str:
        new = reconcile.apply_rerun(self.ctx, self.doc, task, self.wave, self.plan, self.st)
        self.applied.append({"task": task.id, "from": "running", "to": new})
        self.dirty = True
        return "rerun" if new == "ready" else "blocked-decision"

    # -- evidence readers ----------------------------------------------------------------------------------------
    def _result(self, tid: str, role: str, attempt: int) -> tuple[str, dict] | None:
        found = results.find_any_wave(self.layout, tid, role, attempt)
        if found is None:
            return None
        return f"local/results/{found[0]}/{tid}.{role}.a{attempt}.json", found[1]

    def _failed_merge(self, tid: str, attempt: int) -> str | None:
        for path, doc in status.merge_receipts(self.layout, tid, attempt=attempt):
            if doc.get("outcome") in status.FAILED_MERGE_OUTCOMES:
                return self.layout.rel(path)
        return None

    def _check_impl_vs_receipt(self, tid: str, attempt: int) -> None:
        impl = self._result(tid, "implementer", attempt)
        landed = status.landed_merge(self.layout, tid, attempt)
        if impl is None:
            return
        merge = impl[1].get("merge") or {}
        if landed is not None and merge.get("landed_sha") and merge.get("landed_sha") != landed[1]["landed_sha"]:
            self.mismatches.append({"task": tid, "code": "E_RESULT_RECEIPT_MISMATCH",
                                    "detail": "implementer result names another landed SHA than the merge receipt"})
        if landed is None and merge.get("outcome") == "landed":
            self.mismatches.append({"task": tid, "code": "E_RESULT_RECEIPT_MISMATCH",
                                    "detail": "implementer result says landed; no landed merge receipt exists"})

    def _check_verifier_vs_receipt(self, tid: str, attempt: int) -> None:
        ver = self._result(tid, "verifier", attempt)
        if ver is None:
            return
        receipt = status.load_receipt(self.layout, tid)
        doc = ver[1]
        if doc.get("receipt_sha256"):
            if receipt is None:
                self.mismatches.append({"task": tid, "code": "E_RESULT_RECEIPT_MISMATCH",
                                        "detail": "verifier result names a receipt; proofs/<task>.json is absent"})
                return
            if receipt.get("attempt") == attempt and receipt.get("verdict") != doc.get("verdict"):
                self.mismatches.append({"task": tid, "code": "E_RESULT_RECEIPT_MISMATCH",
                                        "detail": f"verifier result says {doc.get('verdict')}, the receipt says "
                                                  f"{receipt.get('verdict')}"})

    def _check_fragment_receipt(self, tid: str, item: Mapping[str, Any]) -> None:
        """FRONTEND.md 9.4: the receipt copy the wave script left in the inbox validates against /frontend's receipt
        schema, and for feCritique its fnv1a32 checksum is recomputed and must equal both the copy's own field and
        the fragment's receipt file (`receipt_path`, by default `<state>/frontend/critique/receipt.json`). A failure
        is E_RESULT_RECEIPT_MISMATCH (exit 1); the verdict still rests only on the verifier's proof run, and no row
        of SCHEMAS.md 4.2 fails an attempt on a receipt, so no transition is forced here (Q-B05-4). /frontend's
        schema absent: E_DEPENDENCY_MISSING with a dependency-missing decision (FRONTEND.md 12), never a pass."""
        for step in item.get("chain") or ():
            if step not in FE_RECEIPT_SCHEMA:
                continue
            path = self.layout.inbox(self.wave) / f"{tid}.{step}.a{item['attempt']}r{item.get('rerun', 0)}.json"
            if not path.is_file():
                continue        # never copied (the script logged why): nothing to compare; the verifier decides
            schema_path = other_skill("frontend") / "assets" / "schemas" / FE_RECEIPT_SCHEMA[step]
            if not schema_path.is_file():
                did = self._fe_dependency(f"Schéma de reçu /frontend absent : {posix(schema_path)}", tid)
                self.mismatches.append({"task": tid, "code": "E_DEPENDENCY_MISSING",
                                        "detail": f"{posix(schema_path)} is absent: the {step} receipt "
                                                  f"{path.name} cannot be checked (decision {did})"})
                continue
            schemamod = wavejs.schema      # wave -> schema is not an edge of MODULES.md 8 (Q-B05-6)
            try:
                doc = jsonio.read_json(path)
                sdoc = jsonio.read_json(schema_path)
                report = schemamod.validate_with(doc, sdoc, base_dir=schema_path.parent)
            except (ValidationFailed, ValueError, OSError) as err:
                self.mismatches.append({"task": tid, "code": "E_RESULT_RECEIPT_MISMATCH",
                                        "detail": f"{path.name} unreadable: {err}"})
                continue
            if not report.ok:
                self.mismatches.append({"task": tid, "code": "E_RESULT_RECEIPT_MISMATCH",
                                        "detail": f"{path.name} fails {FE_RECEIPT_SCHEMA[step]}: "
                                                  f"{report.issues[0].message}"})
                continue
            if step == "fe-critique":
                problem = critique_checksum_problem(doc, self.layout)
                if problem:
                    self.mismatches.append({"task": tid, "code": "E_RESULT_RECEIPT_MISMATCH",
                                            "detail": f"{path.name}: {problem}"})

    def _fe_dependency(self, title: str, tid: str) -> str:
        did, dedup = _propose_dependency(self.ctx, title, [tid])
        if did not in self.proposals:
            self.proposals.append(did)
        if not dedup:
            self.dirty = True
        return did

    # -- one task ------------------------------------------------------------------------------------------------
    def task(self, item: Mapping[str, Any]) -> str:
        tid = item["task"]
        task = self.plan.by_id.get(tid)
        if task is None:
            return "recorded"
        hint = self.hints.get(tid)
        if self.man.get("pre_t0"):
            return self._pre_t0(task, item, hint)
        fixes = list(item.get("fix_attempts") or ())
        for _guard in range(12):
            cur = status.current_status(self.doc, tid)
            entry = status.entry_of(self.doc, tid)
            a = status.current_attempt(entry)
            if cur in _FINAL and cur not in ("built", "verifying"):
                return _FINAL[cur]
            if cur == "running":
                self._check_impl_vs_receipt(tid, a)
                if self._try(task, "built", []):
                    continue
                impl = self._result(tid, "implementer", a)
                failed_merge = self._failed_merge(tid, a)
                if impl is not None:
                    idoc = impl[1]
                    if idoc.get("status") == "blocked":
                        return self._blocked(task, impl)
                    merge = idoc.get("merge") or {}
                    if merge.get("exit_code") == 3 and failed_merge is None:
                        return self._rerun(task)
                    if idoc.get("status") == "failed" or failed_merge:
                        ev = [impl[0]] + ([failed_merge] if failed_merge else [])
                        if self._try(task, "failed", ev):
                            continue
                    return self._rerun(task)
                if failed_merge:
                    if self._try(task, "failed", [failed_merge]):
                        continue
                if not self.finished:
                    return STILL_RUNNING          # no file yet: the live wave may still be working on it
                if hint == "skipped-dep" and self._try(task, "planned", [_ev("skipped-dep", self.wave)]):
                    return "skipped-dep"
                if hint == "infra-error":
                    return self._infra(task)
                if hint == "failed" and set(item.get("chain") or ()) & set(FE_RECEIPT_SCHEMA):
                    self.mismatches.append({"task": tid, "code": "W_FRAGMENT_FAILED",
                                            "detail": "fragment receipt not ok: counted as a rerun (Q-B05-4)"})
                return self._rerun(task)
            if cur == "built":
                if self._try(task, "verifying", []):
                    continue
                return self._throw_after_landing(task, item, hint, a) or "built"
            if cur == "verifying":
                self._check_verifier_vs_receipt(tid, a)
                if self._try(task, "done", []):
                    return "done"
                if self._try(task, "failed", []):
                    continue
                return self._throw_after_landing(task, item, hint, a) or "verifying"
            if cur == "failed":
                nxt = a
                fix_evidence = (self.layout.local / "results" / self.wave / f"{tid}.implementer.a{nxt}.json").is_file() \
                    or (self.layout.local / "results" / self.wave / f"{tid}.merge.a{nxt}.json").is_file() \
                    or (self.layout.local / "results" / self.wave / f"{tid}.test-designer.a{nxt}.json").is_file()
                if nxt in fixes and fix_evidence and self._try(task, "running", [_ev("fix-attempt", self.wave)]):
                    continue
                if nxt in fixes and not self.finished:
                    return STILL_RUNNING          # the prepared fix attempt may still be running in this wave
                attempts = int((entry or {}).get("attempts", 0))
                if attempts < task.max_attempts:
                    self._try(task, "ready", [])
                    return "failed"
                did = self._propose("retry-exhausted", f"{tid} : tentatives épuisées ({attempts}/{task.max_attempts})",
                                    [tid], recommended="retry")
                self._try(task, "blocked-decision", [_ev("decision", did)])
                return "blocked-decision"
            if cur in ("ready", "planned"):
                return self.previous.get(tid, "rerun" if cur == "ready" else "skipped-dep")
            return _FINAL.get(cur, "recorded")
        return _FINAL.get(status.current_status(self.doc, tid), "recorded")

    previous: Mapping[str, str] = {}

    def _blocked(self, task: Task, impl: tuple[str, dict]) -> str:
        blocked = impl[1].get("blocked") or {}
        kind = blocked.get("kind") or "decision"
        reason = str(blocked.get("reason") or "blocked")
        if kind == "manual":
            did = self._propose("plan-task", f"{task.id} : étape manuelle nécessaire — {reason}", [task.id])
            self._try(task, "blocked-manual", [impl[0], _ev("decision", did)])
            return "blocked-manual"
        if kind == "decision":
            did = self._propose("spec-gap", f"{task.id} : décision nécessaire — {reason}", [task.id])
            self._try(task, "blocked-decision", [impl[0], _ev("decision", did)])
            return "blocked-decision"
        did = self._propose("dependency-missing", f"{task.id} : dépendance manquante — {reason}", [task.id],
                            recommended="fixed")
        # an implementer's `blocked.kind: dependency` has no row of its own in SCHEMAS.md 4.2; lane B04's check
        # accepts it only as the infra-error family with a dependency-missing proposal (Q-B05-9)
        self._try(task, "blocked-decision", [_ev("infra-error", self.wave), _ev("decision", did)])
        return "blocked-decision"

    def _infra_decision(self, task: Task) -> str:
        """The dependency-missing decision of an `agent()` throw, quoting the error the script logged (SCHEMAS.md
        4.4 and the `running -> blocked-decision` row of 4.2)."""
        logged = _journal_errors(self.journal, task.id) or "an agent() call threw (see the workflow log)"
        if "): " in logged:
            logged = logged.split("): ", 1)[1]       # keep the thrown message, not the script's preamble
        return self._propose("dependency-missing", f"{task.id} : erreur d'infrastructure ({self.wave}) — {logged}",
                             [task.id], recommended="fixed")

    def _infra_resolved(self, tid: str) -> bool:
        """A dependency-missing decision of this wave's throw for `tid` exists and is resolved."""
        prefix = f"{tid} : erreur d'infrastructure ({self.wave})"
        props: set[str] = set()
        resolved: set[str] = set()
        for doc in status.decision_headers(self.layout):
            if doc.get("record") == "proposal" and doc.get("kind") == "dependency-missing" \
                    and str(doc.get("title", "")).startswith(prefix):
                props.add(str(doc["id"]))
            elif doc.get("record") == "resolution":
                resolved.add(str(doc["id"]))
        return bool(props & resolved)

    def _infra(self, task: Task) -> str:
        did = self._infra_decision(task)
        self._try(task, "blocked-decision", [_ev("infra-error", self.wave), _ev("decision", did)])
        return "infra-error"

    def _throw_after_landing(self, task: Task, item: Mapping[str, Any], hint: str | None, attempt: int
                             ) -> str | None:
        """SCHEMAS.md 4.4, "throws are not nulls", for a task that landed (or a gate whose receipt `wave emit`
        wrote) and whose verifier or reviewer then threw: the script's outcome is `infra-error` and the attempt's
        verifier (and reviewer) left no result. The throw is deterministic (WAVES.md 3.5), so relaunching the same
        `[verifier]` chain would throw again wave after wave: the dependency-missing decision is opened exactly as
        for an implementer throw, and while it is open `wave emit` keeps the task out of every wave (Q-B05-2).
        SCHEMAS.md 4.2 has no `built|verifying -> blocked-decision` row, so the status stays built or verifying
        (contract question Q-B05-19). Returns "infra-error", or None when this is not such a case."""
        if not self.finished or hint != "infra-error":
            return None
        chain = list(item.get("chain") or ())
        judges = [r for r in ("reviewer", "verifier") if r in chain]
        if not judges or any(self._result(task.id, r, attempt) is not None for r in judges):
            return None         # a judge answered: its result is the evidence, not the hint
        if self._infra_resolved(task.id):
            return "infra-error"    # the owner already answered this wave's throw: a re-ingest reopens nothing
        did = self._infra_decision(task)
        _LOG.warning("an agent() call threw after the task landed: a decision is open and the task is held",
                     extra={"data": {"task": task.id, "wave": self.wave, "decision": did,
                                     "status": status.current_status(self.doc, task.id)}})
        return "infra-error"

    def _pre_t0(self, task: Task, item: Mapping[str, Any], hint: str | None) -> str:
        impl = self._result(task.id, "implementer", int(item["attempt"]))
        if impl is not None:
            st_ = impl[1].get("status")
            if st_ == "built":
                return "recorded"
            if st_ == "blocked":
                return "blocked-manual" if (impl[1].get("blocked") or {}).get("kind") == "manual" \
                    else "blocked-decision"
            return "failed"
        if hint in ("skipped-dep", "infra-error"):
            return hint
        return "rerun"


def _agent_minutes(man: Mapping[str, Any], doc: Mapping[str, Any]) -> float:
    total = 0.0
    start = clock.parse_utc(man["created_utc"])
    for item in man.get("tasks") or ():
        entry = status.entry_of(doc, item["task"]) or {}
        ends = [clock.parse_utc(h["at_utc"]) for h in entry.get("history") or ()
                if h.get("from") == "running" and clock.parse_utc(h["at_utc"]) >= start]
        if ends:
            total += max(0.0, clock.minutes_between(start, max(ends)))
    return round(total, 3)


def _actual_minutes(entry: Mapping[str, Any]) -> float | None:
    """Minutes from the last move to running to the move to built (implementation time incl. queueing)."""
    hist = list(entry.get("history") or ())
    built = [h for h in hist if h.get("to") == "built"]
    if not built:
        return None
    b = built[-1]
    runs = [h for h in hist if h.get("to") == "running" and h["at_utc"] <= b["at_utc"]]
    if not runs:
        return None
    return clock.minutes_between(clock.parse_utc(runs[-1]["at_utc"]), clock.parse_utc(b["at_utc"]))


def recalibrated(ctx: Ctx, plan: PlanModel, doc: Mapping[str, Any], st: Mapping[str, Any], *, this_wave: dict | None
                 ) -> dict:
    """local-state calibration recomputed from the full set (CLI.md wave ingest): ratios per kind through
    schedule.recalibrate, pct_per_agent_hour from the emitted/ingested quota readings of every wave."""
    done = []
    for t in plan.tasks:
        if t.executor != ctx.executor or t.is_human:
            continue
        entry = status.entry_of(doc, t.id)
        if entry and entry.get("status") == "done":
            actual = _actual_minutes(entry)
            if actual is not None:
                done.append((t, actual))
    cal = schedule.recalibrate(dict(st.get("calibration") or {}), done)
    evs, _e = events.read_all(ctx.layout)
    emitted: dict[str, float] = {}
    pairs: dict[str, tuple[float, float]] = {}
    for ev in evs:
        data = ev.get("data") or {}
        if ev["type"] == "wave.emitted" and isinstance(data.get("quota_seven_day_pct"), (int, float)):
            emitted[data["wave"]] = float(data["quota_seven_day_pct"])
        if ev["type"] == "wave.ingested" and isinstance(data.get("quota_seven_day_pct"), (int, float)) \
                and isinstance(data.get("agent_minutes"), (int, float)):
            pairs[data["wave"]] = (float(data["quota_seven_day_pct"]), float(data["agent_minutes"]))
    if this_wave and isinstance(this_wave.get("quota_seven_day_pct"), (int, float)):
        pairs[this_wave["wave"]] = (float(this_wave["quota_seven_day_pct"]), float(this_wave["agent_minutes"]))
    delta = minutes = 0.0
    for w in sorted(pairs):
        if w not in emitted:
            continue
        d = pairs[w][0] - emitted[w]
        if d >= 0 and pairs[w][1] > 0:
            delta += d
            minutes += pairs[w][1]
    if minutes > 0:
        cal["pct_per_agent_hour"] = round(delta / (minutes / 60.0), 6)
    return cal


def ingest(ctx: Ctx, wave: str, journal: Path | None, finished: bool) -> CommandResult:
    """CLI.md `wave ingest` (converging)."""
    executor = _need_executor(ctx)
    layout = ctx.layout
    wave_num(wave)
    errors: list[ErrorItem] = []
    with status.state_lock(ctx):
        man = _manifest(layout, wave)
        if man is None:
            raise UsageError(f"--wave {wave}: no such wave")
        if man.get("executor") != executor:
            raise PolicyRefused(f"wave {wave} belongs to executor {man.get('executor')}", code="E_POLICY")
        if man.get("status") in ("launching", "launch-failed", "abandoned", "emitted"):
            raise UsageError(f"wave {wave} is {man.get('status')}: only a launched wave is ingested",
                             hint="record the launch with exec.py wave launched first")
        plan = planmod.load(layout)
        st = state.load(layout)
        git = status.product_git(layout)
        if git is not None:
            results.finalize_merge_intents(ctx, git)
        _put_leftovers(ctx, wave, man, journal, errors)
        doc = statusio.load(layout, executor)
        before_doc = json.dumps(doc, sort_keys=True)
        hints = _script_hints(journal)
        previous = _last_outcomes(layout, wave)
        # null storm (SCHEMAS.md 4.4): the wave is over and no agent left any file for any of its tasks
        storm = finished and bool(man["tasks"]) and not man.get("pre_t0") and all(
            _silent(layout, doc, i) and hints.get(i["task"]) in (None, "rerun", "infra-error") for i in man["tasks"])
        if storm and not _storm_recorded(layout, wave):
            events.append(ctx, "error", {"kind": "usage-limit", "wave": wave,
                                         "reason": "null storm: every agent of the wave returned null or threw"})
        run = _Ingest(ctx, man, plan, doc, st, hints, journal, finished)
        run.previous = previous
        outcomes: dict[str, str] = {}
        still_running: list[str] = []
        for item in sorted(man["tasks"], key=lambda i: int(i["task"][1:])):
            got = run.task(item)
            if got == STILL_RUNNING:
                still_running.append(item["task"])
            else:
                outcomes[item["task"]] = got
            if not man.get("pre_t0"):
                run._check_fragment_receipt(item["task"], item)
        if json.dumps(doc, sort_keys=True) != before_doc:
            statusio.save(ctx, doc)
        # DX and claims rows (keyed: a re-ingest appends nothing)
        profile = _read_optional(layout.profile) or {}
        phase_b = profile.get("phase_b") or {}
        dx: list[tuple[str, str]] = []
        claims: list[tuple[str, str]] = []
        for item in man["tasks"]:
            for n in [item["attempt"]] + list(item.get("fix_attempts") or ()):
                impl = results.load(layout, wave, item["task"], "implementer", n)
                if impl:
                    dx += _dx_rows(wave, item["task"], n, impl)
                ver = results.load(layout, wave, item["task"], "verifier", n)
                if ver:
                    claims += _claim_rows(wave, item["task"], n, ver)
        appended = {"dx": [], "claims": []}
        if phase_b.get("dx_journal") and dx:
            appended["dx"] = append_rows(Path(phase_b["dx_journal"]), dx, template="dx-journal.md", claims=False)
        if phase_b.get("claims_ledger") and claims:
            appended["claims"] = append_rows(Path(phase_b["claims_ledger"]), claims, template="claims.md", claims=True)
        quota = st.get("quota") or {}
        minutes = _agent_minutes(man, doc)
        this_wave = {"wave": wave, "quota_seven_day_pct": quota.get("seven_day_pct"), "agent_minutes": minutes}
        resolved = (not still_running and all(status.current_status(doc, i["task"]) != "running"
                                              for i in man["tasks"])) or bool(man.get("pre_t0"))
        new_status = "ingested" if (finished or resolved) else man["status"]
        manifest_changed = new_status != man["status"]
        cal = recalibrated(ctx, plan, doc, st, this_wave=this_wave if (run.dirty or manifest_changed) else None)
        st_changed = cal != (st.get("calibration") or {})
        if manifest_changed:
            man["status"] = new_status
            _write_manifest(layout, man)
            for w in st.get("waves") or ():
                if w.get("wave") == wave:
                    w["status"] = new_status
                    w["finished_utc"] = clock.format_utc(ctx.now)
            st_changed = True
        if st_changed:
            st["calibration"] = cal
            state.save(ctx, st)
        mism = [ErrorItem(m["code"], f"{m['task']}: {m['detail']}", task=m["task"]) for m in run.mismatches
                if m["code"].startswith("E_")]
        warn_items = [ErrorItem(m["code"], f"{m['task']}: {m['detail']}", task=m["task"]) for m in run.mismatches
                      if m["code"].startswith("W_")]
        something = run.dirty or manifest_changed or st_changed or bool(appended["dx"] or appended["claims"])
        if something:
            events.append(ctx, "wave.ingested", {
                "wave": wave, "outcomes": outcomes, "null_storm": storm, "pre_t0": bool(man.get("pre_t0")),
                "applied": len(run.applied), "mismatches": len(mism), "proposals": run.proposals,
                "quota_seven_day_pct": quota.get("seven_day_pct"), "agent_minutes": minutes,
                "dx_rows": len(appended["dx"]), "claims_rows": len(appended["claims"]), "finished": finished})
        live_left = [m for m in _manifests(ctx) if m.get("status") in LIVE]
    resync = None
    single = any(ln.get("workspace_mode") == "single-tree" for ln in man.get("lanes") or ())
    if single and not live_left and layout.repo is not None and not man.get("pre_t0"):
        resync = _resync_shared_checkout(ctx)
    cmd = exec_cmd()
    nxt = [f"{cmd} status", f"{cmd} report --wave {wave}", f"{cmd} notion diff --wave {wave}", f"{cmd} schedule"]
    data = {"wave": wave, "outcomes": outcomes, "reruns": sorted(t for t, o in outcomes.items() if o == "rerun"),
            "proposals": run.proposals, "mismatches": [{"task": m["task"], "code": m["code"]} for m in run.mismatches],
            "calibration": dict((cal.get("ratios") or {})), "null_storm": storm, "next": nxt,
            "applied": run.applied, "rows": {"dx": len(appended["dx"]), "claims": len(appended["claims"])},
            "status": new_status, "resync": resync, "running": still_running}
    all_errors = errors + mism
    if all_errors:
        return CommandResult(data=data, exit_code=1, errors=all_errors, warnings=warn_items)
    return CommandResult(data=data, warnings=warn_items)


def _storm_recorded(layout: Layout, wave: str) -> bool:
    evs, _e = events.read_all(layout)
    return any(ev["type"] == "error" and (ev.get("data") or {}).get("kind") == "usage-limit"
               and (ev.get("data") or {}).get("wave") == wave for ev in evs)


def _any_evidence(layout: Layout, item: Mapping[str, Any]) -> bool:
    tid = item["task"]
    for n in [item["attempt"]] + list(item.get("fix_attempts") or ()):
        for role in (*AGENT_RESULT_ROLES, "merge"):
            if results.find_any_wave(layout, tid, role, n) is not None:
                return True
    return False


def _silent(layout: Layout, doc: Mapping[str, Any], item: Mapping[str, Any]) -> bool:
    """No agent of this task left anything in this wave (a null-storm candidate, SCHEMAS.md 4.4). A verifier-only
    chain (a gate, or a built task whose verifier died) is judged by its verifier's own output: the gate receipt
    `wave emit` wrote and an earlier landed merge receipt predate the wave's agents."""
    tid = item["task"]
    cur = status.current_status(doc, tid)
    if list(item.get("chain") or ()) == ["verifier"]:
        start = item.get("from_status")
        unmoved = cur == "running" if start in ("ready", "planned") else cur == start
        return unmoved and all(results.find_any_wave(layout, tid, "verifier", n) is None
                               for n in [item["attempt"]] + list(item.get("fix_attempts") or ()))
    return cur == "running" and not _any_evidence(layout, item)


def _script_hints(journal: Path | None) -> dict[str, str]:
    """The script's returned `{wave, outcomes}` found in the journal (a hint for skipped-dep and infra-error)."""
    if journal is None or not journal.is_file():
        return {}
    found: dict[str, str] = {}

    def walk(obj: Any) -> None:
        if isinstance(obj, dict):
            outs = obj.get("outcomes")
            if isinstance(obj.get("wave"), str) and isinstance(outs, dict):
                for k, v in outs.items():
                    if isinstance(k, str) and v in OUTCOMES:
                        found[k] = v
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)
        elif isinstance(obj, str) and obj.lstrip().startswith("{") and "outcomes" in obj:
            try:
                parsed = json.loads(obj)
            except ValueError as err:
                # a log text that looks like the script's return but is not JSON: no hint taken from it
                _LOG.warning("a JSON-looking journal string does not parse: no outcome hint taken from it",
                             extra={"data": {"journal": posix(journal), "error": str(err), "text": obj[:200]}})
                return
            walk(parsed)

    for n, doc in jsonio.read_jsonl(journal):
        if isinstance(doc, ErrorItem):
            _LOG.warning("a workflow journal line is not JSON: skipped while reading the script's outcome hints",
                         extra={"data": {"journal": posix(journal), "line": n, "error": doc.message}})
            continue
        walk(doc)
    return found


def _resync_shared_checkout(ctx: Ctx) -> dict:
    """CLI.md merge, shared checkout re-sync: under the merge lock, `reset --mixed origin/main` when local main is
    an ancestor of it (files untouched)."""
    git = status.product_git(ctx.layout)
    if git is None:
        return {"moved": False, "reason": "no product repository"}
    try:
        with statusio.locks.hold(ctx.layout, "merge", command=ctx.command):
            git.fetch()
            out = git.resync_to_origin()
            out["uncommitted"] = git.status_porcelain()[:50]
            return out
    except EnvError as err:
        # git, the network or a merge-lock timeout: the wave's transitions are already saved; the reason goes to
        # the data (the digest says why) and the next ingest of a finished wave retries. A bug is not caught here.
        _LOG.warning("shared checkout not re-synced", extra={"data": {"error": err.message, "code": err.items()[0].code}})
        return {"moved": False, "reason": err.message}


def cmd_ingest(ctx: Ctx, args: Namespace) -> CommandResult:
    journal = Path(args.journal) if getattr(args, "journal", None) else None
    return ingest(ctx, args.wave, journal, bool(getattr(args, "finished", False)))


# ================================================================================================ plan emit

PLANNING_LENSES: tuple[str, ...] = ("coverage", "feasibility")


def emit_planner(ctx: Ctx, rounds: int, mode: str) -> CommandResult:
    """CLI.md `plan emit` (WAVES.md 7)."""
    layout = ctx.layout
    if rounds < 1 or rounds > 5:
        raise UsageError("--rounds must be 1 to 5")
    if mode not in ("design", "pre-t0"):
        raise UsageError("--mode is design or pre-t0")
    profile = _profile(layout)
    project = str((profile.get("project") or {}).get("slug") or "project")
    exec_lib = SKILL_DIR / "assets" / "task-templates" / "execution.json"
    if not exec_lib.is_file():
        raise DependencyMissing(f"the execution template library {posix(exec_lib)} is absent",
                                code="E_DEPENDENCY_MISSING")
    read_first: list[str] = []
    spec = (profile.get("paths") or {}).get("spec")
    if spec:
        read_first.append(str(spec))
    read_first += [posix(layout.profile), posix(layout.policy), posix(exec_lib)]
    if isinstance(profile.get("frontend"), dict):
        fe_lib = other_skill("frontend") / "assets" / "task-templates" / "frontend.json"
        if not fe_lib.is_file():
            with status.state_lock(ctx):
                did = _dependency_decision(ctx, f"Bibliothèque /frontend absente : {posix(fe_lib)}", [])
            raise DependencyMissing(f"/frontend's template library {posix(fe_lib)} is absent",
                                    code="E_DEPENDENCY_MISSING", data={"proposal": did},
                                    hint=f"decision {did} is open for the owner")
        read_first.append(posix(fe_lib))
    for rel in ("assets/schemas/plan-draft.schema.json", "assets/schemas/plan.schema.json",
                "assets/schemas/task-template.schema.json", "references/planning.md", "contract/SCHEMAS.md"):
        p = SKILL_DIR / rel
        if p.is_file():
            read_first.append(posix(p))
    pdir = layout.local / "planner"
    bdir = pdir / "briefs"
    brief_texts: dict[str, str] = {}
    objective = ("Plan the project from its validated spec: a draft that `exec.py plan instantiate` expands into "
                 f"the plan of record (mode {mode}). Every requirement covered by tasks whose proofs would fail "
                 "without it; nothing invented.")
    brief_texts["planner"] = briefs.render_planning("planner", layout=layout, read_first=read_first,
                                                    objective=objective, mode=mode)
    brief_texts["test-designer"] = briefs.render_planning(
        "test-designer", layout=layout, read_first=read_first, mode=mode,
        objective="Write every proof and acceptance check of the plan candidate, independently of the planner.")
    for lens in PLANNING_LENSES:
        brief_texts[f"critic-{lens}"] = briefs.render_planning(
            "critic", layout=layout, read_first=read_first, mode=mode, lens=lens,
            objective=f"Critique the plan candidate through the {lens} lens, with the plan as the contract.")
    agents = {
        "planner": dict(agentType="execution-planner", **_override(profile, "planner",
                                                                   {"model": "opus", "effort": "high"})),
        "runner": {"agentType": "execution-planner", "model": "sonnet", "effort": "low"},
        "test_designer": dict(agentType="execution-test-designer",
                              **_override(profile, "test-designer", {"model": "opus", "effort": "high"})),
        "critic": dict(agentType="execution-reviewer", **_override(profile, "reviewer",
                                                                  {"model": "opus", "effort": "high"})),
    }
    planning = {
        "wave": "W00", "now_utc": clock.format_utc(ctx.now), "project": project, "mode": mode,
        "exec": _exec_line(layout), "state_dir": posix(layout.state), "draft_path": posix(layout.planner_draft),
        "candidate_path": posix(layout.plan_candidate),
        "briefs": {"planner": posix(bdir / "planner.md"), "test_designer": posix(bdir / "test-designer.md"),
                   "critics": [{"lens": lens, "path": posix(bdir / f"critic-{lens}.md")} for lens in PLANNING_LENSES]},
        "agents": agents, "limits": {"rounds": rounds}, "schemas": wavejs.planner_schemas(),
    }
    name = f"execution-planner-{re.sub(r'[^a-z0-9-]', '-', project.lower())}"[:61].rstrip("-")
    description = f"Planner of {re.sub(r'[^A-Za-z0-9 ,.:()/-]', '-', project)}: mode {mode}, {rounds} round(s)"
    script = wavejs.render_planner(planning, name=name, description=description)
    problems = wavejs.static_check(script, source="local/planner/planner.W00.js")
    if problems:
        raise CheckFailed(problems[0].message, code="E_WAVE_FORBIDDEN_TOKEN", items=problems)
    warnings: list[ErrorItem] = []
    check = _node_check_text(script, "W00")
    if check is None:
        warnings.append(ErrorItem("W_NODE_MISSING", "node not found: the planner script's syntax check was skipped"))
    elif check.exit_code != 0:
        raise CheckFailed(f"the planner script fails the syntax check: {_check_failure(check)}", code="E_CHECK")
    script_path = pdir / "planner.W00.js"
    with status.state_lock(ctx):
        changed = False
        for key, text in sorted(brief_texts.items()):
            path = bdir / f"{key}.md"
            if not path.exists() or path.read_bytes() != text.encode("utf-8"):
                jsonio.write_text_atomic(path, text)
                changed = True
        if not script_path.exists() or script_path.read_bytes() != script.encode("utf-8"):
            jsonio.write_text_atomic(script_path, script)
            changed = True
        layout.inbox("W00").mkdir(parents=True, exist_ok=True)
        if changed and ctx.executor in ("A", "B") and layout.local_state.exists():
            events.append(ctx, "wave.emitted", {"wave": "W00", "kind": "planner", "mode": mode, "rounds": rounds,
                                                "script_sha256": jsonio.sha256_bytes(script.encode("utf-8"))})
    data = {"script_path": posix(script_path), "briefs": [posix(bdir / f"{k}.md") for k in sorted(brief_texts)],
            "workflow_call": {"scriptPath": posix(script_path), "name": name,
                              "args": {"now_utc": clock.format_utc(ctx.now)}}}
    return CommandResult(data=data, warnings=warnings)


def cmd_plan_emit(ctx: Ctx, args: Namespace) -> CommandResult:
    rounds = getattr(args, "rounds", None)
    return emit_planner(ctx, 2 if rounds is None else int(rounds), str(getattr(args, "mode", None) or "design"))


__all__ = ["next_wave_id", "select", "build_manifest", "emit", "launched", "ingest", "emit_planner", "cmd_emit",
           "cmd_launched", "cmd_ingest", "cmd_plan_emit", "chain_for", "agent_options", "compute_limits",
           "append_rows", "recalibrated", "fe_entry", "js_stringify", "fnv1a32", "critique_checksum_problem"]
