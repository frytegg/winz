"""`exec.py status`: reconciliation, run-state derivation and the digest (contract/CLI.md `status`, SCHEMAS.md 4.2
and 4.4, HOOKS.md 4.4 and 7, TESTS.md 3.6, LANES.md B04).

Run: python -m unittest discover -s scripts/tests -p "test_reconcile.py" -v
"""
from __future__ import annotations

import unittest

import _support as S
from _support_B04 import World

from execlib import jsonio, paths, reconcile, statusio


def hook_event(w: World, name: str, type_: str, data: dict, *, ts: str = "2026-10-03T07:11:00.123456Z",
               hook: str = "stop-gate", session: str = S.SESSION_ID) -> None:
    S.write_json(w.layout.hook_events_dir / name, {"ts": ts, "hook": hook, "session_id": session,
                                                   "agent_type": None, "type": type_, "data": data})


def hooks_state(w: World, stuck: dict | None) -> None:
    S.write_json(w.layout.hooks_state, {"schema": "execution.hooks-state/1", "consecutive_continuations": 0,
                                        "last_continuation_utc": None, "last_digest_sha256": None, "stuck": stuck,
                                        "last_stop_utc": None})


def gate_plan() -> list[dict]:
    return [S.build_task("T001", kind="gate", writes=[], template="execution:EX-GATE-BUILD")]


