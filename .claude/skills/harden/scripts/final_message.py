#!/usr/bin/env python3
"""final_message.py - print a /harden run's final message from its records and git.

Purpose
    Prints the final message SKILL.md's Final message section defines, from `.harden/` files
    and git alone, so the orchestrator never writes it from memory (pilot-auto-calibration
    A01-F59; A01-F05, A01-F21, A01-F48). Pilot 3's message had no verdict line, no commands,
    no exit codes and no commit list.

When to run it
    While the run is still active (`.harden/active` present), after Phase 8 and before
    `run_state.py stop`. Exit 1 names a stale or missing run file: the orchestrator fixes it
    once while the run is active (the hooks still guard every command), runs the script again,
    stops the run and sends that last output unchanged. After `run_state.py stop` it is run
    only for a run that already stopped (a report-only run that stopped in Phase 5): it then
    reads the run facts `stop` kept in `.harden/session.json` under `stopped.marker`.

Inputs (read only)
    - run facts: `.harden/active`, else `.harden/session.json` -> stopped.marker (base_sha,
      branch, mode, mode_requested, mode_reasons, mode_changed, profile_sha256,
      profile_origin);
    - git: rev-parse HEAD, `git log --oneline --no-decorate <base>..HEAD`, the commit bodies
      (a body with `This reverts commit <40 hex>` is a revert commit), subjects, and HEAD's
      commit time; every git call runs without a shell, with C.git_env() and
      `-c core.quotePath=false`;
    - records: .harden/verify.json, .harden/tools/e2e-reach.json, .harden/gates/final.json,
      .harden/gates/commit-<full sha>.json for every commit of the range,
      .harden/gates/final-oldlines.json (and final-oldlines-confirm.json),
      .harden/gates/final-ratchet.json, .harden/tools/diff_guard-final.json,
      .harden/tools/contract-pins.json, .harden/tools/residual-check.json,
      .harden/tools/models.json (report_check), .harden/findings.json (re-validated in
      process with validate_findings.validate_document), .harden/profile.json,
      .harden/profile-inference.json (finalize.notes), .harden/progress.md (`- default: `
      lines), .harden/approvals.md and .harden/report.md (its `## Limits` section).

Output, block by block
    1. the verdict line: `end-to-end verified` (commits, verify.json describes HEAD, no revert
       commit in base..HEAD, final status green) or `reverted <N> commits; verifier final
       status: <status>` (N counts every revert commit of the range), then `; <e2e-reach
       headline>` or `; e2e reach not computed (<reason>)`; `end-to-end not run: <why>` when
       verify.json is missing or describes another commit; `report only: <reasons>` for a
       report-only run without commits; `no commit: end-to-end not run (nothing applied)`;
    2. `Report: <absolute path>`; 3. branch, base, head, mode and profile hash;
    4. the commits (`git log --oneline` lines verbatim);
    5. each Phase 8 check with its command and the exit code its record shows (the exit code
       the script's docstring defines for that record; gates.py's is rebuilt as gates.py main
       does, from all_passed, count_check.passed and ratchet_check.passed), `not recorded`
       without a record, `not current` for a stale one;
    6. the auto_apply switches the profile approved, and each `- default:` line of progress.md;
    7. `Applied, review before merge`: breaking-api first (REVIEW_KINDS order), each with its
       `undo: git revert <sha7>`;
    8. the top findings awaiting the owner (partial, reverted, blocked, reported; no nits);
    9. the Limits lines of the report, verbatim, at most --limits-max;
    10. next steps, as statements (no question, no offer: A01-F05);
    11. on exit 1, `Run-file problems:` and each problem.
    A record is stale when its head (verify.json head_at_end, e2e-reach.json head, a gates
    record's git_head) is not the commit it must describe, or, for records without a head,
    when its mtime is older than HEAD's commit time (diff_guard-final.json,
    contract-pins.json) or than report.md's mtime or HEAD's commit time (residual-check.json
    and models.json, which check the report): `<file> predates <HEAD|report.md>`.
    The same text goes to --out (UTF-8, LF). --json prints {text, verdict, exit_code,
    problems} instead of the text.

CLI
    python final_message.py [--repo DIR] [--top N] [--limits-max N] [--out FILE] [--json]
    (python3 on macOS/Linux). Defaults: --top 3 (RP-08's top 3 decisions), --limits-max 25,
    --out .harden/final-message.md (relative to the repository).

Exit codes
    0  printed
    1  printed; the message ends with a `Run-file problems:` block naming each stale or
       missing run file
    2  not a git repository, or no run record (neither .harden/active nor stopped.marker in
       .harden/session.json); the reason goes to stderr
    3  internal error: `final_message.py: internal error: <type>: <message>` on stderr,
       nothing on stdout and nothing written to --out

Python 3.9+ standard library only; no network; UTF-8 I/O; subprocesses without a shell.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.dont_write_bytecode = True
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)
import validate_findings as VF  # noqa: E402

VERSION = 1
DEFAULT_TOP = 3
DEFAULT_LIMITS_MAX = 25
OUT_REL = ".harden/final-message.md"
TITLE_MAX = 100
REPORT_ONLY = "report-only"
REVERT_BODY_RE = re.compile(r"^This reverts commit [0-9a-f]{40}", re.M)
DEFAULT_LINE_PREFIX = "- default: "
AWAITING_STATUSES = ("partial", "reverted", "blocked", "reported")
REVIEW_STATUSES = ("applied", "partial")
AUTO_PREFIX_RE = re.compile(r"^\s*`?auto \(profile\):\s*", re.I)
EXIT_OK, EXIT_PROBLEMS, EXIT_NO_RUN, EXIT_INTERNAL = 0, 1, 2, 3

VERIFY_REL = ".harden/verify.json"
REACH_REL = ".harden/tools/e2e-reach.json"
FINAL_GATES_REL = ".harden/gates/final.json"
OLDLINES_REL = ".harden/gates/final-oldlines.json"
OLDLINES_CONFIRM_REL = ".harden/gates/final-oldlines-confirm.json"
RATCHET_REL = ".harden/gates/final-ratchet.json"
DIFF_GUARD_REL = ".harden/tools/diff_guard-final.json"
PINS_REL = ".harden/tools/contract-pins.json"
FINDINGS_REL = ".harden/findings.json"
RESIDUAL_REL = ".harden/tools/residual-check.json"
MODELS_REL = ".harden/tools/models.json"
REPORT_REL = ".harden/report.md"
SARIF_REL = ".harden/report.sarif"


class NoRun(Exception):
    """Not a git repository, or no run record (exit 2)."""


@dataclass
class Run:
    """What every block reads: the run facts, git and the problems found so far."""

    repo: Path
    facts: Dict[str, Any]
    source: str
    base: str
    head: str
    head_time: int
    commits: List[str]
    oneline: List[str]
    revert_commits: int
    problems: List[str] = field(default_factory=list)

    def path(self, rel: str) -> Path:
        return self.repo / rel

    def problem(self, text: str) -> None:
        if text not in self.problems:
            self.problems.append(text)


def sha7(value: Any) -> str:
    return str(value)[:7] if value else "-"


def git_lines(repo: Path, args: Sequence[str]) -> List[str]:
    return [line for line in C.git(repo, list(args)).splitlines() if line.strip()]


def read_record(path: Path) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """(record, None), (None, None) when the file is absent, or (None, why unreadable)."""
    if not path.is_file():
        return None, None
    try:
        data = C.read_json(path)
    except (OSError, ValueError) as exc:
        return None, "unreadable ({})".format(str(exc).splitlines()[0] if str(exc) else
                                               type(exc).__name__)
    if not isinstance(data, dict):
        return None, "unreadable (not a JSON object)"
    return data, None


def read_text(path: Path) -> Optional[str]:
    try:
        return path.read_bytes().decode("utf-8-sig", errors="replace").replace("\r\n", "\n")
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Run facts and git
# ---------------------------------------------------------------------------


def run_facts(hdir: Path) -> Tuple[Dict[str, Any], str]:
    """The marker, else the snapshot `run_state.py stop` kept (R4c-11)."""
    marker, _err = read_record(hdir / "active")
    if marker is not None and marker.get("base_sha"):
        return marker, ".harden/active"
    session, _err = read_record(hdir / "session.json")
    stopped = (session or {}).get("stopped")
    snap = stopped.get("marker") if isinstance(stopped, dict) else None
    if isinstance(snap, dict) and snap.get("base_sha"):
        return snap, ".harden/session.json stopped.marker"
    raise NoRun("no run record: neither .harden/active nor stopped.marker in "
                ".harden/session.json names a base commit")


def load_run(start: Path) -> Run:
    if not C.git_available():
        raise NoRun("git is not available")
    top = C.git_ok(start, ["rev-parse", "--show-toplevel"])
    if not top:
        raise NoRun("{} is not a git repository".format(C.posix_abs(start)))
    repo = Path(top).resolve()
    facts, source = run_facts(repo / C.HARDEN_DIR_NAME)
    base = str(facts["base_sha"])
    head = C.head_sha(repo)
    if not head:
        raise NoRun("the repository has no HEAD commit")
    span = "{}..HEAD".format(base)
    commits = git_lines(repo, ["rev-list", "--reverse", span])
    oneline = C.git(repo, ["log", "--oneline", "--no-decorate", span]).splitlines()
    bodies = C.git(repo, ["log", "--format=%x01%H%x00%B", span]).split("\x01")
    reverts = sum(1 for chunk in bodies if "\x00" in chunk
                  and REVERT_BODY_RE.search(chunk.split("\x00", 1)[1]))
    head_time = int(C.git(repo, ["log", "-1", "--format=%ct", "HEAD"]).strip() or 0)
    return Run(repo=repo, facts=facts, source=source, base=base, head=head,
               head_time=head_time, commits=commits, oneline=[l for l in oneline if l.strip()],
               revert_commits=reverts)


def subject_of(run: Run, sha: str) -> str:
    out = C.git_ok(run.repo, ["log", "-1", "--format=%s", sha])
    return out if out is not None else "(commit {} not found)".format(sha7(sha))


# ---------------------------------------------------------------------------
# Record staleness and exit codes
# ---------------------------------------------------------------------------


def head_problem(run: Run, rel: str, recorded: Any, expected: str) -> Optional[str]:
    """`<file> describes <sha7>, HEAD is <sha7>` when a record's head is not `expected`."""
    if recorded == expected:
        return None
    what = "HEAD is" if expected == run.head else "not"
    return "{} describes {}, {} {}".format(rel, sha7(recorded), what, sha7(expected))


