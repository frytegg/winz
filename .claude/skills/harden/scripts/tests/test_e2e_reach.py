"""Tests for scripts/e2e_reach.py (run: python -m unittest discover -s scripts/tests -p "test_e2e_reach.py")."""
from __future__ import annotations

import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import e2e_reach as R  # noqa: E402

HAS_GIT = shutil.which("git") is not None

CLI_BASE = "import { check } from './engine.js';\nexport function main(): void {\n  check();\n}\n"
ENGINE_BASE = ("export function check(): number {\n  return 1;\n}\n\n"
               "export function other(): number {\n  return 2;\n}\n")
ENGINE_HEAD = ("export function check(): number {\n  return 3;\n}\n\n"
               "export function other(): number {\n  return 2;\n}\n")
UNUSED_BASE = "export function lonely(): number {\n  return 1;\n}\n"
UNUSED_HEAD = "export function lonely(): number {\n  return 4;\n}\n"


def v8_script(url: str, functions: List[Tuple[str, int]]) -> Dict[str, Any]:
    fns = [{"functionName": "", "ranges": [{"startOffset": 0, "endOffset": 1000, "count": 1}]}]
    for i, (name, count) in enumerate(functions):
        fns.append({"functionName": name, "isBlockCoverage": True,
                    "ranges": [{"startOffset": 10 + i, "endOffset": 20 + i, "count": count}]})
    return {"scriptId": "1", "url": url, "functions": fns}


def file_url(path: str) -> str:
    return "file:///" + path.lstrip("/")


