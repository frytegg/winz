"""Tests for scripts/findings_to_sarif.py (run: python -m unittest discover -s scripts/tests)."""
from __future__ import annotations

import copy
import hashlib
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

import findings_to_sarif as fs  # noqa: E402
import sarif_delta as sd  # noqa: E402

BASE_SHA = "0123456789abcdef0123456789abcdef01234567"
HAS_GIT = shutil.which("git") is not None
SOURCE = "def a():\n    return 1\n\n\ndef b():\n    pass\n"


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


def tool_log(name: str = "eslint", version: str = "9.12.0", line: int = 3,
             extra_top: Optional[Dict[str, Any]] = None, sarif_version: str = "2.1.0") -> Dict[str, Any]:
    log: Dict[str, Any] = {
        "$schema": fs.SARIF_SCHEMA,
        "version": sarif_version,
        "runs": [{
            "tool": {"driver": {"name": name, "version": version,
                                "rules": [{"id": "no-unused-vars"}]}},
            "invocations": [{"executionSuccessful": True}],
            "results": [{
                "ruleId": "no-unused-vars",
                "level": "warning",
                "message": {"text": "'x' is assigned a value but never used."},
                "locations": [{"physicalLocation": {
                    "artifactLocation": {"uri": "src/b.ts"}, "region": {"startLine": line}}}],
                "partialFingerprints": {"primaryLocationLineHash": "abc123:1"},
            }],
        }],
    }
    if extra_top:
        log.update(extra_top)
    return log


def as_tool_log(log: Dict[str, Any], path: str = "tools/eslint.sarif") -> fs.ToolLog:
    return fs.ToolLog(path=path, runs=log["runs"], version=log.get("version", ""),
                      dropped_keys=sorted(k for k in log if k not in fs.SARIF_TOP_KEYS))


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class TempDirTest(unittest.TestCase):
    """Gives each test a temporary directory and a small fake skill directory."""

    skill_md = "---\nname: harden\ndescription: test\n---\n\n# body\n"

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.skill = self.dir / "skill"
        (self.skill / "references").mkdir(parents=True)
        (self.skill / "SKILL.md").write_text(self.skill_md, encoding="utf-8")
        (self.skill / "references" / "lens-dead-code.md").write_text(
            "# Dead code\n\n### DC-03 — Remove compiler-proven unused items\n- **Rule:** x\n",
            encoding="utf-8")
        (self.skill / "references" / "lens-complexity-design.md").write_text(
            "### CX-04 — Split long functions only with tests\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def convert(self, doc: Dict[str, Any], tools: Optional[List[fs.ToolLog]] = None,
                repo: Optional[Path] = None) -> fs.Conversion:
        return fs.convert(doc, tools or [], repo=repo, skill_dir=self.skill)

    def write(self, rel: str, content: str, base: Optional[Path] = None) -> Path:
        path = (base or self.dir) / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path