def mtime_problem(run: Run, rel: str, against_report: bool) -> Optional[str]:
    """`<file> predates HEAD|report.md` for a record without a head field (R4c-10 review)."""
    try:
        mtime = run.path(rel).stat().st_mtime
    except OSError:
        return None
    if int(mtime) < run.head_time:
        return "{} predates HEAD".format(rel)
    if against_report:
        try:
            report_mtime = run.path(REPORT_REL).stat().st_mtime
        except OSError:
            return None
        if mtime < report_mtime:
            return "{} predates report.md".format(rel)
    return None


def gates_exit(rec: Dict[str, Any]) -> int:
    """gates.py main's exit code, rebuilt from its record."""
    count = rec.get("count_check")
    ratchet = rec.get("ratchet_check")
    counts_ok = count is None or (isinstance(count, dict) and count.get("passed") is True)
    ratchet_ok = ratchet is None or (isinstance(ratchet, dict) and ratchet.get("passed") is True)
    return 0 if rec.get("all_passed") is True and counts_ok and ratchet_ok else 1


def gate_parts(rec: Dict[str, Any]) -> List[str]:
    """`<gate> <per-run exit codes>[, <count> tests]` for each gate of a gates.py record."""
    summary = rec.get("summary") if isinstance(rec.get("summary"), dict) else {}
    names = [str(g.get("name")) for g in rec.get("gates") or []
             if isinstance(g, dict) and g.get("name")] or list(summary)
    parts: List[str] = []
    for name in names:
        codes: List[str] = []
        for run in rec.get("runs") or []:
            for res in (run.get("results") or []) if isinstance(run, dict) else []:
                if isinstance(res, dict) and res.get("name") == name:
                    code = res.get("exit_code")
                    codes.append("timeout" if code is None and res.get("timed_out") else
                                 str(code) if code is not None else "none")
        info = summary.get(name) if isinstance(summary.get(name), dict) else {}
        if not codes:
            codes = [str(c) for c in info.get("exit_codes") or []]
        text = "{} {}".format(name, " ".join(codes) if codes else "not run")
        low, high = info.get("count_min"), info.get("count_max")
        if isinstance(low, int) and isinstance(high, int):
            text += ", {} tests".format(low) if low == high else ", {}-{} tests".format(low, high)
        parts.append(text)
    return parts


