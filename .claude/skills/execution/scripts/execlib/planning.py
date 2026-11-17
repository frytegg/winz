"""`plan instantiate`, `validate` and `catalogue` (contract/CLI.md 2, SCHEMAS.md 6, FRONTEND.md 2 and 11).

Glue: templates (instantiation) + the computed build-complete deadline (P-24, `schedule.build_complete_deadline`)
+ validate + the feature catalogue + the approval proposal (`decisions.propose`). `schedule` (lane B03) and
`decisions` / `status` (lane B04) are imported lazily, by name, only by the steps that need them: `validate` and a
plan without a submission deadline never need them. When one of them is missing the command stops with
E_NOT_IMPLEMENTED (exit 3) naming the lane, never with a guessed value.
"""
from __future__ import annotations

import argparse
import dataclasses
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from . import catalogue, decisionsio, events, plan, statusio, templates, validate
from .clock import format_utc, parse_utc
from .errors import (CheckFailed, DependencyMissing, ErrorItem, ExecError, InternalError, PolicyRefused,
                     UsageError, ValidationFailed)
from .jsonio import read_json, sha256_file, write_json_atomic
from .log import get_logger
from .model import CommandResult, Ctx, PlanModel
from .paths import Layout

_LOG = get_logger("execlib.planning")
HARDEN_P80_FALLBACK_MIN = 1.2 * 120  # /harden's own rule at its lower clamp (HANDOVER.md H9), LOC unknown at planning
BUILD_COMPLETE_ID = "DL-build-complete"


def _absent(name: str) -> bool:
    return not (Path(__file__).resolve().parent / f"{name}.py").is_file()


def _not_implemented(name: str, lane: str) -> InternalError:
    return InternalError(f"this step needs execlib.{name} (lane {lane}), which is not installed yet",
                         code="E_NOT_IMPLEMENTED")


def _decisions_mod() -> Any:
    """execlib.decisions (lane B04), imported lazily: only the steps that propose a decision need it."""
    try:
        from . import decisions
    except ImportError as err:
        if _absent("decisions"):
            raise _not_implemented("decisions", "B04") from err
        raise
    return decisions


def _schedule_mod() -> Any:
    """execlib.schedule (lane B03), imported lazily: only a plan with a submission deadline needs it."""
    try:
        from . import schedule
    except ImportError as err:
        if _absent("schedule"):
            raise _not_implemented("schedule", "B03") from err
        raise
    return schedule


def _locks() -> Any:
    """The locks module. MODULES.md 8 gives planning no `locks` edge although CLI.md has plan instantiate and
    catalogue hold the plan and state locks (contract question Q-B02-1); it is reached through decisionsio, an
    allowed edge, until the edge is added."""
    return decisionsio.locks


def _status_mod() -> Any:
    """execlib.status (lane B04): the EX-APPROVE task goes planned -> running when the approval is proposed.
    MODULES.md 8 gives planning no `status` edge (Q-B02-1); reached through execlib.decisions (decisions -> status)."""
    return _decisions_mod().status


# The run-state moves plan instantiate makes (state.RUN_TRANSITIONS holds them; re-planning before approval goes
# back to PLAN). Read first from the cache file so a call that needs no move never needs lane B04.
_RUN_FORWARD: dict[str, tuple[str, ...]] = {"INGEST": ("PLAN",), "AWAIT_APPROVAL": ("PLAN",),
                                            "PLAN": ("AWAIT_APPROVAL",)}


def jsonio_read_state(layout: Layout) -> dict:
    doc = read_json(layout.local_state)
    return doc if isinstance(doc, dict) else {}


def _state_mod() -> Any:
    """The state module (run-state moves PLAN and AWAIT_APPROVAL of CLI.md plan instantiate). MODULES.md 8 gives
    planning no `state` edge (Q-B02-1); it is reached through execlib.decisions (decisions -> state)."""
    return _decisions_mod().state


# --- shared helpers -----------------------------------------------------------------------------------------------

