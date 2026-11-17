"""`exec.py sync`: commit own state changes, rebase on the remote, re-validate, push (contract/CLI.md 1, TWO-DEV.md
2.2-2.4).

(1) fetch without the state lock; (2) under the state lock (lock order: git-state, then state) stage the changed
paths this executor owns (TWO-DEV.md 2.2, explicit pathspecs, never -A), run the secret scan with its positive
control on the staged diff (a hit: exit 4 E_SECRET_IN_STATE, the file moved to local/quarantine/ and nothing
committed), commit with a message file; (3) still under the lock, rebase on origin/main (events.jsonl, decisions.md
and public-values.jsonl merge by union; any other conflict aborts: E_STATE_CONFLICT); (4) re-validate plan.json when
it changed; (5) check the remote is private, then push HEAD:main (never --force); a non-fast-forward rejection loops
to (1), at most 3 times (E_CAS_REJECTED).

Proven-public values (README.md 8, owner decision 2026-10-02): the scan gets `integrity.load_public_values(layout)`
as `public`, so a value listed in public-values.jsonl, or one inside an explorer link, is not a hit; every other
secret-shaped value still is.
"""
from __future__ import annotations

import functools
import importlib
import json
import random
import re
import shutil
from argparse import Namespace
from collections import Counter
from pathlib import Path
from typing import Any

from . import clock, jsonio, locks, paths
from . import events as events_mod
from . import plan as plan_mod
from .errors import CasRejected, CheckFailed, ErrorItem, InternalError, PolicyRefused, ValidationFailed
from .gitutil import Git, remote_is_private
from .log import get_logger
from .model import CommandResult, Ctx

_LOG = get_logger("execlib.syncstate")
MAX_PUSH_ATTEMPTS = 3
PUBLIC_VALUES = "public-values.jsonl"
# The append-only files both executors write, merged by union (SCHEMAS.md 1.1). public-values.jsonl is appended by
# `answers ingest` and `proof run` on either machine (SCHEMAS.md 5.1); TWO-DEV.md 2.2 does not list it yet (Q-B08-16).
UNION_FILES = ("events.jsonl", "decisions.md", PUBLIC_VALUES)
# The JSON-lines union files: pending lines are set aside and restored one by one, each deduplicated on restore.
# decisions.md is set aside as one block.
LINE_UNION_FILES = ("events.jsonl", PUBLIC_VALUES)
A_ONLY = (".gitattributes", ".gitignore", "plan.json", "gates.json", "feature-catalogue.json", "profile.json",
          "policy.json", "completion-check.mjs", "EXECUTION.md", "harden-profile.draft.json")


# --- ownership (TWO-DEV.md 2.2) --------------------------------------------------------------------------------------

def _task_executors(state_dir: Path) -> dict[str, str]:
    try:
        raw = jsonio.read_json(state_dir / "plan.json")
    except (FileNotFoundError, ValidationFailed):
        return {}
    out: dict[str, str] = {}
    for t in raw.get("tasks", []) if isinstance(raw, dict) else []:
        if isinstance(t, dict) and isinstance(t.get("id"), str):
            out[t["id"]] = str(t.get("executor") or "A")
    return out


def _frontend_executor(state_dir: Path) -> str:
    try:
        raw = jsonio.read_json(state_dir / "plan.json")
    except (FileNotFoundError, ValidationFailed):
        return "A"
    for t in raw.get("tasks", []) if isinstance(raw, dict) else []:
        if isinstance(t, dict) and any(str(w).startswith(".execution/frontend") for w in t.get("writes") or []):
            return str(t.get("executor") or "A")
    return "A"


