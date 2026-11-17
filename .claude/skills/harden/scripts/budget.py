#!/usr/bin/env python3
"""budget.py - the run budget of a /harden run: a deadline, phase windows and measured spend.

Purpose
    pilot-auto-calibration A01-F34 to A01-F36 (and A01-F40 for gate reuse). Every run that
    launches lens passes gets a deadline fixed once: the earlier of the profile's
    budget.deadline_utc and start + budget.max_minutes, or, with neither, start + 60 minutes
    + 20 per 1,000 in-scope LOC within 120 to 600 minutes. Time is reserved from the end: the
    final check, then Apply, then Prioritise to Approve and Verify; detection gets the rest,
    and at least 10%. A spend cap binds only when the profile sets budget.max_usd; otherwise
    spend is measured at list prices from the session and subagent transcripts and reported,
    never enforced. `check` closes a phase's window; it only ever stops a phase earlier. It
    never loosens a gate, never skips the final check and never stops verify_branch.py.

    `plan` also lays out DT-23's minimum passes (3 per trust-boundary or hotspot slice, 5 when
    the pass model is cheaper than the session's, 1 elsewhere; one exploration pass per trust
    unit) as items in the order the orchestrator launches them, one lens per pass ("single")
    or bundles of at most three lenses ("grouped") when single passes do not fit (A01-F33).

    pilot-auto-calibration A01-F50 to A01-F52 (third autonomous pilot): time a phase leaves
    unused flows to the next. `verify-plan` orders the verification tasks by expected fixes
    per minute; `check --phase verify` sizes each cycle's window when its verification
    starts, from the time left after the final check's reserve and Prioritise to Approve,
    split between verification and Apply in proportion to their measured needs, and records
    each task's launch (`--task`); `repro` time-boxes the one offline reproduction a T0 or T1
    finding left at needs_review or inference gets; `check --phase cycle` opens another
    verify/apply cycle for the deferred candidates while that time holds. None shortens the
    final check's reserve or stops verify_branch.py. `repro --cmd` refuses a command with a
    shell operator or inline code, a command run through a shell, task runner or wrapper, a
    worktree whose tracked files changed or that holds a .harden/, a shell script or
    task-runner file, and an attempt file that starts a process or names a forbidden command
    (also across a backslash line continuation), so every
    process the attempt starts passes the forbidden-command check; the scans see the files
    present at registration and at --done, so an edit between those two moments, or a file
    written into an ignored directory, evades them, and the hook stays a first layer
    (invariant 2).

Files
    reads  .harden/active, .harden/tools/ledger.json, .harden/gates/baseline.json,
           .harden/gates/fresh-clone.json, .harden/session.json, .harden/hook_events.log,
           .harden/passes/raw/*.json and the session and subagent transcripts (numbers and
           model ids only, never message text); .harden/candidates.json,
           .harden/findings.json, .harden/config.json, .harden/phases.json,
           .harden/verifiers/<task>.meta.json and .result.json, .harden/tools/verify-plan.json,
           .harden/gates/repro-<id>-<k>.json and the attempt files of <scratch_dir>/repro
    writes .harden/budget.json (run evidence: the hook refuses agent writes; it holds the
           cycles, the launched tasks and the reproduction attempts),
           .harden/tools/budget-spend-cache.json, .harden/tools/verify-plan.json,
           .harden/gates/repro/<id>-<k>.gate.json (hook-protected), and appends to
           .harden/progress.md; `plan` may add the ledger unit sweep-unassigned for in-scope
           files in no other unit

CLI
    python budget.py plan  [--repo DIR] [--lenses a,b,c] [--replan] [--now ISO] [--json]
    python budget.py check --phase detect|verify|apply|final|cycle [--task ID] [--repo DIR]
                           [--now ISO] [--json]
    python budget.py verify-plan [--repo DIR] [--cycle N] [--from FILE] [--replan] [--now ISO]
                                 [--json]
    python budget.py repro --id ID [--cmd CMD [--bash] [--cwd DIR]]
                           [--done reproduced|not-reproduced|refused|cap] [--repo DIR]
                           [--now ISO] [--json]
    python budget.py spend [--repo DIR] [--json]
    python budget.py revert-cap [--repo DIR] [--base SHA]
    (use python3 on macOS/Linux)
    check --phase apply keeps the final check's reserve before the deadline:
        ceil(1.2 x (I + W x G + (2 + ceil(log2(N + 2))) x Gc)) + F minutes
    with N the commits so far, G one warm gate run (baseline), Gc one cold run (the
    fresh-clone replay's record, else 2 x G), I the next item's expected minutes (1.5 x the
    measured Apply minutes per commit, at least 3 x G, or 10 x G before two commits exist),
    W = N + 5 warm runs (5 when gates.py can reuse an item's green run of the same tree,
    A01-F40) and F = 15 minutes for the report and the rest of Phase 8.
    revert-cap prints verify_branch.py's --max-reverts: the larger of 5 and the first-parent
    commit count of base..HEAD divided by 5 and rounded up, at most 10 (user-policy-autonomy
    U01-F13).
    check --phase verify (A01-F50): on a cycle's first verify check, A = the minutes to the
    deadline less F (the Apply check's reserve, with minutes per commit pooled over every
    cycle) and P (Prioritise to Approve: the plan's report minutes, later the last measured
    Phase 4 start to Phase 6 end, at least 3); R = 15% of A, at least one attempt's cap (5
    minutes, plus one cold gate run before the run's first attempt), and none when it would
    leave no verifier task (R <= A - the first task); B = A - R; V = 1.25 x the unlaunched
    plan tasks' minutes (clusters x 1.35, 0.95 a mechanical cluster, or the run's own rates
    once two tasks of a kind returned) / the concurrency; Ap = 0.25 commits per cluster (or
    the run's own ratio over 10 verified clusters) x the clusters x the minutes per commit;
    the window is B - Ap when V + Ap fit in B, else B x V / (V + Ap), never shorter than
    min(V, max(the first task, P)), all of A in report-only mode, and the planned verify
    minutes without a verify plan (resized once when the plan appears). Each task starts only
    after `--task <id>` finds that its estimate ends before the window does; the check records
    the launch. Reproductions (`repro`) may start until the window's end + R.
    check --phase cycle (A01-F50): opens cycle n+1 while deferred unverified candidates
    remain, cycle n verified one, the verify spend cap is not reached, and the time to the
    deadline less F and P holds one verifier task.
    verify-plan (A01-F51): clusters candidates (same file, overlapping lines, both spans at
    most 40 lines or identical ranges), orders the clusters by band (critical, high or
    blocking first), fixability rung (0: structural T0/T1 under a rule of Tier table rows 1,
    3-5, 7, 8 or 17; 1: other T0/T1; 2: T2 or report-only), severity, existing proof, file and
    line, and packs them into tasks of up to 4 clusters and 12 candidates (a file's clusters
    together), or up to 8 clusters and 24 candidates for mechanical ones, the first of which
    moves into the first wave. Ids are v<cycle>-<nn>.

Exit codes
    plan        0 written or unchanged; 2 usage or environment error (no .harden/active, no
                ledger, unknown lens, --lenses missing on the first plan)
    check       0 the phase may continue (cycle: a new cycle is open); 1 the phase's window is
                spent (cycle: no further cycle, go to Phase 8); 2 no budget.json (run plan
                first) or bad arguments (--task outside --phase verify, a task not in the
                plan or launched before). Exit 2 is never a stop.
    verify-plan 0 written or unchanged; 2 usage (no budget.json, a cycle not open, no input)
    repro       0 an attempt may run, or --done was recorded; 1 no attempt (report-only, the
                window or the cap spent, the one attempt taken); 2 usage (bad or unknown id,
                no verification started, a refused command or file, --done reproduced
                without a gates.py record of an unchanged registered command)
    spend       0; 2 no .harden/active
    revert-cap  0; 2 no base

Python 3.9+ standard library only (also runs under `python -S`); no network; runs only git
rev-list --count and, for repro --cmd, git rev-parse and git status in the scratch worktree;
never executes project code (`repro --cmd` only writes a gate config for gates.py).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shlex
import statistics
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import _common as C  # noqa: E402
import ledger as LG  # noqa: E402

MIN_MINUTES = 120
MAX_MINUTES = 600
BASE_MINUTES = 60
MINUTES_PER_KLOC = 20
SHARE_FINAL = 0.17
SHARE_APPLY = 0.35
SHARE_REPORT = 0.07
SHARE_VERIFY = 0.12
DETECT_FLOOR = 0.10
USD_CAP_DETECT = 0.35
USD_CAP_VERIFY = 0.50
USD_CAP_REPORT = 0.55
USD_CAP_APPLY = 0.90
FINAL_GATE_RUNS = 6
FINAL_FIXED_MINUTES = 10
FINAL_MARGIN = 1.25
EXPECTED_COMMITS = 20
GATE_MINUTES_UNKNOWN = 10.0
PASS_USD = 0.90
GAP_PASS_USD = 0.60
# The two priors above were measured with lens passes on Claude Haiku 4.5: of USD 0.90 a pass,
# USD 0.41 was the pass's own subagent and the rest the orchestrator's share; of USD 0.60 a gap
# pass, USD 0.28 (pilot-auto-calibration A01-F33). The subagent part is re-priced for the lens
# model the run uses (A01-F41: harden-lens pins opus), by the ratio of the summed per-token
# rates (input, 5-minute cache write, cache read, output) to Haiku's.
PASS_SUBAGENT_USD_HAIKU = 0.41
GAP_SUBAGENT_USD_HAIKU = 0.28
PRIOR_LENS_MODEL = "claude-haiku-4-5"
DEFAULT_LENS_MODEL = "opus"
PASS_MINUTES = 1.1
GAP_FACTOR = 1.15
ITEM_USD_PRIOR = 1.50
SUBAGENT_USD_PRIOR = 0.45
DEFAULT_CONCURRENCY = 4
UNIT_TOKENS_REFERENCE = 20000
UNIT_TOKENS_SPLIT = 30000
RESERVE_MARGIN = 1.2
RESERVE_FIXED_MINUTES = 15
CACHE_MAX_AGE_S = 300
REVERT_CAP_MIN = 5
REVERT_CAP_MAX = 10
SWEEP_UNIT = "sweep-unassigned"
VERIFY_PLAN_REL = ".harden/tools/verify-plan.json"
VERIFY_MARGIN = 1.25               # pilot 3: Phase 3 wall 16.5 min / (52.1 verifier-min / 4) = 1.26 (A01-F50)
VERIFY_CLUSTER_MINUTES = 1.35      # pilot 3: 52.1 verifier-minutes over 39 clusters (A01-F50)
VERIFY_MECH_CLUSTER_MINUTES = 0.95  # no mechanical task ran; 6.2 requests a cluster (v-state, lowest measured) x 0.153 verifier-min a request (52.1/341) (A01-F51)
VERIFY_TASK_MINUTES = 6.5          # pilot 3: mean of 8 verifier tasks, 4.4 to 8.9 (A01-F50)
COMMITS_PER_CLUSTER = 0.25         # pilots 1-3: 8/40, 19/49, 8/39 (A01-F50)
PRIO_MIN_MINUTES = 3.0
REPRO_SHARE = 0.15
REPRO_CAP_MINUTES = 5.0            # pilot 3: four scripted reproductions took 2.9 min (A01-F52)
REPRO_FILE_MAX_BYTES = 1000000
TASK_CLUSTERS = 4                  # pilot 3: 5 clusters took 62 requests, past maxTurns 60 (A01-F51)
TASK_CANDIDATES = 12
MECH_TASK_CLUSTERS = 8             # 8 x 6.2 requests plus the task's own reads stay under harden-verifier maxTurns 60 (A01-F51)
MECH_TASK_CANDIDATES = 24
MERGE_SPAN_MAX = 40
MEASURED_MIN_TASKS = 2
MEASURED_MIN_CLUSTERS = 10
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
DEVICE_RE = re.compile(r"(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)")
# Tier table rows whose proof is a re-run check and whose class is structural (prioritization.md
# rows 1, 3-5, 7, 8 and 17); tests/test_budget.py checks this set against the table. Row 6
# (RD-25, RD-31, RD-33) is left out: its proof replays documented commands.
MECHANICAL_RULES = frozenset({
    "DC-03", "TS-06", "PY-15", "RS-12", "CP-15",
    "DC-21", "RD-18", "AI-24", "RD-13",
    "RD-23", "RD-24", "RD-28", "RD-29", "RD-35",
    "DC-02", "DC-12", "DC-13", "DC-18",
    "TY-03", "TY-04", "AI-11", "DC-28"})
SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "nit": 4}
PROOF_RUNGS = frozenset({"failing_test", "reproduction", "tool_high_precision"})
REPRO_OUTCOMES = ("reproduced", "not-reproduced", "refused", "cap")
# Inline code a reproduction command may not run: write it into the attempt's file instead.
INLINE_FLAGS = frozenset({"-e", "--eval", "-c", "/c", "/k", "--print", "-command",
                          "-encodedcommand"})
# A reproduction file that starts a process could run a forbidden command the hook never sees.
PROCESS_RE = re.compile(r"child_process|\b(execSync|execFileSync|spawnSync|execa|shelljs)\b|"
                        r"\bspawn\s*\(|\bsubprocess\b|\bos\.(system|popen|exec\w*|spawn\w*)\b|"
                        r"\bPopen\b|\bpty\.spawn\b|Deno\.(run|Command)|Bun\.spawn|"
                        r"\bProcessBuilder\b|\bRuntime\.getRuntime\b|"
                        r"create_subprocess_(exec|shell)|\bspawn_sync\b|\bprocess_wrap\b|"
                        r"\bexec\.Command(Context)?\b|\bCommand::new\b|\bstd::process\b|"
                        r"\bvm\.(try)?ffi\b|\b(shell_exec|proc_open|passthru)\b|"
                        r"(?<![\w.])system\s*\(", re.I)
# A program that runs each line of a file as a command (a shell, a task runner) or another
# command line (a wrapper): every line would start a process the forbidden-command check
# never sees, so a reproduction never runs through one (detection step 12: the file starts no
# process).
SHELL_PROGRAMS = frozenset({"sh", "bash", "zsh", "dash", "ksh", "mksh", "fish", "csh", "tcsh",
                            "busybox", "pwsh", "powershell", "cmd", "wsl", "source", ".",
                            "make", "gmake", "nmake", "just", "task", "env", "xargs", "nohup",
                            "timeout", "nice", "time", "sudo", "exec", "eval", "start",
                            "call"})
SHELLS = frozenset({"sh", "bash", "zsh", "dash", "ksh", "mksh", "fish", "csh", "tcsh",
                    "busybox", "pwsh", "powershell", "cmd", "wsl"})
SHELL_SCRIPT_EXTS = (".sh", ".bash", ".zsh", ".ksh", ".fish", ".ps1", ".psm1", ".bat", ".cmd",
                     ".mk", ".mak")
SHELL_SCRIPT_NAMES = frozenset({"makefile", "gnumakefile", "justfile", "taskfile.yml",
                                "taskfile.yaml"})
SHEBANG_SHELL_RE = re.compile(r"^#!.*\b(sh|bash|zsh|dash|ksh|fish|pwsh|make)\b")
BUNDLES = (("security", "web3", "ops-config"), ("errors-resilience", "concurrency"),
           ("numeric-money-time", "performance", "data"),
           ("dead-code", "duplication", "architecture"),
           ("complexity-design", "readability-docs", "ai-failure-modes"),
           ("tests", "types-suppressions", "dependencies"), ("frontend", "build-ci"))
TRUST_SINGLE = ("security", "web3")
BUDGET_REL = ".harden/budget.json"
CACHE_REL = ".harden/tools/budget-spend-cache.json"
PHASES = ("detect", "verify", "apply", "final", "cycle")
ACTIONS = {
    "detect": "launch no more passes; ingest the running ones, run ledger.py stop-budget, then "
              "start Phase 3",
    "verify": "launch no more verifiers; set the candidates not yet verified to deferred with "
              "the note \"not verified: run budget reached\", then start Phase 4",
    "apply": "start no new item; go to Phase 8 with the commits made so far and list the rest "
             "as deferred",
    "cycle": "go to Phase 8 with the commits made so far; the candidates still deferred stay "
             "under Limits (k)",
}


class BudgetError(RuntimeError):
    """Usage or environment problem (exit 2)."""


# ---------------------------------------------------------------------------
# Time and inputs
# ---------------------------------------------------------------------------


def parse_iso(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def hhmm(dt: Optional[datetime]) -> str:
    return dt.astimezone(timezone.utc).strftime("%H:%MZ") if dt else "-"


def minutes_between(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 60.0


def now_of(args: argparse.Namespace) -> datetime:
    if getattr(args, "now", None):
        dt = parse_iso(args.now)
        if dt is None:
            raise BudgetError("--now must be an ISO time such as 2026-09-25T10:00:00Z")
        return dt
    return datetime.now(timezone.utc)


def read_json(path: Path) -> Optional[Any]:
    try:
        return C.read_json(path)
    except (OSError, ValueError):
        return None


class Run:
    """The run marker and the paths budget.py reads."""

    def __init__(self, repo: Path) -> None:
        self.repo = repo
        self.hdir = C.harden_dir(repo)
        marker = read_json(self.hdir / "active")
        if not isinstance(marker, dict):
            raise BudgetError("no .harden/active: run run_state.py start first")
        self.marker = marker
        self.started = parse_iso(marker.get("started"))
        if self.started is None:
            raise BudgetError(".harden/active has no started time")
        self.mode = str(marker.get("mode") or "")
        self.base_sha = str(marker.get("base_sha") or "")
        profile = marker.get("profile") if isinstance(marker.get("profile"), dict) else {}
        effective = profile.get("effective") if isinstance(profile.get("effective"),
                                                           dict) else {}
        budget = effective.get("budget") if isinstance(effective.get("budget"), dict) else {}
        self.budget = {k: budget.get(k) for k in ("max_tokens", "deadline_utc", "max_usd",
                                                  "max_minutes")}
        detection = effective.get("detection") if isinstance(effective.get("detection"),
                                                             dict) else {}
        self.detection = {"max_concurrent_subagents": detection.get("max_concurrent_subagents")
                          or DEFAULT_CONCURRENCY,
                          "lens_bundles": detection.get("lens_bundles") or "auto",
                          "pass_model": detection.get("pass_model")}
        self.concurrency_source = "profile" if detection.get("max_concurrent_subagents") \
            else "default"

    @property
    def run_key(self) -> str:
        return "{}|{}".format(self.base_sha, self.marker.get("started"))

    @property
    def advisory(self) -> bool:
        return self.mode in ("interactive", "apply") and not any(
            v is not None for v in self.budget.values())

    @property
    def report_only(self) -> bool:
        return self.mode == "report-only"


# ---------------------------------------------------------------------------
# Spend (list prices; numbers only)
# ---------------------------------------------------------------------------


def _file_usage(path: Path, since: Optional[datetime], skip_sidechain: bool,
                cache: Dict[str, Any], allow_stale: bool, fresh: Dict[str, Any]
                ) -> Dict[str, Any]:
    """A transcript's usage, from the spend cache when the file is unchanged or, for `check`,
    when the cache is less than five minutes old and the file only grew (A01-F34)."""
    stat = os.stat(str(path))
    key = "{}|{}|{}".format(C.to_posix(str(path)), iso(since), skip_sidechain)
    files = cache.get("files") if isinstance(cache.get("files"), dict) else {}
    entry = files.get(key)
    if isinstance(entry, dict) and isinstance(entry.get("usage"), dict):
        same = entry.get("size") == stat.st_size and entry.get("mtime") == stat.st_mtime
        recent = allow_stale and time.time() - float(cache.get("computed") or 0) < \
            CACHE_MAX_AGE_S and stat.st_size >= int(entry.get("size") or 0)
        if same or recent:
            fresh[key] = entry
            if not same:
                fresh["__stale__"] = True
            return entry["usage"]
    usage = C.transcript_usage(path, since=since, skip_sidechain=skip_sidechain)
    fresh[key] = {"size": stat.st_size, "mtime": stat.st_mtime, "usage": usage}
    return usage


def compute_spend(run: Run, allow_stale: bool = False) -> Dict[str, Any]:
    """Spend since the run started: the main transcript (sidechain lines skipped) plus every
    subagent transcript modified since then (A01-F34)."""
    repo = run.repo
    notes: List[str] = []
    cache = read_json(repo / CACHE_REL)
    cache = cache if isinstance(cache, dict) else {}
    fresh: Dict[str, Any] = {}
    main = LG.session_transcript(repo)
    by_model: Dict[str, Dict[str, int]] = {}
    known = True
    main_usd = 0.0
    session_models: Dict[str, int] = {}

    def add(models: Dict[str, Dict[str, int]]) -> None:
        for model, counts in models.items():
            slot = by_model.setdefault(model, {})
            for k, v in counts.items():
                slot[k] = slot.get(k, 0) + int(v or 0)

    if main is None:
        known = False
        notes.append("no session transcript recorded (.harden/session.json, hook_events.log)")
    else:
        try:
            usage = _file_usage(main, run.started, True, cache, allow_stale, fresh)
            add(usage["models"])
            main_usd = C.usage_usd(usage["models"])[0]
            session_models = {m: int(c.get("requests", 0)) for m, c in usage["models"].items()}
        except OSError as exc:
            known = False
            notes.append("main transcript unreadable: {}".format(exc.__class__.__name__))
    sub_usd = 0.0
    intervals: List[Tuple[datetime, datetime]] = []
    agents_seen: Set[str] = set()
    pass_models: Dict[str, int] = {}
    subagent_files = [p for p in (C.subagent_transcripts(main) if main else [])
                      if _mtime_after(p, run.started)]
    subagents = 0
    if main is not None and (main.parent / main.stem / "subagents").is_dir():
        for path in subagent_files:
            try:
                usage = _file_usage(path, None, False, cache, allow_stale, fresh)
            except OSError:
                notes.append("subagent transcript unreadable: {}".format(path.name))
                continue
            subagents += 1
            add(usage["models"])
            sub_usd += C.usage_usd(usage["models"])[0]
            agent = path.stem[len("agent-"):] if path.stem.startswith("agent-") else path.stem
            agents_seen.add(agent)
            for model, counts in usage["models"].items():
                pass_models[model] = pass_models.get(model, 0) + int(counts.get("requests", 0))
            a, b = parse_iso(usage.get("first_ts")), parse_iso(usage.get("last_ts"))
            if a and b:
                intervals.append((a, b))
    else:
        for meta_path in sorted((run.hdir / "passes" / "raw").glob("*.json")):
            meta = read_json(meta_path)
            if not isinstance(meta, dict):
                continue
            captured = parse_iso(meta.get("captured"))
            if captured is not None and run.started is not None and captured < run.started:
                continue
            models = meta.get("usage") if isinstance(meta.get("usage"), dict) else None
            if models is None and isinstance(meta.get("agent_transcript_path"), str):
                try:
                    models = C.transcript_usage(Path(meta["agent_transcript_path"]))["models"]
                except OSError:
                    models = None
            if not models:
                continue
            subagents += 1
            add(models)
            sub_usd += C.usage_usd(models)[0]
            if isinstance(meta.get("agent_id"), str):
                agents_seen.add(meta["agent_id"])
            for model in models:
                pass_models[model] = pass_models.get(model, 0) + 1
            a, b = parse_iso(meta.get("first_ts")), parse_iso(meta.get("last_ts"))
            if a and b:
                intervals.append((a, b))
    prior_usd = 0.0
    ledger = read_json(repo / LG.LEDGER_REL)
    rows = ledger.get("passes") if isinstance(ledger, dict) else []
    rows = rows if isinstance(rows, list) else []
    ids = {str(r.get("subagent_id")) for r in rows if isinstance(r, dict)
           and r.get("subagent_id")}
    missing = sorted(i for i in ids if i not in agents_seen)
    if missing:
        prior_usd = SUBAGENT_USD_PRIOR * len(missing)
        notes.append("{} recorded subagent(s) show no usage: USD {:.2f} each added as a prior"
                     .format(len(missing), SUBAGENT_USD_PRIOR))
        if ids and len(missing) > len(ids) / 4.0:
            known = False
    usd, unpriced = C.usage_usd(by_model)
    usd += prior_usd
    _write_cache(repo, fresh, cache)
    return {"usd": round(usd, 4), "known": known, "main_usd": round(main_usd, 4),
            "subagents_usd": round(sub_usd + prior_usd, 4), "subagents": subagents,
            "by_model": {m: round(C.usage_usd({m: c})[0], 4)
                         for m, c in sorted(by_model.items())},
            "unpriced_models": unpriced, "since": iso(run.started),
            "max_concurrent_observed": max_overlap(intervals), "notes": notes,
            "session_model": max(session_models, key=lambda m: (session_models[m], m))
            if session_models else None,
            "pass_model_observed": max(pass_models, key=lambda m: (pass_models[m], m))
            if pass_models else None}


def _mtime_after(path: Path, started: Optional[datetime]) -> bool:
    if started is None:
        return True
    try:
        return os.stat(str(path)).st_mtime >= started.timestamp() - 1
    except OSError:
        return False


def _write_cache(repo: Path, fresh: Dict[str, Any], old: Dict[str, Any]) -> None:
    """Write the spend cache; a cache that served a stale entry keeps its old time, so an entry
    is never reused more than five minutes after it was computed."""
    stale = bool(fresh.pop("__stale__", False))
    computed = float(old.get("computed") or 0) if stale else time.time()
    try:
        C.write_json(repo / CACHE_REL, {"computed": computed, "files": fresh})
    except OSError:
        pass


def max_overlap(intervals: Sequence[Tuple[datetime, datetime]]) -> int:
    events: List[Tuple[datetime, int]] = []
    for a, b in intervals:
        events.append((a, 1))
        events.append((b, -1))
    best = cur = 0
    for _ts, delta in sorted(events, key=lambda e: (e[0], -e[1])):
        cur += delta
        best = max(best, cur)
    return best


def spend_text(spend: Dict[str, Any]) -> str:
    text = ("spend: USD {:.2f} since {} (main USD {:.2f}, {} subagents USD {:.2f}); models: {}; "
            "at most {} subagents ran at once").format(
               spend["usd"], (spend.get("since") or "-")[11:], spend["main_usd"],
               spend["subagents"], spend["subagents_usd"],
               ", ".join("{} USD {:.2f}".format(m, v) for m, v in spend["by_model"].items())
               or "none", spend["max_concurrent_observed"])
    if spend["unpriced_models"]:
        text += "; unpriced: " + ", ".join(spend["unpriced_models"])
    if not spend["known"]:
        text += "; spend unknown: " + "; ".join(spend["notes"][:2])
    return text


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------


def gate_minutes(repo: Path) -> Tuple[float, str]:
    data = read_json(C.harden_dir(repo) / "gates" / "baseline.json")
    summary = data.get("summary") if isinstance(data, dict) else None
    if isinstance(summary, dict) and summary:
        total = 0.0
        for entry in summary.values():
            if isinstance(entry, dict) and isinstance(entry.get("median_duration_s"),
                                                      (int, float)):
                total += float(entry["median_duration_s"])
        if total > 0:
            return total / 60.0, ".harden/gates/baseline.json median durations"
    return GATE_MINUTES_UNKNOWN, "unknown: no baseline record yet ({} min assumed)".format(
        GATE_MINUTES_UNKNOWN)


def cold_minutes(repo: Path, warm: float) -> float:
    data = read_json(C.harden_dir(repo) / "gates" / "fresh-clone.json")
    summary = data.get("summary") if isinstance(data, dict) else None
    if isinstance(summary, dict):
        total = sum(float(e.get("median_duration_s") or 0) for e in summary.values()
                    if isinstance(e, dict))
        if total > 0:
            return total / 60.0
    return 2.0 * warm


def reuse_available() -> bool:
    try:
        import gates  # noqa: E402  (sibling module)
    except Exception:  # noqa: BLE001
        return False
    return hasattr(gates, "find_reusable_record")


def ensure_units(repo: Path, notes: List[str]) -> List[Dict[str, Any]]:
    """The ledger's non-file units; in-scope files in none of them get the sweep unit
    sweep-unassigned, created through ledger.py's own functions."""
    ledger = LG.load_ledger(repo)
    custom = [u for u in ledger["units"] if u.get("kind") != "file" and u.get("id") != SWEEP_UNIT]
    assigned = {f["path"] for u in custom for f in u.get("files") or []}
    unassigned = [f["path"] for f in ledger["files"] if f["path"] not in assigned]
    existing = LG.find_unit(ledger, SWEEP_UNIT)
    if unassigned:
        files = LG.unit_files_from_entries(repo, ledger, [(p, None) for p in unassigned])
        if existing is None:
            existing = {"id": SWEEP_UNIT, "kind": "sweep", "files": [], "loc": 0,
                        "est_tokens": 0, "tier": None, "classes": [], "passes": [],
                        "status": "unexamined", "lens_status": {}, "finding_ids": [],
                        "stops": {}}
            ledger["units"].append(existing)
            notes.append("budget: created unit {} ({} files)".format(SWEEP_UNIT, len(files)))
        existing["files"] = files
        existing["loc"] = sum(f["loc"] for f in files)
        existing["est_tokens"] = sum(LG.row_tokens(f) for f in files)
        LG.refresh_units(ledger)
        fixed = [u for u in ledger["units"] if u.get("kind") == "file"]
        others = sorted((u for u in ledger["units"] if u.get("kind") != "file"),
                        key=lambda u: str(u.get("id")))
        ledger["units"] = fixed + others
        LG.save_ledger(repo, ledger)
    elif existing is not None:
        ledger["units"] = [u for u in ledger["units"] if u.get("id") != SWEEP_UNIT]
        LG.save_ledger(repo, ledger)
        existing = None
    units = [u for u in ledger["units"] if u.get("kind") != "file"]
    for unit in units:
        if int(unit.get("est_tokens") or 0) > UNIT_TOKENS_SPLIT:
            notes.append("unit {} holds about {} tokens: split it (DT-19)".format(
                unit.get("id"), unit.get("est_tokens")))
    return units


