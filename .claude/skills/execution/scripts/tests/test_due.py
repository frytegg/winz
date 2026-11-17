"""Clock work from UTC anchors (lane B03; contract/TESTS.md 3.5 "due", CLI.md `due`, TWO-DEV.md 8.4).

Protects: a T-6h anchor on the event deadline; recurrences until an anchor; overdue latest starts; freezes becoming
active at their instant; the other executor's silence from the remote's commit dates; the `due` command (event only
when something is overdue) giving identical output whatever the machine's TZ.

Run: python -m unittest discover -s scripts/tests -p "test_due.py" -v
"""
from __future__ import annotations

import logging
import subprocess
import sys
import unittest
from datetime import timedelta

import _support as S
from execlib import clock, events, jsonio, locks, paths
from execlib import due
from execlib.model import Ctx, PlanModel

NOW = S.fixed_now()                       # 2026-10-03T07:12:00Z
START = "2026-10-03T07:45:00Z"            # build_profile event.start_utc (FIXED_T0)
END = S.FIXED_END                         # 2026-10-03T13:45:00Z


def at(minutes: float) -> str:
    return clock.format_utc(NOW + timedelta(minutes=minutes))


def anchored(tid: str, ref: str, offset: int, recurrence: dict | None = None, **over: object) -> dict:
    return S.build_task(tid, kind="research", anchor={"relative_to": ref, "offset_min": offset,
                                                      "recurrence": recurrence}, writes=[], **over)


def plan_of(*tasks: dict) -> PlanModel:
    raw = S.build_plan(list(tasks))
    for t in raw["tasks"]:
        if t.get("lane") is None:
            t.pop("lane", None)
    return PlanModel.from_raw(S.approve(raw))


class Anchors(unittest.TestCase):
    def test_t_minus_6h_on_the_event_deadline(self) -> None:
        profile = S.build_profile()
        p = plan_of(anchored("T001", "event.deadline", -360))
        self.assertEqual(clock.format_utc(due.anchor_instant(p.by_id["T001"].anchor, p, {}, profile)),
                         "2026-10-03T07:45:00Z")
        # the item is listed once the instant is inside the horizon, overdue after it
        items = due.due_items(p, {}, profile, NOW, 60)
        self.assertEqual([(i["task"], i["kind"], i["at_utc"], i["overdue_min"]) for i in items
                          if i["task"] == "T001"], [("T001", "anchor", "2026-10-03T07:45:00Z", 0)])
        later = due.due_items(p, {}, profile, NOW + timedelta(minutes=63), 0)
        self.assertEqual([i["overdue_min"] for i in later if i["task"] == "T001"], [30.0])
        # positive control: outside the horizon nothing is due
        self.assertEqual([i for i in due.due_items(p, {}, profile, NOW, 10) if i["task"] == "T001"], [])

    def test_task_anchor_from_the_status_history(self) -> None:
        p = plan_of(S.build_task("T001"), anchored("T002", "T001.done", 30, depends_on=["T001"]))
        self.assertIsNone(due.anchor_instant(p.by_id["T002"].anchor, p, {}, S.build_profile()))
        st = {"A": S.build_status("A", {"T001": S.build_task_status("done", history=[
            {"from": "verifying", "to": "done", "at_utc": at(-10), "by": "proof verdict", "evidence": ["x"]}])})}
        self.assertEqual(clock.format_utc(due.anchor_instant(p.by_id["T002"].anchor, p, st, S.build_profile())),
                         at(20))

    def test_recurrence_until_an_anchor(self) -> None:
        profile = S.build_profile()
        p = plan_of(anchored("T001", "event.start", 0, {"every_min": 120, "until": "DL-submission"}))
        occ = due.recurrence_instants(p.by_id["T001"].anchor, p, {}, profile)
        self.assertEqual([clock.format_utc(o) for o in occ],
                         ["2026-10-03T07:45:00Z", "2026-10-03T09:45:00Z", "2026-10-03T11:45:00Z",
                          "2026-10-03T13:45:00Z"])
        p2 = plan_of(anchored("T001", "event.start", 0, {"every_min": 120, "until": "2026-10-03T11:44:59Z"}))
        self.assertEqual(len(due.recurrence_instants(p2.by_id["T001"].anchor, p2, {}, profile)), 2)
        items = [i for i in due.due_items(p, {}, profile, NOW, 400) if i["task"] == "T001"]
        self.assertEqual([i["kind"] for i in items], ["recurrence"] * 4)
        # at 10:00 the 09:45 occurrence is overdue by 15 min and two are still ahead within 4 h
        later = [i for i in due.due_items(p, {}, profile, clock.parse_utc("2026-10-03T10:00:00Z"), 240)
                 if i["task"] == "T001"]
        self.assertEqual([(i["at_utc"], i["overdue_min"]) for i in later],
                         [("2026-10-03T09:45:00Z", 15.0), ("2026-10-03T11:45:00Z", 0),
                          ("2026-10-03T13:45:00Z", 0)])


