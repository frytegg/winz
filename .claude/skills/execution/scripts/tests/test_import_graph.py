"""The acyclic module graph (contract/MODULES.md 1 and 8; LANES.md B01). Protects every later lane.

Parses every scripts/execlib/*.py with `ast` (top-level and nested imports alike) and fails on: a module missing from
the layer table; an import of a module of the same or a higher layer (layer-0 modules errors, log, clock, paths,
jsonio and model are allowed everywhere); for modules with an explicit edge list (MODULES.md 8), an import outside
it; the rejected edges (events -> state, proof -> answers, report -> schedule); any edge into cli or hookcore;
hookcore importing anything of execlib; cli importing more than envelope; an import cycle. Dynamic imports
(importlib.import_module / __import__ naming an execlib module by a string literal) are checked against the same
graph, and a computed module name is refused, except the allow-listed lazy edges of cli (DYNAMIC_ALLOWED,
COMPUTED_ALLOWED). The hook scripts may import only hookcore from execlib. A planted violation is caught (positive
control).

Run: python -m unittest discover -s scripts/tests -p "test_import_graph.py" -v
"""
from __future__ import annotations

import ast
import unittest

import _support as S

EXECLIB = S.SCRIPTS_DIR / "execlib"
HOOKS = S.SCRIPTS_DIR / "hooks"
LAYER0 = frozenset({"errors", "log", "clock", "paths", "jsonio", "model"})
LAYERS: dict[str, int] = {}
for _layer, _names in enumerate([
        "errors log clock paths jsonio model",
        "schema procutil globs resources graph",
        "locks envelope gitutil",
        "events state",
        "plan statusio decisionsio nevershow",
        "validate templates catalogue status",
        "decisions results integrity hardenbridge quota governor due schedule wavejs",
        "reconcile proof amend answers manual briefs planning agents",
        "merge wave notion report completion ingest initcmd preflight syncstate hooksinstall heartbeat replay "
        "fixture fixmode",
        "hardenready resume",
        "handover"]):
    for _n in _names.split():
        LAYERS[_n] = _layer
LAYERS["cli"] = 99
LAYERS["hookcore"] = -1  # standalone

EDGES_TEXT = """
graph       -> (layer 0 only)
events      -> locks, schema
state       -> schema, locks
plan        -> schema
statusio    -> schema, locks
decisionsio -> schema, locks, events
nevershow   -> schema
validate    -> plan, graph, globs, resources, nevershow, decisionsio, statusio
templates   -> plan, graph, schema
catalogue   -> plan, schema
status      -> plan, statusio, events, state, gitutil, schema
decisions   -> plan, decisionsio, statusio, status, events, state, schema
results     -> schema, events, gitutil, locks
integrity   -> gitutil, nevershow, globs
hardenbridge-> procutil
quota       -> plan, statusio
governor    -> procutil, state, events, gitutil
due         -> plan, statusio, graph
schedule    -> plan, statusio, graph, resources, globs, events
wavejs      -> schema
reconcile   -> status, statusio, results, decisions, decisionsio, events, state, gitutil, plan, quota
proof       -> plan, status, statusio, results, events, gitutil, procutil, hardenbridge, governor, schema
amend       -> plan, graph, validate, templates, catalogue, decisionsio, statusio, status, events, gitutil, locks
answers     -> status, statusio, decisions, events, gitutil, procutil, plan, integrity
manual      -> status, statusio, events, state, plan, decisions
briefs      -> plan, results
agents      -> wavejs
planning    -> templates, validate, catalogue, decisions, decisionsio, schedule, plan, statusio, events
merge       -> gitutil, integrity, hardenbridge, proof, results, governor, events, locks, plan, statusio, nevershow
wave        -> schedule, governor, quota, briefs, wavejs, results, status, statusio, reconcile, decisions, events, state, plan, graph
notion      -> plan, statusio, state, events, integrity
report      -> plan, statusio, state
completion  -> plan, statusio, procutil, schema
ingest      -> schema, decisions, decisionsio, events, state
initcmd     -> gitutil, state, events
preflight   -> governor, quota, procutil, hardenbridge, state, agents
syncstate   -> gitutil, validate, plan, locks, events, integrity
hooksinstall-> state, events, gitutil
heartbeat   -> state, events
replay      -> events, state, statusio, reconcile
fixture     -> gitutil
fixmode     -> amend, decisions, decisionsio, plan
hardenready -> hardenbridge, gitutil, completion, governor, plan, statusio, procutil
resume      -> state, gitutil, replay, reconcile, events, notion, results
handover    -> completion, hardenready, hooksinstall, report, state, events
cli         -> envelope
"""
REJECTED = {("events", "state"), ("proof", "answers"), ("report", "schedule")}


def parse_edges(text: str) -> dict[str, frozenset[str]]:
    out: dict[str, frozenset[str]] = {}
    for line in text.strip().split("\n"):
        left, _arrow, right = line.partition("->")
        mod = left.strip()
        deps = right.strip()
        out[mod] = frozenset() if deps.startswith("(") else frozenset(d.strip() for d in deps.split(","))
    return out


