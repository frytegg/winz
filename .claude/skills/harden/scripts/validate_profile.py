#!/usr/bin/env python3
"""validate_profile.py - check a /harden run profile (.harden/profile.json).

Purpose
    The run profile is the owner's consent for an autonomous /harden run, written before the
    run (user-policy-autonomy U01-F04). In autonomous mode, the default, the run never waits
    for the user (U01-F01): every question the workflow would ask is answered from this file,
    and a value the file lacks takes its conservative default, which the run logs. This script
    checks the file against the format below (assets/profile.schema.json documents the same
    format), prints each problem with its JSON path, lists the defaults taken, and says whether
    the profile lets an autonomous run execute project code and apply changes. run_state.py
    start, hook_guard.py (forbidden_commands) and verify_branch.py use the same checks through
    this module, so the three never disagree. Given --repo, it also refuses a profile that
    repository tracks or holds in the base commit (below).

Format (a JSON object; assets/profile.example.json holds two complete profiles)
    version            1 (required)
    mode               "auto" (default) or "report-only" (the run never edits). The live
                       approvals of --interactive are chosen on the command line, not here.
    gates              [{name, cmd, cwd?, timeout_s?, count_regex?, count_mode?, ratchet?,
                         shell?, env?, pipefail?, inherit_env?, env_allowlist?}] in gates.py's
                       format (gates.py --help); cwd is repository-relative. Default []: an
                       autonomous run then executes no project code (protocol-preflight PF-20).
    e2e                [{name, cmd, cwd?, timeout_s?, compare?, shell?, env?, pipefail?,
                         inherit_env?, env_allowlist?}]: end-to-end checks (the app boots, a CLI
                       smoke run, a route probe) that verify_branch.py runs from a fresh clone
                       after the last fix (U01-F02). compare: true requires the base's and the
                       branch's stdout to match once timestamps, durations and the clone's path
                       are masked. Default []: the final verdict is "gates only".
    network            "denied" (default) | "registry-only" (lockfile installs only) | "allowed"
                       (skill-design T31-F15: network actions only on explicit request)
    live_side_effects  "unconfirmed" (default: no project code runs, PF-03) | "none" (the owner
                       confirms that no gate, install or e2e command can reach live endpoints,
                       keys, orders or chains)
    forbidden_commands [pattern, ...], default []. A plain string matches as a case-insensitive
                       substring of the command, after whitespace runs are folded to one space;
                       the command is also tried with its quote characters removed. "/regex/"
                       or "/regex/i" is a Python regular expression searched in the same forms,
                       and in a form where the options of each `node` word up to its script are
                       removed (`node --require <guard> dist/cli.js value` meets a ban written
                       for `node dist/cli.js value`; pilot-auto-calibration A01-F57).
                       hook_guard.py refuses every Bash/PowerShell command that matches
                       (in an orchestrator Bash command, a here-document with a quoted
                       delimiter that cat or tee writes to a file under .harden/, and plain
                       echo or printf arguments written there, are left out when the rest of
                       the command runs only cd, read-only git or git add, and the skill's
                       bookkeeping scripts; pilot-auto-calibration A01-F54)
                       (reason_code profile-forbidden; U01-F03), and verify_branch.py refuses a
                       check whose command matches.
    situation          one of SITUATIONS (prioritization.md step 3); default "maintenance only"
    future_work        [repo-relative path or glob, ...]: modules planned work will touch
                       (prioritization.md step 3, they count as hot); default []. For dead code
                       an empty list is no answer: code never referenced outside its file
                       stays work in progress until the list is non-empty (DC-17, A01-F17)
    auto_apply         {"structural", "behavioural", "dependencies", "money_paths",
                       "owner_judgement", "dependency_versions"}: booleans; which categories an
                       autonomous run applies without asking. A switch the profile does not set
                       reads as false. dependency_versions, on top of dependencies, approves a
                       dependency change that adds or changes a resolved version in a lockfile
                       (DP-08, DP-09, DP-10, SE-21); self-setup never sets it (U01-F08).
                       owner_judgement lets the run decide, item by item, what the tier table
                       leaves to the owner (T2, an additive public API change, a whole-repository
                       format run) with prioritization.md's Owner-judgement lane: applied on the
                       branch when a test or the change's own proof demonstrates it, listed for
                       review before merge (user-policy-autonomy U01-F06). Never applied
                       unattended, whatever these say: a change on a live-effect path (keys,
                       signing, order or transaction submission, deploys), secrets, CI and gate
                       configs, history, test deletions and removals or changes of existing test
                       lines (checked additions are applied, U01-F07) (U01-F03, U01-F12).
    money_paths_globs  [glob, ...]: which files are on a money, order, key, signing or
                       transaction path (pilot-auto-calibration A01-F06). Absent (default):
                       the lens and verifier judgement decides, and a disagreement takes the
                       reading that withholds. Present, even empty: a file is on a money path
                       when its repository-relative path, or a directory above it, matches a
                       pattern, and otherwise it is not, except code that signs, sends orders
                       or transactions, or handles keys, which stays on one whatever the list
                       says (A01-F08; the run judges that, this script cannot). Dialect
                       (A01-F07): the .gitignore pattern format without '!' negation,
                       backslash escapes or comments. '*', '?' and '[...]' stay inside one
                       path segment, '**' is a whole segment, a pattern without '/' (other
                       than a trailing one) matches a name at any depth, and a trailing '/'
                       matches a directory, never a file. Write '[[]' for a literal '['; a
                       negated class '[!...]' may also match '/', which only widens the list.
                       Letter case is ignored on every platform. With --repo, a pattern that
                       matches no file of the base commit makes the run ignore the list
                       (judgement again) until every pattern matches one.
    sandbox_ack        true acknowledges that project code runs without a Claude Code sandbox
                       (native Windows has none) or in bypassPermissions mode (PF-03); default
                       false
    budget             {"max_tokens": int|null, "deadline_utc": "YYYY-MM-DDTHH:MM[:SS]Z"|null,
                        "max_usd": number|null (0 < USD <= 10000, list prices), "max_minutes":
                        int|null (30 to 2880)}: budget.py's deadline is the earlier of
                       deadline_utc and start + max_minutes; max_usd, when set, caps the spend
                       (pilot-auto-calibration A01-F34)
    detection          {"max_concurrent_subagents": 1-16 (default 4), "lens_bundles": "auto" |
                       "single" | "grouped" (default auto), "pass_model": model alias or id |
                       null} (pilot-auto-calibration A01-F33, A01-F35, A01-F36)
    origin             {"kind": "owner" | "inferred", "tool", "tool_version", "created_utc",
                       "base_sha", "report_sha256", "consent"}: who wrote the profile. Absent or
                       "owner": the owner's file (U01-F04); "inferred": written by
                       infer_profile.py during self-setup (protocol-preflight PF-23), the owner's
                       /harden invocation being the consent (U01-F05)
    provenance         {"<field key>": [{"source", "line"?, "detail"?}, ...]}: where each
                       field's value came from (a tracked file and line, a rule, the platform,
                       an owner decision, the pre-start probe or the review; PF-23). Keys:
                       mode, network, live_side_effects, sandbox_ack, situation, future_work,
                       budget, env, install, auto_apply.<switch>, gates.<name>, e2e.<name>,
                       forbidden_commands[<i>], money_paths_globs[<i>]. Ignored by every decision
    comment, $comment  notes: a string or a list of strings; $schema: a string
    template           written by `run_state.py profile-template`: a profile that still carries
                       it is the unreviewed template, and it is invalid
    Any other key is an error: a misspelt key would otherwise be ignored silently.

Assessment ("blockers")
    A valid profile can still keep an autonomous run report-only for anything that executes
    project code: mode "report-only", live_side_effects not "none", no gates, sandbox_ack
    false on native Windows, or a budget deadline already passed. autonomous_apply is true
    only for a valid profile without blockers.

A profile the repository holds is no profile (--repo)
    The profile is the owner's own untracked file. A profile file inside the git work tree of
    --repo that git tracks (`git ls-files --error-unmatch` exits 0) or that the base commit
    holds (`git cat-file -e <base>:<path>`, even after `git rm --cached`) is repository text
    (SKILL.md invariant 6, protocol-preflight PF-08), never the owner's consent (PF-22;
    user-policy-autonomy U01-F04). It is invalid, with the error "profile is tracked by the
    repository; the owner's profile must be untracked (...)", and run_state.py start --mode
    auto then starts report-only with that reason. The file is checked as named and with its
    links resolved. A --repo that is not a git work tree holds nothing; a git that cannot
    answer, or a --base that names no commit, makes the profile invalid (an unchecked profile
    is no consent).

CLI
    python validate_profile.py PATH [--repo DIR [--base REV]] [--json]
                                                              (python3 on macOS/Linux)
    --repo  also check that every gate and e2e cwd exists as a directory in DIR, and that the
            repository in DIR neither tracks PATH nor holds it in the base commit
    --base  the base commit of that check and of the money_paths_globs coverage (default
            HEAD: the base of a run not started yet)
    --json  print {path, valid, errors, warnings, defaults, blockers, autonomous_apply,
            tracked, sha256, summary}

    python validate_profile.py PATH --repo DIR [--base REV] --classify [FILE ...]
                               [--staged] [--paths-from LIST] [--json]
    --classify    say for each FILE whether money_paths_globs puts it on a money path. A
                  FILE is repository-relative whatever the current directory; an absolute
                  path must lie inside the repository; '\\' counts as '/'. Also each path of
                  LIST, and with --staged each staged path. With no FILE, LIST or --staged:
                  every file of the base commit (--base, default HEAD; the index while HEAD
                  names no commit). stdout holds one line per path,
                  "<verdict><TAB><path><TAB><pattern or ->", where the verdict is
                  money-path, not-money-path, or judgement (money_paths_globs is not set, or
                  is ignored because a pattern matches no file of the base commit), or
                  "error<TAB><argument><TAB><why>" for an argument that is no path inside
                  the repository. A path holding a tab or a line break is printed as a JSON
                  string. The last line starts with "# " and counts the verdicts. The
                  validation report goes to stderr; an invalid profile classifies nothing.
                  The script reads paths, not code: a not-money-path file still holds a
                  money path where the changed code signs, sends orders or transactions, or
                  handles keys (A01-F08).
    --staged      with --classify: add the paths `git diff --cached --name-only
                  --no-renames -z` prints (both sides of a rename)
    --paths-from  with --classify: add the paths listed in LIST ('-' reads stdin): UTF-8,
                  a BOM tolerated, LF or CRLF line ends; blank lines and lines starting with
                  '#' are skipped and surrounding whitespace is removed
    --json        with --classify: print {path, sha256, valid, errors, warnings,
                  money_paths_globs, source, unmatched, results: [{input, path, verdict,
                  pattern, problem}], counts}

Exit codes
    0  the profile is valid (its blockers, if any, are printed); with --classify, every
       path was classified
    1  the profile is invalid (every error is printed); --classify then classifies nothing
    2  usage error, or the file cannot be read; with --classify, also an argument that is no
       path inside the repository (the other paths are still printed) or a git that cannot
       list the tracked or staged files

Python 3.9+ standard library only (also runs under `python -S`); no network; the file is read
as UTF-8 (a BOM is tolerated); git runs without a shell, only with --repo.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import subprocess
import sys
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)

VERSION = 1
PROFILE_MODES = ("auto", "report-only")
NETWORK_VALUES = ("denied", "registry-only", "allowed")
LIVE_SIDE_EFFECTS_VALUES = ("none", "unconfirmed")
SITUATIONS = ("release preparation", "handover", "open-sourcing", "pre-audit",
              "maintenance only", "prototype becoming a product", "agent feature work next")
AUTO_APPLY_KEYS = ("structural", "behavioural", "dependencies", "money_paths", "owner_judgement",
                   "dependency_versions")
# Which files are money, order, key, signing or transaction paths (pilot-auto-calibration
# A01-F06 to A01-F08). Absent: judgement; present: the owner's list, matched below.
MONEY_GLOBS_KEY = "money_paths_globs"
MONEY_UNSET_DEFAULT = ("money_paths_globs: not set (the lens and verifier judgement decides "
                       "which items are on a money, order, key, signing or transaction path, "
                       "and a disagreement takes the reading that withholds; user-policy-"
                       "autonomy U01-F01)")
BUDGET_KEYS = ("max_tokens", "deadline_utc", "max_usd", "max_minutes")
# How detection runs (pilot-auto-calibration A01-F33, A01-F35, A01-F36).
DETECTION_KEY = "detection"
DETECTION_KEYS = ("max_concurrent_subagents", "lens_bundles", "pass_model")
DETECTION_DEFAULTS: Dict[str, Any] = {"max_concurrent_subagents": 4, "lens_bundles": "auto",
                                      "pass_model": None}
LENS_BUNDLE_VALUES = ("auto", "single", "grouped")
_PASS_MODEL_RE = re.compile(r"^[A-Za-z0-9._:\[\]-]{1,100}$")
# Who wrote the profile and where each field came from (self-setup, protocol-preflight PF-23;
# user-policy-autonomy U01-F05).
ORIGIN_KEY = "origin"
PROVENANCE_KEY = "provenance"
ORIGIN_KINDS = ("owner", "inferred")
ORIGIN_KEYS = ("kind", "tool", "tool_version", "created_utc", "base_sha", "report_sha256",
               "consent")
PROVENANCE_ENTRY_KEYS = ("source", "line", "detail")
PROVENANCE_KEY_RE = re.compile(
    r"^(?:mode|network|live_side_effects|sandbox_ack|situation|future_work|budget|env|install"
    r"|auto_apply\.[a-z_]+|(?:gates|e2e)\.\S+|(?:forbidden_commands|money_paths_globs)\[\d+\])$")
_CREATED_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$")
_BASE_SHA_RE = re.compile(r"^[0-9a-f]{40}([0-9a-f]{24})?$")
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
# PF-10: never run deploy, publish, release, migrate or seed commands; SKILL.md: never push
# unless asked. The bans every drafted or inferred profile starts from (run_state.py
# profile-template, infer_profile.py); the owner or the classification adds the project's own.
GENERIC_BANS = (
    "/\\bgit\\s+push\\b/",
    "/\\b(npm|pnpm|yarn|bun|make)\\s+(run\\s+)?(deploy|publish|release|migrate|seed)\\b/i",
    "/\\b(cargo|poetry|uv)\\s+publish\\b/i",
    "/\\btwine\\s+upload\\b/i",
)
COMMENT_KEYS = ("comment", "$comment")
TEMPLATE_KEY = "template"
# Conservative defaults for a value the profile lacks (U01-F01; prioritization.md step 3).
DEFAULTS: Dict[str, Any] = {
    "mode": "auto",
    "gates": [],
    "e2e": [],
    "network": "denied",
    "live_side_effects": "unconfirmed",
    "forbidden_commands": [],
    "situation": "maintenance only",
    "future_work": [],
    "sandbox_ack": False,
}
TOP_KEYS = frozenset(["version", "budget", "auto_apply", MONEY_GLOBS_KEY, "$schema",
                      TEMPLATE_KEY, DETECTION_KEY, ORIGIN_KEY, PROVENANCE_KEY]
                     + list(DEFAULTS) + list(COMMENT_KEYS))
COMMON_CHECK_KEYS = frozenset(["name", "cmd", "cwd", "timeout_s", "shell", "env", "pipefail",
                               "inherit_env", "env_allowlist"])
GATE_KEYS = COMMON_CHECK_KEYS | {"count_regex", "count_mode", "ratchet"}
E2E_KEYS = COMMON_CHECK_KEYS | {"compare"}
COUNT_MODES = ("sum", "last", "max", "matches")
DEFAULT_TIMEOUT_S = 1800
SHORT_SUBSTRING = 4
_REGEX_FORM = re.compile(r"^/(.*)/(i?)$", re.S)
_QUOTES_RE = re.compile(r"[\"'`]")
_DRIVE_RE = re.compile(r"^[A-Za-z]:")
_MSYS_DRIVE_RE = re.compile(r"^/([A-Za-z])(/|$)")
_DEADLINE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)"
                          r"(Z|\+00:00)$")
# The reason an autonomous run gives when the repository holds the profile (PF-22).
TRACKED_REASON = ("profile is tracked by the repository; the owner's profile must be "
                  "untracked")
GIT_TIMEOUT_S = 60


class ProfileReadError(RuntimeError):
    """The profile file cannot be read at all (missing, a directory, no permission)."""


class TrackingCheckError(RuntimeError):
    """git cannot tell whether the repository holds the profile file."""


# ---------------------------------------------------------------------------
# forbidden_commands: shared by hook_guard.py, run_state.py and verify_branch.py
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ForbiddenPattern:
    """One forbidden_commands entry: a case-insensitive substring or a /regex/."""

    raw: str
    regex: Optional["re.Pattern[str]"] = None
    needle: Optional[str] = None

    def matches(self, variants: Sequence[str]) -> bool:
        for text in variants:
            if self.regex is not None:
                if self.regex.search(text):
                    return True
            elif self.needle and self.needle in text.casefold():
                return True
        return False


def normalise_command(text: str) -> str:
    """A command with line continuations joined and whitespace runs folded to one space."""
    joined = text.replace("\\\r\n", " ").replace("\\\n", " ").replace("`\r\n", " ") \
        .replace("`\n", " ")
    return re.sub(r"\s+", " ", joined).strip()


# Node options that take a value (e2e_reach.NODE_VALUE_OPTS). A variant without the options of
# each `node` word lets a ban written for `node dist/cli.js value` meet `node --require
# <guard> dist/cli.js value` (pilot-auto-calibration A01-F57); a variant only adds matches.
NODE_VALUE_OPTS = frozenset({"-r", "--require", "--import", "--loader", "--env-file",
                             "--experimental-loader", "-C", "--conditions"})
_NODE_WORD_RE = re.compile(r"^(?:.*[/\\])?node(?:\.exe)?$", re.IGNORECASE)


def _split_words(text: str) -> List[str]:
    """Quote-aware words of a command (shlex, POSIX rules), or whitespace words when the
    quotes do not balance."""
    import shlex
    try:
        return shlex.split(text, posix=True)
    except ValueError:
        return text.split()


def strip_node_options(command: str) -> str:
    """`command` with the options between every `node` word and its first non-option word
    removed (values of NODE_VALUE_OPTS included)."""
    words = _split_words(command)
    out: List[str] = []
    i = 0
    while i < len(words):
        word = words[i]
        out.append(word)
        i += 1
        if not _NODE_WORD_RE.match(word):
            continue
        while i < len(words) and words[i].startswith("-") and words[i] not in ("-", "--"):
            i += 2 if words[i] in NODE_VALUE_OPTS else 1
    return " ".join(out)


def command_variants(command: str) -> List[str]:
    """The forms a command is matched in: normalised, normalised without quote characters
    (`npm run "deploy"` still matches the substring `npm run deploy`), and, when it names
    `node`, normalised with each node's options removed (pilot-auto-calibration A01-F57)."""
    norm = normalise_command(command)
    bare = normalise_command(_QUOTES_RE.sub("", command))
    variants = [norm] if bare == norm else [norm, bare]
    if re.search(r"(?i)\bnode\b", command):
        stripped = normalise_command(strip_node_options(normalise_command(command)))
        if stripped and stripped not in variants:
            variants.append(stripped)
    return variants


