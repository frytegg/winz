"""`exec.py init`: create or join a project's state repository (contract/CLI.md 1, SCHEMAS.md 1.1, TWO-DEV.md 2).

The state directory (`<repo>/.execution/`, or `--state DIR` with `--pre-t0`) is its own git repository, cloned from
`--state-remote` when that remote has content, else created with the remote as origin. A remote must be private
(owner decision Q2): a local path or `file://` counts as private; anything `gh` cannot confirm is refused before
anything is cloned or pushed. In the product repository: the `.git/info/exclude` lines, `core.longpaths=true`, and
the portable commit-msg hook (`.githooks/commit-msg` + `core.hooksPath=.githooks`). `--import-from DIR` copies a
pre-T0 state's knowledge files and its frontend folder (never a plan as approved). Idempotent.
"""
from __future__ import annotations

import dataclasses
import os
import re
import shutil
from argparse import Namespace
from pathlib import Path

from . import clock, jsonio, paths, state
from . import events as events_mod
from .errors import CheckFailed, PolicyRefused, UsageError
from .gitutil import Git, remote_is_private
from .model import CommandResult, Ctx

PROJECT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
STATE_DIRS = ("status", "proofs/history", "proofs/runs", "proofs/impl", "proofs/merge", "answers", "briefs", "waves",
              "reports", "fix", "frontend", "local/locks", "local/results", "local/inbox", "local/proof-runs",
              "local/notion/batches", "local/planner", "local/merge-gates", "local/merge-pending",
              "local/hook-events", "local/probe", "local/fix")
EXCLUDES = (".execution/", ".claude/settings.local.json", ".claude/worktrees/")
KNOWLEDGE_FILES = ("profile.json", "policy.json", "decisions.md")
KNOWLEDGE_DIRS = ("answers",)
FRONTEND_SKIP = ("captures", "gates")

# The state lock through state's own import of locks (MODULES.md 8 lists initcmd -> gitutil, state, events;
# contract question Q-B08-5).
hold_lock = state.locks.hold


def _asset(*parts: str) -> Path:
    return paths.skill_path("assets", *parts)


def _write_if_different(path: Path, data: bytes) -> bool:
    if path.exists() and path.read_bytes() == data:
        return False
    jsonio.write_text_atomic(path, data.decode("utf-8"))
    return True


def remote_has_content(remote: str) -> bool:
    res = Git(Path.cwd()).run("ls-remote", "--heads", remote, check=False)
    if res.exit_code != 0:
        raise CheckFailed(f"the state remote cannot be read: {(res.stderr or '').strip()[-200:]}", code="E_GIT")
    return bool(res.stdout.strip())


def install_commit_msg_hook(git: Git) -> str:
    """Write <repo>/.githooks/commit-msg from the asset when absent or different, set core.hooksPath=.githooks and
    the executable bit once tracked. Returns written|current."""
    repo = git.cwd
    target = repo / ".githooks" / "commit-msg"
    data = _asset("githooks", "commit-msg").read_bytes()
    written = _write_if_different(target, data)
    try:
        os.chmod(target, 0o755)
    except OSError:
        pass
    if git.config_get("core.hooksPath") != ".githooks":
        git.config_set("core.hooksPath", ".githooks")
    if git.ls_files(".githooks/commit-msg"):
        git.run("update-index", "--chmod=+x", "--", ".githooks/commit-msg", check=False)
    return "written" if written else "current"


def _copy_tree(src: Path, dest: Path, rel_base: Path, files: list[dict], conflicts: list[str],
               skip_top: tuple[str, ...] = ()) -> None:
    for root, dirnames, filenames in os.walk(src):
        rel_root = Path(root).relative_to(src)
        if rel_root == Path("."):
            dirnames[:] = [d for d in dirnames if d not in skip_top]
        dirnames[:] = [d for d in dirnames if not paths.is_link_like(Path(root) / d)]
        for name in sorted(filenames):
            s = Path(root) / name
            d = dest / rel_root / name
            rel = paths.posix(d.relative_to(rel_base))
            data = s.read_bytes()
            if d.exists():
                if d.read_bytes() != data:
                    conflicts.append(rel)
                continue
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(s, d)
            files.append({"path": rel, "sha256": jsonio.sha256_bytes(data)})


def import_pre_t0(layout: paths.Layout, source: Path, now_text: str) -> dict:
    """Copy the knowledge files and the frontend folder of a pre-T0 state; record them in local/import.json."""
    src = Path(source).resolve()
    if not src.is_dir():
        raise UsageError(f"--import-from {paths.posix(src)} is not a directory")
    files: list[dict] = []
    conflicts: list[str] = []
    skipped: list[str] = []
    for name in KNOWLEDGE_FILES:
        s = src / name
        if not s.is_file():
            continue
        d = layout.state / name
        data = s.read_bytes()
        if d.exists():
            if d.read_bytes() != data:
                conflicts.append(name)
            continue
        shutil.copyfile(s, d)
        files.append({"path": name, "sha256": jsonio.sha256_bytes(data)})
    for name in KNOWLEDGE_DIRS:
        if (src / name).is_dir():
            _copy_tree(src / name, layout.state / name, layout.state, files, conflicts)
    if (src / "plan.json").exists():
        skipped.append("plan.json (a pre-T0 plan is never imported: the plan is instantiated and approved at T0)")
    # FRONTEND.md 11: /frontend's pre-T0 state is <private_dir>/frontend/, the sibling of the pre-T0 execution state;
    # a frontend/ folder inside the imported state is used only when that sibling does not exist
    front = src.parent / "frontend" if (src.parent / "frontend").is_dir() else src / "frontend"
    if front.is_dir():
        _copy_tree(front, layout.state / "frontend", layout.state, files, conflicts, skip_top=FRONTEND_SKIP)
    record = {"imported_utc": now_text, "from": paths.posix(src),
              "frontend_from": paths.posix(front) if front.is_dir() else None,
              "files": sorted(files, key=lambda f: f["path"]), "conflicts": sorted(conflicts), "skipped": skipped}
    previous = jsonio.read_json(layout.local / "import.json") if (layout.local / "import.json").exists() else None
    if previous is not None and not files:
        record["files"] = previous.get("files", [])
        record["imported_utc"] = previous.get("imported_utc", now_text)
    jsonio.write_json_atomic(layout.local / "import.json", record)
    return record


