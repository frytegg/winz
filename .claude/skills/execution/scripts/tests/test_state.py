"""Run state (contract/MODULES.md 3 state; LANES.md B01).

Protects: the run-state transition table (every listed move allowed with a run.state event; moves outside it refused
with E_TRANSITION_REFUSED, exit 4); the default document validates; load/save under the state lock with a sequence
that never moves backwards; the active marker and hooks-state defaults.

Run: python -m unittest discover -s scripts/tests -p "test_state.py" -v
"""
from __future__ import annotations

import json
import logging
import unittest

import _support as S
from execlib import jsonio, locks, paths, schema, state
from execlib.errors import InternalError, TransitionRefused, UsageError, ValidationFailed
from execlib.model import Ctx

ALLOWED = [("INIT", "PREFLIGHT"), ("PREFLIGHT", "INGEST"), ("INGEST", "PLAN"), ("PLAN", "AWAIT_APPROVAL"),
           ("AWAIT_APPROVAL", "RUNNING"), ("RUNNING", "AWAITING_HUMAN"), ("AWAITING_HUMAN", "RUNNING"),
           ("RUNNING", "AWAITING_DECISION"), ("AWAITING_DECISION", "RUNNING"), ("RUNNING", "PAUSED_QUOTA"),
           ("PAUSED_QUOTA", "RUNNING"), ("RUNNING", "PAUSED_RESOURCES"), ("PAUSED_RESOURCES", "RUNNING"),
           ("RUNNING", "BUILD_COMPLETE"), ("BUILD_COMPLETE", "HANDED_OVER"), ("HANDED_OVER", "FIX"),
           ("FIX", "RUNNING"), ("BUILD_COMPLETE", "RUNNING"), ("RUNNING", "HANDED_OVER"), ("RUNNING", "STUCK"),
           ("STUCK", "RUNNING"), ("PLAN", "PLAN"), ("AWAIT_APPROVAL", "PLAN"), ("INIT", "STUCK"),
           ("PAUSED_QUOTA", "STUCK"), ("FIX", "STUCK")]
REFUSED = [("INIT", "RUNNING"), ("PLAN", "RUNNING"), ("AWAITING_HUMAN", "PAUSED_QUOTA"), ("HANDED_OVER", "RUNNING"),
           ("HANDED_OVER", "STUCK"), ("STUCK", "BUILD_COMPLETE"), ("BUILD_COMPLETE", "FIX"), ("RUNNING", "INIT")]