def parse_pattern(raw: Any) -> Tuple[Optional[ForbiddenPattern], Optional[str]]:
    """(pattern, None) or (None, why the entry is unusable)."""
    if not isinstance(raw, str):
        return None, "must be a string"
    text = raw.strip()
    if not text:
        return None, "is empty, so it would match every command"
    form = _REGEX_FORM.match(text)
    if form and len(text) >= 2:
        body, flags = form.group(1), form.group(2)
        if not body:
            return None, "is an empty /regex/, so it would match every command"
        try:
            compiled = re.compile(body, re.IGNORECASE if flags else 0)
        except re.error as exc:
            return None, "is not a valid regular expression: {}".format(exc)
        if compiled.search("") is not None:
            return None, "matches the empty string, so it would match every command"
        return ForbiddenPattern(raw=raw, regex=compiled), None
    return ForbiddenPattern(raw=raw, needle=normalise_command(text).casefold()), None


def compile_patterns(values: Any) -> Tuple[List[ForbiddenPattern], List[str]]:
    """Usable patterns of a forbidden_commands list, and one problem per unusable entry."""
    patterns: List[ForbiddenPattern] = []
    problems: List[str] = []
    if not isinstance(values, list):
        return patterns, (["forbidden_commands must be a list"] if values is not None else [])
    for index, raw in enumerate(values):
        pattern, problem = parse_pattern(raw)
        if pattern is None:
            problems.append("forbidden_commands[{}] {}".format(index, problem))
        else:
            patterns.append(pattern)
    return patterns, problems


