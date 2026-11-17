"""Arguments through Git Bash (TESTS.md 4.5 test_exec_argv; CLI.md header; LANES.md B01).

Protects: exec.py run through Git Bash receives a `/x` argument unchanged when MSYS_NO_PATHCONV=1 is exported (the
launcher's setting); positive control: without it, Git Bash rewrites the argument into a Windows path, which is why
the variable is required.

Run: python -m unittest discover -s scripts/tests -p "test_exec_argv.py" -v
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest

import _support as S
from execlib import procutil


def run_through_bash(arg: str, pathconv_off: bool) -> dict:
    bash = procutil.git_bash()
    assert bash is not None
    env = S.env_isolated(MSYS_NO_PATHCONV="1" if pathconv_off else None)
    py = sys.executable.replace("\\", "/")
    script = S.EXEC_PY.as_posix()
    proc = subprocess.run([bash, "-c", f'"{py}" "{script}" {arg}'], capture_output=True, env=env, timeout=60,
                          cwd=str(S.SKILL_DIR))
    return json.loads(proc.stdout.decode("utf-8"))


@unittest.skipUnless(os.name == "nt" and procutil.git_bash(), "Git Bash path conversion exists only on Windows")
class ExecArgv(unittest.TestCase):
    def test_slash_argument_arrives_unchanged(self) -> None:
        def negative() -> None:
            env = run_through_bash("/x", pathconv_off=True)
            message = env["errors"][0]["message"]
            self.assertIn("'/x'", message, message)

        def positive() -> None:
            env = run_through_bash("/x", pathconv_off=False)
            message = env["errors"][0]["message"]
            assert "'/x'" not in message, f"Git Bash did not rewrite the argument: {message}"

        S.assert_controlled(self, negative, positive)


if __name__ == "__main__":
    unittest.main()
