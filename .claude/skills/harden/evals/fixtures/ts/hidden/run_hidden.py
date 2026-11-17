#!/usr/bin/env python3
"""Run the hidden behaviour tests of the TypeScript fixture against a repo.

Usage:
    python run_hidden.py <path-to-repo-copy>

The target repo is never modified. It is copied (without node_modules, .git,
dist, coverage and .pricewatch) into a fresh temporary directory, the hidden
tests are dropped into tests/hidden/ of that copy, dependencies are installed
with pnpm (offline-first), and vitest runs only the hidden tests through a
dedicated config. A JSON summary is printed on stdout:

    {"passed": <int>, "failed": <int>, "errors": <int>, "total": <int>, "failures": [...]}

"errors" counts test files that could not be collected (import or syntax
errors), unhandled errors reported by vitest, and infrastructure failures
(copy, install, runner crash). Exit status is 0 only when every hidden test
passed and there were no errors.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
HIDDEN_TESTS = HERE / "tests"
EXCLUDED = ("node_modules", ".git", "dist", "coverage", ".pricewatch")
INSTALL_TIMEOUT_S = 600
TEST_TIMEOUT_S = 600

VITEST_CONFIG = """\
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/hidden/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    env: { PRICEWATCH_LOG_LEVEL: 'error' },
  },
});
"""


def emit(summary: dict[str, Any], ok: bool) -> None:
    print(json.dumps(summary))
    sys.exit(0 if ok else 1)


def infra_failure(message: str, detail: str = "") -> None:
    if detail:
        sys.stderr.write(detail[-8000:] + "\n")
    emit({"passed": 0, "failed": 0, "errors": 1, "total": 0, "failures": [message]}, ok=False)


def find_pnpm() -> str:
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        infra_failure("pnpm not found on PATH")
        raise SystemExit(1)  # unreachable, keeps type checkers happy
    return pnpm


def run(cmd: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def install(pnpm: str, repo: Path) -> None:
    attempts = [
        [pnpm, "install", "--frozen-lockfile", "--prefer-offline"],
        # The repo under test may have edited package.json (e.g. removed a
        # dependency) without refreshing the lockfile; fall back to a normal install.
        [pnpm, "install", "--no-frozen-lockfile", "--prefer-offline"],
    ]
    logs: list[str] = []
    for cmd in attempts:
        proc = run(cmd, repo, INSTALL_TIMEOUT_S)
        logs.append(f"$ {' '.join(cmd[1:])}\n{proc.stdout}\n{proc.stderr}")
        if proc.returncode == 0:
            return
    infra_failure("pnpm install failed in the repo copy", "\n".join(logs))


def summarize(report_path: Path, proc: subprocess.CompletedProcess[str]) -> tuple[dict[str, Any], bool]:
    if not report_path.is_file():
        infra_failure("vitest produced no JSON report", proc.stdout + "\n" + proc.stderr)
    report = json.loads(report_path.read_text(encoding="utf-8"))

    passed = int(report.get("numPassedTests", 0))
    failed = int(report.get("numFailedTests", 0))
    total = int(report.get("numTotalTests", 0))
    failures: list[str] = []
    collection_errors = 0

    for file_result in report.get("testResults", []):
        assertions = file_result.get("assertionResults", [])
        name = Path(file_result.get("name", "?")).name
        failed_assertions = [a for a in assertions if a.get("status") == "failed"]
        for a in failed_assertions:
            failures.append(f"{name} > {a.get('fullName') or a.get('title')}")
        if file_result.get("status") == "failed" and not failed_assertions:
            collection_errors += 1
            message = (file_result.get("message") or "").strip().splitlines()
            failures.append(f"{name}: could not run ({message[0] if message else 'no message'})")

    errors = collection_errors
    # success=false with no failed test and no broken file means vitest saw
    # unhandled errors (e.g. an unhandled rejection) during the run.
    if not report.get("success", False) and failed == 0 and collection_errors == 0:
        errors += 1
        failures.append("vitest reported unhandled errors")
    if total == 0:
        errors += 1
        failures.append("no hidden tests were collected")

    summary = {"passed": passed, "failed": failed, "errors": errors, "total": total, "failures": failures}
    ok = failed == 0 and errors == 0 and passed == total and total > 0
    if not ok:
        sys.stderr.write((proc.stdout + "\n" + proc.stderr)[-12000:] + "\n")
    return summary, ok


def main() -> None:
    if len(sys.argv) != 2:
        sys.stderr.write(__doc__ or "")
        sys.exit(2)

    source = Path(sys.argv[1]).resolve()
    if not (source / "package.json").is_file():
        infra_failure(f"{source} does not look like the fixture repo (no package.json)")
    if not HIDDEN_TESTS.is_dir():
        infra_failure(f"hidden tests not found at {HIDDEN_TESTS}")

    pnpm = find_pnpm()
    # A short temp root keeps node_modules paths well under MAX_PATH on Windows.
    workdir = Path(tempfile.mkdtemp(prefix="pwh-"))
    try:
        repo = workdir / "repo"
        shutil.copytree(source, repo, ignore=shutil.ignore_patterns(*EXCLUDED))
        hidden_dest = repo / "tests" / "hidden"
        if hidden_dest.exists():
            shutil.rmtree(hidden_dest)
        shutil.copytree(HIDDEN_TESTS, hidden_dest)
        (repo / "vitest.hidden.config.mjs").write_text(VITEST_CONFIG, encoding="utf-8")

        install(pnpm, repo)

        report_path = repo / "hidden-report.json"
        try:
            proc = run(
                [
                    pnpm,
                    "exec",
                    "vitest",
                    "run",
                    "--config",
                    "vitest.hidden.config.mjs",
                    "--reporter=json",
                    f"--outputFile={report_path}",
                ],
                repo,
                TEST_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            infra_failure(f"hidden tests timed out after {TEST_TIMEOUT_S}s")
            return
        summary, ok = summarize(report_path, proc)
        emit(summary, ok)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