def owner_of(rel: str, tasks: dict[str, str], frontend_executor: str) -> str | None:
    """The executor that commits `rel` ('both' for the union files), or None for a path no rule names."""
    if rel in UNION_FILES:
        return "both"
    if rel in A_ONLY or rel.startswith("fix/"):
        return "A"
    m = re.match(r"^status/([AB])\.json$", rel)
    if m:
        return m.group(1)
    m = re.match(r"^(?:waves|reports)/W(\d+)\b", rel)
    if m:
        return "A" if int(m.group(1)) < 500 else "B"
    m = re.match(r"^(?:proofs/(?:history/|runs/|impl/|merge/)?|briefs/)(T\d{3,})(?!\d)", rel)
    if m:
        return tasks.get(m.group(1))
    m = re.match(r"^answers/(T\d{3,}|D-(\d{3,}))(?!\d)", rel)
    if m:
        if m.group(2):
            return "A" if int(m.group(2)) < 500 else "B"
        return tasks.get(m.group(1))
    if rel.startswith("frontend/"):
        return frontend_executor
    return None


def _porcelain_paths(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        if len(line) < 4:
            continue
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path.startswith('"') and path.endswith('"'):
            path = json.loads(path)
        out.append(path)
    return sorted(set(out))


def split_own(changed: list[str], executor: str, state_dir: Path) -> tuple[list[str], list[str], list[str]]:
    """(own paths, paths the other executor owns, paths no rule of TWO-DEV.md 2.2 names)."""
    tasks = _task_executors(state_dir)
    fe = _frontend_executor(state_dir)
    own: list[str] = []
    foreign: list[str] = []
    unowned: list[str] = []
    for rel in changed:
        who = owner_of(rel, tasks, fe)
        if who == "both" or who == executor:
            own.append(rel)
        elif who is None:
            unowned.append(rel)
        else:
            foreign.append(rel)
    return own, foreign, unowned


# --- the secret scan -------------------------------------------------------------------------------------------------

def staged_added_lines(git: Git) -> list[tuple[str, int, str]]:
    out = git.run("diff", "--cached", "-U0", "--no-color", "--no-ext-diff").stdout
    added: list[tuple[str, int, str]] = []
    current = ""
    line_no = 0
    for line in out.split("\n"):
        if line.startswith("+++ "):
            current = line[6:] if line.startswith("+++ b/") else line[4:]
            continue
        m = re.match(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", line)
        if m:
            line_no = int(m.group(1))
            continue
        if line.startswith("+") and not line.startswith("+++"):
            added.append((current, line_no, line[1:]))
            line_no += 1
    return added


def _planted_key_lines() -> list[tuple[str, int, str]]:
    rng = random.Random(20261001)
    key = "0x" + "".join(rng.choice("0123456789abcdef") for _ in range(64))
    return [("planted/positive-control.json", 1, f'{{"evidence": "{key}"}}')]


def _integrity() -> Any:
    """execlib.integrity (lane B06), imported when first used: sync never commits unscanned state."""
    try:
        return importlib.import_module("execlib.integrity")
    except ModuleNotFoundError as err:
        if err.name != "execlib.integrity":
            raise
        raise InternalError("the secret scan (execlib.integrity, lane B06) is absent: sync never commits unscanned "
                            "state", code="E_NOT_IMPLEMENTED") from err


def public_values(layout: paths.Layout) -> frozenset[str]:
    """The state repository's proven-public values (README.md 8): `integrity.load_public_values(layout)`. It reads
    public-values.jsonl as it is on disk, so a value that `answers ingest` or `proof run` registered since the last
    sync clears the commit that carries it."""
    loader = getattr(_integrity(), "load_public_values", None)
    if loader is None:
        raise InternalError("integrity.load_public_values (lane B06, contract revision 3) is absent: sync cannot "
                            "apply the proven-public exemption of README.md 8", code="E_NOT_IMPLEMENTED")
    return frozenset(loader(layout))


def secret_hits(added: list[tuple[str, int, str]], *, public: frozenset[str] = frozenset()
                ) -> tuple[list[str], dict]:
    """Files whose added lines hold a secret shape, through integrity.scan_secrets with its positive control.

    `public` is the proven-public set (`public_values`): a listed value, or a value inside an explorer link, is not a
    hit; every other secret shape is (README.md 8). The positive control runs the scanner with the same `public` on a
    planted key that is not listed, so an exemption that cleared every value would make the scan blind and stop the
    sync."""
    integrity = _integrity()
    scan = functools.partial(integrity.scan_secrets, public=public)
    control = integrity.with_positive_control(scan, _planted_key_lines(), [])
    pc = getattr(control, "positive_control", None) or {}
    if getattr(control, "state", None) == "fail" or not pc.get("caught", True):
        raise InternalError(f"the secret scan is blind (its positive control was not caught): {control.detail}",
                            code="E_INTERNAL")
    by_file: dict[str, list[tuple[str, int, str]]] = {}
    for item in added:
        by_file.setdefault(item[0], []).append(item)
    hits = [f for f, lines in sorted(by_file.items()) if scan(lines).state == "fail"]
    return hits, {"id": "secrets", "state": "fail" if hits else "ok", "positive_control": pc or None}


def _quarantine(git: Git, state_dir: Path, rel: str, tracked: bool) -> str:
    src = state_dir / rel
    dest = state_dir / "local" / "quarantine" / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    git.run("reset", "--quiet", "--", rel, check=False)
    if src.exists():
        shutil.move(str(src), str(dest))
    if tracked:
        git.run("checkout", "HEAD", "--", rel, check=False)
    return paths.posix(dest)


# --- steps -----------------------------------------------------------------------------------------------------------

def _summary(added: list[tuple[str, int, str]], own: list[str]) -> str:
    types: Counter[str] = Counter()
    for f, _n, text in added:
        if f == "events.jsonl":
            try:
                types[str(json.loads(text).get("type"))] += 1
            except (json.JSONDecodeError, AttributeError):
                continue
    if types:
        return ", ".join(f"{t} x{n}" for t, n in sorted(types.items(), key=lambda kv: (-kv[1], kv[0]))[:4])
    tops = sorted({p.split("/")[0] for p in own})
    return "update " + ", ".join(tops[:4])


def _has_origin(git: Git) -> bool:
    return git.run("remote", "get-url", "origin", check=False).exit_code == 0


def _rev(git: Git, ref: str) -> str | None:
    res = git.run("rev-parse", "--verify", "--quiet", ref + "^{commit}", check=False)
    return res.stdout.strip() if res.exit_code == 0 else None


def _commit_own(ctx: Ctx, git: Git, executor: str) -> tuple[str | None, list[str], list[str]]:
    sd = ctx.layout.state
    changed = _porcelain_paths(git.status_porcelain())
    own, foreign, unowned = split_own(changed, executor, sd)
    if foreign:
        # TWO-DEV.md 2.2: a path of the other executor written here is a contract violation, never committed
        raise CheckFailed(f"{len(foreign)} changed state file(s) belong to the other executor: nothing committed "
                          "(two writers touched one file)", code="E_STATE_CONFLICT",
                          items=[ErrorItem("E_STATE_CONFLICT", "written by the wrong executor", path=f)
                                 for f in foreign],
                          data={"conflict_files": foreign, "committed": None,
                                "decision_draft": {"kind": "resources", "title": "State files written by the wrong "
                                                   "executor: " + ", ".join(foreign)[:100]}})
    if not own:
        return None, [], unowned
    git.run("add", "--", *own)
    added = staged_added_lines(git)
    hits, _scan = secret_hits(added, public=public_values(ctx.layout))
    if hits:
        tracked = set(git.ls_files(*hits))
        moved = [_quarantine(git, sd, rel, rel in tracked) for rel in hits]
        git.run("reset", "--quiet", "--", *own, check=False)
        raise PolicyRefused(f"a secret shape in {len(hits)} staged state file(s): nothing committed, the file(s) "
                            "moved to local/quarantine/", code="E_SECRET_IN_STATE",
                            items=[ErrorItem("E_SECRET_IN_STATE", "secret shape in a staged state file", path=h)
                                   for h in hits],
                            data={"quarantined": moved, "files": hits, "decision_draft": {
                                "kind": "policy-exception",
                                "title": "Secret shape found in the state repository by sync",
                                "options": [{"id": "purge", "label": "Purge and rotate",
                                             "consequence": "the files stay quarantined; rotate the secret"},
                                            {"id": "restore", "label": "Restore (false positive)",
                                             "consequence": "move the files back and commit them"}]}})
    message = f"chore(state): {executor} {clock.stamp(ctx.now)} {_summary(added, own)}"
    sha = git.commit_paths(own, message, scratch=ctx.layout.local)
    return sha, own, unowned


def _set_aside_union(git: Git, sd: Path) -> dict[str, list[str]]:
    """Uncommitted lines of the union files (events.jsonl, decisions.md, public-values.jsonl), set aside so the
    rebase meets a clean file (an untracked or modified union file would stop it); `_restore_union` appends them back
    afterwards.

    The three files are append-only (SCHEMAS.md 1.1 and 5.1). An uncommitted change that is not a pure append of
    HEAD (an edited or deleted line) cannot be set aside and replayed without duplicating or losing text, so it is
    refused with E_STATE_CONFLICT before anything is touched. A pure append is set aside whole: the new lines of the
    JSON-lines files one by one (each is deduplicated on restore), the tail of decisions.md as one block with its
    newlines."""
    found: list[tuple[str, Path, str | None, str]] = []
    edited: list[str] = []
    for rel in UNION_FILES:
        path = sd / rel
        if not path.exists():
            continue
        work = path.read_text(encoding="utf-8")
        res = git.run("show", f"HEAD:{rel}", check=False)
        head = res.stdout if res.exit_code == 0 else None
        if head is not None and work == head:
            continue
        base = head or ""
        if not work.startswith(base):
            edited.append(rel)
            continue
        found.append((rel, path, head, work[len(base):]))
    if edited:
        raise CheckFailed("an uncommitted change to an append-only state file is not a pure append (a line was "
                          "edited or removed): nothing was set aside and the rebase did not start",
                          code="E_STATE_CONFLICT",
                          items=[ErrorItem("E_STATE_CONFLICT", "append-only file changed in place", path=rel)
                                 for rel in edited],
                          hint="restore the edited lines (git -C <state> diff shows them), then sync again",
                          data={"conflict_files": edited, "committed": None,
                                "decision_draft": {"kind": "resources",
                                                   "title": "Append-only state file edited in place: "
                                                            + ", ".join(edited)[:120]}})
    pending: dict[str, list[str]] = {}
    for rel, path, head, extra in found:
        if rel in LINE_UNION_FILES:
            pending[rel] = [ln for ln in extra.split("\n") if ln.strip()]
        else:
            pending[rel] = [extra] if extra.strip() else []
        if head is None:
            path.unlink()
        else:
            git.run("checkout", "HEAD", "--", rel)
    return pending


def _restore_union(sd: Path, pending: dict[str, list[str]]) -> None:
    for rel, lines in pending.items():
        if not lines:
            continue
        path = sd / rel
        current = path.read_text(encoding="utf-8") if path.exists() else ""
        if current and not current.endswith("\n"):
            current += "\n"
        if rel in LINE_UNION_FILES:
            have = set(current.split("\n"))
            add = [ln for ln in lines if ln not in have]
            text = current + "".join(ln + "\n" for ln in add)
        else:
            # decisions.md: each entry is one appended block, restored verbatim (its own newlines kept), skipped
            # when the rebased file already carries it
            add = [blk for blk in lines if blk.strip() and blk.strip() not in current]
            text = current + "".join(blk if blk.endswith("\n") else blk + "\n" for blk in add)
        jsonio.write_text_atomic(path, text)


def _rebase(git: Git) -> tuple[bool, list[str]]:
    if _rev(git, "origin/main") is None:
        return True, []
    pending = _set_aside_union(git, git.cwd)
    try:
        res = git.run("rebase", "--autostash", "origin/main", check=False)
        if res.exit_code == 0:
            return True, []
        conflicts = git.run("diff", "--name-only", "--diff-filter=U", "-z", check=False).stdout
        files = sorted(p for p in conflicts.split("\0") if p)
        git.run("rebase", "--abort", check=False)
        if not files:
            files = [(res.stderr or res.stdout).strip()[-200:] or "rebase failed"]
        return False, files
    finally:
        _restore_union(git.cwd, pending)


def _revalidate(ctx: Ctx) -> dict:
    """plan.json against its schema and, when lane B02's validate is present, every invariant (P-26 included)."""
    raw = plan_mod.load_raw(ctx.layout)
    report: dict[str, Any] = {"schema": "ok", "invariants": "not-run", "plan_version": raw.get("plan_version")}
    try:
        validate = importlib.import_module("execlib.validate")
    except ModuleNotFoundError as err:
        if err.name != "execlib.validate":
            raise
        _LOG.warning("plan invariants not re-validated: execlib.validate (lane B02) is absent",
                     extra={"data": {"plan_version": raw.get("plan_version")}})
        return report
    statuses: dict[str, dict] = {}
    for ex in ("A", "B"):
        p = ctx.layout.status(ex)
        if p.exists():
            statuses[ex] = jsonio.read_json(p)
    profile = jsonio.read_json(ctx.layout.profile) if ctx.layout.profile.exists() else None
    policy = jsonio.read_json(ctx.layout.policy) if ctx.layout.policy.exists() else None
    present = {name: paths.other_skill(name).exists() for name in ("frontend", "harden", "hackathon")}
    vctx = validate.VContext(profile=profile, policy=policy, statuses=statuses, now=ctx.now, skills_present=present)
    vrep = validate.validate_plan(raw, vctx)
    if vrep.errors:
        tampered = any(e.code == "E_PLAN_TAMPERED" for e in vrep.errors)
        raise CheckFailed("the merged plan is invalid: launching stops until a decision resolves it",
                          code="E_PLAN_TAMPERED" if tampered else "E_PLAN_INVALID", items=list(vrep.errors)[:20],
                          data={"plan_version": raw.get("plan_version")})
    report["invariants"] = "ok"
    return report


def _other_liveness(git: Git, ctx: Ctx, executor: str) -> tuple[int | None, str | None]:
    other = "B" if executor == "A" else "A"
    seq = None
    p = ctx.layout.status(other)
    if p.exists():
        try:
            seq = jsonio.read_json(p).get("seq")
        except ValidationFailed:
            seq = None
    ref = "origin/main" if _rev(git, "origin/main") else "HEAD"
    if _rev(git, ref) is None:
        return seq, None
    stamps: list[int] = []
    for args in (["log", "-1", "--format=%ct", "--extended-regexp", f"--grep=^chore\\(state\\): {other} ", ref],
                 ["log", "-1", "--format=%ct", ref, "--", f"status/{other}.json"]):
        out = git.run(*args, check=False).stdout.strip()
        if out.isdigit():
            stamps.append(int(out))
    if not stamps:
        return seq, None
    return seq, clock.format_utc(clock.from_epoch(max(stamps)))


def sync(ctx: Ctx, pull_only: bool, push_only: bool) -> dict:
    executor = ctx.executor
    if executor not in ("A", "B"):
        raise CheckFailed("no executor: run exec.py init first", code="E_STATE_INVALID")
    sd = ctx.layout.state
    if not (sd / ".git").exists():
        raise CheckFailed(f"{paths.posix(sd)} is not a git repository", code="E_STATE_INVALID",
                          hint="run exec.py init first")
    git = Git(sd)
    origin = _has_origin(git)
    remote_url = git.run("remote", "get-url", "origin", check=False).stdout.strip() if origin else None
    committed: str | None = None
    committed_paths: list[str] = []
    unowned: list[str] = []
    pushed = False
    plan_changed = False
    pulled: list[str] = []
    plan_report: dict | None = None
    attempts = 0
    with locks.hold(ctx.layout, "git-state", command=ctx.command):
        while True:
            attempts += 1
            if origin and not (push_only and attempts == 1):
                git.run("fetch", "--quiet", "origin")
            plan_before = jsonio.sha256_file(ctx.layout.plan) if ctx.layout.plan.exists() else None
            head_before = _rev(git, "HEAD")
            with locks.hold(ctx.layout, "state", command=ctx.command):
                if not pull_only and attempts == 1:
                    committed, committed_paths, unowned = _commit_own(ctx, git, executor)
                if origin and not (push_only and attempts == 1):
                    try:
                        ok, conflicts = _rebase(git)
                    except CheckFailed as err:
                        if err.code == "E_STATE_CONFLICT" and isinstance(err.data, dict):
                            err.data["committed"] = committed
                        raise
                    if not ok:
                        raise CheckFailed("rebase conflict on a file two writers touched (a contract violation): "
                                          "the rebase was aborted", code="E_STATE_CONFLICT",
                                          items=[ErrorItem("E_STATE_CONFLICT", "conflicting state file", path=c)
                                                 for c in conflicts],
                                          data={"conflict_files": conflicts, "committed": committed,
                                                "decision_draft": {"kind": "resources",
                                                                   "title": "State repository conflict: "
                                                                            + ", ".join(conflicts)[:120]}})
            head_after = _rev(git, "HEAD")
            if head_before and head_after and head_before != head_after:
                pulled = [head_before, head_after]
            plan_after = jsonio.sha256_file(ctx.layout.plan) if ctx.layout.plan.exists() else None
            if plan_after != plan_before and plan_after is not None:
                plan_changed = True
                plan_report = _revalidate(ctx)
            if pull_only or not origin:
                break
            if remote_is_private(remote_url or "") is not True:
                raise PolicyRefused("the state remote is not confirmed private: nothing pushed",
                                    code="E_STATE_REMOTE_PUBLIC")
            if head_after is None:
                break
            if _rev(git, "origin/main") == head_after:
                break
            outcome = git.push_head("main")
            if outcome.ok:
                pushed = True
                break
            if not outcome.rejected_non_ff:
                raise CheckFailed(f"push refused: {outcome.stderr_tail[-300:]}", code="E_GIT")
            if attempts >= MAX_PUSH_ATTEMPTS:
                raise CasRejected(f"push rejected {attempts} times (non-fast-forward): retry at the next tick",
                                  code="E_CAS_REJECTED")
    plan_version = None
    if ctx.layout.plan.exists():
        try:
            plan_version = jsonio.read_json(ctx.layout.plan).get("plan_version")
        except ValidationFailed:
            plan_version = None
    seq, last_commit = _other_liveness(git, ctx, executor)
    data = {"pulled": pulled, "committed": committed, "committed_paths": committed_paths,
            "unowned_changes": unowned, "pushed": pushed, "plan_changed": plan_changed, "plan_version": plan_version,
            "plan_validation": plan_report, "other_executor_status_seq": seq,
            "other_executor_last_commit_utc": last_commit, "push_attempts": attempts if not pull_only else 0}
    with locks.hold(ctx.layout, "state", command=ctx.command):
        events_mod.append(ctx, "sync", {"committed": committed, "pushed": pushed, "plan_changed": plan_changed,
                                        "pulled": pulled, "unowned_changes": len(unowned)})
    return data


def cmd_sync(ctx: Ctx, args: Namespace) -> CommandResult:
    pull_only = bool(getattr(args, "pull_only", False))
    push_only = bool(getattr(args, "push_only", False))
    if pull_only and push_only:
        from .errors import UsageError
        raise UsageError("--pull-only and --push-only exclude each other")
    return CommandResult(data=sync(ctx, pull_only, push_only))
