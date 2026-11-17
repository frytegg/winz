#!/usr/bin/env python3
"""Offline, heuristic per-function complexity metrics for the complexity lens.

Purpose
    lizard needs a download that a run with `network: registry-only` or `denied` cannot make,
    and the autonomous pilot then had no complexity metric at all (pilot-auto-calibration
    A01-F04, A01-F18). This script computes, with the standard library only, per function:
      nloc          lines holding code tokens (comments and blank lines excluded);
      ccn_estimate  1 + decision points: each binary decision and short-circuit operator adds
                    one (NIST SP 500-235), each case label adds one (lizard's convention), Rust
                    match arms add n-1;
      max_nesting   control blocks nested inside the function, else-if and elif at their if's
                    level (the Sonar Cognitive Complexity paper's nesting increment);
      params        declared parameters, without self or this.
    It is a heuristic, not lizard: never compare its numbers with another tool's (CX-02).
    Python goes through `ast`; TypeScript/JavaScript (.ts .mts .cts .js .mjs .cjs), Rust, Go,
    C/C++, Java and C# go through a light tokenizer that skips strings, comments, regex and
    template literals. JSX files (.tsx, .jsx) are skipped: JSX text breaks the tokenizer.
    Known limits: a TypeScript return type that is an object literal type, and braceless
    bodies (`if (x) y;`), are not recognised; C++ template argument commas can over-count
    parameters. A file whose tokens do not balance gets an error and no metrics, never partial
    ones.

    Candidates are the functions above CX-04's advisory triggers (ccn_estimate > 10, nloc > 60,
    params >= 7) or CX-10's nesting (max_nesting > 3), sorted by number of triggers, then
    max_nesting, ccn_estimate and nloc, all descending.

CLI
    python complexity.py [FILE ...] [--files-from LIST] [--repo DIR] [--out FILE|-]
                         [--csv FILE] [--max-bytes N] [--json]
    (use python3 on macOS/Linux)
    Without FILE and --files-from, .harden/tools/inscope.txt is used when it exists.
    --out     default .harden/tools/complexity.json; '-' prints the JSON instead
    --csv     also write nloc,ccn_estimate,params,max_nesting,name,start_line,end_line,path
    --json    print the JSON summary to stdout (with --out - the whole result)

Exit codes
    0  ran (errors in single files included; an empty list gives an empty result)
    2  usage error, or an unreadable list
"""
from __future__ import annotations

import argparse
import ast
import csv
import io
import json
import os
import re
import sys
import tokenize
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)

VERSION = 1
DEFAULT_MAX_BYTES = 1_000_000
TRIGGERS = {"max_nesting": 3, "ccn_estimate": 10, "nloc": 60, "params": 7}
TRIGGER_SOURCE = ("skill defaults: CX-04 (CC > 10, SLOC > 60, 7 or more parameters), "
                  "CX-10 (nesting > 3)")
METHOD = ("per function: nloc = lines holding code tokens; ccn_estimate = 1 + decision points "
          "(binary decisions and short-circuit operators add one, NIST SP 500-235; each case "
          "label adds one, lizard's convention; Rust match arms add n-1); max_nesting = control "
          "blocks nested in the function, else-if and elif at their if's level; params = "
          "declared parameters without self/this. A heuristic, not lizard; never compare it "
          "with another tool (CX-02). Not recognised: JSX files, a TypeScript return type that "
          "is an object literal type, braceless bodies.")

PY_EXTS = {".py"}
LANG_BY_EXT = {
    ".ts": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
    ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".rs": "Rust", ".go": "Go",
    ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".cxx": "C++", ".hh": "C++",
    ".hpp": "C++", ".hxx": "C++", ".java": "Java", ".cs": "C#",
}
JSX_EXTS = {".tsx", ".jsx"}


class UsageError(Exception):
    """Bad arguments or an unreadable list."""


# ---------------------------------------------------------------------------
# Python
# ---------------------------------------------------------------------------
_PY_DECISIONS = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.IfExp, ast.ExceptHandler)
_PY_COMPOUND = tuple(t for t in (ast.If, ast.For, ast.AsyncFor, ast.While, ast.With,
                                 ast.AsyncWith, ast.Try, getattr(ast, "TryStar", None),
                                 getattr(ast, "Match", None)) if t is not None)
_PY_FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)


def _python_code_lines(text: str) -> Set[int]:
    skip = {tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT,
            tokenize.ENDMARKER, getattr(tokenize, "ENCODING", -1)}
    lines: Set[int] = set()
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type in skip:
                continue
            lines.update(range(tok.start[0], tok.end[0] + 1))
    except (tokenize.TokenError, SyntaxError, IndentationError):
        lines = {i for i, line in enumerate(text.split("\n"), 1)
                 if line.strip() and not line.strip().startswith("#")}
    return lines


def _py_params(node: Any, in_class: bool) -> int:
    a = node.args
    count = len(a.posonlyargs) + len(a.args) + len(a.kwonlyargs)
    count += 1 if a.vararg else 0
    count += 1 if a.kwarg else 0
    if in_class and (a.posonlyargs or a.args):
        static = any((isinstance(d, ast.Name) and d.id == "staticmethod")
                     or (isinstance(d, ast.Attribute) and d.attr == "staticmethod")
                     for d in node.decorator_list)
        if not static:
            count -= 1
    return count


