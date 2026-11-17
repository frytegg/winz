"""Tests for scripts/ts_program.py (run: python -m unittest discover -s scripts/tests -p "test_ts_program.py").

The integration tests need Node and a TypeScript 5 or 6 installation: set HARDEN_TEST_TYPESCRIPT_DIR to
a directory whose node_modules holds typescript."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import ts_program as T  # noqa: E402

HAS_GIT = shutil.which("git") is not None
NODE = shutil.which("node")
TS_DIR = os.environ.get("HARDEN_TEST_TYPESCRIPT_DIR", "")
HAS_TS = bool(NODE and TS_DIR and (Path(TS_DIR) / "node_modules" / "typescript").is_dir())


def ref(file: str, line: int, role: str) -> Dict[str, Any]:
    return {"file": file, "line": line, "col": 1, "role": role}


def sym(name: str, refs: List[Dict[str, Any]], file: str = "src/lib.ts",
        no_identifier: bool = False) -> Dict[str, Any]:
    return {"file": file, "name": name, "line": 3, "kind": "FunctionDeclaration",
            "no_identifier": no_identifier,
            "references": [ref(file, 3, "definition")] + refs}


def is_test(p: str) -> bool:
    return T.is_test(p)


def git(repo: Path, *args: str) -> str:
    hooks = repo.parent / "nohooks"
    hooks.mkdir(exist_ok=True)
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com",
                           "-c", "commit.gpgsign=false", "-c",
                           "core.hooksPath=" + hooks.as_posix(), *args], cwd=str(repo),
                          capture_output=True, check=True).stdout.decode("utf-8")


REAL_RUN = subprocess.run


def fake_run(calls: List[Any], result: Optional[subprocess.CompletedProcess] = None) -> Any:
    """subprocess.run replacement: git runs for real, anything else is recorded."""
    def run(args: Any, *a: Any, **k: Any) -> Any:
        if args and os.path.basename(str(args[0])).lower().startswith("git"):
            return REAL_RUN(args, *a, **k)
        calls.append(args)
        if result is None:
            raise AssertionError("unexpected command: {}".format(args))
        return result
    return run


def make_repo(root: Path, files: Dict[str, str]) -> Path:
    repo = root / "repo"
    repo.mkdir()
    for rel, text in files.items():
        path = repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
    git(repo, "init", "-q")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "init")
    return repo


class PureTest(unittest.TestCase):
    def test_classify_statuses(self) -> None:
        cases = {
            "unreferenced": sym("u", []),
            "test-only": sym("t", [ref("tests/lib.test.ts", 1, "import"),
                                   ref("tests/lib.test.ts", 5, "use")]),
            "same-file-only": sym("s", [ref("src/lib.ts", 9, "use")]),
            "referenced": sym("r", [ref("src/app.ts", 1, "import"), ref("src/app.ts", 4, "use")]),
        }
        for expected, s in cases.items():
            with self.subTest(expected=expected):
                self.assertEqual(T.classify(s, [], is_test)["status"], expected)
        self.assertEqual(T.classify(sym("p", []), ["src/lib.ts"], is_test)["status"],
                         "public-api")
        via = sym("p", [ref("src/index.ts", 1, "re-export")])
        got = T.classify(via, ["src/index.ts"], is_test)
        self.assertEqual(got["status"], "public-api")
        self.assertEqual(got["reexported_by"], ["src/index.ts"])

    def test_classify_imported_only_and_not_analysed(self) -> None:
        imported = sym("i", [ref("src/b.ts", 1, "import")])
        self.assertEqual(T.classify(imported, [], is_test)["status"], "imported-only")
        self.assertEqual(T.classify(sym("default", []), [], is_test)["status"], "not-analysed")
        self.assertEqual(T.classify(sym("x", [], no_identifier=True), [], is_test)["status"],
                         "not-analysed")

    def test_resolved_exports_of_entry_make_public_api(self) -> None:
        resolved = {"src/index.ts": [{"name": "deep", "exported_as": "deep",
                                      "decl_file": "src/lib.ts", "decl_line": 3}]}
        got = T.classify(sym("deep", []), ["src/index.ts"], is_test, resolved)
        self.assertEqual(got["status"], "public-api")
        self.assertTrue(got["entry_exposed"])
        other = T.classify(sym("other", []), ["src/index.ts"], is_test, resolved)
        self.assertEqual(other["status"], "unreferenced")

    def test_commonjs_file_is_not_analysed(self) -> None:
        texts = {"lib/a.cjs": "module.exports = { a };\nfunction a() {}\n",
                 "lib/b.js": "export function b() {}\nexports.c = 1;\n"}
        a = T.classify(sym("a", [], file="lib/a.cjs"), [], is_test, None, texts.get)
        b = T.classify(sym("b", [], file="lib/b.js"), [], is_test, None, texts.get)
        self.assertEqual(a["status"], "not-analysed")
        self.assertEqual(b["status"], "unreferenced")

    def test_package_entries_map_emitted_outputs_to_sources(self) -> None:
        pkgs = {"package.json": {"bin": {"x": "./dist/cli.js"},
                                 "exports": {".": {"types": "./dist/index.d.ts",
                                                   "import": "./dist/index.js"}}}}
        emitted = {"src/cli.ts": ["dist/cli.js", "dist/cli.d.ts"],
                   "src/index.ts": ["dist/index.js", "dist/index.d.ts"]}
        got = T.package_entries(pkgs, ["src/cli.ts", "src/index.ts"], emitted)
        self.assertEqual(got["entry_sources"], ["src/cli.ts", "src/index.ts"])
        self.assertEqual(got["entry_resolution"], "complete")
        pkgs["package.json"]["main"] = "./lib/main.js"
        got = T.package_entries(pkgs, ["src/cli.ts", "src/index.ts"], emitted)
        self.assertEqual(got["entries_unresolved"], [{"value": "./lib/main.js",
                                                      "package_json": "package.json"}])

    def test_entry_resolution_incomplete_when_bin_unmapped(self) -> None:
        got = T.package_entries({"package.json": {"bin": "./dist/cli.js"}}, ["src/cli.ts"], {})
        self.assertEqual(got["entry_resolution"], "incomplete")
        none = T.package_entries({"package.json": {"name": "x"}}, ["src/a.ts"], {})
        self.assertEqual(none["entry_resolution"], "none")

    def test_script_entries_from_package_scripts(self) -> None:
        pkgs = {"package.json": {"scripts": {"gen": "node scripts/gen.mjs --out x",
                                             "bad": "echo 'unclosed"}}}
        got = T.package_entries(pkgs, ["scripts/gen.mjs", "src/a.ts"], {})
        self.assertEqual(got["script_entries"], ["scripts/gen.mjs"])

    def test_script_entry_through_emitted_output(self) -> None:
        pkgs = {"package.json": {"scripts": {"cli": "node dist/cli.js"}}}
        got = T.package_entries(pkgs, ["src/cli.ts"], {"src/cli.ts": ["dist/cli.js"]})
        self.assertEqual(got["script_entries"], ["src/cli.ts"])

    def test_reachability_ignores_edges_from_tests_and_config_files(self) -> None:
        edges = [{"from": "src/index.ts", "to": "src/a.ts"},
                 {"from": "tests/a.test.ts", "to": "src/b.ts"},
                 {"from": "src/b.ts", "to": "src/c.ts"}]
        files = ["src/index.ts", "src/a.ts", "src/b.ts", "src/c.ts", "tests/a.test.ts",
                 "vitest.config.ts", "src/outside.ts"]
        got = T.reachability(edges, ["src/index.ts"], [], files, is_test, ["src/outside.ts"])
        self.assertEqual(got["unreachable_production_files"], ["src/b.ts", "src/c.ts"])
        self.assertEqual(got["test_only_files"], ["src/b.ts", "src/c.ts"])
        none = T.reachability(edges, [], [], files, is_test)
        self.assertIsNone(none["unreachable_production_files"])
        self.assertEqual(none["reachability_note"], "no package entry resolved")

    def test_dynamic_import_scan(self) -> None:
        text = ("const a = import('./a');\r\nconst b = import(name);\r\n"
                "const c = import(`./x/${n}`);\r\nconst d = require(\"x\");\r\n"
                "const e = import(`./fixed`);\r\n")
        got = T.dynamic_imports({"src/m.ts": text})
        self.assertEqual(got, [{"file": "src/m.ts", "line": 2}, {"file": "src/m.ts", "line": 3}])

    def test_files_from_crlf_backslashes_and_comments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "list.txt"
            p.write_bytes((chr(0xFEFF) + "src\\a.ts\r\n\r\n# c\r\n./src/b.ts\r\n").encode("utf-8"))
            self.assertEqual(T.read_list(p), ["src/a.ts", "src/b.ts"])


@unittest.skipUnless(HAS_GIT, "git is needed")
class CliWithoutTypeScriptTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_no_typescript_files_does_not_start_node(self) -> None:
        repo = make_repo(self.root, {"a.py": "x = 1\n"})
        out = self.root / "out.json"
        calls: List[Any] = []
        with mock.patch.object(T.subprocess, "run", side_effect=fake_run(calls)):
            code = T.main(["--repo", str(repo), "--out", str(out)])
        self.assertEqual(code, 0)
        self.assertEqual(calls, [])
        self.assertEqual(json.loads(out.read_text(encoding="utf-8"))["status"],
                         "no-typescript-files")

    def test_missing_node_is_unavailable_exit_3(self) -> None:
        repo = make_repo(self.root, {"src/a.ts": "export const a = 1;\n"})
        out = self.root / "out.json"
        with mock.patch.object(T.shutil, "which", return_value=None):
            code = T.main(["--repo", str(repo), "--out", str(out)])
        self.assertEqual(code, 3)
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual((data["status"], data["reason"]), ("unavailable", "node not found"))

    def test_typescript_outside_repository_is_refused(self) -> None:
        repo = make_repo(self.root, {"src/a.ts": "export const a = 1;\n"})
        out = self.root / "out.json"
        elsewhere = str(self.root / "global" / "typescript" / "lib" / "typescript.js")
        done = subprocess.CompletedProcess([], 0, stdout=elsewhere.encode("utf-8"), stderr=b"")
        calls: List[Any] = []
        with mock.patch.object(T.shutil, "which", return_value="node"), \
                mock.patch.object(T.subprocess, "run", side_effect=fake_run(calls, done)):
            code = T.main(["--repo", str(repo), "--out", str(out)])
        self.assertEqual(code, 3)
        reason = json.loads(out.read_text(encoding="utf-8"))["reason"]
        self.assertIn("inside the repository", reason)

    def test_bad_symbol_is_usage_error(self) -> None:
        repo = make_repo(self.root, {"src/a.ts": "export const a = 1;\n"})
        self.assertEqual(T.main(["--repo", str(repo), "--symbol", "a"]), 2)
        self.assertEqual(T.main(["--repo", str(repo), "--symbol", "a@src/missing.ts"]), 2)

    def test_not_a_repository_is_usage_error(self) -> None:
        plain = self.root / "plain"
        plain.mkdir()
        self.assertEqual(T.main(["--repo", str(plain)]), 2)

    @unittest.skipUnless(NODE, "node is needed")
    def test_typescript_without_language_service_is_unavailable(self) -> None:
        repo = make_repo(self.root, {
            "src/a.ts": "export const a = 1;\n",
            "node_modules/typescript/package.json": json.dumps(
                {"name": "typescript", "version": "7.0.2", "main": "index.js"}),
            "node_modules/typescript/index.js": "module.exports = { version: '7.0.2' };\n",
        })
        out = self.root / "out.json"
        code = T.main(["--repo", str(repo), "--out", str(out)])
        self.assertEqual(code, 3)
        reason = json.loads(out.read_text(encoding="utf-8"))["reason"]
        self.assertIn("TypeScript 7", reason)


INTEGRATION_FILES = {
    "tsconfig.json": json.dumps({"compilerOptions": {"module": "NodeNext",
                                                     "moduleResolution": "NodeNext",
                                                     "strict": True, "noEmit": True},
                                 "include": ["src", "tests"]}),
    "tsconfig.build.json": json.dumps({"extends": "./tsconfig.json",
                                       "compilerOptions": {"outDir": "dist", "rootDir": "src",
                                                           "noEmit": False,
                                                           "declaration": True},
                                       "include": ["src"]}),
    "package.json": json.dumps({"name": "fx", "type": "module", "exports": "./dist/index.js"}),
    "eslint.config.mjs": "export default [];\n",
    "src/index.ts": "export * from './barrel.js';\n",
    "src/barrel.ts": "export { pub } from './lib.js';\nexport * from './deep.js';\n",
    "src/deep.ts": "export function deepPub(): number { return 1; }\n",
    "src/lib.ts": ("export function pub(): number { return 1; }\n"
                   "export function used(): number { return 2; }\n"
                   "export function unused(): number { return 3; }\n"
                   "export function testOnly(): number { return 4; }\n"
                   "export function selfOnly(): number { return 5; }\n"
                   "export function imported(): number { return 6; }\n"
                   "export default function (): number { return selfOnly(); }\n"),
    "src/app.ts": "import { used } from './lib.js';\nexport const v = used();\n",
    "src/b.ts": "import { imported } from './lib.js';\nexport const w = 1;\n",
    "tests/lib.test.ts": "import { testOnly } from '../src/lib.js';\ntestOnly();\n",
}


@unittest.skipUnless(HAS_GIT and HAS_TS,
                     "set HARDEN_TEST_TYPESCRIPT_DIR to a directory whose node_modules holds "
                     "typescript")
class IntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def run_tool(self, files: Dict[str, str], *extra: str) -> Dict[str, Any]:
        repo = make_repo(self.root, files)
        out = self.root / "out.json"
        code = T.main(["--repo", str(repo), "--typescript", TS_DIR, "--out", str(out), *extra])
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(code, 0, data.get("reason"))
        return data

    @staticmethod
    def status(data: Dict[str, Any], name: str) -> str:
        found = [s["status"] for s in data["symbols"] if s["name"] == name]
        if len(found) != 1:
            raise AssertionError("{}: {}".format(name, found))
        return found[0]

    def test_refs_statuses_on_temp_project(self) -> None:
        data = self.run_tool(INTEGRATION_FILES)
        self.assertEqual(data["typescript_source"], "flag")
        expect = {"pub": "public-api", "deepPub": "public-api", "used": "referenced",
                  "unused": "unreferenced", "testOnly": "test-only",
                  "selfOnly": "same-file-only", "imported": "imported-only",
                  "default": "not-analysed"}
        for name, status in expect.items():
            with self.subTest(name=name):
                self.assertEqual(self.status(data, name), status)
        self.assertEqual(data["files_outside_programs"], ["eslint.config.mjs"])
        self.assertEqual(data["entry_resolution"], "complete")

    def test_graph_emitted_and_unreachable_files(self) -> None:
        data = self.run_tool(INTEGRATION_FILES, "--no-refs")
        self.assertIn("src/app.ts", data["unreachable_production_files"])
        self.assertIn("dist/lib.js", data["emitted"]["src/lib.ts"])
        self.assertEqual(data["symbols"], [])

    def test_crlf_sources_give_correct_lines(self) -> None:
        files = dict(INTEGRATION_FILES)
        files["src/lib.ts"] = files["src/lib.ts"].replace("\n", "\r\n")
        data = self.run_tool(files)
        unused = [s for s in data["symbols"] if s["name"] == "unused"][0]
        self.assertEqual(unused["line"], 3)

    def test_symbol_filter_limits_refs(self) -> None:
        data = self.run_tool(INTEGRATION_FILES, "--symbol", "unused@src/lib.ts")
        self.assertEqual([s["name"] for s in data["symbols"]], ["unused"])


if __name__ == "__main__":
    unittest.main()
