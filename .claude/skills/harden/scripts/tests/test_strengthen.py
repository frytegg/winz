"""Tests for scripts/strengthen.py (unittest, temporary git repositories, no network).

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional, Set

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import strengthen as st  # noqa: E402

_SAVED_ENV: Dict[str, Optional[str]] = {}
_GIT_HOME: Optional[str] = None
BOM = chr(0xFEFF)


def setUpModule() -> None:
    """Isolate git from the user's global/system configuration."""
    global _GIT_HOME
    _GIT_HOME = tempfile.mkdtemp(prefix="harden-st-gitcfg-")
    cfg = Path(_GIT_HOME) / "gitconfig"
    cfg.write_text("[user]\n\tname = Harden Test\n\temail = harden@example.invalid\n"
                   "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n"
                   "[core]\n\tautocrlf = false\n", encoding="utf-8")
    values = {"GIT_CONFIG_GLOBAL": str(cfg), "GIT_CONFIG_NOSYSTEM": "1",
              "GIT_AUTHOR_NAME": "Harden Test", "GIT_AUTHOR_EMAIL": "harden@example.invalid",
              "GIT_COMMITTER_NAME": "Harden Test", "GIT_COMMITTER_EMAIL": "harden@example.invalid"}
    for key, value in values.items():
        _SAVED_ENV[key] = os.environ.get(key)
        os.environ[key] = value


def tearDownModule() -> None:
    for key, value in _SAVED_ENV.items():
        if value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = value
    if _GIT_HOME:
        _rmtree(_GIT_HOME)


def _rmtree(path: str) -> None:
    def fix(func, target, _exc):  # type: ignore[no-untyped-def]
        os.chmod(target, stat.S_IWRITE)
        func(target)
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=fix)
    else:
        shutil.rmtree(path, onerror=fix)


JS_BASE = ("import { describe, expect, it } from 'vitest';\n"
           "import { add } from '../src/math';\n"
           "\n"
           "describe('add', () => {\n"
           "  it('adds', () => {\n"
           "    const r = add(1, 2);\n"
           "    expect(r).toBeTruthy();\n"
           "  });\n"
           "\n"
           "  it('adds zero', () => {\n"
           "    expect(add(0, 0)).toBe(0);\n"
           "  });\n"
           "});\n")
PY_BASE = "from src.app import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n"
RS_BASE = "#[test]\nfn adds() {\n    assert_eq!(1 + 1, 2);\n}\n"
GO_BASE = ("package calc\n\nimport \"testing\"\n\nfunc TestAdd(t *testing.T) {\n"
           "\tif Add(1, 2) != 3 {\n\t\tt.Fatal(\"bad\")\n\t}\n}\n")
SOL_BASE = ("// SPDX-License-Identifier: MIT\npragma solidity ^0.8.13;\n\n"
            "import {Test} from \"forge-std/Test.sol\";\n\ncontract CounterTest is Test {\n"
            "    function test_Increment() public {\n        uint256 x = 1;\n"
            "        assertEq(x, 1);\n    }\n}\n")
JS = "tests/engine.test.ts"
PY = "tests/test_app.py"
RS = "tests/it.rs"
GO = "calc_test.go"
SOL = "test/Counter.t.sol"


def TAIL_JS(line: str) -> str:  # noqa: N802 - the spec's name
    anchor = "    expect(r).toBeTruthy();\n"
    return JS_BASE.replace(anchor, anchor + line, 1)


def before_last(base: str, closing: str, text: str) -> str:
    index = base.rindex(closing)
    return base[:index] + text + base[index:]


def codes(problems: List[st.Problem]) -> Set[str]:
    return {p.code for p in problems}


