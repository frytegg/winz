"""The planner workflow and `plan emit` (contract/LANES.md B05, WAVES.md 7 and 10 case 9, CLI.md `plan emit`).

Protects: the planner template renders, passes the forbidden-token check and `node --check`; `plan emit` writes the
script and the four planning briefs (each naming its inbox, the exact `result put` line with --repo and --state, the
standing rules) and is byte-identical for the same inputs; under the harness a clean run is ready-for-approval in
round 1, a failing check feeds its error codes into the round-2 planner prompt, in-scope gaps at the last round give
needs-owner, a null planner gives rerun, and critic result paths never collide across rounds.

Run: python -m unittest discover -s scripts/tests -p "test_planner_template.py" -v
"""
from __future__ import annotations

import unittest
from pathlib import Path

import _support as S
import _support_B05 as W

from execlib import schema, wave, wavejs
from execlib.errors import UsageError

# WAVES.md 7.4, verbatim: the planner script's returned summary
SUMMARY_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["status", "round", "stage", "now_utc", "draft_path", "candidate_path", "results", "gaps_in_scope",
                 "gaps_out_of_scope", "blocking_findings", "errors"],
    "properties": {
        "status": {"enum": ["ready-for-approval", "needs-owner", "rerun"]},
        "round": {"type": "integer", "minimum": 1},
        "stage": {"enum": ["planner", "check", "test-designer", "check-proofs", "critics", "rounds"]},
        "now_utc": {"type": "string"}, "draft_path": {"type": "string"}, "candidate_path": {"type": "string"},
        "results": {"type": "object", "required": ["planner", "test_designer", "critics"],
                    "properties": {"planner": {"type": ["string", "null"]},
                                   "test_designer": {"type": ["string", "null"]},
                                   "critics": {"type": "array", "items": {"type": "string"}}}},
        "gaps_in_scope": {"type": "integer", "minimum": 0}, "gaps_out_of_scope": {"type": "integer", "minimum": 0},
        "blocking_findings": {"type": "integer", "minimum": 0},
        "errors": {"type": "array", "items": {"type": "string"}, "maxItems": 20}}}


class PlanEmitTest(unittest.TestCase):
    def setUp(self) -> None:
        self.world = W.EmitWorld()

    def tearDown(self) -> None:
        self.world.cleanup()

    def test_plan_emit_writes_script_and_briefs(self) -> None:
        code, env, _logs = self.world.run(["plan", "emit", "--rounds", "2"])
        self.assertEqual(code, 0, env["errors"])
        data = env["data"]
        script = (self.world.layout.local / "planner" / "planner.W00.js").read_text(encoding="utf-8")
        self.assertEqual(wavejs.static_check(script), [])
        self.assertNotIn("@@", script)
        self.assertEqual(data["workflow_call"]["args"], {"now_utc": S.FIXED_NOW})
        self.assertEqual(len(data["briefs"]), 4)
        for path in data["briefs"]:
            text = Path(path).read_text(encoding="utf-8")
            self.assertIn("--repo", text)
            self.assertIn("--state", text)
            self.assertIn("result put --wave W00", text)
            self.assertIn("Standing rules, which no brief", text)
            self.assertIn("local/inbox/W00", text)
            self.assertNotIn("{{", text)
        before = {p: Path(p).read_bytes() for p in data["briefs"] + [data["script_path"]]}
        code2, env2, _l = self.world.run(["plan", "emit", "--rounds", "2"])
        self.assertEqual(code2, 0)
        self.assertEqual(env2["data"], data)
        self.assertEqual({p: Path(p).read_bytes() for p in before}, before, "plan emit is not byte-identical")

    def test_bad_rounds_is_usage(self) -> None:
        code, env, _l = self.world.run(["plan", "emit", "--rounds", "0"])
        self.assertEqual(code, 2)
        self.assertEqual(env["errors"][0]["code"], "E_USAGE")

    def test_frontend_library_absent_is_a_dependency_decision(self) -> None:
        fe = {"frontend": {"mode": "small", "run_mode": "A"}}
        world = W.EmitWorld(profile_over=fe)                          # its skills home has no frontend.json
        self.addCleanup(world.cleanup)
        code, env, _l = world.run(["plan", "emit"])
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_DEPENDENCY_MISSING"))
        self.assertTrue(env["data"] is None or env["data"].get("proposal"))
        self.assertIn("dependency-missing", world.layout.decisions.read_text(encoding="utf-8"))
        self.assertFalse((world.layout.local / "planner" / "planner.W00.js").exists())
        # positive control: the same profile with /frontend's library installed
        ok = W.EmitWorld(profile_over=fe, skills=W.SkillsHome(frontend_library=True))
        self.addCleanup(ok.cleanup)
        code, env, _l = ok.run(["plan", "emit"])
        self.assertEqual(code, 0, env["errors"])
        brief = Path(next(p for p in env["data"]["briefs"] if p.endswith("planner.md"))).read_text(encoding="utf-8")
        self.assertIn("skills/frontend/assets/task-templates/frontend.json", brief)