def load_doc(path: Path, what: str) -> dict:
    if not Path(path).is_file():
        raise UsageError(f"{what} not found at {Path(path).as_posix()}")
    doc = read_json(Path(path))
    if not isinstance(doc, dict):
        raise ValidationFailed(f"{what} is not a JSON object", code="E_SCHEMA")
    return doc


def optional_doc(path: Path) -> dict | None:
    return read_json(path) if Path(path).is_file() else None


def vcontext(layout: Layout, now: datetime, *, with_status: bool = False, pre_t0: bool = False,
             profile: dict | None = None, policy: dict | None = None) -> validate.VContext:
    statuses = statusio.load_all(layout) if (layout.state / "status").is_dir() or with_status else None
    gates = optional_doc(layout.gates_json)
    return validate.VContext(
        profile=profile if profile is not None else optional_doc(layout.profile),
        policy=policy if policy is not None else optional_doc(layout.policy),
        statuses=statuses, now=now, skills_present=validate.frontend_parts_present(), layout=layout,
        decisions=decisionsio.read_blocks(layout), gates_json=gates, with_status=with_status, pre_t0=pre_t0)


def spec_decision_for(layout: Layout, spec_sha: str) -> str | None:
    """The resolved spec-validation decision for this spec hash (validate option), newest first."""
    blocks = decisionsio.read_blocks(layout)
    for prop in sorted((b for b in blocks if b["record"] == "proposal" and b.get("kind") == "spec-validation"
                        and b.get("spec_sha256") == spec_sha), key=lambda b: int(b["id"][2:]), reverse=True):
        _p, res = validate.spec_validation(blocks, prop["id"])
        if res is not None and validate.resolution_validates(prop, res):
            return prop["id"]
    return None


def harden_p80_min(profile: dict) -> float:
    v = ((profile or {}).get("harden") or {}).get("budget_min_p80")
    return float(v) if v else HARDEN_P80_FALLBACK_MIN


def insert_build_complete_deadline(plan_raw: dict, profile: dict) -> dict:
    """P-24: when the profile (or the plan) has a submission deadline, insert DL-build-complete computed by
    `schedule.build_complete_deadline` (submission minus the P80 of /harden, the fix wave, FE-21, recording,
    /prose, screenshots, submission steps and a buffer). Replaces a stale one."""
    subs = [d for d in plan_raw.get("deadlines") or () if d.get("kind") == "submission"]
    has_submission = bool(subs) or bool(((profile or {}).get("event") or {}).get("deadline_utc"))
    if not has_submission:
        return plan_raw
    out = dict(plan_raw)
    out["deadlines"] = [d for d in plan_raw.get("deadlines") or () if d["id"] != BUILD_COMPLETE_ID]
    model = PlanModel.from_raw(out)
    at = _schedule_mod().build_complete_deadline(profile, model, harden_p80_min(profile))
    if isinstance(at, str):
        at = parse_utc(at)
    out["deadlines"].append({"id": BUILD_COMPLETE_ID, "title": "Build complete (computed)", "at_utc": format_utc(at),
                             "kind": "build-complete", "irrecoverable": False, "gate_phase": "build",
                             "source": "computed:schedule"})
    out["deadlines"].sort(key=lambda d: (d["at_utc"], d["id"]))
    return out


def apply_proofs(candidate: dict, td_result: dict) -> dict:
    """`--proofs`: a recorded result-test-designer's proof objects, applied by task id (proof_author test-designer)."""
    by_id = {t["id"]: t for t in candidate.get("tasks") or ()}
    for item in td_result.get("proofs") or ():
        task = by_id.get(item.get("task"))
        if task is None:
            raise UsageError(f"--proofs names task {item.get('task')}, absent from the candidate plan")
        task["proof"] = item["proof"]
        task["proof_author"] = "test-designer"
    return candidate


def _write_plants(layout: Layout, plan_raw: dict) -> list[str]:
    written = []
    for rel, doc in templates.plant_files(plan_raw).items():
        write_json_atomic(layout.state / rel, doc)
        written.append(rel)
    return written


