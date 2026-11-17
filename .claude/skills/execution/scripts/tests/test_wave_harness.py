"""The generated wave script under Node with a fake agent() (contract/LANES.md B05, WAVES.md 10, TESTS.md 6).

Protects the script's sequencing: dependencies gate on `done`, nulls are reruns, throws are infra-errors (never
reruns), `args.skip`, semaphore limits (browser slots held for the whole task and never exceeded, integrator slots
never exceeded, each with a wider positive control), lanes and unary resources, priority order, the return shape,
/frontend fragments called with `api = {agent, parallel, pipeline, log}`, the in-wave fix loop, and that the script
never reads the clock. Case 10 (WAVES.md 10) runs /frontend's real fragments from pinned copies
(fixtures/B05/frontend-real); the installed files are compared with them only in the live tier (EXEC_CONTRACT_LIVE=1).
Each negative assertion has its positive control in the same test.

Run: python -m unittest discover -s scripts/tests -p "test_wave_harness.py" -v
"""
from __future__ import annotations

import unittest

import _support as S
import _support_B05 as W

from execlib import schema

RETURN_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["wave", "outcomes"],
    "properties": {
        "wave": {"type": "string", "pattern": "^W[0-9]{2,3}$"},
        "outcomes": {"type": "object", "propertyNames": {"pattern": "^T[0-9]{3,}$"},
                     "additionalProperties": {"enum": ["done", "failed", "rerun", "blocked-manual", "blocked-decision",
                                                       "skipped-dep", "infra-error", "recorded"]}}}}
LANDED = {"status": "built", "merge": {"receipt_path": None, "outcome": "landed", "landed_sha": "a" * 40,
                                       "exit_code": 0}}