EDGES = parse_edges(EDGES_TEXT)


def execlib_imports(source: str, *, in_package: bool) -> set[str]:
    """Names of execlib modules imported anywhere in `source` ('execlib' itself for the package __init__)."""
    found: set[str] = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ImportFrom):
            if node.level == 1 and in_package:
                if node.module:
                    found.add(node.module.split(".")[0])
                else:
                    for alias in node.names:
                        found.add(alias.name if alias.name in LAYERS else "execlib")
            elif node.level == 0 and node.module and (node.module == "execlib" or node.module.startswith("execlib.")):
                if node.module == "execlib":
                    for alias in node.names:
                        found.add(alias.name if alias.name in LAYERS else "execlib")
                else:
                    found.add(node.module.split(".")[1])
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("execlib."):
                    found.add(alias.name.split(".")[1])
                elif alias.name == "execlib":
                    found.add("execlib")
    return found


_IMPORT_FUNCS = frozenset({"import_module", "__import__"})

# Dynamic imports allowed outside the static graph, each with its reason:
# - cli -> locks, events: `_flush_broken_locks` writes the `error` events of dead holders' locks this call broke
#   (build report deviation 5); MODULES.md 8 gives cli -> envelope only, so the edge is lazy and named here until
#   the contract question on it (Q-B01-1 family, Q-B01-11) is resolved.
DYNAMIC_ALLOWED: dict[str, frozenset[str]] = {"cli": frozenset({"locks", "events"})}
# Computed module names (not a string literal) allowed, as (module, enclosing function): cli's by-name handler
# dispatch from the command table of CLI.md 9 ("handlers lazily, by name").
COMPUTED_ALLOWED = frozenset({("cli", "load_handler")})


def _is_import_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    name = func.attr if isinstance(func, ast.Attribute) else func.id if isinstance(func, ast.Name) else ""
    return name in _IMPORT_FUNCS


def dynamic_imports(source: str) -> tuple[set[str], list[str]]:
    """Execlib modules named by a string literal in importlib.import_module(...) / __import__(...) calls, and the
    enclosing function of every such call whose module name is computed (an f-string, a variable...)."""
    literal: set[str] = set()
    computed: list[str] = []

    def visit(node: ast.AST, func: str) -> None:
        for child in ast.iter_child_nodes(node):
            inner = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else func
            if _is_import_call(child):
                arg = child.args[0] if child.args else None  # type: ignore[attr-defined]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    target = arg.value
                    if target.startswith("execlib."):
                        literal.add(target.split(".")[1])
                    elif target.startswith(".") and len(target) > 1:
                        literal.add(target[1:].split(".")[0])
                else:
                    computed.append(func or "<module>")
            visit(child, inner)

    visit(ast.parse(source), "")
    return literal, computed


def dynamic_violations(mod: str, source: str) -> list[str]:
    literal, computed = dynamic_imports(source)
    out = [f"{mod}.{fn}: dynamic import with a computed module name (the graph test cannot check it)"
           for fn in computed if (mod, fn) not in COMPUTED_ALLOWED]
    for d in sorted(literal - DYNAMIC_ALLOWED.get(mod, frozenset())):
        out += [f"dynamic import {v}" for v in violations(mod, {d})]
    return out


def violations(mod: str, imports: set[str]) -> list[str]:
    out: list[str] = []
    if mod not in LAYERS:
        return [f"{mod}: not in the layer table of MODULES.md 1"]
    deps = {d for d in imports if d not in ("execlib", mod)}
    if mod == "hookcore":
        return [f"hookcore imports execlib.{d} (stdlib only)" for d in sorted(deps)]
    for d in sorted(deps):
        if d not in LAYERS:
            out.append(f"{mod} -> {d}: unknown module")
            continue
        if d in ("cli", "hookcore"):
            out.append(f"{mod} -> {d}: no edge may enter {d}")
            continue
        if (mod, d) in REJECTED:
            out.append(f"{mod} -> {d}: a rejected edge")
            continue
        if d in LAYER0:
            continue
        if mod == "cli":
            if d != "envelope":
                out.append(f"cli -> {d}: cli imports only envelope (handlers lazily, by name)")
            continue
        if LAYERS[d] >= LAYERS[mod]:
            out.append(f"{mod} (layer {LAYERS[mod]}) -> {d} (layer {LAYERS[d]}): not a lower layer")
        elif mod in EDGES and d not in EDGES[mod]:
            out.append(f"{mod} -> {d}: not in the explicit edges of MODULES.md 8")
    return out


