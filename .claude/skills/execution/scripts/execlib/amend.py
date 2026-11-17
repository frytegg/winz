"""`exec.py amend`: change the approved plan under a resolved decision, with the state repository's push as the
compare-and-set (contract/CLI.md 2 `amend`, TWO-DEV.md 4, FIX-MODE.md 6).

Procedure: lock plan and git-state; push this clone's own unpushed state commits first (a remaining unpushed
commit is exit 3 E_GIT with the hint to run `sync`); then, at most three times: fetch and integrate origin/main,
re-read plan.json, apply the patch from scratch (new ids above the fetched maximum, TD-A1), validate with both
status files and TD-A1..TD-A6, write plan.json (plus the catalogue, gates.json and plant files), commit `chore(plan):
amend v<n> (<decision>)` from a message file, push HEAD:main. Any rejected push drops only the amend commit just
made (`git reset --keep HEAD~1`, never a reset to origin) and retries; after three rejections: exit 1
E_CAS_REJECTED with the local state repository as it was. After the push: events, and the superseded tasks of this
executor go to `superseded` through `status.transition` (lane B04, imported lazily; when absent, the next
`status` applies them, TWO-DEV.md TD-R1).

Forbidden changes are policy refusals (exit 4): an unknown patch key (deletion), an id change (renumbering), a
field outside the changeable list, a removed or higher-id dependency, a decision missing, unresolved, of the wrong
kind or already applied (E_AMEND_APPLIED), and the TD-A3/A4/A6 rules (E_AMEND_IN_FLIGHT).
"""
from __future__ import annotations

import argparse
import copy
import dataclasses
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Mapping

from . import catalogue, decisionsio, events, gitutil, locks, plan, statusio, templates, validate
from .clock import format_utc, from_epoch
from .errors import (CasRejected, CheckFailed, ErrorItem, GitError, InternalError, PolicyRefused, UsageError,
                     ValidationFailed)
from .jsonio import read_json, write_json_atomic
from .log import get_logger
from .model import CommandResult, Ctx
from .paths import Layout

_LOG = get_logger("execlib.amend")
AMENDABLE_KINDS = frozenset({"amendment", "cut", "spec-gap", "fix-selection", "retry-exhausted", "scope-change"})
PATCH_KEYS = frozenset({"add_requirements", "add_tasks", "change", "supersede", "reassign", "gates_json", "proofs"})
CHANGEABLE = frozenset({"title", "description", "estimate", "depends_on", "writes", "resources", "release_utc",
                        "deadline_utc", "anchor", "brief_refs", "max_attempts"})
IN_FLIGHT = frozenset({"running", "built", "verifying"})
TERMINAL = frozenset({"done", "cut", "superseded"})
MAX_ATTEMPTS = 3


def _refuse(msg: str, code: str = "E_POLICY") -> PolicyRefused:
    return PolicyRefused(msg, code=code)


def _status_of(statuses: Mapping[str, dict], task: Mapping) -> str:
    entry = ((statuses.get(task["executor"]) or {}).get("tasks") or {}).get(task["id"])
    return entry["status"] if entry else "planned"


def _num(tid: str) -> int:
    return int(tid[1:])


def check_decision(layout: Layout, decision_id: str, plan_raw: Mapping) -> dict:
    prop, res = decisionsio.find(layout, decision_id)
    if prop is None:
        raise _refuse(f"decision {decision_id} does not exist")
    if res is None:
        raise _refuse(f"decision {decision_id} is not resolved")
    if prop.get("kind") not in AMENDABLE_KINDS:
        raise _refuse(f"decision {decision_id} is of kind {prop.get('kind')}, which cannot amend the plan")
    if any(a.get("decision") == decision_id for a in plan_raw.get("amendments") or ()):
        raise _refuse(f"decision {decision_id} was already applied by an amendment", "E_AMEND_APPLIED")
    return prop