class StructureTest(TempDirTest):
    def test_log_is_structurally_valid_sarif(self) -> None:
        conv = self.convert(document([finding()]), [as_tool_log(tool_log())])
        log = conv.log
        self.assertEqual(log["version"], "2.1.0")
        self.assertEqual(log["$schema"], fs.SARIF_SCHEMA)
        self.assertTrue(log["$schema"].startswith("https://"))
        self.assertEqual([r["tool"]["driver"]["name"] for r in log["runs"]], ["harden", "eslint"])
        for run in log["runs"]:
            for result in run["results"]:
                self.assertTrue(result["locations"])
        self.assertEqual(fs.sarif_problems(log), [])
        json.dumps(log)  # serialisable as is

    def test_level_mapping(self) -> None:
        severities = ["critical", "high", "medium", "low", "nit"]
        findings = [finding(id=f"H-{i}", severity=s) for i, s in enumerate(severities)]
        results = self.convert(document(findings)).log["runs"][0]["results"]
        self.assertEqual([r["level"] for r in results], ["error", "error", "warning", "note", "note"])

    def test_rules_from_distinct_rule_refs(self) -> None:
        findings = [
            finding(id="H-1", rule_ref="DC-03"),
            finding(id="H-2", rule_ref="CX-04", lens="complexity-design", line=5),
            finding(id="H-3", rule_ref="DC-03", line=5),
            finding(id="H-4", rule_ref="project:eslint/no-unused-vars", lens="project-tool"),
            finding(id="H-5", rule_ref="SE-99", lens="security", cwe="CWE-798"),
        ]
        run = self.convert(document(findings)).log["runs"][0]
        rules = run["tool"]["driver"]["rules"]
        ids = [r["id"] for r in rules]
        self.assertEqual(ids, sorted({"DC-03", "CX-04", "project:eslint/no-unused-vars", "SE-99"}))
        for result in run["results"]:
            self.assertEqual(rules[result["ruleIndex"]]["id"], result["ruleId"])
        by_id = {r["id"]: r for r in rules}
        self.assertEqual(by_id["DC-03"]["shortDescription"]["text"],
                         "Remove compiler-proven unused items")
        self.assertEqual(by_id["DC-03"]["properties"]["reference"], "references/lens-dead-code.md")
        self.assertEqual(by_id["project:eslint/no-unused-vars"]["properties"]["tool_version"],
                         "9.12.0")
        self.assertIn("not found", by_id["SE-99"]["help"]["text"])
        self.assertIn("external/cwe/cwe-798", by_id["SE-99"]["properties"]["tags"])
        self.assertNotIn("defaultConfiguration", by_id["DC-03"])  # would break sarif_delta pins

    def test_location_message_and_properties(self) -> None:
        f = finding(end_line=4, cwe="CWE-561", commit=None,
                    threshold_source={"kind": "project-config", "ref": ".eslintrc.json complexity"},
                    seen_in_passes=2, pass_ids=["p1", "p2"], verifier_id="v1")
        result = self.convert(document([f])).log["runs"][0]["results"][0]
        self.assertEqual(result["ruleId"], "DC-03")
        self.assertEqual(result["message"], {"text": "Unused private helper"})
        physical = result["locations"][0]["physicalLocation"]
        self.assertEqual(physical["artifactLocation"], {"uri": "src/a.py", "uriBaseId": "%SRCROOT%"})
        self.assertEqual(physical["region"], {"startLine": 2, "endLine": 4})
        props = result["properties"]
        for key in ("id", "lens", "tier", "class", "severity", "severity_criterion", "confidence",
                    "status", "fix_risk", "evidence", "cwe", "threshold_source"):
            self.assertIn(key, props, key)
            self.assertEqual(props[key], f[key], key)
        self.assertNotIn("commit", props)  # absent optional fields stay absent
        self.assertEqual(props["seen_in_passes"], 2)
        self.assertEqual(props["verifier_id"], "v1")
        self.assertEqual(props["tags"], ["dead-code", "external/cwe/cwe-561"])
        self.assertNotIn("baselineState", result)
        self.assertNotIn("suppressions", result)

    def test_commit_in_properties_when_applied(self) -> None:
        props = self.convert(document([finding(status="applied", commit="abcdef1")])) \
            .log["runs"][0]["results"][0]["properties"]
        self.assertEqual(props["commit"], "abcdef1")

    def test_baseline_state_copied_when_present(self) -> None:
        conv = self.convert(document([finding(baseline_state="unchanged"),
                                      finding(id="H-002", line=5, baseline_state="new")]))
        states = [r["baselineState"] for r in conv.log["runs"][0]["results"]]
        self.assertEqual(states, ["unchanged", "new"])
        self.assertFalse(any("baseline" in w for w in conv.warnings))
        partial = self.convert(document([finding(baseline_state="new"), finding(id="H-002")]))
        self.assertTrue(any("1 of 2 result(s) have no baseline_state" in w for w in partial.warnings))

    def test_invocation_records_success_and_tool_versions(self) -> None:
        doc = document([finding()])
        run = self.convert(doc).log["runs"][0]
        invocation = run["invocations"][0]
        self.assertIs(invocation["executionSuccessful"], True)
        self.assertEqual(invocation["properties"]["tool_versions"], doc["tool_versions"])
        self.assertIsInstance(invocation["toolExecutionNotifications"], list)
        self.assertEqual(run["properties"]["base_sha"], BASE_SHA)

    def test_notifications_carry_warnings_at_warning_level(self) -> None:
        conv = self.convert(document([finding()]))  # no repo -> title-hash warning
        notes = conv.log["runs"][0]["invocations"][0]["toolExecutionNotifications"]
        self.assertEqual(len(notes), len(conv.warnings))
        self.assertTrue(notes)
        self.assertTrue(all(n["level"] == "warning" for n in notes))

    def test_uri_is_percent_encoded_and_sarif_delta_decodes_it(self) -> None:
        log = self.convert(document([finding(file="src/my file.py")])).log
        uri = log["runs"][0]["results"][0]["locations"][0]["physicalLocation"]["artifactLocation"]["uri"]
        self.assertEqual(uri, "src/my%20file.py")
        side = sd.parse_sarif(log, "report.sarif")
        self.assertEqual(side.tools["harden"].results[0].uri, "src/my file.py")

    def test_empty_findings_give_an_empty_valid_run(self) -> None:
        conv = self.convert(document([]))
        run = conv.log["runs"][0]
        self.assertEqual((run["results"], run["tool"]["driver"]["rules"]), ([], []))
        self.assertEqual(fs.sarif_problems(conv.log), [])
        self.assertEqual(conv.warnings, [])
        side = sd.parse_sarif(conv.log, "empty.sarif")
        self.assertEqual(side.tools["harden"].results, [])

    def test_output_is_deterministic(self) -> None:
        doc = document([finding(), finding(id="H-002", rule_ref="CX-04",
                                           lens="complexity-design")])
        one = json.dumps(self.convert(doc).log, sort_keys=True)
        two = json.dumps(self.convert(copy.deepcopy(doc)).log, sort_keys=True)
        self.assertEqual(one, two)


