"""`exec.py governor` (contract/CLI.md 3, ARCHITECTURE.md 8.1, TESTS.md 3.10, LANES.md B08).

PowerShell JSON fixtures (captured once from this machine, fixtures/B08/governor/) -> decisions: lanes =
min(profile max, floor((disk - floor) / footprint)); RAM under the floor, battery, no network and `.harden/active`
pause with a reason; a free commit charge under 4 GB gives one lane; a reading that fails is exit 3; the sweep's
candidates never include a path outside the project's scratch root and the repo's worktrees (a planted orphan with
another project's path is ignored; one with ours is listed). A root counts in a command line only as a whole path, so
`<scratch>/<slug>-v2` and `<repo>/.claude/worktrees-archive` are never listed, and `apply_sweep` re-checks every
orphan against the live process table before the kill. One CLI run measures this machine for real.

Run: python -m unittest discover -s scripts/tests -p "test_governor.py" -v
"""
from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest import mock

import _support as S
import _support_B08 as B
from execlib import governor, jsonio
from execlib.errors import EnvError

OK = json.loads((S.FIXTURES / "B08" / "governor" / "ok.json").read_text(encoding="utf-8"))


def profile(**machine: object) -> dict:
    prof = S.build_profile()
    prof["machine"].update({"max_lanes": 3, "max_verifiers": 2, "disk_floor_gb": 2.0, "ram_floor_gb": 1.5,
                            "lane_footprint_gb": 3.0, "browser_slots": 2})
    prof["machine"].update(machine)
    return prof


def reading(**over: object) -> governor.Readings:
    doc = dict(OK)
    harden = bool(over.pop("harden_active", False))
    doc.update(over)
    return governor.read(profile(), None, runner=lambda _script: doc) if not harden else \
        governor.Readings(**{**governor.readings_from(doc, True).__dict__})


