#!/usr/bin/env python3
"""State, per changed production file, what the end-to-end checks showed about its changed code.

Purpose
    A green end-to-end verdict proves only what the checks exercise. In the autonomous pilot
    both e2e checks passed while none of them ran the changed code (pilot-auto-calibration
    A01-F21). For each production file the applied range changed, this script states the
    strongest evidence that a profile `e2e` check exercised the changed code, best first:
      executed                     every changed function ran under some check (V8 coverage by
                                   function name, merged across the checks, a constructor under
                                   its class name; coverage.py's executed lines inside the
                                   function's body), or, with no changed function, changed
                                   top-level code ran when the module loaded
      partly-executed              some changed functions ran, not all (or a changed block
                                   outside functions could not be attributed)
      loaded-execution-not-shown   the file was loaded, but the changed code sits in a block
                                   the heuristic parser does not recognise (a class body outside
                                   its methods), or several functions share its name
      loaded-not-executed          the file was loaded and no changed function ran; a changed
                                   import or top-level statement only shows the module loaded
      no-runtime-change            only comments, blank lines or type declarations changed
                                   (decided before the checks)
      imported                     a check's entry point imports it (static, execution not
                                   shown)
      not-loaded                   coverage was written and the file is not in it
      not-reached                  the entry point's import graph does not reach it
      not-shown                    no coverage, no entry, or no graph (the reason is given)
    Blank and comment-only changed lines are not changes; a pure deletion counts at its
    position. The summary's headline reads "e2e executed <n> of <m> changed modules, <f> of
    <F> changed functions": a module counts only when every changed function in it ran
    (pilot-auto-calibration A01-F48); each file record lists function_results
    ({"name", "ran", "by"}), ran null when ambiguous.
    V8 coverage comes from `verify_branch.py --e2e-coverage` (its `e2e_coverage` records in
    .harden/verify.json, mapped relative to the verifier's clone) or --coverage; a script
    path through node_modules never counts. Changed functions come from complexity.py's
    per-function spans and are matched by name, at file level, without source maps: a
    heuristic, not a proof. Static reachability uses ts_program.py's module graph (TS/JS) and
    Python's `ast` import graph.

CLI
    python e2e_reach.py --base SHA [--head REV] [--repo DIR] [--profile FILE] [--verify FILE]
                        [--ts-program FILE] [--coverage NAME=PATH ...] [--out FILE|-] [--json]
    (use python3 on macOS/Linux)
    --head        default HEAD
    --profile     default .harden/profile.json (its `e2e` checks)
    --verify      default .harden/verify.json (its `e2e_coverage` records)
    --ts-program  default .harden/tools/ts-program.final.json, else .harden/tools/ts-program.json
    --coverage    NAME=PATH: a V8 coverage directory (coverage-*.json) or a coverage.py JSON
                  report for the check NAME, in addition to verify.json's records
    --out         default .harden/tools/e2e-reach.json; '-' prints the JSON
    --json        print the JSON instead of the Markdown lines

Exit codes
    0  ran (an empty diff included: "e2e executed 0 of 0 changed modules")
    2  usage error: a bad base or head, not a git repository, a malformed --coverage, or an
       unreadable JSON input
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shlex
import subprocess
import sys
from collections import deque
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import unquote

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)
import complexity as CX  # noqa: E402

VERSION = 2
ORDER = ("executed", "partly-executed", "loaded-execution-not-shown", "loaded-not-executed",
         "imported", "not-loaded", "not-reached", "not-shown")
# A top-level TypeScript/JavaScript statement that emits no code (pilot-auto-calibration A01-F48).
DECL_HEAD_RE = re.compile(r"^(?:export\s+)?(?:default\s+)?(?:declare\b|interface\b|"
                          r"type\s+[A-Za-z_$]|import\s+type\b|export\s+type\b)")
STMT_HEADS = {"import", "export", "const", "let", "var", "function", "class", "interface",
              "type", "declare", "enum", "namespace", "module", "abstract", "async", "if",
              "for", "while", "do", "try", "switch", "return", "throw"}
CLASS_LINE_RE = re.compile(r"\bclass\s+([A-Za-z_$][\w$]*)")
TS_EXTS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
NODE_RUNNERS = {"node", "nodejs", "tsx", "ts-node", "bun", "deno"}
PY_RUNNERS = {"python", "python3", "py", "pypy3"}
NODE_VALUE_OPTS = {"-r", "--require", "--import", "--loader", "--env-file",
                   "--experimental-loader", "-C", "--conditions"}
NODE_INLINE = {"-e", "--eval", "-p", "--print"}
PY_VALUE_OPTS = {"-X", "-W", "-Q"}
UV_VALUE_OPTS = {"--with", "--python", "-p", "--project", "--directory", "--package",
                 "--extra", "--group", "--index", "--env-file"}
ENV_ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
HUNK_RE = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", re.M)
NO_COVERAGE_NOTE = "no coverage written (a process that exits abnormally may write none)"


class UsageError(Exception):
    """Bad arguments or input (exit 2)."""


# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------
def git(repo: Path, args: Sequence[str], data: Optional[bytes] = None) -> Tuple[int, bytes]:
    cmd = ["git", "-c", "core.quotepath=false", "-c", "color.ui=never"] + list(args)
    try:
        proc = subprocess.run(cmd, cwd=str(repo), input=data, capture_output=True,
                              env=C.git_env(), timeout=300)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 128, str(exc).encode("utf-8")
    return proc.returncode, proc.stdout


def read_blobs(repo: Path, rev: str, paths: Sequence[str]) -> Dict[str, str]:
    """Text of each path at `rev` (missing paths are left out), in one git process."""
    if not paths:
        return {}
    request = "".join("{}:{}\n".format(rev, p) for p in paths).encode("utf-8")
    code, out = git(repo, ["cat-file", "--batch"], request)
    if code != 0:
        return {}
    result: Dict[str, str] = {}
    pos = 0
    for path in paths:
        nl = out.find(b"\n", pos)
        if nl == -1:
            break
        header = out[pos:nl].decode("utf-8", errors="replace").split()
        pos = nl + 1
        if len(header) < 3 or header[1] == "missing":
            continue
        size = int(header[2])
        result[path] = out[pos:pos + size].decode("utf-8", errors="replace")
        pos += size + 1
    return result


def hunk_ranges(diff_text: str) -> List[List[int]]:
    """New-side changed line ranges of a -U0 diff (a pure deletion marks the line after it)."""
    ranges: List[List[int]] = []
    for m in HUNK_RE.finditer(diff_text):
        start = int(m.group(1))
        count = int(m.group(2)) if m.group(2) is not None else 1
        if count == 0:
            line = max(start, 1)
            ranges.append([line, line])
        else:
            ranges.append([start, start + count - 1])
    return ranges


def changed_files(repo: Path, base: str, head: str,
                  test_globs: Sequence[str]) -> List[Dict[str, str]]:
    code, out = git(repo, ["diff", "--name-status", "-z", "--no-renames", base, head])
    if code != 0:
        raise UsageError("git diff {}..{} failed".format(base, head))
    parts = [p for p in out.decode("utf-8", errors="replace").split("\0") if p]
    result: List[Dict[str, str]] = []
    for status, path in zip(parts[0::2], parts[1::2]):
        path = C.to_posix(path)
        lang = C.language_of(path)
        if not C.is_source_language(lang) or C.is_doc_path(path):
            continue
        if C.is_test_path(path) or (test_globs and C.match_any(path, test_globs)):
            continue
        result.append({"path": path, "language": lang or "",
                       "status": "deleted" if status.startswith("D") else "changed"})
    return result


# ---------------------------------------------------------------------------
# What changed inside a file
# ---------------------------------------------------------------------------
def deletion_anchors(diff_text: str) -> Set[int]:
    """The new-side lines that stand for a pure deletion in a -U0 diff (hunk_ranges marks
    them); they count even when blank or a comment, because the deleted lines were not."""
    anchors: Set[int] = set()
    for m in HUNK_RE.finditer(diff_text):
        if m.group(2) is not None and int(m.group(2)) == 0:
            anchors.add(max(int(m.group(1)), 1))
    return anchors


def toplevel_statements(path: str, text: str) -> List[Tuple[int, int, str]]:
    """(first line, last line, the first four tokens joined by spaces) of each top-level
    statement of a TypeScript or JavaScript file; [] for other languages or a lexer error
    (contract_check.py uses the heads to leave import statements out)."""
    lang = CX.language_for(path)
    if lang not in ("TypeScript", "JavaScript"):
        return []
    try:
        toks = CX._Lexer(text, lang).run()
    except CX.TokenizeError:
        return []
    stmts: List[List[Any]] = []
    cur: List[Any] = []
    depth = 0
    for tok in toks:
        if depth == 0 and cur and ((cur[-1].kind == "punct" and cur[-1].text in (";", "}"))
                                   or (tok.line > cur[-1].end_line and tok.kind == "id"
                                       and tok.text in STMT_HEADS)):
            stmts.append(cur)
            cur = []
        cur.append(tok)
        if tok.kind == "punct" and tok.text in ("{", "(", "["):
            depth += 1
        elif tok.kind == "punct" and tok.text in ("}", ")", "]"):
            depth = max(0, depth - 1)
    if cur:
        stmts.append(cur)
    return [(stmt[0].line, stmt[-1].end_line, " ".join(t.text for t in stmt[:4]))
            for stmt in stmts]


def toplevel_kinds(path: str, text: str) -> Dict[int, str]:
    """Line -> "declaration" (import type, type alias, interface, declare) or "code" for the
    top-level statements of a TypeScript or JavaScript file; {} for other languages."""
    kinds: Dict[int, str] = {}
    for first, last, head in toplevel_statements(path, text):
        kind = "declaration" if DECL_HEAD_RE.match(head) else "code"
        for line in range(first, last + 1):
            kinds.setdefault(line, kind)
    return kinds


def changed_units(path: str, text: Optional[str], ranges: Sequence[Sequence[int]],
                  anchors: Optional[Set[int]] = None) -> Dict[str, Any]:
    """What changed inside a file, from the changed lines of its new text:
      functions     changed functions, innermost, by name (V8 and coverage.py report each
                    function on its own)
      spans         name -> [start, end] of each changed function
      v8_names      name -> the name V8 reports when it differs (a constructor: its class)
      toplevel      executable top-level code changed (it runs when the module loads)
      toplevel_lines those lines
      declarations  top-level lines that emit no code changed (types, interfaces, declare)
      unrecognised  a changed line sits in a block the parser cannot attribute (a class body
                    outside its methods, an unparsable file)
    Blank and comment-only lines are not changes (pilot-auto-calibration A01-F48); a pure
    deletion's anchor line (`anchors`) always counts."""
    out: Dict[str, Any] = {"functions": [], "spans": {}, "v8_names": {}, "toplevel": False,
                           "toplevel_lines": [], "declarations": False, "unrecognised": False,
                           "duplicates": {}}
    if text is None:
        out["unrecognised"] = bool(ranges)
        return out
    text = text.lstrip(chr(0xFEFF)).replace("\r\n", "\n").replace("\r", "\n")
    analysis = CX.analyse_text(path, text)
    funcs = analysis.get("functions") or []
    counts: Dict[str, int] = {}
    for f in funcs:
        counts[f["name"]] = counts.get(f["name"], 0) + 1
    out["duplicates"] = {k: v for k, v in counts.items() if v > 1}
    if analysis.get("error"):
        out["unrecognised"] = bool(ranges)
        return out
    code = CX.code_lines(path, text)
    anchors = anchors or set()
    python = analysis.get("language") == "Python"
    kinds = {} if python else toplevel_kinds(path, text)
    blocks = analysis.get("blocks") or []
    classes = [b for b in blocks if b.get("kind") == "class"]
    source_lines = text.split("\n")
    names: List[str] = []
    for start, end in ranges:
        for line in range(int(start), int(end) + 1):
            if code is not None and line not in code and line not in anchors:
                continue  # blank or comment-only: nothing to execute
            inner = [f for f in funcs if f["start_line"] <= line <= f["end_line"]]
            if inner:
                best = min(inner, key=lambda f: f["end_line"] - f["start_line"])
                if best["name"] not in names:
                    names.append(best["name"])
                    out["spans"][best["name"]] = [best["start_line"], best["end_line"]]
                    if best["name"] == "constructor":
                        owner = [b for b in classes
                                 if b["start_line"] <= best["start_line"] <= b["end_line"]]
                        if owner:
                            head = source_lines[min(owner, key=lambda b: b["end_line"] -
                                                    b["start_line"])["start_line"] - 1]
                            match = CLASS_LINE_RE.search(head)
                            if match:
                                out["v8_names"][best["name"]] = match.group(1)
                continue
            if python:
                out["toplevel"] = True  # module level or class body: runs at import
                out["toplevel_lines"].append(line)
                continue
            if kinds.get(line) == "declaration":
                out["declarations"] = True
                continue
            if any(b["start_line"] <= line <= b["end_line"] for b in classes):
                out["unrecognised"] = True  # a class body runs at construction, not at load
                continue
            if kinds.get(line) == "code" or not any(
                    b.get("start_line") is not None and b.get("end_line") is not None
                    and b["start_line"] <= line <= b["end_line"] for b in blocks):
                out["toplevel"] = True
                out["toplevel_lines"].append(line)
            else:
                out["unrecognised"] = True
    out["functions"] = names
    return out


