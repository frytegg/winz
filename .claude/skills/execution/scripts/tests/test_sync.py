"""`exec.py sync` (contract/CLI.md 1, TWO-DEV.md 2.2-2.4, TESTS.md 5.4, LANES.md B08).

Two state clones (A and B) of one bare remote: both append events and decisions, `sync` on both union-merges with
every line kept once; B writing an A-owned file (plan.json, status/A.json) stops with exit 1 E_STATE_CONFLICT and
nothing committed; two writers editing plan.json outside amend stop at the rebase with exit 1 E_STATE_CONFLICT, the
rebase aborted and the pending event line kept; an uncommitted in-place edit of an append-only file is refused with
E_STATE_CONFLICT before the rebase, while a pending multi-line decisions.md append survives `--pull-only` verbatim;
`sync` interleaved with another process appending events under the state lock neither fails nor
loses or tears a line; a planted key in a verifier finding's evidence is exit 4 E_SECRET_IN_STATE with nothing
committed and the file quarantined; a remote that is not confirmed private is exit 4 E_STATE_REMOTE_PUBLIC with
nothing pushed.

Proven-public values (README.md 8, owner decision 2026-10-02): a `0x` tx hash registered in public-values.jsonl
passes in a tracked answer while the same value unregistered is quarantined; a value in an explorer link passes while
the same value outside one is quarantined; any other secret shape stays a hit, on the registered value's line too;
two clones appending public-values.jsonl merge by union, and without the init's `.gitattributes` line the same appends
conflict; a scanner whose exemption clears everything is caught by the positive control.

The secret scan (execlib.integrity, lane B06) is not integrated: `_support_B08.fake_integrity` stands in through the
signatures of MODULES.md 4 (revision 3), and `PublicValuesB06` runs the public-value tests again on B06's real
module once it has those functions. The plan invariants (execlib.validate) are faked as well.

Run: python -m unittest discover -s scripts/tests -p "test_sync.py" -v
"""
from __future__ import annotations

import hashlib
import importlib
import inspect
import json
import re
import subprocess
import sys
import types
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from unittest import mock

import _support as S
from _support_B08 import PUBLIC_VALUES_FILE, fake_integrity
from execlib import errors, jsonio, locks, paths, syncstate
from execlib.log import get_logger
from execlib.model import Ctx

OLD_ATTRS = "* text=auto eol=lf\nevents.jsonl merge=union\ndecisions.md merge=union\n"  # before revision 3


def tx_hash(label: str) -> str:
    """A transaction-hash-shaped value (`0x` + 64 hex: a private key's shape), built at runtime."""
    return "0x" + hashlib.sha256(f"b08-sync-{label}".encode("utf-8")).hexdigest()


def answer_text(key: str, value: str | None, body: str) -> str:
    """answers/<key>.md as `answers ingest` writes it: the fenced json header, a blank line, the human text."""
    header = {"schema": "execution.answer/1", "key": key, "task": key.split("-")[0], "decision": None,
              "bring_back_key": key, "kind": "tx-hash", "source": "terminal", "received_utc": S.FIXED_NOW,
              "by": "devA", "value": value, "attachments": [],
              "verification": {"method": "chain-reread", "ok": True, "detail": "re-read on bnb/testnet",
                               "at_utc": S.FIXED_NOW, "command": "reader <value>", "exit_code": 0}}
    return "```json\n" + json.dumps(header, sort_keys=True, indent=2) + "\n```\n\n" + body


def b06_revision3_missing(mod: Any) -> list[str]:
    """What lane B06's real integrity module still lacks of the revision-3 signatures (empty when complete)."""
    missing = [name for name in ("load_public_values", "register_public_value", "with_positive_control")
               if not callable(getattr(mod, name, None))]
    try:
        if "public" not in inspect.signature(mod.scan_secrets).parameters:
            missing.append("scan_secrets(..., public=)")
    except (AttributeError, TypeError, ValueError):
        missing.append("scan_secrets")
    return missing