def apply_patch(plan_raw: dict, patch: dict, decision: str, layout: Layout, profile: dict, now: datetime, *,
                executor: str = "A", statuses: Mapping[str, dict] | None = None, other_silent: bool = False
                ) -> tuple[dict, dict]:
    """The amended plan (validated by the caller) and a summary {added, changed, superseded, requirements_added,
    gates_json}. Raises PolicyRefused for every forbidden change."""
    statuses = statuses or {}
    unknown = sorted(set(patch) - PATCH_KEYS)
    if unknown:
        code = "E_RENUMBER" if any(k in ("delete", "remove", "renumber", "ids") for k in unknown) else "E_POLICY"
        raise _refuse(f"patch keys {unknown} are not allowed (tasks are never deleted or renumbered: supersede "
                      "them)", code)
    if plan_raw.get("approved") is None:
        raise _refuse("amend changes an approved plan; before approval, re-run exec.py plan instantiate",
                      "E_PLAN_APPROVED")
    before = plan.plan_digest(plan_raw)
    out = copy.deepcopy(plan_raw)
    by_id = {t["id"]: t for t in out["tasks"]}

    def own(tid: str, what: str) -> dict:
        t = by_id.get(tid)
        if t is None:
            raise UsageError(f"{what}: unknown task {tid}")
        return t

    def check_in_flight(t: dict, what: str) -> None:
        st = _status_of(statuses, t)
        if st in IN_FLIGHT:
            raise _refuse(f"{t['id']} is {st}: {what} waits until its wave is ingested (TD-A3)", "E_AMEND_IN_FLIGHT")

    def check_owner(t: dict, what: str, reassign: bool = False) -> None:
        if t["executor"] == executor:
            return
        if reassign and other_silent and _status_of(statuses, t) in ("planned", "ready"):
            return
        raise _refuse(f"{t['id']} belongs to executor {t['executor']}: {what} is that executor's own amendment "
                      "(TD-A6)", "E_AMEND_IN_FLIGHT")

    changed: list[str] = []
    for item in patch.get("change") or ():
        t = own(item.get("task", ""), "change")
        fields = item.get("fields") or {}
        if "id" in fields or "key" in fields:
            raise _refuse(f"{t['id']}: ids and keys are never changed (renumbering)", "E_RENUMBER")
        bad = sorted(set(fields) - CHANGEABLE)
        if bad:
            raise _refuse(f"{t['id']}: fields {bad} cannot be changed by amend (proofs go through `proofs`, owners "
                          "through `reassign`)")
        check_owner(t, "a change")
        if {"writes", "resources"} & set(fields):
            check_in_flight(t, "a change of writes or resources")
        if "depends_on" in fields:
            new = list(fields["depends_on"])
            removed = sorted(set(t["depends_on"]) - set(new))
            if removed:
                raise _refuse(f"{t['id']}: dependencies {removed} would be removed (amend only adds dependencies)")
            for d in new:
                if d not in by_id:
                    raise UsageError(f"{t['id']}: unknown dependency {d}")
                if _num(d) >= _num(t["id"]):
                    raise _refuse(f"{t['id']}: a dependency on {d} is not a lower id", "E_DEP_ORDER")
            added_deps = [d for d in new if d not in t["depends_on"]]
            for d in added_deps:
                if by_id[d]["executor"] != t["executor"] and _status_of(statuses, t) not in ("planned", "ready"):
                    raise _refuse(f"{t['id']} is {_status_of(statuses, t)}: a cross-executor dependency on {d} "
                                  "would contradict its running wave (TD-A4)", "E_AMEND_IN_FLIGHT")
            fields = {**fields, "depends_on": sorted(set(new), key=_num)}
        t.update(copy.deepcopy(fields))
        changed.append(t["id"])
    for item in patch.get("proofs") or ():
        t = own(item.get("task", ""), "proofs")
        check_owner(t, "a proof change")
        check_in_flight(t, "a proof change")
        t["proof"] = copy.deepcopy(item["proof"])
        t["proof_author"] = "test-designer"
        if t["id"] not in changed:
            changed.append(t["id"])
    for item in patch.get("reassign") or ():
        t = own(item.get("task", ""), "reassign")
        if not item.get("executor") or not item.get("owner"):
            raise _refuse(f"{t['id']}: a reassignment names both the executor and the owner (TD-A2)", "E_OWNER")
        check_owner(t, "a reassignment", reassign=True)
        check_in_flight(t, "a reassignment")
        t["executor"] = item["executor"]
        t["owner"] = item["owner"]
        if item.get("lane"):
            t["lane"] = item["lane"]
        if t["id"] not in changed:
            changed.append(t["id"])
    superseded: list[str] = []
    for tid in patch.get("supersede") or ():
        t = own(tid, "supersede")
        check_owner(t, "a supersession")
        check_in_flight(t, "a supersession")
        if _status_of(statuses, t) in TERMINAL:
            raise _refuse(f"{tid} is {_status_of(statuses, t)}: a terminal task is never superseded")
        superseded.append(tid)
    existing_req = {r["id"] for r in out["requirements"]}
    for r in patch.get("add_requirements") or ():
        if r.get("id") in existing_req:
            raise CheckFailed(f"requirement {r.get('id')} already exists", code="E_GROUP")
    additions = {"add_tasks": patch.get("add_tasks") or [], "add_requirements": patch.get("add_requirements") or [],
                 "supersede": superseded, "lanes": out["lanes"]}
    if additions["add_tasks"] or additions["add_requirements"]:
        out, ids = templates.instantiate_more(out, additions, profile, layout, now, lane_of=validate.lane_for)
        added = sorted(ids.values(), key=_num)
    else:
        added = []
    req_added = sorted({r["id"] for r in out["requirements"]} - existing_req)
    gates_doc = None
    if patch.get("gates_json"):
        src = Path(patch["gates_json"])
        if not src.is_file():
            raise UsageError(f"gates_json {src.as_posix()} does not exist")
        gates_doc = read_json(src)
        if not isinstance(gates_doc, dict):
            raise ValidationFailed("gates_json is not a JSON object (gates.py config)", code="E_SCHEMA")
    version = int(out.get("plan_version", 1)) + 1
    out["plan_version"] = version
    out["updated_utc"] = format_utc(now)
    record = {"plan_version": version, "at_utc": format_utc(now), "by": executor, "decision": decision,
              "summary": (f"{decision}: {len(added)} added, {len(changed)} changed, {len(superseded)} superseded"
                          + (", gates.json" if gates_doc is not None else ""))[:300],
              "added": added, "changed": sorted(changed, key=_num), "superseded": sorted(superseded, key=_num),
              "requirements_added": req_added, "plan_sha256_before": before}
    out.setdefault("amendments", [])
    record["plan_sha256_after"] = plan.plan_digest(out)
    out["amendments"] = list(out["amendments"]) + [record]
    return out, {"added": added, "changed": record["changed"], "superseded": record["superseded"],
                 "requirements_added": req_added, "gates_json": gates_doc}


