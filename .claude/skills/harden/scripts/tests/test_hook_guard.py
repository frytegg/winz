"""Tests for scripts/hook_guard.py (unittest, temporary git repositories).

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import hook_guard as hg  # noqa: E402

_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None


def setUpModule() -> None:
    """Isolate git from the user's global/system configuration."""
    global _GIT_HOME
    _GIT_HOME = tempfile.mkdtemp(prefix="harden-gitcfg-")
    cfg = Path(_GIT_HOME) / "gitconfig"
    cfg.write_text("[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                   "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                   "[core]\n\tautocrlf = false\n", encoding="utf-8")
    values = {"GIT_CONFIG_GLOBAL": str(cfg), "GIT_CONFIG_NOSYSTEM": "1",
              "GIT_AUTHOR_NAME": "Harden Test", "GIT_AUTHOR_EMAIL": "harden@example.invalid",
              "GIT_COMMITTER_NAME": "Harden Test", "GIT_COMMITTER_EMAIL": "harden@example.invalid"}
    for key, value in values.items():
        _SAVED_ENV[key] = os.environ.get(key)
        os.environ[key] = value


def tearDownModule() -> None:
    for key, value in _SAVED_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    if _GIT_HOME:
        _rmtree(_GIT_HOME)


def _rmtree(path: str) -> None:
    def fix(func, target, _exc):  # type: ignore[no-untyped-def]
        os.chmod(target, stat.S_IWRITE)
        func(target)
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=fix)
    else:
        shutil.rmtree(path, onerror=fix)


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(["git", *args], cwd=str(repo), stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"git {args} failed: {proc.stderr.decode(errors='replace')}")
    return proc.stdout.decode("utf-8", errors="replace")


def _write(repo: Path, rel: str, text: str) -> None:
    target = repo / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as handle:  # Python 3.9
        handle.write(text)


class HookTestCase(unittest.TestCase):
    """A repository with an active /harden run."""

    marker = True

    def setUp(self) -> None:
        self.repo = Path(tempfile.mkdtemp(prefix="harden-hook-"))
        _git(self.repo, "init", "-q")
        _write(self.repo, "src/app.py", "def add(a, b):\n    return a + b\n")
        _write(self.repo, "tests/test_app.py", "def test_add():\n    assert 1 + 2 == 3\n")
        _write(self.repo, "tests/nb.ipynb", "{}\n")
        _write(self.repo, "tsconfig.json", '{"compilerOptions": {"strict": true}}\n')
        # The repository's own manifest: without it, `pnpm add` would edit the nearest
        # package.json above the temporary directory (E01-F10), which depends on the machine.
        _write(self.repo, "package.json", '{"name": "fixture", "private": true}\n')
        _write(self.repo, "build.log", "old\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base")
        self.base = _git(self.repo, "rev-parse", "HEAD").strip()
        if self.marker:
            self.write_active()

    def tearDown(self) -> None:
        _rmtree(str(self.repo))

    def write_active(self, **extra: Any) -> None:
        data = {"base_sha": self.base, "branch": "main", "started": "2026-09-23T00:00:00Z",
                "mode": "apply", "protected_globs": [], "test_globs": [],
                "allow_test_deletions": []}
        data.update(extra)
        (self.repo / ".harden").mkdir(exist_ok=True)
        (self.repo / ".harden" / "active").write_text(json.dumps(data), encoding="utf-8")
        exclude = self.repo / ".git" / "info" / "exclude"
        exclude.parent.mkdir(parents=True, exist_ok=True)
        with open(exclude, "a", encoding="utf-8") as handle:
            handle.write("\n/.harden/\n")

    def env(self) -> Dict[str, str]:
        return {"CLAUDE_PROJECT_DIR": str(self.repo)}

    def run_hook(self, payload: Dict[str, Any],
                 env: Optional[Dict[str, str]] = None) -> Tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        code = hg.run(json.dumps(payload), self.env() if env is None else env, out, err)
        return code, out.getvalue(), err.getvalue()

    def pre(self, tool: str, tool_input: Dict[str, Any], mode: str = "default",
            env: Optional[Dict[str, str]] = None) -> Tuple[int, str, str]:
        payload = {"session_id": "s1", "cwd": str(self.repo), "permission_mode": mode,
                   "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input,
                   "tool_use_id": "t1"}
        return self.run_hook(payload, env)

    def bash(self, command: str, tool: str = "Bash") -> int:
        return self.pre(tool, {"command": command})[0]

    def stop(self, active: bool = False) -> Tuple[int, str, str]:
        return self.run_hook({"session_id": "s1", "cwd": str(self.repo),
                              "permission_mode": "default", "hook_event_name": "Stop",
                              "stop_hook_active": active})


class NoMarkerTests(HookTestCase):
    marker = False

    def test_noop_without_marker(self) -> None:
        for payload in (
            {"hook_event_name": "PreToolUse", "tool_name": "Edit", "cwd": str(self.repo),
             "tool_input": {"file_path": str(self.repo / "tests" / "test_app.py")}},
            {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(self.repo),
             "tool_input": {"command": "git push --force"}},
            {"hook_event_name": "Stop", "cwd": str(self.repo), "stop_hook_active": False},
        ):
            self.assertEqual(self.run_hook(payload), (0, "", ""))
        self.assertFalse((self.repo / ".harden").exists())

    def test_noop_on_empty_or_invalid_stdin(self) -> None:
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(hg.run("", {}, out, err), 0)
        self.assertEqual(hg.run("not json", {}, out, err), 0)
        self.assertEqual((out.getvalue(), err.getvalue()), ("", ""))

    def test_canary_is_a_noop_without_marker(self) -> None:
        # Without a run the canary must not fire: the check would then prove nothing.
        self.assertEqual(self.pre("Bash", {"command": "echo HARDEN_HOOK_CANARY"}), (0, "", ""))
        self.assertEqual(self.pre("Edit", {"file_path": str(self.repo / ".harden" / "canary.txt")}),
                         (0, "", ""))
        self.assertFalse((self.repo / ".harden").exists())


class FileToolTests(HookTestCase):
    def test_blocks_edit_on_existing_test(self) -> None:
        code, out, err = self.pre("Edit", {"file_path": str(self.repo / "tests" / "test_app.py"),
                                           "old_string": "3", "new_string": "4"})
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("read-only", err)
        self.assertIn("flag it to the user", err)
        self.assertIn("new test files is allowed", err.replace("NEW", "new"))

    def test_allows_write_of_new_test_file(self) -> None:
        code, _, err = self.pre("Write", {"file_path": str(self.repo / "tests" / "test_new.py"),
                                          "content": "def test_x():\n    assert 1\n"})
        self.assertEqual(code, 0, err)

    def test_test_file_created_during_the_run_stays_editable(self) -> None:
        # PF characterization workflow: write a new test, run it, copy the actual value in.
        _write(self.repo, "tests/test_characterize.py", "def test_c():\n    assert 0 == 1\n")
        target = str(self.repo / "tests" / "test_characterize.py")
        self.assertEqual(self.pre("Edit", {"file_path": target})[0], 0)
        self.assertEqual(self.pre("Write", {"file_path": target, "content": "x"})[0], 0)
        self.assertEqual(self.bash("sed -i 's/1/0/' tests/test_characterize.py"), 0)
        self.assertEqual(self.bash("rm tests/test_characterize.py"), 0)
        # ...even once committed after base_sha.
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "test: characterize")
        self.assertEqual(self.pre("Edit", {"file_path": target})[0], 0)
        # Files that existed at base_sha stay read-only.
        self.assertEqual(self.pre("Edit", {"file_path": str(self.repo / "tests" / "test_app.py")})[0], 2)
        self.assertEqual(self.bash("rm -r tests"), 2)

    def test_created_file_rule_needs_a_base(self) -> None:
        _write(self.repo, "tests/test_characterize.py", "def test_c():\n    assert 1\n")
        self.write_active(base_sha="")
        target = str(self.repo / "tests" / "test_characterize.py")
        self.assertEqual(self.pre("Edit", {"file_path": target})[0], 2)
        self.write_active(base_sha="0" * 40)
        self.assertEqual(self.pre("Edit", {"file_path": target})[0], 2)

    def test_blocks_protected_config_and_other_file_tools(self) -> None:
        self.assertEqual(self.pre("MultiEdit", {"file_path": str(self.repo / "tsconfig.json"),
                                                "edits": []})[0], 2)
        self.assertEqual(self.pre("NotebookEdit",
                                  {"notebook_path": str(self.repo / "tests" / "nb.ipynb")})[0], 2)
        self.assertEqual(self.pre("Write", {"file_path": str(self.repo / "tsconfig.json"),
                                            "content": "{}"})[0], 2)

    def test_blocks_write_to_marker(self) -> None:
        code, _, err = self.pre("Write", {"file_path": str(self.repo / ".harden" / "active"),
                                          "content": "{}"})
        self.assertEqual(code, 2)
        self.assertIn("run marker", err)

    def test_allows_edit_on_source_and_outside_project(self) -> None:
        self.assertEqual(self.pre("Edit", {"file_path": str(self.repo / "src" / "app.py")})[0], 0)
        outside = Path(tempfile.gettempdir()) / "tests" / "test_elsewhere.py"
        self.assertEqual(self.pre("Edit", {"file_path": str(outside)})[0], 0)

    def test_windows_backslash_paths(self) -> None:
        backslashed = str(self.repo).replace("/", "\\") + "\\tests\\test_app.py"
        self.assertEqual(self.pre("Edit", {"file_path": backslashed})[0], 2)
        self.assertEqual(self.pre("Edit", {"file_path": "tests\\test_app.py"})[0], 2)
        self.assertEqual(self.pre("Edit", {"file_path": "tests/test_app.py"})[0], 2)

    @unittest.skipUnless(os.name == "nt", "case-insensitive comparison applies on Windows")
    def test_case_insensitive_on_windows(self) -> None:
        upper = str(self.repo).upper() + "\\TESTS\\TEST_APP.PY"
        self.assertEqual(self.pre("Edit", {"file_path": upper})[0], 2)

    def test_cwd_used_when_project_dir_unset(self) -> None:
        code, _, _ = self.pre("Edit", {"file_path": str(self.repo / "tests" / "test_app.py")},
                              env={})
        self.assertEqual(code, 2)

    def test_target_repository_is_searched_before_the_project_dir(self) -> None:
        other = Path(tempfile.mkdtemp(prefix="harden-other-"))
        try:
            _git(other, "init", "-q")
            payload_env = {"CLAUDE_PROJECT_DIR": str(other)}
            code, _, _ = self.pre("Edit", {"file_path": str(self.repo / "tests" / "test_app.py")},
                                  env=payload_env)
            self.assertEqual(code, 2)
            # A file of the other repository is not guarded by this run.
            _write(other, "tests/test_x.py", "def test_x():\n    pass\n")
            payload = {"session_id": "s1", "cwd": str(other), "permission_mode": "default",
                       "hook_event_name": "PreToolUse", "tool_name": "Edit",
                       "tool_input": {"file_path": str(other / "tests" / "test_x.py")}}
            self.assertEqual(self.run_hook(payload, env=payload_env)[0], 0)
        finally:
            _rmtree(str(other))


class ShellToolTests(HookTestCase):
    BLOCKED_BASH = [
        "git push --force origin main",
        "git push -f",
        "git push --force-with-lease origin HEAD",
        "git push origin +main",
        "git -C . push --force",
        "git reset --hard HEAD~1",
        "git clean -fd",
        "git clean -xdf",
        "git checkout -- .",
        "git checkout .",
        "git restore .",
        "git rebase main",
        "git rebase -i HEAD~3",
        "git filter-branch --tree-filter 'rm x' HEAD",
        "git filter-repo --path secrets.txt --invert-paths",
        "git branch -D feature",
        "git stash drop",
        "git stash clear",
        "git commit --no-verify -m 'wip'",
        "git commit -nm wip",
        "git -c core.hooksPath=/dev/null commit -m x",
        "rm -rf build",
        "rm -fr build",
        "rm -r -f build",
        "cd src && rm -rf ../build",
        "sudo rm -rf /tmp/x",
        "find . -name '*.pyc' -delete",
        "bash -c 'git reset --hard'",
        "sh -c \"rm -rf node_modules\"",
        "cmd //c \"rmdir /s /q build\"",
        "rmdir /s /q build",
        "del /s /q *.pyc",
        "powershell -Command \"Remove-Item -Recurse -Force build\"",
        "sed -i 's/3/4/' tests/test_app.py",
        "perl -pi -e 's/3/4/' tests/test_app.py",
        "echo x > tests/test_app.py",
        "echo '{}' >> tsconfig.json",
        "cat src/app.py | tee tests/test_app.py",
        "cp src/app.py tests/test_app.py",
        "rm tests/test_app.py",
        "git rm tests/test_app.py",
        "mv tests/test_app.py tests/test_old.py",
        "echo {} > .harden/active",
        "npx jest -u",
        "pnpm test -- --updateSnapshot",
        "pytest --snapshot-update",
        "cargo insta accept",
        "python -c \"import shutil; shutil.rmtree('src')\"",
        "pnpm dlx rimraf dist",
        "terraform destroy -auto-approve",
        "kubectl delete pod x",
        "psql -c 'DROP TABLE users'",
        "npm install -g jscpd",
        "cd .. && npm install jscpd",
        "pip install --user ruff",
    ]
    ALLOWED_BASH = [
        "git status",
        "git commit -m 'fix: explain rm -rf and --force handling'",
        "git commit -m \"docs: never run git reset --hard\"",
        "pnpm test",
        "python -m pytest tests/ -q",
        "git diff --stat",
        "git log --oneline -5",
        "git add -A",
        "git checkout -b harden/2026-09-23",
        "git checkout main -- src/app.py",
        "git restore --staged .",
        "git restore tests/test_app.py",
        "git clean -n",
        "git stash",
        "git stash pop",
        "git push origin harden/2026-09-23",
        "git branch -d merged-branch",
        "rm build.log",
        "sed -n '1,5p' tests/test_app.py",
        "sed -i 's/a/b/' src/app.py",
        "echo x > tests/new_output.txt",
        "pytest 2>&1 | tee test-output.log",
        "ls -la",
        "cat <<'EOF' > notes.md\nrm -rf /\ngit push --force\nEOF",
        "grep -rn 'rm -rf' src",
        "pnpm add -D rimraf",
        "npm uninstall rimraf",
        "echo git push --force",
        "cargo test -- --ignored",
        "python -c \"print('rmtree')\"",
        "npx jscpd src",
        "pnpm dlx jscpd src",
        "uvx ruff check .",
        "pipx run ruff check .",
        "npm install --prefix .harden/tools jscpd",
        "cargo install --root .harden/tools cargo-machete",
        "npm ls -g",
    ]
    BLOCKED_POWERSHELL = [
        "Remove-Item -Recurse -Force build",
        "Remove-Item build -r",
        "rm -r build",
        "Get-ChildItem -Recurse -Filter *.tmp | Remove-Item -Force",
        "Set-Content -Path tests/test_app.py -Value 'x'",
        "'x' | Out-File tests\\test_app.py",
        "git push --force",
        "cmd /c \"rd /s /q build\"",
        "npm install -g jscpd",
        "Set-Location ..; npm install jscpd",
    ]
    ALLOWED_POWERSHELL = [
        "Get-ChildItem -Recurse src",
        "Remove-Item build.log",
        "git status; git diff",
        "Set-Content -Path notes.txt -Value 'x'",
        "Remove-Item -Recurse build -WhatIf",
        "npx jscpd src",
        "npm install --save-dev jscpd",
    ]

    def test_blocks_destructive_bash_commands(self) -> None:
        for command in self.BLOCKED_BASH:
            with self.subTest(command=command):
                code, _, err = self.pre("Bash", {"command": command})
                self.assertEqual(code, 2, f"not blocked: {command}")
                self.assertIn("ask the user", err)

    def test_allows_ordinary_bash_commands(self) -> None:
        for command in self.ALLOWED_BASH:
            with self.subTest(command=command):
                code, _, err = self.pre("Bash", {"command": command})
                self.assertEqual(code, 0, f"blocked: {command}: {err}")

    def test_powershell_tool(self) -> None:
        for command in self.BLOCKED_POWERSHELL:
            with self.subTest(command=command):
                self.assertEqual(self.bash(command, tool="PowerShell"), 2, command)
        for command in self.ALLOWED_POWERSHELL:
            with self.subTest(command=command):
                code, _, err = self.pre("PowerShell", {"command": command})
                self.assertEqual(code, 0, f"blocked: {command}: {err}")

    def test_rm_of_test_file_respects_allow_list(self) -> None:
        self.assertEqual(self.bash("rm tests/test_app.py"), 2)
        self.write_active(allow_test_deletions=["tests/test_app.py"])
        self.assertEqual(self.bash("rm tests/test_app.py"), 0)
        self.assertEqual(self.bash("sed -i 's/3/4/' tests/test_app.py"), 2)

    def test_encoded_powershell_command_is_decoded(self) -> None:
        import base64
        encoded = base64.b64encode("Remove-Item -Recurse -Force build".encode("utf-16-le"))
        self.assertEqual(self.bash("powershell -EncodedCommand " + encoded.decode("ascii")), 2)


def read_events(repo: Path) -> List[Dict[str, Any]]:
    path = repo / ".harden" / "hook_events.log"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