def fake_validate(errors_out: list | None = None) -> types.ModuleType:
    mod = types.ModuleType("execlib.validate")

    @dataclass(frozen=True)
    class VContext:
        profile: Any
        policy: Any
        statuses: Any
        now: Any
        skills_present: Any

    @dataclass(frozen=True)
    class VReport:
        errors: tuple
        warnings: tuple
        stats: dict

    mod.VContext = VContext  # type: ignore[attr-defined]
    mod.validate_plan = lambda raw, vctx: VReport(tuple(errors_out or ()), (), {})  # type: ignore[attr-defined]
    return mod


class SyncCase(unittest.TestCase):
    def integrity_module(self) -> types.ModuleType:
        """The execlib.integrity that sync imports in these tests (PublicValuesB06 returns lane B06's real one)."""
        return fake_integrity()

    def setUp(self) -> None:
        self.integrity = self.integrity_module()
        self.repo = S.TempRepo()
        self.remote = self.repo.root / "state.git"
        S.git(self.repo.root, "init", "--quiet", "--bare", "-b", "main", str(self.remote))
        code, env, _ = S.run_exec(["init", "--project", "queue-clock", "--executor", "A", "--state-remote",
                                   self.remote.as_posix()], cwd=self.repo.path)
        self.assertEqual(code, 0, env)
        self.b_repo = self.repo.clone("repo-b")
        code, env, _ = S.run_exec(["init", "--project", "queue-clock", "--executor", "B", "--state-remote",
                                   self.remote.as_posix()], cwd=self.b_repo)
        self.assertEqual(code, 0, env)
        self.A = paths.layout_for(self.repo.path, None)
        self.B = paths.layout_for(self.b_repo, None)
        self.patch = mock.patch.dict(sys.modules, {"execlib.integrity": self.integrity,
                                                   "execlib.validate": fake_validate()})
        self.patch.start()
        self.env_patch = S.patched_env(GIT_CONFIG_GLOBAL=str(S.git_config_global()), GIT_CONFIG_NOSYSTEM="1",
                                       GIT_TERMINAL_PROMPT="0", CLAUDE_CODE_SESSION_ID=S.SESSION_ID)
        self.env_patch.__enter__()

    def tearDown(self) -> None:
        self.env_patch.__exit__(None, None, None)
        self.patch.stop()
        self.repo.cleanup()

    def ctx(self, layout: paths.Layout, executor: str) -> Ctx:
        return Ctx(layout=layout, executor=executor, now=S.fixed_now(), by="orchestrator", pretty=False,
                   command="sync", log=get_logger("execlib.syncstate"))

    def sync(self, layout: paths.Layout, executor: str, **kw: bool) -> dict:
        return syncstate.sync(self.ctx(layout, executor), kw.get("pull_only", False), kw.get("push_only", False))

    def add_event(self, layout: paths.Layout, executor: str, n: int, marker: str) -> dict:
        ev = {"ts": f"2026-10-03T07:12:{n:02d}.000000Z", "actor": f"exec:status@{executor}", "type": "task.status",
              "data": {"task": "T001", "from": "planned", "to": "ready", "evidence": [marker]},
              "executor": executor, "seq": 1000 + n}
        jsonio.append_jsonl(layout.events, ev)
        return ev

    def add_decision(self, layout: paths.Layout, did: str) -> None:
        with open(layout.decisions, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(f"\n## {did}\n\nA decision block {did}.\n")

    def lines(self, layout: paths.Layout) -> list[str]:
        return [ln for ln in layout.events.read_text(encoding="utf-8").split("\n") if ln.strip()]

    def committed(self, layout: paths.Layout, rel: str) -> str:
        return S.git(layout.state, "show", f"HEAD:{rel}").stdout.decode("utf-8")

    def head(self, layout: paths.Layout) -> bytes:
        return S.git(layout.state, "rev-parse", "HEAD").stdout

    def register(self, layout: paths.Layout, value: str, source: str) -> None:
        """What `answers ingest` (chain re-read ok) or `proof run` (tx reader ok) does: integrity's registration,
        under the state lock its caller holds."""
        with locks.hold(layout, "state", command="test"):
            self.assertTrue(self.integrity.register_public_value(layout, value=value, kind="evm-tx-hash",
                                                                 chain="bnb", network="testnet",
                                                                 proven="chain-reread", source=source))

    def merge_attr(self, layout: paths.Layout) -> str:
        out = S.git(layout.state, "check-attr", "merge", "--", PUBLIC_VALUES_FILE).stdout.decode("utf-8")
        return out.strip().rsplit(": ", 1)[-1]


class Union(SyncCase):
    def test_two_clones_union_merge(self) -> None:
        ea = [self.add_event(self.A, "A", i, f"a{i}") for i in range(3)]
        eb = [self.add_event(self.B, "B", 10 + i, f"b{i}") for i in range(3)]
        self.add_decision(self.A, "D-001")
        self.add_decision(self.B, "D-500")
        da = self.sync(self.A, "A")
        self.assertTrue(da["pushed"])
        self.assertIsNotNone(da["committed"])
        db = self.sync(self.B, "B")
        self.assertTrue(db["pushed"], db)
        self.assertTrue(db["pulled"])
        self.sync(self.A, "A")
        for layout in (self.A, self.B):
            text = self.committed(layout, "events.jsonl") if layout is self.B else \
                layout.events.read_text(encoding="utf-8")
            for ev in ea + eb:
                marker = ev["data"]["evidence"][0]
                self.assertEqual(text.count(f'"evidence":["{marker}"]'), 1, (layout.state, marker))
            dec = layout.decisions.read_text(encoding="utf-8")
            self.assertEqual(dec.count("## D-001"), 1)
            self.assertEqual(dec.count("## D-500"), 1)
        msg = S.git(self.B.state, "log", "-1", "--format=%s", "HEAD").stdout.decode().strip()
        self.assertRegex(msg, r"^chore\(state\): B \d{8}T\d{6}Z ")
        self.assertIsNone(re.search("(?i)co-" + "authored", S.git(self.B.state, "log", "--format=%B").stdout.decode()))

    def test_other_executor_liveness(self) -> None:
        self.add_event(self.B, "B", 1, "b")
        self.sync(self.B, "B")
        data = self.sync(self.A, "A")
        self.assertEqual(data["other_executor_status_seq"], None)
        self.assertRegex(data["other_executor_last_commit_utc"] or "", r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_pull_only_commits_nothing(self) -> None:
        self.add_event(self.A, "A", 1, "a")
        before = S.git(self.A.state, "rev-parse", "HEAD").stdout
        data = self.sync(self.A, "A", pull_only=True)
        self.assertIsNone(data["committed"])
        self.assertFalse(data["pushed"])
        self.assertEqual(S.git(self.A.state, "rev-parse", "HEAD").stdout, before)

    def test_push_only(self) -> None:
        self.add_event(self.A, "A", 1, "a")
        data = self.sync(self.A, "A", push_only=True)
        self.assertTrue(data["pushed"])


class Conflicts(SyncCase):
    def test_wrong_executor_write_refused(self) -> None:
        S.write_json(self.A.plan, S.build_plan())
        self.sync(self.A, "A")
        self.sync(self.B, "B", pull_only=True)
        self.assertTrue(self.B.plan.exists())
        plan = json.loads(self.B.plan.read_text(encoding="utf-8"))
        plan["project"] = "queue-clock"
        plan["tasks"][0]["title"] = "edited by B outside amend"
        S.write_json(self.B.plan, plan)
        head = S.git(self.B.state, "rev-parse", "HEAD").stdout
        with self.assertRaises(errors.CheckFailed) as cm:
            self.sync(self.B, "B")
        self.assertEqual(cm.exception.code, "E_STATE_CONFLICT")
        self.assertEqual(cm.exception.exit_code, 1)
        self.assertEqual(S.git(self.B.state, "rev-parse", "HEAD").stdout, head)  # nothing committed
        S.write_json(self.B.status("A"), S.build_status("A"))
        with self.assertRaises(errors.CheckFailed):
            self.sync(self.B, "B")
        # positive control: B's own status file commits
        S.git(self.B.state, "checkout", "--", "plan.json")
        (self.B.status("A")).unlink()
        S.write_json(self.B.status("B"), S.build_status("B"))
        self.assertIsNotNone(self.sync(self.B, "B")["committed"])

    def test_both_edit_plan_rebase_aborted(self) -> None:
        """TESTS.md 5.4: both edit plan.json outside amend -> exit 1 E_STATE_CONFLICT with the rebase aborted. Two
        clones of executor A reach the rebase (B is refused before it commits, test_wrong_executor_write_refused)."""
        a2_repo = self.repo.clone("repo-a2")
        code, env, _ = S.run_exec(["init", "--project", "queue-clock", "--executor", "A", "--state-remote",
                                   self.remote.as_posix()], cwd=a2_repo)
        self.assertEqual(code, 0, env)
        A2 = paths.layout_for(a2_repo, None)
        S.write_json(self.A.plan, S.build_plan())
        self.assertTrue(self.sync(self.A, "A")["pushed"])
        self.assertTrue(self.sync(A2, "A", pull_only=True)["plan_changed"])
        p1 = json.loads(self.A.plan.read_text(encoding="utf-8"))
        p1["tasks"][0]["title"] = "edited in clone one"
        S.write_json(self.A.plan, p1)
        p2 = json.loads(A2.plan.read_text(encoding="utf-8"))
        p2["tasks"][0]["title"] = "edited in clone two"
        S.write_json(A2.plan, p2)
        self.add_event(A2, "A", 7, "pending-a2")
        # positive control: the first edit lands
        self.assertTrue(self.sync(self.A, "A")["pushed"])
        remote_head = S.git(self.remote, "rev-parse", "main").stdout
        with self.assertRaises(errors.CheckFailed) as cm:
            self.sync(A2, "A")
        self.assertEqual(cm.exception.code, "E_STATE_CONFLICT")
        self.assertEqual(cm.exception.exit_code, 1)
        self.assertEqual(cm.exception.data.get("conflict_files"), ["plan.json"])
        self.assertIsNotNone(cm.exception.data.get("committed"))  # raised by the rebase, after the own commit
        git_dir = A2.state / ".git"
        self.assertFalse((git_dir / "rebase-merge").exists())  # the rebase was aborted
        self.assertFalse((git_dir / "rebase-apply").exists())
        self.assertEqual(S.git(A2.state, "status", "--porcelain=v1").stdout.decode(), "")
        self.assertIn("pending-a2", A2.events.read_text(encoding="utf-8"))  # the pending event line is kept
        self.assertEqual(json.loads(A2.plan.read_text(encoding="utf-8"))["tasks"][0]["title"], "edited in clone two")
        self.assertEqual(S.git(self.remote, "rev-parse", "main").stdout, remote_head)  # nothing pushed

    def test_pull_only_keeps_pending_decision_block(self) -> None:
        """A pending multi-line append to decisions.md survives a --pull-only rebase verbatim (newlines kept)."""
        self.add_event(self.B, "B", 1, "b")
        self.assertTrue(self.sync(self.B, "B")["pushed"])
        self.add_decision(self.A, "D-002")
        self.add_decision(self.A, "D-003")
        data = self.sync(self.A, "A", pull_only=True)
        self.assertTrue(data["pulled"])
        self.assertIsNone(data["committed"])
        text = self.A.decisions.read_text(encoding="utf-8")
        self.assertIn("\n## D-002\n\nA decision block D-002.\n\n## D-003\n\nA decision block D-003.\n", text)
        self.assertTrue(text.endswith("A decision block D-003.\n"))
        self.assertEqual(text.count("## D-002"), 1)
        self.assertIn('"evidence":["b"]', self.A.events.read_text(encoding="utf-8"))  # the pull landed

    def test_pull_only_refuses_in_place_edit(self) -> None:
        """An uncommitted in-place edit of an append-only file is refused before the rebase, nothing touched."""
        self.add_decision(self.A, "D-001")
        self.assertTrue(self.sync(self.A, "A")["pushed"])
        self.add_event(self.B, "B", 1, "b")
        self.assertTrue(self.sync(self.B, "B")["pushed"])
        original = self.A.decisions.read_text(encoding="utf-8")
        edited = original.replace("A decision block D-001.", "A decision block D-001, rewritten in place.")
        self.assertNotEqual(edited, original)
        with open(self.A.decisions, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(edited)
        head = S.git(self.A.state, "rev-parse", "HEAD").stdout
        with self.assertRaises(errors.CheckFailed) as cm:
            self.sync(self.A, "A", pull_only=True)
        self.assertEqual(cm.exception.code, "E_STATE_CONFLICT")
        self.assertEqual(cm.exception.exit_code, 1)
        self.assertEqual(cm.exception.data.get("conflict_files"), ["decisions.md"])
        self.assertEqual(self.A.decisions.read_text(encoding="utf-8"), edited)  # nothing set aside or appended
        self.assertEqual(S.git(self.A.state, "rev-parse", "HEAD").stdout, head)  # no rebase happened
        self.assertFalse((self.A.state / ".git" / "rebase-merge").exists())
        # positive control: once the edit is undone, the same pull-only succeeds and pulls B's event
        S.git(self.A.state, "checkout", "--", "decisions.md")
        self.assertTrue(self.sync(self.A, "A", pull_only=True)["pulled"])
        self.assertIn('"evidence":["b"]', self.A.events.read_text(encoding="utf-8"))

    def test_plan_change_revalidated(self) -> None:
        S.write_json(self.A.plan, S.build_plan())
        self.sync(self.A, "A")
        data = self.sync(self.B, "B", pull_only=True)
        self.assertTrue(data["plan_changed"])
        self.assertEqual(data["plan_validation"]["invariants"], "ok")
        bad = S.build_plan()
        bad["tasks"][0]["title"] = "changed"
        S.write_json(self.A.plan, bad)
        self.sync(self.A, "A")
        item = errors.ErrorItem("E_DEP_ORDER", "planted invariant failure")
        with mock.patch.dict(sys.modules, {"execlib.validate": fake_validate([item])}):
            with self.assertRaises(errors.CheckFailed) as cm:
                self.sync(self.B, "B", pull_only=True)
        self.assertEqual(cm.exception.code, "E_PLAN_INVALID")


class Safety(SyncCase):
    def test_secret_in_finding_refused(self) -> None:
        S.write_json(self.A.plan, S.build_plan())
        self.sync(self.A, "A")
        receipt = S.build_receipt("T001")
        receipt["findings"] = [{"evidence": "the signer was " + S.planted("key.private")}]
        S.write_json(self.A.layout_receipt if hasattr(self.A, "layout_receipt") else self.A.receipt("T001"), receipt)
        head = S.git(self.A.state, "rev-parse", "HEAD").stdout
        with self.assertRaises(errors.PolicyRefused) as cm:
            self.sync(self.A, "A")
        self.assertEqual(cm.exception.code, "E_SECRET_IN_STATE")
        self.assertEqual(cm.exception.exit_code, 4)
        self.assertEqual(S.git(self.A.state, "rev-parse", "HEAD").stdout, head)
        self.assertFalse(self.A.receipt("T001").exists())
        self.assertTrue((self.A.local / "quarantine" / "proofs" / "T001.json").exists())
        self.assertNotIn(S.planted("key.private"), json.dumps(cm.exception.data))
        # positive control: a clean receipt commits
        S.write_json(self.A.receipt("T001"), S.build_receipt("T001"))
        self.assertIsNotNone(self.sync(self.A, "A")["committed"])

    def test_blind_scanner_refuses(self) -> None:
        mod = fake_integrity()

        def blind(added: Any, *, public: frozenset[str] = frozenset()) -> Any:
            return mod.Scan("secrets", "ok", "clean", None)

        mod.scan_secrets = blind  # type: ignore[attr-defined]
        self.add_event(self.A, "A", 1, "a")
        with mock.patch.dict(sys.modules, {"execlib.integrity": mod}):
            with self.assertRaises(errors.InternalError):
                self.sync(self.A, "A")

    def test_blind_exemption_refuses(self) -> None:
        """A scanner whose exemption clears every value once one is registered is blind: the positive control runs
        with the same `public` set, so sync stops before committing anything."""
        mod = fake_integrity()
        honest = mod.scan_secrets

        def clears_all(added: Any, *, public: frozenset[str] = frozenset()) -> Any:
            return mod.Scan("secrets", "ok", "clean", None) if public else honest(added)

        mod.scan_secrets = clears_all  # type: ignore[attr-defined]
        self.register(self.A, tx_hash("blind"), "answers ingest T001-tx")
        self.add_event(self.A, "A", 1, "a")
        head = self.head(self.A)
        with mock.patch.dict(sys.modules, {"execlib.integrity": mod}):
            with self.assertRaises(errors.InternalError) as cm:
                self.sync(self.A, "A")
        self.assertIn("blind", str(cm.exception))
        self.assertEqual(self.head(self.A), head)  # nothing committed
        # positive control: with nothing registered the same scanner is the honest one, and its control is caught
        with mock.patch.dict(sys.modules, {"execlib.integrity": mod}):
            hits, check = syncstate.secret_hits([("events.jsonl", 1, "x")])
        self.assertEqual((hits, check["positive_control"]), ([], {"ran": True, "caught": True}))
        # and the honest scanner commits the same change (registration included)
        data = self.sync(self.A, "A")
        self.assertEqual(sorted(data["committed_paths"]), ["events.jsonl", PUBLIC_VALUES_FILE])

    def test_public_remote_refused(self) -> None:
        self.add_event(self.A, "A", 1, "a")
        with mock.patch.object(syncstate, "remote_is_private", return_value=False):
            with self.assertRaises(errors.PolicyRefused) as cm:
                self.sync(self.A, "A")
        self.assertEqual(cm.exception.code, "E_STATE_REMOTE_PUBLIC")
        remote_head = S.git(self.repo.root, "ls-remote", self.remote.as_posix(), "refs/heads/main").stdout
        local = S.git(self.A.state, "rev-parse", "HEAD").stdout.strip()
        self.assertNotIn(local, remote_head)  # committed locally, nothing pushed
        with mock.patch.object(syncstate, "remote_is_private", return_value=True):
            self.assertTrue(self.sync(self.A, "A")["pushed"])

    def test_interleaved_appends(self) -> None:
        script = (
            "import sys, time\n"
            f"sys.path.insert(0, {str(S.SCRIPTS_DIR)!r})\n"
            "from pathlib import Path\n"
            "from execlib import jsonio, locks, paths\n"
            f"layout = paths.layout_for(Path({str(self.repo.path)!r}), None)\n"
            "for i in range(40):\n"
            "    with locks.hold(layout, 'state', command='test'):\n"
            "        jsonio.append_jsonl(layout.events, {'ts': '2026-10-03T07:13:00.000000Z', 'actor': 'exec:status@A',"
            " 'type': 'task.status', 'data': {'task': 'T001', 'from': 'planned', 'to': 'ready',"
            " 'evidence': ['bg%d' % i]}, 'executor': 'A', 'seq': 5000 + i})\n"
            "        jsonio.write_json_atomic(layout.state / 'proofs' / 'T001.json', {'n': i})\n"
            "    time.sleep(0.02)\n")
        proc = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        S.write_json(self.A.plan, S.build_plan())
        for _ in range(4):
            self.sync(self.A, "A")
        _out, err = proc.communicate(timeout=120)
        self.assertEqual(proc.returncode, 0, err)
        self.sync(self.A, "A")
        text = self.committed(self.A, "events.jsonl")
        for i in range(40):
            self.assertEqual(text.count(f'"evidence":["bg{i}"]'), 1, i)
        for line in text.split("\n"):
            if line.strip():
                json.loads(line)


class PublicValues(SyncCase):
    """README.md 8 (owner decision 2026-10-02): `sync` passes integrity.load_public_values(layout) to the scan as
    `public`. Every negative claim has its positive control in the same test."""

    def setUp(self) -> None:
        super().setUp()
        S.write_json(self.A.plan, S.build_plan())  # T001 is executor A's task: answers/T001-* are A's files
        self.assertIsNotNone(self.sync(self.A, "A")["committed"])

    def test_registered_hash_in_answer_passes_unregistered_is_quarantined(self) -> None:
        tx = tx_hash("registered")
        answer = self.A.answer("T001-tx")
        text = answer_text("T001-tx", tx, tx + "\n")
        # the value is not registered: a private key's shape, so the answer is quarantined and nothing committed
        S.write_text(answer, text)
        head = self.head(self.A)
        with self.assertRaises(errors.PolicyRefused) as cm:
            self.sync(self.A, "A")
        self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_SECRET_IN_STATE", 4))
        self.assertEqual(cm.exception.data["files"], ["answers/T001-tx.md"])
        self.assertNotIn(tx, json.dumps(cm.exception.data))
        self.assertEqual(self.head(self.A), head)
        self.assertFalse(answer.exists())
        self.assertEqual((self.A.local / "quarantine" / "answers" / "T001-tx.md").read_text(encoding="utf-8"), text)
        # registered after its chain proof, the same answer passes and is committed verbatim with the registration
        self.register(self.A, tx, "answers ingest T001-tx")
        self.assertEqual(self.integrity.load_public_values(self.A), frozenset({tx.lower()}))
        S.write_text(answer, text)
        data = self.sync(self.A, "A")
        self.assertTrue(data["pushed"])
        self.assertIn("answers/T001-tx.md", data["committed_paths"])
        self.assertIn(PUBLIC_VALUES_FILE, data["committed_paths"])
        self.assertEqual(self.committed(self.A, "answers/T001-tx.md"), text)
        self.assertIn(tx, self.committed(self.A, PUBLIC_VALUES_FILE))
        self.assertIn(tx, S.git(self.remote, "show", "main:answers/T001-tx.md").stdout.decode("utf-8"))
        # every other secret shape is still a hit, also on the registered value's own line
        key = S.planted("key.private")
        note = S.write_text(self.A.answer("T001-note"), f"tx {tx} signed by {key}\n")
        head = self.head(self.A)
        with self.assertRaises(errors.PolicyRefused) as cm2:
            self.sync(self.A, "A")
        self.assertEqual((cm2.exception.code, cm2.exception.data["files"]), ("E_SECRET_IN_STATE",
                                                                              ["answers/T001-note.md"]))
        self.assertNotIn(key, json.dumps(cm2.exception.data))
        self.assertFalse(note.exists())
        self.assertEqual(self.head(self.A), head)

    def test_explorer_link_value_passes_bare_value_is_quarantined(self) -> None:
        txs = [tx_hash(f"explorer-{i}") for i in range(3)]
        links = (f"Transaction: https://testnet.bscscan.com/tx/{txs[0]}\n"
                 f"Same, other explorer: https://explorer.example.invalid/txs/{txs[1]}?tab=logs\n"
                 f"Hedera: https://hashscan.io/testnet/transaction/{txs[2]}\n")
        good = S.write_text(self.A.answer("T001-links"), links)
        # positive controls first, in the same scans as the link file: the same unregistered value outside an
        # explorer link, after a path that is not a transaction's, or beside another value's link, is a hit; the
        # link file is never one
        controls = (f"Transaction: {txs[0]}\n", f"Account: https://testnet.bscscan.com/address/{txs[0]}\n",
                    f"https://testnet.bscscan.com/tx/{txs[2]} and {txs[1]}\n")
        for i, line in enumerate(controls):
            with self.subTest(control=i):
                bad = S.write_text(self.A.answer(f"T001-bare{i}"), line)
                with self.assertRaises(errors.PolicyRefused) as cm:
                    self.sync(self.A, "A")
                self.assertEqual(cm.exception.code, "E_SECRET_IN_STATE")
                self.assertEqual(cm.exception.data["files"], [f"answers/T001-bare{i}.md"])
                self.assertFalse(bad.exists())
                self.assertTrue(good.exists())
        data = self.sync(self.A, "A")
        self.assertTrue(data["pushed"])
        self.assertEqual(self.committed(self.A, "answers/T001-links.md"), links)
        self.assertEqual(self.integrity.load_public_values(self.A), frozenset())  # nothing was registered

    def test_two_clones_append_public_values_without_conflict(self) -> None:
        for layout in (self.A, self.B):
            self.assertEqual(self.merge_attr(layout), "union")  # written by init (assets/state-repo/gitattributes)
        tx = [tx_hash(f"union-{i}") for i in range(4)]
        # round 1: the file is on neither HEAD, so both clones add it
        self.register(self.A, tx[0], "answers ingest T001-tx")
        self.register(self.B, tx[1], "proof run T002")
        self.assertTrue(self.sync(self.A, "A")["pushed"])
        db = self.sync(self.B, "B")
        self.assertTrue(db["pushed"], db)
        self.assertTrue(db["pulled"])
        self.sync(self.A, "A", pull_only=True)
        # round 2: both append to the tracked file; B pulls first with its registration still pending
        self.register(self.A, tx[2], "proof run T003")
        self.register(self.B, tx[3], "answers ingest T004-tx")
        self.assertTrue(self.sync(self.A, "A")["pushed"])
        pending = self.sync(self.B, "B", pull_only=True)
        self.assertTrue(pending["pulled"])
        self.assertIsNone(pending["committed"])
        self.assertIn(tx[2], self.committed(self.B, PUBLIC_VALUES_FILE))
        self.assertNotIn(tx[3], self.committed(self.B, PUBLIC_VALUES_FILE))
        self.assertIn(tx[3], (self.B.state / PUBLIC_VALUES_FILE).read_text(encoding="utf-8"))  # set aside, restored
        self.assertTrue(self.sync(self.B, "B")["pushed"])
        self.sync(self.A, "A", pull_only=True)
        for layout in (self.A, self.B):
            with self.subTest(state=layout.state.parent.name):
                text = (layout.state / PUBLIC_VALUES_FILE).read_text(encoding="utf-8")
                self.assertEqual(text, self.committed(layout, PUBLIC_VALUES_FILE))
                lines = [json.loads(ln) for ln in text.split("\n") if ln.strip()]
                self.assertEqual(sorted(d["value"] for d in lines), sorted(tx))  # each line once
                self.assertEqual(self.integrity.load_public_values(layout), frozenset(tx))
                self.assertEqual(S.git(layout.state, "status", "--porcelain", "--", PUBLIC_VALUES_FILE).stdout, b"")


class UnionLineControl(SyncCase):
    """Negative control of the union test: without `public-values.jsonl merge=union` in the state repo's
    .gitattributes (the file before contract revision 3), the same two appends conflict."""

    def test_without_the_union_line_the_appends_conflict(self) -> None:
        S.write_text(self.A.state / ".gitattributes", OLD_ATTRS)
        self.assertTrue(self.sync(self.A, "A")["pushed"])
        self.sync(self.B, "B", pull_only=True)
        for layout in (self.A, self.B):
            self.assertEqual(self.merge_attr(layout), "unspecified")
        tx = [tx_hash(f"control-{i}") for i in range(2)]
        self.register(self.A, tx[0], "answers ingest T001-tx")
        self.register(self.B, tx[1], "proof run T002")
        self.assertTrue(self.sync(self.A, "A")["pushed"])
        remote_head = S.git(self.remote, "rev-parse", "main").stdout
        with self.assertRaises(errors.CheckFailed) as cm:
            self.sync(self.B, "B")
        self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_STATE_CONFLICT", 1))
        self.assertEqual(cm.exception.data["conflict_files"], [PUBLIC_VALUES_FILE])
        self.assertFalse((self.B.state / ".git" / "rebase-merge").exists())  # aborted
        self.assertEqual(S.git(self.remote, "rev-parse", "main").stdout, remote_head)  # nothing pushed


class PublicValuesB06(PublicValues):
    """The PublicValues tests on lane B06's real execlib.integrity (contract revision 3). Lane B06 is not
    integrated: skipped, naming what is missing, while its module lacks the revision-3 functions."""

    def integrity_module(self) -> types.ModuleType:
        try:
            mod = importlib.import_module("execlib.integrity")
        except ImportError as err:
            self.skipTest(f"lane B06's execlib.integrity cannot be imported: {err}")
        missing = b06_revision3_missing(mod)
        if missing:
            self.skipTest("lane B06's execlib.integrity lacks " + ", ".join(missing) + " (contract revision 3)")
        return mod


class Cli(unittest.TestCase):
    def test_pull_only_envelope(self) -> None:
        with S.TempRepo() as repo:
            S.run_exec(["init", "--project", "queue-clock", "--executor", "A"], cwd=repo.path)
            code, env, _ = S.run_exec(["sync", "--pull-only"], cwd=repo.path)
            self.assertEqual(code, 0, env)
            self.assertIsNone(env["data"]["committed"])
            code2, env2, _ = S.run_exec(["sync", "--pull-only", "--push-only"], cwd=repo.path)
            self.assertEqual(code2, 2)


if __name__ == "__main__":
    unittest.main()
