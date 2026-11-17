#!/usr/bin/env python3
"""verify_branch.py - end-to-end verification of a /harden branch, with bisect and revert.

Purpose
    The final gate of an autonomous run (user-policy-autonomy U01-F02; protocol-change PC-26).
    After the last fix, a script with no conversation context re-runs everything from fresh
    clones, so hidden local state cannot make the branch pass (docs-accuracy G106-F01), and
    compares the base's outputs with the branch's, because passing tests are a weak oracle
    (refactoring-safety T09-F14; hardening-induced-regressions G205-F14; cleanup-practice-forums
    T30-F11). A red check is bisected to its first bad commit (refactoring-safety T09-F08:
    every commit builds and passes on its own, so bisect can land on any of them), and that
    commit is reverted. History is never rewritten: only `git revert` (protocol-change PC-20).

Loop
    0. Preconditions (exit 2 when one fails, before any clone): an active run (.harden/active
       and its scratch_dir), --base an ancestor of HEAD, no modified or staged tracked file and
       no revert, merge, cherry-pick, rebase or bisect in progress in the repository. The run
       profile must be the owner's untracked file: git does not track it (`git ls-files
       --error-unmatch` fails) and the --base commit does not hold it, the rule run_state.py
       start applies, through validate_profile.tracked_by_repository (a profile the
       repository holds is repository text, protocol-preflight PF-22, PF-08); it must also be
       the one run_state.py start recorded (its sha256 equals "profile_sha256" in
       .harden/active), valid, and allow project code to run: live_side_effects "none"
       (protocol-preflight PF-03) and no blocker except a passed deadline; in an interactive
       run, the user's live answer (config "env_policy" "inherit" or "allowlist") may stand
       in for the profile's blockers. Without a profile, "env_policy" of the config must be
       "inherit" or "allowlist". No install, gate or e2e command may match a forbidden
       pattern (the profile's and the marker's forbidden_commands; user-policy-autonomy
       U01-F03).
    1. Checks, in this order: the install step(s); the gates of .harden/config.json; the gates
       of .harden/ratchet.json (judged as ratchets); the profile's gates not already in the
       config (same name and command: skipped; same name, other command: renamed
       "profile/<name>"); then the profile's e2e checks (a name taken by a gate becomes
       "e2e/<name>"). Install: "install" of the config (a gate object or a list of them; []
       disables it; assets/config.example.json), otherwise the lockfile-enforcing command of
       the clone's root lockfile (protocol-preflight PF-10), the first found of:
       pnpm-lock.yaml -> pnpm install --frozen-lockfile, package-lock.json -> npm ci,
       yarn.lock -> yarn install --immutable for Yarn 2+ (package.json "packageManager"
       yarn@2 or later, a .yarnrc.yml, or a lockfile with Yarn 2+'s "__metadata:" block and no
       packageManager yarn@1) and yarn install --frozen-lockfile otherwise (Yarn 1),
       uv.lock -> uv sync --locked, Cargo.lock -> cargo build --locked; a JavaScript lockfile
       of the manager "packageManager" names goes first. An install command that matches a
       forbidden pattern is not run. With network "denied" (the profile's, else the config's)
       installs are skipped and noted. Gates and installs take the config's inherit_env and
       env_allowlist.
    2. Base: clone --base once into <scratch_dir>/verify-base (verify-base-2, ... when taken)
       and run every check there: the reference for compare, ratchet and count checks, and
       the proof that a check can pass at all.
    3. Head: clone the repository's HEAD into <scratch_dir>/verify-<n> (the first free n),
       install, run every check, and judge each against the base:
         install/gate/e2e  exit 0 and no timeout
         + count_regex     the count is not below the base's, less the test cases approved
                           for deletion (run_state.py allow-test-deletion --cases; PC-02)
         ratchet           the violation count is not above the base's (PF-11)
         compare: true     exit 0 at both, and the normalised stdouts are equal: ANSI codes,
                           ISO 8601 timestamps, clock times, durations (12ms, 1.5 s, 3 seconds)
                           and the clone's path in any spelling are masked
       A check red at the base (no readable base count, no base output to compare) cannot be
       judged: it is recorded "unjudged", never bisected, never reverted.
    4. Every judged check green: exit 0, or 3 when a check stayed unjudged.
    5. Otherwise the first red check runs once more in the same clone: green on the re-run
       means flaky, recorded "unjudged" (a flaky check can blame an innocent commit). A
       confirmed red check is bisected in the head clone: `git bisect start <head> <base>`,
       `git bisect run <python> -S verify_branch.py --probe --spec <file> --repo <clone>`. The
       probe cleans the clone (`git clean -ffdx`, so each commit is tested like a fresh
       clone), installs, replays the checks that run ahead of the bisected one (an e2e check
       may read what a build gate wrote), runs the check and judges it against the recorded
       base result: exit 0 good, 1 bad, 125 skip when the commit cannot be tested (an install
       step that fails or a command that cannot start, unless the install is the bisected
       check; an earlier check that was green at HEAD but is not green there), 255 on an
       internal error, which makes git abort the bisect. Then `git bisect reset`.
    6. The first bad commit is reverted in the repository with `git revert --no-edit <sha>`
       and recorded in "reverts" (sha, subject, check, reason), and the loop goes back to 3
       with a new clone. A bisect that names several candidates (skipped commits) reverts
       each of them, newest first. A revert that conflicts is aborted with `git revert
       --abort` and the loop stops: exit 1, "revert-conflict".
    7. Range revert: when a check is still red after --max-reverts reverts, when the first bad
       commit is itself a revert of a commit in the range (the applied commits depend on each
       other), a merge or a commit already reverted, or when the bisect names no commit of the
       range, every commit of base..HEAD
       (first parent, newest first, a merge with -m 1) is reverted in turn. Each revert then
       applies to the very tree its commit produced, so none conflicts, and the tree ends
       equal to the base's ("tree_equals_base"). Exit 1, "range-reverted".
    8. With --e2e-coverage, after a green or inconclusive end, each profile e2e check runs once
       more in the last clone with NODE_V8_COVERAGE=<.harden/verify/<run>/e2e-coverage/<check>>
       (Node's built-in V8 coverage; other runtimes ignore the variable, so pass the flag only
       when the applied range changed TypeScript or JavaScript). The runs are never judged,
       bisected or reverted, and never change the exit code, even when one fails
       (pilot-auto-calibration A01-F21); e2e_reach.py reads them.
    A report-only run (mode "report-only" in .harden/active) reverts nothing: a red check is
    bisected for the record, and the exit code is 1 ("red"). The deadline of the profile's
    budget is not enforced here: the loop always ends with a green or a reverted branch.

Output
    --out (default .harden/verify.json): {schema_version, tool, started, finished, repo, base,
    head_at_start, head_at_end, mode, max_reverts, profile {path, sha256} | null, config,
    network, gates_only, definitions [...], base_run {clone, sha, results}, iterations [{n,
    sha, clone, results, red, unjudged, flaky, bisect}], checks (the last iteration's
    results), reverts [{sha, subject, check, reason, output_tail, revert_sha, kind: bisect |
    candidate | range}], final_status (green | inconclusive | red | revert-conflict |
    range-reverted | error), tree_equals_base, clones [{path, sha, role}], notes,
    exit_code, e2e_coverage (null without --e2e-coverage, else [{check, clone, sha, dir,
    exit_code, timed_out, files, error}])}. Full logs and the bisect specs go to .harden/verify/<run id>/; hook_guard.py
    keeps .harden/verify.json and .harden/verify/ read-only for the agent's tools.

CLI
    python verify_branch.py --base SHA [--config FILE] [--profile FILE] [--max-reverts N]
                            [--out FILE] [--repo DIR] [--e2e-coverage] [--json]
                            (python3 on macOS/Linux)
    Relative --config, --profile and --out paths are resolved against the repository (--repo,
    default the current directory, resolved to its git top level). Defaults:
    .harden/config.json, .harden/profile.json (used when it exists), --max-reverts 5,
    .harden/verify.json.
    Internal, run by `git bisect run`: python verify_branch.py --probe --spec FILE
                                                               [--repo CLONE]

Exit codes
    0  every judged check green, after 0 to --max-reverts reverts, none unjudged
    1  still red: the applied range was reverted (cap, dependent commits, a failure bisect
       could not attribute), a revert conflicted and was aborted, or a red check in a
       report-only run
    2  usage or setup error (a failed precondition), or a git or clone failure
    3  inconclusive: nothing the branch broke is red, but a check could not be judged (red at
       the base, or flaky at the head); nothing was reverted for it
    Probe mode: 0 good, 1 bad, 125 skip, 255 internal error (git bisect run's convention).

Python 3.9+ standard library only (runs under `python -S`); the network is used only by the
install commands, and only when the network setting allows it; subprocesses without a shell
except the gate commands gates.py runs.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import _common as C  # noqa: E402  (sibling module, path set above)
import gates as G  # noqa: E402
import validate_profile as vp  # noqa: E402

TAIL_LINES = 40
DIFF_LINES = 60
PROBE_GOOD, PROBE_BAD, PROBE_SKIP, PROBE_ABORT = 0, 1, 125, 255
EXIT_GREEN, EXIT_RED, EXIT_ERROR, EXIT_INCONCLUSIVE = 0, 1, 2, 3
FINAL_EXIT = {"green": EXIT_GREEN, "inconclusive": EXIT_INCONCLUSIVE, "red": EXIT_RED,
              "revert-conflict": EXIT_RED, "range-reverted": EXIT_RED, "error": EXIT_ERROR}
# protocol-preflight PF-10: install with the lockfile-enforcing command. Yarn's command depends
# on its major version (yarn_install below); the others are fixed.
YARN_LOCK = "yarn.lock"
LOCKFILE_INSTALLS = (
    ("pnpm-lock.yaml", ["pnpm", "install", "--frozen-lockfile"]),
    ("package-lock.json", ["npm", "ci"]),
    (YARN_LOCK, None),
    ("uv.lock", ["uv", "sync", "--locked"]),
    ("Cargo.lock", ["cargo", "build", "--locked"]),
)
# The JavaScript package manager that owns each JS lockfile ("packageManager" of package.json,
# the field Corepack enforces, picks among several lockfiles).
JS_LOCKFILE_MANAGERS = {"pnpm-lock.yaml": "pnpm", "package-lock.json": "npm", YARN_LOCK: "yarn"}
# Yarn 2+ ("modern", berry): `yarn install --immutable`, "Abort with an error exit code if the
# lockfile was to be modified" (yarnpkg.com/cli/install, read 2026-09-25; the migration guide
# names "the renaming of `--frozen-lockfile` into `--immutable`"). Yarn 1 ("classic"):
# `yarn install --frozen-lockfile`, "Don't generate a yarn.lock lockfile and fail if an update
# is needed" (classic.yarnpkg.com/en/docs/cli/install, read 2026-09-25).
YARN_MODERN_INSTALL = ["yarn", "install", "--immutable"]
YARN_CLASSIC_INSTALL = ["yarn", "install", "--frozen-lockfile"]
# "packageManager": "yarn@3.2.3+sha224.953c..." (github.com/nodejs/corepack, read 2026-09-25).
PACKAGE_MANAGER_RE = re.compile(r"^\s*([A-Za-z][\w.-]*)@v?(\d+)")
# A lockfile Yarn 2+ wrote starts with a "__metadata:" block (yarnpkg/berry's own yarn.lock);
# Yarn 1 writes "# yarn lockfile v1" (yarnpkg/yarn's yarn.lock), both read 2026-09-25.
YARN_MODERN_LOCK_RE = re.compile(r"^__metadata:\s*$", re.M)
YARN_LOCK_HEAD_BYTES = 4096
INSTALL_TIMEOUT_S = 1800
IN_PROGRESS = ("REVERT_HEAD", "MERGE_HEAD", "CHERRY_PICK_HEAD", "BISECT_LOG", "rebase-merge",
               "rebase-apply")
LEAKY_GIT_ENV = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX",
                 "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR")
REVERTS_RE = re.compile(r"This reverts commit ([0-9a-f]{40,64})")
SHA_LINE_RE = re.compile(r"^([0-9a-f]{40,64})\b", re.M)

# Output normalisation for compare: true (masks what legitimately differs between two runs).
ISO_TS_RE = re.compile(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?"
                       r"(?:Z|[+-]\d{2}:?\d{2})?")
CLOCK_RE = re.compile(r"(?<![\d:])\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?(?![\d:])")
DURATION_RE = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)?\s?(?:ns|us|µs|ms|s|secs?|seconds?|m|"
                         r"mins?|minutes?|h|hrs?|hours?)(?![A-Za-z])")


class VerifyError(RuntimeError):
    """A precondition or an environment problem: exit 2 with this message."""


# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------


def git_env() -> Dict[str, str]:
    env = C.git_env()
    for name in LEAKY_GIT_ENV:
        env.pop(name, None)
    env["MSYS_NO_PATHCONV"] = "1"  # Git Bash: never rewrite the probe's arguments
    return env


def git(cwd: Path, args: Sequence[str]) -> "subprocess.CompletedProcess[bytes]":
    """Run git in `cwd`; never raises on a non-zero exit (VerifyError when git is missing)."""
    cmd = ["git", "-c", "core.quotePath=false", "-c", "color.ui=never"] + list(args)
    try:
        return subprocess.run(cmd, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              stdin=subprocess.DEVNULL, env=git_env(), check=False)
    except OSError as exc:
        raise VerifyError("cannot run git: {}".format(exc)) from exc


def text(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def git_out(cwd: Path, args: Sequence[str]) -> str:
    """Stripped stdout of a git command; VerifyError when it fails."""
    proc = git(cwd, args)
    if proc.returncode != 0:
        raise VerifyError("git {} failed ({}): {}".format(" ".join(args[:4]), proc.returncode,
                                                          text(proc.stderr).strip()[:500]))
    return text(proc.stdout).strip()


def tail(value: str, count: int = TAIL_LINES) -> str:
    lines = [ln.rstrip() for ln in value.replace("\r\n", "\n").split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines[-count:])


def commit_subject(repo: Path, sha: str) -> str:
    proc = git(repo, ["log", "-1", "--format=%s", sha])
    return text(proc.stdout).strip() if proc.returncode == 0 else ""


def range_shas(repo: Path, base: str, head: str, first_parent: bool = False) -> List[str]:
    """Commits of base..head, newest first."""
    args = ["rev-list"] + (["--first-parent"] if first_parent else []) + \
        ["{}..{}".format(base, head)]
    return [s for s in git_out(repo, args).split() if s]


def parent_count(repo: Path, sha: str) -> int:
    return len(git_out(repo, ["rev-list", "--parents", "-n", "1", sha]).split()) - 1


# ---------------------------------------------------------------------------
# Output normalisation (compare: true)
# ---------------------------------------------------------------------------


def path_spellings(roots: Sequence[str]) -> List[str]:
    """Spellings of the clone directories that a program may print, longest first."""
    found = set()
    for root in roots:
        for base in {root, os.path.abspath(root), os.path.realpath(root)}:
            posix = base.replace("\\", "/").rstrip("/")
            native = posix.replace("/", "\\")
            found.update({posix, native, native.replace("\\", "\\\\")})
            drive = re.match(r"^([A-Za-z]):/(.*)$", posix)
            if drive:
                found.add("/{}/{}".format(drive.group(1).lower(), drive.group(2)))
    return sorted((s for s in found if len(s) > 3), key=len, reverse=True)


def normalise_output(value: str, roots: Sequence[str]) -> str:
    """stdout with what legitimately differs between two runs masked: ANSI codes, the clone's
    path, ISO 8601 timestamps, clock times and durations; trailing spaces dropped."""
    out = G.ANSI_RE.sub("", value).replace("\r\n", "\n").replace("\r", "\n")
    flags = re.IGNORECASE if os.name == "nt" else 0
    for spelling in path_spellings(roots):
        out = re.sub(re.escape(spelling), "<CLONE>", out, flags=flags)
    out = ISO_TS_RE.sub("<TS>", out)
    out = CLOCK_RE.sub("<TIME>", out)
    out = DURATION_RE.sub("<DUR>", out)
    lines = [ln.rstrip() for ln in out.split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def output_diff(base: str, head: str) -> str:
    diff = difflib.unified_diff(base.split("\n"), head.split("\n"), "base (normalised)",
                                "branch (normalised)", lineterm="", n=2)
    return tail("\n".join(diff), DIFF_LINES)


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------


@dataclass
class CheckDef:
    """One check: an install step, a gate or an end-to-end check."""

    name: str
    kind: str      # "install" | "gate" | "e2e"
    source: str    # "config" | "ratchet.json" | "profile" | "lockfile <name>"
    raw: Dict[str, Any]
    compare: bool = False

    @property
    def ratchet(self) -> bool:
        return self.raw.get("ratchet") is True

    @property
    def counted(self) -> bool:
        return self.raw.get("count_regex") is not None and not self.ratchet

    def to_json(self) -> Dict[str, Any]:
        return {"name": self.name, "kind": self.kind, "source": self.source,
                "compare": self.compare, "ratchet": self.ratchet, "raw": self.raw}

    @staticmethod
    def from_json(data: Dict[str, Any]) -> "CheckDef":
        return CheckDef(name=data["name"], kind=data["kind"], source=data["source"],
                        raw=dict(data["raw"]), compare=bool(data.get("compare")))


def gate_object(item: Dict[str, Any], name: str) -> Dict[str, Any]:
    """A gates.py gate object for a check entry (the e2e-only key removed)."""
    obj = {k: v for k, v in item.items() if k != "compare"}
    obj["name"] = name
    return obj


def build_gate(check: CheckDef, workdir: Path, defaults: Dict[str, Any]) -> "G.Gate":
    """The gates.py Gate of a check in `workdir` (G.ConfigError when its cwd is missing
    there, or when the definition is invalid)."""
    doc = {"gates": [check.raw], "inherit_env": defaults.get("inherit_env", True),
           "env_allowlist": defaults.get("env_allowlist", [])}
    return G.parse_gates(doc, workdir)[0]


def failure_text(rec: Optional[Dict[str, Any]]) -> str:
    if not rec:
        return "no run"
    if rec.get("timed_out"):
        return "timed out ({})".format(rec.get("error") or "")
    if rec.get("exit_code") is None:
        return str(rec.get("error") or "did not run")
    return "exit code {}".format(rec.get("exit_code"))


def run_check(check: CheckDef, workdir: Path, log_dir: Path, run_index: int,
              defaults: Dict[str, Any]) -> Dict[str, Any]:
    """Run one check once in `workdir`; the record keeps what judge() needs."""
    rec: Dict[str, Any] = {"name": check.name, "kind": check.kind, "exit_code": None,
                           "passed": False, "timed_out": False, "environmental": False,
                           "count": None, "ratchet_count": None, "tail": ""}
    try:
        gate = build_gate(check, workdir, defaults)
    except G.ConfigError as exc:
        rec.update(error="cannot run in this checkout: {}".format(exc), tail=str(exc))
        return rec
    raw = G.run_gate(gate, workdir, log_dir, run_index)
    rec.update(exit_code=raw.get("exit_code"), passed=bool(raw.get("passed")),
               timed_out=bool(raw.get("timed_out")), duration_s=raw.get("duration_s"),
               count=raw.get("count"), log_paths=raw.get("log_paths"))
    if raw.get("error"):
        rec["error"] = raw["error"]
    if raw.get("count_error"):
        rec["count_error"] = raw["count_error"]
    # A command that could not start at all is an environment problem (probe exit 125).
    rec["environmental"] = raw.get("exit_code") is None and not raw.get("timed_out")
    if check.ratchet:
        rec["ratchet_count"] = G.ratchet_run_count(raw)[0]
    rec["tail"] = tail("\n".join(t for t in (raw.get("stdout_tail"), raw.get("stderr_tail"))
                                 if t))
    if check.compare:
        stdout = ""
        path = (raw.get("log_paths") or {}).get("stdout")
        if path:
            try:
                stdout = Path(path).read_bytes().decode("utf-8", errors="replace")
            except OSError:
                stdout = ""
        rec["stdout_normalised"] = normalise_output(stdout, [str(workdir)])
        rec["stdout_sha256"] = hashlib.sha256(rec["stdout_normalised"].encode("utf-8")) \
            .hexdigest()
    return rec


def judge(check: CheckDef, rec: Dict[str, Any], base: Optional[Dict[str, Any]],
          approved: int) -> Tuple[str, str]:
    """(status, reason) of a check result against the base's: green, red or unjudged."""
    if check.ratchet:
        reference = base.get("ratchet_count") if base else None
        if reference is None:
            return "unjudged", "no readable violation count at the base ({})".format(
                failure_text(base))
        current = rec.get("ratchet_count")
        if current is None:
            return "red", "violation count cannot be read ({})".format(
                rec.get("count_error") or failure_text(rec))
        if current > reference:
            return "red", "violation count rose to {} from {} at the base (PF-11)".format(
                current, reference)
        return "green", "violation count {} (base {})".format(current, reference)
    base_ok = bool(base and base.get("passed"))
    if not rec.get("passed"):
        if not base_ok:
            return "unjudged", "red at the base too ({}): not caused by the branch".format(
                failure_text(base))
        return "red", failure_text(rec)
    if check.compare:
        if not base_ok:
            return "unjudged", "red at the base ({}): no base output to compare".format(
                failure_text(base))
        if rec.get("stdout_normalised") != base.get("stdout_normalised"):  # type: ignore
            return "red", "stdout differs from the base's after normalisation:\n" + \
                output_diff(str(base.get("stdout_normalised") or ""),  # type: ignore
                            str(rec.get("stdout_normalised") or ""))
        return "green", "exit 0; stdout equal to the base's after normalisation"
    if check.counted and base_ok:
        recorded = base.get("count")  # type: ignore
        if isinstance(recorded, int) and not isinstance(recorded, bool):
            reference = max(0, recorded - approved)
            current = rec.get("count")
            if not isinstance(current, int) or isinstance(current, bool):
                return "red", "no count ({}); the base counted {}".format(
                    rec.get("count_error") or "count_regex found no number", recorded)
            if current < reference:
                return "red", "count dropped to {} from {} at the base{} (PC-02)".format(
                    current, recorded, ", less {} approved test deletion(s)".format(approved)
                    if approved else "")
            return "green", "exit 0; count {} (base {})".format(current, recorded)
    return "green", "exit 0"


