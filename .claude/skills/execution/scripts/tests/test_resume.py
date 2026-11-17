"""`exec.py resume` and `resume --takeover` (contract/CLI.md `resume`, ARCHITECTURE.md 16, HOOKS.md 2.2,
NOTION.md 6.4, TESTS.md 5.4, LANES.md B04).

Run: python -m unittest discover -s scripts/tests -p "test_resume.py" -v
"""
from __future__ import annotations

import inspect
import unittest
from unittest import mock

import _support as S
from _support_B04 import World

from execlib import jsonio, resume

GOOD_ENV = {"CLAUDE_CODE_RETRY_WATCHDOG": "1", "CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS": "6",
            "CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH": "60000", "MSYS_NO_PATHCONV": "1"}


class Resume(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset()

    def _resume(self, *extra: str, session: str = S.SESSION_ID, **env_over: str) -> tuple[int, dict]:
        env = S.env_isolated(CLAUDE_CODE_SESSION_ID=session, **GOOD_ENV)
        env.update(env_over)
        code, env_out, _l = self.w.run(["resume", *extra], env=env)
        return code, env_out

    def _step(self, data: dict, sid: str) -> dict:
        return next(s for s in data["steps"] if s["id"] == sid)

    def test_steps_r0_to_r10_are_reported(self) -> None:
        code, env = self._resume()
        self.assertEqual(code, 0, env)
        self.assertEqual([s["id"] for s in env["data"]["steps"]],
                         ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"])
        self.assertTrue(self._step(env["data"], "R0")["done"])
        self.assertTrue(self._step(env["data"], "R1")["done"])
        self.assertEqual(env["data"]["session"]["same"], True)
        self.assertIn("hooks install", self._step(env["data"], "R2")["command"])  # no settings in the temp repo

    def test_missing_launcher_environment_says_restart(self) -> None:
        code, env = self._resume(MSYS_NO_PATHCONV="0")
        r0 = self._step(env["data"], "R0")
        self.assertFalse(r0["done"])
        self.assertIn("launch-exec.ps1 -Resume", r0["command"])

    def test_a_different_session_is_reported_and_nothing_rebound(self) -> None:
        before = self.w.layout.active.read_bytes()
        code, env = self._resume(session="sess-new-2")
        self.assertEqual(code, 0, env)
        r1 = self._step(env["data"], "R1")
        self.assertFalse(r1["done"])
        self.assertIn("resume --takeover", r1["command"])
        self.assertEqual(env["data"]["session"], {"env_id": "sess-new-2", "bound_id": S.SESSION_ID, "same": False})
        self.assertEqual(self.w.layout.active.read_bytes(), before)

    def test_takeover_rebinds(self) -> None:
        w = self.w
        st = w.local_state()
        st["heartbeat"] = {"cron_id": "c1", "cron_expr": "7,27,47 * * * *", "prompt": "p",
                           "recorded_utc": S.FIXED_NOW, "session_id": S.SESSION_ID}
        w.write_local_state(st)
        old_nonce = jsonio.read_json(w.layout.active)["bind_nonce"]
        code, env = self._resume("--takeover", session="sess-new-2")
        self.assertEqual(code, 0, env)
        marker = jsonio.read_json(w.layout.active)
        self.assertIsNone(marker["session_id"])
        self.assertEqual(marker["previous_session_ids"], [S.SESSION_ID])
        self.assertNotEqual(marker["bind_nonce"], old_nonce)
        self.assertEqual(env["data"]["rebind_nonce"], marker["bind_nonce"])
        self.assertTrue(any(marker["bind_nonce"] in (s.get("command") or "") for s in env["data"]["steps"]))
        hb = w.local_state()["heartbeat"]
        self.assertEqual((hb["cron_id"], hb["recorded_utc"], hb["session_id"]), (None, None, None))
        # the bound session itself: nothing to take over
        marker["session_id"] = "sess-new-2"
        jsonio.write_json_atomic(w.layout.active, marker)
        code, env = self._resume("--takeover", session="sess-new-2")
        self.assertEqual((code, env["data"]["rebind_nonce"]), (0, None))

    def test_waves_classified(self) -> None:
        w = self.w
        launch = {"at_utc": S.FIXED_NOW, "run_id": "run-1", "transcript_dir": None, "error": None}
        w.manifest("W01", [{"task": "T001"}], status="launched", launch=launch)
        st = w.local_state()
        st["waves"] = [{"wave": "W01", "status": "launched", "manifest": "waves/W01.json", "run_id": "run-1",
                        "transcript_dir": None, "session_id": S.SESSION_ID, "launched_utc": S.FIXED_NOW,
                        "finished_utc": None, "tasks": ["T001"]}]
        w.write_local_state(st)
        w.set_status("T001", "running", wave="W01")
        code, env = self._resume()
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["waves"][0]["action"], "resumeFromRunId")
        code, env = self._resume(session="sess-other")
        self.assertEqual(env["data"]["waves"][0]["action"], "relaunch")
        self.assertEqual(env["data"]["waves"][0]["same_session"], False)

    def test_launching_wave_abandoned_or_decided(self) -> None:
        w = self.w
        w.set_status("T001", "running", wave="W01")
        w.manifest("W01", [{"task": "T001"}], launching_utc="2026-10-03T06:50:00Z")
        code, env = self._resume()
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["waves"][0]["action"], "abandon")
        self.assertEqual(w.entry("T001")["status"], "ready")  # applied by R8 (status)
        w.reset()
        w.set_status("T001", "running", wave="W01")
        w.manifest("W01", [{"task": "T001"}], launching_utc="2026-10-03T06:50:00Z")
        S.write_text(w.layout.inbox("W01") / "T001.implementer.a1.json", "{}\n")
        code, env = self._resume()
        self.assertEqual(env["data"]["waves"][0]["action"], "decide")
        self.assertEqual(w.entry("T001")["status"], "running")


