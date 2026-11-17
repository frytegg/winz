"""Tests for scripts/validate_profile.py (unittest).

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import validate_profile as vp  # noqa: E402

SCRIPT = SCRIPTS / "validate_profile.py"
ASSETS = SCRIPTS.parent / "assets"
NOW = datetime(2026, 9, 25, tzinfo=timezone.utc)
TRACKED_REASON = ("profile is tracked by the repository; the owner's profile must be "
                  "untracked")
_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None


def setUpModule() -> None:
    """Isolate git from the user's global and system configuration."""
    global _GIT_HOME
    _GIT_HOME = tempfile.mkdtemp(prefix="harden-vp-gitcfg-")
    cfg = Path(_GIT_HOME) / "gitconfig"
    cfg.write_text("[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                   "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                   "[core]\n\tautocrlf = false\n", encoding="utf-8")
    for key, value in {"GIT_CONFIG_GLOBAL": str(cfg), "GIT_CONFIG_NOSYSTEM": "1"}.items():
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
        raise RuntimeError("git {} failed: {}".format(args, proc.stderr.decode(
            errors="replace")))
    return proc.stdout.decode("utf-8", errors="replace")


def good(**overrides: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "version": 1, "mode": "auto",
        "gates": [{"name": "test", "cmd": ["pytest", "-q"], "cwd": ".", "timeout_s": 600,
                   "count_regex": "(\\d+) passed"}],
        "e2e": [{"name": "smoke", "cmd": "python -m app --help", "timeout_s": 60,
                 "compare": True}],
        "network": "registry-only", "live_side_effects": "none",
        "forbidden_commands": ["/\\bgit\\s+push\\b/", "npm run deploy"],
        "situation": "release preparation", "future_work": ["src/api/"],
        "auto_apply": {"structural": True, "behavioural": True, "dependencies": True,
                       "money_paths": False, "owner_judgement": False,
                       "dependency_versions": False},
        "money_paths_globs": ["src/billing/**"],
        "sandbox_ack": True, "budget": {"max_tokens": None, "deadline_utc": None}}
    data.update(overrides)
    return data


def check(data: Any, windows: bool = False) -> vp.ProfileCheck:
    return vp.check_document(data, windows=windows, now=NOW)


class ValidProfileTests(unittest.TestCase):
    def test_a_complete_profile_is_valid_without_blockers(self) -> None:
        result = check(good(), windows=True)
        self.assertEqual(result.errors, [])
        self.assertEqual(result.blockers, [])
        self.assertTrue(result.autonomous_apply)
        summary = result.summary()
        self.assertEqual(summary["gates"], ["test"])
        self.assertEqual(summary["e2e_compare"], ["smoke"])
        self.assertEqual(summary["forbidden_commands"], 2)
        self.assertEqual(result.defaults, [])

    def test_the_example_profiles_are_valid(self) -> None:
        examples = json.loads((ASSETS / "profile.example.json").read_text(encoding="utf-8"))
        self.assertEqual(len(examples["examples"]), 2)
        for index, example in enumerate(examples["examples"]):
            with self.subTest(example=index):
                result = check(example, windows=True)
                self.assertEqual(result.errors, [])
                self.assertEqual(result.blockers, [])
                # Each opt-in looser than the conservative default carries its reason.
                notes = " ".join(example["comment"])
                for key, value in example["auto_apply"].items():
                    if value:
                        self.assertIn("auto_apply.{} true".format(key), notes)
                for key in ("live_side_effects", "network", "sandbox_ack"):
                    if example[key] != vp.DEFAULTS[key]:
                        self.assertIn(key + " ", notes)
                if "money_paths_globs" in example:
                    self.assertIn("money_paths_globs:", notes)

    def test_a_minimal_profile_takes_conservative_defaults(self) -> None:
        result = check({"version": 1}, windows=True)
        self.assertTrue(result.valid)
        resolved = result.resolved or {}
        self.assertEqual((resolved["network"], resolved["live_side_effects"],
                          resolved["situation"], resolved["sandbox_ack"], resolved["mode"]),
                         ("denied", "unconfirmed", "maintenance only", False, "auto"))
        self.assertEqual(resolved["auto_apply"], {k: False for k in vp.AUTO_APPLY_KEYS})
        self.assertTrue(any(d.startswith("auto_apply.money_paths: false") for d in
                            result.defaults))
        self.assertTrue(any(d.startswith("situation: \"maintenance only\"") for d in
                            result.defaults))
        text = " ".join(result.blockers)
        self.assertIn("live_side_effects is 'unconfirmed'", text)
        self.assertIn("gates is empty", text)
        self.assertIn("sandbox_ack is false", text)
        self.assertFalse(result.autonomous_apply)

    def test_blockers(self) -> None:
        self.assertEqual(check(good(sandbox_ack=False), windows=False).blockers, [])
        self.assertIn("sandbox_ack", check(good(sandbox_ack=False), windows=True).blockers[0])
        self.assertIn("'report-only'", check(good(mode="report-only")).blockers[0])
        passed = good(budget={"max_tokens": 5, "deadline_utc": "2026-09-24T06:00:00Z"})
        self.assertIn("has passed", check(passed).blockers[0])
        future = good(budget={"max_tokens": 5, "deadline_utc": "2026-09-26T06:00Z"})
        self.assertEqual(check(future).blockers, [])
        result = vp.validate(passed)
        self.assertEqual(vp.assess(result, windows=False, now=NOW, deadline=False), [])

    def test_warnings(self) -> None:
        data = good(forbidden_commands=["rm"], network="denied",
                    auto_apply={"structural": True, "dependencies": True,
                                "money_paths": True},
                    e2e=[{"name": "boot", "cmd": "node server.js"}])
        result = check(data)
        self.assertTrue(result.valid, result.errors)
        text = " ".join(result.warnings)
        for fragment in ("2-character substring", "no timeout_s", "money_paths is true",
                         "network is 'denied'"):
            self.assertIn(fragment, text)
        self.assertTrue(any(d.startswith("auto_apply.behavioural: false") for d in
                            result.defaults))
        self.assertIn("no e2e check", " ".join(check(good(e2e=[])).warnings))

    def test_owner_judgement_switch(self) -> None:
        """auto_apply.owner_judgement (user-policy-autonomy U01-F06)."""
        self.assertIn("owner_judgement", vp.AUTO_APPLY_KEYS)
        on = check(good(auto_apply={key: True for key in vp.AUTO_APPLY_KEYS}))
        self.assertEqual(on.errors, [])
        self.assertTrue(on.summary()["auto_apply"]["owner_judgement"])
        text = " ".join(on.warnings)
        self.assertIn("money_paths is true", text)
        self.assertIn("live-effect", text)
        narrow = check(good(auto_apply={"structural": True, "owner_judgement": True}))
        self.assertIn("owner_judgement is true but behavioural is false",
                      " ".join(narrow.warnings))
        absent = check(good(auto_apply={"structural": True}))
        self.assertFalse(absent.summary()["auto_apply"]["owner_judgement"])
        self.assertTrue(any(d.startswith("auto_apply.owner_judgement: false")
                            for d in absent.defaults))
        bad = check(good(auto_apply={"owner_judgement": "yes"}))
        self.assertIn("auto_apply.owner_judgement must be true or false", " ".join(bad.errors))


