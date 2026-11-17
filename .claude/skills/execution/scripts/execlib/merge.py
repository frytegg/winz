"""The merge queue (contract/CLI.md `merge`, `fe-workspace`, `snapshot`; MODULES.md 5; FRONTEND.md 3.3).

The not-rocket-science rule: under the merge lock, build the candidate commit C on top of origin/main, scan
origin/main..C, run the offline gates (/harden's gates.py with `<state>/gates.json`) and the task's own proof on C's
exact tree, write the intent, then `git push origin <C>:refs/heads/main` (never --force, never a +refspec). A
non-fast-forward rejection is the compare-and-set: back to the fetch, at most three pushes.

Single-tree mode never rebases, resets, stashes or commits in the shared checkout (other agents' uncommitted files
live there): the changed paths are the files matching the task's writes whose working-tree content differs from
origin/main, and C is built from them through a temporary index (`read-tree`, `update-index`, `write-tree`,
`commit-tree`), stored at `refs/exec/<task>/a<n>r<k>`, and gated in an integration worktree under scratch whose
`node_modules` is a junction to the shared checkout's install when C changes no manifest file. Worktrees mode rebases
the lane worktree. A state-only task (every write under `.execution/`, empty product diff) lands with
`mode: state-only`, `landed_sha` = origin/main and no push.

Exit codes: 0 landed; 1 conflict, gate-failed, scan-failed, push-rejected-exhausted, nothing to merge, no gates.json;
4 policy (trailers, conventional header, never-show, secrets, push freeze, protected path, a third call in one run,
already landed, `--by orchestrator` from an agent); 3 git or environment (lock timeout, budget, resources): a rerun.

The secret scan of the added lines and of the new commit messages gets the state repo's proven-public values
(`integrity.load_public_values`, README.md 8): a transaction hash listed in public-values.jsonl, or one inside an
explorer link, is not a hit; the same shape anywhere else still is, and the scan's planted key (its positive control)
is never listed. A task that may write new evidence (proof type tx, kind tx or deploy, or a `wallet:*` resource; CLI.md
merge, "Secret-shaped values in the added lines", Q-B10-7) gets one more step when that scan fails: each remaining
`0x`+64-hex value of its added lines is re-read on chain with the task's own reader, exactly as `proof run` reads it;
a value the chain confirms is registered (proven `chain-reread`, source `merge:<task>:a<n>`) and the scans run again.
An unconfirmed value, a reader failure, or such a value in any other task stays a hit: exit 4 E_SECRET_IN_STATE.
"""
from __future__ import annotations

import functools
import os
import re
from argparse import Namespace
from dataclasses import replace
from pathlib import Path
from typing import Any

from . import clock, gitutil, hardenbridge, integrity, locks, nevershow, plan as plan_mod, proof
from .errors import CheckFailed, EnvError, ErrorItem, ExecError, GitError, PolicyRefused, UsageError
from .gitutil import Git
from .jsonio import read_json, write_json_atomic
from .log import get_logger
from .model import CommandResult, Ctx
from .paths import Layout, is_link_like, posix, scratch_dir

_LOG = get_logger("execlib.merge")

WAVE_RE = re.compile(r"^W[0-9]{2,3}$")
MAX_PUSHES = 3
MAX_CALLS_PER_RUN = 2
STATE_PREFIX = ".execution/"
MANIFEST_GLOBS: tuple[str, ...] = (
    "**/package.json", "pnpm-lock.yaml", "**/pnpm-lock.yaml", "pnpm-workspace.yaml", "**/package-lock.json",
    "**/yarn.lock", "**/Cargo.toml", "Cargo.lock", "pyproject.toml", "requirements*.txt", "uv.lock", "go.mod",
    "go.sum", "foundry.toml", "aiken.toml", "tsconfig*.json", ".github/workflows/*",
)
ENV_GATE_RE = proof.ENV_FAILURE_RE
POLICY_SCAN_CODES: dict[str, str] = {
    "trailers": "E_POLICY", "conventional": "E_NOT_CONVENTIONAL", "never-show": "E_NEVER_SHOW",
    "secrets": "E_SECRET_IN_STATE", "push-freeze": "E_POLICY", "protected": "E_POLICY",
}
# A transaction hash (or a private key: the same shape) in an added line, as log.redact's hex-key pattern reads it.
TX_HASH_IN_TEXT_RE = re.compile(r"(?<![0-9A-Za-z])0x[0-9a-fA-F]{64}(?![0-9A-Za-z])")


def _results() -> Any:
    from . import results  # lane B04
    return results


class MergeOutcome(Exception):
    """Internal: a finished merge whose receipt is written (landed or not)."""

    def __init__(self, receipt: dict, error: ExecError | None) -> None:
        super().__init__(receipt.get("outcome"))
        self.receipt = receipt
        self.error = error


# --- helpers --------------------------------------------------------------------------------------------------------

def _is_state_only(task: dict) -> bool:
    writes = list(task.get("writes") or [])
    return bool(writes) and all(str(w).startswith(STATE_PREFIX) for w in writes)


def _is_manifest(path: str) -> bool:
    return integrity.matches_any(path, MANIFEST_GLOBS)


def _calls_file(layout: Layout, task: str, attempt: int, rerun: int) -> Path:
    return layout.merge_gates_dir(task, attempt, rerun).parent / "calls.json"


def _count_call(layout: Layout, task: str, attempt: int, rerun: int) -> int:
    path = _calls_file(layout, task, attempt, rerun)
    n = 0
    if path.is_file():
        try:
            n = int((read_json(path) or {}).get("calls") or 0)
        except (OSError, ValueError, ExecError):
            n = 0
    n += 1
    write_json_atomic(path, {"calls": n, "task": task, "attempt": attempt, "rerun": rerun})
    return n


