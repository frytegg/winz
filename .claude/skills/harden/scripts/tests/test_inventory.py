"""Tests for scripts/inventory.py and the history model in scripts/_common.py.

Throwaway git repositories are built in temporary directories with `git fast-import` (fixed
authors and dates) or plain `git commit`. The user's global/system git config is isolated
through GIT_CONFIG_GLOBAL / GIT_CONFIG_NOSYSTEM for the duration of this module.

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import _common as C  # noqa: E402
import inventory as INV  # noqa: E402

BASE_TS = 1_700_000_000   # 2023-11-14, fixed so that verdicts do not depend on today
DAY = 86400

# ---------------------------------------------------------------------------
# Git isolation and fixture builders (also imported by test_rank.py)
# ---------------------------------------------------------------------------

_SAVED_ENV: Dict[str, Optional[str]] = {}
_ENV_DIR: Optional[str] = None


def isolate_git() -> None:
    """Point git at a private global config (fixed identity, LF, main branch, no signing)."""
    global _ENV_DIR
    if _ENV_DIR is not None:
        return
    _ENV_DIR = tempfile.mkdtemp(prefix="harden-gitcfg-")
    cfg = Path(_ENV_DIR) / "gitconfig"
    cfg.write_text("[user]\n\tname = Test Dev\n\temail = dev@example.com\n"
                   "[core]\n\tautocrlf = false\n[init]\n\tdefaultBranch = main\n"
                   "[commit]\n\tgpgsign = false\n", encoding="utf-8")
    for key, value in (("GIT_CONFIG_GLOBAL", str(cfg)), ("GIT_CONFIG_NOSYSTEM", "1")):
        _SAVED_ENV[key] = os.environ.get(key)
        os.environ[key] = value


def restore_git() -> None:
    """Undo isolate_git()."""
    global _ENV_DIR
    for key, value in _SAVED_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    _SAVED_ENV.clear()
    if _ENV_DIR:
        shutil.rmtree(_ENV_DIR, ignore_errors=True)
    _ENV_DIR = None


def run_git(repo: Path, *args: str, input_bytes: Optional[bytes] = None) -> str:
    """Run git in repo, fail loudly."""
    proc = subprocess.run(["git"] + list(args), cwd=str(repo), input=input_bytes,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if proc.returncode != 0:
        raise RuntimeError("git {} failed: {}".format(" ".join(args),
                                                      proc.stderr.decode("utf-8", "replace")))
    return proc.stdout.decode("utf-8", "replace")


class RepoBuilder:
    """Build a repository history in one `git fast-import` stream.

    commit(files={path: content or None (delete)}, renames=[(old, new)], ts=..., message=...)
    Commits go to `branch` (default main); `merge_from` makes a merge commit.
    """

    def __init__(self, root: Path) -> None:
        self.root = root
        self.stream = bytearray()
        self.mark = 0
        self.tips: Dict[str, int] = {}
        self.marks_by_label: Dict[str, int] = {}

    @staticmethod
    def _data(payload: bytes) -> bytes:
        return b"data " + str(len(payload)).encode() + b"\n" + payload + b"\n"

    def commit(self, message: str, ts: int, files: Optional[Dict[str, Optional[str]]] = None,
               renames: Sequence[Tuple[str, str]] = (), branch: str = "main",
               start_from: Optional[str] = None, merge_from: Optional[str] = None,
               author: Tuple[str, str] = ("Test Dev", "dev@example.com"),
               label: Optional[str] = None) -> int:
        self.mark += 1
        s = self.stream
        s += "commit refs/heads/{}\nmark :{}\n".format(branch, self.mark).encode()
        s += "author {} <{}> {} +0000\n".format(author[0], author[1], ts).encode()
        s += "committer {} <{}> {} +0000\n".format(author[0], author[1], ts).encode()
        s += self._data(message.encode("utf-8"))
        if branch not in self.tips and start_from is not None:
            s += "from :{}\n".format(self.tips[start_from]).encode()
        if merge_from is not None:
            s += "merge :{}\n".format(self.tips[merge_from]).encode()
        for old, new in renames:
            s += "R {} {}\n".format(old, new).encode()
        for path, content in (files or {}).items():
            if content is None:
                s += "D {}\n".format(path).encode()
            else:
                s += "M 100644 inline {}\n".format(path).encode()
                s += self._data(content.encode("utf-8"))
        s += b"\n"
        self.tips[branch] = self.mark
        if label:
            self.marks_by_label[label] = self.mark
        return self.mark

    def build(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        run_git(self.root, "init", "-q")
        run_git(self.root, "fast-import", "--quiet", input_bytes=bytes(self.stream) + b"done\n")
        run_git(self.root, "symbolic-ref", "HEAD", "refs/heads/main")
        run_git(self.root, "reset", "-q", "--hard")
        return self.root


def lines(n: int, tag: str) -> str:
    """n distinct non-blank lines."""
    return "".join("{}_{} = {}\n".format(tag, i, i) for i in range(n))


def build_rich_history(root: Path, fixes_after_cut: bool = True, n_commits: int = 170,
                       span_days: int = 200, agent_file_at: Optional[int] = None,
                       rename_hot_at: Optional[int] = 60,
                       late_fix_path: Optional[str] = None) -> RepoBuilder:
    """History that passes the G104-F04 gate: >=150 filtered commits over >122 days with >=25
    fix-labelled commits, a bulk initial import carrying <50% of churn, no agent adoption.

    12 large files (100 lines) are created once; a small hot file (30 lines) changes in every
    later commit and is renamed at commit `rename_hot_at` (pure rename). Every 4th commit is a
    fix. When `fixes_after_cut` is False, no fix-labelled commit lands in the last 90 days and
    every 2nd earlier commit is a fix, so the S3 threshold still passes. With `late_fix_path`,
    fix commits after the cut-off edit that (large) file instead of the hot file.
    """
    b = RepoBuilder(root)
    initial = {"src/big{:02d}.py".format(i): lines(100, "big{}".format(i)) for i in range(12)}
    hot_path = "src/hot_old.py" if rename_hot_at is not None else "src/hot.py"
    initial[hot_path] = lines(30, "hot")
    initial["README.md"] = "# demo\n"
    initial["package-lock.json"] = "{}\n"
    b.commit("initial import", BASE_TS, files=initial)
    step = span_days * DAY / (n_commits - 1)
    last_ts = BASE_TS + span_days * DAY
    cut = last_ts - 90 * DAY
    for k in range(1, n_commits):
        ts = int(BASE_TS + k * step)
        is_fix = k % 4 == 0
        if not fixes_after_cut:
            is_fix = k % 2 == 0 and ts <= cut
        msg = "fix: correct hot path {}".format(k) if is_fix else "feat: extend hot path {}".format(k)
        if rename_hot_at is not None and k == rename_hot_at:
            b.commit("refactor: rename hot module", ts, renames=[("src/hot_old.py", "src/hot.py")])
            hot_path = "src/hot.py"
            continue
        files = {hot_path: lines(15, "stable") + lines(15, "v{}".format(k))}
        if late_fix_path is not None and is_fix and ts > cut:
            files = {late_fix_path: initial[late_fix_path] + "late_fix_{} = 1\n".format(k)}
        if agent_file_at is not None and k == agent_file_at:
            files["CLAUDE.md"] = "# agent notes\n"
        b.commit(msg, ts, files=files)
    b.build()
    return b


# ---------------------------------------------------------------------------
# Fixture: a polyglot repository for detection tests
# ---------------------------------------------------------------------------

PACKAGE_JSON = {
    "name": "app", "private": True, "packageManager": "pnpm@9.0.0",
    "scripts": {
        "build": "tsc -p .", "test": "vitest run", "test:watch": "vitest", "lint": "eslint .",
        "lint:fix": "eslint . --fix", "typecheck": "tsc --noEmit",
        "format:check": "prettier --check .", "pretest": "echo pre",
        "ci:test": "vitest run --passWithNoTests", "dev": "vite"},
    "devDependencies": {"vitest": "1.0.0", "eslint": "9.0.0"},
    "prettier": {"semi": False},
}

WORKFLOW = """name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm install --frozen-lockfile
      - run: pnpm test || true
      - name: lint
        run: |
          pnpm run lint
          cargo fmt --check
      - name: forge
        working-directory: ./sol
        run: forge test -vvv
      - run: pnpm -r --filter web build
      - run: pnpm fmt:sol:check
