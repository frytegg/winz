"""Regression tests for the hook COMMAND lines of the harden agent templates.

The agents' own hooks (assets/agents/*.md, rendered by harden_agents.py) use the same fail-open
launcher as SKILL.md's frontmatter (test_hook_command.py): cygpath when present, python3 with a
python fallback for the Microsoft Store stub, and exit 0 when the script is missing, because
exit 2 would block a PreToolUse call or keep a subagent from stopping (pilot-auto-calibration
A01-F42, A01-F45). These tests run each rendered command through the shell Claude Code uses
(Git Bash on Windows, sh elsewhere) with every CLAUDE* variable removed, MSYS_NO_PATHCONV unset
and then set to 1, and a skill directory whose path holds a space.

Run: python -m unittest discover -s scripts/tests -p "test_agent_hook_command.py" -v
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List, Optional

SCRIPTS = Path(__file__).resolve().parent.parent
SKILL_DIR = SCRIPTS.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import gates  # noqa: E402  (its Git Bash locator)
import harden_agents as HA  # noqa: E402
import persist_pass as PP  # noqa: E402


def commands(name: str, skill_dir: str) -> List[str]:
    front, _body = HA.split_front(HA.render(HA.template_text(name), skill_dir))
    return [m.group(1) for m in re.finditer(r"^\s*command:\s*'(.*)'\s*$", front, re.M)]


def shell() -> Optional[List[str]]:
    if os.name == "nt":
        bash = gates.find_git_bash()
        return [bash, "-c"] if bash else None
    return ["/bin/sh", "-c"]


def run(cmd: str, payload: Dict[str, object], env_over: Dict[str, Optional[str]]
        ) -> subprocess.CompletedProcess:
    sh = shell()
    assert sh is not None
    env = dict(os.environ)
    for key in [k for k in env if k.startswith("CLAUDE")]:
        env.pop(key)
    for key, value in env_over.items():
        if value is None:
            env.pop(key, None)
        else:
            env[key] = value
    return subprocess.run(sh + [cmd], input=json.dumps(payload), capture_output=True, text=True,
                          encoding="utf-8", env=env, timeout=60)


@unittest.skipIf(shell() is None, "no Git Bash / sh available")
class AgentHookCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-agenthook-")).resolve()
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        # A skill directory whose path holds a space, with a copy of the scripts.
        self.spaced = self.tmp / "harden skill"
        shutil.copytree(str(SCRIPTS), str(self.spaced / "scripts"),
                        ignore=shutil.ignore_patterns("tests", "__pycache__"))
        self.config = self.tmp / "config"
        (self.config / "agents").mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def skill_dirs(self) -> List[str]:
        return [PP.posix(str(SKILL_DIR.resolve())), PP.posix(str(self.spaced))]

    def start_run(self) -> None:
        env = dict(os.environ, TMPDIR=str(self.tmp), TEMP=str(self.tmp), TMP=str(self.tmp),
                   CLAUDE_CONFIG_DIR=str(self.config))
        (self.repo / "f.txt").write_text("x\n", encoding="utf-8", newline="\n")
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=t", "-c", "user.email=t@t",
                        "commit", "-q", "-m", "init"], check=True)
        res = subprocess.run([sys.executable, str(SCRIPTS / "run_state.py"), "start", "--mode",
                              "report-only", "--repo", str(self.repo)], capture_output=True,
                             text=True, env=env)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def stop_payload(self) -> Dict[str, object]:
        prompts = self.repo / ".harden" / "prompts"
        prompts.mkdir(parents=True, exist_ok=True)
        (prompts / "se-u1-p1.md").write_text("pass-id: se-u1-p1\nkind: lens\n", encoding="utf-8")
        transcript = self.tmp / "agent-a1.jsonl"
        first = {"type": "user", "message": {"content": "pass-id: se-u1-p1\nTask file: {}/"
                                                        ".harden/prompts/se-u1-p1.md. Read it "
                                                        "first and follow it exactly.".format(
                                                            PP.posix(str(self.repo)))}}
        transcript.write_text(json.dumps(first) + "\n", encoding="utf-8")
        return {"hook_event_name": "SubagentStop", "agent_id": "a1", "agent_type": "harden-lens",
                "agent_transcript_path": str(transcript), "cwd": str(self.repo),
                "stop_hook_active": False, "last_assistant_message":
                    'pass-id: se-u1-p1\n{"pass_id": "se-u1-p1", "candidates": []}'}

    def canary_payload(self) -> Dict[str, object]:
        return {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(self.repo),
                "permission_mode": "default", "session_id": "s-1",
                "transcript_path": str(self.tmp / "main.jsonl"), "agent_id": "v1",
                "agent_type": "harden-verifier",
                "tool_input": {"command": "echo HARDEN_HOOK_CANARY"}}

    def test_command_counts(self) -> None:
        self.assertEqual(len(commands("harden-lens", self.skill_dirs()[0])), 1)
        self.assertEqual(len(commands("harden-verifier", self.skill_dirs()[0])), 2)

    def test_persist_command_saves_and_blocks_once(self) -> None:
        self.start_run()
        for skill in self.skill_dirs():
            for pathconv in (None, "1"):
                with self.subTest(skill=skill, msys_no_pathconv=pathconv):
                    saved = self.repo / ".harden" / "passes" / "se-u1-p1.md"
                    if saved.exists():
                        saved.unlink()
                    cmd = commands("harden-lens", skill)[0]
                    res = run(cmd, self.stop_payload(), {"MSYS_NO_PATHCONV": pathconv})
                    self.assertEqual(res.returncode, 0, res.stderr)
                    self.assertTrue(saved.is_file(), res.stdout + res.stderr)
                    self.assertIn('"decision": "block"', res.stdout)

    def test_missing_skill_directory_fails_open(self) -> None:
        self.start_run()
        missing = PP.posix(str(self.tmp / "no-such-skill"))
        for name in ("harden-lens", "harden-verifier"):
            for cmd in commands(name, missing):
                with self.subTest(name=name, cmd=cmd[:50]):
                    res = run(cmd, self.canary_payload(), {"MSYS_NO_PATHCONV": "1"})
                    self.assertNotEqual(res.returncode, 2)

    def test_verifier_guard_refuses_the_canary_inside_a_run(self) -> None:
        self.start_run()
        log = self.repo / ".harden" / "hook_events.log"
        for skill in self.skill_dirs():
            for pathconv in (None, "1"):
                with self.subTest(skill=skill, msys_no_pathconv=pathconv):
                    guard = commands("harden-verifier", skill)[0]
                    res = run(guard, self.canary_payload(), {"MSYS_NO_PATHCONV": pathconv})
                    self.assertEqual(res.returncode, 2, res.stdout + res.stderr)
                    self.assertIn("canary", res.stderr)
                    last = json.loads(log.read_text(encoding="utf-8").strip().split("\n")[-1])
                    self.assertEqual((last["agent_type"], last["agent_id"]),
                                     ("harden-verifier", "v1"))

    def test_guard_command_outside_a_run_allows(self) -> None:
        guard = commands("harden-verifier", self.skill_dirs()[0])[0]
        payload = dict(self.canary_payload())
        payload["tool_input"] = {"command": "git status"}
        res = run(guard, payload, {"MSYS_NO_PATHCONV": "1"})
        self.assertEqual(res.returncode, 0, res.stderr)


if __name__ == "__main__":
    unittest.main()
