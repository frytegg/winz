"""The execution template library and its checkers (contract/LANES.md B02, SCHEMAS.md 3.1 and P-17/P-18,
TWO-DEV.md 8, FIX-MODE.md 6, HANDOVER.md 4; lane B02).

- assets/task-templates/execution.json validates against task-template.schema.json and holds every template the
  contract places, with the stated kind and phase;
- instantiated on the B02 fixture profile (with the sample and the real-format /frontend library) it yields a plan
  that passes validate, P-17 (deliverables after the build gate, FE-21 after the harden review and the fix gate,
  README screenshots last) and P-18 (exactly one build gate, every required build task its ancestor);
- the include conditions (two devs, event kind, flip) and the per-item templates (instances with parameters);
- the proof commands run for real where they can (EX-BOOT's in a temp repository through Git Bash), and the
  checkers behind the other proofs: assets/checks/plan_checks.py and devb_setup_check.py, each with its planted
  forgery (positive control) and its honest pass.

Run: python -m unittest discover -s scripts/tests -p "test_execution_templates.py" -v
"""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any

import _support as S
import _support_B02 as B

from execlib import clock, errors, graph, jsonio, plan, procutil, schema, templates, validate
from execlib.model import PlanModel

NOW = clock.parse_utc(S.FIXED_NOW)
CHECKS = S.SKILL_DIR / "assets" / "checks"
PLACEMENTS = {
    "EX-APPROVE": ("decision", "decision"), "EX-NAME": ("decision", "decision"), "EX-BOOT": ("infra", "setup"),
    "EX-CI": ("infra", "setup"), "EX-CONTRACT": ("code", "contract"), "EX-GATE-BUILD": ("gate", "verify"),
    "EX-REPLAY": ("gate", "verify"), "EX-CONVERGE": ("gate", "verify"), "EX-HARDEN-PARK": ("manual", "manual"),
    "EX-HARDEN-REVIEW": ("manual", "manual"), "EX-FREEZE-VALIDATOR": ("gate", "verify"),
    "EX-FREEZE-RECORDING": ("gate", "deliverable"), "EX-FREEZE-DOCS": ("gate", "deliverable"),
    "EX-FREEZE-PUSH-TAG": ("gate", "deliverable"), "EX-HB-CLAIMS-VERIFY": ("gate", "verify"),
    "EX-DLV-RECORD": ("manual", "deliverable"), "EX-DLV-SLIDES": ("manual", "deliverable"),
    "EX-DLV-DRIVE": ("manual", "deliverable"), "EX-DLV-FORM": ("manual", "deliverable"),
    "EX-DLV-FLIP": ("manual", "deliverable"), "EX-DLV-PROSE": ("manual", "deliverable"),
    "EX-DLV-SCREENSHOTS": ("code", "deliverable"), "EX-DLV-TAG": ("infra", "deliverable"),
    "EX-DEVB-SETUP": ("manual", "ops"), "EX-DEVB-CHECK": ("gate", "verify"), "EX-DEVB-INTEGRATE": ("code", "build"),
    "EX-FIX-SELECT": ("decision", "decision"), "EX-FIX-CODE": ("code", "fix"), "EX-FIX-REVERT": ("code", "fix"),
    "EX-FIX-GATE": ("gate", "fix"),
}
OTHERS = ("EX-DEPLOY", "EX-EVID", "EX-README", "EX-HB-CLAIMS-OPEN", "EX-HB-CLAIMS-CLOSE", "EX-HB-DX-JOURNAL",
          "EX-HB-RECON", "EX-HB-DEMO-AUDIT", "EX-HB-PREFLIGHT", "EX-HB-VISIBILITY", "EX-HB-JUDGE-FETCH",
          "EX-DLV-FLIP-CHECK")


def run_check(script: str, *args: str, cwd: Path | None = None, env: dict | None = None) -> tuple[int, dict]:
    cp = subprocess.run([sys.executable, str(CHECKS / script), *args], cwd=str(cwd or S.SKILL_DIR),
                        capture_output=True, env=env or S.env_isolated(), timeout=120)
    out = cp.stdout.decode("utf-8").strip()
    return cp.returncode, (json.loads(out.split("\n")[-1]) if out else {})


