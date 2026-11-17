"""Static and syntax checks of generated workflow scripts (contract/LANES.md B05, TESTS.md 6, WAVES.md 2).

Protects: every forbidden token is caught in code (alone, with its line number, also inside an inlined fragment and
inside a template-literal expression) and ignored in comments and strings (CLI.md `wave emit` and WAVES.md 2.2 strip
them first; TESTS.md 6's "in a comment" predates that rule: contract question Q-B05-12); `new Date(args.now_utc)` is
allowed, while `new Date;`, computed or optional member reads (`Date['now']()`, `Math?.random()`, `process['env']`)
and code after a postfix `++`/`--` and a division are caught; `js_literal` escapes U+2028/2029 and the script still
parses; generated scripts pass `node --check` (wrapped): one task, ten tasks with in-wave dependencies, an FE critique
task, a relaunch with `args.skip`, a title with U+2028/2029; `node_check` returns procutil.RunResult's shape (MODULES.md
7), a syntax error is a non-zero exit with its SyntaxError, a run past the timeout is `timed_out` and never a pass, an
absent node is E_ENV; fragments are loaded with their sha256 and refused when broken. An independent regex grep of
TESTS.md 6 (its own comment and string blanking, not `wavejs.strip_js`) runs next to `static_check` on every
emitted script.

Run: python -m unittest discover -s scripts/tests -p "test_wavejs.py" -v
"""
from __future__ import annotations

import re
import unittest

import _support as S
import _support_B05 as W

from execlib import jsonio, wavejs
from execlib.errors import DependencyMissing

TESTS_MD_PATTERNS = [r"Date\.now", r"Math\.random", r"new\s+Date\s*\(\s*\)", r"\brequire\s*\(",
                     r"^\s*import\s|\bimport\s*\(", r"\bprocess\."]
PLANTS = {
    "Date.now": "const t = Date.now();",
    "Math.random": "const r = Math.random();",
    "new Date()": "const d = new Date();",
    "require(": "const fs = require('fs');",
    "import ": "import fs from 'node:fs';",
    "process.": "const e = process.env;",
}
LS, PS = chr(0x2028), chr(0x2029)       # LINE SEPARATOR and PARAGRAPH SEPARATOR, built at runtime
# Comments and string literals, left to right (the first opener wins, so `//` inside a string stays a string and a
# quote inside a comment stays a comment). Regex literals and `${...}` are not special here: the generated scripts
# and the pinned fragments put no quote or comment opener inside either.
_BLANK_RE = re.compile(r"//[^\n]*|/\*.*?\*/|\"(?:\\.|[^\"\\\n])*\"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`", re.S)


def independent_grep(js: str) -> list[str]:
    """TESTS.md 6's regexes over the script with comments and strings blanked by this test's own scanner."""
    code = _BLANK_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), js)
    return [p for p in TESTS_MD_PATTERNS if re.search(p, code, re.M)]


