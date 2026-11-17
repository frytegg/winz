#!/usr/bin/env python3
"""diff_guard.py - detect changes that a /harden run forbids.

Purpose
    Compare the run's base commit with HEAD *plus the working tree* (staged, unstaged and
    untracked-but-not-ignored files) and report changes that the /harden protocol forbids.
    Existing tests, snapshots and gate configs are read-only during a hardening pass, new
    skip/focus markers and new suppressions are blocking, history must not be rewritten, and
    generated or vendored files must not be touched (dossiers: skill-design T31-F08;
    llm-refactoring T10-F06, T10-F08; hardening-induced-regressions G205-F13, G205-F15;
    refactoring-safety T09-F05, T09-F12, T09-F13; ai-code-smells-practitioners T12-F04,
    T12-F08, T12-F12; types-static-analysis T18-F11).

    HARD violations (exit 1):
      test_modified / test_deleted   an existing file matching test or snapshot globs changed
                                     beyond the additions strengthen.py accepts (protocol-change
                                     PC-06; user-policy-autonomy U01-F07), checked for the working
                                     tree against base and for every commit of base..HEAD against
                                     its parent (a revert commit may remove only lines its
                                     reverted commit added). Each item carries "reason" (a
                                     strengthen.py problem code: removed-line, eol-changed,
                                     not-at-tail, skip-marker, renamed, deleted, ...), "problems"
                                     (at most 10) and, per commit, "commit". Snapshot and golden
                                     files, fixtures and support files never gain lines. A path
                                     listed in .harden/active "allow_test_deletions" may be
                                     deleted, or changed by removing lines only (no added line:
                                     lens-dead-code DC-15; dossier dead-code-certainty G102-F14,
                                     G102-F15); any added line there stays test_modified
      replay_pending                 .harden/tmp/replay-state.json exists: a strengthen.py replay
                                     was interrupted before it restored the test files it swapped
                                     or set aside
      protected_modified / _deleted  an existing file matching protected globs (gate configs,
                                     CI, manifests, lockfiles) changed; compared as whole files.
                                     A modification of a path in "allow_config_edits" (recorded
                                     by run_state.py allow-config-edit) is info
                                     (info.allowed_config_edits) instead, but its added lines
                                     are still scanned for suppressions and config weakening
      config_weakened                an added line of an approved config edit turns a rule off,
                                     disables strictness, sets skipLibCheck / ignore_errors /
                                     ignore_missing_imports, adds a masking construct or lowers
                                     a coverage threshold (protocol-change PC-08)
      marker_added                   a new skip/focus marker (.skip(, xit(, it.only(, ...)
      suppression_added              a new lint/type suppression (eslint-disable, # noqa, ...)
                                     A marker or suppression line whose stripped text equals an
                                     "allowed_lines" entry for that path (run_state.py
                                     allow-line) is info (info.allowed_lines_used)
      report_only_change             mode "report-only" in .harden/active and a commit or a
                                     working-tree change outside .harden/ exists since the run
                                     started ("head_at_start", else the base commit); a file
                                     listed in "dirty_at_start" (a report-only run started on
                                     a dirty tree) counts only once its content changes
      history_rewritten              the base commit is no longer an ancestor of HEAD
      base_not_found                 the base commit does not exist any more
      generated_touched              a vendored/generated file was added, changed or deleted
    SOFT warnings (exit 0 unless --strict):
      removed_guard_lines, removed_guard_keyword_lines, session_referential_comment,
      lockfile_changed, ci_changed, manifest_changed, public_api_removed, new_file,
      protected_config_added, marker_in_docs, suppression_in_docs, escape_hatch_added,
      build_output_touched, outside_scope, branch_changed, test_gaming
    Diff size is reported under info.stats (never a warning: the dossiers give no threshold).

    test_gaming (protocol-change PC-07; dossier llm-refactoring T10-F07) looks at lines added
    to non-test code files (test/snapshot globs, generated and vendored files excluded) and
    reports each hit with file:line, a "category" and the matched "pattern":
      comment             a comment saying special case / for (the) test(s) / make (the)
                          test(s) pass / pass(es) the test(s) / hard-coded / expected value
      test_env_detection  NODE_ENV compared with "test", JEST_WORKER_ID, VITEST*,
                          PYTEST_CURRENT_TEST / PYTEST_VERSION / PYTEST_XDIST_WORKER,
                          "pytest" (or unittest/nose) in sys.modules, Go testing.Testing(),
                          Rust cfg!(test)
      success_exit        sys.exit(0) / sys.exit() / os._exit(0) / SystemExit(0) / exit(0)
                          (Python), process.exit(0) / process.exit() / Deno.exit(0), Rust
                          std::process::exit(0), Go os.Exit(0), System.exit(0) /
                          exitProcess(0), C# Environment.Exit(0), C/C++ exit(0) / _exit(0) /
                          exit(EXIT_SUCCESS)
      comparison_override __eq__ / __ne__ / __hash__, valueOf, [Symbol.toPrimitive], manual
                          Rust PartialEq / PartialOrd / Hash impls, Java/Kotlin equals /
                          hashCode, C# Equals / GetHashCode / operator==, C++ operator== /
                          operator!= / operator<=>
      literal_from_tests  a string literal of 8+ characters (at least one letter or digit) or a
                          number of 5+ digits added to non-test code that did not exist in that
                          file at base nor in a removed non-test line, and that occurs in a
                          test or snapshot file of the working tree (full mode only). Round
                          numbers (10000, 250000...) and a few well-known constants (65535,
                          86400, 2147483647...) are not reported; import lines are skipped.
    "New" means: not a moved or re-indented line (a removed non-test code line with the same
    text, whitespace and quote style ignored) and not offset by a removed hit of the same
    pattern in the same file. The patterns match lookup tables, feature flags and legitimate
    CLI exits too (PC-07 "Not when"): every hit is for a human to review, never auto-fixed.

    --quick restricts the run to cheap file-level checks (name-status, untracked list,
    ancestry, path/attribute/header classification) plus line-based scans of one
    `git diff -U0` limited to code extensions and approved config edits, and of untracked code
    files (test files included): the SKIP_MARKERS and SUPPRESSIONS scans (marker_added,
    suppression_added; at most QUICK_GAMING_LINE_CAP added lines, info.quick_markers), the
    config-weakening scan of approved config edits, and the test_gaming scan of non-test code
    (at most QUICK_GAMING_LINE_CAP added lines), so hooks stay under one second. A failure of
    those scans in --quick mode is reported as a test_gaming item of category "scan_error"
    instead of stopping the file-level checks. Markers and suppressions in other files (docs,
    configs), removed guards, comments, public API and the test_gaming literal cross-check
    need the full mode.

Configuration
    Globs come from .harden/active ("test_globs", "protected_globs", "allow_test_deletions",
    "allow_config_edits", optional "generated_globs"), then .harden/config.json, then the
    defaults below. A non-empty list replaces the defaults; run_state.py start writes the
    effective lists into .harden/active (the defaults plus the inventory's suggestions, or the
    config's own non-empty list). Snapshot globs always apply. "mode", "head_at_start",
    "dirty_at_start" and "allowed_lines" ([{"path", "text", ...}]) also come from
    .harden/active.
    Glob dialect: matched against the repo-relative POSIX path; "**/" = zero or more
    directories, "*" and "?" stay inside one segment, "{a,b}" alternatives, a pattern without
    "/" matches at any depth, a trailing "/" means the directory and everything below it.
    Matching is case-insensitive on Windows.

CLI
    python diff_guard.py [--repo DIR] [--base SHA] [--quick] [--json] [--strict] [--out FILE]
    (use `python3` on macOS/Linux). --base defaults to "base_sha" in .harden/active.

Exit codes
    0  no hard violation (and, with --strict, no soft warning)
    1  at least one hard violation, or at least one soft warning with --strict
    2  usage or environment error: not a git repository, no base SHA, unreadable
       .harden/active or .harden/config.json, git failure

Python 3.9+ standard library only; no network; UTF-8 I/O; subprocesses without a shell.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)

try:  # the additions-only rule (protocol-change PC-06; user-policy-autonomy U01-F07)
    import strengthen as ST  # noqa: E402
    ST_ERROR: Optional[str] = None
except Exception as _exc:  # noqa: BLE001 - every existing-test change is then refused
    ST = None  # type: ignore[assignment]
    ST_ERROR = f"{type(_exc).__name__}: {_exc}"

IS_WINDOWS = os.name == "nt"
HARDEN_DIR_NAME = ".harden"
ACTIVE_NAME = "active"
CONFIG_NAME = "config.json"
MAX_TEXT_BYTES = 1_000_000
HEADER_READ_BYTES = 2048
HEADER_LINES = 10
QUICK_HEADER_FILE_CAP = 200
SNIPPET_LIMIT = 200
EXAMPLES_PER_FILE = 5
MAX_ITEMS_PER_KIND = 200

# ---------------------------------------------------------------------------
# Default globs
# ---------------------------------------------------------------------------

# Test code (llm-refactoring T10-F06 detect list; hardening-induced-regressions G205-F15;
# refactoring-safety T09-F12), extended with the usual per-language file conventions.
DEFAULT_TEST_GLOBS: List[str] = [
    "**/test/**", "**/tests/**", "**/__tests__/**", "**/spec/**", "**/e2e/**",
    "**/__mocks__/**", "**/__fixtures__/**", "**/testdata/**",
    "**/*.test.*", "**/*.spec.*", "**/*_test.*", "**/test_*.py", "**/conftest.py",
    "**/*.t.sol",
    "**/*Test.java", "**/*Tests.java", "**/*Test.kt", "**/*Tests.kt",
    "**/*Test.cs", "**/*Tests.cs",
    "**/*_spec.rb",
    "**/test_*.{c,cc,cpp,cxx}",
]

# Snapshot, golden and approval files (refactoring-safety T09-F05). Always read-only.
DEFAULT_SNAPSHOT_GLOBS: List[str] = [
    "**/__snapshots__/**", "**/*.snap", "**/*.approved.*", "**/*.golden",
]

LOCKFILE_NAMES: List[str] = [
    "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
    "bun.lock", "deno.lock", "Cargo.lock", "poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock",
    "Gemfile.lock", "composer.lock", "go.sum", "go.work.sum", "flake.lock", "packages.lock.json",
    "gradle.lockfile", "Package.resolved", "pubspec.lock", "mix.lock", "conda-lock.yml",
]
_LOCKFILE_LOWER = {n.lower() for n in LOCKFILE_NAMES}

# Gate configuration: lint, type-check, format, test runner, coverage, CI, pre-commit
# (llm-refactoring T10-F06/T10-F08; ai-code-smells-practitioners T12-F08;
# hardening-induced-regressions G205-F15), plus dependency manifests and lockfiles, which
# change only inside an approved dependency item recorded with `run_state.py
# allow-config-edit` (SKILL.md invariant 2; dependency-hygiene via lens-dependencies DP-10).
# Whole files are protected.
DEFAULT_PROTECTED_GLOBS: List[str] = [
    # JavaScript / TypeScript
    "**/.eslintrc", "**/.eslintrc.*", "**/eslint.config.*", "**/.eslintignore",
    "**/.prettierrc", "**/.prettierrc.*", "**/prettier.config.*", "**/.prettierignore",
    "**/biome.json", "**/biome.jsonc", "**/.oxlintrc.json",
    "**/tsconfig.json", "**/tsconfig.*.json", "**/jsconfig.json",
    "**/jest.config.*", "**/vitest.config.*", "**/vitest.workspace.*", "**/.mocharc*",
    "**/playwright.config.*", "**/karma.conf.*", "**/cypress.config.*",
    "**/.nycrc", "**/.nycrc.*", "**/.c8rc", "**/.c8rc.*",
    "**/.stylelintrc", "**/.stylelintrc.*", "**/stylelint.config.*",
    # Python
    "**/pyproject.toml", "**/setup.cfg", "**/tox.ini", "**/pytest.ini", "**/noxfile.py",
    "**/mypy.ini", "**/.mypy.ini", "**/ruff.toml", "**/.ruff.toml", "**/.flake8",
    "**/.pylintrc", "**/pylintrc", "**/pyrightconfig.json", "**/.coveragerc",
    # Rust
    "**/clippy.toml", "**/.clippy.toml", "**/rustfmt.toml", "**/.rustfmt.toml", "**/deny.toml",
    # Go
    "**/.golangci.yml", "**/.golangci.yaml", "**/.golangci.toml", "**/.golangci.json",
    # C / C++
    "**/.clang-tidy", "**/.clang-format",
    # Solidity
    "**/foundry.toml", "**/.solhint.json", "**/slither.config.json",
    # Cross-language formatting / coverage services
    "**/.editorconfig", "**/codecov.yml", "**/.codecov.yml",
    # Pre-commit hooks
    "**/.pre-commit-config.yaml", ".husky/**", "**/lefthook.yml", "**/.lintstagedrc*",
    "**/lint-staged.config.*",
    # CI
    ".github/workflows/**", ".gitlab-ci.yml", ".circleci/**", "azure-pipelines.yml",
    ".travis.yml", "Jenkinsfile", "bitbucket-pipelines.yml", ".buildkite/**",
    # Dependency manifests (pyproject.toml and foundry.toml are listed above) and lockfiles
    "**/package.json", "**/Cargo.toml", "**/go.mod",
] + ["**/" + _name for _name in LOCKFILE_NAMES]

CI_GLOBS: List[str] = [
    ".github/workflows/**", ".github/actions/**", ".gitlab-ci.yml", ".gitlab-ci/**",
    ".circleci/**", "azure-pipelines.yml", ".azure-pipelines/**", ".travis.yml", "Jenkinsfile",
    "bitbucket-pipelines.yml", ".buildkite/**", ".drone.yml", "appveyor.yml",
    ".woodpecker.yml", ".woodpecker/**",
]

MANIFEST_NAMES = {
    "package.json", "cargo.toml", "go.mod", "go.work", "pyproject.toml", "setup.py", "setup.cfg",
    "pipfile", "gemfile", "composer.json", "pom.xml", "build.gradle", "build.gradle.kts",
    "deno.json", "deno.jsonc",
}
_REQUIREMENTS_RE = re.compile(r"^(requirements|constraints)[\w.-]*\.(txt|in)$", re.I)

VENDOR_DIR_NAMES = {"node_modules", "vendor", "third_party", "third-party", "bower_components",
                    ".venv", "venv", "site-packages"}
GENERATED_DIR_NAMES = {"generated", "__generated__"}
BUILD_DIR_NAMES = {"dist", "build", "out", "target", ".next", ".nuxt", ".svelte-kit", ".turbo",
                   "coverage", "__pycache__"}
GENERATED_MARKER_RE = re.compile(r"@generated|do not edit|auto-generated|autogenerated", re.I)

DOC_EXTENSIONS = {".md", ".markdown", ".mdx", ".rst", ".adoc", ".asciidoc", ".txt"}
# From the shared extension table of _common.py (the same table inventory.py and prescan.py use).
CODE_EXTENSIONS: Set[str] = set(C.CODE_EXTENSIONS)
TS_FAMILY = {".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".astro"}
JS_TS_FAMILY = TS_FAMILY | {".js", ".jsx", ".mjs", ".cjs"}
PY_FAMILY = {".py", ".pyi", ".pyx"}

# ---------------------------------------------------------------------------
# Marker and suppression patterns (added lines)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Marker:
    """A pattern searched in added lines."""

    ident: str
    label: str
    regex: "re.Pattern[str]"
    exts: Optional[frozenset] = None  # None = every file

    def applies_to(self, ext: str) -> bool:
        return self.exts is None or ext in self.exts


def _m(ident: str, label: str, pattern: str, exts: Optional[Iterable[str]] = None,
       flags: int = 0) -> Marker:
    return Marker(ident, label, re.compile(pattern, flags),
                  frozenset(exts) if exts is not None else None)


# Skip / focus markers (T10-F06, T12-F04, G205-F15, T09-F12, T31-F08). `.skip(`/`.only(` are
# matched on test-framework receivers so that iterator calls such as Rust `iter().skip(1)`
# or Java `stream.skip(n)` are not reported.
SKIP_MARKERS: List[Marker] = [
    _m("js-skip-focus", "test-framework .skip/.only/.todo/.fixme",
       r"\b(?:it|test|describe|suite|context|specify|bench)"
       r"(?:\.(?:concurrent|describe|serial|each|sequential))*"
       r"\.(?:skip|skipIf|only|todo|fixme)\b"),
    _m("mocha-this-skip", "this.skip()", r"\bthis\.skip\s*\(", JS_TS_FAMILY),
    _m("x-disabled", "xit( / xdescribe( / xtest(", r"(?<![\w.$])x(?:it|describe|test)\s*\("),
    _m("f-focused", "fit( / fdescribe(", r"(?<![\w.$])f(?:it|describe)\s*\(", JS_TS_FAMILY),
    _m("pytest-mark-skip", "@pytest.mark.skip / skipif / xfail",
       r"\bpytest\.mark\.(?:skip\w*|xfail)\b"),
    _m("pytest-skip-call", "pytest.skip( / pytest.xfail(", r"\bpytest\.(?:skip|xfail)\s*\("),
    _m("unittest-skip", "unittest.skip*", r"\bunittest\.skip\w*\b"),
    _m("py-skip-decorator", "@skip / @skipIf / @skipUnless",
       r"^\s*@skip(?:If|Unless)?\s*\(", PY_FAMILY),
    _m("rust-ignore", "#[ignore]", r"#\[\s*ignore\b"),
    _m("go-skip", "t.Skip(", r"\b[tb]\.Skip(?:Now|f)?\s*\("),
    _m("junit-disabled", "@Disabled", r"@Disabled\b"),
    _m("junit-ignore", "@Ignore", r"@Ignore\b"),
    _m("foundry-skip", "vm.skip(", r"\bvm\.skip\s*\("),
]

# Suppressions and escape hatches (T10-F08, T18-F11, T09-F12, G205-F15).
SUPPRESSIONS: List[Marker] = [
    _m("eslint-disable", "eslint-disable", r"eslint-disable"),
    _m("ts-directive", "@ts-ignore / @ts-nocheck / @ts-expect-error",
       r"@ts-(?:ignore|nocheck|expect-error)\b"),
    _m("as-any", "as any", r"\bas\s+any\b(?!\s*(?!as\b)[A-Za-z_$])", TS_FAMILY),
    _m("as-unknown-as", "as unknown as", r"\bas\s+unknown\s+as\b", TS_FAMILY),
    _m("noqa", "# noqa", r"#\s*noqa\b"),
    _m("type-ignore", "# type: ignore", r"#\s*type:\s*ignore\b"),
    _m("pyright-ignore", "# pyright: ignore", r"#\s*pyright:\s*ignore\b"),
    _m("rust-allow", "#[allow( / #![allow(", r"#!?\[\s*allow\s*\("),
    _m("nolint-clang", "NOLINT", r"\bNOLINT(?:NEXTLINE|BEGIN)?\b"),
    _m("nolint-go", "//nolint", r"//\s*nolint\b"),
    _m("nosec", "# nosec", r"#\s*nosec\b"),
    _m("slither-disable", "slither-disable", r"slither-disable"),
    _m("biome-ignore", "biome-ignore", r"biome-ignore"),
    _m("suppress-warnings", "@SuppressWarnings", r"@SuppressWarnings\b"),
    _m("pragma-warning-disable", "#pragma warning disable",
       r"#\s*pragma\s+warning\s*\(?\s*disable\b"),
    _m("pragma-no-cover", "pragma: no cover", r"pragma:\s*no\s*cover\b"),
    _m("pass-with-no-tests", "--passWithNoTests", r"--passWithNoTests\b"),
]

# Escape-hatch types that are soft only (T10-F08 lists `any`; T18-F13).
ESCAPE_HATCHES: List[Marker] = [
    _m("any-annotation", ": any", r":\s*any\b(?!\s*[\w$])", TS_FAMILY),
    _m("any-assertion", "<any>", r"<any>", TS_FAMILY),
]

# Config weakening in an approved config edit (allow_config_edits): the edit is allowed, a
# looser gate is not (protocol-change PC-08: rules turned off, strictness flags disabled,
# skipLibCheck, ignore_errors, ignore_missing_imports, lowered coverage and quality thresholds;
# llm-refactoring T10-F08; types-static-analysis T18-F11; masking constructs build-ci-infra
# G107-F01).
CONFIG_WEAKENING: List[Marker] = [
    _m("skip-lib-check", "skipLibCheck: true", r"skipLibCheck[\"']?\s*[:=]\s*true\b", flags=re.I),
    _m("ignore-errors", "ignore_errors = true", r"\bignore_errors[\"']?\s*[:=]\s*true\b",
       flags=re.I),
    _m("ignore-missing-imports", "ignore_missing_imports = true",
       r"\bignore_missing_imports[\"']?\s*[:=]\s*true\b", flags=re.I),
    _m("strict-off", "strictness flag set to false",
       r"(?<![\w-])[\"']?strict\w*[\"']?\s*[:=]\s*false\b", flags=re.I),
    _m("rule-off", "lint rule turned off", r"[:=,\[]\s*[\"']off[\"']", flags=re.I),
    _m("masking", "masking construct (G107-F01)", C.MASKING_RE.pattern),
]
# "<key>": <number> thresholds whose value must not go down in an approved config edit.
THRESHOLD_RE = re.compile(r"(?i)(?<![\w-])[\"']?(fail[_-]under|cov-fail-under|branches|functions|"
                          r"lines|statements|threshold)[\"']?\s*[:=]\s*(\d+(?:\.\d+)?)")

# Removed guard lines in non-test code (G205-F13, T10-F14 via G205; spec list).
GUARD_PATTERNS: List[Tuple[str, "re.Pattern[str]", Optional[frozenset]]] = [
    ("assert", re.compile(r"\bassert\b"), None),
    ("assert-macro", re.compile(r"\b(?:debug_)?assert(?:_eq|_ne)?!\s*\("), None),
    ("invariant", re.compile(r"\binvariant\s*\("), None),
    ("require", re.compile(r"\brequire\s*\((?!\s*['\"`])"), None),
    ("panic", re.compile(r"\bpanic!\s*\("), None),
    ("go-panic", re.compile(r"\bpanic\s*\("), frozenset({".go"})),
]
_THROW_RE = re.compile(r"^\s*(?:throw|raise)\b")
_IF_LINE_RE = re.compile(r"^\s*(?:\}\s*)?(?:if|elif|else|unless|guard)\b|\bif\s*[\(!]|\bif\s+not\b")
_INLINE_IF_THROW_RE = re.compile(r"\bif\b.*\b(?:throw|raise)\b")
# hardening-induced-regressions G205-F13 guard-deletion audit keywords.
GUARD_KEYWORD_RE = re.compile(
    r"(?i)(?<![a-z])(?:timeout|limit|max|min|check|validate|assert|guard|lock|retry|backoff|"
    r"quota|rate|sanitize|escape|bounds)")

# Session-referential / narrating comments (ai-code-smells-practitioners T12-F12 heuristic,
# plus the phrases named in the build specification).
SESSION_REF_RE = re.compile(
    r"\b(?:previously|now (?:uses|returns|handles|calls|does)|no longer|instead of the old|"
    r"(?:was|were|has been|have been) (?:changed|updated|replaced|removed)(?: (?:to|from|with|by))?|"
    r"changed (?:from|to)|updated to|refactored|fixed (?:a |the )?bug|as requested|"
    r"per (?:the )?user(?:'s)? request|per the user|new implementation)\b", re.I)
_COMMENT_START_RE = re.compile(r"(?<![:/])//+|(?:^|\s)#+(?=\s|$)|/\*+|^\s*\*+\s|<!--|(?:^|\s)--\s")

# ---------------------------------------------------------------------------
# Test-gaming patterns (protocol-change PC-07; dossier llm-refactoring T10-F07)
# ---------------------------------------------------------------------------

JVM_FAMILY = {".java", ".kt", ".kts", ".scala"}
C_FAMILY = {".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx", ".ipp", ".tpp", ".inl"}
# Languages whose single-quoted literals are strings (elsewhere they are characters or
# lifetimes) and whose backticks delimit strings (JS/TS templates, Go raw strings).
SINGLE_QUOTE_STRING_EXTS = PY_FAMILY | JS_TS_FAMILY | {".rb", ".php", ".lua", ".dart", ".sh",
                                                       ".bash", ".zsh", ".ps1", ".psm1", ".ex",
                                                       ".exs"}
BACKTICK_STRING_EXTS = JS_TS_FAMILY | {".go"}

# PC-07 comment grep: special[- ]?case | for (the )?tests? | make (the )?tests? pass |
# pass(es)? (the )?tests? | hard[- ]?cod | expected (value|output). Applied to comments only.
GAMING_COMMENT_RE = re.compile(
    r"(?i)\b(?:special[- ]?cas(?:e[sd]?|ing)|for (?:the |these |this )?tests?\b|"
    r"make (?:the |these |this )?tests? pass|pass(?:es)? (?:the |these |this )?tests?\b|"
    r"hard[- ]?cod(?:e[sd]?|ing)|expected (?:value|output|result)s?\b)")

GAMING_TEST_ENV: List[Marker] = [
    _m("node-env-test", "NODE_ENV compared with 'test'",
       r"NODE_ENV\b['\"\]\)]*\s*(?:===?|!==?)\s*['\"`]test['\"`]"
       r"|['\"`]test['\"`]\s*(?:===?|!==?)\s*[\w$.\[\]'\"()]*NODE_ENV\b"),
    _m("jest-worker-id", "JEST_WORKER_ID", r"\bJEST_WORKER_ID\b"),
    _m("vitest-env", "VITEST environment variable", r"\bVITEST(?:_[A-Z_]+)?\b"),
    _m("pytest-env", "PYTEST_CURRENT_TEST / PYTEST_VERSION / PYTEST_XDIST_WORKER",
       r"\bPYTEST_(?:CURRENT_TEST|VERSION|XDIST_WORKER)\b"),
    _m("sys-modules-test-framework", "test framework looked up in sys.modules",
       r"['\"](?:_?pytest|unittest|nose2?)['\"]\s+(?:not\s+)?in\s+sys\.modules\b"
       r"|\bsys\.modules(?:\.get\s*\(|\[)\s*['\"](?:_?pytest|unittest|nose2?)['\"]", PY_FAMILY),
    _m("go-testing-testing", "testing.Testing()", r"\btesting\.Testing\s*\(", {".go"}),
    _m("rust-cfg-test-macro", "cfg!(test)", r"\bcfg!\s*\(\s*test\s*\)", {".rs"}),
]

GAMING_SUCCESS_EXITS: List[Marker] = [
    _m("py-sys-exit-0", "sys.exit(0) / sys.exit()", r"\bsys\.exit\s*\(\s*(?:0|None)?\s*\)",
       PY_FAMILY),
    _m("py-os-exit-0", "os._exit(0)", r"\bos\._exit\s*\(\s*0\s*\)", PY_FAMILY),
    _m("py-systemexit-0", "raise SystemExit / SystemExit(0)",
       r"\bSystemExit\s*\(\s*(?:0|None)?\s*\)|\braise\s+SystemExit\s*(?:$|;)", PY_FAMILY),
    _m("py-exit-builtin-0", "exit(0) / quit(0)", r"(?<![\w.])(?:exit|quit)\s*\(\s*0?\s*\)",
       PY_FAMILY),
    _m("js-process-exit-0", "process.exit(0) / process.exit()",
       r"\bprocess\.exit\s*\(\s*0?\s*\)|\bDeno\.exit\s*\(\s*0?\s*\)", JS_TS_FAMILY),
    _m("rust-process-exit-0", "std::process::exit(0)", r"\bprocess\s*::\s*exit\s*\(\s*0\s*\)",
       {".rs"}),
    _m("go-os-exit-0", "os.Exit(0)", r"\bos\.Exit\s*\(\s*0\s*\)", {".go"}),
    _m("jvm-exit-0", "System.exit(0) / exitProcess(0)",
       r"\bSystem\.exit\s*\(\s*0\s*\)|\bexitProcess\s*\(\s*0\s*\)", JVM_FAMILY),
    _m("cs-exit-0", "Environment.Exit(0)", r"\bEnvironment\.Exit\s*\(\s*0\s*\)", {".cs"}),
    _m("c-exit-0", "exit(0) / _exit(0) / exit(EXIT_SUCCESS)",
       r"(?<![\w.>:])(?:std\s*::\s*)?(?:_?exit|_Exit|quick_exit)\s*\(\s*(?:0|EXIT_SUCCESS)\s*\)",
       C_FAMILY),
]

GAMING_COMPARISON_OVERRIDES: List[Marker] = [
    _m("py-eq-hash", "__eq__ / __ne__ / __hash__ definition",
       r"^\s*(?:async\s+)?def\s+__(?:eq|ne|hash)__\s*\(|\b__(?:eq|ne|hash)__\s*=(?!=)",
       PY_FAMILY),
    _m("js-valueof", "valueOf definition",
       r"^\s*(?:(?:public|private|protected|static|override|async|readonly)\s+)*valueOf\s*"
       r"(?:\([^)]*\)\s*(?::\s*[^{;=]+)?\{|=\s*(?:\(|function\b|async\b))"
       r"|\bvalueOf\s*:\s*(?:function\b|\(|async\b)|\.valueOf\s*=(?!=)", JS_TS_FAMILY),
    _m("js-symbol-toprimitive", "[Symbol.toPrimitive] definition",
       r"\[\s*Symbol\.toPrimitive\s*\]\s*(?:\(|=(?!=)|:)", JS_TS_FAMILY),
    _m("rust-partialeq-impl", "manual PartialEq / PartialOrd / Hash impl",
       r"\bimpl\b[^{;]*?\b(?:PartialEq|PartialOrd|Hash)\b(?:\s*<[^>]*>)?\s+for\b", {".rs"}),
    _m("jvm-equals-override", "equals / hashCode override",
       r"\bboolean\s+equals\s*\(\s*(?:final\s+)?(?:@\w+\s+)?Object\b|\bint\s+hashCode\s*\(\s*\)"
       r"|\boverride\s+fun\s+(?:equals|hashCode)\s*\(", JVM_FAMILY),
    _m("cs-equals-override", "Equals / GetHashCode / operator== override",
       r"\boverride\s+(?:bool\s+Equals|int\s+GetHashCode)\s*\(|\boperator\s*(?:==|!=)\s*\(",
       {".cs"}),
    _m("cpp-operator-eq", "operator== / operator!= / operator<=> overload",
       r"\boperator\s*(?:==|!=|<=>)\s*\(", C_FAMILY),
]

GAMING_LINE_DETECTORS: List[Tuple[str, List[Marker]]] = [
    ("test_env_detection", GAMING_TEST_ENV),
    ("success_exit", GAMING_SUCCESS_EXITS),
    ("comparison_override", GAMING_COMPARISON_OVERRIDES),
]
GAMING_MESSAGES = {
    "comment": "comment about special-casing, hard-coding or passing tests in non-test code",
    "test_env_detection": "new test-environment detection in non-test code",
    "success_exit": "new early success exit in non-test code",
    "comparison_override": "new comparison override (equality/ordering/hash/coercion)",
}
QUICK_GAMING_LINE_CAP = 20000
LITERAL_MIN_STRING_CHARS = 8
LITERAL_MIN_DIGITS = 5
MAX_LITERAL_CANDIDATES = 500
TEST_CORPUS_CAP_BYTES = 64 * 1024 * 1024
_NUMBER_RE = re.compile(r"(?<![\w.$])(\d+(?:\.\d+)?)(?![\w.])")
_IMPORT_LINE_RE = re.compile(
    r"^\s*(?:import\b|from\s+[\w.]+\s+import\b|export\s+(?:\*|\{[^}]*\})\s*from\b|#\s*include\b|"
    r"use\s+[\w:{]|package\s+[\w.]+|using\s+[\w.]+\s*;|extern\s+crate\b|mod\s+\w+\s*;)"
    r"|\brequire\s*\(\s*['\"]|\bimport\s*\(\s*['\"]")
# Values that recur in code and tests for reasons unrelated to the change: port/int limits and
# common time constants. Round numbers (at most two significant digits) are skipped as well.
WELL_KNOWN_NUMBERS = {"65535", "65536", "32767", "32768", "16384", "86400", "604800",
                      "3600000", "86400000", "31536000", "2147483647", "2147483648",
                      "4294967295", "4294967296", "9007199254740991", "1000000007"}

# Public API surface lines.
_TS_EXPORT_RE = re.compile(r"^\s*export\b")
_RUST_PUB_RE = re.compile(
    r"^\s*pub\s+(?:(?:async|unsafe|const|extern(?:\s+\"[^\"]*\")?)\s+)*"
    r"(?:fn|struct|enum|trait|type|const|static|mod|use|union|macro)\b")
_TS_ENTRY_BASENAME_RE = re.compile(r"^(?:index\.(?:[cm]?[jt]sx?|d\.[cm]?ts)|mod\.ts|public[-_]api\.ts)$",
                                   re.I)

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def utc_now() -> str:
    """ISO 8601 UTC timestamp with a trailing Z."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def to_posix(path: str) -> str:
    """Forward slashes only."""
    return path.replace("\\", "/")


