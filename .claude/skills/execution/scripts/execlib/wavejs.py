"""Rendering and checking of generated workflow scripts (contract/WAVES.md 2, MODULES.md 7 and `wavejs.py`).

A wave script is `assets/workflows/wave.template.js` with five placeholders replaced (WAVES.md 2.1): the workflow
name and description inside single-quoted strings, the manifest and the EXTRA constant as `js_literal` JSON, and the
/frontend wave fragments inlined verbatim. The planner script is `assets/workflows/planner.template.js` with its name,
description and the PLANNING constant (WAVES.md 7). Both pass the same two checks before anything is written:
- `static_check`: the forbidden tokens of CLI.md `wave emit` (`Date.now`, `Math.random`, argless `new Date()`,
  `require(`, `import`, `process.`) searched in the code only, after `strip_js` removed comments, string literals and
  the literal parts of template literals (their `${...}` expressions are code and stay). /frontend's fragment headers
  name those tokens in comments, which a literal scan would refuse (WAVES.md 2.2).
- `node_check`: the script is not a module `node --check` accepts (top-level `return` and `await`), so it is wrapped
  in an AsyncFunction constructor call and run by node, which parses the body without running it (WAVES.md 2.3).
Pure functions except `node_check` (a node subprocess, through `subprocess` directly: MODULES.md 8 gives this module
the `schema` edge only) and `load_fragment` (reads one file).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import jsonio, schema
from .errors import DependencyMissing, EnvError, ErrorItem, InternalError
from .log import get_logger
from .paths import SKILL_DIR, other_skill, posix

_LOG = get_logger("execlib.wavejs")

FORBIDDEN: tuple[str, ...] = ("Date.now", "Math.random", "new Date()", "require(", "import ", "process.")
# The regex of each token, applied to the stripped code (TESTS.md 6 lists the same patterns). Besides TESTS.md 6's
# literal forms, the same reads are caught when spelled another way: optional chaining (`Date?.now`), a computed
# member (`Date['now']()`, `Math["random"]()`, `process['env']`: the string is blanked by `strip_js`, so any computed
# access on `Date`, `Math` or `process` is refused; no generated script needs one) and an argless `new Date` without
# parentheses (`new Date;`, which reads the clock exactly as `new Date()` does).
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Date.now", re.compile(r"Date\s*\??\.\s*now")),
    ("Date.now", re.compile(r"\bDate\s*(?:\?\.\s*)?\[")),
    ("Math.random", re.compile(r"Math\s*\??\.\s*random")),
    ("Math.random", re.compile(r"\bMath\s*(?:\?\.\s*)?\[")),
    ("new Date()", re.compile(r"new\s+Date\s*\(\s*\)")),
    ("new Date()", re.compile(r"\bnew\s+Date\b(?!\s*\()")),
    ("require(", re.compile(r"\brequire\s*\(")),
    ("import ", re.compile(r"(^|[;{}])\s*import[\s{*'\"]|\bimport\s*\(", re.M)),
    ("process.", re.compile(r"\bprocess\s*\??\.")),
    ("process.", re.compile(r"\bprocess\s*(?:\?\.\s*)?\[")),
)
WAVE_TEMPLATE: Path = SKILL_DIR / "assets" / "workflows" / "wave.template.js"
PLANNER_TEMPLATE: Path = SKILL_DIR / "assets" / "workflows" / "planner.template.js"
FRAGMENT_FILES: Mapping[str, str] = {"feCritique": "critique.js", "feDirections": "directions.js"}
FRAGMENT_ORDER: tuple[str, ...] = ("feDirections", "feCritique")      # WAVES.md 2.1: directions first
DESCRIPTION_RE = re.compile(r"^[A-Za-z0-9 ,.:()/-]{1,300}$")
WORKFLOW_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,60}$")
NODE_TIMEOUT_S = 60.0


# --- the JS-aware scanner -----------------------------------------------------------------------------------------

NL = chr(10)
BACKSLASH = chr(92)
_REGEX_PREV = set("(,=:[!&|?{};+-*%<>~^")
_REGEX_KEYWORDS = ("return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do",
                   "else", "yield", "await")


def _regex_allowed(out: list[str]) -> bool:
    """A `/` starts a regex literal when the previous significant code is an operator, an opening bracket, a
    keyword or the start of the text (the usual heuristic of JS tokenizers). A postfix `++` or `--` ends an operand,
    so a `/` after it is a division (`y++ / 2`): a regex literal can never follow `++`/`--` (it is not assignable)."""
    i = len(out) - 1
    while i >= 0 and out[i] in " \t\r\n":
        i -= 1
    if i < 0:
        return True
    ch = out[i]
    if ch in "+-" and i >= 1 and out[i - 1] == ch:
        return False
    if ch in _REGEX_PREV:
        return True
    if ch.isalnum() or ch in "_$":
        j = i
        while j >= 0 and (out[j].isalnum() or out[j] in "_$"):
            j -= 1
        word = "".join(out[j + 1:i + 1])
        return word in _REGEX_KEYWORDS
    return False


def strip_js(js: str) -> str:
    """The code of `js` with comments, string literals, regex literals and the literal parts of template literals
    replaced by spaces; newlines are kept, so line numbers do not move. `${...}` inside a template literal is code
    and is kept (a token hidden there is still found)."""
    out: list[str] = []
    i = 0
    n = len(js)
    tmpl_stack: list[int] = []      # brace depth at which each open `${` expression started
    brace = 0
    while i < n:
        c = js[i]
        nxt = js[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and js[i] != NL:
                out.append(" ")
                i += 1
            continue
        if c == "/" and nxt == "*":
            out.append("  ")
            i += 2
            while i < n and not (js[i] == "*" and i + 1 < n and js[i + 1] == "/"):
                out.append(_blank(js[i]))
                i += 1
            if i < n:
                out.append("  ")
                i += 2
            continue
        if c in ("'", '"'):
            quote = c
            out.append(" ")
            i += 1
            while i < n and js[i] != quote:
                if js[i] == BACKSLASH and i + 1 < n:
                    out.append(" ")
                    out.append(_blank(js[i + 1]))
                    i += 2
                    continue
                if js[i] == NL:      # unterminated string: stop at the line end
                    break
                out.append(" ")
                i += 1
            if i < n and js[i] == quote:
                out.append(" ")
                i += 1
            continue
        if c == "`":
            out.append(" ")
            i, opened = _template_body(js, i + 1, out)
            if opened:
                tmpl_stack.append(brace)
                brace += 1
            continue
        if c == "/" and _regex_allowed(out):
            end = _regex_end(js, i)
            if end is None:
                # no closing `/` on this line: not a regex literal (JS has no multi-line one), so the `/` is an
                # operator and the rest of the line stays code; a misread `/` never hides a token
                out.append(c)
                i += 1
                continue
            out.append(" " * (end - i))
            i = end
            continue
        if c == "{":
            brace += 1
        elif c == "}":
            brace -= 1
            if tmpl_stack and brace == tmpl_stack[-1]:
                # the end of a ${...} expression: back into the enclosing template literal
                tmpl_stack.pop()
                out.append(" ")
                i, opened = _template_body(js, i + 1, out)
                if opened:
                    tmpl_stack.append(brace)
                    brace += 1
                continue
        out.append(c)
        i += 1
    return "".join(out)


def _blank(ch: str) -> str:
    return NL if ch == NL else " "


def _regex_end(js: str, i: int) -> int | None:
    """The index after the regex literal starting with the `/` at index i (its flags included), or None when no
    closing `/` comes before the end of the line (then it is not a regex literal)."""
    n = len(js)
    j = i + 1
    in_class = False
    while j < n and js[j] != NL:
        ch = js[j]
        if ch == BACKSLASH and j + 1 < n and js[j + 1] != NL:
            j += 2
            continue
        if ch == "[":
            in_class = True
        elif ch == "]":
            in_class = False
        elif ch == "/" and not in_class:
            j += 1
            while j < n and js[j].isalpha():      # flags
                j += 1
            return j
        j += 1
    return None


def _template_body(js: str, i: int, out: list[str]) -> tuple[int, bool]:
    """Blank a template literal's text from index i. Returns (index after the closing backtick, False), or (index
    after a `${`, True) when an expression starts."""
    n = len(js)
    while i < n:
        ch = js[i]
        if ch == BACKSLASH and i + 1 < n:
            out.append(" ")
            out.append(_blank(js[i + 1]))
            i += 2
            continue
        if ch == "`":
            out.append(" ")
            return i + 1, False
        if ch == "$" and i + 1 < n and js[i + 1] == "{":
            out.append("  ")
            return i + 2, True
        out.append(_blank(ch))
        i += 1
    return i, False


def static_check(js: str, *, source: str = "script") -> list[ErrorItem]:
    """E_WAVE_FORBIDDEN_TOKEN items, one per forbidden token found in code (comments and strings excluded), with
    `path` = `<source>:<line>`. Sorted by line then token."""
    code = strip_js(js)
    found: list[tuple[int, str]] = []
    for token, pattern in _PATTERNS:
        for m in pattern.finditer(code):
            start = m.start()
            # the import pattern may start on the separator before the keyword
            if token == "import ":
                start = code.index("import", m.start())
            line = code.count("\n", 0, start) + 1
            found.append((line, token))
    items = [ErrorItem("E_WAVE_FORBIDDEN_TOKEN", f"forbidden token {token!r} in code at line {line} of {source}",
                       path=f"{source}:{line}",
                       hint="generated workflow scripts read the clock from args.now_utc and use no randomness, "
                            "no module loading and no host API")
             for line, token in sorted(set(found))]
    return items


# --- literals, fragments, rendering -------------------------------------------------------------------------------

def js_literal(obj: Any) -> str:
    """JSON as a JS literal: sorted keys, compact, non-ASCII kept, U+2028/U+2029 escaped (WAVES.md 2.1)."""
    text = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


@dataclass(frozen=True)
class Fragment:
    name: str
    source_path: Path
    source: str
    sha256: str


_FUNC_RE = re.compile(r"^async function (feCritique|feDirections)\s*\(\s*api\s*,\s*input\s*\)", re.M)


def fragment_path(name: str) -> Path:
    """`<frontend>/assets/wave-fragments/<critique|directions>.js` for feCritique / feDirections."""
    if name not in FRAGMENT_FILES:
        raise InternalError(f"unknown wave fragment {name!r}", code="E_INTERNAL")
    return other_skill("frontend") / "assets" / "wave-fragments" / FRAGMENT_FILES[name]


def load_fragment(name: str, path: Path | None = None) -> tuple[str, str]:
    """(source, sha256) of a /frontend wave fragment (FRONTEND.md 9.1). DependencyMissing when the file is absent
    or unreadable, does not declare exactly one top-level `async function <name>(api, input)`, or has a forbidden
    token in its code (comments and strings removed first). Never a stand-in implementation."""
    frag = load_fragment_full(name, path)
    return frag.source, frag.sha256


def load_fragment_full(name: str, path: Path | None = None) -> Fragment:
    src_path = Path(path) if path is not None else fragment_path(name)
    where = posix(src_path)
    try:
        data = src_path.read_bytes()
    except OSError as err:
        raise DependencyMissing(f"/frontend wave fragment {where} is absent or unreadable", code="E_DEPENDENCY_MISSING",
                                items=[ErrorItem("E_DEPENDENCY_MISSING", f"{where}: {err.strerror or err}",
                                                 path=where)],
                                data={"fragment": name, "path": where}) from err
    try:
        source = data.decode("utf-8")
    except UnicodeDecodeError as err:
        raise DependencyMissing(f"/frontend wave fragment {where} is not UTF-8", code="E_DEPENDENCY_MISSING",
                                data={"fragment": name, "path": where}) from err
    if source.startswith("\ufeff"):
        source = source[1:]
    declared = _FUNC_RE.findall(strip_js_keep_decl(source))
    if declared.count(name) != 1 or any(d != name for d in declared):
        raise DependencyMissing(f"/frontend wave fragment {where} does not declare exactly one top-level "
                                f"`async function {name}(api, input)`", code="E_DEPENDENCY_MISSING",
                                items=[ErrorItem("E_DEPENDENCY_MISSING", f"declared: {declared or 'none'}",
                                                 path=where)],
                                data={"fragment": name, "path": where})
    problems = static_check(source, source=where)
    if problems:
        raise DependencyMissing(f"/frontend wave fragment {where} has a forbidden token in its code: "
                                f"{problems[0].message}", code="E_DEPENDENCY_MISSING",
                                items=[ErrorItem("E_DEPENDENCY_MISSING", p.message, path=p.path) for p in problems],
                                data={"fragment": name, "path": where})
    return Fragment(name=name, source_path=src_path, source=source, sha256=jsonio.sha256_bytes(data))


def strip_js_keep_decl(source: str) -> str:
    """The stripped code (declarations survive stripping: they are code)."""
    return strip_js(source)


def _bundle(name: str) -> dict:
    doc = schema.bundle(name)
    for key in ("$schema", "$id"):
        doc.pop(key, None)
    return doc


def result_schemas() -> dict[str, dict]:
    """EXTRA.schemas (WAVES.md 3.2): the role result schemas bundled, `merge-result` = the non-null branch of
    result-implementer's `merge` property."""
    out = {name: _bundle(name) for name in ("result-implementer", "result-test-designer", "result-verifier",
                                              "result-reviewer")}
    merge_prop = out["result-implementer"]["properties"]["merge"]
    branch = next((b for b in merge_prop.get("anyOf", []) if b.get("type") == "object"), None)
    if branch is None:
        raise InternalError("result-implementer.schema.json has no object branch under merge", code="E_INTERNAL")
    out["merge-result"] = json.loads(json.dumps(branch))
    return out


