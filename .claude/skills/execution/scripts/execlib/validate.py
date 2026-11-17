"""Plan invariants P-01 ... P-27 and the two-developer rules TD-V1 ... TD-V9 (contract/SCHEMAS.md 2-3, 7;
TWO-DEV.md 1.2; FRONTEND.md 2.5).

`validate_plan` checks the schema first (through `plan`'s own checker: MODULES.md 8 gives this module no edge to
`schema`) and runs the invariants only on a schema-valid plan. Each check is one function returning error items;
codes starting with W_ are warnings. A task is *inactive* when an amendment record superseded it, or, with status
files, when its status is cut or superseded: inactive tasks are ignored by coverage, overlap and order checks.

Readings of the contract that this module makes (each listed in the B02 report as a contract question):
- manifests (P-10, SCHEMAS.md 7.3): a write glob "can match a manifest" when it intersects a root-level manifest
  name, `.github/workflows/*`, or a literal manifest path the plan itself declares (a lane glob or a write such as
  `ui/package.json`). `globs.is_manifest_glob` matches manifest names at any depth, which would put `src/engine/**`
  under the ordered `manifest` resource and forbid every parallel lane; FRONTEND.md 2.5's narrowing of
  `{ui_root}/**` only makes sense with this reading.
- contract-wave tasks (P-20) are the tasks of phases setup and contract (ARCHITECTURE.md 6.2 puts the bootstrap and
  the CI workflow in wave 0, and both write protected globs).
- P-17's README-screenshots rule excludes, besides submit (EX-DLV-FORM), flip (EX-DLV-FLIP, EX-DLV-FLIP-CHECK) and
  tag (EX-DLV-TAG), the docs and push-tag freezes (EX-FREEZE-DOCS, EX-FREEZE-PUSH-TAG): the screenshots change the
  README, which the docs freeze then locks.
- P-18's "every required task of phases setup, contract, build, integrate and verify is its ancestor" excludes the
  descendants of the build gate (the replay and convergence passes a fix cycle adds after it).
"""
from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from . import decisionsio, globs, graph, jsonio, plan, resources
from .clock import parse_utc
from .errors import CheckFailed, ErrorItem, ValidationFailed
from .model import PlanModel, Task
from .paths import Layout, other_skill

# --- matrices (SCHEMAS.md 3) ---------------------------------------------------------------------------------------

PHASE_KIND: Mapping[str, frozenset[str]] = {
    "code": frozenset({"setup", "contract", "build", "integrate", "fix", "deliverable"}),
    "test": frozenset({"setup", "contract", "build", "verify", "fix"}),
    "infra": frozenset({"setup", "contract", "integrate", "ops", "fix", "deliverable"}),
    "deploy": frozenset({"integrate", "ops", "deliverable", "fix"}),
    "tx": frozenset({"build", "integrate", "ops", "deliverable", "fix"}),
    "research": frozenset({"setup", "recon", "audit", "build"}),
    "manual": frozenset({"manual", "ops", "recon", "deliverable"}),
    "decision": frozenset({"decision"}),
    "watch": frozenset({"ops", "verify", "recon"}),
    "gate": frozenset({"build", "verify", "audit", "deliverable", "fix"}),
}
PROOF_KIND: Mapping[str, frozenset[str]] = {
    "command": frozenset({"code", "test", "infra", "gate", "research", "deploy", "watch"}),
    "tx": frozenset({"tx", "deploy"}),
    "ci": frozenset({"infra", "watch", "gate"}),
    "file": frozenset({"research", "manual", "decision"}),
    "url": frozenset({"deploy", "watch"}),
    "human-attest": frozenset({"manual", "decision"}),
}
PHASE_ORDER: tuple[str, ...] = ("setup", "contract", "build", "integrate", "verify", "ops", "recon", "audit",
                                "manual", "decision", "deliverable", "fix")
AGENT_WRITE_KINDS = frozenset({"code", "test", "infra"})
BUILD_SCOPE_PHASES = frozenset({"setup", "contract", "build", "integrate", "verify"})
FIX_CYCLE_VERIFY_TEMPLATES = frozenset({"EX-REPLAY", "EX-CONVERGE"})
CONTRACT_WAVE_PHASES = frozenset({"setup", "contract"})
COVERING_KINDS = frozenset({"code", "test", "infra", "deploy", "tx", "gate"})
ORDERED = ("manifest", "wallet", "db")

ROOT_MANIFESTS: tuple[str, ...] = (
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package-lock.json", "yarn.lock", "Cargo.toml",
    "Cargo.lock", "pyproject.toml", "requirements*.txt", "uv.lock", "go.mod", "go.sum", "foundry.toml", "aiken.toml",
    "tsconfig*.json", ".github/workflows/*",
)
MANIFEST_NAMES: tuple[str, ...] = (
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package-lock.json", "yarn.lock", "Cargo.toml",
    "Cargo.lock", "pyproject.toml", "requirements*.txt", "uv.lock", "go.mod", "go.sum", "foundry.toml", "aiken.toml",
)
_SECRET_SEGMENT = re.compile(r"^\.(env|npmrc|dev\.vars)($|[.*?\[])")
_SECRET_OK = re.compile(r"^\.env(\..+)?\.(example|sample|template)$")
_ALLOW_SKIP = "--allow-skip"

# Run-level templates of executor A (TWO-DEV.md TD-V3).
RUN_LEVEL_IDS = frozenset({"EX-APPROVE", "EX-NAME", "EX-BOOT", "EX-CI", "EX-GATE-BUILD", "EX-CONVERGE", "EX-REPLAY",
                           "EX-HARDEN-PARK", "EX-HARDEN-REVIEW", "EX-FIX-SELECT", "EX-FIX-GATE", "EX-DEVB-SETUP",
                           "EX-DEVB-CHECK"})
RUN_LEVEL_PREFIXES = ("EX-FREEZE-", "EX-HB-")
SCREENSHOT_EXCEPTIONS = frozenset({"EX-DLV-FORM", "EX-DLV-FLIP", "EX-DLV-FLIP-CHECK", "EX-DLV-TAG",
                                   "EX-FREEZE-DOCS", "EX-FREEZE-PUSH-TAG", "EX-DLV-SCREENSHOTS"})