def forbidden_match(command: str, patterns: Sequence[ForbiddenPattern]
                    ) -> Optional[ForbiddenPattern]:
    """The first pattern a command matches, or None."""
    if not patterns or not isinstance(command, str) or not command.strip():
        return None
    variants = command_variants(command)
    for pattern in patterns:
        if pattern.matches(variants):
            return pattern
    return None


def command_text(cmd: Any) -> str:
    """A gate cmd (string or argv list) as one string, for pattern matching."""
    if isinstance(cmd, list):
        return " ".join(str(part) for part in cmd)
    return cmd if isinstance(cmd, str) else ""


# ---------------------------------------------------------------------------
# money_paths_globs: the owner's list of money-path files (pilot-auto-calibration A01-F06 to
# A01-F08). The dialect is _common.py's `*_globs` dialect, a subset of the .gitignore pattern
# format; this module refuses the forms where that dialect and .gitignore disagree, and
# matches without regard to letter case.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MoneyGlob:
    """One usable money_paths_globs entry."""

    raw: str
    regex: "re.Pattern[str]"  # case-insensitive: the one used to classify
    exact: "re.Pattern[str]"  # case-sensitive: only for the case-only warning

    def matches(self, path: str, exact: bool = False) -> bool:
        """True when the repository-relative POSIX path, or a directory above it, matches
        (a pattern that matches a directory covers everything below it, as in .gitignore)."""
        rx = self.exact if exact else self.regex
        return any(rx.match(candidate) for candidate in path_and_parents(path))


def path_and_parents(path: str) -> List[str]:
    """'a/b/c.ts' -> ['a/b/c.ts', 'a/b', 'a']."""
    parts = [p for p in path.split("/") if p]
    return ["/".join(parts[:n]) for n in range(len(parts), 0, -1)]


def money_glob_problem(raw: str) -> Optional[str]:
    """Why a money_paths_globs entry is not a usable pattern (None when it is)."""
    if not raw.strip():
        return "is empty"
    if raw != raw.strip():
        return "has leading or trailing whitespace"
    if "\\" in raw:
        return ("contains '\\': write '/' between directories (patterns are matched against "
                "git's '/' paths on every platform, and this dialect has no escapes)")
    if raw.startswith("/") or _DRIVE_RE.match(raw):
        return ("must be relative to the repository root, without a leading '/' or a drive "
                "letter")
    if raw.startswith("!"):
        return ("starts with '!': negation is not supported; list only the paths that are "
                "money paths (a tracked file no pattern matches is not one)")
    for segment in raw.rstrip("/").split("/"):
        if segment == "":
            return "has an empty path segment ('//')"
        if segment in (".", ".."):
            return ("has a '{}' segment: write the path from the repository root".format(
                segment))
        if "**" in segment and segment != "**":
            return ("uses '**' inside a path segment; '**' must be a whole segment ('**/x', "
                    "'x/**' or 'x/**/y')")
    i = 0
    while i < len(raw):  # the bracket scan of _common.glob_to_regex
        if raw[i] == "[":
            j = raw.find("]", i + 2)
            if j == -1:
                return "has an unclosed '[' (write '[[]' to match a literal '[')"
            if "/" in raw[i + 1:j]:
                return "has a '[...]' class that contains '/'"
            i = j + 1
        else:
            i += 1
    try:
        with warnings.catch_warnings():
            # '[[]' (a literal '[') draws Python's "Possible nested set" FutureWarning; the
            # class is literal today, and a later change of meaning raises re.error here.
            warnings.simplefilter("ignore", FutureWarning)
            C.glob_to_regex(raw)
    except re.error as exc:
        return "is not a valid pattern: {}".format(exc)
    return None


def compile_money_globs(values: Any) -> Tuple[List[MoneyGlob], List[str]]:
    """Usable money_paths_globs entries, and one problem per unusable entry."""
    globs: List[MoneyGlob] = []
    problems: List[str] = []
    if not isinstance(values, list):
        return globs, ["{} must be a list of repository-relative glob patterns (omit the key "
                       "to classify money paths by judgement)".format(MONEY_GLOBS_KEY)]
    for index, raw in enumerate(values):
        if not isinstance(raw, str):
            problems.append("{}[{}] must be a string".format(MONEY_GLOBS_KEY, index))
            continue
        problem = money_glob_problem(raw)
        if problem:
            problems.append("{}[{}] {!r} {}".format(MONEY_GLOBS_KEY, index, raw, problem))
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", FutureWarning)
            exact = C.glob_to_regex(raw)
            globs.append(MoneyGlob(raw=raw, regex=re.compile(exact.pattern, re.IGNORECASE),
                                   exact=exact))
    return globs, problems


def money_glob_match(path: str, globs: Sequence[MoneyGlob]) -> Optional[MoneyGlob]:
    """The first entry, in profile order, that matches a repository-relative POSIX path."""
    for glob in globs:
        if glob.matches(path):
            return glob
    return None


def repo_relative_path(text: str, top: str) -> Tuple[Optional[str], Optional[str]]:
    """(repository-relative POSIX path, None), or (None, why the argument is none). A relative
    argument is relative to the repository root `top`, whatever the current directory; an
    absolute one (also /c/... from Git Bash on Windows) must lie inside it; '\\' counts as
    '/'. Mirrors run_state.repo_relative."""
    value = text.replace("\\", "/")
    if not value.strip():
        return None, "is empty"
    if os.name == "nt":
        msys = _MSYS_DRIVE_RE.match(value)
        if msys:
            value = msys.group(1).upper() + ":/" + value[3:]
    if value.startswith("/") or _DRIVE_RE.match(value):
        try:  # realpath: 8.3 short names (C:/Users/UTILIS~1) and symlinks
            rel = os.path.relpath(os.path.realpath(value), os.path.realpath(top))
        except ValueError:  # another drive on Windows
            return None, "is outside the repository"
        value = rel.replace("\\", "/")
    norm = posixpath.normpath(value)
    if norm in ("", "."):
        return None, "names the repository root, not a file"
    if norm == ".." or norm.startswith("../") or norm.startswith("/"):
        return None, "is outside the repository"
    return norm, None


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@dataclass
class ProfileCheck:
    """The outcome of checking one profile document."""

    path: Optional[str] = None
    sha256: Optional[str] = None
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    defaults: List[str] = field(default_factory=list)
    blockers: List[str] = field(default_factory=list)
    resolved: Optional[Dict[str, Any]] = None
    # How the repository holds the profile file (check_file with repo; None when it does not).
    tracked: Optional[str] = None
    # money_paths_globs against the tracked files of --repo: "not-checked" (no repo), "ok",
    # "unmatched" (a pattern matches no tracked file) or "unavailable" (git cannot tell).
    money_coverage: str = "not-checked"
    money_unmatched: List[str] = field(default_factory=list)

    @property
    def money_paths_source(self) -> str:
        """"globs" when money_paths_globs decides which files are money paths, else
        "judgement": the key is absent, or the list is ignored because a pattern matches no
        tracked file or git could not tell (pilot-auto-calibration A01-F07)."""
        r = self.resolved
        if not self.valid or r is None or r.get(MONEY_GLOBS_KEY) is None:
            return "judgement"
        return "judgement" if self.money_coverage in ("unmatched", "unavailable") else "globs"

    @property
    def valid(self) -> bool:
        return not self.errors

    @property
    def autonomous_apply(self) -> bool:
        return self.valid and not self.blockers

    def summary(self) -> Dict[str, Any]:
        """The effective values (conservative defaults filled in) of a valid profile."""
        if not self.valid or self.resolved is None:
            return {}
        r = self.resolved
        return {
            "mode": r["mode"], "network": r["network"],
            "live_side_effects": r["live_side_effects"], "situation": r["situation"],
            "future_work": list(r["future_work"]), "auto_apply": dict(r["auto_apply"]),
            "sandbox_ack": r["sandbox_ack"], "budget": dict(r["budget"]),
            "gates": [g.get("name") for g in r["gates"]],
            "e2e": [e.get("name") for e in r["e2e"]],
            "e2e_compare": [e.get("name") for e in r["e2e"] if e.get("compare") is True],
            "forbidden_commands": len(r["forbidden_commands"]),
            "money_paths_globs": (list(r[MONEY_GLOBS_KEY]) if r.get(MONEY_GLOBS_KEY) is not None
                                  else None),
            "money_paths_source": self.money_paths_source,
            "money_paths_unmatched": list(self.money_unmatched),
            "detection": dict(r["detection"]),
            "origin": (r.get("origin") or {}).get("kind", "owner"),
            "origin_base_sha": (r.get("origin") or {}).get("base_sha"),
            "provenance_fields": len(r.get("provenance") or {}),
            "gates_cmds": [[g.get("name"), command_text(g.get("cmd")), g.get("cwd", ".")]
                           for g in r["gates"]],
            "e2e_cmds": [[e.get("name"), command_text(e.get("cmd")), e.get("cwd", ".")]
                         for e in r["e2e"]],
        }

    def to_json(self) -> Dict[str, Any]:
        return {"path": self.path, "sha256": self.sha256, "valid": self.valid,
                "errors": list(self.errors), "warnings": list(self.warnings),
                "defaults": list(self.defaults), "blockers": list(self.blockers),
                "autonomous_apply": self.autonomous_apply, "tracked": self.tracked,
                "summary": self.summary()}