def planner_schemas() -> dict[str, dict]:
    return {name: _bundle(name) for name in ("result-planner", "result-test-designer", "result-reviewer")}


def _substitute(template: str, mapping: Mapping[str, str]) -> str:
    text = template
    for token, value in mapping.items():
        if token not in text:
            raise InternalError(f"template placeholder {token} not found", code="E_INTERNAL")
        text = text.replace(token, value)
    if "@@" in text:
        line = text[:text.index("@@")].count("\n") + 1
        raise InternalError(f"a placeholder is left in the rendered script (line {line})", code="E_INTERNAL")
    return text


def _check_name(name: str, description: str) -> None:
    if not WORKFLOW_NAME_RE.match(name):
        raise InternalError(f"workflow name {name!r} does not match {WORKFLOW_NAME_RE.pattern}", code="E_INTERNAL")
    if not DESCRIPTION_RE.match(description):
        raise InternalError(f"workflow description has characters outside [A-Za-z0-9 ,.:()/-]: {description!r}",
                            code="E_INTERNAL")


def render(manifest: Mapping[str, Any], fragments: Sequence[Fragment], *, extra: Mapping[str, Any],
           description: str, template: str | None = None) -> str:
    """The wave script (WAVES.md 2.1). `manifest` is inlined with `launch: null` and `status: "emitted"`;
    `fragments` are inlined verbatim, feDirections before feCritique."""
    text = template if template is not None else WAVE_TEMPLATE.read_bytes().decode("utf-8")
    inlined = dict(manifest)
    inlined["launch"] = None
    inlined["status"] = "emitted"
    by_name = {f.name: f for f in fragments}
    blocks = [by_name[n].source.rstrip("\n") for n in FRAGMENT_ORDER if n in by_name]
    _check_name(str(manifest["workflow_name"]), description)
    return _substitute(text, {
        "@@WORKFLOW_NAME@@": str(manifest["workflow_name"]),
        "@@WORKFLOW_DESCRIPTION@@": description,
        "/*@@MANIFEST@@*/null": js_literal(inlined),
        "/*@@EXTRA@@*/null": js_literal(dict(extra)),
        "/*@@FRAGMENTS@@*/": "\n\n".join(blocks),
    })