def gates_record(run: Run, rel: str, expected: str) -> Tuple[Optional[Dict[str, Any]], str]:
    """(record, "") for a current record, else (None, `not recorded` | `not current (...)`)."""
    rec, err = read_record(run.path(rel))
    if err:
        run.problem("{} {}".format(rel, err))
        return None, "not recorded ({})".format(err)
    if rec is None:
        return None, "not recorded"
    stale = head_problem(run, rel, rec.get("git_head"), expected)
    if stale:
        run.problem(stale)
        return None, "not current ({})".format(stale)
    return rec, ""


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------


def inference_notes(run: Run, profile: Optional[Dict[str, Any]]) -> List[str]:
    """The first 3 finalize notes of a self-setup run that cleared no gate."""
    inferred = isinstance(profile, dict) and \
        isinstance(profile.get("origin"), dict) and profile["origin"].get("kind") == "inferred"
    no_gate = not isinstance(profile, dict) or not profile.get("gates") or \
        profile.get("live_side_effects") != "none"
    if not no_gate or (profile is not None and not inferred):
        return []
    rec, _err = read_record(run.path(".harden/profile-inference.json"))
    notes = ((rec or {}).get("finalize") or {}).get("notes") if isinstance(
        (rec or {}).get("finalize"), dict) else None
    out: List[str] = []
    for note in notes or []:
        if isinstance(note, str):
            out.append(note)
        elif isinstance(note, dict) and "drop" in note:
            out.append("dropped {}: {}".format(note.get("drop"), note.get("why")))
        elif isinstance(note, dict) and "forbid" in note:
            out.append("forbidden {}: {}".format(note.get("forbid"), note.get("why")))
        else:
            out.append(json.dumps(note, ensure_ascii=False))
        if len(out) == 3:
            break
    return out