def _py_ccn(node: ast.AST) -> int:
    """Decision points attributed to this function (nested functions excluded)."""
    total = 0
    stack = list(ast.iter_child_nodes(node))
    while stack:
        n = stack.pop()
        if isinstance(n, _PY_FUNCS) or isinstance(n, ast.Lambda):
            continue
        if isinstance(n, _PY_DECISIONS):
            total += 1
        elif isinstance(n, ast.BoolOp):
            total += len(n.values) - 1
        elif isinstance(n, ast.comprehension):
            total += 1 + len(n.ifs)
        elif type(n).__name__ == "match_case":
            pat = getattr(n, "pattern", None)
            wildcard = (type(pat).__name__ == "MatchAs" and getattr(pat, "pattern", 0) is None
                        and getattr(pat, "name", 0) is None)
            if not wildcard:
                total += 1
        stack.extend(ast.iter_child_nodes(n))
    return total


def _py_nesting(body: Sequence[ast.stmt], depth: int = 0) -> int:
    best = depth
    for stmt in body:
        if isinstance(stmt, _PY_FUNCS) or isinstance(stmt, ast.ClassDef):
            continue
        if isinstance(stmt, _PY_COMPOUND):
            inner = depth + 1
            best = max(best, inner)
            for field in ("body", "handlers", "finalbody"):
                block = getattr(stmt, field, None) or []
                if field == "handlers":
                    for h in block:
                        best = max(best, _py_nesting(h.body, inner))
                else:
                    best = max(best, _py_nesting(block, inner))
            orelse = getattr(stmt, "orelse", None) or []
            if isinstance(stmt, ast.If) and len(orelse) == 1 and isinstance(orelse[0], ast.If):
                best = max(best, _py_nesting(orelse, depth))  # elif at the if's level
            else:
                best = max(best, _py_nesting(orelse, inner))
            for case in getattr(stmt, "cases", None) or []:
                best = max(best, _py_nesting(case.body, inner))
    return best


def _analyse_python(rel: str, text: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {"path": rel, "language": "Python", "parser": "python-ast",
                              "functions": [], "error": None, "blocks": []}
    try:
        tree = ast.parse(text, filename=rel)
    except (SyntaxError, ValueError) as exc:
        result["error"] = "parse error: {}".format(exc)
        return result
    code_lines = _python_code_lines(text)
    records: List[Dict[str, Any]] = []

    def visit(node: ast.AST, prefix: List[str], in_class: bool) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, _PY_FUNCS):
                qual = prefix + [child.name]
                start, end = child.lineno, getattr(child, "end_lineno", child.lineno)
                rec = {"name": child.name, "qualname": ".".join(qual), "start_line": start,
                       "end_line": end, "ccn_estimate": 1 + _py_ccn(child),
                       "max_nesting": _py_nesting(child.body),
                       "params": _py_params(child, in_class), "_node": child}
                records.append(rec)
                result["blocks"].append({"kind": "function", "start_line": start,
                                         "end_line": end})
                visit(child, qual, False)
            elif isinstance(child, ast.ClassDef):
                result["blocks"].append({"kind": "class", "start_line": child.lineno,
                                         "end_line": getattr(child, "end_lineno", child.lineno)})
                visit(child, prefix + [child.name], True)
            else:
                visit(child, prefix, in_class)

    visit(tree, [], False)
    for rec in records:
        own = {ln for ln in code_lines if rec["start_line"] <= ln <= rec["end_line"]}
        for other in records:
            if other is rec:
                continue
            if (rec["start_line"] <= other["start_line"] and other["end_line"] <= rec["end_line"]
                    and other["_node"] in ast.walk(rec["_node"])):
                own -= set(range(other["_node"].lineno, other["end_line"] + 1))
        rec["nloc"] = len(own)
    for rec in records:
        rec.pop("_node")
        result["functions"].append({k: rec[k] for k in ("name", "qualname", "start_line",
                                                         "end_line", "nloc", "ccn_estimate",
                                                         "max_nesting", "params")})
    return result


# ---------------------------------------------------------------------------
# Brace languages: tokenizer
# ---------------------------------------------------------------------------
PUNCT = sorted(["===", "!==", "??", "?.", "=>", "->", "::", "&&", "||", "==", "!=", "<=",
                ">=", "++", "--", "..."], key=len, reverse=True)
IDENT_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
NUMBER_RE = re.compile(r"[0-9][0-9A-Za-z_]*(?:\.[0-9][0-9A-Za-z_]*)?")
RUST_CHAR_RE = re.compile(r"'(\\.|\\u\{[0-9a-fA-F]+\}|[^\\'\n])'")
CPP_RAW_RE = re.compile(r'(u8|u|U|L)?R"([^()\\ \t\n]{0,16})\(')
REGEX_PREV = {"(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*",
              "%", "<", ">", "~", "^", "=>", "&&", "||", "??", "==", "===", "!=", "!==",
              "<=", ">=", "+="}
REGEX_KEYWORDS = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
                  "throw", "case", "do", "else", "yield", "await"}


class Tok:
    __slots__ = ("kind", "text", "line", "end_line")

    def __init__(self, kind: str, text: str, line: int, end_line: int) -> None:
        self.kind = kind  # id, num, str, punct
        self.text = text
        self.line = line
        self.end_line = end_line

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "Tok({!r},{!r},{})".format(self.kind, self.text, self.line)


