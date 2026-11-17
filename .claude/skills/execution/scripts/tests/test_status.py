"""The task status transition table and the done check (contract/SCHEMAS.md 4.2-4.4, TESTS.md 3.6, LANES.md B04).

Table-driven over SCHEMAS.md 4.2: for each row (a) with its evidence the named command performs the transition,
appends one history entry and one `task.status` event; (b) the same call without the evidence is refused (exit 4
E_TRANSITION_REFUSED) and the status file keeps every byte; (c) a command the row does not name is refused. Then the
specific rows of TESTS.md 3.6, `task set-status` (never built, verifying or done), the terminal states, and the seven
conditions of the done check, each removed alone, in the local and the cross-executor profile.

Run: python -m unittest discover -s scripts/tests -p "test_status.py" -v
"""
from __future__ import annotations

import json
import re
import shutil
import unittest
from argparse import Namespace
from typing import Any, Callable

import _support as S
from _support_B04 import World

from execlib import decisionsio, events, jsonio, plan as planmod, reconcile, status, statusio
from execlib.errors import ExecError, InternalError, TransitionRefused
from execlib.model import TaskState


def add_decision(world: World, header: dict) -> None:
    base = {"schema": "execution.decision/1", "at_utc": S.FIXED_NOW, "by": "exec@A"}
    base.update(header)
    if base["record"] == "proposal":
        base.setdefault("deadline_utc", None)
        base.setdefault("dedup", jsonio.sha256_json([base["kind"], base["title"], sorted(base.get("tasks", []))]))
    if base["record"] == "resolution":
        base["by"] = header.get("by", "devA")
        base.setdefault("source", "terminal")
        base.setdefault("quote", "ok")
    with world.locked():
        decisionsio.append_block(world.ctx("decision propose"), base, "test")


OPTS_UNBLOCK = [{"id": "go", "label": "Go", "consequence": "c", "effects": [{"op": "unblock-tasks"}]},
                {"id": "no", "label": "No", "consequence": "c", "effects": [{"op": "none"}]}]
OPTS_CUT = [{"id": "cut", "label": "Cut", "consequence": "c", "effects": [{"op": "cut-tasks"}]},
            {"id": "keep", "label": "Keep", "consequence": "c", "effects": [{"op": "restore-tasks"}]}]


def proposal(world: World, did: str, kind: str, tasks: list[str], options: list[dict] | None = None) -> None:
    add_decision(world, {"record": "proposal", "id": did, "kind": kind, "title": f"{kind} {did}", "tasks": tasks,
                         "options": options or OPTS_UNBLOCK})


def resolution(world: World, did: str, choice: str) -> None:
    add_decision(world, {"record": "resolution", "id": did, "choice": choice})


def attempt(world: World, tid: str, to: str, command: str, evidence: list[str]) -> dict:
    """Transition and save, as the commands do; returns the new entry (raises on refusal, nothing saved)."""
    ctx = world.ctx(command)
    with world.locked():
        doc = statusio.load(world.layout, "A")
        entry = status.transition(ctx, doc, world.task(tid), to, evidence=evidence,
                                  git=status.product_git(world.layout))
        statusio.save(ctx, doc)
    return entry


# Each row: (name, task, from-status-setup, to, command, wrong command, with-evidence setup -> evidence,
#            without-evidence setup -> evidence)
Setup = Callable[[World], list[str]]


def _deps_done(w: World) -> list[str]:
    w.set_status("T001", "done")
    return []


def _deps_open(w: World) -> list[str]:
    w.set_status("T001", "running")
    return []


def _approval_tasks() -> list[dict]:
    return [S.build_task("T001", kind="decision", template="execution:EX-APPROVE")]


def _approval_ok(w: World) -> list[str]:
    proposal(w, "D-001", "approval", ["T001"])
    return ["decision:D-001"]


def _approval_none(w: World) -> list[str]:
    return ["decision:D-001"]


def _launch_ok(w: World) -> list[str]:
    w.manifest("W01", [{"task": "T001"}])
    return ["launch-intent:W01"]


def _launch_none(w: World) -> list[str]:
    return ["launch-intent:W01"]


def _inwave_ok(w: World) -> list[str]:
    w.set_status("T001", "running")
    w.manifest("W01", [{"task": "T001"}, {"task": "T002", "deps_in_wave": ["T001"]}])
    return ["launch-intent:W01"]


def _inwave_none(w: World) -> list[str]:
    w.set_status("T001", "running")
    w.manifest("W01", [{"task": "T002", "deps_in_wave": []}])
    return ["launch-intent:W01"]


def _posted_ok(w: World) -> list[str]:
    w.set_status("T003", "ready", posted={"at_utc": S.FIXED_NOW, "push_text": "T003 · À faire", "reposts": 0})
    return ["posted:x"]