class HistoryRewriteTests(HookTestCase):
    """PC-20: no amend, no branch-moving reset, no tag/ref/branch deletion."""

    BLOCKED = {
        "git commit --amend": "git-commit-amend",
        "git commit --amend --no-edit": "git-commit-amend",
        "git commit -a --amend -m 'x'": "git-commit-amend",
        "git commit --amen": "git-commit-amend",
        "git -c user.name=x commit --amend": "git-commit-amend",
        "git reset --hard": "git-reset-hard",
        "git reset --har HEAD": "git-reset-hard",
        "git reset HEAD~1": "git-reset-moves-branch",
        "git reset --soft HEAD~1": "git-reset-moves-branch",
        "git reset --mixed HEAD^": "git-reset-moves-branch",
        "git reset --keep origin/main": "git-reset-moves-branch",
        "git reset --merge ORIG_HEAD": "git-reset-moves-branch",
        "git reset -q @~2": "git-reset-moves-branch",
        "git reset HEAD@{1}": "git-reset-moves-branch",
        "git reset HEAD~1 -- src/app.py": "git-reset-moves-branch",
        "git reset HEAD~1 --soft": "git-reset-moves-branch",
        # Not an existing path, so git would read it as a revision (or refuse it).
        "git reset no-such-file.py": "git-reset-moves-branch",
        "git tag -d v1.0": "git-tag-delete",
        "git tag --delete v1.0": "git-tag-delete",
        "git tag -f v1.0": "git-tag-force",
        "git update-ref -d refs/heads/main": "git-update-ref-delete",
        "git update-ref refs/heads/main HEAD~3": "git-update-ref-move",
        "git update-ref -m reason refs/tags/v1 HEAD": "git-update-ref-move",
        "git update-ref --stdin": "git-update-ref-stdin",
        "git branch -d main": "git-branch-delete-protected",
        "git branch --delete main": "git-branch-delete-protected",
        "git branch -D feature": "git-branch-force-delete",
        "bash -c 'git commit --amend --no-edit'": "git-commit-amend",
    }
    ALLOWED = [
        "git reset",
        "git reset -q",
        "git reset HEAD",
        "git reset @",
        "git reset --soft",
        "git reset --merge",
        "git reset HEAD -- src/app.py",
        "git reset HEAD src/app.py",
        "git reset -- src/app.py",
        "git reset -- no-such-file.py",
        "git reset src/app.py tests/test_app.py",
        "git reset .",
        "git reset 'src/*.py'",
        "git reset ':(glob)src/**'",
        "git reset -p",
        "git reset --pathspec-from-file=paths.txt",
        "git commit -m 'docs: why we never --amend'",
        "git commit -m --amend",
        "git commit -m 'fix: x'",
        "git tag v1.0",
        "git tag -a v1.0 -m 'release -d -f'",
        "git tag -l",
        "git branch -d merged-branch",
        "git branch -d -r origin/main",
        "git update-ref",
    ]

    def test_history_rewriting_is_denied_with_its_reason_code(self) -> None:
        for command, code in self.BLOCKED.items():
            with self.subTest(command=command):
                status, _, err = self.pre("Bash", {"command": command})
                self.assertEqual(status, 2, f"not blocked: {command}")
                self.assertIn(f"[reason_code: {code}]", err)
                self.assertIn("ask the user", err)
                self.assertEqual(read_events(self.repo)[-1]["reason_code"], code)

    def test_index_only_and_harmless_forms_stay_allowed(self) -> None:
        for command in self.ALLOWED:
            with self.subTest(command=command):
                status, _, err = self.pre("Bash", {"command": command})
                self.assertEqual(status, 0, f"blocked: {command}: {err}")

    def test_reset_message_points_to_revert_and_restore(self) -> None:
        _, _, err = self.pre("Bash", {"command": "git reset --soft HEAD~1"})
        self.assertIn("git revert", err)
        self.assertIn("git restore", err)

    def test_base_branch_deletion_is_denied(self) -> None:
        _git(self.repo, "branch", "trunk")            # points at base_sha: the base branch
        _write(self.repo, "src/extra.py", "x = 1\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "later")
        _git(self.repo, "branch", "feature")          # points at a later commit
        self.assertEqual(self.bash("git branch -d trunk"), 2)
        self.assertEqual(self.bash("git branch -d feature"), 0)
        self.write_active(base_branch="develop")
        self.assertEqual(self.bash("git branch -d develop"), 2)
        self.assertEqual(self.bash("git branch -d develop", tool="PowerShell"), 2)

    def test_run_branch_from_marker_is_protected(self) -> None:
        self.write_active(branch="harden/2026-09-24")
        self.assertEqual(self.bash("git branch -d harden/2026-09-24"), 2)
        self.assertEqual(self.bash("git branch -d merged-branch"), 0)


class CanaryTests(HookTestCase):
    """PF-05: harmless canaries that the hook always refuses while the marker exists."""

    def test_bash_canary_is_refused_and_logged(self) -> None:
        for tool, command in (("Bash", "echo HARDEN_HOOK_CANARY"),
                              ("PowerShell", "Write-Output HARDEN_HOOK_CANARY"),
                              ("Bash", "git status # HARDEN_HOOK_CANARY")):
            with self.subTest(tool=tool, command=command):
                status, out, err = self.pre(tool, {"command": command})
                self.assertEqual((status, out), (2, ""))
                self.assertIn("hook is active", err)
                self.assertIn("Nothing was run", err)
                self.assertIn("[reason_code: canary-bash]", err)
                event = read_events(self.repo)[-1]
                self.assertEqual((event["reason_code"], event["tool"], event["path_or_cmd"]),
                                 ("canary-bash", tool, command))

    def test_edit_canary_is_refused_for_every_file_tool(self) -> None:
        canary = self.repo / ".harden" / "canary.txt"
        canary.write_text("canary\n", encoding="utf-8")
        targets = [str(canary), ".harden/canary.txt", ".harden\\canary.txt"]
        for tool, key in (("Edit", "file_path"), ("Write", "file_path"),
                          ("MultiEdit", "file_path"), ("NotebookEdit", "notebook_path")):
            for target in targets:
                with self.subTest(tool=tool, target=target):
                    status, _, err = self.pre(tool, {key: target, "new_string": "tampered"})
                    self.assertEqual(status, 2)
                    self.assertIn("hook is active", err)
                    self.assertIn("[reason_code: canary-edit]", err)
        self.assertEqual(canary.read_text(encoding="utf-8"), "canary\n")
        events = read_events(self.repo)
        self.assertEqual({e["reason_code"] for e in events}, {"canary-edit"})
        self.assertEqual(len(events), 12)
        self.assertNotIn("tampered", json.dumps(events))

    def test_edit_canary_refused_even_when_the_file_is_missing(self) -> None:
        status, _, _ = self.pre("Write", {"file_path": str(self.repo / ".harden" / "canary.txt"),
                                          "content": "x"})
        self.assertEqual(status, 2)
        self.assertFalse((self.repo / ".harden" / "canary.txt").exists())

    @unittest.skipUnless(os.name == "nt", "case-insensitive paths on Windows")
    def test_edit_canary_case_insensitive_on_windows(self) -> None:
        self.assertEqual(self.pre("Edit", {"file_path": ".HARDEN\\Canary.TXT"})[0], 2)


class EventLogTests(HookTestCase):
    """Every denial is one JSON line in .harden/hook_events.log."""

    KEYS = {"ts", "event", "tool", "reason_code", "path_or_cmd", "session_id", "transcript_path"}

    def test_denials_carry_session_and_transcript(self) -> None:
        payload = {"session_id": "abc-123", "transcript_path": "C:/t/abc-123.jsonl",
                   "cwd": str(self.repo), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": "Bash",
                   "tool_input": {"command": "echo HARDEN_HOOK_CANARY"}}
        self.assertEqual(self.run_hook(payload)[0], 2)
        event = read_events(self.repo)[-1]
        self.assertEqual((event["session_id"], event["transcript_path"]),
                         ("abc-123", "C:/t/abc-123.jsonl"))
        self.assertEqual(self.bash("git push --force"), 2)
        self.assertIsNone(read_events(self.repo)[-1]["transcript_path"])

    def test_denial_line_format_and_allowed_calls_not_logged(self) -> None:
        self.assertEqual(self.bash("git status"), 0)
        self.assertEqual(self.pre("Edit", {"file_path": str(self.repo / "src" / "app.py")})[0], 0)
        self.assertEqual(read_events(self.repo), [])
        self.assertEqual(self.bash("git push --force origin main"), 2)
        target = str(self.repo / "tests" / "test_app.py")
        self.assertEqual(self.pre("Edit", {"file_path": target, "old_string": "3",
                                           "new_string": "SECRET_PAYLOAD_XYZ"})[0], 2)
        events = read_events(self.repo)
        self.assertEqual(len(events), 2)
        for event in events:
            self.assertEqual(set(event), self.KEYS)
            self.assertRegex(event["ts"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
            self.assertEqual(event["event"], "PreToolUse")
        self.assertEqual((events[0]["tool"], events[0]["reason_code"], events[0]["path_or_cmd"]),
                         ("Bash", "git-push-force", "git push --force origin main"))
        self.assertEqual((events[1]["tool"], events[1]["reason_code"]), ("Edit", "edit-test"))
        self.assertEqual(events[1]["path_or_cmd"], target.replace("\\", "/"))
        raw = (self.repo / ".harden" / "hook_events.log").read_text(encoding="utf-8")
        self.assertNotIn("SECRET_PAYLOAD_XYZ", raw)

    def test_long_commands_are_cut_to_200_characters(self) -> None:
        command = "git push --force origin " + "x" * 500
        self.assertEqual(self.bash(command), 2)
        logged = read_events(self.repo)[-1]["path_or_cmd"]
        self.assertEqual(len(logged), 200)
        self.assertTrue(command.startswith(logged))

    def test_credentials_are_redacted(self) -> None:
        secrets = {
            "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789 git push --force":
                "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
            "git push --force https://bob:hunter2pass@example.com/r.git": "hunter2pass",
            "curl -H 'Authorization: Bearer abc.def.ghi' x; rm -rf build": "abc.def.ghi",
            "mysql --password s3cr3tvalue -e 'x'; rm -rf build": "s3cr3tvalue",
            "API_KEY='k-123456' rm -rf build": "k-123456",
        }
        for command, secret in secrets.items():
            with self.subTest(command=command):
                self.assertEqual(self.bash(command), 2)
                logged = read_events(self.repo)[-1]["path_or_cmd"]
                self.assertNotIn(secret, logged)
                self.assertIn("***", logged)
        self.assertEqual(hg.redact("git push --force origin main"), "git push --force origin main")

    def test_every_blocked_command_has_a_registered_reason_code(self) -> None:
        commands = [("Bash", c) for c in ShellToolTests.BLOCKED_BASH] + \
                   [("PowerShell", c) for c in ShellToolTests.BLOCKED_POWERSHELL]
        for tool, command in commands:
            with self.subTest(command=command):
                status, _, err = self.pre(tool, {"command": command})
                self.assertEqual(status, 2)
                code = read_events(self.repo)[-1]["reason_code"]
                self.assertIn(code, hg.REASON_CODES)
                self.assertIn(f"[reason_code: {code}]", err)
        for tool, target in (("Edit", "tests/test_app.py"), ("Write", "tsconfig.json"),
                             ("Write", ".harden/active")):
            with self.subTest(target=target):
                self.assertEqual(self.pre(tool, {"file_path": target})[0], 2)
                self.assertIn(read_events(self.repo)[-1]["reason_code"], hg.REASON_CODES)

    def test_reason_codes_in_the_source_are_registered(self) -> None:
        source = (SCRIPTS / "hook_guard.py").read_text(encoding="utf-8")
        literal = set(re.findall(r"deny\(\s*\"([a-z0-9-]+)\"", source))
        literal |= set(re.findall(r"log_event\([^)]*?\"([a-z0-9-]+)\"", source))
        self.assertGreater(len(literal), 40)
        self.assertEqual(literal - set(hg.REASON_CODES), set())
        for prefix in ("edit", "write", "delete"):
            for kind in ("test", "snapshot", "protected"):
                self.assertIn(f"{prefix}-{kind}", hg.REASON_CODES)
        self.assertEqual(hg.reason_code("plain text"), "unclassified")

    def test_event_log_is_read_only_for_the_agent(self) -> None:
        self.assertEqual(self.bash("echo HARDEN_HOOK_CANARY"), 2)
        log = self.repo / ".harden" / "hook_events.log"
        before = log.read_text(encoding="utf-8")
        for tool, tool_input in (("Write", {"file_path": str(log), "content": "{}"}),
                                 ("Edit", {"file_path": ".harden/hook_events.log"}),
                                 ("Bash", {"command": "echo '{}' >> .harden/hook_events.log"})):
            with self.subTest(tool=tool):
                status, _, err = self.pre(tool, tool_input)
                self.assertEqual(status, 2)
                self.assertIn("[reason_code: event-log-write]", err)
        self.assertTrue(log.read_text(encoding="utf-8").startswith(before))
        self.assertEqual(self.bash("cat .harden/hook_events.log"), 0)

    def test_logging_failure_does_not_cancel_the_block(self) -> None:
        (self.repo / ".harden" / "hook_events.log").mkdir()
        status, _, err = self.pre("Bash", {"command": "git reset --hard"})
        self.assertEqual(status, 2)
        self.assertIn("git-reset-hard", err)
        errors = (self.repo / ".harden" / "hook_errors.log").read_text(encoding="utf-8")
        self.assertEqual(len(errors.strip().splitlines()), 1)

    def test_stop_denial_is_logged(self) -> None:
        _write(self.repo, "tests/test_app.py", "def test_add():\n    assert True\n")
        code, _, err = self.stop()
        self.assertEqual(code, 2)
        self.assertIn("[reason_code: stop-hard-violations]", err)
        event = read_events(self.repo)[-1]
        self.assertEqual((event["event"], event["tool"], event["reason_code"]),
                         ("Stop", None, "stop-hard-violations"))
        self.assertEqual(event["path_or_cmd"], "tests/test_app.py")
        self.assertEqual(self.stop(active=True)[0], 0)
        self.assertEqual(len(read_events(self.repo)), 1)


class ConfigFallbackTests(HookTestCase):
    """A bad .harden/config.json never disables the guard."""

    def check_still_guarded(self) -> None:
        status, _, err = self.pre("Bash", {"command": "git reset --hard HEAD~1"})
        self.assertEqual(status, 2, err)
        self.assertIn("[reason_code: git-reset-hard]", err)
        status, _, err = self.pre("Write", {"file_path": str(self.repo / "tests" / "test_app.py"),
                                            "content": "def test_add():\n    assert True\n"})
        self.assertEqual(status, 2, err)
        self.assertIn("[reason_code: edit-test]", err)
        _write(self.repo, "tests/test_app.py", "def test_add():\n    assert True\n")
        self.assertEqual(self.stop()[0], 2)
        log = (self.repo / ".harden" / "hook_errors.log").read_text(encoding="utf-8")
        self.assertIn("config", log)

    def test_wrongly_typed_scope(self) -> None:
        (self.repo / ".harden" / "config.json").write_text(json.dumps({"scope": "src"}),
                                                           encoding="utf-8")
        self.check_still_guarded()
        log = (self.repo / ".harden" / "hook_errors.log").read_text(encoding="utf-8")
        self.assertEqual(len(log.strip().splitlines()), 1, log)   # not one line per call
        self.assertIn('"scope" must be a list of strings', log)

    def test_invalid_json_escape(self) -> None:
        (self.repo / ".harden" / "config.json").write_text(
            '{"gates": [{"name": "t", "cmd": "C:\\Users\\me\\run.bat"}]}', encoding="utf-8")
        self.check_still_guarded()

    def test_wrongly_typed_marker_list_falls_back_to_defaults(self) -> None:
        self.write_active(test_globs="tests/**")
        self.check_still_guarded()


class NestedRepositoryTests(unittest.TestCase):
    """A run in a repository nested inside the session's repository is guarded."""

    def setUp(self) -> None:
        self.outer = Path(tempfile.mkdtemp(prefix="harden-outer-"))
        _git(self.outer, "init", "-q")
        _write(self.outer, "README.md", "outer\n")
        self.inner = self.outer / "projects" / "bot"
        self.inner.mkdir(parents=True)
        _git(self.inner, "init", "-q")
        _write(self.inner, "tests/test_app.py", "def test_add():\n    assert 1\n")
        _git(self.inner, "add", "-A")
        _git(self.inner, "commit", "-q", "-m", "base")
        base = _git(self.inner, "rev-parse", "HEAD").strip()
        (self.inner / ".harden").mkdir()
        (self.inner / ".harden" / "active").write_text(json.dumps(
            {"base_sha": base, "mode": "apply", "started": "2026-09-23T00:00:00Z"}),
            encoding="utf-8")

    def tearDown(self) -> None:
        _rmtree(str(self.outer))

    def call(self, tool: str, tool_input: Dict[str, Any], cwd: Path) -> int:
        payload = {"session_id": "s1", "cwd": str(cwd), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": tool_input}
        return hg.run(json.dumps(payload), {"CLAUDE_PROJECT_DIR": str(self.outer)},
                      io.StringIO(), io.StringIO())

    def test_reset_hard_blocked_from_the_nested_repository(self) -> None:
        self.assertEqual(self.call("Bash", {"command": "git reset --hard"}, self.inner), 2)
        self.assertEqual(self.call("Bash", {"command": "git status"}, self.inner), 0)

    def test_edit_blocked_through_its_target_from_the_outer_cwd(self) -> None:
        target = str(self.inner / "tests" / "test_app.py")
        self.assertEqual(self.call("Edit", {"file_path": target}, self.outer), 2)
        self.assertEqual(hg.find_run_root({"CLAUDE_PROJECT_DIR": str(self.outer)},
                                          {"cwd": str(self.outer)}), None)


class ReportOnlyTests(HookTestCase):
    """mode report-only: no project edits, no commits (invariants 8-9)."""

    def setUp(self) -> None:
        super().setUp()
        self.write_active(mode="report-only")

    def test_file_tools_only_under_harden(self) -> None:
        status, _, err = self.pre("Edit", {"file_path": str(self.repo / "src" / "app.py")})
        self.assertEqual(status, 2)
        self.assertIn("[reason_code: report-only-edit]", err)
        self.assertEqual(self.pre("Write", {"file_path": str(self.repo / "src" / "new.py"),
                                            "content": "x"})[0], 2)
        self.assertEqual(self.pre("Write", {"file_path": str(self.repo / ".harden" /
                                                             "findings.json"),
                                            "content": "{}"})[0], 0)
        outside = Path(tempfile.gettempdir()) / "harden-notes.md"
        self.assertEqual(self.pre("Write", {"file_path": str(outside), "content": "x"})[0], 0)
        self.assertIn("report-only-edit", hg.REASON_CODES)

    def test_git_commands_that_record_changes(self) -> None:
        for command in ("git commit -m x", "git add .", "git apply fix.patch", "git am x.mbox",
                        "git cherry-pick abc", "git -C . commit -am x"):
            with self.subTest(command=command):
                status, _, err = self.pre("Bash", {"command": command})
                self.assertEqual(status, 2, command)
                self.assertIn("[reason_code: report-only-edit]", err)
        self.assertEqual(self.bash("git commit -m x", tool="PowerShell"), 2)
        for command in ("git status", "git diff", "git apply --check fix.patch",
                        "git add -n .", "git merge --abort", "git log --oneline"):
            with self.subTest(command=command):
                self.assertEqual(self.bash(command), 0, command)

    def test_stop_blocks_changes_in_report_only(self) -> None:
        _write(self.repo, "src/app.py", "def add(a, b):\n    return b + a\n")
        status, _, err = self.stop()
        self.assertEqual(status, 2)
        self.assertIn("report_only_change", err)

    def test_apply_mode_is_unaffected(self) -> None:
        self.write_active(mode="apply")
        self.assertEqual(self.pre("Edit", {"file_path": str(self.repo / "src" / "app.py")})[0], 0)
        self.assertEqual(self.bash("git commit -m x"), 0)


class GitCleanAliasTests(HookTestCase):
    BLOCKED = {
        "git clean -d": "git-clean",
        "git clean -x -d": "git-clean",
        "git clean -i": "git-clean",
        "git clean -dfx": "git-clean-force",
        "git clean --forc -dx": "git-clean-force",
        "git clean -e -n -fdx": "git-clean-force",
        "git -c clean.requireForce=false clean -dx": "git-clean-requireforce",
        "git config clean.requireForce false": "git-clean-requireforce",
        "git config alias.nuke '!rm -rf .'": "git-alias",
        "git config --global alias.co checkout": "git-alias",
        "git config set alias.x '!sh -c y'": "git-alias",
        "git -c alias.x='!rm -rf data' x": "git-alias",
        "git --config-env=alias.x=EVIL x": "git-alias",
        "git --config-env alias.x=EVIL x": "git-alias",
        "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.x GIT_CONFIG_VALUE_0='!rm -rf .' git x":
            "git-alias",
        "GIT_CONFIG_PARAMETERS=\"'clean.requireForce=false'\" git clean -d":
            "git-clean-requireforce",
    }
    ALLOWED = ["git clean -n", "git clean --dry-run -d", "git clean -nfd", "git clean -xdn",
               "git config --get alias.co", "git config alias.co", "git config --list",
               "git config user.name 'Harden Test'", "git config --unset alias.co",
               "git -c user.name=x log -1"]

    def test_clean_and_alias_forms_are_denied(self) -> None:
        for command, code in self.BLOCKED.items():
            with self.subTest(command=command):
                status, _, err = self.pre("Bash", {"command": command})
                self.assertEqual(status, 2, command)
                self.assertIn(f"[reason_code: {code}]", err)
        status, _, err = self.pre("PowerShell", {
            "command": "$env:GIT_CONFIG_COUNT=1; $env:GIT_CONFIG_KEY_0='alias.x'; git x"})
        self.assertEqual(status, 2)
        self.assertIn("[reason_code: git-alias]", err)

    def test_dry_runs_and_reads_are_allowed(self) -> None:
        for command in self.ALLOWED:
            with self.subTest(command=command):
                status, _, err = self.pre("Bash", {"command": command})
                self.assertEqual(status, 0, f"{command}: {err}")


class RunEvidenceTests(HookTestCase):
    """.harden/gates/** and .harden/session.json are read-only for the agent."""

    def test_file_tools_and_shell_writes_are_denied(self) -> None:
        gates = self.repo / ".harden" / "gates"
        gates.mkdir()
        (gates / "baseline.json").write_text("{}", encoding="utf-8")
        for tool, tool_input in (
                ("Write", {"file_path": str(gates / "baseline.json"), "content": "{}"}),
                ("Write", {"file_path": str(gates / "forged.json"), "content": "{}"}),
                ("Edit", {"file_path": ".harden/session.json"}),
                ("Bash", {"command": "echo '{}' > .harden/gates/baseline.json"}),
                ("Bash", {"command": "cp x.json .harden/session.json"}),
                ("PowerShell", {"command": "Set-Content -Path .harden/gates/b.json -Value x"})):
            with self.subTest(tool=tool, tool_input=tool_input):
                status, _, err = self.pre(tool, tool_input)
                self.assertEqual(status, 2)
                self.assertIn("[reason_code: run-evidence-write]", err)
        self.assertEqual(self.pre("Write", {"file_path": str(self.repo / ".harden" /
                                                             "findings.json"),
                                            "content": "{}"})[0], 0)
        self.assertEqual(self.bash("cat .harden/gates/baseline.json"), 0)

    def test_the_verifier_record_is_run_evidence(self) -> None:
        for tool, tool_input in (
                ("Write", {"file_path": ".harden/verify.json", "content": "{}"}),
                ("Edit", {"file_path": str(self.repo / ".harden" / "verify" / "r1" / "a.log")}),
                ("Bash", {"command": "echo '{\"final_status\": \"green\"}' > "
                                     ".harden/verify.json"}),
                ("PowerShell", {"command": "Set-Content -Path .harden/verify/x.txt -Value x"})):
            with self.subTest(tool=tool, tool_input=tool_input):
                status, _, err = self.pre(tool, tool_input)
                self.assertEqual(status, 2)
                self.assertIn("[reason_code: run-evidence-write]", err)
        self.assertEqual(self.bash("cat .harden/verify.json"), 0)

    def test_raw_captures_and_budget_are_run_evidence(self) -> None:
        raw = self.repo / ".harden" / "passes" / "raw"
        raw.mkdir(parents=True)
        (raw / "a1.md").write_bytes(b"{}")
        for tool, tool_input in (
                ("Write", {"file_path": ".harden/budget.json", "content": "{}"}),
                ("Write", {"file_path": str(raw / "a1.md"), "content": "{}"}),
                ("Edit", {"file_path": str(raw / "a1.json")}),
                ("Bash", {"command": "echo '{}' > .harden/budget.json"}),
                ("Bash", {"command": "cp forged.md .harden/passes/raw/a1.md"}),
                ("PowerShell", {"command": "Set-Content -Path .harden/passes/raw/x.md -Value x"})):
            with self.subTest(tool=tool, tool_input=tool_input):
                status, _, err = self.pre(tool, tool_input)
                self.assertEqual(status, 2)
                self.assertIn("[reason_code: run-evidence-write]", err)
        self.assertEqual(self.pre("Write", {"file_path": ".harden/passes/p1.json",
                                            "content": "{}"})[0], 0)
        self.assertEqual(self.bash("cat .harden/budget.json"), 0)


class ProfileRuleTests(HookTestCase):
    """The run profile's forbidden_commands and its own protection (user-policy-autonomy
    U01-F03, U01-F04)."""

    FORBIDDEN = ["npm run deploy", "/\\bgit\\s+push\\b/", "/\\bsign[_-]?tx\\b/i", "/(/"]

    def setUp(self) -> None:
        super().setUp()
        self.write_active(mode="auto", forbidden_commands=self.FORBIDDEN)
        _write(self.repo, ".harden/profile.json", '{"version": 1}\n')

    def test_forbidden_commands_are_refused_with_the_pattern_named(self) -> None:
        cases = [
            ("Bash", "npm run deploy", "npm run deploy"),
            ("Bash", "cd web &&  NPM  run   deploy -- --prod", "npm run deploy"),
            ("Bash", 'npm run "deploy"', "npm run deploy"),
            ("Bash", "bash -c 'npm run deploy'", "npm run deploy"),
            ("Bash", "git push origin harden/x", "/\\bgit\\s+push\\b/"),
            ("Bash", "python scripts/Sign_TX.py --amount 5", "/\\bsign[_-]?tx\\b/i"),
            ("PowerShell", "npm run deploy; Write-Output done", "npm run deploy"),
            ("PowerShell", "git push", "/\\bgit\\s+push\\b/"),
        ]
        for tool, command, pattern in cases:
            with self.subTest(command=command):
                status, _, err = self.pre(tool, {"command": command})
                self.assertEqual(status, 2, err)
                self.assertIn("[reason_code: profile-forbidden]", err)
                self.assertIn(repr(pattern), err)
                self.assertIn("the run profile forbids", err)
                event = read_events(self.repo)[-1]
                self.assertEqual((event["tool"], event["reason_code"]),
                                 (tool, "profile-forbidden"))

    def test_other_commands_still_run(self) -> None:
        for command in ("npm run test", "git status", "git pushd", "python sign.py",
                        "cat .harden/profile.json", "git log --grep deploy"):
            with self.subTest(command=command):
                self.assertEqual(self.bash(command), 0, command)

    def test_forbidden_applies_in_report_only_and_after_the_canary(self) -> None:
        self.write_active(mode="report-only", forbidden_commands=self.FORBIDDEN)
        status, _, err = self.pre("Bash", {"command": "npm run deploy"})
        self.assertEqual(status, 2)
        self.assertIn("profile-forbidden", err)
        status, _, err = self.pre("Bash", {"command": "echo HARDEN_HOOK_CANARY; git push"})
        self.assertEqual(status, 2)
        self.assertIn("[reason_code: canary-bash]", err)

    def test_a_marker_without_forbidden_commands_forbids_nothing(self) -> None:
        self.write_active(mode="auto")
        self.assertEqual(self.bash("npm run deploy"), 0)
        # A wrongly typed value is read the stricter way: one string is one pattern.
        self.write_active(mode="auto", forbidden_commands="git push")
        self.assertEqual(self.bash("git push"), 2)
        self.assertEqual(self.bash("npm run deploy"), 0)

    def test_the_profile_is_read_only_while_the_run_is_active(self) -> None:
        profile = self.repo / ".harden" / "profile.json"
        for tool, tool_input in (
                ("Write", {"file_path": str(profile), "content": "{}"}),
                ("Edit", {"file_path": ".harden/profile.json"}),
                ("Bash", {"command": "echo '{}' > .harden/profile.json"}),
                ("Bash", {"command": "cp other.json .harden/profile.json"}),
                ("Bash", {"command": "mv .harden/profile.json /tmp/p.json"}),
                ("Bash", {"command": "rm .harden/profile.json"}),
                ("Bash", {"command": "sed -i 's/1/2/' .harden/profile.json"}),
                ("PowerShell", {"command": "Remove-Item .harden/profile.json"}),
                ("PowerShell", {"command": "Set-Content -Path .harden/profile.json -Value x"})):
            with self.subTest(tool=tool, tool_input=tool_input):
                status, _, err = self.pre(tool, tool_input)
                self.assertEqual(status, 2, err)
                self.assertIn("[reason_code: profile-write]", err)
        self.assertEqual(profile.read_text(encoding="utf-8"), '{"version": 1}\n')
        template = str(self.repo / ".harden" / "profile.template.json")
        self.assertEqual(self.pre("Write", {"file_path": template, "content": "{}"})[0], 0)
        self.assertEqual(self.bash("cat .harden/profile.json"), 0)

    def test_windows_spellings_of_the_profile(self) -> None:
        backslashed = str(self.repo).replace("/", "\\") + "\\.harden\\profile.json"
        self.assertEqual(self.pre("Write", {"file_path": backslashed, "content": "{}"})[0], 2)
        self.assertEqual(self.pre("Edit", {"file_path": ".harden\\profile.json"})[0], 2)
        status, _, err = self.pre("PowerShell", {
            "command": "Copy-Item C:\\temp\\p.json .harden\\profile.json"})
        self.assertEqual(status, 2, err)
        self.assertIn("profile-write", err)

    @unittest.skipUnless(os.name == "nt", "case-insensitive paths on Windows")
    def test_profile_case_insensitive_on_windows(self) -> None:
        upper = str(self.repo).upper() + "\\.HARDEN\\PROFILE.JSON"
        self.assertEqual(self.pre("Write", {"file_path": upper, "content": "{}"})[0], 2)
        status, _, err = self.pre("PowerShell", {"command": "NPM RUN DEPLOY"})
        self.assertEqual(status, 2)
        self.assertIn("profile-forbidden", err)

    def test_profile_rules_are_inactive_without_a_marker(self) -> None:
        (self.repo / ".harden" / "active").unlink()
        self.assertEqual(self.bash("npm run deploy"), 0)
        self.assertEqual(self.pre("Write", {"file_path": ".harden/profile.json",
                                            "content": "{}"})[0], 0)


class AllowListEditTests(HookTestCase):
    def test_allowed_test_file_may_be_edited_with_file_tools(self) -> None:
        self.write_active(allow_test_deletions=["tests/test_app.py"])
        target = str(self.repo / "tests" / "test_app.py")
        self.assertEqual(self.pre("Edit", {"file_path": target})[0], 0)
        self.assertEqual(self.pre("Write", {"file_path": target, "content": ""})[0], 0)
        self.assertEqual(self.bash("sed -i 's/3/4/' tests/test_app.py"), 2)
        _write(self.repo, "tests/test_other.py", "def test_o():\n    pass\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "other")
        self.write_active(allow_test_deletions=["tests/test_app.py"],
                          base_sha=_git(self.repo, "rev-parse", "HEAD").strip())
        self.assertEqual(self.pre("Edit", {"file_path": str(self.repo / "tests" /
                                                            "test_other.py")})[0], 2)

    def test_allowed_config_file_may_be_edited(self) -> None:
        self.assertEqual(self.pre("Write", {"file_path": str(self.repo / "tsconfig.json"),
                                            "content": "{}"})[0], 2)
        self.write_active(allow_config_edits=["tsconfig.json"])
        self.assertEqual(self.pre("Write", {"file_path": str(self.repo / "tsconfig.json"),
                                            "content": "{}"})[0], 0)


class RunControlTests(HookTestCase):
    """Commands that change or end the run are allowed but logged."""

    def control_events(self) -> List[Dict[str, Any]]:
        return [e for e in read_events(self.repo) if e.get("type") == "run-control"]

    def test_run_control_commands_are_logged_not_denied(self) -> None:
        commands = {
            "rm .harden/active": "remove-marker (rm)",
            "rm -r .harden": "remove-marker (rm)",
            "python \"C:/skills/harden/scripts/run_state.py\" stop --force":
                "run_state.py stop --force",
            "python run_state.py set-mode report-only --reason x": "run_state.py set-mode",
            "python3 scripts/run_state.py allow-line src/a.py --text '# noqa' --reason H-1":
                "run_state.py allow-line",
            "python run_state.py allow-config-edit package.json --reason H-2":
                "run_state.py allow-config-edit",
            "python run_state.py allow-test-deletion tests/x.py --cases 1 --reason H-3":
                "run_state.py allow-test-deletion",
        }
        for command, action in commands.items():
            with self.subTest(command=command):
                self.write_active()
                status, _, err = self.pre("Bash", {"command": command})
                self.assertEqual(status, 0, err)
                event = self.control_events()[-1]
                self.assertIn(action, event["actions"])
                self.assertEqual((event["decision"], event["tool"]), ("allow", "Bash"))
        self.assertEqual(self.bash("Remove-Item .harden/active", tool="PowerShell"), 0)
        self.assertIn("remove-marker (remove-item)", self.control_events()[-1]["actions"])

    def test_ordinary_run_state_commands_are_not_logged(self) -> None:
        for command in ("python run_state.py stop", "python run_state.py status --json",
                        "python run_state.py canary-check", "git status"):
            with self.subTest(command=command):
                self.assertEqual(self.bash(command), 0)
        self.assertEqual(self.control_events(), [])

    def test_stop_reminds_once_when_the_marker_vanished(self) -> None:
        self.assertEqual(self.bash("git status"), 0)          # the hook records session.json
        (self.repo / ".harden" / "active").unlink()
        code, out, err = self.stop()
        self.assertEqual((code, err), (0, ""))
        self.assertIn("without `run_state.py stop`", json.loads(out)["systemMessage"])
        self.assertEqual(self.stop(), (0, "", ""))          # once per run

    def test_no_reminder_after_a_proper_stop(self) -> None:
        self.assertEqual(self.bash("git status"), 0)
        session_path = self.repo / ".harden" / "session.json"
        session = json.loads(session_path.read_text(encoding="utf-8"))
        session["stopped"] = {"at": "2026-09-24T00:00:00Z", "by": "run_state.py stop"}
        session_path.write_text(json.dumps(session), encoding="utf-8")
        (self.repo / ".harden" / "active").unlink()
        self.assertEqual(self.stop(), (0, "", ""))


class StopTests(HookTestCase):
    def test_stop_hook_active_true_never_blocks(self) -> None:
        _write(self.repo, "tests/test_app.py", "def test_add():\n    assert True\n")
        self.assertEqual(self.stop(active=True), (0, "", ""))

    def test_stop_with_violation_blocks(self) -> None:
        _write(self.repo, "tests/test_app.py", "def test_add():\n    assert True\n")
        code, out, err = self.stop()
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("tests/test_app.py", err)
        self.assertIn("flag it to the user", err)

    def test_stop_clean_passes(self) -> None:
        _write(self.repo, "src/app.py", "def add(a, b):\n    return b + a\n")
        _write(self.repo, "tests/test_new.py", "def test_new():\n    assert 1\n")
        self.assertEqual(self.stop()[0], 0)

    def test_stop_without_base_is_logged_and_allowed(self) -> None:
        self.write_active(base_sha="")
        self.assertEqual(self.stop()[0], 0)
        log = (self.repo / ".harden" / "hook_errors.log").read_text(encoding="utf-8")
        self.assertIn("no base_sha", log)


class ModeMessageTests(HookTestCase):
    """Messages follow the run's mode: --interactive sends a question to the user; an
    autonomous run asks nobody and never waits (user-policy-autonomy U01-F01), so the same
    denial routes it to .harden/progress.md and the report. Reason codes stay the same."""

    OWNER = "owner item in .harden/progress.md and the report"

    def denial(self, tool: str, tool_input: Dict[str, Any], code: str) -> str:
        status, _, err = self.pre(tool, tool_input)
        self.assertEqual(status, 2, f"not blocked: {tool_input}")
        self.assertIn(f"[reason_code: {code}]", err)
        return err

    def autonomous_denials(self) -> List[str]:
        test_file = str(self.repo / "tests" / "test_app.py")
        return [
            self.denial("Edit", {"file_path": test_file}, "edit-test"),
            self.denial("Bash", {"command": "git push --force"}, "git-push-force"),
            self.denial("Bash", {"command": "sed -i 's/3/4/' tests/test_app.py"}, "write-test"),
            self.denial("Bash", {"command": "rm tests/test_app.py"}, "delete-test"),
            self.denial("Bash", {"command": "rm tsconfig.json"}, "delete-protected"),
            self.denial("Bash", {"command": "git clean -d"}, "git-clean"),
        ]

    def test_autonomous_run_routes_every_escalation_to_the_report(self) -> None:
        self.write_active(mode="auto")
        for err in self.autonomous_denials():
            with self.subTest(err=err[:60]):
                self.assertIn(self.OWNER, err)
                self.assertNotIn("the user", err)
                self.assertNotIn("git stash", err)
        errors = self.autonomous_denials()
        self.assertIn("U01-F01", errors[0])
        self.assertIn("an autonomous run never deletes an existing test", errors[3])
        self.assertIn("if it must go, record it as an owner item", errors[4])
        # A report-only run that started autonomous asks nobody either.
        self.write_active(mode="report-only", mode_requested="auto")
        err = self.denial("Edit", {"file_path": str(self.repo / "src" / "app.py")},
                          "report-only-edit")
        self.assertIn("say so in the report; this run asks nobody and never waits", err)
        self.assertNotIn("ask the user", err)

    def test_interactive_run_asks_the_user(self) -> None:
        for fields in ({"mode": "interactive"}, {"mode": "apply"},
                       {"mode": "report-only", "mode_requested": "interactive"}):
            with self.subTest(marker=fields):
                self.write_active(**fields)
                err = self.denial("Bash", {"command": "git push --force"}, "git-push-force")
                self.assertIn("ask the user", err)
                self.assertIn("git stash with the user's consent", err)
                self.assertNotIn(self.OWNER, err)
        self.write_active(mode="interactive")
        err = self.denial("Bash", {"command": "rm tests/test_app.py"}, "delete-test")
        self.assertIn("unless the user approved it and run_state.py allow-test-deletion", err)
        err = self.denial("Edit", {"file_path": str(self.repo / "tests" / "test_app.py")},
                          "edit-test")
        self.assertIn("flag it to the user", err)
        self.write_active(mode="report-only", mode_requested="interactive")
        err = self.denial("Edit", {"file_path": str(self.repo / "src" / "app.py")},
                          "report-only-edit")
        self.assertIn("ask the user", err)

    def test_marker_without_mode_names_both_routes(self) -> None:
        self.write_active(mode=None)
        err = self.denial("Edit", {"file_path": str(self.repo / "tests" / "test_app.py")},
                          "edit-test")
        self.assertIn("flag it to the user with the evidence (--interactive)", err)
        self.assertIn(self.OWNER + " (autonomous mode)", err)
        err = self.denial("Bash", {"command": "rm tests/test_app.py"}, "delete-test")
        self.assertIn("approved it with --interactive", err)
        self.assertIn("an autonomous run never deletes an existing test", err)

    def test_stop_message_follows_the_mode(self) -> None:
        _write(self.repo, "tests/test_app.py", "def test_add():\n    assert True\n")
        self.write_active(mode="auto")
        code, _, err = self.stop()
        self.assertEqual(code, 2)
        self.assertIn("even one you believe necessary", err)
        self.assertIn(self.OWNER, err)
        self.assertNotIn("the user", err)
        self.assertIn("[reason_code: stop-hard-violations]", err)
        self.write_active(mode=None)
        code, _, err = self.stop()
        self.assertEqual(code, 2)
        self.assertIn("flag it to the user", err)
        self.assertIn("in autonomous mode revert every one", err)

    def test_bypass_warning_in_autonomous_mode_goes_to_the_report(self) -> None:
        self.write_active(mode="auto")
        _, out, _ = self.pre("Bash", {"command": "git status"}, mode="bypassPermissions")
        context = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("Write this warning first in .harden/progress.md and the report", context)
        self.assertIn("sandbox_ack", context)
        self.assertNotIn("Tell the user now", context)

    def test_asks_user(self) -> None:
        self.assertIs(hg.asks_user({"mode": "auto"}), False)
        self.assertIs(hg.asks_user({"mode": "report-only"}), False)
        self.assertIs(hg.asks_user({"mode": "apply"}), True)
        self.assertIs(hg.asks_user({"mode": "report-only", "mode_requested": "interactive"}),
                      True)
        self.assertIsNone(hg.asks_user({}))
        self.assertIsNone(hg.asks_user({"mode": ""}))


class SessionTests(HookTestCase):
    def test_bypass_warning_emitted_once(self) -> None:
        code, out, _ = self.pre("Read", {"file_path": str(self.repo / "src" / "app.py")},
                                mode="bypassPermissions")
        self.assertEqual(code, 0)
        data = json.loads(out)
        context = data["hookSpecificOutput"]["additionalContext"]
        self.assertEqual(data["hookSpecificOutput"]["hookEventName"], "PreToolUse")
        self.assertIn("bypassPermissions", context)
        self.assertIn("native Windows", context)
        code, out, _ = self.pre("Read", {"file_path": str(self.repo / "src" / "app.py")},
                                mode="bypassPermissions")
        self.assertEqual((code, out), (0, ""))
        session = json.loads((self.repo / ".harden" / "session.json").read_text(encoding="utf-8"))
        self.assertEqual(session["permission_mode"], "bypassPermissions")
        self.assertTrue(session["bypass_warned"])

    def test_block_takes_priority_over_bypass_warning(self) -> None:
        code, out, _ = self.pre("Edit", {"file_path": str(self.repo / "tests" / "test_app.py")},
                                mode="bypassPermissions")
        self.assertEqual((code, out), (2, ""))
        code, out, _ = self.pre("Bash", {"command": "git status"}, mode="bypassPermissions")
        self.assertEqual(code, 0)
        self.assertIn("additionalContext", out)

    def test_permission_mode_recorded_on_first_sight(self) -> None:
        self.pre("Bash", {"command": "git status"}, mode="default")
        self.pre("Bash", {"command": "git status"}, mode="acceptEdits")
        session = json.loads((self.repo / ".harden" / "session.json").read_text(encoding="utf-8"))
        self.assertEqual(session["permission_mode"], "default")
        self.assertEqual(session["modes_seen"], ["default", "acceptEdits"])

    def test_new_run_resets_session(self) -> None:
        self.pre("Bash", {"command": "git status"}, mode="bypassPermissions")
        self.write_active(started="2026-09-24T00:00:00Z")
        _, out, _ = self.pre("Bash", {"command": "git status"}, mode="bypassPermissions")
        self.assertIn("additionalContext", out)

    def test_session_records_the_transcript_path(self) -> None:
        payload = {"session_id": "s1", "cwd": str(self.repo), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": "Bash",
                   "tool_input": {"command": "git status"}, "transcript_path": "C:/t/main.jsonl"}
        self.assertEqual(self.run_hook(payload)[0], 0)
        payload["transcript_path"] = "C:/t/other.jsonl"
        self.assertEqual(self.run_hook(payload)[0], 0)
        session = json.loads((self.repo / ".harden" / "session.json").read_bytes()
                             .decode("utf-8"))
        self.assertEqual(session["transcript_path"], "C:/t/main.jsonl")


class RobustnessTests(HookTestCase):
    def test_internal_error_fails_open_and_logs(self) -> None:
        active = self.repo / ".harden" / "active"
        active.unlink()
        active.mkdir()
        code, out, err = self.pre("Edit", {"file_path": str(self.repo / "tests" / "test_app.py")})
        self.assertEqual((code, out, err), (0, "", ""))
        log = (self.repo / ".harden" / "hook_errors.log").read_text(encoding="utf-8")
        self.assertEqual(len(log.strip().splitlines()), 1)
        self.assertIn("event=PreToolUse", log)

    def test_marker_with_utf8_bom_still_guards(self) -> None:
        # Windows PowerShell 5.1 (Set-Content/Out-File -Encoding utf8) writes a BOM; the hook
        # must not fail open on it, and the Stop check must still read base_sha.
        active = self.repo / ".harden" / "active"
        active.write_bytes(b"\xef\xbb\xbf" + active.read_bytes())
        self.assertEqual(self.bash("git reset --hard"), 2)
        _write(self.repo, "tests/test_app.py", "def test_add():\n    assert True\n")
        self.assertEqual(self.stop()[0], 2)
        self.assertFalse((self.repo / ".harden" / "hook_errors.log").exists())

    def test_unexpected_exception_is_logged(self) -> None:
        with mock.patch.object(hg, "check_shell_tool", side_effect=RuntimeError("boom\nline2")):
            code, out, err = self.pre("Bash", {"command": "git push --force"})
        self.assertEqual((code, out, err), (0, "", ""))
        log = (self.repo / ".harden" / "hook_errors.log").read_text(encoding="utf-8")
        self.assertIn("RuntimeError: boom line2", log)
        self.assertEqual(len(log.strip().splitlines()), 1)

    def test_pretooluse_is_fast(self) -> None:
        start = time.perf_counter()
        for _ in range(20):
            self.pre("Bash", {"command": "git commit -m 'x' && git push origin main"})
            self.pre("Edit", {"file_path": str(self.repo / "src" / "app.py")})
        per_call = (time.perf_counter() - start) / 40
        self.assertLess(per_call, 0.05, f"{per_call * 1000:.1f} ms per PreToolUse call")

    def test_cli_end_to_end(self) -> None:
        script = str(SCRIPTS / "hook_guard.py")
        env = dict(os.environ, CLAUDE_PROJECT_DIR=str(self.repo))
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Bash", "cwd": str(self.repo),
                   "permission_mode": "default", "tool_input": {"command": "git reset --hard"}}
        start = time.perf_counter()
        proc = subprocess.run([sys.executable, script], input=json.dumps(payload).encode("utf-8"),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, check=False)
        elapsed = time.perf_counter() - start
        self.assertEqual(proc.returncode, 2)
        self.assertIn("git reset --hard", proc.stderr.decode("utf-8"))
        self.assertLess(elapsed, 3.0)
        payload["tool_input"] = {"command": "git status"}
        proc = subprocess.run([sys.executable, script], input=json.dumps(payload).encode("utf-8"),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, check=False)
        self.assertEqual((proc.returncode, proc.stdout, proc.stderr), (0, b"", b""))

    def test_cli_under_python_no_site(self) -> None:
        # The hook command may run an interpreter without site-packages (python -S): the
        # script and its sibling module must work with the standard library alone.
        script = str(SCRIPTS / "hook_guard.py")
        env = dict(os.environ, CLAUDE_PROJECT_DIR=str(self.repo))
        env.pop("PYTHONPATH", None)
        cases = [
            ({"tool_name": "Bash", "tool_input": {"command": "echo HARDEN_HOOK_CANARY"}},
             2, "canary-bash"),
            ({"tool_name": "Edit", "tool_input": {"file_path": str(self.repo / "tests" /
                                                                   "test_app.py")}},
             2, "edit-test"),
            ({"tool_name": "Bash", "tool_input": {"command": "git commit --amend"}},
             2, "git-commit-amend"),
            ({"tool_name": "Bash", "tool_input": {"command": "git status"}}, 0, None),
        ]
        for extra, expected, code in cases:
            payload = {"session_id": "s1", "hook_event_name": "PreToolUse", "cwd": str(self.repo),
                       "permission_mode": "default", "tool_use_id": "t1"}
            payload.update(extra)
            with self.subTest(payload=extra):
                proc = subprocess.run([sys.executable, "-S", script],
                                      input=json.dumps(payload).encode("utf-8"),
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                                      check=False, timeout=60)
                stderr = proc.stderr.decode("utf-8")
                self.assertEqual(proc.returncode, expected, stderr)
                self.assertNotIn("Traceback", stderr)
                if code:
                    self.assertIn(f"[reason_code: {code}]", stderr)
                    self.assertEqual(read_events(self.repo)[-1]["reason_code"], code)
                else:
                    self.assertEqual((proc.stdout, proc.stderr), (b"", b""))
        self.assertFalse((self.repo / ".harden" / "hook_errors.log").exists())


def _msys(path: Path) -> str:
    """Git Bash spelling of a Windows path: C:\\a\\b -> /c/a/b."""
    text = str(path).replace("\\", "/")
    return "/" + text[0].lower() + text[2:]


class PackageInstallTests(HookTestCase):
    """E01-F10: package installs stay inside the run (reason_code pkg-outside-repo)."""

    def setUp(self) -> None:
        super().setUp()
        # Every manifest the managers look for, so installs from the repository stay inside
        # it whatever the machine holds above the temporary directory.
        _write(self.repo, "pyproject.toml", "[project]\nname = 'fixture'\nversion = '0'\n")
        _write(self.repo, "Cargo.toml", "[package]\nname = 'fixture'\nversion = '0.1.0'\n")
        (self.repo / ".venv").mkdir()
        self.outside = Path(tempfile.mkdtemp(prefix="harden-outside-"))

    def tearDown(self) -> None:
        _rmtree(str(self.outside))
        super().tearDown()

    def run_from(self, cwd: Any, command: str, tool: str = "Bash") -> Tuple[int, str]:
        payload = {"session_id": "s1", "cwd": str(cwd), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": tool,
                   "tool_input": {"command": command}, "tool_use_id": "t1"}
        code, _, err = self.run_hook(payload)
        return code, err

    def assert_denied(self, commands: List[str], tool: str = "Bash", cwd: Any = None) -> None:
        for command in commands:
            with self.subTest(command=command, tool=tool):
                code, err = self.run_from(cwd or self.repo, command, tool)
                self.assertEqual(code, 2, f"not blocked: {command}")
                self.assertIn("[reason_code: pkg-outside-repo]", err)
                self.assertEqual(read_events(self.repo)[-1]["reason_code"], "pkg-outside-repo")

    def assert_allowed(self, commands: List[str], tool: str = "Bash", cwd: Any = None) -> None:
        for command in commands:
            with self.subTest(command=command, tool=tool):
                code, err = self.run_from(cwd or self.repo, command, tool)
                self.assertEqual(code, 0, f"blocked: {command}: {err}")

    INSTALLS = ["npm install jscpd", "npm i -D jscpd", "npm ci", "npm uninstall jscpd",
                "pnpm add -D jscpd", "pnpm install", "yarn add jscpd", "yarn", "bun add jscpd",
                "pip install ruff", "pip uninstall -y ruff", "python -m pip install ruff",
                "uv add ruff", "uv remove ruff", "uv pip install ruff", "cargo add serde",
                "cargo remove serde", "poetry add ruff", "poetry remove ruff"]
    EPHEMERAL = ["npx jscpd src", "npx --yes jscpd@4 src", "npx -p jscpd jscpd src",
                 "pnpm dlx jscpd src", "pnpx jscpd src", "bunx eslint .", "uvx ruff check .",
                 "uvx --from ruff ruff check .", "pipx run ruff check .",
                 "npm exec -- jscpd src", "yarn dlx jscpd src", "bun x eslint .",
                 "uv tool run ruff check .", "uv run ruff check ."]

    def test_installs_from_a_cwd_outside_the_repository_are_denied(self) -> None:
        self.assert_denied(self.INSTALLS, cwd=self.outside)
        self.assert_denied(["npm install jscpd", "pip install ruff"], tool="PowerShell",
                           cwd=self.outside)

    def test_installs_from_inside_the_repository_are_allowed(self) -> None:
        self.assert_allowed(self.INSTALLS)
        self.assert_allowed(["cd src && npm install --save-dev jscpd",
                             "pip install -r requirements.txt", "yarn install --frozen-lockfile",
                             "sudo npm install --save-dev jscpd"])

    def test_cd_into_the_repository_from_outside_is_followed(self) -> None:
        self.assert_allowed([f"cd '{self.repo}' && npm install --save-dev jscpd",
                             f"cd \"{self.repo}\"; pip install ruff"], cwd=self.outside)

    def test_ephemeral_runners_are_always_allowed(self) -> None:
        for cwd in (self.repo, self.outside):
            self.assert_allowed(self.EPHEMERAL, cwd=cwd)
            self.assert_allowed(["npx jscpd src"], tool="PowerShell", cwd=cwd)

    def test_package_managers_launched_by_a_runner_are_checked(self) -> None:
        self.assert_denied(["npx pnpm add -g jscpd", "corepack pnpm add -g jscpd",
                            "uv run pip install --user ruff", "poetry run pip install --user x",
                            "npm exec -- pnpm add -g jscpd"])
        self.assert_denied(["npx pnpm add jscpd"], cwd=self.outside)
        self.assert_allowed(["npx pnpm add -D jscpd", "uv run pip install ruff"])

    def test_global_forms_are_denied(self) -> None:
        self.assert_denied([
            "npm install -g jscpd", "npm i --global jscpd", "npm -g install jscpd",
            "npm install --location=global jscpd", "npm install --location global jscpd",
            "npm i -gD jscpd", "pnpm add -g jscpd", "pnpm add --global-dir /tmp/g jscpd",
            "yarn global add jscpd", "bun add -g jscpd", "bun install --global jscpd",
            "pip install --user ruff", "pip3 install --user ruff", "pip3.12 install --user ruff",
            "python -m pip install --user ruff", "python3 -X utf8 -m pip install --user ruff",
            "pip install --break-system-packages ruff", "uv pip install --system ruff",
            "uv tool install ruff", "uv tool uninstall ruff", "pipx install ruff",
            "pipx inject ruff x", "poetry self add poetry-plugin-export", "cargo install ripgrep",
            "cargo install --path .", "cargo uninstall ripgrep",
            "cargo install --root ~/bin ripgrep", "cargo install --root src ripgrep",
            "CARGO_INSTALL_ROOT=/opt/cargo cargo install ripgrep",
            "sudo npm install -g jscpd", "sudo -u root npm i -g jscpd",
            "bash -c 'npm install -g jscpd'"])

    def test_directory_and_target_options_outside_are_denied(self) -> None:
        self.assert_denied([
            "npm --prefix .. install jscpd", "npm install --prefix=../other jscpd",
            "npm install -C .. jscpd", "pnpm -C .. add jscpd", "pnpm --dir=.. add jscpd",
            "pnpm add -C.. jscpd", "pnpm add --modules-dir ../nm jscpd",
            "yarn --cwd .. add jscpd", "yarn --cwd ..", "bun add --cwd .. jscpd",
            "uv --directory .. add ruff", "uv add --project .. ruff",
            "uv pip install --target ../lib ruff", "poetry -C .. add ruff",
            "poetry --directory=.. add ruff", "cargo -C .. add serde",
            "cargo add --manifest-path ../Cargo.toml serde", "pip install --target ../lib ruff",
            "pip install -t .. ruff", "pip install -t../lib ruff", "pip install --prefix ~ ruff",
            "npm install --prefix \"$HARDEN_TEST_UNSET_VARIABLE_1\" jscpd"])

    def test_directory_changes_in_the_command_are_followed(self) -> None:
        self.assert_denied([
            "cd .. && npm install jscpd", "cd ~ && npm i jscpd", "cd; npm i jscpd",
            "cd src && cd ../.. && pip install ruff", "pushd .. && npm i jscpd",
            "(cd .. && npm i jscpd)", "cd -P .. && npm i jscpd", "cd -- .. && npm i jscpd",
            "bash -c 'cd .. && npm i jscpd'", "env -C .. npm i jscpd",
            "cd src; cd ..; cd ..; yarn",
            # A directory the hook cannot resolve counts as outside.
            "cd \"$HARDEN_TEST_UNSET_VARIABLE_1\" && npm i jscpd",
            "cd $(git rev-parse --show-toplevel) && npm i jscpd"])
        self.assert_allowed([
            "(cd ..); npm install jscpd", "cd .. && cd - && npm install jscpd",
            "pushd .. && popd && npm install jscpd", "bash -c 'cd ..'; npm install jscpd",
            f"cd .. && cd '{self.repo}' && npm install jscpd", "cd ../.. | cat; npm i jscpd",
            "cd .. && echo npm install jscpd"])

    def test_paths_inside_the_repository_are_allowed(self) -> None:
        self.assert_allowed([
            "npm install --prefix .harden/tools jscpd", "npm i --prefix=./.harden/tools jscpd",
            "pnpm --dir .harden/tools add jscpd", "pip install --target .harden/tools/py ruff",
            "uv pip install --target .harden/tools/py ruff",
            "cargo install --root .harden/tools cargo-machete",
            "cargo install --root=.harden/tools/bin cargo-machete",
            "CARGO_INSTALL_ROOT=.harden/tools cargo install cargo-machete",
            "cargo install --list", "cargo add --manifest-path crates/a/Cargo.toml serde",
            "cd .harden && cargo install --root tools cargo-machete"])
        # cargo install --root under .harden/tools writes nowhere else, whatever the cwd.
        self.assert_allowed([f"cargo install --root '{self.repo}/.harden/tools' x"],
                            cwd=self.outside)

    def test_reads_and_text_mentions_are_allowed(self) -> None:
        commands = ["npm ls -g", "pip list --user", "npm view jscpd", "pnpm list --global",
                    "yarn --version", "cargo build", "uv pip list --system", "pip show ruff",
                    "echo npm install -g jscpd", "which pip",
                    "git commit -m 'chore: npm install -g jscpd'",
                    "grep -rn pip install --user docs", "python -m pytest -q"]
        self.assert_allowed(commands)
        self.assert_allowed(commands, cwd=self.outside)

    def test_message_names_the_safe_alternatives(self) -> None:
        code, err = self.run_from(self.repo, "npm install -g jscpd")
        self.assertEqual(code, 2)
        for text in ("npx", "pnpm dlx", "uvx", ".harden/tools", "E01-F10", "ask the user"):
            self.assertIn(text, err)

    def test_nothing_is_checked_without_a_run(self) -> None:
        (self.repo / ".harden" / "active").unlink()
        self.assertEqual(self.pre("Bash", {"command": "npm install -g jscpd"}), (0, "", ""))
        code, _ = self.run_from(self.outside, "npm install jscpd")
        self.assertEqual(code, 0)

    def test_internal_error_fails_open(self) -> None:
        with mock.patch.object(hg, "_package_install_reason",
                               side_effect=RuntimeError("pkg boom")):
            code, out, err = self.pre("Bash", {"command": "npm install -g jscpd"})
        self.assertEqual((code, out, err), (0, "", ""))
        log = (self.repo / ".harden" / "hook_errors.log").read_text(encoding="utf-8")
        self.assertIn("RuntimeError: pkg boom", log)

    def test_package_check_is_fast(self) -> None:
        commands = ["cd src && npm install --save-dev jscpd", "pip install --user ruff",
                    "uv add ruff", "cargo install --root .harden/tools x"]
        start = time.perf_counter()
        for _ in range(10):
            for command in commands:
                self.run_from(self.repo, command)
        per_call = (time.perf_counter() - start) / (10 * len(commands))
        self.assertLess(per_call, 0.05, f"{per_call * 1000:.1f} ms per PreToolUse call")

    def test_powershell_and_cmd_directory_changes(self) -> None:
        self.assert_denied([
            f"Set-Location -Path '{self.outside}'; npm install jscpd",
            f"Set-Location -LiteralPath:'{self.outside}'; npm install jscpd",
            f"sl '{self.outside}'; pip install ruff", "cd ..; npm install jscpd",
            "Push-Location ..; npm install jscpd; Pop-Location", "(cd ..); npm install jscpd",
            "Set-Location; npm install jscpd"], tool="PowerShell")
        self.assert_allowed(["Push-Location ..; Pop-Location; npm install jscpd"],
                            tool="PowerShell")
        self.assert_allowed([f"Set-Location '{self.repo}'; npm install --save-dev jscpd"],
                            tool="PowerShell", cwd=self.outside)
        self.assert_denied([f"cmd /c \"cd /d {self.outside} && npm i jscpd\""])
        self.assert_allowed([f"cmd /c \"cd /d {self.repo} && npm i -D jscpd\""],
                            cwd=self.outside)

    @unittest.skipUnless(os.name == "nt", "Windows path spellings")
    def test_windows_paths(self) -> None:
        repo, outside = str(self.repo), str(self.outside)
        self.assertIn("\\", repo)
        # Hook input cwd in Windows form, with a trailing backslash and in another case.
        self.assert_denied(["npm install jscpd"], cwd=outside + "\\")
        self.assert_allowed(["npm install --save-dev jscpd"], cwd=repo.upper())
        self.assert_allowed(["npm install --save-dev jscpd"], cwd=repo.lower() + "\\")
        self.assert_denied([f"cd {_msys(self.outside)} && npm i jscpd",
                            f"cd '{outside}' && npm i jscpd", f"cd {outside} && npm i jscpd",
                            "cd /tmp && npm i jscpd", "npm.cmd install -g jscpd",
                            "pip.exe install --user ruff", "py -m pip install --user ruff",
                            f"npm install --prefix '{outside}\\tools' jscpd",
                            "cargo install --root .harden\\bin x"])
        self.assert_allowed([f"cd {_msys(self.repo)} && npm i -D jscpd",
                             f"cd '{repo.upper()}' && npm i -D jscpd"], cwd=self.outside)
        self.assert_allowed([f"npm install --prefix '{repo}\\.harden\\tools' jscpd",
                             "cargo install --root .HARDEN\\TOOLS x",
                             f"pip install --target {_msys(self.repo)}/.harden/tools/py ruff"])
        self.assert_denied([f"Set-Location {outside}; npm install jscpd",
                            "cargo install --root $env:USERPROFILE\\.cargo ripgrep",
                            "cd $env:USERPROFILE; npm install jscpd",
                            "cd $HOME; npm install jscpd", "npm.cmd i -g jscpd",
                            "python -m pip install --user ruff"], tool="PowerShell")
        self.assert_allowed([f"npm install --prefix {repo}\\.harden\\tools jscpd",
                             f"cargo install --root {repo}\\.harden\\tools cargo-machete",
                             f"cd {repo}\\src; npm install -D jscpd"], tool="PowerShell")


class FreshCloneInstallTests(HookTestCase):
    """PF-10 installs the locked dependencies in a scratch clone outside the repository; a
    clone or worktree of the run's repository is in scope, any other directory is not."""

    def setUp(self) -> None:
        super().setUp()
        self.scratch = Path(tempfile.mkdtemp(prefix="harden-scratch-"))
        self.clone = self.scratch / "harden-fresh"
        _git(self.repo, "clone", "-q", "--no-local", ".", str(self.clone))

    def tearDown(self) -> None:
        _rmtree(str(self.scratch))
        super().tearDown()

    def call(self, cwd: Path, command: str, tool: str = "Bash") -> Tuple[int, str]:
        payload = {"session_id": "s1", "cwd": str(cwd), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": tool,
                   "tool_input": {"command": command}}
        code, _, err = self.run_hook(payload)
        return code, err

    def test_installs_in_the_scratch_clone_are_allowed(self) -> None:
        for cwd, command in (
                (self.repo, f"cd \"{self.clone}\" && npm ci --ignore-scripts"),
                (self.repo, f"cd '{self.clone}' && pnpm add -D @vitest/coverage-v8"),
                (self.clone, "pnpm install --frozen-lockfile"),
                (self.clone, "npm ci"),
                (self.repo, f"npm install --prefix '{self.clone}' jscpd")):
            with self.subTest(command=command):
                code, err = self.call(cwd, command)
                self.assertEqual(code, 0, f"{command}: {err}")
        self.assertEqual(self.call(self.clone, "npm ci", tool="PowerShell")[0], 0)

    def test_global_forms_stay_denied_in_the_clone(self) -> None:
        for command in ("npm install -g jscpd", "pip install --user ruff", "cargo install x"):
            with self.subTest(command=command):
                code, err = self.call(self.clone, command)
                self.assertEqual(code, 2, command)
                self.assertIn("[reason_code: pkg-outside-repo]", err)

    def test_other_repositories_are_not_in_scope(self) -> None:
        other = self.scratch / "other"
        other.mkdir()
        _git(other, "init", "-q")
        _write(other, "package.json", "{}\n")
        self.assertEqual(self.call(other, "npm install jscpd")[0], 2)
        # A clone whose origin is a network remote or another path is not the scratch clone.
        _git(self.clone, "remote", "set-url", "origin", "https://example.invalid/repo.git")
        self.assertEqual(self.call(self.clone, "npm ci")[0], 2)
        _git(self.clone, "remote", "set-url", "origin", str(other))
        self.assertEqual(self.call(self.clone, "npm ci")[0], 2)

    def test_file_url_origin_and_worktrees_are_recognised(self) -> None:
        text = str(self.repo).replace("\\", "/")
        url = "file://" + ("/" + text if re.match(r"^[A-Za-z]:/", text) else text)
        _git(self.clone, "remote", "set-url", "origin", url)
        self.assertEqual(self.call(self.clone, "npm ci")[0], 0)
        worktree = self.scratch / "wt"
        _git(self.repo, "worktree", "add", "-q", str(worktree))
        self.assertEqual(self.call(worktree, "npm install --save-dev jscpd")[0], 0)
        self.assertEqual(self.call(worktree, "npm install -g jscpd")[0], 2)


def _short_path(path: Path) -> Optional[str]:
    """Windows 8.3 short spelling of an existing path, or None when it has none."""
    if os.name != "nt":
        return None
    import ctypes
    buf = ctypes.create_unicode_buffer(1024)
    size = ctypes.windll.kernel32.GetShortPathNameW(str(path), buf, len(buf))
    return buf.value if size and buf.value.lower() != str(path).lower() else None


class ScratchDirInstallTests(HookTestCase):
    """D-S (eval-v2-calibration E02-F08): .harden/active records the run's scratch_dir, one
    directory outside the repository. Clones and worktrees of the run's repository under it
    are install locations; a clone or worktree elsewhere (a sibling directory, or nested
    inside the repository), the scratch_dir itself and unrelated directories are not."""

    def setUp(self) -> None:
        super().setUp()
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-sd-"))
        (self.tmp / "harden-scratch-test").mkdir()
        self.scratch = Path(os.path.realpath(self.tmp / "harden-scratch-test"))
        self.write_active(scratch_dir=self.scratch.as_posix())
        self.clone = self.scratch / "harden-fresh"
        _git(self.repo, "clone", "-q", "--no-local", ".", str(self.clone))
        self.worktree = self.scratch / "harden-base"
        _git(self.repo, "worktree", "add", "-q", "--detach", str(self.worktree), self.base)

    def tearDown(self) -> None:
        _rmtree(str(self.tmp))
        super().tearDown()

    def call(self, cwd: Any, command: str, tool: str = "Bash") -> Tuple[int, str]:
        payload = {"session_id": "s1", "cwd": str(cwd), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": tool,
                   "tool_input": {"command": command}}
        code, _, err = self.run_hook(payload)
        return code, err

    def assert_allowed(self, cases: List[Tuple[Any, str]], tool: str = "Bash") -> None:
        for cwd, command in cases:
            with self.subTest(cwd=str(cwd), command=command, tool=tool):
                code, err = self.call(cwd, command, tool)
                self.assertEqual(code, 0, f"blocked: {command}: {err}")

    def assert_refused(self, cases: List[Tuple[Any, str]], *texts: str) -> None:
        for cwd, command in cases:
            with self.subTest(cwd=str(cwd), command=command):
                code, err = self.call(cwd, command)
                self.assertEqual(code, 2, f"not blocked: {command}")
                self.assertIn("[reason_code: pkg-outside-repo]", err)
                for text in texts:
                    self.assertIn(text, err)

    def test_clones_and_worktrees_into_the_scratch_dir_are_not_refused(self) -> None:
        scratch = self.scratch
        self.assert_allowed([
            (self.repo, f'git clone --no-local . "{scratch.as_posix()}/harden-final"'),
            (self.repo, f"git clone --no-local --branch main . '{scratch}/harden-final'"),
            (self.repo, f'git worktree add --detach "{scratch}/harden-mut" {self.base}'),
            (self.repo, f'git -C "{self.repo}" worktree add "{scratch}/harden-pre" HEAD'),
            (self.repo, f'cd "{scratch}" && git clone --no-local "{self.repo}" harden-final'),
            (self.clone, "git status --porcelain")])
        self.assert_allowed([
            (self.repo, f"git clone --no-local . '{scratch}{os.sep}harden-final'"),
            (self.repo, f"git worktree add --detach '{scratch}{os.sep}harden-mut' HEAD")],
            tool="PowerShell")

    def test_unresolved_directory_refusal_names_a_literal_path_and_gates_repo(self) -> None:
        # Second pilot, 12:20:11Z: `cd` to a variable, then an install (pilot-auto-calibration
        # A01-F38). The refusal names the ways that work.
        self.assert_refused([(self.repo, f'X="{self.clone}"; cd "$X" && pnpm install '
                                         "--frozen-lockfile --offline")],
                            "write the directory as a literal path", "gates.py\" --repo",
                            "--only <install gate>", "profile-install.config.json")

    def test_cmd_cd_d_literal_path_is_resolved_and_substitution_is_not(self) -> None:
        win = str(self.clone).replace("/", "\\")
        self.assert_allowed([(self.repo, f'cmd //c "cd /d {win} && pnpm install '
                                         '--frozen-lockfile --offline"')])
        self.assert_refused([(self.repo, f'cmd //c "cd /d $(cygpath -w {self.clone}) && '
                                         'pnpm install --frozen-lockfile --offline"')],
                            "cannot resolve")

    def test_installs_in_scratch_clones_and_worktrees_are_allowed(self) -> None:
        self.assert_allowed([
            (self.clone, "npm ci --ignore-scripts"), (self.clone, "pnpm install --frozen-lockfile"),
            (self.clone, "pip install -r requirements.txt"),
            (self.worktree, "npm install --save-dev @stryker-mutator/core@9.0.1"),
            (self.repo, f'cd "{self.clone}" && npm ci'),
            (self.repo, f"npm install --prefix '{self.clone}' jscpd"),
            (self.repo, f"pip install --target '{self.worktree}/.harden-lib' ruff"),
            (self.repo, "npm install --prefix .harden/tools jscpd"),
            (self.repo, "npm install --save-dev jscpd")])
        self.assert_allowed([(self.repo, f"Set-Location '{self.clone}'; npm ci"),
                             (self.worktree, "npm ci")], tool="PowerShell")

    def test_scratch_dir_itself_and_unrelated_directories_are_refused(self) -> None:
        unrelated = self.tmp / "unrelated"
        _write(unrelated, "package.json", "{}\n")
        self.assert_refused([
            (self.scratch, "npm install jscpd"),
            (self.repo, f'cd "{self.scratch}" && pip install ruff'),
            (self.repo, f"pip install --target '{self.scratch}/tools' ruff"),
            (unrelated, "npm install jscpd"),
            (self.repo, f'cd "{unrelated}" && npm i jscpd'),
            (self.repo, f"npm install --prefix '{unrelated}' jscpd")],
            # The advice names the run's scratch_dir.
            f"under the run's scratch_dir {self.scratch.as_posix()}")
        # Global forms stay refused inside a scratch clone.
        self.assert_refused([(self.clone, "npm install -g jscpd"),
                             (self.worktree, "pip install --user ruff")])

    def test_clones_and_worktrees_outside_the_scratch_dir_are_refused(self) -> None:
        # The E02-F08 run put its scratch clones and a mutation-tool install in a sibling
        # directory of the run directory.
        sibling = self.tmp / "sibling-clone"
        _git(self.repo, "clone", "-q", "--no-local", ".", str(sibling))
        sibling_worktree = self.tmp / "sibling-worktree"
        _git(self.repo, "worktree", "add", "-q", "--detach", str(sibling_worktree), self.base)
        self.assert_refused([
            (sibling, "npm ci"), (sibling_worktree, "npm install -D @stryker-mutator/core"),
            (self.repo, f"cd '{sibling}' && npm ci"),
            (self.repo, f"npm install --prefix '{sibling}' jscpd")],
            "outside the run's scratch_dir", "E02-F08")
        # A marker without scratch_dir (a run started before it existed) accepts any clone.
        self.write_active()
        self.assert_allowed([(sibling, "npm ci"), (sibling_worktree, "npm ci")])

    def test_clones_nested_inside_the_repository_are_refused(self) -> None:
        nested = self.repo / ".harden" / "scratch" / "harden-fresh"
        _git(self.repo, "clone", "-q", "--no-local", ".", str(nested))
        self.assert_refused([
            (nested, "npm ci"), (self.repo, "cd .harden/scratch/harden-fresh && npm ci"),
            (self.repo, "npm install --prefix .harden/scratch/harden-fresh jscpd")],
            "nested inside it", self.scratch.as_posix())
        self.assert_allowed([(self.repo, "npm install --prefix .harden/tools jscpd"),
                             (self.repo, "cd src && npm install -D jscpd")])
        # Runs started before scratch_dir existed kept their clones in .harden/scratch/.
        self.write_active()
        self.assert_allowed([(nested, "npm ci")])

    def test_a_manifest_above_the_scratch_clone_is_refused(self) -> None:
        # npm edits the nearest package.json above a clone that has none: with the temp
        # directory under the home directory, that is ~/package.json (E01-F10, E02-F08).
        home = self.tmp / "home"
        _write(home, "package.json", "{}\n")
        scratch = home / "AppData" / "Local" / "Temp" / "harden-scratch-abc"
        scratch.mkdir(parents=True)
        self.write_active(scratch_dir=Path(os.path.realpath(scratch)).as_posix())
        clone = scratch / "harden-fresh"
        _git(self.repo, "clone", "-q", "--no-local", ".", str(clone))
        self.assert_allowed([(clone, "npm install jscpd")])
        (clone / "package.json").unlink()
        self.assert_refused([(clone, "npm install jscpd"),
                             (self.repo, f'cd "{clone}" && npm i jscpd')],
                            "nearest directory holding")

    @unittest.skipUnless(os.name == "nt", "Windows path spellings")
    def test_windows_spellings_of_scratch_paths(self) -> None:
        clone = str(self.clone)
        self.assertIn("\\", clone)
        short = _short_path(self.clone)
        spellings = [clone, clone.upper(), clone.lower() + "\\"] + ([short] if short else [])
        for spelling in spellings:
            self.assert_allowed([(spelling, "npm ci"),
                                 (self.repo, f'cd "{spelling}" && npm ci'),
                                 (self.repo, f"npm install --prefix '{spelling}' jscpd")])
            self.assert_allowed([(self.repo, f"Set-Location '{spelling}'; npm ci")],
                                tool="PowerShell")
        self.assert_allowed([(self.repo, f"cd {_msys(self.clone)} && npm ci")])
        self.assert_refused([(self.repo, f"cd {_msys(self.scratch)} && npm i jscpd")])
        # The marker's scratch_dir in backslash, lower-case and 8.3 spellings.
        sibling = self.tmp / "sibling-clone"
        _git(self.repo, "clone", "-q", "--no-local", ".", str(sibling))
        recorded = [str(self.scratch), str(self.scratch).lower() + "\\",
                    _short_path(self.scratch)]
        for value in [r for r in recorded if r]:
            with self.subTest(scratch_dir=value):
                self.write_active(scratch_dir=value)
                self.assert_allowed([(self.clone, "npm ci"), (self.worktree, "npm ci")])
                self.assert_refused([(self.scratch, "npm install jscpd"), (sibling, "npm ci")])


class ManifestWalkTests(unittest.TestCase):
    """A repository without its own manifest: the tool would edit the one above it."""

    def setUp(self) -> None:
        self.outer = Path(tempfile.mkdtemp(prefix="harden-walk-"))
        for name in ("package.json", "pyproject.toml", "Cargo.toml"):
            _write(self.outer, name, "{}\n")
        (self.outer / ".venv").mkdir()
        self.repo = self.outer / "proj"
        self.repo.mkdir()
        _git(self.repo, "init", "-q")
        _write(self.repo, "src/app.py", "x = 1\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "base")
        base = _git(self.repo, "rev-parse", "HEAD").strip()
        (self.repo / ".harden").mkdir()
        (self.repo / ".harden" / "active").write_text(json.dumps(
            {"base_sha": base, "mode": "apply", "started": "2026-09-24T00:00:00Z"}),
            encoding="utf-8")

    def tearDown(self) -> None:
        _rmtree(str(self.outer))

    def call(self, command: str, tool: str = "Bash") -> Tuple[int, str]:
        payload = {"session_id": "s1", "cwd": str(self.repo), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": tool,
                   "tool_input": {"command": command}}
        err = io.StringIO()
        code = hg.run(json.dumps(payload), {"CLAUDE_PROJECT_DIR": str(self.repo)},
                      io.StringIO(), err)
        return code, err.getvalue()

    WALKING = ["npm install jscpd", "npm i -D jscpd", "pnpm add jscpd", "yarn add jscpd",
               "bun add jscpd", "uv add ruff", "poetry add ruff", "cargo add serde",
               "uv pip install ruff", "cd .harden && npm install jscpd",
               "pnpm --dir .harden add jscpd"]

    def test_nearest_manifest_above_the_repository_is_denied(self) -> None:
        # The eval-v1 incident: npm walks up to the first directory with package.json or
        # node_modules, so an install in a repository without one edits the parent's.
        for command in self.WALKING:
            with self.subTest(command=command):
                code, err = self.call(command)
                self.assertEqual(code, 2, command)
                self.assertIn("[reason_code: pkg-outside-repo]", err)
                self.assertIn("nearest directory holding", err)

    def test_explicit_targets_and_ephemeral_runners_are_allowed(self) -> None:
        for command in ("npm install --prefix .harden/tools jscpd", "npx jscpd .",
                        "pip install ruff", "uv pip install --target .harden/tools/py ruff",
                        "cargo add --manifest-path crates/a/Cargo.toml serde",
                        "cargo install --root .harden/tools x", "uvx ruff check ."):
            with self.subTest(command=command):
                self.assertEqual(self.call(command)[0], 0, command)

    def test_the_repository_manifest_stops_the_walk(self) -> None:
        for name in ("package.json", "pyproject.toml", "Cargo.toml"):
            _write(self.repo, name, "{}\n")
        (self.repo / ".venv").mkdir()
        for command in self.WALKING:
            with self.subTest(command=command):
                self.assertEqual(self.call(command)[0], 0, command)

    def test_node_modules_counts_for_npm_only(self) -> None:
        (self.outer / "package.json").unlink()
        (self.outer / "node_modules").mkdir()
        _write(self.repo, "package.json", "{}\n")
        self.assertEqual(self.call("npm install jscpd")[0], 0)
        (self.repo / "package.json").unlink()
        self.assertEqual(self.call("npm install jscpd")[0], 2)

    def test_nearest_with_helper(self) -> None:
        start = hg.normalize_path(str(self.repo / "src"))
        found = hg._nearest_with(start, ("pyproject.toml",))
        self.assertIsNotNone(found)
        self.assertEqual(os.path.realpath(str(found)), os.path.realpath(str(self.outer)))
        self.assertIsNone(hg._nearest_with(start, ("harden-no-such-manifest.e01f10",)))


class TempOutsideRunTests(HookTestCase):
    """temp-outside-run (protocol-preflight PF-21; eval-v3-calibration E03-F06): with a
    scratch_dir recorded, writes under the OS temp directory outside the scratch_dir and the
    repository are refused. The repository itself lies under the temp directory here, as it
    does in the evaluation harness."""

    def setUp(self) -> None:
        super().setUp()
        self.scratch = Path(os.path.realpath(tempfile.mkdtemp(prefix="harden-scratch-")))
        (self.scratch / "tmp").mkdir()
        self.write_active(scratch_dir=self.scratch.as_posix())
        self.outside = Path(os.path.realpath(tempfile.gettempdir())) / "harden-t-outside"

    def tearDown(self) -> None:
        _rmtree(str(self.scratch))
        super().tearDown()

    def refused(self, command: str) -> None:
        code, _, err = self.pre("Bash", {"command": command})
        self.assertEqual(code, 2, f"not blocked: {command}")
        self.assertIn("[reason_code: temp-outside-run]", err)
        self.assertIn("scratch_dir", err)

    def allowed(self, command: str) -> None:
        code, _, err = self.pre("Bash", {"command": command})
        self.assertEqual(code, 0, f"blocked: {command}: {err}")

    def test_redirections_tee_and_cp_to_temp_outside_scratch_are_refused(self) -> None:
        target = (self.outside / "f").as_posix()
        for command in (f'echo x > "{target}"', f'echo x | tee "{target}"',
                        f'cp src/app.py "{target}"', f'echo x >> "{target}"'):
            with self.subTest(command=command):
                self.refused(command)
        if os.name == "nt":
            self.refused("echo x > /tmp/f")

    def test_write_tool_to_temp_outside_scratch_is_refused(self) -> None:
        code, _, err = self.pre("Write", {"file_path": str(self.outside / "note.txt"),
                                          "content": "x"})
        self.assertEqual(code, 2)
        self.assertIn("[reason_code: temp-outside-run]", err)

    def test_writes_in_scratch_dir_and_repository_are_allowed(self) -> None:
        self.allowed("echo x > .harden/tools/a")
        self.allowed(f'echo x > "{(self.scratch / "tmp" / "a").as_posix()}"')
        self.allowed("echo x > src/new_file.py")
        code, _, _ = self.pre("Write", {"file_path": str(self.scratch / "tmp" / "b.txt"),
                                        "content": "x"})
        self.assertEqual(code, 0)

    def test_rule_off_without_scratch_dir(self) -> None:
        self.write_active()
        self.allowed(f'echo x > "{(self.outside / "f").as_posix()}"')

    def test_dev_null_and_nul_are_not_temp_writes(self) -> None:
        self.allowed("echo x > /dev/null")
        self.allowed("echo x 2>/dev/null")
        self.allowed("echo x > nul")

    def test_reason_code_is_registered(self) -> None:
        self.assertIn("temp-outside-run", hg.REASON_CODES)
        self.assertIn("temp-outside-run", hg.__doc__)

    def test_tool_env_sourced_temp_variables_are_allowed(self) -> None:
        self.allowed('. .harden/tool-env.sh && echo x > "$TMPDIR/f"')
        self.allowed('source .harden/tool-env.sh; sort data.txt > "${TEMP}/sorted.txt"')
        if os.environ.get("TEMP") and os.path.isabs(os.environ["TEMP"]):
            self.refused('echo x > "$TEMP/harden-t-outside/f"')

    def test_tool_env_install_forms_are_allowed(self) -> None:
        self.allowed('. .harden/tool-env.sh && CARGO_HOME="$HARDEN_CARGO_HOME" cargo install '
                     '--locked --root .harden/tools/tokei --target-dir '
                     '"$HARDEN_CARGO_TARGET_ROOT/tokei" tokei@13.0.0')
        self.allowed('. .harden/tool-env.sh && UV_CACHE_DIR="$HARDEN_UV_CACHE_DIR" uvx '
                     'lizard@1.24.0 --csv -f .harden/tools/inscope.lizard.txt > '
                     '.harden/tools/lizard.csv')



class StrengthenEditTests(HookTestCase):
    """Existing test files may only gain checked additions (protocol-change PC-06; U01-F07)."""

    OLD = "def test_add():\n    assert 1 + 2 == 3\n"
    JS = "import { it, expect } from 'vitest';\n\nit('a', () => {\n  expect(1).toBe(1);\n});\n"

    def target(self, rel: str = "tests/test_app.py") -> str:
        return str(self.repo / rel)

    def edit(self, old: str, new: str, rel: str = "tests/test_app.py", **extra: Any
             ) -> Tuple[int, str, str]:
        data = {"file_path": self.target(rel), "old_string": old, "new_string": new}
        data.update(extra)
        return self.pre("Edit", data)

    def write(self, content: str, rel: str = "tests/test_app.py") -> Tuple[int, str, str]:
        return self.pre("Write", {"file_path": self.target(rel), "content": content})

    def commit_and_move_base(self, files: Dict[str, str]) -> None:
        for rel, text in files.items():
            target = self.repo / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with open(target, "w", encoding="utf-8", newline="") as handle:
                handle.write(text)
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "more tests")
        self.base = _git(self.repo, "rev-parse", "HEAD").strip()
        self.write_active()

    def test_edit_appending_at_the_tail_is_allowed(self) -> None:
        self.assertEqual(self.edit("    assert 1 + 2 == 3\n",
                                   "    assert 1 + 2 == 3\n    assert 2 + 2 == 4\n"), (0, "", ""))

    def test_write_with_a_new_test_at_eof_is_allowed(self) -> None:
        self.assertEqual(self.write(self.OLD + "\n\ndef test_more():\n    assert 3 == 3\n")[0], 0)

    def test_insertion_before_an_existing_assertion_is_refused(self) -> None:
        code, _out, err = self.write("def test_add():\n    assert 0 == 0\n    assert 1 + 2 == 3\n")
        self.assertEqual(code, 2)
        for needle in ("[test-edit: not-at-tail]", "[reason_code: edit-test]", "read-only",
                       hg.ADDITIONS_NOTE[:40]):
            self.assertIn(needle, err)

    def test_modified_assertion_is_refused(self) -> None:
        code, _out, err = self.edit("3", "4")
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: removed-line]", err)

    def test_removed_line_is_refused(self) -> None:
        code, _out, err = self.write("def test_add():\n    pass\n")
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: removed-line]", err)

    def test_added_skip_markers_are_refused(self) -> None:
        code, _out, err = self.write(self.OLD + "\n\n@pytest.mark.skip\ndef test_later():\n"
                                                "    assert 1\n")
        self.assertEqual(code, 2)
        self.assertIn("skip-marker", err)
        self.commit_and_move_base({"tests/a.test.ts": self.JS,
                                   "tests/it.rs": "#[test]\nfn adds() {\n    assert!(true);\n}\n"})
        cases = [("tests/a.test.ts", self.JS + "\nit.skip('b', () => {});\n"),
                 ("tests/a.test.ts", self.JS + "\ntest.only('b', () => {});\n"),
                 ("tests/it.rs", "#[test]\nfn adds() {\n    assert!(true);\n}\n"
                                 "\n#[test]\n#[ignore]\nfn later() {}\n")]
        for rel, content in cases:
            with self.subTest(content=content[-30:]):
                code, _out, err = self.write(content, rel)
                self.assertEqual(code, 2)
                self.assertIn("skip-marker", err)

    def test_wrapping_an_existing_assertion_in_if_false_is_refused(self) -> None:
        self.commit_and_move_base({"tests/a.test.ts": self.JS})
        code, _out, err = self.write(self.JS.replace(
            "  expect(1).toBe(1);\n", "  if (false) {\n  expect(1).toBe(1);\n  }\n"),
            "tests/a.test.ts")
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: unbalanced-run]", err)

    def test_crlf_file_append_is_allowed(self) -> None:
        self.commit_and_move_base({"tests/test_crlf.py": "def test_c():\r\n    assert 1\r\n"})
        self.assertEqual(self.edit("    assert 1\n", "    assert 1\n    assert 2\n",
                                   "tests/test_crlf.py")[0], 0)
        code, _out, err = self.write("def test_c():\n    assert 1\n    assert 2\n",
                                     "tests/test_crlf.py")
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: eol-changed]", err)

    def test_rename_of_an_existing_test_is_refused(self) -> None:
        self.assertEqual(self.bash("git mv tests/test_app.py tests/test_app2.py"), 2)
        self.assertEqual(self.bash("mv tests/test_app.py tests/moved.py"), 2)
        self.assertEqual(read_events(self.repo)[-1]["reason_code"], "delete-test")

    def test_new_test_file_behaviour_unchanged(self) -> None:
        self.assertEqual(self.write("def test_new():\n    assert 1\n", "tests/test_new.py")[0], 0)
        _write(self.repo, "tests/test_new.py", "def test_new():\n    assert 1\n")
        self.assertEqual(self.pre("Edit", {"file_path": self.target("tests/test_new.py")})[0], 0)

    def test_notebook_edit_on_an_existing_test_is_refused(self) -> None:
        code, _out, err = self.pre("NotebookEdit", {"notebook_path": self.target("tests/nb.ipynb")})
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: notebook]", err)

    def test_edit_without_payload_is_refused_as_unverifiable(self) -> None:
        code, _out, err = self.pre("Edit", {"file_path": self.target()})
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: unverifiable]", err)

    def test_shell_writes_to_an_existing_test_stay_refused(self) -> None:
        self.assertEqual(self.bash("echo x >> tests/test_app.py"), 2)
        self.assertEqual(self.bash("sed -i 's/3/3/' tests/test_app.py"), 2)
        self.assertEqual(read_events(self.repo)[-1]["reason_code"], "write-test")

    def test_snapshot_under_tests_stays_read_only(self) -> None:
        self.commit_and_move_base({"tests/__snapshots__/a.test.ts.snap": "exports[`a`] = 1;\n"})
        code, _out, err = self.edit("exports[`a`] = 1;\n", "exports[`a`] = 1;\nexports[`b`] = 2;\n",
                                    "tests/__snapshots__/a.test.ts.snap")
        self.assertEqual(code, 2)
        self.assertIn("read-only", err)
        self.assertNotIn("[test-edit:", err)

    def test_reference_is_head_so_own_uncommitted_addition_can_be_fixed(self) -> None:
        first = self.OLD + "    assert 2 == 2\n"
        self.assertEqual(self.edit("    assert 1 + 2 == 3\n",
                                   "    assert 1 + 2 == 3\n    assert 2 == 2\n")[0], 0)
        _write(self.repo, "tests/test_app.py", first)
        self.assertEqual(self.edit("assert 2 == 2", "assert 2 + 0 == 2")[0], 0)
        _write(self.repo, "tests/test_app.py", first.replace("assert 2 == 2", "assert 2 + 0 == 2"))
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-q", "-m", "strengthen")
        code, _out, err = self.edit("assert 2 + 0 == 2", "assert 2 == 2")
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: removed-line]", err)

    def test_autonomous_refusal_asks_nobody(self) -> None:
        self.write_active(mode="auto")
        _code, _out, err = self.edit("3", "4")
        self.assertIn("owner item in .harden/progress.md and the report", err)
        self.assertNotIn("the user", err)

    def test_multiedit_edits_are_reproduced_in_order(self) -> None:
        ok = self.pre("MultiEdit", {"file_path": self.target(), "edits": [
            {"old_string": "== 3\n", "new_string": "== 3\n    assert 2 == 2\n"},
            {"old_string": "    assert 2 == 2\n", "new_string": "    assert 2 == 2\n    assert 3\n"}]})
        self.assertEqual(ok[0], 0)
        code, _out, err = self.pre("MultiEdit", {"file_path": self.target(), "edits": [
            {"old_string": "nope", "new_string": "x"}]})
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: unverifiable]", err)

    def test_checker_unavailable_refuses_test_edits_only(self) -> None:
        with mock.patch.object(hg, "st", None):
            code, _out, err = self.edit("    assert 1 + 2 == 3\n",
                                        "    assert 1 + 2 == 3\n    assert 2 + 2 == 4\n")
            self.assertEqual(code, 2)
            self.assertIn("[test-edit: checker-unavailable]", err)
            self.assertEqual(self.pre("Edit", {"file_path": self.target("src/app.py"),
                                               "old_string": "a + b", "new_string": "b + a"})[0], 0)

    def test_checker_exception_refuses_the_edit(self) -> None:
        with mock.patch.object(hg.st, "check_additions", side_effect=RuntimeError("x")):
            code, _out, err = self.edit("    assert 1 + 2 == 3\n",
                                        "    assert 1 + 2 == 3\n    assert 2 + 2 == 4\n")
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: checker-error]", err)
        self.assertIn("[reason_code: edit-test]", err)
        log = self.repo / ".harden" / hg.ERROR_LOG_NAME
        self.assertTrue(log.exists() and log.read_text(encoding="utf-8").strip())

    def test_budget_overrun_is_refused(self) -> None:
        with mock.patch.object(hg, "HOOK_CHECK_BUDGET_S", -1.0):
            code, _out, err = self.edit("    assert 1 + 2 == 3\n",
                                        "    assert 1 + 2 == 3\n    assert 2 + 2 == 4\n")
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: unverifiable]", err)

    def test_refusal_names_the_new_file_fallback(self) -> None:
        _code, _out, err = self.write("def test_add():\n    pass\n")
        self.assertIn("new test file next to it", err)

    def test_live_access_line_is_refused(self) -> None:
        code, _out, err = self.edit("    assert 1 + 2 == 3\n",
                                    "    assert 1 + 2 == 3\n    assert os.environ['PRIVATE_KEY']\n")
        self.assertEqual(code, 2)
        self.assertIn("[test-edit: env-or-live-access]", err)
        log = (self.repo / ".harden" / "hook_events.log").read_text(encoding="utf-8")
        self.assertNotIn("PRIVATE_KEY", log)