# ---------------------------------------------------------------------------
# Entry points of a check command
# ---------------------------------------------------------------------------
class Project:
    """What entry resolution needs to know about the repository at head."""

    def __init__(self, repo: Path, files: Sequence[str], emitted: Dict[str, List[str]],
                 package_json: Optional[Dict[str, Any]], pyproject: Optional[Dict[str, Any]]):
        self.repo = repo
        self.files = set(files)
        self.folded = {f.lower(): f for f in files}
        self.emitted_rev: Dict[str, str] = {}
        for src, outs in (emitted or {}).items():
            for o in outs:
                self.emitted_rev[o] = src
        self.package_json = package_json or {}
        self.pyproject = pyproject or {}

    def source_of(self, rel: str) -> Optional[str]:
        rel = C.to_posix(rel)
        while rel.startswith("./"):
            rel = rel[2:]
        if rel in self.files:
            return rel
        if rel in self.emitted_rev:
            return self.emitted_rev[rel]
        if os.name == "nt" and rel.lower() in self.folded:
            return self.folded[rel.lower()]
        return None

    def module_file(self, mod: str) -> Optional[str]:
        base = mod.replace(".", "/")
        for root in ("", "src/"):
            for cand in (base + ".py", base + "/__init__.py", base + "/__main__.py"):
                if root + cand in self.files:
                    return root + cand
        return None

    def bin_file(self, name: str) -> Optional[str]:
        bins = self.package_json.get("bin")
        if isinstance(bins, str) and name == self.package_json.get("name"):
            return self.source_of(bins)
        if isinstance(bins, dict) and isinstance(bins.get(name), str):
            return self.source_of(bins[name])
        return None

    def script(self, name: str) -> Optional[str]:
        scripts = self.package_json.get("scripts")
        if isinstance(scripts, dict) and isinstance(scripts.get(name), str):
            return scripts[name]
        return None

    def project_script(self, name: str) -> Optional[str]:
        proj = self.pyproject.get("project") if isinstance(self.pyproject, dict) else None
        scripts = proj.get("scripts") if isinstance(proj, dict) else None
        if isinstance(scripts, dict) and isinstance(scripts.get(name), str):
            return self.module_file(scripts[name].split(":", 1)[0].strip())
        return None