def _posted_none(w: World) -> list[str]:
    return ["posted:x"]


def _rerun_ok(w: World) -> list[str]:
    return ["rerun:W01"]


def _rerun_landed(w: World) -> list[str]:
    w.merge_receipt("T001", w.land())
    return ["rerun:W01"]


def _skipped_ok(w: World) -> list[str]:
    w.set_status("T001", "failed")
    w.manifest("W01", [{"task": "T001"}, {"task": "T002", "deps_in_wave": ["T001"]}], status="launched")
    return ["skipped-dep:W01"]


def _skipped_none(w: World) -> list[str]:
    w.set_status("T001", "done")
    w.manifest("W01", [{"task": "T001"}, {"task": "T002", "deps_in_wave": ["T001"]}], status="launched")
    return ["skipped-dep:W01"]


def _landed_ok(w: World) -> list[str]:
    w.merge_receipt("T001", w.land(), wave="W01")  # an earlier wave's receipt, no implementer result
    return []


def _landed_off_main(w: World) -> list[str]:
    w.merge_receipt("T001", w.local_commit(), wave="W01")
    return []


def _failed_ok(w: World) -> list[str]:
    p = w.impl_result("T001", status="failed")
    return [w.layout.rel(p)]


def _failed_none(w: World) -> list[str]:
    p = w.impl_result("T001", status="built")
    return [w.layout.rel(p)]


def _bmanual_ok(w: World) -> list[str]:
    p = w.impl_result("T001", status="blocked", blocked={"kind": "manual", "reason": "needs a key", "needed": "key"})
    proposal(w, "D-001", "spec-gap", ["T001"])
    return [w.layout.rel(p), "decision:D-001"]


def _bmanual_none(w: World) -> list[str]:
    p = w.impl_result("T001", status="blocked", blocked={"kind": "manual", "reason": "needs a key", "needed": "key"})
    return [w.layout.rel(p), "decision:D-001"]


def _bdecision_ok(w: World) -> list[str]:
    proposal(w, "D-001", "dependency-missing", ["T001"])
    return ["infra-error:W01", "decision:D-001"]


def _bdecision_none(w: World) -> list[str]:
    return ["infra-error:W01", "decision:D-001"]


def _verifying_ok(w: World) -> list[str]:
    sha = w.land()
    w.set_status("T001", "built", landed_sha=sha)
    w.proof_run("T001", sha)
    return []


def _verifying_none(w: World) -> list[str]:
    w.set_status("T001", "built", landed_sha=w.land())
    return []


def _done_ok(w: World) -> list[str]:
    fx = w.done_fixture("T001")
    w.set_status("T001", "verifying", landed_sha=fx["sha"])
    return []


def _done_none(w: World) -> list[str]:
    w.set_status("T001", "verifying", landed_sha=w.land())
    return []


def _vfail_ok(w: World) -> list[str]:
    fx = w.done_fixture("T001")
    w.receipt("T001", fx["sha"], fx["run"], verdict="fail", on_origin_main=True)
    w.set_status("T001", "verifying", landed_sha=fx["sha"])
    return []


def _vfail_none(w: World) -> list[str]:
    fx = w.done_fixture("T001")
    w.set_status("T001", "verifying", landed_sha=fx["sha"])
    return []


def _retry_ok(w: World) -> list[str]:
    w.set_status("T001", "failed", attempts=1)
    return []


def _retry_none(w: World) -> list[str]:
    w.set_status("T001", "failed", attempts=2)
    return []


def _fix_ok(w: World) -> list[str]:
    w.set_status("T001", "failed", attempts=1)
    w.manifest("W02", [{"task": "T001", "fix_attempts": [2]}], status="launched")
    w.impl_result("T001", wave="W02", attempt=2)
    return ["fix-attempt:W02"]


def _fix_none(w: World) -> list[str]:
    w.set_status("T001", "failed", attempts=1)
    w.manifest("W02", [{"task": "T001", "fix_attempts": [2]}], status="launched")
    return ["fix-attempt:W02"]


def _exhausted_ok(w: World) -> list[str]:
    w.set_status("T001", "failed", attempts=2)
    proposal(w, "D-001", "retry-exhausted", ["T001"])
    return ["decision:D-001"]


def _exhausted_none(w: World) -> list[str]:
    w.set_status("T001", "failed", attempts=1)
    proposal(w, "D-001", "retry-exhausted", ["T001"])
    return ["decision:D-001"]


def _manual_done_ok(w: World) -> list[str]:
    w.answer("T003-done", "T003", ok=True)
    return []


def _manual_done_none(w: World) -> list[str]:
    w.answer("T003-done", "T003", ok=False)
    return []


