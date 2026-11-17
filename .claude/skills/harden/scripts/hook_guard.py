#!/usr/bin/env python3
"""hook_guard.py - Claude Code hook entry point for /harden (PreToolUse and Stop).

Purpose
    A first layer against the few /harden mistakes that cost the most (editing existing tests
    or gate configs, destructive or history-rewriting shell commands, package installs that
    land outside the repository and its scratch clones), checked deterministically while a
    run is active (dossiers: skill-design T31-F08, T31-F21; llm-refactoring T10-F06, T10-F18;
    hardening-induced-regressions G205-F15, G205-F16, G205-F17, G205-F18; refactoring-safety
    T09-F05; eval-v1-calibration E01-F10; eval-v2-calibration E02-F08). Skill hooks stay
    registered for the rest of the session, so this hook is a no-op unless a run marker
    exists.

    It is NOT a security boundary. It sees only the tool call in front of it, reads shell
    commands with a best-effort tokenizer rather than a parser, and the agent it watches can
    still defeat it (delete `.harden/active`, write files from another interpreter, run a
    script, set up a git alias in a file it edits). Regex deny lists can be bypassed (T10-F18);
    isolation and least privilege are the primary controls (G205-F16). What stands behind it:
    git, diff_guard.py at every commit and at Stop, and the user reading the run-control
    events and the diff.

Behaviour
    * Reads the hook JSON from stdin. Run root: the first directory holding `.harden/active`
      found by walking up from, in order, the tool target's directory (file_path /
      notebook_path of a file tool), the input "cwd", then $CLAUDE_PROJECT_DIR. Each walk stops
      at the first directory holding `.git`, so a run in a repository nested inside the
      session's repository is found through the target or the cwd. No marker: exit 0 at once,
      no output, nothing written (except the Stop reminder below).
    * .harden/config.json that does not parse or holds a wrongly typed field (ConfigError) is
      logged to .harden/hook_errors.log and ignored: the marker's globs and diff_guard's
      defaults apply, so a bad config never disables the guard.
    * permission_mode and the transcript_path of the hook input are recorded in
      `.harden/session.json` on first sight (budget.py and ledger.py ingest read the session
      and subagent transcripts from it; pilot-auto-calibration A01-F30, A01-F34). When it is
      "bypassPermissions", one PreToolUse per run gets hookSpecificOutput.additionalContext
      warning that bypass mode is on and that native Windows has no Claude Code sandbox.
    * PreToolUse Edit / Write / MultiEdit / NotebookEdit: exit 2 when the target exists,
      matches the test, snapshot or protected globs of .harden/active (defaults from
      diff_guard.py) and already existed at base_sha, or when the target is `.harden/active`,
      except for an existing test source file that only gains lines (protocol-change PC-06;
      user-policy-autonomy U01-F07): an Edit, Write or MultiEdit of it is reproduced on the
      file's current content and allowed when strengthen.py accepts the result against the
      file's HEAD version, with every line of its base version still present. A test file
      that also matches a protected glob that is not itself a test glob (tests/tsconfig.json,
      tests/vitest.config.ts) stays read-only as a gate or test-runner configuration
      (pilot-auto-calibration A01-F53). A refusal keeps reason_code edit-test and names the
      problem as "[test-edit: <code>]". NotebookEdit of an
      existing test, and every shell write onto one, stay refused. The check fails closed: an
      error or its 8-second budget running out refuses the edit. Creating a NEW file is
      allowed, and so is editing or deleting a file this run created (the same rule as
      diff_guard.py), so new test files can be written and corrected. A test or snapshot file
      matched by "allow_test_deletions" and a protected file matched by "allow_config_edits"
      (run_state.py allow-test-deletion / allow-config-edit) may be edited with these tools;
      diff_guard.py checks that the first change is deletion-only and that the second loosens
      no gate.
    * Commands the run profile forbids (user-policy-autonomy U01-F03): PreToolUse Bash /
      PowerShell exit 2 (reason_code profile-forbidden) for every command that matches an
      entry of "forbidden_commands" in .harden/active, which run_state.py start copies from
      .harden/profile.json: a plain string as a case-insensitive substring of the command
      (whitespace runs folded to one space, also tried with quote characters removed), a
      "/regex/" or "/regex/i" as a regular expression searched in the same forms
      (validate_profile.py holds the matcher). In an orchestrator Bash command, a
      here-document with a quoted delimiter that cat or tee writes to a file under .harden/,
      and single-quoted or plain double-quoted echo/printf arguments written there, are data
      and are left out of the match when the rest of the command is only cd, read-only git or
      git add, and the skill's bookkeeping scripts, with no $, backtick, subshell, group, pipe
      or assignment (pilot-auto-calibration A01-F54). Everything else, a subagent's commands
      included, is matched whole, and an error in that analysis matches the whole command.
      It applies in every mode, before any other shell check except the canary, and the
      message names the pattern. An entry that does not compile is skipped (run_state.py only
      copies usable ones); a single string instead of a list counts as one pattern (stricter,
      never looser).
    * The run profile is the owner's consent (U01-F04): Edit / Write / MultiEdit /
      NotebookEdit of `.harden/profile.json`, and shell writes, copies, moves and deletions
      onto it, exit 2 (profile-write) while the run is active. verify_branch.py also refuses a
      profile whose sha256 differs from "profile_sha256" in .harden/active.
    * Report-only runs (mode "report-only" in .harden/active: red baseline, failed canary,
      --report-only; SKILL.md invariants 8-9): Edit / Write / MultiEdit / NotebookEdit of any
      file of the run root outside `.harden/`, and the git subcommands that record or apply
      changes (commit, add, apply, am, cherry-pick, revert, merge; their --abort and dry-run
      forms stay allowed), exit 2 with report-only-edit.
    * PreToolUse Bash / PowerShell: exit 2 for destructive or history-rewriting commands
      (force push, reset --hard, every git clean except -n/--dry-run, worktree-wide
      checkout/restore, rebase, filter-branch/filter-repo, branch -D, stash drop/clear,
      --no-verify, git aliases and clean.requireForce set through git -c, git config or
      GIT_CONFIG_* variables, rm -rf, Remove-Item -Recurse, rmdir /s, del /s, find -delete,
      snapshot-update commands, git worktree remove, link creation (mklink, junctions,
      New-Item -ItemType Junction/SymbolicLink/HardLink, ln, cp -s/-l, fsutil hardlink; a
      link in a scratch copy lets tests write into the repository, and a recursive delete
      that follows one destroys its target, pilot-auto-calibration A01-F56), ...) and for
      in-place edits, redirections, copies, moves and
      deletions that hit an existing test/snapshot/protected file. Deleting `.harden/active`
      is not refused (run_state.py stop removes it), but it is logged as a run-control event.
      Relative targets of these writes and deletions resolve in the directory a literal cd /
      pushd / Set-Location earlier in the same command line moved to, when every operator
      since that cd is &&; after a cd joined by ; or || (or followed later by one) they are
      checked in every directory the shell may be in, the session's included, and any hit
      refuses (pilot-auto-calibration A01-F31: `cd tests && rm test_app.py` and `cd nowhere;
      echo x > tests/test_app.py` are refused; `cd "<scratch_dir>/wt" && sed -i ...
      tests/test_app.py` edits the worktree and is allowed).
    * Here-documents are read as Bash reads them (outside quotes, comments and arithmetic,
      with a delimiter word read whole); a body is data for its command, except that a body a
      shell or interpreter reads (bash -s, `bash <<EOF`, `cat <<EOF | sh`, `source /dev/stdin`,
      `python - <<EOF`, also behind a wrapper and its options such as `timeout 5 bash`, and
      a here-string such as `bash <<<'...'`) is checked like a command line (a shell's) or
      for inline deletes and links (an interpreter's), and the $(...) and backtick spans of
      an unquoted body are checked as commands wherever it goes (pilot-auto-calibration
      A01-F54). Known gap: a `<<` that Bash reads inside `${...}`, `$[...]`, a `$'...'`
      string with an escaped quote, a nested quote inside "$(...)" or backticks is taken for
      a here-document, so the lines after it are not analysed (the forbidden_commands match
      still sees them).
    * Package installs stay inside the run (eval-v1-calibration E01-F10: an `npm install` run
      from the wrong directory wrote ~/package.json, ~/package-lock.json and ~/node_modules).
      PreToolUse Bash / PowerShell: exit 2 (pkg-outside-repo) for a command that adds,
      removes or updates packages (npm/pnpm/yarn/bun install|i|add|remove|uninstall|update,
      npm ci, bare `yarn`, pip install|uninstall (also `python -m pip`), uv add|remove, uv pip
      install|uninstall|sync, cargo add|remove|install|uninstall, poetry add|remove) that
      works outside the run root and outside the clones and worktrees of the run's repository
      under the run's scratch directory ("scratch_dir" in .harden/active, which run_state.py
      start creates outside the repository; D-S, eval-v2-calibration E02-F08). Those are
      PF-10's fresh clone (its origin URL is the run root) and the final clone, where
      protocol-preflight installs the locked dependencies (PF-21), and the differential and
      mutation worktrees; `git clone` and `git worktree add` into scratch_dir are not refused.
      With a scratch_dir recorded, a clone or worktree of the run's repository anywhere else
      is out of scope: in a sibling or other unrelated directory (the E02-F08 run put its
      scratch clones and a mutation-tool install in a sibling directory) or nested inside the
      repository (test runners and detectors read it, and Node resolves the repository's
      node_modules from it). scratch_dir itself is no install location (tool installs go
      under .harden/tools). A marker without scratch_dir (a run started before it existed)
      accepts any clone or worktree of the run's repository. The command is refused when:
      - it runs outside: the input "cwd", followed through cd / chdir / pushd /
        popd / Set-Location / Push-Location / Pop-Location / `env -C` earlier in the same
        command line (a bash or cmd `( ... )` group restores it; a directory the hook cannot
        resolve, such as a variable or a command substitution, counts as outside);
      - a directory or target option points outside (npm --prefix/-C, pnpm --dir/-C,
        yarn/bun --cwd, uv --directory/--project/--target/--prefix, poetry -C/--directory/-P/
        --project, cargo -C/--manifest-path, pip --target/-t/--prefix/--root/--src, ...);
      - the nearest manifest the tool would edit lies outside (package.json, and
        node_modules for npm, for the JS managers; pyproject.toml for uv add/remove and poetry;
        Cargo.toml for cargo add/remove; .venv for uv pip), found with a few stat calls up the
        directory tree: npm, for one, walks up to the first directory holding package.json or
        node_modules, so an install in a repository without one edits the home directory's;
      - or it is a global form: -g (also in a short-option bundle of the JS managers),
        --global, --user, --system, --break-system-packages, --global-dir/--global-folder,
        npm --location global, yarn global, poetry self, uv tool install|uninstall|upgrade,
        pipx install/inject/uninstall/upgrade/reinstall, and cargo install/uninstall unless
        --root (or a CARGO_INSTALL_ROOT= prefix) is under <run root>/.harden/tools.
      Ephemeral runners (npx, pnpm dlx, pnpx, bunx, uvx, pipx run, npm exec, yarn dlx, bun x,
      uv run, uv tool run, poetry run) are always allowed; a package manager they launch
      (`npx pnpm add ...`) is checked like any other. Package-manager words in the arguments
      of echo, which, grep and similar commands are ignored.
    * Temporary files stay inside the run (protocol-preflight PF-21; eval-v3-calibration
      E03-F06): with a scratch_dir recorded, a redirection, tee, cp or other shell write, or a
      file-tool write, whose target lies under the OS temp directory (tempfile's, TMPDIR, TEMP,
      TMP; /tmp and /var/tmp; Git Bash's /tmp on Windows) but outside the scratch_dir and the
      repository is refused (temp-outside-run). A word naming $TMPDIR, $TMP or $TEMP is not
      judged when the command sources .harden/tool-env.sh, which points them into the
      scratch_dir. Writes a program makes by itself are not seen.
    * History rewriting (protocol-change PC-20; undo is a new commit): `git commit --amend`;
      `git reset` with any revision other than HEAD / @ (also with --soft, --mixed, --keep or
      --merge, and with paths after it). Still allowed: plain `git reset`, `git reset --
      <paths>`, `git reset HEAD [--] <paths>` and `git reset <paths>` when every argument is
      an existing path, a glob or a pathspec (`:(...)`). Also `git tag -d/--delete` and
      `git tag -f` (replaces a tag), `git update-ref -d`, `git update-ref --stdin` and
      `git update-ref <ref> <value>` (moves a ref), and `git branch -d/--delete` of the run
      branch or the base branch ("branch" and optional "base_branch" in .harden/active, local
      branches pointing at base_sha, origin's default branch). `git branch -D` stays denied
      for every branch.
    * Canary (protocol-preflight PF-05, harmless by design): while the marker exists, any
      Bash/PowerShell command containing HARDEN_HOOK_CANARY is refused (reason_code
      canary-bash) and so is any Edit/Write/MultiEdit/NotebookEdit of <project>/.harden/
      canary.txt (canary-edit); both messages say the hooks are active and nothing ran.
      `.harden/hook_events.log`, `.harden/session.json`, `.harden/gates/**`,
      `.harden/verify.json` and `.harden/verify/**` (verify_branch.py's record and logs),
      `.harden/budget.json` (budget.py's deadline and windows), the pass records under
      `.harden/passes/` (reports, their meta, reads, results, gaps and captures under raw/) and
      `.harden/verifiers/**` (subagent reports saved by the harden agents' own Stop hook and by
      persist_pass.py; pilot-auto-calibration A01-F30, A01-F34, A01-F42) are not writable by the agent's file tools or shell writes (event-log-write,
      run-evidence-write). Each denial records the session_id and transcript_path of the hook
      input, and canary-check requires both (and an existing transcript file). This raises the
      cost of forging canary evidence; it does not make it impossible: a process that pipes
      synthetic hook JSON into this script with a real transcript path still writes denials.
    * Every denial (exit 2, PreToolUse and Stop) appends one JSON line to
      `.harden/hook_events.log`: {"ts", "event", "tool", "reason_code", "path_or_cmd",
      "session_id", "transcript_path"}. path_or_cmd is the target path or the command, with
      obvious credentials redacted (key=value / --flag value pairs named like token, secret,
      password, api key, auth; URL user:password@; Bearer tokens; common token prefixes) and
      cut to 200 characters. File contents and edit payloads are never logged. The
      reason_code is also appended to the message shown to Claude.
    * Run-control commands are allowed but logged as {"type": "run-control", "decision":
      "allow", "actions": [...], ...} lines: removing `.harden/active` (rm, del,
      Remove-Item, mv, rm -r .harden), `run_state.py stop --force`, `run_state.py set-mode`
      and `run_state.py allow-*`. `run_state.py status` lists them for the report. From a
      subagent (a hook payload with agent_id: the harden-verifier's own guard), these and
      `run_state.py start` or `stop` are refused (subagent-run-control; A01-F45).
    * Stop / SubagentStop: exit 0 when stop_hook_active is true (never loop). Otherwise run
      diff_guard's quick checks against base_sha; hard violations -> exit 2 with a short list
      and the instruction to revert them or escalate them (stop-hard-violations).
    * Messages follow the run's mode ("mode" in .harden/active, and "mode_requested" for a
      report-only run): with --interactive ("interactive" or its older name "apply") they
      send a question to the user; in autonomous mode, which asks nobody and never waits
      (user-policy-autonomy U01-F01), they send it to .harden/progress.md and the report as
      an owner item, and never offer `git stash` (protocol-preflight PF-01: stash only with
      the user's consent); a marker without a mode gets both routes, each labelled. Reason
      codes do not depend on the mode.
      Without a marker, a Stop event that finds `.harden/session.json` of a run that
      `run_state.py stop` never closed prints one systemMessage reminder (once per run): the
      marker disappeared without a stop.
    * Any internal exception: one line appended to `.harden/hook_errors.log`, exit 0 (fail
      open; Claude Code treats other exit codes as non-blocking anyway).

Reason codes (stable; REASON_CODES below is the registry)
    canary-bash, canary-edit, marker-write, event-log-write, run-evidence-write,
    profile-forbidden, profile-write, subagent-run-control, report-only-edit,
    edit-test, edit-snapshot, edit-protected (file tools on existing read-only files),
    write-test, write-snapshot, write-protected (sed -i, perl -i, tee, redirections, cp,
    Set-Content, ... onto them), delete-test, delete-snapshot, delete-protected (rm, del,
    git rm, mv, Remove-Item, ...), git-push-force, git-push-delete, git-reset-hard,
    git-reset-moves-branch, git-commit-amend, git-clean-force, git-clean, git-alias,
    git-clean-requireforce, git-checkout-force,
    git-checkout-reset-branch, git-checkout-worktree, git-switch-discard,
    git-switch-reset-branch, git-restore-worktree, git-rebase, git-pull-rebase,
    git-filter-history, git-branch-force-delete, git-branch-delete-protected,
    git-branch-force, git-branch-overwrite, git-stash-drop, git-reflog-destroy,
    git-hookspath, git-no-verify, git-tag-delete, git-tag-force, git-update-ref-delete,
    git-update-ref-stdin, git-update-ref-move, rm-recursive-force, remove-item-recurse,
    rmdir-recursive, del-recursive, find-delete, rimraf, inline-delete,
    recursive-listing-delete, sql-destructive, snapshot-update, terraform-apply,
    kubectl-delete, link-create, git-worktree-remove, pkg-outside-repo, temp-outside-run,
    stop-hard-violations.

CLI
    <hook JSON on stdin> | python hook_guard.py      (python3 on macOS/Linux)

Exit codes
    0  allow / no objection (also after an internal error: fail open)
    2  block; stderr carries the reason shown to Claude

Python 3.9+ standard library only (runs under `python -S` too); no network. The PreToolUse
path starts no subprocess except one `git ls-tree` when a target already matched a read-only
glob (to tell files that existed at base_sha from files the run created), plus one `git
cat-file --batch` for an Edit, Write or MultiEdit of an existing test file, and two cheap ref
lookups when a command deletes a branch with `git branch -d`; a package-install command adds
only a few stat calls up the directory tree, plus one small git file read and a few
realpath calls for a repository it finds nested in the run root or outside it.
"""

from __future__ import annotations

import base64
import glob as globmod
import json
import os
import re
import sys
import tempfile
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import (Any, Callable, Dict, FrozenSet, List, Mapping, Optional, Sequence, TextIO,
                    Tuple)

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import diff_guard as dg  # noqa: E402  (sibling module, path set above)
import validate_profile as vp  # noqa: E402

try:  # the additions-only rule (protocol-change PC-06; user-policy-autonomy U01-F07)
    import strengthen as st  # noqa: E402
    ST_ERROR: Optional[str] = None
except Exception as _exc:  # noqa: BLE001 - existing-test edits are then refused
    st = None  # type: ignore[assignment]
    ST_ERROR = f"{type(_exc).__name__}: {_exc}"
# the hook's timeout in SKILL.md is 15 s; a timed-out hook does not block the call
HOOK_CHECK_BUDGET_S = 8.0

IS_WINDOWS = os.name == "nt"
MARKER_REL = ".harden/active"
PROFILE_REL = ".harden/profile.json"
VERIFY_REL = ".harden/verify.json"
VERIFY_DIR_REL = ".harden/verify"
CANARY_REL = ".harden/canary.txt"
CANARY_TOKEN = "HARDEN_HOOK_CANARY"
EVENT_LOG_NAME = "hook_events.log"
EVENT_LOG_REL = ".harden/" + EVENT_LOG_NAME
MAX_LOGGED_CHARS = 200
SESSION_NAME = "session.json"
SESSION_REL = ".harden/" + SESSION_NAME
GATES_REL = ".harden/gates"
BUDGET_REL = ".harden/budget.json"
RAW_PASSES_REL = ".harden/passes/raw"
PASSES_REL = ".harden/passes"
VERIFIERS_REL = ".harden/verifiers"
# The pass records under .harden/passes/ (persist_pass.py, ledger.py ingest and gaps --out).
PASS_RECORD_SUFFIXES = (".md", ".meta.json", ".reads.json", ".result.json", ".gaps.json",
                        ".files.json", "persist.log")
ERROR_LOG_NAME = "hook_errors.log"
HARDEN_REL = ".harden"
TOOLS_REL = ".harden/tools"
# git subcommands that record or apply changes: refused in report-only runs.
REPORT_ONLY_GIT = {"commit", "add", "apply", "am", "cherry-pick", "revert", "merge"}
# run_state.py subcommands that change or end the run: logged as run-control events.
RUN_CONTROL_RE = re.compile(r"(?i)run_state\.py[\"']?\s+(set-mode|allow-test-deletion|"
                            r"allow-config-edit|allow-line|stop)\b([^\n;&|]*)")
# run_state.py subcommands that start, end or loosen a run: refused from a subagent, whose hook
# payload carries agent_id (the harden-verifier's own guard; pilot-auto-calibration A01-F45).
SUBAGENT_RUN_STATE_RE = re.compile(r"(?i)run_state\.py[\"']?\s+(start|stop|set-mode|"
                                   r"allow-test-deletion|allow-config-edit|allow-line|"
                                   r"scratch-remove)\b")
# git configuration passed through the environment (GIT_CONFIG_COUNT/KEY_n, GIT_CONFIG_PARAMETERS).
ENV_GIT_CONFIG_RE = re.compile(r"(?i)GIT_CONFIG_(?:PARAMETERS|KEY_\d+)\b[^;&|\n]*?"
                               r"(alias\.|clean\.requireforce|core\.hookspath)")
# `. .harden/tool-env.sh` or `source .harden/tool-env.sh` (protocol-preflight PF-21).
TOOL_ENV_SOURCED_RE = re.compile(r"(?:^|[;&|(\s])(?:\.|source)\s+[\"']?(?:\./)?\.harden/"
                                 r"tool-env\.sh\b")
TOOL_ENV_TEMP_VAR_RE = re.compile(r"\$\{?(?:TMPDIR|TMP|TEMP)\b")
FILE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
SHELL_TOOLS = {"Bash": "bash", "PowerShell": "powershell"}
STOP_EVENTS = {"Stop", "SubagentStop"}
MAX_GLOB_EXPANSION = 200
MAX_DEPTH = 3

# Run modes whose questions go to the user live ("apply" is the older name of "interactive",
# run_state.py). Every other mode asks nobody and never waits: what needs the owner becomes an
# owner item in .harden/progress.md and the report (user-policy-autonomy U01-F01; SKILL.md:
# "tell the user" in autonomous mode means writing it there).
INTERACTIVE_MODES = frozenset({"interactive", "apply"})
OWNER_ITEM = "an owner item in .harden/progress.md and the report"
NO_WAIT_NOTE = "this run asks nobody and never waits (user-policy-autonomy U01-F01)"
EDIT_ADVICE_HEAD = (
    "Existing test lines, snapshots and gate configs (lint, type-check, format, test runner, "
    "coverage, CI) are read-only while /harden runs; adding NEW test files is allowed. If this "
    "test or config looks wrong, or your change cannot pass without editing it, ")
ADDITIONS_NOTE = (
    "An existing test file may only gain lines: new lines at the end of a test body (just "
    "before its closing line), new test cases at the end of a describe block, test class, "
    "test contract or module, or named imports in the import header, none of which skips, "
    "retries, reconfigures, hooks, mocks, exits or returns early, catches, snapshots, reads "
    "the environment, or assigns or mutates a name the added lines did not declare "
    "(protocol-change PC-06; user-policy-autonomy U01-F07).")
SHELL_ADVICE_HEAD = (
    "During /harden the agent does not run destructive or history-rewriting commands: git is "
    "the only safety net (checkpoints do not capture shell changes, and native Windows has no "
    "Claude Code sandbox). ")
MARKER_MESSAGE = (
    "/harden: .harden/active is the run marker and is read-only for the agent's file tools. "
    "Record approved changes to it (the user's live answer with --interactive, the profile's "
    "auto_apply switches in autonomous mode) with run_state.py (allow-test-deletion, "
    "allow-config-edit, allow-line, set-mode); each such command is logged for the report.")