class VersionTest(TempDirTest):
    def version_of(self, frontmatter: str) -> Dict[str, Any]:
        (self.skill / "SKILL.md").write_text(frontmatter, encoding="utf-8")
        conv = self.convert(document([finding()]))
        self.last_warnings = conv.warnings
        return conv.log["runs"][0]["tool"]["driver"]

    def test_no_version_gives_placeholder(self) -> None:
        driver = self.version_of("---\nname: harden\n---\n")
        self.assertEqual((driver["version"], driver["semanticVersion"]), ("0.0.0", "0.0.0"))

    def test_metadata_version(self) -> None:
        driver = self.version_of("---\nname: harden\nmetadata:\n  author: x\n  version: \"1.4.2\"\n"
                                 "hooks:\n  Stop: []\n---\n")
        self.assertEqual((driver["version"], driver["semanticVersion"]), ("1.4.2", "1.4.2"))

    def test_top_level_version_with_prerelease(self) -> None:
        driver = self.version_of("---\nname: harden\nversion: 2.0.0-rc.1  # next\n---\n")
        self.assertEqual(driver["semanticVersion"], "2.0.0-rc.1")

    def test_version_outside_frontmatter_is_ignored(self) -> None:
        driver = self.version_of("---\nname: harden\n---\nversion: 9.9.9\n")
        self.assertEqual(driver["semanticVersion"], "0.0.0")

    def test_non_semver_version_is_kept_without_semantic_version(self) -> None:
        driver = self.version_of("---\nname: harden\nversion: '1.2'\n---\n")
        self.assertEqual(driver["version"], "1.2")
        self.assertNotIn("semanticVersion", driver)
        self.assertTrue(any("not SemVer" in w for w in self.last_warnings))

    def test_bom_and_crlf_frontmatter(self) -> None:
        (self.skill / "SKILL.md").write_bytes(
            b"\xef\xbb\xbf---\r\nname: harden\r\nversion: 3.1.0\r\n---\r\n")
        self.assertEqual(fs.skill_version(self.skill / "SKILL.md"), "3.1.0")
        self.assertIsNone(fs.skill_version(self.dir / "missing.md"))


