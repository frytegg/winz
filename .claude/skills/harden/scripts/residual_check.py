#!/usr/bin/env python3
"""residual_check.py - the report's Residual risk cells claim only what the run measured.

Purpose
    RP-10 lets a residual-risk cell read "checked" only when a lens pass read the module and
    the lens's detector or metric ran on it (pilot-auto-calibration A01-F04). The second
    autonomous pilot still wrote "checked: no issue" for concurrency in modules no concurrency
    detector had run on, and for design in a module only the heuristic metric had measured
    (A01-F49). This script checks each cell against the evidence:
      checked       "checked (<tool>[, <tool>]): no issue". Every lens it cites belongs to the
                    row, `ledger.py gaps` shows each of them read every required line of the
                    module, and every `measured_by` output is a non-empty file under
                    .harden/tools/ that names at least one in-scope file of the module.
      findings      "findings: <id>[, <id>]" with an optional " (<note>)". Every id is in
                    .harden/findings.json and at least one of them sits in the module.
      not-measured  "read, not measured (<missing> did not run)"; the missing tool's first word
                    appears in the report's Limits section.
      not-examined  "not examined"; the module appears in the Limits section.
    The cells come from .harden/tools/residual.json, which the orchestrator writes first and
    renders into the table (reporting RP-10):
      {"version": 1, "modules": [{"module": "src/http/", "cells": {
          "design": {"state": "checked", "lenses": ["complexity-design"],
                     "measured_by": [{"tool": "complexity.py (heuristic)",
                                      "output": ".harden/tools/complexity.json"}]},
          "trust": {"state": "findings", "ids": ["C43"]},
          "concurrency": {"state": "not-measured", "lenses": ["concurrency"],
                          "missing": "eslint (not installed)"},
          "data": {"state": "not-examined"}, "errors": {...}, "tests": {...}}}]}
    A module ending in "/" is a directory (everything below it); otherwise it is one file.
    A tool whose clean run prints nothing writes its command, exit code and scanned file list
    into its output file, so that the file names the module.
    A module that holds a finding of a row's lenses in any status but "rejected" (deferred,
    reported and applied ones included) reads "findings" in that row and lists every such id;
    any other state there, or a findings cell that omits one, fails (pilot-auto-calibration
    A01-F58: the third autonomous pilot wrote "checked (complexity.py heuristic): no issue"
    for the Design row of src/cli.ts while H-049 sat there deferred). A finding without a
    "lens" field is not counted.

    --draft builds the cells mechanically and writes .harden/tools/residual.json and a
    paste-ready table (default .harden/tools/residual-table.md), never report.md:
      modules    the --module values, in order; else the files of .harden/rank.json with a
                 non-null rank, lowest first, at most --top: a file's parent directory (with
                 "/") when that directory directly holds at least two in-scope files and no
                 subdirectory of it holds one, else the file itself
      findings   every unrejected finding of the row's lenses in the module, in findings.json
                 order: "findings: <ids>", with " (<status>: <ids>; ...)" for statuses other
                 than verified, approved, applied and reported
      checked    only for a row with no such finding, a lens of the row that read every
                 required line of the module (the ledger, in process), and a --measured
                 ROW=TOOL@OUTPUT whose output is a non-empty file under .harden/tools/ that
                 names a file of the module
      not-examined  no lens of the row read the module in full
      not-measured  a lens read it in full but no measurement backs the row: the --missing
                 ROW=TOOL names the detector that could not run (a row that needs one and has
                 none is exit 2, and nothing is written)
    After writing, it prints each Limits line the table needs that report.md's Limits lacks.

CLI
    python residual_check.py [--repo DIR] [--residual FILE] [--report FILE] [--findings FILE]
                             [--out FILE] [--json]
    python residual_check.py --draft [--repo DIR] [--findings FILE] [--module M ...] [--top N]
                             [--measured ROW=TOOL@OUTPUT ...] [--missing ROW=TOOL ...]
                             [--residual FILE] [--table-out FILE] [--report FILE] [--json]
    (use python3 on macOS/Linux)
    defaults: .harden/tools/residual.json, .harden/report.md, .harden/findings.json,
              --out .harden/tools/residual-check.json, --top 10,
              --table-out .harden/tools/residual-table.md; ROW is one of design, trust,
              concurrency, data, errors, tests; --measured splits on the first "=" and the
              last "@", and may repeat for a row

Exit codes
    0  every cell matches its evidence
    1  at least one cell claims more than the evidence shows, or table and residual.json differ
    2  usage error: a missing or malformed input, no "## Residual risk" table, or ledger.py
       unusable
    --draft: 0 written; 2 usage (unknown row, no module, a needed --missing, no findings.json
       or ledger)

Python 3.9+ standard library only; no network; UTF-8 I/O.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.dont_write_bytecode = True
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)

VERSION = 1
ROWS = ("design", "trust", "concurrency", "data", "errors", "tests")
COLUMNS = ("Module", "Design", "Trust boundaries and authorisation", "Concurrency",
           "Data integrity", "Error handling", "Tests")
# The lenses whose reading and detectors can back each row (assets/report-template.md).
ROW_LENSES: Dict[str, Tuple[str, ...]] = {
    "design": ("complexity-design", "architecture", "duplication", "dead-code"),
    "trust": ("security", "web3", "ops-config"),
    "concurrency": ("concurrency",),
    "data": ("data", "numeric-money-time"),
    "errors": ("errors-resilience",),
    "tests": ("tests",),
}
STATES = ("checked", "findings", "not-measured", "not-examined")
# Statuses a findings cell names without a note; others are shown as "(<status>: <ids>)".
PLAIN_STATUSES = ("verified", "approved", "applied", "reported")


class UsageError(Exception):
    """Bad arguments or unreadable input (exit 2)."""


def render(cell: Dict[str, Any]) -> str:
    state = cell.get("state")
    if state == "checked":
        tools = [m.get("tool", "") for m in cell.get("measured_by") or [] if isinstance(m, dict)]
        return "checked ({}): no issue".format(", ".join(t for t in tools if t))
    if state == "findings":
        return "findings: {}".format(", ".join(str(i) for i in cell.get("ids") or []))
    if state == "not-measured":
        return "read, not measured ({} did not run)".format(cell.get("missing") or "")
    return "not examined"


def cell_matches(text: str, cell: Dict[str, Any]) -> bool:
    want = render(cell)
    text = " ".join(text.split())
    if cell.get("state") == "findings":
        return text == want or (text.startswith(want + " (") and text.endswith(")"))
    return text == want


def parse_table(report: str) -> Dict[str, List[str]]:
    """Module -> its six cell texts, from the "## Residual risk" section's table."""
    match = re.search(r"(?ms)^## Residual risk[ \t]*\n(.*?)(?=^## |\Z)", report)
    if not match:
        raise UsageError("the report has no \"## Residual risk\" section")
    rows: Dict[str, List[str]] = {}
    header_seen = False
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if not header_seen:
            header_seen = True
            if tuple(cells) != COLUMNS:
                raise UsageError("the Residual risk table's columns are not {}".format(
                    " | ".join(COLUMNS)))
            continue
        if all(set(c) <= set("-: ") for c in cells):
            continue
        module = cells[0].strip("`")
        if module.startswith("{{"):
            continue
        rows[module] = (cells[1:] + [""] * len(ROWS))[:len(ROWS)]
    if not header_seen:
        raise UsageError("the Residual risk section holds no table")
    return rows