def package_manager(workdir: Path) -> Optional[Tuple[str, int]]:
    """(name, major version) of the "packageManager" field of the root package.json, or None
    when the file, the field or a version is missing or unreadable."""
    try:
        data = C.read_json(workdir / "package.json")
    except (OSError, ValueError):
        return None
    value = data.get("packageManager") if isinstance(data, dict) else None
    match = PACKAGE_MANAGER_RE.match(value) if isinstance(value, str) else None
    return (match.group(1).lower(), int(match.group(2))) if match else None


def yarn_install(workdir: Path, manager: Optional[Tuple[str, int]]) -> Tuple[List[str], str]:
    """(argv, reason) of the lockfile-enforcing install of a yarn.lock checkout.

    Yarn 2+ when "packageManager" names yarn@2 or later, when .yarnrc.yml exists (the config
    file of Yarn 2+; "simply calling your file `.yarnrc` won't do", yarnpkg.com/configuration/
    yarnrc), or, without a packageManager yarn@1, when the lockfile carries Yarn 2+'s
    "__metadata:" block; Yarn 1 otherwise."""
    if manager is not None and manager[0] == "yarn" and manager[1] >= 2:
        return list(YARN_MODERN_INSTALL), "packageManager yarn@{}".format(manager[1])
    if (workdir / ".yarnrc.yml").is_file():
        return list(YARN_MODERN_INSTALL), ".yarnrc.yml (Yarn 2+ config)"
    if manager is not None and manager[0] == "yarn":
        return list(YARN_CLASSIC_INSTALL), "packageManager yarn@{}".format(manager[1])
    try:
        with open(workdir / YARN_LOCK, "rb") as handle:
            head = handle.read(YARN_LOCK_HEAD_BYTES).decode("utf-8", errors="replace")
    except OSError:
        head = ""
    if YARN_MODERN_LOCK_RE.search(head):
        return list(YARN_MODERN_INSTALL), "yarn.lock written by Yarn 2+ (__metadata)"
    return list(YARN_CLASSIC_INSTALL), "Yarn 1 (no packageManager yarn@2+, no .yarnrc.yml)"


