"""`result put`, merge receipts in any wave, merge intents and journal recovery (contract/CLI.md `result put`,
SCHEMAS.md 1.1 and 8, TESTS.md 3.7, LANES.md B04).

Run: python -m unittest discover -s scripts/tests -p "test_results.py" -v
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import _support as S
from _support_B04 import B04_FIXTURES, World, b01_doc

from execlib import jsonio, results


class ResultPut(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset()

    def _inbox_file(self, doc: dict, name: str = "T001.implementer.a1.json") -> str:
        path = self.w.layout.inbox("W01") / name
        S.write_json(path, doc)
        return str(path)

    def _put(self, path: str) -> tuple[int, dict]:
        code, env, _l = self.w.run(["result", "put", "--wave", "W01", "--task", "T001", "--role", "implementer",
                                    "--attempt", "1", "--file", path, "--by", "implementer"])
        return code, env

    def test_schema_failure_keeps_the_inbox_file_and_lists_paths(self) -> None:
        bad = b01_doc("result-implementer")
        del bad["status"]
        bad["merge"] = "landed"
        path = self._inbox_file(bad)
        code, env = self._put(path)
        self.assertEqual(code, 1, env)
        self.assertTrue(json.loads(Path(path).read_text(encoding="utf-8")))  # still in the inbox
        self.assertTrue(any(e.get("path") for e in env["errors"]))
        self.assertFalse(self.w.layout.result("W01", "T001", "implementer", 1).exists())
        # positive control: the valid document is accepted and moved
        code, env = self._put(self._inbox_file(b01_doc("result-implementer")))
        self.assertEqual(code, 0, env)
        self.assertTrue(self.w.layout.result("W01", "T001", "implementer", 1).exists())

    def test_identical_bytes_are_a_noop_and_other_bytes_exit_4(self) -> None:
        doc = b01_doc("result-implementer")
        code, env = self._put(self._inbox_file(doc))
        self.assertEqual(code, 0, env)
        target = self.w.layout.result("W01", "T001", "implementer", 1)
        first = target.read_bytes()
        self.assertEqual(env["data"]["sha256"], jsonio.sha256_bytes(first))
        self.assertFalse((self.w.layout.inbox("W01") / "T001.implementer.a1.json").exists())  # moved
        code, env = self._put(self._inbox_file(doc))
        self.assertEqual(code, 0, env)
        self.assertEqual(target.read_bytes(), first)
        self.assertEqual(len([e for e in self.w.events("result.recorded")]), 1)
        other = dict(doc, notes="different")
        code, env = self._put(self._inbox_file(other))
        self.assertEqual((code, env["errors"][0]["code"]), (4, "E_RESULT_IMMUTABLE"))
        self.assertEqual(target.read_bytes(), first)

    def test_task_mismatch_is_refused(self) -> None:
        doc = dict(b01_doc("result-implementer"), task="T002")
        code, env = self._put(self._inbox_file(doc))
        self.assertEqual(code, 1, env)


class Receipts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset()

    def test_landed_receipt_found_in_any_wave(self) -> None:
        w = self.w
        sha = w.land()
        w.merge_receipt("T001", None, wave="W01", outcome="conflict")
        w.merge_receipt("T001", sha, wave="W03", attempt=1)
        found = results.landed_receipt(w.layout, "T001", 1)
        self.assertIsNotNone(found)
        self.assertEqual(found["landed_sha"], sha)
        self.assertEqual(results.find_any_wave(w.layout, "T001", "merge", 1)[0], "W03")
        self.assertIsNone(results.landed_receipt(w.layout, "T001", 2))

    def test_gate_receipt_is_valid_and_immutable(self) -> None:
        w = self.w
        sha = w.repo.head()
        with w.locked():
            path = results.write_gate_receipt(w.ctx("wave emit"), w.task("T005"), "W02", 1, sha)
            again = results.write_gate_receipt(w.ctx("wave emit"), w.task("T005"), "W02", 1, sha)
        self.assertEqual(path, again)
        doc = jsonio.read_json(path)
        self.assertEqual((doc["mode"], doc["outcome"], doc["landed_sha"], doc["push_attempts"]),
                         ("gate", "landed", sha, 0))

    def test_intent_on_origin_becomes_a_landed_receipt(self) -> None:
        w = self.w
        landed = w.land()
        local_only = w.local_commit()
        S.write_json(w.layout.merge_intent("T001", 1, 0),
                     {"head_sha": landed, "origin_before": landed, "started_utc": S.FIXED_NOW, "wave": "W02"})
        S.write_json(w.layout.merge_intent("T002", 1, 0),
                     {"head_sha": local_only, "origin_before": landed, "started_utc": S.FIXED_NOW, "wave": "W02"})
        git = __import__("execlib.status", fromlist=["product_git"]).product_git(w.layout)
        with w.locked():
            done = results.finalize_merge_intents(w.ctx("status"), git)
        self.assertEqual(done, ["T001.a1r0"])
        receipt = results.landed_receipt(w.layout, "T001", 1)
        self.assertEqual(receipt["landed_sha"], landed)
        self.assertFalse(w.layout.merge_intent("T001", 1, 0).exists())
        self.assertTrue(w.layout.merge_intent("T002", 1, 0).exists())  # not on origin/main: left for merge
        self.assertIsNone(results.landed_receipt(w.layout, "T002", 1))


class Journal(unittest.TestCase):
    def test_recover_from_journal_returns_results_never_put(self) -> None:
        found = results.recover_from_journal(B04_FIXTURES / "journal.jsonl")
        keys = sorted((t, r, a) for t, r, a, _doc in found)
        self.assertEqual(keys, [("T001", "implementer", 1), ("T001", "verifier", 1), ("T002", "implementer", 1)])
        for _t, role, _a, doc in found:
            self.assertTrue(S.schema.validate(doc, results.ROLE_SCHEMAS[role]).ok)

    def test_empty_journal_returns_nothing(self) -> None:
        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        path = S.write_text(tmp / "journal.jsonl", '{"type": "log", "text": "nothing"}\n')
        self.assertEqual(results.recover_from_journal(path), [])


if __name__ == "__main__":
    unittest.main()
