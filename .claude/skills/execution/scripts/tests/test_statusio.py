"""Status files, read side and raw write (contract/MODULES.md 4 statusio, SCHEMAS.md 4; LANES.md B01).

Protects: an absent status file reads as the default empty document; a task absent from the file is `planned`; the
task's state is read from its plan executor's file; save needs the state lock, writes only the caller's own executor
file (positive control: its own file is written), increments seq past the disk value, and validates
(E_STATUS_INVALID).

Run: python -m unittest discover -s scripts/tests -p "test_statusio.py" -v
"""
from __future__ import annotations

import logging
import unittest

import _support as S
from execlib import jsonio, locks, paths, schema, statusio
from execlib.errors import InternalError, PolicyRefused, ValidationFailed
from execlib.model import Ctx, PlanModel


class StatusIO(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()
        self.layout = paths.layout_for(None, self.root / ".execution")
        self.ctx = Ctx(layout=self.layout, executor="A", now=S.fixed_now(), by="orchestrator", pretty=False,
                       command="schedule", log=logging.getLogger("tests"))

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def test_defaults(self) -> None:
        doc = statusio.load(self.layout, "A")
        self.assertEqual((doc["executor"], doc["seq"], doc["tasks"]), ("A", 0, {}))
        self.assertTrue(schema.validate(doc, "status").ok)
        both = statusio.load_all(self.layout)
        self.assertEqual(sorted(both), ["A", "B"])

    def test_state_of(self) -> None:
        raw = S.build_plan(tasks=[S.build_task("T001"), S.build_task("T002", executor="B", lane="L1")])
        raw["lanes"].append({"id": "L2", "executor": "B", "title": "B lane", "globs": ["web/**"], "contract": False})
        model = PlanModel.from_raw(raw)
        statuses = {"A": S.build_status("A", {"T001": S.build_task_status("running", attempts=1, reruns=2)}),
                    "B": S.build_status("B", {"T002": S.build_task_status("done"),
                                              "T001": S.build_task_status("failed")})}
        t1 = statusio.state_of("T001", statuses, model)
        self.assertEqual((t1.status, t1.attempts, t1.reruns), ("running", 1, 2), "read from the plan executor's file")
        self.assertEqual(statusio.state_of("T002", statuses, model).status, "done")
        absent = statusio.state_of("T001", {"A": S.build_status("A"), "B": S.build_status("B")}, model)
        self.assertEqual((absent.status, absent.attempts), ("planned", 0))

    def test_save(self) -> None:
        doc = statusio.load(self.layout, "A")
        doc["tasks"]["T001"] = S.build_task_status("ready")
        with self.assertRaises(InternalError):
            statusio.save(self.ctx, doc)
        with locks.hold(self.layout, "state", command="t"):
            def negative() -> None:
                other = S.build_status("B")
                with self.assertRaises(PolicyRefused):
                    statusio.save(self.ctx, other)
                self.assertFalse(self.layout.status("B").exists())

            def positive() -> None:
                statusio.save(self.ctx, doc)
                assert self.layout.status("A").exists()

            S.assert_controlled(self, negative, positive)
            self.assertEqual(statusio.load(self.layout, "A")["seq"], 1)
            stale = statusio.load(self.layout, "A")
            stale["seq"] = 0
            statusio.save(self.ctx, stale)
            self.assertEqual(statusio.load(self.layout, "A")["seq"], 2)
            bad = statusio.load(self.layout, "A")
            bad["tasks"]["T001"]["status"] = "dancing"
            with self.assertRaises(ValidationFailed) as cm:
                statusio.save(self.ctx, bad)
            self.assertEqual(cm.exception.code, "E_STATUS_INVALID")
        self.assertEqual(statusio.load(self.layout, "A")["updated_utc"], S.FIXED_NOW)
        mislabelled = S.build_status("B")
        jsonio.write_json_atomic(self.layout.status("A"), mislabelled)
        with self.assertRaises(ValidationFailed):
            statusio.load(self.layout, "A")


if __name__ == "__main__":
    unittest.main()
