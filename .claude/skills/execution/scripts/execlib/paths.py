"""Every path exec.py uses (contract/MODULES.md 2, SCHEMAS.md 1.1, README.md 3.2, CLI.md 0.1 and 0.4).

`Layout` holds the state directory's layout; recovery strings carry this machine's absolute exec.py command
(`exec_cmd`). Git is called directly through subprocess here (this is a layer-0 module: it cannot use procutil).
"""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .errors import EnvError, UsageError

SKILL_DIR: Path = Path(__file__).resolve().parents[2]

# In-process override of the sibling skills' root (tests patch it; the CLI never sets it). See the B01 report's
# contract question on a test override for `other_skill`.
_SKILLS_ROOT_OVERRIDE: Path | None = None

STATE_DIRNAME = ".execution"


def skill_path(*parts: str) -> Path:
    return SKILL_DIR.joinpath(*parts)


def other_skill(name: Literal["frontend", "harden", "hackathon"]) -> Path:
    """~/.claude/skills/<name> (README.md 3.2)."""
    if name not in ("frontend", "harden", "hackathon"):
        raise UsageError(f"unknown sibling skill {name!r}")
    root = _SKILLS_ROOT_OVERRIDE if _SKILLS_ROOT_OVERRIDE is not None else Path.home() / ".claude" / "skills"
    return root / name


def posix(p: Path | str) -> str:
    """Forward slashes, drive letter kept."""
    return str(p).replace("\\", "/")


def exec_cmd() -> str:
    """'python "<SKILL_DIR posix>/scripts/exec.py"' for this machine (python3 on POSIX)."""
    py = "python" if os.name == "nt" else "python3"
    return f'{py} "{posix(SKILL_DIR)}/scripts/exec.py"'


def _git_out(args: list[str], cwd: Path) -> tuple[int, str]:
    try:
        proc = subprocess.run(["git", *args], cwd=str(cwd), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=60, check=False)
    except FileNotFoundError as err:
        raise EnvError("git is not installed or not on PATH", code="E_GIT") from err
    except subprocess.TimeoutExpired as err:
        raise EnvError("git rev-parse timed out", code="E_GIT") from err
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace").strip()


def _inside_state_dir(p: Path) -> bool:
    return STATE_DIRNAME in p.parts


def resolve_repo(cwd: Path, override: str | None) -> Path:
    """The main working tree: the parent of `git rev-parse --path-format=absolute --git-common-dir`.

    A call from a linked worktree resolves to its main repository. Refused (UsageError) inside `.execution/`.
    """
    if override:
        repo = Path(override).expanduser().resolve()
        if _inside_state_dir(repo):
            raise UsageError(f"--repo {posix(repo)} lies inside a {STATE_DIRNAME}/ directory",
                             hint="pass the product repository root")
        if not repo.is_dir():
            raise UsageError(f"--repo {posix(repo)} is not a directory")
        return repo
    start = Path(cwd).resolve()
    if _inside_state_dir(start):
        raise UsageError(f"{posix(start)} lies inside a {STATE_DIRNAME}/ directory",
                         hint="run exec.py from the product repository, or pass --repo")
    code, out = _git_out(["rev-parse", "--path-format=absolute", "--git-common-dir"], start)
    if code != 0 or not out:
        raise UsageError(f"{posix(start)} is not inside a git repository", hint="pass --repo DIR")
    common = Path(out)
    if not common.is_absolute():
        common = (start / common).resolve()
    repo = common.resolve().parent
    if _inside_state_dir(repo) or repo.name == STATE_DIRNAME:
        raise UsageError(f"{posix(repo)} is the state repository, not a product repository",
                         hint="run exec.py from the product repository, or pass --repo")
    return repo


def find_repo(cwd: Path) -> Path | None:
    """resolve_repo without an override, but None (not an error) when cwd is not inside a git repository.
    Still refused inside `.execution/`."""
    start = Path(cwd).resolve()
    if _inside_state_dir(start):
        return resolve_repo(start, None)
    code, _out = _git_out(["rev-parse", "--path-format=absolute", "--git-common-dir"], start)
    if code != 0:
        return None
    return resolve_repo(start, None)