class InvalidProfileTests(unittest.TestCase):
    def errors(self, data: Any) -> str:
        result = check(data)
        self.assertFalse(result.valid)
        self.assertIsNone(result.resolved)
        return "\n".join(result.errors)

    def test_top_level_problems(self) -> None:
        cases: List[Tuple[Any, str]] = [
            ([], "must be a JSON object"),
            ({}, "version is missing"),
            ({"version": 2}, "version must be 1"),
            ({"version": True}, "version must be 1"),
            (good(extra=1), "unknown key(s) extra"),
            (good(template=True), "unreviewed template"),
            (good(mode="interactive"), "chosen on the command line"),
            (good(mode="apply"), "mode must be one of"),
            (good(network="yes"), "network must be one of"),
            (good(live_side_effects="no"), "live_side_effects must be one of"),
            (good(situation="release"), "situation must be one of"),
            (good(sandbox_ack="yes"), "sandbox_ack must be true or false"),
            (good(comment=3), "comment must be a string or a list of strings"),
            (good(future_work=["/abs"]), "must be relative to the repository"),
            (good(future_work="src"), "future_work must be a list"),
        ]
        for data, fragment in cases:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.errors(data))

    def test_gate_and_e2e_problems(self) -> None:
        base_gate = {"name": "g", "cmd": ["x"], "cwd": "."}
        cases: List[Tuple[Dict[str, Any], str]] = [
            (good(gates=[{"cmd": ["x"]}]), "gates[0].name must be a non-empty string"),
            (good(gates=[dict(base_gate, cmd="")]), "gates[0].cmd is empty"),
            (good(gates=[dict(base_gate, cmd=[])]), "non-empty list of strings"),
            (good(gates=[dict(base_gate, cmd=3)]), "must be a string (run through"),
            (good(gates=[dict(base_gate, cwd="C:/x")]), "must be relative"),
            (good(gates=[dict(base_gate, cwd="a/../../x")]), "no '..'"),
            (good(gates=[dict(base_gate, timeout_s=0)]), "timeout_s must be a positive"),
            (good(gates=[dict(base_gate, timeout_s=True)]), "timeout_s must be a positive"),
            (good(gates=[dict(base_gate, count_regex="(a)(b)")]), "exactly one capture group"),
            (good(gates=[dict(base_gate, count_regex="(")]), "not a valid regex"),
            (good(gates=[dict(base_gate, ratchet=True)]), "ratchet needs a count_regex"),
            (good(gates=[dict(base_gate, count_mode="avg")]), "count_mode must be one of"),
            (good(gates=[dict(base_gate, shell="zsh")]), "shell must be"),
            (good(gates=[dict(base_gate, env={"A": 1})]), "env must map"),
            (good(gates=[dict(base_gate, compare=True)]), "unknown key(s) compare"),
            (good(e2e=[dict(base_gate, compare="yes")]), "e2e[0].compare must be true"),
            (good(e2e=[dict(base_gate, ratchet=True)]), "unknown key(s) ratchet"),
            (good(gates=[base_gate], e2e=[dict(base_gate, timeout_s=5)]),
             "already used by gates[0]"),
            (good(gates="x"), "gates must be a list"),
            (good(gates=[dict(base_gate, cmd=["npm", "run", "deploy"])]),
             "matches forbidden_commands entry 'npm run deploy'"),
        ]
        for data, fragment in cases:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.errors(data))

    def test_auto_apply_budget_and_forbidden_problems(self) -> None:
        cases: List[Tuple[Dict[str, Any], str]] = [
            (good(auto_apply=[]), "auto_apply must be an object"),
            (good(auto_apply={"structural": 1}), "auto_apply.structural must be true or false"),
            (good(auto_apply={"everything": True}), "auto_apply has unknown key(s) everything"),
            (good(budget={"max_tokens": 0}), "max_tokens must be a positive integer"),
            (good(budget={"deadline_utc": "2026-09-25"}), "deadline_utc must be a UTC"),
            (good(budget={"deadline_utc": "2026-09-25T06:00:00+02:00"}),
             "deadline_utc must be a UTC"),
            (good(budget={"hours": 3}), "budget has unknown key(s) hours"),
            (good(forbidden_commands=[""]), "forbidden_commands[0] is empty"),
            (good(forbidden_commands=["/(/"]), "not a valid regular expression"),
            (good(forbidden_commands=["/.*/"]), "matches the empty string"),
            (good(forbidden_commands=["//"]), "empty /regex/"),
            (good(forbidden_commands=[3]), "forbidden_commands[0] must be a string"),
            (good(forbidden_commands="git push"), "forbidden_commands must be a list"),
        ]
        for data, fragment in cases:
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.errors(data))

    def test_every_error_is_reported_at_once(self) -> None:
        result = check(good(version=3, network="x", gates=[{"cmd": 1}]))
        self.assertGreaterEqual(len(result.errors), 4)


