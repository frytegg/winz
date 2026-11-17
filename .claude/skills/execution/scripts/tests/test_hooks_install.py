"""`exec.py hooks install | canary | uninstall` (contract/HOOKS.md 11, 13.1, CLI.md 1, TESTS.md 4.5, LANES.md B08).

Foreign entries keep their values and order (byte-identical after uninstall for a file in the canonical 2-space
form); tagged entries are replaced idempotently (install twice: identical file); `switchModelsOnFlag` is saved and
restored (absent stays absent, false stays false); the orchestrator's effort (contract revision 4) is set to xhigh
for every model id of the user-level `modelSettings` plus claude-opus-5-5 and put back exactly by uninstall (a value
in place, an absent key, entry or `modelSettings` absent again; a non-object value never replaced); the exclude lines
are added once; an invalid settings file is never overwritten (exit 1 E_SETTINGS_INVALID), nor a malformed effort
backup; the marker gets a fresh 16-hex nonce and `session_id: null`; every command is the absolute py.sh launcher
with the tag; the canary passes after a real binding by the guard and fails before it.

Run: python -m unittest discover -s scripts/tests -p "test_hooks_install.py" -v
"""
from __future__ import annotations

import json
import re
import unittest

import _support as S
import _support_B08 as B
from execlib import hooksinstall, jsonio, paths
from execlib.log import get_logger
from execlib.model import Ctx

FOREIGN = {
    "permissions": {"allow": ["Bash(git status)"]},
    "hooks": {
        "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "python foreign_guard.py"}]}],
        "Notification": [{"hooks": [{"type": "command", "command": "notify.sh"}]}],
    },
}