class FingerprintTest(TempDirTest):
    def setUp(self) -> None:
        super().setUp()
        self.repo = self.dir / "repo"
        self.write("src/a.py", SOURCE, base=self.repo)

    def fingerprints(self, doc: Dict[str, Any], repo: Optional[Path] = None) -> List[Dict[str, str]]:
        conv = self.convert(doc, repo=repo)
        self.last = conv
        return [r["partialFingerprints"] for r in conv.log["runs"][0]["results"]]

    def test_finding_fingerprint_wins(self) -> None:
        fps = self.fingerprints(document([finding(fingerprint="fp-123")]), repo=self.repo)
        self.assertEqual(fps, [{fs.FP_FINDING: "fp-123"}])
        props = self.last.log["runs"][0]["results"][0]["properties"]
        self.assertEqual(props["fingerprint_basis"], "finding")

    def test_line_hash_of_trimmed_line_with_repo(self) -> None:
        fps = self.fingerprints(document([finding(line=2)]), repo=self.repo)
        expected = sha("DC-03\0src/a.py\0return 1")
        self.assertEqual(fps, [{fs.FP_LINE: expected}])
        self.assertEqual(fs.line_hash("DC-03", "./src//a.py", "   return 1 \r"), expected)
        props = self.last.log["runs"][0]["results"][0]["properties"]
        self.assertEqual(props["fingerprint_basis"], "line-hash@worktree")
        self.assertEqual(self.last.log["runs"][0]["properties"]["fingerprint_revision"], "worktree")
        self.assertFalse(any("fingerprint" in w for w in self.last.warnings))
        self.assertNotIn("return 1", json.dumps(self.last.log))  # no source text in the log

    def test_line_hash_survives_moves_and_whitespace(self) -> None:
        before = self.fingerprints(document([finding(line=2)]), repo=self.repo)[0]
        self.write("src/a.py", "import os\n\r\ndef a():\r\n\treturn 1   \r\n", base=self.repo)
        after = self.fingerprints(document([finding(line=4)]), repo=self.repo)[0]
        self.assertEqual(before, after)
        self.write("src/a.py", "def a():\n    return 2\n", base=self.repo)
        changed = self.fingerprints(document([finding(line=2)]), repo=self.repo)[0]
        self.assertNotEqual(before, changed)
        other_rule = self.fingerprints(document([finding(line=2, rule_ref="DC-04")]),
                                       repo=self.repo)[0]
        self.assertNotEqual(changed, other_rule)

    def test_title_hash_without_repo(self) -> None:
        fps = self.fingerprints(document([finding()]))
        self.assertEqual(fps, [{fs.FP_TITLE: sha("DC-03\0src/a.py\0Unused private helper")}])
        self.assertTrue(any("pass --repo" in w for w in self.last.warnings))
        self.assertIsNone(self.last.log["runs"][0]["properties"]["fingerprint_revision"])

    def test_unreadable_line_falls_back_to_title_hash(self) -> None:
        fps = self.fingerprints(document([finding(line=99), finding(id="H-002", file="src/x.py")]),
                                repo=self.repo)
        self.assertEqual([list(fp) for fp in fps], [[fs.FP_TITLE], [fs.FP_TITLE]])
        warning = next(w for w in self.last.warnings if "could not be read" in w)
        self.assertIn("H-001 (src/a.py:99)", warning)
        self.assertIn("H-002 (src/x.py:2)", warning)

    def test_every_result_has_a_partial_fingerprint(self) -> None:
        doc = document([finding(id=f"H-{i}", line=i + 1) for i in range(6)])
        for repo in (None, self.repo):
            log = self.convert(doc, repo=repo).log
            self.assertTrue(all(r["partialFingerprints"] for r in log["runs"][0]["results"]))


@unittest.skipUnless(HAS_GIT, "git is not installed")
class BaseShaLinesTest(TempDirTest):
    def setUp(self) -> None:
        super().setUp()
        self.repo = self.dir / "repo"
        self.write("src/a.py", SOURCE, base=self.repo)
        hooks = self.dir / "nohooks"
        hooks.mkdir()
        self._git("init", "-q")
        self._git("add", "-A")
        self._git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c",
                  "commit.gpgsign=false", "-c", f"core.hooksPath={hooks.as_posix()}",
                  "commit", "-q", "-m", "init")
        self.sha = self._git("rev-parse", "HEAD").strip()

    def _git(self, *args: str) -> str:
        proc = subprocess.run(["git", "-C", str(self.repo), *args], capture_output=True,
                              check=True)
        return proc.stdout.decode("utf-8", errors="replace")

    def test_lines_are_read_at_base_sha(self) -> None:
        self.write("src/a.py", "# applied fix moved everything\n\n" + SOURCE.replace(
            "return 1", "return 42"), base=self.repo)
        conv = self.convert(document([finding(line=2)], base_sha=self.sha), repo=self.repo)
        result = conv.log["runs"][0]["results"][0]
        self.assertEqual(result["partialFingerprints"], {fs.FP_LINE: sha("DC-03\0src/a.py\0return 1")})
        self.assertEqual(result["properties"]["fingerprint_basis"], "line-hash@" + self.sha)
        self.assertEqual(conv.log["runs"][0]["properties"]["fingerprint_revision"], self.sha)

    def test_line_beyond_base_file_uses_working_tree(self) -> None:
        self.write("src/a.py", SOURCE + "\n\ndef c():\n    return 3\n", base=self.repo)
        conv = self.convert(document([finding(line=10)], base_sha=self.sha), repo=self.repo)
        result = conv.log["runs"][0]["results"][0]
        self.assertEqual(result["partialFingerprints"], {fs.FP_LINE: sha("DC-03\0src/a.py\0return 3")})
        self.assertEqual(result["properties"]["fingerprint_basis"], "line-hash@worktree")

    def test_file_missing_at_base_uses_working_tree(self) -> None:
        self.write("src/new.py", "x = 1\n", base=self.repo)
        conv = self.convert(document([finding(file="src/new.py", line=1)], base_sha=self.sha),
                            repo=self.repo)
        result = conv.log["runs"][0]["results"][0]
        self.assertEqual(result["partialFingerprints"], {fs.FP_LINE: sha("DC-03\0src/new.py\0x = 1")})
        self.assertEqual(result["properties"]["fingerprint_basis"], "line-hash@worktree")

    def test_unknown_base_sha_warns_and_uses_working_tree(self) -> None:
        conv = self.convert(document([finding(line=2)], base_sha="deadbeef" * 5), repo=self.repo)
        self.assertTrue(any("is not a commit" in w for w in conv.warnings))
        result = conv.log["runs"][0]["results"][0]
        self.assertEqual(result["properties"]["fingerprint_basis"], "line-hash@worktree")


