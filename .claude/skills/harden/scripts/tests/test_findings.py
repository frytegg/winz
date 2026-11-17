"""Tests for scripts/findings.py (unittest, temporary git repositories).

pilot-auto-calibration A01-F60: the run's candidates, verifier tasks, findings and approvals
are written by validating scripts.
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
from typing import Any, Dict, List, Optional, Tuple

SCRIPTS = Path(__file__).resolve().parent.parent
SKILL = SCRIPTS.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import findings as F  # noqa: E402
import validate_findings as vf  # noqa: E402

HAS_GIT = shutil.which("git") is not None
_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None
R1, R2, R3, R4 = "er.cc-u1-p1-1", "se-u1-p1-1", "ex-u1-p1-1", "er.cc-u1-p1-2"
NOTE_OK = "It holds: the call at src/a.py:2 drops the error.\nmoney-path: no\nlive-effect: none"


def setUpModule() -> None:
    global _GIT_HOME
    _GIT_HOME = tempfile.mkdtemp(prefix="harden-findings-gitcfg-")
    cfg = Path(_GIT_HOME) / "gitconfig"
    cfg.write_text("[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                   "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                   "[core]\n\tautocrlf = false\n", encoding="utf-8")
    for key, value in {"GIT_CONFIG_GLOBAL": str(cfg), "GIT_CONFIG_NOSYSTEM": "1"}.items():
        _SAVED_ENV[key] = os.environ.get(key)
        os.environ[key] = value


def tearDownModule() -> None:
    for key, value in _SAVED_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    if _GIT_HOME:
        shutil.rmtree(_GIT_HOME, ignore_errors=True)


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=str(repo), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=True)
    return proc.stdout.decode("utf-8", errors="replace").strip()


def raw(rid: str, lens: str, rule: str, file: str, line: int, **extra: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "id": rid, "raw_id": rid, "pass_id": rid.rsplit("-", 1)[0], "lens": lens,
        "rule_ref": rule, "title": "Error dropped at {}:{}".format(file, line), "file": file,
        "line": line, "end_line": line, "tier": "T1", "class": "behavioural",
        "fix_risk": "low", "severity": "medium",
        "severity_criterion": "medium: wrong output under a failure", "confidence": "inference",
        "evidence": [{"kind": "source", "ref": "{}:{}".format(file, line),
                      "detail": "the call drops the error"}],
        "verified": False, "verifier_note": "", "status": "candidate", "notes": ""}
    data.update(extra)
    return data


def verdict(cid: str, **extra: Any) -> Dict[str, Any]:
    data: Dict[str, Any] = {
        "id": cid, "verified": True, "exclusion_class": None, "severity": "medium",
        "severity_criterion": "medium: wrong output under a failure",
        "confidence": "failing_test", "class": "behavioural", "fix": "Propagate the error.",
        "evidence": [{"kind": "test", "ref": "tests/test_a.py::test_err",
                      "detail": "fails at base: error swallowed"}],
        "verifier_note": NOTE_OK}
    data.update(extra)
    return data


@unittest.skipUnless(HAS_GIT, "git is needed")
class FindingsTestCase(unittest.TestCase):
    """A repository with src/a.py and src/b.py, an active auto run, one test gate, a profile
    and raw candidates across errors-resilience, security and exploration."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="harden-findings-"))
        self.repo = self.root / "repo"
        (self.repo / "src").mkdir(parents=True)
        _git(self.repo, "init", "-q")
        (self.repo / "src" / "a.py").write_text("".join("x{} = {}\n".format(i, i)
                                                        for i in range(5)), encoding="utf-8")
        (self.repo / "src" / "b.py").write_text("y = 1\ny = 2\n", encoding="utf-8")
        (self.repo / ".gitignore").write_text(".harden/\n", encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base")
        self.base = _git(self.repo, "rev-parse", "HEAD")
        self.hdir = self.repo / ".harden"
        (self.hdir / "raw-candidates").mkdir(parents=True)
        self.write(".harden/active", {"base_sha": self.base, "branch": "main", "mode": "auto",
                                      "mode_requested": "auto",
                                      "forbidden_commands": ["\\bdeploy\\b"]})
        self.write(".harden/config.json", {"gates": [
            {"name": "test", "cmd": ["python", "-m", "pytest"], "count_regex": "(\\d+) passed"},
            {"name": "build", "cmd": ["python", "-m", "build"]}]})
        self.profile(behavioural=True, structural=True)
        self.raws = [raw(R1, "errors-resilience", "ER-01", "src/a.py", 2, severity="high"),
                     raw(R2, "security", "SE-01", "src/a.py", 2),
                     raw(R3, "exploration", "ER-02", "src/a.py", 3, severity="low"),
                     raw(R4, "errors-resilience", "ER-03", "src/b.py", 1, tier="T0",
                         severity="low")]
        self.write(".harden/raw-candidates/all.json", {"passes": [], "candidates": self.raws})
        self.clusters = [{"id": "H-001", "key": "a-dropped-error", "raw_ids": [R1, R2, R3]},
                         {"id": "H-002", "key": "b-t0", "raw_ids": [R4]}]
        self.write(".harden/cluster-defs.json", self.clusters)

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    # -- helpers ---------------------------------------------------------------------------

    def write(self, rel: str, data: Any) -> None:
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")

    def read(self, rel: str) -> Any:
        return json.loads((self.repo / rel).read_text(encoding="utf-8"))

    def profile(self, **switches: Any) -> None:
        data: Dict[str, Any] = {"version": 1, "auto_apply": switches}
        self.write(".harden/profile.json", data)

    def run_cli(self, *args: str) -> Tuple[int, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = F.main([args[0], *args[1:], "--repo", str(self.repo)])
        return code, out.getvalue() + err.getvalue()

    def build(self, *extra: str) -> Tuple[int, str]:
        return self.run_cli("build", "--clusters", ".harden/cluster-defs.json", "--no-merge",
                            *extra)

    def findings(self) -> Dict[str, Dict[str, Any]]:
        return {f["id"]: f for f in self.read(".harden/findings.json")["findings"]}

    def candidates(self) -> Dict[str, Dict[str, Any]]:
        return {f["id"]: f for f in self.read(".harden/candidates.json")["findings"]}

    def result(self, vid: str, verdicts: List[Dict[str, Any]]) -> None:
        self.write(".harden/verifiers/{}.result.json".format(vid),
                   {"pass_id": vid, "verdicts": verdicts})

    def verified_run(self, *verdicts: Dict[str, Any]) -> None:
        """build, one verifier task over every candidate, its verdicts, assemble."""
        self.assertEqual(self.build()[0], 0)
        self.assertEqual(self.run_cli("verifier-task", "v-1", "H-001", "H-002")[0], 0)
        self.result("v-1", list(verdicts))
        code, text = self.run_cli("assemble")
        self.assertEqual(code, 0, text)

    def decisions(self, *items: Dict[str, Any]) -> None:
        self.write(".harden/decisions.json", {"version": 1, "decisions": list(items)})


class BuildTests(FindingsTestCase):

    def test_build_splits_cross_lens_cluster_and_writes_sidecars(self) -> None:
        code, text = self.build()
        self.assertEqual(code, 0, text)
        cands = self.candidates()
        self.assertEqual(sorted(cands), ["H-001", "H-001-se", "H-002"])
        self.assertEqual(cands["H-001"]["lens"], "errors-resilience")
        self.assertEqual(cands["H-001-se"]["lens"], "security")
        self.assertEqual(cands["H-001-se"]["fingerprint"], "a-dropped-error#security")
        self.assertIn("Cluster H-001 (a-dropped-error), lens errors-resilience: primary raw "
                      "{}; also {}.".format(R1, R3), cands["H-001"]["notes"])
        sidecar = self.read(".harden/candidate-clusters.json")
        self.assertEqual((sidecar["H-001"]["cluster"], sidecar["H-001-se"]["cluster"]),
                         ("H-001", "H-001"))
        er_map = {e["id"]: e for e in self.read(".harden/merge-maps/errors-resilience.json")}
        self.assertEqual(er_map["H-001"]["raw_ids"], [R1])
        self.assertEqual(er_map["H-001"]["passes"], [1])
        self.assertEqual(cands["H-001"]["status"], "candidate")

    def test_build_refuses_unknown_unclustered_and_duplicate_raw_ids(self) -> None:
        cases = [([{"id": "H-001", "key": "k", "raw_ids": [R1, R2, R3, R4, "nope"]}],
                  "unknown raw ids: nope"),
                 ([{"id": "H-001", "key": "k", "raw_ids": [R1, R2, R3]}],
                  "raw ids in no cluster: " + R4),
                 ([{"id": "H-001", "key": "k", "raw_ids": [R1, R2, R3, R4]},
                   {"id": "H-002", "key": "k2", "raw_ids": [R4]}],
                  "raw ids in two clusters: " + R4)]
        for clusters, message in cases:
            self.write(".harden/cluster-defs.json", clusters)
            code, text = self.build()
            self.assertEqual(code, 1, text)
            self.assertIn(message, text)
            self.assertFalse((self.hdir / "candidates.json").exists())

    def test_build_promotes_t0_nonstructural_and_validates(self) -> None:
        self.assertEqual(self.build()[0], 0)
        doc = self.read(".harden/candidates.json")
        self.assertEqual({f["id"]: f["tier"] for f in doc["findings"]}["H-002"], "T1")
        rep = vf.validate_document(doc, repo=self.repo)
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])

    def test_build_no_merge_prints_commands(self) -> None:
        code, text = self.build()
        self.assertEqual(code, 0)
        self.assertIn("merge --lens errors-resilience --map", text)
        self.assertIn("merge --lens security --map", text)

    def test_build_merge_failure_exits_1_after_writing(self) -> None:
        code, text = self.run_cli("build", "--clusters", ".harden/cluster-defs.json")
        self.assertEqual(code, 1, text)
        self.assertIn("ledger.py merge --lens errors-resilience: exit", text)
        self.assertTrue((self.hdir / "candidates.json").is_file())

    def test_build_skips_project_tool_merge(self) -> None:
        extra = [{"source": "triage", "finding": raw("T-001", "project-tool",
                                                     "project:ruff/F401", "src/b.py", 2,
                                                     id="T-001")}]
        extra[0]["finding"].pop("raw_id")
        extra[0]["finding"].pop("pass_id")
        extra[0]["finding"]["location_class"] = "warm"
        self.write(".harden/extra.json", extra)
        code, text = self.build("--extra", ".harden/extra.json")
        self.assertEqual(code, 0, text)
        self.assertIn("project-tool reconciled from triage, DT-12/DT-16", text)
        self.assertFalse((self.hdir / "merge-maps" / "project-tool.json").exists())
        self.assertIn("T-001", self.candidates())

    def test_build_dismiss_needs_reason(self) -> None:
        self.write(".harden/cluster-defs.json", [{"id": "H-001", "key": "k",
                                                  "raw_ids": [R1, R2, R3]}])
        self.write(".harden/dismiss.json", {R4: ""})
        code, text = self.build("--dismiss", ".harden/dismiss.json")
        self.assertEqual(code, 1)
        self.assertIn("dismissed raw ids without a reason: " + R4, text)
        self.write(".harden/dismiss.json", {R4: "duplicate of H-001 in another file"})
        code, text = self.build("--dismiss", ".harden/dismiss.json")
        self.assertEqual(code, 0, text)
        self.assertEqual(self.read(".harden/candidate-clusters.json")["_dismissed"],
                         {R4: "duplicate of H-001 in another file"})

    def test_build_sanitises_control_characters(self) -> None:
        self.raws[0]["title"] = "Error\x1b[31m dropped\x08 here"
        self.write(".harden/raw-candidates/all.json", {"candidates": self.raws})
        code, text = self.build()
        self.assertEqual(code, 0, text)
        self.assertEqual(self.candidates()["H-001"]["title"], "Error dropped\\x08 here")
        self.assertIn("WARN sanitised 2 control characters in {}.title".format(R1), text)