def lockfile_install(workdir: Path) -> Optional[Tuple[str, List[str], str]]:
    """(lockfile, argv, reason) of the root lockfile's enforcing install (PF-10), or None.

    First lockfile of LOCKFILE_INSTALLS that exists, except that a JavaScript lockfile owned by
    the manager "packageManager" names wins over the other JavaScript lockfiles."""
    present = [(name, argv) for name, argv in LOCKFILE_INSTALLS if (workdir / name).is_file()]
    if not present:
        return None
    manager = package_manager(workdir)
    if manager is not None:
        owned = [p for p in present if JS_LOCKFILE_MANAGERS.get(p[0]) == manager[0]]
        if owned:
            present = owned + [p for p in present if p not in owned]
    lockfile, argv = present[0]
    if lockfile == YARN_LOCK:
        yarn_argv, reason = yarn_install(workdir, manager)
        return lockfile, yarn_argv, reason
    reason = "packageManager {}@{}".format(*manager) if manager is not None and \
        JS_LOCKFILE_MANAGERS.get(lockfile) == manager[0] else "root lockfile"
    return lockfile, list(argv or []), reason


def install_checks(install_mode: str, explicit: Sequence[CheckDef], workdir: Path,
                   patterns: Sequence["vp.ForbiddenPattern"]) -> List[CheckDef]:
    """The install steps for one checkout: the config's, or the root lockfile's command."""
    if install_mode == "none":
        return []
    if install_mode == "explicit":
        return list(explicit)
    found = lockfile_install(workdir)
    if found is None:
        return []
    lockfile, argv, reason = found
    if vp.forbidden_match(" ".join(argv), patterns) is not None:
        return []
    name = "install ({})".format(lockfile)
    return [CheckDef(name=name, kind="install", source="lockfile {} ({})".format(lockfile, reason),
                     raw={"name": name, "cmd": list(argv), "cwd": ".",
                          "timeout_s": INSTALL_TIMEOUT_S})]


