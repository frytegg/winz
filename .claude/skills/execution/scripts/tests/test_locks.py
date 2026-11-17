"""File locks (contract/CLI.md 0.3, MODULES.md 3 locks; LANES.md B01).

Protects: two processes contend (the second waits, then times out with LockTimeout exit 3); a dead holder's lock is
broken and an `error` event appended; a live holder older than STALE_S is waited for with W_LOCK_OLD, never broken;
a dead pid whose number was reused (creation time differs) is broken; acquiring out of LOCK_ORDER raises
E_LOCK_ORDER; locks are re-entrant; pid_alive never kills (positive control: a live child stays alive).

Run: python -m unittest discover -s scripts/tests -p "test_locks.py" -v
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

import _support as S
from execlib import errors, events, jsonio, locks, paths, procutil
from execlib.errors import InternalError, LockTimeout
from execlib.model import Ctx

HOLDER = r"""
import sys, time
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from execlib import locks, paths
layout = paths.layout_for(None, Path(sys.argv[2]))
with locks.hold(layout, sys.argv[3], command="holder"):
    Path(sys.argv[4]).write_text("held")
    time.sleep(float(sys.argv[5]))
"""
WAITER = r"""
import sys
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from execlib import locks, paths
from execlib.errors import LockTimeout
layout = paths.layout_for(None, Path(sys.argv[2]))
try:
    with locks.hold(layout, "state", command="waiter", timeout_s=float(sys.argv[3])):
        pass
except LockTimeout as err:
    raise SystemExit(err.exit_code)
