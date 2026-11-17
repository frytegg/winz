#!/usr/bin/env python3
"""Check that every ledger entry still points at the right code.

Usage::

    python check_ledger.py [path-to-repo]      # default: ../repo next to this folder

For each defect and trap, the ``anchor`` string must occur inside ``lines``
(inclusive, 1-based) of ``file``; every ``hidden_test`` node id must name an
existing test function. Prints one line per entry (``-v`` also prints the code)
and exits 1 on any mismatch.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main(argv: list[str]) -> int:
    verbose = "-v" in argv
    args = [a for a in argv[1:] if a != "-v"]
    repo = Path(args[0]).resolve() if args else (HERE.parent / "repo").resolve()
    ledger = json.loads((HERE / "ledger.json").read_text(encoding="utf-8"))
    problems = 0
    for kind in ("defects", "traps"):
        for entry in ledger[kind]:
            path = repo / entry["file"]
            start, end = entry["lines"]
            lines = path.read_text(encoding="utf-8").splitlines()
            chunk = lines[start - 1 : end]
            ok = 1 <= start <= end <= len(lines) and any(entry["anchor"] in line for line in chunk)
            problems += not ok
            print(f"{'ok ' if ok else 'BAD'} {entry['id']} {entry['file']}:{start}-{end}")
            if verbose or not ok:
                for n, line in enumerate(chunk, start):
                    print(f"      {n:4d}| {line}")
            for node in entry.get("hidden_tests_all", []) + (
                [entry["hidden_test"]] if "hidden_test" in entry else []
            ):
                test_file, _, func = node.partition("::")
                text = (HERE / test_file).read_text(encoding="utf-8")
                if not re.search(rf"^def {re.escape(func)}\(", text, re.M):
                    problems += 1
                    print(f"BAD {entry['id']} hidden test not found: {node}")
    print("ledger OK" if not problems else f"{problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