def limits_section(report: str) -> str:
    match = re.search(r"(?ms)^## Limits[ \t]*\n(.*?)(?=^## |\Z)", report)
    return match.group(1) if match else ""


def module_glob(module: str) -> str:
    return module if module.endswith("/") else module


def in_module(path: str, module: str) -> bool:
    path = path.replace("\\", "/")
    return path.startswith(module) if module.endswith("/") else path == module


class Ledger:
    """`ledger.py gaps --json` per (lens, module), cached."""

    def __init__(self, repo: Path) -> None:
        self.repo = repo
        self.cache: Dict[Tuple[str, str], Tuple[Optional[int], Optional[int]]] = {}

    def unread(self, lens: str, module: str) -> Tuple[Optional[int], Optional[int]]:
        key = (lens, module)
        if key not in self.cache:
            cmd = [sys.executable, "-B", str(_HERE / "ledger.py"), "gaps", "--lens", lens,
                   "--glob", module_glob(module), "--json", "--repo", str(self.repo)]
            try:
                proc = subprocess.run(cmd, capture_output=True, timeout=300)
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise UsageError("ledger.py gaps failed: {}".format(exc)) from exc
            if proc.returncode not in (0, 1):
                raise UsageError("ledger.py gaps --lens {} exited {}: {}".format(
                    lens, proc.returncode, proc.stderr.decode("utf-8", "replace").strip()[:300]))
            try:
                data = json.loads(proc.stdout.decode("utf-8", "replace"))
                self.cache[key] = (int(data.get("required_lines") or 0),
                                   int(data.get("unread_lines") or 0))
            except (ValueError, TypeError) as exc:
                raise UsageError("ledger.py gaps printed no JSON: {}".format(exc)) from exc
        return self.cache[key]


