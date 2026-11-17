"""The hook launcher as the agent definitions and the settings call it (contract/HOOKS.md 11.4 and 12, TESTS.md
4.5, LANES.md B08): `bash "<abs>/scripts/hooks/py.sh" pre_tool_guard.py --as <agent>` decides the same with
MSYS_NO_PATHCONV=1 set and unset; a missing hook script exits 0 (never 2: 2 means "block"); a launcher path with a
space works; PYTHONUTF8=1 reaches the script; the script runs without site (-S).

Run: python -m unittest discover -s scripts/tests -p "test_agent_hook_command.py" -v
"""
from __future__ import annotations

import shutil
import subprocess
import unittest

import _support as S
import _support_B08 as B
from execlib import procutil


@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class AgentHookCommand(unittest.TestCase):
    def setUp(self) -> None:
        self.bash = procutil.git_bash()
        self.tmp = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def launch(self, launcher: str, args: list[str], data: bytes, env: dict) -> subprocess.CompletedProcess:
        assert self.bash is not None
        return subprocess.run([self.bash, launcher, *args], input=data, capture_output=True, env=env, timeout=60)

    def test_as_flag_with_and_without_msys_no_pathconv(self) -> None:
        r = B.HookRepo()
        try:
            doc = B.fill(S.payload("pre_tool.agent", tool_name="Write",
                                   tool_input={"file_path": ".execution/plan.json", "content": "x"}), r.path)
            launcher = (S.SCRIPTS_DIR / "hooks" / "py.sh").as_posix()
            import json
            data = json.dumps(doc).encode("utf-8")
            outs = []
            for value in ("1", None):
                env = B.env_with(MSYS_NO_PATHCONV=value)
                proc = self.launch(launcher, ["pre_tool_guard.py", "--as", "execution-implementer"], data, env)
                self.assertEqual(proc.returncode, 0, proc.stderr)
                outs.append(proc.stdout)
            self.assertEqual(outs[0], outs[1])
            self.assertIn(b'"permissionDecision": "deny"', outs[0])
            self.assertIn(b"E_GUARD_STATE_PATH", outs[0])
            ok = B.fill(S.payload("pre_tool.agent", tool_name="Write",
                                  tool_input={"file_path": "src/t1/a.mjs", "content": "x"}), r.path)
            proc = self.launch(launcher, ["pre_tool_guard.py", "--as", "execution-implementer"],
                               json.dumps(ok).encode("utf-8"), B.env_with())
            self.assertEqual(proc.stdout, b"")  # positive control: the allowed neighbour passes
        finally:
            r.cleanup()

    def test_missing_script_exits_zero(self) -> None:
        launcher = (S.SCRIPTS_DIR / "hooks" / "py.sh").as_posix()
        proc = self.launch(launcher, ["no_such_hook.py"], b"{}", B.env_with())
        self.assertEqual(proc.returncode, 0)
        self.assertEqual(proc.stdout, b"")

    def test_space_in_path_pythonutf8_and_no_site(self) -> None:
        root = self.tmp / "dir with space" / "scripts"
        (root / "hooks").mkdir(parents=True)
        (root / "execlib").mkdir()
        shutil.copy(S.SCRIPTS_DIR / "hooks" / "py.sh", root / "hooks" / "py.sh")
        S.write_text(root / "hooks" / "probe_env.py",
                     "import os, sys\n"
                     "sys.stdout.write(os.environ.get('PYTHONUTF8', '-') + ' ' + str(sys.flags.no_site) + '\\n')\n")
        proc = self.launch((root / "hooks" / "py.sh").as_posix(), ["probe_env.py"], b"", B.env_with(PYTHONUTF8=None))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.decode().strip(), "1 1")


if __name__ == "__main__":
    unittest.main()
