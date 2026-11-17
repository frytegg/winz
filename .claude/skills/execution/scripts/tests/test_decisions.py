"""Decision proposals and resolutions (contract/CLI.md `decision propose|resolve`, SCHEMAS.md 8, TWO-DEV.md 1.3,
TESTS.md 3.7, LANES.md B04).

Run: python -m unittest discover -s scripts/tests -p "test_decisions.py" -v
"""
from __future__ import annotations

import json
import shlex
import unittest
from pathlib import Path
from unittest import mock

import _support as S
from _support_B04 import B04_FIXTURES, World

from execlib import decisions, decisionsio, paths, plan as planmod, reconcile, status
from execlib.errors import InternalError, PolicyRefused


def options_file(w: World, options: list[dict]) -> str:
    return str(S.write_json(w.root / "inputs" / "options.json", options))


CUT_OPTIONS = [{"id": "cut", "label": "Couper", "consequence": "coupée", "effects": [{"op": "cut-tasks"}]},
               {"id": "keep", "label": "Garder", "consequence": "gardée", "effects": [{"op": "restore-tasks"}]}]


class Propose(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset()

    def test_dedup_returns_the_open_proposal(self) -> None:
        args = ["decision", "propose", "--kind", "other", "--title", "Choix du port", "--task", "T001"]
        code, env, _l = self.w.run(args)
        self.assertEqual(code, 0, env)
        self.assertEqual((env["data"]["id"], env["data"]["deduplicated"]), ("D-001", False))
        self.assertIn("D-001", env["data"]["push_text_fr"])
        self.assertLessEqual(len(env["data"]["push_text_fr"]), 200)
        code, env, _l = self.w.run(args)
        self.assertEqual((env["data"]["id"], env["data"]["deduplicated"]), ("D-001", True))
        code, env, _l = self.w.run(["decision", "propose", "--kind", "other", "--title", "Autre", "--task", "T001"])
        self.assertEqual(env["data"]["id"], "D-002")  # positive control: another title is a new proposal
        self.assertEqual(len(decisionsio.open_proposals(self.w.layout)), 2)
        self.assertIn("D-001", [a["ref"] for a in self.w.local_state()["awaiting"]])

    def test_ids_per_executor_after_a_union_merge(self) -> None:
        w = self.w
        b = World(executor="B")
        self.addCleanup(b.cleanup)
        for world, ex in ((w, "A"), (b, "B")):
            with world.locked():
                decisions.propose(world.ctx("decision propose", executor=ex), kind="other", title=f"from {ex}",
                                  options=decisions.default_options("other"), tasks=[], deadline=None,
                                  recommended=None)
        a_text = w.layout.decisions.read_text(encoding="utf-8")
        b_text = b.layout.decisions.read_text(encoding="utf-8")
        S.write_text(w.layout.decisions, a_text + b_text)  # what merge=union produces
        ids = sorted(d["id"] for d in decisionsio.read_blocks(w.layout))
        self.assertEqual(ids, ["D-001", "D-500"])
        self.assertEqual(decisionsio.next_id(w.layout, "A"), "D-002")
        self.assertEqual(decisionsio.next_id(w.layout, "B"), "D-501")

    def test_cut_moves_tasks_to_cut_proposed(self) -> None:
        w = self.w
        w.set_status("T001", "ready")
        code, env, _l = w.run(["decision", "propose", "--kind", "cut", "--title", "Couper T001", "--task", "T001",
                               "--options-file", options_file(w, CUT_OPTIONS)])
        self.assertEqual(code, 0, env)
        entry = w.entry("T001")
        self.assertEqual((entry["status"], entry["previous_status"], entry["decision"]),
                         ("cut-proposed", "ready", env["data"]["id"]))


class Resolve(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset()

    def _propose(self, kind: str, options: list[dict] | None = None, tasks: tuple[str, ...] = ("T001",)) -> str:
        args = ["decision", "propose", "--kind", kind, "--title", f"{kind} test"]
        for t in tasks:
            args += ["--task", t]
        if options is not None:
            args += ["--options-file", options_file(self.w, options)]
        code, env, _l = self.w.run(args)
        self.assertEqual(code, 0, env)
        return env["data"]["id"]

    def _resolve(self, did: str, choice: str, by: str = "devA", quote: str = "ok, vas-y") -> tuple[int, dict]:
        cf = self.w.text_file("choice.txt", choice + "\n")
        qf = self.w.text_file("quote.txt", quote)
        code, env, _l = self.w.run(["decision", "resolve", "--id", did, "--choice-file", str(cf), "--by", by,
                                    "--source", "terminal", "--quote-file", str(qf)])
        return code, env

    def test_second_resolution_is_refused(self) -> None:
        did = self._propose("other")
        code, env = self._resolve(did, "go")
        self.assertEqual(code, 0, env)
        code, env = self._resolve(did, "stop")
        self.assertEqual((code, env["errors"][0]["code"]), (4, "E_DECISION_RESOLVED"))

    def test_owner_only_kinds_need_dev_a(self) -> None:
        did = self._propose("policy-exception")
        for by in ("devB", "owner"):
            code, env = self._resolve(did, "go", by=by)
            self.assertEqual((code, env["errors"][0]["code"]), (4, "E_POLICY"), by)
        with self.w.locked():
            with self.assertRaises(PolicyRefused):
                decisions.resolve(self.w.ctx("decision resolve"), decision_id=did, choice="go", by="exec@A",
                                  source="terminal", quote="x")
        code, env = self._resolve(did, "go", by="devA")  # positive control
        self.assertEqual(code, 0, env)
        # a non owner-only kind accepts dev B
        other = self._propose("other", tasks=("T002",))
        self.assertEqual(self._resolve(other, "go", by="devB")[0], 0)

    def test_choice_must_be_an_option_id(self) -> None:
        did = self._propose("other")
        before = self.w.layout.decisions.read_bytes()
        code, env = self._resolve(did, "approve; rm -rf x")
        self.assertEqual(code, 1, env)
        code, env = self._resolve(did, "maybe")
        self.assertEqual(code, 1, env)
        self.assertEqual(self.w.layout.decisions.read_bytes(), before)
        self.assertEqual(self._resolve(did, "go")[0], 0)

    def test_quote_is_stored_verbatim_and_never_executed(self) -> None:
        did = self._propose("other")
        marker = self.w.root / "pwned"
        quote = f"ok --> `whoami` $(touch {marker.as_posix()}) ; fin"
        code, env = self._resolve(did, "go", quote=quote)
        self.assertEqual(code, 0, env)
        _p, res = decisionsio.find(self.w.layout, did)
        self.assertEqual(res["quote"], quote)
        self.assertFalse(marker.exists())
        self.assertEqual(len(decisionsio.read_blocks(self.w.layout)), 2)

    def test_approve_plan_sets_approved_with_the_digest(self) -> None:
        w = self.w
        w.reset([S.build_task("T001", kind="decision", template="execution:EX-APPROVE")], approved=False,
                run_state="AWAIT_APPROVAL")
        opts = [{"id": "approve", "label": "Approuver le plan", "consequence": "le build démarre",
                 "effects": [{"op": "approve-plan"}]},
                {"id": "revise", "label": "Revoir", "consequence": "nouveau plan", "effects": [{"op": "none"}]}]
        did = self._propose("approval", opts)
        with w.locked():
            doc = status.statusio.load(w.layout, "A")
            status.transition(w.ctx("plan instantiate"), doc, w.task("T001"), "running", evidence=[f"decision:{did}"])
            status.statusio.save(w.ctx("plan instantiate"), doc)
        code, env = self._resolve(did, "approve")
        self.assertEqual(code, 0, env)
        raw = planmod.load_raw(w.layout)
        self.assertEqual(raw["approved"]["plan_sha256"], planmod.plan_digest(raw))
        self.assertEqual((raw["approved"]["decision"], raw["approved"]["by"]), (did, "devA"))
        self.assertEqual(w.local_state()["run_state"], "RUNNING")
        self.assertEqual(w.entry("T001")["status"], "done")
        self.assertIn("approve-plan", env["data"]["effects_applied"])

    def test_cut_then_cut_or_restore(self) -> None:
        w = self.w
        w.set_status("T001", "ready")
        did = self._propose("cut", CUT_OPTIONS)
        code, env = self._resolve(did, "cut")
        self.assertEqual(code, 0, env)
        self.assertEqual(w.entry("T001")["status"], "cut")
        w.set_status("T002", "planned")
        did2 = self._propose("cut", CUT_OPTIONS, tasks=("T002",))
        self.assertEqual(w.entry("T002")["status"], "cut-proposed")
        code, env = self._resolve(did2, "keep")
        self.assertEqual(code, 0, env)
        self.assertEqual(w.entry("T002")["status"], "planned")
        self.assertIsNone(w.entry("T002")["previous_status"])

    def test_unblock_effect(self) -> None:
        w = self.w
        did = self._propose("dependency-missing")
        w.set_status("T001", "blocked-decision", decision=did, blocked={"kind": "dependency", "reason": "x"})
        code, env = self._resolve(did, "fixed")
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["unblocked"], ["T001"])
        self.assertEqual(w.entry("T001")["status"], "ready")

    def test_amend_and_policy_patch_only_return_commands(self) -> None:
        """The effects only print the command to run (CLI.md `decision resolve`). Contract revision 3 (README.md 10):
        a printed command names its state files absolutely, after this machine's exec.py command, so it runs as
        printed from the product repo root (the orchestrator's working directory), where the effect's state-relative
        `local/...` names nothing."""
        w = self.w
        opts = [{"id": "amend", "label": "Amender", "consequence": "c",
                 "effects": [{"op": "amend", "patch": "local/patch.json"}]},
                {"id": "policy", "label": "Politique", "consequence": "c",
                 "effects": [{"op": "policy-patch", "patch": "local/policy.patch.json"}]}]
        patches = {rel: S.write_json(w.layout.state / rel, {"ops": []})
                   for rel in ("local/patch.json", "local/policy.patch.json")}
        before = w.layout.plan.read_bytes()
        printed: dict[str, tuple[str, str]] = {}
        for choice in ("amend", "policy"):
            did = self._propose("amendment", opts)
            code, env = self._resolve(did, choice)
            self.assertEqual(code, 0, env)
            lines = [n for n in env["data"]["next"] if " --patch " in n]
            self.assertEqual(len(lines), 1, env["data"]["next"])
            printed[choice] = (did, lines[0])
        quoted = {rel: f'"{paths.posix(p.resolve())}"' for rel, p in patches.items()}
        did, line = printed["amend"]
        self.assertEqual(line, f"{paths.exec_cmd()} amend --decision {did} --patch {quoted['local/patch.json']}")
        did, line = printed["policy"]
        policy = quoted["local/policy.patch.json"]
        self.assertEqual(line, f"{paths.exec_cmd()} ingest --patch {policy} --decision {did}")
        for choice, rel in (("amend", "local/patch.json"), ("policy", "local/policy.patch.json")):
            argv = shlex.split(printed[choice][1])
            named = Path(argv[argv.index("--patch") + 1])
            self.assertTrue(named.is_absolute() and named.is_file(), argv)  # the same file from any directory
            self.assertFalse((w.path / rel).exists())  # control: the relative form names nothing from the repo root
        self.assertEqual(w.layout.plan.read_bytes(), before)

    def test_quota_override_lands_in_local_state_and_is_rebuilt_by_replay(self) -> None:
        w = self.w
        did = self._propose("quota", None, tasks=())
        code, env = self._resolve(did, "extra-usage")
        self.assertEqual(code, 0, env)
        override = w.local_state()["quota"]["override"]
        self.assertEqual((override["mode"], override["decision"]), ("extra-usage", did))
        st = w.local_state()
        st["quota"]["override"] = None
        w.write_local_state(st)
        code, env, _l = w.run(["events", "replay", "--rebuild-state"])
        self.assertEqual(code, 0, env)
        self.assertEqual(w.local_state()["quota"]["override"], override)

    def test_resolve_from_a_notion_fetch_result(self) -> None:
        w = self.w
        did = self._propose("other")
        fetch = {"metadata": {"type": "page"}, "properties": {"Clé": did, "Décision": "go",
                                                              "Réponse": "Oui, on y va.", "Responsable": "Dev A"}}
        path = S.write_text(w.root / "inputs" / "fetch.txt",
                            "<page url=\"x\">\n<properties>\n" + json.dumps(fetch["properties"], ensure_ascii=False)
                            + "\n</properties>\n</page>\n")
        code, env, _l = w.run(["decision", "resolve", "--id", did, "--from-notion", str(path), "--by", "devA"])
        self.assertEqual(code, 0, env)
        _p, res = decisionsio.find(w.layout, did)
        self.assertEqual((res["choice"], res["source"], res["quote"]), ("go", "notion", "Oui, on y va."))
        queue = [json.loads(ln) for ln in (w.layout.local / "notion" / "queue.jsonl").read_text(
            encoding="utf-8").splitlines()]
        self.assertEqual(queue[-1]["properties"], {"Ingérée": "__YES__"})
        # another row's fetch result is refused
        other = self._propose("other", tasks=("T002",))
        code, env, _l = w.run(["decision", "resolve", "--id", other, "--from-notion", str(path), "--by", "devA"])
        self.assertEqual(code, 1, env)

    def test_other_range_is_refused(self) -> None:
        w = self.w
        with w.locked():
            decisionsio.append_block(w.ctx("decision propose", executor="B"), {
                "schema": "execution.decision/1", "record": "proposal", "id": "D-500", "at_utc": S.FIXED_NOW,
                "by": "exec@B", "kind": "other", "title": "B's", "tasks": [], "deadline_utc": None,
                "options": decisions.default_options("other"), "dedup": "0" * 64}, "b")
        code, env = self._resolve("D-500", "go")
        self.assertEqual((code, env["errors"][0]["code"]), (4, "E_POLICY"))


class CrashRecovery(unittest.TestCase):
    """A resolution whose effects failed after its block was appended (verifier finding F4): the intent file left
    behind makes the next `status` apply them, once, as `decision resolve`."""

    def setUp(self) -> None:
        self.w = World()
        self.addCleanup(self.w.cleanup)

    def _propose(self, kind: str, options: list[dict] | None = None, tasks: tuple[str, ...] = ("T001",)) -> str:
        args = ["decision", "propose", "--kind", kind, "--title", f"{kind} test"]
        for t in tasks:
            args += ["--task", t]
        if options is not None:
            args += ["--options-file", options_file(self.w, options)]
        code, env, _l = self.w.run(args)
        self.assertEqual(code, 0, env)
        return env["data"]["id"]

    def _resolved_events(self, did: str) -> list[dict]:
        return [e for e in self.w.events("decision.resolved") if e["data"]["id"] == did]

    def test_unblock_lost_in_a_crash_is_applied_by_the_next_status(self) -> None:
        w = self.w
        did = self._propose("dependency-missing")
        w.set_status("T001", "blocked-decision", decision=did, blocked={"kind": "dependency", "reason": "x"})
        with w.locked(), mock.patch.object(status, "transition", side_effect=InternalError("disk gone")):
            with self.assertRaises(InternalError):
                decisions.resolve(w.ctx("decision resolve"), decision_id=did, choice="fixed", by="devA",
                                  source="terminal", quote="c'est réparé")
        self.assertIsNotNone(decisionsio.find(w.layout, did)[1])  # the block was written
        self.assertEqual(w.entry("T001")["status"], "blocked-decision")  # its effect was not
        self.assertEqual(decisions.pending_intents(w.layout), [did])
        self.assertEqual(self._resolved_events(did), [])
        cf, qf = w.text_file("choice.txt", "fixed\n"), w.text_file("quote.txt", "encore")
        code, env, _l = w.run(["decision", "resolve", "--id", did, "--choice-file", str(cf), "--by", "devA",
                               "--source", "terminal", "--quote-file", str(qf)])
        self.assertEqual((code, env["errors"][0]["code"]), (4, "E_DECISION_RESOLVED"))
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        done = env["data"]["reconciled"]["decisions_completed"]
        self.assertEqual([(d["id"], d["action"], d["unblocked"]) for d in done], [(did, "applied", ["T001"])])
        self.assertEqual(w.entry("T001")["status"], "ready")
        self.assertEqual(w.entry("T001")["history"][-1]["by"], "decision resolve")
        self.assertEqual(decisions.pending_intents(w.layout), [])
        self.assertEqual([e["data"].get("recovered") for e in self._resolved_events(did)], [True])
        code, env, _l = w.run(["status"])  # idempotent: nothing left to apply, no second event
        self.assertEqual((code, env["data"]["reconciled"]["decisions_completed"]), (0, []))
        self.assertEqual(len(self._resolved_events(did)), 1)

    def test_a_normal_resolution_leaves_no_intent(self) -> None:
        w = self.w
        did = self._propose("dependency-missing")
        w.set_status("T001", "blocked-decision", decision=did, blocked={"kind": "dependency", "reason": "x"})
        cf, qf = w.text_file("choice.txt", "fixed\n"), w.text_file("quote.txt", "ok")
        code, env, _l = w.run(["decision", "resolve", "--id", did, "--choice-file", str(cf), "--by", "devA",
                               "--source", "terminal", "--quote-file", str(qf)])
        self.assertEqual(code, 0, env)
        self.assertEqual(decisions.pending_intents(w.layout), [])
        self.assertEqual([e["data"].get("recovered") for e in self._resolved_events(did)], [None])

    def test_approve_plan_lost_in_a_crash_is_applied_under_the_plan_lock(self) -> None:
        w = self.w
        w.reset([S.build_task("T001", kind="decision", template="execution:EX-APPROVE")], approved=False,
                run_state="AWAIT_APPROVAL")
        opts = [{"id": "approve", "label": "Approuver", "consequence": "c", "effects": [{"op": "approve-plan"}]},
                {"id": "revise", "label": "Revoir", "consequence": "c", "effects": [{"op": "none"}]}]
        did = self._propose("approval", opts)
        with w.locked("plan", "state"), mock.patch.object(planmod, "save", side_effect=InternalError("crash")):
            with self.assertRaises(InternalError):
                decisions.resolve(w.ctx("decision resolve"), decision_id=did, choice="approve", by="devA",
                                  source="terminal", quote="j'approuve")
        self.assertIsNone(planmod.load_raw(w.layout).get("approved"))
        self.assertTrue(decisions.pending_needs_plan_lock(w.layout))
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        raw = planmod.load_raw(w.layout)
        self.assertEqual((raw["approved"]["decision"], raw["approved"]["plan_sha256"]),
                         (did, planmod.plan_digest(raw)))
        self.assertEqual(decisions.pending_intents(w.layout), [])

    def test_an_intent_without_its_resolution_is_dropped(self) -> None:
        w = self.w
        did = self._propose("other")
        S.write_json(decisions.intent_path(w.layout, did), {"id": did, "choice": "go", "at_utc": S.FIXED_NOW})
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["reconciled"]["decisions_completed"], [{"id": did, "action": "dropped"}])
        self.assertIsNone(decisionsio.find(w.layout, did)[1])  # still open: it can be resolved
        cf, qf = w.text_file("choice.txt", "go\n"), w.text_file("quote.txt", "ok")
        code, env, _l = w.run(["decision", "resolve", "--id", did, "--choice-file", str(cf), "--by", "devA",
                               "--source", "terminal", "--quote-file", str(qf)])
        self.assertEqual(code, 0, env)