class VerifierTaskTests(FindingsTestCase):

    def test_verifier_task_lists_members_patterns_and_format(self) -> None:
        self.assertEqual(self.build()[0], 0)
        code, text = self.run_cli("verifier-task", "v-1", "H-001")
        self.assertEqual(code, 0, text)
        task = (self.hdir / "prompts" / "v-1.md").read_text(encoding="utf-8")
        self.assertEqual(task.splitlines()[:2], ["pass-id: v-1", "kind: verifier"])
        for needle in ("H-001-se", R1, R2, "`\\bdeploy\\b`", "`python -m pytest`",
                       "with nothing before it", "live-effect: none", "\"verified\": null",
                       "not examined: turn budget"):
            self.assertIn(needle, task)
        self.assertNotIn("python -m build", task)
        ids = self.read(".harden/prompts/v-1.ids.json")
        self.assertEqual(ids["ids"], ["H-001", "H-001-se"])
        lines = text.splitlines()
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0], "pass-id: v-1")
        self.assertIn((self.hdir / "prompts" / "v-1.md").resolve().as_posix(), lines[1])

    def test_verifier_task_refuses_unknown_and_reassigned_ids(self) -> None:
        self.assertEqual(self.build()[0], 0)
        code, text = self.run_cli("verifier-task", "v-1", "H-404")
        self.assertEqual(code, 1)
        self.assertIn("unknown ids: H-404", text)
        self.assertEqual(self.run_cli("verifier-task", "v-1", "H-001")[0], 0)
        code, text = self.run_cli("verifier-task", "v-2", "H-001-se")
        self.assertEqual(code, 1)
        self.assertIn("H-001-se (v-1)", text)
        self.assertEqual(self.run_cli("verifier-task", "v-2", "H-001-se", "--reassign")[0], 0)

    def test_verifier_task_reads_plan_task(self) -> None:
        self.assertEqual(self.build()[0], 0)
        self.write(".harden/tools/verify-plan.json", {"tasks": [
            {"id": "c1-t01", "candidates": ["H-002"]}]})
        code, text = self.run_cli("verifier-task", "c1-t01")
        self.assertEqual(code, 0, text)
        self.assertEqual(self.read(".harden/prompts/c1-t01.ids.json")["ids"], ["H-002"])

    def test_template_money_lines_match_detection(self) -> None:
        detection = (SKILL / "references" / "detection.md").read_text(encoding="utf-8")
        prioritization = (SKILL / "references" / "prioritization.md").read_text(
            encoding="utf-8")
        for sentence in (F.MONEY_PATH_SENTENCE, F.LIVE_EFFECT_SENTENCE, F.REPRODUCE_SENTENCE):
            self.assertIn(sentence, detection)
        self.assertIn("(withdrawals included)", F.MONEY_PATH_SENTENCE)
        self.assertIn("(seed phrases and secrets included)", F.MONEY_PATH_SENTENCE)
        self.assertIn(F.LIVE_EFFECT_PATHS, prioritization)


