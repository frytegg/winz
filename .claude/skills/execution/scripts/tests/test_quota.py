"""Quota decisions (lane B03; contract/TESTS.md 3.10, CLI.md `quota` rules 1-5, SCHEMAS.md 4.4).

Protects: snapshot parsing (epoch resets to UTC); stale and missing snapshots give `unknown` with W_SNAPSHOT_STALE and
nothing invented; >= 85 % five-hour gives critical-only; a short weekly projection pauses with a quota decision
draft (exit 1); five-hour 100 % pauses until its reset, normal with an extra-usage override; weekly 100 % with the
override is normal; a rate_limit stop.failure or a null storm newer than the snapshot pauses until the five-hour
reset even at 40 %, and that pause ends at the reset (evidence + 5 h without a usable snapshot reset; open-ended only
with an extra-usage override); a 100 % reading whose reset passed no longer pauses; the command writes
local/state.json `quota` and a `quota` event; the private event writer writes exactly what `events.append` writes.

Run: python -m unittest discover -s scripts/tests -p "test_quota.py" -v
"""
from __future__ import annotations

import copy
import logging
import unittest
from datetime import timedelta
from pathlib import Path

import _support as S
from execlib import clock, events, jsonio, locks, paths, schema
from execlib import quota
from execlib.model import Ctx

FIX = S.FIXTURES / "B03"
SNAP = FIX / "usage-snapshot.json"
NOW = S.fixed_now()          # 2026-10-03T07:12:00Z, 720 s after the snapshot's capture
FIVE_RESET = "2026-10-03T08:00:00Z"
SEVEN_RESET = "2026-10-07T08:00:00Z"
NO_PROJECTION = {"plan_agent_hours_p80": None, "pct_per_agent_hour": None, "weekly_pct_needed": None}


def snap(**over: object) -> quota.Snapshot:
    base = quota.read_snapshot(SNAP)
    assert base is not None
    return quota.Snapshot(**{**base.__dict__, **over})


def extra_usage(until: str = SEVEN_RESET) -> dict:
    return {"mode": "extra-usage", "until_utc": until, "decision": "D-010"}


class Snapshot(unittest.TestCase):
    def test_parsing_and_epoch_resets(self) -> None:
        s = quota.read_snapshot(SNAP)
        self.assertEqual(clock.format_utc(s.captured), "2026-10-03T07:00:00Z")
        self.assertEqual((s.five_pct, s.seven_pct), (86.0, 71.0))
        self.assertEqual(clock.format_utc(s.five_resets), FIVE_RESET)
        self.assertEqual(clock.format_utc(s.seven_resets), SEVEN_RESET)

    def test_missing_and_malformed(self) -> None:
        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        self.assertIsNone(quota.read_snapshot(tmp / "absent.json"))
        bad = S.write_json(tmp / "bad.json", {"five_hour": {}})
        with self.assertRaises(quota.ValidationFailed):
            quota.read_snapshot(bad)


