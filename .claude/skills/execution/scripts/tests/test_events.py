"""events.jsonl (contract/MODULES.md 3 events, SCHEMAS.md 8; LANES.md B01).

Protects: append without the state lock raises (positive control: with it, the line is written); appended events are
validated (E_EVENT_INVALID) and carry a per-executor sequence from local/state.json; readers order by (ts, executor,
seq) whatever the order on disk; two clones appending then pulling merge without conflict through merge=union;
duplicates by id are dropped; invalid lines are reported and skipped.

Run: python -m unittest discover -s scripts/tests -p "test_events.py" -v
"""
from __future__ import annotations

import json
import logging
import unittest
from datetime import timedelta
from pathlib import Path

import _support as S
from execlib import events, jsonio, locks, paths
from execlib.errors import InternalError, ValidationFailed
from execlib.model import Ctx

ATTRS = "* text=auto eol=lf\nevents.jsonl merge=union\ndecisions.md merge=union\n"


def make_ctx(state: Path, executor: str = "A", minutes: int = 0, command: str = "status",
             by: str = "orchestrator") -> Ctx:
    return Ctx(layout=paths.layout_for(None, state), executor=executor,
               now=S.fixed_now() + timedelta(minutes=minutes), by=by, pretty=False, command=command,
               log=logging.getLogger("tests"))