class SuppressionTest(TempDirTest):
    def result(self, **overrides: Any) -> Dict[str, Any]:
        conv = self.convert(document([finding(**overrides)]))
        self.last_warnings = conv.warnings
        return conv.log["runs"][0]["results"][0]

    def test_rejected_finding_is_suppressed_with_verifier_note(self) -> None:
        r = self.result(status="rejected", verified=False, verifier_note="DT-33(2): vendored file",
                        exclusion_class="DT-33(2) generated or vendored")
        self.assertEqual(r["suppressions"], [{
            "kind": "external", "status": "accepted",
            "justification": "DT-33(2): vendored file",
            "properties": {"exclusion_class": "DT-33(2) generated or vendored"},
        }])
        self.assertEqual(r["properties"]["status"], "rejected")
        side = sd.parse_sarif(self.convert(document([finding(status="rejected", verified=False)])).log,
                              "x.sarif")
        self.assertTrue(side.tools["harden"].results[0].suppressed)

    def test_notes_are_the_fallback_justification(self) -> None:
        r = self.result(status="rejected", verified=False, verifier_note="", notes="duplicate of H-9")
        self.assertEqual(r["suppressions"][0]["justification"], "duplicate of H-9")

    def test_missing_justification_is_left_empty_and_warned(self) -> None:
        r = self.result(status="rejected", verified=False, verifier_note=" ")
        self.assertNotIn("justification", r["suppressions"][0])
        self.assertTrue(any("RP-17" in w and "H-001" in w for w in self.last_warnings))

    def test_other_statuses_are_not_suppressed(self) -> None:
        for status in ("verified", "deferred", "blocked", "candidate"):
            r = self.result(status=status, verified=status != "candidate", notes="why")
            self.assertNotIn("suppressions", r, status)


