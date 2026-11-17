#!/usr/bin/env python3
"""The git-history facts of DC-17 and DC-18 for dead-code candidates, computed the same way
every time.

Purpose
    DC-17 keeps work in progress at T2, and DC-18 names the retired feature before a deletion.
    The autonomous pilot read every line of a three-week-old repository as "recent" because
    "recently" had no definition (pilot-auto-calibration A01-F17). This script judges work in
    progress from the base branch's commit history, never from calendar time, with git
    plumbing only. For each (symbol, defining file):
      event            orphaned: the newest first-parent commit that removed the last
                       occurrence outside the defining file (its old paths across renames
                       excluded); never-referenced: no occurrence outside the file in any
                       commit that changed the symbol's count; referenced-at-base; undetermined;
                       not-found (the file is not in the base commit); not-checked (time budget)
      later_commits    first-parent commits after the event, up to the base
      explicit_removal the orphaning commit's message names a removal (remove, delete, drop,
                       deprecate, clean up, retire, obsolete)
      other_refs       branches, tags or the stash the base does not contain that still
                       reference the symbol outside its file
      wip_markers      TODO, FIXME, WIP, "not yet used", "will be used", "placeholder" ... from
                       3 lines above to 30 below the definition, or WIP words in the introducing
                       commit's message
      future_work      covered | not covered | unknown. The profile's `future_work` counts as an
                       answer only when it is a non-empty list: absent or [] is unknown, because
                       the profile template pre-fills []; --future-work / --future-work-none carry
                       a live --interactive answer
      wip              true when any reason holds; doubt keeps it true (truncated history, no
                       event, time budget spent, file not found)
      evidence_level   "n/a: referenced at base (...)", "T2 (work in progress)",
                       "E2 eligible" (orphaned by an explicit removal, not wip) or "E1 at most"
    A text count cannot tell a call from a comment or a string, so a hit keeps the code
    referenced (DC-17). generic_name flags names shorter than 3 characters or common words; it
    is a warning, not a veto (DC-08 decides).

CLI
    python dead_history.py [NAME@PATH ...] [--symbols-from FILE] [--base REV] [--repo DIR]
                           [--profile FILE] [--future-work GLOB ...] [--future-work-none]
                           [--max-commits N] [--timeout SECONDS] [--out FILE|-] [--json]
    (use python3 on macOS/Linux)
    --symbols-from  ts-program.json (its `unreferenced` and `test-only` exports), a JSON list of
                    {"symbol", "file"}, or text lines NAME@PATH
    --base          default: base_sha of .harden/active, else HEAD
    --profile       default .harden/profile.json when it exists
    --max-commits   pickaxe commits examined per symbol (default 200); beyond it the history
                    counts as truncated
    --timeout       seconds for the whole run (default 600); symbols left when it runs out are
                    `not-checked` and wip
    --out           default .harden/tools/dead-history.json; '-' prints the JSON
    --json          print the JSON to stdout as well

Exit codes
    0  ran (an empty symbol list included)
    2  usage error: not a git repository, a bad base, an unparsable --symbols-from or a
       malformed NAME@PATH
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)

VERSION = 1
GIT_TIMEOUT_S = 120
REMOVAL_RE = re.compile(r"\b(remov|delet|drop|deprecat|clean ?up|retir|obsolete)\w*", re.I)
MARKER_RE = re.compile(r"\b(TODO|FIXME|WIP|XXX|HACK)\b|not (yet )?(used|wired|called)|"
                       r"will be used|for later|upcoming|placeholder|in progress", re.I)
COMMIT_WIP_RE = re.compile(r"\bWIP\b|work in progress|\bdraft\b|\bstub\b|scaffold|placeholder|"
                           r"groundwork", re.I)
DEF_WORDS = r"\b(function|def|fn|func|class|const|let|var|type|interface|enum|struct|trait|static|pub)\b"
GENERIC_NAMES = {"get", "set", "run", "init", "main", "data", "value", "item", "name", "id"}

_now: Callable[[], float] = time.monotonic


class UsageError(Exception):
    """Bad arguments (exit 2)."""


class Git:
    """A git runner that records every command it runs."""

    def __init__(self, repo: Path) -> None:
        self.repo = repo
        self.log: List[str] = []

    def run(self, args: Sequence[str]) -> Tuple[int, str]:
        cmd = ["git", "-c", "core.quotepath=false", "-c", "color.ui=never"] + list(args)
        self.log.append(" ".join(args))
        try:
            proc = subprocess.run(cmd, cwd=str(self.repo), capture_output=True,
                                  env=C.git_env(), timeout=GIT_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return 128, str(exc)
        return proc.returncode, proc.stdout.decode("utf-8", errors="replace")

    def ok(self, args: Sequence[str]) -> Optional[str]:
        code, out = self.run(args)
        return out if code == 0 else None


def _word_re(symbol: str) -> str:
    return r"(?<![\w$])" + re.escape(symbol) + r"(?![\w$])"


class History:
    """The facts for one symbol."""

    def __init__(self, git: Git, base: str, symbol: str, path: str,
                 max_commits: int) -> None:
        self.git = git
        self.base = base
        self.symbol = symbol
        self.path = path
        self.max_commits = max_commits
        self.excludes: List[str] = []
        self._outside: Dict[str, int] = {}

    def defining_paths(self) -> List[str]:
        out = self.git.ok(["log", "--follow", "--name-status", "--format=%x00%H", self.base,
                           "--", self.path]) or ""
        paths: Set[str] = {self.path}
        for line in out.splitlines():
            parts = line.split("\t")
            if len(parts) >= 2 and parts[0][:1] in "ACDMRT":
                for p in parts[1:]:
                    if p:
                        paths.add(p)
        return sorted(paths)

    def outside(self, rev: str) -> int:
        """Occurrences of the symbol as a word outside its defining file(s) at `rev`."""
        if rev in self._outside:
            return self._outside[rev]
        args = ["grep", "-c", "-w", "-F", "-e", self.symbol, rev, "--", "."]
        args += [":(exclude,literal){}".format(p) for p in self.excludes]
        code, out = self.git.run(args)
        total = 0
        if code == 0:
            for line in out.splitlines():
                head, _, count = line.rpartition(":")
                if head and count.strip().isdigit():
                    total += int(count)
        self._outside[rev] = total
        return total

    def parent_outside(self, sha: str) -> int:
        parent = self.git.ok(["rev-parse", "--verify", "-q", sha + "^"])
        return self.outside(parent.strip()) if parent else 0


def commit_info(git: Git, sha: Optional[str]) -> Optional[Dict[str, str]]:
    if not sha:
        return None
    out = git.ok(["log", "-1", "--format=%H%x00%cs%x00%s", sha]) or ""
    parts = out.strip().split("\0")
    if len(parts) < 3:
        return {"sha": sha, "date": "", "subject": ""}
    return {"sha": parts[0], "date": parts[1], "subject": parts[2]}


def future_work_status(path: str, globs: Optional[List[str]]) -> str:
    if globs is None:
        return "unknown"
    return "covered" if globs and C.match_any(path, globs) else "not covered"


def find_markers(git: Git, base: str, path: str, symbol: str,
                 introduced: Optional[str]) -> List[Dict[str, Any]]:
    hits: List[Dict[str, Any]] = []
    text = git.ok(["show", "{}:{}".format(base, path)]) or ""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    def_re = re.compile(DEF_WORDS + r"[^\n]*" + _word_re(symbol))
    word = re.compile(_word_re(symbol))
    at = next((i for i, l in enumerate(lines) if def_re.search(l)), None)
    if at is None:
        at = next((i for i, l in enumerate(lines) if word.search(l)), None)
    if at is not None:
        for i in range(max(0, at - 3), min(len(lines), at + 31)):
            if MARKER_RE.search(lines[i]):
                hits.append({"where": "definition", "line": i + 1,
                             "text": lines[i].strip()[:200]})
    if introduced:
        message = git.ok(["log", "-1", "--format=%s%n%b", introduced]) or ""
        for line in message.splitlines():
            if COMMIT_WIP_RE.search(line):
                hits.append({"where": "introducing-commit", "line": None,
                             "text": line.strip()[:200]})
    return hits


def unmerged_refs(git: Git, base: str) -> List[Tuple[str, str]]:
    out = git.ok(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes",
                  "refs/tags"]) or ""
    refs = [r.strip() for r in out.splitlines() if r.strip()]
    if git.ok(["rev-parse", "--verify", "-q", "refs/stash"]):
        refs.append("refs/stash")
    result: List[Tuple[str, str]] = []
    for ref in refs:
        sha = git.ok(["rev-parse", "--verify", "-q", ref + "^{commit}"])
        if not sha:
            continue
        code, _ = git.run(["merge-base", "--is-ancestor", ref, base])
        if code == 0:
            continue
        result.append((ref, sha.strip()))
    return result


def analyse_symbol(git: Git, base: str, symbol: str, path: str, future_globs: Optional[List[str]],
                   max_commits: int, refs: List[Tuple[str, str]]) -> Dict[str, Any]:
    start_log = len(git.log)
    rec: Dict[str, Any] = {"symbol": symbol, "file": path, "event": None, "introduced_in": None,
                           "orphaned_in": None, "later_commits": None, "explicit_removal": False,
                           "removal_text": None, "other_refs": [], "wip_markers": [],
                           "future_work": future_work_status(path, future_globs),
                           "generic_name": len(symbol) < 3 or symbol.lower() in GENERIC_NAMES,
                           "wip": False, "wip_reasons": [], "evidence_level": None,
                           "truncated": False, "commands": []}
    code, _ = git.run(["cat-file", "-e", "{}:{}".format(base, path)])
    if code != 0:
        rec["event"] = "not-found"
        rec["wip_reasons"] = ["file not found at base"]
    else:
        h = History(git, base, symbol, path, max_commits)
        h.excludes = h.defining_paths()
        listed = git.ok(["log", "--first-parent", "-S" + symbol, "--format=%H",
                         "-n", str(max_commits + 1), base, "--"]) or ""
        commits = [c for c in listed.split() if c]
        if len(commits) > max_commits:
            rec["truncated"] = True
            commits = commits[:max_commits]
        introduced = None if rec["truncated"] or not commits else commits[-1]
        rec["introduced_in"] = commit_info(git, introduced)
        at_base = h.outside(base)
        event_sha: Optional[str] = None
        if at_base > 0:
            rec["event"] = "referenced-at-base"
            rec["occurrences_at_base"] = at_base
        else:
            orphan = None
            for sha in commits:  # newest first
                if h.outside(sha) == 0 and h.parent_outside(sha) > 0:
                    orphan = sha
                    break
            if orphan:
                rec["event"] = "orphaned"
                rec["orphaned_in"] = commit_info(git, orphan)
                event_sha = orphan
                message = git.ok(["log", "-1", "--format=%s%n%b", orphan]) or ""
                for line in message.splitlines():
                    if REMOVAL_RE.search(line):
                        rec["explicit_removal"] = True
                        rec["removal_text"] = line.strip()[:200]
                        break
            elif commits and not rec["truncated"] and all(
                    h.outside(sha) == 0 and h.parent_outside(sha) == 0 for sha in commits):
                rec["event"] = "never-referenced"
                event_sha = introduced
            else:
                rec["event"] = "undetermined"
        if event_sha:
            count = git.ok(["rev-list", "--count", "--first-parent",
                            "{}..{}".format(event_sha, base)])
            rec["later_commits"] = int(count.strip()) if count and count.strip().isdigit() else None
        for ref, sha in refs:
            if h.outside(sha) > 0:
                rec["other_refs"].append(ref)
        rec["wip_markers"] = find_markers(git, base, path, symbol, introduced)
        reasons: List[str] = []
        if rec["later_commits"] == 0:
            reasons.append("event is the base commit")
        reasons += ["referenced from unmerged {}".format(r) for r in rec["other_refs"]]
        reasons += ["marker: {}".format(m["text"]) for m in rec["wip_markers"]]
        if rec["future_work"] == "covered":
            reasons.append("declared future work")
        if rec["event"] == "never-referenced" and rec["future_work"] == "unknown":
            reasons.append("never referenced and no declared future work")
        if rec["truncated"]:
            reasons.append("history truncated at --max-commits")
        if rec["event"] == "undetermined":
            reasons.append("history undetermined")
        rec["wip_reasons"] = reasons
    rec["wip"] = bool(rec["wip_reasons"])
    if rec["event"] == "referenced-at-base":
        rec["evidence_level"] = "n/a: referenced at base ({} occurrences outside its file)".format(
            rec.get("occurrences_at_base", 0))
    elif rec["wip"]:
        rec["evidence_level"] = "T2 (work in progress)"
    elif rec["event"] == "orphaned" and rec["explicit_removal"]:
        rec["evidence_level"] = "E2 eligible"
    else:
        rec["evidence_level"] = "E1 at most"
    rec["commands"] = git.log[start_log:]
    return rec


def not_checked(symbol: str, path: str, future_globs: Optional[List[str]]) -> Dict[str, Any]:
    return {"symbol": symbol, "file": path, "event": "not-checked", "introduced_in": None,
            "orphaned_in": None, "later_commits": None, "explicit_removal": False,
            "removal_text": None, "other_refs": [], "wip_markers": [],
            "future_work": future_work_status(path, future_globs),
            "generic_name": len(symbol) < 3 or symbol.lower() in GENERIC_NAMES, "wip": True,
            "wip_reasons": ["time budget spent"], "evidence_level": "T2 (work in progress)",
            "truncated": False, "commands": []}


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------
def parse_spec(spec: str) -> Tuple[str, str]:
    if "@" not in spec:
        raise UsageError("{!r} is not NAME@PATH".format(spec))
    name, path = spec.split("@", 1)
    path = path.strip().replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    if not name.strip() or not path:
        raise UsageError("{!r} is not NAME@PATH".format(spec))
    return name.strip(), path


def load_symbols_from(path: Path) -> List[Tuple[str, str]]:
    try:
        text = path.read_bytes().decode("utf-8-sig", errors="replace")
    except OSError as exc:
        raise UsageError("cannot read {}: {}".format(path, exc)) from exc
    stripped = text.strip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            data = json.loads(stripped)
        except ValueError as exc:
            raise UsageError("{}: not valid JSON: {}".format(path, exc)) from exc
        out: List[Tuple[str, str]] = []
        if isinstance(data, dict) and isinstance(data.get("symbols"), list):
            for s in data["symbols"]:
                if isinstance(s, dict) and s.get("status") in ("unreferenced", "test-only"):
                    out.append((str(s["name"]), str(s["file"]).replace("\\", "/")))
            return out
        if isinstance(data, list):
            for s in data:
                if not (isinstance(s, dict) and isinstance(s.get("symbol"), str)
                        and isinstance(s.get("file"), str)):
                    raise UsageError("{}: each entry needs \"symbol\" and \"file\"".format(path))
                out.append((s["symbol"], s["file"].replace("\\", "/")))
            return out
        raise UsageError("{}: unrecognised JSON".format(path))
    out = []
    for line in text.splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(parse_spec(line))
    return out


def load_future_work(profile: Optional[Path]) -> Optional[List[str]]:
    """Globs when the profile's future_work is a non-empty list, else None (unknown)."""
    if profile is None or not profile.is_file():
        return None
    try:
        data = C.read_json(profile)
    except (OSError, ValueError):
        return None
    value = data.get("future_work") if isinstance(data, dict) else None
    if isinstance(value, list):
        globs = [g for g in value if isinstance(g, str) and g.strip()]
        return globs or None
    return None