class AssembleTests(FindingsTestCase):

    def test_assemble_tolerates_preface_before_pass_id(self) -> None:
        self.assertEqual(self.build()[0], 0)
        self.assertEqual(self.run_cli("verifier-task", "v-1", "H-002")[0], 0)
        body = json.dumps({"pass_id": "v-1", "verdicts": [verdict("H-002")]}, indent=1)
        (self.hdir / "verifiers").mkdir(parents=True, exist_ok=True)
        (self.hdir / "verifiers" / "v-1.md").write_text(
            "I checked the candidates below.\n\npass-id: v-1\n```json\n" + body + "\n```\n",
            encoding="utf-8")
        code, text = self.run_cli("assemble")
        self.assertEqual(code, 0, text)
        f = self.findings()["H-002"]
        self.assertEqual((f["status"], f["verifier_id"], f["confidence"]),
                         ("verified", "v-1", "failing_test"))
        self.assertIn("Verifier fix (v-1): Propagate the error.", f["notes"])
        self.assertIn("live-effect: none", f["notes"])

    def test_assemble_prefers_result_json(self) -> None:
        self.assertEqual(self.build()[0], 0)
        self.assertEqual(self.run_cli("verifier-task", "v-1", "H-002")[0], 0)
        (self.hdir / "verifiers").mkdir(parents=True, exist_ok=True)
        (self.hdir / "verifiers" / "v-1.md").write_text("pass-id: v-1\nnot json\n",
                                                         encoding="utf-8")
        self.result("v-1", [verdict("H-002", verified=False, exclusion_class="duplicate",
                                    verifier_note="duplicate of H-001")])
        self.assertEqual(self.run_cli("assemble")[0], 0)
        f = self.findings()["H-002"]
        self.assertEqual((f["status"], f["exclusion_class"]), ("rejected", "duplicate"))

    def test_assemble_defers_with_distinct_reasons(self) -> None:
        self.assertEqual(self.build()[0], 0)
        self.assertEqual(self.run_cli("verifier-task", "v-1", "H-002")[0], 0)
        self.result("v-1", [])
        self.assertEqual(self.run_cli("assemble")[0], 0)
        found = self.findings()
        self.assertIn("not verified: verifier v-1 returned no verdict", found["H-002"]["notes"])
        self.assertIn("not verified: run budget reached", found["H-001"]["notes"])
        self.assertEqual(found["H-001"]["status"], "deferred")

    def test_null_verdict_defers_with_turn_budget_note(self) -> None:
        self.assertEqual(self.build()[0], 0)
        self.assertEqual(self.run_cli("verifier-task", "v-1", "H-002")[0], 0)
        self.result("v-1", [verdict("H-002", verified=None,
                                    verifier_note="not examined: turn budget")])
        self.assertEqual(self.run_cli("assemble")[0], 0)
        self.assertIn("not verified: verifier turn budget reached",
                      self.findings()["H-002"]["notes"])
        # A second verifier answers it: the later verdict replaces the deferral.
        self.assertEqual(self.run_cli("verifier-task", "v-2", "H-002", "--reassign")[0], 0)
        self.result("v-2", [verdict("H-002")])
        self.assertEqual(self.run_cli("assemble")[0], 0)
        self.assertEqual(self.findings()["H-002"]["status"], "verified")

    def test_assemble_weak_confidence_goes_t2_and_high_weak_is_deferred(self) -> None:
        self.verified_run(verdict("H-001", confidence="inference", severity="high",
                                  evidence=[{"kind": "source", "ref": "src/a.py:2",
                                             "detail": "drops it"}]),
                          verdict("H-001-se", confidence="needs_review",
                                  evidence=[{"kind": "source", "ref": "src/a.py:2",
                                             "detail": "drops it"}]),
                          verdict("H-002"))
        found = self.findings()
        self.assertEqual((found["H-001-se"]["tier"], found["H-001-se"]["status"]),
                         ("T2", "verified"))
        self.assertIn("tier T1 -> T2 by DT-27: confidence needs_review (proposed tier T1)",
                      found["H-001-se"]["notes"])
        self.assertEqual(found["H-001"]["status"], "deferred")
        self.assertIn("G204-F04", found["H-001"]["notes"])

    def test_orchestrator_evidence_raises_only_with_saved_output(self) -> None:
        (self.hdir / "tools" / "repro").mkdir(parents=True)
        (self.hdir / "tools" / "repro" / "x.txt").write_text("AssertionError: 1 != 2\n",
                                                             encoding="utf-8")
        self.write(".harden/evidence.json", {
            "H-001-se": [{"kind": "repro", "ref": "python .harden/tools/repro/x.txt",
                          "detail": "saved in .harden/tools/repro/x.txt"}],
            "H-002": [{"kind": "repro", "ref": "python repro.py",
                       "detail": "see .harden/tools/repro/missing.txt"}]})
        self.assertEqual(self.build()[0], 0)
        self.assertEqual(self.run_cli("verifier-task", "v-1", "H-001", "H-002")[0], 0)
        weak = dict(confidence="inference", evidence=[{"kind": "source", "ref": "src/a.py:2",
                                                       "detail": "drops it"}])
        self.result("v-1", [verdict("H-001", **weak), verdict("H-001-se", **weak),
                            verdict("H-002", **weak)])
        code, text = self.run_cli("assemble", "--evidence", ".harden/evidence.json")
        self.assertEqual(code, 0, text)
        found = self.findings()
        self.assertEqual(found["H-001-se"]["confidence"], "reproduction")
        self.assertIn("confidence inference -> reproduction by orchestrator repro evidence "
                      ".harden/tools/repro/x.txt (DT-27)", found["H-001-se"]["notes"])
        self.assertEqual(found["H-002"]["confidence"], "inference")
        self.assertIn("WARN H-002 evidence repro", text)

    def test_alias_borrows_verdict_and_proof_from_primary(self) -> None:
        self.verified_run(verdict("H-001"), verdict("H-002"))
        alias = self.findings()["H-001-se"]
        self.assertEqual((alias["status"], alias["verifier_id"]), ("verified", "v-1"))
        self.assertIn("verdict borrowed from cluster primary H-001 (same defect, verifier v-1)",
                      alias["notes"])
        self.assertTrue(any(e["kind"] == "test" for e in alias["evidence"]))

    def test_invalid_verdict_defers_that_candidate(self) -> None:
        self.verified_run(verdict("H-001"), verdict("H-002", severity="urgent"))
        found = self.findings()
        self.assertEqual(found["H-002"]["status"], "deferred")
        self.assertIn("severity=urgent", found["H-002"]["notes"])
        self.assertEqual(found["H-001"]["status"], "verified")

    def test_unparsable_verifier_defers_its_candidates(self) -> None:
        self.assertEqual(self.build()[0], 0)
        self.assertEqual(self.run_cli("verifier-task", "v-1", "H-002")[0], 0)
        (self.hdir / "verifiers").mkdir(parents=True, exist_ok=True)
        (self.hdir / "verifiers" / "v-1.md").write_text("pass-id: v-1\n{\"pass_id\": \"v-1\", "
                                                         "\"verdicts\": [\n", encoding="utf-8")
        code, text = self.run_cli("assemble")
        self.assertEqual(code, 0, text)
        f = self.findings()["H-002"]
        self.assertEqual(f["status"], "deferred")
        self.assertIn("not verified: verifier v-1 output unparsable", f["notes"])
        self.assertIn("relaunch with findings.py verifier-task --reassign", f["notes"])

    def test_assemble_sanitises_ansi(self) -> None:
        self.verified_run(verdict("H-001", verifier_note="\x1b[1mholds\x1b[0m\x08\n"
                                  "money-path: no\nlive-effect: none"), verdict("H-002"))
        f = self.findings()["H-001"]
        self.assertTrue(f["verifier_note"].startswith("holds\\x08"))
        rep = vf.validate_document(self.read(".harden/findings.json"), repo=self.repo)
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])

    def test_writes_keep_rp06_order(self) -> None:
        self.raws.append(raw("er.cc-u1-p1-3", "errors-resilience", "ER-04", "src/b.py", 2))
        self.write(".harden/raw-candidates/all.json", {"candidates": self.raws})
        self.clusters.append({"id": "H-003", "key": "b-medium",
                              "raw_ids": ["er.cc-u1-p1-3"]})
        self.write(".harden/cluster-defs.json", self.clusters)
        self.write(".harden/rank.json", {"files": [{"path": "src/b.py", "rank": 1},
                                                   {"path": "src/a.py", "rank": 2}]})
        self.assertEqual(self.build()[0], 0)
        order = [f["id"] for f in self.read(".harden/candidates.json")["findings"]]
        # high first; then the two mediums by rank.json (src/b.py ranks first); low last
        self.assertEqual(order, ["H-001", "H-003", "H-001-se", "H-002"])
        blocking = {"id": "H-9", "severity": "low", "blocking": True, "file": "src/a.py"}
        high = {"id": "H-8", "severity": "high", "file": "src/a.py"}
        self.assertEqual([f["id"] for f in sorted([high, blocking], key=lambda f: F.rp06_key(
            f, {}, {}))], ["H-9", "H-8"])

    def test_assemble_keeps_findings_past_verified(self) -> None:
        self.verified_run(verdict("H-001"), verdict("H-002"))
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            if f["id"] == "H-002":
                f["status"] = "reported"
                f["notes"] += "\nPZ-24: row 7: kept for the owner"
        self.write(".harden/findings.json", doc)
        self.result("v-1", [verdict("H-001"), verdict("H-002", verified=False)])
        self.assertEqual(self.run_cli("assemble")[0], 0)
        f = self.findings()["H-002"]
        self.assertEqual(f["status"], "reported")
        self.assertIn("PZ-24: row 7: kept for the owner", f["notes"])

    def test_save_refuses_only_new_errors(self) -> None:
        self.verified_run(verdict("H-001"), verdict("H-002"))
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            if f["id"] == "H-002":
                f["severity_criterion"] = None   # a pre-existing error
        self.write(".harden/findings.json", doc)
        code, text = self.run_cli("mark", "H-001", "--note", "checked again")
        self.assertEqual(code, 0, text)
        self.assertIn("WARN pre-existing error H-002 severity_criterion", text)
        code, text = self.run_cli("mark", "H-001", "--set", "severity_criterion=null")
        self.assertEqual(code, 1, text)
        self.assertIn("ERROR H-001 severity_criterion", text)


