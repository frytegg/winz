"""Tests for scripts/validate_findings.py (run: python -m unittest discover -s scripts/tests)."""
from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import validate_findings as vf  # noqa: E402

SCHEMA = SCRIPTS.parent / "assets" / "findings.schema.json"
BASE_SHA = "0123456789abcdef0123456789abcdef01234567"
HAS_GIT = shutil.which("git") is not None


def finding(**overrides: Any) -> Dict[str, Any]:
    """A minimal valid, verified finding; keyword arguments override or (value None) delete."""
    f: Dict[str, Any] = {
        "id": "H-001",
        "lens": "dead-code",
        "rule_ref": "DC-03",
        "title": "Unused private helper",
        "file": "src/a.py",
        "line": 2,
        "class": "structural",
        "tier": "T1",
        "severity": "low",
        "severity_criterion": "low = maintainability or evolvability cost only",
        "confidence": "tool_high_precision",
        "evidence": [{"kind": "tool", "ref": "vulture src --min-confidence 100",
                      "detail": "src/a.py:2: unused function 'helper' (100% confidence)"}],
        "verified": True,
        "verifier_note": "no references after text and reflection search",
        "status": "verified",
        "fix_risk": "low",
        "location_class": "cold",
    }
    for key, value in overrides.items():
        if value is None:
            f.pop(key, None)
        else:
            f[key] = value
    return f


def document(findings: List[Dict[str, Any]], **top: Any) -> Dict[str, Any]:
    doc: Dict[str, Any] = {
        "version": 1,
        "base_sha": BASE_SHA,
        "generated": "2026-09-23T14:30:00Z",
        "tool_versions": {"vulture": "2.14", "eslint": "9.12.0"},
        "findings": findings,
    }
    doc.update(top)
    return doc


REVIEW_BEHAVIOURAL: Dict[str, Any] = {"kinds": ["behavioural"], "option": "direct",
                                      "alternatives": None}
TEST_EVIDENCE: List[Dict[str, str]] = [
    {"kind": "tool", "ref": "vulture src --min-confidence 100",
     "detail": "src/a.py:2: unused function 'helper' (100% confidence)"},
    {"kind": "test", "ref": "tests/test_a.py::test_fallback_is_logged",
     "detail": "fails at the parent, passes at the fix"},
]
LANE_REVIEW: Dict[str, Any] = {
    "kinds": ["owner-judgement", "behavioural"], "option": "record-only",
    "alternatives": "fail closed with ConfigError in a release the owner announces"}


def lane_item(**overrides: Any) -> Dict[str, Any]:
    """A T2 finding the owner-judgement lane applied (user-policy-autonomy U01-F06)."""
    values: Dict[str, Any] = {"tier": "T2", "class": "behavioural", "status": "applied",
                              "commit": "abcdef1", "evidence": TEST_EVIDENCE,
                              "review": LANE_REVIEW}
    values.update(overrides)
    return finding(**values)


def issues(rep: vf.ValidationReport, level: str = "error") -> List[vf.Issue]:
    return rep.errors if level == "error" else rep.warnings


def has(rep: vf.ValidationReport, field: str, level: str = "error",
        finding_id: Optional[str] = None, contains: Optional[str] = None) -> bool:
    for issue in issues(rep, level):
        if issue.field != field:
            continue
        if finding_id is not None and issue.finding != finding_id:
            continue
        if contains is not None and contains not in issue.message:
            continue
        return True
    return False


class SchemaParityTest(unittest.TestCase):
    """The hand-written checks must use the same enums as assets/findings.schema.json."""

    def test_schema_is_valid_json_and_enums_match(self) -> None:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        props = schema["$defs"]["finding"]["properties"]
        pairs = {
            "lens": vf.LENSES, "class": vf.CLASSES, "tier": vf.TIERS, "severity": vf.SEVERITIES,
            "confidence": vf.CONFIDENCES, "status": vf.STATUSES, "fix_risk": vf.FIX_RISKS,
            "location_class": vf.LOCATION_CLASSES,
        }
        for key, values in pairs.items():
            self.assertEqual(list(props[key]["enum"]), list(values), key)
        self.assertEqual([v for v in props["conditions"]["enum"] if v is not None],
                         list(vf.CONDITIONS))
        self.assertEqual([v for v in props["quality_characteristic"]["enum"] if v is not None],
                         list(vf.QUALITY_CHARACTERISTICS))
        kinds = schema["$defs"]["evidence"]["properties"]["kind"]["enum"]
        self.assertEqual(list(kinds), list(vf.EVIDENCE_KINDS))
        self.assertEqual([v for v in props["baseline_state"]["enum"] if v is not None],
                         list(vf.BASELINE_STATES))
        threshold = schema["$defs"]["threshold_source"]
        self.assertEqual(list(threshold["properties"]["kind"]["enum"]),
                         list(vf.THRESHOLD_SOURCE_KINDS))
        self.assertEqual(sorted(threshold["required"]), sorted(vf.THRESHOLD_SOURCE_FIELDS))
        self.assertEqual(sorted(threshold["properties"]), sorted(vf.THRESHOLD_SOURCE_FIELDS))
        self.assertEqual(props["seen_in_passes"]["minimum"], 1)
        self.assertEqual(sorted(schema["$defs"]["finding"]["required"]), sorted(vf.REQUIRED_FIELDS))
        self.assertEqual(sorted(schema["required"]), sorted(vf.TOP_REQUIRED))
        declared = set(props)
        self.assertEqual(declared, set(vf.REQUIRED_FIELDS) | set(vf.OPTIONAL_FIELDS))

    def test_review_enums_match_schema(self) -> None:
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        review = schema["$defs"]["finding"]["properties"]["review"]
        self.assertEqual(list(review["properties"]["kinds"]["items"]["enum"]),
                         list(vf.REVIEW_KINDS))
        self.assertEqual(list(review["properties"]["option"]["enum"]), list(vf.REVIEW_OPTIONS))
        self.assertEqual(sorted(review["properties"]), sorted(vf.REVIEW_FIELDS))
        self.assertEqual(sorted(review["required"]), ["kinds", "option"])


class StructureTest(unittest.TestCase):
    def test_minimal_valid_document(self) -> None:
        rep = vf.validate_document(document([finding()]))
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertEqual(rep.warnings, [])
        self.assertEqual(rep.counts["by_decision_group"], {"awaiting-approval": 1})

    def test_missing_top_level_fields(self) -> None:
        rep = vf.validate_document({"findings": []})
        for key in ("version", "base_sha", "generated", "tool_versions"):
            self.assertTrue(has(rep, key, finding_id="<document>"), key)

    def test_bad_top_level_values(self) -> None:
        rep = vf.validate_document(document([], version=2, base_sha="XYZ", generated="yesterday"))
        self.assertTrue(has(rep, "version"))
        self.assertTrue(has(rep, "base_sha"))
        self.assertTrue(has(rep, "generated"))

    def test_missing_required_field_names_the_finding(self) -> None:
        rep = vf.validate_document(document([finding(severity_criterion=None)]))
        self.assertTrue(has(rep, "severity_criterion", finding_id="H-001",
                            contains="required field is missing"))

    def test_enum_error_is_specific(self) -> None:
        rep = vf.validate_document(document([finding(lens="style")]))
        self.assertFalse(rep.valid)
        issue = rep.errors[0]
        self.assertEqual((issue.finding, issue.field), ("H-001", "lens"))
        self.assertIn("'style' is not one of", issue.message)

    def test_rule_ref_formats(self) -> None:
        self.assertTrue(vf.validate_document(document([finding(rule_ref="DC-3x")])).errors)
        ok = vf.validate_document(document([finding(rule_ref="project:eslint/no-unused-vars",
                                                     lens="project-tool")]))
        self.assertTrue(ok.valid)
        self.assertFalse(has(ok, "rule_ref", level="warning"))
        unpinned = vf.validate_document(document([finding(rule_ref="project:ruff/F401",
                                                          lens="project-tool")]))
        self.assertTrue(unpinned.valid)
        self.assertTrue(has(unpinned, "rule_ref", level="warning", contains="no pinned version"))

    def test_path_must_be_repo_relative_forward_slash(self) -> None:
        for bad in ("src\\a.py", "/abs/a.py", "C:/x/a.py", "./src/a.py", "src/../a.py", "src//a.py"):
            rep = vf.validate_document(document([finding(file=bad)]))
            self.assertTrue(has(rep, "file", finding_id="H-001"), bad)

    def test_line_and_end_line(self) -> None:
        self.assertTrue(has(vf.validate_document(document([finding(line=0)])), "line"))
        self.assertTrue(has(vf.validate_document(document([finding(line=True)])), "line"))
        rep = vf.validate_document(document([finding(line=5, end_line=3)]))
        self.assertTrue(has(rep, "end_line", contains="before line 5"))

    def test_evidence_item_shape(self) -> None:
        rep = vf.validate_document(document([finding(evidence=[{"kind": "vibes", "ref": "x",
                                                                 "detail": "y"}])]))
        self.assertTrue(has(rep, "evidence[0].kind"))
        rep = vf.validate_document(document([finding(evidence=[{"kind": "tool", "ref": "x"}])]))
        self.assertTrue(has(rep, "evidence[0].detail"))

    def test_cwe_and_quality_characteristic(self) -> None:
        good = vf.validate_document(document([finding(cwe="CWE-561",
                                                      quality_characteristic="maintainability")]))
        self.assertTrue(good.valid)
        bad = vf.validate_document(document([finding(cwe="561", quality_characteristic="speed")]))
        self.assertTrue(has(bad, "cwe"))
        self.assertTrue(has(bad, "quality_characteristic"))

    def test_duplicate_ids(self) -> None:
        rep = vf.validate_document(document([finding(), finding(line=3)]))
        self.assertTrue(has(rep, "id", finding_id="H-001", contains="duplicate id"))

    def test_unknown_field_is_a_warning(self) -> None:
        rep = vf.validate_document(document([finding(severty="low")]))
        self.assertTrue(rep.valid)
        self.assertTrue(has(rep, "severty", level="warning"))


