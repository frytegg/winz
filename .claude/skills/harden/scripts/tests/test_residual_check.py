"""Tests for scripts/residual_check.py (run: python -m unittest discover -s scripts/tests -p "test_residual_check.py")."""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Tuple

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import ledger as lg  # noqa: E402
import residual_check as RC  # noqa: E402

HAS_GIT = shutil.which("git") is not None
HASH = hashlib.sha256(b"prompt").hexdigest()
HEADER = ("| Module | Design | Trust boundaries and authorisation | Concurrency | Data integrity | "
          "Error handling | Tests |\n|---|---|---|---|---|---|---|\n")


def _git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c",
                    "commit.gpgsign=false", *args], cwd=str(repo), check=True,
                   capture_output=True)


@unittest.skipUnless(HAS_GIT, "git is needed")
class ResidualCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name) / "repo"
        (self.repo / "src" / "http").mkdir(parents=True)
        (self.repo / "src" / "http" / "client.py").write_text(
            "def get(url):\n    return url\n", encoding="utf-8")
        (self.repo / "src" / "cli.py").write_text("def main():\n    return 0\n",
                                                  encoding="utf-8")
        _git(self.repo, "init", "-q")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "init")
        self.lg("init")
        self.tools = self.repo / ".harden" / "tools"
        (self.tools / "complexity.json").write_text(
            json.dumps({"files": [{"path": "src/http/client.py"}]}), encoding="utf-8")
        (self.repo / ".harden" / "findings.json").write_text(json.dumps({"findings": [
            {"id": "C1", "file": "src/http/client.py", "line": 1},
            {"id": "C2", "file": "src/cli.py", "line": 1}]}), encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def lg(self, *args: str) -> None:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = lg.main(list(args) + ["--repo", str(self.repo)])
        self.assertEqual(code, 0, err.getvalue())

    def read(self, lens: str, number: int, *files: str) -> None:
        self.lg("record", "--lens", lens, "--pass", str(number), "--model", "m-1", "--effort",
                "high", "--prompt-hash", HASH, "--classes", "c1", "--candidates", "0",
                "--files", *files)

    def write(self, cells: Dict[str, Dict[str, Any]], table_row: str,
              limits: str = "(a) eslint did not run. (b) src/http not examined.") -> None:
        base = {row: {"state": "not-examined"} for row in RC.ROWS}
        base.update(cells)
        (self.tools / "residual.json").write_text(json.dumps(
            {"version": 1, "modules": [{"module": "src/http/", "cells": base}]}),
            encoding="utf-8")
        (self.repo / ".harden" / "report.md").write_text(
            "# Report\n\n## Limits\n\n{}\n\n## Residual risk\n\n{}{}\n\n## Appendix\n"
            .format(limits, HEADER, table_row), encoding="utf-8")

    def run_check(self) -> Tuple[int, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = RC.main(["--repo", str(self.repo)])
        return code, out.getvalue() + err.getvalue()

    def row(self, *cells: str) -> str:
        cells_list = list(cells) + ["not examined"] * (6 - len(cells))
        return "| src/http/ | " + " | ".join(cells_list) + " |"

    def checked(self, lens: str = "complexity-design",
                output: str = ".harden/tools/complexity.json") -> Dict[str, Any]:
        return {"state": "checked", "lenses": [lens],
                "measured_by": [{"tool": "complexity.py (heuristic)", "output": output}]}

    def test_checked_with_reading_and_measurement_passes(self) -> None:
        self.read("complexity-design", 1, "src/http/client.py")
        self.write({"design": self.checked(), "trust": {"state": "findings", "ids": ["C1"]}},
                   self.row("checked (complexity.py (heuristic)): no issue",
                            "findings: C1 (timeout)"))
        code, text = self.run_check()
        self.assertEqual(code, 0, text)

    def test_pilot_shape_checked_without_measurement_fails(self) -> None:
        self.read("concurrency", 1, "src/http/client.py")
        self.write({"concurrency": {"state": "checked", "lenses": ["concurrency"],
                                    "measured_by": []}},
                   self.row("not examined", "not examined", "checked (): no issue"))
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("checked needs the detector or metric that ran", text)

    def test_bare_checked_no_issue_text_is_refused(self) -> None:
        self.read("complexity-design", 1, "src/http/client.py")
        self.write({"design": self.checked()}, self.row("checked: no issue"))
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("the table says 'checked: no issue'", text)

    def test_unread_lines_and_foreign_lens_fail(self) -> None:
        self.write({"design": self.checked()},
                   self.row("checked (complexity.py (heuristic)): no issue"))
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("unread", text)
        self.read("security", 1, "src/http/client.py")
        self.write({"design": self.checked(lens="security")},
                   self.row("checked (complexity.py (heuristic)): no issue"))
        code, text = self.run_check()
        self.assertIn("lens security does not back this row", text)

    def test_measurement_that_names_no_module_file_fails(self) -> None:
        self.read("complexity-design", 1, "src/http/client.py")
        (self.tools / "other.json").write_text('{"files": ["src/cli.py"]}', encoding="utf-8")
        self.write({"design": self.checked(output=".harden/tools/other.json")},
                   self.row("checked (complexity.py (heuristic)): no issue"))
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("names no file of the module", text)

    def test_findings_outside_the_module_and_unknown_ids_fail(self) -> None:
        self.write({"trust": {"state": "findings", "ids": ["C2"]},
                    "data": {"state": "findings", "ids": ["C9"]}},
                   self.row("not examined", "findings: C2", "not examined", "findings: C9"))
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("none of C2 sits in the module", text)
        self.assertIn("C9 not in findings.json", text)

    def test_not_measured_and_not_examined_need_limits(self) -> None:
        self.write({"concurrency": {"state": "not-measured", "lenses": ["concurrency"],
                                    "missing": "semgrep (not installed)"}},
                   self.row("not examined", "not examined",
                            "read, not measured (semgrep (not installed) did not run)"),
                   limits="(a) nothing else.")
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("semgrep is not named in Limits", text)
        self.assertIn("a not-examined module must appear in Limits", text)

    def test_table_and_residual_json_must_list_the_same_modules(self) -> None:
        self.write({}, self.row() + "\n| src/cli.py | not examined | not examined | not examined"
                   " | not examined | not examined | not examined |")
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("src/cli.py: in the report's table but not in residual.json", text)

    def test_missing_inputs_are_usage_errors(self) -> None:
        self.assertEqual(self.run_check()[0], 2)
        self.write({}, self.row())
        (self.repo / ".harden" / "report.md").write_text("# no table\n", encoding="utf-8")
        self.assertEqual(self.run_check()[0], 2)


@unittest.skipUnless(HAS_GIT, "git is needed")
class OpenFindingTests(unittest.TestCase):
    """pilot-auto-calibration A01-F58: a cell whose module holds an unrejected finding of its
    row reads "findings" and lists every such id; --draft builds the cells."""

    setUp = ResidualCheckTests.setUp
    tearDown = ResidualCheckTests.tearDown
    lg = ResidualCheckTests.lg
    read = ResidualCheckTests.read
    write = ResidualCheckTests.write
    run_check = ResidualCheckTests.run_check
    row = ResidualCheckTests.row
    checked = ResidualCheckTests.checked

    def add_findings(self, *extra: Dict[str, Any]) -> None:
        doc = json.loads((self.repo / ".harden" / "findings.json").read_text(encoding="utf-8"))
        doc["findings"].extend(extra)
        (self.repo / ".harden" / "findings.json").write_text(json.dumps(doc), encoding="utf-8")

    def draft(self, *args: str) -> Tuple[int, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = RC.main(["--draft", "--repo", str(self.repo), *args])
        return code, out.getvalue() + err.getvalue()

    def residual(self) -> Dict[str, Any]:
        return json.loads((self.tools / "residual.json").read_text(encoding="utf-8"))

    def test_checked_cell_with_a_deferred_finding_of_its_row_fails(self) -> None:
        self.add_findings({"id": "C3", "lens": "complexity-design", "status": "deferred",
                           "file": "src/http/client.py", "line": 1})
        self.read("complexity-design", 1, "src/http/client.py")
        self.write({"design": self.checked()},
                   self.row("checked (complexity.py (heuristic)): no issue"))
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("C3 (deferred)", text)
        self.assertIn('must read "findings: C3"', text)

    def test_findings_cell_must_list_every_open_finding_of_its_row(self) -> None:
        self.add_findings({"id": "C4", "lens": "security", "status": "reported",
                           "file": "src/http/client.py", "line": 1})
        self.write({"trust": {"state": "findings", "ids": ["C1"]}},
                   self.row("not examined", "findings: C1"))
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("findings omits C4 (reported)", text)

    def test_rejected_and_other_row_findings_do_not_block_checked(self) -> None:
        self.add_findings({"id": "C5", "lens": "complexity-design", "status": "rejected",
                           "file": "src/http/client.py", "line": 1},
                          {"id": "C6", "lens": "security", "status": "deferred",
                           "file": "src/http/client.py", "line": 1})
        self.read("complexity-design", 1, "src/http/client.py")
        self.write({"design": self.checked(), "trust": {"state": "findings", "ids": ["C6"]}},
                   self.row("checked (complexity.py (heuristic)): no issue", "findings: C6"))
        code, text = self.run_check()
        self.assertEqual(code, 0, text)

    def test_not_measured_and_not_examined_with_open_finding_fail(self) -> None:
        self.add_findings({"id": "C7", "lens": "concurrency", "status": "deferred",
                           "file": "src/http/client.py", "line": 1},
                          {"id": "C8", "lens": "data", "status": "applied",
                           "file": "src/http/client.py", "line": 1})
        self.write({"concurrency": {"state": "not-measured", "lenses": ["concurrency"],
                                    "missing": "eslint (not installed)"}},
                   self.row("not examined", "not examined",
                            "read, not measured (eslint (not installed) did not run)"))
        code, text = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn("C7 (deferred)", text)
        self.assertIn("C8 (applied)", text)

    def test_draft_pilot_shape_writes_findings_cell_for_deferred(self) -> None:
        self.add_findings({"id": "H-049", "lens": "complexity-design", "status": "deferred",
                           "file": "src/cli.py", "line": 1})
        (self.tools / "complexity.json").write_text(
            json.dumps({"files": [{"path": "src/cli.py"}]}), encoding="utf-8")
        self.read("complexity-design", 1, "src/cli.py")
        code, text = self.draft(
            "--module", "src/cli.py",
            "--measured", "design=complexity.py heuristic@.harden/tools/complexity.json",
            "--missing", "trust=semgrep", "--missing", "concurrency=eslint",
            "--missing", "data=semgrep", "--missing", "errors=eslint", "--missing",
            "tests=stryker")
        self.assertEqual(code, 0, text)
        cells = self.residual()["modules"][0]["cells"]
        self.assertEqual((cells["design"]["state"], cells["design"]["ids"]),
                         ("findings", ["H-049"]))
        table = (self.tools / "residual-table.md").read_text(encoding="utf-8")
        self.assertIn("findings: H-049 (deferred: H-049)", table)
        (self.repo / ".harden" / "report.md").write_text(
            "# Report\n\n## Limits\n\n(a) semgrep, eslint and stryker did not run. (b) "
            "src/cli.py not examined for the other rows.\n\n## Residual risk\n\n" + table +
            "\n## Appendix\n", encoding="utf-8")
        code, text = self.run_check()
        self.assertEqual(code, 0, text)

    def test_draft_checked_only_with_measurement_and_full_read(self) -> None:
        self.read("complexity-design", 1, "src/http/client.py")
        self.read("security", 1, "src/http/client.py")
        code, text = self.draft("--module", "src/http/",
                                "--measured",
                                "design=complexity.py heuristic@.harden/tools/complexity.json",
                                "--missing", "trust=semgrep")
        self.assertEqual(code, 0, text)
        cells = self.residual()["modules"][0]["cells"]
        self.assertEqual(cells["design"]["state"], "checked")
        self.assertEqual(cells["trust"], {"state": "not-measured", "lenses": ["security"],
                                          "missing": "semgrep"})
        self.assertEqual(cells["data"]["state"], "not-examined")

    def test_draft_asks_for_missing_rows_and_writes_nothing(self) -> None:
        self.read("security", 1, "src/http/client.py")
        (self.tools / "residual.json").write_text('{"version": 1, "modules": []}',
                                                  encoding="utf-8")
        before = (self.tools / "residual.json").read_bytes()
        code, text = self.draft("--module", "src/http/")
        self.assertEqual(code, 2)
        self.assertIn("--missing needed for rows trust", text)
        self.assertEqual((self.tools / "residual.json").read_bytes(), before)

    def test_draft_default_modules_from_rank(self) -> None:
        (self.repo / "src" / "http" / "retry.py").write_text("def retry():\n    return 1\n",
                                                             encoding="utf-8")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "retry")
        self.lg("init", "--force")
        (self.repo / ".harden" / "rank.json").write_text(json.dumps({"files": [
            {"path": "src/cli.py", "rank": 2}, {"path": "src/http/client.py", "rank": 1},
            {"path": "src/http/retry.py", "rank": None}]}), encoding="utf-8")
        code, text = self.draft()
        self.assertEqual(code, 0, text)
        self.assertEqual([m["module"] for m in self.residual()["modules"]],
                         ["src/http/", "src/cli.py"])

    def test_draft_table_header_matches_check_columns(self) -> None:
        code, text = self.draft("--module", "src/cli.py")
        self.assertEqual(code, 0, text)
        first = (self.tools / "residual-table.md").read_text(encoding="utf-8").splitlines()[0]
        self.assertEqual(first, "| " + " | ".join(RC.COLUMNS) + " |")

    def test_draft_refuses_unknown_row(self) -> None:
        self.assertEqual(self.draft("--module", "src/cli.py", "--measured", "foo=x@y")[0], 2)

    def test_draft_prints_needed_limits_lines(self) -> None:
        self.read("security", 1, "src/http/client.py")
        (self.repo / ".harden" / "report.md").write_text("# R\n\n## Limits\n\n(a) none.\n",
                                                         encoding="utf-8")
        code, text = self.draft("--module", "src/http/", "--missing", "trust=semgrep")
        self.assertEqual(code, 0, text)
        self.assertIn("Limits needs: src/http/ not examined", text)
        self.assertIn("Limits needs: semgrep (did not run)", text)


if __name__ == "__main__":
    unittest.main()