def render_planner(planning: Mapping[str, Any], *, name: str, description: str, template: str | None = None) -> str:
    """The planner script (WAVES.md 7.1)."""
    text = template if template is not None else PLANNER_TEMPLATE.read_bytes().decode("utf-8")
    _check_name(name, description)
    return _substitute(text, {
        "@@WORKFLOW_NAME@@": name,
        "@@WORKFLOW_DESCRIPTION@@": description,
        "/*@@PLANNING@@*/null": js_literal(dict(planning)),
    })


# --- the syntax check ---------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class NodeCheck:
    """What `node_check` returns: field for field `procutil.RunResult` (MODULES.md 7: `node_check(path) ->
    RunResult`; lane B10's `agents._node_check` reads `exit_code`, `stderr` and `stdout`). MODULES.md 8 gives this
    module the `schema` edge only, so the shape is declared here rather than imported (contract question Q-B05-18);
    a test keeps the two field lists equal. The check passed iff `exit_code == 0`; a timeout is `timed_out` with
    `exit_code` None, as in procutil."""
    argv: list[str] | str
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_s: float


def node_exe() -> str | None:
    return shutil.which("node")


def wrap_for_check(js: str) -> str:
    """WAVES.md 2.3: an ES module that constructs (never calls) an AsyncFunction from the script's text."""
    body = js.replace("export const meta", "const meta", 1)
    return ("const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;\n"
            "new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', "
            + json.dumps(body, ensure_ascii=True) + ");\n")