def default_base(repo: Path) -> str:
    try:
        marker = C.read_json(repo / ".harden" / "active")
    except (OSError, ValueError):
        marker = None
    if isinstance(marker, dict) and isinstance(marker.get("base_sha"), str):
        return marker["base_sha"]
    return "HEAD"


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        prog="dead_history.py",
        description="Git-history facts for dead-code candidates (DC-17, DC-18).")
    parser.add_argument("specs", nargs="*", metavar="NAME@PATH")
    parser.add_argument("--symbols-from")
    parser.add_argument("--base")
    parser.add_argument("--repo")
    parser.add_argument("--profile")
    parser.add_argument("--future-work", action="append", default=None, metavar="GLOB")
    parser.add_argument("--future-work-none", action="store_true")
    parser.add_argument("--max-commits", type=int, default=200)
    parser.add_argument("--timeout", type=float, default=600.0)
    parser.add_argument("--out")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        start = Path(args.repo) if args.repo else Path.cwd()
        top = C.git_ok(start, ["rev-parse", "--show-toplevel"]) if C.git_available() else None
        if not top:
            raise UsageError("{} is not in a git repository".format(C.posix_abs(start)))
        repo = Path(top)
        git = Git(repo)
        base_arg = args.base or default_base(repo)
        base = git.ok(["rev-parse", "--verify", "-q", base_arg + "^{commit}"])
        if not base:
            raise UsageError("base {!r} names no commit".format(base_arg))
        base = base.strip()
        pairs: List[Tuple[str, str]] = [parse_spec(s) for s in args.specs]
        if args.symbols_from:
            pairs += load_symbols_from(Path(args.symbols_from))
        if args.max_commits < 1:
            raise UsageError("--max-commits must be at least 1")
    except UsageError as exc:
        print("dead_history.py: {}".format(exc), file=sys.stderr)
        return 2
    if args.future_work_none:
        future: Optional[List[str]] = []
    elif args.future_work:
        future = [g.replace("\\", "/") for g in args.future_work]
    else:
        profile = Path(args.profile) if args.profile else repo / ".harden" / "profile.json"
        future = load_future_work(profile)
    deadline = _now() + args.timeout
    refs = unmerged_refs(git, base) if pairs else []
    seen: Set[Tuple[str, str]] = set()
    results: List[Dict[str, Any]] = []
    for name, path in pairs:
        if (name, path) in seen:
            continue
        seen.add((name, path))
        if _now() > deadline:
            results.append(not_checked(name, path, future))
            continue
        results.append(analyse_symbol(git, base, name, path, future, args.max_commits, refs))
    data = {"tool": "dead_history.py", "version": VERSION, "base": base,
            "generated": C.utc_iso(), "future_work": future, "symbols": results}
    out = args.out or str(repo / ".harden" / "tools" / "dead-history.json")
    if out == "-":
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        C.write_json(Path(out), data)
        if args.json:
            print(json.dumps(data, indent=2, ensure_ascii=False))
        else:
            wip = sum(1 for r in results if r["wip"])
            print("dead_history.py: {} symbols, {} work in progress -> {}".format(
                len(results), wip, out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