class ForbiddenMatchTests(unittest.TestCase):
    def match(self, patterns: List[str], command: str) -> Any:
        compiled, problems = vp.compile_patterns(patterns)
        self.assertEqual(problems, [])
        hit = vp.forbidden_match(command, compiled)
        return hit.raw if hit else None

    def test_substrings_are_case_insensitive_and_whitespace_folded(self) -> None:
        self.assertEqual(self.match(["npm run deploy"], "cd app &&  NPM   run\tdeploy"),
                         "npm run deploy")
        self.assertEqual(self.match(["npm run deploy"], 'npm run "deploy" -- --prod'),
                         "npm run deploy")
        self.assertEqual(self.match(["npm run deploy"], "npm run \\\n  deploy"),
                         "npm run deploy")
        self.assertEqual(self.match(["npm run deploy"], "npm run `\n deploy"),
                         "npm run deploy")
        self.assertIsNone(self.match(["npm run deploy"], "npm run test"))

    def test_regexes(self) -> None:
        self.assertEqual(self.match(["/\\bgit\\s+push\\b/"], "git  push origin x"),
                         "/\\bgit\\s+push\\b/")
        self.assertIsNone(self.match(["/\\bgit\\s+push\\b/"], "git pushd"))
        self.assertIsNone(self.match(["/\\bgit\\s+push\\b/"], "GIT PUSH"))
        self.assertEqual(self.match(["/\\bgit\\s+push\\b/i"], "GIT PUSH"),
                         "/\\bgit\\s+push\\b/i")
        # A path that only starts with a slash is a substring, not a regex.
        self.assertEqual(self.match(["/home/pi"], "ls /home/pi/x"), "/home/pi")

    def test_salvage_keeps_usable_entries_of_an_invalid_profile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "profile.json"
            path.write_text(json.dumps({"version": 9, "forbidden_commands": [
                "sign-tx", "/(/", "/\\bdeploy\\b/"]}), encoding="utf-8")
            self.assertEqual(vp.salvage_forbidden(path), ["sign-tx", "/\\bdeploy\\b/"])
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(vp.salvage_forbidden(path), [])
            self.assertEqual(vp.salvage_forbidden(Path(tmp) / "missing.json"), [])


