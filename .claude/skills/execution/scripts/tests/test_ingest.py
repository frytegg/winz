"""`exec.py ingest` (contract/CLI.md 1 `ingest`, FRONTEND.md 6.4 and 7, NOTION.md 7.3; lane B02).

Missing fields are listed, never invented (and the document is not written); /frontend's profile schema absent with
a frontend block is E_DEPENDENCY_MISSING with a `dependency-missing` proposal; the spec-validation decision is
bound to the spec's hash (a changed spec is no longer validated); the mirrors /frontend reads are copied from their
authoritative fields; the three `--patch` modes and their refusals; idempotency; the envelope through exec.py; a file argument that does
not exist (--patch, --spec, --profile-draft, --policy-draft) is exit 2 E_USAGE naming the path, with nothing written.

Run: python -m unittest discover -s scripts/tests -p "test_ingest.py" -v
"""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from typing import Any

import _support as S
import _support_B02 as B

from execlib import decisionsio, errors, ingest, jsonio, paths, schema


def ingest_args(**over: Any) -> dict:
    a = {"spec": None, "profile_draft": None, "policy_draft": None, "patch": None, "decision": None,
         "notion_ids": False, "answer": None, "propose_spec_validation": False}
    a.update(over)
    return a


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.sd = B.StateDir(decisions=False)
        self.layout = self.sd.layout
        self.layout.profile.unlink()
        self.layout.policy.unlink()
        self.drafts = self.sd.root / "drafts"
        self.prof_draft = self.drafts / "profile.draft.json"
        self.pol_draft = self.drafts / "policy.draft.json"
        jsonio.write_json_atomic(self.prof_draft, self.sd.profile)
        jsonio.write_json_atomic(self.pol_draft, self.sd.policy)

    def tearDown(self) -> None:
        self.sd.cleanup()

    def run_ingest(self, **over: Any) -> Any:
        args = ingest_args(spec=str(self.sd.spec), profile_draft=str(self.prof_draft), policy_draft=str(self.pol_draft))
        args.update(over)
        with B.FrontendSkill(B.SAMPLE_LIB):
            return B.run_handler(ingest.cmd_ingest, self.layout, "ingest", **args)