def build_commit_from_paths(git: Git, base: str, paths: list[str], message_file: Path, index_path: Path) -> str:
    """A commit of `base` plus the working-tree content of `paths` (added, modified, deleted), built with a temporary
    index so the checkout's HEAD, index and files are never touched; returns its SHA."""
    index_path = Path(index_path)
    index_path.parent.mkdir(parents=True, exist_ok=True)
    if index_path.exists():
        index_path.unlink()
    env = {"GIT_INDEX_FILE": posix(index_path)}
    try:
        git.run("read-tree", base, env=env)
        for i in range(0, len(paths), 200):
            chunk = paths[i:i + 200]
            if chunk:
                git.run("update-index", "--add", "--remove", "--", *chunk, env=env)
        tree = git.run("write-tree", env=env).stdout.strip()
        sha = git.run("commit-tree", tree, "-p", base, "-F", posix(message_file)).stdout.strip()
    finally:
        try:
            index_path.unlink()
        except FileNotFoundError:
            pass
        lock = Path(str(index_path) + ".lock")
        if lock.exists():
            lock.unlink()
    if not re.match(r"^[0-9a-f]{40}$", sha):
        raise GitError(f"commit-tree returned {sha!r}")
    return sha


def _ls_tree(git: Git, rev: str) -> dict[str, str]:
    out = git.run("ls-tree", "-r", "-z", "--full-tree", rev).stdout
    blobs: dict[str, str] = {}
    for rec in out.split("\0"):
        if not rec:
            continue
        meta, _tab, path = rec.partition("\t")
        parts = meta.split()
        if len(parts) >= 3 and parts[1] == "blob":
            blobs[path] = parts[2]
    return blobs


def changed_write_paths(git: Git, repo: Path, base: str, writes: list[str]) -> list[str]:
    """Files matching `writes` whose working-tree content differs from `base` (added, modified, deleted,
    untracked included); never a path under `.execution/` or `.git/`."""
    base_blobs = _ls_tree(git, base)
    cands: set[str] = set()
    diff = git.run("diff", "--name-only", "--no-renames", "-z", base).stdout
    cands.update(p for p in diff.split("\0") if p)
    cands.update(git.untracked())
    cands.update(base_blobs)
    keep = sorted(p for p in cands if integrity.matches_any(p, writes) and not p.startswith(STATE_PREFIX)
                  and not p.startswith(".git/"))
    present = [p for p in keep if (repo / p).is_file() and not is_link_like(repo / p)]
    hashed: dict[str, str] = {}
    if present:
        out = git.run("hash-object", "--stdin-paths", input_text="\n".join(present) + "\n").stdout.split()
        hashed = dict(zip(present, out))
    changed = []
    for p in keep:
        if hashed.get(p) != base_blobs.get(p):
            changed.append(p)
    return changed


def _junction(src: Path, dst: Path) -> None:
    if os.name == "nt":
        import _winapi  # noqa: PLC0415 - Windows only
        _winapi.CreateJunction(str(src), str(dst))
    else:
        os.symlink(src, dst, target_is_directory=True)


def integration_worktree(git: Git, sha: str, dest: Path, shared_checkout: Path, *,
                         link_node_modules: bool | None = None) -> Path:
    """`git worktree add --detach <dest> <sha>` (a stale one is removed link-safely first); `node_modules` is a
    junction to the shared checkout's install when `link_node_modules` and that install exists. Left out (the
    MODULES.md signature), it is computed: no manifest file changed between origin/main and `sha`."""
    if link_node_modules is None:
        base = git.run("merge-base", "origin/main", sha, check=False).stdout.strip() or "origin/main"
        link_node_modules = not any(_is_manifest(p) for p in git.changed_paths(base, sha))
    if dest.exists() or any(Path(w) == dest for w in git.worktrees()):
        git.worktree_remove_link_safe(dest)
    git.run("worktree", "prune")
    dest.parent.mkdir(parents=True, exist_ok=True)
    git.run("worktree", "add", "--detach", posix(dest), sha)
    nm = shared_checkout / "node_modules"
    if link_node_modules and nm.is_dir():
        _junction(nm, dest / "node_modules")
    return dest