class Library(unittest.TestCase):
    def test_library_validates_and_places_every_template(self) -> None:
        lib = templates.load_library("execution")
        self.assertEqual((lib.name, lib.fmt), ("execution", "execution"))
        self.assertTrue(schema.validate(lib.raw, "task-template").ok)
        by_id = templates.template_index(lib)
        for tid, (kind, phase) in PLACEMENTS.items():
            self.assertIn(tid, by_id, tid)
            self.assertEqual((by_id[tid]["kind"], by_id[tid]["phase"]), (kind, phase), tid)
            self.assertTrue(validate.PHASE_KIND[kind] >= {phase}, tid)
        for tid in OTHERS:
            self.assertIn(tid, by_id)
        for tid, t in by_id.items():
            if tid.startswith("EX-HB-"):
                self.assertTrue(t["brief_refs"] and all(r.startswith("{hackathon_skill}/references/")
                                                        for r in t["brief_refs"]), tid)
        self.assertEqual(by_id["EX-FIX-SELECT"]["decision_kind"], "fix-selection")
        self.assertEqual(by_id["EX-APPROVE"]["decision_kind"], "approval")

    def test_no_literal_trailer_and_no_allow_skip(self) -> None:
        text = (S.SKILL_DIR / "assets" / "task-templates" / "execution.json").read_text(encoding="utf-8")
        self.assertNotIn(S.planted("trailer.coauthor").split(":")[0], text)
        self.assertNotIn("--allow-skip", text)