class StaticCheckTest(unittest.TestCase):
    def test_each_token_planted_alone_is_caught_with_its_line(self) -> None:
        base = "const ok = 1;\nlog('fine');\n"
        self.assertEqual(wavejs.static_check(base), [])                    # positive control: clean code passes
        self.assertEqual(independent_grep(base), [])
        for token, line in PLANTS.items():
            with self.subTest(token=token):
                items = wavejs.static_check(base + line + "\n")
                self.assertEqual(len(items), 1, items)
                self.assertEqual(items[0].code, "E_WAVE_FORBIDDEN_TOKEN")
                self.assertTrue(items[0].path.endswith(":3"), items[0].path)
                self.assertIn(repr(token), items[0].message)
                self.assertEqual(len(independent_grep(base + line + "\n")), 1)

    def test_comments_and_strings_are_not_code(self) -> None:
        for token, line in PLANTS.items():
            with self.subTest(token=token):
                in_comment = f"// {line}\n/* {line} */\n"
                in_string = f"const s = {line!r};\nconst u = \"{token}\";\n"
                self.assertEqual(wavejs.static_check(in_comment + in_string), [])
                self.assertEqual(independent_grep(in_comment + in_string), [])
                # the same text outside the comment is caught (positive control)
                self.assertTrue(wavejs.static_check(in_comment + line + "\n"))

    def test_template_literal_expression_is_code(self) -> None:
        self.assertEqual(wavejs.static_check("const s = `Date.now() is text here`;\n"), [])
        items = wavejs.static_check("const s = `at ${Date.now()} here`;\n")
        self.assertEqual([i.message.split("'")[1] for i in items], ["Date.now"])
        nested = wavejs.static_check("const s = `a ${`b ${process.env.X}`} c`;\nconst t = Math.random();\n")
        self.assertEqual(sorted(i.message.split("'")[1] for i in nested), ["Math.random", "process."])

    def test_regex_literal_with_quote_does_not_hide_code(self) -> None:
        js = "const r = /it's/g;\nconst t = Date.now();\n"
        self.assertEqual(len(wavejs.static_check(js)), 1)
        self.assertEqual(wavejs.static_check("const r = /it's/g;\nconst x = 4 / 2;\n"), [])

    def test_new_date_with_an_argument_is_allowed(self) -> None:
        self.assertEqual(wavejs.static_check("const d = new Date(args.now_utc);\n"), [])
        self.assertEqual(independent_grep("const d = new Date(args.now_utc);\n"), [])
        self.assertTrue(wavejs.static_check("const d = new Date( );\n"))       # positive control

    def tokens(self, js: str) -> list[tuple[str, str]]:
        return [(i.message.split("'")[1], i.path.rsplit(":", 1)[1]) for i in wavejs.static_check(js)]

    def test_argless_new_date_without_parentheses_is_caught(self) -> None:
        """`new Date;` reads the clock exactly as `new Date()` does."""
        self.assertEqual(self.tokens("const ok = 1;\nconst d = new Date;\n"), [("new Date()", "2")])
        self.assertEqual(self.tokens("const d = new Date\n;\n"), [("new Date()", "1")])
        self.assertEqual(self.tokens("const x = [new Date, 1];\n"), [("new Date()", "1")])
        # positive controls: with an argument, or another constructor whose name starts with Date, nothing is found
        self.assertEqual(self.tokens("const d = new Date(args.now_utc);\nconst e = new Date\n(args.now_utc);\n"), [])
        self.assertEqual(self.tokens("const d = new DateFormat;\n"), [])

    def test_computed_and_optional_member_reads_are_caught(self) -> None:
        cases = {"const t = Date['now']();\n": "Date.now", 'const t = Date["now"]();\n': "Date.now",
                 "const t = Date?.now();\n": "Date.now", "const t = Date?.['now']();\n": "Date.now",
                 "const r = Math['random']();\n": "Math.random", "const r = Math?.random();\n": "Math.random",
                 "const e = process['env'];\n": "process.", "const e = process?.env;\n": "process."}
        for js, token in cases.items():
            with self.subTest(js=js):
                self.assertEqual(self.tokens(js), [(token, "1")])
        # positive controls: other objects' computed members and a string naming the API are not code reads
        self.assertEqual(self.tokens("const v = MANIFEST['now'];\nconst s = \"Date['now']\";\n"), [])

    def test_code_after_a_postfix_increment_and_a_division_is_scanned(self) -> None:
        """`y++ / 2` is a division: the `/` must not open a regex literal that would blank the rest of the line."""
        self.assertEqual(self.tokens("let y = 1;\ny++ / 2; const t = Date.now();\n"), [("Date.now", "2")])
        self.assertEqual(self.tokens("let y = 1;\ny-- / 2; const r = Math.random();\n"), [("Math.random", "2")])
        # a second `/` later on the line would close a misread regex: only the postfix rule keeps the token visible
        self.assertEqual(self.tokens("y++ / 2; const t = Date.now(); const h = w / 2;\n"), [("Date.now", "1")])
        # any `/` without a closing `/` on its line is not a regex literal (`{} / 2` divides an object literal; the
        # tokenizer heuristic reads a regex after `}`): the line stays code
        self.assertEqual(self.tokens("const v = {} / 2; const t = Date.now();\n"), [("Date.now", "1")])
        # positive controls: the clean divisions pass, and a real regex literal still hides its own text
        self.assertEqual(self.tokens("let y = 1;\ny++ / 2;\nconst z = y-- / 3;\n"), [])
        self.assertEqual(self.tokens("const ok = /Date.now() is text/.test(s); y++;\n"), [])

    def test_token_inside_an_inlined_fragment_is_caught(self) -> None:
        man = W.harness_manifest([W.harness_task("T001", chain=("fe-critique", "integrator", "verifier"))])
        good = W.fake_fragment("feCritique")
        clean = W.render_script(man, fragments=[good])
        self.assertEqual(wavejs.static_check(clean), [])
        self.assertEqual(independent_grep(clean), [])
        bad_src = good.source.replace("const keys =", "const noise = Math.random();\n  const keys =")
        bad = wavejs.Fragment(name="feCritique", source_path=good.source_path, source=bad_src,
                              sha256=good.sha256)
        script = W.render_script(man, fragments=[bad])
        items = wavejs.static_check(script, source="waves/W01.js")
        self.assertEqual(len(items), 1)
        line_no = int(items[0].path.rsplit(":", 1)[1])
        self.assertIn("Math.random", script.split("\n")[line_no - 1])
        self.assertEqual(independent_grep(script), [r"Math\.random"])

    def test_templates_and_real_fragments_are_clean(self) -> None:
        for path in (wavejs.WAVE_TEMPLATE, wavejs.PLANNER_TEMPLATE, *W.REAL_FRAGMENTS.values()):
            text = path.read_text(encoding="utf-8")
            self.assertEqual(wavejs.static_check(text), [], path.name)
            self.assertEqual(independent_grep(text), [], path.name)
        # /frontend's real headers name the tokens in comments: a literal scan would refuse them (WAVES.md 2.2)
        header = W.REAL_FRAGMENTS["feCritique"].read_text(encoding="utf-8").split("*/", 1)[0]
        self.assertIn("Date.now", header)


