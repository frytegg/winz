"""Answer ingestion and verification (contract/CLI.md `answers ingest`, 0.7, SCHEMAS.md 8, TWO-DEV.md 6,
TESTS.md 3.7, LANES.md B04).

Every verification method against a fake (a chain reader script, files, options, regex, SHAs on or off origin/main,
a loopback HTTP server) with its passing and failing case; forgeries refused by the strict pattern before any reader
runs; immutability; --scope-change and --relay unblock nothing; secrets are stored redacted. Proven-public values
(README.md 8, contract revision 3): a chain-verified hash is registered in public-values.jsonl and stored verbatim,
checked against lane B06's real scan and lane B08's real `exec.py sync`.

Run: python -m unittest discover -s scripts/tests -p "test_answers.py" -v
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import _support as S
from _support_B04 import World

from execlib import answers, integrity

READER = r'''
import json, sys
from pathlib import Path
here = Path(__file__).resolve().parent
with open(here / "reader.log", "a", encoding="utf-8", newline="\n") as fh:
    fh.write(json.dumps(sys.argv[1:]) + "\n")
cfg = json.loads((here / "reader.json").read_text(encoding="utf-8"))
print(json.dumps(cfg["out"]))
sys.exit(cfg.get("exit", 0))
'''
TX = "0x" + "ab" * 32
TX_OTHER = "0x" + "cd" * 32
TX_MIXED = "0x" + "aBcD" * 16  # the registry is lower-cased; the answer keeps the owner's spelling


def manual(tid: str, key: str, kind: str, method: str, **verify: object) -> dict:
    v = {"method": method}
    v.update(verify)
    return S.build_task(tid, kind="manual", manual={
        "steps": ["Fais-le."], "where": "phone", "latest_start_utc": S.FIXED_END, "options_source": None,
        "options": [{"id": "a", "label": "A", "consequence": "c"}, {"id": "b", "label": "B", "consequence": "c"}],
        "decision_deadline_utc": None, "bring_back": [{"key": key, "kind": kind, "verify": v}]})


class Verify(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()
        cls.tools = cls.w.root / "tools"
        S.write_text(cls.tools / "reader.py", READER)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def _reader(self, out: dict, code: int = 0) -> str:
        S.write_json(self.tools / "reader.json", {"out": out, "exit": code})
        log = self.tools / "reader.log"
        if log.exists():
            log.unlink()
        return f'"{Path(sys.executable).as_posix()}" "{(self.tools / "reader.py").as_posix()}"'

    def _calls(self) -> list:
        log = self.tools / "reader.log"
        return [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []

    def _chain(self, out: dict, code: int = 0, value: str = TX, expect: dict | None = None) -> dict:
        bb = {"key": "T001-tx", "kind": "tx-hash", "verify": {"method": "chain-reread", "spec": self._reader(out, code),
                                                              "expect": expect or {"chain": "cardano",
                                                                                   "network": "preprod"}}}
        return answers.verify(bb, value, [], self.w.ctx("answers ingest"), text=value, task=None,
                              posted_at=S.FIXED_NOW)

    GOOD = {"chain": "cardano", "network": "preprod", "from": "addr1", "to": "addr2", "value": "5",
            "block_time": "2026-10-03T08:00:00Z"}

    def test_chain_reread_pass_and_fail(self) -> None:
        self.assertTrue(self._chain(self.GOOD)["ok"])
        self.assertEqual(self._calls()[-1][-1], TX)  # the value is the last argv element
        self.assertFalse(self._chain(self.GOOD, code=1)["ok"])

    def test_chain_reread_forgeries(self) -> None:
        res = self._chain(self.GOOD, value="0xab; echo pwned")
        self.assertFalse(res["ok"])
        self.assertEqual(self._calls(), [])  # refused by the strict pattern before any reader ran
        self.assertFalse(self._chain(dict(self.GOOD, network="mainnet"))["ok"])
        res = self._chain(self.GOOD, expect={"chain": "cardano", "network": "preprod", "from": "addr9"})
        self.assertFalse(res["ok"])
        self.assertFalse(self._chain(dict(self.GOOD, block_time="2026-10-01T00:00:00Z"))["ok"])
        self.assertTrue(self._chain(self.GOOD)["ok"])  # positive control

    def test_chain_reread_proves_the_chain_and_network_it_read(self) -> None:
        """CLI.md: the reader prints {chain, network, from, to, value, block_time}. The chain and network it names
        are what public-values.jsonl records (README.md 8), so a reader that names neither proves nothing."""
        bb = {"key": "T001-tx", "kind": "tx-hash", "verify": {"method": "chain-reread", "spec": self._reader(self.GOOD),
                                                              "expect": {"chain": "cardano", "network": "preprod"}}}
        ctx = self.w.ctx("answers ingest")
        res, proven = answers.verify_proven(bb, TX, [], ctx, text=TX, posted_at=S.FIXED_NOW)
        self.assertEqual((res["ok"], proven), (True, {"chain": "cardano", "network": "preprod"}))
        for missing in ("chain", "network"):
            bb["verify"]["spec"] = self._reader({k: v for k, v in self.GOOD.items() if k != missing})
            res, proven = answers.verify_proven(bb, TX, [], ctx, text=TX, posted_at=S.FIXED_NOW)
            self.assertEqual((res["ok"], proven), (False, None), missing)
            self.assertIn(f"has no {missing}", res["detail"])
        bb["verify"]["spec"] = self._reader(self.GOOD, code=1)
        self.assertEqual(answers.verify_proven(bb, TX, [], ctx, text=TX, posted_at=S.FIXED_NOW)[1], None)
        # no other method proves a value public, even when it passes
        regex = {"key": "T001-tx", "kind": "tx-hash", "verify": {"method": "regex", "spec": "^0x"}}
        res, proven = answers.verify_proven(regex, TX, [], ctx, text=TX)
        self.assertEqual((res["ok"], proven), (True, None))

    def _bb(self, kind: str, method: str, spec: str | None = None) -> dict:
        v: dict = {"method": method}
        if spec is not None:
            v["spec"] = spec
        return {"key": "k", "kind": kind, "verify": v}

    def test_file_exists(self) -> None:
        ctx = self.w.ctx("answers ingest")
        shot = S.write_text(self.w.root / "uploads" / "shot.png", "png bytes")
        self.assertTrue(answers.verify(self._bb("screenshot", "file-exists"), None, [str(shot)], ctx)["ok"])
        self.assertFalse(answers.verify(self._bb("screenshot", "file-exists"), None,
                                        [str(self.w.root / "uploads" / "nope.png")], ctx)["ok"])

    def test_choice_in_options(self) -> None:
        ctx = self.w.ctx("answers ingest")
        task = S.build_task("T009", kind="decision")
        from execlib.model import Task
        t = Task.from_raw(task)
        self.assertTrue(answers.verify(self._bb("choice", "choice-in-options"), "yes", [], ctx, task=t)["ok"])
        self.assertFalse(answers.verify(self._bb("choice", "choice-in-options"), "maybe", [], ctx, task=t)["ok"])
        self.assertFalse(answers.verify(self._bb("choice", "choice-in-options"), "Yes!", [], ctx, task=t)["ok"])

    def test_regex(self) -> None:
        ctx = self.w.ctx("answers ingest")
        bb = self._bb("text", "regex", r"^(?i:oui|yes)\b")
        self.assertTrue(answers.verify(bb, None, [], ctx, text="Oui, c'est bon")["ok"])
        self.assertFalse(answers.verify(bb, None, [], ctx, text="non")["ok"])

    def test_sha_on_origin_main(self) -> None:
        ctx = self.w.ctx("answers ingest")
        on = self.w.land()
        off = self.w.local_commit()
        self.assertTrue(answers.verify(self._bb("sha", "sha-on-origin-main"), on, [], ctx)["ok"])
        self.assertFalse(answers.verify(self._bb("sha", "sha-on-origin-main"), off, [], ctx)["ok"])
        self.w.reset()

    def test_url_resolves(self) -> None:
        ctx = self.w.ctx("answers ingest")
        base, close = S.http_fixture({"/ok": (200, "fine")})
        self.addCleanup(close)
        self.assertTrue(answers.verify(self._bb("url", "url-resolves"), f"{base}/ok", [], ctx)["ok"])
        self.assertFalse(answers.verify(self._bb("url", "url-resolves"), f"{base}/missing", [], ctx)["ok"])

    def test_owner_attest_only_for_text_and_transcript(self) -> None:
        ctx = self.w.ctx("answers ingest")
        for kind in ("text", "transcript"):
            self.assertTrue(answers.verify(self._bb(kind, "owner-attest"), None, [], ctx, text="fait")["ok"])
        for kind, value in (("url", "https://example.invalid/x"), ("sha", "a" * 40), ("screenshot", None)):
            self.assertFalse(answers.verify(self._bb(kind, "owner-attest"), value, [], ctx, text="fait")["ok"], kind)


class Ingest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World([manual("T001", "T001-done", "text", "owner-attest"),
                       manual("T002", "T002-url", "url", "regex", spec=r"^https://")])

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset([manual("T001", "T001-done", "text", "owner-attest"),
                      manual("T002", "T002-url", "url", "regex", spec=r"^https://")])
        self.w.set_status("T001", "running", posted={"at_utc": S.FIXED_NOW, "push_text": "T001 · À faire"})
        self.w.set_status("T002", "running", posted={"at_utc": S.FIXED_NOW, "push_text": "T002 · À faire"})

    def _ingest(self, key: str, text: str, *extra: str, task: str = "T001") -> tuple[int, dict]:
        path = self.w.text_file(f"{key}.txt", text)
        code, env, _l = self.w.run(["answers", "ingest", "--key", key, "--text-file", str(path), "--source",
                                    "terminal", "--task", task, "--by", "devA", *extra])
        return code, env

    def test_verified_answer_completes_the_task(self) -> None:
        code, env = self._ingest("T001-done", "C'est fait.\n")
        self.assertEqual(code, 0, env)
        self.assertEqual((env["data"]["task_status"], env["data"]["unblocked"]), ("done", ["T001"]))
        header, body = answers.parse_answer(self.w.layout.answer("T001-done"))
        self.assertTrue(header["verification"]["ok"])
        self.assertEqual(body.strip(), "C'est fait.")

    def test_failed_verification_keeps_the_answer_and_the_task_running(self) -> None:
        code, env = self._ingest("T002-url", "http://insecure.example.invalid/\n", task="T002")
        self.assertEqual(code, 1, env)
        self.assertEqual(env["data"]["task_status"], "running")
        self.assertTrue(self.w.layout.answer("T002-url").exists())
        self.assertEqual(self.w.entry("T002")["history"][-1]["to"], "running")
        code, env = self._ingest("T002-url-2", "https://ok.example.invalid/\n", task="T002")  # corrected key
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["task_status"], "done")

    def test_immutability(self) -> None:
        self.assertEqual(self._ingest("T001-done", "Fait.\n")[0], 0)
        self.assertEqual(self._ingest("T001-done", "Fait.\n")[0], 0)  # same bytes: no-op
        code, env = self._ingest("T001-done", "Autre chose.\n")
        self.assertEqual((code, env["errors"][0]["code"]), (4, "E_ANSWER_IMMUTABLE"))

    def test_scope_change_unblocks_nothing(self) -> None:
        code, env = self._ingest("T001-done", "Fait, et ajoute aussi un export PDF.\n", "--scope-change")
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["unblocked"], [])
        self.assertIsNotNone(env["data"]["proposal"])
        self.assertEqual(self.w.entry("T001")["status"], "running")
        header, _b = answers.parse_answer(self.w.layout.answer("T001-done"))
        self.assertTrue(header["scope_change"])

    def test_relay_unblocks_nothing(self) -> None:
        code, env = self._ingest("T001-done", "Fait.\n", "--relay")
        self.assertEqual(code, 0, env)
        self.assertTrue(self.w.layout.answer("T001-done-relay-A").exists())
        self.assertFalse(self.w.layout.answer("T001-done").exists())
        self.assertEqual((env["data"]["unblocked"], env["data"]["proposal"]), ([], None))
        self.assertEqual(self.w.entry("T001")["status"], "running")
        self.assertEqual(len(self.w.events("answer.relayed")), 1)

    def test_planted_key_is_stored_redacted(self) -> None:
        secret = S.planted("key.private")
        code, env = self._ingest("T001-done", f"Fait. La clé : {secret}\n")
        self.assertEqual(code, 0, env)
        stored = self.w.layout.answer("T001-done").read_text(encoding="utf-8")
        self.assertNotIn(secret, stored)
        self.assertIn("[redacted:", stored)
        raw = (self.w.layout.local / "answers-raw" / "T001-done.txt").read_text(encoding="utf-8")
        self.assertIn(secret, raw)
        self.assertIn("W_SECRET_REDACTED", [w["code"] for w in env["warnings"]])
        # positive control: a clean answer is stored as is
        self.w.reset([manual("T001", "T001-done", "text", "owner-attest")])
        self.w.set_status("T001", "running", posted={"at_utc": S.FIXED_NOW, "push_text": "T001 · À faire"})
        code, env = self._ingest("T001-done", "Fait.\n")
        self.assertNotIn("[redacted:", self.w.layout.answer("T001-done").read_text(encoding="utf-8"))

    def test_unknown_key_is_a_usage_error(self) -> None:
        code, env = self._ingest("T001-other", "Fait.\n")
        self.assertEqual(code, 2, env)

    def test_from_notion_and_unchanged_rejection(self) -> None:
        w = self.w
        props = {"Clé": "T002", "Réponse": "http://pas-https.example.invalid", "Décision": "",
                 "Responsable": "Dev A"}
        path = S.write_text(w.root / "inputs" / "fetch-T002.txt", "<page>\n<properties>"
                            + json.dumps(props, ensure_ascii=False) + "</properties>\n</page>\n")
        code, env, _l = w.run(["answers", "ingest", "--from-notion", str(path), "--task", "T002", "--by", "devA"])
        self.assertEqual(code, 1, env)
        code, env, _l = w.run(["answers", "ingest", "--from-notion", str(path), "--task", "T002", "--by", "devA"])
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_ANSWER_UNCHANGED"))
        props["Réponse"] = "https://ok.example.invalid"
        S.write_text(path, "<page>\n<properties>" + json.dumps(props, ensure_ascii=False) + "</properties>\n</page>\n")
        code, env, _l = w.run(["answers", "ingest", "--from-notion", str(path), "--task", "T002", "--by", "devA"])
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["answer_path"], "answers/T002-url-2.md")


def codes(items: list[dict]) -> list[str]:
    return [x["code"] for x in items]


class PublicValues(unittest.TestCase):
    """README.md 8, owner decision 2026-10-02 (Q-B04-24/25, drift re-check B04-D1): a transaction hash and a private
    key share one shape (`0x` + 64 hex). A hash the chain re-read confirmed is registered in public-values.jsonl
    (integrity.register_public_value, proven `chain-reread`), then stored verbatim, so lane B06's tx proof reads it
    from the tracked header and lane B08's `sync` commits the file; the text-hygiene scan gets the whole registry as
    `public`. An unproven value of the same shape is stored null, and every other secret shape is still redacted."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()
        cls.tools = cls.w.root / "tools"
        S.write_text(cls.tools / "reader.py", READER)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def _world(self, method: str = "chain-reread", reader_exit: int = 0, out: dict | None = None) -> None:
        S.write_json(self.tools / "reader.json", {"out": Verify.GOOD if out is None else out, "exit": reader_exit})
        spec = f'"{Path(sys.executable).as_posix()}" "{(self.tools / "reader.py").as_posix()}"' \
            if method == "chain-reread" else "^0x"
        extra = {"spec": spec}
        if method == "chain-reread":
            extra["expect"] = {"chain": "cardano", "network": "preprod"}
        self.w.reset([manual("T001", "T001-tx", "tx-hash", method, **extra),
                      manual("T002", "T002-note", "text", "owner-attest"),
                      manual("T003", "T003-link", "url", "regex", spec=r"^https://")])
        for tid in ("T001", "T002", "T003"):
            self.w.set_status(tid, "running", posted={"at_utc": S.FIXED_NOW, "push_text": f"{tid} · À faire"})

    def _ingest(self, text: str, key: str = "T001-tx", task: str = "T001") -> tuple[int, dict, str]:
        path = self.w.text_file(f"{key}.txt", text)
        code, env, _l = self.w.run(["answers", "ingest", "--key", key, "--text-file", str(path), "--source",
                                    "terminal", "--task", task, "--by", "devA"])
        stored = self.w.layout.answer(key).read_text(encoding="utf-8")
        return code, env, stored

    def _lines(self, stored: str, key: str = "T001-tx") -> list[tuple[str, int, str]]:
        return [(f"answers/{key}.md", i + 1, ln) for i, ln in enumerate(stored.split("\n"))]

    def _scan_ok(self, lines: list[tuple[str, int, str]], *, registered: bool = True) -> bool:
        """Lane B06's real secret scan of tracked lines, with the registry as `public` (or without it)."""
        public = integrity.load_public_values(self.w.layout) if registered else frozenset()
        return integrity.scan_secrets(lines, public=public).state == "ok"

    def _raw(self, key: str) -> Path:
        return self.w.layout.local / "answers-raw" / f"{key}.txt"

    def test_chain_verified_evm_hash_is_registered_then_stored_verbatim(self) -> None:
        w = self.w
        self._world()
        code, env, stored = self._ingest(TX + "\n")
        self.assertEqual(code, 0, env)
        self.assertEqual((env["data"]["verification"]["ok"], env["data"]["task_status"]), (True, "done"))
        self.assertNotIn("W_SECRET_REDACTED", codes(env["warnings"]))
        header, body = answers.parse_answer(w.layout.answer("T001-tx"))
        self.assertEqual((header["value"], body.strip()), (TX, TX))  # lane B06's tx proof reads header["value"]
        self.assertFalse(self._raw("T001-tx").exists())
        rows = w.public_rows()
        self.assertEqual(len(rows), 1, rows)
        self.assertEqual({k: rows[0].get(k) for k in ("value", "kind", "chain", "network", "proven", "source")},
                         {"value": TX, "kind": "evm-tx-hash", "chain": "cardano", "network": "preprod",
                          "proven": "chain-reread", "source": "answers/T001-tx.md"})
        self.assertIn(TX, integrity.load_public_values(w.layout))
        # the tracked file passes the secret scan with the registry, and is the F1 failure without it
        self.assertTrue(self._scan_ok(self._lines(stored)))
        self.assertFalse(self._scan_ok(self._lines(stored), registered=False))
        # the same answer again: a no-op, and the registry keeps one line
        code, env, again = self._ingest(TX + "\n")
        self.assertEqual((code, again), (0, stored), env)
        self.assertEqual(len(w.public_rows()), 1)

    def test_b08_sync_commits_the_registered_answer_and_quarantines_a_planted_key(self) -> None:
        """Lane B08's real `exec.py sync` (its secret scan gets the registry as `public`): the registered answer is
        committed verbatim, while a planted key of the same shape in another state file is quarantined."""
        w = self.w
        self._world()
        w.state_repo()
        code, env, stored = self._ingest(TX + "\n")
        self.assertEqual(code, 0, env)
        planted = S.write_text(w.layout.state / "answers" / "T001-planted.md",
                               f"the signer key is {S.planted('key.private')}\n")
        code, env, _l = w.run(["sync"])
        self.assertEqual((code, codes(env["errors"])), (4, ["E_SECRET_IN_STATE"]), env)
        self.assertEqual(env["data"]["files"], ["answers/T001-planted.md"])  # the registered answer is no hit
        self.assertFalse(planted.exists())
        self.assertTrue((w.layout.local / "quarantine" / "answers" / "T001-planted.md").exists())
        code, env, _l = w.run(["sync"])
        self.assertEqual(code, 0, env)
        self.assertIn("answers/T001-tx.md", env["data"]["committed_paths"])
        self.assertIn("public-values.jsonl", env["data"]["committed_paths"])
        committed = w.state_git("show", "HEAD:answers/T001-tx.md")
        self.assertEqual(committed, stored)
        self.assertIn(f'"value": "{TX}"', committed)

    def test_unproven_value_of_the_same_shape_is_stored_null(self) -> None:
        """The verifier's probe (scratchpad/b04_tx_probe.py): a `^0x` regex cannot tell a tx hash from a key."""
        self._world("regex")
        code, env, stored = self._ingest(TX + "\n")
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["task_status"], "done")
        self.assertIn("W_SECRET_REDACTED", codes(env["warnings"]))
        header, body = answers.parse_answer(self.w.layout.answer("T001-tx"))
        self.assertIsNone(header["value"])
        self.assertNotIn(TX, stored)
        self.assertIn("[redacted:hex-key]", body)
        self.assertIn(TX, self._raw("T001-tx").read_text(encoding="utf-8"))  # local only, never synced
        self.assertEqual(self.w.public_rows(), [])  # a regex proves nothing: never registered
        self.assertTrue(self._scan_ok(self._lines(stored), registered=False))

    def test_chain_refused_hash_is_neither_registered_nor_stored(self) -> None:
        self._world(reader_exit=1)
        code, env, stored = self._ingest(TX + "\n")
        self.assertEqual(code, 1, env)
        header, _body = answers.parse_answer(self.w.layout.answer("T001-tx"))
        self.assertEqual((header["verification"]["ok"], header["value"]), (False, None))
        self.assertNotIn(TX, stored)
        self.assertEqual(self.w.public_rows(), [])
        # a reader that confirms a transaction without naming its network proves nothing either
        self._world(out={k: v for k, v in Verify.GOOD.items() if k != "network"})
        code, env, stored = self._ingest(TX + "\n")
        self.assertEqual(code, 1, env)
        self.assertIn("no network", env["data"]["verification"]["detail"])
        self.assertNotIn(TX, stored)
        self.assertEqual(self.w.public_rows(), [])

    def test_planted_key_is_still_redacted_next_to_a_registered_hash(self) -> None:
        secret = S.planted("key.private")
        note = f"Fait : {TX}\nla clé du signataire : {secret}\n"
        self._world()
        self.assertEqual(self._ingest(TX + "\n")[0], 0)  # TX registered
        code, env, stored = self._ingest(note, key="T002-note", task="T002")
        self.assertEqual(code, 0, env)
        self.assertIn("W_SECRET_REDACTED", codes(env["warnings"]))
        self.assertNotIn(secret, stored)
        self.assertIn("la clé du signataire : [redacted:hex-key]", stored)
        self.assertIn(f"Fait : {TX}", stored)  # the registered value next to it stays verbatim
        raw = self._raw("T002-note").read_text(encoding="utf-8")
        self.assertIn(secret, raw)
        self.assertTrue(self._scan_ok(self._lines(stored, "T002-note")))
        # positive control: the same note before TX is registered loses both shapes
        self._world()
        code, env, stored = self._ingest(note, key="T002-note", task="T002")
        self.assertEqual(code, 0, env)
        self.assertNotIn(secret, stored)
        self.assertNotIn(TX, stored)
        self.assertIn("Fait : [redacted:hex-key]", stored)

    def test_the_hygiene_scan_reads_the_whole_registry(self) -> None:
        """`public` is integrity.load_public_values: a hash a tx proof registered (proven `tx-proof`) is public in
        any answer, while an unregistered one of the same shape, checked the same way, is not (positive control)."""
        w = self.w
        self._world("regex")
        with w.locked():
            self.assertTrue(integrity.register_public_value(
                w.layout, value=TX_OTHER, kind="evm-tx-hash", chain="cardano", network="preprod", proven="tx-proof",
                source="proofs/runs/T009/T009-cdcdcdcd-20261003T071200Z-1.json"))
        code, env, stored = self._ingest(TX_OTHER + "\n")
        self.assertEqual(code, 0, env)
        self.assertNotIn("W_SECRET_REDACTED", codes(env["warnings"]))
        header, body = answers.parse_answer(w.layout.answer("T001-tx"))
        self.assertEqual((header["value"], body.strip()), (TX_OTHER, TX_OTHER))
        self.assertEqual(len(w.public_rows()), 1)  # a regex check registers nothing more
        code, env, stored = self._ingest(TX + "\n", key="T001-tx-2")
        self.assertEqual(code, 0, env)
        self.assertIsNone(answers.parse_answer(w.layout.answer("T001-tx-2"))[0]["value"])
        self.assertNotIn(TX, stored)

    def test_bare_hash_is_registered_as_tx_hash_and_kept(self) -> None:
        """A bare 64-hex hash (Cardano style) has no secret shape; proved on chain, it is registered too."""
        bare = TX[2:]
        self._world()
        code, env, stored = self._ingest(bare + "\n")
        self.assertEqual(code, 0, env)
        self.assertNotIn("W_SECRET_REDACTED", codes(env["warnings"]))
        header, body = answers.parse_answer(self.w.layout.answer("T001-tx"))
        self.assertEqual((header["value"], body.strip()), (bare, bare))
        self.assertFalse(self._raw("T001-tx").exists())
        self.assertEqual([(r["value"], r["kind"]) for r in self.w.public_rows()], [(bare, "tx-hash")])

    def test_a_mixed_case_hash_keeps_its_spelling(self) -> None:
        """The registry is lower-cased (MODULES.md `load_public_values`); the answer keeps the owner's spelling, also
        when a real hit next to it makes the text go through redaction."""
        self._world()
        code, env, stored = self._ingest(TX_MIXED + "\n")
        self.assertEqual(code, 0, env)
        self.assertNotIn("W_SECRET_REDACTED", codes(env["warnings"]))
        header, body = answers.parse_answer(self.w.layout.answer("T001-tx"))
        self.assertEqual((header["value"], body.strip()), (TX_MIXED, TX_MIXED))
        self.assertIn(TX_MIXED.lower(), integrity.load_public_values(self.w.layout))
        self.assertTrue(self._scan_ok(self._lines(stored)))
        secret = S.planted("key.private")
        code, env, stored = self._ingest(f"Fait : {TX_MIXED}\nclé : {secret}\n", key="T002-note", task="T002")
        self.assertEqual(code, 0, env)
        self.assertIn("W_SECRET_REDACTED", codes(env["warnings"]))
        self.assertIn(f"Fait : {TX_MIXED}\nclé : [redacted:hex-key]", stored)
        self.assertNotIn(secret, stored)

    def test_a_hash_inside_an_explorer_link_is_not_a_hit(self) -> None:
        """README.md 8 (b): a value right after `/tx/` in an http(s) URL on the same line is not a hit, and is not
        registered (a link is no chain proof); the same hash outside a link is a hit (positive control). The
        redaction is log.redact's, so a link next to a real hit is masked too (the safe side)."""
        link = f"https://explorer.example.invalid/tx/{TX}"
        self._world()
        code, env, stored = self._ingest(link + "\n", key="T003-link", task="T003")
        self.assertEqual(code, 0, env)
        self.assertNotIn("W_SECRET_REDACTED", codes(env["warnings"]))
        header, body = answers.parse_answer(self.w.layout.answer("T003-link"))
        self.assertEqual((header["value"], body.strip()), (link, link))
        self.assertEqual(self.w.public_rows(), [])
        code, env, stored = self._ingest(f"{link} et aussi {TX}\n", key="T002-note", task="T002")
        self.assertEqual(code, 0, env)
        self.assertIn("W_SECRET_REDACTED", codes(env["warnings"]))
        self.assertNotIn(TX, stored)