@unittest.skipUnless(HAS_GIT, "git is needed")
class E2eReachTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        (self.root / "nohooks").mkdir()
        self.git("init", "-q")
        self.clone = (self.root / "scratch" / "verify-1").as_posix()

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def git(self, *args: str) -> str:
        cmd = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c",
               "commit.gpgsign=false", "-c",
               "core.hooksPath=" + (self.root / "nohooks").as_posix(), *args]
        return subprocess.run(cmd, cwd=str(self.repo), capture_output=True,
                              check=True).stdout.decode("utf-8")

    def write(self, files: Dict[str, Optional[str]]) -> None:
        for rel, text in files.items():
            path = self.repo / rel
            if text is None:
                path.unlink()
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(text.encode("utf-8"))

    def commit(self, message: str, files: Dict[str, Optional[str]]) -> str:
        self.write(files)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD").strip()

    def js_project(self) -> str:
        base = self.commit("base", {
            "package.json": json.dumps({"name": "fx", "bin": {"fx": "./dist/cli.js"},
                                        "scripts": {"cli": "node dist/cli.js",
                                                    "help": "pnpm run cli --help"}}),
            "src/cli.ts": CLI_BASE, "src/engine.ts": ENGINE_BASE,
            "src/unused.ts": UNUSED_BASE, "src/old.ts": "export const old = 1;\n",
            "tests/engine.test.ts": "import { check } from '../src/engine.js';\ncheck();\n",
            "README.md": "# fx\n"})
        self.commit("head", {"src/engine.ts": ENGINE_HEAD, "src/unused.ts": UNUSED_HEAD,
                             "src/old.ts": None,
                             "tests/engine.test.ts": "import { check } from '../src/engine.js';\n",
                             "README.md": "# fx tool\n"})
        tools = self.repo / ".harden" / "tools"
        tools.mkdir(parents=True, exist_ok=True)
        (tools / "ts-program.json").write_text(json.dumps({
            "edges": [{"from": "src/cli.ts", "to": "src/engine.ts"}],
            "emitted": {"src/cli.ts": ["dist/cli.js"], "src/engine.ts": ["dist/engine.js"],
                        "src/unused.ts": ["dist/unused.js"]}}), encoding="utf-8")
        return base

    def profile(self, e2e: List[Dict[str, Any]]) -> None:
        hdir = self.repo / ".harden"
        hdir.mkdir(exist_ok=True)
        (hdir / "profile.json").write_text(json.dumps({"version": 1, "e2e": e2e}),
                                           encoding="utf-8")

    def v8(self, scripts: List[Dict[str, Any]], files: Optional[int] = None,
           clone: Optional[str] = None) -> None:
        rel = ".harden/verify/r1/e2e-coverage/cli-help"
        cov = self.repo / rel
        cov.mkdir(parents=True, exist_ok=True)
        if scripts:
            (cov / "coverage-1.json").write_text(json.dumps({"result": scripts}),
                                                 encoding="utf-8")
        record = {"check": "cli help", "clone": clone or self.clone, "sha": "x", "dir": rel,
                  "exit_code": 0, "timed_out": False,
                  "files": len(scripts) and 1 if files is None else files}
        (self.repo / ".harden" / "verify.json").write_text(
            json.dumps({"e2e_coverage": [record]}), encoding="utf-8")

    def run_tool(self, base: str, *extra: str) -> Tuple[int, Dict[str, Any], str]:
        out = self.root / "reach.json"
        buf, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            code = R.main(["--repo", str(self.repo), "--base", base, "--out", str(out), *extra])
        data = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
        return code, data, buf.getvalue() + err.getvalue()

    @staticmethod
    def by_path(data: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        return {f["path"]: f for f in data["files"]}

    # -------------------------------------------------------------------
    def test_changed_production_files_exclude_tests_docs_and_mark_deleted(self) -> None:
        base = self.js_project()
        self.profile([])
        code, data, _ = self.run_tool(base)
        self.assertEqual(code, 0)
        files = self.by_path(data)
        self.assertEqual(sorted(files), ["src/engine.ts", "src/old.ts", "src/unused.ts"])
        self.assertEqual(files["src/old.ts"]["status"], "deleted")
        self.assertEqual(data["summary"]["deleted"], 1)
        self.assertEqual(data["summary"]["changed_production_files"], 2)

    def test_changed_functions_from_diff_hunks(self) -> None:
        self.assertEqual(R.hunk_ranges("@@ -2 +2 @@\n-a\n+b\n@@ -7,0 +8,2 @@\n+x\n+y\n"
                                       "@@ -3,2 +0,0 @@\n"), [[2, 2], [8, 9], [1, 1]])
        units = R.changed_units("src/engine.ts", ENGINE_HEAD, [[2, 2]])
        self.assertEqual(units["functions"], ["check"])
        self.assertFalse(units["toplevel"])
        py = "import os\n\ndef run(a):\n    return a + 1\n\nX = 1\n"
        units = R.changed_units("app.py", py, [[4, 4], [6, 6]])
        self.assertEqual(units["functions"], ["run"])
        self.assertTrue(units["toplevel"])

    def test_entry_from_node_command_package_script_and_bin(self) -> None:
        project = R.Project(self.repo, ["src/cli.ts", "src/engine.ts"],
                            {"src/cli.ts": ["dist/cli.js"]},
                            {"name": "fx", "bin": {"fx": "./dist/cli.js"},
                             "scripts": {"cli": "node dist/cli.js", "help": "pnpm run cli"}},
                            None)
        for cmd in ("node dist/cli.js --help", "pnpm cli", "pnpm run help", "npm run cli",
                    "pnpm exec fx --help", "npx fx", ["node", "--require", "x.js", "dist/cli.js"],
                    "FORCE_COLOR=0 node dist/cli.js plugins && echo done"):
            with self.subTest(cmd=cmd):
                entries, _note, lang = R.entry_files(cmd, project)
                self.assertEqual(entries, ["src/cli.ts"])
                self.assertEqual(lang, "JavaScript")
        entries, note, _ = R.entry_files("node -e \"console.log(1)\"", project)
        self.assertEqual(entries, [])
        self.assertIn("inline code", note)
        entries, note, _ = R.entry_files("pnpm exec eslint .", project)
        self.assertIn("external bin", note)

    def test_entry_python_module_and_project_scripts(self) -> None:
        files = ["src/pkg/__init__.py", "src/pkg/cli.py", "tools/run.py"]
        project = R.Project(self.repo, files, {}, None,
                            {"project": {"scripts": {"pkg-cli": "pkg.cli:main"}}})
        self.assertEqual(R.entry_files("python -m pkg.cli --help", project)[0], ["src/pkg/cli.py"])
        self.assertEqual(R.entry_files("uv run --frozen python -S tools/run.py", project)[0],
                         ["tools/run.py"])
        self.assertEqual(R.entry_files("pkg-cli --help", project)[0], ["src/pkg/cli.py"])
        self.assertIn("inline code", R.entry_files("python -c 'print(1)'", project)[1])

    def test_emitted_output_maps_back_to_source(self) -> None:
        project = R.Project(self.repo, ["src/cli.ts"], {"src/cli.ts": ["dist/cli.js"]}, None, None)
        self.assertEqual(project.source_of("./dist/cli.js"), "src/cli.ts")
        self.assertEqual(R.map_script(self.clone + "/dist/cli.js", self.clone, project),
                         "src/cli.ts")

    def test_ts_static_reachability_marks_imported_and_not_reached(self) -> None:
        base = self.js_project()
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        code, data, _ = self.run_tool(base)
        files = self.by_path(data)
        self.assertEqual(files["src/engine.ts"]["status"], "imported")
        self.assertEqual(files["src/unused.ts"]["status"], "not-reached")

    def test_python_import_graph_src_layout_relative_and_importlib(self) -> None:
        texts = {"src/pkg/__init__.py": "",
                 "src/pkg/cli.py": "from . import core\nfrom .sub import deep\n"
                                   "import importlib\nimportlib.import_module('pkg.plugin')\n",
                 "src/pkg/core.py": "import pkg.util\n",
                 "src/pkg/util.py": "",
                 "src/pkg/sub/__init__.py": "",
                 "src/pkg/sub/deep.py": "from ..util import x\n",
                 "src/pkg/plugin.py": "",
                 "src/pkg/lonely.py": ""}
        graph = R.python_edges(texts)
        reached = R.bfs(graph, ["src/pkg/cli.py"])
        for path in ("src/pkg/core.py", "src/pkg/util.py", "src/pkg/sub/deep.py",
                     "src/pkg/plugin.py"):
            self.assertIn(path, reached)
        self.assertNotIn("src/pkg/lonely.py", reached)

    def test_v8_coverage_executed_vs_loaded_not_executed(self) -> None:
        base = self.js_project()
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([v8_script(file_url(self.clone + "/dist/cli.js"), [("main", 1)]),
                 v8_script(file_url(self.clone + "/dist/engine.js"),
                           [("check", 0), ("other", 1)])])
        code, data, out = self.run_tool(base)
        self.assertEqual(code, 0)
        files = self.by_path(data)
        self.assertEqual(files["src/engine.ts"]["status"], "loaded-not-executed")
        self.assertEqual(files["src/unused.ts"]["status"], "not-loaded")
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"), [("check", 3)])])
        _, data, _ = self.run_tool(base)
        engine = self.by_path(data)["src/engine.ts"]
        self.assertEqual((engine["status"], engine["by"]), ("executed", "cli help"))
        self.assertIn("function check", engine["detail"])

    def test_v8_urls_windows_drive_and_percent_encoding(self) -> None:
        self.assertEqual(R.url_to_path("file:///C:/Users/My%20Dir/a.js"), "C:/Users/My Dir/a.js")
        self.assertEqual(R.url_to_path("file:///home/u/a.js"), "/home/u/a.js")
        self.assertIsNone(R.url_to_path("node:internal/main"))
        project = R.Project(self.repo, ["src/cli.ts"], {"src/cli.ts": ["dist/cli.js"]}, None, None)
        self.assertEqual(R.map_script("C:/Users/My Dir/verify-1/dist/cli.js",
                                      "C:/Users/My Dir/verify-1", project), "src/cli.ts")

    def test_v8_node_modules_same_suffix_ignored(self) -> None:
        project = R.Project(self.repo, ["src/index.ts"], {"src/index.ts": ["dist/index.js"]},
                            None, None)
        self.assertIsNone(R.map_script(self.clone + "/node_modules/pkg/dist/index.js",
                                       self.clone, project))
        self.assertIsNone(R.map_script("/x/node_modules/pkg/dist/index.js", None, project))
        self.assertIsNone(R.map_script("/elsewhere/dist/index.js", self.clone, project))

    def test_coverage_py_json_changed_lines(self) -> None:
        base = self.commit("base", {"app.py": "def run(a):\n    return a\n",
                                    "main.py": "import app\napp.run(1)\n"})
        self.commit("head", {"app.py": "def run(a):\n    return a + 1\n"})
        self.profile([{"name": "py", "cmd": "python main.py"}])
        report = self.root / "cov.json"
        report.write_text(json.dumps({"files": {str(self.repo / "app.py"): {
            "executed_lines": [1, 2]}}}), encoding="utf-8")
        code, data, _ = self.run_tool(base, "--coverage", "py=" + str(report))
        app = self.by_path(data)["app.py"]
        self.assertEqual(app["status"], "executed")
        self.assertIn("1 of 1 changed lines ran", app["detail"])
        report.write_text(json.dumps({"files": {"app.py": {"executed_lines": [1]}}}),
                          encoding="utf-8")
        _, data, _ = self.run_tool(base, "--coverage", "py=" + str(report))
        self.assertEqual(self.by_path(data)["app.py"]["status"], "loaded-not-executed")

    def test_no_e2e_checks_is_gates_only(self) -> None:
        base = self.js_project()
        code, data, out = self.run_tool(base)
        self.assertTrue(data["summary"]["gates_only"])
        self.assertIn("gates only", self.by_path(data)["src/engine.ts"]["detail"])

    def test_unresolved_entry_is_not_shown_with_reason(self) -> None:
        base = self.js_project()
        self.profile([{"name": "cli help", "cmd": "node -e \"require('x')\""}])
        _, data, _ = self.run_tool(base)
        engine = self.by_path(data)["src/engine.ts"]
        self.assertEqual(engine["status"], "not-shown")
        self.assertIn("inline code", engine["detail"])

    def test_cargo_run_reports_rust_not_computed(self) -> None:
        project = R.Project(self.repo, ["src/main.rs"], {}, None, None)
        entries, note, lang = R.entry_files("cargo run --bin engine -- --help", project)
        self.assertEqual((entries, lang), ([], "Rust"))
        self.assertIn("import reachability not computed", note)

    def test_summary_line_and_markdown_bullets(self) -> None:
        base = self.js_project()
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"), [("check", 1)])])
        code, data, out = self.run_tool(base)
        self.assertTrue(data["summary_line"].startswith("e2e executed 1 of 2 changed modules"))
        self.assertIn("- src/engine.ts: executed by cli help (V8, function check)", out)
        self.assertIn("- src/old.ts: deleted", out)
        self.assertIn(data["summary_line"], out)

    def test_no_coverage_files_falls_back_to_static_with_note(self) -> None:
        base = self.js_project()
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([], files=0)
        _, data, _ = self.run_tool(base)
        files = self.by_path(data)
        self.assertEqual(files["src/engine.ts"]["status"], "imported")
        self.assertEqual(data["checks"][0]["coverage_note"], R.NO_COVERAGE_NOTE)

    def test_parse_error_never_claims_executed(self) -> None:
        base = self.js_project()
        self.commit("broken", {"src/engine.ts": "export function check( { return 'x ;\n"})
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"), [("check", 1)])])
        _, data, _ = self.run_tool(base)
        engine = self.by_path(data)["src/engine.ts"]
        self.assertEqual(engine["status"], "loaded-execution-not-shown")
        self.assertIn("not shown", engine["detail"])

    def test_duplicate_function_names_are_ambiguous(self) -> None:
        base = self.js_project()
        dup = ("export class A {\n  check(): number {\n    return 5;\n  }\n}\n"
               "export class B {\n  check(): number {\n    return 6;\n  }\n}\n")
        self.commit("dup", {"src/engine.ts": dup})
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"), [("check", 1)])])
        _, data, _ = self.run_tool(base)
        engine = self.by_path(data)["src/engine.ts"]
        self.assertEqual(engine["status"], "loaded-execution-not-shown")
        self.assertIn("ambiguous (2 functions named check)", engine["detail"])

    def test_bad_base_and_malformed_coverage_exit_2(self) -> None:
        base = self.js_project()
        self.assertEqual(self.run_tool("nope")[0], 2)
        self.assertEqual(self.run_tool(base, "--coverage", "no-equals")[0], 2)
        self.assertEqual(self.run_tool(base, "--coverage", "x=" + str(self.root / "none"))[0], 2)
        (self.repo / ".harden" / "verify.json").write_text("{not json", encoding="utf-8")
        self.assertEqual(self.run_tool(base)[0], 2)

    # -- function-level reach (pilot-auto-calibration A01-F48) ---------------------------
    def test_comment_and_type_only_changes_are_no_runtime_change(self) -> None:
        base = self.js_project()
        self.commit("types", {"src/engine.ts": "/** Engine. */\nimport type { X } from './x.js';\n"
                              + ENGINE_HEAD})
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        head_only = self.git("rev-parse", "HEAD~1").strip()
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"), [("check", 0)])])
        _, data, out = self.run_tool(head_only)
        engine = self.by_path(data)["src/engine.ts"]
        self.assertEqual(engine["status"], "no-runtime-change")
        self.assertIn("- src/engine.ts: no runtime change", out)

    def test_top_level_import_does_not_make_the_module_executed(self) -> None:
        base = self.js_project()
        self.commit("imp", {"src/engine.ts": "import { z } from './z.js';\n" + ENGINE_HEAD})
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"), [("check", 0)])])
        _, data, _ = self.run_tool(base)
        engine = self.by_path(data)["src/engine.ts"]
        self.assertEqual(engine["status"], "loaded-not-executed")
        self.assertIn("changed top-level code ran at load", engine["detail"])
        self.assertEqual(engine["function_results"], [{"name": "check", "ran": False, "by": []}])

    def test_partly_executed_and_merged_across_checks(self) -> None:
        base = self.js_project()
        self.commit("two", {"src/engine.ts": ENGINE_HEAD.replace("return 2;", "return 9;")})
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"),
                           [("check", 1), ("other", 0)])])
        _, data, out = self.run_tool(base)
        engine = self.by_path(data)["src/engine.ts"]
        self.assertEqual(engine["status"], "partly-executed")
        self.assertIn("ran: check; not run: other", engine["detail"])
        self.assertIn("- src/engine.ts: partly executed by cli help", out)
        self.assertTrue(data["summary_line"].startswith(
            "e2e executed 0 of 2 changed modules, 1 of 3 changed functions"))
        self.assertEqual(data["headline"],
                         "e2e executed 0 of 2 changed modules, 1 of 3 changed functions")
        # a second check that runs `other` completes the module
        rel = ".harden/verify/r1/e2e-coverage/cli-list"
        cov = self.repo / rel
        cov.mkdir(parents=True, exist_ok=True)
        (cov / "coverage-2.json").write_text(json.dumps({"result": [v8_script(
            file_url(self.clone + "/dist/engine.js"), [("other", 2)])]}), encoding="utf-8")
        verify = json.loads((self.repo / ".harden" / "verify.json").read_text(encoding="utf-8"))
        verify["e2e_coverage"].append({"check": "cli list", "clone": self.clone, "dir": rel,
                                       "exit_code": 0, "files": 1})
        (self.repo / ".harden" / "verify.json").write_text(json.dumps(verify), encoding="utf-8")
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"},
                      {"name": "cli list", "cmd": "node dist/cli.js list"}])
        _, data, _ = self.run_tool(base)
        engine = self.by_path(data)["src/engine.ts"]
        self.assertEqual(engine["status"], "executed")
        self.assertEqual({r["name"]: r["by"] for r in engine["function_results"]},
                         {"check": ["cli help"], "other": ["cli list"]})

    def test_constructor_is_looked_up_by_its_class_name(self) -> None:
        self.js_project()
        cls = ("export class Engine {\n  n: number;\n  constructor() {\n    this.n = 1;\n"
               "  }\n}\n")
        base = self.commit("c0", {"src/engine.ts": cls})
        self.commit("c1", {"src/engine.ts": cls.replace("this.n = 1", "this.n = 2")})
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"), [("Engine", 1)])])
        _, data, _ = self.run_tool(base)
        self.assertEqual(self.by_path(data)["src/engine.ts"]["status"], "executed")

    def test_class_body_outside_methods_is_not_top_level_code(self) -> None:
        self.js_project()
        cls = "export class Engine {\n  n = 1;\n  run(): number {\n    return this.n;\n  }\n}\n"
        base = self.commit("c0", {"src/engine.ts": cls})
        self.commit("c1", {"src/engine.ts": cls.replace("n = 1", "n = 2")})
        self.profile([{"name": "cli help", "cmd": "node dist/cli.js --help"}])
        self.v8([v8_script(file_url(self.clone + "/dist/engine.js"), [])])
        _, data, _ = self.run_tool(base)
        self.assertEqual(self.by_path(data)["src/engine.ts"]["status"],
                         "loaded-execution-not-shown")

    def test_pure_deletion_anchor_counts_even_on_a_blank_line(self) -> None:
        text = "export function check(): number {\n  const a = 1;\n\n  return a;\n}\n"
        after = text.replace("  const a = 1;\n", "")
        self.assertEqual(R.deletion_anchors("@@ -2 +1,0 @@\n-  const a = 1;\n"), {1})
        units = R.changed_units("src/engine.ts", after, [[2, 2]], {2})
        self.assertEqual(units["functions"], ["check"])
        units = R.changed_units("src/engine.ts", text, [[3, 3]], set())
        self.assertEqual(units["functions"], [])  # a blank line that is not an anchor

    def test_coverage_py_def_line_alone_is_not_a_run(self) -> None:
        base = self.commit("base", {"app.py": "def run(a):\n    return a\n",
                                    "main.py": "import app\n"})
        self.commit("head", {"app.py": "def run(a, b=0):\n    return a\n"})
        self.profile([{"name": "py", "cmd": "python main.py"}])
        report = self.root / "cov.json"
        report.write_text(json.dumps({"files": {"app.py": {"executed_lines": [1]}}}),
                          encoding="utf-8")
        _, data, _ = self.run_tool(base, "--coverage", "py=" + str(report))
        self.assertEqual(self.by_path(data)["app.py"]["status"], "loaded-not-executed")

    def test_empty_diff(self) -> None:
        base = self.commit("only", {"a.py": "x = 1\n"})
        code, data, _ = self.run_tool(base)
        self.assertEqual(code, 0)
        self.assertTrue(data["summary_line"].startswith("e2e executed 0 of 0 changed modules"))