def is_trust(unit: Dict[str, Any]) -> bool:
    return unit.get("kind") == "slice" and str(unit.get("tier") or "").lower().startswith(
        ("trust", "hotspot"))


def groups_for(lenses: Sequence[str], mode: str, trust: bool) -> List[List[str]]:
    if mode == "single":
        return [[lens] for lens in lenses]
    out: List[List[str]] = []
    placed: Set[str] = set()
    for row in BUNDLES:
        group = [lens for lens in row if lens in lenses]
        if trust:
            for lens in [g for g in group if g in TRUST_SINGLE]:
                out.append([lens])
                placed.add(lens)
            group = [g for g in group if g not in TRUST_SINGLE]
        if group:
            out.append(group)
            placed.update(group)
    for lens in lenses:
        if lens not in placed:
            out.append([lens])
    return out


def rate_sum(model: str) -> float:
    rates, _known = C.price_for(model)
    return rates[0] + rates[1] + rates[3] + rates[4]


def lens_model_for(repo: Path, run: Any, spend: Dict[str, Any]) -> Tuple[str, str]:
    """(lens model id, where it came from): the profile's detection.pass_model, else the model
    the Phase 0 agent probe observed (.harden/agents.json), else the one the transcripts show,
    else the harden-lens template's pinned model."""
    value = run.detection.get("pass_model")
    if isinstance(value, str) and value:
        return C.MODEL_ALIASES.get(value.lower(), value), "profile detection.pass_model"
    try:
        agents = C.read_json(repo / ".harden" / "agents.json")
    except (OSError, ValueError):
        agents = None
    lens = (agents or {}).get("lens") if isinstance(agents, dict) else None
    if isinstance(lens, dict) and isinstance(lens.get("model"), str) and lens["model"]:
        return lens["model"], ".harden/agents.json (agent probe)"
    if spend.get("pass_model_observed"):
        return str(spend["pass_model_observed"]), "subagent transcripts"
    return C.MODEL_ALIASES[DEFAULT_LENS_MODEL], "harden-lens template (model: opus)"