class SemanticRulesTest(unittest.TestCase):
    def test_established_status_requires_verified_true(self) -> None:
        for status in ("verified", "approved", "applied", "reported"):
            extra = {"commit": "abcdef1"} if status == "applied" else {}
            rep = vf.validate_document(document([finding(status=status, verified=False, **extra)]))
            self.assertTrue(has(rep, "verified", finding_id="H-001"), status)
        cand = vf.validate_document(document([finding(status="candidate", verified=False)]))
        self.assertTrue(cand.valid)

    def test_established_status_requires_evidence_ref(self) -> None:
        blank = [{"kind": "source", "ref": "   ", "detail": "trace"}]
        rep = vf.validate_document(document([finding(status="reported", evidence=blank,
                                                      confidence="inference")]))
        self.assertTrue(has(rep, "evidence", contains="non-empty ref"))
        rep = vf.validate_document(document([finding(status="reported", evidence=[],
                                                      confidence="inference")]))
        self.assertTrue(has(rep, "evidence", contains="non-empty ref"))

    def test_applied_requires_commit(self) -> None:
        rep = vf.validate_document(document([finding(status="applied")]))
        self.assertTrue(has(rep, "commit", contains="requires the commit"))
        ok = vf.validate_document(document([finding(status="applied", commit="abcdef1")]))
        self.assertTrue(ok.valid, [i.render() for i in ok.errors])

    def test_t0_requires_structural(self) -> None:
        test_ev = [{"kind": "test", "ref": "tests/test_a.py::test_x", "detail": "fails then passes"}]
        rep = vf.validate_document(document([finding(tier="T0", **{"class": "behavioural"},
                                                     evidence=test_ev, confidence="failing_test")]))
        self.assertTrue(has(rep, "class", contains="tier T0 requires class 'structural'"))
        ok = vf.validate_document(document([finding(tier="T0")]))
        self.assertTrue(ok.valid)

    def test_t2_cannot_be_applied(self) -> None:
        rep = vf.validate_document(document([finding(tier="T2", **{"class": "report-only"},
                                                     status="applied", commit="abcdef1")]))
        self.assertTrue(has(rep, "status", contains="tier T2"))
        ok = vf.validate_document(document([finding(tier="T2", **{"class": "report-only"},
                                                    status="reported")]))
        self.assertTrue(ok.valid)
        self.assertEqual(ok.counts["by_decision_group"], {"report-only": 1})

    def test_report_only_class_cannot_be_applied(self) -> None:
        rep = vf.validate_document(document([finding(**{"class": "report-only"},
                                                     status="applied", commit="abcdef1")]))
        self.assertTrue(has(rep, "status", contains="class 'report-only'"))

    def test_behavioural_applied_needs_test_evidence(self) -> None:
        rep = vf.validate_document(document([finding(**{"class": "behavioural"}, status="applied",
                                                     commit="abcdef1")]))
        self.assertTrue(has(rep, "evidence", contains="kind 'test'"))
        evidence = finding()["evidence"] + [{"kind": "test", "ref": "tests/test_a.py::test_timeout",
                                             "detail": "fails at base, passes at head"}]
        ok = vf.validate_document(document([finding(**{"class": "behavioural"}, status="applied",
                                                    commit="abcdef1", evidence=evidence,
                                                    review=REVIEW_BEHAVIOURAL)]))
        self.assertTrue(ok.valid, [i.render() for i in ok.errors])

    def test_partial_status(self) -> None:
        """partial: some lines applied, the headline reproduction still reproduces (reporting
        RP-16/RP-17, protocol-change PC-14; eval-v2-calibration E02-F02)."""
        why = "headline repro `value --config nope.json` still exits 0 at HEAD"
        rep = vf.validate_document(document([finding(status="partial", notes=why)]))
        self.assertTrue(has(rep, "commit", contains="status 'partial' requires the commit"))
        ok = vf.validate_document(document([finding(status="partial", commit="abcdef1",
                                                    notes=why)]))
        self.assertTrue(ok.valid, [i.render() for i in ok.errors])
        self.assertEqual(ok.warnings, [])
        self.assertEqual(ok.counts["by_decision_group"], {"partial": 1})
        silent = vf.validate_document(document([finding(status="partial", commit="abcdef1",
                                                        verifier_note=" ")]))
        self.assertTrue(silent.valid)
        self.assertTrue(has(silent, "notes", level="warning", contains="'partial'"))
        unverified = vf.validate_document(document([finding(status="partial", commit="abcdef1",
                                                            verified=False, notes=why)]))
        self.assertTrue(has(unverified, "verified"))
        t2 = vf.validate_document(document([finding(tier="T2", **{"class": "report-only"},
                                                    status="partial", commit="abcdef1",
                                                    notes=why)]))
        self.assertTrue(has(t2, "status", contains="tier T2"))
        beh = vf.validate_document(document([finding(**{"class": "behavioural"}, status="partial",
                                                     commit="abcdef1", notes=why)]))
        self.assertTrue(has(beh, "evidence", contains="kind 'test'"))

    def test_high_severity_needs_proof(self) -> None:
        src = [{"kind": "source", "ref": "src/a.py:2", "detail": "path trace"}]
        rep = vf.validate_document(document([finding(severity="high", confidence="needs_review",
                                                     evidence=src)]))
        self.assertTrue(has(rep, "confidence", contains="severity 'high' needs confidence"))
        crit = vf.validate_document(document([finding(severity="critical", confidence="inference",
                                                      evidence=src, status="reported")]))
        self.assertFalse(crit.valid)
        deferred = vf.validate_document(document([finding(severity="high", confidence="needs_review",
                                                          evidence=src, status="deferred",
                                                          notes="unproven race")]))
        self.assertTrue(deferred.valid)
        self.assertTrue(has(deferred, "confidence", level="warning", contains="unproven"))
        proven = vf.validate_document(document([finding(severity="high")]))
        self.assertTrue(proven.valid)

    def test_confidence_rung_needs_matching_evidence(self) -> None:
        rep = vf.validate_document(document([finding(confidence="failing_test")]))
        self.assertTrue(has(rep, "confidence", contains="kind 'test'"))
        rep = vf.validate_document(document([finding(confidence="reproduction")]))
        self.assertTrue(has(rep, "confidence", contains="kind 'repro'"))

    def test_weak_confidence_cannot_carry_t0_or_t1(self) -> None:
        """A needs_review or inference finding is T2 whatever its row (prioritization PZ-24
        step 2, detection DT-27; pilot-auto-calibration A01-F11)."""
        src = [{"kind": "source", "ref": "src/http/client.ts:36", "detail": "fetch without signal"}]
        for confidence in ("needs_review", "inference"):
            for status in ("verified", "approved", "reported", "reverted"):
                rep = vf.validate_document(document([finding(confidence=confidence, evidence=src,
                                                             status=status, notes="reason")]))
                self.assertFalse(rep.valid, (confidence, status))
                self.assertTrue(has(rep, "tier", contains="PZ-24 step 2"), (confidence, status))
            t0 = vf.validate_document(document([finding(tier="T0", confidence=confidence,
                                                        evidence=src)]))
            self.assertTrue(has(t0, "tier", contains="tier T0"))
        test_ev = src + [{"kind": "test", "ref": "tests/http-timeout.test.ts",
                          "detail": "fails at base, passes at head"}]
        applied = vf.validate_document(document([finding(**{"class": "behavioural"},
                                                         status="applied", commit="abcdef1",
                                                         confidence="inference",
                                                         evidence=test_ev)]))
        self.assertTrue(has(applied, "tier", contains="raise the evidence"))

    def test_weak_confidence_is_valid_on_t2(self) -> None:
        src = [{"kind": "source", "ref": "src/a.py:2", "detail": "hand trace"}]
        rep = vf.validate_document(document([finding(tier="T2", **{"class": "report-only"},
                                                     confidence="inference", evidence=src,
                                                     status="reported")]))
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertFalse(has(rep, "tier", level="warning"))

    def test_weak_confidence_is_not_checked_before_verification(self) -> None:
        src = [{"kind": "source", "ref": "src/a.py:2", "detail": "hand trace"}]
        cand = vf.validate_document(document([finding(status="candidate", verified=False,
                                                      confidence="inference", evidence=src)]))
        self.assertFalse(has(cand, "tier"))
        self.assertFalse(has(cand, "tier", level="warning"))
        rejected = vf.validate_document(document([finding(status="rejected",
                                                          confidence="needs_review",
                                                          evidence=src, notes="not reachable")]))
        self.assertFalse(has(rejected, "tier"))
        self.assertFalse(has(rejected, "tier", level="warning"))

    def test_weak_confidence_on_deferred_or_blocked_warns(self) -> None:
        src = [{"kind": "source", "ref": "src/a.py:2", "detail": "hand trace"}]
        for status in ("deferred", "blocked"):
            rep = vf.validate_document(document([finding(status=status, confidence="needs_review",
                                                         evidence=src, notes="unproven")]))
            self.assertTrue(rep.valid, status)
            self.assertTrue(has(rep, "tier", level="warning", contains="PZ-24 step 2"), status)

    def test_raised_evidence_clears_the_weak_confidence_error(self) -> None:
        repro = [{"kind": "repro", "ref": ".harden/tools/repro/fetch-hang.txt",
                  "detail": "request still pending after 3 s against a stub that never answers"}]
        rep = vf.validate_document(document([finding(confidence="reproduction", evidence=repro)]))
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertFalse(has(rep, "tier"))

    def test_severity_criterion_required_except_nit(self) -> None:
        rep = vf.validate_document(document([finding(severity_criterion="")]))
        self.assertTrue(has(rep, "severity_criterion", contains="rubric criterion"))
        nit = vf.validate_document(document([finding(severity="nit", severity_criterion="")]))
        self.assertTrue(nit.valid)

    def test_blocking_rules(self) -> None:
        rep = vf.validate_document(document([finding(blocking=True, severity="high")]))
        self.assertTrue(has(rep, "unblock_condition"))
        rep = vf.validate_document(document([finding(blocking=True, severity="nit",
                                                     unblock_condition="x")]))
        self.assertTrue(has(rep, "blocking", contains="nit"))
        ok = vf.validate_document(document([finding(blocking=True, severity="high",
                                                    unblock_condition="test T passes")]))
        self.assertTrue(ok.valid)
        self.assertEqual(ok.counts["blocking"], 1)

    def test_nit_cap_is_a_warning(self) -> None:
        nits = [finding(id=f"N-{i:03d}", severity="nit", severity_criterion="") for i in range(11)]
        rep = vf.validate_document(document(nits))
        self.assertTrue(rep.valid)
        self.assertTrue(has(rep, "severity", level="warning", contains="exceed the cap of 10"))
        under = vf.validate_document(document(nits[:10]))
        self.assertFalse(has(under, "severity", level="warning"))
        rejected = copy.deepcopy(nits)
        rejected[0]["status"] = "rejected"
        rejected[0]["verified"] = False
        self.assertFalse(has(vf.validate_document(document(rejected)), "severity", level="warning"))

    def test_reason_required_for_deferred(self) -> None:
        rep = vf.validate_document(document([finding(status="deferred", verifier_note="")]))
        self.assertTrue(has(rep, "notes", level="warning"))

    def test_doc_only_evidence_warns(self) -> None:
        doc_ev = [{"kind": "doc", "ref": "README.md:10", "detail": "says unused"}]
        rep = vf.validate_document(document([finding(evidence=doc_ev, confidence="inference",
                                                     tier="T2", **{"class": "report-only"})]))
        self.assertTrue(rep.valid)
        self.assertTrue(has(rep, "evidence", level="warning", contains="G201-F05"))