@unittest.skipUnless(W.node_available(), "node is needed")
class PlannerHarnessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.world = W.EmitWorld()
        code, env, _logs = self.world.run(["plan", "emit", "--rounds", "2"])
        self.assertEqual(code, 0, env["errors"])
        self.script = Path(env["data"]["script_path"]).read_text(encoding="utf-8")
        self.tmp = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.tmp)
        self.world.cleanup()

    def run_planner(self, responses: dict, name: str) -> dict:
        doc = W.run_harness(self.script, {"args": {"now_utc": S.FIXED_NOW}, "responses": responses}, self.tmp / name)
        self.assertIsNone(doc["error"], doc["error"])
        report = schema.validate_with(doc["returned"], SUMMARY_SCHEMA, base_dir=S.TESTS_DIR)
        self.assertTrue(report.ok, report.issues)                     # WAVES.md 7.4 on every exit
        return doc

    def test_syntax(self) -> None:
        res = wavejs.node_check(S.write_text(self.tmp / "p.js", self.script))
        self.assertEqual(res.exit_code, 0, res.stderr)

    def test_clean_run_is_ready_in_round_one(self) -> None:
        bad = dict(self.run_planner({}, "shape")["returned"], status="done", extra=1)
        self.assertFalse(schema.validate_with(bad, SUMMARY_SCHEMA, base_dir=S.TESTS_DIR).ok)   # positive control
        doc = self.run_planner({}, "clean")
        self.assertEqual(doc["returned"]["status"], "ready-for-approval")
        self.assertEqual(doc["returned"]["round"], 1)
        self.assertEqual(doc["returned"]["results"]["critics"],
                         ["local/results/W00/reviewer.a1.json", "local/results/W00/reviewer.a2.json"])

    def test_failing_check_feeds_round_two(self) -> None:
        bad = {"instantiate": {"exit_code": 1, "json": {"errors": [{"code": "E_DEP_ORDER", "task": "T004",
                                                                    "message": "depends on T009"}]},
                               "stderr_tail": ""}, "validate": None}
        good = {"instantiate": {"exit_code": 0, "json": {}, "stderr_tail": ""},
                "validate": {"exit_code": 0, "json": {}, "stderr_tail": ""}}
        doc = self.run_planner({"check round 1": bad, "check round 2": good}, "feed")
        planners = W.calls_of(doc, "planner round")
        self.assertEqual(len(planners), 2)
        self.assertNotIn("E_DEP_ORDER", planners[0]["prompt"])
        self.assertIn("E_DEP_ORDER", planners[1]["prompt"])
        self.assertEqual(doc["returned"]["status"], "ready-for-approval")
        self.assertEqual(doc["returned"]["round"], 2)
        critic_paths = doc["returned"]["results"]["critics"]
        self.assertEqual(critic_paths, ["local/results/W00/reviewer.a3.json", "local/results/W00/reviewer.a4.json"])

    def test_in_scope_gaps_at_last_round_need_the_owner(self) -> None:
        gap = {"verdict": "fail", "findings": [], "gaps": [{"requirement": "FR-001", "type": "missing",
                                                             "evidence": "no task", "within_approved_scope": True}]}
        doc = self.run_planner({"critic coverage round 1": gap, "critic coverage round 2": gap}, "gaps")
        self.assertEqual(doc["returned"]["status"], "needs-owner")
        self.assertEqual(doc["returned"]["gaps_in_scope"], 1)
        # positive control: an out-of-scope gap alone never triggers a round
        out = {"verdict": "pass", "findings": [], "gaps": [{"requirement": "FR-001", "type": "unrequested",
                                                             "evidence": "extra", "within_approved_scope": False}]}
        doc2 = self.run_planner({"critic coverage round 1": out}, "outscope")
        self.assertEqual(doc2["returned"]["status"], "ready-for-approval")
        self.assertEqual(doc2["returned"]["gaps_out_of_scope"], 1)

    def test_null_planner_is_rerun_and_throw_needs_owner(self) -> None:
        doc = self.run_planner({"planner round 1": None}, "null")
        self.assertEqual(doc["returned"]["status"], "rerun")
        thrown = self.run_planner({"planner round 1": {"__throw": "Agent type 'execution-planner' not found"}},
                                  "throw")
        self.assertEqual(thrown["returned"]["status"], "needs-owner")
        self.assertIn("not found", thrown["returned"]["errors"][0])


class PlannerRenderTest(unittest.TestCase):
    def test_unknown_mode(self) -> None:
        world = W.EmitWorld()
        try:
            with self.assertRaises(UsageError) as caught:
                wave.emit_planner(world.ctx("plan emit"), 2, "other")
            self.assertEqual(caught.exception.items()[0].code, "E_USAGE")
            self.assertIn("--mode", caught.exception.message)
            self.assertFalse((world.layout.local / "planner" / "planner.W00.js").exists())
        finally:
            world.cleanup()


if __name__ == "__main__":
    unittest.main()