class AcceptanceTests(unittest.TestCase):
    def test_pure_tail_append_is_accepted(self) -> None:
        self.assertEqual(st.check_additions(JS_BASE, TAIL_JS("    expect(r).toBe(3);\n"), JS), [])

    def test_tail_of_a_test_in_the_middle_of_the_file_is_accepted(self) -> None:
        self.assertEqual(st.check_additions(JS_BASE, TAIL_JS("    expect(r).toBe(3);\n"), JS), [])
        anchor = "    expect(add(0, 0)).toBe(0);\n"
        new = JS_BASE.replace(anchor, anchor + "    expect(add(0, 1)).toBe(1);\n")
        self.assertEqual(st.check_additions(JS_BASE, new, JS), [])

    def test_insertion_before_an_existing_line_is_refused(self) -> None:
        anchor = "    expect(r).toBeTruthy();\n"
        new = JS_BASE.replace(anchor, "    expect(r).toBe(3);\n" + anchor)
        problems = st.check_additions(JS_BASE, new, JS)
        self.assertEqual(codes(problems), {"not-at-tail"})
        self.assertEqual(problems[0].line, 7)

    def test_modified_assertion_is_refused(self) -> None:
        new = JS_BASE.replace("toBeTruthy()", "toBeDefined()")
        problems = st.check_additions(JS_BASE, new, JS)
        self.assertEqual(len(problems), 1)
        self.assertEqual(problems[0].code, "removed-line")
        self.assertIsNone(problems[0].line)
        self.assertIn("'expect(r).toBeTruthy();'", problems[0].message)

    def test_removed_line_is_refused(self) -> None:
        new = JS_BASE.replace("    expect(add(0, 0)).toBe(0);\n", "")
        self.assertEqual([p.code for p in st.check_additions(JS_BASE, new, JS)], ["removed-line"])

    def test_bom_change_is_refused(self) -> None:
        self.assertEqual([p.code for p in st.check_additions(BOM + PY_BASE, PY_BASE, PY)],
                         ["bom-changed"])


class MarkerTests(unittest.TestCase):
    def test_skip_focus_and_fail_markers_are_refused(self) -> None:
        cases = []
        for opener in ("it.skip(", "test.only(", "it.failing(", "test.fails("):
            block = "\n  {}'later', () => {{\n    expect(1).toBe(1);\n  }});\n".format(opener)
            cases.append((JS, JS_BASE, before_last(JS_BASE, "});\n", block), set()))
        cases.append((PY, PY_BASE, PY_BASE + "\n\n@pytest.mark.skip\ndef test_later():\n"
                      "    assert 1\n", {"decorator"}))
        cases.append((RS, RS_BASE, RS_BASE + "\n#[test]\n#[ignore]\nfn later() {\n"
                      "    assert!(true);\n}\n", {"decorator"}))
        cases.append((GO, GO_BASE, before_last(GO_BASE, "}\n", "\tt.Skip(\"x\")\n"), set()))
        cases.append((SOL, SOL_BASE, before_last(SOL_BASE, "    }\n}\n", "        vm.skip(true);\n"),
                      set()))
        for path, old, new, extra in cases:
            with self.subTest(path=path, new=new[-60:]):
                found = codes(st.check_additions(old, new, path))
                self.assertIn("skip-marker", found)
                self.assertTrue(extra <= found, found)

    def test_wrapping_an_existing_assertion_in_if_false_is_refused(self) -> None:
        anchor = "    expect(r).toBeTruthy();\n"
        new = JS_BASE.replace(anchor, "    if (false) {\n" + anchor + "    }\n")
        problems = st.check_additions(JS_BASE, new, JS)
        self.assertIn("unbalanced-run", codes(problems))
        self.assertGreaterEqual(len(problems), 2)

    def test_try_catch_around_existing_assertion_is_refused(self) -> None:
        anchor = "    expect(r).toBeTruthy();\n"
        new = JS_BASE.replace(anchor, "    try {\n" + anchor + "    } catch (e) {}\n")
        self.assertTrue({"unbalanced-run", "catch"} <= codes(st.check_additions(JS_BASE, new, JS)))

    def test_early_return_is_refused(self) -> None:
        self.assertEqual(codes(st.check_additions(JS_BASE, TAIL_JS("    return;\n"), JS)),
                         {"early-exit"})


