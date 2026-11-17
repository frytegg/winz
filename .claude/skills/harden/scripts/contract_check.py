#!/usr/bin/env python3
"""contract_check.py - pin what a behavioural fix must not change (protocol-change PC-24).

Purpose
    In the second autonomous pilot a fix to loadConfig also removed parseArgs' default config
    file and made the exported CliArgs.config optional. No test pinned parseArgs, the commit
    body said "newly rejected: none", and the end-to-end verifier stayed green
    (pilot-auto-calibration A01-F29, A01-F47). `pins` makes A01-F29's calibration mechanical:
      pins      lists the functions and methods a change edits (added or removed code lines,
                comments and blank lines ignored, both sides of the diff; a callback or nested
                function counts as its outermost function), plus the exported functions of
                the same module that call an edited function that is not exported. For a
                behavioural change (a `Behaviour change:` line or a `fix` subject) it checks
                that each of them that existed before the change and is exported is pinned by
                a test file the run added or extended before the change, and that the
                message's `newly rejected: none (<test files>)` claim names, inside its
                parentheses, test files that existed before the change and refer to each of
                them. A changed code line outside every exported function (a top-level
                statement, a class field, an object-literal member, an unexported helper no
                exported function calls), import lines and type-only declarations left out,
                and any edit of a file the parser cannot read (JSX, Solidity, a parse error),
                need a module pin instead: a run-added test that imports that module, or a
                header line `pins: <file> *`.
    Exported: TypeScript/JavaScript from the union of ts_program.py's symbols
    (.harden/tools/ts-program.json) and the `export` keywords of the file (`export default X;`
    included); Python: no leading underscore (or listed in __all__); Rust `pub`; Go an
    upper-case initial; other languages count as exported. A method of an exported class is
    exported unless its name is private by the language's convention; a constructor
    (`Class.constructor`, Python `Class.__init__`) is pinned by a test that names its class.
    A test file pins a unit when it holds the unit's name (and, for a method, its class name)
    as a word and an import string or dotted path whose last segment is the module's file stem
    (the directory name for an index, __init__, mod or lib module), or when a header comment
    line `pins: <file> <unit>[, ...]` (`//`, `#`, `*` or `/*`) declares it: a characterization
    that reaches the unit through another entry point (a registry, a CLI main) says so. The
    run's tests are the test files added or modified between the base and the change's parent;
    a modified one counts with the lines it gained and its import lines. That is a text check:
    it proves the test refers to the function, not what it asserts.
    The API snapshot comparison (`snapshot`, `api`) is not part of this version: the textual
    PF-15 diff of protocol-change step 13 stays (pilot-auto-calibration, open questions).

CLI
    python contract_check.py pins (--staged | --commit SHA | --range A..B) [--base SHA]
                                  [--message-file FILE] [--ts-program FILE] [--all]
                                  [--out FILE] [--json] [--repo DIR]
    (use python3 on macOS/Linux)
    --base defaults to base_sha of .harden/active; --message-file is the planned message of a
    staged change (the file later given to `git commit -F`); --all also checks structural
    changes (a --staged run without --message-file checks as if --all were given); --range
    checks each commit of the range with its own message

Output
    default .harden/tools/contract-pins.json: per change, its units (file, unit, existed,
    exported, pinned_by, calls_edited, module) and problems, each {"kind": "unpinned" |
    "claim", "change", "text"}; UTF-8 with LF line ends; a summary is printed.

Exit codes
    0  every edited exported unit and every module that needs it pinned, and the claim covers
       them (or the change is structural and --all was not given)
    1  an `unpinned` problem (commit the characterization test first) or a `claim` problem
       (fix the message: `newly rejected: none (<test files>)` on one line)
    2  usage error: not a git repository, a bad revision, an unreadable input

Python 3.9+ standard library only; no network; UTF-8 I/O; git without a shell.
"""
from __future__ import annotations

import argparse
import ast
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

sys.dont_write_bytecode = True
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)
import complexity as CX  # noqa: E402
import e2e_reach as E2E  # noqa: E402