BYPASS_WARNING_HEAD = (
    "/harden warning: permission mode is bypassPermissions. Claude Code's documentation says "
    "to use this mode only in isolated environments such as containers or VMs. The Claude Code "
    "sandbox runs on macOS, Linux and WSL2 and is not supported on native Windows, so on native "
    "Windows only these hooks and git stand between a bad command and the user's files. ")
BYPASS_ADVICE = ("recommend restarting the run in default or acceptEdits mode (or inside WSL2 "
                 "or a container), and keep every change committed.")
CANARY_BASH_MESSAGE = (
    "/harden hook canary: the PreToolUse hook is active and refused this command because it "
    "contains HARDEN_HOOK_CANARY, as expected. Nothing was run. The refusal is logged in "
    ".harden/hook_events.log (canary-bash); continue with the next preflight step "
    "(run_state.py canary-check).")
CANARY_EDIT_MESSAGE = (
    "/harden hook canary: the PreToolUse hook is active and refused this edit of "
    ".harden/canary.txt, as expected. The file was not changed. The refusal is logged in "
    ".harden/hook_events.log (canary-edit); continue with the next preflight step "
    "(run_state.py canary-check).")
EVENT_LOG_MESSAGE = (
    "/harden: .harden/hook_events.log is the hooks' own record of refusals (the canary check "
    "reads it) and is read-only for the agent.")
RUN_EVIDENCE_MESSAGE = (
    "/harden: .harden/gates/ (the gate results and the baseline counts), .harden/verify.json "
    "and .harden/verify/ (the end-to-end verifier's record), .harden/session.json, "
    ".harden/budget.json (the run budget), .harden/passes/ and .harden/verifiers/ (subagent "
    "reports saved by the harden agents' own hook and by persist_pass.py, the record behind "
    "every candidate and verdict) are written only by gates.py, verify_branch.py, budget.py, "
    "persist_pass.py, ledger.py and the hooks; they are the evidence behind every 'green', "
    "every candidate and every stop, and are read-only for the agent. Run gates.py, "
    "verify_branch.py or budget.py again, and run persist_pass.py recover instead of writing a "
    "pass or verifier file.")
PROFILE_MESSAGE = (
    "/harden: .harden/profile.json is the owner's run profile, their consent written before the "
    "run (user-policy-autonomy U01-F04), and it is read-only while the run is active. The run "
    "keeps the decisions recorded at start; if the profile looks wrong, report it for the "
    "owner instead of changing it.")
FORBIDDEN_ADVICE = (
    "Nothing was run. Do not work around the ban (another spelling, a script, a file or another "
    "shell): record the step it blocked as an owner item in the report. To write notes that "
    "quote the command, use Write or Edit, or a here-document with a quoted delimiter (<<'EOF') "
    "that cat or tee writes to a file under .harden/, in a command that runs nothing but cd, "
    "read-only git or git add, and the skill's bookkeeping scripts, with no $ outside the "
    "here-document (pilot-auto-calibration A01-F54).")
REPORT_ONLY_HEAD = (
    "/harden: this run is report-only (mode report-only in .harden/active: red baseline, "
    "failed canary, --report-only, or an autonomous run without a valid run profile), so "
    "project files are not edited and nothing is committed. Write findings and notes under "
    ".harden/ only. Changes need a new run (run_state.py stop, then start --mode auto with a "
    "valid .harden/profile.json, or --mode interactive): ")
RUN_STOP_REMINDER = (
    "/harden: .harden/active disappeared without `run_state.py stop`, so the hooks stopped "
    "guarding this repository at that point. Check .harden/hook_events.log (run-control "
    "events), `git status` and `git log` before trusting the run's changes.")
HISTORY_ADVICE = (
    "undo a committed step with `git revert --no-edit <sha>` and an uncommitted one with "
    "`git restore --source=HEAD --staged --worktree -- <files>` (PC-20)")
PKG_ADVICE_HEAD = (
    "tool installs stay inside the run (eval-v1-calibration E01-F10: an `npm install` run from "
    "the wrong directory wrote ~/package.json). Run a tool through an ephemeral runner (npx, "
    "pnpm dlx, pnpx, bunx, uvx, pipx run) or install it under the repository's .harden/tools "
    "(npm install --prefix .harden/tools, pip install --target .harden/tools, cargo install "
    "--root .harden/tools), and run package-manager commands from a directory of the "
    "repository or ")
PKG_ADVICE = PKG_ADVICE_HEAD + "of its scratch fresh clone (PF-10), with literal paths"


def asks_user(active: Mapping[str, Any]) -> Optional[bool]:
    """Whether the run asks the user live: True with --interactive (also a report-only run
    started as one), False in autonomous mode, None when the marker names no mode."""
    mode = active.get("mode")
    if mode in INTERACTIVE_MODES:
        return True
    if mode == "report-only" and active.get("mode_requested") in INTERACTIVE_MODES:
        return True
    return False if isinstance(mode, str) and mode else None


def owner_route(active: Mapping[str, Any], interactive: str, autonomous: str) -> str:
    """The escalation that fits the run's mode: to the user live (--interactive) or as an
    owner item for the report (autonomous); both, each labelled, when the mode is unknown."""
    asks = asks_user(active)
    if asks is True:
        return interactive
    if asks is False:
        return autonomous
    return f"{interactive} (--interactive) or {autonomous} (autonomous mode)"


def _no_wait(active: Mapping[str, Any]) -> str:
    return f"; {NO_WAIT_NOTE}" if asks_user(active) is False else ""


def edit_advice(active: Mapping[str, Any]) -> str:
    """Advice after a refused edit of an existing test, snapshot or gate config."""
    route = owner_route(active, "stop and flag it to the user with the evidence",
                        f"record it, with the evidence, as {OWNER_ITEM}")
    return f"{EDIT_ADVICE_HEAD}{route} instead of editing it{_no_wait(active)}."


def shell_advice(active: Mapping[str, Any]) -> str:
    """Advice after a refused destructive or history-rewriting command. git stash only with
    the user's consent (protocol-preflight PF-01), so an autonomous run is not offered it."""
    stash = {True: ", git stash with the user's consent", False: "",
             None: "; git stash only with the user's consent under --interactive"}[
                 asks_user(active)]
    route = owner_route(active, "stop and ask the user to run or approve this step",
                        f"record the step as {OWNER_ITEM} instead of running it")
    return (f"{SHELL_ADVICE_HEAD}Use a non-destructive alternative (git revert, git restore "
            f"<path>{stash}) or {route}{_no_wait(active)}.")


def report_only_message(active: Mapping[str, Any]) -> str:
    """Refusal of a project-file edit in a report-only run."""
    route = owner_route(active, "ask the user", "say so in the report")
    return f"{REPORT_ONLY_HEAD}{route}{_no_wait(active)}."


def bypass_warning(active: Mapping[str, Any]) -> str:
    """The once-per-run bypassPermissions warning (protocol-preflight PF-03). In autonomous
    mode "tell the user" means writing it into .harden/progress.md and the report."""
    asks = asks_user(active)
    tell = {True: "Tell the user now, ",
            False: "Write this warning first in .harden/progress.md and the report (an "
                   "autonomous run tells the user there), ",
            None: "Tell the user now (--interactive) or write this warning first in "
                  ".harden/progress.md and the report (autonomous mode), "}[asks]
    ack = {True: "",
           False: " Apply mode then needs the profile's sandbox_ack: true (protocol-preflight "
                  "PF-03).",
           None: " In autonomous mode, apply mode then needs the profile's sandbox_ack: true "
                 "(protocol-preflight PF-03)."}[asks]
    return f"{BYPASS_WARNING_HEAD}{tell}{BYPASS_ADVICE}{ack}"


class Reason(str):
    """A block reason: the text shown to Claude, carrying a stable reason_code in `code`.

    A str subclass, so every caller that treats reasons as text keeps working.
    """

    code: str

    def __new__(cls, code: str, text: str) -> "Reason":
        obj = super().__new__(cls, text)
        obj.code = code
        return obj


def deny(code: str, text: str) -> Reason:
    """Build a block reason with its reason_code."""
    return Reason(code, text)


def reason_code(reason: str) -> str:
    """The reason_code of a block reason ("unclassified" for a plain string)."""
    return getattr(reason, "code", "unclassified")


# Every reason_code the hook can emit (logged in .harden/hook_events.log).
REASON_CODES: Dict[str, str] = {
    "canary-bash": "harmless canary command (contains HARDEN_HOOK_CANARY)",
    "canary-edit": "harmless canary edit of .harden/canary.txt",
    "marker-write": "write to the run marker .harden/active",
    "event-log-write": "write to .harden/hook_events.log",
    "run-evidence-write": "write to .harden/gates/**, .harden/verify.json, .harden/verify/**, "
                          ".harden/session.json, .harden/budget.json, a pass record under "
                          ".harden/passes/ or .harden/verifiers/**",
    "profile-forbidden": "shell command matching a forbidden_commands entry of the run profile "
                         "(U01-F03)",
    "profile-write": "write, move or delete of the run profile .harden/profile.json (U01-F04)",
    "subagent-run-control": "a subagent removing .harden/active or running run_state.py start, "
                            "stop, set-mode, allow-* or scratch-remove (A01-F45)",
    "report-only-edit": "file edit outside .harden/, or git commit/add/apply..., in report-only",
    "edit-test": "file tool on an existing test file",
    "edit-snapshot": "file tool on an existing snapshot/golden file",
    "edit-protected": "file tool on an existing gate/config file",
    "write-test": "shell write onto an existing test file",
    "write-snapshot": "shell write onto an existing snapshot/golden file",
    "write-protected": "shell write onto an existing gate/config file",
    "delete-test": "delete or move of an existing test file or directory",
    "delete-snapshot": "delete or move of an existing snapshot/golden file",
    "delete-protected": "delete or move of an existing gate/config file",
    "git-push-force": "force push or '+' refspec",
    "git-push-delete": "push that deletes a remote ref",
    "git-reset-hard": "git reset --hard",
    "git-reset-moves-branch": "git reset to a revision other than HEAD",
    "git-commit-amend": "git commit --amend",
    "git-clean-force": "git clean -f",
    "git-clean": "git clean without -n/--dry-run (-i, or clean.requireForce set to false)",
    "git-alias": "a git alias set through git -c, git config or GIT_CONFIG_*",
    "git-clean-requireforce": "clean.requireForce set through git -c, git config or GIT_CONFIG_*",
    "git-checkout-force": "git checkout --force",
    "git-checkout-reset-branch": "git checkout -B",
    "git-checkout-worktree": "git checkout of the whole tree",
    "git-switch-discard": "git switch --discard-changes/--force",
    "git-switch-reset-branch": "git switch -C",
    "git-restore-worktree": "git restore of the whole tree",
    "git-rebase": "git rebase",
    "git-pull-rebase": "git pull --rebase",
    "git-filter-history": "git filter-branch / filter-repo",
    "git-branch-force-delete": "git branch -D / --delete --force",
    "git-branch-delete-protected": "git branch -d of the run or base branch",
    "git-branch-force": "git branch --force",
    "git-branch-overwrite": "git branch -M/-C",
    "git-stash-drop": "git stash drop/clear",
    "git-reflog-destroy": "git reflog expire/delete",
    "git-hookspath": "core.hooksPath override",
    "git-no-verify": "--no-verify / commit -n",
    "git-tag-delete": "git tag -d",
    "git-tag-force": "git tag -f",
    "git-update-ref-delete": "git update-ref -d",
    "git-update-ref-stdin": "git update-ref --stdin",
    "git-update-ref-move": "git update-ref <ref> <value>",
    "rm-recursive-force": "rm -rf",
    "remove-item-recurse": "Remove-Item -Recurse",
    "rmdir-recursive": "rmdir/rd /s",
    "del-recursive": "del/erase /s",
    "find-delete": "find -delete",
    "rimraf": "rimraf",
    "inline-delete": "inline interpreter code deleting a tree",
    "recursive-listing-delete": "recursive listing piped into Remove-Item",
    "sql-destructive": "DROP/TRUNCATE sent to a database client",
    "snapshot-update": "snapshot/golden regeneration",
    "terraform-apply": "terraform/tofu apply or destroy",
    "kubectl-delete": "kubectl delete",
    "link-create": "creating a symbolic link, junction or hard link (mklink, New-Item -ItemType "
                   "Junction/SymbolicLink/HardLink, ln, cp -s/-l, fsutil hardlink, junction, "
                   "inline os.symlink/os.link/_winapi.CreateJunction/fs.symlinkSync) (A01-F56)",
    "git-worktree-remove": "git worktree remove (follows directory junctions on Windows; use "
                           "run_state.py scratch-remove) (A01-F56)",
    "pkg-outside-repo": "package install/remove that runs or writes outside the repository, or "
                        "a global install (E01-F10)",
    "temp-outside-run": "shell or file-tool write under the OS temp directory outside the run's "
                        "scratch_dir and repository (PF-21, E03-F06)",
    "stop-hard-violations": "Stop blocked by diff_guard hard violations",
}

# Credentials that must not reach .harden/hook_events.log (logging standards: never log
# secrets, even partially).
_SECRET_WORDS = (r"(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|"
                 r"private[_-]?key|credentials?|auth)")
_SECRET_VALUE = r"(\"[^\"]*\"|'[^']*'|[^\s;&|]+)"
_REDACTIONS: List[Tuple["re.Pattern[str]", str]] = [
    (re.compile(r"(?i)(\b[a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@"), r"\1***@"),
    (re.compile(r"(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]+"), r"\1***"),
    (re.compile(r"(?i)(--?[\w-]*" + _SECRET_WORDS + r"[\w-]*)(\s+|=)" + _SECRET_VALUE),
     r"\1\2***"),
    (re.compile(r"(?i)(\b[\w.-]*" + _SECRET_WORDS + r"[\w.-]*\s*[=:]\s*)" + _SECRET_VALUE),
     r"\1***"),
    (re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
                r"sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b"), "***"),
]


def redact(text: str) -> str:
    """Mask obvious credentials in a command before it is logged."""
    for rx, repl in _REDACTIONS:
        text = rx.sub(repl, text)
    return text


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


def normalize_path(path: str) -> str:
    """Absolute-or-relative path with forward slashes, `~` expanded, `..` collapsed."""
    p = path.strip()
    if p.startswith("\\\\?\\"):
        p = p[4:]
    p = p.replace("\\", "/")
    if IS_WINDOWS:
        msys = re.match(r"^/([a-zA-Z])(/|$)", p)
        if msys:
            p = msys.group(1).upper() + ":/" + p[3:]
    p = os.path.normpath(os.path.expanduser(p))
    return p.replace("\\", "/")


def _fold(path: str) -> str:
    return path.lower() if IS_WINDOWS else path


def search_starts(env: Mapping[str, str], payload: Mapping[str, Any]) -> List[str]:
    """Directories the run root is searched from, in order: the tool target's directory,
    the input "cwd", then $CLAUDE_PROJECT_DIR (duplicates removed)."""
    cwd = payload.get("cwd")
    cwd = cwd if isinstance(cwd, str) and cwd.strip() else None
    project = env.get("CLAUDE_PROJECT_DIR")
    project = project if isinstance(project, str) and project.strip() else None
    starts: List[str] = []
    target = _file_tool_target(payload)
    if target:
        path = normalize_path(target)
        if not os.path.isabs(path) and not re.match(r"^[A-Za-z]:/", path):
            anchor = cwd or project
            path = normalize_path(os.path.join(normalize_path(anchor), path)) if anchor else ""
        if path:
            starts.append(os.path.dirname(path))
    starts += [s for s in (cwd, project) if s]
    out: List[str] = []
    seen = set()
    for start in starts:
        key = _fold(normalize_path(start))
        if key not in seen:
            seen.add(key)
            out.append(start)
    return out


def _walk_up(start: str, relative: str) -> Optional[Path]:
    """First directory from `start` up to the first one holding `.git` that holds `relative`."""
    try:
        cur = Path(normalize_path(start))
        for _ in range(64):
            if (cur / relative).exists():
                return cur
            if (cur / ".git").exists():
                return None
            parent = cur.parent
            if parent == cur:
                return None
            cur = parent
    except (OSError, ValueError):
        return None
    return None


def _walk_up_git_top(path: str) -> Optional[str]:
    """Nearest directory from `path` upwards that holds `.git` (a directory or a file)."""
    cur = normalize_path(path)
    for _ in range(256):
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if not parent or parent == cur:
            return None
        cur = parent
    return None


def find_run_root(env: Mapping[str, str], payload: Mapping[str, Any]) -> Optional[Path]:
    """Directory holding .harden/active, searched up to the repository root from the tool
    target's directory, the input cwd, then $CLAUDE_PROJECT_DIR (first marker found wins).

    Starting from the project directory alone missed every run in a repository nested inside
    the session's repository: the walk stopped at the outer `.git`."""
    for start in search_starts(env, payload):
        root = _walk_up(start, MARKER_REL)
        if root is not None:
            return root
    return None


@dataclass
class DirState:
    """Where the shell command being analysed runs: its working directory (None when the hook
    cannot resolve it), the previous one (`cd -`) and the pushd / Push-Location stack."""

    cwd: Optional[str]
    prev: Optional[str] = None
    stack: List[Optional[str]] = field(default_factory=list)
    # Other directories the shell may be in, because a cd may have failed and a ; or || let
    # the command go on (pilot-auto-calibration A01-F31); empty while every operator since the
    # last cd is &&. `chain` holds the directories left by cds joined with && since the last
    # other operator: a later ; or || makes each of them possible again.
    alts: List[Optional[str]] = field(default_factory=list)
    chain: List[Optional[str]] = field(default_factory=list)

    @property
    def certain(self) -> bool:
        return not self.alts

    def copy(self) -> "DirState":
        return DirState(self.cwd, self.prev, list(self.stack), list(self.alts), list(self.chain))


# $PWD / ${PWD}, PowerShell $env:NAME, and what stays unresolved after expansion.
_PWD_RE = re.compile(r"\$(?:PWD\b|\{PWD\})")
_PS_ENV_RE = re.compile(r"(?i)\$env:([A-Za-z_][A-Za-z0-9_]*)")
_UNRESOLVED_RE = re.compile(r"[$`]|%[^%/\s]+%")


