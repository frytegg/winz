"""Scheduling (lane B03; contract/TESTS.md 3.5, LANES.md B03, CLI.md `schedule` and `simulate`).

Protects: the lognormal parameters; CPM on the hand-computed 7-task graph (with a release and a deadline); the
dispatcher (lanes, priority ties, browser slots, ordered and write overlaps, human calendars); Monte Carlo
determinism (seeds, default seed, global random untouched, PYTHONHASHSEED independence), conditioning of running
tasks, failure cycles, response latency inside awake windows; zones; the build-complete deadline (Origins numbers
and the fixture, P-24); cut candidates; readiness transitions, including the cross-executor done check on the
tracked copies (SCHEMAS.md 4.3 #1-#7 for agent tasks, the answer, resolution and file-proof run for manual and
decision tasks, TWO-DEV.md 5) and the rule that unverifiable evidence never moves a ready task back to planned; the
`schedule` and `simulate` commands.

Run: python -m unittest discover -s scripts/tests -p "test_schedule.py" -v
"""
from __future__ import annotations

import copy
import importlib.util
import json
import math
import os
import random
import subprocess
import sys
import unittest
from datetime import timedelta
from pathlib import Path
from unittest import mock

import _support as S
from execlib import clock, jsonio, schema, statusio
from execlib import plan as planmod
from execlib import schedule as sc
from execlib.model import Deadline, PlanModel

FIX = S.FIXTURES / "B03"
NOW = clock.parse_utc("2026-10-03T08:00:00Z")
NOW_TEXT = "2026-10-03T08:00:00Z"
P50 = {"T001": 30, "T002": 20, "T003": 45, "T004": 15, "T005": 10, "T006": 25, "T007": 20}
NOFAIL = {"fail.code": 0.0}


def at(minutes: float) -> str:
    return clock.format_utc(NOW + timedelta(minutes=minutes))


def dag7(**over: dict) -> dict:
    """fixtures/B03/dag7.plan.json with per-task overrides (approval dropped when anything changes)."""
    raw = jsonio.read_json(FIX / "dag7.plan.json")
    for t in raw["tasks"]:
        t.update(over.get(t["id"], {}))
    if over:
        raw["approved"] = None
        raw = S.approve(raw)
    return raw


def model(raw: dict) -> PlanModel:
    report = schema.validate(raw, "plan")
    assert report.ok, [i.message for i in report.issues]
    return PlanModel.from_raw(raw)


def variable(raw: dict) -> dict:
    """The same graph with real spread: p10 = p50/2, p90 = 2 x p50, no verify override."""
    out = copy.deepcopy(raw)
    for t in out["tasks"]:
        p = t["estimate"]["p50_min"]
        t["estimate"] = {"p10_min": p / 2, "p50_min": p, "p90_min": 2 * p, "source": "reference-class:build"}
        t["params"] = {}
    out["approved"] = None
    return S.approve(out)


def offsets(sched: dict) -> dict[str, tuple[float, float]]:
    return {k: (clock.minutes_between(NOW, s), clock.minutes_between(NOW, e)) for k, (s, e) in sched.items()}


def overlap(a: tuple[float, float], b: tuple[float, float]) -> bool:
    return a[0] < b[1] - 1e-9 and b[0] < a[1] - 1e-9


class Lognormal(unittest.TestCase):
    def test_parameters_of_the_build_class(self) -> None:
        mu, sigma = sc.lognormal(26.7, 46.0)
        self.assertAlmostEqual(mu, 3.2846635654062037, delta=1e-12)
        self.assertAlmostEqual(sigma, 0.4244521153892721, delta=1e-12)
        self.assertEqual(sigma, math.log(46 / 26.7) / 1.2816)

    def test_degenerate_estimate_samples_exactly(self) -> None:
        self.assertEqual(sc.lognormal(10, 10)[1], 0.0)
        draw = sc._Draw(3)
        self.assertEqual({draw.lognormal(10, 10) for _ in range(200)}, {10.0})
        # positive control: a real spread gives different samples
        self.assertGreater(len({draw.lognormal(10, 20) for _ in range(50)}), 40)

    def test_reference_class_loaded(self) -> None:
        self.assertEqual((sc.REFERENCE_CLASS["build"].p50, sc.REFERENCE_CLASS["build"].p90), (26.7, 46.0))
        self.assertEqual((sc.REFERENCE_CLASS["verify"].p10, sc.REFERENCE_CLASS["verify"].p90), (1.6, 31.1))
        self.assertEqual(sc.REFERENCE_CLASS["research"].p50, 24.9)
        self.assertEqual((sc.REFERENCE_CLASS["human_response"].p50, sc.REFERENCE_CLASS["human_response"].p90),
                         (30.0, 120.0))


class Cpm(unittest.TestCase):
    TABLE = {  # task: (ES, EF, LS, LF, slack) from TESTS.md 3.5
        "T001": (0, 30, 0, 30, 0), "T002": (30, 50, 40, 60, 10), "T003": (30, 75, 30, 75, 0),
        "T004": (50, 65, 60, 75, 10), "T005": (75, 85, 75, 85, 0), "T006": (50, 75, 60, 85, 10),
        "T007": (85, 105, 85, 105, 0)}

    def test_hand_computed_table(self) -> None:
        c = sc.cpm(model(dag7()), {}, NOW, P50)
        for tid, (es, ef, ls, lf, slack) in self.TABLE.items():
            with self.subTest(task=tid):
                self.assertEqual((c.es[tid], c.ef[tid], c.ls[tid], c.lf[tid], c.slack[tid]), (es, ef, ls, lf, slack))
        self.assertEqual(c.critical, ("T001", "T003", "T005", "T007"))
        self.assertEqual(c.project_end, 105)

    def test_release_moves_the_critical_path(self) -> None:
        raw = dag7(T006={"release_utc": at(70)})
        c = sc.cpm(model(raw), {}, NOW, P50)
        self.assertEqual((c.es["T006"], c.ef["T006"], c.es["T007"], c.project_end), (70, 95, 95, 115))
        self.assertEqual(c.critical, ("T006", "T007"))
        self.assertEqual((c.slack["T005"], c.slack["T003"], c.slack["T006"]), (10, 10, 0))

    def test_deadline_gives_negative_slack_and_a_red_zone(self) -> None:
        def plan_with(deadline_min: int) -> PlanModel:
            raw = dag7(T007={"deadline_utc": at(deadline_min)})
            raw["deadlines"].append({"id": "DL-x", "title": "X", "at_utc": at(deadline_min), "kind": "external",
                                     "irrecoverable": False, "gate_phase": "build", "source": "test"})
            raw["approved"] = None
            return model(S.approve(raw))

        tight = plan_with(100)
        c = sc.cpm(tight, {}, NOW, P50)
        self.assertEqual(c.slack["T007"], -5)
        self.assertEqual(c.critical, ("T001", "T003", "T005", "T007"))
        sim = sc.simulate(tight, {}, {}, samples=1, seed=1, lanes=3, now=NOW, calibration=NOFAIL)
        zone = next(z for z in sc.zones(sim, tight.deadlines, NOW) if z["deadline"] == "DL-x")
        self.assertEqual((zone["p_on_time"], zone["zone"]), (0.0, "red"))
        # positive control: the same deadline at the makespan is met
        loose = plan_with(105)
        self.assertEqual(sc.cpm(loose, {}, NOW, P50).slack["T007"], 0)
        sim = sc.simulate(loose, {}, {}, samples=1, seed=1, lanes=3, now=NOW, calibration=NOFAIL)
        zone = next(z for z in sc.zones(sim, loose.deadlines, NOW) if z["deadline"] == "DL-x")
        self.assertEqual(zone["zone"], "green")

    def test_done_tasks_are_out_of_the_critical_path(self) -> None:
        st = {"A": S.build_status("A", {"T001": S.build_task_status("done")})}
        c = sc.cpm(model(dag7()), st, NOW, P50)
        self.assertNotIn("T001", c.es)
        self.assertEqual(c.project_end, 75)