class TokenizeError(Exception):
    """Unbalanced or unterminated tokens."""


class _Lexer:
    def __init__(self, text: str, language: str) -> None:
        self.s = text
        self.n = len(text)
        self.i = 0
        self.line = 1
        self.lang = language
        self.js = language in ("TypeScript", "JavaScript")
        self.rust = language == "Rust"
        self.cpp = language in ("C", "C++")
        self.cs = language == "C#"
        self.java = language == "Java"
        self.go = language == "Go"
        self.toks: List[Tok] = []
        # template-literal expression stack (JS): brace depth inside each ${ ... }
        self.tpl: List[int] = []

    def _count_lines(self, a: int, b: int) -> None:
        self.line += self.s.count("\n", a, b)

    def _emit(self, kind: str, text: str, start_line: int) -> None:
        self.toks.append(Tok(kind, text, start_line, self.line))

    def run(self) -> List[Tok]:
        s = self.s
        at_line_start = True
        while self.i < self.n:
            c = s[self.i]
            if c == "\n":
                self.line += 1
                self.i += 1
                at_line_start = True
                continue
            if c in " \t\r\f\v":
                self.i += 1
                continue
            if at_line_start and c == "#" and (self.cpp or self.cs):
                self._skip_preprocessor()
                continue
            at_line_start = False
            if s.startswith("//", self.i):
                j = s.find("\n", self.i)
                self.i = self.n if j == -1 else j
                continue
            if s.startswith("/*", self.i):
                self._skip_block_comment()
                continue
            if self._string_start():
                continue
            if self.js and c == "/" and self._regex_allowed():
                if self._regex():
                    continue
            if self.js and c == "}" and self.tpl and self.tpl[-1] == 0:
                self.tpl.pop()
                self.i += 1
                self._template_body()
                continue
            if c.isdigit():
                m = NUMBER_RE.match(s, self.i)
                self._emit("num", m.group(0), self.line)
                self.i = m.end()
                continue
            if self.rust and s.startswith("r#", self.i) and IDENT_RE.match(s, self.i + 2):
                m = IDENT_RE.match(s, self.i + 2)
                self._emit("id", m.group(0), self.line)
                self.i = m.end()
                continue
            m = IDENT_RE.match(s, self.i)
            if m:
                self._emit("id", m.group(0), self.line)
                self.i = m.end()
                continue
            for p in PUNCT:
                if s.startswith(p, self.i):
                    self._emit("punct", p, self.line)
                    self.i += len(p)
                    break
            else:
                if self.js and self.tpl:
                    if c == "{":
                        self.tpl[-1] += 1
                    elif c == "}":
                        self.tpl[-1] -= 1
                self._emit("punct", c, self.line)
                self.i += 1
        if self.tpl:
            raise TokenizeError("unterminated template literal")
        return self.toks

    def _skip_preprocessor(self) -> None:
        s = self.s
        while self.i < self.n:
            j = s.find("\n", self.i)
            if j == -1:
                self.i = self.n
                return
            line = s[self.i:j].rstrip("\r")
            self.i = j + 1
            self.line += 1
            if not line.endswith("\\"):
                return

    def _skip_block_comment(self) -> None:
        s = self.s
        depth = 0
        i = self.i
        while i < self.n:
            if s.startswith("/*", i):
                depth += 1
                i += 2
                if not self.rust and depth > 1:
                    depth = 1
                continue
            if s.startswith("*/", i):
                depth -= 1
                i += 2
                if depth == 0:
                    self._count_lines(self.i, i)
                    self.i = i
                    return
                continue
            i += 1
        raise TokenizeError("unterminated block comment")

    def _scan_quoted(self, start: int, quote: str, escapes: bool = True,
                     doubled: bool = False) -> int:
        """Index just past the closing quote of a string whose body starts at `start`."""
        s = self.s
        i = start
        while i < self.n:
            ch = s[i]
            if escapes and ch == "\\":
                i += 2
                continue
            if ch == quote:
                if doubled and s.startswith(quote * 2, i):
                    i += 2
                    continue
                return i + 1
            i += 1
        raise TokenizeError("unterminated string")

    def _emit_string(self, end: int) -> None:
        start_line = self.line
        self._count_lines(self.i, end)
        self._emit("str", "STR", start_line)
        self.i = end

    def _string_start(self) -> bool:
        s = self.s
        i = self.i
        c = s[i]
        if self.java and s.startswith('"""', i):
            j = s.find('"""', i + 3)
            if j == -1:
                raise TokenizeError("unterminated text block")
            self._emit_string(j + 3)
            return True
        if self.rust:
            m = re.match(r'(br|r|b)(#*)"', s[i:i + 40]) if c in "rb" else None
            if m:
                prefix, hashes = m.group(1), m.group(2)
                body = i + m.end()
                if "r" in prefix:
                    close = '"' + hashes
                    j = s.find(close, body)
                    if j == -1:
                        raise TokenizeError("unterminated raw string")
                    self._emit_string(j + len(close))
                else:
                    self._emit_string(self._scan_quoted(body, '"'))
                return True
            if c == "b" and s.startswith("b'", i):
                m2 = RUST_CHAR_RE.match(s, i + 1)
                if m2:
                    self._emit_string(m2.end())
                    return True
            if c == "'":
                m2 = RUST_CHAR_RE.match(s, i)
                if m2:
                    self._emit_string(m2.end())
                    return True
                m3 = IDENT_RE.match(s, i + 1)
                if m3:  # lifetime or label
                    self._emit("id", "'" + m3.group(0), self.line)
                    self.i = m3.end()
                    return True
                return False
            if c == '"':
                self._emit_string(self._scan_quoted(i + 1, '"'))
                return True
            return False
        if self.cpp and c in "uULR":
            m = CPP_RAW_RE.match(s, i)
            if m:
                close = ")" + m.group(2) + '"'
                j = s.find(close, m.end())
                if j == -1:
                    raise TokenizeError("unterminated raw string")
                self._emit_string(j + len(close))
                return True
        if self.cs and c in "@$":
            m = re.match(r'(\$@|@\$|@|\$)"', s[i:i + 3])
            if m:
                verbatim = "@" in m.group(1)
                self._emit_string(self._scan_quoted(i + m.end(), '"', escapes=not verbatim,
                                                    doubled=verbatim))
                return True
        if self.go and c == "`":
            j = s.find("`", i + 1)
            if j == -1:
                raise TokenizeError("unterminated raw string")
            self._emit_string(j + 1)
            return True
        if self.js and c == "`":
            self.i += 1
            start_line = self.line
            self._template_body(start_line)
            return True
        if c in "\"'":
            self._emit_string(self._scan_quoted(i + 1, c))
            return True
        return False

    def _template_body(self, start_line: Optional[int] = None) -> None:
        """Scan template text from self.i up to the closing backtick or a `${`."""
        s = self.s
        line0 = self.line if start_line is None else start_line
        i = self.i
        while i < self.n:
            ch = s[i]
            if ch == "\\":
                i += 2
                continue
            if ch == "`":
                self._count_lines(self.i, i + 1)
                self.i = i + 1
                self._emit("str", "STR", line0)
                return
            if s.startswith("${", i):
                self._count_lines(self.i, i + 2)
                self.i = i + 2
                self._emit("str", "STR", line0)
                self.tpl.append(0)
                return
            i += 1
        raise TokenizeError("unterminated template literal")

    def _prev_significant(self) -> Optional[Tok]:
        return self.toks[-1] if self.toks else None

    def _regex_allowed(self) -> bool:
        prev = self._prev_significant()
        if prev is None:
            return True
        if prev.kind == "punct":
            return prev.text in REGEX_PREV
        if prev.kind == "id":
            return prev.text in REGEX_KEYWORDS
        return False

    def _regex(self) -> bool:
        s = self.s
        i = self.i + 1
        in_class = False
        while i < self.n:
            ch = s[i]
            if ch == "\n":
                return False  # a division after all
            if ch == "\\":
                i += 2
                continue
            if in_class:
                if ch == "]":
                    in_class = False
            elif ch == "[":
                in_class = True
            elif ch == "/":
                i += 1
                while i < self.n and (s[i].isalnum() or s[i] == "_"):
                    i += 1
                self._emit("str", "REGEX", self.line)
                self.i = i
                return True
            i += 1
        return False


