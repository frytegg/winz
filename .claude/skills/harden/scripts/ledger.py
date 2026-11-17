#!/usr/bin/env python3
"""ledger.py - coverage ledger of the /harden detection passes (.harden/tools/ledger.json).

Purpose
    "Absence of findings is not proof" becomes checkable: the ledger lists every in-scope file,
    records which lens pass read which lines with which model configuration, and reconciles
    raw candidates with their outcomes. It implements the ledger of references/detection.md:
      DT-01  in-scope files from `git ls-files` minus a justified exclusion list (each removal
             carries its reason); `.harden/tools/inscope.txt`; one unit per file plus optional
             slice / cross-cutting units (`.units[].files[].path`); stale blob SHAs flagged.
      DT-02  a file or unit counts as examined only from read evidence: files_read with line
             ranges; partial reads and passes marked --compacted count as partial. A unit
             read across several passes of the same lens, none compacted, is examined for that
             lens when the union of their reads covers every line; `gaps` lists the lines a
             lens left unread, as a manifest a re-dispatched pass takes as its slice and
             `record --files-from` accepts (pilot-auto-calibration A01-F19). Blank and
             closing-punctuation lines are not required (A01-F32); comment lines are.
             Reported ranges are normalised, never fatal and never widened (A01-F31).
      DT-21  one subagent id under two lenses is a problem unless the rows form one recorded
             bundle of at most three lenses (pilot-auto-calibration A01-F33); the exploration
             pass (DT-22; A01-F37) is recorded and never required.
      DT-16  raw = reported + dismissed-with-reason, for LLM candidates and for the tool
             alerts labelled in `.harden/tools/triage.json`; dismissed high/critical or
             security alerts need human or deterministic confirmation; a re-check sample of at
             least 10% and at least 5 dismissals.
      DT-18  every pass row carries model_id, effort and prompt_sha256
             (`.units[].passes[]` objects carry them too), plus tokens and tool versions.
             `record --meta-file` and `ingest --meta-file` take them, and the reads, from
             what persist_pass.py observe read in the pass's own transcript (model_source
             "transcript"); a row whose model was only claimed is a `check --final` problem
             once `.harden/agents.json` exists (pilot-auto-calibration A01-F41, A01-F43).
      DT-23  merge by union: clusters keep seen_in_passes and the cluster-to-raw map; mean
             pairwise Jaccard overlap between passes is reported.
      DT-25  budget header (budget_cap_tokens, estimate_tokens, verification_reserve,
             pass_overhead_tokens = the lens, language and schema files every pass reads;
             read tokens ~ 8.3 x LOC per full read, for a Jupyter notebook 8.3 x the non-blank
             lines of its code cells, or bytes/4 when it does not parse: its JSON lines say
             nothing about its size), Chao2 = S_obs + Q1^2/(2 Q2) or S_obs + Q1(Q1-1)/2 when
             Q2 = 0, stop reasons per unit, re-plans. The cap is the user's (--budget-cap,
             `budget --cap`); in an autonomous run (.harden/active "mode" other than
             interactive/apply, user-policy-autonomy U01-F01) `init` takes the profile's
             budget.max_tokens, and a profile without one means no cap: the header records
             budget_cap_note "no cap (autonomous default)" and `check` reports that instead of
             a missing cap. `check` warns when an autonomous run's cap differs from the
             profile's budget.max_tokens (none included).
      DT-27  candidates end verified or rejected: raw = verified + rejected + duplicates.

Files
    reads  .harden/inventory.json (generated_or_vendor), .harden/config.json (scope,
           exclude_globs), .harden/active (scope, base_sha, mode, the profile's
           budget.max_tokens), .harden/candidates.json,
           .harden/findings.json, .harden/tools/triage.json, .harden/tools/**/*.sarif;
           ingest and capture also read .harden/session.json, the subagent transcripts next
           to the session transcript and .harden/passes/raw/ (final messages and model ids
           only), and stop-budget reads .harden/budget.json
    writes .harden/tools/ledger.json, .harden/tools/inscope.txt; ingest also writes
           .harden/passes/<pass-id>.md and .gaps.json and .harden/raw-candidates.json, and
           capture its --out file under .harden/passes/

CLI (python3 on macOS/Linux; every subcommand accepts --repo DIR, default .)
    python ledger.py init [--scope PATH ...] [--exclude GLOB ...] [--budget-cap N]
                          [--verification-reserve N] [--estimate N] [--force]
    python ledger.py record --lens NAME --pass N --model ID --effort LEVEL
                            (--prompt-hash SHA256 | --prompt-file FILE)
                            (--files F ... | --files-from FILE | --meta-file META) [--candidates K]
                            [--unit ID] [--subagent-id ID] [--classes a,b] [--tokens-in N]
                            [--tokens-out N] [--tool-version NAME=VER ...] [--started ISO]
                            [--compacted] [--replace PASS_ID] [--allow-missing-metadata]
    python ledger.py merge --lens NAME --map FILE [--replace]
    python ledger.py unit --id ID [--kind slice|cross-cutting|sweep] [--files F ... |
                          --files-from FILE] [--tier TIER] [--lens NAME --stop-reason REASON]
    python ledger.py budget [--cap N] [--reserve N] [--estimate N] [--pass-overhead N]
                            [--replan TEXT]
    python ledger.py check [--lenses a,b,c] [--kinds source,test,doc,other] [--glob GLOB ...]
                           [--final] [--json]
    python ledger.py gaps --lens LENS [--unit ID] [--kinds source,test,doc,other]
                          [--glob GLOB ...] [--out FILE] [--json]
    gaps: the lines of the required files (the unit's files, or every ledger file of the lens's
    kinds, filtered by --glob) that no non-compacted pass of the lens read; --out writes them
    as [{"path", "ranges": [[start, end], ...]}] (UTF-8, LF; [] when nothing is unread).
    Exit 0 when nothing is unread, 1 when lines remain.
    check requires each lens to cover the file kinds it reads (LENS_KINDS: source and test for
    code lenses; readability-docs adds doc; ops-config, build-ci, dependencies and security add
    other), not .gitignore, README and examples for every lens; --kinds replaces the defaults
    for every lens. The kinds used are printed per lens.
    python ledger.py stats [--lenses a,b,c] [--unit ID] [--json]
    python ledger.py ingest --pass-id ID --lens LENS[,LENS[,LENS]] --pass N
                            (--meta-file META | --prompt-file FILE [--agent-id ID | --from FILE])
                            [--unit ID] [--model ID]
                            [--effort LEVEL] [--classes a,b] [--compacted] [--replace]
                            [--supplementary --copy-root DIR] [--json]
    python ledger.py stop-budget [--plan .harden/budget.json] [--json]
    python ledger.py models [--out .harden/tools/models.json] [--check-report FILE]
    --meta-file (record, ingest) is the .harden/passes/<pass-id>.meta.json that persist_pass.py
    observe completed: model, effort, subagent id, prompt hash (the task file), started, tokens,
    compaction and the Read line ranges of its transcript fill the row, which records
    model_source "transcript"; a flag that contradicts it exits 2, and a pass without an
    in-scope read is recorded as partial ("no in-scope reads"). Rows recorded without it carry
    model_source "claimed".
    models writes the model ids the transcripts show per role (orchestrator turns, lens
    passes, verifiers from .harden/verifiers/*.meta.json) and, with --check-report, exits 1
    when the report's `- Models, as the transcripts show them` line omits an observed id of a
    role or names another role's id there, or its `Limits of independence:` paragraph omits a
    lens or verifier id (pilot-auto-calibration A01-F41).
    python ledger.py status-baseline
    python ledger.py capture --agent-id ID --out .harden/passes/NAME.md [--replace]
    capture copies a subagent's final message (a verifier's, for example) byte for byte from a
    capture under .harden/passes/raw/ or its own transcript to --out, which must be a .md file
    under .harden/passes/ outside raw/; exit 2 with "capture missing" when neither exists
    (pilot-auto-calibration A01-F30).
    record and gaps take --lens a,b,c for a bundle; record takes exploration alone, with
    --candidates-by-lens LENS=K,... (pilot-auto-calibration A01-F33, A01-F37).

    File entries (--files, --files-from, unit files) are repository-relative paths (or
    absolute inside the repository). A read of part of a file is written PATH:START-END (or
    PATH:LINE). --files-from takes one entry per line (blank lines and # comments skipped) or
    JSON: a list of entries or of {"path", "ranges": [[start, end], ...]} objects, or an object
    with a "files_read" list. --map (merge) takes JSON: [{"id", "passes": [1, 2], "raw": 2,
    "raw_ids": [...]}], or {"clusters": [...]}, or {"<candidate id>": [pass numbers]}.
    Cluster ids are the candidate ids of .harden/candidates.json; "raw" defaults to the number
    of passes. A candidate found by a deterministic source instead of a lens pass (a prescan
    hit, for example) is a cluster with "source": "prescan" and no passes: it counts in the
    reconciliation but not in Chao2.
    check fails on integrity problems at any time; unverified candidates, a missing
    candidates.json and a short re-check sample only fail with --final (run it before writing
    the report; run plain `check` after the passes, before verification).

Exit codes
    0  success; check: nothing missing; gaps: no unread line
    1  gaps: unread lines remain; check: at least one problem (uncovered or partial file for a required lens, pass row
       without metadata, unbalanced reconciliation, unconfirmed dismissal, budget overrun...)
    2  usage or environment error (not a git repository, no ledger, unknown lens or pass,
       malformed input file, duplicate pass row)

Python 3.9+ standard library only (also runs under `python -S`); no network; UTF-8 files (a
BOM is tolerated when reading JSON); subprocesses without a shell. Output order is sorted, so
the same inputs give the same ledger apart from timestamps.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import posixpath
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import _common as C  # noqa: E402  (sibling module, path set above)

VERSION = 1
LEDGER_REL = ".harden/tools/ledger.json"
INSCOPE_REL = ".harden/tools/inscope.txt"
TRIAGE_REL = ".harden/tools/triage.json"
CANDIDATES_REL = ".harden/candidates.json"
FINDINGS_REL = ".harden/findings.json"

# DT-25: "read tokens ~ 8.3 x LOC per full read" (C kernel code; an estimate, not a law).
TOKENS_PER_LOC = 8.3
MAX_PASSES = 10          # DT-25: stop at 10 passes
FEW_PASSES = 3           # DT-25: "with 1-2 passes the estimator is meaningless"
RECHECK_SHARE = 0.10     # DT-16: at least 10% ...
RECHECK_MIN = 5          # ... and at least 5 dismissals re-checked
LIST_LIMIT = 40          # text output only; JSON lists everything

CHAO2_CAVEAT = (
    "Chao2 is a lower bound, not a count of remaining defects: LLM passes share a model and a "
    "prompt family, which breaks the estimator's independence assumption, and with few passes "
    "\"underestimation may be substantial\"; with 1-2 passes the estimate is meaningless "
    "(detection.md DT-25).")

# Lens names of assets/findings.schema.json (tests keep this copy equal to
# validate_findings.LENSES). project-tool results go through triage.json, not pass rows.
LENSES: Tuple[str, ...] = (
    "dead-code", "complexity-design", "duplication", "errors-resilience", "ops-config",
    "concurrency", "security", "dependencies", "tests", "types-suppressions", "performance",
    "readability-docs", "architecture", "ai-failure-modes", "numeric-money-time", "data",
    "build-ci", "frontend", "web3", "project-tool")
TOOL_LENS = "project-tool"
# The exploration pass (DT-22; pilot-auto-calibration A01-F37): recorded, never required.
EXPLORATION = "exploration"
MAX_BUNDLE = 3           # a pass carries at most three lens files (DT-21; A01-F33)
MAX_READ_BYTES = 1_000_000  # larger files are excluded from lens passes (DT-01; A01-F39)
PASS_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
AGENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
UNIT_KINDS = ("slice", "cross-cutting", "sweep")
FILE_KINDS = ("source", "test", "doc", "other")
# File kinds `check` requires a lens to cover unless --kinds is given (DT-01/DT-02 coverage of
# what the lens reads). Code lenses read source and test files; the others also read docs
# (readability-docs) or configuration, CI, manifests and Dockerfiles ("other").
CODE_LENS_KINDS: Tuple[str, ...] = ("source", "test")
LENS_KINDS: Dict[str, Tuple[str, ...]] = {
    "readability-docs": ("source", "test", "doc"),
    "ops-config": ("source", "other"),
    "build-ci": ("source", "other"),
    "dependencies": ("source", "other"),
    "security": ("source", "test", "other"),
}
STOP_REASONS = ("converged", "max-passes", "budget-cap", "skipped-budget",
                "single-pass-low-risk")
VERIFIED_STATUSES = {"verified", "approved", "applied", "partial", "reported", "deferred",
                     "blocked", "reverted"}
TRIAGE_STATUS = {
    "tp": "TP", "true-positive": "TP", "true_positive": "TP", "true positive": "TP",
    "fp": "FP", "false-positive": "FP", "false_positive": "FP", "false positive": "FP",
    "wont-fix": "wont-fix", "wontfix": "wont-fix", "won't-fix": "wont-fix",
    "won't fix": "wont-fix", "wont_fix": "wont-fix", "won't_fix": "wont-fix",
}
CONFIRMATIONS = ("human", "deterministic", "execution", "tool")
HIGH_SEVERITIES = {"critical", "high", "error"}
MIGRATION_DIRS = {"migrations", "migration"}


# detection DT-25: an autonomous run takes the cap from the profile's budget.max_tokens and,
# when the profile sets none (the documented default), records no cap and logs that default
# (user-policy-autonomy U01-F01).
AUTONOMOUS_NO_CAP = "no cap (autonomous default)"


class LedgerError(RuntimeError):
    """Usage or environment problem (exit 2)."""


# ---------------------------------------------------------------------------
# Paths, git, JSON
# ---------------------------------------------------------------------------


def repo_root(start: str) -> Path:
    path = Path(start).resolve()
    if not path.is_dir():
        raise LedgerError("not a directory: " + C.to_posix(str(path)))
    info = C.resolve_repo(path)
    if not info.is_repo:
        raise LedgerError("{} is not a git repository: the ledger is built from git ls-files "
                          "(DT-01)".format(C.to_posix(str(path))))
    return info.root


def repo_relative(repo: Path, raw: str) -> Optional[str]:
    """Repository-relative POSIX path for a user argument, or None when it leaves the repo."""
    text = raw.strip().replace("\\", "/")
    if not text:
        return None
    if os.name == "nt":
        msys = re.match(r"^/([a-zA-Z])(/|$)", text)
        if msys:
            text = msys.group(1).upper() + ":/" + text[3:]
    if os.path.isabs(text) or re.match(r"^[A-Za-z]:/", text):
        try:  # realpath: 8.3 short names (C:/Users/UTILIS~1) and symlinks
            text = os.path.relpath(os.path.realpath(text),
                                   os.path.realpath(str(repo))).replace("\\", "/")
        except ValueError:
            return None
    rel = posixpath.normpath(text)
    if rel == ".":
        return ""
    if rel == ".." or rel.startswith("../") or rel.startswith("/"):
        return None
    return rel


def status_outside_harden(repo: Path) -> List[str]:
    """Sorted `git status --porcelain=v1 --untracked-files=all` lines whose paths lie outside
    .harden/ (for renames, either side); [] when git fails."""
    out = C.git_bytes(repo, ["status", "--porcelain=v1", "--untracked-files=all"],
                      check=False).decode("utf-8", errors="replace")
    lines: List[str] = []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        paths = [p.strip().strip('"') for p in line[3:].split(" -> ")]
        if all(p == ".harden" or p.startswith(".harden/") for p in paths):
            continue
        lines.append(line.rstrip())
    return sorted(lines)


def read_json_file(path: Path, what: str) -> Any:
    try:
        return C.read_json(path)
    except (OSError, ValueError) as exc:
        raise LedgerError("cannot read {} {}: {}".format(what, C.to_posix(str(path)), exc)) \
            from exc


def optional_dict(path: Path) -> Optional[Dict[str, Any]]:
    if not path.is_file():
        return None
    data = read_json_file(path, "JSON file")
    return data if isinstance(data, dict) else None


def cap_policy(active: Optional[Dict[str, Any]]) -> Tuple[bool, Optional[int]]:
    """(autonomous, the profile's budget.max_tokens) from the run marker (detection DT-25).

    Autonomous: a run that asks nobody (user-policy-autonomy U01-F01), i.e. a marker whose
    mode is neither "interactive" nor its older name "apply", and not a report-only run
    started as one; its cap is the profile's budget.max_tokens (run_state.py records the
    effective profile in the marker), and none when the profile sets none. No marker, or one
    without a mode: not autonomous, so the cap stays required."""
    if not isinstance(active, dict):
        return False, None
    mode = active.get("mode")
    if not isinstance(mode, str) or not mode:
        return False, None
    interactive = ("interactive", "apply")
    if mode in interactive or (mode == "report-only" and
                               active.get("mode_requested") in interactive):
        return False, None
    profile = active.get("profile")
    effective = profile.get("effective") if isinstance(profile, dict) else None
    budget = effective.get("budget") if isinstance(effective, dict) else None
    limit = budget.get("max_tokens") if isinstance(budget, dict) else None
    if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
        limit = None
    return True, limit


def read_marker(repo: Path) -> Optional[Dict[str, Any]]:
    """.harden/active as a dict, or None when it is missing or unreadable (never raises)."""
    try:
        data = C.read_json(C.harden_dir(repo) / "active")
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def cap_text(budget: Dict[str, Any]) -> str:
    """The cap as the text outputs show it."""
    cap = budget.get("budget_cap_tokens")
    if cap is None and budget.get("budget_cap_note"):
        return str(budget["budget_cap_note"])
    return str(cap)


def str_list(data: Optional[Dict[str, Any]], key: str) -> List[str]:
    if not data or not isinstance(data.get(key), list):
        return []
    return [C.to_posix(v.strip()) for v in data[key] if isinstance(v, str) and v.strip()]


def content_blobs(repo: Path, paths: Sequence[str]) -> Dict[str, str]:
    """Git blob SHA of the working-tree content (what `git add` would store) per path."""
    if not paths:
        return {}
    payload = ("\n".join(paths) + "\n").encode("utf-8")
    out = C.git_bytes(repo, ["hash-object", "--stdin-paths"], check=False,
                      input_bytes=payload).decode("utf-8", errors="replace").split()
    if len(out) != len(paths):
        return {}
    return dict(zip(paths, out))


def ledger_file(repo: Path) -> Path:
    return repo / LEDGER_REL


def load_ledger(repo: Path) -> Dict[str, Any]:
    path = ledger_file(repo)
    if not path.is_file():
        raise LedgerError("no ledger at {}: run `ledger.py init` first".format(LEDGER_REL))
    data = read_json_file(path, "ledger")
    if not isinstance(data, dict) or not isinstance(data.get("files"), list):
        raise LedgerError("{} is not a ledger written by ledger.py".format(LEDGER_REL))
    data.setdefault("units", [])
    data.setdefault("passes", [])
    data.setdefault("clusters", {})
    data.setdefault("budget", {})
    return data


def save_ledger(repo: Path, ledger: Dict[str, Any]) -> None:
    ledger["updated"] = C.utc_iso()
    C.write_json(ledger_file(repo), ledger)


def normalize_lens(raw: str) -> str:
    name = C.to_posix(raw.strip()).rsplit("/", 1)[-1].lower()
    if name.endswith(".md"):
        name = name[:-3]
    if name.startswith("lens-"):
        name = name[5:]
    if name not in LENSES:
        raise LedgerError("unknown lens {!r}; use one of: {}".format(raw, ", ".join(LENSES)))
    return name


def parse_lens_list(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    out: List[str] = []
    for part in raw.split(","):
        if part.strip():
            lens = normalize_lens(part)
            if lens not in out:
                out.append(lens)
    return out


def parse_lens_arg(raw: str, allow_exploration: bool) -> List[str]:
    """The lenses of a pass: a,b,c (at most MAX_BUNDLE), or exploration alone."""
    parts = [p.strip() for p in (raw or "").split(",") if p.strip()]
    out: List[str] = []
    for part in parts:
        if part.lower() == EXPLORATION:
            if not allow_exploration:
                raise LedgerError("the exploration pass has no coverage requirement")
            lens = EXPLORATION
        else:
            lens = normalize_lens(part)
        if lens == TOOL_LENS:
            raise LedgerError("project-tool results are labelled in {} (DT-12), not recorded as "
                              "lens passes".format(TRIAGE_REL))
        if lens not in out:
            out.append(lens)
    if not out:
        raise LedgerError("no lens given")
    if EXPLORATION in out and len(out) > 1:
        raise LedgerError("the exploration pass is recorded alone")
    if len(out) > MAX_BUNDLE:
        raise LedgerError("a pass carries at most 3 lens files (DT-21; pilot-auto-calibration "
                          "A01-F33)")
    return out


def parse_counts(raw: Optional[str]) -> Dict[str, int]:
    """--candidates-by-lens LENS=K[,LENS=K...] (lenses normalised, K >= 0)."""
    out: Dict[str, int] = {}
    for part in (raw or "").split(","):
        if not part.strip():
            continue
        name, sep, value = part.partition("=")
        if not sep or not value.strip().isdigit():
            raise LedgerError("--candidates-by-lens expects LENS=K, got {!r}".format(part))
        lens = normalize_lens(name)
        out[lens] = out.get(lens, 0) + int(value.strip())
    return out


def is_supplementary(row: Dict[str, Any]) -> bool:
    return bool(row.get("supplementary"))


def coverage_rows(ledger: Dict[str, Any], lens: str) -> List[Dict[str, Any]]:
    """The pass rows of a lens that count for coverage (no exploration, no DT-26 copy)."""
    return [r for r in ledger["passes"] if r.get("lens") == lens and lens != EXPLORATION
            and not is_supplementary(r)]


def file_kind(path: str) -> str:
    if C.is_test_path(path):
        return "test"
    if C.is_doc_path(path):
        return "doc"
    if C.is_source_language(C.language_of(path)):
        return "source"
    return "other"


def count_lines(text: str) -> int:
    """Physical lines as an editor numbers them (a final line without newline counts)."""
    if not text:
        return 0
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def estimate_tokens(rel: str, data: bytes, loc: int) -> Tuple[int, str]:
    """(read tokens, basis) for one full read (DT-25). A notebook's JSON lines say nothing
    about its size (one embedded image can be most of it): its code cells when it parses,
    else bytes/4."""
    if C.file_extension(rel) == ".ipynb":
        if C.notebook_code_loc(data) is not None:
            return int(round(TOKENS_PER_LOC * loc)), "8.3 x notebook code-cell LOC"
        return int(math.ceil(len(data) / 4.0)), "bytes/4 (notebook JSON did not parse)"
    t_loc = int(round(TOKENS_PER_LOC * loc))
    t_bytes = int(math.ceil(len(data) / 4.0))
    if t_bytes > 1.25 * t_loc:  # long lines: 8.3 x LOC would undercount (A01-F39)
        return t_bytes, "bytes/4 (long lines)"
    return t_loc, "8.3 x LOC"


def row_tokens(row: Dict[str, Any]) -> int:
    """Read tokens of a file row (ledgers written before est_tokens: 8.3 x LOC)."""
    value = row.get("est_tokens")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return int(round(TOKENS_PER_LOC * int(row.get("loc") or 0)))


# ---------------------------------------------------------------------------
# File entries and line ranges
# ---------------------------------------------------------------------------

WHOLE_MARKERS = frozenset({"all", "whole", "full", "*", "entire"})
END_MARKERS = frozenset({"eof", "end", "$", "last"})
MAX_DROPPED_LISTED = 200
_RANGE_RE = re.compile(r"^(.*?):(\d+)(?:-(\d+|eof|end|\$|last)?)?$", re.I)
_RANGE_TEXT_RE = re.compile(r"^\s*(\d+)\s*(-\s*(\d+|eof|end|\$|last)?)?\s*$", re.I)
Range = Tuple[int, int]
# (start, end), end None meaning "to the last line"; normalised in resolve_reads.
OpenRange = Tuple[int, Optional[int]]
Entry = Tuple[str, Optional[OpenRange]]


def _cut(value: Any, limit: int = 200) -> str:
    """An entry as short text for files_dropped (paths and range text only, never content)."""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False,
                                                          default=str)
    return text if len(text) <= limit else text[:limit - 3] + "..."


def parse_entry(text: str, strict: bool = False) -> Entry:
    """PATH (whole), PATH:A, PATH:A-B, PATH:A- or PATH:A-eof (pilot-auto-calibration A01-F31).
    A Windows path such as C:/x/y.ts has no digits after its colon, so it stays a path. With
    strict (unit files), a range other than 1 <= START <= END raises as before."""
    match = _RANGE_RE.match(text.strip())
    if match and match.group(1):
        start = int(match.group(2))
        tail = text.strip()[match.end(2):]
        end: Optional[int] = start
        if tail.startswith("-"):
            raw_end = match.group(3)
            end = None if raw_end is None or raw_end.lower() in END_MARKERS else int(raw_end)
        if strict and (start < 1 or end is None or end < start):
            raise LedgerError("bad line range in {!r} (need 1 <= START <= END)".format(text))
        return match.group(1), (start, end)
    return text.strip(), None


def _int_like(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _end_like(value: Any) -> Tuple[bool, Optional[int]]:
    """(usable, end) of a range end; None, -1 and an end marker mean the last line."""
    if value is None:
        return True, None
    if isinstance(value, str) and value.strip().lower() in END_MARKERS:
        return True, None
    number = _int_like(value)
    if number is None:
        return False, None
    return True, None if number == -1 else number


def _range_item(item: Any) -> Optional[OpenRange]:
    """One item of a "ranges" list: [A, B], [A], A, "A-B" or {"start": A, "end": B}."""
    if isinstance(item, dict):
        start = _int_like(item.get("start"))
        ok, end = _end_like(item.get("end", item.get("start")))
        return (start, end) if start is not None and ok else None
    if isinstance(item, list):
        if len(item) == 1:
            start = _int_like(item[0])
            return (start, start) if start is not None else None
        if len(item) == 2:
            start = _int_like(item[0])
            ok, end = _end_like(item[1])
            return (start, end) if start is not None and ok else None
        return None
    if isinstance(item, str):
        m = _RANGE_TEXT_RE.match(item)
        if not m:
            return None
        start = int(m.group(1))
        if not m.group(2):
            return start, start
        raw = m.group(3)
        return start, (None if raw is None or raw.lower() in END_MARKERS else int(raw))
    number = _int_like(item)
    return (number, number) if number is not None else None


def entries_from_json(data: Any, source: str, strict: bool = False
                      ) -> Tuple[List[Entry], List[Dict[str, str]]]:
    """(entries, dropped) of a JSON files_read value; a malformed item is dropped with a
    reason (A01-F31), or raises with strict (unit files)."""
    if isinstance(data, dict) and isinstance(data.get("files_read"), list):
        data = data["files_read"]
    if not isinstance(data, list):
        raise LedgerError("{}: expected a JSON list of file entries".format(source))
    out: List[Entry] = []
    dropped: List[Dict[str, str]] = []

    def drop(item: Any, reason: str, detail: Optional[str] = None) -> None:
        if strict:
            raise LedgerError("{}: {} ({})".format(source, reason, detail or _cut(item, 80)))
        dropped.append({"entry": detail or _cut(item), "reason": reason})

    for item in data:
        if isinstance(item, str):
            out.append(parse_entry(item, strict))
            continue
        if not isinstance(item, dict):
            drop(item, "unreadable entry")
            continue
        path = item.get("path")
        if not isinstance(path, str) or not path.strip():
            drop(item, "entry without a path")
            continue
        if item.get("whole") is True or item.get("full") is True:
            out.append((path, None))
            continue
        ranges = item.get("ranges")
        if ranges is None and "start" in item:
            ranges = [{"start": item.get("start"), "end": item.get("end", item.get("start"))}]
        if ranges is None:
            out.append((path, None))
            continue
        if isinstance(ranges, str):
            if ranges.strip().lower() in WHOLE_MARKERS:
                out.append((path, None))
                continue
            ranges = [part for part in ranges.split(",") if part.strip()]
        if not isinstance(ranges, list):
            drop(item, "unreadable entry")
            continue
        if not ranges:
            drop(item, "empty ranges: counted as not read")
            continue
        for rng in ranges:
            parsed = _range_item(rng)
            if parsed is None or (strict and (parsed[0] < 1 or parsed[1] is None
                                              or parsed[1] < parsed[0])):
                drop(rng, "unreadable range {}".format(_cut(repr(rng), 60)),
                     "{} {}".format(path, _cut(rng, 60)))
                continue
            out.append((path, parsed))
    return out, dropped


def collect_entries(files: Optional[Sequence[str]], files_from: Optional[str],
                    strict: bool = False) -> Tuple[List[Entry], List[Dict[str, str]]]:
    """(entries, dropped) of --files and --files-from. strict (cmd_unit) raises on anything
    the tolerant path would drop or normalise (GD-05 revision)."""
    entries: List[Entry] = [parse_entry(f, strict) for f in files or [] if f.strip()]
    dropped: List[Dict[str, str]] = []
    if files_from:
        path = Path(files_from)
        try:
            text = C.read_text(path).lstrip(chr(0xFEFF))
        except OSError as exc:
            raise LedgerError("cannot read --files-from {}: {}".format(files_from, exc)) from exc
        if text.lstrip()[:1] in ("[", "{"):
            try:
                data = json.loads(text)
            except ValueError as exc:
                raise LedgerError("--files-from {}: invalid JSON: {}".format(files_from, exc)) \
                    from exc
            more, dropped = entries_from_json(data, files_from, strict)
            entries += more
        else:
            for line in text.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    entries.append(parse_entry(line, strict))
    return entries, dropped


def merge_ranges(ranges: Iterable[Range]) -> List[List[int]]:
    merged: List[List[int]] = []
    for start, end in sorted(ranges):
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


# Lines holding only whitespace and closing punctuation are not required reading
# (pilot-auto-calibration A01-F32); comment lines are.
TRIVIAL_LINE_RE = re.compile(r"^[\s}\])>;,]*$")


def trivial_ranges(text: str) -> List[List[int]]:
    """Blank and closing-punctuation lines of a file, numbered as count_lines numbers them."""
    lines = text.split("\n")
    if text.endswith("\n"):
        lines = lines[:-1]
    found: List[Range] = []
    for number, line in enumerate(lines, 1):
        if number == 1:
            line = line.lstrip(chr(0xFEFF))
        if TRIVIAL_LINE_RE.match(line.rstrip("\r")):
            found.append((number, number))
    return merge_ranges(found)


def fully_read(entry: Dict[str, Any], ranges: Optional[Sequence[Sequence[int]]]) -> bool:
    """True when `ranges` (None = the whole file) cover every line the entry requires."""
    return ranges is None or not unread_ranges(required_ranges(entry),
                                               [(int(a), int(b)) for a, b in ranges])


class FileIndex:
    """In-scope files of the ledger, with a case-insensitive fallback on Windows."""

    def __init__(self, ledger: Dict[str, Any]) -> None:
        self.rows: Dict[str, Dict[str, Any]] = {f["path"]: f for f in ledger["files"]}
        self.folded: Dict[str, str] = {p.lower(): p for p in self.rows}

    def canonical(self, rel: str) -> Optional[str]:
        if rel in self.rows:
            return rel
        if os.name == "nt":
            return self.folded.get(rel.lower())
        return None


def resolve_reads(repo: Path, index: FileIndex, entries: Sequence[Entry], strict: bool = False
                  ) -> Tuple[List[Dict[str, Any]], List[str], List[str], List[Dict[str, str]]]:
    """(files_read rows, paths outside the ledger, warnings, dropped entries) for parsed
    entries. Ranges are normalised: a start below 1 is clamped, an open end reaches the last
    line, an inverted range or one past the end is dropped, an end past the last line is
    clipped (pilot-auto-calibration A01-F31). Nothing is ever widened."""
    whole: Set[str] = set()
    parts: Dict[str, List[Range]] = {}
    outside: List[str] = []
    warnings: List[str] = []
    dropped: List[Dict[str, str]] = []
    for raw, rng in entries:
        rel = repo_relative(repo, raw)
        if not rel:
            if strict:
                raise LedgerError("{!r} is not a file path inside the repository".format(raw))
            dropped.append({"entry": _cut(raw), "reason": "outside the repository"
                            if raw.strip() else "empty path"})
            continue
        path = index.canonical(rel)
        if path is None:
            if rel not in outside:
                outside.append(rel)
            continue
        if rng is None:
            whole.add(path)
            continue
        lines = int(index.rows[path].get("lines") or 0)
        start, end = rng
        label = "{}:{}-{}".format(path, start, "eof" if end is None else end)
        if start < 1:
            warnings.append("{} start {} clamped to 1".format(label, start))
            start = 1
        if end is None:
            end = max(lines, start)
        if end < start:
            dropped.append({"entry": label, "reason": "inverted range [{}, {}] dropped".format(
                rng[0], rng[1])})
            continue
        if start > max(lines, 1):
            warnings.append("{} starts after the last line ({}); ignored".format(label, lines))
            dropped.append({"entry": label, "reason": "starts after the last line ({})".format(
                lines)})
            continue
        if end > lines:
            warnings.append("{} clipped to the file's {} lines".format(label, lines))
            end = max(lines, start)
        parts.setdefault(path, []).append((start, end))
    rows: List[Dict[str, Any]] = []
    for path in sorted(whole | set(parts)):
        if path in whole:
            rows.append({"path": path, "ranges": None})
        else:
            rows.append({"path": path, "ranges": merge_ranges(parts[path])})
    return rows, sorted(outside), warnings, dropped


def cap_dropped(dropped: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """files_dropped as stored: at most MAX_DROPPED_LISTED entries plus a count."""
    out = list(dropped[:MAX_DROPPED_LISTED])
    if len(dropped) > MAX_DROPPED_LISTED:
        out.append({"entry": "...", "reason": "{} more".format(len(dropped) -
                                                               MAX_DROPPED_LISTED)})
    return out


# ---------------------------------------------------------------------------
# init
# ---------------------------------------------------------------------------


def in_scope(path: str, scope: Sequence[str]) -> bool:
    if not scope:
        return True
    for entry in scope:
        if entry == "":
            return True
        if re.search(r"[*?\[]", entry):
            if C.glob_match(path, entry):
                return True
        elif path == entry or path.startswith(entry.rstrip("/") + "/"):
            return True
    return False


def static_exclusion(path: str, excludes: Sequence[str], generated: Dict[str, str],
                     gen_prefixes: Sequence[Tuple[str, str]], linguist: Dict[str, str],
                     submodules: Sequence[str]) -> Optional[str]:
    """Reason to exclude a path without reading it, else None."""
    for pattern in excludes:
        if C.glob_match(path, pattern):
            return "exclude_globs: " + pattern
    if path in generated:
        return "inventory generated_or_vendor: " + generated[path]
    for prefix, reason in gen_prefixes:
        if path.startswith(prefix):
            return "inventory generated_or_vendor: " + reason
    if path in linguist:
        return linguist[path]
    reason = C.path_generated_reason(path, submodules)
    if reason:
        return reason
    manager = C.lockfile_manager(path)
    if manager:
        return "lockfile ({})".format(manager)
    if C.is_snapshot_path(path):
        return "snapshot file"
    if any(seg.lower() in MIGRATION_DIRS for seg in C.path_segments(path)[:-1]):
        return "migration file"
    return None


def cmd_init(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    path = ledger_file(repo)
    if path.exists() and not args.force:
        raise LedgerError("{} already exists and holds recorded passes; use --force to rebuild "
                          "it (the old file is kept as ledger.json.bak)".format(LEDGER_REL))
    hdir = C.ensure_harden_dir(repo, True)
    config = optional_dict(hdir / "config.json")
    active = optional_dict(hdir / "active")
    inventory = C.load_inventory(repo)
    warnings: List[str] = []

    scope_raw = list(args.scope or []) or str_list(config, "scope") or str_list(active, "scope")
    scope: List[str] = []
    for raw in scope_raw:
        rel = repo_relative(repo, raw)
        if rel is None:
            raise LedgerError("scope {!r} is outside the repository".format(raw))
        if rel not in scope:
            scope.append(rel)
    excludes = sorted(set(C.to_posix(g) for g in (args.exclude or []) if g.strip())
                      | set(str_list(config, "exclude_globs")))

    generated: Dict[str, str] = {}
    gen_prefixes: List[Tuple[str, str]] = []
    for entry in (inventory or {}).get("generated_or_vendor") or []:
        if isinstance(entry, dict) and isinstance(entry.get("path"), str):
            p = C.to_posix(entry["path"])
            reason = str(entry.get("reason") or "generated or vendored")
            if p.endswith("/"):
                gen_prefixes.append((p, reason))
            else:
                generated[p] = reason

    files, source = C.list_files(repo, True)
    files = [f for f in files if not (f == ".harden" or f.startswith(".harden/"))]
    linguist = C.linguist_attributes(repo, files)
    submodules = C.parse_gitmodules(repo)
    rows: List[Dict[str, Any]] = []
    exclusions: List[Dict[str, str]] = []
    out_of_scope = 0
    for rel in files:
        if not in_scope(rel, scope):
            out_of_scope += 1
            continue
        reason = static_exclusion(rel, excludes, generated, gen_prefixes, linguist, submodules)
        if reason is None:
            try:
                with open(repo / rel, "rb") as handle:
                    data = handle.read()
            except OSError as exc:
                exclusions.append({"path": rel, "reason": "unreadable: {}".format(exc)})
                continue
            loc = C.count_loc(data, rel)
            if loc is None:
                reason = "binary file"
            elif len(data) > MAX_READ_BYTES:
                reason = ("file over 1,000,000 bytes: too large for a lens pass to read in full "
                          "(DT-01; pilot-auto-calibration A01-F39)")
            else:
                text = data[:4096].decode("utf-8", errors="replace")
                if C.header_has_generated_marker(text):
                    reason = "generated-code marker in the file header"
        if reason is not None:
            exclusions.append({"path": rel, "reason": reason})
            continue
        full_text = data.decode("utf-8", errors="replace")
        tokens, basis = estimate_tokens(rel, data, loc)
        row = {"path": rel, "language": C.language_of(rel), "kind": file_kind(rel),
               "loc": loc, "lines": count_lines(full_text), "est_tokens": tokens,
               "blob_sha": None, "trivial": trivial_ranges(full_text)}
        if basis != "8.3 x LOC":
            row["tokens_basis"] = basis
        rows.append(row)
    blobs = content_blobs(repo, [r["path"] for r in rows])
    for row in rows:
        row["blob_sha"] = blobs.get(row["path"])
    for entry in scope:
        if entry and not any(in_scope(r["path"], [entry]) for r in rows) and \
                not any(in_scope(e["path"], [entry]) for e in exclusions):
            warnings.append("scope entry {!r} matches no tracked file".format(entry))
    total_loc = sum(r["loc"] for r in rows)
    trivial_total = sum(b - a + 1 for r in rows for a, b in r["trivial"])
    units = [{
        "id": r["path"], "kind": "file",
        "files": [{"path": r["path"], "loc": r["loc"], "lines": r["lines"],
                   "est_tokens": r["est_tokens"], "blob_sha": r["blob_sha"],
                   "trivial": r["trivial"]}],
        "loc": r["loc"], "est_tokens": r["est_tokens"], "tier": None,
        "classes": [], "passes": [], "status": "unexamined", "lens_status": {},
        "finding_ids": [], "stops": {},
    } for r in rows]
    head = C.head_sha(repo)
    base = active.get("base_sha") if active and isinstance(active.get("base_sha"), str) \
        else head
    # DT-25: the cap comes from the user (--budget-cap) or, in an autonomous run, from the
    # profile's budget.max_tokens; a profile without one means no cap, recorded as such.
    autonomous, profile_cap = cap_policy(active)
    budget_cap = args.budget_cap
    cap_note: Optional[str] = None
    if budget_cap is None and autonomous:
        if profile_cap is not None:
            budget_cap = profile_cap
            cap_note = "the profile's budget.max_tokens (autonomous mode)"
        else:
            cap_note = AUTONOMOUS_NO_CAP
    ledger: Dict[str, Any] = {
        "version": VERSION,
        "tool": "ledger.py",
        "created": C.utc_iso(),
        "updated": C.utc_iso(),
        "repo": C.posix_abs(repo),
        "base_sha": base,
        "head_at_init": head,
        "file_source": source,
        "scope": scope,
        "exclude_globs": excludes,
        "totals": {"tracked_files": len(files), "out_of_scope_files": out_of_scope,
                   "excluded_files": len(exclusions), "in_scope_files": len(rows),
                   "in_scope_loc": total_loc,
                   "in_scope_lines": sum(r["lines"] for r in rows),
                   "trivial_lines": trivial_total},
        "status_at_init": status_outside_harden(repo),
        "budget": {"tokens_per_loc": TOKENS_PER_LOC,
                   "full_read_tokens": int(round(TOKENS_PER_LOC * sum(
                       r["loc"] for r in rows if not r.get("tokens_basis", "").startswith(
                           "bytes")))) + sum(r["est_tokens"] for r in rows if r.get(
                               "tokens_basis", "").startswith("bytes")),
                   "budget_cap_tokens": budget_cap,
                   "budget_cap_note": cap_note,
                   "estimate_tokens": args.estimate,
                   "verification_reserve": args.verification_reserve,
                   "pass_overhead_tokens": None,
                   "replans": []},
        "exclusions": exclusions,
        "files": rows,
        "units": units,
        "passes": [],
        "clusters": {},
    }
    if path.exists():
        backup = path.with_name(path.name + ".bak")
        os.replace(str(path), str(backup))
        warnings.append("previous ledger moved to {}".format(C.to_posix(
            os.path.relpath(str(backup), str(repo)))))
    save_ledger(repo, ledger)
    inscope = repo / INSCOPE_REL
    with open(inscope, "w", encoding="utf-8", newline="\n") as handle:
        handle.write("".join(r["path"] + "\n" for r in rows))
    reasons: Dict[str, int] = {}
    for e in exclusions:
        key = e["reason"].split(":")[0] if e["reason"].startswith(("exclude_globs",
                                                                   "inventory")) else e["reason"]
        key = re.sub(r" [^ ]*/$", "", key)
        reasons[key] = reasons.get(key, 0) + 1
    print("ledger: {} in-scope files, {} LOC ({} lines); {} excluded, {} outside the scope"
          .format(len(rows), total_loc, ledger["totals"]["in_scope_lines"], len(exclusions),
                  out_of_scope))
    for key in sorted(reasons):
        print("  excluded {:>5}  {}".format(reasons[key], key))
    notebooks = [r for r in rows if r.get("tokens_basis")]
    print("  one full read ~ {} tokens (8.3 x LOC, DT-25{})".format(
        ledger["budget"]["full_read_tokens"], "; {} file(s) estimated from notebook code cells "
        "or bytes/4 (long lines)".format(len(notebooks)) if notebooks else ""))
    if trivial_total:
        print("  {} blank or closing-punctuation lines are not required reading (A01-F32)".format(
            trivial_total))
    if cap_note is not None:
        print("  budget cap: {}{} (DT-25)".format(
            "" if budget_cap is None else "{} tokens, ".format(budget_cap), cap_note))
    if budget_cap is None and cap_note is None:
        print("  set the budget before the first pass: ledger.py budget --cap N --reserve N "
              "--estimate N --pass-overhead N (DT-25)")
    elif args.verification_reserve is None:
        print("  set the budget before the first pass: ledger.py budget --reserve N "
              "--estimate N --pass-overhead N (DT-25)")
    print("wrote {} and {}".format(LEDGER_REL, INSCOPE_REL))
    for warning in warnings:
        print("WARNING: " + warning)
    return 0


# ---------------------------------------------------------------------------
# Units
# ---------------------------------------------------------------------------


def find_unit(ledger: Dict[str, Any], uid: str) -> Optional[Dict[str, Any]]:
    for unit in ledger["units"]:
        if unit.get("id") == uid:
            return unit
    return None


def row_coverage_of_unit(row: Dict[str, Any], unit: Dict[str, Any]) -> Optional[str]:
    """'full' / 'partial' for a pass row that touched the unit, None when it did not."""
    reads = {fr["path"]: fr.get("ranges") for fr in row.get("files_read") or []}
    unit_files = unit.get("files") or []
    touched = [f for f in unit_files if f["path"] in reads]
    if not touched:
        return None
    if row.get("compacted"):
        return "partial"
    for f in unit_files:
        if f["path"] not in reads or not fully_read(f, reads[f["path"]]):
            return "partial"
    return "full"


def required_ranges(entry: Dict[str, Any]) -> List[List[int]]:
    """Lines a unit or ledger file entry asks to be read: its "ranges" when it records some,
    else the whole file (none for an empty file)."""
    lines = int(entry.get("lines") or 0)
    ranges = entry.get("ranges")
    if isinstance(ranges, list) and ranges:
        base = merge_ranges((int(r[0]), int(r[1])) for r in ranges)
    else:
        base = [[1, lines]] if lines > 0 else []
    trivial = [(int(a), int(b)) for a, b in entry.get("trivial") or []]
    return unread_ranges(base, trivial) if trivial else base


def lens_reads(ledger: Dict[str, Any], lens: str) -> Tuple[Set[str], Dict[str, List[Range]]]:
    """(files read whole, path -> ranges read) by the non-compacted passes of one lens."""
    whole: Set[str] = set()
    parts: Dict[str, List[Range]] = {}
    for row in coverage_rows(ledger, lens):
        if row.get("compacted"):
            continue
        for fr in row.get("files_read") or []:
            path = fr.get("path")
            if not isinstance(path, str):
                continue
            if fr.get("ranges") is None:
                whole.add(path)
            else:
                parts.setdefault(path, []).extend((int(r[0]), int(r[1]))
                                                  for r in fr["ranges"])
    return whole, parts


def unread_ranges(required: Sequence[Sequence[int]], read: Optional[Sequence[Range]]
                  ) -> List[List[int]]:
    """`required` minus the union of `read` (None: nothing read)."""
    merged = merge_ranges(read or [])
    out: List[List[int]] = []
    for start, end in required:
        cur = int(start)
        for rs, re_ in merged:
            if re_ < cur or rs > end:
                continue
            if rs > cur:
                out.append([cur, rs - 1])
            cur = max(cur, re_ + 1)
            if cur > end:
                break
        if cur <= end:
            out.append([cur, int(end)])
    return merge_ranges((a, b) for a, b in out)


def refresh_units(ledger: Dict[str, Any]) -> None:
    """Recompute each unit's pass references, classes and status from the pass rows (DT-02).
    A lens has examined a unit when the union of its non-compacted reads covers every line
    the unit's files ask for; a lens that touched the unit without that is partial."""
    reads_by_lens: Dict[str, Tuple[Set[str], Dict[str, List[Range]]]] = {}
    for unit in ledger["units"]:
        refs: List[Dict[str, Any]] = []
        classes: Set[str] = set()
        lens_status: Dict[str, str] = {}
        touched: Set[str] = set()
        for row in ledger["passes"]:
            if is_supplementary(row):
                continue
            coverage = row_coverage_of_unit(row, unit)
            if coverage is None:
                continue
            refs.append({"id": row["id"], "lens": row["lens"], "pass": row["pass"],
                         "model_id": row.get("model_id"), "effort": row.get("effort"),
                         "prompt_sha256": row.get("prompt_sha256"), "coverage": coverage})
            classes.update(c for c in row.get("classes") or [] if isinstance(c, str))
            if row["lens"] != EXPLORATION:  # exploration never makes a unit partial (A01-F37)
                touched.add(row["lens"])
        for lens in touched:
            if lens not in reads_by_lens:
                reads_by_lens[lens] = lens_reads(ledger, lens)
            whole, parts = reads_by_lens[lens]
            complete = all(f["path"] in whole or not unread_ranges(
                required_ranges(f), parts.get(f["path"])) for f in unit.get("files") or [])
            lens_status[lens] = "examined" if complete else "partial"
        unit["passes"] = refs
        unit["classes"] = sorted(classes)
        unit["lens_status"] = dict(sorted(lens_status.items()))
        if not lens_status:
            unit["status"] = "unexamined"
        elif all(s == "examined" for s in lens_status.values()):
            unit["status"] = "examined"
        else:
            unit["status"] = "partial"