def native_windows() -> bool:
    """True on native Windows, where Claude Code has no sandbox (WSL2 reports linux)."""
    return sys.platform in ("win32", "cygwin", "msys")


def _is_bool(value: Any) -> bool:
    return isinstance(value, bool)


def relative_path_problem(value: str) -> Optional[str]:
    """Why a repository-relative path is not one (None when it is)."""
    text = value.strip().replace("\\", "/")
    if not text:
        return "is empty"
    if text.startswith("/") or re.match(r"^[A-Za-z]:", text):
        return "must be relative to the repository (verify_branch.py runs it in a fresh clone)"
    if ".." in posixpath.normpath(text).split("/"):
        return "must stay inside the repository (no '..')"
    return None


def parse_deadline(value: str) -> Optional[datetime]:
    """A budget deadline in UTC, or None when the text is not one."""
    match = _DEADLINE_RE.match(value.strip())
    if not match:
        return None
    clock = match.group(2)
    if clock.count(":") == 1:
        clock += ":00"
    try:
        parsed = datetime.fromisoformat("{}T{}".format(match.group(1), clock))
    except ValueError:
        return None
    return parsed.replace(tzinfo=timezone.utc)


def _check_env(item: Dict[str, Any], path: str, errors: List[str]) -> None:
    env = item.get("env")
    if env is not None and (not isinstance(env, dict) or not all(
            isinstance(k, str) and isinstance(v, str) for k, v in env.items())):
        errors.append("{}.env must map variable names to string values".format(path))
    for key in ("pipefail", "inherit_env"):
        if key in item and not _is_bool(item[key]):
            errors.append("{}.{} must be true or false".format(path, key))
    allow = item.get("env_allowlist")
    if allow is not None and (not isinstance(allow, list) or not all(
            isinstance(v, str) and v.strip() for v in allow)):
        errors.append("{}.env_allowlist must be a list of variable names".format(path))


def _check_entry(item: Any, path: str, kind: str, names: Dict[str, str], errors: List[str],
                 warnings: List[str]) -> None:
    """Validate one gate ("gates") or end-to-end check ("e2e") entry."""
    if not isinstance(item, dict):
        errors.append("{} must be an object".format(path))
        return
    allowed = GATE_KEYS if kind == "gates" else E2E_KEYS
    unknown = sorted(set(item) - allowed)
    if unknown:
        errors.append("{} has unknown key(s) {}; allowed: {}".format(
            path, ", ".join(unknown), ", ".join(sorted(allowed))))
    name = item.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append("{}.name must be a non-empty string".format(path))
    elif "\n" in name or "\r" in name:
        errors.append("{}.name must be one line".format(path))
    elif name in names:
        errors.append("{}.name {!r} is already used by {} (gate and e2e names share one "
                      "namespace in verify_branch.py)".format(path, name, names[name]))
    else:
        names[name] = path
    cmd = item.get("cmd")
    if isinstance(cmd, str):
        if not cmd.strip():
            errors.append("{}.cmd is empty".format(path))
    elif isinstance(cmd, list):
        if not cmd or not all(isinstance(a, str) for a in cmd) or not cmd[0].strip():
            errors.append("{}.cmd must be a non-empty list of strings".format(path))
    else:
        errors.append("{}.cmd must be a string (run through the platform shell) or a list of "
                      "strings (argv)".format(path))
    if "cwd" in item:
        cwd = item["cwd"]
        if not isinstance(cwd, str):
            errors.append("{}.cwd must be a string".format(path))
        else:
            problem = relative_path_problem(cwd)
            if problem:
                errors.append("{}.cwd {!r} {}".format(path, cwd, problem))
    if "timeout_s" in item:
        timeout = item["timeout_s"]
        if _is_bool(timeout) or not isinstance(timeout, (int, float)) or timeout <= 0:
            errors.append("{}.timeout_s must be a positive number of seconds".format(path))
    elif kind == "e2e":
        warnings.append("{} has no timeout_s: gates.py's default of {} s applies, and a check "
                        "that never exits (a server left running) waits that long".format(
                            path, DEFAULT_TIMEOUT_S))
    shell = item.get("shell")
    if shell is not None and shell not in ("bash", "sh", "platform"):
        errors.append("{}.shell must be \"bash\" (or omitted)".format(path))
    if shell in ("bash", "sh") and not isinstance(cmd, str):
        errors.append("{}.shell \"bash\" needs a string cmd".format(path))
    _check_env(item, path, errors)
    if kind == "e2e":
        if "compare" in item and not _is_bool(item["compare"]):
            errors.append("{}.compare must be true or false".format(path))
        return
    count_mode = item.get("count_mode", "sum")
    if count_mode not in COUNT_MODES:
        errors.append("{}.count_mode must be one of {}".format(path, ", ".join(COUNT_MODES)))
        count_mode = "sum"
    regex = item.get("count_regex")
    if regex is not None:
        if not isinstance(regex, str) or not regex.strip():
            errors.append("{}.count_regex must be a non-empty string".format(path))
        else:
            try:
                compiled = re.compile(regex, re.MULTILINE)
            except re.error as exc:
                errors.append("{}.count_regex is not a valid regex: {}".format(path, exc))
            else:
                if count_mode != "matches" and compiled.groups != 1:
                    errors.append("{}.count_regex must have exactly one capture group (it has "
                                  "{}); use (?:...) for the other groups".format(
                                      path, compiled.groups))
    ratchet = item.get("ratchet", False)
    if not _is_bool(ratchet):
        errors.append("{}.ratchet must be true or false".format(path))
    elif ratchet and regex is None:
        errors.append("{}.ratchet needs a count_regex that counts the gate's violations "
                      "(protocol-preflight PF-11)".format(path))


def _check_list(data: Dict[str, Any], key: str, names: Dict[str, str], errors: List[str],
                warnings: List[str]) -> List[Any]:
    value = data.get(key, [])
    if not isinstance(value, list):
        errors.append("{} must be a list".format(key))
        return []
    for index, item in enumerate(value):
        _check_entry(item, "{}[{}]".format(key, index), key, names, errors, warnings)
    return value


def _check_enum(data: Dict[str, Any], key: str, allowed: Sequence[str],
                errors: List[str]) -> None:
    if key in data and data[key] not in allowed:
        errors.append("{} must be one of {} (got {!r})".format(
            key, ", ".join(repr(a) for a in allowed), data[key]))


def _check_detection(raw: Any, errors: List[str]) -> Dict[str, Any]:
    """Parse the optional "detection" object (pilot-auto-calibration A01-F33, A01-F35, A01-F36)."""
    detection = dict(DETECTION_DEFAULTS)
    if raw is None:
        return detection
    if not isinstance(raw, dict):
        errors.append('detection must be an object {"max_concurrent_subagents": int, '
                      '"lens_bundles": "auto"|"single"|"grouped", "pass_model": str|null}')
        return detection
    unknown = sorted(set(raw) - set(DETECTION_KEYS))
    if unknown:
        errors.append("detection has unknown key(s) {}; allowed: {}".format(
            ", ".join(unknown), ", ".join(DETECTION_KEYS)))
    if "max_concurrent_subagents" in raw:
        value = raw["max_concurrent_subagents"]
        if _is_bool(value) or not isinstance(value, int) or not 1 <= value <= 16:
            errors.append("detection.max_concurrent_subagents must be an integer from 1 to 16")
        else:
            detection["max_concurrent_subagents"] = value
    if "lens_bundles" in raw:
        if raw["lens_bundles"] not in LENS_BUNDLE_VALUES:
            errors.append("detection.lens_bundles must be one of auto, single, grouped")
        else:
            detection["lens_bundles"] = raw["lens_bundles"]
    if "pass_model" in raw:
        model = raw["pass_model"]
        if model is not None and not (isinstance(model, str) and _PASS_MODEL_RE.match(model)):
            errors.append("detection.pass_model must be a model alias or id such as sonnet or "
                          "claude-sonnet-5, or null")
        else:
            detection["pass_model"] = model
    return detection