class LatestStartsAndFreezes(unittest.TestCase):
    def test_overdue_latest_start(self) -> None:
        manual = S.build_task("T001", kind="manual")
        manual["manual"]["latest_start_utc"] = at(-30)
        p = plan_of(manual)
        items = [i for i in due.due_items(p, {}, S.build_profile(), NOW, 60) if i["kind"] == "latest-start"]
        self.assertEqual([(i["task"], i["overdue_min"]) for i in items], [("T001", 30.0)])
        posted = {"A": S.build_status("A", {"T001": S.build_task_status("running")})}
        self.assertEqual([i for i in due.due_items(p, posted, S.build_profile(), NOW, 60)
                          if i["kind"] == "latest-start"], [])

    def test_freeze_becomes_active_at_its_instant(self) -> None:
        profile = S.build_profile(freezes=[{"id": "code-for-recording", "kind": "code-for-recording",
                                            "at_utc": "2026-10-03T12:15:00Z", "globs": ["**"]}])
        policy = S.build_policy()
        p = plan_of(S.build_task("T001"))
        x = clock.parse_utc("2026-10-03T12:15:00Z")
        before = {f["id"]: f["active"] for f in due.freezes(p, profile, policy, x - timedelta(seconds=1))}
        after = {f["id"]: f["active"] for f in due.freezes(p, profile, policy, x)}
        self.assertEqual(before, {"code-for-recording": False, "push-freeze": False})
        self.assertEqual(after, {"code-for-recording": True, "push-freeze": False})
        items = due.due_items(p, {}, profile, x - timedelta(minutes=5), 10, policy=policy)
        self.assertEqual([(i["kind"], i["freeze"]) for i in items if i["kind"] == "freeze"],
                         [("freeze", "code-for-recording")])


class Liveness(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, self.tmp)

    def sync_event(self, layout: object, commit_utc: str) -> None:
        jsonio.append_jsonl(layout.events, {
            "ts": "2026-10-03T07:10:00.000000Z", "actor": "exec:sync@A", "type": "sync", "executor": "A", "seq": 1,
            "data": {"other_executor_last_commit_utc": commit_utc, "pushed": True}})

    def test_other_executor_silent(self) -> None:
        raw = S.build_plan([S.build_task("T001"), S.build_task("T002", executor="B")])
        layout = S.state_dir(self.tmp, plan=raw)
        statuses = {"A": S.build_status("A"),
                    "B": S.build_status("B", {"T002": S.build_task_status("ready")})}
        p = PlanModel.from_raw(S.approve(raw))
        self.sync_event(layout, at(-71))
        stale = due.stale_items(p, statuses, S.build_profile(), None, executor="A", now=NOW, layout=layout)
        silent = [s for s in stale if s.get("silent")]
        self.assertEqual([(s["what"], s["executor"], s["age_min"], s["threshold_min"]) for s in silent],
                         [("status", "B", 71.0, 70)])
        # positive controls: a recent commit, or nothing of B's in flight, is not silence
        layout2 = S.state_dir(self.tmp / "b", plan=raw)
        self.sync_event(layout2, at(-69))
        self.assertEqual([s for s in due.stale_items(p, statuses, S.build_profile(), None, executor="A", now=NOW,
                                                     layout=layout2) if s.get("silent")], [])
        idle = {"A": S.build_status("A"), "B": S.build_status("B", {"T002": S.build_task_status("done")})}
        self.assertEqual([s for s in due.stale_items(p, idle, S.build_profile(), None, executor="A", now=NOW,
                                                     layout=layout) if s.get("silent")], [])