class BoundedRecovery(unittest.TestCase):
    """Verify-3 m3: `status` retries a half-applied resolution at most MAX_EFFECT_ATTEMPTS times, a bug in an effect
    (any exception, not only ExecError) fails the try and never the `status` command, and the intent is then parked
    behind an owner decision (retry or drop)."""

    def setUp(self) -> None:
        self.w = World()
        self.addCleanup(self.w.cleanup)
        w = self.w
        code, env, _l = w.run(["decision", "propose", "--kind", "dependency-missing", "--title", "dep", "--task",
                               "T001"])
        self.assertEqual(code, 0, env)
        self.did = env["data"]["id"]
        w.set_status("T001", "blocked-decision", decision=self.did, blocked={"kind": "dependency", "reason": "x"})
        with w.locked(), mock.patch.object(status, "transition", side_effect=InternalError("disk gone")):
            with self.assertRaises(InternalError):
                decisions.resolve(w.ctx("decision resolve"), decision_id=self.did, choice="fixed", by="devA",
                                  source="terminal", quote="c'est réparé")
        self.assertEqual(decisions.pending_intents(w.layout), [self.did])

    def _tick(self, side_effect: object) -> tuple[list[dict], mock.MagicMock]:
        with self.w.locked(), mock.patch.object(decisions, "apply_resolution", side_effect=side_effect) as fake:
            return decisions.complete_pending(self.w.ctx("status")), fake

    def _intent(self) -> dict:
        return json.loads(decisions.intent_path(self.w.layout, self.did).read_text(encoding="utf-8"))

    def _resolve(self, did: str, choice: str) -> None:
        cf, qf = self.w.text_file("choice.txt", choice + "\n"), self.w.text_file("quote.txt", choice)
        code, env, _l = self.w.run(["decision", "resolve", "--id", did, "--choice-file", str(cf), "--by", "devA",
                                    "--source", "terminal", "--quote-file", str(qf)])
        self.assertEqual(code, 0, env)

    def _park_with_a_bug(self) -> str:
        seen: list[int] = []

        def bug(*_a: object, **_k: object) -> dict:
            seen.append(self._intent()["attempts"])  # the try is counted before the effects run (a crash counts)
            raise KeyError("effects")

        outs = [self._tick(bug)[0] for _ in range(decisions.MAX_EFFECT_ATTEMPTS)]
        self.assertEqual(seen, [1, 2, 3])
        self.assertEqual([(o[0]["action"], o[0]["code"], o[0]["attempts"]) for o in outs],
                         [("failed", "E_INTERNAL", 1), ("failed", "E_INTERNAL", 2), ("parked", "E_INTERNAL", 3)])
        self.assertIn("KeyError", outs[0][0]["message"])
        pid = outs[-1][0]["decision"]
        proposal, resolution = decisionsio.find(self.w.layout, pid)
        self.assertIsNone(resolution)
        self.assertEqual((proposal["kind"], proposal["tasks"], [o["id"] for o in proposal["options"]]),
                         ("other", [], ["retry", "drop"]))
        self.assertIn(self.did, proposal["title"])
        self.assertEqual(self._intent()["parked"], pid)
        return pid

    def test_a_bug_in_an_effect_is_bounded_then_parked_and_retried_on_the_owners_word(self) -> None:
        w = self.w
        pid = self._park_with_a_bug()
        # parked: not tried again while the owner has not answered, and `status` itself succeeds
        out, fake = self._tick(KeyError("effects"))
        self.assertEqual((out[0]["action"], out[0]["decision"], fake.call_count), ("waiting", pid, 0))
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        self.assertTrue(any(pid in x for x in env["data"]["reconciled"]["warnings"]), env["data"]["reconciled"])
        self.assertEqual(w.entry("T001")["status"], "blocked-decision")
        # the owner says retry: the next status applies the effects (the bug is gone)
        self._resolve(pid, "retry")
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        done = env["data"]["reconciled"]["decisions_completed"]
        self.assertEqual([(d["id"], d["action"]) for d in done], [(self.did, "applied")])
        self.assertEqual(w.entry("T001")["status"], "ready")
        self.assertEqual(decisions.pending_intents(w.layout), [])

    def test_an_exec_error_counts_too_and_drop_keeps_the_resolution(self) -> None:
        w = self.w
        outs = [self._tick(InternalError("still broken"))[0][0] for _ in range(decisions.MAX_EFFECT_ATTEMPTS)]
        self.assertEqual([(o["action"], o["code"]) for o in outs],
                         [("failed", "E_INTERNAL"), ("failed", "E_INTERNAL"), ("parked", "E_INTERNAL")])
        pid = outs[-1]["decision"]
        self._resolve(pid, "drop")
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["reconciled"]["decisions_completed"],
                         [{"id": self.did, "action": "abandoned", "decision": pid}])
        self.assertEqual(decisions.pending_intents(w.layout), [])
        self.assertIsNotNone(decisionsio.find(w.layout, self.did)[1])  # the resolution stands
        self.assertEqual(w.entry("T001")["status"], "blocked-decision")  # its effects are the owner's to do

    def test_a_success_before_the_bound_needs_no_owner(self) -> None:
        """Positive control: one failed try, then the effects apply; no parking decision is opened."""
        out, _f = self._tick(KeyError("once"))
        self.assertEqual((out[0]["action"], out[0]["attempts"]), ("failed", 1))
        before = len(self.w.events("decision.proposed"))
        code, env, _l = self.w.run(["status"])
        self.assertEqual(code, 0, env)
        self.assertEqual([d["action"] for d in env["data"]["reconciled"]["decisions_completed"]], ["applied"])
        self.assertEqual(len(self.w.events("decision.proposed")), before)
        self.assertEqual(self.w.entry("T001")["status"], "ready")
        # an applied try is not a warning: no line in data.warnings, none in the digest
        self.assertEqual(env["data"]["warnings"], [])
        self.assertNotIn("warning:", env["data"]["digest_text"])

    def _status_tick(self, side_effect: object) -> dict:
        """One real `status` reconciliation in process (cmd_status's body), with the effects failing."""
        env = S.patched_env(CLAUDE_CODE_SESSION_ID=S.SESSION_ID, GIT_CONFIG_GLOBAL=str(S.git_config_global()),
                            GIT_CONFIG_NOSYSTEM="1", GIT_TERMINAL_PROMPT="0")
        with env, mock.patch.object(decisions, "apply_resolution", side_effect=side_effect):
            return reconcile.run_status(self.w.ctx("status"))

    def test_each_failed_try_is_one_line_of_data_warnings_and_of_the_digest(self) -> None:
        """Contract revision 3 (Q-B04 m3, drift re-check B04-D2): a failed decision effect keeps `status` at exit 0,
        and every failed try adds one line to the digest and to data.warnings; the third failure opens a decision."""
        w = self.w
        lines: list[str] = []
        for n in range(1, decisions.MAX_EFFECT_ATTEMPTS + 1):
            data = self._status_tick(KeyError("effects"))
            ours = [x for x in data["warnings"] if x.startswith(f"decision {self.did}:")]
            self.assertEqual(len(ours), 1, data["warnings"])  # exactly one line for this try
            self.assertEqual(data["reconciled"]["warnings"], data["warnings"])
            self.assertIn(f"warning: {ours[0]}", data["digest_text"].split("\n"))
            self.assertEqual(w.layout.digest.read_text(encoding="utf-8").rstrip("\n"), data["digest_text"])
            self.assertEqual(self._intent()["attempts"], n)
            lines.append(ours[0])
        self.assertIn("(E_INTERNAL, try 1/3)", lines[0])
        self.assertIn("(E_INTERNAL, try 2/3)", lines[1])
        pid = self._intent()["parked"]
        self.assertIn("failed 3 times (E_INTERNAL)", lines[2])
        self.assertIn(f"decision {pid} asks to retry or drop them", lines[2])  # the third failure opens it
        proposal, resolution = decisionsio.find(w.layout, pid)
        self.assertEqual((proposal["kind"], resolution), ("other", None))
        # the warning lines come right after the counts: a digest cut short still shows them
        data = self._status_tick(KeyError("effects"))
        self.assertTrue(any(x.startswith(f"decision {self.did}: effects parked until decision {pid}")
                            for x in data["warnings"]), data["warnings"])
        self.assertGreater(len(data["digest_text"]), 400)
        code, env, _l = w.run(["status", "--max-chars", "400"])
        short = env["data"]["digest_text"]
        self.assertEqual((code, len(short) <= 400, short.endswith("…")), (0, True, True))
        self.assertIn(f"warning: decision {self.did}: effects parked until decision {pid} is resolved",
                      short.split("\n"))
        # through the CLI: exit 0, an envelope with data.warnings; `--digest` reconciles nothing, so no line
        code, env, _l = w.run(["status"])
        self.assertEqual(code, 0, env)
        self.assertTrue(any(pid in x for x in env["data"]["warnings"]), env["data"]["warnings"])
        code, env, _l = w.run(["status", "--digest"])
        self.assertEqual((code, env["data"]["warnings"]), (0, []))
        self.assertNotIn("warning:", env["data"]["digest_text"])

    def test_an_unreadable_intent_is_logged_with_its_file_then_reset(self) -> None:
        """Contract revision 3 (drift re-check B04-D3): a warning names the file before the intent is reset."""
        w = self.w
        path = decisions.intent_path(w.layout, self.did)
        rel = f"local/decision-effects/{self.did}.json"
        self._tick(KeyError("effects"))
        # positive control: a readable intent is read without that warning, and its counter goes on
        with self.assertLogs("tests.B04", level="WARNING") as clean:  # the failed try itself logs an error
            self._tick(KeyError("effects"))
        self.assertFalse([r for r in clean.records if r.getMessage().startswith("unreadable decision-intent")])
        self.assertEqual(self._intent()["attempts"], 2)
        S.write_text(path, '{"id": "' + self.did + '", "attempts": ')  # a torn write
        with self.assertLogs("tests.B04", level="WARNING") as seen:
            out, _f = self._tick(KeyError("effects"))
        resets = [r for r in seen.records if r.getMessage().startswith("unreadable decision-intent file reset")]
        self.assertEqual(len(resets), 1, [r.getMessage() for r in seen.records])
        self.assertEqual((resets[0].data["path"], resets[0].data["problem"]), (rel, "JSONDecodeError"))
        # reset to a fresh intent: the counter restarts, so this third failure in a row parks nothing
        self.assertEqual((out[0]["action"], out[0]["attempts"]), ("failed", 1))
        self.assertNotIn("parked", self._intent())
        # through the CLI: the warning is a JSON log line naming the file, `status` exits 0 and applies the effects
        S.write_text(path, "[]\n")  # valid JSON, not an object
        code, env, logs = w.run(["status"])
        self.assertEqual(code, 0, env)
        warned = [x for x in logs if x["level"] == "warning" and x["msg"].startswith("unreadable decision-intent")]
        self.assertEqual([(x["path"], x["problem"]) for x in warned], [(rel, "a JSON list, not an object")])
        self.assertEqual([d["action"] for d in env["data"]["reconciled"]["decisions_completed"]], ["applied"])
        self.assertEqual(w.entry("T001")["status"], "ready")
        code, env, logs = w.run(["status"])  # positive control: no intent left, no such warning
        self.assertEqual(code, 0, env)
        self.assertFalse([x for x in logs if x["msg"].startswith("unreadable decision-intent")])


