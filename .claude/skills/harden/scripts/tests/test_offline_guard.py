"""Tests for assets/offline-guard.cjs, the preload of self-setup's discovered e2e checks
(pilot-auto-calibration A01-F57). They need node on PATH.

Run: python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import List, Tuple

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import infer_profile as ip  # noqa: E402

GUARD = (SCRIPTS.parent / "assets" / "offline-guard.cjs").resolve().as_posix()
MARK = "harden-offline-guard: refused "


@unittest.skipUnless(shutil.which("node"), "node is needed")
class OfflineGuardTests(unittest.TestCase):
    def setUp(self) -> None:
        self.work = Path(tempfile.mkdtemp(prefix="harden guard "))
        self.addCleanup(shutil.rmtree, str(self.work), True)
        (self.work / "package.json").write_text('{"type": "module"}', encoding="utf-8")
        (self.work / "data.txt").write_text("hello\n", encoding="utf-8")

    def run_script(self, code: str, name: str = "case", env_extra: dict = None,
                   args: List[str] = ()) -> Tuple[int, str, List[str]]:
        script = self.work / (name + ".mjs")
        script.write_text(code, encoding="utf-8")
        env = dict(os.environ, NODE_OPTIONS="")
        env.update(env_extra or {})
        out_path, err_path = self.work / (name + ".out"), self.work / (name + ".err")
        with open(out_path, "wb") as out, open(err_path, "wb") as err:
            proc = subprocess.run(["node", "--require", GUARD, script.name] + list(args),
                                  cwd=str(self.work), stdout=out, stderr=err,
                                  stdin=subprocess.DEVNULL, env=env, timeout=60)
        stdout = out_path.read_bytes().decode("utf-8", errors="replace")
        marks = [line for line in err_path.read_bytes().decode("utf-8", errors="replace")
                 .splitlines() if line.startswith(MARK)]
        return proc.returncode, stdout, marks

    def assert_refused(self, code: str, marker: str, name: str = "case") -> Tuple[str, List[str]]:
        status, stdout, marks = self.run_script(code, name)
        self.assertEqual(status, 97, (code, stdout, marks))
        self.assertTrue(marks, code)
        self.assertTrue(marks[0].startswith(MARK + marker), marks)
        return stdout, marks

    def test_network_is_refused_with_marker_and_exit_97(self) -> None:
        stdout, _marks = self.assert_refused(
            "try { await fetch('http://127.0.0.1:9/'); } catch (e) { console.log('caught', "
            "e.code); }", "fetch", "fetch")
        self.assertIn("caught HARDEN_OFFLINE", stdout)
        self.assert_refused("import http from 'node:http'; http.get('http://127.0.0.1:9/');",
                            "net.connect", "http")
        self.assert_refused("import dns from 'node:dns'; dns.lookup('localhost', () => {});",
                            "dns.lookup", "dns")

    def test_esm_named_imports_see_the_patches(self) -> None:
        self.assert_refused("import { writeFileSync } from 'node:fs'; "
                            "writeFileSync('x.txt', '1');", "fs.writeFileSync", "write")
        self.assert_refused("import { spawnSync } from 'node:child_process'; "
                            "spawnSync('node', ['-v']);", "child_process.spawnSync", "spawn")
        self.assertFalse((self.work / "x.txt").exists())

    def test_reads_and_listing_pass(self) -> None:
        status, stdout, marks = self.run_script(
            "import { readFileSync, readdirSync } from 'node:fs'; "
            "console.log(readFileSync('data.txt', 'utf8').trim()); "
            "console.log(readdirSync('.').filter((n) => n.endsWith('.txt')).join(','));")
        self.assertEqual((status, marks), (0, []))
        self.assertEqual(stdout.split(), ["hello", "data.txt"])

    def test_secret_reads_and_dotenv_are_refused(self) -> None:
        secret = self.work / ".env"
        secret.write_text("A=1\n", encoding="utf-8")
        self.assert_refused("import { readFileSync } from 'node:fs'; "
                            "readFileSync('.env', 'utf8');", "fs.readFileSync(secret)", "secret")
        self.assert_refused("process.loadEnvFile();", "process.loadEnvFile", "dotenv")

    def test_exit_zero_after_refusal_becomes_97(self) -> None:
        self.assert_refused("import { mkdirSync } from 'node:fs'; try { mkdirSync('d'); } "
                            "catch {} process.exit(0);", "fs.mkdirSync", "exit0")
        self.assertFalse((self.work / "d").exists())

    def test_worker_binding_inspector_wasi_refused(self) -> None:
        cases = [("import { Worker } from 'node:worker_threads'; new Worker('./x.js');",
                  "worker_threads.Worker"),
                 ("process.binding('tcp_wrap');", "process.binding"),
                 ("import inspector from 'node:inspector'; inspector.open(0);", "inspector.open"),
                 ("import { WASI } from 'node:wasi'; new WASI({ version: 'preview1' });",
                  "wasi.WASI")]
        for index, (code, marker) in enumerate(cases):
            with self.subTest(marker=marker):
                self.assert_refused(code, marker, "w{}".format(index))

    def test_native_writers_are_refused(self) -> None:
        cases = [("import sqlite from 'node:sqlite'; new sqlite.DatabaseSync('x.db');",
                  "sqlite.DatabaseSync", "x.db"),
                 ("import v8 from 'node:v8'; v8.writeHeapSnapshot('h.heapsnapshot');",
                  "v8.writeHeapSnapshot", "h.heapsnapshot"),
                 ("process.report.writeReport('r.json');", "process.report.writeReport",
                  "r.json")]
        for index, (code, marker, written) in enumerate(cases):
            with self.subTest(marker=marker):
                self.assert_refused(code, marker, "n{}".format(index))
                self.assertFalse((self.work / written).exists())

    def test_resolver_and_socket_objects_are_refused(self) -> None:
        self.assert_refused("import dns from 'node:dns'; new dns.Resolver().resolve4("
                            "'localhost', () => {});", "dns.Resolver.resolve4", "resolver")
        self.assert_refused("import dgram from 'node:dgram'; new dgram.Socket('udp4')"
                            ".bind(0);", "dgram.Socket.bind", "dgram")

    def test_process_level_escapes_are_refused(self) -> None:
        cases = [("process.execve(process.execPath, [process.execPath, '-e', '1']);",
                  "process.execve"),
                 ("process.kill(999999, 0);", "process.kill"),
                 ("process.binding('fs');", "process.binding"),
                 ("import fs from 'node:fs'; fs.fchmodSync(fs.openSync('data.txt', 'r'), "
                  "0o644);", "fs.fchmodSync")]
        for index, (code, marker) in enumerate(cases):
            with self.subTest(marker=marker):
                if marker == "process.execve":
                    status, _out, _marks = self.run_script(
                        "console.log(typeof process.execve);", "probe-execve")
                    if "function" not in _out:
                        continue
                self.assert_refused(code, marker, "p{}".format(index))
        status, out, _marks = self.run_script(
            "import fs from 'node:fs'; console.log(typeof fs.mkdtempDisposableSync);",
            "probe-disposable")
        if "function" in out:
            self.assert_refused("import fs from 'node:fs'; fs.mkdtempDisposableSync('x');",
                                "fs.mkdtempDisposableSync", "disposable")

    def test_v8_coverage_still_written(self) -> None:
        cov = self.work / "cov"
        status, _out, marks = self.run_script(
            "import { readdirSync } from 'node:fs'; console.log(readdirSync('.').length);",
            "cov", env_extra={"NODE_V8_COVERAGE": str(cov)})
        self.assertEqual((status, marks), (0, []))
        self.assertTrue(list(cov.glob("coverage-*.json")))

    def test_secret_regex_matches_infer_profile(self) -> None:
        for name in (".env", ".env.local", "a.pem", "id_rsa", "x.keystore.json", ".npmrc",
                     "service-account-prod.json", "README.md", "data.txt"):
            with self.subTest(name=name):
                target = self.work / "sub" / name
                target.parent.mkdir(exist_ok=True)
                target.write_text("x\n", encoding="utf-8")
                env = dict(os.environ, NODE_OPTIONS="")
                proc = subprocess.run(
                    ["node", "--require", GUARD, "-e",
                     "require('fs').readFileSync(process.argv[1])", str(target)],
                    stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    env=env, timeout=60, check=False)
                python_says = bool(ip.SECRET_FILE_RE.match(name))
                self.assertEqual(proc.returncode == 97, python_says, name)

    def test_guard_constants_match_infer_profile(self) -> None:
        text = Path(GUARD).read_bytes().decode("utf-8")
        self.assertIn("const MARK = '{}';".format(ip.GUARD_MARK), text)
        self.assertIn("const EXIT_CODE = {};".format(ip.GUARD_EXIT), text)
        self.assertEqual(Path(ip.GUARD_PATH).resolve(), Path(GUARD).resolve())


if __name__ == "__main__":
    unittest.main()
