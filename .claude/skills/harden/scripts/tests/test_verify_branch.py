"""Tests for scripts/verify_branch.py (unittest, temporary git repositories).

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import verify_branch as vb  # noqa: E402

SCRIPT = SCRIPTS / "verify_branch.py"
_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None

# A gate that fails when value.txt starts with "broken" (so a later edit of the same line
# keeps it red), and a counted test gate.
CHECK_PY = ("import sys\n"
            "name = sys.argv[1] if len(sys.argv) > 1 else 'value.txt'\n"
            "value = open(name, encoding='utf-8').read().strip()\n"
            "print('checked', name, value)\n"
            "sys.exit(1 if value.startswith('broken') else 0)\n")
APP_PY = ("import datetime, os, sys\n"
          "print('started at', datetime.datetime.now(datetime.timezone.utc).isoformat())\n"
          "print('working in', os.getcwd())\n"
          "print('took', 12.5 if len(sys.argv) > 1 else 3, 'ms')\n"
          "print('result:', open('answer.txt', encoding='utf-8').read().strip())\n")


def setUpModule() -> None:
    """Isolate git from the user's global/system configuration."""
    global _GIT_HOME
    _GIT_HOME = tempfile.mkdtemp(prefix="harden-gitcfg-")
    cfg = Path(_GIT_HOME) / "gitconfig"
    cfg.write_text("[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                   "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                   "[core]\n\tautocrlf = false\n", encoding="utf-8")
    values = {"GIT_CONFIG_GLOBAL": str(cfg), "GIT_CONFIG_NOSYSTEM": "1",
              "GIT_AUTHOR_NAME": "Harden Test", "GIT_AUTHOR_EMAIL": "harden@example.invalid",
              "GIT_COMMITTER_NAME": "Harden Test", "GIT_COMMITTER_EMAIL": "harden@example.invalid"}
    for key, value in values.items():
        _SAVED_ENV[key] = os.environ.get(key)
        os.environ[key] = value


def tearDownModule() -> None:
    for key, value in _SAVED_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    if _GIT_HOME:
        _rmtree(_GIT_HOME)


def _rmtree(path: str) -> None:
    def fix(func, target, _exc):  # type: ignore[no-untyped-def]
        os.chmod(target, stat.S_IWRITE)
        func(target)
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=fix)
    else:
        shutil.rmtree(path, onerror=fix)


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=str(repo), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"git {args} failed: {proc.stderr.decode(errors='replace')}")
    return proc.stdout.decode("utf-8", errors="replace")


def _write(repo: Path, rel: str, text: str) -> None:
    target = repo / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as handle:  # Python 3.9
        handle.write(text)


