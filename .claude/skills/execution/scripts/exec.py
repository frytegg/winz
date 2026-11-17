#!/usr/bin/env python3
"""/execution command line. See contract/CLI.md."""
from __future__ import annotations
import sys
if sys.version_info < (3, 11):
    sys.stdout.write('{"ok":false,"command":"","data":null,"errors":[{"code":"E_PYTHON","message":"Python >= 3.11 required"}]}\n')
    raise SystemExit(3)
from pathlib import Path
# Pipes default to the ANSI code page (cp1252) on Windows: the envelope carries French text (summary_fr, push_text_fr).
sys.stdout.reconfigure(encoding="utf-8", newline="\n")
sys.stderr.reconfigure(encoding="utf-8", newline="\n")
sys.path.insert(0, str(Path(__file__).resolve().parent))
from execlib.cli import main  # noqa: E402
raise SystemExit(main(sys.argv[1:]))