class GuardedCheckTests(unittest.TestCase):
    """A discovered subcommand check carries the offline guard (pilot-auto-calibration
    A01-F57): the entry is still the CLI, and the guard's own coverage maps to nothing."""

    setUp = E2eReachTest.setUp
    tearDown = E2eReachTest.tearDown
    git = E2eReachTest.git

    def project(self) -> Any:
        return R.Project(self.repo, ["src/cli.ts"], {"src/cli.ts": ["dist/cli.js"]},
                         {"name": "fx", "bin": {"fx": "./dist/cli.js"}}, None)

    def test_entry_skips_absolute_guard_require(self) -> None:
        cmd = ["node", "--require", "C:/Users/A B/.claude/skills/harden/assets/offline-guard.cjs",
               "dist/cli.js", "plugins"]
        self.assertEqual(R.entry_files(cmd, self.project())[0], ["src/cli.ts"])

    def test_v8_guard_script_outside_clone_ignored(self) -> None:
        cov = self.root / "cov"
        cov.mkdir()
        scripts = [v8_script("file:///C:/Users/A%20B/.claude/skills/harden/assets/"
                             "offline-guard.cjs", [("refuse", 1)]),
                   v8_script(file_url(self.clone + "/dist/cli.js"), [("main", 1)])]
        (cov / "coverage-1.json").write_text(json.dumps({"result": scripts}), encoding="utf-8")
        found, _count = R.read_v8_dir(cov, self.clone, self.project())
        self.assertEqual(list(found), ["src/cli.ts"])


if __name__ == "__main__":
    unittest.main()