class Ctx:
    """Path resolution and classification for one hook call."""

    def __init__(self, root: Path, cwd: Optional[str], cfg: dg.RunConfig,
                 active: Optional[Mapping[str, Any]] = None) -> None:
        self.root = normalize_path(str(root))
        self.cwd = normalize_path(cwd) if isinstance(cwd, str) and cwd.strip() else self.root
        self.cfg = cfg
        self.active: Dict[str, Any] = dict(active or {})
        self._base_cache: Dict[str, bool] = {}
        self._protected_branches: Optional[List[str]] = None
        # Allowed commands that change or end the run (logged as run-control events).
        self.run_control: List[str] = []
        # Working directory of the shell command under analysis (followed through cd).
        self.dirs = DirState(self.cwd)
        self._clone_cache: Dict[str, bool] = {}
        # The run's scratch directory outside the repository (run_state.py start; D-S,
        # eval-v2-calibration E02-F08). None for a marker written before it existed.
        scratch = self.active.get("scratch_dir")
        self.scratch_dir = normalize_path(scratch) if isinstance(scratch, str) and \
            scratch.strip() else None
        # The run profile's command bans (U01-F03), copied into the marker by run_state.py. A
        # wrongly typed value is read the stricter way: one string is one pattern.
        raw_bans = self.active.get("forbidden_commands")
        bans = [raw_bans] if isinstance(raw_bans, str) else raw_bans \
            if isinstance(raw_bans, list) else []
        self.forbidden, _problems = vp.compile_patterns([p for p in bans if isinstance(p, str)])
        # True when the shell command under analysis sources .harden/tool-env.sh, whose
        # TMPDIR, TMP and TEMP point into the scratch_dir (protocol-preflight PF-21).
        self.tool_env_sourced = False
        self._temp_roots: Optional[List[str]] = None

    @property
    def report_only(self) -> bool:
        return self.active.get("mode") == "report-only"

    def forbidden_hit(self, command: str, shell: str = "bash", data_rule: bool = True
                      ) -> Tuple[Optional[str], Optional[str]]:
        """(the forbidden_commands entry the command's code text matches, or None; a note
        when the match lies only in text that would have been data). In an orchestrator Bash
        command, text that the command only writes to a file under .harden/ is data
        (pilot-auto-calibration A01-F54); a subagent's command (data_rule False) is matched
        whole."""
        if not self.forbidden:
            return None, None
        return forbidden_command_hit(command, shell, self, data_rule)

    def protected_branches(self) -> List[str]:
        """Branches `git branch -d` must not delete: the run branch, the base branch (named in
        .harden/active as "base_branch", or found as a local branch pointing at base_sha) and
        origin's default branch. Computed once, only when a branch deletion is analysed."""
        if self._protected_branches is None:
            names: List[str] = []
            for key in ("branch", "base_branch"):
                value = self.active.get(key)
                if isinstance(value, str) and value.strip():
                    names.append(value.strip())
            lookups: List[List[str]] = [["symbolic-ref", "-q", "--short",
                                         "refs/remotes/origin/HEAD"]]
            if self.cfg.base_sha:
                lookups.append(["for-each-ref", "--points-at", self.cfg.base_sha,
                                "--format=%(refname:short)", "refs/heads"])
            for args in lookups:
                try:
                    proc = dg.git_run(Path(self.root), args)
                except (dg.GitError, OSError):
                    continue
                if proc.returncode != 0:
                    continue
                for line in proc.stdout.decode("utf-8", errors="replace").splitlines():
                    line = line.strip()
                    if args[0] == "symbolic-ref" and line.startswith("origin/"):
                        line = line[len("origin/"):]
                    if line:
                        names.append(line)
            self._protected_branches = names
        return self._protected_branches

    def is_path_like(self, word: str) -> bool:
        """True when a git argument is a path: it exists, or is a glob or a pathspec."""
        if not word:
            return False
        if word.startswith(":") or any(ch in word for ch in "*?["):
            return True
        return any(os.path.exists(p) for p in self.expand(word))

    def git_spelling(self, abs_path: str, rel: str) -> str:
        """The on-disk spelling of `rel` relative to the root (git trees are case-sensitive,
        Windows paths are not)."""
        lookup = rel
        try:
            real_root = normalize_path(os.path.realpath(self.root)).rstrip("/")
            real_path = normalize_path(os.path.realpath(abs_path))
            if _fold(real_path).startswith(_fold(real_root) + "/"):
                lookup = real_path[len(real_root) + 1:]
        except (OSError, ValueError):
            pass
        return lookup.rstrip("/")

    def existed_at_base(self, abs_path: str, rel: str) -> bool:
        """True unless git shows that `rel` is absent from the run's base commit.

        A file the run created itself (a new characterization test, for example) may be
        edited or deleted again, exactly as diff_guard.py treats it (only paths that existed
        at base_sha are read-only). Any doubt (no base_sha, git failure, bad base) counts as
        "existed", so the block stands. Only called for paths that already matched a
        read-only glob, so the one `git ls-tree` call stays off the common path.
        """
        base = self.cfg.base_sha
        if not base:
            return True
        lookup = self.git_spelling(abs_path, rel)
        if lookup in self._base_cache:
            return self._base_cache[lookup]
        try:
            proc = dg.git_run(Path(self.root), ["--literal-pathspecs", "ls-tree", "-z",
                                                "--name-only", base, "--", lookup])
        except (dg.GitError, OSError):
            return True
        existed = proc.returncode != 0 or bool(proc.stdout.strip(b"\0"))
        self._base_cache[lookup] = existed
        return existed

    def absolute(self, raw: str) -> str:
        p = normalize_path(raw)
        if not os.path.isabs(p) and not re.match(r"^[A-Za-z]:/", p):
            p = normalize_path(os.path.join(self.cwd, p))
        return p

    def relative(self, abs_path: str) -> Optional[str]:
        root = self.root.rstrip("/")
        if _fold(abs_path) == _fold(root):
            return ""
        if _fold(abs_path).startswith(_fold(root) + "/"):
            return abs_path[len(root) + 1:]
        try:
            real_root = normalize_path(os.path.realpath(root))
            real_path = normalize_path(os.path.realpath(abs_path))
        except (OSError, ValueError):
            return None
        if _fold(real_path).startswith(_fold(real_root.rstrip("/")) + "/"):
            return real_path[len(real_root.rstrip("/")) + 1:]
        return None

    def resolve_dir(self, word: str, base: Optional[str]) -> Optional[str]:
        """Absolute path a directory argument names, relative words resolved against `base`.

        Expands ~, $VAR / ${VAR} / %VAR% from the hook's environment, PowerShell $env:NAME and
        $PWD (= `base`). None when the result cannot be known: a variable that is not set, a
        command substitution, or a relative word while `base` itself is unknown."""
        text = word.strip()
        if not text:
            return None
        if base is not None:
            text = _PWD_RE.sub(lambda _m: base, text)
        text = _PS_ENV_RE.sub(lambda m: os.environ.get(m.group(1), m.group(0)), text)
        text = os.path.expandvars(text)
        if _UNRESOLVED_RE.search(text):
            return None
        path = normalize_path(text)
        if re.match(r"^[A-Za-z]:/", path) or os.path.isabs(path):
            return path
        if base is None:
            return None
        # os.path.join keeps a rooted word such as Git Bash's /tmp on base's drive (Windows).
        return normalize_path(os.path.join(base, path))

    def inside(self, abs_path: Optional[str]) -> bool:
        """True when `abs_path` is the run root or lies under it."""
        return abs_path is not None and self.relative(abs_path) is not None

    def install_scope(self, abs_path: Optional[str]) -> bool:
        """True when a package install may work in `abs_path` (see install_scope_problem)."""
        return self.install_scope_problem(abs_path) is None

    def install_scope_problem(self, abs_path: Optional[str]) -> Optional[str]:
        """None when a package install may work in `abs_path`, else where it would work.

        In scope: the run root, and the clones and worktrees of the run's repository under
        the run's scratch_dir, such as protocol-preflight PF-10's fresh clone (`git clone
        --no-local .` records the run root as its origin URL; PF-21 allows installs there).
        With a scratch_dir recorded (D-S, eval-v2-calibration E02-F08), a clone or worktree
        elsewhere is out of scope: in a sibling or other unrelated directory, and nested
        inside the repository, where test runners and detectors find it and Node resolves the
        repository's node_modules from it. A marker without scratch_dir (a run started before
        it existed) accepts any clone or worktree. Reads one small git file per repository
        found, and none for a path of the run root outside a nested repository."""
        if abs_path is None:
            return "a directory the hook cannot resolve"
        if self.inside(abs_path):
            if self.scratch_dir is None:
                return None
            top = _walk_up_git_top(abs_path)
            if top is None or _fold(top.rstrip("/")) == _fold(self.root.rstrip("/")) or \
                    self._same_as_root(top) or not self._clone_of_root(top):
                return None
            return (f"{top}, a clone or worktree of the repository nested inside it: test "
                    f"runners and detectors would read it and Node would resolve the "
                    f"repository's node_modules from it; scratch copies go under the run's "
                    f"scratch_dir {self.scratch_dir} (eval-v2-calibration E02-F08)")
        top = _walk_up_git_top(abs_path)
        if top is None or not self._clone_of_root(top):
            where = (f"the clones and worktrees of it under the run's scratch_dir "
                     f"{self.scratch_dir}" if self.scratch_dir else "any clone or worktree of it")
            return f"{abs_path}, outside the repository {self.root} and outside {where}"
        if self.scratch_dir is not None and not self.under_scratch(top):
            return (f"{top}, a clone or worktree of the repository outside the run's scratch_dir "
                    f"{self.scratch_dir} (eval-v2-calibration E02-F08: scratch clones and "
                    f"their installs live there, never in a sibling or other directory)")
        return None

    def _clone_of_root(self, top: str) -> bool:
        if top not in self._clone_cache:
            self._clone_cache[top] = self._is_clone_of_root(top)
        return self._clone_cache[top]

    def temp_roots(self) -> List[str]:
        """Folded, resolved OS temp directories: tempfile's, TMPDIR, TEMP and TMP, plus /tmp
        and /var/tmp outside Windows. Computed once per hook call."""
        if self._temp_roots is None:
            raw = [tempfile.gettempdir()]
            raw += [os.environ.get(k, "") for k in ("TMPDIR", "TEMP", "TMP")]
            if not IS_WINDOWS:
                raw += ["/tmp", "/var/tmp"]
            roots: List[str] = []
            for value in raw:
                if not value or not os.path.isabs(value):
                    continue
                try:
                    folded = _fold(normalize_path(os.path.realpath(value))).rstrip("/")
                except (OSError, ValueError):
                    continue
                if folded and folded not in roots:
                    roots.append(folded)
            self._temp_roots = roots
        return self._temp_roots

    def temp_write_reason(self, word: str, abs_path: str, how: str) -> Optional[Reason]:
        """Refuse a write under the OS temp directory outside the run's scratch_dir and the
        repository (protocol-preflight PF-21; eval-v3-calibration E03-F06). Off without a
        recorded scratch_dir."""
        if self.scratch_dir is None:
            return None
        if self.tool_env_sourced and TOOL_ENV_TEMP_VAR_RE.search(word):
            return None  # $TMPDIR, $TMP and $TEMP name <scratch_dir>/tmp once it is sourced
        text = os.path.expandvars(word).replace("\\", "/")
        cand = abs_path
        if IS_WINDOWS and (text == "/tmp" or text.startswith("/tmp/")):
            cand = normalize_path(tempfile.gettempdir()) + text[4:]
        if self.inside(cand) or self.under_scratch(cand):
            return None
        try:
            real = _fold(normalize_path(os.path.realpath(cand))).rstrip("/")
        except (OSError, ValueError):
            return None
        for root in self.temp_roots():
            if real == root or real.startswith(root + "/"):
                return deny("temp-outside-run",
                            f"{how} would write {cand}, under the OS temp directory but outside "
                            f"the run's scratch_dir {self.scratch_dir}: write it under "
                            f"{self.scratch_dir}/tmp instead, or source .harden/tool-env.sh "
                            f"(protocol-preflight PF-21; eval-v3-calibration E03-F06)")
        return None

    def under_scratch(self, path: str) -> bool:
        """True when `path` is the run's scratch_dir or lies under it (both resolved, so 8.3
        short names and symlinks compare equal)."""
        if self.scratch_dir is None:
            return False
        try:
            real = _fold(normalize_path(os.path.realpath(path))).rstrip("/")
            base = _fold(normalize_path(os.path.realpath(self.scratch_dir))).rstrip("/")
        except (OSError, ValueError):
            return False
        return real == base or real.startswith(base + "/")

    def _same_as_root(self, path: str) -> bool:
        try:
            real = normalize_path(os.path.realpath(path)).rstrip("/")
            real_root = normalize_path(os.path.realpath(self.root)).rstrip("/")
        except (OSError, ValueError):
            return False
        return _fold(real) == _fold(real_root)

    def _is_clone_of_root(self, top: str) -> bool:
        """True when the repository at `top` is a clone (a remote URL naming the run root) or
        a worktree (a .git file pointing into the run root's .git/worktrees/)."""
        git = os.path.join(top, ".git")
        try:
            if os.path.isfile(git):
                with open(git, encoding="utf-8", errors="replace") as handle:
                    match = re.match(r"\s*gitdir:\s*(.+?)\s*$", handle.read(4096))
                if not match:
                    return False
                gitdir = normalize_path(os.path.join(top, normalize_path(match.group(1))))
                worktrees = normalize_path(os.path.join(self.root, ".git", "worktrees"))
                real = _fold(normalize_path(os.path.realpath(gitdir)))
                real_wt = _fold(normalize_path(os.path.realpath(worktrees)))
                return real.startswith(real_wt + "/")
            with open(os.path.join(git, "config"), encoding="utf-8", errors="replace") as handle:
                config = handle.read(65536)
        except (OSError, ValueError):
            return False
        for url in re.findall(r"(?m)^\s*url\s*=\s*(.+?)\s*$", config):
            url = url.strip("\"'")
            if url.lower().startswith("file://"):
                url = url[len("file://"):]
                if re.match(r"^/[A-Za-z]:/", url):
                    url = url[1:]
            elif "://" in url or re.match(r"^[\w.-]+@[\w.-]+:", url):
                continue  # a network remote, not a local clone source
            path = normalize_path(url)
            if not os.path.isabs(path) and not re.match(r"^[A-Za-z]:/", path):
                path = normalize_path(os.path.join(top, path))
            if self._same_as_root(path):
                return True
        return False

    def under_tools(self, abs_path: Optional[str]) -> bool:
        """True when `abs_path` is the run's .harden/tools directory or lies under it."""
        rel = self.relative(abs_path) if abs_path is not None else None
        if rel is None:
            return False
        folded = _fold(rel.rstrip("/"))
        return folded == _fold(TOOLS_REL) or folded.startswith(_fold(TOOLS_REL) + "/")

    @staticmethod
    def is_marker(rel: str) -> bool:
        return _fold(rel) == _fold(MARKER_REL)

    @staticmethod
    def is_canary(rel: str) -> bool:
        return _fold(rel) == _fold(CANARY_REL)

    @staticmethod
    def is_event_log(rel: str) -> bool:
        return _fold(rel) == _fold(EVENT_LOG_REL)

    @staticmethod
    def is_run_evidence(rel: str) -> bool:
        """.harden/session.json, .harden/verify.json, .harden/budget.json (budget.py), or
        anything under .harden/gates/ (gate results, baseline), .harden/verify/ (the
        end-to-end verifier's logs), .harden/passes/raw/ (captured subagent results) or
        .harden/verifiers/, and every pass record under .harden/passes/: a report (*.md, its
        versions and _unrouted copies), its .meta.json, .reads.json, .result.json, .gaps.json
        and .files.json, and persist.log (subagent reports saved by the harden agents' Stop
        hook, persist_pass.py and ledger.py; pilot-auto-calibration A01-F30, A01-F34, A01-F42).
        This refuses the Edit, Write and shell-redirect forms of a hand-written pass file; it
        is a first layer, like the rest of the hook (PF-04)."""
        folded = _fold(rel.rstrip("/"))
        if folded in (_fold(SESSION_REL), _fold(VERIFY_REL), _fold(BUDGET_REL)):
            return True
        if folded.startswith(_fold(PASSES_REL) + "/") and folded.endswith(PASS_RECORD_SUFFIXES):
            return True
        return any(folded == _fold(d) or folded.startswith(_fold(d) + "/")
                   for d in (GATES_REL, VERIFY_DIR_REL, RAW_PASSES_REL, VERIFIERS_REL))

    @staticmethod
    def is_profile(rel: str) -> bool:
        return _fold(rel) == _fold(PROFILE_REL)

    @staticmethod
    def in_harden_dir(rel: str) -> bool:
        folded = _fold(rel)
        return folded == _fold(HARDEN_REL) or folded.startswith(_fold(HARDEN_REL) + "/")

    def classify(self, rel: str) -> Optional[Tuple[str, str]]:
        """('test'|'snapshot'|'protected', glob) for a repo-relative path, else None."""
        for kind, globs in (("test", self.cfg.tests), ("snapshot", self.cfg.snapshots),
                            ("protected", self.cfg.protected)):
            pattern = globs.first_match(rel)
            if pattern:
                return kind, pattern
        return None

    def absolute_candidates(self, raw: str) -> List[str]:
        """Absolute paths a shell target word may name. A relative word resolves in the
        directory a literal cd earlier in the command moved to (ctx.dirs), or in the session's
        directory when that cd's target is unknown; when a cd may have failed (a ; or || came
        after it), also in every other directory the shell may be in and in the session's
        (pilot-auto-calibration A01-F31). File tools use absolute(), which is unchanged."""
        p = normalize_path(raw)
        if os.path.isabs(p) or re.match(r"^[A-Za-z]:/", p):
            return [p]
        bases: List[Optional[str]] = [self.dirs.cwd] + list(self.dirs.alts)
        if not self.dirs.certain:
            bases.append(self.cwd)
        out: List[str] = []
        for base in bases:
            cand = normalize_path(os.path.join(base if base is not None else self.cwd, p))
            if cand not in out:
                out.append(cand)
        return out

    def expand(self, word: str) -> List[str]:
        """Absolute paths a shell word may refer to (env vars, ~ and wildcards expanded; every
        directory a relative word may resolve in, absolute_candidates)."""
        if not word or word in ("-", "/dev/null", "nul", "NUL", "$null", "$NULL") or word.isdigit():
            return []
        text = os.path.expandvars(word)
        if text.startswith("$env:"):
            return []
        out: List[str] = []
        for absolute in self.absolute_candidates(text):
            if any(ch in text for ch in "*?["):
                try:
                    matches = globmod.glob(absolute)[:MAX_GLOB_EXPANSION]
                except (OSError, ValueError, re.error):
                    matches = []
                found = [normalize_path(m) for m in matches]
            else:
                found = [absolute]
            out.extend(f for f in found if f not in out)
        return out

    def write_reason(self, words: Sequence[str], how: str) -> Optional[Reason]:
        """Reason to block writing to one of `words` (existing protected/test file, the run
        marker or the hook event log)."""
        for word in words:
            for abs_path in self.expand(word):
                temp = self.temp_write_reason(word, abs_path, how)
                if temp:
                    return temp
                rel = self.relative(abs_path)
                if rel is None:
                    continue
                if self.is_marker(rel):
                    return deny("marker-write", f"{how} would write .harden/active, the run marker")
                if self.is_event_log(rel):
                    return deny("event-log-write",
                                f"{how} would write .harden/hook_events.log, the hooks' record "
                                f"of refusals")
                if self.is_run_evidence(rel):
                    return deny("run-evidence-write",
                                f"{how} would write {rel}, run evidence that only gates.py, "
                                f"verify_branch.py, budget.py, persist_pass.py, ledger.py and "
                                f"the hooks write (a lost pass report: run persist_pass.py "
                                f"recover)")
                if self.is_profile(rel):
                    return deny("profile-write",
                                f"{how} would write .harden/profile.json, the owner's run "
                                f"profile, which is read-only while the run is active "
                                f"(user-policy-autonomy U01-F04)")
                if not os.path.isfile(abs_path):
                    continue
                hit = self.classify(rel)
                if hit and self.existed_at_base(abs_path, rel):
                    route = owner_route(self.active, "flag it to the user instead",
                                        f"record it as {OWNER_ITEM} instead")
                    return deny(f"write-{hit[0]}",
                                f"{how} would modify {rel}, an existing {hit[0]} file (matches "
                                f"{hit[1]}), which is read-only during /harden; if it looks "
                                f"wrong, {route}")
        return None

    def delete_reason(self, words: Sequence[str], how: str,
                      recursive: bool = False) -> Optional[Reason]:
        """Reason to block deleting/moving one of `words` (protected/test files, not allow-listed)."""
        for word in words:
            for abs_path in self.expand(word):
                rel = self.relative(abs_path)
                if rel is None:
                    continue
                marker_inside = rel == "" or _fold(MARKER_REL).startswith(
                    _fold(rel.rstrip("/")) + "/")
                if self.is_marker(rel) or (marker_inside and os.path.isdir(abs_path)):
                    self.run_control.append(f"remove-marker ({how})")
                if rel == "" or self.is_marker(rel):
                    continue
                if self.is_profile(rel) and os.path.exists(abs_path):
                    return deny("profile-write",
                                f"{how} would delete or move .harden/profile.json, the owner's "
                                f"run profile, which is read-only while the run is active "
                                f"(user-policy-autonomy U01-F04)")
                if os.path.isdir(abs_path):
                    if not recursive:
                        continue
                    hit = self.classify(rel.rstrip("/") + "/__harden_probe__")
                elif os.path.exists(abs_path):
                    hit = self.classify(rel)
                else:
                    continue
                if not hit:
                    continue
                if hit[0] in ("test", "snapshot") and self.cfg.allow.first_match(rel):
                    continue
                if not self.existed_at_base(abs_path, rel):
                    continue  # created during this run: not part of the frozen suite
                return deny(f"delete-{hit[0]}",
                            f"{how} would delete or move {rel}, an existing {hit[0]} "
                            f"{'directory' if os.path.isdir(abs_path) else 'file'} (matches "
                            f"{hit[1]}) that is read-only during /harden"
                            f"{self._deletion_route(hit[0])}")
        return None

    def _deletion_route(self, kind: str) -> str:
        """The end of a refused deletion's message. Only a test deletion the user approved live
        (--interactive) and run_state.py allow-test-deletion recorded unlocks a test or
        snapshot file (lens-dead-code DC-15); an autonomous run never deletes one
        (user-policy-autonomy U01-F03). Nothing unlocks deleting a protected file."""
        if kind in ("test", "snapshot"):
            asks = asks_user(self.active)
            if asks is True:
                return " unless the user approved it and run_state.py allow-test-deletion " \
                       "recorded it"
            never = "an autonomous run never deletes an existing test (user-policy-autonomy " \
                    "U01-F03)"
            if asks is False:
                return f"; {never}: record the deletion it needs as {OWNER_ITEM}"
            return (" unless the user approved it with --interactive and run_state.py "
                    f"allow-test-deletion recorded it; {never}")
        return "; if it must go, " + owner_route(self.active, "flag it to the user",
                                                 f"record it as {OWNER_ITEM}")


# ---------------------------------------------------------------------------
# Shell tokenizer (best effort, quote-aware; never raises)
# ---------------------------------------------------------------------------


@dataclass
class Heredoc:
    """One here-document of a bash command line (raw offsets into the command)."""
    op_start: int
    delimiter: str
    quoted: bool        # any part of the delimiter word quoted: the body is taken literally
    strip_tabs: bool    # <<-
    body_start: int = -1
    body_end: int = -1
    terminated: bool = False
    body: str = ""


@dataclass
class Tok:
    kind: str  # "word" | "op" | "redir"
    text: str
    quoted: bool = False
    # Raw offsets into the command line: the first character (a word's opening quote
    # included) and the index where the token ended; -1 when unknown. A redirection that
    # starts a here-document carries it (pilot-auto-calibration A01-F54).
    start: int = field(default=-1, compare=False)
    end: int = field(default=-1, compare=False)
    heredoc: Optional[Heredoc] = field(default=None, compare=False)


@dataclass
class Segment:
    words: List[Tok] = field(default_factory=list)
    redirs: List[Tuple[str, str]] = field(default_factory=list)
    # Operators between the previous segment and this one ("(", ")", ";", "&&", "|", ...)
    # and the operator that ended this one (None at the end of the command line).
    lead_ops: List[str] = field(default_factory=list)
    end_op: Optional[str] = None
    # Here-documents redirected into this segment's command, in order.
    heredocs: List[Heredoc] = field(default_factory=list)


_HEREDOC_RE = re.compile(r"(?<!<)<<(-?)[ \t]*(?:'([^'\n]*)'|\"([^\"\n]*)\"|\\?([A-Za-z_][\w.-]*))")
# Characters that may follow a delimiter word Bash reads the same way as _HEREDOC_RE: a
# delimiter that goes on (E"OF", 'E'OF, EOF$X) starts no here-document here, so the lines
# after it stay commands (the safe direction).
_HEREDOC_WORD_END = " \t\r\n;&|<>()"
_PS_HERESTRING_RE = re.compile(r"@(['\"])[ \t]*\r?\n.*?\r?\n[ \t]*\1@", re.S)


def _read_heredoc_bodies(cmd: str, start: int, pending: Sequence[Heredoc]) -> int:
    """Consume the bodies of `pending`, the here-documents of the line that ended just before
    `start`, in order; return the index tokenizing continues at. A line whose strip() equals
    the delimiter ends a body, which for a delimiter _HEREDOC_RE accepts is no later than Bash
    ends it. An unterminated body is not skipped: tokenizing continues at its first line, so
    its lines are analysed as commands (Bash would warn and read them as body; reading them as
    commands is the conservative direction)."""
    n = len(cmd)
    pos = start
    for doc in pending:
        doc.body_start = pos
        line_start = pos
        while line_start < n:
            newline = cmd.find("\n", line_start)
            line_end = n if newline == -1 else newline
            if cmd[line_start:line_end].strip() == doc.delimiter:
                doc.body_end = line_start
                doc.terminated = True
                doc.body = cmd[pos:line_start]
                pos = n if newline == -1 else newline + 1
                break
            line_start = n if newline == -1 else newline + 1
        if not doc.terminated:
            doc.body_end = n
            doc.body = cmd[doc.body_start:]
            return doc.body_start
    return pos


def tokenize(cmd: str, shell: str) -> List[Tok]:
    """Split a command line into words, operators and redirections.

    In bash, here-documents are read as the shell reads them: a `<<` or `<<-` outside quotes,
    comments and arithmetic (`$((x<<y))`) whose delimiter word _HEREDOC_RE reads whole starts
    one; its body begins after the next unquoted newline, is attached to the redirection token
    and skipped (it is data for the command, or code only when a shell or interpreter reads
    it: _heredoc_code_reason). Tokens carry raw offsets into `cmd` (pilot-auto-calibration
    A01-F54)."""
    ps_like = shell in ("powershell", "cmd")
    if shell == "powershell":
        cmd = _PS_HERESTRING_RE.sub("''", cmd)
    toks: List[Tok] = []
    buf: List[str] = []
    state: Dict[str, Any] = {"in_word": False, "quoted": False, "start": -1}
    pending: List[Heredoc] = []
    arith = 0
    n = len(cmd)
    i = 0

    def flush(end: int) -> None:
        if state["in_word"]:
            toks.append(Tok("word", "".join(buf), bool(state["quoted"]), start=state["start"],
                            end=end))
        buf.clear()
        state["in_word"] = False
        state["quoted"] = False
        state["start"] = -1

    def add(text: str, at: int, quoted: bool = False) -> None:
        if not state["in_word"]:
            state["start"] = at
        buf.append(text)
        state["in_word"] = True
        if quoted:
            state["quoted"] = True

    def emit(kind: str, text: str, at: int, end: int,
             heredoc: Optional[Heredoc] = None) -> None:
        toks.append(Tok(kind, text, start=at, end=end, heredoc=heredoc))

    while i < n:
        c = cmd[i]
        nxt = cmd[i + 1] if i + 1 < n else ""
        if c in " \t\r\f\v":
            flush(i)
            i += 1
        elif c == "\n":
            flush(i)
            emit("op", ";", i, i + 1)
            i += 1
            if pending:
                i = _read_heredoc_bodies(cmd, i, pending)
                pending = []
        elif c == "#" and not state["in_word"] and shell != "cmd":
            end = cmd.find("\n", i)
            i = n if end == -1 else end
        elif c == "'" and shell != "cmd":
            end = cmd.find("'", i + 1)
            end = n if end == -1 else end
            add(cmd[i + 1:end], i, quoted=True)
            i = end + 1
        elif c == '"':
            j = i + 1
            part: List[str] = []
            while j < n and cmd[j] != '"':
                ch = cmd[j]
                if not ps_like and ch == "\\" and j + 1 < n and cmd[j + 1] in '"\\$`\n':
                    if cmd[j + 1] != "\n":
                        part.append(cmd[j + 1])
                    j += 2
                    continue
                if shell == "powershell" and ch == "`" and j + 1 < n:
                    part.append(cmd[j + 1])
                    j += 2
                    continue
                part.append(ch)
                j += 1
            add("".join(part), i, quoted=True)
            i = j + 1
        elif c == "\\":
            if ps_like:
                add("/", i)
                i += 1
            elif nxt == "\n":
                i += 2
            elif nxt == "\r" and cmd[i + 2:i + 3] == "\n":
                i += 3
            elif nxt and (nxt.isalnum() or nxt in "._-"):
                add("/", i)
                i += 1
            elif nxt:
                add(nxt, i)
                i += 2
            else:
                i += 1
        elif c == "`":
            if shell == "powershell":
                if nxt == "\n":
                    i += 2
                elif nxt == "\r":
                    i += 3 if cmd[i + 2:i + 3] == "\n" else 2
                elif nxt:
                    add(nxt, i)
                    i += 2
                else:
                    i += 1
            else:
                flush(i)
                emit("op", "(", i, i + 1)
                i += 1
        elif c == "$" and nxt == "(":
            flush(i)
            emit("op", "(", i, i + 2)
            i += 2
        elif c in ";()":
            flush(i)
            if shell == "bash" and c == "(" and toks and toks[-1].kind == "op" \
                    and toks[-1].text == "(" and toks[-1].end == i:
                arith += 1  # (( or $(( opens an arithmetic context: `<<` there is a shift
            elif shell == "bash" and c == ")" and nxt == ")" and arith > 0:
                arith -= 1
                emit("op", ")", i, i + 1)
                emit("op", ")", i + 1, i + 2)
                i += 2
                continue
            emit("op", c, i, i + 1)
            i += 1
        elif c in "{}" and not state["in_word"] and (c == "}" or nxt in " \t\n;" or not nxt):
            flush(i)
            emit("op", ";", i, i + 1)  # command grouping / script block boundary
            i += 1
        elif c == "&":
            flush(i)
            if nxt == "&":
                emit("op", "&&", i, i + 2)
                i += 2
            elif nxt == ">":
                op = "&>>" if cmd[i + 2:i + 3] == ">" else "&>"
                emit("redir", op, i, i + len(op))
                i += len(op)
            else:
                emit("op", "&", i, i + 1)
                i += 1
        elif c == "|":
            flush(i)
            if nxt == "|":
                emit("op", "||", i, i + 2)
                i += 2
            else:
                width = 2 if nxt == "&" else 1
                emit("op", "|", i, i + width)
                i += width
        elif c in "<>":
            word = "".join(buf)
            if state["in_word"] and not state["quoted"] and (word.isdigit() or word == "*"):
                buf.clear()
                state["in_word"] = False
                state["start"] = -1
            else:
                flush(i)
            op = c
            if c == ">":
                for cand in (">>", ">|", ">&"):
                    if cmd.startswith(cand, i):
                        op = cand
                        break
            else:
                for cand in ("<<<", "<<-", "<<", "<&", "<>"):
                    if cmd.startswith(cand, i):
                        op = cand
                        break
            doc: Optional[Heredoc] = None
            if shell == "bash" and op in ("<<", "<<-") and arith == 0:
                m = _HEREDOC_RE.match(cmd, i)
                if m and (m.end() == n or cmd[m.end()] in _HEREDOC_WORD_END):
                    delimiter = next(g for g in (m.group(2), m.group(3), m.group(4), "")
                                     if g is not None)
                    doc = Heredoc(op_start=i, delimiter=delimiter,
                                  quoted=(m.group(2) is not None or m.group(3) is not None
                                          or "\\" in m.group(0)),
                                  strip_tabs=(m.group(1) == "-"))
                    pending.append(doc)
            emit("redir", op, i, i + len(op), doc)
            i += len(op)
        else:
            add(c, i)
            i += 1
    flush(n)
    return toks


