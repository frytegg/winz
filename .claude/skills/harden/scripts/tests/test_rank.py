"""Tests for scripts/rank.py: size-descending fallback with thin history, history ranking behind
the sufficiency gate and the time-split backtest, rename folding, windows, temperature, test
separation, exclusions, config globs, optional lizard, and the CLI.

Repositories are built with the fast-import fixture builder from test_inventory.py (fixed dates).
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
import unittest
from pathlib import Path
from typing import Any, Dict, Optional

TESTS = Path(__file__).resolve().parent
SCRIPTS = TESTS.parent
sys.path.insert(0, str(SCRIPTS))
sys.path.insert(0, str(TESTS))

import _common as C  # noqa: E402
import rank as R  # noqa: E402
from test_inventory import (BASE_TS, DAY, RepoBuilder, build_rich_history, isolate_git,  # noqa: E402
                            lines, restore_git, write_files)


def setUpModule() -> None:  # noqa: N802
    isolate_git()


def tearDownModule() -> None:  # noqa: N802
    restore_git()


def do_rank(repo: Path, since: str = "12.months", top: int = 0, lizard: bool = False,
            now_ts: Optional[float] = None, inventory: Optional[Dict[str, Any]] = None
            ) -> Dict[str, Any]:
    info = C.resolve_repo(repo)
    return R.rank_repository(info, inventory, C.parse_window(since), top,
                             C.HALF_LIFE_DAYS_DEFAULT, 5, lizard, now_ts=now_ts)


def by_path(doc: Dict[str, Any], key: str = "files") -> Dict[str, Dict[str, Any]]:
    return {e["path"]: e for e in doc[key]}


def build_thin_repo(root: Path) -> Path:
    """Five commits: sizes differ, plus tests, docs, a lockfile, generated and vendored code."""
    b = RepoBuilder(root)
    b.commit("feat: start", BASE_TS, files={
        "src/large.ts": lines(50, "large"), "src/medium.ts": lines(20, "medium"),
        "src/small.ts": lines(5, "small"), "src/app.test.ts": lines(8, "t"),
        "tests/test_mod.py": lines(12, "tp"), "README.md": "# r\n", "docs/a.md": "# a\n",
        "pnpm-lock.yaml": "x: 1\n", "dist/out.js": lines(500, "d"),
        "vendor/v.js": lines(300, "v"), "config.yml": "a: 1\n",
        "src/gen.ts": "// @generated\n" + lines(400, "g")})
    b.commit("feat: grow small", BASE_TS + 100 * DAY, files={"src/small.ts": lines(9, "small")})
    b.commit("fix: medium bug", BASE_TS + 101 * DAY, files={"src/medium.ts": lines(21, "medium")})
    b.commit("feat: more", BASE_TS + 102 * DAY, files={"src/small.ts": lines(10, "small")})
    b.commit("docs: readme", BASE_TS + 103 * DAY, files={"README.md": "# r2\n"})
    b.build()
    return root


class ThinHistoryTests(unittest.TestCase):
    """History insufficient: size-descending, no history numbers, explicit note."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp(prefix="harden-rank-thin-"))
        cls.repo = build_thin_repo(cls.tmp / "thin")
        cls.doc = do_rank(cls.repo, now_ts=BASE_TS + 400 * DAY)

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_method_and_notes(self) -> None:
        doc = self.doc
        self.assertFalse(doc["history_sufficient"])
        self.assertEqual(doc["method"], "size-descending")
        self.assertIsNone(doc["backtest"])
        skipped = [n for n in doc["notes"] if n.startswith("history ranking skipped")]
        self.assertEqual(len(skipped), 1)
        self.assertIn("S1 failed", skipped[0])
        self.assertTrue(any("lizard disabled" in n for n in doc["notes"]))

    def test_size_order_and_null_history_fields(self) -> None:
        files = self.doc["files"]
        self.assertEqual([e["path"] for e in files], ["src/large.ts", "src/medium.ts",
                                                      "src/small.ts"])
        self.assertEqual([e["rank"] for e in files], [1, 2, 3])
        for e in files:
            self.assertIsNone(e["commits"])
            self.assertIsNone(e["fixes"])
            self.assertIsNone(e["score"])

    def test_tests_ranked_separately_and_exclusions(self) -> None:
        self.assertEqual([e["path"] for e in self.doc["tests"]],
                         ["tests/test_mod.py", "src/app.test.ts"])
        ex = self.doc["excluded"]
        self.assertEqual(ex["generated_or_vendor"], 3)   # dist/, vendor/, @generated header
        self.assertEqual(ex["lockfile"], 1)
        self.assertEqual(ex["doc"], 2)
        self.assertEqual(ex["non_source"], 1)            # config.yml
        self.assertTrue((self.repo / ".harden" / "inventory.json").is_file())

    def test_temperature(self) -> None:
        f = by_path(self.doc)
        # now = BASE + 400 d, window 12 months: changes at BASE + 100 d are hot, BASE is cold
        self.assertEqual(f["src/small.ts"]["temperature"], "hot")
        self.assertEqual(f["src/medium.ts"]["temperature"], "hot")
        self.assertEqual(f["src/large.ts"]["temperature"], "cold")
        self.assertEqual(f["src/small.ts"]["last_changed"], C.utc_date(BASE_TS + 102 * DAY))

    def test_top_truncation(self) -> None:
        doc = do_rank(self.repo, top=2)
        self.assertEqual(len(doc["files"]), 2)
        self.assertEqual(doc["totals"]["files"], 3)

    def test_config_scope_and_exclude(self) -> None:
        cfg = self.repo / ".harden" / "config.json"
        cfg.write_text(json.dumps({"gates": [], "scope": ["src/**"],
                                   "exclude_globs": ["src/medium.ts"],
                                   "test_globs": ["src/small.ts"]}), encoding="utf-8")
        try:
            doc = do_rank(self.repo)
        finally:
            cfg.unlink()
        self.assertEqual([e["path"] for e in doc["files"]], ["src/large.ts"])
        self.assertIn("src/small.ts", [e["path"] for e in doc["tests"]])
        self.assertNotIn("tests/test_mod.py", [e["path"] for e in doc["tests"]])
        self.assertEqual(doc["excluded"]["config_exclude"], 1)