# ---------------------------------------------------------------------------
# Brace languages: structure
# ---------------------------------------------------------------------------
CONTROL = {"if", "else", "for", "while", "do", "switch", "try", "catch", "finally"}
CONTROL_BY_LANG = {"Rust": {"match", "loop", "while", "for", "if", "else"},
                   "Go": {"select"}, "C#": {"foreach", "lock", "using", "fixed", "checked",
                                           "unchecked"},
                   "Java": {"synchronized"}}
DECISION_WORDS = {"if", "for", "while", "catch", "case", "foreach"}
DECISION_PUNCT = {"&&", "||", "??"}
NOT_FUNC_START = {"class", "struct", "enum", "interface", "namespace", "impl", "trait", "union",
                  "record", "object", "module", "extern"}
CLASS_START = {"class", "struct", "impl", "trait", "interface", "object"}
MODIFIERS = {"export", "default", "abstract", "public", "private", "protected", "internal",
             "static", "final", "sealed", "partial", "declare", "pub", "unsafe", "async",
             "virtual", "override", "readonly", "inline", "const", "constexpr", "open", "data"}
TRAILER_START = {":", "->", "const", "noexcept", "override", "final", "throws", "where",
                 "requires", "mut"}
TERNARY_NOT_BEFORE = {".", "?", ":", ")", ",", "=", ";", "]"}


class _Frame:
    __slots__ = ("kind", "func", "name", "paren")

    def __init__(self, kind: str, func: Optional[Dict[str, Any]], name: Optional[str],
                 paren: int) -> None:
        self.kind = kind          # function, control, class, other
        self.func = func          # the record opened by this brace (function frames)
        self.name = name          # class-like name for qualnames
        self.paren = paren        # the enclosing paren depth, restored on close


def _strip_modifiers(toks: List[Tok]) -> List[Tok]:
    out = list(toks)
    while out and out[0].kind == "id" and out[0].text in MODIFIERS:
        out = out[1:]
        if out and out[0].text == "(":  # pub(crate)
            depth = 0
            k = 0
            while k < len(out):
                if out[k].text == "(":
                    depth += 1
                elif out[k].text == ")":
                    depth -= 1
                    if depth == 0:
                        break
                k += 1
            out = out[k + 1:]
    while out and out[0].text == "@" and len(out) > 1:  # Java annotations
        out = out[2:]
    return out