def _validate(layout: Layout, now: datetime, old: dict, new: dict, profile: dict | None, policy: dict | None,
              gates_doc: dict | None) -> validate.VReport:
    vctx = validate.VContext(profile=profile, policy=policy, statuses=statusio.load_all(layout), now=now,
                             skills_present=validate.frontend_parts_present(), layout=layout,
                             decisions=decisionsio.read_blocks(layout),
                             gates_json=gates_doc if gates_doc is not None else (
                                 read_json(layout.gates_json) if layout.gates_json.is_file() else None),
                             with_status=True)
    rep = validate.validate_plan(new, vctx)
    ident = validate.check_identity(old, new)
    if ident:
        rep = validate.VReport(rep.errors + tuple(ident), rep.warnings, rep.stats)
    return rep


# --- git ---------------------------------------------------------------------------------------------------------------

def _count(git: gitutil.Git, rng: str) -> int:
    return int(git.run("rev-list", "--count", rng).stdout.strip() or "0")


def _integrate(git: gitutil.Git) -> None:
    """Bring origin/main into the state clone (rebase with autostash: exec.py's own uncommitted state files stay)."""
    if _count(git, "HEAD..origin/main") == 0:
        return
    res = git.run("rebase", "--autostash", "origin/main", check=False)
    if res.exit_code != 0:
        git.run("rebase", "--abort", check=False)
        raise GitError("the state clone could not integrate origin/main (a non-union state file conflicts)",
                       hint="run exec.py sync; two writers touched one state file")


