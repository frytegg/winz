"""Subprocesses (contract/MODULES.md 3 procutil; LANES.md B01).

Protects: a timeout kills the whole process tree (a grandchild sleeper is gone, positive control: before the timeout
it was alive); output decoded as UTF-8; stdin is never inherited; input_text reaches the child; a missing executable is
E_ENV; Git Bash is found and is never the WSL launcher.

Run: python -m unittest discover -s scripts/tests -p "test_procutil.py" -v
"""
from __future__ import annotations

import os
import sys
import time
import unittest

import _support as S
from execlib import procutil
from execlib.errors import EnvError

PARENT = r"""
import subprocess, sys, time
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
open(sys.argv[1], "w").write(str(child.pid))
time.sleep(120)
"""


class Run(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.dir)

    def test_timeout_kills_whole_tree(self) -> None:
        script = S.write_text(self.dir / "parent.py", PARENT)
        pidfile = self.dir / "grandchild.pid"
        res = procutil.run([sys.executable, str(script), str(pidfile)], cwd=self.dir, timeout_s=3)
        self.assertTrue(res.timed_out)
        self.assertIsNone(res.exit_code)
        self.assertTrue(pidfile.exists(), "the grandchild had started before the timeout")
        grandchild = int(pidfile.read_text())
        deadline = time.monotonic() + 10
        while procutil.pid_alive(grandchild) and time.monotonic() < deadline:
            time.sleep(0.1)
        self.assertFalse(procutil.pid_alive(grandchild), "the grandchild sleeper is gone")

    def test_output_input_and_exit_code(self) -> None:
        res = procutil.run([sys.executable, "-c",
                            "import sys; d=sys.stdin.read(); sys.stdout.buffer.write(('é→' + d).encode()); "
                            "sys.stderr.write('warn'); sys.exit(4)"],
                           cwd=self.dir, timeout_s=30, input_text="ok")
        self.assertEqual((res.exit_code, res.stdout, res.stderr, res.timed_out), (4, "é→ok", "warn", False))
        res2 = procutil.run([sys.executable, "-c", "import sys; print(sys.stdin.read() == '')"], cwd=self.dir,
                            timeout_s=30)
        self.assertEqual(res2.stdout.strip(), "True", "stdin is DEVNULL, never inherited")

    def test_env_is_complete(self) -> None:
        env = {"SYSTEMROOT": os.environ.get("SYSTEMROOT", ""), "PATH": os.environ.get("PATH", ""), "ONLY_ME": "1"}
        res = procutil.run([sys.executable, "-c", "import os; print(os.environ.get('ONLY_ME'), "
                            "os.environ.get('EXEC_TEST'))"], cwd=self.dir, timeout_s=30, env=env)
        self.assertEqual(res.stdout.strip(), "1 None")

    def test_missing_executable(self) -> None:
        with self.assertRaises(EnvError) as cm:
            procutil.run(["definitely-not-a-tool-xyz"], cwd=self.dir, timeout_s=5)
        self.assertEqual(cm.exception.code, "E_ENV")
        with self.assertRaises(ValueError):
            procutil.run("echo hi", cwd=self.dir, timeout_s=5)

    @unittest.skipUnless(procutil.git_bash(), "Git Bash is needed")
    def test_bash_shell(self) -> None:
        res = procutil.run("printf '%s' \"$((6*7))\"", cwd=self.dir, timeout_s=30, shell="bash")
        self.assertEqual((res.exit_code, res.stdout), (0, "42"))

    def test_which_and_python(self) -> None:
        self.assertIsNotNone(procutil.which("git"))
        self.assertIsNone(procutil.which("definitely-not-a-tool-xyz"))
        self.assertEqual(procutil.python_exe(), sys.executable)


class GitBash(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows only: the WSL launcher exists only there")
    def test_git_bash_never_wsl(self) -> None:
        bash = procutil.git_bash()
        self.assertIsNotNone(bash, "Git Bash found")
        low = (bash or "").lower()
        self.assertTrue(low.endswith("bash.exe"))
        self.assertNotIn("/windows/system32/", low)
        self.assertNotIn("/windowsapps/", low)
        self.assertTrue(procutil._is_wsl_launcher("C:/Windows/System32/bash.exe"), "positive control")
        self.assertFalse(procutil._is_wsl_launcher(bash or ""))


if __name__ == "__main__":
    unittest.main()