@unittest.skipUnless(W.node_available(), "node is needed")
class WaveHarnessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def run_wave(self, tasks: list[dict], scenario: dict | None = None, *, name: str = "run", **man_over) -> dict:
        man = W.harness_manifest(tasks, **{k: v for k, v in man_over.items() if k in ("writers", "verifiers",
                                                                                        "browser", "integrators",
                                                                                        "pre_t0")})
        script = W.render_script(man, extra=man_over.get("extra"), fragments=man_over.get("fragments", ()))
        sc = {"args": {"now_utc": S.FIXED_NOW, "skip": []}}
        sc.update(scenario or {})
        doc = W.run_harness(script, sc, self.tmp / name)
        self.assertIsNone(doc["error"], doc["error"])
        return doc

    # 1 ------------------------------------------------------------------------------------------------------------
    def test_dependency_waits_for_done_and_a_rerun_skips_the_dependent(self) -> None:
        tasks = [W.harness_task("T001", lane="L1"), W.harness_task("T002", lane="L2", deps=["T001"], rank=1)]
        ok = self.run_wave(tasks, name="ok")
        verdict1 = W.calls_of(ok, "T001 verifier")[0]
        impl2 = W.calls_of(ok, "T002 implementer")[0]
        self.assertGreater(impl2["start"], verdict1["end"], "T002 started before T001 resolved done")
        self.assertEqual(ok["returned"]["outcomes"], {"T001": "done", "T002": "done"})
        bad = self.run_wave(tasks, {"responses": {"T001 implementer": None}}, name="bad")
        self.assertEqual(bad["returned"]["outcomes"], {"T001": "rerun", "T002": "skipped-dep"})
        self.assertEqual(W.calls_of(bad, "T002"), [], "a skipped dependent's agents were called")

    # 2 ------------------------------------------------------------------------------------------------------------
    def test_null_throw_exit3_and_receiptless_pass(self) -> None:
        t = [W.harness_task("T001")]
        cases = [
            ({"T001 implementer": None}, "rerun"),
            ({"T001 verifier": None}, "rerun"),
            ({"T001 implementer": {"__throw": "Agent type 'x' not found"}}, "infra-error"),
            ({"T001 verifier": {"__throw": "schema unsatisfiable"}}, "infra-error"),
            ({"T001 implementer": {"status": "failed", "merge": {"receipt_path": None, "outcome": None,
                                                                  "landed_sha": None, "exit_code": 3}}}, "rerun"),
            ({"T001 verifier": {"verdict": "pass", "receipt_sha256": None}}, "rerun"),
            ({"T001 verifier": {"verdict": "pass", "receipt_sha256": "c" * 64}}, "done"),
            ({"T001 verifier": {"verdict": "fail", "receipt_sha256": "c" * 64}}, "failed"),
            ({"T001 implementer": {"status": "blocked", "blocked": {"kind": "manual", "reason": "r", "needed": "n"}}},
             "blocked-manual"),
        ]
        for i, (responses, expected) in enumerate(cases):
            with self.subTest(expected=expected, case=i):
                doc = self.run_wave(t, {"responses": responses}, name=f"c{i}",
                                    extra=W.harness_extra(in_wave_fix=False))
                self.assertEqual(doc["returned"]["outcomes"]["T001"], expected)
        # the throw is logged with its message and never read as a rerun
        doc = self.run_wave(t, {"responses": {"T001 implementer": {"__throw": "Agent type 'x' not found"}}},
                            name="log")
        self.assertTrue(any("threw" in line and "not found" in line for line in doc["logs"]))
        self.assertNotEqual(doc["returned"]["outcomes"]["T001"], "rerun")

    # 3 ------------------------------------------------------------------------------------------------------------
    def test_skip_tasks_are_not_run_and_dependents_run(self) -> None:
        tasks = [W.harness_task("T001"), W.harness_task("T002", lane="L2", deps=["T001"])]
        doc = self.run_wave(tasks, {"args": {"now_utc": S.FIXED_NOW, "skip": ["T001"]}}, name="skip")
        self.assertEqual(W.calls_of(doc, "T001"), [])
        self.assertTrue(W.calls_of(doc, "T002 implementer"), "the dependent of a skipped task did not run")
        self.assertEqual(doc["returned"]["outcomes"], {"T001": "done", "T002": "done"})

    # 4 ------------------------------------------------------------------------------------------------------------
    def test_semaphores_lanes_and_unary_resources(self) -> None:
        tasks = [W.harness_task(f"T00{i}", lane=f"L{i}", rank=i) for i in range(1, 6)]
        tasks.append(W.harness_task("T006", lane="L1", rank=6))           # same lane as T001
        tasks[1]["resources"] = ["wallet:w1"]
        tasks[2]["resources"] = ["wallet:w1"]                              # T002, T003 share a wallet
        tasks[3]["resources"] = ["browser"]
        tasks[4]["resources"] = ["browser"]
        doc = self.run_wave(tasks, {"lanes": {t["task"]: t["lane"] for t in tasks}, "browser": ["T004", "T005"]},
                            name="sem", writers=2, verifiers=1, browser=1)
        self.assertLessEqual(doc["peaks"]["writers"], 2)
        self.assertLessEqual(doc["peaks"]["verifiers"], 1)
        self.assertLessEqual(doc["peaks"]["browser"], 1)
        self.assertTrue(all(v <= 1 for v in doc["peaks"]["lanes"].values()), doc["peaks"]["lanes"])
        self.assertFalse(W.overlap(doc["intervals"]["T002"], doc["intervals"]["T003"]), "wallet holders overlapped")
        self.assertFalse(W.overlap(doc["intervals"]["T004"], doc["intervals"]["T005"]),
                         "two browser tasks ran at once with one browser slot")
        # positive control: with more slots the writers do run in parallel, and so do the two browser tasks
        wide = self.run_wave(tasks, {"lanes": {t["task"]: t["lane"] for t in tasks}, "browser": ["T004", "T005"]},
                             name="wide", writers=4, verifiers=2, browser=2)
        self.assertGreaterEqual(wide["peaks"]["writers"], 2)
        self.assertGreaterEqual(wide["peaks"]["verifiers"], 1)
        self.assertEqual(set(wide["returned"]["outcomes"].values()), {"done"})
        self.assertTrue(W.overlap(wide["intervals"]["T004"], wide["intervals"]["T005"]), wide["intervals"])
        self.assertEqual(wide["peaks"]["browser"], 2)

    def test_browser_slots_are_held_for_the_whole_task(self) -> None:
        """LANES.md B05 / TESTS.md 6: browser slots are never exceeded. A browser slot is held from the first agent
        of the task to its verdict (WAVES.md 3.4), so with one slot two browser tasks never overlap, even when the
        writer and verifier budgets would let them; with two slots they do (positive control)."""
        tasks = [W.harness_task("T001", lane="L1", rank=0, resources=["browser"]),
                 W.harness_task("T002", lane="L2", rank=1, resources=["browser"])]
        scenario = {"lanes": {"T001": "L1", "T002": "L2"}, "browser": ["T001", "T002"]}
        one = self.run_wave(tasks, scenario, name="b-one", writers=2, verifiers=2, browser=1)
        self.assertEqual(one["returned"]["outcomes"], {"T001": "done", "T002": "done"})
        self.assertFalse(W.overlap(one["intervals"]["T001"], one["intervals"]["T002"]), one["intervals"])
        self.assertEqual(one["peaks"]["browser"], 1)
        # T002 starts only after T001's verifier released the slot: the order is the priority order
        self.assertGreater(W.calls_of(one, "T002 implementer")[0]["start"], W.calls_of(one, "T001 verifier")[0]["end"])
        two = self.run_wave(tasks, scenario, name="b-two", writers=2, verifiers=2, browser=2)
        self.assertTrue(W.overlap(two["intervals"]["T001"], two["intervals"]["T002"]), two["intervals"])
        self.assertEqual(two["peaks"]["browser"], 2)

    def test_integrator_slots_are_never_exceeded(self) -> None:
        """WAVES.md 10 case 4: merge-only integrator steps run under the `integrators` limit. Two test-designer
        chains in two lanes reach their integrator step at the same time: with one integrator slot the calls never
        overlap; with two they do (positive control)."""
        chain = ("test-designer", "integrator", "verifier")
        tasks = [W.harness_task("T001", lane="L1", rank=0, chain=chain),
                 W.harness_task("T002", lane="L2", rank=1, chain=chain)]
        scenario = {"lanes": {"T001": "L1", "T002": "L2"}, "delays": {"T001 integrator": 6, "T002 integrator": 6}}
        one = self.run_wave(tasks, scenario, name="i-one", writers=2, verifiers=2, integrators=1)
        self.assertEqual(one["returned"]["outcomes"], {"T001": "done", "T002": "done"})
        self.assertEqual(one["peaks"]["integrators"], 1)
        i1, i2 = W.calls_of(one, "T001 integrator")[0], W.calls_of(one, "T002 integrator")[0]
        self.assertFalse(W.overlap((i1["start"], i1["end"]), (i2["start"], i2["end"])), (i1, i2))
        two = self.run_wave(tasks, scenario, name="i-two", writers=2, verifiers=2, integrators=2)
        self.assertEqual(two["peaks"]["integrators"], 2)

    def test_browser_task_without_slots_is_rerun(self) -> None:
        tasks = [W.harness_task("T001", resources=["browser"])]
        doc = self.run_wave(tasks, name="nob", browser=0)
        self.assertEqual(doc["returned"]["outcomes"]["T001"], "rerun")
        self.assertEqual(doc["calls"], [])
        ok = self.run_wave(tasks, name="b1", browser=1)
        self.assertEqual(ok["returned"]["outcomes"]["T001"], "done")

    # 5 ------------------------------------------------------------------------------------------------------------
    def test_priority_order_with_one_writer(self) -> None:
        # T001 arrives first and takes the free slot at once; the WAITERS are then served by rank, not by arrival
        tasks = [W.harness_task("T001", lane="L1", rank=5), W.harness_task("T002", lane="L2", rank=2),
                 W.harness_task("T003", lane="L3", rank=0), W.harness_task("T004", lane="L4", rank=1)]
        doc = self.run_wave(tasks, name="prio", writers=1)
        order = [c["task"] for c in doc["calls"] if c["role"] == "implementer"]
        self.assertEqual(order, ["T001", "T003", "T004", "T002"])

    # 6 ------------------------------------------------------------------------------------------------------------
    def test_return_value_is_wave_and_outcomes_only(self) -> None:
        tasks = [W.harness_task("T001"), W.harness_task("T002", lane="L2")]
        doc = self.run_wave(tasks, {"responses": {"T002 verifier": None}}, name="ret")
        self.assertEqual(set(doc["returned"].keys()), {"wave", "outcomes"})
        self.assertEqual(set(doc["returned"]["outcomes"]), {"T001", "T002"})
        report = schema.validate_with(doc["returned"], RETURN_SCHEMA, base_dir=S.TESTS_DIR)
        self.assertTrue(report.ok, report.issues)
        bad = schema.validate_with({"wave": "W01", "outcomes": {"T001": "maybe"}}, RETURN_SCHEMA,
                                   base_dir=S.TESTS_DIR)
        self.assertFalse(bad.ok, "the shape check accepts anything (positive control)")

    def test_explicit_model_and_effort_and_no_clock(self) -> None:
        tasks = [W.harness_task("T001")]
        doc = self.run_wave(tasks, name="opts")
        self.assertTrue(all(c["model"] and c["effort"] for c in doc["calls"]))
        # the harness throws on an option-less call (positive control of the check above)
        tasks[0]["agents"]["implementer"].pop("effort")
        man = W.harness_manifest(tasks)
        script = W.render_script(man)
        res = W.run_harness(script, {"args": {"now_utc": S.FIXED_NOW, "skip": []}}, self.tmp / "noeff")
        self.assertEqual(res["returned"]["outcomes"]["T001"], "infra-error")
        # the clock: a script reading Date.now() fails under the harness (its Date is a throwing proxy)
        clock_script = "const x = Date.now();\nreturn {wave: 'W01', outcomes: {}};\n"
        res = W.run_harness(clock_script, {"args": {}}, self.tmp / "clock")
        self.assertIsNotNone(res["error"])
        fine = W.run_harness("const d = new Date('2026-10-03T07:12:00Z');\nreturn {wave: 'W01', outcomes: {}};\n",
                             {"args": {}}, self.tmp / "clock-ok")
        self.assertIsNone(fine["error"])

    # 7 ------------------------------------------------------------------------------------------------------------
    def test_fragments_get_the_tracked_api(self) -> None:
        crit = W.fake_fragment("feCritique")
        dirs = W.fake_fragment("feDirections")
        t1 = W.harness_task("T001", chain=("fe-critique", "integrator", "verifier"))
        t2 = W.harness_task("T002", lane="L2", chain=("fe-directions", "integrator", "verifier"))
        fe = {"T001": {"fragment": "feCritique", "input": {"task": "T001", "cwd": "C:/s/fe/T001-a1r0",
                                                           "behaviour": "ok",
                                                           "agents": {"critic": {"agentType": "frontend-critic",
                                                                                 "model": "opus", "effort": "high"}}},
                       "prepare": {"command": "python exec.py fe-workspace --task T001 --attempt 1 --rerun 0",
                                   "worktree": "C:/s/fe/T001-a1r0", "branch": "exec/T001-a1r0"},
                       "receipt_inbox": "C:/repo/.execution/local/inbox/W01/T001.fe-critique.a1r0.json"},
              "T002": {"fragment": "feDirections", "input": {"task": "T002", "cwd": "C:/repo", "behaviour": "ok"},
                       "receipt_inbox": "C:/repo/.execution/local/inbox/W01/T002.fe-directions.a1r0.json"}}
        doc = self.run_wave([t1, t2], name="fe", extra=W.harness_extra(fe=fe), fragments=[crit, dirs])
        self.assertEqual(doc["returned"]["outcomes"], {"T001": "done", "T002": "done"})
        api_lines = [line for line in doc["logs"] if "api=" in line]
        self.assertEqual(len(api_lines), 2)
        self.assertTrue(all("api=agent,log,parallel,pipeline " in line + " " for line in api_lines), api_lines)
        prep = W.calls_of(doc, "T001 prepare")
        critic = W.calls_of(doc, "T001 fragment critic")
        self.assertTrue(prep and critic and prep[0]["end"] < critic[0]["start"], "prepare must run before")
        self.assertTrue(W.calls_of(doc, "T001 keep receipt"), "the receipt was not copied to the inbox")
        # a null inside the fragment -> rerun; not ok without nulls -> failed; prepare exit != 0 -> failed
        null = self.run_wave([t1], {"responses": {"T001 fragment critic": None}}, name="fe-null",
                             extra=W.harness_extra(fe={"T001": fe["T001"]}, in_wave_fix=False), fragments=[crit])
        self.assertEqual(null["returned"]["outcomes"]["T001"], "rerun")
        notok = W.deep(fe["T001"])
        notok["input"]["behaviour"] = "notok"
        res = self.run_wave([t1], name="fe-notok", extra=W.harness_extra(fe={"T001": notok}, in_wave_fix=False),
                            fragments=[crit])
        self.assertEqual(res["returned"]["outcomes"]["T001"], "failed")
        prep_fail = self.run_wave([t1], {"responses": {"T001 prepare a1": {"exit_code": 1, "json": None,
                                                                           "stderr_tail": "boom"}}},
                                  name="fe-prep", extra=W.harness_extra(fe={"T001": fe["T001"]}, in_wave_fix=False),
                                  fragments=[crit])
        self.assertEqual(prep_fail["returned"]["outcomes"]["T001"], "failed")
        self.assertEqual(W.calls_of(prep_fail, "T001 fragment critic"), [])
        # a fragment task without its inlined function is an infra-error, never a rerun
        missing = self.run_wave([t1], name="fe-missing", extra=W.harness_extra(fe={"T001": fe["T001"]}))
        self.assertEqual(missing["returned"]["outcomes"]["T001"], "infra-error")

    # 8 ------------------------------------------------------------------------------------------------------------
    def test_in_wave_fix_loop(self) -> None:
        t = W.harness_task("T001", fix_attempts=[2])
        fix = {"T001": [{"attempt": 2, "brief_path": "C:/repo/.execution/briefs/T001.a2.md"}]}
        on = self.run_wave([t], {"responses": {"T001 verifier": {"verdict": "fail", "receipt_sha256": "c" * 64}}},
                           name="fix-on", extra=W.harness_extra(fix=fix, in_wave_fix=True))
        fix_calls = W.calls_of(on, "T001 implementer a2")
        self.assertEqual(len(fix_calls), 1)
        self.assertEqual(fix_calls[0]["phase"], "Fix")
        self.assertIn("attempt 2", fix_calls[0]["prompt"])
        self.assertIn("T001.a2.md", fix_calls[0]["prompt"])
        self.assertEqual(on["returned"]["outcomes"]["T001"], "done")
        off = self.run_wave([t], {"responses": {"T001 verifier": {"verdict": "fail", "receipt_sha256": "c" * 64}}},
                            name="fix-off", extra=W.harness_extra(fix=fix, in_wave_fix=False))
        self.assertEqual(W.calls_of(off, "T001 implementer a2"), [])
        self.assertEqual(off["returned"]["outcomes"]["T001"], "failed")
        # a rerun never triggers a fix attempt
        rr = self.run_wave([t], {"responses": {"T001 verifier": None}}, name="fix-rr",
                           extra=W.harness_extra(fix=fix, in_wave_fix=True))
        self.assertEqual(W.calls_of(rr, "T001 implementer a2"), [])

    def test_verifier_waits_for_landing_and_gets_the_sha(self) -> None:
        doc = self.run_wave([W.harness_task("T001")], {"responses": {"T001 implementer": LANDED}}, name="sha")
        impl = W.calls_of(doc, "T001 implementer")[0]
        ver = W.calls_of(doc, "T001 verifier")[0]
        self.assertGreater(ver["start"], impl["end"])
        self.assertIn("Landed SHA: " + "a" * 40, ver["prompt"])
        failed = self.run_wave([W.harness_task("T001")], {"responses": {"T001 implementer": {
            "status": "built", "merge": {"receipt_path": None, "outcome": "conflict", "landed_sha": None,
                                         "exit_code": 1}}}}, name="nosha", extra=W.harness_extra(in_wave_fix=False))
        self.assertEqual(W.calls_of(failed, "T001 verifier"), [], "a verifier ran without a landed merge")
        self.assertEqual(failed["returned"]["outcomes"]["T001"], "failed")

    def test_pre_t0_chain_records(self) -> None:
        t = W.harness_task("T001", chain=("implementer",))
        doc = self.run_wave([t], {"responses": {"T001 implementer": {"status": "built", "merge": None}}},
                            name="pre", pre_t0=True)
        self.assertEqual(doc["returned"]["outcomes"]["T001"], "recorded")
        normal = self.run_wave([t], {"responses": {"T001 implementer": LANDED}}, name="nopre")
        self.assertEqual(normal["returned"]["outcomes"]["T001"], "failed", "a chain without a verifier is done")

    # 10 -----------------------------------------------------------------------------------------------------------
    def check_real_fragments(self, frags: list) -> None:
        from execlib import wavejs

        man = W.harness_manifest([W.harness_task("T001", chain=("fe-critique", "integrator", "verifier")),
                                  W.harness_task("T002", lane="L2", chain=("fe-directions", "integrator", "verifier"))])
        script = W.render_script(man, fragments=frags)
        self.assertEqual(wavejs.static_check(script), [])
        path = S.write_text(self.tmp / "real.js", script)
        check = wavejs.node_check(path)
        self.assertEqual(check.exit_code, 0, check.stderr)
        for f in frags:
            self.assertIn(f.source.rstrip("\n"), script, "a fragment was not inlined byte for byte")

    def test_real_frontend_fragments_inline_and_parse(self) -> None:
        """/frontend's real fragments from their pinned copies (fixtures/B05/frontend-real; the fast tier never
        reads ~/.claude): inlined byte for byte, static check clean, the wrapped script parses, and the real
        feCritique runs inside the script with the tracked api (an input without cwd, state and profile: the
        fragment returns a not-ok receipt without calling an agent, so the task is failed, not a rerun)."""
        from execlib import jsonio, wavejs

        frags = [wavejs.load_fragment_full(name, path) for name, path in W.REAL_FRAGMENTS.items()]
        for f in frags:
            self.assertEqual(f.sha256[:8], f.source_path.stem.rsplit("-", 1)[1], "the pinned copy was edited")
            self.assertEqual(f.sha256, jsonio.sha256_file(f.source_path))
        self.check_real_fragments(frags)
        crit = next(f for f in frags if f.name == "feCritique")
        fe = {"T001": {"fragment": "feCritique", "input": {"task": "T001"},
                       "receipt_inbox": "C:/repo/.execution/local/inbox/W01/T001.fe-critique.a1r0.json"}}
        t1 = W.harness_task("T001", chain=("fe-critique", "integrator", "verifier"))
        doc = self.run_wave([t1], name="real-crit", extra=W.harness_extra(fe=fe, in_wave_fix=False),
                            fragments=[crit])
        self.assertEqual(doc["returned"]["outcomes"]["T001"], "failed")
        self.assertTrue(any("input is missing cwd, state, profile" in line for line in doc["logs"]), doc["logs"])
        self.assertTrue(W.calls_of(doc, "T001 keep receipt"), "the receipt was not copied to the inbox")
        self.assertEqual(W.calls_of(doc, "T001 integrator"), [], "a not-ok receipt went on to the integrator")

    @unittest.skipUnless(W.live_contract(), "EXEC_CONTRACT_LIVE=1: reads the installed /frontend (TESTS.md 7, L-05)")
    def test_installed_frontend_fragments_match_the_pinned_copies(self) -> None:
        from execlib import wavejs

        live = [wavejs.load_fragment_full(name) for name in W.REAL_FRAGMENTS]
        self.check_real_fragments(live)
        for f in live:
            pinned = W.REAL_FRAGMENTS[f.name].stem.rsplit("-", 1)[1]
            self.assertEqual(f.sha256[:8], pinned, f"/frontend's {f.source_path.name} changed: refresh the pinned "
                                                   "copy in fixtures/B05/frontend-real deliberately")


if __name__ == "__main__":
    unittest.main()