class TrackedProfileTests(unittest.TestCase):
    """A profile the repository holds is repository text, never the owner's consent
    (protocol-preflight PF-22; user-policy-autonomy U01-F04)."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-vp-"))
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        _git(self.repo, "init", "-q")
        (self.repo / "README.md").write_text("x\n", encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "init")
        self.path = self.repo / ".harden" / "profile.json"
        self.path.parent.mkdir()
        self.path.write_text(json.dumps(good()), encoding="utf-8")

    def tearDown(self) -> None:
        _rmtree(str(self.tmp))

    def check(self, path: Optional[Path] = None, base: str = "HEAD") -> vp.ProfileCheck:
        return vp.check_file(path or self.path, repo=self.repo, windows=False, now=NOW,
                             base=base)

    def assert_tracked(self, result: vp.ProfileCheck, detail: str) -> None:
        self.assertFalse(result.valid)
        self.assertFalse(result.autonomous_apply)
        self.assertIsNone(result.resolved)
        self.assertEqual(result.blockers, [])
        self.assertTrue(result.errors[0].startswith(TRACKED_REASON), result.errors)
        self.assertIn(detail, result.tracked or "")
        self.assertIn(detail, result.errors[0])
        self.assertEqual(vp.TRACKED_REASON, TRACKED_REASON)

    def test_an_untracked_profile_is_valid(self) -> None:
        result = self.check()
        self.assertTrue(result.valid, result.errors)
        self.assertIsNone(result.tracked)
        self.assertTrue(result.autonomous_apply)

    def test_a_tracked_profile_is_invalid_even_when_only_staged(self) -> None:
        _git(self.repo, "add", "-f", ".harden/profile.json")
        self.assert_tracked(self.check(), "git tracks .harden/profile.json")
        # Without --repo nothing is checked against git.
        self.assertTrue(vp.check_file(self.path, windows=False, now=NOW).valid)
        # A subdirectory of the work tree finds the same repository.
        result = vp.check_file(self.path, repo=self.repo / ".harden", windows=False, now=NOW)
        self.assertIn("git tracks .harden/profile.json", result.tracked or "")

    def test_a_profile_the_base_commit_holds_is_invalid(self) -> None:
        _git(self.repo, "add", "-f", ".harden/profile.json")
        _git(self.repo, "commit", "-q", "-m", "ship a profile")
        held = _git(self.repo, "rev-parse", "HEAD").strip()
        _git(self.repo, "rm", "-q", "--cached", ".harden/profile.json")
        _git(self.repo, "commit", "-q", "-m", "untrack it")
        self.assertTrue(self.check().valid)  # HEAD no longer holds it
        self.assert_tracked(self.check(base="HEAD~1"),
                            "the base commit {} holds .harden/profile.json".format(held[:12]))
        result = self.check(base="no-such-rev")
        self.assertFalse(result.valid)
        self.assertIn("cannot tell whether the repository tracks this profile", result.errors[0])
        self.assertIn("'no-such-rev' is not a commit", result.errors[0])

    def test_a_link_to_a_tracked_file_is_tracked(self) -> None:
        shipped = self.repo / "ops" / "profile.json"
        shipped.parent.mkdir()
        shipped.write_text(json.dumps(good()), encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "ship a profile")
        self.assert_tracked(self.check(shipped), "git tracks ops/profile.json")
        link = self.repo / ".harden" / "linked.json"
        try:
            os.symlink(str(shipped), str(link))
        except (OSError, NotImplementedError) as exc:
            self.skipTest("cannot create a symbolic link here: {}".format(exc))
        self.assert_tracked(self.check(link), "git tracks ops/profile.json")

    def test_outside_the_repository_or_without_git_nothing_is_held(self) -> None:
        outside = self.tmp / "profile.json"
        outside.write_text(json.dumps(good()), encoding="utf-8")
        self.assertIsNone(self.check(outside).tracked)
        self.assertTrue(self.check(outside).valid)
        plain = Path(tempfile.mkdtemp(prefix="harden-vp-plain-"))
        try:
            with mock.patch.object(vp, "_git", return_value=(
                    128, "", "fatal: not a git repository (or any of the parent directories)")):
                self.assertIsNone(vp.tracked_by_repository(outside, plain))
        finally:
            _rmtree(str(plain))

    def test_a_git_that_cannot_answer_makes_the_profile_invalid(self) -> None:
        with mock.patch.object(vp.subprocess, "run", side_effect=FileNotFoundError("git")):
            result = self.check()
        self.assertFalse(result.valid)
        self.assertIsNone(result.tracked)
        self.assertIn("cannot tell whether the repository tracks this profile (git could not "
                      "run", result.errors[0])
        with mock.patch.object(vp, "_git", return_value=(128, "", "fatal: detected dubious "
                                                                  "ownership")):
            with self.assertRaises(vp.TrackingCheckError):
                vp.tracked_by_repository(self.path, self.repo)

    def test_cli(self) -> None:
        _git(self.repo, "add", "-f", ".harden/profile.json")
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT), str(self.path), "--repo",
                               str(self.repo), "--json"], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        self.assertEqual(proc.returncode, 1, proc.stderr)
        data = json.loads(proc.stdout.decode("utf-8"))
        self.assertFalse(data["valid"])
        self.assertIn("git tracks .harden/profile.json", data["tracked"])
        self.assertTrue(data["errors"][0].startswith(TRACKED_REASON))
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = vp.main([str(self.path), "--repo", str(self.repo)])
        self.assertEqual(code, 1)
        self.assertIn(TRACKED_REASON, out.getvalue())
        self.assertIn("autonomous apply: no", out.getvalue())
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = vp.main([str(self.path), "--base", "HEAD"])
        self.assertEqual(code, 2)
        self.assertIn("--base needs --repo", err.getvalue())


class MoneyPathGlobsTests(unittest.TestCase):
    """money_paths_globs: validation and the matching dialect (pilot-auto-calibration A01-F06,
    A01-F07)."""

    def test_an_absent_list_means_judgement_and_is_a_logged_default(self) -> None:
        result = check({"version": 1})
        self.assertIn(vp.MONEY_UNSET_DEFAULT, result.defaults)
        self.assertIsNone((result.resolved or {})["money_paths_globs"])
        self.assertEqual(result.money_paths_source, "judgement")
        self.assertIsNone(result.summary()["money_paths_globs"])
        self.assertEqual(result.summary()["money_paths_source"], "judgement")

    def test_a_present_list_is_resolved_and_decides(self) -> None:
        result = check(good())
        self.assertEqual(result.errors, [])
        self.assertEqual((result.resolved or {})["money_paths_globs"], ["src/billing/**"])
        self.assertNotIn(vp.MONEY_UNSET_DEFAULT, result.defaults)
        self.assertEqual(result.money_coverage, "not-checked")
        self.assertEqual(result.money_paths_source, "globs")
        self.assertEqual(result.summary()["money_paths_globs"], ["src/billing/**"])

    def test_unusable_entries_are_errors(self) -> None:
        cases: List[Tuple[Any, str]] = [
            ("src/**", "money_paths_globs must be a list"),
            (None, "money_paths_globs must be a list"),
            ([3], "money_paths_globs[0] must be a string"),
            ([""], "money_paths_globs[0] '' is empty"),
            ([" src/**"], "has leading or trailing whitespace"),
            (["src\\pay\\**"], "contains '\\'"),
            (["/src/**"], "must be relative to the repository root"),
            (["C:/src/**"], "must be relative to the repository root"),
            (["!src/legacy/**"], "negation is not supported"),
            (["src//pay"], "empty path segment"),
            (["./src/**"], "has a '.' segment"),
            (["src/../pay/**"], "has a '..' segment"),
            (["src/pay**"], "'**' must be a whole segment"),
            (["src/**x/y"], "'**' must be a whole segment"),
            (["src/[ab"], "unclosed '['"),
            (["src/[a/b]"], "class that contains '/'"),
            (["src/[z-a].ts"], "is not a valid pattern"),
        ]
        for value, fragment in cases:
            with self.subTest(value=value):
                result = check(good(money_paths_globs=value))
                self.assertFalse(result.valid)
                self.assertIn(fragment, "\n".join(result.errors))

    def test_duplicates_and_an_empty_list_are_warnings(self) -> None:
        result = check(good(money_paths_globs=["src/pay/**", "SRC/Pay/**"]))
        self.assertTrue(result.valid, result.errors)
        self.assertIn("money_paths_globs[1] repeats money_paths_globs[0]",
                      " ".join(result.warnings))
        result = check(good(money_paths_globs=[]))
        self.assertTrue(result.valid, result.errors)
        self.assertEqual(result.money_paths_source, "globs")
        self.assertIn("money_paths_globs is empty", " ".join(result.warnings))

    def test_matching_dialect(self) -> None:
        cases: List[Tuple[str, str, bool]] = [
            ("src/portfolio/**", "src/portfolio/valuation.ts", True),
            ("src/portfolio/**", "src/portfolios/x.ts", False),
            ("src/portfolio/**", "lib/src/portfolio/x.ts", False),
            ("src/portfolio", "src/portfolio/deep/x.ts", True),  # a directory covers below
            ("portfolio", "src/portfolio/x.ts", True),  # no '/': any depth
            ("*.key", "config/prod.key", True),
            ("src/*.ts", "src/a.ts", True),
            ("src/*.ts", "src/sub/a.ts", False),
            ("src/*", "src/sub/a.ts", True),  # matches the directory src/sub
            ("src/**/fees.py", "src/fees.py", True),
            ("src/**/fees.py", "src/a/b/fees.py", True),
            ("SRC/Portfolio/**", "src/portfolio/x.ts", True),  # letter case ignored
            ("wallet/", "src/wallet/keys.ts", True),
            ("wallet/", "src/wallet", False),  # a trailing '/' never matches a file
            ("app/[[]id]/page.tsx", "app/[id]/page.tsx", True),
            ("src/?.ts", "src/a.ts", True),
            ("src/?.ts", "src/ab.ts", False),
            ("**", "anything/at/all.txt", True),
            # a negated class may match '/': a wider reading only withholds more
            ("a[!b]c", "a/c", True),
        ]
        for pattern, path, expected in cases:
            with self.subTest(pattern=pattern, path=path):
                globs, problems = vp.compile_money_globs([pattern])
                self.assertEqual(problems, [])
                hit = vp.money_glob_match(path, globs)
                self.assertEqual(hit is not None, expected)
        globs, _ = vp.compile_money_globs(["src/a/**", "src/**"])
        self.assertEqual(vp.money_glob_match("src/a/x.ts", globs).raw, "src/a/**")  # first wins

    def test_a_literal_bracket_draws_no_warning(self) -> None:
        with warnings.catch_warnings():
            warnings.simplefilter("error", FutureWarning)
            globs, problems = vp.compile_money_globs(["web/[[]slug]/pay.tsx"])
            result = check(good(money_paths_globs=["web/[[]slug]/pay.tsx"]))
        self.assertEqual(problems, [])
        self.assertTrue(result.valid, result.errors)
        self.assertIsNotNone(vp.money_glob_match("web/[slug]/pay.tsx", globs))

    def test_repo_relative_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            top = os.path.join(tmp, "repo")
            os.makedirs(os.path.join(top, "src"))
            cases: List[Tuple[str, Optional[str], Optional[str]]] = [
                ("src\\a.ts", "src/a.ts", None),
                ("./src/a.ts", "src/a.ts", None),
                ("src/../src/a.ts", "src/a.ts", None),
                ("new/file.ts", "new/file.ts", None),
                ("../x.ts", None, "is outside the repository"),
                ("", None, "is empty"),
                (".", None, "names the repository root"),
                (os.path.join(top, "src", "a.ts"), "src/a.ts", None),
                (os.path.join(tmp, "other.ts"), None, "is outside the repository"),
            ]
            if os.name == "nt":
                drive, rest = os.path.splitdrive(os.path.realpath(top))
                msys = "/" + drive[0].lower() + rest.replace("\\", "/") + "/src/a.ts"
                cases.append((msys, "src/a.ts", None))
            for raw, path, problem in cases:
                with self.subTest(raw=raw):
                    got, why = vp.repo_relative_path(raw, top)
                    self.assertEqual(got, path)
                    if problem:
                        self.assertIn(problem, why or "")


class MoneyPathClassifyTests(unittest.TestCase):
    """money_paths_globs against a real repository, and the --classify CLI."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-vp-money-"))
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        _git(self.repo, "init", "-q")
        for rel in ("src/portfolio/valuation.ts", "src/cli.ts", "Billing/Invoice.ts"):
            target = self.repo / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("x\n", encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "init")
        self.profile = self.tmp / "profile.json"  # the owner's file, outside the repository

    def tearDown(self) -> None:
        _rmtree(str(self.tmp))

    def write(self, **overrides: Any) -> None:
        self.profile.write_text(json.dumps(good(**overrides)), encoding="utf-8")

    def check(self, **overrides: Any) -> vp.ProfileCheck:
        self.write(**overrides)
        return vp.check_file(self.profile, repo=self.repo, windows=False, now=NOW)

    def cli(self, *args: str, stdin: Optional[bytes] = None) -> Tuple[int, str, str]:
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT), str(self.profile), "--repo",
                               str(self.repo), *args], input=stdin, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        return (proc.returncode, proc.stdout.decode("utf-8", errors="replace"),
                proc.stderr.decode("utf-8", errors="replace"))

    def test_every_pattern_matches_so_the_list_decides(self) -> None:
        result = self.check(money_paths_globs=["src/portfolio/**"])
        self.assertTrue(result.valid, result.errors)
        self.assertEqual(result.money_coverage, "ok")
        self.assertEqual(result.money_paths_source, "globs")
        self.assertNotIn("matches no tracked file", " ".join(result.warnings))

    def test_a_pattern_matching_nothing_makes_the_run_ignore_the_list(self) -> None:
        result = self.check(money_paths_globs=["src/portfolio/**", "src/wallet/**"])
        self.assertTrue(result.valid, result.errors)  # a warning, not an error
        self.assertEqual(result.money_coverage, "unmatched")
        self.assertEqual(result.money_unmatched, ["src/wallet/**"])
        self.assertEqual(result.money_paths_source, "judgement")
        self.assertIn("money_paths_globs[1] 'src/wallet/**' matches no tracked file",
                      " ".join(result.warnings))
        self.assertIn("money paths: judgement (money_paths_globs ignored: pattern(s) "
                      "'src/wallet/**' match no tracked file)", vp.report_text(result))

    def test_case_only_and_match_all_warnings(self) -> None:
        result = self.check(money_paths_globs=["billing/**"])
        self.assertEqual(result.money_paths_source, "globs")
        self.assertIn("only when letter case is ignored (for example Billing/Invoice.ts)",
                      " ".join(result.warnings))
        result = self.check(money_paths_globs=["**"])
        self.assertIn("matches every tracked file", " ".join(result.warnings))

    def test_outside_a_work_tree_the_run_judges(self) -> None:
        plain = self.tmp / "plain"
        plain.mkdir()
        result = vp.check_document(good(), repo=plain, windows=False, now=NOW)
        self.assertTrue(result.valid, result.errors)
        self.assertEqual(result.money_coverage, "unavailable")
        self.assertEqual(result.money_paths_source, "judgement")
        self.assertIn("is not in a git work tree", " ".join(result.warnings))

    def test_classify_text(self) -> None:
        self.write(money_paths_globs=["src/portfolio/**"])
        code, out, err = self.cli("--classify", "src/portfolio/valuation.ts", "src\\cli.ts",
                                  "new/file.ts", "../outside.ts", "src/cli.ts")
        self.assertEqual(code, 2, err)  # one argument is no path inside the repository
        lines = out.splitlines()
        self.assertEqual(lines[:4], [
            "money-path\tsrc/portfolio/valuation.ts\tsrc/portfolio/**",
            "not-money-path\tsrc/cli.ts\t-",
            "not-money-path\tnew/file.ts\t-",
            "error\t../outside.ts\tis outside the repository"])
        self.assertEqual(len(lines), 5)  # the repeated src/cli.ts is printed once
        self.assertTrue(lines[4].startswith("# 4 path(s): 1 money-path, 2 not-money-path, "
                                            "0 judgement, 1 error; money paths by "
                                            "money_paths_globs (1 pattern(s))"), lines[4])
        code, out, _err = self.cli("--classify", "src/cli.ts")
        self.assertEqual(code, 0)

    def test_classify_every_tracked_file_as_json(self) -> None:
        self.write(money_paths_globs=["src/portfolio/"])
        code, out, err = self.cli("--classify", "--json")
        self.assertEqual(code, 0, err)
        data = json.loads(out)
        self.assertEqual(data["source"], "globs")
        verdicts = {r["path"]: (r["verdict"], r["pattern"]) for r in data["results"]}
        self.assertEqual(verdicts, {
            "Billing/Invoice.ts": ("not-money-path", None),
            "src/cli.ts": ("not-money-path", None),
            "src/portfolio/valuation.ts": ("money-path", "src/portfolio/")})
        self.assertEqual(data["counts"], {"money-path": 1, "not-money-path": 2,
                                          "judgement": 0, "error": 0})

    def test_classify_staged_paths_and_a_path_list(self) -> None:
        self.write(money_paths_globs=["src/portfolio/**"])
        _git(self.repo, "mv", "src/portfolio/valuation.ts", "src/value.ts")
        code, out, err = self.cli("--classify", "--staged")
        self.assertEqual(code, 0, err)
        self.assertIn("money-path\tsrc/portfolio/valuation.ts\tsrc/portfolio/**", out)
        self.assertIn("not-money-path\tsrc/value.ts\t-", out)
        listing = self.tmp / "files.txt"
        listing.write_bytes(b"\xef\xbb\xbf# finding files\r\n\r\n  src/cli.ts  \r\n"
                            b"src/portfolio/x.ts\r\nsrc/cli.ts\r\n")
        code, out, err = self.cli("--classify", "--paths-from", str(listing))
        self.assertEqual(code, 0, err)
        self.assertEqual(out.splitlines()[:2], ["not-money-path\tsrc/cli.ts\t-",
                                                "money-path\tsrc/portfolio/x.ts\tsrc/portfolio/**"])
        self.assertTrue(out.splitlines()[2].startswith("# 2 path(s)"))
        code, out, err = self.cli("--classify", "--paths-from", "-",
                                  stdin=b"src/portfolio/y.ts\n")
        self.assertEqual(code, 0, err)
        self.assertIn("money-path\tsrc/portfolio/y.ts", out)
        empty = self.tmp / "empty.txt"
        empty.write_bytes(b"")
        code, out, err = self.cli("--classify", "--paths-from", str(empty))
        self.assertEqual(code, 0, err)
        self.assertEqual(out.splitlines(), [out.splitlines()[0]])
        self.assertTrue(out.startswith("# 0 path(s)"))

    def test_classify_says_judgement_when_the_list_is_absent_or_ignored(self) -> None:
        data = good()
        data.pop("money_paths_globs")
        self.profile.write_text(json.dumps(data), encoding="utf-8")
        code, out, _err = self.cli("--classify", "src/portfolio/valuation.ts")
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines()[0], "judgement\tsrc/portfolio/valuation.ts\t-")
        self.assertIn("money paths judgement (money_paths_globs not set)", out)
        self.write(money_paths_globs=["src/portfolio/**", "src/wallet/**"])
        code, out, err = self.cli("--classify", "src/portfolio/valuation.ts")
        self.assertEqual(code, 0)
        self.assertEqual(out.splitlines()[0], "judgement\tsrc/portfolio/valuation.ts\t-")
        self.assertIn("matches no tracked file", err)

    def test_classify_refuses_an_invalid_or_tracked_profile(self) -> None:
        self.write(money_paths_globs=["!src/**"])
        code, out, err = self.cli("--classify", "src/cli.ts")
        self.assertEqual((code, out), (1, ""))
        self.assertIn("negation is not supported", err)
        inside = self.repo / "ops" / "profile.json"
        inside.parent.mkdir()
        inside.write_text(json.dumps(good(money_paths_globs=["src/**"])), encoding="utf-8")
        _git(self.repo, "add", "ops/profile.json")
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT), str(inside), "--repo",
                               str(self.repo), "--classify", "src/cli.ts"],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        self.assertEqual((proc.returncode, proc.stdout), (1, b""))
        self.assertIn(TRACKED_REASON, proc.stderr.decode("utf-8"))

    def test_classify_usage_errors(self) -> None:
        self.write()
        cases = [
            ([str(self.profile), "--classify", "src/cli.ts"], "--classify needs --repo"),
            ([str(self.profile), "--repo", str(self.repo), "--staged"],
             "--staged and --paths-from need --classify"),
            ([str(self.profile), "--repo", str(self.repo), "--classify", "--paths-from",
              str(self.tmp / "missing.txt")], "cannot read --paths-from"),
        ]
        for argv, fragment in cases:
            with self.subTest(fragment=fragment):
                out, err = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    code = vp.main(argv)
                self.assertEqual(code, 2)
                self.assertIn(fragment, err.getvalue())

    def test_a_path_with_a_tab_is_printed_as_a_json_string(self) -> None:
        self.write(money_paths_globs=["src/**"])
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = vp.main([str(self.profile), "--repo", str(self.repo), "--classify",
                            "src/a\tb.ts"])
        self.assertEqual(code, 0, err.getvalue())
        self.assertEqual(out.getvalue().splitlines()[0],
                         'money-path\t"src/a\\tb.ts"\tsrc/**')

    def test_an_empty_repository_has_nothing_to_match(self) -> None:
        empty = self.tmp / "empty"
        empty.mkdir()
        _git(empty, "init", "-q")
        self.write(money_paths_globs=["src/**"])
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT), str(self.profile), "--repo",
                               str(empty), "--classify"], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        out = proc.stdout.decode("utf-8")
        self.assertTrue(out.startswith("# 0 path(s): 0 money-path, 0 not-money-path, "
                                       "0 judgement, 0 error; money paths judgement"), out)