def _scan_all(git: Git | None, base: str, head: str, *, task: dict, plan_raw: dict, profile: dict, policy: dict,
              local_state: dict, now_utc: str, now: Any, public: frozenset[str] = frozenset()
              ) -> list[integrity.Scan]:
    """Every scan of CLI.md merge step 3 on base..head (an empty diff when git is None), with positive controls.
    `public`: the proven-public values the secret scan clears (README.md 8)."""
    if git is not None and base != head:
        changed = git.changed_paths(base, head)
        messages = git.commit_messages(base, head)
        added = list(git.added_lines(base, head))
        ti_changes = integrity.test_integrity_changes(git, base, head)
    else:
        changed, messages, added, ti_changes = [], [], [], []
    writes = list(task.get("writes") or [])
    allowed = (task.get("kind") == "test" and task.get("proof_author") == "test-designer") or \
        task.get("phase") == "contract"
    entries = _never_show_entries(profile, now)
    judge = list(((profile.get("paths") or {}).get("judge_facing")) or [])
    scans: list[integrity.Scan] = [
        integrity.scan_writes_scope(changed, writes),
        integrity.scan_protected(changed, list(plan_raw.get("protected") or []), allowed),
        integrity.with_positive_control(integrity.scan_trailers, (integrity.planted_messages("trailer"),), messages),
        integrity.with_positive_control(integrity.scan_conventional, (integrity.planted_messages("conventional"),),
                                        messages),
    ]
    plant_lines, plant_entries = integrity.planted_never_show(entries)
    ns_lines = integrity.with_positive_control(integrity.scan_never_show, (plant_lines, plant_entries), added,
                                               entries)
    ns_msgs = integrity.scan_never_show_messages(messages, entries)
    if ns_lines.state == "fail" or ns_msgs.state == "fail":
        detail = "; ".join(s.detail for s in (ns_lines, ns_msgs) if s.state == "fail")
        scans.append(replace(ns_lines, state="fail", detail=detail))
    else:
        scans.append(replace(ns_lines, detail=f"{ns_lines.detail}; {ns_msgs.detail}"))
    secrets = functools.partial(integrity.scan_secrets, public=public)
    sec_lines = integrity.with_positive_control(secrets, (integrity.planted_secret_line(),), added)
    msg_fails = [integrity.scan_secrets_text(m, where=f"commit {sha[:12]} message", public=public)
                 for sha, m in messages]
    bad = [s for s in msg_fails if s.state == "fail"]
    if bad or sec_lines.state == "fail":
        detail = "; ".join([sec_lines.detail] * (sec_lines.state == "fail") + [s.detail for s in bad])
        scans.append(replace(sec_lines, state="fail", detail=detail))
    else:
        scans.append(sec_lines)
    scans.append(integrity.with_positive_control(integrity.test_integrity_core, (integrity.planted_test_change(),),
                                                 ti_changes))
    plant_todo, plant_globs = integrity.planted_todo()
    scans.append(integrity.with_positive_control(integrity.scan_todo, (plant_todo, plant_globs), added, judge))
    freeze = ((policy.get("git") or {}).get("push_freeze_utc"))
    frozen = bool(((local_state.get("flags") or {}).get("push_frozen")))
    scans.append(integrity.scan_push_freeze(now_utc, freeze, frozen))
    return scans


def _never_show_entries(profile: dict, now: Any) -> list[nevershow.Entry]:
    path = ((profile.get("paths") or {}).get("never_show"))
    if not path:
        return []
    p = Path(path)
    if not p.is_file():
        raise EnvError(f"the never-show file {posix(p)} is missing: the merge scan cannot run", code="E_ENV",
                       hint="restore the owner's never-show file (profile.paths.never_show)")
    entries, _warnings = nevershow.load(p)
    return nevershow.active(entries, now)


def _chain_task(task: dict) -> bool:
    """A task whose added lines may carry new evidence the chain can prove public (CLI.md merge, Q-B10-7): proof type
    tx, kind tx or deploy, or a `wallet:*` resource."""
    return (task.get("proof") or {}).get("type") == "tx" or task.get("kind") in ("tx", "deploy") or \
        any(str(r).startswith("wallet:") for r in task.get("resources") or [])


def _unproven_hashes(added: list[tuple[str, int, str]], public: frozenset[str]) -> list[str]:
    """Every distinct `0x`+64-hex value of the added lines that neither the registry nor an explorer link clears, in
    order of appearance (the first spelling of each, any letter case being the same value)."""
    found: dict[str, str] = {}
    for _path, _line, text in added:
        spans = integrity.cleared_spans(text, public)
        for m in TX_HASH_IN_TEXT_RE.finditer(text):
            if not any(start <= m.start() and m.end() <= end for start, end in spans):
                found.setdefault(m.group(0).lower(), m.group(0))
    return list(found.values())


def _confirm_on_chain(ctx: Ctx, task: dict, run: _Run, added: list[tuple[str, int, str]], public: frozenset[str],
                      policy: dict, local_state: dict, budget: proof.Budget, cwd: Path) -> int:
    """CLI.md merge, "Secret-shaped values in the added lines": re-read each unproven tx hash of a chain task's added
    lines with the task's own reader, exactly as `proof run` reads it, and register every value the chain confirms
    (proven chain-reread, source merge:<task>:a<n>) under the state lock. Returns how many were registered; the notes
    say what happened to the others, never with the value."""
    values = _unproven_hashes(added, public)
    if not values:
        return 0
    tid = task["id"]
    spec = (task.get("proof") or {}).get("spec") or {}
    forbidden = proof.forbidden_reason(str(spec.get("reader_cmd") or ""), policy, local_state)
    if forbidden:
        run.notes.append(f"{len(values)} added transaction-hash-shaped value(s) not re-read: the task's reader is "
                         f"refused ({forbidden})")
        return 0
    registered = 0
    unconfirmed: list[str] = []
    for value in values:
        with budget.step("chain-reread"):
            confirmed, detail = proof.chain_reread(task, policy, value, cwd)
        if not confirmed:
            unconfirmed.append(detail)
            continue
        with locks.hold(ctx.layout, "state", command="merge"):
            integrity.register_public_value(ctx.layout, value=value, kind=proof.tx_hash_kind(value),
                                            chain=str(spec["chain"]), network=str(spec["network"]),
                                            proven="chain-reread", source=f"merge:{tid}:a{run.attempt}")
        registered += 1
    if registered:
        run.notes.append(f"{registered} added transaction hash(es) confirmed on chain by the task's reader and "
                         f"registered in public-values.jsonl (proven chain-reread, source merge:{tid}:a{run.attempt})")
    if unconfirmed:
        run.notes.append(f"{len(unconfirmed)} added transaction-hash-shaped value(s) not confirmed on chain: "
                         + "; ".join(sorted(set(unconfirmed)))[:300])
    return registered