class ToolSarifTest(TempDirTest):
    def test_tool_runs_are_appended_unchanged_in_order(self) -> None:
        eslint, ruff = tool_log(), tool_log(name="ruff", version="0.6.9")
        eslint["runs"].append(copy.deepcopy(eslint["runs"][0]))
        original = copy.deepcopy([eslint, ruff])
        doc = document([finding()], tool_versions={"eslint": "9.12.0", "ruff": "0.6.9"})
        conv = self.convert(doc, [as_tool_log(eslint), as_tool_log(ruff, "tools/ruff.sarif")])
        runs = conv.log["runs"]
        self.assertEqual(runs[1:], original[0]["runs"] + original[1]["runs"])
        self.assertEqual(conv.counts["tool_runs"], 3)
        self.assertEqual(conv.counts["tool_files"], 2)
        self.assertFalse(conv.warnings[1:] if conv.warnings else [],
                         "only the no-repo fingerprint warning is expected")

    def test_version_and_dropped_keys_warn(self) -> None:
        log = tool_log(sarif_version="2.0.0", extra_top={"inlineExternalProperties": []})
        conv = self.convert(document([finding()]), [as_tool_log(log)])
        self.assertTrue(any("SARIF version is '2.0.0'" in w for w in conv.warnings))
        self.assertTrue(any("inlineExternalProperties not carried over" in w for w in conv.warnings))
        self.assertNotIn("inlineExternalProperties", conv.log)

    def test_tool_version_cross_check(self) -> None:
        doc = document([finding()], tool_versions={"eslint": "9.12.0", "semgrep": "1.90.0"})
        ok = self.convert(doc, [as_tool_log(tool_log(name="ESLint")),
                                as_tool_log(tool_log(name="Semgrep OSS", version="1.90.0"))])
        self.assertFalse(any("tool '" in w for w in ok.warnings), ok.warnings)
        drift = self.convert(doc, [as_tool_log(tool_log(version="9.13.0"))])
        self.assertTrue(any("reports version 9.13.0 but tool_versions pins eslint 9.12.0" in w
                            for w in drift.warnings))
        unpinned = self.convert(doc, [as_tool_log(tool_log(name="bandit", version="1.7.10"))])
        self.assertTrue(any("'bandit' has no pinned version" in w for w in unpinned.warnings))

    def test_structural_problems_and_name_collision_warn(self) -> None:
        broken = {"version": "2.1.0", "runs": [{"tool": {}, "results": []},
                                                {"tool": {"driver": {"name": "harden"}}}]}
        conv = self.convert(document([finding()]), [as_tool_log(broken)])
        self.assertTrue(any("runs[0].tool.driver.name is missing" in w for w in conv.warnings))
        self.assertTrue(any("collides" in w for w in conv.warnings))

    def test_tool_run_gaps_warn(self) -> None:
        failed = tool_log(name="ruff", version="0.6.9")
        failed["runs"][0]["invocations"] = [{"executionSuccessful": False}, {}]
        failed["runs"][0]["results"][0].pop("partialFingerprints")
        silent = tool_log()
        silent["runs"][0].pop("invocations")
        doc = document([finding()], tool_versions={"eslint": "9.12.0", "ruff": "0.6.9"})
        conv = self.convert(doc, [as_tool_log(failed, "tools/ruff.sarif"), as_tool_log(silent)])
        text = "\n".join(conv.warnings)
        self.assertIn("tools/ruff.sarif runs[0] (ruff): 1 invocation(s) have executionSuccessful=false",
                      text)
        self.assertIn("(ruff): 1 invocation(s) do not record executionSuccessful", text)
        self.assertIn("(ruff): 1 of 1 result(s) carry no fingerprints", text)
        self.assertIn("tools/eslint.sarif runs[0] (eslint) has no invocation record", text)
        self.assertEqual(conv.log["runs"][1], failed["runs"][0])  # still appended unchanged

    def test_github_run_limit_warns(self) -> None:
        many = tool_log()
        many["runs"] = [copy.deepcopy(many["runs"][0]) for _ in range(fs.GITHUB_MAX_RUNS)]
        conv = self.convert(document([finding()]), [as_tool_log(many)])
        self.assertTrue(any("at most 20 runs" in w for w in conv.warnings))

    def test_load_tool_sarif(self) -> None:
        path = self.dir / "bom.sarif"
        path.write_bytes(b"\xef\xbb\xbf" + json.dumps(tool_log()).encode("utf-8"))
        loaded = fs.load_tool_sarif(path)
        self.assertEqual(loaded.runs, tool_log()["runs"])
        self.assertEqual(loaded.version, "2.1.0")
        not_sarif = self.write("x.sarif", json.dumps({"results": []}))
        with self.assertRaises(fs.InputError):
            fs.load_tool_sarif(not_sarif)
        broken = self.write("y.sarif", "{nope")
        with self.assertRaises(fs.InputError):
            fs.load_tool_sarif(broken)
        with self.assertRaises(fs.InputError):
            fs.load_tool_sarif(self.dir / "absent.sarif")


class SarifProblemsTest(unittest.TestCase):
    def test_detects_structural_problems(self) -> None:
        self.assertEqual(fs.sarif_problems([]), ["the log is not a JSON object"])
        log = {"version": "2.0.0", "runs": [
            {"tool": {"driver": {"name": "harden"}},
             "results": [{"message": {"text": "m"}, "ruleId": "DC-03"}]},
            {"tool": {"driver": {}}, "results": [{"message": {}}]},
        ]}
        problems = fs.sarif_problems(log)
        self.assertIn("version is '2.0.0', expected '2.1.0'", problems)
        self.assertIn("$schema is missing or not an https URL", problems)
        self.assertIn("runs[0].results[0].locations is missing or empty", problems)
        self.assertIn("runs[0].results[0].partialFingerprints is missing", problems)
        self.assertIn("runs[1].tool.driver.name is missing", problems)
        self.assertIn("runs[1].results[0].message has neither text nor id", problems)
        self.assertNotIn("runs[1].results[0].locations is missing or empty", problems)