class Instantiation(unittest.TestCase):
    def setUp(self) -> None:
        self.sd = B.StateDir()

    def tearDown(self) -> None:
        self.sd.cleanup()

    def inst(self, *, draft: dict | None = None, profile: dict | None = None, lib: Path = B.SAMPLE_LIB
             ) -> tuple[dict, dict[str, str]]:
        with B.FrontendSkill(lib), B.fake_lanes():
            from execlib import planning
            raw, ids = templates.instantiate(draft or self.sd.draft(), profile or self.sd.profile, self.sd.policy,
                                             self.sd.layout, NOW, lane_of=validate.lane_for,
                                             spec_decision="D-001")
            raw = planning.insert_build_complete_deadline(raw, profile or self.sd.profile)
            raw = templates.compute_latest_starts(raw, profile or self.sd.profile)
        return raw, ids

    def report(self, raw: dict, profile: dict | None = None) -> validate.VReport:
        vctx = validate.VContext(profile=profile or self.sd.profile, policy=self.sd.policy, statuses=None, now=NOW,
                                 skills_present={"frontend.templates": True, "frontend.checker": True,
                                                 "frontend.fragments": True}, layout=self.sd.layout)
        return validate.validate_plan(raw, vctx)

    def test_fixture_plan_passes_with_p17_and_p18(self) -> None:
        for lib in (B.SAMPLE_LIB, B.REAL_LIB):
            with self.subTest(lib=lib.name):
                raw, ids = self.inst(lib=lib)
                rep = self.report(raw)
                self.assertEqual([e.code for e in rep.errors], [], [e.message for e in rep.errors][:5])
                model = PlanModel.from_raw(raw)
                g = graph.Graph.of(model)
                tpl = {t.id: (t.template or "") for t in model.tasks}
                gates = [t for t, x in tpl.items() if x == "execution:EX-GATE-BUILD"]
                self.assertEqual(len(gates), 1)
                gate = gates[0]
                review = ids["execution/EX-HARDEN-REVIEW"]
                fixg = ids["execution/EX-FIX-GATE"]
                for t in model.tasks:
                    if t.phase == "deliverable":
                        self.assertTrue({gate, review, fixg} <= g.ancestors(t.id), t.id)
                    if t.required and t.phase in ("setup", "contract", "build", "integrate", "verify") \
                            and t.id != gate and t.id not in g.descendants(gate):
                        self.assertIn(t.id, g.ancestors(gate), t.id)
                fe21 = ids["frontend/FE-21"]
                self.assertTrue({review, fixg} <= g.ancestors(fe21))
                shots = ids["execution/EX-DLV-SCREENSHOTS"]
                for t in model.tasks:
                    tid = (t.template or "").partition(":")[2]
                    if t.phase == "deliverable" and t.id != shots and tid not in validate.SCREENSHOT_EXCEPTIONS:
                        self.assertIn(t.id, g.ancestors(shots), (t.id, tid))
                self.assertIn(ids["execution/EX-DLV-PROSE"], g.ancestors(shots))
                self.assertIn(fe21, g.ancestors(ids["execution/EX-DLV-RECORD"]))

    def test_two_devs_include_dev_b_tasks(self) -> None:
        prof = copy.deepcopy(self.sd.profile)
        prof["team"]["devs"].append({"id": "devB", "name": "Dev B", "executor": "B", "setup": "full",
                                     "notion_member": True, "availability": []})
        raw, ids = self.inst(profile=prof)
        k = {t["key"]: t for t in raw["tasks"]}
        setup, check = k["execution.ex-devb-setup"], k["execution.ex-devb-check"]
        self.assertEqual((setup["owner"], setup["executor"]), ("devB", "A"))
        self.assertIn(setup["id"], check["depends_on"])
        self.assertIn("devb_setup_check.py", check["proof"]["spec"]["cmd"])
        self.assertIn("--require-notion true", check["proof"]["spec"]["cmd"])
        self.assertEqual([e.code for e in self.report(raw, prof).errors], [])
        raw1, _ = self.inst()
        self.assertFalse([t for t in raw1["tasks"] if "devb" in t["key"]])

    def test_event_kind_and_flip(self) -> None:
        prof = copy.deepcopy(self.sd.profile)
        prof["event"]["kind"] = "project"
        raw, _ = self.inst(profile=prof)
        self.assertFalse([t for t in raw["tasks"] if (t["template"] or "").startswith("execution:EX-HB-")])
        raw_h, _ = self.inst()
        hb = sorted(t["template"] for t in raw_h["tasks"] if (t["template"] or "").startswith("execution:EX-HB-"))
        self.assertIn("execution:EX-HB-CLAIMS-VERIFY", hb)
        self.assertNotIn("execution:EX-HB-VISIBILITY", hb)  # in-person event
        d = self.sd.draft()
        d["libraries"][0]["params"] = {"flip": "on"}
        with self.assertRaises(errors.CheckFailed) as cm:
            self.inst(draft=d)
        self.assertEqual(cm.exception.code, "E_TEMPLATE_PARAM")
        d["libraries"][0]["params"]["public_repo_url"] = "https://github.com/example/queue-clock"
        raw_f, ids_f = self.inst(draft=d)
        k = {t["key"]: t for t in raw_f["tasks"]}
        self.assertIn(ids_f["execution/EX-DLV-FLIP-CHECK"], k["execution.ex-dlv-flip"]["depends_on"])
        self.assertEqual(k["execution.ex-dlv-flip"]["proof"]["spec"]["url"], "https://github.com/example/queue-clock")
        self.assertEqual([e.code for e in self.report(raw_f).errors], [])

    def test_per_item_instances(self) -> None:
        d = self.sd.draft()
        d["instances"] = [{"template": "execution:EX-FIX-CODE", "key": "fix-h-007",
                           "params": {"finding": "H-007", "item": "T2:H-007", "fix_file": "src/engine/eta.ts",
                                      "test_path": "src/engine/__fix__/h_007.test.ts",
                                      "test_cmd": "pnpm exec vitest run src/engine/__fix__/h_007.test.ts"}}]
        raw, ids = self.inst(draft=d)
        t = next(x for x in raw["tasks"] if x["key"] == "fix-h-007")
        self.assertEqual(t["writes"], ["src/engine/eta.ts", "src/engine/__fix__/h_007.test.ts"])
        self.assertEqual(t["lane"], "L1")
        self.assertIn(ids["execution/EX-FIX-SELECT"], t["depends_on"])
        self.assertEqual(t["proof"]["spec"]["cmd"], "pnpm exec vitest run src/engine/__fix__/h_007.test.ts")
        self.assertEqual(t["template"], "execution:EX-FIX-CODE")
        d2 = copy.deepcopy(d)
        del d2["instances"][0]["params"]["test_cmd"]
        with self.assertRaises(errors.CheckFailed) as cm:
            self.inst(draft=d2)
        self.assertEqual(cm.exception.code, "E_TEMPLATE_PARAM")

    def test_task_ids_substituted_everywhere(self) -> None:
        raw, ids = self.inst()
        for t in raw["tasks"]:
            blob = json.dumps({k: t[k] for k in ("title", "description", "proof", "manual")})
            self.assertNotIn("{task_id}", blob, t["key"])
            if t["manual"]:
                for bb in t["manual"]["bring_back"]:
                    self.assertTrue(bb["key"].startswith(t["id"]), t["key"])

    def test_boot_proof_runs_in_a_repository(self) -> None:
        bash = procutil.git_bash()
        if bash is None:
            self.skipTest("Git Bash is needed")
        raw, ids = self.inst()
        boot = next(t for t in raw["tasks"] if t["template"] == "execution:EX-BOOT")
        cmd = boot["proof"]["spec"]["cmd"]
        hook = ("#!/bin/sh\nmsg=$(cat \"$1\")\n"
                "if printf '%s' \"$msg\" | grep -qiE '(co-)(authored-by|''signed-off-by):'; then exit 1; fi\n"
                "printf '%s' \"$msg\" | head -n1 | grep -qE '^(feat|fix|refactor|test|docs|chore|perf|ci|build|revert)"
                "(\\([^)]+\\))?!?: ' || exit 1\nexit 0\n")
        with S.TempRepo(files={".gitattributes": "* text=auto eol=lf\n", ".githooks/commit-msg": hook}) as repo:
            env = S.env_isolated()
            neg = subprocess.run([bash, "-c", cmd], cwd=str(repo.path), env=env, capture_output=True)
            self.assertNotEqual(neg.returncode, 0, "the hook is not executable yet: the proof must fail")
            repo.git("update-index", "--chmod=+x", ".githooks/commit-msg")
            repo.commit_all("chore: make the hook executable")
            pos = subprocess.run([bash, "-c", cmd], cwd=str(repo.path), env=env, capture_output=True)
            self.assertEqual(pos.returncode, 0, pos.stderr.decode("utf-8", "replace"))