class RichHistoryTests(unittest.TestCase):
    """History sufficient: backtest decides between history and size order."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = Path(tempfile.mkdtemp(prefix="harden-rank-rich-"))
        cls.pass_repo = cls.tmp / "pass"
        build_rich_history(cls.pass_repo, fixes_after_cut=True)
        cls.fail_repo = cls.tmp / "fail"
        build_rich_history(cls.fail_repo, fixes_after_cut=False)
        cls.tie_repo = cls.tmp / "tie"
        build_rich_history(cls.tie_repo, late_fix_path="src/big00.py")
        cls.pass_doc = do_rank(cls.pass_repo)
        cls.fail_doc = do_rank(cls.fail_repo)
        cls.tie_doc = do_rank(cls.tie_repo)

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_backtest_pass_uses_history(self) -> None:
        doc = self.pass_doc
        self.assertTrue(doc["history_sufficient"], doc["history_gate"])
        bt = doc["backtest"]
        self.assertTrue(bt["passed"], bt)
        self.assertEqual(bt["hits_history"], 1)
        self.assertEqual(bt["hits_size"], 0)
        self.assertIn("src/hot.py", bt["history_top"])
        self.assertNotIn("src/hot.py", bt["size_top"])
        self.assertEqual(doc["method"], "history-recency-weighted")
        top = doc["files"][0]
        self.assertEqual(top["path"], "src/hot.py")
        self.assertEqual(top["rank"], 1)
        self.assertTrue(top["eligible"])

    def test_rename_folding_counts_pre_rename_commits(self) -> None:
        hot = by_path(self.pass_doc)["src/hot.py"]
        # created as src/hot_old.py in the initial import, changed in commits 1..169 except the
        # pure rename at 60: 1 + 168 commits, 41 of them fix-labelled
        self.assertEqual(hot["commits"], 169)
        self.assertEqual(hot["fixes"], 41)
        self.assertNotIn("src/hot_old.py", by_path(self.pass_doc))
        self.assertGreater(hot["score"], 0)
        self.assertIsNotNone(hot["relative_churn"])

    def test_below_min_revs_have_null_rank(self) -> None:
        big = by_path(self.pass_doc)["src/big00.py"]
        self.assertEqual(big["commits"], 1)
        self.assertFalse(big["eligible"])
        self.assertIsNone(big["rank"])
        self.assertEqual(big["churn"], 0)   # the initial import is a bulk commit (G104-F07)

    def test_backtest_fail_falls_back_to_size(self) -> None:
        doc = self.fail_doc
        self.assertTrue(doc["history_sufficient"], doc["history_gate"])
        self.assertFalse(doc["backtest"]["passed"])
        self.assertIn("no fix-labelled commit", doc["backtest"]["reason"])
        self.assertEqual(doc["method"], "size-descending")
        self.assertTrue(any("did not beat size" in n for n in doc["notes"]))
        self.assertEqual(doc["files"][0]["path"], "src/big00.py")
        self.assertEqual(doc["files"][0]["rank"], 1)
        # history numbers are still reported because the gate passed
        self.assertIsNotNone(by_path(doc)["src/hot.py"]["commits"])

    def test_backtest_tie_is_not_a_win(self) -> None:
        doc = self.tie_doc
        bt = doc["backtest"]
        self.assertTrue(doc["history_sufficient"], doc["history_gate"])
        self.assertGreater(bt["fix_commits_after_cut"], 0)
        self.assertEqual(bt["hits_history"], bt["hits_size"])
        self.assertFalse(bt["passed"])
        self.assertIn("does not exceed", bt["reason"])
        self.assertEqual(doc["method"], "size-descending")

    def test_window_limits_counts(self) -> None:
        doc = do_rank(self.pass_repo, since="30.days")
        hot = by_path(doc)["src/hot.py"]
        self.assertLess(hot["commits"], 30)
        self.assertGreater(hot["commits"], 20)
        self.assertEqual(doc["window"]["end_date"], C.utc_date(BASE_TS + 200 * DAY - 1))

    def test_overlap_check_present(self) -> None:
        ov = self.pass_doc["top_overlap"]
        self.assertEqual(ov["k"], 10)
        self.assertEqual(ov["history_top"][0], "src/hot.py")


class LizardTests(unittest.TestCase):
    """max_ccn comes from `lizard --csv` only when lizard is on PATH."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-rank-lz-"))
        self.repo = build_thin_repo(self.tmp / "repo")
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        fake = self.bin / "fake_lizard.py"
        fake.write_text(
            "import sys\n"
            "for i, f in enumerate(a for a in sys.argv[1:] if not a.startswith('-')):\n"
            "    print('10,%d,50,1,12,\"fn@1-12@%s\",./%s,fn,fn(),1,12' % (i + 3, f, f))\n"
            "    print('4,2,20,0,5,\"g@13-17@%s\",./%s,g,g(),13,17' % (f, f))\n",
            encoding="utf-8")
        if os.name == "nt":
            (self.bin / "lizard.cmd").write_text(
                '@"{}" "{}" %*\r\n'.format(sys.executable, fake), encoding="utf-8")
        else:
            sh = self.bin / "lizard"
            sh.write_text('#!/bin/sh\nexec "{}" "{}" "$@"\n'.format(sys.executable, fake),
                          encoding="utf-8")
            sh.chmod(0o755)
        self.old_path = os.environ.get("PATH", "")
        os.environ["PATH"] = str(self.bin) + os.pathsep + self.old_path

    def tearDown(self) -> None:
        os.environ["PATH"] = self.old_path
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_max_ccn_added(self) -> None:
        doc = do_rank(self.repo, lizard=True)
        for e in doc["files"] + doc["tests"]:
            self.assertIsInstance(e.get("max_ccn"), int, e)
            self.assertGreaterEqual(e["max_ccn"], 3)
        self.assertTrue(any(n.startswith("lizard ") and "max_ccn" in n for n in doc["notes"]))

    def test_no_lizard_on_path(self) -> None:
        os.environ["PATH"] = self.old_path
        if shutil.which("lizard"):
            self.skipTest("a real lizard is installed")
        doc = do_rank(self.repo, lizard=True)
        self.assertNotIn("max_ccn", doc["files"][0])
        self.assertTrue(any("lizard is not on PATH" in n for n in doc["notes"]))


