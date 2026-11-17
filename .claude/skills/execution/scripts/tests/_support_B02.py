"""Helpers of lane B02's tests (plan invariants, templates, catalogue, amend, ingest). Not a test module.

- `FrontendSkill`: a temporary home whose `.claude/skills` holds a /frontend skill made of the pinned copies under
  fixtures/B02/ (the real-format library or the contract-format sample, /frontend's schemas, a fake checker, fake
  wave fragments and empty references), plus empty /harden and /hackathon references. In process it is reached
  through paths._SKILLS_ROOT_OVERRIDE; an exec.py subprocess reaches it through `env()`, which points USERPROFILE
  and HOME at the temp home (paths.other_skill falls back to Path.home(), and a subprocess cannot see the
  in-process override). So no test reads or writes the real ~/.claude/skills.
- `fake_lanes()`: in-process fakes of lane B03's `schedule` and lane B04's `decisions` and `status`, through the
  MODULES.md signatures, installed in sys.modules only while the real module files are absent (LANES.md 1).
- `StateDir`: a state directory with the B02 fixture profile and policy relocated into a temp root, a spec file
  and its resolved spec-validation decision.
- `run_handler`: calls an exec.py handler in process with a Ctx and a Namespace.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import json
import re
import shutil
import sys
import types
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

import _support as S

from execlib import clock, decisionsio, jsonio, locks, paths, state as state_mod
from execlib.errors import TransitionRefused
from execlib.log import get_logger
from execlib.model import Ctx

B02 = S.FIXTURES / "B02"
REAL_LIB = B02 / "frontend-real-b05cbd4e.json"
SAMPLE_LIB = B02 / "frontend-sample.json"
FE_SCHEMAS = B02 / "frontend-schemas"
INVARIANTS = B02 / "invariants"
EXECLIB = S.SCRIPTS_DIR / "execlib"
FE_REFS = ("00-contract", "01-brief", "02-references", "03-directions", "04-brand", "05-tokens", "06-build",
           "07-states-web3", "08-motion", "09-recording", "10-gates", "12-critique", "13-stack", "14-copy",
           "15-ip-provenance")


def load(name: str) -> Any:
    return json.loads((B02 / name).read_text(encoding="utf-8"))


class FrontendSkill:
    """A temp skills root with a /frontend skill; `parts` chooses what exists."""

    def __init__(self, library: Path | None = SAMPLE_LIB, *, checker: bool = True, fragments: bool = True,
                 schemas: bool = True, library_doc: Any = None) -> None:
        self.home = S.mkdtemp()
        self.root = self.home / ".claude" / "skills"
        self.skill = self.root / "frontend"
        (self.skill / "assets" / "task-templates").mkdir(parents=True)
        if library_doc is not None:
            S.write_text(self.skill / "assets" / "task-templates" / "frontend.json",
                         json.dumps(library_doc, indent=2) + "\n")
        elif library is not None:
            shutil.copyfile(library, self.skill / "assets" / "task-templates" / "frontend.json")
        if schemas:
            (self.skill / "assets" / "schemas").mkdir(parents=True)
            for f in FE_SCHEMAS.glob("*.json"):
                shutil.copyfile(f, self.skill / "assets" / "schemas" / f.name)
        if checker:
            S.write_text(self.skill / "scripts" / "frontend-check.mjs", "// fake checker for B02 tests\n")
        if fragments:
            S.write_text(self.skill / "assets" / "wave-fragments" / "critique.js",
                         "async function feCritique(api, input) { return {ok: true}; }\n")
            S.write_text(self.skill / "assets" / "wave-fragments" / "directions.js",
                         "async function feDirections(api, input) { return {ok: true}; }\n")
        for r in FE_REFS:
            S.write_text(self.skill / "references" / f"{r}.md", f"# {r}\n")
        for skill in ("harden", "hackathon"):
            (self.root / skill / "references").mkdir(parents=True)
        for r in ("01-find-the-gap", "02-verification", "03-claims-ledger", "04-demo-audit", "05-pitch-craft",
                  "06-operations"):
            S.write_text(self.root / "hackathon" / "references" / f"{r}.md", f"# {r}\n")
        S.write_text(self.root / "harden" / "references" / "reporting.md", "# reporting\n")
        self._saved: Path | None = None

    def __enter__(self) -> FrontendSkill:
        self._saved = paths._SKILLS_ROOT_OVERRIDE
        paths._SKILLS_ROOT_OVERRIDE = self.root
        return self

    def __exit__(self, *exc: Any) -> None:
        paths._SKILLS_ROOT_OVERRIDE = self._saved
        self.cleanup()

    def env(self, **overrides: Any) -> dict[str, str]:
        """S.env_isolated() for an exec.py subprocess whose home is this temp home: Path.home() reads USERPROFILE
        on Windows and HOME elsewhere, so paths.other_skill() resolves to this skills root."""
        return S.env_isolated(USERPROFILE=str(self.home), HOME=str(self.home), **overrides)

    @contextlib.contextmanager
    def active(self) -> Iterator[FrontendSkill]:
        """The in-process override alone (no cleanup on exit), for a FrontendSkill a test keeps across calls."""
        saved = paths._SKILLS_ROOT_OVERRIDE
        paths._SKILLS_ROOT_OVERRIDE = self.root
        try:
            yield self
        finally:
            paths._SKILLS_ROOT_OVERRIDE = saved

    def cleanup(self) -> None:
        S.rmtree(self.home)


# --- fakes of lanes B03 and B04 -----------------------------------------------------------------------------------

BUILD_COMPLETE_LEAD_MIN = 150


def _fake_schedule() -> types.ModuleType:
    mod = types.ModuleType("execlib.schedule")

    def build_complete_deadline(profile: dict, plan: Any, harden_p80_min: float) -> datetime:
        subs = [d.at for d in plan.deadlines if d.kind == "submission"]
        end = min(subs) if subs else clock.parse_utc(profile["event"]["deadline_utc"])
        return end - timedelta(minutes=BUILD_COMPLETE_LEAD_MIN)

    def simulate(plan: Any, statuses: Any, profile: dict, **kw: Any) -> dict:
        return {"zones": [{"deadline": "DL-submission", "p80_utc": "2026-10-03T12:30:00Z"}]}

    mod.build_complete_deadline = build_complete_deadline  # type: ignore[attr-defined]
    mod.simulate = simulate  # type: ignore[attr-defined]
    mod.calls = []  # type: ignore[attr-defined]
    return mod


def _fake_status() -> types.ModuleType:
    mod = types.ModuleType("execlib.status")
    mod.calls = []  # type: ignore[attr-defined]

    def transition(ctx: Ctx, doc: dict, task: Any, to: str, *, evidence: list[str], reason: str | None = None) -> None:
        # B04's evidence vocabulary (status.py, Q-B04-21): every item is `<prefix>:<value>`, e.g. decision:D-002 or
        # amendment:2:D-003. The fake refuses a bare value, so a B02 caller passing one fails here, not after B04 lands.
        for item in evidence:
            if not re.fullmatch(r"[a-z][a-z-]*:\S.*", str(item)):
                raise TransitionRefused(f"evidence item {item!r} is not <prefix>:<value>")
        entry = doc.setdefault("tasks", {}).setdefault(task.id, {"status": "planned", "since_utc": S.FIXED_NOW,
                                                                "attempts": 0, "reruns": 0, "history": []})
        entry["history"].append({"from": entry["status"], "to": to, "at_utc": clock.format_utc(ctx.now),
                                 "by": ctx.command, "evidence": list(evidence)})
        entry["status"] = to
        entry["since_utc"] = clock.format_utc(ctx.now)
        mod.calls.append((task.id, to))  # type: ignore[attr-defined]

    mod.transition = transition  # type: ignore[attr-defined]
    return mod


def _fake_decisions(status_mod: types.ModuleType) -> types.ModuleType:
    mod = types.ModuleType("execlib.decisions")
    mod.state = state_mod  # type: ignore[attr-defined]
    mod.status = status_mod  # type: ignore[attr-defined]
    mod.calls = []  # type: ignore[attr-defined]

    def propose(ctx: Ctx, *, kind: str, title: str, options: list[dict], tasks: list[str], deadline: Any,
                recommended: str | None, extra: dict | None = None) -> tuple[str, bool]:
        dedup = jsonio.sha256_json([kind, title, sorted(tasks)])
        for prop in decisionsio.open_proposals(ctx.layout):
            if prop.get("dedup") == dedup:
                return prop["id"], True
        did = decisionsio.next_id(ctx.layout, ctx.executor or "A")
        header = {"schema": "execution.decision/1", "record": "proposal", "id": did,
                  "at_utc": clock.format_utc(ctx.now), "by": f"exec@{ctx.executor or 'A'}", "kind": kind,
                  "title": title, "tasks": list(tasks), "options": options, "recommended": recommended,
                  "deadline_utc": None, "dedup": dedup, **(extra or {})}
        decisionsio.append_block(ctx, header, title)
        mod.calls.append((did, kind))  # type: ignore[attr-defined]
        return did, False

    mod.propose = propose  # type: ignore[attr-defined]
    return mod


@contextlib.contextmanager
def fake_lanes() -> Iterator[dict[str, types.ModuleType]]:
    """Install fakes of execlib.schedule (B03), decisions and status (B04) through the MODULES.md signatures, in
    place of whatever is importable, for the duration of the block (B02's tests never depend on another lane's
    work in progress; LANES.md 1)."""
    status_f = _fake_status()
    fakes = {"schedule": _fake_schedule(), "status": status_f, "decisions": _fake_decisions(status_f)}
    import execlib
    saved = {n: (sys.modules.get(f"execlib.{n}"), getattr(execlib, n, None)) for n in fakes}
    for name, mod in fakes.items():
        sys.modules[f"execlib.{name}"] = mod
        setattr(execlib, name, mod)
    try:
        yield fakes
    finally:
        for name, (mod, attr) in saved.items():
            if mod is None:
                sys.modules.pop(f"execlib.{name}", None)
            else:
                sys.modules[f"execlib.{name}"] = mod
            if attr is None:
                if hasattr(execlib, name):
                    delattr(execlib, name)
            else:
                setattr(execlib, name, attr)


# --- documents -----------------------------------------------------------------------------------------------------

def relocate(obj: Any, old: str, new: str) -> Any:
    if isinstance(obj, str):
        return obj.replace(old, new)
    if isinstance(obj, list):
        return [relocate(x, old, new) for x in obj]
    if isinstance(obj, dict):
        return {k: relocate(v, old, new) for k, v in obj.items()}
    return obj


def decision_text(blocks: list[dict]) -> str:
    out = []
    for b in blocks:
        out.append(decisionsio.HEADER_PREFIX + jsonio.canonical_bytes(b).decode("utf-8") + decisionsio.HEADER_SUFFIX)
        out.append("")
        out.append("(test block)")
        out.append("")
    return "\n".join(out)


def spec_validation_blocks(did: str, sha: str) -> list[dict]:
    options = [{"id": "validate", "label": "ok", "consequence": "ok", "effects": [{"op": "validate-spec"}]},
               {"id": "revise", "label": "no", "consequence": "no", "effects": [{"op": "none"}]}]
    return [{"schema": "execution.decision/1", "record": "proposal", "id": did, "at_utc": S.FIXED_NOW, "by": "exec@A",
             "kind": "spec-validation", "title": f"Valider la spécification ({sha[:8]})", "tasks": [],
             "options": options, "recommended": "validate", "deadline_utc": None,
             "dedup": jsonio.sha256_json(["spec-validation", sha]), "spec_sha256": sha},
            {"schema": "execution.decision/1", "record": "resolution", "id": did, "at_utc": S.FIXED_NOW, "by": "devA",
             "choice": "validate", "source": "terminal", "quote": "ok spec"}]


def amendment_blocks(did: str, kind: str = "amendment", *, resolved: bool = True) -> list[dict]:
    options = [{"id": "apply", "label": "apply", "consequence": "amend", "effects": [{"op": "amend"}]},
               {"id": "skip", "label": "skip", "consequence": "nothing", "effects": [{"op": "none"}]}]
    out = [{"schema": "execution.decision/1", "record": "proposal", "id": did, "at_utc": S.FIXED_NOW, "by": "exec@A",
            "kind": kind, "title": f"amend {did}", "tasks": [], "options": options, "recommended": "apply",
            "deadline_utc": None, "dedup": jsonio.sha256_json([kind, did, []])}]
    if resolved:
        out.append({"schema": "execution.decision/1", "record": "resolution", "id": did, "at_utc": S.FIXED_NOW,
                    "by": "devA", "choice": "apply", "source": "terminal", "quote": "go"})
    return out


SPEC_TEXT = "# Queue Clock spec\n\nFR-001 FR-002 FR-003 FR-004 FR-005 FR-006 FR-007\nSC-001 SC-002 SC-003 SC-004 SC-005\n"


class StateDir:
    """A temp root with private/, repo/.execution (state dir), the relocated fixture profile and policy, the spec
    and its resolved spec-validation decision D-001."""

    def __init__(self, *, root: Path | None = None, spec_text: str = SPEC_TEXT, decisions: bool = True) -> None:
        self.root = root or S.mkdtemp()
        self.private = self.root / "private"
        self.repo = self.root / "repo"
        self.state = self.repo / ".execution"
        for d in (self.private, self.state / "local", self.state / "status"):
            d.mkdir(parents=True, exist_ok=True)
        self.layout = paths.layout_for(None, self.state)
        base = paths.posix(self.root)
        self.profile = relocate(load("profile.json"), "C:/x/qc", base)
        self.policy = relocate(load("policy.json"), "C:/x/qc", base)
        self.profile["paths"]["feature_catalogue"] = paths.posix(self.state / "feature-catalogue.json")
        self.profile["frontend"]["paths"]["feature_catalogue"] = self.profile["paths"]["feature_catalogue"]
        jsonio.write_json_atomic(self.layout.profile, self.profile)
        jsonio.write_json_atomic(self.layout.policy, self.policy)
        self.spec = self.private / "SPEC.md"
        S.write_text(self.spec, spec_text)
        self.spec_sha = jsonio.sha256_file(self.spec)
        if decisions:
            S.write_text(self.layout.decisions, decision_text(spec_validation_blocks("D-001", self.spec_sha)))

    def draft(self, **over: Any) -> dict:
        d = relocate(load("draft.json"), "C:/x/qc", paths.posix(self.root))
        d["spec"] = {"path": paths.posix(self.spec), "sha256": self.spec_sha}
        d.update(over)
        return d

    def write_draft(self, draft: dict) -> Path:
        jsonio.write_json_atomic(self.layout.planner_draft, draft)
        return self.layout.planner_draft

    def local_state(self, run_state: str = "INGEST") -> None:
        doc = S.build_local_state("A", run_state=run_state)
        jsonio.write_json_atomic(self.layout.local_state, doc)

    def cleanup(self) -> None:
        S.rmtree(self.root)


def make_ctx(layout: paths.Layout, command: str, *, executor: str | None = "A", now: str = S.FIXED_NOW) -> Ctx:
    return Ctx(layout=layout, executor=executor, now=clock.parse_utc(now), by="orchestrator", pretty=False,
               command=command, log=get_logger("execlib.test"))


def run_handler(fn: Any, layout: paths.Layout, command: str, *, executor: str | None = "A", **args: Any) -> Any:
    return fn(make_ctx(layout, command, executor=executor), argparse.Namespace(**args))


def instantiate_args(**over: Any) -> dict:
    a = {"draft": None, "dry_run": False, "proofs": None, "propose_approval": False, "pre_t0": False}
    a.update(over)
    return a


def apply_ops(doc: Any, ops: list[dict]) -> Any:
    """Fixture patch ops: {op: set|remove|append, path: JSON pointer, value}; '-' appends to an array."""
    out = copy.deepcopy(doc)
    for op in ops:
        toks = [t.replace("~1", "/").replace("~0", "~") for t in op["path"].lstrip("/").split("/")]
        cur: Any = out
        for t in toks[:-1]:
            cur = cur[int(t)] if isinstance(cur, list) else cur[t]
        last = toks[-1]
        if op["op"] == "set":
            if isinstance(cur, list):
                cur[int(last)] = copy.deepcopy(op["value"])
            else:
                cur[last] = copy.deepcopy(op["value"])
        elif op["op"] == "append":
            (cur[int(last)] if isinstance(cur, list) else cur[last]).append(copy.deepcopy(op["value"]))
        elif op["op"] == "remove":
            if isinstance(cur, list):
                del cur[int(last)]
            else:
                del cur[last]
        else:
            raise ValueError(op["op"])
    return out


def hold_state(layout: paths.Layout) -> Any:
    return locks.hold(layout, "state", command="test")


# --- invariant fixtures (fixtures/B02/invariants/) -------------------------------------------------------------------

def _ids(bundle: dict) -> dict[str, str]:
    return {t["key"]: t["id"] for t in bundle["plan"]["tasks"]}


def _resolve_values(value: Any, ids: dict[str, str]) -> Any:
    if isinstance(value, str) and value.startswith("#"):
        return ids[value[1:]]
    if isinstance(value, list):
        return [_resolve_values(v, ids) for v in value]
    if isinstance(value, dict):
        return {k: _resolve_values(v, ids) for k, v in value.items()}
    return value


def _walk(doc: Any, path: str) -> tuple[Any, str | int]:
    toks = [t.replace("~1", "/").replace("~0", "~") for t in path.lstrip("/").split("/")]
    cur = doc
    resolved: list[Any] = []
    for t in toks:
        if isinstance(cur, list):
            if t.startswith("@"):
                want = t[1:]
                idx = next(i for i, x in enumerate(cur) if x.get("key") == want or x.get("id") == want)
            else:
                idx = int(t)
            resolved.append(idx)
        else:
            resolved.append(t)
        if len(resolved) < len(toks):
            cur = cur[resolved[-1]]
    return cur, resolved[-1]


def apply_bundle_ops(bundle: dict, ops: list[dict]) -> dict:
    from execlib import plan as plan_mod
    out = copy.deepcopy(bundle)
    for op in ops:
        ids = _ids(out)
        kind = op["op"]
        if kind == "approve":
            p = out["plan"]
            p["approved"] = {"at_utc": S.FIXED_NOW, "by": "devA", "decision": "D-002",
                             "plan_sha256": plan_mod.plan_digest(p)}
            continue
        if kind == "amendment":
            p = out["plan"]
            prev = (p["amendments"][-1]["plan_sha256_after"] if p["amendments"] else p["approved"]["plan_sha256"])
            p["plan_version"] = int(p["plan_version"]) + 1
            p["amendments"].append({"plan_version": p["plan_version"], "at_utc": S.FIXED_NOW, "by": "A",
                                    "decision": "D-003", "summary": "fixture amendment",
                                    "added": _resolve_values(op.get("added", []), ids),
                                    "changed": _resolve_values(op.get("changed", []), ids),
                                    "superseded": _resolve_values(op.get("superseded", []), ids),
                                    "plan_sha256_before": prev, "plan_sha256_after": plan_mod.plan_digest(p)})
            continue
        if kind == "swap":
            arr, _last = _walk(out, op["path"] + "/0")
            arr[op["i"]], arr[op["j"]] = arr[op["j"]], arr[op["i"]]
            continue
        if kind == "drop-dep":
            task, idx = _walk(out, "/plan/tasks/" + op["task"])
            t = task[idx]
            t["depends_on"] = [d for d in t["depends_on"] if d != ids[op["dep"][1:]]]
            continue
        parent, last = _walk(out, op["path"])
        value = _resolve_values(op.get("value"), ids)
        if kind == "set":
            parent[last] = value
        elif kind == "append":
            parent[last].append(value)
        elif kind == "remove":
            del parent[last]
        else:
            raise ValueError(kind)
    return out


def load_fixture(name: str) -> dict:
    return json.loads((INVARIANTS / name).read_text(encoding="utf-8"))


def materialise(name: str, root: Path) -> dict:
    """The fixture's bundle relocated under `root` (spec written there), ops applied."""
    fx = load_fixture(name)
    base = json.loads((INVARIANTS / fx["base"]).read_text(encoding="utf-8"))
    rootp = paths.posix(root)
    bundle = relocate(base, "C:/x/qc", rootp)
    ops = relocate(fx["ops"], "C:/x/qc", rootp)
    bundle = apply_bundle_ops(bundle, ops)
    spec = Path(bundle["plan"]["spec"]["path"])
    S.write_text(spec, fx.get("spec_text_after", bundle["spec_text"]))
    bundle["fixture"] = fx
    return bundle