class ProvenanceFieldsTest(unittest.TestCase):
    """Optional fields: seen_in_passes, pass_ids, exclusion_class, threshold_source,
    verifier_id, baseline_state (detection DT-23/DT-27/DT-33, prioritization PZ-16,
    reporting RP-19)."""

    FULL: Dict[str, Any] = {
        "seen_in_passes": 2,
        "pass_ids": ["pass-security-1", "pass-security-2"],
        "threshold_source": {"kind": "project-config", "ref": "eslint.config.js complexity"},
        "verifier_id": "verifier-7",
        "baseline_state": "unchanged",
    }

    def test_all_fields_valid_without_warnings(self) -> None:
        rep = vf.validate_document(document([finding(**copy.deepcopy(self.FULL))]))
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertEqual(rep.warnings, [], [i.render() for i in rep.warnings])
        for kind in vf.THRESHOLD_SOURCE_KINDS:
            ok = vf.validate_document(document([finding(threshold_source={"kind": kind,
                                                                          "ref": "CX-04"})]))
            self.assertTrue(ok.valid, kind)
        for state in vf.BASELINE_STATES:
            self.assertTrue(vf.validate_document(document([finding(baseline_state=state)])).valid)

    def test_null_means_absent(self) -> None:
        doc = document([finding()])
        for key in self.FULL:
            doc["findings"][0][key] = None
        doc["findings"][0]["exclusion_class"] = None
        rep = vf.validate_document(doc)
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertEqual(rep.warnings, [])

    def test_seen_in_passes_type(self) -> None:
        for bad in (0, -1, 1.5, True, "2"):
            rep = vf.validate_document(document([finding(seen_in_passes=bad)]))
            self.assertTrue(has(rep, "seen_in_passes", contains="integer >= 1"), repr(bad))

    def test_pass_ids_type(self) -> None:
        rep = vf.validate_document(document([finding(pass_ids="pass-1")]))
        self.assertTrue(has(rep, "pass_ids", contains="array of pass id strings"))
        rep = vf.validate_document(document([finding(pass_ids=["pass-1", "", 3])]))
        self.assertTrue(has(rep, "pass_ids[1]", contains="non-empty string"))
        self.assertTrue(has(rep, "pass_ids[2]", contains="non-empty string"))
        self.assertFalse(has(rep, "pass_ids[0]"))

    def test_string_fields_type(self) -> None:
        for key in ("exclusion_class", "verifier_id"):
            for bad in ("", "   ", 7, ["x"]):
                extra = {"status": "rejected", "verified": False} if key == "exclusion_class" else {}
                rep = vf.validate_document(document([finding(**{key: bad}, **extra)]))
                self.assertTrue(has(rep, key, contains="non-empty string"), f"{key}={bad!r}")

    def test_threshold_source_type(self) -> None:
        rep = vf.validate_document(document([finding(threshold_source="eslint config")]))
        self.assertTrue(has(rep, "threshold_source", contains="must be an object"))
        rep = vf.validate_document(document([finding(threshold_source={"kind": "guess",
                                                                       "ref": "x"})]))
        self.assertTrue(has(rep, "threshold_source.kind", contains="'guess' is not one of"))
        rep = vf.validate_document(document([finding(threshold_source={"kind": "vendor-default"})]))
        self.assertTrue(has(rep, "threshold_source.ref", contains="required field is missing"))
        rep = vf.validate_document(document([finding(threshold_source={"kind": "skill-default",
                                                                       "ref": " "})]))
        self.assertTrue(has(rep, "threshold_source.ref", contains="non-empty string"))
        rep = vf.validate_document(document([finding(threshold_source={
            "kind": "skill-default", "ref": "CX-04", "value": 10})]))
        self.assertTrue(rep.valid)
        self.assertTrue(has(rep, "threshold_source.value", level="warning", contains="unknown"))

    def test_baseline_state_enum(self) -> None:
        rep = vf.validate_document(document([finding(baseline_state="fixed")]))
        self.assertTrue(has(rep, "baseline_state", contains="'fixed' is not one of"))

    def test_seen_in_passes_disagreeing_with_pass_ids_warns(self) -> None:
        rep = vf.validate_document(document([finding(seen_in_passes=3, pass_ids=["a", "b"])]))
        self.assertTrue(rep.valid)
        self.assertTrue(has(rep, "seen_in_passes", level="warning", contains="DT-23"))
        dup = vf.validate_document(document([finding(seen_in_passes=2, pass_ids=["a", "b", "a"])]))
        self.assertTrue(dup.valid)
        self.assertTrue(has(dup, "pass_ids", level="warning", contains="repeated pass id(s) a"))
        self.assertFalse(has(dup, "seen_in_passes", level="warning"))

    def test_verifier_must_not_be_a_detection_pass(self) -> None:
        rep = vf.validate_document(document([finding(pass_ids=["p1", "p2"], verifier_id="p2")]))
        self.assertTrue(has(rep, "verifier_id", finding_id="H-001", contains="DT-27"))
        cand = vf.validate_document(document([finding(status="candidate", verified=False,
                                                      pass_ids=["p1"], verifier_id="p1")]))
        self.assertTrue(cand.valid)
        self.assertTrue(has(cand, "verifier_id", level="warning", contains="DT-27"))
        ok = vf.validate_document(document([finding(pass_ids=["p1"], verifier_id="v1")]))
        self.assertTrue(ok.valid)
        self.assertFalse(has(ok, "verifier_id", level="warning"))

    def test_exclusion_class_only_on_rejected(self) -> None:
        rejected = vf.validate_document(document([finding(
            status="rejected", verified=False, verifier_note="DT-33(2): vendored",
            exclusion_class="DT-33(2) generated or vendored")]))
        self.assertTrue(rejected.valid)
        self.assertFalse(has(rejected, "exclusion_class", level="warning"))
        verified = vf.validate_document(document([finding(exclusion_class="DT-33(1)")]))
        self.assertTrue(verified.valid)
        self.assertTrue(has(verified, "exclusion_class", level="warning", contains="rejected"))

    def test_existing_messages_unchanged_with_new_fields(self) -> None:
        rep = vf.validate_document(document([finding(lens="style", **copy.deepcopy(self.FULL))]))
        issue = rep.errors[0]
        self.assertEqual((issue.finding, issue.field), ("H-001", "lens"))
        self.assertIn("'style' is not one of", issue.message)
        self.assertEqual(len(rep.errors), 1)


