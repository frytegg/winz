"""Tests for scripts/complexity.py (run: python -m unittest discover -s scripts/tests -p "test_complexity.py")."""
from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import complexity as X  # noqa: E402

BOM = chr(0xFEFF)


def fn(result: Dict[str, Any], name: str) -> Dict[str, Any]:
    matches = [f for f in result["functions"] if f["qualname"] == name or f["name"] == name]
    if len(matches) != 1:
        raise AssertionError("{} found {} times in {}".format(name, len(matches),
                                                            result["functions"]))
    return matches[0]


def run_cli(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS / "complexity.py"), *args],
                          capture_output=True, text=True, encoding="utf-8", cwd=str(cwd))


PY_ELIF = """def f(xs):
    with open("x") as h:
        for x in xs:
            if x == 1:
                pass
            elif x == 2:
                pass
            elif x == 3:
                pass
"""

TS_NEST = """function g(xs: number[], a: boolean, b: boolean) {
  for (const x of xs) {
    if (x > 1) {
    } else if (x < 0) {
      while (a) {
        if (a && b) {
        }
      }
    }
  }
}
"""

TS_TRAPS = r"""function h() {
  const a = "{";
  const b = '}';
  // if (x) {
  /* { */
  const r = /\{+/g;
  const t = `a${ {b:1}.b }c{`;
  return a + b + t + r;
}
"""

RUST = r"""fn f<'a>(s: &'a str) -> Result<u8, E> { let c = '{'; let r = r#"{"#; match x { A => 1, B => 2, _ => 3 }; g()?; Ok(0) }
fn o() { let cl = |v| { if v {} }; }
"""

GO = """func (s *S) Run(a, b int) error { switch x { case 1: case 2: }; for { if y {} } }
"""

C_SRC = """#define OPEN { \\
    if (x) {
int f(int a) { const char* s = R"x({)x"; if (a) { return 1; } return a; }
"""


def deep_ts(lines: int = 70, depth: int = 5) -> str:
    out = ["function big(v: number) {"]
    for d in range(depth):
        out.append("  " * (d + 1) + "if (v > {}) {{".format(d))
    body = lines - 2 - 2 * depth
    for k in range(body):
        out.append("  " * (depth + 1) + "v = v + {};".format(k))
    for d in reversed(range(depth)):
        out.append("  " * (d + 1) + "}")
    out.append("}")
    return "\n".join(out) + "\n"


class PythonTest(unittest.TestCase):
    def test_python_elif_chain_stays_at_if_level(self) -> None:
        f = fn(X.analyse_text("m.py", PY_ELIF), "f")
        self.assertEqual(f["max_nesting"], 3)
        self.assertEqual(f["ccn_estimate"], 5)

    def test_python_boolop_and_comprehension(self) -> None:
        r = X.analyse_text("m.py", "def g(xs, a, b, c):\n    return [x for x in xs if a and b or c]\n")
        self.assertEqual(fn(r, "g")["ccn_estimate"], 5)

    def test_python_nested_function_is_separate_and_excluded(self) -> None:
        src = ("def outer(a):\n    if a:\n        pass\n    def inner(b):\n        if b:\n"
               "            return 1\n    return inner\n")
        r = X.analyse_text("m.py", src)
        outer, inner = fn(r, "outer"), fn(r, "outer.inner")
        self.assertEqual(outer["ccn_estimate"], 2)
        self.assertEqual(inner["qualname"], "outer.inner")
        self.assertEqual(outer["nloc"], 4)
        self.assertEqual(inner["nloc"], 3)

    def test_python_method_params_exclude_self_not_staticmethod(self) -> None:
        src = ("class K:\n    def m(self, a, *args, b, **kw):\n        pass\n\n    @staticmethod\n"
               "    def s(a, b):\n        pass\n")
        r = X.analyse_text("m.py", src)
        self.assertEqual(fn(r, "K.m")["params"], 4)
        self.assertEqual(fn(r, "K.s")["params"], 2)

    def test_python_match_wildcard_not_counted(self) -> None:
        src = ("def mt(x):\n    match x:\n        case 1:\n            pass\n        case [a]:\n"
               "            pass\n        case _:\n            pass\n")
        self.assertEqual(fn(X.analyse_text("m.py", src), "mt")["ccn_estimate"], 3)

    def test_python_syntax_error_is_file_error_without_functions(self) -> None:
        r = X.analyse_text("m.py", "def f(:\n    pass\n")
        self.assertTrue(r["error"].startswith("parse error"))
        self.assertEqual(r["functions"], [])