def verdict_line(run: Run, profile: Optional[Dict[str, Any]]) -> str:
    mode = str(run.facts.get("mode") or "")
    if not run.commits:
        if mode == REPORT_ONLY:
            reasons = [str(r) for r in run.facts.get("mode_reasons") or [] if str(r).strip()]
            changed = run.facts.get("mode_changed")
            if not reasons and isinstance(changed, dict) and changed.get("reason"):
                reasons = [str(changed["reason"])]
            if not reasons:
                reasons = ["requested with --report-only"]
            return "report only: " + "; ".join(reasons + inference_notes(run, profile))
        return "no commit: end-to-end not run (nothing applied)"
    verify, err = read_record(run.path(VERIFY_REL))
    if verify is None:
        why = "{} {}".format(VERIFY_REL, err or "missing")
        run.problem(why)
        return "end-to-end not run: " + why
    stale = head_problem(run, VERIFY_REL, verify.get("head_at_end"), run.head)
    if stale:
        run.problem(stale)
        return "end-to-end not run: " + stale
    status = verify.get("final_status")
    if run.revert_commits == 0 and status == "green":
        line = "end-to-end verified"
    else:
        line = "reverted {} commits; verifier final status: {}".format(run.revert_commits,
                                                                      status)
    reach, err = read_record(run.path(REACH_REL))
    if reach is None:
        if err:
            run.problem("{} {}".format(REACH_REL, err))
        return line + "; e2e reach not computed (e2e_reach.py did not run)"
    stale = head_problem(run, "e2e-reach.json", reach.get("head"), run.head)
    if stale:
        run.problem(".harden/tools/" + stale)
        return line + "; e2e reach not computed ({})".format(stale)
    return line + "; " + str(reach.get("headline") or "e2e reach has no headline")


