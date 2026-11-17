"""Stop gate (contract/HOOKS.md 4, TESTS.md 4.2, LANES.md B08): every row of the decision table through the real
launcher (`bash py.sh stop_gate.py`), with payload fixtures. Absent `background_tasks` is unknown (never empty), the
heartbeat is armed only by `session_crons` or by the bound session's record under 7 days, the fifth consecutive
continuation becomes an allow plus STUCK, and output is never a `decision` key.

Run: python -m unittest discover -s scripts/tests -p "test_stop_gate.py" -v
"""
from __future__ import annotations

import json
import unittest

import _support as S
import _support_B08 as B

ABSENT = S.ABSENT


def base(**over: object) -> dict:
    return S.payload("stop.base", **over)


@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class StopGate(unittest.TestCase):
    def setUp(self) -> None:
        self.r = B.HookRepo()

    def tearDown(self) -> None:
        self.r.cleanup()

    def stop(self, payload: dict, **kw: object) -> B.HookRun:
        res = self.r.run("stop_gate.py", payload, **kw)  # type: ignore[arg-type]
        obj = res.obj
        if obj is not None:
            self.assertNotIn("decision", obj)
            self.assertEqual(set(obj), {"hookSpecificOutput"})
            self.assertEqual(obj["hookSpecificOutput"]["hookEventName"], "Stop")
        return res

    def counter(self) -> int:
        hs = self.r.hooks_state()
        return 0 if hs is None else hs["consecutive_continuations"]

    def armed_record(self, session: str = S.SESSION_ID, days: float = 1) -> None:
        st = self.r.local_state()
        st["heartbeat"] = {"cron_id": "cron-1", "cron_expr": "7,27,47 * * * *", "prompt": "execution heartbeat",
                           "recorded_utc": B.utc_minus(days=days), "session_id": session}
        self.r.set_local(heartbeat=st["heartbeat"])

    def launched_wave(self) -> None:
        self.r.set_local(waves=[{"wave": "W03", "status": "launched", "manifest": "waves/W03.json",
                                 "run_id": "run-1", "launched_utc": S.FIXED_NOW, "finished_utc": None,
                                 "tasks": ["T001"]}])

    def awaiting(self, ref: str = "T004") -> None:
        self.r.set_local(awaiting=[{"kind": "manual", "ref": ref, "since_utc": S.FIXED_NOW, "latest_utc": None}])

    # H-STOP-01
    def test_running_workflow_allows(self) -> None:
        res = self.stop(base())
        self.assertIsNone(res.obj)
        self.assertEqual(self.r.event_types(), ["stop.allow"])
        self.assertEqual(self.r.events()[0]["data"]["reason"], "running")
        self.assertEqual(self.counter(), 0)

    # H-STOP-02
    def test_ready_tasks_and_nothing_armed_continue(self) -> None:
        self.r.write_schedule(["T005", "T006"])
        res = self.stop(base(background_tasks=[], session_crons=[]))
        text = res.context
        self.assertIsNotNone(text)
        assert text is not None
        self.assertTrue(text.startswith("execution: the plan is open and nothing is armed (continuation 1/4). "
                                        "Ready: T005, T006."), text)
        self.assertIn(S.EXEC_PY.as_posix(), text)
        self.assertLessEqual(len(text), 600)
        self.assertEqual(self.counter(), 1)
        self.assertEqual(self.r.event_types(), ["stop.continue"])

    # H-STOP-03 and H-STOP-22 (positive control and negative case)
    def test_absent_background_with_launched_wave(self) -> None:
        self.launched_wave()
        res_unarmed = self.stop(base(background_tasks=ABSENT, session_crons=ABSENT))
        self.assertIsNotNone(res_unarmed.context, "no heartbeat: continuation (H-STOP-22)")
        self.armed_record()
        res = self.stop(base(background_tasks=ABSENT, session_crons=ABSENT))
        self.assertIsNone(res.obj)
        self.assertEqual(self.r.events()[-1]["data"]["reason"], "wave-launched-unknown-bg")

    # H-STOP-04
    def test_present_empty_background_is_nothing_running(self) -> None:
        self.launched_wave()
        self.armed_record()
        res = self.stop(base(background_tasks=[], session_crons=ABSENT))
        self.assertIsNotNone(res.context)
        assert res.context is not None
        self.assertIn("wave ingest", res.context)

    # H-STOP-05
    def test_absent_background_never_counts_as_running(self) -> None:
        res = self.stop(base(background_tasks=ABSENT, session_crons=ABSENT))
        self.assertIsNotNone(res.context)
        self.assertEqual(self.r.event_types(), ["stop.continue"])

    # H-STOP-06, H-STOP-07, H-STOP-09
    def test_awaiting_with_and_without_heartbeat(self) -> None:
        self.awaiting()
        armed = self.stop(base(background_tasks=[]))
        self.assertIsNone(armed.obj)
        self.assertEqual(self.r.events()[-1]["data"], {"reason": "awaiting", "refs": ["T004"]})
        unarmed = self.stop(base(background_tasks=[], session_crons=[]))
        assert unarmed.context is not None
        self.assertIn("arm the heartbeat", unarmed.context)
        other_cron = [{"id": "c2", "schedule": "*/5 * * * *", "prompt": "check the deploy", "recurring": True}]
        self.assertIsNotNone(self.stop(base(background_tasks=[], session_crons=other_cron)).context)
        not_recurring = [{"id": "c3", "schedule": "7 * * * *", "prompt": "execution heartbeat: x", "recurring": False}]
        self.assertIsNotNone(self.stop(base(background_tasks=[], session_crons=not_recurring)).context)

    # H-STOP-08
    def test_recorded_heartbeat_age(self) -> None:
        self.awaiting()
        self.armed_record(days=2)
        self.assertIsNone(self.stop(base(background_tasks=[], session_crons=ABSENT)).obj)
        self.armed_record(days=8)
        self.assertIsNotNone(self.stop(base(background_tasks=[], session_crons=ABSENT)).context)

    # H-STOP-21
    def test_recorded_heartbeat_of_another_session_is_not_armed(self) -> None:
        self.awaiting()
        self.armed_record(session="sess-orch-0", days=1)
        self.assertIsNotNone(self.stop(base(background_tasks=[], session_crons=ABSENT)).context)
        self.armed_record(session=S.SESSION_ID, days=1)  # positive control: the bound session's record arms
        self.assertIsNone(self.stop(base(background_tasks=[], session_crons=ABSENT)).obj)

    # H-STOP-10, H-STOP-11
    def test_paused_and_terminal_states(self) -> None:
        self.r.set_local(run_state="PAUSED_QUOTA")
        self.assertIsNone(self.stop(base(background_tasks=[])).obj)
        for state in ("BUILD_COMPLETE", "HANDED_OVER", "STUCK"):
            with self.subTest(state=state):
                self.r.set_local(run_state=state)
                self.r.clear_events()
                self.assertIsNone(self.stop(base(background_tasks=[], session_crons=[])).obj)
                self.assertEqual(self.r.events()[-1]["data"]["reason"], "terminal-or-stuck")
        for state in ("INIT", "PREFLIGHT", "INGEST", "PLAN"):
            with self.subTest(state=state):
                self.r.set_local(run_state=state)
                self.r.clear_events()
                self.assertIsNone(self.stop(base(background_tasks=[], session_crons=[])).obj)
                self.assertEqual(self.r.events()[-1]["data"]["reason"], "setup")

    # H-STOP-19, H-STOP-20, H-STOP-23
    def test_idle_armed_and_unarmed(self) -> None:
        self.r.write_schedule([])
        self.assertIsNone(self.stop(base(background_tasks=[])).obj)
        self.assertEqual(self.r.events()[-1]["data"]["reason"], "idle-armed")
        self.assertEqual(self.counter(), 0)
        res = self.stop(base(background_tasks=[], session_crons=[]))
        assert res.context is not None
        self.assertIn("nothing can launch now", res.context)
        self.assertNotIn("Ready:", res.context)
        self.r.write_schedule(["T005"])
        self.r.set_local(governor={"at_utc": S.FIXED_NOW, "disk_free_gb": 1.0, "ram_free_gb": 8.0,
                                   "commit_free_gb": 10.0, "ac_power": True, "network": True,
                                   "harden_active": False,
                                   "decision": {"pause": True, "lanes": 0, "verifiers": 0, "browser_slots": 0,
                                                "workspace_mode": "single-tree", "reasons": ["disk"]}})
        self.assertIsNone(self.stop(base(background_tasks=[])).obj)
        self.assertEqual(self.r.events()[-1]["data"]["reason"], "idle-armed")

    # H-STOP-12, H-STOP-13
    def test_counter_escalation_then_reset(self) -> None:
        payload = base(background_tasks=[], session_crons=[], stop_hook_active=True)
        texts = []
        for n in range(1, 5):
            res = self.stop(payload)
            self.assertIsNotNone(res.context, f"call {n}")
            texts.append(res.context)
            self.assertEqual(self.counter(), n)
        self.assertIn("This is the last continuation", texts[3])
        self.assertIn("PushNotification", texts[3])
        self.assertIn("BLOQU", texts[3])
        raw = self.r.run("stop_gate.py", payload).stdout
        self.assertEqual(raw, b"")
        hs = self.r.hooks_state()
        assert hs is not None
        self.assertEqual(hs["stuck"]["source"], "stop-gate")
        self.assertEqual(hs["consecutive_continuations"], 0)
        self.assertIn("stop.stuck", self.r.event_types())
        # the fourth continuation's French text reached stdout ASCII-escaped
        self.r.set_hooks_state(consecutive_continuations=3)
        out = self.r.run("stop_gate.py", payload).stdout
        out.decode("ascii")
        self.assertIn(b"\\u00c9", out)
        # H-STOP-13: counter 4, then stop_hook_active false resets it and continues with 1
        self.r.set_hooks_state(consecutive_continuations=4)
        res = self.stop(base(background_tasks=[], session_crons=[], stop_hook_active=False))
        assert res.context is not None
        self.assertIn("continuation 1/4", res.context)
        self.assertEqual(self.counter(), 1)

    # H-STOP-14, H-STOP-15
    def test_other_session_and_agent_do_nothing(self) -> None:
        def nothing(payload: dict) -> None:
            before = self.r.snapshot()
            res = self.r.run("stop_gate.py", payload)
            self.assertEqual(res.stdout, b"")
            self.assertEqual(self.r.snapshot(), before)

        S.assert_controlled(
            self,
            negative=lambda: (nothing(base(background_tasks=[], session_crons=[], session_id="sess-other")),
                              nothing(base(background_tasks=[], session_crons=[], agent_id="agent-1",
                                           agent_type="execution-implementer"))),
            positive=lambda: self.assertIsNotNone(self.stop(base(background_tasks=[], session_crons=[])).context))

    # H-STOP-16
    def test_no_marker_writes_nothing(self) -> None:
        self.r.layout.active.unlink()
        before = sorted(p.as_posix() for p in self.r.layout.state.rglob("*"))
        res = self.r.run("stop_gate.py", base(background_tasks=[], session_crons=[]))
        self.assertEqual(res.stdout, b"")
        self.assertEqual(sorted(p.as_posix() for p in self.r.layout.state.rglob("*")), before)

    # H-STOP-17
    def test_corrupt_marker_fails_open(self) -> None:
        self.r.layout.active.write_bytes(b'{"schema": "execution.active/1", "repo": ')
        res = self.r.run("stop_gate.py", base(background_tasks=[], session_crons=[]))
        self.assertEqual(res.stdout, b"")
        lines = self.r.layout.hook_errors.read_text(encoding="utf-8").strip().split("\n")
        self.assertEqual(len(lines), 1)
        line = json.loads(lines[0])
        self.assertEqual(line["level"], "error")
        self.assertEqual(line["module"], "hook.stop-gate")
        self.assertIn("JSONDecodeError", line["exc"])

    # H-STOP-18
    def test_marker_found_from_subdir_and_project_dir(self) -> None:
        sub = self.r.path / "src" / "deep"
        sub.mkdir(parents=True)
        res = self.stop(base(background_tasks=[], session_crons=[], cwd=sub.as_posix()))
        self.assertIsNotNone(res.context)
        elsewhere = S.mkdtemp()
        try:
            env = B.env_with(CLAUDE_PROJECT_DIR=str(self.r.path))
            res2 = self.r.run("stop_gate.py", base(background_tasks=[], session_crons=[], cwd=elsewhere.as_posix()),
                              env=env, cwd=elsewhere)
            self.assertIsNotNone(res2.context)
            # positive control of the negative: without CLAUDE_PROJECT_DIR the run is not found from elsewhere
            res3 = self.r.run("stop_gate.py", base(background_tasks=[], session_crons=[], cwd=elsewhere.as_posix()),
                              cwd=elsewhere)
            self.assertEqual(res3.stdout, b"")
        finally:
            S.rmtree(elsewhere)

    # stop.utf8
    def test_utf8_payload_gives_ascii_json(self) -> None:
        self.r.write_schedule(["T005"])
        self.awaiting("T004")
        res = self.stop(base(background_tasks=[], session_crons=[],
                             last_assistant_message="vague lancée → ok ≤ 2 \U0001F680 !"))
        res.stdout.decode("ascii")
        self.assertIsNotNone(res.obj)

    def test_last_stop_written_by_every_row_from_two(self) -> None:
        self.stop(base())
        hs = self.r.hooks_state()
        assert hs is not None
        self.assertEqual(hs["last_stop_utc"], S.FIXED_NOW)

    def test_hooks_state_and_events_validate(self) -> None:
        from execlib import schema
        self.r.write_schedule(["T005"])
        self.stop(base(background_tasks=[], session_crons=[]))
        self.stop(base())
        hs = self.r.hooks_state()
        self.assertTrue(schema.validate(hs, "local-state#/$defs/hooks_state").ok)
        for ev in self.r.events():
            self.assertTrue(schema.validate(ev, "local-state#/$defs/hook_event").ok, ev)


if __name__ == "__main__":
    unittest.main()
