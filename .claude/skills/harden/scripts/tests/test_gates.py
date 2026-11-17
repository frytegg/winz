"""Tests for scripts/gates.py: success, failure, timeout with tree kill, repeat, flaky detection,
--only, config errors, shells and output tails.

Gates run real subprocesses (the current Python interpreter and simple shell commands) inside
temporary directories. Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import gates as G  # noqa: E402

PY = sys.executable


def py_cmd(code: str) -> List[str]:
    """argv running a Python snippet with the current interpreter."""
    return [PY, "-c", code]


class GateTestBase(unittest.TestCase):
    """Creates a plain project directory with a .harden/config.json per test."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-gates-"))
        self.repo = self.tmp / "proj"
        (self.repo / ".harden").mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write_config(self, gates: List[Dict[str, Any]]) -> Path:
        path = self.repo / ".harden" / "config.json"
        path.write_text(json.dumps({"gates": gates}), encoding="utf-8")
        return path

    def run_main(self, *args: str) -> int:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return G.main(["--repo", str(self.repo)] + list(args))

    def result(self, label: str) -> Dict[str, Any]:
        path = self.repo / ".harden" / "gates" / "{}.json".format(label)
        return json.loads(path.read_text(encoding="utf-8"))

    def run_cli(self, *args: str) -> "subprocess.CompletedProcess[bytes]":
        return subprocess.run([PY, str(SCRIPTS / "gates.py"), "--repo", str(self.repo)] + list(args),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)