def open_findings(findings: Sequence[Dict[str, Any]], module: str, row: str
                  ) -> List[Tuple[str, str]]:
    """(id, status) of every finding of the row's lenses in the module whose status is not
    "rejected", in findings.json order (pilot-auto-calibration A01-F58)."""
    out: List[Tuple[str, str]] = []
    for f in findings:
        if not isinstance(f, dict) or not isinstance(f.get("lens"), str):
            continue
        if f.get("status") == "rejected" or f["lens"] not in ROW_LENSES[row]:
            continue
        if in_module(str(f.get("file") or ""), module):
            out.append((str(f.get("id")), str(f.get("status") or "")))
    return out


def check_cell(repo: Path, module: str, row: str, cell: Dict[str, Any], text: str,
               files: List[str], findings: Dict[str, Dict[str, Any]], limits: str,
               ledger: Ledger, open_ids: Optional[List[Tuple[str, str]]] = None) -> List[str]:
    where = "{} / {}".format(module, row)
    problems: List[str] = []
    state = cell.get("state")
    if state not in STATES:
        return ["{}: state {!r} is not one of {}".format(where, state, ", ".join(STATES))]
    if not cell_matches(text, cell):
        problems.append("{}: the table says {!r}, residual.json renders {!r}".format(
            where, text, render(cell)))
    if open_ids:
        shown = ", ".join("{} ({})".format(i, s) for i, s in open_ids)
        plain = ", ".join(i for i, _s in open_ids)
        if state != "findings":
            problems.append("{}: {!r} while {} of this row's lenses sit in the module: the cell "
                            "must read \"findings: {}\" (pilot-auto-calibration A01-F58)".format(
                                where, render(cell), shown, plain))
        else:
            listed = {str(i) for i in cell.get("ids") or []}
            omitted = [(i, s) for i, s in open_ids if i not in listed]
            if omitted:
                problems.append("{}: findings omits {}, which sit in the module under this "
                                "row's lenses (A01-F58)".format(
                                    where, ", ".join("{} ({})".format(i, s)
                                                     for i, s in omitted)))
    if state == "checked":
        lenses = [l for l in cell.get("lenses") or [] if isinstance(l, str)]
        if not lenses:
            problems.append("{}: checked names no lens".format(where))
        for lens in lenses:
            if lens not in ROW_LENSES[row]:
                problems.append("{}: lens {} does not back this row ({})".format(
                    where, lens, ", ".join(ROW_LENSES[row])))
                continue
            required, unread = ledger.unread(lens, module)
            if not required:
                problems.append("{}: the ledger requires no line of the module for {}: "
                                "not examined".format(where, lens))
            elif unread:
                problems.append("{}: {} left {} of {} required lines unread: not examined, or "
                                "re-dispatch the gaps".format(where, lens, unread, required))
        measured = [m for m in cell.get("measured_by") or [] if isinstance(m, dict)]
        if not measured:
            problems.append("{}: checked needs the detector or metric that ran "
                            "(pilot-auto-calibration A01-F04): otherwise \"read, not measured\""
                            .format(where))
        for item in measured:
            out = str(item.get("output") or "").replace("\\", "/")
            if not item.get("tool") or not out.startswith(".harden/tools/"):
                problems.append("{}: measured_by needs a tool and an output under "
                                ".harden/tools/".format(where))
                continue
            path = repo / out
            if not path.is_file() or path.stat().st_size == 0:
                problems.append("{}: {} does not exist or is empty".format(where, out))
                continue
            body = path.read_bytes().decode("utf-8", "replace").replace("\\\\", "/")
            body = body.replace("\\", "/")
            if not any(f in body for f in files):
                problems.append("{}: {} names no file of the module: {} did not measure it"
                                .format(where, out, item.get("tool")))
    elif state == "findings":
        ids = [str(i) for i in cell.get("ids") or []]
        if not ids:
            problems.append("{}: findings lists no id".format(where))
        missing = [i for i in ids if i not in findings]
        if missing:
            problems.append("{}: {} not in findings.json".format(where, ", ".join(missing)))
        if ids and not missing and not any(in_module(str(findings[i].get("file") or ""), module)
                                           for i in ids):
            problems.append("{}: none of {} sits in the module".format(where, ", ".join(ids)))
    elif state == "not-measured":
        missing_tool = str(cell.get("missing") or "").strip()
        if not missing_tool:
            problems.append("{}: not-measured names no missing tool".format(where))
        elif missing_tool.split()[0].lower() not in limits.lower():
            problems.append("{}: {} is not named in Limits (RP-10)".format(
                where, missing_tool.split()[0]))
    else:
        if module.rstrip("/") not in limits:
            problems.append("{}: a not-examined module must appear in Limits (RP-10)".format(
                where))
    return problems