def _secrets_failed(scans: list[integrity.Scan]) -> bool:
    return any(s.id == "secrets" and s.state != "ok" and not s.detail.startswith("blind scan") for s in scans)


def _scan_verdict(scans: list[integrity.Scan]) -> tuple[str | None, ExecError | None]:
    """(outcome, error) from the scans: policy refusals first (exit 4), then scan-failed (exit 1)."""
    for s in scans:
        if s.state != "ok" and s.id in POLICY_SCAN_CODES:
            code = POLICY_SCAN_CODES[s.id]
            if s.detail.startswith("blind scan"):
                return "scan-failed", CheckFailed(f"{s.id}: {s.detail}", code="E_CHECK")
            return "refused", PolicyRefused(f"{s.id}: {s.detail}", code=code)
    for s in scans:
        if s.state != "ok":
            return "scan-failed", CheckFailed(f"{s.id}: {s.detail}", code="E_CHECK")
    return None, None


# --- the merge ------------------------------------------------------------------------------------------------------

class _Run:
    """The mutable state of one merge call."""

    def __init__(self, ctx: Ctx, task: dict, attempt: int, rerun: int, wave: str, mode: str, branch: str) -> None:
        self.ctx = ctx
        self.task = task
        self.attempt = attempt
        self.rerun = rerun
        self.wave = wave
        self.mode = mode
        self.branch = branch
        self.key = f"a{attempt}r{rerun}"
        self.origin_before: str | None = None
        self.head_before: str | None = None
        self.landed: str | None = None
        self.push_attempts = 0
        self.gates: dict = {"label": None, "result_path": None, "exit_code": None, "flaky": []}
        self.task_proof: dict = {"run": None, "exit_code": None}
        self.scans: list[dict] = []
        self.conflicts: list[str] = []
        self.worktree_removed = False
        self.candidate_ref: str | None = None
        self.notes: list[str] = []

    def receipt(self, outcome: str, budget: proof.Budget | None) -> dict:
        origin = self.origin_before or ("0" * 40)
        doc: dict[str, Any] = {
            "schema": "execution.merge-receipt/1", "task": self.task["id"], "attempt": self.attempt,
            "rerun": self.rerun, "wave": self.wave, "lane": self.task.get("lane"), "mode": self.mode,
            "branch": self.branch, "origin_before": origin, "head_before": self.head_before or origin,
            "landed_sha": self.landed if outcome == "landed" else None, "outcome": outcome,
            "push_attempts": self.push_attempts, "gates": self.gates, "task_proof": self.task_proof,
            "scans": self.scans, "conflict_files": self.conflicts, "worktree_removed": self.worktree_removed,
            "started_utc": clock.format_utc(self.ctx.now), "finished_utc": clock.format_utc(self.ctx.now),
            "timings": dict(budget.measured) if budget else {}, "candidate_ref": self.candidate_ref,
        }
        if self.notes:
            doc["notes"] = "; ".join(self.notes)
        return doc


def _write_receipt(ctx: Ctx, run: _Run, receipt: dict) -> Path:
    proof.validate_doc(receipt, "merge-receipt", f"merge receipt of {run.task['id']}")
    path = ctx.layout.result(run.wave, run.task["id"], "merge", run.attempt)
    write_json_atomic(path, receipt)
    return path


def _finish(ctx: Ctx, run: _Run, outcome: str, error: ExecError | None, budget: proof.Budget | None) -> dict:
    receipt = run.receipt(outcome, budget)
    _write_receipt(ctx, run, receipt)
    intent = ctx.layout.merge_intent(run.task["id"], run.attempt, run.rerun)
    if intent.exists():  # the receipt is written, then the intent deleted (CLI.md merge)
        intent.unlink()
    if budget is not None:
        budget.save()
    ev = {"landed": "merge.landed", "conflict": "merge.conflict"}.get(outcome, "merge.failed")
    data = {"task": run.task["id"], "attempt": run.attempt, "rerun": run.rerun, "wave": run.wave,
            "outcome": outcome, "mode": run.mode, "push_attempts": run.push_attempts}
    if run.landed and outcome == "landed":
        data["sha"] = run.landed
    if error is not None:
        data["code"] = error.code
    if ctx.executor in ("A", "B"):
        proof.append_event(ctx, ev, data)
    raise MergeOutcome(receipt, error)