class Reconcile(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset()

    def status(self, *extra: str) -> dict:
        code, env, _l = self.w.run(["status", *extra])
        self.assertEqual(code, 0, env)
        return env["data"]

    def test_crash_mid_wave_converges_to_done_in_one_status(self) -> None:
        w = self.w
        fx = w.done_fixture("T001")
        w.set_status("T001", "running", wave="W01")
        data = self.status()
        self.assertEqual(w.entry("T001")["status"], "done")
        hops = [(h["from"], h["to"]) for h in w.entry("T001")["history"]]
        self.assertEqual(hops, [("running", "built"), ("built", "verifying"), ("verifying", "done")])
        self.assertEqual(w.entry("T001")["landed_sha"], fx["sha"])
        self.assertIn({"task": "T001", "from": "verifying", "to": "done"}, data["reconciled"]["applied"])
        self.assertEqual(w.entry("T002")["status"], "ready")  # its dependency is now done
        again = self.status()
        self.assertEqual(again["reconciled"]["applied"], [])  # converging: nothing left

    def test_null_agent_becomes_a_rerun(self) -> None:
        w = self.w
        w.set_status("T001", "running", attempts=1, reruns=0, consecutive_reruns=0)
        with w.locked():
            doc = statusio.load(w.layout, "A")
            out = reconcile.apply_rerun(w.ctx("wave ingest"), doc, w.task("T001"), "W02", w.plan())
            statusio.save(w.ctx("wave ingest"), doc)
        self.assertEqual(out, "ready")
        entry = w.entry("T001")
        self.assertEqual((entry["attempts"], entry["reruns"], entry["consecutive_reruns"]), (1, 1, 1))

    def test_hook_events_are_imported_once(self) -> None:
        w = self.w
        hook_event(w, "20261003T071100123456Z-11-0.json", "stop.allow", {"reason": "idle-armed"})
        hook_event(w, "20261003T071101123456Z-12-0.json", "guard.deny", {"tool": "Write", "rule": "A8"},
                   hook="pre-tool-guard")
        S.write_text(w.layout.hook_events_dir / "20261003T071102000000Z-13-0.json", "{not json")
        copy = (w.layout.hook_events_dir / "20261003T071100123456Z-11-0.json").read_bytes()
        data = self.status()
        self.assertEqual(data["reconciled"]["hook_events"], 2)
        self.assertEqual([p.name for p in w.layout.hook_events_dir.iterdir()],
                         ["20261003T071102000000Z-13-0.json.invalid"])
        imported = [e for e in w.events() if e.get("id")]
        self.assertEqual(len(imported), 2)
        self.assertEqual(imported[0]["actor"], "hook:stop-gate@A")
        self.assertEqual(imported[0]["session_id"], S.SESSION_ID)
        self.assertEqual(imported[0]["data"]["hook_ts"], "2026-10-03T07:11:00.123456Z")
        self.assertTrue(any(e["type"] == "error" and e["data"].get("kind") == "hook-event-invalid"
                            for e in w.events()))
        # the same file again (a crash between the append and the delete) is not appended twice
        (w.layout.hook_events_dir / "20261003T071100123456Z-11-0.json").write_bytes(copy)
        data = self.status()
        self.assertEqual(data["reconciled"]["hook_events"], 0)
        self.assertEqual(len([e for e in w.events() if e.get("id")]), 2)

    def _run_state(self) -> str:
        return self.status()["run_state"]

    def test_awaiting_human(self) -> None:
        w = self.w
        w.reset([S.build_task("T001", kind="manual")])
        w.set_status("T001", "running", posted={"at_utc": S.FIXED_NOW, "push_text": "T001 · À faire"})
        self.assertEqual(self._run_state(), "AWAITING_HUMAN")
        self.assertEqual(w.local_state()["previous_run_state"], "RUNNING")

    def test_awaiting_decision(self) -> None:
        w = self.w
        w.reset([S.build_task("T001", kind="decision")])
        w.set_status("T001", "running", decision="D-001")
        self.assertEqual(self._run_state(), "AWAITING_DECISION")

    def test_running_when_something_is_ready(self) -> None:
        self.assertEqual(self._run_state(), "RUNNING")
        self.assertEqual(self.w.entry("T001")["status"], "ready")

    def test_derive_run_state_takes_the_modules_md_signature(self) -> None:
        """MODULES.md: derive_run_state(plan, statuses, local_state, hooks_state) -> str; the keywords are optional."""
        w = self.w
        w.reset([S.build_task("T001", kind="manual")])
        w.set_status("T001", "running", posted={"at_utc": S.FIXED_NOW, "push_text": "T001 · À faire"})
        args = (w.plan(), {"A": w.status_doc()}, w.local_state(), {})
        self.assertEqual(reconcile.derive_run_state(*args), "AWAITING_HUMAN")
        self.assertEqual(reconcile.derive_run_state(*args, now=S.fixed_now()), "AWAITING_HUMAN")
        st = dict(w.local_state(), stuck={"at_utc": S.FIXED_NOW, "reason": "x", "source": "stop-gate"})
        self.assertEqual(reconcile.derive_run_state(args[0], args[1], st, {}), "STUCK")  # positive control

    def test_paused_quota_and_resources(self) -> None:
        w = self.w
        st = w.local_state()
        st["quota"] = {"at_utc": S.FIXED_NOW, "snapshot_age_s": 30, "five_hour_pct": 100.0,
                       "five_hour_resets_utc": "2026-10-03T09:00:00Z", "seven_day_pct": 40.0,
                       "seven_day_resets_utc": "2026-10-08T00:00:00Z", "decision": "pause",
                       "pause_until_utc": "2026-10-03T09:00:00Z", "limit_evidence_utc": None, "override": None}
        w.write_local_state(st)
        self.assertEqual(self._run_state(), "PAUSED_QUOTA")
        st = w.local_state()
        st["quota"]["decision"] = "normal"
        st["governor"] = {"at_utc": S.FIXED_NOW, "disk_free_gb": 1.0, "ram_free_gb": 4.0, "commit_free_gb": 8.0,
                          "ac_power": True, "network": True, "harden_active": False,
                          "decision": {"pause": True, "lanes": 0, "verifiers": 0, "browser_slots": 0,
                                       "workspace_mode": "single-tree", "reasons": ["disk below the floor"]}}
        w.write_local_state(st)
        self.assertEqual(self._run_state(), "PAUSED_RESOURCES")
        st = w.local_state()
        st["governor"]["decision"]["pause"] = False
        w.write_local_state(st)
        self.assertEqual(self._run_state(), "RUNNING")

    def test_stuck_imported_then_cleared_in_hooks_state(self) -> None:
        w = self.w
        hooks_state(w, {"at_utc": "2026-10-03T07:10:00Z", "reason": "stop-gate: 5th consecutive stop",
                        "source": "stop-gate"})
        data = self.status()
        self.assertEqual(data["run_state"], "STUCK")
        self.assertEqual(data["stuck"]["source"], "stop-gate")
        self.assertIn("STUCK", data["digest_text"])
        self.assertIsNone(jsonio.read_json(w.layout.hooks_state)["stuck"])
        self.assertEqual(self._run_state(), "STUCK")  # no wake source armed: stays stuck

    def test_stop_failure_superseded_by_a_later_stop_is_dropped(self) -> None:
        w = self.w
        hooks_state(w, {"at_utc": "2026-10-03T07:10:00Z", "reason": "stop-failure: overloaded",
                        "source": "stop-failure"})
        hook_event(w, "20261003T071100123456Z-1-0.json", "stop.allow", {"reason": "idle-armed"},
                   ts="2026-10-03T07:11:00.123456Z")
        data = self.status()
        self.assertNotEqual(data["run_state"], "STUCK")
        self.assertIsNone(data["stuck"])
        # positive control: without the later stop the same record makes the run STUCK
        w.reset()
        hooks_state(w, {"at_utc": "2026-10-03T07:10:00Z", "reason": "stop-failure: overloaded",
                        "source": "stop-failure"})
        self.assertEqual(self._run_state(), "STUCK")

    def test_build_complete(self) -> None:
        w = self.w
        w.reset(gate_plan())
        w.set_status("T001", "done")
        self.assertEqual(self._run_state(), "BUILD_COMPLETE")

    def test_digest_is_short_and_starts_with_the_command(self) -> None:
        w = self.w
        data = self.status()
        text = data["digest_text"]
        self.assertLessEqual(len(text), 2000)
        self.assertEqual(text.split("\n")[0], paths.exec_cmd())
        self.assertEqual(w.layout.digest.read_text(encoding="utf-8").rstrip("\n"), text)
        short = self.status("--max-chars", "300")["digest_text"]
        self.assertLessEqual(len(short), 300)

    def test_digest_warning_lines_follow_the_counts_clipped_and_capped(self) -> None:
        """Contract revision 3: the lines of data.warnings are in the digest, right after the counts (a digest cut
        at --max-chars keeps them), each clipped, at most DIGEST_WARNINGS of them plus a count of the rest."""
        data = self.status()
        self.assertEqual(data["warnings"], [])  # positive control below: same data, warnings added
        self.assertNotIn("warning:", data["digest_text"])
        n = reconcile.DIGEST_WARNINGS + 2
        long_line = "decision D-001: effects not re-applied (E_INTERNAL, try 1/3): " + "x" * 400
        warned = dict(data, warnings=[long_line] + [f"decision D-{i:03d}: effects parked" for i in range(2, n + 1)])
        lines = reconcile.digest_text(self.w.ctx("status"), warned, 2000).split("\n")
        shown = [ln for ln in lines if ln.startswith("warning: ")]
        self.assertEqual(len(shown), reconcile.DIGEST_WARNINGS + 1)
        self.assertEqual(shown[-1], "warning: 2 more in data.warnings")
        self.assertEqual(len(shown[0]), len("warning: ") + reconcile.DIGEST_WARNING_CHARS)
        self.assertTrue(shown[0].endswith("…"))
        first = lines.index(shown[0])
        self.assertTrue(lines[first - 1].startswith("tasks: "), lines)  # right after the counts
        self.assertTrue(all(not ln.startswith("next ") for ln in lines[:first]))

    def test_digest_flag_writes_nothing(self) -> None:
        w = self.w
        before = (w.layout.local_state.read_bytes(), w.status_bytes(),
                  w.layout.events.read_bytes() if w.layout.events.exists() else b"")
        hook_event(w, "20261003T071100123456Z-1-0.json", "stop.allow", {})
        data = self.status("--digest")
        after = (w.layout.local_state.read_bytes(), w.status_bytes(),
                 w.layout.events.read_bytes() if w.layout.events.exists() else b"")
        self.assertEqual(before, after)
        self.assertIsNone(data["reconciled"])
        self.assertFalse(w.layout.digest.exists())
        code, env, _l = w.run(["status", "--digest", "--by", "verifier"])
        self.assertEqual(code, 0, env)  # the read-only form is open to agents
        code, env, _l = w.run(["status", "--by", "verifier"])
        self.assertEqual(code, 4, env)  # the reconciling form is not

    def test_launching_wave_without_a_run(self) -> None:
        w = self.w
        w.set_status("T001", "running", wave="W01")
        w.manifest("W01", [{"task": "T001"}], launching_utc="2026-10-03T06:50:00Z")
        data = self.status()
        self.assertEqual(data["reconciled"]["waves"][0]["action"], "abandon")
        self.assertEqual(w.entry("T001")["status"], "ready")
        self.assertEqual(jsonio.read_json(w.layout.wave_manifest("W01"))["status"], "abandoned")
        # with inbox activity: a decision, never a silent abandon
        w.reset()
        w.set_status("T001", "running", wave="W01")
        w.manifest("W01", [{"task": "T001"}], launching_utc="2026-10-03T06:50:00Z")
        S.write_text(w.layout.inbox("W01") / "T001.implementer.a1.json", "{}\n")
        data = self.status()
        self.assertEqual(data["reconciled"]["waves"][0]["action"], "decide")
        self.assertEqual(w.entry("T001")["status"], "running")
        # a young launching wave is left alone
        w.reset()
        w.set_status("T001", "running", wave="W01")
        w.manifest("W01", [{"task": "T001"}], launching_utc="2026-10-03T07:08:00Z")
        self.assertEqual(self.status()["reconciled"]["waves"][0]["action"], "record-launch")
        self.assertEqual(w.entry("T001")["status"], "running")

    def test_superseded_through_a_pulled_amendment(self) -> None:
        w = self.w
        raw = jsonio.read_json(w.layout.plan)
        raw["amendments"] = [{"plan_version": 2, "at_utc": S.FIXED_NOW, "by": "B", "decision": "D-501",
                              "summary": "s", "added": [], "changed": [], "superseded": ["T002"],
                              "plan_sha256_before": "a" * 64, "plan_sha256_after": "b" * 64}]
        raw["plan_version"] = 2
        jsonio.write_json_atomic(w.layout.plan, raw)
        self.status()
        self.assertEqual(w.entry("T002")["status"], "superseded")
        self.assertEqual(w.entry("T002")["history"][-1]["evidence"], ["amendment:2:D-501"])


class TwoExecutors(unittest.TestCase):
    """TWO-DEV.md 5 and TD-R2 on executor B's side."""

    def _plan(self) -> list[dict]:
        return [S.build_task("T001"), S.build_task("T002", deps=("T001",), writes=["src/t2/**"], executor="B")]

    def test_cross_executor_dependency_needs_the_tracked_copies(self) -> None:
        w = World(self._plan())
        self.addCleanup(w.cleanup)
        fx = w.done_fixture("T001", tracked=True)  # A's verdict with its tracked copies
        S.rmtree(w.layout.local / "results")  # A's machine-local files never reach B
        S.rmtree(w.layout.local / "proof-runs")
        status_a = S.build_status("A", {"T001": S.build_task_status("done", landed_sha=fx["sha"])})
        jsonio.write_json_atomic(w.layout.status("A"), status_a)
        copy = w.layout.proof_run_copy("T001", fx["run"])
        saved = copy.read_bytes()
        copy.unlink()  # positive control first: without the run copy the dependency does not count
        st = w.local_state()
        st["executor"] = "B"
        w.write_local_state(st)
        w.executor = "B"
        jsonio.write_json_atomic(w.layout.status("B"), S.build_status("B"))
        code, env, _l = w.run(["status", "--executor", "B"])
        self.assertEqual(code, 0, env)
        self.assertIsNone(w.entry("T002"))
        copy.write_bytes(saved)
        code, env, _l = w.run(["status", "--executor", "B"])
        self.assertEqual(code, 0, env)
        self.assertEqual(w.entry("T002")["status"], "ready")

    def test_reassigned_task_leaves_my_status_file_with_its_counters(self) -> None:
        w = World([S.build_task("T001"), S.build_task("T002", writes=["src/t2/**"])])
        self.addCleanup(w.cleanup)
        w.set_status("T002", "ready", attempts=1, reruns=2)
        raw = jsonio.read_json(w.layout.plan)
        raw["tasks"][1]["executor"] = "B"
        jsonio.write_json_atomic(w.layout.plan, raw)
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["reconciled"]["reassigned"], ["T002"])
        self.assertIsNone(w.entry("T002"))
        ev = [e for e in w.events("task.status") if e["data"]["task"] == "T002"][-1]
        self.assertEqual((ev["data"]["to"], ev["data"]["attempts"], ev["data"]["reruns"]), ("planned", 1, 2))


if __name__ == "__main__":
    unittest.main()