class DoubleAndBindingTests(unittest.TestCase):
    def test_mocks_hooks_and_snapshots_are_refused(self) -> None:
        block = "\n  it('later', () => {\n    beforeEach(() => {});\n  });\n"
        cases = [(JS, JS_BASE, JS_BASE + "vi.mock('../src/math');\n", "test-double"),
                 (JS, JS_BASE, TAIL_JS("    expect(r).toMatchSnapshot();\n"), "snapshot-assertion"),
                 (JS, JS_BASE, before_last(JS_BASE, "});\n", block), "hook"),
                 (PY, PY_BASE, PY_BASE + "    monkeypatch.setattr('x', 1)\n", "test-double")]
        for path, old, new, code in cases:
            with self.subTest(code=code):
                self.assertIn(code, codes(st.check_additions(old, new, path)))

    def test_hoisted_declaration_named_like_old_name_is_refused(self) -> None:
        self.assertIn("rebinds-existing-name",
                      codes(st.check_additions(JS_BASE, TAIL_JS("    var add = () => 3;\n"), JS)))

    def test_assignment_to_outer_names_is_refused(self) -> None:
        self.assertIn("assigns-outer-name",
                      codes(st.check_additions(JS_BASE, TAIL_JS("    r.extra = 1;\n"), JS)))
        env = codes(st.check_additions(JS_BASE, TAIL_JS("    process.env.TZ = 'UTC';\n"), JS))
        self.assertTrue({"env-or-live-access", "assigns-outer-name"} <= env)
        self.assertIn("assigns-outer-name",
                      codes(st.check_additions(JS_BASE, TAIL_JS("    this.value = 2;\n"), JS)))
        self.assertEqual(st.check_additions(
            JS_BASE, TAIL_JS("    const box = { n: 1 };\n    box.n = 2;\n"), JS), [])

    def test_mutating_call_on_outer_name_is_refused(self) -> None:
        self.assertIn("mutating-call",
                      codes(st.check_additions(JS_BASE, TAIL_JS("    r.push(1);\n"), JS)))
        self.assertEqual(st.check_additions(
            JS_BASE, TAIL_JS("    const xs = [];\n    xs.push(1);\n"), JS), [])


class PythonTests(unittest.TestCase):
    def test_python_new_test_at_eof_is_accepted(self) -> None:
        self.assertEqual(st.check_additions(
            PY_BASE, PY_BASE + "\n\ndef test_add_zero():\n    assert add(0, 0) == 0\n", PY), [])

    def test_python_def_shadowing_an_existing_test_is_refused(self) -> None:
        self.assertIn("rebinds-existing-name", codes(st.check_additions(
            PY_BASE, PY_BASE + "\n\ndef test_add():\n    assert True\n", PY)))

    def test_python_module_level_statement_is_refused(self) -> None:
        self.assertIn("not-a-test-definition", codes(st.check_additions(
            PY_BASE, PY_BASE + "\nadd = lambda a, b: 3\n", PY)))

    def test_python_tail_and_local_rebinding_are_accepted(self) -> None:
        self.assertEqual(st.check_additions(
            PY_BASE, PY_BASE + "    total = add(2, 2)\n    assert total == 4\n", PY), [])


class ImportAndEolTests(unittest.TestCase):
    def test_header_named_import_is_accepted_and_side_effect_import_refused(self) -> None:
        lines = JS_BASE.split("\n")

        def insert(text: str) -> str:
            return "\n".join(lines[:2] + [text] + lines[2:])
        self.assertEqual(st.check_additions(JS_BASE, insert("import { sub } from '../src/math';"),
                                            JS), [])
        self.assertIn("side-effect-import",
                      codes(st.check_additions(JS_BASE, insert("import '../src/setup';"), JS)))
        py_lines = PY_BASE.split("\n")
        new = "\n".join(py_lines[:1] + ["from other import add"] + py_lines[1:])
        self.assertIn("rebinds-existing-name", codes(st.check_additions(PY_BASE, new, PY)))

    def test_crlf_file_with_tail_append_is_accepted(self) -> None:
        old = JS_BASE.replace("\n", "\r\n")
        new = TAIL_JS("    expect(r).toBe(3);\n")
        self.assertEqual(st.check_additions(old, new.replace("\n", "\r\n"), JS), [])
        self.assertEqual(st.check_additions(old, new, JS), [])

    def test_missing_final_newline_append(self) -> None:
        old = "def test_a():\n    assert 1"
        new = "def test_a():\n    assert 1\n    assert 2\n"
        self.assertEqual(st.check_additions(old, new, PY), [])
        self.assertEqual(st.expected_deletions(old, new), 1)
        self.assertEqual(st.expected_deletions(PY_BASE, PY_BASE + "    assert 2\n"), 0)