@unittest.skipUnless(HAS_GIT, "git is not installed")
class OwnerJudgementLaneTest(unittest.TestCase):
    """T2 items the owner-judgement lane applies (prioritization Autonomous mode;
    user-policy-autonomy U01-F06, U01-F11 to U01-F13)."""

    def test_parse_commit_message_normalises_crlf(self) -> None:
        self.assertEqual(vf.parse_commit_message("fix(x)!: y\r\n\r\nBREAKING CHANGE: z\r\n"),
                         ("fix(x)!: y", True, True))
        self.assertEqual(vf.parse_commit_message("fix(x): y\r\n"), ("fix(x): y", False, False))

    def test_a_lane_item_is_valid_and_listed_for_review(self) -> None:
        rep = vf.validate_document(document([lane_item()]))
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertEqual(rep.counts["by_decision_group"], {"review-before-merge": 1})

    def test_t2_without_the_lane_kind_is_refused(self) -> None:
        review = {"kinds": ["behavioural"], "option": "direct", "alternatives": None}
        for status in ("approved", "applied", "partial", "reverted"):
            with self.subTest(status=status):
                rep = vf.validate_document(document([lane_item(status=status, review=review,
                                                               notes="reason")]))
                self.assertTrue(has(rep, "status", contains="tier T2"))
                self.assertTrue(has(rep, "status", contains="owner-judgement lane"))
        rep = vf.validate_document(document([lane_item(review=None)]))
        self.assertTrue(has(rep, "status", contains="tier T2"))
        self.assertTrue(has(rep, "review", contains="Applied, review before merge"))

    def test_behavioural_commits_need_a_review_object(self) -> None:
        rep = vf.validate_document(document([finding(**{"class": "behavioural"},
                                                     status="applied", commit="abcdef1",
                                                     evidence=TEST_EVIDENCE)]))
        self.assertTrue(has(rep, "review", contains="needs a review object"))
        wrong = vf.validate_document(document([finding(
            **{"class": "behavioural"}, status="applied", commit="abcdef1",
            evidence=TEST_EVIDENCE, review={"kinds": ["money-path"], "option": "direct"})]))
        self.assertTrue(has(wrong, "review.kinds", contains="'behavioural'"))
        structural = vf.validate_document(document([finding(status="applied",
                                                            commit="abcdef1")]))
        self.assertFalse(has(structural, "review"))

    def test_review_object_shape(self) -> None:
        cases = [
            ({"kinds": [], "option": "direct"}, "review.kinds", "non-empty array"),
            ({"kinds": ["urgent"], "option": "direct"}, "review.kinds", "urgent"),
            ({"kinds": ["behavioural"], "option": "maybe"}, "review.option", "maybe"),
            ({"kinds": ["behavioural"], "option": "record-only"}, "review.alternatives",
             "U01-F11"),
            ({"kinds": ["behavioural"], "option": "lossless-variant", "alternatives": " "},
             "review.alternatives", "U01-F11"),
            ("record-only", "review", "must be an object"),
        ]
        for review, field, needle in cases:
            with self.subTest(review=review):
                rep = vf.validate_document(document([finding(**{"class": "behavioural"},
                                                             review=review)]))
                self.assertTrue(has(rep, field, contains=needle),
                                [i.render() for i in rep.errors])
        extra = vf.validate_document(document([finding(
            review={"kinds": ["behavioural"], "option": "direct", "why": "x"})]))
        self.assertTrue(extra.valid, [i.render() for i in extra.errors])
        self.assertTrue(has(extra, "review.why", level="warning"))

    def test_lane_items_need_proof_confidence(self) -> None:
        src = [{"kind": "source", "ref": "src/a.py:2", "detail": "hand trace"}] + TEST_EVIDENCE[1:]
        rep = vf.validate_document(document([lane_item(confidence="inference", evidence=src)]))
        self.assertTrue(has(rep, "confidence", contains="1(h)"))

    def test_report_only_t2_needs_no_review(self) -> None:
        rep = vf.validate_document(document([finding(tier="T2", **{"class": "report-only"},
                                                     status="reported")]))
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertFalse(has(rep, "review"))


class RepoChecksTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name) / "repo"
        (self.repo / "src").mkdir(parents=True)
        (self.repo / "src" / "a.py").write_text("def a():\n    return 1\n\n\ndef b():\n    pass\n",
                                                encoding="utf-8")
        hooks = Path(self.tmp.name) / "nohooks"
        hooks.mkdir()
        self._git("init", "-q")
        self._git("add", "-A")
        self._git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c",
                  "commit.gpgsign=false", "-c", f"core.hooksPath={hooks.as_posix()}",
                  "commit", "-q", "-m", "init")
        self.sha = self._git("rev-parse", "HEAD").strip()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _git(self, *args: str) -> str:
        proc = subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True,
                              check=True)
        return proc.stdout.decode("utf-8", errors="replace")

    def doc(self, *findings: Dict[str, Any]) -> Dict[str, Any]:
        return document(list(findings), base_sha=self.sha)

    def test_existing_file_and_line(self) -> None:
        rep = vf.validate_document(self.doc(finding(line=6)), repo=self.repo)
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertEqual(rep.repo_checked, self.repo.as_posix())

    def test_line_outside_file(self) -> None:
        rep = vf.validate_document(self.doc(finding(line=40)), repo=self.repo)
        self.assertTrue(has(rep, "line", finding_id="H-001", contains="outside 'src/a.py'"))

    def test_end_line_outside_file(self) -> None:
        rep = vf.validate_document(self.doc(finding(line=5, end_line=9)), repo=self.repo)
        self.assertTrue(has(rep, "end_line", finding_id="H-001"))

    def test_missing_file(self) -> None:
        rep = vf.validate_document(self.doc(finding(file="src/missing.py")), repo=self.repo)
        self.assertTrue(has(rep, "file", contains="does not exist"))

    def test_wrong_letter_case(self) -> None:
        rep = vf.validate_document(self.doc(finding(file="SRC/a.py")), repo=self.repo)
        self.assertTrue(has(rep, "file"))

    def test_unknown_base_sha(self) -> None:
        rep = vf.validate_document(document([finding()], base_sha="deadbeef" * 5), repo=self.repo)
        self.assertTrue(has(rep, "base_sha", finding_id="<document>", contains="does not exist"))

    def test_applied_commit_must_exist(self) -> None:
        rep = vf.validate_document(self.doc(finding(status="applied", commit="abcdef1234567")),
                                   repo=self.repo)
        self.assertTrue(has(rep, "commit", contains="does not exist"))
        ok = vf.validate_document(self.doc(finding(status="applied", commit=self.sha)),
                                  repo=self.repo)
        self.assertFalse(has(ok, "commit"))

    def test_auto_falls_back_to_base_when_lines_moved(self) -> None:
        (self.repo / "src" / "a.py").write_text("def b():\n    pass\n", encoding="utf-8")
        auto = vf.validate_document(self.doc(finding(line=6)), repo=self.repo, at="auto")
        self.assertTrue(auto.valid, [i.render() for i in auto.errors])
        worktree = vf.validate_document(self.doc(finding(line=6)), repo=self.repo, at="worktree")
        self.assertTrue(has(worktree, "line"))

    def test_t1_applied_without_approvals_fails(self) -> None:
        rep = vf.validate_document(self.doc(finding(status="applied", commit=self.sha)),
                                   repo=self.repo)
        self.assertTrue(has(rep, "status", contains="approvals.md does not exist"))

    def write_approvals(self, *rows: str) -> None:
        hdir = self.repo / ".harden"
        hdir.mkdir(exist_ok=True)
        table = ["# Approvals", "",
                 "| Category | Decision | Count | User's exact words | UTC time |",
                 "|---|---|---|---|---|"] + list(rows)
        (hdir / "approvals.md").write_text("\n".join(table) + "\n", encoding="utf-8")

    def test_approvals_table_accepts_the_category_with_a_quote(self) -> None:
        applied = finding(status="applied", commit=self.sha)
        for category in ("dead-code", "Dead code", "`lens-dead-code.md`", "DC", "DC-03"):
            with self.subTest(category=category):
                self.write_approvals(f"| {category} | accepted | 3 | \"yes, remove the dead "
                                     f"helpers\" | 2026-09-24T10:00:00Z |")
                rep = vf.validate_document(self.doc(applied), repo=self.repo)
                self.assertFalse(has(rep, "status"), [i.render() for i in rep.errors])

    def test_approvals_table_refuses_missing_or_unquoted_acceptance(self) -> None:
        approved = finding(status="approved")
        self.write_approvals("| duplication | accepted | 2 | \"ok\" | 2026-09-24T10:00:00Z |",
                             "| dead-code | rejected | 3 | \"no\" | 2026-09-24T10:01:00Z |")
        rep = vf.validate_document(self.doc(approved), repo=self.repo)
        self.assertTrue(has(rep, "status", finding_id="H-001", contains="no 'accepted' row"))
        self.write_approvals("| dead-code | accepted | 3 |  | 2026-09-24T10:00:00Z |")
        rep = vf.validate_document(self.doc(approved), repo=self.repo)
        self.assertTrue(has(rep, "status", finding_id="H-001", contains="exact words"))
        # T0 and T2 findings, and T1 findings not yet approved, need no approvals row.
        rep = vf.validate_document(self.doc(finding(status="verified")), repo=self.repo)
        self.assertFalse(has(rep, "status"))

    def write_profile(self, **switches: bool) -> None:
        hdir = self.repo / ".harden"
        hdir.mkdir(exist_ok=True)
        (hdir / "profile.json").write_text(json.dumps({"version": 1, "auto_apply": switches}),
                                           encoding="utf-8")

    def write_marker(self, **fields: str) -> None:
        (self.repo / ".harden" / "active").write_text(json.dumps(fields), encoding="utf-8")

    def test_auto_profile_rows_approve_t1_findings_in_autonomous_mode(self) -> None:
        # protocol-change step 3: the profile's switch stands in the user's words cell.
        applied = finding(status="applied", commit=self.sha, notes="live-effect: none")
        self.write_profile(structural=True, behavioural=False)
        self.write_marker(mode="auto")
        for words in ("auto (profile): auto_apply.structural=true",
                      "`auto (profile): auto_apply.structural=true`",
                      "auto (profile): re-tiered to T1 structural by PZ-14, "
                      "auto_apply.structural=true"):
            with self.subTest(words=words):
                self.write_approvals(f"| dead-code | accepted | 3 | {words} | "
                                     "2026-09-25T01:00:00Z |")
                rep = vf.validate_document(self.doc(applied), repo=self.repo)
                self.assertFalse(has(rep, "status"), [i.render() for i in rep.errors])
                self.assertEqual(rep.counts["t1_approved_by"], {"profile": 1, "user": 0})
        # The text output says which route approved them.
        (self.repo / ".harden" / "findings.json").write_text(
            json.dumps(self.doc(applied)), encoding="utf-8")
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        proc = subprocess.run([sys.executable, "-S", str(SCRIPTS / "validate_findings.py"),
                               str(self.repo / ".harden" / "findings.json")],
                              capture_output=True, env=env, timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stdout.decode("utf-8", "replace"))
        self.assertIn("1 by the run profile ('auto (profile)' rows",
                      proc.stdout.decode("utf-8"))
        # Without a marker (the run was stopped) the row still counts.
        (self.repo / ".harden" / "active").unlink()
        rep = vf.validate_document(self.doc(applied), repo=self.repo)
        self.assertFalse(has(rep, "status"), [i.render() for i in rep.errors])

    def test_auto_profile_rows_that_do_not_approve(self) -> None:
        applied = finding(status="applied", commit=self.sha)
        behavioural = finding(status="applied", commit=self.sha, **{"class": "behavioural"})
        self.write_profile(structural=True, behavioural=False)
        self.write_marker(mode="auto")
        cases = [
            (applied, "auto (profile)", "names no switch"),
            (applied, "auto (profile): auto_apply.structural=false", "cannot rest on"),
            (applied, "auto (profile): auto_apply.everything=true", "unknown switch"),
            (applied, "auto (profile): auto_apply.behavioural=true", "needs "
             "auto_apply.structural=true"),
            (behavioural, "auto (profile): auto_apply.behavioural=true",
             "sets auto_apply.behavioural=false"),
            (applied, "auto (profile): auto_apply.structural=true, "
             "auto_apply.money_paths=true", "sets auto_apply.money_paths=null"),
        ]
        for item, words, needle in cases:
            with self.subTest(words=words, cls=item["class"]):
                self.write_approvals(f"| dead-code | accepted | 3 | {words} | "
                                     "2026-09-25T01:00:00Z |")
                rep = vf.validate_document(self.doc(item), repo=self.repo)
                self.assertTrue(has(rep, "status", finding_id="H-001", contains=needle),
                                [i.render() for i in rep.errors])
                self.assertTrue(has(rep, "status", contains="'auto (profile)' approval"))
        # No profile to rest on.
        self.write_approvals("| dead-code | accepted | 3 | auto (profile): "
                             "auto_apply.structural=true | 2026-09-25T01:00:00Z |")
        (self.repo / ".harden" / "profile.json").unlink()
        rep = vf.validate_document(self.doc(applied), repo=self.repo)
        self.assertTrue(has(rep, "status", contains="no .harden/profile.json"))
        # An --interactive run takes the user's words, never the profile's switch.
        self.write_profile(structural=True)
        for marker in ({"mode": "interactive"}, {"mode": "apply"},
                       {"mode": "report-only", "mode_requested": "interactive"}):
            with self.subTest(marker=marker):
                self.write_marker(**marker)
                rep = vf.validate_document(self.doc(applied), repo=self.repo)
                self.assertTrue(has(rep, "status", contains="is --interactive"))
        # A quoted user row approves the finding whatever the mode, and is counted as such.
        self.write_approvals("| dead-code | accepted | 3 | auto (profile): "
                             "auto_apply.structural=true | 2026-09-25T01:00:00Z |",
                             "| DC-03 | accepted | 1 | \"yes, delete it\" | "
                             "2026-09-25T01:05:00Z |")
        rep = vf.validate_document(self.doc(applied), repo=self.repo)
        self.assertFalse(has(rep, "status"), [i.render() for i in rep.errors])
        self.assertEqual(rep.counts["t1_approved_by"], {"profile": 0, "user": 1})

    def test_money_path_globs_warn_when_money_paths_is_not_named(self) -> None:
        # pilot-auto-calibration A01-F06: with money_paths_globs set and matching, an item whose
        # file a pattern matches needs auto_apply.money_paths unless it is AST-identical.
        applied = finding(status="applied", commit=self.sha, notes="live-effect: none")
        hdir = self.repo / ".harden"
        hdir.mkdir(exist_ok=True)
        self.write_marker(mode="auto", base_sha=self.sha)
        profile = {"version": 1, "auto_apply": {"structural": True, "money_paths": True},
                   "money_paths_globs": ["src/"]}
        (hdir / "profile.json").write_text(json.dumps(profile), encoding="utf-8")
        self.write_approvals("| dead-code | accepted | 3 | auto (profile): "
                             "auto_apply.structural=true | 2026-09-25T01:00:00Z |")
        rep = vf.validate_document(self.doc(applied), repo=self.repo)
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])  # a warning, not an error
        self.assertTrue(has(rep, "status", level="warning", finding_id="H-001",
                            contains="money_paths_globs pattern 'src/' puts on a money path"))
        # Its own row naming the money_paths switch clears the warning.
        self.write_approvals("| dead-code | accepted | 3 | auto (profile): "
                             "auto_apply.structural=true | 2026-09-25T01:00:00Z |",
                             "| H-001 | accepted | 1 | auto (profile): auto_apply.structural=true, "
                             "auto_apply.money_paths=true | 2026-09-25T01:00:00Z |")
        rep = vf.validate_document(self.doc(applied), repo=self.repo)
        self.assertFalse(has(rep, "status", level="warning", contains="money_paths_globs"))
        self.assertFalse(has(rep, "status"), [i.render() for i in rep.errors])
        # A file no pattern matches, a list ignored because a pattern matches nothing, and a
        # profile without the list draw no warning.
        self.write_approvals("| dead-code | accepted | 3 | auto (profile): "
                             "auto_apply.structural=true | 2026-09-25T01:00:00Z |")
        (self.repo / "lib").mkdir()
        (self.repo / "lib" / "b.py").write_text("x = 1\n", encoding="utf-8")
        self._git("add", "lib/b.py")
        self._git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false",
                  "-c", f"core.hooksPath={(Path(self.tmp.name) / 'nohooks').as_posix()}",
                  "commit", "-q", "-m", "lib")
        self.write_marker(mode="auto", base_sha=self._git("rev-parse", "HEAD").strip())
        for globs in (["lib/"], ["src/", "wallet/"], None):
            with self.subTest(globs=globs):
                data = dict(profile)
                if globs is None:
                    data.pop("money_paths_globs")
                else:
                    data["money_paths_globs"] = globs
                (hdir / "profile.json").write_text(json.dumps(data), encoding="utf-8")
                if globs == ["lib/"]:
                    # the list decides here, and leaves src/a.py off a money path
                    self.assertIsNotNone(vf.ApprovalContext.load(hdir).money_globs)
                rep = vf.validate_document(self.doc(applied), repo=self.repo)
                self.assertFalse(has(rep, "status", level="warning",
                                     contains="money_paths_globs"))

    def test_money_path_globs_ignore_rows_the_profile_refuses(self) -> None:
        # A row the profile refuses (it names money_paths=true while the profile sets it false)
        # does not silence the warning for an item a structural row approves.
        applied = finding(status="applied", commit=self.sha)
        hdir = self.repo / ".harden"
        hdir.mkdir(exist_ok=True)
        self.write_marker(mode="auto", base_sha=self.sha)
        (hdir / "profile.json").write_text(json.dumps(
            {"version": 1, "auto_apply": {"structural": True, "money_paths": False},
             "money_paths_globs": ["src/"]}), encoding="utf-8")
        self.write_approvals("| dead-code | accepted | 3 | auto (profile): "
                             "auto_apply.structural=true | 2026-09-25T01:00:00Z |",
                             "| H-001 | accepted | 1 | auto (profile): auto_apply.structural=true, "
                             "auto_apply.money_paths=true | 2026-09-25T01:00:00Z |")
        rep = vf.validate_document(self.doc(applied), repo=self.repo)
        self.assertTrue(has(rep, "status", level="warning", finding_id="H-001",
                            contains="money_paths_globs pattern 'src/' puts on a money path"))
        self.assertTrue(has(rep, "status", level="warning", finding_id="H-001",
                            contains="none of the auto (profile) rows that approve it"))

    def test_messages_name_both_approval_routes(self) -> None:
        approved = finding(status="approved")
        self.write_approvals("| duplication | accepted | 2 | \"ok\" | 2026-09-24T10:00:00Z |")
        rep = vf.validate_document(self.doc(approved), repo=self.repo)
        self.assertTrue(has(rep, "status", contains="auto (profile): auto_apply.<switch>=true"))
        self.write_approvals("| dead-code | accepted | 3 |  | 2026-09-24T10:00:00Z |")
        rep = vf.validate_document(self.doc(approved), repo=self.repo)
        self.assertTrue(has(rep, "status", contains="quote the user (--interactive)"))
        self.assertTrue(has(rep, "status", contains="in autonomous mode, name the profile "
                                                    "switch"))

    def make_commit(self, subject: str, body: str = "",
                    files: Optional[Dict[str, str]] = None) -> str:
        """Commit files (default: src/b.py holding the subject) and return the new sha."""
        files = files or {"src/b.py": subject + "\n"}
        for rel, text in files.items():
            path = self.repo / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        self._git("add", "--", *files)
        hooks = (Path(self.tmp.name) / "nohooks").as_posix()
        message = ["-m", subject] + (["-m", body] if body else [])
        self._git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c",
                  "commit.gpgsign=false", "-c", f"core.hooksPath={hooks}", "commit", "-q",
                  *message)
        return self._git("rev-parse", "HEAD").strip()

    def test_owner_judgement_rows_approve_t2_findings(self) -> None:
        # prioritization Autonomous mode, Owner-judgement lane (user-policy-autonomy U01-F06).
        item = lane_item(commit=self.sha, rule_ref="ER-02", lens="errors-resilience")
        self.write_profile(structural=True, behavioural=True, owner_judgement=True)
        self.write_marker(mode="auto")
        self.write_approvals("| H-001 | accepted | 1 | auto (profile): owner judgement, T2 by "
                             "ER-02, auto_apply.owner_judgement=true, "
                             "auto_apply.behavioural=true | 2026-09-25T22:00:00Z |")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertFalse(has(rep, "status"), [i.render() for i in rep.errors])
        self.assertEqual(rep.counts["t2_applied_by_owner_judgement"], 1)
        self.assertNotIn("t1_approved_by", rep.counts)

    def test_owner_judgement_rows_that_do_not_approve(self) -> None:
        item = lane_item(commit=self.sha, rule_ref="ER-02", lens="errors-resilience")
        (self.repo / ".harden").mkdir(exist_ok=True)
        self.write_marker(mode="auto")
        words = ("auto (profile): owner judgement, T2 by ER-02, "
                 "auto_apply.owner_judgement=true, auto_apply.behavioural=true")
        cases = [
            ({"behavioural": True, "owner_judgement": True},
             "| errors-resilience | accepted | 3 | " + words + " | 2026-09-25T22:00:00Z |",
             "has no 'accepted' row for H-001"),
            ({"behavioural": True, "owner_judgement": True},
             "| H-001 | accepted | 1 | auto (profile): auto_apply.behavioural=true | "
             "2026-09-25T22:00:00Z |",
             "needs auto_apply.owner_judgement=true"),
            ({"behavioural": True, "owner_judgement": False},
             "| H-001 | accepted | 1 | " + words + " | 2026-09-25T22:00:00Z |",
             "sets auto_apply.owner_judgement=false"),
            ({"behavioural": True, "owner_judgement": True},
             "| H-001 | accepted | 1 | \"yes, apply it\" | 2026-09-25T22:00:00Z |",
             "quotes a user answer"),
        ]
        for switches, row, needle in cases:
            with self.subTest(needle=needle):
                self.write_profile(**switches)
                self.write_approvals(row)
                rep = vf.validate_document(self.doc(item), repo=self.repo)
                self.assertTrue(has(rep, "status", finding_id="H-001", contains=needle),
                                [i.render() for i in rep.errors])
        # An --interactive run never applies a T2 item.
        self.write_profile(behavioural=True, owner_judgement=True)
        self.write_approvals("| H-001 | accepted | 1 | " + words + " | 2026-09-25T22:00:00Z |")
        self.write_marker(mode="interactive")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertTrue(has(rep, "status", contains="is --interactive"))

    def test_contract_source_commits_need_their_review_kind(self) -> None:
        # user-policy-autonomy U01-F12: a contract fix takes effect only when the owner redeploys.
        for rel in ("packages/hardhat/contracts/Pool.sol", "contracts/Vault.VY"):
            with self.subTest(rel=rel):
                sha = self.make_commit("refactor(contracts): drop commented-out code NFC (H-001)",
                                       files={rel: "// " + rel + "\n"})
                rep = vf.validate_document(self.doc(finding(tier="T0", status="applied",
                                                            commit=sha)), repo=self.repo)
                self.assertTrue(has(rep, "review", contains="contract-source"),
                                [i.render() for i in rep.errors])
                review = {"kinds": ["contract-source"], "option": "direct", "alternatives": None}
                ok = vf.validate_document(self.doc(finding(tier="T0", status="applied",
                                                           commit=sha, review=review)),
                                          repo=self.repo)
                self.assertFalse(has(ok, "review"), [i.render() for i in ok.errors])

    def test_breaking_marker_and_review_kind_agree(self) -> None:
        # Conventional Commits 1.0.0 and protocol-change step 10 (user-policy-autonomy U01-F13).
        breaking = self.make_commit("fix(portfolio)!: keep order ids as strings (H-001)",
                                    "BREAKING CHANGE: Trade.orderId is a string; callers that "
                                    "compare numbers must parse it.")
        plain = self.make_commit("fix(portfolio): keep order ids as strings (H-001)")
        no_footer = self.make_commit("fix(portfolio)!: keep order ids as strings (H-001)")
        breaking_kind = {"kinds": ["breaking-api"], "option": "direct", "alternatives": None}
        other_kind = {"kinds": ["additive-api"], "option": "direct", "alternatives": None}
        cases = [(breaking, other_kind, "error", "marks a breaking change"),
                 (plain, breaking_kind, "error", "has no '!'"),
                 (no_footer, breaking_kind, "warning", "BREAKING CHANGE")]
        for sha, review, level, needle in cases:
            with self.subTest(needle=needle):
                rep = vf.validate_document(self.doc(finding(tier="T0", status="applied",
                                                            commit=sha, review=review)),
                                           repo=self.repo)
                self.assertTrue(has(rep, "review", level=level, contains=needle),
                                [i.render() for i in rep.errors + rep.warnings])
        ok = vf.validate_document(self.doc(finding(tier="T0", status="applied", commit=breaking,
                                                   review=breaking_kind)), repo=self.repo)
        self.assertFalse(has(ok, "review"), [i.render() for i in ok.errors])
        self.assertFalse(has(ok, "review", level="warning"))

    def test_money_path_items_need_the_money_path_review_kind(self) -> None:
        hdir = self.repo / ".harden"
        hdir.mkdir(exist_ok=True)
        (hdir / "profile.json").write_text(json.dumps(
            {"version": 1, "auto_apply": {"behavioural": True, "money_paths": True},
             "money_paths_globs": ["src/"]}), encoding="utf-8")
        self.write_marker(mode="auto", base_sha=self.sha)
        self.write_approvals("| DC-03 | accepted | 1 | auto (profile): auto_apply.behavioural=true, "
                             "auto_apply.money_paths=true | 2026-09-25T22:00:00Z |")
        item = finding(**{"class": "behavioural"}, status="applied", commit=self.sha,
                       evidence=TEST_EVIDENCE, review=REVIEW_BEHAVIOURAL,
                       notes="live-effect: none")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        self.assertTrue(has(rep, "review", level="warning", contains="money-path"))
        item["review"] = {"kinds": ["behavioural", "money-path"], "option": "direct",
                          "alternatives": None}
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertFalse(has(rep, "review", level="warning"))

    def test_live_effect_items_are_never_applied(self) -> None:
        # prioritization, Money paths; user-policy-autonomy U01-F12.
        item = finding(**{"class": "behavioural"}, status="applied", commit=self.sha,
                       evidence=TEST_EVIDENCE, review=REVIEW_BEHAVIOURAL,
                       notes="live-effect: sign at src/w.ts:3")
        self.write_profile(behavioural=True)
        self.write_approvals("| dead-code | accepted | 1 | auto (profile): "
                             "auto_apply.behavioural=true | 2026-09-25T22:00:00Z |")
        self.write_marker(mode="auto")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertTrue(has(rep, "notes", contains="live-effect"), [i.render() for i in rep.errors])
        self.write_marker(mode="interactive")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertFalse(has(rep, "notes", contains="live-effect path"))

    def test_applied_items_need_a_live_effect_entry(self) -> None:
        self.write_profile(structural=True)
        self.write_approvals("| dead-code | accepted | 1 | auto (profile): "
                             "auto_apply.structural=true | 2026-09-25T22:00:00Z |")
        self.write_marker(mode="auto")
        missing = vf.validate_document(self.doc(finding(status="applied", commit=self.sha)),
                                       repo=self.repo)
        self.assertTrue(has(missing, "notes", contains="live-effect: none"))
        present = vf.validate_document(self.doc(finding(status="applied", commit=self.sha,
                                                        notes="live-effect: none")),
                                       repo=self.repo)
        self.assertFalse(has(present, "notes"), [i.render() for i in present.errors])
        approved = vf.validate_document(self.doc(finding(status="approved")), repo=self.repo)
        self.assertFalse(has(approved, "notes"))
        self.assertTrue(has(approved, "notes", level="warning", contains="live-effect"))

    def test_breaking_api_needs_the_owner_judgement_kind(self) -> None:
        item = finding(**{"class": "behavioural"}, status="applied", commit=self.sha,
                       evidence=TEST_EVIDENCE,
                       review={"kinds": ["breaking-api", "behavioural"], "option": "direct",
                               "alternatives": None})
        rep = vf.validate_document(self.doc(item))
        self.assertTrue(has(rep, "review.kinds", contains="owner-judgement"),
                        [i.render() for i in rep.errors])

    def test_lane_t1_kinds_need_owner_judgement_row(self) -> None:
        item = finding(**{"class": "behavioural"}, status="applied", commit=self.sha,
                       evidence=TEST_EVIDENCE, notes="live-effect: none",
                       review={"kinds": ["additive-api", "behavioural"], "option": "direct",
                               "alternatives": None})
        self.write_profile(behavioural=True)
        self.write_marker(mode="auto")
        self.write_approvals("| dead-code | accepted | 1 | auto (profile): "
                             "auto_apply.behavioural=true | 2026-09-25T22:00:00Z |")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertTrue(has(rep, "status", contains="auto_apply.owner_judgement=true"),
                        [i.render() for i in rep.errors])
        self.write_profile(behavioural=True, owner_judgement=True)
        self.write_approvals("| dead-code | accepted | 1 | auto (profile): "
                             "auto_apply.behavioural=true, auto_apply.owner_judgement=true | "
                             "2026-09-25T22:00:00Z |")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertFalse(has(rep, "status"), [i.render() for i in rep.errors])

    def test_whole_repo_format_commit_never_touches_contracts(self) -> None:
        sha = self.make_commit("style(format): prettier@3 on the whole repository NFC (H-001)",
                               files={"contracts/Pool.sol": "// pool\n"})
        review = {"kinds": ["whole-repo-format", "contract-source"], "option": "direct",
                  "alternatives": None}
        rep = vf.validate_document(self.doc(finding(tier="T0", status="applied", commit=sha,
                                                    review=review)), repo=self.repo)
        self.assertTrue(has(rep, "review", contains="whole-repository format"),
                        [i.render() for i in rep.errors])

    def test_foundry_tests_are_not_contract_sources(self) -> None:
        sha = self.make_commit("test(pool): strengthen testSwap (H-001)",
                               files={"test/Pool.t.sol": "// test\n"})
        rep = vf.validate_document(self.doc(finding(tier="T0", status="applied", commit=sha)),
                                   repo=self.repo)
        self.assertFalse(has(rep, "review"), [i.render() for i in rep.errors])

    def test_version_moving_dependency_row_needs_dependency_versions(self) -> None:
        # user-policy-autonomy U01-F08: DP-09 adds a resolved version.
        item = finding(status="applied", commit=self.sha, lens="dependencies", rule_ref="DP-09",
                       notes="live-effect: none")
        self.write_profile(dependencies=True)
        self.write_marker(mode="auto")
        self.write_approvals("| DP-09 | accepted | 1 | auto (profile): auto_apply.dependencies=true | "
                             "2026-09-25T22:00:00Z |")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertTrue(has(rep, "status", contains="needs auto_apply.dependency_versions=true"),
                        [i.render() for i in rep.errors])
        self.write_profile(dependencies=True, dependency_versions=True)
        self.write_approvals("| DP-09 | accepted | 1 | auto (profile): auto_apply.dependencies=true, "
                             "auto_apply.dependency_versions=true | 2026-09-25T22:00:00Z |")
        rep = vf.validate_document(self.doc(item), repo=self.repo)
        self.assertFalse(has(rep, "status"), [i.render() for i in rep.errors])

    def test_parse_approvals_skips_header_and_separator(self) -> None:
        rows = vf.parse_approvals("| Category | Decision | Count | User's exact words | UTC time |\n"
                                  "|:--|:-:|--|---|---|\n"
                                  "| dead-code | accepted | 3 | \"yes\" | 2026-09-24T10:00Z |\n"
                                  "not a row\n| too | short |\n")
        self.assertEqual(rows, [{"category": "dead-code", "decision": "accepted", "count": "3",
                                 "quote": "\"yes\"", "time": "2026-09-24T10:00Z"}])


class CliTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        return subprocess.run([sys.executable, str(SCRIPTS / "validate_findings.py"), *args],
                              capture_output=True, env=env, timeout=120)

    def write(self, name: str, content: str) -> Path:
        path = self.dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def test_exit_codes(self) -> None:
        good = self.write("good.json", json.dumps(document([finding()])))
        bad = self.write("bad.json", json.dumps(document([finding(lens="nope")])))
        broken = self.write("broken.json", "{not json")
        self.assertEqual(self.run_cli(str(good), "--no-repo").returncode, 0)
        self.assertEqual(self.run_cli(str(bad), "--no-repo").returncode, 1)
        self.assertEqual(self.run_cli(str(broken)).returncode, 2)
        self.assertEqual(self.run_cli(str(self.dir / "absent.json")).returncode, 2)

    def test_json_output(self) -> None:
        bad = self.write("bad.json", json.dumps(document([finding(lens="nope")])))
        proc = self.run_cli(str(bad), "--json", "--no-repo")
        out = json.loads(proc.stdout.decode("utf-8"))
        self.assertFalse(out["valid"])
        self.assertEqual(out["errors"][0]["finding"], "H-001")
        self.assertEqual(out["errors"][0]["field"], "lens")

    def test_new_fields_under_python_dash_s(self) -> None:
        doc = document([finding(seen_in_passes=1, pass_ids=["p1"], verifier_id="p1",
                                baseline_state="new")])
        path = self.write("prov.json", json.dumps(doc))
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        proc = subprocess.run([sys.executable, "-S", str(SCRIPTS / "validate_findings.py"),
                               str(path), "--no-repo", "--json"], capture_output=True, env=env,
                              timeout=120)
        self.assertEqual(proc.returncode, 1)
        out = json.loads(proc.stdout.decode("utf-8"))
        self.assertEqual([(e["finding"], e["field"]) for e in out["errors"]],
                         [("H-001", "verifier_id")])

    def test_bom_is_accepted(self) -> None:
        path = self.dir / "bom.json"
        path.write_bytes(b"\xef\xbb\xbf" + json.dumps(document([finding()])).encode("utf-8"))
        self.assertEqual(self.run_cli(str(path), "--no-repo").returncode, 0)

    def test_default_repo_is_parent_of_harden_dir(self) -> None:
        path = self.write("proj/.harden/findings.json",
                          json.dumps(document([finding(file="src/missing.py")])))
        self.assertEqual(vf.default_repo_for(path), (self.dir / "proj").resolve())
        proc = self.run_cli(str(path), "--json")
        out = json.loads(proc.stdout.decode("utf-8"))
        self.assertEqual(proc.returncode, 1)
        self.assertTrue(any(e["field"] == "file" for e in out["errors"]))
        skipped = self.run_cli(str(path), "--no-repo")
        self.assertEqual(skipped.returncode, 0)
        self.assertIn("not checked", skipped.stdout.decode("utf-8"))


class ControlCharacterTest(unittest.TestCase):
    """pilot-auto-calibration A01-F60: a stray control character (a heredoc escape such as a
    backspace) makes the document invalid; tab, line feed and carriage return stay valid."""

    def test_control_characters_are_errors(self) -> None:
        rep = vf.validate_document(document([finding(notes="see" + chr(8) + "above")]))
        self.assertFalse(rep.valid)
        self.assertTrue(has(rep, "notes", contains="U+0008"))
        rep = vf.validate_document(document([finding(notes="a" + chr(9) + "b" + chr(10) +
                                                    "c" + chr(13))]))
        self.assertTrue(rep.valid, [i.render() for i in rep.errors])
        item = dict(TEST_EVIDENCE[0], detail="x" + chr(27) + "[31m")
        rep = vf.validate_document(document([finding(evidence=[item])]))
        self.assertTrue(has(rep, "evidence[0].detail", contains="U+001B"))


if __name__ == "__main__":
    unittest.main()