class Dispatcher(unittest.TestCase):
    def run_dispatch(self, raw: dict, lanes: int, slots: int = 1, calendars: dict | None = None,
                     durations: dict | None = None) -> dict[str, tuple[float, float]]:
        return offsets(sc.dispatch(model(raw), {}, now=NOW, lanes=lanes, durations=durations or P50,
                                   calendars=calendars or {}, browser_slots=slots))

    def test_lanes(self) -> None:
        one = self.run_dispatch(dag7(), 1)
        self.assertEqual(max(e for _s, e in one.values()), 165)
        two = self.run_dispatch(dag7(), 2)
        self.assertEqual(max(e for _s, e in two.values()), 110)
        self.assertEqual({k: v[0] for k, v in two.items()},
                         {"T001": 0, "T002": 30, "T003": 30, "T004": 50, "T006": 65, "T005": 75, "T007": 90})
        for lanes in (3, 4, 6):
            self.assertEqual(max(e for _s, e in self.run_dispatch(dag7(), lanes).values()), 105)

    def test_priority_ties(self) -> None:
        p = model(dag7())
        c = sc.cpm(p, {}, NOW, P50)
        g = sc.Graph.of(p)
        k4, k6 = sc.priority_key(p.by_id["T004"], c, g), sc.priority_key(p.by_id["T006"], c, g)
        self.assertEqual((k4[0], k4[1]), (k6[0], k6[1]))  # equal LST 60 and remaining path 45
        self.assertLess(k4, k6)
        self.assertLess(sc.priority_key(p.by_id["T003"], c, g), sc.priority_key(p.by_id["T002"], c, g))

    D10 = {f"T00{i}": 10 for i in range(1, 8)}

    def tie_case(self, raw: dict) -> tuple[tuple, tuple, dict[str, tuple[float, float]]]:
        """priority keys of T002 and T003 (both ready at 10 after T001) and the one-lane schedule."""
        p = model(raw)
        c = sc.cpm(p, {}, NOW, self.D10)
        g = sc.Graph.of(p)
        k2, k3 = sc.priority_key(p.by_id["T002"], c, g), sc.priority_key(p.by_id["T003"], c, g)
        return k2, k3, self.run_dispatch(raw, 1, durations=self.D10)

    def test_priority_ties_broken_by_direct_successors(self) -> None:
        # T002 -> T004; T003 -> T005, T006; all three -> T007; every duration 10
        raw = dag7(T004={"depends_on": ["T002"]}, T005={"depends_on": ["T003"]}, T006={"depends_on": ["T003"]},
                   T007={"depends_on": ["T004", "T005", "T006"]})
        k2, k3, res = self.tie_case(raw)
        self.assertEqual((k2[0], k2[1]), (k3[0], k3[1]))  # equal LST 10 and remaining path 30
        self.assertEqual((k2[0], k2[1]), (10, -30))
        # positive control: the tier after successors (the id) points the other way, so successors decide
        self.assertEqual((k2[2], k3[2]), (-1, -2))
        self.assertLess(k2[3], k3[3])
        self.assertLess(k3, k2)
        self.assertEqual((res["T003"][0], res["T002"][0]), (10, 20))

    def test_priority_ties_broken_by_remaining_path(self) -> None:
        # T002 -> T004, T006 (two successors, remaining 20); T003 -> T005 -> T007 (one successor, remaining 30);
        # the deadline on T002 at +20 equalises the latest starts at 10
        raw = dag7(T002={"deadline_utc": at(20)}, T004={"depends_on": ["T002"]}, T006={"depends_on": ["T002"]},
                   T005={"depends_on": ["T003"]}, T007={"depends_on": ["T005"]})
        k2, k3, res = self.tie_case(raw)
        self.assertEqual((k2[0], k3[0]), (10, 10))  # equal LST
        self.assertEqual((k2[1], k3[1]), (-20, -30))
        # positive control: the successors tier and the id both point the other way, so the remaining path decides
        self.assertEqual((k2[2], k3[2]), (-2, -1))
        self.assertLess(k2[3], k3[3])
        self.assertLess(k3, k2)
        self.assertEqual((res["T003"][0], res["T002"][0]), (10, 20))
        # without the deadline the latest starts differ (T002 at 20), so the LST tier alone decides there
        k2b, k3b, _ = self.tie_case(dag7(T004={"depends_on": ["T002"]}, T006={"depends_on": ["T002"]},
                                         T005={"depends_on": ["T003"]}, T007={"depends_on": ["T005"]}))
        self.assertEqual((k2b[0], k3b[0]), (20, 10))

    def test_browser_slots_serialize(self) -> None:
        raw = dag7(T004={"resources": ["browser"]}, T006={"resources": ["browser"]})
        res = self.run_dispatch(raw, 3, slots=1)
        self.assertFalse(overlap(res["T004"], res["T006"]))
        self.assertEqual(max(e for _s, e in res.values()), 110)
        # positive control: two slots let them overlap again
        res2 = self.run_dispatch(raw, 3, slots=2)
        self.assertTrue(overlap(res2["T004"], res2["T006"]))
        self.assertEqual(max(e for _s, e in res2.values()), 105)

    def test_ordered_resource_never_overlaps_in_the_dispatcher(self) -> None:
        raw = dag7(T004={"resources": ["wallet:hot"]}, T006={"resources": ["wallet:hot"]})
        res = self.run_dispatch(raw, 3)
        self.assertFalse(overlap(res["T004"], res["T006"]))
        res2 = self.run_dispatch(dag7(T004={"resources": ["wallet:hot"]}, T006={"resources": ["wallet:cold"]}), 3)
        self.assertTrue(overlap(res2["T004"], res2["T006"]))

    @unittest.skipUnless(importlib.util.find_spec("execlib.validate") is not None,
                         "execlib.validate is lane B02's and not integrated yet")
    def test_ordered_resource_refused_by_validate(self) -> None:  # pragma: no cover - runs once B02 lands
        from execlib import validate
        raw = dag7(T004={"resources": ["wallet:hot"]}, T006={"resources": ["wallet:hot"]})
        vctx = validate.VContext(profile=S.build_profile(), policy=S.build_policy(), statuses=None, now=NOW,
                                 skills_present={})
        codes = {e.code for e in validate.validate_plan(raw, vctx).errors}
        self.assertIn("E_RESOURCE_OVERLAP", codes)

    def test_intersecting_writes_never_overlap(self) -> None:
        raw = dag7(T004={"writes": ["src/shared/**"]}, T006={"writes": ["src/shared/*.ts"]})
        res = self.run_dispatch(raw, 3)
        self.assertFalse(overlap(res["T004"], res["T006"]))
        self.assertTrue(overlap(self.run_dispatch(dag7(), 3)["T004"], self.run_dispatch(dag7(), 3)["T006"]))

    def manual_plan(self, minutes: float) -> dict:
        task = S.build_task("T001", kind="manual", estimate={"p10_min": minutes, "p50_min": minutes,
                                                             "p90_min": minutes, "source": "reference-class:manual"})
        return S.approve(S.build_plan([task]))

    def calendars(self, windows: list[tuple[int, int, str]]) -> dict:
        profile = S.build_profile()
        profile["team"]["devs"][0]["availability"] = [{"start_utc": at(a), "end_utc": at(b), "kind": k}
                                                     for a, b, k in windows]
        return sc.calendars_from_profile(profile)

    def test_human_task_waits_for_the_awake_window(self) -> None:
        cal = self.calendars([(60, 600, "awake")])
        res = self.run_dispatch(self.manual_plan(30), 1, calendars=cal, durations={"T001": 30})
        self.assertEqual(res["T001"], (60, 90))
        # positive control: without availability it starts at once
        self.assertEqual(self.run_dispatch(self.manual_plan(30), 1, durations={"T001": 30})["T001"], (0, 30))

    def test_talk_window_splits_nothing(self) -> None:
        cal = self.calendars([(0, 300, "awake"), (20, 50, "talk")])
        self.assertEqual(cal["devA"], [(NOW, NOW + timedelta(minutes=20)),
                                       (NOW + timedelta(minutes=50), NOW + timedelta(minutes=300))])
        res = self.run_dispatch(self.manual_plan(30), 1, calendars=cal, durations={"T001": 30})
        self.assertEqual(res["T001"], (50, 80))
        # positive control: a task that fits before the talk starts at once
        short = self.run_dispatch(self.manual_plan(15), 1, calendars=cal, durations={"T001": 15})
        self.assertEqual(short["T001"], (0, 15))

    def test_human_tasks_hold_no_lane(self) -> None:
        manual = S.build_task("T002", kind="manual", estimate={"p10_min": 30, "p50_min": 30, "p90_min": 30,
                                                               "source": "reference-class:manual"})
        code = S.build_task("T001", estimate={"p10_min": 30, "p50_min": 30, "p90_min": 30,
                                              "source": "reference-class:build"})
        res = self.run_dispatch(S.approve(S.build_plan([code, manual])), 1, durations={"T001": 30, "T002": 30})
        self.assertTrue(overlap(res["T001"], res["T002"]))


