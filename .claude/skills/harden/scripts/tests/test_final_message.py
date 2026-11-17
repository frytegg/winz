"""Tests for scripts/final_message.py (unittest, temporary git repositories).

pilot-auto-calibration A01-F59: the final message is printed from .harden/ files and git.
Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
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
from typing import Any, Dict, List, Optional, Tuple
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import _common as C  # noqa: E402
import final_message as FM  # noqa: E402

HAS_GIT = shutil.which("git") is not None
_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None
REACH = "e2e executed 1 of 2 changed modules, 1 of 3 changed functions"
BANNED = ("Want", "Would you", "Shall I", "Let me know")


def setUpModule() -> None:
    """Isolate git from the user's global and system configuration."""
    global _GIT_HOME
    _GIT_HOME = tempfile.mkdtemp(prefix="harden-fm-gitcfg-")
    cfg = Path(_GIT_HOME) / "gitconfig"
    cfg.write_text("[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                   "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                   "[core]\n\tautocrlf = false\n", encoding="utf-8")
    values = {"GIT_CONFIG_GLOBAL": str(cfg), "GIT_CONFIG_NOSYSTEM": "1"}
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
        shutil.rmtree(_GIT_HOME, ignore_errors=True)


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=str(repo), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True)
    return proc.stdout.decode("utf-8", errors="replace").strip()


def finding(fid: str, **extra: Any) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "id": fid, "lens": "errors-resilience", "rule_ref": "ER-01", "title": "A title",
        "file": "src/app.py", "line": 1, "class": "behavioural", "tier": "T1",
        "severity": "medium", "severity_criterion": "wrong output", "confidence": "failing_test",
        "evidence": [{"kind": "test", "ref": "tests/test_app.py::test_x", "detail": "red"}],
        "verified": True, "verifier_note": "ok", "status": "reported", "fix_risk": "low",
        "location_class": "warm"}
    base.update(extra)
    return base