class Residue(unittest.TestCase):
    def test_index_lock_removed_only_without_a_git_process(self) -> None:
        w = World()
        self.addCleanup(w.cleanup)
        lock = w.path / ".git" / "index.lock"
        S.write_text(lock, "")
        ctx = w.ctx("resume")
        step = resume.r3_residue(ctx, git_running=True)
        self.assertFalse(step["done"])
        self.assertTrue(lock.exists())
        step = resume.r3_residue(ctx, git_running=False)
        self.assertTrue(step["done"])
        self.assertFalse(lock.exists())


BATCH = "N-20261003T071200Z-A-1"


def _op(op_id: str, key: str) -> dict:
    return {"op_id": op_id, "tool": "notion-update-page", "key": key, "purpose": "update-row", "hash": None,
            "capture": [], "replay_of": None,
            "args": {"page_id": "0" * 32, "command": "update_properties", "properties": {"État": "En cours"}}}


class NotionR9(unittest.TestCase):
    """R9 against lane B09's real notion module (integrated): `resume` acks every unacked op of every pending batch
    as crash-unknown, under the state lock `resume` already holds (locks are re-entrant per process)."""

    def _pending_batch(self, w: World, *, acked: tuple[str, ...]) -> None:
        batch = {"schema": "execution.notion-ops/1", "batch_id": BATCH, "executor": "A",
                 "created_utc": "2026-10-03T07:12:00Z", "kind": "mirror", "stage": 1, "wave": None,
                 "ops": [_op("op-1", "T001"), _op("op-2", "T002"), _op("op-3", "T003")],
                 "budget": {"calls": 3, "query_calls": 0, "max_in_flight": 3}, "followup": None}
        jsonio.write_json_atomic(w.layout.notion_batch(BATCH), batch)
        st = w.local_state()
        st["notion"]["pending_batches"] = [BATCH]
        w.write_local_state(st)
        if acked:  # what B09's ledger holds after the orchestrator acked these ops before the crash
            ledger = {"batches": {BATCH: {"kind": "mirror", "stage": 1, "created_utc": batch["created_utc"], "ops": 3,
                                          "acks": {op: {"data": {"op": op, "ok": True, "captured": {},
                                                                 "outbox_count": 0, "next": []},
                                                        "exit_code": 0, "errors": []} for op in acked},
                                          "expect": {}}}}
            jsonio.write_json_atomic(w.layout.local / "notion" / "ledger.json", ledger)

    def _resume(self, w: World) -> tuple[int, dict]:
        code, env, _l = w.run(["resume"], env=S.env_isolated(CLAUDE_CODE_SESSION_ID=S.SESSION_ID, **GOOD_ENV))
        return code, env

    def test_r9_acks_unacked_ops_as_crash_unknown(self) -> None:
        w = World()
        self.addCleanup(w.cleanup)
        self._pending_batch(w, acked=("op-1",))
        code, env = self._resume(w)
        self.assertEqual(code, 0, env)
        r9 = next(s for s in env["data"]["steps"] if s["id"] == "R9")
        self.assertTrue(r9["done"], r9)
        self.assertIn("2 unacked op(s) acked as crash-unknown", r9["detail"])  # op-1 was acked before the crash
        acks = [e["data"] for e in w.events("notion.ack")]
        self.assertEqual([(a["batch"], a["op"], a["ok"]) for a in acks],
                         [(BATCH, "op-2", False), (BATCH, "op-3", False)])
        self.assertEqual(w.local_state()["notion"]["pending_batches"], [],
                         "the batch is complete once every op is acked")
        self.assertTrue(w.layout.notion_outbox.exists(), "the crashed ops wait in the outbox for a replay")
        # idempotent: a second resume has nothing left to ack
        code, env = self._resume(w)
        self.assertEqual(code, 0, env)
        r9 = next(s for s in env["data"]["steps"] if s["id"] == "R9")
        self.assertIn("0 unacked op(s)", r9["detail"])
        self.assertEqual(len(w.events("notion.ack")), 2)

    def test_r9_without_pending_batches_acks_nothing(self) -> None:
        """Positive control of the fixture: the same world without a pending batch acks nothing."""
        w = World()
        self.addCleanup(w.cleanup)
        code, env = self._resume(w)
        self.assertEqual(code, 0, env)
        r9 = next(s for s in env["data"]["steps"] if s["id"] == "R9")
        self.assertEqual((r9["done"], r9["detail"].split(" ")[0]), (True, "0"))
        self.assertEqual(w.events("notion.ack"), [])

    def test_steps_keeps_the_modules_md_signature(self) -> None:
        """MODULES.md: `steps(ctx) -> list[dict]` (R0 … R10); `sweep` adds the waves and the session for the CLI."""
        self.assertEqual(list(inspect.signature(resume.steps).parameters), ["ctx"])
        w = World()
        self.addCleanup(w.cleanup)
        with mock.patch.dict("os.environ", {"CLAUDE_CODE_SESSION_ID": S.SESSION_ID, **GOOD_ENV}):
            ctx = w.ctx("resume")
            with resume.reconcile.state_lock(ctx):
                out = resume.steps(ctx)
        self.assertIsInstance(out, list)
        self.assertEqual([s["id"] for s in out], ["R0", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"])


if __name__ == "__main__":
    unittest.main()
