"""UserPromptSubmit hook (contract/HOOKS.md 9, TESTS.md 4.5, LANES.md B08): a workflow completion prompt
(`<task-notification`) is ignored; the owner's prompt in the orchestrator session gets one line of context of at most
200 characters; another session gets nothing.

Run: python -m unittest discover -s scripts/tests -p "test_user_prompt.py" -v
"""
from __future__ import annotations

import unittest

import _support as S
import _support_B08 as B


@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class UserPrompt(unittest.TestCase):
    def setUp(self) -> None:
        self.r = B.HookRepo()
        self.r.set_local(
            waves=[{"wave": "W03", "status": "launched", "manifest": "waves/W03.json", "run_id": "r1",
                    "launched_utc": S.FIXED_NOW, "finished_utc": None, "tasks": ["T001"]}],
            awaiting=[{"kind": "manual", "ref": "T004", "since_utc": S.FIXED_NOW, "latest_utc": None}])

    def tearDown(self) -> None:
        self.r.cleanup()

    def test_task_notification_ignored(self) -> None:
        for prompt in ("<task-notification><task-id>w1</task-id></task-notification>",
                       "  \n<task-notification>done</task-notification>", "<\\task-notification>"):
            with self.subTest(prompt=prompt[:20]):
                before = self.r.snapshot()
                res = self.r.run("user_prompt.py", S.payload("user_prompt.base", prompt=prompt))
                self.assertEqual(res.stdout, b"")
                self.assertEqual(self.r.snapshot(), before)

    def test_owner_prompt_gets_one_line(self) -> None:
        res = self.r.run("user_prompt.py", S.payload("user_prompt.base"))
        self.assertEqual(res.context, "execution: RUNNING, 1 waves running, awaiting T004; run exec.py status first.")
        res.stdout.decode("ascii")
        obj = res.obj
        assert obj is not None
        self.assertEqual(obj["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")

    def test_long_awaiting_list_capped(self) -> None:
        self.r.set_local(awaiting=[{"kind": "manual", "ref": f"T{i:03d}", "since_utc": S.FIXED_NOW,
                                    "latest_utc": None} for i in range(100, 160)])
        text = self.r.run("user_prompt.py", S.payload("user_prompt.base")).context
        assert text is not None
        self.assertLessEqual(len(text), 200)
        self.assertTrue(text.endswith("run exec.py status first."))

    def test_other_session_nothing(self) -> None:
        S.assert_controlled(
            self,
            negative=lambda: self.assertEqual(
                self.r.run("user_prompt.py", S.payload("user_prompt.base", session_id="sess-x")).stdout, b""),
            positive=lambda: self.assertIsNotNone(self.r.run("user_prompt.py", S.payload("user_prompt.base")).context))


if __name__ == "__main__":
    unittest.main()