def header_lines(run: Run) -> List[str]:
    report = run.path(REPORT_REL)
    if report.is_file():
        sarif = " (SARIF: {})".format(SARIF_REL) if run.path(SARIF_REL).is_file() else ""
        lines = ["Report: {}{}".format(C.posix_abs(report), sarif)]
    else:
        run.problem("{} missing".format(REPORT_REL))
        lines = ["Report: missing"]
    digest = run.facts.get("profile_sha256")
    profile = "profile .harden/profile.json sha256 {}, {}".format(
        str(digest)[:12], run.facts.get("profile_origin") or "owner") if digest else "no profile"
    lines.append("Branch {}, base {}, head {}; mode {} ({})".format(
        run.facts.get("branch") or "-", sha7(run.base), sha7(run.head),
        run.facts.get("mode") or "-", profile))
    return lines


def commit_lines(run: Run) -> List[str]:
    return ["", "Commits (git log --oneline {}..HEAD):".format(sha7(run.base))] + \
        (list(run.oneline) or ["none"])


def per_commit_check(run: Run) -> str:
    green = reused = 0
    red: List[str] = []
    missing: List[str] = []
    stale: List[str] = []
    for sha in run.commits:
        rec, why = gates_record(run, ".harden/gates/commit-{}.json".format(sha), sha)
        if rec is None:
            (stale if why.startswith("not current") else missing).append(sha7(sha))
        elif gates_exit(rec) == 0:
            green += 1
            reused += 1 if rec.get("reused_from") else 0
        else:
            red.append(sha7(sha))
    text = "- gates.py --label commit-<sha> for {} commits: exit 0 for {} ({} reused)".format(
        len(run.commits), green, reused)
    if red:
        text += "; exit 1 for " + ", ".join(red)
    if stale:
        text += "; not current for " + ", ".join(stale)
    if missing:
        text += "; not recorded for " + ", ".join(missing)
    return text


def oldlines_check(run: Run) -> str:
    b7 = sha7(run.base)
    rec, why = gates_record(run, OLDLINES_REL, run.head)
    text = "- strengthen.py replay --base {} --label final-oldlines: {}".format(
        b7, "exit {}".format(gates_exit(rec)) if rec is not None else why)
    if run.path(OLDLINES_CONFIRM_REL).is_file():
        confirm, why = gates_record(run, OLDLINES_CONFIRM_REL, run.head)
        text += "; confirm run (--label final-oldlines-confirm): {}".format(
            "exit {}".format(gates_exit(confirm)) if confirm is not None else why)
    return text


def verify_check(run: Run) -> str:
    verify, err = read_record(run.path(VERIFY_REL))
    b7 = sha7(run.base)
    if verify is None:
        return "- verify_branch.py --base {}: not recorded{}".format(
            b7, " ({})".format(err) if err else "")
    cov = " --e2e-coverage" if verify.get("e2e_coverage") is not None else ""
    command = "- verify_branch.py --base {} --max-reverts {}{}".format(
        b7, verify.get("max_reverts"), cov)
    stale = head_problem(run, VERIFY_REL, verify.get("head_at_end"), run.head)
    if stale:
        return "{}: not current ({})".format(command, stale)
    checks = ", ".join("{} {}".format(c.get("name"), c.get("status"))
                       for c in verify.get("checks") or [] if isinstance(c, dict))
    return "{}: exit {} ({}, {} reverts{})".format(
        command, verify.get("exit_code"), verify.get("final_status"),
        len(verify.get("reverts") or []), "; " + checks if checks else "")


def reach_check(run: Run) -> str:
    reach, err = read_record(run.path(REACH_REL))
    command = "- e2e_reach.py --base {}".format(sha7(run.base))
    if reach is None:
        return command + ": not recorded" + (" ({})".format(err) if err else "")
    stale = head_problem(run, "e2e-reach.json", reach.get("head"), run.head)
    if stale:
        return "{}: not current ({})".format(command, stale)
    return "{}: exit 0 ({})".format(command, reach.get("headline"))


def final_gates_check(run: Run) -> str:
    rec, why = gates_record(run, FINAL_GATES_REL, run.head)
    repeat = rec.get("repeat") if rec is not None else 3
    command = "- gates.py --label final --repeat {}".format(repeat)
    if rec is None:
        return "{}: {}".format(command, why)
    return "{}: exit {} ({})".format(command, gates_exit(rec), "; ".join(gate_parts(rec)))