def _check_origin(data: Dict[str, Any], errors: List[str]) -> Optional[Dict[str, Any]]:
    """Parse the optional "origin" object (self-setup, user-policy-autonomy U01-F05)."""
    if ORIGIN_KEY not in data:
        return None
    origin = data[ORIGIN_KEY]
    if not isinstance(origin, dict):
        errors.append("origin must be an object {\"kind\": \"owner\"|\"inferred\", ...}")
        return None
    good = True
    unknown = sorted(set(origin) - set(ORIGIN_KEYS))
    if unknown:
        errors.append("origin has unknown key(s) {}; allowed: {}".format(
            ", ".join(unknown), ", ".join(ORIGIN_KEYS)))
        good = False
    if origin.get("kind") not in ORIGIN_KINDS:
        errors.append("origin.kind must be one of {} (got {!r})".format(
            ", ".join(ORIGIN_KINDS), origin.get("kind")))
        good = False
    if "tool" in origin and not (isinstance(origin["tool"], str) and origin["tool"].strip()):
        errors.append("origin.tool must be a non-empty string")
        good = False
    if "tool_version" in origin and (_is_bool(origin["tool_version"]) or not isinstance(
            origin["tool_version"], int) or origin["tool_version"] < 1):
        errors.append("origin.tool_version must be a positive integer")
        good = False
    if "created_utc" in origin and not (isinstance(origin["created_utc"], str)
                                         and _CREATED_UTC_RE.match(origin["created_utc"])):
        errors.append("origin.created_utc must be a UTC time such as 2026-09-25T22:00:00Z")
        good = False
    if "base_sha" in origin and not (isinstance(origin["base_sha"], str)
                                      and _BASE_SHA_RE.match(origin["base_sha"])):
        errors.append("origin.base_sha must be a full lowercase commit id (40 or 64 hex digits)")
        good = False
    if "report_sha256" in origin and not (isinstance(origin["report_sha256"], str)
                                           and _SHA256_RE.match(origin["report_sha256"])):
        errors.append("origin.report_sha256 must be 64 lowercase hex digits")
        good = False
    if "consent" in origin and not (isinstance(origin["consent"], str)
                                     and origin["consent"].strip()):
        errors.append("origin.consent must be a non-empty string")
        good = False
    return dict(origin) if good else None


def _check_provenance(data: Dict[str, Any], errors: List[str]) -> Dict[str, Any]:
    """Parse the optional "provenance" object (protocol-preflight PF-23)."""
    if PROVENANCE_KEY not in data:
        return {}
    prov = data[PROVENANCE_KEY]
    if not isinstance(prov, dict):
        errors.append("provenance must be an object mapping a field key to a list of "
                      "{source, line, detail} entries")
        return {}
    for key, entries in prov.items():
        if not isinstance(key, str) or not PROVENANCE_KEY_RE.match(key):
            errors.append("provenance key {!r} is not a profile field".format(key))
            continue
        if not isinstance(entries, list) or not entries:
            errors.append("provenance[{!r}] must be a non-empty list of {{source, line, detail}} "
                          "entries".format(key))
            continue
        for index, entry in enumerate(entries):
            where = "provenance[{!r}][{}]".format(key, index)
            if not isinstance(entry, dict):
                errors.append("{} must be an object".format(where))
                continue
            extra = sorted(set(entry) - set(PROVENANCE_ENTRY_KEYS))
            if extra:
                errors.append("{} has unknown key(s) {}; allowed: {}".format(
                    where, ", ".join(extra), ", ".join(PROVENANCE_ENTRY_KEYS)))
            source = entry.get("source")
            if not (isinstance(source, str) and source.strip()):
                errors.append("{}.source must be a non-empty string".format(where))
            if "line" in entry and entry["line"] is not None and (
                    _is_bool(entry["line"]) or not isinstance(entry["line"], int)
                    or entry["line"] < 1):
                errors.append("{}.line must be an integer of at least 1, or null".format(where))
            if "detail" in entry and not isinstance(entry["detail"], str):
                errors.append("{}.detail must be a string".format(where))
    return dict(prov)


def _provenance_checks(resolved: Dict[str, Any], warnings: List[str]) -> None:
    """Warnings for an inferred profile whose fields lack their source or whose checks inherit
    the whole environment (protocol-preflight PF-23)."""
    prov = resolved.get("provenance") or {}
    origin = resolved.get("origin") or {}
    names = {"gates": {g.get("name") for g in resolved["gates"]},
             "e2e": {e.get("name") for e in resolved["e2e"]}}
    for key in prov:
        for kind in ("gates", "e2e"):
            prefix = kind + "."
            if key.startswith(prefix) and key[len(prefix):] not in names[kind]:
                warnings.append("provenance names {}, which the profile does not have".format(key))
    if origin.get("kind") != "inferred":
        return
    for kind in ("gates", "e2e"):
        for item in resolved[kind]:
            name = item.get("name")
            if "{}.{}".format(kind, name) not in prov:
                warnings.append("no provenance for {}.{} (PF-23)".format(kind, name))
            if item.get("inherit_env") is not False:
                warnings.append("{}.{} of an inferred profile inherits the whole environment "
                                "(PF-23)".format(kind, name))
    for index, _pattern in enumerate(resolved["forbidden_commands"]):
        if "forbidden_commands[{}]".format(index) not in prov:
            warnings.append("no provenance for forbidden_commands[{}] (PF-23)".format(index))
    if not any(g.get("count_regex") and not g.get("ratchet") for g in resolved["gates"]):
        warnings.append("an inferred profile without a runnable test gate: protocol-preflight "
                        "PF-20 keeps the run report-only; finalize sets mode report-only in this "
                        "case")


def validate(data: Any) -> ProfileCheck:
    """Check a parsed profile document; fills errors, warnings, defaults and resolved."""
    check = ProfileCheck()
    errors, warnings, defaults = check.errors, check.warnings, check.defaults
    if not isinstance(data, dict):
        errors.append("the profile must be a JSON object")
        return check
    if TEMPLATE_KEY in data:
        errors.append("this is the unreviewed template written by `run_state.py "
                      "profile-template`: the owner reviews every field, deletes the "
                      "\"template\" key and saves the file as .harden/profile.json "
                      "(user-policy-autonomy U01-F04); an agent never does this for the owner")
    unknown = sorted(set(data) - TOP_KEYS)
    if unknown:
        errors.append("unknown key(s) {}; allowed: {}".format(
            ", ".join(unknown), ", ".join(sorted(TOP_KEYS - {TEMPLATE_KEY}))))
    if "version" not in data:
        errors.append("version is missing (it must be {})".format(VERSION))
    elif data["version"] != VERSION or _is_bool(data["version"]):
        errors.append("version must be {} (got {!r})".format(VERSION, data["version"]))
    for key in COMMENT_KEYS:
        if key in data and not (isinstance(data[key], str) or (
                isinstance(data[key], list) and all(isinstance(v, str) for v in data[key]))):
            errors.append("{} must be a string or a list of strings".format(key))
    if "$schema" in data and not isinstance(data["$schema"], str):
        errors.append("$schema must be a string")
    if data.get("mode") == "interactive":
        errors.append("mode 'interactive' is chosen on the command line (--interactive), not in "
                      "the profile; use 'auto' or 'report-only'")
    else:
        _check_enum(data, "mode", PROFILE_MODES, errors)
    _check_enum(data, "network", NETWORK_VALUES, errors)
    _check_enum(data, "live_side_effects", LIVE_SIDE_EFFECTS_VALUES, errors)
    _check_enum(data, "situation", SITUATIONS, errors)
    if "sandbox_ack" in data and not _is_bool(data["sandbox_ack"]):
        errors.append("sandbox_ack must be true or false")
    names: Dict[str, str] = {}
    gates = _check_list(data, "gates", names, errors, warnings)
    e2e = _check_list(data, "e2e", names, errors, warnings)
    future = data.get("future_work", [])
    if not isinstance(future, list):
        errors.append("future_work must be a list of repository-relative paths or globs")
        future = []
    for index, item in enumerate(future):
        if not isinstance(item, str):
            errors.append("future_work[{}] must be a string".format(index))
            continue
        problem = relative_path_problem(item)
        if problem:
            errors.append("future_work[{}] {!r} {}".format(index, item, problem))
    money_globs: Optional[List[str]] = None
    if MONEY_GLOBS_KEY in data:
        compiled, problems = compile_money_globs(data[MONEY_GLOBS_KEY])
        errors.extend(problems)
        if not problems:
            money_globs = [g.raw for g in compiled]
            seen: Dict[str, int] = {}
            for index, raw in enumerate(money_globs):
                key = raw.casefold()
                if key in seen:
                    warnings.append("{0}[{1}] repeats {0}[{2}] (patterns match without regard "
                                    "to letter case)".format(MONEY_GLOBS_KEY, index, seen[key]))
                else:
                    seen[key] = index
            if not money_globs:
                warnings.append("{} is empty: no file is a money path, except where the changed "
                                "code signs, sends orders or transactions, or handles keys "
                                "(protocol-change step 3)".format(MONEY_GLOBS_KEY))
    else:
        defaults.append(MONEY_UNSET_DEFAULT)
    patterns, problems = compile_patterns(data.get("forbidden_commands", []))
    errors.extend(problems)
    for pattern in patterns:
        if pattern.needle is not None and len(pattern.needle) < SHORT_SUBSTRING:
            warnings.append("forbidden_commands entry {!r} is a {}-character substring: it also "
                            "matches inside longer words (\"rm\" is in \"npm run format\"); "
                            "prefer a /regex/ with \\b".format(pattern.raw,
                                                               len(pattern.needle)))
    auto_apply: Dict[str, bool] = {}
    raw_apply = data.get("auto_apply", {})
    if not isinstance(raw_apply, dict):
        errors.append("auto_apply must be an object with the boolean switches {}".format(
            ", ".join(AUTO_APPLY_KEYS)))
        raw_apply = {}
    extra = sorted(set(raw_apply) - set(AUTO_APPLY_KEYS))
    if extra:
        errors.append("auto_apply has unknown key(s) {}; allowed: {}".format(
            ", ".join(extra), ", ".join(AUTO_APPLY_KEYS)))
    for key in AUTO_APPLY_KEYS:
        if key not in raw_apply:
            auto_apply[key] = False
            defaults.append("auto_apply.{}: false (not set; a switch the profile does not set "
                            "reads as false)".format(key))
        elif not _is_bool(raw_apply[key]):
            errors.append("auto_apply.{} must be true or false".format(key))
        else:
            auto_apply[key] = raw_apply[key]
    budget = {"max_tokens": None, "deadline_utc": None, "max_usd": None, "max_minutes": None}
    raw_budget = data.get("budget", {})
    if raw_budget is None:
        raw_budget = {}
    if not isinstance(raw_budget, dict):
        errors.append("budget must be an object {\"max_tokens\": int|null, \"deadline_utc\": "
                      "str|null, \"max_usd\": number|null, \"max_minutes\": int|null}")
        raw_budget = {}
    extra = sorted(set(raw_budget) - set(BUDGET_KEYS))
    if extra:
        errors.append("budget has unknown key(s) {}; allowed: {}".format(
            ", ".join(extra), ", ".join(BUDGET_KEYS)))
    tokens = raw_budget.get("max_tokens")
    if tokens is not None and (_is_bool(tokens) or not isinstance(tokens, int) or tokens <= 0):
        errors.append("budget.max_tokens must be a positive integer or null")
    else:
        budget["max_tokens"] = tokens
    deadline = raw_budget.get("deadline_utc")
    if deadline is not None:
        if not isinstance(deadline, str) or parse_deadline(deadline) is None:
            errors.append("budget.deadline_utc must be a UTC ISO 8601 time such as "
                          "2026-09-25T06:00:00Z, or null (got {!r})".format(deadline))
        else:
            budget["deadline_utc"] = deadline
    usd = raw_budget.get("max_usd")
    if usd is not None:
        if _is_bool(usd) or not isinstance(usd, (int, float)) or usd != usd or not 0 < usd <= 10000:
            errors.append("budget.max_usd must be a number above 0 and at most 10000 (USD at list "
                          "prices), or null")
        else:
            budget["max_usd"] = usd
    minutes = raw_budget.get("max_minutes")
    if minutes is not None:
        if _is_bool(minutes) or not isinstance(minutes, int) or not 30 <= minutes <= 2880:
            errors.append("budget.max_minutes must be an integer from 30 to 2880, or null")
        else:
            budget["max_minutes"] = minutes
    detection = _check_detection(data.get(DETECTION_KEY), errors)
    origin = _check_origin(data, errors)
    provenance = _check_provenance(data, errors)
    for key, value in DEFAULTS.items():
        if key not in data:
            defaults.append("{}: {} (not set)".format(key, json.dumps(value)))
    if errors:
        return check
    resolved = {key: data.get(key, value) for key, value in DEFAULTS.items()}
    resolved.update(version=VERSION, gates=gates, e2e=e2e, auto_apply=auto_apply,
                    budget=budget, future_work=future, detection=detection, origin=origin,
                    provenance=provenance)
    resolved[MONEY_GLOBS_KEY] = money_globs
    check.resolved = resolved
    _cross_checks(resolved, patterns, errors, warnings)
    if errors:
        check.resolved = None
    return check