def pass_cost_priors(model: str) -> Dict[str, float]:
    """USD per pass and per gap pass for a lens model, from the Haiku-measured priors."""
    ratio = rate_sum(model) / rate_sum(PRIOR_LENS_MODEL)
    return {"pass_usd": round(PASS_USD - PASS_SUBAGENT_USD_HAIKU +
                              PASS_SUBAGENT_USD_HAIKU * ratio, 4),
            "gap_pass_usd": round(GAP_PASS_USD - GAP_SUBAGENT_USD_HAIKU +
                                  GAP_SUBAGENT_USD_HAIKU * ratio, 4),
            "ratio_to_haiku": round(ratio, 3)}


def plan_items(units: Sequence[Dict[str, Any]], lenses: Sequence[str], mode: str,
               cheaper: bool, costs: Dict[str, float]) -> List[Dict[str, Any]]:
    """DT-23's minimum passes as launch items (waves A then C), with their cost."""
    order = sorted(enumerate(units), key=lambda iu: (0 if is_trust(iu[1]) else 1, iu[0]))
    ordered = [u for _i, u in order]
    items: List[Dict[str, Any]] = []
    for unit in ordered:
        scale = max(1.0, float(unit.get("est_tokens") or 0) / UNIT_TOKENS_REFERENCE)
        trust = is_trust(unit)
        for group in groups_for(lenses, mode, trust):
            items.append({"wave": "A", "unit": unit["id"], "lenses": group, "pass": 1,
                          "usd": round(costs["a_usd"] * scale, 4),
                          "minutes": round(costs["a_min"] * scale, 3)})
        if trust:
            items.append({"wave": "A", "unit": unit["id"], "lenses": [LG.EXPLORATION],
                          "pass": 1, "usd": round(costs["a_usd"] * scale, 4),
                          "minutes": round(costs["a_min"] * scale, 3)})
    for unit in ordered:
        if not is_trust(unit):
            continue
        scale = max(1.0, float(unit.get("est_tokens") or 0) / UNIT_TOKENS_REFERENCE)
        for number in range(2, (5 if cheaper else 3) + 1):
            for group in groups_for(lenses, mode, True):
                items.append({"wave": "C", "unit": unit["id"], "lenses": group, "pass": number,
                              "usd": round(costs["c_usd"] * scale, 4),
                              "minutes": round(costs["c_min"] * scale, 3)})
    return items


def mark_affordable(items: List[Dict[str, Any]], avail_usd: float, avail_min: float,
                    concurrency: int) -> int:
    used_usd = used_min = 0.0
    count = 0
    for item in items:
        used_usd += item["usd"]
        used_min += item["minutes"] / max(1, concurrency)
        item["affordable"] = used_usd <= avail_usd and used_min <= avail_min
        if item["affordable"]:
            count += 1
    return count