class Rules(unittest.TestCase):
    profile = S.build_profile()

    def decide(self, s: quota.Snapshot | None, *, now=NOW, projection=NO_PROJECTION, override=None,
               evidence=None) -> dict:
        return quota.decide(s, now, self.profile, projection, override=override, limit_evidence_utc=evidence)

    def test_critical_only_at_86(self) -> None:
        r = self.decide(snap())
        self.assertEqual((r["decision"], r["rule"]), ("critical-only", 4))
        # the threshold itself is inclusive (CLI.md quota rule 4: >= 85 %)
        r85 = self.decide(snap(five_pct=85.0))
        self.assertEqual((r85["decision"], r85["rule"]), ("critical-only", 4))
        # positive control: 84 % is normal
        self.assertEqual(self.decide(snap(five_pct=84.0))["decision"], "normal")

    def test_stale_and_missing_are_unknown(self) -> None:
        r = self.decide(snap(), now=NOW + timedelta(minutes=8))  # 20 min old, max_age_s 900
        self.assertEqual((r["decision"], r["stale"], r["rule"]), ("unknown", True, 3))
        self.assertEqual(self.decide(None)["decision"], "unknown")
        self.assertEqual(self.decide(snap(), now=NOW + timedelta(minutes=3))["decision"], "critical-only")

    def test_weekly_projection_short_pauses_with_a_draft(self) -> None:
        proj = {"plan_agent_hours_p80": 10.0, "pct_per_agent_hour": 2.5, "weekly_pct_needed": 25.0}
        r = self.decide(snap(five_pct=40.0), projection=proj)  # 71 + 25 + 10 > 100
        self.assertEqual((r["decision"], r["rule"], r["pause_until_utc"]), ("pause", 5, SEVEN_RESET))
        draft = r["proposal"]
        self.assertEqual(draft["kind"], "quota")
        self.assertEqual([o["id"] for o in draft["options"]], ["extra-usage", "critical-only", "wait"])
        self.assertEqual(draft["options"][0]["label"], "J'achète de l'usage supplémentaire : continuer")
        self.assertEqual(draft["options"][0]["effects"][0]["op"], "quota-override")
        header = {"schema": "execution.decision/1", "record": "proposal", "id": "D-011", "at_utc": S.FIXED_NOW,
                  "by": "exec@A", **{k: draft[k] for k in ("kind", "title", "tasks", "options", "recommended",
                                                          "deadline_utc")}}
        header["dedup"] = S.sha(S.canonical([draft["kind"], draft["title"], sorted(draft["tasks"])]))  # by propose
        self.assertTrue(schema.validate(header, "decision").ok)
        # positive control: a need that fits (71 + 15 + 10 <= 100) is normal
        ok = dict(proj, weekly_pct_needed=15.0)
        self.assertEqual(self.decide(snap(five_pct=40.0), projection=ok)["decision"], "normal")
        # with the extra-usage override the same shortage is normal
        self.assertEqual(self.decide(snap(five_pct=40.0), projection=proj, override=extra_usage())["decision"],
                         "normal")

    def test_five_hour_exhausted(self) -> None:
        r = self.decide(snap(five_pct=100.0))
        self.assertEqual((r["decision"], r["pause_until_utc"]), ("pause", FIVE_RESET))
        self.assertEqual(self.decide(snap(five_pct=100.0), override=extra_usage())["decision"], "normal")
        # an expired override no longer counts
        expired = extra_usage(until="2026-10-03T07:00:00Z")
        self.assertEqual(self.decide(snap(five_pct=100.0), override=expired)["decision"], "pause")

    def test_weekly_exhausted(self) -> None:
        self.assertEqual(self.decide(snap(five_pct=40.0, seven_pct=100.0))["decision"], "pause")
        self.assertEqual(self.decide(snap(five_pct=40.0, seven_pct=100.0), override=extra_usage())["decision"],
                         "normal")

    def test_limit_evidence_newer_than_the_snapshot(self) -> None:
        evidence = clock.parse_utc("2026-10-03T07:05:00Z")
        r = self.decide(snap(five_pct=40.0), evidence=evidence)
        self.assertEqual((r["decision"], r["rule"], r["pause_until_utc"]), ("pause", 1, FIVE_RESET))
        # positive control: evidence older than the snapshot is superseded by the fresh reading
        older = clock.parse_utc("2026-10-03T06:55:00Z")
        self.assertEqual(self.decide(snap(five_pct=40.0), evidence=older)["decision"], "normal")
        # rule 1 wins over a stale snapshot; with extra usage it waits for a newer snapshot
        stale_now = NOW + timedelta(minutes=30)
        self.assertEqual(self.decide(snap(five_pct=40.0), now=stale_now, evidence=evidence)["decision"], "pause")
        r = self.decide(snap(five_pct=40.0), evidence=evidence, override=extra_usage())
        self.assertEqual((r["decision"], r["pause_until_utc"]), ("pause", None))

    def test_limit_evidence_expires_at_the_five_hour_reset(self) -> None:
        """CLI.md rule 1: the pause lasts until the five-hour resets_at; launching resumes after it (B03-V1)."""
        evidence = clock.parse_utc("2026-10-03T07:05:00Z")
        reset = clock.parse_utc(FIVE_RESET)
        s = snap(five_pct=40.0)
        # positive control: one second before the reset it is still a rule-1 pause
        r = self.decide(s, now=reset - timedelta(seconds=1), evidence=evidence)
        self.assertEqual((r["decision"], r["rule"], r["pause_until_utc"]), ("pause", 1, FIVE_RESET))
        # one second after it, and long after it, the evidence is spent: the snapshot is stale, so unknown
        for later in (timedelta(seconds=1), timedelta(hours=4), timedelta(hours=24), timedelta(hours=72)):
            r = self.decide(s, now=reset + later, evidence=evidence)
            self.assertEqual((r["decision"], r["rule"], r["stale"], r["pause_until_utc"]),
                             ("unknown", 3, True, None), later)
        # a fresh snapshot newer than the evidence decides on its own reading (here 40 %: normal)
        fresh = snap(five_pct=40.0, captured=reset + timedelta(minutes=1))
        self.assertEqual(self.decide(fresh, now=reset + timedelta(minutes=2), evidence=evidence)["decision"],
                         "normal")
        # with an extra-usage override the wait stays open-ended until a snapshot newer than the evidence
        r = self.decide(s, now=reset + timedelta(hours=24), evidence=evidence, override=extra_usage())
        self.assertEqual((r["decision"], r["rule"], r["pause_until_utc"]), ("pause", 1, None))

    def test_limit_evidence_without_a_snapshot_or_after_its_reset(self) -> None:
        """No snapshot, or a snapshot whose resets_at predates the evidence: the window that was hit resets at most
        five hours after the evidence, so the pause ends there and never lasts forever."""
        evidence = clock.parse_utc("2026-10-03T07:05:00Z")
        bound = evidence + timedelta(hours=5)
        r = self.decide(None, now=bound - timedelta(seconds=1), evidence=evidence)
        self.assertEqual((r["decision"], r["rule"], r["pause_until_utc"]), ("pause", 1, "2026-10-03T12:05:00Z"))
        for later in (timedelta(seconds=1), timedelta(hours=24), timedelta(hours=72)):
            r = self.decide(None, now=bound + later, evidence=evidence)
            self.assertEqual((r["decision"], r["rule"]), ("unknown", 3), later)
        # a snapshot captured 06:00 whose reset (07:00) passed before the 07:05 evidence: that reset is not the pause end
        old = snap(five_pct=40.0, captured=clock.parse_utc("2026-10-03T06:00:00Z"),
                   five_resets=clock.parse_utc("2026-10-03T07:00:00Z"))
        r = self.decide(old, now=evidence + timedelta(minutes=10), evidence=evidence)
        self.assertEqual((r["decision"], r["rule"], r["pause_until_utc"]), ("pause", 1, "2026-10-03T12:05:00Z"))

    def test_five_hour_exhausted_snapshot_spent_after_its_reset(self) -> None:
        """Rule 2 pauses until its resets_at; a 100 % reading whose reset has passed no longer pauses."""
        reset = clock.parse_utc(FIVE_RESET)
        r = self.decide(snap(five_pct=100.0), now=reset - timedelta(seconds=1))
        self.assertEqual((r["decision"], r["rule"]), ("pause", 2))  # positive control (stale reading, reset ahead)
        r = self.decide(snap(five_pct=100.0), now=reset + timedelta(seconds=1))
        self.assertEqual((r["decision"], r["rule"]), ("unknown", 3))

    def test_critical_only_override(self) -> None:
        ov = {"mode": "critical-only", "until_utc": SEVEN_RESET, "decision": "D-012"}
        self.assertEqual(self.decide(snap(five_pct=10.0), override=ov)["decision"], "critical-only")


