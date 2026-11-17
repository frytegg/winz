#!/usr/bin/env python3
"""Run the project's own gate commands and record the outcome in .harden/gates/<label>.json.

Purpose
    Executes the gates declared in .harden/config.json, optionally several times, and records
    per run and per gate: exit code, duration, timeout, the last ~60 lines of stdout/stderr and
    the path of the full logs. Used for the recorded baseline before any edit (test-quality
    T13-F02: several runs, a red or unstable baseline blocks refactoring) and after every change.
    A gate whose pass/fail result differs across repeats is listed as flaky: an unresolved
    defect report, never something to retry away (T13-F03).

    Masking constructs in a gate command (`|| true`, `|| exit 0`, `set +e`, `--passWithNoTests`,
    scanner soft-fail switches; build-ci-infra G107-F01) and pipes without pipefail (G107-F02)
    are reported as warnings on the gate: such a gate may pass while the tool failed.

    Test counts (protocol-change PC-02: the collected test count must not drop): a gate with a
    "count_regex" records per run the number that regex extracts from its output, and
    `--min-count-from LABEL` fails the run when any gate's count is below the count recorded
    in .harden/gates/LABEL.json, less the test cases the user approved for deletion
    (`run_state.py allow-test-deletion --cases N`, summed from .harden/active; lens-dead-code
    DC-15).

    Ratchet gates (protocol-preflight PF-11; eval-v1-calibration E01-F02; cleanup-practice-
    forums T30-F15): a formatting or lint gate already red on the untouched base is not a
    baseline gate but a no-new-violations ratchet. It carries "ratchet": true and a
    count_regex that counts its violations. `--ratchet-from LABEL` then judges every selected
    ratchet gate by that count instead of its exit code: a non-zero exit code is not a failure
    by itself; the gate passes when its count in this run (the highest across repeats) is at
    most the count recorded for it in <out-dir>/LABEL.json (the probe; the lowest readable
    count across that file's runs), and fails when the count rises or cannot be read in any
    run. A count cannot be read when the run timed out or did not start, the count_regex
    found no number, or the exit code is non-zero with a count of 0 (the tool failed without
    reporting violations, e.g. a parse error). A ratchet gate that exits 0 without any
    count_regex match is recorded with count 0 and "count_inferred" (ESLint's default
    formatter and `cargo fmt --check` print nothing when clean). The result records per
    ratchet gate summary.<name>.ratchet = {"reference": n, "current": m, "passed": bool, ...}
    and the failures in "ratchet_check"; such a gate is flaky when its count, not its exit
    code, differs across repeats. Without --ratchet-from a ratchet gate is judged by its exit
    code like any gate, and --min-count-from never compares its count (a violation count may
    only fall). A total count cannot see one violation added while another is removed ("add
    one, remove one", types-static-analysis T18-F09), and a hunk count cannot see a new
    violation next to an existing one (with rustfmt 1.8.0, a misformatted function added
    right after a misformatted one joined its hunk: still 2 hunks; measured 2026-09-24):
    the per-item lint run of protocol-change step 8 and the SARIF delta cover what the count
    cannot.

    Evidence integrity: every result records "gates_sha256", the sha256 of the canonical JSON
    (sorted keys, no whitespace) of the config's whole "gates" array. `--min-count-from`
    refuses (exit 2) a reference recorded with another gate configuration: a replaced test
    gate or a changed count_regex voids every later comparison (llm-refactoring T10-F06:
    agents that cannot pass change the check instead; skill-design T31-F08). hook_guard.py
    keeps .harden/gates/ read-only for the agent's file tools and shell writes.
    `--ratchet-from` matches its reference per gate instead, because the probe ran under
    .harden/config.json and the ratchet runs under .harden/ratchet.json: every gate in a
    result records "gate_sha256", the sha256 of that gate's effective definition (name, cmd,
    timeout_s, cwd, shell, env, pipefail, count_regex, count_mode, inherit_env, env_allowlist;
    "ratchet" is left out, so the probe may run without it). Before any gate runs,
    --ratchet-from refuses (exit 2) a selected ratchet gate that is absent from the reference,
    whose gate_sha256 differs or is missing, that passed in every run of the reference (only
    a gate red there becomes a ratchet, PF-11), or that has no readable count there; and a
    selection without any "ratchet": true gate. The advice for a changed gate follows the
    mode of the run marker (<repo>/.harden/active, else the one next to --out-dir): with
    --interactive the user approves the new gates and the reference is recorded again; an
    autonomous run asks nobody (user-policy-autonomy U01-F01), keeps the reference's gates
    and records the wanted change as an owner item for the report; without a marker the
    message gives both.

    Environment (hardening-induced-regressions G205-F16: least privilege, production
    credentials in the environment reach every command the agent runs): a gate inherits the
    whole parent environment unless "inherit_env" is false; then it gets only the variables
    named in "env_allowlist" (those set in the parent) plus its own "env". Each gate in the
    result records "env_policy" ("inherit" or "allowlist") and "env_names", the names passed,
    never the values. The config's own "env_policy" record (inherit | allowlist | unconfirmed,
    protocol-preflight PF-03) is copied to the result; a missing or "unconfirmed" value adds a
    note.

    Evidence reuse (pilot-auto-calibration A01-F40): inside a git work tree every result
    records "tree": {"start", "end"}, each {"index_tree": `git write-tree`, "unstaged": whether
    `git diff --quiet` saw a tracked change, "untracked": the untracked, non-ignored files
    outside .harden/}, and "reusable_tree": the index tree when every gate passed, the tree
    was the same at both ends, nothing was unstaged or untracked and no --ratchet-from
    reference was used (else null). `--reuse-if-tree REV`, run with REV checked out, records
    a reuse instead of running ("reused_from", "reused_tree", "runs" []) when a result in
    <out-dir> names REV's tree as reusable_tree with the same gates_sha256 and gate names, no
    flaky gate, a count check that passed or was not made, no ratchet check, at least one run
    and no reused_from of its own. Otherwise, including when the checkout is not REV's clean
    tree, every gate runs and a note says why nothing was reused: an unmet reuse
    precondition never fails the call. `git write-tree` only adds content-addressed objects
    to .git/objects; no ref and no working-tree file changes.

    Forbidden commands (user-policy-autonomy U01-F03, U01-F04): a selected gate whose
    command matches a forbidden_commands pattern of the run marker (<repo>/.harden/active,
    else the one next to --out-dir; the marker's list and its profile's) is refused before
    any gate runs, with exit 2, as verify_branch.py refuses it.

Config (.harden/config.json)
    {"inherit_env": true, "env_allowlist": ["PATH", "SYSTEMROOT"],
     "gates": [{"name": "test", "cmd": "pnpm run test", "timeout_s": 1800, "cwd": ".",
                "shell": "bash", "env": {"KEY": "value"}, "pipefail": false,
                "inherit_env": false, "env_allowlist": ["PATH", "HOME"],
                "count_regex": "(\\\\d+) passed", "count_mode": "sum"},
               {"name": "lint", "cmd": ["pnpm", "run", "lint"], "ratchet": true,
                "count_regex": "(\\\\d+) problems? \\\\("}, ...]}
    - "inherit_env" (default true) and "env_allowlist" (default []) apply to every gate at the
      top level; a gate's own keys override them. With inherit_env false, list what the tools
      need to start (on Windows at least SYSTEMROOT, PATH, PATHEXT, TEMP, TMP, USERPROFILE,
      APPDATA, LOCALAPPDATA; elsewhere PATH and HOME); names are case-insensitive on Windows.
    - cmd string: run through the platform shell (cmd.exe on Windows, /bin/sh elsewhere),
      i.e. subprocess shell=True, which is the documented way to get that shell.
    - cmd list: argv, no shell. On Windows argv[0] is resolved with PATHEXT so `pnpm` finds
      pnpm.cmd.
    - "shell": "bash": run the string through bash -c. On Windows this is Git Bash's bash.exe,
      located explicitly; C:/Windows/System32/bash.exe (the WSL launcher) is never used. On
      POSIX, bash from PATH, else /bin/sh. Git Bash converts POSIX-looking arguments passed to
      native programs (polyglot-tooling T25-F18); scope MSYS_NO_PATHCONV=1 through "env" per
      gate when a command needs it.
    - "pipefail": true adds `-o pipefail` for bash gates (off by default: it changes behaviour,
      e.g. SIGPIPE from `| head`, build-ci-infra G107-F02).
    - "timeout_s" defaults to 1800; "cwd" is relative to the repository root (default ".").
      An absolute "cwd" is used as is, so it does not follow --repo (a note says so).
    - "count_regex" (optional): a Python regex with exactly one capture group, compiled with
      re.MULTILINE and applied to the run's whole stdout followed by its whole stderr, with ANSI
      colour codes removed and CRLF folded to LF. The group must hold an integer (",", "_" and
      spaces inside it are ignored). Examples in regex syntax (inside JSON every backslash is
      written twice): pytest `(\\d+) passed`, vitest `Tests\\s+(\\d+) passed`, cargo test
      `test result: ok\\. (\\d+) passed`; violation counts for ratchet gates: ESLint
      `(\\d+) problems? \\(` (the summary says "1 problem"), Ruff `Found (\\d+) errors?\\.`,
      `ruff format --check` `(\\d+) files? would be reformatted`, `cargo fmt --check`
      `^Diff in ` with count_mode "matches" (one "Diff in <file>:<line>:" line per hunk).
      Each run record gets "count" (int, or null when the gate has no count_regex, nothing
      matched or the group is not a number) and "count_matches" (number of matches).
    - "count_mode" (optional, default "sum"): how several matches combine: "sum" (cargo prints
      one "test result" line per test binary), "last" or "max"; "matches" counts the matches
      themselves (the regex may then have any number of groups, none is read, and no match
      is a count of 0).
    - "ratchet" (optional, default false): true makes the gate a no-new-violations ratchet
      judged by `--ratchet-from` (see Ratchet gates above); it requires a count_regex.
    - Top-level "install" is read by verify_branch.py (the install step of its fresh clones;
      assets/config.example.json), not by this script.
    Stdin is closed (DEVNULL) so interactive prompts and watch modes cannot block a gate.
    On timeout the whole process tree is killed: `taskkill /T /F` plus a kill-on-close Job
    Object on Windows (the job also reaches orphaned Git Bash processes), the process group
    (SIGTERM, then SIGKILL) on POSIX. Background processes a gate leaves behind are ended
    when it finishes, on both platforms.

CLI
    python gates.py --label LABEL [--repeat N] [--only name1,name2] [--config FILE]
                    [--repo DIR] [--out-dir DIR] [--min-count-from LABEL]
                    [--ratchet-from LABEL] [--reuse-if-tree REV] [--json]
    (use python3 on macOS/Linux)
    --label   required; [A-Za-z0-9._-]+; output goes to <out-dir>/<label>.json (overwritten)
              and full logs to <out-dir>/logs/<label>/
    --repeat  run the selected gates N times (default 1)
    --only    comma-separated gate names to run
    --repo    the checkout the gates run in (default: the current directory). Inside a git
              work tree it is resolved to the work-tree root, so a subdirectory runs the gates
              from the root; a directory without tracked files inside another repository is
              used as a plain directory. Every relative gate "cwd" is resolved against it, and
              git_head / worktree_dirty in the result describe it.
    --config  config path (default: <repo>/.harden/config.json); a relative path is resolved
              against the current directory, not against --repo
    --out-dir directory for <label>.json and logs/<label>/ (default: <repo>/.harden/gates).
              A relative path is resolved against the current directory. When given, nothing
              is written inside --repo: no .harden/ directory, no .git/info/exclude entry.
    --min-count-from LABEL
              load <out-dir>/LABEL.json and exit 1 when a gate's count in this run is below
              the count recorded there (the highest count across that file's runs is the
              reference, lowered by the approved deleted test cases of .harden/active
              "allow_test_deletions_meta" "cases"; the lowest count across this run's repeats
              is compared). A gate that had a count there but has none now also fails. Gates
              without a reference count, and ratchet gates, are listed as not compared.
              Missing/unreadable reference file, a reference whose gates_sha256 differs from
              the current config's (or is missing), or no selected non-ratchet gate with a
              reference count: exit 2 before any gate runs. The adjustment is printed and
              recorded in count_check.adjustment.
    --ratchet-from LABEL
              judge every selected "ratchet": true gate by its violation count against
              <out-dir>/LABEL.json (normally the probe) instead of its exit code; other
              selected gates keep their exit-code verdict. Exit 1 when a ratchet gate's count
              rose or could not be read. Unusable reference (see Evidence integrity): exit 2
              before any gate runs. Per item and at the final check:
                  python gates.py --config .harden/ratchet.json --label <id>-a<n>-ratchet \\
                                  --ratchet-from probe
    --reuse-if-tree REV
              with REV checked out: reuse the green run of REV's exact tree (see Evidence
              reuse) instead of running; else run every gate. Cannot be combined with
              --min-count-from, --ratchet-from, --only or --repeat other than 1 (exit 2); a REV
              that names no commit or tree is exit 2. Per commit in the final check:
                  python gates.py --label commit-<sha> --reuse-if-tree <sha>
    --json    print the result JSON to stdout instead of the text summary

    Fresh-clone replay (protocol-preflight PF-10) without editing the config:
        git clone --no-local . "<scratch_dir>/harden-fresh"
        python gates.py --repo "<scratch_dir>/harden-fresh" --config .harden/config.json \\
                        --out-dir .harden/gates --label fresh-clone
    runs every gate inside the clone (relative "cwd" values resolve against the clone) and
    writes the result next to the working tree's other gate results. <scratch_dir> is the
    run's scratch directory outside the repository ("scratch_dir" in .harden/active, made by
    `run_state.py start` under the OS temp directory and printed by `run_state.py status`;
    eval-v2-calibration E02-F08): a clone inside the repository would be found by its test
    runners and detectors, and Node would resolve the repository's node_modules from it.

Exit codes
    0  every run of every selected gate passed (and, with --min-count-from, no count dropped;
       with --ratchet-from, every ratchet gate's count stayed at or below its reference,
       whatever its exit code)
    1  at least one gate failed, timed out or could not start, a count dropped or went
       missing (--min-count-from), or a ratchet gate's count rose or could not be read
       (--ratchet-from)
    2  configuration or usage error (missing/invalid config, empty gate list, unknown --only
       name, bad label, bad --repeat, invalid count_regex/count_mode/ratchet/inherit_env/
       env_allowlist, a ratchet gate without count_regex, unusable --min-count-from or
       --ratchet-from reference, gate configuration changed since the reference, a selected
       gate forbidden by the run profile, --reuse-if-tree combined with a flag it excludes or
       given a REV that does not resolve)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as C  # noqa: E402
import validate_profile as vp  # noqa: E402  (forbidden_commands matching, as verify_branch.py)

TAIL_LINES = 60
DEFAULT_TIMEOUT_S = 1800
LOG_CAP_BYTES = 20 * 1024 * 1024
LABEL_RE = re.compile(r"^[A-Za-z0-9._-]+$")
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")
# build-ci-infra G107-F01 masking constructs (the regex inventory.py uses, from _common).
MASKING_RE = C.MASKING_RE
PIPE_RE = re.compile(r"(^|[^|])\|([^|]|$)")
COUNT_MODES = ("sum", "last", "max", "matches")
COUNT_NOISE_RE = re.compile(r"[,_\s]")
# Run modes (.harden/active "mode") whose questions go to the user live; "apply" is the older
# name of "interactive" (run_state.py). Every other mode asks nobody (user-policy-autonomy
# U01-F01).
INTERACTIVE_MODES = frozenset({"interactive", "apply"})


class ConfigError(ValueError):
    """The gate configuration is unusable."""


@dataclass
class Gate:
    """One configured gate."""
    name: str
    cmd: Union[str, List[str]]
    timeout_s: float
    cwd: str
    shell: Optional[str]
    env: Dict[str, str] = field(default_factory=dict)
    pipefail: bool = False
    count_regex: Optional["re.Pattern[str]"] = None
    count_mode: str = "sum"
    inherit_env: bool = True
    env_allowlist: List[str] = field(default_factory=list)
    ratchet: bool = False

    @property
    def env_policy(self) -> str:
        return "inherit" if self.inherit_env else "allowlist"

    def identity_sha256(self) -> str:
        """sha256 of the gate's effective definition, without "ratchet" (the probe may run
        the gate before it becomes a ratchet): what --ratchet-from matches per gate."""
        identity = {"name": self.name, "cmd": self.cmd, "timeout_s": self.timeout_s,
                    "cwd": self.cwd, "shell": self.shell, "env": self.env,
                    "pipefail": self.pipefail,
                    "count_regex": None if self.count_regex is None else self.count_regex.pattern,
                    "count_mode": self.count_mode, "inherit_env": self.inherit_env,
                    "env_allowlist": self.env_allowlist}
        canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def describe(self) -> Dict[str, Any]:
        """JSON view of the gate as configured (environment names only, never values)."""
        d: Dict[str, Any] = {"name": self.name, "cmd": self.cmd, "timeout_s": self.timeout_s,
                             "cwd": self.cwd, "shell": self.shell or (
                                 "platform" if isinstance(self.cmd, str) else "none (argv)")}
        if self.env:
            d["env"] = self.env
        if self.pipefail:
            d["pipefail"] = True
        if self.count_regex is not None:
            d["count_regex"] = self.count_regex.pattern
            d["count_mode"] = self.count_mode
        if self.ratchet:
            d["ratchet"] = True
        d["gate_sha256"] = self.identity_sha256()
        d["env_policy"] = self.env_policy
        d["env_names"] = sorted(gate_env(self))
        if not self.inherit_env:
            d["env_allowlist"] = list(self.env_allowlist)
            missing = [n for n in self.env_allowlist if _env_lookup(n) is None]
            if missing:
                d["env_allowlist_unset"] = missing
        return d


def _env_lookup(name: str) -> Optional[str]:
    """Parent environment value of `name` (case-insensitive on Windows), or None."""
    if name in os.environ:
        return os.environ[name]
    if os.name == "nt":
        folded = name.upper()
        for key, value in os.environ.items():
            if key.upper() == folded:
                return value
    return None


def gate_env(gate: Gate) -> Dict[str, str]:
    """The environment a gate runs with: the parent's (inherit_env) or only the allowlisted
    parent variables, then the gate's own "env"."""
    if gate.inherit_env:
        env = dict(os.environ)
    else:
        env = {}
        for name in gate.env_allowlist:
            value = _env_lookup(name)
            if value is not None:
                env[name] = value
    env.update(gate.env)
    return env