def escape_snippet(text: str, limit: int = SNIPPET_LIMIT) -> str:
    """Repr-style escaping so hidden or control characters are visible; truncated."""
    text = text.rstrip("\r\n")
    if len(text) > limit:
        text = text[:limit] + "..."
    return repr(text)[1:-1]


def extension(path: str) -> str:
    """Lower-case extension of the last path segment ('' when none)."""
    base = path.rsplit("/", 1)[-1].lower()
    if base.endswith(".d.ts"):
        return ".ts"
    return os.path.splitext(base)[1]


def basename(path: str) -> str:
    return path.rsplit("/", 1)[-1]


def is_harden_path(path: str) -> bool:
    return path == HARDEN_DIR_NAME or path.startswith(HARDEN_DIR_NAME + "/")


def is_doc_file(path: str) -> bool:
    return extension(path) in DOC_EXTENSIONS


def is_code_file(path: str) -> bool:
    return extension(path) in CODE_EXTENSIONS


def is_lockfile(path: str) -> bool:
    base = basename(path).lower()
    return base in _LOCKFILE_LOWER or base.endswith(".lock")


def is_manifest(path: str) -> bool:
    base = basename(path)
    return base.lower() in MANIFEST_NAMES or bool(_REQUIREMENTS_RE.match(base)) \
        or base.lower().endswith(".csproj")