VERSION = 2
BOM = chr(0xFEFF)
HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", re.M)
CLASS_LINE_RE = re.compile(r"\b(?:class|struct|impl|trait|interface|enum|object)\s+"
                           r"([A-Za-z_$][\w$]*)")
BEHAVIOUR_RE = re.compile(r"^[ \t]*Behaviour change:", re.M | re.I)
# P1: the clause after `newly rejected:` ends with its line; `none` takes its test files only
# from the parentheses that follow it, so a `cmd:` line below is never part of the claim.
REJECTED_RE = re.compile(r"newly rejected:[ \t]*([^\n]*)", re.I)
NONE_LIST_RE = re.compile(r"^none\s*\(([^)]*)\)", re.I)
PATH_TOKEN_RE = re.compile(r"[A-Za-z0-9_@$.~/\\\-]+")
IMPORT_LINE_RE = re.compile(r"^\s*(?:import\b|from\s+[\w.]+\s+import\b|\}\s*from\b|"
                            r"export\s+(?:\*|\{[^}]*\})\s*from\b|.*\brequire\s*\()")
CONSTRUCTORS = {"constructor", "__init__"}
PY_PUBLIC_DUNDERS = {"__init__", "__call__", "__enter__", "__exit__", "__iter__", "__next__",
                     "__getitem__", "__setitem__", "__len__", "__contains__", "__aenter__",
                     "__aexit__", "__str__", "__repr__", "__eq__", "__hash__"}
MAX_TEXT = 300


class UsageError(Exception):
    """Bad arguments or unreadable input (exit 2)."""


# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------
def git(repo: Path, args: Sequence[str]) -> Tuple[int, str]:
    cmd = ["git", "-c", "core.quotepath=false", "-c", "color.ui=never"] + list(args)
    try:
        proc = subprocess.run(cmd, cwd=str(repo), capture_output=True, env=C.git_env(),
                              timeout=300)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return 128, str(exc)
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace")


def rev_sha(repo: Path, rev: str) -> str:
    code, out = git(repo, ["rev-parse", "--verify", "-q", rev + "^{commit}"])
    if code != 0 or not out.strip():
        raise UsageError("{!r} names no commit".format(rev))
    return out.strip()


def _clean(text: str) -> str:
    return text.lstrip(BOM).replace("\r\n", "\n").replace("\r", "\n")


def blob(repo: Path, rev: Optional[str], path: str) -> Optional[str]:
    """Text of `path` at `rev` (None: the index), or None when absent."""
    spec = ":{}".format(path) if rev is None else "{}:{}".format(rev, path)
    code, out = git(repo, ["show", spec])
    if code != 0:
        return None
    return _clean(out)


def blobs(repo: Path, rev: str, paths: Sequence[str]) -> Dict[str, str]:
    """Text of each path at `rev`, missing paths left out, in one `git cat-file --batch`."""
    if not paths:
        return {}
    request = "".join("{}:{}\n".format(rev, p) for p in paths).encode("utf-8")
    cmd = ["git", "-c", "core.quotepath=false", "cat-file", "--batch"]
    try:
        proc = subprocess.run(cmd, cwd=str(repo), input=request, capture_output=True,
                              env=C.git_env(), timeout=300)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if proc.returncode != 0:
        return {}
    out = proc.stdout
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
        result[path] = _clean(out[pos:pos + size].decode("utf-8", errors="replace"))
        pos += size + 1
    return result


def repo_root(start: Optional[str]) -> Path:
    base = Path(start) if start else Path.cwd()
    top = C.git_ok(base, ["rev-parse", "--show-toplevel"]) if C.git_available() else None
    if not top:
        raise UsageError("{} is not in a git repository".format(C.posix_abs(base)))
    return Path(top)


def load_json_opt(path: Path) -> Any:
    if not path.is_file():
        return None
    try:
        return C.read_json(path)
    except (OSError, ValueError) as exc:
        raise UsageError("cannot read {}: {}".format(C.to_posix(str(path)), exc)) from exc