def validate_definition(check: CheckDef, repo: Path, defaults: Dict[str, Any]) -> None:
    """Check a definition before any clone (VerifyError): gates.py's own checks, and a cwd
    that stays inside the checkout. A cwd missing in the working tree (a build output that
    an earlier check creates) is checked when the check runs."""
    raw = dict(check.raw)
    cwd = raw.get("cwd", ".")
    if isinstance(cwd, str):
        problem = vp.relative_path_problem(cwd)
        if problem:
            raise VerifyError("check {!r} ({}): cwd {!r} {}".format(check.name, check.source,
                                                                   cwd, problem))
        if not (repo / cwd).is_dir():
            raw["cwd"] = "."
    try:
        G.parse_gates({"gates": [raw], "inherit_env": defaults.get("inherit_env", True),
                       "env_allowlist": defaults.get("env_allowlist", [])}, repo)
    except G.ConfigError as exc:
        raise VerifyError("check {!r} ({}): {}".format(check.name, check.source, exc)) from exc


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------


@dataclass
class Context:
    repo: Path
    hdir: Path
    base: str
    head_at_start: str
    scratch: Path
    mode: str
    max_reverts: int
    config_path: Path
    profile_path: Optional[Path]
    profile_sha: Optional[str]
    network: Optional[str]
    checks: List[CheckDef]
    install_mode: str            # "explicit" | "lockfile" | "none"
    explicit_installs: List[CheckDef]
    defaults: Dict[str, Any]
    patterns: List["vp.ForbiddenPattern"]
    approved: int
    log_root: Path
    notes: List[str]
    e2e_coverage: bool = False


def resolve_under(repo: Path, raw: str) -> Path:
    path = Path(os.path.expanduser(raw))
    return path if path.is_absolute() else (repo / path)


def read_json_object(path: Path, what: str) -> Dict[str, Any]:
    try:
        data = C.read_json(path)
    except (OSError, ValueError) as exc:
        raise VerifyError("cannot read {} {}: {}".format(what, path.as_posix(), exc)) from exc
    if not isinstance(data, dict):
        raise VerifyError("{} {} must hold a JSON object".format(what, path.as_posix()))
    return data


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def profile_tracking(repo: Path, path: Path, base: str) -> Optional[str]:
    """How the repository holds the run profile, or None when it does not: git tracks it
    (`git ls-files --error-unmatch` exits 0) or the base commit holds it. The shared check of
    validate_profile.py, so run_state.py start, validate_profile.py and this script apply the
    same rule (protocol-preflight PF-22). VerifyError when git cannot tell: an unchecked
    profile is no consent."""
    try:
        return vp.tracked_by_repository(path, repo, base)
    except vp.TrackingCheckError as exc:
        raise VerifyError("cannot tell whether the repository tracks the run profile {} ({}): an "
                          "unchecked profile is no consent (protocol-preflight PF-22)".format(
                              path.as_posix(), exc)) from exc


def load_profile(args: argparse.Namespace, repo: Path, marker: Dict[str, Any], notes: List[str],
                 base: str
                 ) -> Tuple[Optional[Path], Optional[str], Optional[Dict[str, Any]], List[str]]:
    """(path, sha256, resolved profile, blockers) of the run profile, or (None, None, None,
    []); the blockers leave out a passed deadline (the loop always finishes). A profile the
    repository tracks, or the base commit holds, is refused before anything else."""
    explicit = args.profile is not None
    path = resolve_under(repo, args.profile or ".harden/profile.json")
    recorded = marker.get("profile_sha256")
    if not path.is_file():
        if explicit:
            raise VerifyError("--profile {} does not exist".format(path.as_posix()))
        if recorded:
            raise VerifyError("the run profile .harden/profile.json was removed after "
                              "run_state.py start recorded it (sha256 {}): only the owner "
                              "changes the profile; restore it".format(str(recorded)[:12]))
        notes.append("no run profile: the gates of the config only, no e2e check")
        return None, None, None, []
    tracked = profile_tracking(repo, path, base)
    if tracked is not None:
        # A profile the repository holds is repository text that a commit, the branch's
        # included, can change: not the owner's consent written before the run.
        raise VerifyError("the run profile {} is refused: {}. Nothing was cloned or run; stop "
                          "the run and start it again with an untracked profile".format(
                              path.as_posix(), vp.tracked_error(tracked)))
    sha = file_sha256(path)
    if recorded != sha:
        raise VerifyError(
            "the run profile {} is not the one run_state.py start recorded (sha256 {} now, {} "
            "at start): only the owner changes the profile (user-policy-autonomy U01-F04); "
            "restore it, or stop the run and start again with the new profile".format(
                path.as_posix(), sha[:12], (str(recorded) if recorded else "none")[:12]))
    check = vp.check_file(path, repo=repo, base=base)
    if not check.valid:
        raise VerifyError("the run profile {} is invalid: {}".format(
            path.as_posix(), "; ".join(check.errors[:5])))
    return path, sha, check.resolved, vp.assess(check, deadline=False)


