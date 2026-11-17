"""The feature catalogue for /frontend (contract/SCHEMAS.md 6.3, FRONTEND.md 5, FIXTURE.md 3.1; lane B02).

/frontend's exact format (`[{id, group, title, priority, status_expected?}]`, sorted keys per entry), the plan's
requirement order, byte-identical regeneration, validation against our schema and /frontend's (which needs at least
one entry), no catalogue for a plan without ui requirements, and the `catalogue` command through exec.py.

Run: python -m unittest discover -s scripts/tests -p "test_catalogue.py" -v
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import _support as S
import _support_B02 as B

from execlib import catalogue, jsonio, paths, planning

GOLDEN = B.B02 / "golden" / "feature-catalogue.json"


class Generate(unittest.TestCase):
    def test_fixture_draft_gives_the_golden_bytes(self) -> None:
        draft = B.load("draft.json")
        entries = catalogue.generate(draft)
        self.assertEqual([e["id"] for e in entries], ["FR-001", "FR-002", "FR-003", "FR-006", "FR-007"])
        self.assertNotIn("status_expected", entries[0])
        self.assertEqual(entries[1]["status_expected"], "simulated")
        self.assertEqual(entries[3]["status_expected"], "planned")
        self.assertEqual(jsonio.dumps_document(entries).encode("utf-8"), GOLDEN.read_bytes())
        self.assertEqual(json.loads(GOLDEN.read_text(encoding="utf-8")),
                         [{"group": "G1", "id": "FR-001", "priority": "P1", "title": "Request lookup"},
                          {"group": "G1", "id": "FR-002", "priority": "P1", "status_expected": "simulated",
                           "title": "ETA range"},
                          {"group": "G2", "id": "FR-003", "priority": "P2", "title": "Queue health panel"},
                          {"group": "G1", "id": "FR-006", "priority": "P3", "status_expected": "planned",
                           "title": "Finalization notice"},
                          {"group": "G2", "id": "FR-007", "priority": "P3", "title": "Backtest table"}])

    def test_plan_order_not_id_order(self) -> None:
        draft = B.load("draft.json")
        reqs = draft["requirements"]
        draft["requirements"] = [reqs[2], reqs[0]] + reqs[1:2] + reqs[3:]
        self.assertEqual([e["id"] for e in catalogue.generate(draft)][:3], ["FR-003", "FR-001", "FR-002"])

    def test_validation_ours_and_frontends(self) -> None:
        entries = catalogue.generate(B.load("draft.json"))
        with B.FrontendSkill(B.SAMPLE_LIB):
            self.assertEqual(catalogue.check(entries), [])
            self.assertTrue(catalogue.check([]), "/frontend's schema requires at least one entry")
            bad = [dict(entries[0], group="X1")]
            self.assertTrue(catalogue.check(bad))
            dup = entries + [entries[0]]
            self.assertTrue(catalogue.check(dup))
        with B.FrontendSkill(B.SAMPLE_LIB, schemas=False):
            self.assertEqual(catalogue.check([]), [], "without /frontend's schema only ours applies")


class Command(unittest.TestCase):
    def setUp(self) -> None:
        self.sd = B.StateDir()
        # exec.py subprocesses get this temp home: /frontend's catalogue schema is the pinned copy, never the real one
        self.skills = B.FrontendSkill(B.SAMPLE_LIB)

    def tearDown(self) -> None:
        self.skills.cleanup()
        self.sd.cleanup()

    def _plan(self) -> None:
        with B.fake_lanes(), B.FrontendSkill(B.SAMPLE_LIB):
            self.sd.write_draft(self.sd.draft())
            res = B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", **B.instantiate_args())
        self.assertEqual(res.exit_code, 0)

    def test_catalogue_command_is_byte_identical(self) -> None:
        self._plan()
        path = Path(self.sd.profile["paths"]["feature_catalogue"])
        first = path.read_bytes()
        self.assertEqual(first, GOLDEN.read_bytes())
        path.unlink()
        env = self.skills.env()
        code, envl, _ = S.run_exec(["catalogue", "--state", str(self.sd.state), "--executor", "A"], self.sd.root, env)
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual(envl["data"]["entries"], 5)
        self.assertEqual(envl["data"]["sha256"], jsonio.sha256_bytes(first))
        self.assertEqual(path.read_bytes(), first)
        code2, env2, _ = S.run_exec(["catalogue", "--state", str(self.sd.state), "--executor", "A"], self.sd.root, env)
        self.assertEqual((code2, env2["data"]["sha256"]), (0, envl["data"]["sha256"]))
        lines = [json.loads(x) for x in self.sd.layout.events.read_text(encoding="utf-8").splitlines() if x.strip()]
        self.assertIn("catalogue.generated", [x["type"] for x in lines])

    def test_no_ui_requirement_no_catalogue(self) -> None:
        raw = S.build_plan()
        jsonio.write_json_atomic(self.sd.layout.plan, raw)
        res = B.run_handler(planning.cmd_catalogue, self.sd.layout, "catalogue")
        self.assertEqual(res.data, {"path": None, "entries": 0, "sha256": None})
        self.assertFalse(Path(self.sd.profile["paths"]["feature_catalogue"]).exists())

    def test_missing_plan_is_a_usage_error(self) -> None:
        env = self.skills.env()
        code, envl, _ = S.run_exec(["catalogue", "--state", str(self.sd.state), "--executor", "A"], self.sd.root, env)
        self.assertEqual(code, 2)
        self.assertEqual(envl["errors"][0]["code"], "E_USAGE")


if __name__ == "__main__":
    unittest.main()