def _manual_rejected_ok(w: World) -> list[str]:
    return [w.layout.rel(w.answer("T003-done", "T003", ok=False))]


def _manual_rejected_none(w: World) -> list[str]:
    return [w.layout.rel(w.answer("T003-done", "T003", ok=True))]


def _decision_done_ok(w: World) -> list[str]:
    proposal(w, "D-001", "plan-task", ["T004"], [{"id": "yes", "label": "Y", "consequence": "c"}])
    resolution(w, "D-001", "yes")
    w.set_status("T004", "running", decision="D-001")
    return []


def _decision_done_none(w: World) -> list[str]:
    proposal(w, "D-001", "plan-task", ["T004"], [{"id": "yes", "label": "Y", "consequence": "c"}])
    w.set_status("T004", "running", decision="D-001")
    return []


def _unblock_ok(w: World) -> list[str]:
    proposal(w, "D-001", "dependency-missing", ["T001"])
    resolution(w, "D-001", "go")
    w.set_status("T001", "blocked-decision", decision="D-001", blocked={"kind": "dependency", "reason": "x"})
    return ["decision:D-001"]


def _unblock_none(w: World) -> list[str]:
    proposal(w, "D-001", "dependency-missing", ["T001"])
    resolution(w, "D-001", "no")
    w.set_status("T001", "blocked-decision", decision="D-001", blocked={"kind": "dependency", "reason": "x"})
    return ["decision:D-001"]


def _cutprop_ok(w: World) -> list[str]:
    proposal(w, "D-001", "cut", ["T001"], OPTS_CUT)
    return ["decision:D-001"]


def _cutprop_none(w: World) -> list[str]:
    proposal(w, "D-001", "amendment", ["T001"])
    return ["decision:D-001"]


def _cut_ok(w: World) -> list[str]:
    proposal(w, "D-001", "cut", ["T001"], OPTS_CUT)
    resolution(w, "D-001", "cut")
    w.set_status("T001", "cut-proposed", decision="D-001", previous_status="ready")
    return []


def _cut_none(w: World) -> list[str]:
    proposal(w, "D-001", "cut", ["T001"], OPTS_CUT)
    resolution(w, "D-001", "keep")
    w.set_status("T001", "cut-proposed", decision="D-001", previous_status="ready")
    return []


def _superseded_ok(w: World) -> list[str]:
    raw = planmod.load_raw(w.layout)
    raw["amendments"] = [{"plan_version": 2, "at_utc": S.FIXED_NOW, "by": "A", "decision": "D-003", "summary": "s",
                          "added": [], "changed": [], "superseded": ["T001"], "plan_sha256_before": "a" * 64,
                          "plan_sha256_after": "b" * 64}]
    raw["plan_version"] = 2
    jsonio.write_json_atomic(w.layout.plan, raw)
    return ["amendment:2:D-003"]


def _superseded_none(w: World) -> list[str]:
    return ["amendment:2:D-003"]


def _override_ok(w: World) -> list[str]:
    w.set_status("T001", "failed", attempts=2)
    proposal(w, "D-001", "retry-exhausted", ["T001"])
    resolution(w, "D-001", "go")
    return ["decision:D-001", "reason:retry with the findings"]


def _override_none(w: World) -> list[str]:
    w.set_status("T001", "failed", attempts=2)
    proposal(w, "D-001", "retry-exhausted", ["T001"])
    return ["decision:D-001", "reason:retry with the findings"]