def build_checks(config: Dict[str, Any], ratchet: Optional[Dict[str, Any]],
                 profile: Optional[Dict[str, Any]], notes: List[str]) -> List[CheckDef]:
    checks: List[CheckDef] = []
    names: Dict[str, CheckDef] = {}

    def add(check: CheckDef) -> None:
        checks.append(check)
        names[check.name] = check

    for item in config.get("gates") or []:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            add(CheckDef(item["name"], "gate", "config", gate_object(item, item["name"])))
    for item in (ratchet or {}).get("gates") or []:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            continue
        if item.get("ratchet") is not True or item["name"] in names:
            notes.append(".harden/ratchet.json gate {!r} skipped ({})".format(
                item["name"], "no \"ratchet\": true" if item.get("ratchet") is not True
                else "its name is a config gate's"))
            continue
        add(CheckDef(item["name"], "gate", "ratchet.json", gate_object(item, item["name"])))
    for item in (profile or {}).get("gates") or []:
        name = item["name"]
        same = names.get(name)
        if same is not None:
            if (vp.command_text(same.raw.get("cmd")), same.raw.get("cwd", ".")) == \
                    (vp.command_text(item.get("cmd")), item.get("cwd", ".")):
                continue
            name = "profile/" + name
            notes.append("the profile's gate {!r} runs another command than the config's; it "
                         "runs as {!r}".format(item["name"], name))
        add(CheckDef(name, "gate", "profile", gate_object(item, name)))
    for item in (profile or {}).get("e2e") or []:
        name = item["name"] if item["name"] not in names else "e2e/" + item["name"]
        add(CheckDef(name, "e2e", "profile", gate_object(item, name),
                     compare=item.get("compare") is True))
    return checks


def setup(args: argparse.Namespace) -> Context:
    try:
        info = C.resolve_repo(Path(args.repo))
    except (OSError, ValueError) as exc:
        raise VerifyError("--repo is not a directory: {}".format(exc)) from exc
    if not info.is_repo:
        raise VerifyError("{} is not a git repository".format(info.root.as_posix()))
    repo = info.root
    hdir = C.harden_dir(repo)
    marker_path = hdir / "active"
    if not marker_path.is_file():
        raise VerifyError("no active /harden run: .harden/active does not exist, so the run's "
                          "scratch_dir, mode and profile hash are unknown (run_state.py start)")
    marker = read_json_object(marker_path, "the run marker")
    raw_scratch = marker.get("scratch_dir")
    if not isinstance(raw_scratch, str) or not Path(raw_scratch).is_dir():
        raise VerifyError("the run's scratch_dir ({}) is missing: stop the run and start it "
                          "again (run_state.py) before verifying".format(raw_scratch))
    scratch = Path(raw_scratch).resolve()
    try:
        scratch.relative_to(repo.resolve())
        inside = True
    except ValueError:
        inside = False
    if inside:
        raise VerifyError("scratch_dir {} lies inside the repository, where test runners and "
                          "detectors would find the clones (eval-v2-calibration E02-F08)"
                          .format(scratch.as_posix()))
    if args.max_reverts < 0:
        raise VerifyError("--max-reverts must be 0 or more")
    base = git(repo, ["rev-parse", "--verify", "-q", args.base + "^{commit}"])
    if base.returncode != 0:
        raise VerifyError("--base {!r} is not a commit of this repository".format(args.base))
    base_sha = text(base.stdout).strip()
    head = git_out(repo, ["rev-parse", "--verify", "HEAD"])
    if git(repo, ["merge-base", "--is-ancestor", base_sha, head]).returncode != 0:
        raise VerifyError("--base {} is not an ancestor of HEAD {}".format(base_sha[:12],
                                                                         head[:12]))
    dirty = git_out(repo, ["status", "--porcelain=v1", "--untracked-files=no"])
    if dirty:
        raise VerifyError("tracked files are modified or staged:\n{}\ncommit or restore them "
                          "first: a revert must not mix with uncommitted changes".format(
                              tail(dirty, 20)))
    for name in IN_PROGRESS:
        rel = git_out(repo, ["rev-parse", "--git-path", name])
        path = Path(rel) if os.path.isabs(rel) else repo / rel
        if path.exists():
            raise VerifyError("a git operation is in progress ({} exists): finish or abort it "
                              "first".format(name))
    notes: List[str] = []
    config_path = resolve_under(repo, args.config)
    config: Dict[str, Any] = {}
    if config_path.is_file():
        config = read_json_object(config_path, "the config")
    elif args.config != ".harden/config.json":
        raise VerifyError("--config {} does not exist".format(config_path.as_posix()))
    else:
        notes.append("no .harden/config.json: the profile's gates only")
    raw_gates = config.get("gates", [])
    if not isinstance(raw_gates, list) or not all(
            isinstance(g, dict) and isinstance(g.get("name"), str) and g["name"].strip()
            for g in raw_gates):
        raise VerifyError("the config's \"gates\" must be a list of gate objects with a name "
                          "(gates.py --help)")
    ratchet_path = hdir / "ratchet.json"
    ratchet = read_json_object(ratchet_path, "the ratchet config") \
        if ratchet_path.is_file() else None
    profile_path, profile_sha, profile, blockers = load_profile(args, repo, marker, notes,
                                                                base_sha)
    confirmed_live = config.get("env_policy") in ("inherit", "allowlist")
    mode = str(marker.get("mode") or "")
    if profile is None and not confirmed_live:
        raise VerifyError(
            "no run profile, and the config's env_policy is {!r}: project code runs only after "
            "the owner confirmed that it cannot reach live endpoints, keys or chains "
            "(protocol-preflight PF-03; env_policy 'inherit' or 'allowlist')".format(
                config.get("env_policy")))
    if blockers and (mode == "auto" or not confirmed_live):
        # An autonomous run executes project code only on the profile's consent (U01-F04);
        # an interactive run may also rest on the user's live answer (config env_policy).
        raise VerifyError("the run profile does not allow running project code: {}".format(
            "; ".join(blockers)))
    network = profile["network"] if profile else config.get("network")
    patterns, _problems = vp.compile_patterns(
        list((profile or {}).get("forbidden_commands") or []) +
        [p for p in marker.get("forbidden_commands") or [] if isinstance(p, str)])
    checks = build_checks(config, ratchet, profile, notes)
    if not [c for c in checks if c.kind == "gate"]:
        raise VerifyError("no gate to run: neither the config nor the profile lists one")
    defaults = {"inherit_env": config.get("inherit_env", True),
                "env_allowlist": config.get("env_allowlist", [])}
    install_raw = config.get("install")
    explicit: List[CheckDef] = []
    if install_raw is None:
        install_mode = "lockfile"
    else:
        items = [install_raw] if isinstance(install_raw, dict) else install_raw
        if not isinstance(items, list) or not all(isinstance(i, dict) for i in items):
            raise VerifyError("the config's \"install\" must be a gate object or a list of them")
        install_mode = "explicit" if items else "none"
        taken = {c.name for c in checks}
        for index, item in enumerate(items):
            name = item.get("name") if isinstance(item.get("name"), str) and \
                item.get("name") else ("install" if len(items) == 1 else
                                       "install-{}".format(index + 1))
            if name in taken:
                raise VerifyError("the install step name {!r} is also a check's name".format(
                    name))
            taken.add(name)
            explicit.append(CheckDef(name, "install", "config", gate_object(item, name)))
    if network == "denied" and install_mode != "none":
        install_mode = "none"
        notes.append("installs skipped: network is 'denied'; checks that need dependencies "
                     "stay red at the base and unjudged")
    for check in explicit + checks:
        validate_definition(check, repo, defaults)
        hit = vp.forbidden_match(vp.command_text(check.raw.get("cmd")), patterns)
        if hit is not None:
            raise VerifyError("check {!r} ({}) matches the forbidden pattern {!r}: the run "
                              "profile forbids running it (user-policy-autonomy U01-F03)"
                              .format(check.name, check.source, hit.raw))
    cases = G.approved_case_deletions([marker_path])
    run_id = re.sub(r"[^0-9A-Za-z]", "", C.utc_iso())
    return Context(repo=repo, hdir=hdir, base=base_sha, head_at_start=head, scratch=scratch,
                   mode=mode, max_reverts=args.max_reverts,
                   config_path=config_path, profile_path=profile_path, profile_sha=profile_sha,
                   network=network, checks=checks, install_mode=install_mode,
                   explicit_installs=explicit, defaults=defaults, patterns=patterns,
                   approved=int((cases or {}).get("cases_removed") or 0),
                   log_root=hdir / "verify" / run_id, notes=notes,
                   e2e_coverage=bool(getattr(args, "e2e_coverage", False)))


