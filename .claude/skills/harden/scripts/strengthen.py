"""strengthen.py - the additions-only rule for existing test files (/harden).

Purpose
    The owner's decision of 2026-09-25 (user-policy-autonomy U01-F07): a /harden run may
    strengthen an existing test by adding lines, never by removing, changing, reordering or
    re-encoding one (protocol-change PC-06). This module decides whether a new version of an
    existing test file only adds lines the rule accepts. hook_guard.py (Edit / Write /
    MultiEdit), diff_guard.py (working tree and every commit) and the replay below share it.

    The checks read text with a string- and comment-aware scanner, not a parser: they refuse
    what they cannot read, and a refusal can be a false positive (the item then pins its
    contract in a new test file). What they cannot see (a call with side effects on shared
    state, an alias) is what `replay` catches: the test gates run with every strengthened file
    back at its base version and every test file the run added set aside, so the base test set
    runs against the current production code; it passed under the same gates at baseline.
    Fail closed: an exception, a time budget running out or an unreadable input refuses the
    change (hook_guard.py reports it as [test-edit: checker-error] or [test-edit: unverifiable],
    diff_guard.py as reason checker-unavailable).

Rules (check_additions)
    1. Every line of the reference (HEAD, or the parent commit, or base) is still present, in
       order; line endings and a missing final newline are ignored here (diff_guard compares
       them through git); a byte-order mark added or removed on line 1 is refused.
    2. Added lines form blocks ("runs"). Each run: starts and ends outside any string,
       template, triple-quoted string or block comment; is bracket-balanced, each closer
       matching the bracket the run opened; sits at the tail of a test body, or adds complete
       test cases at the tail of a describe block, test class, test contract or the module, or
       adds named imports to the import header.
    3. No added line skips, focuses or marks a test as failing; retries or reconfigures one;
       adds a hook, test double, fake timer, chain-state helper, environment, process,
       network or key access; exits or returns early; catches an error; calls a snapshot
       matcher; adds a directive, a side-effect, dynamic or glob import, a decorator outside
       the allow-list, code run from a string, a scope statement or unsafe code; assigns to or
       mutates a name the run did not declare; or redeclares a hoisted, item or module-level
       name the file already uses.
    Supported: JavaScript/TypeScript (.js .jsx .mjs .cjs .ts .tsx .mts .cts), Python (.py),
    Rust (.rs), Go (.go), Solidity (.sol). Test files in other languages stay read-only.
    A line longer than 4000 characters, or a check past its deadline, is unverifiable.

Replay
    Run it with the Bash tool's `timeout: 600000`, or with `run_in_background` when the
    baseline test gate's median duration in .harden/gates/baseline.json exceeds 480 s. A killed
    replay leaves .harden/tmp/replay-state.json, which diff_guard reports as `replay_pending`
    until `restore` runs. A production file that imports a file under the test globs would
    make the replay red; that layout is outside what /harden supports.

CLI
    python strengthen.py list    --base SHA [--repo DIR] [--json]
    python strengthen.py replay  --base SHA --label LABEL [--repo DIR] [--config FILE]
                                 [--gates a,b] [--json]
    python strengthen.py restore [--repo DIR]
    (python3 on macOS/Linux; --base defaults to base_sha in .harden/active)

Exit codes
    list     0 (2 on a usage, git or configuration error)
    replay   0 pass or nothing to replay, 1 a test gate is red with the base versions,
             2 usage, precondition, git or gates.py error (files restored before exiting)
    restore  0 (2 when git cannot restore)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Set, Tuple

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

FAMILY_BY_EXT = {**{e: "js" for e in (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts",
                                      ".cts")},
                 ".py": "py", ".rs": "rs", ".go": "go", ".sol": "sol"}
MAX_BYTES = 1_000_000
MAX_LINE_CHARS = 4000
MAX_PROBLEMS = 20
FIXTURE_DIRS = {"__fixtures__", "fixtures", "fixture", "__mocks__", "mocks", "__snapshots__",
                "snapshots", "snapshot", "testdata", "test-data", "test_data", "__data__",
                "golden", "goldens"}
SUPPORT_FILE_RE = re.compile(
    r"(?i)^(?:conftest\.py|__init__\.py|setup[._-].*|.*\.setup\.[cm]?[jt]sx?"
    r"|global[-_.]?(?:setup|teardown).*"
    r"|(?:jest|vitest|playwright|karma|cypress)\.config\..*|vitest\.workspace\..*|.*\.d\.[cm]?ts"
    r"|(?:test[-_.]?)?(?:helpers?|utils?|fakes?|mocks?|fixtures?|factories|factory)\.[^.]+)$")
TEST_DEFINITION_RE = {
    "js": re.compile(r"(?<![\w$.])(?:it|test|specify)(?:\s*\.\s*\w+(?:\s*\([^()]*\))?)*\s*\("),
    "py": re.compile(r"^\s*(?:async\s+)?def\s+test\w*\s*\(", re.M),
    "rs": re.compile(r"#\[\s*(?:\w+::)*(?:test|rstest|test_case|quickcheck)\b"),
    "go": re.compile(r"^\s*func\s+(?:\([^)]*\)\s*)?Test\w*\s*\(", re.M),
    "sol": re.compile(r"^\s*function\s+(?:test|invariant)\w*\s*\(", re.M),
}
STATE_NAME = ".harden/tmp/replay-state.json"
LABEL_RE = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
OPENERS = {"{": "}", "(": ")", "[": "]"}
CLOSERS = {v: k for k, v in OPENERS.items()}
BRACE_FAMILIES = ("js", "rs", "go", "sol")


@dataclass(frozen=True)
class Problem:
    code: str               # stable code (module docstring; GC-01)
    line: Optional[int]     # 1-based line in the NEW text (None: file level)
    message: str            # one sentence, at most an 80-character redacted snippet


# hook_guard.py's redactions (never log secrets, even partially), plus hex keys (GC-01 R7).
_SECRET_WORDS = (r"(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|"
                 r"private[_-]?key|credentials?|auth)")
_SECRET_VALUE = r"(\"[^\"]*\"|'[^']*'|[^\s;&|]+)"
_REDACT: List[Tuple["re.Pattern[str]", str]] = [
    (re.compile(r"(?i)(\b[a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@"), r"\1***@"),
    (re.compile(r"(?i)(\bbearer\s+)[A-Za-z0-9._~+/=-]+"), r"\1***"),
    (re.compile(r"(?i)(--?[\w-]*" + _SECRET_WORDS + r"[\w-]*)(\s+|=)" + _SECRET_VALUE),
     r"\1\2***"),
    (re.compile(r"(?i)(\b[\w.-]*" + _SECRET_WORDS + r"[\w.-]*\s*[=:]\s*)" + _SECRET_VALUE),
     r"\1***"),
    (re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
                r"sk-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b"), "***"),
    (re.compile(r"\b0x[0-9a-fA-F]{64}\b"), "0x***"),
    (re.compile(r"\b[0-9a-fA-F]{64}\b"), "***"),
]


def snippet(text: str) -> str:
    """At most 80 characters of a stripped line, escaped and redacted."""
    out = repr(text.strip()[:80])[1:-1]
    for rx, repl in _REDACT:
        out = rx.sub(repl, out)
    return out


# ---------------------------------------------------------------------------
# Lines and alignment
# ---------------------------------------------------------------------------


def family_of(path: str) -> Optional[str]:
    return FAMILY_BY_EXT.get(os.path.splitext(os.path.basename(path).lower())[1])


def split_lines(text: str) -> Tuple[List[str], bool]:
    """Lines split on \\n only (one trailing \\r stripped each), and whether the text ends
    with a newline."""
    if text == "":
        return [], False
    ends = text.endswith("\n")
    parts = text.split("\n")
    if ends:
        parts = parts[:-1]
    return [p[:-1] if p.endswith("\r") else p for p in parts], ends


def align(old: Sequence[str], new: Sequence[str]) -> Optional[List[int]]:
    """Greedy earliest subsequence match: pos[i] = index in `new` of old line i, or None."""
    pos: List[int] = []
    j = 0
    for line in old:
        while j < len(new) and new[j] != line:
            j += 1
        if j >= len(new):
            return None
        pos.append(j)
        j += 1
    return pos


def first_unmatched(old: Sequence[str], new: Sequence[str]) -> int:
    j = 0
    for i, line in enumerate(old):
        while j < len(new) and new[j] != line:
            j += 1
        if j >= len(new):
            return i
        j += 1
    return len(old)


def not_strengthenable(path: str, base_text: str, *, snapshot: bool, protected: bool
                       ) -> Optional[str]:
    """None when the file may gain lines, else why not (GC-01 item 4)."""
    if snapshot:
        return "snapshot or golden file"
    if protected:
        return "gate or test-runner configuration"
    segs = path.replace("\\", "/").split("/")
    for seg in segs[:-1]:
        if seg.lower() in FIXTURE_DIRS:
            return "fixture, mock or data directory {}/".format(seg)
    base = segs[-1]
    if SUPPORT_FILE_RE.match(base):
        return "test support file {}".format(base)
    family = family_of(path)
    if family is None:
        ext = os.path.splitext(base.lower())[1]
        return "unsupported language {}".format(ext or "none")
    lines, _ = split_lines(base_text)
    view = code_view(lines, family)
    if not TEST_DEFINITION_RE[family].search("\n".join(view.code)):
        return "no test definition at base"
    return None


# ---------------------------------------------------------------------------
# Scanner: code-only text, literal state, bracket depth and stack
# ---------------------------------------------------------------------------

_QUOTE_KEYWORDS = frozenset(["return", "typeof", "case", "in", "of", "instanceof", "new",
                             "delete", "void", "throw", "yield", "await", "else", "do", "from",
                             "import", "export"])
_REGEX_KEYWORDS = frozenset(["return", "typeof", "case", "in", "of", "instanceof", "new",
                             "delete", "void", "throw", "yield", "await", "else", "do"])
_RS_CHAR_RE = re.compile(r"'(?:\\.|\\u\{[0-9a-fA-F]+\}|[^\\'])'")
_PY_PREFIX_RE = re.compile(r"(?i)[rbuf]{1,2}$")


class Scanner:
    """Blanks string contents and comments line by line, carrying the state across lines
    (GC-01 item 5)."""

    def __init__(self, family: str) -> None:
        self.family = family
        self.state: Optional[str] = None
        self.quote = ""
        self.hashes = 0
        self.nest = 0
        self.depth = 0
        self.tpl: List[int] = []
        self.stack: List[Tuple[str, int, int, str]] = []
        self.line_index = -1
        self.events: List[Tuple[str, str]] = []  # per scanned line: ("open"|"close", char)

    @property
    def in_literal(self) -> bool:
        return self.state is not None

    def snapshot(self) -> Tuple[Any, ...]:
        return (self.state, self.quote, self.hashes, self.nest, self.depth, tuple(self.tpl),
                tuple(self.stack), self.line_index)

    @classmethod
    def restore(cls, family: str, snap: Optional[Tuple[Any, ...]]) -> "Scanner":
        sc = cls(family)
        if snap is not None:
            (sc.state, sc.quote, sc.hashes, sc.nest, sc.depth, tpl, stack,
             sc.line_index) = snap
            sc.tpl = list(tpl)
            sc.stack = list(stack)
        return sc

    def scan(self, line: str) -> str:
        self.line_index += 1
        self.events = []
        out = list(line)
        n = len(line)
        fam = self.family
        i = 0

        def blank(a: int, b: int) -> None:
            for k in range(max(a, 0), min(b, n)):
                out[k] = " "

        while i < n:
            st = self.state
            if st == "block":
                if fam == "rs":
                    j = i
                    while j < n:
                        if line.startswith("/*", j):
                            self.nest += 1
                            j += 2
                        elif line.startswith("*/", j):
                            self.nest -= 1
                            j += 2
                            if self.nest <= 0:
                                break
                        else:
                            j += 1
                    blank(i, j)
                    if self.nest <= 0:
                        self.state = None
                        self.nest = 0
                    i = j
                    continue
                j = line.find("*/", i)
                if j < 0:
                    blank(i, n)
                    i = n
                    break
                blank(i, j + 2)
                self.state = None
                i = j + 2
                continue
            if st in ("tq\"", "tq'"):
                q = st[2] * 3
                j = i
                while j < n and not line.startswith(q, j):
                    j += 2 if line[j] == "\\" else 1
                if j >= n:
                    blank(i, n)
                    i = n
                    break
                blank(i, j)
                self.state = None
                i = j + 3
                continue
            if st == "tpl":
                j = i
                while j < n:
                    if line[j] == "\\":
                        j += 2
                        continue
                    if line[j] == "`" or line.startswith("${", j):
                        break
                    j += 1
                blank(i, j)
                if j >= n:
                    i = n
                    break
                if line[j] == "`":
                    self.state = None
                    i = j + 1
                    continue
                self.state = None
                self.tpl.append(len(self.stack))
                self._open("{", j + 1, out)
                i = j + 2
                continue
            if st == "raw":
                j = line.find("`", i)
                if j < 0:
                    blank(i, n)
                    i = n
                    break
                blank(i, j)
                self.state = None
                i = j + 1
                continue
            if st == "rsraw":
                end = "\"" + "#" * self.hashes
                j = line.find(end, i)
                if j < 0:
                    blank(i, n)
                    i = n
                    break
                blank(i, j)
                self.state = None
                i = j + len(end)
                continue
            if st == "str":
                j = i
                while j < n and line[j] != self.quote:
                    j += 2 if line[j] == "\\" else 1
                if j >= n:
                    blank(i, n)
                    i = n
                    break
                blank(i, j)
                self.state = None
                i = j + 1
                continue
            ch = line[i]
            two = line[i:i + 2]
            if fam != "py" and two == "//":
                blank(i, n)
                break
            if fam == "py" and ch == "#":
                blank(i, n)
                break
            if fam != "py" and two == "/*":
                self.state = "block"
                self.nest = 1
                blank(i, i + 2)
                i += 2
                continue
            handled = self._literal_start(line, i, out, blank)
            if handled is not None:
                i = handled
                continue
            if ch in OPENERS:
                self._open(ch, i, out)
            elif ch in CLOSERS:
                self._close(ch)
                if fam == "js" and ch == "}" and self.tpl and self.tpl[-1] == len(self.stack):
                    self.tpl.pop()
                    self.state = "tpl"
            i += 1
        if self.state == "str" and fam != "rs":
            self.state = None
        return "".join(out)

    def _open(self, ch: str, col: int, out: List[str]) -> None:
        self.depth += 1
        self.stack.append((ch, self.line_index, col, "".join(out[:col])))
        self.events.append(("open", ch))

    def _close(self, ch: str) -> None:
        self.depth -= 1
        if self.stack:
            self.stack.pop()
        self.events.append(("close", ch))

    def _prev(self, line: str, i: int, out: List[str]) -> Tuple[str, str]:
        """(previous non-space code character on the line, previous word)."""
        k = i - 1
        while k >= 0 and out[k] in " \t":
            k -= 1
        if k < 0:
            return "", ""
        prev = out[k]
        start = k
        while start > 0 and (out[start - 1].isalnum() or out[start - 1] in "_$"):
            start -= 1
        word = "".join(out[start:k + 1]) if (prev.isalnum() or prev in "_$") else ""
        return prev, word

    def _literal_start(self, line: str, i: int, out: List[str],
                       blank: Callable[[int, int], None]) -> Optional[int]:
        """Start of a string, template, regex or char literal at i: the next index, or None."""
        fam = self.family
        ch = line[i]
        n = len(line)
        if fam == "js":
            if ch == "`":
                self.state = "tpl"
                return i + 1
            if ch in "\"'":
                prev, word = self._prev(line, i, out)
                if prev and (prev.isalnum() or prev in "_$)]") and word not in _QUOTE_KEYWORDS:
                    return None
                return self._single(line, i, ch, blank)
            if ch == "/" and line[i + 1:i + 2] not in ("/", "*"):
                prev, word = self._prev(line, i, out)
                if prev == "" or prev in "(,=:[!&|?{};" or word in _REGEX_KEYWORDS:
                    j = i + 1
                    in_class = False
                    while j < n:
                        c = line[j]
                        if c == "\\":
                            j += 2
                            continue
                        if c == "[":
                            in_class = True
                        elif c == "]":
                            in_class = False
                        elif c == "/" and not in_class:
                            break
                        j += 1
                    if j < n:
                        blank(i + 1, j)
                        j += 1
                        while j < n and line[j].isalpha():
                            j += 1
                        return j
            return None
        if fam == "py":
            if ch in "\"'":
                start = i
                k = i - 1
                while k >= 0 and line[k].isalpha() and i - k <= 2:
                    k -= 1
                prefix = line[k + 1:i]
                if prefix and not _PY_PREFIX_RE.match(prefix):
                    return None
                if line.startswith(ch * 3, i):
                    j = i + 3
                    q = ch * 3
                    while j < n and not line.startswith(q, j):
                        j += 2 if line[j] == "\\" else 1
                    if j >= n:
                        blank(i + 3, n)
                        self.state = "tq" + ch
                        return n
                    blank(i + 3, j)
                    return j + 3
                del start
                return self._single(line, i, ch, blank)
            return None
        if fam == "rs":
            m = re.match(r"(b?r)(#*)\"", line[i:]) if ch in "br" else None
            if m and (i == 0 or not (line[i - 1].isalnum() or line[i - 1] == "_")):
                self.hashes = len(m.group(2))
                start = i + len(m.group(0))
                end = "\"" + "#" * self.hashes
                j = line.find(end, start)
                if j < 0:
                    blank(start, n)
                    self.state = "rsraw"
                    return n
                blank(start, j)
                return j + len(end)
            if ch == "\"":
                j = i + 1
                while j < n and line[j] != "\"":
                    j += 2 if line[j] == "\\" else 1
                if j >= n:
                    blank(i + 1, n)
                    self.state = "str"
                    self.quote = "\""
                    return n
                blank(i + 1, j)
                return j + 1
            if ch == "'":
                m2 = _RS_CHAR_RE.match(line, i)
                if m2:
                    blank(i + 1, m2.end() - 1)
                    return m2.end()
                return None
            return None
        if fam == "go":
            if ch == "`":
                j = line.find("`", i + 1)
                if j < 0:
                    blank(i + 1, n)
                    self.state = "raw"
                    return n
                blank(i + 1, j)
                return j + 1
            if ch in "\"'":
                return self._single(line, i, ch, blank)
            return None
        if fam == "sol":
            if ch in "\"'":
                return self._single(line, i, ch, blank)
            return None
        return None

    def _single(self, line: str, i: int, quote: str, blank: Callable[[int, int], None]) -> int:
        n = len(line)
        j = i + 1
        while j < n and line[j] != quote:
            j += 2 if line[j] == "\\" else 1
        if j >= n:
            blank(i + 1, n)
            return n
        blank(i + 1, j)
        return j + 1


class OldView:
    """The reference file, scanned once (GC-01 item 6)."""

    def __init__(self, lines: Sequence[str], family: str) -> None:
        self.family = family
        self.lines = list(lines)
        sc = Scanner(family)
        self.code: List[str] = []
        self.snap_before: List[Tuple[Any, ...]] = []
        self.snap_after: List[Tuple[Any, ...]] = []
        self.cont: List[bool] = []
        self.indent: List[int] = []
        for line in lines:
            self.snap_before.append(sc.snapshot())
            self.cont.append(sc.in_literal or sc.depth > 0)
            self.code.append(sc.scan(line))
            self.snap_after.append(sc.snapshot())
            self.indent.append(_indent(line))
        self.idents: Set[str] = set(re.findall(r"[A-Za-z_$][\w$]*", "\n".join(self.code)))
        self.header_end = header_end(self.lines, self.code, family)

    def stack_after(self, p: int) -> List[Tuple[str, int, int, str]]:
        return list(self.snap_after[p][6]) if p >= 0 else []

    def in_literal_after(self, p: int) -> bool:
        return p >= 0 and self.snap_after[p][0] is not None


def code_view(lines: Sequence[str], family: str) -> OldView:
    return OldView(lines, family)


def _indent(line: str) -> int:
    count = 0
    for ch in line:
        if ch == " ":
            count += 1
        elif ch == "\t":
            count += 8
        else:
            break
    return count


# ---------------------------------------------------------------------------
# Header region (GC-01 item 9)
# ---------------------------------------------------------------------------

HEADER_IMPORT_RE = {
    "js": re.compile(r"^\s*import\b|^\s*(?:const|let|var)\s+[^=]+=\s*require\s*\("),
    "py": re.compile(r"^\s*(?:from\s+\S+\s+import\b|import\b)"),
    "rs": re.compile(r"^\s*(?:use|extern\s+crate|mod\s+\w+\s*;|#!\[)"),
    "go": re.compile(r"^\s*(?:package\b|import\b)"),
    "sol": re.compile(r"^\s*(?:pragma\b|import\b)"),
}
NAMED_IMPORT_RE = {
    "js": re.compile(r"^\s*import\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}?|\*\s+as\s+[\w$]+)?"
                     r"\s*(?:from\s*['\"][^'\"]+['\"])?\s*;?\s*$"
                     r"|^\s*(?:const|let|var)\s+(?:[\w$]+|\{[^}]*\})\s*=\s*require\s*\(\s*['\"]"
                     r"[^'\"]+['\"]\s*\)\s*;?\s*$"),
    "py": re.compile(r"^\s*(?:from\s+[\w.]+\s+import\s+.+|import\s+[\w.]+(?:\s+as\s+\w+)?"
                     r"(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)\s*$"),
    "rs": re.compile(r"^\s*use\s+[^;]+;\s*$"),
    "go": re.compile(r"^\s*(?:[\w.]+\s+)?\"[^\"]+\"\s*$|^\s*import\s+(?:[\w.]+\s+)?\"[^\"]+\"\s*$"),
    "sol": re.compile(r"^\s*import\s+[^;]+;\s*$"),
}


def header_end(lines: Sequence[str], code: Sequence[str], family: str) -> int:
    """How many leading lines form the import header."""
    k = 0
    n = len(lines)
    in_doc = False
    while k < n:
        raw = lines[k]
        text = code[k].strip()
        if in_doc:
            k += 1
            if code[k - 1].rstrip().endswith(("\"\"\"", "'''")) or "\"\"\"" in code[k - 1] or \
                    "'''" in code[k - 1]:
                in_doc = False
            continue
        if not text:
            k += 1
            continue
        if raw.lstrip().startswith("#!") or re.match(r"^\s*#.*coding[:=]", raw):
            k += 1
            continue
        if family == "py" and re.match(r"^\s*[rRuUbB]?(\"\"\"|''')", raw) and k < 5:
            quote = re.match(r"^\s*[rRuUbB]?(\"\"\"|''')", raw).group(1)
            rest = raw.split(quote, 1)[1]
            k += 1
            if quote not in rest:
                in_doc = True
            continue
        if family == "js" and re.match(r"^\s*['\"]use strict['\"]\s*;?\s*$", raw):
            k += 1
            continue
        if family == "sol" and re.match(r"^\s*//\s*SPDX", raw):
            k += 1
            continue
        if HEADER_IMPORT_RE[family].match(text) or HEADER_IMPORT_RE[family].match(raw):
            depth = text.count("(") + text.count("{") - text.count(")") - text.count("}")
            k += 1
            if family == "go" and re.match(r"^\s*import\s*\($", text):
                while k < n and not code[k].strip().startswith(")"):
                    k += 1
                k += 1
                continue
            while depth > 0 and k < n:
                t = code[k]
                depth += t.count("(") + t.count("{") - t.count(")") - t.count("}")
                k += 1
            continue
        break
    return k


# ---------------------------------------------------------------------------
# Line checks (GC-01 item 12, revision R5)
# ---------------------------------------------------------------------------


def _rx(*patterns: str, flags: int = 0) -> List["re.Pattern[str]"]:
    return [re.compile(p, flags) for p in patterns]


RAW_CHECKS: List[Tuple[str, List["re.Pattern[str]"], Optional[Set[str]]]] = [
    ("skip-marker", _rx(
        r"\b(?:it|test|describe|suite|context|specify)(?:\s*\.\s*(?:concurrent|describe|serial"
        r"|each|sequential))*\s*\.\s*(?:failing|fails)\b",
        r"(?<![\w$.])pending\s*\(", r"\bpytest\.mark\.flaky\b|@flaky\b",
        r"\bunittest\.expectedFailure\b|@expectedFailure\b", r"\bSkipTest\b",
        r"\bpytest\.importorskip\s*\(", r"#\[\s*should_panic\b", r"\btesting\.Short\s*\("),
     None),
    ("skip-marker", _rx(r"(?<![\w$.])(?:ctx|context|t|task)\s*\.\s*(?:skip|todo)\s*\("), {"js"}),
    ("retry-or-config", _rx(
        r"\bjest\s*\.\s*(?:retryTimes|setTimeout)\s*\(", r"\bvi\s*\.\s*setConfig\s*\(",
        r"\bthis\s*\.\s*(?:retries|timeout|slow)\s*\(", r"(?<![\w$])(?:retry|retries|repeats)\s*:",
        r"\btest\s*\.\s*describe\s*\.\s*configure\s*\(",
        r"\bpytest\.mark\.(?:timeout|repeat|filterwarnings)\b", r"^\s*pytestmark\s*=",
        r"\bdef\s+pytest_\w+\s*\("), None),
    ("hook", _rx(
        r"(?<![\w$.])(?:before|after)(?:All|Each)?\s*\(",
        r"\bdef\s+(?:setup|teardown)(?:_module|_function|_method|_class)?\s*\(",
        r"\bdef\s+(?:setUp|tearDown)(?:Class|Module)?\s*\(", r"\bautouse\s*=\s*True\b",
        r"\bfunc\s+(?:TestMain|init)\s*\(",
        r"\bfunction\s+(?:setUp|beforeTestSetup|afterInvariant|(?:exclude|target)(?:Contracts"
        r"|Senders|Selectors|Artifacts|ArtifactSelectors|Interfaces))\s*\("), None),
    ("test-double", _rx(
        r"\b(?:vi|jest)\s*\.\s*(?:mock|doMock|unmock|doUnmock|spyOn|fn|stubGlobal|unstubAllGlobals"
        r"|stubEnv|unstubAllEnvs|useFakeTimers|useRealTimers|setSystemTime|advanceTimers\w*"
        r"|runAllTimers\w*|runOnlyPendingTimers\w*|mocked|importMock|importActual|requireActual"
        r"|requireMock|resetModules|isolateModules\w*|replaceProperty|resetAllMocks"
        r"|restoreAllMocks|clearAllMocks|hoisted)\b",
        r"\bsinon\b|\bnock\s*\(|\bsetupServer\s*\(|\bproxyquire\b",
        r"\bunittest\.mock\b|\bmock\s*\.\s*patch\b|(?<![\w.])patch(?:\.object|\.dict|\.multiple)?"
        r"\s*\(|@patch\b|\b(?:Magic|Async|NonCallable)?Mock\s*\(|\bmonkeypatch\b|\bmocker\b"
        r"|\bfreeze_?time\b|\btime_machine\b|\brespx\b",
        r"\bgomock\b|\bmockall\b|\bmock!\s*[{(]",
        r"\bvm\s*\.\s*(?:mockCall\w*|clearMockedCalls|etch|store)\s*\(",
        r"\b(?:network\s*\.\s*provider|hre\s*\.\s*network)\b|['\"](?:hardhat|evm)_\w+['\"]"
        r"|\bhelpers\s*\.\s*\w+|\btime\s*\.\s*(?:increase|increaseTo|setNextBlockTimestamp"
        r"|latest\w*)\s*\(|(?<![\w$.])(?:mine|mineUpTo|setBalance|setCode|setNonce|setStorageAt"
        r"|impersonateAccount|stopImpersonatingAccount|takeSnapshot|setPrevRandao|setCoinbase"
        r"|setBlockGasLimit|dropTransaction)\s*\("), None),
    ("env-or-live-access", _rx(
        r"\bprocess\s*\.\s*env\b|\bimport\s*\.\s*meta\s*\.\s*env\b|\bDeno\s*\.\s*env\b",
        r"\bos\s*\.\s*(?:environ|getenv|putenv|unsetenv)\b|(?<![\w.])getenv\s*\(",
        r"\bstd\s*::\s*env\s*::\s*(?:var|vars|set_var|remove_var)\b|\b(?:option_)?env!\s*\(",
        r"\bos\s*\.\s*(?:Getenv|LookupEnv|Setenv|Unsetenv|Environ)\s*\(", r"\bdotenv\b",
        r"\bchild_process\b|\b(?:execSync|execFileSync|spawnSync|execa)\s*\(|\bsubprocess\b"
        r"|\bos\s*\.\s*(?:system|popen|exec\w*|spawn\w*)\s*\(|\bstd\s*::\s*process\s*::\s*Command"
        r"\b|\bexec\s*\.\s*Command\s*\(",
        r"(?<![\w$.])fetch\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\s*\(|\brequests\s*\.\s*(?:get"
        r"|post|put|delete|patch|head|request|Session)\b|\burllib\b|\bhttpx\b|\baiohttp\b"
        r"|\bsocket\s*\.\s*(?:socket|create_connection)\b|\bnet\s*\.\s*(?:Dial\w*|connect"
        r"|createConnection)\b|\bhttp\s*\.\s*(?:Get|Post|request|get)\s*\(",
        r"\b(?:JsonRpcProvider|WebSocketProvider|InfuraProvider|AlchemyProvider|EtherscanProvider"
        r"|getDefaultProvider|createPublicClient|createWalletClient|createTestClient|fromMnemonic"
        r"|fromPhrase|privateKeyToAccount|mnemonicToAccount|HDNodeWallet)\b",
        r"\bvm\s*\.\s*(?:env\w*|setEnv|ffi|tryFfi|createFork|createSelectFork|selectFork|rollFork"
        r"|makePersistent|rpc|rpcUrl\w*|readFile\w*|writeFile\w*|writeLine|writeJson|writeToml"
        r"|removeFile|copyFile|createDir|removeDir|broadcast|startBroadcast|stopBroadcast"
        r"|allowCheatcodes|deriveKey|rememberKey)\b",
        r"\b(?:PRIVATE_KEY|MNEMONIC|SEED_PHRASE|DEPLOYER_KEY|API_KEY|API_SECRET)\b",
        r"\bnetwork\s*\.\s*(?:connect|config|provider)\b",
        r"\b(?:hre|hardhat)\s*\.\s*(?:config|userConfig|run|network|changeNetwork)\b",
        r"\bconfig\s*\.\s*networks\b",
        r"\bimport\s*\{[^}]*\bconfig\b[^}]*\}\s*from\s*['\"]hardhat['\"]",
        r"\bnew\s+(?:ethers\s*\.\s*)?Wallet\s*\(|\bWallet\s*\.\s*from\w*\s*\(",
        r"(?i)\bprivate_?keys?\b|\bmnemonic\b|\bseed_?phrase\b",
        r"\bClient\s*\.\s*(?:forTestnet|forMainnet|forPreviewnet|forName|forNetwork|fromConfig\w*)"
        r"\s*\(|\bsetOperator\s*\(|\bPrivateKey\s*\.\s*from\w*\s*\(",
        r"['\"`][^'\"`\n]*\.env(?:\.[\w.-]+)?['\"`]"), None),
    ("global-override", _rx(
        r"\bexpect\s*\.\s*(?:extend|addSnapshotSerializer)\s*\(|\bchai\s*\.\s*use\s*\(|\bAssertion"
        r"\s*\.\s*(?:add|overwrite)\w*\s*\(|\bshould\s*\.\s*extend\b",
        r"\bObject\s*\.\s*(?:defineProperty|defineProperties|setPrototypeOf|assign|freeze)\s*\("
        r"|\bReflect\s*\.\s*(?:set|defineProperty|deleteProperty|setPrototypeOf)\s*\(|\.prototype"
        r"\b|__proto__",
        r"(?<![\w.])(?:setattr|delattr)\s*\(|\bbuiltins\b|__builtins__|\bglobals\s*\(\s*\)|\bsys"
        r"\s*\.\s*(?:modules|settrace|setprofile|path|meta_path)\b|\bimportlib\s*\.\s*(?:reload"
        r"|import_module)\b|\bregister_assert_rewrite\b"), None),
    ("early-exit", _rx(
        r"\bprocess\s*\.\s*(?:exit|abort|kill|reallyExit)\s*\(|\bDeno\s*\.\s*exit\s*\(",
        r"\bsys\s*\.\s*exit\s*\(|\bos\s*\.\s*(?:_exit|abort|kill)\s*\(|(?<![\w.$])(?:exit|quit)\s*\(",
        r"\bos\s*\.\s*Exit\s*\(|\bruntime\s*\.\s*Goexit\s*\(|\bstd\s*::\s*process\s*::\s*(?:exit"
        r"|abort)\b",
        r"(?<![\w$.])done\s*\(", r"\bpytest\s*\.\s*exit\s*\("), None),
    ("snapshot-assertion", _rx(
        r"\.\s*to(?:Match|ThrowErrorMatching)(?:Inline)?Snapshot\s*\(|\.\s*to(?:MatchFileSnapshot"
        r"|MatchImageSnapshot|HaveScreenshot|MatchAriaSnapshot)\s*\(|\bassert_\w*snapshot!\s*\("
        r"|\binsta\s*::|\bsnapshot\s*\.\s*assert_match\w*\s*\(|==\s*snapshot\b|\bsnapshot\s*=="),
     None),
    ("directive", _rx(
        r"@(?:jest|vitest)-environment\b|@jest-environment-options\b|//\s*go:(?:build|linkname"
        r"|generate)\b|//\s*\+build\b|^\s*#!\[|/\*\s*(?:istanbul|c8|v8)\s+ignore\b"), None),
    ("side-effect-import", _rx(
        r"^\s*import\s*['\"`]|^\s*require\s*\(\s*['\"`]|(?<![\w$.])import\s*\(|^\s*_\s+\""), None),
    ("glob-import", _rx(r"^\s*use\s+[^;]*::\s*\*\s*;|^\s*\.\s+\""), None),
    ("glob-import", _rx(r"^\s*import\s+\"[^\"]+\"\s*;"), {"sol"}),
    ("dynamic-code", _rx(
        r"(?<![\w$.])(?:eval|exec|compile|__import__)\s*\(|\bnew\s+Function\s*\("
        r"|(?<![\w$.])Function\s*\(\s*['\"`]"), None),
    ("dynamic-code", _rx(r"\bvm\s*\.\s*(?:runIn\w*|Script|compileFunction)\b"), {"js"}),
]
SOL_VM_ALLOWED = {"expectRevert", "expectPartialRevert", "expectEmit", "expectCall", "assume",
                  "label", "addr", "sign", "prank", "startPrank", "stopPrank", "deal", "warp",
                  "roll", "getBlockTimestamp", "getBlockNumber", "skip"}
CATCH_RAW_RE = re.compile(r"\brecover\s*\(\s*\)|\bcatch_unwind\b|\bcontextlib\s*\.\s*suppress\b"
                          r"|(?<![\w.])suppress\s*\(")
CODE_CHECKS: List[Tuple[str, "re.Pattern[str]", Optional[Set[str]]]] = [
    ("early-exit", re.compile(r"(?<![\w$.])(?:return|break|continue|yield|goto)\b"), None),
    ("catch", re.compile(r"(?<![\w$.])(?:try|catch|finally|except)\b"), None),
    ("scope-statement", re.compile(r"^\s*(?:global|nonlocal|del)\b"), {"py"}),
    ("scope-statement", re.compile(r"(?<![\w$.])delete\s+"), {"js"}),
    ("unsafe", re.compile(r"\bunsafe\b|\bstatic\s+mut\b"), {"rs"}),
    ("unsafe", re.compile(r"\bunsafe\s*\."), {"go"}),
    ("unsafe", re.compile(r"\bassembly\b|\bdelegatecall\b|\bselfdestruct\b"), {"sol"}),
]
PY_DECORATOR_OK = re.compile(r"^\s*@pytest\.mark\.(?:parametrize|asyncio|anyio)\b")
RS_OPENER = re.compile(r"^\s*#\[\s*(?:(?:tokio|async_std)::)?test\b[^\]]*\]\s*$|^\s*#\[\s*rstest\s*"
                       r"\]\s*$|^\s*#\[\s*case\s*\(|^\s*(?:async\s+)?fn\s+\w+\s*\(")
CONTAINER_OPENER = {
    "js": re.compile(r"^\s*(?:it|test)(?:\s*\.\s*each\s*\([^()]*\))?\s*\("),
    "rs": RS_OPENER,
    "go": re.compile(r"^\s*func\s+Test\w*\s*\(\s*\w+\s+\*testing\.T\s*\)\s*\{"),
    "sol": re.compile(r"^\s*function\s+test\w*\s*\("),
}
PY_TEST_DEF = re.compile(r"^\s*(?:async\s+)?def\s+test\w*\s*\(")


def line_problems(raw: str, code: str, family: str, ext: str, lineno: int) -> List[Problem]:
    """The position-independent problems of one added line."""
    out: List[Problem] = []
    snip = snippet(raw)

    def add(code_id: str, detail: str) -> None:
        out.append(Problem(code_id, lineno, "added line '{}' {}".format(snip, detail)))

    try:
        import diff_guard as dg  # noqa: E402  (imported here: diff_guard imports this module)
        markers = [m for m in dg.SKIP_MARKERS if m.applies_to(ext)]
    except Exception:  # noqa: BLE001 - the extra patterns below still apply
        markers = []
    for marker in markers:
        if marker.regex.search(raw):
            add("skip-marker", "skips, focuses or disables a test ({})".format(marker.label))
            break
    details = {
        "skip-marker": "skips, focuses or marks a test as failing",
        "retry-or-config": "retries or reconfigures a test",
        "hook": "adds a setup or teardown hook",
        "test-double": "adds a test double, fake timer or chain-state helper",
        "env-or-live-access": "reads the environment, a key, a process or the network",
        "global-override": "overrides a global or the assertion library",
        "early-exit": "exits or ends the test early",
        "snapshot-assertion": "adds a snapshot assertion",
        "directive": "adds a directive",
        "side-effect-import": "adds a side-effect or dynamic import",
        "glob-import": "adds a glob import",
        "dynamic-code": "runs code from a string",
    }
    for code_id, patterns, families in RAW_CHECKS:
        if families is not None and family not in families:
            continue
        if any(p.search(raw) for p in patterns):
            if not any(p.code == code_id for p in out):
                add(code_id, details[code_id])
    if family == "sol":
        for m in re.finditer(r"\bvm\s*\.\s*(\w+)\s*\(", code):
            if m.group(1) not in SOL_VM_ALLOWED and m.group(1) != "skip":
                if not any(p.code == "test-double" for p in out):
                    add("test-double", details["test-double"])
                break
    if family == "py" and re.match(r"^\s*@", code) and not PY_DECORATOR_OK.match(code):
        add("decorator", "adds a decorator outside @pytest.mark.parametrize/asyncio/anyio")
    if family == "rs" and re.match(r"^\s*#\[", raw) and not RS_OPENER.match(raw):
        add("decorator", "adds an attribute outside the test attributes")
    for code_id, rx, families in CODE_CHECKS:
        if families is not None and family not in families:
            continue
        if rx.search(code) and not any(p.code == code_id for p in out):
            add(code_id, {"early-exit": "returns, breaks or yields early",
                          "catch": "catches an error", "scope-statement": "adds a scope statement",
                          "unsafe": "adds unsafe code"}[code_id])
    if CATCH_RAW_RE.search(raw) and not any(p.code == "catch" for p in out):
        add("catch", "catches an error")
    return out


# ---------------------------------------------------------------------------
# Declarations, binding and assignment (GC-01 item 13)
# ---------------------------------------------------------------------------

JS_ASSIGN_RE = re.compile(r"(?<![\w$.])([A-Za-z_$][\w$]*)((?:\s*(?:\.|\?\.)\s*[A-Za-z_$][\w$]*|\s*\["
                          r"[^\]]*\])*)\s*(?:[-+*/%&|^]|\*\*|<<|>>>?|&&|\|\||\?\?|&\^)?=(?![=>])")
INCREMENT_RES = (re.compile(r"(?:\+\+|--)\s*([A-Za-z_$][\w$]*)"),
                 re.compile(r"([A-Za-z_$][\w$]*)(?:\s*\.\s*[\w$]+|\s*\[[^\]]*\])*\s*(?:\+\+|--)"))
MUTATING_RE = re.compile(
    r"(?<![\w$.])([A-Za-z_$][\w$]*)(?:\s*(?:\.|\?\.)\s*[A-Za-z_$][\w$]*|\s*\[[^\]]*\])*\s*\.\s*"
    r"(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|delete|clear|add|append"
    r"|extend|insert|remove|update|setdefault|popitem|discard|put|register|unregister|reset"
    r"|install|use|configure|seed|write|writeFile|writeFileSync|appendFile\w*|mkdir\w*|rm\w*"
    r"|unlink\w*|rename\w*|truncate|drop)\s*\(")
PY_STATEMENT_SKIP = re.compile(r"^\s*(?:def|class|if|elif|else|while|for|with|return|assert|lambda"
                               r"|import|from|raise|async|await|try|except|finally|global|nonlocal"
                               r"|del|pass|break|continue|yield)\b")
SOL_TYPE_DECL = re.compile(r"\b(?:u?int\d*|address(?:\s+payable)?|bool|bytes\d*|string|[A-Z]\w*"
                           r"(?:\.[A-Z]\w*)*)(?:\s*\[[^\]]*\])*\s+(?:memory\s+|storage\s+"
                           r"|calldata\s+)?([a-z_]\w*)\s*[=;]")
KEYWORDS = frozenset(["this", "super", "self", "true", "false", "null", "undefined", "None",
                      "True", "False", "new", "return", "await", "typeof", "void", "in", "of",
                      "let", "const", "var", "if", "else", "for", "while"])
IDENT = r"[A-Za-z_$][\w$]*"


def _idents_in(text: str) -> List[str]:
    return re.findall(IDENT, text)


def declarations(code: str, family: str) -> Tuple[Set[str], Set[str]]:
    """(names declared on this code line, the hoisted, item or definition names among them)."""
    names: Set[str] = set()
    strong: Set[str] = set()
    if family == "js":
        for m in re.finditer(r"(?<![\w$.])(var|let|const)\s+([A-Za-z_$][\w$]*)", code):
            names.add(m.group(2))
            if m.group(1) == "var":
                strong.add(m.group(2))
        for m in re.finditer(r"(?<![\w$.])(?:var|let|const)\s+([\[{][^=]*)=", code):
            names.update(n for n in _idents_in(m.group(1)) if n not in KEYWORDS)
        for m in re.finditer(r"(?<![\w$.])(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)", code):
            names.add(m.group(1))
            strong.add(m.group(1))
        for m in re.finditer(r"(?<![\w$.])class\s+([A-Za-z_$][\w$]*)", code):
            names.add(m.group(1))
        for rx in (r"function\b[^(]*\(([^()]*)\)", r"\(([^()]*)\)\s*(?::[^=]+)?=>"):
            for m in re.finditer(rx, code):
                names.update(n for n in _idents_in(re.sub(r":\s*[\w$.<>\[\]| ]+", "",
                                                          m.group(1))) if n not in KEYWORDS)
        names.update(re.findall(r"([A-Za-z_$][\w$]*)\s*=>", code))
    elif family == "py":
        m = re.match(r"^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)?", code)
        if m:
            names.add(m.group(1))
            strong.add(m.group(1))
            for param in (m.group(2) or "").split(","):
                p = param.split("=")[0].split(":")[0].strip().lstrip("*")
                if p:
                    names.add(p)
        m = re.match(r"^\s*class\s+(\w+)", code)
        if m:
            names.add(m.group(1))
            strong.add(m.group(1))
        for m in re.finditer(r"\bfor\s+(.+?)\s+in\b", code):
            names.update(_idents_in(m.group(1)))
        names.update(re.findall(r"\bas\s+(\w+)", code))
        names.update(re.findall(r"(\w+)\s*:=", code))
        for m in re.finditer(r"\blambda\s+([^:]*):", code):
            names.update(_idents_in(m.group(1)))
        if not PY_STATEMENT_SKIP.match(code):
            m = re.match(r"^\s*([^=]+?)\s*(?:[-+*/%&|^@]|//|\*\*|<<|>>)?=(?!=)", code)
            if m:
                for target in m.group(1).split(","):
                    t = target.strip().strip("()[]*").strip()
                    if re.match(r"^[A-Za-z_]\w*$", t):
                        names.add(t)
    elif family == "rs":
        for m in re.finditer(r"\blet\s+(?:mut\s+)?([^=:;]+)", code):
            names.update(n for n in _idents_in(m.group(1)) if n != "mut")
        for m in re.finditer(r"\|([^|]*)\|", code):
            names.update(n for n in _idents_in(re.sub(r":\s*[\w&<>' ]+", "", m.group(1)))
                         if n != "mut")
        for m in re.finditer(r"\bfn\s+\w+\s*(?:<[^>]*>)?\s*\(([^)]*)\)", code):
            names.update(re.findall(r"(\w+)\s*:", m.group(1)))
        for m in re.finditer(r"\bfor\s+(.+?)\s+in\b", code):
            names.update(_idents_in(m.group(1)))
        for m in re.finditer(r"(?<![\w])(?:fn|struct|enum|trait|type|const|static|mod|union)\s+"
                             r"([A-Za-z_]\w*)", code):
            names.add(m.group(1))
            strong.add(m.group(1))
        for m in re.finditer(r"^\s*use\s+([^;]+);", code):
            last = re.findall(r"(\w+)\s*(?:[,}]|$)", m.group(1))
            names.update(last)
            strong.update(last)
    elif family == "go":
        for m in re.finditer(r"([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:=", code):
            names.update(_idents_in(m.group(1)))
        names.update(re.findall(r"\b(?:var|const)\s+([A-Za-z_]\w*)", code))
        for m in re.finditer(r"\bfunc\s*\(([^)]*)\)", code):
            names.update(re.findall(r"(\w+)\s+[\w*.\[\]]+", m.group(1)))
        for m in re.finditer(r"\bfor\s+([\w, ]+)\s*:?=\s*range", code):
            names.update(_idents_in(m.group(1)))
        m = re.match(r"^\s*func\s+(Test\w*)", code)
        if m:
            names.add(m.group(1))
            strong.add(m.group(1))
    elif family == "sol":
        names.update(SOL_TYPE_DECL.findall(code))
        m = re.match(r"^\s*function\s+(\w+)\s*\(([^)]*)\)", code)
        if m:
            names.add(m.group(1))
            strong.add(m.group(1))
            names.update(re.findall(r"(\w+)\s*(?:,|$)", m.group(2)))
    return names, strong


def import_names(code: str, family: str) -> Set[str]:
    if family == "js":
        m = re.match(r"^\s*import\s+(?:type\s+)?(.*?)\s*(?:from\b.*)?;?\s*$", code)
        if m and m.group(1):
            body = re.sub(r"\b\w+\s+as\s+", "", m.group(1))
            return {n for n in _idents_in(body) if n not in ("type", "from")}
        m = re.match(r"^\s*(?:const|let|var)\s+(.+?)\s*=\s*require", code)
        return set(_idents_in(m.group(1))) if m else set()
    if family == "py":
        m = re.match(r"^\s*from\s+[\w.]+\s+import\s+(.+)$", code)
        if m:
            out = set()
            for part in m.group(1).strip("() ").split(","):
                part = part.strip()
                if not part:
                    continue
                pieces = part.split(" as ")
                out.add(pieces[-1].strip())
            return out
        m = re.match(r"^\s*import\s+(.+)$", code)
        if m:
            out = set()
            for part in m.group(1).split(","):
                pieces = part.strip().split(" as ")
                out.add(pieces[-1].strip().split(".")[0])
            return out
    if family == "rs":
        m = re.match(r"^\s*use\s+([^;]+);", code)
        return set(re.findall(r"(\w+)\s*(?:[,}]|$)", m.group(1))) if m else set()
    if family == "go":
        m = re.match(r"^\s*(?:import\s+)?(?:([\w.]+)\s+)?\"([^\"]+)\"", code)
        if m:
            return {m.group(1) or m.group(2).split("/")[-1]}
    if family == "sol":
        m = re.search(r"\{([^}]*)\}", code)
        return set(_idents_in(m.group(1))) - {"as"} if m else set()
    return set()


def binding_problems(run_raw: Sequence[str], run_code: Sequence[str], start_line: int,
                     family: str, view: OldView, header_run: bool,
                     container_lines: Set[int]) -> List[Problem]:
    """Declarations, rebinding, assignment and mutating calls of one run."""
    out: List[Problem] = []
    declared: Set[str] = set()
    depth = 0
    for k, (raw, code) in enumerate(zip(run_raw, run_code)):
        lineno = start_line + k
        at_statement_depth = depth == 0
        if header_run:
            names = import_names(code if family != "go" else raw, family)
            for name in sorted(names):
                if name in view.idents:
                    out.append(Problem("rebinds-existing-name", lineno,
                                       "added import '{}' rebinds {}, a name the file already "
                                       "uses".format(snippet(raw), name)))
            declared.update(names)
        names, strong = declarations(code, family)
        rebind_names = set(strong)
        if k in container_lines:
            rebind_names |= names & strong
        for name in sorted(rebind_names):
            if name in view.idents:
                out.append(Problem("rebinds-existing-name", lineno,
                                   "added line '{}' redeclares {}, a name the file already "
                                   "uses".format(snippet(raw), name)))
        declared.update(names)
        if at_statement_depth:
            if family == "py":
                if not PY_STATEMENT_SKIP.match(code):
                    m = re.match(r"^\s*([^=]+?)\s*(?:[-+*/%&|^@]|//|\*\*|<<|>>)?=(?!=)", code)
                    if m:
                        for target in m.group(1).split(","):
                            t = target.strip().strip("()[]*").strip()
                            if not t or re.match(r"^[A-Za-z_]\w*$", t):
                                continue
                            root = re.split(r"[.\[]", t)[0].strip()
                            if root and root not in declared:
                                out.append(Problem("assigns-outer-name", lineno,
                                                   "added line '{}' assigns to {}, which the "
                                                   "added lines did not declare".format(
                                                       snippet(raw), root)))
            else:
                for m in JS_ASSIGN_RE.finditer(_depth_zero(code)):
                    before = code[:m.start()].rstrip()
                    if re.search(r"(?:\b(?:var|let|const|mut)|:)$", before) or \
                            (family == "sol" and SOL_TYPE_DECL.search(code[:m.end()] + ";")) or \
                            (family == "go" and code[m.end() - 2:m.end()] == ":="):
                        continue
                    if family == "go" and code[m.start():m.end()].rstrip().endswith(":="):
                        continue
                    root = m.group(1)
                    if root in KEYWORDS - {"this", "super", "self"} or root in ("var", "let",
                                                                                 "const"):
                        continue
                    if root not in declared:
                        out.append(Problem("assigns-outer-name", lineno,
                                           "added line '{}' assigns to {}, which the added "
                                           "lines did not declare".format(snippet(raw), root)))
                for rx in INCREMENT_RES:
                    for m in rx.finditer(code):
                        if m.group(1) not in declared and m.group(1) not in KEYWORDS:
                            out.append(Problem("assigns-outer-name", lineno,
                                               "added line '{}' increments {}, which the added "
                                               "lines did not declare".format(snippet(raw),
                                                                              m.group(1))))
        for m in MUTATING_RE.finditer(code):
            if m.group(1) not in declared:
                out.append(Problem("mutating-call", lineno,
                                   "added line '{}' mutates {}, which the added lines did not "
                                   "declare".format(snippet(raw), m.group(1))))
        for ch in code:
            if ch in "([":
                depth += 1
            elif ch in ")]":
                depth = max(0, depth - 1)
    return out


def _depth_zero(code: str) -> str:
    """The code with text inside ( and [ blanked (assignments count at statement depth)."""
    out = []
    depth = 0
    for ch in code:
        if ch in "([":
            depth += 1
            out.append(ch)
            continue
        if ch in ")]":
            depth = max(0, depth - 1)
            out.append(ch)
            continue
        out.append(ch if depth == 0 else " ")
    return "".join(out)


# ---------------------------------------------------------------------------
# Runs: scan, context and tail (GC-01 items 7 to 11, revision R4)
# ---------------------------------------------------------------------------

JS_TEST_PREFIX = re.compile(r"(?<![\w$.])(?:it|test|specify)(?:\s*\.\s*[A-Za-z]+(?:\s*\([^()]*\))?)*"
                            r"\s*$")
JS_CONTAINER_PREFIX = re.compile(r"(?<![\w$.])(?:describe|context|suite)(?:\s*\.\s*[A-Za-z]+"
                                 r"(?:\s*\([^()]*\))?)*\s*$")
RS_TEST_ATTR = re.compile(r"^\s*#\[\s*(?:\w+::)*(?:test|rstest|test_case|quickcheck)\b")


class RunScan:
    def __init__(self) -> None:
        self.code: List[str] = []
        self.problems: List[Problem] = []
        self.start_depths: List[int] = []
        self.cont: List[bool] = []


def scan_run(view: OldView, new: Sequence[str], a: int, b: int, p: int, family: str
             ) -> RunScan:
    """Blank literals in new[a..b] from the old state after line p; inside-literal and typed
    bracket balance (run-level problems)."""
    rs = RunScan()
    snap = view.snap_after[p] if p >= 0 else None
    sc = Scanner.restore(family, snap)
    if sc.in_literal:
        rs.problems.append(Problem("inside-literal", a + 1, "the added lines start inside a "
                                   "string, template or comment of the file"))
    local: List[str] = []
    balanced = True
    for idx in range(a, b + 1):
        rs.start_depths.append(len(local))
        rs.cont.append(sc.in_literal or bool(local) or (sc.depth > (snap[4] if snap else 0)))
        rs.code.append(sc.scan(new[idx]))
        for kind, ch in sc.events:
            if kind == "open":
                local.append(ch)
            elif not local or OPENERS[local[-1]] != ch:
                balanced = False
                if local:
                    local.pop()
            else:
                local.pop()
    if sc.in_literal and not any(pr.code == "inside-literal" for pr in rs.problems):
        rs.problems.append(Problem("inside-literal", b + 1, "the added lines end inside a string, "
                                   "template or comment"))
    if not balanced or local:
        rs.problems.append(Problem("unbalanced-run", a + 1, "the added lines do not close every "
                                   "bracket they open, or close one they did not open"))
    return rs


def _next_code(view: OldView, p: int) -> Optional[int]:
    for k in range(p + 1, len(view.code)):
        if view.code[k].strip():
            return k
    return None


def _statement_starts(rs: RunScan) -> List[int]:
    out = []
    for k, code in enumerate(rs.code):
        text = code.strip()
        if rs.start_depths[k] == 0 and text and text[0] not in "})]":
            out.append(k)
    return out


def _brace_context(view: OldView, p: int, family: str) -> str:
    st = view.stack_after(p)
    if not st:
        return "module" if family != "sol" else "other"
    top = st[-1]
    if top[0] != "{":
        return "other"
    ch, li, col, prefix = top
    if family == "js":
        paren = next((e for e in reversed(st[:-1]) if e[0] == "("), None)
        if paren is None:
            return "other"
        if JS_TEST_PREFIX.search(paren[3]):
            return "test-body"
        if JS_CONTAINER_PREFIX.search(paren[3]):
            return "container"
        return "other"
    if family == "rs":
        above = view.code[max(0, li - 3):li]
        joined = " ".join(above + [prefix])
        if re.search(r"\bfn\s+\w+\s*(?:<[^{]*>)?\s*\([^{]*$", joined):
            fn_line = li
            for k in range(li, max(-1, li - 4), -1):
                text = prefix if k == li else view.code[k]
                if re.search(r"\bfn\s+\w+", text):
                    fn_line = k
                    break
            if any(RS_TEST_ATTR.match(view.lines[k]) for k in range(max(0, fn_line - 5), fn_line)):
                return "test-body"
        if re.search(r"\bmod\s+\w+\s*$", prefix) and any(
                re.search(r"#\[\s*cfg\s*\(\s*test\s*\)\s*\]", view.lines[k])
                for k in range(max(0, li - 3), li)):
            return "container"
        return "other"
    if family == "go":
        if re.match(r"^\s*func\s+(?:\([^)]*\)\s*)?Test\w*\s*\([^)]*\)\s*$", prefix):
            return "test-body"
        paren = next((e for e in reversed(st[:-1]) if e[0] == "("), None)
        if paren is not None and re.search(r"\b\w+\.Run\s*$", paren[3]) and \
                re.search(r"func\s*\([^)]*\)\s*$", prefix):
            return "test-body"
        return "other"
    if family == "sol":
        joined = " ".join(view.code[max(0, li - 3):li] + [prefix])
        if re.search(r"\bfunction\s+(?:test|invariant)\w*\s*\([^{]*$", joined):
            return "test-body"
        if re.search(r"\bcontract\s+\w+(?:\s+is\s+[^{]*)?$", prefix):
            return "container"
        return "other"
    return "other"


def _brace_placement(view: OldView, rs: RunScan, a: int, p: int, family: str) -> List[Problem]:
    context = _brace_context(view, p, family)
    if context == "other":
        return [Problem("not-in-test", a + 1, "the added lines are not inside a test body, a "
                        "describe block, a test class or contract, or at the end of the module")]
    q = _next_code(view, p)
    if context == "module":
        if q is not None:
            return [Problem("not-at-tail", a + 1, "new module-level lines go at the end of the "
                            "file")]
    elif q is None or not view.code[q].lstrip().startswith("}"):
        return [Problem("not-at-tail", a + 1, "the added lines are not at the end of the {} (just "
                        "before its closing line)".format("test body" if context == "test-body"
                                                          else "block"))]
    if context in ("module", "container"):
        opener = CONTAINER_OPENER[family]
        for k in _statement_starts(rs):
            if not opener.match(rs.code[k]):
                return [Problem("not-a-test-definition", a + k + 1,
                                "a new statement at this level must be a test case")]
    return []


def _py_placement(view: OldView, new: Sequence[str], rs: RunScan, a: int, p: int
                  ) -> List[Problem]:
    if p >= 0 and (view.in_literal_after(p) or view.snap_after[p][4] > 0):
        return [Problem("inside-literal", a + 1, "the added lines start inside a bracket or a "
                        "string of the file")]
    code_idx = [k for k, c in enumerate(rs.code) if c.strip() and not rs.cont[k]]
    segments: List[List[int]] = []
    for k in code_idx:
        ind = _indent(new[a + k])
        if not segments or ind < min(_indent(new[a + j]) for j in segments[-1]):
            segments.append([k])
        else:
            segments[-1].append(k)
    q = _next_code(view, p)
    out: List[Problem] = []
    for number, seg in enumerate(segments):
        base_indent = _indent(new[a + seg[0]])
        seg_stop = segments[number + 1][0] if number + 1 < len(segments) else len(rs.code)
        tail_lines = [k for k in range(seg[0], seg_stop) if rs.code[k].strip()]
        if tail_lines and rs.code[tail_lines[-1]].rstrip().endswith(":"):
            out.append(Problem("opens-block", a + tail_lines[-1] + 1, "the added lines end with "
                               "an unfinished block"))
            continue
        opener_k = None
        for k in range(p, -1, -1):
            if view.code[k].strip() and not view.cont[k] and view.indent[k] < base_indent:
                opener_k = k
                break
        if opener_k is None:
            context = "module" if base_indent == 0 else "other"
            opener_indent = -1
        else:
            opener_indent = view.indent[opener_k]
            text = view.code[opener_k]
            if not text.rstrip().endswith(":"):
                context = "other"
            elif PY_TEST_DEF.match(text):
                context = "test-body"
            elif re.match(r"^\s*class\s+\w*Test\w*\s*[(:]", text):
                context = "container"
            else:
                context = "other"
        if context == "other":
            out.append(Problem("not-in-test", a + seg[0] + 1, "the added lines are not inside a "
                               "test function or test class, or at the end of the module"))
            continue
        if context == "module":
            if q is not None:
                out.append(Problem("not-at-tail", a + seg[0] + 1, "new module-level lines go at "
                                   "the end of the file"))
                continue
        elif not (q is None or view.indent[q] <= opener_indent):
            out.append(Problem("not-at-tail", a + seg[0] + 1, "the added lines are not at the end "
                               "of the {}".format("test function" if context == "test-body"
                                                  else "test class")))
            continue
        if context in ("module", "container"):
            for k in seg:
                if _indent(new[a + k]) == base_indent and not (
                        PY_TEST_DEF.match(rs.code[k]) or PY_DECORATOR_OK.match(rs.code[k])):
                    out.append(Problem("not-a-test-definition", a + k + 1,
                                       "a new statement at this level must be a test function"))
                    break
    return out


def _header_import_run(view: OldView, rs: RunScan, run_raw: Sequence[str], p: int,
                       family: str) -> bool:
    if p + 1 > view.header_end:
        return False
    statements: List[str] = []
    current = ""
    depth = 0
    for raw, code in zip(run_raw, rs.code):
        if not code.strip() and depth == 0:
            continue
        current = (current + " " + raw.strip()).strip()
        depth += code.count("(") + code.count("{") - code.count(")") - code.count("}")
        if depth <= 0:
            statements.append(current)
            current = ""
            depth = 0
    if current or not statements:
        return False
    return all(NAMED_IMPORT_RE[family].match(s) for s in statements)


def _placement(view: OldView, new: Sequence[str], a: int, b: int, p: int, family: str
               ) -> Tuple[List[Problem], RunScan, bool]:
    rs = scan_run(view, new, a, b, p, family)
    if rs.problems:
        return rs.problems, rs, False
    raw = new[a:b + 1]
    if _header_import_run(view, rs, raw, p, family):
        return [], rs, True
    if family == "py":
        return _py_placement(view, new, rs, a, p), rs, False
    return _brace_placement(view, rs, a, p, family), rs, False


def check_additions(old_text: str, new_text: str, path: str, *,
                    must_contain: Optional[str] = None,
                    deadline: Optional[float] = None) -> List[Problem]:
    """The problems of `new_text` as a version of `old_text` that only adds lines (GC-01 item
    14); [] when the rule accepts it."""
    family = family_of(path)
    if family is None:
        return [Problem("not-strengthenable", None, "unsupported language")]
    old, _ = split_lines(old_text)
    new, _ = split_lines(new_text)
    base_lines = split_lines(must_contain)[0] if must_contain is not None else []
    if any(len(line) > MAX_LINE_CHARS for line in list(old) + list(new) + list(base_lines)):
        return [Problem("unverifiable", None, "a line longer than {} characters cannot be "
                        "checked".format(MAX_LINE_CHARS))]
    if must_contain is not None and align(base_lines, new) is None:
        i = first_unmatched(base_lines, new)
        return [Problem("removed-line", None, "line {} of the base version ('{}') is missing, "
                        "moved or changed; existing lines are read-only".format(
                            i + 1, snippet(base_lines[i])))]
    pos = align(old, new)
    bom = chr(0xFEFF)
    if pos is None or (old and new and old[0].startswith(bom) != new[0].startswith(bom)):
        o2 = [old[0].lstrip(bom)] + list(old[1:]) if old else []
        n2 = [new[0].lstrip(bom)] + list(new[1:]) if new else []
        if (old and old[0].startswith(bom)) != (new and new[0].startswith(bom)) and \
                align(o2, n2) is not None:
            return [Problem("bom-changed", None, "the byte-order mark of line 1 was added or "
                            "removed; existing lines are read-only")]
        if pos is None:
            i = first_unmatched(old, new)
            return [Problem("removed-line", None, "line {} of the reference ('{}') is missing, "
                            "moved or changed; existing lines are read-only".format(
                                i + 1, snippet(old[i])))]
    view = OldView(old, family)
    ext = os.path.splitext(path.lower())[1]
    new_to_old = {j: i for i, j in enumerate(pos)}
    matched = set(pos)
    runs: List[Tuple[int, int]] = []
    k = 0
    while k < len(new):
        if k in matched:
            k += 1
            continue
        s = k
        while k < len(new) and k not in matched:
            k += 1
        runs.append((s, k - 1))
    problems: List[Problem] = []
    for s, e in runs:
        if deadline is not None and time.monotonic() > deadline:
            return [Problem("unverifiable", None, "the additions check exceeded its time budget")]
        if all(not line.strip() for line in new[s:e + 1]):
            continue
        p = new_to_old[s - 1] if s > 0 else -1
        first, rs, header = _placement(view, new, s, e, p, family)
        chosen_rs, chosen_header = rs, header
        if first:
            for a, b, pp in _slides(new, matched, new_to_old, s, e):
                if deadline is not None and time.monotonic() > deadline:
                    return [Problem("unverifiable", None, "the additions check exceeded its "
                                    "time budget")]
                alt, alt_rs, alt_header = _placement(view, new, a, b, pp, family)
                if not alt:
                    first = []
                    chosen_rs, chosen_header = alt_rs, alt_header
                    break
        problems += first
        run_raw = new[s:e + 1]
        for idx, raw in enumerate(run_raw):
            problems += line_problems(raw, chosen_rs.code[idx] if idx < len(chosen_rs.code)
                                      else raw, family, ext, s + idx + 1)
        problems += binding_problems(run_raw, chosen_rs.code, s + 1, family, view,
                                     chosen_header, set())
    seen: Set[Tuple[str, Optional[int]]] = set()
    out: List[Problem] = []
    for pr in sorted(problems, key=lambda x: (x.line or 0, x.code)):
        key = (pr.code, pr.line)
        if key not in seen:
            seen.add(key)
            out.append(pr)
    return out[:MAX_PROBLEMS]


def _slides(new: Sequence[str], matched: Set[int], new_to_old: Dict[int, int], s: int, e: int
            ) -> List[Tuple[int, int, int]]:
    """Alternative positions of the run [s, e] (the slider fallback of GC-01 item 7)."""
    out: List[Tuple[int, int, int]] = []
    a, b = s, e
    while b + 1 < len(new) and (b + 1) in matched and new[a] == new[b + 1] and \
            (b + 2 >= len(new) or (b + 2) in matched):
        p = new_to_old[b + 1]
        a, b = a + 1, b + 1
        out.append((a, b, p))
    a, b = s, e
    while a - 1 >= 0 and (a - 1) in matched and new[b] == new[a - 1] and \
            (a - 2 < 0 or (a - 2) in matched):
        a, b = a - 1, b - 1
        p = new_to_old[a - 1] if a - 1 >= 0 else -1
        out.append((a, b, p))
    return out


# ---------------------------------------------------------------------------
# Line endings, tool reproduction, reverts (GC-01 items 15 to 19, revision R6)
# ---------------------------------------------------------------------------


def expected_deletions(base_text: str, new_text: str) -> int:
    """1 when base ends without a newline and new text follows its last line (git counts that
    line as deleted and re-added), else 0."""
    if not base_text or base_text.endswith("\n"):
        return 0
    old, _ = split_lines(base_text)
    new, new_ends = split_lines(new_text)
    pos = align(old, new)
    if pos is None or not pos:
        return 0
    last = pos[-1]
    return 1 if last < len(new) - 1 or new_ends else 0


def eol_changed_raw(old_bytes: bytes, new_bytes: bytes) -> bool:
    """True when an aligned line changed its line ending (CR added or removed)."""
    def raw_lines(data: bytes) -> List[bytes]:
        parts = data.split(b"\n")
        if data.endswith(b"\n"):
            parts = parts[:-1]
        return parts
    old_raw, new_raw = raw_lines(old_bytes), raw_lines(new_bytes)
    old_s = [x[:-1] if x.endswith(b"\r") else x for x in old_raw]
    new_s = [x[:-1] if x.endswith(b"\r") else x for x in new_raw]
    pos = align(old_s, new_s)
    if pos is None:
        return False
    for i, j in enumerate(pos):
        if old_raw[i] != new_raw[j]:
            return True
    return False


def apply_tool_edit(tool_name: str, tool_input: Any, current_text: str
                    ) -> Tuple[Optional[str], Optional[Problem]]:
    """The file text a Write, Edit or MultiEdit would produce (GC-01 item 17)."""
    def unverifiable(msg: str) -> Tuple[Optional[str], Optional[Problem]]:
        return None, Problem("unverifiable", None, msg)
    if not isinstance(tool_input, dict):
        return unverifiable("the tool input is missing")
    if tool_name == "Write":
        content = tool_input.get("content")
        if not isinstance(content, str):
            return unverifiable("the Write has no text content")
        return content, None

    def one(text: str, edit: Any) -> Tuple[Optional[str], Optional[str]]:
        if not isinstance(edit, dict):
            return None, "an edit is not an object"
        old, new, every = edit.get("old_string"), edit.get("new_string"), \
            edit.get("replace_all", False)
        if not isinstance(old, str) or not isinstance(new, str) or not old or \
                not isinstance(every, bool):
            return None, "the edit's old_string/new_string/replace_all are missing or invalid"
        count = text.count(old)
        if count == 0:
            text_n, old_n, new_n = (text.replace("\r\n", "\n"), old.replace("\r\n", "\n"),
                                    new.replace("\r\n", "\n"))
            if text_n.count(old_n) == 0:
                return None, "the edit's old_string does not occur in the file; the Edit tool " \
                             "would fail too"
            if "\r\n" in text:
                old_n, new_n = old_n.replace("\n", "\r\n"), new_n.replace("\n", "\r\n")
                if text.count(old_n) == 0:
                    return None, "the edit's old_string does not occur in the file"
                text_n = text
            count = text_n.count(old_n)
            text, old, new = text_n, old_n, new_n
        if count > 1 and not every:
            return None, "old_string occurs {} times without replace_all".format(count)
        return (text.replace(old, new) if every else text.replace(old, new, 1)), None
    if tool_name == "Edit":
        out, err = one(current_text, tool_input)
        return (out, None) if err is None else unverifiable(err)
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits")
        if not isinstance(edits, list) or not edits:
            return unverifiable("the MultiEdit has no edits")
        text = current_text
        for edit in edits:
            out, err = one(text, edit)
            if err is not None:
                return unverifiable(err)
            text = out or ""
        return text, None
    return unverifiable("{} cannot be checked line by line".format(tool_name or "this tool"))


def _stripped_lines(text: str) -> List[str]:
    return split_lines(text)[0]


def added_counter(parent_text: str, commit_text: str) -> Counter:
    """The stripped commit lines left unmatched by align(parent, commit)."""
    parent, commit = _stripped_lines(parent_text), _stripped_lines(commit_text)
    pos = align(parent, commit)
    if pos is None:
        return Counter()
    matched = set(pos)
    return Counter(line.strip() for j, line in enumerate(commit) if j not in matched)


def removed_counter(parent_text: str, commit_text: str) -> Counter:
    """The stripped parent lines left unmatched by align(commit, parent)."""
    parent, commit = _stripped_lines(parent_text), _stripped_lines(commit_text)
    pos = align(commit, parent)
    if pos is None:
        return Counter()
    matched = set(pos)
    return Counter(line.strip() for i, line in enumerate(parent) if i not in matched)


def _diff_counts(parent_text: str, commit_text: str) -> Tuple[Counter, Counter]:
    """(removed, added) stripped lines of parent -> commit (difflib, any edit shape)."""
    import difflib
    parent = [x.strip() for x in _stripped_lines(parent_text)]
    commit = [x.strip() for x in _stripped_lines(commit_text)]
    removed: Counter = Counter()
    added: Counter = Counter()
    matcher = difflib.SequenceMatcher(a=parent, b=commit, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag in ("delete", "replace"):
            removed.update(parent[i1:i2])
        if tag in ("insert", "replace"):
            added.update(commit[j1:j2])
    return removed, added


def check_revert(parent_text: str, commit_text: str, target_added: Counter,
                 target_removed: Optional[Counter] = None) -> List[Problem]:
    """A revert commit may remove only lines its reverted commit added and, given what that
    commit removed (target_removed), add back only those (GC-01 item 18, revision R6)."""
    if target_removed is None:
        parent, commit = _stripped_lines(parent_text), _stripped_lines(commit_text)
        pos = align(commit, parent)
        if pos is None:
            i = first_unmatched(commit, parent)
            return [Problem("removed-line", None, "the revert changes line {} ('{}') instead of "
                            "removing lines".format(i + 1, snippet(commit[i])))]
        matched = set(pos)
        removed = Counter(line.strip() for i, line in enumerate(parent) if i not in matched)
        added: Counter = Counter()
    else:
        removed, added = _diff_counts(parent_text, commit_text)
    out: List[Problem] = []
    for text, count in sorted(removed.items()):
        if count > target_added.get(text, 0):
            out.append(Problem("revert-removes-more", None, "the revert removes '{}', which the "
                               "reverted commit did not add".format(snippet(text))))
            break
    for text, count in sorted(added.items()):
        if target_removed is not None and count > target_removed.get(text, 0):
            out.append(Problem("revert-adds-more", None, "the revert adds '{}', which the "
                               "reverted commit did not remove".format(snippet(text))))
            break
    return out


# ---------------------------------------------------------------------------
# Git (GC-01 items 20 to 22, revision R1)
# ---------------------------------------------------------------------------

GIT_PREFIX = ["git", "-c", "core.quotepath=off", "-c", "color.ui=never"]


class GitFailure(RuntimeError):
    """A git command failed."""


def _git_env() -> Dict[str, str]:
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env.pop("GIT_EXTERNAL_DIFF", None)
    return env


def git_run(repo: Path, args: Sequence[str], input_bytes: Optional[bytes] = None
            ) -> "subprocess.CompletedProcess[bytes]":
    try:
        return subprocess.run(GIT_PREFIX + list(args), cwd=str(repo), input=input_bytes,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_git_env(),
                              check=False)
    except OSError as exc:
        raise GitFailure("git could not run: {}".format(exc)) from exc


def git_out(repo: Path, args: Sequence[str], input_bytes: Optional[bytes] = None) -> bytes:
    proc = git_run(repo, args, input_bytes)
    if proc.returncode != 0:
        raise GitFailure("git {} failed: {}".format(" ".join(args[:2]), proc.stderr.decode(
            "utf-8", errors="replace").strip()[:300]))
    return proc.stdout


def read_blobs(repo: Path, specs: Sequence[str]) -> Dict[str, Optional[bytes]]:
    """`<rev>:<path>` -> bytes (None when missing) in one `git cat-file --batch` call."""
    result: Dict[str, Optional[bytes]] = {s: None for s in specs}
    if not specs:
        return result
    data = git_out(repo, ["cat-file", "--batch"], "".join(s + "\n" for s in specs).encode("utf-8"))
    pos = 0
    for spec in specs:
        nl = data.find(b"\n", pos)
        if nl == -1:
            break
        header = data[pos:nl].decode("utf-8", errors="replace").split(" ")
        pos = nl + 1
        if header[-1] in ("missing", "ambiguous") or len(header) != 3:
            continue
        size = int(header[2])
        if header[1] == "blob":
            result[spec] = data[pos:pos + size]
        pos += size + 1
    return result


def decode_problem(data: Optional[bytes], what: str) -> Tuple[Optional[str], Optional[Problem]]:
    if data is None:
        return None, Problem("unverifiable", None, "{} cannot be read".format(what))
    if len(data) > MAX_BYTES:
        return None, Problem("too-large", None, "{} is larger than {} bytes".format(what,
                                                                                    MAX_BYTES))
    if b"\x00" in data:
        return None, Problem("binary", None, "{} is binary".format(what))
    try:
        return data.decode("utf-8"), None
    except UnicodeDecodeError:
        return None, Problem("not-utf8", None, "{} is not UTF-8".format(what))


def _unquote(text: str) -> str:
    if not (len(text) >= 2 and text[0] == "\"" and text[-1] == "\""):
        return text
    try:
        import diff_guard as dg  # noqa: E402
        return dg._unquote_c(text)
    except Exception:  # noqa: BLE001
        return text[1:-1]


REVERT_RE = re.compile(r"This reverts commit ([0-9a-f]{40,64})")


def commit_walk(repo: Path, base: str, head: str, is_candidate: Callable[[str], bool]
                ) -> List[Dict[str, Any]]:
    """Every commit of base..head (first parent) that changes an existing test file beyond
    checked additions (GC-01 item 21, revision R6)."""
    raw = git_out(repo, ["log", "--first-parent", "--no-renames", "--format=%x1e%H %P",
                         "--name-status", "{}..{}".format(base, head)]).decode("utf-8", "replace")
    commits: List[Tuple[str, List[Tuple[str, str]]]] = []
    for record in raw.split("\x1e"):
        lines = [ln for ln in record.split("\n") if ln.strip()]
        if not lines:
            continue
        sha = lines[0].split(" ")[0]
        changes = []
        for ln in lines[1:]:
            parts = ln.split("\t")
            if len(parts) >= 2:
                changes.append((parts[0][:1], _unquote(parts[-1])))
        commits.append((sha, changes))
    commits.reverse()
    in_range = {sha for sha, _ in commits}
    bodies = git_out(repo, ["log", "--first-parent", "--format=%H%x1f%B%x1e",
                            "{}..{}".format(base, head)]).decode("utf-8", "replace")
    reverts: Dict[str, str] = {}
    for record in bodies.split("\x1e"):
        if "\x1f" not in record:
            continue
        sha, body = record.strip("\n").split("\x1f", 1)
        m = REVERT_RE.search(body)
        if m and m.group(1) in in_range:
            reverts[sha.strip()] = m.group(1)
    reverted = set(reverts.values())
    base_paths: Set[str] = set()
    specs: List[str] = []
    todo: List[Tuple[str, str, str]] = []
    for sha, changes in commits:
        if sha in reverted:
            continue
        for status, path in changes:
            if not is_candidate(path):
                continue
            todo.append((sha, status, path))
            base_paths.add(path)
    base_blobs = read_blobs(repo, ["{}:{}".format(base, p) for p in sorted(base_paths)])
    for sha, status, path in todo:
        if status == "M" and base_blobs.get("{}:{}".format(base, path)) is not None:
            specs += ["{}^:{}".format(sha, path), "{}:{}".format(sha, path)]
            if sha in reverts:
                x = reverts[sha]
                specs += ["{}^:{}".format(x, path), "{}:{}".format(x, path)]
    blobs = read_blobs(repo, specs)
    out: List[Dict[str, Any]] = []
    for sha, status, path in todo:
        base_blob = base_blobs.get("{}:{}".format(base, path))
        if base_blob is None:
            continue
        if status in ("D", "T"):
            out.append({"commit": sha, "file": path, "problem": Problem(
                "deleted" if status == "D" else "type-changed", None,
                "the commit {} the existing test file".format(
                    "deletes" if status == "D" else "changes the file type of"))})
            continue
        if status != "M":
            continue
        base_text, _ = decode_problem(base_blob, "the base version")
        if base_text is None or not_strengthenable(path, base_text, snapshot=False,
                                                   protected=False) is not None:
            continue
        parent_b = blobs.get("{}^:{}".format(sha, path))
        commit_b = blobs.get("{}:{}".format(sha, path))
        parent_t, prob = decode_problem(parent_b, "the parent version")
        commit_t, prob2 = decode_problem(commit_b, "the commit version")
        problems: List[Problem] = []
        if prob or prob2:
            problems = [prob or prob2]  # type: ignore[list-item]
        elif sha in reverts:
            x = reverts[sha]
            x_parent, _ = decode_problem(blobs.get("{}^:{}".format(x, path)), "x")
            x_commit, _ = decode_problem(blobs.get("{}:{}".format(x, path)), "x")
            if x_parent is None or x_commit is None:
                problems = [Problem("unverifiable", None, "the reverted commit's versions cannot "
                                    "be read")]
            else:
                removed_x, added_x = _diff_counts(x_parent, x_commit)
                problems = check_revert(parent_t or "", commit_t or "", added_x, removed_x)
        else:
            problems = check_additions(parent_t or "", commit_t or "", path)
            if eol_changed_raw(parent_b or b"", commit_b or b"") and not any(
                    p.code in ("removed-line", "bom-changed") for p in problems):
                problems.insert(0, Problem("eol-changed", None, "the commit rewrites the line "
                                           "endings of existing lines"))
        for problem in problems:
            out.append({"commit": sha, "file": path, "problem": problem})
    return out


def _run_config(repo: Path) -> Any:
    import diff_guard as dg  # noqa: E402  (diff_guard imports this module at its top)
    return dg.load_run_config(repo)


def _cfg_paths(cfg: Any, path: str, snapshots_too: bool) -> bool:
    if cfg.allow.first_match(path):
        return False
    if path.startswith(".harden/"):
        return False
    if snapshots_too:
        return bool(cfg.tests.first_match(path) or cfg.snapshots.first_match(path))
    return bool(cfg.tests.first_match(path)) and not cfg.snapshots.first_match(path)


def strengthened_files(repo: Path, base: str, cfg: Any = None) -> List[Tuple[str, int]]:
    """Existing test files that differ from base in the working tree, with their added-line
    counts (GC-01 item 22)."""
    cfg = cfg or _run_config(repo)
    names = [_unquote(p) for p in git_out(repo, ["diff", "--name-only", "-z", "--no-renames",
                                                 base, "--"]).decode("utf-8", "replace")
             .split("\0") if p]
    keep = [p for p in names if _cfg_paths(cfg, p, False) and (repo / p).is_file()]
    blobs = read_blobs(repo, ["{}:{}".format(base, p) for p in keep])
    out: List[Tuple[str, int]] = []
    for p in keep:
        blob = blobs.get("{}:{}".format(base, p))
        if blob is None:
            continue
        try:
            new_text = (repo / p).read_bytes().decode("utf-8")
            old_text = blob.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            out.append((p, 0))
            continue
        out.append((p, sum(added_counter(old_text, new_text).values())))
    return out


def added_test_files(repo: Path, base: str, cfg: Any = None) -> List[str]:
    """Test files the run added (status A against base), set aside by the replay (R1)."""
    cfg = cfg or _run_config(repo)
    raw = git_out(repo, ["diff", "--name-status", "-z", "--no-renames", base, "--"]).decode(
        "utf-8", "replace").split("\0")
    out: List[str] = []
    i = 0
    while i + 1 < len(raw):
        status, path = raw[i], raw[i + 1]
        i += 2
        if status.startswith("A") and _cfg_paths(cfg, path, True):
            out.append(path)
    return sorted(out)


def untracked_test_files(repo: Path, cfg: Any) -> List[str]:
    raw = git_out(repo, ["ls-files", "--others", "--exclude-standard", "-z"]).decode(
        "utf-8", "replace").split("\0")
    return sorted(p for p in raw if p and _cfg_paths(cfg, p, True))


# ---------------------------------------------------------------------------
# CLI: list, replay, restore
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(str(tmp), "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.replace(str(tmp), str(path))


def _index_blobs(repo: Path, paths: Sequence[str]) -> Dict[str, str]:
    if not paths:
        return {}
    raw = git_out(repo, ["ls-files", "-s", "-z", "--"] + list(paths)).decode("utf-8", "replace")
    out: Dict[str, str] = {}
    for entry in raw.split("\0"):
        if "\t" not in entry:
            continue
        meta, path = entry.split("\t", 1)
        parts = meta.split()
        if len(parts) >= 2:
            out[path] = parts[1]
    return out


def _write_blob(repo: Path, path: str, blob: str) -> None:
    data = git_out(repo, ["cat-file", "--filters", "--path=" + path, blob])
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(str(target), "wb") as handle:
        handle.write(data)


def _restore(repo: Path, state: Dict[str, Any]) -> List[str]:
    """Write every recorded path back from its index blob; the paths still differing."""
    blobs = state.get("blobs") or {}
    paths = list(state.get("files") or []) + list(state.get("hidden") or [])
    for path in paths:
        blob = blobs.get(path)
        if blob:
            _write_blob(repo, path, blob)
        else:
            git_run(repo, ["--literal-pathspecs", "restore", "--worktree", "--", path])
    if not paths:
        return []
    proc = git_run(repo, ["diff", "--quiet", "--"] + paths)
    bad = [p for p in paths if not (repo / p).exists()]
    if proc.returncode != 0:
        bad += [p for p in paths if p not in bad]
    return sorted(set(bad))


def _state_path(repo: Path) -> Path:
    return repo / STATE_NAME


def cmd_list(repo: Path, base: str, as_json: bool) -> int:
    cfg = _run_config(repo)
    files = strengthened_files(repo, base, cfg)
    added = added_test_files(repo, base, cfg)
    if as_json:
        print(json.dumps({"base": base, "files": [{"path": p, "added_lines": n}
                                                  for p, n in files],
                          "added_test_files": added}, indent=2))
        return 0
    for p, n in files:
        print("strengthened: {} (+{} lines)".format(p, n))
    for p in added:
        print("set aside for replay: {}".format(p))
    if not files and not added:
        print("nothing strengthened against {}".format(base[:12]))
    return 0


def cmd_replay(repo: Path, base: str, label: str, config: Optional[str], gates_arg: Optional[str],
               as_json: bool) -> int:
    if not LABEL_RE.match(label or ""):
        print("strengthen.py: --label must match [A-Za-z0-9._-]{1,100}", file=sys.stderr)
        return 2
    state_path = _state_path(repo)
    if state_path.exists():
        try:
            files = json.loads(state_path.read_text(encoding="utf-8")).get("files")
        except (OSError, ValueError):
            files = None
        print("strengthen.py: a previous replay did not restore {}; run strengthen.py restore"
              .format(", ".join(files) if files else "unknown files"), file=sys.stderr)
        return 2
    cfg = _run_config(repo)
    files = [p for p, _n in strengthened_files(repo, base, cfg)]
    untracked = untracked_test_files(repo, cfg)
    if untracked:
        print("strengthen.py: untracked new test files {}: stage them first (the replay "
              "restores them from the index)".format(", ".join(untracked[:10])), file=sys.stderr)
        return 2
    added = added_test_files(repo, base, cfg)
    record_path = repo / ".harden" / "tools" / "replay-{}.json".format(label)
    record: Dict[str, Any] = {"tool": "strengthen", "version": 1, "generated": _now(),
                              "label": label, "base": base,
                              "head": git_out(repo, ["rev-parse", "HEAD"]).decode().strip(),
                              "files": [], "hidden": added, "gates": [],
                              "gate_record": ".harden/gates/{}.json".format(label),
                              "gates_exit": None, "result": "nothing-to-replay"}
    if not files and not added:
        print("nothing to replay: no existing test file differs from {}".format(base[:12]))
        _write_json(record_path, record)
        return 0
    paths = files + added
    if git_run(repo, ["diff", "--quiet", "--"] + paths).returncode != 0:
        print("strengthen.py: unstaged changes in {}: stage or restore them first (the replay "
              "restores from the index)".format(", ".join(paths)), file=sys.stderr)
        return 2
    config_path = Path(config) if config else repo / ".harden" / "config.json"
    try:
        config_data = json.loads(config_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        print("strengthen.py: cannot read {}: {}".format(config_path, exc), file=sys.stderr)
        return 2
    all_gates = [g for g in config_data.get("gates") or [] if isinstance(g, dict)]
    if gates_arg:
        names = [n.strip() for n in gates_arg.split(",") if n.strip()]
        unknown = [n for n in names if n not in {g.get("name") for g in all_gates}]
        if unknown:
            print("strengthen.py: unknown gate(s) {}".format(", ".join(unknown)), file=sys.stderr)
            return 2
    else:
        names = [g["name"] for g in all_gates if g.get("count_regex") and not g.get("ratchet")]
    if not names:
        print("strengthen.py: no test gate (a gate with count_regex) in {}; pass --gates".format(
            config_path), file=sys.stderr)
        return 2
    base_blobs = read_blobs(repo, ["{}:{}".format(base, p) for p in files])
    index = _index_blobs(repo, paths)
    state = {"label": label, "files": files, "hidden": added, "blobs": index,
             "started": _now()}
    _write_json(state_path, state)
    gates_exit: Optional[int] = None
    result = "error"
    restore_failed = False
    try:
        for p in files:
            data = git_out(repo, ["cat-file", "--filters", "{}:{}".format(base, p)])
            with open(str(repo / p), "wb") as handle:
                handle.write(data)
        for p in added:
            target = repo / p
            if target.is_file():
                os.remove(str(target))
        proc = subprocess.run([sys.executable, os.path.join(_HERE, "gates.py"), "--repo",
                               str(repo), "--config", str(config_path), "--label", label,
                               "--only", ",".join(names)], stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        gates_exit = proc.returncode
        tail = (proc.stdout.decode("utf-8", "replace") + proc.stderr.decode("utf-8", "replace"))
        print("\n".join(tail.splitlines()[-40:]))
        result = {0: "pass", 1: "fail"}.get(gates_exit, "error")
    finally:
        bad = _restore(repo, state)
        if bad:
            print("restore failed; run strengthen.py restore ({})".format(", ".join(bad)),
                  file=sys.stderr)
            restore_failed = True
        else:
            state_path.unlink()
    if restore_failed:
        return 2
    record.update(files=[{"path": p, "base_blob": hashlib_blob(base_blobs.get(
        "{}:{}".format(base, p)))} for p in files], gates=names, gates_exit=gates_exit,
        result=result)
    _write_json(record_path, record)
    if as_json:
        print(json.dumps(record, indent=2))
    return 0 if result == "pass" else (1 if result == "fail" else 2)


def hashlib_blob(data: Optional[bytes]) -> Optional[str]:
    """The git blob id of `data` (sha1 of "blob <size>\\0" + data)."""
    if data is None:
        return None
    import hashlib
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\x00" + data).hexdigest()


def cmd_restore(repo: Path) -> int:
    state_path = _state_path(repo)
    if not state_path.exists():
        print("nothing to restore")
        return 0
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("strengthen.py: cannot read {}: {}".format(state_path, exc), file=sys.stderr)
        return 2
    paths = list(state.get("files") or []) + list(state.get("hidden") or [])
    current = _index_blobs(repo, paths)
    for p in paths:
        recorded = (state.get("blobs") or {}).get(p)
        if recorded and current.get(p) and current[p] != recorded:
            print("warning: the index blob of {} changed since the replay started; writing the "
                  "recorded version".format(p))
    try:
        for p in paths:
            blob = (state.get("blobs") or {}).get(p)
            if blob:
                _write_blob(repo, p, blob)
            else:
                git_out(repo, ["--literal-pathspecs", "restore", "--worktree", "--", p])
    except GitFailure as exc:
        print("strengthen.py: {}".format(exc), file=sys.stderr)
        return 2
    state_path.unlink()
    print("restored {}".format(", ".join(paths) or "nothing"))
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(prog="strengthen.py", description=(
        "The additions-only rule for existing test files (protocol-change PC-06)."))
    sub = parser.add_subparsers(dest="command")
    for name in ("list", "replay", "restore"):
        p = sub.add_parser(name)
        p.add_argument("--repo", default=".")
        if name != "restore":
            p.add_argument("--base")
            p.add_argument("--json", action="store_true")
        if name == "replay":
            p.add_argument("--label", required=True)
            p.add_argument("--config")
            p.add_argument("--gates")
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return 2 if exc.code not in (0, None) else 0
    if not args.command:
        parser.print_help()
        return 2
    try:
        top = git_out(Path(args.repo), ["rev-parse", "--show-toplevel"]).decode().strip()
        repo = Path(top)
        if args.command == "restore":
            return cmd_restore(repo)
        base = args.base
        if not base:
            base = _run_config(repo).base_sha
        if not base:
            print("strengthen.py: no --base and no base_sha in .harden/active", file=sys.stderr)
            return 2
        if args.command == "list":
            return cmd_list(repo, base, args.json)
        return cmd_replay(repo, base, args.label, args.config, args.gates, args.json)
    except GitFailure as exc:
        print("strengthen.py: {}".format(exc), file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - configuration errors from diff_guard
        print("strengthen.py: {}: {}".format(type(exc).__name__, exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
