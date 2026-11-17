#!/usr/bin/env python3
"""Validate a harden findings file (.harden/findings.json or .harden/candidates.json).

Purpose
    Implements, by hand and with the standard library only, the structure of
    assets/findings.schema.json plus the semantic rules a JSON Schema cannot express.
    Every problem is reported with the finding id and the field it concerns.

    Errors (make the file invalid):
      - missing or wrongly typed fields, values outside the enums, malformed ids, rule refs,
        CWE ids, commits, paths (must be repo-relative with forward slashes);
      - duplicate finding ids;
      - status verified/approved/applied/partial/reported without verified=true or without at
        least one evidence item with a non-empty ref (skill-design T31-F10,
        reviewer-independence G201-F11);
      - status applied or partial without commit (final-report-and-impact G204-F06/F07);
        with a repo, the commit must exist. partial: some lines applied while the headline
        reproduction or another consequence still reproduces (reporting RP-16/RP-17;
        eval-v2-calibration E02-F02);
      - tier T0 whose class is not structural; class report-only that is
        approved/applied/partial/reverted (blueprint section 3, T31-F11); tier T2 that is
        approved/applied/partial/reverted without a review object whose kinds hold
        'owner-judgement' (only the owner-judgement lane of an autonomous run applies a T2 item,
        under auto_apply.owner_judgement; prioritization Autonomous mode; user-policy-autonomy
        U01-F06), or at confidence needs_review or inference (lane step 1(h));
      - a malformed review object: kinds a non-empty array of REVIEW_KINDS, option one of
        REVIEW_OPTIONS, alternatives a non-empty string unless option is 'direct' (U01-F11); an
        applied or partial T2 or behavioural finding without one, or a behavioural one whose
        kinds lack 'behavioural' (reporting RP-07, Applied, review before merge; U01-F13); with a
        repo, a commit that changes a contract source (.sol, .vy) without the kind
        'contract-source' (U01-F12), a commit subject with '!' before the colon without the kind
        'breaking-api', or that kind without the '!' (Conventional Commits 1.0.0;
        protocol-change step 10); the kind 'breaking-api' without 'owner-judgement' (a
        breaking contract change is T2, row 21, which only the lane applies); a
        whole-repository format commit ('whole-repo-format') that changes a contract source
        (PC-11); a Foundry test (*.t.sol) is no contract source;
      - with a repo whose .harden/active says auto: a finding approved, applied, partial or
        reverted whose notes hold `live-effect: <kind>` (key, sign, submit, deploy,
        system-contract, live-only: never applied in autonomous mode, prioritization Money
        paths; user-policy-autonomy U01-F12), and an applied or partial finding without its
        `live-effect:` notes entry;
      - class behavioural + status applied or partial without an evidence item of kind test;
      - tier T0 or T1 with confidence needs_review or inference on a verified, approved,
        applied, partial, reported or reverted finding: the Tier table makes such a finding T2
        whatever its row (prioritization PZ-24 step 2, detection DT-27;
        pilot-auto-calibration A01-F11);
      - severity critical/high (or blocking=true) presented as established
        (verified/approved/applied/partial/reported) without confidence failing_test,
        reproduction or tool_high_precision (G204-F04);
      - confidence failing_test / reproduction / tool_high_precision without an evidence
        item of kind test / repro / tool (G204-F03);
      - severity other than nit without severity_criterion (G204-F02);
      - blocking=true without unblock_condition, or on a nit (G204-F21);
      - a control character other than tab, line feed or carriage return in any string field
        (it comes from a heredoc escape such as \\b and renders invisibly;
        pilot-auto-calibration A01-F60);
      - optional provenance fields present with the wrong type or value: seen_in_passes
        (integer >= 1), pass_ids (array of non-empty strings), exclusion_class and
        verifier_id (non-empty strings), threshold_source ({kind: project-config |
        skill-default | vendor-default, ref}), baseline_state (new | unchanged | updated |
        absent); null means absent;
      - verifier_id equal to one of the finding's pass_ids on an established finding: the
        verifier must not be a detection pass (detection DT-27);
      - with a repo: file missing, path spelled with the wrong letter case, line/end_line
        outside the file, base_sha unknown to git;
      - with a repo: a T1 finding approved/applied/partial whose category has no 'accepted' row in
        .harden/approvals.md, or whose accepted rows neither quote the user nor carry a valid
        'auto (profile)' approval. The file is the SKILL.md phase 6 table (| category |
        decision | count | user's exact words | UTC time |); the category cell names the
        finding's lens ("dead-code" or "dead code"), its rule prefix, its rule id or the
        finding id (T31-F11). With --interactive the words cell quotes the user. In
        autonomous mode (user-policy-autonomy U01-F01, U01-F04) it reads
        `auto (profile): auto_apply.<switch>=true` (protocol-change step 3, also after
        `re-tiered to <tier> by <rule id>, `), and such a row is accepted when it names the
        switches the finding needs (dependencies for lens dependencies, plus
        dependency_versions for DP-08, DP-09, DP-10 and SE-21, which add or change a resolved
        version, user-policy-autonomy U01-F08; else its class; owner_judgement too for a T2
        finding or one whose review kinds hold owner-judgement, additive-api, breaking-api or
        whole-repo-format), every
        switch it names is true, .harden/profile.json sets each of them to true (a switch the
        profile does not set reads as false; prioritization PZ-24), and .harden/active, when
        it exists, is not an --interactive run. A T2 finding (the owner-judgement lane) needs a
        row whose category cell is its own id and that also names
        auto_apply.owner_judgement=true; a quoted user answer never approves it. The findings
        schema does not say whether an
        item is on a money path, so auto_apply.money_paths is checked when a row names it;
        and when the run profile sets money_paths_globs and every pattern matches a file of
        the base commit (validate_profile.py), a warning names each such T1 finding whose
        `file` a pattern matches while none of the auto rows that approve it names
        auto_apply.money_paths=true (only a change proven AST-identical to its parent may
        skip that switch: pilot-auto-calibration A01-F01, A01-F06). The counts then say how
        many T1 findings each route approved ("t1_approved_by": {"profile", "user"}) and how
        many T2 findings the owner-judgement lane approved ("t2_applied_by_owner_judgement").
    Warnings (file stays valid):
      - more than --nit-cap nits outside candidate/rejected (default 10, G204-F08);
      - critical/high without proof on a deferred/blocked finding (G204-F04 counterpoint:
        keep unreproducible defects as needs_review, do not delete them);
      - verified=true with an empty verifier_note; status candidate with verified=true;
      - deferred/blocked/rejected/reverted/partial without a reason in notes or verifier_note
        (G204-F19, industry-review-guidelines T02-F18);
      - evidence made only of kind doc on an established finding (G201-F05);
      - unknown fields, unknown rule-ref prefixes, lens/prefix mismatch, duplicate
        fingerprints, project tools missing from tool_versions (G201-F12),
        T0 with fix_risk high, blocking on a readability-docs finding; an unknown review field;
        a money_paths_globs match on a finding whose review kinds lack 'money-path' (reporting
        RP-07); a '!' commit without a 'BREAKING CHANGE:' footer (protocol-change step 10);
        in autonomous mode, an approved finding without its `live-effect:` notes entry;
      - tier T0 or T1 with confidence needs_review or inference on a deferred or blocked
        finding (the same Tier table rule);
      - seen_in_passes that disagrees with the number of distinct pass_ids, repeated pass
        ids (detection DT-23); verifier_id among pass_ids on a finding that is not
        established (DT-27); exclusion_class on a finding whose status is not rejected
        (DT-33); unknown threshold_source fields.

CLI
    python validate_findings.py <findings.json> [--repo DIR | --no-repo]
                                [--at auto|worktree|base] [--nit-cap N] [--json]
    (use python3 on macOS/Linux)
    --repo     repository root used to check files, lines, base_sha and applied commits.
               Default: when the findings file sits in a `.harden/` directory, its parent
               directory; otherwise locations are not checked (the output says so).
    --no-repo  skip every repository check.
    --at       where file:line is checked: "worktree", "base" (git show <base_sha>:<file>),
               or "auto" (default: working tree first, then base_sha, because locations are
               recorded at base_sha and applied fixes move lines).
    --json     print a JSON report: {valid, errors[], warnings[], counts, repo_checked}.

Exit codes
    0  valid (warnings may be present)
    1  invalid (at least one error)
    2  unreadable input (missing file, undecodable UTF-8, malformed JSON)
"""
from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import validate_profile as vp  # noqa: E402  (sibling module, path set above; stdlib only)