class LiteralAndFragmentTest(unittest.TestCase):
    def test_js_literal(self) -> None:
        text = wavejs.js_literal({"b": f"x{LS}y{PS}z", "a": chr(0xE9)})
        self.assertNotIn(LS, text)
        self.assertNotIn(PS, text)
        self.assertIn(chr(92) + "u2028", text)
        self.assertIn(chr(92) + "u2029", text)
        self.assertIn(chr(0xE9), text, "other non-ASCII characters stay as they are")
        self.assertTrue(text.startswith('{"a"'), "keys are sorted")
        self.assertNotIn(" ", text, "compact separators")

    def test_load_fragment_hash_and_refusals(self) -> None:
        good = W.B05_FIXTURES / "fragments" / "critique.js"
        source, digest = wavejs.load_fragment("feCritique", good)
        self.assertEqual(digest, jsonio.sha256_file(good))
        self.assertEqual(source, good.read_text(encoding="utf-8"))
        for name, path in W.REAL_FRAGMENTS.items():                     # the real ones load too (pinned copies)
            self.assertEqual(wavejs.load_fragment(name, path)[1], jsonio.sha256_file(path))
        with self.assertRaises(DependencyMissing) as ctx:
            wavejs.load_fragment("feCritique", W.B05_FIXTURES / "fragments-bad" / "critique.js")
        self.assertIn("Math.random", ctx.exception.message)
        with self.assertRaises(DependencyMissing):
            wavejs.load_fragment("feCritique", W.B05_FIXTURES / "fragments" / "absent.js")
        with self.assertRaises(DependencyMissing):           # the file declares feDirections, not feCritique
            wavejs.load_fragment("feCritique", W.B05_FIXTURES / "fragments" / "directions.js")