def _tokens(cmd: Any) -> Optional[List[str]]:
    if isinstance(cmd, list):
        return [str(t) for t in cmd]
    if not isinstance(cmd, str):
        return None
    try:
        return shlex.split(cmd, posix=True)
    except ValueError:
        return None


def _prog(token: str) -> str:
    name = C.to_posix(token).rsplit("/", 1)[-1].lower()
    for suffix in (".exe", ".cmd", ".bat"):
        if name.endswith(suffix):
            name = name[:-len(suffix)]
    return name


def entry_files(cmd: Any, project: Project, depth: int = 0) -> Tuple[List[str], str, Optional[str]]:
    """(entry source files, note, language) of a check command."""
    tokens = _tokens(cmd)
    if tokens is None:
        return [], "entry not resolved from the command (unparsable)", None
    cut = [i for i, t in enumerate(tokens) if t in ("&&", "||", ";", "|")]
    if cut:
        tokens = tokens[:cut[0]]
    while tokens and ENV_ASSIGN_RE.match(tokens[0]):
        tokens = tokens[1:]
    if not tokens:
        return [], "entry not resolved from the command (empty)", None
    prog = _prog(tokens[0])
    rest = tokens[1:]
    if prog in NODE_RUNNERS or prog in PY_RUNNERS or re.match(r"python3?\.\d+$", prog):
        python = prog in PY_RUNNERS or prog.startswith("python")
        if prog == "deno" and rest[:1] == ["run"]:
            rest = rest[1:]
        if prog == "bun" and rest[:1] == ["run"]:
            rest = rest[1:]
        k = 0
        while k < len(rest):
            tok = rest[k]
            if python and tok == "-m" and k + 1 < len(rest):
                mod = project.module_file(rest[k + 1])
                return ([mod], "python -m {}".format(rest[k + 1]), "Python") if mod else \
                    ([], "entry not resolved from the command (module {} not found)".format(
                        rest[k + 1]), "Python")
            if tok in NODE_INLINE or (python and tok == "-c"):
                return [], "entry not resolved from the command (inline code)", \
                    "Python" if python else "JavaScript"
            if tok.startswith("-"):
                if "=" not in tok and (tok in NODE_VALUE_OPTS or (python and tok in PY_VALUE_OPTS)):
                    k += 2
                else:
                    k += 1
                continue
            src = project.source_of(tok)
            if src:
                return [src], "script {}".format(tok), "Python" if python else "JavaScript"
            if prog == "bun" and depth < 3 and project.script(tok):
                return entry_files(project.script(tok), project, depth + 1)
            return [], "entry not resolved from the command ({} not tracked)".format(tok), \
                "Python" if python else "JavaScript"
        return [], "entry not resolved from the command (no script)", None
    if prog == "uv" and rest[:1] == ["run"]:
        k = 1
        while k < len(rest) and rest[k].startswith("-"):
            k += 2 if (rest[k] in UV_VALUE_OPTS and "=" not in rest[k]) else 1
        return entry_files(rest[k:], project, depth + 1) if k < len(rest) else \
            ([], "entry not resolved from the command (uv run without a command)", None)
    if prog in ("pnpm", "yarn", "npm", "bun"):
        if prog in ("pnpm", "yarn") and rest[:1] == ["exec"] and len(rest) > 1:
            found = project.bin_file(rest[1])
            return ([found], "bin {}".format(rest[1]), "JavaScript") if found else \
                ([], "entry not resolved from the command (external bin {})".format(rest[1]), None)
        name = None
        if rest[:1] == ["run"] and len(rest) > 1:
            name = rest[1]
        elif prog == "npm" and rest[:1] in (["test"], ["start"]):
            name = rest[0]
        elif prog != "npm" and rest:
            name = rest[0]
        if name and depth < 3 and project.script(name):
            return entry_files(project.script(name), project, depth + 1)
        if name and prog == "yarn":
            found = project.bin_file(name)
            if found:
                return [found], "bin {}".format(name), "JavaScript"
        return [], "entry not resolved from the command (script {} not found)".format(name), None
    if prog == "npx" and rest:
        found = project.bin_file(rest[0])
        return ([found], "bin {}".format(rest[0]), "JavaScript") if found else \
            ([], "entry not resolved from the command (external bin {})".format(rest[0]), None)
    if prog == "cargo" and rest[:1] == ["run"] or C.to_posix(tokens[0]).startswith(
            ("target/", "./target/")):
        return [], ("Rust binaries link the whole crate: import reachability not computed"), \
            "Rust"
    for tok in tokens:
        src = project.source_of(tok)
        if src:
            return [src], "path {}".format(tok), C.language_of(src)
    found = project.project_script(tokens[0]) or project.bin_file(tokens[0])
    if found:
        return [found], "script {}".format(tokens[0]), C.language_of(found)
    return [], "entry not resolved from the command", None


