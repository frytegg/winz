#!/usr/bin/env python3
"""Checkers behind the proofs of the execution template library (assets/task-templates/execution.json).

    python plan_checks.py readme --repo . --readme README.md [--run-verify] [--require-images DIR]
    python plan_checks.py replay --state <state dir> --repo .
    python plan_checks.py convergence --state <state dir> --task T0xx --repo .
    python plan_checks.py freeze --repo . --globs "a/**,b.md" --at 2026-10-03T13:00:00Z
    python plan_checks.py ledger --ledger <file> --kind claims|dx [--closed]
    python plan_checks.py history --repo . --never-show <file>

Each prints one JSON object {ok, check, details: [...]} and exits 0 iff ok (1 when a check fails, 2 on a usage
error). Standard library plus this skill's own execlib (proof digests, the never-show matcher, Git Bash). Every
negative claim runs a positive control first: the TODO and link scanners catch a planted line in memory, the
never-show history scan catches a planted occurrence of a live literal entry, and a scanner that misses its plant
fails the check ("blind scan").
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from execlib import nevershow, procutil  # noqa: E402
from execlib.plan import proof_digest  # noqa: E402

TODO_STRICT = re.compile(r"(\*\*TODO\*\*|\*\*Still TODO\*\*|^\s*-\s*\*\*TODO|TODO\s*[—-]\s|\bTBD\b)")
TODO_WORDS = re.compile(r"\bTODO\b|\bFIXME\b|\bXXX\b|lorem ipsum", re.I)
TODO_OK = "<!--todo-ok-->"
LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)|<img[^>]+src=\"([^\"]+)\"", re.I)
FENCE_RE = re.compile(r"^```([^\n]*)\n(.*?)^```\s*$", re.S | re.M)
REPLAYED_TYPES = frozenset({"command", "tx", "ci", "file", "url"})
CLAIMS_COLUMNS = ("#", "claim", "where", "evidence", "status")
DX_COLUMNS = ("When (UTC)", "Who", "Where", "What I tried", "What happened", "Time lost")


def _git(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-c", "core.quotepath=false", *args], cwd=str(repo), capture_output=True,
                          stdin=subprocess.DEVNULL, check=False)


def _out(cp: subprocess.CompletedProcess) -> str:
    return cp.stdout.decode("utf-8", errors="replace")


def _head(repo: Path) -> str | None:
    cp = _git(repo, "rev-parse", "HEAD")
    return _out(cp).strip() if cp.returncode == 0 else None


def _result(check: str, ok: bool, details: list[str]) -> dict:
    return {"check": check, "ok": ok, "details": details}


# --- readme ------------------------------------------------------------------------------------------------------------

def todo_lines(text: str) -> list[int]:
    out = []
    for i, line in enumerate(text.split("\n"), start=1):
        if TODO_OK in line:
            continue
        if TODO_STRICT.search(line) or TODO_WORDS.search(line):
            out.append(i)
    return out


def links(text: str) -> list[str]:
    found = []
    for m in LINK_RE.finditer(text):
        target = m.group(1) or m.group(2)
        if not target or re.match(r"^(https?:|mailto:|#|data:)", target, re.I):
            continue
        found.append(target.split("#", 1)[0].split("?", 1)[0])
    return [t for t in found if t]


def check_readme(repo: Path, readme: str, run_verify: bool, require_images: str | None) -> dict:
    details: list[str] = []
    # positive controls (blind scan otherwise)
    if todo_lines("x\n**TODO** planted\n") != [2] or links("see ![s](docs/x.png) and [h](https://e.invalid)") != [
            "docs/x.png"]:
        return _result("readme", False, ["blind scan: a scanner missed its planted control"])
    path = repo / readme
    if not path.is_file() or path.stat().st_size == 0:
        return _result("readme", False, [f"{readme} is missing or empty"])
    text = path.read_bytes().decode("utf-8", errors="replace").replace("\r\n", "\n")
    bad = todo_lines(text)
    if bad:
        details.append(f"TODO/TBD/placeholder on lines {bad[:20]}")
    base = path.parent
    missing = [t for t in links(text) if not (base / t).exists()]
    if missing:
        details.append(f"relative links to missing files: {missing[:20]}")
    if require_images:
        imgs = [t for t in links(text) if t.startswith(require_images.rstrip("/") + "/")]
        if not imgs:
            details.append(f"no image under {require_images}/ is referenced")
    if run_verify:
        bash = procutil.git_bash()
        blocks = [body for info, body in FENCE_RE.findall(text) if info.strip().split()[:2] == ["bash", "verify"]]
        for i, body in enumerate(blocks, start=1):
            if bash is None:
                details.append("bash not found to run the verify blocks")
                break
            cp = subprocess.run([bash, "-e", "-c", body], cwd=str(repo), capture_output=True, stdin=subprocess.DEVNULL,
                                check=False, timeout=600)
            if cp.returncode != 0:
                details.append(f"verify block {i} exited {cp.returncode}: "
                               f"{cp.stderr.decode('utf-8', 'replace')[-300:]}")
    return _result("readme", not details, details or [f"{readme}: no TODO, links resolve"])


# --- replay ------------------------------------------------------------------------------------------------------------

def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def check_replay(state: Path, repo: Path) -> dict:
    head = _head(repo)
    if head is None:
        return _result("replay", False, ["no HEAD in the repository"])
    plan = _read(state / "plan.json")
    statuses = {}
    for ex in ("A", "B"):
        p = state / "status" / f"{ex}.json"
        statuses[ex] = _read(p) if p.is_file() else {"tasks": {}}
    details = []
    checked = 0
    for t in plan.get("tasks") or ():
        entry = (statuses.get(t["executor"]) or {}).get("tasks", {}).get(t["id"])
        if not entry or entry.get("status") != "done":
            continue
        if t.get("kind") in ("manual", "decision") or (t.get("proof") or {}).get("type") not in REPLAYED_TYPES:
            continue
        if t.get("template") == "execution:EX-REPLAY":
            continue
        checked += 1
        want = proof_digest(t)
        ok = False
        runs_dir = state / "local" / "proof-runs" / t["id"]
        for run in sorted(runs_dir.glob("*/run.json")) if runs_dir.is_dir() else []:
            r = _read(run)
            if ((r.get("by") or {}).get("role") == "replay" and r.get("sha") == head
                    and (r.get("checkout") or {}).get("kind") == "clone" and r.get("proof_hash") == want
                    and (r.get("expectation") or {}).get("met") is True):
                ok = True
                break
        if not ok:
            details.append(f"{t['id']}: no replay run of {head[:8]} with its current proof hash and expectation met")
    return _result("replay", not details, details or [f"{checked} done tasks replayed on {head[:8]}"])


# --- convergence -------------------------------------------------------------------------------------------------------

def check_convergence(state: Path, task: str, repo: Path) -> dict:
    head = _head(repo)
    found = []
    for f in (state / "local" / "results").glob(f"*/{task}.reviewer.a*.json") if (state / "local" / "results").is_dir() \
            else []:
        m = re.search(r"\.a(\d+)\.json$", f.name)
        wave = f.parent.name
        found.append(((int(wave[1:]) if wave[1:].isdigit() else 0), int(m.group(1)) if m else 0, f))
    if not found:
        return _result("convergence", False, [f"no reviewer result for {task}"])
    doc = _read(max(found, key=lambda x: (x[0], x[1]))[2])
    if doc.get("mode") != "convergence":
        return _result("convergence", False, ["the newest reviewer result is not a convergence pass"])
    if (doc.get("scope") or {}).get("sha") != head:
        return _result("convergence", False, [f"the newest convergence pass is for {(doc.get('scope') or {}).get('sha')},"
                                              f" not HEAD {head}"])
    gaps = [g for g in doc.get("gaps") or () if g.get("type") in ("missing", "partial")
            and g.get("within_approved_scope")]
    if gaps:
        return _result("convergence", False, [f"{g['requirement']}: {g['type']}" for g in gaps])
    return _result("convergence", True, [f"convergence pass for {head[:8]} has no missing or partial gap in scope"])


# --- freeze ------------------------------------------------------------------------------------------------------------

def _epoch(utc: str) -> int:
    return int(datetime.strptime(utc, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def check_freeze(repo: Path, globs_csv: str, at: str) -> dict:
    try:
        limit = _epoch(at)
    except ValueError:
        return _result("freeze", False, [f"--at {at!r} is not a UTC instant"])
    specs = [f":(glob){g.strip()}" for g in globs_csv.split(",") if g.strip()]
    cp = _git(repo, "log", "--format=%H %ct", "--", *specs)
    if cp.returncode != 0:
        return _result("freeze", False, [f"git log failed: {cp.stderr.decode('utf-8', 'replace')[-200:]}"])
    late = []
    for line in _out(cp).split("\n"):
        if not line.strip():
            continue
        sha, ct = line.split()
        if int(ct) > limit:
            late.append(sha[:12])
    if late:
        return _result("freeze", False, [f"commits after the freeze {at} touch the frozen globs: {late[:20]}"])
    return _result("freeze", True, [f"no commit after {at} touches {globs_csv}"])


# --- ledgers -----------------------------------------------------------------------------------------------------------

def _table(text: str) -> tuple[list[str], list[list[str]]] | None:
    lines = text.replace("\r\n", "\n").split("\n")
    for i, line in enumerate(lines[:-1]):
        if line.startswith("|") and re.match(r"^\|(\s*:?-{3,}:?\s*\|)+\s*$", lines[i + 1]):
            header = [c.strip() for c in line.strip().strip("|").split("|")]
            rows = []
            for row in lines[i + 2:]:
                if not row.startswith("|"):
                    break
                rows.append([c.strip() for c in row.strip().strip("|").split("|")])
            return header, rows
    return None


def check_ledger(ledger: Path, kind: str, closed: bool) -> dict:
    if not ledger.is_file():
        return _result("ledger", False, [f"{ledger.as_posix()} does not exist"])
    tbl = _table(ledger.read_bytes().decode("utf-8", errors="replace"))
    if tbl is None:
        return _result("ledger", False, ["no Markdown table in the ledger"])
    header, rows = tbl
    want = CLAIMS_COLUMNS if kind == "claims" else DX_COLUMNS
    if len(header) < len(want) or any(not h.lower().startswith(w.lower()) for h, w in zip(header, want)):
        return _result("ledger", False, [f"table header {header} is not /hackathon's {kind} format"])
    if closed and kind == "claims":
        idx = len(want) - 1
        open_rows = [r[0] for r in rows if len(r) > idx and r[idx].strip().lower() == "unverified"]
        if open_rows:
            return _result("ledger", False, [f"rows still unverified: {open_rows[:30]}"])
    return _result("ledger", True, [f"{kind} ledger well-formed, {len(rows)} rows"])


# --- history -----------------------------------------------------------------------------------------------------------

def _now() -> datetime:
    if os.environ.get("EXEC_TEST") == "1" and os.environ.get("EXEC_NOW"):
        return datetime.strptime(os.environ["EXEC_NOW"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc)


def check_history(repo: Path, never_show: Path) -> dict:
    entries, _warn = nevershow.load(never_show)
    active = nevershow.active(entries, _now())
    literal = [e for e in active if not e.regex]
    if literal:
        plant = f"x {literal[0].pattern} x"
        if not nevershow.scan_text(plant, [literal[0]]):
            return _result("history", False, ["blind scan: the planted live entry was not caught"])
    hits: set[tuple[str, str]] = set()
    cp = _git(repo, "log", "--all", "--format=%x1e%H%x00%B%x00", "-p", "--no-color", "--no-ext-diff")
    if cp.returncode != 0:
        return _result("history", False, [f"git log failed: {cp.stderr.decode('utf-8', 'replace')[-200:]}"])
    for rec in _out(cp).split("\x1e"):
        if not rec.strip():
            continue
        sha, _sep, rest = rec.partition("\x00")
        message, _sep2, patch = rest.partition("\x00")
        for h in nevershow.scan_text(message, active, file=None):
            hits.add((h.entry_id, sha.strip()[:12]))
        added = "\n".join(ln[1:] for ln in patch.split("\n") if ln.startswith("+") and not ln.startswith("+++"))
        for h in nevershow.scan_text(added, active, file=None):
            hits.add((h.entry_id, sha.strip()[:12]))
    if hits:
        return _result("history", False, [f"entry {e} in commit {c}" for e, c in sorted(hits)])
    return _result("history", True, [f"{len(active)} active entries absent from the whole history"])


# --- main ----------------------------------------------------------------------------------------------------------------

def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="plan_checks.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("readme")
    p.add_argument("--repo", default=".")
    p.add_argument("--readme", default="README.md")
    p.add_argument("--run-verify", dest="run_verify", action="store_true")
    p.add_argument("--require-images", dest="require_images")
    p = sub.add_parser("replay")
    p.add_argument("--state", required=True)
    p.add_argument("--repo", default=".")
    p = sub.add_parser("convergence")
    p.add_argument("--state", required=True)
    p.add_argument("--task", required=True)
    p.add_argument("--repo", default=".")
    p = sub.add_parser("freeze")
    p.add_argument("--repo", default=".")
    p.add_argument("--globs", required=True)
    p.add_argument("--at", required=True)
    p = sub.add_parser("ledger")
    p.add_argument("--ledger", required=True)
    p.add_argument("--kind", required=True, choices=("claims", "dx"))
    p.add_argument("--closed", action="store_true")
    p = sub.add_parser("history")
    p.add_argument("--repo", default=".")
    p.add_argument("--never-show", dest="never_show", required=True)
    try:
        a = ap.parse_args(argv)
    except SystemExit as err:
        return 2 if err.code else 0
    repo = Path(getattr(a, "repo", ".")).resolve()
    if a.cmd == "readme":
        res = check_readme(repo, a.readme, a.run_verify, a.require_images)
    elif a.cmd == "replay":
        res = check_replay(Path(a.state), repo)
    elif a.cmd == "convergence":
        res = check_convergence(Path(a.state), a.task, repo)
    elif a.cmd == "freeze":
        res = check_freeze(repo, a.globs, a.at)
    elif a.cmd == "ledger":
        res = check_ledger(Path(a.ledger), a.kind, a.closed)
    else:
        res = check_history(repo, Path(a.never_show))
    sys.stdout.write(json.dumps(res, sort_keys=True, ensure_ascii=True) + "\n")
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