@dataclass(frozen=True)
class Layout:
    """Every path of SCHEMAS.md 1.1 for one state directory."""

    repo: Path | None
    state: Path
    plan: Path
    plan_candidate: Path
    planner_draft: Path
    profile: Path
    policy: Path
    catalogue_default: Path
    events: Path
    decisions: Path
    gates_json: Path
    completion_script: Path
    execution_md: Path
    local: Path
    local_state: Path
    active: Path
    hooks_state: Path
    hook_events_dir: Path
    hook_errors: Path
    merge_pending_dir: Path
    timings: Path
    notion_outbox: Path
    harden_ready_dir: Path
    completion_dir: Path
    schedule_cache: Path
    digest: Path

    def proof_run_copy(self, task: str, run_id: str) -> Path:
        return self.state / "proofs" / "runs" / task / f"{run_id}.json"

    def impl_copy(self, task: str, attempt: int) -> Path:
        return self.state / "proofs" / "impl" / f"{task}.a{attempt}.json"

    def merge_copy(self, task: str, attempt: int) -> Path:
        return self.state / "proofs" / "merge" / f"{task}.a{attempt}.json"

    def merge_intent(self, task: str, attempt: int, rerun: int) -> Path:
        return self.merge_pending_dir / f"{task}.a{attempt}r{rerun}.json"

    def status(self, executor: str) -> Path:
        if executor not in ("A", "B"):
            raise UsageError(f"unknown executor {executor!r} (A|B)")
        return self.state / "status" / f"{executor}.json"

    def receipt(self, task: str) -> Path:
        return self.state / "proofs" / f"{task}.json"

    def receipt_history(self, task: str, attempt: int) -> Path:
        return self.state / "proofs" / "history" / f"{task}.a{attempt}.json"

    def result(self, wave: str, task: str | None, role: str, attempt: int) -> Path:
        name = f"{task}.{role}.a{attempt}.json" if task else f"{role}.a{attempt}.json"
        return self.local / "results" / wave / name

    def inbox(self, wave: str) -> Path:
        return self.local / "inbox" / wave

    def proof_run_dir(self, task: str, run_id: str) -> Path:
        return self.local / "proof-runs" / task / run_id

    def merge_gates_dir(self, task: str, attempt: int, rerun: int) -> Path:
        return self.local / "merge-gates" / f"{task}-a{attempt}r{rerun}" / "gates"

    def answer(self, key: str) -> Path:
        return self.state / "answers" / f"{key}.md"

    def wave_script(self, wave: str) -> Path:
        return self.state / "waves" / f"{wave}.js"

    def wave_manifest(self, wave: str) -> Path:
        return self.state / "waves" / f"{wave}.json"

    def brief(self, task: str, attempt: int) -> Path:
        return self.state / "briefs" / f"{task}.a{attempt}.md"

    def report(self, wave: str) -> Path:
        return self.state / "reports" / f"{wave}.fr.md"

    def lock(self, name: str) -> Path:
        return self.local / "locks" / name

    def notion_batch(self, batch_id: str) -> Path:
        return self.local / "notion" / "batches" / f"{batch_id}.json"

    def rel(self, path: Path) -> str:
        """A state-relative POSIX path (for evidence lists and receipts)."""
        return posix(Path(path).resolve().relative_to(self.state.resolve()))