@unittest.skipUnless(HAS_GIT, "git is needed")
class FinalMessageTests(unittest.TestCase):
    """The fixture: a base commit, 2 commits on a branch, .harden/active in auto mode and the
    run's records written by the test."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="harden-fm-"))
        self.repo = self.root / "repo"
        self.repo.mkdir()
        _git(self.repo, "init", "-q")
        (self.repo / "src").mkdir()
        (self.repo / "src" / "app.py").write_text("def run():\n    return 1\n",
                                                   encoding="utf-8")
        (self.repo / ".gitignore").write_text(".harden/\n", encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base")
        self.base = _git(self.repo, "rev-parse", "HEAD")
        _git(self.repo, "checkout", "-q", "-b", "harden/test")
        self.c1 = self.commit("fix(app): first fix", "def run():\n    return 2\n")
        self.c2 = self.commit("feat(app)!: second fix", "def run():\n    return 3\n")
        self.hdir = self.repo / ".harden"
        (self.hdir / "gates").mkdir(parents=True)
        (self.hdir / "tools").mkdir()
        self.marker = {"base_sha": self.base, "branch": "harden/test", "mode": "auto",
                       "mode_requested": "auto", "profile_sha256": "a" * 64,
                       "profile_origin": "owner"}
        self.write(".harden/active", self.marker)
        self.write(".harden/profile.json", {"version": 1, "gates": [{"name": "test"}],
                                            "live_side_effects": "none",
                                            "auto_apply": {"structural": True}})
        self.write_verify()
        self.write(".harden/tools/e2e-reach.json", {"head": self.head(), "headline": REACH})
        self.write_final_gates()
        self.write_report(["- (a) Tools that failed or did not run: none"])
        self.write(".harden/findings.json", {"version": 1, "base_sha": self.base,
                                             "generated": "2026-09-30T10:00:00Z",
                                             "tool_versions": {}, "findings": []})
        (self.hdir / "approvals.md").write_text(
            "| category | decision | count | user's exact words | UTC time |\n"
            "|---|---|---|---|---|\n", encoding="utf-8")
        (self.hdir / "progress.md").write_text(
            "# Progress\n\n- default: future_work -> none (DC-17).\n", encoding="utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    # -- helpers ---------------------------------------------------------------------------

    def commit(self, message: str, content: str) -> str:
        (self.repo / "src" / "app.py").write_text(content, encoding="utf-8")
        _git(self.repo, "commit", "-q", "-am", message)
        return _git(self.repo, "rev-parse", "HEAD")

    def head(self) -> str:
        return _git(self.repo, "rev-parse", "HEAD")

    def write(self, rel: str, data: Any) -> None:
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")

    def write_verify(self, **extra: Any) -> None:
        data = {"head_at_end": self.head(), "final_status": "green", "exit_code": 0,
                "reverts": [], "max_reverts": 5, "e2e_coverage": [],
                "checks": [{"name": "test", "kind": "gate", "status": "green"},
                           {"name": "cli-help", "kind": "e2e", "status": "green"}]}
        data.update(extra)
        self.write(".harden/verify.json", data)

    def write_final_gates(self, **extra: Any) -> None:
        runs = [{"run": n, "results": [{"name": "test", "exit_code": 0, "passed": True}]}
                for n in (1, 2, 3)]
        data = {"repeat": 3, "git_head": self.head(), "gates": [{"name": "test"}],
                "runs": runs, "summary": {"test": {"exit_codes": [0], "counts": [4, 4, 4],
                                                   "count_min": 4, "count_max": 4}},
                "all_passed": True, "count_check": None, "ratchet_check": None}
        data.update(extra)
        self.write(".harden/gates/final.json", data)

    def write_report(self, limits: List[str]) -> None:
        text = "# Report\n\n## Summary\n\nx\n\n## Limits\n\n" + "\n".join(limits) + \
            "\n\nAbsence of findings is not absence of defects.\n\n## Residual risk\n\n- x\n"
        (self.hdir / "report.md").write_text(text, encoding="utf-8")

    def run_main(self, *args: str) -> Tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = FM.main(["--repo", str(self.repo), *args])
        return code, out.getvalue(), err.getvalue()

    # -- tests -----------------------------------------------------------------------------

    def test_verdict_green_with_reach(self) -> None:
        code, text, err = self.run_main()
        self.assertEqual(code, 0, text + err)
        self.assertEqual(text.splitlines()[0], "end-to-end verified; " + REACH)

    def test_verdict_counts_every_revert_commit(self) -> None:
        _git(self.repo, "revert", "--no-edit", self.c2)
        self.write_verify(reverts=[{"sha": self.c2}])
        self.write(".harden/tools/e2e-reach.json", {"head": self.head(), "headline": REACH})
        self.write_final_gates()
        code, text, _err = self.run_main()
        self.assertTrue(text.splitlines()[0].startswith(
            "reverted 1 commits; verifier final status: green"), text)
        self.assertIn("under Reverted by end-to-end verification in the report", text)

    def test_stale_verify_is_end_to_end_not_run_and_exit_1(self) -> None:
        self.write_verify(head_at_end=self.c1)
        code, text, _err = self.run_main()
        self.assertEqual(code, 1)
        self.assertTrue(text.splitlines()[0].startswith(
            "end-to-end not run: .harden/verify.json describes"), text)
        self.assertIn("Run-file problems:", text)

    def test_missing_reach_is_not_computed(self) -> None:
        (self.hdir / "tools" / "e2e-reach.json").unlink()
        code, text, _err = self.run_main()
        self.assertEqual(text.splitlines()[0],
                         "end-to-end verified; e2e reach not computed (e2e_reach.py did not run)")
        self.assertEqual(code, 0)

    def test_stale_reach_names_both_commits(self) -> None:
        self.write(".harden/tools/e2e-reach.json", {"head": self.c1, "headline": REACH})
        code, text, _err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("e2e reach not computed (e2e-reach.json describes {}, HEAD is {})".format(
            self.c1[:7], self.head()[:7]), text.splitlines()[0])

    def test_report_only_reasons_from_session_snapshot(self) -> None:
        _git(self.repo, "reset", "-q", "--hard", self.base)
        (self.hdir / "active").unlink()
        snap = dict(self.marker, mode="report-only",
                    mode_reasons=["no run profile: .harden/profile.json is missing"])
        self.write(".harden/session.json", {"run": "x", "stopped": {
            "at": "2026-09-30T10:00:00Z", "forced": False, "by": "run_state.py stop",
            "marker": snap}})
        code, text, _err = self.run_main()
        self.assertEqual(text.splitlines()[0],
                         "report only: no run profile: .harden/profile.json is missing")
        self.assertIn("- No project code was changed.", text)
        self.assertIn("- Phase 8 checks: not run (no commit)", text)

    def test_report_only_after_mode_change_and_self_setup_notes(self) -> None:
        _git(self.repo, "reset", "-q", "--hard", self.base)
        self.write(".harden/active", dict(self.marker, mode="report-only", mode_changed={
            "from": "auto", "to": "report-only", "reason": "red baseline"}))
        self.write(".harden/profile.json", {"version": 1, "gates": [],
                                            "live_side_effects": "unconfirmed",
                                            "origin": {"kind": "inferred"}})
        self.write(".harden/profile-inference.json", {"finalize": {"notes": [
            "dropped test: red at the pre-start probe", {"drop": "lint", "why": "network"},
            "report only for execution: self-setup cleared no gate", "a fourth note"]}})
        _code, text, _err = self.run_main()
        self.assertEqual(text.splitlines()[0],
                         "report only: red baseline; dropped test: red at the pre-start probe; "
                         "dropped lint: network; report only for execution: self-setup "
                         "cleared no gate")

    def test_no_commit_outside_report_only(self) -> None:
        _git(self.repo, "reset", "-q", "--hard", self.base)
        _code, text, _err = self.run_main()
        self.assertEqual(text.splitlines()[0], "no commit: end-to-end not run (nothing applied)")

    def test_commits_and_checks_carry_commands_and_exit_codes(self) -> None:
        code, text, _err = self.run_main()
        for line in _git(self.repo, "log", "--oneline", "--no-decorate",
                         self.base + "..HEAD").splitlines():
            self.assertIn(line, text)
        b7 = self.base[:7]
        self.assertIn("Commits (git log --oneline {}..HEAD):".format(b7), text)
        self.assertIn("gates.py --label final --repeat 3: exit 0 (test 0 0 0", text)
        self.assertIn("verify_branch.py --base {} --max-reverts 5 --e2e-coverage: exit 0 "
                      "(green, 0 reverts".format(b7), text)
        self.assertIn("diff_guard.py --base {} --json: not recorded".format(b7), text)
        self.assertIn("gates.py --label commit-<sha> for 2 commits: exit 0 for 0 (0 reused); "
                      "not recorded for {}, {}".format(self.c1[:7], self.c2[:7]), text)
        self.assertIn("validate_findings.py .harden/findings.json --repo .: exit 0 (0 findings)",
                      text)
        self.assertEqual(code, 0)

    def test_per_commit_records_reused_and_red(self) -> None:
        self.write(".harden/gates/commit-{}.json".format(self.c1),
                   {"git_head": self.c1, "all_passed": True, "reused_from": "H-1-a1"})
        self.write(".harden/gates/commit-{}.json".format(self.c2),
                   {"git_head": self.c2, "all_passed": False})
        _code, text, _err = self.run_main()
        self.assertIn("for 2 commits: exit 0 for 1 (1 reused); exit 1 for {}".format(
            self.c2[:7]), text)

    def test_gates_exit_uses_all_passed_and_checks(self) -> None:
        self.assertEqual(FM.gates_exit({"all_passed": True, "count_check": None,
                                        "ratchet_check": None}), 0)
        self.assertEqual(FM.gates_exit({"all_passed": True, "count_check": {"passed": False}}),
                         1)
        self.assertEqual(FM.gates_exit({"all_passed": True, "ratchet_check": {"passed": False}}),
                         1)
        self.assertEqual(FM.gates_exit({"all_passed": False}), 1)
        self.write_final_gates(count_check={"passed": False, "failures": ["fewer tests"]})
        _code, text, _err = self.run_main()
        self.assertIn("gates.py --label final --repeat 3: exit 1 (test 0 0 0, 4 tests)", text)

    def test_stale_final_gates_record_is_not_current(self) -> None:
        self.write_final_gates(git_head=self.c1)
        code, text, _err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("gates.py --label final --repeat 3: not current (.harden/gates/final.json "
                      "describes {}, HEAD is {})".format(self.c1[:7], self.head()[:7]), text)

    def test_oldlines_and_confirm_run(self) -> None:
        self.write(".harden/gates/final-oldlines.json", {"git_head": self.head(),
                                                         "all_passed": False})
        self.write(".harden/gates/final-oldlines-confirm.json", {"git_head": self.head(),
                                                                 "all_passed": True})
        _code, text, _err = self.run_main()
        self.assertIn("--label final-oldlines: exit 1; confirm run (--label "
                      "final-oldlines-confirm): exit 0", text)

    def test_review_before_merge_breaking_first_with_undo(self) -> None:
        self.write(".harden/findings.json", {"version": 1, "base_sha": self.base,
                                             "generated": "2026-09-30T10:00:00Z",
                                             "tool_versions": {}, "findings": [
            finding("H-1", status="applied", commit=self.c1,
                    review={"kinds": ["behavioural"], "option": "direct"}),
            finding("H-2", status="applied", commit=self.c2,
                    review={"kinds": ["owner-judgement", "breaking-api"], "option": "direct"})]})
        _code, text, _err = self.run_main()
        lines = text.splitlines()
        start = lines.index("Applied, review before merge (2):")
        self.assertTrue(lines[start + 1].startswith("- {} H-2 owner-judgement,breaking-api: "
                                                    "feat(app)!: second fix".format(self.c2[:7])))
        self.assertTrue(lines[start + 2].startswith("- {} H-1 behavioural: fix(app): first "
                                                    "fix".format(self.c1[:7])))
        self.assertTrue(lines[start + 1].endswith("undo: git revert {}".format(self.c2[:7])))
        self.assertTrue(lines[start + 2].endswith("undo: git revert {}".format(self.c1[:7])))
        self.assertIn("- Review the 2 commits under Applied, review before merge", text)

    def test_awaiting_decision_order_reason_and_no_nits(self) -> None:
        self.write(".harden/findings.json", {"version": 1, "base_sha": self.base,
                                             "generated": "2026-09-30T10:00:00Z",
                                             "tool_versions": {}, "findings": [
            finding("H-3", status="reported", notes="x\nPZ-24: row 7: owner judgement"),
            finding("H-4", status="reported", severity="nit", severity_criterion=None),
            finding("H-5", status="partial", title="t" * 120),
            finding("H-6", status="blocked")]})
        (self.hdir / "approvals.md").write_text(
            "| category | decision | count | user's exact words | UTC time |\n|---|---|---|---|---|\n"
            "| H-6 | report-only | 1 | auto (profile): T2 | 2026-09-30T10:00:00Z |\n",
            encoding="utf-8")
        _code, text, _err = self.run_main("--top", "2")
        lines = text.splitlines()
        start = lines.index("Awaiting your decision (top 2 of 3):")
        self.assertEqual(lines[start + 1],
                         "- H-5 medium src/app.py:1 " + "t" * 99 + "…; partial")
        self.assertEqual(lines[start + 2], "- H-6 medium src/app.py:1 A title; T2")
        _code, text, _err = self.run_main()
        self.assertIn("- H-3 medium src/app.py:1 A title; PZ-24: row 7: owner judgement", text)
        self.assertNotIn("H-4", text)
        self.assertIn("- 3 findings wait under Needs your decision and Open owner items", text)

    def test_statements_only(self) -> None:
        _code, text, _err = self.run_main()
        self.assertNotIn("?", text)
        for word in BANNED:
            self.assertNotIn(word, text)
        self.assertIn("- The branch harden/test is not merged or pushed.", text)

    def test_defaults_and_approvals_lines(self) -> None:
        _code, text, _err = self.run_main()
        self.assertIn("- default: future_work -> none (DC-17).", text)
        self.assertIn("Approved by the profile: auto_apply structural=true", text)
        self.assertIn("behavioural=false", text)

    def test_limits_copied_and_capped(self) -> None:
        self.write_report(["- ({}) limit line {}".format(n, n) for n in range(30)])
        _code, text, _err = self.run_main()
        lines = text.splitlines()
        start = lines.index("Limits (from .harden/report.md):")
        self.assertEqual(lines[start + 25], "- (24) limit line 24")
        self.assertEqual(lines[start + 26], "- … 5 more lines under Limits in the report")

    def test_file_written_and_utf8(self) -> None:
        self.write_report(["- (a) café … tools"])
        raw = io.BytesIO()
        wrapper = io.TextIOWrapper(raw, encoding="cp1252")
        with mock.patch.object(sys, "stdout", wrapper):
            code = FM.main(["--repo", str(self.repo)])
            wrapper.flush()
        self.assertEqual(code, 0)
        written = (self.hdir / "final-message.md").read_bytes()
        self.assertEqual(raw.getvalue(), written)
        self.assertIn("café … tools", written.decode("utf-8"))
        self.assertNotIn(b"\r\n", written)

    def test_json_output(self) -> None:
        code, text, _err = self.run_main("--json")
        data = json.loads(text)
        self.assertEqual((data["exit_code"], data["problems"]), (0, []))
        self.assertEqual(data["verdict"], "end-to-end verified; " + REACH)
        self.assertTrue(data["text"].startswith(data["verdict"] + "\n"))
        self.assertEqual(code, 0)

    def test_no_run_record_exit_2(self) -> None:
        (self.hdir / "active").unlink()
        code, text, err = self.run_main()
        self.assertEqual((code, text), (2, ""))
        self.assertIn("no run record", err)
        self.assertFalse((self.hdir / "final-message.md").exists())

    def test_not_a_git_repository_exit_2(self) -> None:
        plain = self.root / "plain"
        plain.mkdir()
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = FM.main(["--repo", str(plain)])
        self.assertEqual((code, out.getvalue()), (2, ""))

    def test_internal_error_exits_3_and_prints_nothing(self) -> None:
        with mock.patch.object(FM, "read_record", side_effect=RuntimeError("boom")):
            code, text, err = self.run_main()
        self.assertEqual((code, text), (3, ""))
        self.assertIn("final_message.py: internal error: RuntimeError: boom", err)
        self.assertFalse((self.hdir / "final-message.md").exists())

    def test_stale_residual_record_is_a_problem(self) -> None:
        self.write(".harden/tools/residual-check.json", {"problems": []})
        self.write(".harden/tools/models.json", {"report_check": {"problems": []}})
        _code, text, _err = self.run_main()
        self.assertIn("- residual_check.py: exit 0 (0 problems)", text)
        old = time.time() - 3600
        os.utime(self.hdir / "tools" / "residual-check.json", (old, old))
        code, text, _err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("- residual_check.py: not current (.harden/tools/residual-check.json "
                      "predates HEAD)", text)
        self.assertIn("- .harden/tools/residual-check.json predates HEAD", text)
        now = time.time()
        os.utime(self.hdir / "tools" / "residual-check.json", (now, now))
        os.utime(self.hdir / "tools" / "models.json", (now, now))
        os.utime(self.hdir / "report.md", (now + 60, now + 60))
        code, text, _err = self.run_main()
        self.assertIn(".harden/tools/models.json predates report.md", text)

    def test_reads_active_marker_before_stop(self) -> None:
        self.write(".harden/session.json", {"run": "old", "stopped": {"marker": dict(
            self.marker, branch="other", mode="report-only")}})
        _code, text, _err = self.run_main()
        self.assertIn("Branch harden/test, base {}".format(self.base[:7]), text)
        self.assertIn("mode auto (profile .harden/profile.json sha256 aaaaaaaaaaaa, owner)", text)

    def test_missing_report_is_a_problem(self) -> None:
        (self.hdir / "report.md").unlink()
        code, text, _err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("Report: missing", text)
        self.assertIn("- .harden/report.md missing", text)


if __name__ == "__main__":
    unittest.main()