class CliTests(unittest.TestCase):
    """rank.py command line."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-rank-cli-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def run_cli(self, *args: str) -> "subprocess.CompletedProcess[bytes]":
        return subprocess.run([sys.executable, str(SCRIPTS / "rank.py")] + list(args),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)

    def test_bad_since(self) -> None:
        repo = build_thin_repo(self.tmp / "r")
        proc = self.run_cli("--repo", str(repo), "--since", "whenever")
        self.assertEqual(proc.returncode, 2)

    def test_writes_rank_json(self) -> None:
        repo = build_thin_repo(self.tmp / "r")
        proc = self.run_cli("--repo", str(repo), "--top", "2", "--no-lizard", "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        printed = json.loads(proc.stdout.decode("utf-8"))
        written = json.loads((repo / ".harden" / "rank.json").read_text(encoding="utf-8"))
        self.assertEqual(printed["method"], written["method"])
        self.assertEqual(len(written["files"]), 2)
        self.assertEqual(written["files"][0]["path"], "src/large.ts")

    def test_plain_directory(self) -> None:
        d = self.tmp / "plain"
        write_files(d, {"a.py": lines(3, "a"), "b.py": lines(9, "b")})
        with contextlib.redirect_stdout(io.StringIO()):
            rc = R.main(["--repo", str(d), "--no-lizard"])
        self.assertEqual(rc, 0)
        doc = json.loads((d / ".harden" / "rank.json").read_text(encoding="utf-8"))
        self.assertEqual(doc["method"], "size-descending")
        self.assertEqual([e["path"] for e in doc["files"]], ["b.py", "a.py"])
        self.assertEqual(doc["files"][0]["temperature"], "unknown")
        self.assertTrue(any("not a git repository" in n for n in doc["notes"]))


if __name__ == "__main__":
    unittest.main()