def merge_task(ctx: Ctx, plan: dict, task: dict, *, attempt: int, rerun: int, wave: str, worktree: Path | None,
               branch: str | None, single_tree: bool, message_file: Path | None) -> dict:
    """CLI.md merge: already-landed and intent checks, then steps 1-8 under the merge lock; returns the receipt
    (landed) or raises an ExecError whose data is the receipt. `plan` is the plan document (MODULES.md 5)."""
    layout = ctx.layout
    tid = task["id"]
    if layout.repo is None:
        raise UsageError("merge needs the product repository (--repo)")
    if not WAVE_RE.match(wave or ""):
        raise UsageError(f"--wave {wave!r} is not a wave id")
    if attempt < 1 or rerun < 0:
        raise UsageError("--attempt >= 1 and --rerun >= 0")
    if single_tree and (worktree or branch):
        raise UsageError("--single-tree excludes --worktree/--branch")
    if not single_tree and not (worktree and branch):
        raise UsageError("pass --worktree DIR --branch B (worktrees mode) or --single-tree --message-file F")
    if single_tree and (message_file is None or not Path(message_file).is_file()):
        raise UsageError("--single-tree needs --message-file F (an existing file)")
    results = _results()
    landed = results.landed_receipt(layout, tid)
    if landed:
        raise PolicyRefused(f"{tid} already landed ({str(landed.get('landed_sha'))[:12]})", code="E_ALREADY_LANDED",
                            data=landed)
    git = Git(layout.repo)
    pending = sorted(layout.merge_pending_dir.glob(f"{tid}.a*r*.json")) if layout.merge_pending_dir.is_dir() else []
    if pending:
        git.fetch("origin")
        for p in pending:
            head = str((read_json(p) or {}).get("head_sha") or "")
            if re.match(r"^[0-9a-f]{40}$", head) and \
                    git.run("cat-file", "-e", f"{head}^{{commit}}", check=False).exit_code == 0 and \
                    git.is_ancestor(head, "origin/main"):
                with locks.hold(layout, "state", command=ctx.command):
                    results.finalize_merge_intents(ctx, git)
                landed = results.landed_receipt(layout, tid)
                if landed:
                    raise PolicyRefused(f"{tid} already landed (finalised from its merge intent)",
                                        code="E_ALREADY_LANDED", data=landed)
    if ctx.by == "orchestrator":
        att = proof.find_attestation(layout, command="merge", task=tid, attempt=attempt, now=ctx.now,
                                     max_age_s=proof.ATTEST_MAX_AGE_S)
        if att is not None and att.get("agent_id"):
            raise PolicyRefused("--by orchestrator from an agent's merge call", code="E_POLICY")
    profile = proof.load_profile(layout)
    policy = proof.load_policy(layout)
    local_state = proof.load_local_state(layout)
    proof.check_floors(profile, layout.repo)
    budget = proof.Budget(layout, profile, "merge", str(task.get("kind")))
    hardenbridge.assert_out_dir_safe(layout.merge_gates_dir(tid, attempt, rerun))
    mode = "single-tree" if single_tree else "worktrees"
    run = _Run(ctx, task, attempt, rerun, wave, mode, "main" if single_tree else str(branch))
    wait = max(1.0, min(locks.TIMEOUTS_S["merge"], budget.remaining() - 60))
    try:
        with locks.hold(layout, "merge", command="merge", timeout_s=wait):
            if _count_call(layout, tid, attempt, rerun) > MAX_CALLS_PER_RUN:
                raise PolicyRefused(f"a third merge call for {tid} in run a{attempt}r{rerun}", code="E_MERGE_ATTEMPTS")
            _merge_locked(ctx, plan, task, run, git, profile, policy, local_state, budget,
                          Path(worktree) if worktree else None, Path(message_file) if message_file else None)
    except MergeOutcome as done:
        if done.error is not None:
            done.error.data = done.receipt
            raise done.error from None
        return done.receipt
    except EnvError as err:
        if err.code == "E_TIME_BUDGET":
            _record_partial(ctx, run, budget, err)
        raise
    raise ExecError("merge ended without a receipt", code="E_INTERNAL")


def _record_partial(ctx: Ctx, run: _Run, budget: proof.Budget, err: EnvError) -> None:
    """CLI.md 0.6: a merge stopped by its budget writes what it did so a rerun continues. The measured step durations
    go to local/timings.json (the rerun's budget check then knows them); the intent stays when the push may have
    started; the partial state is written beside the run key's call counter
    (`local/merge-gates/<task>-a<n>r<k>/partial.json`) and printed as the error's data. It is not a merge receipt:
    merge-receipt.schema.json has no outcome for an interrupted merge (contract question in the B06 report)."""
    budget.save()
    intent = ctx.layout.merge_intent(run.task["id"], run.attempt, run.rerun)
    partial: dict[str, Any] = {
        "task": run.task["id"], "attempt": run.attempt, "rerun": run.rerun, "wave": run.wave, "mode": run.mode,
        "branch": run.branch, "stopped_at": (err.data or {}).get("step"), "origin_before": run.origin_before,
        "head_before": run.head_before, "candidate_ref": run.candidate_ref, "push_attempts": run.push_attempts,
        "scans": run.scans, "gates": run.gates, "task_proof": run.task_proof, "timings": dict(budget.measured),
        "intent_kept": intent.exists(), "notes": list(run.notes), "written_utc": clock.format_utc(ctx.now),
    }
    path = _calls_file(ctx.layout, run.task["id"], run.attempt, run.rerun).with_name("partial.json")
    try:
        write_json_atomic(path, partial)
    except OSError as werr:
        _LOG.warning("the partial merge state could not be written", extra={"data": {"error": str(werr)}})
    data = dict(err.data or {})
    data.update({"partial": partial, "partial_path": posix(path)})
    err.data = data


