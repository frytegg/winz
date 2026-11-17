"""Integrity scanners (contract/TESTS.md 3.11, LANES.md B06): each scanner catches its planted violation and passes
a clean input; a scanner that misses its plant makes the scan fail ("blind scan"); details never carry matched text.
Proven-public values (README.md 8, contract revision 3): a registered value and an explorer-link value pass, the same
shape unregistered or outside a link is refused, registration needs a chain proof, is idempotent and writes one
canonical line.

Run: python -m unittest discover -s scripts/tests -p "test_integrity.py" -v
"""
from __future__ import annotations

import functools
import hashlib
import unittest
from pathlib import Path

import _support as S

from execlib import clock, integrity, jsonio, locks, nevershow, paths
from execlib.errors import InternalError, PolicyRefused
from execlib.gitutil import Git


def _ns_entries() -> list[nevershow.Entry]:
    entries, _w = nevershow.load(S.RENDERED / "never-show.json")
    return nevershow.active(entries, S.fixed_now())


class TrailerAndConventional(unittest.TestCase):
    def test_trailers_each_plant_caught_and_prose_clean(self) -> None:
        for name in ("trailer.coauthor", "trailer.signoff", "trailer.generated"):
            with self.subTest(name=name):
                scan = integrity.scan_trailers([("a" * 40, "fix: x\n\n" + S.planted(name))])
                self.assertEqual(scan.state, "fail")
                self.assertNotIn(S.planted(name), scan.detail)
        clean = integrity.scan_trailers([("b" * 40, "docs: no attribution trailers in this repo")])
        self.assertEqual(clean.state, "ok")

    def test_conventional(self) -> None:
        good = integrity.scan_conventional([("a" * 40, "fix(engine): use the median capacity")])
        self.assertEqual(good.state, "ok")
        for msg in ('Revert "x"', "updated stuff", "Merge branch 'x'", "feat:no space"):
            with self.subTest(msg=msg):
                self.assertEqual(integrity.scan_conventional([("a" * 40, msg)]).state, "fail")
        self.assertEqual(integrity.scan_conventional([("a" * 40, "feat!: drop v1\n\nbody")]).state, "ok")


class Secrets(unittest.TestCase):
    def test_planted_key_shapes_caught_without_text(self) -> None:
        key = S.planted("key.private")
        scan = integrity.scan_secrets([("src/a.js", 3, f"const k = '{key}'")])
        self.assertEqual(scan.state, "fail")
        self.assertIn("src/a.js:3", scan.detail)
        self.assertNotIn(key, scan.detail)
        pem = S.planted("key.pem")
        text_scan = integrity.scan_secrets_text("intro\n" + pem + "\n", where="answer")
        self.assertEqual(text_scan.state, "fail")
        self.assertNotIn(pem.split("\n")[1], text_scan.detail)
        self.assertEqual(integrity.scan_secrets([("src/a.js", 1, "const k = 1;")]).state, "ok")
        self.assertEqual(integrity.scan_secrets_text("nothing here", where="x").state, "ok")