class ScannerTests(unittest.TestCase):
    def test_blank_only_run_is_ignored(self) -> None:
        anchor = "    const r = add(1, 2);\n"
        self.assertEqual(st.check_additions(JS_BASE, JS_BASE.replace(anchor, anchor + "\n"), JS),
                         [])

    def test_brackets_in_strings_and_comments_are_ignored(self) -> None:
        self.assertEqual(st.check_additions(
            JS_BASE, TAIL_JS("    expect('{').toBe('{'); // }\n"), JS), [])

    def test_insertion_inside_an_old_template_literal_is_refused(self) -> None:
        base = TAIL_JS("    expect(out).toBe(`a\nb`);\n")
        new = base.replace("`a\n", "`a\nc\n")
        self.assertIn("inside-literal", codes(st.check_additions(base, new, JS)))

    def test_insertion_inside_an_old_object_literal_is_refused(self) -> None:
        base = TAIL_JS("    expect(obj).toEqual({\n      a: 1,\n    });\n")
        new = base.replace("      a: 1,\n", "      a: 1,\n      b: 2,\n")
        self.assertIn("not-in-test", codes(st.check_additions(base, new, JS)))


class OtherLanguageTests(unittest.TestCase):
    def test_go_rust_and_solidity_tails_are_accepted(self) -> None:
        go = before_last(GO_BASE, "}\n", "\tif Add(2, 2) != 4 {\n\t\tt.Fatal(\"bad\")\n\t}\n")
        self.assertEqual(st.check_additions(GO_BASE, go, GO), [])
        rs = before_last(RS_BASE, "}\n", "    assert_eq!(2 + 2, 4);\n")
        self.assertEqual(st.check_additions(RS_BASE, rs, RS), [])
        sol = before_last(SOL_BASE, "    }\n}\n", "        assertTrue(x > 0);\n")
        self.assertEqual(st.check_additions(SOL_BASE, sol, SOL), [])
        ffi = before_last(SOL_BASE, "    }\n}\n", "        vm.ffi(new string[](0));\n")
        self.assertIn("env-or-live-access", codes(st.check_additions(SOL_BASE, ffi, SOL)))

    def test_rust_nested_item_named_like_old_is_refused(self) -> None:
        rs = before_last(RS_BASE, "}\n", "    fn adds() {}\n")
        self.assertIn("rebinds-existing-name", codes(st.check_additions(RS_BASE, rs, RS)))

    def test_not_strengthenable_files(self) -> None:
        cases = [(("tests/__snapshots__/a.snap", ""), {"snapshot": True}, "snapshot"),
                 (("tests/__fixtures__/a.test.ts", JS_BASE), {}, "__fixtures__"),
                 (("tests/conftest.py", PY_BASE), {}, "support file"),
                 (("tests/test_x.rb", "def test_x; end\n"), {}, "unsupported language"),
                 (("tests/helpers2.ts", "export const x = 1;\n"), {}, "no test definition")]
        for (path, text), flags, needle in cases:
            with self.subTest(path=path):
                result = st.not_strengthenable(path, text, snapshot=flags.get("snapshot", False),
                                               protected=False)
                self.assertIsNotNone(result)
                self.assertIn(needle, result)
        self.assertIsNone(st.not_strengthenable(JS, JS_BASE, snapshot=False, protected=False))