class Decide(unittest.TestCase):
    def test_fixture_reading_parses(self) -> None:
        r = reading()
        self.assertEqual((r.disk_free_gb, r.ram_free_gb, r.commit_free_gb, r.ac_power, r.network),
                         (15.001, 4.252, 6.444, True, True))

    def test_lanes_formula(self) -> None:
        d = governor.decide_launch(reading(), profile(), "wave")
        self.assertFalse(d["pause"], d)
        self.assertEqual(d["lanes"], min(3, int((15.001 - 2.0) // 3.0)))
        d2 = governor.decide_launch(reading(disk_free_gb=6.5), profile(), "wave")
        self.assertEqual(d2["lanes"], 1)
        d3 = governor.decide_launch(reading(disk_free_gb=100.0), profile(), "wave")
        self.assertEqual(d3["lanes"], 3)

    def test_pauses_with_reasons(self) -> None:
        cases = {"disk": dict(disk_free_gb=1.0), "RAM": dict(ram_free_gb=1.0), "battery": dict(ac_power=False),
                 "network": dict(network=False)}
        for word, over in cases.items():
            with self.subTest(case=word):
                d = governor.decide_launch(reading(**over), profile(), "wave")
                self.assertTrue(d["pause"])
                self.assertEqual(d["lanes"], 0)
                self.assertTrue(any(word.lower() in r.lower() for r in d["reasons"]), d["reasons"])
        harden = governor.decide_launch(governor.readings_from(OK, True), profile(), "wave")
        self.assertTrue(harden["pause"])
        self.assertIn(".harden/active", " ".join(harden["reasons"]))
        self.assertFalse(governor.decide_launch(governor.readings_from(OK, False), profile(), "wave")["pause"])

    def test_commit_charge_low_gives_one_lane(self) -> None:
        d = governor.decide_launch(reading(commit_free_gb=3.5, disk_free_gb=100.0), profile(), "wave")
        self.assertEqual(d["lanes"], 1)
        self.assertFalse(d["pause"])

    def test_workspace_mode(self) -> None:
        tmp = S.mkdtemp()
        try:
            self.assertEqual(governor.decide_launch(reading(), profile(), "wave", repo=tmp)["workspace_mode"],
                             "single-tree")
            (tmp / "pnpm-lock.yaml").write_text("lockfileVersion: 9\n", encoding="utf-8")
            self.assertEqual(governor.decide_launch(reading(), profile(), "wave", repo=tmp)["workspace_mode"],
                             "worktrees")
            self.assertEqual(governor.decide_launch(reading(disk_free_gb=9.0), profile(), "wave",
                                                    repo=tmp)["workspace_mode"], "single-tree")
        finally:
            S.rmtree(tmp)

    def test_failed_reading_is_env_error(self) -> None:
        def broken(_script: str) -> dict:
            raise EnvError("PowerShell failed", code="E_ENV")
        with self.assertRaises(EnvError) as cm:
            governor.read(profile(), None, runner=broken)
        self.assertEqual(cm.exception.exit_code, 3)
        r = governor.read(profile(), None, runner=lambda _s: {"disk_free_gb": None, "ram_free_gb": 4})
        self.assertIsNone(r.disk_free_gb)

    def test_script_quotes_paths(self) -> None:
        script = governor.readings_script(Path("C:/it's/repo"), "C:/x")
        self.assertIn("'C:\\it''s\\repo'", script.replace("/", "\\")) if os.name == "nt" else \
            self.assertIn("it''s", script)


class Sweep(unittest.TestCase):
    def setUp(self) -> None:
        self.r = B.HookRepo()
        self.scratch = self.r.tmp.root / "scratch"
        self.prof = S.build_profile()
        self.prof["machine"]["scratch_root"] = self.scratch.as_posix()
        self.ours = (self.scratch / "queue-clock").as_posix()

    def tearDown(self) -> None:
        self.r.cleanup()

    def test_orphans_only_ours_with_dead_parent(self) -> None:
        procs = [
            {"pid": 100, "ppid": 1, "cmd": "explorer.exe"},
            {"pid": 200, "ppid": 99999, "cmd": f"node {self.ours}/T001-proof/run.mjs"},
            {"pid": 201, "ppid": 99999, "cmd": "node C:/x/other-project/T001/run.mjs"},
            {"pid": 202, "ppid": 100, "cmd": f"node {self.ours}/T002/run.mjs"},
            {"pid": 203, "ppid": 99999, "cmd": "node " + self.ours.replace("/", "\\") + "\\T003\\run.mjs"},
            {"pid": 204, "ppid": 99999,
             "cmd": f"node {self.r.path.as_posix()}/.claude/worktrees/w1/x.mjs"},
        ]
        sweep = governor.sweep_candidates(self.r.layout, self.prof, processes=procs, worktrees=[])
        self.assertEqual([o["pid"] for o in sweep["orphans"]], [200, 203, 204])

    def neighbours(self) -> list[dict]:
        """Orphans whose command line extends one of our roots without naming it as a whole path (F1), next to the
        positive controls that do name it (quoted, at the end of the line, case-changed on Windows)."""
        repo = self.r.path.as_posix()
        ours_case = self.ours.upper() if os.name == "nt" else self.ours
        return [
            {"pid": 300, "ppid": 99999, "cmd": f"node {self.ours}-v2/T001/run.mjs"},
            {"pid": 301, "ppid": 99999, "cmd": f"node {repo}/.claude/worktrees-archive/w/x.mjs"},
            {"pid": 302, "ppid": 99999, "cmd": "node " + self.ours.replace("/", "\\") + "-old\\T001\\run.mjs"},
            {"pid": 303, "ppid": 99999, "cmd": f"node C:/elsewhere{self.ours}/T001/run.mjs"},
            {"pid": 310, "ppid": 99999, "cmd": f"node \"{self.ours}/T001/run.mjs\""},
            {"pid": 311, "ppid": 99999, "cmd": f"node --cwd={self.ours}"},
            {"pid": 312, "ppid": 99999, "cmd": f"node {repo}/.claude/worktrees"},
            {"pid": 313, "ppid": 99999, "cmd": f"node '{ours_case}/T009/x.mjs'"},
        ]

    def test_root_matches_whole_segment_only(self) -> None:
        sweep = governor.sweep_candidates(self.r.layout, self.prof, processes=self.neighbours(), worktrees=[])
        listed = [o["pid"] for o in sweep["orphans"]]
        # positive controls: our roots named as whole paths are listed
        self.assertEqual(listed, [310, 311, 312, 313])
        # negative claims: <slug>-v2, <slug>-old (backslashes), worktrees-archive and a root glued to another path
        for pid in (300, 301, 302, 303):
            self.assertNotIn(pid, listed)

    def test_apply_sweep_rechecks_each_orphan(self) -> None:
        procs = self.neighbours()
        sweep = governor.sweep_candidates(self.r.layout, self.prof, processes=procs, worktrees=[])
        foreign = [{"pid": p["pid"], "cmd": p["cmd"][:200]} for p in procs if p["pid"] in (300, 301, 302, 303)]
        planted = dict(sweep, orphans=sweep["orphans"] + foreign)
        # pid 312 was re-used by another program since the listing; pid 313's parent came back
        live = [p for p in procs if p["pid"] not in (312, 313)]
        live += [{"pid": 312, "ppid": 99999, "cmd": "notepad.exe"},
                 {"pid": 313, "ppid": 1, "cmd": next(p["cmd"] for p in procs if p["pid"] == 313)},
                 {"pid": 1, "ppid": 0, "cmd": "init"}]
        killed: list[int] = []
        with mock.patch.object(governor, "_kill_tree", side_effect=lambda pid: killed.append(pid) or True):
            done = governor.apply_sweep(planted, repo=self.r.path, processes=live)
        # positive control: the orphans still ours are killed
        self.assertEqual(sorted(killed), [310, 311])
        self.assertEqual(sorted(done["killed"]), [310, 311])
        # negative claim: the planted foreign orphans, the re-used pid and the re-parented one are refused, never killed
        for pid in (300, 301, 302, 303, 312, 313):
            self.assertIn(pid, done["refused"])
            self.assertNotIn(pid, killed)

    def test_apply_sweep_refuses_vanished_orphan(self) -> None:
        procs = self.neighbours()
        sweep = governor.sweep_candidates(self.r.layout, self.prof, processes=procs, worktrees=[])
        self.assertIn(310, [o["pid"] for o in sweep["orphans"]])
        killed: list[int] = []
        with mock.patch.object(governor, "_kill_tree", side_effect=lambda pid: killed.append(pid) or True):
            done = governor.apply_sweep(sweep, repo=self.r.path,
                                        processes=[p for p in procs if p["pid"] != 310])
        self.assertNotIn(310, killed)
        self.assertIn(310, done["refused"])
        self.assertIn(311, killed)

    def test_scratch_of_done_tasks_only(self) -> None:
        status = S.build_status("A", {"T001": S.build_task_status("done"), "T002": S.build_task_status("running")})
        jsonio.write_json_atomic(self.r.layout.status("A"), status)
        for name in ("T001-clone", "T002-clone", "notes"):
            (self.scratch / "queue-clock" / name).mkdir(parents=True)
        (self.scratch / "other" / "T001-clone").mkdir(parents=True)
        sweep = governor.sweep_candidates(self.r.layout, self.prof, processes=[], worktrees=[])
        self.assertEqual(sweep["scratch"], [(self.scratch / "queue-clock" / "T001-clone").as_posix()])
        outside = (self.scratch / "other" / "T001-clone").as_posix()
        planted = dict(sweep, scratch=sweep["scratch"] + [outside])
        done = governor.apply_sweep(planted, repo=self.r.path)
        self.assertEqual(done["scratch_removed"], sweep["scratch"])
        self.assertIn(outside, done["refused"])
        self.assertTrue(Path(outside).exists())
        self.assertFalse((self.scratch / "queue-clock" / "T001-clone").exists())

    def test_worktree_candidates_filtered(self) -> None:
        inside = (self.r.path / ".claude" / "worktrees" / "w1").as_posix()
        outside = (self.r.tmp.root / "elsewhere" / "w2").as_posix()
        sweep = governor.sweep_candidates(self.r.layout, self.prof, processes=[], worktrees=[inside, outside])
        self.assertEqual(sweep["worktrees"], [inside])

    def test_merged_worktree_found_by_git(self) -> None:
        wt = self.r.path / ".claude" / "worktrees" / "w1"
        self.r.tmp.git("worktree", "add", "--detach", str(wt), "HEAD")
        self.r.tmp.git("fetch", "origin")
        sweep = governor.sweep_candidates(self.r.layout, self.prof, processes=[])
        self.assertEqual(sweep["worktrees"], [wt.as_posix()])
        done = governor.apply_sweep(sweep, repo=self.r.path)
        self.assertEqual(done["worktrees_removed"], [wt.as_posix()])
        self.assertFalse(wt.exists())


@unittest.skipUnless(os.name == "nt", "the real reading uses PowerShell (Windows)")
class GovernorCli(unittest.TestCase):
    def test_real_reading_envelope(self) -> None:
        r = B.HookRepo()
        try:
            prof = S.build_profile()
            prof["machine"]["scratch_root"] = (r.tmp.root / "scratch").as_posix()
            jsonio.write_json_atomic(r.layout.profile, prof)
            code, env, _ = S.run_exec(["governor", "--for", "wave"], cwd=r.path, timeout=120)
            self.assertIn(code, (0, 1), env)
            self.assertEqual(set(env["data"]), {"readings", "decision", "sweep"})
            self.assertEqual(env["data"]["decision"]["pause"], code == 1)
            st = jsonio.read_json(r.layout.local_state)
            self.assertEqual(st["governor"]["decision"], env["data"]["decision"])
            self.assertIsNotNone(st["governor"]["disk_free_gb"])
        finally:
            r.cleanup()

    def test_without_profile_is_usage_error(self) -> None:
        r = B.HookRepo()
        try:
            code, env, _ = S.run_exec(["governor"], cwd=r.path)
            self.assertEqual(code, 2)
        finally:
            r.cleanup()


if __name__ == "__main__":
    unittest.main()