def _merge_locked(ctx: Ctx, plan_raw: dict, task: dict, run: _Run, git: Git, profile: dict, policy: dict,
                  local_state: dict, budget: proof.Budget, worktree: Path | None, message_file: Path | None) -> None:
    layout = ctx.layout
    repo = layout.repo
    assert repo is not None
    tid = task["id"]
    project = proof.project_slug(profile)
    wgit = Git(worktree) if worktree else None
    run.head_before = (wgit.head() if wgit else git.head())
    now_utc = clock.format_utc(ctx.now)
    for round_no in range(1, MAX_PUSHES + 1):
        with budget.step("fetch"):
            git.fetch("origin")
        origin = git.rev_parse("origin/main")
        run.origin_before = origin
        if run.head_before is None:
            run.head_before = origin
        with budget.step("build"):
            if run.mode == "single-tree":
                paths = changed_write_paths(git, repo, origin, list(task.get("writes") or []))
                if not paths:
                    if _is_state_only(task):
                        _state_only(ctx, plan_raw, task, run, profile, policy, local_state, budget, origin)
                    run.notes.append("no file of the task's writes differs from origin/main")
                    _finish(ctx, run, "nothing-to-merge", CheckFailed(f"{tid}: nothing to merge", code="E_CHECK"),
                            budget)
                index = scratch_dir(profile, project, "merge", f"idx-{tid}-{run.key}")
                head = build_commit_from_paths(git, origin, paths, message_file, index)  # type: ignore[arg-type]
                ref = f"refs/exec/{tid}/{run.key}"
                git.run("update-ref", ref, head)
                run.candidate_ref = ref
            else:
                assert wgit is not None
                rb = wgit.rebase("origin/main")
                if not rb.ok:
                    run.conflicts = list(rb.conflicts)
                    _finish(ctx, run, "conflict", CheckFailed(f"{tid}: rebase conflict in "
                                                              + ", ".join(rb.conflicts), code="E_CHECK"), budget)
                head = wgit.head() or origin
                if head == origin:
                    if _is_state_only(task):
                        _state_only(ctx, plan_raw, task, run, profile, policy, local_state, budget, origin)
                    _finish(ctx, run, "nothing-to-merge", CheckFailed(f"{tid}: nothing to merge", code="E_CHECK"),
                            budget)
        with budget.step("scans"):
            public = integrity.load_public_values(layout)
            scans = _scan_all(git, origin, head, task=task, plan_raw=plan_raw, profile=profile, policy=policy,
                              local_state=local_state, now_utc=now_utc, now=ctx.now, public=public)
        if _secrets_failed(scans) and _chain_task(task):
            # CLI.md merge (Q-B10-7): the evidence a capture task writes is accepted once the chain proved it
            added = list(git.added_lines(origin, head))
            if _confirm_on_chain(ctx, task, run, added, public, policy, local_state, budget, worktree or repo):
                with budget.step("scans"):
                    scans = _scan_all(git, origin, head, task=task, plan_raw=plan_raw, profile=profile,
                                      policy=policy, local_state=local_state, now_utc=now_utc, now=ctx.now,
                                      public=integrity.load_public_values(layout))
        run.scans = [s.to_dict() for s in scans]
        outcome, error = _scan_verdict(scans)
        if outcome:
            _finish(ctx, run, outcome, error, budget)
        changed = git.changed_paths(origin, head)
        integ: Path | None = None
        try:
            if run.mode == "single-tree":
                integ = scratch_dir(profile, project, "integ") / f"{tid}-{run.key}"  # a stale one is a work tree
                integration_worktree(git, head, integ, repo,
                                     link_node_modules=not any(_is_manifest(p) for p in changed))
                tree = integ
            else:
                tree = worktree  # type: ignore[assignment]
            _gates(ctx, task, run, tree, changed, budget)
            _pre_push_proof(ctx, plan_raw, task, run, head, tree, budget, profile, policy)
        finally:
            if integ is not None:
                try:
                    git.worktree_remove_link_safe(integ)
                except (OSError, ExecError) as err:
                    _LOG.warning("integration worktree not removed", extra={"data": {"error": str(err)}})
        intent = layout.merge_intent(tid, run.attempt, run.rerun)
        with budget.step("push"):
            write_json_atomic(intent, {"head_sha": head, "origin_before": origin, "started_utc": now_utc,
                                       "task": tid, "attempt": run.attempt, "rerun": run.rerun, "wave": run.wave,
                                       "mode": run.mode, "branch": run.branch, "lane": task.get("lane"),
                                       "head_before": run.head_before})
            pushed = git.push_sha(head, "main")
            run.push_attempts += 1
        if pushed.ok:
            if os.environ.get("EXEC_TEST") == "1" and os.environ.get("EXEC_TEST_FAULT") == "merge-after-push":
                os._exit(70)  # fault injection (TESTS.md C-MRG-16): a crash between the push and the receipt
            run.landed = head
            break
        if not _rejected_by_cas(git, pushed, origin):  # the intent is kept: the push may have started
            raise GitError(f"git push failed: {pushed.stderr_tail.strip()[-300:]}")
        intent.unlink()  # a rejected compare-and-set: C is not on origin
        run.notes.append(f"push {round_no} rejected (non-fast-forward): origin moved")
        if round_no == MAX_PUSHES:
            _finish(ctx, run, "push-rejected-exhausted",
                    CheckFailed(f"{tid}: push rejected {MAX_PUSHES} times", code="E_CHECK"), budget)
    try:
        git.fetch("origin")
        if wgit is not None:
            try:
                wgit.ff(run.branch, run.landed or "HEAD")
            except ExecError:
                pass
            run.worktree_removed = _maybe_remove_lane_worktree(ctx, task, run, git, worktree)
    except ExecError as err:
        run.notes.append(f"post-push step: {err.message}")
    _finish(ctx, run, "landed", None, budget)


RACE_RE = re.compile(r"(incorrect old value provided|failed to update ref|cannot lock ref|fetch first|"
                     r"non-fast-forward)", re.IGNORECASE)


def _rejected_by_cas(git: Git, pushed: gitutil.PushOutcome, origin_before: str) -> bool:
    """A rejected push is the compare-and-set losing (back to the fetch) when git says so in any of its wordings
    ("fetch first", "non-fast-forward", "failed to update ref", "incorrect old value provided"), or when origin/main
    moved since the candidate was built."""
    if pushed.rejected_non_ff or RACE_RE.search(pushed.stderr_tail or ""):
        return True
    try:
        git.fetch("origin")
        return git.rev_parse("origin/main") != origin_before
    except ExecError:
        return False


