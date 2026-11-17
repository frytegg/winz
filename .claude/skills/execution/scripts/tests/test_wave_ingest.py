"""`exec.py wave ingest` (contract/LANES.md B05, TESTS.md 5.4, CLI.md wave ingest, SCHEMAS.md 4.2 and 4.4).

Protects: outcomes come from files (results and merge receipts of the task's attempt in any wave, proof runs,
receipts), never from the script's return value except the `skipped-dep` and `infra-error` hints; a result that
contradicts its receipt is E_RESULT_RECEIPT_MISMATCH (exit 1) and the receipt wins; DX rows are appended marked
UNVERIFIED and claims rows `unverified` with C-nnn ids, each keyed so a re-ingest appends nothing; calibration is
recomputed; a second ingest changes no byte; an earlier wave's merge receipt is found; skipped-dep -> planned;
infra-error -> blocked-decision with a dependency-missing decision; a verifier (or a gate's verifier) whose agent()
call threw after the landing opens the same decision and keeps the task out of the next wave (a null verifier does
not: control); unreadable journal input is logged, never silent; a null storm is recorded as usage-limit evidence,
a gate whose verifier died included; a prepared in-wave fix attempt is applied in order; an inbox result that fails
its schema stays in the inbox; DX and claims rows land inside the /hackathon tables (pinned templates); a partial
ingest (no --finished) never reruns a task still in flight; fragment receipts are checked against /frontend's schema
and checksum (recomputed as /frontend's own critique.js computes it, run under Node), a missing schema being a
dependency decision; the single-tree shared checkout is re-synced once no wave is live.

Run: python -m unittest discover -s scripts/tests -p "test_wave_ingest.py" -v
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import _support as S
import _support_B04 as B4
import _support_B05 as W

from execlib import jsonio, plan as planmod, schema
from execlib.paths import posix

LATER = "2026-10-03T07:52:00Z"      # 40 minutes after the fixed instant: actual = 40 min for a p50 of 20


class IngestBase(unittest.TestCase):
    def make(self, tasks=None, *, status_tasks=None, ledgers: bool = False) -> W.EmitWorld:
        world = W.EmitWorld(tasks or [S.build_task("T001")],
                            status_tasks=status_tasks or {"T001": S.build_task_status("ready")})
        self.addCleanup(world.cleanup)
        if ledgers:
            prof = jsonio.read_json(world.layout.profile)
            prof["phase_b"] = dict(prof["phase_b"], dx_journal=posix(world.scratch / "dx-journal.md"),
                                   claims_ledger=posix(world.scratch / "claims.md"))
            jsonio.write_json_atomic(world.layout.profile, prof)
        return world

    def emit_launch(self, world: W.EmitWorld, *args: str) -> str:
        code, env, _l = world.emit(*args)
        self.assertEqual(code, 0, env["errors"])
        wid = env["data"]["wave"]
        code, env, _l = world.run(["wave", "launched", "--wave", wid, "--run-id", f"run-{wid}"])
        self.assertEqual(code, 0, env["errors"])
        return wid

    def ingest(self, world: W.EmitWorld, wid: str, *extra: str, now: str | None = LATER):
        return world.run(["wave", "ingest", "--wave", wid, "--finished", *extra], now=now)

    def impl(self, world: W.EmitWorld, tid: str, wave: str, attempt: int, sha: str | None, *, status: str = "built",
             dx: list | None = None, merge_sha: str | None = None) -> Path:
        doc = B4.b01_doc("result-implementer")
        doc.update({"task": tid, "wave": wave, "attempt": attempt, "status": status, "blocked": None,
                    "dx_rows": dx or []})
        doc["merge"] = None if sha is None else {
            "receipt_path": f"local/results/{wave}/{tid}.merge.a{attempt}.json", "outcome": "landed",
            "landed_sha": merge_sha or sha, "exit_code": 0, "error_code": None}
        path = world.layout.result(wave, tid, "implementer", attempt)
        jsonio.write_json_atomic(path, doc)
        return path

    def verifier(self, world: W.EmitWorld, tid: str, wave: str, attempt: int, sha: str, run_id: str, *,
                 verdict: str = "pass", claims: list | None = None) -> Path:
        doc = B4.b01_doc("result-verifier")
        doc.update({"task": tid, "wave": wave, "attempt": attempt, "sha": sha, "run": run_id, "verdict": verdict,
                    "receipt_path": f"proofs/{tid}.json", "receipt_sha256": "f" * 64, "claims_rows": claims or []})
        path = world.layout.result(wave, tid, "verifier", attempt)
        jsonio.write_json_atomic(path, doc)
        return path

    def landed_and_proven(self, world: W.EmitWorld, tid: str, wave: str, attempt: int = 1, *, verdict: str = "pass",
                          dx: list | None = None, claims: list | None = None) -> str:
        sha = world.land(f"src/{tid.lower()}/a{attempt}.ts")
        world.merge_receipt(tid, sha, wave=wave, attempt=attempt)
        self.impl(world, tid, wave, attempt, sha, dx=dx)
        rid = world.proof_run(tid, sha, run_id=f"{tid}-{sha[:8]}-20261003T071200Z-{attempt}",
                              met=verdict == "pass", exit_code=0 if verdict == "pass" else 1)
        world.receipt(tid, sha, rid, attempt=attempt, verdict=verdict,
                      implementer={"commit": sha, "agent_type": "execution-implementer", "agent_id": "agent-i1",
                                   "result": f"proofs/impl/{tid}.a{attempt}.json",
                                   "merge_receipt": f"proofs/merge/{tid}.a{attempt}.json"})
        self.verifier(world, tid, wave, attempt, sha, rid, verdict=verdict, claims=claims)
        return sha

    def snapshot(self, world: W.EmitWorld) -> dict[str, bytes]:
        out = world.tree_bytes()
        for p in sorted(world.scratch.glob("*.md")):
            out["scratch/" + p.name] = p.read_bytes()
        return out


class IngestDoneTest(IngestBase):
    def test_done_with_rows_calibration_and_byte_identical_reingest(self) -> None:
        world = self.make(ledgers=True)
        wid = self.emit_launch(world)
        dx = [{"when_utc": S.FIXED_NOW, "where": "pnpm 9 | lockfile", "tried": "pnpm install --offline",
               "happened": "ERR_PNPM_NO_OFFLINE_TARBALL", "reproduce": "pnpm install --offline", "time_lost_min": 4}]
        claims = [{"claim": "queue position in 3 s", "where": "README.md", "evidence": "proof run T001"}]
        self.landed_and_proven(world, "T001", wid, dx=dx, claims=claims)
        code, env, _l = self.ingest(world, wid)
        self.assertEqual(code, 0, env["errors"])
        data = env["data"]
        self.assertEqual(data["outcomes"], {"T001": "done"})
        self.assertEqual(world.entry("T001")["status"], "done")
        self.assertEqual(data["status"], "ingested")
        self.assertEqual(jsonio.read_json(world.layout.wave_manifest(wid))["status"], "ingested")
        self.assertAlmostEqual(data["calibration"]["code"], 2.0, places=3)
        self.assertEqual(world.local_state()["calibration"]["ratios"]["code"], 2.0)
        journal = (world.scratch / "dx-journal.md").read_text(encoding="utf-8")
        row = [ln for ln in journal.splitlines() if "exec:W01:T001:implementer:a1:0" in ln]
        self.assertEqual(len(row), 1, journal)
        self.assertIn("UNVERIFIED", row[0])
        self.assertIn("execution-implementer T001", row[0])
        self.assertIn("pnpm 9 \\| lockfile", row[0], "a pipe in a cell must be escaped")
        self.assertIn("reproduce: pnpm install --offline", row[0])
        ledger = (world.scratch / "claims.md").read_text(encoding="utf-8")
        crow = [ln for ln in ledger.splitlines() if "exec:W01:T001:verifier:a1:0" in ln]
        self.assertEqual(len(crow), 1)
        self.assertTrue(crow[0].startswith("| C-001 |"), crow[0])
        self.assertIn("| unverified |", crow[0])
        # rows go inside /hackathon's tables (pinned templates), not after the sections that follow them, and the
        # template's empty placeholder row is not kept in a ledger exec.py created
        clines = ledger.split("\n")
        self.assertLess(clines.index(crow[0]), clines.index("## Closing checklist"))
        self.assertTrue(clines[clines.index(crow[0]) - 1].startswith("|---|"), "the claim row left the table")
        self.assertNotIn("| 1 |  |  |  | unverified |", ledger)
        jlines = journal.split("\n")
        self.assertLess(jlines.index(row[0]), jlines.index("## What earns a row"))
        self.assertTrue(jlines[jlines.index(row[0]) - 1].startswith("|---|"), "the DX row left the table")
        self.assertIn("**Mark each row VERIFIED or UNVERIFIED**", journal, "the template's text was not kept")
        before = self.snapshot(world)
        code2, env2, _l = self.ingest(world, wid)
        self.assertEqual(code2, 0, env2["errors"])
        self.assertEqual(env2["data"]["outcomes"], data["outcomes"])
        self.assertEqual(self.snapshot(world), before, "a second ingest changed bytes")

    def test_result_contradicting_its_receipt_is_a_mismatch_and_the_receipt_wins(self) -> None:
        world = self.make()
        wid = self.emit_launch(world)
        sha = world.land("src/t1/x.ts")
        world.merge_receipt("T001", sha, wave=wid)
        self.impl(world, "T001", wid, 1, sha, merge_sha="9" * 40)          # claims another landed SHA
        code, env, _l = self.ingest(world, wid)
        self.assertEqual(code, 1)
        self.assertIn("E_RESULT_RECEIPT_MISMATCH", [e["code"] for e in env["errors"]])
        entry = world.entry("T001")
        self.assertEqual(entry["landed_sha"], sha, "the receipt's SHA must win")
        self.assertEqual(env["data"]["outcomes"]["T001"], "built")
        # positive control: the same evidence without the contradiction is no mismatch
        world2 = self.make()
        wid2 = self.emit_launch(world2)
        sha2 = world2.land("src/t1/y.ts")
        world2.merge_receipt("T001", sha2, wave=wid2)
        self.impl(world2, "T001", wid2, 1, sha2)
        code, env, _l = self.ingest(world2, wid2)
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["mismatches"], [])

    def test_merge_receipt_of_an_earlier_wave_is_found(self) -> None:
        world = self.make([S.build_task("T001"), S.build_task("T002", writes=["src/t2/**"])],
                          status_tasks={"T001": S.build_task_status("ready"), "T002": S.build_task_status("ready")})
        w1 = self.emit_launch(world)
        self.impl(world, "T002", w1, 1, None, status="failed")   # one agent answered: not a null storm
        code, env, _l = self.ingest(world, w1)                    # T001's agents never came back: a rerun
        self.assertFalse(env["data"]["null_storm"])
        self.assertEqual(env["data"]["outcomes"]["T001"], "rerun")
        self.assertEqual(world.entry("T001")["status"], "ready")
        self.assertEqual(world.entry("T001")["reruns"], 1)
        w2 = self.emit_launch(world, "--include", "T001")
        self.assertEqual(w2, "W02")
        sha = world.land("src/t1/late.ts")
        world.merge_receipt("T001", sha, wave=w1)                 # the receipt lands in W01's results
        code, env, _l = self.ingest(world, w2)
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["outcomes"]["T001"], "built")
        self.assertEqual(world.entry("T001")["landed_sha"], sha)


class IngestHintsTest(IngestBase):
    def journal(self, world: W.EmitWorld, wid: str, outcomes: dict, lines: list[str] = ()) -> Path:
        path = world.root / "journal.jsonl"
        rows = [{"type": "log", "text": line} for line in lines]
        rows.append({"type": "result", "value": {"wave": wid, "outcomes": outcomes}})
        S.write_text(path, "".join(json.dumps(r) + "\n" for r in rows))
        return path

    def test_skipped_dep_goes_back_to_planned(self) -> None:
        world = self.make([S.build_task("T001"), S.build_task("T002", deps=("T001",), writes=["src/t2/**"])])
        wid = self.emit_launch(world)
        j = self.journal(world, wid, {"T001": "rerun", "T002": "skipped-dep"})
        code, env, _l = self.ingest(world, wid, "--journal", str(j))
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["outcomes"], {"T001": "rerun", "T002": "skipped-dep"})
        self.assertEqual(world.entry("T002")["status"], "planned")
        self.assertEqual(world.entry("T002")["reruns"], 0, "a skipped dependent is not a rerun")
        self.assertEqual(world.entry("T001")["reruns"], 1)

    def test_infra_error_blocks_with_a_dependency_decision(self) -> None:
        world = self.make()
        wid = self.emit_launch(world)
        j = self.journal(world, wid, {"T001": "infra-error"},
                         ["T001 implementer: agent call threw (infrastructure, not a usage limit): Agent type "
                          "'execution-implementer' not found"])
        code, env, _l = self.ingest(world, wid, "--journal", str(j))
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["outcomes"]["T001"], "infra-error")
        entry = world.entry("T001")
        self.assertEqual(entry["status"], "blocked-decision")
        self.assertEqual(entry["reruns"], 0, "a throw is never a rerun")
        decisions = world.layout.decisions.read_text(encoding="utf-8")
        self.assertIn('"kind":"dependency-missing"', decisions.replace(" ", ""))
        self.assertIn("not found", decisions)

    def test_unreadable_journal_input_is_logged_never_silent(self) -> None:
        """m7, README.md 2 (errors never swallowed): a journal line that is not JSON and a JSON-looking log string
        that does not parse are skipped with a warning; the valid lines are still read."""
        world = self.make()
        wid = self.emit_launch(world)
        path = world.root / "journal.jsonl"
        rows = ["{not json at all",
                json.dumps({"type": "log", "text": '{"wave": "W01", "outcomes": {broken'}),
                json.dumps({"type": "log", "text": self.THREW.format(tid="T001", role="implementer")}),
                json.dumps({"type": "result", "value": {"wave": wid, "outcomes": {"T001": "infra-error"}}})]
        S.write_text(path, "\n".join(rows) + "\n")
        code, env, logs = self.ingest(world, wid, "--journal", str(path))
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["outcomes"]["T001"], "infra-error", "the valid lines were not read")
        warned = [entry["msg"] for entry in logs if str(entry["level"]).lower().startswith("warn")]
        self.assertTrue(any("is not JSON: skipped while reading the script's outcome hints" in m for m in warned),
                        warned)
        self.assertTrue(any("is not JSON: skipped while looking for a thrown agent call" in m for m in warned), warned)
        self.assertTrue(any("does not parse" in m for m in warned), warned)
        # positive control: a clean journal logs none of these
        world2 = self.make()
        wid2 = self.emit_launch(world2)
        clean = self.journal(world2, wid2, {"T001": "infra-error"}, [self.THREW.format(tid="T001", role="implementer")])
        code, env, logs = self.ingest(world2, wid2, "--journal", str(clean))
        self.assertEqual(code, 0, env["errors"])
        self.assertFalse([e for e in logs if "not JSON" in e["msg"] or "does not parse" in e["msg"]], logs)

    THREW = ("{tid} {role}: agent call threw (infrastructure, not a usage limit): Agent type 'execution-{role}' "
             "not found")
    SIX_HOURS_LATER = "2026-10-03T13:52:00Z"          # past any quota pause a null storm opened

    def dependency_decisions(self, world: W.EmitWorld) -> list[dict]:
        from execlib import status

        return [d for d in status.decision_headers(world.layout)
                if d.get("record") == "proposal" and d.get("kind") == "dependency-missing"]

    def test_verifier_throw_after_landing_opens_the_decision(self) -> None:
        """F1, SCHEMAS.md 4.4 "throws are not nulls": the implementer landed and the verifier's agent() call threw.
        The same dependency-missing decision as for an implementer throw (test_infra_error_blocks_with_a_dependency_
        decision, the control of this case) is opened, the task stays built (SCHEMAS.md 4.2 has no built ->
        blocked-decision row, Q-B05-19), and the next wave emit does not relaunch the throwing verifier."""
        world = self.make()
        wid = self.emit_launch(world)
        sha = world.land("src/t1/a.ts")
        world.merge_receipt("T001", sha, wave=wid)
        self.impl(world, "T001", wid, 1, sha)
        j = self.journal(world, wid, {"T001": "infra-error"}, [self.THREW.format(tid="T001", role="verifier")])
        code, env, _l = self.ingest(world, wid, "--journal", str(j))
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["outcomes"]["T001"], "infra-error")
        self.assertFalse(env["data"]["null_storm"])
        entry = world.entry("T001")
        self.assertEqual((entry["status"], entry.get("reruns", 0)), ("built", 0), "a throw is never a rerun")
        props = self.dependency_decisions(world)
        self.assertEqual([p["id"] for p in props], env["data"]["proposals"])
        self.assertEqual(props[0]["tasks"], ["T001"])
        self.assertIn("'execution-verifier' not found", props[0]["title"])
        before = self.snapshot(world)
        code, env2, _l = self.ingest(world, wid, "--journal", str(j))               # converging
        self.assertEqual((code, env2["data"]["outcomes"]["T001"]), (0, "infra-error"))
        self.assertEqual(self.snapshot(world), before, "a second ingest changed bytes")
        code, env3, _l = world.emit()                                                  # held under the decision
        self.assertEqual((code, env3["errors"][0]["code"]), (1, "E_NOTHING_READY"))
        # once the owner resolved it, the verifier-only chain goes again, and re-ingesting the old wave opens nothing
        from execlib import decisions

        with world.locked():
            decisions.resolve(world.ctx("decision resolve"), decision_id=props[0]["id"], choice="fixed", by="devA",
                              source="terminal", quote="agents réinstallés")
        code, env4, _l = self.ingest(world, wid, "--journal", str(j))
        self.assertEqual((code, env4["data"]["proposals"]), (0, []))
        self.assertEqual(len(self.dependency_decisions(world)), 1)
        code, env5, _l = world.emit()
        self.assertEqual(code, 0, env5["errors"])
        self.assertEqual([(t["task"], t["chain"]) for t in env5["data"]["tasks"]], [("T001", ["verifier"])])

    def test_a_dead_verifier_after_landing_is_relaunched(self) -> None:
        """Control of the case above: the same landing whose verifier returned null (no infra-error hint) opens no
        decision and the next wave emit relaunches the verifier-only chain (SCHEMAS.md 4.4: a null is a rerun)."""
        world = self.make()
        wid = self.emit_launch(world)
        sha = world.land("src/t1/a.ts")
        world.merge_receipt("T001", sha, wave=wid)
        self.impl(world, "T001", wid, 1, sha)
        j = self.journal(world, wid, {"T001": "rerun"}, ["T001 verifier: agent returned null (died or hit a usage "
                                                         "limit); the task will be rerun"])
        code, env, _l = self.ingest(world, wid, "--journal", str(j))
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual((env["data"]["outcomes"]["T001"], env["data"]["proposals"]), ("built", []))
        self.assertEqual(self.dependency_decisions(world), [])
        code, env2, _l = world.emit()
        self.assertEqual(code, 0, env2["errors"])
        self.assertEqual([(t["task"], t["chain"]) for t in env2["data"]["tasks"]], [("T001", ["verifier"])])

    def test_gate_verifier_throw_opens_the_decision(self) -> None:
        """F1 for a gate: `wave emit` wrote the gate receipt, the gate's verifier threw. Every agent of the wave threw,
        so it is also a null storm (SCHEMAS.md 4.4); once the quota pause is over the gate still stays out of the
        next wave while the decision is open. Control: a gate whose verifier died (null) is relaunched then."""
        gate_world = NullStormVerifierOnlyTest.gate_world
        world, wid = gate_world(self)
        j = self.journal(world, wid, {"T002": "infra-error"}, [self.THREW.format(tid="T002", role="verifier")])
        code, env, _l = self.ingest(world, wid, "--journal", str(j))
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["outcomes"]["T002"], "infra-error")
        self.assertTrue(env["data"]["null_storm"])
        self.assertEqual(world.entry("T002")["status"], "built")
        props = self.dependency_decisions(world)
        self.assertEqual([p["tasks"] for p in props], [["T002"]])
        code, env2, _l = world.run(["wave", "emit"], now=self.SIX_HOURS_LATER)
        self.assertEqual((code, env2["errors"][0]["code"]), (1, "E_NOTHING_READY"), env2)
        # control: the same gate whose verifier died is relaunched with its verifier-only chain
        world2, wid2 = gate_world(self)
        code, env3, _l = self.ingest(world2, wid2)
        self.assertEqual((env3["data"]["outcomes"]["T002"], env3["data"]["proposals"]), ("built", []))
        code, env4, _l = world2.run(["wave", "emit"], now=self.SIX_HOURS_LATER)
        self.assertEqual(code, 0, env4["errors"])
        self.assertEqual([(t["task"], t["chain"]) for t in env4["data"]["tasks"]], [("T002", ["verifier"])])

    def test_null_storm_is_usage_limit_evidence(self) -> None:
        world = self.make([S.build_task("T001"), S.build_task("T002", writes=["src/t2/**"])],
                          status_tasks={"T001": S.build_task_status("ready"), "T002": S.build_task_status("ready")})
        wid = self.emit_launch(world)
        code, env, _l = self.ingest(world, wid)
        self.assertEqual(code, 0, env["errors"])
        self.assertTrue(env["data"]["null_storm"])
        self.assertEqual(set(env["data"]["outcomes"].values()), {"rerun"})
        storms = [e for e in world.events("error") if e["data"].get("kind") == "usage-limit"]
        self.assertEqual(len(storms), 1)
        self.assertTrue(world.events("wave.ingested")[-1]["data"]["null_storm"])
        # positive control: one agent left a result: not a storm
        world2 = self.make([S.build_task("T001"), S.build_task("T002", writes=["src/t2/**"])],
                           status_tasks={"T001": S.build_task_status("ready"), "T002": S.build_task_status("ready")})
        wid2 = self.emit_launch(world2)
        self.impl(world2, "T001", wid2, 1, None, status="failed")
        code, env, _l = self.ingest(world2, wid2)
        self.assertFalse(env["data"]["null_storm"])
        self.assertEqual(env["data"]["outcomes"]["T001"], "failed")
        self.assertEqual(world2.entry("T001")["status"], "ready", "a failed attempt with budget left goes ready")
        self.assertEqual(world2.entry("T001")["attempts"], 1)


class NullStormVerifierOnlyTest(IngestBase):
    def gate_world(self) -> tuple[W.EmitWorld, str]:
        gate = S.build_task("T002", kind="gate", deps=("T001",), writes=[],
                            proof={"type": "command", "spec": {"cmd": "node check.mjs", "shell": "bash", "cwd": ".",
                                                               "install": False},
                                   "expect": {"summary": "ok", "exit_code": 0}, "max_runtime_min": 2,
                                   "negative_control": {"kind": "forgery", "description": "forged",
                                                        "expect_nonzero": True}})
        world = self.make([S.build_task("T001"), gate],
                          status_tasks={"T001": S.build_task_status("done"), "T002": S.build_task_status("ready")})
        return world, self.emit_launch(world)

    def test_a_dead_verifier_of_a_gate_is_a_null_storm(self) -> None:
        world, wid = self.gate_world()
        # emit wrote the gate's merge receipt: it predates the wave's agents and is not their evidence
        self.assertTrue(world.layout.result(wid, "T002", "merge", 1).is_file())
        code, env, _l = self.ingest(world, wid)
        self.assertTrue(env["data"]["null_storm"], env["data"])
        # positive control: the gate's verifier left its result, so the wave was not silent
        world2, wid2 = self.gate_world()
        sha = world2.repo.git("rev-parse", "origin/main")
        self.verifier(world2, "T002", wid2, 1, sha, f"T002-{sha[:8]}-20261003T071200Z-1")
        code, env, _l = self.ingest(world2, wid2)
        self.assertFalse(env["data"]["null_storm"], env["data"])


class IngestFixAndInboxTest(IngestBase):
    def test_in_wave_fix_attempt_applied_in_order(self) -> None:
        world = self.make()
        wid = self.emit_launch(world)
        self.assertEqual(jsonio.read_json(world.layout.wave_manifest(wid))["tasks"][0]["fix_attempts"], [2])
        sha1 = world.land("src/t1/a1.ts")
        world.merge_receipt("T001", sha1, wave=wid, attempt=1)
        self.impl(world, "T001", wid, 1, sha1)
        # attempt 1's verifier failed it (proof verdict applied running -> built -> verifying -> failed itself)
        world.set_status("T001", "failed", attempts=1, landed_sha=None,
                         history=[{"from": "ready", "to": "running", "at_utc": S.FIXED_NOW, "by": "wave emit",
                                   "evidence": [f"launch-intent:{wid}"]}])
        self.landed_and_proven(world, "T001", wid, attempt=2)
        code, env, _l = self.ingest(world, wid)
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["outcomes"]["T001"], "done")
        hist = [(h["from"], h["to"]) for h in world.entry("T001")["history"]]
        self.assertIn(("failed", "running"), hist)
        self.assertEqual(hist[-1], ("verifying", "done"))
        # positive control: without the attempt-2 evidence the task goes back to ready for a later wave
        world2 = self.make()
        wid2 = self.emit_launch(world2)
        world2.set_status("T001", "failed", attempts=1)
        code, env, _l = self.ingest(world2, wid2)
        self.assertEqual(world2.entry("T001")["status"], "ready")

    def test_inbox_result_failing_its_schema_stays_and_exits_1(self) -> None:
        world = self.make()
        wid = self.emit_launch(world)
        bad = world.layout.inbox(wid) / "T001.implementer.a1.json"
        S.write_text(bad, json.dumps({"schema": "execution.result.implementer/1", "task": "T001"}) + "\n")
        code, env, _l = self.ingest(world, wid)
        self.assertEqual(code, 1)
        self.assertIn("E_SCHEMA", [e["code"] for e in env["errors"]])
        self.assertTrue(bad.is_file(), "a result that fails its schema must stay in the inbox")
        # positive control: a valid result left in the inbox is put and read
        world2 = self.make()
        wid2 = self.emit_launch(world2)
        good = B4.b01_doc("result-implementer")
        good.update({"task": "T001", "wave": wid2, "attempt": 1, "status": "failed", "merge": None, "blocked": None})
        S.write_text(world2.layout.inbox(wid2) / "T001.implementer.a1.json", json.dumps(good) + "\n")
        code, env, _l = self.ingest(world2, wid2)
        self.assertEqual(code, 0, env["errors"])
        self.assertTrue(world2.layout.result(wid2, "T001", "implementer", 1).is_file())
        self.assertEqual(env["data"]["outcomes"]["T001"], "failed")

    def test_journal_recovers_a_result_never_put(self) -> None:
        world = self.make()
        wid = self.emit_launch(world)
        doc = B4.b01_doc("result-implementer")
        doc.update({"task": "T001", "wave": wid, "attempt": 1, "status": "failed", "merge": None, "blocked": None})
        path = world.root / "journal.jsonl"
        S.write_text(path, json.dumps({"type": "agent_result", "label": "T001 implementer", "result": doc}) + "\n")
        code, env, _l = self.ingest(world, wid, "--journal", str(path))
        self.assertEqual(code, 0, env["errors"])
        self.assertTrue(world.layout.result(wid, "T001", "implementer", 1).is_file())
        self.assertEqual(env["data"]["outcomes"]["T001"], "failed")
        self.assertTrue(schema.validate(jsonio.read_json(world.layout.wave_manifest(wid)), "wave-manifest").ok)

    def test_ingest_refuses_an_unlaunched_wave(self) -> None:
        world = self.make()
        code, env, _l = world.emit()
        self.assertEqual(code, 0)
        code, env, _l = self.ingest(world, env["data"]["wave"])
        self.assertEqual(code, 2)
        self.assertEqual(env["errors"][0]["code"], "E_USAGE")
        _ = planmod


class ResyncTest(IngestBase):
    def test_single_tree_checkout_is_resynced_after_the_last_live_wave(self) -> None:
        """CLI.md `merge`, shared checkout re-sync: a single-tree merge pushes a commit built from the checkout's
        files and leaves the checkout's branch behind; once no wave of the executor runs, ingest moves the branch
        and the index to origin/main (`reset --mixed`), so the landed files read as clean and nothing is touched."""
        import subprocess

        world = self.make()
        wid = self.emit_launch(world)
        rel, text = "src/t1/landed.ts", "export const landed = 1;\n"
        S.write_text(world.path / rel, text)                          # the agent's file in the shared checkout
        # what `merge --single-tree` does (CLI.md merge step 2): a commit from a temporary index, pushed
        idx = S.mkdtemp()
        self.addCleanup(S.rmtree, idx)
        env = dict(S.env_isolated(), GIT_INDEX_FILE=str(idx / "index"))

        def git(*args: str) -> str:
            proc = subprocess.run(["git", *args], cwd=str(world.path), env=env, capture_output=True, timeout=60)
            self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
            return proc.stdout.decode("utf-8").strip()

        git("read-tree", "origin/main")
        git("update-index", "--add", "--", rel)
        tree = git("write-tree")
        sha = git("commit-tree", tree, "-p", "origin/main", "-m", "feat(t1): land from the temporary index")
        git("push", "--quiet", "origin", f"{sha}:refs/heads/main")
        world.merge_receipt("T001", sha, wave=wid)
        before_head = world.repo.git("rev-parse", "HEAD")
        code, env, _l = self.ingest(world, wid)
        self.assertEqual(code, 0, env["errors"])
        resync = env["data"]["resync"]
        self.assertTrue(resync["moved"], resync)
        self.assertEqual((resync["from"], resync["to"]), (before_head, sha))
        self.assertEqual(world.repo.git("rev-parse", "HEAD"), sha)
        self.assertEqual(world.repo.git("status", "--porcelain", "--untracked-files=all"), "")
        self.assertEqual((world.path / rel).read_text(encoding="utf-8"), text, "a file of the checkout was touched")
        # positive control of the guard: with a wave still live nothing is moved
        lanes = [{"id": "L0", "executor": "A", "title": "Contract", "globs": ["package.json"], "contract": True},
                 {"id": "L1", "executor": "A", "title": "Engine", "globs": ["src/**"], "contract": False},
                 {"id": "L2", "executor": "A", "title": "Cli", "globs": ["cli/**"], "contract": False}]
        world2 = W.EmitWorld([S.build_task("T001"), S.build_task("T002", writes=["cli/t2/**"], lane="L2")],
                             status_tasks={"T001": S.build_task_status("ready"),
                                           "T002": S.build_task_status("ready")},
                             plan_over={"lanes": lanes}, governor=W.governor_block(lanes=6, verifiers=4))
        self.addCleanup(world2.cleanup)
        w1 = self.emit_launch(world2, "--include", "T001")
        self.emit_launch(world2, "--include", "T002")
        code, env, _l = self.ingest(world2, w1)
        self.assertIsNone(env["data"]["resync"], "the checkout was re-synced while another wave was live")


class IngestPartialTest(IngestBase):
    def test_partial_ingest_never_reruns_a_task_still_in_flight(self) -> None:
        world = self.make()
        wid = self.emit_launch(world)
        code, env, _l = world.run(["wave", "ingest", "--wave", wid], now=LATER)          # no --finished
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual((env["data"]["outcomes"], env["data"]["running"]), ({}, ["T001"]))
        self.assertFalse(env["data"]["null_storm"], "a wave still running is no null storm")
        self.assertEqual(world.entry("T001")["status"], "running")
        self.assertEqual(world.entry("T001").get("reruns", 0), 0)
        self.assertEqual(jsonio.read_json(world.layout.wave_manifest(wid))["status"], "launched")
        # evidence on disk is applied by a partial ingest all the same
        sha = world.land("src/t1/partial.ts")
        world.merge_receipt("T001", sha, wave=wid)
        code, env, _l = world.run(["wave", "ingest", "--wave", wid], now=LATER)
        self.assertEqual(code, 0, env["errors"])
        self.assertEqual(env["data"]["outcomes"], {"T001": "built"})
        # positive control: once the wave is over, a task that left no file is a rerun
        world2 = self.make()
        wid2 = self.emit_launch(world2)
        code, env, _l = self.ingest(world2, wid2)
        self.assertEqual(env["data"]["outcomes"], {"T001": "rerun"})
        self.assertEqual(env["data"]["running"], [])

    def test_partial_ingest_keeps_a_failed_task_for_its_prepared_fix(self) -> None:
        world = self.make()
        wid = self.emit_launch(world)
        world.set_status("T001", "failed", attempts=1)
        code, env, _l = world.run(["wave", "ingest", "--wave", wid], now=LATER)
        self.assertEqual(env["data"]["running"], ["T001"])
        self.assertEqual(world.entry("T001")["status"], "failed", "the in-wave fix attempt 2 may still run")
        self.assertEqual(jsonio.read_json(world.layout.wave_manifest(wid))["status"], "launched")
        code, env, _l = self.ingest(world, wid)                                        # finished: back to ready
        self.assertEqual(world.entry("T001")["status"], "ready")


REAL_RECEIPT_MJS = "\n".join([
    "import { readFileSync } from 'node:fs';",
    "const src = readFileSync(process.argv[2], 'utf8');",
    "const input = JSON.parse(readFileSync(process.argv[3], 'utf8'));",
    "const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;",
    "const run = new AsyncFunction('api', 'input', src + String.fromCharCode(10) + 'return await feCritique(api, input);');",
    "const api = {agent: async () => null, parallel: async (t) => Promise.all(t.map((f) => f())),",
    "  pipeline: async () => [], log: () => {}};",
    "const receipt = await run(api, input);",
    "process.stdout.write(JSON.stringify(receipt, null, 2) + String.fromCharCode(10));",
    ""])


@unittest.skipUnless(W.node_available(), "node is needed")
class FragmentReceiptTest(IngestBase):
    """FRONTEND.md 9.4: the receipt copy in the inbox, against /frontend's schema and its own checksum, which is
    recomputed here as /frontend's real critique.js (pinned copy) computes it."""

    def real_receipt(self, tmp: Path, task: str) -> dict:
        script = S.write_text(tmp / "receipt.mjs", REAL_RECEIPT_MJS)
        inp = S.write_text(tmp / "input.json", json.dumps({"task": task}) + "\n")       # cwd/state/profile missing
        import subprocess
        proc = subprocess.run([W.NODE or "node", str(script), str(W.REAL_FRAGMENTS["feCritique"]), str(inp)],
                              capture_output=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        return json.loads(proc.stdout.decode("utf-8"))

    def fe_world(self, **kw) -> tuple[W.EmitWorld, str]:
        world = W.EmitWorld([W.fe_task("T001", "feCritique")],
                            status_tasks={"T001": S.build_task_status("ready")}, **kw)
        self.addCleanup(world.cleanup)
        return world, self.emit_launch(world)

    def put_copy(self, world: W.EmitWorld, wid: str, receipt: dict) -> Path:
        return S.write_text(world.layout.inbox(wid) / "T001.fe-critique.a1r0.json",
                            json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")

    def test_checksum_agrees_with_frontend_and_tampering_is_caught(self) -> None:
        from execlib import wave

        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        receipt = self.real_receipt(tmp, "T001")
        self.assertEqual(receipt["stop_reason"], "error")
        unsealed = {k: v for k, v in receipt.items() if k != "checksum"}
        self.assertEqual("fnv1a32:" + wave.fnv1a32(wave.js_stringify(unsealed)), receipt["checksum"],
                         "our recomputation differs from /frontend's own seal()")
        world, wid = self.fe_world()
        self.put_copy(world, wid, receipt)
        S.write_text(world.layout.state / "frontend" / "critique" / "receipt.json", json.dumps(receipt) + "\n")
        code, env, _l = self.ingest(world, wid)
        self.assertEqual(code, 0, env["errors"])                                        # positive control
        self.assertEqual(env["data"]["mismatches"], [])
        # the same copy with one field changed and the checksum left as it was
        world2, wid2 = self.fe_world()
        forged = dict(receipt, task="T001 forged")
        self.put_copy(world2, wid2, forged)
        S.write_text(world2.layout.state / "frontend" / "critique" / "receipt.json", json.dumps(receipt) + "\n")
        code, env, _l = self.ingest(world2, wid2)
        self.assertEqual(code, 1)
        self.assertEqual([m["code"] for m in env["data"]["mismatches"]], ["E_RESULT_RECEIPT_MISMATCH"])
        # a valid copy whose fragment-written receipt says something else
        world3, wid3 = self.fe_world()
        self.put_copy(world3, wid3, receipt)
        S.write_text(world3.layout.state / "frontend" / "critique" / "receipt.json",
                     json.dumps(dict(receipt, checksum="fnv1a32:00000000")) + "\n")
        code, env, _l = self.ingest(world3, wid3)
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_RESULT_RECEIPT_MISMATCH"))

    def test_schema_failure_and_missing_schema(self) -> None:
        world, wid = self.fe_world()
        self.put_copy(world, wid, {"fragment": "feCritique", "ok": True})
        code, env, _l = self.ingest(world, wid)
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_RESULT_RECEIPT_MISMATCH"))
        self.assertIn("critique-receipt.schema.json", env["errors"][0]["message"])
        # /frontend's receipt schema absent: never a silent pass, a dependency decision for the owner
        world2, wid2 = self.fe_world(skills=W.SkillsHome(receipt_schemas=False))
        self.put_copy(world2, wid2, {"fragment": "feCritique", "ok": True})
        code, env, _l = self.ingest(world2, wid2)
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_DEPENDENCY_MISSING"))
        self.assertEqual(len(env["data"]["proposals"]), 1)
        self.assertIn("dependency-missing", world2.layout.decisions.read_text(encoding="utf-8"))
        before = self.snapshot(world2)
        self.ingest(world2, wid2)                                                       # converging
        self.assertEqual(self.snapshot(world2), before)


@unittest.skipUnless(W.node_available(), "node is needed")
class JsStringifyTest(unittest.TestCase):
    def test_python_and_node_agree(self) -> None:
        """`wave.js_stringify` and `fnv1a32` against Node's JSON.stringify and charCodeAt (numbers in both
        notations, non-ASCII and astral characters, nested key order)."""
        from execlib import wave

        doc = {"z": [0.1, 1e-7, 2.5e-05, 1e21, 1.5e21, 123.456, -0.5, 1e16, 100.0, 0, -3, 0.001],
               "a": {"b": "é…→ 🙂 \" \\ tab\there", "c": None, "d": True, "e": [False, {}]}, "m": "x"}
        tmp = S.mkdtemp()
        self.addCleanup(S.rmtree, tmp)
        data = S.write_text(tmp / "doc.json", json.dumps(doc, ensure_ascii=False) + "\n")
        js = S.write_text(tmp / "s.mjs", "\n".join([
            "import { readFileSync } from 'node:fs';",
            "const s = JSON.stringify(JSON.parse(readFileSync(process.argv[2], 'utf8')));",
            "let h = 0x811c9dc5;",
            "for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }",
            "process.stdout.write(JSON.stringify({s, h: ('00000000' + h.toString(16)).slice(-8)}));", ""]))
        import subprocess
        proc = subprocess.run([W.NODE or "node", str(js), str(data)], capture_output=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        node = json.loads(proc.stdout.decode("utf-8"))
        ours = wave.js_stringify(json.loads(data.read_text(encoding="utf-8")))
        self.assertEqual(ours, node["s"])
        self.assertEqual(wave.fnv1a32(ours), node["h"])
        self.assertNotEqual(wave.fnv1a32(ours + " "), node["h"])                      # positive control


if __name__ == "__main__":
    unittest.main()