def _paren_groups(toks: List[Tok]) -> List[Tuple[int, int]]:
    """(open index, close index) of each top-level (...) group."""
    groups: List[Tuple[int, int]] = []
    depth = 0
    start = -1
    for k, t in enumerate(toks):
        if t.text == "(":
            if depth == 0:
                start = k
            depth += 1
        elif t.text == ")":
            depth -= 1
            if depth == 0 and start >= 0:
                groups.append((start, k))
            if depth < 0:
                depth = 0
    return groups


def _count_params(toks: List[Tok], open_i: int, close_i: int) -> int:
    inner = toks[open_i + 1:close_i]
    if not inner or [t.text for t in inner] == ["void"]:
        return 0
    depth = 0
    commas = 0
    for t in inner:
        if t.text in "([{":
            depth += 1
        elif t.text in ")]}":
            depth -= 1
        elif t.text == "," and depth == 0:
            commas += 1
    # a trailing comma adds no parameter
    if inner and inner[-1].text == ",":
        commas -= 1
    count = commas + 1
    first = [t.text for t in inner[:3]]
    if first and (first[0] == "self" or first[:2] == ["&", "self"]
                  or first[:3] == ["&", "mut", "self"] or first[:2] == ["mut", "self"]
                  or first[0] == "this"):
        count -= 1
    return max(count, 0)


def _name_before(toks: List[Tok], open_i: int) -> Optional[str]:
    k = open_i - 1
    if k >= 0 and toks[k].text == ">":  # skip a generic group <...>
        depth = 0
        while k >= 0:
            if toks[k].text == ">":
                depth += 1
            elif toks[k].text == "<":
                depth -= 1
                if depth == 0:
                    k -= 1
                    break
            k -= 1
    if k < 0:
        return None
    t = toks[k]
    if t.kind == "id":
        return t.text
    if t.kind == "punct" and k >= 1 and toks[k - 1].text == "operator":
        return "operator" + t.text
    return None


def _assigned_name(toks: List[Tok], upto: int) -> Optional[str]:
    """NAME in `const|let|var NAME =`, `NAME =` or `NAME:`: the first `=` or `:` outside
    brackets before index `upto`, preceded by an identifier."""
    depth = 0
    for k in range(min(upto, len(toks))):
        text = toks[k].text
        if text in ("(", "[", "{"):
            depth += 1
        elif text in (")", "]", "}"):
            depth = max(0, depth - 1)
        elif depth == 0 and text in ("=", ":") and k > 0 and toks[k - 1].kind == "id":
            return toks[k - 1].text
    return None


def _arrow_params(header: List[Tok], arrow: int) -> int:
    """Parameters of an arrow function whose `=>` sits at index `arrow`."""
    for k in range(arrow - 1, -1, -1):
        text = header[k].text
        if text == ")" and (k == arrow - 1 or header[k + 1].text == ":"):
            depth = 0
            for j in range(k, -1, -1):
                if header[j].text == ")":
                    depth += 1
                elif header[j].text == "(":
                    depth -= 1
                    if depth == 0:
                        return _count_params(header, j, k)
            return 0
        if text in ("=", "(", ",", "{", ";"):
            break
    if arrow >= 1 and header[arrow - 1].kind == "id" and (
            arrow < 2 or header[arrow - 2].text != ":"):
        return 1
    return 0


def _trailer_ok(rest: List[Tok]) -> bool:
    if not rest:
        return True
    return rest[0].text in TRAILER_START


class _FuncInfo:
    __slots__ = ("is_func", "name", "params", "closure")

    def __init__(self, is_func: bool, name: str = "<anonymous>", params: int = 0,
                 closure: bool = False) -> None:
        self.is_func = is_func
        self.name = name
        self.params = params
        self.closure = closure


def _classify_function(header: List[Tok], lang: str) -> _FuncInfo:
    if not header:
        return _FuncInfo(False)
    texts = [t.text for t in header]
    groups = _paren_groups(header)
    if lang in ("TypeScript", "JavaScript") and texts[-1] == "=>":
        arrow = len(header) - 1
        return _FuncInfo(True, _assigned_name(header, arrow) or "<anonymous>",
                         _arrow_params(header, arrow))
    if lang in ("TypeScript", "JavaScript") and "function" in texts:
        k = texts.index("function")
        name = None
        j = k + 1
        if j < len(header) and header[j].text == "*":
            j += 1
        if j < len(header) and header[j].kind == "id":
            name = header[j].text
        g = next((gg for gg in groups if gg[0] > k), None)
        params = _count_params(header, g[0], g[1]) if g else 0
        return _FuncInfo(True, name or _assigned_name(header, k) or "<anonymous>", params)
    if lang == "Rust":
        if "fn" in texts:
            k = texts.index("fn")
            name = header[k + 1].text if k + 1 < len(header) and header[k + 1].kind == "id" \
                else "<anonymous>"
            g = next((gg for gg in groups if gg[0] > k), None)
            params = _count_params(header, g[0], g[1]) if g else 0
            return _FuncInfo(True, name, params)
        info = _rust_closure(header)
        if info:
            return info
    if lang == "Go" and "func" in texts:
        k = texts.index("func")
        after = [gg for gg in groups if gg[0] > k]
        j = k + 1
        if after and after[0][0] == j:  # receiver
            j = after[0][1] + 1
            after = after[1:]
        name = header[j].text if j < len(header) and header[j].kind == "id" else "<anonymous>"
        g = after[0] if after else None
        params = _count_params(header, g[0], g[1]) if g else 0
        return _FuncInfo(True, name, params)
    stripped = _strip_modifiers(header)
    if stripped and stripped[0].kind == "id" and stripped[0].text in NOT_FUNC_START:
        return _FuncInfo(False)
    if not groups:
        return _FuncInfo(False)
    for open_i, close_i in groups:
        rest = header[close_i + 1:]
        if not _trailer_ok(rest):
            continue
        name = _name_before(header, open_i)
        if name is None or name in CONTROL or name in DECISION_WORDS:
            continue
        if name in ("return", "new", "throw", "await", "yield", "typeof", "sizeof"):
            continue
        return _FuncInfo(True, name, _count_params(header, open_i, close_i))
    return _FuncInfo(False)