def is_binary(data: bytes) -> bool:
    return b"\0" in data[:8192]


# ---------------------------------------------------------------------------
# Glob matching (dialect of _common.py plus {a,b} alternatives)
# ---------------------------------------------------------------------------


def _expand_braces(pattern: str) -> List[str]:
    match = re.search(r"\{([^{}]*,[^{}]*)\}", pattern)
    if not match:
        return [pattern]
    out: List[str] = []
    for alt in match.group(1).split(","):
        out.extend(_expand_braces(pattern[:match.start()] + alt + pattern[match.end():]))
    return out


def _glob_body(pattern: str) -> str:
    pat = to_posix(pattern.strip())
    dir_only = pat.endswith("/")
    core = pat.rstrip("/")
    anchored = "/" in core
    if core.startswith("/"):
        core = core[1:]
    if dir_only:
        core += "/**"
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
    return body


class GlobSet:
    """A list of globs compiled once; `first_match` returns the matching pattern."""

    def __init__(self, patterns: Iterable[str], ignore_case: bool = IS_WINDOWS) -> None:
        flags = re.IGNORECASE if ignore_case else 0
        self.patterns: List[str] = []
        self._compiled: List[Tuple[str, "re.Pattern[str]"]] = []
        for pattern in patterns:
            if not isinstance(pattern, str) or not pattern.strip():
                continue
            self.patterns.append(pattern)
            bodies = [_glob_body(p) for p in _expand_braces(pattern)]
            self._compiled.append((pattern, re.compile("^(?:" + "|".join(bodies) + ")$", flags)))

    def first_match(self, path: str) -> Optional[str]:
        candidate = to_posix(path)
        for pattern, rx in self._compiled:
            if rx.match(candidate):
                return pattern
        return None

    def first_match_except(self, path: str, skip: Iterable[str]) -> Optional[str]:
        """first_match, ignoring the patterns listed in `skip` (compared as written)."""
        skipped = set(skip)
        candidate = to_posix(path)
        for pattern, rx in self._compiled:
            if pattern not in skipped and rx.match(candidate):
                return pattern
        return None

    def __bool__(self) -> bool:
        return bool(self._compiled)


_CI_SET: Optional[GlobSet] = None


def ci_globset() -> GlobSet:
    """Compiled CI globs (built once)."""
    global _CI_SET
    if _CI_SET is None:
        _CI_SET = GlobSet(CI_GLOBS)
    return _CI_SET


def scope_globs(entries: Sequence[str]) -> List[str]:
    """Scope entries without glob characters also cover everything below that directory."""
    out: List[str] = []
    for entry in entries:
        out.append(entry)
        if not re.search(r"[*?\[{]", entry):
            out.append(entry.rstrip("/") + "/**")
    return out


# ---------------------------------------------------------------------------
# Git
# ---------------------------------------------------------------------------


class GitError(RuntimeError):
    """A git command failed or git is unavailable."""


class ConfigError(RuntimeError):
    """.harden/active or .harden/config.json is unreadable or malformed."""


class GuardError(RuntimeError):
    """The guard cannot run (missing base, empty repository...)."""


GIT_PREFIX = ["git", "-c", "core.quotepath=off", "-c", "color.ui=never",
              "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false",
              "-c", "diff.relative=false"]


def _git_env() -> Dict[str, str]:
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_OPTIONAL_LOCKS"] = "0"  # never take the index lock from a hook
    env.pop("GIT_EXTERNAL_DIFF", None)
    return env


def git_run(repo: Path, args: Sequence[str],
            input_bytes: Optional[bytes] = None) -> "subprocess.CompletedProcess[bytes]":
    """Run git without a shell; never raises on a non-zero exit."""
    try:
        return subprocess.run(GIT_PREFIX + list(args), cwd=str(repo), input=input_bytes,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env=_git_env(), check=False)
    except FileNotFoundError as exc:
        raise GitError("git executable not found on PATH") from exc


def git_out(repo: Path, args: Sequence[str], input_bytes: Optional[bytes] = None) -> str:
    """Run git and return stdout as text; raise GitError on failure."""
    proc = git_run(repo, args, input_bytes)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", errors="replace").strip()[:400]
        raise GitError("git " + " ".join(args[:3]) + f" failed ({proc.returncode}): {err}")
    return proc.stdout.decode("utf-8", errors="replace")


def repo_toplevel(start: Path) -> Path:
    """Top-level directory of the repository containing `start`."""
    proc = git_run(start, ["rev-parse", "--show-toplevel"])
    if proc.returncode != 0:
        raise GitError(f"not a git repository: {start}")
    return Path(proc.stdout.decode("utf-8", errors="replace").strip())