def read_message(path: str) -> str:
    try:
        raw = Path(path).read_bytes()
    except OSError as exc:
        raise UsageError("cannot read --message-file {}: {}".format(path, exc)) from exc
    return raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n").replace("\r", "\n")


def range_messages(repo: Path, spec: str) -> List[Tuple[str, str]]:
    if ".." not in spec:
        raise UsageError("--range {!r} is not A..B".format(spec))
    code, out = git(repo, ["log", "--reverse", "--format=%H%x00%B%x1e", spec])
    if code != 0:
        raise UsageError("git log {} failed".format(spec))
    result: List[Tuple[str, str]] = []
    for chunk in out.split("\x1e"):
        chunk = chunk.strip("\n")
        if "\x00" in chunk:
            sha, body = chunk.split("\x00", 1)
            result.append((sha.strip(), body.replace("\r\n", "\n")))
    return result


def test_globs(repo: Path) -> List[str]:
    config = load_json_opt(repo / ".harden" / "config.json") or {}
    marker = load_json_opt(repo / ".harden" / "active") or {}
    globs: List[str] = []
    for source in (marker, config):
        if isinstance(source, dict):
            globs += [g for g in source.get("test_globs") or [] if isinstance(g, str)]
    return globs


def is_test(path: str, globs: Sequence[str]) -> bool:
    return C.is_test_path(path) or bool(globs and C.match_any(path, globs))


# ---------------------------------------------------------------------------
# pins: which functions a change edits, and who pins them
# ---------------------------------------------------------------------------
def units_of(path: str, text: Optional[str]) -> Optional[List[Dict[str, Any]]]:
    """Functions with qualname (Class.method) and span; None when not analysable."""
    if text is None:
        return []
    analysis = CX.analyse_text(path, text)
    if analysis.get("error") or analysis.get("language") is None:
        return None
    lines = text.split("\n")
    classes = [b for b in analysis.get("blocks") or [] if b.get("kind") == "class"]
    result = []
    for fn in analysis.get("functions") or []:
        qual = fn.get("qualname")
        if not qual:
            owner = [b for b in classes if b["start_line"] <= fn["start_line"] <= b["end_line"]
                     and not (b["start_line"] == fn["start_line"])]
            qual = fn["name"]
            if owner:
                inner = min(owner, key=lambda b: b["end_line"] - b["start_line"])
                head = lines[inner["start_line"] - 1] if inner["start_line"] <= len(lines) else ""
                match = CLASS_LINE_RE.search(head)
                if match:
                    qual = "{}.{}".format(match.group(1), fn["name"])
        result.append({"name": fn["name"], "qualname": qual, "start": fn["start_line"],
                       "end": fn["end_line"]})
    return result


def owner_of(units: List[Dict[str, Any]], line: int) -> Optional[str]:
    """The outermost function around a line, so a callback or nested function counts as an
    edit of the function that holds it; None outside every function."""
    around = [u for u in units if u["start"] <= line <= u["end"]]
    if not around:
        return None
    return max(around, key=lambda u: u["end"] - u["start"])["qualname"]


def attribute(units: List[Dict[str, Any]], lines: Sequence[int]) -> List[str]:
    names: List[str] = []
    for line in lines:
        qual = owner_of(units, line)
        if qual is not None and qual not in names:
            names.append(qual)
    return names


def span_text(text: str, unit: Dict[str, Any]) -> str:
    lines = text.split("\n")
    return "\n".join(lines[unit["start"] - 1:unit["end"]])


def skip_lines(path: str, text: Optional[str]) -> Set[int]:
    """Top-level import statements and type-only declarations: a changed line there changes
    nothing a characterization test can pin (P5; e2e_reach.toplevel_kinds `declaration`)."""
    if not text:
        return set()
    if CX.language_for(path) == "Python":
        try:
            tree = ast.parse(text)
        except (SyntaxError, ValueError):
            return set()
        found: Set[int] = set()
        for node in tree.body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                found.update(range(node.lineno, (getattr(node, "end_lineno", None)
                                                 or node.lineno) + 1))
        return found
    found = set()
    for first, last, head in E2E.toplevel_statements(path, text):
        if head.startswith("import ") or head == "import" or E2E.DECL_HEAD_RE.match(head):
            found.update(range(first, last + 1))
    return found