def _french_summary(plan_raw: dict, report: validate.VReport, p80: str | None) -> dict:
    tasks = plan_raw["tasks"]
    manual = [t for t in tasks if t["kind"] == "manual"]
    decisions_ = [t for t in tasks if t["kind"] == "decision"]
    path = report.stats.get("critical_path") or []
    risks = [w.message for w in report.warnings][:10]
    lines = [f"Plan {plan_raw['project']} : {len(tasks)} tâches, {len(plan_raw['lanes'])} couloirs, "
             f"{len(manual)} tâches manuelles, {len(decisions_)} décisions.",
             f"Chemin critique ({report.stats.get('critical_path_p50_min', 0):.0f} min en P50) : "
             + " → ".join(path[:12]) + (" …" if len(path) > 12 else "")]
    if p80:
        lines.append(f"Fin estimée (P80) : {p80}.")
    for t in manual + decisions_:
        ls = (t.get("manual") or {}).get("latest_start_utc")
        lines.append(f"- {t['id']} {t['title']} — au plus tard {ls}")
    if risks:
        lines.append("Risques : " + " ; ".join(risks))
    lines.append("Réponds « approve » pour approuver, ou « revise » avec ta remarque.")
    return {"summary_fr": "\n".join(lines), "critical_path": path, "p80_utc": p80,
            "manual_tasks": [t["id"] for t in manual], "decision_gates": [t["id"] for t in decisions_],
            "risks": risks}


def _p80(ctx: Ctx, plan_raw: dict, profile: dict) -> str | None:
    """The P80 finish of the plan from `schedule.simulate` (lane B03)."""
    sched = _schedule_mod()
    model = PlanModel.from_raw(plan_raw)
    seed = int(plan.plan_digest(plan_raw)[:8], 16)
    lanes = int(((profile or {}).get("machine") or {}).get("max_lanes") or 1)
    sim = sched.simulate(model, {}, profile, samples=500, seed=seed, lanes=lanes, now=ctx.now, calibration={})
    dls = sim.get("deadlines") or {}
    if isinstance(dls, dict):
        for did in sorted(dls, key=lambda d: (d != "DL-submission", d)):
            entry = dls[did] if isinstance(dls[did], dict) else {}
            if entry.get("p80_utc"):
                return str(entry["p80_utc"])
            if isinstance(entry.get("p80_min"), (int, float)):
                return format_utc(ctx.now + timedelta(minutes=float(entry["p80_min"])))
    makespan = (sim.get("makespan_min") or {}).get("p80")
    if isinstance(makespan, (int, float)) and not sim.get("zones"):
        return format_utc(ctx.now + timedelta(minutes=float(makespan)))
    zones = sim.get("zones") or []
    sub = next((z for z in zones if z.get("deadline") == "DL-submission"), None) or (zones[0] if zones else None)
    if sub and sub.get("p80_utc"):
        return str(sub["p80_utc"])
    return None


def _dependency_proposal(ctx: Ctx, err: DependencyMissing) -> str | None:
    """FRONTEND.md 12: one `dependency-missing` decision, deduplicated by file, options wait / cut-ui."""
    title = f"Dépendance /frontend manquante : {err.message}"[:160]
    options = [{"id": "wait", "label": "J'attends que /frontend soit réparé ; le reste du plan continue",
                "consequence": "La planification de l'interface attend la réparation de /frontend.",
                "effects": [{"op": "none"}]},
               {"id": "cut-ui", "label": "Couper les exigences UI concernées",
                "consequence": "Une proposition de coupe (réservée au propriétaire) est ouverte.",
                "effects": [{"op": "none"}]}]
    with _locks().hold(ctx.layout, "state", command=ctx.command):
        did, _dedup = _decisions_mod().propose(ctx, kind="dependency-missing", title=title, options=options, tasks=[],
                                               deadline=None, recommended="wait")
    return did