class PublicValues(unittest.TestCase):
    """README.md 8 (owner decision of 2026-10-02): a tx hash and a private key share one shape, so a secret-shaped
    value is cleared only when listed in public-values.jsonl (after a chain proof) or inside an explorer link; every
    clearance sits next to the same shape refused, and every refusal next to its positive control."""

    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.layout = paths.layout_for(None, self.tmp / ".execution")
        jsonio.write_json_atomic(self.layout.local_state, S.build_local_state("A"))
        self.h1 = "0x" + hashlib.sha256(b"public-value-1").hexdigest()     # built at runtime (TESTS.md 1.4)
        self.h2 = "0x" + hashlib.sha256(b"unlisted-value-2").hexdigest()

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def register(self, value: str, **over: str) -> bool:
        kw = {"kind": "evm-tx-hash", "chain": "evm", "network": "testnet", "proven": "chain-reread",
              "source": "answers/T004-tx.md"}
        kw.update(over)
        with locks.hold(self.layout, "state", command="test"):
            return integrity.register_public_value(self.layout, value=value, **kw)

    def test_registered_value_passes_same_shape_unregistered_refused(self) -> None:
        line = [("README.md", 3, f"the deployment tx {self.h1}")]
        # positive control: unlisted, the hash is a secret shape (only the registry clears it)
        self.assertEqual(integrity.scan_secrets(line).state, "fail")
        self.assertTrue(self.register(self.h1))
        public = integrity.load_public_values(self.layout)
        self.assertEqual(public, frozenset({self.h1.lower()}))
        ok = integrity.scan_secrets(line, public=public)
        self.assertEqual(ok.state, "ok", ok.detail)
        self.assertIn("1 proven-public value(s) cleared", ok.detail)
        bad = integrity.scan_secrets([("README.md", 4, f"the deployment tx {self.h2}")], public=public)
        self.assertEqual(bad.state, "fail")
        self.assertIn("hex-key at README.md:4", bad.detail)
        self.assertNotIn(self.h2[2:], bad.detail)
        # any letter case of the listed value (the registry is lower-cased); the unlisted one in capitals is a hit
        upper1, upper2 = "0x" + self.h1[2:].upper(), "0x" + self.h2[2:].upper()
        self.assertEqual(integrity.scan_secrets([("a", 1, upper1)]).state, "fail")
        self.assertEqual(integrity.scan_secrets([("a", 1, upper1)], public=public).state, "ok")
        self.assertEqual(integrity.scan_secrets([("a", 1, upper2)], public=public).state, "fail")
        # a listed value assigned to a secret keyword is no hit (the cleared span completes no pattern); unlisted is
        for keyword in ("password: ", "private key = "):
            with self.subTest(keyword=keyword):
                self.assertEqual(integrity.scan_secrets_text(keyword + self.h1, where="answer", public=public).state,
                                 "ok")
                self.assertEqual(integrity.scan_secrets_text(keyword + self.h2, where="answer", public=public).state,
                                 "fail")
        # a listed value never shields a real secret on the same line
        mixed = [("a", 1, f"{self.h1} {S.planted('key.private')}")]
        self.assertEqual(integrity.scan_secrets(mixed, public=public).state, "fail")
        # free text, line by line: the listed line is clean, the unlisted line is the hit
        scan = integrity.scan_secrets_text(f"first {self.h1}\nsecond {self.h2}\n", where="notion op", public=public)
        self.assertEqual(scan.state, "fail")
        self.assertIn("notion op:2", scan.detail)
        self.assertNotIn("notion op:1", scan.detail)
        # only a listed value shaped like a transaction hash clears text: a short or odd string never does
        odd = "not-a-hash-value"
        self.assertEqual(integrity.scan_secrets_text(f"password: {odd}", where="x",
                                                     public=frozenset({odd})).state, "fail")
        # the scan's positive control is still caught whatever the list holds
        scanner = functools.partial(integrity.scan_secrets, public=public)
        guarded = integrity.with_positive_control(scanner, (integrity.planted_secret_line(),), line)
        self.assertEqual((guarded.state, guarded.positive_control), ("ok", {"ran": True, "caught": True}))

    def test_explorer_link_values(self) -> None:
        cleared = [
            f"see https://testnet.bscscan.com/tx/{self.h2}",
            f"[the tx](https://etherscan.io/tx/{self.h2}) on testnet",
            f"https://explorer.example/txs/{self.h2}?tab=logs#top",
            f"https://explorer.example/api/transaction/{self.h2}/details",
        ]
        refused = [
            f"https://etherscan.io/address/{self.h2}",            # not a tx path
            f"https://explorer.example/search?q=/tx/{self.h2}",   # in the query, not the path
            f"https://explorer.example/#/tx/{self.h2}",           # in the fragment
            f"https://etherscan.io/tx/{self.h1} then {self.h2}",  # the second value sits outside the link
            f"{self.h2} next to https://etherscan.io/tx/abc",     # outside, the link on the same line
            f"ftp://explorer.example/tx/{self.h2}",               # not an http(s) URL
        ]
        self.assertEqual(integrity.scan_secrets([("README.md", 1, f"see {self.h2}")]).state, "fail")  # the control
        for text in cleared:
            with self.subTest(cleared=text):
                scan = integrity.scan_secrets([("README.md", 1, text)])
                self.assertEqual(scan.state, "ok", scan.detail)
                self.assertEqual(integrity.scan_secrets_text(text, where="notion").state, "ok")
        for text in refused:
            with self.subTest(refused=text):
                scan = integrity.scan_secrets([("README.md", 1, text)])
                self.assertEqual(scan.state, "fail")
                self.assertNotIn(self.h2[2:], scan.detail)
                self.assertEqual(integrity.scan_secrets_text(text, where="notion").state, "fail")
        # the link clears its own line only
        scan = integrity.scan_secrets_text(f"https://etherscan.io/tx/{self.h2}\n{self.h2}\n", where="answer")
        self.assertEqual(scan.state, "fail")
        self.assertIn("answer:2", scan.detail)
        self.assertEqual(integrity.cleared_spans(f"x https://e.example/tx/{self.h2}"), [(23, 23 + len(self.h2))])

    def test_register_refuses_without_proof(self) -> None:
        path = integrity.public_values_path(self.layout)
        refusals = [
            {"proven": "owner-attest"}, {"proven": "regex"}, {"kind": "address"},
            {"value": self.h1[2:]},                     # bare hex under evm-tx-hash
            {"value": self.h1, "kind": "tx-hash"},      # 0x under tx-hash
            {"value": self.h1[:-1]},                    # 63 hex digits
            {"value": "0x" + "g" * 64},
            {"chain": ""}, {"network": " "}, {"source": ""},
        ]
        for over in refusals:
            with self.subTest(over=sorted(over)):
                kw = dict(over)
                value = kw.pop("value", self.h1)
                with self.assertRaises(PolicyRefused) as cm:
                    self.register(value, **kw)
                self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_POLICY", 4))
                self.assertNotIn(self.h1[2:12], cm.exception.message)  # never the value
        self.assertFalse(path.exists())
        # without the state lock: a caller bug, nothing written
        with self.assertRaises(InternalError):
            integrity.register_public_value(self.layout, value=self.h1, kind="evm-tx-hash", chain="evm",
                                            network="testnet", proven="chain-reread", source="answers/T004-tx.md")
        self.assertFalse(path.exists())
        # positive controls: the same value with a chain proof is listed, and so is a bare hash of another chain
        self.assertTrue(self.register(self.h1, proven="tx-proof", source="local/proof-runs/T005/r/run.json"))
        bare = hashlib.sha256(b"bare-hash").hexdigest()
        self.assertTrue(self.register(bare, kind="tx-hash", chain="cardano", network="preprod"))
        self.assertEqual(integrity.load_public_values(self.layout), frozenset({self.h1, bare}))

    def test_idempotent_registration(self) -> None:
        self.assertTrue(self.register(self.h1))
        self.assertFalse(self.register(self.h1))
        self.assertFalse(self.register("0x" + self.h1[2:].upper()))  # any letter case is the same value
        self.assertFalse(self.register(self.h1, proven="tx-proof", source="local/proof-runs/T005/r/run.json"))
        lines = integrity.public_values_path(self.layout).read_bytes().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertTrue(self.register(self.h2))  # positive control: another value is appended
        self.assertEqual(len(integrity.public_values_path(self.layout).read_bytes().splitlines()), 2)

    def test_line_format(self) -> None:
        path = integrity.public_values_path(self.layout)
        self.assertEqual(integrity.load_public_values(self.layout), frozenset())  # absent file
        with S.patched_env(EXEC_TEST="1", EXEC_NOW=S.FIXED_NOW):
            self.assertTrue(self.register(self.h1))
        expected = {"value": self.h1, "kind": "evm-tx-hash", "chain": "evm", "network": "testnet",
                    "proven": "chain-reread", "source": "answers/T004-tx.md", "at_utc": S.FIXED_NOW, "executor": "A"}
        raw = path.read_bytes()
        self.assertEqual(raw, jsonio.canonical_bytes(expected) + b"\n")  # one canonical JSON line, LF, no BOM
        # a line without a value is skipped: whatever it meant stays secret-shaped (fail closed)
        with open(path, "ab") as fh:
            fh.write(b"{broken\n" + jsonio.canonical_bytes({"kind": "evm-tx-hash"}) + b"\n")
        self.assertEqual(integrity.load_public_values(self.layout), frozenset({self.h1}))
        # a command running under --now keeps its override mark after a registration (digests, events)
        with S.patched_env(EXEC_NOW=None):
            try:
                clock.utcnow(S.FIXED_NOW)
                self.assertTrue(self.register(self.h2))
                self.assertTrue(clock.is_overridden())
            finally:
                clock.utcnow()  # the process clock back to normal for the next tests
        self.assertEqual(len(path.read_bytes().splitlines()), 4)