def declared_pins(test_text: str) -> List[str]:
    """`pins:` header lines of a characterization test: the units it pins through another
    entry point (`// pins: src/x.ts Class.method, other`, `# pins: src/x.py *`)."""
    found: List[str] = []
    for m in re.finditer(r"(?m)^\s*(?://+|#+|\*|/\*+)\s*pins:\s*(.+?)\s*(?:\*/)?\s*$",
                         test_text):
        found += [p.strip() for p in re.split(r"[,;]", m.group(1)) if p.strip()]
    return found


def module_refs(path: str) -> Set[str]:
    stem = os.path.basename(path)
    for suffix in (".d.ts", ".d.mts", ".d.cts"):
        if stem.endswith(suffix):
            stem = stem[:-len(suffix)]
    stem = os.path.splitext(stem)[0]
    refs = {stem}
    if stem in ("index", "__init__", "mod", "lib"):
        parent = os.path.basename(os.path.dirname(path))
        if parent:
            refs.add(parent)
    return refs


def imports_module(test_text: str, module: str) -> bool:
    """An import string or dotted import whose last segment is the module's stem."""
    refs = module_refs(module)
    for literal in re.findall(r"['\"`]([^'\"`\n]{1,300})['\"`]", test_text):
        last = literal.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
        last = re.sub(r"\.(d\.)?[cm]?[jt]sx?$|\.py$|\.sol$", "", last)
        if last in refs:
            return True
    for dotted in re.findall(r"(?m)^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))",
                             test_text):
        name = (dotted[0] or dotted[1]).rsplit(".", 1)[-1]
        if name in refs:
            return True
    return False


def names_unit(test_text: str, qual: str, module: str) -> bool:
    top, _, method = qual.partition(".")
    words = [top] + ([method] if method and method not in CONSTRUCTORS else [])
    for word in words:
        if not re.search(r"(?<![\w$])" + re.escape(word) + r"(?![\w$])", test_text):
            return False
    return imports_module(test_text, module)


def _header_names(entry: str) -> Tuple[Optional[str], str]:
    parts = entry.replace("\\", "/").split()
    if not parts:
        return None, ""
    return (parts[0] if len(parts) > 1 else None), parts[-1]


def pins_unit(test_text: str, qual: str, module: str) -> bool:
    """A run-added test pins a unit when it names it (names_unit) or declares it in a
    `pins:` header line, with the unit's file when the line names one."""
    if names_unit(test_text, qual, module):
        return True
    for entry in declared_pins(test_text):
        path, target = _header_names(entry)
        if target == qual and (path is None or path == module):
            return True
    return False


def pins_module(test_text: str, module: str) -> bool:
    """A test pins a whole module when it imports it, or declares `pins: <file> *`."""
    if imports_module(test_text, module):
        return True
    for entry in declared_pins(test_text):
        path, target = _header_names(entry)
        if target == "*" and path == module:
            return True
    return False


def hunk_sides(diff_text: str) -> Tuple[List[int], List[int]]:
    """Old-side deleted and new-side added line numbers of a -U0 diff."""
    old: List[int] = []
    new: List[int] = []
    for m in HUNK_RE.finditer(diff_text):
        o_start, o_count = int(m.group(1)), int(m.group(2)) if m.group(2) is not None else 1
        n_start, n_count = int(m.group(3)), int(m.group(4)) if m.group(4) is not None else 1
        old += list(range(o_start, o_start + o_count))
        new += list(range(n_start, n_start + n_count))
    return old, new