class CdTrackingTests(HookTestCase):
    """Relative write and delete targets after a literal cd (pilot-auto-calibration A01-F31):
    resolved where the shell runs, and in every directory it may still be in when a cd may
    have failed."""

    def refused(self, command: str, code: str) -> None:
        with self.subTest(command=command):
            status, _, err = self.pre("Bash", {"command": command})
            self.assertEqual(status, 2, "not blocked: " + command)
            self.assertIn("[reason_code: {}]".format(code), err)

    def test_cd_then_delete_or_write_of_a_test_is_refused(self) -> None:
        self.refused("cd tests && rm test_app.py", "delete-test")
        self.refused("cd tests && echo x > test_app.py", "write-test")
        self.refused("cd src && echo x > ../tests/test_app.py", "write-test")
        self.assertTrue((self.repo / "tests" / "test_app.py").exists())

    def test_failed_cd_then_semicolon_still_checks_the_session_directory(self) -> None:
        self.refused("cd nowhere; echo x > tests/test_app.py", "write-test")
        self.refused("cd nowhere && true; echo x > tests/test_app.py", "write-test")
        self.refused("cd nowhere || true; rm tests/test_app.py", "delete-test")

    def test_semicolon_cd_into_tests_is_refused(self) -> None:
        self.refused("cd tests; rm test_app.py", "delete-test")
        self.refused("cd src; cd ../tests; rm test_app.py", "delete-test")

    def test_writes_under_harden_after_cd_stay_allowed(self) -> None:
        self.assertEqual(self.bash("cd src && echo x > ../.harden/tools/x.log"), 0)
        self.assertEqual(self.bash("cd tests && cat test_app.py > ../.harden/tools/copy.txt"), 0)

    def test_scratch_worktree_test_edit_after_cd_is_allowed(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="harden-cd-"))
        try:
            scratch = Path(os.path.realpath(tmp))
            self.write_active(scratch_dir=scratch.as_posix())
            worktree = scratch / "wt"
            _git(self.repo, "worktree", "add", "-q", "--detach", str(worktree), self.base)
            for command in ('cd "{}" && sed -i s/a/b/ tests/test_app.py'.format(
                                worktree.as_posix()),
                            'cd "{}" && echo x >> tests/test_app.py'.format(worktree.as_posix())):
                with self.subTest(command=command):
                    status, _, err = self.pre("Bash", {"command": command})
                    self.assertEqual(status, 0, err)
            self.refused('cd "{}"; echo x >> tests/test_app.py'.format(worktree.as_posix()),
                         "write-test")
        finally:
            _git(self.repo, "worktree", "remove", "--force", str(tmp / "wt"))
            _rmtree(str(tmp))