class Ingest(Base):
    def test_complete_drafts_write_both_documents(self) -> None:
        with B.fake_lanes():
            res = self.run_ingest()
        self.assertEqual(res.exit_code, 0, res.errors[:3])
        self.assertEqual(res.data["missing"], [])
        self.assertEqual(res.data["frontend_schema"], "present")
        prof = json.loads(self.layout.profile.read_text(encoding="utf-8"))
        self.assertEqual(prof["frontend"]["paths"]["claims_ledger"], prof["phase_b"]["claims_ledger"])
        self.assertEqual(prof["frontend"]["workspace"]["private_dir"], prof["workspace"]["private_dir"])
        self.assertEqual(res.data["spec"]["sha256"], self.sd.spec_sha)
        self.assertIn("FR-001", res.data["spec"]["requirement_ids"])
        self.assertFalse(res.data["spec"]["ids_missing"])
        self.assertFalse(res.data["spec"]["validated"])

    def test_missing_fields_listed_never_invented(self) -> None:
        draft = copy.deepcopy(self.sd.profile)
        del draft["frontend"]["stack"]
        draft["workspace"]["private_dir"] = None
        del draft["event"]["display_zones"]
        jsonio.write_json_atomic(self.prof_draft, draft)
        with B.fake_lanes():
            res = self.run_ingest()
        self.assertEqual(res.exit_code, 1)
        fields = {m["field"]: m["action"] for m in res.data["missing"]}
        self.assertEqual(fields.get("/workspace/private_dir"), "manual-task")
        self.assertEqual(fields.get("/event/display_zones"), "manual-task")
        self.assertEqual(fields.get("/frontend/stack"), "decision")
        self.assertFalse(self.layout.profile.exists(), "a profile with a missing required field is never written")
        self.assertTrue(self.layout.policy.exists(), "the valid policy is written")
        self.assertIsNone(res.data["profile_path"])

    def test_frontend_schema_absent_is_a_dependency_with_a_proposal(self) -> None:
        args = ingest_args(spec=str(self.sd.spec), profile_draft=str(self.prof_draft), policy_draft=str(self.pol_draft))
        with B.fake_lanes() as fakes, B.FrontendSkill(B.SAMPLE_LIB, schemas=False):
            with self.assertRaises(errors.DependencyMissing) as cm:
                B.run_handler(ingest.cmd_ingest, self.layout, "ingest", **args)
        self.assertEqual(cm.exception.data["frontend_schema"], "missing")
        did = cm.exception.data["proposal"]
        prop, _res = decisionsio.find(self.layout, did)
        self.assertEqual(prop["kind"], "dependency-missing")
        self.assertFalse(self.layout.profile.exists())
        self.assertEqual([c[1] for c in fakes["decisions"].calls], ["dependency-missing"])
        # positive control: without a frontend block the same command needs no /frontend schema
        draft = copy.deepcopy(self.sd.profile)
        del draft["frontend"]
        jsonio.write_json_atomic(self.prof_draft, draft)
        with B.fake_lanes(), B.FrontendSkill(B.SAMPLE_LIB, schemas=False):
            res = B.run_handler(ingest.cmd_ingest, self.layout, "ingest", **args)
        self.assertEqual(res.exit_code, 0)
        self.assertIsNone(res.data["frontend_schema"])

    def test_spec_validation_bound_to_the_hash(self) -> None:
        with B.fake_lanes():
            res = self.run_ingest(propose_spec_validation=True)
            did = res.data["spec"]["proposal"]
            prop, _r = decisionsio.find(self.layout, did)
            self.assertEqual((prop["kind"], prop["spec_sha256"]), ("spec-validation", self.sd.spec_sha))
            again = self.run_ingest(propose_spec_validation=True)
            self.assertEqual(again.data["spec"]["proposal"], did, "an open proposal is returned, not duplicated")
            S.write_text(self.layout.decisions, self.layout.decisions.read_text(encoding="utf-8") + "\n" +
                         B.decision_text([{"schema": "execution.decision/1", "record": "resolution", "id": did,
                                           "at_utc": S.FIXED_NOW, "by": "devA", "choice": "validate",
                                           "source": "terminal", "quote": "ok spec"}]))
            ok = self.run_ingest()
            self.assertTrue(ok.data["spec"]["validated"])
            self.assertEqual(ok.data["spec"]["validated_decision"], did)
            S.write_text(self.sd.spec, B.SPEC_TEXT + "FR-008 added after the validation\n")
            changed = self.run_ingest()
            self.assertFalse(changed.data["spec"]["validated"], "a changed spec invalidates the decision")
            self.assertIsNone(changed.data["spec"]["validated_decision"])

    def test_idempotent_bytes_and_events(self) -> None:
        with B.fake_lanes():
            self.run_ingest()
            first = (self.layout.profile.read_bytes(), self.layout.policy.read_bytes())
            self.run_ingest()
        self.assertEqual(first, (self.layout.profile.read_bytes(), self.layout.policy.read_bytes()))
        events = [json.loads(x) for x in self.layout.events.read_text(encoding="utf-8").splitlines() if x.strip()]
        self.assertEqual([e["type"] for e in events], ["ingest", "ingest"])

    def test_run_state_preflight_to_ingest(self) -> None:
        self.sd.local_state("PREFLIGHT")
        with B.fake_lanes():
            self.run_ingest()
        st = json.loads(self.layout.local_state.read_text(encoding="utf-8"))
        self.assertEqual(st["run_state"], "INGEST")

    def test_executor_b_refused(self) -> None:
        args = ingest_args(spec=str(self.sd.spec))
        with self.assertRaises(errors.PolicyRefused):
            B.run_handler(ingest.cmd_ingest, self.layout, "ingest", executor="B", **args)
        with self.assertRaises(errors.UsageError):
            B.run_handler(ingest.cmd_ingest, self.layout, "ingest", **ingest_args())