"""

PYPROJECT = """[project]
name = "pkg"
requires-python = ">=3.11"

[project.scripts]
pkg = "pkg.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
line-length = 100

[tool.ruff.format]
quote-style = "double"

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.mypy]
strict = true
"""

CARGO = """[package]
name = "tool"
version = "0.1.0"

[[bin]]
name = "tool"
path = "src/main.rs"

[lints.clippy]
all = "warn"
"""

FOUNDRY = """[profile.default]
src = "src"
libs = ["lib"]
"""

MAKEFILE = """.PHONY: test lint deploy
test:
\tpytest || true
lint:
\truff check .
deploy:
\tsh scripts/deploy.sh
"""

FILES: Dict[str, str] = {
    "package.json": json.dumps(PACKAGE_JSON, indent=2),
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "tsconfig.json": "{}\n",
    "eslint.config.js": "export default [];\n",
    "src/index.ts": "export const a = 1;\nexport const b = 2;\n",
    "src/util.ts": "export function f(): number {\n  return 1;\n}\n",
    "src/index.test.ts": "import { a } from './index';\ntest('a', () => expect(a).toBe(1));\n",
    "src/__snapshots__/index.test.ts.snap": "exports[`a`] = `1`;\n",
    "src/gen/api.ts": "// @generated by protoc. DO NOT EDIT.\nexport const x = 1;\n",
    "src/proto/msg.ts": "export const m = 1;\n",
    ".gitattributes": "src/proto/** linguist-generated\n",
    "dist/bundle.js": "var a=1;\n",
    "vendor/lib.js": "module.exports = 1;\n",
    ".github/workflows/ci.yml": WORKFLOW,
    "CLAUDE.md": "# notes for the agent\n",
    "README.md": "# app\n",
    "docs/guide.md": "# guide\n",
    "py/pyproject.toml": PYPROJECT,
    "py/uv.lock": "version = 1\n",
    "py/pkg/__init__.py": "",
    "py/pkg/cli.py": "def main() -> int:\n    return 0\n",
    "py/tests/test_cli.py": "from pkg.cli import main\n\n\ndef test_main():\n    assert main() == 0\n",
    "rs/Cargo.toml": CARGO,
    "rs/Cargo.lock": "version = 3\n",
    "rs/src/main.rs": "fn main() {\n    println!(\"hi\");\n}\n",
    "sol/foundry.toml": FOUNDRY,
    "sol/src/Token.sol": "pragma solidity ^0.8.0;\ncontract Token {}\n",
    "sol/test/Token.t.sol": "pragma solidity ^0.8.0;\ncontract TokenTest {}\n",
    "sol/lib/forge-std/src/Test.sol": "pragma solidity ^0.8.0;\ncontract Test {}\n",
    "Makefile": MAKEFILE,
    "go/go.mod": "module example.com/x\n\ngo 1.22\n",
    "go/main.go": "package main\n\nfunc main() {}\n",
    "go/x_test.go": "package main\n\nimport \"testing\"\n\nfunc TestX(t *testing.T) {}\n",
    "scripts/deploy.sh": "#!/bin/sh\nset +e\necho deploy\n",
    "tools/cleanup.sh": "#!/bin/sh\nrm -f /tmp/x || true\n",   # called by nothing
}


def write_files(root: Path, files: Dict[str, str]) -> None:
    for rel, content in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)


def make_fixture_repo(root: Path, files: Dict[str, str] = FILES) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    write_files(root, files)
    run_git(root, "init", "-q")
    run_git(root, "add", "-A")
    run_git(root, "commit", "-q", "-m", "initial")
    return root


def setUpModule() -> None:  # noqa: N802 (unittest hook)
    isolate_git()


def tearDownModule() -> None:  # noqa: N802
    restore_git()


def cmds(inv: dict, cat: str) -> List[str]:
    return [c["cmd"] for c in inv["command_candidates"][cat]]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class DetectionTests(unittest.TestCase):
    """Language, manifest, tool, command and glob detection on the polyglot fixture."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="harden-inv-")
        cls.repo = make_fixture_repo(Path(cls.tmp) / "repo")
        cls.inv = INV.build_inventory(C.resolve_repo(cls.repo))

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_languages_exclude_generated(self) -> None:
        langs = self.inv["languages"]
        self.assertIn("TypeScript", langs)
        # index.ts, util.ts, index.test.ts; gen/api.ts (@generated) and proto/msg.ts
        # (linguist-generated) are excluded
        self.assertEqual(langs["TypeScript"]["files"], 3)
        self.assertIn("Python", langs)
        self.assertIn("Rust", langs)
        self.assertIn("Solidity", langs)
        self.assertEqual(langs["Solidity"]["files"], 2)  # lib/forge-std is vendored
        self.assertIn("Go", langs)
        self.assertIn("Shell", langs)
        # dist/bundle.js and vendor/lib.js are excluded; eslint.config.js is counted
        self.assertEqual(langs["JavaScript"]["files"], 1)
        self.assertEqual(self.inv["size"]["tracked_files"], len(FILES))
        self.assertEqual(self.inv["size"]["test_files"], 4)

    def test_generated_or_vendor(self) -> None:
        paths = {e["path"]: e["reason"] for e in self.inv["generated_or_vendor"]}
        self.assertIn("dist/", paths)
        self.assertIn("vendor/", paths)
        self.assertIn("sol/lib/", paths)
        self.assertIn("src/gen/api.ts", paths)
        self.assertIn("marker", paths["src/gen/api.ts"])
        self.assertIn("src/proto/msg.ts", paths)
        self.assertIn("linguist-generated", paths["src/proto/msg.ts"])

    def test_manifests_and_package_managers(self) -> None:
        kinds = {m["path"]: m["kind"] for m in self.inv["manifests"]}
        self.assertEqual(kinds["package.json"], "npm-package")
        self.assertEqual(kinds["py/pyproject.toml"], "pyproject")
        self.assertEqual(kinds["rs/Cargo.toml"], "cargo")
        self.assertEqual(kinds["sol/foundry.toml"], "foundry")
        self.assertEqual(kinds["go/go.mod"], "go-module")
        self.assertEqual(kinds["Makefile"], "make")
        pms = {p["name"] for p in self.inv["package_managers"]}
        self.assertTrue({"pnpm", "uv", "cargo", "go", "forge"} <= pms, pms)
        self.assertNotIn("npm", pms)

    def test_tools_configured(self) -> None:
        tools = {(t["tool"], t["config_path"]) for t in self.inv["tools_configured"]}
        names = {t for t, _ in tools}
        for expected in ("eslint", "tsconfig", "ruff", "pytest", "mypy", "clippy", "foundry",
                         "prettier", "vitest"):
            self.assertIn(expected, names)
        self.assertIn(("prettier", "package.json (prettier)"), tools)
        self.assertIn(("ruff", "py/pyproject.toml [tool.ruff]"), tools)
        self.assertIn(("clippy", "rs/Cargo.toml [lints.clippy]"), tools)

    def test_package_json_candidates(self) -> None:
        inv = self.inv
        self.assertEqual(cmds(inv, "test")[0], "pnpm run test")
        self.assertNotIn("pnpm run test:watch", cmds(inv, "test"))
        self.assertNotIn("pnpm run pretest", cmds(inv, "test"))
        self.assertNotIn("pnpm run dev", sum((cmds(inv, c) for c in INV.CATEGORIES), []))
        self.assertIn("pnpm run lint", cmds(inv, "lint"))
        self.assertNotIn("pnpm run lint:fix", cmds(inv, "lint"))
        self.assertEqual(cmds(inv, "typecheck")[0], "pnpm run typecheck")
        self.assertEqual(cmds(inv, "build")[0], "pnpm run build")
        self.assertEqual(cmds(inv, "format_check")[0], "pnpm run format:check")
        masked = [c for c in inv["command_candidates"]["test"] if c["cmd"] == "pnpm run ci:test"]
        self.assertEqual(len(masked), 1)
        self.assertTrue(any("passWithNoTests" in w for w in masked[0]["warnings"]))

    def test_python_rust_foundry_go_make_candidates(self) -> None:
        inv = self.inv
        self.assertIn("uv run pytest", cmds(inv, "test"))
        self.assertIn("uv run ruff check .", cmds(inv, "lint"))
        self.assertIn("uv run ruff format --check .", cmds(inv, "format_check"))
        self.assertIn("uv run mypy .", cmds(inv, "typecheck"))
        self.assertIn("cargo test", cmds(inv, "test"))
        self.assertIn("cargo clippy", cmds(inv, "lint"))
        self.assertIn("forge test", cmds(inv, "test"))
        self.assertIn("go test ./...", cmds(inv, "test"))
        self.assertIn("go vet ./...", cmds(inv, "lint"))
        make_test = [c for c in inv["command_candidates"]["test"] if c["cmd"] == "make test"]
        self.assertEqual(len(make_test), 1)
        self.assertTrue(any("|| true" in w for w in make_test[0]["warnings"]))
        py_test = [c for c in inv["command_candidates"]["test"] if c["cmd"] == "uv run pytest"][0]
        self.assertEqual(py_test["cwd"], "py")
        # CI rustfmt check makes cargo fmt a warning-free candidate
        fmt = [c for c in inv["command_candidates"]["format_check"]
               if c["cmd"] == "cargo fmt --check"][0]
        self.assertNotIn("warnings", fmt)

    def test_ci_commands_and_masking(self) -> None:
        inv = self.inv
        self.assertEqual(inv["ci_files"], [".github/workflows/ci.yml"])
        ci_cmds = [c["cmd"] for c in inv["ci_commands"]]
        self.assertIn("pnpm test || true", ci_cmds)
        self.assertIn("pnpm run lint", ci_cmds)
        forge = [c for c in inv["command_candidates"]["test"] if c["cmd"] == "forge test -vvv"]
        self.assertEqual(len(forge), 1)
        self.assertEqual(forge[0]["cwd"], "sol")          # step working-directory is honoured
        self.assertIn("pnpm -r --filter web build", cmds(inv, "build"))
        self.assertIn("pnpm fmt:sol:check", cmds(inv, "format_check"))
        ci_test = [c for c in inv["command_candidates"]["test"] if c["cmd"] == "pnpm test || true"]
        self.assertTrue(any("masking" in w for w in ci_test[0]["warnings"]))
        constructs = [(m["path"], m["construct"]) for m in inv["masking_constructs"]]
        self.assertIn((".github/workflows/ci.yml", "|| true"), constructs)
        self.assertIn(("scripts/deploy.sh", "set +e"), constructs)       # called by make deploy
        self.assertFalse(any(p == "tools/cleanup.sh" for p, _ in constructs))
        self.assertTrue(any(p == "Makefile" for p, _ in constructs))
        self.assertTrue(any(p == "package.json" and "passWithNoTests" in c for p, c in constructs))

    def test_globs(self) -> None:
        inv = self.inv
        tg = inv["test_globs"]
        for g in ("*.test.ts", "**/*.test.ts", "tests/**", "**/tests/**", "test_*.py",
                  "**/test_*.py", "*_test.go", "*.t.sol", "**/test/**"):
            self.assertIn(g, tg)
        prot = inv["protected_globs_suggested"]
        for g in ("pnpm-lock.yaml", "py/uv.lock", "rs/Cargo.lock", ".github/workflows/**",
                  "eslint.config.js", "tsconfig.json", "**/__snapshots__/**"):
            self.assertIn(g, prot)
        for g in tg:
            self.assertNotIn(g, prot, g)   # test files are not gate configs (A01-F53)
        self.assertFalse(C.match_any("src/index.test.ts", prot))
        self.assertIn("py/pyproject.toml", inv["embedded_config_manifests"])
        self.assertIn("package.json", inv["embedded_config_manifests"])
        self.assertTrue(C.match_any("src/index.test.ts", tg))
        self.assertTrue(C.match_any("py/tests/test_cli.py", tg))
        self.assertFalse(C.match_any("src/index.ts", tg))

    def test_docs_agent_files_kind(self) -> None:
        inv = self.inv
        self.assertIn("README.md", inv["docs"])
        self.assertIn("docs/guide.md", inv["docs"])
        self.assertEqual(inv["agent_context_files"], ["CLAUDE.md"])
        kinds = {k["manifest"]: k for k in inv["project_kind"]}
        self.assertEqual(kinds["package.json"]["verdict"], "application")
        self.assertEqual(kinds["py/pyproject.toml"]["verdict"], "both")
        self.assertIn("pkg = pkg.cli:main", kinds["py/pyproject.toml"]["entry_points"])
        self.assertEqual(kinds["rs/Cargo.toml"]["verdict"], "application")
        self.assertEqual(kinds["go/go.mod"]["verdict"], "application")
        pins = {(p["path"], p["kind"]) for p in inv["toolchain_pins"]}
        self.assertIn(("package.json", "package.json packageManager"), pins)
        self.assertIn(("py/pyproject.toml", "requires-python"), pins)

    def test_same_result_without_tomllib(self) -> None:
        """Python 3.9/3.10 path: the fallback TOML reader yields the same detections."""
        saved = C._tomllib
        C._tomllib = None
        try:
            inv = INV.build_inventory(C.resolve_repo(self.repo))
        finally:
            C._tomllib = saved
        self.assertEqual(inv["command_candidates"], self.inv["command_candidates"])
        self.assertEqual(inv["tools_configured"], self.inv["tools_configured"])
        self.assertEqual(inv["project_kind"], self.inv["project_kind"])
        self.assertEqual(inv["generated_or_vendor"], self.inv["generated_or_vendor"])

    def test_gates_suggested_prefers_warning_free_root(self) -> None:
        gates = {g["name"]: g for g in self.inv["gates_suggested"]}
        self.assertEqual(gates["test"]["cmd"], "pnpm run test")
        self.assertEqual(gates["lint"]["cmd"], "pnpm run lint")
        self.assertEqual(gates["test"]["timeout_s"], 1800)

    def test_git_section_single_commit(self) -> None:
        g = self.inv["git"]
        self.assertTrue(g["is_repo"])
        self.assertTrue(g["clean"])
        self.assertEqual(g["commits"], 1)
        self.assertFalse(g["history_sufficient"])
        self.assertTrue(any(r.startswith("S1 failed") for r in g["history_reasons"]))
        # CLAUDE.md is committed: agent adoption is dated from it (G104-F10)
        self.assertIn("CLAUDE.md", g["agent_adoption"]["marker"])
        self.assertTrue(g["ownership_metrics_disabled"])