class InstantiateCommand(unittest.TestCase):
    """`plan instantiate`: the command glue (dry run, --proofs, --propose-approval, refusals, envelope)."""

    def setUp(self) -> None:
        self.sd = B.StateDir()

    def tearDown(self) -> None:
        self.sd.cleanup()

    def run_cmd(self, **over: Any) -> Any:
        from execlib import planning
        with B.FrontendSkill(B.SAMPLE_LIB):
            return B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate",
                                 **B.instantiate_args(**over))

    def test_dry_run_writes_only_the_candidate(self) -> None:
        self.sd.write_draft(self.sd.draft())
        with B.fake_lanes() as fakes:
            res = self.run_cmd(dry_run=True)
        self.assertEqual(res.exit_code, 0, [e.message for e in res.errors][:3])
        self.assertTrue(self.sd.layout.plan_candidate.is_file())
        self.assertFalse(self.sd.layout.plan.exists())
        self.assertFalse(self.sd.layout.events.exists())
        self.assertFalse((self.sd.state / "negative-controls").exists())
        self.assertEqual(fakes["decisions"].calls, [])

    def test_proofs_from_a_test_designer_result(self) -> None:
        self.sd.write_draft(self.sd.draft())
        with B.fake_lanes():
            first = self.run_cmd(dry_run=True)
        engine = first.data["ids"]["engine"]
        proof = {"type": "command", "spec": {"cmd": "node --test test/engine/eta.test.mjs", "shell": "bash",
                                             "cwd": ".", "install": True},
                 "expect": {"summary": "the decile rule holds", "exit_code": 0}, "max_runtime_min": 2,
                 "negative_control": {"kind": "pre-implementation", "description": "fails before the engine",
                                      "expect_nonzero": True}}
        td = {"proofs": [{"task": engine, "proof": proof, "acceptance": ["rule 2.1"],
                          "negative_control": {"kind": "pre-implementation", "command": "x", "ran": True,
                                               "exit_code": 1, "failed_as_required": True}}]}
        p = self.sd.root / "td.json"
        jsonio.write_json_atomic(p, td)
        with B.fake_lanes():
            res = self.run_cmd(proofs=str(p))
        self.assertEqual(res.exit_code, 0)
        task = next(t for t in json.loads(self.sd.layout.plan.read_text(encoding="utf-8"))["tasks"] if t["id"] == engine)
        self.assertEqual((task["proof"], task["proof_author"]), (proof, "test-designer"))

    def test_missing_proofs_file_is_usage_and_writes_nothing(self) -> None:
        self.sd.write_draft(self.sd.draft())
        gone = self.sd.root / "absent-td.json"
        with B.fake_lanes() as fakes:
            with self.assertRaises(errors.UsageError) as cm:
                self.run_cmd(proofs=str(gone))
        self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_USAGE", 2))
        self.assertIn("--proofs", cm.exception.message)
        self.assertIn(gone.as_posix(), cm.exception.message)
        self.assertFalse(self.sd.layout.plan_candidate.exists())
        self.assertFalse(self.sd.layout.plan.exists())
        self.assertEqual(fakes["decisions"].calls, [])

    def test_propose_approval_and_run_state(self) -> None:
        self.sd.write_draft(self.sd.draft())
        self.sd.local_state("INGEST")
        with B.fake_lanes() as fakes:
            res = self.run_cmd(propose_approval=True)
        self.assertEqual(res.exit_code, 0, [e.message for e in res.errors][:3])
        appr = res.data["approval"]
        from execlib import decisionsio
        prop, _ = decisionsio.find(self.sd.layout, appr["decision"])
        self.assertEqual(prop["kind"], "approval")
        raw = json.loads(self.sd.layout.plan.read_text(encoding="utf-8"))
        self.assertEqual(prop["plan_sha256"], plan.plan_digest(raw))
        self.assertEqual({o["id"] for o in prop["options"]}, {"approve", "revise"})
        approve_id = res.data["ids"]["execution/EX-APPROVE"]
        self.assertEqual(prop["tasks"], [approve_id])
        self.assertIn((approve_id, "running"), fakes["status"].calls)
        from execlib import statusio
        hist = statusio.load(self.sd.layout, "A")["tasks"][approve_id]["history"]
        # B04's evidence vocabulary: the approval proposal as decision:<id> (never the bare id)
        self.assertEqual(hist[-1]["evidence"], [f"decision:{appr['decision']}"])
        self.assertIn("Chemin critique", appr["summary_fr"])
        self.assertEqual(appr["p80_utc"], "2026-10-03T12:30:00Z")
        st = json.loads(self.sd.layout.local_state.read_text(encoding="utf-8"))
        self.assertEqual(st["run_state"], "AWAIT_APPROVAL")
        types = [json.loads(x)["type"] for x in self.sd.layout.events.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([t for t in types if t != "decision.proposed"][:2], ["plan.instantiated", "catalogue.generated"])
        self.assertEqual(types.count("run.state"), 2)

    def test_refusals(self) -> None:
        self.sd.write_draft(self.sd.draft())
        with B.fake_lanes():
            self.assertEqual(self.run_cmd().exit_code, 0)
            raw = json.loads(self.sd.layout.plan.read_text(encoding="utf-8"))
            raw["approved"] = {"at_utc": S.FIXED_NOW, "by": "devA", "decision": "D-002",
                               "plan_sha256": plan.plan_digest(raw)}
            jsonio.write_json_atomic(self.sd.layout.plan, raw)
            with self.assertRaises(errors.PolicyRefused) as cm:
                self.run_cmd()
            self.assertEqual(cm.exception.code, "E_PLAN_APPROVED")
            from execlib import planning
            with self.assertRaises(errors.PolicyRefused):
                with B.FrontendSkill(B.SAMPLE_LIB):
                    B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", executor="B",
                                  **B.instantiate_args(dry_run=True))

    def test_invalid_candidate_is_exit_1_and_kept(self) -> None:
        d = self.sd.draft()
        d["spec"]["sha256"] = "f" * 64  # no validated spec-validation decision for this hash: P-25
        self.sd.write_draft(d)
        with B.fake_lanes():
            res = self.run_cmd()
        self.assertEqual(res.exit_code, 1)
        self.assertIn("E_SPEC_UNVALIDATED", {e.code for e in res.errors})
        self.assertTrue(self.sd.layout.plan_candidate.is_file())
        self.assertFalse(self.sd.layout.plan.exists())

    def test_envelope_through_exec_py(self) -> None:
        d = self.sd.draft()
        d["requirements"] = [r for r in d["requirements"] if r["id"] != "FR-006"]
        for r in d["requirements"]:
            if r["surface"] == "ui":
                r["surface"], r["feature_group"] = "api", None
        d.update({"feature_groups": [], "deadlines": [],
                  "libraries": [{"library": "execution", "key": "execution", "params": {"deliverables": "off"}}]})
        self.sd.write_draft(d)
        prof = copy.deepcopy(self.sd.profile)
        prof["event"].update({"kind": "project", "deadline_utc": None})
        jsonio.write_json_atomic(self.sd.layout.profile, prof)
        skills = B.FrontendSkill(B.SAMPLE_LIB)  # the subprocess's home: never the real ~/.claude/skills
        try:
            env = skills.env()
            code, envl, _ = S.run_exec(["plan", "instantiate", "--state", str(self.sd.state), "--executor", "A"],
                                       self.sd.root, env)
            self.assertEqual(code, 0, envl["errors"])
            self.assertEqual(envl["data"]["plan_version"], 1)
            self.assertTrue(envl["data"]["validation"]["ok"])
            code2, env2, _ = S.run_exec(["plan", "instantiate", "--state", str(self.sd.state), "--draft",
                                         str(self.sd.root / "absent.json")], self.sd.root, env)
            self.assertEqual((code2, env2["errors"][0]["code"]), (2, "E_USAGE"))
        finally:
            skills.cleanup()