@unittest.skipUnless(W.node_available(), "node is needed")
class NodeCheckTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def check(self, script: str, name: str) -> wavejs.NodeCheck:
        return wavejs.node_check(S.write_text(self.tmp / f"{name}.js", script))

    def test_result_has_the_run_result_shape(self) -> None:
        """MODULES.md 7: `node_check(path) -> RunResult`; lane B10's `agents._node_check` reads `exit_code`, `stderr`
        and `stdout`. wavejs has no edge to procutil (MODULES.md 8), so the field lists are compared here."""
        import dataclasses

        from execlib import procutil

        ours = [(f.name, str(f.type)) for f in dataclasses.fields(wavejs.NodeCheck)]
        theirs = [(f.name, str(f.type)) for f in dataclasses.fields(procutil.RunResult)]
        self.assertEqual(ours, theirs)
        res = self.check("const a = 1;\nreturn a;\n", "shape")
        self.assertEqual((res.exit_code, res.timed_out), (0, False))
        self.assertIsInstance(res.stdout, str)
        self.assertIsInstance(res.stderr, str)
        self.assertGreaterEqual(res.duration_s, 0)
        self.assertEqual(res.argv[0], wavejs.node_exe())

    def test_generated_scripts_parse(self) -> None:
        one = W.harness_manifest([W.harness_task("T001")])
        ten = W.harness_manifest([W.harness_task(f"T{i:03d}", lane=f"L{i % 3 + 1}", rank=i,
                                                 deps=[f"T{i - 1:03d}"] if i > 1 else [])
                                  for i in range(1, 11)])
        fe = W.harness_manifest([W.harness_task("T001", chain=("fe-critique", "integrator", "verifier"))])
        relaunch = W.harness_manifest([W.harness_task("T001"), W.harness_task("T002", lane="L2", deps=["T001"])],
                                      skip=["T001"])
        cases = {"one": W.render_script(one), "ten": W.render_script(ten),
                 "fe": W.render_script(fe, fragments=[W.fake_fragment("feCritique")]),
                 "relaunch-skip": W.render_script(relaunch)}
        title = W.harness_manifest([W.harness_task("T001")])
        title["tasks"][0]["agents"]["implementer"]["label"] = f"T001 line{LS}sep{PS}para"
        cases["u2028"] = W.render_script(title)
        self.assertNotIn(LS, cases["u2028"])
        for name, script in cases.items():
            with self.subTest(name=name):
                self.assertEqual(wavejs.static_check(script), [])
                self.assertEqual(independent_grep(script), [])
                res = self.check(script, name)
                self.assertEqual(res.exit_code, 0, res.stderr)

    def test_syntax_error_is_reported(self) -> None:
        res = self.check("const a = ;\nreturn 1;\n", "bad")
        self.assertNotIn(res.exit_code, (0, None))
        self.assertFalse(res.timed_out)
        self.assertIn("SyntaxError", res.stderr)
        good = self.check("const a = 1;\nreturn a;\n", "good")                 # top-level return accepted
        self.assertEqual((good.exit_code, good.timed_out), (0, False))

    def test_node_timeout_is_reported_not_passed(self) -> None:
        """A node run that does not finish within NODE_TIMEOUT_S is killed: exit_code None, timed_out True (never a
        pass). Node itself runs the loop: the wrapper is replaced for this test only."""
        from unittest import mock

        with mock.patch.object(wavejs, "NODE_TIMEOUT_S", 2.0), \
                mock.patch.object(wavejs, "wrap_for_check", lambda js: "for (;;) {}\n"):
            res = self.check("const a = 1;\n", "loop")
        self.assertTrue(res.timed_out)
        self.assertIsNone(res.exit_code)
        self.assertIn("timed out", res.stderr)
        ends = "let n = 0;\nfor (;;) { if (++n > 5) break; }\n"
        with mock.patch.object(wavejs, "NODE_TIMEOUT_S", 30.0), \
                mock.patch.object(wavejs, "wrap_for_check", lambda js: ends):
            fine = self.check("const a = 1;\n", "short")                    # positive control: same path, it ends
        self.assertEqual((fine.exit_code, fine.timed_out), (0, False))

    def test_node_absent_is_an_environment_error(self) -> None:
        from unittest import mock

        from execlib.errors import EnvError

        with mock.patch.object(wavejs, "node_exe", lambda: None):
            with self.assertRaises(EnvError) as caught:
                self.check("const a = 1;\n", "nonode")
        self.assertEqual(caught.exception.items()[0].code, "E_ENV")


if __name__ == "__main__":
    unittest.main()