def gate(name: str, *args: str, **extra: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {"name": name, "cmd": [sys.executable, "-S", *args], "cwd": ".",
                            "timeout_s": 120}
    data.update(extra)
    return data


class VerifyCase(unittest.TestCase):
    """A repository on a run branch with an active run marker and a scratch_dir."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="harden-vb-"))
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.scratch = self.root / "harden-scratch-test"
        self.scratch.mkdir()
        _git(self.repo, "init", "-q")
        _write(self.repo, "check.py", CHECK_PY)
        _write(self.repo, "value.txt", "ok\n")
        _write(self.repo, "other.txt", "ok\n")
        _write(self.repo, "app.py", APP_PY)
        _write(self.repo, "answer.txt", "42\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base")
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.base = self.head()
        self.config: Dict[str, Any] = {"gates": [gate("unit", "check.py")],
                                       "env_policy": "inherit", "install": []}
        self.write_config()
        self.write_marker()

    def tearDown(self) -> None:
        _rmtree(str(self.root))

    def head(self) -> str:
        return _git(self.repo, "rev-parse", "HEAD").strip()

    def commit(self, message: str, **files: str) -> str:
        for rel, content in files.items():
            _write(self.repo, rel.replace("__", "."), content)
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", message)
        return self.head()

    def write_config(self) -> None:
        _write(self.repo, ".harden/config.json", json.dumps(self.config))

    def write_marker(self, **extra: Any) -> None:
        data = {"base_sha": self.base, "branch": "harden/test", "mode": "auto",
                "started": "2026-09-24T00:00:00Z", "scratch_dir": self.scratch.as_posix(),
                "forbidden_commands": []}
        data.update(extra)
        _write(self.repo, ".harden/active", json.dumps(data))
        exclude = self.repo / ".git" / "info" / "exclude"
        with open(exclude, "a", encoding="utf-8") as handle:
            handle.write("\n/.harden/\n")

    def write_profile(self, **overrides: Any) -> str:
        profile = {"version": 1, "mode": "auto", "gates": [gate("unit", "check.py")],
                   "e2e": [], "network": "denied", "live_side_effects": "none",
                   "forbidden_commands": ["/\\bgit\\s+push\\b/"],
                   "situation": "maintenance only",
                   "auto_apply": {"structural": True, "behavioural": True,
                                  "dependencies": False, "money_paths": False},
                   "sandbox_ack": True}
        profile.update(overrides)
        _write(self.repo, ".harden/profile.json", json.dumps(profile))
        sha = hashlib.sha256((self.repo / ".harden" / "profile.json").read_bytes()).hexdigest()
        return sha

    def verify(self, *extra: str) -> Tuple[int, Dict[str, Any], str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = vb.main(["--base", self.base, "--repo", str(self.repo), *extra])
        path = self.repo / ".harden" / "verify.json"
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        return code, data, out.getvalue(), err.getvalue()

    def subjects(self) -> List[str]:
        return _git(self.repo, "log", "--format=%s", "{}..HEAD".format(self.base)).splitlines()


class LoopTests(VerifyCase):
    def test_commit_3_of_5_is_reverted_and_the_branch_ends_green(self) -> None:
        self.commit("feat: one", a__txt="1\n")
        self.commit("feat: two", b__txt="2\n")
        bad = self.commit("fix: three", value__txt="broken\n")
        self.commit("refactor: four", c__txt="4\n")
        self.commit("refactor: five", d__txt="5\n")
        code, data, out, err = self.verify()
        self.assertEqual(code, 0, out + err)
        self.assertEqual(data["final_status"], "green")
        self.assertEqual([r["sha"] for r in data["reverts"]], [bad])
        revert = data["reverts"][0]
        self.assertEqual((revert["subject"], revert["check"], revert["kind"]),
                         ("fix: three", "unit", "bisect"))
        self.assertIn("exit code 1", revert["reason"])
        self.assertIn("checked value.txt broken", revert["output_tail"])
        self.assertEqual(self.subjects()[0], 'Revert "fix: three"')
        self.assertEqual(revert["revert_sha"], self.head())
        self.assertEqual((self.repo / "value.txt").read_text(encoding="utf-8"), "ok\n")
        self.assertEqual(len(data["iterations"]), 2)
        self.assertEqual(data["iterations"][0]["bisect"]["first_bad"], bad)
        self.assertEqual(data["checks"][0]["status"], "green")
        roles = [c["role"] for c in data["clones"]]
        self.assertEqual(roles, ["base", "head", "head"])
        for clone in data["clones"]:
            self.assertTrue(Path(clone["path"]).resolve().is_relative_to(self.scratch.resolve()))
        self.assertEqual(data["clones"][-1]["sha"], self.head())  # the last clone is HEAD
        self.assertEqual(Path(data["clones"][1]["path"]).name, "verify-1")
        self.assertEqual(Path(data["clones"][0]["path"]).name, "verify-base")
        self.assertEqual(_git(self.repo, "status", "--porcelain", "--untracked-files=no"), "")
        self.assertIn("reverted", out)

    def test_no_failure_means_no_revert(self) -> None:
        self.commit("feat: one", a__txt="1\n")
        self.commit("feat: two", b__txt="2\n")
        before = self.head()
        code, data, out, err = self.verify()
        self.assertEqual(code, 0, out + err)
        self.assertEqual(data["final_status"], "green")
        self.assertEqual(data["reverts"], [])
        self.assertEqual(self.head(), before)
        self.assertEqual(data["head_at_end"], before)
        self.assertEqual(len(data["iterations"]), 1)
        self.assertNotIn("bisect", data["iterations"][0])
        self.assertTrue(data["gates_only"])

    def test_cap_reached_reverts_the_whole_applied_range(self) -> None:
        self.config["gates"].append(gate("other", "check.py", "other.txt"))
        self.write_config()
        self.commit("feat: one", a__txt="1\n")
        first_bad = self.commit("fix: two", value__txt="broken\n")
        self.commit("feat: three", b__txt="3\n")
        self.commit("fix: four", other__txt="broken\n")
        head_before = self.head()
        code, data, out, err = self.verify("--max-reverts", "1")
        self.assertEqual(code, 1, out + err)
        self.assertEqual(data["final_status"], "range-reverted")
        kinds = [(r["kind"], r["sha"]) for r in data["reverts"]]
        self.assertEqual(kinds[0], ("bisect", first_bad))
        range_part = [sha for kind, sha in kinds if kind == "range"]
        # Every commit of base..HEAD at the cap, newest first: the bisect revert included.
        expected = _git(self.repo, "rev-list", "--first-parent",
                        "{}..{}".format(self.base, data["range_revert"]["from"])).split()
        self.assertEqual(range_part, expected)
        self.assertIn(head_before, range_part)
        self.assertTrue(data["tree_equals_base"])
        _git(self.repo, "diff", "--quiet", self.base, "HEAD")
        self.assertIn("still red after 1 revert(s)", data["reverts"][-1]["reason"])
        self.assertEqual(data["reverts"][-1]["check"], "other")

    def test_a_revert_that_breaks_a_dependent_commit_reverts_the_range(self) -> None:
        # dep.py follows pointer.txt; commit 2 points it at a file only commit 1 creates, so
        # reverting commit 1 (which also breaks "unit") turns "dep" red at the revert itself.
        _write(self.repo, "dep.py", "import os, sys\n"
                                    "target = open('pointer.txt').read().strip()\n"
                                    "sys.exit(0 if os.path.exists(target) else 1)\n")
        _write(self.repo, "pointer.txt", "other.txt\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base: pointer")
        self.base = self.head()
        self.write_marker()
        self.config["gates"].append(gate("dep", "dep.py"))
        self.write_config()
        first = self.commit("fix: one", value__txt="broken\n", extra__txt="ok\n")
        second = self.commit("refactor: two", pointer__txt="extra.txt\n")
        code, data, out, err = self.verify()
        self.assertEqual(code, 1, out + err)
        self.assertEqual(data["final_status"], "range-reverted")
        self.assertEqual((data["reverts"][0]["kind"], data["reverts"][0]["sha"]),
                         ("bisect", first))
        range_part = [r["sha"] for r in data["reverts"] if r["kind"] == "range"]
        self.assertEqual(range_part[1:], [second, first])  # after the verifier's own revert
        self.assertIn("depend on each other", data["reverts"][-1]["reason"])
        self.assertTrue(data["tree_equals_base"])

    def test_max_reverts_zero_goes_straight_to_the_range_revert(self) -> None:
        self.commit("fix: one", value__txt="broken\n")
        code, data, _out, _err = self.verify("--max-reverts", "0")
        self.assertEqual(code, 1)
        self.assertEqual([r["kind"] for r in data["reverts"]], ["range"])
        self.assertNotIn("bisect", data["iterations"][0])
        self.assertTrue(data["tree_equals_base"])

    def test_a_conflicting_revert_is_aborted_and_stops(self) -> None:
        self.commit("feat: one", a__txt="1\n")
        self.commit("fix: two", value__txt="broken\n")
        self.commit("fix: three", value__txt="broken again\n")
        head_before = self.head()
        code, data, out, err = self.verify()
        self.assertEqual(code, 1, out + err)
        self.assertEqual(data["final_status"], "revert-conflict")
        self.assertEqual(self.head(), head_before)
        self.assertEqual(_git(self.repo, "status", "--porcelain", "--untracked-files=no"), "")
        git_dir = self.repo / ".git"
        self.assertFalse((git_dir / "REVERT_HEAD").exists())
        self.assertTrue(any("newest first" in n for n in data["notes"]))

    def test_a_check_red_at_the_base_is_unjudged_and_never_reverted(self) -> None:
        _write(self.repo, "value.txt", "broken\n")
        _git(self.repo, "commit", "-q", "-am", "base: already broken")
        self.base = self.head()
        self.write_marker()
        self.commit("feat: one", a__txt="1\n")
        head_before = self.head()
        code, data, _out, _err = self.verify()
        self.assertEqual(code, 3)
        self.assertEqual(data["final_status"], "inconclusive")
        self.assertEqual(data["reverts"], [])
        self.assertEqual(self.head(), head_before)
        self.assertIn("red at the base too", data["checks"][0]["reason"])

    def test_report_only_run_bisects_but_never_reverts(self) -> None:
        self.write_marker(mode="report-only")
        bad = self.commit("fix: one", value__txt="broken\n")
        head_before = self.head()
        code, data, _out, _err = self.verify()
        self.assertEqual(code, 1)
        self.assertEqual(data["final_status"], "red")
        self.assertEqual(data["reverts"], [])
        self.assertEqual(self.head(), head_before)
        self.assertEqual(data["iterations"][0]["bisect"]["first_bad"], bad)

    def test_count_drop_is_red(self) -> None:
        _write(self.repo, "count.py", "print(open('n.txt').read().strip(), 'passed')\n")
        _write(self.repo, "n.txt", "5\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base: counted")
        self.base = self.head()
        self.write_marker()
        self.config["gates"] = [gate("tests", "count.py", count_regex="(\\d+) passed")]
        self.write_config()
        bad = self.commit("refactor: drop", n__txt="4\n")
        code, data, _out, _err = self.verify()
        self.assertEqual(code, 0)
        self.assertEqual(data["reverts"][0]["sha"], bad)
        self.assertIn("count dropped to 4 from 5", data["reverts"][0]["reason"])


class CompareTests(VerifyCase):
    def setUp(self) -> None:
        super().setUp()
        self.e2e = {"name": "app-output", "cmd": [sys.executable, "-S", "app.py"], "cwd": ".",
                    "timeout_s": 60, "compare": True}

    def test_stdout_drift_is_detected_bisected_and_reverted(self) -> None:
        sha = self.write_profile(e2e=[self.e2e])
        self.write_marker(profile_sha256=sha)
        self.commit("feat: one", a__txt="1\n")
        bad = self.commit("refactor: two", answer__txt="43\n")
        self.commit("feat: three", b__txt="3\n")
        code, data, out, err = self.verify()
        self.assertEqual(code, 0, out + err)
        self.assertEqual([r["sha"] for r in data["reverts"]], [bad])
        reason = data["reverts"][0]["reason"]
        self.assertIn("stdout differs", reason)
        self.assertIn("-result: 42", reason)
        self.assertIn("+result: 43", reason)
        self.assertEqual(data["profile"]["sha256"], sha)
        self.assertFalse(data["gates_only"])
        compare = [c for c in data["checks"] if c["name"] == "app-output"][0]
        self.assertEqual(compare["status"], "green")
        self.assertTrue(Path(compare["stdout_normalised_file"]).is_file())

    def test_an_e2e_check_reading_a_build_output_is_bisected_correctly(self) -> None:
        # The probe cleans the clone, so it must replay the build gate before the e2e check;
        # otherwise out.txt is missing at every commit and bisect blames the first one.
        _write(self.repo, "build.py", "import shutil\nshutil.copy('answer.txt', 'out.txt')\n")
        _write(self.repo, "show.py", "print('built:', open('out.txt').read().strip())\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base: build step")
        self.base = self.head()
        e2e = {"name": "built-output", "cmd": [sys.executable, "-S", "show.py"], "cwd": ".",
               "timeout_s": 60, "compare": True}
        sha = self.write_profile(gates=[gate("unit", "check.py"), gate("build", "build.py")],
                                 e2e=[e2e])
        self.write_marker(profile_sha256=sha)
        self.commit("feat: one", a__txt="1\n")
        self.commit("feat: two", b__txt="2\n")
        bad = self.commit("refactor: three", answer__txt="41\n")
        self.commit("feat: four", c__txt="4\n")
        code, data, out, err = self.verify()
        self.assertEqual(code, 0, out + err)
        self.assertEqual([r["sha"] for r in data["reverts"]], [bad])
        spec = json.loads(Path(data["iterations"][0]["bisect"]["spec"]).read_text(
            encoding="utf-8"))
        self.assertEqual([b["check"]["name"] for b in spec["before"]], ["unit", "build"])

    def test_timestamps_durations_and_clone_paths_do_not_count_as_drift(self) -> None:
        sha = self.write_profile(e2e=[self.e2e])
        self.write_marker(profile_sha256=sha)
        self.commit("feat: one", a__txt="1\n")
        code, data, out, err = self.verify()
        self.assertEqual(code, 0, out + err)
        self.assertEqual(data["reverts"], [])
        base_file = data["base_run"]["results"]["app-output"]["stdout_normalised_file"]
        text = Path(base_file).read_text(encoding="utf-8")
        self.assertIn("started at <TS>", text)
        self.assertIn("working in <CLONE>", text)
        self.assertIn("took <DUR>", text)


COV_PY = ("import json, os, sys\n"
          "d = os.environ.get('NODE_V8_COVERAGE')\n"
          "if d:\n"
          "    os.makedirs(d, exist_ok=True)\n"
          "    with open(os.path.join(d, 'coverage-1.json'), 'w') as h:\n"
          "        h.write(json.dumps({'result': [], 'dir': d}))\n"
          "    if len(sys.argv) > 1:\n"
          "        sys.exit(3)\n"
          "print('ok')\n")


class E2eCoverageTests(VerifyCase):
    """--e2e-coverage (pilot-auto-calibration A01-F21): one extra, unjudged run per e2e check."""

    def setUp(self) -> None:
        super().setUp()
        _write(self.repo, "cov.py", COV_PY)
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base: coverage probe")
        self.base = self.head()
        self.write_marker()

    def profile_with(self, *args: str) -> None:
        e2e = {"name": "cli help", "cmd": [sys.executable, "-S", "cov.py", *args], "cwd": ".",
               "timeout_s": 60}
        sha = self.write_profile(e2e=[e2e])
        self.write_marker(profile_sha256=sha)

    def test_green_run_records_one_coverage_run_per_e2e_check(self) -> None:
        self.profile_with()
        self.commit("feat: one", a__txt="1\n")
        code, data, out, err = self.verify("--e2e-coverage")
        self.assertEqual(code, 0, out + err)
        cov = data["e2e_coverage"]
        self.assertEqual(len(cov), 1)
        self.assertEqual((cov[0]["check"], cov[0]["files"], cov[0]["exit_code"]),
                         ("cli help", 1, 0))
        self.assertTrue(cov[0]["dir"].startswith(".harden/verify/"))
        self.assertTrue((self.repo / cov[0]["dir"]).is_dir())
        self.assertIn("cli-help", cov[0]["dir"])
        judged = [c for c in data["checks"] if c["name"] == "cli help"][0]
        self.assertEqual(judged["status"], "green")
        self.assertIn("never judged", " ".join(data["notes"]))

    def test_without_flag_e2e_coverage_is_null(self) -> None:
        self.profile_with()
        self.commit("feat: one", a__txt="1\n")
        code, data, out, err = self.verify()
        self.assertEqual(code, 0, out + err)
        self.assertIsNone(data["e2e_coverage"])

    def test_range_revert_skips_coverage(self) -> None:
        self.config["gates"].append(gate("other", "check.py", "other.txt"))
        self.write_config()
        self.commit("feat: one", a__txt="1\n")
        self.commit("fix: two", value__txt="broken\n")
        self.commit("fix: four", other__txt="broken\n")
        code, data, out, err = self.verify("--max-reverts", "1", "--e2e-coverage")
        self.assertEqual(code, 1, out + err)
        self.assertEqual(data["final_status"], "range-reverted")
        self.assertEqual(data["e2e_coverage"], [])

    def test_failing_coverage_run_does_not_change_exit_code(self) -> None:
        self.profile_with("fail-under-coverage")
        self.commit("feat: one", a__txt="1\n")
        code, data, out, err = self.verify("--e2e-coverage")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(data["e2e_coverage"][0]["exit_code"], 3)
        self.assertEqual(data["final_status"], "green")

    def test_unexpected_error_in_coverage_pass_keeps_verdict(self) -> None:
        self.profile_with()
        self.commit("feat: one", a__txt="1\n")
        real = vb.run_check

        def flaky(check: Any, *args: Any, **kwargs: Any) -> Any:
            if "NODE_V8_COVERAGE" in (check.raw.get("env") or {}):
                raise RuntimeError("boom")
            return real(check, *args, **kwargs)

        with unittest.mock.patch.object(vb, "run_check", side_effect=flaky):
            code, data, out, err = self.verify("--e2e-coverage")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(data["final_status"], "green")
        self.assertTrue(any("RuntimeError" in n for n in data["notes"]), data["notes"])


class PreconditionTests(VerifyCase):
    def expect_refusal(self, fragment: str, *extra: str) -> None:
        code, _data, _out, err = self.verify(*extra)
        self.assertEqual(code, 2, err)
        self.assertIn(fragment, err)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_dirty_tree(self) -> None:
        _write(self.repo, "value.txt", "changed\n")
        self.expect_refusal("modified or staged")

    def test_no_marker(self) -> None:
        (self.repo / ".harden" / "active").unlink()
        self.expect_refusal("no active /harden run")

    def test_profile_changed_since_start(self) -> None:
        sha = self.write_profile()
        self.write_marker(profile_sha256=sha)
        self.write_profile(auto_apply={"structural": True, "behavioural": True,
                                       "dependencies": True, "money_paths": True})
        self.expect_refusal("not the one run_state.py start recorded")

    def test_profile_created_after_a_start_without_one(self) -> None:
        self.write_profile()
        self.expect_refusal("not the one run_state.py start recorded")

    def test_tracked_profile_is_refused(self) -> None:
        # protocol-preflight PF-22: a profile git tracks is repository text, not the owner's
        # consent, even when its sha256 is the one run_state.py start recorded.
        sha = self.write_profile()
        self.write_marker(profile_sha256=sha)
        profile = self.repo / ".harden" / "profile.json"
        self.assertIsNone(vb.profile_tracking(self.repo, profile, self.base))
        _git(self.repo, "add", "-f", ".harden/profile.json")
        _git(self.repo, "commit", "-q", "-m", "chore: commit the run profile")
        self.assertIn("git tracks .harden/profile.json",
                      vb.profile_tracking(self.repo, profile, self.base) or "")
        self.expect_refusal("profile is tracked by the repository")
        code, _data, _out, err = self.verify()
        self.assertEqual(code, 2)
        self.assertIn("PF-22", err)
        self.assertIn("Nothing was cloned or run", err)
        # Named with --profile, and as a path outside the repository (never tracked).
        self.expect_refusal("profile is tracked by the repository",
                            "--profile", ".harden/profile.json")
        outside = self.root / "profile-outside.json"
        outside.write_bytes(profile.read_bytes())
        self.assertIsNone(vb.profile_tracking(self.repo, outside, self.base))

    def test_profile_held_by_the_base_commit_is_refused(self) -> None:
        # Untracked again with `git rm --cached`, but the run's base commit still holds it:
        # the same rule as run_state.py start (validate_profile.tracked_by_repository).
        sha = self.write_profile()
        _git(self.repo, "add", "-f", ".harden/profile.json")
        _git(self.repo, "commit", "-q", "-m", "base: profile committed by mistake")
        self.base = self.head()
        _git(self.repo, "rm", "-q", "--cached", ".harden/profile.json")
        _git(self.repo, "commit", "-q", "-m", "chore: untrack the profile")
        self.write_marker(profile_sha256=sha)
        self.expect_refusal("the base commit {} holds .harden/profile.json".format(
            self.base[:12]))

    def test_profile_with_unconfirmed_side_effects(self) -> None:
        sha = self.write_profile(live_side_effects="unconfirmed")
        self.write_marker(profile_sha256=sha)
        self.expect_refusal("live_side_effects is 'unconfirmed'")
        # An interactive run may rest on the user's live answer (config env_policy).
        self.write_marker(profile_sha256=sha, mode="interactive")
        code, data, out, err = self.verify()
        self.assertEqual(code, 0, out + err)
        self.assertEqual(data["mode"], "interactive")
        self.config["env_policy"] = "unconfirmed"
        self.write_config()
        code, _data, _out, err = self.verify()
        self.assertEqual(code, 2)
        self.assertIn("live_side_effects is 'unconfirmed'", err)

    def test_no_profile_and_unconfirmed_env_policy(self) -> None:
        self.config["env_policy"] = "unconfirmed"
        self.write_config()
        self.expect_refusal("PF-03")

    def test_forbidden_gate_command(self) -> None:
        self.write_marker(forbidden_commands=["check.py"])
        self.expect_refusal("matches the forbidden pattern 'check.py'")

    def test_absolute_or_escaping_cwd(self) -> None:
        self.config["gates"][0]["cwd"] = "../elsewhere"
        self.write_config()
        self.expect_refusal("must stay inside the repository")

    def test_base_must_be_a_commit_and_an_ancestor(self) -> None:
        code, _data, _out, err = self.verify_with_base("nope")
        self.assertEqual(code, 2)
        self.assertIn("not a commit", err)
        _git(self.repo, "switch", "-q", "-c", "side")
        side = self.commit("side", s__txt="s\n")
        _git(self.repo, "switch", "-q", "harden/test")
        code, _data, _out, err = self.verify_with_base(side)
        self.assertEqual(code, 2)
        self.assertIn("not an ancestor", err)

    def verify_with_base(self, base: str) -> Tuple[int, Dict[str, Any], str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = vb.main(["--base", base, "--repo", str(self.repo)])
        return code, {}, out.getvalue(), err.getvalue()


class UnitTests(unittest.TestCase):
    def test_normalise_output_masks_run_specific_text(self) -> None:
        root = "C:/tmp/harden-scratch-x/verify-2" if os.name == "nt" else "/tmp/scratch/verify-2"
        native = root.replace("/", "\\") if os.name == "nt" else root
        text = ("\x1b[32mok\x1b[0m at 2026-09-24T10:11:12.345Z (12:13:14)\r\n"
                "Duration 1.52s, took 12ms, 3 seconds, 2 min\n"
                "file {}/src/a.py and {}\\src\\b.py   \n\n".format(root, native))
        out = vb.normalise_output(text, [root])
        self.assertEqual(out, "ok at <TS> (<TIME>)\nDuration <DUR>, took <DUR>, <DUR>, <DUR>\n"
                              "file <CLONE>/src/a.py and <CLONE>\\src\\b.py")
        self.assertEqual(vb.normalise_output("result: 42 items", [root]), "result: 42 items")

    def test_judge_ratchet_and_counts(self) -> None:
        ratchet = vb.CheckDef("lint", "gate", "ratchet.json",
                              {"name": "lint", "cmd": "x", "ratchet": True, "count_regex": "(\\d+)"})
        self.assertEqual(vb.judge(ratchet, {"ratchet_count": 3}, {"ratchet_count": 3}, 0)[0],
                         "green")
        self.assertEqual(vb.judge(ratchet, {"ratchet_count": 4}, {"ratchet_count": 3}, 0)[0],
                         "red")
        self.assertEqual(vb.judge(ratchet, {"ratchet_count": 4}, {"ratchet_count": None}, 0)[0],
                         "unjudged")
        counted = vb.CheckDef("test", "gate", "config",
                              {"name": "test", "cmd": "x", "count_regex": "(\\d+) passed"})
        base = {"passed": True, "count": 10}
        self.assertEqual(vb.judge(counted, {"passed": True, "count": 8}, base, 2)[0], "green")
        status, reason = vb.judge(counted, {"passed": True, "count": 7}, base, 2)
        self.assertEqual(status, "red")
        self.assertIn("less 2 approved test deletion(s)", reason)
        self.assertEqual(vb.judge(counted, {"passed": False, "exit_code": 1}, base, 0)[0], "red")
        self.assertEqual(vb.judge(counted, {"passed": False, "exit_code": 1},
                                  {"passed": False, "exit_code": 1}, 0)[0], "unjudged")

    def test_lockfile_install_detection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            self.assertEqual(vb.install_checks("lockfile", [], work, []), [])
            (work / "uv.lock").write_text("", encoding="utf-8")
            (work / "pnpm-lock.yaml").write_text("", encoding="utf-8")
            found = vb.install_checks("lockfile", [], work, [])
            self.assertEqual(found[0].raw["cmd"], ["pnpm", "install", "--frozen-lockfile"])
            patterns, _ = vb.vp.compile_patterns(["pnpm install"])
            self.assertEqual(vb.install_checks("lockfile", [], work, patterns), [])
            self.assertEqual(vb.install_checks("none", [], work, []), [])

    def test_config_example_install_entries_are_valid_install_steps(self) -> None:
        example = SCRIPTS.parent / "assets" / "config.example.json"
        data = json.loads(example.read_text(encoding="utf-8-sig"))
        self.assertTrue(any("install" in c for c in data["$comment"]))
        seen = 0
        with tempfile.TemporaryDirectory() as tmp:
            for config in data["examples"]:
                raw = config.get("install")
                if raw is None:
                    continue
                for item in [raw] if isinstance(raw, dict) else raw:
                    check = vb.CheckDef(item["name"], "install", "config",
                                        vb.gate_object(item, item["name"]))
                    vb.validate_definition(check, Path(tmp), {})
                    seen += 1
        self.assertGreater(seen, 0)


# The first lines of the two Yarn lockfile formats: yarnpkg/berry's own yarn.lock (Yarn 2+) and
# yarnpkg/yarn's (Yarn 1), both read 2026-09-25.
YARN_MODERN_LOCK = ("# This file is generated by running \"yarn install\" inside your project.\n"
                    "# Manual changes might be lost - proceed with caution!\n\n"
                    "__metadata:\n  version: 10\n  cacheKey: 10\n\n"
                    "\"left-pad@npm:^1.3.0\":\n  version: 1.3.0\n")
YARN_CLASSIC_LOCK = ("# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.\n"
                     "# yarn lockfile v1\n\n\nleft-pad@^1.3.0:\n  version \"1.3.0\"\n")
YARN_MODERN = ["yarn", "install", "--immutable"]
YARN_CLASSIC = ["yarn", "install", "--frozen-lockfile"]


class YarnInstallTests(unittest.TestCase):
    """The lockfile-enforcing install of a yarn.lock checkout (PF-10), in fake repositories:
    the chosen command is asserted, nothing is installed."""

    def setUp(self) -> None:
        self.work = Path(tempfile.mkdtemp(prefix="harden-yarn-"))

    def tearDown(self) -> None:
        _rmtree(str(self.work))

    def fake_repo(self, lock: str = YARN_CLASSIC_LOCK, package_manager: Optional[str] = None,
                  yarnrc_yml: bool = False, **others: str) -> None:
        for child in list(self.work.iterdir()):
            if child.is_dir():
                _rmtree(str(child))
            else:
                child.unlink()
        _write(self.work, "yarn.lock", lock)
        manifest: Dict[str, Any] = {"name": "fixture", "private": True}
        if package_manager is not None:
            manifest["packageManager"] = package_manager
        _write(self.work, "package.json", json.dumps(manifest))
        if yarnrc_yml:
            _write(self.work, ".yarnrc.yml", "nodeLinker: node-modules\n")
        for rel, content in others.items():
            _write(self.work, rel, content)

    def chosen(self, patterns: Optional[List[Any]] = None) -> List[vb.CheckDef]:
        return vb.install_checks("lockfile", [], self.work, patterns or [])

    def assert_install(self, argv: List[str], reason: str) -> None:
        found = self.chosen()
        self.assertEqual(len(found), 1)
        check = found[0]
        self.assertEqual(check.raw["cmd"], argv)
        self.assertEqual((check.name, check.kind), ("install (yarn.lock)", "install"))
        self.assertIn(reason, check.source)
        self.assertTrue(check.source.startswith("lockfile yarn.lock"), check.source)

    def test_yarn_2_plus_uses_immutable(self) -> None:
        self.fake_repo(YARN_MODERN_LOCK, package_manager="yarn@4.5.1")
        self.assert_install(YARN_MODERN, "packageManager yarn@4")
        # Corepack's hash suffix is part of the field ("yarn@3.2.3+sha224.<hex>").
        self.fake_repo(YARN_MODERN_LOCK, package_manager="yarn@3.2.3+sha224.953c8233f7a92884eee2d"
                                                         "e69a1b92d1f2ec1655e66d08071ba9a02fa")
        self.assert_install(YARN_MODERN, "packageManager yarn@3")
        # .yarnrc.yml is Yarn 2+'s config file: no packageManager needed.
        self.fake_repo(YARN_MODERN_LOCK, yarnrc_yml=True)
        self.assert_install(YARN_MODERN, ".yarnrc.yml")
        # Neither signal, but the lockfile carries Yarn 2+'s __metadata block.
        self.fake_repo(YARN_MODERN_LOCK)
        self.assert_install(YARN_MODERN, "__metadata")

    def test_yarn_1_uses_frozen_lockfile(self) -> None:
        self.fake_repo(YARN_CLASSIC_LOCK)
        self.assert_install(YARN_CLASSIC, "Yarn 1")
        self.fake_repo(YARN_CLASSIC_LOCK, package_manager="yarn@1.22.22")
        self.assert_install(YARN_CLASSIC, "packageManager yarn@1")
        # An explicit yarn@1 wins over a lockfile header; a .yarnrc (no .yml) is Yarn 1's.
        self.fake_repo(YARN_MODERN_LOCK, package_manager="yarn@1.22.22", **{".yarnrc": "x 1\n"})
        self.assert_install(YARN_CLASSIC, "packageManager yarn@1")
        # An unreadable package.json is no packageManager.
        self.fake_repo(YARN_CLASSIC_LOCK)
        _write(self.work, "package.json", "{not json")
        self.assert_install(YARN_CLASSIC, "Yarn 1")

    def test_package_manager_picks_among_js_lockfiles(self) -> None:
        # Without packageManager the fixed order holds: package-lock.json before yarn.lock.
        self.fake_repo(YARN_CLASSIC_LOCK, **{"package-lock.json": "{}\n"})
        self.assertEqual(self.chosen()[0].raw["cmd"], ["npm", "ci"])
        self.fake_repo(YARN_MODERN_LOCK, package_manager="yarn@4.5.1",
                       **{"package-lock.json": "{}\n", "pnpm-lock.yaml": ""})
        self.assert_install(YARN_MODERN, "packageManager yarn@4")
        self.fake_repo(YARN_CLASSIC_LOCK, package_manager="pnpm@9.12.0",
                       **{"pnpm-lock.yaml": ""})
        found = self.chosen()[0]
        self.assertEqual(found.raw["cmd"], ["pnpm", "install", "--frozen-lockfile"])
        self.assertEqual(found.source, "lockfile pnpm-lock.yaml (packageManager pnpm@9)")
        # A packageManager whose lockfile is absent changes nothing.
        self.fake_repo(YARN_CLASSIC_LOCK, package_manager="pnpm@9.12.0")
        self.assert_install(YARN_CLASSIC, "Yarn 1")

    def test_forbidden_yarn_install_is_not_run(self) -> None:
        self.fake_repo(YARN_MODERN_LOCK, package_manager="yarn@4.5.1")
        patterns, _ = vb.vp.compile_patterns(["yarn install"])
        self.assertEqual(self.chosen(patterns), [])
        patterns, _ = vb.vp.compile_patterns(["--frozen-lockfile"])
        self.assertEqual(len(self.chosen(patterns)), 1)  # Yarn 2+ does not use that flag


class ExplicitInstallTests(VerifyCase):
    def test_config_install_runs_before_the_checks_in_every_clone(self) -> None:
        # "install" of .harden/config.json replaces the lockfile rule (yarn.lock here).
        _write(self.repo, "yarn.lock", YARN_CLASSIC_LOCK)
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base: yarn lockfile")
        self.base = self.head()
        self.write_marker()
        self.config["install"] = {"name": "deps", "cmd": [
            sys.executable, "-S", "-c", "open('deps.txt', 'w').write('ok\\n')"], "cwd": ".",
            "timeout_s": 60}
        self.config["gates"].append(gate("needs-deps", "check.py", "deps.txt"))
        self.write_config()
        self.commit("feat: one", a__txt="1\n")
        code, data, out, err = self.verify()
        self.assertEqual(code, 0, out + err)
        self.assertEqual(data["install_mode"], "explicit")
        self.assertEqual([c["name"] for c in data["checks"]], ["deps", "unit", "needs-deps"])
        self.assertTrue(all(c["status"] == "green" for c in data["checks"]), data["checks"])
        self.assertEqual(data["base_run"]["results"]["deps"]["kind"], "install")
        self.assertEqual(data["definitions"][0]["source"], "config")
        # [] disables the install step: the gate that needs it is red at the base too.
        self.config["install"] = []
        self.write_config()
        code, data, _out, _err = self.verify()
        self.assertEqual(code, 3)
        self.assertEqual(data["install_mode"], "none")
        self.assertIn("red at the base too", [c for c in data["checks"]
                                              if c["name"] == "needs-deps"][0]["reason"])


class ProbeTests(VerifyCase):
    def probe(self, spec: Dict[str, Any]) -> int:
        spec_path = self.root / "spec.json"
        spec_path.write_text(json.dumps(spec), encoding="utf-8")
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT), "--probe", "--spec",
                               str(spec_path), "--repo", str(self.repo)],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        return proc.returncode

    def spec(self, **extra: Any) -> Dict[str, Any]:
        check = vb.CheckDef("unit", "gate", "config", gate("unit", "check.py"))
        data = {"check": check.to_json(), "base": {"passed": True, "exit_code": 0},
                "approved": 0, "defaults": {}, "install_mode": "none", "installs": [],
                "forbidden": [], "log_dir": (self.root / "logs").as_posix(), "clean": False}
        data.update(extra)
        return data

    def test_good_bad_and_skip(self) -> None:
        self.assertEqual(self.probe(self.spec()), 0)
        self.commit("fix: one", value__txt="broken\n")
        self.assertEqual(self.probe(self.spec()), 1)
        failing_install = vb.CheckDef("install", "install", "config",
                                      gate("install", "-c", "import sys; sys.exit(3)"))
        self.assertEqual(self.probe(self.spec(install_mode="explicit",
                                              installs=[failing_install.to_json()])), 125)
        # The install step as the bisected check: its failure is "bad", not "skip".
        self.assertEqual(self.probe(self.spec(check=failing_install.to_json(),
                                              install_mode="explicit",
                                              installs=[failing_install.to_json()])), 1)
        self.assertEqual(self.probe({"nonsense": True}), 255)

    def test_an_earlier_check_that_breaks_here_means_skip(self) -> None:
        broken = vb.CheckDef("build", "gate", "config",
                             gate("build", "-c", "import sys; sys.exit(4)"))
        before = [{"check": broken.to_json(), "base": {"passed": True, "exit_code": 0},
                   "required": True}]
        self.assertEqual(self.probe(self.spec(before=before)), 125)
        before[0]["required"] = False  # red at HEAD too: its failure says nothing here
        self.assertEqual(self.probe(self.spec(before=before)), 0)

    def test_clean_removes_untracked_build_output(self) -> None:
        _write(self.repo, "dist/stale.txt", "x\n")
        self.assertEqual(self.probe(self.spec(clean=True)), 0)
        self.assertFalse((self.repo / "dist").exists())


class CliTests(VerifyCase):
    def test_runs_without_site_packages_and_prints_a_summary(self) -> None:
        self.commit("feat: one", a__txt="1\n")
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT), "--base", self.base],
                              cwd=str(self.repo), stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        output = proc.stdout.decode("utf-8", errors="replace")
        self.assertEqual(proc.returncode, 0, output + proc.stderr.decode(errors="replace"))
        self.assertIn("verify_branch: green (0 revert(s))", output)
        self.assertTrue((self.repo / ".harden" / "verify.json").is_file())

    def test_base_is_required(self) -> None:
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT)], cwd=str(self.repo),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        self.assertEqual(proc.returncode, 2)
        self.assertIn(b"--base is required", proc.stderr)


if __name__ == "__main__":
    unittest.main()