raise SystemExit(0)
"""


class LockTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()
        self.layout = paths.layout_for(None, self.root / ".execution")
        self.layout.local.mkdir(parents=True)
        errors.drain_warnings()
        locks.drain_broken()

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def ctx(self) -> Ctx:
        return Ctx(layout=self.layout, executor="A", now=S.fixed_now(), by="orchestrator", pretty=False,
                   command="status", log=logging.getLogger("tests"))

    def spawn_holder(self, name: str, seconds: float) -> subprocess.Popen:
        script = S.write_text(self.root / "holder.py", HOLDER)
        flag = self.root / f"held-{name}"
        proc = subprocess.Popen([sys.executable, str(script), str(S.SCRIPTS_DIR), str(self.layout.state), name,
                                 str(flag), str(seconds)])
        deadline = time.monotonic() + 20
        while not flag.exists():
            if time.monotonic() > deadline or proc.poll() is not None:
                proc.kill()
                self.fail("holder did not acquire the lock")
            time.sleep(0.02)
        return proc

    def write_lock(self, name: str, pid: int, created: int | None) -> None:
        path = self.layout.lock(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        S.write_text(path, json.dumps({"pid": pid, "process_created": created, "host": "h", "command": "x",
                                       "acquired_utc": S.FIXED_NOW}) + "\n")

    def test_two_processes_contend(self) -> None:
        proc = self.spawn_holder("state", 4.0)
        try:
            waiter = S.write_text(self.root / "waiter.py", WAITER)
            start = time.monotonic()
            res = subprocess.run([sys.executable, str(waiter), str(S.SCRIPTS_DIR), str(self.layout.state), "0.6"],
                                 capture_output=True, timeout=30)
            waited = time.monotonic() - start
            self.assertEqual(res.returncode, 3, res.stderr.decode("utf-8", "replace"))
            self.assertGreaterEqual(waited, 0.6, "the second process waited before timing out")
            with self.assertRaises(LockTimeout) as cm:
                with locks.hold(self.layout, "state", command="test", timeout_s=0.3):
                    pass
            self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_LOCK_TIMEOUT", 3))
        finally:
            proc.wait(timeout=30)
        # positive control: once the holder exited, the lock is free
        with locks.hold(self.layout, "state", command="test", timeout_s=2):
            self.assertTrue(locks.is_held("state"))
        self.assertFalse(locks.is_held("state"))
        self.assertFalse(self.layout.lock("state").exists())

    def test_dead_holder_broken_and_error_event(self) -> None:
        child = subprocess.Popen([sys.executable, "-c", "pass"])
        child.wait(timeout=30)
        self.write_lock("state", child.pid, 1)
        S.write_json(self.layout.local_state, S.build_local_state())
        with locks.hold(self.layout, "state", command="status", timeout_s=2):
            ev = events.append(self.ctx(), "governor", {"pause": False})
        lines = [json.loads(ln) for ln in self.layout.events.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([ln["type"] for ln in lines], ["error", "governor"])
        self.assertEqual(lines[0]["data"]["kind"], "lock-broken")
        self.assertEqual(lines[0]["data"]["holder"]["pid"], child.pid)
        self.assertEqual(ev["seq"], lines[1]["seq"])
        self.assertLess(lines[0]["seq"], lines[1]["seq"])

    def test_reused_pid_is_broken_and_live_holder_waited(self) -> None:
        live = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            created = procutil.process_created(live.pid)
            self.assertIsNotNone(created)

            def negative() -> None:
                # same pid, another creation time: the recorded holder is gone -> broken
                self.write_lock("plan", live.pid, (created or 0) + 12345)
                with locks.hold(self.layout, "plan", command="test", timeout_s=2):
                    pass
                self.assertEqual(len(locks.drain_broken()), 1)

            def positive() -> None:
                # same pid and creation time: the holder lives -> waited for, never broken
                self.write_lock("plan", live.pid, created)
                with self.assertRaises(LockTimeout):
                    with locks.hold(self.layout, "plan", command="test", timeout_s=0.4):
                        pass
                assert self.layout.lock("plan").exists(), "a live holder's lock is never broken"
                assert locks.drain_broken() == []

            S.assert_controlled(self, negative, positive)
        finally:
            live.kill()
            live.wait(timeout=30)

    def test_old_live_holder_warns_and_waits(self) -> None:
        live = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            self.write_lock("notion", live.pid, procutil.process_created(live.pid))
            old = time.time() - 10_000
            os.utime(self.layout.lock("notion"), (old, old))
            with self.assertRaises(LockTimeout):
                with locks.hold(self.layout, "notion", command="test", timeout_s=0.3):
                    pass
            self.assertIn("W_LOCK_OLD", [w.code for w in errors.drain_warnings()])
            self.assertTrue(self.layout.lock("notion").exists())
        finally:
            live.kill()
            live.wait(timeout=30)

    def test_lock_order(self) -> None:
        with locks.hold(self.layout, "state", command="test"):
            with self.assertRaises(InternalError) as cm:
                with locks.hold(self.layout, "plan", command="test"):
                    pass
            self.assertEqual(cm.exception.code, "E_LOCK_ORDER")
            with locks.hold(self.layout, "notion", command="test"):  # later in the order: allowed
                self.assertTrue(locks.is_held("notion"))
        with locks.hold(self.layout, "merge", command="test"), locks.hold(self.layout, "plan", command="test"), \
                locks.hold(self.layout, "git-state", command="test"), locks.hold(self.layout, "state", command="t"):
            self.assertTrue(all(locks.is_held(n) for n in ("merge", "plan", "git-state", "state")))

    def test_reentrant(self) -> None:
        with locks.hold(self.layout, "state", command="outer"):
            with locks.hold(self.layout, "state", command="inner"):
                self.assertTrue(locks.is_held("state"))
            self.assertTrue(locks.is_held("state"), "still held by the outer block")
            self.assertTrue(self.layout.lock("state").exists())
        self.assertFalse(self.layout.lock("state").exists())

    def test_pid_alive_never_kills(self) -> None:
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            with mock.patch("os.kill", side_effect=AssertionError("os.kill must not be called")) \
                    if os.name == "nt" else mock.patch("os.getpid", wraps=os.getpid):
                self.assertTrue(procutil.pid_alive(child.pid))
                self.assertTrue(procutil.holder_alive(child.pid, procutil.process_created(child.pid)))
            time.sleep(0.2)
            self.assertIsNone(child.poll(), "the probed child is still alive")
        finally:
            child.kill()
            child.wait(timeout=30)
        self.assertFalse(procutil.pid_alive(child.pid) and procutil.process_created(child.pid) is not None)
        self.assertFalse(procutil.pid_alive(0))


CONTENDER = r"""
import sys, time, os
sys.path.insert(0, sys.argv[1])
from pathlib import Path
from execlib import locks, paths
layout = paths.layout_for(None, Path(sys.argv[2]))
go = float(sys.argv[4])
use_lock = sys.argv[5] == "lock"
while time.time() < go:
    pass