@dataclass(frozen=True)
class VContext:
    profile: dict | None
    policy: dict | None
    statuses: Mapping[str, dict] | None
    now: datetime
    skills_present: Mapping[str, bool]
    # Additive (B02): where decisions.md and the spec live, the merge gate config, the run mode.
    layout: Layout | None = None
    decisions: Sequence[dict] | None = None
    gates_json: dict | None = None
    with_status: bool = False
    pre_t0: bool = False


@dataclass(frozen=True)
class Check:
    id: str
    fn: Callable[[PlanModel, VContext], list[ErrorItem]]


@dataclass(frozen=True)
class VReport:
    errors: tuple[ErrorItem, ...]
    warnings: tuple[ErrorItem, ...]
    stats: dict

    @property
    def ok(self) -> bool:
        return not self.errors

    def to_data(self) -> dict:
        return {"ok": self.ok, "errors": [e.to_dict() for e in self.errors],
                "warnings": [w.to_dict() for w in self.warnings], "stats": self.stats}


# --- shared facts ----------------------------------------------------------------------------------------------------

@dataclass
class _Facts:
    graph: graph.Graph
    inactive: frozenset[str]
    tpl: dict[str, str | None] = field(default_factory=dict)


_MEMO: dict[int, _Facts] = {}


def template_id(task: Task) -> str | None:
    """'EX-GATE-BUILD' for template 'execution:EX-GATE-BUILD', None for a planner task."""
    return task.template.split(":", 1)[1] if task.template else None


def superseded_ids(raw: Mapping) -> frozenset[str]:
    """Tasks an amendment record superseded."""
    out: set[str] = set()
    for am in raw.get("amendments") or ():
        out.update(am.get("superseded") or ())
    return frozenset(out)


def inactive_ids(raw: Mapping, statuses: Mapping[str, dict] | None) -> frozenset[str]:
    out = set(superseded_ids(raw))
    for doc in (statuses or {}).values():
        for tid, entry in (doc.get("tasks") or {}).items():
            if entry.get("status") in ("cut", "superseded"):
                out.add(tid)
    return frozenset(out)


def _facts(p: PlanModel, v: VContext) -> _Facts:
    key = id(p.raw)
    f = _MEMO.get(key)
    if f is None:
        f = _Facts(graph=graph.Graph.of(p), inactive=inactive_ids(p.raw, v.statuses if v.with_status else None),
                   tpl={t.id: template_id(t) for t in p.tasks})
        _MEMO[key] = f
    return f


def _active(p: PlanModel, v: VContext) -> list[Task]:
    inactive = _facts(p, v).inactive
    return [t for t in p.tasks if t.id not in inactive]


def _num(tid: str) -> int:
    return int(tid[1:]) if tid[1:].isdigit() else 1 << 30


def _e(code: str, msg: str, *, task: str | None = None, path: str | None = None) -> ErrorItem:
    return ErrorItem(code, msg, task=task, path=path)


def _with_tpl(p: PlanModel, v: VContext, tid: str) -> list[Task]:
    tpl = _facts(p, v).tpl
    return [t for t in _active(p, v) if tpl[t.id] == tid]


def _strings(obj: Any) -> Iterable[str]:
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k in sorted(obj):
            yield from _strings(obj[k])
    elif isinstance(obj, list):
        for item in obj:
            yield from _strings(item)


# --- helpers used by templates/planning/amend ----------------------------------------------------------------------

def lane_for(writes: Sequence[str], lanes: Sequence[Mapping]) -> str:
    """The unique lane whose globs contain every write (SCHEMAS.md 6.2 step 9); CheckFailed E_LANE otherwise."""
    found = []
    for lane in lanes:
        if all(any(globs.contains(g, w) for g in lane.get("globs") or ()) for w in writes):
            found.append(lane["id"])
    if len(found) != 1:
        raise CheckFailed(f"writes {list(writes)} are contained in {len(found)} lanes ({', '.join(found) or 'none'}):"
                          " exactly one is required", code="E_LANE",
                          hint="give the planner's lanes globs that contain this task's writes")
    return found[0]


def declared_manifests(raw: Mapping) -> tuple[str, ...]:
    """Literal manifest paths the plan declares in lane globs or task writes (e.g. ui/package.json)."""
    out: set[str] = set()
    cands = [g for ln in raw.get("lanes") or () for g in ln.get("globs") or ()]
    cands += [w for t in raw.get("tasks") or () for w in t.get("writes") or ()]
    for g in cands:
        if any(c in g for c in "*?["):
            continue
        base = g.rsplit("/", 1)[-1]
        if any(fnmatch.fnmatchcase(base, n) for n in MANIFEST_NAMES):
            out.add(globs.normalize(g))
    return tuple(sorted(out))


def can_match_manifest(glob: str, declared: Sequence[str]) -> bool:
    return any(globs.intersects(glob, m) for m in (*ROOT_MANIFESTS, *declared))


def is_secret_glob(glob: str) -> bool:
    """A write glob naming an env file or .npmrc in its last segment (never written by any task)."""
    last = globs.normalize(glob).rsplit("/", 1)[-1]
    return bool(_SECRET_SEGMENT.match(last)) and not _SECRET_OK.match(last)


def frontend_parts_present() -> dict[str, bool]:
    """/frontend's files a UI plan needs (P-23): the template library, the checker and both wave fragments."""
    root = other_skill("frontend")
    return {
        "frontend.templates": (root / "assets" / "task-templates" / "frontend.json").is_file(),
        "frontend.checker": (root / "scripts" / "frontend-check.mjs").is_file(),
        "frontend.fragments": all((root / "assets" / "wave-fragments" / n).is_file()
                                  for n in ("critique.js", "directions.js")),
    }