class DueCommand(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, self.tmp)

    def run_due(self, layout: object, env: dict | None = None) -> bytes:
        proc = subprocess.run([sys.executable, str(S.EXEC_PY), "due", "--state", str(layout.state), "--executor",
                               "A", "--horizon-min", "120"], cwd=str(self.tmp), env=env or S.env_isolated(),
                              capture_output=True, timeout=120)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        return proc.stdout

    def test_utc_only_and_event_only_when_overdue(self) -> None:
        manual = S.build_task("T002", kind="manual")
        manual["manual"]["latest_start_utc"] = at(30)
        raw = S.build_plan([anchored("T001", "event.deadline", -360), manual])
        for t in raw["tasks"]:
            if t.get("lane") is None:
                t.pop("lane", None)
        layout = S.state_dir(self.tmp, plan=raw)
        S.write_json(layout.profile, S.build_profile())
        S.write_json(layout.policy, S.build_policy())
        sgt = self.run_due(layout, S.env_isolated(TZ="Asia/Singapore"))
        paris = self.run_due(layout, S.env_isolated(TZ="Europe/Paris"))
        self.assertEqual(sgt, paris)
        code, env, _l = S.run_exec(["due", "--state", str(layout.state), "--executor", "A"], self.tmp)
        self.assertEqual(code, 0)
        kinds = [(i["task"], i["kind"]) for i in env["data"]["due"]]
        self.assertEqual(kinds, [("T002", "latest-start"), ("T001", "anchor")])  # 07:42 before 07:45
        self.assertEqual(env["data"]["now"]["SGT"], "Sat 3 Oct 15:12 SGT")
        self.assertFalse(layout.events.exists() and any(
            d.get("type") == "due" for _n, d in jsonio.read_jsonl(layout.events)))
        # positive control: one hour later the anchor is overdue and a `due` event is written
        code, env, _l = S.run_exec(["due", "--state", str(layout.state), "--executor", "A", "--now", at(60)],
                                   self.tmp)
        self.assertEqual(code, 0)
        dues = [d for _n, d in jsonio.read_jsonl(layout.events) if d.get("type") == "due"]
        self.assertEqual(len(dues), 1)
        self.assertEqual([(o["task"], o["kind"], o["overdue_min"]) for o in dues[0]["data"]["overdue"]],
                         [("T002", "latest-start", 30.0), ("T001", "anchor", 27.0)])
        self.assertEqual(dues[0]["actor"], "exec:due@A")


class EventCopyMatchesEventsAppend(unittest.TestCase):
    """Q-B03-1 / B03-V2: until the due -> events edge exists, `_append_event` must write exactly what
    `events.append` writes (actor with --by agent roles, ts, executor, session id, seq). A drift fails here."""
    DATA = {"overdue": [{"task": "T001", "kind": "anchor", "at_utc": "2026-10-03T07:00:00Z", "overdue_min": 12.0}]}

    def ctx(self, by: str) -> Ctx:
        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        layout = S.state_dir(tmp)
        return Ctx(layout=paths.layout_for(None, layout.state), executor="A", now=NOW, by=by, pretty=False,
                   command="due", log=logging.getLogger("tests"))

    def written(self, by: str, use_copy: bool) -> dict:
        ctx = self.ctx(by)
        with S.patched_env(CLAUDE_CODE_SESSION_ID="sess-d"), locks.hold(ctx.layout, "state", command="t"):
            return due._append_event(ctx, "due", self.DATA) if use_copy else events.append(ctx, "due", self.DATA)

    def test_same_roles_and_same_line(self) -> None:
        self.assertEqual(due.AGENT_ROLES, events.AGENT_ROLES)
        for by in ("orchestrator", "verifier", "probe"):
            self.assertEqual(self.written(by, True), self.written(by, False), by)
        self.assertEqual(self.written("verifier", True)["actor"], "agent:verifier@A")
        self.assertEqual(self.written("orchestrator", True)["actor"], "exec:due@A")  # positive control

    def test_refused_without_the_state_lock(self) -> None:
        ctx = self.ctx("orchestrator")
        with self.assertRaises(due.InternalError):
            due._append_event(ctx, "due", self.DATA)
        with locks.hold(ctx.layout, "state", command="t"):  # positive control
            self.assertEqual(due._append_event(ctx, "due", self.DATA)["type"], "due")


if __name__ == "__main__":
    unittest.main()