def _text(data: bytes | str | None) -> str:
    if data is None:
        return ""
    return data.decode("utf-8", "replace") if isinstance(data, bytes) else data


def node_check(path: Path, *, scratch: Path | None = None) -> NodeCheck:
    """Parse the script at `path` with node (WAVES.md 2.3): the AsyncFunction wrapper of `wrap_for_check`, run by
    node, which parses the body without running it. Passed iff `exit_code == 0`. Node absent: EnvError E_ENV, as
    `procutil.run` raises for a missing executable; callers that only warn when node is absent (WAVES.md 2.3) test
    `node_exe()` first. A run longer than NODE_TIMEOUT_S is killed and returned with `timed_out` True."""
    node = node_exe()
    if node is None:
        raise EnvError("node not found on PATH: the syntax check cannot run", code="E_ENV",
                       hint="install Node.js, or check node_exe() first and warn (W_NODE_MISSING)")
    js = Path(path).read_bytes().decode("utf-8")
    tmp_dir = Path(tempfile.mkdtemp(prefix="exec-check-", dir=str(scratch) if scratch else None))
    try:
        check = tmp_dir / f"check-{Path(path).stem}.mjs"
        with open(check, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(wrap_for_check(js))
        env = {k: v for k, v in os.environ.items() if not k.startswith("NODE_OPTIONS")}
        argv = [node, str(check)]
        start = time.monotonic()
        try:
            proc = subprocess.run(argv, capture_output=True, timeout=NODE_TIMEOUT_S, env=env,
                                  stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired as err:
            _LOG.warning("the node syntax check timed out and was killed",
                         extra={"data": {"script": posix(path), "timeout_s": NODE_TIMEOUT_S}})
            return NodeCheck(argv=argv, exit_code=None, stdout=_text(err.stdout),
                             stderr=_text(err.stderr) or f"node timed out after {NODE_TIMEOUT_S:g} s",
                             timed_out=True, duration_s=round(time.monotonic() - start, 3))
        return NodeCheck(argv=argv, exit_code=proc.returncode, stdout=_text(proc.stdout), stderr=_text(proc.stderr),
                         timed_out=False, duration_s=round(time.monotonic() - start, 3))
    finally:
        remove_temp_dir(tmp_dir)


def remove_temp_dir(path: Path) -> None:
    """Remove a temp directory this module (or `wave`) created for a syntax check. A failure (a file another
    process still holds on Windows) leaves only a stray temp folder: it is logged, never raised over the check's
    own result, and never silent."""
    try:
        shutil.rmtree(path)
    except OSError as err:
        _LOG.warning("a temp directory of the syntax check could not be removed",
                     extra={"data": {"path": posix(path), "error": str(err)}})