def exported_names(repo: Path, tsp: Any, path: str, text: str) -> Tuple[Set[str], str]:
    """Top-level exported names of a file (at the parent) and how they were decided."""
    lang = CX.language_for(path)
    if lang in ("TypeScript", "JavaScript"):
        found = set(re.findall(r"(?m)^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?"
                               r"(?:async\s+)?(?:function\*?|class|const|let|var)\s+"
                               r"([A-Za-z_$][\w$]*)", text))
        found |= set(re.findall(r"(?m)^\s*export\s+default\s+([A-Za-z_$][\w$]*)\s*;", text))
        for group in re.findall(r"export\s*\{([^}]*)\}", text, re.S):
            for part in group.split(","):
                word = part.strip().split(" as ")[0].strip()
                if re.match(r"^[A-Za-z_$][\w$]*$", word):
                    found.add(word)
        how = "export keyword"
        if isinstance(tsp, dict) and isinstance(tsp.get("symbols"), list):
            names = {s.get("name") for s in tsp["symbols"]
                     if isinstance(s, dict) and s.get("file") == path}
            names = {n for n in names if isinstance(n, str)}
            if names:
                found |= names
                how = "ts_program.py and export keyword"
        return found, how
    if lang == "Python":
        try:
            tree = ast.parse(text)
        except (SyntaxError, ValueError):
            return set(), "unparsable"
        names = {n.name for n in tree.body
                 if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))}
        declared = None
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__"
                                                    for t in node.targets):
                if isinstance(node.value, (ast.List, ast.Tuple)):
                    declared = {e.value for e in node.value.elts
                                if isinstance(e, ast.Constant) and isinstance(e.value, str)}
        if declared is not None:
            return names & declared, "__all__"
        return {n for n in names if not n.startswith("_")}, "no leading underscore"
    if lang == "Rust":
        return set(re.findall(r"(?m)^\s*pub(?:\([^)]*\))?\s+(?:const\s+)?(?:async\s+)?"
                              r"(?:unsafe\s+)?(?:fn|struct|enum|trait)\s+([A-Za-z_]\w*)",
                              text)), "pub"
    return {"*"}, "every unit counts as exported ({})".format(lang)


def unit_exported(qual: str, names: Set[str], lang: Optional[str]) -> bool:
    top, _, method = qual.partition(".")
    if lang == "Go":
        last = method or top
        return last[:1].isupper()
    if "*" in names:
        return True
    if top not in names:
        return False
    if not method:
        return True
    if lang == "Python":
        return not method.startswith("_") or method in PY_PUBLIC_DUNDERS
    return not method.startswith("#") and not method.startswith("_")


def claim_tests(clause: str, globs: Sequence[str]) -> List[str]:
    tests: List[str] = []
    for token in PATH_TOKEN_RE.findall(clause):
        token = token.replace("\\", "/").rstrip(".,;:")
        token = re.sub(r"::.*$", "", token)
        if "/" not in token and "." not in token:
            continue
        if is_test(token, globs) and token not in tests:
            tests.append(token)
    return tests


def run_tests(repo: Path, base: str, parent: str, globs: Sequence[str]) -> Dict[str, str]:
    """The run's own test files before a change (P2): each test file added in base..parent
    with its text at the parent, and each one modified there with the lines it gained plus its
    import lines at the parent, so cases added to an existing test file pin too."""
    if base == parent:
        return {}
    code, out = git(repo, ["diff", "--name-status", "-z", "--no-renames", "--diff-filter=AM",
                           base, parent])
    if code != 0:
        raise UsageError("git diff {}..{} failed".format(base[:12], parent[:12]))
    parts = [p for p in out.split("\0") if p]
    added: List[str] = []
    modified: List[str] = []
    for status, path in zip(parts[0::2], parts[1::2]):
        path = C.to_posix(path)
        if is_test(path, globs):
            (added if status.startswith("A") else modified).append(path)
    texts = blobs(repo, parent, added + modified)
    for path in modified:
        whole = texts.get(path)
        if whole is None:
            continue
        _, diff = git(repo, ["diff", "-U0", "--no-renames", base, parent, "--", path])
        gained = [line[1:] for line in diff.split("\n")
                  if line.startswith("+") and not line.startswith("+++")]
        imports = [line for line in whole.split("\n") if IMPORT_LINE_RE.match(line)]
        texts[path] = "\n".join(imports + gained)
    return texts