# ---------------------------------------------------------------------------
# Clones, runs, bisect, reverts
# ---------------------------------------------------------------------------


def free_dir(parent: Path, stem: str, numbered: bool) -> Path:
    """<parent>/<stem>-<n> (numbered) or <stem>, <stem>-2, ... : the first that is free."""
    if not numbered and not (parent / stem).exists():
        return parent / stem
    index = 1 if numbered else 2
    while (parent / "{}-{}".format(stem, index)).exists():
        index += 1
    return parent / "{}-{}".format(stem, index)


def make_clone(ctx: Context, dest: Path, sha: str) -> None:
    proc = git(dest.parent, ["clone", "--no-local", "--quiet", C.to_posix(str(ctx.repo)),
                             C.to_posix(str(dest))])
    if proc.returncode != 0:
        raise VerifyError("git clone into {} failed: {}".format(
            dest.as_posix(), text(proc.stderr).strip()[:500]))
    proc = git(dest, ["checkout", "--quiet", "--detach", sha])
    if proc.returncode != 0:
        raise VerifyError("git checkout {} in {} failed: {}".format(
            sha[:12], dest.as_posix(), text(proc.stderr).strip()[:500]))


def run_all(ctx: Context, workdir: Path, label: str
            ) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, CheckDef]]:
    """Run the install steps and every check once in `workdir`."""
    defs: Dict[str, CheckDef] = {}
    results: Dict[str, Dict[str, Any]] = {}
    for check in install_checks(ctx.install_mode, ctx.explicit_installs, workdir,
                                ctx.patterns) + ctx.checks:
        defs[check.name] = check
        results[check.name] = run_check(check, workdir, ctx.log_root / label, 1, ctx.defaults)
    return results, defs


def public(rec: Dict[str, Any]) -> Dict[str, Any]:
    """A result record for verify.json (the normalised stdout lives in its own file)."""
    return {k: v for k, v in rec.items() if k != "stdout_normalised"}


def save_normalised(ctx: Context, label: str, results: Dict[str, Dict[str, Any]]) -> None:
    for name, rec in results.items():
        if "stdout_normalised" in rec:
            path = ctx.log_root / label / "{}.stdout.normalised.txt".format(
                re.sub(r"[^A-Za-z0-9._-]+", "_", name))
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(rec["stdout_normalised"])
            rec["stdout_normalised_file"] = C.to_posix(str(path))


def run_bisect(ctx: Context, clone: Path, head: str, check: CheckDef,
               base_rec: Optional[Dict[str, Any]], before: List[Dict[str, Any]],
               n: int) -> Dict[str, Any]:
    """Bisect `check` between the base and `head` in `clone`; git bisect reset afterwards.

    `before` lists the checks that run ahead of it ({check, base, required}): the probe
    replays them first, because a check may use what an earlier one built (an e2e check
    reading a gate's build output), and the probe starts from a cleaned checkout."""
    folder = ctx.log_root / "bisect-{}".format(n)
    folder.mkdir(parents=True, exist_ok=True)
    spec_path = folder / "spec.json"
    C.write_json(spec_path, {
        "check": check.to_json(), "base": base_rec, "approved": ctx.approved,
        "before": before, "defaults": ctx.defaults, "install_mode": ctx.install_mode,
        "installs": [i.to_json() for i in ctx.explicit_installs],
        "forbidden": [p.raw for p in ctx.patterns], "log_dir": C.to_posix(str(folder)),
        "clean": True})
    record: Dict[str, Any] = {"check": check.name, "spec": C.to_posix(str(spec_path)),
                              "first_bad": None, "candidates": []}
    git(clone, ["bisect", "reset"])
    start = git(clone, ["bisect", "start", head, ctx.base])
    if start.returncode != 0:
        record["error"] = "git bisect start failed: " + text(start.stderr).strip()[:500]
        return record
    proc = git(clone, ["bisect", "run", C.to_posix(sys.executable), "-S",
                       C.to_posix(os.path.abspath(__file__)), "--probe", "--spec",
                       C.to_posix(str(spec_path)), "--repo", C.to_posix(str(clone))])
    output = text(proc.stdout) + "\n" + text(proc.stderr)
    record["exit_code"] = proc.returncode
    record["output_tail"] = tail(output, 60)
    first = re.search(r"^([0-9a-f]{40,64}) is the first bad commit", output, re.M)
    if first:
        record["first_bad"] = first.group(1)
        record["candidates"] = [first.group(1)]
    elif "could be any of" in output:
        section = output.split("could be any of", 1)[1]
        record["candidates"] = list(dict.fromkeys(SHA_LINE_RE.findall(section)))
        record["ambiguous"] = True
    else:
        record["error"] = "git bisect run named no commit (exit {})".format(proc.returncode)
    record["log"] = tail(text(git(clone, ["bisect", "log"]).stdout), 60)
    git(clone, ["bisect", "reset"])
    return record


def revert_one(ctx: Context, sha: str) -> Tuple[Optional[str], Optional[str]]:
    """(revert commit sha, None), or (None, error) after `git revert --abort`."""
    args = ["revert", "--no-edit"] + (["-m", "1"] if parent_count(ctx.repo, sha) > 1 else []) \
        + [sha]
    proc = git(ctx.repo, args)
    if proc.returncode != 0:
        abort = git(ctx.repo, ["revert", "--abort"])
        return None, "git revert {} failed ({}): {}{}".format(
            sha[:12], proc.returncode, tail(text(proc.stdout) + text(proc.stderr), 20),
            "" if abort.returncode == 0 else "; git revert --abort also failed: " +
            text(abort.stderr).strip()[:300])
    return git_out(ctx.repo, ["rev-parse", "HEAD"]), None


def range_revert(ctx: Context, result: Dict[str, Any], check: str, reason: str) -> str:
    """Revert every commit of base..HEAD, newest first; returns the final status."""
    head = git_out(ctx.repo, ["rev-parse", "HEAD"])
    result["range_revert"] = {"reason": reason, "from": head}
    for sha in range_shas(ctx.repo, ctx.base, head, first_parent=True):
        subject = commit_subject(ctx.repo, sha)
        revert_sha, error = revert_one(ctx, sha)
        if revert_sha is None:
            result["notes"].append("range revert stopped at {}: {}".format(sha[:12], error))
            return "revert-conflict"
        result["reverts"].append({"sha": sha, "subject": subject, "check": check,
                                  "reason": reason, "output_tail": "", "revert_sha": revert_sha,
                                  "kind": "range"})
    result["tree_equals_base"] = git(ctx.repo, ["diff", "--quiet", ctx.base, "HEAD",
                                                "--"]).returncode == 0
    return "range-reverted"


def revert_links(ctx: Context, head: str) -> Dict[str, List[str]]:
    """Commit of base..head -> the commits of that range it says it reverts ("This reverts
    commit <sha>.", the message `git revert` writes)."""
    raw = text(git(ctx.repo, ["log", "--format=%H%x00%B%x1e", "{}..{}".format(
        ctx.base, head)]).stdout)
    entries = [e.strip("\n") for e in raw.split("\x1e") if e.strip()]
    commits = {e.split("\x00", 1)[0] for e in entries}
    links: Dict[str, List[str]] = {}
    for entry in entries:
        sha, _sep, body = entry.partition("\x00")
        targets = [t for t in REVERTS_RE.findall(body) if t in commits]
        if targets:
            links[sha] = targets
    return links


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------