class CliTest(TempDirTest):
    def run_cli(self, *args: str, isolated: bool = False) -> subprocess.CompletedProcess:
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        cmd = [sys.executable] + (["-S"] if isolated else []) + [str(SCRIPTS / "findings_to_sarif.py")]
        return subprocess.run(cmd + list(args), capture_output=True, env=env, timeout=120,
                              cwd=str(self.dir))

    def setUp(self) -> None:
        super().setUp()
        self.repo = self.dir / "proj"
        self.write("src/a.py", SOURCE, base=self.repo)
        self.findings = self.write("proj/.harden/findings.json", json.dumps(document([finding()])))
        self.tools = self.repo / ".harden" / "tools"
        self.write("proj/.harden/tools/eslint.sarif", json.dumps(tool_log()))
        self.write("proj/.harden/tools/eslint.json", "{}")
        self.out = self.repo / ".harden" / "report.sarif"

    def load_out(self) -> Dict[str, Any]:
        return json.loads(self.out.read_text(encoding="utf-8"))

    def test_writes_sarif_and_defaults_repo_to_harden_parent(self) -> None:
        proc = self.run_cli(str(self.findings), "--tool-sarif", str(self.tools / "eslint.sarif"),
                            "--out", str(self.out))
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8"))
        self.assertIn("1 result(s)", proc.stdout.decode("utf-8"))
        log = self.load_out()
        self.assertEqual(fs.sarif_problems(log), [])
        self.assertEqual(log["runs"][1], tool_log()["runs"][0])
        fp = log["runs"][0]["results"][0]["partialFingerprints"]
        self.assertEqual(fp, {fs.FP_LINE: sha("DC-03\0src/a.py\0return 1")})

    def test_runs_under_python_dash_s(self) -> None:
        proc = self.run_cli(str(self.findings), "--out", str(self.out), "--repo", str(self.repo),
                            isolated=True)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8"))
        self.assertEqual(fs.sarif_problems(self.load_out()), [])

    def test_unexpanded_pattern_is_expanded(self) -> None:
        pattern = (self.tools / "*.sarif").as_posix()
        proc = self.run_cli(str(self.findings), "--tool-sarif", pattern, "--out", str(self.out))
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8"))
        self.assertEqual(len(self.load_out()["runs"]), 2)
        none = self.run_cli(str(self.findings), "--tool-sarif", (self.tools / "*.nothing").as_posix(),
                            "--out", str(self.out))
        self.assertEqual(none.returncode, 0)
        self.assertIn("matched no file", none.stderr.decode("utf-8"))
        self.assertEqual(len(self.load_out()["runs"]), 1)

    def test_repeated_flag_and_duplicate_files(self) -> None:
        eslint = str(self.tools / "eslint.sarif")
        self.write("proj/.harden/tools/ruff.sarif", json.dumps(tool_log(name="ruff")))
        proc = self.run_cli(str(self.findings), "--tool-sarif", eslint, eslint,
                            "--tool-sarif", str(self.tools / "ruff.sarif"), "--out", str(self.out))
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8"))
        names = [r["tool"]["driver"]["name"] for r in self.load_out()["runs"]]
        self.assertEqual(names, ["harden", "eslint", "ruff"])
        self.assertIn("given twice", proc.stderr.decode("utf-8"))

    def test_invalid_findings_exit_1_and_write_nothing(self) -> None:
        bad = self.write("bad.json", json.dumps(document([finding(lens="nope")])))
        proc = self.run_cli(str(bad), "--out", str(self.out))
        self.assertEqual(proc.returncode, 1)
        self.assertIn("lens", proc.stderr.decode("utf-8"))
        self.assertFalse(self.out.exists())
        forced = self.run_cli(str(bad), "--out", str(self.out), "--no-validate")
        self.assertEqual(forced.returncode, 0, forced.stderr.decode("utf-8"))
        self.assertTrue(self.out.exists())

    def test_unreadable_inputs_exit_2(self) -> None:
        broken = self.write("broken.json", "{not json")
        self.assertEqual(self.run_cli(str(broken), "--out", str(self.out)).returncode, 2)
        self.assertEqual(self.run_cli(str(self.dir / "absent.json"), "--out", str(self.out))
                         .returncode, 2)
        missing_tool = self.run_cli(str(self.findings), "--tool-sarif", "nope.sarif",
                                    "--out", str(self.out))
        self.assertEqual(missing_tool.returncode, 2)
        not_sarif = self.run_cli(str(self.findings), "--tool-sarif", str(self.tools / "eslint.json"),
                                 "--out", str(self.out))
        self.assertEqual(not_sarif.returncode, 2)
        self.assertIn("not a SARIF log", not_sarif.stderr.decode("utf-8"))
        self.assertFalse(self.out.exists())

    def test_refuses_to_overwrite_inputs_and_bad_repo(self) -> None:
        same = self.run_cli(str(self.findings), "--out", str(self.findings))
        self.assertEqual(same.returncode, 2)
        self.assertEqual(json.loads(self.findings.read_text(encoding="utf-8"))["version"], 1)
        bad_repo = self.run_cli(str(self.findings), "--out", str(self.out),
                                "--repo", str(self.dir / "nowhere"))
        self.assertEqual(bad_repo.returncode, 2)

    def test_no_repo_uses_title_hash(self) -> None:
        proc = self.run_cli(str(self.findings), "--out", str(self.out), "--no-repo")
        self.assertEqual(proc.returncode, 0)
        fp = self.load_out()["runs"][0]["results"][0]["partialFingerprints"]
        self.assertEqual(list(fp), [fs.FP_TITLE])
        self.assertIn("pass --repo", proc.stderr.decode("utf-8"))


