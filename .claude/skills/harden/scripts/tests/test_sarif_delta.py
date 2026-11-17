"""Tests for scripts/sarif_delta.py (run: python -m unittest discover -s scripts/tests)."""
from __future__ import annotations

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

import sarif_delta as sd  # noqa: E402

HAS_GIT = shutil.which("git") is not None


def res(rule: str, uri: str, line: int, message: str = "msg", snippet: Optional[str] = None,
        pfp: Optional[Dict[str, str]] = None, suppressed: bool = False,
        base_id: Optional[str] = None, kind: Optional[str] = None) -> Dict[str, Any]:
    region: Dict[str, Any] = {"startLine": line}
    if snippet is not None:
        region["snippet"] = {"text": snippet}
    art: Dict[str, Any] = {"uri": uri}
    if base_id:
        art["uriBaseId"] = base_id
    r: Dict[str, Any] = {
        "ruleId": rule,
        "message": {"text": message},
        "locations": [{"physicalLocation": {"artifactLocation": art, "region": region}}],
    }
    if pfp is not None:
        r["partialFingerprints"] = pfp
    if suppressed:
        r["suppressions"] = [{"kind": "inSource", "justification": "reviewed"}]
    if kind:
        r["kind"] = kind
    return r


def sarif(results: List[Dict[str, Any]], tool: str = "eslint", version: str = "9.12.0",
          rules: Optional[List[Dict[str, Any]]] = None, success: Optional[bool] = True,
          extensions: Optional[List[Dict[str, Any]]] = None,
          bases: Optional[Dict[str, Any]] = None, sarif_version: str = "2.1.0") -> Dict[str, Any]:
    driver: Dict[str, Any] = {"name": tool, "version": version}
    if rules is not None:
        driver["rules"] = rules
    run: Dict[str, Any] = {"tool": {"driver": driver}, "results": results}
    if extensions is not None:
        run["tool"]["extensions"] = extensions
    if success is not None:
        run["invocations"] = [{"executionSuccessful": success}]
    if bases is not None:
        run["originalUriBaseIds"] = bases
    return {"version": sarif_version, "runs": [run]}


def delta(before: Dict[str, Any], after: Dict[str, Any], before_root: Optional[str] = None,
          after_root: Optional[str] = None) -> sd.DeltaReport:
    b = sd.parse_sarif(before, "before.sarif", [before_root] if before_root else [])
    a = sd.parse_sarif(after, "after.sarif", [after_root] if after_root else [])
    return sd.compute_delta(b, a)


def rule_row(report: sd.DeltaReport, rule: str) -> Dict[str, Any]:
    for r in report.rules:
        if r.rule == rule:
            return r.to_dict()
    raise AssertionError(f"rule {rule} not in delta")


