"""Decision proposals and resolutions with their effects (contract/MODULES.md 4 `decisions.py`, CLI.md `decision
propose|resolve`, SCHEMAS.md 8, TWO-DEV.md 1.3 and 6, FRONTEND.md 6.4, NOTION.md 10).

decisions.md is append-only; `decisionsio` reads it and is its only writer. A proposal is deduplicated by
sha256(canonical([kind, title, sorted(tasks)])): an open proposal with the same dedup is returned. A resolution is
written once (a second one is E_DECISION_RESOLVED, exit 4) and applies the chosen option's effects: approve-plan,
validate-spec, cut-tasks, restore-tasks, unblock-tasks, retry-task, amend (returns the command), policy-patch
(returns the command), quota-override (local state, rebuilt by `events replay`), none. Human text (the owner's
quote, the choice) only ever arrives through files (CLI.md 0.7); the choice must be an option id of the proposal.
The effects are idempotent and guarded by an intent file (local/decision-effects/<id>.json): a resolution whose
effects a crash interrupted is completed by the next `status` (complete_pending, contract question Q-B04-23), at
most MAX_EFFECT_ATTEMPTS times before an owner decision (retry or drop) parks it.
"""
from __future__ import annotations

import json
import re
from argparse import Namespace
from datetime import timedelta
from pathlib import Path
from typing import Any, Iterable, Mapping

from . import clock, decisionsio, events, jsonio, plan as planmod, schema, state, status, statusio
from .errors import ErrorItem, ExecError, InternalError, PolicyRefused, UsageError, ValidationFailed
from .log import redact
from .model import CommandResult, Ctx, PlanModel
from .paths import Layout, exec_cmd, other_skill, posix

KINDS: tuple[str, ...] = ("approval", "spec-validation", "cut", "spec-gap", "amendment", "policy-exception",
                          "dependency-missing", "quota", "resources", "retry-exhausted", "scope-change",
                          "fix-selection", "plan-task", "other")
OWNER_ONLY = status.OWNER_ONLY_KINDS
OPTION_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,30}$")
RANGES = decisionsio.RANGES
FRONTEND_KEYS: Mapping[str, str] = {"frontend:FE-04": "H1", "frontend:FE-06": "H2"}


# --- shared helpers (local state, push texts, Notion queue) -------------------------------------------------------

def dedup_of(kind: str, title: str, tasks: Iterable[str]) -> str:
    return jsonio.sha256_json([kind, title, sorted(tasks)])


def executor_of_decision(decision_id: str) -> str | None:
    num = int(decision_id[2:])
    for ex, (lo, hi) in RANGES.items():
        if lo <= num <= hi:
            return ex
    return None


def load_local(ctx: Ctx) -> dict | None:
    if not ctx.layout.local_state.exists():
        return None
    return state.load(ctx.layout)


def awaiting_add(st: dict, *, kind: str, ref: str, since: str, latest: str | None) -> None:
    items = [a for a in st.get("awaiting") or [] if a.get("ref") != ref]
    items.append({"kind": kind, "ref": ref, "since_utc": since, "latest_utc": latest})
    st["awaiting"] = sorted(items, key=lambda a: a["ref"])


def awaiting_remove(st: dict, ref: str) -> None:
    st["awaiting"] = [a for a in st.get("awaiting") or [] if a.get("ref") != ref]


def drop_awaiting(ctx: Ctx, ref: str) -> None:
    """Remove `ref` from local/state.json awaiting (state lock held)."""
    st = load_local(ctx)
    if st is not None and any(a.get("ref") == ref for a in st.get("awaiting") or []):
        awaiting_remove(st, ref)
        state.save(ctx, st)


def queue_notion(ctx: Ctx, key: str, properties: Mapping[str, Any], purpose: str = "set-ingested") -> None:
    """Queue a row update in local/notion/queue.jsonl (NOTION.md 10.3); the next `notion diff` emits it."""
    with statusio.locks.hold(ctx.layout, "notion", command=ctx.command):
        jsonio.append_jsonl(ctx.layout.local / "notion" / "queue.jsonl",
                            {"at_utc": clock.format_utc(ctx.now), "key": key, "purpose": purpose,
                             "properties": dict(properties)})


def push_text(decision_id: str, title: str) -> str:
    """French push text (≤ 200 characters, names the decision id)."""
    head = f"Décision {decision_id} à trancher : "
    tail = " Réponds par Remote Control ou dans Notion."
    room = 200 - len(head) - len(tail)
    short = title if len(title) <= room else title[: max(0, room - 1)].rstrip() + "…"
    return head + short + tail


