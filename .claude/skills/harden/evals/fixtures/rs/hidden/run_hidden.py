#!/usr/bin/env python3
"""Run the hidden behaviour tests of the `rs` fixture against a repo.

Usage:
    python run_hidden.py <path-to-repo-copy> [--keep] [--verbose]

The target repo is never modified: it is copied (without `target/` and
`.git/`) into a temporary directory, the hidden tests from ./tests are added
to the copy's `tests/` directory, and `cargo test --offline` runs only those
test targets with a private CARGO_TARGET_DIR.

Prints one JSON object on stdout:
    {"passed": int, "failed": int, "errors": int, "failed_tests": [...], ...}
`errors` counts hidden test targets that produced no result (build failure,
crash, timeout). Exit status is 0 only when every hidden test passed.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
HIDDEN_TESTS = HERE / "tests"
TIMEOUT_SECONDS = 900

RUNNING_RE = re.compile(r"^\s*Running tests[\\/](?P<name>[A-Za-z0-9_]+)\.rs\b")
RESULT_RE = re.compile(
    r"^test result: (?P<status>ok|FAILED)\. (?P<passed>\d+) passed; (?P<failed>\d+) failed"
)
FAILED_TEST_RE = re.compile(r"^test (?P<name>\S+) \.\.\. FAILED$")


def summarize(output: str, targets: list[str], exit_code: int | None) -> dict:
    """Parse libtest output per hidden target."""
    per_target: dict[str, dict] = {}
    current: str | None = None
    failed_tests: list[str] = []
    for line in output.splitlines():
        running = RUNNING_RE.match(line)
        if running:
            current = running.group("name")
            continue
        failed = FAILED_TEST_RE.match(line.strip())
        if failed and current is not None:
            failed_tests.append(f"{current}::{failed.group('name')}")
            continue
        result = RESULT_RE.match(line.strip())
        if result and current is not None:
            per_target[current] = {
                "passed": int(result.group("passed")),
                "failed": int(result.group("failed")),
            }
            current = None

    passed = sum(t["passed"] for t in per_target.values())
    failed = sum(t["failed"] for t in per_target.values())
    missing = [t for t in targets if t not in per_target]
    return {
        "passed": passed,
        "failed": failed,
        "errors": len(missing),
        "failed_tests": failed_tests,
        "targets_without_results": missing,
        "cargo_exit_code": exit_code,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("repo", help="path to the repo (or a copy of it) to test")
    parser.add_argument("--keep", action="store_true", help="keep the temporary copy")
    parser.add_argument(
        "--verbose", action="store_true", help="echo cargo output to stderr"
    )
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    targets = sorted(p.stem for p in HIDDEN_TESTS.glob("*.rs"))
    if not (repo / "Cargo.toml").is_file():
        print(json.dumps({"passed": 0, "failed": 0, "errors": len(targets),
                          "failed_tests": [], "error": f"no Cargo.toml in {repo}"}))
        return 2

    tmp_root = Path(tempfile.mkdtemp(prefix="matchbook-hidden-"))
    work = tmp_root / "repo"
    output = ""
    exit_code: int | None = None
    try:
        shutil.copytree(repo, work, ignore=shutil.ignore_patterns("target", ".git"))
        tests_dir = work / "tests"
        tests_dir.mkdir(exist_ok=True)
        for src in sorted(HIDDEN_TESTS.glob("*.rs")):
            dest = tests_dir / src.name
            if dest.exists():
                raise RuntimeError(f"hidden test {src.name} collides with a repo file")
            shutil.copy2(src, dest)

        env = os.environ.copy()
        env["CARGO_TARGET_DIR"] = str(tmp_root / "target")
        env["CARGO_TERM_COLOR"] = "never"
        command = ["cargo", "test", "--offline", "--no-fail-fast"]
        for target in targets:
            command += ["--test", target]
        try:
            # One pipe for both streams keeps cargo's "Running tests/<name>.rs"
            # lines (stderr) in order with each binary's results (stdout).
            completed = subprocess.run(
                command,
                cwd=work,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=TIMEOUT_SECONDS,
            )
            output = completed.stdout
            exit_code = completed.returncode
        except subprocess.TimeoutExpired as exc:
            partial = exc.stdout or ""
            if isinstance(partial, bytes):
                partial = partial.decode("utf-8", "replace")
            output = partial + "\n[run_hidden] cargo test timed out"
            exit_code = None
    except Exception as exc:  # noqa: BLE001 - reported as an error in the summary
        output += f"\n[run_hidden] {type(exc).__name__}: {exc}"
    finally:
        if args.keep:
            print(f"[run_hidden] kept temporary copy at {tmp_root}", file=sys.stderr)
        else:
            shutil.rmtree(tmp_root, ignore_errors=True)

    summary = summarize(output, targets, exit_code)
    ok = summary["failed"] == 0 and summary["errors"] == 0 and summary["passed"] > 0
    if args.verbose or not ok:
        print(output, file=sys.stderr)
    print(json.dumps(summary))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