class Append(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()
        self.state = self.root / ".execution"
        self.layout = paths.layout_for(None, self.state)
        jsonio.write_json_atomic(self.layout.local_state, S.build_local_state())

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def test_requires_state_lock(self) -> None:
        ctx = make_ctx(self.state)

        def negative() -> None:
            before = self.layout.events.read_bytes()
            with self.assertRaises(InternalError):
                events.append(ctx, "governor", {})
            self.assertEqual(self.layout.events.read_bytes(), before, "nothing appended without the lock")

        def positive() -> None:
            with locks.hold(self.layout, "state", command="t"):
                ev = events.append(ctx, "governor", {"pause": False})
            assert ev["seq"] == 1 and self.layout.events.exists()

        S.assert_controlled(self, negative, positive)

    def test_fields_seq_and_validation(self) -> None:
        with locks.hold(self.layout, "state", command="t"):
            a = events.append(make_ctx(self.state), "task.status",
                              {"task": "T001", "from": "ready", "to": "running", "evidence": ["launch-intent:W01"]})
            b = events.append(make_ctx(self.state, by="verifier", command="proof verdict"), "proof.verdict",
                              {"task": "T001"})
            with self.assertRaises(ValidationFailed) as cm:
                events.append(make_ctx(self.state), "task.status", {"task": "T001"})
            self.assertEqual(cm.exception.code, "E_EVENT_INVALID")
            with self.assertRaises(ValidationFailed):
                events.append(make_ctx(self.state), "not.a.type", {})
        self.assertEqual((a["seq"], b["seq"]), (1, 2))
        self.assertEqual(a["actor"], "exec:status@A")
        self.assertEqual(b["actor"], "agent:verifier@A")
        self.assertEqual(a["executor"], "A")
        self.assertEqual(jsonio.read_json(self.layout.local_state)["events_seq"], 2)
        lines = self.layout.events.read_bytes().split(b"\n")
        self.assertEqual(lines[-1], b"")
        self.assertEqual(json.loads(lines[0]), a)
        self.assertEqual(lines[0], jsonio.canonical_bytes(a), "canonical JSON lines")

    def test_session_and_clock_override(self) -> None:
        from execlib import clock
        clock.utcnow("2026-10-03T07:12:00Z")
        with S.patched_env(CLAUDE_CODE_SESSION_ID="sess-x"), locks.hold(self.layout, "state", command="t"):
            ev = events.append(make_ctx(self.state), "due", {})
        self.assertEqual((ev["session_id"], ev["data"]["clock"]), ("sess-x", "override"))
        with self.assertRaises(InternalError):
            with locks.hold(self.layout, "state", command="t"):
                events.append(make_ctx(self.state, executor=None), "due", {})  # type: ignore[arg-type]

    def test_ordering_dedup_and_invalid_lines(self) -> None:
        later = {"ts": "2026-10-03T08:00:00Z", "actor": "exec:status@B", "type": "due", "data": {}, "executor": "B",
                 "seq": 1}
        early_b = {"ts": "2026-10-03T07:00:00.500000Z", "actor": "exec:status@B", "type": "due", "data": {},
                   "executor": "B", "seq": 2}
        early_a = {"ts": "2026-10-03T07:00:00.500000Z", "actor": "exec:status@A", "type": "due", "data": {},
                   "executor": "A", "seq": 9}
        whole = {"ts": "2026-10-03T07:00:00Z", "actor": "exec:status@A", "type": "due", "data": {}, "executor": "A",
                 "seq": 10}
        hook = {"ts": "2026-10-03T07:30:00Z", "actor": "hook:stop-gate@A", "type": "stop.allow", "data": {},
                "executor": "A", "seq": 11, "id": "0123456789abcdef"}
        for doc in (later, early_b, hook, early_a, whole, hook):
            jsonio.append_jsonl(self.layout.events, doc)
        with open(self.layout.events, "ab") as fh:
            fh.write(b"not json\n")
            fh.write(json.dumps({"ts": "x", "actor": "?", "type": "due", "data": {}}).encode() + b"\n")
        evs, errs = events.read_all(self.layout)
        self.assertEqual([(e["ts"], e["executor"], e["seq"]) for e in evs],
                         [("2026-10-03T07:00:00Z", "A", 10), ("2026-10-03T07:00:00.500000Z", "A", 9),
                          ("2026-10-03T07:00:00.500000Z", "B", 2), ("2026-10-03T07:30:00Z", "A", 11),
                          ("2026-10-03T08:00:00Z", "B", 1)])
        self.assertEqual(sorted(e.code for e in errs), ["E_EVENT_INVALID", "E_JSONL_LINE"])
        since, _ = events.read_all(self.layout, since=S.fixed_now() + timedelta(minutes=10))
        self.assertEqual([e["seq"] for e in since], [11, 1])


class UnionMerge(unittest.TestCase):
    def test_two_clones_union_merge(self) -> None:
        with S.TempRepo(files={".gitattributes": ATTRS, ".gitignore": "local/\n", "events.jsonl": ""}) as repo:
            a_dir = repo.path
            b_dir = repo.clone("clone-b")
            for d, ex in ((a_dir, "A"), (b_dir, "B")):
                jsonio.write_json_atomic(paths.layout_for(None, d).local_state, S.build_local_state(ex))
            for minutes, (d, ex) in enumerate(((a_dir, "A"), (b_dir, "B"), (a_dir, "A"), (b_dir, "B"))):
                ctx = make_ctx(d, ex, minutes=minutes)
                with locks.hold(ctx.layout, "state", command="t"):
                    events.append(ctx, "due", {"n": minutes})
            env = repo.date_env()
            for d, ex in ((a_dir, "A"), (b_dir, "B")):
                S.git(d, "add", "events.jsonl", env=env)
                S.git(d, "commit", "-q", "-m", f"chore(state): {ex} events", env=env)
            S.git(a_dir, "push", "-q", "origin", "main", env=env)
            pulled = S.git(b_dir, "pull", "--no-rebase", "--no-edit", "-q", "origin", "main", env=env, check=False)
            self.assertEqual(pulled.returncode, 0, pulled.stderr.decode("utf-8", "replace"))
            self.assertEqual(S.git(b_dir, "diff", "--name-only", "--diff-filter=U", env=env).stdout, b"")
            evs, errs = events.read_all(paths.layout_for(None, b_dir))
            self.assertEqual(errs, [])
            self.assertEqual([(e["executor"], e["data"]["n"]) for e in evs], [("A", 0), ("B", 1), ("A", 2), ("B", 3)])
            text = (b_dir / "events.jsonl").read_text(encoding="utf-8")
            self.assertNotIn("<<<<<<<", text)


if __name__ == "__main__":
    unittest.main()
