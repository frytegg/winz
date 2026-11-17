"""Tests for scripts/contract_check.py (run: python -m unittest discover -s scripts/tests -p "test_contract_check.py")."""
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

import contract_check as CC  # noqa: E402

HAS_GIT = shutil.which("git") is not None

CLI_BASE = ("import { DEFAULT_FILE } from './load.js';\n"
            "export interface Args {\n  config: string;\n  interval: number;\n}\n"
            "export function parseArgs(argv: string[]): Args {\n"
            "  const args: Args = {\n    config: DEFAULT_FILE,\n    interval: 60,\n  };\n"
            "  for (const a of argv) {\n    if (a === '-q') args.interval = 5;\n  }\n"
            "  return args;\n}\n")
LOAD_BASE = ("export const DEFAULT_FILE = 'app.json';\n"
             "function normalise(s: string): string {\n  return s.trim();\n}\n"
             "export function loadConfig(file: string = DEFAULT_FILE): string {\n"
             "  return normalise(file);\n}\n"
             "export class Store {\n  save(v: string): string {\n    return v;\n  }\n}\n")


def run(argv: List[str]) -> Tuple[int, str]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = CC.main(argv)
    return code, out.getvalue() + err.getvalue()


@unittest.skipUnless(HAS_GIT, "git is needed")
class ContractCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        (self.root / "nohooks").mkdir()
        self.git("init", "-q")
        (self.repo / ".git" / "info").mkdir(parents=True, exist_ok=True)
        (self.repo / ".git" / "info" / "exclude").write_text("/.harden/\n", encoding="utf-8")

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

    def stage(self, files: Dict[str, Optional[str]]) -> None:
        self.write(files)
        self.git("add", "-A")

    def message(self, text: str, crlf: bool = False) -> str:
        path = self.root / "msg.txt"
        data = text.replace("\n", "\r\n") if crlf else text
        path.write_bytes((chr(0xFEFF) + data).encode("utf-8"))
        return str(path)

    def pins(self, *extra: str) -> Tuple[int, Dict[str, Any], str]:
        out = self.root / "pins.json"
        code, text = run(["pins", "--repo", str(self.repo), "--out", str(out), *extra])
        data = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
        return code, data, text