class BraceTest(unittest.TestCase):
    def test_ts_else_if_nesting_and_decisions(self) -> None:
        g = fn(X.analyse_text("m.ts", TS_NEST), "g")
        self.assertEqual(g["max_nesting"], 4)
        self.assertEqual(g["ccn_estimate"], 7)
        self.assertEqual(g["params"], 3)

    def test_ts_braces_in_strings_comments_regex_templates_ignored(self) -> None:
        r = X.analyse_text("m.ts", TS_TRAPS)
        self.assertIsNone(r["error"])
        h = fn(r, "h")
        self.assertEqual(h["ccn_estimate"], 1)
        self.assertEqual(h["max_nesting"], 0)

    def test_ts_arrow_named_by_const_and_class_method(self) -> None:
        src = ("const load = async (p: string): Promise<void> => { if (p) {} }\n"
               "class Foo { bar(a: number, b: string) {} }\n")
        r = X.analyse_text("m.ts", src)
        load = fn(r, "load")
        self.assertEqual((load["params"], load["ccn_estimate"]), (1, 2))
        bar = fn(r, "Foo.bar")
        self.assertEqual(bar["params"], 2)

    def test_ts_ternary_vs_optional_chaining_and_optional_params(self) -> None:
        r = X.analyse_text("m.ts", "function h(x?: number) { const v = a?.b ?? (c ? d : e); }\n")
        h = fn(r, "h")
        self.assertEqual(h["ccn_estimate"], 3)
        self.assertEqual(h["params"], 1)

    def test_rust_match_arms_question_mark_lifetimes_raw_strings(self) -> None:
        r = X.analyse_text("m.rs", RUST)
        self.assertIsNone(r["error"])
        self.assertEqual(fn(r, "f")["ccn_estimate"], 3)
        closure = fn(r, "o.<closure>")
        self.assertEqual(closure["name"], "<closure>")
        self.assertEqual(closure["ccn_estimate"], 2)

    def test_go_receiver_and_switch_cases(self) -> None:
        run = fn(X.analyse_text("m.go", GO), "Run")
        self.assertEqual((run["params"], run["ccn_estimate"], run["max_nesting"]), (2, 5, 2))

    def test_c_preprocessor_and_cpp_raw_string_ignored(self) -> None:
        r = X.analyse_text("m.cpp", C_SRC)
        self.assertIsNone(r["error"])
        self.assertEqual(len(r["functions"]), 1)
        f = fn(r, "f")
        self.assertEqual((f["ccn_estimate"], f["max_nesting"], f["start_line"]), (2, 1, 3))

    def test_crlf_and_bom_equal_lf(self) -> None:
        plain = X.analyse_text("m.ts", TS_NEST)
        crlf = X.analyse_text("m.ts", BOM + TS_NEST.replace("\n", "\r\n"))
        self.assertEqual(plain["functions"], crlf["functions"])
        py = X.analyse_text("m.py", PY_ELIF)
        py_crlf = X.analyse_text("m.py", BOM + PY_ELIF.replace("\n", "\r\n"))
        self.assertEqual(py["functions"], py_crlf["functions"])

    def test_unterminated_string_is_file_error(self) -> None:
        r = X.analyse_text("m.ts", "function f() { const s = 'abc ; }\n")
        self.assertEqual(r["error"], "unbalanced or unterminated tokens at EOF")
        self.assertEqual(r["functions"], [])

    def test_generated_deep_long_function_is_candidate(self) -> None:
        src = deep_ts()
        self.assertEqual(src.count("\n"), 70)
        r = X.analyse_text("m.ts", src)
        big = fn(r, "big")
        self.assertEqual(big["max_nesting"], 5)
        cands = X.candidates([r])
        self.assertEqual(cands[0]["triggers"], ["max_nesting>3", "nloc>60"])


class CliTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        (self.repo / "src").mkdir()
        (self.repo / "src" / "a.ts").write_bytes(TS_NEST.encode("utf-8"))
        (self.repo / "src" / "b.py").write_bytes(PY_ELIF.encode("utf-8"))
        (self.repo / "src" / "big.ts").write_bytes(deep_ts().encode("utf-8"))

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def cli(self, *args: str) -> subprocess.CompletedProcess:
        return run_cli(self.repo, "--repo", str(self.repo), *args)

    def test_unsupported_extension_skipped(self) -> None:
        (self.repo / "notes.md").write_text("# x\n", encoding="utf-8")
        proc = self.cli("notes.md", "--out", "-")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["skipped"], [{"path": "notes.md", "reason": "unsupported language"}])

    def test_tsx_and_jsx_are_skipped(self) -> None:
        for name in ("c.tsx", "d.jsx"):
            (self.repo / name).write_text("export const C = () => <div>it's {x}</div>;\n",
                                          encoding="utf-8")
        data = json.loads(self.cli("c.tsx", "d.jsx", "--out", "-").stdout)
        self.assertEqual([s["reason"] for s in data["skipped"]],
                         ["JSX: not supported by the heuristic tokenizer"] * 2)
        self.assertEqual(data["files"], [])

    def test_files_from_crlf_blank_lines_and_backslashes(self) -> None:
        listing = self.repo / "list.txt"
        listing.write_bytes((BOM + "src\\a.ts\r\n\r\n# comment\r\nsrc/b.py\r\n").encode("utf-8"))
        data = json.loads(self.cli("--files-from", str(listing), "--out", "-").stdout)
        self.assertEqual([f["path"] for f in data["files"]], ["src/a.ts", "src/b.py"])

    def test_empty_list_exit_0(self) -> None:
        listing = self.repo / "empty.txt"
        listing.write_bytes(b"")
        proc = self.cli("--files-from", str(listing), "--out", "-")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["summary"]["files"], 0)
        self.assertEqual(data["candidates"], [])

    def test_no_files_and_no_inscope_is_usage_error(self) -> None:
        proc = self.cli()
        self.assertEqual(proc.returncode, 2)
        self.assertIn("give files or --files-from", proc.stderr)

    def test_output_labels_heuristic_and_triggers_source(self) -> None:
        data = json.loads(self.cli("src/big.ts", "src/a.ts", "--out", "-").stdout)
        self.assertTrue(data["heuristic"])
        self.assertIn("A heuristic, not lizard", data["method"])
        self.assertIn("CX-04", data["triggers"]["source"])
        self.assertEqual(data["triggers"]["nloc"], 60)
        self.assertEqual(data["candidates"][0]["path"], "src/big.ts")

    def test_cli_out_and_csv(self) -> None:
        out = self.repo / ".harden" / "tools" / "complexity.json"
        table = self.repo / "t" / "cx.csv"
        proc = self.cli("src/a.ts", "src/b.py", "--csv", str(table), "--json")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["functions"], 2)
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(data["summary"]["files"], 2)
        raw = table.read_bytes().decode("utf-8")
        self.assertNotIn("\r\n", raw)
        rows = list(csv.reader(raw.splitlines()))
        self.assertEqual(rows[0], ["nloc", "ccn_estimate", "params", "max_nesting", "name",
                                   "start_line", "end_line", "path"])
        self.assertEqual(len(rows), 3)

    def test_outside_repository_is_skipped(self) -> None:
        other = Path(tempfile.mkdtemp())
        try:
            (other / "x.ts").write_text("function x() {}\n", encoding="utf-8")
            data = json.loads(self.cli(str(other / "x.ts"), "--out", "-").stdout)
            self.assertEqual(data["skipped"][0]["reason"], "outside repository")
        finally:
            (other / "x.ts").unlink()
            other.rmdir()


if __name__ == "__main__":
    unittest.main()