def split_pipelines(toks: Sequence[Tok]) -> List[List[Segment]]:
    """Group tokens into pipelines of segments; redirections are paired with their target, and
    a here-document joins the segment of its redirection."""
    pipelines: List[List[Segment]] = []
    current: List[Segment] = []
    seg = Segment()
    pending: Optional[str] = None
    pending_doc: Optional[Heredoc] = None
    ops: List[str] = []
    for tok in toks:
        if tok.kind == "redir":
            pending = tok.text
            pending_doc = tok.heredoc
            continue
        if tok.kind == "word":
            if not seg.words and not seg.redirs:
                seg.lead_ops, ops = ops, []
            if pending is not None:
                seg.redirs.append((pending, tok.text))
                if pending_doc is not None:
                    seg.heredocs.append(pending_doc)
                pending = None
                pending_doc = None
            else:
                seg.words.append(tok)
            continue
        if seg.words or seg.redirs:
            seg.end_op = tok.text
            current.append(seg)
        seg = Segment()
        pending = None
        pending_doc = None
        ops.append(tok.text)
        if tok.text != "|":
            if current:
                pipelines.append(current)
            current = []
    if seg.words or seg.redirs:
        current.append(seg)
    if current:
        pipelines.append(current)
    return pipelines


# ---------------------------------------------------------------------------
# Command analysis
# ---------------------------------------------------------------------------

WORKTREE_WIDE = {".", "./", ":/", ":/*", "*", ":(top)", ":(top)."}
# A command name right after one of these words is an argument, not a command
# (`pnpm add rimraf`, `which rm`, `echo git push -f`).
NON_EXEC_PREVIOUS = {"which", "type", "man", "help", "whereis", "get-command", "gcm", "get-help",
                     "echo", "printf", "write-output", "write-host"}
# After `<package manager> <one of these>`, the following words are package names.
PACKAGE_MANAGERS = {"pnpm", "npm", "yarn", "bun", "pip", "pip3", "uv", "poetry", "pdm", "pipx",
                    "cargo", "go", "gem", "conda", "brew", "choco", "winget", "scoop"}
PACKAGE_NON_EXEC = {"add", "install", "i", "remove", "uninstall", "un", "view", "info", "why",
                    "show", "search", "outdated", "update", "upgrade", "up", "list", "ls"}
WRITE_REDIRECTS = {">", ">>", ">|", "&>", "&>>", ">&"}
LISTING_COMMANDS = {"get-childitem", "gci", "ls", "dir"}
REMOVE_COMMANDS = {"remove-item", "ri", "rm", "del", "erase", "rd", "rmdir"}
DB_CLIENTS = {"psql", "mysql", "mariadb", "sqlite3", "sqlcmd", "mongosh", "mongo", "duckdb",
              "clickhouse-client", "cockroach"}
SQL_DESTRUCTIVE_RE = re.compile(
    r"(?i)\b(?:drop\s+(?:table|database|schema)|truncate\s+(?:table\s+)?[\w.\"`]+)")
INLINE_DELETE_RE = re.compile(
    r"\brmtree\s*\(|\brimraf\b|\brmSync\s*\([^)]*recursive|\bremove_dir_all\b|"
    r"\bfs\.rm\s*\([^)]*recursive|\brmdir\s*\([^)]*recursive")
# Inline code that creates a link (pilot-auto-calibration A01-F56).
INLINE_LINK_RE = re.compile(
    r"\bos\.(?:sym)?link\s*\(|\b_winapi\.CreateJunction\b|\bfs\.(?:promises\.)?(?:sym)?"
    r"link(?:Sync)?\s*\(|\bDeno\.(?:sym)?link(?:Sync)?\s*\(|\.(?:symlink_to|hardlink_to)\s*\(|"
    r"\bmklink\b|\bCreate(?:SymbolicLink|HardLink)W?\b|\bCreateJunction\b")
GIT_ARG_LONG = {"--message", "--file", "--author", "--date", "--template", "--reuse-message",
                "--reedit-message", "--fixup", "--squash", "--cleanup", "--trailer",
                "--pathspec-from-file", "--source", "--exec", "--onto", "--strategy"}


def cmd_name(tok: Tok) -> Optional[str]:
    """Normalised command name of a word, or None when it cannot be a command."""
    text = tok.text
    if not text:
        return None
    if tok.quoted and "/" not in text and not text.lower().endswith(".exe"):
        return None
    name = text.rsplit("/", 1)[-1].lower()
    for suffix in (".exe", ".cmd", ".bat"):
        if name.endswith(suffix):
            name = name[:-len(suffix)]
    return name or None


def _texts(args: Sequence[Tok]) -> List[str]:
    return [a.text for a in args]


def short_flags(words: Sequence[str], arg_letters: str = "",
                arg_long: Sequence[str] = ()) -> set:
    """Letters of short-option bundles, skipping option arguments and quoted phrases."""
    letters: set = set()
    skip_next = False
    for word in words:
        if skip_next:
            skip_next = False
            continue
        if word == "--":
            break
        if word in arg_long or word in GIT_ARG_LONG:
            skip_next = True
            continue
        if not word.startswith("-") or word.startswith("--") or len(word) < 2:
            continue
        if any(ch.isspace() for ch in word) or word[1].isdigit():
            continue
        for idx, ch in enumerate(word[1:]):
            letters.add(ch)
            if ch in arg_letters:
                if idx == len(word) - 2:
                    skip_next = True  # the argument is the next word
                break
    return letters


def non_options(words: Sequence[str], arg_letters: str = "",
                arg_long: Sequence[str] = ()) -> List[str]:
    """Positional words (option arguments removed)."""
    out: List[str] = []
    skip_next = False
    after_dashdash = False
    for word in words:
        if skip_next:
            skip_next = False
            continue
        if after_dashdash:
            out.append(word)
            continue
        if word == "--":
            after_dashdash = True
            continue
        if word in arg_long or word in GIT_ARG_LONG:
            skip_next = True
            continue
        if word.startswith("-") and len(word) > 1 and not any(ch.isspace() for ch in word):
            if not word.startswith("--") and word[-1] in arg_letters and len(word) == 2:
                skip_next = True
            continue
        out.append(word)
    return out


def _long(words: Sequence[str]) -> set:
    return {w.split("=", 1)[0] for w in words if w.startswith("--")}


def long_options(words: Sequence[str], arg_letters: str = "",
                 arg_long: Sequence[str] = ()) -> List[str]:
    """Long options before `--` (without "=value"), skipping the arguments of options, so
    that `git commit -m --amend` does not read the message as an option."""
    out: List[str] = []
    skip_next = False
    for word in words:
        if skip_next:
            skip_next = False
            continue
        if word == "--":
            break
        if word in arg_long or word in GIT_ARG_LONG:
            out.append(word)
            skip_next = True
            continue
        if word.startswith("--"):
            out.append(word.split("=", 1)[0])
            continue
        if word.startswith("-") and len(word) > 1 and not any(ch.isspace() for ch in word) \
                and not word[1].isdigit():
            for idx, ch in enumerate(word[1:]):
                if ch in arg_letters:
                    skip_next = idx == len(word) - 2
                    break
    return out


def _has_long(options: Sequence[str], full: str, min_len: int) -> bool:
    """True when `full` or an unambiguous abbreviation git accepts (>= min_len chars) is set."""
    return any(len(o) >= min_len and full.startswith(o) for o in options)


def _is_head(word: str) -> bool:
    return word in ("HEAD", "@") or (IS_WINDOWS and word.lower() == "head")


# -- git ---------------------------------------------------------------------


def _git_push(rest: List[str], ctx: Ctx) -> Optional[str]:
    flags = short_flags(rest, "o")
    long = _long(rest)
    if long & {"--force", "--force-with-lease", "--force-if-includes", "--mirror"} or "f" in flags:
        return deny("git-push-force", "git push --force rewrites remote history")
    if "--delete" in long or "d" in flags:
        return deny("git-push-delete", "git push --delete removes a remote ref")
    positional = non_options(rest, "o")
    for ref in positional[1:]:
        if ref.startswith("+"):
            return deny("git-push-force", "git push with a '+' refspec force-updates a remote ref")
        if ref.startswith(":") and len(ref) > 1:
            return deny("git-push-delete", "git push with a ':<ref>' refspec deletes a remote ref")
    return None


def _git_reset(rest: List[str], ctx: Ctx) -> Optional[str]:
    if "--hard" in rest or _has_long(long_options(rest), "--hard", 4):
        return deny("git-reset-hard", "git reset --hard discards commits and uncommitted work")
    before = rest[:rest.index("--")] if "--" in rest else rest
    positional = non_options(before)
    if not positional or _is_head(positional[0]):
        return None  # index-only: unstage everything or the given paths
    if all(ctx.is_path_like(word) for word in positional):
        return None  # `git reset <paths>`: git reads existing paths as pathspecs
    return deny("git-reset-moves-branch",
                f"git reset {positional[0]} moves the branch to another commit (history "
                f"rewriting, also with --soft/--mixed/--keep/--merge); {HISTORY_ADVICE}; "
                f"`git restore --staged --source=<rev> -- <paths>` stages an old version "
                f"without moving the branch")


_CLEAN_ARG_LONG = ("--exclude",)


def _git_clean(rest: List[str], ctx: Ctx) -> Optional[str]:
    """Every git clean except the dry run: untracked files (.env, data/, .harden/ with the run
    marker) are exactly what git cannot restore (refactoring-safety T09-F06; llm-refactoring
    T10-F18 lists git clean among the commands to deny)."""
    flags = short_flags(rest, "e", _CLEAN_ARG_LONG)
    longs = long_options(rest, "e", _CLEAN_ARG_LONG)
    if "n" in flags or _has_long(longs, "--dry-run", 3):
        return None
    if "f" in flags or _has_long(longs, "--force", 3):
        return deny("git-clean-force", "git clean -f deletes untracked files that git cannot "
                                       "restore")
    route = owner_route(ctx.active, "ask the user",
                        f"record the files as {OWNER_ITEM} (an autonomous run asks nobody)")
    return deny("git-clean", "git clean deletes untracked files that git cannot restore (with "
                             "clean.requireForce=false no -f is needed; -i can confirm a "
                             f"deletion); use `git clean -n` to list them and {route}")


def _git_checkout(rest: List[str], ctx: Ctx) -> Optional[str]:
    flags = short_flags(rest, "bB")
    if "f" in flags or "--force" in rest:
        return deny("git-checkout-force", "git checkout --force discards local changes")
    if "B" in flags:
        return deny("git-checkout-reset-branch", "git checkout -B resets an existing branch")
    if any(p in WORKTREE_WIDE for p in non_options(rest, "bB")):
        return deny("git-checkout-worktree", "git checkout of the whole tree (. or :/) discards "
                                             "every uncommitted change")
    return None


def _git_switch(rest: List[str], ctx: Ctx) -> Optional[str]:
    flags = short_flags(rest, "cC")
    long = _long(rest)
    if "f" in flags or long & {"--force", "--discard-changes"}:
        return deny("git-switch-discard", "git switch --discard-changes/--force discards local "
                                          "changes")
    if "C" in flags or "--force-create" in long:
        return deny("git-switch-reset-branch", "git switch -C resets an existing branch")
    return None


def _git_restore(rest: List[str], ctx: Ctx) -> Optional[str]:
    flags = short_flags(rest, "s", ("--source",))
    staged = "S" in flags or "--staged" in rest
    worktree = "W" in flags or "--worktree" in rest
    if staged and not worktree:
        return None
    if any(p in WORKTREE_WIDE for p in non_options(rest, "s", ("--source",))):
        return deny("git-restore-worktree", "git restore of the whole tree (. or :/) discards "
                                            "every uncommitted change")
    return None


def _git_rebase(rest: List[str], ctx: Ctx) -> Optional[str]:
    if "--abort" in rest or "--show-current-patch" in rest:
        return None
    return deny("git-rebase", "git rebase rewrites history")


def _git_pull(rest: List[str], ctx: Ctx) -> Optional[str]:
    for word in rest:
        if word == "--rebase" or (word.startswith("--rebase=")
                                  and word.split("=", 1)[1].lower() not in ("false", "no", "0")):
            return deny("git-pull-rebase", "git pull --rebase rewrites local history")
    if "r" in short_flags(rest):
        return deny("git-pull-rebase", "git pull -r rewrites local history")
    return None


def _git_history_tool(rest: List[str], ctx: Ctx) -> Optional[str]:
    return deny("git-filter-history", "git filter-branch / filter-repo rewrites history")


def _git_branch(rest: List[str], ctx: Ctx) -> Optional[str]:
    flags = short_flags(rest, "u")
    long = _long(rest)
    deleting = "d" in flags or "--delete" in long
    if "D" in flags:
        return deny("git-branch-force-delete", "git branch -D force-deletes a branch")
    if deleting and ("f" in flags or "--force" in long):
        return deny("git-branch-force-delete", "git branch --delete --force force-deletes a "
                                               "branch")
    if deleting and not ("r" in flags or "--remotes" in long):
        targets = non_options(rest, "u")
        if targets:
            protected = {_fold(b) for b in ctx.protected_branches()}
            for target in targets:
                if _fold(target) in protected:
                    return deny("git-branch-delete-protected",
                                f"git branch -d {target} deletes the run branch or the base "
                                f"branch (PC-20: no deleting branches during the run)")
    if "f" in flags or "--force" in long:
        return deny("git-branch-force", "git branch --force moves an existing branch")
    if "M" in flags or "C" in flags:
        return deny("git-branch-overwrite", "git branch -M/-C overwrites an existing branch")
    return None


def _git_stash(rest: List[str], ctx: Ctx) -> Optional[str]:
    positional = non_options(rest)
    if positional and positional[0] in ("drop", "clear"):
        return deny("git-stash-drop", f"git stash {positional[0]} deletes stashed work")
    return None


def _git_commit(rest: List[str], ctx: Ctx) -> Optional[str]:
    if "n" in short_flags(rest, "mFCctS"):
        return deny("git-no-verify", "git commit -n (--no-verify) skips the repository's hooks")
    if _has_long(long_options(rest, "mFCctS"), "--amend", 4):
        return deny("git-commit-amend", f"git commit --amend rewrites the last commit; make a "
                                        f"new commit instead ({HISTORY_ADVICE})")
    return None


def _git_reflog(rest: List[str], ctx: Ctx) -> Optional[str]:
    positional = non_options(rest)
    if positional and positional[0] in ("expire", "delete"):
        return deny("git-reflog-destroy", f"git reflog {positional[0]} destroys the recovery log")
    return None


_CONFIG_ARG_LONG = ("--file", "--blob", "--type", "--default", "--comment", "--value")


def _config_key_reason(key: str, how: str) -> Optional[str]:
    """Reason to refuse setting a git configuration key: an alias can run any shell command
    under another name (`git x` -> `!rm -rf ...`), and clean.requireForce=false makes a plain
    `git clean` delete untracked files."""
    lowered = key.strip().lower()
    if lowered.startswith("alias."):
        return deny("git-alias", f"{how} sets the git alias {key.split('=', 1)[0]}: an alias can "
                                 f"run any command under another name")
    if lowered.split("=", 1)[0] == "clean.requireforce":
        return deny("git-clean-requireforce", f"{how} sets clean.requireForce, which lets "
                                              f"`git clean` delete untracked files without -f")
    if lowered.startswith("core.hookspath"):
        return deny("git-hookspath", f"{how} sets core.hooksPath, which disables or replaces "
                                     f"the repository's git hooks")
    return None


def _git_config(rest: List[str], ctx: Ctx) -> Optional[str]:
    lowered = [w.lower() for w in rest]
    readers = {"--get", "--get-all", "--get-regexp", "--list", "-l", "--show-origin", "get",
               "list", "--unset", "--unset-all", "unset", "--remove-section"}
    if readers & set(lowered):
        return None
    positional = non_options(rest, "f", _CONFIG_ARG_LONG)
    setting = bool(positional) and positional[0].lower() in ("set", "add")
    if setting:
        positional = positional[1:]
    if positional and (setting or len(positional) >= 2):  # `git config <key>` alone reads it
        reason = _config_key_reason(positional[0], "git config")
        if reason:
            return reason
    if any(w.startswith("core.hookspath") for w in lowered):
        return deny("git-hookspath", "git config core.hooksPath disables or replaces the "
                                     "repository's git hooks")
    return None


def _git_rm(rest: List[str], ctx: Ctx) -> Optional[str]:
    return ctx.delete_reason(non_options(rest), "git rm", recursive=True)


def _git_mv(rest: List[str], ctx: Ctx) -> Optional[str]:
    return ctx.delete_reason(non_options(rest), "git mv")


_TAG_ARG_LONG = ("--message", "--file", "--local-user", "--points-at", "--contains",
                 "--no-contains", "--merged", "--no-merged")


def _git_tag(rest: List[str], ctx: Ctx) -> Optional[str]:
    flags = short_flags(rest, "mFu", _TAG_ARG_LONG)
    longs = long_options(rest, "mFu", _TAG_ARG_LONG)
    if "d" in flags or _has_long(longs, "--delete", 5):
        return deny("git-tag-delete", "git tag -d deletes a tag (PC-20: no deleting branches or "
                                      "tags during the run)")
    if "f" in flags or _has_long(longs, "--force", 5):
        return deny("git-tag-force", "git tag -f replaces an existing tag; use a new tag name")
    return None


def _git_update_ref(rest: List[str], ctx: Ctx) -> Optional[str]:
    if "d" in short_flags(rest, "m"):
        return deny("git-update-ref-delete", "git update-ref -d deletes a ref (a branch or a tag)")
    if "--stdin" in long_options(rest, "m"):
        return deny("git-update-ref-stdin", "git update-ref --stdin can delete or move refs")
    if len(non_options(rest, "m")) >= 2:
        return deny("git-update-ref-move", f"git update-ref <ref> <value> moves a ref directly, "
                                           f"without git's safety checks ({HISTORY_ADVICE})")
    return None


def _git_worktree(rest: List[str], ctx: Ctx) -> Optional[str]:
    positional = [w for w in rest if not w.startswith("-")]
    if positional and positional[0] == "remove":
        return deny("git-worktree-remove",
                    "git worktree remove deletes through links: on Git for Windows 2.51.1 it "
                    "deleted the files inside a directory junction's target; remove a scratch "
                    "worktree with run_state.py scratch-remove <path>, which never follows a "
                    "link (protocol-preflight PF-21)")
    return None


GIT_SUBCOMMANDS: Dict[str, Callable[[List[str], Ctx], Optional[str]]] = {
    "push": _git_push, "reset": _git_reset, "clean": _git_clean, "checkout": _git_checkout,
    "switch": _git_switch, "restore": _git_restore, "rebase": _git_rebase, "pull": _git_pull,
    "filter-branch": _git_history_tool, "filter-repo": _git_history_tool,
    "branch": _git_branch, "stash": _git_stash, "commit": _git_commit, "reflog": _git_reflog,
    "config": _git_config, "rm": _git_rm, "mv": _git_mv, "tag": _git_tag,
    "update-ref": _git_update_ref, "worktree": _git_worktree,
}


