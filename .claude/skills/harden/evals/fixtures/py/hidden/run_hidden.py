#!/usr/bin/env python3
"""Run the hidden behaviour tests of the ``py`` fixture against a repo.

Usage::

    python run_hidden.py <path-to-repo-or-repo-copy>

The target is never modified: it is copied to a temporary directory, the hidden
tests are copied into ``<copy>/hidden_tests/`` and pytest runs there with only
those tests selected. A JSON summary is printed on stdout::

    {"passed": N, "failed": N, "errors": N, "skipped": N, "failed_tests": [...], ...}

Exit status is 0 only when at least one test ran and none failed or errored.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
HIDDEN_TESTS = HERE / "tests"
IGNORE = shutil.ignore_patterns(
    ".git", "__pycache__", ".pytest_cache", ".ruff_cache", ".mypy_cache", ".venv", "venv",
    "*.egg-info", "build", "dist",
)
TIMEOUT_S = 900


def _summarise(report: Path, proc: subprocess.CompletedProcess[str]) -> dict[str, object]:
    summary: dict[str, object] = {
        "passed": 0,
        "failed": 0,
        "errors": 0,
        "skipped": 0,
        "failed_tests": [],
        "pytest_returncode": proc.returncode,
    }
    if not report.is_file():
        summary["errors"] = 1
        summary["failed_tests"] = ["<pytest produced no report>"]
        summary["output_tail"] = (proc.stdout + proc.stderr)[-4000:]
        return summary

    root = ET.parse(report).getroot()
    suites = [root] if root.tag == "testsuite" else list(root.iter("testsuite"))
    failed_tests: list[str] = []
    passed = failed = errors = skipped = 0
    for suite in suites:
        for case in suite.iter("testcase"):
            name = f"{case.get('classname', '')}::{case.get('name', '')}"
            if case.find("failure") is not None:
                failed += 1
                failed_tests.append(name)
            elif case.find("error") is not None:
                errors += 1
                failed_tests.append(name)
            elif case.find("skipped") is not None:
                skipped += 1
            else:
                passed += 1
        # Collection errors are reported as suite-level errors without a testcase.
    suite_errors = sum(int(s.get("errors", 0)) for s in suites)
    if suite_errors > errors:
        errors = suite_errors
    summary.update(
        passed=passed, failed=failed, errors=errors, skipped=skipped, failed_tests=failed_tests
    )
    if failed or errors or proc.returncode not in (0, 1):
        summary["output_tail"] = (proc.stdout + proc.stderr)[-4000:]
    return summary


def run(target: Path) -> dict[str, object]:
    if not (target / "src" / "tradelog").is_dir():
        raise SystemExit(f"{target} does not look like the tradelog fixture repo (no src/tradelog)")
    with tempfile.TemporaryDirectory(prefix="tradelog-hidden-") as tmp:
        work = Path(tmp) / "repo"
        shutil.copytree(target, work, ignore=IGNORE)
        dest = work / "hidden_tests"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(HIDDEN_TESTS, dest, ignore=shutil.ignore_patterns("__pycache__"))
        report = Path(tmp) / "report.xml"
        env = dict(os.environ)
        env["PYTHONPATH"] = str(work / "src") + os.pathsep + env.get("PYTHONPATH", "")
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        cmd = [
            sys.executable, "-m", "pytest", "hidden_tests",
            "-q", "-p", "no:cacheprovider", "-o", "addopts=",
            "--rootdir", str(work), f"--junitxml={report}",
        ]
        proc = subprocess.run(
            cmd, cwd=work, env=env, capture_output=True, text=True, timeout=TIMEOUT_S
        )
        return _summarise(report, proc)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    summary = run(Path(argv[1]).resolve())
    print(json.dumps(summary, indent=2))
    ok = summary["passed"] > 0 and summary["failed"] == 0 and summary["errors"] == 0
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