def _cross_checks(resolved: Dict[str, Any], patterns: Sequence[ForbiddenPattern],
                  errors: List[str], warnings: List[str]) -> None:
    """Checks between fields of an otherwise well-formed profile."""
    for key in ("gates", "e2e"):
        for index, item in enumerate(resolved[key]):
            hit = forbidden_match(command_text(item.get("cmd")), patterns)
            if hit is not None:
                errors.append("{}[{}] ({}) matches forbidden_commands entry {!r}: verify_branch.py "
                              "would refuse to run it".format(key, index, item.get("name"),
                                                              hit.raw))
    if not resolved["e2e"]:
        warnings.append("no e2e check: the final verifier re-runs the gates only, and the "
                        "verdict is \"gates only\" (protocol-change PC-26)")
    if resolved["gates"] and not any(g.get("count_regex") and not g.get("ratchet")
                                     for g in resolved["gates"]):
        warnings.append("no gate has a count_regex: a drop in the collected test count cannot "
                        "be seen (protocol-change PC-02; assets/config.example.json)")
    if not resolved["forbidden_commands"]:
        warnings.append("forbidden_commands is empty: list at least the commands that deploy, "
                        "publish, sign or send transactions (U01-F03)")
    apply = resolved["auto_apply"]
    if apply["dependencies"] and resolved["network"] == "denied":
        warnings.append("auto_apply.dependencies is true but network is 'denied': a dependency "
                        "change needs the registry, so those items stay report-only")
    if apply["money_paths"]:
        warnings.append("auto_apply.money_paths is true: a behavioural item on a money, order, "
                        "key, signing or transaction path is still applied only when an offline "
                        "check (a golden capture or an e2e check) executes it, or, with "
                        "auto_apply.owner_judgement true, when PC-15's differential and the PF-18 "
                        "net check pass; a live-effect change (keys, signing, order or "
                        "transaction submission, deploys) is never applied unattended (U01-F03, "
                        "U01-F12)")
    if apply["dependency_versions"] and not apply["dependencies"]:
        warnings.append("auto_apply.dependency_versions is true but auto_apply.dependencies is not: "
                        "version-moving dependency items stay report-only (U01-F08)")
    _provenance_checks(resolved, warnings)
    if apply["owner_judgement"] and not apply["behavioural"]:
        warnings.append("auto_apply.owner_judgement is true but behavioural is false: the "
                        "owner-judgement lane then applies only structural and test-only items; "
                        "T2 items whose fix changes behaviour stay report-only (U01-F06)")
    if resolved["live_side_effects"] == "none" and resolved["network"] == "allowed":
        warnings.append("network is 'allowed' with live_side_effects 'none': check that no "
                        "gate or e2e command reaches a live endpoint through that network")


def assess(check: ProfileCheck, windows: Optional[bool] = None,
           now: Optional[datetime] = None, deadline: bool = True) -> List[str]:
    """Fill and return check.blockers: why a valid profile still keeps an autonomous run
    report-only for anything that executes project code."""
    check.blockers = []
    r = check.resolved
    if not check.valid or r is None:
        return check.blockers
    windows = native_windows() if windows is None else windows
    if r["mode"] == "report-only":
        check.blockers.append("the profile's mode is 'report-only'")
    if r["live_side_effects"] != "none":
        check.blockers.append("live_side_effects is '{}': without the owner's confirmation that "
                              "no gate, install or e2e command reaches live endpoints, keys or "
                              "chains, no project code runs (protocol-preflight PF-03)".format(
                                  r["live_side_effects"]))
    if not r["gates"]:
        check.blockers.append("gates is empty: project code runs only through the owner's "
                              "confirmed gates (protocol-preflight PF-20)")
    if windows and r["sandbox_ack"] is not True:
        check.blockers.append("native Windows has no Claude Code sandbox and sandbox_ack is "
                              "false: the owner has not accepted running project code without "
                              "one (protocol-preflight PF-03)")
    limit = r["budget"].get("deadline_utc")
    if deadline and limit:
        when = parse_deadline(limit)
        current = now or datetime.now(timezone.utc)
        if when is not None and when <= current:
            check.blockers.append("budget.deadline_utc {} has passed".format(limit))
    return check.blockers


def check_document(data: Any, repo: Optional[Path] = None, windows: Optional[bool] = None,
                   now: Optional[datetime] = None, base: str = "HEAD") -> ProfileCheck:
    """validate() + the cwd existence check under `repo` + the money_paths_globs coverage of
    the `base` commit's files + assess()."""
    check = validate(data)
    if check.valid and repo is not None and check.resolved is not None:
        for key in ("gates", "e2e"):
            for index, item in enumerate(check.resolved[key]):
                cwd = item.get("cwd", ".")
                if not (repo / cwd).is_dir():
                    check.errors.append("{}[{}].cwd {!r} does not exist in {}".format(
                        key, index, cwd, repo.as_posix()))
        if check.errors:
            check.resolved = None
        elif check.resolved.get(MONEY_GLOBS_KEY):
            check_money_coverage(check, repo, base)
        if check.resolved is not None:
            check_origin_base(check, repo, base)
    assess(check, windows=windows, now=now)
    return check


def check_origin_base(check: ProfileCheck, repo: Path, base: str = "HEAD") -> None:
    """Warn when an inferred profile describes another base commit: self-setup runs again for a
    new base (protocol-preflight PF-23)."""
    origin = (check.resolved or {}).get("origin") or {}
    recorded = origin.get("base_sha")
    if origin.get("kind") != "inferred" or not recorded:
        return
    try:
        code, sha, _err = _git(repo, ["rev-parse", "--verify", "-q", base + "^{commit}"])
    except TrackingCheckError:
        return
    if code == 0 and sha and sha != recorded:
        check.warnings.append("inferred for base {}, the check's base is {}: self-setup runs "
                              "again for a new base (PF-23)".format(recorded[:12], sha[:12]))


def check_money_coverage(check: ProfileCheck, repo: Path, base: str = "HEAD") -> None:
    """Match money_paths_globs against the files of the `base` commit in `repo`. A pattern
    that matches none makes the run ignore the list (money_coverage "unmatched"): the owner
    wrote it for another tree, or mistyped it, and a list that says "not a money path" for
    every file it misses must describe this tree (pilot-auto-calibration A01-F07)."""
    globs, _problems = compile_money_globs(check.resolved[MONEY_GLOBS_KEY])
    try:
        files = tracked_files(repo, base)
    except TrackingCheckError as exc:
        check.money_coverage = "unavailable"
        check.warnings.append("{} not checked against the tracked files ({}): the run "
                              "classifies money paths by judgement".format(MONEY_GLOBS_KEY, exc))
        return
    if files is None:
        check.money_coverage = "unavailable"
        check.warnings.append("{} not checked against the tracked files: {} is not in a git "
                              "work tree, so the run classifies money paths by judgement".format(
                                  MONEY_GLOBS_KEY, repo.as_posix()))
        return
    check.money_coverage = "ok"
    for index, glob in enumerate(globs):
        first = next((f for f in files if glob.matches(f)), None)
        if first is None:
            check.money_unmatched.append(glob.raw)
            check.warnings.append(
                "{}[{}] {!r} matches no tracked file of the base commit: the run ignores {} "
                "and classifies money paths by judgement until every pattern matches one (a "
                "pattern that matches nothing suggests a typo or a list written for another "
                "tree; pilot-auto-calibration A01-F07)".format(MONEY_GLOBS_KEY, index, glob.raw,
                                                         MONEY_GLOBS_KEY))
            continue
        if not any(glob.matches(f, exact=True) for f in files):
            check.warnings.append(
                "{}[{}] {!r} matches tracked files only when letter case is ignored (for "
                "example {}); they are money paths all the same".format(
                    MONEY_GLOBS_KEY, index, glob.raw, first))
        if all(glob.matches(f) for f in files):
            check.warnings.append(
                "{}[{}] {!r} matches every tracked file: every item then needs "
                "auto_apply.money_paths".format(MONEY_GLOBS_KEY, index, glob.raw))
    if check.money_unmatched:
        check.money_coverage = "unmatched"