def _approval(ctx: Ctx, plan_raw: dict, report: validate.VReport, profile: dict) -> dict:
    p80 = _p80(ctx, plan_raw, profile)
    summary = _french_summary(plan_raw, report, p80)
    approve = next((t for t in plan_raw["tasks"] if t.get("template") == "execution:EX-APPROVE"), None)
    digest = plan.plan_digest(plan_raw)
    options = [{"id": "approve", "label": "J'approuve le plan", "consequence": "Le plan est figé et les vagues démarrent.",
                "effects": [{"op": "approve-plan"}]},
               {"id": "revise", "label": "À reprendre", "consequence": "Le planificateur reprend le brouillon.",
                "effects": [{"op": "none"}]}]
    decisions = _decisions_mod()
    with _locks().hold(ctx.layout, "state", command=ctx.command):
        did, _dedup = decisions.propose(ctx, kind="approval", title=f"Approuver le plan {plan_raw['project']}",
                                        options=options, tasks=[approve["id"]] if approve else [], deadline=None,
                                        recommended="approve", extra={"plan_sha256": digest})
        if approve is not None:
            status = _status_mod()
            doc = statusio.load(ctx.layout, ctx.executor or "A")
            model = PlanModel.from_raw(plan_raw)
            current = (doc.get("tasks") or {}).get(approve["id"], {}).get("status", "planned")
            if current == "planned":
                status.transition(ctx, doc, model.by_id[approve["id"]], "running", evidence=[f"decision:{did}"])
                statusio.save(ctx, doc)
    return {"decision": did, **summary}


# --- commands -------------------------------------------------------------------------------------------------------

def cmd_instantiate(ctx: Ctx, args: argparse.Namespace) -> CommandResult:
    layout = ctx.layout
    if (ctx.executor or "A") != "A":
        raise PolicyRefused("plan instantiate is orchestrator A's (TWO-DEV.md 1.3)", code="E_POLICY")
    if ctx.executor is None:
        ctx = dataclasses.replace(ctx, executor="A")
    draft_path = Path(args.draft) if args.draft else layout.planner_draft
    draft = load_doc(draft_path, "the planner draft")
    # --proofs is read before anything is instantiated or proposed: a missing file is E_USAGE with nothing written
    proofs = load_doc(Path(args.proofs), "the test-designer result (--proofs)") if args.proofs else None
    profile = load_doc(layout.profile, "profile.json")
    policy = load_doc(layout.policy, "policy.json")
    dry = bool(args.dry_run)
    pre_t0 = bool(getattr(args, "pre_t0", False))
    if not dry and layout.plan.is_file():
        current = read_json(layout.plan)
        if isinstance(current, dict) and current.get("approved") is not None:
            raise PolicyRefused("plan.json is approved: change it through exec.py amend", code="E_PLAN_APPROVED")
    spec_sha = ((draft.get("spec") or {}).get("sha256")) or ""
    spec_dec = spec_decision_for(layout, spec_sha)
    try:
        raw, ids = templates.instantiate(draft, profile, policy, layout, ctx.now, lane_of=validate.lane_for,
                                         pre_t0=pre_t0, spec_decision=spec_dec)
    except DependencyMissing as err:
        proposal = None if dry else _dependency_proposal(ctx, err)
        raise DependencyMissing(err.message, items=err.items(), data={"proposal": proposal, "plan_path": None})
    if proofs is not None:
        raw = apply_proofs(raw, proofs)
    if not pre_t0:
        raw = insert_build_complete_deadline(raw, profile)
    raw = templates.compute_latest_starts(raw, profile)
    write_json_atomic(layout.plan_candidate, raw)
    report = validate.validate_plan(raw, vcontext(layout, ctx.now, pre_t0=pre_t0, profile=profile, policy=policy))
    data: dict[str, Any] = {"plan_path": None, "candidate_path": layout.plan_candidate.as_posix(), "plan_version": 1,
                            "tasks": len(raw["tasks"]), "ids": ids,
                            "requirements_added": sorted(r["id"] for r in raw["requirements"]
                                                         if str(r.get("source", "")).endswith(":standard")),
                            "catalogue_path": None, "validation": report.to_data(), "approval": None}
    if not report.ok:
        return CommandResult(data=data, exit_code=1, errors=list(report.errors), warnings=list(report.warnings))
    if dry:
        return CommandResult(data=data, warnings=list(report.warnings))
    locks = _locks()
    with locks.hold(layout, "plan", command=ctx.command):
        plan.save(ctx, raw)
        entries = catalogue.generate(raw)
        cat_path = catalogue.write(ctx, profile, entries) if entries else None
        plants = _write_plants(layout, raw)
        with locks.hold(layout, "state", command=ctx.command):
            events.append(ctx, "plan.instantiated", {"plan_version": 1, "tasks": len(raw["tasks"]),
                                                    "plan_sha256": plan.plan_digest(raw), "pre_t0": pre_t0,
                                                    "plants": plants})
            if cat_path is not None:
                events.append(ctx, "catalogue.generated", {"path": cat_path.as_posix(), "entries": len(entries),
                                                           "sha256": catalogue.sha256_of(entries)})
            _run_state(ctx, "PLAN", "plan instantiated")
    data["plan_path"] = layout.plan.as_posix()
    data["catalogue_path"] = cat_path.as_posix() if cat_path else None
    if args.propose_approval and not pre_t0:
        data["approval"] = _approval(ctx, raw, report, profile)
        with locks.hold(layout, "state", command=ctx.command):
            _run_state(ctx, "AWAIT_APPROVAL", "approval proposed")
    return CommandResult(data=data, warnings=list(report.warnings))