def gates_digest(raw_gates: Any) -> str:
    """sha256 of the canonical JSON of the config's "gates" array (sorted keys, no spaces)."""
    canonical = json.dumps(raw_gates, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compile_count_regex(raw: Any, where: str, count_mode: str = "sum") -> "re.Pattern[str]":
    """Compile a gate's count_regex; it must have exactly one capture group, except in
    count_mode "matches", where no group is read."""
    if not isinstance(raw, str) or not raw.strip():
        raise ConfigError("{} count_regex must be a non-empty string".format(where))
    try:
        compiled = re.compile(raw, re.MULTILINE)
    except re.error as exc:
        raise ConfigError("{} count_regex is not a valid regex: {}".format(where, exc)) from exc
    if count_mode != "matches" and compiled.groups != 1:
        raise ConfigError("{} count_regex must have exactly one capture group (it has {}); use "
                          "(?:...) for the other groups".format(where, compiled.groups))
    return compiled


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


def parse_gates(data: Any, repo: Path) -> List[Gate]:
    """Validate the `gates` list of a config document."""
    if not isinstance(data, dict):
        raise ConfigError("config root must be a JSON object")
    raw = data.get("gates")
    if not isinstance(raw, list):
        raise ConfigError("config has no \"gates\" list")
    if not raw:
        # An empty gate list would make every run "green" with nothing checked
        # (the empty-scan trap of polyglot-tooling T25-F06).
        raise ConfigError("config \"gates\" list is empty: nothing would be checked")
    default_inherit = _parse_inherit(data.get("inherit_env", True), "config")
    default_allowlist = _parse_allowlist(data.get("env_allowlist", []), "config")
    gates: List[Gate] = []
    names: set = set()
    for idx, item in enumerate(raw):
        where = "gates[{}]".format(idx)
        if not isinstance(item, dict):
            raise ConfigError("{} must be an object".format(where))
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ConfigError("{}.name must be a non-empty string".format(where))
        if name in names:
            raise ConfigError("duplicate gate name {!r}".format(name))
        names.add(name)
        cmd = item.get("cmd")
        if isinstance(cmd, str):
            if not cmd.strip():
                raise ConfigError("{} ({}) cmd is empty".format(where, name))
        elif isinstance(cmd, list):
            if not cmd or not all(isinstance(a, str) for a in cmd) or not cmd[0].strip():
                raise ConfigError("{} ({}) cmd list must be non-empty strings".format(where, name))
        else:
            raise ConfigError("{} ({}) cmd must be a string or a list of strings".format(where, name))
        timeout = item.get("timeout_s", DEFAULT_TIMEOUT_S)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ConfigError("{} ({}) timeout_s must be a positive number".format(where, name))
        cwd = item.get("cwd", ".")
        if not isinstance(cwd, str) or not cwd.strip():
            raise ConfigError("{} ({}) cwd must be a string".format(where, name))
        if not (repo / cwd).is_dir():
            raise ConfigError("{} ({}) cwd does not exist: {}".format(where, name, cwd))
        shell = item.get("shell")
        if shell is not None and shell not in ("bash", "sh", "platform"):
            raise ConfigError("{} ({}) shell must be \"bash\" (or omitted)".format(where, name))
        if shell in ("bash", "sh") and not isinstance(cmd, str):
            raise ConfigError("{} ({}) shell \"bash\" needs a string cmd".format(where, name))
        env = item.get("env", {})
        if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str)
                                                for k, v in env.items()):
            raise ConfigError("{} ({}) env must map strings to strings".format(where, name))
        pipefail = item.get("pipefail", False)
        if not isinstance(pipefail, bool):
            raise ConfigError("{} ({}) pipefail must be true or false".format(where, name))
        count_mode = item.get("count_mode", "sum")
        if count_mode not in COUNT_MODES:
            raise ConfigError("{} ({}) count_mode must be one of {}".format(
                where, name, ", ".join(COUNT_MODES)))
        count_regex = None
        if item.get("count_regex") is not None:
            count_regex = compile_count_regex(item["count_regex"], "{} ({})".format(where, name),
                                              count_mode)
        ratchet = item.get("ratchet", False)
        if not isinstance(ratchet, bool):
            raise ConfigError("{} ({}) ratchet must be true or false".format(where, name))
        if ratchet and count_regex is None:
            # Without a count the ratchet could only trust the exit code it is meant to replace.
            raise ConfigError("{} ({}) ratchet needs a count_regex that counts the gate's "
                              "violations".format(where, name))
        label = "{} ({})".format(where, name)
        inherit = _parse_inherit(item["inherit_env"], label) if "inherit_env" in item \
            else default_inherit
        allowlist = _parse_allowlist(item["env_allowlist"], label) if "env_allowlist" in item \
            else list(default_allowlist)
        gates.append(Gate(name=name, cmd=cmd, timeout_s=float(timeout), cwd=C.to_posix(cwd),
                          shell=None if shell == "platform" else shell, env=dict(env),
                          pipefail=pipefail, count_regex=count_regex, count_mode=count_mode,
                          inherit_env=inherit, env_allowlist=allowlist, ratchet=ratchet))
    return gates