def canonical_text(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


class HooksInstall(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = S.TempRepo()
        code, env, _ = S.run_exec(["init", "--project", "queue-clock", "--executor", "A"], cwd=self.repo.path)
        self.assertEqual(code, 0, env)
        self.layout = paths.layout_for(self.repo.path, None)
        self.settings = self.repo.path / ".claude" / "settings.local.json"
        self.backup = self.layout.local / "settings-backup.json"
        self.cfg = self.repo.root / "claude-config"  # this test's own user-level settings dir (empty by default)
        self.cfg.mkdir()

    def tearDown(self) -> None:
        self.repo.cleanup()

    def run_cmd(self, *args: str, env: dict | None = None) -> tuple[int, dict]:
        code, envelope, _ = S.run_exec(list(args), cwd=self.repo.path, env=env)
        return code, envelope

    def cfg_env(self) -> dict:
        return S.env_isolated(CLAUDE_CONFIG_DIR=str(self.cfg))

    def run_cfg(self, *args: str) -> tuple[int, dict]:
        return self.run_cmd(*args, env=self.cfg_env())

    def test_entries_shape(self) -> None:
        block = hooksinstall.entries(S.SKILL_DIR, True)
        self.assertEqual(list(block), ["Stop", "StopFailure", "SessionStart", "SessionEnd", "PreToolUse",
                                       "UserPromptSubmit"])
        rx = re.compile(r'^bash "' + re.escape(S.SKILL_DIR.as_posix()) + r'/scripts/hooks/py\.sh" '
                        r'(stop_gate|stop_failure|session_start|session_end|pre_tool_guard|user_prompt)\.py '
                        r'# execution-hook v1$')
        for event, groups in block.items():
            self.assertEqual(len(groups), 1)
            hook = groups[0]["hooks"][0]
            self.assertRegex(hook["command"], rx)
            self.assertNotIn("CLAUDE_SKILL_DIR", hook["command"])
            self.assertEqual(hook["timeout"], 10)
        self.assertEqual(block["SessionStart"][0]["matcher"], "startup|resume|clear|compact")
        self.assertIn("WebFetch", block["PreToolUse"][0]["matcher"])
        self.assertIn("mcp__.*", block["PreToolUse"][0]["matcher"])
        self.assertNotIn("UserPromptSubmit", hooksinstall.entries(S.SKILL_DIR, False))

    def test_foreign_entries_kept_and_restored(self) -> None:
        original = canonical_text(FOREIGN)
        S.write_text(self.settings, original)
        code, env = self.run_cmd("hooks", "install")
        self.assertEqual(code, 0, env)
        doc = json.loads(self.settings.read_text(encoding="utf-8"))
        self.assertEqual(doc["permissions"], FOREIGN["permissions"])
        self.assertEqual(doc["hooks"]["PreToolUse"][0], FOREIGN["hooks"]["PreToolUse"][0])
        self.assertEqual(doc["hooks"]["Notification"], FOREIGN["hooks"]["Notification"])
        self.assertEqual(list(doc["hooks"])[:2], ["PreToolUse", "Notification"])
        self.assertTrue(doc["switchModelsOnFlag"])
        first = self.settings.read_bytes()
        code, env2 = self.run_cmd("hooks", "install")
        self.assertEqual(code, 0)
        self.assertEqual(self.settings.read_bytes(), first)  # idempotent: identical file
        self.assertEqual(len(doc["hooks"]["Stop"]), 1)
        code, env3 = self.run_cmd("hooks", "uninstall")
        self.assertEqual(code, 0, env3)
        self.assertEqual(self.settings.read_text(encoding="utf-8"), original)
        self.assertTrue(env3["data"]["settings_restored"])
        self.assertFalse(self.layout.active.exists())
        code, env4 = self.run_cmd("hooks", "uninstall")  # idempotent
        self.assertEqual(code, 0)
        self.assertEqual(self.settings.read_text(encoding="utf-8"), original)

    def test_switch_models_flag_false_restored(self) -> None:
        S.write_text(self.settings, canonical_text({"switchModelsOnFlag": False}))
        self.run_cmd("hooks", "install")
        self.run_cmd("hooks", "install")  # a second install must not back up our own true
        self.assertTrue(json.loads(self.settings.read_text(encoding="utf-8"))["switchModelsOnFlag"])
        self.run_cmd("hooks", "uninstall")
        self.assertEqual(json.loads(self.settings.read_text(encoding="utf-8")), {"switchModelsOnFlag": False})

    def test_absent_settings_file(self) -> None:
        code, env = self.run_cmd("hooks", "install", "--no-prompt-hook")
        self.assertEqual(code, 0)
        doc = json.loads(self.settings.read_text(encoding="utf-8"))
        self.assertNotIn("UserPromptSubmit", doc["hooks"])
        self.assertEqual(env["data"]["entries_added"], ["Stop", "StopFailure", "SessionStart", "SessionEnd",
                                                        "PreToolUse"])
        self.run_cmd("hooks", "uninstall")
        self.assertEqual(json.loads(self.settings.read_text(encoding="utf-8")), {})

    def test_invalid_settings_never_overwritten(self) -> None:
        S.write_text(self.settings, '{"hooks": {"Stop": [}\n')
        before = self.settings.read_bytes()
        code, env = self.run_cfg("hooks", "install")
        self.assertEqual(code, 1)
        self.assertEqual(env["errors"][0]["code"], "E_SETTINGS_INVALID")
        self.assertEqual(self.settings.read_bytes(), before)
        self.assertFalse(self.backup.exists())  # refused before any write, the effort backup included
        S.write_text(self.settings, "[]\n")
        code, env = self.run_cfg("hooks", "install")
        self.assertEqual(code, 1)
        self.assertFalse(self.backup.exists())
        S.write_text(self.settings, "{}\n")  # positive control: a valid file is merged
        self.assertEqual(self.run_cfg("hooks", "install")[0], 0)
        self.assertTrue(self.backup.exists())
        self.assertEqual(json.loads(self.settings.read_text(encoding="utf-8"))["modelSettings"],
                         {"claude-opus-5-5": {"effortLevel": "xhigh"}})

    # contract revision 4: the orchestrator runs at xhigh; uninstall puts the previous values back exactly
    def test_effort_xhigh_set_and_previous_values_restored(self) -> None:
        user_settings = {"effortLevel": "high", "modelSettings": {"claude-opus-5-5": {"effortLevel": "medium"},
                                                                  "claude-sonnet-5-5": {"effortLevel": "low"}}}
        S.write_text(self.cfg / "settings.json", canonical_text(user_settings))
        user_bytes = (self.cfg / "settings.json").read_bytes()
        project = {**FOREIGN, "modelSettings": {"claude-opus-5-5": {"effortLevel": "high", "alwaysThinking": True},
                                                "claude-haiku-5": {"effortLevel": "low"}}}
        original = canonical_text(project)
        S.write_text(self.settings, original)
        code, env = self.run_cfg("hooks", "install")
        self.assertEqual(code, 0, env)
        self.assertEqual((env["data"]["effort_level"], env["data"]["effort_models"], env["data"]["effort_skipped"]),
                         ("xhigh", ["claude-opus-5-5", "claude-sonnet-5-5"], []))
        models = json.loads(self.settings.read_text(encoding="utf-8"))["modelSettings"]
        self.assertEqual(models, {"claude-opus-5-5": {"effortLevel": "xhigh", "alwaysThinking": True},
                                  "claude-haiku-5": {"effortLevel": "low"},
                                  "claude-sonnet-5-5": {"effortLevel": "xhigh"}})
        self.assertEqual(list(models), ["claude-opus-5-5", "claude-haiku-5", "claude-sonnet-5-5"])
        self.assertEqual(list(models["claude-opus-5-5"]), ["effortLevel", "alwaysThinking"])  # value set in place
        self.assertEqual((self.cfg / "settings.json").read_bytes(), user_bytes)  # the user-level file is only read
        record = jsonio.read_json(self.backup)
        self.assertEqual(record["models"], {
            "claude-opus-5-5": {"entry_present": True, "effort_present": True, "effort_value": "high"},
            "claude-sonnet-5-5": {"entry_present": False, "effort_present": False, "effort_value": None}})
        self.assertTrue(record["model_settings_present"])
        # a second install changes nothing: our own xhigh is never recorded as the previous value
        first, first_record = self.settings.read_bytes(), self.backup.read_bytes()
        self.assertEqual(self.run_cfg("hooks", "install")[0], 0)
        self.assertEqual((self.settings.read_bytes(), self.backup.read_bytes()), (first, first_record))
        code, env = self.run_cfg("hooks", "uninstall")
        self.assertEqual(code, 0, env)
        self.assertEqual(self.settings.read_text(encoding="utf-8"), original)  # byte for byte
        self.assertEqual(env["data"]["effort_restored"], ["claude-opus-5-5", "claude-sonnet-5-5"])
        self.assertTrue(env["data"]["settings_restored"])
        self.assertFalse(self.backup.exists())

    def test_effort_absent_values_stay_absent(self) -> None:
        cases = {
            "no modelSettings": ({"permissions": {"allow": []}},
                                 {"claude-opus-5-5": {"effortLevel": "xhigh"}}, []),
            "no entry for the model": ({"modelSettings": {"claude-haiku-5": {"effortLevel": "low"}}},
                                       {"claude-haiku-5": {"effortLevel": "low"},
                                        "claude-opus-5-5": {"effortLevel": "xhigh"}}, []),
            "no effortLevel": ({"modelSettings": {"claude-opus-5-5": {"alwaysThinking": True}}},
                               {"claude-opus-5-5": {"alwaysThinking": True, "effortLevel": "xhigh"}}, []),
            "an entry that is not an object": ({"modelSettings": {"claude-opus-5-5": "kept as it is"}},
                                               {"claude-opus-5-5": "kept as it is"}, ["claude-opus-5-5"]),
            "modelSettings not an object": ({"modelSettings": ["kept", "as", "it", "is"]},
                                            ["kept", "as", "it", "is"], ["claude-opus-5-5"]),
        }
        for name, (project, after_install, skipped) in cases.items():
            with self.subTest(case=name):
                original = canonical_text(project)
                S.write_text(self.settings, original)
                code, env = self.run_cfg("hooks", "install")
                self.assertEqual(code, 0, env)
                self.assertEqual(json.loads(self.settings.read_text(encoding="utf-8"))["modelSettings"],
                                 after_install)
                self.assertEqual(env["data"]["effort_skipped"], skipped)
                code, env = self.run_cfg("hooks", "uninstall")
                self.assertEqual(code, 0, env)
                self.assertEqual(self.settings.read_text(encoding="utf-8"), original)  # absent stays absent
                self.assertFalse(self.backup.exists())

    def test_malformed_effort_backup_is_never_replaced(self) -> None:
        S.write_text(self.settings, "{}\n")
        S.write_text(self.backup, '{"models": "not a record"}\n')
        before = (self.settings.read_bytes(), self.backup.read_bytes())
        code, env = self.run_cfg("hooks", "install")
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_STATE_INVALID"))
        self.assertEqual((self.settings.read_bytes(), self.backup.read_bytes()), before)
        self.assertEqual(self.run_cfg("hooks", "uninstall")[0], 1)
        self.assertEqual((self.settings.read_bytes(), self.backup.read_bytes()), before)
        self.backup.unlink()  # positive control: without it the same install goes through
        self.assertEqual(self.run_cfg("hooks", "install")[0], 0)

    def test_unreadable_user_settings_use_the_default_model_id(self) -> None:
        S.write_text(self.cfg / "settings.json", '{"modelSettings": {"claude-sonnet-5-5": \n')
        S.write_text(self.settings, "{}\n")
        code, env, logs = S.run_exec(["hooks", "install"], cwd=self.repo.path, env=self.cfg_env())
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["effort_models"], ["claude-opus-5-5"])
        self.assertTrue(any(log["level"] == "warning" and "user-level settings" in log["msg"] for log in logs), logs)
        self.run_cfg("hooks", "uninstall")
        # positive control: the same file made valid adds its model id
        S.write_text(self.cfg / "settings.json", '{"modelSettings": {"claude-sonnet-5-5": {}}}\n')
        code, env = self.run_cfg("hooks", "install")
        self.assertEqual(env["data"]["effort_models"], ["claude-opus-5-5", "claude-sonnet-5-5"])

    def test_marker_and_excludes(self) -> None:
        code, env = self.run_cmd("hooks", "install")
        marker = jsonio.read_json(self.layout.active)
        self.assertRegex(marker["bind_nonce"], r"^[0-9a-f]{16}$")
        self.assertEqual(env["data"]["nonce"], marker["bind_nonce"])
        self.assertIsNone(marker["session_id"])
        self.assertIn(f"hooks canary --nonce {marker['bind_nonce']}", env["data"]["next"][1])
        # unbound: a new install writes a fresh nonce; bound: the marker is left as is
        self.run_cmd("hooks", "install")
        second = jsonio.read_json(self.layout.active)["bind_nonce"]
        self.assertNotEqual(second, marker["bind_nonce"])
        bound = jsonio.read_json(self.layout.active)
        bound["session_id"] = S.SESSION_ID
        jsonio.write_json_atomic(self.layout.active, bound)
        before = self.layout.active.read_bytes()
        self.run_cmd("hooks", "install")
        self.assertEqual(self.layout.active.read_bytes(), before)
        exclude = (self.repo.path / ".git" / "info" / "exclude").read_text(encoding="utf-8").split("\n")
        for line in (".execution/", ".claude/settings.local.json", ".claude/worktrees/"):
            self.assertEqual(exclude.count(line), 1, line)
        st = jsonio.read_json(self.layout.local_state)
        self.assertEqual(st["hooks"]["installed_utc"], S.FIXED_NOW)

    @unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
    def test_canary_after_binding(self) -> None:
        code, env = self.run_cmd("hooks", "install")
        nonce = env["data"]["nonce"]
        code1, env1 = self.run_cmd("hooks", "canary", "--nonce", nonce)
        self.assertEqual(code1, 1)  # not bound yet (negative, before the hook ran)
        self.assertFalse(env1["data"]["bound"])
        cmd = f'python "{S.EXEC_PY.as_posix()}" hooks canary --nonce {nonce}'
        doc = B.fill(S.payload("pre_tool.base", tool_input={"command": cmd}), self.repo.path)
        code_h, out, err, _ms = S.run_hook("pre_tool_guard.py", doc, cwd=self.repo.path)
        self.assertEqual((code_h, out), (0, b""), err)
        code2, env2 = self.run_cmd("hooks", "canary", "--nonce", nonce)
        self.assertEqual(code2, 0, env2)
        self.assertTrue(env2["data"]["bound"])
        self.assertEqual(env2["data"]["session_id"], S.SESSION_ID)
        self.assertEqual(env2["data"]["env_session_id"], S.SESSION_ID)
        self.assertEqual(env2["data"]["permission_mode"], "bypassPermissions")
        self.assertEqual(jsonio.read_json(self.layout.local_state)["hooks"]["canary_ok_utc"], S.FIXED_NOW)
        # another session's environment: bound to another session -> exit 1
        code3, env3 = self.run_cmd("hooks", "canary", "--nonce", nonce, env=S.env_isolated(
            CLAUDE_CODE_SESSION_ID="sess-other"))
        self.assertEqual(code3, 1)
        self.assertIn("resume --takeover", json.dumps(env3["errors"]))
        # more than 5 minutes later: the event is stale
        code4, _ = self.run_cmd("hooks", "canary", "--nonce", nonce,
                                env=S.env_isolated(EXEC_NOW="2026-10-03T07:18:00Z"))
        self.assertEqual(code4, 1)

    @unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
    def test_canary_refuses_other_permission_mode(self) -> None:
        code, env = self.run_cmd("hooks", "install")
        nonce = env["data"]["nonce"]
        cmd = f'python "{S.EXEC_PY.as_posix()}" hooks canary --nonce {nonce}'
        doc = B.fill(S.payload("pre_tool.base", tool_input={"command": cmd}, permission_mode="default"),
                     self.repo.path)
        S.run_hook("pre_tool_guard.py", doc, cwd=self.repo.path)
        code2, env2 = self.run_cmd("hooks", "canary", "--nonce", nonce)
        self.assertEqual(code2, 1)
        self.assertIn("bypassPermissions", json.dumps(env2["errors"]))

    def test_canary_function_returns_one_dict(self) -> None:
        """MODULES.md 5: canary(ctx, nonce) -> dict, with `ok` and the failed checks under `problems`."""
        code, env = self.run_cmd("hooks", "install")
        self.assertEqual(code, 0, env)
        nonce = env["data"]["nonce"]
        ctx = Ctx(layout=self.layout, executor="A", now=S.fixed_now(), by="orchestrator", pretty=False,
                  command="hooks canary", log=get_logger("execlib.hooksinstall"))
        keys = {"bound", "session_id", "env_session_id", "permission_mode", "hook_seen_utc", "latency_ms", "ok",
                "problems"}
        with S.patched_env(CLAUDE_CODE_SESSION_ID=S.SESSION_ID, EXEC_TEST="1", EXEC_NOW=S.FIXED_NOW):
            unbound = hooksinstall.canary(ctx, "0" * 16)  # negative: wrong nonce and not bound
            self.assertIsInstance(unbound, dict)
            self.assertEqual(set(unbound), keys)
            self.assertFalse(unbound["ok"])
            self.assertEqual([p["code"] for p in unbound["problems"]], ["E_CHECK", "E_CHECK"])
            self.assertIn("bind nonce", unbound["problems"][0]["message"])
            self.assertIn("not bound", unbound["problems"][1]["message"])
            self.assertIsNone(jsonio.read_json(self.layout.local_state)["hooks"]["canary_ok_utc"])
            marker = jsonio.read_json(self.layout.active)
            marker["session_id"] = S.SESSION_ID
            jsonio.write_json_atomic(self.layout.active, marker)
            jsonio.write_json_atomic(self.layout.hook_events_dir / "canary-1.json", {
                "type": "hooks.canary", "ts": S.FIXED_NOW,
                "data": {"bound": True, "session_id": S.SESSION_ID, "permission_mode": "bypassPermissions",
                         "latency_ms": 12}})
            bound = hooksinstall.canary(ctx, nonce)  # positive control: bound, fresh event, bypass mode
        self.assertEqual(set(bound), keys)
        self.assertTrue(bound["ok"], bound)
        self.assertEqual(bound["problems"], [])
        self.assertEqual((bound["session_id"], bound["permission_mode"], bound["latency_ms"]),
                         (S.SESSION_ID, "bypassPermissions", 12))
        self.assertEqual(jsonio.read_json(self.layout.local_state)["hooks"]["canary_ok_utc"], S.FIXED_NOW)
        # The CLI keeps its envelope: `ok` and `problems` never reach data; the problems become the errors.
        code2, env2 = self.run_cmd("hooks", "canary", "--nonce", "0" * 16)
        self.assertEqual(code2, 1)
        self.assertNotIn("problems", env2["data"])
        self.assertNotIn("ok", env2["data"])
        self.assertEqual([e["code"] for e in env2["errors"]], ["E_CHECK"])


if __name__ == "__main__":
    unittest.main()