def _rust_closure(header: List[Tok]) -> Optional[_FuncInfo]:
    texts = [t.text for t in header]
    k = len(texts)
    # optional `-> Type`
    if "->" in texts:
        k = len(texts) - 1 - texts[::-1].index("->")
    if k >= 1 and texts[k - 1] == "||":
        return _FuncInfo(True, "<closure>", 0, closure=True)
    if k >= 1 and texts[k - 1] == "|":
        j = k - 2
        while j >= 0 and texts[j] != "|":
            j -= 1
        if j >= 0:
            inner = header[j + 1:k - 1]
            params = 0
            if inner:
                depth = 0
                commas = 0
                for t in inner:
                    if t.text in "([{<":
                        depth += 1
                    elif t.text in ")]}>":
                        depth -= 1
                    elif t.text == "," and depth == 0:
                        commas += 1
                params = commas + 1
            return _FuncInfo(True, "<closure>", params, closure=True)
    return None


def _class_name(header: List[Tok]) -> Optional[str]:
    stripped = _strip_modifiers(header)
    if not stripped or stripped[0].text not in CLASS_START:
        return None
    rest = stripped[1:]
    texts = [t.text for t in rest]
    if stripped[0].text == "impl" and "for" in texts:
        rest = rest[texts.index("for") + 1:]
    depth = 0
    for t in rest:
        if t.text == "<":
            depth += 1
        elif t.text == ">":
            depth -= 1
        elif depth == 0 and t.kind == "id":
            return t.text
    return None


def _is_control(header: List[Tok], lang: str) -> bool:
    first = next((t for t in header if t.kind == "id"), None)
    if first is None:
        return False
    words = CONTROL | CONTROL_BY_LANG.get(lang, set())
    return first.text in words and header[0].kind == "id"


def _analyse_brace(rel: str, text: str, lang: str) -> Dict[str, Any]:
    result: Dict[str, Any] = {"path": rel, "language": lang, "parser": "brace-tokenizer",
                              "functions": [], "error": None, "blocks": []}
    try:
        toks = _Lexer(text, lang).run()
        records = _structure(toks, lang, result["blocks"])
    except TokenizeError:
        result["error"] = "unbalanced or unterminated tokens at EOF"
        result["blocks"] = []
        return result
    result["functions"] = records
    return result