class SchemaSyncTests(unittest.TestCase):
    def test_schema_lists_the_validator_keys_and_values(self) -> None:
        schema = json.loads((ASSETS / "profile.schema.json").read_text(encoding="utf-8"))
        props = schema["properties"]
        self.assertEqual(set(props), set(vp.TOP_KEYS))
        self.assertEqual(schema["required"], ["version"])
        self.assertEqual(props["situation"]["enum"], list(vp.SITUATIONS))
        self.assertEqual(props["network"]["enum"], list(vp.NETWORK_VALUES))
        self.assertEqual(props["live_side_effects"]["enum"], list(vp.LIVE_SIDE_EFFECTS_VALUES))
        self.assertEqual(props["mode"]["enum"], list(vp.PROFILE_MODES))
        self.assertEqual(set(props["auto_apply"]["properties"]), set(vp.AUTO_APPLY_KEYS))
        self.assertEqual(set(props["budget"]["properties"]), set(vp.BUDGET_KEYS))
        self.assertEqual(set(props["origin"]["properties"]), set(vp.ORIGIN_KEYS))
        self.assertEqual(set(props["detection"]["properties"]), set(vp.DETECTION_KEYS))
        self.assertEqual(props["origin"]["properties"]["kind"]["enum"], list(vp.ORIGIN_KINDS))
        self.assertEqual(props["provenance"]["propertyNames"]["pattern"],
                         vp.PROVENANCE_KEY_RE.pattern)
        self.assertEqual(props["detection"]["properties"]["lens_bundles"]["enum"],
                         list(vp.LENS_BUNDLE_VALUES))
        self.assertEqual(set(schema["$defs"]["gate"]["properties"]), set(vp.GATE_KEYS))
        self.assertEqual(set(schema["$defs"]["e2e"]["properties"]), set(vp.E2E_KEYS))
        for key, value in vp.DEFAULTS.items():
            self.assertEqual(props[key].get("default"), value, key)
        self.assertEqual(props["money_paths_globs"]["type"], "array")
        self.assertNotIn("default", props["money_paths_globs"])
        self.assertNotIn("money_paths_globs", vp.DEFAULTS)