class UnmappedAndNotebookTests(unittest.TestCase):
    """unmapped_extensions, notebooks, new language mappings, unclassified CI commands."""

    NOTEBOOK = json.dumps({"cells": [
        {"cell_type": "markdown", "source": ["# Backtest\n"]},
        {"cell_type": "code", "source": ["import pandas as pd\n", "\n", "df = pd.read_csv('x')\n"],
         "outputs": [{"output_type": "display_data",
                      "data": {"image/png": "iVBORw0KGgo" + "A" * 5000}}]},
        {"cell_type": "code", "source": "df.describe()\n", "outputs": []},
    ], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}, indent=1)

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-unmapped-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self, files: Dict[str, str], binary: Optional[Dict[str, bytes]] = None) -> dict:
        root = self.tmp / "repo"
        root.mkdir(parents=True, exist_ok=True)
        for rel, data in (binary or {}).items():
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_bytes(data)
        make_fixture_repo(root, files)
        return INV.build_inventory(C.resolve_repo(root))

    def test_unmapped_extensions_and_new_languages(self) -> None:
        inv = self.build({
            "app.py": "x = 1\ny = 2\n",
            "analysis.ipynb": self.NOTEBOOK,
            "vault.vy": "# @version 0.3.10\nowner: public(address)\n",
            "lib/worker.ex": "defmodule Worker do\nend\n",
            "data/prices.csv": "a,b\n1,2\n3,4\n",
            "config.json": "{\n  \"a\": 1\n}\n",
            "LICENSE": "MIT\n",
            "package-lock.json": "{\n}\n",
        }, binary={"img/logo.png": b"\x89PNG\x00\x01\x02"})
        langs = inv["languages"]
        self.assertEqual(langs["Jupyter Notebook"], {"files": 1, "loc": 3})  # code cells only
        self.assertEqual(langs["Vyper"]["files"], 1)
        self.assertEqual(langs["Elixir"]["files"], 1)
        unmapped = inv["unmapped_extensions"]
        self.assertEqual(unmapped[".csv"], {"files": 1, "loc": 3, "binary_files": 0})
        self.assertEqual(unmapped[".json"], {"files": 1, "loc": 3, "binary_files": 0})
        self.assertEqual(unmapped["(none)"]["files"], 1)
        self.assertEqual(unmapped[".png"], {"files": 1, "loc": 0, "binary_files": 1})
        self.assertNotIn(".ipynb", unmapped)
        self.assertEqual(sum(v["files"] for v in unmapped.values()), 4)  # lockfile left out
        self.assertFalse(any(n.startswith("files with no language mapping")
                             for n in inv["notes"]))
        self.assertIn("unmapped extensions:", INV.summary_text(inv))

    def test_note_when_unmapped_files_dominate(self) -> None:
        inv = self.build({"app.py": "x = 1\n",
                          "schema.graphql": "".join("type T{} {{ id: ID }}\n".format(i)
                                                    for i in range(40))})
        notes = [n for n in inv["notes"] if n.startswith("files with no language mapping")]
        self.assertEqual(len(notes), 1)
        self.assertIn(".graphql", notes[0])

    def test_unclassified_ci_commands(self) -> None:
        cmds_in = [{"path": "ci.yml", "line": 1, "cmd": "npm ci"},
                   {"path": "ci.yml", "line": 2, "cmd": "pnpm run lint"},
                   {"path": "ci.yml", "line": 3, "cmd": "./scripts/verify-contracts.sh"},
                   {"path": "ci.yml", "line": 4, "cmd": "pytest -k ${{ matrix.k }}"}]
        out = INV.unclassified_ci_commands(cmds_in)
        self.assertEqual([(c["line"], c["reason"]) for c in out],
                         [(3, "fits no gate category"),
                          (4, "uses ${{ }} expressions: not reproducible outside CI")])
        self.assertEqual(INV.classify_ci_command("pnpm run lint"), "lint")

    def test_shared_extension_table_feeds_prescan_and_diff_guard(self) -> None:
        import diff_guard
        import prescan
        self.assertEqual(diff_guard.CODE_EXTENSIONS, C.CODE_EXTENSIONS)
        self.assertEqual(prescan.C_LIKE, C.extensions_with_comment_style("c"))
        self.assertEqual(prescan.HASH_STYLE, C.extensions_with_comment_style("hash"))
        for ext in diff_guard.CODE_EXTENSIONS:
            self.assertIsNotNone(C.EXTENSION_LANGUAGES.get(ext), ext)
            self.assertIsNotNone(prescan.comment_style("a" + ext), ext)
        self.assertEqual(C.EXTENSION_LANGUAGES[".ipynb"], "Jupyter Notebook")
        self.assertEqual(C.notebook_code_loc(self.NOTEBOOK.encode("utf-8")), 3)
        self.assertIsNone(C.notebook_code_loc(b"[1, 2]"))