def ratchet_check(run: Run) -> Optional[str]:
    if not run.path(RATCHET_REL).is_file() and not run.path(".harden/ratchet.json").is_file():
        return None
    rec, why = gates_record(run, RATCHET_REL, run.head)
    command = ("- gates.py --config .harden/ratchet.json --label final-ratchet "
               "--ratchet-from probe")
    return "{}: {}".format(command, "exit {}".format(gates_exit(rec)) if rec is not None
                           else why)


def headless_record(run: Run, rel: str, against_report: bool
                    ) -> Tuple[Optional[Dict[str, Any]], str]:
    """A record without a head field: (record, "") or (None, `not recorded` | `not current`)."""
    rec, err = read_record(run.path(rel))
    if rec is None:
        return None, "not recorded" + (" ({})".format(err) if err else "")
    stale = mtime_problem(run, rel, against_report)
    if stale:
        run.problem(stale)
        return None, "not current ({})".format(stale)
    return rec, ""


def diff_guard_check(run: Run) -> str:
    command = "- diff_guard.py --base {} --json".format(sha7(run.base))
    rec, why = headless_record(run, DIFF_GUARD_REL, False)
    if rec is None:
        return "{}: {}".format(command, why)
    return "{}: exit {} (verdict {}, {})".format(command, 1 if rec.get("hard") else 0,
                                                rec.get("verdict"), DIFF_GUARD_REL)


def pins_check(run: Run) -> str:
    command = "- contract_check.py pins --range {}..HEAD".format(sha7(run.base))
    rec, why = headless_record(run, PINS_REL, False)
    if rec is None:
        return "{}: {}".format(command, why)
    problems = [p for p in rec.get("problems") or [] if isinstance(p, dict)]
    return "{}: exit {} ({} changes, {} unpinned)".format(
        command, 1 if problems else 0, len(rec.get("changes") or []),
        sum(1 for p in problems if p.get("kind") == "unpinned"))


def findings_check(run: Run, doc: Optional[Dict[str, Any]], err: Optional[str]) -> str:
    command = "- validate_findings.py .harden/findings.json --repo ."
    if doc is None:
        run.problem("{} {}".format(FINDINGS_REL, err or "missing"))
        return "{}: exit 2 ({})".format(command, err or "file not found")
    rep = VF.validate_document(doc, repo=run.repo)
    count = len(doc.get("findings") or []) if isinstance(doc.get("findings"), list) else 0
    return "{}: exit {} ({} findings{})".format(
        command, 0 if rep.valid else 1, count,
        ", {} errors".format(len(rep.errors)) if rep.errors else "")


def residual_line(run: Run) -> str:
    rec, why = headless_record(run, RESIDUAL_REL, True)
    if rec is None:
        return "- residual_check.py: " + why
    problems = rec.get("problems") or []
    return "- residual_check.py: exit {} ({} problems)".format(1 if problems else 0,
                                                             len(problems))


def models_line(run: Run) -> str:
    command = "- ledger.py models --check-report .harden/report.md"
    rec, why = headless_record(run, MODELS_REL, True)
    if rec is None:
        return "{}: {}".format(command, why)
    check = rec.get("report_check")
    if not isinstance(check, dict):
        return "{}: not recorded (models.json has no report_check)".format(command)
    return "{}: exit {}".format(command, 1 if check.get("problems") else 0)


def check_lines(run: Run, doc: Optional[Dict[str, Any]], err: Optional[str]) -> List[str]:
    lines = ["", "Checks (command: exit code):"]
    if run.commits:
        lines += [per_commit_check(run), oldlines_check(run), verify_check(run),
                  reach_check(run), final_gates_check(run)]
        ratchet = ratchet_check(run)
        if ratchet:
            lines.append(ratchet)
        lines += [diff_guard_check(run), pins_check(run)]
    else:
        lines.append("- Phase 8 checks: not run (no commit)")
    lines += [findings_check(run, doc, err), residual_line(run), models_line(run)]
    return lines