class FingerprintMatchingTest(unittest.TestCase):
    def test_moved_line_matches_by_fingerprint(self) -> None:
        before = sarif([res("no-unused-vars", "src/a.ts", 10, pfp={"primaryLocationLineHash": "aaa:1"}),
                        res("no-unused-vars", "src/a.ts", 20, pfp={"primaryLocationLineHash": "bbb:1"})])
        after = sarif([res("no-unused-vars", "src/a.ts", 15, pfp={"primaryLocationLineHash": "aaa:1"}),
                       res("no-unused-vars", "src/a.ts", 30, pfp={"primaryLocationLineHash": "ccc:1"})])
        report = delta(before, after)
        row = rule_row(report, "no-unused-vars")
        self.assertEqual((row["new"], row["absent"], row["unchanged"], row["moved"]), (1, 1, 1, 1))
        self.assertTrue(row["basis"].startswith("fingerprint(partialFingerprints/primaryLocationLineHash"))
        self.assertTrue(report.valid, report.warnings)
        self.assertEqual(row["new_results"][0]["line"], 30)
        self.assertEqual(row["absent_results"][0]["line"], 20)

    def test_equal_counts_do_not_cancel_out(self) -> None:
        before = sarif([res("r", "a.ts", 1, pfp={"h": "x"}), res("r", "a.ts", 2, pfp={"h": "y"})])
        after = sarif([res("r", "a.ts", 1, pfp={"h": "x"}), res("r", "a.ts", 5, pfp={"h": "z"})])
        totals = delta(before, after).totals()
        self.assertEqual((totals["new"], totals["absent"], totals["unchanged"]), (1, 1, 1))

    def test_same_fingerprint_in_another_file_is_a_different_result(self) -> None:
        before = sarif([res("r", "a.ts", 1, pfp={"h": "x"})])
        after = sarif([res("r", "b.ts", 1, pfp={"h": "x"})])
        totals = delta(before, after).totals()
        self.assertEqual((totals["new"], totals["absent"]), (1, 1))

    def test_full_fingerprints_preferred_and_location_independent(self) -> None:
        b = res("r", "old/a.ts", 3, pfp={"h": "1"})
        b["fingerprints"] = {"stable/v1": "F1"}
        a = res("r", "new/a.ts", 9, pfp={"h": "2"})
        a["fingerprints"] = {"stable/v1": "F1"}
        row = rule_row(delta(sarif([b]), sarif([a])), "r")
        self.assertEqual(row["unchanged"], 1)
        self.assertEqual(row["basis"], "fingerprint(fingerprints/stable/v1)")

    def test_missing_fingerprint_falls_back_to_snippet(self) -> None:
        before = sarif([res("r", "a.ts", 3, snippet="let x = 1;", pfp={"h": "x"})])
        after = sarif([res("r", "a.ts", 8, snippet="let x = 1;")])
        row = rule_row(delta(before, after), "r")
        self.assertEqual(row["basis"], "snippet")
        self.assertEqual((row["unchanged"], row["moved"]), (1, 1))


class ContentMatchingTest(unittest.TestCase):
    def test_snippet_whitespace_is_normalised(self) -> None:
        before = sarif([res("r", "src/a.py", 4, snippet="    x = eval(s)  ")])
        after = sarif([res("r", "src/a.py", 12, snippet="        x = eval(s)")])
        row = rule_row(delta(before, after), "r")
        self.assertEqual((row["unchanged"], row["moved"], row["new"], row["absent"]), (1, 1, 0, 0))

    def test_changed_snippet_is_new_and_absent(self) -> None:
        before = sarif([res("r", "src/a.py", 4, snippet="x = eval(s)")])
        after = sarif([res("r", "src/a.py", 4, snippet="x = eval(t)")])
        row = rule_row(delta(before, after), "r")
        self.assertEqual((row["new"], row["absent"], row["unchanged"]), (1, 1, 0))

    def test_message_basis_and_count_matched_note(self) -> None:
        before = sarif([res("any", "a.ts", 1, "Unexpected any"), res("any", "a.ts", 9, "Unexpected any")])
        after = sarif([res("any", "a.ts", 4, "Unexpected any")])
        report = delta(before, after)
        row = rule_row(report, "any")
        self.assertEqual(row["basis"], "message")
        self.assertEqual((row["unchanged"], row["absent"], row["new"]), (1, 1, 0))
        self.assertEqual(row["count_matched_keys"], 1)
        self.assertTrue(any("matched by count" in n for n in report.notes))

    def test_message_placeholders_are_expanded(self) -> None:
        r1 = res("r", "a.ts", 1)
        r1["message"] = {"id": "default", "arguments": ["foo"]}
        rules = [{"id": "r", "messageStrings": {"default": {"text": "'{0}' is unused"}}}]
        side = sd.parse_sarif(sarif([r1], rules=rules), "x.sarif")
        self.assertEqual(side.tools["eslint"].results[0].message, "'foo' is unused")

    def test_pass_results_are_ignored(self) -> None:
        before = sarif([res("r", "a.ts", 1, kind="pass")])
        after = sarif([])
        self.assertEqual(delta(before, after).totals()["absent"], 0)