class ScriptClassificationTests(unittest.TestCase):
    """Unit checks of package.json script classification."""

    def test_names_decide_before_bodies(self) -> None:
        self.assertEqual(INV.classify_script("lint", "tsc --noEmit && eslint ."), "lint")
        self.assertEqual(INV.classify_script("check", "tsc --noEmit"), "typecheck")
        self.assertEqual(INV.classify_script("verify", "vitest run"), "test")
        self.assertEqual(INV.classify_script("prettier:check", "prettier -c ."), "format_check")
        self.assertIsNone(INV.classify_script("format", "prettier --write ."))
        self.assertIsNone(INV.classify_script("test:update", "vitest -u"))
        self.assertIsNone(INV.classify_script("pretest", "echo", ["test", "pretest"]))
        # not a lifecycle hook when there is no "test" script: the body decides
        self.assertEqual(INV.classify_script("pretest", "vitest run", ["pretest"]), "test")
        self.assertEqual(INV.classify_script("build", "tsc"), "build")
        self.assertEqual(INV.classify_script("fmt:sol:check", "node x.mjs fmt --check"),
                         "format_check")
        self.assertEqual(INV.classify_script("check:format", "x"), "format_check")
        self.assertEqual(INV.classify_script("verify", "forge fmt --check"), "format_check")

    def test_pm_script_name(self) -> None:
        self.assertEqual(INV.pm_script_name("pnpm -r build"), "build")
        self.assertEqual(INV.pm_script_name("pnpm --filter web test"), "test")
        self.assertEqual(INV.pm_script_name("npm run lint -- --max-warnings 0"), "lint")
        self.assertEqual(INV.pm_script_name("yarn test"), "test")
        self.assertIsNone(INV.pm_script_name("pnpm install --frozen-lockfile"))
        self.assertIsNone(INV.pm_script_name("pnpm exec tsc"))
        self.assertIsNone(INV.pm_script_name("cargo test"))

    def test_step_working_directory(self) -> None:
        wf = ["jobs:", "  a:", "    steps:", "      - name: x",
              "        working-directory: pkg/a", "        run: |", "          make test",
              "      - run: make lint", "      - name: y", "        run: go vet ./...",
              "        working-directory: \"./svc/\""]
        self.assertEqual(INV.step_working_directory(wf, 5), "pkg/a")
        self.assertIsNone(INV.step_working_directory(wf, 7))
        self.assertEqual(INV.step_working_directory(wf, 9), "svc")