def section():
    t0 = time.time()
    time.sleep(0.2)
    return t0, time.time()
if use_lock:
    with locks.hold(layout, "state", command="contender", timeout_s=60):
        t0, t1 = section()
else:
    t0, t1 = section()
with open(f"{sys.argv[3]}-{os.getpid()}.txt", "w", encoding="utf-8", newline="\n") as fh:
    fh.write(f"{t0} {t1} {len(locks.drain_broken())}\n")
"""


class DeadHolderRace(unittest.TestCase):
    """Verifier finding B-1/M-1: N waiters judging the same dead holder break it once; no critical sections overlap
    and no waiter crashes on a lock file that vanished or is pending delete."""

    def setUp(self) -> None:
        self.root = S.mkdtemp()
        locks.drain_broken()

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def dead_pid(self) -> int:
        child = subprocess.Popen([sys.executable, "-c", "pass"])
        child.wait(timeout=30)
        return child.pid

    def contend(self, trial: int, mode: str, n: int = 6) -> tuple[list[tuple[float, float, int]], int]:
        layout = paths.layout_for(None, self.root / f"t{trial}" / ".execution")
        path = layout.lock("state")
        path.parent.mkdir(parents=True)
        S.write_text(path, json.dumps({"pid": self.dead_pid(), "process_created": 1, "host": "h", "command": "dead",
                                       "acquired_utc": S.FIXED_NOW}) + "\n")
        script = S.write_text(self.root / "contender.py", CONTENDER)
        out = self.root / f"out-{trial}-{mode}"
        go = time.time() + 1.5
        procs = [subprocess.Popen([sys.executable, str(script), str(S.SCRIPTS_DIR), str(layout.state), str(out),
                                   str(go), mode], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                 for _ in range(n)]
        for proc in procs:
            _out, err = proc.communicate(timeout=120)
            self.assertEqual(proc.returncode, 0, err.decode("utf-8", "replace")[-800:])
        rows = sorted((float(a), float(b), int(c)) for a, b, c in
                      (f.read_text(encoding="utf-8").split() for f in self.root.glob(f"{out.name}-*.txt")))
        self.assertEqual(len(rows), n)
        overlaps = sum(1 for x, y in zip(rows, rows[1:]) if y[0] < x[1])
        if mode == "lock":
            self.assertFalse(path.exists(), "the last holder released the lock")
            self.assertEqual([p.name for p in path.parent.iterdir()], [], "no guard or side file left behind")
        return rows, overlaps

    def test_waiters_on_a_dead_holder_never_overlap(self) -> None:
        def positive() -> None:
            # without the lock the same children do overlap: the overlap measure can fire
            _rows, overlaps = self.contend(0, "nolock")
            assert overlaps > 0, "unlocked sections overlap"

        def negative() -> None:
            for trial in range(1, 4):
                rows, overlaps = self.contend(trial, "lock")
                self.assertEqual(overlaps, 0, f"trial {trial}: overlapping critical sections {rows}")
                self.assertEqual(sum(r[2] for r in rows), 1, "the dead holder's lock is broken exactly once")

        S.assert_controlled(self, negative, positive)

    def test_break_only_removes_the_judged_bytes(self) -> None:
        layout = paths.layout_for(None, self.root / ".execution")
        path = layout.lock("state")
        path.parent.mkdir(parents=True)
        dead = (json.dumps({"pid": self.dead_pid(), "process_created": 1, "command": "dead"}) + "\n").encode()
        live = (json.dumps({"pid": os.getpid(), "process_created": procutil.process_created(os.getpid()),
                            "command": "live"}) + "\n").encode()

        def negative() -> None:
            # the file now holds a live waiter's fresh lock: a breaker that judged the dead bytes leaves it alone
            path.write_bytes(live)
            self.assertFalse(locks._break(path, dead, {"pid": 1}, "state", "slow-waiter"))
            self.assertEqual(path.read_bytes(), live)
            # the judged bytes but a live holder (re-checked under the guard): left alone too
            self.assertFalse(locks._break(path, live, None, "state", "slow-waiter"))
            self.assertEqual(path.read_bytes(), live)
            self.assertEqual(locks.drain_broken(), [])
            # a lock file that vanished meanwhile: no crash, nothing broken
            path.unlink()
            self.assertFalse(locks._break(path, dead, None, "state", "slow-waiter"))

        def positive() -> None:
            path.write_bytes(dead)
            assert locks._break(path, dead, {"pid": 1}, "state", "waiter"), "the dead bytes are broken"
            assert not path.exists()
            assert len(locks.drain_broken()) == 1

        S.assert_controlled(self, negative, positive)
        self.assertEqual(sorted(p.name for p in path.parent.iterdir()), [], "no guard or side file left behind")

    def test_unreadable_lock_file_is_waited_not_fatal(self) -> None:
        layout = paths.layout_for(None, self.root / ".execution")
        path = layout.lock("state")
        path.parent.mkdir(parents=True)
        dead = json.dumps({"pid": self.dead_pid(), "process_created": 1, "command": "dead"}) + "\n"
        real_read = Path.read_bytes

        def negative() -> None:
            for exc in (FileNotFoundError, PermissionError):
                S.write_text(path, dead)

                def flaky(self_path, _exc=exc):  # the lock file vanishes / is pending delete at every read
                    if self_path.name == "state":
                        raise _exc(2, "simulated", str(self_path))
                    return real_read(self_path)

                with mock.patch.object(Path, "read_bytes", flaky):
                    with self.assertRaises(LockTimeout):
                        with locks.hold(layout, "state", command="test", timeout_s=0.3):
                            pass
                self.assertTrue(path.exists())
                path.unlink()

        def positive() -> None:
            S.write_text(path, dead)
            with locks.hold(layout, "state", command="test", timeout_s=2):
                assert locks.is_held("state")
            assert len(locks.drain_broken()) == 1

        S.assert_controlled(self, negative, positive)

    def test_dead_breakers_guard_is_cleared(self) -> None:
        layout = paths.layout_for(None, self.root / ".execution")
        path = layout.lock("state")
        guard = path.with_name("state" + locks.GUARD_SUFFIX)
        path.parent.mkdir(parents=True)
        dead_lock = json.dumps({"pid": self.dead_pid(), "process_created": 1, "command": "dead"}) + "\n"
        live = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        try:
            def negative() -> None:
                # a live breaker holds the guard: the waiter does not break the lock behind its back
                S.write_text(path, dead_lock)
                S.write_text(guard, json.dumps({"pid": live.pid, "process_created": procutil.process_created(
                    live.pid), "token": "t"}) + "\n")
                with self.assertRaises(LockTimeout):
                    with locks.hold(layout, "state", command="test", timeout_s=0.4):
                        pass
                self.assertEqual(path.read_text(encoding="utf-8"), dead_lock)
                self.assertTrue(guard.exists())
                self.assertEqual(locks.drain_broken(), [])
                guard.unlink()
                path.unlink()

            def positive() -> None:
                # the guard's breaker died: the guard is cleared and the dead holder's lock broken
                S.write_text(path, dead_lock)
                S.write_text(guard, json.dumps({"pid": self.dead_pid(), "process_created": 1, "token": "t"}) + "\n")
                with locks.hold(layout, "state", command="test", timeout_s=3):
                    assert locks.is_held("state")
                assert not guard.exists() and not path.exists()
                assert len(locks.drain_broken()) == 1

            S.assert_controlled(self, negative, positive)
        finally:
            live.kill()
            live.wait(timeout=30)


class Unwritten(unittest.TestCase):
    def test_empty_lock_file_broken_after_grace(self) -> None:
        root = S.mkdtemp()
        try:
            layout = paths.layout_for(None, root / ".execution")
            path = layout.lock("state")
            path.parent.mkdir(parents=True)
            path.write_bytes(b"")
            old = time.time() - 60
            os.utime(path, (old, old))
            with locks.hold(layout, "state", command="test", timeout_s=2):
                self.assertEqual(jsonio.read_json(path)["command"], "test")
            locks.drain_broken()
        finally:
            S.rmtree(root)


if __name__ == "__main__":
    unittest.main()
