"""Tests for scripts/run_state.py (unittest, temporary git repositories).

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import diff_guard as dg  # noqa: E402
import run_state as rs  # noqa: E402

SCRIPT = SCRIPTS / "run_state.py"
TRACKED_REASON = ("profile is tracked by the repository; the owner's profile must be "
                  "untracked")
_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None


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
    path = rs.extended_path(path)  # deep trees exceed 260 characters on Windows
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=fix)
    else:
        shutil.rmtree(path, onerror=fix)


def private_tempdir(case: unittest.TestCase) -> Path:
    """Point tempfile, and so the scratch directories run_state.py start makes under the OS
    temp directory, at a directory of this test; the cleanup restores it and removes it."""
    saved = tempfile.tempdir
    root = Path(tempfile.mkdtemp(prefix="harden-rs-tmp-"))
    tempfile.tempdir = str(root)

    def restore() -> None:
        tempfile.tempdir = saved
        _rmtree(str(root))
    case.addCleanup(restore)
    return root


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


def run_main(args: List[str]) -> Tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            code = rs.main(args)
        except SystemExit as exc:
            code = exc.code if isinstance(exc.code, int) else 2
    return code, out.getvalue(), err.getvalue()


class RunStateCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = private_tempdir(self)
        self.repo = Path(tempfile.mkdtemp(prefix="harden-rs-"))
        _git(self.repo, "init", "-q")
        _write(self.repo, "src/app.py", "def add(a, b):\n    return a + b\n")
        _write(self.repo, "tests/test_app.py", "def test_add():\n    assert 1 + 1 == 2\n")
        _write(self.repo, "tests/data/case.json", "{}\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "init")
        self.head = _git(self.repo, "rev-parse", "HEAD").strip()

    def tearDown(self) -> None:
        _rmtree(str(self.repo))

    def rs(self, *args: str) -> Tuple[int, str, str]:
        return run_main(list(args) + ["--repo", str(self.repo)])

    def hdir(self) -> Path:
        return self.repo / ".harden"

    def marker(self) -> Dict:
        return json.loads((self.hdir() / "active").read_text(encoding="utf-8"))

    def start_apply(self, *extra: str) -> Tuple[int, str, str]:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        return self.rs("start", "--mode", "apply", *extra)

    def log_events(self, events: List[Dict]) -> None:
        with open(self.hdir() / "hook_events.log", "a", encoding="utf-8") as handle:
            for event in events:
                handle.write(json.dumps(event) + "\n")


class StartRefusalTests(RunStateCase):
    def test_refuses_main_branch_and_names_run_branch(self) -> None:
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("main", err)
        self.assertIn("harden/" + date.today().isoformat(), err)
        self.assertFalse((self.hdir() / "active").exists())

    def test_refuses_master_branch(self) -> None:
        _git(self.repo, "branch", "-m", "master")
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("master", err)

    def test_refuses_remote_default_branch(self) -> None:
        _git(self.repo, "remote", "add", "origin", "https://example.invalid/repo.git")
        _git(self.repo, "update-ref", "refs/remotes/origin/trunk", "HEAD")
        _git(self.repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")
        _git(self.repo, "switch", "-q", "-c", "trunk")
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("remote default branch", err)

    def test_refuses_dirty_tree_but_ignores_run_directory(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        _write(self.repo, ".harden/config.json", "{}\n")
        _write(self.repo, "notes.txt", "draft\n")
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("?? notes.txt", err)
        self.assertNotIn(".harden", err.split("uncommitted changes")[1].split("Ask")[0])
        os.remove(self.repo / "notes.txt")
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 0, err)

    def test_refuses_modified_tracked_file(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        _write(self.repo, "src/app.py", "changed\n")
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("src/app.py", err)

    def test_refuses_detached_head(self) -> None:
        _git(self.repo, "switch", "-q", "--detach", "HEAD")
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("detached", err)

    def test_refuses_when_run_already_active(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("already active", err)

    def test_refuses_unknown_base_and_non_ancestor(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        code, _, err = self.rs("start", "--mode", "apply", "--base", "nope")
        self.assertEqual(code, 2)
        self.assertIn("not a commit", err)
        _git(self.repo, "switch", "-q", "-c", "side")
        _write(self.repo, "side.txt", "x\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "side")
        side = _git(self.repo, "rev-parse", "HEAD").strip()
        _git(self.repo, "switch", "-q", "harden/test")
        code, _, err = self.rs("start", "--mode", "apply", "--base", side)
        self.assertEqual(code, 2)
        self.assertIn("not an ancestor", err)

    def test_not_a_git_repository(self) -> None:
        plain = Path(tempfile.mkdtemp(prefix="harden-plain-"))
        try:
            code, _, err = run_main(["start", "--mode", "report-only", "--repo", str(plain)])
            self.assertEqual(code, 2)
            self.assertIn("not a git repository", err)
        finally:
            _rmtree(str(plain))


class StartTests(RunStateCase):
    def test_apply_writes_marker_canary_exclude_and_progress(self) -> None:
        code, out, err = self.start_apply()
        self.assertEqual(code, 0, err)
        marker = self.marker()
        for key in ("base_sha", "branch", "started", "mode", "scope", "test_globs",
                    "protected_globs", "allow_test_deletions", "canary_sha256"):
            self.assertIn(key, marker)
        self.assertEqual(marker["base_sha"], self.head)
        self.assertEqual(marker["branch"], "harden/test")
        # --mode apply is the older name of interactive (user-policy-autonomy U01-F01).
        self.assertEqual(marker["mode"], "interactive")
        self.assertEqual(marker["mode_requested"], "interactive")
        self.assertEqual(marker["mode_alias"], "apply")
        self.assertEqual(marker["allow_test_deletions"], [])
        self.assertIsNotNone(rs.parse_ts(marker["started"]))
        self.assertTrue(marker["started"].endswith("Z"))
        canary = (self.hdir() / "canary.txt").read_bytes()
        self.assertEqual(hashlib.sha256(canary).hexdigest(), marker["canary_sha256"])
        self.assertEqual(marker["test_globs"], dg.DEFAULT_TEST_GLOBS)
        self.assertEqual(marker["protected_globs"], dg.DEFAULT_PROTECTED_GLOBS)
        exclude = (self.repo / ".git" / "info" / "exclude").read_text(encoding="utf-8")
        self.assertIn("/.harden/", exclude.splitlines())
        progress = (self.hdir() / "progress.md").read_text(encoding="utf-8")
        for phase in rs.PHASES:
            self.assertIn("- [ ] " + phase, progress)
        self.assertIn("Canary", progress)
        self.assertIn("## Blocked items", progress)
        self.assertIn("run started: mode interactive", progress)
        self.assertIn("echo HARDEN_HOOK_CANARY", out)
        self.assertIn("canary.txt", out)
        self.assertIn("canary-check", out)
        self.assertIn("69970", out)
        self.assertEqual(_git(self.repo, "status", "--porcelain"), "")

    def test_marker_is_read_by_diff_guard_and_hook_guard(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        cfg = dg.load_run_config(self.repo)
        self.assertEqual(cfg.base_sha, self.head)
        import hook_guard as hg
        root = hg.find_run_root({"CLAUDE_PROJECT_DIR": str(self.repo / "src")}, {})
        self.assertIsNotNone(root)

    def test_report_only_allows_main_and_dirty_tree_with_warning(self) -> None:
        _write(self.repo, "notes.txt", "draft\n")
        code, out, err = self.rs("start", "--mode", "report-only")
        self.assertEqual(code, 0, err)
        self.assertIn("WARNING", out)
        self.assertEqual(self.marker()["mode"], "report-only")
        self.assertEqual(self.marker()["branch"], "main")

    def test_older_base_is_accepted_with_warning(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        _write(self.repo, "src/more.py", "x = 1\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "more")
        code, out, _ = self.rs("start", "--mode", "apply", "--base", "HEAD~1")
        self.assertEqual(code, 0)
        self.assertEqual(self.marker()["base_sha"], self.head)
        self.assertIn("older than HEAD", out)

    def test_inventory_globs_are_added_to_the_defaults(self) -> None:
        _write(self.repo, ".harden/inventory.json", json.dumps({
            "test_globs": ["checks/**"],
            "protected_globs_suggested": ["tests/**", "setup.cfg", "tools/lint.toml"]}))
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        self.assertEqual(marker["test_globs"], dg.DEFAULT_TEST_GLOBS + ["checks/**"])
        self.assertEqual(marker["protected_globs"], dg.DEFAULT_PROTECTED_GLOBS
                         + ["tests/**", "setup.cfg", "tools/lint.toml"])
        self.assertIn("inventory", marker["globs_source"]["test_globs"])
        self.assertIn("defaults", marker["globs_source"]["protected_globs"])
        # The suggestions never drop a default: tool configs the inventory did not detect,
        # lockfiles and manifests stay protected.
        cfg = dg.load_run_config(self.repo)
        for path in (".flake8", "deny.toml", "codecov.yml", "playwright.config.ts",
                     ".solhint.json", "pnpm-lock.yaml", "package.json", "tools/lint.toml"):
            self.assertIsNotNone(cfg.protected.first_match(path), path)
        import hook_guard as hg
        ctx = hg.Ctx(self.repo, None, cfg, self.marker())
        self.assertEqual(ctx.classify("deny.toml")[0], "protected")

    def test_config_globs_win_over_inventory_and_scope_comes_from_config(self) -> None:
        _write(self.repo, ".harden/inventory.json", chr(0xFEFF) + json.dumps({
            "test_globs": ["tests/**"], "protected_globs_suggested": ["x"]}))
        _write(self.repo, ".harden/config.json", json.dumps({
            "test_globs": ["spec/**"], "scope": ["src"]}))
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        self.assertEqual(marker["test_globs"], ["spec/**", "tests/**"])  # replaces the defaults; inventory globs join (A01-F53)
        self.assertIn("inventory", marker["globs_source"]["test_globs"])
        self.assertEqual(marker["protected_globs"], dg.DEFAULT_PROTECTED_GLOBS + ["x"])
        self.assertEqual(marker["scope"], ["src"])

    def test_inventory_test_globs_join_an_explicit_config_list_once(self) -> None:
        """pilot-auto-calibration A01-F53: the inventory's test globs join a config list, once."""
        _write(self.repo, ".harden/inventory.json", json.dumps({"test_globs": ["tests/**"]}))
        _write(self.repo, ".harden/config.json", json.dumps({
            "test_globs": ["spec/**", "tests/**"]}))
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        self.assertEqual(marker["test_globs"], ["spec/**", "tests/**"])
        self.assertEqual(marker["globs_source"]["test_globs"], ".harden/config.json")

    def test_scope_argument_is_normalised(self) -> None:
        code, _, _ = self.start_apply("--scope", "src/", str(self.repo / "tests"))
        self.assertEqual(code, 0)
        self.assertEqual(self.marker()["scope"], ["src", "tests"])

    def test_existing_progress_is_kept(self) -> None:
        _write(self.repo, ".harden/progress.md", "# mine\n")
        self.assertEqual(self.start_apply()[0], 0)
        progress = (self.hdir() / "progress.md").read_text(encoding="utf-8")
        self.assertTrue(progress.startswith("# mine\n"))
        self.assertIn("run started", progress)
        self.assertNotIn("## Checklist", progress)

    def test_phases_match_skill_checklist(self) -> None:
        skill = (SCRIPTS.parent / "SKILL.md").read_text(encoding="utf-8")
        listed = re.findall(r"^- \[ \] (\d .*?)\s*$", skill, re.M)
        self.assertEqual(listed[:len(rs.PHASES)], list(rs.PHASES))

    def test_invariant_two_names_checked_additions(self) -> None:
        self.assertIn("only gains lines strengthen.py accepts", rs.INVARIANTS[1])
        self.assertIn("never remove, change, skip or weaken a line", rs.INVARIANTS[1])
        self.assertTrue(rs.RED_FLAGS[0].startswith("remove, change, skip or wrap a line"))

    def test_progress_template_carries_invariants_and_resume_line(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        progress = (self.hdir() / "progress.md").read_text(encoding="utf-8")
        self.assertIn(rs.RESUME_LINE, progress)
        # SKILL.md invariant 10: re-read the skill from skill_dir and continue; an autonomous
        # run never stops to ask for /harden --resume (user-policy-autonomy U01-F01).
        self.assertIn("Read SKILL.md in the skill_dir recorded under Run below and continue "
                      "from this file; the hooks stay registered for the session. In autonomous "
                      "mode never stop to ask for /harden --resume (the user may still type "
                      "it).", progress)
        self.assertNotIn("stop editing and ask the user to type /harden --resume", progress)
        for line in rs.INVARIANTS:
            self.assertIn(line, progress)
        for flag in rs.RED_FLAGS:
            self.assertIn("- " + flag, progress)
        self.assertIn("- never ask or wait in autonomous mode; never run a forbidden command in "
                      "another form;", progress)
        self.assertIn("DC-15 test deletions, only with --interactive approval", rs.INVARIANTS[1])
        self.assertIn("Read SKILL.md in the skill_dir", rs.INVARIANTS[9])
        self.assertIn("never stop to ask for /harden --resume", rs.INVARIANTS[9])
        self.assertEqual(len(rs.INVARIANTS), 10)
        # One progress line per SKILL.md red flag.
        skill_text = (SCRIPTS.parent / "SKILL.md").read_text(encoding="utf-8")
        section = skill_text.split("## Red flags", 1)[1].split("## Workflow", 1)[0]
        self.assertEqual(len(re.findall(r"^- ", section, re.M)), len(rs.RED_FLAGS))
        marker = self.marker()
        skill_dir = SCRIPTS.parent.resolve().as_posix()
        self.assertEqual(marker["skill_dir"], skill_dir)
        self.assertIn("- skill_dir: " + skill_dir, progress)
        self.assertIn("Read {}/SKILL.md again".format(skill_dir), progress)
        self.assertEqual(marker["head_at_start"], self.head)
        # The invariant titles are SKILL.md's bold titles (numbered 1-10).
        skill = (SCRIPTS.parent / "SKILL.md").read_text(encoding="utf-8")
        titles = re.findall(r"^\d+\. \*\*(.+?)\*\*", skill, re.M)[:10]
        self.assertEqual(len(titles), 10)
        for number, (title, line) in enumerate(zip(titles, rs.INVARIANTS), start=1):
            self.assertTrue(line.startswith("{}. {}".format(number, title.rstrip(":"))),
                            (title, line))
        # SKILL.md invariant 10 says the same as the progress line.
        tenth = skill.split("10. **Keep run state outside the conversation.**", 1)[1]
        tenth = " ".join(tenth.split("## Red flags", 1)[0].split())
        self.assertIn("Read `SKILL.md` in the `skill_dir`", tenth)
        self.assertIn("never stop to ask for `/harden --resume`", tenth)
        self.assertNotIn("ask the user to type", tenth)

    def test_phase_six_names_both_approval_sources(self) -> None:
        self.assertEqual(rs.PHASES[6], "6 Approve (profile in autonomous mode, live answers "
                                       "with --interactive)")
        self.assertEqual(rs.phase_label(6), "Approve")


def valid_profile(**overrides: object) -> Dict:
    """A run profile that lets an autonomous run apply (user-policy-autonomy U01-F04)."""
    data: Dict = {
        "version": 1, "mode": "auto",
        "gates": [{"name": "test", "cmd": [sys.executable, "-m", "pytest", "-q"], "cwd": ".",
                   "timeout_s": 600, "count_regex": "(\\d+) passed"}],
        "e2e": [{"name": "smoke", "cmd": [sys.executable, "-c", "print(1)"], "cwd": "src",
                 "timeout_s": 60, "compare": True}],
        "network": "denied", "live_side_effects": "none",
        "forbidden_commands": ["npm run deploy", "/\\bgit\\s+push\\b/"],
        "situation": "handover",
        "auto_apply": {"structural": True, "behavioural": True, "dependencies": False,
                       "money_paths": False},
        "sandbox_ack": True}
    data.update(overrides)
    return data


class AutonomousModeTests(RunStateCase):
    """Mode auto is the default (user-policy-autonomy U01-F01 to U01-F04)."""

    def write_profile(self, data: Dict, rel: str = ".harden/profile.json") -> str:
        _write(self.repo, rel, json.dumps(data))
        return hashlib.sha256((self.repo / rel).read_bytes()).hexdigest()

    def progress(self) -> str:
        return (self.hdir() / "progress.md").read_text(encoding="utf-8")

    def test_default_mode_without_profile_starts_report_only_with_the_reason(self) -> None:
        code, out, err = self.rs("start")  # on main: report-only is allowed there
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual((marker["mode"], marker["mode_requested"]), ("report-only", "auto"))
        self.assertIn("no run profile", marker["mode_reasons"][0])
        self.assertIn("U01-F04", marker["mode_reasons"][0])
        self.assertFalse(marker["profile"]["present"])
        self.assertIsNone(marker["profile_sha256"])
        self.assertEqual(marker["forbidden_commands"], [])
        self.assertIn("mode:      report-only (requested auto)", out)
        self.assertIn("NOTE: the autonomous run continues in report-only mode", out)
        self.assertIn("execute no project code", out)
        self.assertNotIn("Baseline:", out)
        # Fallen back to report-only, the run is still autonomous: it asks nobody.
        self.assertNotIn("ask before editing", out)
        self.assertIn("report-only and asks nobody", out)
        self.assertIn("autonomous mode: do not wait for the user", out)
        progress = self.progress()
        self.assertIn("- Mode: report-only (requested auto: no run profile", progress)
        self.assertIn("default: requested mode auto -> report-only: no run profile", progress)
        self.assertIn("- Profile: none", progress)

    def test_progress_names_how_money_paths_are_decided(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile())
        code, out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        self.assertIn("money paths by judgement (money_paths_globs not set)", self.progress())
        self.assertIsNone(self.marker()["profile"]["effective"]["money_paths_globs"])
        self.assertTrue(any(d.startswith("money_paths_globs: not set")
                            for d in self.marker()["profile"]["defaults"]))

    def test_progress_names_the_money_paths_globs(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile(money_paths_globs=["src/", "tests/data/*.json"]))
        code, out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        effective = self.marker()["profile"]["effective"]
        self.assertEqual(effective["money_paths_globs"], ["src/", "tests/data/*.json"])
        self.assertEqual(effective["money_paths_source"], "globs")
        self.assertIn("money paths by money_paths_globs (2 pattern(s))", self.progress())
        self.assertNotIn("PROFILE WARNING: money_paths_globs", out)

    def test_a_money_glob_matching_nothing_is_reported_at_start(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile(money_paths_globs=["src/", "lib/wallet/"]))
        code, out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.marker()["mode"], "auto")  # a warning, not a blocker
        self.assertIn("PROFILE WARNING: money_paths_globs[1] 'lib/wallet/' matches no tracked "
                      "file of the base commit", out)
        self.assertIn("money paths by judgement (money_paths_globs ignored: pattern(s) "
                      "'lib/wallet/' match no file of the base commit)", self.progress())

    def test_a_valid_profile_starts_an_autonomous_run(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        sha = self.write_profile(valid_profile())
        code, out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["mode"], "auto")
        self.assertNotIn("mode_reasons", marker)
        self.assertEqual(marker["profile_sha256"], sha)
        self.assertTrue(marker["profile"]["valid"])
        self.assertTrue(marker["profile"]["autonomous_apply"])
        self.assertEqual(marker["profile"]["effective"]["situation"], "handover")
        self.assertEqual(marker["forbidden_commands"], ["npm run deploy", "/\\bgit\\s+push\\b/"])
        self.assertIn("profile:   .harden/profile.json sha256 " + sha[:12], out)
        self.assertIn("Baseline:", out)
        self.assertIn("sandbox_ack is not true", out)
        progress = self.progress()
        self.assertIn("- Autonomy (user-policy-autonomy U01-F01): never wait for the user",
                      progress)
        self.assertIn("autonomous apply yes", progress)
        # The hook enforces the copied bans.
        import hook_guard as hg
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(self.repo),
                   "session_id": "s1", "tool_input": {"command": "git push origin harden/test"}}
        err_io = io.StringIO()
        self.assertEqual(hg.run(json.dumps(payload), {"CLAUDE_PROJECT_DIR": str(self.repo)},
                                io.StringIO(), err_io), 2)
        self.assertIn("profile-forbidden", err_io.getvalue())

    def test_an_autonomous_run_still_refuses_a_main_branch(self) -> None:
        self.write_profile(valid_profile())
        code, _, err = self.rs("start", "--mode", "auto")
        self.assertEqual(code, 2)
        self.assertIn("refusing to start in auto mode", err)
        self.assertIn("git switch -c harden/", err)
        self.assertFalse((self.hdir() / "active").exists())

    def test_an_invalid_profile_falls_back_and_keeps_its_bans(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile({"version": 2, "forbidden_commands": ["sign-tx", "/(/"]})
        code, out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["mode"], "report-only")
        self.assertIn("is invalid (version must be 1", marker["mode_reasons"][0])
        self.assertEqual(marker["forbidden_commands"], ["sign-tx"])
        self.assertFalse(marker["profile"]["valid"])
        self.assertIn("invalid", out)

    def test_profile_blockers_fall_back_to_report_only(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile(live_side_effects="unconfirmed"))
        self.assertEqual(self.rs("start")[0], 0)
        marker = self.marker()
        self.assertEqual(marker["mode"], "report-only")
        self.assertIn("PF-03", marker["mode_reasons"][0])
        self.assertTrue(marker["profile"]["valid"])
        self.assertFalse(marker["profile"]["autonomous_apply"])

    def test_native_windows_without_sandbox_ack_falls_back(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile(sandbox_ack=False))
        with mock.patch.object(rs.vp, "native_windows", return_value=True):
            self.assertEqual(self.rs("start")[0], 0)
        self.assertEqual(self.marker()["mode"], "report-only")
        self.assertIn("sandbox_ack is false", self.marker()["mode_reasons"][0])

    def test_a_dirty_tree_falls_back_instead_of_stopping(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile())
        _write(self.repo, "notes.txt", "draft\n")
        code, out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.marker()["mode"], "report-only")
        self.assertIn("cannot ask the owner to commit or stash", self.marker()["mode_reasons"][0])
        self.assertIn("notes.txt", json.dumps(self.marker()["dirty_at_start"]))
        # Interactive mode still refuses the dirty tree.
        self.assertEqual(self.rs("stop")[0], 0)
        code, _, err = self.rs("start", "--mode", "interactive")
        self.assertEqual(code, 2)
        self.assertIn("uncommitted changes", err)

    def test_profile_option_copies_the_file_and_keeps_the_previous_one(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        old = json.dumps(valid_profile(situation="pre-audit"))
        _write(self.repo, ".harden/profile.json", old)
        other = self.tmp / "owner-profile.json"
        other.write_text(json.dumps(valid_profile()), encoding="utf-8")
        code, out, err = self.rs("start", "--profile", str(other))
        self.assertEqual(code, 0, err)
        self.assertIn("copied --profile", out)
        self.assertEqual((self.hdir() / "profile.json").read_bytes(), other.read_bytes())
        self.assertEqual((self.hdir() / "profile.previous.json").read_text(encoding="utf-8"),
                         old)
        self.assertEqual(self.marker()["mode"], "auto")
        self.assertEqual(self.marker()["profile"]["effective"]["situation"], "handover")

    def test_an_unreadable_profile_option(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile())
        missing = str(self.tmp / "missing.json")
        self.assertEqual(self.rs("start", "--profile", missing)[0], 0)
        self.assertEqual(self.marker()["mode"], "report-only")
        self.assertIn("cannot read --profile", self.marker()["mode_reasons"][0])
        self.assertEqual(self.rs("stop")[0], 0)
        code, out, _ = self.rs("start", "--mode", "interactive", "--profile", missing)
        self.assertEqual(code, 0)
        self.assertEqual(self.marker()["mode"], "interactive")
        self.assertIn("WARNING: cannot read --profile", out)

    def test_interactive_is_the_new_name_of_apply(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.assertEqual(self.rs("start", "--mode", "interactive")[0], 0)
        marker = self.marker()
        self.assertEqual((marker["mode"], marker["mode_requested"]),
                         ("interactive", "interactive"))
        self.assertNotIn("mode_alias", marker)
        self.assertNotIn("Autonomy", self.progress())
        for mode in ("auto", "interactive", "apply"):
            code, _, err = self.rs("set-mode", mode)
            self.assertEqual(code, 2)
            self.assertIn("--mode auto or --mode interactive", err)

    def test_status_reports_a_changed_profile_and_bypass_without_sandbox_ack(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile(sandbox_ack=False))
        with mock.patch.object(rs.vp, "native_windows", return_value=False):
            self.assertEqual(self.rs("start")[0], 0)
        marker = self.marker()
        self.assertEqual(marker["mode"], "auto")
        session = {"run": "{}|{}".format(marker["base_sha"], marker["started"]),
                   "permission_mode": "bypassPermissions", "modes_seen": ["bypassPermissions"]}
        (self.hdir() / "session.json").write_text(json.dumps(session), encoding="utf-8")
        data = json.loads(self.rs("status", "--json")[1])
        self.assertTrue(data["profile_now"]["unchanged"])
        self.assertTrue(any("sandbox_ack is not true" in w and "set-mode report-only" in w
                            for w in data["warnings"]))
        self.write_profile(valid_profile(sandbox_ack=True))
        data = json.loads(self.rs("status", "--json")[1])
        self.assertFalse(data["profile_now"]["unchanged"])
        self.assertTrue(any("changed since the run started" in w for w in data["warnings"]))
        text = self.rs("status")[1]
        self.assertIn("profile:", text)
        self.assertIn("mode_requested:", text)

    def commit_all(self, message: str, *force: str) -> None:
        if force:
            _git(self.repo, "add", "-f", *force)
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", message)

    def test_decide_mode_puts_the_tracked_reason_first(self) -> None:
        import validate_profile as vp
        profile = {"present": True, "valid": False, "tracked": "git tracks .harden/profile.json",
                   "errors": [vp.tracked_error("git tracks .harden/profile.json")],
                   "blockers": []}
        mode, reasons = rs.decide_mode("auto", profile, ["?? notes.txt"])
        self.assertEqual(mode, "report-only")
        self.assertEqual(len(reasons), 1)
        self.assertTrue(reasons[0].startswith(TRACKED_REASON), reasons[0])
        self.assertIn("git tracks .harden/profile.json", reasons[0])
        self.assertEqual(rs.decide_mode("interactive", profile, []), ("interactive", []))
        self.assertEqual(vp.TRACKED_REASON, TRACKED_REASON)

    def test_a_tracked_profile_is_no_consent(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile(forbidden_commands=["sign-tx"]))
        self.commit_all("ship a run profile", ".harden/profile.json")
        code, out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual((marker["mode"], marker["mode_requested"]), ("report-only", "auto"))
        self.assertTrue(marker["mode_reasons"][0].startswith(TRACKED_REASON),
                        marker["mode_reasons"])
        self.assertIn("git tracks .harden/profile.json", marker["mode_reasons"][0])
        self.assertFalse(marker["profile"]["valid"])
        self.assertFalse(marker["profile"]["autonomous_apply"])
        self.assertIn(".harden/profile.json", marker["profile"]["tracked"])
        # A ban only restricts the run: the file's usable bans are still enforced.
        self.assertEqual(marker["forbidden_commands"], ["sign-tx"])
        self.assertIn(TRACKED_REASON, out)
        self.assertIn("tracked by the repository", self.progress())
        self.assertNotIn("Baseline:", out)
        # --interactive keeps its live approvals and only warns.
        self.assertEqual(self.rs("stop")[0], 0)
        code, out, err = self.rs("start", "--mode", "interactive")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.marker()["mode"], "interactive")
        self.assertIn("WARNING: the run profile is invalid (" + TRACKED_REASON, out)

    def test_a_profile_the_base_commit_holds_is_no_consent(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        self.write_profile(valid_profile())
        self.commit_all("ship a run profile", ".harden/profile.json")
        _git(self.repo, "rm", "-q", "--cached", ".harden/profile.json")
        _git(self.repo, "commit", "-q", "-m", "untrack the run profile")
        self.assertEqual(_git(self.repo, "ls-files", ".harden"), "")
        code, _, err = self.rs("start", "--base", "HEAD~1")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["mode"], "report-only")
        self.assertTrue(marker["mode_reasons"][0].startswith(TRACKED_REASON))
        self.assertIn("the base commit {} holds .harden/profile.json".format(
            marker["base_sha"][:12]), marker["mode_reasons"][0])
        # From a base that no longer holds it, the owner's untracked file is consent.
        self.assertEqual(self.rs("stop")[0], 0)
        self.assertEqual(self.rs("start")[0], 0)
        self.assertEqual(self.marker()["mode"], "auto")
        self.assertIsNone(self.marker()["profile"]["tracked"])

    def test_a_tracked_profile_option_is_never_copied(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        _write(self.repo, "ops/profile.json", json.dumps(valid_profile(
            forbidden_commands=["sign-tx"])))
        self.commit_all("ship a profile")
        own = json.dumps(valid_profile())
        _write(self.repo, ".harden/profile.json", own)
        source = self.repo / "ops" / "profile.json"
        code, out, err = self.rs("start", "--profile", str(source))
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["mode"], "report-only")
        self.assertTrue(marker["mode_reasons"][0].startswith(TRACKED_REASON))
        self.assertIn("--profile ", marker["mode_reasons"][0])
        self.assertIn("git tracks ops/profile.json", marker["mode_reasons"][0])
        self.assertEqual(len(marker["mode_reasons"]), 1)
        self.assertIn("was not copied to .harden/profile.json", out)
        self.assertIn("tracked by the repository, so no consent", out)
        # The owner's untracked file stays as it was, and no copy launders the source.
        self.assertEqual((self.hdir() / "profile.json").read_text(encoding="utf-8"), own)
        self.assertFalse((self.hdir() / "profile.previous.json").exists())
        self.assertEqual(marker["forbidden_commands"],
                         ["npm run deploy", "/\\bgit\\s+push\\b/", "sign-tx"])
        # An untracked source outside the repository is copied as before.
        self.assertEqual(self.rs("stop")[0], 0)
        other = self.tmp / "owner-profile.json"
        other.write_text(json.dumps(valid_profile(situation="pre-audit")), encoding="utf-8")
        code, out, err = self.rs("start", "--profile", str(other))
        self.assertEqual(code, 0, err)
        self.assertEqual(self.marker()["mode"], "auto")
        self.assertIn("copied --profile", out)

    def test_a_tracked_profile_json_is_not_overwritten_by_the_profile_option(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        shipped = json.dumps(valid_profile(situation="pre-audit"))
        _write(self.repo, ".harden/profile.json", shipped)
        self.commit_all("ship a run profile", ".harden/profile.json")
        other = self.tmp / "owner-profile.json"
        other.write_text(json.dumps(valid_profile()), encoding="utf-8")
        code, out, err = self.rs("start", "--profile", str(other))
        self.assertEqual(code, 0, err)
        self.assertEqual((self.hdir() / "profile.json").read_text(encoding="utf-8"), shipped)
        self.assertIn("the repository holds .harden/profile.json", out)
        self.assertEqual(self.marker()["mode"], "report-only")
        self.assertTrue(self.marker()["mode_reasons"][0].startswith(TRACKED_REASON))


class ProfileTemplateTests(RunStateCase):
    INVENTORY = {
        "gates_suggested": [
            {"name": "test", "cmd": "pnpm run test", "cwd": ".", "timeout_s": 1800,
             "source": "package.json scripts.test"},
            {"name": "lint", "cmd": "pnpm run lint", "cwd": ".", "timeout_s": 900,
             "source": "package.json scripts.lint",
             "warnings": ["masking construct: || true"]}],
        "command_candidates": {
            "test": [{"cmd": "pnpm run test", "cwd": "."},
                     {"cmd": "pnpm run test:unit", "cwd": ".",
                      "source": "package.json scripts.test:unit"}],
            "lint": [{"cmd": "pnpm run lint", "cwd": "."}], "build": []}}

    def test_template_from_the_inventory(self) -> None:
        _write(self.repo, ".harden/inventory.json", json.dumps(self.INVENTORY))
        code, out, err = self.rs("profile-template")
        self.assertEqual(code, 0, err)
        path = self.hdir() / "profile.template.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertIs(data["template"], True)
        self.assertEqual([g["name"] for g in data["gates"]], ["test", "lint"])
        self.assertEqual(data["gates"][0], {"name": "test", "cmd": "pnpm run test", "cwd": ".",
                                            "timeout_s": 1800})
        # Conservative pre-fill: every looser value is the owner's explicit opt-in.
        self.assertEqual((data["live_side_effects"], data["network"], data["sandbox_ack"]),
                         ("unconfirmed", "denied", False))
        # auto_apply: every switch true, the owner's decision of 2026-09-25 (U01-F06).
        self.assertEqual(data["auto_apply"], {"structural": True, "behavioural": True,
                                              "dependencies": True, "money_paths": True,
                                              "owner_judgement": True,
                                              "dependency_versions": False})
        # budget and detection keys are drafted unset (pilot-auto-calibration A01-F34, A01-F35)
        self.assertEqual(data["budget"], {"max_tokens": None, "deadline_utc": None,
                                          "max_usd": None, "max_minutes": None})
        self.assertEqual(data["detection"], {"max_concurrent_subagents": 4,
                                             "lens_bundles": "auto", "pass_model": None})
        self.assertEqual(data["situation"], "")
        self.assertEqual(data["e2e"], [])
        comment = "\n".join(data["comment"])
        self.assertIn("pnpm run test:unit", comment)
        self.assertIn("WARNING: masking construct", comment)
        self.assertNotIn("test: pnpm run test (cwd", comment)  # the chosen one is not repeated
        self.assertIn("situation: left empty on purpose", comment)
        self.assertIn("'maintenance only'", comment)
        self.assertIn("Pre-filled: every switch true", comment)
        # This repository has no package manifest: self-setup cleared no command (PF-23).
        self.assertIn("UNCLASSIFIED: self-setup cleared no command", comment)
        self.assertIn("dependency_versions stays false", comment)
        self.assertIn("Set owner_judgement false for the scope before that decision", comment)
        self.assertNotIn("money_paths_globs", data)  # absent: judgement, the conservative reading
        self.assertIn("money_paths_globs: left out, so the run decides by judgement", comment)
        self.assertFalse((self.hdir() / "profile.json").exists())
        self.assertIn("Never rename, edit or approve it yourself", out)
        self.assertIn("live_side_effects is 'unconfirmed'", out)
        self.assertIn("situation must be one of", out)  # a problem the owner must fix
        import validate_profile as vp
        check = vp.check_document(data, repo=self.repo)
        self.assertEqual(len(check.errors), 2, check.errors)
        self.assertIn("unreviewed template", check.errors[0])
        self.assertIn("situation must be one of", check.errors[1])
        data.pop("template")
        self.assertFalse(vp.check_document(data, repo=self.repo).valid)  # situation unset
        data["situation"] = "handover"
        data["live_side_effects"] = "none"
        data["sandbox_ack"] = True
        reviewed = vp.check_document(data, repo=self.repo)
        self.assertTrue(reviewed.valid, reviewed.errors)
        self.assertEqual(reviewed.blockers, [])
        self.assertIsNotNone(vp.forbidden_match("git push", vp.compile_patterns(
            data["forbidden_commands"])[0]))
        self.assertIsNotNone(vp.forbidden_match("pnpm run deploy:prod", vp.compile_patterns(
            data["forbidden_commands"])[0]))
        self.assertIsNone(vp.forbidden_match("pnpm run test", vp.compile_patterns(
            data["forbidden_commands"])[0]))

    def test_template_without_inventory(self) -> None:
        code, out, _ = self.rs("profile-template")
        self.assertEqual(code, 0)
        self.assertIn("no inventory", out)
        data = json.loads((self.hdir() / "profile.template.json").read_text(encoding="utf-8"))
        self.assertEqual(data["gates"], [])
        self.assertIn("gates is empty", out)
        code, out, _ = self.rs("profile-template")
        self.assertIn("Rewrote", out)
        exclude = (self.repo / ".git" / "info" / "exclude").read_text(encoding="utf-8")
        self.assertIn("/.harden/", exclude.splitlines())


class SelfSetupStartTests(RunStateCase):
    """run_state.py and self-setup (protocol-preflight PF-23; user-policy-autonomy U01-F05)."""

    def setUp(self) -> None:
        super().setUp()
        _write(self.repo, "package.json", json.dumps(
            {"name": "a", "packageManager": "pnpm@10.0.0",
             "scripts": {"test": "vitest run", "release": "semantic-release"}}))
        _write(self.repo, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
        _write(self.repo, "a.test.ts", "it('a', () => {});\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "js")
        self.head = _git(self.repo, "rev-parse", "HEAD").strip()

    def write_report(self, bans: List[Dict], base: Optional[str] = None) -> None:
        _write(self.repo, ".harden/" + rs.INFERENCE_NAME, json.dumps(
            {"base_sha": base or self.head, "forbidden_commands": bans}))

    def test_template_prefers_the_classification(self) -> None:
        _write(self.repo, ".harden/inventory.json", json.dumps({}))
        code, out, err = self.rs("profile-template")
        self.assertEqual(code, 0, err)
        data = json.loads((self.hdir() / "profile.template.json").read_text(encoding="utf-8"))
        self.assertEqual([g["name"] for g in data["gates"]], ["test", "test-shuffled"])
        self.assertIs(data["gates"][0]["inherit_env"], False)
        comment = "\n".join(data["comment"])
        self.assertIn("Not a gate: pnpm run release (forbidden", comment)
        self.assertNotIn("UNCLASSIFIED", comment)

    def test_inferred_bans_merge_into_an_owner_run_but_never_block_its_install(self) -> None:
        import validate_profile as vp
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        _write(self.repo, ".harden/profile.json", json.dumps(valid_profile()))
        self.write_report([
            {"pattern": "/\\bpnpm\\s+install\\b/i", "signals": ["L5"]},
            {"pattern": "/\\bsemantic-release\\b/i", "signals": ["L1", "script"]},
            {"pattern": "/\\bcheck:live\\b/i", "signals": ["T", "script"]},
            {"pattern": vp.GENERIC_BANS[0], "signals": ["generic"]}])
        code, out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["profile_origin"], "owner")
        self.assertEqual(marker["forbidden_commands_inferred"], ["/\\bsemantic-release\\b/i"])
        self.assertIn("/\\bsemantic-release\\b/i", marker["forbidden_commands"])
        self.assertNotIn("/\\bpnpm\\s+install\\b/i", marker["forbidden_commands"])
        progress = (self.hdir() / "progress.md").read_text(encoding="utf-8")
        self.assertIn("it matches the owner's lockfile install (pnpm-lock.yaml)", progress)
        self.assertIn("name-token ban /\\bcheck:live\\b/i listed in the report, not merged",
                      progress)

    def test_inferred_bans_of_another_base_are_ignored(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        _write(self.repo, ".harden/profile.json", json.dumps(valid_profile()))
        self.write_report([{"pattern": "/\\bsemantic-release\\b/i", "signals": ["L1"]}],
                          base="0" * 40)
        code, _out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        self.assertEqual(self.marker()["forbidden_commands_inferred"], [])

    def test_inferred_profile_of_another_base_starts_report_only(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        profile = valid_profile(
            origin={"kind": "inferred", "tool": "infer_profile.py", "tool_version": 1,
                    "created_utc": "2026-09-25T22:00:00Z", "base_sha": "a" * 40,
                    "consent": "the owner's /harden invocation (user-policy-autonomy U01-F05)"})
        _write(self.repo, ".harden/profile.json", json.dumps(profile))
        code, _out, err = self.rs("start")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["mode"], "report-only")
        self.assertTrue(any("run self-setup again" in r for r in marker["mode_reasons"]))
        self.assertEqual(marker["profile_origin"], "inferred")


class CanaryTests(RunStateCase):
    def setUp(self) -> None:
        super().setUp()
        self.assertEqual(self.start_apply()[0], 0)
        self.started = self.marker()["started"]

    def event(self, code: str, ts: Optional[str] = None, **extra: str) -> Dict:
        transcript = self.hdir() / "transcript.jsonl"
        transcript.write_text("{}\n", encoding="utf-8")
        data = {"ts": ts or self.started, "event": "PreToolUse",
                "tool": "Bash" if code == "canary-bash" else "Edit", "reason_code": code,
                "path_or_cmd": "echo HARDEN_HOOK_CANARY", "session_id": "s-1",
                "transcript_path": str(transcript)}
        data.update(extra)
        return data

    def test_denials_without_hook_evidence_do_not_count(self) -> None:
        self.log_events([self.event("canary-bash", session_id=""),
                         self.event("canary-edit", transcript_path=str(self.repo / "nope"))])
        code, out, _ = self.rs("canary-check")
        self.assertEqual(code, 1)
        self.assertIn("canary-bash denial since", out)
        self.assertIn("no session_id", out)
        self.assertIn("is not an existing file", out)
        legacy = {k: v for k, v in self.event("canary-edit").items()
                  if k not in ("session_id", "transcript_path")}
        self.log_events([self.event("canary-bash"), legacy])
        code, out, _ = self.rs("canary-check")
        self.assertEqual(code, 1)
        self.log_events([self.event("canary-edit")])
        self.assertEqual(self.rs("canary-check")[0], 0)

    def test_run_control_events_are_not_denials(self) -> None:
        self.log_events([{"ts": self.started, "event": "PreToolUse", "tool": "Bash",
                          "type": "run-control", "decision": "allow",
                          "actions": ["run_state.py set-mode"], "reason_code": "canary-edit",
                          "session_id": "s-1", "transcript_path": str(self.repo)}])
        self.assertEqual(self.rs("canary-check")[0], 1)

    def progress(self) -> str:
        return (self.hdir() / "progress.md").read_text(encoding="utf-8")

    def test_pass_with_both_denials_after_start(self) -> None:
        self.log_events([self.event("canary-bash"), self.event("canary-edit")])
        code, out, _ = self.rs("canary-check")
        self.assertEqual(code, 0)
        self.assertIn("PASS", out)
        self.assertIn("Canary: PASS", self.progress())

    def test_fail_without_log_mentions_report_only_and_issue(self) -> None:
        code, out, _ = self.rs("canary-check")
        self.assertEqual(code, 1)
        self.assertIn("report-only", out)
        self.assertIn("#69970", out)
        self.assertIn("Canary: FAIL", self.progress())

    def test_fail_when_one_denial_is_missing(self) -> None:
        self.log_events([self.event("canary-bash")])
        code, out, _ = self.rs("canary-check")
        self.assertEqual(code, 1)
        self.assertIn("canary-edit", out)

    def test_events_before_start_do_not_count(self) -> None:
        old = (rs.parse_ts(self.started) - timedelta(days=1)).isoformat()
        self.log_events([self.event("canary-bash", old), self.event("canary-edit", old)])
        self.assertEqual(self.rs("canary-check")[0], 1)

    def test_explicit_allow_decision_does_not_count(self) -> None:
        self.log_events([self.event("canary-bash"), self.event("canary-edit", decision="allow")])
        self.assertEqual(self.rs("canary-check")[0], 1)

    def test_modified_canary_fails_even_with_denials(self) -> None:
        self.log_events([self.event("canary-bash"), self.event("canary-edit")])
        with open(self.hdir() / "canary.txt", "a", encoding="utf-8") as handle:
            handle.write("edited\n")
        code, out, _ = self.rs("canary-check")
        self.assertEqual(code, 1)
        self.assertIn("modified", out)

    def test_malformed_lines_and_fractional_timestamps(self) -> None:
        with open(self.hdir() / "hook_events.log", "w", encoding="utf-8") as handle:
            handle.write(chr(0xFEFF) + json.dumps(self.event("canary-edit")) + "\n")
            handle.write("not json\n[1, 2]\n")
        frac = self.started[:-1] + ".5+00:00"
        self.log_events([self.event("canary-bash", frac)])
        self.assertEqual(self.rs("canary-check")[0], 0)

    def test_no_active_run(self) -> None:
        self.assertEqual(self.rs("stop")[0], 0)
        code, _, err = self.rs("canary-check")
        self.assertEqual(code, 2)
        self.assertIn("no active", err)


class NestedRepositoryCanaryTests(unittest.TestCase):
    def test_failure_names_the_enclosing_repository(self) -> None:
        private_tempdir(self)
        outer = Path(tempfile.mkdtemp(prefix="harden-outer-"))
        try:
            _git(outer, "init", "-q")
            _write(outer, "notes.md", "outer\n")
            inner = outer / "projects" / "bot"
            inner.mkdir(parents=True)
            _git(inner, "init", "-q")
            _write(inner, "src/app.py", "x = 1\n")
            _git(inner, "add", "-A")
            _git(inner, "commit", "-q", "-m", "init")
            self.assertEqual(run_main(["start", "--mode", "report-only", "--repo",
                                       str(inner)])[0], 0)
            code, out, _ = run_main(["canary-check", "--repo", str(inner)])
            self.assertEqual(code, 1)
            self.assertIn("sits inside another git repository", out)
            self.assertIn("cd \"", out)
        finally:
            _rmtree(str(outer))


class AllowTestDeletionTests(RunStateCase):
    def setUp(self) -> None:
        super().setUp()
        self.assertEqual(self.start_apply()[0], 0)

    def allow(self, *args: str) -> Tuple[int, str, str]:
        return self.rs("allow-test-deletion", *args)

    def test_records_string_and_metadata(self) -> None:
        code, out, err = self.allow("tests/test_app.py", "--cases", "2", "--reason", "H-007")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["allow_test_deletions"], ["tests/test_app.py"])
        meta = marker["allow_test_deletions_meta"][0]
        self.assertEqual(meta["path"], "tests/test_app.py")
        self.assertEqual(meta["reason"], "H-007")
        self.assertEqual(meta["cases"], 2)
        self.assertIsNotNone(rs.parse_ts(meta["approved_at"]))
        cfg = dg.load_run_config(self.repo)  # plain strings: no ConfigError
        self.assertTrue(cfg.allow.first_match("tests/test_app.py"))
        self.assertIn("Test deletion allowed: tests/test_app.py",
                      (self.hdir() / "progress.md").read_text(encoding="utf-8"))
        self.assertIn("delete the approved test cases in the refactor(dead-code) commit that "
                      "deletes the production symbols they reference (DC-15)", out)
        self.assertNotIn("own commit", out)

    def test_cases_are_required_and_counted_once_per_record(self) -> None:
        self.assertEqual(self.allow("tests/test_app.py", "--reason", "H-1")[0], 2)
        self.assertEqual(self.allow("tests/test_app.py", "--cases", "0", "--reason", "H-1")[0], 2)
        _write(self.repo, "tests/test_two.py", "def test_y():\n    pass\n")
        self.assertEqual(self.rs("stop", "--force")[0], 0)
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "second test")
        self.assertEqual(self.rs("start", "--mode", "apply")[0], 0)
        code, _, err = self.allow("tests/test_app.py", "tests/test_two.py", "--cases", "3",
                                  "--reason", "H-2")
        self.assertEqual(code, 0, err)
        meta = self.marker()["allow_test_deletions_meta"]
        self.assertEqual([(m["path"], m["cases"]) for m in meta],
                         [("tests/test_app.py", 3), ("tests/test_two.py", 0)])
        self.assertEqual(meta[1]["cases_counted_with"], "tests/test_app.py")
        import gates as G
        adj = G.approved_case_deletions([self.hdir() / "active"])
        self.assertEqual(adj["cases_removed"], 3)

    def test_directory_becomes_directory_glob(self) -> None:
        self.assertEqual(self.allow("tests/data", "--cases", "1", "--reason", "H-1")[0], 0)
        self.assertEqual(self.marker()["allow_test_deletions"], ["tests/data/"])
        cfg = dg.load_run_config(self.repo)
        self.assertTrue(cfg.allow.first_match("tests/data/case.json"))

    def test_path_missing_at_base_records_nothing(self) -> None:
        _write(self.repo, "tests/test_new.py", "def test_x():\n    pass\n")
        code, _, err = self.allow("tests/test_app.py", "tests/test_new.py", "--cases", "1",
                                  "--reason", "H-2")
        self.assertEqual(code, 2)
        self.assertIn("tests/test_new.py", err)
        self.assertEqual(self.marker()["allow_test_deletions"], [])

    def test_empty_reason_and_outside_path_are_refused(self) -> None:
        self.assertEqual(self.allow("tests/test_app.py", "--cases", "1", "--reason", "  ")[0], 2)
        self.assertEqual(self.allow("../elsewhere.py", "--cases", "1", "--reason", "H-3")[0], 2)

    def test_non_test_path_gets_a_note(self) -> None:
        code, out, _ = self.allow("src/app.py", "--cases", "1", "--reason", "H-4")
        self.assertEqual(code, 0)
        self.assertIn("no effect", out)

    def test_legacy_object_entries_are_converted(self) -> None:
        marker = self.marker()
        marker["allow_test_deletions"] = [{"path": "tests/old.py", "reason": "H-0",
                                           "approved_at": "2026-01-01T00:00:00Z"}]
        (self.hdir() / "active").write_text(json.dumps(marker), encoding="utf-8")
        code, _, err = self.allow("tests/test_app.py", "--cases", "1", "--reason", "H-5")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["allow_test_deletions"], ["tests/old.py", "tests/test_app.py"])
        self.assertEqual([m["path"] for m in marker["allow_test_deletions_meta"]],
                         ["tests/old.py", "tests/test_app.py"])

    def test_glob_characters_are_escaped(self) -> None:
        self.assertEqual(self.rs("stop")[0], 0)
        _write(self.repo, "tests/test_[x].py", "def test_x():\n    pass\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "odd name")
        self.assertEqual(self.rs("start", "--mode", "apply")[0], 0)
        self.assertEqual(self.allow("tests/test_[x].py", "--cases", "1", "--reason", "H-6")[0], 0)
        self.assertEqual(self.marker()["allow_test_deletions"], ["tests/test_[\\[]x].py"])
        with warnings.catch_warnings():
            warnings.simplefilter("error")  # no "possible nested set" FutureWarning
            cfg = dg.load_run_config(self.repo)
        self.assertTrue(cfg.allow.first_match("tests/test_[x].py"))
        self.assertFalse(cfg.allow.first_match("tests/test_x.py"))
        self.assertEqual(rs.glob_escape("a/*?.py"), "a/[*][?].py")


class AllowConfigAndLineTests(RunStateCase):
    def setUp(self) -> None:
        super().setUp()
        _write(self.repo, "package.json", '{"name": "demo"}\n')
        _write(self.repo, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "manifest")
        self.assertEqual(self.start_apply()[0], 0)

    def test_allow_config_edit_records_and_unlocks(self) -> None:
        code, out, err = self.rs("allow-config-edit", "package.json", "pnpm-lock.yaml",
                                 "--reason", "H-010")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["allow_config_edits"], ["package.json", "pnpm-lock.yaml"])
        self.assertEqual([m["reason"] for m in marker["allow_config_edits_meta"]],
                         ["H-010", "H-010"])
        self.assertIn("Config edit allowed: package.json",
                      (self.hdir() / "progress.md").read_text(encoding="utf-8"))
        cfg = dg.load_run_config(self.repo)
        self.assertTrue(cfg.allow_config.first_match("pnpm-lock.yaml"))
        import hook_guard as hg
        import io as _io
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Edit", "cwd": str(self.repo),
                   "tool_input": {"file_path": str(self.repo / "package.json")}}
        self.assertEqual(hg.run(json.dumps(payload), {}, _io.StringIO(), _io.StringIO()), 0)
        payload["tool_input"] = {"file_path": str(self.repo / "tests" / "test_app.py")}
        self.assertEqual(hg.run(json.dumps(payload), {}, _io.StringIO(), _io.StringIO()), 2)

    def test_allow_config_edit_refusals_and_notes(self) -> None:
        self.assertEqual(self.rs("allow-config-edit", "tests/test_app.py", "--reason", "H-1")[0],
                         2)
        self.assertEqual(self.rs("allow-config-edit", "new.toml", "--reason", "H-1")[0], 2)
        self.assertEqual(self.rs("allow-config-edit", "src", "--reason", "H-1")[0], 2)
        self.assertEqual(self.rs("allow-config-edit", "package.json", "--reason", " ")[0], 2)
        code, out, _ = self.rs("allow-config-edit", "src/app.py", "--reason", "H-1")
        self.assertEqual(code, 0)
        self.assertIn("no effect", out)
        self.assertEqual(self.marker()["allow_config_edits"], ["src/app.py"])

    def test_allow_line_records_exact_text(self) -> None:
        line = "    return a + b  # type: ignore[operator]  "
        code, out, err = self.rs("allow-line", "src/app.py", "--text", line, "--reason", "H-020")
        self.assertEqual(code, 0, err)
        entry = self.marker()["allowed_lines"][0]
        self.assertEqual((entry["path"], entry["text"], entry["reason"]),
                         ("src/app.py", "return a + b  # type: ignore[operator]", "H-020"))
        self.assertIn("no line equal to the text yet", out)
        cfg = dg.load_run_config(self.repo)
        self.assertTrue(cfg.line_allowed("src/app.py", line))
        self.assertFalse(cfg.line_allowed("src/other.py", line))
        self.assertIn("Added line allowed in src/app.py",
                      (self.hdir() / "progress.md").read_text(encoding="utf-8"))

    def test_allow_line_accepts_a_new_test_file_but_not_a_missing_one(self) -> None:
        _write(self.repo, "tests/test_bug.py",
               "import pytest\n\n\n@pytest.mark.xfail(strict=True)\ndef test_bug():\n    assert 0\n")
        code, out, _ = self.rs("allow-line", "tests/test_bug.py", "--text",
                               "@pytest.mark.xfail(strict=True)", "--reason", "H-021")
        self.assertEqual(code, 0)
        self.assertNotIn("NOTE", out)
        self.assertEqual(self.rs("allow-line", "tests/missing.py", "--text", "# noqa",
                                 "--reason", "H-1")[0], 2)
        self.assertEqual(self.rs("allow-line", "src/app.py", "--text", "  ",
                                 "--reason", "H-1")[0], 2)
        code, out, _ = self.rs("allow-line", "src/app.py", "--text", "return a + b",
                               "--reason", "H-1")
        self.assertEqual(code, 0)
        self.assertIn("matches no marker, suppression or config-weakening pattern", out)


