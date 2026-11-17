"""`events replay` and the local-state rebuild (contract/CLI.md `events replay`, SCHEMAS.md 8, TESTS.md 3.6,
LANES.md B04).

Run: python -m unittest discover -s scripts/tests -p "test_replay.py" -v
"""
from __future__ import annotations

import unittest

import _support as S
from _support_B04 import World

from execlib import events, jsonio

REBUILT = ("run_state", "waves", "awaiting", "flags", "events_seq", "plan_sha256")


class Replay(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset()

    def _history(self) -> None:
        """A small run: a posted manual task, an open proposal, a launched wave, a status tick."""
        w = self.w
        with w.locked():  # what the approval's resolution wrote when the run started
            events.append(w.ctx("decision resolve"), "run.state",
                          {"from": "AWAIT_APPROVAL", "to": "RUNNING", "reason": "plan approved (D-002)"})
        w.set_status("T003", "ready")
        self.assertEqual(w.run(["manual", "post", "--task", "T003"])[0], 0)
        self.assertEqual(w.run(["decision", "propose", "--kind", "other", "--title", "Port", "--task", "T002"])[0], 0)
        w.set_status("T001", "running", wave="W01")
        w.manifest("W01", [{"task": "T001"}], status="launched",
                   launch={"at_utc": S.FIXED_NOW, "run_id": "run-1", "transcript_dir": None, "error": None})
        with w.locked():
            events.append(w.ctx("wave launched"), "wave.launched", {"wave": "W01", "run_id": "run-1"})
        st = w.local_state()
        st["waves"] = [{"wave": "W01", "status": "launched", "manifest": "waves/W01.json", "run_id": "run-1",
                        "transcript_dir": None, "session_id": S.SESSION_ID, "launched_utc": S.FIXED_NOW,
                        "finished_utc": None, "tasks": ["T001"]}]
        w.write_local_state(st)
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)

    def test_rebuild_equals_the_original(self) -> None:
        w = self.w
        self._history()
        original = w.local_state()
        w.layout.local_state.unlink()
        code, env, _l = w.run(["events", "replay", "--rebuild-state"])
        self.assertEqual(code, 0, env)
        self.assertTrue(env["data"]["rebuilt"])
        rebuilt = w.local_state()
        for field in REBUILT:
            if field == "events_seq":  # the rebuild appends its own `resume` event
                self.assertEqual(rebuilt[field], original[field] + 1)
                continue
            self.assertEqual(rebuilt[field], original[field], field)
        self.assertEqual(rebuilt["run_state"], "RUNNING")
        self.assertEqual({a["ref"] for a in rebuilt["awaiting"]}, {"T003", "D-001"})

    def test_invalid_lines_exit_1_and_still_rebuild(self) -> None:
        w = self.w
        self._history()
        with open(w.layout.events, "a", encoding="utf-8", newline="\n") as fh:
            fh.write('{"broken": true}\n')
        code, env, _l = w.run(["events", "replay", "--rebuild-state"])
        self.assertEqual(code, 1, env)
        self.assertTrue(env["data"]["rebuilt"])
        self.assertEqual(len(env["data"]["invalid"]), 1)
        code, env, _l = w.run(["events", "replay"])  # read-only form, same verdict
        self.assertEqual(code, 1, env)
        self.assertFalse(env["data"]["rebuilt"])

    def test_duplicates_are_counted_and_dropped(self) -> None:
        w = self.w
        with w.locked():
            for _ in range(2):
                events.append(w.ctx("status"), "stop.allow", {"reason": "x"}, actor="hook:stop-gate@A",
                              event_id="0123456789abcdef")
        code, env, _l = w.run(["events", "replay"])
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["duplicates"], 1)
        total = sum(1 for _n, d in jsonio.read_jsonl(w.layout.events) if isinstance(d, dict))
        self.assertEqual(env["data"]["events"], total - 1)


if __name__ == "__main__":
    unittest.main()