def verify(ctx: Context) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "schema_version": C.SCHEMA_VERSION, "tool": "verify_branch.py",
        "started": C.utc_iso(), "finished": None, "repo": C.posix_abs(ctx.repo),
        "base": ctx.base, "head_at_start": ctx.head_at_start, "head_at_end": None,
        "mode": ctx.mode, "max_reverts": ctx.max_reverts,
        "profile": {"path": C.to_posix(str(ctx.profile_path)), "sha256": ctx.profile_sha}
        if ctx.profile_path else None,
        "config": C.to_posix(str(ctx.config_path)), "network": ctx.network,
        "install_mode": ctx.install_mode, "logs": C.to_posix(str(ctx.log_root)),
        "gates_only": not any(c.kind == "e2e" for c in ctx.checks),
        "definitions": [c.to_json() for c in ctx.explicit_installs + ctx.checks],
        "base_run": None, "iterations": [], "checks": [], "reverts": [],
        "final_status": "error", "tree_equals_base": None, "clones": [],
        "notes": list(ctx.notes), "exit_code": EXIT_ERROR}
    try:
        result["final_status"] = verify_loop(ctx, result)
    except (VerifyError, OSError, G.ConfigError) as exc:
        result["notes"].append("stopped: {}".format(exc))
        result["final_status"] = "error"
    result["e2e_coverage"] = None
    if ctx.e2e_coverage:
        result["e2e_coverage"] = []
        result["notes"].append("e2e coverage runs are recorded for e2e_reach.py and never "
                               "judged")
        try:
            coverage_pass(ctx, result)
        except Exception as exc:  # noqa: BLE001 - deliberate: the pass is never judged, and
            # an error in it must not cost the verdict or the verify.json record.
            result["notes"].append("e2e coverage run skipped: {}: {}".format(
                type(exc).__name__, exc))
    head = git(ctx.repo, ["rev-parse", "HEAD"])
    result["head_at_end"] = text(head.stdout).strip() if head.returncode == 0 else None
    result["finished"] = C.utc_iso()
    result["exit_code"] = FINAL_EXIT[result["final_status"]]
    return result


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]")


def coverage_pass(ctx: Context, result: Dict[str, Any]) -> None:
    """Run each profile e2e check once more in the last clone with NODE_V8_COVERAGE set.
    Never judged: the records only feed e2e_reach.py (pilot-auto-calibration A01-F21)."""
    if result["final_status"] not in ("green", "inconclusive") or not result["iterations"]:
        return
    last = result["iterations"][-1]
    clone = Path(last["clone"])
    head = git_out(ctx.repo, ["rev-parse", "HEAD"]).strip()
    if not clone.is_dir() or last.get("sha") != head:
        return
    for check in [c for c in ctx.checks if c.kind == "e2e"]:
        cov_dir = ctx.log_root / "e2e-coverage" / SAFE_NAME_RE.sub("-", check.name)
        cov_dir.mkdir(parents=True, exist_ok=True)
        raw = json.loads(json.dumps(check.raw))
        env = dict(raw.get("env") or {})
        env["NODE_V8_COVERAGE"] = str(cov_dir)
        raw["env"] = env
        tmp = CheckDef(name=check.name, kind="e2e", source=check.source, raw=raw,
                       compare=False)
        rec = run_check(tmp, clone, ctx.log_root / "e2e-coverage-logs", 0, ctx.defaults)
        files = sorted(cov_dir.glob("coverage-*.json"))
        try:
            rel_dir = C.to_posix(os.path.relpath(str(cov_dir), str(ctx.repo)))
        except ValueError:
            rel_dir = C.to_posix(str(cov_dir))
        result["e2e_coverage"].append({
            "check": check.name, "clone": C.to_posix(str(clone)), "sha": last.get("sha"),
            "dir": rel_dir, "exit_code": rec.get("exit_code"),
            "timed_out": bool(rec.get("timed_out")), "files": len(files),
            "error": rec.get("error")})


def verify_loop(ctx: Context, result: Dict[str, Any]) -> str:
    base_dir = free_dir(ctx.scratch, "verify-base", numbered=False)
    make_clone(ctx, base_dir, ctx.base)
    result["clones"].append({"path": C.to_posix(str(base_dir)), "sha": ctx.base,
                             "role": "base"})
    base_results, _defs = run_all(ctx, base_dir, "base")
    save_normalised(ctx, "base", base_results)
    result["base_run"] = {"clone": C.to_posix(str(base_dir)), "sha": ctx.base,
                          "results": {k: public(v) for k, v in base_results.items()}}
    iteration = 0
    while True:
        iteration += 1
        head = git_out(ctx.repo, ["rev-parse", "HEAD"])
        clone = free_dir(ctx.scratch, "verify", numbered=True)
        make_clone(ctx, clone, head)
        result["clones"].append({"path": C.to_posix(str(clone)), "sha": head, "role": "head"})
        label = "head-{}".format(iteration)
        results, defs = run_all(ctx, clone, label)
        save_normalised(ctx, label, results)
        verdicts = {name: judge(defs[name], rec, base_results.get(name), ctx.approved)
                    for name, rec in results.items()}
        checks = []
        for name, rec in results.items():
            entry = public(rec)
            entry.update(status=verdicts[name][0], reason=verdicts[name][1],
                         source=defs[name].source)
            checks.append(entry)
        red = [n for n, (status, _r) in verdicts.items() if status == "red"]
        record: Dict[str, Any] = {"n": iteration, "sha": head, "clone": C.to_posix(str(clone)),
                                  "results": checks, "red": red, "flaky": [],
                                  "unjudged": [n for n, (s, _r) in verdicts.items()
                                               if s == "unjudged"]}
        result["iterations"].append(record)
        result["checks"] = checks
        if not red:
            return "green" if not record["unjudged"] else "inconclusive"
        target: Optional[str] = None
        for name in red:
            again = run_check(defs[name], clone, ctx.log_root / label, 2, ctx.defaults)
            status, _reason = judge(defs[name], again, base_results.get(name), ctx.approved)
            if status == "red":
                target = name
                break
            record["flaky"].append(name)
            record["unjudged"].append(name)
            for entry in checks:
                if entry["name"] == name:
                    entry.update(status="unjudged", reason="flaky: red on the first run, "
                                 "{} on the re-run in the same clone".format(status))
        if target is None:
            return "inconclusive"
        if head == ctx.base:
            result["notes"].append("{} is red at HEAD, which is the base itself, while it "
                                   "passed in the base clone: the check depends on something "
                                   "outside the commit".format(target))
            return "inconclusive"
        failing = results[target]
        reason = verdicts[target][1]
        if ctx.mode != "report-only" and len(result["reverts"]) >= ctx.max_reverts:
            return range_revert(ctx, result, target, "still red after {} revert(s) "
                                "(--max-reverts {}): {}".format(len(result["reverts"]),
                                                                ctx.max_reverts, reason))
        names = list(results)
        before = [{"check": defs[name].to_json(), "base": base_results.get(name),
                   "required": verdicts[name][0] == "green"}
                  for name in names[:names.index(target)] if defs[name].kind != "install"]
        bisect = run_bisect(ctx, clone, head, defs[target], base_results.get(target), before,
                            iteration)
        record["bisect"] = bisect
        if ctx.mode == "report-only":
            result["notes"].append("report-only run: {} is red and was not reverted".format(
                target))
            return "red"
        in_range = range_shas(ctx.repo, ctx.base, head)
        candidates = sorted((c for c in bisect.get("candidates") or [] if c in in_range),
                            key=in_range.index)
        links = revert_links(ctx, head)
        undone = {target for targets in links.values() for target in targets}
        problem = None
        if not candidates:
            problem = "bisect named no commit of the range ({})".format(
                bisect.get("error") or "no candidate")
        elif any(parent_count(ctx.repo, c) > 1 for c in candidates):
            problem = "the first bad commit is a merge"
        elif any(c in links for c in candidates):
            problem = ("the first bad commit reverts another commit of the range, so the "
                       "applied commits depend on each other")
        elif any(c in undone for c in candidates):
            problem = ("bisect blamed a commit that is already reverted, so the failure "
                       "cannot be pinned on one commit")
        elif len(result["reverts"]) + len(candidates) > ctx.max_reverts:
            problem = "reverting {} candidate(s) would pass --max-reverts {}".format(
                len(candidates), ctx.max_reverts)
        if problem:
            return range_revert(ctx, result, target, "{}: {}".format(problem, reason))
        kind = "candidate" if bisect.get("ambiguous") else "bisect"
        for sha in candidates:
            subject = commit_subject(ctx.repo, sha)
            revert_sha, error = revert_one(ctx, sha)
            if revert_sha is None:
                result["notes"].append(error or "git revert failed")
                result["notes"].append(
                    "revert the commits from {} to HEAD yourself, newest first, one `git revert "
                    "--no-edit <sha>` each, then run verify_branch.py again (PC-26)".format(
                        sha[:12]))
                return "revert-conflict"
            result["reverts"].append({"sha": sha, "subject": subject, "check": target,
                                      "reason": reason, "output_tail": failing.get("tail", ""),
                                      "revert_sha": revert_sha, "kind": kind})