def unit_files_from_entries(repo: Path, ledger: Dict[str, Any],
                            entries: Sequence[Tuple[str, Optional[Range]]]
                            ) -> List[Dict[str, Any]]:
    index = FileIndex(ledger)
    out: List[Dict[str, Any]] = []
    missing: List[str] = []
    for raw, rng in entries:
        if rng is not None:
            raise LedgerError("unit files are whole files; drop the line range from {!r}"
                              .format(raw))
        rel = repo_relative(repo, raw)
        path = index.canonical(rel) if rel else None
        if path is None:
            missing.append(raw)
            continue
        row = index.rows[path]
        if all(f["path"] != path for f in out):
            out.append({"path": path, "loc": row["loc"], "lines": row["lines"],
                        "est_tokens": row_tokens(row), "blob_sha": row.get("blob_sha"),
                        "trivial": row.get("trivial") or []})
    if missing:
        raise LedgerError("not in the ledger's in-scope files: " + ", ".join(missing))
    return sorted(out, key=lambda f: f["path"])


def cmd_unit(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    uid = args.id.strip()
    if not uid:
        raise LedgerError("--id must not be empty")
    unit = find_unit(ledger, uid)
    entries, _dropped = collect_entries(args.files, args.files_from, strict=True)
    if unit is None:
        if not entries:
            raise LedgerError("unit {!r} does not exist; give its --files to create it"
                              .format(uid))
        unit = {"id": uid, "kind": args.kind or "slice", "files": [], "loc": 0,
                "est_tokens": 0, "tier": None, "classes": [], "passes": [],
                "status": "unexamined", "lens_status": {}, "finding_ids": [], "stops": {}}
        ledger["units"].append(unit)
        action = "created"
    else:
        action = "updated"
        if unit.get("kind") == "file" and (entries or args.kind):
            raise LedgerError("{!r} is a per-file unit; its files and kind are fixed".format(uid))
        if args.kind:
            unit["kind"] = args.kind
    if entries:
        unit["files"] = unit_files_from_entries(repo, ledger, entries)
        unit["loc"] = sum(f["loc"] for f in unit["files"])
        unit["est_tokens"] = sum(row_tokens(f) for f in unit["files"])
    if args.tier is not None:
        unit["tier"] = args.tier
    refresh_units(ledger)
    if args.stop_reason:
        if not args.lens:
            raise LedgerError("--stop-reason needs --lens")
        lens = normalize_lens(args.lens)
        snapshot = lens_stats(repo, ledger, lens, load_outcomes(repo), unit)
        unit.setdefault("stops", {})[lens] = {
            "reason": args.stop_reason, "at": C.utc_iso(),
            "passes": snapshot["passes"], "S_obs": snapshot["S_obs"], "Q1": snapshot["Q1"],
            "Q2": snapshot["Q2"], "chao2": snapshot["chao2"],
            "unseen_estimate": snapshot["unseen_estimate"],
            "new_verified_in_latest_pass": snapshot["new_verified_in_latest_pass"]}
    elif args.lens:
        raise LedgerError("--lens is only used with --stop-reason")
    fixed = [u for u in ledger["units"] if u.get("kind") == "file"]
    custom = sorted((u for u in ledger["units"] if u.get("kind") != "file"),
                    key=lambda u: str(u.get("id")))
    ledger["units"] = fixed + custom
    save_ledger(repo, ledger)
    print("unit {} {}: kind {}, {} files, {} LOC, status {}".format(
        uid, action, unit["kind"], len(unit["files"]), unit["loc"], unit["status"]))
    if args.stop_reason:
        stop = unit["stops"][normalize_lens(args.lens)]
        print("  stop logged for {}: {} (S_obs {}, Q1 {}, Q2 {}, Chao2 {})".format(
            args.lens, stop["reason"], stop["S_obs"], stop["Q1"], stop["Q2"], stop["chao2"]))
    return 0


# ---------------------------------------------------------------------------
# record
# ---------------------------------------------------------------------------


def normalize_prompt_hash(raw: str) -> str:
    text = raw.strip().lower()
    if text.startswith("sha256:"):
        text = text[7:]
    if not re.match(r"^[0-9a-f]{64}$", text):
        raise LedgerError("--prompt-hash must be a sha256 hex digest (64 hex characters); use "
                          "--prompt-file to hash the prompt file instead")
    return text


def parse_tool_versions(values: Optional[Sequence[str]]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for value in values or []:
        name, sep, ver = value.partition("=")
        if not sep or not name.strip() or not ver.strip():
            raise LedgerError("--tool-version expects NAME=VERSION, got {!r}".format(value))
        out[name.strip()] = ver.strip()
    return dict(sorted(out.items()))


def next_row_id(passes: Sequence[Dict[str, Any]], offset: int = 0) -> str:
    return "P-{:03d}".format(offset + 1 + max([int(r["id"][2:]) for r in passes
                                               if re.match(r"^P-\d+$", str(r.get("id")))]
                                              or [0]))


def row_key(row: Dict[str, Any]) -> Tuple[Any, ...]:
    return (row.get("lens"), row.get("pass"), row.get("unit"), row.get("subagent_id"),
            tuple(r["path"] for r in row.get("files_read") or []),
            tuple(row.get("files_outside") or []))


def bundle_rows(lenses: Sequence[str], counts: Dict[str, int], base: Dict[str, Any],
                bundle: Optional[str]) -> List[Dict[str, Any]]:
    """One pass row per lens of a pass: the same reads and metadata, each lens its own count,
    and the first row the counts of lenses outside the pass (pilot-auto-calibration A01-F33,
    A01-F37)."""
    rows: List[Dict[str, Any]] = []
    others = {k: v for k, v in sorted(counts.items()) if k not in lenses}
    for index, lens in enumerate(lenses):
        row = dict(base)
        row["lens"] = lens
        row["bundle"] = bundle
        row["candidates"] = 0 if lens == EXPLORATION else counts.get(lens, 0)
        row["candidates_other_lenses"] = others if index == 0 else {}
        rows.append(row)
    return rows


def dropped_warning(dropped: Sequence[Dict[str, str]], where: str) -> str:
    shown = "; ".join("{} ({})".format(d["entry"], d["reason"]) for d in dropped[:5])
    return ("{} files_read item(s) normalised or dropped (A01-F31): {}; all are in "
            "{}.files_dropped".format(len(dropped), shown, where))


def load_pass_meta(repo: Path, raw: str) -> Dict[str, Any]:
    """The values persist_pass.py observe recorded for one lens pass, as ledger fields
    (pilot-auto-calibration A01-F41, A01-F43)."""
    path = Path(raw) if os.path.isabs(raw) else repo / raw
    try:
        meta = C.read_json(path)
    except (OSError, ValueError) as exc:
        raise LedgerError("cannot read --meta-file: {}".format(exc)) from exc
    if not isinstance(meta, dict):
        raise LedgerError("--meta-file is not a JSON object")
    observed = meta.get("observed")
    if not isinstance(observed, dict):
        raise LedgerError("run persist_pass.py observe {} first".format(
            meta.get("pass_id") or "<pass-id>"))
    if meta.get("kind") != "lens":
        raise LedgerError("--meta-file must be a lens pass's meta (kind lens), not {!r}".format(
            meta.get("kind")))
    if not observed.get("model"):
        raise LedgerError("the transcript of pass {} shows no model ({}): recover the pass with "
                          "persist_pass.py recover or start it again".format(
                              meta.get("pass_id"), "; ".join(
                                  str(r) for r in observed.get("reasons") or []) or "no request"))
    task = meta.get("task_file")
    prompt_sha: Optional[str] = None
    if isinstance(task, str) and task:
        try:
            prompt_sha = hashlib.sha256(Path(task).read_bytes()).hexdigest()
        except OSError:
            prompt_sha = None
    efforts = [e for e in observed.get("effort") or [] if isinstance(e, str)]
    usage = observed.get("usage") if isinstance(observed.get("usage"), dict) else {}
    reasons = [str(r) for r in observed.get("reasons") or []]
    reads_rel = observed.get("reads_path")
    result = None
    result_path = path.parent / "{}.result.json".format(meta.get("pass_id"))
    if result_path.is_file():
        try:
            result = C.read_json(result_path)
        except (OSError, ValueError):
            result = None
    models = observed.get("models") if isinstance(observed.get("models"), dict) else {}
    return {
        "pass_id": meta.get("pass_id"), "model": observed.get("model"),
        "models_observed": sorted(models) or [observed.get("model")],
        "effort": ",".join(efforts) or "n/a", "subagent_id": meta.get("agent_id"),
        "prompt_sha": prompt_sha, "reads_path": (repo / reads_rel) if isinstance(
            reads_rel, str) and reads_rel else None,
        "started": observed.get("started"),
        "tokens_in": sum(int(usage.get(k) or 0) for k in (
            "input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")),
        "tokens_out": int(usage.get("output_tokens") or 0),
        "result": result if isinstance(result, dict) else None,
        "compacted": bool(observed.get("compacted")) or not observed.get("complete"),
        "partial_reason": "compacted" if observed.get("compacted") else (
            reasons[0] if reasons else None),
        "persist_source": meta.get("source"), "agent_type": meta.get("agent_type"),
        "agent_transcript_path": meta.get("agent_transcript_path"),
        "message_path": path.parent / "{}.md".format(meta.get("pass_id")),
    }


def meta_conflicts(args: argparse.Namespace, info: Dict[str, Any]) -> List[str]:
    """The flags given next to --meta-file that contradict it."""
    out: List[str] = []
    model = (getattr(args, "model", None) or "").strip()
    if model and model != info["model"] and model not in info["models_observed"]:
        out.append("--model")
    effort = (getattr(args, "effort", None) or "").strip()
    if effort and effort != info["effort"]:
        out.append("--effort")
    if getattr(args, "files", None):
        out.append("--files")
    files_from = getattr(args, "files_from", None)
    if files_from and (info["reads_path"] is None or os.path.realpath(files_from) !=
                       os.path.realpath(str(info["reads_path"]))):
        out.append("--files-from")
    prompt_file = getattr(args, "prompt_file", None)
    if prompt_file:
        try:
            with open(prompt_file, "rb") as handle:
                if hashlib.sha256(handle.read()).hexdigest() != info["prompt_sha"]:
                    out.append("--prompt-file")
        except OSError:
            out.append("--prompt-file")
    prompt_hash = getattr(args, "prompt_hash", None)
    if prompt_hash and normalize_prompt_hash(prompt_hash) != info["prompt_sha"]:
        out.append("--prompt-hash")
    subagent = (getattr(args, "subagent_id", None) or "").strip()
    if subagent and subagent != info["subagent_id"]:
        out.append("--subagent-id")
    if getattr(args, "compacted", False) and not info["compacted"]:
        out.append("--compacted")
    return out


def meta_counts(lenses: Sequence[str], info: Dict[str, Any]) -> Dict[str, int]:
    """Candidates of the observed report per lens: each under its own lens when the bundle
    holds it, else under the pass's first lens."""
    cands = (info.get("result") or {}).get("candidates")
    counts: Dict[str, int] = {lens: 0 for lens in lenses if lens != EXPLORATION}
    for cand in cands if isinstance(cands, list) else []:
        if not isinstance(cand, dict):
            continue
        lens = cand.get("lens")
        try:
            lens = normalize_lens(str(lens)) if lens else None
        except LedgerError:
            lens = None
        if lens not in counts:
            lens = next(iter(counts), None)
        if lens is not None:
            counts[lens] = counts.get(lens, 0) + 1
    return counts


def meta_row_fields(info: Dict[str, Any]) -> Dict[str, Any]:
    return {"model_source": "transcript", "models_observed": info["models_observed"],
            "persist_source": info["persist_source"], "agent_type": info["agent_type"],
            "partial_reason": info["partial_reason"]}


def cmd_record(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    lenses = parse_lens_arg(args.lens, allow_exploration=True)
    if args.pass_number < 1:
        raise LedgerError("--pass must be 1 or more")
    for name in ("candidates", "tokens_in", "tokens_out"):
        value = getattr(args, name)
        if value is not None and value < 0:
            raise LedgerError("--{} must not be negative".format(name.replace("_", "-")))
    bundled = len(lenses) > 1 or lenses == [EXPLORATION]
    if args.candidates is not None and args.candidates_by_lens:
        raise LedgerError("give --candidates or --candidates-by-lens, not both")
    if bundled and args.candidates is not None:
        raise LedgerError("a pass with several lenses or the exploration pass counts its "
                          "candidates with --candidates-by-lens LENS=K,...")
    counts = parse_counts(args.candidates_by_lens) if args.candidates_by_lens else \
        ({lenses[0]: args.candidates} if args.candidates is not None else {})
    info: Optional[Dict[str, Any]] = None
    if args.meta_file:
        info = load_pass_meta(repo, args.meta_file)
        conflicts = meta_conflicts(args, info)
        if conflicts:
            raise LedgerError("conflicting: the meta file is the source ({})".format(
                ", ".join(conflicts)))
        if not counts:
            counts = meta_counts(lenses, info)
    prompt_sha: Optional[str] = None
    if info is not None:
        prompt_sha = info["prompt_sha"]
    elif args.prompt_file:
        try:
            with open(args.prompt_file, "rb") as handle:
                prompt_sha = hashlib.sha256(handle.read()).hexdigest()
        except OSError as exc:
            raise LedgerError("cannot read --prompt-file: {}".format(exc)) from exc
    elif args.prompt_hash:
        prompt_sha = normalize_prompt_hash(args.prompt_hash)
    model = (args.model or "").strip() or None
    effort = (args.effort or "").strip() or None
    if info is not None:
        model, effort = ",".join(info["models_observed"]), info["effort"]
    missing = [flag for flag, value in (("--model", model), ("--effort", effort),
                                        ("--prompt-hash/--prompt-file", prompt_sha))
               if value is None]
    if missing and not args.allow_missing_metadata:
        raise LedgerError("missing {} (DT-18: every pass records model id, effort and prompt "
                          "sha256). Pass --allow-missing-metadata only when the value is truly "
                          "unknown; `check` then reports the row.".format(", ".join(missing)))
    if info is not None:
        reads_path = info["reads_path"]
        entries, dropped = collect_entries(None, str(reads_path)) if reads_path is not None \
            and reads_path.is_file() else ([], [])
    else:
        entries, dropped = collect_entries(args.files, args.files_from)
        if not entries and not dropped:
            raise LedgerError("no files: give --files or --files-from (the pass's files_read)")
    index = FileIndex(ledger)
    reads, outside, warnings, more_dropped = resolve_reads(repo, index, entries)
    dropped = list(dropped) + more_dropped
    unit_id = args.unit.strip() if args.unit else None
    if unit_id and find_unit(ledger, unit_id) is None:
        raise LedgerError("unknown unit {!r}; create it with `ledger.py unit --id {} --files "
                          "...`".format(unit_id, unit_id))
    classes = sorted({c.strip() for c in (args.classes or "").split(",") if c.strip()})
    base: Dict[str, Any] = {
        "id": "", "pass": args.pass_number, "unit": unit_id,
        "subagent_id": (args.subagent_id or "").strip() or None,
        "model_id": model, "effort": effort, "prompt_sha256": prompt_sha,
        "classes": classes, "tool_versions": parse_tool_versions(args.tool_version),
        "started": args.started, "recorded": C.utc_iso(),
        "tokens_in": args.tokens_in, "tokens_out": args.tokens_out,
        "compacted": bool(args.compacted),
        "files_read": reads, "files_outside": outside, "files_dropped": cap_dropped(dropped),
        "model_source": "claimed",
    }
    if args.allow_missing_metadata:
        base["allow_missing_metadata"] = True
    if info is not None:
        base.update(meta_row_fields(info))
        base.update({"subagent_id": info["subagent_id"], "started": info["started"],
                     "tokens_in": info["tokens_in"], "tokens_out": info["tokens_out"],
                     "compacted": info["compacted"]})
        if not reads:
            base["compacted"] = True
            base["partial_reason"] = base["partial_reason"] or "no in-scope reads"
    passes: List[Dict[str, Any]] = ledger["passes"]
    if args.replace:
        if bundled:
            raise LedgerError("--replace replaces one row; re-ingest a bundle with "
                              "`ledger.py ingest --replace`")
        target = next((r for r in passes if r.get("id") == args.replace), None)
        if target is None:
            raise LedgerError("--replace {}: no such pass row".format(args.replace))
        row = bundle_rows(lenses, counts, base, None)[0]
        if not counts:
            row["candidates"] = None
        row["id"] = target["id"]
        passes[passes.index(target)] = row
        new_rows = [row]
        action = "replaced"
    else:
        first_id = next_row_id(passes)
        new_rows = bundle_rows(lenses, counts, base, "B-" + first_id if len(lenses) > 1
                               else None)
        if not counts:
            for row in new_rows:
                row["candidates"] = None
        for row in new_rows:
            key = row_key(row)
            for other in passes:
                if row_key(other) == key:
                    raise LedgerError("this pass is already recorded as {} (same lens, pass, "
                                      "unit, subagent and files); use --replace {} to "
                                      "overwrite it".format(other["id"], other["id"]))
        for offset, row in enumerate(new_rows):
            row["id"] = next_row_id(passes, 0)
            passes.append(row)
        action = "recorded"
    refresh_units(ledger)
    save_ledger(repo, ledger)
    rows_by_path = index.rows
    full = sum(1 for r in reads if fully_read(rows_by_path[r["path"]], r["ranges"]))
    ids = ", ".join(r["id"] for r in new_rows)
    print("{} {}: lens {} pass {}{}; {} files read ({} whole, {} partial){}".format(
        action, ids, ",".join(lenses), args.pass_number, " unit " + unit_id if unit_id else "",
        len(reads), full, len(reads) - full, "; marked compacted (partial)" if args.compacted
        else ""))
    for lens in lenses:
        if lens == EXPLORATION:
            continue
        coverage = lens_coverage(ledger, lens)
        covered = sum(1 for v in coverage.values() if v == "full")
        print("  lens {} now covers {}/{} in-scope files".format(lens, covered,
                                                                 len(ledger["files"])))
    if outside:
        print("WARNING: {} path(s) are not in-scope ledger files and were not counted: {}"
              .format(len(outside), ", ".join(outside[:LIST_LIMIT])))
    if missing:
        print("WARNING: metadata missing ({}); `ledger.py check` reports this row".format(
            ", ".join(missing)))
    if not counts:
        print("WARNING: --candidates not given: the raw-candidate reconciliation (DT-16, DT-27) "
              "cannot balance until every pass row has its count")
    if dropped:
        print("WARNING: " + dropped_warning(dropped, new_rows[0]["id"]))
    if not reads:
        print("WARNING: no usable files_read entry: this pass counts as having read nothing")
    for warning in warnings:
        print("WARNING: " + warning)
    return 0


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------


def lens_coverage(ledger: Dict[str, Any], lens: str) -> Dict[str, str]:
    """path -> 'full' | 'partial' for files touched by the lens (union of its passes)."""
    rows_by_path = {f["path"]: f for f in ledger["files"]}
    whole: Set[str] = set()
    touched: Set[str] = set()
    parts: Dict[str, List[Range]] = {}
    for row in coverage_rows(ledger, lens):
        for fr in row.get("files_read") or []:
            path = fr.get("path")
            if path not in rows_by_path:
                continue
            touched.add(path)
            if row.get("compacted"):
                continue
            if fr.get("ranges") is None:
                whole.add(path)
            else:
                parts.setdefault(path, []).extend((int(r[0]), int(r[1]))
                                                  for r in fr["ranges"])
    result: Dict[str, str] = {}
    for path in touched:
        if path in whole or (path in parts and fully_read(rows_by_path[path],
                                                          [list(r) for r in parts[path]])):
            result[path] = "full"
        else:
            result[path] = "partial"
    return result


def stale_files(repo: Path, ledger: Dict[str, Any]) -> List[str]:
    """In-scope files whose content changed since init (DT-01 'stale')."""
    paths = [f["path"] for f in ledger["files"]]
    present = [p for p in paths if (repo / p).is_file()]
    current = content_blobs(repo, present)
    stale: List[str] = []
    for row in ledger["files"]:
        path = row["path"]
        if path not in current:
            stale.append(path)
        elif row.get("blob_sha") and current[path] != row["blob_sha"]:
            stale.append(path)
    return sorted(stale)


# ---------------------------------------------------------------------------
# Candidates, findings, clusters and Chao2
# ---------------------------------------------------------------------------


def load_findings_list(path: Path, what: str) -> Optional[List[Dict[str, Any]]]:
    if not path.is_file():
        return None
    data = read_json_file(path, what)
    if isinstance(data, dict):
        data = data.get("findings")
    if not isinstance(data, list):
        raise LedgerError("{} must hold a \"findings\" list".format(C.to_posix(str(path))))
    return [f for f in data if isinstance(f, dict)]


class Outcomes:
    """Candidates (.harden/candidates.json) and verified findings (.harden/findings.json)."""

    def __init__(self, candidates: Optional[List[Dict[str, Any]]],
                 findings: Optional[List[Dict[str, Any]]]) -> None:
        self.candidates = candidates
        self.findings = findings
        self.by_id: Dict[str, Dict[str, Any]] = {}
        for c in candidates or []:
            if isinstance(c.get("id"), str):
                self.by_id[c["id"]] = c
        self.finding_ids: Set[str] = {f["id"] for f in findings or []
                                      if isinstance(f.get("id"), str)}

    def outcome(self, cid: str) -> str:
        """'verified' | 'rejected' | 'deferred' (not verified: run budget) | 'unresolved' |
        'unknown' (id not in candidates.json)."""
        cand = self.by_id.get(cid)
        if cand is None:
            return "verified" if cid in self.finding_ids else "unknown"
        if cand.get("status") == "rejected":
            return "rejected"
        if cand.get("status") == "deferred" and cand.get("verified") is not True and \
                cid not in self.finding_ids:
            return "deferred"
        if cid in self.finding_ids:
            return "verified"
        if cand.get("verified") is True and cand.get("status") in VERIFIED_STATUSES:
            return "verified"
        return "unresolved"


def load_outcomes(repo: Path) -> Outcomes:
    return Outcomes(load_findings_list(repo / CANDIDATES_REL, "candidates"),
                    load_findings_list(repo / FINDINGS_REL, "findings"))


def parse_cluster_map(data: Any, source: str) -> Dict[str, Dict[str, Any]]:
    if isinstance(data, dict) and "clusters" in data:
        data = data["clusters"]
    items: List[Tuple[str, Any]] = []
    if isinstance(data, dict):
        items = list(data.items())
    elif isinstance(data, list):
        for obj in data:
            if not isinstance(obj, dict) or not isinstance(obj.get("id"), str):
                raise LedgerError("{}: each cluster needs a string \"id\"".format(source))
            items.append((obj["id"], obj))
    else:
        raise LedgerError("{}: expected a JSON list or object of clusters".format(source))
    out: Dict[str, Dict[str, Any]] = {}
    for cid, value in items:
        if isinstance(value, list):
            value = {"passes": value}
        if not isinstance(value, dict):
            raise LedgerError("{}: cluster {} must be a list of passes or an object"
                              .format(source, cid))
        passes = value.get("passes", value.get("seen_in_passes"))
        origin = value.get("source")
        origin = origin.strip() if isinstance(origin, str) and origin.strip() else None
        if passes is None and origin:
            passes = []
        if (not isinstance(passes, list) or (not passes and not origin)
                or not all(isinstance(p, int) and not isinstance(p, bool) and p >= 1
                           for p in passes)):
            raise LedgerError("{}: cluster {} needs a non-empty list of pass numbers, or a "
                              "\"source\" (e.g. \"prescan\") when a deterministic tool found it"
                              .format(source, cid))
        seen = sorted(set(passes))
        raw_ids = value.get("raw_ids")
        if raw_ids is not None and (not isinstance(raw_ids, list)
                                    or not all(isinstance(r, str) for r in raw_ids)):
            raise LedgerError("{}: raw_ids of cluster {} must be strings".format(source, cid))
        raw = value.get("raw")
        if raw is None:
            raw = len(raw_ids) if raw_ids else max(len(seen), 1)
        if not isinstance(raw, int) or isinstance(raw, bool) or raw < max(len(seen), 1):
            raise LedgerError("{}: cluster {} has raw {!r}; it needs at least one raw candidate "
                              "per pass that saw it".format(source, cid, raw))
        entry: Dict[str, Any] = {"seen_in_passes": seen, "raw": raw}
        if origin:
            entry["source"] = origin
        if raw_ids:
            entry["raw_ids"] = sorted(raw_ids)
        out[cid] = entry
    return out


def refresh_finding_ids(ledger: Dict[str, Any], outcomes: Outcomes) -> None:
    """Each unit's finding_ids: merged clusters whose candidate file belongs to the unit."""
    by_file: Dict[str, Set[str]] = {}
    for clusters in ledger["clusters"].values():
        for cid in clusters:
            cand = outcomes.by_id.get(cid)
            if cand is not None and isinstance(cand.get("file"), str):
                by_file.setdefault(C.to_posix(cand["file"]), set()).add(cid)
    for unit in ledger["units"]:
        ids: Set[str] = set()
        for f in unit.get("files") or []:
            ids |= by_file.get(f["path"], set())
        unit["finding_ids"] = sorted(ids)


def cmd_merge(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    if args.lens.strip().lower() == EXPLORATION:
        raise LedgerError("the exploration pass has no clusters of its own: merge its "
                          "candidates under their lenses")
    lens = normalize_lens(args.lens)
    if lens == TOOL_LENS:
        raise LedgerError("project-tool results are reconciled from {} (DT-12, DT-16), not "
                          "merged as clusters".format(TRIAGE_REL))
    data = read_json_file(Path(args.map), "--map")
    clusters = parse_cluster_map(data, args.map)
    known = {r.get("pass") for r in ledger["passes"] if r.get("lens") == lens
             or int((r.get("candidates_other_lenses") or {}).get(lens, 0) or 0) > 0}
    unknown = sorted({p for c in clusters.values() for p in c["seen_in_passes"]} - known)
    if unknown:
        raise LedgerError("lens {} has no recorded pass {}; record the passes before merging"
                          .format(lens, ", ".join(str(p) for p in unknown)))
    store = ledger["clusters"].setdefault(lens, {})
    if args.replace:
        store.clear()
    store.update(clusters)
    ledger["clusters"][lens] = dict(sorted(store.items()))
    outcomes = load_outcomes(repo)
    notes: List[str] = []
    if outcomes.candidates is None:
        notes.append("{} not found: unit finding_ids not updated".format(CANDIDATES_REL))
    else:
        refresh_finding_ids(ledger, outcomes)
        missing = sorted(cid for cid in clusters if cid not in outcomes.by_id)
        if missing:
            notes.append("cluster ids not in {}: {}".format(CANDIDATES_REL,
                                                            ", ".join(missing[:LIST_LIMIT])))
    save_ledger(repo, ledger)
    stats = lens_stats(repo, ledger, lens, outcomes, None)
    print("merged {} cluster(s) into lens {} ({} stored): S_obs {}, Q1 {}, Q2 {}, Chao2 {}"
          .format(len(clusters), lens, len(ledger["clusters"][lens]), stats["S_obs"],
                  stats["Q1"], stats["Q2"], stats["chao2"]))
    for note in notes:
        print("NOTE: " + note)
    return 0


def chao2(s_obs: int, q1: int, q2: int) -> float:
    """DT-25: S_obs + Q1^2/(2 Q2), or S_obs + Q1(Q1-1)/2 when Q2 = 0."""
    if q2 > 0:
        return s_obs + (q1 * q1) / (2.0 * q2)
    return s_obs + q1 * (q1 - 1) / 2.0


def lens_stats(repo: Path, ledger: Dict[str, Any], lens: str, outcomes: Outcomes,
               unit: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    rows = coverage_rows(ledger, lens)
    unit_paths: Optional[Set[str]] = None
    if unit is not None:
        unit_paths = {f["path"] for f in unit.get("files") or []}
        rows = [r for r in rows if row_coverage_of_unit(r, unit) is not None]
    pass_numbers = sorted({int(r["pass"]) for r in rows})
    all_clusters = dict(ledger["clusters"].get(lens) or {})
    # Clusters found only by a deterministic source (prescan, a tool) are not pass samples.
    clusters = {cid: c for cid, c in all_clusters.items() if c.get("seen_in_passes")}
    external = len(all_clusters) - len(clusters)
    unmapped = 0
    if unit_paths is not None:
        kept: Dict[str, Any] = {}
        for cid, cl in clusters.items():
            cand = outcomes.by_id.get(cid)
            path = C.to_posix(cand["file"]) if cand and isinstance(cand.get("file"), str) \
                else None
            if path is None:
                unmapped += 1
            elif path in unit_paths:
                kept[cid] = cl
        clusters = kept
    s_obs = len(clusters)
    q1 = sum(1 for c in clusters.values() if len(c["seen_in_passes"]) == 1)
    q2 = sum(1 for c in clusters.values() if len(c["seen_in_passes"]) == 2)
    estimate = chao2(s_obs, q1, q2)
    unseen = estimate - s_obs
    sets = {p: {cid for cid, c in clusters.items() if p in c["seen_in_passes"]}
            for p in pass_numbers}
    jaccards: List[float] = []
    for i, a in enumerate(pass_numbers):
        for b in pass_numbers[i + 1:]:
            union = sets[a] | sets[b]
            if union:
                jaccards.append(len(sets[a] & sets[b]) / len(union))
    latest = pass_numbers[-1] if pass_numbers else None
    new_latest = [cid for cid, c in clusters.items()
                  if latest is not None and min(c["seen_in_passes"]) == latest]
    new_verified = [cid for cid in new_latest if outcomes.outcome(cid) == "verified"]
    coverage = lens_coverage(ledger, lens)
    if unit_paths is not None:
        coverage = {p: v for p, v in coverage.items() if p in unit_paths}
    if not pass_numbers:
        rule = "no pass recorded"
    elif len(pass_numbers) >= MAX_PASSES:
        rule = "stop: {} passes reached (DT-25 maximum)".format(MAX_PASSES)
    elif new_verified:
        rule = "continue: the latest pass produced {} new verified finding(s)".format(
            len(new_verified))
    elif unseen >= 1:
        rule = "continue: the Chao2 estimate of unseen clusters is {:.2f} (>= 1)".format(unseen)
    else:
        rule = ("stop allowed once the unit's minimum passes are done: no new verified finding "
                "in the latest pass and Chao2 unseen < 1")
    if pass_numbers and not ledger["clusters"].get(lens):
        rule += " (no clusters merged for this lens yet: run `ledger.py merge`)"
    return {
        "lens": lens,
        "unit": unit.get("id") if unit else None,
        "passes": pass_numbers,
        "pass_rows": len(rows),
        "files_full": sum(1 for v in coverage.values() if v == "full"),
        "files_partial": sum(1 for v in coverage.values() if v == "partial"),
        "files_in_scope": len(unit_paths) if unit_paths is not None else len(ledger["files"]),
        "S_obs": s_obs,
        "Q1": q1,
        "Q2": q2,
        "chao2": round(estimate, 2),
        "unseen_estimate": round(unseen, 2),
        "mean_pairwise_jaccard": round(sum(jaccards) / len(jaccards), 3) if jaccards else None,
        "per_pass_clusters": {str(p): len(sets[p]) for p in pass_numbers},
        "new_in_latest_pass": len(new_latest),
        "new_verified_in_latest_pass": len(new_verified),
        "clusters_without_candidate_file": unmapped,
        "clusters_from_other_sources": external,
        "stop_rule": rule,
        "few_passes": len(pass_numbers) < FEW_PASSES,
        "caveat": CHAO2_CAVEAT,
    }


# ---------------------------------------------------------------------------
# Reconciliation (DT-16, DT-27)
# ---------------------------------------------------------------------------


def has_reason(entry: Dict[str, Any], keys: Sequence[str]) -> bool:
    for key in keys:
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return True
        if isinstance(value, list) and value:
            return True
    return False


def reconcile_lenses(ledger: Dict[str, Any], outcomes: Outcomes, final: bool
                     ) -> Tuple[Dict[str, Any], List[str], List[str]]:
    problems: List[str] = []
    warnings: List[str] = []
    lenses = sorted(({r["lens"] for r in ledger["passes"]} | set(ledger["clusters"])
                     | {c.get("lens") for c in outcomes.candidates or []
                        if c.get("lens") in LENSES}) - {TOOL_LENS, EXPLORATION})
    per_lens: Dict[str, Any] = {}
    totals = {"raw": 0, "verified": 0, "rejected": 0, "deferred": 0, "duplicates": 0,
              "unresolved": 0}
    totals_known = True
    for lens in lenses:
        rows = [r for r in ledger["passes"] if r.get("lens") == lens]
        counts = [r.get("candidates") for r in rows]
        # Counts a bundle or the exploration pass reported for this lens (A01-F33, A01-F37).
        other_raw = sum(int((r.get("candidates_other_lenses") or {}).get(lens, 0) or 0)
                        for r in ledger["passes"])
        pass_raw: Optional[int] = sum(counts) + other_raw \
            if all(isinstance(c, int) for c in counts) else None
        clusters = ledger["clusters"].get(lens) or {}
        external_raw = sum(int(c.get("raw", 0)) for c in clusters.values()
                           if not c.get("seen_in_passes"))
        raw = None if pass_raw is None else pass_raw + external_raw
        cands = [c for c in outcomes.candidates or [] if c.get("lens") == lens]
        tally = {"verified": 0, "rejected": 0, "deferred": 0, "unresolved": 0}
        for cand in cands:
            cid = str(cand.get("id"))
            result = outcomes.outcome(cid)
            tally[result if result in tally else "unresolved"] += 1
            if result == "rejected":
                if cid in outcomes.finding_ids:
                    problems.append("{}: candidate {} is rejected in {} but listed in {}".format(
                        lens, cid, CANDIDATES_REL, FINDINGS_REL))
                if not has_reason(cand, ("verifier_note", "notes")):
                    problems.append("{}: rejected candidate {} has no reason (verifier_note or "
                                    "notes; DT-16 dismissed-with-reason)".format(lens, cid))
        entry: Dict[str, Any] = {"raw": raw, "raw_from_passes": pass_raw,
                                 "raw_from_other_sources": external_raw,
                                 "candidates": len(cands), **tally,
                                 "duplicates": None, "clusters": len(clusters),
                                 "balanced": False}
        if pass_raw is None:
            missing = [r["id"] for r in rows if not isinstance(r.get("candidates"), int)]
            problems.append("{}: raw candidate count unknown; pass rows without --candidates: "
                            "{}".format(lens, ", ".join(missing)))
        if clusters:
            cluster_raw = sum(int(c.get("raw", 0)) for c in clusters.values()
                              if c.get("seen_in_passes"))
            entry["duplicates"] = sum(int(c.get("raw", 0)) - 1 for c in clusters.values())
            if pass_raw is not None and cluster_raw != pass_raw:
                problems.append("{}: merged clusters account for {} raw candidates but the pass "
                                "rows report {} (DT-23 cluster-to-raw map)".format(
                                    lens, cluster_raw, pass_raw))
            if outcomes.candidates is not None:
                ids = {str(c.get("id")) for c in cands}
                orphans = sorted(set(clusters) - ids)
                unclustered = sorted(ids - set(clusters))
                if orphans:
                    problems.append("{}: clusters without a candidate in {}: {}".format(
                        lens, CANDIDATES_REL, ", ".join(orphans[:LIST_LIMIT])))
                if unclustered:
                    problems.append("{}: candidates not in any merged cluster: {}".format(
                        lens, ", ".join(unclustered[:LIST_LIMIT])))
        elif raw is not None and (outcomes.candidates is not None or raw == 0):
            entry["duplicates"] = raw - len(cands)
            if raw < len(cands):
                problems.append("{}: {} holds {} candidates but the passes returned only {} "
                                "raw candidates; candidates found by prescan or another "
                                "deterministic source belong in `ledger.py merge` clusters with "
                                "a \"source\" instead of passes".format(
                                    lens, CANDIDATES_REL, len(cands), raw))
        if raw is not None and entry["duplicates"] is not None:
            entry["balanced"] = (tally["unresolved"] == 0 and raw == tally["verified"]
                                 + tally["rejected"] + tally["deferred"] + entry["duplicates"])
        if tally["deferred"]:
            warnings.append("{}: {} candidate(s) deferred without verification (run budget): "
                            "list them under Limits (k) (A01-F34)".format(lens,
                                                                          tally["deferred"]))
        if tally["unresolved"]:
            message = "{}: {} candidate(s) neither verified nor rejected yet".format(
                lens, tally["unresolved"])
            (problems if final else warnings).append(message + (" (DT-27)" if final else
                                                                " (pending verification)"))
        if outcomes.candidates is None and raw:
            message = "{}: {} raw candidates recorded but {} does not exist".format(
                lens, raw, CANDIDATES_REL)
            (problems if final else warnings).append(message)
        for key in ("verified", "rejected", "deferred", "unresolved"):
            totals[key] += tally[key]
        if raw is None or entry["duplicates"] is None:
            totals_known = False
        else:
            totals["raw"] += raw
            totals["duplicates"] += entry["duplicates"]
        per_lens[lens] = entry
    for fid in sorted(outcomes.finding_ids):
        if outcomes.candidates is not None and fid not in outcomes.by_id:
            warnings.append("finding {} in {} has no candidate in {}: it cannot be traced to a "
                            "raw candidate".format(fid, FINDINGS_REL, CANDIDATES_REL))
    result = {"lenses": per_lens,
              "totals": dict(totals, balanced=totals_known and all(
                  e["balanced"] for e in per_lens.values())) if per_lens else None,
              "candidates_file": outcomes.candidates is not None,
              "findings_file": outcomes.findings is not None}
    return result, problems, warnings


def triage_entries(data: Any) -> List[Dict[str, Any]]:
    if isinstance(data, dict):
        for key in ("results", "alerts", "entries", "triage"):
            if key in data and isinstance(data[key], (dict, list)):
                return triage_entries(data[key])
        out = []
        for key, value in sorted(data.items()):
            if isinstance(value, dict):
                out.append(dict(value, _key=key))
        return out
    if isinstance(data, list):
        out = []
        for i, value in enumerate(data):
            if isinstance(value, dict):
                key = value.get("fingerprint") or value.get("id") or "#{}".format(i)
                out.append(dict(value, _key=str(key)))
        return out
    return []


def sarif_result_count(repo: Path) -> Optional[int]:
    tools = repo / ".harden" / "tools"
    if not tools.is_dir():
        return None
    total = 0
    found = False
    for path in sorted(tools.rglob("*.sarif")):
        try:
            data = C.read_json(path)
        except (OSError, ValueError):
            continue
        found = True
        runs = data.get("runs") if isinstance(data, dict) else None
        for run in runs if isinstance(runs, list) else []:
            if isinstance(run, dict) and isinstance(run.get("results"), list):
                total += len(run["results"])
    return total if found else None


def reconcile_triage(repo: Path, outcomes: Outcomes, final: bool
                     ) -> Tuple[Optional[Dict[str, Any]], List[str], List[str]]:
    problems: List[str] = []
    warnings: List[str] = []
    tool_cands = [c for c in outcomes.candidates or [] if c.get("lens") == TOOL_LENS]
    path = repo / TRIAGE_REL
    if not path.is_file():
        if tool_cands:
            problems.append("{} project-tool candidate(s) but no {} (DT-12: every tool result "
                            "is labelled TP, FP or won't-fix)".format(len(tool_cands),
                                                                      TRIAGE_REL))
        return None, problems, warnings
    entries = triage_entries(read_json_file(path, "triage"))
    counts = {"TP": 0, "FP": 0, "wont-fix": 0, "unlabelled": 0}
    tp_keys: Set[str] = set()
    dismissed: List[Dict[str, Any]] = []
    for entry in entries:
        raw_status = entry.get("status", entry.get("label", entry.get("verdict")))
        status = TRIAGE_STATUS.get(str(raw_status).strip().lower()) if raw_status else None
        key = entry["_key"]
        if status is None:
            counts["unlabelled"] += 1
            problems.append("triage {}: status {!r} is not TP, FP or won't-fix".format(
                key, raw_status))
            continue
        counts[status] += 1
        if status == "TP":
            tp_keys.add(key)
            if isinstance(entry.get("fingerprint"), str):
                tp_keys.add(entry["fingerprint"])
            continue
        dismissed.append(entry)
        if not has_reason(entry, ("reason", "evidence", "notes", "note")):
            problems.append("triage {}: dismissed without a reason tied to the code (DT-12, "
                            "DT-16)".format(key))
        severity = str(entry.get("severity", entry.get("level", ""))).strip().lower()
        category = " ".join(str(entry.get(k, "")) for k in ("category", "lens", "tags")).lower()
        confirmed = str(entry.get("confirmed_by", "")).strip().lower()
        if (severity in HIGH_SEVERITIES or "security" in category) and \
                confirmed not in CONFIRMATIONS:
            problems.append("triage {}: {} alert dismissed without human or deterministic "
                            "confirmation (set confirmed_by to one of {}; DT-16)".format(
                                key, "security" if "security" in category else severity,
                                ", ".join(CONFIRMATIONS)))
    required = min(len(dismissed), max(RECHECK_MIN, int(math.ceil(RECHECK_SHARE
                                                                  * len(dismissed)))))
    rechecked = sum(1 for e in dismissed if e.get("rechecked") is True
                    or (isinstance(e.get("rechecked"), str) and e["rechecked"].strip()))
    if rechecked < required:
        message = ("triage: {} of {} dismissals re-checked; DT-16 asks for at least {} (10% and "
                   "at least 5) by execution or a verifier from another model family".format(
                       rechecked, len(dismissed), required))
        (problems if final else warnings).append(message)
    for cand in tool_cands:
        fp = cand.get("fingerprint")
        if not (isinstance(fp, str) and fp in tp_keys):
            problems.append("project-tool candidate {} does not cite a TP entry of {} by its "
                            "fingerprint (DT-12)".format(cand.get("id"), TRIAGE_REL))
    sarif = sarif_result_count(repo)
    if sarif is not None and sarif > len(entries):
        warnings.append("{} SARIF results in .harden/tools but {} triage entries: every tool "
                        "result needs a label (DT-12, DT-16)".format(sarif, len(entries)))
    result = {"raw_alerts": len(entries), **counts,
              "reported": counts["TP"], "dismissed": len(dismissed),
              "rechecked": rechecked, "recheck_required": required,
              "sarif_results": sarif,
              "balanced": counts["unlabelled"] == 0
              and len(entries) == counts["TP"] + len(dismissed)}
    return result, problems, warnings


# ---------------------------------------------------------------------------
# check / stats / budget
# ---------------------------------------------------------------------------


def tokens_used(ledger: Dict[str, Any]) -> int:
    return sum(int(r.get("tokens_in") or 0) + int(r.get("tokens_out") or 0)
               for r in ledger["passes"])


def cmd_check(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    problems: List[str] = []
    warnings: List[str] = []
    if args.lenses and EXPLORATION in [p.strip().lower() for p in args.lenses.split(",")]:
        raise LedgerError("the exploration pass has no coverage requirement")
    lenses = parse_lens_list(args.lenses) or sorted(
        {r["lens"] for r in ledger["passes"] if not is_supplementary(r)} - {EXPLORATION})
    if TOOL_LENS in lenses:
        raise LedgerError("project-tool coverage is not tracked by pass rows; drop it from "
                          "--lenses (its results are reconciled from {})".format(TRIAGE_REL))
    if not lenses:
        problems.append("no lens pass recorded and no --lenses given: nothing was examined")
    explicit = [k.strip() for k in (args.kinds or "").split(",") if k.strip()]
    bad = [k for k in explicit if k not in FILE_KINDS]
    if bad:
        raise LedgerError("unknown --kinds {}; use {}".format(", ".join(bad),
                                                              ", ".join(FILE_KINDS)))
    globs = [C.to_posix(g) for g in args.glob or [] if g.strip()]
    loc_of = {f["path"]: int(f.get("loc") or 0) for f in ledger["files"]}

    def required_for(kinds: Sequence[str]) -> List[Dict[str, Any]]:
        return [f for f in ledger["files"] if f.get("kind", "other") in kinds
                and (not globs or C.match_any(f["path"], globs))]

    coverage_out: Dict[str, Any] = {}
    unit_out: Dict[str, Any] = {}
    required_union: Dict[str, Dict[str, Any]] = {}
    for lens in lenses:
        kinds = explicit or list(LENS_KINDS.get(lens, CODE_LENS_KINDS))
        required = required_for(kinds)
        required_union.update((f["path"], f) for f in required)
        required_loc = sum(int(f.get("loc") or 0) for f in required)
        cov = lens_coverage(ledger, lens)
        uncovered = [f["path"] for f in required if f["path"] not in cov]
        partial = [f["path"] for f in required if cov.get(f["path"]) == "partial"]
        covered = [f["path"] for f in required if cov.get(f["path"]) == "full"]
        covered_loc = sum(loc_of[p] for p in covered)
        coverage_out[lens] = {
            "passes": sorted({int(r["pass"]) for r in coverage_rows(ledger, lens)}),
            "kinds": kinds,
            "required_files": len(required), "covered_files": len(covered),
            "covered_loc": covered_loc, "required_loc": required_loc,
            "covered_loc_pct": round(100.0 * covered_loc / required_loc, 1) if required_loc
            else 100.0,
            "uncovered": uncovered, "partial": partial,
        }
        if uncovered or partial:
            problems.append("{}: {} of {} required files not covered ({} unread, {} partial)"
                            .format(lens, len(uncovered) + len(partial), len(required),
                                    len(uncovered), len(partial)))
        states = {"examined": 0, "partial": 0, "unexamined": 0}
        for unit in ledger["units"]:
            states[(unit.get("lens_status") or {}).get(lens, "unexamined")] += 1
        unit_out[lens] = states
    required_all = list(required_union.values())

    missing_meta: List[Dict[str, Any]] = []
    subagents: Dict[str, List[Dict[str, Any]]] = {}
    for row in ledger["passes"]:
        missing = [k for k in ("model_id", "effort", "prompt_sha256")
                   if not (isinstance(row.get(k), str) and row[k].strip()
                           and row[k].strip() != "unknown")]
        if missing:
            missing_meta.append({"id": row["id"], "lens": row.get("lens"),
                                 "pass": row.get("pass"), "missing": missing})
        if not row.get("classes") and row.get("lens") != EXPLORATION:
            warnings.append("{} ({} pass {}) has no classes list (DT-22)".format(
                row["id"], row.get("lens"), row.get("pass")))
        if row.get("subagent_id"):
            subagents.setdefault(str(row["subagent_id"]), []).append(row)
    for item in missing_meta:
        problems.append("{} ({} pass {}) lacks {} (DT-18)".format(
            item["id"], item["lens"], item["pass"], ", ".join(item["missing"])))
    claimed = [r for r in ledger["passes"] if r.get("model_source") != "transcript"
               and not r.get("allow_missing_metadata")]
    if claimed:
        text = ("{} pass row(s) record a model no transcript showed ({}): re-record with "
                "--meta-file after persist_pass.py recover --agent-id <id>, or re-dispatch the "
                "pass (claimed-model; DT-18; pilot-auto-calibration A01-F41)".format(
                    len(claimed), ", ".join(r["id"] for r in claimed[:LIST_LIMIT])))
        if args.final and (repo / AGENTS_REL).is_file():
            problems.append(text)
        else:
            warnings.append(text)
    for sid, rows_of in sorted(subagents.items()):
        sid_lenses = sorted({str(r.get("lens")) for r in rows_of} - {EXPLORATION})
        bundles = {r.get("bundle") for r in rows_of}
        if len(sid_lenses) > 1 and not (len(bundles) == 1 and None not in bundles):
            problems.append("subagent id {} is recorded under lenses {}: one pass carries at "
                            "most one lens file unless its rows form one recorded bundle (DT-21; "
                            "pilot-auto-calibration A01-F19, A01-F33)".format(
                                sid, ", ".join(sid_lenses)))
        elif len(sid_lenses) > MAX_BUNDLE:
            problems.append("subagent id {} carries {} lenses; a bundle holds at most 3 (DT-21; "
                            "A01-F33)".format(sid, len(sid_lenses)))
        pairs = [(str(r.get("lens")), r.get("bundle")) for r in rows_of]
        if len(pairs) != len(set(pairs)) or (len(sid_lenses) <= 1 and len(rows_of) > 1
                                             and None in bundles):
            warnings.append("subagent id {} appears on several pass rows ({}); DT-21 wants one "
                            "fresh subagent per pass".format(sid, ", ".join(
                                r["id"] for r in rows_of)))

    stale = stale_files(repo, ledger)
    if stale:
        warnings.append("{} in-scope file(s) changed since `ledger.py init`; their coverage "
                        "refers to older content: {}".format(len(stale), ", ".join(
                            stale[:LIST_LIMIT])))

    budget = ledger.get("budget") or {}
    used = tokens_used(ledger)
    budget_out = {k: budget.get(k) for k in ("budget_cap_tokens", "estimate_tokens",
                                             "verification_reserve", "full_read_tokens",
                                             "pass_overhead_tokens")}
    budget_out["tokens_used"] = used
    overhead = budget.get("pass_overhead_tokens")
    if isinstance(overhead, int) and overhead > 0:
        budget_out["pass_overhead_so_far"] = overhead * len(ledger["passes"])
    budget_out["replans"] = len(budget.get("replans") or [])
    unset = [k for k in ("budget_cap_tokens", "estimate_tokens", "verification_reserve")
             if budget.get(k) is None]
    # DT-25: an autonomous run's cap is the profile's budget.max_tokens; a profile without one
    # means no cap (the documented default), which is recorded rather than warned about.
    marker = read_marker(repo)
    if marker is not None:
        autonomous, profile_cap = cap_policy(marker)
    else:  # the run has stopped: the header `init` wrote still says whether no cap was the default
        autonomous, profile_cap = budget.get("budget_cap_note") == AUTONOMOUS_NO_CAP, None
    cap = budget.get("budget_cap_tokens")
    budget_out["budget_cap_note"] = None
    if autonomous and profile_cap is None:
        if cap is None:
            unset.remove("budget_cap_tokens")
            budget_out["budget_cap_note"] = AUTONOMOUS_NO_CAP
        else:
            warnings.append("budget_cap_tokens is {} although the run profile sets no "
                            "budget.max_tokens: an autonomous run never chooses a cap itself, "
                            "and its default is {} (DT-25; user-policy-autonomy U01-F01)"
                            .format(cap, AUTONOMOUS_NO_CAP))
    elif autonomous and cap is not None and cap != profile_cap:
        warnings.append("budget_cap_tokens is {} but the run profile's budget.max_tokens is {}: "
                        "an autonomous run takes the cap from the profile (DT-25; `ledger.py "
                        "budget --cap {}`)".format(cap, profile_cap, profile_cap))
    if unset:
        hint = " (the run profile's budget.max_tokens is {}: `ledger.py budget --cap {}`)".format(
            profile_cap, profile_cap) if autonomous and profile_cap is not None and \
            "budget_cap_tokens" in unset else ""
        warnings.append("budget header lacks {} (DT-25: set before the first pass with "
                        "`ledger.py budget`){}".format(", ".join(unset), hint))
    estimate = budget.get("estimate_tokens")
    if isinstance(estimate, int) and estimate > 0 and used > 2 * estimate:
        problems.append("tokens used ({}) exceed 2x the estimate ({}) without a re-plan that "
                        "raised it (`ledger.py budget --replan TEXT --estimate N`, DT-25)"
                        .format(used, estimate))
    cap = budget.get("budget_cap_tokens")
    if isinstance(cap, int) and cap > 0 and used > cap:
        warnings.append("tokens used ({}) exceed the budget cap ({})".format(used, cap))

    outcomes = load_outcomes(repo)
    skipped: Dict[str, List[str]] = {}
    for unit in ledger["units"]:
        for lens, stop in sorted((unit.get("stops") or {}).items()):
            if isinstance(stop, dict) and stop.get("reason") == "skipped-budget":
                skipped.setdefault(lens, []).append(str(unit.get("id")))
            if not isinstance(stop, dict) or stop.get("reason") != "converged":
                continue
            if stop.get("new_verified_in_latest_pass") or \
                    float(stop.get("unseen_estimate") or 0) >= 1:
                problems.append("unit {} ({}) was stopped as converged while its latest pass "
                                "had new verified findings or Chao2 unseen >= 1 (DT-25)"
                                .format(unit["id"], lens))

    recon, rec_problems, rec_warnings = reconcile_lenses(ledger, outcomes, args.final)
    triage, tri_problems, tri_warnings = reconcile_triage(repo, outcomes, args.final)
    problems += rec_problems + tri_problems
    warnings += rec_warnings + tri_warnings

    result = {
        "ok": not problems,
        "ledger": LEDGER_REL,
        "lenses": lenses,
        "in_scope": {"files": len(ledger["files"]),
                     "loc": sum(int(f.get("loc") or 0) for f in ledger["files"]),
                     "excluded_files": len(ledger.get("exclusions") or [])},
        "required": {"files": len(required_all),
                     "loc": sum(int(f.get("loc") or 0) for f in required_all),
                     "kinds": explicit or "per lens (LENS_KINDS)", "globs": globs},
        "coverage": coverage_out,
        "units": unit_out,
        "pass_metadata_missing": missing_meta,
        "stale": stale,
        "budget": budget_out,
        "reconciliation": recon,
        "triage": triage,
        "skipped_budget": {k: sorted(v) for k, v in sorted(skipped.items())},
        "exploration": {"rows": sum(1 for r in ledger["passes"] if r.get("lens") == EXPLORATION),
                        "raw": sum(sum(int(v or 0) for v in (r.get("candidates_other_lenses")
                                                              or {}).values())
                                   for r in ledger["passes"] if r.get("lens") == EXPLORATION)},
        "final": bool(args.final),
        "problems": problems,
        "warnings": warnings,
    }
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if not problems else 1
    print(format_check(result))
    return 0 if not problems else 1


def gaps_manifest(ledger: Dict[str, Any], lenses: Sequence[str], unit_id: Optional[str],
                  explicit_kinds: Sequence[str], globs: Sequence[str]
                  ) -> Tuple[List[Dict[str, Any]], int, int, int]:
    """(manifest, required lines, unread lines, trivial lines skipped) of one lens or a bundle:
    each lens's own required files and unread lines, merged by path (A01-F33)."""
    kind_of = {f["path"]: f.get("kind", "other") for f in ledger["files"]}
    unit = None
    if unit_id:
        unit = find_unit(ledger, unit_id.strip())
        if unit is None:
            raise LedgerError("unit {!r} does not exist".format(unit_id))
    merged_unread: Dict[str, List[Range]] = {}
    merged_required: Dict[str, List[Range]] = {}
    trivial: Dict[str, int] = {}
    for lens in lenses:
        kinds = list(explicit_kinds) or list(LENS_KINDS.get(lens, CODE_LENS_KINDS))
        if unit is not None:
            entries = [f for f in unit.get("files") or [] if kind_of.get(f["path"]) in kinds]
        else:
            entries = [f for f in ledger["files"] if f.get("kind", "other") in kinds]
        if globs:
            entries = [f for f in entries if C.match_any(f["path"], globs)]
        whole, parts = lens_reads(ledger, lens)
        for entry in entries:
            required = required_ranges(entry)
            trivial[entry["path"]] = sum(int(b) - int(a) + 1
                                         for a, b in entry.get("trivial") or [])
            if not required:
                continue
            merged_required.setdefault(entry["path"], []).extend(
                (int(a), int(b)) for a, b in required)
            if entry["path"] in whole:
                continue
            unread = unread_ranges(required, parts.get(entry["path"]))
            if unread:
                merged_unread.setdefault(entry["path"], []).extend(
                    (int(a), int(b)) for a, b in unread)
    manifest = [{"path": p, "ranges": merge_ranges(merged_unread[p])}
                for p in sorted(merged_unread)]
    required_lines = sum(b - a + 1 for rs in merged_required.values()
                         for a, b in merge_ranges(rs))
    unread_lines = sum(b - a + 1 for item in manifest for a, b in item["ranges"])
    return manifest, required_lines, unread_lines, sum(trivial.values())


def write_manifest(repo: Path, out_arg: str, manifest: Sequence[Dict[str, Any]]) -> Path:
    out = Path(out_arg)
    if not out.is_absolute():
        out = repo / out
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(list(manifest), handle, indent=2)
        handle.write("\n")
    return out


def cmd_gaps(args: argparse.Namespace) -> int:
    """The lines of the required files no non-compacted pass of the lens (or of each lens of a
    bundle) read (DT-02)."""
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    lenses = parse_lens_arg(args.lens, allow_exploration=False)
    explicit = [k.strip() for k in (args.kinds or "").split(",") if k.strip()]
    bad = [k for k in explicit if k not in FILE_KINDS]
    if bad:
        raise LedgerError("unknown --kinds {}; use {}".format(", ".join(bad),
                                                              ", ".join(FILE_KINDS)))
    globs = [C.to_posix(g) for g in args.glob or [] if g.strip()]
    manifest, required_lines, unread_lines, trivial = gaps_manifest(
        ledger, lenses, args.unit, explicit, globs)
    if args.out:
        write_manifest(repo, args.out, manifest)
    if args.json:
        print(json.dumps({"lens": ",".join(lenses), "unit": args.unit,
                          "required_lines": required_lines, "unread_lines": unread_lines,
                          "trivial_lines_skipped": trivial, "files": manifest}, indent=2))
    else:
        print("gaps: {} files, {} unread lines of {} required (lens {}{}); {} blank or "
              "closing-punctuation lines not required".format(
                  len(manifest), unread_lines, required_lines, ",".join(lenses),
                  ", unit {}".format(args.unit) if args.unit else "", trivial))
    return 1 if manifest else 0


def _limited(items: Sequence[str]) -> str:
    shown = ", ".join(items[:LIST_LIMIT])
    if len(items) > LIST_LIMIT:
        shown += ", ... ({} more; --json lists all)".format(len(items) - LIST_LIMIT)
    return shown


def format_check(result: Dict[str, Any]) -> str:
    lines = ["Coverage ledger check ({})".format(result["ledger"])]
    ins = result["in_scope"]
    req = result["required"]
    kinds = req["kinds"] if isinstance(req["kinds"], str) else ",".join(req["kinds"])
    lines.append("In scope: {} files, {} LOC ({} excluded with reasons). Required by this "
                 "check: {} files, {} LOC (kinds {}{})".format(
                     ins["files"], ins["loc"], ins["excluded_files"], req["files"], req["loc"],
                     kinds, "; globs " + ", ".join(req["globs"]) if req["globs"] else ""))
    for lens, cov in result["coverage"].items():
        bad = cov["uncovered"] or cov["partial"]
        lines.append("[{}] {}: {}/{} files covered ({}% of LOC), kinds {}, passes {}".format(
            "FAIL" if bad else " ok ", lens, cov["covered_files"], cov["required_files"],
            cov["covered_loc_pct"], ",".join(cov["kinds"]),
            ",".join(str(p) for p in cov["passes"]) or "none"))
        if cov["uncovered"]:
            lines.append("       unread:  " + _limited(cov["uncovered"]))
        if cov["partial"]:
            lines.append("       partial: " + _limited(cov["partial"]))
    for lens, units in (result.get("skipped_budget") or {}).items():
        lines.append("Not examined (budget): {} {} unit(s)".format(lens, len(units)))
    recon = result["reconciliation"]
    if recon["lenses"]:
        lines.append("Reconciliation (raw = verified + rejected + duplicates):")
        for lens, e in recon["lenses"].items():
            lines.append("  {}: raw {} | verified {} + rejected {} + deferred {} + duplicates {} "
                         "| unresolved {} -> {}".format(lens, e["raw"], e["verified"],
                                                        e["rejected"], e.get("deferred", 0),
                                                        e["duplicates"], e["unresolved"],
                                                        "balanced" if e["balanced"]
                                                        else "not balanced"))
    triage = result["triage"]
    if triage:
        lines.append("Tool alerts ({}): {} raw = {} TP + {} dismissed ({} re-checked, {} "
                     "required){}".format(TRIAGE_REL, triage["raw_alerts"], triage["TP"],
                                          triage["dismissed"], triage["rechecked"],
                                          triage["recheck_required"],
                                          "; {} unlabelled".format(triage["unlabelled"])
                                          if triage["unlabelled"] else ""))
    budget = result["budget"]
    lines.append("Budget: {} tokens used; estimate {}, cap {}, verification reserve {}, per-pass "
                 "overhead {}".format(budget["tokens_used"], budget["estimate_tokens"],
                                      cap_text(budget), budget["verification_reserve"],
                                      budget.get("pass_overhead_tokens")))
    if result["problems"]:
        lines.append("Problems ({}):".format(len(result["problems"])))
        lines += ["  - " + p for p in result["problems"]]
    if result["warnings"]:
        lines.append("Warnings ({}):".format(len(result["warnings"])))
        lines += ["  - " + w for w in result["warnings"]]
    if result["ok"]:
        lines.append("Result: OK. Coverage means the files were read, not that they are "
                     "defect-free (DT-17, DT-34).")
    else:
        gaps = any(c["uncovered"] or c["partial"] for c in result["coverage"].values())
        lines.append("Result: FAIL ({} problem(s)).{}".format(
            len(result["problems"]), " An unread or partial file is a Limits entry of the "
            "report, never a clean file." if gaps else ""))
    return "\n".join(lines)


def cmd_stats(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    outcomes = load_outcomes(repo)
    unit = None
    if args.unit:
        unit = find_unit(ledger, args.unit)
        if unit is None:
            raise LedgerError("unknown unit {!r}".format(args.unit))
    lenses = parse_lens_list(args.lenses) or sorted(({r["lens"] for r in ledger["passes"]}
                                                     | set(ledger["clusters"])) - {EXPLORATION})
    stats = [lens_stats(repo, ledger, lens, outcomes, unit) for lens in lenses
             if lens != TOOL_LENS]
    if args.json:
        print(json.dumps({"ledger": LEDGER_REL, "unit": args.unit, "lenses": stats,
                          "caveat": CHAO2_CAVEAT}, indent=2, ensure_ascii=False))
        return 0
    if not stats:
        print("No lens pass recorded yet.")
        return 0
    for s in stats:
        lines = ["lens {}{}: passes {} ({} rows); files covered {}/{} ({} partial)".format(
            s["lens"], " unit " + s["unit"] if s["unit"] else "",
            ",".join(str(p) for p in s["passes"]) or "none", s["pass_rows"], s["files_full"],
            s["files_in_scope"], s["files_partial"])]
        lines.append("  clusters: union S_obs {}, singletons Q1 {}, doubletons Q2 {}, Chao2 {} "
                     "(unseen >= {}), mean pairwise Jaccard {}".format(
                         s["S_obs"], s["Q1"], s["Q2"], s["chao2"], s["unseen_estimate"],
                         s["mean_pairwise_jaccard"]))
        lines.append("  latest pass: {} new cluster(s), {} new verified".format(
            s["new_in_latest_pass"], s["new_verified_in_latest_pass"]))
        lines.append("  DT-25: " + s["stop_rule"])
        if s["few_passes"]:
            lines.append("  fewer than {} passes: the estimate is meaningless".format(FEW_PASSES))
        print("\n".join(lines))
    print("Caveat: " + CHAO2_CAVEAT)
    return 0


def cmd_budget(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    budget = ledger.setdefault("budget", {})
    budget.setdefault("replans", [])
    for name in ("cap", "reserve", "estimate", "pass_overhead"):
        value = getattr(args, name)
        if value is not None and value < 0:
            raise LedgerError("--{} must not be negative".format(name.replace("_", "-")))
    old_estimate = budget.get("estimate_tokens")
    if args.estimate is not None and old_estimate is not None and \
            args.estimate != old_estimate and not (args.replan or "").strip():
        raise LedgerError("changing an existing estimate is a re-plan: add --replan TEXT with "
                          "the reason (DT-25)")
    if args.cap is not None:
        budget["budget_cap_tokens"] = args.cap
        budget["budget_cap_note"] = None
    if args.reserve is not None:
        budget["verification_reserve"] = args.reserve
    if args.estimate is not None:
        budget["estimate_tokens"] = args.estimate
    if args.pass_overhead is not None:
        budget["pass_overhead_tokens"] = args.pass_overhead
    if (args.replan or "").strip():
        budget["replans"].append({"at": C.utc_iso(), "note": args.replan.strip(),
                                  "previous_estimate": old_estimate,
                                  "estimate_tokens": budget.get("estimate_tokens"),
                                  "tokens_used": tokens_used(ledger)})
    save_ledger(repo, ledger)
    print("budget: cap {}, estimate {}, verification reserve {}, full read ~{} tokens, used {}, "
          "{} re-plan(s)".format(cap_text(budget), budget.get("estimate_tokens"),
                                 budget.get("verification_reserve"),
                                 budget.get("full_read_tokens"), tokens_used(ledger),
                                 len(budget["replans"])))
    overhead = budget.get("pass_overhead_tokens")
    if isinstance(overhead, int) and overhead > 0:
        print("  per-pass overhead {} tokens (lens + language + schema files): a pass over a "
              "slice costs {} + its read tokens; {} pass row(s) so far = {} overhead tokens"
              .format(overhead, overhead, len(ledger["passes"]),
                      overhead * len(ledger["passes"])))
    return 0


# ---------------------------------------------------------------------------
# ingest / stop-budget / status-baseline (pilot-auto-calibration A01-F30, A01-F31, A01-F34,
# A01-F36)
# ---------------------------------------------------------------------------

PASSES_REL = ".harden/passes"
RAW_PASSES_REL = ".harden/passes/raw"
RAW_CANDIDATES_REL = ".harden/raw-candidates.json"
AGENTS_REL = ".harden/agents.json"
VERIFIERS_REL = ".harden/verifiers"
MODELS_REL = ".harden/tools/models.json"
MODELS_LINE = "- Models, as the transcripts show them"
SESSION_REL = ".harden/session.json"
EVENTS_REL = ".harden/hook_events.log"
ENTITY_RE = re.compile(r"&(?:lt|gt|amp);")
RULE_HEADING_RE = re.compile(r"^### ([A-Z][A-Z0-9]-\d{2}) " + chr(0x2014) + " ", re.M)
MAX_BRACE_SCAN = 5000


def session_transcript(repo: Path) -> Optional[Path]:
    """The main session's transcript: .harden/session.json, else the first hook event line
    that names one (hook_guard.py records both)."""
    try:
        data = C.read_json(repo / SESSION_REL)
        value = data.get("transcript_path") if isinstance(data, dict) else None
        if isinstance(value, str) and value.strip():
            return Path(value)
    except (OSError, ValueError):
        pass
    try:
        with open(repo / EVENTS_REL, "r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                value = event.get("transcript_path") if isinstance(event, dict) else None
                if isinstance(value, str) and value.strip():
                    return Path(value)
    except OSError:
        pass
    return None


def subagent_message(path: Path) -> Tuple[Optional[str], List[str]]:
    """(the final message of a subagent transcript, its models): the `message` input of the
    last SubagentHandback call, else the text blocks of the last assistant line. Only that text
    and the model ids are kept (A01-F30)."""
    try:
        data = path.read_bytes()
    except OSError:
        return None, []
    handback: Optional[str] = None
    last_text: Optional[str] = None
    models: Set[str] = set()
    for raw in data.decode("utf-8", errors="replace").lstrip(chr(0xFEFF)).splitlines():
        try:
            line = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(line, dict) or line.get("type") != "assistant":
            continue
        message = line.get("message")
        if not isinstance(message, dict):
            continue
        model = message.get("model")
        if isinstance(model, str) and model and model != "<synthetic>":
            models.add(model)
        content = message.get("content")
        if isinstance(content, str):
            last_text = content
            continue
        texts: List[str] = []
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use" and block.get("name") == "SubagentHandback":
                inp = block.get("input")
                if isinstance(inp, dict) and isinstance(inp.get("message"), str):
                    handback = inp["message"]
            elif block.get("type") == "text" and isinstance(block.get("text"), str):
                texts.append(block["text"])
        if texts:
            last_text = "".join(texts)
    return (handback if handback is not None else last_text), sorted(models)


def _highest(raw_dir: Path, stem: str, suffix: str) -> Optional[Path]:
    best: Optional[Path] = None
    best_n = 0
    base = raw_dir / (stem + suffix)
    if base.is_file():
        best, best_n = base, 1
    for path in raw_dir.glob("{}.*{}".format(stem, suffix)):
        m = re.match(r"^" + re.escape(stem) + r"\.(\d+)" + re.escape(suffix) + r"$", path.name)
        if m and int(m.group(1)) > best_n:
            best, best_n = path, int(m.group(1))
    return best


def pass_sources(repo: Path, agent: Optional[str], pass_id: str
                 ) -> List[Tuple[str, bytes, Optional[Dict[str, Any]]]]:
    """Candidate sources of a pass's final message, in order: (label, bytes, meta)."""
    raw_dir = repo / RAW_PASSES_REL
    out: List[Tuple[str, bytes, Optional[Dict[str, Any]]]] = []

    def meta_of(path: Path) -> Optional[Dict[str, Any]]:
        try:
            data = C.read_json(path.with_suffix(".json"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    if agent:
        for suffix in (".handback.md", ".md"):
            found = _highest(raw_dir, agent, suffix) if raw_dir.is_dir() else None
            if found is not None and not (suffix == ".md" and found.name.endswith(
                    ".handback.md")):
                try:
                    out.append((C.to_posix(os.path.relpath(str(found), str(repo))),
                                found.read_bytes(), meta_of(found)))
                except OSError:
                    pass
        main = session_transcript(repo)
        if main is not None:
            sub = main.parent / main.stem / "subagents" / "agent-{}.jsonl".format(agent)
            text, models = subagent_message(sub)
            if text is not None:
                out.append(("subagent transcript agent-{}.jsonl".format(agent),
                            text.encode("utf-8", errors="surrogatepass"),
                            {"models": models, "agent_id": agent, "source": "transcript",
                             "agent_transcript_path": str(sub)}))
    elif raw_dir.is_dir():
        for path in sorted(raw_dir.glob("*.md")):
            try:
                data = path.read_bytes()
            except OSError:
                continue
            obj = extract_pass_json(data.decode("utf-8", errors="replace"))
            if isinstance(obj, dict) and obj.get("pass_id") == pass_id:
                out.append((C.to_posix(os.path.relpath(str(path), str(repo))), data,
                            meta_of(path)))
    return out


def extract_pass_json(text: str) -> Optional[Dict[str, Any]]:
    """The pass's JSON object: the whole text, else the last fenced block holding files_read or
    candidates, else the last decodable object holding files_read."""
    stripped = text.lstrip(chr(0xFEFF)).strip()
    try:
        obj = json.loads(stripped)
        if isinstance(obj, dict):
            return obj
    except ValueError:
        pass
    fences = re.findall(r"```(?:json)?[ \t]*\r?\n(.*?)```", stripped, re.S)
    for block in reversed(fences):
        try:
            obj = json.loads(block)
        except ValueError:
            continue
        if isinstance(obj, dict) and ("files_read" in obj or "candidates" in obj):
            return obj
    decoder = json.JSONDecoder()
    found: Optional[Dict[str, Any]] = None
    positions = [m.start() for m in re.finditer(r"\{", stripped)][:MAX_BRACE_SCAN]
    for pos in positions:
        try:
            obj, _end = decoder.raw_decode(stripped, pos)
        except ValueError:
            continue
        if isinstance(obj, dict) and "files_read" in obj:
            found = obj
    return found


def lens_rule_ids(lens: str) -> List[str]:
    if lens == EXPLORATION:
        return []
    path = Path(_HERE).parent / "references" / "lens-{}.md".format(lens)
    try:
        return sorted(set(RULE_HEADING_RE.findall(C.read_text(path))))
    except OSError:
        return []


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(str(tmp), "wb") as handle:
        handle.write(data)
    os.replace(str(tmp), str(path))


def _usage_of(meta: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    usage = (meta or {}).get("usage")
    if not isinstance(usage, dict) or not usage:
        path = (meta or {}).get("agent_transcript_path")
        if isinstance(path, str) and path:
            try:
                usage = C.transcript_usage(Path(path), max_bytes=64 * 1024 * 1024)["models"]
            except OSError:
                return None
        else:
            return None
    usd, _unpriced = C.usage_usd(usage)
    total = {"input": 0, "cache_write": 0, "cache_read": 0, "output": 0}
    for counts in usage.values():
        total["input"] += int(counts.get("input", 0) or 0)
        total["cache_write"] += sum(int(counts.get(k, 0) or 0) for k in (
            "cache_write_5m", "cache_write_1h", "cache_write_unknown"))
        total["cache_read"] += int(counts.get("cache_read", 0) or 0)
        total["output"] += int(counts.get("output", 0) or 0)
    total["usd"] = round(usd, 6)
    total["models"] = sorted(usage)
    return total


def cmd_ingest(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    warnings: List[str] = []
    pass_id = (args.pass_id or "").strip()
    if not PASS_ID_RE.match(pass_id):
        raise LedgerError("--pass-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,79}")
    lenses = parse_lens_arg(args.lens, allow_exploration=True)
    if args.pass_number < 1:
        raise LedgerError("--pass must be 1 or more")
    unit_id = args.unit.strip() if args.unit else None
    if unit_id and find_unit(ledger, unit_id) is None:
        raise LedgerError("unknown unit {!r}".format(unit_id))
    info: Optional[Dict[str, Any]] = None
    if args.meta_file:
        info = load_pass_meta(repo, args.meta_file)
        if info["pass_id"] != pass_id:
            raise LedgerError("--meta-file belongs to pass {}, not {}".format(
                info["pass_id"], pass_id))
        conflicts = meta_conflicts(args, info)
        if conflicts:
            raise LedgerError("conflicting: the meta file is the source ({})".format(
                ", ".join(conflicts)))
        prompt_sha = info["prompt_sha"] or ""
    elif not args.prompt_file:
        raise LedgerError("give --meta-file (a harden-lens pass) or --prompt-file")
    else:
        try:
            with open(args.prompt_file, "rb") as handle:
                prompt_sha = hashlib.sha256(handle.read()).hexdigest()
        except OSError as exc:
            raise LedgerError("cannot read --prompt-file: {}".format(exc)) from exc
    agent = (args.agent_id or "").strip() or None
    if agent and not AGENT_ID_RE.match(agent):
        raise LedgerError("--agent-id must match [A-Za-z0-9_-]{1,128}")
    sources: List[Tuple[str, bytes, Optional[Dict[str, Any]]]] = []
    if info is not None:
        try:
            data = info["message_path"].read_bytes()
        except OSError as exc:
            raise LedgerError("cannot read the saved report: {}".format(exc)) from exc
        sources = [(C.to_posix(os.path.relpath(str(info["message_path"]), str(repo))), data,
                    {"models": info["models_observed"], "agent_id": info["subagent_id"],
                     "source": info["persist_source"],
                     "agent_transcript_path": info["agent_transcript_path"]})]
    elif args.from_file:
        try:
            sources = [(C.to_posix(args.from_file), Path(args.from_file).read_bytes(), None)]
        except OSError as exc:
            raise LedgerError("cannot read --from: {}".format(exc)) from exc
    else:
        sources = pass_sources(repo, agent, pass_id)
        if not agent and len(sources) > 1:
            raise LedgerError("several captures hold pass_id {}: {}; give --agent-id".format(
                pass_id, ", ".join(s[0] for s in sources)))
    if not sources:
        raise LedgerError("no captured message for pass {} (no subagent transcript found): save "
                          "the Agent result once and pass --from <file>; log \"capture missing: "
                          "{}\" (A01-F30)".format(pass_id, pass_id))
    chosen: Optional[Tuple[str, bytes, Optional[Dict[str, Any]], Dict[str, Any]]] = None
    if info is not None:
        chosen = (sources[0][0], sources[0][1], sources[0][2], dict(info["result"] or {}))
    for label, data, meta in sources if info is None else []:
        obj = extract_pass_json(data.decode("utf-8", errors="replace"))
        if obj is not None and "files_read" in obj:
            chosen = (label, data, meta, obj)
            break
    if chosen is None:
        raise LedgerError("no JSON object with files_read in the pass message ({}): save the "
                          "Agent result once and re-run with --from; re-dispatch only when that "
                          "holds none either, at most once per pass id".format(
                              ", ".join(s[0] for s in sources)))
    label, data, meta, obj = chosen
    text = data.decode("utf-8", errors="replace")
    if ENTITY_RE.search(text):
        warnings.append("the message holds XML entities: it was probably copied from a task "
                        "notification, not captured; quoted code may differ from what the "
                        "subagent returned (A01-F30)")
    passes_dir = repo / PASSES_REL
    dest = passes_dir / "{}.md".format(pass_id)
    existing_rows = [r for r in ledger["passes"] if r.get("bundle") == pass_id]
    if dest.is_file() and dest.read_bytes() != data and not args.replace:
        raise LedgerError("{} already holds another message: --replace to redo".format(
            C.to_posix(os.path.relpath(str(dest), str(repo)))))
    if existing_rows and not args.replace:
        raise LedgerError("pass {} is already ingested ({}); --replace to redo".format(
            pass_id, ", ".join(r["id"] for r in existing_rows)))
    if args.replace:
        ledger["passes"] = [r for r in ledger["passes"] if r.get("bundle") != pass_id]
    if not (dest.is_file() and dest.read_bytes() == data):
        _atomic_write(dest, data)
    models = sorted((meta or {}).get("models") or [])
    model_source = "transcript" if models else None
    requested = (args.model or "").strip() or None
    if models:
        model_id = ",".join(models)
        if requested and requested not in models:
            warnings.append("the capture shows {}; recorded those (DT-18; A01-F36)".format(
                model_id))
    elif requested:
        model_id = requested
        model_source = "agent-result"
        if requested == "unknown":
            warnings.append("model recorded as unknown: `check` reports the row (DT-18)")
    else:
        raise LedgerError("no model in the capture: give --model <resolvedModel of the Agent "
                          "launch result>, or --model unknown")
    effort = (args.effort or "").strip() or "harness-default"
    if info is not None:
        effort = info["effort"]
    classes = sorted({c.strip() for c in (args.classes or "").split(",") if c.strip()}) \
        if args.classes else sorted({rid for lens in lenses for rid in lens_rule_ids(lens)})
    obj_lenses = obj.get("lenses", obj.get("lens"))
    if isinstance(obj_lenses, str):
        obj_lenses = [obj_lenses]
    if obj.get("pass_id") not in (None, pass_id):
        warnings.append("the message's pass_id {!r} differs from --pass-id {}".format(
            obj.get("pass_id"), pass_id))
    if isinstance(obj_lenses, list) and obj_lenses:
        try:
            named = [x for x in parse_lens_arg(",".join(str(v) for v in obj_lenses), True)]
        except LedgerError:
            named = []
        if named and set(named) != set(lenses):
            warnings.append("the message names lenses {}, the arguments {}".format(
                ",".join(named), ",".join(lenses)))
    # files_read (GD-05) with DT-26 copies mapped back for candidates only.
    index = FileIndex(ledger)
    if info is not None:
        # The Read results of the pass's own transcript, never a list it wrote (A01-F43).
        reads_path = info["reads_path"]
        entries, dropped = collect_entries(None, str(reads_path)) if reads_path is not None \
            and reads_path.is_file() else ([], [])
    else:
        entries, dropped = entries_from_json({"files_read": obj.get("files_read")
                                              if isinstance(obj.get("files_read"), list)
                                              else []}, "pass message")
    reads, outside, read_warnings, more_dropped = resolve_reads(repo, index, entries)
    dropped += more_dropped
    warnings += read_warnings
    files_json = {"files_read": reads, "files_dropped": cap_dropped(dropped)}
    _atomic_write(passes_dir / "{}.files.json".format(pass_id),
                  (json.dumps(files_json, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))
    raw_cands = obj.get("candidates")
    if not isinstance(raw_cands, list):
        if raw_cands is not None:
            warnings.append("candidates is not a list: counted as none")
        raw_cands = []
    counts: Dict[str, int] = {}
    copy_root = C.to_posix(args.copy_root).rstrip("/") if args.copy_root else None
    stored: List[Dict[str, Any]] = []
    for cand in raw_cands:
        if not isinstance(cand, dict):
            continue
        lens = cand.get("lens")
        try:
            lens = normalize_lens(str(lens)) if lens else None
        except LedgerError:
            lens = None
        if lens is None or lens == TOOL_LENS:
            warnings.append("a candidate without a known lens counts under {}".format(
                lenses[0]))
            lens = lenses[0] if lenses[0] != EXPLORATION else None
        if lens is not None:
            counts[lens] = counts.get(lens, 0) + 1
        item = dict(cand, _pass=pass_id)
        if copy_root and isinstance(item.get("file"), str):
            path = C.to_posix(item["file"])
            if path.startswith(copy_root + "/"):
                item["file"] = path[len(copy_root) + 1:]
        stored.append(item)
    base: Dict[str, Any] = {
        "id": "", "pass": args.pass_number, "unit": unit_id,
        "subagent_id": agent or (meta or {}).get("agent_id"),
        "model_id": model_id, "model_source": model_source, "effort": effort,
        "prompt_sha256": prompt_sha, "classes": [] if lenses == [EXPLORATION] else classes,
        "tool_versions": {}, "started": None, "recorded": C.utc_iso(),
        "tokens_in": None, "tokens_out": None, "compacted": bool(args.compacted),
        "files_read": reads, "files_outside": outside, "files_dropped": cap_dropped(dropped),
        "usage": _usage_of(meta), "source": label,
    }
    if info is not None:
        base.update(meta_row_fields(info))
        base.update({"started": info["started"], "tokens_in": info["tokens_in"],
                     "tokens_out": info["tokens_out"],
                     "compacted": bool(args.compacted) or info["compacted"]})
        if not reads:
            base["compacted"] = True
            base["partial_reason"] = base["partial_reason"] or "no in-scope reads"
    if args.supplementary:
        base["supplementary"] = True
    rows = bundle_rows(lenses, counts, base, pass_id)
    for row in rows:
        row["id"] = next_row_id(ledger["passes"])
        ledger["passes"].append(row)
    refresh_units(ledger)
    save_ledger(repo, ledger)
    raw_path = repo / RAW_CANDIDATES_REL
    try:
        existing = C.read_json(raw_path) if raw_path.is_file() else {}
    except (OSError, ValueError):
        existing = {}
    if not isinstance(existing, dict):
        existing = {}
    existing[pass_id] = stored
    _atomic_write(raw_path, (json.dumps(dict(sorted(existing.items())), indent=2,
                                        ensure_ascii=False) + "\n").encode("utf-8"))
    gap_files = gap_lines = 0
    gaps_path: Optional[Path] = None
    if lenses != [EXPLORATION] and not args.supplementary:
        manifest, _req, gap_lines, _triv = gaps_manifest(ledger, lenses, unit_id, [], [])
        gaps_path = write_manifest(repo, "{}/{}.gaps.json".format(PASSES_REL, pass_id),
                                   manifest)
        gap_files = len(manifest)
    at_init = set(ledger.get("status_at_init") or [])
    changed = [line for line in status_outside_harden(repo) if line not in at_init]
    whole = sum(1 for r in reads if r["ranges"] is None)
    summary = {"pass_id": pass_id, "lenses": lenses, "pass": args.pass_number,
               "unit": unit_id, "rows": [r["id"] for r in rows],
               "candidates": sum(counts.values()), "files_whole": whole,
               "files_partial": len(reads) - whole, "files_dropped": len(dropped),
               "model": model_id, "gap_files": gap_files, "gap_lines": gap_lines,
               "gaps_file": C.to_posix(os.path.relpath(str(gaps_path), str(repo)))
               if gaps_path else None, "tree_changes": changed, "warnings": warnings,
               "source": label}
    if args.json:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    else:
        print("ingested {}: lens {} pass {}{}; {} candidates; {} files whole, {} partial, {} "
              "dropped; model {}; gaps: {} files, {} lines{}".format(
                  pass_id, ",".join(lenses), args.pass_number,
                  " unit " + unit_id if unit_id else "", sum(counts.values()), whole,
                  len(reads) - whole, len(dropped), model_id, gap_files, gap_lines,
                  " -> " + summary["gaps_file"] if gaps_path else ""))
        for warning in warnings[:10]:
            print("WARNING: " + warning)
        if dropped:
            print("WARNING: " + dropped_warning(dropped, rows[0]["id"]))
        if changed:
            print("WORKING TREE CHANGED outside .harden/ since ledger.py init: {}; revert them "
                  "before the next launch (PC-20)".format("; ".join(changed[:20])))
    if changed:
        return 3
    return 1 if gap_files else 0


def _split_models(value: Any) -> List[str]:
    return [m.strip() for m in str(value or "").split(",") if m.strip() and m.strip() not in (
        "unknown", "inherited", "<synthetic>")]


def orchestrator_models(repo: Path) -> Dict[str, int]:
    """Model id -> assistant turns of the main session transcript (streamed; only lines that
    hold an assistant entry are parsed)."""
    main = session_transcript(repo)
    if main is None or not main.is_file():
        return {}
    turns: Dict[str, Set[str]] = {}
    with open(main, "r", encoding="utf-8", errors="replace") as handle:
        for number, line in enumerate(handle):
            if '"type":"assistant"' not in line and '"type": "assistant"' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            message = entry.get("message") if isinstance(entry, dict) else None
            if not isinstance(message, dict):
                continue
            model = message.get("model")
            if isinstance(model, str) and model and model != "<synthetic>":
                turns.setdefault(model, set()).add(str(message.get("id") or number))
    return {m: len(ids) for m, ids in sorted(turns.items())}


def observed_models(repo: Path) -> Dict[str, Any]:
    ledger = load_ledger(repo)
    lens: Dict[str, Dict[str, Any]] = {}
    seen_pass: Set[Tuple[str, str]] = set()
    for row in ledger["passes"]:
        key = str(row.get("subagent_id") or row.get("bundle") or row.get("id"))
        for model in _split_models(row.get("model_id")):
            slot = lens.setdefault(model, {"passes": 0, "effort": set()})
            if (model, key) not in seen_pass:
                seen_pass.add((model, key))
                slot["passes"] += 1
            if row.get("effort"):
                slot["effort"].add(str(row["effort"]))
    verifiers: Dict[str, Dict[str, Any]] = {}
    fallback: Dict[str, int] = {}
    unobserved: List[str] = []
    for kind_dir in (PASSES_REL, VERIFIERS_REL):
        for path in sorted((repo / kind_dir).glob("*.meta.json")):
            name = path.name[:-len(".meta.json")]
            if name.startswith("probe-"):
                continue
            try:
                meta = C.read_json(path)
            except (OSError, ValueError):
                continue
            if not isinstance(meta, dict):
                continue
            agent_type = meta.get("agent_type")
            if agent_type not in ("harden-lens", "harden-verifier"):
                label = str(agent_type or "unknown")
                fallback[label] = fallback.get(label, 0) + 1
            observed = meta.get("observed")
            if not isinstance(observed, dict) or not observed.get("model"):
                unobserved.append(name)
                continue
            if kind_dir != VERIFIERS_REL:
                continue
            for model in sorted((observed.get("models") or {observed["model"]: 1})):
                slot = verifiers.setdefault(model, {"verifiers": 0, "effort": set()})
                slot["verifiers"] += 1
                slot["effort"].update(str(e) for e in observed.get("effort") or [])
    return {"generated": C.utc_iso(), "orchestrator": orchestrator_models(repo),
            "lens": {m: {"passes": v["passes"], "effort": sorted(v["effort"])}
                     for m, v in sorted(lens.items())},
            "verifiers": {m: {"verifiers": v["verifiers"], "effort": sorted(v["effort"])}
                          for m, v in sorted(verifiers.items())},
            "fallback": fallback, "unobserved": unobserved}


def _mentions(text: str, model: str) -> bool:
    """The model id as a whole token (a `[1m]` suffix and sentence punctuation allowed, a
    longer id such as claude-sonnet-5-1 not)."""
    return re.search(r"(?<![A-Za-z0-9._-])" + re.escape(model) +
                     r"(?:\[1m\])?(?![A-Za-z0-9_-])(?!\.[A-Za-z0-9])", text, re.I) is not None


def check_report(report: str, data: Dict[str, Any]) -> List[str]:
    """Per-role check of the report's model line and independence paragraph."""
    roles = {"orchestrator": set(data["orchestrator"]), "lens passes": set(data["lens"]),
             "verifiers": set(data["verifiers"])}
    line = next((ln for ln in report.split("\n") if ln.strip().startswith(MODELS_LINE)), None)
    if line is None:
        return ["the report has no `{}` line (assets/report-template.md, Scope)".format(
            MODELS_LINE[2:])]
    segments = [s.strip() for s in line.split(" \u00b7 ")]
    problems: List[str] = []
    for role, ids in roles.items():
        segment = next((s for s in segments if (s.startswith(role) if role != "orchestrator"
                                                else "orchestrator " in s)), None)
        if segment is None:
            if ids:
                problems.append("the models line has no `{}` segment".format(role))
            continue
        if role == "orchestrator":
            segment = segment[segment.index("orchestrator "):]
        for model in sorted(ids):
            if not _mentions(segment, model):
                problems.append("{}: {} is missing from the models line".format(role, model))
        others = set().union(*(v for k, v in roles.items() if k != role)) - ids
        for model in sorted(others):
            if _mentions(segment, model):
                problems.append("{}: the models line names {}, which only another role "
                                "used".format(role, model))
    para = ""
    for block in re.split(r"\n\s*\n", report):
        if "Limits of independence:" in block:
            para = block[block.index("Limits of independence:"):]
            break
    for role in ("lens passes", "verifiers"):
        for model in sorted(roles[role]):
            if not _mentions(para, model):
                problems.append("{}: {} is missing from the `Limits of independence:` "
                                "paragraph".format(role, model))
    return problems


def cmd_models(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    data = observed_models(repo)
    out = Path(args.out) if args.out else repo / MODELS_REL
    if not out.is_absolute():
        out = repo / out
    problems: List[str] = []
    if args.check_report:
        path = Path(args.check_report) if os.path.isabs(args.check_report) else \
            repo / args.check_report
        try:
            report = path.read_bytes().decode("utf-8", errors="replace").replace("\r\n", "\n")
        except OSError as exc:
            raise LedgerError("cannot read --check-report: {}".format(exc)) from exc
        problems = check_report(report, data)
        data["report_check"] = {"report": C.to_posix(args.check_report), "problems": problems}
    C.write_json(out, data)

    def fmt(role: Dict[str, Any], key: str) -> str:
        return ", ".join("{} x{}{}".format(m, v[key], " ({})".format(",".join(v["effort"]))
                                           if v["effort"] else "")
                         for m, v in role.items()) or "none"
    print("models: orchestrator {}; lens {}; verifiers {}{}{}".format(
        ", ".join(data["orchestrator"]) or "unknown", fmt(data["lens"], "passes"),
        fmt(data["verifiers"], "verifiers"),
        "; fallback " + ", ".join("{} x{}".format(k, v) for k, v in data["fallback"].items())
        if data["fallback"] else "",
        "; unobserved " + ", ".join(data["unobserved"][:LIST_LIMIT])
        if data["unobserved"] else ""))
    for problem in problems:
        print("REPORT: " + problem)
    return 1 if problems else 0


def cmd_status_baseline(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    ledger["status_at_init"] = status_outside_harden(repo)
    save_ledger(repo, ledger)
    print("status baseline: {} line(s) outside .harden/ recorded".format(
        len(ledger["status_at_init"])))
    return 0


def cmd_capture(args: argparse.Namespace) -> int:
    """Copy a subagent's final message byte for byte to a file under .harden/passes/, so the
    orchestrator never re-types it (A01-F30)."""
    repo = repo_root(args.repo)
    agent = (args.agent_id or "").strip()
    if not AGENT_ID_RE.match(agent):
        raise LedgerError("--agent-id must be the agent id the launch returned (letters, digits, "
                          "_ and -, at most 128 characters)")
    out = Path(args.out)
    if not out.is_absolute():
        out = repo / out
    try:
        rel = C.to_posix(os.path.relpath(os.path.realpath(str(out)),
                                         os.path.realpath(str(repo))))
    except ValueError:
        rel = C.to_posix(str(out))
    if (not rel.startswith(PASSES_REL + "/") or rel.startswith(RAW_PASSES_REL + "/")
            or "/../" in "/" + rel + "/" or not rel.endswith(".md")):
        raise LedgerError("--out must be a .md file under {}/ outside {}/: {}".format(
            PASSES_REL, RAW_PASSES_REL, rel))
    sources = pass_sources(repo, agent, "")
    if not sources:
        raise LedgerError("capture missing: no capture of agent {} under {}/ and no subagent "
                          "transcript agent-{}.jsonl next to the session transcript "
                          "(.harden/session.json)".format(agent, RAW_PASSES_REL, agent))
    label, data, meta = sources[0]
    if out.is_file() and out.read_bytes() != data and not args.replace:
        raise LedgerError("{} exists with other content: add --replace".format(rel))
    _atomic_write(out, data)
    models = [m for m in (meta or {}).get("models") or [] if isinstance(m, str)]
    print("captured {} bytes (sha256 {}) from {} to {}; model(s): {}".format(
        len(data), hashlib.sha256(data).hexdigest()[:12], label, rel,
        ", ".join(models) or "unknown"))
    return 0


def cmd_stop_budget(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    ledger = load_ledger(repo)
    plan_path = Path(args.plan) if args.plan else repo / ".harden" / "budget.json"
    if not plan_path.is_absolute():
        plan_path = repo / plan_path
    plan = optional_dict(plan_path)
    items = ((plan or {}).get("detect_plan") or {}).get("items")
    if not isinstance(items, list):
        raise LedgerError("no detect_plan.items in {}: run budget.py plan first".format(
            C.to_posix(str(plan_path))))
    outcomes = load_outcomes(repo)
    warnings: List[str] = []
    missing: Dict[Tuple[str, str], List[int]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        uid = str(item.get("unit"))
        number = int(item.get("pass") or 0)
        for lens in item.get("lenses") or []:
            if lens == EXPLORATION:
                continue
            if find_unit(ledger, uid) is None:
                warnings.append("planned unit {} is not in the ledger".format(uid))
                continue
            done = any(r.get("unit") == uid and r.get("lens") == lens and
                       int(r.get("pass") or 0) == number for r in ledger["passes"])
            if not done:
                missing.setdefault((uid, lens), []).append(number)
    now = C.utc_iso()
    for (uid, lens), numbers in sorted(missing.items()):
        unit = find_unit(ledger, uid)
        if unit is None:
            continue
        stops = unit.setdefault("stops", {})
        current = stops.get(lens)
        if isinstance(current, dict) and current.get("reason") != "skipped-budget":
            continue
        snapshot = lens_stats(repo, ledger, lens, outcomes, unit)
        stops[lens] = {"reason": "skipped-budget", "at": now,
                       "missing_passes": sorted(set(numbers)),
                       "passes": snapshot["passes"], "S_obs": snapshot["S_obs"],
                       "Q1": snapshot["Q1"], "Q2": snapshot["Q2"], "chao2": snapshot["chao2"],
                       "unseen_estimate": snapshot["unseen_estimate"],
                       "new_verified_in_latest_pass": snapshot["new_verified_in_latest_pass"]}
    save_ledger(repo, ledger)
    count = sum(len(set(v)) for v in missing.values())
    result = {"pairs": len(missing), "planned_passes_not_run": count,
              "warnings": sorted(set(warnings))}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("skipped-budget recorded for {} unit/lens pair(s), {} planned pass(es) not run; the "
              "report lists them as not examined (DT-25; A01-F34)".format(len(missing), count))
        for warning in sorted(set(warnings)):
            print("WARNING: " + warning)
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


RECORD_FILES_HELP = """Record one lens pass: what it read, with which model configuration.

File entries (--files, --files-from) are repository-relative paths, or absolute paths inside
the repository:
  src/app.py            the whole file was read
  src/app.py:40-120     lines 40 to 120 were read (a partial read)
  src/app.py:57         line 57 only
  src/app.py:40-        lines 40 to the end (also src/app.py:40-eof)
--files-from FILE holds one entry per line (blank lines and # comments skipped), or JSON:
  ["src/a.py", "src/b.py:1-80"]
  [{"path": "src/b.py", "ranges": [[1, 80], [200, 240]]}]
  {"files_read": [...]}             (either list form above)
Range items may be [A, B], [A], A, "A-B" or {"start": A, "end": B}; an end of null, -1 or
"eof" means the last line; "ranges": "all" (or {"whole": true}) is a whole read.
Normalisation never widens a claim (pilot-auto-calibration A01-F31): a start below 1 is
clamped, an end past the file clipped, and an entry without a path, an empty ranges list, an
inverted range or a path outside the repository is dropped with its reason in the row's
files_dropped. A file counts as covered by the lens only when its ranges cover every line
except blank and closing-punctuation lines (DT-02; A01-F32); a pass marked --compacted counts
as partial. --lens a,b,c records one row per lens of a bundle (at most three, DT-21), or
exploration alone, with --candidates-by-lens LENS=K,... ."""

MERGE_MAP_HELP = """Store the deduplicated clusters of one lens (DT-23 merge by union).

--map FILE is JSON in one of these forms (cluster ids are the candidate ids of
.harden/candidates.json):
  [{"id": "H-001", "passes": [1, 2], "raw": 2, "raw_ids": ["p1-3", "p2-1"]}, ...]
  {"clusters": [ ...the same list... ]}
  {"H-001": [1, 2], "H-002": [3]}              (id -> pass numbers)
"passes" (or "seen_in_passes") lists the pass numbers that found the cluster; "raw" (default:
the number of raw_ids, else of passes) counts its raw candidates. A candidate found by a
deterministic source instead of a lens pass is {"id": "H-009", "source": "prescan"} with no
passes: it counts in the reconciliation but not in Chao2."""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ledger.py", description="Coverage ledger of the /harden detection passes.")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--repo", default=".", help="repository directory (default: .)")
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")
    sub.required = True

    p = sub.add_parser("init", parents=[common], help="build the ledger from git ls-files")
    p.add_argument("--scope", nargs="+", metavar="PATH", default=None)
    p.add_argument("--exclude", nargs="+", metavar="GLOB", default=None)
    p.add_argument("--budget-cap", type=int, default=None, metavar="TOKENS")
    p.add_argument("--verification-reserve", type=int, default=None, metavar="TOKENS")
    p.add_argument("--estimate", type=int, default=None, metavar="TOKENS")
    p.add_argument("--force", action="store_true", help="rebuild an existing ledger")
    p.set_defaults(func=cmd_init)

    p = sub.add_parser(
        "record", parents=[common], help="record one lens pass",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=RECORD_FILES_HELP)
    p.add_argument("--lens", required=True)
    p.add_argument("--pass", dest="pass_number", type=int, required=True, metavar="N")
    p.add_argument("--model", default=None, metavar="ID")
    p.add_argument("--effort", default=None, metavar="LEVEL")
    group = p.add_mutually_exclusive_group()
    group.add_argument("--prompt-hash", default=None, metavar="SHA256")
    group.add_argument("--prompt-file", default=None, metavar="FILE")
    p.add_argument("--files", nargs="+", default=None, metavar="F",
                   help="files the pass read: PATH (whole file), PATH:START-END or PATH:LINE")
    p.add_argument("--files-from", default=None, metavar="FILE",
                   help="one entry per line (# comments), or JSON (see the description)")
    p.add_argument("--candidates", type=int, default=None, metavar="K",
                   help="raw candidates the pass returned")
    p.add_argument("--candidates-by-lens", default=None, metavar="LENS=K,...",
                   help="raw candidates per lens (required for a bundle or exploration)")
    p.add_argument("--unit", default=None, metavar="ID")
    p.add_argument("--subagent-id", default=None, metavar="ID")
    p.add_argument("--classes", default=None, metavar="a,b")
    p.add_argument("--tokens-in", type=int, default=None, metavar="N")
    p.add_argument("--tokens-out", type=int, default=None, metavar="N")
    p.add_argument("--tool-version", action="append", default=None, metavar="NAME=VER")
    p.add_argument("--started", default=None, metavar="ISO")
    p.add_argument("--compacted", action="store_true",
                   help="the pass hit compaction or summarisation: its reads count as partial")
    p.add_argument("--replace", default=None, metavar="PASS_ID")
    p.add_argument("--allow-missing-metadata", action="store_true")
    p.add_argument("--meta-file", default=None, metavar="META",
                   help="the pass's .meta.json after persist_pass.py observe: model, effort, "
                        "reads and more from its transcript (A01-F41, A01-F43)")
    p.set_defaults(func=cmd_record)

    p = sub.add_parser(
        "merge", parents=[common], help="store deduplicated clusters of a lens",
        formatter_class=argparse.RawDescriptionHelpFormatter, description=MERGE_MAP_HELP)
    p.add_argument("--lens", required=True)
    p.add_argument("--map", required=True, metavar="FILE",
                   help="JSON cluster map (formats in the description)")
    p.add_argument("--replace", action="store_true",
                   help="replace every stored cluster of the lens instead of updating")
    p.set_defaults(func=cmd_merge)

    p = sub.add_parser("unit", parents=[common], help="define or update a unit")
    p.add_argument("--id", required=True)
    p.add_argument("--kind", choices=UNIT_KINDS, default=None)
    p.add_argument("--files", nargs="+", default=None, metavar="F",
                   help="whole files (PATH, no line range)")
    p.add_argument("--files-from", default=None, metavar="FILE",
                   help="one path per line, or a JSON list of paths")
    p.add_argument("--tier", default=None)
    p.add_argument("--lens", default=None)
    p.add_argument("--stop-reason", choices=STOP_REASONS, default=None)
    p.set_defaults(func=cmd_unit)

    p = sub.add_parser("budget", parents=[common], help="set the token budget (DT-25)")
    p.add_argument("--cap", type=int, default=None, metavar="TOKENS")
    p.add_argument("--reserve", type=int, default=None, metavar="TOKENS")
    p.add_argument("--estimate", type=int, default=None, metavar="TOKENS")
    p.add_argument("--pass-overhead", type=int, default=None, metavar="TOKENS",
                   help="tokens every pass reads before its slice: the lens file, the language "
                        "file(s) and the findings schema")
    p.add_argument("--replan", default=None, metavar="TEXT")
    p.set_defaults(func=cmd_budget)

    p = sub.add_parser("check", parents=[common], help="report what was not covered")
    p.add_argument("--lenses", default=None, metavar="a,b,c")
    p.add_argument("--kinds", default=None, metavar="source,test,doc,other",
                   help="file kinds every lens must cover (default per lens: source,test; "
                        "readability-docs adds doc; ops-config, build-ci, dependencies and "
                        "security add other)")
    p.add_argument("--glob", action="append", default=None, metavar="GLOB")
    p.add_argument("--final", action="store_true",
                   help="also fail on unverified candidates and a short re-check sample")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("gaps", parents=[common],
                       help="lines a lens left unread, as a manifest for a re-dispatched pass")
    p.add_argument("--lens", required=True)
    p.add_argument("--unit", default=None, metavar="ID")
    p.add_argument("--kinds", default=None, metavar="source,test,doc,other")
    p.add_argument("--glob", action="append", default=None, metavar="GLOB")
    p.add_argument("--out", default=None, metavar="FILE",
                   help="write the unread lines as a JSON manifest ([] when none)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_gaps)

    p = sub.add_parser("stats", parents=[common], help="per-lens overlap and Chao2")
    p.add_argument("--lenses", default=None, metavar="a,b,c")
    p.add_argument("--unit", default=None, metavar="ID")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_stats)

    p = sub.add_parser(
        "ingest", parents=[common],
        help="record one returned pass from its subagent transcript (A01-F30)",
        description="Copies the pass's final message byte for byte to .harden/passes/<pass-id>.md "
                    "(from --from, a capture under .harden/passes/raw/, or the subagent's own "
                    "transcript next to the session transcript), records one row per lens, adds "
                    "its candidates to .harden/raw-candidates.json and writes "
                    ".harden/passes/<pass-id>.gaps.json. Exit 0 nothing unread, 1 unread lines "
                    "remain, 3 the working tree changed outside .harden/ since ledger.py init, 2 "
                    "usage or capture error.")
    p.add_argument("--pass-id", required=True)
    p.add_argument("--lens", required=True, metavar="LENS[,LENS[,LENS]]")
    p.add_argument("--pass", dest="pass_number", type=int, required=True, metavar="N")
    p.add_argument("--prompt-file", default=None, metavar="FILE",
                   help="the pass's prompt (required without --meta-file)")
    p.add_argument("--unit", default=None, metavar="ID")
    group = p.add_mutually_exclusive_group()
    group.add_argument("--agent-id", default=None, metavar="ID")
    group.add_argument("--from", dest="from_file", default=None, metavar="FILE")
    group.add_argument("--meta-file", default=None, metavar="META",
                       help="a harden-lens pass saved by its own hook and read by "
                            "persist_pass.py observe (A01-F41 to A01-F43)")
    p.add_argument("--model", default=None, metavar="ID",
                   help="the launch result's resolvedModel when no transcript shows the model")
    p.add_argument("--effort", default=None, metavar="LEVEL")
    p.add_argument("--classes", default=None, metavar="a,b")
    p.add_argument("--compacted", action="store_true")
    p.add_argument("--replace", action="store_true")
    p.add_argument("--supplementary", action="store_true",
                   help="a DT-26 pass on a blanked copy: candidates count, coverage does not")
    p.add_argument("--copy-root", default=None, metavar="DIR",
                   help="the blanked copy's root, mapped back to repository paths for candidates")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_ingest)

    p = sub.add_parser("models", parents=[common],
                       help="the model ids the transcripts show per role (A01-F41)")
    p.add_argument("--out", default=None, metavar="FILE",
                   help="default .harden/tools/models.json")
    p.add_argument("--check-report", default=None, metavar="FILE",
                   help="exit 1 when the report omits or misattributes an observed model")
    p.set_defaults(func=cmd_models)

    p = sub.add_parser("stop-budget", parents=[common],
                       help="record skipped-budget for planned passes not run (DT-25; A01-F34)")
    p.add_argument("--plan", default=None, metavar="FILE",
                   help="the run budget (default .harden/budget.json)")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=cmd_stop_budget)

    p = sub.add_parser(
        "capture", parents=[common],
        help="copy a subagent's final message byte for byte under .harden/passes/ (A01-F30)")
    p.add_argument("--agent-id", required=True, metavar="ID")
    p.add_argument("--out", required=True, metavar=".harden/passes/NAME.md")
    p.add_argument("--replace", action="store_true")
    p.set_defaults(func=cmd_capture)

    p = sub.add_parser(
        "status-baseline", parents=[common],
        help="re-record the git status ingest compares against, after a pass's change was "
             "reverted; never use it to accept a pass's own change")
    p.set_defaults(func=cmd_status_baseline)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except LedgerError as exc:
        C.eprint("ledger.py {}: {}".format(args.command, exc))
        return 2
    except (OSError, C.GitError) as exc:
        C.eprint("ledger.py {}: {}".format(args.command, exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