class QuotaCommand(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, self.tmp)
        self.layout = S.state_dir(self.tmp)
        self.snap_path = self.tmp / "usage-snapshot.json"
        profile = S.build_profile()
        profile["quota"]["snapshot_path"] = self.snap_path.as_posix()
        S.write_json(self.layout.profile, profile)

    def write_snapshot(self, **over: object) -> None:
        doc = jsonio.read_json(SNAP)
        for key, value in over.items():
            doc[key] = value
        S.write_json(self.snap_path, doc)

    def run_quota(self, *extra: str) -> tuple[int, dict]:
        code, env, _logs = S.run_exec(["quota", "--state", str(self.layout.state), "--executor", "A", *extra],
                                      self.tmp)
        return code, env

    def event(self, type_: str, data: dict, ts: str) -> None:
        jsonio.append_jsonl(self.layout.events, {"ts": ts, "actor": "hook:stop-failure@A", "type": type_,
                                                 "executor": "A", "seq": 0, "data": data})

    def test_writes_local_state_and_event(self) -> None:
        self.write_snapshot()
        code, env = self.run_quota()
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["decision"], "critical-only")
        self.assertEqual(env["data"]["five_hour"]["resets"]["SGT"], "Sat 3 Oct 16:00 SGT")
        st = jsonio.read_json(self.layout.local_state)
        self.assertTrue(schema.validate(st, "local-state").ok)
        self.assertEqual((st["quota"]["decision"], st["quota"]["snapshot_age_s"]), ("critical-only", 720))
        events = [d for _n, d in jsonio.read_jsonl(self.layout.events) if d.get("type") == "quota"]
        self.assertEqual(len(events), 1)
        self.assertEqual((events[0]["actor"], events[0]["seq"], st["events_seq"]), ("exec:quota@A", 1, 1))

    def test_missing_snapshot_is_unknown_with_a_warning(self) -> None:
        code, env = self.run_quota()
        self.assertEqual((code, env["data"]["decision"]), (0, "unknown"))
        self.assertEqual([w["code"] for w in env["warnings"]], ["W_SNAPSHOT_STALE"])
        self.assertIsNone(env["data"]["five_hour"]["pct"])

    def test_rate_limit_and_null_storm_pause_with_exit_1(self) -> None:
        self.write_snapshot(five_hour={"used_percentage": 40, "resets_at": 1791014400})
        code, env = self.run_quota()
        self.assertEqual((code, env["data"]["decision"]), (0, "normal"))  # positive control
        self.event("stop.failure", {"error": "rate_limit"}, "2026-10-03T07:05:00.000000Z")
        code, env = self.run_quota()
        self.assertEqual((code, env["data"]["decision"], env["data"]["pause_until_utc"]), (1, "pause", FIVE_RESET))
        self.assertEqual(env["errors"][0]["code"], "E_CHECK")
        st = jsonio.read_json(self.layout.local_state)
        self.assertEqual(st["quota"]["limit_evidence_utc"], "2026-10-03T07:05:00Z")

    def test_rate_limit_pause_clears_after_the_five_hour_reset(self) -> None:
        """B03-V1: the evidence kept in local/state.json quota does not pause past the reset (exit 0 after it)."""
        self.write_snapshot(five_hour={"used_percentage": 40, "resets_at": 1791014400})
        self.event("stop.failure", {"error": "rate_limit"}, "2026-10-03T07:05:00.000000Z")
        code, env = self.run_quota("--now", "2026-10-03T07:59:59Z")  # positive control: before the reset
        self.assertEqual((code, env["data"]["decision"], env["data"]["pause_until_utc"]), (1, "pause", FIVE_RESET))
        code, env = self.run_quota("--now", "2026-10-03T08:00:01Z")
        self.assertEqual((code, env["data"]["decision"], env["data"]["pause_until_utc"]), (0, "unknown", None))
        self.assertEqual([w["code"] for w in env["warnings"]], ["W_SNAPSHOT_STALE"])
        code, env = self.run_quota("--now", "2026-10-03T12:00:00Z")
        self.assertEqual((code, env["data"]["decision"]), (0, "unknown"))
        st = jsonio.read_json(self.layout.local_state)
        self.assertEqual(st["quota"]["limit_evidence_utc"], "2026-10-03T07:05:00Z")  # kept, but spent

    def test_unimported_hook_event_counts_and_no_profile_is_not_fatal(self) -> None:
        """H-SF-03: the next `quota` after a rate_limit StopFailure pauses, before `status` imports the hook file."""
        self.write_snapshot(five_hour={"used_percentage": 40, "resets_at": 1791014400})
        hook = {"ts": "2026-10-03T07:08:00.000000Z", "hook": "stop-failure", "session_id": S.SESSION_ID,
                "agent_type": None, "type": "stop.failure", "data": {"error": "rate_limit"}}
        self.assertTrue(schema.validate(hook, "local-state#/$defs/hook_event").ok)
        S.write_json(self.layout.hook_events_dir / "20261003T070800000000Z-1-1.json", hook)
        code, env = self.run_quota()
        self.assertEqual((code, env["data"]["decision"], env["data"]["limit_evidence_utc"]),
                         (1, "pause", "2026-10-03T07:08:00Z"))
        # without a profile the snapshot path is unknown: the evidence still pauses; without evidence: unknown
        self.layout.profile.unlink()
        self.assertEqual(self.run_quota()[0], 1)
        for path in self.layout.hook_events_dir.glob("*.json"):
            path.unlink()
        st = jsonio.read_json(self.layout.local_state)
        st["quota"] = None
        S.write_json(self.layout.local_state, st)
        code, env = self.run_quota()
        self.assertEqual((code, env["data"]["decision"]), (0, "unknown"))

    def test_null_storm_pauses(self) -> None:
        self.write_snapshot(five_hour={"used_percentage": 40, "resets_at": 1791014400})
        jsonio.append_jsonl(self.layout.events, {"ts": "2026-10-03T07:06:00.000000Z", "actor": "exec:wave ingest@A",
                                                 "type": "wave.ingested", "executor": "A", "seq": 0,
                                                 "data": {"wave": "W01", "null_storm": True}})
        code, env = self.run_quota()
        self.assertEqual((code, env["data"]["decision"], env["data"]["rule"]), (1, "pause", 1))

    def test_weekly_short_from_the_schedule_cache(self) -> None:
        self.write_snapshot(five_hour={"used_percentage": 40, "resets_at": 1791014400})
        st = jsonio.read_json(self.layout.local_state)
        st["calibration"]["pct_per_agent_hour"] = 2.5
        S.write_json(self.layout.local_state, st)
        S.write_json(self.layout.schedule_cache, {"quota_projection": {"agent_hours_p80": 10.0,
                                                                      "weekly_pct_needed": 25.0}})
        code, env = self.run_quota()
        self.assertEqual((code, env["data"]["decision"]), (1, "pause"))
        self.assertEqual(env["data"]["projection"]["weekly_pct_needed"], 25.0)
        self.assertEqual(env["data"]["proposal"]["kind"], "quota")


