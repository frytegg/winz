"""`exec.py amend`: the approved plan changed under a resolved decision, with the state repository's push as the
compare-and-set (contract/CLI.md 2 `amend`, TWO-DEV.md 4, TESTS.md 5.4; lane B02).

Two clones A and B of one bare state remote. B's pre-push hook runs A's amendment the first time (so the remote
moves between B's fetch and B's push): A wins, B drops only its amend commit (`reset --keep HEAD~1`), pulls,
re-applies with ids above the new maximum and lands version n+2, the digest chain (P-26) holding; an unpushed status
commit B made before is pushed. Refusals (exit 4): renumbering, deletion, a dependency on a higher id, the other
executor's task (TD-A6), an in-flight task (TD-A3), a decision applied twice, unresolved or of the wrong kind. Three
rejected pushes: exit 1 E_CAS_REJECTED with the local state repository as it was. In process (fakes of lane B04):
supersession goes through status.transition, and gates.json is installed from the patch.

Run: python -m unittest discover -s scripts/tests -p "test_amend.py" -v
"""
from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path
from typing import Any

import _support as S
import _support_B02 as B

from execlib import amend, catalogue, clock, decisionsio, errors, jsonio, paths, planning, plan as plan_mod, \
    statusio, templates, validate

NOW = clock.parse_utc(S.FIXED_NOW)


def build_plan(sd: B.StateDir) -> dict:
    """The fixture draft without ui requirements (no /frontend on the test machine's path is involved), with dev B
    full, lane L6 of executor B and one B task; instantiated, the build deadline inserted, approved."""
    draft = sd.draft()
    draft["requirements"] = [r for r in draft["requirements"] if r["id"] != "FR-006"]  # only FE-1x covered it
    for r in draft["requirements"]:
        if r["surface"] == "ui":
            r["surface"], r["feature_group"] = "api", None
    draft["feature_groups"] = []
    draft["libraries"] = [{"library": "execution", "key": "execution", "params": {}}]
    draft["lanes"].append({"id": "L6", "executor": "B", "title": "Extras", "contract": False, "globs": ["src/extra/**"]})
    extra = copy.deepcopy(next(t for t in draft["tasks"] if t["key"] == "health-data"))
    extra.update({"key": "extra", "title": "Extra data (dev B)", "executor": "B", "covers": ["FR-004"],
                  "writes": ["src/extra/**"], "depends_on": ["contract-types"],
                  "description": "Extra data: build exactly src/extra/**."})
    draft["tasks"].append(extra)
    sd.profile["team"]["devs"].append({"id": "devB", "name": "Dev B", "executor": "B", "setup": "full",
                                       "notion_member": True, "availability": []})
    with B.fake_lanes():
        raw, _ids = templates.instantiate(draft, sd.profile, sd.policy, sd.layout, NOW, lane_of=validate.lane_for,
                                          spec_decision="D-001")
        raw = planning.insert_build_complete_deadline(raw, sd.profile)
        raw = templates.compute_latest_starts(raw, sd.profile)
    raw["approved"] = {"at_utc": S.FIXED_NOW, "by": "devA", "decision": "D-002", "plan_sha256": plan_mod.plan_digest(raw)}
    return raw