def push_pending(git: gitutil.Git) -> int:
    """Push this clone's own unpushed state commits (sync --push-only semantics); E_GIT when one remains."""
    for _ in range(MAX_ATTEMPTS):
        git.fetch()
        if _count(git, "origin/main..HEAD") == 0:
            return 0
        _integrate(git)
        if git.push_head("main").ok:
            return 1
    raise GitError("an unpushed state commit remains after three pushes", hint="run exec.py sync first")


def other_silent(git: gitutil.Git, executor: str, profile: Mapping, now: datetime) -> bool:
    """TWO-DEV.md 8.4: the other executor's newest state commit on the remote is older than 2 x every_min + 30."""
    other = "B" if executor == "A" else "A"
    every = int(((profile or {}).get("heartbeat") or {}).get("every_min") or 20)
    res = git.run("log", "-1", "--format=%ct", "-E", f"--grep=^chore\\(state\\): {other} ", "origin/main", check=False)
    out = res.stdout.strip()
    if res.exit_code != 0 or not out:
        return True
    return now - from_epoch(int(out)) > timedelta(minutes=2 * every + 30)


def _write_catalogue(ctx: Ctx, profile: dict | None, entries: list[dict]) -> bool:
    """Write the catalogue (schema-checked by catalogue.write); True when its bytes changed."""
    target = catalogue.target_path(profile or {}, ctx.layout.state)
    before = target.read_bytes() if target.is_file() else None
    catalogue.write(ctx, profile or {}, entries)
    return before != target.read_bytes()


def _write_outputs(ctx: Ctx, layout: Layout, new: dict, profile: dict | None, gates_doc: dict | None
                   ) -> tuple[list[str], bool, list[dict] | None]:
    """plan.json, the catalogue, gates.json and plant files; returns (state-relative paths to commit,
    catalogue_changed, deferred catalogue entries).

    A catalogue inside the state repository is written now and committed with the amendment, so a rejected push's
    `reset --keep HEAD~1` restores it. One outside it (profile.paths.feature_catalogue in the product repo) is
    only schema-checked here and returned as deferred: cas_amend writes it after the push lands, so an amendment
    that never landed (E_CAS_REJECTED) leaves no trace in it."""
    plan.save(ctx, new, allow_approved=True)
    paths = ["plan.json"]
    cat_changed = False
    deferred: list[dict] | None = None
    entries = catalogue.generate(new)
    if entries:
        target = catalogue.target_path(profile or {}, layout.state)
        try:
            rel = layout.rel(target)
        except ValueError:
            rel = None
        if rel is None:
            items = catalogue.check(entries)
            if items:
                raise ValidationFailed(f"the feature catalogue is invalid: {items[0].message}", code="E_SCHEMA",
                                       items=items)
            deferred = entries
        else:
            cat_changed = _write_catalogue(ctx, profile, entries)
            paths.append(rel)
    if gates_doc is not None:
        write_json_atomic(layout.gates_json, gates_doc)
        paths.append("gates.json")
    for rel, doc in templates.plant_files(new).items():
        dest = layout.state / rel
        if not dest.is_file():
            write_json_atomic(dest, doc)
            paths.append(rel)
    return sorted(set(paths)), cat_changed, deferred


