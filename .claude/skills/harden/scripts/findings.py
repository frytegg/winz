#!/usr/bin/env python3
"""findings.py - write the run's candidates, verifier tasks, findings and approvals, validated.

Purpose
    The orchestrator used to write these files with helpers of its own. In the third autonomous
    pilot they carried a stray 0x08 byte, left `.harden/findings.json` invalid (3 errors) for
    part of Phase 8, and wrote `live-effect: none` for every id mechanically
    (pilot-auto-calibration A01-F60). Each subcommand here does one of those jobs and refuses
    a write that validate_findings.py would reject with a new error:
      build          clusters of raw candidates -> .harden/candidates.json (one candidate per
                     lens of a cluster), .harden/candidate-clusters.json, one ledger map per
                     lens under .harden/merge-maps/, then `ledger.py merge` per lens (DT-23);
      verifier-task  the task file of one harden-verifier (.harden/prompts/<vid>.md, with the
                     output contract and turn budget of A01-F55) and the two-line prompt;
      assemble       the verifiers' verdicts -> .harden/findings.json: a candidate no verifier
                     answered is deferred with its reason, the Tier table's DT-27 rules apply,
                     and confidence rises only on a saved output file (DT-27);
      approvals      .harden/decisions.json and the profile's auto_apply switches ->
                     .harden/approvals.md, one row per item; it narrows an item a switch does
                     not cover to report-only and refuses a live-effect item (protocol-change
                     step 3; user-policy-autonomy U01-F04, U01-F12);
      mark           status, commit, test and repro evidence and notes of findings in Phase 7;
                     it never writes the live-effect judgement.
    Imported text (raw candidates, verdicts, evidence) is sanitised first: ANSI sequences are
    stripped and any other control character becomes the text \\xNN (A01-F60).
    build, assemble and approvals keep .harden/findings.json in the RP-06 order (blocking,
    severity, confidence, consequence band, location class, rank, PZ-22 dimension, file, line,
    id), which protocol-change step 3's queue follows; mark keeps the current order. A write
    is refused only for an error the file on disk did not already have.

CLI (python3 on macOS/Linux)
    python findings.py build --clusters FILE [--raw FILE] [--extra FILE] [--dismiss FILE]
                             [--out FILE] [--no-merge] [--repo DIR]
    python findings.py verifier-task VID [ID ...] [--reassign] [--repo DIR]
        (no ID: the candidates of task VID in .harden/tools/verify-plan.json)
    python findings.py assemble [VID ...] [--evidence FILE] [--candidates FILE] [--out FILE]
                                [--repo DIR] [--json]
    python findings.py approvals [--decisions FILE] [--repo DIR] [--json]
    python findings.py mark ID [ID ...] [--status STATUS] [--commit SHA]
                            [--test REF --test-detail TEXT] [--repro-rerun TEXT] [--note TEXT]
                            [--evidence KIND REF DETAIL]... [--set FIELD=VALUE]...
                            [--review-kinds K[,K] --review-option O [--review-alternatives T]]
                            [--repo DIR]

Files
    reads  .harden/raw-candidates/all.json, .harden/candidates.json, .harden/active,
           .harden/config.json, .harden/profile.json, .harden/profile-inference.json,
           .harden/rank.json, .harden/decisions.json, .harden/verifiers/<vid>.result.json and
           <vid>.md, .harden/prompts/*.ids.json, .harden/tools/verify-plan.json
    writes .harden/candidates.json, .harden/candidate-clusters.json, .harden/merge-maps/,
           .harden/prompts/<vid>.md and <vid>.ids.json, .harden/findings.json,
           .harden/approvals.md, .harden/decisions.json (the `at` times)

Exit codes
    0  written (warnings may be printed)
    1  refused: nothing written (a refusal lists each problem); build also exits 1 after
       writing when a `ledger.py merge` failed (the candidates are valid, the ledger is not)
    2  usage error: a missing or unreadable input, an unknown id or field, a run mode
       approvals does not serve (interactive, report-only, no active run)

Python 3.9+ standard library only; no network; UTF-8 in (a BOM is tolerated) and out with LF
line ends; git and ledger.py run without a shell.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

sys.dont_write_bytecode = True
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)
import gates as G  # noqa: E402  (ANSI_RE)
import validate_findings as vf  # noqa: E402
import validate_profile as vp  # noqa: E402

VERSION = 1
EXIT_OK, EXIT_REFUSED, EXIT_USAGE = 0, 1, 2
MAX_PRINTED = 30
HARDEN = C.HARDEN_DIR_NAME
RAW_REL = ".harden/raw-candidates/all.json"
CANDIDATES_REL = ".harden/candidates.json"
FINDINGS_REL = ".harden/findings.json"
CLUSTERS_REL = ".harden/candidate-clusters.json"
MERGE_DIR_REL = ".harden/merge-maps"
DECISIONS_REL = ".harden/decisions.json"
APPROVALS_REL = ".harden/approvals.md"
VERIFY_PLAN_REL = ".harden/tools/verify-plan.json"
DISMISSED_KEY = "_dismissed"
EXPLORATION = "exploration"
TOOL_LENS = "project-tool"
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
PASS_NUMBER_RE = re.compile(r"-p([0-9]+)$")
VERIFIER_STEM_RE = re.compile(r"\.(?:v[0-9]+|unparsed|result|meta|reads)$")
CONTROL_RE = vf.CONTROL_RE
# A saved output that may raise a confidence (DT-27): a non-empty file under .harden/tools/,
# or a gates.py record of a registered reproduction (.harden/gates/ is hook-protected).
SAVED_OUTPUT_RE = re.compile(
    r"\.harden/(?:tools/[^\s)'\"`,;]+|gates/repro-[A-Za-z0-9._-]+\.json)")
REPRO_RERUN_PREFIX = "Headline repro re-run at "
LIVE_LINE_RE = re.compile(r"^\s*live-effect:", re.I | re.M)
MONEY_LINE_RE = re.compile(r"^\s*money-path:\s*(\S+)", re.I)
LANE_LETTER_RE = re.compile(r"owner-judgement lane 1\([a-j]\)")

SEV = {"critical": 0, "high": 1, "medium": 2, "low": 3, "nit": 4}
CONF = {"failing_test": 0, "reproduction": 1, "tool_high_precision": 2, "needs_review": 3,
        "inference": 4}
LOC = {"hotspot": 0, "warm": 1, "unknown": 1, "cold": 2}
# PZ-22's dimension order.
DIM: Dict[str, int] = {"architecture": 0}
DIM.update({lens: 1 for lens in (
    "errors-resilience", "concurrency", "security", "numeric-money-time", "data", "web3",
    "ops-config", "performance", "frontend", "build-ci", "dependencies", "ai-failure-modes",
    TOOL_LENS)})
DIM.update({"complexity-design": 2, "duplication": 2, "dead-code": 2, "tests": 3,
            "types-suppressions": 4, "readability-docs": 5})
CONSEQUENCE_LENSES = frozenset({"security", "web3", "numeric-money-time", "data",
                                "concurrency", "errors-resilience"})
LENS_ABBR = {
    "ai-failure-modes": "ai", "architecture": "ar", "complexity-design": "cx",
    "concurrency": "cc", "data": "da", "dead-code": "dc", "dependencies": "dp",
    "duplication": "du", "errors-resilience": "er", "numeric-money-time": "nm",
    "ops-config": "op", "performance": "pe", "readability-docs": "rd", "security": "se",
    "tests": "tq", "types-suppressions": "ty", "web3": "w3", "build-ci": "ci", "frontend": "fe",
    TOOL_LENS: "pt"}
PREFIX_LENS = {prefix: lens for lens, prefix in vf.LENS_PREFIX.items()}
CANDIDATE_FIELDS = ("rule_ref", "title", "file", "line", "end_line", "class", "tier",
                    "severity", "severity_criterion", "confidence", "fix_risk",
                    "location_class", "cwe")
PROOF_KIND = dict(vf.CONFIDENCE_EVIDENCE_KIND)          # rung -> evidence kind
KIND_PROOF = {kind: rung for rung, kind in PROOF_KIND.items()}  # evidence kind -> rung
PAST_APPROVED = frozenset({"applied", "partial", "reverted", "blocked", "reported",
                           "deferred"})
MARK_STATUSES = ("applied", "partial", "reverted", "blocked", "deferred", "reported")
REASON_NEEDED = frozenset({"reverted", "blocked", "deferred"})
SET_FIELDS = ("severity", "severity_criterion", "confidence", "conditions", "cwe", "blocking",
              "unblock_condition", "quality_characteristic", "baseline_state", "fingerprint",
              "location_class", "fix_risk")
SET_ELSEWHERE = {"tier": "approvals (a decision's tier)", "class": "approvals (a decision's "
                 "class)", "status": "mark --status", "commit": "mark --commit",
                 "review": "mark --review-kinds", "notes": "mark --note",
                 "evidence": "mark --evidence or --test"}
BUDGET_NOTE = "not verified: run budget reached"
TURN_BUDGET_NOTE = "not verified: verifier turn budget reached"
APPROVALS_HEAD = (
    "# Approvals\n\nAutonomous run: every row comes from `.harden/profile.json` through "
    "`findings.py approvals` (user-policy-autonomy U01-F01, U01-F04); nobody was asked.\n\n"
    "| category | decision | count | user's exact words | UTC time |\n|---|---|---|---|---|\n")

# The verifier's money-path, live-effect and reproduce lines, copied word for word from
# detection step 11, and the live-effect paths from prioritization.md's Money paths paragraph
# (a unit test keeps them byte-identical to the references).
MONEY_PATH_SENTENCE = (
    'verifier_note ends with one money-path line: `money-path: floor <kind> at <file:line>` '
    'when the change the candidate needs would touch code that creates, submits, amends or '
    'cancels orders, payments, transfers or withdrawals, signs anything, broadcasts '
    'transactions, or reads, derives, stores, logs or sends private keys, seed phrases, API '
    'keys or secrets (kind `order`, `payment`, `transfer` (withdrawals included), `sign`, '
    '`broadcast` or `key` (seed phrases and secrets included)); otherwise `money-path: yes '
    '(<why>)` when that code computes or moves money, prices, fees, balances, positions or '
    'orders, and `money-path: no` when it does not.')
LIVE_EFFECT_SENTENCE = (
    'It adds one live-effect line: `live-effect: <kind> at <file:line>` when the change would '
    "do what prioritization.md's Money paths paragraph calls a live-effect path (kind `key`, "
    '`sign`, `submit`, `deploy`, `system-contract` or `live-only`), judged on what the change '
    'alters, not on what the function carries; otherwise `live-effect: none` '
    '(user-policy-autonomy U01-F12; pilot-auto-calibration A01-F27).')
REPRODUCE_SENTENCE = (
    'A verdict at `needs_review` or `inference` adds a third line: `reproduce: <the cheapest '
    'offline demonstration: the input, the call, a local stub or fake for each network, chain, '
    'clock or file it reaches, and the output that would show the defect>`, or `reproduce: none '
    '(<why>)`. The line describes a demonstration for the orchestrator to write and never names '
    'a command to run (DT-31; pilot-auto-calibration A01-F52).')
LIVE_EFFECT_PATHS = (
    'An item is on a **live-effect path** when the lines its change touches do any of six '
    'things. (1) They change which private key, seed phrase, API key, token or other secret is '
    'read, derived, stored, logged or sent, or where it comes from or goes. (2) They sign, or '
    'change what is signed. (3) They build, send or broadcast the request, message or '
    'transaction that creates, submits, amends or cancels an order, payment, transfer or '
    "withdrawal at a venue, wallet or chain outside the process, that call's timeout, retry and "
    'idempotency included (ER-22). (4) They deploy or migrate. (5) They change a call to a '
    "chain system contract or precompile that the local test network only emulates (Hedera's "
    'token service at `0x167`): its target, selector, arguments or the handling of its response '
    'code. Or they change the storage layout of an upgradeable contract whose deployed state '
    'only the live chain holds. (6) They change the behaviour of code that runs only under an '
    "entry point that signs, deploys or submits: a script or task the profile's "
    '`forbidden_commands` refuse, a Hardhat deploy script or task, a Foundry `*.s.sol` script, '
    'a migration. A test of such a change exercises only a stub or an emulation of the '
    'counterpart, so autonomous mode never applies it (user-policy-autonomy U01-F12). Logic '
    'that decides amounts, prices or when to act, and contract functions the local chain '
    'executes (a swap, a liquidity function), are money paths, not live-effect paths. A '
    'contract function that calls a system contract stays a money path when the change leaves '
    "that call as it is and its test puts a local stub at the system contract's address with no "
    'fork (U01-F12). A bound or a record added to a read-only call that carries a credential (a '
    'timeout on a price request) does none of (1) to (6) (pilot-auto-calibration A01-F27). '
    'Every verified finding gets one `notes` entry, `live-effect: <kind> at <file:line>` (kind '
    '`key`, `sign`, `submit`, `deploy`, `system-contract` or `live-only`) or `live-effect: '
    'none`. A change proven AST-identical to its parent (A01-F01) is on no live-effect path. '
    'Otherwise, doubt keeps the item on one.')


class Refused(Exception):
    """A refusal: exit 1, nothing written."""

    def __init__(self, problems: Sequence[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = list(problems)


class Usage(Exception):
    """A usage error: exit 2."""


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def repo_root(arg: Optional[str]) -> Path:
    start = Path(arg or ".").resolve()
    top = C.git_ok(start, ["rev-parse", "--show-toplevel"]) if C.git_available() else None
    if not top:
        raise Usage("{} is not a git repository".format(C.posix_abs(start)))
    return Path(top).resolve()


def load(path: Path, what: str, required: bool = True) -> Any:
    if not path.is_file():
        if required:
            raise Usage("{} not found: {}".format(what, C.posix_abs(path)))
        return None
    try:
        return C.read_json(path)
    except (OSError, ValueError) as exc:
        raise Usage("{} is unreadable: {}".format(what, exc)) from exc


def load_optional(path: Path) -> Any:
    try:
        return C.read_json(path) if path.is_file() else None
    except (OSError, ValueError):
        return None


def marker(repo: Path) -> Dict[str, Any]:
    data = load_optional(repo / HARDEN / "active")
    return data if isinstance(data, dict) else {}


def add_note(finding: Dict[str, Any], line: str) -> None:
    """Append one line to notes, unless that exact line is there already."""
    notes = str(finding.get("notes") or "")
    if line in notes.splitlines():
        return
    finding["notes"] = notes + ("\n" if notes else "") + line


def last_line(text: Any, key: str) -> Optional[str]:
    lines = [ln.strip() for ln in str(text or "").splitlines()
             if ln.strip().lower().startswith(key + ":")]
    return lines[-1] if lines else None


def merge_evidence(*groups: Iterable[Any]) -> List[Dict[str, Any]]:
    """Evidence items in order, deduplicated by (kind, ref)."""
    out: List[Dict[str, Any]] = []
    seen: Set[Tuple[str, str]] = set()
    for group in groups:
        for item in group or []:
            if not isinstance(item, dict):
                continue
            key = (str(item.get("kind")), str(item.get("ref")))
            if key not in seen:
                seen.add(key)
                out.append(dict(item))
    return out


def saved_output(repo: Path, item: Dict[str, Any]) -> Optional[str]:
    """The saved, non-empty output an evidence item names (a file under .harden/tools/ or a
    .harden/gates/repro-*.json record, inside .harden/ once links are resolved), or None
    (DT-27)."""
    root = os.path.normcase(str((repo / HARDEN).resolve()))
    for text in (str(item.get("ref") or ""), str(item.get("detail") or "")):
        for match in SAVED_OUTPUT_RE.finditer(text.replace("\\", "/")):
            rel = match.group(0).rstrip(".:")
            path = repo / rel
            try:
                real = os.path.normcase(str(path.resolve()))
                inside = os.path.commonpath([real, root]) == root
                if inside and path.is_file() and path.stat().st_size > 0:
                    return rel
            except (OSError, ValueError):
                continue
    return None


def cell(text: Any) -> str:
    """A Markdown table cell: one line, no pipe."""
    return " ".join(str(text).split()).replace("|", "/")


# ---------------------------------------------------------------------------
# Sanitising imported text (A01-F60)
# ---------------------------------------------------------------------------


def _clean(text: str) -> Tuple[str, int]:
    count = len(G.ANSI_RE.findall(text))
    stripped = G.ANSI_RE.sub("", text) if count else text
    out, n = CONTROL_RE.subn(lambda m: "\\x{:02x}".format(ord(m.group(0))), stripped)
    return out, count + n


def sanitise(value: Any, owner: str, path: str = "") -> Any:
    """A copy of `value` whose strings hold no ANSI sequence or control character other than
    tab, line feed and carriage return; one WARN line per changed field."""
    if isinstance(value, str):
        out, n = _clean(value)
        if n:
            print("WARN sanitised {} control characters in {}.{}".format(n, owner,
                                                                       path or "<value>"))
        return out
    if isinstance(value, dict):
        return {k: sanitise(v, owner, "{}.{}".format(path, k) if path else str(k))
                for k, v in value.items()}
    if isinstance(value, list):
        return [sanitise(v, owner, "{}[{}]".format(path, i)) for i, v in enumerate(value)]
    return value


# ---------------------------------------------------------------------------
# RP-06 order and the validated writer
# ---------------------------------------------------------------------------


def load_ranks(repo: Path) -> Dict[str, int]:
    data = load_optional(repo / HARDEN / "rank.json")
    out: Dict[str, int] = {}
    for item in (data or {}).get("files") or [] if isinstance(data, dict) else []:
        if isinstance(item, dict) and isinstance(item.get("path"), str) and \
                isinstance(item.get("rank"), int) and not isinstance(item.get("rank"), bool):
            out[C.to_posix(item["path"])] = item["rank"]
    return out


def decision_list(data: Any) -> List[Dict[str, Any]]:
    """decisions.json as a list ({"decisions": [...]}, or an object keyed by id)."""
    if isinstance(data, dict) and isinstance(data.get("decisions"), list):
        return [d for d in data["decisions"] if isinstance(d, dict)]
    if isinstance(data, dict):
        return [dict(v, id=k) for k, v in data.items()
                if isinstance(v, dict) and k not in ("version",)]
    return []


def load_bands(repo: Path) -> Dict[str, str]:
    data = load_optional(repo / DECISIONS_REL)
    return {str(d.get("id")): str(d["band"]) for d in decision_list(data)
            if isinstance(d.get("band"), str)}


def rp06_key(f: Dict[str, Any], ranks: Dict[str, int], bands: Dict[str, str]) -> Tuple[Any, ...]:
    """RP-06: blocking, severity, confidence, consequence band, location class, rank, PZ-22
    dimension, file, line, id. Status is not in the key, so mark never reorders the queue."""
    band = bands.get(str(f.get("id")))
    if band is None:
        band = "consequence" if f.get("class") == "behavioural" or \
            f.get("lens") in CONSEQUENCE_LENSES else "other"
    line = f.get("line") if isinstance(f.get("line"), int) else 0
    return (0 if f.get("blocking") is True else 1, SEV.get(str(f.get("severity")), 5),
            CONF.get(str(f.get("confidence")), 5), 0 if band == "consequence" else 1,
            LOC.get(str(f.get("location_class")), 1),
            ranks.get(C.to_posix(str(f.get("file") or "")), 10 ** 6),
            DIM.get(str(f.get("lens")), 6), str(f.get("file") or ""), line, str(f.get("id")))


def _issue_key(issue: "vf.Issue") -> Tuple[str, str, str]:
    return (issue.finding, issue.field, issue.message)


def save(path: Path, doc: Dict[str, Any], repo: Path, kind: str, sort: bool = True) -> None:
    """Sort (RP-06), stamp, validate and write atomically. Refuses (Refused) only errors the
    file on disk did not already have; those are printed as WARN pre-existing error lines."""
    if sort:
        ranks, bands = load_ranks(repo), load_bands(repo)
        doc["findings"] = sorted(doc.get("findings") or [],
                                 key=lambda f: rp06_key(f, ranks, bands))
    doc["generated"] = C.utc_iso()
    rep = vf.validate_document(doc, repo=repo)
    before: Set[Tuple[str, str, str]] = set()
    old = load_optional(path)
    if isinstance(old, dict):
        before = {_issue_key(i) for i in vf.validate_document(old, repo=repo).errors}
    new = [i for i in rep.errors if _issue_key(i) not in before]
    if new:
        lines = ["ERROR {} {}: {}".format(i.finding, i.field, i.message) for i in new]
        raise Refused(lines)
    old_errors = [i for i in rep.errors if _issue_key(i) in before]
    for issue in old_errors[:MAX_PRINTED]:
        print("WARN pre-existing error {} {}: {}".format(issue.finding, issue.field,
                                                        issue.message))
    C.write_json(path, doc)
    for issue in rep.warnings[:MAX_PRINTED]:
        print("WARN {} {}: {}".format(issue.finding, issue.field, issue.message))
    if len(rep.warnings) > MAX_PRINTED:
        print("WARN … {} more warnings".format(len(rep.warnings) - MAX_PRINTED))
    print("findings.py {}: wrote {} ({} findings, {} warnings{})".format(
        kind, C.to_posix(os.path.relpath(str(path), str(repo))), len(doc.get("findings") or []),
        len(rep.warnings), ", {} pre-existing errors".format(len(old_errors))
        if old_errors else ""))


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------


def raw_index(data: Any) -> Dict[str, Dict[str, Any]]:
    items = data.get("candidates") if isinstance(data, dict) else data
    out: Dict[str, Dict[str, Any]] = {}
    for item in items or []:
        if isinstance(item, dict):
            rid = item.get("raw_id") or item.get("id")
            if isinstance(rid, str):
                out[rid] = item
    return out


def _listing(label: str, values: Iterable[str]) -> Optional[str]:
    items = sorted(set(values))
    return "{}: {}".format(label, ", ".join(items)) if items else None


def _lens_of(raw: Dict[str, Any]) -> Optional[str]:
    lens = raw.get("lens")
    if lens == EXPLORATION or lens is None:
        prefix = str(raw.get("rule_ref") or "").split("-", 1)[0].upper()
        return PREFIX_LENS.get(prefix)
    return str(lens)


def split_cluster(cid: str, key: str, rids: List[str], raws: Dict[str, Dict[str, Any]]
                  ) -> List[Tuple[str, str, List[str]]]:
    """[(candidate id, lens, member raw ids)], the lead lens first (it keeps the cluster id)."""
    order = {rid: i for i, rid in enumerate(rids)}
    lead = min(rids, key=lambda r: (SEV.get(str(raws[r].get("severity")), 5), order[r]))
    lead_lens = raws[lead].get("lens")
    if lead_lens == EXPLORATION:
        others = [raws[r].get("lens") for r in rids if raws[r].get("lens") != EXPLORATION]
        lead_lens = others[0] if others else _lens_of(raws[lead])
    if not lead_lens:
        raise Refused(["cluster {} holds only exploration raws whose rule_ref names no lens"
                       .format(cid)])
    groups: Dict[str, List[str]] = {}
    for rid in rids:
        lens = raws[rid].get("lens")
        lens = lead_lens if lens == EXPLORATION else str(lens)
        groups.setdefault(lens, []).append(rid)
    out: List[Tuple[str, str, List[str]]] = []
    for lens in [str(lead_lens)] + [l for l in groups if l != lead_lens]:
        if lens not in LENS_ABBR:
            raise Refused(["cluster {}: unknown lens {!r}".format(cid, lens)])
        out.append((cid if lens == lead_lens else "{}-{}".format(cid, LENS_ABBR[lens]),
                    lens, groups[lens]))
    return out


def build_candidate(cid: str, key: str, cand_id: str, lens: str, lead: bool,
                    members: List[str], raws: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    order = {rid: i for i, rid in enumerate(members)}
    primary = min(members, key=lambda r: (SEV.get(str(raws[r].get("severity")), 5), order[r]))
    src = raws[primary]
    cand: Dict[str, Any] = {"id": cand_id, "lens": lens}
    for fld in CANDIDATE_FIELDS:
        if src.get(fld) is not None:
            cand[fld] = src[fld]
    cand.setdefault("location_class", "unknown")
    evidence = merge_evidence(*[raws[r].get("evidence") or [] for r in
                                [primary] + [m for m in members if m != primary]])
    cand["evidence"] = evidence
    pass_ids: List[str] = []
    for rid in [primary] + [m for m in members if m != primary]:
        pid = raws[rid].get("pass_id")
        if isinstance(pid, str) and pid not in pass_ids:
            pass_ids.append(pid)
    if pass_ids:
        cand["pass_ids"] = pass_ids
        cand["seen_in_passes"] = len(pass_ids)
    cand["fingerprint"] = key if lead else "{}#{}".format(key, lens)
    also = [m for m in members if m != primary]
    note = "Cluster {} ({}), lens {}: primary raw {}; also {}.".format(
        cid, key, lens, primary, ", ".join(also) if also else "none")
    notes = str(src.get("notes") or "").strip()
    cand["notes"] = (notes + "\n" if notes else "") + note
    cand.update(status="candidate", verified=False, verifier_note="")
    if cand.get("tier") == "T0" and cand.get("class") != "structural":
        cand["tier"] = "T1"
    return cand


def merge_entry(cand_id: str, members: List[str], raws: Dict[str, Dict[str, Any]]
                ) -> Dict[str, Any]:
    counted = [r for r in members if raws[r].get("lens") != EXPLORATION]
    passes = sorted({int(m.group(1)) for r in counted
                     for m in [PASS_NUMBER_RE.search(str(raws[r].get("pass_id") or ""))] if m})
    if not counted:
        return {"id": cand_id, "source": EXPLORATION, "raw_ids": list(members)}
    if not passes:
        return {"id": cand_id, "source": "raw candidates without a pass number",
                "raw_ids": counted}
    return {"id": cand_id, "passes": passes, "raw": len(counted), "raw_ids": counted}


def cmd_build(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    raw_path = Path(args.raw) if args.raw and os.path.isabs(args.raw) else \
        repo / (args.raw or RAW_REL)
    raws = {rid: sanitise(raw, rid) for rid, raw in
            raw_index(load(raw_path, "raw candidates")).items()}
    clusters = load(Path(args.clusters) if os.path.isabs(args.clusters)
                    else repo / args.clusters, "--clusters")
    if isinstance(clusters, dict) and isinstance(clusters.get("clusters"), list):
        clusters = clusters["clusters"]
    if not isinstance(clusters, list) or not all(isinstance(c, dict) for c in clusters):
        raise Usage("--clusters must be a JSON list of {\"id\", \"key\", \"raw_ids\"}")
    dismissed: Dict[str, str] = {}
    if args.dismiss:
        data = load(Path(args.dismiss) if os.path.isabs(args.dismiss) else repo / args.dismiss,
                    "--dismiss")
        if not isinstance(data, dict):
            raise Usage("--dismiss must be a JSON object {\"<raw id>\": \"<reason>\"}")
        dismissed = {str(k): str(v or "").strip() for k, v in data.items()}
    extras: List[Dict[str, Any]] = []
    if args.extra:
        data = load(Path(args.extra) if os.path.isabs(args.extra) else repo / args.extra,
                    "--extra")
        if not isinstance(data, list) or not all(isinstance(e, dict) and
                                                 isinstance(e.get("finding"), dict)
                                                 for e in data):
            raise Usage("--extra must be a JSON list of {\"source\", \"finding\"}")
        extras = sanitise(data, "extra")
    problems: List[str] = []
    ids = [str(c.get("id")) for c in clusters]
    seen: Dict[str, str] = {}
    twice: List[str] = []
    for c in clusters:
        for rid in c.get("raw_ids") or []:
            if rid in seen:
                twice.append(str(rid))
            seen[str(rid)] = str(c.get("id"))
    for problem in (
            _listing("cluster ids that do not match the schema id pattern",
                     [i for i in ids if not vf.ID_RE.match(i)]),
            _listing("duplicate cluster ids", [i for i in ids if ids.count(i) > 1]),
            _listing("clusters without a key", [str(c.get("id")) for c in clusters
                                                if not str(c.get("key") or "").strip()]),
            _listing("clusters without raw ids", [str(c.get("id")) for c in clusters
                                                  if not c.get("raw_ids")]),
            _listing("unknown raw ids", [r for r in list(seen) + list(dismissed)
                                         if r not in raws]),
            _listing("raw ids in no cluster", [r for r in raws
                                               if r not in seen and r not in dismissed]),
            _listing("raw ids in two clusters", twice),
            _listing("raw ids both clustered and dismissed",
                     [r for r in dismissed if r in seen]),
            _listing("dismissed raw ids without a reason",
                     [r for r, why in dismissed.items() if not why])):
        if problem:
            problems.append(problem)
    if problems:
        raise Refused(problems)
    candidates: List[Dict[str, Any]] = []
    sidecar: Dict[str, Any] = {}
    maps: Dict[str, List[Dict[str, Any]]] = {}
    for c in clusters:
        cid, key = str(c["id"]), str(c["key"]).strip()
        rids = [str(r) for r in c["raw_ids"]]
        for n, (cand_id, lens, members) in enumerate(split_cluster(cid, key, rids, raws)):
            candidates.append(build_candidate(cid, key, cand_id, lens, n == 0, members, raws))
            sidecar[cand_id] = {"cluster": cid, "lens": lens, "raw_ids": members}
            maps.setdefault(lens, []).append(merge_entry(cand_id, members, raws))
    for extra in extras:
        f = dict(extra["finding"])
        source = str(extra.get("source") or "extra")
        candidates.append(f)
        sidecar[str(f.get("id"))] = {"cluster": str(f.get("id")), "lens": f.get("lens"),
                                     "raw_ids": [], "source": source}
        maps.setdefault(str(f.get("lens")), []).append({"id": f.get("id"), "source": source})
    dup = [i for i in [str(f.get("id")) for f in candidates]
           if [str(g.get("id")) for g in candidates].count(i) > 1]
    if dup:
        raise Refused([_listing("candidate ids made twice", dup) or ""])
    if dismissed:
        sidecar[DISMISSED_KEY] = dismissed
    out = Path(args.out) if args.out and os.path.isabs(args.out) else repo / (args.out or
                                                                               CANDIDATES_REL)
    old = load_optional(out)
    mark_data = marker(repo)
    base = mark_data.get("base_sha") or C.head_sha(repo)
    doc = {"version": 1, "base_sha": base, "generated": C.utc_iso(),
           "tool_versions": (old.get("tool_versions") if isinstance(old, dict) and
                             isinstance(old.get("tool_versions"), dict) else {}),
           "findings": candidates}
    save(out, doc, repo, "build")
    C.write_json(repo / CLUSTERS_REL, sidecar)
    merge_dir = repo / MERGE_DIR_REL
    code = EXIT_OK
    print("raw candidates: {} clustered, {} dismissed; {} candidates".format(
        len(seen), len(dismissed), len(candidates)))
    for lens in sorted(maps):
        if lens == TOOL_LENS:
            print("NOTE: {}: project-tool reconciled from triage, DT-12/DT-16 (no ledger map)"
                  .format(lens))
            continue
        path = merge_dir / "{}.json".format(lens)
        C.write_json(path, maps[lens])
        cmd = [sys.executable, str(_HERE / "ledger.py"), "merge", "--lens", lens, "--map",
               str(path), "--replace", "--repo", str(repo)]
        if args.no_merge:
            print("merge: {}".format(" ".join('"{}"'.format(C.to_posix(p)) if " " in p
                                               else C.to_posix(p) for p in cmd)))
            continue
        proc = subprocess.run(cmd, cwd=str(repo), stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, env=C.git_env(), check=False)
        text = proc.stdout.decode("utf-8", errors="replace").strip()
        print("ledger.py merge --lens {}: exit {}{}".format(
            lens, proc.returncode, (": " + text.splitlines()[-1]) if text else ""))
        if proc.returncode != 0:
            code = EXIT_REFUSED
    if code:
        print("ERROR a ledger.py merge failed: the candidates are written and valid, the "
              "ledger is not; fix the ledger and run the printed merge again")
    return code


# ---------------------------------------------------------------------------
# verifier-task
# ---------------------------------------------------------------------------


def test_gate_commands(repo: Path) -> List[str]:
    """The commands of the gates whose inferred category is test (profile-inference.json),
    else of the gates that count tests and are no ratchet."""
    config = load_optional(repo / HARDEN / "config.json")
    gates = [g for g in (config or {}).get("gates") or [] if isinstance(g, dict)] \
        if isinstance(config, dict) else []
    inference = load_optional(repo / HARDEN / "profile-inference.json")
    categories: Dict[str, str] = {}
    for cand in (inference or {}).get("candidates") or [] if isinstance(inference, dict) else []:
        if isinstance(cand, dict) and cand.get("gate") and cand.get("category"):
            categories[str(cand["gate"])] = str(cand["category"])
    out: List[str] = []
    for gate in gates:
        name = str(gate.get("name") or "")
        category = categories.get(name) or gate.get("category")
        if category == "test" or (category is None and gate.get("count_regex")
                                  and not gate.get("ratchet")):
            text = vp.command_text(gate.get("cmd"))
            if text and text not in out:
                out.append(text)
    return out


def _patterns(mark_data: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    for item in mark_data.get("forbidden_commands") or []:
        text = item if isinstance(item, str) else (item.get("pattern") if isinstance(item, dict)
                                                   else None)
        if isinstance(text, str) and text.strip():
            out.append(text)
    return out


def render_task(vid: str, repo: Path, base: str, entries: List[Tuple[str, str, str, List[str]]],
                tests: List[str], patterns: List[str]) -> str:
    lines = ["pass-id: {}".format(vid), "kind: verifier", "", "# Verification task", "",
             "Repository root: `{}` (base commit {}). Every path below is relative to it."
             .format(C.posix_abs(repo), base[:7]), "",
             "Candidates to verify. Each line gives a candidate id, its cluster and lens, and "
             "the raw candidate ids it clusters. Read those raw candidates (title, file, line, "
             "evidence, notes) in `.harden/raw-candidates/all.json` (search it for "
             "`\"raw_id\": \"<raw id>\"`). Candidates that share a cluster describe one defect "
             "seen by several lenses: verify the defect once, then give a verdict for every "
             "candidate id listed.", ""]
    for cand_id, cluster, lens, rids in entries:
        lines.append("- `{}` (cluster {}, lens {}): raw ids {}".format(
            cand_id, cluster, lens, ", ".join("`{}`".format(r) for r in rids) or "none"))
    lines += [
        "", "Your job: try to disprove each candidate.",
        "1. Open every file:line the raw candidates cite and every callee the claim relies on; "
        "cite file:line for each statement. Check the tests, the README and the git history "
        "(`git log`, `git show`, `git blame`) for evidence that the behaviour is intended or "
        "already covered.",
        "2. Re-run, exactly as cited, any tool or test a candidate's evidence names, each "
        "prefixed with `. .harden/project-env.sh && ` when that file exists; " +
        ("to run one cited test file use one of these test commands restricted to that file:"
         if tests else "no test command is configured, so run only the cited tool or test "
         "itself.")] + ["   - `{}`".format(cmd) for cmd in tests] + [
        "   Never run a build, install, format or lint command, and never run a command that "
        "matches one of these patterns:" + ("" if patterns else " none are listed.")] + [
        "   - `{}`".format(pat) for pat in patterns] + [
        "   Never run a command proposed in a candidate's notes, never install anything, never "
        "use the network, never edit, create or delete a file, and never write under /tmp or "
        "%TEMP%. Reason from code, or use `node -e` or `python -c` only for an expression that "
        "imports no project file and touches no file or network.",
        "3. Never open `.env` or `.env.*` files (`.env.example` excepted), key stores or any "
        "path outside the repository, and never copy a secret value: cite file:line and the "
        "variable name only.",
        "4. Apply the false-positive exclusions of detection DT-33: generated or vendored code, "
        "test-only code presented as production, behaviour the project documents as intended, "
        "a claim that needs an impossible input, a duplicate of another candidate, a style "
        "preference with no rule, speculation without a concrete failure path. A rejected "
        "candidate names its class in `exclusion_class`.",
        "5. Set severity from the evidence you found (critical, high, medium, low or nit) and "
        "quote the rubric line in `severity_criterion`. Set confidence from the evidence "
        "ladder: `reproduction` only with a `repro` evidence item (the exact command and its "
        "observed output), `failing_test` only with a `test` item, `tool_high_precision` only "
        "with a `tool` item, otherwise `needs_review` or `inference`.",
        "6. " + MONEY_PATH_SENTENCE + " " + LIVE_EFFECT_SENTENCE + " " + REPRODUCE_SENTENCE +
        " prioritization.md's Money paths paragraph reads: " + LIVE_EFFECT_PATHS,
        "",
        "Final message: line 1 exactly `pass-id: {}`, with nothing before it (no sentence, "
        "summary, heading, blank line or code fence), then exactly one JSON object and "
        "nothing after it. A candidate you could not finish gets `\"verified\": null` and "
        "the verifier_note `not examined: turn budget`:".format(vid), "",
        '{{"pass_id": "{}", "verdicts": ['.format(vid),
        '  {"id": "<candidate id>", "verified": true, "exclusion_class": null,',
        '   "severity": "medium", "severity_criterion": "...", "confidence": "inference",',
        '   "class": "behavioural", "fix": "one sentence: the smallest fix",',
        '   "evidence": [{"kind": "source", "ref": "src/x.ts:12", "detail": "..."}],',
        '   "verifier_note": "why it holds or fails ...\\nmoney-path: no\\nlive-effect: none"}',
        "]}", "",
        "One verdict object per candidate id listed above, in that order. `verified` false "
        "means disproved or not a defect (give the reason and `exclusion_class`); `class` is "
        "structural (behaviour identical), behavioural (observable behaviour changes) or "
        "report-only (no unattended change: secrets, public API breaks, owner decisions).", ""]
    return "\n".join(lines)


def load_sidecar(repo: Path) -> Dict[str, Dict[str, Any]]:
    data = load(repo / CLUSTERS_REL, "candidate-clusters.json (run findings.py build first)")
    if not isinstance(data, dict):
        raise Usage("candidate-clusters.json is not a JSON object")
    return {k: v for k, v in data.items() if k != DISMISSED_KEY and isinstance(v, dict)}


def assignments(repo: Path) -> Dict[str, Tuple[str, str]]:
    """candidate id -> (verifier id, at) of the latest task that lists it."""
    out: Dict[str, Tuple[str, str]] = {}
    prompts = repo / HARDEN / "prompts"
    rows: List[Tuple[str, str, List[str]]] = []
    for path in sorted(prompts.glob("*.ids.json")) if prompts.is_dir() else []:
        data = load_optional(path)
        if isinstance(data, dict) and isinstance(data.get("ids"), list):
            rows.append((str(data.get("at") or ""), str(data.get("verifier") or
                                                         path.name[:-len(".ids.json")]),
                         [str(i) for i in data["ids"]]))
    for at, vid, ids in sorted(rows):
        for cid in ids:
            out[cid] = (vid, at)
    return out


def cmd_verifier_task(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    vid = args.vid
    if not ID_RE.match(vid) or vid.lower().startswith("probe"):
        raise Usage("verifier id {!r} must match {} and must not start with 'probe' (the "
                    "canary's)".format(vid, ID_RE.pattern))
    sidecar = load_sidecar(repo)
    wanted = list(args.ids)
    if not wanted:
        plan = load(repo / VERIFY_PLAN_REL, "verify-plan.json (give the ids, or run budget.py "
                    "verify-plan)")
        tasks = [t for t in (plan or {}).get("tasks") or [] if isinstance(t, dict)
                 and t.get("id") == vid] if isinstance(plan, dict) else []
        if not tasks:
            raise Usage("task {} is not in {}; give the candidate ids".format(vid,
                                                                             VERIFY_PLAN_REL))
        wanted = [str(c) for c in tasks[0].get("candidates") or []]
    ids: List[str] = []
    unknown: List[str] = []
    for item in wanted:
        members = [cid for cid, info in sidecar.items() if info.get("cluster") == item]
        if not members and item in sidecar:
            members = [item]
        if not members:
            unknown.append(item)
        for cid in members:
            if cid not in ids:
                ids.append(cid)
    if unknown:
        raise Refused(["unknown ids: " + ", ".join(unknown)])
    taken = assignments(repo)
    clash = ["{} ({})".format(cid, taken[cid][0]) for cid in ids
             if cid in taken and taken[cid][0] != vid]
    if clash and not args.reassign:
        raise Refused(["already in another verifier task (use --reassign to move them): " +
                       ", ".join(clash)])
    mark_data = marker(repo)
    cands = load_optional(repo / CANDIDATES_REL)
    base = str(mark_data.get("base_sha") or (cands or {}).get("base_sha") or
               C.head_sha(repo) or "")
    entries = [(cid, str(sidecar[cid].get("cluster")), str(sidecar[cid].get("lens")),
                [str(r) for r in sidecar[cid].get("raw_ids") or []]) for cid in ids]
    text = render_task(vid, repo, base, entries, test_gate_commands(repo), _patterns(mark_data))
    prompts = repo / HARDEN / "prompts"
    prompts.mkdir(parents=True, exist_ok=True)
    task = prompts / "{}.md".format(vid)
    with open(task, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    C.write_json(prompts / "{}.ids.json".format(vid),
                 {"verifier": vid, "ids": ids, "at": C.utc_iso()})
    print("pass-id: {}".format(vid))
    print("Task file: {}. Read it first and follow it exactly.".format(C.posix_abs(task)))
    return EXIT_OK


# ---------------------------------------------------------------------------
# assemble
# ---------------------------------------------------------------------------


def parse_verdicts(path_md: Path, vid: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """The verdict object of a verifier report: after the last `pass-id: <vid>` line (a
    preface before it is tolerated), else at the first `{"pass_id": "<vid>"`."""
    try:
        text = path_md.read_bytes().decode("utf-8-sig", errors="replace")
    except OSError as exc:
        return None, "cannot read {}: {}".format(path_md.name, exc)
    decoder = json.JSONDecoder()
    pattern = re.compile(r"^[ \t]*pass-id:[ \t]*" + re.escape(vid) + r"[ \t]*\r?$", re.M)
    starts = [m.end() for m in pattern.finditer(text)]
    reason = "no `pass-id: {}` line and no object with that pass_id".format(vid)
    candidates: List[int] = []
    if starts:
        brace = text.find("{", starts[-1])
        if brace >= 0:
            candidates.append(brace)
    match = re.search(r'\{\s*"pass_id"\s*:\s*"' + re.escape(vid) + '"', text)
    if match:
        candidates.append(match.start())
    for pos in candidates:
        try:
            obj, _end = decoder.raw_decode(text, pos)
        except ValueError as exc:
            reason = "malformed JSON ({})".format(str(exc).splitlines()[0])
            continue
        if isinstance(obj, dict):
            return obj, None
        reason = "the JSON is not an object"
    return None, reason


def load_verifier(repo: Path, vid: str) -> Tuple[Optional[List[Any]], Optional[str]]:
    vdir = repo / HARDEN / "verifiers"
    result = load_optional(vdir / "{}.result.json".format(vid))
    if isinstance(result, dict) and isinstance(result.get("verdicts"), list):
        return result["verdicts"], None
    if not (vdir / "{}.md".format(vid)).is_file():
        return None, "no saved report"
    obj, reason = parse_verdicts(vdir / "{}.md".format(vid), vid)
    if obj is None:
        return None, reason
    if obj.get("pass_id") not in (None, vid):
        return None, "its object carries pass_id {!r}".format(obj.get("pass_id"))
    if not isinstance(obj.get("verdicts"), list):
        return None, "its object has no verdicts list"
    return obj["verdicts"], None


def verdict_problem(v: Dict[str, Any]) -> Optional[str]:
    """`<field>=<value>` of the first field outside the schema, or None."""
    if "verified" in v and v["verified"] is not None and not isinstance(v["verified"], bool):
        return "verified={}".format(json.dumps(v["verified"]))
    for fld, allowed in (("severity", vf.SEVERITIES), ("confidence", vf.CONFIDENCES),
                         ("class", vf.CLASSES)):
        if v.get(fld) is not None and v.get(fld) not in allowed:
            return "{}={}".format(fld, v.get(fld))
    ev = v.get("evidence")
    if ev is not None:
        if not isinstance(ev, list):
            return "evidence={}".format(json.dumps(ev)[:60])
        for item in ev:
            if not isinstance(item, dict) or item.get("kind") not in vf.EVIDENCE_KINDS or \
                    not isinstance(item.get("ref"), str) or not isinstance(item.get("detail"),
                                                                           str):
                return "evidence={}".format(json.dumps(item, ensure_ascii=False)[:60])
    for fld in ("severity_criterion", "verifier_note", "fix", "exclusion_class"):
        if v.get(fld) is not None and not isinstance(v.get(fld), str):
            return "{}={}".format(fld, json.dumps(v.get(fld))[:60])
    return None


def verifier_ids(repo: Path, given: Sequence[str]) -> List[str]:
    if given:
        return list(given)
    vdir = repo / HARDEN / "verifiers"
    out: List[str] = []
    names = sorted(p.name for p in vdir.iterdir()) if vdir.is_dir() else []
    for name in names:
        if name.endswith(".result.json"):
            stem = name[:-len(".result.json")]
        elif name.endswith(".md"):
            stem = name[:-3]
        else:
            continue
        if stem.lower().startswith("probe") or VERIFIER_STEM_RE.search(stem) or \
                not ID_RE.match(stem) or stem in out:
            continue
        out.append(stem)
    return out


class Verdicts:
    """Each candidate's verdict across verifiers, taken in task order: a later valid verdict
    wins; a null verdict ("verified": null, the turn budget), an unparsable output or an
    invalid verdict never replaces a valid one, and the latest of them gives the deferral
    note of a candidate that has none."""

    def __init__(self) -> None:
        self.valid: Dict[str, Tuple[str, Dict[str, Any]]] = {}
        self.pending: Dict[str, str] = {}

    def add(self, vid: str, verdict: Dict[str, Any]) -> None:
        cid = str(verdict.get("id"))
        if verdict.get("verified") is None:
            self.pending[cid] = TURN_BUDGET_NOTE
        else:
            self.valid[cid] = (vid, verdict)

    def fail(self, cid: str, note: str) -> None:
        self.pending[cid] = note


def task_times(repo: Path) -> Dict[str, str]:
    """verifier id -> the `at` of its .ids.json."""
    prompts = repo / HARDEN / "prompts"
    out: Dict[str, str] = {}
    for path in sorted(prompts.glob("*.ids.json")) if prompts.is_dir() else []:
        data = load_optional(path)
        if isinstance(data, dict):
            out[str(data.get("verifier") or path.name[:-len(".ids.json")])] = \
                str(data.get("at") or "")
    return out


def collect_verdicts(repo: Path, vids: List[str], known: Set[str]) -> Verdicts:
    taken = assignments(repo)
    at = task_times(repo)
    out = Verdicts()
    for vid in sorted(vids, key=lambda v: (at.get(v, ""), v)):
        verdicts, reason = load_verifier(repo, vid)
        assigned = [cid for cid, (v, _a) in taken.items() if v == vid]
        if verdicts is None:
            if reason == "no saved report":
                continue
            print("WARN verifier {} output unparsable ({}); its candidates are deferred"
                  .format(vid, reason))
            for cid in assigned:
                out.fail(cid, "not verified: verifier {} output unparsable ({}); relaunch "
                              "with findings.py verifier-task --reassign".format(vid, reason))
            continue
        for raw in verdicts:
            if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
                print("WARN verifier {}: a verdict without an id is ignored".format(vid))
                continue
            verdict = sanitise(raw, raw["id"], "verdict")
            if verdict["id"] not in known:
                print("WARN verifier {}: {} is no candidate; ignored".format(vid, verdict["id"]))
                continue
            problem = verdict_problem(verdict)
            if problem:
                print("WARN verifier {} gave {} an invalid verdict ({}); it is deferred"
                      .format(vid, verdict["id"], problem))
                out.fail(verdict["id"], "not verified: verifier {} gave an invalid verdict "
                                        "({}); relaunch with findings.py verifier-task "
                                        "--reassign".format(vid, problem))
                continue
            out.add(vid, verdict)
    return out


def load_orchestrator_evidence(path: Optional[str], repo: Path) -> Dict[str, List[Dict[str, Any]]]:
    if not path:
        return {}
    data = load(Path(path) if os.path.isabs(path) else repo / path, "--evidence")
    if not isinstance(data, dict):
        raise Usage("--evidence must be a JSON object {\"<id or cluster id>\": [items]}")
    out: Dict[str, List[Dict[str, Any]]] = {}
    for key, items in sanitise(data, "evidence").items():
        if not isinstance(items, list):
            raise Usage("--evidence: {} must hold a list of evidence items".format(key))
        out[str(key)] = [i for i in items if isinstance(i, dict)]
    return out


def apply_tier_rules(f: Dict[str, Any]) -> None:
    """DT-27, PZ-24 step 2 and G204-F04, as validate_findings checks them."""
    tier, conf = f.get("tier"), f.get("confidence")
    if f.get("class") == "report-only" and tier != "T2":
        add_note(f, "tier {} -> T2: class report-only".format(tier))
        f["tier"] = "T2"
    elif tier in ("T0", "T1") and conf in vf.WEAK_CONFIDENCES:
        add_note(f, "tier {} -> T2 by DT-27: confidence {} (proposed tier {})".format(
            tier, conf, tier))
        f["tier"] = "T2"
    if f.get("tier") == "T0" and f.get("class") != "structural":
        add_note(f, "tier T0 -> T1: class {}".format(f.get("class")))
        f["tier"] = "T1"
    if f.get("status") == "verified" and f.get("severity") in ("critical", "high") and \
            conf not in vf.PROOF_CONFIDENCES:
        f["status"] = "deferred"
        add_note(f, "deferred: {} severity at confidence {} is never presented as established "
                    "(G204-F04)".format(f.get("severity"), conf))


def raise_confidence(repo: Path, f: Dict[str, Any], items: List[Dict[str, Any]]) -> None:
    """Orchestrator evidence raises a weak confidence (needs_review, inference) to the rung
    of its kind only when it names a saved, non-empty output (DT-27)."""
    best: Optional[Tuple[int, str, str, str]] = None
    for item in items:
        kind = item.get("kind")
        if kind not in KIND_PROOF:
            continue
        path = saved_output(repo, item)
        if path is None:
            print("WARN {} evidence {} {}: names no saved, non-empty output (a file under "
                  ".harden/tools/ or a .harden/gates/repro-*.json record); confidence not "
                  "raised".format(f.get("id"), kind, str(item.get("ref"))[:80]))
            continue
        rung = KIND_PROOF[str(kind)]
        if best is None or CONF[rung] < best[0]:
            best = (CONF[rung], rung, str(kind), path)
    current = str(f.get("confidence"))
    if best is not None and current in vf.WEAK_CONFIDENCES:
        add_note(f, "confidence {} -> {} by orchestrator {} evidence {} (DT-27)".format(
            current, best[1], best[2], best[3]))
        f["confidence"] = best[1]


def ensure_proof(f: Dict[str, Any], primary: Optional[Dict[str, Any]]) -> None:
    """A proof rung needs its evidence kind: borrow it from the cluster primary, else lower
    the rung to needs_review (never invented; G204-F03)."""
    rung = f.get("confidence")
    kind = PROOF_KIND.get(str(rung))
    if kind is None or any(e.get("kind") == kind for e in f.get("evidence") or []):
        return
    items = [e for e in (primary or {}).get("evidence") or [] if e.get("kind") == kind]
    if items and primary is not None:
        f["evidence"] = merge_evidence(f.get("evidence") or [], items)
        add_note(f, "{} evidence borrowed from cluster primary {} (same defect)".format(
            kind, primary.get("id")))
        return
    add_note(f, "confidence {} -> needs_review: no {} evidence item (G204-F03)".format(rung,
                                                                                       kind))
    f["confidence"] = "needs_review"


def assemble_one(repo: Path, cand: Dict[str, Any], vid: str, verdict: Dict[str, Any],
                 evidence: List[Dict[str, Any]], borrowed_from: Optional[str]) -> Dict[str, Any]:
    f = dict(cand)
    f["verifier_id"] = vid
    if borrowed_from:
        add_note(f, "verdict borrowed from cluster primary {} (same defect, verifier {})"
                 .format(borrowed_from, vid))
    note = str(verdict.get("verifier_note") or "").strip()
    if verdict.get("verified") is False:
        f.update(status="rejected", verified=False, verifier_note=note or "rejected by the "
                 "verifier", exclusion_class=verdict.get("exclusion_class"))
        return f
    f.update(status="verified", verified=True, verifier_note=note)
    f.pop("exclusion_class", None)
    for fld in ("severity", "severity_criterion", "confidence", "class"):
        if verdict.get(fld) is not None:
            f[fld] = verdict[fld]
    f["evidence"] = merge_evidence(verdict.get("evidence") or [], evidence,
                                   cand.get("evidence") or [])
    if str(verdict.get("fix") or "").strip():
        add_note(f, "Verifier fix ({}): {}".format(vid, " ".join(str(verdict["fix"]).split())))
    for key in ("money-path", "live-effect"):
        line = last_line(note, key)
        add_note(f, line if line else "{} judgement pending (verifier note has no line)"
                 .format(key))
    raise_confidence(repo, f, evidence)
    return f


def deferred(cand: Dict[str, Any], note: str) -> Dict[str, Any]:
    f = dict(cand)
    f.update(status="deferred", verified=False)
    add_note(f, note)
    return f


def cmd_assemble(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    cand_path = Path(args.candidates) if args.candidates and os.path.isabs(args.candidates) \
        else repo / (args.candidates or CANDIDATES_REL)
    cdoc = load(cand_path, "candidates")
    if not isinstance(cdoc, dict) or not isinstance(cdoc.get("findings"), list):
        raise Usage("{} has no findings list".format(cand_path.name))
    cands = [c for c in cdoc["findings"] if isinstance(c, dict)]
    by_id = {str(c.get("id")): c for c in cands}
    sidecar = load_optional(repo / CLUSTERS_REL)
    cluster_of = {k: str(v.get("cluster")) for k, v in (sidecar or {}).items()
                  if isinstance(v, dict) and k != DISMISSED_KEY} if isinstance(sidecar,
                                                                                 dict) else {}
    out_path = Path(args.out) if args.out and os.path.isabs(args.out) else \
        repo / (args.out or FINDINGS_REL)
    existing = load_optional(out_path)
    kept: Dict[str, Dict[str, Any]] = {}
    for f in (existing or {}).get("findings") or [] if isinstance(existing, dict) else []:
        if not isinstance(f, dict):
            continue
        status = f.get("status")
        if status != "candidate" and not (status == "deferred" and f.get("verified") is not True):
            kept[str(f.get("id"))] = f
    evidence = load_orchestrator_evidence(args.evidence, repo)
    verdicts = collect_verdicts(repo, verifier_ids(repo, args.vids), set(by_id))
    taken = assignments(repo)
    done: Dict[str, Dict[str, Any]] = {}
    # Cluster primaries first, so an alias can borrow their verdict and proof.
    order = sorted(cands, key=lambda c: 0 if cluster_of.get(str(c.get("id")),
                                                             str(c.get("id"))) == c.get("id")
                   else 1)
    for cand in order:
        cid = str(cand.get("id"))
        if cid in kept:
            continue
        primary_id = cluster_of.get(cid, cid)
        items = evidence.get(cid, []) + (evidence.get(primary_id, []) if primary_id != cid
                                         else [])
        own = verdicts.valid.get(cid)
        borrowed = None
        if own is None and primary_id != cid and primary_id in verdicts.valid:
            own, borrowed = verdicts.valid[primary_id], primary_id
        if own is not None:
            f = assemble_one(repo, cand, own[0], own[1], items, borrowed)
            if f["status"] == "verified":
                ensure_proof(f, done.get(primary_id) if primary_id != cid else None)
                apply_tier_rules(f)
        elif cid in verdicts.pending:
            f = deferred(cand, verdicts.pending[cid])
        elif cid in taken:
            f = deferred(cand, "not verified: verifier {} returned no verdict".format(
                taken[cid][0]))
        else:
            f = deferred(cand, BUDGET_NOTE)
        done[cid] = f
    findings = [done.get(str(c.get("id"))) or kept[str(c.get("id"))] for c in cands]
    findings += [f for fid, f in kept.items() if fid not in by_id]
    doc = {"version": 1, "base_sha": cdoc.get("base_sha"), "generated": C.utc_iso(),
           "tool_versions": cdoc.get("tool_versions") if isinstance(cdoc.get("tool_versions"),
                                                                    dict) else {},
           "findings": findings}
    save(out_path, doc, repo, "assemble")
    counts: Dict[str, int] = {}
    for f in findings:
        counts[str(f.get("status"))] = counts.get(str(f.get("status")), 0) + 1
    if args.json:
        print(json.dumps({"written": C.to_posix(os.path.relpath(str(out_path), str(repo))),
                          "by_status": counts, "kept": sorted(kept)}, indent=2))
    else:
        print("by status: " + ", ".join("{} {}".format(k, v) for k, v in sorted(counts.items())))
    return EXIT_OK


# ---------------------------------------------------------------------------
# approvals
# ---------------------------------------------------------------------------


def _stored_rows(text: str) -> Dict[str, Dict[str, str]]:
    return {r["category"].strip().strip("`*\"'"): r for r in vf.parse_approvals(text)}


def _tail_after_table(text: str) -> str:
    """Text after the approvals table (such as RP-20 counts), kept on a re-render."""
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.strip().startswith("|")), None)
    if start is None:
        return ""
    end = start
    while end < len(lines) and lines[end].strip().startswith("|"):
        end += 1
    tail = "\n".join(lines[end:]).strip("\n")
    return ("\n" + tail + "\n") if tail.strip() else ""


def needed_switches(f: Dict[str, Any], decision: Dict[str, Any], ctx: "vf.ApprovalContext"
                    ) -> List[str]:
    if f.get("tier") == "T0":
        return []
    need = list(vf.expected_switches(f))
    money = last_line(f.get("notes"), "money-path") or ""
    word = MONEY_LINE_RE.match(money)
    on_money = bool(word and word.group(1).lower().rstrip(":,") in ("yes", "floor")) or \
        ctx.money_pattern(f) is not None
    if on_money and decision.get("ast_identical") is not True:
        need.append("money_paths")
    kinds = set((decision.get("review") or f.get("review") or {}).get("kinds") or [])
    if f.get("tier") == "T2" or kinds & vf.LANE_REVIEW_KINDS:
        need.append("owner_judgement")
    return list(dict.fromkeys(need))


def _apply_refusals(f: Dict[str, Any], decision: Dict[str, Any]) -> List[str]:
    fid = str(f.get("id"))
    notes = str(f.get("notes") or "")
    out: List[str] = []
    if vf.LIVE_EFFECT_KIND_RE.search(notes):
        out.append("{}: its notes record a live-effect path, which autonomous mode never "
                   "applies (user-policy-autonomy U01-F12)".format(fid))
    elif not LIVE_LINE_RE.search(notes):
        out.append("{}: record the live-effect judgement first: findings.py mark {} --note "
                   "\"live-effect: none (<why>)\"".format(fid, fid))
    if f.get("class") == "report-only":
        out.append("{}: class report-only is never applied".format(fid))
    if f.get("tier") in ("T0", "T1") and f.get("confidence") in vf.WEAK_CONFIDENCES:
        out.append("{}: {} at confidence {} is T2 by DT-27".format(fid, f.get("tier"),
                                                                  f.get("confidence")))
    kinds = (decision.get("review") or f.get("review") or {}).get("kinds") or []
    if f.get("tier") == "T2" and "owner-judgement" not in kinds:
        out.append("{}: a T2 item is applied only by the owner-judgement lane: give a review "
                   "whose kinds hold owner-judgement".format(fid))
    return out


def cmd_approvals(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    hdir = repo / HARDEN
    mode = vf._run_mode(hdir)
    if mode is None:
        raise Usage("no active run: .harden/active is missing or unreadable")
    if mode in vf.INTERACTIVE_MODES:
        raise Usage("an --interactive run quotes the user's live answer in each row; "
                    "findings.py approvals serves autonomous runs only")
    if mode == "report-only":
        raise Usage("a report-only run approves nothing")
    fpath = repo / FINDINGS_REL
    doc = load(fpath, "findings.json")
    profile = load(hdir / "profile.json", "profile.json")
    if not isinstance(doc, dict) or not isinstance(doc.get("findings"), list):
        raise Usage("findings.json has no findings list")
    switches = profile.get("auto_apply") if isinstance(profile, dict) and \
        isinstance(profile.get("auto_apply"), dict) else {}
    dpath = Path(args.decisions) if args.decisions and os.path.isabs(args.decisions) else \
        repo / (args.decisions or DECISIONS_REL)
    ddata = load(dpath, "decisions.json")
    decisions = decision_list(ddata)
    findings = {str(f.get("id")): f for f in doc["findings"] if isinstance(f, dict)}
    problems: List[str] = []
    ids = [str(d.get("id")) for d in decisions]
    for problem in (_listing("decisions for unknown ids", [i for i in ids if i not in findings]),
                    _listing("ids with more than one decision",
                             [i for i in ids if ids.count(i) > 1]),
                    _listing("verified or approved findings without a decision",
                             [fid for fid, f in findings.items()
                              if f.get("status") in ("verified", "approved")
                              and fid not in ids])):
        if problem:
            problems.append(problem)
    if problems:
        raise Refused(problems)
    ctx = vf.ApprovalContext.load(hdir)
    old_text_bytes = (hdir / "approvals.md").read_bytes() if (hdir / "approvals.md").is_file() \
        else None
    stored = _stored_rows(old_text_bytes.decode("utf-8-sig", errors="replace")
                          if old_text_bytes else "")
    now = C.utc_iso()
    rows: List[str] = []
    times: Dict[str, str] = {}
    narrowed: List[str] = []
    for d in decisions:
        fid = str(d["id"])
        f = findings[fid]
        at = str(d.get("at") or now)
        if f.get("status") in PAST_APPROVED:
            row = stored.get(fid)
            if row is None:
                print("WARN {}: status {} and no stored row; no row written".format(
                    fid, f.get("status")))
                continue
            rows.append("| {} | {} | {} | {} | {} |".format(
                fid, row["decision"], row["count"], row["quote"], row["time"]))
            times[fid] = str(d.get("at") or row["time"])
            continue
        if f.get("status") not in ("verified", "approved"):
            problems.append("{}: status {} takes no decision (only verified or approved "
                            "findings do)".format(fid, f.get("status")))
            continue
        tier = d.get("tier") or f.get("tier")
        klass = d.get("class") or f.get("class")
        if tier == "T0" and klass != "structural":
            problems.append("{}: a T0 decision needs class structural, not {}".format(fid,
                                                                                    klass))
            continue
        if d.get("tier"):
            f["tier"] = d["tier"]
        if d.get("class"):
            f["class"] = d["class"]
        rule = str(d.get("rule") or "").strip()
        reason = " ".join(str(d.get("reason") or "").split())
        if rule or reason:
            add_note(f, "PZ-24: {}: {}".format(rule or "-", reason or "-"))
        retier = d.get("retier") if isinstance(d.get("retier"), dict) else None
        if retier and retier.get("tier"):
            f["tier"] = retier["tier"]
        prefix = "re-tiered to {} by {}, ".format(retier.get("tier"), retier.get("rule")) \
            if retier and retier.get("tier") else ""
        choice = d.get("decision")
        if choice == "apply":
            refusals = _apply_refusals(f, d)
            if refusals:
                problems += refusals
                continue
            need = needed_switches(f, d, ctx)
            false = [s for s in need if switches.get(s) is not True]
            if not false:
                if isinstance(d.get("review"), dict):
                    f["review"] = d["review"]
                if f.get("tier") == "T0":
                    quote = "auto (profile): {}T0".format(prefix)
                elif f.get("tier") == "T2":
                    quote = "auto (profile): {}owner judgement, T2 by {}, {}".format(
                        prefix, rule or "-", ", ".join(
                            "auto_apply.{}=true".format(s) for s in
                            ["owner_judgement"] + [s for s in need if s != "owner_judgement"]))
                    f["status"] = "approved"
                else:
                    quote = "auto (profile): {}{}".format(prefix, ", ".join(
                        "auto_apply.{}=true".format(s) for s in need))
                    f["status"] = "approved"
                rows.append("| {} | accepted | 1 | {} | {} |".format(fid, cell(quote), at))
            else:
                if f.get("tier") == "T2" and switches.get("owner_judgement") is not True:
                    quote = "auto (profile): {}T2".format(prefix)
                else:
                    quote = "auto (profile): {}auto_apply.{}=false, not applied".format(
                        prefix, false[0])
                f["status"] = "reported"
                narrowed.append(fid)
                rows.append("| {} | report-only | 1 | {} | {} |".format(fid, cell(quote), at))
        elif choice == "report":
            if not reason:
                problems.append("{}: a report decision needs a reason".format(fid))
                continue
            if f.get("tier") == "T2" and switches.get("owner_judgement") is True:
                letter = LANE_LETTER_RE.search(reason)
                if not letter:
                    problems.append("{}: a T2 item the lane does not apply names its step: the "
                                    "reason must contain `owner-judgement lane 1(<a-j>)` "
                                    "(protocol-change step 3)".format(fid))
                    continue
                quote = "auto (profile): {}T2 by {}, not applied: {}".format(
                    prefix, rule or "-", letter.group(0))
            elif f.get("tier") == "T2":
                quote = "auto (profile): {}T2".format(prefix)
            else:
                quote = "auto (profile): {}{}".format(prefix, reason)
            f["status"] = "reported"
            rows.append("| {} | report-only | 1 | {} | {} |".format(fid, cell(quote), at))
        else:
            problems.append("{}: decision must be apply or report, not {!r}".format(fid,
                                                                                   choice))
            continue
        times[fid] = at
    if problems:
        raise Refused(problems)
    old_tail = _tail_after_table(old_text_bytes.decode("utf-8-sig", errors="replace")) \
        if old_text_bytes else ""
    text = APPROVALS_HEAD + "\n".join(rows) + ("\n" if rows else "") + old_tail
    apath = hdir / "approvals.md"
    with open(apath, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    try:
        save(fpath, doc, repo, "approvals")
    except BaseException:
        if old_text_bytes is None:
            apath.unlink()
        else:
            apath.write_bytes(old_text_bytes)
        raise
    changed = False
    for d in decisions:
        fid = str(d.get("id"))
        if fid in times and d.get("at") != times[fid]:
            d["at"] = times[fid]
            changed = True
    if changed:
        C.write_json(dpath, {"version": 1, "decisions": decisions}
                     if not (isinstance(ddata, dict) and isinstance(ddata.get("decisions"),
                                                                    list))
                     else dict(ddata, decisions=decisions))
    if args.json:
        print(json.dumps({"rows": len(rows), "narrowed": narrowed}, indent=2))
    else:
        print("approvals: {} rows{}".format(len(rows), "; narrowed to report-only: " +
                                            ", ".join(narrowed) if narrowed else ""))
    return EXIT_OK


# ---------------------------------------------------------------------------
# mark
# ---------------------------------------------------------------------------


def _set_value(raw: str) -> Tuple[str, Any]:
    if "=" not in raw:
        raise Usage("--set takes FIELD=VALUE, not {!r}".format(raw))
    fld, value = raw.split("=", 1)
    fld = fld.strip()
    if fld not in SET_FIELDS:
        where = SET_ELSEWHERE.get(fld)
        raise Usage("--set {} is not allowed{}; allowed: {}".format(
            fld, " (use {})".format(where) if where else "", ", ".join(SET_FIELDS)))
    try:
        parsed: Any = json.loads(value)
        if not isinstance(parsed, (bool, int, type(None))):
            parsed = value
    except ValueError:
        parsed = value
    return fld, parsed


def _confidence_raise_problem(repo: Path, f: Dict[str, Any], new: Any,
                              added_tests: bool) -> Optional[str]:
    old = str(f.get("confidence"))
    if new not in vf.PROOF_CONFIDENCES or CONF.get(str(new), 9) >= CONF.get(old, 9):
        return None
    kind = PROOF_KIND[str(new)]
    if new == "failing_test" and added_tests:
        return None
    for item in f.get("evidence") or []:
        if isinstance(item, dict) and item.get("kind") == kind and saved_output(repo, item):
            return None
    return ("{}: confidence {} -> {} needs a {} evidence item whose ref or detail names a "
            "saved, non-empty output under .harden/tools/ or a .harden/gates/repro-*.json "
            "record{}".format(f.get("id"), old, new, kind, " (or --test)"
                              if new == "failing_test" else ""))


def cmd_mark(args: argparse.Namespace) -> int:
    repo = repo_root(args.repo)
    fpath = repo / FINDINGS_REL
    doc = load(fpath, "findings.json")
    if not isinstance(doc, dict) or not isinstance(doc.get("findings"), list):
        raise Usage("findings.json has no findings list")
    by_id = {str(f.get("id")): f for f in doc["findings"] if isinstance(f, dict)}
    unknown = [i for i in args.ids if i not in by_id]
    if unknown:
        raise Usage("unknown finding ids: " + ", ".join(unknown))
    if args.test and not args.test_detail:
        raise Usage("--test needs --test-detail (red at the parent, green at the fix)")
    sets = [_set_value(s) for s in args.set or []]
    review: Optional[Dict[str, Any]] = None
    if args.review_kinds or args.review_option:
        if not (args.review_kinds and args.review_option):
            raise Usage("--review-kinds and --review-option go together")
        review = {"kinds": [k.strip() for k in args.review_kinds.split(",") if k.strip()],
                  "option": args.review_option}
        if args.review_alternatives:
            review["alternatives"] = args.review_alternatives
    commit: Optional[str] = None
    if args.commit:
        commit = C.git_ok(repo, ["rev-parse", "--verify", "--quiet",
                                 "{}^{{commit}}".format(args.commit)])
        if not commit:
            raise Usage("--commit {} is no commit of this repository".format(args.commit))
    head7 = (C.head_sha(repo) or "-")[:7]
    auto = (vf._run_mode(repo / HARDEN) or "") == "auto"
    problems: List[str] = []
    for fid in args.ids:
        f = by_id[fid]
        before_status = f.get("status")
        if commit:
            f["commit"] = commit
        if args.test:
            f["evidence"] = merge_evidence(f.get("evidence") or [], [
                {"kind": "test", "ref": args.test, "detail": args.test_detail}])
        for kind, ref, detail in args.evidence or []:
            f["evidence"] = merge_evidence(f.get("evidence") or [], sanitise(
                [{"kind": kind, "ref": ref, "detail": detail}], fid, "evidence"))
        if args.repro_rerun:
            add_note(f, "{}{}: {}".format(REPRO_RERUN_PREFIX, head7,
                                          " ".join(args.repro_rerun.split())))
        if args.note:
            add_note(f, sanitise(args.note, fid, "notes"))
        for fld, value in sets:
            if fld == "confidence":
                problem = _confidence_raise_problem(repo, f, value, bool(args.test))
                if problem:
                    problems.append(problem)
                    continue
            f[fld] = sanitise(value, fid, fld) if isinstance(value, str) else value
        if review is not None:
            f["review"] = review
        status = args.status
        if status:
            if status in ("applied", "partial"):
                if not f.get("commit"):
                    problems.append("{}: {} needs --commit".format(fid, status))
                if f.get("class") == "behavioural" and not any(
                        e.get("kind") == "test" for e in f.get("evidence") or []):
                    problems.append("{}: a behavioural finding is {} only with test evidence: "
                                    "add --test <test id> --test-detail \"<red at the parent, "
                                    "green at the fix>\"".format(fid, status))
                if auto and not LIVE_LINE_RE.search(str(f.get("notes") or "")):
                    problems.append("{}: no live-effect line in notes; record your judgement "
                                    "with --note \"live-effect: none (<why>)\" (this script "
                                    "never writes it)".format(fid))
                if status == "applied" and any(e.get("kind") == "repro" for e in
                                               f.get("evidence") or []) and \
                        REPRO_RERUN_PREFIX not in str(f.get("notes") or ""):
                    problems.append("{}: re-run the headline reproduction at HEAD and record "
                                    "it with --repro-rerun \"<output>\" (RP-16)".format(fid))
            if status in REASON_NEEDED and not args.note and before_status != status:
                problems.append("{}: status {} needs a reason: add --note \"<why>\"".format(
                    fid, status))
            f["status"] = status
    if problems:
        raise Refused(problems)
    save(fpath, doc, repo, "mark", sort=False)
    return EXIT_OK


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="findings.py",
        description="Validated writers of the run's candidates, verifier tasks, findings and "
                    "approvals (pilot-auto-calibration A01-F60).",
        epilog="Exit 0 written; 1 refused (nothing written); 2 usage.")
    sub = parser.add_subparsers(dest="command", required=True)
    b = sub.add_parser("build", help="clusters of raw candidates -> candidates.json")
    b.add_argument("--clusters", required=True, help="[{\"id\", \"key\", \"raw_ids\"}]")
    b.add_argument("--raw", default=None, help="default " + RAW_REL)
    b.add_argument("--extra", default=None, help="[{\"source\", \"finding\"}] appended as is")
    b.add_argument("--dismiss", default=None, help="{\"<raw id>\": \"<reason>\"}")
    b.add_argument("--out", default=None, help="default " + CANDIDATES_REL)
    b.add_argument("--no-merge", action="store_true", help="print the ledger.py merge commands")
    b.add_argument("--repo", default=None)
    v = sub.add_parser("verifier-task", help="write one verifier's task file")
    v.add_argument("vid", help="verifier id (a verify-plan task id)")
    v.add_argument("ids", nargs="*", help="cluster or candidate ids (default: the plan task's)")
    v.add_argument("--reassign", action="store_true",
                   help="move ids another task file lists")
    v.add_argument("--repo", default=None)
    a = sub.add_parser("assemble", help="verdicts -> findings.json")
    a.add_argument("vids", nargs="*", help="verifier ids (default: every saved report)")
    a.add_argument("--evidence", default=None, help="{\"<id>\": [evidence items]}")
    a.add_argument("--candidates", default=None, help="default " + CANDIDATES_REL)
    a.add_argument("--out", default=None, help="default " + FINDINGS_REL)
    a.add_argument("--repo", default=None)
    a.add_argument("--json", action="store_true")
    p = sub.add_parser("approvals", help="decisions.json -> approvals.md and statuses")
    p.add_argument("--decisions", default=None, help="default " + DECISIONS_REL)
    p.add_argument("--repo", default=None)
    p.add_argument("--json", action="store_true")
    m = sub.add_parser("mark", help="record status, commit, evidence and notes")
    m.add_argument("ids", nargs="+")
    m.add_argument("--status", choices=MARK_STATUSES)
    m.add_argument("--commit")
    m.add_argument("--test")
    m.add_argument("--test-detail")
    m.add_argument("--repro-rerun")
    m.add_argument("--note")
    m.add_argument("--evidence", nargs=3, action="append", metavar=("KIND", "REF", "DETAIL"))
    m.add_argument("--set", action="append", metavar="FIELD=VALUE")
    m.add_argument("--review-kinds")
    m.add_argument("--review-option", choices=vf.REVIEW_OPTIONS)
    m.add_argument("--review-alternatives")
    m.add_argument("--repo", default=None)
    return parser


HANDLERS = {"build": cmd_build, "verifier-task": cmd_verifier_task, "assemble": cmd_assemble,
            "approvals": cmd_approvals, "mark": cmd_mark}


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    try:
        return HANDLERS[args.command](args)
    except Refused as exc:
        for problem in exc.problems[:MAX_PRINTED]:
            print(problem if problem.startswith("ERROR ") else "ERROR " + problem)
        if len(exc.problems) > MAX_PRINTED:
            print("ERROR … {} more".format(len(exc.problems) - MAX_PRINTED))
        print("findings.py {}: refused; nothing written".format(args.command))
        return EXIT_REFUSED
    except Usage as exc:
        C.eprint("findings.py {}: {}".format(args.command, exc))
        return EXIT_USAGE


if __name__ == "__main__":
    sys.exit(main())
