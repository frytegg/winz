"""exec.py with lane B06's fakes of other lanes' modules installed first (tests only).

Same start-up as scripts/exec.py (UTF-8 stdio, scripts/ on sys.path, execlib.cli.main), plus
`_support_B06.install_fakes()` so `results`, `status` and `governor` resolve to the MODULES.md-signature fakes.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", newline="\n")  # type: ignore[union-attr]
sys.stderr.reconfigure(encoding="utf-8", newline="\n")  # type: ignore[union-attr]
TESTS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(TESTS.parent))
sys.path.insert(0, str(TESTS))

import _support_B06  # noqa: E402

_support_B06.install_fakes()

from execlib.cli import main  # noqa: E402

raise SystemExit(main(sys.argv[1:]))
