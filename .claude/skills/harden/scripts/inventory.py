#!/usr/bin/env python3
"""Inventory a repository for a /harden run and write .harden/inventory.json.

Purpose
    Phase 0-1 fact sheet about the TARGET repository, built from tracked files only
    (`git ls-files`; a filesystem walk when the directory is not a git repository):
      - languages (files, non-blank LOC) by extension/file name, excluding generated/vendored code,
        from the extension table of _common.py; a Jupyter notebook (.ipynb, "Jupyter Notebook",
        read with lang-python) counts the non-blank lines of its code cells;
      - unmapped_extensions: every tracked extension with no language mapping ("(none)" for
        files without one), with file, non-blank line and binary-file counts (lockfiles and
        generated/vendored files excluded), and a note when those files hold more lines than
        all mapped languages together (reporting.md: each one is a Limits entry);
      - manifests, lockfiles, package managers, toolchain pins, project kind and entry points
        (library vs application decides how unused exports are treated, dead-code-tools T07-F12);
      - quality tools already configured, including config embedded in package.json,
        pyproject.toml and Cargo.toml (polyglot-tooling T25-F01: inventory first, run the
        project's own gates, never replace existing configs);
      - command candidates for build / typecheck / lint / test / format_check from package.json
        scripts (prefixed with the detected package manager), pyproject/pytest, Cargo, Foundry,
        Go, Makefile/justfile targets and CI `run:` steps (build-ci-infra G107-F03: CI should
        run the same entry points), with masking constructs flagged (G107-F01); CI commands
        that are neither setup steps nor classifiable go to unclassified_ci_commands;
      - test globs actually present, suggested protected globs, generated/vendored paths
        (.gitattributes linguist-*, submodules, Foundry libs, build/vendor dirs, @generated
        headers), CI files, docs, agent context files, size;
      - git history statistics and the history-sufficiency verdict of hotspot-evidence
        G104-F04 computed after the G104-F06/F07/F09 noise filters (first-parent history,
        rename folding, whitespace-only edits dropped, blame-ignored revisions and
        generated/vendored/lock/snapshot paths excluded, bulk commits above the repo's own
        99th percentile of files touched). First-parent merge commits count as one change event
        per file, like squash commits (G104-F09), because the literal `--no-merges` recipe drops
        all branch work in merge-commit workflows; `git.history_filters` records the mode used.
        All thresholds are dossier conventions (grade C), not validated facts.

CLI
    python inventory.py [--repo DIR] [--out FILE] [--json] [--quiet]
    (use python3 on macOS/Linux)
    --repo   repository or project directory (default: current directory)
    --out    output path (default: <repo>/.harden/inventory.json; .harden/ is excluded from git
             through .git/info/exclude, never through .gitignore)
    --json   print the inventory JSON to stdout instead of the human summary
    --quiet  print nothing on success

Exit codes
    0  inventory written
    2  usage or environment error (directory missing, unreadable, git failure)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as C  # noqa: E402

MAX_READ_BYTES = 20 * 1024 * 1024       # files larger than this are not read for LOC
HEADER_READ_BYTES = 4096
MAX_LIST = 500                          # cap for long path lists in the JSON

CATEGORIES = ("build", "typecheck", "lint", "test", "format_check")

# ---------------------------------------------------------------------------
# File scan
# ---------------------------------------------------------------------------


@dataclass
class FileInfo:
    """Classification of one tracked file."""
    path: str
    language: Optional[str]
    loc: Optional[int]
    is_test: bool
    is_doc: bool
    is_snapshot: bool
    lock_manager: Optional[str]
    generated_reason: Optional[str]
    generated_prefix: Optional[str]
    binary: bool = False

    @property
    def is_generated(self) -> bool:
        return self.generated_reason is not None

    @property
    def is_source(self) -> bool:
        """Program source that is not test, doc, lockfile or generated/vendored code."""
        return (C.is_source_language(self.language) and not self.is_test and not self.is_doc
                and self.lock_manager is None and not self.is_generated
                and not self.is_snapshot and self.loc is not None)


def vendor_prefixes(repo: Path, files: Sequence[str]) -> Dict[str, str]:
    """Directory prefixes known to hold third-party code: git submodules and Foundry `libs`."""
    prefixes: Dict[str, str] = {}
    for sub in C.parse_gitmodules(repo):
        prefixes[sub] = "git submodule " + sub
    for f in files:
        if f.rsplit("/", 1)[-1] != "foundry.toml":
            continue
        data, _err = C.load_toml(repo / f)
        base = f.rsplit("/", 1)[0] + "/" if "/" in f else ""
        libs: List[str] = ["lib"]
        if isinstance(data, dict):
            prof = data.get("profile", {})
            default = prof.get("default", {}) if isinstance(prof, dict) else {}
            if isinstance(default, dict) and isinstance(default.get("libs"), list):
                libs = [str(x) for x in default["libs"]]
        for lib in libs:
            rel = C.to_posix(lib).strip("/")
            while rel.startswith("./"):
                rel = rel[2:]
            if not rel or rel.startswith("../"):
                continue
            pre = base + rel + "/"
            prefixes.setdefault(pre, "Foundry dependency directory (foundry.toml libs) " + pre)
    return prefixes


def scan_files(repo: Path, files: Sequence[str], is_repo: bool) -> List[FileInfo]:
    """Classify every file and count non-blank LOC (for a notebook, of its code cells).

    Files with no language mapping are read too (binary ones only up to their first 8 KiB), so
    unmapped_extensions can say how much of the repository no language reference covers."""
    vprefixes = vendor_prefixes(repo, files)
    vlist = sorted(vprefixes)
    attrs = C.linguist_attributes(repo, files) if is_repo else {}
    infos: List[FileInfo] = []
    for f in files:
        lang = C.language_of(f)
        reason = C.path_generated_reason(f, vlist)
        prefix = C.generated_dir_prefix(f, vlist) if reason else None
        if reason and prefix in vprefixes:
            reason = vprefixes[prefix]
        if reason is None and f in attrs:
            reason = attrs[f]
        loc: Optional[int] = None
        binary = False
        full = repo / f
        if prefix is None and (lang is not None or C.lockfile_manager(f) is None):
            try:
                size = full.stat().st_size
            except OSError:
                size = -1
            if 0 <= size <= MAX_READ_BYTES:
                try:
                    with open(full, "rb") as handle:
                        data = handle.read(8192)
                        if lang is not None or b"\0" not in data:
                            data += handle.read()
                except OSError:
                    data = b""
                loc = C.count_loc(data, f)
                binary = loc is None and bool(data)
                if lang is not None and reason is None and loc is not None and \
                        C.header_has_generated_marker(data[:HEADER_READ_BYTES].decode(
                            "utf-8", errors="replace")):
                    reason = "generated-code marker in file header"
        infos.append(FileInfo(
            path=f, language=lang, loc=loc, is_test=C.is_test_path(f), is_doc=C.is_doc_path(f),
            is_snapshot=C.is_snapshot_path(f), lock_manager=C.lockfile_manager(f),
            generated_reason=reason, generated_prefix=prefix, binary=binary))
    return infos


def unmapped_extensions(infos: Sequence[FileInfo]) -> Dict[str, Dict[str, int]]:
    """Tracked files with no language mapping, per extension ("(none)" without one): file
    count, non-blank lines and binary files. Generated/vendored files and lockfiles are
    counted elsewhere and left out."""
    out: Dict[str, Dict[str, int]] = {}
    for info in infos:
        if info.language is not None or info.is_generated or info.lock_manager is not None:
            continue
        ext = C.file_extension(info.path) or "(none)"
        entry = out.setdefault(ext, {"files": 0, "loc": 0, "binary_files": 0})
        entry["files"] += 1
        entry["loc"] += info.loc or 0
        if info.binary:
            entry["binary_files"] += 1
    return dict(sorted(out.items(), key=lambda kv: (-kv[1]["loc"], -kv[1]["files"], kv[0])))


# ---------------------------------------------------------------------------
# Manifests, package managers, tools
# ---------------------------------------------------------------------------

MANIFEST_KINDS: Dict[str, str] = {
    "package.json": "npm-package", "pyproject.toml": "pyproject", "setup.py": "setuptools",
    "setup.cfg": "setuptools", "pipfile": "pipenv", "cargo.toml": "cargo", "go.mod": "go-module",
    "go.work": "go-workspace", "foundry.toml": "foundry", "pom.xml": "maven",
    "build.gradle": "gradle", "build.gradle.kts": "gradle", "settings.gradle": "gradle",
    "settings.gradle.kts": "gradle", "gemfile": "bundler", "composer.json": "composer",
    "package.swift": "swiftpm", "cmakelists.txt": "cmake", "meson.build": "meson",
    "makefile": "make", "gnumakefile": "make", "justfile": "just", "taskfile.yml": "task",
    "taskfile.yaml": "task", "pnpm-workspace.yaml": "pnpm-workspace", "lerna.json": "lerna",
    "nx.json": "nx", "turbo.json": "turbo", "deno.json": "deno", "deno.jsonc": "deno",
    "environment.yml": "conda", "environment.yaml": "conda",
}
MANIFEST_PATTERNS: List[Tuple["re.Pattern[str]", str]] = [
    (re.compile(r"^requirements.*\.(txt|in)$", re.I), "pip-requirements"),
    (re.compile(r"^hardhat\.config\.(js|ts|cjs|mjs)$"), "hardhat"),
    (re.compile(r".+\.(csproj|fsproj|vbproj|sln)$"), "dotnet"),
]


def manifest_kind(path: str) -> Optional[str]:
    """Manifest kind for a path, or None."""
    base = path.rsplit("/", 1)[-1]
    kind = MANIFEST_KINDS.get(base.lower())
    if kind:
        return kind
    for rx, k in MANIFEST_PATTERNS:
        if rx.match(base):
            return k
    return None


# (tool, regex on the file name, optional regex on the full path)
TOOL_FILES: List[Tuple[str, str]] = [
    ("eslint", r"^eslint\.config\.(js|mjs|cjs|ts|mts|cts)$|^\.eslintrc(\.(js|cjs|yaml|yml|json))?$"),
    ("biome", r"^biome\.jsonc?$"),
    ("prettier", r"^\.prettierrc(\.(json|json5|yaml|yml|toml|js|cjs|mjs|ts))?$"
                 r"|^prettier\.config\.(js|cjs|mjs|ts)$"),
    ("tsconfig", r"^tsconfig(\..+)?\.json$"),
    ("ruff", r"^\.?ruff\.toml$"),
    ("mypy", r"^\.?mypy\.ini$"),
    ("pyright", r"^pyrightconfig\.json$"),
    ("clippy", r"^\.?clippy\.toml$"),
    ("rustfmt", r"^\.?rustfmt\.toml$"),
    ("golangci-lint", r"^\.golangci\.(yml|yaml|toml|json)$"),
    ("knip", r"^\.?knip\.jsonc?$|^knip\.(ts|js|mjs|cjs|mts|cts)$|^knip\.config\.(ts|js|mjs|cjs)$"),
    ("jscpd", r"^\.jscpd\.json$"),
    ("semgrep", r"^\.?semgrep\.ya?ml$"),
    ("pre-commit", r"^\.pre-commit-config\.ya?ml$"),
    ("stryker", r"^\.?stryker\.(conf|config)\.(json|js|mjs|cjs|ts)$"),
    ("vitest", r"^vitest\.(config|workspace)\.(ts|js|mjs|cjs|mts|cts)$"),
    ("jest", r"^jest\.config\.(js|ts|mjs|cjs|json)$"),
    ("pytest", r"^pytest\.ini$|^conftest\.py$"),
    ("clang-tidy", r"^\.clang-tidy$"),
    ("clang-format", r"^[._]clang-format$"),
    ("slither", r"^slither\.config\.json$"),
    ("foundry", r"^foundry\.toml$"),
    ("hadolint", r"^\.hadolint\.ya?ml$"),
    ("editorconfig", r"^\.editorconfig$"),
    ("lefthook", r"^\.?lefthook\.ya?ml$"),
]
TOOL_FILE_RES = [(tool, re.compile(rx)) for tool, rx in TOOL_FILES]
TOOL_PATH_RES: List[Tuple[str, "re.Pattern[str]"]] = [
    ("actionlint", re.compile(r"(^|/)\.github/actionlint\.ya?ml$")),
    ("semgrep", re.compile(r"(^|/)\.semgrep/.+\.ya?ml$")),
    ("husky", re.compile(r"(^|/)\.husky/[^/]+$")),
]

# pyproject.toml [tool.<key>] -> tool name
PYPROJECT_TOOLS = {"ruff": "ruff", "black": "black", "mypy": "mypy", "pyright": "pyright",
                   "basedpyright": "basedpyright", "pytest": "pytest", "isort": "isort",
                   "coverage": "coverage", "pylint": "pylint"}
# package.json top-level keys holding tool config
PACKAGE_JSON_TOOLS = {"eslintConfig": "eslint", "prettier": "prettier", "jest": "jest",
                      "knip": "knip", "jscpd": "jscpd", "stryker": "stryker",
                      "lint-staged": "lint-staged"}
# devDependencies / dependencies that identify a test runner or checker (evidence: dependency)
JS_DEP_TOOLS = {"vitest": "vitest", "jest": "jest", "eslint": "eslint", "@biomejs/biome": "biome",
                "prettier": "prettier", "typescript": "typescript", "knip": "knip",
                "jscpd": "jscpd", "@stryker-mutator/core": "stryker", "husky": "husky"}


def read_package_json(repo: Path, path: str, notes: List[str]) -> Optional[Dict[str, Any]]:
    """Parse a package.json; record a note on failure."""
    try:
        data = json.loads(C.read_text(repo / path).lstrip("\ufeff"))  # BOM-tolerant
    except (OSError, ValueError) as exc:
        notes.append("could not parse {}: {}".format(path, exc))
        return None
    return data if isinstance(data, dict) else None


def dir_of(path: str) -> str:
    """Directory part of a repo-relative path ('.' for the root)."""
    return path.rsplit("/", 1)[0] if "/" in path else "."


def join_rel(directory: str, name: str) -> str:
    """Join a repo-relative directory ('.' = root) and a file name."""
    return name if directory in (".", "") else directory + "/" + name


def _dep_names(pkg: Dict[str, Any]) -> Set[str]:
    names: Set[str] = set()
    for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        val = pkg.get(key)
        if isinstance(val, dict):
            names.update(str(k) for k in val)
    return names


def detect_tools(repo: Path, files: Sequence[str], pkgs: Dict[str, Dict[str, Any]],
                 pyprojects: Dict[str, Dict[str, Any]], cargos: Dict[str, Dict[str, Any]],
                 ) -> List[Dict[str, str]]:
    """Quality tools configured in the repository (config files, embedded config, dependencies)."""
    found: List[Dict[str, str]] = []
    seen: Set[Tuple[str, str]] = set()

    def add(tool: str, file: str, where: str, evidence: str) -> None:
        config_path = file if not where else "{} {}".format(file, where)
        key = (tool, config_path)
        if key not in seen:
            seen.add(key)
            found.append({"tool": tool, "config_path": config_path, "file": file,
                          "evidence": evidence})

    for f in files:
        base = f.rsplit("/", 1)[-1]
        for tool, rx in TOOL_FILE_RES:
            if rx.match(base):
                add(tool, f, "", "config-file")
        for tool, rx in TOOL_PATH_RES:
            if rx.search(f):
                add(tool, f, "", "config-file")
        low = base.lower()
        if low in ("setup.cfg", "tox.ini"):
            secs = C.ini_sections(repo / f)
            if "mypy" in secs or any(s.startswith("mypy-") for s in secs):
                add("mypy", f, "[mypy]", "embedded-config")
            if "tool:pytest" in secs or "pytest" in secs:
                add("pytest", f, "[pytest]", "embedded-config")
            if "flake8" in secs:
                add("flake8", f, "[flake8]", "embedded-config")
    for path, pkg in pkgs.items():
        for key, tool in PACKAGE_JSON_TOOLS.items():
            if key in pkg:
                add(tool, path, "({})".format(key), "embedded-config")
        deps = _dep_names(pkg)
        for dep, tool in JS_DEP_TOOLS.items():
            if dep in deps:
                add(tool, path, "(dependency {})".format(dep), "dependency")
    for path, data in pyprojects.items():
        tool_tab = data.get("tool", {}) if isinstance(data.get("tool"), dict) else {}
        for key, tool in PYPROJECT_TOOLS.items():
            if key in tool_tab:
                add(tool, path, "[tool.{}]".format(key), "embedded-config")
    for path, data in cargos.items():
        lints = data.get("lints", {})
        ws = data.get("workspace", {})
        ws_lints = ws.get("lints", {}) if isinstance(ws, dict) else {}
        if isinstance(lints, dict) and "clippy" in lints:
            add("clippy", path, "[lints.clippy]", "embedded-config")
        if isinstance(ws_lints, dict) and "clippy" in ws_lints:
            add("clippy", path, "[workspace.lints.clippy]", "embedded-config")
    return found


def js_package_manager(repo: Path, pkg_path: str, pkgs: Dict[str, Dict[str, Any]],
                       lock_paths: Sequence[str]) -> Tuple[str, str]:
    """(package manager, evidence) for a package.json: packageManager field, then the nearest
    lockfile in its directory or an ancestor, then npm by default."""
    directory = dir_of(pkg_path)
    chain: List[str] = []
    d = directory
    while True:
        chain.append(d)
        if d in (".", ""):
            break
        d = dir_of(d)
    for d in chain:
        pkg = pkgs.get(join_rel(d, "package.json"))
        pm_field = pkg.get("packageManager") if isinstance(pkg, dict) else None
        if isinstance(pm_field, str) and "@" in pm_field:
            name = pm_field.split("@", 1)[0].strip()
            if name in ("npm", "pnpm", "yarn", "bun"):
                return name, "{} packageManager {}".format(join_rel(d, "package.json"), pm_field)
        for lock in ("pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "package-lock.json",
                     "npm-shrinkwrap.json"):
            cand = join_rel(d, lock)
            if cand in lock_paths:
                return C.LOCKFILE_MANAGERS[lock], cand
    return "npm", "default (no packageManager field or JS lockfile)"


def detect_package_managers(files: Sequence[str], pkgs: Dict[str, Dict[str, Any]],
                            pyprojects: Dict[str, Dict[str, Any]], lock_paths: Sequence[str],
                            manifests: Sequence[Dict[str, str]], repo: Path,
                            ) -> List[Dict[str, Any]]:
    """Package managers with the evidence for each."""
    result: Dict[str, Dict[str, Any]] = {}

    def add(name: str, ecosystem: str, evidence: str) -> None:
        entry = result.setdefault(name, {"name": name, "ecosystem": ecosystem, "evidence": []})
        if evidence not in entry["evidence"]:
            entry["evidence"].append(evidence)

    for pkg_path in pkgs:
        pm, ev = js_package_manager(repo, pkg_path, pkgs, lock_paths)
        add(pm, "javascript", ev)
    for lock in lock_paths:
        mgr = C.lockfile_manager(lock)
        eco = {"npm": "javascript", "pnpm": "javascript", "yarn": "javascript", "bun": "javascript",
               "deno": "javascript", "cargo": "rust", "poetry": "python", "uv": "python",
               "pipenv": "python", "pdm": "python", "go": "go", "bundler": "ruby",
               "composer": "php", "nuget": "dotnet", "gradle": "jvm", "swiftpm": "swift"
               }.get(mgr or "", "other")
        if mgr and mgr != "unknown":
            add(mgr, eco, lock)
    for path, data in pyprojects.items():
        tool = data.get("tool", {}) if isinstance(data.get("tool"), dict) else {}
        for key, name in (("poetry", "poetry"), ("uv", "uv"), ("pdm", "pdm"), ("hatch", "hatch")):
            if key in tool:
                add(name, "python", "{} [tool.{}]".format(path, key))
    for m in manifests:
        kind, path = m["kind"], m["path"]
        simple = {"pip-requirements": ("pip", "python"), "setuptools": ("pip", "python"),
                  "cargo": ("cargo", "rust"), "go-module": ("go", "go"),
                  "foundry": ("forge", "solidity"), "maven": ("maven", "jvm"),
                  "gradle": ("gradle", "jvm"), "bundler": ("bundler", "ruby"),
                  "composer": ("composer", "php"), "swiftpm": ("swiftpm", "swift"),
                  "dotnet": ("dotnet", "dotnet"), "pipenv": ("pipenv", "python")}
        if kind in simple:
            add(simple[kind][0], simple[kind][1], path)
        if kind == "pyproject" and not any(e["ecosystem"] == "python" and e["name"] != "pip"
                                           for e in result.values()):
            add("pip", "python", path + " (no uv/poetry/pdm/pipenv evidence)")
    return sorted(result.values(), key=lambda e: (e["ecosystem"], e["name"]))


# ---------------------------------------------------------------------------
# Command candidates
# ---------------------------------------------------------------------------

# Masking constructs (build-ci-infra G107-F01 detect regex, transcribed; shared with gates.py).
MASKING_RE = C.MASKING_RE
WRITE_FLAGS_RE = re.compile(r"(^|\s)(--fix|--write|-u|--updateSnapshot|--update-snapshots?|"
                            r"--watch|--watchAll)(\s|=|$)")
SKIP_SCRIPT_NAME_RE = re.compile(r"(^|:)(watch|dev|start|serve|preview|fix|write|update|u|clean|"
                                 r"release|publish|deploy|prepare|postinstall|preinstall)(:|$)")


def masking_in(text: str) -> List[str]:
    """Masking constructs present in a command or script body."""
    found = [m.group(0) for m in MASKING_RE.finditer(text)]
    if re.search(r"\s;\s", text):
        found.append("; (chained command: only the last exit status counts)")
    return found


FORMAT_CHECK_NAMES = {"format:check", "fmt:check", "prettier:check", "check-format",
                      "format-check", "check:format", "lint:format", "format:ci", "fmt-check"}
FORMAT_CHECK_NAME_RE = re.compile(r"^(fmt|format|prettier)(:[\w.-]+)*[:-]check$"
                                  r"|^check[:-](fmt|format)$")
TYPECHECK_NAMES = {"typecheck", "type-check", "types", "check-types", "check:types", "types:check",
                   "tsc", "type:check"}


def classify_script(name: str, body: str, all_names: Iterable[str] = ()) -> Optional[str]:
    """Category of a package.json script (None when it is not a gate).

    The script name decides first; the body is only used for names that say nothing
    ("check", "verify", "ci"...). Scripts that watch, write, fix or update snapshots are never
    gates, and npm lifecycle hooks (`pre<name>` / `post<name>` of another script) are skipped
    because `<pm> run <name>` already runs them.
    """
    n = name.lower()
    names = {x.lower() for x in all_names}
    for hook in ("pre", "post"):
        if n.startswith(hook) and n[len(hook):] in names:
            return None
    if SKIP_SCRIPT_NAME_RE.search(n) or WRITE_FLAGS_RE.search(body):
        return None
    stripped = body.strip()
    if n in FORMAT_CHECK_NAMES or FORMAT_CHECK_NAME_RE.match(n):
        return "format_check"
    if n in TYPECHECK_NAMES or n.startswith("typecheck:"):
        return "typecheck"
    if n == "lint" or n.startswith("lint:"):
        return "lint"
    if n in ("test", "tests", "unit", "e2e", "coverage") or n.startswith("test:"):
        return "test"
    if n in ("build", "compile") or n.startswith("build:"):
        return "build"
    if re.search(r"\bprettier\b.*(--check|\s-c\b)|\bdprint check\b|\bbiome format\b(?!.*--write)"
                 r"|\b(forge|cargo) fmt\b.*--check|\bruff format\b.*--check|\bblack\b.*--check",
                 body):
        return "format_check"
    if re.search(r"\b(vue-)?tsc\b.*--noEmit", body):
        return "typecheck"
    if re.match(r"^(npx\s+)?(eslint|biome (lint|check|ci)|oxlint)\b", stripped):
        return "lint"
    if re.match(r"^(npx\s+)?(vitest|jest|mocha|ava|node --test)\b", stripped):
        return "test"
    return None


def js_candidates(repo: Path, pkgs: Dict[str, Dict[str, Any]], lock_paths: Sequence[str],
                  is_generated: Any) -> Dict[str, List[Dict[str, Any]]]:
    """Candidates from package.json scripts, prefixed with the detected package manager."""
    out: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CATEGORIES}
    ordered = sorted(pkgs, key=lambda p: (p.count("/"), p))
    for pkg_path in ordered:
        if is_generated(pkg_path):
            continue
        scripts = pkgs[pkg_path].get("scripts")
        if not isinstance(scripts, dict):
            continue
        pm, pm_ev = js_package_manager(repo, pkg_path, pkgs, lock_paths)
        cwd = dir_of(pkg_path)
        items = []
        for name, body in scripts.items():
            if not isinstance(body, str):
                continue
            cat = classify_script(str(name), body, [str(k) for k in scripts])
            if cat is None:
                continue
            exact = str(name) in ("test", "lint", "build", "typecheck", "format:check")
            items.append((0 if exact else 1, str(name), cat, body))
        for _prio, name, cat, body in sorted(items):
            cand: Dict[str, Any] = {
                "cmd": "{} run {}".format(pm, name), "cwd": cwd,
                "source": "{} scripts.{}".format(pkg_path, name), "script": body,
                "package_manager": pm, "package_manager_evidence": pm_ev}
            warnings = ["masking construct: " + m for m in masking_in(body)]
            if warnings:
                cand["warnings"] = warnings
            out[cat].append(cand)
    return out


def python_runner(directory: str, files_set: Set[str], pyproject: Optional[Dict[str, Any]]
                  ) -> Tuple[str, str]:
    """(command prefix, evidence) used to run Python tools in a project directory."""
    tool = pyproject.get("tool", {}) if isinstance(pyproject, dict) else {}
    tool = tool if isinstance(tool, dict) else {}
    checks = [("uv.lock", "uv run "), ("poetry.lock", "poetry run "), ("pdm.lock", "pdm run "),
              ("Pipfile.lock", "pipenv run "), ("Pipfile", "pipenv run ")]
    for name, prefix in checks:
        if join_rel(directory, name) in files_set:
            return prefix, join_rel(directory, name)
    for key, prefix in (("uv", "uv run "), ("poetry", "poetry run "), ("pdm", "pdm run ")):
        if key in tool:
            return prefix, "[tool.{}]".format(key)
    return "", "no uv/poetry/pdm/pipenv evidence"


def python_candidates(repo: Path, files: Sequence[str], pyprojects: Dict[str, Dict[str, Any]],
                      tools: Sequence[Dict[str, str]], infos: Sequence[FileInfo]
                      ) -> Dict[str, List[Dict[str, Any]]]:
    """Candidates for Python projects (pytest, ruff, mypy, pyright, black)."""
    out: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CATEGORIES}
    files_set = set(files)
    py_dirs: List[str] = sorted({dir_of(p) for p in pyprojects}, key=lambda d: (d.count("/"), d))
    has_py_tests = any(i.language == "Python" and i.is_test and not i.is_generated for i in infos)
    has_py = any(i.language == "Python" and not i.is_generated for i in infos)
    if not py_dirs and has_py and any(f.rsplit("/", 1)[-1].lower().startswith("requirements")
                                      or f in ("setup.py", "setup.cfg") for f in files):
        py_dirs = ["."]
    tool_names = {t["tool"] for t in tools}
    py = C.default_python_command()
    for d in py_dirs:
        pyproject = pyprojects.get(join_rel(d, "pyproject.toml"))
        prefix, ev = python_runner(d, files_set, pyproject)
        tool_tab = pyproject.get("tool", {}) if isinstance(pyproject, dict) else {}
        tool_tab = tool_tab if isinstance(tool_tab, dict) else {}
        src = join_rel(d, "pyproject.toml") if pyproject is not None else d

        def mod(name: str) -> str:
            return "{}{}".format(prefix, name) if prefix else "{} -m {}".format(py, name)

        base = {"cwd": d, "runner_evidence": ev}
        if "pytest" in tool_names or "pytest" in tool_tab:
            out["test"].append(dict(base, cmd=mod("pytest"), source=src + " (pytest configured)"))
        elif has_py_tests:
            out["test"].append(dict(base, cmd=mod("pytest"),
                                    source="Python test files present (pytest not configured)",
                                    warnings=["pytest is not configured; confirm the runner"]))
            out["test"].append(dict(base, cmd="{} -m unittest discover".format(py),
                                    source="Python test files present (stdlib unittest)"))
        if "ruff" in tool_names:
            out["lint"].append(dict(base, cmd=mod("ruff") + " check .",
                                    source=src + " (ruff configured)"))
            ruff_tab = tool_tab.get("ruff", {}) if isinstance(tool_tab.get("ruff"), dict) else {}
            if "format" in ruff_tab:
                out["format_check"].append(dict(base, cmd=mod("ruff") + " format --check .",
                                                source=src + " [tool.ruff.format]"))
        if "flake8" in tool_names:
            out["lint"].append(dict(base, cmd=mod("flake8"), source="flake8 configured"))
        if "black" in tool_names:
            out["format_check"].append(dict(base, cmd=mod("black") + " --check .",
                                            source=src + " [tool.black]"))
        if "mypy" in tool_names:
            mypy_tab = tool_tab.get("mypy", {}) if isinstance(tool_tab.get("mypy"), dict) else {}
            cmd = mod("mypy") if "files" in mypy_tab else mod("mypy") + " ."
            out["typecheck"].append(dict(base, cmd=cmd, source=src + " (mypy configured)"))
        if "basedpyright" in tool_names:
            out["typecheck"].append(dict(base, cmd=prefix + "basedpyright",
                                         source="basedpyright configured"))
        elif "pyright" in tool_names:
            out["typecheck"].append(dict(base, cmd=prefix + "pyright",
                                         source="pyright configured"))
    return out


def top_level_manifests(paths: Iterable[str]) -> List[str]:
    """Manifests not nested under the directory of another manifest of the same name."""
    ps = sorted(paths, key=lambda p: (p.count("/"), p))
    kept: List[str] = []
    for p in ps:
        d = dir_of(p)
        if not any(d == dir_of(k) or (dir_of(k) == "." or d.startswith(dir_of(k) + "/"))
                   for k in kept):
            kept.append(p)
    return kept


def ci_mentions(ci_text: str, pattern: str) -> bool:
    """True when the CI configuration mentions a command pattern."""
    return bool(re.search(pattern, ci_text))


def toolchain_candidates(files: Sequence[str], cargos: Dict[str, Dict[str, Any]],
                         foundries: Dict[str, Dict[str, Any]], tools: Sequence[Dict[str, str]],
                         ci_text: str) -> Dict[str, List[Dict[str, Any]]]:
    """Candidates for Cargo, Foundry and Go projects (toolchain-bundled commands, T25-F02)."""
    out: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CATEGORIES}
    tool_names = {t["tool"] for t in tools}
    for cargo in top_level_manifests(cargos):
        d = dir_of(cargo)
        base = {"cwd": d}
        out["build"].append(dict(base, cmd="cargo build", source=cargo))
        out["typecheck"].append(dict(base, cmd="cargo check", source=cargo))
        out["test"].append(dict(base, cmd="cargo test", source=cargo))
        lint = dict(base, cmd="cargo clippy", source=cargo)
        if "clippy" not in tool_names:
            lint["warnings"] = ["clippy is bundled with the toolchain but not configured by the "
                                "project"]
        out["lint"].append(lint)
        fmt = dict(base, cmd="cargo fmt --check", source=cargo)
        if "rustfmt" not in tool_names and not ci_mentions(ci_text, r"cargo fmt"):
            fmt["warnings"] = ["the project does not configure rustfmt and CI does not run it; "
                               "confirm formatting is enforced before using this as a gate"]
        out["format_check"].append(fmt)
    for foundry in top_level_manifests(foundries):
        d = dir_of(foundry)
        base = {"cwd": d}
        out["build"].append(dict(base, cmd="forge build", source=foundry))
        out["test"].append(dict(base, cmd="forge test", source=foundry))
        data = foundries[foundry]
        fmt = dict(base, cmd="forge fmt --check", source=foundry)
        if not (isinstance(data, dict) and "fmt" in data) and \
                not ci_mentions(ci_text, r"forge fmt"):
            fmt["warnings"] = ["foundry.toml has no [fmt] section and CI does not run forge fmt; "
                               "confirm formatting is enforced before using this as a gate"]
        out["format_check"].append(fmt)
    # Every go.mod: `./...` stops at nested module boundaries, so each module is its own gate.
    gomods = sorted(f for f in files if f.rsplit("/", 1)[-1] == "go.mod"
                    and C.path_generated_reason(f) is None)
    for gomod in gomods:
        d = dir_of(gomod)
        base = {"cwd": d}
        out["build"].append(dict(base, cmd="go build ./...", source=gomod))
        out["test"].append(dict(base, cmd="go test ./...", source=gomod))
        out["lint"].append(dict(base, cmd="go vet ./...", source=gomod + " (toolchain vet)"))
        if "golangci-lint" in tool_names:
            out["lint"].append(dict(base, cmd="golangci-lint run", source="golangci-lint config"))
    return out


MAKE_TARGET_RE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9_.\-/]*)\s*:(?![=:])(.*)$")
JUST_RECIPE_RE = re.compile(r"^@?([A-Za-z0-9_][A-Za-z0-9_\-]*)(\s+[^:=]*)?:(?!=)(.*)$")
TARGET_CATEGORIES: Dict[str, str] = {
    "build": "build", "all": "build", "compile": "build",
    "test": "test", "tests": "test", "check": "test", "unit": "test", "test-unit": "test",
    "unittest": "test", "test-all": "test",
    "lint": "lint", "vet": "lint",
    "typecheck": "typecheck", "type-check": "typecheck", "types": "typecheck",
    "mypy": "typecheck",
    "fmt-check": "format_check", "format-check": "format_check", "check-format": "format_check",
    "fmtcheck": "format_check", "format_check": "format_check", "fmt_check": "format_check",
    "lint-format": "format_check",
}


def parse_make_like(text: str, just: bool) -> List[Tuple[str, int, List[str]]]:
    """Targets of a Makefile or justfile: (name, line number, recipe lines)."""
    targets: List[Tuple[str, int, List[str]]] = []
    lines = text.splitlines()
    rx = JUST_RECIPE_RE if just else MAKE_TARGET_RE
    i = 0
    while i < len(lines):
        line = lines[i]
        m = rx.match(line) if line and not line[0].isspace() else None
        if m and not line.startswith((".", "#")) and "%" not in m.group(1) \
                and not (just and m.group(1) in ("set", "export", "alias", "import", "mod")):
            recipe: List[str] = []
            j = i + 1
            while j < len(lines) and (lines[j].startswith(("\t", " ")) or not lines[j].strip()):
                if lines[j].strip():
                    recipe.append(lines[j].strip())
                j += 1
            targets.append((m.group(1), i + 1, recipe))
            i = j
            continue
        i += 1
    return targets


def make_candidates(repo: Path, files: Sequence[str], is_generated: Any
                    ) -> Tuple[Dict[str, List[Dict[str, Any]]], List[Dict[str, Any]]]:
    """Candidates from Makefile targets and justfile recipes, plus masking constructs in recipes."""
    out: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CATEGORIES}
    masking: List[Dict[str, Any]] = []
    for f in files:
        base = f.rsplit("/", 1)[-1]
        low = base.lower()
        if low not in ("makefile", "gnumakefile", "justfile") or is_generated(f):
            continue
        just = low == "justfile"
        try:
            text = C.read_text(repo / f)
        except OSError:
            continue
        runner = "just" if just else "make"
        for name, lineno, recipe in parse_make_like(text, just):
            cat = TARGET_CATEGORIES.get(name.lower())
            body = "\n".join(recipe)
            for m in masking_in(body):
                masking.append({"path": f, "line": lineno, "construct": m,
                                "text": "{}: {}".format(name, body[:200])})
            if not cat:
                continue
            cand: Dict[str, Any] = {"cmd": "{} {}".format(runner, name), "cwd": dir_of(f),
                                    "source": "{}:{} target {}".format(f, lineno, name)}
            warnings = ["masking construct in recipe: " + m for m in masking_in(body)]
            if name.lower() == "check":
                warnings.append("target 'check' may run tests, lint or both; read the recipe")
            if warnings:
                cand["warnings"] = warnings
            out[cat].append(cand)
    return out, masking


# Tool invocations in CI steps (JS package-manager scripts are handled by pm_script_name).
CI_PATTERNS: List[Tuple[str, "re.Pattern[str]"]] = [
    ("format_check", re.compile(
        r"prettier\b.*--check|ruff format\b.*--check|\bblack\b.*--check|cargo fmt\b.*--check"
        r"|forge fmt\b.*--check")),
    ("typecheck", re.compile(
        r"(^|\s)(npx |pnpm exec |pnpm dlx )?(vue-)?tsc\b|\bmypy\b|\b(based)?pyright\b"
        r"|cargo check\b")),
    ("lint", re.compile(
        r"\beslint\b|\bruff( check)?\b|\bflake8\b|\bpylint\b|\bclippy\b|golangci-lint|go vet\b"
        r"|\bbiome (lint|check|ci)\b|\bmake lint\b")),
    ("test", re.compile(
        r"\bpytest\b|\bvitest\b|\bjest\b|cargo test\b|go test\b|forge test\b|\bunittest\b"
        r"|\bmake test\b|\bctest\b|mvn\b.*\btest\b|gradle\w*\b.*\btest\b")),
    ("build", re.compile(
        r"cargo build\b|go build\b|forge build\b|\bmake build\b|python -m build\b"
        r"|mvn\b.*\b(package|install|verify)\b|gradle\w*\b.*\bbuild\b")),
]
PM_NAMES = ("npm", "pnpm", "yarn", "bun")
PM_VALUE_FLAGS = {"--filter", "-F", "--dir", "-C", "--workspace", "--prefix", "--cwd"}
PM_BUILTINS = {"install", "i", "ci", "add", "remove", "exec", "dlx", "x", "create", "init",
               "publish", "pack", "audit", "outdated", "update", "up", "link", "config", "set",
               "cache", "store", "rebuild", "prune", "dedupe", "why", "list", "ls", "version"}


def pm_script_name(cmd: str) -> Optional[str]:
    """Script name run by `npm|pnpm|yarn|bun [flags] [run] <name>` (None for other commands)."""
    toks = cmd.split()
    if not toks or toks[0] not in PM_NAMES:
        return None
    i = 1
    while i < len(toks):
        tok = toks[i]
        if tok.startswith("-"):
            i += 2 if tok in PM_VALUE_FLAGS else 1
            continue
        if tok in ("run", "run-script"):
            i += 1
            continue
        return None if tok in PM_BUILTINS else tok
    return None
CI_SKIP_RE = re.compile(r"^\s*(npm (ci|install|i)\b|pnpm (install|i)\b|yarn( install)?\s*$|"
                        r"pip (install)|uv (sync|pip)|poetry install|apt(-get)? |brew |"
                        r"echo |cd |export |curl |wget |git |mkdir |cp |mv |rm )")


def extract_ci_commands(repo: Path, ci_files: Sequence[str]) -> List[Dict[str, Any]]:
    """Commands from GitHub Actions `run:` steps and GitLab `script:` lists (line-based)."""
    cmds: List[Dict[str, Any]] = []
    for f in ci_files:
        if not f.endswith((".yml", ".yaml")):
            continue
        try:
            lines = C.read_text(repo / f).splitlines()
        except OSError:
            continue
        i = 0
        while i < len(lines):
            line = lines[i]
            m = re.match(r"^(\s*)(?:-\s+)?run:\s*(.*)$", line)
            g = re.match(r"^(\s*)(?:script|before_script|after_script):\s*$", line)
            if m:
                indent = len(m.group(1))
                value = m.group(2).strip()
                wd = step_working_directory(lines, i)
                extra = {"working_directory": wd} if wd else {}
                if value[:1] in ("|", ">"):
                    j = i + 1
                    while j < len(lines) and (not lines[j].strip() or
                                              len(lines[j]) - len(lines[j].lstrip()) > indent):
                        text = lines[j].strip()
                        if text and not text.startswith("#"):
                            cmds.append(dict({"path": f, "line": j + 1, "cmd": text}, **extra))
                        j += 1
                    i = j
                    continue
                if value and not value.startswith("#"):
                    cmds.append(dict({"path": f, "line": i + 1, "cmd": value.strip("'\"")},
                                     **extra))
            elif g:
                indent = len(g.group(1))
                j = i + 1
                while j < len(lines) and (not lines[j].strip() or
                                          len(lines[j]) - len(lines[j].lstrip()) > indent
                                          or lines[j].lstrip().startswith("- ")
                                          and len(lines[j]) - len(lines[j].lstrip()) >= indent):
                    item = re.match(r"^\s*-\s+(.*)$", lines[j])
                    if item and item.group(1).strip():
                        cmds.append({"path": f, "line": j + 1,
                                     "cmd": item.group(1).strip().strip("'\"")})
                    j += 1
                i = j
                continue
            i += 1
    return cmds


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def step_working_directory(lines: Sequence[str], run_idx: int) -> Optional[str]:
    """`working-directory:` of the GitHub Actions step that holds the `run:` at run_idx."""
    run_line = lines[run_idx]
    dash = re.match(r"^(\s*)-\s+run:", run_line)
    if dash:
        start, dash_indent = run_idx, len(dash.group(1))
    else:
        key_indent = _indent(run_line)
        start, dash_indent = -1, -1
        for k in range(run_idx - 1, -1, -1):
            text = lines[k]
            if not text.strip() or text.lstrip().startswith("#"):
                continue
            ind = _indent(text)
            if ind < key_indent:
                if text.lstrip().startswith("- "):
                    start, dash_indent = k, ind
                break
        if start < 0:
            return None
    end = start + 1
    while end < len(lines):
        text = lines[end]
        if text.strip() and not text.lstrip().startswith("#") and _indent(text) <= dash_indent:
            break
        end += 1
    for k in range(start, end):
        m = re.match(r"^\s*(?:-\s+)?working-directory:\s*(.+?)\s*$", lines[k])
        if m:
            value = m.group(1).strip().strip("'\"")
            if value and "${{" not in value:
                value = C.to_posix(value)
                while value.startswith("./"):
                    value = value[2:]
                return value.rstrip("/") or "."
    return None


def classify_ci_command(cmd: str) -> Optional[str]:
    """Gate category of a CI command, or None when it fits none."""
    script = pm_script_name(cmd)
    pm_cat = classify_script(script, "") if script else None
    if pm_cat:
        return pm_cat
    for cat, rx in CI_PATTERNS:
        if rx.search(cmd):
            return cat
    return None


def ci_candidates(ci_cmds: Sequence[Dict[str, Any]], repo: Optional[Path] = None
                  ) -> Dict[str, List[Dict[str, Any]]]:
    """Classify CI commands into gate categories."""
    out: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CATEGORIES}
    for c in ci_cmds:
        cmd = c["cmd"]
        if CI_SKIP_RE.match(cmd) or "${{" in cmd:
            continue
        cat = classify_ci_command(cmd)
        if cat is None:
            continue
        cwd = c.get("working_directory") or "."
        cand: Dict[str, Any] = {"cmd": cmd, "cwd": cwd,
                                "source": "ci:{}:{}".format(c["path"], c["line"])}
        warnings = ["masking construct: " + m for m in masking_in(cmd)]
        if re.search(r"[^|]\|[^|]", cmd):
            warnings.append("pipe: only the last command's exit status counts unless "
                            "pipefail is set (G107-F02)")
        if repo is not None and not (repo / cwd).is_dir():
            warnings.append("working-directory {} does not exist".format(cwd))
        warnings.append("taken from CI: the step's env and job-level defaults are not "
                        "reproduced")
        cand["warnings"] = warnings
        out[cat].append(cand)
    return out


def unclassified_ci_commands(ci_cmds: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """CI commands that are neither setup steps (CI_SKIP_RE) nor gate candidates: a gate the
    project runs in CI but the inventory could not classify (build-ci-infra G107-F03: CI should
    run the same entry points as local gates), for the user to confirm or dismiss."""
    out: List[Dict[str, Any]] = []
    for c in ci_cmds:
        cmd = c["cmd"]
        if CI_SKIP_RE.match(cmd):
            continue
        if "${{" in cmd:
            reason = "uses ${{ }} expressions: not reproducible outside CI"
        elif classify_ci_command(cmd) is None:
            reason = "fits no gate category"
        else:
            continue
        out.append(dict(c, reason=reason))
    return out


def merge_candidates(*groups: Dict[str, List[Dict[str, Any]]]) -> Dict[str, List[Dict[str, Any]]]:
    """Concatenate candidate groups in priority order, dropping duplicate (cmd, cwd) pairs."""
    out: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CATEGORIES}
    for cat in CATEGORIES:
        seen: Set[Tuple[str, str]] = set()
        for g in groups:
            for cand in g.get(cat, []):
                key = (cand["cmd"], cand.get("cwd", "."))
                if key in seen:
                    continue
                seen.add(key)
                out[cat].append(cand)
    return out


def suggest_gates(cands: Dict[str, List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    """First warning-free root-level candidate per category (else the first one), shaped like
    `.harden/config.json` gates. A suggestion to confirm, never a decision."""
    gates: List[Dict[str, Any]] = []
    for cat in CATEGORIES:
        lst = cands.get(cat, [])
        if not lst:
            continue
        pick = next((c for c in lst if c.get("cwd", ".") == "." and not c.get("warnings")), None)
        pick = pick or next((c for c in lst if not c.get("warnings")), None) or lst[0]
        gate = {"name": cat, "cmd": pick["cmd"], "cwd": pick.get("cwd", "."),
                "timeout_s": 1800 if cat == "test" else 900, "source": pick.get("source")}
        if pick.get("warnings"):
            gate["warnings"] = pick["warnings"]
        gates.append(gate)
    return gates


# ---------------------------------------------------------------------------
# Globs, CI, docs, agent files, entry points
# ---------------------------------------------------------------------------

CI_FILE_RES = [re.compile(r"^\.github/workflows/[^/]+\.ya?ml$"), re.compile(r"^\.gitlab-ci\.ya?ml$"),
               re.compile(r"^\.circleci/config\.ya?ml$"), re.compile(r"^azure-pipelines\.ya?ml$"),
               re.compile(r"^\.travis\.ya?ml$"), re.compile(r"(^|/)Jenkinsfile$"),
               re.compile(r"^bitbucket-pipelines\.ya?ml$"), re.compile(r"^\.drone\.ya?ml$"),
               re.compile(r"^\.buildkite/.+\.ya?ml$"), re.compile(r"^\.woodpecker(\.ya?ml|/.+\.ya?ml)$"),
               re.compile(r"^\.github/actions/.+/action\.ya?ml$"),
               re.compile(r"^\.gitlab/ci/.+\.ya?ml$")]
AGENT_FILE_NAMES = {"claude.md", "claude.local.md", "agents.md", "gemini.md", ".cursorrules",
                    ".windsurfrules"}
INFRA_RES = [(re.compile(r"(^|/)(Dockerfile|Containerfile)([.-][^/]*)?$|\.dockerfile$", re.I),
              "dockerfile"),
             (re.compile(r"(^|/)(docker-)?compose(\.[^/]+)?\.ya?ml$", re.I), "compose"),
             (re.compile(r"\.tf$|\.tfvars$"), "terraform"),
             (re.compile(r"(^|/)Chart\.ya?ml$"), "helm"),
             (re.compile(r"(^|/)\.dockerignore$"), "dockerignore")]
PIN_FILES = {".nvmrc", ".node-version", ".python-version", "rust-toolchain.toml", "rust-toolchain",
             ".tool-versions", ".go-version", ".ruby-version"}

TEST_DIR_GLOBS = ["test", "tests", "__tests__", "spec", "specs", "e2e", "__mocks__", "testdata"]


def test_file_pattern(base: str) -> Optional[str]:
    """Glob (file-name form) describing why a base name is a test file."""
    m = re.match(r"^.+\.(test|spec)\.([cm]?[jt]sx?)$", base)
    if m:
        return "*.{}.{}".format(m.group(1), m.group(2))
    table = [(r"^test_.+\.py$", "test_*.py"), (r".+_test\.py$", "*_test.py"),
             (r"^conftest\.py$", "conftest.py"), (r".+_test\.go$", "*_test.go"),
             (r".+\.t\.sol$", "*.t.sol"), (r".+_spec\.rb$", "*_spec.rb"),
             (r".+_test\.rb$", "*_test.rb"), (r".+\.Tests?\.ps1$", "*.Tests.ps1")]
    for rx, pat in table:
        if re.match(rx, base):
            return pat
    m = re.match(r"^.+(Tests?)\.(java|kt|cs|swift)$", base)
    if m:
        return "*{}.{}".format(m.group(1), m.group(2))
    m = re.match(r"^(?:test_.+|.+_test)\.(c|cc|cpp|cxx)$", base)
    if m:
        return ("test_*." if base.startswith("test_") else "*_test.") + m.group(1)
    return None


def compute_test_globs(infos: Sequence[FileInfo]) -> Tuple[List[str], int]:
    """Portable test globs for the test conventions actually present, and the test file count."""
    pats: List[str] = []
    count = 0
    for info in infos:
        if not info.is_test or info.is_generated:
            continue
        count += 1
        segs = info.path.split("/")
        for idx, seg in enumerate(segs[:-1]):
            if seg.lower() in TEST_DIR_GLOBS:
                pats.extend(["{}/**".format(seg), "**/{}/**".format(seg)])
                break
        fp = test_file_pattern(segs[-1])
        if fp:
            pats.extend(C.portable_globs(fp))
    return sorted(set(pats)), count


def entry_points_and_kind(repo: Path, pkgs: Dict[str, Dict[str, Any]],
                          pyprojects: Dict[str, Dict[str, Any]], cargos: Dict[str, Dict[str, Any]],
                          infos: Sequence[FileInfo], files_set: Set[str]) -> List[Dict[str, Any]]:
    """Per-manifest library/application signals and declared entry points (T07-F12)."""
    result: List[Dict[str, Any]] = []
    for path, pkg in sorted(pkgs.items()):
        lib: List[str] = []
        app: List[str] = []
        eps: List[str] = []
        for key in ("exports", "main", "module", "types", "typings"):
            if key in pkg:
                lib.append("package.json " + key)
        if pkg.get("private") is True:
            app.append("package.json private: true")
        binv = pkg.get("bin")
        if isinstance(binv, str):
            eps.append(binv)
            app.append("package.json bin")
        elif isinstance(binv, dict):
            eps.extend(str(v) for v in binv.values())
            app.append("package.json bin")
        if isinstance(pkg.get("main"), str):
            eps.append(pkg["main"])
        result.append(_kind_entry(path, lib, app, eps))
    for path, data in sorted(pyprojects.items()):
        lib, app, eps = [], [], []
        proj = data.get("project", {}) if isinstance(data.get("project"), dict) else {}
        for key in ("scripts", "gui-scripts"):
            val = proj.get(key)
            if isinstance(val, dict) and val:
                app.append("[project.{}]".format(key))
                eps.extend("{} = {}".format(k, v) for k, v in val.items())
        if isinstance(proj.get("entry-points"), dict):
            lib.append("[project.entry-points] (plugin entry points)")
        if "build-system" in data and proj.get("name"):
            lib.append("[build-system] with [project] name (publishable package)")
        tool = data.get("tool", {}) if isinstance(data.get("tool"), dict) else {}
        poetry = tool.get("poetry", {}) if isinstance(tool.get("poetry"), dict) else {}
        if isinstance(poetry.get("scripts"), dict) and poetry["scripts"]:
            app.append("[tool.poetry.scripts]")
            eps.extend("{} = {}".format(k, v) for k, v in poetry["scripts"].items())
        result.append(_kind_entry(path, lib, app, eps))
    for path, data in sorted(cargos.items()):
        lib, app, eps = [], [], []
        d = dir_of(path)
        if "lib" in data or join_rel(d, "src/lib.rs") in files_set:
            lib.append("[lib] or src/lib.rs")
            eps.append(join_rel(d, "src/lib.rs"))
        bins = data.get("bin")
        if isinstance(bins, list) and bins:
            app.append("[[bin]]")
            eps.extend(str(b.get("path") or b.get("name")) for b in bins if isinstance(b, dict))
        if join_rel(d, "src/main.rs") in files_set:
            app.append("src/main.rs")
            eps.append(join_rel(d, "src/main.rs"))
        if any(f.startswith(join_rel(d, "src/bin/")) for f in files_set):
            app.append("src/bin/")
        if "workspace" in data and not lib and not app:
            lib.append("[workspace] root (see member crates)")
        result.append(_kind_entry(path, lib, app, eps))
    go_mains = []
    for info in infos:
        if info.language == "Go" and not info.is_test and not info.is_generated:
            try:
                head = C.read_text(repo / info.path, max_bytes=HEADER_READ_BYTES)
            except OSError:
                continue
            if re.search(r"(?m)^package main\b", head):
                go_mains.append(info.path)
    for gomod in sorted(f for f in files_set if f.rsplit("/", 1)[-1] == "go.mod"):
        d = dir_of(gomod)
        mains = [g for g in go_mains if d == "." or g.startswith(d + "/")]
        app = ["package main in {} file(s)".format(len(mains))] if mains else []
        lib = [] if mains else ["no package main (library module)"]
        result.append(_kind_entry(gomod, lib, app, sorted(mains)[:50]))
    return result


def _kind_entry(manifest: str, lib: List[str], app: List[str], eps: List[str]) -> Dict[str, Any]:
    if lib and app:
        verdict = "both"
    elif lib:
        verdict = "library"
    elif app:
        verdict = "application"
    else:
        verdict = "unknown"
    return {"manifest": manifest, "verdict": verdict, "library_signals": lib,
            "application_signals": app, "entry_points": [C.to_posix(e) for e in eps]}


# ---------------------------------------------------------------------------
# Git section
# ---------------------------------------------------------------------------


def git_section(repo: Path, infos: Sequence[FileInfo]) -> Dict[str, Any]:
    """History statistics and the G104-F04 history-sufficiency verdict."""
    sec: Dict[str, Any] = {"is_repo": True}
    head = C.head_sha(repo)
    branch = C.git_ok(repo, ["symbolic-ref", "--short", "-q", "HEAD"])
    shallow = C.git_ok(repo, ["rev-parse", "--is-shallow-repository"]) == "true"
    status = C.git_bytes(repo, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
                         check=False).decode("utf-8", errors="replace")
    toks = status.split("\0")
    entries: List[str] = []
    k = 0
    while k < len(toks):
        tok = toks[k]
        k += 1
        if len(tok) < 4:
            continue
        entries.append(tok)
        if tok[0] in "RC":  # rename/copy: the original path follows as its own token
            k += 1
    entries = [e for e in entries if not e[3:].startswith(C.HARDEN_DIR_NAME + "/")]
    dirty = [e[3:] for e in entries]
    untracked = [e[3:] for e in entries if e.startswith("??")]
    sec.update({"head": head, "branch": branch, "detached": head is not None and branch is None,
                "clean": not dirty, "modified_count": len([e for e in entries
                                                           if not e.startswith("??")]),
                "untracked_count": len(untracked), "dirty_files": dirty[:50], "shallow": shallow})
    if head is None:
        sec.update({"commits": 0, "history_sufficient": False,
                    "history_reasons": ["no commits yet (unborn branch)"]})
        return sec

    def count(args: List[str]) -> int:
        out = C.git_ok(repo, args)
        return int(out) if out and out.isdigit() else 0

    fp_times = [int(t) for t in C.git(repo, ["log", "--first-parent", "--format=%ct"],
                                      check=False).split() if t.isdigit()]
    first_ct = min(fp_times) if fp_times else None
    last_ct = max(fp_times) if fp_times else None

    # Exclusion filter for churn/history (G104-F06): generated, vendored, lock, minified,
    # snapshot paths. Directory prefixes come from the file scan; path rules cover deleted files.
    gen_files = {i.path for i in infos if i.is_generated}
    vprefixes = sorted(vendor_prefixes(repo, [i.path for i in infos]))

    def is_excluded(path: str) -> bool:
        return (path in gen_files or C.path_generated_reason(path, vprefixes) is not None
                or C.lockfile_manager(path) is not None or C.is_snapshot_path(path))

    history = C.load_history(repo, is_excluded)
    all_commits = C.load_commit_metadata(repo, first_parent=False)
    adoption_ct, adoption_marker = C.agent_adoption(repo, all_commits)
    verdict = C.evaluate_sufficiency(history, adoption_ct, adoption_marker, shallow)

    fp_all = history.commits                      # first-parent, merges included when counted
    fp_nm = [c for c in fp_all if not c.is_merge]  # first-parent, no merges (dossier S1/S3 set)
    by_agent: Dict[str, int] = {}
    trailer_commits = [c for c in all_commits if c.agent_names]
    for c in trailer_commits:
        for name in c.agent_names:
            by_agent[name] = by_agent.get(name, 0) + 1
    authors = sorted({c.author_email for c in all_commits if c.author_email})
    fp_merges = count(["rev-list", "--count", "--merges", "--first-parent", "HEAD"])
    pr_suffix = sum(1 for c in fp_nm if C.PR_SUFFIX_RE.search(c.subject))
    conventional = sum(1 for c in fp_nm if C.CONVENTIONAL_ANY_RE.match(c.subject))
    bulk = [c for c in fp_all if c.is_bulk]
    squash_likely = fp_merges == 0 and pr_suffix >= 3 and pr_suffix >= 0.2 * max(1, len(fp_nm))
    ownership_off: List[str] = []
    if len(authors) <= 1:
        ownership_off.append("one author identity or fewer")
    if squash_likely:
        ownership_off.append("squash-merge signature")
    if adoption_ct is not None:
        ownership_off.append("agent use detected ({}); agent commits under the user's identity "
                             "are indistinguishable".format(adoption_marker))

    sec.update({
        "commits": count(["rev-list", "--count", "--first-parent", "HEAD"]),
        "commits_all": count(["rev-list", "--count", "HEAD"]),
        "commits_first_parent_no_merges": len(fp_nm),
        "first_commit_date": C.utc_date(first_ct), "last_commit_date": C.utc_date(last_ct),
        "last_commit_ts": last_ct,
        "span_days": round((last_ct - first_ct) / C.SECONDS_PER_DAY, 1)
        if first_ct is not None and last_ct is not None else None,
        "merge_commits": count(["rev-list", "--count", "--merges", "HEAD"]),
        "first_parent_merges": fp_merges,
        "authors": len(authors),
        "mailmap_present": (repo / ".mailmap").is_file(),
        "agent_trailer_commits": {
            "count": len(trailer_commits), "by_agent": by_agent,
            "first_date": C.utc_date(min(c.ct for c in trailer_commits)) if trailer_commits else None,
            "last_date": C.utc_date(max(c.ct for c in trailer_commits)) if trailer_commits else None,
            "examples": [c.sha[:12] for c in trailer_commits[:10]],
            "scope": "all non-merge commits reachable from HEAD"},
        "agent_adoption": {"date": C.utc_date(adoption_ct), "marker": adoption_marker},
        "bulk_commits": {
            "p99_files_touched": history.p99_files, "count": len(bulk),
            "rule": "files touched > the repo's 99th percentile (G104-F07 convention); counted as "
                    "one change event per file with zero line churn; review them by hand",
            "commits": [{"sha": c.sha[:12], "date": C.utc_date(c.ct), "files": c.files_touched,
                         "merge": c.is_merge, "subject": c.subject[:120]} for c in bulk[:50]]},
        "fix_commits": {
            "count": sum(1 for c in fp_nm if c.is_fix),
            "count_including_first_parent_merges": sum(1 for c in fp_all if c.is_fix),
            "filtered_count": verdict["fix_commits"],
            "conventional_fix_count": sum(1 for c in fp_nm if c.is_conventional_fix),
            "conventional_subject_share": round(conventional / len(fp_nm), 3) if fp_nm else 0.0,
            "regex": C.FIX_REGEX_POSIX,
            "note": "noisy keyword label (G104-F08); read recent fix commits before calling a "
                    "file a bug hotspot"},
        "squash_signals": {"first_parent_merges": fp_merges, "pr_suffix_subjects": pr_suffix,
                           "squash_or_rebase_likely": squash_likely,
                           "rule": "no first-parent merges and >= 20% of subjects end in (#N) "
                                   "(G104-F09 signature; the 20% cut is this script's convention)"},
        "ownership_metrics_disabled": bool(ownership_off),
        "ownership_disable_reasons": ownership_off,
        "ignore_revs": len(history.ignore_revs),
        "history_filters": ["--first-parent", history.merge_mode,
                            "-M (renames folded to current path)", history.whitespace_mode,
                            ".git-blame-ignore-revs skipped",
                            "generated/vendored/lock/minified/snapshot paths excluded",
                            "bulk commits: zero line churn"],
        "first_parent_merges_counted": sum(1 for c in fp_all if c.is_merge and c.filtered),
        "history_sufficient": bool(verdict["sufficient"]),
        "history_reasons": verdict["reasons"],
        "history_criteria": verdict["criteria"],
        "history_filtered_commits": verdict["filtered_commits"],
        "history_filtered_span_days": verdict["span_days"],
    })
    return sec


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------


def build_inventory(info: C.RepoInfo) -> Dict[str, Any]:
    """Build the inventory dictionary for a resolved repository."""
    repo = info.root
    notes: List[str] = list(info.notes)
    files, source = C.list_files(repo, info.is_repo)
    files = [f for f in files if not f.startswith(C.HARDEN_DIR_NAME + "/")]
    files_set = set(files)
    infos = scan_files(repo, files, info.is_repo)
    by_path = {i.path: i for i in infos}

    def is_generated(path: str) -> bool:
        i = by_path.get(path)
        return bool(i and i.is_generated)

    # Languages (generated/vendored code excluded, counted separately).
    languages: Dict[str, Dict[str, int]] = {}
    gen_count = 0
    for i in infos:
        if i.is_generated:
            gen_count += 1
            continue
        if i.language is None:
            continue
        entry = languages.setdefault(i.language, {"files": 0, "loc": 0})
        entry["files"] += 1
        entry["loc"] += i.loc or 0
    languages = dict(sorted(languages.items(), key=lambda kv: (-kv[1]["loc"], kv[0])))
    unmapped = unmapped_extensions(infos)
    mapped_loc = sum(v["loc"] for v in languages.values())
    unmapped_loc = sum(v["loc"] for v in unmapped.values())
    if unmapped_loc > mapped_loc:
        top = ", ".join("{} ({} files, {} lines)".format(ext, v["files"], v["loc"])
                        for ext, v in list(unmapped.items())[:5])
        notes.append("files with no language mapping hold {} non-blank lines, more than the {} "
                     "of every mapped language together: the lens and language routers cover a "
                     "minority of this repository. Largest: {}. Name them under Limits "
                     "(unmapped_extensions) and follow detection.md's tool discovery for the "
                     "languages among them.".format(unmapped_loc, mapped_loc, top))

    # Generated / vendored entries: directory prefixes collapsed, single files listed.
    gen_dirs: Dict[str, Dict[str, Any]] = {}
    gen_single: List[Dict[str, str]] = []
    for i in infos:
        if not i.is_generated:
            continue
        if i.generated_prefix:
            e = gen_dirs.setdefault(i.generated_prefix, {"path": i.generated_prefix,
                                                         "reason": i.generated_reason, "files": 0})
            e["files"] += 1
        else:
            gen_single.append({"path": i.path, "reason": i.generated_reason or ""})
    generated = sorted(gen_dirs.values(), key=lambda e: e["path"]) + gen_single[:2000]
    if len(gen_single) > 2000:
        notes.append("generated_or_vendor truncated to 2000 single-file entries")

    manifests: List[Dict[str, str]] = []
    for f in files:
        kind = manifest_kind(f)
        if kind and not is_generated(f):
            manifests.append({"path": f, "kind": kind})
    lock_paths = [f for f in files if C.lockfile_manager(f) and not is_generated(f)]
    pkgs: Dict[str, Dict[str, Any]] = {}
    pyprojects: Dict[str, Dict[str, Any]] = {}
    cargos: Dict[str, Dict[str, Any]] = {}
    foundries: Dict[str, Dict[str, Any]] = {}
    for m in manifests:
        path, kind = m["path"], m["kind"]
        if kind == "npm-package":
            pkg = read_package_json(repo, path, notes)
            if pkg is not None:
                pkgs[path] = pkg
        elif kind in ("pyproject", "cargo", "foundry"):
            data, err = C.load_toml(repo / path)
            if err:
                notes.append(err + " ({})".format(path))
                continue
            target = {"pyproject": pyprojects, "cargo": cargos, "foundry": foundries}[kind]
            target[path] = data or {}

    tools = detect_tools(repo, [f for f in files if not is_generated(f)], pkgs, pyprojects, cargos)
    package_managers = detect_package_managers(files, pkgs, pyprojects, lock_paths, manifests, repo)

    ci_files = [f for f in files if any(rx.search(f) for rx in CI_FILE_RES)]
    ci_text = "\n".join(C.read_text(repo / f) for f in ci_files if (repo / f).is_file())
    ci_cmds = extract_ci_commands(repo, ci_files)
    make_cands, make_masking = make_candidates(repo, files, is_generated)
    candidates = merge_candidates(
        js_candidates(repo, pkgs, lock_paths, is_generated),
        python_candidates(repo, files, pyprojects, tools, infos),
        toolchain_candidates(files, cargos, foundries, tools, ci_text),
        make_cands,
        ci_candidates(ci_cmds, repo))

    # Masking constructs (G107-F01) in package.json scripts, Makefile/justfile recipes, CI files
    # and shell scripts.
    # G107-F01 scope: CI config and the scripts CI calls. Shell scripts are scanned only when
    # CI, a package.json script or a make/just recipe references them (a `|| true` in a cleanup
    # trap of an unrelated script is not a gate).
    masking: List[Dict[str, Any]] = [dict(m, context="make/just recipe") for m in make_masking]
    entry_text: List[str] = [ci_text]
    for path, pkg in pkgs.items():
        scripts = pkg.get("scripts")
        if isinstance(scripts, dict):
            for name, body in scripts.items():
                if isinstance(body, str):
                    entry_text.append(body)
                    for mk in masking_in(body):
                        masking.append({"path": path, "line": None, "construct": mk,
                                        "context": "package.json script",
                                        "text": "scripts.{}: {}".format(name, body[:200])})
    for f in files:
        if f.rsplit("/", 1)[-1].lower() in ("makefile", "gnumakefile", "justfile"):
            try:
                entry_text.append(C.read_text(repo / f))
            except OSError:
                pass
    joined = "\n".join(entry_text)
    called_scripts = [i.path for i in infos if i.language == "Shell" and not i.is_generated
                      and (i.path in joined or re.search(r"(^|[\s/'\"=])" + re.escape(
                          i.path.rsplit("/", 1)[-1]) + r"($|[\s'\";|&)])", joined, re.M))]
    for f in ci_files + called_scripts:
        context = "CI config" if f in ci_files else "shell script called from CI or scripts"
        try:
            lines = C.read_text(repo / f).splitlines()
        except OSError:
            continue
        for n, line in enumerate(lines, 1):
            for mk in masking_in(line) if not line.lstrip().startswith("#") else []:
                if mk.startswith(";"):
                    continue
                masking.append({"path": f, "line": n, "construct": mk, "context": context,
                                "text": line.strip()[:200]})
            if f in ci_files and re.search(r"\btrivy\b", line) and "--exit-code 1" not in line \
                    and not line.lstrip().startswith("#"):
                masking.append({"path": f, "line": n, "construct": "trivy without --exit-code 1 "
                                "(trivy exits 0 by default)", "context": context,
                                "text": line.strip()[:200]})

    test_globs, test_count = compute_test_globs(infos)
    snapshot_globs: List[str] = []
    if any(i.is_snapshot for i in infos):
        snapshot_globs = ["__snapshots__/**", "**/__snapshots__/**"]
        if any(i.path.endswith(".snap") for i in infos):
            snapshot_globs += C.portable_globs("*.snap")
    config_paths = sorted({t["file"] for t in tools if t["evidence"] == "config-file"})
    # Manifests that carry tool config next to dependencies: protect them through the
    # config-weakening checks of diff_guard rather than a blanket edit ban.
    embedded = sorted({t["file"] for t in tools if t["evidence"] == "embedded-config"})
    ci_globs = sorted({".github/workflows/**" if f.startswith(".github/workflows/") else f
                       for f in ci_files})
    # Test files are not gate configurations: they may gain checked additions (protocol-change
    # PC-06; user-policy-autonomy U01-F07). Suggesting the test globs here made every existing
    # test a "gate or test-runner configuration" for hook_guard.py (pilot-auto-calibration
    # A01-F53); run_state.py puts them in the marker's test list instead.
    protected = sorted(set(snapshot_globs + config_paths + ci_globs + lock_paths))

    docs = [f for f in files if C.is_doc_path(f) and not is_generated(f)]
    agent_files = [f for f in files if f.rsplit("/", 1)[-1].lower() in AGENT_FILE_NAMES
                   or f == ".github/copilot-instructions.md" or f.startswith(".cursor/rules/")
                   or f.startswith(".claude/")]
    infra = [{"path": f, "kind": kind} for f in files if not is_generated(f)
             for rx, kind in INFRA_RES if rx.search(f)]
    pins: List[Dict[str, str]] = [{"path": f, "kind": "pin-file"} for f in files
                                  if f.rsplit("/", 1)[-1] in PIN_FILES]
    for path, pkg in pkgs.items():
        for key in ("packageManager", "engines", "devEngines"):
            if key in pkg:
                pins.append({"path": path, "kind": "package.json " + key,
                             "value": json.dumps(pkg[key])[:200]})
    for path, data in pyprojects.items():
        proj = data.get("project", {}) if isinstance(data.get("project"), dict) else {}
        if "requires-python" in proj:
            pins.append({"path": path, "kind": "requires-python",
                         "value": str(proj["requires-python"])})

    source_loc = sum(i.loc or 0 for i in infos if i.is_source)
    test_loc = sum(i.loc or 0 for i in infos if i.is_test and not i.is_generated
                   and C.is_source_language(i.language))

    if info.is_repo:
        git_sec = git_section(repo, infos)
    else:
        git_sec = {"is_repo": False, "history_sufficient": False,
                   "history_reasons": ["not a git repository: no history-based signal is "
                                       "available"]}
        notes.append("not a git repository: files come from a filesystem walk that skips "
                     "VCS, cache and dependency directories")

    return {
        "schema_version": C.SCHEMA_VERSION,
        "repo": C.posix_abs(repo),
        "generated": C.utc_iso(),
        "tool": {"script": "inventory.py", "python": sys.version.split()[0],
                 "git": C.git_version(), "platform": sys.platform},
        "file_source": source,
        "glob_dialect": "repo-relative POSIX paths; ** crosses directories, * stays in one "
                        "segment; each glob is emitted in variants that also work with fnmatch",
        "git": git_sec,
        "languages": languages,
        "unmapped_extensions": unmapped,
        "manifests": manifests,
        "lockfiles": [{"path": f, "manager": C.lockfile_manager(f)} for f in lock_paths],
        "package_managers": package_managers,
        "toolchain_pins": pins,
        "tools_configured": tools,
        "command_candidates": candidates,
        "gates_suggested": suggest_gates(candidates),
        "ci_commands": ci_cmds[:MAX_LIST],
        "unclassified_ci_commands": unclassified_ci_commands(ci_cmds)[:MAX_LIST],
        "masking_constructs": masking[:MAX_LIST],
        "project_kind": entry_points_and_kind(repo, pkgs, pyprojects, cargos, infos, files_set),
        "test_globs": test_globs,
        "protected_globs_suggested": protected,
        "embedded_config_manifests": embedded,
        "generated_or_vendor": generated,
        "ci_files": ci_files,
        "infra_files": infra[:MAX_LIST],
        "docs": docs[:MAX_LIST],
        "docs_count": len(docs),
        "agent_context_files": agent_files,
        "size": {"tracked_files": len(files), "generated_or_vendor_files": gen_count,
                 "source_files": sum(1 for i in infos if i.is_source), "source_loc": source_loc,
                 "test_files": test_count, "test_loc": test_loc},
        "notes": notes,
    }


def summary_text(inv: Dict[str, Any]) -> str:
    """Short human summary."""
    g = inv["git"]
    langs = ", ".join("{} {}f/{}loc".format(k, v["files"], v["loc"])
                      for k, v in list(inv["languages"].items())[:6]) or "none"
    lines = [
        "repo: {}".format(inv["repo"]),
        "files: {} tracked, {} source ({} LOC), {} test, {} generated/vendored".format(
            inv["size"]["tracked_files"], inv["size"]["source_files"], inv["size"]["source_loc"],
            inv["size"]["test_files"], inv["size"]["generated_or_vendor_files"]),
        "languages: " + langs,
        "package managers: " + (", ".join(p["name"] for p in inv["package_managers"]) or "none"),
        "tools configured: " + (", ".join(sorted({t["tool"] for t in inv["tools_configured"]}))
                                or "none"),
    ]
    for cat in CATEGORIES:
        cands = inv["command_candidates"][cat]
        shown = ["{}{}".format(c["cmd"], "" if c.get("cwd", ".") == "." else
                               " (in {})".format(c["cwd"])) for c in cands[:3]]
        more = " (+{} more)".format(len(cands) - 3) if len(cands) > 3 else ""
        lines.append("{}: {}{}".format(cat, "; ".join(shown) or "-", more))
    if g.get("is_repo"):
        lines.append("git: {} commits, head {}, branch {}, clean={}".format(
            g.get("commits"), (g.get("head") or "-")[:12], g.get("branch"), g.get("clean")))
    lines.append("history sufficient: {} ({})".format(g.get("history_sufficient"),
                                                      "; ".join(g.get("history_reasons", []))))
    if inv["masking_constructs"]:
        lines.append("masking constructs: {}".format(len(inv["masking_constructs"])))
    if inv.get("unmapped_extensions"):
        lines.append("unmapped extensions: " + ", ".join(
            "{} {}f/{}loc".format(ext, v["files"], v["loc"])
            for ext, v in list(inv["unmapped_extensions"].items())[:8]))
    if inv.get("unclassified_ci_commands"):
        lines.append("unclassified CI commands: {}".format(len(inv["unclassified_ci_commands"])))
    for note in inv.get("notes", []):
        if note.startswith("files with no language mapping"):
            lines.append("note: " + note)
    return "\n".join(lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI entry point."""
    C.configure_stdio()
    parser = argparse.ArgumentParser(description="Inventory a repository for /harden.")
    parser.add_argument("--repo", default=".", help="repository directory (default: .)")
    parser.add_argument("--out", default=None, help="output file (default: .harden/inventory.json)")
    parser.add_argument("--json", action="store_true", help="print the JSON to stdout")
    parser.add_argument("--quiet", action="store_true", help="print nothing on success")
    args = parser.parse_args(argv)
    try:
        info = C.resolve_repo(Path(args.repo))
    except (FileNotFoundError, NotADirectoryError) as exc:
        C.eprint("error: not a directory: {}".format(exc))
        return 2
    try:
        inv = build_inventory(info)
        if args.out:
            out = Path(args.out)
            if not out.is_absolute():
                out = Path.cwd() / out
        else:
            C.ensure_harden_dir(info.root, info.is_repo)
            out = C.harden_dir(info.root) / "inventory.json"
        C.write_json(out, inv)
    except C.GitError as exc:
        C.eprint("error: {}".format(exc))
        return 2
    except OSError as exc:
        C.eprint("error: {}".format(exc))
        return 2
    if args.json:
        print(json.dumps(inv, indent=2, ensure_ascii=False))
    elif not args.quiet:
        print(summary_text(inv))
        print("written: {}".format(C.to_posix(str(out))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