def _gates(ctx: Ctx, task: dict, run: _Run, tree: Path, changed: list[str], budget: proof.Budget) -> None:
    layout = ctx.layout
    tid = task["id"]
    if not layout.gates_json.is_file():
        if task.get("phase") in ("setup", "contract"):
            run.notes.append("gates.json absent (the contract wave has not landed it): gates not run")
            return
        run.notes.append("gates.json absent")
        _finish(ctx, run, "gate-failed", CheckFailed(f"{tid}: no gates.json yet (phase {task.get('phase')})",
                                                     code="E_NO_GATES"), budget)
    out_dir = layout.merge_gates_dir(tid, run.attempt, run.rerun)
    label = f"merge-{tid}-{run.key}"
    if run.mode == "single-tree" and any(_is_manifest(p) for p in changed):
        with proof.hold_lock(layout, "disk-heavy", ctx.command, timeout_s=180):
            proof.run_install(layout, tree, out_dir.parent, f"install-{label}", budget)
    with budget.step("gates"):
        outcome = hardenbridge.gates(layout.gates_json, tree, out_dir, label)
    run.gates = {"label": label, "result_path": posix(outcome.result_path), "exit_code": outcome.exit_code,
                 "flaky": list(outcome.flaky)}
    if outcome.exit_code != 0:
        text = "\n".join(o[2].decode("utf-8", "replace") + o[3].decode("utf-8", "replace")
                         for o in hardenbridge.gate_outputs(outcome.result))
        if ENV_GATE_RE.search(text):
            raise EnvError(f"{tid}: a gate failed for an environment reason (memory, disk space, path length)",
                           code="E_ENV", hint="a rerun, never a failed attempt")
        _finish(ctx, run, "gate-failed", CheckFailed(f"{tid}: the offline gates failed", code="E_CHECK"), budget)


def _pre_push_proof(ctx: Ctx, plan_raw: dict, task: dict, run: _Run, head: str, tree: Path, budget: proof.Budget,
                    profile: dict, policy: dict) -> None:
    """The task's own proof on the gated tree, in place (CLI.md merge step 5): command and repo-relative file
    proofs only (ci, url and tx proofs need the pushed SHA; human-attest tasks never merge)."""
    ptype = task["proof"]["type"]
    spec = task["proof"]["spec"]
    if ptype not in ("command", "file") or (ptype == "file" and Path(str(spec.get("path", ""))).is_absolute()):
        run.notes.append(f"pre-push proof skipped for proof type {ptype}")
        return
    ictx = replace(ctx, by="integrator")
    doc = proof.run_proof(ictx, plan_raw, task, head, negative_control=False, checkout="in-place", keep=True,
                          tree=tree, budget=budget, check_resources=False, profile=profile, policy=policy)
    run.task_proof = {"run": doc["run_id"], "exit_code": doc["exit_code"]}
    if not doc["expectation"]["met"]:
        _finish(ctx, run, "gate-failed", CheckFailed(f"{task['id']}: the task's proof failed on the candidate",
                                                     code="E_CHECK"), budget)


def _state_only(ctx: Ctx, plan_raw: dict, task: dict, run: _Run, profile: dict, policy: dict, local_state: dict,
                budget: proof.Budget, origin: str) -> None:
    """FRONTEND.md 3.3: landed, mode state-only, landed_sha = origin/main, no push, gates not run, scans on the empty
    diff with their positive controls, the task's proof run in place."""
    run.mode = "state-only"
    run.branch = "main"
    run.landed = origin
    run.head_before = run.head_before or origin
    run.notes.append("state-only task: product tree unchanged")
    scans = _scan_all(None, origin, origin, task=task, plan_raw=plan_raw, profile=profile, policy=policy,
                      local_state=local_state, now_utc=clock.format_utc(ctx.now), now=ctx.now,
                      public=integrity.load_public_values(ctx.layout))
    run.scans = [s.to_dict() for s in scans]
    outcome, error = _scan_verdict(scans)
    if outcome:
        _finish(ctx, run, outcome, error, budget)
    assert ctx.layout.repo is not None
    _pre_push_proof(ctx, plan_raw, task, run, origin, ctx.layout.repo, budget, profile, policy)
    _finish(ctx, run, "landed", None, budget)


def _maybe_remove_lane_worktree(ctx: Ctx, task: dict, run: _Run, git: Git, worktree: Path | None) -> bool:
    """Step 8: remove the lane worktree only when no other task of the lane in this wave is still to land."""
    if worktree is None:
        return False
    manifest = ctx.layout.wave_manifest(run.wave)
    if not manifest.is_file():
        run.notes.append("lane worktree kept: wave manifest not found")
        return False
    doc = read_json(manifest)
    results = _results()
    for t in (doc or {}).get("tasks") or []:
        if t.get("task") == task["id"] or t.get("lane") != task.get("lane"):
            continue
        if results.landed_receipt(ctx.layout, t["task"]) is None:
            run.notes.append(f"lane worktree kept: {t['task']} of lane {task.get('lane')} is still in the wave")
            return False
    git.worktree_remove_link_safe(worktree)
    return True


def cmd_merge(ctx: Ctx, args: Namespace) -> CommandResult:
    plan_raw = plan_mod.load_raw(ctx.layout)
    task = proof.task_raw(plan_raw, args.task)
    receipt = merge_task(ctx, plan_raw, task, attempt=int(args.attempt), rerun=int(args.rerun or 0), wave=args.wave,
                         worktree=Path(args.worktree).resolve() if args.worktree else None, branch=args.branch,
                         single_tree=bool(args.single_tree),
                         message_file=Path(args.message_file).resolve() if args.message_file else None)
    return CommandResult(data=receipt)