class PassRecordTests(HookTestCase):
    """Pass and verifier records are run evidence; a subagent's hook payload never becomes
    the main thread's session (pilot-auto-calibration A01-F42, A01-F45; round 3)."""

    def test_pass_and_verifier_records_are_refused(self) -> None:
        for tool, tool_input in (
                ("Write", {"file_path": ".harden/passes/x.md", "content": "x"}),
                ("Write", {"file_path": str(self.repo / ".harden" / "verifiers" / "V1.meta.json"),
                           "content": "{}"}),
                ("Edit", {"file_path": ".harden/passes/se-u1-p1.reads.json"}),
                ("Bash", {"command": "echo x > .harden/passes/x.md"}),
                ("Bash", {"command": "cp forged.md .harden/verifiers/V1.md"})):
            with self.subTest(tool=tool, tool_input=tool_input):
                status, _, err = self.pre(tool, tool_input)
                self.assertEqual(status, 2)
                self.assertIn("[reason_code: run-evidence-write]", err)
                self.assertIn("persist_pass.py recover", err)

    def test_script_outputs_and_reads_stay_allowed(self) -> None:
        self.assertEqual(self.bash("python ledger.py gaps --lens security --out "
                                   ".harden/passes/x.gaps.json"), 0)
        self.assertEqual(self.bash("cat .harden/passes/x.md"), 0)
        self.assertEqual(self.pre("Write", {"file_path": ".harden/tools/notification-p1.md",
                                            "content": "x"})[0], 0)

    def test_a_subagent_denial_logs_its_agent(self) -> None:
        payload = {"session_id": "s1", "cwd": str(self.repo), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": "Bash", "agent_id": "a-7",
                   "agent_type": "harden-verifier",
                   "tool_input": {"command": "echo HARDEN_HOOK_CANARY"}}
        self.assertEqual(self.run_hook(payload)[0], 2)
        log = (self.repo / ".harden" / "hook_events.log").read_text(encoding="utf-8")
        last = json.loads(log.strip().split("\n")[-1])
        self.assertEqual((last["agent_id"], last["agent_type"]), ("a-7", "harden-verifier"))
        self.assertEqual(self.bash("echo HARDEN_HOOK_CANARY"), 2)
        last = json.loads((self.repo / ".harden" / "hook_events.log").read_text(
            encoding="utf-8").strip().split("\n")[-1])
        self.assertNotIn("agent_id", last)

    def test_subagent_payloads_do_not_set_the_main_session(self) -> None:
        sub = {"session_id": "sub", "cwd": str(self.repo), "permission_mode": "bypassPermissions",
               "hook_event_name": "PreToolUse", "tool_name": "Bash", "agent_id": "a-1",
               "agent_type": "harden-verifier", "tool_input": {"command": "git status"},
               "transcript_path": "C:/t/sub.jsonl"}
        self.assertEqual(self.run_hook(sub)[0], 0)
        session = json.loads((self.repo / ".harden" / "session.json").read_text(
            encoding="utf-8"))
        self.assertNotIn("permission_mode", session)
        self.assertNotIn("transcript_path", session)
        self.assertEqual(session.get("modes_seen"), ["bypassPermissions"])
        main = dict(sub, session_id="main", permission_mode="default",
                    transcript_path="C:/t/main.jsonl")
        main.pop("agent_id")
        main.pop("agent_type")
        self.assertEqual(self.run_hook(main)[0], 0)
        self.assertEqual(self.run_hook(sub)[0], 0)
        session = json.loads((self.repo / ".harden" / "session.json").read_text(
            encoding="utf-8"))
        self.assertEqual((session["permission_mode"], session["session_id"],
                          session["transcript_path"]), ("default", "main", "C:/t/main.jsonl"))