def read_profile(path: Path) -> Tuple[bytes, Any, Optional[str]]:
    """(raw bytes, parsed document or None, JSON error or None); ProfileReadError when the
    file cannot be read."""
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ProfileReadError("cannot read {}: {}".format(path.as_posix(), exc)) from exc
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        return raw, None, "not UTF-8 text: {}".format(exc)
    try:
        return raw, json.loads(text), None
    except ValueError as exc:
        return raw, None, "not valid JSON: {}".format(exc)


def _git(cwd: Path, args: Sequence[str]) -> Tuple[int, str, str]:
    """(exit code, stdout, stderr) of a git command run without a shell, with untranslated
    messages; TrackingCheckError when git cannot run at all."""
    env = dict(os.environ, LC_ALL="C", LANGUAGE="C")
    try:
        proc = subprocess.run(["git", "-C", str(cwd)] + list(args), stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                              check=False, timeout=GIT_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError) as exc:
        raise TrackingCheckError("git could not run: {}".format(exc)) from exc
    return (proc.returncode, proc.stdout.decode("utf-8", errors="replace").strip(),
            proc.stderr.decode("utf-8", errors="replace").strip())


def _git_z(cwd: Path, args: Sequence[str]) -> List[str]:
    """The NUL-separated paths a git command prints with -z, decoded as UTF-8;
    TrackingCheckError when git cannot run or fails."""
    env = dict(os.environ, LC_ALL="C", LANGUAGE="C")
    try:
        proc = subprocess.run(["git", "-C", str(cwd), "-c", "core.quotePath=false"] + list(args),
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, env=env, check=False,
                              timeout=GIT_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError) as exc:
        raise TrackingCheckError("git could not run: {}".format(exc)) from exc
    if proc.returncode != 0:
        raise TrackingCheckError("git {} failed: {}".format(" ".join(args[:2]), proc.stderr.decode(
            "utf-8", errors="replace").strip()[:300]))
    return [p.decode("utf-8", errors="replace") for p in proc.stdout.split(b"\0") if p]


def work_tree_top(repo: Path) -> Optional[str]:
    """The top directory of the git work tree that holds `repo`, or None when there is none;
    TrackingCheckError when git cannot answer."""
    code, top, err = _git(repo, ["rev-parse", "--show-toplevel"])
    if code != 0:
        if "not a git repository" in err.lower():
            return None
        raise TrackingCheckError("git rev-parse --show-toplevel failed in {}: {}".format(
            repo.as_posix(), err[:300]))
    return top


def tracked_files(repo: Path, base: str = "HEAD") -> Optional[List[str]]:
    """The repository-relative POSIX paths of the `base` commit (`git ls-tree -r --name-only
    -z --full-tree`), or of the index (`git ls-files -z`) while HEAD names no commit yet;
    None outside a git work tree. The base, not the index, so that a run's own renames and
    deletions never change which patterns match. TrackingCheckError when git cannot answer
    or another `base` names no commit."""
    top = work_tree_top(repo)
    if top is None:
        return None
    code, sha, _err = _git(Path(top), ["rev-parse", "--verify", "-q", base + "^{commit}"])
    if code != 0 or not sha:
        if base != "HEAD":
            raise TrackingCheckError("the base {!r} is not a commit of this repository".format(
                base))
        return _git_z(Path(top), ["ls-files", "-z"])
    return _git_z(Path(top), ["ls-tree", "-r", "--name-only", "-z", "--full-tree", sha])


def staged_files(repo: Path) -> Optional[List[str]]:
    """The staged paths (`git diff --cached --name-only --no-renames -z`, both sides of a
    rename), or None outside a git work tree."""
    top = work_tree_top(repo)
    return None if top is None else _git_z(
        Path(top), ["diff", "--cached", "--name-only", "--no-renames", "-z"])


def _repository_paths(path: Path, top: str) -> List[str]:
    """The profile file's repository-relative POSIX paths: as named (its directory resolved,
    so 8.3 short names match) and with every link resolved. Empty when it lies outside."""
    root = os.path.realpath(top)
    absolute = os.path.abspath(str(path))
    named = os.path.join(os.path.realpath(os.path.dirname(absolute)),
                         os.path.basename(absolute))
    forms: List[str] = []
    for candidate in (named, os.path.realpath(absolute)):
        try:
            rel = os.path.relpath(candidate, root).replace("\\", "/")
        except ValueError:  # another drive on Windows
            continue
        if rel in (".", "..") or rel.startswith("../") or os.path.isabs(rel):
            continue
        if rel not in forms:
            forms.append(rel)
    return forms


def tracked_by_repository(path: Path, repo: Path, base: str = "HEAD") -> Optional[str]:
    """How the git repository at `repo` holds the profile file `path`, or None when it does
    not: the index tracks it (`git ls-files --error-unmatch`) or the base commit holds it.
    Either way the file is repository text (SKILL.md invariant 6, protocol-preflight PF-08),
    not the owner's consent (PF-22; user-policy-autonomy U01-F04). None as well when `repo`
    is not a git work tree or the file lies outside it; a HEAD that names no commit yet (a
    repository without one) skips the base check. TrackingCheckError when git cannot answer
    or another `base` names no commit."""
    code, top, err = _git(repo, ["rev-parse", "--show-toplevel"])
    if code != 0:
        if "not a git repository" in err.lower():
            return None
        raise TrackingCheckError("git rev-parse --show-toplevel failed in {}: {}".format(
            repo.as_posix(), err[:300]))
    forms = _repository_paths(path, top)
    if not forms:
        return None
    top_dir = Path(top)
    code, sha, _ = _git(top_dir, ["rev-parse", "--verify", "-q", base + "^{commit}"])
    base_sha = sha if code == 0 and sha else None
    if base_sha is None and base != "HEAD":
        raise TrackingCheckError("the base {!r} is not a commit of this repository".format(base))
    for rel in forms:
        code, _, err = _git(top_dir, ["--literal-pathspecs", "ls-files", "--error-unmatch",
                                      "--", rel])
        if code == 0:
            return "git tracks {}: `git ls-files --error-unmatch {}` exits 0".format(rel, rel)
        if code != 1:
            raise TrackingCheckError("git ls-files --error-unmatch {} failed: {}".format(
                rel, err[:300]))
        if base_sha is not None:
            code, _, _ = _git(top_dir, ["cat-file", "-e", "{}:{}".format(base_sha, rel)])
            if code == 0:
                return "the base commit {} holds {}".format(base_sha[:12], rel)
    return None


def tracked_error(detail: str) -> str:
    """The error of a profile the repository holds; it starts with TRACKED_REASON."""
    return ("{} ({}). A profile the repository holds is repository text, never the owner's "
            "consent: the owner keeps their profile out of git and out of the base commit, for "
            "example outside the repository, passed with `run_state.py start --profile PATH` "
            "(SKILL.md invariant 6; protocol-preflight PF-08, PF-22; user-policy-autonomy "
            "U01-F04)".format(TRACKED_REASON, detail))


def check_tracking(check: ProfileCheck, path: Path, repo: Path, base: str = "HEAD") -> None:
    """Make `check` invalid when the repository holds the profile file, or when git cannot
    tell whether it does (an unchecked profile is no consent)."""
    try:
        detail = tracked_by_repository(path, repo, base)
    except TrackingCheckError as exc:
        check.errors.insert(0, "cannot tell whether the repository tracks this profile ({}); "
                               "an unchecked profile is no consent (protocol-preflight PF-22)"
                               .format(exc))
    else:
        if detail is None:
            return
        check.tracked = detail
        check.errors.insert(0, tracked_error(detail))
    check.resolved = None
    check.blockers = []


def check_file(path: Path, repo: Optional[Path] = None, windows: Optional[bool] = None,
               now: Optional[datetime] = None, base: str = "HEAD") -> ProfileCheck:
    """Read, validate and assess a profile file (ProfileReadError when unreadable). With
    `repo`, a profile that repository tracks or holds in the `base` commit is invalid."""
    raw, data, problem = read_profile(path)
    if problem:
        check = ProfileCheck(errors=[problem])
    else:
        check = check_document(data, repo=repo, windows=windows, now=now, base=base)
    check.path = path.as_posix()
    check.sha256 = hashlib.sha256(raw).hexdigest()
    if repo is not None:
        check_tracking(check, path, repo, base)
    return check