class SignOff(unittest.TestCase):
    """FE-21 (H3): `answers ingest` prints the choices.json entry, the refusal shape on a « non »."""

    def setUp(self) -> None:
        raw = S.build_task("T021", kind="manual", template="frontend:FE-21", phase="deliverable")
        raw["manual"] = dict(raw["manual"], bring_back=[{"key": "T021-signoff", "kind": "text",
                                                         "verify": {"method": "regex", "spec": r"^(?i:oui|yes)\b"}}])
        self.w = World([raw])
        self.addCleanup(self.w.cleanup)
        self.w.set_status("T021", "running", posted={"at_utc": S.FIXED_NOW, "push_text": "T021 · À faire"})

    def _ingest(self, key: str, text: str) -> tuple[int, dict]:
        path = self.w.text_file(f"{key}.txt", text)
        code, env, _l = self.w.run(["answers", "ingest", "--key", key, "--text-file", str(path), "--source",
                                    "remote-control", "--task", "T021", "--by", "devA"])
        return code, env

    def test_refusal_then_sign_off(self) -> None:
        code, env = self._ingest("T021-signoff", "Non.\n1. Le titre est trop petit\n2. Le logo est flou\n")
        self.assertEqual(code, 1, env)
        fc = env["data"]["frontend_choice"]
        self.assertEqual((fc["key"], fc["value"]["signed_off"]), ("H3", False))
        self.assertEqual(fc["value"]["changes"], ["Le titre est trop petit", "Le logo est flou"])
        self.assertIsNotNone(env["data"]["proposal"])  # an amendment decision with the fix option
        code, env = self._ingest("T021-signoff-2", "Oui, parfait.\n")
        self.assertEqual(code, 0, env)
        fc = env["data"]["frontend_choice"]
        self.assertEqual((fc["value"]["signed_off"], fc["value"]["changes"], fc["value"]["channel"]),
                         (True, [], "remote-control"))
        self.assertEqual(fc["value"]["source"], ".execution/answers/T021-signoff-2.md")


if __name__ == "__main__":
    unittest.main()