class EventCopyMatchesEventsAppend(unittest.TestCase):
    """Q-B03-1 / B03-V2: until the quota -> events edge exists, `_append_event` must write exactly what
    `events.append` writes (actor with --by agent roles, ts, executor, session id, seq). A drift fails here."""

    def written(self, by: str, use_copy: bool) -> dict:
        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        layout = S.state_dir(tmp)
        ctx = Ctx(layout=paths.layout_for(None, layout.state), executor="A", now=NOW, by=by, pretty=False,
                  command="quota", log=logging.getLogger("tests"))
        data = {"decision": "normal", "rule": None}
        with S.patched_env(CLAUDE_CODE_SESSION_ID="sess-q"), locks.hold(ctx.layout, "state", command="t"):
            return quota._append_event(ctx, "quota", data) if use_copy else events.append(ctx, "quota", data)

    def test_same_roles_and_same_line(self) -> None:
        self.assertEqual(quota.AGENT_ROLES, events.AGENT_ROLES)
        for by in ("orchestrator", "verifier", "planner"):
            mine, theirs = self.written(by, True), self.written(by, False)
            self.assertEqual(mine, theirs, by)
        self.assertEqual(self.written("verifier", True)["actor"], "agent:verifier@A")
        self.assertEqual(self.written("orchestrator", True)["actor"], "exec:quota@A")  # positive control

    def test_refused_without_the_state_lock(self) -> None:
        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        layout = S.state_dir(tmp)
        ctx = Ctx(layout=paths.layout_for(None, layout.state), executor="A", now=NOW, by="orchestrator",
                  pretty=False, command="quota", log=logging.getLogger("tests"))
        with self.assertRaises(quota.InternalError):
            quota._append_event(ctx, "quota", {"decision": "normal", "rule": None})
        with locks.hold(ctx.layout, "state", command="t"):  # positive control
            self.assertEqual(quota._append_event(ctx, "quota", {"decision": "normal", "rule": None})["type"], "quota")


if __name__ == "__main__":
    unittest.main()