def _parse_inherit(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        raise ConfigError("{} inherit_env must be true or false".format(where))
    return value


def _parse_allowlist(value: Any, where: str) -> List[str]:
    if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
        raise ConfigError("{} env_allowlist must be a list of variable names".format(where))
    return [v.strip() for v in value]


def load_config(path: Path, repo: Path) -> List[Gate]:
    """Read and validate a config file."""
    return parse_gates(read_config(path, repo), repo)


def read_config(path: Path, repo: Path) -> Any:
    """The parsed config document (ConfigError when missing or not JSON)."""
    if not path.is_file():
        hint = ""
        if path == C.harden_dir(repo) / "config.json":
            hint = (" (.harden/ is not versioned, so a fresh clone has no config: pass "
                    "--config <working tree>/.harden/config.json)")
        raise ConfigError("config file not found: {}{}".format(C.to_posix(str(path)), hint))
    try:
        return C.read_json(path)
    except ValueError as exc:
        raise ConfigError("config is not valid JSON: {}".format(exc)) from exc
    except OSError as exc:
        raise ConfigError("cannot read config: {}".format(exc)) from exc


# ---------------------------------------------------------------------------
# Shells
# ---------------------------------------------------------------------------


def _is_wsl_launcher(path: str) -> bool:
    low = C.to_posix(path).lower()
    return "/windows/system32/" in low or "/windowsapps/" in low or low.endswith("/sysnative/bash.exe")


def find_git_bash() -> Optional[str]:
    """Locate Git for Windows' bash.exe; never the WSL launcher in System32 or WindowsApps."""
    candidates: List[str] = []
    git_exe = shutil.which("git")
    if git_exe:
        gp = Path(git_exe).resolve()
        # <Git>/cmd/git.exe, <Git>/bin/git.exe or <Git>/mingw64/bin/git.exe
        for root in (gp.parent.parent, gp.parent.parent.parent):
            candidates += [str(root / "bin" / "bash.exe"), str(root / "usr" / "bin" / "bash.exe")]
    try:
        exec_path = subprocess.run(["git", "--exec-path"], stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, check=False).stdout.decode(
                                       "utf-8", errors="replace").strip()
    except OSError:
        exec_path = ""
    if exec_path:
        # <Git>/mingw64/libexec/git-core
        root = Path(exec_path).parent.parent.parent
        candidates += [str(root / "bin" / "bash.exe"), str(root / "usr" / "bin" / "bash.exe")]
    for env_var in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
        base = os.environ.get(env_var)
        if base:
            candidates.append(str(Path(base) / "Git" / "bin" / "bash.exe"))
    local = os.environ.get("LOCALAPPDATA")
    if local:
        candidates.append(str(Path(local) / "Programs" / "Git" / "bin" / "bash.exe"))
    which_bash = shutil.which("bash")
    if which_bash:
        candidates.append(which_bash)
    for cand in candidates:
        if cand and os.path.isfile(cand) and not _is_wsl_launcher(cand):
            return C.to_posix(cand)
    return None


def find_bash() -> Tuple[Optional[str], str]:
    """(bash executable, description). POSIX falls back to /bin/sh."""
    if os.name == "nt":
        path = find_git_bash()
        return path, "Git Bash" if path else "Git Bash not found"
    path = shutil.which("bash") or ("/bin/bash" if os.path.exists("/bin/bash") else None)
    if path:
        return path, "bash"
    return ("/bin/sh", "/bin/sh (bash not found)") if os.path.exists("/bin/sh") else (None, "no sh")


def resolve_argv0(argv: List[str]) -> List[str]:
    """Resolve argv[0] through PATH (PATHEXT on Windows) so pnpm finds pnpm.cmd."""
    first = argv[0]
    if os.path.dirname(first):
        return argv
    found = shutil.which(first)
    return [found] + argv[1:] if found else argv


# ---------------------------------------------------------------------------
# Running
# ---------------------------------------------------------------------------


def command_warnings(gate: Gate) -> List[str]:
    """Static warnings about a gate command (masking constructs, unguarded pipes)."""
    text = gate.cmd if isinstance(gate.cmd, str) else " ".join(gate.cmd)
    warnings = ["masking construct {!r}: the gate can pass while the tool failed (G107-F01)"
                .format(m.group(0)) for m in MASKING_RE.finditer(text)]
    if isinstance(gate.cmd, str) and PIPE_RE.search(gate.cmd) and not gate.pipefail:
        warnings.append("pipe without pipefail: only the last command's exit status counts "
                        "(G107-F02)")
    return warnings


class WinJob:
    """A Windows Job Object holding one gate's process tree (kill-on-close).

    `taskkill /T` walks parent PIDs, which misses orphans: Git Bash (MSYS) programs started
    through a forked-then-exec'd bash have a dead Windows parent, so a `sleep`/`tail -f` of a
    timed-out bash gate survived. Processes in a job cannot leave it (Cygwin/MSYS only break
    away when the job allows it), so terminating the job reaches them. The job is created
    before the gate starts and the process is assigned right after CreateProcess returns, so
    the window in which a child could start outside the job is a few microseconds (Git's
    bin/bash.exe launcher, for one, starts usr/bin/bash.exe within milliseconds). Stdlib
    ctypes only; any API failure leaves `handle` None and taskkill remains the only mechanism.
    """

    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9

    def __init__(self) -> None:
        self.handle: Optional[int] = None
        self._k32: Any = None
        if os.name != "nt":
            return
        try:
            import ctypes
            from ctypes import wintypes

            k32 = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
            k32.CreateJobObjectW.restype = wintypes.HANDLE
            k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
            k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int,
                                                    ctypes.c_void_p, wintypes.DWORD]
            k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
            k32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
            k32.CloseHandle.argtypes = [wintypes.HANDLE]

            class _Basic(ctypes.Structure):
                _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64),
                            ("PerJobUserTimeLimit", ctypes.c_int64),
                            ("LimitFlags", wintypes.DWORD),
                            ("MinimumWorkingSetSize", ctypes.c_size_t),
                            ("MaximumWorkingSetSize", ctypes.c_size_t),
                            ("ActiveProcessLimit", wintypes.DWORD),
                            ("Affinity", ctypes.c_size_t),
                            ("PriorityClass", wintypes.DWORD),
                            ("SchedulingClass", wintypes.DWORD)]

            class _Extended(ctypes.Structure):
                _fields_ = [("BasicLimitInformation", _Basic),
                            ("IoInfo", ctypes.c_uint64 * 6),
                            ("ProcessMemoryLimit", ctypes.c_size_t),
                            ("JobMemoryLimit", ctypes.c_size_t),
                            ("PeakProcessMemoryUsed", ctypes.c_size_t),
                            ("PeakJobMemoryUsed", ctypes.c_size_t)]

            job = k32.CreateJobObjectW(None, None)
            if not job:
                return
            info = _Extended()
            info.BasicLimitInformation.LimitFlags = self.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not k32.SetInformationJobObject(job, self.JOBOBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                                               ctypes.byref(info), ctypes.sizeof(info)):
                k32.CloseHandle(job)
                return
            self.handle, self._k32 = job, k32
        except (OSError, AttributeError, ValueError, TypeError):
            self.handle = None

    def assign(self, proc: "subprocess.Popen[bytes]") -> bool:
        """Put a just-started process in the job; on failure the job is dropped."""
        if self.handle is None:
            return False
        proc_handle = getattr(proc, "_handle", None)
        if proc_handle is not None and self._k32.AssignProcessToJobObject(self.handle,
                                                                          int(proc_handle)):
            return True
        self.close()
        return False

    def terminate(self) -> None:
        """Kill every process still in the job."""
        if self.handle is not None:
            self._k32.TerminateJobObject(self.handle, 1)

    def close(self) -> None:
        """Close the job; kill-on-close ends background processes the gate left behind
        (the Windows counterpart of the process-group kill after a POSIX gate)."""
        if self.handle is not None:
            self._k32.CloseHandle(self.handle)
            self.handle = None