class FrontendChoice(unittest.TestCase):
    """FRONTEND.md 6.4: FE-04 / FE-06 resolutions print the choices.json entry the orchestrator writes."""

    def setUp(self) -> None:
        raw = S.build_task("T004", kind="decision", template="frontend:FE-04")
        raw["manual"] = dict(raw["manual"], options=[{"id": "a", "label": "A", "consequence": "c"},
                                                     {"id": "b", "label": "B", "consequence": "c"}])
        self.w = World([raw])
        self.addCleanup(self.w.cleanup)
        self.w.set_status("T004", "ready")
        self.assertEqual(self.w.run(["manual", "post", "--task", "T004"])[0], 0)
        self.did = self.w.entry("T004")["decision"]

    def _resolve(self, skills_root: object) -> dict:
        with mock.patch.object(paths, "_SKILLS_ROOT_OVERRIDE", skills_root), self.w.locked():
            return decisions.resolve(self.w.ctx("decision resolve"), decision_id=self.did, choice="b", by="devA",
                                     source="remote-control", quote="B, mais avec un fond plus sombre.")

    def test_h1_entry_from_the_resolution(self) -> None:
        data = self._resolve(B04_FIXTURES / "skills")
        fc = data["frontend_choice"]
        self.assertEqual(fc["key"], "H1")
        self.assertTrue(fc["path"].endswith("/frontend/choices.json"))
        value = fc["value"]
        self.assertEqual((value["pick"], value["change"], value["channel"], value["by"]),
                         ("B", "mais avec un fond plus sombre.", "remote-control", "devA"))
        self.assertEqual(value["source"], f".execution/decisions.md#{self.did}")
        self.assertEqual(data["_errors"], [])
        self.assertEqual(self.w.entry("T004")["status"], "done")  # no file proof on this task

    def test_choices_schema_absent_is_a_dependency_decision(self) -> None:
        empty = S.mkdtemp()
        self.addCleanup(S.rmtree, empty)
        data = self._resolve(empty)
        self.assertIsNone(data["frontend_choice"])
        self.assertEqual([e.code for e in data["_errors"]], ["E_DEPENDENCY_MISSING"])
        kinds = [p["kind"] for p in decisionsio.open_proposals(self.w.layout)]
        self.assertIn("dependency-missing", kinds)
        _p, res = decisionsio.find(self.w.layout, self.did)
        self.assertEqual(res["choice"], "b")  # the answer is kept


class ChangeSentence(unittest.TestCase):
    def test_change_is_the_sentence_after_the_pick(self) -> None:
        self.assertEqual(decisions._change_sentence("B, avec un fond plus sombre. Merci", "b"),
                         "avec un fond plus sombre.")
        self.assertEqual(decisions._change_sentence("B", "b"), "")
        self.assertEqual(decisions._change_sentence("je prends la C", "b"), "")


if __name__ == "__main__":
    unittest.main()
