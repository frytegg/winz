"""Shared helpers for the /harden scripts (inventory.py, rank.py, gates.py, ledger.py,
run_state.py, prescan.py, diff_guard.py, complexity.py, dead_history.py, doubling.py,
e2e_reach.py and ts_program.py; hook_guard.py through diff_guard.py).

Purpose
    Repository discovery, a git runner, the `.harden/` run-directory helpers, JSON I/O,
    path classification (language, tests, docs, lockfiles, generated/vendored code) from one
    extension table (EXTENSION_TABLE: language, comment syntax, code file), a small glob
    matcher, TOML loading, and the filtered git-history model used by the history-sufficiency
    gate and the ranking.

    Every threshold and filter below that comes from the research dossiers is a *convention*
    recorded there (dossier `hotspot-evidence`, finding ids G104-Fxx; dossier `prioritization`,
    T19-Fxx), not a validated fact. Comments say so where the values are used.

CLI
    None. This module is imported by the scripts that sit next to it.

Exit codes
    Not applicable (library module).

Conventions
    - Python 3.9+ standard library only; UTF-8 everywhere; forward-slash, repo-relative paths.
    - Subprocesses are run without a shell.
    - Glob dialect used by every `*_globs` field written by these scripts: patterns are matched
      against the full repo-relative POSIX path; `**/` matches zero or more directories, `**`
      matches anything, `*` and `?` stay inside one path segment, `[...]` is a character class.
      A pattern with no `/` (other than a trailing one) matches the file name at any depth, like
      .gitignore. A trailing `/` means "this directory and everything under it".
      The scripts emit globs in forms that also work with Python's `fnmatch` (see
      `portable_globs`), because other harden scripts may use either dialect.
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

HARDEN_DIR_NAME = ".harden"
SCHEMA_VERSION = 1


def utc_iso(ts: Optional[float] = None) -> str:
    """Return an ISO 8601 UTC timestamp (seconds precision, trailing Z)."""
    dt = datetime.now(timezone.utc) if ts is None else datetime.fromtimestamp(ts, timezone.utc)
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def utc_date(ts: Optional[float]) -> Optional[str]:
    """Return the UTC calendar date (YYYY-MM-DD) of a POSIX timestamp."""
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%d")


def to_posix(path: str) -> str:
    """Normalise a path to forward slashes."""
    return path.replace("\\", "/")


def posix_abs(path: Path) -> str:
    """Absolute path as a forward-slash string."""
    return to_posix(str(path))


def default_python_command() -> str:
    """Name of the Python launcher to suggest in commands: `python` on Windows, else `python3`."""
    return "python" if os.name == "nt" else "python3"


def write_json(path: Path, data: object) -> None:
    """Write JSON atomically (temp file + replace), UTF-8, 2-space indent."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        os.replace(tmp, str(path))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def read_json(path: Path) -> Any:
    """Read a UTF-8 JSON file (a leading BOM, as Windows PowerShell 5.1 writes, is accepted)."""
    with open(path, "r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def read_text(path: Path, max_bytes: Optional[int] = None) -> str:
    """Read a repository file as text (UTF-8, undecodable bytes replaced)."""
    with open(path, "rb") as handle:
        data = handle.read() if max_bytes is None else handle.read(max_bytes)
    return data.decode("utf-8", errors="replace")


def eprint(*args: object) -> None:
    """Print to stderr."""
    print(*args, file=sys.stderr)


def configure_stdio() -> None:
    """Make stdout/stderr UTF-8 so JSON and paths print on Windows consoles too."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass


# ---------------------------------------------------------------------------
# TOML (tomllib on 3.11+, a small fallback reader on 3.9/3.10)
# ---------------------------------------------------------------------------

try:  # pragma: no cover - depends on the interpreter version
    import tomllib as _tomllib  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    _tomllib = None  # type: ignore[assignment]


def _toml_scalar(raw: str) -> Any:
    raw = raw.strip()
    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        return raw[1:-1]
    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        return raw[1:-1]
    if raw in ("true", "false"):
        return raw == "true"
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [_toml_scalar(p) for p in re.findall(r'"[^"]*"|\'[^\']*\'|[^,\s]+', inner)]
    if re.match(r"^-?\d+$", raw):
        return int(raw)
    return raw


def _fallback_toml(text: str) -> Dict[str, Any]:
    """Minimal TOML reader: tables, arrays of tables, and one-line `key = value` pairs.

    Only used on Python < 3.11. It is enough to detect `[tool.*]` sections, scripts and
    `[[bin]]` entries; multi-line values and inline tables are kept as raw strings.
    """
    root: Dict[str, Any] = {}
    cur: Dict[str, Any] = root
    for line in text.splitlines():
        stripped = line.split("#", 1)[0].strip() if not line.strip().startswith(('"', "'")) \
            else line.strip()
        if not stripped:
            continue
        m_arr = re.match(r"^\[\[\s*([^\]]+?)\s*\]\]$", stripped)
        m_tab = re.match(r"^\[\s*([^\]]+?)\s*\]$", stripped)
        if m_arr or m_tab:
            keys = [k.strip().strip('"').strip("'") for k in (m_arr or m_tab).group(1).split(".")]
            node: Any = root
            for k in keys[:-1]:
                nxt = node.setdefault(k, {})
                node = nxt[-1] if isinstance(nxt, list) and nxt else nxt
            if m_arr:
                lst = node.setdefault(keys[-1], [])
                if not isinstance(lst, list):
                    lst = [lst]
                    node[keys[-1]] = lst
                lst.append({})
                cur = lst[-1]
            else:
                tab = node.setdefault(keys[-1], {})
                cur = tab if isinstance(tab, dict) else {}
            continue
        m_kv = re.match(r"^([A-Za-z0-9_.\-\"']+)\s*=\s*(.*)$", stripped)
        if m_kv:
            key = m_kv.group(1).strip('"').strip("'")
            cur[key] = _toml_scalar(m_kv.group(2))
    return root


def load_toml(path: Path) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Parse a TOML file. Returns (data, error message)."""
    try:
        text = read_text(path)
    except OSError as exc:
        return None, "cannot read {}: {}".format(path.name, exc)
    text = text[1:] if text.startswith("\ufeff") else text  # BOM written by some Windows editors
    if _tomllib is not None:
        try:
            return _tomllib.loads(text), None
        except Exception as exc:  # tomllib.TOMLDecodeError
            return None, "invalid TOML in {}: {}".format(path.name, exc)
    try:
        return _fallback_toml(text), None
    except Exception as exc:  # pragma: no cover
        return None, "cannot parse {}: {}".format(path.name, exc)


def ini_sections(path: Path) -> Set[str]:
    """Section names of an INI-style file (setup.cfg, tox.ini, mypy.ini)."""
    try:
        text = read_text(path)
    except OSError:
        return set()
    return {m.group(1).strip() for m in re.finditer(r"(?m)^\s*\[([^\]]+)\]\s*$", text)}


# ---------------------------------------------------------------------------
# Subprocess / git
# ---------------------------------------------------------------------------


class GitError(RuntimeError):
    """A git command failed."""


def git_env() -> Dict[str, str]:
    """Environment for git calls: never prompt, never page."""
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_PAGER"] = "cat"
    env.pop("GIT_DIR", None)
    env.pop("GIT_WORK_TREE", None)
    return env


def git_bytes(repo: Path, args: Sequence[str], check: bool = True,
              input_bytes: Optional[bytes] = None) -> bytes:
    """Run `git <args>` in `repo` and return raw stdout."""
    cmd = ["git", "-c", "core.quotePath=false", "-c", "color.ui=never"] + list(args)
    try:
        proc = subprocess.run(cmd, cwd=str(repo), input=input_bytes, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, env=git_env(), check=False)
    except FileNotFoundError as exc:
        raise GitError("git executable not found on PATH") from exc
    if check and proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        raise GitError("git {} failed ({}): {}".format(" ".join(args[:3]), proc.returncode, err))
    return proc.stdout


def git(repo: Path, args: Sequence[str], check: bool = True) -> str:
    """Run git and return stdout decoded as UTF-8 (errors replaced)."""
    return git_bytes(repo, args, check=check).decode("utf-8", errors="replace")


def git_ok(repo: Path, args: Sequence[str]) -> Optional[str]:
    """Run git; return stripped stdout, or None when the command fails."""
    try:
        return git(repo, args, check=True).strip()
    except GitError:
        return None


_GIT_AVAILABLE: Optional[bool] = None


def git_available() -> bool:
    """True when a `git` executable can be started."""
    global _GIT_AVAILABLE
    if _GIT_AVAILABLE is None:
        try:
            subprocess.run(["git", "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           check=False)
            _GIT_AVAILABLE = True
        except OSError:
            _GIT_AVAILABLE = False
    return _GIT_AVAILABLE


def git_version() -> Optional[str]:
    """Return the git version string, or None when git is missing."""
    if not git_available():
        return None
    out = subprocess.run(["git", "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         check=False).stdout.decode("utf-8", errors="replace").strip()
    return out.replace("git version ", "") or None


@dataclass
class RepoInfo:
    """Where the scripts operate and whether git history is available there."""
    root: Path
    is_repo: bool
    requested: Path
    notes: List[str] = field(default_factory=list)


def resolve_repo(start: Path) -> RepoInfo:
    """Resolve the directory to analyse.

    - Inside a git work tree: the work-tree root (a note is added when `start` is a subdirectory).
    - A directory that sits inside some *other* git repository but has no tracked files there
      (e.g. an untracked project folder under a versioned home directory) is treated as a plain,
      non-git directory, so the parent repository's history is never mistaken for the project's.
    - Otherwise: `start` itself, with is_repo False.
    """
    requested = start.resolve()
    if not requested.exists():
        raise FileNotFoundError(str(requested))
    if not requested.is_dir():
        raise NotADirectoryError(str(requested))
    top = git_ok(requested, ["rev-parse", "--show-toplevel"]) if git_available() else None
    if not top:
        return RepoInfo(root=requested, is_repo=False, requested=requested)
    root = Path(top).resolve()
    if root == requested:
        return RepoInfo(root=root, is_repo=True, requested=requested)
    rel = to_posix(os.path.relpath(str(requested), str(root)))
    tracked = git_bytes(root, ["ls-files", "-z", "--", rel], check=False)
    if not tracked.strip(b"\0"):
        return RepoInfo(root=requested, is_repo=False, requested=requested, notes=[
            "{} is inside the git repository {} but has no tracked files there; it is analysed "
            "as a plain directory without git history".format(posix_abs(requested),
                                                               posix_abs(root))])
    return RepoInfo(root=root, is_repo=True, requested=requested, notes=[
        "{} is a subdirectory of the git repository {}; the whole repository is analysed"
        .format(posix_abs(requested), posix_abs(root))])


def head_sha(repo: Path) -> Optional[str]:
    """Current HEAD commit, or None (unborn branch / not a repo)."""
    return git_ok(repo, ["rev-parse", "--verify", "-q", "HEAD"])


# ---------------------------------------------------------------------------
# .harden run directory
# ---------------------------------------------------------------------------


def harden_dir(repo: Path) -> Path:
    """Path of the run directory inside the target repository."""
    return repo / HARDEN_DIR_NAME


def ensure_harden_dir(repo: Path, is_repo: bool) -> Path:
    """Create `.harden/` and exclude it through `.git/info/exclude` (never through .gitignore)."""
    hdir = harden_dir(repo)
    hdir.mkdir(parents=True, exist_ok=True)
    if is_repo:
        rel = git_ok(repo, ["rev-parse", "--git-path", "info/exclude"])
        if rel:
            exclude = Path(rel) if os.path.isabs(rel) else (repo / rel)
            exclude.parent.mkdir(parents=True, exist_ok=True)
            existing = read_text(exclude) if exclude.exists() else ""
            lines = [ln.strip() for ln in existing.splitlines()]
            if not {"/.harden/", ".harden/", "/.harden", ".harden"} & set(lines):
                with open(exclude, "a", encoding="utf-8", newline="\n") as handle:
                    if existing and not existing.endswith("\n"):
                        handle.write("\n")
                    handle.write("# /harden run directory (added by harden scripts)\n/.harden/\n")
    return hdir


def load_inventory(repo: Path, path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    """Load `.harden/inventory.json` (or `path`); None when missing or unreadable."""
    target = path or (harden_dir(repo) / "inventory.json")
    if not target.is_file():
        return None
    try:
        data = read_json(target)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


# ---------------------------------------------------------------------------
# Glob matching
# ---------------------------------------------------------------------------

_GLOB_CACHE: Dict[str, "re.Pattern[str]"] = {}


def glob_to_regex(pattern: str) -> "re.Pattern[str]":
    """Compile a glob (dialect described in the module docstring) to a regex."""
    cached = _GLOB_CACHE.get(pattern)
    if cached is not None:
        return cached
    pat = to_posix(pattern.strip())
    dir_only = pat.endswith("/")
    core = pat.rstrip("/")
    anchored = "/" in core
    if core.startswith("/"):
        core = core[1:]
    if dir_only:
        core = core + "/**"
    out: List[str] = []
    i = 0
    while i < len(core):
        if core.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif core.startswith("**", i):
            out.append(".*")
            i += 2
        elif core[i] == "*":
            out.append("[^/]*")
            i += 1
        elif core[i] == "?":
            out.append("[^/]")
            i += 1
        elif core[i] == "[":
            j = core.find("]", i + 2)
            if j == -1:
                out.append(re.escape("["))
                i += 1
            else:
                body = core[i + 1:j]
                if body.startswith("!"):
                    body = "^" + body[1:]
                out.append("[" + body.replace("\\", "\\\\") + "]")
                i = j + 1
        else:
            out.append(re.escape(core[i]))
            i += 1
    body = "".join(out)
    if not anchored:
        body = "(?:.*/)?" + body
    compiled = re.compile("^" + body + "$")
    _GLOB_CACHE[pattern] = compiled
    return compiled


def glob_match(path: str, pattern: str) -> bool:
    """True when the repo-relative path matches the glob."""
    return bool(glob_to_regex(pattern).match(to_posix(path)))


def match_any(path: str, patterns: Iterable[str]) -> bool:
    """True when the path matches at least one glob."""
    return any(glob_match(path, p) for p in patterns)


def portable_globs(pattern: str) -> List[str]:
    """Return glob variants that match the same files under both this module's dialect and
    `fnmatch` (where `*` also crosses `/`, and a leading `**/` needs at least one directory).

    `tests/**`-style directory patterns become [`tests/**`, `**/tests/**`]; bare file-name
    patterns (`test_*.py`) become [`test_*.py`, `**/test_*.py`]. Anchored paths are unchanged.
    """
    p = to_posix(pattern)
    if p.startswith("**/"):
        return [p[3:], p]
    if "/" not in p.rstrip("/"):
        return [p, "**/" + p]
    return [p]


# ---------------------------------------------------------------------------
# Path classification
# ---------------------------------------------------------------------------

# One table for every extension-based decision of the scripts, so that inventory.py (languages),
# prescan.py (comment syntax) and diff_guard.py (code files scanned line by line) cannot drift
# apart: extension -> (language or None, comment style or None, diff_guard code file).
# Comment styles: "c" (// and /* */), "rust" (// and /* */, double quotes only), "hash" (#),
# "powershell" (# and <# #>), "dash" (-- and /* */), "html" (<!-- -->), "html_c" (both).
# A language of None means "no language mapping": inventory.py reports such files under
# unmapped_extensions. ".ipynb" is JSON: its lines are not scanned as code, and its LOC are the
# non-blank lines of its code cells (notebook_code_loc).
EXTENSION_TABLE: Dict[str, Tuple[Optional[str], Optional[str], bool]] = {
    ".ts": ("TypeScript", "c", True), ".tsx": ("TypeScript", "c", True),
    ".mts": ("TypeScript", "c", True), ".cts": ("TypeScript", "c", True),
    ".js": ("JavaScript", "c", True), ".jsx": ("JavaScript", "c", True),
    ".mjs": ("JavaScript", "c", True), ".cjs": ("JavaScript", "c", True),
    ".py": ("Python", "hash", True), ".pyi": ("Python", "hash", True),
    ".pyx": ("Python", "hash", True),
    ".ipynb": ("Jupyter Notebook", None, False),
    ".rs": ("Rust", "rust", True),
    ".go": ("Go", "c", True),
    ".c": ("C", "c", True), ".h": ("C", "c", True),
    ".cc": ("C++", "c", True), ".cpp": ("C++", "c", True), ".cxx": ("C++", "c", True),
    ".c++": ("C++", "c", True), ".hh": ("C++", "c", True), ".hpp": ("C++", "c", True),
    ".hxx": ("C++", "c", True), ".h++": ("C++", "c", True), ".ipp": ("C++", "c", True),
    ".tpp": ("C++", "c", True), ".inl": ("C++", "c", True),
    ".sol": ("Solidity", "c", True),
    ".vy": ("Vyper", "hash", True),
    ".java": ("Java", "c", True),
    ".kt": ("Kotlin", "c", True), ".kts": ("Kotlin", "c", True),
    ".scala": ("Scala", "c", True),
    ".cs": ("C#", "c", True),
    ".swift": ("Swift", "c", True),
    ".dart": ("Dart", "c", True),
    ".php": ("PHP", "c", True),
    ".groovy": ("Groovy", "c", False), ".gradle": ("Groovy", "c", False),
    ".proto": ("Protocol Buffers", "c", False),
    ".zig": ("Zig", "c", False),
    ".rb": ("Ruby", "hash", True), ".rake": ("Ruby", "hash", False),
    ".gemspec": ("Ruby", "hash", False),
    ".ex": ("Elixir", "hash", True), ".exs": ("Elixir", "hash", True),
    ".sh": ("Shell", "hash", True), ".bash": ("Shell", "hash", True),
    ".zsh": ("Shell", "hash", True), ".ksh": ("Shell", "hash", False),
    ".fish": ("Shell", "hash", False),
    ".ps1": ("PowerShell", "powershell", True), ".psm1": ("PowerShell", "powershell", True),
    ".psd1": ("PowerShell", "powershell", False),
    ".pl": ("Perl", "hash", False), ".pm": ("Perl", "hash", False),
    ".r": ("R", "hash", False),
    ".jl": ("Julia", "hash", False),
    ".nim": ("Nim", "hash", False),
    ".cr": ("Crystal", "hash", False),
    ".coffee": ("CoffeeScript", "hash", False),
    ".nix": ("Nix", "hash", False),
    ".tf": ("Terraform", "hash", False), ".tfvars": ("Terraform", "hash", False),
    ".cmake": ("CMake", "hash", False), ".mk": ("Makefile", "hash", False),
    ".lua": ("Lua", "dash", True),
    ".sql": ("SQL", "dash", False),
    ".hs": ("Haskell", "dash", False),
    ".elm": ("Elm", "dash", False),
    ".ada": ("Ada", "dash", False),
    ".vue": ("Vue", "html_c", True), ".svelte": ("Svelte", "html_c", True),
    ".astro": ("Astro", "html_c", True),
    ".html": ("HTML", "html", False), ".htm": ("HTML", "html", False),
    ".xhtml": ("HTML", "html", False),
    ".xml": (None, "html", False), ".svg": (None, "html", False),
    ".css": ("CSS", "c", False), ".scss": ("CSS", "c", False), ".sass": ("CSS", "c", False),
    ".less": ("CSS", "c", False),
    ".jsonc": (None, "c", False), ".json5": (None, "c", False),
    ".yml": ("YAML", None, False), ".yaml": ("YAML", None, False),
    ".md": ("Markdown", None, False), ".markdown": ("Markdown", None, False),
    ".mdx": ("Markdown", None, False),
}

EXTENSION_LANGUAGES: Dict[str, str] = {
    ext: lang for ext, (lang, _style, _code) in EXTENSION_TABLE.items() if lang is not None}
# Files diff_guard.py scans line by line for test-gaming patterns (and, in --quick mode, for
# new suppressions and skip markers).
CODE_EXTENSIONS: Set[str] = {ext for ext, (_l, _s, code) in EXTENSION_TABLE.items() if code}


def extensions_with_comment_style(style: str) -> Set[str]:
    """Extensions whose comments use `style` (a comment-style name of EXTENSION_TABLE)."""
    return {ext for ext, (_lang, s, _code) in EXTENSION_TABLE.items() if s == style}


def file_extension(path: str) -> str:
    """Lower-case extension of the last path segment ('' when there is none)."""
    return os.path.splitext(path.rsplit("/", 1)[-1].lower())[1]


def notebook_code_loc(data: bytes) -> Optional[int]:
    """Non-blank lines of the code cells of a Jupyter notebook (nbformat 3 or 4).

    A notebook is JSON; its JSON line count says nothing about what a reader must examine (one
    embedded image can be most of the file). None when the data is not a notebook.
    """
    try:
        doc = json.loads(data.decode("utf-8-sig", errors="replace"))
    except ValueError:
        return None
    if not isinstance(doc, dict):
        return None
    cells: List[Any] = []
    if isinstance(doc.get("cells"), list):
        cells = doc["cells"]
    elif isinstance(doc.get("worksheets"), list):  # nbformat 3
        for sheet in doc["worksheets"]:
            if isinstance(sheet, dict) and isinstance(sheet.get("cells"), list):
                cells.extend(sheet["cells"])
    else:
        return None
    total = 0
    for cell in cells:
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            continue
        source = cell.get("source", cell.get("input", ""))
        text = "".join(s for s in source if isinstance(s, str)) if isinstance(source, list) \
            else (source if isinstance(source, str) else "")
        total += sum(1 for line in text.splitlines() if line.strip())
    return total


# Masking constructs in gate commands, scripts and CI steps: the step can pass while the tool
# failed (build-ci-infra G107-F01 detect regex, transcribed). Used by inventory.py, gates.py and
# diff_guard.py (config weakening in approved config edits).
MASKING_RE = re.compile(r"continue-on-error:\s*true|\|\|\s*(?:true|:|exit 0)(?![\w-])"
                        r"|allow_failure:\s*true|--passWithNoTests|--soft-fail|--no-fail"
                        r"|--exit-code 0(?!\d)|set \+e")

FILENAME_LANGUAGES: Dict[str, str] = {
    "makefile": "Makefile", "gnumakefile": "Makefile",
    "dockerfile": "Dockerfile", "containerfile": "Dockerfile",
    "cmakelists.txt": "CMake",
    "gemfile": "Ruby", "rakefile": "Ruby",
    "justfile": "Justfile",
}

# Languages that are documentation or configuration, not program source.
NON_SOURCE_LANGUAGES = {"Markdown", "YAML"}

# Languages whose indentation is significant: whitespace-ignoring diffs would hide real edits
# (hotspot-evidence G104-F06: "Drop -w for Python, YAML, Makefiles and other languages where
# indentation matters").
INDENT_SENSITIVE_LANGUAGES = {"Python", "YAML", "Makefile"}
INDENT_SENSITIVE_EXTENSIONS = {".sass", ".haml", ".pug", ".coffee", ".nim", ".slim", ".styl"}

LOCKFILE_MANAGERS: Dict[str, str] = {
    "package-lock.json": "npm", "npm-shrinkwrap.json": "npm", "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn", "bun.lockb": "bun", "bun.lock": "bun", "deno.lock": "deno",
    "cargo.lock": "cargo", "poetry.lock": "poetry", "uv.lock": "uv", "pipfile.lock": "pipenv",
    "pdm.lock": "pdm", "gemfile.lock": "bundler", "composer.lock": "composer", "go.sum": "go",
    "go.work.sum": "go", "flake.lock": "nix", "packages.lock.json": "nuget",
    "gradle.lockfile": "gradle", "package.resolved": "swiftpm", "pubspec.lock": "pub",
    "mix.lock": "mix", "conda-lock.yml": "conda",
}

# Directory names treated as vendored / third-party or dependency trees.
VENDOR_DIR_NAMES = {"node_modules", "vendor", "third_party", "third-party", "bower_components",
                    ".venv", "venv", "site-packages"}
# Directory names treated as build output or generated code (G104-F06 excludes dist/, build/,
# generated/, vendor/; the others are the usual output directories of the same toolchains).
BUILD_DIR_NAMES = {"dist", "build", "target", "out", ".next", ".nuxt", ".svelte-kit", ".turbo",
                   "coverage", "__pycache__", "generated", "__generated__"}
SNAPSHOT_DIR_NAMES = {"__snapshots__"}

# Header markers of generated files (MegaLinter's IGNORE_GENERATED_FILES looks for "@generated",
# polyglot-tooling T25-F01; "do not edit" / "auto-generated" are the common codegen banners).
# Only the file header is scanned to avoid matching prose.
GENERATED_MARKER_RE = re.compile(r"@generated|do not edit|auto-generated|autogenerated", re.I)
GENERATED_HEADER_LINES = 10

TEST_DIR_NAMES = {"test", "tests", "__tests__", "spec", "specs", "e2e", "__mocks__", "testdata"}
TEST_FILE_RES = [
    re.compile(r"^test_.+\.py$"), re.compile(r".+_test\.py$"), re.compile(r"^conftest\.py$"),
    re.compile(r".+_test\.go$"),
    re.compile(r".+\.(test|spec)\.[cm]?[jt]sx?$"),
    re.compile(r".+\.t\.sol$"),
    re.compile(r".+Tests?\.(java|kt|cs)$"),
    re.compile(r".+_spec\.rb$"), re.compile(r".+_test\.rb$"),
    re.compile(r".+Tests?\.swift$"),
    re.compile(r".+_test\.(c|cc|cpp|cxx)$"), re.compile(r"^test_.+\.(c|cc|cpp|cxx)$"),
    re.compile(r".+\.Tests?\.ps1$"),
]

DOC_DIR_NAMES = {"docs", "doc", "documentation"}
DOC_EXTENSIONS = {".md", ".markdown", ".mdx", ".rst", ".adoc", ".asciidoc"}


def language_of(path: str) -> Optional[str]:
    """Language name for a path, from its file name or extension (None when unmapped)."""
    base = path.rsplit("/", 1)[-1]
    lower = base.lower()
    if lower in FILENAME_LANGUAGES:
        return FILENAME_LANGUAGES[lower]
    if lower.startswith("dockerfile") or lower.endswith(".dockerfile"):
        return "Dockerfile"
    ext = os.path.splitext(lower)[1]
    return EXTENSION_LANGUAGES.get(ext)


def is_source_language(language: Optional[str]) -> bool:
    """True for program-source languages (everything mapped except docs and YAML)."""
    return language is not None and language not in NON_SOURCE_LANGUAGES


def is_indent_sensitive(path: str) -> bool:
    """True when whitespace-only diffs are meaningful for this file."""
    if language_of(path) in INDENT_SENSITIVE_LANGUAGES:
        return True
    return os.path.splitext(path.lower())[1] in INDENT_SENSITIVE_EXTENSIONS


def lockfile_manager(path: str) -> Optional[str]:
    """Package manager owning a lockfile path, or None. Any `*.lock` counts as a lockfile."""
    base = path.rsplit("/", 1)[-1].lower()
    if base in LOCKFILE_MANAGERS:
        return LOCKFILE_MANAGERS[base]
    if base.endswith(".lock"):
        return "unknown"
    return None


def path_segments(path: str) -> List[str]:
    """Split a repo-relative path into segments."""
    return to_posix(path).split("/")


def is_test_path(path: str) -> bool:
    """True for test code (by directory or file-name convention)."""
    segs = path_segments(path)
    if any(s.lower() in TEST_DIR_NAMES for s in segs[:-1]):
        return True
    base = segs[-1]
    return any(rx.match(base) for rx in TEST_FILE_RES)


def is_snapshot_path(path: str) -> bool:
    """True for snapshot / golden files that tests compare against."""
    segs = path_segments(path)
    if any(s in SNAPSHOT_DIR_NAMES for s in segs[:-1]):
        return True
    return segs[-1].endswith(".snap")


def is_doc_path(path: str) -> bool:
    """True for documentation files."""
    segs = path_segments(path)
    ext = os.path.splitext(segs[-1].lower())[1]
    if ext in DOC_EXTENSIONS:
        return True
    return any(s.lower() in DOC_DIR_NAMES for s in segs[:-1]) and ext in {".txt", ".html", ".htm"}


# Yarn 2+ keeps its own release, plugins, editor SDKs and cache under .yarn/, and writes the
# Plug'n'Play files at the root (yarnpkg.com Q&A "Which files should be gitignored?"; A01-F39).
YARN_TOOL_DIRS = frozenset(["releases", "plugins", "sdks", "cache", "unplugged"])
YARN_PNP_FILES = frozenset([".pnp.cjs", ".pnp.js", ".pnp.loader.mjs", ".pnp.data.json"])


def _yarn_prefix(segs: Sequence[str]) -> Optional[str]:
    """The `.../.yarn/<dir>/` prefix of a path under a Yarn tool directory, else None."""
    for idx in range(len(segs) - 2):
        if segs[idx] == ".yarn" and segs[idx + 1] in YARN_TOOL_DIRS:
            return "/".join(segs[:idx + 2]) + "/"
    return None


def path_generated_reason(path: str, vendor_prefixes: Sequence[str] = ()) -> Optional[str]:
    """Return why a path is generated/vendored/build output from its path alone, else None.

    `vendor_prefixes` are extra directory prefixes (ending with '/') known to be vendored,
    e.g. git submodules or a Foundry `lib/` directory.
    """
    p = to_posix(path)
    for prefix in vendor_prefixes:
        if p.startswith(prefix):
            return "vendored directory " + prefix
    segs = p.split("/")
    yarn = _yarn_prefix(segs)
    if yarn:
        return ("Yarn-managed directory {} (the package manager's own release, plugins, editor "
                "SDKs or cache; yarnpkg.com Q&A; pilot-auto-calibration A01-F39)".format(yarn))
    if len(segs) == 1 and segs[0] in YARN_PNP_FILES:
        return "Yarn Plug'n'Play file written by yarn install"
    for idx, seg in enumerate(segs[:-1]):
        if seg in VENDOR_DIR_NAMES:
            return "vendored/dependency directory " + "/".join(segs[:idx + 1]) + "/"
        if seg in BUILD_DIR_NAMES:
            return "build output or generated directory " + "/".join(segs[:idx + 1]) + "/"
    base = segs[-1].lower()
    if ".min." in base:
        return "minified file"
    if ".generated." in base:
        return "generated file name"
    return None


def generated_dir_prefix(path: str, vendor_prefixes: Sequence[str] = ()) -> Optional[str]:
    """Directory prefix (with trailing '/') responsible for a path-based generated verdict."""
    p = to_posix(path)
    for prefix in vendor_prefixes:
        if p.startswith(prefix):
            return prefix
    segs = p.split("/")
    yarn = _yarn_prefix(segs)
    if yarn:
        return yarn
    for idx, seg in enumerate(segs[:-1]):
        if seg in VENDOR_DIR_NAMES or seg in BUILD_DIR_NAMES:
            return "/".join(segs[:idx + 1]) + "/"
    return None


def header_has_generated_marker(text_head: str) -> bool:
    """True when the first lines of a file carry a generated-code marker."""
    head = "\n".join(text_head.splitlines()[:GENERATED_HEADER_LINES])
    return bool(GENERATED_MARKER_RE.search(head))


def count_loc(data: bytes, path: Optional[str] = None) -> Optional[int]:
    """Non-blank physical lines; None for binary content (NUL byte in the first 8 KiB).

    With a `.ipynb` path, the non-blank lines of the notebook's code cells when it parses
    (notebook_code_loc), else its physical lines.
    """
    if b"\0" in data[:8192]:
        return None
    if path is not None and file_extension(path) == ".ipynb":
        cells = notebook_code_loc(data)
        if cells is not None:
            return cells
    text = data.decode("utf-8", errors="replace")
    return sum(1 for line in text.splitlines() if line.strip())


def generated_entries_matcher(entries: Iterable[Dict[str, Any]]) -> Callable[[str], bool]:
    """Build a predicate from inventory `generated_or_vendor` entries (files or dir prefixes)."""
    files: Set[str] = set()
    prefixes: List[str] = []
    for entry in entries:
        p = to_posix(str(entry.get("path", "")))
        if not p:
            continue
        if p.endswith("/"):
            prefixes.append(p)
        else:
            files.add(p)

    def matcher(path: str) -> bool:
        p = to_posix(path)
        return p in files or any(p.startswith(pre) for pre in prefixes)

    return matcher


# ---------------------------------------------------------------------------
# File listing
# ---------------------------------------------------------------------------

WALK_SKIP_DIRS = {".git", ".hg", ".svn", HARDEN_DIR_NAME, "node_modules", ".venv", "venv",
                  "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox",
                  ".cache", ".next", ".turbo", ".gradle", ".idea", ".vscode"}


def list_files(repo: Path, is_repo: bool) -> Tuple[List[str], str]:
    """Return (repo-relative POSIX paths of regular files, source description).

    Git repositories use `git ls-files` (tracked files only). Other directories fall back to a
    filesystem walk that skips VCS, cache and dependency directories.
    """
    if is_repo:
        raw = git_bytes(repo, ["ls-files", "-z"]).decode("utf-8", errors="replace")
        files = sorted({to_posix(p) for p in raw.split("\0") if p})
        return [f for f in files if (repo / f).is_file()], "git ls-files"
    result: List[str] = []
    for dirpath, dirnames, filenames in os.walk(str(repo)):
        dirnames[:] = sorted(d for d in dirnames if d not in WALK_SKIP_DIRS)
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = to_posix(os.path.relpath(full, str(repo)))
            if os.path.isfile(full):
                result.append(rel)
    return sorted(result), "filesystem walk (not a git repository)"


def parse_gitmodules(repo: Path) -> List[str]:
    """Submodule paths (with trailing '/') declared in .gitmodules."""
    gm = repo / ".gitmodules"
    if not gm.is_file():
        return []
    paths = []
    for line in read_text(gm).splitlines():
        m = re.match(r"\s*path\s*=\s*(.+?)\s*$", line)
        if m:
            paths.append(to_posix(m.group(1)).rstrip("/") + "/")
    return paths


def linguist_attributes(repo: Path, files: Sequence[str]) -> Dict[str, str]:
    """Map path -> reason for files marked linguist-generated / linguist-vendored in .gitattributes."""
    if not files:
        return {}
    payload = ("\0".join(files) + "\0").encode("utf-8")
    try:
        out = git_bytes(repo, ["check-attr", "-z", "--stdin", "linguist-generated",
                               "linguist-vendored"], input_bytes=payload)
    except GitError:
        return {}
    toks = out.decode("utf-8", errors="replace").split("\0")
    result: Dict[str, str] = {}
    for i in range(0, len(toks) - 2, 3):
        path, attr, value = toks[i], toks[i + 1], toks[i + 2]
        if value in ("set", "true"):
            result[to_posix(path)] = ".gitattributes " + attr
    return result


# ---------------------------------------------------------------------------
# Git history model
# ---------------------------------------------------------------------------

# Fix-commit label regex, transcribed from hotspot-evidence G104-F08 (POSIX ERE, case-insensitive):
#   (^|[^[:alpha:]])(fix(e[sd]|ing)?|bugs?|hotfix|regression)([^[:alpha:]]|$)
# Convention, and a noisy label (Herzig et al., Herbold et al. via G104-F08). It deliberately does
# not match "prefix", "fixture" or "bugfix" (letters on both sides), exactly like the dossier regex.
FIX_REGEX_POSIX = r"(^|[^[:alpha:]])(fix(e[sd]|ing)?|bugs?|hotfix|regression)([^[:alpha:]]|$)"
FIX_RE = re.compile(r"(?<![A-Za-z])(?:fix(?:e[sd]|ing)?|bugs?|hotfix|regression)(?![A-Za-z])",
                    re.IGNORECASE)
# Conventional Commits fix label (G104-F08: "a cleaner label" when the repo uses the convention).
CONVENTIONAL_FIX_RE = re.compile(r"^fix(\([^)]*\))?!?:", re.IGNORECASE)
CONVENTIONAL_ANY_RE = re.compile(
    r"^(feat|fix|chore|docs|refactor|test|tests|perf|ci|build|style|revert)(\([^)]*\))?!?:",
    re.IGNORECASE)
# GitHub squash-merge subject suffix "(#123)" (G104-F09: a GitHub convention, check it per repo).
PR_SUFFIX_RE = re.compile(r"[(]#[0-9]+[)]$")

AGENT_NAMES = ("claude", "copilot", "cursor", "codex", "aider", "devin", "gemini")
AGENT_TRAILER_RE = re.compile(
    r"^\W*(?:co-authored-by|generated[ -]with|generated[ -]by)\b[^\n]*?\b("
    + "|".join(AGENT_NAMES) + r")\b",
    re.IGNORECASE | re.MULTILINE)

# Files whose first commit marks agent adoption (hotspot-evidence G104-F10).
AGENT_CONFIG_PATHSPECS = [
    ".cursorrules", ".cursor", ".claude", ":(glob)**/CLAUDE.md", ":(glob)**/AGENTS.md",
    ".github/copilot-instructions.md", ".windsurfrules",
]

_HEADER_RE = re.compile(r"^@@([0-9a-f]{40,64})$")
_HEX_SHA_RE = re.compile(r"^([0-9a-f]{40}(?:[0-9a-f]{24})?)\b")


@dataclass
class NumstatRow:
    """One `--numstat` row; `old_path` is set for renames/copies."""
    added: Optional[int]
    deleted: Optional[int]
    old_path: Optional[str]
    path: str


@dataclass
class Event:
    """One filtered change of one file in one commit (path folded to its current name)."""
    sha: str
    ct: int
    path: str
    churn: int          # lines added+deleted; 0 for bulk commits (G104-F07)
    raw_churn: int      # lines added+deleted before bulk zeroing
    is_fix: bool
    is_bulk: bool


@dataclass
class CommitRecord:
    """A first-parent, non-merge commit with its filtered change events."""
    sha: str
    ct: int
    author_email: str
    parents: List[str]
    subject: str
    message: str
    is_fix: bool = False
    is_conventional_fix: bool = False
    agent_names: List[str] = field(default_factory=list)
    files_touched: int = 0
    ignored: bool = False
    is_bulk: bool = False
    events: List[Event] = field(default_factory=list)

    @property
    def filtered(self) -> bool:
        """True when at least one change survived the noise filters."""
        return bool(self.events)

    @property
    def is_merge(self) -> bool:
        """True for merge commits (more than one parent)."""
        return len(self.parents) > 1


@dataclass
class History:
    """Filtered first-parent history, newest commit first (see load_history for merges)."""
    commits: List[CommitRecord]
    alias: Dict[str, str]
    p99_files: Optional[int]
    ignore_revs: Set[str]
    whitespace_mode: str
    merge_mode: str = "first-parent merges excluded (--no-merges)"

    def filtered_commits(self) -> List[CommitRecord]:
        """Commits with at least one surviving change event."""
        return [c for c in self.commits if c.filtered]

    def events(self) -> List[Event]:
        """All surviving change events."""
        out: List[Event] = []
        for c in self.commits:
            out.extend(c.events)
        return out

    def resolve(self, path: str) -> str:
        """Current name of a (possibly old) path."""
        return resolve_alias(self.alias, path)


def resolve_alias(alias: Dict[str, str], path: str) -> str:
    """Follow the rename chain old -> newer -> current (bounded, like the dossier awk script)."""
    seen = 0
    while path in alias and seen < 50:
        path = alias[path]
        seen += 1
    return path


def parse_numstat_z(data: str) -> Dict[str, List[NumstatRow]]:
    """Parse `git log --numstat -z --format=@@%H` output into sha -> rows.

    Normal rows are `added TAB deleted TAB path NUL`; renames are `added TAB deleted TAB NUL old
    NUL new NUL`. Binary files report '-' counts (stored as None). Each commit header is followed
    by NUL and a newline, which is stripped before parsing the next token.
    """
    result: Dict[str, List[NumstatRow]] = {}
    toks = data.split("\0")
    cur: Optional[str] = None
    i = 0
    while i < len(toks):
        tok = toks[i].lstrip("\n")
        i += 1
        if not tok:
            continue
        head = _HEADER_RE.match(tok)
        if head:
            cur = head.group(1)
            result.setdefault(cur, [])
            continue
        parts = tok.split("\t", 2)
        if cur is None or len(parts) != 3:
            continue
        a, d, path = parts
        added = int(a) if a.isdigit() else None
        deleted = int(d) if d.isdigit() else None
        if path == "":
            old = toks[i] if i < len(toks) else ""
            new = toks[i + 1] if i + 1 < len(toks) else ""
            i += 2
            result[cur].append(NumstatRow(added, deleted, to_posix(old), to_posix(new)))
        else:
            result[cur].append(NumstatRow(added, deleted, None, to_posix(path)))
    return result


def read_ignore_revs(repo: Path) -> Set[str]:
    """Full SHAs listed in .git-blame-ignore-revs (G104-F06: extract 40-hex SHAs first, so blank
    lines and comments cannot empty the filter)."""
    f = repo / ".git-blame-ignore-revs"
    if not f.is_file():
        return set()
    shas = set()
    for line in read_text(f).splitlines():
        m = _HEX_SHA_RE.match(line.strip().lower())
        if m:
            shas.add(m.group(1))
    return shas


def p99_threshold(counts: Sequence[int]) -> Optional[int]:
    """99th percentile of files touched per commit, computed exactly like the G104-F07 awk:
    sort ascending, i = int(N * 0.99) (at least 1), take the i-th value (1-indexed)."""
    if not counts:
        return None
    ordered = sorted(counts)
    idx = int(len(ordered) * 0.99)
    if idx < 1:
        idx = 1
    return ordered[idx - 1]


def load_commit_metadata(repo: Path, first_parent: bool = True,
                         include_merges: bool = False) -> List[CommitRecord]:
    """Commits reachable from HEAD, newest first, with full messages.

    `first_parent=True` gives the mainline the ranking uses (G104-F06/F09); False lists every
    commit (used to count attribution trailers that live on merged branches). Merge commits are
    left out unless `include_merges` is True.
    """
    args = ["log", "-z", "--format=%H%x1f%ct%x1f%aE%x1f%P%x1f%B"]
    if not include_merges:
        args.insert(1, "--no-merges")
    if first_parent:
        args.insert(1, "--first-parent")
    raw = git(repo, args, check=False)
    commits: List[CommitRecord] = []
    for rec in raw.split("\0"):
        rec = rec.lstrip("\n")
        if not rec:
            continue
        parts = rec.split("\x1f", 4)
        if len(parts) < 5 or not re.match(r"^[0-9a-f]{40,64}$", parts[0]):
            continue
        sha, ct, email, parents, message = parts
        message = message.rstrip("\n")
        subject = message.split("\n", 1)[0].strip()
        rec_obj = CommitRecord(sha=sha, ct=int(ct) if ct.isdigit() else 0,
                               author_email=email.strip().lower(), parents=parents.split(),
                               subject=subject, message=message)
        rec_obj.is_fix = bool(FIX_RE.search(message))
        rec_obj.is_conventional_fix = bool(CONVENTIONAL_FIX_RE.match(subject))
        rec_obj.agent_names = sorted({m.group(1).lower() for m in AGENT_TRAILER_RE.finditer(message)})
        commits.append(rec_obj)
    return commits


MERGES_AS_EVENTS = ("first-parent merge commits counted as one change event per file (their diff "
                    "against the first parent), like squash commits (G104-F09)")
MERGES_EXCLUDED = "first-parent merges excluded (--no-merges); git lacks --diff-merges"


def load_history(repo: Path, is_excluded: Callable[[str], bool]) -> History:
    """Build the filtered history model described in hotspot-evidence G104-F01/F06/F07/F09.

    Filters (all conventions from the dossier):
      - first-parent history only (`--first-parent`), so branch commits are not counted twice;
      - merge commits: the dossier recipe is `--first-parent --no-merges`, which is exact for
        squash/rebase workflows but, in a merge-commit workflow, drops every change that reached
        the mainline through a merge. Each first-parent merge is therefore counted as ONE change
        event per file, using its diff against the first parent (`--diff-merges=first-parent`),
        which is how G104-F09 counts squash commits. On git without --diff-merges (< 2.31) the
        literal `--no-merges` recipe is used and History.merge_mode says so;
      - rename detection `-M` (default 50% similarity), renames folded into the current path;
      - whitespace-only edits dropped with `-w --ignore-blank-lines`, except for
        indentation-sensitive files (Python, YAML, Makefiles...) where the plain diff is used;
      - pure renames (0/0 rows) are not change events;
      - commits listed in .git-blame-ignore-revs are skipped;
      - generated, vendored, lock, minified and snapshot paths are skipped (`is_excluded`);
      - bulk commits (files touched above the repo's 99th percentile) count as one event per file
        with zero line churn (G104-F07).
    """
    tail = ["-M", "--numstat", "--no-textconv", "-z", "--format=@@%H"]
    merge_mode = MERGES_AS_EVENTS
    head = ["log", "--first-parent", "--diff-merges=first-parent"]
    try:
        raw_text = git(repo, head + tail, check=True)
    except GitError as exc:
        if "diff-merges" not in str(exc):
            raw_text = ""
        else:
            merge_mode = MERGES_EXCLUDED
            head = ["log", "--first-parent", "--no-merges"]
            raw_text = git(repo, head + tail, check=False)
    commits = load_commit_metadata(repo, first_parent=True,
                                   include_merges=merge_mode == MERGES_AS_EVENTS)
    raw_rows = parse_numstat_z(raw_text)
    ws_rows = parse_numstat_z(git(repo, head + ["-w", "--ignore-blank-lines"] + tail,
                                  check=False))
    ignore_revs = read_ignore_revs(repo)

    for c in commits:
        c.files_touched = len(raw_rows.get(c.sha, []))
        c.ignored = c.sha in ignore_revs
    p99 = p99_threshold([c.files_touched for c in commits])

    alias: Dict[str, str] = {}
    for c in commits:  # newest first, which rename folding needs
        rows = raw_rows.get(c.sha, [])
        resolved: List[Tuple[NumstatRow, str]] = []
        for row in rows:
            if row.old_path is not None:
                cur = resolve_alias(alias, row.path)
                if row.old_path != cur:
                    alias[row.old_path] = cur
                resolved.append((row, cur))
            else:
                resolved.append((row, resolve_alias(alias, row.path)))
        c.is_bulk = p99 is not None and c.files_touched > p99
        if c.ignored:
            continue
        ws_by_path = {r.path: r for r in ws_rows.get(c.sha, [])}
        for row, cur in resolved:
            if is_excluded(cur) or is_excluded(row.path):
                continue
            chosen = row if is_indent_sensitive(cur) else ws_by_path.get(row.path)
            if chosen is None:
                continue  # whitespace-only change in a whitespace-insensitive language
            if row.old_path is not None and chosen.added == 0 and chosen.deleted == 0:
                continue  # pure rename
            raw_churn = (chosen.added or 0) + (chosen.deleted or 0)
            c.events.append(Event(sha=c.sha, ct=c.ct, path=cur,
                                  churn=0 if c.is_bulk else raw_churn, raw_churn=raw_churn,
                                  is_fix=c.is_fix, is_bulk=c.is_bulk))
    return History(commits=commits, alias=alias, p99_files=p99, ignore_revs=ignore_revs,
                   whitespace_mode="-w --ignore-blank-lines except indentation-sensitive files",
                   merge_mode=merge_mode)


def agent_config_adoption(repo: Path) -> Tuple[Optional[int], Optional[str]]:
    """Earliest commit time at which an agent configuration file was added, and that path
    (G104-F10: adoption dated from committed config files, as He et al. did)."""
    out = git(repo, ["log", "--diff-filter=A", "--format=@@%ct", "--name-only", "--"]
              + AGENT_CONFIG_PATHSPECS, check=False)
    best_ct: Optional[int] = None
    best_path: Optional[str] = None
    cur_ct: Optional[int] = None
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("@@"):
            val = line[2:]
            cur_ct = int(val) if val.isdigit() else None
            continue
        if cur_ct is not None and (best_ct is None or cur_ct < best_ct):
            best_ct, best_path = cur_ct, to_posix(line)
    return best_ct, best_path


def agent_adoption(repo: Path, commits: Sequence[CommitRecord] = ()) -> Tuple[Optional[int], Optional[str]]:
    """Earliest evidence of agent use: an agent config file (G104-F10) or, when earlier, a commit
    carrying an agent attribution trailer. Returns (timestamp, human-readable marker)."""
    ct, path = agent_config_adoption(repo)
    marker = "config file {}".format(path) if path else None
    trailer = [c for c in commits if c.agent_names]
    if trailer:
        first = min(trailer, key=lambda c: c.ct)
        if ct is None or first.ct < ct:
            ct = first.ct
            marker = "agent trailer ({}) in commit {}".format(",".join(first.agent_names),
                                                            first.sha[:12])
    return ct, marker


# History-sufficiency thresholds (hotspot-evidence G104-F04, grade C, all transferred conventions).
S1_MIN_COMMITS = 150
S2_MIN_DAYS = 122        # ~4 months (4 x 30.44 days)
S2_PREFERRED_DAYS = 183  # ~6 months
S3_MIN_FIXES = 25        # "~25 is an analogy, not a validated number"
S4_MAX_BULK_SHARE = 0.5
S5_MAX_AGENT_SHARE = 0.5

SECONDS_PER_DAY = 86400
HALF_LIFE_DAYS_DEFAULT = 90  # hl = 7776000 s in G104-F01/F11 (a convention)


def evaluate_sufficiency(history: History, adoption_ct: Optional[int],
                         adoption_source: Optional[str], shallow: bool) -> Dict[str, Any]:
    """Apply the G104-F04 gate (S1-S5) to the filtered history.

    PASS requires S1-S3; S4 and S5 are also required because failing them "means using change
    counts only as a tie-breaker" inside the fallback ladder, i.e. no history-first ranking.
    """
    filtered = history.filtered_commits()
    n = len(filtered)
    fixes = sum(1 for c in filtered if c.is_fix)
    span_days: Optional[float] = None
    first_ct = last_ct = None
    if filtered:
        first_ct = min(c.ct for c in filtered)
        last_ct = max(c.ct for c in filtered)
        span_days = round((last_ct - first_ct) / SECONDS_PER_DAY, 1)
    all_events = history.events()
    total_churn = sum(e.raw_churn for e in all_events)
    bulk_churn = sum(e.raw_churn for e in all_events if e.is_bulk)
    bulk_share = (bulk_churn / total_churn) if total_churn else 0.0
    after_adoption = 0
    if adoption_ct is not None:
        after_adoption = sum(1 for c in filtered if c.ct >= adoption_ct)
    agent_share = (after_adoption / n) if (n and adoption_ct is not None) else 0.0

    criteria: Dict[str, Dict[str, Any]] = {
        "S1_filtered_commits": {"value": n, "threshold": ">= %d" % S1_MIN_COMMITS,
                                "pass": n >= S1_MIN_COMMITS},
        "S2_span_days": {"value": span_days, "threshold": ">= %d (>= %d preferred)"
                         % (S2_MIN_DAYS, S2_PREFERRED_DAYS),
                         "pass": span_days is not None and span_days >= S2_MIN_DAYS},
        "S3_fix_commits": {"value": fixes, "threshold": ">= %d" % S3_MIN_FIXES,
                           "pass": fixes >= S3_MIN_FIXES},
        "S4_bulk_churn_share": {"value": round(bulk_share, 3), "threshold": "< %.2f"
                                % S4_MAX_BULK_SHARE, "pass": bulk_share < S4_MAX_BULK_SHARE},
        "S5_post_agent_share": {"value": round(agent_share, 3), "threshold": "< %.2f"
                                % S5_MAX_AGENT_SHARE, "pass": agent_share < S5_MAX_AGENT_SHARE,
                                "adoption_date": utc_date(adoption_ct),
                                "adoption_marker": adoption_source},
    }
    reasons: List[str] = []
    if not criteria["S1_filtered_commits"]["pass"]:
        reasons.append("S1 failed: %d filtered first-parent commits < %d" % (n, S1_MIN_COMMITS))
    if not criteria["S2_span_days"]["pass"]:
        reasons.append("S2 failed: filtered history spans %s days < %d (~4 months)"
                       % (span_days if span_days is not None else 0, S2_MIN_DAYS))
    if not criteria["S3_fix_commits"]["pass"]:
        reasons.append("S3 failed: %d fix-labelled commits < %d" % (fixes, S3_MIN_FIXES))
    if not criteria["S4_bulk_churn_share"]["pass"]:
        reasons.append("S4 failed: bulk commits carry %.0f%% of filtered churned lines (>= 50%%)"
                       % (bulk_share * 100))
    if not criteria["S5_post_agent_share"]["pass"]:
        reasons.append("S5 failed: %.0f%% of filtered commits come after agent adoption on %s "
                       "(%s) (>= 50%%)" % (agent_share * 100, utc_date(adoption_ct),
                                           adoption_source))
    sufficient = all(bool(v["pass"]) for v in criteria.values())
    if sufficient:
        reasons.append("S1-S5 passed (thresholds are transferred conventions, G104-F04 grade C)")
        if span_days is not None and span_days < S2_PREFERRED_DAYS:
            reasons.append("S2 below the preferred ~6 months (%s days)" % span_days)
    if shallow:
        reasons.append("shallow clone: history is truncated, every count is a lower bound")
    return {"sufficient": sufficient, "reasons": reasons, "criteria": criteria,
            "first_ct": first_ct, "last_ct": last_ct, "span_days": span_days,
            "filtered_commits": n, "fix_commits": fixes}


def recency_weight(event_ct: int, anchor_ct: int, half_life_days: float) -> float:
    """exp(-(now - t) / hl * ln 2), the G104-F01 decay (hl in seconds = days * 86400)."""
    hl = half_life_days * SECONDS_PER_DAY
    age = max(0, anchor_ct - event_ct)
    return math.exp(-(age / hl) * math.log(2))


# ---------------------------------------------------------------------------
# Time windows ("12.months", "90 days", "2y", "2025-01-31", "all")
# ---------------------------------------------------------------------------

_UNIT_DAYS = {
    "d": 1.0, "day": 1.0, "days": 1.0,
    "w": 7.0, "week": 7.0, "weeks": 7.0,
    "m": 30.44, "mo": 30.44, "month": 30.44, "months": 30.44,
    "y": 365.25, "year": 365.25, "years": 365.25,
}


@dataclass
class Window:
    """An analysis window: either a length before an anchor, or an absolute start date."""
    spec: str
    days: Optional[float] = None       # relative length
    start_ts: Optional[int] = None     # absolute start (UTC midnight)
    unbounded: bool = False

    def start_for(self, anchor_ct: int) -> Optional[int]:
        """Window start for a given anchor timestamp (None = no lower bound)."""
        if self.unbounded:
            return None
        if self.start_ts is not None:
            return self.start_ts
        assert self.days is not None
        return int(anchor_ct - self.days * SECONDS_PER_DAY)


def parse_window(spec: str) -> Window:
    """Parse a git-style `--since` value into a Window. Raises ValueError when unreadable."""
    s = spec.strip().lower()
    if s in ("all", "none", "0"):
        return Window(spec=spec, unbounded=True)
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", s)
    if m:
        dt = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), tzinfo=timezone.utc)
        return Window(spec=spec, start_ts=int(dt.timestamp()))
    m = re.match(r"^(\d+(?:\.\d+)?)\s*[._ ]?\s*([a-z]+)(?:\s+ago)?$", s)
    if m and m.group(2) in _UNIT_DAYS:
        value = float(m.group(1))
        if value <= 0:
            raise ValueError("window length must be positive: {!r}".format(spec))
        return Window(spec=spec, days=value * _UNIT_DAYS[m.group(2)])
    raise ValueError("cannot read window {!r}; use e.g. 12.months, 90.days, 2.years, "
                     "YYYY-MM-DD or all".format(spec))


# ---------------------------------------------------------------------------
# Session transcripts: token usage at list prices (pilot-auto-calibration A01-F34, A01-F36)
# ---------------------------------------------------------------------------

# Anthropic list prices, USD per million tokens, read 2026-09-25 from
# https://platform.claude.com/docs/en/about-claude/pricing: (model-id prefix, input,
# 5-minute cache write, 1-hour cache write, cache read, output). The longest matching prefix
# wins (pilot-auto-calibration A01-F34).
PRICE_TABLE = (
    ("claude-fable-5-1", 10.0, 12.5, 20.0, 0.25, 50.0),
    ("claude-mythos-5-1", 10.0, 12.5, 20.0, 0.25, 50.0),
    ("claude-fable-5", 10.0, 12.5, 20.0, 1.0, 50.0),
    ("claude-mythos-5", 10.0, 12.5, 20.0, 1.0, 50.0),
    ("claude-opus-5-5", 4.0, 5.0, 8.0, 0.20, 20.0),
    ("claude-opus-5", 5.0, 6.25, 10.0, 0.50, 25.0),
    ("claude-opus-4-1", 15.0, 18.75, 30.0, 1.50, 75.0),
    ("claude-opus-4-2", 15.0, 18.75, 30.0, 1.50, 75.0),   # claude-opus-4-2025xxxx (Opus 4)
    ("claude-opus-4", 5.0, 6.25, 10.0, 0.50, 25.0),       # Opus 4.5 to 4.8
    ("claude-sonnet-5", 2.0, 2.5, 4.0, 0.20, 10.0),
    ("claude-sonnet-4", 3.0, 3.75, 6.0, 0.30, 15.0),
    ("claude-haiku-4-5", 1.0, 1.25, 2.0, 0.10, 5.0),
)
PRICE_FALLBACK = (10.0, 12.5, 20.0, 1.0, 50.0)   # unknown model: the highest listed rates
MODEL_ALIASES = {"opus": "claude-opus-5-5", "sonnet": "claude-sonnet-5",
                 "haiku": "claude-haiku-4-5", "fable": "claude-fable-5-1"}


def price_for(model: str) -> Tuple[Tuple[float, ...], bool]:
    """(input, cache write 5m, cache write 1h, cache read, output) rates of a model, and whether
    the table knows it (else the highest listed rates)."""
    name = (model or "").strip().lower()
    name = MODEL_ALIASES.get(name, name)
    name = re.sub(r"\[[^\]]*\]$", "", name)
    best: Optional[Tuple[str, float, float, float, float, float]] = None
    for row in PRICE_TABLE:
        if name.startswith(row[0]) and (best is None or len(row[0]) > len(best[0])):
            best = row
    if best is None:
        return PRICE_FALLBACK, False
    return tuple(best[1:]), True


def _parse_ts(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def transcript_usage(path: Path, since: Optional[datetime] = None,
                     max_bytes: Optional[int] = None,
                     skip_sidechain: bool = False) -> Dict[str, Any]:
    """Token usage per model of a Claude Code transcript (JSON lines), deduplicated by
    (message id, request id). Numbers and model ids only: no message text is kept or
    returned. OSError propagates."""
    size = os.path.getsize(str(path))
    truncated = False
    with open(str(path), "rb") as handle:
        if max_bytes is not None and size > max_bytes:
            handle.seek(size - max_bytes)
            truncated = True
        data = handle.read()
    text = data.decode("utf-8", errors="replace").lstrip(chr(0xFEFF))
    kept: Dict[Any, Tuple[str, Dict[str, Any], Optional[datetime]]] = {}
    invalid = 0
    for raw in text.splitlines():
        if not raw.strip():
            continue
        try:
            line = json.loads(raw)
        except ValueError:
            invalid += 1
            continue
        if not isinstance(line, dict) or line.get("type") != "assistant":
            continue
        message = line.get("message")
        if not isinstance(message, dict):
            continue
        usage = message.get("usage")
        model = message.get("model")
        if not isinstance(usage, dict) or not isinstance(model, str) or model == "<synthetic>":
            continue
        if skip_sidechain and line.get("isSidechain") is True:
            continue
        ts = _parse_ts(line.get("timestamp"))
        if since is not None and (ts is None or ts < since):
            continue
        key: Any = (message.get("id"), line.get("requestId"))
        if key == (None, None):
            key = line.get("uuid") or len(kept)
        kept[key] = (model, usage, ts)
    models: Dict[str, Dict[str, int]] = {}
    first: Optional[datetime] = None
    last: Optional[datetime] = None
    for model, usage, ts in kept.values():
        entry = models.setdefault(model, {"requests": 0, "input": 0, "cache_write_5m": 0,
                                          "cache_write_1h": 0, "cache_write_unknown": 0,
                                          "cache_read": 0, "output": 0})
        entry["requests"] += 1
        entry["input"] += int(usage.get("input_tokens") or 0)
        entry["cache_read"] += int(usage.get("cache_read_input_tokens") or 0)
        entry["output"] += int(usage.get("output_tokens") or 0)
        creation = usage.get("cache_creation")
        if isinstance(creation, dict):
            entry["cache_write_5m"] += int(creation.get("ephemeral_5m_input_tokens") or 0)
            entry["cache_write_1h"] += int(creation.get("ephemeral_1h_input_tokens") or 0)
        else:
            entry["cache_write_unknown"] += int(usage.get("cache_creation_input_tokens") or 0)
        if ts is not None:
            first = ts if first is None or ts < first else first
            last = ts if last is None or ts > last else last
    return {"models": dict(sorted(models.items())),
            "first_ts": first.isoformat().replace("+00:00", "Z") if first else None,
            "last_ts": last.isoformat().replace("+00:00", "Z") if last else None,
            "invalid_lines": invalid, "truncated": truncated}


def usage_usd(models: Dict[str, Dict[str, int]]) -> Tuple[float, List[str]]:
    """(USD at list prices, models the price table does not know). A cache write of unknown
    duration is priced at the 1-hour rate."""
    usd = 0.0
    unpriced: List[str] = []
    for model, counts in sorted(models.items()):
        rates, known = price_for(model)
        if not known:
            unpriced.append(model)
        usd += (int(counts.get("input", 0) or 0) * rates[0]
                + int(counts.get("cache_write_5m", 0) or 0) * rates[1]
                + (int(counts.get("cache_write_1h", 0) or 0)
                   + int(counts.get("cache_write_unknown", 0) or 0)) * rates[2]
                + int(counts.get("cache_read", 0) or 0) * rates[3]
                + int(counts.get("output", 0) or 0) * rates[4]) / 1_000_000.0
    return usd, unpriced


def subagent_transcripts(main: Path) -> List[Path]:
    """The subagent transcripts of a session: `<main without .jsonl>/subagents/*.jsonl`
    (hooks reference); [] when there are none. Never raises."""
    try:
        return sorted((main.parent / main.stem / "subagents").glob("*.jsonl"))
    except OSError:
        return []