class Patches(Base):
    def setUp(self) -> None:
        super().setUp()
        with B.fake_lanes():
            res = self.run_ingest()
        self.assertEqual(res.exit_code, 0)

    def patch(self, ops: Any) -> Path:
        p = self.drafts / "patch.json"
        jsonio.write_json_atomic(p, ops)
        return p

    def test_notion_ids_only_null_values(self) -> None:
        good = self.patch([{"op": "replace", "path": "/notion/views/board", "value": "view-123"}])
        res = self.run_ingest(patch=str(good), notion_ids=True)
        self.assertEqual(res.exit_code, 0)
        prof = json.loads(self.layout.profile.read_text(encoding="utf-8"))
        self.assertEqual(prof["notion"]["views"]["board"], "view-123")
        again = self.patch([{"op": "replace", "path": "/notion/views/board", "value": "view-456"}])
        with self.assertRaises(errors.PolicyRefused):
            self.run_ingest(patch=str(again), notion_ids=True)
        outside = self.patch([{"op": "replace", "path": "/project/name", "value": "X"}])
        with self.assertRaises(errors.PolicyRefused):
            self.run_ingest(patch=str(outside), notion_ids=True)

    def test_decision_must_be_resolved_and_of_kind(self) -> None:
        ops = self.patch([{"op": "replace", "path": "/git/push", "value": False, "doc": "policy"}])
        with self.assertRaises(errors.PolicyRefused):
            self.run_ingest(patch=str(ops), decision="D-007")
        S.write_text(self.layout.decisions, B.decision_text(B.amendment_blocks("D-007", "amendment")))
        with self.assertRaises(errors.PolicyRefused):
            self.run_ingest(patch=str(ops), decision="D-007")
        S.write_text(self.layout.decisions, B.decision_text(B.amendment_blocks("D-008", "policy-exception",
                                                                               resolved=False)))
        with self.assertRaises(errors.PolicyRefused):
            self.run_ingest(patch=str(ops), decision="D-008")
        S.write_text(self.layout.decisions, B.decision_text(B.amendment_blocks("D-009", "policy-exception")))
        res = self.run_ingest(patch=str(ops), decision="D-009")
        self.assertEqual(res.exit_code, 0)
        self.assertFalse(json.loads(self.layout.policy.read_text(encoding="utf-8"))["git"]["push"])
        invalid = self.patch([{"op": "replace", "path": "/git/force", "value": "sometimes", "doc": "policy"}])
        res2 = self.run_ingest(patch=str(invalid), decision="D-009")
        self.assertEqual(res2.exit_code, 1)
        self.assertEqual(json.loads(self.layout.policy.read_text(encoding="utf-8"))["git"]["force"], "never")

    def test_answer_patch_needs_a_verified_fe01_answer(self) -> None:
        jsonio.write_json_atomic(self.layout.plan, {"tasks": [{"id": "T022", "template": "frontend:FE-01"}]})
        refs = copy.deepcopy(self.sd.profile["frontend"]["references"])
        for r in refs[:2]:
            r["owner_confirmed"] = True
        ops = self.patch([{"op": "replace", "path": "/frontend/references", "value": refs}])
        with self.assertRaises(errors.PolicyRefused):
            self.run_ingest(patch=str(ops), answer="T022-refs")
        header = {"schema": "execution.answer/1", "key": "T022-refs", "task": "T022", "bring_back_key": "T022-refs",
                  "kind": "text", "source": "terminal", "received_utc": S.FIXED_NOW, "by": "devA", "value": None,
                  "attachments": [], "verification": {"method": "regex", "ok": False, "detail": "no",
                                                      "at_utc": S.FIXED_NOW}}
        S.write_text(self.layout.answer("T022-refs"), "```json\n" + json.dumps(header) + "\n```\n\nkeep x\n")
        with self.assertRaises(errors.PolicyRefused):
            self.run_ingest(patch=str(ops), answer="T022-refs")
        header["verification"]["ok"] = True
        S.write_text(self.layout.answer("T022-refs"), "```json\n" + json.dumps(header) + "\n```\n\nkeep x\n")
        res = self.run_ingest(patch=str(ops), answer="T022-refs")
        self.assertEqual(res.exit_code, 0)
        prof = json.loads(self.layout.profile.read_text(encoding="utf-8"))
        self.assertEqual(sum(1 for r in prof["frontend"]["references"] if r["owner_confirmed"]), 2)
        outside = self.patch([{"op": "replace", "path": "/frontend/mode", "value": "full"}])
        with self.assertRaises(errors.PolicyRefused):
            self.run_ingest(patch=str(outside), answer="T022-refs")

    def test_patch_needs_exactly_one_mode(self) -> None:
        ops = self.patch([{"op": "replace", "path": "/notion/views/waves", "value": "v"}])
        with self.assertRaises(errors.UsageError):
            self.run_ingest(patch=str(ops))
        with self.assertRaises(errors.UsageError):
            self.run_ingest(patch=str(ops), notion_ids=True, decision="D-001")