ROWS: list[tuple[str, str, str | None, str, str, str, Setup, Setup]] = [
    ("planned-ready", "T002", None, "ready", "status", "wave emit", _deps_done, _deps_open),
    ("ready-planned", "T002", "ready", "planned", "schedule", "status", _deps_open, _deps_done),
    ("planned-running-approval", "T001", None, "running", "plan instantiate", "wave emit", _approval_ok,
     _approval_none),
    ("ready-running-wave", "T001", "ready", "running", "wave emit", "manual post", _launch_ok, _launch_none),
    ("planned-running-inwave", "T002", None, "running", "wave emit", "status", _inwave_ok, _inwave_none),
    ("ready-running-manual", "T003", "ready", "running", "manual post", "wave emit", _posted_ok, _posted_none),
    ("running-ready-rerun", "T001", "running", "ready", "status", "schedule", _rerun_ok, _rerun_landed),
    ("running-planned-skipped", "T002", "running", "planned", "wave ingest", "status", _skipped_ok, _skipped_none),
    ("running-built", "T001", "running", "built", "status", "schedule", _landed_ok, _landed_off_main),
    ("running-failed", "T001", "running", "failed", "wave ingest", "status", _failed_ok, _failed_none),
    ("running-blocked-manual", "T001", "running", "blocked-manual", "wave ingest", "status", _bmanual_ok,
     _bmanual_none),
    ("running-blocked-decision", "T001", "running", "blocked-decision", "wave ingest", "status", _bdecision_ok,
     _bdecision_none),
    ("built-verifying", "T001", None, "verifying", "status", "schedule", _verifying_ok, _verifying_none),
    ("verifying-done", "T001", None, "done", "proof verdict", "schedule", _done_ok, _done_none),
    ("verifying-failed", "T001", None, "failed", "wave ingest", "schedule", _vfail_ok, _vfail_none),
    ("failed-ready", "T001", None, "ready", "schedule", "status", _retry_ok, _retry_none),
    ("failed-running-fix", "T001", None, "running", "wave ingest", "status", _fix_ok, _fix_none),
    ("failed-blocked-decision", "T001", None, "blocked-decision", "wave ingest", "status", _exhausted_ok,
     _exhausted_none),
    ("manual-running-done", "T003", "running", "done", "answers ingest", "wave ingest", _manual_done_ok,
     _manual_done_none),
    ("manual-running-running", "T003", "running", "running", "answers ingest", "status", _manual_rejected_ok,
     _manual_rejected_none),
    ("decision-running-done", "T004", None, "done", "decision resolve", "wave ingest", _decision_done_ok,
     _decision_done_none),
    ("blocked-ready", "T001", None, "ready", "decision resolve", "status", _unblock_ok, _unblock_none),
    ("any-cut-proposed", "T001", "ready", "cut-proposed", "decision propose", "status", _cutprop_ok, _cutprop_none),
    ("cut-proposed-cut", "T001", None, "cut", "decision resolve", "status", _cut_ok, _cut_none),
    ("cut-proposed-previous", "T001", None, "ready", "decision resolve", "status", _cut_none, _cut_ok),
    ("any-superseded", "T001", "ready", "superseded", "status", "wave ingest", _superseded_ok, _superseded_none),
    ("failed-ready-override", "T001", None, "ready", "task set-status", "status", _override_ok, _override_none),
]