def inferred(**overrides: Any) -> Dict[str, Any]:
    """A valid self-setup profile (protocol-preflight PF-23; user-policy-autonomy U01-F05)."""
    data = good(forbidden_commands=["/\\bgit\\s+push\\b/"])
    data["gates"][0].update(inherit_env=False, env_allowlist=["PATH"])
    data["e2e"][0].update(inherit_env=False, env_allowlist=["PATH"])
    data["origin"] = {"kind": "inferred", "tool": "infer_profile.py", "tool_version": 1,
                      "created_utc": "2026-09-25T22:00:00Z", "base_sha": "a" * 40,
                      "report_sha256": "b" * 64,
                      "consent": "the owner's /harden invocation (user-policy-autonomy U01-F05)"}
    data["provenance"] = {
        "gates.test": [{"source": ".github/workflows/ci.yml", "line": 12, "detail": "CI step"}],
        "e2e.smoke": [{"source": "package.json", "line": 3}],
        "forbidden_commands[0]": [{"source": "rule", "line": None, "detail": "generic"}],
        "network": [{"source": "pnpm-lock.yaml", "line": 1}],
        "auto_apply.structural": [{"source": "owner decision", "detail": "2026-09-25"}],
    }
    data.update(overrides)
    return data


class OriginProvenanceTests(unittest.TestCase):
    """origin, provenance and dependency_versions (self-setup, PF-23; U01-F05, U01-F08)."""

    def test_origin_and_provenance_are_accepted_and_summarised(self) -> None:
        result = check(inferred())
        self.assertEqual(result.errors, [])
        summary = result.summary()
        self.assertEqual(summary["origin"], "inferred")
        self.assertEqual(summary["origin_base_sha"], "a" * 40)
        self.assertEqual(summary["provenance_fields"], 5)
        self.assertEqual(summary["gates_cmds"], [["test", "pytest -q", "."]])
        self.assertEqual(summary["e2e_cmds"], [["smoke", "python -m app --help", "."]])
        self.assertIn("origin: inferred by self-setup", vp.report_text(result))
        self.assertEqual(check(good()).summary()["origin"], "owner")
        self.assertIn("origin: owner", vp.report_text(check(good())))

    def test_bad_origin_and_provenance_shapes_are_errors(self) -> None:
        cases = [
            ({"origin": {"kind": "robot"}}, "origin.kind"),
            ({"origin": {"kind": "inferred", "colour": "x"}}, "origin has unknown key"),
            ({"origin": {"kind": "inferred", "base_sha": "xyz"}}, "origin.base_sha"),
            ({"origin": {"kind": "inferred", "tool_version": 0}}, "origin.tool_version"),
            ({"origin": {"kind": "inferred", "created_utc": "yesterday"}}, "origin.created_utc"),
            ({"origin": "inferred"}, "origin must be an object"),
            ({"provenance": {"gates": [{"source": "x"}]}}, "is not a profile field"),
            ({"provenance": {"network": []}}, "non-empty list"),
            ({"provenance": {"network": [{"line": 2}]}}, ".source must be a non-empty string"),
            ({"provenance": {"network": [{"source": "x", "line": 0}]}}, ".line must be"),
            ({"provenance": {"network": [{"source": "x", "why": "y"}]}}, "unknown key(s) why"),
            ({"provenance": ["x"]}, "provenance must be an object"),
        ]
        for extra, needle in cases:
            with self.subTest(needle=needle):
                result = check(good(**extra))
                self.assertIn(needle, " ".join(result.errors))

    def test_inferred_profile_warnings(self) -> None:
        data = inferred()
        del data["provenance"]["gates.test"]
        data["gates"][0]["inherit_env"] = True
        data["provenance"]["gates.missing"] = [{"source": "x"}]
        warnings = " ".join(check(data).warnings)
        self.assertIn("no provenance for gates.test (PF-23)", warnings)
        self.assertIn("gates.test of an inferred profile inherits the whole environment", warnings)
        self.assertIn("provenance names gates.missing, which the profile does not have", warnings)
        no_test = inferred()
        del no_test["gates"][0]["count_regex"]
        self.assertIn("an inferred profile without a runnable test gate",
                      " ".join(check(no_test).warnings))
        self.assertNotIn("inherits the whole environment", " ".join(check(inferred()).warnings))

    def test_inferred_base_mismatch_warns(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="harden-vp-origin-"))
        try:
            repo = tmp / "repo"
            repo.mkdir()
            _git(repo, "init", "-q")
            (repo / "a.txt").write_text("a\n", encoding="utf-8")
            _git(repo, "add", "-A")
            _git(repo, "commit", "-q", "-m", "one")
            first = _git(repo, "rev-parse", "HEAD").strip()
            (repo / "a.txt").write_text("b\n", encoding="utf-8")
            _git(repo, "commit", "-q", "-am", "two")
            data = inferred(origin={"kind": "inferred", "base_sha": first})
            result = vp.check_document(data, repo=repo, windows=False, now=NOW)
            self.assertIn("self-setup runs again for a new base", " ".join(result.warnings))
            same = vp.check_document(data, repo=repo, windows=False, now=NOW, base=first)
            self.assertNotIn("self-setup runs again", " ".join(same.warnings))
        finally:
            _rmtree(str(tmp))

    def test_dependency_versions_default_and_warning(self) -> None:
        apply = dict(good()["auto_apply"])
        del apply["dependency_versions"]
        absent = check(good(auto_apply=apply))
        self.assertTrue(any(d.startswith("auto_apply.dependency_versions: false")
                            for d in absent.defaults))
        self.assertFalse(absent.summary()["auto_apply"]["dependency_versions"])
        warned = check(good(auto_apply={"dependencies": False, "dependency_versions": True}))
        self.assertIn("auto_apply.dependency_versions is true but auto_apply.dependencies is not",
                      " ".join(warned.warnings))