def default_options(kind: str) -> list[dict]:
    """Options of the proposals exec.py opens itself (CLI.md, SCHEMAS.md 4.4)."""
    if kind == "retry-exhausted":
        return [{"id": "retry", "label": "Relancer avec un changement précisé", "consequence":
                 "la tâche repart à l'état prête", "effects": [{"op": "retry-task"}]},
                {"id": "amend", "label": "Modifier la tâche", "consequence": "un amendement du plan",
                 "effects": [{"op": "amend"}]},
                {"id": "cut", "label": "Couper la tâche", "consequence": "la tâche n'est plus faite",
                 "effects": [{"op": "cut-tasks"}]}]
    if kind == "dependency-missing":
        return [{"id": "fixed", "label": "Corrigé : relancer", "consequence": "la tâche repart à l'état prête",
                 "effects": [{"op": "unblock-tasks"}]},
                {"id": "cut", "label": "Couper la tâche", "consequence": "la tâche n'est plus faite",
                 "effects": [{"op": "cut-tasks"}]}]
    if kind == "quota":
        return [{"id": "extra-usage", "label": "J'achète de l'usage supplémentaire : continuer",
                 "consequence": "les vagues reprennent", "effects": [{"op": "quota-override", "mode":
                                                                       "extra-usage", "until_utc": None}]},
                {"id": "critical-only", "label": "Seulement le chemin critique",
                 "consequence": "seules les tâches critiques partent",
                 "effects": [{"op": "quota-override", "mode": "critical-only", "until_utc": None}]},
                {"id": "wait", "label": "Attendre la remise à zéro", "consequence": "pause jusqu'au reset",
                 "effects": [{"op": "none"}]}]
    if kind == "resources":
        return [{"id": "retry", "label": "Relancer", "consequence": "la tâche repart à l'état prête",
                 "effects": [{"op": "unblock-tasks"}]},
                {"id": "wait", "label": "Attendre", "consequence": "rien ne change", "effects": [{"op": "none"}]}]
    return [{"id": "go", "label": "Continuer", "consequence": "la tâche reprend", "effects":
             [{"op": "unblock-tasks"}]},
            {"id": "stop", "label": "Arrêter", "consequence": "rien ne change", "effects": [{"op": "none"}]}]


def _proposal_prose(decision_id: str, kind: str, title: str, options: list[dict], tasks: list[str]) -> str:
    lines = [f"### {decision_id} · {title}", "", f"Nature : {kind}."]
    if tasks:
        lines.append("Tâches : " + ", ".join(tasks) + ".")
    lines.append("")
    lines += [f"- `{o['id']}` : {o['label']} — {o['consequence']}" for o in options]
    return "\n".join(lines)


# --- propose ------------------------------------------------------------------------------------------------------

def _check_options(options: list[dict], recommended: str | None) -> None:
    if not options:
        raise UsageError("a proposal needs at least one option")
    ids = [o.get("id") for o in options]
    if len(set(ids)) != len(ids):
        raise UsageError("option ids must be unique")
    if recommended is not None and recommended not in ids:
        raise UsageError(f"--recommended {recommended!r} is not an option id")


def propose(ctx: Ctx, *, kind: str, title: str, options: list[dict], tasks: list[str], deadline: Any | None,
            recommended: str | None, extra: dict | None = None) -> tuple[str, bool]:
    """Append a proposal block (state lock held by the caller) unless an open proposal has the same dedup.
    Returns (id, deduplicated). Kind cut moves each listed task to cut-proposed (saving previous_status)."""
    if not status.holds_state_lock():
        raise UsageError("decisions.propose requires the state lock")
    if kind not in KINDS:
        raise UsageError(f"unknown decision kind {kind!r}")
    if ctx.executor not in RANGES:
        raise UsageError("no executor: pass --executor or run exec.py init first")
    tasks = sorted(set(tasks))
    _check_options(options, recommended)
    dedup = dedup_of(kind, title, tasks)
    for prop in decisionsio.open_proposals(ctx.layout):
        if prop.get("dedup") == dedup:
            return str(prop["id"]), True
    did = decisionsio.next_id(ctx.layout, ctx.executor)
    deadline_text = clock.format_utc(deadline) if deadline is not None and not isinstance(deadline, str) \
        else deadline
    header: dict[str, Any] = {"schema": "execution.decision/1", "record": "proposal", "id": did,
                              "at_utc": clock.format_utc(ctx.now), "by": f"exec@{ctx.executor}", "kind": kind,
                              "title": title[:160], "tasks": tasks, "options": options, "recommended": recommended,
                              "deadline_utc": deadline_text, "dedup": dedup}
    header.update(extra or {})
    plan: PlanModel | None = None
    if kind == "cut" and tasks:
        plan = planmod.load(ctx.layout)
        for tid in tasks:
            task = plan.by_id.get(tid)
            if task is None:
                raise UsageError(f"unknown task {tid}")
            if task.executor != ctx.executor:
                raise PolicyRefused(f"{tid} belongs to executor {task.executor}", code="E_POLICY",
                                    hint="propose cuts of your own tasks only (TWO-DEV.md 1.1)")
    decisionsio.append_block(ctx, header, _proposal_prose(did, kind, title, options, tasks))
    events.append(ctx, "decision.proposed", {"id": did, "kind": kind, "title": header["title"], "tasks": tasks})
    if kind == "cut" and tasks and plan is not None:
        doc = statusio.load(ctx.layout, ctx.executor)
        for tid in tasks:
            if status.current_status(doc, tid) in status.NON_TERMINAL - {"cut-proposed"}:
                status.transition(ctx, doc, plan.by_id[tid], "cut-proposed", evidence=[f"decision:{did}"],
                                  plan=plan)
        statusio.save(ctx, doc)
    st = load_local(ctx)
    if st is not None:
        awaiting_add(st, kind="decision", ref=did, since=clock.format_utc(ctx.now), latest=deadline_text)
        state.save(ctx, st)
    return did, False