class SarifDeltaCompatibilityTest(TempDirTest):
    """sarif_delta.py must read report.sarif and match harden results across runs."""

    def setUp(self) -> None:
        super().setUp()
        self.repo = self.dir / "repo"
        self.write("src/a.py", SOURCE, base=self.repo)

    def write_report(self, name: str, doc: Dict[str, Any], tool: Dict[str, Any]) -> Path:
        conv = self.convert(doc, [as_tool_log(tool)], repo=self.repo)
        path = self.dir / name
        path.write_text(json.dumps(conv.log), encoding="utf-8")
        return path

    def test_sarif_delta_reads_and_matches_report(self) -> None:
        before = self.write_report("before.sarif",
                                   document([finding(), finding(id="H-002", status="rejected",
                                                                verified=False, line=6)]),
                                   tool_log(line=3))
        # Lines moved by an unrelated edit; H-003 is new; the tool result moved.
        self.write("src/a.py", "import os\n\n" + SOURCE, base=self.repo)
        after = self.write_report("after.sarif",
                                  document([finding(line=4), finding(id="H-002", status="rejected",
                                                                     verified=False, line=8),
                                            finding(id="H-003", line=7, title="Other")]),
                                  tool_log(line=5))
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        proc = subprocess.run([sys.executable, str(SCRIPTS / "sarif_delta.py"), str(before),
                               str(after), "--json"], capture_output=True, env=env, timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stdout.decode("utf-8") + proc.stderr.decode("utf-8"))
        report = json.loads(proc.stdout.decode("utf-8"))
        self.assertTrue(report["valid"], report["warnings"])
        tools = {t["tool"]: t for t in report["tools"]}
        self.assertEqual(set(tools), {"harden", "eslint"})
        self.assertEqual(tools["harden"]["match_basis"], ["fingerprint"])
        self.assertEqual((tools["harden"]["results_before"], tools["harden"]["results_after"]), (2, 3))
        harden_rows = [r for r in report["rules"] if r["tool"] == "harden"]
        self.assertEqual(sum(r["unchanged"] for r in harden_rows), 2)
        self.assertEqual(sum(r["moved"] for r in harden_rows), 2)
        self.assertEqual(sum(r["new"] for r in harden_rows), 1)
        self.assertEqual(sum(r["absent"] for r in harden_rows), 0)
        eslint_rows = [r for r in report["rules"] if r["tool"] == "eslint"]
        self.assertEqual((eslint_rows[0]["unchanged"], eslint_rows[0]["moved"]), (1, 1))

    def test_in_process_parse(self) -> None:
        path = self.write_report("r.sarif", document([finding(status="rejected", verified=False)]),
                                 tool_log())
        side = sd.load_sarif(path)
        self.assertEqual(side.sarif_version, "2.1.0")
        harden = side.tools["harden"]
        self.assertEqual(harden.invocations, 1)
        self.assertEqual(harden.failed_invocations, 0)
        self.assertEqual(harden.error_notifications, [])
        self.assertEqual(harden.unresolved_absolute_uris, 0)
        self.assertEqual(harden.results[0].uri, "src/a.py")
        self.assertEqual(harden.results[0].start_line, 2)
        self.assertTrue(harden.results[0].suppressed)
        self.assertIn(f"partialFingerprints/{fs.FP_LINE}", harden.results[0].fingerprints)


if __name__ == "__main__":
    unittest.main()