class RunTests(GateTestBase):
    """Pass/fail, output capture and repeats."""

    def test_all_pass_string_and_list(self) -> None:
        self.write_config([
            {"name": "shell-ok", "cmd": "exit 0", "timeout_s": 60},
            {"name": "argv-ok", "cmd": py_cmd("print('hello from gate')"), "timeout_s": 60},
        ])
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        res = self.result("baseline")
        self.assertTrue(res["all_passed"])
        self.assertEqual(res["flaky"], [])
        recs = {r["name"]: r for r in res["runs"][0]["results"]}
        self.assertEqual(recs["shell-ok"]["exit_code"], 0)
        self.assertIn("hello from gate", recs["argv-ok"]["stdout_tail"])
        self.assertFalse(recs["argv-ok"]["timed_out"])
        self.assertGreaterEqual(recs["argv-ok"]["duration_s"], 0.0)
        log = Path(recs["argv-ok"]["log_paths"]["stdout"])
        self.assertTrue(log.is_file())
        self.assertIn("hello from gate", log.read_text(encoding="utf-8"))

    def test_failure_sets_exit_1_and_records_code(self) -> None:
        self.write_config([
            {"name": "ok", "cmd": "exit 0"},
            {"name": "bad", "cmd": py_cmd("import sys; sys.stderr.write('boom\\n'); sys.exit(3)")},
        ])
        proc = self.run_cli("--label", "after-x")
        self.assertEqual(proc.returncode, 1, proc.stderr)
        res = self.result("after-x")
        self.assertFalse(res["all_passed"])
        bad = [r for r in res["runs"][0]["results"] if r["name"] == "bad"][0]
        self.assertEqual(bad["exit_code"], 3)
        self.assertFalse(bad["passed"])
        self.assertIn("boom", bad["stderr_tail"])
        self.assertEqual(res["summary"]["bad"]["failed"], 1)
        self.assertEqual(res["summary"]["ok"]["passed"], 1)

    def test_tail_is_limited_to_60_lines(self) -> None:
        self.write_config([{"name": "loud", "cmd": py_cmd(
            "print('\\n'.join('line %d' % i for i in range(200)))")}])
        self.assertEqual(self.run_main("--label", "t"), 0)
        tail = self.result("t")["runs"][0]["results"][0]["stdout_tail"].splitlines()
        self.assertEqual(len(tail), G.TAIL_LINES)
        self.assertEqual(tail[-1], "line 199")
        self.assertEqual(tail[0], "line 140")

    def test_cwd_is_relative_to_repo(self) -> None:
        (self.repo / "sub").mkdir()
        self.write_config([{"name": "where", "cwd": "sub",
                            "cmd": py_cmd("import os; print(os.path.basename(os.getcwd()))")}])
        self.assertEqual(self.run_main("--label", "cwd"), 0)
        self.assertEqual(self.result("cwd")["runs"][0]["results"][0]["stdout_tail"], "sub")

    def test_env_is_passed(self) -> None:
        self.write_config([{"name": "env", "env": {"HARDEN_T": "42"},
                            "cmd": py_cmd("import os; print(os.environ['HARDEN_T'])")}])
        self.assertEqual(self.run_main("--label", "env"), 0)
        self.assertEqual(self.result("env")["runs"][0]["results"][0]["stdout_tail"], "42")

    def test_env_allowlist_keeps_other_variables_out(self) -> None:
        secret_name = "HARDEN_TEST_EXCHANGE_KEY"
        os.environ[secret_name] = "sk-live-do-not-leak"
        os.environ["HARDEN_TEST_ALLOWED"] = "visible"
        self.addCleanup(os.environ.pop, secret_name, None)
        self.addCleanup(os.environ.pop, "HARDEN_TEST_ALLOWED", None)
        probe = py_cmd("import os; print(os.environ.get({!r}, 'ABSENT')); "
                       "print(os.environ.get('HARDEN_TEST_ALLOWED', 'ABSENT')); "
                       "print(os.environ.get('HARDEN_T', 'ABSENT'))".format(secret_name))
        base = ["PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "HOME", "HARDEN_TEST_ALLOWED"]
        path = self.repo / ".harden" / "config.json"
        path.write_text(json.dumps({
            "env_policy": "allowlist", "inherit_env": False, "env_allowlist": base,
            "gates": [{"name": "sandboxed", "cmd": probe, "env": {"HARDEN_T": "own"}},
                      {"name": "inherits", "cmd": probe, "inherit_env": True}]}),
            encoding="utf-8")
        self.assertEqual(self.run_main("--label", "env"), 0)
        res = self.result("env")
        recs = {r["name"]: r["stdout_tail"].splitlines() for r in res["runs"][0]["results"]}
        self.assertEqual(recs["sandboxed"], ["ABSENT", "visible", "own"])
        self.assertEqual(recs["inherits"][0], "sk-live-do-not-leak")
        gates = {g["name"]: g for g in res["gates"]}
        self.assertEqual(gates["sandboxed"]["env_policy"], "allowlist")
        self.assertIn("HARDEN_TEST_ALLOWED", gates["sandboxed"]["env_names"])
        self.assertIn("HARDEN_T", gates["sandboxed"]["env_names"])
        self.assertNotIn(secret_name, gates["sandboxed"]["env_names"])
        self.assertEqual(gates["inherits"]["env_policy"], "inherit")
        self.assertIn(secret_name, gates["inherits"]["env_names"])
        self.assertNotIn("sk-live-do-not-leak",
                         json.dumps({k: v for k, v in res.items() if k != "runs"}))
        self.assertEqual(res["config_env_policy"], "allowlist")
        self.assertTrue(any("inherits" in n and "allowlist" in n for n in res["notes"]))

    def test_env_policy_note_and_bad_env_keys(self) -> None:
        self.write_config([{"name": "ok", "cmd": "exit 0"}])
        self.assertEqual(self.run_main("--label", "nopolicy"), 0)
        res = self.result("nopolicy")
        self.assertIsNone(res["config_env_policy"])
        self.assertTrue(any("env_policy in the config is missing" in n for n in res["notes"]))
        for bad in ({"inherit_env": "no"}, {"env_allowlist": "PATH"}, {"env_allowlist": [""]}):
            with self.subTest(bad=bad):
                with self.assertRaises(G.ConfigError):
                    G.parse_gates(dict({"gates": [{"name": "a", "cmd": "exit 0"}]}, **bad),
                                  self.repo)
                with self.assertRaises(G.ConfigError):
                    G.parse_gates({"gates": [dict({"name": "a", "cmd": "exit 0"}, **bad)]},
                                  self.repo)

    def test_repeat_and_flaky_detection(self) -> None:
        counter = self.tmp / "counter.txt"
        code = ("import os, sys; p = {!r}; n = int(open(p).read()) if os.path.exists(p) else 0; "
                "open(p, 'w').write(str(n + 1)); sys.exit(n % 2)").format(str(counter))
        self.write_config([{"name": "stable", "cmd": "exit 0"},
                           {"name": "alternating", "cmd": py_cmd(code)}])
        rc = self.run_main("--label", "baseline", "--repeat", "3")
        self.assertEqual(rc, 1)
        res = self.result("baseline")
        self.assertEqual(res["repeat"], 3)
        self.assertEqual(len(res["runs"]), 3)
        self.assertEqual(res["flaky"], ["alternating"])
        self.assertTrue(res["summary"]["alternating"]["flaky"])
        self.assertEqual(res["summary"]["alternating"]["passed"], 2)
        self.assertFalse(res["summary"]["stable"]["flaky"])
        self.assertTrue(any("T13-F03" in n for n in res["notes"]))

    def test_only_filters_gates(self) -> None:
        self.write_config([{"name": "a", "cmd": "exit 0"}, {"name": "b", "cmd": "exit 5"}])
        self.assertEqual(self.run_main("--label", "only", "--only", "a"), 0)
        res = self.result("only")
        self.assertEqual([g["name"] for g in res["gates"]], ["a"])

    def test_missing_executable_is_a_failure(self) -> None:
        self.write_config([{"name": "ghost", "cmd": ["harden-no-such-tool-xyz", "--version"]}])
        self.assertEqual(self.run_main("--label", "ghost"), 1)
        rec = self.result("ghost")["runs"][0]["results"][0]
        self.assertFalse(rec["passed"])
        self.assertIn("could not start", rec["error"])

    def test_json_flag_prints_result(self) -> None:
        self.write_config([{"name": "ok", "cmd": "exit 0"}])
        proc = self.run_cli("--label", "j", "--json")
        self.assertEqual(proc.returncode, 0)
        data = json.loads(proc.stdout.decode("utf-8"))
        self.assertEqual(data["label"], "j")
        self.assertTrue(data["all_passed"])


class TimeoutTests(GateTestBase):
    """Timeouts kill the whole process tree."""

    def test_timeout_kills_process_tree(self) -> None:
        marker = self.tmp / "grandchild-survived.txt"
        child = "import time; time.sleep(4); open({!r}, 'w').write('alive')".format(str(marker))
        parent = ("import subprocess, sys, time; "
                  "subprocess.Popen([sys.executable, '-c', {!r}]); time.sleep(60)").format(child)
        self.write_config([{"name": "hang", "cmd": py_cmd(parent), "timeout_s": 1.5}])
        start = time.monotonic()
        rc = self.run_main("--label", "timeout")
        elapsed = time.monotonic() - start
        self.assertEqual(rc, 1)
        self.assertLess(elapsed, 30)
        rec = self.result("timeout")["runs"][0]["results"][0]
        self.assertTrue(rec["timed_out"])
        self.assertFalse(rec["passed"])
        self.assertIn("timed out", rec["error"])
        time.sleep(5)  # the grandchild would have written the marker after 4 s
        self.assertFalse(marker.exists(), "grandchild process survived the timeout kill")

    def test_timeout_kills_orphaned_bash_children(self) -> None:
        # Under Git Bash, `cmd & sleep` runs sleep in a forked-then-exec'd MSYS process whose
        # Windows parent is gone, so `taskkill /T` alone cannot reach it.
        bash, _desc = G.find_bash()
        if bash is None:
            self.skipTest("bash not available")
        marker = self.tmp / "orphan-survived.txt"
        target = marker.as_posix()
        self.write_config([{"name": "hang", "shell": "bash", "timeout_s": 1.5,
                            "cmd": "sh -c 'sleep 4; echo alive > {}' & sleep 60".format(target)}])
        self.assertEqual(self.run_main("--label", "orphan"), 1)
        self.assertTrue(self.result("orphan")["runs"][0]["results"][0]["timed_out"])
        time.sleep(5)
        self.assertFalse(marker.exists(), "background bash child survived the timeout kill")


class ShellTests(GateTestBase):
    """Platform shell, bash, warnings."""

    def test_platform_shell_string(self) -> None:
        self.write_config([{"name": "echo", "cmd": "echo platform-shell"}])
        self.assertEqual(self.run_main("--label", "sh"), 0)
        rec = self.result("sh")["runs"][0]["results"][0]
        self.assertIn("platform-shell", rec["stdout_tail"])
        if os.name == "nt":
            self.assertIn("cmd", rec["shell_used"].lower())
        else:
            self.assertEqual(rec["shell_used"], "/bin/sh")

    def test_bash_shell_with_pipe_and_pipefail(self) -> None:
        bash, _desc = G.find_bash()
        if bash is None:
            self.skipTest("bash not available")
        self.write_config([
            {"name": "pipe", "shell": "bash", "cmd": "false | cat"},
            {"name": "pipefail", "shell": "bash", "pipefail": True, "cmd": "false | cat"},
            {"name": "bash-only", "shell": "bash", "cmd": "x=(a b); echo ${#x[@]}"},
        ])
        self.assertEqual(self.run_main("--label", "bash"), 1)
        recs = {r["name"]: r for r in self.result("bash")["runs"][0]["results"]}
        self.assertTrue(recs["pipe"]["passed"])            # the pipe masks `false`
        self.assertTrue(any("pipefail" in w for w in recs["pipe"]["warnings"]))
        self.assertFalse(recs["pipefail"]["passed"])       # pipefail exposes it
        self.assertNotIn("warnings", recs["pipefail"])
        self.assertEqual(recs["bash-only"]["stdout_tail"], "2")

    def test_git_bash_is_never_the_wsl_launcher(self) -> None:
        if os.name != "nt":
            self.skipTest("Windows only")
        path = G.find_git_bash()
        if path is None:
            self.skipTest("Git Bash not installed")
        self.assertNotIn("system32", path.lower())
        self.assertNotIn("windowsapps", path.lower())
        self.assertTrue(path.lower().endswith("bash.exe"))
        self.assertTrue(G._is_wsl_launcher("C:/Windows/System32/bash.exe"))

    def test_masking_warning(self) -> None:
        self.write_config([{"name": "masked", "cmd": "exit 1 || exit 0"}])
        self.run_main("--label", "mask")
        rec = self.result("mask")["runs"][0]["results"][0]
        self.assertTrue(any("masking construct" in w for w in rec.get("warnings", [])))


class ConfigErrorTests(GateTestBase):
    """Exit code 2 on unusable configuration or arguments."""

    def assert_config_error(self, *args: str) -> None:
        proc = self.run_cli(*args)
        self.assertEqual(proc.returncode, 2, proc.stderr.decode("utf-8", "replace"))

    def test_missing_config(self) -> None:
        self.assert_config_error("--label", "x")

    def test_empty_gates(self) -> None:
        self.write_config([])
        self.assert_config_error("--label", "x")

    def test_invalid_json(self) -> None:
        (self.repo / ".harden" / "config.json").write_text("{nope", encoding="utf-8")
        self.assert_config_error("--label", "x")

    def test_config_with_utf8_bom_is_read(self) -> None:
        # Windows PowerShell 5.1 `Set-Content -Encoding utf8` prefixes a BOM.
        path = self.repo / ".harden" / "config.json"
        path.write_bytes(b"\xef\xbb\xbf" + json.dumps({"gates": [{"name": "a", "cmd": "exit 0"}]})
                         .encode("utf-8"))
        self.assertEqual(self.run_main("--label", "bom"), 0)

    def test_unknown_only(self) -> None:
        self.write_config([{"name": "a", "cmd": "exit 0"}])
        self.assert_config_error("--label", "x", "--only", "zzz")

    def test_bad_label_and_repeat(self) -> None:
        self.write_config([{"name": "a", "cmd": "exit 0"}])
        self.assert_config_error("--label", "../escape")
        self.assert_config_error("--label", "x", "--repeat", "0")

    def test_missing_label(self) -> None:
        self.write_config([{"name": "a", "cmd": "exit 0"}])
        self.assert_config_error()

    def test_bad_gate_entries(self) -> None:
        for bad in ([{"cmd": "exit 0"}], [{"name": "a"}], [{"name": "a", "cmd": []}],
                    [{"name": "a", "cmd": "x", "timeout_s": 0}],
                    [{"name": "a", "cmd": "x", "cwd": "missing-dir"}],
                    [{"name": "a", "cmd": "x"}, {"name": "a", "cmd": "y"}],
                    [{"name": "a", "cmd": ["x"], "shell": "bash"}],
                    [{"name": "a", "cmd": "x", "env": {"K": 1}}]):
            with self.subTest(bad=bad):
                with self.assertRaises(G.ConfigError):
                    G.parse_gates({"gates": bad}, self.repo)

    def test_alternate_config_path(self) -> None:
        alt = self.tmp / "alt.json"
        alt.write_text(json.dumps({"gates": [{"name": "a", "cmd": "exit 0"}]}), encoding="utf-8")
        self.assertEqual(self.run_main("--label", "alt", "--config", str(alt)), 0)
        self.assertTrue(self.result("alt")["config"].endswith("alt.json"))

    def test_bad_count_settings(self) -> None:
        for bad in ({"count_regex": "\\d+ passed"},             # no capture group
                    {"count_regex": "(\\d+) (passed)"},         # two capture groups
                    {"count_regex": "(\\d+"},                   # invalid regex
                    {"count_regex": 5},                         # not a string
                    {"count_regex": "   "},                     # blank
                    {"count_regex": "(\\d+) passed", "count_mode": "median"}):
            with self.subTest(bad=bad):
                gate = dict({"name": "t", "cmd": "exit 0"}, **bad)
                with self.assertRaises(G.ConfigError):
                    G.parse_gates({"gates": [gate]}, self.repo)
        self.write_config([{"name": "t", "cmd": "exit 0", "count_regex": "no group"}])
        self.assert_config_error("--label", "x")

    def test_non_capturing_groups_are_allowed(self) -> None:
        gates = G.parse_gates({"gates": [{"name": "t", "cmd": "exit 0",
                                          "count_regex": "(?:Tests|tests):\\s+(\\d+)"}]}, self.repo)
        self.assertEqual(gates[0].count_regex.groups, 1)
        self.assertEqual(gates[0].describe()["count_regex"], "(?:Tests|tests):\\s+(\\d+)")
        self.assertEqual(gates[0].describe()["count_mode"], "sum")


def printing_gate(text: str, stream: str = "stdout", **extra: Any) -> Dict[str, Any]:
    """A gate that writes `text` to stdout or stderr."""
    code = "import sys; sys.{}.write({!r}); sys.{}.flush()".format(stream, text, stream)
    gate: Dict[str, Any] = {"name": extra.pop("name", "test"), "cmd": py_cmd(code)}
    gate.update(extra)
    return gate


class CountTests(GateTestBase):
    """count_regex extraction and the --min-count-from comparison (PC-02)."""

    CARGO_RE = "test result: ok\\. (\\d+) passed"

    def counter_gate(self, **extra: Any) -> Dict[str, Any]:
        """A gate printing '<N> passed', N read from a file the test controls."""
        self.count_file = self.tmp / "n.txt"
        code = "print(open({!r}).read().strip() + ' passed in 0.10s')".format(str(self.count_file))
        gate: Dict[str, Any] = {"name": "test", "cmd": py_cmd(code),
                                "count_regex": "(\\d+) passed"}
        gate.update(extra)
        return gate

    def set_count(self, n: int) -> None:
        self.count_file.write_text(str(n), encoding="utf-8")

    def test_sum_over_stdout_and_stderr_with_ansi(self) -> None:
        out = "running 3 tests\n\x1b[32mtest result: ok\x1b[0m. 3 passed; 0 failed\n"
        self.write_config([
            printing_gate(out, count_regex=self.CARGO_RE, name="unit"),
            printing_gate("test result: ok. 2 passed; 0 failed\r\n", stream="stderr",
                          count_regex=self.CARGO_RE, name="doc"),
            {"name": "both", "cmd": py_cmd(
                "import sys; print('test result: ok. 4 passed'); "
                "sys.stderr.write('test result: ok. 1 passed\\n')"), "count_regex": self.CARGO_RE},
        ])
        self.assertEqual(self.run_main("--label", "c"), 0)
        res = self.result("c")
        recs = {r["name"]: r for r in res["runs"][0]["results"]}
        self.assertEqual((recs["unit"]["count"], recs["unit"]["count_matches"]), (3, 1))
        self.assertEqual(recs["doc"]["count"], 2)
        self.assertEqual((recs["both"]["count"], recs["both"]["count_matches"]), (5, 2))
        self.assertEqual(res["summary"]["both"]["count_min"], 5)
        self.assertEqual(res["summary"]["both"]["counts"], [5])
        self.assertEqual(res["gates"][0]["count_regex"], self.CARGO_RE)
        self.assertIsNone(res["count_check"])

    def test_count_modes(self) -> None:
        text = "7 passed\nthen 3 passed\n"
        self.write_config([printing_gate(text, name="sum", count_regex="(\\d+) passed"),
                           printing_gate(text, name="last", count_regex="(\\d+) passed",
                                         count_mode="last"),
                           printing_gate(text, name="max", count_regex="(\\d+) passed",
                                         count_mode="max")])
        self.assertEqual(self.run_main("--label", "m"), 0)
        recs = {r["name"]: r["count"] for r in self.result("m")["runs"][0]["results"]}
        self.assertEqual(recs, {"sum": 10, "last": 3, "max": 7})

    def test_count_null_cases(self) -> None:
        self.write_config([
            printing_gate("nothing here\n", name="nomatch", count_regex="(\\d+) passed"),
            printing_gate("abc passed\n", name="word", count_regex="(\\w+) passed"),
            printing_gate("1,234 passed\n", name="sep", count_regex="([\\d,]+) passed"),
            {"name": "plain", "cmd": "exit 0"},
        ])
        self.assertEqual(self.run_main("--label", "n"), 0)
        recs = {r["name"]: r for r in self.result("n")["runs"][0]["results"]}
        self.assertIsNone(recs["nomatch"]["count"])
        self.assertEqual(recs["nomatch"]["count_matches"], 0)
        self.assertIn("matched nothing", recs["nomatch"]["count_error"])
        self.assertIsNone(recs["word"]["count"])
        self.assertIn("not an integer", recs["word"]["count_error"])
        self.assertEqual(recs["sep"]["count"], 1234)
        self.assertIsNone(recs["plain"]["count"])
        self.assertNotIn("count_matches", recs["plain"])
        self.assertNotIn("count_regex", self.result("n")["gates"][3])

    def test_min_count_from_detects_a_drop(self) -> None:
        self.write_config([self.counter_gate(), {"name": "lint", "cmd": "exit 0"}])
        self.set_count(5)
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        self.set_count(4)
        proc = self.run_cli("--label", "step-1", "--min-count-from", "baseline")
        self.assertEqual(proc.returncode, 1)
        err = proc.stderr.decode("utf-8")
        self.assertIn("count dropped to 4 from 5", err)
        self.assertIn("PC-02", err)
        self.assertIn("COUNT FAIL", proc.stdout.decode("utf-8"))
        res = self.result("step-1")
        self.assertTrue(res["all_passed"])            # the gates themselves were green
        check = res["count_check"]
        self.assertFalse(check["passed"])
        self.assertEqual(check["reference_label"], "baseline")
        self.assertEqual(check["gates"]["test"]["status"], "dropped")
        self.assertEqual((check["gates"]["test"]["reference"], check["gates"]["test"]["current"]),
                         (5, 4))
        self.assertEqual(check["not_compared"],
                         [{"gate": "lint", "reason": "no count recorded in 'baseline'"}])

    def test_min_count_from_passes_when_equal_or_higher(self) -> None:
        self.write_config([self.counter_gate()])
        self.set_count(5)
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        for n in (5, 6):
            with self.subTest(n=n):
                self.set_count(n)
                self.assertEqual(self.run_main("--label", "step", "--min-count-from", "baseline"), 0)
                check = self.result("step")["count_check"]
                self.assertTrue(check["passed"])
                self.assertEqual(check["gates"]["test"]["status"], "ok")

    def test_min_count_from_fails_when_the_count_goes_missing(self) -> None:
        self.write_config([self.counter_gate()])
        self.set_count(5)
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        self.count_file.write_text("no summary", encoding="utf-8")
        self.assertEqual(self.run_main("--label", "step", "--min-count-from", "baseline"), 1)
        self.assertEqual(self.result("step")["count_check"]["gates"]["test"]["status"], "missing")
        # A gate whose count_regex was removed cannot prove its count either (reached through
        # check_counts: the CLI already refuses a changed gates array, see gates_sha256).
        gate = G.parse_gates({"gates": [{"name": "test", "cmd": "exit 0"}]}, self.repo)[0]
        ref_path = self.repo / ".harden" / "gates" / "baseline.json"
        check = G.check_counts(G.load_reference_counts(ref_path), "baseline", ref_path, [gate],
                               [{"run": 1, "results": [{"name": "test", "count": None}]}])
        self.assertIn("no count_regex now", check["failures"][0])

    def test_red_gate_still_exits_1_with_counts_ok(self) -> None:
        exit_file = self.tmp / "exit.txt"
        exit_file.write_text("0", encoding="utf-8")
        code = ("import sys; print('5 passed'); "
                "sys.exit(int(open({!r}).read()))".format(str(exit_file)))
        self.write_config([{"name": "test", "cmd": py_cmd(code), "count_regex": "(\\d+) passed"}])
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        exit_file.write_text("1", encoding="utf-8")
        self.assertEqual(self.run_main("--label", "red", "--min-count-from", "baseline"), 1)
        self.assertTrue(self.result("red")["count_check"]["passed"])

    def test_changed_gates_array_voids_the_reference(self) -> None:
        self.write_config([self.counter_gate()])
        self.set_count(5)
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        digest = self.result("baseline")["gates_sha256"]
        self.assertRegex(digest, r"^[0-9a-f]{64}$")
        raw = json.loads((self.repo / ".harden" / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(digest, G.gates_digest(raw["gates"]))
        # Replacing the test gate by one that always prints a high count is refused.
        self.write_config([printing_gate("99 passed\n", count_regex="(\\d+) passed")])
        proc = self.run_cli("--label", "step", "--min-count-from", "baseline")
        self.assertEqual(proc.returncode, 2)
        err = proc.stderr.decode("utf-8")
        self.assertIn("gates_sha256", err)
        self.assertIn("record the reference again", err)
        self.assertFalse((self.repo / ".harden" / "gates" / "step.json").exists())
        # A reference written without gates_sha256 (an older gates.py) is refused too.
        self.write_config([self.counter_gate()])
        path = self.repo / ".harden" / "gates" / "baseline.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data.pop("gates_sha256")
        path.write_text(json.dumps(data), encoding="utf-8")
        proc = self.run_cli("--label", "step", "--min-count-from", "baseline")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("an older gates.py", proc.stderr.decode("utf-8"))

    def test_changed_gates_advice_follows_the_run_mode(self) -> None:
        # With --interactive the user approves a new gate set; an autonomous run asks nobody
        # (user-policy-autonomy U01-F01) and leaves the change to the owner via the report.
        self.write_config([self.counter_gate()])
        self.set_count(5)
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        self.write_config([printing_gate("99 passed\n", count_regex="(\\d+) passed")])
        marker = self.repo / ".harden" / "active"
        cases = [({"mode": "auto"}, "owner item", "ask the user"),
                 ({"mode": "report-only", "mode_requested": "auto"}, "owner item",
                  "ask the user"),
                 ({"mode": "interactive"}, "ask the user", "owner item"),
                 ({"mode": "apply"}, "ask the user", "owner item"),
                 ({"mode": "report-only", "mode_requested": "interactive"}, "ask the user",
                  "owner item")]
        for fields, present, absent in cases:
            with self.subTest(marker=fields):
                marker.write_text(json.dumps(dict(base_sha="0" * 40, **fields)),
                                  encoding="utf-8")
                proc = self.run_cli("--label", "step", "--min-count-from", "baseline")
                err = proc.stderr.decode("utf-8")
                self.assertEqual(proc.returncode, 2, err)
                self.assertIn(present, err)
                self.assertNotIn(absent, err)
                self.assertIn("Restore the gates of 'baseline'", err)
        marker.unlink()
        self.assertIsNone(G.marker_asks_user([marker]))
        both = G.gate_change_advice(None, "record it again")
        for text in ("with --interactive, ask the user", "record it again", "owner item"):
            self.assertIn(text, both)

    def write_marker(self, meta: List[Dict[str, Any]]) -> None:
        (self.repo / ".harden" / "active").write_text(json.dumps({
            "base_sha": "0" * 40, "allow_test_deletions": [m["path"] for m in meta],
            "allow_test_deletions_meta": meta}), encoding="utf-8")

    def test_approved_case_deletions_lower_the_reference(self) -> None:
        self.write_config([self.counter_gate(), {"name": "lint", "cmd": "exit 0"}])
        self.set_count(5)
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        self.write_marker([{"path": "tests/test_a.py", "cases": 1},
                           {"path": "tests/test_b.py", "cases": 3},
                           {"path": "tests/test_a.py", "cases": 2}])   # latest record counts
        self.set_count(0)
        self.assertEqual(self.run_main("--label", "low", "--min-count-from", "baseline"), 0)
        check = self.result("low")["count_check"]
        self.assertEqual(check["adjustment"]["cases_removed"], 5)
        self.assertEqual(check["adjustment"]["records"],
                         {"tests/test_a.py": 2, "tests/test_b.py": 3})
        self.assertEqual((check["gates"]["test"]["reference_recorded"],
                          check["gates"]["test"]["reference"]), (5, 0))
        self.write_marker([{"path": "tests/test_a.py", "cases": 2}])
        self.set_count(3)
        proc = self.run_cli("--label", "ok", "--min-count-from", "baseline")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("count reference lowered by 2", proc.stdout.decode("utf-8"))
        self.set_count(2)
        self.assertEqual(self.run_main("--label", "drop", "--min-count-from", "baseline"), 1)
        self.assertIn("count dropped to 2 from 3",
                      self.result("drop")["count_check"]["failures"][0])

    def test_unusable_reference_exits_2_before_running(self) -> None:
        marker = self.tmp / "ran.txt"
        runs_marker = py_cmd("open({!r}, 'w').write('x'); print('3 passed')".format(str(marker)))
        self.write_config([{"name": "test", "cmd": runs_marker, "count_regex": "(\\d+) passed"}])
        self.assert_usage_error("--label", "x", "--min-count-from", "nope")
        self.assert_usage_error("--label", "x", "--min-count-from", "../escape")
        gates_dir = self.repo / ".harden" / "gates"
        gates_dir.mkdir(parents=True, exist_ok=True)
        (gates_dir / "broken.json").write_text("{not json", encoding="utf-8")
        self.assert_usage_error("--label", "x", "--min-count-from", "broken")
        (gates_dir / "other.json").write_text(json.dumps({"label": "other"}), encoding="utf-8")
        self.assert_usage_error("--label", "x", "--min-count-from", "other")
        self.assertFalse(marker.exists(), "gates ran although the reference was unusable")
        # A reference recorded without any count_regex cannot be compared: usage error too.
        self.write_config([{"name": "test", "cmd": "exit 0"}])
        self.assertEqual(self.run_main("--label", "old"), 0)
        proc = self.run_cli("--label", "x", "--min-count-from", "old")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("no selected gate has a count", proc.stderr.decode("utf-8"))
        # Adding the count_regex afterwards changes the gates array: the reference is void.
        self.write_config([{"name": "test", "cmd": runs_marker, "count_regex": "(\\d+) passed"}])
        proc = self.run_cli("--label", "x", "--min-count-from", "old")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("gates_sha256", proc.stderr.decode("utf-8"))
        self.assertFalse(marker.exists())

    def assert_usage_error(self, *args: str) -> None:
        proc = self.run_cli(*args)
        self.assertEqual(proc.returncode, 2, proc.stderr.decode("utf-8", "replace"))

    def test_reference_with_utf8_bom(self) -> None:
        self.write_config([self.counter_gate()])
        self.set_count(3)
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        path = self.repo / ".harden" / "gates" / "baseline.json"
        path.write_bytes(b"\xef\xbb\xbf" + path.read_bytes())
        self.set_count(2)
        self.assertEqual(self.run_main("--label", "s", "--min-count-from", "baseline"), 1)

    def test_check_counts_uses_highest_reference_and_lowest_current(self) -> None:
        gate = G.parse_gates({"gates": [{"name": "t", "cmd": "exit 0",
                                         "count_regex": "(\\d+)"}]}, self.repo)[0]
        ref_file = self.tmp / "ref.json"
        ref_file.write_text(json.dumps({"runs": [
            {"run": 1, "results": [{"name": "t", "count": 9}, {"name": "u", "count": None}]},
            {"run": 2, "results": [{"name": "t", "count": 10}, {"name": "u", "count": True}]},
        ]}), encoding="utf-8")
        ref = G.load_reference_counts(ref_file)
        self.assertEqual(ref, {"t": 10, "u": None})
        runs = [{"run": 1, "results": [{"name": "t", "count": 11}]},
                {"run": 2, "results": [{"name": "t", "count": 10}]}]
        self.assertTrue(G.check_counts(ref, "b", ref_file, [gate], runs)["passed"])
        runs[1]["results"][0]["count"] = 9
        check = G.check_counts(ref, "b", ref_file, [gate], runs)
        self.assertFalse(check["passed"])
        self.assertEqual(check["gates"]["t"]["current_runs"], [11, 9])
        absent = G.check_counts({}, "b", ref_file, [gate], runs)
        self.assertTrue(absent["passed"])
        self.assertEqual(absent["not_compared"][0]["reason"], "gate absent from 'b'")

    # Violation summaries for the ratchet gates of assets/config.example.json. ESLint: a run of
    # eslint 8.57.1 on 2026-09-24 (the summary line matches lib/cli-engine/formatters/
    # stylish.js of eslint 9.39.4). cargo fmt: a run of rustfmt 1.8.0-stable on 2026-09-24,
    # colour codes kept. Ruff: the format strings of crates/ruff/src/printer.rs and
    # crates/ruff/src/commands/format.rs on astral-sh/ruff main, read 2026-09-24.
    ESLINT_3 = ("\nC:\\proj\\two.js\n"
                "  1:1  warning  Unexpected var, use let or const instead  no-var\n"
                "  2:1  warning  Unexpected var, use let or const instead  no-var\n"
                "  2:5  error    'b' is assigned a value but never used    no-unused-vars\n\n"
                "\u2716 3 problems (1 error, 2 warnings)\n"
                "  0 errors and 2 warnings potentially fixable with the `--fix` option.\n\n")
    ESLINT_1 = ("\nC:\\proj\\two.js\n"
                "  1:7  error  'c' is assigned a value but never used  no-unused-vars\n\n"
                "\u2716 1 problem (1 error, 0 warnings)\n\n")
    CARGO_FMT_3 = ("Diff in \\\\?\\C:\\proj\\src\\lib.rs:1:\n"
                   "\x1b[31m-pub fn a( x:i32)->i32{x+1}\n"
                   "\x1b[0m\x1b[32m+pub fn a(x: i32) -> i32 {\n"
                   "\x1b[0m\x1b[32m+    x + 1\n\x1b[0m\x1b[32m+}\n\x1b[0m \n"
                   " pub fn ok(x: i32) -> i32 {\n     x\n"
                   "Diff in \\\\?\\C:\\proj\\src\\lib.rs:5:\n }\n \n"
                   "\x1b[31m-pub fn b(  y:i32 ) -> i32 {\n\x1b[0m\x1b[31m-    y  *2\n"
                   "\x1b[0m\x1b[32m+pub fn b(y: i32) -> i32 {\n\x1b[0m\x1b[32m+    y * 2\n"
                   "\x1b[0m }\n \n"
                   "Diff in \\\\?\\C:\\proj\\src\\main.rs:1:\n"
                   "\x1b[31m-fn main(){println!(\"hi\");}\n"
                   "\x1b[0m\x1b[32m+fn main() {\n\x1b[0m\x1b[32m+    println!(\"hi\");\n"
                   "\x1b[0m\x1b[32m+}\n\x1b[0m \n")
    CARGO_FMT_PARSE_ERROR = ("error: this file contains an unclosed delimiter\n"
                             " --> \\\\?\\C:\\proj\\src\\lib.rs:1:18\n  |\n"
                             "1 | pub fn broken( {\n")

    def test_config_example_count_regexes_match_real_runner_output(self) -> None:
        example = SCRIPTS.parent / "assets" / "config.example.json"
        data = json.loads(example.read_text(encoding="utf-8-sig"))
        samples = {
            "pytest": [("....s.\n5 passed, 1 skipped, 2 warnings in 0.12s\n", 5)],
            "vitest": [(" \x1b[2m Test Files \x1b[22m \x1b[1m\x1b[32m2 passed\x1b[39m\x1b[22m (2)\n"
                        " \x1b[2m     Tests \x1b[22m \x1b[1m\x1b[32m7 passed\x1b[39m\x1b[22m (7)\n"
                        " \x1b[2m  Start at \x1b[22m 10:00:00\n", 7)],
            "cargo test": [("running 3 tests\ntest a ... ok\n\n"
                            "test result: ok. 3 passed; 0 failed; "
                            "0 ignored; 0 measured; 0 filtered out; finished in 0.00s\n\n"
                            "running 2 tests\ntest result: ok. 2 passed; 0 failed; 0 ignored\n\n"
                            "   Doc-tests demo\n\ntest result: ok. 0 passed; 0 failed; 0 ignored\n",
                            5)],
            "eslint": [(self.ESLINT_3, 3), (self.ESLINT_1, 1), ("", None)],
            "ruff check": [("Found 3 errors.\n[*] 2 fixable with the `--fix` option.\n", 3),
                           ("Found 1 error.\n", 1), ("All checks passed!\n", None)],
            "ruff format": [("2 files would be reformatted, 5 files already formatted\n", 2),
                            ("1 file would be reformatted\n", 1),
                            ("7 files already formatted\n", None)],
            "cargo fmt": [(self.CARGO_FMT_3, 3), ("", 0), (self.CARGO_FMT_PARSE_ERROR, 0)],
        }
        runners = [("pytest", "pytest"), ("vitest", "vitest"), ("cargo test", "cargo test"),
                   ("cargo fmt", "cargo fmt"), ("ruff check", "ruff check"),
                   ("ruff format", "ruff format"), ("pnpm run lint", "eslint")]
        seen = set()
        for example_cfg in data["examples"]:
            for gate in G.parse_gates(example_cfg, self.repo):
                if gate.count_regex is None:
                    continue
                runner = next(key for needle, key in runners if needle in " ".join(gate.cmd))
                seen.add(runner)
                self.assertEqual(gate.ratchet, runner in ("eslint", "ruff check", "ruff format",
                                                          "cargo fmt"), runner)
                for text, expected in samples[runner]:
                    count, _, problem = G.extract_count(gate, text.encode("utf-8"), b"")
                    self.assertEqual(count, expected, (runner, text[-60:], problem))
        self.assertEqual(seen, {name for _needle, name in runners})
        # A cargo fmt parse error counts 0 hunks with exit code 1: unreadable, never a pass.
        self.assertIsNone(G.ratchet_run_count({"exit_code": 1, "timed_out": False,
                                               "count": 0})[0])
        # examples[3] is the ratchet.json of examples[2]: its gate is the probed gate unchanged.
        probed = {g.name: g for g in G.parse_gates(data["examples"][2], self.repo)}
        for gate in G.parse_gates(data["examples"][3], self.repo):
            self.assertTrue(gate.ratchet)
            self.assertEqual(gate.identity_sha256(), probed[gate.name].identity_sha256())


class RatchetTests(GateTestBase):
    """"ratchet": true gates and --ratchet-from (PF-11: no new violations; the exit code of a
    ratchet gate is not a failure by itself)."""

    LINT_RE = "(\\d+) problems? \\("

    def lint_gate(self, **extra: Any) -> Dict[str, Any]:
        """An ESLint-like gate: prints '<N> problem(s) (...)' unless N is 0 (ESLint prints
        nothing when clean), then exits with the code the test sets."""
        self.state = self.tmp / "lint.txt"
        code = ("import sys; n, rc = open({!r}).read().split(); n = int(n); "
                "n and print('src/a.js\\n  1:1  error  x  no-var\\n\\n%d problem%s (%d errors, "
                "0 warnings)' % (n, '' if n == 1 else 's', n)); sys.exit(int(rc))").format(
                    str(self.state))
        gate: Dict[str, Any] = {"name": "lint", "cmd": py_cmd(code), "count_regex": self.LINT_RE}
        gate.update(extra)
        return gate

    def set_lint(self, count: int, exit_code: int) -> None:
        self.state.write_text("{} {}".format(count, exit_code), encoding="utf-8")

    def write_ratchet_config(self, gates: List[Dict[str, Any]]) -> Path:
        path = self.repo / ".harden" / "ratchet.json"
        path.write_text(json.dumps({"gates": gates}), encoding="utf-8")
        return path

    def probe(self, count: int, exit_code: int = 1) -> None:
        """Record the probe from .harden/config.json with the gate as it was before it became
        a ratchet (no "ratchet" key), as protocol-preflight step 11 does."""
        self.write_config([self.lint_gate()])
        self.set_lint(count, exit_code)
        self.assertEqual(self.run_main("--label", "probe"), 0 if exit_code == 0 else 1)

    def ratchet_cli(self, label: str, *extra: str) -> "subprocess.CompletedProcess[bytes]":
        return self.run_cli("--config", str(self.repo / ".harden" / "ratchet.json"),
                            "--label", label, "--ratchet-from", "probe", *extra)

    def test_config_validation_and_gate_identity(self) -> None:
        for bad in ({"ratchet": "yes", "count_regex": self.LINT_RE},
                    {"ratchet": True},                          # no count to judge by
                    {"ratchet": True, "count_regex": "no group"}):
            with self.subTest(bad=bad):
                with self.assertRaises(G.ConfigError):
                    G.parse_gates({"gates": [dict({"name": "l", "cmd": "exit 0"}, **bad)]},
                                  self.repo)
        # count_mode "matches" reads no group, so a regex without one is accepted.
        hunks = G.parse_gates({"gates": [{"name": "fmt", "cmd": "exit 0", "ratchet": True,
                                          "count_regex": "^Diff in ",
                                          "count_mode": "matches"}]}, self.repo)[0]
        described = hunks.describe()
        self.assertTrue(described["ratchet"])
        self.assertRegex(described["gate_sha256"], r"^[0-9a-f]{64}$")
        plain = G.parse_gates({"gates": [{"name": "fmt", "cmd": "exit 0",
                                          "count_regex": "^Diff in ",
                                          "count_mode": "matches"}]}, self.repo)[0]
        self.assertNotIn("ratchet", plain.describe())
        # Adding "ratchet" keeps the identity; any other change breaks it.
        self.assertEqual(plain.identity_sha256(), hunks.identity_sha256())
        for change in ({"cmd": "exit 1"}, {"timeout_s": 5}, {"count_mode": "sum",
                                                             "count_regex": "(\\d+)"},
                       {"env": {"A": "b"}}, {"inherit_env": False}):
            with self.subTest(change=change):
                other = G.parse_gates({"gates": [dict({"name": "fmt", "cmd": "exit 0",
                                                       "count_regex": "^Diff in ",
                                                       "count_mode": "matches"}, **change)]},
                                      self.repo)[0]
                self.assertNotEqual(other.identity_sha256(), plain.identity_sha256())

    def test_matches_mode_counts_every_match_and_zero_is_a_count(self) -> None:
        self.write_config([printing_gate("Diff in a.rs:1:\nx\nDiff in a.rs:9:\n", name="fmt",
                                         count_regex="^Diff in ", count_mode="matches"),
                           printing_gate("clean\n", name="clean", count_regex="^Diff in ",
                                         count_mode="matches")])
        self.assertEqual(self.run_main("--label", "m"), 0)
        recs = {r["name"]: r for r in self.result("m")["runs"][0]["results"]}
        self.assertEqual((recs["fmt"]["count"], recs["fmt"]["count_matches"]), (2, 2))
        self.assertEqual(recs["clean"]["count"], 0)
        self.assertNotIn("count_error", recs["clean"])

    def test_red_exit_passes_while_the_count_stays_or_falls(self) -> None:
        self.probe(5)
        self.write_ratchet_config([self.lint_gate(ratchet=True)])
        for label, count, exit_code in (("same", 5, 1), ("fewer", 2, 1), ("clean", 0, 0)):
            with self.subTest(label=label):
                self.set_lint(count, exit_code)
                proc = self.ratchet_cli(label)
                self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
                res = self.result(label)
                ratchet = res["summary"]["lint"]["ratchet"]
                self.assertEqual((ratchet["reference"], ratchet["current"], ratchet["passed"]),
                                 (5, count, True))
                self.assertEqual(ratchet["status"], "ok")
                self.assertTrue(res["ratchet_check"]["passed"])
                self.assertEqual(res["ratchet_check"]["reference_label"], "probe")
                self.assertTrue(res["all_passed"])      # the red exit code is not a failure
                self.assertIn("ratchet check against 'probe': passed",
                              proc.stdout.decode("utf-8"))
        # ESLint prints nothing when clean: exit 0 without a match counts 0 violations.
        rec = self.result("clean")["runs"][0]["results"][0]
        self.assertEqual(rec["count"], 0)
        self.assertIn("exit code 0", rec["count_inferred"])
        self.assertNotIn("count_error", rec)

    def test_a_rising_count_fails(self) -> None:
        self.probe(5)
        self.write_ratchet_config([self.lint_gate(ratchet=True)])
        self.set_lint(6, 1)
        proc = self.ratchet_cli("i1-a1-ratchet")
        self.assertEqual(proc.returncode, 1)
        err = proc.stderr.decode("utf-8")
        self.assertIn("violation count rose to 6 from 5", err)
        self.assertIn("PF-11", err)
        self.assertIn("RATCHET FAIL", proc.stdout.decode("utf-8"))
        res = self.result("i1-a1-ratchet")
        ratchet = res["summary"]["lint"]["ratchet"]
        self.assertEqual((ratchet["reference"], ratchet["current"], ratchet["passed"]),
                         (5, 6, False))
        self.assertEqual(ratchet["status"], "rose")
        self.assertFalse(res["ratchet_check"]["passed"])
        # A rise also fails when the tool itself exits 0 (warnings only).
        self.set_lint(7, 0)
        self.assertEqual(self.ratchet_cli("warn").returncode, 1)

    def test_an_unreadable_count_fails(self) -> None:
        self.probe(5)
        self.write_ratchet_config([self.lint_gate(ratchet=True)])
        self.set_lint(0, 2)                             # a crash: no summary, exit code 2
        proc = self.ratchet_cli("crash")
        self.assertEqual(proc.returncode, 1)
        self.assertIn("violation count cannot be read", proc.stderr.decode("utf-8"))
        ratchet = self.result("crash")["summary"]["lint"]["ratchet"]
        self.assertEqual((ratchet["current"], ratchet["passed"], ratchet["status"]),
                         (None, False, "unreadable"))
        cases = [({"exit_code": 1, "timed_out": False, "count": 0}, "failed without reporting"),
                 ({"exit_code": None, "timed_out": False, "count": None,
                   "error": "could not start: x"}, "could not start"),
                 ({"exit_code": 1, "timed_out": True, "count": 3}, "timed out"),
                 ({"exit_code": 1, "timed_out": False, "count": None,
                   "count_error": "count_regex matched nothing in the output"}, "matched nothing")]
        for rec, why in cases:
            with self.subTest(rec=rec):
                count, reason = G.ratchet_run_count(rec)
                self.assertIsNone(count)
                self.assertIn(why, reason)
        self.assertEqual(G.ratchet_run_count({"exit_code": 1, "timed_out": False, "count": 4}),
                         (4, None))
        self.assertEqual(G.ratchet_run_count({"exit_code": 0, "timed_out": False, "count": 0}),
                         (0, None))

    def test_repeats_compare_the_highest_count_and_flag_varying_counts(self) -> None:
        counter = self.tmp / "n.txt"
        code = ("import sys; p = {!r}; n = int(open(p).read()); open(p, 'w').write(str(n + 2)); "
                "print('%d problems (%d errors, 0 warnings)' % (n, n)); sys.exit(1)").format(
                    str(counter))
        gate = {"name": "lint", "cmd": py_cmd(code), "count_regex": self.LINT_RE}
        self.write_config([gate])
        counter.write_text("4", encoding="utf-8")
        self.assertEqual(self.run_main("--label", "probe"), 1)
        self.write_ratchet_config([dict(gate, ratchet=True)])
        counter.write_text("3", encoding="utf-8")       # runs print 3, then 5
        proc = self.ratchet_cli("rep", "--repeat", "2")
        self.assertEqual(proc.returncode, 1)
        res = self.result("rep")
        ratchet = res["summary"]["lint"]["ratchet"]
        self.assertEqual((ratchet["current_runs"], ratchet["current"]), ([3, 5], 5))
        self.assertEqual(res["flaky"], ["lint"])
        self.assertTrue(res["summary"]["lint"]["flaky"])

    def test_other_gates_keep_their_exit_code_verdict(self) -> None:
        self.probe(5)
        self.write_ratchet_config([self.lint_gate(ratchet=True),
                                   {"name": "other", "cmd": "exit 3"}])
        self.set_lint(5, 1)
        proc = self.ratchet_cli("mixed")
        self.assertEqual(proc.returncode, 1)
        res = self.result("mixed")
        self.assertTrue(res["ratchet_check"]["passed"])
        self.assertFalse(res["all_passed"])
        self.assertNotIn("ratchet", res["summary"]["other"])

    def test_without_ratchet_from_the_exit_code_decides(self) -> None:
        self.probe(5)
        ratchet_path = self.write_ratchet_config([self.lint_gate(ratchet=True)])
        self.set_lint(5, 1)
        self.assertEqual(self.run_main("--config", str(ratchet_path), "--label", "plain"), 1)
        self.assertIsNone(self.result("plain")["ratchet_check"])
        self.assertNotIn("ratchet", self.result("plain")["summary"]["lint"])

    def test_min_count_from_never_compares_a_ratchet_gate(self) -> None:
        tests = self.tmp / "tests.txt"
        tests.write_text("4", encoding="utf-8")
        test_gate = {"name": "test", "count_regex": "(\\d+) passed", "cmd": py_cmd(
            "print(open({!r}).read().strip() + ' passed')".format(str(tests)))}
        self.write_config([test_gate, self.lint_gate(ratchet=True)])
        self.set_lint(5, 0)                             # warnings only: the gate is green
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        self.set_lint(3, 0)                             # fewer warnings is not a dropped count
        self.assertEqual(self.run_main("--label", "step", "--min-count-from", "baseline"), 0)
        check = self.result("step")["count_check"]
        self.assertEqual(check["gates"]["test"]["status"], "ok")
        self.assertNotIn("lint", check["gates"])
        self.assertIn("ratchet gate", [n for n in check["not_compared"]
                                       if n["gate"] == "lint"][0]["reason"])
        # A reference whose only count belongs to a ratchet gate cannot serve --min-count-from.
        self.write_config([self.lint_gate(ratchet=True)])
        self.set_lint(5, 0)
        self.assertEqual(self.run_main("--label", "lint-only"), 0)
        proc = self.run_cli("--label", "x", "--min-count-from", "lint-only")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("ratchet gates are not compared", proc.stderr.decode("utf-8"))

    def test_unusable_reference_exits_2_before_running(self) -> None:
        gates_dir = self.repo / ".harden" / "gates"

        def refused(label: str, needle: str) -> None:
            proc = self.ratchet_cli(label)
            err = proc.stderr.decode("utf-8", "replace")
            self.assertEqual(proc.returncode, 2, err)
            self.assertIn(needle, err)
            self.assertFalse((gates_dir / "{}.json".format(label)).exists(),
                             "gates ran although the reference was unusable")

        self.probe(5)
        self.write_ratchet_config([self.lint_gate(ratchet=True)])
        self.set_lint(9, 1)
        # No ratchet gate selected (the main config has none).
        proc = self.run_cli("--label", "none", "--ratchet-from", "probe")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("no selected gate has \"ratchet\": true", proc.stderr.decode("utf-8"))
        # Missing reference, bad label.
        proc = self.run_cli("--config", str(self.repo / ".harden" / "ratchet.json"),
                            "--label", "x", "--ratchet-from", "nope")
        self.assertEqual(proc.returncode, 2)
        self.assertIn("reference result not found", proc.stderr.decode("utf-8"))
        self.assertEqual(self.run_cli("--label", "x", "--ratchet-from", "../up").returncode, 2)
        # A ratchet gate the probe never ran.
        self.write_ratchet_config([self.lint_gate(ratchet=True, name="lint2")])
        refused("absent", "absent from 'probe'")
        # A ratchet gate changed after the probe (a longer timeout, a looser regex, ...).
        self.write_ratchet_config([self.lint_gate(ratchet=True, timeout_s=5)])
        refused("changed", "is not the gate 'probe' ran")
        refused("changed", "record 'probe' again")      # no marker: both routes are named
        refused("changed", "owner item")
        marker = self.repo / ".harden" / "active"
        marker.write_text(json.dumps({"mode": "auto"}), encoding="utf-8")
        refused("changed", "an autonomous run asks nobody")
        self.assertNotIn("ask the user", self.ratchet_cli("changed").stderr.decode("utf-8"))
        marker.write_text(json.dumps({"mode": "interactive"}), encoding="utf-8")
        refused("changed", "ask the user to approve the new gates, then record 'probe' again")
        marker.unlink()
        # A probe written by an older gates.py has no per-gate gate_sha256.
        self.write_ratchet_config([self.lint_gate(ratchet=True)])
        probe_path = gates_dir / "probe.json"
        data = json.loads(probe_path.read_text(encoding="utf-8"))
        for described in data["gates"]:
            described.pop("gate_sha256")
        probe_path.write_text(json.dumps(data), encoding="utf-8")
        refused("older", "an older gates.py")
        # A gate green at the probe is not a ratchet (PF-11).
        self.probe(0, exit_code=0)
        refused("green", "passed in every run of 'probe'")
        # A red probe without a readable count cannot be a reference.
        self.probe(0, exit_code=2)
        refused("uncounted", "no readable violation count")


def _git_ok() -> bool:
    try:
        return subprocess.run(["git", "--version"], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE).returncode == 0
    except OSError:
        return False


@unittest.skipUnless(_git_ok(), "git not available")
class RepoAndOutDirTests(GateTestBase):
    """--repo on a fresh clone with --out-dir back to the working tree (PF-10)."""

    GIT_ID = ["-c", "user.name=Harden Test", "-c", "user.email=harden@example.invalid",
              "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"]

    def git(self, cwd: Path, *args: str) -> str:
        proc = subprocess.run(["git"] + self.GIT_ID + list(args), cwd=str(cwd),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        return proc.stdout.decode("utf-8", "replace").strip()

    def setUp(self) -> None:
        super().setUp()
        (self.repo / "sub").mkdir()
        (self.repo / "sub" / "a.txt").write_text("x\n", encoding="utf-8")
        self.git(self.repo, "init", "-q")
        self.git(self.repo, "add", "sub")
        self.git(self.repo, "commit", "-q", "-m", "base")
        self.base = self.git(self.repo, "rev-parse", "HEAD")
        self.write_config([{"name": "where", "cwd": "sub", "count_regex": "(\\d+) passed",
                            "cmd": py_cmd("import os; print(os.getcwd()); print('4 passed')")}])
        self.clone = self.tmp / "fresh"
        self.git(self.tmp, "clone", "-q", "--no-local", str(self.repo), str(self.clone))

    def test_fresh_clone_run_writes_to_the_working_tree(self) -> None:
        config = self.repo / ".harden" / "config.json"
        gates_dir = self.repo / ".harden" / "gates"
        self.assertEqual(self.run_main("--label", "baseline"), 0)
        rc = self._quiet_main("--repo", str(self.clone), "--config", str(config), "--out-dir",
                              str(gates_dir), "--label", "fresh-clone", "--min-count-from",
                              "baseline")
        self.assertEqual(rc, 0)
        res = self.result("fresh-clone")
        rec = res["runs"][0]["results"][0]
        ran_in = Path(rec["stdout_tail"].splitlines()[0]).resolve()
        self.assertEqual(ran_in, (self.clone / "sub").resolve())
        self.assertEqual(res["git_head"], self.base)
        self.assertEqual(Path(res["repo"]).resolve(), self.clone.resolve())
        self.assertEqual(Path(res["out_dir"]).resolve(), gates_dir.resolve())
        self.assertTrue(res["count_check"]["passed"])
        self.assertTrue(any("outside --repo" in n for n in res["notes"]))
        self.assertTrue(Path(rec["log_paths"]["stdout"]).resolve().is_relative_to(
            (gates_dir / "logs" / "fresh-clone").resolve()))
        # Nothing was written inside the clone.
        self.assertFalse((self.clone / ".harden").exists())
        exclude = (self.clone / ".git" / "info" / "exclude").read_text(encoding="utf-8")
        self.assertNotIn(".harden", exclude)
        self.assertEqual(self.git(self.clone, "status", "--porcelain"), "")

    def _quiet_main(self, *args: str) -> int:
        with contextlib.redirect_stdout(io.StringIO()):
            return G.main(list(args))

    def test_subdirectory_repo_resolves_to_the_root(self) -> None:
        self.assertEqual(self._quiet_main("--repo", str(self.repo / "sub"), "--label", "sub"), 0)
        res = self.result("sub")
        self.assertEqual(Path(res["repo"]).resolve(), self.repo.resolve())
        ran_in = Path(res["runs"][0]["results"][0]["stdout_tail"].splitlines()[0]).resolve()
        self.assertEqual(ran_in, (self.repo / "sub").resolve())

    def test_clone_without_config_explains_the_config_flag(self) -> None:
        proc = subprocess.run([PY, str(SCRIPTS / "gates.py"), "--repo", str(self.clone),
                               "--label", "x"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=120)
        self.assertEqual(proc.returncode, 2)
        self.assertIn("--config", proc.stderr.decode("utf-8"))
        self.assertFalse((self.clone / ".harden").exists())

    def test_relative_out_dir_and_config_resolve_against_cwd(self) -> None:
        proc = subprocess.run([PY, str(SCRIPTS / "gates.py"), "--repo", "fresh", "--config",
                               "proj/.harden/config.json", "--out-dir", "results", "--label", "r"],
                              cwd=str(self.tmp), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        self.assertTrue((self.tmp / "results" / "r.json").is_file())
        self.assertTrue((self.tmp / "results" / "logs" / "r").is_dir())
        self.assertFalse((self.clone / ".harden").exists())

    def test_out_dir_that_is_a_file_is_a_usage_error(self) -> None:
        blocker = self.tmp / "blocker.txt"
        blocker.write_text("x", encoding="utf-8")
        self.assertEqual(self._quiet_main_err("--repo", str(self.repo), "--out-dir", str(blocker),
                                              "--label", "x"), 2)

    def _quiet_main_err(self, *args: str) -> int:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return G.main(list(args))

    def test_absolute_cwd_outside_repo_is_noted(self) -> None:
        outside = self.tmp / "elsewhere"
        outside.mkdir()
        self.write_config([{"name": "abs", "cwd": outside.as_posix(), "cmd": "exit 0"}])
        self.assertEqual(self._quiet_main("--repo", str(self.repo), "--label", "abs"), 0)
        self.assertTrue(any("absolute cwd outside --repo" in n
                            for n in self.result("abs")["notes"]))


class ReuseTests(GateTestBase):
    """Evidence reuse (pilot-auto-calibration A01-F40): a commit whose exact, clean tree
    already passed every gate is recorded as reused; any unmet precondition runs the gates."""

    GATE = py_cmd("open('ran.txt','a').write('x')")

    def setUp(self) -> None:
        super().setUp()
        cfg = self.tmp / "gitconfig"
        cfg.write_bytes(b"[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                        b"[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                        b"[core]\n\tautocrlf = false\n")
        self._saved = {k: os.environ.get(k) for k in ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM")}
        os.environ["GIT_CONFIG_GLOBAL"] = str(cfg)
        os.environ["GIT_CONFIG_NOSYSTEM"] = "1"
        self.git("init", "-q")
        (self.repo / ".git" / "info").mkdir(parents=True, exist_ok=True)
        (self.repo / ".git" / "info" / "exclude").write_bytes(b".harden/\n")
        (self.repo / ".gitignore").write_bytes(b"ran.txt\n")
        (self.repo / "a.txt").write_bytes(b"one\n")
        self.git("add", "-A")
        self.git("commit", "-q", "-m", "init")
        self.write_config([{"name": "g", "cmd": self.GATE}])

    def tearDown(self) -> None:
        for key, value in self._saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        super().tearDown()

    def git(self, *args: str) -> str:
        proc = subprocess.run(["git", *args], cwd=str(self.repo), stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode(errors="replace"))
        return proc.stdout.decode("utf-8", errors="replace").strip()

    def ran(self) -> int:
        path = self.repo / "ran.txt"
        return len(path.read_bytes()) if path.exists() else 0

    def item_run_then_commit(self) -> None:
        (self.repo / "a.txt").write_bytes(b"two\n")
        self.git("add", "a.txt")
        self.assertEqual(self.run_main("--label", "item-a1"), 0)
        self.git("commit", "-q", "-m", "item")

    def edit_record(self, label: str, **changes: Any) -> None:
        path = self.repo / ".harden" / "gates" / "{}.json".format(label)
        rec = json.loads(path.read_bytes().decode("utf-8"))
        rec.update(changes)
        path.write_bytes(json.dumps(rec).encode("utf-8"))

    def test_records_tree_state_and_reusable_tree(self) -> None:
        (self.repo / "a.txt").write_bytes(b"two\n")
        self.git("add", "a.txt")
        self.assertEqual(self.run_main("--label", "item-a1"), 0)
        rec = self.result("item-a1")
        self.assertEqual(rec["reusable_tree"], self.git("write-tree"))
        self.assertEqual(rec["tree"]["start"], rec["tree"]["end"])
        self.assertIs(rec["tree"]["start"]["unstaged"], False)
        self.assertEqual(rec["tree"]["start"]["untracked"], 0)

    def test_reuse_if_tree_reuses_a_green_run_of_the_same_tree(self) -> None:
        self.item_run_then_commit()
        before = self.ran()
        self.assertEqual(self.run_main("--label", "commit-X", "--reuse-if-tree", "HEAD"), 0)
        rec = self.result("commit-X")
        self.assertEqual(rec["reused_from"], "item-a1")
        self.assertEqual(rec["runs"], [])
        self.assertIsNone(rec["reusable_tree"])
        self.assertEqual(self.ran(), before)

    def test_a_reuse_is_never_reused(self) -> None:
        self.item_run_then_commit()
        self.assertEqual(self.run_main("--label", "commit-X", "--reuse-if-tree", "HEAD"), 0)
        rec = self.result("commit-X")
        tree = self.git("rev-parse", "HEAD^{tree}")
        self.assertIsNone(G.find_reusable_record(self.repo / ".harden" / "gates", tree,
                                                 rec["gates_sha256"], ["other"]))
        self.edit_record("item-a1", reusable_tree=None)
        self.edit_record("commit-X", reusable_tree=tree)
        self.assertIsNone(G.find_reusable_record(self.repo / ".harden" / "gates", tree,
                                                 rec["gates_sha256"], ["g"]))

    def test_reuse_refused_when_gates_changed(self) -> None:
        self.item_run_then_commit()
        self.write_config([{"name": "g", "cmd": py_cmd("open('ran.txt','a').write('yy')")}])
        before = self.ran()
        self.assertEqual(self.run_main("--label", "commit-X", "--reuse-if-tree", "HEAD"), 0)
        rec = self.result("commit-X")
        self.assertNotIn("reused_from", rec)
        self.assertEqual(self.ran(), before + 2)
        self.assertTrue(any(n.startswith("no reuse") for n in rec["notes"]))

    def test_no_reuse_after_unstaged_changes(self) -> None:
        (self.repo / "a.txt").write_bytes(b"unstaged\n")
        self.assertEqual(self.run_main("--label", "item-a1"), 0)
        rec = self.result("item-a1")
        self.assertIs(rec["tree"]["start"]["unstaged"], True)
        self.assertIsNone(rec["reusable_tree"])

    def test_reuse_if_tree_requires_the_checked_out_tree(self) -> None:
        self.item_run_then_commit()
        before = self.ran()
        self.assertEqual(self.run_main("--label", "commit-Y", "--reuse-if-tree", "HEAD~1"), 0)
        rec = self.result("commit-Y")
        self.assertNotIn("reused_from", rec)
        self.assertEqual(self.ran(), before + 1)
        self.assertTrue(any(n.startswith("no reuse: the working tree is not REV's tree")
                            for n in rec["notes"]))

    def test_reuse_precondition_failure_runs_the_gates(self) -> None:
        self.item_run_then_commit()
        (self.repo / "junk.txt").write_bytes(b"junk\n")
        before = self.ran()
        self.assertEqual(self.run_main("--label", "commit-X", "--reuse-if-tree", "HEAD"), 0)
        rec = self.result("commit-X")
        self.assertNotIn("reused_from", rec)
        self.assertEqual(self.ran(), before + 1)
        self.assertIn("no reuse: 1 untracked file(s) outside .harden/; every gate ran",
                      rec["notes"])

    def test_no_reuse_of_a_record_whose_count_check_failed(self) -> None:
        self.item_run_then_commit()
        self.edit_record("item-a1", count_check={"passed": False, "failures": ["dropped"]})
        before = self.ran()
        self.assertEqual(self.run_main("--label", "commit-X", "--reuse-if-tree", "HEAD"), 0)
        self.assertNotIn("reused_from", self.result("commit-X"))
        self.assertEqual(self.ran(), before + 1)

    def test_no_reuse_of_a_flaky_record(self) -> None:
        self.item_run_then_commit()
        self.edit_record("item-a1", flaky=["g"])
        before = self.ran()
        self.assertEqual(self.run_main("--label", "commit-X", "--reuse-if-tree", "HEAD"), 0)
        self.assertNotIn("reused_from", self.result("commit-X"))
        self.assertEqual(self.ran(), before + 1)

    def test_reuse_if_tree_flag_conflicts(self) -> None:
        for extra in (["--only", "g"], ["--min-count-from", "baseline"],
                      ["--ratchet-from", "probe"], ["--repeat", "2"]):
            proc = self.run_cli("--label", "c", "--reuse-if-tree", "HEAD", *extra)
            self.assertEqual(proc.returncode, 2, extra)
            self.assertIn(b"--reuse-if-tree cannot be combined with", proc.stderr)
        proc = self.run_cli("--label", "c", "--reuse-if-tree", "no-such-rev")
        self.assertEqual(proc.returncode, 2)
        self.assertIn(b"names no commit or tree", proc.stderr)
        self.assertEqual(self.ran(), 0)


class GateTests(GateTestBase):
    """Gates and the run profile's forbidden commands (user-policy-autonomy U01-F03)."""

    def test_forbidden_gate_is_refused(self) -> None:
        self.write_config([{"name": "ok", "cmd": py_cmd("open('ok.txt','a').write('x')")},
                           {"name": "sign", "cmd": py_cmd("open('sign-tx.txt','a').write('x')")}])
        for marker in ({"mode": "auto", "forbidden_commands": ["sign-tx"]},
                       {"mode": "auto", "profile": {"forbidden_commands": ["/SIGN-TX/i"]}}):
            (self.repo / ".harden" / "active").write_bytes(json.dumps(marker).encode("utf-8"))
            proc = self.run_cli("--label", "x")
            self.assertEqual(proc.returncode, 2, proc.stderr)
            self.assertIn(b"forbidden by the run profile", proc.stderr)
            self.assertFalse((self.repo / "ok.txt").exists())
            self.assertFalse((self.repo / "sign-tx.txt").exists())
        proc = self.run_cli("--label", "x", "--only", "ok")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue((self.repo / "ok.txt").exists())


if __name__ == "__main__":
    unittest.main()