def cas_amend(ctx: Ctx, decision_id: str, patch: dict) -> dict:
    layout = ctx.layout
    executor = ctx.executor or "A"
    profile = read_json(layout.profile) if layout.profile.is_file() else None
    policy = read_json(layout.policy) if layout.policy.is_file() else None
    git = gitutil.Git(layout.state)
    scratch = layout.local / "tmp"
    with locks.hold(layout, "plan", command=ctx.command), locks.hold(layout, "git-state", command=ctx.command):
        push_pending(git)
        silent = other_silent(git, executor, profile or {}, ctx.now)
        for attempt in range(1, MAX_ATTEMPTS + 1):
            git.fetch()
            _integrate(git)
            old = plan.load_raw(layout)
            check_decision(layout, decision_id, old)
            new, summary = apply_patch(old, patch, decision_id, layout, profile or {}, ctx.now, executor=executor,
                                       statuses=statusio.load_all(layout), other_silent=silent)
            rep = _validate(layout, ctx.now, old, new, profile, policy, summary["gates_json"])
            if not rep.ok:
                raise CheckFailed(f"the amended plan is invalid: {rep.errors[0].code} {rep.errors[0].message}",
                                  code=rep.errors[0].code, items=list(rep.errors),
                                  data={"validation": rep.to_data(), "plan_version": old.get("plan_version")})
            paths, cat_changed, deferred_catalogue = _write_outputs(ctx, layout, new, profile,
                                                                    summary["gates_json"])
            message = f"chore(plan): amend v{new['plan_version']} ({decision_id})"
            sha = git.commit_paths(paths, message, scratch=scratch)
            pushed = git.push_head("main")
            if pushed.ok:
                if deferred_catalogue is not None:  # outside the state repo: written only once the amendment landed
                    cat_changed = _write_catalogue(ctx, profile, deferred_catalogue)
                return {"plan_version": new["plan_version"], "added": summary["added"],
                        "changed": summary["changed"], "superseded": summary["superseded"],
                        "requirements_added": summary["requirements_added"],
                        "push": {"attempts": attempt, "sha": sha}, "catalogue_changed": cat_changed,
                        "warnings": [w.to_dict() for w in rep.warnings]}
            _LOG.warning("amend push rejected; dropping the amend commit and retrying",
                         extra={"data": {"attempt": attempt, "stderr": pushed.stderr_tail[-300:]}})
            git.run("reset", "--keep", "HEAD~1")
        raise CasRejected(f"the amend push was rejected {MAX_ATTEMPTS} times; the state clone is as it was",
                          hint="run exec.py sync, then amend again")


def _post_push(ctx: Ctx, result: dict, decision_id: str) -> list[ErrorItem]:
    """Events, and own superseded tasks -> superseded through status.transition (lane B04)."""
    warnings: list[ErrorItem] = []
    layout = ctx.layout
    with locks.hold(layout, "state", command=ctx.command):
        events.append(ctx, "plan.amended", {"plan_version": result["plan_version"], "decision": decision_id,
                                           "added": result["added"], "changed": result["changed"],
                                           "superseded": result["superseded"], "sha": result["push"]["sha"]})
        if result["catalogue_changed"]:
            events.append(ctx, "catalogue.generated", {"plan_version": result["plan_version"]})
        own_sup = []
        raw = plan.load_raw(layout)
        by_id = {t["id"]: t for t in raw["tasks"]}
        for tid in result["superseded"]:
            if by_id[tid]["executor"] == ctx.executor:
                own_sup.append(tid)
        if not own_sup:
            return warnings
        try:
            from . import status
        except ImportError:
            if (Path(__file__).resolve().parent / "status.py").is_file():
                raise
            _LOG.warning("status transitions to superseded deferred to the next `status` (lane B04 absent; "
                         "TWO-DEV.md TD-R1 applies them from the amendment record)",
                         extra={"data": {"tasks": own_sup}})
            return warnings
        from .model import PlanModel
        model = PlanModel.from_raw(raw)
        doc = statusio.load(layout, ctx.executor or "A")
        for tid in own_sup:
            status.transition(ctx, doc, model.by_id[tid], "superseded",
                              evidence=[f"amendment:{result['plan_version']}:{decision_id}"])
        statusio.save(ctx, doc)
    return warnings


def cmd_amend(ctx: Ctx, args: argparse.Namespace) -> CommandResult:
    if ctx.executor is None:
        ctx = dataclasses.replace(ctx, executor="A")
    patch_path = Path(args.patch)
    if not patch_path.is_file():
        what = "is a directory, not a file" if patch_path.is_dir() else "does not exist"
        where = "" if patch_path.is_absolute() else f" (relative to {Path.cwd().as_posix()})"
        raise UsageError(f"--patch {patch_path.as_posix()} {what}{where}")
    # read_json: a BOM is stripped with W_BOM and malformed JSON is E_SCHEMA naming the line, never E_INTERNAL
    patch = read_json(patch_path)
    if not isinstance(patch, dict):
        raise UsageError("the patch is a JSON object (CLI.md amend)")
    result = cas_amend(ctx, args.decision, patch)
    warns = [ErrorItem(w["code"], w["message"], task=w.get("task")) for w in result.pop("warnings", [])]
    warns += _post_push(ctx, result, args.decision)
    return CommandResult(data=result, warnings=warns)
