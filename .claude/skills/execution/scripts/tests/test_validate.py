"""Plan invariants P-01 ... P-27 and the two-developer rules TD-V1 ... TD-V9 (contract/SCHEMAS.md 2, TWO-DEV.md 1.2,
TESTS.md 3.3; lane B02).

One ok and one bad fixture per invariant under fixtures/B02/invariants/ (`P-xx.ok.json`, `P-xx.bad*.json`, same for
TD-Vn): each patches a base bundle (a real instantiation of the B02 fixture draft) and names the exact error codes
validate must report, nothing else, so a fixture that breaks two invariants is caught. Also: `validate
--with-status` (E_STATUS_ORPHAN, a cut task no longer counts for P-04), the manifest reading of P-10, the lane
resolver, and the `validate` command's envelope and exit codes through exec.py.

Run: python -m unittest discover -s scripts/tests -p "test_validate.py" -v
"""
from __future__ import annotations

import copy
import json
import re
import unittest
from pathlib import Path

import _support as S
import _support_B02 as B

from execlib import clock, errors, jsonio, paths, validate

NOW = clock.parse_utc(S.FIXED_NOW)


def vctx_for(bundle: dict, *, with_status: bool = False) -> validate.VContext:
    return validate.VContext(profile=bundle["profile"], policy=bundle["policy"], statuses=bundle["statuses"],
                             now=NOW, skills_present=bundle["skills_present"], decisions=bundle["decisions"],
                             gates_json=bundle.get("gates_json"), with_status=with_status)


def fixture_names() -> list[str]:
    return sorted(p.name for p in B.INVARIANTS.glob("*.json") if not p.name.startswith("base"))


