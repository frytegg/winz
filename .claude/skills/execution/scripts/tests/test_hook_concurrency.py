"""Hooks under concurrency (contract/HOOKS.md 10, TESTS.md 4.5, LANES.md B08): 16 guard processes started at once,
each denying one call, while another process rewrites local/state.json in a loop through
jsonio.write_json_atomic: 16 distinct event files in local/hook-events/ (one file per event, O_EXCL: none lost or
merged), no PermissionError escapes the writer (its retry absorbs every collision), and every hook either decided
or failed open with one log line.

Run: python -m unittest discover -s scripts/tests -p "test_hook_concurrency.py" -v
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import unittest

import _support as S
import _support_B08 as B
from execlib import procutil

N = 16

WRITER = r"""
import sys, time
sys.path.insert(0, sys.argv[1])
from execlib import jsonio
from pathlib import Path
path = Path(sys.argv[2]); stop = Path(sys.argv[3])
doc = jsonio.read_json(path)
n = 0
deadline = time.time() + 60
while not stop.exists() and time.time() < deadline:
    doc["last_tick_utc"] = None
    jsonio.write_json_atomic(path, doc)
    n += 1
print(n)
"""


@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class HookConcurrency(unittest.TestCase):
    def test_sixteen_guards_and_a_writer(self) -> None:
        r = B.HookRepo()
        try:
            stop_flag = r.tmp.root / "stop.flag"
            writer = subprocess.Popen([sys.executable, "-c", WRITER, str(S.SCRIPTS_DIR), str(r.layout.local_state),
                                       str(stop_flag)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            time.sleep(0.3)
            bash = procutil.git_bash()
            assert bash is not None
            launcher = (S.SCRIPTS_DIR / "hooks" / "py.sh").as_posix()
            procs = []
            for i in range(N):
                doc = B.fill(S.payload("pre_tool.agent", tool_name="Write",
                                       tool_input={"file_path": f".execution/proofs/T{i:03d}.json", "content": "x"}),
                             r.path)
                p = subprocess.Popen([bash, launcher, "pre_tool_guard.py"], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=r.env, cwd=str(r.path))
                procs.append((p, json.dumps(doc).encode("utf-8")))
            outs = []
            for p, data in procs:
                out, err = p.communicate(data, timeout=60)
                outs.append((p.returncode, out, err))
            stop_flag.write_text("stop", encoding="utf-8")
            w_out, w_err = writer.communicate(timeout=60)
            self.assertEqual(writer.returncode, 0, w_err.decode("utf-8", "replace"))
            self.assertGreater(int(w_out.decode().strip() or 0), 0)
            decided = 0
            for code, out, _err in outs:
                self.assertEqual(code, 0)
                if out.strip():
                    obj = json.loads(out.decode("ascii"))
                    self.assertEqual(obj["hookSpecificOutput"]["permissionDecision"], "deny")
                    decided += 1
            errors = r.layout.hook_errors.read_text(encoding="utf-8").strip().split("\n") \
                if r.layout.hook_errors.exists() else []
            self.assertEqual(decided + len(errors), N)
            files = sorted(r.layout.hook_events_dir.glob("*.json"))
            denies = [json.loads(f.read_text(encoding="utf-8")) for f in files]
            self.assertEqual(len(files), decided)
            self.assertEqual(len({f.name for f in files}), len(files))
            self.assertTrue(all(d["type"] == "guard.deny" for d in denies))
            self.assertEqual(decided, N, f"{len(errors)} hooks failed open: {errors[:2]}")
        finally:
            r.cleanup()


if __name__ == "__main__":
    unittest.main()