def _structure(toks: List[Tok], lang: str, blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    rust = lang == "Rust"
    ternary_ok = lang not in ("Rust", "Go")
    stack: List[_Frame] = []
    pending: List[Tok] = []
    paren = 0
    records: List[Dict[str, Any]] = []

    def innermost_func() -> Optional[Dict[str, Any]]:
        for fr in reversed(stack):
            if fr.kind == "function":
                return fr.func
        return None

    def open_match(func: Dict[str, Any]) -> bool:
        for fr in reversed(stack):
            if fr.kind == "function":
                return False
            if fr.kind == "control" and fr.name == "match":
                return True
        return False

    def attribute(tokens: List[Tok], func: Optional[Dict[str, Any]]) -> None:
        if func is None:
            return
        in_match = rust and open_match(func)
        for idx, t in enumerate(tokens):
            func["_lines"].update(range(t.line, t.end_line + 1))
            if t.kind == "id" and t.text in DECISION_WORDS:
                func["_ccn"] += 1
            elif t.kind == "punct" and t.text in DECISION_PUNCT:
                if not (rust and t.text == "||" and func.get("_skip_pipes")):
                    func["_ccn"] += 1
            elif ternary_ok and t.kind == "punct" and t.text == "?":
                nxt = tokens[idx + 1].text if idx + 1 < len(tokens) else ""
                if nxt not in TERNARY_NOT_BEFORE:
                    func["_ccn"] += 1
            elif rust and t.kind == "id" and t.text == "match":
                func["_match"] += 1
            elif in_match and t.kind == "punct" and t.text == "=>":
                func["_arms"] += 1

    for t in toks:
        if t.kind == "punct" and t.text == "(":
            paren += 1
            pending.append(t)
            continue
        if t.kind == "punct" and t.text == ")":
            paren = max(0, paren - 1)
            pending.append(t)
            continue
        if t.kind == "punct" and t.text == ";" and paren == 0:
            pending.append(t)
            attribute(pending, innermost_func())
            pending = []
            continue
        if t.kind == "punct" and t.text == "{":
            header = pending
            pending = []
            if _is_control(header, lang):
                kind = "control"
                first = next(x for x in header if x.kind == "id")
                frame = _Frame("control", None, first.text, paren)
                attribute(header + [t], innermost_func())
                func = innermost_func()
                if func is not None:
                    depth = 1 + sum(1 for fr in _frames_above_func(stack) if fr.kind == "control")
                    func["max_nesting"] = max(func["max_nesting"], depth)
            else:
                info = _classify_function(header, lang)
                if info.is_func:
                    kind = "function"
                    quals = [fr.name for fr in stack if fr.kind == "class" and fr.name]
                    enclosing = [fr.func["name"] for fr in stack if fr.kind == "function"]
                    qual = ".".join(quals + enclosing + [info.name])
                    rec = {"name": info.name, "qualname": qual,
                           "start_line": header[0].line if header else t.line,
                           "end_line": t.line, "nloc": 0, "ccn_estimate": 1, "max_nesting": 0,
                           "params": info.params, "_lines": set(), "_ccn": 0, "_match": 0,
                           "_arms": 0, "_skip_pipes": info.closure}
                    records.append(rec)
                    frame = _Frame("function", rec, info.name, paren)
                    attribute(header + [t], rec)
                    rec["_skip_pipes"] = False
                else:
                    cname = _class_name(header)
                    kind = "class" if cname else "other"
                    frame = _Frame(kind, None, cname, paren)
                    attribute(header + [t], innermost_func())
            blocks.append({"kind": kind, "start_line": header[0].line if header else t.line,
                           "end_line": None, "_frame": frame})
            stack.append(frame)
            paren = 0
            continue
        if t.kind == "punct" and t.text == "}":
            if not stack:
                raise TokenizeError("unbalanced '}'")
            pending.append(t)
            attribute(pending, innermost_func())
            pending = []
            frame = stack.pop()
            for b in reversed(blocks):
                if b.get("_frame") is frame:
                    b["end_line"] = t.line
                    b.pop("_frame")
                    break
            if frame.kind == "function" and frame.func is not None:
                frame.func["end_line"] = t.line
            paren = frame.paren
            continue
        pending.append(t)
    if stack:
        raise TokenizeError("unbalanced '{'")
    if pending:
        attribute(pending, None)
    out = []
    for rec in records:
        ccn = 1 + rec["_ccn"] + max(0, rec["_arms"] - rec["_match"])
        out.append({"name": rec["name"], "qualname": rec["qualname"],
                    "start_line": rec["start_line"], "end_line": rec["end_line"],
                    "nloc": len(rec["_lines"]), "ccn_estimate": ccn,
                    "max_nesting": rec["max_nesting"], "params": rec["params"]})
    return out


def _frames_above_func(stack: List[_Frame]) -> List[_Frame]:
    above: List[_Frame] = []
    for fr in reversed(stack):
        if fr.kind == "function":
            break
        above.append(fr)
    return above


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def language_for(path: str) -> Optional[str]:
    ext = os.path.splitext(path.lower())[1]
    if ext in PY_EXTS:
        return "Python"
    return LANG_BY_EXT.get(ext)


def code_lines(rel_path: str, text: str) -> Optional[Set[int]]:
    """Line numbers that hold code: at least one token other than a comment. Blank and
    comment-only lines are left out (e2e_reach.py, contract_check.py; pilot-auto-calibration
    A01-F48). None when the language is unsupported or the text does not tokenize."""
    text = text.lstrip(chr(0xFEFF)).replace("\r\n", "\n").replace("\r", "\n")
    lang = language_for(rel_path)
    if lang == "Python":
        return _python_code_lines(text)
    if lang is None:
        return None
    try:
        toks = _Lexer(text, lang).run()
    except TokenizeError:
        return None
    lines: Set[int] = set()
    for tok in toks:
        lines.update(range(tok.line, tok.end_line + 1))
    return lines


def analyse_text(rel_path: str, text: str) -> Dict[str, Any]:
    """Per-file result for text already read. Keys: path, language, parser, functions, error,
    and blocks (spans of functions, classes and other brace blocks, for e2e_reach.py).
    CRLF and CR line ends and a leading BOM are normalised first."""
    text = text.lstrip(chr(0xFEFF)).replace("\r\n", "\n").replace("\r", "\n")
    lang = language_for(rel_path)
    if lang == "Python":
        return _analyse_python(rel_path, text)
    if lang is None:
        return {"path": rel_path, "language": None, "parser": None, "functions": [],
                "error": "unsupported language", "blocks": []}
    return _analyse_brace(rel_path, text, lang)


def candidates(files: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for f in files:
        for fn in f.get("functions", []):
            trig = []
            if fn["max_nesting"] > TRIGGERS["max_nesting"]:
                trig.append("max_nesting>3")
            if fn["ccn_estimate"] > TRIGGERS["ccn_estimate"]:
                trig.append("ccn_estimate>10")
            if fn["nloc"] > TRIGGERS["nloc"]:
                trig.append("nloc>60")
            if fn["params"] >= TRIGGERS["params"]:
                trig.append("params>=7")
            if trig:
                row = dict(fn)
                row["path"] = f["path"]
                row["triggers"] = trig
                out.append(row)
    out.sort(key=lambda r: (-len(r["triggers"]), -r["max_nesting"], -r["ccn_estimate"],
                            -r["nloc"], r["path"], r["start_line"]))
    return out


def read_list(path: Path) -> List[str]:
    try:
        text = path.read_bytes().decode("utf-8-sig", errors="replace")
    except OSError as exc:
        raise UsageError("cannot read {}: {}".format(path, exc)) from exc
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line.replace("\\", "/"))
    return out


def _repo_top(start: Path) -> Path:
    top = C.git_ok(start, ["rev-parse", "--show-toplevel"]) if C.git_available() else None
    return Path(top).resolve() if top else start.resolve()


def run(paths: Sequence[str], repo: Path, max_bytes: int) -> Dict[str, Any]:
    files: List[Dict[str, Any]] = []
    skipped: List[Dict[str, str]] = []
    seen: Set[str] = set()
    top = str(repo.resolve())
    for raw in paths:
        p = Path(raw.replace("\\", "/"))
        absolute = p if p.is_absolute() else Path(top) / p
        try:
            real = os.path.realpath(str(absolute))
            rel = os.path.relpath(real, os.path.realpath(top))
        except ValueError:
            skipped.append({"path": C.to_posix(raw), "reason": "outside repository"})
            continue
        rel = C.to_posix(rel)
        if rel.startswith("../") or rel == ".." or os.path.isabs(rel):
            skipped.append({"path": C.to_posix(raw), "reason": "outside repository"})
            continue
        if rel in seen:
            continue
        seen.add(rel)
        ext = os.path.splitext(rel.lower())[1]
        if ext in JSX_EXTS:
            skipped.append({"path": rel, "reason": "JSX: not supported by the heuristic tokenizer"})
            continue
        if language_for(rel) is None:
            skipped.append({"path": rel, "reason": "unsupported language"})
            continue
        try:
            size = os.path.getsize(real)
            if size > max_bytes:
                skipped.append({"path": rel, "reason": "over --max-bytes"})
                continue
            data = Path(real).read_bytes()
        except OSError as exc:
            skipped.append({"path": rel, "reason": "unreadable: {}".format(exc)})
            continue
        text = data.decode("utf-8-sig", errors="replace")
        result = analyse_text(rel, text)
        result.pop("blocks", None)
        files.append(result)
    cands = candidates(files)
    return {"tool": "complexity.py", "version": VERSION, "heuristic": True, "method": METHOD,
            "generated": C.utc_iso(), "repo": C.to_posix(top),
            "triggers": dict(TRIGGERS, source=TRIGGER_SOURCE), "files": files,
            "skipped": skipped, "candidates": cands,
            "summary": {"files": len(files),
                        "functions": sum(len(f["functions"]) for f in files),
                        "errors": sum(1 for f in files if f["error"]),
                        "skipped": len(skipped), "candidates": len(cands)}}


def write_csv(path: Path, result: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        w = csv.writer(handle, lineterminator="\n")
        w.writerow(["nloc", "ccn_estimate", "params", "max_nesting", "name", "start_line",
                    "end_line", "path"])
        for f in result["files"]:
            for fn in f["functions"]:
                w.writerow([fn["nloc"], fn["ccn_estimate"], fn["params"], fn["max_nesting"],
                            fn["qualname"], fn["start_line"], fn["end_line"], f["path"]])


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        prog="complexity.py",
        description="Offline heuristic complexity metrics per function (a fallback for lizard).")
    parser.add_argument("files", nargs="*", help="files to analyse (repository-relative or absolute)")
    parser.add_argument("--files-from", help="a file listing paths, one per line")
    parser.add_argument("--repo", help="repository root (default: the git top level, else cwd)")
    parser.add_argument("--out", help="output JSON (default .harden/tools/complexity.json; - prints)")
    parser.add_argument("--csv", help="also write a CSV table here")
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES,
                        help="skip larger files (default 1000000)")
    parser.add_argument("--json", action="store_true", help="print the summary as JSON")
    args = parser.parse_args(argv)
    try:
        repo = Path(args.repo).resolve() if args.repo else _repo_top(Path.cwd())
        paths: List[str] = list(args.files)
        if args.files_from:
            paths += read_list(Path(args.files_from))
        elif not args.files:
            default = repo / ".harden" / "tools" / "inscope.txt"
            if not default.is_file():
                raise UsageError("give files or --files-from")
            paths += read_list(default)
    except UsageError as exc:
        print("complexity.py: {}".format(exc), file=sys.stderr)
        return 2
    result = run(paths, repo, args.max_bytes)
    out = args.out or str(repo / ".harden" / "tools" / "complexity.json")
    if out == "-":
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        C.write_json(Path(out), result)
        if args.json:
            print(json.dumps(result["summary"], indent=2))
        else:
            s = result["summary"]
            print("complexity.py: {} files, {} functions, {} candidates, {} errors, {} skipped "
                  "-> {}".format(s["files"], s["functions"], s["candidates"], s["errors"],
                                 s["skipped"], out))
    if args.csv:
        write_csv(Path(args.csv), result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