class MissingFileArguments(Base):
    """README.md 5-6: a missing input file named on the command line is a usage error (exit 2 E_USAGE) whose message
    names the path, never an E_INTERNAL FileNotFoundError; nothing is read or written past the check."""

    def assert_usage(self, flag: str, missing: Path, **over: Any) -> None:
        with B.fake_lanes() as fakes:
            with self.assertRaises(errors.UsageError) as cm:
                self.run_ingest(**over)
        self.assertEqual(cm.exception.code, "E_USAGE")
        self.assertEqual(cm.exception.exit_code, 2)
        self.assertIn(flag, cm.exception.message)
        self.assertIn(missing.as_posix(), cm.exception.message)
        self.assertFalse(self.layout.profile.exists())
        self.assertFalse(self.layout.policy.exists())
        self.assertFalse(self.layout.events.exists())
        self.assertEqual(fakes["decisions"].calls, [])

    def test_missing_spec(self) -> None:
        gone = self.sd.root / "nope" / "SPEC.md"
        self.assert_usage("--spec", gone, spec=str(gone), propose_spec_validation=True)

    def test_missing_profile_draft(self) -> None:
        gone = self.drafts / "absent.profile.json"
        self.assert_usage("--profile-draft", gone, profile_draft=str(gone))

    def test_missing_policy_draft(self) -> None:
        gone = self.drafts / "absent.policy.json"
        self.assert_usage("--policy-draft", gone, policy_draft=str(gone))

    def test_directory_is_not_a_file(self) -> None:
        self.assert_usage("--profile-draft", self.drafts, profile_draft=str(self.drafts))

    def test_missing_patch_in_process(self) -> None:
        with B.fake_lanes():
            self.assertEqual(self.run_ingest().exit_code, 0)
        before = (self.layout.profile.read_bytes(), self.layout.policy.read_bytes(), self.layout.events.read_bytes())
        gone = self.drafts / "absent.patch.json"
        with self.assertRaises(errors.UsageError) as cm:
            self.run_ingest(patch=str(gone), notion_ids=True)
        self.assertEqual(cm.exception.exit_code, 2)
        self.assertIn(gone.as_posix(), cm.exception.message)
        self.assertEqual(before, (self.layout.profile.read_bytes(), self.layout.policy.read_bytes(),
                                  self.layout.events.read_bytes()))