def find_cycle(graph: dict[str, set[str]]) -> list[str] | None:
    state: dict[str, int] = {}
    stack: list[str] = []

    def visit(n: str) -> list[str] | None:
        state[n] = 1
        stack.append(n)
        for m in sorted(graph.get(n, ())):
            if state.get(m) == 1:
                return stack[stack.index(m):] + [m]
            if state.get(m) is None:
                found = visit(m)
                if found:
                    return found
        stack.pop()
        state[n] = 2
        return None

    for n in sorted(graph):
        if state.get(n) is None:
            found = visit(n)
            if found:
                return found
    return None


class ImportGraph(unittest.TestCase):
    def test_every_module_respects_the_graph(self) -> None:
        problems: list[str] = []
        graph: dict[str, set[str]] = {}
        files = sorted(EXECLIB.glob("*.py"))
        self.assertGreaterEqual(len(files), 22)
        for path in files:
            mod = path.stem
            if mod == "__init__":
                continue
            source = path.read_text(encoding="utf-8")
            imports = execlib_imports(source, in_package=True)
            lazy, _computed = dynamic_imports(source)
            graph[mod] = {d for d in imports | lazy if d in LAYERS and d != mod}
            problems += violations(mod, imports)
            problems += dynamic_violations(mod, source)
        cycle = find_cycle(graph)
        if cycle:
            problems.append("import cycle: " + " -> ".join(cycle))
        self.assertEqual(problems, [])

    def test_package_init_imports_nothing(self) -> None:
        self.assertEqual(execlib_imports((EXECLIB / "__init__.py").read_text(encoding="utf-8"), in_package=True),
                         set())

    def test_hook_scripts_use_only_hookcore(self) -> None:
        if not HOOKS.is_dir():
            self.skipTest("scripts/hooks/ does not exist yet (lane B08)")
        for path in sorted(HOOKS.glob("*.py")):
            with self.subTest(hook=path.name):
                source = path.read_text(encoding="utf-8")
                imports = execlib_imports(source, in_package=False)
                self.assertLessEqual(imports - {"execlib"}, {"hookcore"})
                lazy, computed = dynamic_imports(source)
                self.assertLessEqual(lazy, {"hookcore"})
                self.assertEqual(computed, [], "a hook script imports no module by a computed name")

    def test_planted_violations_are_caught(self) -> None:
        cases = {
            ("plan", "from .validate import validate_plan\n"): "not a lower layer",
            ("events", "def f():\n    from . import state\n"): "rejected edge",
            ("report", "from execlib import schedule\n"): "rejected edge",
            ("quota", "from .globs import matches\n"): "explicit edges",
            ("cli", "from . import plan\n"): "cli imports only envelope",
            ("hookcore", "import execlib.paths\n"): "stdlib only",
            ("merge", "from .cli import main\n"): "no edge may enter cli",
            ("newmodule", "import os\n"): "not in the layer table",
        }
        for (mod, src), expect in cases.items():
            with self.subTest(module=mod):
                found = violations(mod, execlib_imports(src, in_package=True))
                self.assertTrue(any(expect in v for v in found), found)
        # positive control the other way: legal imports pass
        self.assertEqual(violations("status", execlib_imports(
            "from . import plan, statusio, events, state, gitutil, schema, errors, clock\n", in_package=True)), [])
        self.assertEqual(find_cycle({"a": {"b"}, "b": {"a"}}), ["a", "b", "a"])

    def test_dynamic_imports_are_checked(self) -> None:
        cases = {
            ("events", "import importlib\ndef f():\n    importlib.import_module('execlib.state')\n"): "rejected edge",
            ("plan", "from importlib import import_module\nx = import_module('.validate', 'execlib')\n"):
                "not a lower layer",
            ("cli", "import importlib\ndef g():\n    importlib.import_module('execlib.plan')\n"):
                "cli imports only envelope",
            ("quota", "def h(n):\n    return __import__(f'execlib.{n}')\n"): "computed module name",
            ("cli", "import importlib\ndef other(n):\n    importlib.import_module(n)\n"): "computed module name",
        }
        for (mod, src), expect in cases.items():
            with self.subTest(module=mod, src=src):
                found = dynamic_violations(mod, src)
                self.assertTrue(any(expect in v for v in found), found)
        # positive controls: the allow-listed lazy edges of cli and a non-execlib dynamic import pass
        allowed = ("import importlib\ndef load_handler(spec):\n    importlib.import_module(f'execlib.{spec}')\n"
                   "def _flush_broken_locks():\n    importlib.import_module('execlib.locks')\n"
                   "    importlib.import_module('execlib.events')\n    importlib.import_module('zoneinfo')\n")
        self.assertEqual(dynamic_violations("cli", allowed), [])
        self.assertEqual(dynamic_imports(allowed), ({"locks", "events"}, ["load_handler"]))
        # the real cli is seen: its lazy edges are found (so a new one would be checked)
        lazy, computed = dynamic_imports((EXECLIB / "cli.py").read_text(encoding="utf-8"))
        self.assertEqual((lazy, computed), ({"locks", "events"}, ["load_handler"]))


if __name__ == "__main__":
    unittest.main()