class HistoryTests(unittest.TestCase):
    """Git history statistics and the G104-F04 sufficiency gate."""

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="harden-hist-")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_rich_history_is_sufficient(self) -> None:
        repo = Path(self.tmp) / "rich"
        build_rich_history(repo)
        inv = INV.build_inventory(C.resolve_repo(repo))
        g = inv["git"]
        self.assertTrue(g["history_sufficient"], g["history_reasons"])
        crit = g["history_criteria"]
        self.assertGreaterEqual(crit["S1_filtered_commits"]["value"], 150)
        self.assertGreaterEqual(crit["S2_span_days"]["value"], 122)
        self.assertGreaterEqual(crit["S3_fix_commits"]["value"], 25)
        self.assertLess(crit["S4_bulk_churn_share"]["value"], 0.5)
        self.assertEqual(g["commits"], 170)
        self.assertEqual(g["first_commit_date"], "2023-11-14")
        self.assertEqual(g["span_days"], 200.0)
        self.assertEqual(g["bulk_commits"]["count"], 1)
        self.assertEqual(g["bulk_commits"]["commits"][0]["subject"], "initial import")
        self.assertEqual(g["authors"], 1)
        self.assertEqual(g["merge_commits"], 0)
        self.assertEqual(g["agent_trailer_commits"]["count"], 0)
        # every 4th of commits 1..169 is a fix, except k=60 which is the rename commit
        self.assertEqual(g["fix_commits"]["count"], 41)
        self.assertEqual(g["history_filtered_commits"], 169)  # the pure rename is not an event

    def test_small_history_fails_gate_with_reasons(self) -> None:
        repo = Path(self.tmp) / "small"
        b = RepoBuilder(repo)
        for k in range(5):
            b.commit("feat: step {}".format(k), BASE_TS + k * DAY,
                     files={"a.py": lines(5 + k, "a")})
        b.build()
        g = INV.build_inventory(C.resolve_repo(repo))["git"]
        self.assertFalse(g["history_sufficient"])
        joined = " ".join(g["history_reasons"])
        self.assertIn("S1 failed", joined)
        self.assertIn("S2 failed", joined)
        self.assertIn("S3 failed", joined)

    def test_agent_adoption_fails_s5(self) -> None:
        repo = Path(self.tmp) / "agent"
        build_rich_history(repo, agent_file_at=10)
        g = INV.build_inventory(C.resolve_repo(repo))["git"]
        self.assertFalse(g["history_sufficient"])
        self.assertTrue(any(r.startswith("S5 failed") for r in g["history_reasons"]),
                        g["history_reasons"])
        self.assertIn("CLAUDE.md", g["agent_adoption"]["marker"])

    def test_trailers_merges_authors_bulk(self) -> None:
        repo = Path(self.tmp) / "mixed"
        b = RepoBuilder(repo)
        b.commit("initial", BASE_TS, files={"a.ts": lines(3, "a"), "b.ts": lines(3, "b"),
                                            "c.ts": lines(3, "c"), "d.ts": lines(3, "d")})
        b.commit("feat: one\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>",
                 BASE_TS + DAY, files={"a.ts": lines(4, "a")})
        b.commit("fix: two\n\n\U0001F916 Generated with [Claude Code](https://claude.com/claude-code)",
                 BASE_TS + 2 * DAY, files={"b.ts": lines(4, "b")})
        b.commit("feat: branch work\n\nCo-authored-by: Copilot <copilot@github.com>",
                 BASE_TS + 3 * DAY, files={"c.ts": lines(4, "c")}, branch="feature",
                 start_from="main", author=("Other", "other@example.com"))
        # fast-import keeps the first parent's tree for a merge: list the merged file explicitly
        b.commit("Merge branch 'feature'", BASE_TS + 4 * DAY, merge_from="feature",
                 files={"c.ts": lines(4, "c")})
        b.commit("chore: prefix fixture bugfix", BASE_TS + 5 * DAY, files={"d.ts": lines(5, "d")})
        b.build()
        g = INV.build_inventory(C.resolve_repo(repo))["git"]
        self.assertEqual(g["merge_commits"], 1)
        self.assertEqual(g["first_parent_merges"], 1)
        self.assertEqual(g["commits"], 5)                       # first-parent incl. the merge
        self.assertEqual(g["commits_first_parent_no_merges"], 4)
        self.assertEqual(g["authors"], 2)
        tr = g["agent_trailer_commits"]
        self.assertEqual(tr["count"], 3)
        self.assertEqual(tr["by_agent"], {"claude": 2, "copilot": 1})
        # "prefix", "fixture" and "bugfix" are not fix labels (G104-F08 regex)
        self.assertEqual(g["fix_commits"]["count"], 1)
        self.assertIn("agent trailer", g["agent_adoption"]["marker"])
        # c.ts changed only on the merged branch: the first-parent merge carries it as one event
        self.assertEqual(g["first_parent_merges_counted"], 1)
        history = C.load_history(repo, lambda p: False)
        self.assertEqual(history.merge_mode, C.MERGES_AS_EVENTS)
        c_events = [e for e in history.events() if e.path == "c.ts"]
        subjects = {c.sha: c.subject for c in history.commits}
        self.assertEqual(sorted(subjects[e.sha] for e in c_events),
                         ["Merge branch 'feature'", "initial"])

    def test_rename_whitespace_and_ignore_revs(self) -> None:
        repo = Path(self.tmp) / "hist"
        b = RepoBuilder(repo)
        b.commit("add", BASE_TS, files={"src/a.ts": lines(10, "a"), "src/p.py": lines(4, "p")})
        b.commit("edit a", BASE_TS + DAY, files={"src/a.ts": lines(12, "a")})
        b.commit("rename", BASE_TS + 2 * DAY, renames=[("src/a.ts", "src/b.ts")])
        b.commit("edit b", BASE_TS + 3 * DAY, files={"src/b.ts": lines(13, "a")})
        b.commit("reindent ts", BASE_TS + 4 * DAY,
                 files={"src/b.ts": "".join("  " + ln + "\n" for ln in lines(13, "a").splitlines())})
        b.commit("reindent py", BASE_TS + 5 * DAY,
                 files={"src/p.py": "".join("    " + ln + "\n" for ln in lines(4, "p").splitlines())})
        b.commit("edit b again", BASE_TS + 6 * DAY, files={"src/b.ts": lines(14, "a")},
                 label="ignored")
        b.build()
        ignored_sha = run_git(repo, "rev-parse", "HEAD").strip()
        history = C.load_history(repo, lambda p: False)
        ts_events = [e for e in history.events() if e.path.endswith(".ts")]
        self.assertTrue(all(e.path == "src/b.ts" for e in ts_events))   # renames folded
        subjects = {c.sha: c.subject for c in history.commits}
        ts_subjects = sorted(subjects[e.sha] for e in ts_events)
        # the pure rename and the whitespace-only re-indent of a .ts file are not events
        self.assertEqual(ts_subjects, ["add", "edit a", "edit b", "edit b again"])
        py_subjects = sorted(subjects[e.sha] for e in history.events() if e.path == "src/p.py")
        self.assertEqual(py_subjects, ["add", "reindent py"])  # indentation matters in Python
        (repo / ".git-blame-ignore-revs").write_text(
            "# formatting\n\n{}\n".format(ignored_sha), encoding="utf-8")
        history2 = C.load_history(repo, lambda p: False)
        subjects2 = sorted(subjects[e.sha] for e in history2.events() if e.path == "src/b.ts")
        self.assertEqual(subjects2, ["add", "edit a", "edit b"])


