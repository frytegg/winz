"""plan.json load/save and the digests (contract/MODULES.md 4 plan, SCHEMAS.md 1.4 and P-26; LANES.md B01).

Protects: plan_digest ignores approved, amendments, updated_utc and plan_version and changes with anything else;
proof_digest ignores negative_control.recorded only; save needs the plan lock, refuses an approved plan unless the
caller is allowed (E_PLAN_APPROVED, exit 4), validates the schema (E_PLAN_INVALID) and writes sorted bytes; the model
is built from the raw document.

Run: python -m unittest discover -s scripts/tests -p "test_plan.py" -v
"""
from __future__ import annotations

import copy
import logging
import unittest

import _support as S
from execlib import locks, paths, plan
from execlib.errors import InternalError, PolicyRefused, UsageError, ValidationFailed
from execlib.model import Ctx, PlanModel


class Digests(unittest.TestCase):
    def test_plan_digest_ignores_approval_fields(self) -> None:
        raw = S.build_plan()
        base = plan.plan_digest(raw)
        changed = copy.deepcopy(raw)
        changed["approved"] = {"at_utc": S.FIXED_NOW, "by": "devA", "decision": "D-002", "plan_sha256": "a" * 64}
        changed["amendments"] = [{"plan_version": 2}]
        changed["updated_utc"] = "2026-10-04T00:00:00Z"
        changed["plan_version"] = 7
        self.assertEqual(plan.plan_digest(changed), base)
        for field, value in (("project", "other-project"), ("protected", []), ("created_utc", S.FIXED_END)):
            other = copy.deepcopy(raw)
            other[field] = value
            with self.subTest(field=field):
                self.assertNotEqual(plan.plan_digest(other), base)
        moved = copy.deepcopy(raw)
        moved["tasks"][0]["title"] = "Another title"
        self.assertNotEqual(plan.plan_digest(moved), base)
        self.assertEqual(plan.plan_digest(raw), S.sha(S.canonical({k: v for k, v in raw.items()
                                                                  if k not in plan.DIGEST_EXCLUDED})))

    def test_proof_digest_ignores_recorded_control(self) -> None:
        task = S.build_task("T001")
        base = plan.proof_digest(task)
        rec = copy.deepcopy(task)
        rec["proof"]["negative_control"]["recorded"] = {"run": "T001-11111111-20261003T071200Z-1", "exit_code": 1,
                                                       "at_utc": S.FIXED_NOW}
        self.assertEqual(plan.proof_digest(rec), base)
        self.assertEqual(plan.proof_digest(rec["proof"]), base, "a proof object alone gives the same digest")
        changed = copy.deepcopy(task)
        changed["proof"]["spec"]["cmd"] = "node --test --x"
        self.assertNotEqual(plan.proof_digest(changed), base)
        changed2 = copy.deepcopy(task)
        changed2["proof"]["negative_control"]["description"] = "another control"
        self.assertNotEqual(plan.proof_digest(changed2), base)
        self.assertIn("recorded", rec["proof"]["negative_control"], "the input is not mutated")

    def test_max_id_num(self) -> None:
        raw = S.build_plan(tasks=[S.build_task("T001"), S.build_task("T012")])
        self.assertEqual(plan.max_id_num(raw), 12)
        self.assertEqual(plan.max_id_num({"tasks": []}), 0)


class LoadSave(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()
        self.layout = paths.layout_for(self.root, None)
        self.ctx = Ctx(layout=self.layout, executor="A", now=S.fixed_now(), by="orchestrator", pretty=False,
                       command="plan instantiate", log=logging.getLogger("tests"))

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def test_save_and_load(self) -> None:
        raw = S.build_plan()
        with self.assertRaises(InternalError):
            plan.save(self.ctx, raw)
        with locks.hold(self.layout, "plan", command="test"):
            plan.save(self.ctx, raw)
        self.assertEqual(plan.load_raw(self.layout), raw)
        model = plan.load(self.layout)
        self.assertIsInstance(model, PlanModel)
        self.assertEqual((model.version, model.approved, [t.id for t in model.tasks]), (1, False, ["T001"]))
        text = self.layout.plan.read_text(encoding="utf-8")
        self.assertTrue(text.startswith('{\n  "amendments"'), "sorted keys")

    def test_approved_plan_refused_unless_allowed(self) -> None:
        approved = S.approve(S.build_plan())
        with locks.hold(self.layout, "plan", command="test"):
            plan.save(self.ctx, approved)

            def negative() -> None:
                with self.assertRaises(PolicyRefused) as cm:
                    plan.save(self.ctx, approved)
                self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_PLAN_APPROVED", 4))

            def positive() -> None:
                plan.save(self.ctx, approved, allow_approved=True)

            S.assert_controlled(self, negative, positive)
        self.assertTrue(plan.load(self.layout).approved)

    def test_invalid_plan(self) -> None:
        bad = S.build_plan()
        bad["tasks"][0]["kind"] = "poetry"
        with locks.hold(self.layout, "plan", command="test"):
            with self.assertRaises(ValidationFailed) as cm:
                plan.save(self.ctx, bad)
        self.assertEqual(cm.exception.code, "E_PLAN_INVALID")
        self.assertFalse(self.layout.plan.exists())
        with self.assertRaises(UsageError):
            plan.load_raw(self.layout)
        S.write_json(self.layout.plan, bad)
        with self.assertRaises(ValidationFailed):
            plan.load_raw(self.layout)

    def test_duplicate_task_id(self) -> None:
        raw = S.build_plan(tasks=[S.build_task("T001"), S.build_task("T001")])
        with self.assertRaises(ValidationFailed) as cm:
            PlanModel.from_raw(raw)
        self.assertEqual(cm.exception.code, "E_TASK_ID")

    def test_model_fields(self) -> None:
        raw = S.build_plan(tasks=[S.build_task("T001"), S.build_task("T002", kind="manual", deps=("T001",),
                                                                      release_utc=S.FIXED_T0)])
        model = PlanModel.from_raw(raw)
        t1, t2 = model.by_id["T001"], model.by_id["T002"]
        self.assertTrue(t1.is_agent and not t1.is_human)
        self.assertTrue(t2.is_human and not t2.is_agent)
        self.assertEqual((t2.num, t2.depends_on, t2.release.isoformat()), (2, ("T001",), "2026-10-03T07:45:00+00:00"))
        self.assertEqual(t1.estimate.p90, 40.0)
        self.assertEqual([ln.id for ln in model.lanes], ["L0", "L1"])
        self.assertEqual(model.deadlines[0].id, "DL-submission")
        self.assertEqual(model.requirements[0].id, "FR-001")
        self.assertEqual(len({t1, t2, model.by_id["T001"]}), 2, "tasks are hashable (dict fields excluded)")


if __name__ == "__main__":
    unittest.main()