class MonteCarlo(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, self.tmp)

    def sim(self, raw: dict, **kw: object) -> dict:
        args: dict = {"samples": 300, "seed": 7, "lanes": 3, "now": NOW, "calibration": NOFAIL}
        args.update(kw)
        return sc.simulate(model(raw), {}, {}, **args)

    def test_same_seed_same_output_other_seed_differs(self) -> None:
        raw = variable(dag7())
        a, b = self.sim(raw), self.sim(raw)
        self.assertEqual(a, b)
        self.assertNotEqual(self.sim(raw, seed=8)["histogram"], a["histogram"])

    def cli_simulate(self, plan_path: Path, *extra: str, env: dict | None = None) -> bytes:
        proc = subprocess.run([sys.executable, str(S.EXEC_PY), "simulate", "--plan", str(plan_path), *extra],
                              cwd=str(self.tmp), env=env or S.env_isolated(), capture_output=True, timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        return proc.stdout

    def test_cli_byte_identical_and_default_seed(self) -> None:
        raw = variable(dag7())
        path = S.write_json(self.tmp / "plan.json", raw)
        one = self.cli_simulate(path, "--seed", "7", "--samples", "500")
        self.assertEqual(one, self.cli_simulate(path, "--seed", "7", "--samples", "500"))
        self.assertNotEqual(one, self.cli_simulate(path, "--seed", "8", "--samples", "500"))
        code, env, _logs = S.run_exec(["simulate", "--plan", str(path), "--samples", "500"], self.tmp)
        self.assertEqual(code, 0)
        self.assertEqual(env["data"]["seed"], int(planmod.plan_digest(raw)[:8], 16))
        self.assertEqual(self.cli_simulate(path, "--samples", "500"), self.cli_simulate(path, "--samples", "500"))
        amended = copy.deepcopy(raw)
        amended["tasks"][0]["title"] = "Task T001, amended"
        path2 = S.write_json(self.tmp / "plan2.json", amended)
        _c, env2, _l = S.run_exec(["simulate", "--plan", str(path2), "--samples", "500"], self.tmp)
        self.assertNotEqual(env2["data"]["seed"], env["data"]["seed"])
        # usage and input errors
        self.assertEqual(S.run_exec(["simulate", "--plan", str(path), "--samples", "100"], self.tmp)[0], 2)
        bad = copy.deepcopy(raw)
        del bad["tasks"][0]["estimate"]
        code, env_bad, _l = S.run_exec(["simulate", "--plan", str(S.write_json(self.tmp / "bad.json", bad))],
                                       self.tmp)
        self.assertEqual((code, env_bad["errors"][0]["code"]), (1, "E_PLAN_INVALID"))  # through plan.load_raw
        what_if = S.write_json(self.tmp / "what-if.json", {"cut": ["T006"], "lanes": 1})
        code, env3, _l = S.run_exec(["simulate", "--plan", str(path), "--samples", "500", "--what-if",
                                     str(what_if)], self.tmp)
        self.assertEqual((code, env3["data"]["cut"], env3["data"]["lanes"]), (0, ["T006"], 1))
        bad_wi = S.write_json(self.tmp / "bad-what-if.json", {"drop": ["T006"]})
        self.assertEqual(S.run_exec(["simulate", "--plan", str(path), "--what-if", str(bad_wi)], self.tmp)[0], 1)

    def test_global_random_untouched(self) -> None:
        state = random.getstate()
        with mock.patch("random.random", side_effect=AssertionError("global random used")), \
                mock.patch("random.gauss", side_effect=AssertionError("global random used")):
            self.sim(variable(dag7()), samples=50)
        self.assertEqual(random.getstate(), state)
        # positive control: the patch does fire for the global generator
        with mock.patch("random.random", side_effect=AssertionError("fired")):
            with self.assertRaises(AssertionError):
                random.random()

    def test_hash_seed_independence(self) -> None:
        raw = variable(dag7())
        path = S.write_json(self.tmp / "plan.json", raw)
        outs = []
        for seed in ("1", "2"):
            outs.append(self.cli_simulate(path, "--samples", "500", env=S.env_isolated(PYTHONHASHSEED=seed)))
        self.assertEqual(outs[0], outs[1])
        sched_outs = []
        for seed in ("1", "2"):
            root = self.tmp / f"h{seed}"
            layout = S.state_dir(root, plan=raw)
            S.write_json(layout.profile, S.build_profile())
            proc = subprocess.run([sys.executable, str(S.EXEC_PY), "schedule", "--state", str(layout.state),
                                   "--executor", "A", "--samples", "500"], cwd=str(root),
                                  env=S.env_isolated(PYTHONHASHSEED=seed), capture_output=True, timeout=120)
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            sched_outs.append(proc.stdout)
        self.assertEqual(sched_outs[0], sched_outs[1])

    def test_running_task_samples_beyond_its_elapsed_time(self) -> None:
        draw = sc._Draw(5)
        totals = [draw.conditional_total(26.7, 46.0, 40.0) for _ in range(400)]
        self.assertTrue(all(t >= 40.0 for t in totals))
        # positive control: unconditioned draws do fall below the elapsed time
        self.assertTrue(any(draw.lognormal(26.7, 46.0) < 40.0 for _ in range(400)))
        task = S.build_task("T001", estimate={"p10_min": 6.2, "p50_min": 26.7, "p90_min": 46.0,
                                              "source": "reference-class:build"},
                            params={"verify_estimate": {"p10_min": 0, "p50_min": 0, "p90_min": 0}})
        raw = S.approve(S.build_plan([task]))
        running = {"A": S.build_status("A", {"T001": S.build_task_status(
            "running", since_utc=clock.format_utc(NOW - timedelta(minutes=40)))})}
        sim = sc.simulate(model(raw), running, {}, samples=300, seed=2, lanes=1, now=NOW, calibration=NOFAIL)
        fresh = sc.simulate(model(raw), {}, {}, samples=300, seed=2, lanes=1, now=NOW, calibration=NOFAIL)
        self.assertLess(sim["makespan_min"]["p50"], fresh["makespan_min"]["p50"])
        self.assertGreater(sim["makespan_min"]["p50"] + 40, fresh["makespan_min"]["p50"])

    def test_failure_probability_one_adds_max_attempts_minus_one_cycles(self) -> None:
        task = S.build_task("T001", max_attempts=3,
                            estimate={"p10_min": 20, "p50_min": 20, "p90_min": 20, "source": "reference-class:build"},
                            params={"verify_estimate": {"p10_min": 5, "p50_min": 5, "p90_min": 5}})
        raw = S.approve(S.build_plan([task]))
        always = sc.simulate(model(raw), {}, {}, samples=50, seed=1, lanes=1, now=NOW,
                             calibration={"fail.code": 1.0})
        self.assertEqual(always["histogram"], [[75.0, 50]])  # 20 + 2 x (5 + 20) + 5
        never = sc.simulate(model(raw), {}, {}, samples=50, seed=1, lanes=1, now=NOW,
                            calibration={"fail.code": 0.0})
        self.assertEqual(never["histogram"], [[25.0, 50]])

    def test_manual_task_latency_counts_awake_time_only(self) -> None:
        task = S.build_task("T001", kind="manual", estimate={"p10_min": 10, "p50_min": 10, "p90_min": 10,
                                                             "source": "reference-class:manual"})
        raw = S.approve(S.build_plan([task]))
        profile = S.build_profile()
        profile["team"]["devs"][0]["availability"] = [
            {"start_utc": at(0), "end_utc": at(20), "kind": "awake"},
            {"start_utc": at(60), "end_utc": at(600), "kind": "awake"}]
        calib = {"human_response_p50": 30, "human_response_p90": 30}
        sim = sc.simulate(model(raw), {}, profile, samples=40, seed=1, lanes=1, now=NOW, calibration=calib)
        self.assertEqual(sim["histogram"], [[80.0, 40]])  # 20 awake + 10 awake after the gap, then 10 of work
        free = sc.simulate(model(raw), {}, {}, samples=40, seed=1, lanes=1, now=NOW, calibration=calib)
        self.assertEqual(free["histogram"], [[40.0, 40]])

    def test_degenerate_durations_equal_the_dispatcher(self) -> None:
        sim = self.sim(dag7(), samples=200)
        self.assertEqual(sim["histogram"], [[105.0, 200]])
        self.assertEqual(sim["makespan_min"], {"p50": 105.0, "p80": 105.0, "p90": 105.0})
        self.assertEqual(sim["criticality"]["T001"], 1.0)
        self.assertEqual(sim["criticality"]["T006"], 0.0)

    def test_percentiles_are_ordered(self) -> None:
        sim = self.sim(variable(dag7()), samples=400)
        self.assertTrue(sim["deadlines"])
        for d, m in sim["deadlines"].items():
            with self.subTest(deadline=d):
                self.assertLessEqual(m["p50_min"], m["p80_min"])
                self.assertLessEqual(m["p80_min"], m["p90_min"])
        mk = sim["makespan_min"]
        self.assertLess(mk["p50"], mk["p90"])


class Zones(unittest.TestCase):
    def test_boundaries(self) -> None:
        dl = [Deadline(id="DL-x", at=NOW, kind="external", irrecoverable=False, gate_phase="build")]
        for p, zone in ((0.80, "green"), (0.7999, "yellow"), (0.50, "yellow"), (0.4999, "red"), (1.0, "green")):
            with self.subTest(p=p):
                sim = {"deadlines": {"DL-x": {"p_on_time": p, "p50_min": 10, "p80_min": 20, "p90_min": 30}}}
                z = sc.zones(sim, dl, NOW)[0]
                self.assertEqual((z["zone"], z["p80_utc"]), (zone, at(20)))


ORIGINS_PROFILE_OVER = {"start_utc": "2026-10-06T04:00:00Z", "deadline_utc": "2026-10-07T15:59:00Z"}


class BuildComplete(unittest.TestCase):
    def test_origins_numbers(self) -> None:
        """Origins: submission Wed 7 Oct 23:59 SGT = 2026-10-07T15:59:00Z; /harden budget 240 min (profile).
        P80 of each component = p50 x (p90/p50)^(0.8416212335729143 / 1.2816) (exponent 0.6566957190799894):
          fix wave 40/90 -> 68.1297; FE-21 sign-off 15/30 -> 23.6470; recording 90/150 -> 125.8721;
          /prose 30/60 -> 47.2940; screenshots 10/20 -> 15.7647; submission steps 20/40 -> 31.5294;
          deliverables = 23.6470 + 125.8721 + 47.2940 + 15.7647 + 31.5294 = 244.1072; buffer 60.
        after_harden = 68.1297 + 244.1072 + 60 = 372.2370 min (6 h 12 min 14.2 s);
        total before submission = 240 + 372.2370 = 612.2370 min (10 h 12 min 14.2 s).
        15:59:00 - 10:12:14.2 = 05:46:45.8 -> floored to the minute: 2026-10-07T05:46:00Z (Wed 13:46 SGT, inside
        ARCHITECTURE.md 7.3's 11:59-17:00 SGT); harden_end_latest = 15:59:00 - 6:12:14.2 = 09:46:45.8 -> 09:46:00Z."""
        profile = S.build_profile()
        profile["event"].update(ORIGINS_PROFILE_OVER)
        profile["harden"]["budget_min_p80"] = 240
        plan = model(S.approve(S.build_plan()))
        hp = sc.harden_p80_min(profile)
        self.assertEqual(hp, 240.0)
        self.assertEqual(clock.format_utc(sc.build_complete_deadline(profile, plan, hp)), "2026-10-07T05:46:00Z")
        b = sc.build_complete_breakdown(profile, plan, hp)
        self.assertEqual(b["harden_end_latest_utc"], "2026-10-07T09:46:00Z")
        self.assertEqual(b["after_harden_min"], 372.24)
        self.assertEqual(b["deliverables_p80_min"], 304.11)
        self.assertEqual(b["fix_wave_p80_min"], 68.13)
        shown, _w = clock.display(sc.build_complete_deadline(profile, plan, hp),
                                  [clock.ZoneSpec("SGT", "Asia/Singapore", 480)])
        self.assertEqual(shown["SGT"], "Wed 7 Oct 13:46 SGT")

    def test_fixture_deadline_lies_before_the_submission(self) -> None:
        profile = jsonio.read_json(S.RENDERED / "profile.draft.json")
        plan = model(S.approve(S.build_plan()))
        hp = sc.harden_p80_min(profile)
        self.assertEqual(hp, 144.0)  # budget null, loc unknown: 1.2 x clamp(60, 120, 600)
        deadline = sc.build_complete_deadline(profile, plan, hp)
        submission = clock.parse_utc(profile["event"]["deadline_utc"])
        self.assertLess(deadline, submission)  # P-24
        expected = submission - timedelta(minutes=144 + 372.2369731)
        self.assertEqual(deadline, expected.replace(second=0, microsecond=0))

    def test_plan_deliverable_tasks_replace_the_defaults(self) -> None:
        def deliv(tid: str, minutes: int, deps: tuple[str, ...] = ()) -> dict:
            return S.build_task(tid, kind="research", deps=deps, phase="deliverable",
                                estimate={"p10_min": minutes, "p50_min": minutes, "p90_min": minutes,
                                          "source": "planner"})
        tasks = [S.build_task("T001"), deliv("T002", 50, ("T001",)), deliv("T003", 30, ("T002",)),
                 deliv("T004", 70, ("T001",))]
        plan = model(S.approve(S.build_plan(tasks)))
        b = sc.build_complete_breakdown(S.build_profile(), plan, 144.0)
        self.assertEqual((b["deliverables_source"], b["deliverable_components_p80_min"]),
                         ("plan", {"plan_deliverable_tasks": 80.0}))  # max(50 + 30, 70)
        self.assertEqual(b["deliverables_p80_min"], 140.0)

    def test_harden_formula_and_no_submission(self) -> None:
        self.assertEqual(sc.harden_p80_min({}, 30000), 720.0)   # 1.2 x clamp(660, 120, 600)
        self.assertEqual(sc.harden_p80_min({}, 5000), 192.0)    # 1.2 x 160
        self.assertEqual(sc.harden_p80_min({}), 144.0)
        raw = S.build_plan()
        raw["deadlines"] = []
        profile = S.build_profile()
        profile["event"]["deadline_utc"] = None
        with self.assertRaises(sc.UsageError):
            sc.build_complete_deadline(profile, model(raw), 144.0)


class Cuts(unittest.TestCase):
    def test_order_and_exclusions(self) -> None:
        def t(tid: str, deps: tuple[str, ...] = (), **over: object) -> dict:
            return S.build_task(tid, deps=deps, **over)
        tasks = [t("T001"), t("T002", ("T001",), required=False), t("T003", ("T001",), priority="P3"),
                 t("T004", ("T001",), priority="P2"), t("T005", ("T001",), required=False),
                 t("T006", ("T005",)), t("T007", ("T001",), priority="P3"), t("T008", ("T001",), priority="P2")]
        plan = model(S.approve(S.build_plan(tasks)))
        sim = {"criticality": {"T001": 1.0, "T003": 0.2, "T004": 0.1, "T007": 0.9, "T008": 0.0}}
        st = {"A": S.build_status("A", {"T008": S.build_task_status("running")})}
        self.assertEqual(sc.cut_candidates(plan, st, sim), ["T002", "T003", "T004"])
        # positive control: once T008 is not running and T007 is off the critical path, both are candidates
        sim2 = {"criticality": {"T001": 1.0, "T007": 0.1}}
        self.assertEqual(sc.cut_candidates(plan, {}, sim2), ["T002", "T003", "T007", "T004", "T008"])


def recal_task(kind: str, p50: float) -> sc.Task:
    return PlanModel.from_raw(S.build_plan([S.build_task("T001", kind=kind, estimate={
        "p10_min": p50, "p50_min": p50, "p90_min": p50, "source": "reference-class:build"})])).by_id["T001"]


class Recalibrate(unittest.TestCase):
    def test_geometric_mean_and_idempotence(self) -> None:
        done = [(recal_task("code", 20), 40.0), (recal_task("code", 20), 10.0), (recal_task("research", 10), 15.0)]
        base = {"ratios": {"infra": 1.3}, "samples": {"infra": 4}, "pct_per_agent_hour": 0.5}
        once = sc.recalibrate(base, done)
        self.assertEqual(once["ratios"], {"code": 1.0, "infra": 1.3, "research": 1.5})
        self.assertEqual(once["samples"], {"code": 2, "infra": 4, "research": 1})
        self.assertEqual(once["pct_per_agent_hour"], 0.5)
        self.assertEqual(sc.recalibrate(once, done), once)
        state_doc = S.build_local_state()
        state_doc["calibration"] = once
        self.assertTrue(schema.validate(state_doc, "local-state").ok)


class Readiness(unittest.TestCase):
    def test_planned_to_ready_needs_done_dependencies_and_a_past_release(self) -> None:
        plan = model(dag7(T001={"release_utc": NOW_TEXT}))
        before, _w = sc.readiness(plan, {}, None, now=NOW - timedelta(seconds=1), executor="A")
        self.assertEqual(before, [])
        moves, _w = sc.readiness(plan, {}, None, now=NOW, executor="A")
        self.assertEqual([(m["task"], m["from"], m["to"]) for m in moves], [("T001", "planned", "ready")])
        self.assertIn(f"release:{NOW_TEXT}", moves[0]["evidence"])
        st = {"A": S.build_status("A", {"T001": S.build_task_status("done")})}
        moves, _w = sc.readiness(plan, st, None, now=NOW, executor="A")
        self.assertEqual(sorted(m["task"] for m in moves), ["T002", "T003"])

    def test_unapproved_plan_releases_nothing(self) -> None:
        raw = dag7()
        raw["approved"] = None
        self.assertEqual(sc.readiness(model(raw), {}, None, now=NOW, executor="A")[0], [])
        self.assertEqual(len(sc.readiness(model(dag7()), {}, None, now=NOW, executor="A")[0]), 1)

    def test_ready_back_to_planned_and_failed_to_ready(self) -> None:
        plan = model(dag7(T001={"release_utc": at(30)}, T002={"max_attempts": 2}))
        st = {"A": S.build_status("A", {"T001": S.build_task_status("ready"),
                                        "T003": S.build_task_status("failed", attempts=1),
                                        "T004": S.build_task_status("failed", attempts=2)})}
        moves = {m["task"]: (m["from"], m["to"]) for m in sc.readiness(plan, st, None, now=NOW, executor="A")[0]}
        self.assertEqual(moves, {"T001": ("ready", "planned"), "T003": ("failed", "ready")})

    def test_cross_executor_dependency_needs_its_receipt(self) -> None:
        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        raw = dag7(T001={"executor": "B"})
        layout = S.state_dir(tmp, plan=raw)
        st = {"A": S.build_status("A"), "B": S.build_status("B", {"T001": S.build_task_status("done")})}
        moves, waiting = sc.readiness(model(raw), st, None, now=NOW, executor="A", layout=layout)
        self.assertEqual(moves, [])
        self.assertEqual(waiting, [{"task": "T002", "dep": "T001", "executor": "B"},
                                   {"task": "T003", "dep": "T001", "executor": "B"}])
        plan = model(raw)
        dep = plan.by_id["T001"]
        good = cross_evidence(layout, raw, "T001", "B")
        moves, waiting = sc.readiness(plan, st, None, now=NOW, executor="A", layout=layout)
        self.assertEqual([m["task"] for m in moves], ["T002", "T003"])  # positive control: every condition holds
        self.assertEqual(waiting, [])
        self.assertEqual(sc.cross_receipt_problems(dep, plan, layout), [])

        def refused(label: str) -> None:
            self.assertEqual(sc.readiness(plan, st, None, now=NOW, executor="A", layout=layout)[0], [], label)
            self.assertTrue(sc.cross_receipt_problems(dep, plan, layout), label)

        # each broken receipt condition alone refuses (SCHEMAS.md 4.3 #1-#7, git ancestry excepted: Q-B03-2)
        no_nc = {"required": True, "ran": False, "exit_code": None, "met": False}
        broken = {
            "#1 schema-invalid": {"unexpected": 1},
            "#1 fail verdict": {"verdict": "fail"},
            "#2 not on origin/main": {"on_origin_main": False},
            "#2 other sha": {"sha": "9" * 40},
            "#3 stale proof hash": {"proof_hash": "b" * 64},
            "#4 exit code differs": {"exit_code": 3},
            "#4 cites another run": {"run": "T001-11111111-20261003T071300Z-2"},
            "#5 self-verified": {"by": {**good["by"], "agent_id": good["implementer"]["agent_id"]}},
            "#5 not a verifier": {"by": {**good["by"], "agent_type": "execution-implementer"}},
            "#5 implementer result absent": {"implementer": {**good["implementer"],
                                                              "result": "proofs/impl/T001.a9.json"}},
        }
        for label, over in broken.items():
            S.write_json(layout.receipt("T001"), {**good, **over})
            refused(label)
        S.write_json(layout.receipt("T001"), good)
        # broken tracked copies, one at a time
        run_path = layout.proof_run_copy("T001", good["run"])
        run_ok = jsonio.read_json(run_path)
        copies = {
            "#2 merge copy absent": (layout.merge_copy("T001", 1), None),
            "#2 merge copy not landed": (layout.merge_copy("T001", 1), S.build_merge_receipt("T001",
                                                                                             outcome="conflict")),
            "#4 run copy absent": (run_path, None),
            "#4 run of another sha": (run_path, {**run_ok, "sha": "9" * 40}),
            "#4 run expectation not met": (run_path, {**run_ok, "expectation": {"met": False, "details": ["x"]}}),
        }
        for label, (path, doc) in copies.items():
            before = jsonio.read_json(path)
            if doc is None:
                path.unlink()
            else:
                S.write_json(path, doc)
            refused(label)
            S.write_json(path, before)
        self.assertEqual(sc.cross_receipt_problems(dep, plan, layout), [])  # restored: positive control again
        # #6 the negative control neither in the receipt nor in the run copy
        S.write_json(layout.receipt("T001"), {**good, "negative_control": no_nc})
        S.write_json(run_path, {**run_ok, "negative_control": {**run_ok["negative_control"], "ran": False,
                                                               "met": False}})
        refused("#6 negative control")
        S.write_json(run_path, run_ok)  # the run copy's control alone satisfies #6
        self.assertEqual(sc.cross_receipt_problems(dep, plan, layout), [])
        S.write_json(layout.receipt("T001"), good)
        # #2 the status landed_sha disagrees with the receipt
        st_other = {"A": S.build_status("A"), "B": S.build_status("B", {"T001": S.build_task_status(
            "done", landed_sha="9" * 40)})}
        self.assertEqual(sc.readiness(plan, st_other, None, now=NOW, executor="A", layout=layout)[0], [])
        self.assertEqual(len(sc.readiness(plan, st, None, now=NOW, executor="A", layout=layout)[0]), 2)

    def test_unverifiable_cross_evidence_never_moves_ready_back(self) -> None:
        # B03-V6: status (B04) may have made T002 ready with its own full check; schedule reverses ready -> planned
        # only when a dependency's STATUS is no longer done or the release moved later (SCHEMAS.md 4.2).
        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        raw = dag7(T001={"executor": "B"})
        layout = S.state_dir(tmp, plan=raw)
        plan = model(raw)
        st = {"A": S.build_status("A", {"T002": S.build_task_status("ready")}),
              "B": S.build_status("B", {"T001": S.build_task_status("done")})}
        moves, waiting = sc.readiness(plan, st, None, now=NOW, executor="A", layout=layout)
        self.assertEqual(moves, [])  # no receipt at all, yet no ready -> planned
        self.assertIn({"task": "T002", "dep": "T001", "executor": "B"}, waiting)
        # positive control: the dependency's status is no longer done -> ready -> planned
        st["B"] = S.build_status("B", {"T001": S.build_task_status("running")})
        moves, _w = sc.readiness(plan, st, None, now=NOW, executor="A", layout=layout)
        self.assertEqual([(m["task"], m["from"], m["to"], m["evidence"][-1]) for m in moves],
                         [("T002", "ready", "planned", "dependency-not-done")])

    def test_cross_executor_without_layout_is_an_internal_error(self) -> None:
        # B03-V7: a status line without its receipt never satisfies a dependency (TWO-DEV.md 5)
        raw = dag7(T001={"executor": "B"})
        st = {"A": S.build_status("A"), "B": S.build_status("B", {"T001": S.build_task_status("done")})}
        with self.assertRaises(sc.InternalError):
            sc.readiness(model(raw), st, None, now=NOW, executor="A")
        # positive control: own dependencies need no layout
        st_own = {"A": S.build_status("A", {"T001": S.build_task_status("done")})}
        self.assertEqual(len(sc.readiness(model(dag7()), st_own, None, now=NOW, executor="A")[0]), 2)


B01_DOCS = S.B01_FIXTURES / "docs"


def b01_doc(name: str) -> dict:
    return jsonio.read_json(B01_DOCS / f"{name}.ok.json")


def cross_evidence(layout: object, raw: dict, tid: str = "T001", executor: str = "B") -> dict:
    """Every tracked copy the cross-executor done check reads (SCHEMAS.md 1.1, 4.3) for a landed, verified agent
    task: the receipt, the merge copy, the run copy and the implementer copy. Returns the receipt."""
    digest = planmod.proof_digest(next(t for t in raw["tasks"] if t["id"] == tid))
    run_id = S.RUN_ID.replace("T001", tid)
    receipt = S.build_receipt(tid, executor=executor, proof_hash=digest)
    S.write_json(layout.receipt(tid), receipt)
    S.write_json(layout.merge_copy(tid, 1), S.build_merge_receipt(tid))
    run = b01_doc("proof-run")
    run.update({"run_id": run_id, "task": tid, "sha": S.SHA_A, "proof_hash": digest})
    run["by"]["executor"] = executor
    S.write_json(layout.proof_run_copy(tid, run_id), run)
    impl = b01_doc("result-implementer")
    impl["task"] = tid
    S.write_json(layout.impl_copy(tid, 1), impl)
    return receipt


def answer_file(layout: object, key: str, task: str, *, ok: bool = True, bb: str | None = None,
                scope_change: bool | None = None) -> Path:
    header = {"schema": "execution.answer/1", "key": key, "task": task, "decision": None,
              "bring_back_key": bb or key, "kind": "text", "source": "terminal", "received_utc": S.FIXED_NOW,
              "by": "devA", "value": None, "attachments": [],
              "verification": {"method": "owner-attest", "ok": ok, "detail": "test", "at_utc": S.FIXED_NOW,
                               "command": None, "exit_code": None}}
    if scope_change is not None:
        header["scope_change"] = scope_change
    assert schema.validate(header, "answer").ok
    return S.write_text(layout.answer(key), "```json\n" + jsonio.dumps_document(header) + "```\n\nfait\n")


def decision_line(doc: dict) -> str:
    assert schema.validate(doc, "decision").ok
    return "<!-- execution-decision " + json.dumps(doc, sort_keys=True) + " -->\n"


class CrossHumanDependency(unittest.TestCase):
    """B03-V6, TWO-DEV.md 5 #3: a done manual or decision task of the other executor satisfies readiness with its
    answer or resolution (no receipt exists for human tasks), and never moves a ready task back."""

    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, self.tmp)

    def plan(self, kind: str, **over: object) -> tuple[dict, object]:
        human = S.build_task("T001", kind=kind, executor="A", **over)
        tasks = [human, S.build_task("T002", executor="B", deps=("T001",)),
                 S.build_task("T003", executor="B"), S.build_task("T004", executor="B", deps=("T003",))]
        raw = S.approve(S.build_plan(tasks))
        return raw, S.state_dir(self.tmp, executor="B", plan=raw)

    @staticmethod
    def statuses(t002: str, **dep: object) -> dict:
        return {"A": S.build_status("A", {"T001": S.build_task_status("done", **dep)}),
                "B": S.build_status("B", {"T002": S.build_task_status(t002), "T004": S.build_task_status("ready")})}

    def moves(self, raw: dict, layout: object, st: dict) -> tuple[dict, list]:
        moves, waiting = sc.readiness(model(raw), st, None, now=NOW, executor="B", layout=layout)
        return {m["task"]: (m["from"], m["to"], m["evidence"][-1]) for m in moves}, waiting

    def test_manual_dependency(self) -> None:
        raw, layout = self.plan("manual")
        for t002 in ("planned", "ready"):
            moves, waiting = self.moves(raw, layout, self.statuses(t002))
            self.assertNotIn("T002", moves, t002)  # no answer yet: never ready, never moved back
            self.assertEqual(waiting, [{"task": "T002", "dep": "T001", "executor": "A"}])
            # positive control: an own dependency that is not done still moves ready -> planned
            self.assertEqual(moves["T004"], ("ready", "planned", "dependency-not-done"))
        # answers that unblock nothing: unverified, relayed, scope change, another bring_back key
        for label, kwargs in {"unverified": {"key": "T001-done", "ok": False},
                              "relayed": {"key": "T001-done-relay-B", "bb": "T001-done"},
                              "scope change": {"key": "T001-done", "scope_change": True},
                              "other key": {"key": "T001-other"}}.items():
            path = answer_file(layout, task="T001", **kwargs)
            moves, _w = self.moves(raw, layout, self.statuses("planned"))
            self.assertNotIn("T002", moves, label)
            path.unlink()
        answer_file(layout, "T001-done", "T001")
        moves, waiting = self.moves(raw, layout, self.statuses("planned"))
        self.assertEqual(moves["T002"][:2], ("planned", "ready"))
        self.assertEqual(waiting, [])
        self.assertEqual(sc.cross_human_problems(model(raw).by_id["T001"], model(raw), layout), [])

    def test_decision_dependency(self) -> None:
        raw, layout = self.plan("decision")
        proposal = {"schema": "execution.decision/1", "record": "proposal", "id": "D-007", "at_utc": S.FIXED_NOW,
                    "by": "exec@A", "kind": "other", "title": "Choisir", "tasks": ["T001"],
                    "options": [{"id": "yes", "label": "Oui", "consequence": "go"},
                                {"id": "no", "label": "Non", "consequence": "stop"}],
                    "recommended": "yes", "deadline_utc": None, "dedup": "d" * 64}
        resolution = {"schema": "execution.decision/1", "record": "resolution", "id": "D-007",
                      "at_utc": S.FIXED_NOW, "by": "devA", "choice": "yes", "source": "terminal", "quote": "oui"}
        st = self.statuses("ready", decision="D-007")
        S.write_text(layout.decisions, decision_line(proposal))
        moves, waiting = self.moves(raw, layout, st)
        self.assertNotIn("T002", moves)  # proposal only: not ready, and the ready task is not moved back
        self.assertEqual(waiting, [{"task": "T002", "dep": "T001", "executor": "A"}])
        S.write_text(layout.decisions, decision_line(proposal) + decision_line({**resolution, "choice": "maybe"}))
        self.assertTrue(sc.cross_human_problems(model(raw).by_id["T001"], model(raw), layout,
                                                st["A"]["tasks"]["T001"]))
        S.write_text(layout.decisions, decision_line(proposal) + decision_line(resolution))
        self.assertEqual(sc.cross_human_problems(model(raw).by_id["T001"], model(raw), layout,
                                                 st["A"]["tasks"]["T001"]), [])
        moves, waiting = self.moves(raw, layout, self.statuses("planned", decision="D-007"))
        self.assertEqual(moves["T002"][:2], ("planned", "ready"))
        self.assertEqual(waiting, [])
        # the resolution of another decision id than the status entry's does not count
        moves, _w = self.moves(raw, layout, self.statuses("planned", decision="D-008"))
        self.assertNotIn("T002", moves)

    def test_file_proof_needs_its_tracked_run(self) -> None:
        proof = {"type": "file", "spec": {"path": "C:/x/qc/repo/.execution/frontend/choices.json",
                                          "json_pointer": "/palette"},
                 "expect": {"summary": "the choice is recorded"}, "max_runtime_min": 1,
                 "negative_control": {"kind": "not-applicable", "description": "a human step",
                                      "expect_nonzero": True, "waived_reason": "nothing to falsify by script"}}
        raw, layout = self.plan("manual", proof=proof)
        answer_file(layout, "T001-done", "T001")
        moves, _w = self.moves(raw, layout, self.statuses("planned"))
        self.assertNotIn("T002", moves)  # the answer alone: the file proof's run is missing
        digest = planmod.proof_digest(next(t for t in raw["tasks"] if t["id"] == "T001"))
        run = b01_doc("proof-run")
        run.update({"run_id": "T001-11111111-20261003T071200Z-1", "task": "T001", "type": "file", "command": None,
                    "proof_hash": digest, "checkout": {"kind": "none", "path": None, "removed": False}})
        run["by"] = {**run["by"], "role": "orchestrator", "agent_type": None}
        run["negative_control"] = None
        path = layout.proof_run_copy("T001", run["run_id"])
        S.write_json(path, {**run, "expectation": {"met": False, "details": ["absent"]}})
        self.assertNotIn("T002", self.moves(raw, layout, self.statuses("planned"))[0])
        S.write_json(path, run)
        self.assertEqual(self.moves(raw, layout, self.statuses("planned"))[0]["T002"][:2], ("planned", "ready"))

    def test_schedule_command_keeps_the_ready_task(self) -> None:
        # the verifier's tick order: status made T002 ready, then `schedule` runs on B's machine
        raw, layout = self.plan("manual")
        S.write_json(layout.profile, S.build_profile())
        st = self.statuses("ready")
        S.write_json(layout.status("A"), st["A"])
        S.write_json(layout.status("B"), st["B"])
        code, env, _logs = S.run_exec(["schedule", "--state", str(layout.state), "--executor", "B",
                                       "--samples", "500"], self.tmp, S.env_isolated(EXEC_NOW=NOW_TEXT))
        self.assertEqual(code, 0, env)
        self.assertEqual(statusio.load(layout, "B")["tasks"]["T002"]["status"], "ready")
        self.assertEqual(env["data"]["waiting_on_other"], [{"task": "T002", "dep": "T001", "executor": "A"}])
        # positive control: the same run moved the own task whose own dependency is not done
        self.assertEqual(statusio.load(layout, "B")["tasks"]["T004"]["status"], "planned")