def _problem(result: Dict[str, Any], kind: str, text: str) -> None:
    result["problems"].append({"kind": kind, "change": result["change"], "text": text})


def check_change(repo: Path, base: str, parent: str, new_rev: Optional[str], message: str,
                 tsp: Any, globs: Sequence[str], mode: str, force: bool) -> Dict[str, Any]:
    """One change: `new_rev` None means the index (a staged change)."""
    diff_args = ["diff", "--name-status", "-z", "--no-renames"]
    diff_args += (["--cached", parent] if new_rev is None else [parent, new_rev])
    code, out = git(repo, diff_args)
    if code != 0:
        raise UsageError("git diff failed for {}".format(new_rev or "the index"))
    parts = [p for p in out.split("\0") if p]
    behavioural = bool(BEHAVIOUR_RE.search(message)) or bool(
        re.match(r"^\s*fix(\(|!|:)", message.split("\n", 1)[0] if message else ""))
    result: Dict[str, Any] = {"change": new_rev or "staged", "parent": parent,
                              "behavioural": behavioural, "units": [], "claim": None,
                              "problems": []}
    test_texts = run_tests(repo, base, parent, globs)
    for status, path in zip(parts[0::2], parts[1::2]):
        path = C.to_posix(path)
        lang = C.language_of(path)
        if path.startswith(".harden/") or not C.is_source_language(lang) or \
                C.is_doc_path(path) or is_test(path, globs):
            continue
        if status.startswith("A"):
            continue  # a new file had no behaviour to pin
        old_text = blob(repo, parent, path)
        new_text = blob(repo, new_rev, path) if not status.startswith("D") else None
        old_units, new_units = units_of(path, old_text), units_of(path, new_text)
        module_row: Optional[Dict[str, Any]] = None
        if old_units is None or new_units is None:
            module_row = {"file": path, "unit": "*", "existed": True, "exported": True,
                          "module": "not analysed (parse error or unsupported language)",
                          "exported_by": "module", "pinned_by": []}
        else:
            cargs = ["diff", "-U0", "--no-renames"] + (["--cached", parent] if new_rev is None
                                                       else [parent, new_rev]) + ["--", path]
            _, diff_text = git(repo, cargs)
            old_lines, new_lines = hunk_sides(diff_text)
            old_code = CX.code_lines(path, old_text) if old_text is not None else set()
            new_code = CX.code_lines(path, new_text) if new_text is not None else set()
            old_changed = [n for n in old_lines if old_code is None or n in old_code]
            new_changed = [n for n in new_lines if new_code is None or n in new_code]
            edited = attribute(old_units, old_changed)
            for qual in attribute(new_units, new_changed):
                if qual not in edited:
                    edited.append(qual)
            existed = {u["qualname"] for u in old_units}
            names, how = exported_names(repo, tsp, path, old_text or "")
            outer = {u["qualname"]: u for u in old_units
                     if not any(o is not u and o["start"] <= u["start"] and u["end"] <= o["end"]
                                and (o["end"] - o["start"]) > (u["end"] - u["start"])
                                for o in old_units)}
            rows: List[Tuple[str, Optional[str]]] = [(q, None) for q in edited]
            reached: Set[str] = set()
            for qual in edited:
                # An edited helper that is not exported changes the output of the exported
                # functions of the same module that call it: they are pinned too.
                if qual in existed and not unit_exported(qual, names, lang) and old_text:
                    word = re.compile(r"(?<![\w$])" + re.escape(qual.rsplit(".", 1)[-1]) +
                                      r"(?![\w$])")
                    for caller, cunit in outer.items():
                        if caller != qual and caller not in edited and \
                                unit_exported(caller, names, lang) and \
                                word.search(span_text(old_text, cunit)):
                            reached.add(qual)
                            if (caller, qual) not in rows:
                                rows.append((caller, qual))
            for qual, via in rows:
                unit: Dict[str, Any] = {"file": path, "unit": qual, "existed": qual in existed,
                                        "exported": qual in existed and
                                        unit_exported(qual, names, lang),
                                        "exported_by": how, "pinned_by": []}
                if via:
                    unit["calls_edited"] = via
                if unit["exported"]:
                    unit["pinned_by"] = [t for t, text in sorted(test_texts.items())
                                         if pins_unit(text, qual, path)]
                result["units"].append(unit)
            # P5: a changed code line outside every exported function, and not in an
            # unexported helper an exported function calls, needs a module pin.
            uncovered: List[str] = []
            for side, lines, units, text in (("old", old_changed, old_units, old_text),
                                             ("new", new_changed, new_units, new_text)):
                skip = skip_lines(path, text)
                for line in lines:
                    if line in skip:
                        continue
                    qual = owner_of(units, line)
                    if qual is None or (qual in existed and not unit_exported(qual, names, lang)
                                        and qual not in reached):
                        uncovered.append("{}:{}".format(side, line))
            if uncovered:
                module_row = {"file": path, "unit": "*", "existed": True, "exported": True,
                              "module": "code outside every exported function ({})".format(
                                  ", ".join(uncovered[:8]) +
                                  (", ..." if len(uncovered) > 8 else "")),
                              "exported_by": how, "pinned_by": []}
        if module_row is not None:
            module_row["pinned_by"] = [t for t, text in sorted(test_texts.items())
                                       if pins_module(text, path)]
            result["units"].append(module_row)
    needs = [u for u in result["units"] if u["exported"]]
    if not (behavioural or force):
        return result
    for unit in needs:
        if unit["pinned_by"]:
            continue
        if unit.get("module"):
            _problem(result, "unpinned",
                     "{} needs a module pin: {}, and no test file the run added or extended "
                     "before this change imports it or declares `pins: {} *`: commit a "
                     "characterization test that imports the module first (PC-24)".format(
                         unit["file"], unit["module"], unit["file"]))
            continue
        how = "is edited and exported" if not unit.get("calls_edited") else \
            "is exported and calls the edited {}".format(unit["calls_edited"])
        _problem(result, "unpinned",
                 "{} {} {}, and no test file the run added or extended before this change "
                 "names it or declares it on a `pins:` line: commit characterization tests "
                 "that pin its current outputs, defaults included, first (PC-24)".format(
                     unit["file"], unit["unit"], how))
    if behavioural:
        match = REJECTED_RE.search(message)
        claim: Dict[str, Any] = {"text": None, "none": None, "tests": []}
        result["claim"] = claim
        if not match:
            _problem(result, "claim", "the message has no `newly rejected:` clause (PC-24)")
            return result
        clause = match.group(1).strip()
        claim["text"] = clause[:MAX_TEXT]
        claim["none"] = clause.lower().startswith("none")
        if not claim["none"]:
            if mode == "auto":
                _problem(result, "claim", "an autonomous run applies no fix whose newly "
                                          "rejected class is not empty (PC-24)")
            return result
        listed = NONE_LIST_RE.match(clause)
        claim["tests"] = claim_tests(listed.group(1), globs) if listed else []
        if not needs:
            return result
        if not claim["tests"]:
            _problem(result, "claim", "`newly rejected: none` names no test file: write "
                                      "`newly rejected: none (<the characterization test "
                                      "files>)` on one line")
            return result
        texts = blobs(repo, parent, claim["tests"])
        for test in claim["tests"]:
            if test not in texts:
                _problem(result, "claim", "{} is named by `newly rejected: none` but did not "
                                          "exist before this change".format(test))
        for unit in needs:
            if unit.get("module"):
                covered = any(pins_module(text, unit["file"]) for text in texts.values())
            else:
                covered = any(pins_unit(text, unit["unit"], unit["file"])
                              for text in texts.values())
            if not covered:
                _problem(result, "claim", "`newly rejected: none` does not cover {} {}: none "
                                          "of the tests it names refers to it".format(
                                              unit["file"], unit["unit"]))
    return result