class NeverShow(unittest.TestCase):
    def test_live_pattern_caught_by_id_and_location_never_text(self) -> None:
        live = S.planted("nevershow.live")
        entries = _ns_entries()
        scan = integrity.scan_never_show([("README.md", 7, f"we work with {live} soon")], entries)
        self.assertEqual(scan.state, "fail")
        self.assertIn("ns-embargo-live", scan.detail)
        self.assertIn("README.md:7", scan.detail)
        self.assertNotIn(live, scan.detail)
        self.assertNotIn(live.lower(), scan.detail.lower())
        msg = integrity.scan_never_show_messages([("c" * 40, f"feat: {live}")], entries)
        self.assertEqual(msg.state, "fail")
        self.assertIn("cccccccccccc", msg.detail)
        self.assertNotIn(live, msg.detail)
        self.assertEqual(integrity.scan_never_show([("README.md", 1, "plain text")], entries).state, "ok")


class ScopeProtectedTodo(unittest.TestCase):
    def test_writes_scope(self) -> None:
        self.assertEqual(integrity.scan_writes_scope(["README.md"], ["src/engine/**"]).state, "fail")
        self.assertEqual(integrity.scan_writes_scope(["src/engine/eta.mjs"], ["src/engine/**"]).state, "ok")

    def test_protected(self) -> None:
        paths = [".github/workflows/ci.yml"]
        self.assertEqual(integrity.scan_protected(paths, [".github/workflows/**"], False).state, "fail")
        self.assertEqual(integrity.scan_protected(paths, [".github/workflows/**"], True).state, "ok")
        self.assertEqual(integrity.scan_protected(["src/a.ts"], [".github/workflows/**"], False).state, "ok")

    def test_todo_judge_facing(self) -> None:
        todo = "TO" + "DO: finish this"
        self.assertEqual(integrity.scan_todo([("README.md", 2, todo)], ["README.md"]).state, "fail")
        self.assertEqual(integrity.scan_todo([("README.md", 2, todo + " <!--todo-ok-->")], ["README.md"]).state, "ok")
        self.assertEqual(integrity.scan_todo([("src/a.ts", 2, todo)], ["README.md"]).state, "ok")

    def test_push_freeze(self) -> None:
        self.assertEqual(integrity.scan_push_freeze("2026-10-08T00:00:00Z", "2026-10-07T15:59:00Z", False).state,
                         "fail")
        self.assertEqual(integrity.scan_push_freeze("2026-10-03T07:12:00Z", "2026-10-07T15:59:00Z", True).state,
                         "fail")
        self.assertEqual(integrity.scan_push_freeze("2026-10-03T07:12:00Z", "2026-10-07T15:59:00Z", False).state,
                         "ok")