def kill_tree(proc: "subprocess.Popen[bytes]", job: Optional[WinJob] = None) -> None:
    """Kill a process and all of its descendants."""
    if proc.poll() is not None and os.name != "nt":
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # leftover group members
        except OSError:
            pass
        return
    if os.name == "nt":
        # taskkill first, while the parent links still exist (it also reaches any process
        # that escaped the job); then the job, which reaches orphans taskkill cannot see.
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, check=False)
        if job is not None:
            job.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except OSError:
        pass
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except OSError:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def tail_lines(data: bytes, n: int = TAIL_LINES) -> str:
    """Last n lines of output, decoded as UTF-8 with ANSI escapes removed."""
    text = ANSI_RE.sub("", data.decode("utf-8", errors="replace")).replace("\r\n", "\n")
    lines = [ln.rsplit("\r", 1)[-1] for ln in text.split("\n")]
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines[-n:])


def extract_count(gate: Gate, out_b: bytes, err_b: bytes
                  ) -> Tuple[Optional[int], int, Optional[str]]:
    """(count, number of matches, problem) from a run's output, using the gate's count_regex.

    The regex runs over the whole stdout followed by the whole stderr (ANSI codes removed,
    CRLF folded), so a summary printed on either stream is found. Several matches are
    combined with the gate's count_mode; in mode "matches" the count is the number of matches.
    """
    if gate.count_regex is None:
        return None, 0, None
    text = "\n".join(ANSI_RE.sub("", data.decode("utf-8", errors="replace")).replace("\r\n", "\n")
                     for data in (out_b, err_b))
    if gate.count_mode == "matches":
        found = sum(1 for _ in gate.count_regex.finditer(text))
        return found, found, None
    values: List[int] = []
    matches = 0
    for match in gate.count_regex.finditer(text):
        matches += 1
        raw = match.group(1)
        if raw is None:
            continue  # the group sits in a branch of the regex that did not take part
        cleaned = COUNT_NOISE_RE.sub("", raw)
        if not re.fullmatch(r"[0-9]+", cleaned):
            return None, matches, "count_regex group matched {!r}, which is not an integer".format(
                raw[:80])
        values.append(int(cleaned))
    if not values:
        return None, matches, ("count_regex matched nothing in the output" if matches == 0 else
                               "count_regex matched but its group captured nothing")
    if gate.count_mode == "last":
        return values[-1], matches, None
    if gate.count_mode == "max":
        return max(values), matches, None
    return sum(values), matches, None


def build_invocation(gate: Gate) -> Tuple[Union[str, List[str]], bool, str]:
    """(args for Popen, use shell=True, human description of the shell)."""
    if isinstance(gate.cmd, list):
        return resolve_argv0(list(gate.cmd)), False, "none (argv)"
    if gate.shell in ("bash", "sh"):
        bash, desc = find_bash()
        if bash is None:
            raise FileNotFoundError("bash not found ({})".format(desc))
        argv = [bash]
        if gate.pipefail:
            argv += ["-o", "pipefail"]
        return argv + ["-c", gate.cmd], False, "{} ({})".format(desc, bash)
    return gate.cmd, True, os.environ.get("COMSPEC", "cmd.exe") if os.name == "nt" else "/bin/sh"


def run_gate(gate: Gate, repo: Path, log_dir: Path, run_index: int) -> Dict[str, Any]:
    """Run one gate once and return its record."""
    record: Dict[str, Any] = {"name": gate.name, "run": run_index, "exit_code": None,
                              "passed": False, "timed_out": False, "duration_s": 0.0,
                              "stdout_tail": "", "stderr_tail": "", "started": C.utc_iso(),
                              "count": None}
    cwd = (repo / gate.cwd).resolve()
    env = gate_env(gate)
    try:
        args, use_shell, shell_desc = build_invocation(gate)
    except FileNotFoundError as exc:
        record["error"] = str(exc)
        return record
    record["shell_used"] = shell_desc
    popen_kwargs: Dict[str, Any] = {}
    if os.name != "nt":
        popen_kwargs["start_new_session"] = True
    out_f = tempfile.TemporaryFile()
    err_f = tempfile.TemporaryFile()
    start = time.monotonic()
    try:
        job = WinJob() if os.name == "nt" else None  # ready before the gate starts
        try:
            proc = subprocess.Popen(args, shell=use_shell, cwd=str(cwd), env=env,
                                    stdin=subprocess.DEVNULL, stdout=out_f, stderr=err_f,
                                    **popen_kwargs)
        except OSError as exc:
            if job is not None:
                job.close()
            record["error"] = "could not start: {}".format(exc)
            record["exit_code"] = None
            return record
        if job is not None:
            job.assign(proc)
        try:
            try:
                code = proc.wait(timeout=gate.timeout_s)
            except subprocess.TimeoutExpired:
                record["timed_out"] = True
                kill_tree(proc, job)
                code = proc.returncode
            else:
                if os.name != "nt":
                    kill_tree(proc)  # reap background children left in the process group
        finally:
            if job is not None:
                job.close()  # kill-on-close: leftover background processes end here
        record["duration_s"] = round(time.monotonic() - start, 3)
        record["exit_code"] = code
        record["passed"] = code == 0 and not record["timed_out"]
        out_f.seek(0)
        err_f.seek(0)
        out_b = out_f.read()
        err_b = err_f.read()
    finally:
        out_f.close()
        err_f.close()
    record["stdout_tail"] = tail_lines(out_b)
    record["stderr_tail"] = tail_lines(err_b)
    if gate.count_regex is not None:
        count, matches, problem = extract_count(gate, out_b, err_b)
        if gate.ratchet and count is None and matches == 0 and code == 0 \
                and not record["timed_out"]:
            # A clean linter or formatter often prints no summary at all (ESLint's default
            # formatter, cargo fmt --check); exit code 0 then means no violations.
            count, problem = 0, None
            record["count_inferred"] = "exit code 0 and no count_regex match: no violations"
        record["count"] = count
        record["count_matches"] = matches
        if problem:
            record["count_error"] = problem
    record["log_paths"] = write_logs(log_dir, gate.name, run_index, out_b, err_b)
    if record["timed_out"]:
        record["error"] = "timed out after {}s; process tree killed".format(gate.timeout_s)
    return record


def write_logs(log_dir: Path, name: str, run_index: int, out_b: bytes, err_b: bytes
               ) -> Dict[str, str]:
    """Save full (capped) logs; returns their forward-slash paths."""
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    log_dir.mkdir(parents=True, exist_ok=True)
    paths: Dict[str, str] = {}
    for kind, data in (("stdout", out_b), ("stderr", err_b)):
        if len(data) > LOG_CAP_BYTES:
            data = b"[... truncated to the last %d bytes ...]\n" % LOG_CAP_BYTES + \
                data[-LOG_CAP_BYTES:]
        p = log_dir / "{}.run{}.{}.log".format(safe, run_index, kind)
        with open(p, "wb") as handle:
            handle.write(data)
        paths[kind] = C.to_posix(str(p))
    return paths


