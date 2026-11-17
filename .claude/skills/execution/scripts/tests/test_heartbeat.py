"""`exec.py heartbeat plan | record` (contract/CLI.md 1, HOOKS.md 4.2, TESTS.md 3.13, LANES.md B08).

The cron minutes follow `sorted({(offset + k * every) % 60})` (offset 7 every 20 -> 7,27,47; offset 45 every 20 ->
5,25,45); the prompt is plain text with this machine's absolute paths (`execution heartbeat: run python
"<SKILL_DIR>/scripts/exec.py" status and follow <SKILL_DIR>/references/tick.md`); record stores the cron with
CLAUDE_CODE_SESSION_ID, is idempotent, and the Stop gate then counts it only for the bound session.

Run: python -m unittest discover -s scripts/tests -p "test_heartbeat.py" -v
"""
from __future__ import annotations

import unittest

import _support as S
import _support_B08 as B
from execlib import heartbeat, jsonio

SKILL = S.SKILL_DIR.as_posix()
PROMPT = f'execution heartbeat: run python "{SKILL}/scripts/exec.py" status and follow {SKILL}/references/tick.md'


class CronFormula(unittest.TestCase):
    def test_minutes(self) -> None:
        cases = {(7, 20): "7,27,47 * * * *", (45, 20): "5,25,45 * * * *", (3, 10): "3,13,23,33,43,53 * * * *",
                 (59, 30): "29,59 * * * *", (12, 12): "0,12,24,36,48 * * * *", (1, 15): "1,16,31,46 * * * *"}
        for (offset, every), expected in cases.items():
            with self.subTest(offset=offset, every=every):
                out = heartbeat.cron_for({"heartbeat": {"every_min": every, "minute_offset": offset}})
                self.assertEqual(out["cron"], expected)
                self.assertTrue(out["recurring"])
                self.assertEqual(out["prompt"], PROMPT)

    def test_bad_profile(self) -> None:
        from execlib.errors import UsageError
        for hb in ({"every_min": 7, "minute_offset": 1}, {"every_min": 20, "minute_offset": "x"}, None):
            with self.subTest(hb=hb), self.assertRaises(UsageError):
                heartbeat.cron_for({"heartbeat": hb} if hb is not None else {})
        heartbeat.cron_for({"heartbeat": {"every_min": 20, "minute_offset": 7}})  # positive control


class HeartbeatCli(unittest.TestCase):
    def setUp(self) -> None:
        self.r = B.HookRepo()
        jsonio.write_json_atomic(self.r.layout.profile, S.build_profile())

    def tearDown(self) -> None:
        self.r.cleanup()

    def test_plan(self) -> None:
        code, env, _ = S.run_exec(["heartbeat", "plan"], cwd=self.r.path)
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"], {"cron": "7,27,47 * * * *", "prompt": PROMPT, "recurring": True})
        before = self.r.layout.local_state.read_bytes()
        self.assertEqual(self.r.layout.local_state.read_bytes(), before)  # read-only

    def test_plan_without_profile(self) -> None:
        self.r.layout.profile.unlink()
        code, env, _ = S.run_exec(["heartbeat", "plan"], cwd=self.r.path)
        self.assertEqual(code, 2)

    def test_record_and_stop_gate(self) -> None:
        code, env, _ = S.run_exec(["heartbeat", "record", "--cron-id", "cron-9", "--expr", "7,27,47 * * * *"],
                                  cwd=self.r.path)
        self.assertEqual(code, 0, env)
        hb = jsonio.read_json(self.r.layout.local_state)["heartbeat"]
        self.assertEqual(hb, {"cron_id": "cron-9", "cron_expr": "7,27,47 * * * *", "prompt": PROMPT,
                              "recorded_utc": S.FIXED_NOW, "session_id": S.SESSION_ID})
        self.assertTrue(env["data"]["counts_for_stop_gate"])
        before = self.r.layout.local_state.read_bytes()
        code2, env2, _ = S.run_exec(["heartbeat", "record", "--cron-id", "cron-9", "--expr", "7,27,47 * * * *"],
                                    cwd=self.r.path)
        self.assertEqual(code2, 0)
        self.assertFalse(env2["data"]["changed"])
        self.assertEqual(self.r.layout.local_state.read_bytes(), before)
        if B.git_bash_available():
            self.r.set_local(awaiting=[{"kind": "manual", "ref": "T004", "since_utc": S.FIXED_NOW,
                                        "latest_utc": None}])
            res = self.r.run("stop_gate.py", S.payload("stop.base", background_tasks=[], session_crons=S.ABSENT))
            self.assertIsNone(res.obj)  # armed by the record of the bound session
            code3, _e, _ = S.run_exec(["heartbeat", "record", "--cron-id", "cron-9", "--expr", "7,27,47 * * * *"],
                                      cwd=self.r.path, env=S.env_isolated(CLAUDE_CODE_SESSION_ID="sess-other"))
            self.assertEqual(code3, 0)
            res2 = self.r.run("stop_gate.py", S.payload("stop.base", background_tasks=[], session_crons=S.ABSENT))
            self.assertIsNotNone(res2.context)  # recorded by another session: not armed

    def test_record_refuses_bad_values(self) -> None:
        for args in (["--cron-id", "a b", "--expr", "7 * * * *"], ["--cron-id", "c1", "--expr", "every hour"],
                     ["--cron-id", "c1", "--expr", "7 * * *"]):
            with self.subTest(args=args):
                code, env, _ = S.run_exec(["heartbeat", "record", *args], cwd=self.r.path)
                self.assertEqual(code, 2, env)
        code, _env, _ = S.run_exec(["heartbeat", "record", "--cron-id", "c1", "--expr", "*/20 * * * *"],
                                   cwd=self.r.path)
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