def approval_lines(run: Run, profile: Optional[Dict[str, Any]]) -> List[str]:
    lines = [""]
    if run.facts.get("mode") in VF.INTERACTIVE_MODES:
        lines.append("Approved by the user: the rows of .harden/approvals.md (interactive run)")
    elif isinstance(profile, dict):
        switches = profile.get("auto_apply") if isinstance(profile.get("auto_apply"),
                                                           dict) else {}
        lines.append("Approved by the profile: auto_apply " + ", ".join(
            "{}={}".format(name, "true" if switches.get(name) is True else "false")
            for name in VF.AUTO_APPLY_SWITCHES))
    else:
        lines.append("Approved by the profile: nothing (no readable .harden/profile.json)")
    progress = read_text(run.path(".harden/progress.md")) or ""
    defaults = [line.rstrip() for line in progress.splitlines()
                if line.startswith(DEFAULT_LINE_PREFIX)]
    if defaults:
        lines += ["Defaults taken:"] + defaults
    else:
        lines.append("Defaults taken: none")
    return lines


def _kind_rank(finding: Dict[str, Any]) -> int:
    kinds = (finding.get("review") or {}).get("kinds") or []
    ranks = [VF.REVIEW_KINDS.index(k) for k in kinds if k in VF.REVIEW_KINDS]
    return min(ranks) if ranks else len(VF.REVIEW_KINDS)


def review_lines(run: Run, findings: List[Dict[str, Any]]) -> Tuple[List[str], int]:
    """The Applied, review before merge lines, and the number of distinct commits."""
    items = [f for f in findings if f.get("status") in REVIEW_STATUSES
             and isinstance(f.get("review"), dict)]
    items = [f for _i, f in sorted(enumerate(items), key=lambda p: (_kind_rank(p[1]), p[0]))]
    lines = ["", "Applied, review before merge ({}):".format(len(items))]
    for f in items:
        commit = str(f.get("commit") or "")
        kinds = ",".join(str(k) for k in (f.get("review") or {}).get("kinds") or [])
        partial = " (partial)" if f.get("status") == "partial" else ""
        if commit:
            lines.append("- {} {} {}{}: {}; undo: git revert {}".format(
                sha7(commit), f.get("id"), kinds, partial, subject_of(run, commit),
                sha7(commit)))
        else:
            lines.append("- {} {}{}: no commit recorded".format(f.get("id"), kinds, partial))
    if not items:
        lines.append("- none")
    return lines, len({str(f.get("commit")) for f in items if f.get("commit")})


def _approval_quotes(run: Run) -> Dict[str, str]:
    text = read_text(run.path(".harden/approvals.md"))
    quotes: Dict[str, str] = {}
    for row in VF.parse_approvals(text or ""):
        key = row["category"].strip().strip("`*\"'")
        quotes[key] = AUTO_PREFIX_RE.sub("", row["quote"].strip().strip("`")).strip()
    return quotes


def awaiting_lines(run: Run, findings: List[Dict[str, Any]], top: int
                   ) -> Tuple[List[str], int]:
    waiting = [f for status in AWAITING_STATUSES for f in findings
               if f.get("status") == status and f.get("severity") != "nit"]
    if not waiting:
        return ["", "Awaiting your decision: none"], 0
    quotes = _approval_quotes(run)
    lines = ["", "Awaiting your decision (top {} of {}):".format(min(top, len(waiting)),
                                                                len(waiting))]
    for f in waiting[:max(top, 0)]:
        title = " ".join(str(f.get("title") or "").split())
        if len(title) > TITLE_MAX:
            title = title[:TITLE_MAX - 1] + "…"
        notes = [line.strip() for line in str(f.get("notes") or "").splitlines()
                 if line.strip().startswith("PZ-24")]
        reason = quotes.get(str(f.get("id"))) or (notes[-1] if notes else str(f.get("status")))
        lines.append("- {} {} {}:{} {}; {}".format(f.get("id"), f.get("severity"),
                                                   f.get("file"), f.get("line"), title, reason))
    return lines, len(waiting)


def limits_lines(run: Run, limit: int) -> List[str]:
    text = read_text(run.path(REPORT_REL))
    if text is None:
        return ["", "Limits: the report is missing"]
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if line.strip() == "## Limits"), None)
    if start is None:
        return ["", "Limits: the report has no ## Limits section"]
    bullets: List[str] = []
    for line in lines[start + 1:]:
        if line.startswith("## "):
            break
        if line.startswith("- "):
            bullets.append(line.rstrip())
    out = ["", "Limits (from .harden/report.md):"] + bullets[:max(limit, 0)]
    if len(bullets) > limit:
        out.append("- … {} more lines under Limits in the report".format(
            len(bullets) - limit))
    if not bullets:
        out.append("- none")
    return out