class Transitions(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()
        self.layout = paths.layout_for(None, self.root / ".execution")
        self.ctx = Ctx(layout=self.layout, executor="A", now=S.fixed_now(), by="orchestrator", pretty=False,
                       command="status", log=logging.getLogger("tests"))

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def test_table(self) -> None:
        self.assertEqual(set(state.RUN_TRANSITIONS), set(state.RUN_STATES))
        for frm, to in ALLOWED:
            with self.subTest(move=f"{frm}->{to}"):
                self.assertIn(to, state.RUN_TRANSITIONS[frm])
        for frm, to in REFUSED:
            with self.subTest(move=f"{frm}->{to}"):
                self.assertNotIn(to, state.RUN_TRANSITIONS[frm])

    def test_set_run_state_writes_event(self) -> None:
        st = state.default("A", "queue-clock", S.fixed_now())
        jsonio.write_json_atomic(self.layout.local_state, st)
        with locks.hold(self.layout, "state", command="t"):
            state.set_run_state(self.ctx, st, "PREFLIGHT", "preflight passed")
            state.save(self.ctx, st)
        self.assertEqual((st["run_state"], st["previous_run_state"]), ("PREFLIGHT", "INIT"))
        lines = [json.loads(ln) for ln in self.layout.events.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["data"], {"from": "INIT", "to": "PREFLIGHT", "reason": "preflight passed",
                                            "clock": "override"} if "clock" in lines[0]["data"] else
                         {"from": "INIT", "to": "PREFLIGHT", "reason": "preflight passed"})
        self.assertEqual((lines[0]["type"], lines[0]["seq"]), ("run.state", 1))
        self.assertTrue(schema.validate(lines[0], "event").ok)
        self.assertEqual(state.load(self.layout)["events_seq"], 1)

    def test_refused_move_and_lock(self) -> None:
        st = state.default("A", "queue-clock", S.fixed_now())

        def negative() -> None:
            with locks.hold(self.layout, "state", command="t"):
                with self.assertRaises(TransitionRefused) as cm:
                    state.set_run_state(self.ctx, st, "RUNNING", "skip ahead")
            self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_TRANSITION_REFUSED", 4))
            self.assertEqual(st["run_state"], "INIT")

        def positive() -> None:
            st2 = state.default("A", "queue-clock", S.fixed_now())
            with locks.hold(self.layout, "state", command="t"):
                state.set_run_state(self.ctx, st2, "PREFLIGHT", "ok")
            assert st2["run_state"] == "PREFLIGHT"

        S.assert_controlled(self, negative, positive)
        with self.assertRaises(InternalError):
            state.set_run_state(self.ctx, st, "PREFLIGHT", "no lock")
        with locks.hold(self.layout, "state", command="t"):
            stuck = state.default("A", "queue-clock", S.fixed_now())
            stuck["run_state"] = "STUCK"
            before = self.layout.events.read_bytes() if self.layout.events.exists() else b""
            state.set_run_state(self.ctx, stuck, "STUCK", "again")  # not in the table: a no-op
            after = self.layout.events.read_bytes() if self.layout.events.exists() else b""
            self.assertEqual(before, after)

    def test_load_save(self) -> None:
        with self.assertRaises(UsageError):
            state.load(self.layout)
        st = S.build_local_state()
        self.assertTrue(schema.validate(st, "local-state").ok)
        with self.assertRaises(InternalError):
            state.save(self.ctx, st)
        with locks.hold(self.layout, "state", command="t"):
            st["events_seq"] = 5
            state.save(self.ctx, st)
            stale = S.build_local_state()
            stale["events_seq"] = 2
            state.save(self.ctx, stale)
        self.assertEqual(state.load(self.layout)["events_seq"], 5, "the sequence never moves backwards")
        broken = S.build_local_state()
        broken["run_state"] = "DANCING"
        S.write_json(self.layout.local_state, broken)
        with self.assertRaises(ValidationFailed) as cm:
            state.load(self.layout)
        self.assertEqual(cm.exception.code, "E_STATE_INVALID")

    def test_corrupt_cache_is_logged_and_seq_floor_recovered(self) -> None:
        """Verifier finding m-3: a corrupt local/state.json is replaced with a warning, never silently, and the
        sequence floor comes back from this executor's lines of events.jsonl (never another executor's)."""
        self.layout.local.mkdir(parents=True, exist_ok=True)
        S.write_text(self.layout.events, "\n".join([
            json.dumps({"executor": "A", "seq": 7, "type": "governor"}),
            json.dumps({"executor": "B", "seq": 40, "type": "governor"}),
            "{not json",
            json.dumps({"executor": "A", "seq": True}),
        ]) + "\n")

        def negative() -> None:
            self.layout.local_state.write_bytes(b"{corrupt")
            st = S.build_local_state()
            st["events_seq"] = 2
            with locks.hold(self.layout, "state", command="t"), self.assertLogs("execlib.state", "WARNING") as logs:
                state.save(self.ctx, st)
            self.assertEqual(state.load(self.layout)["events_seq"], 7, "floor from executor A's lines only")
            record = logs.records[0]
            self.assertIn("corrupt", record.getMessage())
            data = getattr(record, "data", {})
            self.assertEqual((data.get("path"), data.get("events_seq_from_events")),
                             (self.layout.local_state.as_posix(), 7))

        def positive() -> None:
            # a valid cache: its own floor is kept and nothing is logged
            good = S.build_local_state()
            good["events_seq"] = 9
            S.write_json(self.layout.local_state, good)
            st = S.build_local_state()
            st["events_seq"] = 2
            with locks.hold(self.layout, "state", command="t"):
                with self.assertRaises(AssertionError):
                    with self.assertLogs("execlib.state", "WARNING"):
                        state.save(self.ctx, st)
            assert state.load(self.layout)["events_seq"] == 9

        S.assert_controlled(self, negative, positive)


class Marker(unittest.TestCase):
    def test_active_and_hooks_state(self) -> None:
        root = S.mkdtemp()
        try:
            layout = paths.layout_for(None, root / ".execution")
            self.assertIsNone(state.read_active(layout))
            marker = S.build_active(root, layout.state)
            state.write_active(layout, marker)
            self.assertEqual(state.read_active(layout), marker)
            marker["bind_nonce"] = "not-hex"
            with self.assertRaises(ValidationFailed):
                state.write_active(layout, marker)
            defaults = state.read_hooks_state(layout)
            self.assertEqual(defaults["consecutive_continuations"], 0)
            self.assertTrue(schema.validate(defaults, "local-state#/$defs/hooks_state").ok)
            S.write_json(layout.hooks_state, dict(defaults, consecutive_continuations=3))
            self.assertEqual(state.read_hooks_state(layout)["consecutive_continuations"], 3)
        finally:
            S.rmtree(root)

    def test_support_state_dir_is_valid(self) -> None:
        from execlib import plan, statusio
        with S.TempRepo() as repo:
            layout = S.state_dir(repo.path, run_state="AWAITING_HUMAN")
            self.assertEqual(state.load(layout)["run_state"], "AWAITING_HUMAN")
            self.assertEqual(state.read_active(layout)["session_id"], S.SESSION_ID)  # type: ignore[index]
            model = plan.load(layout)
            self.assertTrue(model.approved)
            self.assertEqual(model.raw["approved"]["plan_sha256"], plan.plan_digest(model.raw))
            self.assertEqual(statusio.load(layout, "A")["executor"], "A")


if __name__ == "__main__":
    unittest.main()
