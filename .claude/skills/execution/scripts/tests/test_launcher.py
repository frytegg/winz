"""The launchers `assets/launcher/launch-exec.ps1` and `launch-exec.sh` (contract/LANES.md B08, HOOKS.md 12, CLI.md
resume), with a fake `claude` on PATH that logs its argv and environment: a version older than 2.1.286 is refused
before claude starts; DISABLE_AUTOUPDATER unset is refused; a start runs `claude --remote-control "<proj>-exec" -n
"<proj>-exec" --dangerously-skip-permissions` with MSYS_NO_PATHCONV=1, CLAUDE_CODE_RETRY_WATCHDOG=1, the profile's
workflow concurrency and CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH=60000; -Resume / --resume runs `claude --resume
"<proj>-exec" --dangerously-skip-permissions` with the same environment.

Run: python -m unittest discover -s scripts/tests -p "test_launcher.py" -v
"""
from __future__ import annotations

import json
import os
import subprocess
import unittest

import _support as S
from execlib import procutil

FAKE_CLAUDE = r"""
import json, os, sys
log = os.environ["FAKE_CLAUDE_LOG"]
if sys.argv[1:] == ["--version"]:
    print(os.environ.get("FAKE_CLAUDE_VERSION", "2.1.286") + " (Claude Code)")
    sys.exit(0)
keys = ["MSYS_NO_PATHCONV", "CLAUDE_CODE_RETRY_WATCHDOG", "CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS",
        "CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH", "PYTHONUTF8"]
with open(log, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({"argv": sys.argv[1:], "env": {k: os.environ.get(k) for k in keys},
                         "cwd": os.getcwd().replace("\\", "/")}) + "\n")
"""

# The profile's workflow_concurrency differs from the launchers' fallback (6), so the test proves the profile is read.
PROFILE_CONCURRENCY = 4
FALLBACK_CONCURRENCY = "6"
EXPECTED_ENV = {"MSYS_NO_PATHCONV": "1", "CLAUDE_CODE_RETRY_WATCHDOG": "1",
                "CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS": str(PROFILE_CONCURRENCY),
                "CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH": "60000", "PYTHONUTF8": "1"}
START = ["--remote-control", "queue-clock-exec", "-n", "queue-clock-exec", "--dangerously-skip-permissions"]
RESUME = ["--resume", "queue-clock-exec", "--dangerously-skip-permissions"]


class LauncherCase(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = S.TempRepo()
        prof = S.build_profile()
        prof["machine"]["workflow_concurrency"] = PROFILE_CONCURRENCY
        self.profile_path = self.repo.path / ".execution" / "profile.json"
        S.write_json(self.profile_path, prof)
        self.bin = self.repo.root / "bin"
        S.fake_tool(self.bin, "claude", FAKE_CLAUDE)
        self.log = self.repo.root / "claude-log.jsonl"

    def tearDown(self) -> None:
        self.repo.cleanup()

    def env(self, **over: object) -> dict[str, str]:
        base = S.path_with(self.bin, S.env_isolated(FAKE_CLAUDE_LOG=str(self.log), DISABLE_AUTOUPDATER="1",
                                                     MSYS_NO_PATHCONV=None, CLAUDE_CODE_RETRY_WATCHDOG=None))
        for k, v in over.items():
            if v is None:
                base.pop(k, None)
            else:
                base[k] = str(v)
        return base

    def calls(self) -> list[dict]:
        if not self.log.exists():
            return []
        return [json.loads(ln) for ln in self.log.read_text(encoding="utf-8").splitlines() if ln.strip()]

    def run_launcher(self, args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
        raise NotImplementedError

    def check_all(self, resume_flag: str) -> None:
        proc = self.run_launcher([], self.env(FAKE_CLAUDE_VERSION="2.1.285"))
        self.assertEqual(proc.returncode, 3, proc.stderr)
        self.assertEqual(self.calls(), [])  # refused before claude started
        proc = self.run_launcher([], self.env(DISABLE_AUTOUPDATER=None))
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertEqual(self.calls(), [])
        proc = self.run_launcher([], self.env())
        self.assertEqual(proc.returncode, 0, proc.stderr)
        start = self.calls()[-1]
        self.assertEqual(start["argv"], START)
        self.assertEqual(start["env"], EXPECTED_ENV)
        self.assertEqual(start["cwd"].lower(), self.repo.path.as_posix().lower())
        proc = self.run_launcher([resume_flag], self.env())
        self.assertEqual(proc.returncode, 0, proc.stderr)
        resume = self.calls()[-1]
        self.assertEqual(resume["argv"], RESUME)
        self.assertEqual(resume["env"], start["env"])
        # control: without the profile value the launcher falls back to 6, so the 4 above came from the profile
        prof = json.loads(self.profile_path.read_text(encoding="utf-8"))
        del prof["machine"]["workflow_concurrency"]
        S.write_json(self.profile_path, prof)
        proc = self.run_launcher([], self.env())
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.calls()[-1]["env"]["CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS"], FALLBACK_CONCURRENCY)


@unittest.skipUnless(os.name == "nt", "launch-exec.ps1 is the Windows launcher")
class PowerShellLauncher(LauncherCase):
    def run_launcher(self, args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
        script = S.SKILL_DIR / "assets" / "launcher" / "launch-exec.ps1"
        return subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                               "-File", str(script), *args], cwd=str(self.repo.path), env=env, capture_output=True,
                              timeout=120)

    def test_launcher(self) -> None:
        self.check_all("-Resume")


@unittest.skipUnless(procutil.git_bash() is not None, "Git Bash is needed")
class BashLauncher(LauncherCase):
    def run_launcher(self, args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess:
        script = (S.SKILL_DIR / "assets" / "launcher" / "launch-exec.sh").as_posix()
        bash = procutil.git_bash()
        assert bash is not None
        return subprocess.run([bash, script, *args], cwd=str(self.repo.path), env=env, capture_output=True,
                              timeout=120)

    def test_launcher(self) -> None:
        self.check_all("--resume")


if __name__ == "__main__":
    unittest.main()