def next_steps(run: Run, review: int, waiting: int) -> List[str]:
    lines = ["", "Next steps:"]
    if review:
        lines.append("- Review the {} commits under Applied, review before merge; each line "
                     "above gives its undo command.".format(review))
    if run.commits:
        lines.append("- The branch {} is not merged or pushed.".format(
            run.facts.get("branch") or "-"))
    if waiting:
        lines.append("- {} findings wait under Needs your decision and Open owner items in the "
                     "report.".format(waiting))
    if run.revert_commits:
        lines.append("- The reverted commits and the checks that failed are under Reverted by "
                     "end-to-end verification in the report.")
    if not run.commits:
        lines.append("- No project code was changed.")
    return lines


def build_message(start: Path, top: int, limits_max: int
                  ) -> Tuple[str, str, List[str], Path]:
    """(text, verdict line, problems, repository root). Raises NoRun for exit 2."""
    run = load_run(start)
    profile, _err = read_record(run.path(".harden/profile.json"))
    doc, err = read_record(run.path(FINDINGS_REL))
    findings = [f for f in (doc or {}).get("findings") or [] if isinstance(f, dict)] \
        if isinstance((doc or {}).get("findings"), list) else []
    verdict = verdict_line(run, profile)
    lines = [verdict] + header_lines(run) + commit_lines(run) + check_lines(run, doc, err) + \
        approval_lines(run, profile)
    review, review_count = review_lines(run, findings)
    waiting, waiting_count = awaiting_lines(run, findings, top)
    lines += review + waiting + limits_lines(run, limits_max) + \
        next_steps(run, review_count, waiting_count)
    if run.problems:
        lines += ["", "Run-file problems:"] + ["- " + p for p in run.problems]
    return "\n".join(lines) + "\n", verdict, list(run.problems), run.repo


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    try:  # LF on every platform, so stdout and --out hold the same bytes
        sys.stdout.reconfigure(newline="\n")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    parser = argparse.ArgumentParser(
        prog="final_message.py",
        description="Print the run's final message from .harden/ files and git "
                    "(pilot-auto-calibration A01-F59).",
        epilog="Exit 0 printed; 1 printed with Run-file problems; 2 no git repository or no "
               "run record; 3 internal error.")
    parser.add_argument("--repo", default=".", help="repository (default: the current "
                                                    "directory)")
    parser.add_argument("--top", type=int, default=DEFAULT_TOP,
                        help="findings listed under Awaiting your decision (default 3)")
    parser.add_argument("--limits-max", type=int, default=DEFAULT_LIMITS_MAX,
                        help="Limits lines copied (default 25)")
    parser.add_argument("--out", default=OUT_REL, help="default .harden/final-message.md")
    parser.add_argument("--json", action="store_true",
                        help="print {text, verdict, exit_code, problems}")
    args = parser.parse_args(list(argv) if argv is not None else None)
    written: Optional[Path] = None
    try:
        text, verdict, problems, repo = build_message(Path(args.repo).resolve(), args.top,
                                                      args.limits_max)
        code = EXIT_PROBLEMS if problems else EXIT_OK
        out = Path(args.out)
        if not out.is_absolute():
            out = repo / out
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8", newline="\n") as handle:
            written = out
            handle.write(text)
        if args.json:
            print(json.dumps({"text": text, "verdict": verdict, "exit_code": code,
                              "problems": problems}, indent=2, ensure_ascii=False))
        else:
            sys.stdout.write(text)
            sys.stdout.flush()
        return code
    except NoRun as exc:
        C.eprint("final_message.py: {}".format(exc))
        return EXIT_NO_RUN
    except Exception as exc:  # noqa: BLE001  (exit 3 is the documented internal-error code)
        if written is not None:
            try:
                written.unlink()
            except OSError:
                pass
        C.eprint("final_message.py: internal error: {}: {}".format(type(exc).__name__, exc))
        return EXIT_INTERNAL


if __name__ == "__main__":
    sys.exit(main())