def salvage_forbidden(path: Path) -> List[str]:
    """The usable forbidden_commands entries of a profile file, even an invalid one: a typo
    elsewhere must not switch the owner's command bans off (stricter, never looser)."""
    try:
        _raw, data, problem = read_profile(path)
    except ProfileReadError:
        return []
    if problem or not isinstance(data, dict):
        return []
    patterns, _problems = compile_patterns(data.get("forbidden_commands"))
    return [p.raw for p in patterns]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def money_paths_line(check: ProfileCheck) -> str:
    """How a valid profile decides which files are money paths."""
    globs = (check.resolved or {}).get(MONEY_GLOBS_KEY)
    if globs is None:
        return "money paths: judgement ({} not set)".format(MONEY_GLOBS_KEY)
    if check.money_paths_source == "judgement":
        return "money paths: judgement ({} ignored: {})".format(
            MONEY_GLOBS_KEY, "pattern(s) {} match no tracked file".format(
                ", ".join(repr(g) for g in check.money_unmatched))
            if check.money_unmatched else "not checked against the tracked files")
    return "money paths: {} ({} pattern(s)); `--classify` lists the files they match".format(
        MONEY_GLOBS_KEY, len(globs))


def _shown(path: str) -> str:
    """A path as one field of a tab-separated line."""
    return json.dumps(path, ensure_ascii=False) if any(c in path for c in "\t\r\n") else path


def read_path_list(source: str) -> List[str]:
    """The paths of a --paths-from list ('-' reads stdin): UTF-8 with an optional BOM, LF or
    CRLF line ends; blank lines and lines starting with '#' are skipped, and surrounding
    whitespace is removed. OSError or UnicodeDecodeError when it cannot be read."""
    data = sys.stdin.buffer.read() if source == "-" else Path(source).read_bytes()
    lines = (line.strip() for line in data.decode("utf-8-sig").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


def classify(check: ProfileCheck, top: str, inputs: Sequence[str]) -> List[Dict[str, Any]]:
    """One result per distinct input path: {input, path, verdict, pattern, problem}, verdict
    money-path, not-money-path, judgement or error (pilot-auto-calibration A01-F06, A01-F07).
    `check` must be a valid profile checked against the repository at `top`."""
    source = check.money_paths_source
    globs, _problems = compile_money_globs((check.resolved or {}).get(MONEY_GLOBS_KEY) or [])
    results: List[Dict[str, Any]] = []
    seen = set()
    for raw in inputs:
        path, problem = repo_relative_path(raw, top)
        if path is None:
            results.append({"input": raw, "path": None, "verdict": "error", "pattern": None,
                            "problem": problem})
            continue
        if path in seen:
            continue
        seen.add(path)
        if source != "globs":
            verdict, pattern = "judgement", None
        else:
            hit = money_glob_match(path, globs)
            verdict, pattern = ("money-path", hit.raw) if hit else ("not-money-path", None)
        results.append({"input": raw, "path": path, "verdict": verdict, "pattern": pattern,
                        "problem": None})
    return results


def classify_summary(check: ProfileCheck, results: Sequence[Dict[str, Any]]) -> str:
    counts = {v: sum(1 for r in results if r["verdict"] == v)
              for v in ("money-path", "not-money-path", "judgement", "error")}
    if check.money_paths_source == "globs":
        how = ("by {} ({} pattern(s)); a not-money-path file still holds a money path where the "
               "changed code signs, sends orders or transactions, or handles keys (protocol-"
               "change step 3)".format(MONEY_GLOBS_KEY, len((check.resolved or {}).get(
                   MONEY_GLOBS_KEY) or [])))
    else:
        how = money_paths_line(check)[len("money paths: "):]
    return "# {} path(s): {} money-path, {} not-money-path, {} judgement, {} error; money " \
           "paths {}".format(len(results), counts["money-path"], counts["not-money-path"],
                             counts["judgement"], counts["error"], how)


def report_text(check: ProfileCheck) -> str:
    lines = ["profile: {}{}".format(check.path, " (sha256 {})".format(check.sha256[:12])
                                    if check.sha256 else "")]
    lines.append("valid: {}".format("yes" if check.valid else "no"))
    if check.valid and check.resolved is not None:
        origin = check.resolved.get("origin") or {}
        if origin.get("kind") == "inferred":
            lines.append("origin: inferred by self-setup (base {}; the owner's /harden invocation "
                         "is the consent, U01-F05)".format(str(origin.get("base_sha") or "?")[:12]))
        else:
            lines.append("origin: owner")
    if check.errors:
        lines.append("errors:")
        lines += ["  - " + e for e in check.errors]
    if check.warnings:
        lines.append("warnings:")
        lines += ["  - " + w for w in check.warnings]
    if check.valid and check.defaults:
        lines.append("defaults taken (a value the profile lacks reads as its conservative "
                     "default; user-policy-autonomy U01-F01):")
        lines += ["  - " + d for d in check.defaults]
    if check.valid:
        lines.append(money_paths_line(check))
        if check.blockers:
            lines.append("autonomous apply: no. An autonomous run stays report-only for "
                         "anything that executes project code:")
            lines += ["  - " + b for b in check.blockers]
        else:
            s = check.summary()
            lines.append("autonomous apply: yes ({} gate(s), {} e2e check(s), network {}, "
                         "auto_apply {})".format(
                             len(s["gates"]), len(s["e2e"]), s["network"],
                             ", ".join(k for k, v in s["auto_apply"].items() if v) or "none"))
    else:
        lines.append("autonomous apply: no. An autonomous run without a valid profile behaves "
                     "as report-only for anything that executes project code "
                     "(user-policy-autonomy U01-F04).")
    return "\n".join(lines)


def run_classify(args: argparse.Namespace, check: ProfileCheck, repo: Path) -> int:
    """The --classify mode of main()."""
    def fail(message: str) -> int:
        print("validate_profile.py: {}".format(message), file=sys.stderr)
        return 2

    if not check.valid:
        if args.json:
            print(json.dumps({"path": check.path, "sha256": check.sha256, "valid": False,
                              "errors": list(check.errors), "warnings": list(check.warnings),
                              "money_paths_globs": None, "source": None, "unmatched": [],
                              "results": [], "counts": {}}, indent=2, ensure_ascii=False))
        print(report_text(check), file=sys.stderr)
        return 1
    try:
        top = work_tree_top(repo)
    except TrackingCheckError as exc:
        return fail(str(exc))
    if top is None:
        return fail("--repo {} is not in a git work tree".format(repo.as_posix()))
    inputs: List[str] = list(args.classify)
    try:
        if args.paths_from is not None:
            inputs += read_path_list(args.paths_from)
        if args.staged:
            inputs += staged_files(repo) or []
        elif not inputs and args.paths_from is None:
            inputs = tracked_files(repo, args.base or "HEAD") or []
    except (OSError, UnicodeDecodeError) as exc:
        return fail("cannot read --paths-from {}: {}".format(args.paths_from, exc))
    except TrackingCheckError as exc:
        return fail(str(exc))
    results = classify(check, top, inputs)
    counts = {v: sum(1 for r in results if r["verdict"] == v)
              for v in ("money-path", "not-money-path", "judgement", "error")}
    if args.json:
        print(json.dumps({"path": check.path, "sha256": check.sha256, "valid": True,
                          "errors": [], "warnings": list(check.warnings),
                          "money_paths_globs": (check.resolved or {}).get(MONEY_GLOBS_KEY),
                          "source": check.money_paths_source,
                          "unmatched": list(check.money_unmatched), "results": results,
                          "counts": counts}, indent=2, ensure_ascii=False))
    else:
        for r in results:
            if r["verdict"] == "error":
                print("error\t{}\t{}".format(_shown(r["input"]), r["problem"]))
            else:
                print("{}\t{}\t{}".format(r["verdict"], _shown(r["path"]), r["pattern"] or "-"))
        print(classify_summary(check, results))
        if check.warnings:
            print(report_text(check), file=sys.stderr)
    return 2 if counts["error"] else 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(
        prog="validate_profile.py",
        description="Check a /harden run profile (.harden/profile.json).")
    parser.add_argument("path", metavar="PATH", help="profile file")
    parser.add_argument("--repo", default=None,
                        help="also check that every gate and e2e cwd exists in this directory, "
                             "and that its git repository neither tracks the profile nor holds "
                             "it in the base commit (PF-22)")
    parser.add_argument("--base", default=None, metavar="REV",
                        help="base commit of the tracked-profile check and of the "
                             "money_paths_globs coverage (default HEAD; needs --repo)")
    parser.add_argument("--json", action="store_true", help="print the result as JSON")
    parser.add_argument("--classify", nargs="*", default=None, metavar="FILE",
                        help="say whether money_paths_globs puts each FILE (repository-"
                             "relative) on a money path; with no FILE, --paths-from or "
                             "--staged, every tracked file (needs --repo; A01-F06)")
    parser.add_argument("--staged", action="store_true",
                        help="with --classify: also every staged path")
    parser.add_argument("--paths-from", default=None, metavar="LIST",
                        help="with --classify: also the paths listed in LIST, one per line "
                             "('-' reads stdin)")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code not in (0, None) else 0
    path = Path(args.path)
    repo = Path(args.repo) if args.repo else None
    if repo is not None and not repo.is_dir():
        print("validate_profile.py: --repo is not a directory: {}".format(args.repo),
              file=sys.stderr)
        return 2
    if args.base is not None and repo is None:
        print("validate_profile.py: --base needs --repo", file=sys.stderr)
        return 2
    if args.classify is None and (args.staged or args.paths_from is not None):
        print("validate_profile.py: --staged and --paths-from need --classify", file=sys.stderr)
        return 2
    if args.classify is not None and repo is None:
        print("validate_profile.py: --classify needs --repo (a path is classified only against "
              "the owner's untracked profile and the repository's tracked files)",
              file=sys.stderr)
        return 2
    try:
        check = check_file(path, repo=repo, base=args.base or "HEAD")
    except ProfileReadError as exc:
        print("validate_profile.py: {}".format(exc), file=sys.stderr)
        return 2
    if args.classify is not None and repo is not None:
        return run_classify(args, check, repo)
    if args.json:
        print(json.dumps(check.to_json(), indent=2, ensure_ascii=False))
    else:
        print(report_text(check))
    return 0 if check.valid else 1


if __name__ == "__main__":
    sys.exit(main())