def _row_values(values: Sequence[str], flag: str, measured: bool
                ) -> Dict[str, List[Tuple[str, str]]]:
    """--measured ROW=TOOL@OUTPUT (the first "=" and the last "@") or --missing ROW=TOOL."""
    out: Dict[str, List[Tuple[str, str]]] = {}
    for value in values:
        row, sep, rest = value.partition("=")
        row = row.strip()
        if not sep or row not in ROWS:
            raise UsageError("{} {!r}: ROW must be one of {}".format(flag, value,
                                                                     ", ".join(ROWS)))
        if measured:
            tool, at, output = rest.rpartition("@")
            output = output.strip().replace("\\", "/")
            if not at or not tool.strip() or not output.startswith(".harden/tools/"):
                raise UsageError("{} {!r}: write ROW=TOOL@OUTPUT with the output under "
                                 ".harden/tools/".format(flag, value))
            out.setdefault(row, []).append((tool.strip(), output))
        else:
            if not rest.strip():
                raise UsageError("{} {!r}: name the tool that did not run".format(flag, value))
            out.setdefault(row, []).append((rest.strip(), ""))
    return out


def default_modules(hdir: Path, inscope: Sequence[str], top: int) -> List[str]:
    """The highest-ranked files of .harden/rank.json as modules (a directory module only
    when it directly holds two in-scope files and no subdirectory holds one)."""
    try:
        rank = C.read_json(hdir / "rank.json")
    except (OSError, ValueError) as exc:
        raise UsageError("no --module and no readable .harden/rank.json ({})".format(exc)) \
            from exc
    files = [f for f in (rank.get("files") or [] if isinstance(rank, dict) else [])
             if isinstance(f, dict) and isinstance(f.get("rank"), (int, float))
             and isinstance(f.get("path"), str)]
    files.sort(key=lambda f: f["rank"])
    out: List[str] = []
    for f in files[:max(0, top)]:
        path = f["path"].replace("\\", "/")
        parent = path.rsplit("/", 1)[0] + "/" if "/" in path else ""
        module = path
        if parent:
            direct = [p for p in inscope if p.startswith(parent) and "/" not in p[len(parent):]]
            deeper = [p for p in inscope if p.startswith(parent) and "/" in p[len(parent):]]
            if len(direct) >= 2 and not deeper:
                module = parent
        if module not in out:
            out.append(module)
    return out


