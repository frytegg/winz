"""SessionStart, SessionEnd and StopFailure hooks (contract/HOOKS.md 5-7, TESTS.md 4.3, LANES.md B08).

The SessionStart context stays within 2,000 characters and is printed only to the orchestrator session; a `/clear`
re-keys the run only when the bound session's SessionEnd(clear) armed it less than 120 s before; StopFailure records
STUCK for the orchestrator except on `rate_limit`, and only an event for an agent. EXEC_NOW is honoured only with
EXEC_TEST=1.

Run: python -m unittest discover -s scripts/tests -p "test_session_hooks.py" -v
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import _support as S
import _support_B08 as B
from execlib import jsonio, schema, state

SKILL = S.SKILL_DIR.as_posix()


def ss(**over: object) -> dict:
    return S.payload("session_start.base", **over)


def se(**over: object) -> dict:
    return S.payload("session_end.base", **over)


def sf(**over: object) -> dict:
    return S.payload("stop_failure.base", **over)


def digest_lines(n_chars: int) -> str:
    lines = []
    i = 0
    while sum(len(x) + 1 for x in lines) < n_chars:
        lines.append(f"line {i:04d}: task T{i:03d} done, proof ok, wave W0{i % 9} " + "x" * 20)
        i += 1
    return "\n".join(lines) + "\n"


@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class SessionStart(unittest.TestCase):
    def setUp(self) -> None:
        self.r = B.HookRepo()

    def tearDown(self) -> None:
        self.r.cleanup()

    def write_digest(self, chars: int, minutes_old: float = 12) -> str:
        text = "python \"x/exec.py\"\n" + digest_lines(chars)
        S.write_text(self.r.layout.digest, text)
        B.set_mtime_minutes_before_now(self.r.layout.digest, minutes_old)
        return text

    # H-SS-01
    def test_compact_prints_digest_with_age(self) -> None:
        self.write_digest(1500)
        res = self.r.run("session_start.py", ss())
        text = res.context
        assert text is not None
        self.assertLessEqual(len(text), 2000)
        self.assertIn("written 12 min ago by exec.py status", text)
        self.assertIn("line 0000", text)
        self.assertIn(f'EXEC = python "{SKILL}/scripts/exec.py"', text)
        self.assertTrue(text.rstrip().endswith("Do not rely on memory of this conversation for task states."))
        self.assertIn(f"re-read {SKILL}/SKILL.md", text)
        self.assertIn("session.start", self.r.event_types())

    # H-SS-02
    def test_long_digest_truncated_with_instruction_kept(self) -> None:
        self.write_digest(5000)
        text = self.r.run("session_start.py", ss()).context
        assert text is not None
        self.assertLessEqual(len(text), 2000)
        self.assertIn(f"{SKILL}/references/tick.md", text)
        self.assertTrue(text.endswith("task states."))
        self.assertNotIn("line 0090", text)

    # H-SS-03
    def test_no_digest_gives_run_state_line(self) -> None:
        text = self.r.run("session_start.py", ss()).context
        assert text is not None
        self.assertIn("No digest yet; run_state from local/state.json: RUNNING.", text)

    # H-SS-04
    def test_other_session_and_agent_get_nothing(self) -> None:
        S.assert_controlled(
            self,
            negative=lambda: (self.assertEqual(self.r.run("session_start.py", ss(session_id="sess-x",
                                                                                 source="startup")).stdout, b""),
                              self.assertEqual(self.r.run("session_start.py", ss(agent_id="a1")).stdout, b"")),
            positive=lambda: self.assertIsNotNone(self.r.run("session_start.py", ss(source="startup")).context))

    def test_resume_line_with_nonce(self) -> None:
        text = self.r.run("session_start.py", ss(source="resume")).context
        assert text is not None
        self.assertIn("hooks canary --nonce 0123456789abcdef", text)
        self.assertIn("CronList", text)
        compact = self.r.run("session_start.py", ss(source="compact")).context
        assert compact is not None
        self.assertNotIn("--nonce", compact)

    # H-SS-05
    def test_clear_rekey(self) -> None:
        self.assertEqual(self.r.run("session_end.py", se()).stdout, b"")
        self.assertEqual(self.r.marker()["rekey_armed_until_utc"], "2026-10-03T07:14:00Z")
        env = B.env_with(EXEC_NOW="2026-10-03T07:13:00Z")
        res = self.r.run("session_start.py", ss(source="clear", session_id="sess-orch-2"), env=env)
        marker = self.r.marker()
        self.assertEqual(marker["session_id"], "sess-orch-2")
        self.assertEqual(marker["previous_session_ids"], [S.SESSION_ID])
        self.assertIsNone(marker["rekey_armed_until_utc"])
        self.assertIn("hooks.rekeyed", self.r.event_types())
        text = res.context
        assert text is not None
        self.assertIn(f'python "{SKILL}/scripts/exec.py" resume', text)
        self.assertIn("CronList", text)
        # then a Stop from the new id is the orchestrator's and one from the old id is ignored
        stop_new = self.r.run("stop_gate.py", S.payload("stop.base", session_id="sess-orch-2", background_tasks=[],
                                                        session_crons=[]), env=env)
        self.assertIsNotNone(stop_new.context)
        stop_old = self.r.run("stop_gate.py", S.payload("stop.base", background_tasks=[], session_crons=[]), env=env)
        self.assertEqual(stop_old.stdout, b"")

    # H-SS-06
    def test_clear_after_window_does_not_rekey(self) -> None:
        self.r.run("session_end.py", se())
        env = B.env_with(EXEC_NOW="2026-10-03T07:14:01Z")
        res = self.r.run("session_start.py", ss(source="clear", session_id="sess-orch-2"), env=env)
        self.assertEqual(res.stdout, b"")
        self.assertEqual(self.r.marker()["session_id"], S.SESSION_ID)

    # H-SS-07
    def test_clear_without_session_end_does_not_rekey(self) -> None:
        res = self.r.run("session_start.py", ss(source="clear", session_id="sess-orch-2"))
        self.assertEqual(res.stdout, b"")
        self.assertEqual(self.r.marker()["session_id"], S.SESSION_ID)

    # H-SS-08
    def test_session_end_other_reason_or_session(self) -> None:
        S.assert_controlled(
            self,
            negative=lambda: (self.r.run("session_end.py", se(reason="logout")),
                              self.r.run("session_end.py", se(session_id="sess-x")),
                              self.assertIsNone(self.r.marker()["rekey_armed_until_utc"])),
            positive=lambda: None)
        self.r.run("session_end.py", se())  # positive control: the bound session's clear arms it
        self.assertIsNotNone(self.r.marker()["rekey_armed_until_utc"])

    def test_exec_now_needs_exec_test(self) -> None:
        self.r.run("session_end.py", se(), env=B.env_with(EXEC_TEST=None, EXEC_NOW="2020-01-01T00:00:00Z"))
        armed = self.r.marker()["rekey_armed_until_utc"]
        self.assertNotEqual(armed, "2020-01-01T00:02:00Z")  # EXEC_NOW alone is ignored: the system clock is used
        self.r.set_marker(rekey_armed_until_utc=None)
        self.r.run("session_end.py", se(), env=B.env_with(EXEC_NOW="2020-01-01T00:00:00Z"))
        self.assertEqual(self.r.marker()["rekey_armed_until_utc"], "2020-01-01T00:02:00Z")

    def test_marker_stays_schema_valid(self) -> None:
        from execlib import schema
        self.r.run("session_end.py", se())
        self.r.run("session_start.py", ss(source="clear", session_id="sess-orch-2"),
                   env=B.env_with(EXEC_NOW="2026-10-03T07:13:00Z"))
        self.assertTrue(schema.validate(self.r.marker(), "local-state#/$defs/active_marker").ok)


@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class StopFailure(unittest.TestCase):
    def setUp(self) -> None:
        self.r = B.HookRepo()

    def tearDown(self) -> None:
        self.r.cleanup()

    # H-SF-01
    def test_orchestrator_overloaded_records_stuck(self) -> None:
        res = self.r.run("stop_failure.py", sf())
        self.assertEqual(res.stdout, b"")
        hs = self.r.hooks_state()
        assert hs is not None
        self.assertEqual(hs["stuck"]["reason"], "stop-failure: overloaded")
        self.assertEqual(hs["stuck"]["source"], "stop-failure")
        ev = self.r.events()[-1]
        self.assertEqual(ev["type"], "stop.failure")
        self.assertEqual(set(ev["data"]), {"error", "error_details", "keys"})
        self.assertIn("error", ev["data"]["keys"])

    # H-SF-03
    def test_rate_limit_is_never_stuck(self) -> None:
        S.assert_controlled(
            self,
            negative=lambda: (self.r.run("stop_failure.py", sf(error="rate_limit")),
                              self.assertIsNone((self.r.hooks_state() or {}).get("stuck")),
                              self.assertEqual(self.r.events()[-1]["data"]["error"], "rate_limit")),
            positive=lambda: None)

    # H-SF-03 second half (`exec.py quota` pauses on the imported event) belongs to lanes B03/B04 (quota, status)

    def test_agent_failure_is_event_only(self) -> None:
        self.r.run("stop_failure.py", sf(agent_id="agent-3", agent_type="execution-implementer"))
        self.assertIsNone(self.r.hooks_state())
        ev = self.r.events()[-1]
        self.assertEqual(ev["data"], {"agent": True, "error": "overloaded"})

    # H-SF-02
    def test_other_session_nothing(self) -> None:
        before = self.r.snapshot()
        self.r.run("stop_failure.py", sf(session_id="sess-x"))
        self.assertEqual(self.r.snapshot(), before)
        self.r.run("stop_failure.py", sf())  # positive control
        self.assertNotEqual(self.r.snapshot(), before)

    # H-SF-04 (the drop is exec.py status's, lane B04): the hook side leaves both records for status to compare
    def test_failure_then_stop_leaves_both_events(self) -> None:
        self.r.run("stop_failure.py", sf())
        self.r.run("stop_gate.py", S.payload("stop.base"))
        types = self.r.event_types()
        self.assertEqual(types, ["stop.failure", "stop.allow"])
        sessions = {e["session_id"] for e in self.r.events()}
        self.assertEqual(sessions, {S.SESSION_ID})

    def test_error_details_redacted(self) -> None:
        key = S.planted("key.private")
        self.r.run("stop_failure.py", sf(error_details=f"boom {key}"))
        raw = b"".join(p.read_bytes() for p in self.r.layout.hook_events_dir.glob("*.json"))
        self.assertNotIn(key.encode(), raw)
        self.assertIn(b"redacted", raw)


def up(**over: object) -> dict:
    return S.payload("user_prompt.base", **over)


def stop(**over: object) -> dict:
    return S.payload("stop.base", **over)


def schema_lists_last_effort(schema_dir: Path) -> bool:
    doc = json.loads((schema_dir / "local-state.schema.json").read_text(encoding="utf-8"))
    return "last_effort" in doc["$defs"]["hooks_state"]["properties"]


@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class EffortRecord(unittest.TestCase):
    """Contract revision 4: the hooks record the `effort` of the orchestrator's Stop, UserPromptSubmit and
    SessionStart payloads as hooks-state `last_effort` (preflight PF-30 reads it), and only while the local-state
    schema lists that key: `exec.py status` validates hooks-state against the schema (Q-B08-18)."""

    def setUp(self) -> None:
        self.r = B.HookRepo()

    def tearDown(self) -> None:
        self.r.cleanup()

    def last(self) -> object:
        hs = self.r.hooks_state() or {}
        return hs.get("last_effort", "<absent>")

    def test_skill_tree_follows_its_installed_schema(self) -> None:
        """With the skill's own schema, which lists the key since revision 4 landed (lane B01): the recording is
        on, and hooks-state reads back through state.read_hooks_state (the validating reader `exec.py status` uses)."""
        self.assertTrue(schema_lists_last_effort(S.SKILL_DIR / "assets" / "schemas"),
                        "local-state.schema.json lost hooks_state.last_effort (contract revision 4)")
        self.r.run("user_prompt.py", up(effort="xhigh"))
        self.r.run("session_start.py", ss(effort="xhigh"))
        self.r.run("stop_gate.py", stop(effort="xhigh"))
        hs = self.r.hooks_state()
        assert hs is not None
        self.assertIsNotNone(hs["last_stop_utc"])  # positive control: the stop gate wrote hooks-state
        self.assertEqual(hs.get("last_effort", "<absent>"), "xhigh")
        self.assertEqual(state.read_hooks_state(self.r.layout), hs)
        self.assertFalse(self.r.layout.hook_errors.exists())

    def test_exec_status_validates_hooks_state_carrying_last_effort(self) -> None:
        """`exec.py status` (the real CLI) accepts the hooks-state the hooks wrote with `last_effort` and leaves the
        key in place; the same file with a level outside the enum is refused with E_STATE_INVALID, so the acceptance
        comes from validation and not from a reader that ignores the key."""
        self.r.run("user_prompt.py", up(effort="max"))
        self.r.run("stop_gate.py", stop(effort="high"))
        written = self.r.hooks_state()
        assert written is not None
        self.assertEqual(written.get("last_effort"), "high")
        code, envelope, _ = S.run_exec(["status"], self.r.path, self.r.env)
        self.assertEqual(code, 0, envelope)
        self.assertEqual((self.r.hooks_state() or {}).get("last_effort"), "high")
        self.r.set_hooks_state(last_effort="turbo")  # positive control: an invalid value is caught by status
        code, envelope, _ = S.run_exec(["status"], self.r.path, self.r.env)
        self.assertEqual(code, 1, envelope)
        self.assertEqual([(e["code"], e.get("path")) for e in envelope["errors"]],
                         [("E_STATE_INVALID", "/last_effort")])

    def test_recorded_effort_follows_the_latest_payload(self) -> None:
        root = B.skill_copy_with_last_effort(self.r.tmp.root / "skill-revision-4")
        registry = schema.Registry(root / "assets" / "schemas")

        def run(script: str, payload: dict) -> None:
            B.run_hook_from(root, self.r, script, payload)

        steps: list[tuple[str, str, dict, object]] = [
            ("owner prompt", "user_prompt.py", up(effort="medium"), "medium"),
            ("stop", "stop_gate.py", stop(effort="xhigh"), "xhigh"),
            ("session start", "session_start.py", ss(effort="high"), "high"),
            ("an agent's prompt", "user_prompt.py", up(effort="low", agent_id="agent-7",
                                                       agent_type="execution-implementer"), "high"),
            ("another session", "user_prompt.py", up(effort="low", session_id="sess-other"), "high"),
            ("a task notification", "user_prompt.py", up(effort="low", prompt="<task-notification x>"), "high"),
            ("a stop without the field", "stop_gate.py", stop(effort=S.ABSENT), "high"),
            ("an unknown level", "user_prompt.py", up(effort="turbo"), "<absent>"),
            ("upper case", "stop_gate.py", stop(effort="XHIGH"), "xhigh"),
        ]
        for name, script, payload, expected in steps:
            with self.subTest(step=name):
                run(script, payload)
                self.assertEqual(self.last(), expected)
                hs = self.r.hooks_state()
                self.assertTrue(schema.validate(hs, "local-state#/$defs/hooks_state", registry=registry).ok, hs)
        self.assertIsNotNone((self.r.hooks_state() or {}).get("last_stop_utc"))  # the stop gate's own fields kept
        self.assertFalse(self.r.layout.hook_errors.exists())  # no hook failed open on the way
        # why the gate exists: without the key in the schema, the same file is one `exec.py status` would refuse
        if not schema_lists_last_effort(S.SKILL_DIR / "assets" / "schemas"):
            self.assertFalse(schema.validate(self.r.hooks_state(), "local-state#/$defs/hooks_state").ok)


if __name__ == "__main__":
    unittest.main()