# ---------------------------------------------------------------------------
# Static reachability
# ---------------------------------------------------------------------------
def bfs(edges: Dict[str, Set[str]], roots: Iterable[str]) -> Set[str]:
    seen = set(roots)
    queue = deque(seen)
    while queue:
        cur = queue.popleft()
        for nxt in edges.get(cur, ()):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen


def ts_edges(ts_program: Optional[Dict[str, Any]]) -> Optional[Dict[str, Set[str]]]:
    if not ts_program or not isinstance(ts_program.get("edges"), list):
        return None
    graph: Dict[str, Set[str]] = {}
    for e in ts_program["edges"]:
        if isinstance(e, dict) and isinstance(e.get("from"), str) and isinstance(e.get("to"), str):
            graph.setdefault(e["from"], set()).add(e["to"])
    return graph


def _py_module_of(path: str) -> Tuple[str, str]:
    """(package root, dotted module) of a .py path."""
    root = "src/" if path.startswith("src/") else ""
    rel = path[len(root):]
    mod = rel[:-3].replace("/", ".")
    if mod.endswith(".__init__"):
        mod = mod[:-9]
    return root, mod


def python_edges(files: Dict[str, str]) -> Dict[str, Set[str]]:
    """Import graph of Python files (path -> text), resolved against the repository root and
    src/: absolute and relative imports, `from pkg import name` as pkg/name.py, and
    importlib.import_module("literal")."""
    tracked = set(files)

    def resolve(mod: str) -> List[str]:
        out: List[str] = []
        parts = [p for p in mod.split(".") if p]
        if not parts:
            return out
        for root in ("", "src/"):
            base = root + "/".join(parts)
            for cand in (base + ".py", base + "/__init__.py"):
                if cand in tracked:
                    out.append(cand)
            for i in range(1, len(parts)):
                init = root + "/".join(parts[:i]) + "/__init__.py"
                if init in tracked and out:
                    out.append(init)
        return out

    graph: Dict[str, Set[str]] = {}
    for path, text in files.items():
        try:
            tree = ast.parse(text)
        except (SyntaxError, ValueError):
            continue
        root, mod = _py_module_of(path)
        package = mod if path.endswith("__init__.py") else mod.rpartition(".")[0]
        targets: Set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    targets.update(resolve(alias.name))
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    parts = package.split(".") if package else []
                    keep = len(parts) - (node.level - 1)
                    base_parts = parts[:max(keep, 0)]
                    base = ".".join(base_parts + ([node.module] if node.module else []))
                else:
                    base = node.module or ""
                found = resolve(base) if base else []
                targets.update(found)
                for alias in node.names:
                    targets.update(resolve((base + "." if base else "") + alias.name))
            elif isinstance(node, ast.Call):
                func = node.func
                name = func.attr if isinstance(func, ast.Attribute) else \
                    func.id if isinstance(func, ast.Name) else ""
                if name == "import_module" and node.args and isinstance(node.args[0], ast.Constant) \
                        and isinstance(node.args[0].value, str):
                    targets.update(resolve(node.args[0].value))
        targets.discard(path)
        graph[path] = targets
    return graph