class TwoClones(unittest.TestCase):
    def setUp(self) -> None:
        self.sd = B.StateDir(decisions=False)
        self.root = self.sd.root
        # exec.py subprocesses (and the in-process calls, through skills.active()) see a temp /frontend, never the
        # real ~/.claude/skills
        self.skills = B.FrontendSkill(B.SAMPLE_LIB)
        self.env = self.skills.env()
        self.sd.profile["paths"]["feature_catalogue"] = paths.posix(self.root / "catalogue" / "feature-catalogue.json")
        with self.skills.active():
            raw = build_plan(self.sd)
        self.plan0 = raw
        self.origin = self.root / "state.git"
        S.git(self.root, "init", "--quiet", "--bare", "-b", "main", str(self.origin), env=self.env)
        self.a = self.root / "repo-a" / ".execution"
        self.b = self.root / "repo-b" / ".execution"
        S.git(self.root, "clone", "--quiet", self.origin.as_posix(), str(self.a), env=self.env)
        S.git(self.a, "config", "core.autocrlf", "false", env=self.env)
        blocks = (B.spec_validation_blocks("D-001", self.sd.spec_sha) + B.amendment_blocks("D-003")
                  + B.amendment_blocks("D-004") + B.amendment_blocks("D-005", "fix-selection")
                  + B.amendment_blocks("D-006", "approval") + B.amendment_blocks("D-007", resolved=False)
                  + B.amendment_blocks("D-500") + B.amendment_blocks("D-501"))
        files = {"plan.json": raw, "profile.json": self.sd.profile, "policy.json": self.sd.policy,
                 "status/A.json": statusio.default_doc("A"), "status/B.json": statusio.default_doc("B")}
        for rel, doc in files.items():
            jsonio.write_json_atomic(self.a / rel, doc)
        S.write_text(self.a / "decisions.md", B.decision_text(blocks))
        S.write_text(self.a / ".gitattributes", "* text=auto eol=lf\nevents.jsonl merge=union\ndecisions.md merge=union\n")
        S.write_text(self.a / ".gitignore", "local/\nfrontend/gates/\n")
        S.git(self.a, "add", "--all", env=self.env)
        S.git(self.a, "commit", "--quiet", "-m", "chore(state): A init", env=self.env)
        S.git(self.a, "push", "--quiet", "origin", "HEAD:main", env=self.env)
        S.git(self.root, "clone", "--quiet", self.origin.as_posix(), str(self.b), env=self.env)
        S.git(self.b, "config", "core.autocrlf", "false", env=self.env)
        self.ids = {t["key"]: t["id"] for t in raw["tasks"]}

    def tearDown(self) -> None:
        self.skills.cleanup()
        self.sd.cleanup()

    # -- helpers --
    def patch_file(self, name: str, patch: dict) -> Path:
        p = self.root / "patches" / name
        jsonio.write_json_atomic(p, patch)
        return p

    def research_task(self, key: str, executor: str, deps: list[str]) -> dict:
        return {"key": key, "title": f"Recon note {key}", "description": f"Write the recon note {key}.",
                "covers": ["FR-004"], "priority": "P3", "required": False, "phase": "recon", "kind": "research",
                "owner": "agent", "executor": executor, "depends_on": deps, "writes": [], "resources": [],
                "estimate": {"p10_min": 5, "p50_min": 10, "p90_min": 20, "source": "planner"},
                "model": "sonnet", "effort": "low",
                "proof": {"type": "file", "spec": {"path": f"{paths.posix(self.root)}/private/{key}.md"},
                          "expect": {"summary": "the note exists"}, "max_runtime_min": 1,
                          "negative_control": {"kind": "not-applicable", "description": "a note",
                                               "expect_nonzero": True, "waived_reason": "research notes only"}},
                "proof_author": "planner"}

    def amend(self, clone: Path, executor: str, decision: str, patch: Path) -> tuple[int, dict]:
        code, envl, _logs = S.run_exec(["amend", "--decision", decision, "--patch", str(patch), "--state", str(clone),
                                        "--executor", executor], self.root, self.env, timeout=300)
        return code, envl

    def plan_of(self, clone: Path) -> dict:
        return json.loads((clone / "plan.json").read_text(encoding="utf-8"))

    def head(self, clone: Path) -> str:
        return S.git(clone, "rev-parse", "HEAD", env=self.env).stdout.decode().strip()

    def install_hook(self, clone: Path, body: str) -> None:
        hook = clone / ".git" / "hooks" / "pre-push"
        S.write_text(hook, "#!/bin/sh\n" + body)
        hook.chmod(0o755)

    # -- tests --
    def test_one_wins_the_other_retries_and_lands_n_plus_2(self) -> None:
        check = self.ids["execution.ex-devb-check"]
        pa = self.patch_file("a.json", {"add_tasks": [self.research_task("note-a", "A", [])]})
        pb = self.patch_file("b.json", {"add_tasks": [self.research_task("note-b", "B", [check])]})
        # an unpushed status commit of B, made before the amendment
        doc = statusio.default_doc("B")
        doc["seq"] = 1
        jsonio.write_json_atomic(self.b / "status" / "B.json", doc)
        S.git(self.b, "add", "status/B.json", env=self.env)
        S.git(self.b, "commit", "--quiet", "-m", "chore(state): B 20261003T071200Z status", env=self.env)
        status_commit = self.head(self.b)
        marker = self.root / "hook-ran"
        py = paths.posix(Path(sys.executable))
        exec_py = paths.posix(S.EXEC_PY)
        self.install_hook(self.b, f'if [ -f "{paths.posix(self.b)}/.git/amend-pushed" ] && [ ! -f "{paths.posix(marker)}" ]; then\n'
                                  f'  touch "{paths.posix(marker)}"\n'
                                  f'  cd "{paths.posix(self.root)}" && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX "{py}" "{exec_py}" '
                                  f'amend --decision D-003 --patch "{paths.posix(pa)}" --state "{paths.posix(self.a)}" '
                                  f'--executor A > "{paths.posix(self.root)}/a-envelope.json" 2>/dev/null\n'
                                  'fi\nexit 0\n')
        # arm the hook only for the amend push (the pending status commit is pushed first, unhindered)
        self.install_post(self.b)
        code, envl = self.amend(self.b, "B", "D-500", pb)
        self.assertEqual(code, 0, envl["errors"])
        self.assertTrue(marker.exists(), "A's amendment ran between B's fetch and B's push")
        a_env = json.loads((self.root / "a-envelope.json").read_text(encoding="utf-8"))
        self.assertTrue(a_env["ok"], a_env["errors"])
        self.assertEqual(a_env["data"]["plan_version"], 2)
        self.assertEqual(envl["data"]["plan_version"], 3)
        self.assertGreaterEqual(envl["data"]["push"]["attempts"], 2)
        a_new, b_new = a_env["data"]["added"][0], envl["data"]["added"][0]
        self.assertGreater(int(b_new[1:]), int(a_new[1:]), "B re-applied with ids above A's (TD-A1)")
        S.git(self.a, "fetch", "--quiet", "origin", env=self.env)
        final = json.loads(S.git(self.a, "show", "origin/main:plan.json", env=self.env).stdout.decode("utf-8"))
        self.assertEqual([am["decision"] for am in final["amendments"]], ["D-003", "D-500"])
        self.assertEqual(final["plan_version"], 3)
        with self.skills.active():
            vctx = validate.VContext(profile=self.sd.profile, policy=self.sd.policy, statuses=None, now=NOW,
                                     skills_present=validate.frontend_parts_present(),
                                     layout=paths.layout_for(None, self.b))
            rep = validate.validate_plan(final, vctx)
        self.assertNotIn("E_PLAN_TAMPERED", {e.code for e in rep.errors})
        self.assertEqual([e.code for e in rep.errors], [])
        anc = S.git(self.a, "merge-base", "--is-ancestor", status_commit, "origin/main", env=self.env, check=False)
        self.assertEqual(anc.returncode, 0, "B's unpushed status commit was pushed")

    def install_post(self, clone: Path) -> None:
        """Mark the clone so the pre-push hook fires only once the amend commit exists (subject chore(plan))."""
        hook = clone / ".git" / "hooks" / "pre-push"
        text = hook.read_text(encoding="utf-8")
        arm = (f'subj=$(git log -1 --format=%s)\ncase "$subj" in "chore(plan): amend"*) touch '
               f'"{paths.posix(clone)}/.git/amend-pushed";; esac\n')
        S.write_text(hook, text.replace("#!/bin/sh\n", "#!/bin/sh\n" + arm, 1))
        hook.chmod(0o755)

    def test_forbidden_changes_are_refused(self) -> None:
        engine, eng_tests = self.ids["engine"], self.ids["engine-tests"]
        cases = [
            ({"change": [{"task": engine, "fields": {"id": "T999"}}]}, "E_RENUMBER"),
            ({"delete": [engine]}, "E_RENUMBER"),
            ({"change": [{"task": engine, "fields": {"depends_on": sorted(self.plan0["tasks"][3]["depends_on"]
                                                                           + [eng_tests])}}]}, "E_DEP_ORDER"),
            ({"change": [{"task": engine, "fields": {"depends_on": []}}]}, "E_POLICY"),
            ({"change": [{"task": engine, "fields": {"owner": "devA"}}]}, "E_POLICY"),
        ]
        before = (self.head(self.a), (self.a / "plan.json").read_bytes())
        for i, (patch, code_name) in enumerate(cases):
            with self.subTest(code=code_name, i=i):
                if patch.get("change") and "depends_on" in patch["change"][0]["fields"] and code_name == "E_DEP_ORDER":
                    t = next(t for t in self.plan0["tasks"] if t["id"] == engine)
                    patch["change"][0]["fields"]["depends_on"] = t["depends_on"] + [eng_tests]
                code, envl = self.amend(self.a, "A", "D-003", self.patch_file(f"f{i}.json", patch))
                self.assertEqual(code, 4, envl)
                self.assertEqual(envl["errors"][0]["code"], code_name)
        self.assertEqual(before, (self.head(self.a), (self.a / "plan.json").read_bytes()))
        # positive control: an allowed change lands
        ok = {"change": [{"task": engine, "fields": {"title": "ETA engine (decile rule)"}}]}
        code, envl = self.amend(self.a, "A", "D-003", self.patch_file("ok.json", ok))
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual(envl["data"]["changed"], [engine])

    def test_other_executors_task_and_in_flight(self) -> None:
        engine = self.ids["engine"]
        code, envl = self.amend(self.b, "B", "D-500", self.patch_file("x.json", {
            "change": [{"task": engine, "fields": {"title": "renamed by B"}}]}))
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_AMEND_IN_FLIGHT"))
        doc = statusio.default_doc("A")
        doc["tasks"][engine] = S.build_task_status("running")
        jsonio.write_json_atomic(self.a / "status" / "A.json", doc)
        S.git(self.a, "add", "status/A.json", env=self.env)
        S.git(self.a, "commit", "--quiet", "-m", "chore(state): A running", env=self.env)
        code, envl = self.amend(self.a, "A", "D-003", self.patch_file("s.json", {"supersede": [engine]}))
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_AMEND_IN_FLIGHT"))
        code, envl = self.amend(self.a, "A", "D-003", self.patch_file("w.json", {
            "change": [{"task": engine, "fields": {"writes": ["src/engine/core/**"]}}]}))
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_AMEND_IN_FLIGHT"))
        # positive control: a title change of the running task is allowed
        code, envl = self.amend(self.a, "A", "D-003", self.patch_file("t.json", {
            "change": [{"task": engine, "fields": {"title": "ETA engine v2"}}]}))
        self.assertEqual(code, 0, envl["errors"])

    def test_decision_checks(self) -> None:
        p = self.patch_file("n.json", {"add_tasks": [self.research_task("note-x", "A", [])]})
        self.assertEqual(self.amend(self.a, "A", "D-099", p)[0], 4)
        self.assertEqual(self.amend(self.a, "A", "D-007", p)[0], 4)
        self.assertEqual(self.amend(self.a, "A", "D-006", p)[0], 4)
        code, envl = self.amend(self.a, "A", "D-005", p)
        self.assertEqual(code, 0, envl["errors"])
        p2 = self.patch_file("n2.json", {"add_tasks": [self.research_task("note-y", "A", [])]})
        code2, env2 = self.amend(self.a, "A", "D-005", p2)
        self.assertEqual((code2, env2["errors"][0]["code"]), (4, "E_AMEND_APPLIED"))

    def test_three_rejections_leave_the_clone_untouched(self) -> None:
        self.install_hook(self.a, "exit 1\n")
        before = (self.head(self.a), (self.a / "plan.json").read_bytes())
        code, envl = self.amend(self.a, "A", "D-003", self.patch_file("r.json", {
            "add_tasks": [self.research_task("note-r", "A", [])]}))
        self.assertEqual((code, envl["errors"][0]["code"]), (1, "E_CAS_REJECTED"))
        self.assertEqual(before, (self.head(self.a), (self.a / "plan.json").read_bytes()))
        status = S.git(self.a, "status", "--porcelain", "--", "plan.json", env=self.env).stdout.decode().strip()
        self.assertEqual(status, "")

    def test_invalid_result_is_exit_1_and_nothing_committed(self) -> None:
        bad = self.research_task("build-late", "A", [])
        bad.update({"phase": "build", "required": True})
        before = self.head(self.a)
        code, envl = self.amend(self.a, "A", "D-003", self.patch_file("i.json", {"add_tasks": [bad]}))
        self.assertEqual(code, 1)
        self.assertEqual(envl["errors"][0]["code"], "E_BUILD_GATE")
        self.assertEqual(before, self.head(self.a))