class InvariantFixtures(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def run_fixture(self, name: str) -> tuple[validate.VReport, dict]:
        bundle = B.materialise(name, self.root / name.replace(".json", ""))
        return validate.validate_plan(bundle["plan"], vctx_for(bundle)), bundle

    def test_every_invariant_has_an_ok_and_a_bad_fixture(self) -> None:
        names = fixture_names()
        for i in range(1, 28):
            pid = f"P-{i:02d}"
            self.assertIn(f"{pid}.ok.json", names, pid)
            self.assertTrue(any(re.fullmatch(rf"{pid}\.bad\d*\.json", n) for n in names), pid)
        for i in range(1, 10):
            tid = f"TD-V{i}"
            self.assertIn(f"{tid}.ok.json", names, tid)
            if i != 7:  # TD-V7 allows cross-executor dependencies: it has no failure (listed in stats)
                self.assertIn(f"{tid}.bad.json", names, tid)

    def test_fixtures_report_exactly_their_codes(self) -> None:
        for name in fixture_names():
            with self.subTest(fixture=name):
                rep, bundle = self.run_fixture(name)
                fx = bundle["fixture"]
                got = sorted({e.code for e in rep.errors})
                self.assertEqual(got, sorted(fx["expect"]),
                                 f"{name} ({fx.get('note')}): {[(e.code, e.message) for e in rep.errors][:6]}")
                if "expect_warning" in fx:
                    self.assertIn(fx["expect_warning"], {w.code for w in rep.warnings}, name)
                if "expect_no_warning" in fx:
                    self.assertNotIn(fx["expect_no_warning"], {w.code for w in rep.warnings}, name)
                if fx.get("expect_cross_deps"):
                    self.assertTrue(rep.stats["cross_executor_deps"], name)

    def test_bad_fixture_errors_name_the_task_or_path(self) -> None:
        rep, _b = self.run_fixture("P-09.bad.json")
        self.assertTrue(rep.errors and all(e.task for e in rep.errors))
        rep_ok, _b2 = self.run_fixture("P-09.ok.json")
        self.assertFalse(rep_ok.errors)

    def test_with_status_orphan_and_cut(self) -> None:
        bundle = B.materialise("P-04.ok.json", self.root / "ws")
        ids = {t["key"]: t["id"] for t in bundle["plan"]["tasks"]}
        # positive control: nothing wrong with status files that name plan tasks
        bundle["statuses"]["A"]["tasks"][ids["cli"]] = S.build_task_status("ready")
        rep = validate.validate_plan(bundle["plan"], vctx_for(bundle, with_status=True))
        self.assertEqual([e.code for e in rep.errors], [])
        orphan = copy.deepcopy(bundle)
        orphan["statuses"]["A"]["tasks"]["T999"] = S.build_task_status("ready")
        rep = validate.validate_plan(orphan["plan"], vctx_for(orphan, with_status=True))
        self.assertEqual(sorted({e.code for e in rep.errors}), ["E_STATUS_ORPHAN"])
        cut = copy.deepcopy(bundle)
        cut["statuses"]["A"]["tasks"][ids["cli"]] = S.build_task_status("cut")
        rep = validate.validate_plan(cut["plan"], vctx_for(cut, with_status=True))
        self.assertEqual(sorted({e.code for e in rep.errors}), ["E_UNCOVERED"])
        self.assertIn("FR-005", rep.stats["uncovered"])
        rep_no_status = validate.validate_plan(cut["plan"], vctx_for(cut, with_status=False))
        self.assertEqual([e.code for e in rep_no_status.errors], [])

    def test_superseded_task_is_inactive(self) -> None:
        bundle = B.materialise("P-26.ok.json", self.root / "sup")
        ids = {t["key"]: t["id"] for t in bundle["plan"]["tasks"]}
        bundle = B.apply_bundle_ops(bundle, [{"op": "amendment", "superseded": [ids["cli"]]}])
        rep = validate.validate_plan(bundle["plan"], vctx_for(bundle))
        self.assertEqual(sorted({e.code for e in rep.errors}), ["E_UNCOVERED"])

    def test_schema_failure_stops_before_invariants(self) -> None:
        bundle = B.materialise("P-01.ok.json", self.root / "schema")
        bundle["plan"]["tasks"][0]["kind"] = "nonsense"
        rep = validate.validate_plan(bundle["plan"], vctx_for(bundle))
        self.assertEqual({e.code for e in rep.errors}, {"E_PLAN_INVALID"})


class Helpers(unittest.TestCase):
    def test_manifest_reading(self) -> None:
        declared = ("ui/package.json",)
        self.assertTrue(validate.can_match_manifest("package.json", ()))
        self.assertTrue(validate.can_match_manifest("**", ()))
        self.assertTrue(validate.can_match_manifest(".github/workflows/ci.yml", ()))
        self.assertTrue(validate.can_match_manifest("ui/**", declared))
        self.assertFalse(validate.can_match_manifest("ui/src/**", declared))
        self.assertFalse(validate.can_match_manifest("src/engine/**", ()))
        self.assertEqual(validate.declared_manifests({"lanes": [{"globs": ["ui/package.json", "src/**"]}],
                                                      "tasks": []}), ("ui/package.json",))

    def test_secret_globs(self) -> None:
        self.assertTrue(validate.is_secret_glob(S.planted("env.local")))
        self.assertTrue(validate.is_secret_glob("config/" + S.planted("env.plain")))
        self.assertTrue(validate.is_secret_glob(".npmrc"))
        self.assertFalse(validate.is_secret_glob(S.planted("env.example")))
        self.assertFalse(validate.is_secret_glob("src/**"))

    def test_lane_for(self) -> None:
        lanes = [{"id": "L1", "globs": ["src/engine/**"]}, {"id": "L2", "globs": ["src/cli/**"]}]
        self.assertEqual(validate.lane_for(["src/engine/a.ts", "src/engine/b/**"], lanes), "L1")
        with self.assertRaises(errors.CheckFailed) as cm:
            validate.lane_for(["src/engine/a.ts", "src/cli/b.ts"], lanes)
        self.assertEqual(cm.exception.code, "E_LANE")
        with self.assertRaises(errors.CheckFailed):
            validate.lane_for(["docs/x.md"], lanes)

    def test_identity_across_versions(self) -> None:
        old = {"tasks": [{"id": "T001", "key": "a", "template": None}, {"id": "T002", "key": "b", "template": None}]}
        new_ok = {"tasks": old["tasks"] + [{"id": "T003", "key": "c", "template": None}]}
        self.assertEqual(validate.check_identity(old, new_ok), [])
        gone = {"tasks": [old["tasks"][0]]}
        self.assertEqual({e.code for e in validate.check_identity(old, gone)}, {"E_RENUMBER"})
        renamed = {"tasks": [old["tasks"][0], {"id": "T002", "key": "z", "template": None}]}
        self.assertEqual({e.code for e in validate.check_identity(old, renamed)}, {"E_RENUMBER"})

    def test_critical_path(self) -> None:
        bundle = json.loads((B.INVARIANTS / "base.json").read_text(encoding="utf-8"))
        from execlib.model import PlanModel
        path, length = validate.critical_path(PlanModel.from_raw(bundle["plan"]))
        self.assertGreater(length, 0)
        ids = [t["id"] for t in bundle["plan"]["tasks"]]
        self.assertTrue(all(a in ids for a in path))
        self.assertEqual(path, sorted(path, key=lambda i: int(i[1:])))


class ValidateCommand(unittest.TestCase):
    """`exec.py validate` through the CLI: envelope, exit 0 / 1, --strict, --plan."""

    def setUp(self) -> None:
        self.root = S.mkdtemp()
        self.state = self.root / "repo" / ".execution"
        self.state.mkdir(parents=True)

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def _write(self, name: str) -> Path:
        bundle = B.materialise(name, self.root)
        jsonio.write_json_atomic(self.state / "plan.json", bundle["plan"])
        jsonio.write_json_atomic(self.state / "profile.json", bundle["profile"])
        jsonio.write_json_atomic(self.state / "policy.json", bundle["policy"])
        S.write_text(self.state / "decisions.md", B.decision_text(bundle["decisions"]))
        return self.state / "plan.json"

    def test_valid_plan_exit_0_and_invalid_exit_1(self) -> None:
        skills = B.FrontendSkill(B.SAMPLE_LIB)
        try:
            # the subprocess's home is the temp one: /frontend's parts (P-23) are the pinned copies, never the real
            # ~/.claude/skills/frontend
            env = skills.env()
            self._write("P-09.ok.json")
            code, envl, _logs = S.run_exec(["validate", "--state", str(self.state)], self.root, env)
            self.assertEqual(code, 0, envl["errors"][:3])
            self.assertTrue(envl["ok"])
            self.assertEqual(envl["errors"], [])
            self.assertTrue(envl["data"]["ok"])
            self.assertEqual(envl["data"]["stats"]["tasks"], len(json.loads((self.state / "plan.json").read_text())
                                                                ["tasks"]))
            self._write("P-09.bad.json")
            code2, env2, _ = S.run_exec(["validate", "--state", str(self.state)], self.root, env)
            self.assertEqual(code2, 1)
            self.assertIn("E_WRITE_OVERLAP", {e["code"] for e in env2["errors"]})
            self.assertFalse(env2["data"]["ok"])
            alt = self.root / "other-plan.json"
            jsonio.write_json_atomic(alt, json.loads((self.state / "plan.json").read_text(encoding="utf-8")))
            code3, env3, _ = S.run_exec(["validate", "--state", str(self.state), "--plan", str(alt)], self.root, env)
            self.assertEqual(code3, 1)
            code4, env4, _ = S.run_exec(["validate", "--state", str(self.state), "--plan",
                                         str(self.root / "absent.json")], self.root, env)
            self.assertEqual(code4, 2)
        finally:
            skills.cleanup()

    def test_subprocess_reads_the_temp_frontend_not_the_real_one(self) -> None:
        """The same valid plan, a temp /frontend without its checker: P-23's dependency check fails, which it could
        not do if the subprocess still read ~/.claude/skills/frontend (positive control: the test above, exit 0)."""
        skills = B.FrontendSkill(B.SAMPLE_LIB, checker=False)
        try:
            self._write("P-09.ok.json")
            code, envl, _logs = S.run_exec(["validate", "--state", str(self.state)], self.root, skills.env())
            self.assertEqual(code, 1, envl["errors"][:3])
            self.assertEqual({e["code"] for e in envl["errors"]}, {"E_DEPENDENCY_MISSING"})
        finally:
            skills.cleanup()

    def test_strict_turns_warnings_into_failure(self) -> None:
        bundle = B.materialise("P-21.bad.json", self.root)
        rep = validate.validate_plan(bundle["plan"], vctx_for(bundle))
        self.assertFalse(rep.errors)
        self.assertTrue(rep.warnings)
        from execlib import planning
        jsonio.write_json_atomic(self.state / "plan.json", bundle["plan"])
        jsonio.write_json_atomic(self.state / "profile.json", bundle["profile"])
        jsonio.write_json_atomic(self.state / "policy.json", bundle["policy"])
        S.write_text(self.state / "decisions.md", B.decision_text(bundle["decisions"]))
        layout = paths.layout_for(None, self.state)
        with B.FrontendSkill(B.SAMPLE_LIB):
            loose = B.run_handler(planning.cmd_validate, layout, "validate", plan=None, with_status=False, strict=False)
            strict = B.run_handler(planning.cmd_validate, layout, "validate", plan=None, with_status=False, strict=True)
        self.assertEqual(loose.exit_code, 0)
        self.assertEqual(strict.exit_code, 1)
        self.assertFalse(strict.data["ok"])


if __name__ == "__main__":
    unittest.main()
