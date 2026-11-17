"""Tests for scripts/budget.py (unittest, temporary git repositories, no network).

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
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import _common as C  # noqa: E402
import budget as B  # noqa: E402
import ledger as lg  # noqa: E402

SCRIPT = SCRIPTS / "budget.py"
SECRET = "TOPSECRET-MESSAGE-TEXT-4711"
_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None


def setUpModule() -> None:
    """Isolate git from the user's global/system configuration."""
    global _GIT_HOME
    _GIT_HOME = tempfile.mkdtemp(prefix="harden-gitcfg-")
    cfg = Path(_GIT_HOME) / "gitconfig"
    cfg.write_bytes(b"[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                    b"[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                    b"[core]\n\tautocrlf = false\n")
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
        raise RuntimeError("git {} failed: {}".format(args, proc.stderr.decode(errors="replace")))
    return proc.stdout.decode("utf-8", errors="replace").strip()


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def lines(n: int, prefix: str = "x") -> str:
    return "".join("{}{} = {}\n".format(prefix, i, i) for i in range(n))


def z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def assistant(ts: datetime, mid: str, model: str = "claude-opus-5-5", inp: int = 0,
              out: int = 0, sidechain: bool = False, text: str = SECRET) -> str:
    return json.dumps({"type": "assistant", "timestamp": z(ts), "requestId": "req-" + mid,
                       "isSidechain": sidechain, "uuid": "u-" + mid,
                       "message": {"id": "msg-" + mid, "model": model, "role": "assistant",
                                   "usage": {"input_tokens": inp, "output_tokens": out},
                                   "content": [{"type": "text", "text": text}]}}) + "\n"


class BudgetCase(unittest.TestCase):
    """A git repository with an in-scope ledger, a run marker and a session transcript."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-budget-"))
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        _git(self.repo, "init", "-q")
        _write(self.repo / "src" / "app.py", lines(100))
        _write(self.repo / "src" / "util.py", lines(40))
        _write(self.repo / "tests" / "test_app.py", "def test_x():\n    assert True\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "init")
        self.base = _git(self.repo, "rev-parse", "HEAD")
        self.start = (datetime.now(timezone.utc) - timedelta(hours=1)).replace(microsecond=0)
        self.transcript = self.tmp / "sessions" / "abc123.jsonl"
        _write(self.transcript, "")

    def tearDown(self) -> None:
        _rmtree(str(self.tmp))

    def at(self, minutes: float) -> str:
        return z(self.start + timedelta(minutes=minutes))

    def marker(self, mode: Optional[str] = "auto", budget: Optional[Dict[str, Any]] = None,
               detection: Optional[Dict[str, Any]] = None, **extra: Any) -> None:
        effective: Dict[str, Any] = {"budget": dict({"max_tokens": None, "deadline_utc": None,
                                                     "max_usd": None, "max_minutes": None},
                                                    **(budget or {}))}
        if detection is not None:
            effective["detection"] = detection
        data: Dict[str, Any] = {"base_sha": self.base, "branch": "harden/test",
                                "started": z(self.start),
                                "profile": {"present": True, "valid": True,
                                            "effective": effective}}
        if mode is not None:
            data["mode"] = mode
        data.update(extra)
        _write(self.repo / ".harden" / "active", json.dumps(data))
        _write(self.repo / ".harden" / "session.json",
               json.dumps({"run": "{}|{}".format(self.base, z(self.start)),
                           "transcript_path": str(self.transcript)}))

    def lg(self, *args: str) -> Tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = lg.main(list(args) + ["--repo", str(self.repo)])
        return code, out.getvalue(), err.getvalue()

    def init(self) -> None:
        code, _out, err = self.lg("init")
        self.assertEqual(code, 0, err)

    def bud(self, *args: str) -> Tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = B.main(list(args) + ["--repo", str(self.repo)])
        return code, out.getvalue(), err.getvalue()

    def plan(self, *extra: str, now: float = 1.0) -> Dict[str, Any]:
        code, out, err = self.bud("plan", "--lenses", "security,dead-code", "--now",
                                  self.at(now), *extra)
        self.assertEqual(code, 0, out + err)
        return self.data()

    def data(self) -> Dict[str, Any]:
        return json.loads((self.repo / B.BUDGET_REL).read_bytes().decode("utf-8"))

    def speak(self, *entries: str) -> None:
        with open(str(self.transcript), "ab") as handle:
            for entry in entries:
                handle.write(entry.encode("utf-8"))

    def baseline(self, seconds: float) -> None:
        _write(self.repo / ".harden" / "gates" / "baseline.json",
               json.dumps({"summary": {"test": {"median_duration_s": seconds}}}))

    def ledger(self) -> Dict[str, Any]:
        return json.loads((self.repo / lg.LEDGER_REL).read_bytes().decode("utf-8"))


class DeadlineTests(BudgetCase):
    def test_default_deadline_is_sixty_minutes_plus_twenty_per_kloc_clamped(self) -> None:
        self.marker()
        self.init()
        data = self.plan()
        loc = self.ledger()["totals"]["in_scope_loc"]
        self.assertLess(60 + 20 * loc / 1000.0, 120)
        self.assertEqual(data["total_minutes"], 120.0)
        self.assertEqual(data["deadline_source"], "default")
        self.assertEqual(data["deadline_utc"], self.at(120))

    def test_default_deadline_grows_with_loc(self) -> None:
        _write(self.repo / "src" / "big.py", lines(10000))
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "big")
        self.base = _git(self.repo, "rev-parse", "HEAD")
        self.marker()
        self.init()
        data = self.plan()
        loc = self.ledger()["totals"]["in_scope_loc"]
        self.assertEqual(data["total_minutes"], round(60 + 20 * loc / 1000.0, 2))
        self.assertGreater(data["total_minutes"], 250)

    def test_default_deadline_is_capped_at_ten_hours(self) -> None:
        _write(self.repo / "src" / "huge.py", lines(30000))
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "huge")
        self.base = _git(self.repo, "rev-parse", "HEAD")
        self.marker()
        self.init()
        self.assertEqual(self.plan()["total_minutes"], 600.0)

    def test_the_earlier_profile_deadline_wins(self) -> None:
        self.marker(budget={"deadline_utc": self.at(150), "max_minutes": 200})
        self.init()
        data = self.plan()
        self.assertEqual(data["deadline_utc"], self.at(150))
        self.assertEqual(data["deadline_source"], "profile (profile deadline_utc)")
        (self.repo / B.BUDGET_REL).unlink()
        self.marker(budget={"deadline_utc": self.at(400), "max_minutes": 200})
        data = self.plan()
        self.assertEqual(data["deadline_utc"], self.at(200))
        self.assertEqual(data["deadline_source"], "profile (profile max_minutes)")

    def test_plan_is_kept_until_replan(self) -> None:
        self.marker()
        self.init()
        first = self.plan()
        code, out, _err = self.bud("plan", "--lenses", "security", "--now", self.at(5))
        self.assertEqual(code, 0)
        self.assertIn("budget: deadline", out)
        self.assertEqual(self.data()["computed"], first["computed"])
        code, _out, err = self.bud("plan", "--replan", "--now", self.at(5))
        self.assertEqual(code, 0, err)
        data = self.data()
        self.assertEqual(data["deadline_utc"], first["deadline_utc"])
        self.assertEqual(len(data["replans"]), 1)
        self.assertEqual(data["detect_plan"]["lenses"], ["security", "dead-code"])

    def test_first_plan_needs_lenses_and_known_lenses(self) -> None:
        self.marker()
        self.init()
        code, _out, err = self.bud("plan", "--now", self.at(1))
        self.assertEqual(code, 2)
        self.assertIn("--lenses", err)
        code, _out, err = self.bud("plan", "--lenses", "nonsense", "--now", self.at(1))
        self.assertEqual(code, 2)
        self.assertIn("unknown lens", err)

    def test_plan_needs_a_run_marker(self) -> None:
        code, _out, err = self.bud("plan", "--lenses", "security")
        self.assertEqual(code, 2)
        self.assertIn("no .harden/active", err)


class SpendCapTests(BudgetCase):
    def test_no_spend_cap_without_max_usd(self) -> None:
        self.marker()
        self.init()
        self.speak(assistant(self.start + timedelta(minutes=2), "a", inp=100000000,
                             out=10000000))
        data = self.plan()
        self.assertIsNone(data["max_usd"])
        self.assertEqual(set(data["usd_caps"].values()), {None})
        code, out, _err = self.bud("check", "--phase", "detect", "--now", self.at(3))
        self.assertEqual(code, 0, out)
        self.assertIn("(no cap)", out)

    def test_profile_max_usd_closes_detection_when_spent(self) -> None:
        self.marker(budget={"max_usd": 10})
        self.init()
        data = self.plan()
        self.assertEqual(data["usd_caps"]["detect"], 3.5)
        self.speak(assistant(self.start + timedelta(minutes=2), "a", inp=1000000, out=100000))
        code, out, _err = self.bud("spend", "--json")
        self.assertEqual(code, 0)
        self.assertAlmostEqual(json.loads(out)["usd"], 6.0, places=4)
        code, out, _err = self.bud("check", "--phase", "detect", "--now", self.at(3))
        self.assertEqual(code, 1, out)
        self.assertIn("(spend)", out)
        self.assertEqual(self.data()["stops"]["detect"]["reason"], "spend")
        progress = (self.repo / ".harden" / "progress.md").read_bytes().decode("utf-8")
        self.assertIn("detect window closed (spend)", progress)

    def test_spend_before_the_run_started_is_not_counted(self) -> None:
        self.marker()
        self.init()
        self.speak(assistant(self.start - timedelta(minutes=5), "old", inp=1000000),
                   assistant(self.start + timedelta(minutes=1), "new", inp=1000000))
        code, out, _err = self.bud("spend", "--json")
        self.assertEqual(code, 0)
        self.assertAlmostEqual(json.loads(out)["usd"], 4.0, places=4)


class WindowTests(BudgetCase):
    def test_check_without_plan_exits_2(self) -> None:
        self.marker()
        self.init()
        code, _out, err = self.bud("check", "--phase", "detect")
        self.assertEqual(code, 2)
        self.assertIn("budget.py: no .harden/budget.json: run budget.py plan --lenses <selected "
                      "lenses> first", err)

    def test_detect_window_closes_on_time_and_stop_budget_reads_the_plan(self) -> None:
        self.marker()
        self.init()
        data = self.plan()
        end = B.parse_iso(data["windows"]["detect_end"])
        assert end is not None
        code, out, _err = self.bud("check", "--phase", "detect", "--now", self.at(2))
        self.assertEqual(code, 0, out)
        self.assertIn("next: unit", out)
        code, out, _err = self.bud("check", "--phase", "detect", "--now",
                                   z(end + timedelta(minutes=1)))
        self.assertEqual(code, 1, out)
        self.assertIn("detect window closed", out)
        self.assertIn("ledger.py stop-budget", out)
        self.assertEqual(self.data()["stops"]["detect"]["reason"], "time")
        code, out, err = self.lg("stop-budget")
        self.assertEqual(code, 0, err)
        self.assertIn("skipped-budget recorded", out)

    def test_advisory_interactive_run_never_stops(self) -> None:
        self.marker(mode="interactive")
        self.init()
        data = self.plan()
        self.assertTrue(data["advisory"])
        code, out, _err = self.bud("check", "--phase", "detect", "--now", self.at(500))
        self.assertEqual(code, 0)
        self.assertIn("advisory", out)
        self.assertIn("would close (time)", out)

    def test_report_only_run_has_no_apply_window(self) -> None:
        self.marker(mode="report-only")
        self.init()
        data = self.plan()
        self.assertIsNone(data["windows"]["apply_end"])
        code, out, _err = self.bud("check", "--phase", "apply", "--now", self.at(2))
        self.assertEqual(code, 1)
        self.assertIn("no time for Apply", out)

    def test_concurrency_above_the_cap_is_warned(self) -> None:
        self.marker(detection={"max_concurrent_subagents": 1})
        self.init()
        subdir = self.tmp / "sessions" / "abc123" / "subagents"
        for name in ("agent-a1", "agent-b2"):
            _write(subdir / (name + ".jsonl"),
                   assistant(self.start + timedelta(minutes=2), name + "x",
                             model="claude-sonnet-5", inp=1000)
                   + assistant(self.start + timedelta(minutes=6), name + "y",
                               model="claude-sonnet-5", inp=1000))
        self.plan()
        code, out, _err = self.bud("check", "--phase", "detect", "--now", self.at(7))
        self.assertEqual(code, 0)
        self.assertIn("WARNING: observed 2 subagents running at once; the cap is 1", out)


class ApplyReserveTests(BudgetCase):
    def test_apply_reserve_formula(self) -> None:
        self.assertEqual(B.apply_reserve(0, 1.0, 2.0, 10.0, False), 41)
        self.assertEqual(B.apply_reserve(6, 1.0, 2.0, 10.0, False), 53)
        self.assertEqual(B.apply_reserve(6, 1.0, 2.0, 10.0, True), 45)
        self.assertEqual(B.next_item_minutes(4, 0, 20.0, 1.0), 7.5)
        self.assertEqual(B.next_item_minutes(4, 0, 2.0, 1.0), 3.0)
        self.assertEqual(B.next_item_minutes(1, 0, 5.0, 1.0), 10.0)

    def test_apply_not_stopped_by_plan_time_infeasibility(self) -> None:
        self.marker(budget={"max_minutes": 30})
        self.baseline(6)
        self.init()
        data = self.plan()
        self.assertFalse(data["flags"]["apply_feasible"])
        code, out, _err = self.bud("check", "--phase", "apply", "--now", self.at(2))
        self.assertEqual(code, 0, out)
        self.assertIn("apply open", out)
        self.assertIsNotNone(self.data()["apply_started"])

    def test_apply_closes_when_the_final_check_would_not_fit(self) -> None:
        self.marker(budget={"max_minutes": 30})
        self.baseline(6)
        self.init()
        self.plan()
        code, out, _err = self.bud("check", "--phase", "apply", "--now", self.at(25))
        self.assertEqual(code, 1, out)
        self.assertIn("no time for Apply", out)
        self.assertIn("start no new item", out)
        self.assertEqual(self.data()["stops"]["apply"]["reason"], "no time for Apply")

    def test_revert_cap(self) -> None:
        self.assertEqual([B.revert_cap(n) for n in (0, 24, 25, 26, 49, 50, 80)],
                         [5, 5, 5, 6, 10, 10, 10])
        self.marker()
        for i in range(3):
            _write(self.repo / "src" / "n{}.py".format(i), "n = {}\n".format(i))
            _git(self.repo, "add", "-A")
            _git(self.repo, "commit", "-q", "-m", "n{}".format(i))
        code, out, _err = self.bud("revert-cap")
        self.assertEqual((code, out.strip()), (0, "5"))
        self.assertEqual(B.commit_count(self.repo, self.base), 3)
        self.marker(base_sha="")
        code, _out, err = self.bud("revert-cap")
        self.assertEqual(code, 2)
        self.assertIn("no --base", err)


class SubagentSpendTests(BudgetCase):
    def test_subagent_transcripts_found_next_to_the_main_transcript(self) -> None:
        self.assertEqual(C.subagent_transcripts(self.transcript), [])
        subdir = self.tmp / "sessions" / "abc123" / "subagents"
        _write(subdir / "agent-b.jsonl", "")
        _write(subdir / "agent-a.jsonl", "")
        _write(subdir / "notes.txt", "")
        self.assertEqual([p.name for p in C.subagent_transcripts(self.transcript)],
                         ["agent-a.jsonl", "agent-b.jsonl"])

    def test_subagent_spend_read_from_subagents_dir(self) -> None:
        self.marker()
        self.init()
        self.speak(assistant(self.start + timedelta(minutes=1), "m", inp=1000000),
                   assistant(self.start + timedelta(minutes=2), "side", inp=1000000,
                             sidechain=True))
        _write(self.tmp / "sessions" / "abc123" / "subagents" / "agent-a1.jsonl",
               assistant(self.start + timedelta(minutes=2), "s", model="claude-sonnet-5",
                         inp=1000000))
        code, out, _err = self.bud("spend", "--json")
        self.assertEqual(code, 0)
        spend = json.loads(out)
        self.assertEqual(spend["subagents"], 1)
        self.assertAlmostEqual(spend["main_usd"], 4.0, places=4)
        self.assertAlmostEqual(spend["subagents_usd"], 2.0, places=4)
        self.assertAlmostEqual(spend["usd"], 6.0, places=4)
        self.assertEqual(spend["pass_model_observed"], "claude-sonnet-5")
        self.assertEqual(spend["session_model"], "claude-opus-5-5")

    def test_recorded_subagent_without_usage_gets_a_prior(self) -> None:
        self.marker()
        self.init()
        ledger = self.ledger()
        ledger["passes"].append({"id": "P1", "lens": "security", "pass": 1,
                                 "subagent_id": "ghost"})
        (self.repo / lg.LEDGER_REL).write_bytes(json.dumps(ledger).encode("utf-8"))
        code, out, _err = self.bud("spend", "--json")
        self.assertEqual(code, 0)
        spend = json.loads(out)
        self.assertAlmostEqual(spend["usd"], B.SUBAGENT_USD_PRIOR, places=4)
        self.assertFalse(spend["known"])

    def test_spend_never_prints_message_text(self) -> None:
        self.marker(budget={"max_usd": 50})
        self.init()
        self.speak(assistant(self.start + timedelta(minutes=1), "m", inp=1000))
        _write(self.tmp / "sessions" / "abc123" / "subagents" / "agent-a1.jsonl",
               assistant(self.start + timedelta(minutes=2), "s", inp=1000))
        outputs = [self.bud("spend")[1], self.bud("spend", "--json")[1],
                   self.bud("plan", "--lenses", "security", "--json", "--now", self.at(3))[1],
                   self.bud("check", "--phase", "detect", "--json", "--now", self.at(4))[1]]
        for text in outputs:
            self.assertNotIn(SECRET, text)
        for path in (self.repo / ".harden").rglob("*"):
            if path.is_file():
                self.assertNotIn(SECRET.encode("utf-8"), path.read_bytes(), str(path))

    def test_spend_cache_reused_within_five_minutes(self) -> None:
        self.marker()
        self.init()
        self.speak(assistant(self.start + timedelta(minutes=1), "a", inp=1000000))
        self.plan()
        self.speak(assistant(self.start + timedelta(minutes=2), "b", inp=1000000))
        code, out, _err = self.bud("check", "--phase", "detect", "--json", "--now", self.at(3))
        self.assertEqual(code, 0)
        self.assertAlmostEqual(json.loads(out)["spend"], 4.0, places=4)
        code, out, _err = self.bud("spend", "--json")
        self.assertAlmostEqual(json.loads(out)["usd"], 8.0, places=4)
        self.speak(assistant(self.start + timedelta(minutes=3), "c", inp=1000000))
        cache_path = self.repo / B.CACHE_REL
        cache = json.loads(cache_path.read_bytes().decode("utf-8"))
        cache["computed"] = time.time() - 400
        cache_path.write_bytes(json.dumps(cache).encode("utf-8"))
        code, out, _err = self.bud("check", "--phase", "detect", "--json", "--now", self.at(4))
        self.assertAlmostEqual(json.loads(out)["spend"], 12.0, places=4)

    def test_runs_without_site_packages(self) -> None:
        self.marker()
        self.init()
        for args in (["revert-cap"], ["plan", "--lenses", "security", "--now", self.at(1)],
                     ["check", "--phase", "detect", "--now", self.at(2)], ["spend"]):
            proc = subprocess.run([sys.executable, "-S", str(SCRIPT), *args, "--repo",
                                   str(self.repo)], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, check=False)
            self.assertEqual(proc.returncode, 0, proc.stderr.decode(errors="replace"))


class PlanItemTests(BudgetCase):
    COSTS = {"a_usd": 2.0, "a_min": 2.0, "c_usd": 1.0, "c_min": 1.0}

    def test_oversized_unit_scales_item_cost(self) -> None:
        units = [{"id": "big", "kind": "slice", "tier": None, "est_tokens": 60000},
                 {"id": "small", "kind": "slice", "tier": None, "est_tokens": 1000}]
        items = B.plan_items(units, ["security"], "single", False, self.COSTS)
        cost = {i["unit"]: i["usd"] for i in items}
        self.assertEqual(cost, {"big": 6.0, "small": 2.0})

    def test_unassigned_files_get_a_sweep_unit(self) -> None:
        self.marker()
        self.init()
        code, _out, err = self.lg("unit", "--id", "core", "--kind", "slice", "--tier",
                                  "trust-boundary", "--files", "src/app.py")
        self.assertEqual(code, 0, err)
        self.plan()
        sweep = lg.find_unit(self.ledger(), B.SWEEP_UNIT)
        assert sweep is not None
        paths = [f["path"] for f in sweep["files"]]
        self.assertNotIn("src/app.py", paths)
        self.assertIn("src/util.py", paths)
        self.assertEqual(sweep["kind"], "sweep")
        progress = (self.repo / ".harden" / "progress.md").read_bytes().decode("utf-8")
        self.assertIn("budget:", progress)
        self.assertIn(B.SWEEP_UNIT, {i["unit"] for i in self.data()["detect_plan"]["items"]})

    def test_plan_holds_only_minimum_passes(self) -> None:
        self.marker(detection={"lens_bundles": "single"})
        self.init()
        self.lg("unit", "--id", "core", "--kind", "slice", "--tier", "trust-boundary",
                "--files", "src/app.py")
        items = self.plan()["detect_plan"]["items"]
        core = [i for i in items if i["unit"] == "core"]
        rest = [i for i in items if i["unit"] == B.SWEEP_UNIT]
        self.assertEqual(items[0]["unit"], "core")
        self.assertEqual(sorted({i["pass"] for i in core}), [1, 2, 3])
        self.assertEqual(sum(1 for i in core if i["lenses"] == [lg.EXPLORATION]), 1)
        self.assertEqual(len(core), 7)
        self.assertEqual(sorted((i["pass"], i["lenses"][0]) for i in rest),
                         [(1, "dead-code"), (1, "security")])

    def test_cheaper_pass_model_plans_five_passes_on_trust_units(self) -> None:
        self.marker(detection={"lens_bundles": "single", "pass_model": "haiku"})
        self.init()
        self.lg("unit", "--id", "core", "--kind", "slice", "--tier", "hotspot",
                "--files", "src/app.py")
        self.speak(assistant(self.start + timedelta(minutes=1), "m", inp=10))
        data = self.plan()
        self.assertTrue(data["detection"]["pass_model_cheaper"])
        core = [i for i in data["detect_plan"]["items"] if i["unit"] == "core"]
        self.assertEqual(max(i["pass"] for i in core), 5)
        self.assertEqual(len(core), 3 + 4 * 2)

    def test_auto_picks_grouped_when_single_passes_do_not_fit(self) -> None:
        lenses = ",".join(lens for row in B.BUNDLES for lens in row)
        for minutes, expected in ((120, "grouped"), (2880, "single")):
            with self.subTest(max_minutes=minutes):
                path = self.repo / B.BUDGET_REL
                if path.exists():
                    path.unlink()
                self.marker(budget={"max_minutes": minutes})
                if not (self.repo / lg.LEDGER_REL).exists():
                    self.init()
                    self.lg("unit", "--id", "core", "--kind", "slice", "--tier",
                            "trust-boundary", "--files", "src/app.py")
                code, out, err = self.bud("plan", "--lenses", lenses, "--now", self.at(1))
                self.assertEqual(code, 0, out + err)
                data = self.data()
                self.assertIsNone(data["max_usd"])
                self.assertTrue(data["max_usd_source"].startswith("none"))
                self.assertEqual(data["detection"]["lens_bundles"], expected)
                self.assertEqual(data["detection"]["lens_bundles_requested"], "auto")
                for item in data["detect_plan"]["items"]:
                    self.assertLessEqual(len(item["lenses"]), lg.MAX_BUNDLE)

    def test_grouped_mode_bundles_at_most_three_and_keeps_security_alone_on_trust(self) -> None:
        groups = B.groups_for(["security", "web3", "ops-config", "dead-code", "duplication"],
                              "grouped", True)
        self.assertEqual(groups, [["security"], ["web3"], ["ops-config"],
                                  ["dead-code", "duplication"]])
        groups = B.groups_for(["security", "ops-config", "tests"], "grouped", False)
        self.assertEqual(groups, [["security", "ops-config"], ["tests"]])
        for row in B.BUNDLES:
            self.assertLessEqual(len(row), lg.MAX_BUNDLE)


class LensModelPriceTests(BudgetCase):
    """The per-pass priors are re-priced for the lens model the run uses (pilot-auto-calibration
    A01-F41; round 3, R1-23)."""

    def test_opus_lens_passes_cost_at_least_twice_the_haiku_prior(self) -> None:
        opus = B.pass_cost_priors("claude-opus-5-5")
        haiku = B.pass_cost_priors("claude-haiku-4-5-20251001")
        self.assertEqual(haiku["pass_usd"], B.PASS_USD)
        self.assertGreaterEqual(opus["pass_usd"], 2 * haiku["pass_usd"])
        self.assertGreaterEqual(opus["gap_pass_usd"], 2 * haiku["gap_pass_usd"])

    def test_plan_uses_the_probed_lens_model(self) -> None:
        self.marker(detection={"lens_bundles": "single"})
        self.init()
        (self.repo / ".harden" / "agents.json").write_text(
            json.dumps({"status": "pass", "lens": {"model": "claude-opus-5-5"}}),
            encoding="utf-8")
        data = self.plan()
        priors = data["detect_plan"]["priors"]
        self.assertEqual((priors["lens_model"], priors["lens_model_source"]),
                         ("claude-opus-5-5", ".harden/agents.json (agent probe)"))
        self.assertGreaterEqual(priors["pass_usd"], 2 * B.PASS_USD)
        progress = (self.repo / ".harden" / "progress.md").read_text(encoding="utf-8")
        self.assertIn("a pass and USD", progress)
        self.assertIn("lens model claude-opus-5-5", progress)

    def test_without_a_probe_the_template_model_is_assumed(self) -> None:
        self.marker(detection={"lens_bundles": "single"})
        self.init()
        data = self.plan()
        self.assertEqual(data["detect_plan"]["priors"]["lens_model"], "claude-opus-5-5")


# ---------------------------------------------------------------------------
# Verify/apply cycles, the verification window, the verify plan and reproduction attempts
# (pilot-auto-calibration A01-F50 to A01-F52)
# ---------------------------------------------------------------------------


class ReflowCase(BudgetCase):
    """Shared numeric setup: baseline 6 s (g = 0.1), no fresh-clone record (gc = 0.2), plan at
    minute 1 (deadline at minute 120, report 10 min); 100 demonstrable candidates in their own
    files give 25 tasks of 5.4 minutes."""

    def cand(self, cid: str, file: str, line: int, end: Optional[int] = None,
             sev: str = "medium", tier: str = "T1", cls: str = "behavioural",
             rule: str = "ER-01", conf: str = "inference", status: str = "candidate",
             verified: bool = False, blocking: Optional[bool] = None) -> Dict[str, Any]:
        entry: Dict[str, Any] = {"id": cid, "file": file, "line": line, "severity": sev,
                                 "tier": tier, "class": cls, "rule_ref": rule,
                                 "confidence": conf, "status": status, "verified": verified,
                                 "title": "t " + cid}
        if end is not None:
            entry["end_line"] = end
        if blocking is not None:
            entry["blocking"] = blocking
        return entry

    def write_findings(self, entries: List[Dict[str, Any]], name: str = "candidates.json"
                       ) -> None:
        _write(self.repo / ".harden" / name, json.dumps({"version": 1, "findings": entries}))

    def vplan(self, *extra: str, now: float = 1.0) -> Tuple[int, str, str]:
        return self.bud("verify-plan", "--now", self.at(now), *extra)

    def plan_data(self) -> Dict[str, Any]:
        return json.loads((self.repo / B.VERIFY_PLAN_REL).read_bytes().decode("utf-8"))

    def prompt(self, tid: str) -> None:
        _write(self.repo / ".harden" / "prompts" / (tid + ".md"),
               "pass-id: {}\nkind: verifier\n".format(tid))

    def verdict(self, tid: str, start_min: float, end_min: float, n: int) -> None:
        def ms(minutes: float) -> str:
            dt = self.start + timedelta(minutes=minutes)
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + "328Z"
        _write(self.repo / ".harden" / "verifiers" / (tid + ".meta.json"),
               json.dumps({"pass_id": tid, "observed": {"started": ms(start_min),
                                                        "ended": ms(end_min)}}))
        _write(self.repo / ".harden" / "verifiers" / (tid + ".result.json"),
               json.dumps({"pass_id": tid, "verdicts": [{} for _ in range(n)]}))

    def phases(self, records: List[Tuple[int, str, float]]) -> None:
        key = "{}|{}".format(self.base, z(self.start))
        _write(self.repo / ".harden" / "phases.json", json.dumps({"phases": [
            {"phase": ph, "event": ev, "ts": self.at(minute), "run": key}
            for ph, ev, minute in records]}))

    def commits(self, k: int) -> None:
        for i in range(k):
            _write(self.repo / "src" / "c{}.py".format(i), "c = {}\n".format(i))
            _git(self.repo, "add", "-A")
            _git(self.repo, "commit", "-q", "-m", "c{}".format(i))

    def shared(self, mode: str = "auto", **marker: Any) -> None:
        self.marker(mode=mode, **marker)
        self.init()
        self.baseline(6)
        self.plan()
        self.write_findings([self.cand("H-{:03d}".format(i), "src/f{:03d}.ts".format(i), 10)
                             for i in range(100)])
        code, out, err = self.vplan()
        self.assertEqual(code, 0, out + err)

    def check(self, phase: str, minute: float, *extra: str) -> Tuple[int, Dict[str, Any], str]:
        code, out, err = self.bud("check", "--phase", phase, "--now", self.at(minute), "--json",
                                  *extra)
        try:
            result = json.loads(out)
        except ValueError:
            result = {}
        return code, result, out + err

    def progress(self) -> str:
        path = self.repo / ".harden" / "progress.md"
        return path.read_bytes().decode("utf-8") if path.exists() else ""

    def at_min(self, value: Optional[str]) -> float:
        parsed = B.parse_iso(value)
        assert parsed is not None
        return round((parsed - self.start).total_seconds() / 60.0, 2)


class VerifyPlanTests(ReflowCase):
    def test_mechanical_rules_match_the_tier_table(self) -> None:
        text = (SCRIPTS.parent / "references" / "prioritization.md").read_bytes().decode("utf-8")
        rules: set = set()
        for line in text.splitlines():
            m = re.match(r"^\|\s*(\d+)\s*\|[^|]*\|([^|]*)\|", line)
            if m and int(m.group(1)) in (1, 3, 4, 5, 7, 8, 17):
                rules |= set(re.findall(r"[A-Z]{2}-\d{2}", m.group(2)))
        self.assertEqual(rules, set(B.MECHANICAL_RULES))

    def test_rungs_follow_tier_class_and_rule(self) -> None:
        cases = [(("T1", "structural", "DC-21"), 0), (("T0", "structural", "TS-06"), 0),
                 (("T1", "behavioural", "ER-17"), 1), (("T1", "structural", "CX-10"), 1),
                 (("T2", "structural", "RD-13"), 2), (("T1", "report-only", "ER-01"), 2),
                 (("T1", "structural", "RD-25"), 1)]
        for (tier, cls, rule), rung in cases:
            with self.subTest(rule=rule, tier=tier, cls=cls):
                self.assertEqual(B.candidate_rung({"tier": tier, "class": cls,
                                                   "rule_ref": rule}), rung)

    def test_lens_aliases_at_overlapping_lines_form_one_cluster(self) -> None:
        cands = [self.cand("H-004", "src/engine.ts", 108, 113),
                 self.cand("H-004-op", "src/engine.ts", 110),
                 self.cand("H-004-ai", "src/engine.ts", 108, 113),
                 self.cand("H-099", "src/big.ts", 1, 200), self.cand("H-010", "src/big.ts", 150)]
        clusters = [[c["id"] for c in group] for group in B.cluster_candidates(cands)]
        self.assertEqual(clusters, [["H-004", "H-004-op", "H-004-ai"], ["H-099"], ["H-010"]])

    def test_plan_orders_consequence_then_mechanical_then_by_fixability(self) -> None:
        self.marker()
        self.init()
        self.plan()
        self.write_findings([
            self.cand("H-A", "F1", 1, sev="high"),
            self.cand("H-B", "F2", 1, sev="nit", cls="structural", rule="AI-24"),
            self.cand("H-C", "F3", 1, sev="low", cls="structural", rule="DC-21"),
            self.cand("H-D", "F4", 1, sev="medium"),
            self.cand("H-F", "F6", 1, sev="medium", conf="tool_high_precision"),
            self.cand("H-E", "F5", 1, sev="low", tier="T2", cls="report-only")])
        code, out, err = self.vplan()
        self.assertEqual(code, 0, out + err)
        tasks = self.plan_data()["cycles"]["1"]["tasks"]
        self.assertEqual([t["kind"] for t in tasks],
                         ["consequence", "mechanical", "demonstrable", "owner"])
        demo = tasks[2]["candidates"]
        self.assertLess(demo.index("H-F"), demo.index("H-D"))
        self.assertEqual(sorted(tasks[1]["candidates"]), ["H-B", "H-C"])
        self.assertIn("first wave: v1-01, v1-02, v1-03, v1-04", out)

    def test_mechanical_task_joins_the_first_wave(self) -> None:
        cands = [self.cand("H-{:02d}".format(i), "src/h{:02d}.ts".format(i), 1, sev="high")
                 for i in range(13)]
        cands.append(self.cand("H-M", "src/m.ts", 1, sev="low", cls="structural",
                               rule="RD-13"))
        tasks = B.pack_tasks(B.cluster_candidates(cands), 4)
        self.assertEqual([t["kind"] for t in tasks],
                         ["consequence"] * 3 + ["mechanical", "consequence"])

    def test_task_size_limits(self) -> None:
        cands: List[Dict[str, Any]] = []
        for i in range(40):
            for alias in ("", "-ai", "-rd"):
                cands.append(self.cand("H-{:02d}{}".format(i, alias), "src/m{:02d}.ts".format(i),
                                       5, sev="low", cls="structural", rule="RD-13"))
        tasks = B.pack_tasks(B.cluster_candidates(cands), 4)
        self.assertEqual([(len(t["clusters"]), len(t["candidates"])) for t in tasks],
                         [(8, 24)] * 5)
        demo = [self.cand("H-{:02d}".format(i), "src/one.ts", 100 * (i + 1)) for i in range(10)]
        tasks = B.pack_tasks(B.cluster_candidates(demo), 4)
        self.assertEqual([len(t["clusters"]) for t in tasks], [4, 4, 2])

    def test_task_ids_estimates_and_need(self) -> None:
        self.marker()
        self.init()
        self.plan()
        cands = [self.cand("M-{:02d}".format(i), "src/m{:02d}.ts".format(i), 1, sev="low",
                           cls="structural", rule="DC-13") for i in range(8)]
        cands += [self.cand("D-{:02d}".format(i), "src/d{:02d}.ts".format(i), 1)
                  for i in range(4)]
        self.write_findings(cands)
        self.assertEqual(self.vplan()[0], 0)
        cycle = self.plan_data()["cycles"]["1"]
        tasks = cycle["tasks"]
        self.assertEqual([t["id"] for t in tasks], ["v1-01", "v1-02"])
        est = {t["kind"]: t["est_minutes"] for t in tasks}
        self.assertAlmostEqual(est["mechanical"], 7.6, places=2)
        self.assertAlmostEqual(est["demonstrable"], 5.4, places=2)
        self.assertEqual(cycle["need_minutes"], round(1.25 * (7.6 + 5.4) / 4, 2))

    def test_cycle_two_plans_only_unverified_deferred_findings(self) -> None:
        self.marker()
        self.init()
        self.plan()
        data = self.data()
        data["cycles"] = [{"n": 1, "opened": self.at(1)}, {"n": 2, "opened": self.at(70)}]
        (self.repo / B.BUDGET_REL).write_bytes(json.dumps(data).encode("utf-8"))
        self.write_findings([
            self.cand("H-1", "a.ts", 1, status="applied", verified=True),
            self.cand("H-2", "b.ts", 1, status="reported", verified=True),
            self.cand("H-3", "c.ts", 1, status="deferred"),
            self.cand("H-4", "d.ts", 1, status="deferred"),
            self.cand("H-5", "e.ts", 1, status="deferred"),
            self.cand("H-6", "f.ts", 1, status="deferred", verified=True),
            self.cand("H-7", "g.ts", 1, status="rejected")], name="findings.json")
        code, out, err = self.vplan("--cycle", "2", now=71)
        self.assertEqual(code, 0, out + err)
        tasks = self.plan_data()["cycles"]["2"]["tasks"]
        self.assertEqual(sorted(c for t in tasks for c in t["candidates"]),
                         ["H-3", "H-4", "H-5"])
        self.assertTrue(all(t["id"].startswith("v2-") for t in tasks))

    def test_cycle_must_be_open_before_its_plan(self) -> None:
        self.marker()
        self.init()
        self.plan()
        self.write_findings([self.cand("H-3", "c.ts", 1, status="deferred")],
                            name="findings.json")
        code, _out, err = self.vplan("--cycle", "2")
        self.assertEqual(code, 2)
        self.assertIn("check --phase cycle", err)

    def test_plan_kept_until_replan_and_launched_tasks_kept(self) -> None:
        self.marker()
        self.init()
        self.baseline(6)
        self.plan()
        cands = [self.cand("H-{:02d}".format(i), "src/f{:02d}.ts".format(i), 1) for i in range(8)]
        self.write_findings(cands)
        self.assertEqual(self.vplan()[0], 0)
        first = self.plan_data()["cycles"]["1"]
        self.assertEqual(self.vplan(now=2)[0], 0)
        self.assertEqual(self.plan_data()["cycles"]["1"]["computed"], first["computed"])
        code, _result, text = self.check("verify", 40, "--task", "v1-01")
        self.assertEqual(code, 0, text)
        self.prompt("v1-02")  # a task file, never launched: planned again
        self.write_findings(cands + [self.cand("H-99", "src/new.ts", 1)])
        code, out, err = self.vplan("--replan", now=41)
        self.assertEqual(code, 0, out + err)
        tasks = self.plan_data()["cycles"]["1"]["tasks"]
        self.assertEqual(tasks[0], first["tasks"][0])
        kept = set(first["tasks"][0]["candidates"])
        others = [c for t in tasks[1:] for c in t["candidates"]]
        self.assertFalse(kept & set(others))
        self.assertIn("H-99", others)
        self.assertEqual([t["id"] for t in tasks[1:]],
                         ["v1-{:02d}".format(i) for i in range(2, len(tasks) + 1)])

    def test_verify_plan_runs_without_site_packages(self) -> None:
        self.marker()
        self.init()
        self.plan()
        self.write_findings([self.cand("H-1", "a.ts", 1)])
        proc = subprocess.run([sys.executable, "-S", str(SCRIPT), "verify-plan", "--repo",
                               str(self.repo), "--now", self.at(2)], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode(errors="replace"))


class VerifyWindowTests(ReflowCase):
    def test_verify_window_starts_when_verification_starts(self) -> None:
        self.shared()
        code, result, text = self.check("verify", 40)
        self.assertEqual(code, 0, text)
        sizing = result["sizing"]
        self.assertAlmostEqual(sizing["available"], 52.0, places=2)
        self.assertAlmostEqual(sizing["repro_reserve"], 7.8, places=2)
        self.assertAlmostEqual(sizing["need_verify"], 42.19, places=2)
        self.assertAlmostEqual(sizing["need_apply"], 25.0, places=2)
        self.assertAlmostEqual(sizing["window"], 27.75, places=2)
        cyc = self.data()["cycles"][0]
        self.assertEqual(self.at_min(cyc["verify_end"]), 67.75)
        self.assertGreater(self.at_min(cyc["verify_end"]),
                           self.at_min(self.data()["windows"]["verify_end"]))
        self.assertAlmostEqual(self.at_min(self.data()["windows"]["verify_end"]), 47.6, places=1)
        self.assertEqual(self.at_min(cyc["repro_end"]), round(67.75 + 7.8, 2))
        self.assertIn("cycle 1 verification until", self.progress())

    def test_verify_closes_when_the_next_task_does_not_fit(self) -> None:
        self.shared()
        self.check("verify", 40)
        code, _result, text = self.check("verify", 62.0)
        self.assertEqual(code, 0, text)
        code, _result, text = self.check("verify", 62.8)
        self.assertEqual(code, 1, text)
        code2, out, _err = self.bud("check", "--phase", "verify", "--now", self.at(62.9))
        self.assertIn("(time)", out)
        self.assertIsInstance(self.data()["cycles"][0].get("verify_closed"), dict)
        self.assertEqual(self.progress().count("verify window of cycle 1 closed"), 1)

    def test_verify_names_the_next_unlaunched_task(self) -> None:
        self.shared()
        for tid in ("v1-01", "v1-02"):
            code, _result, text = self.check("verify", 40, "--task", tid)
            self.assertEqual(code, 0, text)
        self.assertEqual(sorted(self.data()["cycles"][0]["launched"]), ["v1-01", "v1-02"])
        _code, out, _err = self.bud("check", "--phase", "verify", "--now", self.at(40))
        self.assertIn("next: task v1-03", out)
        for task in self.plan_data()["cycles"]["1"]["tasks"]:
            self.prompt(task["id"])
        _code, out, _err = self.bud("check", "--phase", "verify", "--now", self.at(40))
        self.assertIn("next: task v1-03", out)
        code, _out, err = self.bud("check", "--phase", "verify", "--task", "v1-01", "--now",
                                   self.at(40))
        self.assertEqual(code, 2)
        self.assertIn("was launched", err)
        code, _out, err = self.bud("check", "--phase", "verify", "--task", "v9-99", "--now",
                                   self.at(40))
        self.assertEqual(code, 2)
        self.assertIn("not in the verify plan", err)
        for task in self.plan_data()["cycles"]["1"]["tasks"][2:]:
            self.assertEqual(self.check("verify", 40, "--task", task["id"])[0], 0)
        code, out, _err = self.bud("check", "--phase", "verify", "--now", self.at(41))
        self.assertEqual(code, 0, out)
        self.assertIn("every planned task", out)

    def test_measured_throughput_replaces_the_priors(self) -> None:
        self.shared()
        self.verdict("v1-01", 0, 4, 4)
        self.verdict("v1-02", 0, 6, 4)
        code, result, text = self.check("verify", 40)
        self.assertEqual(code, 0, text)
        self.assertAlmostEqual(result["rates"]["other"], 1.25, places=3)
        self.assertAlmostEqual(result["rates"]["mechanical"], 0.880, places=3)
        self.assertAlmostEqual(result["task_minutes"], 5.0, places=2)
        self.assertEqual(result["rates"]["source"], "measured over 2 verifier tasks")

    def test_report_only_verification_uses_all_available_time(self) -> None:
        self.shared(mode="report-only")
        code, result, text = self.check("verify", 40)
        self.assertEqual(code, 0, text)
        self.assertAlmostEqual(result["sizing"]["window"], result["sizing"]["available"])
        self.assertAlmostEqual(result["sizing"]["available"], 68.0, places=2)
        self.assertEqual(result["sizing"]["repro_reserve"], 0)

    def test_no_window_when_the_final_reserve_is_reached(self) -> None:
        self.shared()
        code, result, text = self.check("verify", 95)
        self.assertEqual(code, 1, text)
        self.assertEqual(result["reason"], "time")
        self.assertEqual(result["sizing"]["window"], 0)

    def test_without_a_verify_plan_the_planned_minutes_are_used(self) -> None:
        self.marker()
        self.init()
        self.baseline(6)
        self.plan()
        code, out, _err = self.bud("check", "--phase", "verify", "--now", self.at(40))
        self.assertEqual(code, 0, out)
        self.assertIn("NOTE: no .harden/tools/verify-plan.json", out)
        self.assertAlmostEqual(self.data()["cycles"][0]["sizing"]["window"], 14.4, places=2)
        self.write_findings([self.cand("H-1", "a.ts", 1)])
        self.assertEqual(self.vplan(now=40.5)[0], 0)
        self.check("verify", 41)
        sizing = self.data()["cycles"][0]["sizing"]
        self.assertEqual(sizing.get("resized_at"), self.at(41))
        self.assertIsNotNone(sizing["need_verify"])
        self.check("verify", 42)
        self.assertEqual(self.data()["cycles"][0]["sizing"].get("resized_at"), self.at(41))

    def test_repro_reserve_never_takes_the_only_verification_task(self) -> None:
        self.shared()
        code, result, text = self.check("verify", 84)
        self.assertEqual(code, 0, text)
        self.assertEqual(result["sizing"]["repro_reserve"], 0)
        self.assertAlmostEqual(result["sizing"]["window"], 8.0, places=2)
        self.assertEqual(self.at_min(self.data()["cycles"][0]["verify_end"]), 92.0)

    def test_task_flag_is_only_for_verify(self) -> None:
        self.shared()
        code, _out, err = self.bud("check", "--phase", "apply", "--task", "v1-01", "--now",
                                   self.at(40))
        self.assertEqual(code, 2)
        self.assertIn("--task is only for --phase verify", err)


class ReproTests(ReflowCase):
    CMD = "node node_modules/vitest/vitest.mjs run tests/repro-H-003.test.ts"

    def setUp(self) -> None:
        super().setUp()
        self.scratch = self.tmp / "scratch"
        self.scratch.mkdir()

    def ready(self, **marker: Any) -> None:
        self.shared(scratch_dir=str(self.scratch), **marker)
        self.write_findings([self.cand("H-003", "src/a.ts", 3), self.cand("H-080", "src/b.ts", 8)])
        self.check("verify", 40)

    def repro(self, minute: float, *extra: str, rid: str = "H-003") -> Tuple[int, str, str]:
        return self.bud("repro", "--id", rid, "--now", self.at(minute), *extra)

    def config(self, forbidden: Optional[List[str]] = None) -> None:
        _write(self.repo / ".harden" / "config.json", json.dumps({
            "env_policy": "allowlist", "gates": [
                {"name": "test", "cmd": "pnpm test", "inherit_env": False,
                 "env_allowlist": ["PATH", "SYSTEMROOT"], "env": {"CI": "1"},
                 "count_regex": "(\\d+) passed"}]}))

    def worktree(self, name: str = "tests/repro-H-003.test.ts",
                 text: str = "import { it, expect } from 'vitest';\nit('r', () => { "
                             "expect(1).toBe(2); });\n") -> Path:
        wt = self.scratch / "repro"
        if not wt.exists():
            _git(self.repo, "worktree", "add", "-q", "--detach", str(wt), self.base)
        _write(wt / name, text)
        return wt

    def attempt(self) -> Dict[str, Any]:
        return self.data()["repro"]["H-003"]

    def test_repro_attempt_is_once_and_capped(self) -> None:
        self.ready()
        code, out, err = self.repro(41, "--json")
        self.assertEqual(code, 0, out + err)
        self.assertAlmostEqual(json.loads(out)["cap_minutes"], 5.2, places=2)
        self.assertEqual(self.repro(45)[0], 0)
        code, out, _err = self.repro(46.5)
        self.assertEqual(code, 1)
        self.assertIn("cap spent", out)
        self.assertEqual(self.attempt()["outcome"], "cap")
        code, out, _err = self.repro(47)
        self.assertEqual(code, 1)
        self.assertIn("one attempt", out)

    def test_repro_done_records_outcome_and_progress(self) -> None:
        self.ready()
        self.config()
        self.assertEqual(self.repro(41)[0], 0)
        self.worktree()
        code, out, err = self.repro(41.5, "--cmd", self.CMD)
        self.assertEqual(code, 0, out + err)
        code, _out, err = self.repro(42, "--done", "reproduced")
        self.assertEqual(code, 2)
        self.assertIn("no gates.py record", err)
        import gates as G
        gate_config = json.loads((self.repo / ".harden" / "gates" / "repro" /
                                  "H-003-1.gate.json").read_bytes().decode("utf-8"))
        _write(self.repo / ".harden" / "gates" / "repro-H-003-1.json",
               json.dumps({"gates_sha256": G.gates_digest(gate_config["gates"])}))
        code, out, err = self.repro(42, "--done", "reproduced")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(self.attempt()["outcome"], "reproduced")
        self.assertIn("repro H-003: reproduced", self.progress())
        self.assertEqual(self.repro(43, "--done", "reproduced")[0], 1)

    def test_repro_window_closes_new_attempts(self) -> None:
        self.ready()
        code, out, _err = self.repro(71, rid="H-080")
        self.assertEqual(code, 1)
        self.assertIn("window of cycle 1 closed", out)
        data = self.data()
        self.assertNotIn("H-080", data.get("repro") or {})
        self.assertIn("H-080", data["repro_skipped"])
        self.assertEqual(self.repro(70, rid="H-080")[0], 0)

    def test_repro_cmd_writes_a_gate_config_with_the_test_gate_env(self) -> None:
        self.ready()
        self.config()
        self.assertEqual(self.repro(41)[0], 0)
        wt = self.worktree()
        code, out, err = self.repro(41, "--cmd", self.CMD)
        self.assertEqual(code, 0, out + err)
        path = self.repo / ".harden" / "gates" / "repro" / "H-003-1.gate.json"
        doc = json.loads(path.read_bytes().decode("utf-8"))
        self.assertEqual(len(doc["gates"]), 1)
        gate = doc["gates"][0]
        self.assertEqual(gate["name"], "repro-H-003")
        self.assertEqual(gate["inherit_env"], False)
        self.assertEqual(gate["env_allowlist"], ["PATH", "SYSTEMROOT"])
        self.assertEqual(gate["env"]["CI"], "1")
        self.assertEqual(gate["env"]["HTTPS_PROXY"], "http://127.0.0.1:9")
        self.assertIn("127.0.0.1", gate["env"]["NO_PROXY"])
        self.assertNotIn("count_regex", gate)
        self.assertTrue(30 <= gate["timeout_s"] <= 312, gate["timeout_s"])
        self.assertEqual(doc["env_policy"], "allowlist")
        repo_posix = C.to_posix(str(B.repo_root(str(self.repo))))
        self.assertIn('--config "{}/.harden/gates/repro/H-003-1.gate.json"'.format(repo_posix),
                      out)
        self.assertIn('--out-dir "{}/.harden/gates"'.format(repo_posix), out)
        self.assertIn('--repo "{}/repro"'.format(C.to_posix(str(self.scratch))), out)
        self.assertIn("--label repro-H-003-1", out)
        files = self.attempt()["commands"][0]["files"]
        digest = hashlib.sha256((wt / "tests" / "repro-H-003.test.ts").read_bytes()).hexdigest()
        self.assertEqual(files, {"tests/repro-H-003.test.ts": digest})
        code, out, err = self.repro(42, "--cmd", self.CMD)
        self.assertEqual(code, 0, out + err)
        self.assertIn("--label repro-H-003-2", out)

    def test_repro_refused_in_report_only_and_bad_ids(self) -> None:
        self.shared(mode="report-only")
        self.write_findings([self.cand("H-003", "src/a.ts", 3)])
        self.check("verify", 40)
        code, out, _err = self.repro(41)
        self.assertEqual(code, 1)
        self.assertIn("report-only", out)
        self.assertEqual(self.repro(41, rid="../x")[0], 2)

    def test_repro_needs_verification_started(self) -> None:
        self.shared()
        self.write_findings([self.cand("H-003", "src/a.ts", 3)])
        code, _out, err = self.repro(41)
        self.assertEqual(code, 2)
        self.assertIn("check --phase verify", err)

    def test_repro_cmd_refuses_shell_operators_inline_code_and_forbidden_commands(self) -> None:
        self.ready(forbidden_commands=["/node\\s+dist/cli\\.js\\s+value/i"])
        self.config()
        self.assertEqual(self.repro(41)[0], 0)
        for cmd in ("node a.ts; x", "node a.ts && x", "node a.ts | x", "node `x`",
                    "node $(cat f)", "node %X%", "node a.ts > o", "node -e x", "python -c x",
                    "bash -c x", "node -p x", "cmd /c x", "node tests\\a.ts", 'node "a',
                    "node dist/cli.js value"):
            with self.subTest(cmd=cmd):
                code, _out, err = self.repro(41.5, "--cmd", cmd)
                self.assertEqual(code, 2, err)
                self.assertFalse((self.repo / ".harden" / "gates" / "repro").exists())
                self.assertEqual(self.attempt()["commands"], [])

    def test_repro_cmd_scans_the_attempt_files(self) -> None:
        self.ready(forbidden_commands=["/node\\s+dist/cli\\.js\\s+value/i"])
        self.config()
        self.assertEqual(self.repro(41)[0], 0)
        wt = self.worktree("tests/r.test.ts", "require('child_process').execSync('echo')\n")
        code, _out, err = self.repro(41.5, "--cmd", "node tests/r.test.ts")
        self.assertEqual(code, 2)
        self.assertIn("tests/r.test.ts:1", err)
        (wt / "tests" / "r.test.ts").unlink()
        self.worktree("tests/r_test.py", "import subprocess\n")
        self.assertEqual(self.repro(41.5, "--cmd", "python -m pytest tests/r_test.py")[0], 2)
        (wt / "tests" / "r_test.py").unlink()
        self.worktree("tests/r2.test.ts", "// node dist/cli.js value\n")
        self.assertEqual(self.repro(41.5, "--cmd", "node tests/r2.test.ts")[0], 2)
        (wt / "tests" / "r2.test.ts").unlink()
        self.worktree("tests/ok.test.ts", "expect(1).toBe(2)\n")
        code, _out, err = self.repro(41.5, "--cmd", "node tests/other.test.ts")
        self.assertEqual(code, 2)
        self.assertIn("names none", err)

    def test_repro_cmd_refuses_shells_scripts_and_split_commands(self) -> None:
        # Review round 4: a shell script starts a process on every line, and a backslash line
        # continuation split `git push` over two lines past the line-by-line scan.
        self.ready(forbidden_commands=["/\\bgit\\s+push\\b/"])
        self.config()
        self.assertEqual(self.repro(41)[0], 0)
        wt = self.worktree("tests/r.sh", "git \\\n  push origin HEAD:main\n")
        for cmd in ("bash tests/r.sh", "sh tests/r.sh", "\"C:/Program Files/Git/bin/bash.exe\" "
                    "tests/r.sh", "env bash tests/r.sh", "make -f tests/r.sh",
                    "tests/r.sh", "node tests/r.sh bash", "pwsh -File tests/r.sh"):
            with self.subTest(cmd=cmd):
                code, _out, err = self.repro(41.5, "--cmd", cmd)
                self.assertEqual(code, 2, err)
                self.assertIn("shell", err)
        code, _out, err = self.repro(41.5, "--cmd", "node tests/r.sh")
        self.assertEqual(code, 2, err)
        self.assertIn("tests/r.sh is a shell script", err)
        (wt / "tests" / "r.sh").unlink()
        self.worktree("tests/r.test.ts", "#!/usr/bin/env bash\nexpect(1).toBe(2)\n")
        code, _out, err = self.repro(41.5, "--cmd", "node tests/r.test.ts")
        self.assertEqual(code, 2, err)
        self.assertIn("shell script", err)
        (wt / "tests" / "r.test.ts").unlink()
        self.worktree("tests/r2.test.ts", "const cmd = 'git \\\npush';\nexpect(1).toBe(2)\n")
        code, _out, err = self.repro(41.5, "--cmd", "node tests/r2.test.ts")
        self.assertEqual(code, 2, err)
        self.assertIn("forbidden command", err)
        (wt / "tests" / "r2.test.ts").unlink()
        for name, text in (("tests/r_test.py", "import asyncio\nasyncio.create_subprocess_exec"
                                                "('x')\n"),
                           ("r_test.go", "cmd := exec.Command(\"x\")\n"),
                           ("tests/r.rs", "std::process::Command::new(\"x\");\n"),
                           ("test/R.t.sol", "vm.ffi(inputs);\n")):
            with self.subTest(name=name):
                self.worktree(name, text)
                code, _out, err = self.repro(41.5, "--cmd", "node " + name)
                self.assertEqual(code, 2, err)
                self.assertIn("starts a process", err)
                (wt / name).unlink()
        self.assertEqual(self.attempt()["commands"], [])
        self.worktree()
        self.assertEqual(self.repro(41.5, "--cmd", self.CMD)[0], 0)

    def test_repro_cmd_refuses_tracked_edits_a_marker_copy_and_another_head(self) -> None:
        self.ready()
        self.config()
        self.assertEqual(self.repro(41)[0], 0)
        wt = self.worktree()
        _write(wt / "src" / "app.py", "changed = True\n")
        self.assertEqual(self.repro(41.5, "--cmd", self.CMD)[0], 2)
        _git(wt, "checkout", "-q", "--", "src/app.py")
        (wt / ".harden").mkdir()
        self.assertEqual(self.repro(41.5, "--cmd", self.CMD)[0], 2)
        (wt / ".harden").rmdir()
        _write(wt / "src" / "later.py", "x = 1\n")
        _git(wt, "add", "src/later.py")
        _git(wt, "commit", "-q", "-m", "later")
        code, _out, err = self.repro(41.5, "--cmd", self.CMD)
        self.assertEqual(code, 2)
        self.assertIn("not at the base commit", err)

    def test_repro_cmd_after_the_cap_writes_no_config(self) -> None:
        self.ready()
        self.config()
        self.assertEqual(self.repro(41)[0], 0)
        self.worktree()
        code, _out, _err = self.repro(46.5, "--cmd", self.CMD)
        self.assertEqual(code, 1)
        self.assertEqual(self.attempt()["outcome"], "cap")
        self.assertFalse((self.repo / ".harden" / "gates" / "repro" /
                          "H-003-1.gate.json").exists())

    def test_repro_ids_must_name_findings_and_are_compared_casefolded(self) -> None:
        self.ready()
        self.write_findings([self.cand("H-003", "src/a.ts", 3), self.cand("h-003", "src/c.ts", 3),
                             self.cand("NUL", "src/n.ts", 1)])
        self.assertEqual(self.repro(41, rid="H-999")[0], 2)
        self.assertEqual(self.repro(41, rid="NUL")[0], 2)
        self.assertEqual(self.repro(41)[0], 0)
        self.assertEqual(self.repro(42, "--done", "not-reproduced")[0], 0)
        code, out, _err = self.repro(43, rid="h-003")
        self.assertEqual(code, 1)
        self.assertIn("one attempt", out)

    def test_repro_done_reproduced_needs_an_unchanged_record(self) -> None:
        self.ready()
        self.config()
        self.assertEqual(self.repro(41)[0], 0)
        wt = self.worktree()
        self.assertEqual(self.repro(41, "--cmd", self.CMD)[0], 0)
        _write(self.repo / ".harden" / "gates" / "repro-H-003-1.json",
               json.dumps({"gates_sha256": "0" * 64}))
        self.assertEqual(self.repro(42, "--done", "reproduced")[0], 2)
        import gates as G
        gate_config = json.loads((self.repo / ".harden" / "gates" / "repro" /
                                  "H-003-1.gate.json").read_bytes().decode("utf-8"))
        _write(self.repo / ".harden" / "gates" / "repro-H-003-1.json",
               json.dumps({"gates_sha256": G.gates_digest(gate_config["gates"])}))
        _write(wt / "tests" / "repro-H-003.test.ts", "edited after registration\n")
        self.assertEqual(self.repro(42, "--done", "reproduced")[0], 2)
        self.assertEqual(self.repro(42, "--done", "not-reproduced")[0], 0)


class CycleTests(ReflowCase):
    def pilot_shape(self, **marker: Any) -> None:
        self.shared(**marker)
        self.check("verify", 40)
        self.prompt("v1-01")
        self.verdict("v1-01", 41, 45, 4)
        code, _result, text = self.check("apply", 60)
        self.assertIn(code, (0, 1), text)
        self.commits(8)
        self.write_findings([self.cand("H-{:03d}".format(i), "src/f{:03d}.ts".format(i), 10,
                                       status="deferred") for i in range(77)],
                            name="findings.json")

    def test_cycle_opens_with_deferred_candidates_and_time(self) -> None:
        self.pilot_shape()
        saved = (self.repo / B.BUDGET_REL).read_bytes()
        code, result, text = self.check("cycle", 78)
        self.assertEqual(code, 0, text)
        self.assertEqual(result["reserve_minutes"], 22)
        self.assertEqual(result["prio_minutes"], 10)
        self.assertEqual(result["task_minutes"], 6.5)
        cycles = self.data()["cycles"]
        self.assertEqual((cycles[1]["n"], cycles[1]["deferred"]), (2, 77))
        self.assertEqual(cycles[0]["apply_closed"]["commits"], 8)
        self.assertIn("cycle 2 opened", self.progress())
        (self.repo / B.BUDGET_REL).write_bytes(saved)
        code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(78))
        self.assertEqual(code, 0, out)
        self.assertIn("verify-plan --cycle 2", out)

    def test_no_cycle_reasons(self) -> None:
        with self.subTest(case="no deferred"):
            self.pilot_shape()
            self.write_findings([], name="findings.json")
            code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(78))
            self.assertEqual(code, 1)
            self.assertIn("no deferred candidate", out)
        with self.subTest(case="no verdict"):
            self.write_findings([self.cand("H-1", "a.ts", 1, status="deferred")],
                                name="findings.json")
            (self.repo / ".harden" / "verifiers" / "v1-01.result.json").unlink()
            code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(78))
            self.assertEqual(code, 1)
            self.assertIn("verified nothing", out)
        with self.subTest(case="time"):
            self.verdict("v1-01", 41, 45, 4)
            code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(85))
            self.assertEqual(code, 1)
            self.assertIn("(time)", out)
        with self.subTest(case="report-only"):
            self.marker(mode="report-only")
            code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(78))
            self.assertEqual(code, 1)
            self.assertIn("report-only", out)
        with self.subTest(case="advisory without deferred"):
            self.marker(mode="interactive")
            self.write_findings([], name="findings.json")
            code, _out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(78))
            self.assertEqual(code, 1)
        with self.subTest(case="advisory at 85"):
            self.write_findings([self.cand("H-1", "a.ts", 1, status="deferred")],
                                name="findings.json")
            code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(85))
            self.assertEqual(code, 0, out)
            self.assertIn("would close (time)", out)
            last = self.data()["cycles"][-1]
            self.assertEqual((last["n"], last["advisory_over"]), (2, "time"))

    def test_null_verdicts_are_no_progress(self) -> None:
        # A verifier that ran out of turns returns "verified": null for every candidate: that
        # cycle verified nothing, so it opens no further cycle (review round 4).
        self.pilot_shape()
        _write(self.repo / ".harden" / "verifiers" / "v1-01.result.json",
               json.dumps({"pass_id": "v1-01", "verdicts": [
                   {"id": "H-{:03d}".format(i), "verified": None} for i in range(4)]}))
        code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(78))
        self.assertEqual(code, 1, out)
        self.assertIn("verified nothing", out)
        _write(self.repo / ".harden" / "verifiers" / "v1-01.result.json",
               json.dumps({"pass_id": "v1-01", "verdicts": [
                   {"id": "H-000", "verified": None}, {"id": "H-001", "verified": False}]}))
        code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(78))
        self.assertEqual(code, 0, out)

    def test_cycle_never_cuts_the_final_reserve(self) -> None:
        self.pilot_shape()
        saved = (self.repo / B.BUDGET_REL).read_bytes()
        deadline = B.parse_iso(self.data()["windows"]["deadline"])
        assert deadline is not None
        codes = []
        for minute in range(60, 120, 2):
            (self.repo / B.BUDGET_REL).write_bytes(saved)
            code, result, text = self.check("cycle", minute)
            codes.append(code)
            if code == 0:
                now = self.start + timedelta(minutes=minute)
                need = result["prio_minutes"] + result["task_minutes"] + result["reserve_minutes"]
                self.assertLessEqual(now + timedelta(minutes=need), deadline, text)
        self.assertIn(0, codes)
        self.assertIn(1, codes)

    def test_apply_rate_pools_cycles(self) -> None:
        self.marker()
        self.init()
        self.baseline(6)
        self.plan()
        data = self.data()
        data["cycles"] = [
            {"n": 1, "opened": self.at(1),
             "apply_started": {"ts": self.at(60), "usd": 0, "commits": 0},
             "apply_closed": {"ts": self.at(70), "usd": 0, "commits": 4}},
            {"n": 2, "opened": self.at(75),
             "apply_started": {"ts": self.at(80), "usd": 0, "commits": 4}}]
        (self.repo / B.BUDGET_REL).write_bytes(json.dumps(data).encode("utf-8"))
        self.commits(6)
        code, result, text = self.check("apply", 84)
        self.assertEqual(code, 0, text)
        self.assertAlmostEqual(result["item_minutes"], 3.5, places=2)

    def test_later_cycle_uses_measured_prioritise_minutes(self) -> None:
        self.shared()
        data = self.data()
        data["cycles"] = [{"n": 1, "opened": self.at(1),
                           "verify_started": {"ts": self.at(40), "usd": 0}},
                          {"n": 2, "opened": self.at(70)}]
        (self.repo / B.BUDGET_REL).write_bytes(json.dumps(data).encode("utf-8"))
        self.phases([(4, "start", 50), (6, "end", 58)])
        self.check("verify", 72)
        self.assertAlmostEqual(self.data()["cycles"][1]["sizing"]["prio_minutes"], 8.0,
                               places=2)

    def test_cycle_closes_when_the_verify_spend_cap_is_reached(self) -> None:
        self.speak(assistant(self.start + timedelta(minutes=2), "a", inp=1000000, out=100000))
        self.pilot_shape(budget={"max_usd": 10})
        code, out, _err = self.bud("check", "--phase", "cycle", "--now", self.at(78))
        self.assertEqual(code, 1, out)
        self.assertIn("spend", out)

    def test_budget_writes_retry_on_permission_error(self) -> None:
        calls: List[int] = []
        real = C.write_json

        def flaky(path: Path, data: Any) -> None:
            calls.append(1)
            if len(calls) <= 2:
                raise PermissionError("in use")
            real(path, data)

        target = self.tmp / "retry.json"
        with mock.patch.object(C, "write_json", side_effect=flaky), \
                mock.patch.object(B.time, "sleep") as sleep:
            B._write_json_retry(target, {"a": 1})
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [0.1, 0.2])
        self.assertTrue(target.exists())
        with mock.patch.object(C, "write_json", side_effect=PermissionError("in use")), \
                mock.patch.object(B.time, "sleep"):
            with self.assertRaises(PermissionError):
                B._write_json_retry(target, {"a": 2})


if __name__ == "__main__":
    unittest.main()
