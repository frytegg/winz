"""JSON and text I/O (contract/MODULES.md 2 jsonio, SCHEMAS.md 1.2-1.4; LANES.md B01).

Protects: atomic writes leave no temp file; LF only with a final newline and no BOM; canonical bytes stable across
key orders; a BOM is stripped with W_BOM; append_jsonl writes exactly one line per call; read_jsonl reports a bad
line as E_JSONL_LINE without stopping; write_text_atomic refuses a carriage return; and on Windows a reader holding
the target open in another process is absorbed by the bounded PermissionError retry, then E_ENV.

Run: python -m unittest discover -s scripts/tests -p "test_jsonio.py" -v
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import unittest

import _support as S
from execlib import errors, jsonio
from execlib.errors import EnvError, ErrorItem, InternalError, ValidationFailed

HOLDER = r"""
import sys, time
path, seconds, ready = sys.argv[1], float(sys.argv[2]), sys.argv[3]
with open(path, "rb") as fh:
    open(ready, "w").close()
    time.sleep(seconds)
"""


class JsonIO(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = S.mkdtemp()
        errors.drain_warnings()

    def tearDown(self) -> None:
        S.rmtree(self.dir)

    def test_atomic_write_lf_sorted_final_newline(self) -> None:
        path = self.dir / "sub" / "doc.json"
        jsonio.write_json_atomic(path, {"b": 1, "a": ["é", 2]})
        raw = path.read_bytes()
        self.assertEqual(raw, b'{\n  "a": [\n    "\xc3\xa9",\n    2\n  ],\n  "b": 1\n}\n')
        self.assertNotIn(b"\r", raw)
        self.assertFalse(raw.startswith(jsonio.BOM))
        self.assertEqual(sorted(p.name for p in path.parent.iterdir()), ["doc.json"], "no temp file left")
        jsonio.write_json_atomic(path, {"b": 1, "a": 2}, sort_keys=False)
        self.assertTrue(path.read_text(encoding="utf-8").startswith('{\n  "b"'))

    def test_write_text_refuses_cr(self) -> None:
        path = self.dir / "t.md"
        jsonio.write_text_atomic(path, "line")
        self.assertEqual(path.read_bytes(), b"line\n")
        with self.assertRaises(InternalError):
            jsonio.write_text_atomic(path, "a\r\nb")
        self.assertEqual(path.read_bytes(), b"line\n")

    def test_canonical_bytes_stable(self) -> None:
        a = {"b": [1, {"y": 2, "x": 1}], "a": "é"}
        b = {"a": "é", "b": [1, {"x": 1, "y": 2}]}
        self.assertEqual(jsonio.canonical_bytes(a), jsonio.canonical_bytes(b))
        self.assertEqual(jsonio.canonical_bytes(a), '{"a":"é","b":[1,{"x":1,"y":2}]}'.encode("utf-8"))
        self.assertEqual(jsonio.sha256_json(a), S.sha(S.canonical(a)))
        self.assertEqual(jsonio.sha256_bytes(b"abc"),
                         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        path = self.dir / "f.bin"
        path.write_bytes(b"abc")
        self.assertEqual(jsonio.sha256_file(path), jsonio.sha256_bytes(b"abc"))

    def test_bom_stripped_with_warning(self) -> None:
        path = self.dir / "bom.json"
        path.write_bytes(jsonio.BOM + b'{"a": 1}')
        self.assertEqual(jsonio.read_json(path), {"a": 1})
        self.assertEqual([w.code for w in errors.drain_warnings()], ["W_BOM"])
        path.write_bytes(b'{"a": 1}')
        jsonio.read_json(path)
        self.assertEqual(errors.drain_warnings(), [])

    def test_invalid_json_and_missing(self) -> None:
        path = self.dir / "bad.json"
        path.write_bytes(b"{nope")
        with self.assertRaises(ValidationFailed):
            jsonio.read_json(path)
        with self.assertRaises(FileNotFoundError):
            jsonio.read_json(self.dir / "absent.json")

    def test_append_jsonl_one_line_per_call(self) -> None:
        path = self.dir / "events.jsonl"
        for i in range(3):
            jsonio.append_jsonl(path, {"i": i, "t": "é"})
        raw = path.read_bytes()
        self.assertEqual(raw.count(b"\n"), 3)
        self.assertEqual(raw.split(b"\n")[0], '{"i":0,"t":"é"}'.encode("utf-8"))
        rows = list(jsonio.read_jsonl(path))
        self.assertEqual([(n, d["i"]) for n, d in rows], [(1, 0), (2, 1), (3, 2)])  # type: ignore[index]

    def test_read_jsonl_bad_line(self) -> None:
        path = self.dir / "mixed.jsonl"
        path.write_bytes(b'{"a":1}\nnot json\n[1]\n\n{"b":2}\n')
        rows = list(jsonio.read_jsonl(path))
        self.assertEqual([n for n, _ in rows], [1, 2, 3, 5])
        self.assertIsInstance(rows[1][1], ErrorItem)
        self.assertEqual(rows[1][1].code, "E_JSONL_LINE")  # type: ignore[union-attr]
        self.assertEqual(rows[2][1].code, "E_JSONL_LINE")  # type: ignore[union-attr]
        self.assertEqual(rows[3][1], {"b": 2})
        self.assertEqual(list(jsonio.read_jsonl(self.dir / "absent.jsonl")), [])

    def test_bump_counter(self) -> None:
        path = self.dir / "state.json"
        self.assertIsNone(jsonio.bump_counter(path, "events_seq"))
        jsonio.write_json_atomic(path, {"events_seq": 4})
        self.assertEqual(jsonio.bump_counter(path, "events_seq"), 5)
        self.assertEqual(jsonio.bump_counter(path, "events_seq", floor=9), 10)
        self.assertEqual(jsonio.read_json(path)["events_seq"], 10)


@unittest.skipUnless(os.name == "nt", "os.replace onto an open file fails only on Windows")
class ReaderHoldsFile(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = S.mkdtemp()
        self.path = self.dir / "state.json"
        jsonio.write_json_atomic(self.path, {"v": 0})

    def tearDown(self) -> None:
        S.rmtree(self.dir)

    def hold(self, seconds: float) -> subprocess.Popen:
        ready = self.dir / f"ready-{seconds}"
        script = self.dir / "holder.py"
        S.write_text(script, HOLDER)
        proc = subprocess.Popen([sys.executable, str(script), str(self.path), str(seconds), str(ready)])
        deadline = time.monotonic() + 15
        while not ready.exists():
            if time.monotonic() > deadline:
                proc.kill()
                self.fail("holder did not start")
            time.sleep(0.02)
        return proc

    def test_retry_absorbs_a_short_hold(self) -> None:
        proc = self.hold(0.4)
        try:
            start = time.monotonic()
            jsonio.write_json_atomic(self.path, {"v": 1})
            self.assertGreater(time.monotonic() - start, 0.1, "the write had to wait for the reader")
        finally:
            proc.wait(timeout=15)
        self.assertEqual(jsonio.read_json(self.path), {"v": 1})

    def test_long_hold_is_env_error_and_temp_removed(self) -> None:
        proc = self.hold(6.0)
        try:
            with self.assertRaises(EnvError) as cm:
                jsonio.write_json_atomic(self.path, {"v": 2})
            self.assertEqual(cm.exception.code, "E_ENV")
            self.assertEqual(sorted(p.name for p in self.dir.iterdir() if p.suffix == ".tmp"), [])
        finally:
            proc.kill()
            proc.wait(timeout=15)
        self.assertEqual(jsonio.read_json(self.path), {"v": 0}, "the old content is intact")


if __name__ == "__main__":
    unittest.main()