class NonGitAndCliTests(unittest.TestCase):
    """Plain directories, directories nested in another repository, and the CLI."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-cli-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_plain_directory(self) -> None:
        d = self.tmp / "plain"
        write_files(d, {"a.py": "x = 1\n", "node_modules/m/index.js": "1\n"})
        inv = INV.build_inventory(C.resolve_repo(d))
        self.assertFalse(inv["git"]["is_repo"])
        self.assertFalse(inv["git"]["history_sufficient"])
        self.assertEqual(inv["languages"], {"Python": {"files": 1, "loc": 1}})
        self.assertIn("walk", inv["file_source"])

    def test_untracked_folder_inside_repo_is_plain(self) -> None:
        outer = make_fixture_repo(self.tmp / "outer", {"x.txt": "x\n"})
        inner = outer / "project"
        write_files(inner, {"main.py": "print(1)\n"})
        info = C.resolve_repo(inner)
        self.assertFalse(info.is_repo)
        self.assertEqual(info.root, inner.resolve())
        self.assertTrue(info.notes)
        sub = C.resolve_repo(outer)
        self.assertTrue(sub.is_repo)

    def test_cli_writes_inventory_and_excludes_run_dir(self) -> None:
        repo = make_fixture_repo(self.tmp / "cli", {"a.py": "x = 1\n"})
        proc = subprocess.run([sys.executable, str(SCRIPTS / "inventory.py"), "--repo", str(repo),
                               "--quiet"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        out = repo / ".harden" / "inventory.json"
        self.assertTrue(out.is_file())
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(data["schema_version"], 1)
        exclude = (repo / ".git" / "info" / "exclude").read_text(encoding="utf-8")
        self.assertIn("/.harden/", exclude)
        self.assertFalse((repo / ".gitignore").exists())
        status = run_git(repo, "status", "--porcelain")
        self.assertEqual(status.strip(), "")

    def test_cli_missing_directory(self) -> None:
        proc = subprocess.run([sys.executable, str(SCRIPTS / "inventory.py"), "--repo",
                               str(self.tmp / "nope")], stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE)
        self.assertEqual(proc.returncode, 2)


class CommonHelperTests(unittest.TestCase):
    """Glob dialect, windows, percentile and fix regex."""

    def test_glob_dialect(self) -> None:
        self.assertTrue(C.glob_match("tests/a.py", "**/tests/**"))
        self.assertTrue(C.glob_match("x/tests/a.py", "**/tests/**"))
        self.assertTrue(C.glob_match("tests/a.py", "tests/**"))
        self.assertFalse(C.glob_match("x/tests/a.py", "tests/**"))
        self.assertTrue(C.glob_match("a/b/test_x.py", "test_*.py"))
        self.assertFalse(C.glob_match("a/b/xtest_x.py", "test_*.py"))
        self.assertEqual(C.portable_globs("**/tests/**"), ["tests/**", "**/tests/**"])
        self.assertEqual(C.portable_globs("*.snap"), ["*.snap", "**/*.snap"])

    def test_parse_window(self) -> None:
        self.assertAlmostEqual(C.parse_window("12.months").days, 12 * 30.44)
        self.assertAlmostEqual(C.parse_window("90 days").days, 90)
        self.assertAlmostEqual(C.parse_window("2.years").days, 730.5)
        self.assertTrue(C.parse_window("all").unbounded)
        self.assertEqual(C.parse_window("2024-01-01").start_ts, 1704067200)
        with self.assertRaises(ValueError):
            C.parse_window("soon")

    def test_fallback_toml_reader(self) -> None:
        """The reader used on Python < 3.11 must see the keys inventory.py relies on."""
        py = C._fallback_toml(PYPROJECT)
        self.assertEqual(py["project"]["scripts"], {"pkg": "pkg.cli:main"})
        self.assertEqual(py["project"]["requires-python"], ">=3.11")
        self.assertIn("build-system", py)
        for key in ("ruff", "pytest", "mypy"):
            self.assertIn(key, py["tool"])
        self.assertIn("format", py["tool"]["ruff"])
        cargo = C._fallback_toml(CARGO)
        self.assertEqual(cargo["bin"][0]["path"], "src/main.rs")
        self.assertIn("clippy", cargo["lints"])
        foundry = C._fallback_toml(FOUNDRY)
        self.assertEqual(foundry["profile"]["default"]["libs"], ["lib"])

    def test_p99_and_fix_regex(self) -> None:
        self.assertEqual(C.p99_threshold([1] * 99 + [40]), 1)
        self.assertIsNone(C.p99_threshold([]))
        for msg in ("fix: x", "Fixes #3", "fixing tests", "two bugs", "hotfix", "Regression in y"):
            self.assertTrue(C.FIX_RE.search(msg), msg)
        for msg in ("prefix", "fixture", "bugfix", "debugger"):
            self.assertFalse(C.FIX_RE.search(msg), msg)


if __name__ == "__main__":
    unittest.main()