# ---------------------------------------------------------------------------
# Probe (run by git bisect run)
# ---------------------------------------------------------------------------


def probe(args: argparse.Namespace) -> int:
    """Test the checked-out commit for `git bisect run`: 0 good, 1 bad, 125 skip, 255 abort."""
    try:
        for name in LEAKY_GIT_ENV:
            os.environ.pop(name, None)
        spec = C.read_json(Path(args.spec))
        workdir = Path(args.repo or os.getcwd()).resolve()
        sha = git_out(workdir, ["rev-parse", "HEAD"])
        check = CheckDef.from_json(spec["check"])
        if args.check and args.check != check.name:
            print("harden-probe: --check {!r} is not the spec's check {!r}".format(
                args.check, check.name))
            return PROBE_ABORT
        log_dir = Path(spec["log_dir"]) / sha[:12]
        if spec.get("clean", True):
            git_out(workdir, ["clean", "-ffdxq"])
        patterns, _problems = vp.compile_patterns(spec.get("forbidden") or [])
        explicit = [CheckDef.from_json(i) for i in spec.get("installs") or []]
        installs = install_checks(spec.get("install_mode", "none"), explicit, workdir, patterns)
        defaults = spec.get("defaults") or {}
        base = spec.get("base")
        approved = int(spec.get("approved") or 0)
        if check.kind == "install" and check.name not in {i.name for i in installs}:
            print("harden-probe {} {}: bad: the install step is missing at this commit".format(
                sha[:12], check.name))
            return PROBE_BAD
        for step in installs:
            rec = run_check(step, workdir, log_dir, 1, defaults)
            if step.name == check.name:
                return probe_verdict(sha, check, rec, base, approved)
            if not rec["passed"]:
                print("harden-probe {} {}: skip: install step {} failed ({})".format(
                    sha[:12], check.name, step.name, failure_text(rec)))
                return PROBE_SKIP
        for item in spec.get("before") or []:
            earlier = CheckDef.from_json(item["check"])
            rec = run_check(earlier, workdir, log_dir, 1, defaults)
            status, reason = judge(earlier, rec, item.get("base"), approved)
            if item.get("required") and status != "green":
                print("harden-probe {} {}: skip: the earlier check {} is {} here ({})".format(
                    sha[:12], check.name, earlier.name, status, reason.split("\n")[0]))
                return PROBE_SKIP
        rec = run_check(check, workdir, log_dir, 1, defaults)
        if rec["environmental"]:
            print("harden-probe {} {}: skip: {}".format(sha[:12], check.name,
                                                        failure_text(rec)))
            return PROBE_SKIP
        return probe_verdict(sha, check, rec, base, approved)
    except Exception as exc:  # noqa: BLE001 - any internal error aborts the bisect
        print("harden-probe: internal error, aborting the bisect: {}: {}".format(
            type(exc).__name__, exc))
        traceback.print_exc(file=sys.stdout)
        return PROBE_ABORT


def probe_verdict(sha: str, check: CheckDef, rec: Dict[str, Any],
                  base: Optional[Dict[str, Any]], approved: int) -> int:
    status, reason = judge(check, rec, base, approved)
    print("harden-probe {} {}: {}: {}".format(sha[:12], check.name, {
        "green": "good", "red": "bad", "unjudged": "skip"}[status], reason.split("\n")[0]))
    return {"green": PROBE_GOOD, "red": PROBE_BAD, "unjudged": PROBE_SKIP}[status]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def summary_text(result: Dict[str, Any], out: Path) -> str:
    reverts = result["reverts"]
    lines = ["verify_branch: {} ({} revert(s)); HEAD {}".format(
        result["final_status"], len(reverts), (result.get("head_at_end") or "-")[:12])]
    base = result.get("base_run")
    if base:
        lines.append("  base {} in {}".format(result["base"][:12], base["clone"]))
    for it in result["iterations"]:
        counts: Dict[str, int] = {}
        for entry in it["results"]:
            counts[entry["status"]] = counts.get(entry["status"], 0) + 1
        lines.append("  iteration {} at {} in {}: {}".format(
            it["n"], it["sha"][:12], it["clone"],
            ", ".join("{} {}".format(v, k) for k, v in sorted(counts.items()))))
        for entry in it["results"]:
            if entry["status"] != "green":
                lines.append("    {:<9} {}: {}".format(entry["status"].upper(), entry["name"],
                                                       entry["reason"].split("\n")[0]))
        bisect = it.get("bisect")
        if bisect:
            if bisect.get("first_bad"):
                found = "first bad commit " + bisect["first_bad"][:12]
            elif bisect.get("candidates"):
                found = "candidates " + ", ".join(c[:12] for c in bisect["candidates"])
            else:
                found = str(bisect.get("error"))
            lines.append("    bisect {}: {}".format(bisect["check"], found))
    for rev in reverts:
        lines.append("  reverted {} \"{}\" ({}, check {}) by {}".format(
            rev["sha"][:12], rev["subject"], rev["kind"], rev["check"],
            (rev.get("revert_sha") or "-")[:12]))
    if result.get("tree_equals_base") is not None:
        lines.append("  tree equals the base: {}".format(result["tree_equals_base"]))
    if result.get("gates_only"):
        lines.append("  gates only: the profile lists no e2e check")
    for note in result["notes"]:
        lines.append("  note: {}".format(note))
    lines.append("written: {}".format(out.as_posix()))
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="verify_branch.py",
        description="End-to-end verification of a /harden branch from fresh clones; bisects "
                    "and reverts failures (PC-26).")
    parser.add_argument("--base", default=None, help="base commit of the run (required)")
    parser.add_argument("--config", default=".harden/config.json", help="gate config")
    parser.add_argument("--profile", default=None,
                        help="run profile (default: .harden/profile.json when it exists)")
    parser.add_argument("--max-reverts", type=int, default=5,
                        help="bisect reverts before the applied range is reverted (default 5)")
    parser.add_argument("--out", default=".harden/verify.json", help="result file")
    parser.add_argument("--repo", default=None, help="repository (default: .)")
    parser.add_argument("--json", action="store_true", help="print the result JSON")
    parser.add_argument("--e2e-coverage", action="store_true",
                        help="after a green or inconclusive end, run each profile e2e check "
                             "once more in the last clone with NODE_V8_COVERAGE set, for "
                             "e2e_reach.py; meant for Node e2e checks; never judged")
    parser.add_argument("--probe", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--spec", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--check", default=None, help=argparse.SUPPRESS)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return EXIT_ERROR if exc.code not in (0, None) else 0
    if args.probe:
        if not args.spec:
            print("harden-probe: --spec is required")
            return PROBE_ABORT
        return probe(args)
    if not args.base:
        C.eprint("verify_branch.py: --base is required")
        return EXIT_ERROR
    args.repo = args.repo or "."
    try:
        ctx = setup(args)
    except VerifyError as exc:
        C.eprint("verify_branch.py: {}".format(exc))
        return EXIT_ERROR
    result = verify(ctx)
    out = resolve_under(ctx.repo, args.out)
    try:
        C.write_json(out, result)
    except OSError as exc:
        C.eprint("verify_branch.py: cannot write {}: {}".format(out.as_posix(), exc))
        return EXIT_ERROR
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(summary_text(result, out))
    return int(result["exit_code"])


if __name__ == "__main__":
    sys.exit(main())