# ----------------------------------------------------------------------------
# Enumerations (kept identical to assets/findings.schema.json; a unit test checks it)
# ----------------------------------------------------------------------------
LENSES: Tuple[str, ...] = (
    "dead-code", "complexity-design", "duplication", "errors-resilience", "ops-config",
    "concurrency", "security", "dependencies", "tests", "types-suppressions", "performance",
    "readability-docs", "architecture", "ai-failure-modes", "numeric-money-time", "data",
    "build-ci", "frontend", "web3", "project-tool",
)
CLASSES: Tuple[str, ...] = ("structural", "behavioural", "report-only")
TIERS: Tuple[str, ...] = ("T0", "T1", "T2")
SEVERITIES: Tuple[str, ...] = ("critical", "high", "medium", "low", "nit")
CONFIDENCES: Tuple[str, ...] = (
    "failing_test", "reproduction", "tool_high_precision", "needs_review", "inference",
)
EVIDENCE_KINDS: Tuple[str, ...] = ("tool", "test", "repro", "source", "git", "doc")
STATUSES: Tuple[str, ...] = (
    "candidate", "verified", "rejected", "approved", "applied", "reverted", "reported",
    "deferred", "blocked", "partial",
)
FIX_RISKS: Tuple[str, ...] = ("low", "medium", "high")
LOCATION_CLASSES: Tuple[str, ...] = ("hotspot", "warm", "cold", "unknown")
CONDITIONS: Tuple[str, ...] = ("none", "some", "significant", "undetermined")
# ISO/IEC 5055 characteristics used to file a finding next to its CWE id (standards T01-F01).
QUALITY_CHARACTERISTICS: Tuple[str, ...] = (
    "reliability", "security", "maintainability", "performance-efficiency",
)
# SARIF 2.1.0 result.baselineState values (reporting RP-19).
BASELINE_STATES: Tuple[str, ...] = ("new", "unchanged", "updated", "absent")
# Threshold provenance, in the precedence order of prioritization PZ-16.
THRESHOLD_SOURCE_KINDS: Tuple[str, ...] = ("project-config", "skill-default", "vendor-default")
THRESHOLD_SOURCE_FIELDS: Tuple[str, ...] = ("kind", "ref")
# Why an applied change waits for the owner's review before merge, in the order the report's
# "Applied, review before merge" section lists the kinds (reporting RP-07; user-policy-autonomy
# U01-F06, U01-F11 to U01-F13).
REVIEW_KINDS: Tuple[str, ...] = (
    "breaking-api", "additive-api", "contract-source", "money-path", "owner-judgement",
    "behavioural", "whole-repo-format",
)
# The option an item took where two behaviours were valid (prioritization, Owner-judgement lane
# step 3; user-policy-autonomy U01-F11); "direct" when the finding offered no choice.
REVIEW_OPTIONS: Tuple[str, ...] = ("direct", "lossless-variant", "record-only",
                                   "documented-default")
REVIEW_FIELDS: Tuple[str, ...] = ("kinds", "option", "alternatives")
# Contract sources: any change alters the metadata hash in the deployed bytecode, and the fix
# takes effect only when the owner redeploys (user-policy-autonomy U01-F12).
CONTRACT_SOURCE_SUFFIXES: Tuple[str, ...] = (".sol", ".vy")
# Conventional Commits 1.0.0: a "!" immediately before the ":" marks a breaking change, and a
# "BREAKING CHANGE:" footer describes it (protocol-change step 10; U01-F13).
BREAKING_SUBJECT_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]*(\([^)]*\))?!:\s")
BREAKING_FOOTER_RE = re.compile(r"^BREAKING[ -]CHANGE: \S", re.M)
# Foundry test files are Solidity sources that are never deployed (diff_guard treats them as
# tests), so they carry no contract-source review kind.
FOUNDRY_TEST_SUFFIX = ".t.sol"
# The live-effect reading every verified finding records in notes (prioritization, Money paths;
# user-policy-autonomy U01-F12): a kind keeps the item report-only in autonomous mode.
LIVE_EFFECT_KIND_RE = re.compile(
    r"live-effect:\s*(key|sign|submit|deploy|system-contract|live-only)\b", re.I)
LIVE_EFFECT_ANY_RE = re.compile(r"live-effect:", re.I)
# Review kinds only the owner-judgement lane decides (prioritization, Autonomous mode):
# a T1 item of these kinds also needs auto_apply.owner_judgement (row 18, PC-11, row 21).
LANE_REVIEW_KINDS = frozenset({"owner-judgement", "breaking-api", "additive-api",
                               "whole-repo-format"})

REQUIRED_FIELDS: Tuple[str, ...] = (
    "id", "lens", "rule_ref", "title", "file", "line", "class", "tier", "severity",
    "severity_criterion", "confidence", "evidence", "verified", "verifier_note", "status",
    "fix_risk", "location_class",
)
OPTIONAL_FIELDS: Tuple[str, ...] = (
    "end_line", "commit", "cwe", "quality_characteristic", "fingerprint", "notes",
    "blocking", "unblock_condition", "conditions",
    "seen_in_passes", "pass_ids", "exclusion_class", "threshold_source", "verifier_id",
    "baseline_state", "review",
)
TOP_REQUIRED: Tuple[str, ...] = ("version", "base_sha", "generated", "tool_versions", "findings")

# Statuses under which a finding is presented to the user as established.
ESTABLISHED_STATUSES = frozenset({"verified", "approved", "applied", "partial", "reported"})
# Statuses that imply the skill edited (or was cleared to edit) the code.
EDIT_STATUSES = frozenset({"approved", "applied", "partial", "reverted"})
# Statuses whose findings are not part of the report body (nit cap, proof rule).
NOT_REPORTED_STATUSES = frozenset({"candidate", "rejected"})
# Statuses that should carry a written reason.
REASON_STATUSES = frozenset({"deferred", "blocked", "rejected", "reverted", "partial"})
# Statuses whose fix reached the branch in at least one commit (partial: reporting RP-16,
# eval-v2-calibration E02-F02).
COMMITTED_STATUSES = frozenset({"applied", "partial"})
PROOF_CONFIDENCES = frozenset({"failing_test", "reproduction", "tool_high_precision"})
# Rungs below proof. A finding at one of them is T2 whatever its Tier table row (prioritization
# PZ-24 step 2, detection DT-27; pilot-auto-calibration A01-F11).
WEAK_CONFIDENCES = frozenset({"needs_review", "inference"})
CONFIDENCE_EVIDENCE_KIND: Dict[str, str] = {
    "failing_test": "test",
    "reproduction": "repro",
    "tool_high_precision": "tool",
}

# Rule-id prefixes from the blueprint file plan (section 4).
LENS_PREFIX: Dict[str, str] = {
    "dead-code": "DC", "complexity-design": "CX", "duplication": "DU",
    "errors-resilience": "ER", "ops-config": "OP", "concurrency": "CC", "security": "SE",
    "dependencies": "DP", "tests": "TQ", "types-suppressions": "TY", "performance": "PE",
    "readability-docs": "RD", "architecture": "AR", "ai-failure-modes": "AI",
    "numeric-money-time": "NM", "data": "DA", "build-ci": "CI", "frontend": "FE", "web3": "W3",
}
PROCESS_AND_LANGUAGE_PREFIXES = frozenset(
    {"PF", "PC", "DT", "PZ", "RP", "TS", "PY", "RS", "CP", "GO", "SO"}
)
KNOWN_PREFIXES = frozenset(LENS_PREFIX.values()) | PROCESS_AND_LANGUAGE_PREFIXES

# Report sections, in the order of assets/report-template.md (G204-F09: group by decision).
DECISION_GROUPS: Tuple[str, ...] = (
    "review-before-merge", "applied", "awaiting-approval", "approved-not-applied", "report-only", "partial",
    "blocked",
    "deferred", "rejected", "candidate",
)

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
SKILL_RULE_RE = re.compile(r"^(?P<prefix>[A-Z][A-Z0-9]{1,3})-(?P<num>[0-9]{2,3})$")
PROJECT_RULE_RE = re.compile(r"^project:(?P<tool>[^/\s]+)/(?P<rule>\S+)$")
SHA_RE = re.compile(r"^[0-9a-f]{7,64}$")
CWE_RE = re.compile(r"^CWE-[0-9]+$")
DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"
)

DEFAULT_NIT_CAP = 10
GIT_TIMEOUT_S = 30
DOCUMENT = "<document>"


# ----------------------------------------------------------------------------
# Result containers
# ----------------------------------------------------------------------------
@dataclass
class Issue:
    """One validation problem, tied to a finding (or the document) and a field."""

    level: str  # "error" or "warning"
    finding: str  # finding id, "finding[<index>]" when the id is unusable, or "<document>"
    field: str
    message: str

    def to_dict(self) -> Dict[str, str]:
        return {"level": self.level, "finding": self.finding, "field": self.field,
                "message": self.message}

    def render(self) -> str:
        return f"{self.level.upper():<7} {self.finding}  {self.field}: {self.message}"


@dataclass
class ValidationReport:
    """Errors, warnings and counts for one findings document."""

    errors: List[Issue] = field(default_factory=list)
    warnings: List[Issue] = field(default_factory=list)
    counts: Dict[str, Any] = field(default_factory=dict)
    repo_checked: Optional[str] = None

    @property
    def valid(self) -> bool:
        return not self.errors

    def error(self, finding: str, fld: str, message: str) -> None:
        self.errors.append(Issue("error", finding, fld, message))

    def warn(self, finding: str, fld: str, message: str) -> None:
        self.warnings.append(Issue("warning", finding, fld, message))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": [i.to_dict() for i in self.errors],
            "warnings": [i.to_dict() for i in self.warnings],
            "counts": self.counts,
            "repo_checked": self.repo_checked,
        }


# ----------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------
def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _nonempty_str(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _fmt_enum(values: Tuple[str, ...]) -> str:
    return "|".join(values)


def _path_problem(path: str) -> Optional[str]:
    """Return why a finding path is not a clean repo-relative forward-slash path."""
    if "\\" in path:
        return "use forward slashes, not backslashes"
    if re.match(r"^[A-Za-z]:", path) or path.startswith("/"):
        return "must be relative to the repository root, not absolute"
    if path.startswith("./"):
        return "drop the leading './'"
    parts = path.split("/")
    if ".." in parts:
        return "must not contain '..' segments"
    if any(p == "" for p in parts):
        return "contains an empty path segment ('//' or trailing '/')"
    return None


def _count_lines(data: bytes) -> int:
    if not data:
        return 0
    return data.count(b"\n") + (0 if data.endswith(b"\n") else 1)


def _git(repo: Path, *args: str) -> Tuple[int, bytes]:
    """Run git without a shell; returns (exit code, stdout). 127 when git cannot start."""
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            timeout=GIT_TIMEOUT_S,
            check=False,
            env=env,
        )
    except (OSError, subprocess.SubprocessError):
        return 127, b""
    return proc.returncode, proc.stdout