def _handle_git(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    words = _texts(args)
    i = 0
    while i < len(words):
        word = words[i]
        if word in ("-c", "--config-env") and i + 1 < len(words):
            if re.match(r"(?i)core\.hookspath=", words[i + 1]):
                return deny("git-hookspath", "git -c core.hooksPath=... disables the "
                                             "repository's git hooks")
            reason = _config_key_reason(words[i + 1], f"git {word}")
            if reason:
                return reason
            i += 2
            continue
        if word.startswith("--config-env="):
            reason = _config_key_reason(word.split("=", 1)[1], "git --config-env")
            if reason:
                return reason
            i += 1
            continue
        if word in ("-C", "--git-dir", "--work-tree", "--namespace", "--super-prefix"):
            i += 2
            continue
        if word.startswith("-"):
            i += 1
            continue
        break
    if i >= len(words):
        return None
    sub = words[i]
    rest = words[i + 1:]
    if "--no-verify" in rest:
        return deny("git-no-verify", f"git {sub} --no-verify skips the repository's hooks")
    if ctx.report_only and sub in REPORT_ONLY_GIT:
        reason = _report_only_git_reason(sub, rest)
        if reason:
            return reason
    handler = GIT_SUBCOMMANDS.get(sub)
    return handler(rest, ctx) if handler else None


def _report_only_git_reason(sub: str, rest: List[str]) -> Optional[str]:
    """Refuse git subcommands that record or apply changes in a report-only run, except their
    --abort/--quit and dry-run forms."""
    if any(w in ("--abort", "--quit") for w in rest):
        return None
    if sub == "add" and ("n" in short_flags(rest) or "--dry-run" in rest):
        return None
    if sub == "commit" and "--dry-run" in rest:
        return None
    if sub == "apply" and "--apply" not in rest and any(
            w in ("--check", "--stat", "--numstat", "--summary") for w in rest):
        return None
    return deny("report-only-edit", f"git {sub} records or applies changes, and this run is "
                                    f"report-only (mode report-only in .harden/active)")


# -- deletion ----------------------------------------------------------------


def _ps_params(args: Sequence[str]) -> Tuple[List[str], List[str], Dict[str, str]]:
    """(parameter names, positional words, value by parameter) for PowerShell-style args."""
    value_params = ("path", "literalpath", "filter", "include", "exclude", "credential",
                    "stream", "destination", "filepath", "value", "encoding", "inputobject")
    params: List[str] = []
    positional: List[str] = []
    values: Dict[str, str] = {}
    i = 0
    while i < len(args):
        word = args[i]
        if word.startswith("-") and len(word) > 1 and not re.match(r"^-\d", word):
            name = word[1:].split(":", 1)[0].lower()
            params.append(name)
            takes_value = any(v.startswith(name) for v in value_params) and not \
                "recurse".startswith(name) and not "force".startswith(name)
            if takes_value and ":" not in word and i + 1 < len(args):
                full = next(v for v in value_params if v.startswith(name))
                values[full] = args[i + 1]
                i += 2
                continue
            i += 1
            continue
        positional.append(word)
        i += 1
    return params, positional, values


def _has_ps_switch(params: Sequence[str], full: str) -> bool:
    return any(p and full.startswith(p) for p in params)


def _handle_remove_item(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                        depth: int) -> Optional[str]:
    params, positional, values = _ps_params(_texts(args))
    if _has_ps_switch(params, "whatif") and not any(p == "w" for p in params):
        return None
    if _has_ps_switch(params, "recurse"):
        return deny("remove-item-recurse",
                    f"{name} -Recurse deletes a directory tree without confirmation")
    targets = positional + [v for k, v in values.items() if k in ("path", "literalpath")]
    return ctx.delete_reason(targets, name)


def _cmd_slash_s(words: Sequence[str]) -> bool:
    for word in words:
        if word.startswith("/") and len(word) <= 8:
            parts = [p.lower() for p in word.split("/") if p]
            if "s" in parts:
                return True
    return False


def _handle_rm(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    if shell == "powershell":
        return _handle_remove_item(name, args, shell, ctx, depth)
    words = _texts(args)
    flags: set = set()
    long: set = set()
    targets: List[str] = []
    options_done = False
    for word in words:
        if not options_done and word == "--":
            options_done = True
        elif not options_done and word.startswith("--"):
            long.add(word)
        elif not options_done and word.startswith("-") and len(word) > 1:
            flags.update(word[1:])
        else:
            targets.append(word)
    recursive = bool(flags & {"r", "R"}) or "--recursive" in long
    force = "f" in flags or "--force" in long
    if recursive and force:
        shown = " ".join(targets[:3]) or "(no target)"
        return deny("rm-recursive-force", f"rm -rf {shown} deletes a tree without confirmation")
    return ctx.delete_reason(targets, name, recursive=recursive)


def _handle_rmdir(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                  depth: int) -> Optional[str]:
    words = _texts(args)
    if _cmd_slash_s(words):
        return deny("rmdir-recursive", f"{name} /s deletes a directory tree")
    if shell == "powershell":
        return _handle_remove_item(name, args, shell, ctx, depth)
    return None


def _handle_del(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    words = _texts(args)
    if _cmd_slash_s(words):
        return deny("del-recursive", f"{name} /s deletes files in every subdirectory")
    if shell == "powershell":
        return _handle_remove_item(name, args, shell, ctx, depth)
    return ctx.delete_reason([w for w in words if not w.startswith("/")], name)


def _handle_unlink(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                   depth: int) -> Optional[str]:
    return ctx.delete_reason([w for w in _texts(args) if not w.startswith("-")], name)


def _handle_find(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    if "-delete" in _texts(args):
        return deny("find-delete", "find -delete removes every matching file without a listing "
                                   "first")
    return None


def _handle_rimraf(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                   depth: int) -> Optional[str]:
    return deny("rimraf", "rimraf deletes a directory tree without confirmation")


# -- in-place edits and writes -----------------------------------------------


def _handle_sed(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    words = _texts(args)
    inplace = False
    for word in words:
        if word == "--":
            break
        if word.startswith("--in-place"):
            inplace = True
        elif word.startswith("-") and not word.startswith("--") and len(word) > 1 \
                and not any(ch.isspace() for ch in word):
            for ch in word[1:]:
                if ch == "i":
                    inplace = True
                    break
                if ch in "ef":
                    break
    if not inplace:
        return None
    return ctx.write_reason([w for w in words if not w.startswith("-")], "sed -i")


def _handle_perl(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                 depth: int) -> Optional[str]:
    words = _texts(args)
    inplace = False
    for word in words:
        if word.startswith("-") and not word.startswith("--") and len(word) > 1 \
                and not any(ch.isspace() for ch in word):
            for ch in word[1:]:
                if ch == "i":
                    inplace = True
                    break
                if ch in "eE":
                    break
    if not inplace:
        return None
    return ctx.write_reason([w for w in words if not w.startswith("-")], "perl -i")


def _handle_tee(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    words = _texts(args)
    if name == "tee-object":
        params, positional, values = _ps_params(words)
        return ctx.write_reason(positional + list(values.values()), "Tee-Object")
    return ctx.write_reason([w for w in words if not w.startswith("-")], "tee")


def _handle_content_writer(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                           depth: int) -> Optional[str]:
    params, positional, values = _ps_params(_texts(args))
    targets = [v for k, v in values.items() if k in ("path", "literalpath", "filepath")]
    targets += positional[:1]
    return ctx.write_reason(targets, name)


def _copy_destinations(sources: Sequence[str], dest: str, ctx: Ctx) -> List[str]:
    targets = [dest]
    for abs_dest in ctx.expand(dest):
        if os.path.isdir(abs_dest):
            targets = [abs_dest.rstrip("/") + "/" + os.path.basename(s.rstrip("/"))
                       for s in sources]
    return targets


def _handle_copy(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    words = _texts(args)
    if shell == "powershell" or name in ("copy-item", "cpi"):
        params, positional, values = _ps_params(words)
        dest = values.get("destination") or (positional[1] if len(positional) > 1 else None)
        sources = [values["path"]] if "path" in values else positional[:1]
    else:
        positional = [w for w in words if not w.startswith("-")]
        if len(positional) < 2:
            return None
        dest, sources = positional[-1], positional[:-1]
    if not dest:
        return None
    return ctx.write_reason(_copy_destinations(sources, dest, ctx), name)


def _handle_move(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    words = _texts(args)
    if shell == "powershell" or name in ("move-item", "mi"):
        params, positional, values = _ps_params(words)
        dest = values.get("destination") or (positional[1] if len(positional) > 1 else None)
        sources = [values["path"]] if "path" in values else positional[:1]
    else:
        positional = [w for w in words if not w.startswith("-")]
        if len(positional) < 2:
            return None
        dest, sources = positional[-1], positional[:-1]
    reason = ctx.delete_reason(sources, name)
    if reason or not dest:
        return reason
    return ctx.write_reason(_copy_destinations(sources, dest, ctx), name)


# -- nested shells, inline code, infrastructure ------------------------------


def _handle_posix_shell(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                        depth: int) -> Optional[str]:
    words = _texts(args)
    for idx, word in enumerate(words):
        if re.match(r"^-[a-zA-Z]*c[a-zA-Z]*$", word) and idx + 1 < len(words):
            return analyse_command(words[idx + 1], "bash", ctx, depth + 1)
    return None


def _handle_powershell_exe(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                           depth: int) -> Optional[str]:
    words = _texts(args)
    for idx, word in enumerate(words):
        if not word.startswith("-") or len(word) < 2:
            continue
        param = word[1:].lower()
        if "encodedcommand".startswith(param) or param == "ec":
            if idx + 1 < len(words):
                try:
                    decoded = base64.b64decode(words[idx + 1], validate=True).decode("utf-16-le")
                except (ValueError, UnicodeDecodeError):
                    continue
                return analyse_command(decoded, "powershell", ctx, depth + 1)
        if "command".startswith(param):
            return analyse_command(" ".join(words[idx + 1:]), "powershell", ctx, depth + 1)
        if "file".startswith(param):
            return None
    # Windows PowerShell 5.1 runs positional words as a command: analyse from the first one.
    for idx, word in enumerate(words):
        if not word.startswith("-"):
            return analyse_command(" ".join(words[idx:]), "powershell", ctx, depth + 1)
    return None


def _handle_cmd_exe(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                    depth: int) -> Optional[str]:
    words = _texts(args)
    for idx, word in enumerate(words):
        if word.lower() in ("/c", "/k", "//c", "//k"):
            return analyse_command(" ".join(words[idx + 1:]), "cmd", ctx, depth + 1)
    return None


def _handle_eval(name: str, args: Sequence[Tok], shell: str, ctx: Ctx, depth: int) -> Optional[str]:
    inner_shell = "powershell" if name in ("iex", "invoke-expression") else "bash"
    return analyse_command(" ".join(_texts(args)), inner_shell, ctx, depth + 1)


def _handle_inline_code(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                        depth: int) -> Optional[str]:
    words = _texts(args)
    for idx, word in enumerate(words):
        if word in ("-c", "-e", "--eval", "-p", "--print", "eval") and idx + 1 < len(words):
            if INLINE_DELETE_RE.search(words[idx + 1]):
                return deny("inline-delete", f"{name} inline code deletes a directory tree")
            if INLINE_LINK_RE.search(words[idx + 1]):
                return deny("link-create", f"{name} inline code creates a link: {LINK_ADVICE}")
    return None


def _handle_terraform(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                      depth: int) -> Optional[str]:
    positional = [w for w in _texts(args) if not w.startswith("-")]
    if positional and positional[0] in ("apply", "destroy"):
        return deny("terraform-apply", f"{name} {positional[0]} changes live infrastructure")
    return None


def _handle_kubectl(name: str, args: Sequence[Tok], shell: str, ctx: Ctx,
                    depth: int) -> Optional[str]:
    positional = [w for w in _texts(args) if not w.startswith("-")]
    if positional and positional[0] == "delete":
        return deny("kubectl-delete", "kubectl delete removes live resources")
    return None


# ---------------------------------------------------------------------------
# Links (pilot-auto-calibration A01-F56)
# ---------------------------------------------------------------------------

LINK_ADVICE = ("a link in a scratch copy lets tests write through it into the repository, and "
               "a recursive delete that follows it destroys its target; give a worktree its "
               "own dependencies (protocol-preflight PF-21)")
LINK_HANDLER_NAMES = frozenset({"mklink", "ln", "junction", "junction64", "new-item", "ni",
                                "fsutil"})
_NEW_ITEM_TYPE_PARAM_RE = re.compile(
    r"(?i)^-(?:i(?:t(?:e(?:m(?:t(?:y(?:pe?)?)?)?)?)?)?|type)$")
_LINK_ITEM_TYPES = ("symboliclink", "junction", "hardlink")
_PLAIN_ITEM_TYPES = ("directory", "container", "file")


def _at_command_position(words: Sequence[Tok], idx: int) -> bool:
    """True when words[idx] is where the shell reads a command: the segment's first word after
    assignments, or right after command, builtin, env, xargs, sudo, nohup, time, exec or
    nice."""
    first = 0
    while first < len(words) and _ASSIGN_RE.match(words[first].text):
        first += 1
    if idx == first:
        return True
    # Skip the options, numbers and assignments a wrapper takes (`timeout 60 ln`, `nice -n 5
    # ln`, `env -i ln`), then look for a word that starts a command (review round 4).
    j = idx - 1
    while j >= 0 and words[j].text not in _EXEC_OPTIONS and (
            words[j].text.startswith("-") or _WRAPPER_VALUE_RE.match(words[j].text) or
            _ASSIGN_RE.match(words[j].text)):
        j -= 1
    if j < 0:
        return False
    return words[j].text in _EXEC_OPTIONS or cmd_name(words[j]) in WRAPPER_COMMANDS or \
        cmd_name(words[j]) in _MORE_WRAPPERS


# Words after which the next word is a command, besides WRAPPER_COMMANDS: find's -exec family
# and wrappers that only matter here (review round 4: `find . -exec ln -s`, `busybox ln`).
_EXEC_OPTIONS = frozenset({"-exec", "-execdir", "-ok", "-okdir"})
_MORE_WRAPPERS = frozenset({"timeout", "busybox", "stdbuf", "setsid", "doas", "ionice", "chrt",
                            "taskset", "unbuffer", "watch", "flock"})
_WRAPPER_VALUE_RE = re.compile(r"^\d+(\.\d+)?[smhd]?$")


def _link_item_type(value: str) -> bool:
    value = value.strip().strip("'\"").lower()
    return bool(value) and any(t.startswith(value) for t in _LINK_ITEM_TYPES) and \
        not any(t.startswith(value) for t in _PLAIN_ITEM_TYPES)


def _handle_link_create(name: str, args: Sequence[Tok], shell: str, ctx: "Ctx",
                        depth: int) -> Optional[str]:
    return deny("link-create", f"{name} creates a link: {LINK_ADVICE}")


def _handle_new_item(name: str, args: Sequence[Tok], shell: str, ctx: "Ctx",
                     depth: int) -> Optional[str]:
    words = _texts(args)
    for idx, word in enumerate(words):
        param, colon, attached = word.partition(":")
        if not _NEW_ITEM_TYPE_PARAM_RE.match(param):
            continue
        value = attached if colon else (words[idx + 1] if idx + 1 < len(words) else "")
        if _link_item_type(value):
            return deny("link-create", f"{name} -ItemType {value} creates a link: "
                                       f"{LINK_ADVICE}")
    return None


def _handle_fsutil(name: str, args: Sequence[Tok], shell: str, ctx: "Ctx",
                   depth: int) -> Optional[str]:
    positional = [w for w in _texts(args) if not w.startswith(("-", "/"))]
    if positional and positional[0].lower() == "hardlink":
        return deny("link-create", f"fsutil hardlink creates a hard link: {LINK_ADVICE}")
    return None


def _cp_link_reason(args: Sequence[Tok]) -> Optional[str]:
    """cp -s / -l (or --symbolic-link / --link) makes links instead of copies."""
    for word in _texts(args):
        if word in ("--symbolic-link", "--link"):
            return deny("link-create", f"cp {word} creates links: {LINK_ADVICE}")
        if word.startswith("-") and not word.startswith("--") and \
                any(ch in word[1:] for ch in "sl"):
            return deny("link-create", f"cp {word} creates links: {LINK_ADVICE}")
    return None


Handler = Callable[[str, Sequence[Tok], str, Ctx, int], Optional[str]]
HANDLERS: Dict[str, Handler] = {
    "git": _handle_git,
    "rm": _handle_rm, "unlink": _handle_unlink,
    "rmdir": _handle_rmdir, "rd": _handle_rmdir,
    "del": _handle_del, "erase": _handle_del,
    "remove-item": _handle_remove_item, "ri": _handle_remove_item,
    "find": _handle_find, "rimraf": _handle_rimraf,
    "sed": _handle_sed, "perl": _handle_perl,
    "tee": _handle_tee, "tee-object": _handle_tee,
    "set-content": _handle_content_writer, "add-content": _handle_content_writer,
    "out-file": _handle_content_writer, "clear-content": _handle_content_writer,
    "cp": _handle_copy, "copy": _handle_copy, "copy-item": _handle_copy, "cpi": _handle_copy,
    "mv": _handle_move, "move": _handle_move, "move-item": _handle_move, "mi": _handle_move,
    "bash": _handle_posix_shell, "sh": _handle_posix_shell, "zsh": _handle_posix_shell,
    "dash": _handle_posix_shell, "ksh": _handle_posix_shell,
    "pwsh": _handle_powershell_exe, "powershell": _handle_powershell_exe,
    "cmd": _handle_cmd_exe,
    "eval": _handle_eval, "iex": _handle_eval, "invoke-expression": _handle_eval,
    "python": _handle_inline_code, "python3": _handle_inline_code, "py": _handle_inline_code,
    "node": _handle_inline_code, "deno": _handle_inline_code, "bun": _handle_inline_code,
    "terraform": _handle_terraform, "tofu": _handle_terraform,
    "kubectl": _handle_kubectl,
    "mklink": _handle_link_create, "ln": _handle_link_create,
    "junction": _handle_link_create, "junction64": _handle_link_create,
    "new-item": _handle_new_item, "ni": _handle_new_item, "fsutil": _handle_fsutil,
}

# Snapshot regeneration during a hardening pass (refactoring-safety T09-F05).
_SNAPSHOT_UPDATE_FLAGS = {"--updateSnapshot", "--update-snapshot", "--update-snapshots",
                          "--snapshot-update"}
_JS_TEST_RUNNERS = {"jest", "vitest"}
_PACKAGE_RUNNERS = {"pnpm", "npm", "yarn", "npx", "bun", "bunx"}


def _snapshot_update_reason(words: Sequence[Tok]) -> Optional[str]:
    """Reason when a segment regenerates snapshot/golden files (quoted text is ignored)."""
    plain = [w.text for w in words if not w.quoted]
    names = [cmd_name(w) or "" for w in words]
    for text in plain:
        if text.split("=", 1)[0] in _SNAPSHOT_UPDATE_FLAGS:
            return deny("snapshot-update", "updating snapshots (--updateSnapshot / "
                                           "--snapshot-update) rewrites the oracle")
        match = re.match(r"^INSTA_UPDATE=(\S+)$", text)
        if match and match.group(1).lower() not in ("no", "0", "false"):
            return deny("snapshot-update", "INSTA_UPDATE writes snapshot files")
    if "insta" in names:
        tail = [w.text for w in words[names.index("insta") + 1:]]
        if tail[:1] == ["accept"] or "--accept" in tail:
            return deny("snapshot-update", "cargo insta accept rewrites snapshot files")
    runner = any(n in _JS_TEST_RUNNERS for n in names) or (
        bool(names) and names[0] in _PACKAGE_RUNNERS
        and any(t in ("test", "run") for t in plain[1:3]))
    if runner and ("-u" in plain or "--update" in plain):
        return deny("snapshot-update", "updating snapshots (-u) rewrites the oracle")
    return None


def _package_argument_start(words: Sequence[Tok]) -> int:
    """Index after which words are package names (`pnpm add -D rimraf`), else len(words)."""
    seen_manager = False
    for idx, word in enumerate(words):
        name = cmd_name(word)
        if name in PACKAGE_MANAGERS:
            seen_manager = True
        elif seen_manager and not word.text.startswith("-") and word.text in PACKAGE_NON_EXEC:
            return idx + 1
    return len(words)


# -- package installs (eval-v1-calibration E01-F10) ----------------------------


def _w(text: str) -> FrozenSet[str]:
    return frozenset(text.split())


@dataclass
class PkgSpec:
    """How one package manager spells the commands that add, remove or update packages.

    install: subcommands that change packages; runners: subcommands that run another command
    (the words after them are checked as a command); nested: second-level install
    subcommands (`uv pip install`); global_subs: first-level subcommands whose install forms
    act on the user account; dir_opts: options naming the directory the command acts in;
    path_opts: other options naming a place it writes to; value_opts: other options that
    take a value; known: other subcommands (to tell a subcommand from an option's value);
    walk: manifest names whose nearest ancestor directory is the project the tool edits, by
    subcommand ("" = default)."""

    install: FrozenSet[str]
    runners: FrozenSet[str] = frozenset()
    nested: Dict[str, FrozenSet[str]] = field(default_factory=dict)
    nested_runners: Dict[str, FrozenSet[str]] = field(default_factory=dict)
    global_subs: FrozenSet[str] = frozenset()
    dir_opts: FrozenSet[str] = frozenset()
    path_opts: FrozenSet[str] = frozenset()
    value_opts: FrozenSet[str] = frozenset()
    known: FrozenSet[str] = frozenset()
    walk: Dict[str, Tuple[str, ...]] = field(default_factory=dict)
    js: bool = False              # -g may sit in a short-option bundle (-gD)
    bare_install: bool = False    # the manager alone installs (`yarn`)
    always_global: bool = False   # every install form acts on the user account (pipx)
    prefix_is_target: bool = False  # a dir option is used as is, without walking up (npm)
    takes_value: FrozenSet[str] = field(init=False)
    first_level: FrozenSet[str] = field(init=False)

    def __post_init__(self) -> None:
        self.takes_value = self.dir_opts | self.path_opts | self.value_opts
        self.first_level = (self.install | self.runners | frozenset(self.nested)
                            | frozenset(self.nested_runners) | self.global_subs | self.known)


PKG_SPECS: Dict[str, PkgSpec] = {
    "npm": PkgSpec(
        install=_w("install i in ins inst insta instal isnt isnta isntal isntall add ci "
                   "clean-install ic install-clean isntall-clean uninstall un unlink remove rm r "
                   "update up upgrade udpate"),
        runners=_w("exec x"),
        dir_opts=_w("--prefix -C"),
        value_opts=_w("--registry --cache --userconfig --globalconfig --workspace -w --loglevel "
                      "--location --tag --omit --include --save-prefix --install-strategy "
                      "--before --otp"),
        known=_w("run run-script test t ls list view info show why explain outdated audit pack "
                 "publish init create config help root bin prefix"),
        walk={"": ("package.json", "node_modules")}, js=True, prefix_is_target=True),
    "pnpm": PkgSpec(
        install=_w("add install i remove rm uninstall un update up upgrade"),
        runners=_w("dlx exec"),
        dir_opts=_w("--dir -C --prefix"),
        path_opts=_w("--modules-dir --virtual-store-dir"),
        value_opts=_w("--filter -F --reporter --registry --loglevel --store-dir --global-dir "
                      "--config --workspace-concurrency --resolution-mode"),
        known=_w("run test t ls list why outdated audit pack publish init create store env root "
                 "bin config licenses"),
        walk={"": ("package.json",)}, js=True),
    "yarn": PkgSpec(
        install=_w("add install remove upgrade up"),
        runners=_w("dlx exec"),
        nested={"global": _w("add remove upgrade upgrade-interactive")},
        global_subs=_w("global"),
        dir_opts=_w("--cwd"),
        path_opts=_w("--modules-folder"),
        value_opts=_w("--registry --network-timeout --mutex --cache-folder --global-folder "
                      "--link-folder"),
        known=_w("run test why list info outdated audit pack publish init create config "
                 "workspace workspaces bin cache"),
        walk={"": ("package.json",)}, js=True, bare_install=True),
    "bun": PkgSpec(
        install=_w("add a install i remove rm update"),
        runners=_w("x"),
        dir_opts=_w("--cwd"),
        value_opts=_w("--registry --backend --config --cache-dir"),
        known=_w("run test build pm init create link outdated publish upgrade"),
        walk={"": ("package.json",)}, js=True),
    "pip": PkgSpec(
        install=_w("install uninstall"),
        path_opts=_w("--target -t --prefix --root --src"),
        value_opts=_w("-r --requirement -c --constraint -e --editable -i --index-url "
                      "--extra-index-url -f --find-links --python --platform --python-version "
                      "--implementation --abi --upgrade-strategy -C --config-settings "
                      "--global-option --log --cache-dir --proxy --timeout --retries "
                      "--trusted-host --progress-bar --root-user-action --report --no-binary "
                      "--only-binary"),
        known=_w("list show freeze download wheel check config cache index inspect hash debug "
                 "help")),
    "uv": PkgSpec(
        install=_w("add remove"),
        runners=_w("run"),
        nested={"pip": _w("install uninstall sync"), "tool": _w("install uninstall upgrade")},
        nested_runners={"tool": _w("run")},
        global_subs=_w("tool"),
        dir_opts=_w("--directory --project"),
        path_opts=_w("--target --prefix --script"),
        value_opts=_w("--python -p --index-url -i --extra-index-url --index --default-index -r "
                      "--requirements --requirement -c --constraint --constraints -e --editable "
                      "--group --optional --extra --package --config-file --cache-dir -C "
                      "--config-setting --with --from --color --python-platform --rev --tag "
                      "--branch --bounds --marker"),
        known=_w("sync lock init venv tree export python cache self build publish version help "
                 "format"),
        walk={"add": ("pyproject.toml",), "remove": ("pyproject.toml",),
              "pip install": (".venv",), "pip uninstall": (".venv",), "pip sync": (".venv",)}),
    "cargo": PkgSpec(
        install=_w("add remove rm install uninstall"),
        dir_opts=_w("-C"),
        path_opts=_w("--manifest-path"),
        value_opts=_w("--root -p --package -F --features --rename --registry --git --branch "
                      "--tag --rev --path --version --vers --index -j --jobs --target --profile "
                      "--config -Z --color --target-dir --bin --example"),
        known=_w("build b check c test t run r clippy fmt doc d new init search tree update "
                 "bench clean metadata fix publish audit deny machete udeps insta nextest"),
        walk={"add": ("Cargo.toml",), "remove": ("Cargo.toml",), "rm": ("Cargo.toml",)}),
    "poetry": PkgSpec(
        install=_w("add remove"),
        runners=_w("run"),
        nested={"self": _w("add remove install update lock sync")},
        global_subs=_w("self"),
        dir_opts=_w("-C --directory -P --project"),
        value_opts=_w("-G --group -E --extras --source --python --markers"),
        known=_w("install update lock sync build publish check show init new env config "
                 "version export search shell cache source"),
        walk={"": ("pyproject.toml",)}),
    "pipx": PkgSpec(
        install=_w("install install-all inject uninstall uninstall-all upgrade upgrade-all "
                   "reinstall reinstall-all upgrade-shared"),
        runners=_w("run"),
        value_opts=_w("--python --spec --pip-args --index-url --suffix"),
        known=_w("list environment completions ensurepath runpip interpreter"),
        always_global=True),
}
# Flags that send an install to the user account or the system instead of the project.
PKG_GLOBAL_FLAGS = _w("-g --global --user --system --break-system-packages --global-dir "
                      "--global-folder")
# Commands whose next command word is the command they run, with their value options.
_COMMAND_WRAPPERS: Dict[str, FrozenSet[str]] = {
    "sudo": _w("-u -g -h -p -C -D -r -t -U -T -R"), "doas": _w("-u -C"),
    "env": _w("-u -C -S --unset --chdir --split-string"), "time": _w("-f -o --format --output"),
    "nice": _w("-n --adjustment"), "nohup": frozenset(), "command": frozenset(),
    "builtin": frozenset(), "exec": _w("-a"), "call": frozenset(), "corepack": frozenset(),
    "xargs": _w("-I -n -P -L -d -E -s -a --max-args --max-procs --delimiter --arg-file"),
    # Ephemeral runners: always allowed; the tool they run is checked as a command.
    "npx": _w("-p --package -c --call -w --workspace"), "pnpx": _w("-p --package"),
    "bunx": _w("-p --package"), "uvx": _w("--from --with -p --python --index --index-url"),
}
_RUNNER_VALUE_OPTS = _w("-p --package --with --from -c --call --python --spec -w --workspace "
                        "--filter -F --env-file --pip-args")
# Commands whose arguments are text, not a command (`echo npm install -g x`, `grep pip ...`).
_TEXT_COMMANDS = frozenset(NON_EXEC_PREVIOUS) | _w("grep egrep fgrep rg ag ack findstr "
                                                   "select-string sls")
_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
_PYTHON_RE = re.compile(r"^(?:python[0-9.]*|pythonw|py)$")
_PIP_NAME_RE = re.compile(r"^pip[0-9.]*$")
_JS_BUNDLE_RE = re.compile(r"^-[A-Za-z]{2,}$")


def _manager_of(name: Optional[str]) -> Optional[str]:
    """PKG_SPECS key for a command name (pip3.12 -> pip, yarnpkg -> yarn), else None."""
    if not name:
        return None
    if name in PKG_SPECS:
        return name
    if name == "yarnpkg":
        return "yarn"
    return "pip" if _PIP_NAME_RE.match(name) else None


def _option_parts(word: str, takes: FrozenSet[str]) -> Tuple[str, Optional[str], bool]:
    """(name, attached value, value is the next word) of an option word: --name=value,
    -Xvalue / -X=value for a single-letter option in `takes`, or a bare option."""
    if word.startswith("--"):
        name, eq, value = word.partition("=")
        if eq:
            return name, value, False
        return word, None, word in takes
    if len(word) > 2 and word[:2] in takes:
        value = word[2:]
        return word[:2], value[1:] if value.startswith("=") else value, False
    return word, None, word in takes


def _find_subcommand(texts: Sequence[str], start: int, end: int, takes: FrozenSet[str],
                     known: FrozenSet[str]) -> Tuple[Optional[str], int]:
    """First positional word in texts[start:end] that is a subcommand, and its index.

    A word right after an unknown option may be that option's value; it is skipped unless it
    is a known subcommand (`npm --foo bar install x` finds install)."""
    maybe_value = False
    i = start
    while i < end:
        word = texts[i]
        if word.startswith("-") and len(word) > 1:
            _name, value, next_is_value = _option_parts(word, takes)
            i += 2 if next_is_value else 1
            maybe_value = value is None and not next_is_value
            continue
        if word in known or not maybe_value:
            return word, i
        maybe_value = False
        i += 1
    return None, end


def _collect_options(texts: Sequence[str], start: int, end: int, takes: FrozenSet[str],
                     skip: Sequence[int]) -> List[Tuple[str, Optional[str]]]:
    """(name, value) of every option in texts[start:end] (value None for a bare flag)."""
    opts: List[Tuple[str, Optional[str]]] = []
    i = start
    while i < end:
        word = texts[i]
        if i not in skip and word.startswith("-") and len(word) > 1:
            name, value, next_is_value = _option_parts(word, takes)
            if next_is_value:
                value = texts[i + 1] if i + 1 < end else None
                i += 1
            opts.append((name, value))
        i += 1
    return opts


def _parse_package_command(texts: Sequence[str], idx: int, spec: PkgSpec
                           ) -> Tuple[str, str, int, List[Tuple[str, Optional[str]]]]:
    """(kind, subcommand path, next index, options) for the manager at texts[idx].

    kind is "install" (adds, removes or updates packages), "runner" (runs the command that
    starts at the next index) or "other"; options are collected for "install" only."""
    end = len(texts)
    for k in range(idx + 1, len(texts)):
        if texts[k] == "--":
            end = k
            break
    sub, at = _find_subcommand(texts, idx + 1, end, spec.takes_value, spec.first_level)
    if sub is None:
        bare = spec.bare_install and not any(
            t in ("-v", "--version", "-h", "--help") for t in texts[idx + 1:end])
        if not bare:
            return "other", "", end, []
        return "install", "install", end, _collect_options(texts, idx + 1, end,
                                                           spec.takes_value, ())
    subs = [at]
    path = sub
    if sub in spec.nested or sub in spec.nested_runners:
        installs = spec.nested.get(sub, frozenset())
        runs = spec.nested_runners.get(sub, frozenset())
        second, at = _find_subcommand(texts, at + 1, end, spec.takes_value, installs | runs)
        if second is None:
            return "other", sub, end, []
        subs.append(at)
        path = f"{sub} {second}"
        kind = "install" if second in installs else "runner" if second in runs else "other"
    elif sub in spec.install:
        kind = "install"
    elif sub in spec.runners:
        kind = "runner"
    else:
        kind = "other"
    if kind != "install":
        return kind, path, at + 1, []
    return kind, path, end, _collect_options(texts, idx + 1, end, spec.takes_value, subs)


def _nearest_with(start: str, names: Sequence[str]) -> Optional[str]:
    """Nearest directory from `start` up to the filesystem root holding one of `names`."""
    cur = start
    for _ in range(256):
        for name in names:
            if os.path.exists(os.path.join(cur, name)):
                return cur
        parent = os.path.dirname(cur)
        if not parent or parent == cur:
            return None
        cur = parent
    return None


def pkg_advice(ctx: Ctx) -> str:
    """PKG_ADVICE, naming the run's scratch_dir when the marker records one, and the install
    paths that work from any shell: gates.py --repo runs the install gate, or the self-setup
    install config, inside a scratch clone or worktree (pilot-auto-calibration A01-F38: the
    second pilot tried a cd to a variable, then `cmd //c`, then `python -c subprocess.run(...)`)."""
    if ctx.scratch_dir is None:
        return PKG_ADVICE
    gates = normalize_path(os.path.join(_HERE, "gates.py"))
    return (PKG_ADVICE_HEAD + f"of a clone or worktree of it under the run's scratch_dir "
            f"{ctx.scratch_dir} (\"scratch_dir\" in .harden/active: the PF-10 fresh clone, the "
            f"final clone, differential and mutation worktrees; eval-v2-calibration E02-F08), "
            f"with literal paths. To install a scratch clone's or worktree's dependencies, run "
            f"gates.py there: python \"{gates}\" --repo <clone or worktree> --config "
            f".harden/config.json --out-dir .harden/gates --only <install gate> --label "
            f"<name>-install when the gates hold an install gate, otherwise the same with "
            f"--config .harden/profile-install.config.json and no --only; or type one Bash call "
            f"cd \"<absolute path>\" && <lockfile install command>. Never wrap an install in "
            f"python -c or node -e")


def _pkg_deny(shown: str, why: str, ctx: Ctx) -> Reason:
    return deny("pkg-outside-repo", f"`{shown}` {why}; {pkg_advice(ctx)}")


def _install_reason(manager: str, path: str, opts: Sequence[Tuple[str, Optional[str]]],
                    env: Mapping[str, str], spec: PkgSpec, ctx: Ctx,
                    cwd: Optional[str]) -> Optional[Reason]:
    """Reason to refuse one install-class package-manager command, or None."""
    names = [name for name, _ in opts]
    shown = f"{manager} {path}"
    first = path.split(" ", 1)[0]
    if manager == "cargo" and first == "install" and "--list" in names:
        return None  # lists installed crates, installs nothing
    flag = next((n for n in names if n in PKG_GLOBAL_FLAGS), None)
    if flag is None and spec.js:
        flag = next((n for n in names if _JS_BUNDLE_RE.match(n) and "g" in n), None)
    if flag is None and any(n == "--location" and v == "global" for n, v in opts):
        flag = "--location global"
    if flag is not None:
        return _pkg_deny(shown, f"with {flag} installs outside the repository", ctx)
    if spec.always_global or first in spec.global_subs:
        return _pkg_deny(shown, "installs for the whole user account, outside the repository",
                         ctx)
    if manager == "cargo" and first in ("install", "uninstall"):
        roots = [v for n, v in opts if n == "--root" and v]
        root_word = roots[-1] if roots else env.get("CARGO_INSTALL_ROOT")
        if not root_word:
            return _pkg_deny(shown, "without --root uses ~/.cargo/bin, outside the repository",
                             ctx)
        if not ctx.under_tools(ctx.resolve_dir(root_word, cwd)):
            return _pkg_deny(shown, f"with --root {root_word} is not under the repository's "
                                    f"{TOOLS_REL}", ctx)
        return None  # the install root is the only place it writes to
    if cwd is None:
        return _pkg_deny(shown, "runs in a directory the hook cannot resolve (cd to a "
                                "variable or a command substitution: write the directory as a "
                                "literal path)", ctx)
    problem = ctx.install_scope_problem(cwd)
    if problem:
        return _pkg_deny(shown, f"runs in {problem}", ctx)
    location, walk = cwd, True
    for name, value in opts:
        if value is None or (name not in spec.dir_opts and name not in spec.path_opts):
            continue
        target = ctx.resolve_dir(value, cwd)
        problem = ctx.install_scope_problem(target)
        if problem:
            return _pkg_deny(shown, f"with {name} {value} works in {problem}", ctx)
        if name in spec.dir_opts:
            location, walk = target or cwd, not spec.prefix_is_target
        elif name == "--manifest-path":
            location, walk = os.path.dirname(target or cwd), False
    if manager == "uv" and first == "pip" and any(
            n in ("--python", "-p", "--target", "--prefix") for n in names):
        walk = False  # an explicit interpreter or target, not a discovered .venv
    manifests = spec.walk.get(path, spec.walk.get("", ()))
    if walk and manifests:
        found = _nearest_with(location, manifests)
        if found is not None and not ctx.install_scope(found):
            return _pkg_deny(shown, f"would work in {found}, the nearest directory holding "
                                    f"{' or '.join(manifests)} above {location}, which is "
                                    f"outside the repository", ctx)
    return None


def _package_install_reason(seg: Segment, shell: str, ctx: Ctx) -> Optional[Reason]:
    """Reason to refuse a segment that installs or removes packages outside the run root.

    Follows the command words only: leading VAR=value assignments, wrappers (sudo, env,
    npx, uvx, ...), `python -m <module>` and the runners of the managers themselves
    (pnpm dlx, uv run, ...); the arguments of any other command are not commands."""
    words = seg.words
    names = [cmd_name(w) or "" for w in words]
    if not any(_manager_of(n) for n in names):
        return None
    texts = [w.text for w in words]
    env: Dict[str, str] = {}
    cwd = ctx.dirs.cwd
    idx = 0
    while idx < len(texts):
        if _ASSIGN_RE.match(texts[idx]):
            key, value = texts[idx].split("=", 1)
            env[key] = value
            idx += 1
            continue
        name = names[idx]
        if name in _TEXT_COMMANDS:
            return None
        if name in _COMMAND_WRAPPERS:
            takes = _COMMAND_WRAPPERS[name]
            idx += 1
            while idx < len(texts) and texts[idx].startswith("-") and len(texts[idx]) > 1:
                opt, value, next_is_value = _option_parts(texts[idx], takes)
                if next_is_value:
                    value = texts[idx + 1] if idx + 1 < len(texts) else None
                    idx += 1
                if name == "env" and opt in ("-C", "--chdir") and value:
                    cwd = ctx.resolve_dir(value, cwd)
                idx += 1
            continue
        if _PYTHON_RE.match(name):
            k = idx + 1
            while k < len(texts) and texts[k].startswith("-") and texts[k] != "-m":
                k += 2 if texts[k] in ("-X", "-W") else 1
            if k + 1 < len(texts) and texts[k] == "-m":
                idx = k + 1
                continue
            return None
        manager = _manager_of(name)
        if manager is None:
            return None
        spec = PKG_SPECS[manager]
        kind, path, idx, opts = _parse_package_command(texts, idx, spec)
        if kind == "install":
            return _install_reason(manager, path, opts, env, spec, ctx, cwd)
        if kind != "runner":
            return None
        while idx < len(texts) and texts[idx].startswith("-") and len(texts[idx]) > 1:
            _opt, _value, next_is_value = _option_parts(texts[idx], _RUNNER_VALUE_OPTS)
            idx += 2 if next_is_value else 1
    return None


# -- directory changes -------------------------------------------------------

CD_COMMANDS = {"cd", "chdir", "pushd", "popd", "set-location", "sl", "push-location",
               "pop-location"}


def _cd_target(name: str, args: Sequence[str], shell: str,
               end_op: Optional[str]) -> Tuple[str, Optional[str]]:
    """What a cd-like command does: ("set", word), ("home", None), ("prev", None) for
    `cd -`, ("stay", None) or ("unknown", None)."""
    push = name in ("pushd", "push-location")
    if shell == "powershell":
        target: Optional[str] = None
        positional: List[str] = []
        i = 0
        while i < len(args):
            arg = args[i]
            if arg.startswith("-") and len(arg) > 1:
                param, colon, attached = arg[1:].partition(":")
                param = param.lower()
                takes = bool(param) and any(p.startswith(param)
                                            for p in ("path", "literalpath", "stackname"))
                if takes and not colon:
                    attached = args[i + 1] if i + 1 < len(args) else ""
                    i += 1
                if param and ("path".startswith(param) or "literalpath".startswith(param)):
                    target = attached
                i += 1
                continue
            positional.append(arg)
            i += 1
        if target is None:
            target = positional[0] if positional else None
        if not target:
            return ("stay", None) if push and end_op != "(" else ("unknown", None)
    elif shell == "cmd":
        rest = [a for a in args if a.lower() != "/d"]
        if not rest:
            return ("unknown", None) if end_op == "(" else ("stay", None)
        target = " ".join(rest)  # cmd takes an unquoted path with spaces
    else:
        rest = list(args)
        while rest and rest[0].startswith("-") and rest[0] not in ("-", "--") \
                and not re.match(r"^-\d+$", rest[0]):
            rest.pop(0)
        if rest and rest[0] == "--":
            rest.pop(0)
        if not rest:
            if end_op == "(" or push:
                return ("unknown", None)  # cd $(...) / cd `...`; pushd swaps the stack
            return ("home", None)
        target = rest[0]
        if push and re.match(r"^[+-]\d+$", target):
            return ("unknown", None)
    if target == "-":
        return ("prev", None)
    return ("set", target)


def track_directory_change(pipeline: Sequence[Segment], shell: str, ctx: Ctx) -> None:
    """Follow cd / chdir / pushd / popd / Set-Location / Push-Location / Pop-Location in
    ctx.dirs, so a package install, a write or a delete later in the same command line is
    checked where it runs. In bash and cmd a pipeline of several segments runs them in
    subshells: no change. A cd may fail; the directories the shell may then be in stay in
    ctx.dirs.alts once an operator other than && lets the command go on (A01-F31)."""
    if shell != "powershell" and len(pipeline) != 1:
        _settle_directories(ctx.dirs, pipeline[-1].end_op if pipeline else None)
        return
    for seg in pipeline:
        words = seg.words
        i = 0
        while i < len(words) and (_ASSIGN_RE.match(words[i].text)
                                  or cmd_name(words[i]) in ("builtin", "command")):
            i += 1
        if i >= len(words):
            continue
        name = cmd_name(words[i])
        if name not in CD_COMMANDS:
            continue
        state = ctx.dirs
        before = [state.cwd] + list(state.alts)
        if name in ("popd", "pop-location"):
            state.prev, state.cwd = state.cwd, (state.stack.pop() if state.stack else None)
            state.alts = []
            state.chain.extend(before)
            continue
        action, word = _cd_target(name, [w.text for w in words[i + 1:]], shell, seg.end_op)
        if action == "stay":
            continue
        others: List[Optional[str]] = []
        if action == "set" and word is not None:
            new = ctx.resolve_dir(word, state.cwd)
            others = [ctx.resolve_dir(word, alt) for alt in state.alts]
        elif action == "home":
            new = ctx.resolve_dir("~", state.cwd)
        elif action == "prev":
            new = state.prev
        else:
            new = None
        if name in ("pushd", "push-location"):
            state.stack.append(state.cwd)
        state.prev, state.cwd = state.cwd, new
        state.alts = _unique_dirs(others, new)
        state.chain.extend(before)
    _settle_directories(ctx.dirs, pipeline[-1].end_op if pipeline else None)


MAX_DIR_ALTERNATIVES = 8


def _unique_dirs(dirs: Sequence[Optional[str]], current: Optional[str]) -> List[Optional[str]]:
    out: List[Optional[str]] = []
    for d in dirs:
        if d != current and d not in out:
            out.append(d)
    return out[:MAX_DIR_ALTERNATIVES]


def _settle_directories(state: DirState, end_op: Optional[str]) -> None:
    """After a pipeline: an operator other than && lets the command go on whether or not the
    cds since the last such operator succeeded, so the directories they left become possible
    (A01-F31). The end of the command line settles nothing."""
    if end_op is None or end_op == "&&":
        return
    state.alts = _unique_dirs(list(state.alts) + list(state.chain), state.cwd)
    state.chain = []


# ---------------------------------------------------------------------------
# Data text in the forbidden-command check (pilot-auto-calibration A01-F54)
# ---------------------------------------------------------------------------

# G4: the only other commands a command line whose here-document or echo/printf text is data
# may hold. Nothing on this list can run a file the same line wrote.
DATA_GIT_SUBCOMMANDS = frozenset({"status", "diff", "log", "show", "rev-parse", "ls-files",
                                  "add"})
DATA_GIT_REFUSED_PREFIXES = ("--output", "--ext-diff", "--textconv", "--no-index")
# The skill's bookkeeping scripts: they run git and sibling scripts, never project code.
DATA_SKILL_SCRIPTS = frozenset({"run_state.py", "budget.py", "persist_pass.py", "ledger.py",
                                "lens_card.py", "validate_findings.py", "validate_profile.py",
                                "residual_check.py", "findings_to_sarif.py", "sarif_delta.py",
                                "diff_guard.py", "check_rules.py"})
DATA_PYTHON_OPTION_RE = re.compile(r"^-[BuSEI3]+$")
DATA_PYTHON_ENV = frozenset({"PYTHONIOENCODING", "PYTHONUTF8"})
HARDEN_ENV_SCRIPTS = (".harden/tool-env.sh", ".harden/project-env.sh")
DATA_WRITE_OPS = frozenset({">", ">>", ">|", "&>", "&>>"})
DATA_WRITERS = ("cat", "tee", "echo", "printf")
DATA_ECHO_OPTION_RE = re.compile(r"^-[neE]+$")
DATA_FAST_PATH_RE = re.compile(r"(?:^|[\s;&|(])(?:echo|printf)\b")
DATA_NOTE_HEAD = ("The match lies in here-document or echo/printf text, which counts as data "
                  "only when the command writes it to a file under .harden/ and runs nothing "
                  "that could execute it; here ")
REASON_STRUCTURE = ("the command holds $, a backtick, a subshell, a group, a pipe, an input "
                    "redirection or an assignment")
REASON_WRITES = "the command writes outside .harden/ or to a run environment file"
REASON_UNQUOTED = "its delimiter is unquoted, so the shell expands the here-document"
REASON_UNTERMINATED = "its here-document is not terminated"


def _raw_text(cmd: str, tok: Tok) -> str:
    """The token as written in the command line (quotes and escapes kept)."""
    if 0 <= tok.start <= tok.end <= len(cmd):
        return cmd[tok.start:tok.end]
    return tok.text


def _literal_word(text: str) -> bool:
    """A word the shell passes as written: no expansion, glob or leading tilde."""
    return bool(text) and not text.startswith("~") and \
        not any(ch in text for ch in "$`*?[]{}")


def _span_of(tok: Tok) -> Optional[Tuple[int, int]]:
    return (tok.start, tok.end) if 0 <= tok.start <= tok.end else None


def _blank(command: str, spans: Sequence[Tuple[int, int]]) -> str:
    """`command` with every span's characters replaced by spaces (line breaks kept)."""
    chars = list(command)
    for start, end in spans:
        for k in range(max(0, start), min(len(chars), end)):
            if chars[k] not in "\r\n":
                chars[k] = " "
    return "".join(chars)


def _strictly_under(path: str, parent: str) -> bool:
    return _fold(path).startswith(_fold(parent).rstrip("/") + "/")


def _harden_write_ok(word: str, ctx: "Ctx", allow_null: bool = True) -> bool:
    """G3: `word`, a file the command writes, is /dev/null or a literal path strictly inside
    <run root>/.harden/ (its own and its parent's real path too, so a link inside .harden/
    cannot carry the text out), other than the run's environment scripts (also through a
    link or a short name), wherever the shell may be when it runs: a relative word after a
    cd the hook cannot resolve (`cd -`, `popd`) is refused."""
    if allow_null and word == "/dev/null":
        return True
    if not _literal_word(word) or ".." in word.replace("\\", "/").split("/"):
        return False
    posix_word = normalize_path(word)
    if not (os.path.isabs(posix_word) or re.match(r"^[A-Za-z]:/", posix_word)) and \
            (ctx.dirs.cwd is None or any(alt is None for alt in ctx.dirs.alts)):
        return False
    harden = normalize_path(os.path.join(ctx.root, HARDEN_REL))
    harden_real = normalize_path(os.path.realpath(harden))
    env_scripts = {_fold(p) for p in HARDEN_ENV_SCRIPTS}
    env_real = {_fold(normalize_path(os.path.realpath(os.path.join(ctx.root, p))))
                for p in HARDEN_ENV_SCRIPTS}
    candidates = ctx.absolute_candidates(word)
    if not candidates:
        return False
    for cand in candidates:
        real = normalize_path(os.path.realpath(cand))
        if not (_strictly_under(cand, harden) and _strictly_under(real, harden_real)):
            return False
        rel = ctx.relative(cand)
        if rel is None or _fold(rel.rstrip("/")) in env_scripts or _fold(real) in env_real:
            return False
        parent_real = normalize_path(os.path.realpath(os.path.dirname(cand)))
        if not (_fold(parent_real) == _fold(harden_real) or
                _strictly_under(parent_real, harden_real)):
            return False
        try:
            # A hard link shares its data with a file outside .harden/ (a git hook, say),
            # and realpath cannot see it.
            if os.stat(cand, follow_symlinks=False).st_nlink > 1:
                return False
        except FileNotFoundError:
            pass
        except OSError:
            return False
    return True


def _data_writer(cmd: str, seg: Segment) -> Optional[str]:
    """G2: 'cat', 'tee', 'echo' or 'printf' when the segment's first word is that command as
    written (unquoted, no path, no escape) and its words fit the writer's form; else None."""
    if not seg.words:
        return None
    raw = _raw_text(cmd, seg.words[0])
    if raw not in DATA_WRITERS or seg.words[0].quoted:
        return None
    args = [w.text for w in seg.words[1:]]
    writes = any(op in DATA_WRITE_OPS for op, _t in seg.redirs)
    if raw == "cat":
        return raw if writes and all(a == "-" for a in args) else None
    if raw == "tee":
        operands = [a for a in args if a not in ("-a", "--append")]
        if any(a.startswith("-") for a in operands):
            return None
        return raw if operands or writes else None
    if raw == "echo":
        options = True
        for word in seg.words[1:]:
            if options and not word.quoted and word.text.startswith("-"):
                if not DATA_ECHO_OPTION_RE.match(word.text):
                    return None
                continue
            options = False
        return raw if writes else None
    if any(a == "-v" or (a.startswith("-v") and not a.startswith("--")) for a in args):
        return None  # printf -v assigns a variable
    return raw if writes else None


def _data_word_exempt(cmd: str, tok: Tok) -> bool:
    """G2: an echo/printf argument is data when it is one single-quoted string, or one
    double-quoted string with no $, backtick or backslash."""
    raw = _raw_text(cmd, tok)
    if len(raw) >= 2 and raw[0] == raw[-1] == "'" and raw.count("'") == 2:
        return True
    return len(raw) >= 2 and raw[0] == raw[-1] == '"' and \
        not any(ch in raw[1:-1] for ch in '"$`\\')


def _is_assignment(cmd: str, tok: Tok) -> bool:
    """True when the word, as written, starts with NAME= (its value may be quoted)."""
    return bool(_ASSIGN_RE.match(_raw_text(cmd, tok)))


def _command_word_index(words: Sequence[Tok], cmd: str) -> int:
    i = 0
    while i < len(words) and _is_assignment(cmd, words[i]):
        i += 1
    return i


def _skill_script_dirs(ctx: "Ctx") -> List[str]:
    dirs = [normalize_path(_HERE)]
    skill = ctx.active.get("skill_dir")
    if isinstance(skill, str) and skill.strip():
        dirs.append(normalize_path(os.path.join(skill, "scripts")))
    return dirs


def _is_skill_script(word: str, ctx: "Ctx") -> bool:
    """G4: `word` names one of the skill's bookkeeping scripts in hook_guard.py's directory or
    the marker's skill_dir/scripts (8.3 short names compared through realpath)."""
    if not _literal_word(word):
        return False
    wanted = [d.rstrip("/") + "/" + name for d in _skill_script_dirs(ctx)
              for name in DATA_SKILL_SCRIPTS]
    folded = {_fold(w) for w in wanted}
    real = {_fold(normalize_path(os.path.realpath(w))) for w in wanted}
    candidates = ctx.absolute_candidates(word)
    if not candidates:
        return False
    for cand in candidates:
        if _fold(cand) in folded:
            continue
        if _fold(normalize_path(os.path.realpath(cand))) in real:
            continue
        return False
    return True


def _data_other_segment(cmd: str, seg: Segment, ctx: "Ctx") -> Tuple[bool, str, bool]:
    """G4: (allowed, command name, python segment) for a segment that is not a writer."""
    words = seg.words
    idx = _command_word_index(words, cmd)
    if idx >= len(words):
        return False, "an assignment", False
    first = words[idx]
    raw = _raw_text(cmd, first)
    name = cmd_name(first) or first.text or raw
    args = words[idx + 1:]
    texts = [w.text for w in args]
    if first.quoted:
        return False, name, False
    if raw in ("cd", "pushd", "popd"):
        return len(args) <= 1 and all(_literal_word(t) for t in texts), raw, False
    if raw in ("true", ":"):
        return True, raw, False
    if raw == "mkdir":
        operands = [t for t in texts if t != "-p"]
        ok = "-p" in texts and bool(operands) and \
            all(not t.startswith("-") and _harden_write_ok(t, ctx, allow_null=False)
                for t in operands)
        return ok, raw, False
    if raw == "git":
        i = 0
        while i < len(texts):
            if texts[i] == "-C" and i + 1 < len(texts) and _literal_word(texts[i + 1]):
                i += 2
            elif texts[i] == "--no-pager":
                i += 1
            else:
                break
        ok = i < len(texts) and texts[i] in DATA_GIT_SUBCOMMANDS and \
            not any(t.startswith(DATA_GIT_REFUSED_PREFIXES) for t in texts[i + 1:])
        return ok, raw, False
    if raw in ("python", "python3", "py"):
        i = 0
        while i < len(texts) and DATA_PYTHON_OPTION_RE.match(texts[i]):
            i += 1
        ok = i < len(texts) and _is_skill_script(texts[i], ctx)
        return ok, raw, ok
    return False, name, False


def data_regions(command: str, ctx: "Ctx") -> Tuple[List[Tuple[int, int]],
                                                     List[Tuple[int, int]], Optional[str]]:
    """(exempt spans, every candidate span, why candidates were not exempted or None) of a
    bash command line (pilot-auto-calibration A01-F54). Candidate spans are every
    here-document body and echo/printf argument, whatever their segment. A span is exempt
    only under this closed grammar:
      G2 its segment is a writer: `cat` or `tee` (written exactly, first word) with a
         terminated here-document whose delimiter is quoted, cat with no operand but `-`, tee
         with only -a/--append and file operands; or `echo` / `printf` (echo options -n -e -E
         only, printf never -v), whose single-quoted or plain double-quoted arguments are the
         data; a cat, echo or printf writer redirects its standard output to a file;
      G3 every file the whole command writes (each >, >>, >|, &> or &>> target, each tee
         operand) is /dev/null or a literal path strictly inside <run root>/.harden/, as
         written and as its real path (no link out, no hard link), other than the run's
         environment scripts, at the directory the shell is in there (a relative path after
         a cd the hook cannot resolve, such as `cd -` or `popd`, fails);
      G4 every other segment is cd, pushd or popd with at most one literal operand, mkdir -p
         of literal paths inside .harden/, true or :, read-only git or git add, or python
         running one of the skill's bookkeeping scripts;
      G1 the command with the exempt spans blanked holds no $, backtick, subshell, group,
         pipe, unquoted backslash, other redirection or assignment (a leading
         PYTHONIOENCODING= or PYTHONUTF8= on a G4 python segment excepted).
    Any failure of G1, G3 or G4 withdraws every exemption. ctx.dirs is restored."""
    saved = ctx.dirs.copy()
    try:
        return _data_regions(command, ctx)
    finally:
        ctx.dirs = saved


def _data_regions(command: str, ctx: "Ctx") -> Tuple[List[Tuple[int, int]],
                                                      List[Tuple[int, int]], Optional[str]]:
    toks = tokenize(command, "bash")
    pipelines = split_pipelines(toks)
    candidates: List[Tuple[int, int]] = []
    exempt: List[Tuple[int, int]] = []
    local_reason: Optional[str] = None
    writers: Dict[int, str] = {}
    segments: List[Segment] = [seg for pipeline in pipelines for seg in pipeline]
    for seg in segments:
        for doc in seg.heredocs:
            if doc.body_start >= 0:
                candidates.append((doc.body_start, max(doc.body_start, doc.body_end)))
        idx = _command_word_index(seg.words, command)
        if idx < len(seg.words) and cmd_name(seg.words[idx]) in ("echo", "printf"):
            for word in seg.words[idx + 1:]:
                span = _span_of(word)
                if span:
                    candidates.append(span)
        writer = _data_writer(command, seg)
        if writer is None:
            if seg.heredocs and local_reason is None:
                local_reason = "its here-document is read by `{}`, which may run it".format(
                    cmd_name(seg.words[idx]) if idx < len(seg.words) else "the shell")
            continue
        writers[id(seg)] = writer
        if writer in ("cat", "tee"):
            for doc in seg.heredocs:
                if not doc.terminated:
                    local_reason = local_reason or REASON_UNTERMINATED
                elif not doc.quoted:
                    local_reason = local_reason or REASON_UNQUOTED
                else:
                    exempt.append((doc.body_start, doc.body_end))
        else:
            for word in seg.words[1:]:
                span = _span_of(word)
                if span and _data_word_exempt(command, word):
                    exempt.append(span)
    code = _blank(command, exempt)
    # G1, the structure: nothing that expands, substitutes, groups, pipes or redirects input.
    structural: Optional[str] = None
    if "$" in code or "`" in code or _unquoted_backslash(code):
        structural = REASON_STRUCTURE
    for tok in toks:
        if tok.kind == "op" and (tok.text in ("(", ")", "|") or
                                 (tok.text == ";" and 0 <= tok.start < len(command)
                                  and command[tok.start] in "{}")):
            structural = REASON_STRUCTURE
    for seg in segments:
        for op, _target in seg.redirs:
            if op in DATA_WRITE_OPS:
                continue
            if op in ("<<", "<<-") and writers.get(id(seg)) in ("cat", "tee"):
                continue
            if op in ("<<", "<<-") and id(seg) not in writers and local_reason:
                structural = structural or local_reason
            else:
                structural = REASON_STRUCTURE
    if structural:
        return [], candidates, structural
    # G3 and G4, segment by segment at the directory the shell is in there.
    python_segments: set = set()
    for pipeline in pipelines:
        for seg in pipeline:
            targets = [t for op, t in seg.redirs if op in DATA_WRITE_OPS]
            if writers.get(id(seg)) == "tee":
                targets += [w.text for w in seg.words[1:] if w.text not in ("-a", "--append")]
            if not all(_harden_write_ok(t, ctx) for t in targets):
                return [], candidates, REASON_WRITES
            if id(seg) in writers:
                continue
            allowed, name, is_python = _data_other_segment(command, seg, ctx)
            if not allowed:
                return [], candidates, "the command runs `{}`".format(name)
            if is_python:
                python_segments.add(id(seg))
        track_directory_change(pipeline, "bash", ctx)
    # G1, assignments: none, except a leading PYTHONIOENCODING= or PYTHONUTF8= on python.
    for seg in segments:
        idx = _command_word_index(seg.words, command)
        for pos, word in enumerate(seg.words):
            if not _is_assignment(command, word):
                continue
            name = word.text.split("=", 1)[0]
            leading = pos < idx
            if leading and id(seg) in python_segments and name in DATA_PYTHON_ENV and \
                    _literal_word(word.text.split("=", 1)[1]):
                continue
            return [], candidates, REASON_STRUCTURE
    return exempt, candidates, local_reason


def _unquoted_backslash(code: str) -> bool:
    """True when `code` holds a backslash outside single and double quotes."""
    quote: Optional[str] = None
    for ch in code:
        if quote:
            if ch == quote:
                quote = None
            continue
        if ch in "'\"":
            quote = ch
        elif ch == "\\":
            return True
    return False


def forbidden_text(command: str, shell: str, ctx: "Ctx") -> Tuple[str, Optional[str], str]:
    """(the text forbidden_commands are matched against, the withdrawal reason or None,
    the text with every candidate span blanked). Non-bash shells: the command unchanged."""
    if shell != "bash":
        return command, None, command
    exempt, candidates, reason = data_regions(command, ctx)
    return _blank(command, exempt), reason, _blank(command, candidates)


def forbidden_command_hit(command: str, shell: str, ctx: "Ctx",
                          data_rule: bool = True) -> Tuple[Optional[str], Optional[str]]:
    """(the forbidden_commands entry the command's code text matches, or None; a note when
    the match lies only in text that would be data but for the reason it names). The raw
    command is matched first; the data rule is computed only for a hit in an orchestrator
    Bash command, and any error in it matches the whole command (fail closed)."""
    hit = vp.forbidden_match(command, ctx.forbidden)
    if hit is None:
        return None, None
    if not data_rule or shell != "bash" or (
            "<<" not in command and not DATA_FAST_PATH_RE.search(command)):
        return hit.raw, None
    try:
        text, reason, blanked = forbidden_text(command, shell, ctx)
    except Exception as exc:  # noqa: BLE001 - fail closed: the raw command stays matched
        log_error(Path(ctx.root), {}, exc)
        return hit.raw, None
    code_hit = vp.forbidden_match(text, ctx.forbidden)
    if code_hit is None:
        return None, None
    if reason and vp.forbidden_match(blanked, ctx.forbidden) is None:
        return code_hit.raw, DATA_NOTE_HEAD + reason + "."
    return code_hit.raw, None


# ---------------------------------------------------------------------------
# Here-documents that are code (pilot-auto-calibration A01-F54)
# ---------------------------------------------------------------------------

POSIX_SHELLS = frozenset({"bash", "sh", "zsh", "dash", "ksh"})
HEREDOC_INTERPRETERS = frozenset({"node", "deno", "bun", "perl", "ruby"})
STDIN_PATHS = frozenset({"/dev/stdin", "/dev/fd/0", "/proc/self/fd/0"})
STDIN_SCRIPT_OPERANDS = frozenset({"-", "/dev/stdin", "/dev/fd/0"})
MAX_HEREDOC_SUBSTITUTIONS = 20
WRAPPER_COMMANDS = frozenset({"command", "builtin", "env", "xargs", "sudo", "nohup", "time",
                              "exec", "nice"})
_INTERPRETER_VALUE_OPTS = frozenset({"-m", "-c", "-W", "-X", "-e", "-p", "-r", "--require",
                                     "--import", "--eval", "--print", "-I", "-M"})
_INTERPRETER_INLINE_OPTS = frozenset({"-m", "-c", "-e", "-p", "--eval", "--print"})


def _stdin_code_reader(seg: Segment) -> Optional[Tuple[str, str]]:
    """('shell' | 'interpreter', name) when the segment's command reads its standard input as
    code: a POSIX shell with -s, or with no -c and no operand other than `-`; a shell, `.` or
    `source` whose first operand is /dev/stdin, /dev/fd/0 or /proc/self/fd/0; an interpreter
    (python, node, deno, bun, perl, ruby) with no script operand other than `-`, /dev/stdin
    or /dev/fd/0. Else None."""
    words = seg.words
    i = 0
    while i < len(words):
        if _ASSIGN_RE.match(words[i].text):
            i += 1
            continue
        if cmd_name(words[i]) in WRAPPER_COMMANDS or cmd_name(words[i]) in _MORE_WRAPPERS:
            # the wrapper and its options, numbers and assignments (`timeout 5 bash`, `nice -n
            # 5 bash`, `env -i bash`; review round 4)
            i += 1
            while i < len(words) and (words[i].text.startswith("-") or
                                      _WRAPPER_VALUE_RE.match(words[i].text) or
                                      _ASSIGN_RE.match(words[i].text)):
                i += 1
            continue
        break
    if i >= len(words):
        return None
    # The word at command position names the program even when quoted (`"bash" <<EOF`).
    name = cmd_name(words[i]) or \
        (words[i].text.replace("\\", "/").rsplit("/", 1)[-1].lower() if words[i].quoted else "")
    for suffix in (".exe", ".cmd", ".bat"):
        if name.endswith(suffix):
            name = name[:-len(suffix)]
    args = [w.text for w in words[i + 1:]]
    if name in (".", "source"):
        return ("shell", name) if args and args[0] in STDIN_PATHS else None
    if name in POSIX_SHELLS:
        if any(re.match(r"^-[A-Za-z]*s[A-Za-z]*$", a) for a in args):
            return "shell", name
        operands: List[str] = []
        skip = False
        has_c = False
        for arg in args:
            if skip:
                skip = False
                continue
            if arg in ("-o", "+o", "-O", "+O"):
                skip = True
                continue
            if re.match(r"^-[A-Za-z]*c[A-Za-z]*$", arg):
                has_c = True
                break
            if arg.startswith(("-", "+")) and arg != "-":
                continue
            operands.append(arg)
        if has_c:
            return None
        if not operands or operands[0] == "-" or operands[0] in STDIN_PATHS:
            return "shell", name
        return None
    if _PYTHON_RE.match(name) or name in HEREDOC_INTERPRETERS:
        skip = False
        for arg in args:
            if skip:
                skip = False
                continue
            if arg in _INTERPRETER_INLINE_OPTS:
                return None
            if arg in _INTERPRETER_VALUE_OPTS:
                skip = True
                continue
            if arg.startswith("-") and arg != "-":
                continue
            return ("interpreter", name) if arg in STDIN_SCRIPT_OPERANDS else None
        return "interpreter", name
    return None


def _heredoc_substitutions(body: str) -> List[str]:
    """The $(...) and backtick spans of an unquoted here-document body, which Bash runs."""
    out: List[str] = []
    i, n = 0, len(body)
    while i < n and len(out) < MAX_HEREDOC_SUBSTITUTIONS:
        if body.startswith("$(", i):
            depth, j = 1, i + 2
            while j < n and depth:
                if body[j] == "(":
                    depth += 1
                elif body[j] == ")":
                    depth -= 1
                j += 1
            out.append(body[i + 2:j - 1] if depth == 0 else body[i + 2:])
            i = j
        elif body[i] == "`":
            j = body.find("`", i + 1)
            if j == -1:
                out.append(body[i + 1:])
                break
            out.append(body[i + 1:j])
            i = j + 1
        else:
            i += 1
    return out


def _heredoc_code_reason(seg: Segment, pipeline: Sequence[Segment], shell: str, ctx: "Ctx",
                         depth: int) -> Optional[str]:
    """A here-document is code when a shell or interpreter reads it: its own segment's command
    (_stdin_code_reader) or, when the segment ends in `|`, a later segment of the pipeline
    that is such a command. A shell body is analysed as a nested bash command line; an
    interpreter body gets the inline-delete and inline-link checks; an unquoted body's $(...)
    and backtick spans are analysed as bash commands wherever it goes
    (pilot-auto-calibration A01-F54). A here-string (`bash <<<'...'`) its own command reads as
    code is checked the same way (review round 4)."""
    if shell != "bash":
        return None
    strings = [target for op, target in seg.redirs if op == "<<<"]
    if strings:
        reader_of_string = _stdin_code_reader(seg)
        for text in strings if reader_of_string else []:
            kind, name = reader_of_string  # type: ignore[misc]
            if kind == "shell":
                reason = analyse_command(text, "bash", ctx, depth + 1)
                if reason:
                    return reason
            elif INLINE_DELETE_RE.search(text):
                return deny("inline-delete",
                            f"{name} reads a here-string that deletes a directory tree")
            elif INLINE_LINK_RE.search(text):
                return deny("link-create", f"{name} reads a here-string that creates a link; "
                                           f"{LINK_ADVICE}")
    if not seg.heredocs:
        return None
    readers: List[Tuple[str, str]] = []
    own = _stdin_code_reader(seg)
    if own:
        readers.append(own)
    if seg.end_op == "|":
        position = next((k for k, s in enumerate(pipeline) if s is seg), len(pipeline))
        for later in pipeline[position + 1:]:
            reader = _stdin_code_reader(later)
            if reader:
                readers.append(reader)
                break
    for doc in seg.heredocs:
        if doc.body_start < 0:
            continue
        for kind, name in readers:
            if kind == "shell":
                reason = analyse_command(doc.body, "bash", ctx, depth + 1)
                if reason:
                    return reason
                continue
            if INLINE_DELETE_RE.search(doc.body):
                return deny("inline-delete",
                            f"{name} reads a here-document that deletes a directory tree")
            if INLINE_LINK_RE.search(doc.body):
                return deny("link-create", f"{name} reads a here-document that creates a "
                                           f"link; {LINK_ADVICE}")
        if not doc.quoted:
            for inner in _heredoc_substitutions(doc.body):
                reason = analyse_command(inner, "bash", ctx, depth + 1)
                if reason:
                    return reason
    return None


def analyse_pipeline(pipeline: Sequence[Segment], shell: str, ctx: Ctx,
                     depth: int) -> Optional[str]:
    """Block reason for one pipeline, or None."""
    all_words = [w for seg in pipeline for w in seg.words]
    names = [cmd_name(w) for w in all_words if not w.quoted or "/" in w.text]
    if shell == "powershell" and any(n in REMOVE_COMMANDS for n in names):
        for seg in pipeline:
            seg_names = [cmd_name(w) for w in seg.words]
            if any(n in LISTING_COMMANDS for n in seg_names):
                params = [w.text[1:].split(":", 1)[0].lower() for w in seg.words
                          if w.text.startswith("-") and len(w.text) > 1]
                if _has_ps_switch(params, "recurse"):
                    return deny("recursive-listing-delete",
                                "a recursive listing piped into Remove-Item deletes a whole tree "
                                "(the pattern behind Claude Code issue #23913)")
    if any(n in DB_CLIENTS for n in names):
        text = " ".join(w.text for w in all_words)
        if SQL_DESTRUCTIVE_RE.search(text):
            return deny("sql-destructive", "DROP/TRUNCATE sent to a database client destroys data")
    for seg in pipeline:
        for op, target in seg.redirs:
            if op in WRITE_REDIRECTS:
                reason = ctx.write_reason([target], f"redirection {op}")
                if reason:
                    return reason
        reason = _snapshot_update_reason(seg.words)
        if reason:
            return reason
        words = seg.words
        package_args_from = _package_argument_start(words)
        for idx, word in enumerate(words):
            if idx >= package_args_from:
                break
            name = cmd_name(word)
            if not name or name not in HANDLERS:
                continue
            if idx > 0:
                previous = cmd_name(words[idx - 1])
                if previous == "git" and name != "git":
                    continue  # a git subcommand such as `git rm`, handled by the git handler
                if previous in NON_EXEC_PREVIOUS:
                    continue
            at_command = _at_command_position(words, idx)
            if name in LINK_HANDLER_NAMES and not at_command:
                continue  # `grep -w ln`, `git log --grep junction` (A01-F56)
            if name == "cp" and at_command:
                reason = _cp_link_reason(words[idx + 1:])
                if reason:
                    return reason
            reason = HANDLERS[name](name, words[idx + 1:], shell, ctx, depth)
            if reason:
                return reason
        reason = _heredoc_code_reason(seg, pipeline, shell, ctx, depth)
        if reason:
            return reason
        reason = _package_install_reason(seg, shell, ctx)
        if reason:
            return reason
    return None


def analyse_command(command: str, shell: str, ctx: Ctx, depth: int = 0) -> Optional[str]:
    """Block reason for a whole command line, or None when it looks allowed.

    Directory changes are followed from pipeline to pipeline in ctx.dirs for the package
    install check; in bash and cmd a `( ... )` group restores the directory when it closes,
    and ctx.dirs is restored when this call returns, so the cd of a nested shell
    (`bash -c 'cd ..'`) does not leak into the outer command."""
    if depth > MAX_DEPTH or not isinstance(command, str) or not command.strip():
        return None
    saved = ctx.dirs.copy()
    groups: List[DirState] = []
    try:
        for pipeline in split_pipelines(tokenize(command, shell)):
            if shell != "powershell":  # PowerShell ( ) and $( ) share the caller's location
                for op in pipeline[0].lead_ops:
                    if op == "(":
                        groups.append(ctx.dirs.copy())
                    elif op == ")" and groups:
                        ctx.dirs = groups.pop()
            reason = analyse_pipeline(pipeline, shell, ctx, depth)
            if reason:
                return reason
            track_directory_change(pipeline, shell, ctx)
    finally:
        ctx.dirs = saved
    return None


# ---------------------------------------------------------------------------
# Hook events
# ---------------------------------------------------------------------------


def _file_tool_target(payload: Mapping[str, Any]) -> Optional[str]:
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return None
    raw = tool_input.get("file_path") or tool_input.get("notebook_path")
    return raw if isinstance(raw, str) and raw.strip() else None


def _shell_command(payload: Mapping[str, Any]) -> Optional[str]:
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return None
    command = tool_input.get("command")
    return command if isinstance(command, str) else None


@dataclass
class SimpleProblem:
    """A problem found before strengthen.py could run (or when it cannot load)."""

    code: str
    line: Optional[int]
    message: str


def _decode(data: Optional[bytes], what: str) -> Tuple[Optional[str], Optional[Any]]:
    if data is None:
        return None, SimpleProblem("unverifiable", None, f"{what} cannot be read")
    if st is not None and len(data) > st.MAX_BYTES:
        return None, SimpleProblem("too-large", None, f"{what} is too large to check")
    if b"\x00" in data:
        return None, SimpleProblem("binary", None, f"{what} is binary")
    try:
        return data.decode("utf-8"), None
    except UnicodeDecodeError:
        return None, SimpleProblem("not-utf8", None, f"{what} is not UTF-8")


def _test_edit_problem(payload: Mapping[str, Any], ctx: "Ctx", abs_path: str,
                       rel: str) -> Tuple[Optional[Any], List[str]]:
    """(the first strengthen.Problem of this file-tool call on an existing test file, the codes
    of the next ones), or (None, []) when strengthen.py accepts it (PC-06; U01-F07)."""
    if st is None:
        return SimpleProblem("checker-unavailable", None,
                             f"the additions checker could not be loaded ({ST_ERROR})"), []
    tool = str(payload.get("tool_name") or "")
    if tool == "NotebookEdit":
        return SimpleProblem("notebook", None, "NotebookEdit replaces, inserts or deletes whole "
                             "cells, so an existing test notebook stays read-only"), []
    base = ctx.cfg.base_sha
    if not base:
        return SimpleProblem("unverifiable", None, "the run's base commit is unknown"), []
    lookup = ctx.git_spelling(abs_path, rel)
    try:
        blobs = st.read_blobs(Path(ctx.root), [f"{base}:{lookup}", f"HEAD:{lookup}"])
    except Exception as exc:  # noqa: BLE001 - git failure: fail closed
        return SimpleProblem("unverifiable", None, f"git could not read the file's versions "
                             f"({type(exc).__name__})"), []
    base_text, problem = _decode(blobs.get(f"{base}:{lookup}"), "the base version")
    if problem is not None:
        return problem, []
    detail = st.not_strengthenable(rel, base_text or "", snapshot=False,
                                   protected=bool(ctx.cfg.config_protection(rel)))
    if detail:
        return SimpleProblem("not-strengthenable", None, detail), []
    head_blob = blobs.get(f"HEAD:{lookup}")
    head_text = base_text
    if head_blob is not None:
        head_text, problem = _decode(head_blob, "the HEAD version")
        if problem is not None:
            return problem, []
    try:
        with open(abs_path, "rb") as handle:
            current_bytes = handle.read()
    except OSError:
        return SimpleProblem("unverifiable", None, "the file cannot be read"), []
    current_text, problem = _decode(current_bytes, "the current file")
    if problem is not None:
        return problem, []
    new_text, problem = st.apply_tool_edit(tool, payload.get("tool_input"), current_text or "")
    if problem is not None:
        return problem, []
    if tool == "Write" and st.eol_changed_raw(current_bytes, (new_text or "").encode("utf-8")):
        return SimpleProblem("eol-changed", None, "this Write would rewrite the line endings of "
                             "existing lines; add the lines with Edit instead"), []
    problems = st.check_additions(head_text or "", new_text or "", rel, must_contain=base_text,
                                  deadline=time.monotonic() + HOOK_CHECK_BUDGET_S)
    if not problems:
        return None, []
    return problems[0], [p.code for p in problems[1:4]]


def test_edit_message(rel: str, glob: str, tool: str, problem: Any, others: Sequence[str],
                      active: Mapping[str, Any]) -> str:
    where = f" (line {problem.line})" if getattr(problem, "line", None) else ""
    more = f" Also: {', '.join(others)}." if others else ""
    return (f"/harden: {rel} is an existing test file (matches {glob}): its existing lines "
            f"are read-only during /harden and it may only gain checked additions. This {tool} "
            f"was refused: {problem.message}{where} [test-edit: {problem.code}].{more} "
            f"{ADDITIONS_NOTE} To pin the contract anyway, put these lines in a new test file "
            f"next to it (always allowed; lens-tests TQ-07). {edit_advice(active)}")


def check_file_tool(payload: Mapping[str, Any], ctx: Ctx) -> Optional[str]:
    """Block reason (a Reason with its reason_code) for Edit/Write/MultiEdit/NotebookEdit."""
    raw = _file_tool_target(payload)
    if raw is None:
        return None
    abs_path = ctx.absolute(raw)
    rel = ctx.relative(abs_path)
    if rel is None:
        return ctx.temp_write_reason(raw, abs_path, f"{payload.get('tool_name')} of {raw}")
    if ctx.is_canary(rel):
        return deny("canary-edit", CANARY_EDIT_MESSAGE)
    if ctx.is_marker(rel):
        return deny("marker-write", MARKER_MESSAGE)
    if ctx.is_event_log(rel):
        return deny("event-log-write", EVENT_LOG_MESSAGE)
    if ctx.is_run_evidence(rel):
        return deny("run-evidence-write", RUN_EVIDENCE_MESSAGE)
    if ctx.is_profile(rel):
        return deny("profile-write", PROFILE_MESSAGE)
    if ctx.report_only and rel and not ctx.in_harden_dir(rel):
        return deny("report-only-edit", report_only_message(ctx.active))
    if not os.path.exists(abs_path):
        return None  # a new file: new tests are allowed
    hit = ctx.classify(rel)
    if hit is None:
        return None
    if hit[0] in ("test", "snapshot") and ctx.cfg.allow.first_match(rel):
        return None  # approved deletion (DC-15); diff_guard checks it removes lines only
    if hit[0] == "protected" and ctx.cfg.allow_config.first_match(rel):
        return None  # approved config edit; diff_guard still scans its added lines
    if not ctx.existed_at_base(abs_path, rel):
        return None  # created during this run (e.g. a new characterization test): editable
    if hit[0] == "test" and not ctx.cfg.snapshots.first_match(rel):
        try:
            problem, others = _test_edit_problem(payload, ctx, abs_path, rel)
        except Exception as exc:  # noqa: BLE001 - fail closed for existing tests (U01-F07)
            log_error(Path(ctx.root), payload, exc)
            problem, others = SimpleProblem(
                "checker-error", None,
                f"the additions check failed ({type(exc).__name__}); nothing was changed"), []
        if problem is None:
            return None  # checked additions to an existing test (PC-06; U01-F07)
        return deny("edit-test", test_edit_message(rel, hit[1],
                                                   str(payload.get("tool_name") or "edit"),
                                                   problem, others, ctx.active))
    return deny(f"edit-{hit[0]}",
                f"/harden: {rel} is read-only during /harden: it is an existing {hit[0]} file "
                f"(matches {hit[1]}). {edit_advice(ctx.active)}")


def check_shell_tool(payload: Mapping[str, Any], ctx: Ctx, shell: str) -> Optional[str]:
    """Block reason (a Reason with its reason_code) for a Bash/PowerShell command."""
    command = _shell_command(payload)
    if command is None:
        return None
    if CANARY_TOKEN in command:
        return deny("canary-bash", CANARY_BASH_MESSAGE)
    banned, data_note = ctx.forbidden_hit(command, shell,
                                          data_rule=not _payload_str(payload, "agent_id"))
    if banned is not None:
        return deny("profile-forbidden",
                    f"/harden hook blocked this command: the run profile forbids commands "
                    f"matching {banned!r} (forbidden_commands in .harden/profile.json, copied "
                    f"into .harden/active when the run started; user-policy-autonomy U01-F03). "
                    + (f"{data_note} " if data_note else "") + FORBIDDEN_ADVICE)
    ctx.tool_env_sourced = bool(TOOL_ENV_SOURCED_RE.search(command))
    env_config = ENV_GIT_CONFIG_RE.search(command)
    if env_config:
        key = env_config.group(1).lower()
        code = {"alias.": "git-alias", "clean.requireforce": "git-clean-requireforce"}.get(
            key, "git-hookspath")
        reason: Optional[str] = deny(code, f"GIT_CONFIG_* variables set {env_config.group(1)} "
                                           f"for git (an alias runs any command; "
                                           f"clean.requireForce and core.hooksPath disable "
                                           f"git's own safety checks)")
    else:
        reason = analyse_command(command, shell, ctx)
    if reason is None:
        match = RUN_CONTROL_RE.search(command)
        if match and (match.group(1).lower() != "stop" or "--force" in match.group(2)):
            action = "run_state.py " + match.group(1).lower()
            ctx.run_control.append(action + (" --force" if match.group(1).lower() == "stop"
                                             else ""))
        return None
    return deny(reason_code(reason),
                f"/harden hook blocked this command: {reason}. {shell_advice(ctx.active)}")


def _payload_str(payload: Mapping[str, Any], key: str) -> Optional[str]:
    value = payload.get(key)
    return value if isinstance(value, str) and value else None


def _append_event(root: Path, payload: Mapping[str, Any], entry: Dict[str, Any]) -> None:
    entry["session_id"] = _payload_str(payload, "session_id")
    entry["transcript_path"] = _payload_str(payload, "transcript_path")
    for key in ("agent_id", "agent_type"):  # present only inside a subagent (A01-F45)
        value = _payload_str(payload, key)
        if value:
            entry[key] = value
    line = json.dumps(entry, ensure_ascii=True, default=str) + "\n"
    with open(root / ".harden" / EVENT_LOG_NAME, "a", encoding="utf-8", newline="\n") as handle:
        handle.write(line)


def _subject(path_or_cmd: Optional[str]) -> Optional[str]:
    return redact(path_or_cmd)[:MAX_LOGGED_CHARS] if isinstance(path_or_cmd, str) else None


def log_event(root: Path, payload: Mapping[str, Any], code: str,
              path_or_cmd: Optional[str]) -> None:
    """Append one denial to .harden/hook_events.log as a JSON line; never raises.

    Only the target path or the command is recorded (credentials redacted, 200 characters at
    most); file contents and edit payloads never are. session_id and transcript_path come from
    the hook input (canary-check requires them).
    """
    try:
        _append_event(root, payload, {"ts": dg.utc_now(), "event": payload.get("hook_event_name"),
                                      "tool": payload.get("tool_name"), "reason_code": code,
                                      "path_or_cmd": _subject(path_or_cmd)})
    except Exception as exc:  # noqa: BLE001 - the block decision must stand
        log_error(root, payload, exc)


def log_run_control(root: Path, payload: Mapping[str, Any], actions: Sequence[str],
                    path_or_cmd: Optional[str]) -> None:
    """Append one allowed run-control command (marker removal, run_state.py stop --force,
    set-mode, allow-*) to .harden/hook_events.log; never raises. Not a denial: "decision" is
    "allow", so canary-check ignores it."""
    try:
        _append_event(root, payload, {"ts": dg.utc_now(), "event": payload.get("hook_event_name"),
                                      "tool": payload.get("tool_name"), "type": "run-control",
                                      "decision": "allow", "actions": sorted(set(actions)),
                                      "path_or_cmd": _subject(path_or_cmd)})
    except Exception as exc:  # noqa: BLE001 - logging must not change the decision
        log_error(root, payload, exc)


def stop_message(report: dg.Report, base: str,
                 active: Optional[Mapping[str, Any]] = None) -> str:
    """The Stop refusal; the escalation follows the run's mode (owner_route)."""
    lines = ["/harden: finishing is blocked once because the working tree has changes that "
             "/harden forbids:"]
    for item in report.hard[:10]:
        loc = item.get("file", "")
        lines.append(f"  - [{item['kind']}] {loc + ': ' if loc else ''}{item['message']}")
    if len(report.hard) > 10:
        lines.append(f"  - ... and {len(report.hard) - 10} more (run diff_guard.py for the list)")
    marker = active or {}
    revert = (f"Revert each of these (for example `git restore --source={base[:12]} -- <path>` "
              f"for a changed file)")
    interactive = ("or, if you believe a change is necessary, stop and flag it to the user with "
                   "your evidence instead of finishing silently")
    # Nobody can approve a forbidden change during an autonomous run: it is reverted either
    # way, and the need for it goes to the owner (user-policy-autonomy U01-F01, U01-F03).
    autonomous = (f"even one you believe necessary, and record that need, with your evidence, "
                  f"as {OWNER_ITEM}")
    asks = asks_user(marker)
    if asks is True:
        advice = f"{revert} {interactive}."
    elif asks is False:
        advice = f"{revert}, {autonomous}; {NO_WAIT_NOTE}."
    else:
        advice = (f"{revert} {interactive} (--interactive); in autonomous mode revert every one, "
                  f"{autonomous}, since an autonomous run asks nobody and never waits "
                  f"(user-policy-autonomy U01-F01).")
    lines.append(f"{advice} This check will not block again in this turn.")
    return "\n".join(lines)


def _load_active(root: Path) -> Dict[str, Any]:
    path = root / ".harden" / "active"
    # utf-8-sig: Windows PowerShell 5.1 writes a BOM, which must not disable the guard.
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError(".harden/active must contain a JSON object")
    return data


def _load_config(root: Path) -> Optional[Dict[str, Any]]:
    path = root / ".harden" / "config.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    return data if isinstance(data, dict) else None


def _write_json_atomic(path: Path, data: Mapping[str, Any]) -> None:
    tmp = path.with_name(path.name + f".tmp{os.getpid()}")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    os.replace(str(tmp), str(path))


def update_session(root: Path, payload: Mapping[str, Any],
                   active: Mapping[str, Any]) -> Tuple[Dict[str, Any], bool]:
    """Record permission_mode on first sight; return (session data, warn about bypass now)."""
    path = root / ".harden" / SESSION_NAME
    run_key = f"{active.get('base_sha', '')}|{active.get('started', '')}"
    data: Dict[str, Any] = {}
    if path.exists():
        try:
            loaded = json.loads(path.read_text(encoding="utf-8-sig"))
            data = loaded if isinstance(loaded, dict) else {}
        except (OSError, ValueError):
            data = {}
    changed = False
    if data.get("run") != run_key:
        data = {"run": run_key}
        changed = True
    # A subagent's hook payload carries agent_id: its transcript_path, permission_mode and
    # session_id are never recorded as the main thread's (A01-F45).
    subagent = _payload_str(payload, "agent_id") is not None
    transcript = payload.get("transcript_path")
    if isinstance(transcript, str) and transcript.strip() and "transcript_path" not in data \
            and not subagent:
        # read by budget.py, ledger.py ingest and models, persist_pass.py recover and
        # harden_agents.py probe-check (A01-F34, A01-F41)
        data["transcript_path"] = transcript
        changed = True
    mode = payload.get("permission_mode")
    if isinstance(mode, str) and mode:
        if "permission_mode" not in data and not subagent:
            data["permission_mode"] = mode
            data["first_seen"] = dg.utc_now()
            data["session_id"] = payload.get("session_id")
            changed = True
        seen = data.get("modes_seen")
        if not isinstance(seen, list):
            seen = []
            data["modes_seen"] = seen
        if mode not in seen:
            seen.append(mode)
            changed = True
    if changed:
        _write_json_atomic(path, data)
    warn = mode == "bypassPermissions" and not data.get("bypass_warned")
    return data, warn


def mark_bypass_warned(root: Path, data: Dict[str, Any]) -> None:
    data["bypass_warned"] = True
    data["bypass_warned_at"] = dg.utc_now()
    _write_json_atomic(root / ".harden" / SESSION_NAME, data)


def log_error(root: Path, payload: Mapping[str, Any], exc: BaseException) -> None:
    """Append one line describing an internal error; never raises."""
    try:
        frames = traceback.extract_tb(exc.__traceback__)[-3:]
        where = " < ".join(f"{os.path.basename(f.filename)}:{f.lineno}:{f.name}"
                           for f in reversed(frames))
        message = str(exc).replace("\r", " ").replace("\n", " ")[:300]
        line = (f"{dg.utc_now()} event={payload.get('hook_event_name')} "
                f"tool={payload.get('tool_name')} {type(exc).__name__}: {message} [{where}]\n")
        with open(root / ".harden" / ERROR_LOG_NAME, "a", encoding="utf-8") as handle:
            handle.write(line)
    except Exception:  # noqa: BLE001 - logging must never break the hook
        pass


def log_note(root: Path, payload: Mapping[str, Any], note: str, repeat: bool = True) -> None:
    """Append one note to .harden/hook_errors.log; with repeat=False, skip it when the last
    line already carries the same note (a persistent config error would add one per call)."""
    path = root / ".harden" / ERROR_LOG_NAME
    try:
        if not repeat and path.exists():
            with open(path, "rb") as handle:
                handle.seek(max(0, path.stat().st_size - 2048))
                tail = handle.read().decode("utf-8", errors="replace").splitlines()
            if tail and tail[-1].rstrip().endswith("note: " + note):
                return
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"{dg.utc_now()} event={payload.get('hook_event_name')} note: {note}\n")
    except OSError:
        pass


def load_run_config(root: Path, payload: Mapping[str, Any],
                    active: Dict[str, Any]) -> "dg.RunConfig":
    """The run's RunConfig; a bad .harden/config.json never disables the guard.

    An unparsable config.json, or one with a wrongly typed field (dg.ConfigError, for example
    "scope": "src"), is logged to .harden/hook_errors.log and ignored: the marker's globs and
    diff_guard's defaults apply. A marker with a wrongly typed list falls back to its
    base_sha, branch and mode with the defaults. Both fallbacks are stricter, never looser.
    """
    config: Optional[Dict[str, Any]] = None
    try:
        config = _load_config(root)
    except (OSError, ValueError) as exc:
        log_note(root, payload, f".harden/config.json ignored ({type(exc).__name__}: {exc}); "
                                f"the guard uses the marker's globs and the defaults",
                 repeat=False)
    try:
        return dg.config_from_data(root, active, config)
    except dg.ConfigError as exc:
        log_note(root, payload, f"run configuration rejected ({exc}); falling back",
                 repeat=False)
    if config is not None:
        try:
            return dg.config_from_data(root, active, None)
        except dg.ConfigError as exc:
            log_note(root, payload, f".harden/active rejected ({exc}); using the defaults",
                     repeat=False)
    minimal = {key: active[key] for key in ("base_sha", "branch", "mode", "started",
                                            "head_at_start") if isinstance(active.get(key), str)}
    return dg.config_from_data(root, minimal, None)


def handle_event(payload: Mapping[str, Any], root: Path, out: TextIO, err: TextIO) -> int:
    """Handle one hook event for an active run. May raise; the caller fails open."""
    active = _load_active(root)
    cfg = load_run_config(root, payload, active)
    event = payload.get("hook_event_name")
    tool = payload.get("tool_name")

    if event == "PreToolUse":
        ctx = Ctx(root, payload.get("cwd") if isinstance(payload.get("cwd"), str) else None, cfg,
                  active)
        block: Optional[str] = None
        subject: Optional[str] = None
        if tool in FILE_TOOLS:
            block = check_file_tool(payload, ctx)
            subject = _file_tool_target(payload)
            subject = subject.replace("\\", "/") if subject else subject
        elif tool in SHELL_TOOLS:
            block = check_shell_tool(payload, ctx, SHELL_TOOLS[tool])
            subject = _shell_command(payload)
            if not block and _payload_str(payload, "agent_id") and (
                    ctx.run_control or SUBAGENT_RUN_STATE_RE.search(subject or "")):
                block = deny("subagent-run-control",
                             "/harden hook blocked this command: a subagent ({}) may not remove "
                             ".harden/active or start, stop, switch or loosen the run with "
                             "run_state.py; only the orchestrator does (pilot-auto-calibration "
                             "A01-F45). Report the command instead of running it".format(
                                 _payload_str(payload, "agent_type") or "unknown agent"))
            if not block and ctx.run_control:
                log_run_control(root, payload, ctx.run_control, subject)
        # Bookkeeping must never cancel a block decision: catch everything here.
        try:
            session, warn = update_session(root, payload, active)
        except Exception as exc:  # noqa: BLE001 - logged, decision above stands
            log_error(root, payload, exc)
            session, warn = {}, False
        if block:
            code = reason_code(block)
            log_event(root, payload, code, subject)
            err.write(f"{block} [reason_code: {code}]\n")
            err.flush()
            return 2
        if warn:
            out.write(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": bypass_warning(active)}}) + "\n")
            out.flush()
            try:
                mark_bypass_warned(root, session)
            except Exception as exc:  # noqa: BLE001 - logged
                log_error(root, payload, exc)
        return 0

    try:
        update_session(root, payload, active)
    except Exception as exc:  # noqa: BLE001 - logged, the Stop check below still runs
        log_error(root, payload, exc)

    if event in STOP_EVENTS:
        if payload.get("stop_hook_active") is True:
            return 0
        if not cfg.base_sha:
            log_note(root, payload, ".harden/active has no base_sha; Stop diff check skipped")
            return 0
        report = dg.run_guard(root, cfg.base_sha, cfg, quick=True)
        if report.hard:
            files = sorted({str(i["file"]) for i in report.hard if i.get("file")})
            log_event(root, payload, "stop-hard-violations",
                      ", ".join(files) or ", ".join(str(i["kind"]) for i in report.hard))
            err.write(stop_message(report, report.base, active) +
                      " [reason_code: stop-hard-violations]\n")
            err.flush()
            return 2
    return 0


def run(raw: str, env: Mapping[str, str], out: TextIO, err: TextIO) -> int:
    """Process one hook invocation; returns the exit code (0 or 2)."""
    try:
        payload = json.loads(raw) if raw and raw.strip() else {}
    except ValueError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    root = find_run_root(env, payload)
    if root is None:
        if payload.get("hook_event_name") in STOP_EVENTS and \
                payload.get("stop_hook_active") is not True:
            remind_unstopped_run(env, payload, out)
        return 0
    try:
        return handle_event(payload, root, out, err)
    except Exception as exc:  # noqa: BLE001 - fail open by design, logged
        log_error(root, payload, exc)
        return 0


def remind_unstopped_run(env: Mapping[str, str], payload: Mapping[str, Any],
                         out: TextIO) -> None:
    """Stop without a marker: when `.harden/session.json` belongs to a run that
    `run_state.py stop` never closed, print one systemMessage reminder and remember it.
    Never raises (a Stop hook must not break the session)."""
    try:
        for start in search_starts(env, payload):
            root = _walk_up(start, HARDEN_REL + "/" + SESSION_NAME)
            if root is None:
                continue
            path = root / HARDEN_REL / SESSION_NAME
            data = json.loads(path.read_text(encoding="utf-8-sig"))
            if not isinstance(data, dict) or not data.get("run") or data.get("stopped") \
                    or data.get("marker_gone_reminded"):
                return
            if (root / HARDEN_REL / "active").exists():
                return
            out.write(json.dumps({"systemMessage": RUN_STOP_REMINDER}) + "\n")
            out.flush()
            data["marker_gone_reminded"] = dg.utc_now()
            _write_json_atomic(path, data)
            return
    except Exception:  # noqa: BLE001 - a reminder must never break the session
        return


def _read_stdin() -> str:
    stream = getattr(sys.stdin, "buffer", None)
    if stream is None:
        return sys.stdin.read() if sys.stdin else ""
    return stream.read().decode("utf-8", errors="replace")


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass
    try:
        raw = _read_stdin()
    except (OSError, ValueError):
        raw = ""
    return run(raw, os.environ, sys.stdout, sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