class SubagentRunControlTests(HookTestCase):
    """Safety review, round 3: the harden-verifier's Bash runs under this hook, and repository
    text it reads could ask it to switch the guard off. A subagent may not remove the marker or
    start, stop, switch or loosen the run; the orchestrator still may (logged)."""

    def sub(self, command: str, tool: str = "Bash") -> Tuple[int, str, str]:
        return self.run_hook({"session_id": "s1", "cwd": str(self.repo),
                              "permission_mode": "default", "hook_event_name": "PreToolUse",
                              "tool_name": tool, "agent_id": "v-9",
                              "agent_type": "harden-verifier",
                              "tool_input": {"command": command}})

    def test_subagent_run_control_is_refused(self) -> None:
        for command, tool in (("rm .harden/active", "Bash"), ("rm -r .harden", "Bash"),
                              ("mv .harden/active /tmp/x", "Bash"),
                              ("Remove-Item .harden/active", "PowerShell"),
                              ("python run_state.py stop", "Bash"),
                              ("python \"C:/s/harden/scripts/run_state.py\" stop --force", "Bash"),
                              ("python3 run_state.py set-mode auto --reason x", "Bash"),
                              ("python run_state.py allow-test-deletion tests/x.py --cases 1 "
                               "--reason y", "Bash"),
                              ("python run_state.py allow-config-edit tsconfig.json --reason z",
                               "Bash"),
                              ("python run_state.py start --mode auto", "Bash")):
            with self.subTest(command=command):
                self.write_active()
                status, _, err = self.sub(command, tool)
                self.assertEqual(status, 2, err)
                self.assertIn("[reason_code: subagent-run-control]", err)
                self.assertTrue((self.repo / ".harden" / "active").is_file())
                last = read_events(self.repo)[-1]
                self.assertEqual((last["reason_code"], last["agent_type"]),
                                 ("subagent-run-control", "harden-verifier"))

    def test_ordinary_subagent_commands_and_orchestrator_run_control_stay_allowed(self) -> None:
        for command in ("git status", "python run_state.py status --json",
                        "python -m pytest tests/test_app.py -q", "cat .harden/active"):
            with self.subTest(command=command):
                self.assertEqual(self.sub(command)[0], 0)
        self.assertEqual(self.bash("python run_state.py set-mode report-only --reason x"), 0)
        self.assertEqual(self.bash("python run_state.py stop"), 0)