def decision_group(finding: Dict[str, Any]) -> str:
    """Report section a finding belongs to (assets/report-template.md, G204-F09)."""
    status = finding.get("status")
    if status == "applied":
        # Applied, review before merge: every applied finding with a review object (reporting
        # RP-07; user-policy-autonomy U01-F13).
        return "review-before-merge" if finding.get("review") else "applied"
    if status == "partial":
        # One entry under "Not fixed or deferred"; heads Open owner items (RP-07, RP-16).
        return "partial"
    if status in ("blocked", "reverted"):
        return "blocked"
    if status in ("deferred", "rejected", "candidate"):
        return str(status)
    if finding.get("tier") == "T2" or finding.get("class") == "report-only":
        return "report-only"
    if status == "approved":
        return "approved-not-applied"
    return "awaiting-approval"


# ----------------------------------------------------------------------------
# Location checking (repo mode)
# ----------------------------------------------------------------------------
class LocationChecker:
    """Resolves line counts of repo files in the working tree and at base_sha (cached)."""

    def __init__(self, repo: Path, base_sha: Optional[str], at: str, report: ValidationReport):
        self.repo = repo
        self.at = at
        self.report = report
        self._worktree_cache: Dict[str, Optional[int]] = {}
        self._base_cache: Dict[str, Optional[int]] = {}
        self._listdir_cache: Dict[str, Optional[List[str]]] = {}
        self._files_cache: Dict[str, Optional[List[str]]] = {}
        self._message_cache: Dict[str, Optional[str]] = {}
        rc, out = _git(repo, "rev-parse", "--is-inside-work-tree")
        self.is_git = rc == 0 and out.strip() == b"true"
        self.base_sha: Optional[str] = None
        if base_sha and self.is_git:
            rc, _ = _git(repo, "cat-file", "-e", f"{base_sha}^{{commit}}")
            if rc == 0:
                self.base_sha = base_sha
            else:
                report.error(DOCUMENT, "base_sha",
                             f"commit {base_sha} does not exist in repository {repo.as_posix()}")
        elif base_sha and not self.is_git:
            report.warn(DOCUMENT, "base_sha",
                        f"{repo.as_posix()} is not a git work tree (or git is unavailable); "
                        "base_sha, commits and base-side locations were not checked")
        if at == "base" and self.base_sha is None:
            report.error(DOCUMENT, "--at",
                         "--at base needs a git repository in which base_sha exists")

    def _listdir(self, directory: Path) -> Optional[List[str]]:
        key = str(directory)
        if key not in self._listdir_cache:
            try:
                self._listdir_cache[key] = os.listdir(directory)
            except OSError:
                self._listdir_cache[key] = None
        return self._listdir_cache[key]

    def case_mismatch(self, rel: str) -> Optional[str]:
        """On case-insensitive file systems, return the on-disk spelling when it differs."""
        current = self.repo
        actual: List[str] = []
        for part in rel.split("/"):
            names = self._listdir(current)
            if names is None:
                return None
            if part in names:
                actual.append(part)
            else:
                matches = [n for n in names if n.lower() == part.lower()]
                if not matches:
                    return None
                actual.append(matches[0])
            current = current / actual[-1]
        spelled = "/".join(actual)
        return spelled if spelled != rel else None

    def worktree_lines(self, rel: str) -> Optional[int]:
        if rel not in self._worktree_cache:
            path = self.repo / rel
            try:
                self._worktree_cache[rel] = _count_lines(path.read_bytes()) if path.is_file() else None
            except OSError:
                self._worktree_cache[rel] = None
        return self._worktree_cache[rel]

    def base_lines(self, rel: str) -> Optional[int]:
        if self.base_sha is None:
            return None
        if rel not in self._base_cache:
            rc, out = _git(self.repo, "show", f"{self.base_sha}:./{rel}")
            self._base_cache[rel] = _count_lines(out) if rc == 0 else None
        return self._base_cache[rel]

    def commit_exists(self, sha: str) -> Optional[bool]:
        if not self.is_git:
            return None
        rc, _ = _git(self.repo, "cat-file", "-e", f"{sha}^{{commit}}")
        return rc == 0

    def commit_files(self, sha: str) -> Optional[List[str]]:
        """Paths the commit changes (repo-relative, forward slashes), or None when git cannot
        say. -z keeps odd names unquoted; --root covers a root commit."""
        if not self.is_git:
            return None
        if sha not in self._files_cache:
            rc, out = _git(self.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z",
                           "--root", sha)
            self._files_cache[sha] = ([p.decode("utf-8", errors="replace")
                                       for p in out.split(b"\0") if p] if rc == 0 else None)
        return self._files_cache[sha]

    def commit_message(self, sha: str) -> Optional[str]:
        """The commit's full message with LF line ends, or None when git cannot say."""
        if not self.is_git:
            return None
        if sha not in self._message_cache:
            rc, out = _git(self.repo, "log", "-1", "--format=%B", sha)
            self._message_cache[sha] = (out.decode("utf-8", errors="replace").replace("\r\n", "\n")
                                        if rc == 0 else None)
        return self._message_cache[sha]

    def check(self, fid: str, rel: str, line: int, end_line: Optional[int]) -> None:
        """Report an error unless file:line[-end_line] exists at one of the allowed places."""
        if self.at in ("auto", "worktree"):
            spelled = self.case_mismatch(rel)
            if spelled is not None:
                self.report.error(fid, "file",
                                  f"'{rel}' differs in letter case from the file on disk "
                                  f"'{spelled}'; use the repository spelling")
                return
        places: List[Tuple[str, Optional[int]]] = []
        if self.at in ("auto", "worktree"):
            places.append(("working tree", self.worktree_lines(rel)))
        if self.at in ("auto", "base") and self.base_sha is not None:
            places.append((f"base {self.base_sha[:12]}", self.base_lines(rel)))
        last = end_line if end_line is not None else line
        for _where, nlines in places:
            if nlines is not None and 1 <= line <= nlines and last <= nlines:
                return
        existing = [(w, n) for w, n in places if n is not None]
        where_text = " nor ".join(w for w, _ in places) or "the working tree"
        if not existing:
            self.report.error(fid, "file", f"'{rel}' does not exist in {where_text}")
            return
        sizes = ", ".join(f"{n} lines in {w}" for w, n in existing)
        span = f"lines {line}-{last}" if last != line else f"line {line}"
        fld = "end_line" if last > line and any(line <= n for _, n in existing) else "line"
        self.report.error(fid, fld, f"{span} is outside '{rel}' ({sizes})")


# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _control_characters(value: Any, path: str) -> List[Tuple[str, str]]:
    """(field path, first control character) of every string below `value` that holds a
    control character other than tab, line feed or carriage return (A01-F60)."""
    out: List[Tuple[str, str]] = []
    if isinstance(value, str):
        m = CONTROL_RE.search(value)
        if m:
            out.append((path or "<value>", m.group(0)))
    elif isinstance(value, dict):
        for key, item in value.items():
            out += _control_characters(item, "{}.{}".format(path, key) if path else str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            out += _control_characters(item, "{}[{}]".format(path, index))
    return out


def _check_top(doc: Dict[str, Any], rep: ValidationReport) -> None:
    for key, value in doc.items():
        if key != "findings" and isinstance(value, str):
            for path, char in _control_characters(value, key):
                rep.error(DOCUMENT, path, "control character U+{:04X} in {}".format(
                    ord(char), path))
    for key in TOP_REQUIRED:
        if key not in doc:
            rep.error(DOCUMENT, key, "required top-level field is missing")
    for key in doc:
        if key not in TOP_REQUIRED and not key.startswith("$"):
            rep.warn(DOCUMENT, key, "unknown top-level field (typo?)")
    if "version" in doc and not (_is_int(doc["version"]) and doc["version"] == 1):
        rep.error(DOCUMENT, "version", f"must be the integer 1, got {doc['version']!r}")
    if "base_sha" in doc:
        sha = doc["base_sha"]
        if not (isinstance(sha, str) and SHA_RE.match(sha)):
            rep.error(DOCUMENT, "base_sha",
                      f"must be a lowercase hex commit id of 7-64 chars, got {sha!r}")
    if "generated" in doc:
        gen = doc["generated"]
        if not (isinstance(gen, str) and DATETIME_RE.match(gen)):
            rep.error(DOCUMENT, "generated",
                      "must be an ISO 8601 date-time with timezone "
                      f"(e.g. 2026-09-23T14:30:00Z), got {gen!r}")
    if "tool_versions" in doc:
        tv = doc["tool_versions"]
        if not isinstance(tv, dict):
            rep.error(DOCUMENT, "tool_versions",
                      "must be an object mapping tool name to pinned version string")
        else:
            for name, ver in tv.items():
                if not _nonempty_str(ver):
                    rep.error(DOCUMENT, f"tool_versions.{name}",
                              f"version must be a non-empty string, got {ver!r}")
    if "findings" in doc and not isinstance(doc["findings"], list):
        rep.error(DOCUMENT, "findings", "must be an array of finding objects")


def _check_enum(rep: ValidationReport, fid: str, f: Dict[str, Any], key: str,
                allowed: Tuple[str, ...], ok: Dict[str, Any]) -> None:
    value = f[key]
    if isinstance(value, str) and value in allowed:
        ok[key] = value
    else:
        rep.error(fid, key, f"{value!r} is not one of {_fmt_enum(allowed)}")


def _check_evidence(rep: ValidationReport, fid: str, evidence: Any) -> Optional[List[Dict[str, str]]]:
    if not isinstance(evidence, list):
        rep.error(fid, "evidence", "must be an array of {kind, ref, detail} objects")
        return None
    items: List[Dict[str, str]] = []
    for i, item in enumerate(evidence):
        where = f"evidence[{i}]"
        if not isinstance(item, dict):
            rep.error(fid, where, "must be an object with kind, ref and detail")
            continue
        good = True
        for key in ("kind", "ref", "detail"):
            if key not in item:
                rep.error(fid, f"{where}.{key}", "required field is missing")
                good = False
            elif not isinstance(item[key], str):
                rep.error(fid, f"{where}.{key}", f"must be a string, got {type(item[key]).__name__}")
                good = False
        for key in item:
            if key not in ("kind", "ref", "detail"):
                rep.warn(fid, f"{where}.{key}", "unknown evidence field (typo?)")
        if good and item["kind"] not in EVIDENCE_KINDS:
            rep.error(fid, f"{where}.kind",
                      f"{item['kind']!r} is not one of {_fmt_enum(EVIDENCE_KINDS)}")
            good = False
        if good:
            items.append({"kind": item["kind"], "ref": item["ref"], "detail": item["detail"]})
    return items


def _check_finding(rep: ValidationReport, index: int, f: Any,
                   tool_versions: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """Validate one finding; returns (label used in messages, dict of fields that passed)."""
    label = f"finding[{index}]"
    ok: Dict[str, Any] = {}
    if not isinstance(f, dict):
        rep.error(label, "<finding>", f"must be an object, got {type(f).__name__}")
        return label, ok

    raw_id = f.get("id")
    if isinstance(raw_id, str) and ID_RE.match(raw_id):
        label = raw_id
        ok["id"] = raw_id
    elif "id" in f and raw_id is not None:
        rep.error(label, "id",
                  f"{raw_id!r} is not a valid id (letters, digits, '.', '_', '-'; e.g. H-001)")

    for key in REQUIRED_FIELDS:
        if key not in f or f[key] is None:
            rep.error(label, key, "required field is missing")
    for key in f:
        if key not in REQUIRED_FIELDS and key not in OPTIONAL_FIELDS:
            rep.warn(label, key, "unknown field (typo?); it is ignored")
    for path, char in _control_characters(f, ""):
        rep.error(label, path, "control character U+{:04X} in {}".format(ord(char), path))

    # --- enums
    for key, allowed in (("lens", LENSES), ("class", CLASSES), ("tier", TIERS),
                         ("severity", SEVERITIES), ("confidence", CONFIDENCES),
                         ("status", STATUSES), ("fix_risk", FIX_RISKS),
                         ("location_class", LOCATION_CLASSES)):
        if f.get(key) is not None:
            _check_enum(rep, label, f, key, allowed, ok)
    if f.get("conditions") is not None:
        _check_enum(rep, label, f, "conditions", CONDITIONS, ok)
    if f.get("quality_characteristic") is not None:
        _check_enum(rep, label, f, "quality_characteristic", QUALITY_CHARACTERISTICS, ok)
    if f.get("baseline_state") is not None:
        _check_enum(rep, label, f, "baseline_state", BASELINE_STATES, ok)

    # --- strings
    for key in ("title", "severity_criterion", "verifier_note"):
        if f.get(key) is not None:
            if isinstance(f[key], str):
                ok[key] = f[key]
            else:
                rep.error(label, key, f"must be a string, got {type(f[key]).__name__}")
    if "title" in ok and not ok["title"].strip():
        rep.error(label, "title", "must not be empty")
    for key in ("fingerprint", "notes", "unblock_condition"):
        if f.get(key) is not None:
            if isinstance(f[key], str):
                ok[key] = f[key]
            else:
                rep.error(label, key, f"must be a string or null, got {type(f[key]).__name__}")

    # --- rule_ref
    if f.get("rule_ref") is not None:
        ref = f["rule_ref"]
        if isinstance(ref, str) and (SKILL_RULE_RE.match(ref) or PROJECT_RULE_RE.match(ref)):
            ok["rule_ref"] = ref
        else:
            rep.error(label, "rule_ref",
                      f"{ref!r} must be a skill rule id like 'DC-03' or 'project:<tool>/<rule>'")

    # --- file / line / end_line
    if f.get("file") is not None:
        path = f["file"]
        if not _nonempty_str(path):
            rep.error(label, "file", "must be a non-empty repository-relative path")
        else:
            problem = _path_problem(path)
            if problem:
                rep.error(label, "file", f"{path!r} {problem}")
            else:
                ok["file"] = path
    if f.get("line") is not None:
        if _is_int(f["line"]) and f["line"] >= 1:
            ok["line"] = f["line"]
        else:
            rep.error(label, "line", f"must be an integer >= 1, got {f['line']!r}")
    if f.get("end_line") is not None:
        end = f["end_line"]
        if not (_is_int(end) and end >= 1):
            rep.error(label, "end_line", f"must be an integer >= 1, got {end!r}")
        elif "line" in ok and end < ok["line"]:
            rep.error(label, "end_line", f"{end} is before line {ok['line']}")
        else:
            ok["end_line"] = end

    # --- booleans
    if f.get("verified") is not None:
        if isinstance(f["verified"], bool):
            ok["verified"] = f["verified"]
        else:
            rep.error(label, "verified", f"must be true or false, got {f['verified']!r}")
    if f.get("blocking") is not None:
        if isinstance(f["blocking"], bool):
            ok["blocking"] = f["blocking"]
        else:
            rep.error(label, "blocking", f"must be true, false or null, got {f['blocking']!r}")

    # --- commit / cwe
    if f.get("commit") is not None:
        commit = f["commit"]
        if isinstance(commit, str) and SHA_RE.match(commit):
            ok["commit"] = commit
        else:
            rep.error(label, "commit", f"{commit!r} is not a lowercase hex commit id (7-64 chars)")
    if f.get("cwe") is not None:
        cwe = f["cwe"]
        if isinstance(cwe, str) and CWE_RE.match(cwe):
            ok["cwe"] = cwe
        else:
            rep.error(label, "cwe", f"{cwe!r} must look like 'CWE-561'")

    # --- evidence
    if f.get("evidence") is not None:
        items = _check_evidence(rep, label, f["evidence"])
        if items is not None:
            ok["evidence"] = items

    # --- detection / verification provenance (detection DT-23, DT-27, DT-33)
    if f.get("seen_in_passes") is not None:
        seen = f["seen_in_passes"]
        if _is_int(seen) and seen >= 1:
            ok["seen_in_passes"] = seen
        else:
            rep.error(label, "seen_in_passes", f"must be an integer >= 1, got {seen!r}")
    if f.get("pass_ids") is not None:
        pass_ids = _check_pass_ids(rep, label, f["pass_ids"])
        if pass_ids is not None:
            ok["pass_ids"] = pass_ids
    for key in ("exclusion_class", "verifier_id"):
        if f.get(key) is not None:
            if _nonempty_str(f[key]):
                ok[key] = f[key]
            else:
                rep.error(label, key, f"must be a non-empty string or null, got {f[key]!r}")
    if f.get("threshold_source") is not None:
        source = _check_threshold_source(rep, label, f["threshold_source"])
        if source is not None:
            ok["threshold_source"] = source
    if f.get("review") is not None:
        review = _check_review(rep, label, f["review"])
        if review is not None:
            ok["review"] = review

    _check_semantics(rep, label, ok, tool_versions)
    return label, ok


def _check_pass_ids(rep: ValidationReport, fid: str, value: Any) -> Optional[List[str]]:
    """Type-check pass_ids: an array of non-empty strings (detection DT-21 pass ids)."""
    if not isinstance(value, list):
        rep.error(fid, "pass_ids",
                  f"must be an array of pass id strings or null, got {type(value).__name__}")
        return None
    good: List[str] = []
    valid = True
    for i, item in enumerate(value):
        if _nonempty_str(item):
            good.append(item)
        else:
            rep.error(fid, f"pass_ids[{i}]", f"must be a non-empty string, got {item!r}")
            valid = False
    duplicates = sorted(k for k, n in Counter(good).items() if n > 1)
    if duplicates:
        rep.warn(fid, "pass_ids", f"repeated pass id(s) {', '.join(duplicates)}; list each pass once")
    return good if valid else None


def _check_threshold_source(rep: ValidationReport, fid: str,
                            value: Any) -> Optional[Dict[str, str]]:
    """Type-check threshold_source: {kind: project-config|skill-default|vendor-default, ref}."""
    if not isinstance(value, dict):
        rep.error(fid, "threshold_source",
                  "must be an object {kind, ref} or null, got " + type(value).__name__)
        return None
    good = True
    for key in THRESHOLD_SOURCE_FIELDS:
        if value.get(key) is None:
            rep.error(fid, f"threshold_source.{key}", "required field is missing")
            good = False
    for key in value:
        if key not in THRESHOLD_SOURCE_FIELDS:
            rep.warn(fid, f"threshold_source.{key}", "unknown threshold_source field (typo?)")
    kind = value.get("kind")
    if kind is not None and not (isinstance(kind, str) and kind in THRESHOLD_SOURCE_KINDS):
        rep.error(fid, "threshold_source.kind",
                  f"{kind!r} is not one of {_fmt_enum(THRESHOLD_SOURCE_KINDS)}")
        good = False
    ref = value.get("ref")
    if ref is not None and not _nonempty_str(ref):
        rep.error(fid, "threshold_source.ref",
                  f"must be a non-empty string (config path and key, rule id or tool doc), "
                  f"got {ref!r}")
        good = False
    return {"kind": value["kind"], "ref": value["ref"]} if good else None


def _check_review(rep: ValidationReport, fid: str, value: Any) -> Optional[Dict[str, Any]]:
    """Type-check review: {kinds: non-empty array of REVIEW_KINDS, option: one of REVIEW_OPTIONS,
    alternatives: str | null}; alternatives is required unless option is 'direct' (reporting
    RP-07; user-policy-autonomy U01-F11, U01-F13)."""
    if not isinstance(value, dict):
        rep.error(fid, "review",
                  "must be an object {kinds, option, alternatives} or null, got "
                  + type(value).__name__)
        return None
    good = True
    for key in value:
        if key not in REVIEW_FIELDS:
            rep.warn(fid, f"review.{key}", "unknown review field (typo?)")
    kinds = value.get("kinds")
    if not isinstance(kinds, list) or not kinds:
        rep.error(fid, "review.kinds", f"must be a non-empty array of {_fmt_enum(REVIEW_KINDS)}")
        good = False
    else:
        bad = [k for k in kinds if not (isinstance(k, str) and k in REVIEW_KINDS)]
        if bad:
            rep.error(fid, "review.kinds", f"{bad!r} not in {_fmt_enum(REVIEW_KINDS)}")
            good = False
        repeated = sorted(k for k, n in Counter(k for k in kinds if isinstance(k, str)).items()
                          if n > 1)
        if repeated:
            rep.warn(fid, "review.kinds", f"repeated kind(s) {', '.join(repeated)}")
    option = value.get("option")
    if not (isinstance(option, str) and option in REVIEW_OPTIONS):
        rep.error(fid, "review.option", f"{option!r} is not one of {_fmt_enum(REVIEW_OPTIONS)}")
        good = False
    alternatives = value.get("alternatives")
    if alternatives is not None and not isinstance(alternatives, str):
        rep.error(fid, "review.alternatives", "must be a string or null")
        good = False
    elif isinstance(option, str) and option in REVIEW_OPTIONS and option != "direct" \
            and not _nonempty_str(alternatives):
        rep.error(fid, "review.alternatives",
                  f"option '{option}' leaves another valid behaviour to the owner; name it in "
                  "review.alternatives (prioritization, Owner-judgement lane step 3; "
                  "user-policy-autonomy U01-F11)")
        good = False
    if not good:
        return None
    return {"kinds": list(kinds), "option": option, "alternatives": alternatives}


def _check_semantics(rep: ValidationReport, fid: str, ok: Dict[str, Any],
                     tool_versions: Dict[str, Any]) -> None:
    status = ok.get("status")
    tier = ok.get("tier")
    cls = ok.get("class")
    severity = ok.get("severity")
    confidence = ok.get("confidence")
    evidence: Optional[List[Dict[str, str]]] = ok.get("evidence")
    kinds = {e["kind"] for e in evidence} if evidence is not None else set()
    blocking = ok.get("blocking") is True

    # Established findings need verification and evidence (T31-F10, G201-F11).
    if status in ESTABLISHED_STATUSES:
        if ok.get("verified") is False:
            rep.error(fid, "verified", f"status '{status}' requires verified=true")
        if evidence is not None and not any(e["ref"].strip() for e in evidence):
            rep.error(fid, "evidence",
                      f"status '{status}' requires at least one evidence item with a non-empty ref")
        if evidence and kinds == {"doc"}:
            rep.warn(fid, "evidence",
                     "only documentation/comment evidence; in-repo text is a claim to verify, "
                     "not proof (reviewer-independence G201-F05)")

    # Applied and partial need a commit (G204-F06/F07; partial: RP-16, E02-F02).
    if status in COMMITTED_STATUSES and "commit" not in ok:
        rep.error(fid, "commit", f"status '{status}' requires the commit that applied the fix")

    # Tier / class policy (blueprint section 3).
    if tier == "T0" and cls is not None and cls != "structural":
        rep.error(fid, "class", f"tier T0 requires class 'structural', got '{cls}'")
    # T2 is report-only unless the owner-judgement lane of an autonomous run applied it
    # (prioritization Autonomous mode; user-policy-autonomy U01-F06); every applied T2 or
    # behavioural finding carries a review object for the report's Applied, review before merge
    # (reporting RP-07; U01-F13).
    review = ok.get("review")
    review_kinds = set(review["kinds"]) if review else set()
    lane = "owner-judgement" in review_kinds
    if tier == "T2" and status in EDIT_STATUSES and not lane:
        rep.error(fid, "status",
                  f"tier T2 is report-only and can never be '{status}' unless the owner-judgement "
                  "lane of an autonomous run applied it, recorded as a review object whose kinds "
                  "hold 'owner-judgement' (prioritization, Autonomous mode; user-policy-autonomy "
                  "U01-F06); use reported or deferred")
    if tier == "T2" and status in EDIT_STATUSES and lane and confidence in WEAK_CONFIDENCES:
        rep.error(fid, "confidence",
                  "an owner-judgement item is applied only at failing_test, reproduction or "
                  f"tool_high_precision, got '{confidence}' (Owner-judgement lane 1(h); detection "
                  "DT-27)")
    if status in COMMITTED_STATUSES and review is None and (tier == "T2" or cls == "behavioural"):
        what = "tier T2" if tier == "T2" else "behavioural"
        rep.error(fid, "review",
                  f"a {what} finding with status '{status}' needs a review object "
                  "{kinds, option, alternatives}: the report lists its commit under Applied, "
                  "review before merge with its git revert command (reporting RP-07; "
                  "user-policy-autonomy U01-F13)")
    if review is not None and status in COMMITTED_STATUSES and cls == "behavioural" \
            and "behavioural" not in review_kinds:
        rep.error(fid, "review.kinds",
                  "a behavioural change needs the kind 'behavioural' (reporting RP-07)")
    if review is not None and status in EDIT_STATUSES and "breaking-api" in review_kinds \
            and "owner-judgement" not in review_kinds:
        rep.error(fid, "review.kinds",
                  "'breaking-api' goes only with 'owner-judgement': the Tier table makes every "
                  "breaking contract change T2 (row 21), which only the owner-judgement lane "
                  "applies (user-policy-autonomy U01-F13)")
    if cls == "report-only" and status in EDIT_STATUSES:
        rep.error(fid, "status",
                  f"class 'report-only' can never be '{status}'; use reported or deferred")
    if cls == "behavioural" and status in COMMITTED_STATUSES and evidence is not None \
            and "test" not in kinds:
        rep.error(fid, "evidence",
                  f"a behavioural change with status '{status}' needs an evidence item of "
                  "kind 'test' "
                  "demonstrating the new behaviour")
    # A needs_review or inference finding is T2 whatever its row (prioritization PZ-24 step 2,
    # detection DT-27; pilot-auto-calibration A01-F11).
    if tier in ("T0", "T1") and confidence in WEAK_CONFIDENCES:
        weak = (f"tier {tier} with confidence '{confidence}': the Tier table makes a needs_review "
                "or inference finding T2 whatever its row (prioritization PZ-24 step 2, detection "
                "DT-27); raise the evidence to failing_test, reproduction or tool_high_precision, "
                "or set tier T2 and class report-only")
        if status in ESTABLISHED_STATUSES or status in EDIT_STATUSES:
            rep.error(fid, "tier", weak)
        elif status in ("deferred", "blocked"):
            rep.warn(fid, "tier", weak)
    if tier == "T0" and ok.get("fix_risk") == "high":
        rep.warn(fid, "fix_risk",
                 "T0 is reserved for mechanically proven changes; fix_risk 'high' contradicts it")

    # Proof for critical/high or blocking (G204-F04).
    needs_proof = severity in ("critical", "high") or blocking
    if needs_proof and confidence is not None and confidence not in PROOF_CONFIDENCES:
        what = f"severity '{severity}'" if severity in ("critical", "high") else "blocking=true"
        if status in ESTABLISHED_STATUSES:
            rep.error(fid, "confidence",
                      f"{what} needs confidence failing_test, reproduction or tool_high_precision, "
                      f"got '{confidence}'; attach the proof, or keep the finding as status "
                      "'deferred' with confidence 'needs_review' and list it under Limits "
                      "(final-report-and-impact G204-F04)")
        elif status in ("deferred", "blocked"):
            rep.warn(fid, "confidence",
                     f"{what} is unproven (confidence '{confidence}'); report it as undetermined "
                     "in the Limits section, not as an established defect (G204-F04)")

    # Confidence rung must be backed by matching evidence (G204-F03).
    if confidence in CONFIDENCE_EVIDENCE_KIND and evidence is not None and status != "rejected":
        need = CONFIDENCE_EVIDENCE_KIND[confidence]
        if need not in kinds:
            rep.error(fid, "confidence",
                      f"confidence '{confidence}' requires an evidence item of kind '{need}'")

    # Severity criterion (G204-F02).
    if severity is not None and severity != "nit" and status != "rejected":
        if not ok.get("severity_criterion", "").strip():
            rep.error(fid, "severity_criterion",
                      f"severity '{severity}' must cite the rubric criterion it meets")

    # Blocking is narrow (G204-F21).
    if blocking:
        if severity == "nit":
            rep.error(fid, "blocking", "a nit can never be blocking")
        if not ok.get("unblock_condition", "").strip():
            rep.error(fid, "unblock_condition",
                      "blocking=true requires unblock_condition (what exactly unblocks it)")
        if ok.get("lens") == "readability-docs":
            rep.warn(fid, "blocking",
                     "style/naming/docs findings are normally never blocking (G204-F21); "
                     "keep only with a project-specific reason")

    # Verification bookkeeping.
    if ok.get("verified") is True and not ok.get("verifier_note", "").strip():
        rep.warn(fid, "verifier_note", "verified=true but verifier_note is empty")
    if status == "candidate" and ok.get("verified") is True:
        rep.warn(fid, "status", "verified=true but status is still 'candidate'")
    if status in REASON_STATUSES and not (ok.get("notes") or "").strip() \
            and not ok.get("verifier_note", "").strip():
        rep.warn(fid, "notes", f"status '{status}' should state its reason in notes or verifier_note")

    # Pass bookkeeping (DT-23) and verifier independence (DT-27).
    pass_ids: Optional[List[str]] = ok.get("pass_ids")
    seen = ok.get("seen_in_passes")
    if seen is not None and pass_ids is not None and pass_ids and seen != len(set(pass_ids)):
        rep.warn(fid, "seen_in_passes",
                 f"seen_in_passes is {seen} but pass_ids names {len(set(pass_ids))} distinct "
                 "pass(es); keep them in step (detection DT-23)")
    verifier = ok.get("verifier_id")
    if verifier is not None and pass_ids and verifier in pass_ids:
        message = (f"verifier_id '{verifier}' is also one of the detection passes in pass_ids; "
                   "the verifier must be a separate fresh-context agent (detection DT-27)")
        if status in ESTABLISHED_STATUSES:
            rep.error(fid, "verifier_id", message)
        else:
            rep.warn(fid, "verifier_id", message)
    if "exclusion_class" in ok and status is not None and status != "rejected":
        rep.warn(fid, "exclusion_class",
                 f"exclusion_class is set but status is '{status}'; the DT-33 exclusion list "
                 "only applies to rejected candidates")

    # Rule-ref consistency.
    ref = ok.get("rule_ref")
    lens = ok.get("lens")
    if ref:
        m = SKILL_RULE_RE.match(ref)
        if m:
            prefix = m.group("prefix")
            if prefix not in KNOWN_PREFIXES:
                rep.warn(fid, "rule_ref", f"prefix '{prefix}' is not a known skill rule prefix")
            elif lens and lens in LENS_PREFIX and prefix in LENS_PREFIX.values() \
                    and LENS_PREFIX[lens] != prefix:
                rep.warn(fid, "rule_ref",
                         f"'{ref}' belongs to another lens than '{lens}' "
                         f"(expected {LENS_PREFIX[lens]}-NN)")
            if lens == "project-tool":
                rep.warn(fid, "rule_ref",
                         "lens 'project-tool' is for project tool findings; use project:<tool>/<rule>")
        else:
            pm = PROJECT_RULE_RE.match(ref)
            if pm and isinstance(tool_versions, dict):
                tool = pm.group("tool")
                known = {k.lower() for k in tool_versions}
                if tool.lower() not in known:
                    rep.warn(fid, "rule_ref",
                             f"project tool '{tool}' has no pinned version in tool_versions "
                             "(tool claims need a recorded version, G201-F12)")


def _check_commit_review(rep: ValidationReport, fid: str, ok: Dict[str, Any],
                         checker: LocationChecker) -> None:
    """Check the review object against what the commit shows (reporting RP-07; protocol-change
    step 10). A commit that changes a contract source needs the kind 'contract-source': the fix
    takes effect only when the owner redeploys (user-policy-autonomy U01-F12). A subject with
    '!' before the colon needs the kind 'breaking-api', that kind needs the '!', and a
    'BREAKING CHANGE:' footer is expected (Conventional Commits 1.0.0; U01-F13)."""
    sha = ok["commit"]
    review = ok.get("review")
    kinds = set(review["kinds"]) if review else set()
    files = checker.commit_files(sha) or []
    contracts = [p for p in files if p.lower().endswith(CONTRACT_SOURCE_SUFFIXES)
                 and not p.lower().endswith(FOUNDRY_TEST_SUFFIX)]
    shown = ", ".join(contracts[:3]) + (", ..." if len(contracts) > 3 else "")
    if contracts and "whole-repo-format" in kinds:
        rep.error(fid, "review",
                  f"commit {sha[:12]} is a whole-repository format run that changes contract "
                  f"source(s) {shown}; it must leave every *.sol and *.vy file alone "
                  "(protocol-change PC-11; user-policy-autonomy U01-F12)")
    if contracts and "contract-source" not in kinds:
        rep.error(fid, "review",
                  f"commit {sha[:12]} changes contract source(s) {shown}: the finding needs a "
                  "review object whose kinds hold 'contract-source', because the fix takes "
                  "effect only when the owner redeploys and any source change alters the deployed "
                  "bytecode's metadata hash (user-policy-autonomy U01-F12)")
    message = checker.commit_message(sha)
    if message is None:
        return
    subject, marked, has_footer = parse_commit_message(message)
    if marked and "breaking-api" not in kinds:
        rep.error(fid, "review",
                  f"commit {sha[:12]} marks a breaking change ('!' before the colon in "
                  f"{subject!r}): the finding needs a review object whose kinds hold "
                  "'breaking-api' (protocol-change step 10; user-policy-autonomy U01-F13)")
    elif "breaking-api" in kinds and not marked:
        rep.error(fid, "review",
                  f"review.kinds holds 'breaking-api' but the subject of commit {sha[:12]}, "
                  f"{subject!r}, has no '!' before the colon (Conventional Commits 1.0.0; "
                  "protocol-change step 10)")
    if marked and not has_footer:
        rep.warn(fid, "review",
                 f"commit {sha[:12]} marks a breaking change but has no 'BREAKING CHANGE: "
                 "<what breaks>' footer (protocol-change step 10)")


def parse_commit_message(message: str) -> Tuple[str, bool, bool]:
    """(subject, marked, has_footer) of a commit message with any line ends: marked when the
    subject has '!' before its colon, has_footer when the body holds a 'BREAKING CHANGE:'
    footer (Conventional Commits 1.0.0; protocol-change step 10)."""
    text = message.replace("\r\n", "\n").strip("\n")
    subject, _sep, body = text.partition("\n")
    subject = subject.strip()
    return (subject, BREAKING_SUBJECT_RE.match(subject) is not None,
            BREAKING_FOOTER_RE.search(body) is not None)


def _check_live_effect(rep: ValidationReport, parsed: List[Dict[str, Any]]) -> None:
    """In autonomous mode, a finding on a live-effect path is never approved or applied, and an
    applied finding records its live-effect reading (prioritization, Money paths;
    user-policy-autonomy U01-F12)."""
    for p in parsed:
        status = p.get("status")
        notes = p.get("notes") or ""
        fid = str(p.get("id", "?"))
        hit = LIVE_EFFECT_KIND_RE.search(notes)
        if status in EDIT_STATUSES and hit:
            rep.error(fid, "notes",
                      f"a finding on a live-effect path ('{hit.group(0)}') is never approved or "
                      "applied in autonomous mode; set its status to reported with a report-only "
                      "row (prioritization, Money paths; user-policy-autonomy U01-F12)")
            continue
        if not LIVE_EFFECT_ANY_RE.search(notes):
            message = ("an applied finding needs its 'live-effect: none' entry in notes "
                       "(prioritization, Money paths)")
            if status in COMMITTED_STATUSES:
                rep.error(fid, "notes", message)
            elif status == "approved":
                rep.warn(fid, "notes", message)


def validate_document(doc: Any, repo: Optional[Path] = None, at: str = "auto",
                      nit_cap: int = DEFAULT_NIT_CAP) -> ValidationReport:
    """Validate a parsed findings document. Pure except for git/file reads when repo is set."""
    rep = ValidationReport()
    if not isinstance(doc, dict):
        rep.error(DOCUMENT, "<root>", f"must be a JSON object, got {type(doc).__name__}")
        return rep
    _check_top(doc, rep)
    tool_versions = doc.get("tool_versions") if isinstance(doc.get("tool_versions"), dict) else {}
    findings = doc.get("findings") if isinstance(doc.get("findings"), list) else []
    raw_base = doc.get("base_sha")
    base_sha = raw_base if isinstance(raw_base, str) and SHA_RE.match(raw_base) else None

    checker: Optional[LocationChecker] = None
    if repo is not None:
        if not repo.is_dir():
            rep.error(DOCUMENT, "--repo", f"{repo.as_posix()} is not a directory")
        else:
            checker = LocationChecker(repo, base_sha, at, rep)
            rep.repo_checked = repo.as_posix()

    seen_ids: Dict[str, int] = {}
    fingerprints: Dict[str, str] = {}
    parsed: List[Dict[str, Any]] = []
    for index, raw in enumerate(findings):
        label, ok = _check_finding(rep, index, raw, tool_versions)
        parsed.append(ok)
        if "id" in ok:
            if ok["id"] in seen_ids:
                rep.error(ok["id"], "id",
                          f"duplicate id (also finding[{seen_ids[ok['id']]}]); ids must be unique")
            else:
                seen_ids[ok["id"]] = index
        fp = ok.get("fingerprint")
        if fp:
            if fp in fingerprints:
                rep.warn(label, "fingerprint",
                         f"same fingerprint as {fingerprints[fp]}; possible duplicate finding")
            else:
                fingerprints[fp] = label
        if checker is not None:
            if "file" in ok and "line" in ok:
                checker.check(label, ok["file"], ok["line"], ok.get("end_line"))
            if ok.get("status") in COMMITTED_STATUSES and "commit" in ok:
                exists = checker.commit_exists(ok["commit"])
                if exists is False:
                    rep.error(label, "commit",
                              f"commit {ok['commit']} does not exist in the repository")
                elif exists:
                    _check_commit_review(rep, label, ok, checker)

    # Nit cap (G204-F08, T31-F11): a convention, hence a warning. It limits the main list
    # only; the overflow is listed in the report appendix (RP-06; eval-v1-calibration E01-F06).
    reported_nits = [p for p in parsed
                     if p.get("severity") == "nit" and p.get("status") not in NOT_REPORTED_STATUSES]
    if len(reported_nits) > nit_cap:
        rep.warn(DOCUMENT, "severity",
                 f"{len(reported_nits)} nits outside candidate/rejected exceed the cap of "
                 f"{nit_cap}; list at most {nit_cap} in the main list (\"Informational and "
                 "nits\") and every other one in the report's Appendix nit-overflow table "
                 "(RP-06)")

    # Approvals record for T1 edits (T31-F11; SKILL.md phase 6 table; U01-F04 in autonomous
    # mode).
    approved_by: Optional[Dict[str, int]] = None
    lane_count = 0
    if repo is not None and repo.is_dir():
        approved_by, lane_count = _check_approvals(rep, repo / ".harden" / "approvals.md",
                                                   parsed)
        if _run_mode(repo / ".harden") == "auto":
            _check_live_effect(rep, parsed)

    groups = Counter(decision_group(p) for p in parsed if "status" in p)
    rep.counts = {
        "findings": len(findings),
        "by_status": dict(Counter(p["status"] for p in parsed if "status" in p)),
        "by_severity": dict(Counter(p["severity"] for p in parsed if "severity" in p)),
        "by_tier": dict(Counter(p["tier"] for p in parsed if "tier" in p)),
        "by_lens": dict(Counter(p["lens"] for p in parsed if "lens" in p)),
        "by_decision_group": {g: groups[g] for g in DECISION_GROUPS if groups.get(g)},
        "blocking": sum(1 for p in parsed if p.get("blocking") is True
                        and p.get("status") not in NOT_REPORTED_STATUSES),
        "reported_nits": len(reported_nits),
    }
    if approved_by is not None and any(approved_by.values()):
        # Who approved the T1 findings: the run profile's switches or the user's words.
        rep.counts["t1_approved_by"] = dict(approved_by)
    if lane_count:
        # T2 findings the owner-judgement lane of an autonomous run approved (U01-F06).
        rep.counts["t2_applied_by_owner_judgement"] = lane_count
    return rep


APPROVAL_COLUMNS = ("category", "decision", "count", "user's exact words", "UTC time")
_EMPTY_CELLS = frozenset({"", "-", "—", "–", "n/a", "na", "none", "tbd", "..."})
# Autonomous mode (user-policy-autonomy U01-F01, U01-F04): the profile's auto_apply switches
# approve T1 items, and the words cell names the switch instead of quoting the user
# (protocol-change step 3: `auto (profile): auto_apply.<switch>=true`, also after
# `re-tiered to <tier> by <rule id>, `).
AUTO_PROFILE_PREFIX = "auto (profile)"
AUTO_APPLY_SWITCHES = ("structural", "behavioural", "dependencies", "money_paths",
                       "owner_judgement", "dependency_versions")
# Dependency items that add or change a resolved version in a lockfile: they need
# auto_apply.dependency_versions on top of dependencies (prioritization Tier table row 11;
# user-policy-autonomy U01-F08).
VERSION_MOVING_RULES = frozenset({"DP-08", "DP-09", "DP-10", "SE-21"})
_AUTO_SWITCH_RE = re.compile(r"auto_apply\.([A-Za-z_]+)\s*=\s*([A-Za-z]+)")
_QUOTE_CHARS = "`*\"'“”"
# Run modes whose approvals are the user's live answers ("apply" is the older name).
INTERACTIVE_MODES = frozenset({"interactive", "apply"})
AUTO_ROW_FORMAT = "`auto (profile): auto_apply.<switch>=true`"


def _norm_category(text: str) -> str:
    """Category cell or lens id in one comparable form: 'Dead code' / `lens-dead-code.md` ->
    'dead-code'."""
    value = text.strip().strip("`*\"'").lower()
    if value.endswith(".md"):
        value = value[:-3]
    if value.startswith("lens-"):
        value = value[5:]
    return re.sub(r"[\s_]+", "-", value)


def parse_approvals(text: str) -> List[Dict[str, str]]:
    """Rows of the approvals table (SKILL.md phase 6: category | decision | count | the user's
    exact words | UTC time). The header and separator rows are skipped."""
    rows: List[Dict[str, str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) < len(APPROVAL_COLUMNS):
            continue
        if all(re.fullmatch(r":?-+:?", c) for c in cells if c):
            continue  # separator row
        if cells[0].lower() == "category" and cells[1].lower() == "decision":
            continue  # header row
        rows.append({"category": cells[0], "decision": cells[1], "count": cells[2],
                     "quote": cells[3], "time": cells[4]})
    return rows


def is_auto_profile_quote(quote: str) -> bool:
    """True for a words cell the run profile wrote (`auto (profile): ...`)."""
    return quote.strip().strip(_QUOTE_CHARS).strip().lower().startswith(AUTO_PROFILE_PREFIX)


def expected_switches(finding: Dict[str, Any]) -> List[str]:
    """The auto_apply switches that approve a finding (protocol-change step 3): dependencies
    for a dependency, manifest or lockfile item, plus dependency_versions for one that adds or
    changes a resolved version (DP-08, DP-09, DP-10, SE-21; user-policy-autonomy U01-F08),
    with behavioural too when such an item is behavioural; else its class (structural,
    behavioural)."""
    ref = str(finding.get("rule_ref") or "").strip().upper()
    if ref in VERSION_MOVING_RULES:
        return ["dependencies", "dependency_versions"] + (
            ["behavioural"] if finding.get("class") == "behavioural" else [])
    if finding.get("lens") == "dependencies":
        return ["dependencies"]
    return [str(finding.get("class") or "structural")]


def _run_mode(hdir: Path) -> Optional[str]:
    """The run mode of .harden/active (an interactive run that fell back to report-only keeps
    its requested mode), or None without a readable marker."""
    try:
        marker = json.loads((hdir / "active").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None
    if not isinstance(marker, dict) or not isinstance(marker.get("mode"), str):
        return None
    mode = marker["mode"]
    if mode == "report-only" and marker.get("mode_requested") in INTERACTIVE_MODES:
        mode = str(marker["mode_requested"])
    return mode


@dataclass
class ApprovalContext:
    """What an 'auto (profile)' row is checked against: the run profile's auto_apply switches
    (None when .harden/profile.json is missing or unreadable, with the reason) and the run
    mode of .harden/active (None without a readable marker)."""

    switches: Optional[Dict[str, Any]]
    profile_problem: Optional[str]
    mode: Optional[str]
    # money_paths_globs when they decide (a valid profile whose every pattern matches a file of
    # the base commit); None when the run classifies money paths by judgement.
    money_globs: Optional[List["vp.MoneyGlob"]] = None

    def money_pattern(self, finding: Dict[str, Any]) -> Optional[str]:
        """The money_paths_globs pattern that puts the finding's file on a money path."""
        path = finding.get("file")
        if not self.money_globs or not isinstance(path, str):
            return None
        hit = vp.money_glob_match(posixpath.normpath(path.replace("\\", "/")),
                                  self.money_globs)
        return hit.raw if hit else None

    @staticmethod
    def load(hdir: Path) -> "ApprovalContext":
        switches: Optional[Dict[str, Any]] = None
        problem: Optional[str] = None
        profile = hdir / "profile.json"
        if not profile.is_file():
            problem = ("there is no .harden/profile.json, the owner's run profile whose "
                       "auto_apply switches such a row cites (user-policy-autonomy U01-F04)")
        else:
            try:
                data = json.loads(profile.read_text(encoding="utf-8-sig"))
            except (OSError, ValueError) as exc:
                problem = f".harden/profile.json cannot be read ({exc})"
            else:
                raw = data.get("auto_apply") if isinstance(data, dict) else None
                switches = raw if isinstance(raw, dict) else {}
        mode = _run_mode(hdir)
        try:
            marker = json.loads((hdir / "active").read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            marker = None
        money_globs: Optional[List[vp.MoneyGlob]] = None
        if switches is not None:
            base = marker.get("base_sha") if isinstance(marker, dict) else None
            try:
                check = vp.check_file(profile, repo=hdir.parent,
                                      base=base if isinstance(base, str) and base else "HEAD")
            except vp.ProfileReadError:
                check = None
            if check is not None and check.money_paths_source == "globs":
                money_globs = vp.compile_money_globs(
                    (check.resolved or {}).get(vp.MONEY_GLOBS_KEY) or [])[0]
        return ApprovalContext(switches=switches, profile_problem=problem, mode=mode,
                               money_globs=money_globs)


def auto_row_problem(quote: str, finding: Dict[str, Any], ctx: ApprovalContext
                     ) -> Optional[str]:
    """Why an 'accepted' row whose words cell is `auto (profile): ...` does not approve this
    T1 finding, or None when it does. The row must name the switch the finding needs
    (expected_switches), every switch it names must be true, and the run profile must set each
    one to true (prioritization PZ-24 Detect: "a row naming a switch the profile sets to
    true"; a switch the profile does not set reads as false). An --interactive run takes the
    user's live answer instead (user-policy-autonomy U01-F01)."""
    if ctx.mode in INTERACTIVE_MODES:
        return (f"this run is --interactive (mode '{ctx.mode}' in .harden/active), so a T1 "
                f"approval quotes the user's live answer; an 'auto (profile)' row does not "
                f"approve it")
    named = _AUTO_SWITCH_RE.findall(quote)
    need = expected_switches(finding)
    if not named:
        return f"it names no switch; write {AUTO_ROW_FORMAT} with the switch it rests on"
    unknown = sorted({name for name, _value in named if name not in AUTO_APPLY_SWITCHES})
    if unknown:
        return "it names unknown switch(es) {} (known: {})".format(
            ", ".join(unknown), ", ".join(AUTO_APPLY_SWITCHES))
    false = sorted({name for name, value in named if value.lower() != "true"})
    if false:
        return "an 'accepted' row cannot rest on auto_apply.{}={}".format(
            false[0], dict(named)[false[0]])
    names = {name for name, _value in named}
    kinds = set((finding.get("review") or {}).get("kinds") or [])
    if (finding.get("tier") == "T2" or kinds & LANE_REVIEW_KINDS) and \
            "owner_judgement" not in names:
        return ("a T2 item, an additive or breaking API change or a whole-repository format run "
                "needs auto_apply.owner_judgement=true: only the owner-judgement lane of an "
                "autonomous run applies it (prioritization, Autonomous mode; user-policy-autonomy "
                "U01-F06)")
    missing = [n for n in need if n not in names]
    if missing:
        return (f"a {finding.get('class')} finding of lens '{finding.get('lens')}' needs "
                + " and ".join(f"auto_apply.{n}=true" for n in missing)
                + " (protocol-change step 3)")
    if ctx.switches is None:
        return str(ctx.profile_problem)
    unset = sorted({name for name, _value in named if ctx.switches.get(name) is not True})
    if unset:
        return "the run profile .harden/profile.json sets {} (a switch it does not set reads " \
               "as false)".format(", ".join("auto_apply.{}={}".format(
                   name, json.dumps(ctx.switches.get(name))) for name in unset))
    return None


def _check_approvals(rep: ValidationReport, path: Path, parsed: List[Dict[str, Any]]
                     ) -> Tuple[Dict[str, int], int]:
    """Every approved, applied or partial T1 finding needs an 'accepted' row for its category:
    with the user's exact words with --interactive (skill-design T31-F11: T1 fixes only after
    the user approves the category), or, in autonomous mode, the profile switch it rests on
    (`auto (profile): auto_apply.<switch>=true`, checked by auto_row_problem; user-policy-
    autonomy U01-F04). The category cell names the finding's lens (e.g. dead-code or "dead
    code"), its rule prefix (DC), its rule id (DC-03) or the finding id. A T2 finding in those
    statuses was approved by the owner-judgement lane of an autonomous run (prioritization,
    Autonomous mode; U01-F06): it needs an 'accepted' row whose category cell is its own id and
    whose 'auto (profile)' words also name auto_apply.owner_judgement=true; a quoted user answer
    never approves it. Returns ({"profile": n, "user": m} for T1 findings, the number of T2
    findings the lane approved)."""
    approved_by = {"profile": 0, "user": 0}
    lane_count = 0
    edits = [p for p in parsed
             if p.get("tier") in ("T1", "T2")
             and p.get("status") in ("approved", "applied", "partial")]
    if not edits:
        return approved_by, lane_count
    where = ".harden/approvals.md"
    row_format = (f"| {' | '.join(APPROVAL_COLUMNS)} |, where the words cell quotes the user "
                  f"(--interactive) or reads {AUTO_ROW_FORMAT} (autonomous mode)")
    if not path.is_file():
        ids = ", ".join(str(p.get("id", "?")) for p in edits[:5])
        rep.error(DOCUMENT, "status",
                  f"T1 or T2 findings approved/applied/partial ({ids}) but {where} does not "
                  f"exist; record each category decision as a row {row_format}")
        return approved_by, lane_count
    try:
        rows = parse_approvals(path.read_text(encoding="utf-8-sig", errors="replace"))
    except OSError as exc:
        rep.error(DOCUMENT, "status", f"cannot read {where}: {exc}")
        return approved_by, lane_count
    ctx: Optional[ApprovalContext] = None
    for finding in edits:
        fid = str(finding.get("id", "?"))
        t2 = finding.get("tier") == "T2"
        keys = {_norm_category(fid)}
        if not t2:
            keys.add(_norm_category(str(finding.get("lens", ""))))
            ref = finding.get("rule_ref")
            if isinstance(ref, str):
                keys.add(_norm_category(ref))
                match = SKILL_RULE_RE.match(ref)
                if match:
                    keys.add(_norm_category(match.group("prefix")))
        keys.discard("")
        matching = [r for r in rows if _norm_category(r["category"]) in keys]
        accepted = [r for r in matching if r["decision"].strip().lower() == "accepted"]
        if not accepted:
            if t2:
                rep.error(fid, "status",
                          f"T2 finding is '{finding.get('status')}' but {where} has no "
                          f"'accepted' row for {fid}; the owner-judgement lane writes one row "
                          f"per item: `auto (profile): owner judgement, T2 by <rule id>, "
                          f"auto_apply.owner_judgement=true, auto_apply.<switch>=true` "
                          f"(prioritization, Autonomous mode; user-policy-autonomy U01-F06)")
            else:
                rep.error(fid, "status",
                          f"T1 finding is '{finding.get('status')}' but {where} has no "
                          f"'accepted' row for its category (lens '{finding.get('lens')}'); "
                          f"record the decision as {row_format}")
            continue
        quoted = [r for r in accepted if not is_auto_profile_quote(r["quote"])
                  and r["quote"].strip().strip(_QUOTE_CHARS).lower() not in _EMPTY_CELLS]
        if quoted and not t2:
            approved_by["user"] += 1
            continue
        auto_rows = [r for r in accepted if is_auto_profile_quote(r["quote"])]
        if not auto_rows:
            if t2:
                rep.error(fid, "status",
                          f"the 'accepted' row for {fid} in {where} quotes a user answer, which "
                          f"never approves a T2 item: only the owner-judgement lane of an "
                          f"autonomous run applies one (auto_apply.owner_judgement), and "
                          f"--interactive keeps T2 items report-only (invariant 8)")
            else:
                rep.error(fid, "status",
                          f"the 'accepted' row for category '{accepted[0]['category']}' in "
                          f"{where} has no user's exact words; approval must quote the user "
                          f"(--interactive) or, in autonomous mode, name the profile switch as "
                          f"{AUTO_ROW_FORMAT}")
            continue
        if ctx is None:
            ctx = ApprovalContext.load(path.parent)
        problems = [(r, auto_row_problem(r["quote"], finding, ctx)) for r in auto_rows]
        if any(problem is None for _row, problem in problems):
            if t2:
                lane_count += 1
            else:
                approved_by["profile"] += 1
            approving = [r for r, problem in problems if problem is None]
            pattern = ctx.money_pattern(finding)
            if pattern is not None and not any(
                    (name, value.lower()) == ("money_paths", "true")
                    for r in approving for name, value in _AUTO_SWITCH_RE.findall(r["quote"])):
                rep.warn(fid, "status",
                         f"{finding.get('tier')} finding is '{finding.get('status')}' at "
                         f"{finding.get('file')}, "
                         f"which money_paths_globs pattern {pattern!r} puts on a money path, "
                         f"but none of the auto (profile) rows that approve it names "
                         f"auto_apply.money_paths=true; only a change proven AST-identical to "
                         f"its parent may skip that switch (protocol-change step 3; "
                         f"pilot-auto-calibration A01-F01, A01-F06)")
            review = finding.get("review")
            if pattern is not None and review is not None \
                    and "money-path" not in (review.get("kinds") or []):
                rep.warn(fid, "review",
                         f"{finding.get('file')} is on a money path (money_paths_globs pattern "
                         f"{pattern!r}) but review.kinds lacks 'money-path', so Applied, review "
                         f"before merge would not show it as one (reporting RP-07)")
            continue
        row, problem = problems[0]
        rep.error(fid, "status",
                  f"the 'accepted' row for category '{row['category']}' in {where} is an "
                  f"'auto (profile)' approval (accepted in autonomous mode) that does not "
                  f"approve this finding: {problem}")
    return approved_by, lane_count


class UnreadableInput(Exception):
    """The input file could not be read or parsed as JSON."""


def load_json(path: Path) -> Any:
    """Read UTF-8 JSON (a BOM, as written by Windows PowerShell, is accepted)."""
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError as exc:
        raise UnreadableInput(f"file not found: {path.as_posix()}") from exc
    except UnicodeDecodeError as exc:
        raise UnreadableInput(f"not valid UTF-8: {path.as_posix()} ({exc})") from exc
    except OSError as exc:
        raise UnreadableInput(f"cannot read {path.as_posix()}: {exc}") from exc
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise UnreadableInput(
            f"malformed JSON in {path.as_posix()} at line {exc.lineno} column {exc.colno}: {exc.msg}"
        ) from exc


def default_repo_for(findings_path: Path) -> Optional[Path]:
    """Parent of the `.harden/` directory holding the findings file, if that is where it lives."""
    resolved = findings_path.resolve()
    if resolved.parent.name == ".harden":
        return resolved.parent.parent
    return None


def _render_text(path: Path, rep: ValidationReport) -> str:
    state = "VALID" if rep.valid else "INVALID"
    lines = [f"{path.as_posix()}: {state} - {rep.counts.get('findings', 0)} findings, "
             f"{len(rep.errors)} errors, {len(rep.warnings)} warnings"]
    if rep.repo_checked is None:
        lines.append("  note: file/line locations and commits were not checked "
                     "(pass --repo DIR)")
    groups = rep.counts.get("by_decision_group")
    if groups:
        lines.append("  groups: " + ", ".join(f"{k} {v}" for k, v in groups.items()))
    approved_by = rep.counts.get("t1_approved_by")
    if approved_by:
        lines.append("  T1 approvals: {} by the run profile ('auto (profile)' rows, autonomous "
                     "mode), {} by the user's words".format(approved_by.get("profile", 0),
                                                            approved_by.get("user", 0)))
    lane = rep.counts.get("t2_applied_by_owner_judgement")
    if lane:
        lines.append("  T2 approvals: {} by the owner-judgement lane (auto_apply.owner_judgement; "
                     "listed under Applied, review before merge)".format(lane))
    lines.extend("  " + i.render() for i in rep.errors)
    lines.extend("  " + i.render() for i in rep.warnings)
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(
        description="Validate a harden findings.json / candidates.json file.")
    parser.add_argument("findings", help="path to findings.json")
    repo_group = parser.add_mutually_exclusive_group()
    repo_group.add_argument("--repo", help="repository root: check files, lines, base_sha and "
                                           "commits (default: parent of .harden/)")
    repo_group.add_argument("--no-repo", action="store_true", help="skip repository checks")
    parser.add_argument("--at", choices=("auto", "worktree", "base"), default="auto",
                        help="where file:line is checked (default auto: working tree, then base_sha)")
    parser.add_argument("--nit-cap", type=int, default=DEFAULT_NIT_CAP,
                        help=f"warn above this many reported nits (default {DEFAULT_NIT_CAP})")
    parser.add_argument("--json", action="store_true", help="print a JSON report")
    args = parser.parse_args(argv)

    path = Path(args.findings)
    try:
        doc = load_json(path)
    except UnreadableInput as exc:
        if args.json:
            print(json.dumps({"valid": False, "unreadable": str(exc)}, indent=2))
        else:
            print(f"ERROR   {exc}", file=sys.stderr)
        return 2
    repo: Optional[Path] = None
    if args.repo:
        repo = Path(args.repo).resolve()
    elif not args.no_repo:
        repo = default_repo_for(path)
    rep = validate_document(doc, repo=repo, at=args.at, nit_cap=args.nit_cap)
    if args.json:
        out = rep.to_dict()
        out["file"] = path.as_posix()
        print(json.dumps(out, indent=2, ensure_ascii=False))
    else:
        print(_render_text(path, rep))
    return 0 if rep.valid else 1


if __name__ == "__main__":
    sys.exit(main())