class TransitionTable(unittest.TestCase):
    """SCHEMAS.md 4.2, one row per case: (a) with evidence, (b) without, (c) a wrong command."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.base = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.base.cleanup()

    def _prepare(self, name: str, tid: str, frm: str | None, setup: Setup) -> tuple[World, list[str]]:
        w = self.base
        if name == "planned-running-approval":
            w.reset(_approval_tasks(), approved=False)
        else:
            w.reset()
        if frm is not None:
            w.set_status(tid, frm)
        return w, setup(w)

    def test_rows_are_unique_and_cover_the_table(self) -> None:
        self.assertEqual(len({r[0] for r in ROWS}), len(ROWS))
        covered = {(r[2] or "*", r[3], r[4]) for r in ROWS}
        self.assertGreaterEqual(len(covered), 26)
        evidences = {rule.evidence for rule in status.TRANSITIONS}
        self.assertEqual(len(evidences), 27, "one evidence check per row family of SCHEMAS.md 4.2")

    def _run_row(self, name: str, tid: str, frm: str | None, to: str, command: str, wrong: str, good: Setup,
                 bad: Setup) -> None:
        with self.subTest(row=name, case="a: with evidence"):
            w, evidence = self._prepare(name, tid, frm, good)
            before_hist = len((w.entry(tid) or {}).get("history", []))
            before_events = len(w.events("task.status"))
            entry = attempt(w, tid, to, command, evidence)
            self.assertEqual(entry["status"], to)
            self.assertEqual(w.entry(tid)["status"], to)
            self.assertEqual(len(w.entry(tid)["history"]), before_hist + 1)
            self.assertEqual(w.entry(tid)["history"][-1]["by"], command)
            self.assertEqual(len(w.events("task.status")), before_events + 1)
        with self.subTest(row=name, case="b: without evidence"):
            w, evidence = self._prepare(name, tid, frm, bad)
            before = w.status_bytes()
            with self.assertRaises(TransitionRefused) as cm:
                attempt(w, tid, to, command, evidence)
            self.assertEqual(cm.exception.exit_code, 4)
            self.assertEqual(cm.exception.items()[0].code, "E_TRANSITION_REFUSED")
            self.assertEqual(w.status_bytes(), before)
        with self.subTest(row=name, case="c: a command the row does not name"):
            w, evidence = self._prepare(name, tid, frm, good)
            before = w.status_bytes()
            with self.assertRaises(TransitionRefused):
                attempt(w, tid, to, wrong, evidence)
            self.assertEqual(w.status_bytes(), before)


def _row_test(row: tuple) -> Callable[[TransitionTable], None]:
    def test(self: TransitionTable) -> None:
        self._run_row(*row)
    test.__doc__ = f"SCHEMAS.md 4.2 row {row[0]}: {row[2] or 'planned'} -> {row[3]} by {row[4]}"
    return test


for _row in ROWS:
    setattr(TransitionTable, "test_row_" + _row[0].replace("-", "_"), _row_test(_row))


class SpecificRows(unittest.TestCase):
    def setUp(self) -> None:
        self.w = World()
        self.addCleanup(self.w.cleanup)

    def _rerun(self, consecutive: int) -> str:
        w = self.w
        w.set_status("T001", "running", consecutive_reruns=consecutive, reruns=consecutive)
        ctx = w.ctx("wave ingest")
        with w.locked():
            doc = statusio.load(w.layout, "A")
            out = reconcile.apply_rerun(ctx, doc, w.task("T001"), "W01", w.plan(), w.local_state())
            statusio.save(ctx, doc)
        return out

    def test_null_agent_is_a_rerun_with_attempts_unchanged(self) -> None:
        self.assertEqual(self._rerun(0), "ready")
        entry = self.w.entry("T001")
        self.assertEqual((entry["attempts"], entry["reruns"], entry["consecutive_reruns"]), (0, 1, 1))

    def test_third_consecutive_rerun_without_limit_evidence_blocks(self) -> None:
        self.assertEqual(self._rerun(2), "blocked-decision")
        entry = self.w.entry("T001")
        self.assertEqual(entry["blocked"]["kind"], "retry-exhausted")
        proposal_doc, _res = decisionsio.find(self.w.layout, entry["decision"])
        self.assertEqual(proposal_doc["kind"], "retry-exhausted")
        self.assertIn("relances épuisées", proposal_doc["title"])

    def test_third_rerun_with_rate_limit_evidence_stays_ready_and_pauses(self) -> None:
        w = self.w
        with w.locked():
            events.append(w.ctx("status"), "stop.failure", {"error": "rate_limit", "hook_ts": S.FIXED_NOW})
        self.assertEqual(self._rerun(2), "ready")
        code, env, _logs = w.run(["status"])
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["run_state"], "PAUSED_QUOTA")

    def test_built_verifying_done_by_proof_verdict_while_running(self) -> None:
        w = self.w
        fx = w.done_fixture("T001")
        w.set_status("T001", "running")
        for to in ("built", "verifying", "done"):
            attempt(w, "T001", to, "proof verdict", [])
        self.assertEqual(w.entry("T001")["status"], "done")
        self.assertEqual(w.entry("T001")["landed_sha"], fx["sha"])
        self.assertEqual(w.entry("T001")["receipt"], "proofs/T001.json")

    def test_manual_done_needs_every_bring_back_key(self) -> None:
        w = World([S.build_task("T003", kind="manual", manual={
            "steps": ["s"], "where": "phone", "latest_start_utc": S.FIXED_END, "options_source": None, "options": [],
            "decision_deadline_utc": None,
            "bring_back": [{"key": "T003-a", "kind": "text", "verify": {"method": "owner-attest"}},
                           {"key": "T003-b", "kind": "text", "verify": {"method": "owner-attest"}}]})])
        self.addCleanup(w.cleanup)
        w.set_status("T003", "running")
        w.answer("T003-a", "T003")
        S.assert_controlled(
            self,
            lambda: self.assertRaises(TransitionRefused, attempt, w, "T003", "done", "answers ingest", []),
            lambda: None)
        w.answer("T003-b", "T003")
        self.assertEqual(attempt(w, "T003", "done", "answers ingest", [])["status"], "done")

    def test_decision_with_file_proof_waits_for_choices(self) -> None:
        t4 = S.build_task("T004", kind="decision", proof={
            "type": "file", "spec": {"path": "C:/placeholder/choices.json", "json_pointer": "/H1", "json_checks": [
                {"pointer": "/pick", "check": "dir-exists", "base": "C:/placeholder"},
                {"pointer": "/answered_at", "check": "utc"}]},
            "expect": {"summary": "H1 written"}, "max_runtime_min": 1,
            "negative_control": {"kind": "not-applicable", "description": "a human choice", "expect_nonzero": True,
                                 "waived_reason": "an owner choice has no planted defect"}})
        t4["manual"] = dict(t4["manual"], options=[], options_source="C:/placeholder")
        w = World([t4])
        self.addCleanup(w.cleanup)
        choices = w.layout.state / "frontend" / "choices.json"
        directions = w.layout.state / "frontend" / "directions"
        (directions / "B").mkdir(parents=True)
        raw = planmod.load_raw(w.layout)
        raw["tasks"][0]["proof"]["spec"]["path"] = choices.as_posix()
        raw["tasks"][0]["proof"]["spec"]["json_checks"][0]["base"] = directions.as_posix()
        raw["tasks"][0]["manual"]["options_source"] = directions.as_posix()
        raw["approved"]["plan_sha256"] = planmod.plan_digest(raw)
        jsonio.write_json_atomic(w.layout.plan, raw)
        w.set_status("T004", "ready")
        code, env, _l = w.run(["manual", "post", "--task", "T004"])
        self.assertEqual(code, 0, env)
        did = w.entry("T004")["decision"]
        self.assertIsNotNone(did)
        choice = w.text_file("choice.txt", "b\n")
        quote = w.text_file("quote.txt", "B, avec un fond plus sombre.\n")
        code, env, _l = w.run(["decision", "resolve", "--id", did, "--choice-file", str(choice), "--by", "devA",
                               "--source", "terminal", "--quote-file", str(quote)])
        self.assertEqual(code, 0, env)
        self.assertEqual(w.entry("T004")["status"], "running")  # choices.json not written yet
        code, env, _l = w.run(["status"])
        self.assertEqual(w.entry("T004")["status"], "running")
        S.write_json(choices, {"version": 1, "H1": {"pick": "B", "change": "", "answered_at": S.FIXED_NOW,
                                                    "by": "devA", "channel": "terminal", "source": "x"}})
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        self.assertEqual(w.entry("T004")["status"], "done")


class SetStatus(unittest.TestCase):
    def setUp(self) -> None:
        self.w = World()
        self.addCleanup(self.w.cleanup)
        proposal(self.w, "D-001", "retry-exhausted", ["T001"])
        resolution(self.w, "D-001", "go")

    def _call(self, to: str) -> None:
        args = Namespace(task="T001", to=to, reason="owner said so", decision="D-001")
        status.cmd_set_status(self.w.ctx("task set-status"), args)

    def test_never_built_verifying_or_done_from_any_source(self) -> None:
        for source in sorted(status.ALL_STATUSES):
            for target in ("built", "verifying", "done"):
                with self.subTest(source=source, target=target):
                    self.w.set_status("T001", source)
                    before = self.w.status_bytes()
                    with self.assertRaises(ExecError) as cm:
                        self._call(target)
                    self.assertEqual(cm.exception.exit_code, 4)
                    self.assertEqual(self.w.status_bytes(), before)

    def test_failed_to_ready_with_a_resolved_decision(self) -> None:
        self.w.set_status("T001", "failed", attempts=2)
        self._call("ready")
        self.assertEqual(self.w.entry("T001")["status"], "ready")
        self.assertEqual(self.w.entry("T001")["history"][-1]["by"], "task set-status")

    def test_cli_refuses_done_with_exit_4_and_allows_ready(self) -> None:
        w = self.w
        w.set_status("T001", "failed", attempts=2)
        code, env, _l = w.run(["task", "set-status", "--task", "T001", "--to", "done", "--reason", "x",
                               "--decision", "D-001"])
        self.assertEqual((code, env["errors"][0]["code"]), (4, "E_TRANSITION_REFUSED"))
        code, env, _l = w.run(["task", "set-status", "--task", "T001", "--to", "ready", "--reason", "x",
                               "--decision", "D-001"])
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["to"], "ready")

    def test_an_agent_caller_is_refused(self) -> None:
        self.w.set_status("T001", "failed", attempts=2)
        code, env, _l = self.w.run(["task", "set-status", "--task", "T001", "--to", "ready", "--reason", "x",
                                    "--decision", "D-001", "--by", "implementer"])
        self.assertEqual(code, 4, env)


class TerminalStates(unittest.TestCase):
    def test_every_outgoing_transition_is_refused(self) -> None:
        w = World()
        self.addCleanup(w.cleanup)
        commands = sorted({c for r in status.TRANSITIONS for c in r.commands})
        for terminal in sorted(status.TERMINAL):
            w.set_status("T001", terminal)
            for to in sorted(status.ALL_STATUSES):
                for command in commands:
                    self.assertIsNone(status.find_rule(terminal, to, command, w.task("T001")),
                                      f"{terminal} -> {to} by {command}")
                with self.assertRaises(TransitionRefused):
                    attempt(w, "T001", to, "status", ["decision:D-001", "rerun:W01"])
        # positive control: a non-terminal source does have outgoing rows
        self.assertIsNotNone(status.find_rule("verifying", "done", "status", w.task("T001")))


class DoneCheck(unittest.TestCase):
    """SCHEMAS.md 4.3: each condition removed alone blocks done; the full fixture passes."""

    def _check(self, w: World, profile: str = "local") -> list:
        plan = w.plan()
        task = plan.by_id["T001"]
        entry = w.entry("T001") or {}
        ts = TaskState(status="verifying", since=S.fixed_now(), attempts=0, reruns=0, raw=entry)
        git = status.product_git(w.layout)
        return status.check_done_evidence(w.layout, plan, task, ts, git, profile=profile)

    @classmethod
    def setUpClass(cls) -> None:
        cls.base = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.base.cleanup()

    def _world(self, *, tracked: bool = False) -> tuple[World, dict]:
        w = self.base
        w.reset()
        fx = w.done_fixture("T001", tracked=tracked)
        w.set_status("T001", "verifying", landed_sha=fx["sha"])
        return w, fx

    def _breakers(self) -> list[tuple[str, int, Callable[[World, dict], None]]]:
        def receipt_fail(w: World, fx: dict) -> None:
            w.receipt("T001", fx["sha"], fx["run"], verdict="fail")

        def sha_not_landed(w: World, fx: dict) -> None:
            other = w.land("src/t1/other.ts")
            w.receipt("T001", other, fx["run"])

        def not_on_main(w: World, fx: dict) -> None:
            # the bare origin is reset to the commit before the landed one
            parent = w.repo.git("rev-parse", f"{fx['sha']}^")
            S.git(w.root, "--git-dir", str(w.repo.origin), "update-ref", "refs/heads/main", parent,
                  env=w.repo.env)
            w.repo.git("fetch", "--quiet", "origin", "+refs/heads/main:refs/remotes/origin/main")

        def old_proof_hash(w: World, fx: dict) -> None:
            w.receipt("T001", fx["sha"], fx["run"], proof_hash="e" * 64)

        def run_not_met(w: World, fx: dict) -> None:
            w.proof_run("T001", fx["sha"], run_id=fx["run"], met=False)
            w.proof_run("T001", fx["sha"], run_id=fx["run"], met=False, tracked=True)

        def same_agent(w: World, fx: dict) -> None:
            r = w.receipt("T001", fx["sha"], fx["run"])
            r["by"]["agent_id"] = r["implementer"]["agent_id"]
            jsonio.write_json_atomic(w.layout.receipt("T001"), r)

        def null_agent(w: World, fx: dict) -> None:
            r = w.receipt("T001", fx["sha"], fx["run"])
            r["by"]["agent_id"] = None
            jsonio.write_json_atomic(w.layout.receipt("T001"), r)

        def nc_not_met(w: World, fx: dict) -> None:
            w.receipt("T001", fx["sha"], fx["run"],
                      negative_control={"required": True, "ran": False, "exit_code": None, "met": None})
            w.proof_run("T001", fx["sha"], run_id=fx["run"], nc_met=False)
            w.proof_run("T001", fx["sha"], run_id=fx["run"], nc_met=False, tracked=True)

        def skip_markers(w: World, fx: dict) -> None:
            r = w.receipt("T001", fx["sha"], fx["run"], verdict="fail")
            r["verdict"] = "pass"
            r["integrity"]["skip_markers_added"] = 1
            jsonio.write_json_atomic(w.layout.receipt("T001"), r)

        def receipt_missing(w: World, fx: dict) -> None:
            w.layout.receipt("T001").unlink()

        return [("receipt missing", 1, receipt_missing), ("verdict fail", 1, receipt_fail),
                ("sha not the landed sha", 2, sha_not_landed), ("sha not on origin/main", 2, not_on_main),
                ("proof hash of a previous plan version", 3, old_proof_hash),
                ("run expectation not met", 4, run_not_met), ("verifier agent id null", 5, null_agent),
                ("verifier is the implementer", 5, same_agent), ("negative control not met", 6, nc_not_met),
                ("skip markers added", 7, skip_markers)]

    def test_full_fixture_passes_in_both_profiles(self) -> None:
        for profile, tracked in (("local", False), ("cross", True)):
            w, _fx = self._world(tracked=tracked)
            if profile == "cross":
                shutil.rmtree(w.layout.local / "results")
                shutil.rmtree(w.layout.local / "proof-runs")
            self.assertEqual(self._check(w, profile), [], f"positive control ({profile})")

    def _blocks(self, index: int, profile: str) -> None:
        name, cond, breaker = self._breakers()[index]
        tracked = profile == "cross"
        w, fx = self._world(tracked=tracked)
        if tracked:
            shutil.rmtree(w.layout.local / "results")
            shutil.rmtree(w.layout.local / "proof-runs")
        self.assertEqual(self._check(w, profile), [], "positive control")
        breaker(w, fx)
        items = self._check(w, profile)
        self.assertTrue(items, f"{name} did not block done")
        self.assertIn(f"SCHEMAS.md 4.3/{cond}", {i.path for i in items}, [i.message for i in items])

    def test_cross_profile_needs_the_tracked_copies(self) -> None:
        w, fx = self._world(tracked=True)
        shutil.rmtree(w.layout.local / "results")
        shutil.rmtree(w.layout.local / "proof-runs")
        S.assert_controlled(
            self,
            lambda: None,
            lambda: self.assertEqual(self._check(w, "cross"), []))
        w.layout.proof_run_copy("T001", fx["run"]).unlink()
        items = self._check(w, "cross")
        self.assertIn("SCHEMAS.md 4.3/4", {i.path for i in items})
        w.merge_receipt("T001", fx["sha"], tracked=True)
        w.layout.merge_copy("T001", 1).unlink()
        self.assertIn("SCHEMAS.md 4.3/2", {i.path for i in self._check(w, "cross")})


def _done_test(index: int, profile: str) -> Callable[[DoneCheck], None]:
    def test(self: DoneCheck) -> None:
        self._blocks(index, profile)
    return test


_NAMES = ["receipt_missing", "verdict_fail", "sha_not_landed", "sha_not_on_origin_main", "old_proof_hash",
          "run_not_met", "verifier_agent_id_null", "verifier_is_implementer", "negative_control_not_met",
          "skip_markers_added"]
for _i, _name in enumerate(_NAMES):
    for _profile in ("local", "cross"):
        setattr(DoneCheck, f"test_{_profile}_{_name}_blocks_done", _done_test(_i, _profile))


class EvidenceVocabulary(unittest.TestCase):
    """The evidence items `transition` reads are a published vocabulary (status.EVIDENCE, contract question
    Q-B04-21), and the shape lane B02's `plan instantiate` passes (a bare decision id) is accepted."""

    def test_every_family_has_its_entry(self) -> None:
        families = {rule.evidence for rule in status.TRANSITIONS}
        self.assertEqual(set(status.EVIDENCE), families)
        self.assertEqual(set(status._CHECKS), families)
        used = {m for forms in status.EVIDENCE.values() for f in forms for m in re.findall(r"([a-z-]+):<", f)}
        self.assertTrue(used)
        # both ways: no family names an unknown prefix, and no accepted prefix is missing from the table (verify-3
        # m4: `posted:<utc>`, passed by manual.py, was accepted but not listed)
        self.assertEqual(used, set(status.EVIDENCE_PREFIXES))

    def test_normalize_and_build_items(self) -> None:
        self.assertEqual(status.normalize_evidence(["D-001", " ", "answers\\T001-x.md", "rerun:W01", "D-001",
                                                    "decision:D-001"]),
                         ["decision:D-001", "answers/T001-x.md", "rerun:W01"])
        self.assertEqual(status.evidence_item("launch-intent", "W03"), "launch-intent:W03")
        with self.assertRaises(InternalError):
            status.evidence_item("made-up", "x")
        self.assertEqual(status.evidence_value(["D-007"], "decision"), "D-007")
        self.assertIsNone(status.evidence_value(["D-007"], "rerun"))

    def test_plan_instantiate_call_shape_of_lane_b02(self) -> None:
        """planning.py: status.transition(ctx, doc, task, "running", evidence=[did]) with a bare decision id."""
        w = World(_approval_tasks(), approved=False, run_state="AWAIT_APPROVAL")
        self.addCleanup(w.cleanup)
        proposal(w, "D-001", "approval", ["T001"])
        entry = attempt(w, "T001", "running", "plan instantiate", ["D-001"])
        self.assertEqual(entry["status"], "running")
        self.assertEqual(entry["decision"], "D-001")
        self.assertEqual(w.entry("T001")["history"][-1]["evidence"], ["decision:D-001"])
        ev = w.events("task.status")[-1]
        self.assertEqual(ev["data"]["evidence"], ["decision:D-001"])
        # negative controls: a bare id of no proposal, and of a proposal of another kind, are refused
        w.reset(_approval_tasks(), approved=False, run_state="AWAIT_APPROVAL")
        proposal(w, "D-001", "other", ["T001"])
        for bad in (["D-002"], ["D-001"]):
            before = w.status_bytes()
            with self.assertRaises(TransitionRefused):
                attempt(w, "T001", "running", "plan instantiate", bad)
            self.assertEqual(w.status_bytes(), before)

    def test_transition_without_the_state_lock_is_an_internal_error(self) -> None:
        w = World(_approval_tasks(), approved=False, run_state="AWAIT_APPROVAL")
        self.addCleanup(w.cleanup)
        proposal(w, "D-001", "approval", ["T001"])
        doc = statusio.load(w.layout, "A")
        with self.assertRaises(InternalError) as cm:
            status.transition(w.ctx("plan instantiate"), doc, w.task("T001"), "running", evidence=["D-001"])
        self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_INTERNAL", 3))
        self.assertNotIsInstance(cm.exception, TransitionRefused)
        self.assertEqual(attempt(w, "T001", "running", "plan instantiate", ["D-001"])["status"], "running")


if __name__ == "__main__":
    unittest.main()


_ = (json, Any)