class PlanChecks(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def test_readme(self) -> None:
        with S.TempRepo(files={"README.md": "# x\n\nSee [data](data/a.json).\n\n```bash verify\nexit 0\n```\n",
                               "data/a.json": "{}\n"}) as repo:
            code, out = run_check("plan_checks.py", "readme", "--repo", str(repo.path), "--run-verify")
            self.assertEqual(code, 0, out)
            repo.write("README.md", "# x\n\n**TODO** finish\n")
            code, out = run_check("plan_checks.py", "readme", "--repo", str(repo.path))
            self.assertEqual(code, 1)
            repo.write("README.md", "# x\n\n**TODO** finish <!--todo-ok-->\n")
            self.assertEqual(run_check("plan_checks.py", "readme", "--repo", str(repo.path))[0], 0)
            repo.write("README.md", "# x\n\n![s](docs/screenshots/a.png)\n")
            code, out = run_check("plan_checks.py", "readme", "--repo", str(repo.path), "--require-images",
                                  "docs/screenshots")
            self.assertEqual(code, 1)
            self.assertIn("docs/screenshots/a.png", json.dumps(out))
            repo.write("docs/screenshots/a.png", "png")
            self.assertEqual(run_check("plan_checks.py", "readme", "--repo", str(repo.path), "--require-images",
                                       "docs/screenshots")[0], 0)
            repo.write("README.md", "# x\n\n```bash verify\nexit 3\n```\n")
            self.assertEqual(run_check("plan_checks.py", "readme", "--repo", str(repo.path), "--run-verify")[0], 1)

    def test_freeze(self) -> None:
        with S.TempRepo(files={"README.md": "# x\n", "src/a.ts": "a\n"}) as repo:
            code, out = run_check("plan_checks.py", "freeze", "--repo", str(repo.path), "--globs", "README.md,docs/**",
                                  "--at", "2026-10-03T07:00:00Z")
            self.assertEqual(code, 1, out)
            code, out = run_check("plan_checks.py", "freeze", "--repo", str(repo.path), "--globs", "README.md",
                                  "--at", "2026-10-03T08:00:00Z")
            self.assertEqual(code, 0, out)
            code, out = run_check("plan_checks.py", "freeze", "--repo", str(repo.path), "--globs", "docs/**",
                                  "--at", "2026-10-03T07:00:00Z")
            self.assertEqual(code, 0, out)

    def test_ledger(self) -> None:
        claims = self.root / "claims.md"
        S.write_text(claims, "# Claims\n\n| # | claim, as it will be said | where it appears | evidence | status |\n"
                             "|---|---|---|---|---|\n| C-001 | x | README | file | verified |\n"
                             "| C-002 | y | deck | none | unverified |\n")
        self.assertEqual(run_check("plan_checks.py", "ledger", "--ledger", str(claims), "--kind", "claims")[0], 0)
        self.assertEqual(run_check("plan_checks.py", "ledger", "--ledger", str(claims), "--kind", "claims",
                                   "--closed")[0], 1)
        S.write_text(claims, claims.read_text(encoding="utf-8").replace("| unverified |", "| cut |"))
        self.assertEqual(run_check("plan_checks.py", "ledger", "--ledger", str(claims), "--kind", "claims",
                                   "--closed")[0], 0)
        dx = self.root / "dx.md"
        S.write_text(dx, "| When (UTC) | Who | Where (page) | What I tried | What happened (exact text) | Time lost |\n"
                         "|---|---|---|---|---|---|\n")
        self.assertEqual(run_check("plan_checks.py", "ledger", "--ledger", str(dx), "--kind", "dx")[0], 0)
        self.assertEqual(run_check("plan_checks.py", "ledger", "--ledger", str(dx), "--kind", "claims")[0], 1)
        self.assertEqual(run_check("plan_checks.py", "ledger", "--ledger", str(self.root / "no.md"), "--kind",
                                   "dx")[0], 1)

    def test_history_never_show(self) -> None:
        ns_path = S.RENDERED / "never-show.json"
        live = next(e["pattern"] for e in json.loads(ns_path.read_text(encoding="utf-8"))["entries"]
                    if e["id"] == "ns-embargo-live")
        with S.TempRepo(files={"README.md": "# clean\n"}) as repo:
            code, out = run_check("plan_checks.py", "history", "--repo", str(repo.path), "--never-show", str(ns_path))
            self.assertEqual(code, 0, out)
            repo.write("notes.md", f"draft mentions {live}\n")
            repo.commit_all("docs: add notes")
            repo.write("notes.md", "scrubbed\n")
            repo.commit_all("docs: scrub notes")
            code, out = run_check("plan_checks.py", "history", "--repo", str(repo.path), "--never-show", str(ns_path))
            self.assertEqual(code, 1)
            self.assertIn("ns-embargo-live", json.dumps(out))
            self.assertNotIn(live, json.dumps(out))

    def _replay_state(self, head: str, met: bool) -> Path:
        state = self.root / "state"
        task = S.build_task("T001")
        jsonio.write_json_atomic(state / "plan.json", S.build_plan([task]))
        jsonio.write_json_atomic(state / "status" / "A.json", S.build_status("A", {"T001": S.build_task_status("done")}))
        run = {"by": {"role": "replay"}, "sha": head, "checkout": {"kind": "clone"},
               "proof_hash": plan.proof_digest(task), "expectation": {"met": met}}
        jsonio.write_json_atomic(state / "local" / "proof-runs" / "T001" / "r1" / "run.json", run)
        return state

    def test_replay(self) -> None:
        with S.TempRepo() as repo:
            head = repo.head()
            ok_state = self._replay_state(head, True)
            self.assertEqual(run_check("plan_checks.py", "replay", "--state", str(ok_state), "--repo",
                                       str(repo.path))[0], 0)
            S.rmtree(ok_state)
            bad_state = self._replay_state(head, False)
            code, out = run_check("plan_checks.py", "replay", "--state", str(bad_state), "--repo", str(repo.path))
            self.assertEqual(code, 1)
            self.assertIn("T001", json.dumps(out))

    def test_convergence(self) -> None:
        with S.TempRepo() as repo:
            head = repo.head()
            state = self.root / "state"
            res = {"mode": "convergence", "scope": {"sha": head, "tasks": []}, "gaps": []}
            jsonio.write_json_atomic(state / "local" / "results" / "W05" / "T010.reviewer.a1.json", res)
            args = ["convergence", "--state", str(state), "--task", "T010", "--repo", str(repo.path)]
            self.assertEqual(run_check("plan_checks.py", *args)[0], 0)
            res2 = {**res, "gaps": [{"requirement": "FR-002", "type": "missing", "evidence": "x",
                                     "within_approved_scope": True}]}
            jsonio.write_json_atomic(state / "local" / "results" / "W06" / "T010.reviewer.a1.json", res2)
            self.assertEqual(run_check("plan_checks.py", *args)[0], 1)
            res3 = {**res, "scope": {"sha": "0" * 40, "tasks": []}}
            jsonio.write_json_atomic(state / "local" / "results" / "W07" / "T010.reviewer.a1.json", res3)
            self.assertEqual(run_check("plan_checks.py", *args)[0], 1)


class DevBSetupCheck(unittest.TestCase):
    def setUp(self) -> None:
        self.state = S.mkdtemp() / "state"
        jsonio.write_json_atomic(self.state / "plan.json", {"tasks": [{"id": "T005",
                                                                      "template": "execution:EX-DEVB-SETUP"}]})
        header = {"schema": "execution.answer/1", "key": "T005-ready", "task": "T005", "bring_back_key": "T005-ready",
                  "kind": "sha", "source": "terminal", "received_utc": "2026-10-03T09:00:00Z", "by": "devB",
                  "value": "a" * 40, "attachments": [],
                  "verification": {"method": "regex", "ok": True, "detail": "matched", "at_utc": "2026-10-03T09:00:00Z"}}
        S.write_text(self.state / "answers" / "T005-ready.md", "```json\n" + json.dumps(header) + "\n```\n\nprêt\n")

    def tearDown(self) -> None:
        S.rmtree(self.state.parent)

    def events(self, lines: list[dict]) -> None:
        S.write_text(self.state / "events.jsonl", "".join(json.dumps(x) + "\n" for x in lines))

    @staticmethod
    def ev(type_: str, data: dict, ts: str = "2026-10-03T09:30:00.000000Z", executor: str = "B", seq: int = 1) -> dict:
        return {"ts": ts, "actor": f"exec:x@{executor}", "type": type_, "data": data, "executor": executor, "seq": seq}

    def good(self) -> list[dict]:
        return [self.ev("preflight", {"for": "event", "strict": True, "ok": True, "failed": 0, "skipped": 0,
                                      "open": [], "version": "2.1.290"}, seq=1),
                self.ev("hooks.canary", {"bound": True}, seq=2),
                self.ev("notion.ack", {"batch": "N-1", "op": "o1", "purpose": "token-check", "key": "k", "ok": True},
                        seq=3)]

    def run_it(self, notion: str = "true") -> tuple[int, dict]:
        return run_check("devb_setup_check.py", "--state", str(self.state), "--executor", "B", "--require-notion",
                         notion, "--json")

    def test_real_preflight_passes(self) -> None:
        self.events(self.good())
        code, out = self.run_it()
        self.assertEqual(code, 0, out)
        self.assertTrue(out["ok"])

    def test_forged_preflight_fails(self) -> None:
        lines = self.good()
        lines.append(self.ev("preflight", {"for": "event", "strict": True, "ok": False, "failed": 0, "skipped": 1,
                                           "open": ["PF-18"], "version": None}, ts="2026-10-03T09:40:00.000000Z",
                             seq=4))
        self.events(lines)
        code, out = self.run_it()
        self.assertEqual(code, 1)
        self.assertEqual({c["id"] for c in out["checks"] if c["state"] == "fail"}, {"preflight"})

    def test_missing_lines_fail_and_notion_optional(self) -> None:
        self.events(self.good()[:2])
        self.assertEqual(self.run_it("true")[0], 1)
        self.assertEqual(self.run_it("false")[0], 0)
        self.events([self.good()[0]])
        self.assertEqual(self.run_it("false")[0], 1)
        old = [self.ev(e["type"], e["data"], ts="2026-10-02T06:00:00.000000Z", seq=e["seq"]) for e in self.good()]
        self.events(old)
        self.assertEqual(self.run_it()[0], 1, "lines older than the setup answer minus 24 h do not count")
        self.events([dict(e, executor="A") for e in self.good()])
        self.assertEqual(self.run_it()[0], 1, "executor A's lines never satisfy B's check")


if __name__ == "__main__":
    unittest.main()