# ---------------------------------------------------------------------------
# Round 4b: test globs, data text in forbidden checks, here-documents, links
# (pilot-auto-calibration A01-F53, A01-F54, A01-F56)
# ---------------------------------------------------------------------------

PILOT3_TESTS = ["**/*.test.ts", "**/tests/**", "*.test.ts", "tests/**"]
PILOT3_PROTECTED = ["**/*.test.ts", "**/tests/**", "*.test.ts", "eslint.config.mjs",
                    "pnpm-lock.yaml", "tests/**", "tsconfig.build.json", "tsconfig.json",
                    "vitest.config.ts"]
PILOT3_OLD = "    expect(result).toBeTruthy();\n  });"
PILOT3_NEW = ("    expect(result).toBeTruthy();\n"
              "    expect(result.fired.map((e) => e.ruleId)).toEqual(['btc-high']);\n"
              "    expect(result.delivered).toBe(2);\n"
              "    expect(seen.map((e) => e.ruleId)).toEqual(['btc-high', 'btc-high']);\n"
              "  });")
ENGINE_BASE = """import { describe, expect, it } from 'vitest';
import { AlertEngine, MemoryStateStore } from '../src/alerts/engine.js';
import type { Notifier } from '../src/plugins/loader.js';
import type { AlertEvent, AlertRule, Ticker } from '../src/types.js';

const T0 = Date.UTC(2026, 8, 1, 12);

function recorder(name: string, sink: AlertEvent[]): Notifier {
  return {
    name,
    async notify(event) {
      sink.push(event);
    },
  };
}

const btcAt = (last: number): Map<string, Ticker> =>
  new Map([['BTC', { symbol: 'BTC/USDT', base: 'BTC', quote: 'USDT', last, timestamp: T0 }]]);

const rules: AlertRule[] = [
  { id: 'btc-high', kind: 'above', asset: 'BTC', price: 70000, cooldownMinutes: 30 },
  { id: 'btc-low', kind: 'below', asset: 'BTC', price: 50000 },
];

describe('AlertEngine', () => {
  it('dispatches fired alerts to every notifier', async () => {
    const seen: AlertEvent[] = [];
    const engine = new AlertEngine({
      rules,
      notifiers: [recorder('a', seen), recorder('b', seen)],
      state: new MemoryStateStore(),
      now: () => T0,
    });

    const result = await engine.check(btcAt(71000));

    expect(result).toBeTruthy();
  });

  it('holds back a rule during its cooldown', async () => {
    let now = T0;
    const seen: AlertEvent[] = [];
    const engine = new AlertEngine({
      rules,
      notifiers: [recorder('a', seen)],
      state: new MemoryStateStore(),
      now: () => now,
    });

    await engine.check(btcAt(71000));
    now = T0 + 10 * 60_000;
    const second = await engine.check(btcAt(72000));
    now = T0 + 31 * 60_000;
    const third = await engine.check(btcAt(72000));

    expect(second.fired).toHaveLength(0);
    expect(second.suppressed).toEqual(['btc-high']);
    expect(third.fired.map((e) => e.ruleId)).toEqual(['btc-high']);
    expect(seen).toHaveLength(2);
  });

  it('does not fire when no condition holds', async () => {
    const engine = new AlertEngine({ rules, notifiers: [], state: new MemoryStateStore(), now: () => T0 });

    const result = await engine.check(btcAt(60000));

    expect(result.fired).toEqual([]);
    expect(result.delivered).toBe(0);
  });
});
"""


