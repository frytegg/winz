#!/usr/bin/env python3
"""Rank where hardening work should look first and write .harden/rank.json.

Purpose
    Location signals per tracked source file, for ORDERING maintainability work (never for
    excluding files, and never for security work, which stays consequence-ranked:
    hotspot-evidence G104-F13, prioritization T19-F09).

    - Generated/vendored code, lockfiles, docs, snapshots and non-source files are excluded;
      test files are ranked in a separate list (prioritization T19-F04).
    - History signals (first-parent, rename-folded, noise-filtered; G104-F06/F07/F09; each
      first-parent merge counts as one event per file, like a squash commit, see _common.py):
      commits touching the file, fix-labelled commits (keyword regex, a noisy label, G104-F08),
      churned lines and churn relative to current LOC (T19-F05), inside a window anchored at
      the LAST commit (default 12 months, T19-F03; a finished project is anchored at its last
      commit, G104-F11).
    - score = sum of 2^(-age/half-life) over change events + the same sum over fix-labelled
      events (half-life 90 days). This is a labelled convention (G104-F01, grade C): no study
      validates this simple score, and its closest benchmarked relative ranked below LOC.
    - History ranking is used ONLY when (a) the inventory's history-sufficiency gate passes
      (G104-F04, recomputed here) and (b) a time-split backtest shows it beats size order:
      rank with history up to (last commit - 90 days), then count fix-labelled files after the
      cut among the top 10 of each ordering (G104-F19). Otherwise method = "size-descending"
      (ManualDown, the mandatory baseline of G104-F03) and the notes say why.
    - Files with fewer than --min-revs commits in the window cannot rank on history
      (code-maat's --min-revs default 5, T19-F05); they follow the ranked files.
    - Temperature (G101-F01, finished-project-scope): "hot" when the file changed within the
      window length before today, else "cold". Dormant-but-activatable code is not detectable
      here. The 12-month window is a heuristic, not a sourced number.
    - If `lizard` is on PATH, the maximum function-level cyclomatic complexity per file is added
      (function level is where complexity keeps its value, G104-F02); otherwise it is omitted
      and the notes say so. No other external tool is called.

CLI
    python rank.py [--repo DIR] [--inventory FILE] [--since 12.months] [--top 50]
                   [--half-life-days 90] [--min-revs 5] [--out FILE] [--no-lizard] [--json]
    (use python3 on macOS/Linux)
    --since   window: N.days|weeks|months|years, YYYY-MM-DD, or "all" (relative windows end at
              the last commit)
    --top     number of entries kept in each of files[] and tests[] (0 = all)
    Reads .harden/config.json when present: "scope" globs restrict the ranking, "exclude_globs"
    remove paths, "test_globs" add test paths. When .harden/inventory.json is missing it is built
    first (and written).

Exit codes
    0  rank.json written
    2  usage or environment error (bad --since, directory missing, git failure)
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as C  # noqa: E402
import inventory as INV  # noqa: E402

BACKTEST_HOLDOUT_S = 7776000   # 90 days (G104-F19: "T - 3 months")
TOP_K = 10                     # hits@10 in the backtest and the overlap check (G104-F01/F19)
OVERLAP_LITTLE = 8             # "If they overlap by 8 or more, history adds little beyond size"
LIZARD_TIMEOUT_S = 600


@dataclass
class FileStats:
    """History statistics of one file inside the window."""
    commits: Set[str] = field(default_factory=set)
    fixes: Set[str] = field(default_factory=set)
    churn: int = 0
    score: float = 0.0
    last_ct: Optional[int] = None


def history_stats(history: C.History, start_ct: Optional[int], end_ct: int, anchor_ct: int,
                  half_life_days: float) -> Dict[str, FileStats]:
    """Aggregate filtered events with start_ct <= ct <= end_ct, weights anchored at anchor_ct."""
    stats: Dict[str, FileStats] = {}
    for ev in history.events():
        if ev.ct > end_ct or (start_ct is not None and ev.ct < start_ct):
            continue
        st = stats.setdefault(ev.path, FileStats())
        w = C.recency_weight(ev.ct, anchor_ct, half_life_days)
        if ev.sha not in st.commits:
            st.commits.add(ev.sha)
            st.score += w
            if ev.is_fix:
                st.fixes.add(ev.sha)
                st.score += w
        st.churn += ev.churn
        st.last_ct = ev.ct if st.last_ct is None else max(st.last_ct, ev.ct)
    return stats


def last_change(history: C.History) -> Dict[str, int]:
    """Latest filtered change time per (current) path over the whole history."""
    out: Dict[str, int] = {}
    for ev in history.events():
        if ev.ct > out.get(ev.path, -1):
            out[ev.path] = ev.ct
    return out


def history_order(paths: Sequence[str], stats: Dict[str, FileStats], loc: Dict[str, int],
                  min_revs: int) -> List[str]:
    """Eligible files (>= min_revs commits) by score, then the rest by score; ties by LOC."""
    def key(p: str) -> Tuple[int, float, int, str]:
        st = stats.get(p)
        n = len(st.commits) if st else 0
        return (0 if n >= min_revs else 1, -(st.score if st else 0.0), -loc.get(p, 0), p)
    return sorted(paths, key=key)


def size_order(paths: Sequence[str], loc: Dict[str, int]) -> List[str]:
    """ManualDown: largest first (G104-F03)."""
    return sorted(paths, key=lambda p: (-loc.get(p, 0), p))


# ---------------------------------------------------------------------------
# Backtest (G104-F19)
# ---------------------------------------------------------------------------


def cat_file_batch(repo: Path, specs: Sequence[str]) -> Dict[str, bytes]:
    """Contents of `<rev>:<path>` objects through one `git cat-file --batch` call."""
    if not specs:
        return {}
    payload = ("\n".join(specs) + "\n").encode("utf-8")
    raw = C.git_bytes(repo, ["cat-file", "--batch"], input_bytes=payload, check=False)
    out: Dict[str, bytes] = {}
    pos = 0
    for spec in specs:
        nl = raw.find(b"\n", pos)
        if nl == -1:
            break
        header = raw[pos:nl].decode("utf-8", errors="replace")
        pos = nl + 1
        parts = header.split()
        if len(parts) == 3 and parts[2].isdigit():
            size = int(parts[2])
            out[spec] = raw[pos:pos + size]
            pos += size + 1
        # "<spec> missing" / "ambiguous": nothing to read
    return out


def files_at(repo: Path, rev: str) -> List[str]:
    """Paths in the tree of a revision."""
    raw = C.git_bytes(repo, ["ls-tree", "-r", "-z", "--name-only", rev], check=False)
    return [C.to_posix(p) for p in raw.decode("utf-8", errors="replace").split("\0") if p]


def run_backtest(repo: Path, history: C.History, anchor_ct: int, window: C.Window,
                 half_life_days: float, min_revs: int,
                 is_source_path: Callable[[str], bool]) -> Dict[str, Any]:
    """Time-split backtest of the history ranking against ManualDown (G104-F19)."""
    cut = anchor_ct - BACKTEST_HOLDOUT_S
    result: Dict[str, Any] = {"cut_date": C.utc_date(cut), "holdout_days": 90, "k": TOP_K,
                              "passed": False}
    cut_rev = C.git_ok(repo, ["rev-list", "-1", "--first-parent", "--before={}".format(cut),
                              "HEAD"])
    if not cut_rev:
        result["reason"] = "no commit before the cut-off"
        return result
    result["cut_commit"] = cut_rev[:12]
    # Source files present at the cut, identified by their current (rename-folded) names.
    at_cut: Dict[str, str] = {}
    for p in files_at(repo, cut_rev):
        if is_source_path(p):
            at_cut.setdefault(history.resolve(p), p)
    blobs = cat_file_batch(repo, ["{}:{}".format(cut_rev, p) for p in at_cut.values()])
    loc_cut: Dict[str, int] = {}
    for cur, old in at_cut.items():
        data = blobs.get("{}:{}".format(cut_rev, old))
        if data is None:
            continue
        n = C.count_loc(data)
        if n is None or C.header_has_generated_marker(
                data[:INV.HEADER_READ_BYTES].decode("utf-8", errors="replace")):
            continue
        loc_cut[cur] = n
    candidates = sorted(loc_cut)
    stats_cut = history_stats(history, window.start_for(cut), cut, cut, half_life_days)
    hist_top = [p for p in history_order(candidates, stats_cut, loc_cut, min_revs)
                if p in stats_cut][:TOP_K]
    size_top = size_order(candidates, loc_cut)[:TOP_K]
    fixed_after: Set[str] = set()
    fix_commits_after: Set[str] = set()
    for ev in history.events():
        if ev.ct > cut and ev.is_fix:
            fixed_after.add(ev.path)
            fix_commits_after.add(ev.sha)
    hits_hist = sum(1 for p in hist_top if p in fixed_after)
    hits_size = sum(1 for p in size_top if p in fixed_after)
    result.update({
        "fix_commits_after_cut": len(fix_commits_after),
        "files_fixed_after_cut": len(fixed_after),
        "history_top": hist_top, "size_top": size_top,
        "hits_history": hits_hist, "hits_size": hits_size,
        "passed": hits_hist > hits_size,
    })
    if not fix_commits_after:
        result["reason"] = ("no fix-labelled commit after the cut-off: the backtest cannot show "
                            "that history beats size")
    elif hits_hist <= hits_size:
        result["reason"] = "history hits@10 ({}) does not exceed size hits@10 ({})".format(
            hits_hist, hits_size)
    else:
        result["reason"] = "history hits@10 ({}) exceeds size hits@10 ({})".format(
            hits_hist, hits_size)
    if len(fix_commits_after) < 5:
        result["caveat"] = ("few fix commits in the holdout: hits@10 of 1-3 is a sanity check, "
                            "not a statistically meaningful result (G104-F19)")
    return result


# ---------------------------------------------------------------------------
# lizard (optional, only when already installed)
# ---------------------------------------------------------------------------


def lizard_max_ccn(repo: Path, paths: Sequence[str]) -> Tuple[Optional[Dict[str, int]], str]:
    """Max function CCN per file from `lizard --csv`, or (None, reason) when unavailable."""
    exe = shutil.which("lizard")
    if not exe:
        return None, "lizard is not on PATH: function-level complexity (max_ccn) omitted"
    if not paths:
        return {}, "lizard: no source files to analyse"
    wanted = {C.to_posix(p): p for p in paths}
    result: Dict[str, int] = {}
    chunks: List[List[str]] = [[]]
    size = 0
    for p in paths:
        if size + len(p) > 20000 and chunks[-1]:
            chunks.append([])
            size = 0
        chunks[-1].append(p)
        size += len(p) + 1
    deadline = time.monotonic() + LIZARD_TIMEOUT_S
    for chunk in chunks:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return result, "lizard: time budget exhausted; max_ccn is partial"
        try:
            proc = subprocess.run([exe, "--csv"] + chunk, cwd=str(repo), stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, timeout=remaining, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            return (result or None), "lizard failed: {}".format(exc)
        text = proc.stdout.decode("utf-8", errors="replace")
        for row in csv.reader(io.StringIO(text)):
            if len(row) < 2 or not row[1].strip().isdigit():
                continue
            ccn = int(row[1].strip())
            for cell in row[2:]:
                norm = C.to_posix(cell.strip())
                while norm.startswith("./"):
                    norm = norm[2:]
                if norm in wanted:
                    result[norm] = max(result.get(norm, 0), ccn)
                    break
    return result, ("lizard {}: max_ccn = highest function cyclomatic complexity per file; "
                    "compare only within one language (T19-F07); files lizard does not parse "
                    "have no value (T25-F06)").format(C.to_posix(exe))


# ---------------------------------------------------------------------------
# Main ranking
# ---------------------------------------------------------------------------


def load_config_globs(repo: Path) -> Tuple[List[str], List[str], List[str], List[str]]:
    """(scope, exclude_globs, test_globs, notes) from .harden/config.json when present."""
    path = C.harden_dir(repo) / "config.json"
    if not path.is_file():
        return [], [], [], []
    try:
        data = C.read_json(path)
    except (OSError, ValueError) as exc:
        return [], [], [], ["could not read .harden/config.json: {}".format(exc)]
    if not isinstance(data, dict):
        return [], [], [], [".harden/config.json is not an object; ignored"]

    def strs(key: str) -> List[str]:
        val = data.get(key)
        return [str(v) for v in val] if isinstance(val, list) else []
    return strs("scope"), strs("exclude_globs"), strs("test_globs"), []


def rank_repository(info: C.RepoInfo, inventory: Optional[Dict[str, Any]], window: C.Window,
                    top: int, half_life_days: float, min_revs: int, use_lizard: bool,
                    now_ts: Optional[float] = None) -> Dict[str, Any]:
    """Compute the ranking document."""
    repo = info.root
    notes: List[str] = list(info.notes)
    now = time.time() if now_ts is None else now_ts
    if inventory is None:
        inventory = INV.build_inventory(info)
        C.ensure_harden_dir(repo, info.is_repo)
        C.write_json(C.harden_dir(repo) / "inventory.json", inventory)
        notes.append(".harden/inventory.json was missing; it was built and written first")
    scope, exclude_globs, extra_tests, cfg_notes = load_config_globs(repo)
    notes.extend(cfg_notes)

    files, _src = C.list_files(repo, info.is_repo)
    files = [f for f in files if not f.startswith(C.HARDEN_DIR_NAME + "/")]
    infos = INV.scan_files(repo, files, info.is_repo)
    inv_generated = C.generated_entries_matcher(inventory.get("generated_or_vendor", []))
    inv_tests = [str(g) for g in inventory.get("test_globs", [])] + extra_tests

    excluded_counts = {"generated_or_vendor": 0, "lockfile": 0, "doc": 0, "snapshot": 0,
                       "non_source": 0, "binary_or_unreadable": 0, "config_exclude": 0,
                       "out_of_scope": 0}
    source: List[INV.FileInfo] = []
    tests: List[INV.FileInfo] = []
    for i in infos:
        if scope and not C.match_any(i.path, scope):
            excluded_counts["out_of_scope"] += 1
        elif exclude_globs and C.match_any(i.path, exclude_globs):
            excluded_counts["config_exclude"] += 1
        elif i.is_generated or inv_generated(i.path):
            excluded_counts["generated_or_vendor"] += 1
        elif i.lock_manager is not None:
            excluded_counts["lockfile"] += 1
        elif i.is_doc:
            excluded_counts["doc"] += 1
        elif i.is_snapshot:
            excluded_counts["snapshot"] += 1
        elif not C.is_source_language(i.language):
            excluded_counts["non_source"] += 1
        elif i.loc is None:
            excluded_counts["binary_or_unreadable"] += 1
        elif i.is_test or (inv_tests and C.match_any(i.path, inv_tests)):
            tests.append(i)
        else:
            source.append(i)
    loc = {i.path: i.loc or 0 for i in source + tests}
    lang = {i.path: i.language for i in source + tests}
    gen_files = {i.path for i in infos if i.is_generated}
    vprefixes = sorted(INV.vendor_prefixes(repo, files))

    def is_excluded(path: str) -> bool:
        return (path in gen_files or inv_generated(path)
                or C.path_generated_reason(path, vprefixes) is not None
                or C.lockfile_manager(path) is not None or C.is_snapshot_path(path))

    def is_source_path(path: str) -> bool:
        if is_excluded(path) or C.is_doc_path(path) or C.is_test_path(path):
            return False
        if inv_tests and C.match_any(path, inv_tests):
            return False
        if scope and not C.match_any(path, scope):
            return False
        if exclude_globs and C.match_any(path, exclude_globs):
            return False
        return C.is_source_language(C.language_of(path))

    history: Optional[C.History] = None
    verdict: Dict[str, Any] = {"sufficient": False, "reasons": [], "criteria": {}}
    head = C.head_sha(repo) if info.is_repo else None
    if info.is_repo and head:
        history = C.load_history(repo, is_excluded)
        shallow = C.git_ok(repo, ["rev-parse", "--is-shallow-repository"]) == "true"
        adoption_ct, adoption_marker = C.agent_adoption(
            repo, C.load_commit_metadata(repo, first_parent=False))
        verdict = C.evaluate_sufficiency(history, adoption_ct, adoption_marker, shallow)
        inv_git = inventory.get("git", {}) if isinstance(inventory.get("git"), dict) else {}
        if inv_git.get("head") and inv_git.get("head") != head:
            notes.append("inventory.json was built at {} but HEAD is {}; the history gate was "
                         "recomputed".format(str(inv_git.get("head"))[:12], head[:12]))
        if "history_sufficient" in inv_git and bool(inv_git["history_sufficient"]) != \
                bool(verdict["sufficient"]):
            notes.append("history-sufficiency verdict differs from inventory.json; the "
                         "recomputed verdict ({}) is used".format(verdict["sufficient"]))
    elif info.is_repo:
        verdict["reasons"] = ["no commits yet (unborn branch)"]
    else:
        verdict["reasons"] = ["not a git repository"]

    anchor_ct: Optional[int] = None
    stats: Dict[str, FileStats] = {}
    last_ct: Dict[str, int] = {}
    window_info: Dict[str, Any] = {"since": window.spec, "anchor": "last commit"}
    if history is not None and history.commits:
        anchor_ct = max(c.ct for c in history.commits)
        start = window.start_for(anchor_ct)
        window_info.update({"start_date": C.utc_date(start) if start is not None else None,
                            "end_date": C.utc_date(anchor_ct),
                            "merge_mode": history.merge_mode})
        last_ct = last_change(history)
        if verdict["sufficient"]:
            stats = history_stats(history, start, anchor_ct, anchor_ct, half_life_days)

    # Temperature (G101-F01): changed within the window length before today.
    if window.start_ts is not None:
        temp_start = float(window.start_ts)
    else:
        temp_start = now - (window.days if window.days is not None else 365.25) * C.SECONDS_PER_DAY

    def temperature(path: str) -> str:
        if not last_ct:
            return "unknown"
        ct = last_ct.get(path)
        if ct is None:
            return "unknown"
        return "hot" if ct >= temp_start else "cold"

    backtest: Optional[Dict[str, Any]] = None
    method = "size-descending"
    if verdict["sufficient"] and history is not None and anchor_ct is not None:
        backtest = run_backtest(repo, history, anchor_ct, window, half_life_days, min_revs,
                                is_source_path)
        if backtest.get("passed"):
            method = "history-recency-weighted"
            notes.append("history ranking used: the sufficiency gate passed and the time-split "
                         "backtest showed history beating size ({})".format(backtest["reason"]))
        else:
            notes.append("history passed the sufficiency gate but did not beat size in the "
                         "time-split backtest ({}); files are ordered by size (G104-F19)"
                         .format(backtest.get("reason")))
    else:
        notes.append("history ranking skipped: {}. Files are ordered by size, largest first "
                     "(ManualDown, the mandatory baseline of G104-F03); commits, fixes and "
                     "score are not computed. Order the work with the fallback ladder: "
                     "consequence classes, entry points, high-precision findings, largest "
                     "functions, uncovered error handling (G104-F12)".format(
                         "; ".join(verdict["reasons"]) or "history is not sufficient"))

    lizard_map: Optional[Dict[str, int]] = None
    if use_lizard:
        lizard_map, lizard_note = lizard_max_ccn(repo, [i.path for i in source + tests])
        notes.append(lizard_note)
    else:
        notes.append("lizard disabled (--no-lizard): max_ccn omitted")

    def order(items: Sequence[INV.FileInfo]) -> List[str]:
        paths = [i.path for i in items]
        if method == "history-recency-weighted":
            return history_order(paths, stats, loc, min_revs)
        return size_order(paths, loc)

    def entry(path: str) -> Dict[str, Any]:
        e: Dict[str, Any] = {"path": path, "language": lang.get(path), "loc": loc.get(path, 0)}
        if verdict["sufficient"]:
            st = stats.get(path, FileStats())
            n = len(st.commits)
            e.update({"commits": n, "fixes": len(st.fixes), "churn": st.churn,
                      "relative_churn": round(st.churn / loc[path], 3) if loc.get(path) else None,
                      "score": round(st.score, 3), "eligible": n >= min_revs})
        else:
            e.update({"commits": None, "fixes": None, "churn": None, "relative_churn": None,
                      "score": None})
        lc = last_ct.get(path)
        e["last_changed"] = C.utc_date(lc) if lc is not None else None
        e["temperature"] = temperature(path)
        if lizard_map is not None:
            e["max_ccn"] = lizard_map.get(path)
        return e

    def ranked(items: Sequence[INV.FileInfo]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        nxt = 1
        for p in order(items):
            e = entry(p)
            if method == "history-recency-weighted" and not e.get("eligible", True):
                e["rank"] = None
            else:
                e["rank"] = nxt
                nxt += 1
            out.append(e)
        return out

    files_ranked = ranked(source)
    tests_ranked = ranked(tests)

    if verdict["sufficient"]:
        hist_top = [p for p in history_order([i.path for i in source], stats, loc, min_revs)
                    if p in stats][:TOP_K]
        size_top = size_order([i.path for i in source], loc)[:TOP_K]
        overlap = len(set(hist_top) & set(size_top))
        overlap_info = {"k": TOP_K, "overlap": overlap, "history_top": hist_top,
                        "size_top": size_top}
        if overlap >= OVERLAP_LITTLE:
            notes.append("top-{} by history and by size overlap on {} files: history adds little "
                         "beyond size here (G104-F01 manual check)".format(TOP_K, overlap))
        notes.append("score = sum of 2^(-age/{}d) over change events plus the same over "
                     "fix-labelled events, anchored at the last commit; a convention (G104-F01, "
                     "grade C), not a validated predictor".format(half_life_days))
        notes.append("files with fewer than {} commits in the window have rank null (T19-F05 "
                     "revision floor, code-maat default)".format(min_revs))
        notes.append("fix labels come from a keyword regex and are noisy; read the recent fix "
                     "commits of a top file before calling it a bug hotspot (G104-F08)")
    else:
        overlap_info = None
    notes.append("tests are ranked in a separate list (T19-F04); the ranking orders work and "
                 "excludes nothing; security and correctness findings stay consequence-ranked "
                 "(G104-F13, T19-F09)")
    notes.append("blind spots: stable-but-hard files, short or squashed history, temporary "
                 "spikes, in-progress refactors, isolated files (T19-F23)")
    notes.append("temperature: hot = changed within the window length before today, else cold; "
                 "dormant-but-activatable code needs a manual search (G101-F01)")

    return {
        "schema_version": C.SCHEMA_VERSION,
        "generated": C.utc_iso(),
        "repo": C.posix_abs(repo),
        "head": head,
        "history_sufficient": bool(verdict["sufficient"]),
        "method": method,
        "history_gate": {"reasons": verdict.get("reasons", []),
                         "criteria": verdict.get("criteria", {})},
        "backtest": backtest,
        "top_overlap": overlap_info,
        "window": window_info,
        "half_life_days": half_life_days,
        "min_revs": min_revs,
        "excluded": excluded_counts,
        "totals": {"files": len(files_ranked), "tests": len(tests_ranked)},
        "notes": notes,
        "files": files_ranked[:top] if top > 0 else files_ranked,
        "tests": tests_ranked[:top] if top > 0 else tests_ranked,
    }


def summary_text(doc: Dict[str, Any]) -> str:
    """Human summary."""
    lines = ["method: {} (history sufficient: {})".format(doc["method"], doc["history_sufficient"])]
    if doc.get("backtest"):
        bt = doc["backtest"]
        lines.append("backtest: passed={} hits history {} vs size {} ({})".format(
            bt.get("passed"), bt.get("hits_history"), bt.get("hits_size"), bt.get("reason")))
    lines.append("files: {} ranked, tests: {}".format(doc["totals"]["files"], doc["totals"]["tests"]))
    for e in doc["files"][:20]:
        lines.append("  {:>4} {:<60} loc {:>6} commits {} fixes {} score {} {}".format(
            e["rank"] if e["rank"] is not None else "-", e["path"][:60], e["loc"], e["commits"],
            e["fixes"], e["score"], e["temperature"]))
    for n in doc["notes"]:
        lines.append("note: " + n)
    return "\n".join(lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI entry point."""
    C.configure_stdio()
    parser = argparse.ArgumentParser(description="Rank files for /harden.")
    parser.add_argument("--repo", default=".", help="repository directory (default: .)")
    parser.add_argument("--inventory", default=None, help="inventory path "
                        "(default: .harden/inventory.json)")
    parser.add_argument("--since", default="12.months", help="history window (default 12.months)")
    parser.add_argument("--top", type=int, default=50, help="entries kept per list (0 = all)")
    parser.add_argument("--half-life-days", type=float, default=C.HALF_LIFE_DAYS_DEFAULT,
                        help="recency half-life in days (default 90)")
    parser.add_argument("--min-revs", type=int, default=5, help="revision floor (default 5)")
    parser.add_argument("--out", default=None, help="output (default: .harden/rank.json)")
    parser.add_argument("--no-lizard", action="store_true", help="do not call lizard")
    parser.add_argument("--json", action="store_true", help="print the JSON to stdout")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code not in (0, None) else 0
    try:
        window = C.parse_window(args.since)
    except ValueError as exc:
        C.eprint("error: {}".format(exc))
        return 2
    if args.top < 0 or args.min_revs < 0 or args.half_life_days <= 0:
        C.eprint("error: --top and --min-revs must be >= 0 and --half-life-days > 0")
        return 2
    try:
        info = C.resolve_repo(Path(args.repo))
    except (FileNotFoundError, NotADirectoryError) as exc:
        C.eprint("error: not a directory: {}".format(exc))
        return 2
    inv_path = Path(args.inventory) if args.inventory else None
    inventory = C.load_inventory(info.root, inv_path)
    if inv_path is not None and inventory is None:
        C.eprint("error: cannot read inventory {}".format(inv_path))
        return 2
    try:
        doc = rank_repository(info, inventory, window, args.top, args.half_life_days,
                              args.min_revs, not args.no_lizard)
        if args.out:
            out = Path(args.out)
            if not out.is_absolute():
                out = Path.cwd() / out
        else:
            C.ensure_harden_dir(info.root, info.is_repo)
            out = C.harden_dir(info.root) / "rank.json"
        C.write_json(out, doc)
    except (C.GitError, OSError) as exc:
        C.eprint("error: {}".format(exc))
        return 2
    if args.json:
        print(json.dumps(doc, indent=2, ensure_ascii=False))
    else:
        print(summary_text(doc))
        print("written: {}".format(C.to_posix(str(out))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