class ApprovalsTests(FindingsTestCase):

    def setUp(self) -> None:
        super().setUp()
        self.verified_run(verdict("H-001"), verdict("H-002"))

    def approve(self) -> Tuple[int, str]:
        return self.run_cli("approvals")

    def rows(self) -> List[Dict[str, str]]:
        return vf.parse_approvals((self.hdir / "approvals.md").read_text(encoding="utf-8"))

    def test_approvals_rows_validate(self) -> None:
        self.decisions({"id": "H-001", "decision": "apply", "rule": "row 20", "reason": "fix"},
                       {"id": "H-001-se", "decision": "apply", "rule": "row 20",
                        "reason": "same"},
                       {"id": "H-002", "decision": "report", "rule": "PZ-14",
                        "reason": "cold file"})
        code, text = self.approve()
        self.assertEqual(code, 0, text)
        body = (self.hdir / "approvals.md").read_text(encoding="utf-8")
        self.assertIn("| H-001 | accepted | 1 | auto (profile): auto_apply.behavioural=true |",
                      body)
        found = self.findings()
        self.assertEqual(found["H-001"]["status"], "approved")
        self.assertEqual(found["H-002"]["status"], "reported")
        self.assertIn("PZ-24: row 20: fix", found["H-001"]["notes"])
        rep = vf.validate_document(self.read(".harden/findings.json"), repo=self.repo)
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])

    def test_approvals_narrows_when_switch_false(self) -> None:
        self.profile(behavioural=False, structural=True)
        self.decisions({"id": "H-001", "decision": "apply", "rule": "row 20", "reason": "x"},
                       {"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                       {"id": "H-002", "decision": "report", "rule": "r", "reason": "y"})
        self.assertEqual(self.approve()[0], 0)
        row = [r for r in self.rows() if r["category"] == "H-001"][0]
        self.assertEqual((row["decision"], row["quote"]),
                         ("report-only", "auto (profile): auto_apply.behavioural=false, "
                                         "not applied"))
        self.assertEqual(self.findings()["H-001"]["status"], "reported")

    def test_money_path_needs_money_paths_unless_ast_identical(self) -> None:
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            f["notes"] = f["notes"].replace("money-path: no", "money-path: yes (prices)")
        self.write(".harden/findings.json", doc)
        rest = [{"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                {"id": "H-002", "decision": "report", "rule": "r", "reason": "y"}]
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x"}, *rest)
        self.assertEqual(self.approve()[0], 0)
        row = [r for r in self.rows() if r["category"] == "H-001"][0]
        self.assertIn("auto_apply.money_paths=false, not applied", row["quote"])
        self.profile(behavioural=True, money_paths=True)
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x"}, *rest)
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            if f["id"] == "H-001":
                f["status"] = "verified"
        self.write(".harden/findings.json", doc)
        self.assertEqual(self.approve()[0], 0)
        row = [r for r in self.rows() if r["category"] == "H-001"][0]
        self.assertEqual(row["quote"], "auto (profile): auto_apply.behavioural=true, "
                                       "auto_apply.money_paths=true")
        self.profile(behavioural=True)
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            if f["id"] == "H-001":
                f["status"] = "verified"
        self.write(".harden/findings.json", doc)
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x",
                        "ast_identical": True}, *rest)
        self.assertEqual(self.approve()[0], 0)
        self.assertEqual(self.findings()["H-001"]["status"], "approved")

    def test_live_effect_and_missing_live_effect_line_refused(self) -> None:
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            if f["id"] == "H-001":
                f["notes"] = f["notes"].replace("live-effect: none", "live-effect: sign at "
                                                "src/a.py:2")
            if f["id"] == "H-002":
                f["notes"] = f["notes"].replace("live-effect: none", "")
        self.write(".harden/findings.json", doc)
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x"},
                       {"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                       {"id": "H-002", "decision": "apply", "rule": "r", "reason": "x"})
        (self.hdir / "approvals.md").write_text("# old\n", encoding="utf-8")
        before = ((self.hdir / "approvals.md").read_bytes(),
                  (self.hdir / "findings.json").read_bytes())
        code, text = self.approve()
        self.assertEqual(code, 1)
        self.assertIn("H-001: its notes record a live-effect path", text)
        self.assertIn("findings.py mark H-002 --note \"live-effect: none (<why>)\"", text)
        self.assertEqual(before, ((self.hdir / "approvals.md").read_bytes(),
                                  (self.hdir / "findings.json").read_bytes()))

    def test_t2_apply_needs_lane_review_and_switch(self) -> None:
        rest = [{"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                {"id": "H-002", "decision": "report", "rule": "r", "reason": "y"}]
        self.decisions({"id": "H-001", "decision": "apply", "rule": "row 21", "reason": "x",
                        "tier": "T2"}, *rest)
        code, text = self.approve()
        self.assertEqual(code, 1)
        self.assertIn("owner-judgement lane", text)
        lane = {"kinds": ["owner-judgement", "behavioural"], "option": "record-only",
                "alternatives": "keep the old behaviour"}
        self.decisions({"id": "H-001", "decision": "apply", "rule": "row 21", "reason": "x",
                        "tier": "T2", "review": lane}, *rest)
        self.assertEqual(self.approve()[0], 0)
        row = [r for r in self.rows() if r["category"] == "H-001"][0]
        self.assertEqual(row["quote"], "auto (profile): T2")
        self.assertEqual(self.findings()["H-001"]["status"], "reported")
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            if f["id"] == "H-001":
                f["status"] = "verified"
        self.write(".harden/findings.json", doc)
        self.profile(behavioural=True, owner_judgement=True)
        code, text = self.approve()
        self.assertEqual(code, 0, text)
        row = [r for r in self.rows() if r["category"] == "H-001"][0]
        self.assertEqual(row["quote"], "auto (profile): owner judgement, T2 by row 21, "
                                       "auto_apply.owner_judgement=true, "
                                       "auto_apply.behavioural=true")
        rep = vf.validate_document(self.read(".harden/findings.json"), repo=self.repo)
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])

    def test_every_verified_finding_needs_a_decision(self) -> None:
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x"})
        code, text = self.approve()
        self.assertEqual(code, 1)
        self.assertIn("verified or approved findings without a decision: H-001-se, H-002", text)

    def test_interactive_and_report_only_runs_refused(self) -> None:
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x"})
        for mode in ("interactive", "report-only"):
            self.write(".harden/active", {"base_sha": self.base, "mode": mode})
            self.assertEqual(self.approve()[0], 2)

    def test_rerender_keeps_times(self) -> None:
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x"},
                       {"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                       {"id": "H-002", "decision": "report", "rule": "r", "reason": "y"})
        self.assertEqual(self.approve()[0], 0)
        first = self.rows()
        saved = self.read(".harden/decisions.json")["decisions"]
        self.assertTrue(all(d["at"] for d in saved))
        with open(self.hdir / "approvals.md", "a", encoding="utf-8") as handle:
            handle.write("\nRP-20: 1 applied by the profile.\n")
        self.assertEqual(self.approve()[0], 0)
        self.assertEqual([r["time"] for r in self.rows()], [r["time"] for r in first])
        self.assertIn("RP-20: 1 applied by the profile.",
                      (self.hdir / "approvals.md").read_text(encoding="utf-8"))

    def test_approvals_rerun_is_idempotent(self) -> None:
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x"},
                       {"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                       {"id": "H-002", "decision": "report", "rule": "r", "reason": "y"})
        self.assertEqual(self.approve()[0], 0)
        first = (self.hdir / "approvals.md").read_bytes()
        notes = self.findings()["H-001"]["notes"]
        self.assertEqual(self.approve()[0], 0)
        self.assertEqual((self.hdir / "approvals.md").read_bytes(), first)
        self.assertEqual(self.findings()["H-001"]["notes"], notes)
        self.assertEqual(notes.count("PZ-24: r: x"), 1)

    def test_t2_report_reason_needs_lane_letter_when_lane_on(self) -> None:
        self.profile(behavioural=True, owner_judgement=True)
        rest = [{"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                {"id": "H-002", "decision": "report", "rule": "r", "reason": "y"}]
        self.decisions({"id": "H-001", "decision": "report", "rule": "row 21",
                        "reason": "owner call", "tier": "T2"}, *rest)
        code, text = self.approve()
        self.assertEqual(code, 1)
        self.assertIn("owner-judgement lane 1(<a-j>)", text)
        self.decisions({"id": "H-001", "decision": "report", "rule": "row 21",
                        "reason": "not applied: owner-judgement lane 1(h)", "tier": "T2"},
                       *rest)
        self.assertEqual(self.approve()[0], 0)
        row = [r for r in self.rows() if r["category"] == "H-001"][0]
        self.assertEqual(row["quote"], "auto (profile): T2 by row 21, not applied: "
                                       "owner-judgement lane 1(h)")

    def test_t0_stays_verified(self) -> None:
        self.decisions({"id": "H-001", "decision": "apply", "rule": "row 1", "reason": "x",
                        "tier": "T0", "class": "structural"},
                       {"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                       {"id": "H-002", "decision": "report", "rule": "r", "reason": "y"})
        self.assertEqual(self.approve()[0], 0)
        row = [r for r in self.rows() if r["category"] == "H-001"][0]
        self.assertEqual((row["decision"], row["quote"]), ("accepted", "auto (profile): T0"))
        f = self.findings()["H-001"]
        self.assertEqual((f["status"], f["tier"], f["class"]), ("verified", "T0", "structural"))
        self.decisions({"id": "H-001", "decision": "apply", "rule": "row 1", "reason": "x",
                        "tier": "T0", "class": "behavioural"})
        self.assertEqual(self.approve()[0], 1)


class MarkTests(FindingsTestCase):

    def setUp(self) -> None:
        super().setUp()
        self.verified_run(verdict("H-001"), verdict("H-002", evidence=[
            {"kind": "source", "ref": "src/b.py:1", "detail": "x"}], confidence="inference"))
        self.decisions({"id": "H-001", "decision": "apply", "rule": "r", "reason": "x"},
                       {"id": "H-001-se", "decision": "report", "rule": "r", "reason": "y"},
                       {"id": "H-002", "decision": "report", "rule": "r", "reason": "y"})
        self.assertEqual(self.run_cli("approvals")[0], 0)
        (self.repo / "src" / "a.py").write_text("x = 'fixed'\n" * 5, encoding="utf-8")
        _git(self.repo, "commit", "-qam", "fix(a): propagate the error (H-001)")
        self.fix = _git(self.repo, "rev-parse", "HEAD")

    def strip_test_evidence(self) -> None:
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            if f["id"] == "H-001":
                f["evidence"] = [e for e in f["evidence"] if e["kind"] != "test"]
                f["confidence"] = "tool_high_precision"
                f["evidence"].append({"kind": "tool", "ref": "ruff", "detail": "E1"})
        self.write(".harden/findings.json", doc)

    def test_mark_applied_behavioural_needs_test_and_live_effect(self) -> None:
        self.strip_test_evidence()
        code, text = self.run_cli("mark", "H-001", "--status", "applied", "--commit",
                                  self.fix[:7])
        self.assertEqual(code, 1)
        self.assertIn("--test", text)
        doc = self.read(".harden/findings.json")
        for f in doc["findings"]:
            if f["id"] == "H-001":
                f["notes"] = f["notes"].replace("live-effect: none", "")
        self.write(".harden/findings.json", doc)
        code, text = self.run_cli("mark", "H-001", "--status", "applied", "--commit",
                                  self.fix[:7], "--test", "tests/test_a.py::test_err",
                                  "--test-detail", "red at the parent, green at the fix")
        self.assertEqual(code, 1)
        self.assertIn("--note \"live-effect: none", text)
        code, text = self.run_cli("mark", "H-001", "--status", "applied", "--commit",
                                  self.fix[:7], "--test", "tests/test_a.py::test_err",
                                  "--test-detail", "red at the parent, green at the fix",
                                  "--note", "live-effect: none (a local error path)",
                                  "--review-kinds", "behavioural", "--review-option", "direct")
        self.assertEqual(code, 0, text)
        f = self.findings()["H-001"]
        self.assertEqual((f["status"], f["commit"]), ("applied", self.fix))

    def test_mark_repro_rerun_required_when_repro_evidence(self) -> None:
        args = ["mark", "H-001", "--status", "applied", "--commit", self.fix,
                "--evidence", "repro", "node repro.mjs", "prints NaN",
                "--review-kinds", "behavioural", "--review-option", "direct"]
        code, text = self.run_cli(*args)
        self.assertEqual(code, 1)
        self.assertIn("--repro-rerun", text)
        code, text = self.run_cli(*args, "--repro-rerun", "prints 42")
        self.assertEqual(code, 0, text)
        self.assertIn("Headline repro re-run at {}: prints 42".format(self.fix[:7]),
                      self.findings()["H-001"]["notes"])

    def test_mark_reverted_needs_note(self) -> None:
        code, text = self.run_cli("mark", "H-002", "--status", "blocked")
        self.assertEqual(code, 1)
        self.assertIn("--note", text)
        code, text = self.run_cli("mark", "H-002", "--status", "blocked", "--note",
                                  "blocked: the gate is red at base")
        self.assertEqual(code, 0, text)

    def test_mark_set_whitelist(self) -> None:
        self.assertEqual(self.run_cli("mark", "H-002", "--set", "severity=low")[0], 0)
        self.assertEqual(self.findings()["H-002"]["severity"], "low")
        code, text = self.run_cli("mark", "H-002", "--set", "tier=T0")
        self.assertEqual(code, 2)
        self.assertIn("approvals", text)

    def test_mark_note_only_annotates(self) -> None:
        before = self.findings()["H-002"]["status"]
        order = [f["id"] for f in self.read(".harden/findings.json")["findings"]]
        self.assertEqual(self.run_cli("mark", "H-002", "--note", "seen again")[0], 0)
        self.assertEqual(self.findings()["H-002"]["status"], before)
        self.assertEqual([f["id"] for f in self.read(".harden/findings.json")["findings"]],
                         order)

    def test_mark_confidence_raise_needs_saved_output(self) -> None:
        code, text = self.run_cli("mark", "H-002", "--evidence", "repro", "node r.mjs",
                                  "prints NaN", "--set", "confidence=reproduction")
        self.assertEqual(code, 1)
        self.assertIn("saved, non-empty output", text)
        (self.hdir / "tools" / "repro").mkdir(parents=True, exist_ok=True)
        (self.hdir / "tools" / "repro" / "H-002.txt").write_text("NaN\n", encoding="utf-8")
        code, text = self.run_cli("mark", "H-002", "--evidence", "repro",
                                  "node r.mjs > .harden/tools/repro/H-002.txt", "prints NaN",
                                  "--set", "confidence=reproduction")
        self.assertEqual(code, 0, text)
        self.assertEqual(self.findings()["H-002"]["confidence"], "reproduction")
        self.assertEqual(self.run_cli("mark", "H-002", "--set", "confidence=inference")[0], 0)


if __name__ == "__main__":
    unittest.main()