def resolve_commit(repo: Path, rev: str) -> Optional[str]:
    """Full SHA of a commit, or None when it does not resolve."""
    proc = git_run(repo, ["rev-parse", "--verify", "--quiet", rev + "^{commit}"])
    if proc.returncode != 0:
        return None
    return proc.stdout.decode("utf-8", errors="replace").strip() or None


def name_status(repo: Path, base: str) -> Dict[str, str]:
    """Path -> status letter for base versus the working tree (tracked files, no renames)."""
    out = git_out(repo, ["diff", "--name-status", "-z", "--no-renames", "--no-ext-diff",
                         "--ignore-submodules=none", base, "--", ":/"])
    parts = out.split("\0")
    result: Dict[str, str] = {}
    i = 0
    while i + 1 < len(parts):
        code, path = parts[i], parts[i + 1]
        i += 2
        if code and path:
            result[to_posix(path)] = code[0]
    return result


def list_untracked(repo: Path) -> List[str]:
    """Untracked, not-ignored files (repo-relative, forward slashes)."""
    out = git_out(repo, ["ls-files", "--others", "--exclude-standard", "--full-name", "-z",
                         "--", ":/"])
    return sorted({to_posix(p) for p in out.split("\0") if p})


def check_attributes(repo: Path, paths: Sequence[str]) -> Dict[str, str]:
    """Paths whose linguist-generated / linguist-vendored attribute is set."""
    if not paths:
        return {}
    payload = "\0".join(paths).encode("utf-8") + b"\0"
    proc = git_run(repo, ["check-attr", "-z", "--stdin", "linguist-generated",
                          "linguist-vendored"], input_bytes=payload)
    if proc.returncode != 0:
        return {}
    fields = proc.stdout.decode("utf-8", errors="replace").split("\0")
    result: Dict[str, str] = {}
    for i in range(0, len(fields) - 2, 3):
        path, attr, value = fields[i], fields[i + 1], fields[i + 2]
        if value in ("set", "true"):
            result[to_posix(path)] = attr
    return result


def read_base_blobs(repo: Path, base: str, paths: Sequence[str],
                    max_bytes: int = MAX_TEXT_BYTES) -> Dict[str, bytes]:
    """Contents of `paths` at `base` in one `git cat-file --batch` call (missing paths omitted)."""
    if not paths:
        return {}
    request = "".join(f"{base}:{p}\n" for p in paths).encode("utf-8")
    proc = git_run(repo, ["cat-file", "--batch"], input_bytes=request)
    if proc.returncode != 0:
        return {}
    data = proc.stdout
    result: Dict[str, bytes] = {}
    pos = 0
    for path in paths:
        nl = data.find(b"\n", pos)
        if nl == -1:
            break
        header = data[pos:nl].decode("utf-8", errors="replace").split(" ")
        pos = nl + 1
        if len(header) >= 2 and header[-1] in ("missing", "ambiguous"):
            continue
        if len(header) != 3:
            break
        size = int(header[2])
        blob = data[pos:pos + size]
        pos += size + 1  # trailing newline after the content
        if header[1] == "blob" and size <= max_bytes:
            result[path] = blob
    return result


def parse_submodules(repo: Path) -> List[str]:
    """Submodule paths (trailing '/') from .gitmodules."""
    gm = repo / ".gitmodules"
    if not gm.is_file():
        return []
    paths: List[str] = []
    for line in gm.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.match(r"\s*path\s*=\s*(.+?)\s*$", line)
        if match:
            paths.append(to_posix(match.group(1)).rstrip("/") + "/")
    return paths


# ---------------------------------------------------------------------------
# Unified diff parsing (full mode)
# ---------------------------------------------------------------------------


@dataclass
class FileChange:
    """Added and removed lines of one file."""

    path: str
    added: List[Tuple[int, str]] = field(default_factory=list)
    # (old line number, text, previous old-side line: context or removed)
    removed: List[Tuple[int, str, str]] = field(default_factory=list)
    untracked: bool = False


_HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
_C_ESCAPES = {"n": 10, "t": 9, '"': 34, "\\": 92, "a": 7, "b": 8, "f": 12, "r": 13, "v": 11}


def _unquote_c(text: str) -> str:
    """Undo git's C-style quoting of a path."""
    if not (len(text) >= 2 and text[0] == '"' and text[-1] == '"'):
        return text
    body = text[1:-1]
    out = bytearray()
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "\\" and i + 1 < len(body):
            nxt = body[i + 1]
            if nxt in _C_ESCAPES:
                out.append(_C_ESCAPES[nxt])
                i += 2
                continue
            if re.match(r"[0-7]{3}", body[i + 1:i + 4]):
                out.append(int(body[i + 1:i + 4], 8))
                i += 4
                continue
            out.extend(nxt.encode("utf-8"))
            i += 2
            continue
        out.extend(ch.encode("utf-8"))
        i += 1
    return out.decode("utf-8", errors="replace")


def _diff_path(raw: str, prefix: str) -> Optional[str]:
    raw = raw.rstrip("\t")
    if raw == "/dev/null":
        return None
    raw = _unquote_c(raw)
    if raw.startswith(prefix):
        raw = raw[len(prefix):]
    return to_posix(raw)


def parse_unified_diff(text: str) -> Dict[str, FileChange]:
    """Parse `git diff` output into per-file added/removed lines with line numbers."""
    files: Dict[str, FileChange] = {}
    cur: Optional[FileChange] = None
    old_path: Optional[str] = None
    old_no = new_no = old_rem = new_rem = 0
    prev_old = ""
    for raw in text.split("\n"):
        line = raw[:-1] if raw.endswith("\r") else raw
        if cur is not None and (old_rem > 0 or new_rem > 0):
            tag = line[:1]
            body = line[1:]
            if tag == " ":
                old_no += 1
                new_no += 1
                old_rem -= 1
                new_rem -= 1
                prev_old = body
                continue
            if tag == "-":
                cur.removed.append((old_no, body, prev_old))
                prev_old = body
                old_no += 1
                old_rem -= 1
                continue
            if tag == "+":
                cur.added.append((new_no, body))
                new_no += 1
                new_rem -= 1
                continue
            if tag == "\\":
                continue
            old_rem = new_rem = 0  # malformed hunk: fall through to header parsing
        if line.startswith("diff --git "):
            cur = None
            old_path = None
        elif line.startswith("--- "):
            old_path = _diff_path(line[4:], "a/")
        elif line.startswith("+++ "):
            path = _diff_path(line[4:], "b/") or old_path
            cur = files.setdefault(path, FileChange(path)) if path else None
        else:
            match = _HUNK_RE.match(line)
            if match and cur is not None:
                old_no = int(match.group(1))
                old_rem = int(match.group(2)) if match.group(2) is not None else 1
                new_no = int(match.group(3))
                new_rem = int(match.group(4)) if match.group(4) is not None else 1
                prev_old = ""
    return files


def content_diff(repo: Path, base: str) -> Dict[str, FileChange]:
    """Tracked changes base..working tree, lockfiles and minified files excluded."""
    excludes = [":(exclude,glob)**/" + name for name in LOCKFILE_NAMES]
    excludes.append(":(exclude,glob)**/*.min.*")
    out = git_out(repo, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames",
                         "-U3", "--src-prefix=a/", "--dst-prefix=b/", base, "--", ":/"] + excludes)
    return parse_unified_diff(out)


# ---------------------------------------------------------------------------
# Run configuration
# ---------------------------------------------------------------------------


@dataclass
class RunConfig:
    """Globs and base commit for one /harden run."""

    root: Path
    base_sha: Optional[str]
    branch: Optional[str]
    tests: GlobSet
    snapshots: GlobSet
    protected: GlobSet
    generated: GlobSet
    allow: GlobSet
    scope: GlobSet
    sources: Dict[str, str]
    active_present: bool
    mode: Optional[str] = None
    # Run reference for report-only mode: HEAD when the run started (base_sha when unknown).
    head_at_start: Optional[str] = None
    allow_config: GlobSet = field(default_factory=lambda: GlobSet([]))
    # Folded repo-relative path -> stripped texts of approved added lines (run_state allow-line).
    allowed_lines: Dict[str, Set[str]] = field(default_factory=dict)
    # Report-only runs started on a dirty tree: path -> blob sha of its content then (None when
    # it was deleted); unchanged since the start, such a file is not a change of the run.
    dirty_at_start: Dict[str, Optional[str]] = field(default_factory=dict)

    @property
    def report_only(self) -> bool:
        return self.mode == "report-only"

    def config_protection(self, path: str) -> Optional[str]:
        """The protected glob that makes `path`, a file under the test globs, a gate or
        test-runner configuration (tests/tsconfig.json, tests/vitest.config.ts), or None. A
        protected entry that is itself a test glob (this run's test list or DEFAULT_TEST_GLOBS)
        marks test files, not configurations: inventory.py suggested the test globs as
        protected before pilot-auto-calibration A01-F53, and a marker written then still lists
        them, which made every existing test read-only (U01-F07)."""
        return self.protected.first_match_except(
            path, list(self.tests.patterns) + DEFAULT_TEST_GLOBS)

    def line_allowed(self, path: str, text: str) -> bool:
        """True when `text` (stripped) was recorded for `path` with run_state.py allow-line."""
        key = to_posix(path).lower() if IS_WINDOWS else to_posix(path)
        return text.strip() in self.allowed_lines.get(key, set())