# ---------------------------------------------------------------------------
# Coverage
# ---------------------------------------------------------------------------
def url_to_path(url: str) -> Optional[str]:
    if not url.startswith("file:"):
        return None
    path = unquote(url[5:])
    while path.startswith("//"):
        path = path[1:]
    if re.match(r"^/[A-Za-z]:/", path):
        path = path[1:]
    return C.to_posix(path)


def _fold(p: str) -> str:
    return p.lower() if os.name == "nt" else p


def _has_node_modules(p: str) -> bool:
    return "node_modules" in p.split("/")


def map_script(abs_path: str, clone: Optional[str], project: Project) -> Optional[str]:
    """Repository source of a V8 script path, or None (outside the clone, node_modules)."""
    p = C.to_posix(abs_path)
    if clone:
        c = C.to_posix(clone).rstrip("/")
        if not _fold(p).startswith(_fold(c) + "/"):
            return None
        rel = p[len(c) + 1:]
        if _has_node_modules(rel):
            return None
        return project.source_of(rel)
    if _has_node_modules(p):
        return None
    segs = p.split("/")
    for k in range(len(segs)):
        cand = "/".join(segs[k:])
        found = project.source_of(cand)
        if found:
            return found
    return None


def read_v8_dir(path: Path, clone: Optional[str], project: Project
                ) -> Tuple[Dict[str, Dict[str, Any]], int]:
    """source -> {"loaded": bool, "executed": set(names)}, and the number of files read."""
    scripts: Dict[str, Dict[str, Any]] = {}
    files = sorted(path.glob("coverage-*.json")) if path.is_dir() else []
    for f in files:
        try:
            data = json.loads(f.read_bytes().decode("utf-8", errors="replace"))
        except (OSError, ValueError) as exc:
            raise UsageError("cannot read V8 coverage {}: {}".format(f, exc)) from exc
        for script in data.get("result") or [] if isinstance(data, dict) else []:
            abs_path = url_to_path(str(script.get("url") or ""))
            if not abs_path:
                continue
            src = map_script(abs_path, clone, project)
            if not src:
                continue
            rec = scripts.setdefault(src, {"loaded": False, "executed": set()})
            for fn in script.get("functions") or []:
                ranges = fn.get("ranges") or []
                if not ranges:
                    continue
                count = int(ranges[0].get("count") or 0)
                if fn.get("functionName") == "" and int(ranges[0].get("startOffset") or 0) == 0:
                    rec["loaded"] = rec["loaded"] or count > 0
                elif count > 0 and fn.get("functionName"):
                    rec["executed"].add(str(fn["functionName"]))
    return scripts, len(files)


def read_coveragepy(path: Path, project: Project) -> Dict[str, Set[int]]:
    try:
        data = json.loads(path.read_bytes().decode("utf-8-sig", errors="replace"))
    except (OSError, ValueError) as exc:
        raise UsageError("cannot read coverage.py JSON {}: {}".format(path, exc)) from exc
    out: Dict[str, Set[int]] = {}
    for raw, rec in (data.get("files") or {}).items() if isinstance(data, dict) else []:
        segs = C.to_posix(raw).split("/")
        for k in range(len(segs)):
            src = project.source_of("/".join(segs[k:]))
            if src:
                out.setdefault(src, set()).update(int(x) for x in rec.get("executed_lines") or [])
                break
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def parse_toml(text: str) -> Optional[Dict[str, Any]]:
    """A pyproject.toml as a dict (tomllib on 3.11+, _common's small reader before), or None."""
    try:
        import tomllib  # type: ignore[import-not-found]
        data = tomllib.loads(text)
    except ImportError:  # pragma: no cover - Python 3.9 and 3.10
        data = C._fallback_toml(text)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _load_json(path: Optional[Path], what: str, required: bool = False) -> Optional[Any]:
    if path is None or not path.is_file():
        if required:
            raise UsageError("{} {} not found".format(what, path))
        return None
    try:
        return C.read_json(path)
    except (OSError, ValueError) as exc:
        raise UsageError("cannot read {} {}: {}".format(what, path, exc)) from exc


def _resolve(repo: Path, raw: str) -> Path:
    p = Path(raw)
    return p if p.is_absolute() else repo / p


def function_rows(units: Dict[str, Any], ran_by: Dict[str, List[str]]) -> List[Dict[str, Any]]:
    """Per changed function: ran (True/False; None when ambiguous) and the checks that ran it."""
    rows: List[Dict[str, Any]] = []
    for name in units["functions"]:
        if units["duplicates"].get(name, 1) > 1 or name.startswith("<"):
            rows.append({"name": name, "ran": None, "by": []})
            continue
        by = ran_by.get(units["v8_names"].get(name, name), [])
        rows.append({"name": name, "ran": bool(by), "by": by})
    return rows


