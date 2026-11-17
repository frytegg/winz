"""Test helpers of lane B10 (agents, SKILL.md, references).

- A fake `execlib.wavejs` built on the signatures of MODULES.md 5 (`js_literal`, `static_check`, `node_check`), used
  only while lane B05's real module is absent (LANES.md 1: modules of lanes not yet integrated are faked in tests,
  never in execlib/). `wavejs_module()` returns the real module when it exists.
- Markdown scanning shared by test_skill_md.py and test_references.py: the `exec.py <words> [options]` mentions, the
  skill-relative paths, the headings.

Not a test module (no test_ prefix).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import types
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

import _support as S

FORBIDDEN = ("Date.now", "Math.random", "new Date()", "require(", "import ", "process.")


def strip_js(js: str) -> str:
    """Comments, string literals and template literals replaced by spaces (newlines kept, so line numbers hold)."""
    out: list[str] = []
    i, n = 0, len(js)
    while i < n:
        c = js[i]
        nxt = js[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = js.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i))
            i = j
        elif c == "/" and nxt == "*":
            j = js.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append("".join(ch if ch == "\n" else " " for ch in js[i:j]))
            i = j
        elif c in ("'", '"', "`"):
            j = i + 1
            while j < n and js[j] != c:
                j += 2 if js[j] == "\\" else 1
            j = min(j + 1, n)
            out.append("".join(ch if ch == "\n" else " " for ch in js[i:j]))
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def _static_check(js: str) -> list:
    from execlib.errors import ErrorItem
    items = []
    for lineno, line in enumerate(strip_js(js).split("\n"), start=1):
        for token in FORBIDDEN:
            if token in line:
                items.append(ErrorItem("E_WAVE_FORBIDDEN_TOKEN", f"forbidden token {token!r} in code",
                                       path=f"line {lineno}"))
    return items


def _js_literal(obj: Any) -> str:
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029"))


@dataclass(frozen=True)
class FakeRun:
    argv: list[str]
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_s: float


def _node_check(path: Path) -> FakeRun:
    """WAVES.md 2.3: wrap the script in an AsyncFunction constructor (parses without running) and run node."""
    script = Path(path).read_text(encoding="utf-8").replace("export const meta", "const meta")
    wrapper = ("const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;\n"
               "new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', "
               + json.dumps(script) + ");\n")
    with tempfile.TemporaryDirectory(prefix="exec-test-") as tmp:
        check = Path(tmp) / "check.mjs"
        with open(check, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(wrapper)
        proc = subprocess.run(["node", str(check)], capture_output=True, timeout=60)
    return FakeRun(["node", str(check)], proc.returncode, proc.stdout.decode("utf-8", "replace"),
                   proc.stderr.decode("utf-8", "replace"), False, 0.0)


def real_wavejs_exists() -> bool:
    return (S.SCRIPTS_DIR / "execlib" / "wavejs.py").exists()


def fake_wavejs() -> types.ModuleType:
    mod = types.ModuleType("execlib.wavejs")
    mod.FORBIDDEN = FORBIDDEN  # type: ignore[attr-defined]
    mod.strip_js = strip_js  # type: ignore[attr-defined]
    mod.static_check = _static_check  # type: ignore[attr-defined]
    mod.js_literal = _js_literal  # type: ignore[attr-defined]
    mod.node_check = _node_check  # type: ignore[attr-defined]
    return mod


class wavejs_installed:
    """Context manager: the real execlib.wavejs when it exists, else the fake registered in sys.modules (removed on
    exit, so no other test sees it)."""

    def __enter__(self) -> types.ModuleType:
        import execlib
        self.injected = False
        if real_wavejs_exists():
            from execlib import wavejs
            return wavejs
        self.injected = True
        mod = fake_wavejs()
        sys.modules["execlib.wavejs"] = mod
        setattr(execlib, "wavejs", mod)
        return mod

    def __exit__(self, *exc: object) -> None:
        if self.injected:
            import execlib
            sys.modules.pop("execlib.wavejs", None)
            if hasattr(execlib, "wavejs"):
                delattr(execlib, "wavejs")


# ------------------------------------------------------------------------------------------------ markdown scanning

DOC_FILES = ("SKILL.md",)
REFERENCES = ("tick", "planning", "waves", "manual-tasks", "notion", "hackathon-profile", "frontend", "two-dev",
              "fix-mode", "recovery", "handover", "agents")
B10_REFERENCES = tuple(r for r in REFERENCES if r != "notion")
EXEC_RE = re.compile(r"exec\.py[\"']?[ \t]+([a-z][a-z-]*)(?:[ \t]+([a-z][a-z-]*))?")
CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
PATH_ROOTS = ("references/", "assets/", "scripts/", "contract/", "evals/", "research/")
TOP_FILES = ("SKILL.md", "ARCHITECTURE.md")


def read_doc(rel: str) -> str:
    return (S.SKILL_DIR / rel).read_text(encoding="utf-8")


def headings(text: str, level: int = 2) -> list[str]:
    """The `## ` (level 2) headings in order, outside fenced code blocks."""
    out: list[str] = []
    fence = False
    prefix = "#" * level + " "
    for line in text.split("\n"):
        if line.startswith("```"):
            fence = not fence
            continue
        if not fence and line.startswith(prefix):
            out.append(line[len(prefix):].strip())
    return out


@dataclass(frozen=True)
class ExecMention:
    file: str
    line: int
    words: tuple[str, ...]
    options: tuple[str, ...]
    in_code: bool


def exec_mentions(rel: str, text: str) -> Iterator[ExecMention]:
    """Every `exec.py <w1> [<w2>]` in the text. In a code span, the `--options` after it in the same span are
    collected (up to the next `exec.py` or the end of the span)."""
    for lineno, line in enumerate(text.split("\n"), start=1):
        spans = [(m.start(1), m.end(1)) for m in CODE_SPAN_RE.finditer(line)]
        for m in EXEC_RE.finditer(line):
            words = tuple(w for w in (m.group(1), m.group(2)) if w)
            span = next(((a, b) for a, b in spans if a <= m.start() < b), None)
            options: tuple[str, ...] = ()
            if span is not None:
                rest = line[m.end():span[1]]
                nxt = rest.find("exec.py")
                rest = rest if nxt == -1 else rest[:nxt]
                options = tuple(re.findall(r"(?<![\w-])(--[a-z][a-z0-9-]*)", rest))
            yield ExecMention(rel, lineno, words, options, span is not None)


def path_mentions(text: str) -> Iterator[tuple[int, str]]:
    """Skill-relative paths named in code spans or Markdown links: tokens starting with a top-level directory of
    the skill (`references/`, `assets/`, ...) or naming SKILL.md / ARCHITECTURE.md."""
    for lineno, line in enumerate(text.split("\n"), start=1):
        tokens = [m.group(1) for m in CODE_SPAN_RE.finditer(line)]
        tokens += re.findall(r"\]\(([^)\s]+)\)", line)
        for tok in tokens:
            for part in tok.split():
                part = part.strip("\"'(),;:")
                if part.startswith(PATH_ROOTS) or part in TOP_FILES:
                    yield lineno, part


def literal_prefix(path: str) -> str:
    """The part of a path before its first placeholder or glob character, cut back to a whole segment."""
    cut = len(path)
    for ch in ("<", "*", "{", "?", "["):
        idx = path.find(ch)
        if idx != -1:
            cut = min(cut, idx)
    if cut == len(path):
        return path.rstrip("/")
    return path[:cut].rsplit("/", 1)[0] if "/" in path[:cut] else ""


def owner_of(path: str) -> str | None:
    """The lane owning a skill-relative path, from contract/LANES.md section 4 (None when unlisted)."""
    text = read_doc("contract/LANES.md")
    section = text.split("## 4. Ownership map", 1)[1].split("\n## 5.", 1)[0]
    for row in section.split("\n"):
        cells = [c.strip() for c in row.strip().strip("|").split("|")]
        if len(cells) < 2 or not cells[-1].startswith("B"):
            continue
        lane = cells[-1].split()[0]
        for glob in re.findall(r"`([^`]+)`", cells[0]):
            for expanded in _expand_braces(glob):
                if _glob_owns(expanded, path):
                    return lane
    return None


def _expand_braces(glob: str) -> list[str]:
    m = re.search(r"\{([^{}]*)\}", glob)
    if not m:
        return [glob]
    out: list[str] = []
    for alt in m.group(1).split(","):
        out += _expand_braces(glob[:m.start()] + alt + glob[m.end():])
    return out


def _glob_owns(glob: str, path: str) -> bool:
    if glob.endswith("/**"):
        return path == glob[:-3] or path.startswith(glob[:-2])
    if "*" in glob:
        rx = "^" + re.escape(glob).replace(r"\*\*", ".*").replace(r"\*", "[^/]*") + "$"
        return re.match(rx, path) is not None
    return path == glob or path.startswith(glob.rstrip("/") + "/")


def node_available() -> bool:
    return S.tool_available("node")