def _read_json_file(path: Path) -> Dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))  # BOM from PowerShell 5.1
    except (OSError, ValueError) as exc:
        raise ConfigError(f"cannot read {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"{path} must contain a JSON object")
    return data


def _str_list(data: Dict[str, Any], key: str, where: str) -> List[str]:
    value = data.get(key)
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ConfigError(f'{where}: "{key}" must be a list of strings')
    return [to_posix(v) for v in value if v.strip()]


def _allowed_lines(data: Dict[str, Any]) -> Dict[str, Set[str]]:
    """"allowed_lines" of .harden/active: [{"path", "text", ...}] -> folded path -> texts."""
    value = data.get("allowed_lines")
    if value is None:
        return {}
    if not isinstance(value, list):
        raise ConfigError('.harden/active: "allowed_lines" must be a list of objects')
    out: Dict[str, Set[str]] = {}
    for entry in value:
        if not (isinstance(entry, dict) and isinstance(entry.get("path"), str)
                and isinstance(entry.get("text"), str)):
            raise ConfigError('.harden/active: each "allowed_lines" entry needs string "path" '
                              'and "text"')
        path = to_posix(entry["path"].strip())
        key = path.lower() if IS_WINDOWS else path
        if entry["text"].strip():
            out.setdefault(key, set()).add(entry["text"].strip())
    return out


def _dirty_at_start(data: Dict[str, Any]) -> Dict[str, Optional[str]]:
    value = data.get("dirty_at_start")
    if value is None:
        return {}
    if not isinstance(value, dict) or not all(
            isinstance(k, str) and (v is None or isinstance(v, str)) for k, v in value.items()):
        raise ConfigError('.harden/active: "dirty_at_start" must map paths to blob shas or null')
    return {to_posix(k): v for k, v in value.items()}


def config_from_data(root: Path, active: Optional[Dict[str, Any]],
                     config: Optional[Dict[str, Any]]) -> RunConfig:
    """Build a RunConfig from already-parsed .harden/active and config.json objects."""
    active = active or {}
    config = config or {}
    sources: Dict[str, str] = {}

    def pick(key: str, default: List[str]) -> List[str]:
        from_active = _str_list(active, key, ".harden/active")
        if from_active:
            sources[key] = "active"
            return from_active
        from_config = _str_list(config, key, ".harden/config.json")
        if from_config:
            sources[key] = "config"
            return from_config
        sources[key] = "default"
        return list(default)

    tests = pick("test_globs", DEFAULT_TEST_GLOBS)
    protected = pick("protected_globs", DEFAULT_PROTECTED_GLOBS)
    generated = pick("generated_globs", [])
    scope = _str_list(config, "scope", ".harden/config.json")
    base = active.get("base_sha")
    branch = active.get("branch")
    mode = active.get("mode")
    head_at_start = active.get("head_at_start")
    return RunConfig(
        root=root,
        base_sha=base if isinstance(base, str) and base.strip() else None,
        branch=branch if isinstance(branch, str) and branch.strip() else None,
        tests=GlobSet(tests),
        snapshots=GlobSet(DEFAULT_SNAPSHOT_GLOBS),
        protected=GlobSet(protected),
        generated=GlobSet(generated),
        allow=GlobSet(_str_list(active, "allow_test_deletions", ".harden/active")),
        scope=GlobSet(scope_globs(scope)),
        sources=sources,
        active_present=bool(active),
        mode=mode if isinstance(mode, str) and mode.strip() else None,
        head_at_start=head_at_start if isinstance(head_at_start, str) and head_at_start.strip()
        else None,
        allow_config=GlobSet(_str_list(active, "allow_config_edits", ".harden/active")),
        allowed_lines=_allowed_lines(active),
        dirty_at_start=_dirty_at_start(active),
    )


def load_run_config(root: Path) -> RunConfig:
    """Read .harden/active and .harden/config.json under `root` (both optional)."""
    hdir = root / HARDEN_DIR_NAME
    active_path = hdir / ACTIVE_NAME
    config_path = hdir / CONFIG_NAME
    active = _read_json_file(active_path) if active_path.exists() else None
    config = _read_json_file(config_path) if config_path.exists() else None
    return config_from_data(root, active, config)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


class Report:
    """Collects hard violations, soft warnings and informational data."""

    def __init__(self, repo: Path, base: str, quick: bool) -> None:
        self.repo = repo
        self.base = base
        self.quick = quick
        self.hard: List[Dict[str, Any]] = []
        self.soft: List[Dict[str, Any]] = []
        self.info: Dict[str, Any] = {}
        self._counts: Counter = Counter()
        self.truncated: Counter = Counter()

    def add(self, severity: str, kind: str, message: str, file: Optional[str] = None,
            line: Optional[int] = None, snippet: Optional[str] = None, **extra: Any) -> None:
        self._counts[(severity, kind)] += 1
        if self._counts[(severity, kind)] > MAX_ITEMS_PER_KIND:
            self.truncated[f"{severity}:{kind}"] += 1
            return
        item: Dict[str, Any] = {"kind": kind, "severity": severity, "message": message}
        if file is not None:
            item["file"] = file
        if line is not None:
            item["line"] = line
        if snippet is not None:
            item["snippet"] = escape_snippet(snippet)
        item.update(extra)
        (self.hard if severity == "hard" else self.soft).append(item)

    def to_dict(self) -> Dict[str, Any]:
        verdict = "fail" if self.hard else ("warn" if self.soft else "pass")
        return {
            "tool": "diff_guard",
            "version": 1,
            "generated": utc_now(),
            "repo": to_posix(str(self.repo)),
            "base": self.base,
            "mode": "quick" if self.quick else "full",
            "verdict": verdict,
            "hard": self.hard,
            "soft": self.soft,
            "info": self.info,
            "truncated": dict(self.truncated),
        }


# ---------------------------------------------------------------------------
# Classification helpers
# ---------------------------------------------------------------------------


def generated_reason(path: str, cfg: RunConfig, submodules: Sequence[str]) -> Optional[str]:
    """Why a path is vendored or generated (path-based), or None."""
    pattern = cfg.generated.first_match(path)
    if pattern:
        return f"matches generated glob {pattern}"
    for prefix in submodules:
        if path == prefix.rstrip("/") or path.startswith(prefix):
            return "git submodule " + prefix
    segs = path.split("/")
    for idx, seg in enumerate(segs[:-1]):
        if seg in VENDOR_DIR_NAMES:
            return "vendored directory " + "/".join(segs[:idx + 1]) + "/"
        if seg in GENERATED_DIR_NAMES:
            return "generated directory " + "/".join(segs[:idx + 1]) + "/"
    base = segs[-1].lower()
    if ".min." in base:
        return "minified file"
    if ".generated." in base:
        return "generated file name"
    return None


def build_dir_reason(path: str) -> Optional[str]:
    segs = path.split("/")
    for idx, seg in enumerate(segs[:-1]):
        if seg in BUILD_DIR_NAMES:
            return "build output directory " + "/".join(segs[:idx + 1]) + "/"
    return None


def header_has_generated_marker(data: bytes) -> bool:
    text = data[:HEADER_READ_BYTES].decode("utf-8", errors="replace")
    head = "\n".join(text.splitlines()[:HEADER_LINES])
    return bool(GENERATED_MARKER_RE.search(head))


def _read_head(path: Path) -> Optional[bytes]:
    try:
        with open(path, "rb") as handle:
            return handle.read(HEADER_READ_BYTES)
    except OSError:
        return None


def _read_text_file(path: Path) -> Optional[str]:
    try:
        if path.stat().st_size > MAX_TEXT_BYTES:
            return None
        data = path.read_bytes()
    except OSError:
        return None
    if is_binary(data):
        return None
    return data.decode("utf-8", errors="replace")


def comment_text(line: str) -> Optional[str]:
    """Approximate comment part of a source line, or None."""
    match = _COMMENT_START_RE.search(line)
    if not match:
        return None
    return line[match.end():]


def split_comment(line: str) -> Tuple[str, Optional[str]]:
    """(code part, comment part or None) of a source line, with the comment_text heuristic."""
    match = _COMMENT_START_RE.search(line)
    if not match:
        return line, None
    return line[:match.start()], line[match.end():]


def _untracked_change(repo: Path, path: str) -> Optional[FileChange]:
    """An untracked text file as a FileChange whose every line is added (None: unreadable)."""
    text = _read_text_file(repo / path)
    if text is None:
        return None
    change = FileChange(path, untracked=True)
    change.added = [(i + 1, line.rstrip("\r")) for i, line in enumerate(text.split("\n"))]
    if change.added and change.added[-1][1] == "":
        change.added.pop()
    return change


def _package_entries(pkg_dir: Path, rel_dir: str, cache: Dict[str, Set[str]]) -> Set[str]:
    """Repo-relative entry files declared by a package.json (main/module/types/exports)."""
    if rel_dir in cache:
        return cache[rel_dir]
    entries: Set[str] = set()
    pkg = pkg_dir / "package.json"
    if pkg.is_file():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8-sig", errors="replace"))
        except ValueError:
            data = {}
        values: List[str] = []

        def collect(node: Any) -> None:
            if isinstance(node, str):
                values.append(node)
            elif isinstance(node, dict):
                for sub in node.values():
                    collect(sub)
            elif isinstance(node, list):
                for sub in node:
                    collect(sub)

        if isinstance(data, dict):
            for key in ("main", "module", "types", "typings", "browser", "exports", "bin"):
                collect(data.get(key))
        for value in values:
            value = to_posix(value)
            if value.startswith("./"):
                value = value[2:]
            if not value or value.startswith("/") or ".." in value.split("/"):
                continue
            entries.add((rel_dir + "/" + value) if rel_dir else value)
    cache[rel_dir] = entries
    return entries


def is_entry_file(repo: Path, path: str, cache: Dict[str, Set[str]]) -> bool:
    """True for index/entry files whose `export` lines are the package's public API."""
    if _TS_ENTRY_BASENAME_RE.match(basename(path)) or path.endswith(".d.ts"):
        return True
    parts = path.split("/")
    for depth in range(len(parts) - 1, -1, -1):
        rel_dir = "/".join(parts[:depth])
        pkg_dir = repo / rel_dir if rel_dir else repo
        if (pkg_dir / "package.json").is_file():
            return path in _package_entries(pkg_dir, rel_dir, cache)
    return False


def python_all_names(source: str) -> Optional[Set[str]]:
    """Names listed in a module's `__all__`, or None when there is no literal __all__."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None
    names: Optional[Set[str]] = None
    for node in tree.body:
        targets: List[ast.expr] = []
        value: Optional[ast.expr] = None
        if isinstance(node, ast.Assign):
            targets, value = node.targets, node.value
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets, value = [node.target], node.value
        if value is None:
            continue
        if not any(isinstance(t, ast.Name) and t.id == "__all__" for t in targets):
            continue
        if isinstance(value, (ast.List, ast.Tuple)):
            found = {elt.value for elt in value.elts
                     if isinstance(elt, ast.Constant) and isinstance(elt.value, str)}
            names = (names or set()) | found
    return names


# ---------------------------------------------------------------------------
# The guard
# ---------------------------------------------------------------------------


def _status_label(code: str) -> str:
    return {"A": "added", "?": "added (untracked)", "D": "deleted", "M": "modified",
            "T": "type changed", "U": "unmerged"}.get(code, "changed")


def run_guard(repo: Path, base: str, cfg: RunConfig, quick: bool = False) -> Report:
    """Run every check and return the report. Raises GitError/GuardError on failure."""
    report = Report(repo, base, quick)
    base_full = resolve_commit(repo, base)
    if base_full is None:
        report.add("hard", "base_not_found",
                   f"base commit {base} does not resolve: history was rewritten and pruned, "
                   f"or the SHA is wrong. Stop and tell the user.")
        return report
    report.base = base_full
    head = resolve_commit(repo, "HEAD")
    if head is None:
        raise GuardError("HEAD does not resolve (empty repository?)")
    report.info["head"] = head
    ancestry = git_run(repo, ["merge-base", "--is-ancestor", base_full, head])
    if ancestry.returncode == 1:
        report.add("hard", "history_rewritten",
                   f"base {base_full[:12]} is no longer an ancestor of HEAD {head[:12]}: "
                   f"history was rewritten (rebase, reset, amend of the base, filter-*)")
    elif ancestry.returncode != 0:
        raise GitError("git merge-base --is-ancestor failed: "
                       + ancestry.stderr.decode("utf-8", errors="replace").strip()[:300])
    _replay_pending_check(repo, report)

    status = name_status(repo, base_full)
    untracked = list_untracked(repo)
    for path in untracked:
        status.setdefault(path, "?")
    status = {p: s for p, s in status.items() if not is_harden_path(p)}
    submodules = parse_submodules(repo)
    attrs = check_attributes(repo, sorted(status))

    if cfg.report_only:
        _report_only_checks(repo, base_full, head, cfg, status, report)

    stats = Counter()
    allowed: List[str] = []
    allowed_modified: List[str] = []
    allowed_config: List[str] = []
    new_tests: List[str] = []
    deleted_tests: List[str] = []
    strengthen_candidates: List[Tuple[str, str]] = []
    deleted_files: List[str] = []
    header_candidates: List[str] = []
    deleted_candidates: List[str] = []

    for path in sorted(status):
        code = status[path]
        existed = code not in ("A", "?")
        stats["files_changed"] += 1
        stats["files_" + {"A": "added", "?": "untracked", "D": "deleted"}.get(code, "modified")] += 1
        if code == "D":
            deleted_files.append(path)
        snapshot_pattern = cfg.snapshots.first_match(path)
        test_pattern = cfg.tests.first_match(path) or snapshot_pattern
        is_test = test_pattern is not None
        if is_test and existed:
            if cfg.allow.first_match(path):
                allowed.append(path)
                if code != "D":
                    allowed_modified.append(path)  # must be deletion-only (checked below)
            elif code == "D":
                report.add("hard", "test_deleted",
                           f"existing test/snapshot file {_status_label(code)} "
                           f"(matches {test_pattern}); tests are read-only during /harden",
                           file=path, glob=test_pattern, reason="deleted")
                deleted_tests.append(path)
            elif code == "T" or snapshot_pattern:
                reason = "type-changed" if code == "T" else "not-strengthenable"
                report.add("hard", "test_modified",
                           f"existing test/snapshot file {_status_label(code)} (matches "
                           f"{test_pattern}): "
                           + ("its file type changed" if code == "T" else
                              "snapshot and golden files never gain lines") + " (PC-06)",
                           file=path, glob=test_pattern, reason=reason)
            else:
                strengthen_candidates.append((path, test_pattern))  # checked below (PC-06)
        elif is_test:
            new_tests.append(path)

        # Test and snapshot files are judged by the test rules above only, so an approved
        # deletion is not refused again by a protected glob that also covers tests.
        protected_pattern = None if is_test else cfg.protected.first_match(path)
        config_allowed = False
        if protected_pattern:
            if existed and code not in ("D", "T") and cfg.allow_config.first_match(path):
                config_allowed = True
                allowed_config.append(path)
            elif existed:
                kind = "protected_deleted" if code == "D" else "protected_modified"
                report.add("hard", kind,
                           f"protected gate/config file {_status_label(code)} "
                           f"(matches {protected_pattern})", file=path, glob=protected_pattern)
            else:
                report.add("soft", "protected_config_added",
                           f"new file matching protected glob {protected_pattern}: a new "
                           f"config can loosen gates; review it", file=path)
        protected_hard = bool(protected_pattern) and existed and not config_allowed

        reason = None if is_lockfile(path) else generated_reason(path, cfg, submodules)
        if reason is None and path in attrs and not is_lockfile(path):
            reason = f"{attrs[path]} attribute set in .gitattributes"
        if reason:
            report.add("hard", "generated_touched",
                       f"vendored/generated file {_status_label(code)} ({reason})", file=path)
        else:
            build = build_dir_reason(path)
            if build:
                report.add("soft", "build_output_touched",
                           f"file under a build-output directory {_status_label(code)} ({build})",
                           file=path)
            elif existed and not is_lockfile(path) and not is_test:
                if code == "D":
                    deleted_candidates.append(path)
                else:
                    header_candidates.append(path)

        if is_lockfile(path) and not protected_hard:
            report.add("soft", "lockfile_changed", f"lockfile {_status_label(code)}", file=path)
        if ci_globset().first_match(path) and not protected_pattern:
            report.add("soft", "ci_changed", f"CI file {_status_label(code)}", file=path)
        if is_manifest(path) and (not protected_pattern or config_allowed):
            report.add("soft", "manifest_changed",
                       f"dependency manifest {_status_label(code)}", file=path)
        if not existed and not is_test and not protected_pattern:
            report.add("soft", "new_file", "new non-test file", file=path)
        if cfg.scope and not is_test and not cfg.scope.first_match(path):
            report.add("soft", "outside_scope",
                       "changed file is outside the declared scope (.harden/config.json)",
                       file=path)

    # Generated-code header markers on existing files (cheap: first 2 KiB of the file).
    for path in header_candidates[:QUICK_HEADER_FILE_CAP]:
        head_bytes = _read_head(repo / path)
        if head_bytes and not is_binary(head_bytes) and header_has_generated_marker(head_bytes):
            report.add("hard", "generated_touched",
                       f"file with a generated-code header marker {_status_label(status[path])}",
                       file=path)
    if not quick and deleted_candidates:
        blobs = read_base_blobs(repo, base_full, deleted_candidates[:QUICK_HEADER_FILE_CAP],
                                max_bytes=10 * MAX_TEXT_BYTES)
        for path, blob in blobs.items():
            if not is_binary(blob) and header_has_generated_marker(blob):
                report.add("hard", "generated_touched",
                           "file with a generated-code header marker deleted", file=path)

    if allowed_modified:
        _deletion_only_checks(repo, base_full, allowed_modified, status, report)
    _strengthen_checks(repo, base_full, head, cfg, strengthen_candidates, report,
                       walk=ancestry.returncode == 0)
    if deleted_tests:
        _annotate_renames(repo, base_full, deleted_tests, status, report)

    report.info.update({
        "allowed_test_changes": allowed,
        "allowed_config_edits": allowed_config,
        "new_test_files": new_tests,
        "deleted_files": deleted_files,
        "globs": {k: v for k, v in cfg.sources.items()},
    })

    if quick:
        # Runs after the file-level checks, and never aborts them: the Stop hook relies on
        # the hard results above.
        try:
            changes = quick_code_changes(repo, base_full, cfg, untracked,
                                         extra_paths=[p for p in allowed_config
                                                      if not is_lockfile(p)])
            _quick_marker_checks(cfg, changes, submodules, attrs, report)
            _config_weakening_checks(cfg, changes, allowed_config, report)
            _test_gaming_checks(repo, base_full, cfg, changes, submodules, attrs, status,
                                untracked, report, quick=True)
        except (GitError, OSError) as exc:
            report.add("soft", "test_gaming",
                       f"the line scans of --quick mode (suppressions, skip markers, test "
                       f"gaming) could not run ({exc}); run diff_guard.py without --quick",
                       category="scan_error")
    else:
        branch_proc = git_run(repo, ["symbolic-ref", "-q", "--short", "HEAD"])
        current_branch = branch_proc.stdout.decode("utf-8", errors="replace").strip() or None
        report.info["branch"] = current_branch
        if cfg.branch and current_branch != cfg.branch:
            report.add("soft", "branch_changed",
                       f"current branch {current_branch or '(detached)'} differs from the run "
                       f"branch {cfg.branch}")
        _content_checks(repo, base_full, cfg, status, untracked, submodules, attrs, report, stats)

    report.info["stats"] = dict(stats)
    return report


def _report_only_checks(repo: Path, base: str, head: str, cfg: RunConfig,
                        status: Dict[str, str], report: Report) -> None:
    """Report-only run: any commit or working-tree change outside .harden/ is HARD.

    The reference is the HEAD recorded when the run started ("head_at_start" in .harden/active),
    else the base commit, so an older --base does not count as a change of this run.
    """
    ref = base
    if cfg.head_at_start:
        resolved = resolve_commit(repo, cfg.head_at_start)
        if resolved is not None:
            ref = resolved
    changed = status if ref == base else {
        p: s for p, s in name_status(repo, ref).items() if not is_harden_path(p)}
    if ref != base:
        for path in status:
            if status[path] == "?":
                changed.setdefault(path, "?")
    carried = [p for p in changed if p in cfg.dirty_at_start]
    if carried:
        present = [p for p in carried if (repo / p).is_file()]
        now: Dict[str, Optional[str]] = {p: None for p in carried}
        if present:
            proc = git_run(repo, ["hash-object", "--stdin-paths"],
                           input_bytes=("\n".join(present) + "\n").encode("utf-8"))
            values = proc.stdout.decode("utf-8", errors="replace").split() \
                if proc.returncode == 0 else []
            if len(values) == len(present):
                now.update(zip(present, values))
            else:
                now.update({p: "" for p in present})  # unknown: counted as changed
        unchanged = [p for p in carried if now[p] == cfg.dirty_at_start[p]]
        for path in unchanged:
            changed.pop(path, None)
        if unchanged:
            report.info["dirty_at_start_unchanged"] = sorted(unchanged)
    commits = git_run(repo, ["rev-list", "--count", f"{ref}..{head}"])
    count = commits.stdout.decode("utf-8", errors="replace").strip() if commits.returncode == 0 \
        else ""
    if count.isdigit() and int(count) > 0:
        report.add("hard", "report_only_change",
                   f"{count} commit(s) after {ref[:12]} in a report-only run (mode report-only "
                   f"in .harden/active): report-only runs never commit")
    for path in sorted(changed):
        report.add("hard", "report_only_change",
                   f"file {_status_label(changed[path])} in a report-only run (mode report-only "
                   f"in .harden/active): only .harden/ may change; restore it", file=path)


def _replay_pending_check(repo: Path, report: Report) -> None:
    """A strengthen.py replay that did not restore its files blocks everything (PC-06)."""
    state = repo / HARDEN_DIR_NAME / "tmp" / "replay-state.json"
    if not state.exists():
        return
    try:
        files = json.loads(state.read_text(encoding="utf-8")).get("files")
        shown = ", ".join(files) if isinstance(files, list) and files else "unknown"
    except (OSError, ValueError, AttributeError):
        shown = "unknown"
    report.add("hard", "replay_pending",
               f"a strengthen.py replay did not restore {shown}: run python "
               f"\"{_HERE}/strengthen.py\" restore before anything else (PC-06)")


def numstat_counts(repo: Path, base: str, paths: Sequence[str]
                   ) -> Dict[str, Optional[Tuple[int, int]]]:
    """(added, deleted) per path, base versus the working tree, with the minimal diff (None for
    binary files)."""
    if not paths:
        return {}
    out = git_out(repo, ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff",
                         "--no-textconv", "--diff-algorithm=minimal", base, "--"]
                  + [":(literal)" + p for p in paths])
    result: Dict[str, Optional[Tuple[int, int]]] = {}
    for record in out.split("\0"):
        parts = record.split("\t", 2)
        if len(parts) == 3 and parts[2]:
            path = to_posix(parts[2].lstrip("\n"))
            result[path] = (int(parts[0]), int(parts[1])) if parts[0].isdigit() and \
                parts[1].isdigit() else None
    return result


def _strengthen_checks(repo: Path, base: str, head: str, cfg: RunConfig,
                       candidates: Sequence[Tuple[str, str]], report: Report, walk: bool) -> None:
    """Existing test files may only gain the lines strengthen.py accepts: the working tree
    against base, and every commit of base..HEAD against its parent (protocol-change PC-06;
    user-policy-autonomy U01-F07). Never raises; fails closed."""
    report.info["strengthened_tests"] = []
    report.info["strengthen_checker"] = "ok"
    reported: Set[str] = set()

    def fail_closed(detail: str) -> None:
        for path, glob in candidates:
            if path in reported:
                continue
            reported.add(path)
            report.add("hard", "test_modified",
                       f"existing test file changed and the additions checker is unavailable "
                       f"({detail}): every change to an existing test is refused (PC-06)",
                       file=path, glob=glob, reason="checker-unavailable")

    if ST is None:
        report.info["strengthen_checker"] = "unavailable: " + str(ST_ERROR)
        fail_closed(str(ST_ERROR))
        return
    try:
        if candidates:
            paths = [p for p, _g in candidates]
            counts = numstat_counts(repo, base, paths)
            blobs = read_base_blobs(repo, base, paths, max_bytes=ST.MAX_BYTES)
            for path, glob in candidates:
                problems = _file_problems(repo, cfg, path, blobs.get(path), counts.get(path))
                if problems:
                    first = problems[0]
                    snippet = None
                    if first.line:
                        try:
                            lines = (repo / path).read_text(encoding="utf-8",
                                                            errors="replace").splitlines()
                            snippet = lines[first.line - 1] if first.line <= len(lines) else None
                        except OSError:
                            snippet = None
                    reported.add(path)
                    report.add("hard", "test_modified",
                               f"existing test file changed beyond checked additions "
                               f"({first.code}{' at line %d' % first.line if first.line else ''}"
                               f"): {first.message} (PC-06; user-policy-autonomy U01-F07)",
                               file=path, line=first.line, snippet=snippet, glob=glob,
                               reason=first.code,
                               problems=[{"code": p.code, "line": p.line, "message": p.message}
                                         for p in problems[:10]])
                else:
                    added = (counts.get(path) or (0, 0))[0]
                    report.info["strengthened_tests"].append({"file": path,
                                                              "added_lines": added})
        if walk:
            def is_candidate(p: str) -> bool:
                return bool(cfg.tests.first_match(p)) and not cfg.snapshots.first_match(p) \
                    and not cfg.allow.first_match(p) and not is_harden_path(p)
            done = {i.get("file") for i in report.hard
                    if i["kind"] in ("test_modified", "test_deleted")}
            for item in ST.commit_walk(repo, base, head, is_candidate):
                path, problem, sha = item["file"], item["problem"], item["commit"]
                if path in done:
                    continue
                report.add("hard", "test_modified",
                           f"commit {sha[:12]} changed existing test file {path} beyond checked "
                           f"additions ({problem.code}): {problem.message}; undo it with `git "
                           f"revert --no-edit {sha[:12]}`; if that revert conflicts, first revert "
                           f"the later commits that change {path}, newest first (PC-06, PC-20)",
                           file=path, line=problem.line, reason=problem.code, commit=sha)
    except Exception as exc:  # noqa: BLE001 - fail closed (GC-03 revision)
        report.info["strengthen_checker"] = f"{type(exc).__name__}: {exc}"[:300]
        fail_closed(f"{type(exc).__name__}: {exc}"[:300])


def _file_problems(repo: Path, cfg: RunConfig, path: str, blob: Optional[bytes],
                   counts: Optional[Tuple[int, int]]) -> List[Any]:
    """The strengthen.py problems of one existing test file in the working tree."""
    target = repo / path
    try:
        data = target.read_bytes()
    except OSError:
        data = None
    if blob is None or data is None:
        return [ST.Problem("unverifiable", None, "the base or working-tree version cannot be "
                           "read")]
    if len(blob) > ST.MAX_BYTES or len(data) > ST.MAX_BYTES:
        return [ST.Problem("too-large", None, f"larger than {ST.MAX_BYTES} bytes")]
    if b"\x00" in blob or b"\x00" in data or counts is None:
        return [ST.Problem("binary", None, "binary content")]
    try:
        base_text, new_text = blob.decode("utf-8"), data.decode("utf-8")
    except UnicodeDecodeError:
        return [ST.Problem("not-utf8", None, "not UTF-8")]
    detail = ST.not_strengthenable(path, base_text, snapshot=False,
                                   protected=bool(cfg.config_protection(path)))
    if detail:
        return [ST.Problem("not-strengthenable", None, detail)]
    problems = list(ST.check_additions(base_text, new_text, path))
    if not any(p.code in ("removed-line", "bom-changed") for p in problems) and \
            counts[1] > ST.expected_deletions(base_text, new_text):
        problems.insert(0, ST.Problem("eol-changed", None, "existing lines changed their line "
                                      "endings or were rewritten"))
    return problems


def _annotate_renames(repo: Path, base: str, deleted: Sequence[str], status: Dict[str, str],
                      report: Report) -> None:
    """A deleted existing test whose content reappears at a new path was renamed."""
    exts = {extension(p) for p in deleted}
    new_paths = [p for p, s in sorted(status.items()) if s in ("A", "?")
                 and extension(p) in exts][:200]
    if not new_paths:
        return
    blobs = read_base_blobs(repo, base, list(deleted))
    texts: Dict[str, str] = {}
    for p in new_paths:
        try:
            texts[p] = (repo / p).read_bytes().decode("utf-8", errors="replace").replace(
                "\r\n", "\n")
        except OSError:
            continue
    for path in deleted:
        blob = blobs.get(path)
        if blob is None:
            continue
        old = blob.decode("utf-8", errors="replace").replace("\r\n", "\n")
        target = next((p for p in new_paths if extension(p) == extension(path)
                       and texts.get(p) == old), None)
        if target is None:
            continue
        for item in report.hard:
            if item["kind"] == "test_deleted" and item.get("file") == path:
                item["reason"] = "renamed"
                item["renamed_to"] = target
                item["message"] += f" (renamed to {target}: moving an existing test file is a " \
                                   "deletion)"


def numstat_added(repo: Path, base: str, paths: Sequence[str]) -> Dict[str, Optional[int]]:
    """Added-line count per path, base versus the working tree (None for binary files)."""
    if not paths:
        return {}
    out = git_out(repo, ["diff", "--numstat", "-z", "--no-renames", "--no-ext-diff",
                         "--no-textconv", base, "--"] + [":(literal)" + p for p in paths])
    result: Dict[str, Optional[int]] = {}
    for record in out.split("\0"):
        parts = record.split("\t", 2)
        if len(parts) == 3 and parts[2]:
            result[to_posix(parts[2].lstrip("\n"))] = int(parts[0]) if parts[0].isdigit() else None
    return result


def _deletion_only_checks(repo: Path, base: str, paths: Sequence[str], status: Dict[str, str],
                          report: Report) -> None:
    """An allow-listed test file may only lose lines (lens-dead-code DC-15; dossier
    dead-code-certainty G102-F14, G102-F15: the change to each approved file is deletion-only)."""
    added = numstat_added(repo, base, paths)
    for path in paths:
        count = added.get(path, 0)
        if status.get(path) == "T" or count is None or count > 0:
            what = "changed type" if status.get(path) == "T" else (
                "is binary" if count is None else f"gained {count} added line(s)")
            report.add("hard", "test_modified",
                       f"allow-listed test file {what}: an approved test deletion removes lines "
                       f"only, in the refactor(dead-code) commit that deletes the symbols it "
                       f"references (DC-15)", file=path, allowed_deletion=True)


def _marker_line(cfg: RunConfig, report: Report, path: str, ext: str, doc: bool, lineno: int,
                 text: str, removed_budget: Counter) -> None:
    """Report new skip/focus markers and suppressions on one added line."""
    hits = [m for m in SKIP_MARKERS if m.applies_to(ext) and m.regex.search(text)]
    sups = [m for m in SUPPRESSIONS if m.applies_to(ext) and m.regex.search(text)]
    if not (hits or sups):
        return
    key = text.strip()
    if removed_budget[key] > 0:
        removed_budget[key] -= 1  # pre-existing line moved or re-indented
        return
    if cfg.line_allowed(path, text):
        report.info.setdefault("allowed_lines_used", []).append(
            {"file": path, "line": lineno, "patterns": [m.ident for m in hits + sups]})
        return
    for marker in hits:
        if doc:
            report.add("soft", "marker_in_docs",
                       f"skip/focus marker {marker.label} added in a documentation "
                       f"file", file=path, line=lineno, snippet=text, pattern=marker.ident)
        else:
            report.add("hard", "marker_added",
                       f"new skip/focus marker {marker.label}", file=path,
                       line=lineno, snippet=text, pattern=marker.ident)
    for marker in sups:
        if doc:
            report.add("soft", "suppression_in_docs",
                       f"suppression {marker.label} added in a documentation file",
                       file=path, line=lineno, snippet=text, pattern=marker.ident)
        else:
            report.add("hard", "suppression_added",
                       f"new suppression {marker.label}: fix the cause or report "
                       f"it, never silence it", file=path, line=lineno,
                       snippet=text, pattern=marker.ident)


def _removed_budget(changes: Dict[str, FileChange]) -> Counter:
    budget: Counter = Counter()
    for change in changes.values():
        for _, text, _ in change.removed:
            if text.strip():
                budget[text.strip()] += 1
    return budget


def _quick_marker_checks(cfg: RunConfig, changes: Dict[str, FileChange],
                         submodules: Sequence[str], attrs: Dict[str, str],
                         report: Report) -> None:
    """--quick: the SKIP_MARKERS and SUPPRESSIONS scans on the added lines of the quick diff
    (code files and approved config edits), capped at QUICK_GAMING_LINE_CAP lines."""
    info: Dict[str, Any] = {"files_scanned": 0, "added_lines_scanned": 0, "truncated": False}
    report.info["quick_markers"] = info
    targets = {p: c for p, c in changes.items()
               if not is_harden_path(p) and not generated_reason(p, cfg, submodules)
               and p not in attrs}
    removed_budget = _removed_budget(targets)
    scanned = 0
    for path in sorted(targets):
        added = targets[path].added
        if added:
            info["files_scanned"] += 1
        ext = extension(path)
        doc = is_doc_file(path)
        for lineno, text in added:
            if scanned >= QUICK_GAMING_LINE_CAP:
                info["truncated"] = True
                break
            scanned += 1
            _marker_line(cfg, report, path, ext, doc, lineno, text, removed_budget)
        if info["truncated"]:
            break
    info["added_lines_scanned"] = scanned


def _config_weakening_checks(cfg: RunConfig, changes: Dict[str, FileChange],
                             paths: Sequence[str], report: Report) -> None:
    """Approved config edits (allow_config_edits) may not loosen a gate: CONFIG_WEAKENING
    patterns and lowered THRESHOLD_RE values on added lines are HARD config_weakened."""
    for path in paths:
        change = changes.get(path)
        if change is None:
            continue
        removed_texts = Counter(t.strip() for _, t, _ in change.removed if t.strip())
        old_thresholds: Dict[str, float] = {}
        for _, text, _ in change.removed:
            for match in THRESHOLD_RE.finditer(text):
                key = match.group(1).lower().replace("-", "_")
                old_thresholds[key] = max(old_thresholds.get(key, 0.0), float(match.group(2)))
        for lineno, text in change.added:
            key_text = text.strip()
            if not key_text or cfg.line_allowed(path, text):
                continue
            if removed_texts[key_text] > 0:
                removed_texts[key_text] -= 1
                continue
            reasons = [m.label for m in CONFIG_WEAKENING if m.regex.search(text)]
            for match in THRESHOLD_RE.finditer(text):
                key = match.group(1).lower().replace("-", "_")
                if key in old_thresholds and float(match.group(2)) < old_thresholds[key]:
                    reasons.append(f"{match.group(1)} lowered from {old_thresholds[key]:g} to "
                                   f"{float(match.group(2)):g}")
            if reasons:
                report.add("hard", "config_weakened",
                           f"approved config edit loosens a gate ({'; '.join(reasons)}): the "
                           f"allow-config-edit record covers the dependency change, not a "
                           f"weaker gate (PC-08)", file=path, line=lineno, snippet=text)


def _content_checks(repo: Path, base: str, cfg: RunConfig, status: Dict[str, str],
                    untracked: Sequence[str], submodules: Sequence[str], attrs: Dict[str, str],
                    report: Report, stats: Counter) -> None:
    """Full-mode checks on added and removed lines."""
    changes = content_diff(repo, base)
    for path in untracked:
        if is_harden_path(path) or is_lockfile(path):
            continue
        change = _untracked_change(repo, path)
        if change is not None:
            changes[path] = change
    changes = {p: c for p, c in changes.items() if not is_harden_path(p)}

    removed_budget: Counter = Counter()
    added_budget: Counter = Counter()
    for change in changes.values():
        for _, text, _ in change.removed:
            if text.strip():
                removed_budget[text.strip()] += 1
        for _, text in change.added:
            if text.strip():
                added_budget[text.strip()] += 1
        stats["lines_added"] += len(change.added)
        stats["lines_removed"] += len(change.removed)

    entry_cache: Dict[str, Set[str]] = {}
    all_candidates: List[str] = []
    for path in sorted(changes):
        change = changes[path]
        if generated_reason(path, cfg, submodules) or path in attrs:
            continue
        ext = extension(path)
        doc = is_doc_file(path)
        is_test = bool(cfg.tests.first_match(path) or cfg.snapshots.first_match(path))
        code = is_code_file(path)

        for lineno, text in change.added:
            _marker_line(cfg, report, path, ext, doc, lineno, text, removed_budget)
            if code:
                for marker in ESCAPE_HATCHES:
                    if marker.applies_to(ext) and marker.regex.search(text):
                        key = text.strip()
                        if removed_budget[key] > 0:
                            removed_budget[key] -= 1
                            continue
                        report.add("soft", "escape_hatch_added",
                                   f"new escape-hatch type {marker.label}", file=path,
                                   line=lineno, snippet=text, pattern=marker.ident)
                comment = comment_text(text)
                if comment and SESSION_REF_RE.search(comment):
                    report.add("soft", "session_referential_comment",
                               "comment narrates the change history instead of describing the "
                               "code", file=path, line=lineno, snippet=text)

        if code and not is_test and change.removed:
            _removed_line_checks(repo, path, ext, change, added_budget, report, entry_cache)
        if ext in PY_FAMILY and not is_test and status.get(path) in ("M", "D", "T"):
            if basename(path) == "__init__.py" or any("__all__" in t for _, t, _ in change.removed):
                all_candidates.append(path)

    if all_candidates:
        blobs = read_base_blobs(repo, base, all_candidates[:50])
        for path in all_candidates[:50]:
            before_src = blobs.get(path)
            if before_src is None:
                continue
            before = python_all_names(before_src.decode("utf-8", errors="replace"))
            if not before:
                continue
            after_text = _read_text_file(repo / path) if status.get(path) != "D" else ""
            after = python_all_names(after_text or "") or set()
            gone = sorted(before - after)
            if gone:
                report.add("soft", "public_api_removed",
                           f"names removed from __all__: {', '.join(gone[:20])}", file=path,
                           names=gone)

    _config_weakening_checks(cfg, changes, report.info.get("allowed_config_edits") or [], report)
    _test_gaming_checks(repo, base, cfg, changes, submodules, attrs, status, untracked, report,
                        quick=False)


def _removed_line_checks(repo: Path, path: str, ext: str, change: FileChange,
                         added_budget: Counter, report: Report,
                         entry_cache: Dict[str, Set[str]]) -> None:
    guard_examples: List[Dict[str, Any]] = []
    guard_count = 0
    keyword_examples: List[Dict[str, Any]] = []
    keyword_count = 0
    entry = ext in JS_TS_FAMILY and is_entry_file(repo, path, entry_cache)
    for lineno, text, prev in change.removed:
        key = text.strip()
        if not key:
            continue
        if added_budget[key] > 0:
            added_budget[key] -= 1  # moved, not removed
            continue
        what = None
        for ident, rx, exts in GUARD_PATTERNS:
            if (exts is None or ext in exts) and rx.search(text):
                what = ident
                break
        if what is None and ((_THROW_RE.search(text) and _IF_LINE_RE.search(prev))
                             or _INLINE_IF_THROW_RE.search(text)):
            what = "throw/raise in if-block"
        if what:
            guard_count += 1
            if len(guard_examples) < EXAMPLES_PER_FILE:
                guard_examples.append({"line": lineno, "what": what,
                                       "snippet": escape_snippet(text)})
        elif GUARD_KEYWORD_RE.search(text):
            keyword_count += 1
            if len(keyword_examples) < EXAMPLES_PER_FILE:
                keyword_examples.append({"line": lineno, "snippet": escape_snippet(text)})
        if entry and _TS_EXPORT_RE.search(text):
            report.add("soft", "public_api_removed",
                       "export line removed or changed in an entry file (public API)",
                       file=path, line=lineno, snippet=text)
        elif ext == ".rs" and _RUST_PUB_RE.search(text):
            report.add("soft", "public_api_removed", "public Rust item removed or changed",
                       file=path, line=lineno, snippet=text)
    if guard_count:
        report.add("soft", "removed_guard_lines",
                   f"{guard_count} assertion/guard line(s) removed from non-test code; justify "
                   f"each removal", file=path, count=guard_count, examples=guard_examples)
    if keyword_count:
        report.add("soft", "removed_guard_keyword_lines",
                   f"{keyword_count} removed line(s) mention timeouts/limits/checks/locks/"
                   f"retries (guard-deletion audit)", file=path, count=keyword_count,
                   examples=keyword_examples)


# ---------------------------------------------------------------------------
# Test gaming (PC-07)
# ---------------------------------------------------------------------------


def _is_test_like(cfg: RunConfig, path: str) -> bool:
    return bool(cfg.tests.first_match(path) or cfg.snapshots.first_match(path))


def _norm_line(text: str) -> str:
    """Line identity for "moved, not new": whitespace runs and quote styles ignored."""
    return re.sub(r"\s+", " ", text.strip()).replace("'", '"').replace("`", '"')


def gaming_hits(ext: str, text: str) -> List[Tuple[str, str, str]]:
    """(category, pattern id, label) for every test-gaming pattern on one source line.

    The comment pattern looks at the comment part only; the code patterns at the code part.
    """
    code, comment = split_comment(text)
    hits: List[Tuple[str, str, str]] = []
    if comment is not None:
        match = GAMING_COMMENT_RE.search(comment)
        if match:
            hits.append(("comment", "gaming-comment", match.group(0)))
    if code.strip():
        for category, markers in GAMING_LINE_DETECTORS:
            for marker in markers:
                if marker.applies_to(ext) and marker.regex.search(code):
                    hits.append((category, marker.ident, marker.label))
    return hits


def quick_code_changes(repo: Path, base: str, cfg: RunConfig, untracked: Sequence[str],
                       extra_paths: Sequence[str] = ()) -> Dict[str, FileChange]:
    """Added/removed lines for --quick: one `git diff -U0` limited to code extensions and
    `extra_paths` (approved config edits), plus untracked code files, test files included
    (at most QUICK_HEADER_FILE_CAP). The test-gaming scan skips test files itself; the
    marker and suppression scan needs them (a new test file with a skip marker)."""
    specs = [":(glob,icase)**/*" + ext for ext in sorted(CODE_EXTENSIONS)]
    specs += [":(literal)" + p for p in extra_paths if not is_code_file(p)]
    out = git_out(repo, ["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames",
                         "-U0", "--src-prefix=a/", "--dst-prefix=b/", base, "--"] + specs)
    changes = parse_unified_diff(out)
    budget = QUICK_HEADER_FILE_CAP
    for path in untracked:
        if is_harden_path(path) or not is_code_file(path):
            continue
        if budget <= 0:
            break
        budget -= 1
        change = _untracked_change(repo, path)
        if change is not None:
            changes[path] = change
    return changes


def _test_gaming_checks(repo: Path, base: str, cfg: RunConfig, changes: Dict[str, FileChange],
                        submodules: Sequence[str], attrs: Dict[str, str], status: Dict[str, str],
                        untracked: Sequence[str], report: Report, quick: bool) -> None:
    """Report test-gaming patterns on lines added to non-test code (PC-07)."""
    info: Dict[str, Any] = {"files_scanned": 0, "added_lines_scanned": 0, "truncated": False}
    report.info["test_gaming"] = info
    targets: Dict[str, FileChange] = {}
    for path, change in changes.items():
        if is_harden_path(path) or not is_code_file(path) or _is_test_like(cfg, path):
            continue
        if generated_reason(path, cfg, submodules) or path in attrs:
            continue
        targets[path] = change

    # A hit on a removed non-test line offsets the same line added elsewhere (a move or a
    # re-indent), or the same pattern added again in the same file (a rewritten line).
    moved: Counter = Counter()
    rewritten: Counter = Counter()
    for path, change in targets.items():
        ext = extension(path)
        for _, text, _ in change.removed:
            hits = gaming_hits(ext, text) if text.strip() else []
            if hits:
                moved[_norm_line(text)] += 1
                for _, ident, _ in hits:
                    rewritten[(path, ident)] += 1

    scanned = 0
    for path in sorted(targets):
        ext = extension(path)
        added = targets[path].added
        if added:
            info["files_scanned"] += 1
        for lineno, text in added:
            if quick and scanned >= QUICK_GAMING_LINE_CAP:
                info["truncated"] = True
                break
            scanned += 1
            hits = gaming_hits(ext, text) if text.strip() else []
            if not hits:
                continue
            key = _norm_line(text)
            if moved[key] > 0:
                moved[key] -= 1
                continue
            for category, ident, label in hits:
                if rewritten[(path, ident)] > 0:
                    rewritten[(path, ident)] -= 1
                    continue
                detail = f"'{label}'" if category == "comment" else label
                report.add("soft", "test_gaming",
                           f"{GAMING_MESSAGES[category]}: {detail} (PC-07: review before "
                           f"committing; never special-case production code for a test)",
                           file=path, line=lineno, snippet=text, category=category,
                           pattern=ident)
        if info["truncated"]:
            break
    info["added_lines_scanned"] = scanned
    if quick:
        info["literal_cross_check"] = "skipped (--quick)"
        return
    _literal_cross_check(repo, base, cfg, targets, status, untracked, report, info)


_STRING_RE_CACHE: Dict[Tuple[bool, bool], "re.Pattern[str]"] = {}


def _string_regex(ext: str) -> "re.Pattern[str]":
    """String-literal regex for a file type (double quotes always; single quotes and
    backticks only where they delimit strings)."""
    key = (ext in SINGLE_QUOTE_STRING_EXTS, ext in BACKTICK_STRING_EXTS)
    cached = _STRING_RE_CACHE.get(key)
    if cached is None:
        parts = [r'"(?:[^"\\\n]|\\.)*"']
        if key[0]:
            parts.append(r"'(?:[^'\\\n]|\\.)*'")
        if key[1]:
            parts.append(r"`(?:[^`\\\n]|\\.)*`")
        cached = _STRING_RE_CACHE[key] = re.compile("|".join(parts))
    return cached


def _is_round_number(token: str) -> bool:
    whole, _, frac = token.partition(".")
    if frac.strip("0"):
        return False
    return len(whole.lstrip("0").rstrip("0")) <= 2


def extract_literals(ext: str, text: str) -> List[Tuple[str, str]]:
    """('string' | 'number', value) literals on one added code line that PC-07 cross-checks:
    strings of LITERAL_MIN_STRING_CHARS+ characters with a letter or digit, numbers with
    LITERAL_MIN_DIGITS+ digits (not round, not well known). Comments and import lines are
    skipped, and so are Python triple-quoted lines (docstrings) and ${...} templates."""
    code, _ = split_comment(text)
    if not code.strip() or _IMPORT_LINE_RE.search(code):
        return []
    if ext in PY_FAMILY and ('"""' in code or "'''" in code):
        return []
    found: List[Tuple[str, str]] = []
    rx = _string_regex(ext)
    for match in rx.finditer(code):
        content = match.group(0)[1:-1]
        if (len(content) >= LITERAL_MIN_STRING_CHARS and "${" not in content
                and re.search(r"[A-Za-z0-9]", content)):
            found.append(("string", content))
    for match in _NUMBER_RE.finditer(rx.sub(" ", code)):
        token = match.group(1)
        if sum(ch.isdigit() for ch in token) < LITERAL_MIN_DIGITS:
            continue
        if token in WELL_KNOWN_NUMBERS or _is_round_number(token):
            continue
        found.append(("number", token))
    return found


def _literal_cross_check(repo: Path, base: str, cfg: RunConfig, targets: Dict[str, FileChange],
                         status: Dict[str, str], untracked: Sequence[str], report: Report,
                         info: Dict[str, Any]) -> None:
    """PC-07: literals added to non-test code that also occur in test or snapshot files."""
    removed_text = "\n".join(text for change in targets.values() for _, text, _ in change.removed)
    removed_numbers = set(_NUMBER_RE.findall(removed_text))
    candidates: List[Tuple[str, int, str, str, str]] = []
    seen: Set[Tuple[str, str, str]] = set()
    for path in sorted(targets):
        ext = extension(path)
        for lineno, text in targets[path].added:
            for kind, value in extract_literals(ext, text):
                if (path, kind, value) in seen:
                    continue
                seen.add((path, kind, value))
                if (value in removed_text) if kind == "string" else (value in removed_numbers):
                    continue  # kept from a removed line: moved or rewritten, not new
                candidates.append((path, lineno, kind, value, text))
    if len(candidates) > MAX_LITERAL_CANDIDATES:
        info["literal_candidates_truncated"] = len(candidates) - MAX_LITERAL_CANDIDATES
        candidates = candidates[:MAX_LITERAL_CANDIDATES]

    # A literal the file already contained at base is not new.
    at_base = sorted({c[0] for c in candidates if status.get(c[0]) not in (None, "A", "?")})
    base_texts = {p: b.decode("utf-8", errors="replace")
                  for p, b in read_base_blobs(repo, base, at_base).items()}
    base_numbers: Dict[str, Set[str]] = {}
    fresh: List[Tuple[str, int, str, str, str]] = []
    for cand in candidates:
        path, _, kind, value, _ = cand
        before = base_texts.get(path)
        if before is not None:
            if kind == "string" and value in before:
                continue
            if kind == "number":
                if path not in base_numbers:
                    base_numbers[path] = set(_NUMBER_RE.findall(before))
                if value in base_numbers[path]:
                    continue
        fresh.append(cand)
    info["literals_checked"] = len(fresh)
    if not fresh:
        info["literal_cross_check"] = "done (no new literals)"
        return

    tracked = git_out(repo, ["ls-files", "-z", "--full-name", "--", ":/"])
    paths = sorted({to_posix(p) for p in tracked.split("\0") if p} | set(untracked))
    corpus: List[Tuple[str, str]] = []
    total = 0
    for path in paths:
        if is_harden_path(path) or not _is_test_like(cfg, path):
            continue
        text = _read_text_file(repo / path)
        if text is None:
            continue
        if total + len(text) > TEST_CORPUS_CAP_BYTES:
            info["test_corpus_truncated"] = True
            break
        total += len(text)
        corpus.append((path, text))
    info["test_files_read"] = len(corpus)
    number_tokens: Optional[List[Set[str]]] = None
    for path, lineno, kind, value, text in fresh:
        where: Optional[str] = None
        if kind == "string":
            where = next((tp for tp, tt in corpus if value in tt), None)
        else:
            if number_tokens is None:
                number_tokens = [set(_NUMBER_RE.findall(tt)) for _, tt in corpus]
            where = next((corpus[i][0] for i, toks in enumerate(number_tokens) if value in toks),
                         None)
        if where is None:
            continue
        shown = escape_snippet(value, 80)
        report.add("soft", "test_gaming",
                   f"{kind} literal \"{shown}\" added to non-test code also occurs in test file "
                   f"{where} (PC-07: literals copied from tests; review before committing)",
                   file=path, line=lineno, snippet=text, category="literal_from_tests",
                   pattern=f"{kind}-literal", literal=value[:SNIPPET_LIMIT], test_file=where)
    info["literal_cross_check"] = "done"


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def format_text(data: Dict[str, Any]) -> str:
    """Readable summary of a report dictionary."""
    lines: List[str] = []
    head = data.get("info", {}).get("head", "")
    lines.append(f"diff_guard ({data['mode']} mode): base {str(data['base'])[:12]} -> "
                 f"HEAD {str(head)[:12]} + working tree")
    for label, key in (("HARD violations", "hard"), ("SOFT warnings", "soft")):
        items = data.get(key, [])
        lines.append(f"{label} ({len(items)}):" if items else f"{label}: none")
        for item in items:
            loc = item.get("file", "")
            if loc and item.get("line"):
                loc += f":{item['line']}"
            text = f"  - [{item['kind']}] {loc + ': ' if loc else ''}{item['message']}"
            if item.get("snippet"):
                text += f"  | {item['snippet']}"
            lines.append(text)
    info = data.get("info", {})
    if info.get("allowed_test_changes"):
        lines.append("Allowed by allow_test_deletions: " + ", ".join(info["allowed_test_changes"]))
    if info.get("allowed_config_edits"):
        lines.append("Allowed by allow_config_edits: " + ", ".join(info["allowed_config_edits"]))
    if info.get("allowed_lines_used"):
        lines.append("Lines accepted by allowed_lines: " + ", ".join(
            "{}:{}".format(i["file"], i["line"]) for i in info["allowed_lines_used"][:20]))
    markers = info.get("quick_markers")
    if markers and markers.get("truncated"):
        lines.append(f"Marker/suppression scan stopped at {QUICK_GAMING_LINE_CAP} added lines; "
                     f"run without --quick")
    if info.get("new_test_files"):
        lines.append("New test files (allowed): " + ", ".join(info["new_test_files"][:20]))
    if info.get("strengthened_tests"):
        lines.append("Strengthened existing tests (checked additions, U01-F07): " + ", ".join(
            "{} (+{})".format(i["file"], i["added_lines"]) for i in info["strengthened_tests"][:20]))
    gaming = info.get("test_gaming")
    if gaming:
        text = (f"Test-gaming scan (PC-07): {gaming.get('files_scanned', 0)} non-test code "
                f"file(s), {gaming.get('added_lines_scanned', 0)} added line(s)")
        if gaming.get("truncated"):
            text += f" (stopped at {QUICK_GAMING_LINE_CAP} lines; run without --quick)"
        if gaming.get("literal_cross_check"):
            text += f"; literal cross-check: {gaming['literal_cross_check']}"
        lines.append(text)
    stats = info.get("stats", {})
    if stats:
        lines.append("Stats: " + ", ".join(f"{k}={v}" for k, v in sorted(stats.items())))
    if data.get("truncated"):
        lines.append("Truncated (items beyond the per-kind cap): "
                     + ", ".join(f"{k}={v}" for k, v in data["truncated"].items()))
    lines.append(f"Result: {data['verdict'].upper()}")
    return "\n".join(lines)


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


def main(argv: Optional[Sequence[str]] = None) -> int:
    """CLI entry point; returns the process exit code."""
    _configure_stdio()
    parser = argparse.ArgumentParser(
        description="Report changes a /harden run forbids (base..HEAD plus working tree).")
    parser.add_argument("--repo", default=".", help="repository (default: current directory)")
    parser.add_argument("--base", help="base commit (default: base_sha in .harden/active)")
    parser.add_argument("--quick", action="store_true",
                        help="cheap file-level checks plus the line-based scans of changed code "
                             "files (suppressions, skip markers, test gaming)")
    parser.add_argument("--json", action="store_true", help="print a JSON report")
    parser.add_argument("--strict", action="store_true", help="exit 1 on soft warnings too")
    parser.add_argument("--out", help="also write the JSON report to this file")
    args = parser.parse_args(argv)

    try:
        repo = repo_toplevel(Path(args.repo))
        cfg = load_run_config(repo)
        base = args.base or cfg.base_sha
        if not base:
            print("diff_guard: error: no base commit (pass --base or create .harden/active "
                  "with base_sha)", file=sys.stderr)
            return 2
        report = run_guard(repo, base, cfg, quick=args.quick)
    except (GitError, ConfigError, GuardError, OSError) as exc:
        print(f"diff_guard: error: {exc}", file=sys.stderr)
        return 2

    data = report.to_dict()
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=True) + "\n",
                            encoding="utf-8")
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=True))
    else:
        print(format_text(data))
    if data["hard"]:
        return 1
    if args.strict and data["soft"]:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