def check_identity(old_raw: Mapping, new_raw: Mapping) -> list[ErrorItem]:
    """P-03 across two plan versions: every old id still exists with the same key and template; new ids are above
    the old maximum (TWO-DEV.md TD-A1)."""
    out: list[ErrorItem] = []
    new_by = {t["id"]: t for t in new_raw.get("tasks") or ()}
    old_ids = [t["id"] for t in old_raw.get("tasks") or ()]
    old_max = max((_num(i) for i in old_ids), default=0)
    for t in old_raw.get("tasks") or ():
        n = new_by.get(t["id"])
        if n is None:
            out.append(_e("E_RENUMBER", f"{t['id']} disappeared: a task is never deleted (supersede it)", task=t["id"]))
        elif n.get("key") != t.get("key") or n.get("template") != t.get("template"):
            out.append(_e("E_RENUMBER", f"{t['id']} changed identity (key or template): ids are never reused",
                          task=t["id"]))
    for tid in new_by:
        if tid not in set(old_ids) and _num(tid) <= old_max:
            out.append(_e("E_RENUMBER", f"new task {tid} is not above the previous maximum T{old_max:03d}", task=tid))
    return out


# --- the checks ----------------------------------------------------------------------------------------------------

def p01(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    ids = [t.id for t in p.tasks]
    if len(set(ids)) != len(ids):
        out.append(_e("E_TASK_ID", "task ids are not unique"))
    nums = [_num(i) for i in ids]
    if nums != sorted(nums):
        out.append(_e("E_TASK_ID", "the tasks array is not sorted by numeric id"))
    for t in p.tasks:
        if not re.fullmatch(r"T\d{3,}", t.id):
            out.append(_e("E_TASK_ID", f"bad task id {t.id!r}", task=t.id))
    return out


def p02(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    for t in p.tasks:
        for d in t.depends_on:
            if d not in p.by_id:
                out.append(_e("E_DEP_ORDER", f"{t.id} depends on unknown task {d}", task=t.id))
            elif _num(d) >= t.num:
                out.append(_e("E_DEP_ORDER", f"{t.id} depends on {d}, which is not a lower id", task=t.id))
    return out


def p03(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    ids = {t.id for t in p.tasks}
    seen_added: set[str] = set()
    later_added: set[str] = set()
    for am in p.raw.get("amendments") or ():
        later_added.update(am.get("added") or ())
    for am in p.raw.get("amendments") or ():
        added = list(am.get("added") or ())
        later_added.difference_update(added)
        before = [i for i in ids if i not in later_added and i not in added]
        before_max = max((_num(i) for i in before), default=0)
        for tid in added:
            if tid in seen_added:
                out.append(_e("E_RENUMBER", f"{tid} is added by two amendments", task=tid))
            seen_added.add(tid)
            if _num(tid) <= before_max:
                out.append(_e("E_RENUMBER", f"amendment v{am.get('plan_version')} added {tid} below the existing "
                              f"maximum T{before_max:03d}", task=tid))
        for key in ("added", "changed", "superseded"):
            for tid in am.get(key) or ():
                if tid not in ids:
                    out.append(_e("E_RENUMBER", f"amendment v{am.get('plan_version')} names {tid}, which no longer "
                                  "exists: tasks are never deleted or renumbered", task=tid))
    return out


def p04(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    req_ids = {r.id for r in p.requirements}
    for t in p.tasks:
        for c in t.covers:
            if c not in req_ids:
                out.append(_e("E_UNCOVERED", f"{t.id} covers unknown requirement {c}", task=t.id))
    if v.pre_t0:
        return out
    active = _active(p, v)
    for r in p.requirements:
        cov = [t for t in active if r.id in t.covers]
        if not cov:
            out.append(_e("E_UNCOVERED", f"requirement {r.id} is covered by no active task", path=r.id))
        elif r.required and r.surface != "none" and not any(t.kind in COVERING_KINDS for t in cov):
            out.append(_e("E_UNCOVERED", f"required requirement {r.id} ({r.surface}) has no covering task of kind "
                          "code, test, infra, deploy, tx or gate", path=r.id))
    return out


def p05(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    rids = [r.id for r in p.requirements]
    if len(set(rids)) != len(rids):
        out.append(_e("E_GROUP", "requirement ids are not unique"))
    gids = [g["id"] for g in p.raw.get("feature_groups") or ()]
    if len(set(gids)) != len(gids):
        out.append(_e("E_GROUP", "feature group ids are not unique"))
    gset = set(gids)
    ui_groups = {r.group for r in p.requirements if r.surface == "ui"}
    for r in p.requirements:
        if r.group is not None and r.group not in gset:
            out.append(_e("E_GROUP", f"requirement {r.id} names unknown feature group {r.group}", path=r.id))
        if r.surface == "ui" and not re.fullmatch(r"FR-\d{3,}", r.id):
            out.append(_e("E_GROUP", f"ui requirement {r.id} is not an FR-nnn id (/frontend's catalogue)", path=r.id))
    for t in p.tasks:
        fg = t.raw.get("feature_group")
        if fg is not None and fg not in gset:
            out.append(_e("E_GROUP", f"{t.id} names unknown feature group {fg}", task=t.id))
        group_param = (t.raw.get("params") or {}).get("group")
        if t.template and group_param not in (None, "all"):
            if group_param != fg:
                out.append(_e("E_GROUP", f"{t.id}: per-group instance params.group {group_param} differs from its "
                              f"feature_group {fg}", task=t.id))
            elif fg not in ui_groups:
                out.append(_e("E_GROUP", f"{t.id}: group {fg} has no ui requirement", task=t.id))
    return out


def p06(p: PlanModel, v: VContext) -> list[ErrorItem]:
    return [_e("E_PHASE_KIND", f"{t.id}: kind {t.kind} is not allowed in phase {t.phase}", task=t.id)
            for t in p.tasks if t.phase not in PHASE_KIND.get(t.kind, frozenset())]


def _devs(v: VContext) -> dict[str, dict]:
    return {d["id"]: d for d in ((v.profile or {}).get("team") or {}).get("devs") or ()}


def p07(p: PlanModel, v: VContext) -> list[ErrorItem]:
    if v.profile is None:
        return []
    out = []
    devs = _devs(v)
    by_exec = {d["executor"]: d for d in devs.values() if d.get("setup") == "full"}
    execs = {d["executor"] for d in devs.values()}
    tpl = _facts(p, v).tpl
    for ln in p.lanes:
        if ln.executor not in execs:
            out.append(_e("E_OWNER", f"lane {ln.id}: no dev of the profile has executor {ln.executor} (TD-V1)",
                          path=ln.id))
    for t in p.tasks:
        if t.executor not in execs:
            out.append(_e("E_OWNER", f"{t.id}: no dev of the profile has executor {t.executor}", task=t.id))
            continue
        if t.owner == "agent" and t.executor not in by_exec:
            out.append(_e("E_OWNER", f"{t.id}: agent task on executor {t.executor}, whose dev is not setup full",
                          task=t.id))
        if t.owner in ("devA", "devB"):
            dev = devs.get(t.owner)
            if dev is None:
                out.append(_e("E_OWNER", f"{t.id}: owner {t.owner} is not a dev of the profile", task=t.id))
                continue
            if dev.get("setup") == "human-only" and t.executor != "A":
                out.append(_e("E_OWNER", f"{t.id}: a human-only dev's task is executed by A", task=t.id))
        tid = tpl[t.id]
        if tid and (tid in RUN_LEVEL_IDS or tid.startswith(RUN_LEVEL_PREFIXES)) and t.executor != "A":
            out.append(_e("E_OWNER", f"{t.id} ({tid}) is run-level: executor A (TD-V3)", task=t.id))
        if t.phase == "deliverable" and t.executor != "A":
            out.append(_e("E_OWNER", f"{t.id}: deliverable tasks have executor A (TD-V3)", task=t.id))
        if t.kind == "decision" and (t.owner != "devA" or t.executor != "A"):
            out.append(_e("E_OWNER", f"{t.id}: decisions belong to dev A on executor A (TD-V5)", task=t.id))
        if t.kind == "manual" and t.owner == "devB":
            dev_b = devs.get("devB") or {}
            want = "A" if (dev_b.get("setup") == "human-only" or tid == "EX-DEVB-SETUP") else "B"
            if t.executor != want:
                out.append(_e("E_OWNER", f"{t.id}: dev B's manual task belongs to executor {want} (TD-V6)",
                              task=t.id))
    dev_b = devs.get("devB")
    if dev_b and dev_b.get("setup") == "full" and not v.pre_t0:
        setups = _with_tpl(p, v, "EX-DEVB-SETUP")
        checks = _with_tpl(p, v, "EX-DEVB-CHECK")
        if len(setups) != 1 or len(checks) != 1:
            out.append(_e("E_OWNER", "a full-setup dev B needs exactly one EX-DEVB-SETUP and one EX-DEVB-CHECK "
                          f"(found {len(setups)} and {len(checks)}; TD-V9)"))
        elif checks:
            g = _facts(p, v).graph
            for t in _active(p, v):
                if t.executor == "B" and checks[0].id not in g.ancestors(t.id):
                    out.append(_e("E_OWNER", f"{t.id} (executor B) does not depend on EX-DEVB-CHECK {checks[0].id} "
                                  "(TD-V9)", task=t.id))
    return out


def p08(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    lane_ids = [ln.id for ln in p.lanes]
    if len(set(lane_ids)) != len(lane_ids):
        out.append(_e("E_LANE", "lane ids are not unique"))
    contract = [ln for ln in p.lanes if ln.contract]
    if len(contract) != 1:
        out.append(_e("E_LANE", f"exactly one contract lane is required (found {len(contract)})"))
    elif contract[0].executor != "A":
        out.append(_e("E_LANE", f"the contract lane {contract[0].id} has executor A (TD-V2)"))
    for i, a in enumerate(p.lanes):
        for b in p.lanes[i + 1:]:
            pairs = globs.overlapping(a.globs, b.globs)
            if pairs:
                out.append(_e("E_LANE", f"lanes {a.id} and {b.id} have intersecting globs {pairs[0][0]} / "
                              f"{pairs[0][1]}"))
    lanes = {ln.id: ln for ln in p.lanes}
    for t in p.tasks:
        if t.kind not in AGENT_WRITE_KINDS:
            continue
        lane = lanes.get(t.lane or "")
        if lane is None:
            out.append(_e("E_LANE", f"{t.id} names unknown lane {t.lane}", task=t.id))
            continue
        if t.executor != lane.executor:
            out.append(_e("E_LANE", f"{t.id} has executor {t.executor} but lane {lane.id} has {lane.executor}",
                          task=t.id))
        for w in t.writes:
            if not any(globs.contains(g, w) for g in lane.globs):
                out.append(_e("E_LANE", f"{t.id} writes {w}, outside its lane {lane.id}", task=t.id))
    fe_execs = {t.executor for t in _active(p, v) if any(globs.intersects(w, ".execution/frontend/**")
                                                          for w in t.writes)}
    if len(fe_execs) > 1:
        out.append(_e("E_LANE", "tasks writing .execution/frontend/** have more than one executor (TD-V4)"))
    return out


def p09(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    g = _facts(p, v).graph
    act = _active(p, v)
    for i, a in enumerate(act):
        for b in act[i + 1:]:
            if not a.writes or not b.writes or g.joined(a.id, b.id):
                continue
            pairs = globs.overlapping(a.writes, b.writes)
            if pairs:
                out.append(_e("E_WRITE_OVERLAP", f"{a.id} and {b.id} are not joined by a dependency and both write "
                              f"{pairs[0][0]} / {pairs[0][1]}", task=b.id))
    return out


def p10(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    g = _facts(p, v).graph
    act = _active(p, v)
    declared = declared_manifests(p.raw)
    for i, a in enumerate(act):
        for b in act[i + 1:]:
            if g.joined(a.id, b.id):
                continue
            shared = resources.ordered_conflicts(a.resources, b.resources)
            if shared:
                out.append(_e("E_RESOURCE_OVERLAP", f"{a.id} and {b.id} share the ordered resource {shared[0]} "
                              "without a dependency path", task=b.id))
    for t in p.tasks:
        for w in t.writes:
            if is_secret_glob(w):
                out.append(_e("E_SECRET_PATH", f"{t.id} writes {w}: env files and .npmrc are never written",
                              task=t.id))
            elif can_match_manifest(w, declared) and "manifest" not in t.resources:
                out.append(_e("E_MANIFEST_UNDECLARED", f"{t.id} writes {w}, which can match a manifest file, without "
                              "the manifest resource", task=t.id))
    return out


def p11(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    for t in p.tasks:
        e = t.estimate
        if not (e.p10 <= e.p50 <= e.p90):
            out.append(_e("E_ESTIMATE", f"{t.id}: p10 <= p50 <= p90 does not hold ({e.p10}/{e.p50}/{e.p90})",
                          task=t.id))
        if t.is_agent and e.p50 <= 0:
            out.append(_e("E_ESTIMATE", f"{t.id}: an agent task needs p50 > 0", task=t.id))
        if t.is_agent and t.kind in AGENT_WRITE_KINDS:
            if e.p90 > 120:
                out.append(_e("E_ESTIMATE", f"{t.id}: p90 {e.p90} min is above 120: split the task", task=t.id))
            elif e.p90 > 60:
                out.append(_e("W_TASK_TOO_BIG", f"{t.id}: p90 {e.p90} min is above 60 (sizing rule)", task=t.id))
    return out


def p12(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    for t in p.tasks:
        ptype = t.proof.get("type")
        allowed = PROOF_KIND.get(ptype, frozenset())
        ok = t.kind in allowed or (ptype in ("file", "url") and t.phase == "deliverable")
        if not ok:
            out.append(_e("E_PROOF_KIND", f"{t.id}: proof type {ptype} does not fit kind {t.kind}", task=t.id))
        if ptype == "command" and "exit_code" not in (t.proof.get("expect") or {}):
            out.append(_e("E_PROOF_KIND", f"{t.id}: a command proof needs expect.exit_code", task=t.id))
        if float(t.proof.get("max_runtime_min") or 0) > 5:
            out.append(_e("W_PROOF_SLOW", f"{t.id}: proof runtime {t.proof.get('max_runtime_min')} min is above 5",
                          task=t.id))
        if t.template and t.raw.get("proof_author") not in ("template", "test-designer"):
            out.append(_e("E_PROOF_KIND", f"{t.id}: a template task's proof_author is template", task=t.id))
        if any(_ALLOW_SKIP in s for s in _strings(t.proof)):
            out.append(_e("E_PROOF_KIND", f"{t.id}: the proof passes {_ALLOW_SKIP} (skipped is open)", task=t.id))
    if v.gates_json is not None and any(_ALLOW_SKIP in s for s in _strings(v.gates_json)):
        out.append(_e("E_PROOF_KIND", f"gates.json passes {_ALLOW_SKIP} (skipped is open)", path="gates.json"))
    return out


def _is_checker(t: Task) -> bool:
    return bool((t.raw.get("params") or {}).get("checker"))


def p13(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    for t in p.tasks:
        nc = t.proof.get("negative_control") or {}
        kind = nc.get("kind")
        if t.kind in ("code", "test") and not _is_checker(t):
            allowed = {"pre-implementation", "planted-defect"}
        elif t.kind == "gate" or _is_checker(t):
            allowed = {"forgery", "planted-defect"}
        elif t.kind == "tx":
            allowed = {"forgery"}
        elif t.kind in ("research", "manual", "decision", "watch"):
            allowed = {"pre-implementation", "planted-defect", "forgery", "not-applicable"}
        elif t.kind == "deploy" and t.proof.get("type") == "url":
            allowed = {"pre-implementation", "planted-defect", "forgery", "not-applicable"}
        else:
            allowed = {"pre-implementation", "planted-defect", "forgery"}
        if kind not in allowed:
            out.append(_e("E_NEGATIVE_CONTROL", f"{t.id}: negative control {kind} is not allowed for kind {t.kind}"
                          f" (allowed: {', '.join(sorted(allowed))})", task=t.id))
        if kind == "not-applicable" and not nc.get("waived_reason"):
            out.append(_e("E_NEGATIVE_CONTROL", f"{t.id}: a waived control needs waived_reason", task=t.id))
    return out


def _windows(v: VContext, dev: str) -> tuple[list[tuple[datetime, datetime]], list[tuple[datetime, datetime]]]:
    d = _devs(v).get(dev) or {}
    awake, busy = [], []
    for w in d.get("availability") or ():
        span = (parse_utc(w["start_utc"]), parse_utc(w["end_utc"]))
        (awake if w["kind"] == "awake" else busy).append(span)
    return awake, busy


def in_free_window(v: VContext, dev: str, at: datetime) -> bool | None:
    """True/False when the dev has availability windows, None when none are declared."""
    awake, busy = _windows(v, dev)
    if not awake and not busy:
        return None
    return any(a <= at < b for a, b in awake) and not any(a <= at < b for a, b in busy)


def p14(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    for t in p.tasks:
        if t.kind not in ("manual", "decision") or not t.manual:
            continue
        m = t.manual
        ls = parse_utc(m["latest_start_utc"])
        if t.deadline is not None and ls > t.deadline:
            out.append(_e("E_MANUAL", f"{t.id}: latest start {m['latest_start_utc']} is after the deadline",
                          task=t.id))
        if t.kind == "decision" and len(m.get("options") or ()) < 2 and not m.get("options_source"):
            out.append(_e("E_MANUAL", f"{t.id}: a decision task needs two options or an options_source", task=t.id))
        push = m.get("push_text")
        if push is not None and t.id not in push:
            out.append(_e("E_MANUAL", f"{t.id}: the push text does not name the task id", task=t.id))
        if v.profile is not None and in_free_window(v, t.owner, ls) is False:
            out.append(_e("W_OUTSIDE_AVAILABILITY", f"{t.id}: latest start {m['latest_start_utc']} is outside "
                          f"{t.owner}'s awake windows", task=t.id))
    return out


def _anchor_ok(ref: str, p: PlanModel, v: VContext) -> bool:
    if ref.startswith("DL-"):
        return any(d.id == ref for d in p.deadlines)
    if ref.startswith("event."):
        if v.profile is None:
            return True
        key = "start_utc" if ref == "event.start" else "deadline_utc"
        return ((v.profile.get("event") or {}).get(key)) is not None
    return ref.split(".")[0] in p.by_id


def p15(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    for t in p.tasks:
        if t.release and t.deadline and t.release > t.deadline:
            out.append(_e("E_TIME", f"{t.id}: release_utc is after deadline_utc", task=t.id))
        if t.anchor:
            if t.release is not None:
                out.append(_e("E_TIME", f"{t.id}: an anchored task has no fixed release_utc", task=t.id))
            refs = [t.anchor.get("relative_to")]
            rec = t.anchor.get("recurrence") or {}
            until = rec.get("until")
            if isinstance(until, str) and not re.fullmatch(r"\d{4}-.*Z", until):
                refs.append(until)
            for ref in refs:
                if ref and not _anchor_ok(ref, p, v):
                    out.append(_e("E_TIME", f"{t.id}: anchor {ref} names no deadline, task or event field",
                                  task=t.id))
    return out


def p16(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out: list[ErrorItem] = []
    if v.pre_t0:
        return out  # a pre-T0 plan holds only research run before T0 by design (FRONTEND.md 11); never approved
    prof = v.profile or {}
    pre = prof.get("prework") or {}
    until_s = pre.get("until_utc")
    designs = (prof.get("frontend") or {}).get("prework_designs", pre.get("designs"))
    tpl = _facts(p, v).tpl
    if until_s:
        until = parse_utc(until_s)
        for t in p.tasks:
            cls = (t.raw.get("params") or {}).get("prework_class")
            need = False
            if pre.get("code") is False and (t.kind in ("code", "test", "infra", "deploy", "tx")
                                             or cls in ("design", "code") or tpl[t.id] == "EX-BOOT"):
                need = True
            if designs is False and cls == "design":
                need = True
            if need and not (t.release is not None and t.release >= until):
                out.append(_e("E_PREWORK", f"{t.id} must be released at or after the prework limit {until_s}",
                              task=t.id))
    if v.policy is not None:
        allowed = [str(a).rstrip("/") for a in (v.policy.get("fences") or {}).get("allow_write_outside") or ()]
        for t in p.tasks:
            for ext in (t.raw.get("params") or {}).get("external_writes") or ():
                base = str(ext).split("*", 1)[0].rstrip("/")
                if not any(base == a or base.startswith(a + "/") for a in allowed):
                    out.append(_e("E_PREWORK", f"{t.id} writes {ext} outside the repository: "
                                  "policy.fences.allow_write_outside must name that folder", task=t.id))
    return out


def _newest(tasks: list[Task]) -> Task | None:
    return max(tasks, key=lambda t: t.num) if tasks else None


def p17(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    act = _active(p, v)
    tpl = _facts(p, v).tpl
    g = _facts(p, v).graph
    dlv = [t for t in act if t.phase == "deliverable"]
    if not dlv:
        return out
    review = _newest(_with_tpl(p, v, "EX-HARDEN-REVIEW"))
    fix_gate = _newest(_with_tpl(p, v, "EX-FIX-GATE"))
    build = _newest(_with_tpl(p, v, "EX-GATE-BUILD"))
    if review is None or fix_gate is None:
        out.append(_e("E_DELIVERABLE_ORDER", "a plan with deliverables holds EX-HARDEN-REVIEW and an EX-FIX-GATE"))
        return out
    fe21 = [t for t in act if t.template == "frontend:FE-21"]
    records = [t for t in act if tpl[t.id] == "EX-DLV-RECORD"]
    for t in dlv:
        anc = g.ancestors(t.id)
        for need, name in ((build, "the build gate"), (review, "EX-HARDEN-REVIEW"), (fix_gate, "the newest EX-FIX-GATE")):
            if need is not None and need.id != t.id and need.id not in anc:
                out.append(_e("E_DELIVERABLE_ORDER", f"{t.id} does not wait for {name} {need.id}", task=t.id))
        if tpl[t.id] in ("EX-DLV-RECORD", "EX-DLV-FLIP", "EX-DLV-TAG"):
            for f in fe21:
                if f.id not in anc:
                    out.append(_e("E_DELIVERABLE_ORDER", f"{t.id} does not wait for FE-21 {f.id}", task=t.id))
        if tpl[t.id] == "EX-DLV-PROSE":
            for r in records:
                if r.id not in anc:
                    out.append(_e("E_DELIVERABLE_ORDER", f"{t.id} (/prose) does not wait for recording {r.id}",
                                  task=t.id))
        if tpl[t.id] == "EX-DLV-SCREENSHOTS":
            for o in dlv:
                if o.id != t.id and tpl[o.id] not in SCREENSHOT_EXCEPTIONS and o.id not in anc:
                    out.append(_e("E_DELIVERABLE_ORDER", f"README screenshots {t.id} do not come after {o.id}",
                                  task=t.id))
    return out


def p18(p: PlanModel, v: VContext) -> list[ErrorItem]:
    if v.pre_t0:
        return []
    gates = _with_tpl(p, v, "EX-GATE-BUILD")
    if len(gates) != 1:
        return [_e("E_BUILD_GATE", f"exactly one execution:EX-GATE-BUILD task is required (found {len(gates)})")]
    gt = gates[0]
    out = []
    spec = gt.proof.get("spec") or {}
    cmd = str(spec.get("cmd") or "")
    if gt.kind != "gate" or gt.phase != "verify":
        out.append(_e("E_BUILD_GATE", f"{gt.id}: the build gate is kind gate, phase verify", task=gt.id))
    if gt.proof.get("type") != "command" or "completion-check.mjs" not in cmd or "--phase build" not in cmd \
            or "--json" not in cmd or spec.get("install") is not True:
        out.append(_e("E_BUILD_GATE", f"{gt.id}: proof must be `node <state>/completion-check.mjs --json --phase "
                      "build` with install: true", task=gt.id))
    facts = _facts(p, v)
    g = facts.graph
    anc = g.ancestors(gt.id)
    desc = g.descendants(gt.id)
    for t in _active(p, v):
        if t.id == gt.id or not t.required or t.phase not in BUILD_SCOPE_PHASES:
            continue
        # Q-B02-7 (conservative reading): the only required build-scope tasks allowed after the gate are the
        # verify-phase EX-REPLAY / EX-CONVERGE instances a fix cycle adds behind it (FIX-MODE.md 6.5). Any other
        # required setup, contract, build, integrate or verify task must stay an ancestor of the gate.
        if t.id in desc and t.phase == "verify" and facts.tpl[t.id] in FIX_CYCLE_VERIFY_TEMPLATES:
            continue
        if t.id not in anc:
            out.append(_e("E_BUILD_GATE", f"required {t.phase} task {t.id} is not an ancestor of the build gate "
                          f"{gt.id}", task=t.id))
    return out


def p19(p: PlanModel, v: VContext) -> list[ErrorItem]:
    freeze_s = ((v.policy or {}).get("git") or {}).get("push_freeze_utc")
    if not freeze_s:
        return []
    freeze = parse_utc(freeze_s)
    out = []
    tpl = _facts(p, v).tpl
    for t in p.tasks:
        if t.kind in ("code", "test", "infra", "deploy") and t.release is not None and t.release >= freeze:
            out.append(_e("E_PUSH_FREEZE", f"{t.id} is released at or after the push freeze {freeze_s}", task=t.id))
        if tpl[t.id] == "EX-DLV-TAG" and t.deadline is not None and t.deadline > freeze:
            out.append(_e("E_PUSH_FREEZE", f"tag task {t.id} is due after the push freeze", task=t.id))
    return out


def p20(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    for t in _active(p, v):
        hits = globs.overlapping(t.writes, p.protected)
        if not hits:
            continue
        if t.phase in CONTRACT_WAVE_PHASES:
            continue
        if t.kind == "test" and t.raw.get("proof_author") == "test-designer":
            continue
        out.append(_e("E_PROTECTED", f"{t.id} ({t.kind}) writes {hits[0][0]}, which intersects the protected glob "
                      f"{hits[0][1]}", task=t.id))
    return out


def p21(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    for t in p.tasks:
        for ref in t.raw.get("brief_refs") or ():
            if not Path(ref).is_file():
                out.append(_e("W_BRIEF_REF_MISSING", f"{t.id}: brief ref {ref} does not exist on this machine",
                              task=t.id))
    return out


def p22(p: PlanModel, v: VContext) -> list[ErrorItem]:
    """max_attempts 1-3 is enforced by the schema (P-22 has no code of its own); nothing more to check."""
    return []


def p23(p: PlanModel, v: VContext) -> list[ErrorItem]:
    ui = [r for r in p.requirements if r.surface == "ui"]
    if not ui:
        return []
    out = []
    missing = sorted(k for k, ok in (v.skills_present or {}).items() if k.startswith("frontend.") and not ok)
    if missing:
        out.append(_e("E_DEPENDENCY_MISSING", f"/frontend parts missing: {', '.join(missing)} (no fallback UI "
                      "template exists)"))
    if v.profile is not None and v.profile.get("frontend") is None:
        out.append(_e("E_NO_FRONTEND", "the plan has ui requirements but the profile has no frontend block"))
    fe = [t for t in _active(p, v) if t.template == "frontend:FE-1x"]
    for r in ui:
        if not any(r.id in t.covers for t in fe):
            out.append(_e("E_NO_FRONTEND", f"ui requirement {r.id} is covered by no frontend:FE-1x task", path=r.id))
    return out


def _submission_at(p: PlanModel, v: VContext) -> datetime | None:
    subs = [d.at for d in p.deadlines if d.kind == "submission"]
    if subs:
        return min(subs)
    dl = ((v.profile or {}).get("event") or {}).get("deadline_utc")
    return parse_utc(dl) if dl else None


def p24(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    ids = [d.id for d in p.deadlines]
    if len(set(ids)) != len(ids):
        out.append(_e("E_DEADLINE", "deadline ids are not unique"))
    if v.pre_t0:
        return out
    sub = _submission_at(p, v)
    if sub is None:
        return out
    bc = [d for d in p.raw.get("deadlines") or () if d["id"] == "DL-build-complete"]
    if not bc:
        out.append(_e("E_DEADLINE", "the profile has a submission deadline but the plan has no DL-build-complete"))
        return out
    d = bc[0]
    if d.get("kind") != "build-complete" or d.get("source") != "computed:schedule":
        out.append(_e("E_DEADLINE", "DL-build-complete is kind build-complete with source computed:schedule"))
    if parse_utc(d["at_utc"]) >= sub:
        out.append(_e("E_DEADLINE", "DL-build-complete is not before the submission deadline"))
    return out


def _decisions(v: VContext) -> Sequence[dict] | None:
    if v.decisions is not None:
        return v.decisions
    if v.layout is not None:
        return decisionsio.read_blocks(v.layout)
    return None


def spec_validation(decisions: Sequence[dict], decision_id: str) -> tuple[dict | None, dict | None]:
    prop = next((d for d in decisions if d["id"] == decision_id and d["record"] == "proposal"), None)
    res = next((d for d in decisions if d["id"] == decision_id and d["record"] == "resolution"), None)
    return prop, res


def resolution_validates(prop: Mapping, res: Mapping) -> bool:
    """The chosen option of a spec-validation proposal carries the validate-spec effect."""
    for opt in prop.get("options") or ():
        if opt.get("id") == res.get("choice"):
            return any(e.get("op") == "validate-spec" for e in opt.get("effects") or ())
    return False


def p25(p: PlanModel, v: VContext) -> list[ErrorItem]:
    spec = p.raw.get("spec") or {}
    decisions = _decisions(v)
    if decisions is None:
        return []
    prop, res = spec_validation(decisions, spec.get("validated_decision", ""))
    err = None
    if prop is None or prop.get("kind") != "spec-validation":
        err = f"{spec.get('validated_decision')} is not a spec-validation decision"
    elif res is None or not resolution_validates(prop, res):
        err = f"{spec.get('validated_decision')} is not resolved with the validate option"
    elif prop.get("spec_sha256") != spec.get("sha256"):
        err = "the validated spec hash differs from the plan's spec hash"
    else:
        path = Path(spec.get("path", ""))
        if not path.is_file():
            err = f"the spec file {spec.get('path')} does not exist"
        elif jsonio.sha256_file(path) != spec.get("sha256"):
            err = "the spec file changed after its validation (hash differs)"
    return [_e("E_SPEC_UNVALIDATED", err, path=spec.get("path"))] if err else []


def p26(p: PlanModel, v: VContext) -> list[ErrorItem]:
    raw = p.raw
    approved = raw.get("approved")
    ams = raw.get("amendments") or []
    if raw.get("plan_version") != 1 + len(ams):
        return [_e("E_PLAN_TAMPERED", f"plan_version {raw.get('plan_version')} != 1 + {len(ams)} amendments")]
    if approved is None:
        return [_e("E_PLAN_TAMPERED", "amendments exist on a plan that was never approved")] if ams else []
    prev = approved.get("plan_sha256")
    for am in ams:
        if am.get("plan_sha256_before") != prev:
            return [_e("E_PLAN_TAMPERED", f"amendment v{am.get('plan_version')}: plan_sha256_before breaks the chain")]
        prev = am.get("plan_sha256_after")
    if prev != plan.plan_digest(raw):
        return [_e("E_PLAN_TAMPERED", "the approved plan changed outside an amendment (digest mismatch)")]
    return []


def p27(p: PlanModel, v: VContext) -> list[ErrorItem]:
    out = []
    if v.pre_t0:
        return out
    for d in p.deadlines:
        if not d.irrecoverable:
            continue
        anchored = [t for t in _active(p, v) if t.anchor and t.anchor.get("relative_to") == d.id]
        due = [t for t in _active(p, v) if t.phase == "deliverable" and t.deadline is not None and t.deadline <= d.at]
        if not anchored and not due:
            out.append(_e("E_GATES", f"irrecoverable deadline {d.id} has no task anchored to it nor a deliverable due "
                          "by it: its DL gate cannot be generated", path=d.id))
    return out


CHECKS: tuple[Check, ...] = tuple(Check(f"P-{i:02d}", fn) for i, fn in enumerate(
    (p01, p02, p03, p04, p05, p06, p07, p08, p09, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22,
     p23, p24, p25, p26, p27), start=1))


# --- the run ------------------------------------------------------------------------------------------------------

def _stats(p: PlanModel, v: VContext, uncovered: list[str]) -> dict:
    by_phase: dict[str, int] = {}
    by_exec: dict[str, int] = {}
    lanes: dict[str, int] = {}
    for t in p.tasks:
        by_phase[t.phase] = by_phase.get(t.phase, 0) + 1
        by_exec[t.executor] = by_exec.get(t.executor, 0) + 1
        if t.lane:
            lanes[t.lane] = lanes.get(t.lane, 0) + 1
    cross = sorted(([t.id, d] for t in p.tasks for d in t.depends_on
                    if d in p.by_id and p.by_id[d].executor != t.executor), key=lambda x: (_num(x[0]), _num(x[1])))
    path, length = critical_path(p, v)
    return {"tasks": len(p.tasks), "requirements": len(p.requirements), "uncovered": uncovered,
            "by_phase": dict(sorted(by_phase.items())), "by_executor": dict(sorted(by_exec.items())),
            "cross_executor_deps": cross, "lanes": dict(sorted(lanes.items())),
            "critical_path_p50_min": round(length, 2), "critical_path": path}


def critical_path(p: PlanModel, v: VContext | None = None) -> tuple[list[str], float]:
    """The longest path of p50 durations over active tasks (ties by lower id)."""
    inactive = inactive_ids(p.raw, None) if v is None else _facts(p, v).inactive
    best: dict[str, tuple[float, str | None]] = {}
    for t in sorted(p.tasks, key=lambda x: x.num):
        if t.id in inactive:
            continue
        prev = [(best[d][0], d) for d in t.depends_on if d in best]
        top = max(prev, key=lambda x: (x[0], -_num(x[1])), default=(0.0, None))
        best[t.id] = (top[0] + t.estimate.p50, top[1])
    if not best:
        return [], 0.0
    end = max(best, key=lambda k: (best[k][0], -_num(k)))
    length = best[end][0]
    path = []
    cur: str | None = end
    while cur is not None:
        path.append(cur)
        cur = best[cur][1]
    return list(reversed(path)), length


def _schema_errors(raw: Any) -> list[ErrorItem]:
    try:
        plan._check(raw, "the plan")  # plan's own schema checker (MODULES.md 8: validate has no schema edge)
    except ValidationFailed as err:
        return err.items()
    return []


def validate_plan(raw: dict, vctx: VContext) -> VReport:
    """Schema first; the invariants only when the schema passes."""
    schema_errs = _schema_errors(raw)
    if schema_errs:
        return VReport(tuple(schema_errs), (), {"tasks": len(raw.get("tasks") or []) if isinstance(raw, dict) else 0})
    ids = [t.get("id") for t in raw.get("tasks") or ()]
    if len(set(ids)) != len(ids):
        dup = sorted({i for i in ids if ids.count(i) > 1})
        return VReport((_e("E_TASK_ID", f"duplicate task ids {', '.join(dup)}"),), (), {"tasks": len(ids)})
    model = PlanModel.from_raw(raw)
    _MEMO.clear()
    errors: list[ErrorItem] = []
    warnings: list[ErrorItem] = []
    try:
        for check in CHECKS:
            items = check.fn(model, vctx)
            for it in items:
                (warnings if it.code.startswith("W_") else errors).append(it)
        if vctx.with_status:
            plan_ids = set(model.by_id)
            for ex, doc in sorted((vctx.statuses or {}).items()):
                for tid in sorted(doc.get("tasks") or {}):
                    if tid not in plan_ids:
                        errors.append(_e("E_STATUS_ORPHAN", f"status/{ex}.json names {tid}, absent from the plan",
                                         task=tid))
        uncovered = sorted({e.path for e in errors if e.code == "E_UNCOVERED" and e.path})
        stats = _stats(model, vctx, uncovered)
    finally:
        _MEMO.clear()
    return VReport(tuple(errors), tuple(warnings), stats)


def codes(report: VReport) -> list[str]:
    return sorted({e.code for e in report.errors})