class BudgetDetectionTests(unittest.TestCase):
    """budget.max_usd, budget.max_minutes and detection (pilot-auto-calibration A01-F34 to
    A01-F36)."""

    def test_budget_max_usd_and_max_minutes(self) -> None:
        result = check(good(budget={"max_usd": 120, "max_minutes": 480}))
        self.assertEqual(result.errors, [])
        budget = result.summary()["budget"]
        self.assertEqual((budget["max_usd"], budget["max_minutes"]), (120, 480))
        cases = [({"max_usd": 0}, "max_usd must be a number above 0"),
                 ({"max_usd": True}, "max_usd must be a number above 0"),
                 ({"max_minutes": 10}, "max_minutes must be an integer from 30 to 2880"),
                 ({"max_minutes": 30.5}, "max_minutes must be an integer from 30 to 2880")]
        for budget_value, needle in cases:
            with self.subTest(budget=budget_value):
                self.assertIn(needle, " ".join(check(good(budget=budget_value)).errors))

    def test_detection_defaults_and_values(self) -> None:
        result = check(good())
        self.assertEqual(result.summary()["detection"],
                         {"max_concurrent_subagents": 4, "lens_bundles": "auto",
                          "pass_model": None})
        self.assertEqual(result.defaults, [])
        chosen = check(good(detection={"max_concurrent_subagents": 3, "lens_bundles": "grouped",
                                       "pass_model": "sonnet"}))
        self.assertEqual(chosen.errors, [])
        self.assertEqual(chosen.summary()["detection"]["pass_model"], "sonnet")

    def test_detection_errors(self) -> None:
        cases = [({"max_concurrent_subagents": 0}, "from 1 to 16"),
                 ({"max_concurrent_subagents": 17}, "from 1 to 16"),
                 ({"max_concurrent_subagents": True}, "from 1 to 16"),
                 ({"lens_bundles": "all"}, "one of auto, single, grouped"),
                 ({"pass_model": "bad model!"}, "pass_model must be"),
                 ({"colour": 1}, "detection has unknown key"),
                 ("grouped", "detection must be an object")]
        for value, needle in cases:
            with self.subTest(value=value):
                self.assertIn(needle, " ".join(check(good(detection=value)).errors))