def cmd_pins(args: argparse.Namespace, repo: Path) -> int:
    marker = load_json_opt(repo / ".harden" / "active") or {}
    base_rev = args.base or (marker.get("base_sha") if isinstance(marker, dict) else None)
    if not base_rev:
        raise UsageError("no --base and no base_sha in .harden/active")
    base = rev_sha(repo, base_rev)
    tsp_path = Path(args.ts_program) if args.ts_program else None
    if tsp_path is None:
        for name in ("ts-program.json", "ts-program.final.json"):
            candidate = repo / ".harden" / "tools" / name
            if candidate.is_file():
                tsp_path = candidate
                break
    tsp = load_json_opt(tsp_path if tsp_path is None or tsp_path.is_absolute()
                        else repo / tsp_path) if tsp_path else None
    globs = test_globs(repo)
    mode = marker.get("mode") if isinstance(marker, dict) else None
    changes: List[Dict[str, Any]] = []
    if args.staged:
        message = read_message(args.message_file) if args.message_file else ""
        changes.append(check_change(repo, base, rev_sha(repo, "HEAD"), None, message, tsp, globs,
                                    mode, args.all or not args.message_file))
    elif args.commit:
        sha = rev_sha(repo, args.commit)
        message = read_message(args.message_file) if args.message_file else \
            git(repo, ["log", "-1", "--format=%B", sha])[1]
        changes.append(check_change(repo, base, rev_sha(repo, sha + "^"), sha, message, tsp,
                                    globs, mode, args.all))
    else:
        for sha, body in range_messages(repo, args.range):
            changes.append(check_change(repo, base, rev_sha(repo, sha + "^"), sha, body, tsp,
                                        globs, mode, args.all))
    problems = [p for c in changes for p in c["problems"]]
    data = {"tool": "contract_check.py", "version": VERSION, "mode": "pins",
            "generated": C.utc_iso(), "base": base,
            "ts_program": C.to_posix(str(tsp_path)) if tsp else None, "changes": changes,
            "problems": problems}
    out = Path(args.out) if args.out else repo / ".harden" / "tools" / "contract-pins.json"
    C.write_json(out if out.is_absolute() else repo / out, data)
    if args.json:
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        for change in changes:
            for unit in change["units"]:
                if unit["exported"]:
                    print("- {} {} {}: {}".format(change["change"][:12], unit["file"],
                                                  unit["unit"], ", ".join(unit["pinned_by"])
                                                  or "NOT PINNED"))
        for problem in problems:
            print("PROBLEM ({}): {}".format(problem["kind"], problem["text"]))
        print("contract_check.py pins: {} change(s), {} unpinned, {} claim problem(s)".format(
            len(changes), sum(1 for p in problems if p["kind"] == "unpinned"),
            sum(1 for p in problems if p["kind"] == "claim")))
    return 1 if problems else 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        prog="contract_check.py",
        description="Characterization pins of a behavioural fix (PC-24; "
                    "pilot-auto-calibration A01-F29, A01-F47).",
        epilog="Exit 0 pinned and claimed; 1 an unpinned unit or a claim problem; 2 usage.")
    sub = parser.add_subparsers(dest="command", required=True)
    pins = sub.add_parser("pins", help="check the characterization pins of a change")
    which = pins.add_mutually_exclusive_group(required=True)
    which.add_argument("--staged", action="store_true", help="the staged change")
    which.add_argument("--commit", help="one commit")
    which.add_argument("--range", help="every commit of A..B")
    pins.add_argument("--base", help="the run's base commit (default: base_sha of .harden/active)")
    pins.add_argument("--message-file", help="the planned commit message of a staged change")
    pins.add_argument("--ts-program", help="ts_program.py output (default .harden/tools/)")
    pins.add_argument("--all", action="store_true", help="also check structural changes")
    pins.add_argument("--out", help="default .harden/tools/contract-pins.json")
    pins.add_argument("--json", action="store_true")
    pins.add_argument("--repo")
    args = parser.parse_args(argv)
    try:
        repo = repo_root(args.repo)
        return cmd_pins(args, repo)
    except UsageError as exc:
        print("contract_check.py: {}".format(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