class ScheduleCommand(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, self.tmp)

    def prepare(self, raw: dict) -> object:
        layout = S.state_dir(self.tmp, plan=raw)
        S.write_json(layout.profile, S.build_profile())
        return layout

    def run_schedule(self, layout: object, *extra: str) -> tuple[int, dict]:
        code, env, _logs = S.run_exec(["schedule", "--state", str(layout.state), "--executor", "A",
                                       "--samples", "500", *extra], self.tmp,
                                      S.env_isolated(EXEC_NOW=NOW_TEXT))
        return code, env

    def test_transitions_cache_and_events(self) -> None:
        layout = self.prepare(dag7())
        code, env = self.run_schedule(layout)
        self.assertEqual(code, 0, env)
        data = env["data"]
        self.assertEqual([r["task"] for r in data["ready"]], ["T001"])
        self.assertEqual(data["ready"][0]["rank"], 1)
        self.assertTrue(data["ready"][0]["critical"])
        self.assertEqual(data["critical_path"], ["T001", "T003", "T005", "T007"])
        self.assertEqual(data["transitions"][0]["to"], "ready")
        status = statusio.load(layout, "A")
        entry = status["tasks"]["T001"]
        self.assertEqual((entry["status"], entry["history"][-1]["by"]), ("ready", "schedule"))
        cache = jsonio.read_json(layout.schedule_cache)
        self.assertEqual(cache, data)
        types = [ev["type"] for _n, ev in jsonio.read_jsonl(layout.events)]
        self.assertEqual(types.count("task.status"), 1)
        self.assertEqual(types.count("schedule"), 1)
        self.assertEqual(data["build_complete"]["plan_deadline_utc"], None)
        self.assertTrue(data["build_complete"]["stale"])
        # converging: a second run applies nothing more
        code, env2 = self.run_schedule(layout)
        self.assertEqual((code, env2["data"]["transitions"]), (0, []))
        # usage errors
        self.assertEqual(self.run_schedule(layout, "--samples", "3000")[0], 2)
        self.assertEqual(self.run_schedule(layout, "--lanes", "0")[0], 2)

    def test_red_zone_proposes_and_never_cuts(self) -> None:
        tasks = dag7()["tasks"]
        tasks[5]["required"] = False  # T006 optional: a cut candidate
        tasks[6]["depends_on"] = ["T005"]
        raw = S.approve(S.build_plan(tasks, deadlines=[
            {"id": "DL-submission", "title": "Submission", "at_utc": at(60), "kind": "submission",
             "irrecoverable": True, "gate_phase": "deliverable", "source": "test"}]))
        layout = self.prepare(raw)
        code, env = self.run_schedule(layout)
        self.assertEqual(code, 0)
        zone = env["data"]["zones"][0]
        self.assertEqual(zone["zone"], "red")
        props = env["data"]["proposals"]
        self.assertEqual(len(props), 1)
        self.assertEqual((props[0]["kind"], props[0]["tasks"]), ("cut", ["T006"]))
        header = {"schema": "execution.decision/1", "record": "proposal", "id": "D-011", "at_utc": S.FIXED_NOW,
                  "by": "exec@A", "dedup": S.sha(S.canonical([props[0]["kind"], props[0]["title"], ["T006"]])),
                  **props[0]}
        self.assertTrue(schema.validate(header, "decision").ok)  # the draft is a valid proposal header
        statuses = {e["status"] for e in statusio.load(layout, "A")["tasks"].values()}
        self.assertTrue(statuses.isdisjoint({"cut", "cut-proposed"}))
        self.assertIn("ready", statuses)  # positive control: the command did write transitions

    def test_invalid_plan_exits_1(self) -> None:
        raw = dag7()
        layout = self.prepare(raw)
        broken = jsonio.read_json(layout.plan)
        del broken["tasks"][0]["estimate"]
        S.write_json(layout.plan, broken)
        self.assertEqual(self.run_schedule(layout)[0], 1)


if __name__ == "__main__":
    unittest.main()
