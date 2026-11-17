"""Regenerate fixtures/B02/invariants/ (lane B02's plan-invariant fixtures; contract/TESTS.md 3.3).

    python scripts/tests/fixtures/B02/tools/gen_invariants.py

base.json / base2.json / base3.json are bundles {plan, profile, policy, statuses, decisions, spec_text,
skills_present, gates_json}: the B02 fixture draft instantiated through the pinned real-format /frontend library and
the execution library (fake lanes B03/B04), with paths relocated to C:/x/qc (state root) and C:/x/skills (sibling
skills) and brief_refs stripped (P-21 has its own pair). base2 adds a full-setup dev B, a lane L6 of executor B and
one B task. base3 turns the execution library's `flip` and `slides` parameters on (EX-DLV-FLIP-CHECK, EX-DLV-FLIP,
EX-DLV-SLIDES), for the P-17 cases of TESTS.md 3.3 that need them.
Each P-xx / TD-Vn fixture is {base, ops, expect, ...}: `ops` patch the bundle (see _support_B02.apply_bundle_ops),
`expect` lists the error codes (or `expect_warning`) validate must report, exactly. Files are written with LF.
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

TESTS = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(TESTS))
sys.path.insert(0, str(TESTS.parent))

import _support as S  # noqa: E402
import _support_B02 as B  # noqa: E402
from execlib import jsonio, paths, planning, statusio  # noqa: E402

OUT = B.INVARIANTS


def _write(name: str, doc: object) -> None:
    with open(OUT / name, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(doc, indent=1, ensure_ascii=False, sort_keys=False) + "\n")


FLIP_SLIDES = {"flip": "on", "public_repo_url": "https://github.com/example/queue-clock", "slides": "on"}


def build_base(two_dev: bool, exec_params: dict | None = None) -> dict:
    sd = B.StateDir()
    try:
        with B.FrontendSkill(B.REAL_LIB) as fe, B.fake_lanes():
            draft = sd.draft()
            if exec_params:
                lib = next(x for x in draft["libraries"] if x["library"] == "execution")
                lib["params"] = {**lib["params"], **exec_params}
            if two_dev:
                sd.profile["team"]["devs"].append({"id": "devB", "name": "Dev B", "executor": "B", "setup": "full",
                                                   "notion_member": True, "availability": []})
                jsonio.write_json_atomic(sd.layout.profile, sd.profile)
                draft["lanes"].append({"id": "L6", "executor": "B", "title": "Extras", "contract": False,
                                       "globs": ["src/extra/**"]})
                extra = copy.deepcopy(next(t for t in draft["tasks"] if t["key"] == "health-data"))
                extra.update({"key": "extra", "title": "Extra data (dev B)", "executor": "B", "covers": ["FR-004"],
                              "writes": ["src/extra/**"], "depends_on": ["contract-types"],
                              "description": "Extra data: build exactly src/extra/**."})
                draft["tasks"].append(extra)
            sd.write_draft(draft)
            res = B.run_handler(planning.cmd_instantiate, sd.layout, "plan instantiate", **B.instantiate_args())
            if res.exit_code != 0:
                raise SystemExit(f"base instantiation failed: {[e.message for e in res.errors][:5]}")
            plan = json.loads(sd.layout.plan.read_text(encoding="utf-8"))
            root_state, root_skills = paths.posix(sd.root), paths.posix(fe.root)
            bundle = {"plan": plan, "profile": sd.profile, "policy": sd.policy,
                      "statuses": {"A": statusio.default_doc("A"), "B": statusio.default_doc("B")},
                      "decisions": B.spec_validation_blocks("D-001", sd.spec_sha), "spec_text": B.SPEC_TEXT,
                      "skills_present": {"frontend.templates": True, "frontend.checker": True,
                                         "frontend.fragments": True}, "gates_json": None}
            bundle = B.relocate(bundle, root_state, "C:/x/qc")
            bundle = B.relocate(bundle, root_skills, "C:/x/skills")
            for t in bundle["plan"]["tasks"]:
                t["brief_refs"] = []
            return bundle
    finally:
        sd.cleanup()


def ids(bundle: dict) -> dict[str, str]:
    return {t["key"]: t["id"] for t in bundle["plan"]["tasks"]}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = build_base(False)
    base2 = build_base(True)
    base3 = build_base(False, FLIP_SLIDES)
    _write("base.json", base)
    _write("base2.json", base2)
    _write("base3.json", base3)
    last = base["plan"]["tasks"][-1]["key"]
    fx: dict[str, dict] = {}

    def pair(name: str, ok: list, bad: list, code: str, *, base_name: str = "base.json", note: str = "",
             ok_extra: dict | None = None, bad_extra: dict | None = None) -> None:
        fx[f"{name}.ok.json"] = {"base": base_name, "note": note, "ops": ok, "expect": [], **(ok_extra or {})}
        fx[f"{name}.bad.json"] = {"base": base_name, "note": note, "ops": bad, "expect": [code], **(bad_extra or {})}

    pair("P-01", [], [{"op": "swap", "path": "/plan/tasks", "i": 3, "j": 4}], "E_TASK_ID",
         note="tasks array not sorted by numeric id")
    fx["P-01.bad2.json"] = {"base": "base.json", "note": "a duplicate id", "expect": ["E_TASK_ID"],
                            "ops": [{"op": "set", "path": "/plan/tasks/@engine-tests/id", "value": "#engine"}]}
    pair("P-02", [{"op": "append", "path": "/plan/tasks/@engine-tests/depends_on", "value": "#engine"}],
         [{"op": "append", "path": "/plan/tasks/@engine/depends_on", "value": "#engine-tests"}], "E_DEP_ORDER",
         note="T004 depending on T005 with no cycle")
    pair("P-03", [{"op": "approve"}, {"op": "amendment", "added": [f"#{last}"]}],
         [{"op": "approve"}, {"op": "amendment", "added": ["#execution.ex-boot"]}], "E_RENUMBER",
         note="an amendment adding an id below the previous maximum")
    pair("P-04", [{"op": "set", "path": "/plan/tasks/@cli/covers", "value": ["FR-005", "SC-003"]}],
         [{"op": "set", "path": "/plan/tasks/@cli/covers", "value": ["SC-003"]}], "E_UNCOVERED",
         note="FR-005 covered by no task")
    pair("P-05", [{"op": "set", "path": "/plan/requirements/@FR-001/feature_group", "value": "G2"}],
         [{"op": "set", "path": "/plan/requirements/@FR-001/feature_group", "value": "G9"}], "E_GROUP",
         note="a requirement naming an unknown feature group")
    pair("P-06", [{"op": "set", "path": "/plan/tasks/@engine-tests/phase", "value": "verify"}],
         [{"op": "set", "path": "/plan/tasks/@engine-tests/phase", "value": "integrate"}], "E_PHASE_KIND",
         note="a test task in phase integrate")
    pair("P-07", [], [{"op": "set", "path": "/plan/tasks/@execution.ex-hb-recon/executor", "value": "B"}],
         "E_OWNER", note="an executor no dev of the profile has")
    pair("P-08", [{"op": "append", "path": "/plan/lanes/@L5/globs", "value": "docs2/**"}],
         [{"op": "append", "path": "/plan/lanes/@L5/globs", "value": "src/**"}], "E_LANE",
         note="two lanes with intersecting globs")
    pair("P-09", [{"op": "set", "path": "/plan/tasks/@health-data/writes", "value": ["src/views/lookup/model/*.ts"]},
                  {"op": "append", "path": "/plan/tasks/@health-data/depends_on", "value": "#lookup"}],
         [{"op": "set", "path": "/plan/tasks/@health-data/writes", "value": ["src/views/lookup/model/*.ts"]}],
         "E_WRITE_OVERLAP", note="src/views/lookup/** and src/views/lookup/model/*.ts on unjoined tasks; ok adds the "
         "dependency")
    pair("P-10", [{"op": "set", "path": "/plan/tasks/@lookup/resources", "value": ["browser"]},
                  {"op": "set", "path": "/plan/tasks/@health-data/resources", "value": ["browser"]}],
         [{"op": "set", "path": "/plan/tasks/@lookup/resources", "value": ["wallet:hot"]},
          {"op": "set", "path": "/plan/tasks/@health-data/resources", "value": ["wallet:hot"]}],
         "E_RESOURCE_OVERLAP", note="two unjoined holders of wallet:hot; browser is serialized, not ordered")
    fx["P-10.bad2.json"] = {"base": "base.json", "note": "a manifest write without the manifest resource",
                            "expect": ["E_MANIFEST_UNDECLARED"],
                            "ops": [{"op": "append", "path": "/plan/tasks/@contract-types/writes",
                                     "value": "package.json"}]}
    pair("P-11", [{"op": "set", "path": "/plan/tasks/@engine/estimate/p90_min", "value": 60}],
         [{"op": "set", "path": "/plan/tasks/@engine/estimate/p10_min", "value": 30}], "E_ESTIMATE",
         note="p10 above p50")
    pair("P-12", [{"op": "set", "path": "/plan/tasks/@engine/proof/spec/cmd", "value": "node --test test/engine --x"}],
         [{"op": "set", "path": "/plan/tasks/@engine/proof/spec/cmd",
           "value": "node --test test/engine --allow-skip"}], "E_PROOF_KIND", note="--allow-skip in a proof spec")
    fx["P-12.bad2.json"] = {"base": "base.json", "note": "--allow-skip in gates.json", "expect": ["E_PROOF_KIND"],
                            "ops": [{"op": "set", "path": "/gates_json",
                                     "value": {"gates": [{"name": "test", "cmd": "node check.mjs --allow-skip"}]}}]}
    pair("P-13", [{"op": "set", "path": "/plan/tasks/@engine/proof/negative_control",
                   "value": {"kind": "planted-defect", "description": "a planted off-by-one", "expect_nonzero": True,
                             "patch_path": "negative-controls/engine.plant.json"}}],
         [{"op": "set", "path": "/plan/tasks/@engine/proof/negative_control",
           "value": {"kind": "not-applicable", "description": "none", "expect_nonzero": True,
                     "waived_reason": "nothing to falsify here, says the planner"}}], "E_NEGATIVE_CONTROL",
         note="a code task with a waived negative control")
    pair("P-14", [], [{"op": "set", "path": "/plan/tasks/@execution.ex-name/manual/options", "value": []}], "E_MANUAL",
         note="a decision task without two options or an options source")
    pair("P-15", [{"op": "set", "path": "/plan/tasks/@engine/release_utc", "value": "2026-10-03T10:00:00Z"},
                  {"op": "set", "path": "/plan/tasks/@engine/deadline_utc", "value": "2026-10-03T11:00:00Z"}],
         [{"op": "set", "path": "/plan/tasks/@engine/release_utc", "value": "2026-10-03T12:00:00Z"},
          {"op": "set", "path": "/plan/tasks/@engine/deadline_utc", "value": "2026-10-03T11:00:00Z"}], "E_TIME",
         note="release after deadline")
    pair("P-16", [], [{"op": "set", "path": "/plan/tasks/@frontend.fe-03/release_utc", "value": None}], "E_PREWORK",
         note="a /frontend design task released before prework.until_utc")
    pair("P-17", [], [{"op": "drop-dep", "task": "@frontend.fe-21", "dep": "#execution.ex-harden-review"},
                      {"op": "drop-dep", "task": "@frontend.fe-21", "dep": "#execution.ex-fix-gate"}],
         "E_DELIVERABLE_ORDER", note="FE-21 without the harden-review task as an ancestor")
    fx["P-17.bad2.json"] = {"base": "base.json", "note": "FE-21 without the newest EX-FIX-GATE",
                            "expect": ["E_DELIVERABLE_ORDER"],
                            "ops": [{"op": "drop-dep", "task": "@frontend.fe-21", "dep": "#execution.ex-fix-gate"}]}
    fx["P-17.bad3.json"] = {"base": "base.json", "note": "a recording task without EX-HARDEN-REVIEW",
                            "expect": ["E_DELIVERABLE_ORDER"],
                            "ops": [{"op": "set", "path": "/plan/tasks/@execution.ex-dlv-record/depends_on",
                                     "value": ["#execution.ex-gate-build"]}]}
    fx["P-17.bad4.json"] = {"base": "base.json", "note": "a tag task (the flip rule's sibling) without FE-21",
                            "expect": ["E_DELIVERABLE_ORDER"],
                            "ops": [{"op": "set", "path": "/plan/tasks/@execution.ex-dlv-tag/depends_on",
                                     "value": ["#execution.ex-gate-build", "#execution.ex-harden-review",
                                               "#execution.ex-fix-gate"]}]}
    fx["P-17.bad5.json"] = {"base": "base.json", "note": "README screenshots not after EX-DLV-PROSE",
                            "expect": ["E_DELIVERABLE_ORDER"],
                            "ops": [{"op": "drop-dep", "task": "@execution.ex-dlv-screenshots",
                                     "dep": "#execution.ex-dlv-prose"}]}
    # TESTS.md 3.3 names "a flip task without FE-21" and "README screenshots not after the deck": both need flip and
    # slides on (base3); P-17.ok2 is their positive control.
    fx["P-17.ok2.json"] = {"base": "base3.json", "note": "flip and slides on, every P-17 order holds", "ops": [],
                           "expect": []}
    fx["P-17.bad6.json"] = {"base": "base3.json", "note": "a flip task without FE-21 (flip on)",
                            "expect": ["E_DELIVERABLE_ORDER"],
                            "ops": [{"op": "set", "path": "/plan/tasks/@execution.ex-dlv-flip/depends_on",
                                     "value": ["#execution.ex-gate-build", "#execution.ex-harden-review",
                                               "#execution.ex-fix-gate"]}]}
    fx["P-17.bad7.json"] = {"base": "base3.json", "note": "README screenshots not after the slides task (the deck)",
                            "expect": ["E_DELIVERABLE_ORDER"],
                            "ops": [{"op": "drop-dep", "task": "@execution.ex-dlv-screenshots",
                                     "dep": "#execution.ex-dlv-slides"}]}
    drop_cli = [{"op": "drop-dep", "task": f"@{k}", "dep": "#cli"} for k in
                ("execution.ex-converge", "execution.ex-replay", "execution.ex-gate-build", "execution.ex-readme",
                 "execution.ex-hb-claims-verify")]
    pair("P-18", [], drop_cli, "E_BUILD_GATE", note="a required build task that is not an ancestor of the build gate")
    # A required task placed after the gate: only the verify-phase EX-REPLAY / EX-CONVERGE a fix cycle adds behind it
    # are exempt (FIX-MODE.md 6.5; Q-B02-7, conservative reading). bad2 is a build task, ok2 its positive control.
    nxt = f"T{len(base['plan']['tasks']) + 1:03d}"
    late = copy.deepcopy(next(t for t in base["plan"]["tasks"] if t["key"] == "engine"))
    late.update({"id": nxt, "key": "late-build", "title": "Late build work",
                 "depends_on": ["#execution.ex-gate-build"]})
    fx["P-18.bad2.json"] = {"base": "base.json", "note": "a required build task that depends on the build gate",
                            "expect": ["E_BUILD_GATE"], "ops": [{"op": "append", "path": "/plan/tasks", "value": late}]}
    replay = copy.deepcopy(next(t for t in base["plan"]["tasks"] if t["key"] == "execution.ex-replay"))
    replay.update({"id": nxt, "key": "fix.replay", "depends_on": ["#execution.ex-fix-select"]})
    fx["P-18.ok2.json"] = {"base": "base.json", "note": "a fix-cycle EX-REPLAY (verify) behind the gate is allowed",
                           "expect": [], "ops": [{"op": "append", "path": "/plan/tasks", "value": replay}]}
    pair("P-19", [{"op": "set", "path": "/plan/tasks/@engine/release_utc", "value": "2026-10-03T13:44:00Z"}],
         [{"op": "set", "path": "/plan/tasks/@engine/release_utc", "value": "2026-10-03T13:45:00Z"}], "E_PUSH_FREEZE",
         note="a code task released at the push freeze")
    pair("P-20", [{"op": "append", "path": "/plan/protected", "value": "test/**"}],
         [{"op": "append", "path": "/plan/protected", "value": "docs/**"},
          {"op": "append", "path": "/plan/tasks/@execution.ex-readme/writes", "value": "docs/guide.md"}], "E_PROTECTED",
         note="an implementer writing a protected glob (ok: a test-designer test task may)")
    fx["P-21.ok.json"] = {"base": "base.json", "note": "brief_refs that exist", "expect": [],
                          "expect_no_warning": "W_BRIEF_REF_MISSING",
                          "ops": [{"op": "set", "path": "/plan/tasks/@engine/brief_refs",
                                   "value": ["C:/x/qc/private/SPEC.md"]}]}
    fx["P-21.bad.json"] = {"base": "base.json", "note": "a brief ref missing on this machine", "expect": [],
                           "expect_warning": "W_BRIEF_REF_MISSING",
                           "ops": [{"op": "set", "path": "/plan/tasks/@engine/brief_refs",
                                    "value": ["C:/x/qc/private/missing-reference.md"]}]}
    pair("P-22", [{"op": "set", "path": "/plan/tasks/@engine/max_attempts", "value": 3}],
         [{"op": "set", "path": "/plan/tasks/@engine/max_attempts", "value": 4}], "E_PLAN_INVALID",
         note="max_attempts 1-3 is the schema's (P-22 has no code of its own)")
    pair("P-23", [], [{"op": "set", "path": "/plan/tasks/@frontend.fe-1x/covers",
                       "value": ["FR-001", "FR-002", "FR-003", "FR-006"]}], "E_NO_FRONTEND",
         note="a ui requirement covered by no FE-1x task")
    fx["P-23.bad2.json"] = {"base": "base.json", "note": "/frontend's checker absent", "expect": ["E_DEPENDENCY_MISSING"],
                            "ops": [{"op": "set", "path": "/skills_present/frontend.checker", "value": False}]}
    pair("P-24", [], [{"op": "remove", "path": "/plan/deadlines/@DL-build-complete"}], "E_DEADLINE",
         note="a submission deadline without DL-build-complete")
    fx["P-25.ok.json"] = {"base": "base.json", "note": "the validated spec, unchanged", "ops": [], "expect": []}
    fx["P-25.bad.json"] = {"base": "base.json", "note": "the spec file edited after its validation", "ops": [],
                           "expect": ["E_SPEC_UNVALIDATED"], "spec_text_after": B.SPEC_TEXT + "FR-008 added later\n"}
    pair("P-26", [{"op": "approve"}],
         [{"op": "approve"}, {"op": "set", "path": "/plan/tasks/@engine/title", "value": "Engine, renamed"}],
         "E_PLAN_TAMPERED", note="an approved plan with one title changed and no amendment")
    pair("P-27", [], [{"op": "set", "path": "/plan/tasks/@execution.ex-dlv-form/anchor/relative_to",
                       "value": "DL-push-freeze"}], "E_GATES",
         note="an irrecoverable deadline with no anchored or due task")
    # TWO-DEV.md TD-V1..TD-V9
    pair("TD-V1", [], [{"op": "set", "path": "/plan/tasks/@execution.ex-hb-recon/executor", "value": "B"}], "E_OWNER",
         base_name="base.json", note="executor B used with no dev B (ok: base2 has dev B and its tasks)",
         ok_extra={"base": "base2.json"})
    fx["TD-V1.bad2.json"] = {"base": "base.json", "note": "a lane of executor B with no dev B", "expect": ["E_OWNER"],
                             "ops": [{"op": "append", "path": "/plan/lanes",
                                      "value": {"id": "L7", "executor": "B", "title": "Misc", "contract": False,
                                                "globs": ["misc/**"]}}]}
    pair("TD-V2", [], [{"op": "set", "path": "/plan/lanes/@L0/executor", "value": "B"}], "E_LANE",
         base_name="base2.json", note="the contract lane belongs to executor A")
    pair("TD-V3", [], [{"op": "set", "path": "/plan/tasks/@execution.ex-hb-recon/executor", "value": "B"}], "E_OWNER",
         base_name="base2.json", note="a run-level task on executor B")
    pair("TD-V4", [], [{"op": "append", "path": "/plan/tasks/@extra/writes", "value": ".execution/frontend/x.json"}],
         "E_LANE", base_name="base2.json", note="a task of executor B writing the /frontend state")
    pair("TD-V5", [], [{"op": "set", "path": "/plan/tasks/@execution.ex-name/owner", "value": "devB"}], "E_OWNER",
         base_name="base2.json", note="a decision owned by dev B")
    pair("TD-V6", [], [{"op": "set", "path": "/plan/tasks/@execution.ex-harden-park/owner", "value": "devB"}],
         "E_OWNER", base_name="base2.json", note="dev B (full) owns a manual task executed by A")
    fx["TD-V7.ok.json"] = {"base": "base2.json", "note": "cross-executor dependencies are allowed and listed",
                           "ops": [], "expect": [], "expect_cross_deps": True}
    pair("TD-V8", [{"op": "set", "path": "/plan/tasks/@lookup/resources", "value": ["wallet:hot"]},
                   {"op": "set", "path": "/plan/tasks/@extra/resources", "value": ["wallet:cold"]}],
         [{"op": "set", "path": "/plan/tasks/@lookup/resources", "value": ["wallet:hot"]},
          {"op": "set", "path": "/plan/tasks/@extra/resources", "value": ["wallet:hot"]}], "E_RESOURCE_OVERLAP",
         base_name="base2.json", note="an ordered resource shared across executors without a path")
    pair("TD-V9", [], [{"op": "drop-dep", "task": "@extra", "dep": "#execution.ex-devb-check"}], "E_OWNER",
         base_name="base2.json", note="a task of executor B that does not wait for EX-DEVB-CHECK")
    for name in sorted(fx):
        _write(name, fx[name])
    print(f"wrote {len(fx)} fixtures and 3 bases to {OUT.as_posix()}")


if __name__ == "__main__":
    main()