def _read_options_file(path: str | None, kind: str) -> list[dict]:
    if not path:
        return default_options(kind)
    p = Path(path)
    if not p.is_file():
        raise UsageError(f"--options-file {posix(p)} does not exist")
    try:
        options = json.loads(p.read_bytes().decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as err:
        raise UsageError(f"--options-file is not JSON: {err}") from err
    if not isinstance(options, list):
        raise UsageError("--options-file holds a JSON array of options")
    probe = {"schema": "execution.decision/1", "record": "proposal", "id": "D-001", "at_utc": "2026-01-01T00:00:00Z",
             "by": "exec@A", "kind": kind, "title": "x", "options": options, "deadline_utc": None, "dedup": "0" * 64}
    report = schema.validate(probe, "decision")
    if not report.ok:
        raise ValidationFailed(f"options invalid: {report.issues[0].message}", code="E_SCHEMA",
                               items=[ErrorItem("E_SCHEMA", i.message, path=i.instance_path) for i in
                                      report.issues[:10]])
    return options


def cmd_propose(ctx: Ctx, args: Namespace) -> CommandResult:
    """`decision propose --kind K --title T [--options-file F] [--recommended ID] [--deadline-utc ISO] [--task T]`"""
    if args.kind not in KINDS:
        raise UsageError(f"unknown decision kind {args.kind!r}", hint="kinds: " + ", ".join(KINDS))
    options = _read_options_file(args.options_file, args.kind)
    deadline = clock.format_utc(clock.parse_utc(args.deadline_utc)) if args.deadline_utc else None
    for tid in args.tasks:
        if not re.match(r"^T[0-9]{3,}$", tid):
            raise UsageError(f"--task {tid!r} is not a task id")
    with status.state_lock(ctx):
        did, dedup = propose(ctx, kind=args.kind, title=args.title, options=options, tasks=list(args.tasks),
                             deadline=deadline, recommended=args.recommended)
    proposal, _r = decisionsio.find(ctx.layout, did)
    return CommandResult(data={"id": did, "deduplicated": dedup,
                               "push_text_fr": push_text(did, str((proposal or {}).get("title", args.title))),
                               "notion": "run exec.py notion diff"})


# --- resolve ------------------------------------------------------------------------------------------------------

def _change_sentence(quote: str, pick: str) -> str:
    """The one sentence after the pick in the quote (FRONTEND.md 6.4), else ''."""
    m = re.search(r"(?<![A-Za-z0-9])" + re.escape(pick) + r"(?![A-Za-z0-9])", quote, flags=re.IGNORECASE)
    if not m:
        return ""
    rest = quote[m.end():].lstrip(" \t\n,;:.-—–")
    if not rest:
        return ""
    end = re.search(r"[.!?](\s|$)", rest)
    sentence = rest[: end.end()].strip() if end else rest.strip()
    return sentence[:400]


def _frontend_choice(ctx: Ctx, plan: PlanModel | None, proposal: dict, choice: str, by: str, source: str,
                     quote: str, decision_id: str) -> tuple[dict | None, list[ErrorItem]]:
    if plan is None:
        return None, []
    key = None
    for tid in proposal.get("tasks") or ():
        task = plan.by_id.get(tid)
        if task is not None and task.template in FRONTEND_KEYS:
            key = FRONTEND_KEYS[task.template]
    if key is None:
        return None, []
    schema_path = other_skill("frontend") / "assets" / "schemas" / "choices.schema.json"
    if not schema_path.is_file():
        return None, [ErrorItem("E_DEPENDENCY_MISSING", "/frontend's choices.schema.json is absent: the choice is "
                                "recorded, the choices.json write waits for the dependency-missing decision",
                                path=posix(schema_path))]
    pick: Any = int(choice) if key == "H2" and choice.isdigit() else (choice.upper() if key == "H1" else choice)
    value = {"pick": pick, "change": _change_sentence(quote, choice), "answered_at": clock.format_utc(ctx.now),
             "by": by, "channel": source, "source": f".execution/decisions.md#{decision_id}"}
    doc = json.loads(schema_path.read_text(encoding="utf-8"))
    report = schema.validate_with({"version": 1, key: value}, doc, base_dir=schema_path.parent)
    if not report.ok:
        return None, [ErrorItem("E_SCHEMA", f"the {key} entry fails /frontend's choices schema: "
                                f"{report.issues[0].message}", path=report.issues[0].instance_path)]
    return {"path": posix(ctx.layout.state / "frontend" / "choices.json"), "key": key, "value": value}, []


def _quota_override(ctx: Ctx, st: dict | None, effect: Mapping[str, Any], decision_id: str) -> dict | None:
    if st is None:
        return None
    quota = st.get("quota")
    if quota is None:
        quota = {"at_utc": clock.format_utc(ctx.now), "snapshot_age_s": None, "five_hour_pct": None,
                 "five_hour_resets_utc": None, "seven_day_pct": None, "seven_day_resets_utc": None,
                 "decision": "unknown", "pause_until_utc": None, "limit_evidence_utc": None, "override": None}
    until = effect.get("until_utc") or quota.get("seven_day_resets_utc") \
        or clock.format_utc(ctx.now + timedelta(days=7))
    override = {"mode": effect.get("mode") or "extra-usage", "until_utc": until, "decision": decision_id}
    quota["override"] = override
    st["quota"] = quota
    return override


def resolve(ctx: Ctx, *, decision_id: str, choice: str, by: str, source: str, quote: str) -> dict:
    """Write the resolution block and apply the chosen option's effects (state lock held by the caller; the plan
    lock too when the option approves the plan). Returns the data of CLI.md `decision resolve`."""
    if not status.holds_state_lock():
        raise UsageError("decisions.resolve requires the state lock")
    proposal, resolution = decisionsio.find(ctx.layout, decision_id)
    if proposal is None:
        raise UsageError(f"unknown decision {decision_id}")
    if resolution is not None:
        raise PolicyRefused(f"{decision_id} is already resolved ({resolution.get('choice')})",
                            code="E_DECISION_RESOLVED", hint="a decision has at most one resolution")
    owner = executor_of_decision(decision_id)
    if owner != ctx.executor:
        raise PolicyRefused(f"{decision_id} belongs to orchestrator {owner}; this is {ctx.executor}",
                            code="E_POLICY", hint="record the answer with answers ingest --relay (TWO-DEV.md 6)")
    if proposal.get("kind") in OWNER_ONLY and by != "devA":
        raise PolicyRefused(f"{decision_id} is an owner-only {proposal.get('kind')} decision: --by must be devA, "
                            f"got {by}", code="E_POLICY", hint="owner-only decisions belong to dev A (TD-V5)")
    if by not in ("devA", "devB", "owner"):
        raise PolicyRefused(f"--by {by} is not a developer", code="E_POLICY")
    if not OPTION_ID_RE.match(choice):
        raise ValidationFailed(f"the choice is not an option id (pattern {OPTION_ID_RE.pattern})",
                               code="E_CHECK", hint="write only the option id in the choice file")
    option = next((dict(o) for o in proposal.get("options") or () if o.get("id") == choice), None)
    if option is None:
        raise ValidationFailed(f"{choice!r} is not an option of {decision_id}", code="E_CHECK",
                               hint="options: " + ", ".join(o["id"] for o in proposal.get("options") or ()))
    if not quote or not quote.strip():
        raise UsageError("the owner's quote is empty", hint="write the owner's words verbatim in --quote-file")
    header = {"schema": "execution.decision/1", "record": "resolution", "id": decision_id,
              "at_utc": clock.format_utc(ctx.now), "by": by, "choice": choice, "source": source, "quote": quote}
    plan: PlanModel | None = planmod.load(ctx.layout) if ctx.layout.plan.exists() else None
    effects = list(option.get("effects") or [{"op": "none"}])
    if any(e.get("op") == "approve-plan" for e in effects):
        if plan is None:
            raise UsageError("approve-plan without a plan.json")
        if not statusio.locks.is_held("plan"):
            raise UsageError("approve-plan requires the plan lock (taken before the state lock)")
    # The effects are applied after the block is appended (their transitions read the resolution from
    # decisions.md). A crash or an error in between leaves this intent file: the next `status` re-applies the
    # effects idempotently (complete_pending) instead of leaving a resolved decision without its effects.
    intent = intent_path(ctx.layout, decision_id)
    jsonio.write_json_atomic(intent, {"id": decision_id, "choice": choice, "at_utc": header["at_utc"]})
    decisionsio.append_block(ctx, header, f"Résolution de {decision_id} : `{choice}` ({source}, {by}).")
    data = apply_resolution(ctx, proposal, header, plan=plan)
    intent.unlink(missing_ok=True)
    return data


# --- effects (idempotent: also re-applied by `status` after a crash) ----------------------------------------------

def intent_path(layout: Layout, decision_id: str) -> Path:
    """local/decision-effects/<id>.json: written before a resolution block, removed once its effects are applied
    (contract question Q-B04-23: a machine-local file SCHEMAS.md 5.1 does not list yet)."""
    return layout.local / "decision-effects" / f"{decision_id}.json"


def pending_intents(layout: Layout) -> list[str]:
    folder = layout.local / "decision-effects"
    if not folder.is_dir():
        return []
    return sorted(p.stem for p in folder.glob("D-*.json") if re.match(r"^D-[0-9]{3,}$", p.stem))


def _resolved_at(layout: Layout, decision_id: str) -> str | None:
    _p, res = decisionsio.find(layout, decision_id)
    return str(res["at_utc"]) if res else None


def _resolved_event_exists(ctx: Ctx, decision_id: str) -> bool:
    evs, _errs = events.read_all(ctx.layout)
    return any(ev["type"] == "decision.resolved" and (ev.get("data") or {}).get("id") == decision_id for ev in evs)


def _patch_arg(ctx: Ctx, effect: Mapping[str, Any]) -> str:
    """The effect's patch file (a state-relative path, decision.schema.json) as a printed command names it: absolute,
    forward slashes, double-quoted, so the line runs as printed from any directory (contract revision 3, README.md
    10); `amend` and `ingest` read --patch against their own working directory. `<patch file>` when the option names
    none (the orchestrator writes one first)."""
    patch = effect.get("patch")
    if not patch:
        return "<patch file>"
    return f"\"{posix((ctx.layout.state / str(patch)).resolve())}\""


def apply_resolution(ctx: Ctx, proposal: Mapping[str, Any], resolution: Mapping[str, Any], *,
                     plan: PlanModel | None, recovering: bool = False) -> dict:
    """Apply the chosen option's effects of a written resolution (state lock held; the plan lock too for
    approve-plan). Every step is idempotent, so `status` can run it again after a crash (`recovering`): an effect
    already visible on disk is skipped. Returns the data of CLI.md `decision resolve` (plus `_errors`)."""
    decision_id = str(resolution["id"])
    choice = str(resolution["choice"])
    by = str(resolution["by"])
    source = str(resolution["source"])
    quote = str(resolution.get("quote") or "")
    resolved_at = clock.parse_utc(str(resolution["at_utc"]))
    option = next((dict(o) for o in proposal.get("options") or () if o.get("id") == choice), None)
    if option is None:
        raise ValidationFailed(f"{choice!r} is not an option of {decision_id}", code="E_CHECK")
    effects = list(option.get("effects") or [{"op": "none"}])
    applied: list[str] = []
    nxt: list[str] = []
    unblocked: list[str] = []
    errors: list[ErrorItem] = []
    st = load_local(ctx)
    doc = statusio.load(ctx.layout, ctx.executor)
    doc_changed = False
    exec_line = exec_cmd()  # this machine's absolute exec.py command (README.md 3.2)
    for eff in effects:
        op = eff.get("op")
        targets = list(eff.get("tasks") or proposal.get("tasks") or [])
        if op == "approve-plan" and plan is not None:
            approved = plan.raw.get("approved") or None
            if approved and approved.get("decision") == decision_id:
                pass  # already applied (a recovery after the plan save)
            elif recovering and approved:
                ctx.log.warning("approve-plan not re-applied: another approval stands",
                                extra={"data": {"decision": decision_id, "approved_by": approved.get("decision")}})
            else:
                if not statusio.locks.is_held("plan"):
                    raise InternalError(f"{decision_id}: approve-plan needs the plan lock", code="E_LOCK_ORDER",
                                        hint="the next `status` takes the plan lock first and re-applies it")
                raw = dict(plan.raw)
                raw["approved"] = {"at_utc": clock.format_utc(resolved_at),
                                   "by": by if by in ("devA", "devB") else "devA",
                                   "decision": decision_id, "plan_sha256": planmod.plan_digest(raw)}
                planmod.save(ctx, raw, allow_approved=True)
                plan = PlanModel.from_raw(raw)
                events.append(ctx, "plan.approved", {"decision": decision_id,
                                                     "plan_sha256": raw["approved"]["plan_sha256"]})
            approved = plan.raw.get("approved") or {}
            if st is not None and approved.get("decision") == decision_id:
                st["plan_sha256"] = approved["plan_sha256"]
                if st.get("run_state") in ("AWAIT_APPROVAL", "PLAN"):
                    if st.get("run_state") == "PLAN":
                        state.set_run_state(ctx, st, "AWAIT_APPROVAL", f"approval {decision_id}")
                    state.set_run_state(ctx, st, "RUNNING", f"plan approved ({decision_id})")
        elif op in ("cut-tasks", "restore-tasks") and plan is not None:
            for tid in targets:
                task = plan.by_id.get(tid)
                if task is None or task.executor != ctx.executor:
                    continue
                if status.current_status(doc, tid) != "cut-proposed":
                    continue
                entry = status.entry_of(doc, tid) or {}
                if recovering and entry.get("decision") != decision_id:
                    continue
                to = "cut" if op == "cut-tasks" else str(entry.get("previous_status") or "planned")
                status.transition(ctx, doc, task, to, evidence=[f"decision:{decision_id}"], plan=plan)
                doc_changed = True
        elif op in ("unblock-tasks", "retry-task") and plan is not None:
            for tid in targets:
                task = plan.by_id.get(tid)
                if task is None or task.executor != ctx.executor:
                    continue
                if status.current_status(doc, tid) in ("blocked-manual", "blocked-decision"):
                    entry = status.entry_of(doc, tid) or {}
                    # only a block that predates the resolution (a later block is a new problem)
                    if clock.parse_utc(str(entry.get("since_utc"))) > resolved_at:
                        continue
                    if entry.get("decision") != decision_id:
                        entry["decision"] = decision_id
                    status.transition(ctx, doc, task, "ready", evidence=[f"decision:{decision_id}"], plan=plan)
                    doc_changed = True
                    unblocked.append(tid)
        elif op == "amend":
            nxt.append(f"{exec_line} amend --decision {decision_id} --patch {_patch_arg(ctx, eff)}")
        elif op == "policy-patch":
            nxt.append(f"{exec_line} ingest --patch {_patch_arg(ctx, eff)} --decision {decision_id}")
        elif op == "quota-override":
            current = ((st or {}).get("quota") or {}).get("override") or {}
            other = current.get("decision")
            if other == decision_id:
                pass  # already applied
            elif recovering and other and (_resolved_at(ctx.layout, str(other)) or "") > str(resolution["at_utc"]):
                pass  # a later decision's override stands
            else:
                override = _quota_override(ctx, st, eff, decision_id)
                if override is not None:
                    events.append(ctx, "quota", {"override": override, "decision": decision_id})
        applied.append(str(op))
    # decision tasks linked to this proposal: running -> done once the resolution (and a file proof) holds
    if plan is not None:
        for tid in proposal.get("tasks") or ():
            task = plan.by_id.get(tid)
            if task is None or task.kind != "decision" or task.executor != ctx.executor:
                continue
            entry = status.entry_of(doc, tid)
            if entry is None or entry.get("status") != "running":
                continue
            if entry.get("decision") not in (None, decision_id):
                continue
            entry["decision"] = decision_id
            ok, _details = status.file_proof_status(task)
            if ok:
                status.transition(ctx, doc, task, "done", evidence=[f"decision:{decision_id}"], plan=plan)
                unblocked.append(tid)
            doc_changed = True
    if doc_changed:
        statusio.save(ctx, doc)
    if st is not None:
        awaiting_remove(st, decision_id)
        state.save(ctx, st)
    fe_choice, fe_errors = _frontend_choice(ctx, plan, proposal, choice, by, source, quote, decision_id)
    errors += fe_errors
    if any(e.code == "E_DEPENDENCY_MISSING" for e in fe_errors):
        dep_title = "/frontend choices.schema.json absent : réponse gardée, choices.json en attente"
        dep_tasks = list(proposal.get("tasks") or ())
        dedup = dedup_of("dependency-missing", dep_title, dep_tasks)
        earlier = [h for h in status.decision_headers(ctx.layout)
                   if h.get("record") == "proposal" and h.get("dedup") == dedup] if recovering else []
        if earlier:
            dep_id = str(earlier[-1]["id"])
        else:
            dep_id, _d = propose(ctx, kind="dependency-missing", title=dep_title,
                                 options=default_options("dependency-missing"), tasks=dep_tasks, deadline=None,
                                 recommended="fixed")
        nxt.append(f"decision {dep_id} (dependency-missing) opened")
    if source == "notion":
        queue_notion(ctx, decision_id, {"Ingérée": "__YES__"})
    if not (recovering and _resolved_event_exists(ctx, decision_id)):
        data = {"id": decision_id, "choice": choice, "by": by, "source": source, "effects": applied}
        if recovering:
            data["recovered"] = True
        events.append(ctx, "decision.resolved", data)
    return {"id": decision_id, "choice": choice, "effects_applied": applied, "next": nxt,
            "unblocked": sorted(set(unblocked)), "frontend_choice": fe_choice, "_errors": errors}


MAX_EFFECT_ATTEMPTS = 3
PARK_OPTIONS: list[dict] = [
    {"id": "retry", "label": "Réessayer les effets", "consequence": "le prochain status les rejoue (3 essais de plus)",
     "effects": [{"op": "none"}]},
    {"id": "drop", "label": "Abandonner les effets", "consequence": "la résolution reste écrite, ses effets non "
     "appliqués sont à faire à la main", "effects": [{"op": "none"}]},
]


def _read_intent(ctx: Ctx, path: Path) -> dict:
    """The intent document. An unreadable one (a crash in the write, a foreign edit) is logged as a warning that
    names the file, then counts as a fresh intent: its try counter restarts (contract revision 3, Q-B04 m3)."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as err:
        problem = type(err).__name__
    else:
        if isinstance(doc, dict):
            return doc
        problem = f"a JSON {type(doc).__name__}, not an object"
    ctx.log.warning("unreadable decision-intent file reset to a fresh intent",
                    extra={"data": {"path": ctx.layout.rel(path), "problem": problem}})
    return {}


def _park(ctx: Ctx, did: str, intent: dict, path: Path, attempts: int, code: str, message: str) -> dict:
    """Stop retrying: open a decision for the owner (retry the effects, or drop them) and record it in the intent."""
    title = f"{did} : effets non appliqués après {attempts} essais ({code})"
    try:
        # no tasks: resolving this decision must not complete the linked decision tasks of `did` (apply_resolution
        # moves a running decision task listed in a proposal to done); the title names the stuck decision
        pid, _dedup = propose(ctx, kind="other", title=title, options=[dict(o) for o in PARK_OPTIONS], tasks=[],
                              deadline=None, recommended="retry")
    except Exception as err:  # noqa: BLE001 - parking must not fail `status` either; the next tick tries again
        ctx.log.error("could not open the parking decision", exc_info=True, extra={"data": {"id": did}})
        intent.update({"attempts": attempts, "last_error": {"code": code, "message": message[:200]}})
        jsonio.write_json_atomic(path, intent)
        return {"id": did, "action": "failed", "code": code, "attempts": attempts,
                "message": f"{message[:150]}; parking failed: {type(err).__name__}"}
    intent.update({"attempts": attempts, "parked": pid, "last_error": {"code": code, "message": message[:200]}})
    jsonio.write_json_atomic(path, intent)
    ctx.log.error("decision effects parked after repeated failures",
                  extra={"data": {"id": did, "attempts": attempts, "code": code, "decision": pid}})
    return {"id": did, "action": "parked", "attempts": attempts, "code": code, "message": message[:200],
            "decision": pid}


def complete_pending(ctx: Ctx) -> list[dict]:
    """`status`: finish the resolutions a crash or an error left half-applied (state lock held; the plan lock too
    when one of them approves the plan). An intent without its resolution block is dropped (nothing was resolved;
    the owner's answer can be resolved again). The effects run as `decision resolve`, the command that owns those
    transitions.

    Bounded: each try is counted in the intent (`attempts`, written before the effects run, so a crash counts too).
    Any error fails the try, not the `status` command (a bug in an effect is logged with its traceback and reported
    as E_INTERNAL; `status` shows each failed try as one line of data.warnings and of its digest, contract revision
    3). After MAX_EFFECT_ATTEMPTS failed tries the intent is parked behind an `other` decision with the
    options `retry` (three more tries) and `drop` (the intent is removed; the resolution stands, its missing effects
    are the owner's to do); a parked intent is not tried again until that decision is resolved.
    Returns one {id, action: applied|dropped|failed|parked|waiting|abandoned, ...} per intent."""
    out: list[dict] = []
    as_resolve = status.with_command(ctx, "decision resolve")
    for did in pending_intents(ctx.layout):
        path = intent_path(ctx.layout, did)
        proposal, resolution = decisionsio.find(ctx.layout, did)
        if proposal is None or resolution is None:
            path.unlink(missing_ok=True)
            out.append({"id": did, "action": "dropped"})
            continue
        intent = _read_intent(ctx, path)
        parked = intent.get("parked")
        if isinstance(parked, str) and parked:
            _pp, park_res = decisionsio.find(ctx.layout, parked)
            if park_res is None:
                out.append({"id": did, "action": "waiting", "decision": parked,
                            "attempts": int(intent.get("attempts") or 0)})
                continue
            if park_res.get("choice") == "drop":
                # the record is the parking decision itself (its proposal names `did`, its resolution says drop)
                path.unlink(missing_ok=True)
                ctx.log.warning("decision effects dropped by the owner", extra={"data": {"id": did,
                                                                                         "decision": parked}})
                out.append({"id": did, "action": "abandoned", "decision": parked})
                continue
            intent = {k: v for k, v in intent.items() if k not in ("parked", "attempts", "last_error")}
        attempts = int(intent.get("attempts") or 0) + 1
        intent.update({"id": did, "choice": resolution.get("choice"), "at_utc": resolution.get("at_utc"),
                       "attempts": attempts})
        jsonio.write_json_atomic(path, intent)
        plan = planmod.load(ctx.layout) if ctx.layout.plan.exists() else None
        try:
            data = apply_resolution(as_resolve, proposal, resolution, plan=plan, recovering=True)
        except ExecError as err:
            code, message = err.code, err.message
            ctx.log.warning("decision effects not re-applied",
                            extra={"data": {"id": did, "code": code, "attempt": attempts}})
        except Exception as err:  # noqa: BLE001 - a bug in an effect must not fail every later `status`
            code, message = "E_INTERNAL", redact(f"{type(err).__name__}: {err}")
            ctx.log.error("decision effects raised an unexpected error", exc_info=True,
                          extra={"data": {"id": did, "attempt": attempts}})
        else:
            path.unlink(missing_ok=True)
            out.append({"id": did, "action": "applied", "effects_applied": data["effects_applied"],
                        "unblocked": data["unblocked"], "next": data["next"],
                        "frontend_choice": data["frontend_choice"]})
            continue
        if attempts >= MAX_EFFECT_ATTEMPTS:
            out.append(_park(ctx, did, intent, path, attempts, code, message))
        else:
            intent["last_error"] = {"code": code, "message": message[:200]}
            jsonio.write_json_atomic(path, intent)
            out.append({"id": did, "action": "failed", "code": code, "message": message[:200],
                        "attempts": attempts})
    return out


def pending_needs_plan_lock(layout: Layout) -> bool:
    """True when a pending intent's chosen option approves the plan (status then takes the plan lock first)."""
    for did in pending_intents(layout):
        proposal, resolution = decisionsio.find(layout, did)
        if proposal is None or resolution is None:
            continue
        for opt in proposal.get("options") or ():
            if opt.get("id") == resolution.get("choice") and any(e.get("op") == "approve-plan"
                                                                 for e in opt.get("effects") or ()):
                return True
    return False


# --- Notion fetch results (NOTION.md 10.2)------------------------------------------------------------------------

def _props_from_text(text: str) -> dict | None:
    stripped = text.strip()
    candidates: list[Any] = []
    try:
        candidates.append(json.loads(stripped))
    except json.JSONDecodeError:
        pass
    for m in re.finditer(r"<properties>\s*(\{.*?\})\s*</properties>", text, flags=re.DOTALL):
        try:
            candidates.append(json.loads(m.group(1)))
        except json.JSONDecodeError:
            continue
    for cand in candidates:
        found = _find_props(cand)
        if found is not None:
            return found
    return None


def _find_props(obj: Any) -> dict | None:
    if isinstance(obj, dict):
        if "Clé" in obj and ("Réponse" in obj or "Décision" in obj):
            return obj
        for value in obj.values():
            found = _find_props(value)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = _find_props(value)
            if found is not None:
                return found
    elif isinstance(obj, str) and "Clé" in obj:
        return _props_from_text(obj)
    return None


def _plain(value: Any) -> str:
    """A Notion property value as plain text (string, or a rich-text array of {plain_text|text})."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(_plain(v) for v in value)
    if isinstance(value, dict):
        for k in ("plain_text", "content", "text", "value", "name"):
            if k in value:
                return _plain(value[k])
    return str(value)


def notion_fields(result_file: Path, key: str) -> dict[str, str]:
    """{key, answer, decision} read from a stored `notion-fetch` result of the row `key` (NOTION.md 10.2): the
    properties object (raw JSON or inside <properties>...</properties>) holding `Clé`, `Réponse`, `Décision`.
    UsageError when the file holds no such object or the row is another key's."""
    if not result_file.is_file():
        raise UsageError(f"{posix(result_file)} does not exist")
    text = result_file.read_bytes().decode("utf-8-sig", errors="replace")
    props = _props_from_text(text)
    if props is None:
        raise ValidationFailed(f"{posix(result_file)} holds no Notion row properties (Clé, Réponse, Décision)",
                               code="E_CHECK", hint="store the raw notion-fetch result of the row")
    row_key = _plain(props.get("Clé")).strip()
    if row_key != key:
        raise ValidationFailed(f"the fetched row is {row_key!r}, not {key}", code="E_CHECK")
    return {"key": row_key, "answer": _plain(props.get("Réponse")), "decision": _plain(props.get("Décision")).strip(),
            "responsible": _plain(props.get("Responsable")).strip()}


def _read_text_file(path: str | None, what: str) -> str:
    if not path:
        raise UsageError(f"{what} is required")
    p = Path(path)
    if not p.is_file():
        raise UsageError(f"{what} {posix(p)} does not exist")
    return p.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")


def cmd_resolve(ctx: Ctx, args: Namespace) -> CommandResult:
    """`decision resolve --id D --choice-file F --by devA|devB|owner --source S --quote-file F` or
    `--from-notion RESULT_FILE` in place of both files."""
    if not re.match(r"^D-[0-9]{3,}$", str(args.id)):
        raise UsageError(f"--id {args.id!r} is not a decision id")
    if not args.by:
        raise UsageError("--by devA|devB|owner is required")
    if args.from_notion:
        fields = notion_fields(Path(args.from_notion), str(args.id))
        choice, quote, source = fields["decision"], fields["answer"], "notion"
        if not quote.strip():
            quote = f"(Notion) {choice}"
    else:
        choice = _read_text_file(args.choice_file, "--choice-file").strip()
        quote = _read_text_file(args.quote_file, "--quote-file").rstrip("\n")
        source = args.source or "terminal"
    proposal, _res = decisionsio.find(ctx.layout, str(args.id))
    approve = bool(proposal) and any(e.get("op") == "approve-plan"
                                     for o in (proposal or {}).get("options") or () if o.get("id") == choice
                                     for e in o.get("effects") or ())
    if approve:
        with status.plan_lock(ctx), status.state_lock(ctx):
            data = resolve(ctx, decision_id=str(args.id), choice=choice, by=str(args.by), source=source, quote=quote)
    else:
        with status.state_lock(ctx):
            data = resolve(ctx, decision_id=str(args.id), choice=choice, by=str(args.by), source=source, quote=quote)
    errors = data.pop("_errors", [])
    return CommandResult(data=data, errors=errors, exit_code=1 if errors else 0)
