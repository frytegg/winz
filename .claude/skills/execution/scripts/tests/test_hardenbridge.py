"""The bridge to /harden's scripts (contract/LANES.md B06, TESTS.md 9, HANDOVER.md standing rules): an out-dir whose
parent holds `active` (or under .harden/) is refused before anything runs; `finalize` is never called with
`--install` (argv spy); a real gates.py run with two gates on a temp project returns its exit code and flaky list.

Run: python -m unittest discover -s scripts/tests -p "test_hardenbridge.py" -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

import _support as S

from execlib import hardenbridge, procutil
from execlib.errors import InternalError, PolicyRefused

HARDEN_OK = (hardenbridge.harden_dir() / "scripts" / "gates.py").is_file()


class OutDirRule(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def test_active_sibling_refused_with_positive_control(self) -> None:
        out = self.tmp / "run" / "gates"
        S.assert_controlled(self, negative=lambda: self._refused(out),
                            positive=lambda: hardenbridge.assert_out_dir_safe(out))

    def _refused(self, out: Path) -> None:
        S.write_text(out.parent / "active", "{}\n")
        with self.assertRaises(PolicyRefused) as cm:
            hardenbridge.assert_out_dir_safe(out)
        self.assertEqual(cm.exception.exit_code, 4)

    def test_under_harden_dir_refused(self) -> None:
        with self.assertRaises(PolicyRefused):
            hardenbridge.assert_out_dir_safe(self.tmp / ".harden" / "gates")
        hardenbridge.assert_out_dir_safe(self.tmp / "harden-ready" / "gates")

    @unittest.skipUnless(HARDEN_OK, "/harden's gates.py is needed")
    def test_gates_refuses_before_running(self) -> None:
        out = self.tmp / "x" / "gates"
        S.write_text(out.parent / "active", "{}\n")
        calls: list[list[str]] = []
        with mock.patch.object(hardenbridge.procutil, "run", side_effect=lambda argv, **kw: calls.append(argv)):
            with self.assertRaises(PolicyRefused):
                hardenbridge.gates(self.tmp / "c.json", self.tmp, out, "x")
        self.assertEqual(calls, [])


@unittest.skipUnless(HARDEN_OK, "/harden's scripts are needed")
class FinalizeArgvSpy(unittest.TestCase):
    def test_finalize_never_gets_install(self) -> None:
        seen: list[list[str]] = []

        def spy(argv: list[str], **_kw: object) -> procutil.RunResult:
            seen.append(list(argv))
            return procutil.RunResult(argv=argv, exit_code=0, stdout="{}", stderr="", timed_out=False,
                                      duration_s=0.0)

        with mock.patch.object(hardenbridge.procutil, "run", side_effect=spy):
            hardenbridge.finalize(Path("C:/x/repo"), Path("C:/x/out"))
            hardenbridge.infer(Path("C:/x/repo"), Path("C:/x/inv.json"), Path("C:/x/out"), now=S.FIXED_NOW)
            hardenbridge.probe(Path("C:/x/repo"), Path("C:/x/out"))
        self.assertEqual(len(seen), 3)  # positive control: the spy sees every call
        self.assertIn("finalize", seen[0])
        self.assertIn("--base", seen[0])
        for argv in seen:
            self.assertNotIn("--install", argv)

    def test_planted_install_is_refused(self) -> None:
        with mock.patch.object(hardenbridge.procutil, "run") as run:
            with self.assertRaises(InternalError):
                hardenbridge._run(["python", "infer_profile.py", "finalize", "--install"], cwd=Path("."),
                                  timeout_s=5)
            run.assert_not_called()
            hardenbridge.check_argv(["finalize", "--json"])
            with self.assertRaises(InternalError):
                hardenbridge.check_argv(["finalize", "--install"])

    def test_scripts_present(self) -> None:
        present = hardenbridge.scripts_present()
        self.assertTrue(all(present.values()), present)


@unittest.skipUnless(HARDEN_OK and S.tool_available("git"), "/harden's gates.py and git are needed")
class RealGatesRun(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = S.TempRepo(files={"README.md": "# p\n"})
        self.out = S.mkdtemp()

    def tearDown(self) -> None:
        self.repo.cleanup()
        S.rmtree(self.out)

    def _config(self, gates: list[dict]) -> Path:
        return S.write_json(self.out / "config.json", {"gates": gates})

    def test_two_gates_pass(self) -> None:
        cfg = self._config([
            {"name": "one", "cmd": [sys.executable, "-c", "print('one ok')"]},
            {"name": "two", "cmd": [sys.executable, "-c", "print('two ok')"]},
        ])
        res = hardenbridge.gates(cfg, self.repo.path, self.out / "run" / "gates", "pair")
        self.assertEqual(res.exit_code, 0)
        self.assertEqual(res.flaky, ())
        self.assertTrue(res.result_path.is_file())
        self.assertTrue(res.result["all_passed"])
        outs = {name: out for name, _i, out, _err in hardenbridge.gate_outputs(res.result)}
        self.assertEqual(outs["one"].replace(b"\r\n", b"\n"), b"one ok\n")

    def test_flaky_gate_reported_and_failing_exit(self) -> None:
        flip = ("import pathlib; p = pathlib.Path('flip.txt'); n = int(p.read_text()) if p.exists() else 0; "
                "p.write_text(str(n + 1)); raise SystemExit(n % 2)")
        cfg = self._config([
            {"name": "steady", "cmd": [sys.executable, "-c", "print('ok')"]},
            {"name": "flip", "cmd": [sys.executable, "-c", flip]},
        ])
        res = hardenbridge.gates(cfg, self.repo.path, self.out / "run2" / "gates", "flaky", repeat=2)
        self.assertEqual(res.exit_code, 1)
        self.assertEqual(res.flaky, ("flip",))


if __name__ == "__main__":
    unittest.main()