class TestIntegrity(unittest.TestCase):
    def test_core_cases(self) -> None:
        only = integrity.test_integrity_core([("tests/a.test.js", 'it("x", () => {})\n', 'it.only("x", () => {})\n')])
        self.assertEqual(only.state, "fail")
        removed = integrity.test_integrity_core([("tests/test_a.py", "assert 1\nassert 2\n", "assert 1\n")])
        self.assertEqual(removed.state, "fail")
        config = integrity.test_integrity_core([("vitest.config.ts", None, None)])
        self.assertEqual(config.state, "fail")
        clean = integrity.test_integrity_core([("tests/test_a.py", "assert 1\n", "assert 1\nassert 2\n"),
                                               ("src/app.ts", "x", "y")])
        self.assertEqual(clean.state, "ok")

    def test_on_git_history(self) -> None:
        with S.TempRepo(files={"tests/eta.test.js": 'it("a", () => { expect(1).toBe(1); expect(2).toBe(2) })\n',
                               "vitest.config.ts": "export default {}\n"}) as repo:
            base = repo.head()
            repo.write("tests/eta.test.js", 'it.only("a", () => { expect(1).toBe(1) })\n')
            repo.write("vitest.config.ts", "export default { test: {} }\n")
            head = repo.commit_all("test: weaken")
            scan = integrity.scan_test_integrity(Git(repo.path), base, head)
            self.assertEqual(scan.state, "fail")
            for part in ("marker added", "assertions reduced", "test configuration changed"):
                self.assertIn(part, scan.detail)
            repo.write("tests/eta.test.js", 'it.only("a", () => { expect(1).toBe(1); expect(3).toBe(3) })\n')
            head2 = repo.commit_all("test: more")
            self.assertEqual(integrity.scan_test_integrity(Git(repo.path), head, head2).state, "ok")