def _run_state(ctx: Ctx, to: str, reason: str) -> None:
    """Move run_state forward when local state exists and the move is a legal one (never backwards)."""
    if not ctx.layout.local_state.is_file():
        return
    st = jsonio_read_state(ctx.layout)
    if st.get("run_state") == to or to not in _RUN_FORWARD.get(st.get("run_state"), ()):
        return
    state = _state_mod()
    st = state.load(ctx.layout)
    cur = st.get("run_state")
    if cur == to or to not in state.RUN_TRANSITIONS.get(cur, frozenset()):
        return
    state.set_run_state(ctx, st, to, reason)
    state.save(ctx, st)


def cmd_validate(ctx: Ctx, args: argparse.Namespace) -> CommandResult:
    layout = ctx.layout
    path = Path(args.plan) if args.plan else layout.plan
    raw = load_doc(path, "the plan")
    report = validate.validate_plan(raw, vcontext(layout, ctx.now, with_status=bool(args.with_status)))
    data = report.to_data()
    failed = list(report.errors)
    if args.strict and report.warnings:
        failed += [ErrorItem("E_PLAN_INVALID", f"--strict: {w.code} {w.message}", task=w.task)
                   for w in report.warnings]
    data["ok"] = not failed
    if failed:
        return CommandResult(data=data, exit_code=1, errors=failed, warnings=list(report.warnings))
    return CommandResult(data=data, warnings=list(report.warnings))


def cmd_catalogue(ctx: Ctx, args: argparse.Namespace) -> CommandResult:
    layout = ctx.layout
    locks = _locks()
    with locks.hold(layout, "plan", command=ctx.command):
        raw = plan.load_raw(layout)
        profile = load_doc(layout.profile, "profile.json")
        entries = catalogue.generate(raw)
        path = catalogue.write(ctx, profile, entries) if entries else None
    sha = catalogue.sha256_of(entries) if entries else None
    if path is not None and ctx.executor in ("A", "B") and layout.state.is_dir():
        with locks.hold(layout, "state", command=ctx.command):
            events.append(ctx, "catalogue.generated", {"path": path.as_posix(), "entries": len(entries), "sha256": sha})
    return CommandResult(data={"path": path.as_posix() if path else None, "entries": len(entries), "sha256": sha})