class ComparabilityTest(unittest.TestCase):
    def test_tool_version_mismatch_warns(self) -> None:
        report = delta(sarif([], version="9.11.0"), sarif([], version="9.12.0"))
        self.assertFalse(report.valid)
        self.assertTrue(any("tool version differs" in w for w in report.warnings))

    def test_identical_tool_is_valid(self) -> None:
        self.assertTrue(delta(sarif([]), sarif([])).valid)

    def test_rule_configuration_change_warns(self) -> None:
        rb = [{"id": "complexity", "defaultConfiguration": {"level": "warning",
                                                             "parameters": {"max": 10}}}]
        ra = [{"id": "complexity", "defaultConfiguration": {"level": "warning",
                                                             "parameters": {"max": 20}}}]
        report = delta(sarif([], rules=rb), sarif([], rules=ra))
        self.assertTrue(any("defaultConfiguration differs" in w for w in report.warnings))

    def test_extension_version_change_warns(self) -> None:
        eb = [{"name": "eslint-plugin-react", "version": "7.33.0"}]
        ea = [{"name": "eslint-plugin-react", "version": "7.35.0"}]
        report = delta(sarif([], extensions=eb), sarif([], extensions=ea))
        self.assertTrue(any("eslint-plugin-react" in w for w in report.warnings))

    def test_failed_invocation_warns(self) -> None:
        report = delta(sarif([]), sarif([], success=False))
        self.assertTrue(any("executionSuccessful=false" in w for w in report.warnings))

    def test_tool_missing_from_one_side_is_not_compared(self) -> None:
        before = sarif([res("r", "a.py", 1)], tool="semgrep")
        after = sarif([], tool="eslint")
        report = delta(before, after)
        self.assertFalse(report.valid)
        self.assertEqual(report.totals()["absent"], 0)
        self.assertEqual({x["tool"] for x in report.not_compared}, {"semgrep", "eslint"})

    def test_sarif_version_mismatch_warns(self) -> None:
        report = delta(sarif([], sarif_version="2.0.0"), sarif([]))
        self.assertTrue(any("SARIF version" in w for w in report.warnings))


class SuppressionAndUriTest(unittest.TestCase):
    def test_now_suppressed_is_not_absent(self) -> None:
        before = sarif([res("r", "a.ts", 1, pfp={"h": "x"})])
        after = sarif([res("r", "a.ts", 1, pfp={"h": "x"}, suppressed=True)])
        row = rule_row(delta(before, after), "r")
        self.assertEqual((row["absent"], row["unchanged"], row["unchanged_now_suppressed"]), (0, 1, 1))

    def test_rejected_suppression_is_not_suppressed(self) -> None:
        r = res("r", "a.ts", 1)
        r["suppressions"] = [{"kind": "external", "status": "rejected"}]
        side = sd.parse_sarif(sarif([r]), "x.sarif")
        self.assertFalse(side.tools["eslint"].results[0].suppressed)

    def test_absolute_uri_made_relative_with_root(self) -> None:
        before = sarif([res("r", "file:///C:/work/repo/src/a.ts", 1, snippet="x")])
        after = sarif([res("r", "src/a.ts", 7, snippet="x", base_id="%SRCROOT%")],
                      bases={"%SRCROOT%": {"uri": "file:///D:/clone/"}})
        report = delta(before, after, before_root="C:\\work\\repo")
        self.assertEqual(report.totals()["unchanged"], 1, report.to_dict())
        self.assertTrue(report.valid, report.warnings)

    def test_absolute_uri_resolved_through_base_ids(self) -> None:
        bases = {"SRCROOT": {"uri": "file:///home/u/repo/"}}
        side = sd.parse_sarif(sarif([res("r", "file:///home/u/repo/lib/x.py", 1)], bases=bases),
                              "x.sarif")
        self.assertEqual(side.tools["eslint"].results[0].uri, "lib/x.py")

    def test_nested_base_ids_resolve_to_repo_relative_paths(self) -> None:
        bases = {"%SRCROOT%": {"uri": "file:///repo/"},
                 "PKG": {"uri": "pkg/", "uriBaseId": "%SRCROOT%"},
                 "LOOSE": {"uri": "lib/"}}
        side = sd.parse_sarif(sarif([res("r", "a.ts", 1, base_id="PKG"),
                                     res("r", "b.ts", 1, base_id="LOOSE"),
                                     res("r", "c.ts", 1, base_id="UNKNOWN")], bases=bases),
                              "x.sarif")
        self.assertEqual([r.uri for r in side.tools["eslint"].results],
                         ["pkg/a.ts", "lib/b.ts", "c.ts"])

    def test_artifact_index_is_resolved(self) -> None:
        doc = sarif([res("r", "ignored", 1)])
        loc = doc["runs"][0]["results"][0]["locations"][0]["physicalLocation"]
        loc["artifactLocation"] = {"index": 0}
        doc["runs"][0]["artifacts"] = [{"location": {"uri": "src/z.ts"}}]
        side = sd.parse_sarif(doc, "x.sarif")
        self.assertEqual(side.tools["eslint"].results[0].uri, "src/z.ts")

    def test_unresolved_absolute_uri_warns(self) -> None:
        report = delta(sarif([res("r", "file:///C:/elsewhere/a.ts", 1)]), sarif([]))
        self.assertTrue(any("absolute URIs" in w for w in report.warnings))


class CliTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write(self, name: str, data: Any) -> Path:
        path = self.dir / name
        text = data if isinstance(data, str) else json.dumps(data)
        path.write_text(text, encoding="utf-8")
        return path

    def run_cli(self, *args: str, cwd: Optional[Path] = None) -> subprocess.CompletedProcess:
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        return subprocess.run([sys.executable, str(SCRIPTS / "sarif_delta.py"), *args],
                              capture_output=True, env=env, timeout=120, cwd=cwd)

    def test_exit_codes_and_json(self) -> None:
        b = self.write("b.sarif", sarif([res("r", "a.ts", 1, pfp={"h": "x"})]))
        a_same = self.write("a.sarif", sarif([res("r", "a.ts", 2, pfp={"h": "x"})]))
        a_new_version = self.write("a2.sarif", sarif([], version="10.0.0"))
        ok = self.run_cli(str(b), str(a_same), "--json")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        out = json.loads(ok.stdout.decode("utf-8"))
        self.assertTrue(out["valid"])
        self.assertEqual(out["totals"]["unchanged"], 1)
        self.assertEqual(self.run_cli(str(b), str(a_new_version)).returncode, 1)
        text = self.run_cli(str(b), str(a_new_version)).stdout.decode("utf-8")
        self.assertIn("NOT VALID", text)

    def test_unreadable_inputs(self) -> None:
        b = self.write("b.sarif", sarif([]))
        broken = self.write("broken.sarif", "{oops")
        not_sarif = self.write("x.json", {"hello": 1})
        self.assertEqual(self.run_cli(str(b), str(broken)).returncode, 2)
        self.assertEqual(self.run_cli(str(b), str(not_sarif)).returncode, 2)
        self.assertEqual(self.run_cli(str(b), str(self.dir / "missing.sarif")).returncode, 2)

    @unittest.skipUnless(HAS_GIT, "git is not installed")
    def test_config_hash_comparison(self) -> None:
        repo = self.dir / "repo"
        repo.mkdir()
        hooks = self.dir / "nohooks"
        hooks.mkdir()
        (repo / ".eslintrc.json").write_text('{"rules": {"complexity": ["warn", 10]}}\n',
                                            encoding="utf-8")

        def git(*args: str) -> str:
            proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, check=True)
            return proc.stdout.decode("utf-8").strip()

        git("init", "-q")
        git("add", "-A")
        git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false",
            "-c", f"core.hooksPath={hooks.as_posix()}", "commit", "-q", "-m", "init")
        base = git("rev-parse", "HEAD")
        b = self.write("b.sarif", sarif([]))
        a = self.write("a.sarif", sarif([]))
        same = self.run_cli(str(b), str(a), "--repo", str(repo), "--base", base,
                            "--config", ".eslintrc.json", "--json")
        self.assertEqual(same.returncode, 0, same.stdout)
        (repo / ".eslintrc.json").write_text('{"rules": {"complexity": ["warn", 30]}}\n',
                                            encoding="utf-8")
        changed = self.run_cli(str(b), str(a), "--repo", str(repo), "--base", base,
                               "--config", "./.eslintrc.json", "--json")
        self.assertEqual(changed.returncode, 1)
        out = json.loads(changed.stdout.decode("utf-8"))
        self.assertTrue(any("differs" in w for w in out["warnings"]))
        self.assertEqual(out["configs"][0]["config"], ".eslintrc.json")


if __name__ == "__main__":
    unittest.main()