class CliTests(unittest.TestCase):
    def run_cli(self, *args: str) -> Tuple[int, str, str]:
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT), *args],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        return (proc.returncode, proc.stdout.decode("utf-8", errors="replace"),
                proc.stderr.decode("utf-8", errors="replace"))

    def test_exit_codes_and_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "profile.json"
            path.write_bytes(b"\xef\xbb\xbf" + json.dumps(good()).encode("utf-8"))  # BOM
            code, out, _err = self.run_cli(str(path), "--json")
            self.assertEqual(code, 0, out)
            data = json.loads(out)
            self.assertTrue(data["valid"])
            self.assertEqual(len(data["sha256"]), 64)
            for key in ("errors", "warnings", "defaults", "blockers", "autonomous_apply",
                        "tracked", "summary"):
                self.assertIn(key, data)
            self.assertIsNone(data["tracked"])
            code, out, _err = self.run_cli(str(path), "--repo", tmp)
            self.assertEqual(code, 0, out)
            path.write_text(json.dumps(good(gates=[{"name": "g", "cmd": "x", "cwd": "pkg"}])),
                            encoding="utf-8")
            code, out, _err = self.run_cli(str(path), "--repo", tmp)
            self.assertEqual(code, 1)
            self.assertIn("gates[0].cwd 'pkg' does not exist", out)
            path.write_text("{", encoding="utf-8")
            code, out, _err = self.run_cli(str(path))
            self.assertEqual(code, 1)
            self.assertIn("not valid JSON", out)
            code, _out, err = self.run_cli(str(Path(tmp) / "missing.json"))
            self.assertEqual(code, 2)
            self.assertIn("cannot read", err)

    def test_text_output_names_blockers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "profile.json"
            path.write_text(json.dumps({"version": 1}), encoding="utf-8")
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = vp.main([str(path)])
            self.assertEqual(code, 0)
            self.assertIn("autonomous apply: no", out.getvalue())
            self.assertIn("defaults taken", out.getvalue())
            self.assertIn("money paths: judgement (money_paths_globs not set)", out.getvalue())


class NodeOptionVariantTests(unittest.TestCase):
    """pilot-auto-calibration A01-F57: a ban written for `node dist/cli.js value` also meets
    the command with node options (the offline guard's --require) before the script."""

    BAN = r"/\bnode\s+\S*cli\.(js|ts|mjs)\b.*\b(value|pnl|alerts|watch|snapshot)\b/"

    def hit(self, command: str) -> bool:
        compiled, problems = vp.compile_patterns([self.BAN])
        self.assertEqual(problems, [])
        return vp.forbidden_match(command, compiled) is not None

    def test_node_options_are_removed_in_one_variant(self) -> None:
        self.assertTrue(self.hit('node --require "C:/x y/offline-guard.cjs" dist/cli.js value'))
        self.assertTrue(self.hit("node --enable-source-maps dist/cli.js value"))
        self.assertTrue(self.hit("node -r ./a.cjs --conditions=dev dist/cli.js pnl"))
        self.assertFalse(self.hit("node --require X dist/cli.js plugins"))

    def test_variant_only_adds_forms(self) -> None:
        command = "node --require X dist/cli.js value"
        variants = vp.command_variants(command)
        self.assertEqual(variants[0], command)
        self.assertIn("node dist/cli.js value", variants)
        self.assertEqual(vp.command_variants("npm test"), ["npm test"])


if __name__ == "__main__":
    unittest.main()