def status_from_rows(rows: List[Dict[str, Any]], units: Dict[str, Any], source: str,
                     toplevel_ran: bool) -> Tuple[str, str]:
    """A loaded file's status: executed only when every changed function ran (A01-F48)."""
    ran = [r["name"] for r in rows if r["ran"]]
    not_run = [r["name"] for r in rows if r["ran"] is False]
    ambiguous = [r["name"] for r in rows if r["ran"] is None]
    if rows:
        if ran and not not_run and not ambiguous and not units["unrecognised"]:
            return "executed", "{}, function{} {}".format(source, "" if len(ran) == 1 else "s",
                                                        ", ".join(ran))
        if ran:
            parts = ["ran: " + ", ".join(ran)]
            if not_run:
                parts.append("not run: " + ", ".join(not_run))
            if ambiguous:
                parts.append("ambiguous: " + ", ".join(ambiguous))
            if units["unrecognised"]:
                parts.append("a changed block outside functions not attributed")
            return "partly-executed", "{}, {}".format(source, "; ".join(parts))
        if ambiguous:
            name = ambiguous[0]
            count = units["duplicates"].get(name)
            return "loaded-execution-not-shown", \
                "execution ambiguous ({} functions named {})".format(count, name) if count \
                else "execution of {} not shown".format(name)
        if units["unrecognised"]:
            return "loaded-execution-not-shown", "changed functions not run: {}; a changed " \
                "block outside functions not attributed".format(", ".join(not_run))
        extra = "; changed top-level code ran at load" if toplevel_ran else ""
        return "loaded-not-executed", "{}; changed functions not run: {}{}".format(
            source, ", ".join(not_run), extra)
    if units["unrecognised"]:
        return "loaded-execution-not-shown", "execution of the changed block not shown"
    if toplevel_ran:
        return "executed", "{}, changed top-level code ran at load".format(source)
    return "loaded-not-executed", "{}; no changed line ran".format(source)


def evaluate_file(entry: Dict[str, Any], units: Dict[str, Any], checks: List[Dict[str, Any]]
                  ) -> Tuple[str, Optional[str], str, List[Dict[str, Any]]]:
    """(status, check name, detail, per-function rows) for one changed file. Coverage of all
    the checks that loaded the file is merged: a function counts as run when any check ran
    it, so two checks that each ran a different changed function make the file executed."""
    path = entry["path"]
    lines = sum(b - a + 1 for a, b in entry["changed_lines"])
    loaded = [c for c in checks if c.get("_v8") is not None
              and (c["_v8"].get(path) or {}).get("loaded")]
    if loaded:
        ran_by: Dict[str, List[str]] = {}
        for check in loaded:
            for name in sorted(check["_v8"][path]["executed"]):
                ran_by.setdefault(name, []).append(check["name"])
        rows = function_rows(units, ran_by)
        status, detail = status_from_rows(rows, units, "V8", units["toplevel"])
        by = next((r["by"][0] for r in rows if r["by"]), loaded[0]["name"])
        return status, by, detail, rows
    covs = [c for c in checks if c.get("_covpy") is not None and path in c["_covpy"]]
    if covs:
        ran_by = {}
        for name in units["functions"]:
            start, end = units["spans"].get(name, [0, -1])
            for check in covs:
                if any(ln in check["_covpy"][path] for ln in range(start + 1, end + 1)):
                    ran_by.setdefault(name, []).append(check["name"])
        executed = set().union(*(c["_covpy"][path] for c in covs))
        rows = function_rows(dict(units, v8_names={}), ran_by)
        toplevel_ran = any(ln in executed for ln in units["toplevel_lines"])
        status, detail = status_from_rows(rows, units, "coverage.py", toplevel_ran)
        changed = {ln for a, b in entry["changed_lines"] for ln in range(a, b + 1)}
        detail += "; {} of {} changed lines ran".format(len(changed & executed), lines)
        by = next((r["by"][0] for r in rows if r["by"]), covs[0]["name"])
        return status, by, detail, rows
    best: Optional[Tuple[int, Optional[str], str]] = None
    for check in checks:
        status, detail = check_status(path, entry, units, lines, check)
        rank = ORDER.index(status)
        if best is None or rank < best[0]:
            best = (rank, check["name"], detail)
    rows = [{"name": n, "ran": False, "by": []} for n in units["functions"]]
    if best is None:
        return "not-shown", None, "no e2e check could show it", rows
    return ORDER[best[0]], best[1], best[2], rows


def check_status(path: str, entry: Dict[str, Any], units: Dict[str, Any], lines: int,
                 check: Dict[str, Any]) -> Tuple[str, str]:
    """The status one check gives a file it did not load (evaluate_file handles loaded files)."""
    v8 = check.get("_v8")
    if v8 is not None:
        return "not-loaded", "coverage written, file not loaded"
    covpy = check.get("_covpy")
    if covpy is not None:
        return "not-loaded", "coverage.py report, file absent"
    graph = check.get("_graph")
    entries = check.get("entry") or []
    if check.get("language") == "Rust":
        return "not-shown", check.get("entry_note") or "Rust"
    if not entries:
        return "not-shown", check.get("entry_note") or "entry not resolved from the command"
    if graph is None:
        return "not-shown", check.get("_graph_note") or "no import graph"
    lang = entry.get("language")
    graph_langs = check.get("_graph_langs") or set()
    if lang not in graph_langs:
        return "not-shown", "the entry's import graph does not cover {}".format(lang)
    reached = bfs(graph, entries)
    if path in reached:
        return "imported", "entry {}".format(entries[0])
    return "not-reached", "not reached from {}".format(entries[0])