def layout_for(repo: Path | None, state: Path | None) -> Layout:
    """The layout of `state` (default `<repo>/.execution`); UsageError when neither is known."""
    if state is None:
        if repo is None:
            raise UsageError("no state directory: pass --state DIR or run inside the product repository")
        state = Path(repo) / STATE_DIRNAME
    st = Path(state).expanduser()
    st = st.resolve() if st.exists() else Path(os.path.abspath(st))
    local = st / "local"
    return Layout(
        repo=Path(repo).resolve() if repo is not None else None,
        state=st,
        plan=st / "plan.json",
        plan_candidate=local / "plan.candidate.json",
        planner_draft=local / "planner" / "plan.draft.json",
        profile=st / "profile.json",
        policy=st / "policy.json",
        catalogue_default=st / "feature-catalogue.json",
        events=st / "events.jsonl",
        decisions=st / "decisions.md",
        gates_json=st / "gates.json",
        completion_script=st / "completion-check.mjs",
        execution_md=st / "EXECUTION.md",
        local=local,
        local_state=local / "state.json",
        active=local / "active",
        hooks_state=local / "hooks-state.json",
        hook_events_dir=local / "hook-events",
        hook_errors=local / "hook-errors.log",
        merge_pending_dir=local / "merge-pending",
        timings=local / "timings.json",
        notion_outbox=local / "notion" / "outbox.jsonl",
        harden_ready_dir=local / "harden-ready",
        completion_dir=local / "completion",
        schedule_cache=local / "schedule.json",
        digest=local / "digest.txt",
    )


def _nearest_existing(p: Path) -> Path:
    cur = Path(os.path.abspath(p))
    while not cur.exists():
        if cur.parent == cur:
            break
        cur = cur.parent
    return cur


def inside_work_tree(p: Path) -> bool:
    """True when `p` (or its nearest existing parent) lies inside a git work tree."""
    base = _nearest_existing(p)
    if base.is_file():
        base = base.parent
    code, out = _git_out(["rev-parse", "--is-inside-work-tree"], base)
    return code == 0 and out == "true"


def scratch_dir(profile: dict, project: str, *parts: str) -> Path:
    """<profile.machine.scratch_root>/<project>/<parts>; refused (UsageError) inside a git work tree (CLI.md 0.4)."""
    try:
        root = profile["machine"]["scratch_root"]
    except (KeyError, TypeError) as err:
        raise UsageError("profile.machine.scratch_root is not set") from err
    path = Path(root) / project
    for part in parts:
        path = path / part
    if inside_work_tree(path):
        raise UsageError(f"scratch path {posix(path)} lies inside a git work tree",
                         hint="set profile.machine.scratch_root to a short directory outside every repository")
    return path


# --- link-safe removal (junctions and symlinks are unlinked, never followed) -------------------------------------

_REPARSE = 0x400  # FILE_ATTRIBUTE_REPARSE_POINT


def is_link_like(p: Path) -> bool:
    """A symlink or (Windows) a junction / reparse point."""
    try:
        st = os.lstat(p)
    except FileNotFoundError:
        return False
    if stat.S_ISLNK(st.st_mode):
        return True
    attrs = getattr(st, "st_file_attributes", 0)
    return bool(attrs & _REPARSE)


def _unlink_link(p: Path) -> None:
    try:
        os.unlink(p)
    except (IsADirectoryError, PermissionError, OSError):
        os.rmdir(p)  # a directory junction or directory symlink: removes the link, never the target


def rmtree_link_safe(path: Path) -> None:
    """Remove a tree, unlinking junctions and symlinks first so their targets are never touched."""
    root = Path(path)
    if not os.path.lexists(root):
        return
    if is_link_like(root):
        _unlink_link(root)
        return
    for dirpath, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        keep: list[str] = []
        for d in dirnames:
            full = Path(dirpath) / d
            if is_link_like(full):
                _unlink_link(full)
            else:
                keep.append(d)
        dirnames[:] = keep
        for f in filenames:
            full = Path(dirpath) / f
            if is_link_like(full):
                _unlink_link(full)

    def _onerror(func, p, _exc):  # type: ignore[no-untyped-def]
        os.chmod(p, stat.S_IWRITE)
        func(p)

    if sys.version_info >= (3, 12):
        shutil.rmtree(root, onexc=_onerror)
    else:  # pragma: no cover - Python 3.11
        shutil.rmtree(root, onerror=_onerror)