def _old_inventory_globs() -> Tuple[List[str], List[str]]:
    dg = hg.dg
    tests = dg.DEFAULT_TEST_GLOBS + [g for g in PILOT3_TESTS if g not in dg.DEFAULT_TEST_GLOBS]
    protected = dg.DEFAULT_PROTECTED_GLOBS + [g for g in PILOT3_PROTECTED
                                              if g not in dg.DEFAULT_PROTECTED_GLOBS]
    return tests, protected


class ProtectedTestGlobTests(HookTestCase):
    """pilot-auto-calibration A01-F53: a marker whose protected list holds the test globs (the
    old inventory's suggestion) no longer makes every existing test a gate configuration."""

    target = StrengthenEditTests.target
    edit = StrengthenEditTests.edit
    commit_and_move_base = StrengthenEditTests.commit_and_move_base

    def setUp(self) -> None:
        super().setUp()
        self.commit_and_move_base({
            "tests/engine.test.ts": ENGINE_BASE,
            "vitest.config.ts": "export default {};\n",
            "eslint.config.mjs": "export default [];\n",
            "tests/tsconfig.json": "{}\n",
            "tests/vitest.config.ts": "export default {};\n",
        })
        tests, protected = _old_inventory_globs()
        self.write_active(test_globs=tests, protected_globs=protected, mode="auto")

    def test_pilot3_tail_addition_is_allowed_under_a_marker_from_the_old_inventory(self) -> None:
        self.assertEqual(self.edit(PILOT3_OLD, PILOT3_NEW, "tests/engine.test.ts"), (0, "", ""))

    def test_pilot3_tail_addition_is_allowed_under_a_marker_from_the_fixed_inventory(
            self) -> None:
        tests, protected = _old_inventory_globs()
        protected = [g for g in protected if g not in PILOT3_TESTS]
        self.write_active(test_globs=tests, protected_globs=protected, mode="auto")
        self.assertEqual(self.edit(PILOT3_OLD, PILOT3_NEW, "tests/engine.test.ts"), (0, "", ""))

    def test_gate_configs_stay_read_only(self) -> None:
        for rel in ("vitest.config.ts", "eslint.config.mjs", "tsconfig.json"):
            with self.subTest(rel=rel):
                text = (self.repo / rel).read_text(encoding="utf-8")
                code, _out, err = self.edit(text, text + "// more\n", rel)
                self.assertEqual(code, 2, err)
                self.assertIn("[reason_code: edit-protected]", err)
        for rel in ("tests/tsconfig.json", "tests/vitest.config.ts"):
            with self.subTest(rel=rel):
                text = (self.repo / rel).read_text(encoding="utf-8")
                code, _out, err = self.edit(text, text + "// more\n", rel)
                self.assertEqual(code, 2, err)
                self.assertIn("gate or test-runner configuration", err)
                self.assertIn("[test-edit: not-strengthenable]", err)

    def test_changed_line_is_still_refused(self) -> None:
        code, _out, err = self.edit("    expect(result).toBeTruthy();",
                                    "    expect(result.fired).toHaveLength(1);",
                                    "tests/engine.test.ts")
        self.assertEqual(code, 2, err)
        self.assertIn("[test-edit: removed-line]", err)

    def test_a_protected_glob_outside_the_test_list_still_protects(self) -> None:
        self.write_active(test_globs=["spec/**"],
                          protected_globs=hg.dg.DEFAULT_PROTECTED_GLOBS + ["tests/**"])
        code, _out, err = self.edit(PILOT3_OLD, PILOT3_NEW, "tests/engine.test.ts")
        self.assertEqual(code, 2, err)
        self.assertIn("[reason_code: edit-protected]", err)

    def test_marker_from_the_old_inventory_is_listed_in_run_config(self) -> None:
        marker = json.loads((self.repo / ".harden" / "active").read_text(encoding="utf-8"))
        cfg = hg.dg.config_from_data(self.repo, marker, None)
        self.assertIsNone(cfg.config_protection("tests/engine.test.ts"))
        self.assertEqual(cfg.config_protection("tests/tsconfig.json"), "**/tsconfig.json")


PILOT3_BANS = [
    r"/\bgit\s+push\b/",
    r"/\b(npm|pnpm|yarn|bun|make)\s+(run\s+)?(deploy|publish|release|migrate|seed)\b/i",
    r"/\b(cargo|poetry|uv)\s+publish\b/i",
    r"/\btwine\s+upload\b/i",
    r"/\bnode\s+\S*cli\.(js|ts|mjs)\b.*\b(value|pnl|alerts|watch|snapshot)\b/",
    r"/\b(tsx|ts-node|vite-node)\s+\S*cli\.ts\b.*\b(value|pnl|alerts|watch|snapshot)\b/",
    r"/\bpnpm\s+(run\s+)?cli\b.*\b(value|pnl|alerts|watch|snapshot)\b/",
    r"/(^|[;&|]\s*)(npx\s+|pnpm\s+exec\s+)?pricewatch\s+(\S+\s+)*(value|pnl|alerts|watch|snapshot)\b/",
]
SCRIPTS_DIR = SCRIPTS.as_posix()
PILOT3_NOTE = (
    'cd "{repo}" && cat >> .harden/progress.md <<\'EOF\'\n'
    "- Phase 1 step 12 (PF-10): fresh clone in scratch_dir/harden-fresh; fresh-install PASS "
    "(pnpm install --frozen-lockfile via profile-install.config.json); fresh-clone gates: test "
    "38, test-shuffled 38, build, typecheck all PASS. No deviation.\n"
    "- Phase 1 PF-16 golden: profile e2e `node dist/cli.js --help` run twice (label "
    "golden-base), stdout 1105 bytes, stderr empty, base-vs-base diff identical (noise floor "
    "0); copies in .harden/tools/golden/. No other capture (autonomous: e2e checks only). Not "
    "run (forbidden, network): value, pnl, alerts, watch, snapshot subcommands.\n"
    "EOF\n"
    'python "{scripts}/run_state.py" phase 1 end && python "{scripts}/run_state.py" phase 2 '
    "start")
PILOT3_FACTS = (
    'cd "{repo}" && cat > .harden/facts8.py <<\'EOF\'\n'
    '"""Phase 8 facts for render_report.py."""\n'
    'lim.append("(j) End-to-end coverage: the profile\'s only e2e check (`node dist/cli.js '
    '--help`) loads the 3 changed modules but executes 0 of the 3 changed functions '
    '(e2e_reach.py)")\n'
    'subj = {"H-001": ("fix(alerts): store cooldown times as ISO 8601 UTC (H-001)",)}\n'
    "EOF\n")
PILOT3_FACTS_RUN = ("PYTHONIOENCODING=utf-8 python .harden/facts8.py && PYTHONIOENCODING=utf-8 "
                    "python .harden/render_report.py 8")