class ToolAndRevertTests(unittest.TestCase):
    def test_apply_tool_edit_reproduces_edit_write_and_multiedit(self) -> None:
        crlf = PY_BASE.replace("\n", "\r\n")
        text, problem = st.apply_tool_edit("Edit", {"old_string": "    assert add(1, 2) == 3\n",
                                                    "new_string": "    assert add(1, 2) == 3\n"
                                                                  "    assert 1\n"}, crlf)
        self.assertIsNone(problem)
        self.assertIn("assert 1", text or "")
        _t, problem = st.apply_tool_edit("Edit", {"old_string": "nope", "new_string": "x"},
                                         PY_BASE)
        self.assertEqual(problem.code if problem else None, "unverifiable")
        _t, problem = st.apply_tool_edit("Edit", {"old_string": "\n", "new_string": "x"},
                                         PY_BASE)
        self.assertEqual(problem.code if problem else None, "unverifiable")
        text, problem = st.apply_tool_edit("MultiEdit", {"edits": [
            {"old_string": "== 3\n", "new_string": "== 3\n    assert 2\n"},
            {"old_string": "    assert 2\n", "new_string": "    assert 2\n    assert 3\n"}]},
            PY_BASE)
        self.assertIsNone(problem)
        self.assertTrue((text or "").endswith("    assert 2\n    assert 3\n"))
        text, problem = st.apply_tool_edit("Write", {"content": "x\n"}, PY_BASE)
        self.assertEqual((text, problem), ("x\n", None))

    def test_revert_may_remove_only_lines_its_target_added(self) -> None:
        self.assertEqual(st.check_revert(PY_BASE + "    assert 2\n", PY_BASE,
                                         Counter({"assert 2": 1})), [])
        self.assertIn("removed-line", codes(st.check_revert(PY_BASE, "def test_add():\n    pass\n",
                                                            Counter())))

    def test_budget_and_long_lines_are_unverifiable(self) -> None:
        self.assertEqual(codes(st.check_additions(JS_BASE, TAIL_JS("    expect(r).toBe(3);\n"), JS,
                                                  deadline=time.monotonic() - 1)),
                         {"unverifiable"})
        long_line = "    expect(r).toBe('" + "x" * 5000 + "');\n"
        self.assertEqual(codes(st.check_additions(JS_BASE, TAIL_JS(long_line), JS)),
                         {"unverifiable"})

    def test_mismatched_brackets_are_unbalanced(self) -> None:
        self.assertIn("unbalanced-run",
                      codes(st.check_additions(JS_BASE, TAIL_JS("    foo(1];\n"), JS)))

    def test_live_access_and_session_exit_patterns(self) -> None:
        cases = [(PY, PY_BASE, PY_BASE + "    pytest.exit('x', returncode=0)\n", "early-exit"),
                 (JS, JS_BASE, TAIL_JS("    ctx.skip();\n"), "skip-marker")]
        for line in ("    const { ethers: live } = await network.connect('hederaTestnet');\n",
                     "    console.log(hre.config.networks);\n",
                     "    const w = new ethers.Wallet(k);\n", "    Client.forTestnet();\n",
                     "    const s = readFileSync('../../.env', 'utf8');\n"):
            cases.append((JS, JS_BASE, TAIL_JS(line), "env-or-live-access"))
        for path, old, new, code in cases:
            with self.subTest(line=new[-70:]):
                self.assertIn(code, codes(st.check_additions(old, new, path)))

    def test_messages_redact_hex_keys(self) -> None:
        key = "0x" + "ab12" * 16
        old = PY_BASE + "    k = '{}'\n".format(key)
        problems = st.check_additions(old, PY_BASE, PY)
        self.assertEqual(problems[0].code, "removed-line")
        self.assertIn("0x***", problems[0].message)
        self.assertNotIn(key, problems[0].message)


class GitRepo:
    def __init__(self) -> None:
        self.path = Path(tempfile.mkdtemp(prefix="harden-st-"))
        self.git("init", "-q")

    def git(self, *args: str) -> str:
        proc = subprocess.run(["git", *args], cwd=str(self.path), stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, check=False)
        if proc.returncode != 0:
            raise RuntimeError("git {} failed: {}".format(args, proc.stderr.decode(
                errors="replace")))
        return proc.stdout.decode("utf-8", errors="replace")

    def write(self, rel: str, text: str) -> None:
        target = self.path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(str(target), "w", encoding="utf-8", newline="") as handle:
            handle.write(text)

    def commit(self, message: str) -> str:
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD").strip()

    def write_active(self, base: str) -> None:
        hdir = self.path / ".harden"
        hdir.mkdir(exist_ok=True)
        (hdir / "active").write_text(json.dumps({"base_sha": base, "mode": "auto",
                                                 "test_globs": [], "protected_globs": [],
                                                 "allow_test_deletions": []}), encoding="utf-8")
        exclude = self.path / ".git" / "info" / "exclude"
        exclude.parent.mkdir(parents=True, exist_ok=True)
        with open(str(exclude), "a", encoding="utf-8") as handle:
            handle.write("\n/.harden/\n")


def candidate(path: str) -> bool:
    return path.startswith("tests/")


def run_main(args: List[str]) -> tuple:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = st.main(args)
    return code, out.getvalue(), err.getvalue()


class GitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = GitRepo()
        self.addCleanup(_rmtree, str(self.repo.path))

    def test_commit_walk_flags_a_commit_that_changes_an_added_line(self) -> None:
        self.repo.write(PY, PY_BASE)
        base = self.repo.commit("base")
        self.repo.write(PY, PY_BASE + "    assert add(2, 2) == 4\n")
        self.repo.commit("strengthen")
        self.repo.write(PY, PY_BASE + "    assert add(2, 2)\n")
        sha2 = self.repo.commit("weaken")
        walk = st.commit_walk(self.repo.path, base, "HEAD", candidate)
        self.assertEqual([(w["commit"], w["file"], w["problem"].code) for w in walk],
                         [(sha2, PY, "removed-line")])

    def test_commit_walk_accepts_a_revert_of_a_strengthening_commit(self) -> None:
        self.repo.write(PY, PY_BASE)
        base = self.repo.commit("base")
        self.repo.write(PY, PY_BASE + "    assert add(2, 2) == 4\n")
        self.repo.commit("strengthen")
        self.repo.git("revert", "--no-edit", "HEAD")
        self.assertEqual(st.commit_walk(self.repo.path, base, "HEAD", candidate), [])

    def test_commit_walk_skips_a_commit_reverted_later(self) -> None:
        self.repo.write(PY, PY_BASE)
        base = self.repo.commit("base")
        self.repo.write(PY, PY_BASE.replace("== 3", "== 4"))
        self.repo.commit("weaken")
        self.repo.git("revert", "--no-edit", "HEAD")
        self.assertEqual(st.commit_walk(self.repo.path, base, "HEAD", candidate), [])

    def test_commit_walk_refuses_a_revert_that_adds_lines(self) -> None:
        self.repo.write(PY, PY_BASE)
        base = self.repo.commit("base")
        self.repo.write(PY, PY_BASE + "    assert add(2, 2) == 4\n")
        sha1 = self.repo.commit("strengthen")
        self.repo.write(PY, PY_BASE + "    assert True\n")
        sha2 = self.repo.commit("Revert\n\nThis reverts commit {}.\n".format(sha1))
        walk = st.commit_walk(self.repo.path, base, "HEAD", candidate)
        self.assertTrue(any(w["commit"] == sha2 and w["problem"].code == "revert-adds-more"
                            for w in walk), walk)

    def replay_repo(self, flag: str = "good\n") -> str:
        self.repo.write("src/flag.txt", "good\n")
        self.repo.write("tests/test_x.py", "def test_x():\n    assert 1\n")
        base = self.repo.commit("base")
        gate = [sys.executable, "-c",
                "import sys,pathlib; t=pathlib.Path('tests/test_x.py').read_text(); "
                "f=pathlib.Path('src/flag.txt').read_text().strip(); print('1 ok'); "
                "sys.exit(0 if (f=='good' or 'MASK' in t) else 1)"]
        self.repo.write_active(base)
        (self.repo.path / ".harden" / "config.json").write_text(json.dumps(
            {"gates": [{"name": "test", "cmd": gate, "count_regex": "(\\d+) ok"}]}),
            encoding="utf-8")
        self.repo.write("src/flag.txt", flag)
        self.repo.write("tests/test_x.py", "def test_x():\n    assert 1\n    # MASK\n")
        self.repo.git("add", "-A")
        return base

    def test_replay_passes_and_restores_bytes(self) -> None:
        self.replay_repo()
        code, out, err = run_main(["replay", "--repo", str(self.repo.path), "--label", "r1"])
        self.assertEqual(code, 0, out + err)
        self.assertIn("MASK", (self.repo.path / "tests/test_x.py").read_text(encoding="utf-8"))
        record = json.loads((self.repo.path / ".harden/tools/replay-r1.json").read_text(
            encoding="utf-8"))
        self.assertEqual(record["result"], "pass")
        self.assertFalse((self.repo.path / st.STATE_NAME).exists())

    def test_replay_fails_when_the_base_version_fails(self) -> None:
        self.replay_repo("bad\n")
        code, out, err = run_main(["replay", "--repo", str(self.repo.path), "--label", "r2"])
        self.assertEqual(code, 1, out + err)
        record = json.loads((self.repo.path / ".harden/tools/replay-r2.json").read_text(
            encoding="utf-8"))
        self.assertEqual(record["result"], "fail")
        self.assertIn("MASK", (self.repo.path / "tests/test_x.py").read_text(encoding="utf-8"))

    def test_replay_nothing_to_replay(self) -> None:
        self.repo.write("tests/test_x.py", "def test_x():\n    assert 1\n")
        base = self.repo.commit("base")
        self.repo.write_active(base)
        code, out, _err = run_main(["replay", "--repo", str(self.repo.path), "--label", "r3"])
        self.assertEqual(code, 0)
        self.assertIn("nothing to replay", out)

    def test_replay_refuses_unstaged_changes(self) -> None:
        self.replay_repo()
        text = "def test_x():\n    assert 1\n    # MASK\n    assert 2\n"
        self.repo.write("tests/test_x.py", text)
        code, _out, err = run_main(["replay", "--repo", str(self.repo.path), "--label", "r4"])
        self.assertEqual(code, 2, err)
        self.assertEqual((self.repo.path / "tests/test_x.py").read_text(encoding="utf-8"), text)

    def test_replay_leftover_state_blocks_until_restore(self) -> None:
        self.replay_repo()
        state = self.repo.path / st.STATE_NAME
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text(json.dumps({"label": "x", "files": ["tests/test_x.py"]}),
                         encoding="utf-8")
        code, _out, err = run_main(["replay", "--repo", str(self.repo.path), "--label", "r5"])
        self.assertEqual(code, 2)
        self.assertIn("strengthen.py restore", err)
        code, _out, _err = run_main(["restore", "--repo", str(self.repo.path)])
        self.assertEqual(code, 0)
        self.assertFalse(state.exists())

    def test_replay_sets_aside_added_test_files_and_restores_them(self) -> None:
        self.replay_repo("bad\n")
        gate = [sys.executable, "-c",
                "import sys,pathlib; f=pathlib.Path('src/flag.txt').read_text().strip(); "
                "print('1 ok'); sys.exit(0 if (f=='good' or "
                "pathlib.Path('tests/test_zz_mask.py').exists()) else 1)"]
        (self.repo.path / ".harden" / "config.json").write_text(json.dumps(
            {"gates": [{"name": "test", "cmd": gate, "count_regex": "(\\d+) ok"}]}),
            encoding="utf-8")
        mask = "def test_z():\n    assert 1\n"
        self.repo.write("tests/test_zz_mask.py", mask)
        self.repo.git("add", "-A")
        code, out, err = run_main(["replay", "--repo", str(self.repo.path), "--label", "r6"])
        self.assertEqual(code, 1, out + err)
        self.assertEqual((self.repo.path / "tests/test_zz_mask.py").read_bytes(),
                         mask.encode("utf-8"))
        record = json.loads((self.repo.path / ".harden/tools/replay-r6.json").read_text(
            encoding="utf-8"))
        self.assertEqual(record["hidden"], ["tests/test_zz_mask.py"])
        self.assertFalse((self.repo.path / st.STATE_NAME).exists())

    def test_replay_refuses_untracked_new_test_files(self) -> None:
        self.replay_repo()
        self.repo.write("tests/test_new.py", "def test_n():\n    assert 1\n")
        code, _out, err = run_main(["replay", "--repo", str(self.repo.path), "--label", "r7"])
        self.assertEqual(code, 2)
        self.assertIn("stage them first", err)
        self.assertIn("MASK", (self.repo.path / "tests/test_x.py").read_text(encoding="utf-8"))

    def test_restore_writes_the_recorded_blobs(self) -> None:
        self.replay_repo()
        staged = self.repo.git("ls-files", "-s", "tests/test_x.py").split()[1]
        state = self.repo.path / st.STATE_NAME
        state.parent.mkdir(parents=True, exist_ok=True)
        state.write_text(json.dumps({"label": "x", "files": ["tests/test_x.py"], "hidden": [],
                                     "blobs": {"tests/test_x.py": staged}}), encoding="utf-8")
        self.repo.write("tests/test_x.py", "other\n")
        self.repo.git("add", "-A")
        code, out, _err = run_main(["restore", "--repo", str(self.repo.path)])
        self.assertEqual(code, 0)
        blob = self.repo.git("cat-file", "-p", staged)
        self.assertEqual((self.repo.path / "tests/test_x.py").read_text(encoding="utf-8"), blob)
        self.assertIn("index blob", out)

    def test_list_prints_strengthened_and_set_aside_files(self) -> None:
        self.replay_repo()
        self.repo.write("tests/test_new.py", "def test_n():\n    assert 1\n")
        self.repo.git("add", "-A")
        code, out, _err = run_main(["list", "--repo", str(self.repo.path)])
        self.assertEqual(code, 0)
        self.assertIn("strengthened: tests/test_x.py (+1 lines)", out)
        self.assertIn("set aside for replay: tests/test_new.py", out)


if __name__ == "__main__":
    unittest.main()
