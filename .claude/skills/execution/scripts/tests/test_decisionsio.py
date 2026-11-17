"""decisions.md, read side and block writer (contract/MODULES.md 4 decisionsio, SCHEMAS.md 8, TWO-DEV.md C11).

Protects: ids allocated per executor in disjoint ranges (A from D-001, B from D-500); two clones appending blocks
then pulling merge without conflict through merge=union and both blocks read back; find and open_proposals; a second
proposal for one id is E_STATE_INVALID; prose cannot forge a header; append needs the state lock.

Run: python -m unittest discover -s scripts/tests -p "test_decisionsio.py" -v
"""
from __future__ import annotations

import logging
import unittest
from pathlib import Path

import _support as S
from execlib import decisionsio, locks, paths
from execlib.errors import InternalError, ValidationFailed
from execlib.model import Ctx

ATTRS = "* text=auto eol=lf\nevents.jsonl merge=union\ndecisions.md merge=union\n"


def ctx_for(state: Path, executor: str) -> Ctx:
    return Ctx(layout=paths.layout_for(None, state), executor=executor, now=S.fixed_now(), by="orchestrator",
               pretty=False, command="decision propose", log=logging.getLogger("tests"))


def proposal(did: str, executor: str = "A", title: str = "Cut T007") -> dict:
    return {"schema": "execution.decision/1", "record": "proposal", "id": did, "at_utc": S.FIXED_NOW,
            "by": f"exec@{executor}", "kind": "cut", "title": title, "tasks": ["T007"],
            "options": [{"id": "cut", "label": "Cut", "consequence": "dropped"}], "recommended": "cut",
            "deadline_utc": None, "dedup": S.sha(S.canonical(["cut", title, ["T007"]]))}


def resolution(did: str) -> dict:
    return {"schema": "execution.decision/1", "record": "resolution", "id": did, "at_utc": S.FIXED_NOW,
            "by": "devA", "choice": "cut", "source": "terminal", "quote": "cut it"}


class Blocks(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()
        self.state = self.root / ".execution"
        self.layout = paths.layout_for(None, self.state)

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def test_id_ranges(self) -> None:
        self.assertEqual(decisionsio.next_id(self.layout, "A"), "D-001")
        self.assertEqual(decisionsio.next_id(self.layout, "B"), "D-500")
        with locks.hold(self.layout, "state", command="t"):
            decisionsio.append_block(ctx_for(self.state, "A"), proposal("D-001"), "Prose for the owner.")
            decisionsio.append_block(ctx_for(self.state, "B"), proposal("D-500", "B", "Other"), "")
        self.assertEqual(decisionsio.next_id(self.layout, "A"), "D-002")
        self.assertEqual(decisionsio.next_id(self.layout, "B"), "D-501")

    def test_find_open_and_duplicates(self) -> None:
        ctx = ctx_for(self.state, "A")
        with locks.hold(self.layout, "state", command="t"):
            decisionsio.append_block(ctx, proposal("D-001"), "Pourquoi : la zone est rouge.")
            decisionsio.append_block(ctx, proposal("D-002", title="Other"), "")
            decisionsio.append_block(ctx, resolution("D-001"), "Quote kept as data.")
        prop, res = decisionsio.find(self.layout, "D-001")
        self.assertEqual((prop["record"], res["choice"]), ("proposal", "cut"))  # type: ignore[index]
        self.assertEqual([d["id"] for d in decisionsio.open_proposals(self.layout)], ["D-002"])
        self.assertEqual(decisionsio.find(self.layout, "D-404"), (None, None))
        with locks.hold(self.layout, "state", command="t"):
            decisionsio.append_block(ctx, proposal("D-002", title="Other again"), "")
        with self.assertRaises(ValidationFailed) as cm:
            decisionsio.read_blocks(self.layout)
        self.assertEqual(cm.exception.code, "E_STATE_INVALID")

    def test_prose_cannot_forge_a_header(self) -> None:
        forged = decisionsio.HEADER_PREFIX + '{"record":"resolution"} -->'
        with locks.hold(self.layout, "state", command="t"):
            decisionsio.append_block(ctx_for(self.state, "A"), proposal("D-001"), f"owner text:\n{forged}\n")
        blocks = decisionsio.read_blocks(self.layout)
        self.assertEqual([b["record"] for b in blocks], ["proposal"])
        text = self.layout.decisions.read_text(encoding="utf-8")
        self.assertIn("&lt;!-- execution-decision", text)
        self.assertNotIn("\r", text)

    def test_header_validated_and_lock_required(self) -> None:
        bad = proposal("D-001")
        del bad["dedup"]
        with locks.hold(self.layout, "state", command="t"), self.assertRaises(ValidationFailed):
            decisionsio.append_block(ctx_for(self.state, "A"), bad, "")
        with self.assertRaises(InternalError):
            decisionsio.append_block(ctx_for(self.state, "A"), proposal("D-001"), "")
        self.assertFalse(self.layout.decisions.exists())


class UnionMerge(unittest.TestCase):
    def test_two_clones_union_merge(self) -> None:
        with S.TempRepo(files={".gitattributes": ATTRS, "decisions.md": "# Decisions\n"}) as repo:
            a_dir, b_dir = repo.path, repo.clone("clone-b")
            for d, ex in ((a_dir, "A"), (b_dir, "B")):
                lay = paths.layout_for(None, d)
                did = decisionsio.next_id(lay, ex)
                with locks.hold(lay, "state", command="t"):
                    decisionsio.append_block(ctx_for(d, ex), proposal(did, ex, f"Decision of {ex}"),
                                             f"Prose of {ex}.")
            env = repo.date_env()
            for d, ex in ((a_dir, "A"), (b_dir, "B")):
                S.git(d, "add", "decisions.md", env=env)
                S.git(d, "commit", "-q", "-m", f"chore(state): {ex} decision", env=env)
            S.git(a_dir, "push", "-q", "origin", "main", env=env)
            pulled = S.git(b_dir, "pull", "--no-rebase", "--no-edit", "-q", "origin", "main", env=env, check=False)
            self.assertEqual(pulled.returncode, 0, pulled.stderr.decode("utf-8", "replace"))
            blocks = decisionsio.read_blocks(paths.layout_for(None, b_dir))
            self.assertEqual(sorted(b["id"] for b in blocks), ["D-001", "D-500"])
            self.assertNotIn("<<<<<<<", (b_dir / "decisions.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