class InProcess(unittest.TestCase):
    """Supersession through status.transition and gates.json from the patch (lane B04 faked)."""

    def setUp(self) -> None:
        self.case = TwoClones("test_decision_checks")
        self.case.setUp()

    def tearDown(self) -> None:
        self.case.tearDown()

    def test_supersede_and_gates_json(self) -> None:
        c = self.case
        backtest = c.ids["backtest"]
        gates = c.root / "inbox" / "gates.json"
        jsonio.write_json_atomic(gates, {"gates": [{"name": "test", "cmd": "node --test"}]})
        replacement = c.research_task("backtest-note", "A", [])
        replacement["covers"] = ["FR-007"]
        patch = c.patch_file("sg.json", {"supersede": [backtest], "add_tasks": [replacement],
                                         "gates_json": str(gates)})
        layout = paths.layout_for(None, c.a)
        import argparse
        with B.fake_lanes() as fakes, c.skills.active():
            ctx = B.make_ctx(layout, "amend")
            res = amend.cmd_amend(ctx, argparse.Namespace(decision="D-004", patch=str(patch)))
        self.assertEqual(res.data["superseded"], [backtest])
        self.assertEqual(fakes["status"].calls, [(backtest, "superseded")])
        st = json.loads((c.a / "status" / "A.json").read_text(encoding="utf-8"))
        self.assertEqual(st["tasks"][backtest]["status"], "superseded")
        self.assertEqual(json.loads((c.a / "gates.json").read_text(encoding="utf-8"))["gates"][0]["name"], "test")
        tracked = S.git(c.a, "ls-files", "gates.json", env=c.env).stdout.decode().strip()
        self.assertEqual(tracked, "gates.json")
        final = json.loads((c.a / "plan.json").read_text(encoding="utf-8"))
        self.assertEqual(final["amendments"][-1]["superseded"], [backtest])
        self.assertIn(backtest, validate.superseded_ids(final))
        events = [json.loads(x)["type"] for x in (c.a / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertIn("plan.amended", events)

    def test_external_catalogue_written_only_after_the_push_lands(self) -> None:
        """profile.paths.feature_catalogue outside the state repo: E_CAS_REJECTED leaves it untouched (reset --keep
        cannot restore a file it never committed); positive control: the same amendment, landed, writes it."""
        c = self.case
        target = Path(c.sd.profile["paths"]["feature_catalogue"])
        self.assertRaises(ValueError, paths.layout_for(None, c.a).rel, target)  # outside the state repo
        entries = catalogue.generate(B.load("draft.json"))
        layout = paths.layout_for(None, c.a)
        import argparse
        from unittest import mock
        patch = c.patch_file("cat.json", {"add_tasks": [c.research_task("note-cat", "A", [])]})
        c.install_hook(c.a, "exit 1\n")
        with B.fake_lanes(), c.skills.active(), mock.patch.object(amend.catalogue, "generate", return_value=entries):
            with self.assertRaises(errors.CasRejected):
                amend.cmd_amend(B.make_ctx(layout, "amend"), argparse.Namespace(decision="D-003", patch=str(patch)))
        self.assertFalse(target.exists(), "an amendment that never landed wrote the external catalogue")
        (c.a / ".git" / "hooks" / "pre-push").unlink()
        with B.fake_lanes(), c.skills.active(), mock.patch.object(amend.catalogue, "generate", return_value=entries):
            res = amend.cmd_amend(B.make_ctx(layout, "amend"), argparse.Namespace(decision="D-003", patch=str(patch)))
        self.assertTrue(res.data["catalogue_changed"])
        self.assertEqual(json.loads(target.read_text(encoding="utf-8")), entries)
        events = [json.loads(x)["type"] for x in (c.a / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertIn("catalogue.generated", events)

    def test_apply_patch_pure(self) -> None:
        c = self.case
        layout = paths.layout_for(None, c.a)
        old = c.plan0
        with self.assertRaises(errors.PolicyRefused):
            amend.apply_patch(dict(old, approved=None), {}, "D-003", layout, c.sd.profile, NOW)
        new, summary = amend.apply_patch(old, {"add_requirements": [{
            "id": "NFR-950", "title": "Extra NFR", "text": "x", "priority": "P3", "required": False,
            "feature_group": None, "surface": "none", "status_expected": None, "story": None, "source": "planner"}],
            "add_tasks": [c.research_task("note-z", "A", [])]}, "D-003", layout, c.sd.profile, NOW)
        self.assertEqual(summary["requirements_added"], ["NFR-950"])
        self.assertEqual(new["plan_version"], 2)
        self.assertEqual(new["amendments"][-1]["plan_sha256_before"], old["approved"]["plan_sha256"])
        self.assertEqual(new["amendments"][-1]["plan_sha256_after"], plan_mod.plan_digest(new))
        self.assertEqual(summary["added"], [f"T{plan_mod.max_id_num(old) + 1:03d}"])


class PatchFileArgument(unittest.TestCase):
    """README.md 5-6: `amend --patch` naming a missing file (or a directory) is exit 2 E_USAGE naming the path;
    malformed JSON is E_SCHEMA (exit 1) naming the line, never an E_INTERNAL decode error. Checked before any
    decision lookup, lock or git call."""

    def setUp(self) -> None:
        self.sd = B.StateDir()

    def tearDown(self) -> None:
        self.sd.cleanup()

    def run_amend(self, patch: Path) -> Any:
        return B.run_handler(amend.cmd_amend, self.sd.layout, "amend", decision="D-003", patch=str(patch))

    def test_missing_patch_is_usage(self) -> None:
        for target in (self.sd.root / "patches" / "absent.json", self.sd.root):
            with self.subTest(target=target.name):
                with self.assertRaises(errors.UsageError) as cm:
                    self.run_amend(target)
                self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_USAGE", 2))
                self.assertIn("--patch", cm.exception.message)
                self.assertIn(target.as_posix(), cm.exception.message)
        self.assertFalse(self.sd.layout.events.exists())

    def test_malformed_patch_is_schema(self) -> None:
        bad = self.sd.root / "patches" / "bad.json"
        S.write_text(bad, '{"add_tasks": [\n')
        with self.assertRaises(errors.ValidationFailed) as cm:
            self.run_amend(bad)
        self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_SCHEMA", 1))
        self.assertIn(bad.as_posix(), cm.exception.items()[0].path or "")


if __name__ == "__main__":
    unittest.main()