class PinsTests(ContractCase):
    def setUp(self) -> None:
        super().setUp()
        self.base = self.commit("base", {"src/cli.ts": CLI_BASE, "src/load.ts": LOAD_BASE,
                                         "tests/cli.test.ts": "import { parseArgs } from "
                                         "'../src/cli.js';\nparseArgs(['-q']);\n"})

    def char(self, rel: str, text: str) -> str:
        return self.commit("test: characterize ({})".format(rel), {rel: text})

    def test_d08_shape_unpinned_exported_function_fails(self) -> None:
        self.char("tests/load-char.test.ts",
                  "import { loadConfig } from '../src/load.js';\nloadConfig();\n")
        self.stage({"src/cli.ts": CLI_BASE.replace("    config: DEFAULT_FILE,\n", ""),
                    "src/load.ts": LOAD_BASE.replace("return normalise(file);",
                                                     "if (!file) throw new Error('x');\n"
                                                     "  return normalise(file);")})
        msg = ("fix(config): fail on a named file (C16)\n\nBehaviour change: x -> y; newly "
               "rejected: none (tests/load-char.test.ts)\n")
        code, data, text = self.pins("--base", self.base, "--staged",
                                     "--message-file", self.message(msg))
        self.assertEqual(code, 1)
        units = {u["unit"]: u for u in data["changes"][0]["units"]}
        self.assertEqual(units["parseArgs"]["pinned_by"], [])
        self.assertEqual(units["loadConfig"]["pinned_by"], ["tests/load-char.test.ts"])
        self.assertIn("src/cli.ts parseArgs is edited and exported", text)
        self.assertIn("does not cover src/cli.ts parseArgs", text)

    def test_every_edited_function_pinned_and_claimed_passes(self) -> None:
        self.char("tests/char.test.ts", "import { loadConfig } from '../src/load.js';\n"
                  "import { parseArgs } from '../src/cli.js';\nloadConfig(); parseArgs([]);\n")
        self.stage({"src/cli.ts": CLI_BASE.replace("interval: 60", "interval: 30")})
        msg = "fix(cli): x (C2)\n\nBehaviour change: y; newly rejected: none (tests/char.test.ts)\n"
        code, data, _ = self.pins("--base", self.base, "--staged",
                                  "--message-file", self.message(msg))
        self.assertEqual(code, 0, data)

    def test_comment_only_edit_is_not_an_edit_but_a_deletion_is(self) -> None:
        self.stage({"src/cli.ts": CLI_BASE.replace("  return args;", "  // done\n  return args;")})
        code, data, _ = self.pins("--base", self.base, "--staged", "--all")
        self.assertEqual(code, 0)
        self.assertEqual(data["changes"][0]["units"], [])
        self.git("reset", "-q", "--hard")
        self.stage({"src/cli.ts": CLI_BASE.replace("    config: DEFAULT_FILE,\n", "")})
        _, data, _ = self.pins("--base", self.base, "--staged", "--all")
        self.assertEqual([u["unit"] for u in data["changes"][0]["units"]], ["parseArgs"])

    def test_private_helper_edit_requires_its_exported_callers(self) -> None:
        self.stage({"src/load.ts": LOAD_BASE.replace("return s.trim();",
                                                     "return s.trim().toUpperCase();")})
        code, data, text = self.pins("--base", self.base, "--staged", "--all")
        self.assertEqual(code, 1)
        rows = {(u["unit"], u.get("calls_edited")) for u in data["changes"][0]["units"]}
        self.assertIn(("normalise", None), rows)
        self.assertIn(("loadConfig", "normalise"), rows)
        self.assertIn("calls the edited normalise", text)

    def test_method_of_exported_class_and_pins_header(self) -> None:
        self.char("tests/store.test.ts", "// pins: src/load.ts Store.save\n"
                  "import { makeStore } from './helpers.js';\nmakeStore();\n")
        self.stage({"src/load.ts": LOAD_BASE.replace("return v;", "return v + '!';")})
        code, data, _ = self.pins("--base", self.base, "--staged", "--all")
        self.assertEqual(code, 0, data)
        unit = data["changes"][0]["units"][0]
        self.assertEqual((unit["unit"], unit["pinned_by"]), ("Store.save", ["tests/store.test.ts"]))

    def test_pins_header_for_another_file_does_not_count(self) -> None:
        self.char("tests/store.test.ts", "# pins: src/other.ts Store.save\n")
        self.stage({"src/load.ts": LOAD_BASE.replace("return v;", "return v + '!';")})
        self.assertEqual(self.pins("--base", self.base, "--staged", "--all")[0], 1)

    def test_structural_change_is_not_checked_without_all(self) -> None:
        self.stage({"src/cli.ts": CLI_BASE.replace("interval: 60", "interval: 30")})
        msg = "refactor(cli): rename NFC (C3)\n"
        code, _, _ = self.pins("--base", self.base, "--staged", "--message-file", self.message(msg))
        self.assertEqual(code, 0)

    def test_new_function_needs_no_pin(self) -> None:
        self.stage({"src/load.ts": LOAD_BASE + "export function fresh(): number {\n  return 1;\n}\n"})
        code, data, _ = self.pins("--base", self.base, "--staged", "--all")
        self.assertEqual(code, 0)
        self.assertEqual(data["changes"][0]["units"][0]["existed"], False)

    def test_claim_problems(self) -> None:
        self.char("tests/char.test.ts", "import { parseArgs } from '../src/cli.js';\nparseArgs([]);\n")
        self.stage({"src/cli.ts": CLI_BASE.replace("interval: 60", "interval: 30"),
                    "tests/new.test.ts": "import { parseArgs } from '../src/cli.js';\n"})
        cases = {
            "fix(cli): x\n\nBehaviour change: y\n": "no `newly rejected:` clause",
            "fix(cli): x\n\nBehaviour change: y; newly rejected: none.\n": "names no test file",
            "fix(cli): x\n\nBehaviour change: y; newly rejected: none (tests/new.test.ts)\n":
                "did not exist before this change",
            "fix(cli): x\n\nBehaviour change: y; newly rejected: ids above 2^53\n":
                "newly rejected class is not empty",
        }
        (self.repo / ".harden").mkdir(exist_ok=True)
        (self.repo / ".harden" / "active").write_text(json.dumps({"mode": "auto",
                                                                  "base_sha": self.base}),
                                                      encoding="utf-8")
        for msg, expected in cases.items():
            with self.subTest(msg=msg):
                code, _, text = self.pins("--staged", "--message-file", self.message(msg))
                self.assertEqual(code, 1)
                self.assertIn(expected, text)

    def test_python_exports_follow_all_and_underscore(self) -> None:
        base = self.commit("py", {"pkg/mod.py": "__all__ = ['run']\n\ndef run(x):\n    return x\n\n"
                                  "def helper(x):\n    return x\n\ndef _p(x):\n    return x\n"})
        self.stage({"pkg/mod.py": "__all__ = ['run']\n\ndef run(x):\n    return x + 1\n\n"
                    "def helper(x):\n    return x + 1\n\ndef _p(x):\n    return x\n"})
        _, data, _ = self.pins("--base", base, "--staged", "--all")
        exported = {u["unit"]: u["exported"] for u in data["changes"][0]["units"]
                    if not u.get("module")}
        self.assertEqual(exported, {"run": True, "helper": False})
        # helper is not exported and no exported function calls it: its edit needs a module
        # pin (P5)
        modules = [u for u in data["changes"][0]["units"] if u.get("module")]
        self.assertEqual([u["file"] for u in modules], ["pkg/mod.py"])

    def test_commit_and_range_modes(self) -> None:
        sha = self.commit("fix(cli): x (C4)\n\nBehaviour change: y; newly rejected: none "
                          "(tests/cli.test.ts)", {"src/cli.ts": CLI_BASE.replace("interval: 60",
                                                                                 "interval: 30")})
        code, data, _ = self.pins("--base", self.base, "--commit", sha)
        self.assertEqual(code, 1)  # tests/cli.test.ts existed at base: not a run-added pin
        code, data, _ = self.pins("--base", self.base, "--range", self.base + ".." + sha)
        self.assertEqual(len(data["changes"]), 1)
        self.assertEqual(self.pins("--base", "nope", "--commit", sha)[0], 2)

    # --- review fixes P1-P6 (round 3) ---------------------------------------------------
    def test_cmd_line_after_claim_is_not_part_of_it(self) -> None:
        self.char("tests/char.test.ts", "import { parseArgs } from '../src/cli.js';\n"
                  "parseArgs([]);\n")
        self.stage({"src/cli.ts": CLI_BASE.replace("interval: 60", "interval: 30"),
                    "tests/new.test.ts": "import { parseArgs } from '../src/cli.js';\n"})
        msg = ("fix(cli): x (C2)\n\nBehaviour change: y; newly rejected: none "
               "(tests/char.test.ts)\ncmd: pnpm exec vitest run tests/new.test.ts\n")
        code, data, text = self.pins("--base", self.base, "--staged",
                                     "--message-file", self.message(msg, crlf=True))
        self.assertEqual(code, 0, text)
        self.assertEqual(data["changes"][0]["claim"]["tests"], ["tests/char.test.ts"])

    def test_cases_added_to_an_existing_test_file_pin_a_unit(self) -> None:
        self.commit("test: extend (C4)", {"tests/cli.test.ts": "import { parseArgs } from "
                                          "'../src/cli.js';\nparseArgs(['-q']);\n"
                                          "expect(parseArgs([]).interval).toBe(60);\n"})
        self.stage({"src/cli.ts": CLI_BASE.replace("interval: 60", "interval: 30")})
        msg = "fix(cli): x (C4)\n\nBehaviour change: y; newly rejected: none (tests/cli.test.ts)\n"
        code, data, text = self.pins("--base", self.base, "--staged",
                                     "--message-file", self.message(msg))
        self.assertEqual(code, 0, text)
        self.assertEqual(data["changes"][0]["units"][0]["pinned_by"], ["tests/cli.test.ts"])

    def test_default_export_function_is_exported_with_ts_program(self) -> None:
        base = self.commit("def", {"src/def.ts": "export default function run(x: number): "
                                   "number {\n  return x;\n}\n",
                                   "src/named.ts": "function helper(x: number): number {\n"
                                   "  return x;\n}\nexport default helper;\n"})
        tsp = self.root / "ts-program.json"
        tsp.write_text(json.dumps({"symbols": [{"file": "src/def.ts", "name": "default"},
                                               {"file": "src/named.ts", "name": "default"}]}),
                       encoding="utf-8")
        self.stage({"src/def.ts": "export default function run(x: number): number {\n"
                    "  return x + 1;\n}\n",
                    "src/named.ts": "function helper(x: number): number {\n  return x + 1;\n"
                    "}\nexport default helper;\n"})
        code, data, _ = self.pins("--base", base, "--staged", "--all", "--ts-program", str(tsp))
        self.assertEqual(code, 1)
        exported = {u["unit"]: u["exported"] for u in data["changes"][0]["units"]}
        self.assertEqual(exported, {"run": True, "helper": True})

    def test_constructor_is_pinned_by_its_class_name(self) -> None:
        box = "export class Box {\n  constructor(v: number) {\n    this.v = v;\n  }\n}\n"
        base = self.commit("box", {"src/box.ts": box, "pkg/acct.py":
                                   "class Account:\n    def __init__(self, v):\n"
                                   "        self.v = v\n"})
        self.char("tests/box.test.ts", "import { Box } from '../src/box.js';\nnew Box(1);\n")
        self.char("tests/test_acct.py", "from pkg.acct import Account\nAccount(1)\n")
        self.stage({"src/box.ts": box.replace("this.v = v;", "this.v = v + 1;"),
                    "pkg/acct.py": "class Account:\n    def __init__(self, v):\n"
                    "        self.v = v + 1\n"})
        code, data, text = self.pins("--base", base, "--staged", "--all")
        self.assertEqual(code, 0, text)
        pinned = {u["unit"]: u["pinned_by"] for u in data["changes"][0]["units"]}
        self.assertEqual(pinned, {"Box.constructor": ["tests/box.test.ts"],
                                  "Account.__init__": ["tests/test_acct.py"]})

    def test_top_level_constant_edit_needs_a_module_pin(self) -> None:
        self.stage({"src/load.ts": LOAD_BASE.replace("'app.json'", "'other.json'")})
        msg = "fix(load): x (C5)\n\nBehaviour change: y; newly rejected: none (tests/c.test.ts)\n"
        code, data, text = self.pins("--base", self.base, "--staged",
                                     "--message-file", self.message(msg))
        self.assertEqual(code, 1)
        self.assertIn("src/load.ts needs a module pin: code outside every exported function", text)
        self.git("reset", "-q", "--hard")
        self.char("tests/c.test.ts", "import * as load from '../src/load.js';\nload;\n")
        self.stage({"src/load.ts": LOAD_BASE.replace("'app.json'", "'other.json'")})
        code, data, text = self.pins("--base", self.base, "--staged",
                                     "--message-file", self.message(msg))
        self.assertEqual(code, 0, text)
        self.assertEqual(data["changes"][0]["units"][0]["pinned_by"], ["tests/c.test.ts"])

    def test_import_and_type_lines_need_no_module_pin(self) -> None:
        self.stage({"src/cli.ts": CLI_BASE.replace("import { DEFAULT_FILE } from './load.js';",
                                                   "import { DEFAULT_FILE } from './load';")
                    .replace("  interval: number;\n", "  interval: number;\n  q?: boolean;\n")})
        code, data, text = self.pins("--base", self.base, "--staged", "--all")
        self.assertEqual(code, 0, text)
        self.assertEqual(data["changes"][0]["units"], [])

    def test_tsx_edit_needs_a_module_pin_or_header(self) -> None:
        base = self.commit("view", {"src/view.tsx": "export const View = () => <div>a</div>;\n"})
        self.stage({"src/view.tsx": "export const View = () => <div>b</div>;\n"})
        code, _, text = self.pins("--base", base, "--staged", "--all")
        self.assertEqual(code, 1)
        self.assertIn("not analysed", text)
        self.git("reset", "-q", "--hard")
        self.char("tests/view.test.ts", "// pins: src/view.tsx *\nimport { render } from "
                  "'./render.js';\nrender();\n")
        self.stage({"src/view.tsx": "export const View = () => <div>b</div>;\n"})
        code, data, text = self.pins("--base", base, "--staged", "--all")
        self.assertEqual(code, 0, text)

    def test_problem_kinds(self) -> None:
        self.stage({"src/cli.ts": CLI_BASE.replace("interval: 60", "interval: 30")})
        msg = "fix(cli): x (C6)\n\nBehaviour change: y; newly rejected: none\n"
        code, data, text = self.pins("--base", self.base, "--staged",
                                     "--message-file", self.message(msg))
        self.assertEqual(code, 1)
        kinds = sorted(p["kind"] for p in data["problems"])
        self.assertEqual(kinds, ["claim", "unpinned"])
        self.assertTrue(all(p["change"] == "staged" for p in data["problems"]))
        self.assertIn("PROBLEM (unpinned)", text)
        self.assertIn("names no test file", text)



if __name__ == "__main__":
    unittest.main()