class Cli(unittest.TestCase):
    def test_envelope_through_exec_py(self) -> None:
        sd = B.StateDir(decisions=False)
        skills = B.FrontendSkill(B.SAMPLE_LIB)
        try:
            drafts = sd.root / "drafts"
            jsonio.write_json_atomic(drafts / "profile.json", sd.profile)
            jsonio.write_json_atomic(drafts / "policy.json", sd.policy)
            # the subprocess's home is the temp one, so /frontend's profile schema is the pinned copy
            env = skills.env()
            args = ["ingest", "--state", str(sd.state), "--spec", str(sd.spec), "--profile-draft",
                    str(drafts / "profile.json"), "--policy-draft", str(drafts / "policy.json")]
            code, envl, _ = S.run_exec(args, sd.root, env)
            self.assertEqual(code, 0, envl["errors"])
            self.assertEqual(envl["data"]["frontend_schema"], "present")
            self.assertEqual(envl["data"]["missing"], [])
            self.assertTrue(sd.layout.profile.is_file())
            code2, env2, _ = S.run_exec(["ingest", "--state", str(sd.state)], sd.root, env)
            self.assertEqual(code2, 2)
            self.assertEqual(env2["errors"][0]["code"], "E_USAGE")
        finally:
            skills.cleanup()
            sd.cleanup()


    def test_missing_patch_file_through_exec_py(self) -> None:
        """B09's probe: `ingest --patch <missing> --notion-ids` was exit 3 E_INTERNAL (FileNotFoundError). Now exit 2
        E_USAGE with a schema-valid envelope naming the path, absolute or relative to the working directory; the
        positive control applies an existing valid patch through the same command line."""
        sd = B.StateDir(decisions=False)
        skills = B.FrontendSkill(B.SAMPLE_LIB)
        try:
            env = skills.env()
            schemas = S.SKILL_DIR / "assets" / "schemas"
            envelope_schema = json.loads((schemas / "envelope.schema.json").read_text(encoding="utf-8"))

            def envelope_issues(envl: dict) -> list:
                return list(schema.validate_with(envl, envelope_schema, base_dir=schemas).issues)
            profile_before = sd.layout.profile.read_bytes()
            gone = sd.root / "local" / "notion" / "profile-ids.patch.json"
            for arg in (str(gone), "local/notion/profile-ids.patch.json"):
                with self.subTest(arg=arg):
                    code, envl, _ = S.run_exec(["ingest", "--state", str(sd.state), "--patch", arg, "--notion-ids"],
                                               sd.root, env)
                    self.assertEqual(code, 2, envl["errors"])
                    self.assertEqual(envelope_issues(envl), [])
                    self.assertFalse(envl["ok"])
                    self.assertEqual(envl["exit_code"], 2)
                    self.assertEqual([e["code"] for e in envl["errors"]], ["E_USAGE"])
                    self.assertIn("--patch", envl["errors"][0]["message"])
                    self.assertIn("local/notion/profile-ids.patch.json", envl["errors"][0]["message"])
                    self.assertEqual(sd.layout.profile.read_bytes(), profile_before)
            # positive control: the same file, now present, applies (profile.notion.views.board null -> set)
            jsonio.write_json_atomic(gone, [{"op": "replace", "path": "/notion/views/board", "value": "view-123"}])
            code, envl, _ = S.run_exec(["ingest", "--state", str(sd.state), "--patch",
                                        "local/notion/profile-ids.patch.json", "--notion-ids"], sd.root, env)
            self.assertEqual(code, 0, envl["errors"])
            self.assertEqual(envelope_issues(envl), [])
            self.assertEqual(envl["data"]["patch"], {"mode": "notion-ids", "ops": 1})
            prof = json.loads(sd.layout.profile.read_text(encoding="utf-8"))
            self.assertEqual(prof["notion"]["views"]["board"], "view-123")
        finally:
            skills.cleanup()
            sd.cleanup()


if __name__ == "__main__":
    unittest.main()