# --- fe-workspace ---------------------------------------------------------------------------------------------------

def fe_workspace(ctx: Ctx, task: str, attempt: int, rerun: int) -> dict:
    """The exclusive worktree of a /frontend critique task per run key (WAVES.md 6.2), idempotently."""
    layout = ctx.layout
    if layout.repo is None:
        raise UsageError("fe-workspace needs the product repository (--repo)")
    plan_raw = plan_mod.load_raw(layout)
    proof.task_raw(plan_raw, task)
    profile = proof.load_profile(layout)
    proof.check_floors(profile, layout.repo)
    key = f"a{attempt}r{rerun}"
    branch = f"exec/{task}-{key}"
    # The parent is checked (outside every work tree); the worktree itself is one once it exists.
    path = scratch_dir(profile, proof.project_slug(profile), "fe") / f"{task}-{key}"
    git = Git(layout.repo)
    reused = False
    with locks.hold(layout, "merge", command="fe-workspace", timeout_s=120):
        git.fetch("origin")
        registered = any(Path(w).resolve() == path.resolve() for w in git.worktrees()) if path.exists() else False
        if registered:
            wt = Git(path)
            if wt.current_branch() == branch and not wt.status_porcelain():
                reused = True
        if not reused:
            if path.exists() or registered:
                git.worktree_remove_link_safe(path)
            git.run("worktree", "prune")
            path.parent.mkdir(parents=True, exist_ok=True)
            exists = git.run("rev-parse", "--verify", "--quiet", f"refs/heads/{branch}", check=False).exit_code == 0
            if exists:
                git.run("worktree", "add", posix(path), branch)
            else:
                git.run("worktree", "add", "-b", branch, posix(path), "origin/main")
    install = {"ran": False, "exit_code": None}
    run_dir = layout.local / "fe-workspace" / f"{task}-{key}"
    run_dir.mkdir(parents=True, exist_ok=True)
    res = proof.run_install(layout, path, run_dir, f"install-fe-{task}-{key}", None)
    install = {"ran": bool(res.get("ran")), "exit_code": res.get("exit_code")}
    return {"worktree": posix(path), "branch": branch, "reused": reused, "install": install}


def cmd_fe_workspace(ctx: Ctx, args: Namespace) -> CommandResult:
    return CommandResult(data=fe_workspace(ctx, args.task, int(args.attempt), int(args.rerun or 0)))


# --- snapshot -------------------------------------------------------------------------------------------------------

def snapshot(ctx: Ctx, task_id: str, attempt: int, rerun: int, globs_: list[str], message_file: Path) -> dict:
    """A commit of origin/main plus the current content of `globs_` (each inside the task's writes), stored at
    refs/exec/<task>/td-a<n>r<k>, without touching any branch, index or file of the checkout."""
    layout = ctx.layout
    if layout.repo is None:
        raise UsageError("snapshot needs the product repository (--repo)")
    plan_raw = plan_mod.load_raw(layout)
    task = proof.task_raw(plan_raw, task_id)
    writes = list(task.get("writes") or [])
    outside = [g for g in globs_ if not any(integrity.glob_contains(w, g) for w in writes)]
    if outside:
        raise CheckFailed(f"snapshot path(s) outside {task_id}'s writes: " + ", ".join(outside), code="E_CHECK",
                          items=[ErrorItem("E_CHECK", f"outside the task's writes: {g}", task=task_id)
                                 for g in outside])
    message_file = Path(message_file)
    if not message_file.is_file():
        raise UsageError(f"--message-file {posix(message_file)} does not exist")
    if gitutil.has_attribution(message_file.read_text(encoding="utf-8", errors="replace")):
        raise PolicyRefused("the snapshot message carries an AI attribution trailer or line", code="E_POLICY")
    profile = proof.load_profile(layout)
    budget = proof.Budget(layout, profile, "snapshot", str(task.get("kind")))  # CLI.md 0.6
    git = Git(layout.repo)
    with budget.step("fetch"):
        git.fetch("origin")
    origin = git.rev_parse("origin/main")
    key = f"td-a{attempt}r{rerun}"
    ref = f"refs/exec/{task_id}/{key}"
    with budget.step("commit"):
        base_blobs = _ls_tree(git, origin)
        cands = set(git.ls_files()) | set(git.untracked()) | set(base_blobs)
        paths = sorted(p for p in cands if integrity.matches_any(p, globs_) and not p.startswith(STATE_PREFIX))
        index = scratch_dir(profile, proof.project_slug(profile), "snapshot", f"idx-{task_id}-{key}")
        sha = build_commit_from_paths(git, origin, paths, message_file, index)
        git.run("update-ref", ref, sha)
    budget.save()
    tree = _ls_tree(git, sha)
    listed = [{"path": p, "blob_sha": tree[p]} for p in paths if p in tree]
    if ctx.executor in ("A", "B"):
        proof.append_event(ctx, "result.recorded", {"task": task_id, "kind": "snapshot", "sha": sha, "ref": ref,
                                                    "paths": len(listed)})
    return {"sha": sha, "ref": ref, "paths": listed}


def cmd_snapshot(ctx: Ctx, args: Namespace) -> CommandResult:
    return CommandResult(data=snapshot(ctx, args.task, int(args.attempt), int(args.rerun or 0), list(args.paths),
                                       Path(args.message_file).resolve()))


__all__ = ["merge_task", "build_commit_from_paths", "integration_worktree", "fe_workspace", "snapshot",
           "changed_write_paths", "cmd_merge", "cmd_snapshot", "cmd_fe_workspace"]