def cmd_plan(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    run = Run(repo)
    path = repo / BUDGET_REL
    existing = read_json(path)
    now = now_of(args)
    if isinstance(existing, dict) and existing.get("run") == run.run_key and not args.replan:
        print(plan_summary(existing))
        return 0
    same_run = isinstance(existing, dict) and existing.get("run") == run.run_key
    ledger = LG.load_ledger(repo)
    if args.lenses:
        lenses = [LG.normalize_lens(p) for p in args.lenses.split(",") if p.strip()]
    elif same_run and existing.get("detect_plan", {}).get("lenses"):
        lenses = list(existing["detect_plan"]["lenses"])
    else:
        raise BudgetError("give --lenses <selected lenses> on the first plan")
    lenses = [lens for lens in dict.fromkeys(lenses) if lens != LG.TOOL_LENS]
    notes: List[str] = []
    loc = int((ledger.get("totals") or {}).get("in_scope_loc") or 0)
    kloc = loc / 1000.0
    started = run.started
    assert started is not None
    if same_run:
        deadline = parse_iso(existing.get("deadline_utc"))
        deadline_source = existing.get("deadline_source")
        max_usd = existing.get("max_usd")
        max_usd_source = existing.get("max_usd_source")
    else:
        candidates: List[Tuple[datetime, str]] = []
        profile_deadline = parse_iso(run.budget.get("deadline_utc"))
        if profile_deadline is not None:
            candidates.append((profile_deadline, "profile deadline_utc"))
        if isinstance(run.budget.get("max_minutes"), int):
            candidates.append((started + timedelta(minutes=run.budget["max_minutes"]),
                               "profile max_minutes"))
        if candidates:
            deadline, deadline_source = min(candidates, key=lambda c: c[0])
            deadline_source = "profile ({})".format(deadline_source)
        else:
            minutes = min(MAX_MINUTES, max(MIN_MINUTES, BASE_MINUTES + MINUTES_PER_KLOC * kloc))
            deadline, deadline_source = started + timedelta(minutes=minutes), "default"
        max_usd = run.budget.get("max_usd")
        max_usd_source = "profile" if isinstance(max_usd, (int, float)) else \
            "none: spend measured, not enforced"
        if not isinstance(max_usd, (int, float)):
            max_usd = None
        else:
            max_usd = round(float(max_usd), 2)
    assert deadline is not None
    total = minutes_between(started, deadline)
    g, g_source = gate_minutes(repo)
    r = 0 if reuse_available() else 1
    if run.report_only:
        final = apply_m = 0.0
        verify = 0.20 * total
        report = 0.10 * total
        detect_end = deadline - timedelta(minutes=verify + report)
        over = False
        feasible = False
    else:
        final = max(SHARE_FINAL * total, (FINAL_GATE_RUNS + r * EXPECTED_COMMITS) * g
                    + FINAL_FIXED_MINUTES)
        apply_m = max(SHARE_APPLY * total, 6 * g + 15)
        report = max(SHARE_REPORT * total, 10)
        verify = SHARE_VERIFY * total
        floor = now + timedelta(minutes=max(DETECT_FLOOR * total, 15))
        detect_end = deadline - timedelta(minutes=final + apply_m + report + verify)
        over = detect_end < floor
        if over:
            for name, low in (("verify", 0.05 * total), ("report", 10.0),
                              ("apply", 4 * g + 10)):
                shortfall = minutes_between(detect_end, floor)
                if shortfall <= 0:
                    break
                if name == "verify":
                    cut = min(shortfall, max(0.0, verify - low))
                    verify -= cut
                elif name == "report":
                    cut = min(shortfall, max(0.0, report - low))
                    report -= cut
                else:
                    cut = min(shortfall, max(0.0, apply_m - low))
                    apply_m -= cut
                detect_end = deadline - timedelta(minutes=final + apply_m + report + verify)
            if detect_end < floor:
                detect_end = floor
        feasible = minutes_between(detect_end, deadline) - verify - report >= \
            (6 * g + 10) + (4 * g + 10)
        if not feasible:
            notes.append("Apply may not fit before the deadline; check --phase apply decides "
                         "at run time")
    verify_end = detect_end + timedelta(minutes=verify)
    report_end = verify_end + timedelta(minutes=report)
    apply_end = None if run.report_only else deadline - timedelta(minutes=final)
    if max_usd is not None:
        shares = (0.60, 0.85, 1.0, 1.0) if run.report_only else (
            USD_CAP_DETECT, USD_CAP_VERIFY, USD_CAP_REPORT, USD_CAP_APPLY)
        caps = {"detect": round(shares[0] * max_usd, 2), "verify": round(shares[1] * max_usd, 2),
                "report": round(shares[2] * max_usd, 2),
                "apply": None if run.report_only else round(shares[3] * max_usd, 2),
                "total": max_usd}
    else:
        caps = {"detect": None, "verify": None, "report": None, "apply": None, "total": None}
    spend = compute_spend(run)
    units = ensure_units(repo, notes)
    pass_model, pass_model_source = lens_model_for(repo, run, spend)
    session_model = spend.get("session_model")
    cheaper = False
    if pass_model and session_model:
        cheaper = C.price_for(pass_model)[0][0] < C.price_for(session_model)[0][0]
    else:
        notes.append("pass model unknown until the first capture: run plan --replan after it")
    priced = pass_cost_priors(pass_model)
    costs = {"a_usd": priced["pass_usd"] + GAP_FACTOR * priced["gap_pass_usd"],
             "a_min": PASS_MINUTES * (1 + GAP_FACTOR), "c_usd": priced["pass_usd"],
             "c_min": PASS_MINUTES}
    priors = {"pass_usd": priced["pass_usd"], "gap_pass_usd": priced["gap_pass_usd"],
              "pass_minutes": PASS_MINUTES, "gap_factor": GAP_FACTOR,
              "lens_model": pass_model, "lens_model_source": pass_model_source,
              "ratio_to_haiku": priced["ratio_to_haiku"],
              "source": "priors (two pilots, A01-F34), re-priced for the lens model (A01-F41)"}
    if same_run and args.replan:
        computed = parse_iso(existing.get("computed"))
        recorded = [r_ for r_ in ledger.get("passes") or [] if isinstance(r_, dict)
                    and computed is not None and (parse_iso(r_.get("recorded")) or computed)
                    > computed]
        passes = len({r_.get("bundle") or r_.get("id") for r_ in recorded})
        spent_then = float((existing.get("spend_at_plan") or {}).get("usd") or 0)
        if passes >= 4 and spend["known"]:
            per = max(0.0, (spend["usd"] - spent_then) / passes)
            minutes_per = max(0.1, minutes_between(computed, now) / passes) if computed else \
                PASS_MINUTES
            costs = {"a_usd": per * (1 + GAP_FACTOR), "a_min": minutes_per * (1 + GAP_FACTOR),
                     "c_usd": per, "c_min": minutes_per}
            priors["source"] = "measured over {} passes since {}".format(
                passes, existing.get("computed"))
    concurrency = int(run.detection["max_concurrent_subagents"])
    avail_usd = float("inf") if caps["detect"] is None or not spend["known"] else \
        caps["detect"] - spend["usd"]
    avail_min = max(0.0, minutes_between(now, detect_end))
    requested = run.detection["lens_bundles"]
    if requested in ("single", "grouped"):
        mode = requested
    else:
        single = plan_items(units, lenses, "single", cheaper, costs)
        mode = "single" if mark_affordable(single, avail_usd, avail_min, concurrency) == \
            len(single) else "grouped"
    items = plan_items(units, lenses, mode, cheaper, costs)
    affordable = mark_affordable(items, avail_usd, avail_min, concurrency)
    data: Dict[str, Any] = {
        "version": 1, "tool": "budget.py", "run": run.run_key, "computed": iso(now),
        "replans": list(existing.get("replans") or []) if same_run else [],
        "mode": run.mode, "advisory": run.advisory, "in_scope_loc": loc,
        "kloc": round(kloc, 3), "gate_minutes": round(g, 3), "gate_minutes_source": g_source,
        "final_gate_runs_per_commit": r, "started": iso(started),
        "deadline_utc": iso(deadline), "deadline_source": deadline_source,
        "total_minutes": round(total, 2), "max_usd": max_usd, "max_usd_source": max_usd_source,
        "windows": {"detect_end": iso(detect_end), "verify_end": iso(verify_end),
                    "report_end": iso(report_end), "apply_end": iso(apply_end),
                    "deadline": iso(deadline),
                    "minutes": {"final": round(final, 2), "apply": round(apply_m, 2),
                                "report": round(report, 2), "verify": round(verify, 2)}},
        "usd_caps": caps, "flags": {"over_constrained": over, "apply_feasible": feasible},
        "detection": {"max_concurrent_subagents": concurrency,
                      "concurrency_source": run.concurrency_source, "lens_bundles": mode,
                      "lens_bundles_requested": requested, "pass_model": pass_model,
                      "pass_model_source": pass_model_source,
                      "session_model": session_model, "pass_model_cheaper": cheaper},
        "detect_plan": {"lenses": lenses, "items": items,
                        "estimate": {"passes": len(items),
                                     "usd": round(sum(i["usd"] for i in items), 2),
                                     "minutes": round(sum(i["minutes"] for i in items), 2)},
                        "affordable": affordable, "priors": priors},
        "spend_at_plan": {"usd": spend["usd"], "known": spend["known"]},
        "stops": dict((existing.get("stops") or {}) if same_run else
                      {"detect": None, "verify": None, "apply": None}),
        "apply_started": existing.get("apply_started") if same_run else None,
        "notes": notes,
    }
    if same_run and args.replan:
        data["replans"].append({"at": iso(now), "lenses": lenses, "mode": mode,
                                "priors": priors["source"]})
    C.write_json(path, data)
    if not same_run:
        append_progress(repo, "- {} budget: deadline {} ({}), cap {} ({}), detection {}, {} of {} "
                              "planned passes affordable, at most {} subagents at once "
                              "(A01-F34); assumed USD {:.2f} a pass and USD {:.2f} a gap pass for "
                              "lens model {} ({}; A01-F41)".format(
                                  iso(now), iso(deadline), deadline_source,
                                  "USD {:.2f}".format(max_usd) if max_usd is not None else
                                  "none", max_usd_source, mode, affordable, len(items),
                                  concurrency, priors["pass_usd"], priors["gap_pass_usd"],
                                  pass_model, pass_model_source))
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print(plan_summary(data))
        print("wrote {}".format(BUDGET_REL))
        for note in notes:
            print("NOTE: " + note)
    return 0


def plan_summary(data: Dict[str, Any]) -> str:
    w = data["windows"]
    caps = data["usd_caps"]
    lines = ["budget: deadline {} ({}), {} minutes; cap {} ({})".format(
        data["deadline_utc"], data["deadline_source"], data["total_minutes"],
        "USD {:.2f}".format(data["max_usd"]) if data.get("max_usd") is not None else "none",
        data["max_usd_source"])]
    lines.append("windows: detect until {} (USD {}), verify until {} (planned; resized when "
                 "verification starts) (USD {}), report until {}, "
                 "apply until {} (USD {}), final check by {}".format(
                     hhmm(parse_iso(w["detect_end"])), caps["detect"],
                     hhmm(parse_iso(w["verify_end"])), caps["verify"],
                     hhmm(parse_iso(w["report_end"])), hhmm(parse_iso(w["apply_end"])),
                     caps["apply"], hhmm(parse_iso(w["deadline"]))))
    det = data["detection"]
    plan = data["detect_plan"]
    lines.append("detection: {} ({} requested), {} of {} planned passes affordable, at most {} "
                 "subagents at once, pass model {} (cheaper: {})".format(
                     det["lens_bundles"], det["lens_bundles_requested"], plan["affordable"],
                     len(plan["items"]), det["max_concurrent_subagents"], det["pass_model"],
                     det["pass_model_cheaper"]))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Check
# ---------------------------------------------------------------------------


def commit_count(repo: Path, base: str) -> int:
    if not base:
        return 0
    out = C.git_ok(repo, ["rev-list", "--count", "--first-parent", "{}..HEAD".format(base)])
    return int(out) if out and out.isdigit() else 0


def apply_reserve(n: int, g: float, gc: float, item: float, reuse: bool) -> float:
    """Minutes the final check needs before the deadline, the next item included (A01-F34)."""
    warm = 5 if reuse else n + 5
    bisect = 2 + math.ceil(math.log2(n + 2))
    return math.ceil(RESERVE_MARGIN * (item + warm * g + bisect * gc)) + RESERVE_FIXED_MINUTES


def next_item_minutes(n: int, n0: int, elapsed: float, g: float) -> float:
    if n - n0 >= 2:
        return max(1.5 * elapsed / (n - n0), 3 * g)
    return 10 * g


def cmd_check(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    run = Run(repo)
    path = repo / BUDGET_REL
    data = read_json(path)
    if not isinstance(data, dict):
        raise BudgetError("no .harden/budget.json: run budget.py plan --lenses <selected lenses> "
                          "first")
    phase = args.phase
    task_id = getattr(args, "task", None)
    if task_id is not None:
        if phase != "verify":
            raise BudgetError("--task is only for --phase verify")
        if not ID_RE.match(task_id):
            raise BudgetError("--task must be a task id of the verify plan")
    now = now_of(args)
    spend = compute_spend(run, allow_stale=True)
    w = data["windows"]
    caps = data.get("usd_caps") or {}
    deadline = parse_iso(w.get("deadline"))
    result: Dict[str, Any] = {"phase": phase, "now": iso(now), "spend": spend["usd"],
                              "spend_known": spend["known"], "open": True, "reason": None}
    warnings: List[str] = []
    cap = int((data.get("detection") or {}).get("max_concurrent_subagents") or
              DEFAULT_CONCURRENCY)
    if spend["max_concurrent_observed"] > cap:
        warnings.append("observed {} subagents running at once; the cap is {} (A01-F35)".format(
            spend["max_concurrent_observed"], cap))
    if phase == "verify":
        return check_verify(repo, run, data, path, now, spend, task_id, warnings, args.json)
    if phase == "cycle":
        return check_cycle(repo, run, data, path, now, spend, warnings, args.json)

    def over(key: str, extra: float = 0.0) -> bool:
        limit = caps.get(key)
        return limit is not None and spend["known"] and spend["usd"] + extra >= float(limit)

    end: Optional[datetime] = None
    left_usd: Optional[float] = None
    if phase == "detect":
        end = parse_iso(w.get("detect_end"))
        if end is not None and now >= end:
            result.update(open=False, reason="time")
        elif over("detect"):
            result.update(open=False, reason="spend")
        rows = (read_json(repo / LG.LEDGER_REL) or {}).get("passes") or []
        remaining = []
        for item in (data.get("detect_plan") or {}).get("items") or []:
            if not item.get("affordable"):
                continue
            done = any(isinstance(r, dict) and r.get("unit") == item["unit"] and
                       r.get("lens") in item["lenses"] and int(r.get("pass") or 0) ==
                       int(item["pass"]) for r in rows)
            if not done:
                remaining.append(item)
        result["remaining_affordable"] = remaining[:20]
        det = data.get("detection") or {}
        observed = spend.get("pass_model_observed")
        if observed and det.get("pass_model") and observed != det.get("pass_model"):
            warnings.append("replan: budget.py plan --replan (the captures show {})".format(
                observed))
        left_usd = None if caps.get("detect") is None else float(caps["detect"]) - spend["usd"]
    elif phase == "apply":
        end = parse_iso(w.get("apply_end")) or deadline
        if run.report_only:
            result.update(open=False, reason="no time for Apply")
        else:
            n = commit_count(repo, run.base_sha)
            cyc = current_cycle(data, now)
            if not isinstance(cyc.get("apply_started"), dict):
                cyc["apply_started"] = {"ts": iso(now), "usd": spend["usd"], "commits": n}
                if not isinstance(data.get("apply_started"), dict):
                    data["apply_started"] = dict(cyc["apply_started"])
                _write_json_retry(path, data)
            commits, minutes, usd = pooled_apply(data, now, n, spend["usd"])
            g = float(data.get("gate_minutes") or GATE_MINUTES_UNKNOWN)
            item = next_item_minutes(commits, 0, minutes, g)
            reserve = apply_reserve(n, g, cold_minutes(repo, g), item,
                                    int(data.get("final_gate_runs_per_commit", 1)) == 0)
            item_usd = ITEM_USD_PRIOR
            if commits >= 2 and spend["known"]:
                item_usd = max(0.0, usd / commits)
            result.update(reserve_minutes=reserve, item_minutes=round(item, 2), commits=n)
            if deadline is not None and now + timedelta(minutes=reserve) > deadline:
                result.update(open=False, reason="no time for Apply")
            elif over("apply", item_usd):
                result.update(open=False, reason="spend")
            end = deadline - timedelta(minutes=reserve) if deadline else None
            left_usd = None if caps.get("apply") is None else float(caps["apply"]) - spend["usd"]
    else:
        end = deadline
        left_usd = None if caps.get("total") is None else float(caps["total"]) - spend["usd"]
    minutes_left = round(minutes_between(now, end), 1) if end else None
    result.update(minutes_left=minutes_left, usd_left=None if left_usd is None else
                  round(left_usd, 2), warnings=warnings)
    if run.advisory:
        verdict = "open" if result["open"] else "would close ({})".format(result["reason"])
        result["open"] = True
        text = "budget (advisory, interactive run without a profile budget): {} {}".format(
            phase, verdict)
        code = 0
    elif result["open"]:
        text = "budget: {} open: {} min and {} left (until {})".format(
            phase, minutes_left, "USD {:.2f}".format(left_usd) if left_usd is not None else
            "spend USD {:.2f} (no cap)".format(spend["usd"]), hhmm(end))
        if phase == "detect" and result.get("remaining_affordable"):
            first = result["remaining_affordable"][0]
            text += "; next: unit {}, lenses {}, pass {}".format(
                first["unit"], ",".join(first["lenses"]), first["pass"])
        code = 0
    else:
        text = "budget: {} window closed at {} ({}): {}".format(
            phase, hhmm(now if result["reason"] != "time" else end), result["reason"],
            ACTIONS.get(phase, ""))
        code = 1
        stops = data.setdefault("stops", {})
        if phase in ("detect", "apply") and not stops.get(phase):
            stops[phase] = {"at": iso(now), "reason": result["reason"], "usd": spend["usd"]}
            _write_json_retry(path, data)
            append_progress(repo, "- {} budget: {} window closed ({}); {} (A01-F34)".format(
                iso(now), phase, result["reason"], ACTIONS.get(phase, "")))
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(text)
        for warning in warnings:
            print("WARNING: " + warning)
    return code


# ---------------------------------------------------------------------------
# Verify/apply cycles, the verification window and reproduction attempts
# (pilot-auto-calibration A01-F50 to A01-F52)
# ---------------------------------------------------------------------------


def _write_json_retry(path: Path, data: Any) -> None:
    """C.write_json, retried when Windows refuses the replace because the hook is reading the
    file (the same pattern as run_state.write_json_retry)."""
    for attempt in range(6):
        try:
            C.write_json(path, data)
            return
        except PermissionError:
            if attempt == 5:
                raise
            time.sleep(0.1 * (attempt + 1))


def current_cycle(data: Dict[str, Any], now: datetime) -> Dict[str, Any]:
    """The open verify/apply cycle of budget.json, created as cycle 1 when none exists (a
    budget.json from before cycles keeps its top-level apply_started in cycle 1)."""
    cycles = data.setdefault("cycles", [])
    if not isinstance(cycles, list):
        cycles = data["cycles"] = []
    if not cycles:
        first: Dict[str, Any] = {"n": 1, "opened": iso(now)}
        if isinstance(data.get("apply_started"), dict):
            first["apply_started"] = dict(data["apply_started"])
        cycles.append(first)
    return cycles[-1]


def pooled_apply(data: Dict[str, Any], now: datetime, n: int, usd_now: float
                 ) -> Tuple[int, float, float]:
    """(commits, minutes, usd) summed over every cycle's Apply interval: from apply_started to
    apply_closed, or to now and `n` commits for the open one."""
    intervals: List[Tuple[Dict[str, Any], Optional[Dict[str, Any]]]] = []
    cycles = data.get("cycles") if isinstance(data.get("cycles"), list) else []
    for cyc in cycles:
        if isinstance(cyc, dict) and isinstance(cyc.get("apply_started"), dict):
            closed = cyc.get("apply_closed")
            intervals.append((cyc["apply_started"], closed if isinstance(closed, dict) else None))
    if not cycles and isinstance(data.get("apply_started"), dict):
        intervals.append((data["apply_started"], None))
    commits, minutes, usd = 0, 0.0, 0.0
    for started, closed in intervals:
        begin = parse_iso(started.get("ts")) or now
        if closed is None:
            end, end_n, end_usd = now, n, usd_now
        else:
            end = parse_iso(closed.get("ts")) or now
            end_n = int(closed.get("commits") or 0)
            end_usd = float(closed.get("usd") or 0)
        commits += max(0, end_n - int(started.get("commits") or 0))
        minutes += max(0.0, minutes_between(begin, end))
        usd += max(0.0, end_usd - float(started.get("usd") or 0))
    return commits, minutes, usd


def final_reserve(repo: Path, run: Run, data: Dict[str, Any], now: datetime,
                  spend: Dict[str, Any]) -> Dict[str, Any]:
    """The final check's reserve with the Apply check's exact formula (A01-F34): no decision
    uses a smaller reserve than the Apply check does."""
    n = commit_count(repo, run.base_sha)
    g = float(data.get("gate_minutes") or GATE_MINUTES_UNKNOWN)
    gc = cold_minutes(repo, g)
    commits, minutes, _usd = pooled_apply(data, now, n, spend["usd"])
    item = next_item_minutes(commits, 0, minutes, g)
    reuse = int(data.get("final_gate_runs_per_commit", 1)) == 0
    reserve = 0.0 if run.report_only else float(apply_reserve(n, g, gc, item, reuse))
    return {"reserve": reserve, "item": item, "g": g, "gc": gc, "n": n}


def prio_minutes(repo: Path, run: Run, data: Dict[str, Any], cycle_n: int
                 ) -> Tuple[float, str]:
    """(minutes Prioritise to Approve needs, source): the plan's report minutes in the first
    cycle; later, the last complete Phase 4 start to Phase 6 end of this run in
    .harden/phases.json, at least PRIO_MIN_MINUTES; else the plan's minutes."""
    planned = float(((data.get("windows") or {}).get("minutes") or {}).get("report") or 10)
    if cycle_n <= 1:
        return planned, "plan"
    log = read_json(C.harden_dir(repo) / "phases.json")
    entries = log.get("phases") if isinstance(log, dict) else None
    if not isinstance(entries, list):
        return planned, "plan (no .harden/phases.json)"
    last: Optional[float] = None
    opened: Optional[datetime] = None
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("run") != run.run_key:
            continue
        ts = parse_iso(entry.get("ts"))
        if ts is None:
            continue
        if entry.get("phase") == 4 and entry.get("event") == "start":
            opened = ts
        elif entry.get("phase") == 6 and entry.get("event") == "end" and opened is not None \
                and ts > opened:
            last = minutes_between(opened, ts)
            opened = None
    if last is None:
        return planned, "plan (no measured Prioritise to Approve)"
    return max(PRIO_MIN_MINUTES, last), "measured in .harden/phases.json"


def load_verify_plan(repo: Path) -> Optional[Dict[str, Any]]:
    data = read_json(repo / VERIFY_PLAN_REL)
    return data if isinstance(data, dict) else None


def plan_tasks(vplan: Optional[Dict[str, Any]], n: int) -> Optional[List[Dict[str, Any]]]:
    cycles = (vplan or {}).get("cycles")
    cycle = cycles.get(str(n)) if isinstance(cycles, dict) else None
    if not isinstance(cycle, dict):
        return None
    tasks = cycle.get("tasks")
    return [t for t in tasks if isinstance(t, dict)] if isinstance(tasks, list) else []


def task_launched(cyc: Dict[str, Any], tid: str) -> bool:
    """A task is launched once `check --phase verify --task <id>` recorded it; a written task
    file is not a launch (the third pilot wrote v-cli's and never launched it)."""
    launched = cyc.get("launched")
    return isinstance(launched, dict) and tid in launched


def task_verdicts(repo: Path, tid: str) -> Optional[int]:
    """How many verdicts .harden/verifiers/<tid>.result.json (written by persist_pass.py)
    holds, or None."""
    if not ID_RE.match(tid):
        return None
    data = read_json(C.harden_dir(repo) / "verifiers" / "{}.result.json".format(tid))
    verdicts = data.get("verdicts") if isinstance(data, dict) else None
    return len(verdicts) if isinstance(verdicts, list) else None


def verifier_rates(repo: Path, vplan: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Minutes per cluster (mechanical and other) and per task: the run's own once
    MEASURED_MIN_TASKS verifier tasks of a kind have returned, else the third pilot's priors."""
    sums = {"mechanical": [0.0, 0, 0], "other": [0.0, 0, 0]}
    durations: List[float] = []
    cycles = (vplan or {}).get("cycles")
    for cycle in (cycles.values() if isinstance(cycles, dict) else []):
        for task in (cycle.get("tasks") or []) if isinstance(cycle, dict) else []:
            tid = task.get("id") if isinstance(task, dict) else None
            if not isinstance(tid, str) or not ID_RE.match(tid):
                continue
            meta = read_json(C.harden_dir(repo) / "verifiers" / "{}.meta.json".format(tid))
            observed = meta.get("observed") if isinstance(meta, dict) else None
            if not isinstance(observed, dict):
                continue
            began, ended = parse_iso(observed.get("started")), parse_iso(observed.get("ended"))
            if began is None or ended is None or ended <= began:
                continue
            minutes = minutes_between(began, ended)
            kind = "mechanical" if task.get("kind") == "mechanical" else "other"
            sums[kind][0] += minutes
            sums[kind][1] += len(task.get("clusters") or [])
            sums[kind][2] += 1
            durations.append(minutes)
    other = VERIFY_CLUSTER_MINUTES
    if sums["other"][2] >= MEASURED_MIN_TASKS and sums["other"][1] > 0:
        other = sums["other"][0] / sums["other"][1]
    mechanical = VERIFY_MECH_CLUSTER_MINUTES * other / VERIFY_CLUSTER_MINUTES
    if sums["mechanical"][2] >= MEASURED_MIN_TASKS and sums["mechanical"][1] > 0:
        mechanical = sums["mechanical"][0] / sums["mechanical"][1]
    task = statistics.median(durations) if len(durations) >= MEASURED_MIN_TASKS else \
        VERIFY_TASK_MINUTES
    measured = len(durations) >= MEASURED_MIN_TASKS
    return {"mechanical": round(mechanical, 4), "other": round(other, 4),
            "task": round(task, 2), "tasks_measured": len(durations),
            "source": "measured over {} verifier tasks".format(len(durations)) if measured
            else "priors (pilot 3, A01-F50)"}


def task_minutes(task: Optional[Dict[str, Any]], rates: Dict[str, Any]) -> float:
    if not isinstance(task, dict):
        return float(rates["task"])
    per = rates["mechanical"] if task.get("kind") == "mechanical" else rates["other"]
    return len(task.get("clusters") or []) * float(per)


def commits_per_cluster(repo: Path, data: Dict[str, Any], vplan: Optional[Dict[str, Any]]
                        ) -> Optional[float]:
    """Commits per verified cluster over the closed cycles, or None below
    MEASURED_MIN_CLUSTERS verified clusters."""
    commits = clusters = 0
    for cyc in data.get("cycles") or []:
        if not isinstance(cyc, dict):
            continue
        started, closed = cyc.get("apply_started"), cyc.get("apply_closed")
        if not isinstance(started, dict) or not isinstance(closed, dict):
            continue
        commits += max(0, int(closed.get("commits") or 0) - int(started.get("commits") or 0))
        for task in plan_tasks(vplan, int(cyc.get("n") or 0)) or []:
            if (task_verdicts(repo, str(task.get("id") or "")) or 0) > 0:
                clusters += len(task.get("clusters") or [])
    if clusters < MEASURED_MIN_CLUSTERS:
        return None
    return commits / float(clusters)


def size_verification(repo: Path, run: Run, data: Dict[str, Any], cyc: Dict[str, Any],
                      now: datetime, spend: Dict[str, Any], vplan: Optional[Dict[str, Any]]
                      ) -> Dict[str, Any]:
    """The cycle's verification window, sized when its verification starts (A01-F50):
    A = minutes to the deadline less the final check's reserve F and Prioritise to Approve P;
    a reproduction reserve R (A01-F52) when a verifier task still fits beside it; the rest B
    shared between verification and Apply in proportion to their needs."""
    n = int(cyc.get("n") or 1)
    fres = final_reserve(repo, run, data, now, spend)
    F = fres["reserve"]
    P, p_source = prio_minutes(repo, run, data, n)
    deadline = parse_iso((data.get("windows") or {}).get("deadline"))
    A = (minutes_between(now, deadline) if deadline else 0.0) - F - P
    tasks = plan_tasks(vplan, n)
    rates = verifier_rates(repo, vplan)
    concurrency = max(1, int((data.get("detection") or {}).get("max_concurrent_subagents")
                             or DEFAULT_CONCURRENCY))
    pending = [t for t in tasks if not task_launched(cyc, str(t.get("id")))] \
        if tasks is not None else None
    if pending is not None:
        V: Optional[float] = VERIFY_MARGIN * sum(task_minutes(t, rates) for t in pending) \
            / concurrency
        task1 = task_minutes(pending[0], rates) if pending else 0.0
        K = sum(len(t.get("clusters") or []) for t in pending)
    else:
        V = None
        task1 = float(rates["task"])
        K = 0
    cap1 = REPRO_CAP_MINUTES + (fres["gc"] if not data.get("repro") else 0.0)
    if run.report_only:
        R = 0.0
    else:
        R = min(max(REPRO_SHARE * A, cap1), max(0.0, A - task1))
        if R < cap1:
            R = 0.0
    B = A - R
    cpc_measured = commits_per_cluster(repo, data, vplan)
    cpc = cpc_measured if cpc_measured is not None else COMMITS_PER_CLUSTER
    item = fres["item"]
    Ap = 0.0 if run.report_only else cpc * K * item
    planned_verify = float(((data.get("windows") or {}).get("minutes") or {}).get("verify")
                           or 0)
    if B <= 0:
        W = 0.0
    elif run.report_only:
        W = B
    elif V is None:
        W = min(B, planned_verify)
    elif V + Ap <= B:
        W = B - Ap
    else:
        W = B * V / (V + Ap) if V + Ap > 0 else B
    if B > 0 and not run.report_only:
        floor = min(V, max(task1, P)) if V is not None else task1
        W = min(B, max(W, floor))
    W = max(0.0, W)
    return {"available": round(A, 2), "final_reserve": round(F, 2),
            "prio_minutes": round(P, 2), "prio_source": p_source,
            "repro_reserve": round(R, 2),
            "need_verify": None if V is None else round(V, 2), "need_apply": round(Ap, 2),
            "clusters": K, "tasks": None if pending is None else len(pending),
            "rates": rates, "commits_per_cluster": round(cpc, 4),
            "commits_per_cluster_source": "measured" if cpc_measured is not None else "prior",
            "item_minutes": round(item, 2), "window": round(W, 2),
            "concurrency": concurrency, "computed": iso(now),
            "verify_end": iso(now + timedelta(minutes=W)),
            "repro_end": iso(now + timedelta(minutes=W + R))}


def sizing_line(ts: datetime, n: int, sizing: Dict[str, Any], resized: bool) -> str:
    need = "no verify plan (budget.py verify-plan)" if sizing.get("need_verify") is None else \
        "{} clusters in {} tasks need about {} min at {} at once".format(
            sizing["clusters"], sizing["tasks"], sizing["need_verify"], sizing["concurrency"])
    return ("- {} budget: cycle {} {}verification until {} ({} of {} min left after the "
            "final-check reserve {} min and Prioritise to Approve {} min; reproductions until "
            "{}); {}, Apply about {} min (A01-F50)").format(
                iso(ts), n, "resized: " if resized else "",
                hhmm(parse_iso(sizing["verify_end"])), sizing["window"], sizing["available"],
                sizing["final_reserve"], sizing["prio_minutes"],
                hhmm(parse_iso(sizing["repro_end"])), need, sizing["need_apply"])


def _cap_over(caps: Dict[str, Any], spend: Dict[str, Any], key: str, extra: float = 0.0
              ) -> bool:
    limit = caps.get(key)
    return limit is not None and spend["known"] and spend["usd"] + extra >= float(limit)


def check_verify(repo: Path, run: Run, data: Dict[str, Any], path: Path, now: datetime,
                 spend: Dict[str, Any], task_id: Optional[str], warnings: List[str],
                 as_json: bool) -> int:
    """`check --phase verify`: sizes the cycle's window when its verification starts, names
    the next task and records a launch given with --task (A01-F50, A01-F51)."""
    caps = data.get("usd_caps") or {}
    cyc = current_cycle(data, now)
    n = int(cyc.get("n") or 1)
    vplan = load_verify_plan(repo)
    notes: List[str] = []
    changed = False
    if not isinstance(cyc.get("verify_started"), dict):
        sizing = size_verification(repo, run, data, cyc, now, spend, vplan)
        cyc["verify_started"] = {"ts": iso(now), "usd": spend["usd"]}
        cyc["sizing"] = sizing
        cyc["verify_end"] = sizing["verify_end"]
        cyc["repro_end"] = sizing["repro_end"]
        append_progress(repo, sizing_line(now, n, sizing, False))
        changed = True
    elif (cyc.get("sizing") or {}).get("need_verify") is None and \
            plan_tasks(vplan, n) is not None:
        sizing = size_verification(repo, run, data, cyc, now, spend, vplan)
        sizing["resized_at"] = iso(now)
        cyc["sizing"] = sizing
        cyc["verify_end"] = sizing["verify_end"]
        cyc["repro_end"] = sizing["repro_end"]
        append_progress(repo, sizing_line(now, n, sizing, True))
        changed = True
    tasks = plan_tasks(vplan, n)
    if tasks is None:
        notes.append("no {}: run budget.py verify-plan".format(VERIFY_PLAN_REL))
    rates = verifier_rates(repo, vplan)
    launched = cyc.setdefault("launched", {})
    if not isinstance(launched, dict):
        launched = cyc["launched"] = {}
    task: Optional[Dict[str, Any]] = None
    if task_id is not None:
        if tasks is not None:
            task = next((t for t in tasks if t.get("id") == task_id), None)
            if task is None:
                if changed:
                    _write_json_retry(path, data)
                raise BudgetError("task {} is not in the verify plan of cycle {}".format(
                    task_id, n))
        if task_id in launched:
            if changed:
                _write_json_retry(path, data)
            raise BudgetError("task {} was launched at {}: launch each task once".format(
                task_id, launched[task_id]))
    elif tasks is not None:
        task = next((t for t in tasks if not task_launched(cyc, str(t.get("id")))), None)
    est = task_minutes(task, rates)
    unlaunched = [t for t in tasks or [] if not task_launched(cyc, str(t.get("id")))]
    verify_end = parse_iso(cyc.get("verify_end"))
    result: Dict[str, Any] = {"phase": "verify", "now": iso(now), "spend": spend["usd"],
                              "spend_known": spend["known"], "open": True, "reason": None,
                              "cycle": n, "next_task": task.get("id") if task else task_id,
                              "task_minutes": round(est, 2),
                              "tasks_left": None if tasks is None else len(unlaunched),
                              "repro_end": cyc.get("repro_end"), "rates": rates,
                              "sizing": cyc.get("sizing")}
    all_launched = tasks is not None and task_id is None and task is None
    if all_launched:
        notes.append("budget: verify: every planned task of cycle {} is launched; wait for "
                     "them, then run the reproductions (detection step 12)".format(n))
    elif verify_end is None or now + timedelta(minutes=est) > verify_end:
        result.update(open=False, reason="time")
    elif _cap_over(caps, spend, "verify"):
        result.update(open=False, reason="spend")
    left_usd = None if caps.get("verify") is None else float(caps["verify"]) - spend["usd"]
    minutes_left = round(minutes_between(now, verify_end), 1) if verify_end else None
    result.update(minutes_left=minutes_left, usd_left=None if left_usd is None else
                  round(left_usd, 2), warnings=warnings, notes=notes)
    if task_id is not None and (result["open"] or run.advisory):
        launched[task_id] = iso(now)
        changed = True
    if run.advisory:
        verdict = "open" if result["open"] else "would close ({})".format(result["reason"])
        result["open"] = True
        text = "budget (advisory, interactive run without a profile budget): verify {} " \
               "(cycle {})".format(verdict, n)
        code = 0
    elif result["open"]:
        if all_launched:
            text = notes[-1]
        else:
            kind = task.get("kind") if task else "task"
            clusters = len(task.get("clusters") or []) if task else 0
            text = "budget: verify open (cycle {}): {} min left (until {}); next: task {} ({}, " \
                   "{} clusters, about {} min)".format(
                       n, minutes_left, hhmm(verify_end), result["next_task"] or "-", kind,
                       clusters, round(est, 1))
            if tasks is not None:
                text += "; {} of {} tasks not launched".format(len(unlaunched), len(tasks))
            else:
                text = "budget: verify open (cycle {}): {} min left (until {}); next: a " \
                       "verifier task (about {} min)".format(n, minutes_left, hhmm(verify_end),
                                                             round(est, 1))
        code = 0
    else:
        text = "budget: verify window closed at {} ({}): {}".format(
            hhmm(now), result["reason"], ACTIONS["verify"])
        if not run.report_only:
            text += "; reproduction attempts stay open until {} (budget.py repro)".format(
                hhmm(parse_iso(cyc.get("repro_end"))))
        code = 1
        if not isinstance(cyc.get("verify_closed"), dict):
            cyc["verify_closed"] = {"at": iso(now), "reason": result["reason"]}
            append_progress(repo, "- {} budget: verify window of cycle {} closed ({}); {} ({} "
                                  "planned tasks not launched) (A01-F34, A01-F50)".format(
                                      iso(now), n, result["reason"], ACTIONS["verify"],
                                      len(unlaunched)))
            changed = True
        stops = data.setdefault("stops", {})
        if not stops.get("verify"):
            stops["verify"] = {"at": iso(now), "reason": result["reason"], "usd": spend["usd"]}
            changed = True
    if changed:
        _write_json_retry(path, data)
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        print(text)
        for note in notes:
            if note != text:
                print("NOTE: " + note)
        for warning in warnings:
            print("WARNING: " + warning)
    return code


def count_deferred(repo: Path) -> Optional[int]:
    """Entries of .harden/findings.json with status deferred and verified not true, or None."""
    data = read_json(C.harden_dir(repo) / "findings.json")
    findings = data.get("findings") if isinstance(data, dict) else None
    if not isinstance(findings, list):
        return None
    return sum(1 for f in findings if isinstance(f, dict) and f.get("status") == "deferred"
               and f.get("verified") is not True)


def task_decided(repo: Path, tid: str) -> int:
    """How many verdicts of .harden/verifiers/<tid>.result.json decide their candidate: a
    `"verified": null` verdict (the verifier's turn budget) decides nothing."""
    if not ID_RE.match(tid):
        return 0
    data = read_json(C.harden_dir(repo) / "verifiers" / "{}.result.json".format(tid))
    verdicts = data.get("verdicts") if isinstance(data, dict) else None
    if not isinstance(verdicts, list):
        return 0
    return sum(1 for v in verdicts
               if not (isinstance(v, dict) and "verified" in v and v["verified"] is None))


def cycle_progress(repo: Path, cyc: Dict[str, Any], vplan: Optional[Dict[str, Any]]) -> bool:
    """True when the cycle verified something: a verdict that decides its candidate from one of
    its planned tasks (a task whose verdicts are all `"verified": null` verified nothing, so a
    candidate too large for one verifier cannot open cycle after cycle), or, without a plan, a
    verifier result written since the cycle opened."""
    n = int(cyc.get("n") or 1)
    tasks = plan_tasks(vplan, n)
    if tasks is not None:
        return any(task_decided(repo, str(t.get("id") or "")) > 0 for t in tasks)
    opened = parse_iso(cyc.get("opened"))
    for path in (C.harden_dir(repo) / "verifiers").glob("*.result.json"):
        try:
            mtime = datetime.fromtimestamp(os.stat(str(path)).st_mtime, timezone.utc)
        except OSError:
            continue
        if (opened is None or mtime >= opened) and \
                task_decided(repo, path.name[:-len(".result.json")]) > 0:
            return True
    return False


def check_cycle(repo: Path, run: Run, data: Dict[str, Any], path: Path, now: datetime,
                spend: Dict[str, Any], warnings: List[str], as_json: bool) -> int:
    """`check --phase cycle`, run when Apply's queue is empty: opens another verify/apply
    cycle for the deferred candidates while the time before both reserves holds a verifier
    task (A01-F50). Never reaches into the final check's reserve."""
    caps = data.get("usd_caps") or {}
    cyc = current_cycle(data, now)
    c = int(cyc.get("n") or 1)
    deadline = parse_iso((data.get("windows") or {}).get("deadline"))
    result: Dict[str, Any] = {"phase": "cycle", "now": iso(now), "spend": spend["usd"],
                              "spend_known": spend["known"], "open": True, "reason": None,
                              "cycle": c, "warnings": warnings}
    reason: Optional[str] = None
    deferred: Optional[int] = None
    left = 0.0
    if run.report_only:
        reason = "report-only run: no Apply"
    else:
        deferred = count_deferred(repo)
        vplan = load_verify_plan(repo)
        if deferred is None:
            reason = "no .harden/findings.json"
        elif deferred == 0:
            reason = "no deferred candidate"
        elif not cycle_progress(repo, cyc, vplan):
            reason = "cycle {} verified nothing".format(c)
        else:
            fres = final_reserve(repo, run, data, now, spend)
            P, _source = prio_minutes(repo, run, data, c + 1)
            est = float(verifier_rates(repo, vplan)["task"])
            left = (minutes_between(now, deadline) if deadline else 0.0) - fres["reserve"] - P
            result.update(reserve_minutes=fres["reserve"], prio_minutes=round(P, 2),
                          task_minutes=est, deferred=deferred, available=round(left, 1))
            if left < est:
                reason = "time"
            elif _cap_over(caps, spend, "total", ITEM_USD_PRIOR) or _cap_over(caps, spend,
                                                                              "verify"):
                reason = "spend"
    advisory_over: Optional[str] = None
    if reason in ("time", "spend") and run.advisory:
        advisory_over, reason = reason, None
    if reason is None:
        closed = cyc.get("apply_started")
        if isinstance(closed, dict) and not isinstance(cyc.get("apply_closed"), dict):
            cyc["apply_closed"] = {"ts": iso(now), "usd": spend["usd"],
                                   "commits": commit_count(repo, run.base_sha)}
        entry: Dict[str, Any] = {"n": c + 1, "opened": iso(now), "deferred": deferred,
                                 "available": round(left, 1)}
        if advisory_over:
            entry["advisory_over"] = advisory_over
        data["cycles"].append(entry)
        _write_json_retry(path, data)
        append_progress(repo, "- {} budget: cycle {} opened: {} deferred candidates, {} min "
                              "before the final-check reserve and Prioritise to Approve "
                              "(A01-F50)".format(iso(now), c + 1, deferred, round(left, 1)))
        until = now + timedelta(minutes=max(0.0, left))
        text = "budget: cycle {} open: {} deferred candidates, {} min (until {}); run " \
               "budget.py verify-plan --cycle {}, then Phase 3 for them and Phases 4, 6 and 7 " \
               "for the new verdicts".format(c + 1, deferred, round(left, 1), hhmm(until), c + 1)
        if advisory_over:
            text = "budget (advisory, interactive run without a profile budget): cycle would " \
                   "close ({}); ".format(advisory_over) + text[len("budget: "):]
        result.update(cycle=c + 1, opened=True)
        code = 0
    else:
        result.update(open=False, reason=reason)
        stops = data.setdefault("stops", {})
        if not stops.get("cycle"):
            stops["cycle"] = {"at": iso(now), "reason": reason, "usd": spend["usd"]}
            _write_json_retry(path, data)
        text = "budget: no further cycle ({}): go to Phase 8".format(reason)
        code = 1
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        print(text)
        for warning in warnings:
            print("WARNING: " + warning)
    return code


# ---------------------------------------------------------------------------
# verify-plan (A01-F51)
# ---------------------------------------------------------------------------


def _int(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def cluster_candidates(cands: Sequence[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Two candidates join when they have the same file (exact case), their inclusive line
    ranges [line, end_line or line] overlap, and either both spans are at most MERGE_SPAN_MAX
    lines or the ranges are identical. Clusters are the connected components (union-find),
    in first-seen order."""
    parent = list(range(len(cands)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    ranges: List[Optional[Tuple[str, int, int]]] = []
    for cand in cands:
        file = cand.get("file")
        line = _int(cand.get("line"))
        if not isinstance(file, str) or not file or line is None:
            ranges.append(None)
            continue
        end = _int(cand.get("end_line"))
        end = end if end is not None and end >= line else line
        ranges.append((C.to_posix(file), line, end))
    by_file: Dict[str, List[int]] = {}
    for idx, rng in enumerate(ranges):
        if rng is not None:
            by_file.setdefault(rng[0], []).append(idx)
    for members in by_file.values():
        for a_pos, a in enumerate(members):
            fa, sa, ea = ranges[a]  # type: ignore[misc]
            for b in members[a_pos + 1:]:
                _fb, sb, eb = ranges[b]  # type: ignore[misc]
                if sa > eb or sb > ea:
                    continue
                small = ea - sa + 1 <= MERGE_SPAN_MAX and eb - sb + 1 <= MERGE_SPAN_MAX
                if small or (sa, ea) == (sb, eb):
                    ra, rb = find(a), find(b)
                    if ra != rb:
                        parent[max(ra, rb)] = min(ra, rb)
    groups: Dict[int, List[Dict[str, Any]]] = {}
    order: List[int] = []
    for idx, cand in enumerate(cands):
        root = find(idx)
        if root not in groups:
            groups[root] = []
            order.append(root)
        groups[root].append(cand)
    return [groups[r] for r in order]


def candidate_rung(cand: Dict[str, Any]) -> int:
    """0: structural, proposed T0 or T1, under a mechanical rule (Tier table rows 1, 3-5, 7, 8
    and 17); 1: any other T0 or T1; 2: T2 or report-only."""
    if cand.get("tier") == "T2" or cand.get("class") == "report-only":
        return 2
    if cand.get("class") == "structural" and cand.get("tier") in ("T0", "T1") and \
            cand.get("rule_ref") in MECHANICAL_RULES:
        return 0
    return 1


def cluster_rung(members: Sequence[Dict[str, Any]]) -> int:
    rungs = [candidate_rung(m) for m in members]
    nonzero = [r for r in rungs if r != 0]
    return min(nonzero) if nonzero else 0


def cluster_key(members: Sequence[Dict[str, Any]]) -> Tuple[Any, ...]:
    band = 0 if any(m.get("severity") in ("critical", "high") or m.get("blocking") is True
                    for m in members) else 1
    severity = min(SEVERITY_RANK.get(str(m.get("severity")), 5) for m in members)
    proof = 0 if any(m.get("confidence") in PROOF_RUNGS for m in members) else 1
    files = [C.to_posix(str(m.get("file"))) for m in members if isinstance(m.get("file"), str)]
    lines = [_int(m.get("line")) for m in members if _int(m.get("line")) is not None]
    ids = [str(m.get("id")) for m in members]
    return (band, cluster_rung(members), severity, proof, min(files) if files else "~",
            min(lines) if lines else 0, min(ids))


def cluster_kind(members: Sequence[Dict[str, Any]]) -> str:
    key = cluster_key(members)
    if key[0] == 0:
        return "consequence"
    return ("mechanical", "demonstrable", "owner")[key[1]]


def pack_tasks(clusters: Sequence[List[Dict[str, Any]]], concurrency: int
               ) -> List[Dict[str, Any]]:
    """Clusters in key order packed into tasks: a file's clusters together, up to
    TASK_CLUSTERS clusters and TASK_CANDIDATES candidates a task, mechanical ones up to
    MECH_TASK_CLUSTERS and MECH_TASK_CANDIDATES; the first mechanical task moves into the
    first wave."""
    ordered = sorted(clusters, key=cluster_key)
    tasks: List[Dict[str, Any]] = []

    def room(task: Dict[str, Any], size: int) -> bool:
        mech = task["kind"] == "mechanical"
        limit_c = MECH_TASK_CLUSTERS if mech else TASK_CLUSTERS
        limit_n = MECH_TASK_CANDIDATES if mech else TASK_CANDIDATES
        return len(task["clusters"]) < limit_c and len(task["candidates"]) + size <= limit_n

    for members in ordered:
        kind = cluster_kind(members)
        ids = [str(m.get("id")) for m in members]
        files = sorted({C.to_posix(str(m.get("file"))) for m in members
                        if isinstance(m.get("file"), str)})
        same_kind = [t for t in tasks if t["kind"] == kind]
        target: Optional[Dict[str, Any]] = None
        if kind == "mechanical":
            if same_kind and room(same_kind[-1], len(ids)):
                target = same_kind[-1]
        else:
            target = next((t for t in same_kind if set(files) & set(t["files"])
                           and room(t, len(ids))), None)
            if target is None:
                target = next((t for t in reversed(same_kind) if room(t, len(ids))), None)
        if target is None:
            target = {"kind": kind, "clusters": [], "candidates": [], "files": []}
            tasks.append(target)
        target["clusters"].append(ids)
        target["candidates"].extend(ids)
        target["files"] = sorted(set(target["files"]) | set(files))
    first_mech = next((i for i, t in enumerate(tasks) if t["kind"] == "mechanical"), None)
    k = max(1, concurrency)
    if first_mech is not None and first_mech >= k:
        tasks.insert(k - 1, tasks.pop(first_mech))
    return tasks


def _task_id(cycle: int, index: int, total: int) -> str:
    width = 3 if total > 99 else 2
    return "v{}-{:0{}d}".format(cycle, index, width)


def _candidate_entries(path: Path) -> List[Dict[str, Any]]:
    data = read_json(path)
    items = data.get("findings") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise BudgetError("{} holds no findings list".format(C.to_posix(str(path))))
    out: List[Dict[str, Any]] = []
    for entry in items:
        if not isinstance(entry, dict):
            continue
        cid = entry.get("id")
        if not isinstance(cid, str) or not ID_RE.match(cid):
            continue
        if entry.get("verified") is True or entry.get("status") not in ("candidate",
                                                                           "deferred"):
            continue
        out.append(entry)
    return out


def plan_text(n: int, cycle: Dict[str, Any], candidates: int) -> str:
    tasks = cycle.get("tasks") or []
    counts = {kind: sum(1 for t in tasks if t.get("kind") == kind)
              for kind in ("consequence", "mechanical", "demonstrable", "owner")}
    clusters = sum(len(t.get("clusters") or []) for t in tasks)
    return ("budget: verify plan cycle {}: {} candidates in {} clusters, {} tasks ({} "
            "consequence, {} mechanical, {} demonstrable, {} owner), about {} min at {} at once "
            "(A01-F51)").format(n, candidates, clusters, len(tasks), counts["consequence"],
                                counts["mechanical"], counts["demonstrable"], counts["owner"],
                                cycle.get("need_minutes"), cycle.get("concurrency"))


def cmd_verify_plan(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    run = Run(repo)
    path = repo / BUDGET_REL
    data = read_json(path)
    if not isinstance(data, dict):
        raise BudgetError("no .harden/budget.json: run budget.py plan --lenses ... first")
    now = now_of(args)
    cycles = data.get("cycles") if isinstance(data.get("cycles"), list) else []
    if args.cycle is not None:
        n = int(args.cycle)
        if n < 1 or (n >= 2 and not any(isinstance(c, dict) and c.get("n") == n
                                        for c in cycles)):
            raise BudgetError("cycle {} is not open: run budget.py check --phase cycle first"
                              .format(n))
    else:
        n = int(current_cycle(data, now).get("n") or 1)
    if n == 1 and not cycles:
        current_cycle(data, now)
    cyc = next(c for c in data["cycles"] if isinstance(c, dict) and c.get("n") == n)
    source = Path(args.source) if args.source else C.harden_dir(repo) / (
        "candidates.json" if n == 1 else "findings.json")
    if not source.is_absolute() and args.source:
        source = Path.cwd() / source
    if not source.is_file():
        raise BudgetError("no {}: nothing to plan".format(C.to_posix(str(source))))
    vplan = load_verify_plan(repo) or {}
    vplan.setdefault("version", 1)
    vplan["tool"] = "budget.py"
    vplan["run"] = run.run_key
    plans = vplan.setdefault("cycles", {})
    existing = plans.get(str(n)) if isinstance(plans, dict) else None
    if isinstance(existing, dict) and not args.replan:
        if args.json:
            print(json.dumps(existing, indent=2))
        else:
            print(plan_text(n, existing, len({c for t in existing.get("tasks") or []
                                              for c in t.get("candidates") or []})))
        return 0
    entries = _candidate_entries(source)
    concurrency = max(1, int((data.get("detection") or {}).get("max_concurrent_subagents")
                             or DEFAULT_CONCURRENCY))
    kept: List[Dict[str, Any]] = []
    if isinstance(existing, dict) and args.replan:
        kept = [t for t in existing.get("tasks") or []
                if isinstance(t, dict) and task_launched(cyc, str(t.get("id")))]
    taken = {c for t in kept for c in t.get("candidates") or []}
    entries = [e for e in entries if e["id"] not in taken]
    packed = pack_tasks(cluster_candidates(entries), concurrency)
    rates = verifier_rates(repo, vplan)
    last = 0
    for task in kept:
        tail = str(task.get("id", "")).rsplit("-", 1)[-1]
        if tail.isdigit():
            last = max(last, int(tail))
    total = last + len(packed)
    for offset, task in enumerate(packed, start=1):
        task["id"] = _task_id(n, last + offset, total)
        task["est_minutes"] = round(task_minutes(task, rates), 2)
    tasks = kept + packed
    need = round(VERIFY_MARGIN * sum(task_minutes(t, rates) for t in tasks
                                     if not task_launched(cyc, str(t.get("id"))))
                 / concurrency, 2)
    record = {"computed": iso(now), "from": C.to_posix(str(source)),
              "concurrency": concurrency, "rates": rates, "need_minutes": need,
              "tasks": [{"id": t["id"], "kind": t["kind"], "clusters": t["clusters"],
                         "candidates": t["candidates"], "files": t["files"],
                         "est_minutes": t.get("est_minutes")} for t in tasks]}
    plans[str(n)] = record
    C.write_json(repo / VERIFY_PLAN_REL, vplan)
    candidate_count = len({c for t in tasks for c in t["candidates"]})
    summary = plan_text(n, record, candidate_count)
    first_plan = not isinstance(cyc.get("plan"), dict)
    cyc["plan"] = {"computed": iso(now), "candidates": candidate_count,
                   "clusters": sum(len(t["clusters"]) for t in tasks), "tasks": len(tasks),
                   "need_minutes": need}
    _write_json_retry(path, data)
    if first_plan:
        append_progress(repo, "- {} {}".format(iso(now), summary))
    if args.json:
        print(json.dumps(record, indent=2))
    else:
        print(summary if tasks else "budget: verify plan cycle {}: nothing to verify".format(n))
        wave = [t["id"] for t in tasks if not task_launched(cyc, str(t["id"]))][:concurrency]
        if wave:
            print("first wave: " + ", ".join(wave))
        print("wrote {}".format(VERIFY_PLAN_REL))
    return 0


# ---------------------------------------------------------------------------
# repro (A01-F52)
# ---------------------------------------------------------------------------


def _known_ids(repo: Path) -> Set[str]:
    ids: Set[str] = set()
    for name in ("findings.json", "candidates.json"):
        data = read_json(C.harden_dir(repo) / name)
        items = data.get("findings") if isinstance(data, dict) else None
        for entry in items if isinstance(items, list) else []:
            if isinstance(entry, dict) and isinstance(entry.get("id"), str):
                ids.add(entry["id"])
    return ids


def _attempt(data: Dict[str, Any], rid: str) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """(stored key, attempt) of an id, compared casefolded (one attempt per finding)."""
    attempts = data.get("repro") if isinstance(data.get("repro"), dict) else {}
    for key, value in attempts.items():
        if isinstance(key, str) and key.casefold() == rid.casefold() and isinstance(value,
                                                                                   dict):
            return key, value
    return None, None


def _sha256_file(path: Path) -> Optional[str]:
    try:
        with open(str(path), "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError:
        return None


def _git_list(cwd: str, args: Sequence[str]) -> Tuple[int, bytes]:
    try:
        proc = subprocess.run(["git", "-c", "core.fsmonitor=false", "-C", cwd] + list(args),
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, env=C.git_env(), check=False,
                              timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return 1, b""
    return proc.returncode, proc.stdout


def check_repro_command(cmd: str, repo: Path) -> List[str]:
    """Checks on a registered reproduction command (A01-F52): one quoted-or-plain command,
    no shell operator, no inline code, no forbidden command. Returns the command's words."""
    if any(ch in cmd for ch in "\n\r;&|`$%<>\\"):
        raise BudgetError("the command holds a newline, a shell operator (; & | ` $ % < >) or "
                          "a backslash: register one plain command, and write paths with "
                          "forward slashes")
    try:
        words = shlex.split(cmd, posix=True)
    except ValueError as exc:
        raise BudgetError("the command does not parse ({}): register one plain command"
                          .format(exc))
    if not words:
        raise BudgetError("the command is empty")
    first = _program_name(words[0])
    if first in SHELL_PROGRAMS or first.endswith(SHELL_SCRIPT_EXTS) or \
            any(_program_name(w) in SHELLS for w in words[1:]):
        raise BudgetError("the command runs a shell, a task runner, a wrapper or a shell script "
                          "({}): every line of it would start a process the forbidden-command "
                          "check never sees; register the test runner or interpreter that runs "
                          "the attempt's file".format(words[0]))
    for word in words:
        lower = word.lower()
        if lower in INLINE_FLAGS or (lower == "-p" and first == "node"):
            raise BudgetError("the command runs inline code ({}): write the reproduction into "
                              "a file and run that file".format(word))
    import gates as G  # noqa: E402  (sibling module; only repro --cmd needs it)
    patterns = G.marker_forbidden([C.harden_dir(repo) / "active"])
    if vp_forbidden(cmd, patterns):
        raise BudgetError("the run profile forbids this command (forbidden_commands): nothing "
                          "was registered")
    return words


def _program_name(word: str) -> str:
    """A command word's program: its basename, lower-cased, without .exe."""
    name = os.path.basename(word.replace("\\", "/")).lower()
    return name[:-4] if name.endswith(".exe") else name


def _shell_script(rel: str, text: str) -> bool:
    """True for a file a shell or task runner reads line by line: by extension, by name
    (Makefile, justfile, Taskfile) or by a shell shebang."""
    base = posix_basename(rel).lower()
    first_line = text.split("\n", 1)[0].strip()
    return base.endswith(SHELL_SCRIPT_EXTS) or base in SHELL_SCRIPT_NAMES or \
        bool(SHEBANG_SHELL_RE.match(first_line))


def posix_basename(path: str) -> str:
    return path.replace("\\", "/").rsplit("/", 1)[-1]


def vp_forbidden(text: str, patterns: Sequence[Any]) -> bool:
    import validate_profile as vp  # noqa: E402
    return vp.forbidden_match(text, list(patterns)) is not None


def scan_attempt_files(wt: str, repo: Path, words: Sequence[str]) -> Dict[str, str]:
    """The worktree holds only new files at the base commit; each is scanned for a process
    start and for forbidden text; the command names one of them. Returns {path: sha256}."""
    code, out = _git_list(wt, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])
    if code != 0:
        raise BudgetError("git status failed in {}".format(C.to_posix(wt)))
    entries = [e for e in out.decode("utf-8", errors="replace").split("\0") if e]
    changed = [e[3:] for e in entries if not e.startswith("??")]
    if changed:
        raise BudgetError("the attempt changed tracked files ({}): reproduce against base and "
                          "add files only".format(", ".join(changed[:5])))
    import gates as G  # noqa: E402
    patterns = G.marker_forbidden([C.harden_dir(repo) / "active"])
    files: Dict[str, str] = {}
    for entry in entries:
        rel = C.to_posix(entry[3:])
        full = Path(wt) / rel
        try:
            size = os.stat(str(full)).st_size
        except OSError:
            continue
        if size > REPRO_FILE_MAX_BYTES:
            raise BudgetError("{} is over {} bytes: a reproduction is one small file".format(
                rel, REPRO_FILE_MAX_BYTES))
        text = full.read_bytes().decode("utf-8", errors="replace")
        if _shell_script(rel, text):
            raise BudgetError("{} is a shell script or task-runner file: each of its lines "
                              "starts a process; write the reproduction as a test or script "
                              "of the project's language".format(rel))
        # A line continuation (a backslash before the line break) splits a command over two
        # lines: the joined lines are scanned too.
        joined = re.sub(r"\\\r?\n", " ", text)
        for lines in (text.splitlines(), joined.splitlines()):
            for number, line in enumerate(lines, start=1):
                if PROCESS_RE.search(line) or vp_forbidden(line, patterns):
                    raise BudgetError("{}:{} starts a process or names a forbidden command: "
                                      "make that call the registered command itself".format(
                                          rel, number))
        files[rel] = hashlib.sha256(full.read_bytes()).hexdigest()
    named = any(C.to_posix(w) == rel or C.to_posix(w).endswith("/" + rel) or
                rel.endswith("/" + C.to_posix(w).lstrip("./")) or
                C.to_posix(w).lstrip("./") == rel
                for w in words for rel in files)
    if not named:
        raise BudgetError("the command names none of the attempt's files")
    return files


def _proxy_env(base: Dict[str, str]) -> Dict[str, str]:
    env = dict(base)
    closed = "http://127.0.0.1:9"
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        env[name] = closed
    env["NO_PROXY"] = "localhost,127.0.0.1,::1"
    env["NODE_USE_ENV_PROXY"] = "1"
    if os.name != "nt":
        env["http_proxy"] = closed
        env["https_proxy"] = closed
        env["no_proxy"] = "localhost,127.0.0.1,::1"
    return env


def cmd_repro(args: argparse.Namespace) -> int:
    rid = args.id
    if not ID_RE.match(rid) or DEVICE_RE.match(rid):
        raise BudgetError("--id must be a finding id (letters, digits, . _ -; no device name)")
    repo = repo_root(args.repo)
    run = Run(repo)
    path = repo / BUDGET_REL
    data = read_json(path)
    if not isinstance(data, dict):
        raise BudgetError("no .harden/budget.json: run budget.py plan --lenses ... first")
    if rid not in _known_ids(repo):
        raise BudgetError("{} is no finding or candidate id".format(rid))
    if run.report_only:
        print("budget: report-only run: no reproduction attempt; the finding keeps its rung "
              "(DT-27)")
        return 1
    now = now_of(args)
    cyc = current_cycle(data, now)
    n = int(cyc.get("n") or 1)
    if not isinstance(cyc.get("verify_started"), dict):
        raise BudgetError("verification has not started in this cycle: run budget.py check "
                          "--phase verify first")
    attempts = data.setdefault("repro", {})
    key, attempt = _attempt(data, rid)
    result: Dict[str, Any] = {"id": rid, "cycle": n, "open": False, "reason": None,
                              "minutes_left": None, "cap_minutes": None,
                              "repro_end": cyc.get("repro_end"), "gate_config": None,
                              "gates_command": None}
    if args.done:
        if attempt is None:
            raise BudgetError("{} has no reproduction attempt to close".format(rid))
        if attempt.get("outcome"):
            print("budget: {} already closed its attempt ({})".format(rid, attempt["outcome"]))
            return 1
        if args.done == "reproduced":
            proof_problem = _reproduced_problem(repo, key or rid, attempt)
            if proof_problem:
                raise BudgetError(proof_problem)
        started = parse_iso(attempt.get("started")) or now
        attempt["outcome"] = args.done
        attempt["ended"] = iso(now)
        _write_json_retry(path, data)
        append_progress(repo, "- {} repro {}: {} after {} min (DT-27; A01-F52)".format(
            iso(now), key or rid, args.done, round(minutes_between(started, now), 1)))
        result.update(reason=args.done)
        _print_repro(result, "budget: repro {}: {} recorded".format(rid, args.done), args.json)
        return 0
    code, text = _repro_state(repo, run, data, cyc, rid, key, attempt, now, result,
                              starting=args.cmd is None)
    if args.cmd is None or code != 0:
        _write_json_retry(path, data)
        _print_repro(result, text, args.json)
        return code
    key, attempt = _attempt(data, rid)
    if attempt is None or not result["open"]:
        raise BudgetError("no open attempt: run budget.py repro --id {} first".format(rid))
    words = check_repro_command(args.cmd, repo)
    scratch = run.marker.get("scratch_dir")
    if not isinstance(scratch, str) or not scratch.strip():
        raise BudgetError("this run records no scratch_dir")
    wt = C.to_posix(os.path.join(scratch, "repro"))
    if not os.path.isdir(wt):
        raise BudgetError("no worktree at {}: git worktree add \"{}/repro\" {} first".format(
            wt, C.to_posix(scratch), run.base_sha))
    status, head = _git_list(wt, ["rev-parse", "HEAD"])
    if status != 0 or head.decode("utf-8", errors="replace").strip() != run.base_sha:
        raise BudgetError("the worktree {} is not at the base commit {}".format(
            wt, run.base_sha))
    if os.path.lexists(os.path.join(wt, ".harden")):
        raise BudgetError("{}/.harden exists: gates.py would read a marker there instead of "
                          "the run's; remove it".format(wt))
    files = scan_attempt_files(wt, repo, words)
    config = read_json(C.harden_dir(repo) / "config.json")
    gates_list = config.get("gates") if isinstance(config, dict) else None
    if not isinstance(gates_list, list) or not [g for g in gates_list if isinstance(g, dict)]:
        raise BudgetError("no gates in .harden/config.json: the reproduction runs under the "
                          "test gate's environment")
    gate_defs = [g for g in gates_list if isinstance(g, dict)]
    test_gate = next((g for g in gate_defs if g.get("name") == "test"), None) or \
        next((g for g in gate_defs if g.get("count_regex")), None) or gate_defs[0]
    if args.cwd:
        cwd_path = os.path.normpath(os.path.join(wt, args.cwd))
        if not (C.to_posix(cwd_path) + "/").startswith(C.to_posix(os.path.normpath(wt)) + "/") \
                or not os.path.isdir(cwd_path):
            raise BudgetError("--cwd {} is not a directory inside the worktree".format(args.cwd))
        cwd = C.to_posix(os.path.relpath(cwd_path, wt))
    else:
        own = test_gate.get("cwd") if isinstance(test_gate.get("cwd"), str) else "."
        cwd = own if os.path.isdir(os.path.join(wt, own)) else "."
    cap = float(attempt.get("cap_minutes") or REPRO_CAP_MINUTES)
    started = parse_iso(attempt.get("started")) or now
    seconds_left = (started + timedelta(minutes=cap) - now).total_seconds()
    gate: Dict[str, Any] = {"name": "repro-{}".format(key), "cmd": args.cmd,
                            "timeout_s": max(30, int(seconds_left)), "cwd": cwd}
    for field_name in ("inherit_env", "env_allowlist"):
        if field_name in test_gate:
            gate[field_name] = test_gate[field_name]
    base_env = test_gate.get("env") if isinstance(test_gate.get("env"), dict) else {}
    gate["env"] = _proxy_env({str(k): str(v) for k, v in base_env.items()})
    if args.bash:
        gate["shell"] = "bash"
    doc: Dict[str, Any] = {"env_policy": config.get("env_policy", "unconfirmed")}
    for field_name in ("inherit_env", "env_allowlist"):
        if field_name in config:
            doc[field_name] = config[field_name]
    doc["gates"] = [gate]
    commands = attempt.setdefault("commands", [])
    k = len(commands) + 1
    config_path = C.harden_dir(repo) / "gates" / "repro" / "{}-{}.gate.json".format(key, k)
    C.write_json(config_path, doc)
    import gates as G  # noqa: E402
    commands.append({"cmd": args.cmd, "cwd": cwd, "files": files,
                     "config": C.to_posix(str(config_path)),
                     "gates_sha256": G.gates_digest(doc["gates"]), "at": iso(now)})
    _write_json_retry(path, data)
    scripts = C.to_posix(os.path.dirname(os.path.abspath(__file__)))
    command = "{} \"{}/gates.py\" --repo \"{}\" --config \"{}\" --out-dir \"{}\" --label " \
              "repro-{}-{}".format(C.default_python_command(), scripts, wt,
                                   C.to_posix(str(config_path)),
                                   C.to_posix(str(C.harden_dir(repo) / "gates")), key, k)
    result.update(gate_config=C.to_posix(str(config_path)), gates_command=command)
    _print_repro(result, "budget: repro {}: command {} registered; run:\n{}".format(
        rid, k, command), args.json)
    return 0


def _repro_state(repo: Path, run: Run, data: Dict[str, Any], cyc: Dict[str, Any], rid: str,
                 key: Optional[str], attempt: Optional[Dict[str, Any]], now: datetime,
                 result: Dict[str, Any], starting: bool) -> Tuple[int, str]:
    """Evaluate (and, when `starting`, start) the one attempt of a finding. Returns (exit
    code, text); updates `data` and `result`."""
    n = int(cyc.get("n") or 1)
    repro_end = parse_iso(cyc.get("repro_end"))
    if attempt is not None and attempt.get("outcome"):
        result["reason"] = "one attempt"
        return 1, "budget: {} had its one attempt in this run ({}): no second attempt " \
                  "(DT-27)".format(rid, attempt["outcome"])
    if attempt is None:
        if not starting:
            raise BudgetError("no open attempt: run budget.py repro --id {} first".format(rid))
        g = float(data.get("gate_minutes") or GATE_MINUTES_UNKNOWN)
        cap = REPRO_CAP_MINUTES + (cold_minutes(repo, g) if not data.get("repro") else 0.0)
        result["cap_minutes"] = round(cap, 2)
        if repro_end is None or now + timedelta(minutes=cap) > repro_end:
            if run.advisory:
                result.update(open=True, reason="would close (window)")
            else:
                data.setdefault("repro_skipped", {})[rid] = iso(now)
                result["reason"] = "window"
                return 1, "budget: reproduction window of cycle {} closed (until {}): no new " \
                          "attempt; the finding keeps its rung (lane 1(h))".format(
                              n, hhmm(repro_end))
        data.setdefault("repro", {})[rid] = {"cycle": n, "started": iso(now),
                                             "cap_minutes": round(cap, 2), "commands": []}
        append_progress(repo, "- {} repro {}: attempt started, cap {} min (A01-F52)".format(
            iso(now), rid, round(cap, 1)))
        result.update(open=True, minutes_left=round(cap, 1))
        return 0, "budget: repro {} open: {} min (cap)".format(rid, round(cap, 1))
    cap = float(attempt.get("cap_minutes") or REPRO_CAP_MINUTES)
    started = parse_iso(attempt.get("started")) or now
    result["cap_minutes"] = cap
    left = minutes_between(now, started + timedelta(minutes=cap))
    if left <= 0:
        if run.advisory:
            result.update(open=True, reason="would close (cap)", minutes_left=round(left, 1))
            return 0, "budget (advisory): repro {} would close (cap)".format(rid)
        attempt["outcome"] = "cap"
        attempt["ended"] = iso(now)
        append_progress(repo, "- {} repro {}: cap reached after {} min (A01-F52)".format(
            iso(now), key or rid, round(cap, 1)))
        result["reason"] = "cap"
        return 1, "budget: repro {}: attempt cap spent: stop; note 'reproduce attempted: " \
                  "cap'".format(rid)
    result.update(open=True, minutes_left=round(left, 1))
    return 0, "budget: repro {} open: {} min left in its cap".format(rid, round(left, 1))


def _reproduced_problem(repo: Path, key: str, attempt: Dict[str, Any]) -> Optional[str]:
    """None when a gates.py record of an unchanged registered command exists."""
    scratch_files: Dict[str, str] = {}
    for k, command in enumerate(attempt.get("commands") or [], start=1):
        if not isinstance(command, dict):
            continue
        record = read_json(C.harden_dir(repo) / "gates" / "repro-{}-{}.json".format(key, k))
        if not isinstance(record, dict) or record.get("gates_sha256") != \
                command.get("gates_sha256"):
            continue
        scratch_files = command.get("files") if isinstance(command.get("files"), dict) else {}
        marker = read_json(C.harden_dir(repo) / "active")
        scratch = marker.get("scratch_dir") if isinstance(marker, dict) else None
        if not isinstance(scratch, str):
            continue
        wt = Path(scratch) / "repro"
        if all(_sha256_file(wt / rel) == digest for rel, digest in scratch_files.items()):
            return None
    return "no gates.py record of an unchanged registered command: run the printed command " \
           "first"


def _print_repro(result: Dict[str, Any], text: str, as_json: bool) -> None:
    if as_json:
        print(json.dumps(result, indent=2))
    else:
        print(text)


# ---------------------------------------------------------------------------
# spend, revert-cap, helpers, CLI
# ---------------------------------------------------------------------------


def cmd_spend(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    run = Run(repo)
    spend = compute_spend(run)
    if args.json:
        print(json.dumps(spend, indent=2))
    else:
        print(spend_text(spend))
    return 0


def revert_cap(commits: int) -> int:
    return min(REVERT_CAP_MAX, max(REVERT_CAP_MIN, math.ceil(commits / 5.0)))


def cmd_revert_cap(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    base = args.base
    if not base:
        marker = read_json(C.harden_dir(repo) / "active")
        base = marker.get("base_sha") if isinstance(marker, dict) else None
    if not base:
        raise BudgetError("no --base and no base_sha in .harden/active")
    print(revert_cap(commit_count(repo, str(base))))
    return 0


def append_progress(repo: Path, line: str) -> None:
    try:
        with open(C.harden_dir(repo) / "progress.md", "a", encoding="utf-8",
                  newline="\n") as handle:
            handle.write(line.rstrip("\n") + "\n")
    except OSError:
        pass


def repo_root(raw: str) -> Path:
    info = C.resolve_repo(Path(raw))
    return info.root


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="budget.py", description=(
        "The run budget of a /harden run (pilot-auto-calibration A01-F34)."))
    sub = parser.add_subparsers(dest="command")
    p = sub.add_parser("plan", help="fix the deadline, the windows and the detection plan")
    p.add_argument("--repo", default=".")
    p.add_argument("--lenses", default=None)
    p.add_argument("--replan", action="store_true")
    p.add_argument("--now", default=None)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("check", help="may this phase continue?")
    p.add_argument("--phase", required=True, choices=PHASES)
    p.add_argument("--task", default=None,
                   help="verify only: the verify-plan task about to be launched (recorded)")
    p.add_argument("--repo", default=".")
    p.add_argument("--now", default=None)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("verify-plan", help="order and pack the verification tasks (A01-F51)")
    p.add_argument("--repo", default=".")
    p.add_argument("--cycle", type=int, default=None)
    p.add_argument("--from", dest="source", default=None)
    p.add_argument("--replan", action="store_true")
    p.add_argument("--now", default=None)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("repro", help="time-box one offline reproduction attempt (A01-F52)")
    p.add_argument("--id", required=True)
    p.add_argument("--cmd", default=None)
    p.add_argument("--bash", action="store_true")
    p.add_argument("--cwd", default=None)
    p.add_argument("--done", default=None, choices=REPRO_OUTCOMES)
    p.add_argument("--repo", default=".")
    p.add_argument("--now", default=None)
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("spend", help="spend since the run started, at list prices")
    p.add_argument("--repo", default=".")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("revert-cap", help="verify_branch.py's --max-reverts (U01-F13)")
    p.add_argument("--repo", default=".")
    p.add_argument("--base", default=None)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code not in (0, None) else 0
    if not args.command:
        parser.print_help()
        return 2
    try:
        handler = {"plan": cmd_plan, "check": cmd_check, "spend": cmd_spend,
                   "revert-cap": cmd_revert_cap, "verify-plan": cmd_verify_plan,
                   "repro": cmd_repro}[args.command]
        return handler(args)
    except (BudgetError, LG.LedgerError) as exc:
        C.eprint("budget.py: {}".format(exc))
        return 2


if __name__ == "__main__":
    sys.exit(main())