class ForbiddenDataTests(HookTestCase):
    """pilot-auto-calibration A01-F54: text a command only writes to a file under .harden/ is
    data for forbidden_commands; everything that could run it stays matched."""

    def setUp(self) -> None:
        super().setUp()
        self.write_active(mode="auto", forbidden_commands=PILOT3_BANS,
                          test_globs=hg.dg.DEFAULT_TEST_GLOBS + ["tests/**"])

    def fill(self, text: str) -> str:
        return text.replace("{repo}", self.repo.as_posix()).replace("{scripts}", SCRIPTS_DIR)

    def sub(self, command: str) -> Tuple[int, str, str]:
        return self.run_hook({"session_id": "s1", "cwd": str(self.repo),
                              "permission_mode": "default", "hook_event_name": "PreToolUse",
                              "tool_name": "Bash", "agent_id": "a1",
                              "agent_type": "harden-verifier",
                              "tool_input": {"command": command}})

    def test_pilot3_notes_heredoc_is_data(self) -> None:
        code, _out, err = self.pre("Bash", {"command": self.fill(PILOT3_NOTE)})
        self.assertEqual(code, 0, err)

    def test_pilot3_facts_file_without_running_it_is_data(self) -> None:
        code, _out, err = self.pre("Bash", {"command": self.fill(PILOT3_FACTS)})
        self.assertEqual(code, 0, err)

    def test_pilot3_facts_file_run_in_the_same_command_stays_matched(self) -> None:
        code, _out, err = self.pre("Bash", {"command": self.fill(PILOT3_FACTS) +
                                            PILOT3_FACTS_RUN})
        self.assertEqual(code, 2, err)
        self.assertIn("[reason_code: profile-forbidden]", err)
        self.assertIn("here-document", err)
        self.assertIn("runs `python`", err)

    def test_data_writes_are_not_matched(self) -> None:
        commands = [
            "printf '%s\\n' \"- refused: node dist/cli.js alerts (owner item)\" >> "
            ".harden/progress.md",
            "echo \"- note: node dist/cli.js snapshot is forbidden\" >> .harden/progress.md",
            "tee -a .harden/progress.md > /dev/null <<'EOF'\nnode dist/cli.js watch\nEOF",
            "cat > .harden/tools/msg-H-004-a1.txt <<'EOF'\nfix(alerts): quote node "
            "dist/cli.js alerts\nEOF\ngit add src/app.py && git status --porcelain",
            "cat > .harden/n.md <<'EOF'\n$(node dist/cli.js alerts) stays text\nEOF",
        ]
        for command in commands:
            with self.subTest(command=command):
                code, _out, err = self.pre("Bash", {"command": command})
                self.assertEqual(code, 0, err)

    def test_code_stays_matched(self) -> None:
        commands = [
            "node dist/cli.js alerts --once",
            "bash <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "python - <<'EOF'\nimport os; os.system('node dist/cli.js alerts')\nEOF",
            "node <<'EOF'\nrequire('child_process').execSync('node dist/cli.js alerts')\nEOF",
            "bash -c \"$(cat <<'EOF'\nnode dist/cli.js alerts\nEOF\n)\"",
            "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\neval \"$(cat "
            ".harden/x.sh)\"",
            "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\n. .harden/x.sh",
            "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\nbash .harden/x.sh",
            "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\ncat .harden/x.sh | sh",
            "cat > .harden/n.md <<EOF\n$(node dist/cli.js alerts)\nEOF",
            "echo \"$(node dist/cli.js alerts)\" >> .harden/progress.md",
            "cat <<'EOF' | bash\nnode dist/cli.js alerts\nEOF",
            "tee .harden/n.md <<'EOF' | bash\nnode dist/cli.js alerts\nEOF",
            "cat > tests/cli-alerts.test.ts <<'EOF'\nexecSync('node dist/cli.js alerts')\nEOF",
            "cat > .git/hooks/pre-commit <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "PATH=/tmp/evil:$PATH cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "cat() { bash; }; cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "function cat { bash; }; cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "hash -p /usr/bin/bash cat; cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "shopt -s expand_aliases; alias cat=bash; cat > .harden/n.md <<'EOF'\nnode "
            "dist/cli.js alerts\nEOF",
            "cat > .harden/n.md <<'EOF' && node dist/cli.js alerts\nsome note\nEOF",
            "echo '<<X'\nnode dist/cli.js alerts",
            "cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts",
            "cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF\nnpx vitest run",
            "echo \"node dist/cli.js alerts\" > \"$HOME/n.md\"",
            ". .harden/project-env.sh && cat >> .harden/progress.md <<'EOF'\nnode dist/cli.js "
            "pnl\nEOF",
            r"y=$'\x24('" + "\ncat > .harden/n.md <<EOF\n${z=${y}node dist/cli.js alerts)}"
            "${z@P}\nEOF",
            "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\n" +
            r"test -v $'a[\x24(bash .harden/x.sh)]'",
            "cat > .harden/json.py <<'EOF'\nimport os; os.system('node dist/cli.js alerts')\n"
            "EOF\nPYTHONPATH=.harden python \"" + SCRIPTS_DIR + "/budget.py\" --help",
            "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\nGIT_CONFIG_COUNT=1 "
            "GIT_CONFIG_KEY_0=core.fsmonitor GIT_CONFIG_VALUE_0='bash .harden/x.sh' git status",
            "cd .git/hooks && cat > pre-commit <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\necho 'bash .harden/x.sh' "
            ">> .harden/project-env.sh\n. .harden/project-env.sh",
            "{ tee .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF\n} | sh",
            "cat > src/notes.md <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "./cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "\\cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\nrg --pre bash x "
            ".harden/x.sh",
            "cat > .harden/n.md <<EOF\nnode dist/cli.js alerts\nEOF",
            "printf -v 'a[0]' '%s' \"node dist/cli.js alerts\"",
            "cat > .harden/n.md <<'EOF'\nnode dist/cli.js alerts\nEOF\nsort -o "
            ".harden/project-env.sh .harden/n.md",
            "echo \"node dist/cli.js alerts\" > C:/Users/x/.gitconfig",
        ]
        for command in commands:
            with self.subTest(command=command):
                code, _out, err = self.pre("Bash", {"command": command})
                self.assertEqual(code, 2, err)
                self.assertIn("[reason_code: profile-forbidden]", err)

    def test_powershell_has_no_data_exemption(self) -> None:
        code, _out, err = self.pre("PowerShell", {
            "command": "@'\nnode dist/cli.js alerts\n'@ | Set-Content .harden/n.md"})
        self.assertEqual(code, 2, err)
        self.assertIn("[reason_code: profile-forbidden]", err)

    def test_refusal_names_the_reason_only_when_the_match_is_in_data(self) -> None:
        _code, _out, err = self.pre("Bash", {
            "command": "cat > .harden/x.sh <<'EOF'\nnode dist/cli.js alerts\nEOF\neval "
                       "\"$(cat .harden/x.sh)\""})
        self.assertIn("here-document", err)
        self.assertIn("here the command holds $, a backtick, a subshell", err)
        _code, _out, err = self.pre("Bash", {"command": "node dist/cli.js alerts"})
        self.assertIn("[reason_code: profile-forbidden]", err)
        self.assertNotIn("The match lies in here-document", err)

    def test_existing_forbidden_cases_unchanged(self) -> None:
        self.write_active(mode="auto", forbidden_commands=ProfileRuleTests.FORBIDDEN)
        cases = [("Bash", "npm run deploy"), ("Bash", "cd web &&  NPM  run   deploy -- --prod"),
                 ("Bash", 'npm run "deploy"'), ("Bash", "bash -c 'npm run deploy'"),
                 ("Bash", "git push origin harden/x"),
                 ("Bash", "python scripts/Sign_TX.py --amount 5"),
                 ("PowerShell", "npm run deploy; Write-Output done"), ("PowerShell", "git push")]
        for tool, command in cases:
            with self.subTest(command=command):
                self.assertEqual(self.pre(tool, {"command": command})[0], 2)

    def test_subagent_note_is_matched_whole(self) -> None:
        code, _out, err = self.sub(self.fill(PILOT3_NOTE))
        self.assertEqual(code, 2, err)
        self.assertIn("[reason_code: profile-forbidden]", err)

    def test_data_rule_error_matches_the_raw_command(self) -> None:
        with mock.patch.object(hg, "data_regions", side_effect=RuntimeError("x")):
            code, _out, err = self.pre("Bash", {"command": self.fill(PILOT3_NOTE)})
        self.assertEqual(code, 2, err)
        self.assertIn("[reason_code: profile-forbidden]", err)
        self.assertTrue((self.repo / ".harden" / "hook_errors.log").exists())

    def test_data_needs_a_file_that_stays_inside_harden(self) -> None:
        # Review round 4: a hard link inside .harden/ shares its data with a git hook, and a
        # relative target after `cd -` or `popd` lies wherever the shell was before.
        hooks = self.repo / ".git" / "hooks"
        hooks.mkdir(parents=True, exist_ok=True)
        _write(self.repo, ".git/hooks/pre-commit", "#!/bin/sh\n")
        os.link(str(hooks / "pre-commit"), str(self.repo / ".harden" / "hl.md"))
        _write(self.repo, ".harden/tool-env.sh", "export TMPDIR=x\n")
        refused = [
            "echo 'node dist/cli.js alerts' >> .harden/hl.md",
            "cat >> .harden/hl.md <<'EOF'\nnode dist/cli.js alerts\nEOF",
            "cd - && echo 'node dist/cli.js alerts' > .harden/n.md",
            "popd && echo 'node dist/cli.js alerts' > .harden/n.md",
            "echo 'node dist/cli.js alerts' > .harden/Tool-Env.sh",
        ]
        if os.name == "nt":  # Windows opens tool-env.sh for "tool-env.sh."
            refused.append("echo 'node dist/cli.js alerts' > .harden/tool-env.sh.")
        for command in refused:
            with self.subTest(command=command):
                code, _out, err = self.pre("Bash", {"command": command})
                self.assertEqual(code, 2, err)
                self.assertIn("[reason_code: profile-forbidden]", err)
        for command in ("cd .harden && echo 'node dist/cli.js alerts' >> notes.md",
                        "echo 'node dist/cli.js alerts' >> \"{}/.harden/notes.md\"".format(
                            self.repo.as_posix())):
            with self.subTest(command=command):
                code, _out, err = self.pre("Bash", {"command": command})
                self.assertEqual(code, 0, err)

    def test_data_regions_restore_the_directory_state(self) -> None:
        active = json.loads((self.repo / ".harden" / "active").read_text(encoding="utf-8"))
        ctx = hg.Ctx(Path(self.repo), str(self.repo), hg.dg.load_run_config(self.repo), active)
        before = ctx.dirs.cwd
        hg.data_regions("cd tests && cat > ../.harden/n.md <<'EOF'\nx\nEOF", ctx)
        self.assertEqual(ctx.dirs.cwd, before)


class TokenizerTests(unittest.TestCase):
    """Here-documents are read as Bash reads them (pilot-auto-calibration A01-F54)."""

    def words(self, command: str) -> List[str]:
        return [t.text for t in hg.tokenize(command, "bash") if t.kind == "word"]

    def test_heredoc_body_is_attached_and_skipped(self) -> None:
        toks = hg.tokenize("cat > .harden/a.md <<'EOF' && echo ok\nbody line\nEOF\ngit status",
                           "bash")
        docs = [t for t in toks if t.kind == "redir" and t.heredoc is not None]
        self.assertEqual(len(docs), 1)
        doc = docs[0].heredoc
        assert doc is not None
        self.assertEqual(doc.delimiter, "EOF")
        self.assertIs(doc.quoted, True)
        self.assertEqual(doc.body, "body line\n")
        self.assertIs(doc.terminated, True)
        words = [t.text for t in toks if t.kind == "word"]
        for word in ("echo", "ok", "git", "status"):
            self.assertIn(word, words)
        self.assertNotIn("body", words)
        segments = [s for p in hg.split_pipelines(toks) for s in p]
        self.assertEqual(segments[0].heredocs, [doc])

    def test_quoted_or_commented_heredoc_operator_starts_no_body(self) -> None:
        for command in ("echo '<<X'\nrm -rf build", "# <<X\nrm -rf build"):
            with self.subTest(command=command):
                words = self.words(command)
                for word in ("rm", "-rf", "build"):
                    self.assertIn(word, words)

    def test_two_heredocs_on_one_line(self) -> None:
        toks = hg.tokenize("cat <<A <<B\na\nA\nb\nB\necho done", "bash")
        bodies = [t.heredoc.body for t in toks if t.heredoc is not None]
        self.assertEqual(bodies, ["a\n", "b\n"])
        words = [t.text for t in toks if t.kind == "word"]
        self.assertIn("echo", words)
        self.assertIn("done", words)

    def test_tab_stripping_and_crlf_terminators(self) -> None:
        for command in ("cat <<-EOF\n\tx\n\tEOF\necho y", "cat <<'EOF'\r\nx\r\nEOF\r\necho y"):
            with self.subTest(command=command):
                toks = hg.tokenize(command, "bash")
                docs = [t.heredoc for t in toks if t.heredoc is not None]
                self.assertTrue(docs and docs[0].terminated)
                words = [t.text for t in toks if t.kind == "word"]
                self.assertIn("echo", words)
                self.assertIn("y", words)

    def test_word_spans_are_raw_offsets(self) -> None:
        command = "echo 'a b' \"c\" d"
        words = [t for t in hg.tokenize(command, "bash") if t.kind == "word"]
        self.assertEqual([command[t.start:t.end] for t in words[1:]], ["'a b'", '"c"', "d"])

    def test_partly_quoted_delimiter_starts_no_body(self) -> None:
        words = self.words("cat > n.md <<E\"OF\"\nnote\nEOF\nrm -rf build")
        for word in ("rm", "-rf", "build"):
            self.assertIn(word, words)

    def test_arithmetic_shift_is_not_a_heredoc(self) -> None:
        self.assertIn("rm", self.words("echo $((x<<y))\nrm -rf build"))

    def test_unterminated_body_is_tokenized(self) -> None:
        self.assertIn("rm", self.words("cat > n.md <<'EOF'\nrm -rf build"))


class LinkAndHeredocShellTests(HookTestCase):
    """Here-documents a shell or interpreter reads are code (A01-F54); links and git worktree
    remove are refused, at command position only (A01-F56)."""

    BLOCKED_BASH = [
        "echo '<<X'\nrm -rf build",
        "bash <<'EOF'\nrm -rf build\nEOF",
        "sh <<EOF\ngit push --force\nEOF",
        "cat <<'EOF' | bash\ngit reset --hard HEAD~1\nEOF",
        "python - <<'EOF'\nimport shutil; shutil.rmtree('src')\nEOF",
        "cat > notes.md <<EOF\n$(rm -rf build)\nEOF",
        "echo $((x<<y))\nrm -rf build",
        "cat > notes.md <<E\"OF\"\nnote\nEOF\nrm -rf build",
        "cat > notes.md <<'EOF'\nrm -rf build",
        "bash -s x <<'EOF'\nrm -rf build\nEOF",
        "source /dev/stdin <<'EOF'\ngit push --force\nEOF",
        "python3.12 - <<'EOF'\nimport shutil; shutil.rmtree('src')\nEOF",
        "git worktree remove ../wt",
        "git worktree remove --force ../wt",
        "cmd //c mklink /J wt\\node_modules node_modules",
        "ln -s ../node_modules wt/node_modules",
        "cp -s src/app.py wt/app.py",
        "powershell -NoProfile -Command \"New-Item -ItemType Junction -Path wt/node_modules "
        "-Target node_modules\"",
        "python -c \"import os; os.symlink('node_modules', 'wt/node_modules')\"",
        "fsutil hardlink create wt\\a.py src\\app.py",
        "env ln -s ../node_modules wt/node_modules",
        "python -c \"import subprocess; subprocess.run(['cmd','/c','mklink','/J','a','b'])\"",
        # review round 4: a command position after a wrapper's options or find's -exec
        "find . -name x -exec ln -s ../node_modules wt/node_modules \\;",
        "busybox ln -s a b",
        "timeout 60 ln -s a b",
        "nice -n 5 ln -s a b",
        "xargs -n 1 ln -s < list.txt",
        # review round 4: a shell behind a wrapper's options, a quoted shell name, and a
        # here-string a shell or interpreter reads
        "timeout 5 bash <<'EOF'\nrm -rf build\nEOF",
        "nice -n 5 sh <<'EOF'\nrm -rf build\nEOF",
        "env -i bash <<'EOF'\nrm -rf build\nEOF",
        "\"bash\" <<'EOF'\nrm -rf build\nEOF",
        "bash <<<'rm -rf build'",
        "python3 <<<'import shutil; shutil.rmtree(\"src\")'",
    ]
    ALLOWED_BASH = [
        "cat > notes.md <<'EOF'\n$(rm -rf build) is quoted text\nEOF",
        "cat <<'EOF' > notes.md\nrm -rf /\ngit push --force\nEOF",
        "git worktree list",
        "git worktree prune",
        "echo ln -s a b",
        "mkdir -p .harden/tools/x",
        "grep -w ln src/app.py",
        "git log --grep junction",
        "grep cp -l src/app.py",
        "grep -rn -- ln src/app.py",
        "sort -k 2 ln",
        "cat <<<'rm -rf build is text'",
        "grep rm <<<'rm -rf build'",
        "timeout 5 cat <<'EOF'\nrm -rf build\nEOF",
    ]
    BLOCKED_POWERSHELL = [
        "New-Item -ItemType SymbolicLink -Path wt/nm -Target node_modules",
        "ni wt/nm -ItemType Junction -Value node_modules",
        "cmd /c mklink /D wt\\nm node_modules",
        "New-Item -ItemType J -Path wt/nm -Target node_modules",
        "ni -It sym wt/nm -Value node_modules",
        "New-Item -Type:Junction wt/nm node_modules",
    ]
    ALLOWED_POWERSHELL = [
        "New-Item -ItemType Directory -Path .harden/tools/x",
        "New-Item -ItemType Directory -Path .harden/tools/junction",
    ]

    def test_blocked_commands_are_refused_with_a_registered_reason_code(self) -> None:
        commands = [("Bash", c) for c in self.BLOCKED_BASH] + \
                   [("PowerShell", c) for c in self.BLOCKED_POWERSHELL]
        for tool, command in commands:
            with self.subTest(command=command):
                status, _, err = self.pre(tool, {"command": command})
                self.assertEqual(status, 2, f"not blocked: {command}")
                self.assertIn("ask the user", err)
                code = read_events(self.repo)[-1]["reason_code"]
                self.assertIn(code, hg.REASON_CODES)
                self.assertIn(f"[reason_code: {code}]", err)

    def test_allowed_commands_run(self) -> None:
        for tool, commands in (("Bash", self.ALLOWED_BASH),
                               ("PowerShell", self.ALLOWED_POWERSHELL)):
            for command in commands:
                with self.subTest(command=command):
                    code, _, err = self.pre(tool, {"command": command})
                    self.assertEqual(code, 0, f"blocked: {command}: {err}")

    def test_link_and_worktree_refusals_name_their_codes(self) -> None:
        for command, code in (("ln -s a b", "link-create"),
                              ("git worktree remove ../wt", "git-worktree-remove")):
            with self.subTest(command=command):
                _status, _, err = self.pre("Bash", {"command": command})
                self.assertIn(f"[reason_code: {code}]", err)
                self.assertIn("scratch", err)

    def test_scratch_remove_is_run_control_for_subagents(self) -> None:
        payload = {"session_id": "s1", "cwd": str(self.repo), "permission_mode": "default",
                   "hook_event_name": "PreToolUse", "tool_name": "Bash", "agent_id": "v-9",
                   "agent_type": "harden-verifier",
                   "tool_input": {"command": "python run_state.py scratch-remove x"}}
        status, _, err = self.run_hook(payload)
        self.assertEqual(status, 2, err)
        self.assertIn("[reason_code: subagent-run-control]", err)
        self.assertEqual(self.bash("python run_state.py scratch-remove x"), 0)


if __name__ == "__main__":
    unittest.main()
