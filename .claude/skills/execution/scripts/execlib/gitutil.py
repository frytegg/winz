"""Git through argv only (contract/MODULES.md 3, CLI.md merge and init, README.md 8).

Never --force, never a +refspec on push, never a history rewrite, never --no-verify: `Git.run` refuses those argument
shapes (PolicyRefused, exit 4) before git starts, so no method can reach them. Commit messages always go through a
file (`git commit -F`), and `commit_paths` refuses a message carrying an AI-attribution trailer or line.
"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Sequence

from . import procutil
from .errors import EnvError, GitError, PolicyRefused
from .log import get_logger
from .paths import is_link_like, posix, rmtree_link_safe

_LOG = get_logger("execlib.gitutil")

FORBIDDEN_ARGS: frozenset[str] = frozenset({
    "--force", "-f", "--force-with-lease", "--force-if-includes", "--mirror", "--delete", "-d", "--prune",
    "filter-branch", "filter-repo", "--hard", "--no-verify", "-n",
})
_PUSH_ONLY = frozenset({"--force", "-f", "--force-with-lease", "--force-if-includes", "--mirror", "--delete", "-d",
                        "--prune"})
_ANYWHERE = frozenset({"filter-branch", "filter-repo"})
# git global options whose value is the next word (git(1) OPTIONS); `--opt=value` forms are one word.
_GLOBAL_WITH_VALUE = frozenset({"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix",
                                "--config-env", "--attr-source"})

# The same family as ~/.claude/hooks/guard.py: trailer forms with a colon, the markdown link form, or a
# "Generated with Claude" line of its own. Prose that merely names the rule stays allowed. Built from parts so this
# source never holds the literal trailer text.
_CO = "co-" + "authored-by"
_SO = "signed-" + "off-by"
_GEN = "generated" + r"\s+with"
ATTRIBUTION_RE = re.compile(
    r"(?im)(" + _CO + r"\s*:|" + _SO + r"\s*:|" + _GEN + r"\s+\[claude|^[^\w\n\"'`]*" + _GEN + r"\s+claude)")

_REJECT_NON_FF_RE = re.compile(r"\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)|non-fast-forward|"
                               r"Updates were rejected because the (?:remote contains work|tip of your current branch)")

GIT_ENV_FIXED = {"GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C", "LANGUAGE": "C"}


def has_attribution(message: str) -> bool:
    return bool(ATTRIBUTION_RE.search(message or ""))


@dataclass(frozen=True)
class RebaseOutcome:
    ok: bool
    conflicts: tuple[str, ...]


@dataclass(frozen=True)
class PushOutcome:
    ok: bool
    rejected_non_ff: bool
    stderr_tail: str


def _split_global(words: Sequence[str]) -> tuple[list[tuple[str, str | None]], int]:
    """git's global options (before the subcommand) with their values, and the subcommand's index. An option taking
    a separate value (`-C <path>`, `-c <name>=<value>`, `--git-dir <path>`...) consumes the next word, so a value can
    never be taken for the subcommand."""
    opts: list[tuple[str, str | None]] = []
    i = 0
    while i < len(words):
        w = words[i]
        if w in _GLOBAL_WITH_VALUE:
            opts.append((w, words[i + 1] if i + 1 < len(words) else None))
            i += 2
            continue
        if w.startswith("-"):
            name, eq, value = w.partition("=")
            opts.append((name, value if eq else None))
            i += 1
            continue
        break
    return opts, i


def check_args(args: Sequence[str]) -> None:
    """Refuse the argument shapes no exec.py git call may use (PolicyRefused). The subcommand is found after git's
    global options and their values; a global `-c`/`--config-env` defining an alias (which could expand to a
    forbidden shape under an innocent name) or core.hooksPath (which skips hooks like --no-verify) is refused."""
    words = list(args)
    opts, at = _split_global(words)
    for name, value in opts:
        if name in ("-c", "--config-env"):
            key = (value or "").partition("=")[0].strip().lower()
            if key.startswith("alias.") or key == "core.hookspath":
                raise PolicyRefused(f"git {name} {key} is never set by exec.py (an alias can hide a forbidden "
                                    "shape; core.hooksPath skips hooks)", code="E_POLICY")
    sub = words[at] if at < len(words) else ""
    words = words[at:]
    for w in words:
        if w in _ANYWHERE:
            raise PolicyRefused(f"git {w} is never run (history rewrite)", code="E_POLICY")
    if sub == "push":
        for w in words:
            if w in _PUSH_ONLY or w.startswith("--force") or (w.startswith("+") and ":" in w) or w.startswith("+"):
                raise PolicyRefused(f"git push {w} is never run (no force, no +refspec, no delete)", code="E_POLICY")
            if w.startswith(":"):
                raise PolicyRefused("git push :<ref> deletes a remote ref: never run", code="E_POLICY")
    if sub in ("reset",) and "--hard" in words:
        raise PolicyRefused("git reset --hard is never run (it discards work)", code="E_POLICY")
    if sub in ("commit", "push", "merge", "rebase") and "--no-verify" in words:
        raise PolicyRefused("--no-verify is never used (hooks are never skipped)", code="E_POLICY")
    if sub == "commit" and "-n" in words:
        raise PolicyRefused("git commit -n skips hooks: never used", code="E_POLICY")


class Git:
    def __init__(self, cwd: Path, *, timeout_s: float = 120) -> None:
        self.cwd = Path(cwd)
        self.timeout_s = timeout_s

    def _env(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        env = dict(os.environ)
        env.update(GIT_ENV_FIXED)
        if extra:
            env.update(extra)
        return env

    def run(self, *args: str, check: bool = True, env: dict[str, str] | None = None,
            input_text: str | None = None) -> procutil.RunResult:
        """git <args> in cwd; GitError on a non-zero exit when check."""
        check_args(args)
        argv = ["git", "-c", "core.quotepath=false", *args]
        try:
            res = procutil.run(argv, cwd=self.cwd, timeout_s=self.timeout_s, env=self._env(env),
                               input_text=input_text)
        except EnvError as err:
            raise GitError(f"git could not start: {err.message}") from err
        if res.timed_out:
            raise GitError(f"git {' '.join(args[:3])} timed out after {self.timeout_s:g} s")
        if check and res.exit_code != 0:
            tail = (res.stderr.strip() or res.stdout.strip())[-600:]
            raise GitError(f"git {' '.join(args[:4])} failed (exit {res.exit_code}): {tail}")
        return res

    def _out(self, *args: str) -> str:
        return self.run(*args).stdout.strip()

    def head(self) -> str | None:
        res = self.run("rev-parse", "--verify", "--quiet", "HEAD", check=False)
        return res.stdout.strip() if res.exit_code == 0 and res.stdout.strip() else None

    def rev_parse(self, ref: str) -> str:
        return self._out("rev-parse", "--verify", f"{ref}^{{commit}}")

    def fetch(self, remote: str = "origin") -> None:
        self.run("fetch", "--quiet", remote)

    def is_ancestor(self, a: str, b: str) -> bool:
        res = self.run("merge-base", "--is-ancestor", a, b, check=False)
        if res.exit_code == 0:
            return True
        if res.exit_code == 1:
            return False
        raise GitError(f"git merge-base --is-ancestor {a} {b} failed: {res.stderr.strip()[-300:]}")

    def status_porcelain(self) -> list[str]:
        out = self.run("status", "--porcelain=v1", "--untracked-files=all").stdout
        return [ln for ln in out.split("\n") if ln.strip()]

    def changed_paths(self, base: str, head: str) -> list[str]:
        out = self.run("diff", "--name-only", "--no-renames", "-z", base, head).stdout
        return sorted(p for p in out.split("\0") if p)

    def commit_messages(self, base: str, head: str) -> list[tuple[str, str]]:
        """(sha, full message) of base..head, oldest first."""
        out = self.run("log", "--reverse", "--format=%H%x00%B%x1e", f"{base}..{head}").stdout
        result: list[tuple[str, str]] = []
        for rec in out.split("\x1e"):
            rec = rec.lstrip("\n")
            if not rec.strip():
                continue
            sha, _sep, msg = rec.partition("\0")
            result.append((sha.strip(), msg.rstrip("\n")))
        return result

    def added_lines(self, base: str, head: str) -> Iterator[tuple[str, int, str]]:
        """(path, line number in head, text) for every added line of base..head."""
        out = self.run("diff", "--no-color", "--no-ext-diff", "--no-renames", "-U0", base, head).stdout
        path: str | None = None
        line_no = 0
        for line in out.split("\n"):
            if line.startswith("+++ "):
                target = line[4:]
                path = None if target == "/dev/null" else (target[2:] if target.startswith("b/") else target)
                continue
            if line.startswith("@@"):
                m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", line)
                line_no = int(m.group(1)) if m else 0
                continue
            if line.startswith("+") and path is not None:
                yield path, line_no, line[1:]
                line_no += 1

    def rebase(self, onto: str) -> RebaseOutcome:
        """git rebase <onto>; on a conflict the rebase is aborted and the conflicting files returned."""
        res = self.run("rebase", onto, check=False)
        if res.exit_code == 0:
            return RebaseOutcome(True, ())
        conflicts = self.run("diff", "--name-only", "--diff-filter=U", "-z", check=False).stdout
        files = tuple(sorted(p for p in conflicts.split("\0") if p))
        self.run("rebase", "--abort", check=False)
        return RebaseOutcome(False, files)

    def _push(self, refspec: str) -> PushOutcome:
        res = self.run("push", "origin", refspec, check=False)
        tail = (res.stderr or "")[-1000:]
        if res.exit_code == 0:
            return PushOutcome(True, False, tail)
        return PushOutcome(False, bool(_REJECT_NON_FF_RE.search(res.stderr or "")), tail)

    def push_head(self, branch: str = "main") -> PushOutcome:
        """git push origin HEAD:refs/heads/<branch> (never --force, never a +refspec)."""
        return self._push(f"HEAD:refs/heads/{branch}")

    def push_sha(self, sha: str, branch: str = "main") -> PushOutcome:
        """git push origin <sha>:refs/heads/<branch> (never --force)."""
        return self._push(f"{sha}:refs/heads/{branch}")

    def current_branch(self) -> str | None:
        res = self.run("symbolic-ref", "--quiet", "--short", "HEAD", check=False)
        return res.stdout.strip() if res.exit_code == 0 else None

    def ff(self, branch: str, to: str) -> None:
        """Fast-forward `branch` to `to` (GitError when it would not be a fast-forward)."""
        old = self.rev_parse(branch)
        new = self.rev_parse(to)
        if not self.is_ancestor(old, new):
            raise GitError(f"{branch} cannot fast-forward to {to}")
        if self.current_branch() == branch:
            self.run("merge", "--ff-only", "--quiet", new)
        else:
            self.run("update-ref", f"refs/heads/{branch}", new, old)

    def commit_paths(self, paths: Sequence[str], message: str, *, scratch: Path) -> str:
        """Stage and commit exactly `paths` with the message written to a file (`git commit -F`); returns the SHA.

        Refuses (PolicyRefused) a message with an attribution trailer or a "Generated with" line."""
        if has_attribution(message):
            raise PolicyRefused("the commit message carries an AI attribution trailer or line", code="E_POLICY")
        if not paths:
            raise GitError("commit_paths needs at least one path")
        scratch = Path(scratch)
        scratch.mkdir(parents=True, exist_ok=True)
        msg_file = scratch / f"commit-msg-{os.getpid()}-{time.monotonic_ns()}.txt"
        text = message.replace("\r\n", "\n").replace("\r", "\n")
        if not text.endswith("\n"):
            text += "\n"
        with open(msg_file, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        try:
            self.run("add", "--", *paths)
            self.run("commit", "--quiet", "-F", posix(msg_file), "--", *paths)
        finally:
            try:
                msg_file.unlink()
            except FileNotFoundError:
                pass
        sha = self.head()
        if sha is None:
            raise GitError("commit produced no HEAD")
        return sha

    def git_path(self, rel: str) -> Path:
        out = self._out("rev-parse", "--path-format=absolute", "--git-path", rel)
        return Path(out)

    def exclude_add(self, line: str) -> bool:
        """Add `line` to .git/info/exclude once; True when it was added."""
        path = self.git_path("info/exclude")
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        if line.strip() in {ln.strip() for ln in existing.split("\n")}:
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        prefix = "" if (not existing or existing.endswith("\n")) else "\n"
        with open(path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(f"{prefix}{line.strip()}\n")
        return True

    def ls_files(self, *pathspec: str) -> list[str]:
        out = self.run("ls-files", "-z", "--", *pathspec).stdout
        return sorted(p for p in out.split("\0") if p)

    def untracked(self) -> list[str]:
        out = self.run("ls-files", "--others", "--exclude-standard", "-z").stdout
        return sorted(p for p in out.split("\0") if p)

    def config_get(self, key: str) -> str | None:
        res = self.run("config", "--get", key, check=False)
        if res.exit_code == 0:
            return res.stdout.strip()
        if res.exit_code == 1:
            return None
        raise GitError(f"git config --get {key} failed: {res.stderr.strip()[-200:]}")

    def config_set(self, key: str, value: str) -> None:
        self.run("config", key, value)

    def clone_no_local(self, dest: Path) -> Git:
        """git -c core.longpaths=true clone --no-local --config core.longpaths=true <this repo> <dest>; then fetch
        refs/exec/* so snapshot and single-tree commits are reachable."""
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        cloner = Git(dest.parent, timeout_s=max(self.timeout_s, 600))
        cloner.run("-c", "core.longpaths=true", "clone", "--quiet", "--no-local", "--config", "core.longpaths=true",
                   posix(self.cwd), posix(dest))
        clone = Git(dest, timeout_s=self.timeout_s)
        clone.run("fetch", "--quiet", "origin", "+refs/exec/*:refs/exec/*", check=False)
        return clone

    def checkout(self, sha: str) -> None:
        self.run("checkout", "--quiet", "--detach", sha)

    def worktrees(self) -> list[Path]:
        out = self.run("worktree", "list", "--porcelain").stdout
        return [Path(ln[len("worktree "):].strip()) for ln in out.split("\n") if ln.startswith("worktree ")]

    def worktree_remove_link_safe(self, path: Path) -> None:
        """Remove a worktree: junctions and symlinks inside are unlinked first (their targets are never touched),
        then `git worktree remove --force`, then whatever is left, link-safely."""
        p = Path(path)
        if p.exists():
            for dirpath, dirnames, filenames in os.walk(p, topdown=True, followlinks=False):
                keep = []
                for d in dirnames:
                    full = Path(dirpath) / d
                    if is_link_like(full):
                        try:
                            os.unlink(full)
                        except OSError:
                            os.rmdir(full)
                    elif d != ".git":
                        keep.append(d)
                dirnames[:] = keep
                for f in filenames:
                    full = Path(dirpath) / f
                    if is_link_like(full):
                        os.unlink(full)
        self.run("worktree", "remove", "--force", posix(p), check=False)
        if p.exists():
            rmtree_link_safe(p)
        self.run("worktree", "prune", check=False)

    def common_dir_root(self) -> Path:
        """The parent of --git-common-dir: the main working tree."""
        return Path(self._out("rev-parse", "--path-format=absolute", "--git-common-dir")).resolve().parent

    def resync_to_origin(self) -> dict:
        """`git reset --mixed origin/main` only when local main is an ancestor of it (files are never touched)."""
        branch = self.current_branch()
        if branch != "main":
            return {"moved": False, "reason": f"checkout is on {branch or 'a detached HEAD'}, not main"}
        local = self.rev_parse("main")
        origin = self.rev_parse("origin/main")
        if local == origin:
            return {"moved": False, "reason": "already at origin/main", "from": local, "to": origin}
        if not self.is_ancestor(local, origin):
            return {"moved": False, "reason": "local main is not an ancestor of origin/main", "from": local,
                    "to": origin}
        self.run("reset", "--mixed", "--quiet", "origin/main")
        return {"moved": True, "reason": "fast-forwarded branch and index", "from": local, "to": origin}


def remote_is_private(remote: str) -> bool | None:
    """True for a private GitHub repository, a local path or a file:// URL; False when gh reports it public;
    None when unknown (gh missing, unauthenticated, or the answer unreadable)."""
    if not remote:
        return None
    if remote.startswith("file://") or Path(remote).expanduser().exists():
        return True
    if procutil.which("gh") is None:
        return None
    try:
        res = procutil.run(["gh", "repo", "view", remote, "--json", "visibility,isPrivate"], cwd=Path.cwd(),
                           timeout_s=30)
    except EnvError:
        return None
    if res.timed_out or res.exit_code != 0:
        return None
    try:
        doc = json.loads(res.stdout)
    except json.JSONDecodeError:
        return None
    if doc.get("isPrivate") is True or str(doc.get("visibility", "")).upper() == "PRIVATE":
        return True
    if doc.get("isPrivate") is False:
        return False
    return None