class PositiveControl(unittest.TestCase):
    def test_caught_plant_records_control(self) -> None:
        scan = integrity.with_positive_control(integrity.scan_trailers, (integrity.planted_messages("trailer"),),
                                               [("a" * 40, "fix: clean")])
        self.assertEqual(scan.state, "ok")
        self.assertEqual(scan.positive_control, {"ran": True, "caught": True})

    def test_blind_scanner_fails_the_scan(self) -> None:
        def blind(*_a: object) -> integrity.Scan:
            return integrity.Scan("secrets", "ok", "always clean", None)

        def run() -> integrity.Scan:
            return integrity.with_positive_control(blind, (integrity.planted_secret_line(),), [])

        S.assert_controlled(
            self,
            negative=lambda: self.assertEqual((run().state, run().detail.startswith("blind scan")), ("fail", True)),
            positive=lambda: self.assertEqual(integrity.with_positive_control(
                integrity.scan_secrets, (integrity.planted_secret_line(),), []).state, "ok"))
        self.assertEqual(run().positive_control, {"ran": True, "caught": False})

    def test_every_planted_control_is_caught_by_its_scanner(self) -> None:
        lines, ents = integrity.planted_never_show([])
        todo, judge = integrity.planted_todo()
        cases = [
            (integrity.scan_trailers, (integrity.planted_messages("trailer"),)),
            (integrity.scan_conventional, (integrity.planted_messages("conventional"),)),
            (integrity.scan_secrets, (integrity.planted_secret_line(),)),
            (integrity.scan_never_show, (lines, ents)),
            (integrity.test_integrity_core, (integrity.planted_test_change(),)),
            (integrity.scan_todo, (todo, judge)),
        ]
        for scanner, planted in cases:
            with self.subTest(scanner=scanner.__name__):
                self.assertEqual(scanner(*planted).state, "fail")

    def test_no_planted_literal_in_this_module_source(self) -> None:
        src = Path(integrity.__file__).read_text(encoding="utf-8")
        for name in ("trailer.coauthor", "trailer.signoff"):
            self.assertNotIn(S.planted(name).split(":")[0], src)


if __name__ == "__main__":
    unittest.main()