def draft_main(args: argparse.Namespace) -> int:
    """--draft: build residual.json and the paste-ready table (A01-F58)."""
    start = Path(args.repo) if args.repo else Path.cwd()
    top = C.git_ok(start, ["rev-parse", "--show-toplevel"]) if C.git_available() else None
    if not top:
        raise UsageError("{} is not in a git repository".format(C.posix_abs(start)))
    repo = Path(top)
    hdir = repo / ".harden"

    def path_of(value: Optional[str], default: Path) -> Path:
        if not value:
            return default
        p = Path(value)
        return p if p.is_absolute() else repo / p

    measured = _row_values(args.measured or [], "--measured", True)
    missing = _row_values(args.missing or [], "--missing", False)
    findings_path = path_of(args.findings, hdir / "findings.json")
    try:
        findings_doc = C.read_json(findings_path)
    except (OSError, ValueError) as exc:
        raise UsageError("cannot read {}: {}".format(findings_path, exc)) from exc
    ordered = [f for f in (findings_doc or {}).get("findings") or [] if isinstance(f, dict)]
    inscope_path = hdir / "tools" / "inscope.txt"
    inscope = [l.strip().replace("\\", "/") for l in
               inscope_path.read_text(encoding="utf-8").splitlines()
               if l.strip()] if inscope_path.is_file() else []
    modules = [m.replace("\\", "/") for m in args.module] if args.module else \
        default_modules(hdir, inscope, args.top)
    try:
        import ledger as lg  # noqa: E402  (sibling module)
        ledger = lg.load_ledger(repo)
    except Exception as exc:  # noqa: BLE001 - ledger.py's own errors
        raise UsageError("the ledger is unusable: {}".format(exc)) from exc
    kept: List[str] = []
    for module in modules:
        if any(in_module(f, module) for f in inscope):
            kept.append(module)
        else:
            print("residual_check.py: {} holds no in-scope file: skipped".format(module))
    if not kept:
        raise UsageError("no module with an in-scope file to draft")
    reads: Dict[Tuple[str, str], Tuple[int, int]] = {}
    needed: List[str] = []
    entries: List[Dict[str, Any]] = []
    for module in kept:
        files = [f for f in inscope if in_module(f, module)]
        cells: Dict[str, Dict[str, Any]] = {}
        for row in ROWS:
            opened = open_findings(ordered, module, row)
            if opened:
                cells[row] = {"state": "findings", "ids": [i for i, _s in opened]}
                notes: Dict[str, List[str]] = {}
                for fid, status in opened:
                    if status not in PLAIN_STATUSES:
                        notes.setdefault(status, []).append(fid)
                if notes:
                    cells[row]["note"] = "; ".join("{}: {}".format(s, ", ".join(ids))
                                                   for s, ids in notes.items())
                continue
            full: List[str] = []
            for lens in ROW_LENSES[row]:
                key = (lens, module)
                if key not in reads:
                    _manifest, required, unread, _trivial = lg.gaps_manifest(
                        ledger, [lens], None, [], [module_glob(module)])
                    reads[key] = (int(required), int(unread))
                required, unread = reads[key]
                if required > 0 and unread == 0:
                    full.append(lens)
            if not full:
                cells[row] = {"state": "not-examined", "lenses": list(ROW_LENSES[row])}
                continue
            backing = []
            for tool, output in measured.get(row, []):
                path = repo / output
                if not path.is_file() or path.stat().st_size == 0:
                    continue
                body = path.read_bytes().decode("utf-8", "replace").replace("\\\\", "/")
                body = body.replace("\\", "/")
                if any(f in body for f in files):
                    backing.append({"tool": tool, "output": output})
            if backing:
                cells[row] = {"state": "checked", "lenses": full, "measured_by": backing}
                continue
            tools = missing.get(row)
            if not tools:
                if row not in needed:
                    needed.append(row)
                continue
            cells[row] = {"state": "not-measured", "lenses": full, "missing": tools[0][0]}
        entries.append({"module": module, "cells": cells})
    if needed:
        print("residual_check.py: --missing needed for rows {} (the detector each row's lens "
              "could not run, as Limits (a) names it)".format(", ".join(needed)),
              file=sys.stderr)
        return 2
    residual_path = path_of(args.residual, hdir / "tools" / "residual.json")
    table_path = path_of(args.table_out, hdir / "tools" / "residual-table.md")
    C.write_json(residual_path, {"version": VERSION, "modules": entries})
    lines = ["| " + " | ".join(COLUMNS) + " |", "|---|---|---|---|---|---|---|"]
    for entry in entries:
        texts = []
        for row in ROWS:
            cell = entry["cells"][row]
            text = render(cell)
            if cell.get("state") == "findings" and cell.get("note"):
                text += " ({})".format(cell["note"])
            texts.append(text)
        lines.append("| {} | {} |".format(entry["module"], " | ".join(texts)))
    table_path.parent.mkdir(parents=True, exist_ok=True)
    with open(str(table_path), "w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    report_path = path_of(args.report, hdir / "report.md")
    try:
        limits = limits_section(report_path.read_bytes().decode("utf-8", "replace"))
    except OSError:
        limits = ""
    limits_needed: List[str] = []
    for entry in entries:
        for row in ROWS:
            cell = entry["cells"][row]
            if cell["state"] == "not-examined" and entry["module"].rstrip("/") not in limits:
                line = "Limits needs: {} not examined".format(entry["module"])
            elif cell["state"] == "not-measured" and \
                    cell["missing"].split()[0].lower() not in limits.lower():
                line = "Limits needs: {} (did not run)".format(cell["missing"])
            else:
                continue
            if line not in limits_needed:
                limits_needed.append(line)
    if args.json:
        print(json.dumps({"residual": C.posix_abs(residual_path), "table": C.posix_abs(
            table_path), "modules": [e["module"] for e in entries],
            "limits_needed": limits_needed}, indent=2))
    else:
        print("wrote {} and {}: paste it under \"## Residual risk\" unchanged, then run "
              "residual_check.py".format(C.posix_abs(residual_path), C.posix_abs(table_path)))
        for line in limits_needed:
            print(line)
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        prog="residual_check.py",
        description="Check the report's Residual risk cells against the run's evidence "
                    "(RP-10; pilot-auto-calibration A01-F04, A01-F49, A01-F58).")
    parser.add_argument("--repo")
    parser.add_argument("--residual")
    parser.add_argument("--report")
    parser.add_argument("--findings")
    parser.add_argument("--out")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--draft", action="store_true",
                        help="build residual.json and the table from the run's files")
    parser.add_argument("--module", action="append")
    parser.add_argument("--top", type=int, default=10)
    parser.add_argument("--measured", action="append")
    parser.add_argument("--missing", action="append")
    parser.add_argument("--table-out")
    args = parser.parse_args(argv)
    if args.draft:
        try:
            return draft_main(args)
        except UsageError as exc:
            print("residual_check.py: {}".format(exc), file=sys.stderr)
            return 2
    try:
        start = Path(args.repo) if args.repo else Path.cwd()
        top = C.git_ok(start, ["rev-parse", "--show-toplevel"]) if C.git_available() else None
        if not top:
            raise UsageError("{} is not in a git repository".format(C.posix_abs(start)))
        repo = Path(top)
        hdir = repo / ".harden"

        def path_of(value: Optional[str], default: Path) -> Path:
            if not value:
                return default
            p = Path(value)
            return p if p.is_absolute() else repo / p

        residual_path = path_of(args.residual, hdir / "tools" / "residual.json")
        report_path = path_of(args.report, hdir / "report.md")
        findings_path = path_of(args.findings, hdir / "findings.json")
        try:
            residual = C.read_json(residual_path)
            report = report_path.read_bytes().decode("utf-8", "replace").replace("\r\n", "\n")
            findings_doc = C.read_json(findings_path)
        except (OSError, ValueError) as exc:
            raise UsageError("cannot read an input: {}".format(exc)) from exc
        modules = residual.get("modules") if isinstance(residual, dict) else None
        if not isinstance(modules, list):
            raise UsageError("residual.json has no \"modules\" list")
        table = parse_table(report)
        limits = limits_section(report)
        ordered = [f for f in (findings_doc or {}).get("findings") or [] if isinstance(f, dict)]
        findings = {str(f.get("id")): f for f in ordered}
        inscope_path = hdir / "tools" / "inscope.txt"
        inscope = [l.strip().replace("\\", "/") for l in
                   inscope_path.read_text(encoding="utf-8").splitlines()
                   if l.strip()] if inscope_path.is_file() else []
        ledger = Ledger(repo)
        problems: List[str] = []
        listed = set()
        for entry in modules:
            if not isinstance(entry, dict) or not isinstance(entry.get("module"), str):
                raise UsageError("each residual.json module needs a \"module\" string")
            module = entry["module"].replace("\\", "/")
            listed.add(module)
            if module not in table:
                problems.append("{}: in residual.json but not in the report's table".format(
                    module))
                continue
            files = [f for f in inscope if in_module(f, module)]
            if not files:
                problems.append("{}: no in-scope file (.harden/tools/inscope.txt) is in the "
                                "module".format(module))
            cells = entry.get("cells") if isinstance(entry.get("cells"), dict) else {}
            for index, row in enumerate(ROWS):
                cell = cells.get(row)
                if not isinstance(cell, dict):
                    problems.append("{} / {}: no cell in residual.json".format(module, row))
                    continue
                problems += check_cell(repo, module, row, cell, table[module][index], files,
                                       findings, limits, ledger,
                                       open_ids=open_findings(ordered, module, row))
        for module in table:
            if module not in listed:
                problems.append("{}: in the report's table but not in residual.json".format(
                    module))
    except UsageError as exc:
        print("residual_check.py: {}".format(exc), file=sys.stderr)
        return 2
    data = {"tool": "residual_check.py", "version": VERSION, "generated": C.utc_iso(),
            "modules": sorted(listed), "problems": problems}
    out = path_of(args.out, hdir / "tools" / "residual-check.json")
    C.write_json(out, data)
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        for problem in problems:
            print("PROBLEM: " + problem)
        print("residual_check.py: {} module(s), {} problem(s)".format(len(listed),
                                                                       len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
