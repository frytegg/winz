"""Regression tests for the hook COMMAND lines in SKILL.md (not hook_guard.py itself).

The first real-session pilot (2026-09-24) showed that the launcher can fail even when
hook_guard.py is correct: CLAUDE_SKILL_DIR was unset in the hook environment, the
"$HOME/.claude/..." fallback reached Windows Python as "/c/Users/..." because
MSYS_NO_PATHCONV=1 disabled Git Bash path conversion, Python exited 2 ("can't open
file"), and exit 2 means "block" for a PreToolUse hook, so every tool call was refused.

These tests run the exact frontmatter command through the same shell Claude Code uses
(Git Bash on Windows, sh elsewhere) and require:
  - a harmless tool call outside a run: exit 0;
  - the canary inside a run: exit 2 (proves the launcher found and ran hook_guard.py),
    with CLAUDE_SKILL_DIR unset and MSYS_NO_PATHCONV=1 set;
  - a missing hook script: exit 0 (fail open; the canary then fails and the run stays
    report-only), never exit 2.

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
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

import gates  # noqa: E402  (reuse its Git Bash locator: never the WSL launcher)


def hook_commands() -> List[str]:
    """Every `command: '...'` line of the SKILL.md frontmatter, unquoted."""
    text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    front = text.split("---", 2)[1]
    return [m.group(1) for m in re.finditer(r"^\s*command:\s*'(.*)'\s*$", front, re.M)]


def shell() -> Optional[List[str]]:
    if os.name == "nt":
        bash = gates.find_git_bash()
        return [bash, "-c"] if bash else None
    return ["/bin/sh", "-c"]


def run(cmd: str, payload: Dict[str, object], env_over: Dict[str, Optional[str]]) -> subprocess.CompletedProcess:
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


def posix_home() -> str:
    """HOME as Git Bash sees it (/c/Users/...), the form that broke the pilot."""
    home = str(Path.home())
    if os.name == "nt" and re.match(r"^[A-Za-z]:", home):
        return "/" + home[0].lower() + home[2:].replace("\\", "/")
    return home


@unittest.skipIf(shell() is None, "no Git Bash / sh available")
class HookCommandTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cmds = hook_commands()
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-hookcmd-"))
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        # The real skill must be reachable through the $HOME fallback for these tests.
        self.home_ok = (Path.home() / ".claude" / "skills" / "harden" / "scripts" / "hook_guard.py").is_file()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def payload(self, command: str) -> Dict[str, object]:
        return {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": self.repo.as_posix(),
                "permission_mode": "default", "tool_input": {"command": command}}

    def test_two_hook_commands_present(self) -> None:
        self.assertEqual(len(self.cmds), 2, self.cmds)

    def test_harmless_call_outside_a_run_is_allowed(self) -> None:
        for cmd in self.cmds[:1]:
            for pathconv in (None, "1"):
                with self.subTest(msys_no_pathconv=pathconv):
                    res = run(cmd, self.payload("git status"), {
                        "CLAUDE_SKILL_DIR": str(SKILL_DIR), "CLAUDE_PROJECT_DIR": str(self.repo),
                        "MSYS_NO_PATHCONV": pathconv})
                    self.assertEqual(res.returncode, 0, res.stderr)

    def _start_marker(self) -> None:
        env = dict(os.environ, TMPDIR=str(self.tmp), TEMP=str(self.tmp), TMP=str(self.tmp))
        (self.repo / "f.txt").write_text("x\n", encoding="utf-8", newline="\n")
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=t", "-c", "user.email=t@t",
                        "commit", "-q", "-m", "init"], check=True)
        res = subprocess.run([sys.executable, str(SCRIPTS / "run_state.py"), "start", "--mode", "report-only",
                              "--repo", str(self.repo)], capture_output=True, text=True, env=env)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_canary_is_refused_with_skill_dir_unset_and_pathconv_off(self) -> None:
        if not self.home_ok:
            self.skipTest("skill not installed under ~/.claude/skills/harden")
        self._start_marker()
        for cmd in self.cmds[:1]:
            for pathconv in (None, "1"):
                with self.subTest(msys_no_pathconv=pathconv):
                    res = run(cmd, self.payload("echo HARDEN_HOOK_CANARY"), {
                        "CLAUDE_SKILL_DIR": None, "CLAUDE_PROJECT_DIR": str(self.repo),
                        "HOME": posix_home(), "MSYS_NO_PATHCONV": pathconv})
                    self.assertEqual(res.returncode, 2, res.stdout + res.stderr)
                    self.assertIn("canary", res.stderr)

    def test_missing_hook_script_fails_open(self) -> None:
        self._start_marker()
        missing = self.tmp / "no-such-skill"
        for cmd in self.cmds:
            with self.subTest(cmd=cmd[:40]):
                res = run(cmd, self.payload("echo HARDEN_HOOK_CANARY"), {
                    "CLAUDE_SKILL_DIR": str(missing), "CLAUDE_PROJECT_DIR": str(self.repo),
                    "MSYS_NO_PATHCONV": "1"})
                self.assertNotEqual(res.returncode, 2, "a launcher failure must never block (exit 2)")


if __name__ == "__main__":
    unittest.main()