def init_state(ctx: Ctx, project: str, executor: str, state_remote: str | None, pre_t0: bool,
               import_from: str | None) -> dict:
    if not PROJECT_RE.match(project or ""):
        raise UsageError(f"--project {project!r} is not a slug (^[a-z0-9][a-z0-9-]{{1,40}}$)")
    if executor not in ("A", "B"):
        raise UsageError("--executor A|B is required for init")
    layout = ctx.layout
    repo = layout.repo
    if not pre_t0 and repo is None:
        raise UsageError("init needs the product repository", hint="run from the repo, pass --repo, or use --pre-t0 "
                                                                   "--state DIR")
    sd = layout.state
    private: bool | None = None
    if state_remote:
        private = remote_is_private(state_remote)
        if private is not True:
            raise PolicyRefused("the state remote is not confirmed private: nothing cloned or pushed",
                                code="E_STATE_REMOTE_PUBLIC",
                                hint="use a private GitHub repository (gh repo create --private) or a local path")
    if layout.local_state.exists():
        st = state.load(layout)
        if st.get("project") != project or st.get("executor") != executor:
            raise CheckFailed(f"{paths.posix(sd)} belongs to project {st.get('project')} executor {st.get('executor')}",
                              code="E_STATE_MISMATCH")
    created = False
    cloned = False
    if not (sd / ".git").exists():
        if state_remote and remote_has_content(state_remote):
            if sd.exists() and any(sd.iterdir()):
                raise UsageError(f"{paths.posix(sd)} exists and is not a git repository: cannot clone into it")
            Git(sd.parent if sd.parent.exists() else Path.cwd()).run(
                "-c", "core.longpaths=true", "clone", "--quiet", "--config", "core.longpaths=true", state_remote,
                paths.posix(sd))
            cloned = True
        else:
            sd.mkdir(parents=True, exist_ok=True)
            Git(sd).run("init", "--quiet", "-b", "main")
            created = True
            if state_remote:
                Git(sd).run("remote", "add", "origin", state_remote)
    sgit = Git(sd)
    for key, value in (("core.autocrlf", "false"), ("core.longpaths", "true")):
        if sgit.config_get(key) != value:
            sgit.config_set(key, value)
    written_meta = []
    for asset, name in (("gitattributes", ".gitattributes"), ("gitignore", ".gitignore")):
        if _write_if_different(sd / name, _asset("state-repo", asset).read_bytes()):
            written_meta.append(name)
    for d in STATE_DIRS:
        (sd / d).mkdir(parents=True, exist_ok=True)
    ectx = dataclasses.replace(ctx, executor=executor)
    new_local = False
    with hold_lock(layout, "state", command=ctx.command):
        if not layout.local_state.exists():
            st = state.default(executor, project, ctx.now)
            state.save(ectx, st)
            new_local = True
            events_mod.append(ectx, "run.init", {"project": project, "executor": executor, "pre_t0": pre_t0,
                                                 "cloned": cloned, "state_remote": state_remote})
            events_mod.append(ectx, "run.state", {"from": None, "to": "INIT", "reason": "init"})
    if created or written_meta:
        to_commit = [n for n in (".gitattributes", ".gitignore") if (sd / n).exists()]
        if sgit.status_porcelain():
            sgit.commit_paths(to_commit, f"chore(state): {executor} {clock.stamp(ctx.now)} init {project}",
                              scratch=layout.local)
    pushed = False
    if created and state_remote and sgit.head() is not None:
        outcome = sgit.push_head("main")
        if not outcome.ok:
            raise CheckFailed(f"the initial push of the state repository was refused: {outcome.stderr_tail[-200:]}",
                              code="E_GIT")
        pushed = True
    excluded: list[str] = []
    hook_state = "skipped"
    if not pre_t0 and repo is not None:
        pgit = Git(repo)
        excluded = [line for line in EXCLUDES if pgit.exclude_add(line)]
        if pgit.config_get("core.longpaths") != "true":
            pgit.config_set("core.longpaths", "true")
        hook_state = install_commit_msg_hook(pgit)
    imported = None
    if import_from:
        imported = import_pre_t0(layout, Path(import_from), clock.format_utc(ctx.now))
    return {"state_dir": paths.posix(sd), "created": created, "cloned": cloned, "executor": executor,
            "project": project, "excluded": excluded, "state_remote": state_remote,
            "state_remote_private": private, "commit_msg_hook": hook_state, "local_state_created": new_local,
            "pushed": pushed, "imported": imported}


def cmd_init(ctx: Ctx, args: Namespace) -> CommandResult:
    pre_t0 = bool(getattr(args, "pre_t0", False))
    if pre_t0 and not getattr(args, "state", None):
        raise UsageError("--pre-t0 needs --state DIR (a state outside any product repository)")
    executor = getattr(args, "executor", None)
    return CommandResult(data=init_state(ctx, args.project, executor, getattr(args, "state_remote", None), pre_t0,
                                         getattr(args, "import_from", None)))