def summarise(gates: Sequence[Gate], runs: Sequence[Dict[str, Any]],
              ratchet_judged: Sequence[str] = ()) -> Tuple[Dict[str, Any], List[str], bool]:
    """Per-gate summary, flaky gate names, all_passed.

    Gates named in `ratchet_judged` (--ratchet-from) are judged by ratchet_check, not by
    their exit codes: they do not affect all_passed, and they are flaky when their readable
    violation count differs across repeats."""
    summary: Dict[str, Any] = {}
    flaky: List[str] = []
    all_passed = True
    for g in gates:
        recs = [r for run in runs for r in run["results"] if r["name"] == g.name]
        passed = sum(1 for r in recs if r["passed"])
        timed_out = sum(1 for r in recs if r["timed_out"])
        durations = sorted(r["duration_s"] for r in recs)
        codes = sorted({r["exit_code"] for r in recs if r["exit_code"] is not None})
        if g.name in ratchet_judged:
            outcomes: set = {ratchet_run_count(r)[0] for r in recs}
        else:
            outcomes = {r["passed"] for r in recs}
            if passed != len(recs):
                all_passed = False
        is_flaky = len(outcomes) > 1
        if is_flaky:
            flaky.append(g.name)
        counts = [r.get("count") for r in recs]
        known = [c for c in counts if isinstance(c, int) and not isinstance(c, bool)]
        summary[g.name] = {
            "runs": len(recs), "passed": passed, "failed": len(recs) - passed,
            "timed_out": timed_out, "exit_codes": codes, "flaky": is_flaky,
            "median_duration_s": durations[len(durations) // 2] if durations else None,
            "max_duration_s": durations[-1] if durations else None,
            "counts": counts,
            "count_min": min(known) if known else None,
            "count_max": max(known) if known else None}
    return summary, flaky, all_passed


# ---------------------------------------------------------------------------
# Test-count comparison (PC-02)
# ---------------------------------------------------------------------------


class CountReferenceError(ValueError):
    """The --min-count-from reference cannot be used."""


def _as_count(value: Any) -> Optional[int]:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def load_reference_counts(path: Path) -> Dict[str, Optional[int]]:
    """Gate name -> highest count recorded across the runs of a gates result file.

    A gate present in the file whose runs carry no count maps to None.
    """
    if not path.is_file():
        raise CountReferenceError("reference result not found: {}".format(C.to_posix(str(path))))
    try:
        data = C.read_json(path)
    except (OSError, ValueError) as exc:
        raise CountReferenceError("cannot read reference result {}: {}".format(
            C.to_posix(str(path)), exc)) from exc
    runs = data.get("runs") if isinstance(data, dict) else None
    if not isinstance(runs, list):
        raise CountReferenceError("{} is not a gates.py result (no \"runs\" list)".format(
            C.to_posix(str(path))))
    counts: Dict[str, Optional[int]] = {}
    for run in runs:
        results = run.get("results") if isinstance(run, dict) else None
        for rec in results if isinstance(results, list) else []:
            if not isinstance(rec, dict) or not isinstance(rec.get("name"), str):
                continue
            value = _as_count(rec.get("count"))
            previous = counts.get(rec["name"])
            if value is None:
                counts.setdefault(rec["name"], None)
            elif previous is None or value > previous:
                counts[rec["name"]] = value
    return counts


def reference_gates_sha256(path: Path) -> Optional[str]:
    """gates_sha256 recorded in a gates result file (None when absent or unreadable)."""
    try:
        data = C.read_json(path)
    except (OSError, ValueError):
        return None
    value = data.get("gates_sha256") if isinstance(data, dict) else None
    return value if isinstance(value, str) and value else None


def marker_asks_user(marker_paths: Sequence[Path]) -> Optional[bool]:
    """Whether the run of the first existing marker asks the user live: True with
    --interactive (also a report-only run started as one), False in autonomous mode, which
    never asks or waits (user-policy-autonomy U01-F01), None without a readable marker."""
    for path in marker_paths:
        if not path.is_file():
            continue
        try:
            marker = C.read_json(path)
        except (OSError, ValueError):
            return None
        mode = marker.get("mode") if isinstance(marker, dict) else None
        if mode in INTERACTIVE_MODES:
            return True
        if mode == "report-only" and marker.get("mode_requested") in INTERACTIVE_MODES:
            return True
        return False if isinstance(mode, str) and mode else None
    return None


def gate_change_advice(asks_user: Optional[bool], rerecord: str) -> str:
    """What to do about a gate changed after its reference, by run mode: the user approves a
    new gate set live (--interactive); an autonomous run asks nobody (U01-F01), keeps the
    reference's gates and leaves the change to the owner through the report."""
    interactive = "ask the user to approve the new gates, then {}".format(rerecord)
    autonomous = ("an autonomous run asks nobody (user-policy-autonomy U01-F01): keep the gates "
                  "the reference ran and record the wanted change as an owner item in "
                  ".harden/progress.md and the report")
    if asks_user is True:
        return interactive
    if asks_user is False:
        return autonomous
    return "with --interactive, {}; {}".format(interactive, autonomous)


def approved_case_deletions(marker_paths: Sequence[Path]) -> Optional[Dict[str, Any]]:
    """Test cases approved for deletion (run_state.py allow-test-deletion --cases), from the
    first existing marker: {"cases_removed", "source", "records"}; None without a marker.

    The latest record per path counts (re-recording a path replaces its count)."""
    for path in marker_paths:
        if not path.is_file():
            continue
        try:
            marker = C.read_json(path)
        except (OSError, ValueError):
            return None
        meta = marker.get("allow_test_deletions_meta") if isinstance(marker, dict) else None
        per_path: Dict[str, int] = {}
        for entry in meta if isinstance(meta, list) else []:
            if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                continue
            cases = _as_count(entry.get("cases"))
            per_path[entry["path"]] = cases if cases is not None else 0
        return {"cases_removed": sum(per_path.values()), "source": C.to_posix(str(path)),
                "records": dict(sorted(per_path.items()))}
    return None


def check_counts(reference: Dict[str, Optional[int]], ref_label: str, ref_path: Path,
                 gates: Sequence[Gate], runs: Sequence[Dict[str, Any]],
                 adjustment: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Compare this run's counts with the reference (PC-02: the count must not drop), each
    reference lowered by the approved deleted test cases (`adjustment`, DC-15)."""
    per_gate: Dict[str, Any] = {}
    not_compared: List[Dict[str, str]] = []
    failures: List[str] = []
    lowered_by = int(adjustment.get("cases_removed") or 0) if adjustment else 0
    for g in gates:
        if g.ratchet:
            not_compared.append({"gate": g.name,
                                 "reason": "ratchet gate: its violation count may only fall "
                                           "(--ratchet-from judges it)"})
            continue
        if g.name not in reference:
            not_compared.append({"gate": g.name,
                                 "reason": "gate absent from '{}'".format(ref_label)})
            continue
        recorded = reference[g.name]
        if recorded is None:
            not_compared.append({"gate": g.name,
                                 "reason": "no count recorded in '{}'".format(ref_label)})
            continue
        ref = max(0, recorded - lowered_by)
        current = [_as_count(r.get("count")) for run in runs for r in run["results"]
                   if r["name"] == g.name]
        entry: Dict[str, Any] = {"reference": ref, "current_runs": current}
        if lowered_by:
            entry["reference_recorded"] = recorded
        missing = [i + 1 for i, c in enumerate(current) if c is None]
        if g.count_regex is None:
            entry.update(status="missing", current=None)
            failures.append("{}: '{}' recorded {} but the gate has no count_regex now, so the "
                            "count cannot be compared".format(g.name, ref_label, ref))
        elif missing or not current:
            entry.update(status="missing", current=None)
            failures.append("{}: no count in run(s) {} (count_regex found no number; the output "
                            "format changed or the gate stopped before its summary); '{}' "
                            "recorded {}".format(g.name, ",".join(map(str, missing)) or "-",
                                                 ref_label, ref))
        else:
            low = min(c for c in current if c is not None)
            entry["current"] = low
            if low < ref:
                entry["status"] = "dropped"
                failures.append("{}: count dropped to {} from {} in '{}' (PC-02: the collected "
                                "test count must not drop)".format(g.name, low, ref, ref_label))
            else:
                entry["status"] = "ok"
        per_gate[g.name] = entry
    return {"reference_label": ref_label, "reference_file": C.to_posix(str(ref_path)),
            "passed": not failures, "gates": per_gate, "not_compared": not_compared,
            "failures": failures, "adjustment": adjustment}


# ---------------------------------------------------------------------------
# Ratchet comparison (PF-11)
# ---------------------------------------------------------------------------


class RatchetReferenceError(ValueError):
    """The --ratchet-from reference cannot be used."""


def ratchet_run_count(rec: Dict[str, Any]) -> Tuple[Optional[int], Optional[str]]:
    """(violation count, None) a ratchet comparison may use from one run record, or
    (None, why the count cannot be read)."""
    if rec.get("timed_out"):
        return None, "timed out"
    code = rec.get("exit_code")
    if code is None:
        return None, str(rec.get("error") or "the gate did not run")
    count = _as_count(rec.get("count"))
    if count is None:
        return None, str(rec.get("count_error") or "no count recorded")
    if count == 0 and code != 0:
        return None, ("exit code {} with a count of 0: the tool failed without reporting "
                      "violations".format(code))
    return count, None


def load_ratchet_reference(path: Path, ref_label: str, gates: Sequence[Gate],
                           asks_user: Optional[bool] = None) -> Dict[str, Dict[str, Any]]:
    """Gate name -> {"reference", "reference_runs"} for every selected ratchet gate.

    Raises RatchetReferenceError when the file is not a gates.py result, no selected gate is
    a ratchet gate, or a ratchet gate is absent from the reference, was defined differently
    there (gate_sha256), passed in every run there, or has no readable count there.
    `asks_user` (marker_asks_user) picks the advice for a changed gate."""
    ratchet_gates = [g for g in gates if g.ratchet]
    if not ratchet_gates:
        raise RatchetReferenceError("no selected gate has \"ratchet\": true (the ratchet gates "
                                    "live in .harden/ratchet.json: pass it with --config)")
    if not path.is_file():
        raise RatchetReferenceError("reference result not found: {}".format(
            C.to_posix(str(path))))
    try:
        data = C.read_json(path)
    except (OSError, ValueError) as exc:
        raise RatchetReferenceError("cannot read reference result {}: {}".format(
            C.to_posix(str(path)), exc)) from exc
    runs = data.get("runs") if isinstance(data, dict) else None
    described = data.get("gates") if isinstance(data, dict) else None
    if not isinstance(runs, list) or not isinstance(described, list):
        raise RatchetReferenceError("{} is not a gates.py result (no \"runs\" and \"gates\" "
                                    "lists)".format(C.to_posix(str(path))))
    ref_gates = {d["name"]: d for d in described
                 if isinstance(d, dict) and isinstance(d.get("name"), str)}
    out: Dict[str, Dict[str, Any]] = {}
    for g in ratchet_gates:
        recs = [r for run in runs if isinstance(run, dict)
                for r in (run.get("results") if isinstance(run.get("results"), list) else [])
                if isinstance(r, dict) and r.get("name") == g.name]
        if g.name not in ref_gates or not recs:
            raise RatchetReferenceError("ratchet gate '{}' is absent from '{}': probe it "
                                        "(gates.py --label {} --only {})".format(
                                            g.name, ref_label, ref_label, g.name))
        recorded = ref_gates[g.name].get("gate_sha256")
        current = g.identity_sha256()
        if recorded != current:
            raise RatchetReferenceError(
                "ratchet gate '{}' is not the gate '{}' ran ({}; now {}). Copy the gate "
                "unchanged from the config the reference ran (only \"ratchet\": true may be "
                "added). A changed gate needs approval: {}".format(
                    g.name, ref_label, "gate_sha256 " + recorded[:12]
                    if isinstance(recorded, str) and recorded
                    else "no gate_sha256 recorded (an older gates.py)", current[:12],
                    gate_change_advice(asks_user, "record '{}' again".format(ref_label))))
        if all(r.get("passed") for r in recs):
            raise RatchetReferenceError(
                "ratchet gate '{}' passed in every run of '{}': only a gate red there becomes a "
                "ratchet (PF-11); run it as an ordinary gate in .harden/config.json".format(
                    g.name, ref_label))
        counts = [ratchet_run_count(r) for r in recs]
        known = [c for c, _why in counts if c is not None]
        if not known:
            raise RatchetReferenceError(
                "ratchet gate '{}' has no readable violation count in '{}' ({}); correct its "
                "count_regex against the log under logs/{}/ and record '{}' again".format(
                    g.name, ref_label, "; ".join(sorted({why for _c, why in counts if why})),
                    ref_label, ref_label))
        out[g.name] = {"reference": min(known), "reference_runs": [c for c, _why in counts]}
    return out


def check_ratchet(reference: Dict[str, Dict[str, Any]], ref_label: str, ref_path: Path,
                  gates: Sequence[Gate], runs: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """Compare each ratchet gate's violation count with the reference (PF-11: no new
    violations): the highest count across this run's repeats must not exceed the reference,
    and every run must yield a readable count. Exit codes do not decide."""
    per_gate: Dict[str, Any] = {}
    failures: List[str] = []
    for g in gates:
        if g.name not in reference:
            continue
        ref = reference[g.name]["reference"]
        recs = [r for run in runs for r in run["results"] if r["name"] == g.name]
        counts = [ratchet_run_count(r) for r in recs]
        current_runs = [c for c, _why in counts]
        entry: Dict[str, Any] = {"reference": ref, "current": None, "passed": False,
                                 "reference_label": ref_label, "current_runs": current_runs,
                                 "reference_runs": reference[g.name]["reference_runs"],
                                 "exit_codes": [r.get("exit_code") for r in recs]}
        unreadable = ["run {}: {}".format(r["run"], why)
                      for r, (c, why) in zip(recs, counts) if c is None]
        if unreadable or not recs:
            entry["status"] = "unreadable"
            failures.append("{}: violation count cannot be read ({}); '{}' recorded {}".format(
                g.name, "; ".join(unreadable) or "no run", ref_label, ref))
        else:
            high = max(c for c in current_runs if c is not None)
            entry["current"] = high
            if high > ref:
                entry["status"] = "rose"
                failures.append("{}: violation count rose to {} from {} in '{}' (PF-11: no new "
                                "violations)".format(g.name, high, ref, ref_label))
            else:
                entry["status"] = "ok"
                entry["passed"] = True
        per_gate[g.name] = entry
    return {"reference_label": ref_label, "reference_file": C.to_posix(str(ref_path)),
            "passed": not failures, "gates": per_gate, "failures": failures}


def run_all(repo: Path, gates: Sequence[Gate], label: str, repeat: int,
            config_path: Path, is_repo: bool = True, out_dir: Optional[Path] = None,
            reference: Optional[Tuple[str, Path, Dict[str, Optional[int]]]] = None,
            gates_sha256: Optional[str] = None, adjustment: Optional[Dict[str, Any]] = None,
            config_env_policy: Any = None,
            ratchet_reference: Optional[Tuple[str, Path, Dict[str, Dict[str, Any]]]] = None
            ) -> Dict[str, Any]:
    """Run the gates `repeat` times and build the result document.

    `out_dir` (default <repo>/.harden/gates) receives the logs; `reference` is
    (label, path, counts) for the --min-count-from comparison and `adjustment` the approved
    deleted test cases that lower it; `gates_sha256` identifies the config's gates array;
    `ratchet_reference` is (label, path, load_ratchet_reference()) for --ratchet-from.
    """
    gates_dir = out_dir if out_dir is not None else C.harden_dir(repo) / "gates"
    log_dir = gates_dir / "logs" / label
    started = C.utc_iso()
    head = C.head_sha(repo) if is_repo and C.git_available() else None
    dirty = None
    if head is not None:
        status = C.git(repo, ["status", "--porcelain=v1", "--untracked-files=no"], check=False)
        dirty = bool(status.strip())
    tree_start = tree_state(repo) if is_repo and C.git_available() else None
    runs: List[Dict[str, Any]] = []
    for i in range(1, repeat + 1):
        results = []
        for g in gates:
            rec = run_gate(g, repo, log_dir, i)
            warnings = command_warnings(g)
            if warnings:
                rec["warnings"] = warnings
            results.append(rec)
        runs.append({"run": i, "results": results})
    ratchet_judged = sorted(ratchet_reference[2]) if ratchet_reference is not None else []
    summary, flaky, all_passed = summarise(gates, runs, ratchet_judged)
    notes: List[str] = []
    if flaky:
        notes.append("flaky gates changed outcome across identical runs; treat each as an "
                     "unresolved defect report, never add retries or skips (T13-F03)")
    if repeat < 2:
        notes.append("single run: flakiness was not measured (T13-F02 asks for several runs, "
                     "one in random order)")
    if not _inside(config_path, repo):
        notes.append("config read from outside --repo ({}); relative gate cwd values were "
                     "resolved against --repo".format(C.to_posix(str(config_path))))
    for g in gates:
        if Path(g.cwd).is_absolute() and not _inside(Path(g.cwd), repo):
            notes.append("gate '{}' has an absolute cwd outside --repo ({}): it did not run in "
                         "the selected checkout".format(g.name, g.cwd))
    notes += env_policy_notes(gates, config_env_policy)
    count_check = None
    if reference is not None:
        count_check = check_counts(reference[2], reference[0], reference[1], gates, runs,
                                   adjustment)
    ratchet_check = None
    if ratchet_reference is not None:
        ratchet_check = check_ratchet(ratchet_reference[2], ratchet_reference[0],
                                      ratchet_reference[1], gates, runs)
        for name, entry in ratchet_check["gates"].items():
            summary[name]["ratchet"] = entry
    tree_end = tree_state(repo) if tree_start is not None else None
    reusable = None
    if (tree_start is not None and all_passed and tree_start == tree_end
            and tree_start.get("index_tree") and tree_start.get("unstaged") is False
            and tree_start.get("untracked") == 0 and ratchet_reference is None):
        reusable = tree_start["index_tree"]
    return {
        "schema_version": C.SCHEMA_VERSION,
        "label": label, "repo": C.posix_abs(repo), "config": C.to_posix(str(config_path)),
        "out_dir": C.posix_abs(gates_dir),
        "started": started, "finished": C.utc_iso(), "repeat": repeat,
        "git_head": head, "worktree_dirty": dirty,
        "platform": {"os": os.name, "sys_platform": sys.platform,
                     "python": sys.version.split()[0]},
        "gates_sha256": gates_sha256,
        "config_env_policy": config_env_policy,
        "gates": [g.describe() for g in gates],
        "runs": runs, "summary": summary, "flaky": flaky, "all_passed": all_passed,
        "count_check": count_check,
        "ratchet_check": ratchet_check,
        "tree": None if tree_start is None else {"start": tree_start, "end": tree_end},
        "reusable_tree": reusable,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# Evidence reuse (pilot-auto-calibration A01-F40) and forbidden commands (U01-F03)
# ---------------------------------------------------------------------------


HEX_TREE_RE = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")


def _git_run(repo: Path, args: Sequence[str]) -> Tuple[Optional[int], bytes]:
    """(exit code, stdout) of a git command in `repo`; (None, b"") when git cannot start."""
    try:
        proc = subprocess.run(["git", "-c", "core.quotePath=false"] + list(args), cwd=str(repo),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env=C.git_env(), check=False)
    except OSError:
        return None, b""
    return proc.returncode, proc.stdout


def tree_state(repo: Path) -> Dict[str, Any]:
    """The checkout's index tree (`git write-tree`), whether a tracked change is unstaged
    (`git diff --quiet`) and how many untracked, non-ignored files lie outside .harden/; each
    is None when git cannot tell. Never raises."""
    state: Dict[str, Any] = {"index_tree": None, "unstaged": None, "untracked": None}
    code, out = _git_run(repo, ["write-tree"])
    tree = out.decode("utf-8", errors="replace").strip()
    if code == 0 and HEX_TREE_RE.match(tree):
        state["index_tree"] = tree
    code, _out = _git_run(repo, ["diff", "--quiet"])
    if code in (0, 1):
        state["unstaged"] = code == 1
    code, out = _git_run(repo, ["ls-files", "--others", "--exclude-standard", "-z"])
    if code == 0:
        names = [n for n in out.decode("utf-8", errors="replace").split("\0") if n]
        state["untracked"] = sum(1 for n in names if not C.to_posix(n).startswith(
            C.HARDEN_DIR_NAME + "/"))
    return state


def find_reusable_record(out_dir: Path, tree: str, gates_sha256: str,
                         gate_names: Sequence[str]) -> Optional[Dict[str, Any]]:
    """The first result in `out_dir` (by file name; logs/ never read) that is a green,
    reusable run of `tree` with the same gate configuration: same gates_sha256 and gate names,
    all_passed, no flaky gate, a count check that passed or was not made, no ratchet check,
    at least one run, and not itself a reuse."""
    try:
        paths = sorted(p for p in out_dir.glob("*.json") if p.is_file())
    except OSError:
        return None
    for path in paths:
        try:
            rec = C.read_json(path)
        except (OSError, ValueError):
            continue
        if not isinstance(rec, dict) or "reused_from" in rec:
            continue
        if rec.get("reusable_tree") != tree or rec.get("gates_sha256") != gates_sha256:
            continue
        if rec.get("all_passed") is not True or rec.get("flaky") != []:
            continue
        check = rec.get("count_check")
        if check is not None and not (isinstance(check, dict) and check.get("passed") is True):
            continue
        if rec.get("ratchet_check") is not None:
            continue
        if not isinstance(rec.get("runs"), list) or not rec["runs"]:
            continue
        names = sorted(str(g.get("name")) for g in rec.get("gates") or [] if isinstance(g, dict))
        if names != sorted(gate_names):
            continue
        return rec
    return None


def reuse_precondition(repo: Path, tree: str) -> Optional[str]:
    """Why the checkout is not `tree`'s clean tree, or None when it is."""
    now = tree_state(repo)
    if now["index_tree"] != tree:
        return "the working tree is not REV's tree (index tree {})".format(
            (now["index_tree"] or "unknown")[:12])
    if now["unstaged"] is not False:
        return "a tracked change is unstaged" if now["unstaged"] else \
            "git could not tell whether a tracked change is unstaged"
    if now["untracked"] != 0:
        return "{} untracked file(s) outside .harden/".format(now["untracked"]) \
            if now["untracked"] is not None else "git could not list untracked files"
    return None


def reuse_result(repo: Path, record: Dict[str, Any], label: str, config_path: Path,
                 gates_dir: Path, gates: Sequence[Gate], digest: str, tree: str,
                 config_env_policy: Any) -> Dict[str, Any]:
    """The result document of a reuse: no gate ran."""
    now = C.utc_iso()
    state = tree_state(repo)
    return {
        "schema_version": C.SCHEMA_VERSION,
        "label": label, "repo": C.posix_abs(repo), "config": C.to_posix(str(config_path)),
        "out_dir": C.posix_abs(gates_dir), "started": now, "finished": now, "repeat": 0,
        "git_head": C.head_sha(repo), "worktree_dirty": False,
        "platform": {"os": os.name, "sys_platform": sys.platform,
                     "python": sys.version.split()[0]},
        "gates_sha256": digest, "config_env_policy": config_env_policy,
        "gates": [g.describe() for g in gates],
        "runs": [], "summary": record.get("summary") or {}, "flaky": [], "all_passed": True,
        "count_check": None, "ratchet_check": None,
        "reused_from": record.get("label"), "reused_tree": tree,
        "tree": {"start": state, "end": state}, "reusable_tree": None,
        "notes": ["no gate ran: the green run '{}' ran every gate on this exact tree {} with "
                  "the same gate configuration (pilot-auto-calibration A01-F40)".format(
                      record.get("label"), tree[:12])],
    }


def marker_forbidden(marker_paths: Sequence[Path]) -> List["vp.ForbiddenPattern"]:
    """The usable forbidden_commands patterns of the first existing run marker: its own list
    and its profile's (hook_guard.py and verify_branch.py enforce the same patterns)."""
    for path in marker_paths:
        if not path.is_file():
            continue
        try:
            marker = C.read_json(path)
        except (OSError, ValueError):
            return []
        if not isinstance(marker, dict):
            return []
        raw = [p for p in marker.get("forbidden_commands") or [] if isinstance(p, str)]
        profile = marker.get("profile") if isinstance(marker.get("profile"), dict) else {}
        raw += [p for p in profile.get("forbidden_commands") or []
                if isinstance(p, str) and p not in raw]
        return vp.compile_patterns(raw)[0]
    return []


def env_policy_notes(gates: Sequence[Gate], config_env_policy: Any) -> List[str]:
    """Notes about the config's env_policy record (protocol-preflight PF-03; DT-06)."""
    notes: List[str] = []
    if config_env_policy in (None, "", "unconfirmed"):
        notes.append("env_policy in the config is {}: these gates ran project code before the "
                     "owner confirmed that it cannot reach live endpoints, keys or chains (the "
                     "profile's live_side_effects 'none' in autonomous mode, the user's answer "
                     "with --interactive; PF-03, PF-22, DT-06)".format(
                         "missing" if not config_env_policy else "'unconfirmed'"))
    elif config_env_policy == "allowlist":
        inheriting = [g.name for g in gates if g.inherit_env]
        if inheriting:
            notes.append("env_policy is 'allowlist' but gate(s) {} inherit the whole environment "
                         "(set inherit_env false and env_allowlist)".format(", ".join(inheriting)))
    return notes


def _inside(path: Path, root: Path) -> bool:
    """True when `path` is `root` or below it (both resolved)."""
    try:
        path.resolve().relative_to(root.resolve())
    except (ValueError, OSError):
        return False
    return True


def summary_text(result: Dict[str, Any]) -> str:
    """Human summary."""
    lines = ["gates '{}' x{} at {}".format(result["label"], result["repeat"],
                                          (result.get("git_head") or "-")[:12])]
    for name, s in result["summary"].items():
        ratchet = s.get("ratchet")
        if ratchet is not None:
            lines.append("  {:<6} {:<20} ratchet: {} violation(s), {} in '{}'  exit codes {}  "
                         "timeouts {}  median {}s".format(
                             "PASS" if ratchet["passed"] else "FAIL", name,
                             "unreadable" if ratchet["current"] is None else ratchet["current"],
                             "reference {}".format(ratchet["reference"]),
                             ratchet["reference_label"], s["exit_codes"], s["timed_out"],
                             s["median_duration_s"]))
            continue
        state = "PASS" if s["failed"] == 0 else ("FLAKY" if s["flaky"] else "FAIL")
        count = ""
        if s.get("count_min") is not None:
            count = "  count {}".format(s["count_min"] if s["count_min"] == s["count_max"]
                                        else "{}-{}".format(s["count_min"], s["count_max"]))
        lines.append("  {:<6} {:<20} passed {}/{}  timeouts {}  median {}s{}".format(
            state, name, s["passed"], s["runs"], s["timed_out"], s["median_duration_s"], count))
    for run in result["runs"]:
        for r in run["results"]:
            for w in r.get("warnings", []) if run["run"] == 1 else []:
                lines.append("  warning [{}]: {}".format(r["name"], w))
            if not r["passed"] and r.get("error"):
                lines.append("  error [{} run {}]: {}".format(r["name"], run["run"], r["error"]))
            if r.get("count_error"):
                lines.append("  count [{} run {}]: {}".format(r["name"], run["run"],
                                                             r["count_error"]))
    for note in result.get("notes", []):
        if "--repo" in note or "env_policy" in note:
            lines.append("  note: {}".format(note))
    check = result.get("count_check")
    if check is not None and (check.get("adjustment") or {}).get("cases_removed"):
        adj = check["adjustment"]
        lines.append("  count reference lowered by {} approved test-case deletion(s) "
                     "(run_state.py allow-test-deletion --cases, {}: {})".format(
                         adj["cases_removed"], adj["source"],
                         ", ".join("{} {}".format(p, n) for p, n in adj["records"].items())))
    if check is not None:
        for failure in check["failures"]:
            lines.append("  COUNT FAIL {}".format(failure))
        for item in check["not_compared"]:
            lines.append("  count not compared [{}]: {}".format(item["gate"], item["reason"]))
        lines.append("count check against '{}': {}".format(
            check["reference_label"], "passed" if check["passed"] else "FAILED"))
    ratchet_check = result.get("ratchet_check")
    if ratchet_check is not None:
        for failure in ratchet_check["failures"]:
            lines.append("  RATCHET FAIL {}".format(failure))
        lines.append("ratchet check against '{}': {}".format(
            ratchet_check["reference_label"], "passed" if ratchet_check["passed"] else "FAILED"))
    lines.append("all passed: {}{}".format(
        result["all_passed"], " (ratchet gates excluded: judged by their count)"
        if ratchet_check is not None else ""))
    if check is not None and not check["passed"]:
        lines.append("result: FAIL (the gates ran, but a test count dropped or is missing)")
    if ratchet_check is not None and not ratchet_check["passed"]:
        lines.append("result: FAIL (a ratchet gate's violation count rose or cannot be read)")
    return "\n".join(lines)


CONFIG_HELP = """config keys (.harden/config.json; the module docstring has the details):
  gates[]          name, cmd (string: platform shell; list: argv), timeout_s, cwd, shell
                   ("bash"), env, pipefail, count_regex (one capture group), count_mode
                   (sum | last | max | matches), ratchet (true: a no-new-violations gate that
                   --ratchet-from judges by its count; needs count_regex)
  inherit_env     true (default): gates get the whole parent environment; false: only the
                   env_allowlist variables plus the gate's own env (top level or per gate)
  env_allowlist    variable names passed when inherit_env is false (Windows: SYSTEMROOT, PATH,
                   PATHEXT, TEMP, TMP, USERPROFILE, APPDATA, LOCALAPPDATA at least)
  env_policy       the owner's live side-effect answer (the profile's in autonomous mode, the
                   user's with --interactive): inherit | allowlist | unconfirmed
  install          not read here: verify_branch.py's install step (assets/config.example.json)
results record gates_sha256 (hash of the gates array; --min-count-from refuses another one),
each gate's gate_sha256 (--ratchet-from refuses a ratchet gate defined differently in the
reference), env_policy and env_names (never values), count_check.adjustment (test cases
approved for deletion with run_state.py allow-test-deletion --cases) and, with --ratchet-from,
summary.<gate>.ratchet = {reference, current, passed} and ratchet_check."""


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI entry point."""
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        description="Run /harden gates and record the outcome.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=CONFIG_HELP)
    parser.add_argument("--label", required=True, help="run label, e.g. baseline")
    parser.add_argument("--repeat", type=int, default=1, help="number of runs (default 1)")
    parser.add_argument("--only", default=None, help="comma-separated gate names")
    parser.add_argument("--config", default=None, help="config path")
    parser.add_argument("--repo", default=".",
                        help="checkout the gates run in (default: .; resolved to its git root)")
    parser.add_argument("--out-dir", default=None,
                        help="directory for <label>.json and logs (default: <repo>/.harden/gates)")
    parser.add_argument("--min-count-from", default=None, metavar="LABEL",
                        help="fail when a gate's count is below the one in <out-dir>/LABEL.json")
    parser.add_argument("--ratchet-from", default=None, metavar="LABEL",
                        help="judge \"ratchet\": true gates by their violation count against "
                             "<out-dir>/LABEL.json (the probe) instead of their exit code")
    parser.add_argument("--reuse-if-tree", default=None, metavar="REV",
                        help="with REV checked out, reuse the green run of REV's exact tree "
                             "instead of running (pilot-auto-calibration A01-F40)")
    parser.add_argument("--json", action="store_true", help="print the JSON result")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code not in (0, None) else 0
    if args.reuse_if_tree is not None:
        for flag, used in (("--min-count-from", args.min_count_from is not None),
                           ("--ratchet-from", args.ratchet_from is not None),
                           ("--only", args.only is not None), ("--repeat", args.repeat != 1)):
            if used:
                C.eprint("error: --reuse-if-tree cannot be combined with {}".format(flag))
                return 2
    if not LABEL_RE.match(args.label):
        C.eprint("error: --label must match [A-Za-z0-9._-]+")
        return 2
    for flag, value in (("--min-count-from", args.min_count_from),
                        ("--ratchet-from", args.ratchet_from)):
        if value is not None and not LABEL_RE.match(value):
            C.eprint("error: {} must be a label matching [A-Za-z0-9._-]+".format(flag))
            return 2
    if args.repeat < 1:
        C.eprint("error: --repeat must be >= 1")
        return 2
    try:
        info = C.resolve_repo(Path(args.repo))
    except (FileNotFoundError, NotADirectoryError) as exc:
        C.eprint("error: not a directory: {}".format(exc))
        return 2
    repo = info.root
    config_path = Path(args.config) if args.config else C.harden_dir(repo) / "config.json"
    if not config_path.is_absolute():
        config_path = (Path.cwd() / config_path).resolve()
    out_dir: Optional[Path] = None
    if args.out_dir:
        out_dir = Path(args.out_dir)
        if not out_dir.is_absolute():
            out_dir = (Path.cwd() / out_dir).resolve()
        if out_dir.exists() and not out_dir.is_dir():
            C.eprint("error: --out-dir is not a directory: {}".format(C.to_posix(str(out_dir))))
            return 2
    gates_dir = out_dir if out_dir is not None else C.harden_dir(repo) / "gates"
    try:
        config_data = read_config(config_path, repo)
        gates = parse_gates(config_data, repo)
    except ConfigError as exc:
        C.eprint("config error: {}".format(exc))
        return 2
    digest = gates_digest(config_data.get("gates"))
    config_env_policy = config_data.get("env_policy")
    if args.only:
        wanted = [n.strip() for n in args.only.split(",") if n.strip()]
        unknown = [n for n in wanted if n not in {g.name for g in gates}]
        if unknown or not wanted:
            C.eprint("config error: unknown gate name(s) for --only: {}".format(
                ", ".join(unknown) or "(none given)"))
            return 2
        gates = [g for g in gates if g.name in wanted]
    reference = None
    adjustment = None
    # The run marker of the working tree: <repo>/.harden/active, or next to --out-dir for a
    # fresh-clone replay (the clone has no .harden/).
    marker_paths = [C.harden_dir(repo) / "active", gates_dir.parent / "active"]
    patterns = marker_forbidden(marker_paths)
    for g in gates:
        hit = vp.forbidden_match(vp.command_text(g.cmd), patterns)
        if hit is not None:
            C.eprint("error: gate '{}' is forbidden by the run profile (forbidden_commands "
                     "pattern {!r}); no gate ran (user-policy-autonomy U01-F03)".format(
                         g.name, hit.raw))
            return 2
    reuse_tree: Optional[str] = None
    reuse_note: Optional[str] = None
    if args.reuse_if_tree is not None:
        reuse_tree = C.git_ok(repo, ["rev-parse", "--verify", "--quiet",
                                     args.reuse_if_tree + "^{tree}"]) if info.is_repo else None
        if not reuse_tree:
            C.eprint("error: --reuse-if-tree: {!r} names no commit or tree in {}".format(
                args.reuse_if_tree, C.to_posix(str(repo))))
            return 2
        why = reuse_precondition(repo, reuse_tree)
        record = None if why else find_reusable_record(gates_dir, reuse_tree, digest,
                                                       [g.name for g in gates])
        if record is not None:
            if out_dir is None:
                C.ensure_harden_dir(repo, info.is_repo)
            else:
                out_dir.mkdir(parents=True, exist_ok=True)
            result = reuse_result(repo, record, args.label, config_path, gates_dir, gates,
                                  digest, reuse_tree, config_env_policy)
            C.write_json(gates_dir / "{}.json".format(args.label), result)
            if args.json:
                print(json.dumps(result, indent=2, ensure_ascii=False))
            else:
                print("reused {} for {} (tree {})".format(record.get("label"),
                                                          args.reuse_if_tree, reuse_tree[:12]))
            return 0
        reuse_note = "no reuse: {}; every gate ran".format(
            why or "no green run of this exact tree with this gate configuration")
    if args.min_count_from is not None:
        ref_path = gates_dir / "{}.json".format(args.min_count_from)
        try:
            ref_counts = load_reference_counts(ref_path)
        except CountReferenceError as exc:
            C.eprint("error: --min-count-from: {}".format(exc))
            return 2
        ref_digest = reference_gates_sha256(ref_path)
        if ref_digest != digest:
            C.eprint("error: --min-count-from: '{}' was recorded with {} (gates_sha256 {}), the "
                     "current config's gates array has gates_sha256 {}. Counts from another "
                     "gate configuration are not comparable, and a changed test gate voids the "
                     "baseline. Restore the gates of '{}'. A new gate set needs approval: {}."
                     .format(args.min_count_from,
                             "another gate configuration" if ref_digest else
                             "no gates_sha256 (an older gates.py)",
                             (ref_digest or "-")[:12], digest[:12], args.min_count_from,
                             gate_change_advice(
                                 marker_asks_user(marker_paths),
                                 "record the reference again (gates.py --label {} --repeat 3)"
                                 .format(args.min_count_from))))
            return 2
        if not any(ref_counts.get(g.name) is not None for g in gates if not g.ratchet):
            C.eprint("error: --min-count-from: no selected gate has a count recorded in {} (give "
                     "the test gate a count_regex and record '{}' again; ratchet gates are "
                     "not compared)".format(C.to_posix(str(ref_path)), args.min_count_from))
            return 2
        reference = (args.min_count_from, ref_path, ref_counts)
        adjustment = approved_case_deletions(marker_paths)
    ratchet_reference = None
    if args.ratchet_from is not None:
        ratchet_path = gates_dir / "{}.json".format(args.ratchet_from)
        try:
            ratchet_counts = load_ratchet_reference(ratchet_path, args.ratchet_from, gates,
                                                    marker_asks_user(marker_paths))
        except RatchetReferenceError as exc:
            C.eprint("error: --ratchet-from: {}".format(exc))
            return 2
        ratchet_reference = (args.ratchet_from, ratchet_path, ratchet_counts)
    if out_dir is None:
        C.ensure_harden_dir(repo, info.is_repo)
    else:
        out_dir.mkdir(parents=True, exist_ok=True)
    result = run_all(repo, gates, args.label, args.repeat, config_path, info.is_repo,
                     out_dir=gates_dir, reference=reference, gates_sha256=digest,
                     adjustment=adjustment, config_env_policy=config_env_policy,
                     ratchet_reference=ratchet_reference)
    if reuse_note is not None:
        result["notes"].append(reuse_note)
    out = gates_dir / "{}.json".format(args.label)
    C.write_json(out, result)
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(summary_text(result))
        print("written: {}".format(C.to_posix(str(out))))
    check = result.get("count_check")
    if check is not None and not check["passed"]:
        for failure in check["failures"]:
            C.eprint("count check failed: {}".format(failure))
    ratchet_check = result.get("ratchet_check")
    if ratchet_check is not None and not ratchet_check["passed"]:
        for failure in ratchet_check["failures"]:
            C.eprint("ratchet check failed: {}".format(failure))
    counts_ok = check is None or check["passed"]
    ratchet_ok = ratchet_check is None or ratchet_check["passed"]
    return 0 if result["all_passed"] and counts_ok and ratchet_ok else 1


if __name__ == "__main__":
    sys.exit(main())