def bullet(f: Dict[str, Any]) -> str:
    s, by, detail = f["status"], f["by"], f["detail"]
    if s == "deleted":
        return "- {}: deleted".format(f["path"])
    if s == "executed":
        return "- {}: executed by {} ({})".format(f["path"], by, detail)
    if s == "partly-executed":
        return "- {}: partly executed by {} ({})".format(f["path"], by, detail)
    if s == "no-runtime-change":
        return "- {}: no runtime change ({})".format(f["path"], detail)
    if s == "loaded-execution-not-shown":
        return "- {}: loaded by {}, {}".format(f["path"], by, detail)
    if s == "loaded-not-executed":
        return "- {}: loaded by {}, changed code not executed ({})".format(f["path"], by, detail)
    if s == "imported":
        return "- {}: imported by {}'s {}, execution not shown".format(f["path"], by, detail)
    if s == "not-loaded":
        return "- {}: not loaded by any e2e check ({})".format(f["path"], detail)
    if s == "not-reached":
        return "- {}: not reached from any e2e entry".format(f["path"])
    return "- {}: not shown ({})".format(f["path"], detail)


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        prog="e2e_reach.py",
        description="Per changed production file: what the e2e checks showed about its "
                    "changed code (PC-26, RP-09 (j)).")
    parser.add_argument("--base", required=True)
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--repo")
    parser.add_argument("--profile")
    parser.add_argument("--verify")
    parser.add_argument("--ts-program")
    parser.add_argument("--coverage", action="append", default=[], metavar="NAME=PATH")
    parser.add_argument("--out")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        start = Path(args.repo) if args.repo else Path.cwd()
        top = C.git_ok(start, ["rev-parse", "--show-toplevel"]) if C.git_available() else None
        if not top:
            raise UsageError("{} is not in a git repository".format(C.posix_abs(start)))
        repo = Path(top)
        shas = {}
        for label, rev in (("base", args.base), ("head", args.head)):
            code, out = git(repo, ["rev-parse", "--verify", "-q", rev + "^{commit}"])
            if code != 0:
                raise UsageError("--{} {!r} names no commit".format(label, rev))
            shas[label] = out.decode().strip()
        extra_cov: List[Tuple[str, Path]] = []
        for spec in args.coverage:
            if "=" not in spec:
                raise UsageError("--coverage {!r} is not NAME=PATH".format(spec))
            name, raw = spec.split("=", 1)
            path = _resolve(repo, raw)
            if not name.strip() or not path.exists():
                raise UsageError("--coverage {!r}: no such file or directory".format(spec))
            extra_cov.append((name.strip(), path))
        hdir = repo / ".harden"
        profile = _load_json(_resolve(repo, args.profile) if args.profile
                             else hdir / "profile.json", "profile")
        verify = _load_json(_resolve(repo, args.verify) if args.verify
                            else hdir / "verify.json", "verify record")
        if args.ts_program:
            tsp = _load_json(_resolve(repo, args.ts_program), "ts-program JSON", required=True)
        else:
            final = hdir / "tools" / "ts-program.final.json"
            tsp = _load_json(final if final.is_file() else hdir / "tools" / "ts-program.json",
                             "ts-program JSON")
        config = _load_json(hdir / "config.json", "config") or {}
    except UsageError as exc:
        print("e2e_reach.py: {}".format(exc), file=sys.stderr)
        return 2
    test_globs = [g for g in (config.get("test_globs") or []) if isinstance(g, str)] \
        if isinstance(config, dict) else []
    base, head = shas["base"], shas["head"]
    try:
        changed = changed_files(repo, base, head, test_globs)
    except UsageError as exc:
        print("e2e_reach.py: {}".format(exc), file=sys.stderr)
        return 2
    code, listing = git(repo, ["ls-tree", "-r", "-z", "--name-only", head])
    tracked = [C.to_posix(p) for p in listing.decode("utf-8", "replace").split("\0") if p]
    emitted = (tsp or {}).get("emitted") or {} if isinstance(tsp, dict) else {}
    texts_needed = [f["path"] for f in changed if f["status"] != "deleted"]
    for name in ("package.json", "pyproject.toml"):
        if name in tracked:
            texts_needed.append(name)
    texts = read_blobs(repo, head, texts_needed)
    try:
        package_json = json.loads(texts["package.json"]) if "package.json" in texts else None
    except ValueError:
        package_json = None
    pyproject = parse_toml(texts["pyproject.toml"]) if "pyproject.toml" in texts else None
    project = Project(repo, tracked, emitted, package_json if isinstance(package_json, dict)
                      else None, pyproject)

    files_out: List[Dict[str, Any]] = []
    units_of: Dict[str, Dict[str, Any]] = {}
    for f in changed:
        rec = {"path": f["path"], "language": f["language"], "status": None, "by": None,
               "detail": None, "changed_lines": [], "changed_functions": []}
        if f["status"] == "deleted":
            rec["status"] = "deleted"
            files_out.append(rec)
            continue
        code, diff = git(repo, ["diff", "-U0", "--no-renames", base, head, "--", f["path"]])
        diff_text = diff.decode("utf-8", errors="replace")
        rec["changed_lines"] = hunk_ranges(diff_text)
        units = changed_units(f["path"], texts.get(f["path"]), rec["changed_lines"],
                              deletion_anchors(diff_text))
        units_of[f["path"]] = units
        rec["changed_functions"] = units["functions"]
        files_out.append(rec)

    checks_in = (profile or {}).get("e2e") if isinstance(profile, dict) else None
    checks_in = [c for c in checks_in or [] if isinstance(c, dict) and c.get("name")]
    cov_records = (verify or {}).get("e2e_coverage") if isinstance(verify, dict) else None
    checks: List[Dict[str, Any]] = []
    py_graph: Optional[Dict[str, Set[str]]] = None
    for c in checks_in:
        name = str(c["name"])
        entries, note, lang = entry_files(c.get("cmd"), project)
        check: Dict[str, Any] = {"name": name, "cmd": c.get("cmd"), "entry": entries,
                                 "entry_note": note, "language": lang, "coverage": []}
        v8: Optional[Dict[str, Dict[str, Any]]] = None
        for rec in cov_records or []:
            if not isinstance(rec, dict) or rec.get("check") not in (name, "e2e/" + name):
                continue
            cov_dir = _resolve(repo, str(rec.get("dir") or ""))
            scripts, n = read_v8_dir(cov_dir, rec.get("clone"), project) if rec.get("dir") \
                else ({}, 0)
            check["coverage"].append({"kind": "v8", "path": C.to_posix(str(cov_dir)), "files": n})
            if n:
                v8 = dict(v8 or {})
                for src, s in scripts.items():
                    cur = v8.setdefault(src, {"loaded": False, "executed": set()})
                    cur["loaded"] = cur["loaded"] or s["loaded"]
                    cur["executed"] |= s["executed"]
            else:
                check["coverage_note"] = NO_COVERAGE_NOTE
        covpy: Optional[Dict[str, Set[int]]] = None
        for cname, path in extra_cov:
            if cname not in (name, "e2e/" + name):
                continue
            try:
                if path.is_dir():
                    scripts, n = read_v8_dir(path, None, project)
                    check["coverage"].append({"kind": "v8", "path": C.to_posix(str(path)),
                                              "files": n})
                    if n:
                        v8 = dict(v8 or {})
                        for src, s in scripts.items():
                            cur = v8.setdefault(src, {"loaded": False, "executed": set()})
                            cur["loaded"] = cur["loaded"] or s["loaded"]
                            cur["executed"] |= s["executed"]
                    else:
                        check["coverage_note"] = NO_COVERAGE_NOTE
                else:
                    covpy = read_coveragepy(path, project)
                    check["coverage"].append({"kind": "coverage.py",
                                              "path": C.to_posix(str(path)), "files": len(covpy)})
            except UsageError as exc:
                print("e2e_reach.py: {}".format(exc), file=sys.stderr)
                return 2
        check["_v8"] = v8
        check["_covpy"] = covpy
        if lang in ("JavaScript", "TypeScript"):
            check["_graph"] = ts_edges(tsp)
            check["_graph_langs"] = {"JavaScript", "TypeScript"}
            if check["_graph"] is None:
                check["_graph_note"] = "no ts-program.json module graph"
        elif lang == "Python":
            if py_graph is None:
                py_files = [p for p in tracked if p.endswith(".py")]
                py_graph = python_edges(read_blobs(repo, head, py_files))
            check["_graph"] = py_graph
            check["_graph_langs"] = {"Python"}
        checks.append(check)

    gates_only = not checks
    for rec in files_out:
        if rec["status"] == "deleted":
            continue
        units = units_of[rec["path"]]
        if not units["functions"] and not units["toplevel"] and not units["unrecognised"]:
            rec["status"], rec["by"] = "no-runtime-change", None
            rec["detail"] = "only type declarations changed" if units["declarations"] \
                else "only comments or blank lines changed"
            rec["function_results"] = []
            continue
        if gates_only:
            rec["status"], rec["by"], rec["detail"] = "not-shown", None, \
                "no e2e check: gates only"
            rec["function_results"] = [{"name": n, "ran": False, "by": []}
                                       for n in units["functions"]]
            continue
        status, by, detail, rows = evaluate_file(rec, units, checks)
        if status == "not-shown" and any(c.get("coverage_note") for c in checks):
            detail = "{}; {}".format(detail, NO_COVERAGE_NOTE)
        rec["status"], rec["by"], rec["detail"] = status, by, detail
        rec["function_results"] = rows
    live = [f for f in files_out if f["status"] != "deleted"]
    count = {s: sum(1 for f in live if f["status"] == s)
             for s in ORDER + ("no-runtime-change",)}
    rows_all = [r for f in live for r in f.get("function_results") or []]
    summary = {"changed_production_files": len(live), "executed": count["executed"],
               "partly_executed": count["partly-executed"],
               "loaded_execution_not_shown": count["loaded-execution-not-shown"],
               "loaded_not_executed": count["loaded-not-executed"],
               "imported_only": count["imported"], "not_loaded": count["not-loaded"],
               "not_reached": count["not-reached"], "not_shown": count["not-shown"],
               "no_runtime_change": count["no-runtime-change"],
               "changed_functions": len(rows_all),
               "changed_functions_run": sum(1 for r in rows_all if r["ran"]),
               "deleted": len(files_out) - len(live), "gates_only": gates_only}
    # A module counts as executed only when every changed function in it ran (A01-F48).
    headline = "e2e executed {} of {} changed modules, {} of {} changed functions".format(
        summary["executed"], summary["changed_production_files"],
        summary["changed_functions_run"], summary["changed_functions"])
    line = "{} (partly executed: {}; loaded, changed code not run: {}; loaded, execution not " \
           "shown: {}; no runtime change: {}; imported only: {}; not loaded: {}; not reached: " \
           "{}; not shown: {})".format(headline, summary["partly_executed"],
                                       summary["loaded_not_executed"],
                                       summary["loaded_execution_not_shown"],
                                       summary["no_runtime_change"], summary["imported_only"],
                                       summary["not_loaded"], summary["not_reached"],
                                       summary["not_shown"])
    public_checks = [{k: v for k, v in c.items() if not k.startswith("_")} for c in checks]
    data = {"tool": "e2e_reach.py", "version": VERSION, "base": base, "head": head,
            "generated": C.utc_iso(), "checks": public_checks, "files": files_out,
            "summary": summary, "headline": headline, "summary_line": line}
    out = args.out or str(hdir / "tools" / "e2e-reach.json")
    if out == "-" or args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    if out != "-":
        C.write_json(_resolve(repo, out), data)
        if not args.json:
            for f in files_out:
                print(bullet(f))
            print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