class PhaseTests(RunStateCase):
    """run_state.py phase (eval-v2-calibration E02-F08: per-phase timestamps)."""

    LINE_RE = r"^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z Phase "

    def progress(self) -> str:
        return (self.hdir() / "progress.md").read_text(encoding="utf-8")

    def records(self) -> List[Dict]:
        return json.loads((self.hdir() / "phases.json").read_text(encoding="utf-8"))["phases"]

    def backdate(self, index: int, seconds: int) -> None:
        """Move the ts of record `index` in .harden/phases.json `seconds` into the past."""
        path = self.hdir() / "phases.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        when = rs.parse_ts(data["phases"][index]["ts"]) - timedelta(seconds=seconds)
        data["phases"][index]["ts"] = when.strftime("%Y-%m-%dT%H:%M:%SZ")
        path.write_text(json.dumps(data), encoding="utf-8")

    def test_phase_zero_start_before_start_is_carried_into_progress(self) -> None:
        code, out, err = self.rs("phase", "0", "start")
        self.assertEqual(code, 0, err)
        self.assertIn(".harden/phases.json", out)
        # SKILL.md: progress.md is created by `run_state.py start`, never earlier.
        self.assertFalse((self.hdir() / "progress.md").exists())
        self.assertFalse((self.hdir() / "active").exists())
        self.assertEqual([(r["phase"], r["event"], r["run"]) for r in self.records()],
                         [(0, "start", None)])
        self.assertEqual(_git(self.repo, "status", "--porcelain"), "")  # .harden/ excluded
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        key = "{}|{}".format(marker["base_sha"], marker["started"])
        self.assertEqual([r["run"] for r in self.records()], [key])
        progress = self.progress()
        self.assertIn("## Checklist", progress)  # the template was written
        self.assertRegex(progress, r"(?m)" + self.LINE_RE + r"0 start: Preflight$")
        self.assertLess(progress.index("Phase 0 start: Preflight"), progress.index("run started"))
        self.assertIn(rs.PHASE_TIMING_LINE, progress)

    def test_other_phases_need_an_active_run(self) -> None:
        code, _, err = self.rs("phase", "2", "start")
        self.assertEqual(code, 2)
        self.assertIn("only `phase 0 start`", err)
        self.assertEqual(self.rs("phase", "0", "end")[0], 2)
        self.assertFalse((self.hdir() / "phases.json").exists())
        self.assertEqual(self.start_apply()[0], 0)
        self.assertEqual(self.rs("stop")[0], 0)
        self.assertEqual(self.rs("phase", "8", "end")[0], 2)

    def test_start_and_end_write_utc_lines_with_duration(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        code, out, err = self.rs("phase", "2", "start")
        self.assertEqual(code, 0, err)
        self.assertNotIn("NOTE", out)
        self.assertIn(".harden/progress.md", out)
        self.backdate(0, 125)
        code, out, err = self.rs("phase", "2", "end")
        self.assertEqual(code, 0, err)
        self.assertNotIn("NOTE", out)
        records = self.records()
        self.assertEqual([(r["phase"], r["name"], r["event"]) for r in records],
                         [(2, "Detect", "start"), (2, "Detect", "end")])
        self.assertGreaterEqual(records[1]["duration_s"], 125)
        self.assertLess(records[1]["duration_s"], 185)
        self.assertTrue(records[1]["ts"].endswith("Z"))
        progress = self.progress()
        self.assertRegex(progress, r"(?m)" + self.LINE_RE + r"2 start: Detect$")
        self.assertRegex(progress, r"(?m)" + self.LINE_RE
                         + r"2 end: Detect \(\d min \d\d s since its start\)$")

    def test_irregular_sequences_are_recorded_with_notes(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        code, out, _ = self.rs("phase", "3", "end")
        self.assertEqual(code, 0)
        self.assertIn("NOTE: no open start of phase 3", out)
        self.assertNotIn("duration_s", self.records()[0])
        self.assertEqual(self.rs("phase", "4", "start")[0], 0)
        self.backdate(1, 600)
        code, out, _ = self.rs("phase", "4", "start")  # e.g. after /harden --resume
        self.assertIn("already started", out)
        code, out, _ = self.rs("phase", "5", "start")
        self.assertIn("phase(s) 4 still open", out)
        self.assertEqual(self.rs("phase", "4", "end")[0], 0)
        ends = [r for r in self.records() if r["phase"] == 4 and r["event"] == "end"]
        self.assertGreaterEqual(ends[0]["duration_s"], 600)  # counted from the first start

    def test_invalid_number_or_event_is_a_usage_error(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        self.assertEqual(self.rs("phase", "9", "start")[0], 2)
        self.assertEqual(self.rs("phase", "-1", "start")[0], 2)
        self.assertEqual(self.rs("phase", "1", "begin")[0], 2)
        self.assertFalse((self.hdir() / "phases.json").exists())

    def test_new_phase_zero_drops_an_abandoned_one_and_keeps_old_runs(self) -> None:
        _write(self.repo, ".harden/phases.json", json.dumps({"phases": [
            {"phase": 8, "event": "end", "ts": "2026-01-01T00:00:00Z", "run": "old|run"},
            {"phase": 0, "event": "start", "ts": "2026-01-02T00:00:00Z", "run": None}]}))
        code, out, _ = self.rs("phase", "0", "start")
        self.assertEqual(code, 0)
        self.assertIn("dropped 1 record(s)", out)
        records = self.records()
        self.assertEqual([r["run"] for r in records], ["old|run", None])
        self.assertNotEqual(records[1]["ts"], "2026-01-02T00:00:00Z")

    def test_stop_ends_open_phases_and_status_lists_them(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        self.assertEqual(self.rs("phase", "5", "start")[0], 0)
        code, out, _ = self.rs("status", "--json")
        data = json.loads(out)
        self.assertEqual([(r["phase"], r["event"]) for r in data["phases"]], [(5, "start")])
        code, text, _ = self.rs("status")
        self.assertIn("Phase 5 start: Report", text)
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertIn("Phase still open, end recorded now: ", out)
        last = self.records()[-1]
        self.assertEqual((last["phase"], last["event"], last["closed_by"]),
                         (5, "end", "run_state.py stop"))
        progress = self.progress()
        self.assertIn("Phase 5 end: Report (", progress)
        self.assertIn("recorded by run_state.py stop)", progress)
        self.assertLess(progress.index("Phase 5 end"), progress.index("Run stopped"))

    def test_unreadable_phase_log_refuses_phase_but_not_start_or_stop(self) -> None:
        _write(self.repo, ".harden/phases.json", "not json\n")
        code, _, err = self.rs("phase", "0", "start")
        self.assertEqual(code, 2)
        self.assertIn("move .harden/phases.json aside", err)
        code, out, err = self.start_apply()
        self.assertEqual(code, 0, err)
        self.assertIn("Phase 0 start time is not carried over", out)
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertIn("open phases were not closed", out)

    def test_phase_labels_and_skill_instructions(self) -> None:
        self.assertEqual([rs.phase_label(n) for n in range(len(rs.PHASES))],
                         ["Preflight", "Freeze", "Detect", "Verify", "Prioritise", "Report",
                          "Approve", "Apply", "Final check"])
        self.assertEqual(rs.format_duration(59), "59 s")
        self.assertEqual(rs.format_duration(125), "2 min 05 s")
        self.assertEqual(rs.format_duration(3 * 3600 + 7 * 60 + 9), "3 h 07 min")
        skill = (SCRIPTS.parent / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("phase <n> start", skill)
        self.assertIn("phase <n> end", skill)


class ChecklistTickTests(RunStateCase):
    """`phase <n> end` ticks box n and a canary PASS ticks the canary box (the second pilot
    left every box unticked although phases.json recorded each end)."""

    def progress(self) -> str:
        return (self.hdir() / "progress.md").read_text(encoding="utf-8")

    def test_phase_end_ticks_only_its_box(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        self.assertEqual(self.rs("phase", "2", "start")[0], 0)
        self.assertNotIn("- [x] ", self.progress())  # a start ticks nothing
        code, out, err = self.rs("phase", "2", "end")
        self.assertEqual(code, 0, err)
        progress = self.progress()
        self.assertIn("- [x] " + rs.PHASES[2], progress)
        for number, phase in enumerate(rs.PHASES):
            if number != 2:
                self.assertIn("- [ ] " + phase, progress)
        code, out, _ = self.rs("phase", "2", "end")
        self.assertEqual(code, 0)
        self.assertIn("already ticked", out)
        self.assertEqual(self.progress().count("- [x] " + rs.PHASES[2]), 1)

    def test_tick_keeps_line_ends_and_other_bytes(self) -> None:
        self.hdir().mkdir(exist_ok=True)
        text = "# Run\r\n- [ ] " + rs.PHASES[0] + "\r\n- [ ] " + rs.PHASES[1] + "\r\nend"
        (self.hdir() / "progress.md").write_bytes(text.encode("utf-8"))
        self.assertTrue(rs.tick_checklist(self.hdir(), rs.PHASES[1]))
        data = (self.hdir() / "progress.md").read_bytes().decode("utf-8")
        self.assertEqual(data, text.replace("- [ ] " + rs.PHASES[1], "- [x] " + rs.PHASES[1]))
        self.assertFalse(rs.tick_checklist(self.hdir(), rs.PHASES[1]))
        self.assertFalse(rs.tick_checklist(self.hdir() / "none", rs.PHASES[0]))

    def test_canary_pass_ticks_the_canary_box(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        self.assertIn("- [ ] " + rs.CANARY_ITEM, self.progress())
        started = self.marker()["started"]
        transcript = self.hdir() / "transcript.jsonl"
        transcript.write_text("{}\n", encoding="utf-8")
        events = [{"ts": started, "event": "PreToolUse",
                   "tool": "Bash" if code == "canary-bash" else "Edit", "reason_code": code,
                   "path_or_cmd": "echo HARDEN_HOOK_CANARY", "session_id": "s-1",
                   "transcript_path": str(transcript)} for code in ("canary-bash", "canary-edit")]
        self.log_events(events)
        self.assertEqual(self.rs("canary-check")[0], 0)
        self.assertIn("- [x] " + rs.CANARY_ITEM, self.progress())


def _short_path(path: str) -> Optional[str]:
    """Windows 8.3 short spelling of an existing path, or None when it has none."""
    if os.name != "nt":
        return None
    import ctypes
    buf = ctypes.create_unicode_buffer(1024)
    size = ctypes.windll.kernel32.GetShortPathNameW(str(path), buf, len(buf))
    return buf.value if size and buf.value.lower() != str(path).lower() else None


class ScratchDirTests(RunStateCase):
    """D-S (eval-v2-calibration E02-F08): one scratch directory per run, outside the
    repository, recorded as scratch_dir; stop removes it only while it carries the owner
    marker file the run wrote."""

    def scratch(self) -> Path:
        return Path(self.marker()["scratch_dir"])

    def owner_path(self) -> Path:
        return self.scratch() / rs.SCRATCH_OWNER_NAME

    def scratch_dirs(self) -> List[str]:
        return sorted(n for n in os.listdir(tempfile.gettempdir())
                      if n.startswith(rs.SCRATCH_PREFIX))

    def progress(self) -> str:
        return (self.hdir() / "progress.md").read_text(encoding="utf-8")

    def write_marker(self, marker: Dict) -> None:
        # The hook refuses every agent write of .harden/active; tests write it directly.
        (self.hdir() / "active").write_text(json.dumps(marker), encoding="utf-8")

    def fill(self) -> None:
        """What a run puts there: a fresh clone (read-only git objects), a registered
        worktree and a comment-stripped copy with a read-only file."""
        scratch = self.scratch()
        _git(self.repo, "clone", "-q", "--no-local", ".", str(scratch / "harden-fresh"))
        _git(self.repo, "worktree", "add", "-q", "--detach", str(scratch / "harden-base"),
             "HEAD")
        _write(scratch, "stripped/src/app.py", "def add(a, b):\n    return a + b\n")
        locked = scratch / "stripped" / "locked.txt"
        locked.write_text("x\n", encoding="utf-8")
        os.chmod(locked, stat.S_IREAD)

    def test_start_creates_the_scratch_dir_outside_the_repository(self) -> None:
        code, out, err = self.start_apply()
        self.assertEqual(code, 0, err)
        marker = self.marker()
        scratch = marker["scratch_dir"]
        self.assertTrue(os.path.isdir(scratch))
        self.assertEqual(scratch, Path(scratch).resolve().as_posix())  # resolved, POSIX
        self.assertTrue(Path(scratch).name.startswith("harden-scratch-"))
        self.assertEqual(Path(scratch).parent.resolve(), Path(tempfile.gettempdir()).resolve())
        self.assertFalse(rs.is_within(scratch, str(self.repo)))
        self.assertEqual(list(self.repo.rglob("harden-scratch-*")), [])
        owner = json.loads(self.owner_path().read_text(encoding="utf-8"))
        self.assertEqual(owner, {
            "created_by": "run_state.py start",
            "run": "{}|{}".format(marker["base_sha"], marker["started"]),
            "base_sha": self.head, "started": marker["started"],
            "repo": self.repo.resolve().as_posix(), "scratch_dir": scratch})
        # The owner marker file, plus the tool environment's directories (eval-v3-calibration
        # E03-F06).
        self.assertEqual(sorted(os.listdir(scratch)),
                         sorted([rs.SCRATCH_OWNER_NAME, "cache", "t", "tmp"]))
        self.assertIn("scratch:   " + scratch, out)
        self.assertIn("- scratch_dir: " + scratch, self.progress())
        self.assertRegex(self.progress(), r"run started: .*scratch_dir " + re.escape(scratch))
        self.assertEqual(_git(self.repo, "status", "--porcelain"), "")

    def cargo_home(self, **files: str) -> Path:
        home = self.tmp / "cargo-home-src"
        home.mkdir(exist_ok=True)
        for name, text in files.items():
            (home / name.replace("__", ".")).write_text(text, encoding="utf-8")
        saved = os.environ.get("CARGO_HOME")
        os.environ["CARGO_HOME"] = str(home)

        def restore() -> None:
            if saved is None:
                os.environ.pop("CARGO_HOME", None)
            else:
                os.environ["CARGO_HOME"] = saved
        self.addCleanup(restore)
        return home

    def test_start_writes_tool_env_and_creates_dirs(self) -> None:
        self.cargo_home()
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.marker()["scratch_dir"]
        self.assertEqual(self.marker()["tool_env"], ".harden/tool-env.sh")
        raw = (self.hdir() / "tool-env.sh").read_bytes().decode("utf-8")
        self.assertNotIn("\r", raw)
        values = [line.split("=", 1)[1].split()[0].strip("'")
                  for line in raw.splitlines() if line.startswith("export ")
                  and "'" in line]
        self.assertTrue(values)
        for value in values:
            self.assertTrue(value.startswith(scratch + "/"), value)
        for sub in ("tmp", "t", "cache/pylint", "cache/ruff", "cache/mypy", "cache/semgrep",
                    "cache/uv", "cache/xdg", "cache/cargo-home"):
            self.assertTrue(os.path.isdir(os.path.join(scratch, sub)), sub)
        self.assertIn("- tool_env: .harden/tool-env.sh", self.progress())
        self.assertEqual(_git(self.repo, "status", "--porcelain"), "")

    def test_tool_env_text_quotes_single_quotes(self) -> None:
        text = rs.tool_env_text("/x/it's")
        self.assertIn("export TMPDIR='/x/it'\\''s/tmp'", text)
        self.assertIn("SEMGREP_ENABLE_VERSION_CHECK=0", text)

    def test_cargo_config_copied_but_not_credentials(self) -> None:
        self.cargo_home(config__toml="[build]\njobs = 2\n",
                        credentials__toml="[registry]\ntoken = \"secret\"\n")
        self.assertEqual(self.start_apply()[0], 0)
        home = Path(self.marker()["scratch_dir"]) / "cache" / "cargo-home"
        self.assertEqual(sorted(os.listdir(home)), ["config.toml"])

    def test_cargo_config_with_token_is_not_copied(self) -> None:
        self.cargo_home(config__toml="[registry]\ntoken = \"secret\"\n")
        self.assertEqual(self.start_apply()[0], 0)
        home = Path(self.marker()["scratch_dir"]) / "cache" / "cargo-home"
        self.assertEqual(os.listdir(home), [])
        self.assertIn("Cargo config not copied: it holds credentials", self.progress())
        self.assertNotIn("secret", self.progress())
        self.assertFalse(rs.cargo_config_copyable(
            "[http]\nproxy = \"http://user:pass@proxy.example:8080\"\n"))
        self.assertTrue(rs.cargo_config_copyable("[http]\nproxy = \"http://proxy.example\"\n"))

    def test_status_prints_tool_env(self) -> None:
        self.cargo_home()
        self.assertEqual(self.start_apply()[0], 0)
        code, text, _ = self.rs("status")
        self.assertEqual(code, 0)
        self.assertIn("Tool environment: .harden/tool-env.sh", text)

    def test_stop_removes_scratch_caches(self) -> None:
        self.cargo_home(config__toml="[build]\njobs = 2\n")
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.marker()["scratch_dir"]
        locked = Path(scratch) / "cache" / "cargo-home" / "config.toml"
        os.chmod(locked, stat.S_IREAD)
        (Path(scratch) / "cache" / "ruff" / "x.txt").write_text("x\n", encoding="utf-8")
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertFalse(os.path.exists(scratch))
        self.assertTrue((self.hdir() / "tool-env.sh").is_file())

    def test_status_prints_the_scratch_dir_and_its_owner_check(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.marker()["scratch_dir"]
        code, text, _ = self.rs("status")
        self.assertEqual(code, 0)
        self.assertIn("scratch_dir:", text)
        self.assertIn(scratch + " (owner marker matches", text)
        data = json.loads(self.rs("status", "--json")[1])
        self.assertEqual(data["scratch"], {"dir": scratch, "exists": True, "owned": True,
                                           "problem": None})
        self.owner_path().unlink()
        data = json.loads(self.rs("status", "--json")[1])
        self.assertFalse(data["scratch"]["owned"])
        self.assertIn("no owner marker file", data["scratch"]["problem"])
        self.assertTrue(any("will refuse to delete it" in w for w in data["warnings"]))

    def test_stop_removes_the_scratch_dir_with_its_clones_and_worktrees(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.marker()["scratch_dir"]
        self.fill()
        self.assertIn("harden-base", _git(self.repo, "worktree", "list", "--porcelain"))
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertFalse(os.path.exists(scratch))
        self.assertIn("Scratch directory removed: " + scratch, out)
        # The worktree went through git: no stale entry in .git/worktrees.
        self.assertNotIn("harden-base", _git(self.repo, "worktree", "list", "--porcelain"))
        self.assertFalse((self.repo / ".git" / "worktrees" / "harden-base").exists())
        self.assertFalse((self.hdir() / "active").exists())
        self.assertIn("scratch_dir removed: " + scratch, self.progress())
        self.assertEqual(_git(self.repo, "status", "--porcelain"), "")

    def test_stop_refuses_without_the_owner_marker_file_until_keep_scratch(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.scratch()
        _write(scratch, "keep.txt", "data\n")
        self.owner_path().unlink()
        code, _, err = self.rs("stop")
        self.assertEqual(code, 2)
        for text in ("refusing to stop", "no owner marker file", "Nothing was changed",
                     "--keep-scratch", scratch.as_posix()):
            self.assertIn(text, err)
        self.assertTrue((self.hdir() / "active").exists())
        self.assertTrue((scratch / "keep.txt").exists())
        self.assertNotIn("Run stopped", self.progress())
        code, out, err = self.rs("stop", "--keep-scratch")
        self.assertEqual(code, 0, err)
        self.assertFalse((self.hdir() / "active").exists())
        self.assertTrue((scratch / "keep.txt").exists())
        self.assertIn("Scratch directory kept (--keep-scratch): " + scratch.as_posix(), out)
        self.assertIn("scratch_dir kept (--keep-scratch)", self.progress())

    def test_stop_refuses_an_owner_marker_file_of_another_run(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        path = self.owner_path()
        original = json.loads(path.read_text(encoding="utf-8"))
        for key, value, text in (("run", "0" * 40 + "|2026-01-01T00:00:00Z", "another run"),
                                 ("base_sha", "0" * 40, "another run"),
                                 ("repo", (self.tmp / "other").as_posix(), "another repo"),
                                 ("scratch_dir", (self.tmp / "x").as_posix(),
                                  "another scratch_dir")):
            with self.subTest(key=key):
                path.write_text(json.dumps(dict(original, **{key: value})), encoding="utf-8")
                code, _, err = self.rs("stop")
                self.assertEqual(code, 2)
                self.assertIn(text, err)
                self.assertTrue((self.hdir() / "active").exists())
                self.assertTrue(path.exists())
        path.write_text("not json\n", encoding="utf-8")
        code, _, err = self.rs("stop")
        self.assertEqual(code, 2)
        self.assertIn("cannot be read", err)
        path.write_text(json.dumps(original), encoding="utf-8")
        self.assertEqual(self.rs("stop")[0], 0)
        self.assertFalse(self.scratch_dirs())

    def test_stop_never_deletes_a_directory_the_marker_was_pointed_at(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        owner = self.owner_path().read_text(encoding="utf-8")
        unrelated = self.tmp / "unrelated"
        fake = self.tmp / "harden-scratch-fake"
        for directory in (unrelated, fake):
            _write(directory, "precious.txt", "keep\n")
            (directory / rs.SCRATCH_OWNER_NAME).write_text(owner, encoding="utf-8")
        for target, text in ((unrelated, "does not start with harden-scratch-"),
                             (fake, "another scratch_dir"),
                             (self.repo, "does not start with harden-scratch-"),
                             (self.tmp, "does not start with harden-scratch-")):
            with self.subTest(target=str(target)):
                self.write_marker(dict(marker, scratch_dir=target.as_posix()))
                code, _, err = self.rs("stop")
                self.assertEqual(code, 2)
                self.assertIn(text, err)
                self.assertTrue((self.hdir() / "active").exists())
        self.assertTrue((unrelated / "precious.txt").exists())
        self.assertTrue((fake / "precious.txt").exists())
        self.assertTrue((self.repo / "src" / "app.py").exists())
        # A scratch directory placed inside the repository is never deleted either.
        inside = self.hdir() / "harden-scratch-inside"
        inside.mkdir()
        (inside / rs.SCRATCH_OWNER_NAME).write_text(json.dumps(dict(
            json.loads(owner), scratch_dir=inside.resolve().as_posix())), encoding="utf-8")
        self.write_marker(dict(marker, scratch_dir=inside.as_posix()))
        code, _, err = self.rs("stop")
        self.assertEqual(code, 2)
        self.assertIn("inside the repository", err)
        self.assertTrue(inside.exists())

    def test_stop_when_the_scratch_dir_is_already_gone(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.marker()["scratch_dir"]
        _rmtree(scratch)
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertIn("no longer exists", out)
        self.assertIn("scratch_dir already gone", self.progress())

    def test_a_failed_removal_keeps_the_owner_marker_file_for_a_retry(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.scratch()
        self.fill()
        real = rs.remove_entry

        def in_use(path: str) -> None:
            if os.path.basename(path) == "stripped":
                raise PermissionError(13, "in use by another process", path)
            real(path)
        with mock.patch.object(rs, "remove_entry", side_effect=in_use):
            code, _, err = self.rs("stop")
        self.assertEqual(code, 2)
        self.assertIn("could not be fully removed", err)
        self.assertIn("stripped", err)
        self.assertIn("in use by another process", err)
        self.assertTrue(self.owner_path().exists())
        self.assertTrue((self.hdir() / "active").exists())
        self.assertNotIn("Run stopped", self.progress())
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertFalse(scratch.exists())

    def test_refused_starts_leave_no_scratch_dir(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        _write(self.repo, "notes.txt", "draft\n")
        self.assertEqual(self.rs("start", "--mode", "apply")[0], 2)  # dirty tree
        self.assertEqual(self.scratch_dirs(), [])
        os.remove(self.repo / "notes.txt")
        self.assertEqual(self.rs("start", "--mode", "apply")[0], 0)
        self.assertEqual(len(self.scratch_dirs()), 1)
        self.assertEqual(self.rs("start", "--mode", "apply")[0], 2)  # already active
        self.assertEqual(len(self.scratch_dirs()), 1)

    def test_a_temp_directory_inside_the_repository_is_refused(self) -> None:
        inside = self.hdir() / "tmp"
        inside.mkdir(parents=True)
        tempfile.tempdir = str(inside)  # private_tempdir's cleanup restores it
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        code, _, err = self.rs("start", "--mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("lies inside the repository", err)
        self.assertIn("TMPDIR", err)
        self.assertEqual(os.listdir(inside), [])
        self.assertFalse((self.hdir() / "active").exists())
        self.assertFalse((self.hdir() / "canary.txt").exists())

    def test_a_marker_without_scratch_dir_stops_as_before(self) -> None:
        # A run started before scratch_dir existed kept its copies in .harden/scratch/.
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        own = marker.pop("scratch_dir")
        self.write_marker(marker)
        (self.hdir() / "scratch" / "harden-fresh").mkdir(parents=True)
        data = json.loads(self.rs("status", "--json")[1])
        self.assertIsNone(data["scratch"]["dir"])
        self.assertEqual(data["legacy_scratch"], ".harden/scratch")
        self.assertTrue(any("inside the repository" in w for w in data["warnings"]))
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertIn(".harden/scratch", out)
        self.assertIn("PF-21", out)
        self.assertTrue(os.path.isdir(own))  # not named in the marker: left alone

    def legacy_warning(self) -> str:
        data = json.loads(self.rs("status", "--json")[1])
        found = [w for w in data["warnings"] if ".harden/scratch/" in w]
        self.assertEqual(len(found), 1, data["warnings"])
        return found[0]

    def test_the_legacy_scratch_warning_follows_the_run_mode(self) -> None:
        (self.hdir() / "scratch" / "harden-fresh").mkdir(parents=True)
        # --interactive asks the user.
        self.assertEqual(self.start_apply()[0], 0)
        self.assertIn("ask the user to delete that directory", self.legacy_warning())
        self.assertEqual(self.rs("stop")[0], 0)
        # Autonomous mode, here fallen back to report-only (no profile), asks nobody.
        self.assertEqual(self.rs("start")[0], 0)
        self.assertEqual(self.marker()["mode_requested"], "auto")
        warning = self.legacy_warning()
        self.assertNotIn("ask the user", warning)
        self.assertIn("write it into .harden/progress.md and the report's Limits for the owner "
                      "to delete that directory", warning)
        self.assertIn("autonomous mode asks nobody", warning)
        self.assertEqual(self.rs("stop")[0], 0)
        # --report-only asks nobody either; without a run the mode is unknown.
        self.assertEqual(self.rs("start", "--mode", "report-only")[0], 0)
        self.assertIn("tell the owner in the report to delete", self.legacy_warning())
        self.assertEqual(self.rs("stop")[0], 0)
        self.assertIn("in an --interactive run ask the user to delete that directory; "
                      "otherwise write it", self.legacy_warning())

    def test_the_hook_takes_scratch_clones_of_the_started_run_as_install_locations(
            self) -> None:
        import hook_guard as hg
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.scratch()
        clone = scratch / "harden-fresh"
        _git(self.repo, "clone", "-q", "--no-local", ".", str(clone))
        sibling = self.tmp / "sibling-clone"
        _git(self.repo, "clone", "-q", "--no-local", ".", str(sibling))

        def hook(cwd: Path, command: str) -> int:
            payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(cwd),
                       "session_id": "s1", "tool_input": {"command": command}}
            return hg.run(json.dumps(payload), {"CLAUDE_PROJECT_DIR": str(self.repo)},
                          io.StringIO(), io.StringIO())
        self.assertEqual(hook(clone, "pip install -r requirements.txt"), 0)
        self.assertEqual(hook(self.repo, 'cd "{}" && pip install ruff'.format(clone)), 0)
        self.assertEqual(hook(self.repo, 'cd "{}" && pip install ruff'.format(scratch)), 2)
        self.assertEqual(hook(sibling, "pip install ruff"), 2)

    @unittest.skipUnless(os.name == "nt", "Windows path spellings")
    def test_windows_spellings_and_deep_paths(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        scratch = marker["scratch_dir"]
        self.assertRegex(scratch, r"^[A-Z]:/[^\\]*$")  # drive letter, forward slashes
        native = scratch.replace("/", "\\")
        spellings = [native, native.lower() + "\\", _short_path(native)]
        for value in [s for s in spellings if s]:
            with self.subTest(scratch_dir=value):
                self.write_marker(dict(marker, scratch_dir=value))
                data = json.loads(self.rs("status", "--json")[1])
                self.assertTrue(data["scratch"]["owned"], data["scratch"])
        # A node_modules tree deeper than the 260-character limit.
        deep = rs.extended_path(scratch) + "".join(
            "\\node_modules\\package-{:02d}".format(i) for i in range(12))
        os.makedirs(deep)
        with open(deep + "\\index.js", "w", encoding="utf-8") as handle:
            handle.write("module.exports = 1;\n")
        self.assertGreater(len(deep), 300)
        self.write_marker(dict(marker, scratch_dir=_short_path(native) or native))
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertFalse(os.path.exists(scratch))


class StatusStopModeTests(RunStateCase):
    def test_status_without_run(self) -> None:
        code, out, _ = self.rs("status", "--json")
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(out)["active"])

    def test_status_reports_session_canary_and_errors(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        session = {"run": "{}|{}".format(marker["base_sha"], marker["started"]),
                   "permission_mode": "bypassPermissions", "modes_seen": ["bypassPermissions"]}
        (self.hdir() / "session.json").write_text(json.dumps(session), encoding="utf-8")
        (self.hdir() / "hook_errors.log").write_text(
            "".join("line {}\n".format(i) for i in range(15)), encoding="utf-8")
        code, out, _ = self.rs("status", "--json")
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertTrue(data["active"])
        self.assertEqual(data["marker"]["mode"], "interactive")
        self.assertEqual(data["session"]["permission_mode"], "bypassPermissions")
        self.assertTrue(data["session"]["recorded_for_this_run"])
        self.assertFalse(data["canary"]["passed"])
        self.assertEqual(len(data["hook_errors_tail"]), 10)
        self.assertEqual(data["hook_errors_tail"][-1], "line 14")
        self.assertTrue(any("bypassPermissions" in w for w in data["warnings"]))
        code, text, _ = self.rs("status")
        self.assertEqual(code, 0)
        self.assertIn("permission_mode:", text)

    def test_stop_refuses_dirty_tree_then_force(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        _write(self.repo, "src/app.py", "changed\n")
        code, _, err = self.rs("stop")
        self.assertEqual(code, 2)
        self.assertIn("src/app.py", err)
        self.assertTrue((self.hdir() / "active").exists())
        code, out, _ = self.rs("stop", "--force")
        self.assertEqual(code, 0)
        self.assertFalse((self.hdir() / "active").exists())
        self.assertIn("WARNING", out)

    def test_stop_removes_marker_and_canary_only(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        _write(self.repo, ".harden/report.md", "# report\n")
        code, out, _ = self.rs("stop")
        self.assertEqual(code, 0)
        self.assertFalse((self.hdir() / "active").exists())
        self.assertFalse((self.hdir() / "canary.txt").exists())
        self.assertTrue((self.hdir() / "progress.md").exists())
        self.assertTrue((self.hdir() / "report.md").exists())
        self.assertIn("report.md", out)
        self.assertIn("Run stopped", (self.hdir() / "progress.md").read_text(encoding="utf-8"))
        session = json.loads((self.hdir() / "session.json").read_text(encoding="utf-8"))
        self.assertEqual(session["stopped"]["by"], "run_state.py stop")
        self.assertFalse(session["stopped"]["forced"])
        self.assertEqual(self.rs("stop")[0], 0)

    def test_stop_warns_about_untracked_files_and_leaves_them(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        _write(self.repo, "src/__pycache__/app.cpython-313.pyc", "bytecode\n")
        code, out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertFalse((self.hdir() / "active").exists())
        self.assertIn("untracked file(s) left in place", out)
        self.assertIn("src/__pycache__/app.cpython-313.pyc", out)
        self.assertTrue((self.repo / "src" / "__pycache__" / "app.cpython-313.pyc").exists())

    def test_status_lists_run_control_events(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        started = self.marker()["started"]
        self.log_events([{"ts": started, "event": "PreToolUse", "tool": "Bash",
                          "type": "run-control", "decision": "allow",
                          "actions": ["run_state.py stop --force"],
                          "path_or_cmd": "python run_state.py stop --force"},
                         {"ts": "2020-01-01T00:00:00Z", "type": "run-control",
                          "actions": ["remove-marker (rm)"], "path_or_cmd": "old run"}])
        code, out, _ = self.rs("status", "--json")
        data = json.loads(out)
        self.assertEqual([e["actions"] for e in data["run_control_events"]],
                         [["run_state.py stop --force"]])
        self.assertTrue(any("run-control" in w for w in data["warnings"]))
        code, text, _ = self.rs("status")
        self.assertIn("Run-control events", text)
        self.assertIn("run_state.py stop --force", text)

    def test_set_mode_downgrades_and_updates_config(self) -> None:
        _write(self.repo, ".harden/config.json", json.dumps({"mode": "apply", "gates": []}))
        self.assertEqual(self.start_apply()[0], 0)
        code, _, err = self.rs("set-mode", "report-only", "--reason", "red baseline")
        self.assertEqual(code, 0, err)
        marker = self.marker()
        self.assertEqual(marker["mode"], "report-only")
        self.assertEqual(marker["mode_changed"]["from"], "interactive")
        config = json.loads((self.hdir() / "config.json").read_text(encoding="utf-8"))
        self.assertEqual(config, {"mode": "report-only", "gates": []})
        code, _, err = self.rs("set-mode", "apply")
        self.assertEqual(code, 2)
        self.assertIn("only downgrades", err)


class CliTests(RunStateCase):
    def cli(self, *args: str) -> "subprocess.CompletedProcess[bytes]":
        # The child's OS temp directory is this test's, so its scratch directory is too.
        env = dict(os.environ, TMPDIR=str(self.tmp), TEMP=str(self.tmp), TMP=str(self.tmp))
        return subprocess.run([sys.executable, "-S", str(SCRIPT), *args],
                              cwd=str(self.repo), stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, env=env, check=False)

    def test_runs_without_site_packages(self) -> None:
        _git(self.repo, "switch", "-q", "-c", "harden/test")
        proc = self.cli("start", "--mode", "apply")
        self.assertEqual(proc.returncode, 0, proc.stderr.decode(errors="replace"))
        scratch = self.marker()["scratch_dir"]
        self.assertEqual(Path(scratch).parent.resolve(), self.tmp.resolve())
        proc = self.cli("status", "--json")
        self.assertEqual(proc.returncode, 0)
        data = json.loads(proc.stdout.decode("utf-8"))
        self.assertTrue(data["active"])
        self.assertTrue(data["scratch"]["owned"])
        proc = self.cli("stop")
        self.assertEqual(proc.returncode, 0, proc.stderr.decode(errors="replace"))
        self.assertFalse(os.path.exists(scratch))

    def test_help(self) -> None:
        proc = self.cli("--help")
        self.assertEqual(proc.returncode, 0)
        self.assertIn(b"canary-check", proc.stdout)
        self.assertIn(b"phase", proc.stdout)
        self.assertIn(b"profile-template", proc.stdout)
        proc = self.cli("start", "--help")
        self.assertEqual(proc.returncode, 0)
        self.assertIn(b"--profile", proc.stdout)
        self.assertIn(b"interactive", proc.stdout)
        proc = self.cli("stop", "--help")
        self.assertEqual(proc.returncode, 0)
        self.assertIn(b"--keep-scratch", proc.stdout)


class AgentsAndSessionEnvTests(RunStateCase):
    """start records, never installs, the harden agents and the session environment; a
    subagent's canary denial never proves the main thread's hook (pilot-auto-calibration
    A01-F41, A01-F45, A01-F46; round 3)."""

    KEYS = ("CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_CODE_SUBAGENT_MODEL",
            "CLAUDE_CODE_SUBAGENT_MODEL_FORCE", "CLAUDE_CODE_DISABLE_1M_CONTEXT",
            "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS", "CLAUDE_CONFIG_DIR")

    def setUp(self) -> None:
        super().setUp()
        self.saved = {k: os.environ.get(k) for k in self.KEYS}
        for key in self.KEYS:
            os.environ.pop(key, None)
        self.config = Path(tempfile.mkdtemp(prefix="harden-rs-config-"))
        (self.config / "agents").mkdir()
        (self.config / "settings.json").write_text(json.dumps({"theme": "dark"}),
                                                   encoding="utf-8")
        os.environ["CLAUDE_CONFIG_DIR"] = str(self.config)

    def tearDown(self) -> None:
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        _rmtree(str(self.config))
        super().tearDown()

    def progress_text(self) -> str:
        return (self.hdir() / "progress.md").read_text(encoding="utf-8")

    def test_start_records_agents_and_session_env(self) -> None:
        os.environ["CLAUDE_CODE_AUTO_COMPACT_WINDOW"] = "300000"
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        self.assertEqual(marker["agents_status"]["states"],
                         {"harden-lens": "missing", "harden-verifier": "missing"})
        self.assertEqual(marker["session_env"]["CLAUDE_CODE_AUTO_COMPACT_WINDOW"], "300000")
        self.assertIsNone(marker["session_env"]["autoCompactWindow"])
        text = self.progress_text()
        self.assertIn("- Agents: harden-lens missing, harden-verifier missing", text)
        self.assertIn("Installed agent files: missing. The Phase 0 agent probe decides", text)
        self.assertIn("Auto-compact window: 300000", text)
        self.assertFalse(any((self.config / "agents").iterdir()))
        code, out, _err = self.rs("status")
        self.assertIn("Agents: harden-lens missing", out)

    def test_unset_window_and_forced_subagent_model(self) -> None:
        os.environ["CLAUDE_CODE_SUBAGENT_MODEL_FORCE"] = "1"
        self.assertEqual(self.start_apply()[0], 0)
        text = self.progress_text()
        self.assertIn("Auto-compact window: not set", text)
        self.assertIn("WARNING: CLAUDE_CODE_SUBAGENT_MODEL_FORCE is set", text)

    def test_installed_agents_are_current(self) -> None:
        import harden_agents
        for name in harden_agents.AGENTS:
            (self.config / "agents" / (name + ".md")).write_bytes(
                harden_agents.rendered(name).encode("utf-8"))
        self.assertEqual(self.start_apply()[0], 0)
        text = self.progress_text()
        self.assertIn("- Agents: harden-lens current, harden-verifier current", text)
        self.assertNotIn("Installed agent files:", text)

    def test_a_failing_agents_import_is_logged_not_fatal(self) -> None:
        import run_state as RS
        original = RS.agents_status
        RS.agents_status = lambda: (None, "ImportError: no harden_agents")
        try:
            code, out, err = self.start_apply()
        finally:
            RS.agents_status = original
        self.assertEqual(code, 0, out + err)
        self.assertIn("- Agents: not checked (ImportError: no harden_agents)",
                      self.progress_text())

    def test_subagent_canary_denial_does_not_pass_canary_check(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        started = self.marker()["started"]
        transcript = self.hdir() / "transcript.jsonl"
        transcript.write_text("{}\n", encoding="utf-8")
        base = {"ts": started, "event": "PreToolUse", "path_or_cmd": "x", "session_id": "s-1",
                "transcript_path": str(transcript)}
        self.log_events([dict(base, tool="Bash", reason_code="canary-bash", agent_id="v1",
                              agent_type="harden-verifier"),
                         dict(base, tool="Edit", reason_code="canary-edit")])
        code, out, _err = self.rs("canary-check")
        self.assertEqual(code, 1, out)
        self.log_events([dict(base, tool="Bash", reason_code="canary-bash")])
        self.assertEqual(self.rs("canary-check")[0], 0)


class TickNeverFailsTests(RunStateCase):
    """Safety review, round 3: a progress.md that stays locked (an editor or a virus scanner
    on Windows) must not turn a passing canary-check into a failure, which sends the run to
    report-only."""

    def test_a_locked_progress_file_returns_false(self) -> None:
        self.hdir().mkdir(exist_ok=True)
        text = "- [ ] " + rs.PHASES[0] + "\n"
        (self.hdir() / "progress.md").write_bytes(text.encode("utf-8"))
        with mock.patch.object(rs.os, "replace", side_effect=PermissionError("locked")), \
                mock.patch.object(rs.time, "sleep"):
            self.assertFalse(rs.tick_checklist(self.hdir(), rs.PHASES[0]))
        self.assertEqual((self.hdir() / "progress.md").read_bytes(), text.encode("utf-8"))
        self.assertEqual([p.name for p in self.hdir().glob(".tmp-*")], [])

    def test_canary_check_passes_although_the_tick_cannot_be_written(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        started = self.marker()["started"]
        transcript = self.hdir() / "transcript.jsonl"
        transcript.write_text("{}\n", encoding="utf-8")
        base = {"ts": started, "event": "PreToolUse", "path_or_cmd": "x", "session_id": "s-1",
                "transcript_path": str(transcript)}
        self.log_events([dict(base, tool="Bash", reason_code="canary-bash"),
                         dict(base, tool="Edit", reason_code="canary-edit")])
        with mock.patch.object(rs.os, "replace", side_effect=PermissionError("locked")), \
                mock.patch.object(rs.time, "sleep"):
            code, out, err = self.rs("canary-check")
        self.assertEqual(code, 0, out + err)
        self.assertIn("canary-check: PASS", out)


def make_link(test: unittest.TestCase, link: Path, target: Path) -> None:
    """A directory junction on Windows (a symbolic link elsewhere) from `link` to `target`."""
    if os.name == "nt":
        try:
            import _winapi
            _winapi.CreateJunction(str(target), str(link))
            return
        except (ImportError, OSError, AttributeError):
            proc = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)],
                                  stdin=subprocess.DEVNULL, capture_output=True, check=False)
            if proc.returncode != 0 or not os.path.lexists(str(link)):
                test.skipTest("cannot create a directory junction here")
            return
    try:
        os.symlink(str(target), str(link), target_is_directory=True)
    except OSError:
        test.skipTest("cannot create a symbolic link here")


class ScratchRemoveTests(RunStateCase):
    """pilot-auto-calibration A01-F56: scratch entries are removed without following a link,
    and git drops a worktree's entry only after its directory is gone."""

    scratch = ScratchDirTests.scratch
    fill = ScratchDirTests.fill

    def setUp(self) -> None:
        super().setUp()
        self.outside = Path(tempfile.mkdtemp(prefix="harden-outside-"))
        self.addCleanup(_rmtree, str(self.outside))
        (self.outside / "precious.txt").write_text("keep me\n", encoding="utf-8")

    def linked_worktree(self) -> Path:
        self.assertEqual(self.start_apply()[0], 0)
        self.fill()
        base = self.scratch() / "harden-base"
        make_link(self, base / "node_modules", self.outside)
        return base

    def test_stop_never_follows_a_link_inside_a_scratch_worktree(self) -> None:
        self.linked_worktree()
        scratch = self.scratch()
        code, _out, err = self.rs("stop")
        self.assertEqual(code, 0, err)
        self.assertTrue((self.outside / "precious.txt").exists())
        self.assertFalse(os.path.exists(str(scratch)))
        self.assertNotIn("harden-base", _git(self.repo, "worktree", "list", "--porcelain"))
        self.assertFalse((self.repo / ".git" / "worktrees" / "harden-base").exists())

    def test_scratch_remove_removes_one_worktree_without_following_links(self) -> None:
        base = self.linked_worktree()
        code, out, err = self.rs("scratch-remove", str(base))
        self.assertEqual(code, 0, out + err)
        self.assertIn("removed", out)
        self.assertIn("worktree entry dropped", out)
        self.assertTrue((self.outside / "precious.txt").exists())
        self.assertFalse(os.path.lexists(str(base)))
        self.assertNotIn("harden-base", _git(self.repo, "worktree", "list", "--porcelain"))
        self.assertTrue((self.scratch() / "harden-fresh").is_dir())
        progress = (self.hdir() / "progress.md").read_text(encoding="utf-8")
        self.assertIn("scratch entry removed: ", progress)

    def test_scratch_remove_removes_a_link_itself(self) -> None:
        base = self.linked_worktree()
        code, out, err = self.rs("scratch-remove", str(base / "node_modules"))
        self.assertEqual(code, 0, out + err)
        self.assertFalse(os.path.lexists(str(base / "node_modules")))
        self.assertTrue((self.outside / "precious.txt").exists())
        self.assertTrue(base.is_dir())

    def test_scratch_remove_accepts_a_trailing_slash(self) -> None:
        base = self.linked_worktree()
        code, out, err = self.rs("scratch-remove", str(base / "node_modules") + "/")
        self.assertEqual(code, 0, out + err)
        self.assertFalse(os.path.lexists(str(base / "node_modules")))
        self.assertTrue((self.outside / "precious.txt").exists())
        self.assertTrue(base.is_dir())

    def test_scratch_remove_of_a_link_to_a_worktree_removes_only_the_link(self) -> None:
        base = self.linked_worktree()
        lnk = self.scratch() / "lnk"
        make_link(self, lnk, base)
        code, out, err = self.rs("scratch-remove", str(lnk))
        self.assertEqual(code, 0, out + err)
        self.assertFalse(os.path.lexists(str(lnk)))
        self.assertTrue(base.is_dir())
        self.assertTrue((base / ".git").exists())
        self.assertTrue((self.outside / "precious.txt").exists())
        self.assertIn("harden-base", _git(self.repo, "worktree", "list", "--porcelain"))

    def test_scratch_remove_through_a_link_is_refused(self) -> None:
        base = self.linked_worktree()
        code, _out, err = self.rs("scratch-remove",
                                  str(base / "node_modules" / "precious.txt"))
        self.assertEqual(code, 2, err)
        self.assertTrue((self.outside / "precious.txt").exists())

    def test_scratch_remove_refusals(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.scratch()
        for target in (self.repo / "src", scratch, scratch / rs.SCRATCH_OWNER_NAME):
            with self.subTest(target=str(target)):
                code, _out, err = self.rs("scratch-remove", str(target))
                self.assertEqual(code, 2, err)
                self.assertIn("nothing was removed", err)
                self.assertTrue(os.path.exists(str(target)))
        code, out, _err = self.rs("scratch-remove", str(scratch / "missing"))
        self.assertEqual(code, 1)
        self.assertIn("not found", out)
        self.assertEqual(self.rs("stop")[0], 0)
        code, _out, err = self.rs("scratch-remove", str(scratch / "x"))
        self.assertEqual(code, 2)
        self.assertIn("no active /harden run", err)

    @unittest.skipUnless(os.name == "nt", "MSYS and backslash spellings are Windows forms")
    def test_scratch_remove_accepts_msys_and_backslash_forms(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        scratch = self.scratch()
        _write(scratch, "copy-a/x.txt", "a\n")
        _write(scratch, "copy-b/x.txt", "b\n")
        real = Path(os.path.realpath(str(scratch)))
        drive, rest = real.as_posix().split(":", 1)
        msys = "/{}{}/copy-a".format(drive.lower(), rest)
        backslash = str(real / "copy-b").replace("/", "\\")
        code, out, err = self.rs("scratch-remove", msys, backslash)
        self.assertEqual(code, 0, out + err)
        self.assertFalse((scratch / "copy-a").exists())
        self.assertFalse((scratch / "copy-b").exists())

    def test_stop_keeps_git_entry_when_the_directory_survives(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        self.fill()
        scratch = str(self.scratch())
        calls: List[List[str]] = []
        real_git = rs.git_proc

        def recording(repo: Path, args: List[str]):  # type: ignore[no-untyped-def]
            calls.append(list(args))
            return real_git(repo, args)

        with mock.patch.object(rs, "remove_entry", lambda _path: None), \
                mock.patch.object(rs, "git_proc", recording):
            _notes, errors = rs.remove_scratch_dir(self.repo, scratch)
        self.assertTrue(any("harden-base" in e for e in errors), errors)
        self.assertFalse(any("remove" in c for c in calls), calls)


class StopSnapshotTests(RunStateCase):
    """pilot-auto-calibration A01-F59: run_state.py stop keeps the run facts final_message.py
    reads after the marker is gone."""

    def test_stop_snapshots_the_marker_for_final_message(self) -> None:
        self.assertEqual(self.start_apply()[0], 0)
        marker = self.marker()
        self.assertEqual(self.rs("stop")[0], 0)
        session = json.loads((self.hdir() / "session.json").read_text(encoding="utf-8"))
        snapshot = session["stopped"]["marker"]
        for key in ("base_sha", "branch", "mode"):
            self.assertEqual(snapshot[key], marker[key])
        self.assertNotIn("forbidden_commands", snapshot)


if __name__ == "__main__":
    unittest.main()
