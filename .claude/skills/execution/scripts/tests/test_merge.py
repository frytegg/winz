"""The merge queue (contract/TESTS.md 5.1, LANES.md B06, CLI.md `merge`): landed path, compare-and-set loop on a
rejected push, conflicts, policy refusals (trailers, never-show without text, secrets, push freeze, protected path,
conventional header), writes scope, the per-run call counter, already-landed, no gates.json, `--by orchestrator`
from an agent, the out-dir rule, single-tree with neighbours (shared checkout untouched), crash after the push,
the budget, a linked worktree, an environment failure in a gate, a state-only task; every receipt validates. The
proven-public values of README.md 8 (contract revision 3): a listed tx hash and an explorer-link value land, the same
shape unlisted or outside a link is refused (E_SECRET_IN_STATE); a tx task's new hash is re-read on chain with its own
reader and registered when confirmed (Q-B10-7).

Most tests fake the modules of other lanes (results, status: B04; governor: B08) with the MODULES.md signatures.
B04 and B08 are integrated: `RealExecPublicValues` and `ChainRereadAtMerge` run the real exec.py with the real
modules.

Run: python -m unittest discover -s scripts/tests -p "test_merge.py" -v
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

import _support as S
import _support_B06 as B

from execlib import gitutil, hardenbridge, jsonio, merge, proof, schema
from execlib.errors import PolicyRefused
from execlib.log import get_logger
from execlib.model import Ctx

HARDEN_OK = (Path.home() / ".claude" / "skills" / "harden" / "scripts" / "gates.py").is_file()
NEEDS = unittest.skipUnless(HARDEN_OK and S.tool_available("git"), "/harden's gates.py and git are needed")
SLOW = unittest.skipUnless(os.environ.get("EXEC_SLOW") == "1",
                           "slow tier (TESTS.md 1.2: real gates.py runs); run with EXEC_SLOW=1")


def valid_receipt(test: unittest.TestCase, doc: dict | None) -> dict:
    """C-MRG-13: every receipt validates against merge-receipt.schema.json."""
    test.assertIsNotNone(doc)
    report = schema.validate(doc, "merge-receipt")
    test.assertTrue(report.ok, [i.message for i in report.issues])
    return doc  # type: ignore[return-value]


def tree_snapshot(repo: Path) -> dict[str, str]:
    """sha256 of every file of the work tree (outside .git and .execution) plus the index and HEAD."""
    out: dict[str, str] = {}
    for p in sorted(repo.rglob("*")):
        rel = p.relative_to(repo).as_posix()
        if p.is_file() and not rel.startswith((".git/", ".execution/")):
            out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    out[".git/index"] = hashlib.sha256((repo / ".git" / "index").read_bytes()).hexdigest()
    out[".git/HEAD"] = (repo / ".git" / "HEAD").read_text(encoding="utf-8")
    return out


def pre_push_hook(env: B.B06Env, *, every: bool) -> Path:
    """A pre-push hook that pushes a commit from a second clone to the bare origin (first call only, or every
    call), then exits 0, so the push it precedes is rejected as non-fast-forward."""
    other = env.repo_obj.clone("other")
    marker = env.private / "hook-fired"
    hook = env.repo / ".git" / "hooks" / "pre-push"
    guard = "" if every else f'[ -f "{marker.as_posix()}" ] && exit 0\ntouch "{marker.as_posix()}"\n'
    S.write_text(hook, "#!/bin/sh\n" + guard +
                 "unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE\n"
                 f'cd "{other.as_posix()}" || exit 0\n'
                 "git pull --quiet --rebase origin main >/dev/null 2>&1\n"
                 'echo "$(date +%s%N) $$" >> src/cli/other.txt\n'
                 "git add src/cli/other.txt\n"
                 "git -c user.name=Other -c user.email=other@example.invalid commit --quiet -m 'feat(cli): other'\n"
                 "git push --quiet origin HEAD:main >/dev/null 2>&1\n"
                 "exit 0\n")
    os.chmod(hook, 0o755)
    return other


@NEEDS
class Landed(unittest.TestCase):
    def setUp(self) -> None:
        self.env = B.B06Env()

    def tearDown(self) -> None:
        self.env.cleanup()

    def test_c_mrg_01_12_13_landed_single_tree(self) -> None:
        self.env.write("src/engine/eta.mjs", "export const eta = 2;\n")
        code, envl, _l = self.env.merge_single()
        self.assertEqual(code, 0, envl["errors"])
        r = valid_receipt(self, envl["data"])
        self.assertEqual(r["outcome"], "landed")
        self.assertEqual(r["landed_sha"], self.env.origin_main())
        self.assertEqual(r["push_attempts"], 1)
        controlled = {"trailers", "conventional", "never-show", "secrets", "test-integrity", "todo-judge-facing"}
        for scan in r["scans"]:
            self.assertEqual(scan["state"], "ok", scan)
            if scan["id"] in controlled:
                self.assertEqual(scan["positive_control"], {"ran": True, "caught": True})
        gates_dir = self.env.layout.merge_gates_dir("T005", 1, 0)
        self.assertTrue(r["gates"]["result_path"].startswith(S.paths.posix(gates_dir)))
        self.assertFalse((gates_dir.parent / "active").exists())
        self.assertEqual(r["gates"]["exit_code"], 0)
        self.assertIsNotNone(r["task_proof"]["run"])
        on_disk = jsonio.read_json(self.env.receipt_path())
        self.assertEqual(on_disk, r)
        self.assertEqual(list(self.env.layout.merge_pending_dir.glob("*.json"))
                         if self.env.layout.merge_pending_dir.is_dir() else [], [])
        files = S.git(self.env.repo, "show", "--name-only", "--format=", r["landed_sha"], env=self.env.env)
        self.assertEqual(files.stdout.decode().split(), ["src/engine/eta.mjs"])

    @SLOW
    def test_c_mrg_09_already_landed_any_wave(self) -> None:
        self.env.write("src/engine/eta.mjs", "export const eta = 3;\n")
        self.assertEqual(self.env.merge_single()[0], 0)
        before = self.env.origin_main()
        code, envl, _l = self.env.merge_single(wave="W02", attempt=2)
        self.assertEqual(code, 4)
        self.assertEqual(envl["errors"][0]["code"], "E_ALREADY_LANDED")
        self.assertEqual(envl["data"]["wave"], "W01")
        valid_receipt(self, envl["data"])
        self.assertEqual(self.env.origin_main(), before)

    @SLOW
    def test_c_mrg_08_third_call_refused_rerun_resets(self) -> None:
        results = []
        for _ in range(3):
            results.append(self.env.merge_single()[0])  # nothing to merge: exit 1 twice, then the counter
        self.assertEqual(results[:2], [1, 1])
        code, envl, _l = self.env.merge_single()
        self.assertEqual(code, 4)
        self.assertEqual(envl["errors"][0]["code"], "E_MERGE_ATTEMPTS")
        self.env.write("src/engine/eta.mjs", "export const eta = 4;\n")
        code, envl, _l = self.env.merge_single(rerun=1)
        self.assertEqual(code, 0, envl["errors"])

    @SLOW
    def test_c_mrg_11_by_orchestrator_from_an_agent(self) -> None:
        self.env.write("src/engine/eta.mjs", "export const eta = 5;\n")
        self.env.attest(command="merge", task="T005", attempt=1, agent_id="agent-impl",
                        agent_type="execution-implementer")
        before = self.env.origin_main()
        code, envl, _l = self.env.merge_single()
        self.assertEqual(code, 4)
        self.assertEqual(self.env.origin_main(), before)
        code, envl, _l = self.env.merge_single(extra=("--by", "implementer"))
        self.assertEqual(code, 0, envl["errors"])

    @SLOW
    def test_c_mrg_12_planted_active_refused_before_running(self) -> None:
        self.env.write("src/engine/eta.mjs", "export const eta = 6;\n")
        gates_dir = self.env.layout.merge_gates_dir("T005", 1, 0)
        S.write_text(gates_dir.parent / "active", "{}\n")
        before = self.env.origin_main()
        code, envl, _l = self.env.merge_single()
        self.assertEqual(code, 4)
        self.assertFalse(gates_dir.exists())
        self.assertEqual(self.env.origin_main(), before)
        (gates_dir.parent / "active").unlink()
        self.assertEqual(self.env.merge_single()[0], 0)

    @SLOW
    def test_c_mrg_10_no_gates(self) -> None:
        self.env.layout.gates_json.unlink()
        self.env.write("src/engine/eta.mjs", "export const eta = 7;\n")
        code, envl, _l = self.env.merge_single()
        self.assertEqual(code, 1)
        self.assertEqual(envl["errors"][0]["code"], "E_NO_GATES")
        valid_receipt(self, envl["data"])
        plan = jsonio.read_json(self.env.layout.plan)
        plan["tasks"][0]["phase"] = "contract"
        jsonio.write_json_atomic(self.env.layout.plan, plan)
        code, envl, _l = self.env.merge_single(rerun=1)
        self.assertEqual(code, 0, envl["errors"])
        self.assertIsNone(envl["data"]["gates"]["exit_code"])
        self.assertIn("gates.json absent", envl["data"]["notes"])


@NEEDS
class Refusals(unittest.TestCase):
    """C-MRG-06, C-MRG-17, C-MRG-18: exit 4, origin unchanged, no matched text in the output."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.env = B.B06Env(tasks=[B.proof_task("T005"),
                                  B.proof_task("T006", writes=[".github/workflows/**"]),
                                  B.proof_task("T007", writes=["src/engine/**"])],
                           protected=[".github/workflows/**"])
        cls.rerun = 0

    @classmethod
    def tearDownClass(cls) -> None:
        cls.env.cleanup()

    def merge(self, msg: str, task: str = "T005") -> tuple[int, dict, list[dict]]:
        type(self).rerun += 1
        return self.env.merge_single(task, msg, rerun=self.rerun)

    def refused(self, msg: str, code_name: str, task: str = "T005") -> tuple[dict, list[dict]]:
        before = self.env.origin_main()
        code, envl, logs = self.merge(msg, task)
        self.assertEqual(code, 4, envl["errors"])
        self.assertEqual(envl["errors"][0]["code"], code_name)
        self.assertEqual(envl["data"]["outcome"], "refused")
        valid_receipt(self, envl["data"])
        self.assertEqual(self.env.origin_main(), before)
        return envl, logs

    def tearDown(self) -> None:
        self.env.git("checkout", "--", ".", check=False)
        self.env.git("clean", "-fdq", "--", "src", ".github", check=False)

    def test_trailer(self) -> None:
        self.env.write("src/engine/eta.mjs", "export const eta = 11;\n")
        self.refused("feat(engine): x\n\n" + S.planted("trailer.coauthor"), "E_POLICY")

    def test_never_show_line_without_text(self) -> None:
        live = S.planted("nevershow.live")
        self.env.write("src/engine/eta.mjs", f"// {live}\nexport const eta = 12;\n")
        envl, logs = self.refused("feat(engine): x", "E_NEVER_SHOW")
        text = (str(envl) + str(logs)).lower()
        self.assertIn("ns-embargo-live", text)
        self.assertIn("src/engine/eta.mjs:1", text)
        self.assertNotIn(live.lower(), text)

    def test_c_mrg_18_never_show_in_message(self) -> None:
        live = S.planted("nevershow.live")
        self.env.write("src/engine/eta.mjs", "export const eta = 13;\n")
        envl, logs = self.refused(f"feat(engine): mention {live}", "E_NEVER_SHOW")
        text = (str(envl) + str(logs)).lower()
        self.assertIn("ns-embargo-live", text)
        self.assertIn("in commit", text)
        self.assertNotIn(live.lower(), text)

    def test_secret(self) -> None:
        # CLI.md merge, "Secret-shaped values in the added lines" (revision 3): a remaining hit is E_SECRET_IN_STATE
        self.env.write("src/engine/eta.mjs", f"const k = '{S.planted('key.private')}';\n")
        self.refused("feat(engine): x", "E_SECRET_IN_STATE")

    def test_protected(self) -> None:
        self.env.write(".github/workflows/ci.yml", "on: push\n")
        self.refused("ci: add the workflow", "E_POLICY", task="T006")

    def test_c_mrg_17_conventional(self) -> None:
        for msg in ('Revert "x"', "updated stuff"):
            with self.subTest(msg=msg):
                self.env.write("src/engine/eta.mjs", f"export const eta = '{msg[:3]}';\n")
                self.refused(msg, "E_NOT_CONVENTIONAL")

    def test_positive_control_lands(self) -> None:
        self.env.write("src/engine/eta.mjs", "export const eta = 14;\n")
        code, envl, _l = self.merge("fix(engine): use the median capacity", task="T007")
        self.assertEqual(code, 0, envl["errors"])
        plan = jsonio.read_json(self.env.layout.plan)
        self.assertEqual(plan["tasks"][0]["id"], "T005")


@NEEDS
class RealExecPublicValues(unittest.TestCase):
    """F18 and README.md 8 through the REAL exec.py (lane B04's real results module; the governor reading from the
    EXEC_GOVERNOR_READINGS test seam). The merge secret scan refuses a transaction hash that is neither listed nor in
    an explorer link (exit 4, origin unchanged, the value never printed), clears it inside an explorer link, and
    clears a value listed in public-values.jsonl in a file and in the commit message; the real
    results.landed_receipt then finds the landed task (E_ALREADY_LANDED)."""

    def setUp(self) -> None:
        self.env = B.B06Env(tasks=[B.proof_task("T005"), B.proof_task("T006")])

    def tearDown(self) -> None:
        self.env.cleanup()

    def merge(self, task: str, msg: str, rerun: int = 0) -> tuple[int, dict, list[dict]]:
        mf = self.env.message(msg, f"msg-{task}-{rerun}.txt")
        return B.run_exec_real(["merge", "--task", task, "--attempt", "1", "--rerun", str(rerun), "--wave", "W01",
                                "--single-tree", "--message-file", str(mf)], self.env.repo, self.env.env)

    def secrets_scan(self, receipt: dict) -> dict:
        return [s for s in receipt["scans"] if s["id"] == "secrets"][0]

    def test_listed_and_explorer_values_land_unlisted_refused(self) -> None:
        env = self.env
        listed = "0x" + hashlib.sha256(b"listed-deployment").hexdigest()      # built at runtime (TESTS.md 1.4)
        unlisted = "0x" + hashlib.sha256(b"unlisted-deployment").hexdigest()
        self.assertTrue(B.register_public(env.layout, listed))
        before = env.origin_main()
        # refused: the unlisted shape on its own, then next to an explorer link of it (outside the link)
        for rerun, text in enumerate((f"deployment tx {unlisted}\n",
                                      f"https://testnet.bscscan.com/tx/{unlisted} ({unlisted})\n")):
            with self.subTest(refused=rerun):
                env.write("src/engine/tx.md", text)
                code, envl, logs = self.merge("T006", "docs(engine): record the deployment tx", rerun)
                self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_SECRET_IN_STATE"), envl["errors"])
                self.assertIn("secrets", envl["errors"][0]["message"])
                self.assertNotIn(unlisted[2:], json.dumps(envl) + json.dumps(logs))
                valid_receipt(self, envl["data"])
                self.assertEqual(env.origin_main(), before)
        # lands: the same value inside an explorer link only
        env.write("src/engine/tx.md", f"[deployment](https://testnet.bscscan.com/tx/{unlisted})\n")
        code, envl, _l = self.merge("T006", "docs(engine): link the deployment tx", 2)
        self.assertEqual(code, 0, envl["errors"])
        scan = self.secrets_scan(valid_receipt(self, envl["data"]))
        self.assertEqual((scan["state"], scan["positive_control"]), ("ok", {"ran": True, "caught": True}))
        # lands: the listed value, bare, in a file and in the commit message
        env.write("src/engine/tx-listed.md", f"deployment tx {listed}\n")
        code, envl, _l = self.merge("T005", f"docs(engine): record tx {listed}")
        self.assertEqual(code, 0, envl["errors"])
        scan = self.secrets_scan(valid_receipt(self, envl["data"]))
        self.assertEqual(scan["state"], "ok")
        self.assertIn("proven-public value(s) cleared", scan["detail"])
        landed = envl["data"]["landed_sha"]
        self.assertEqual(env.origin_main(), landed)
        # the real results module finds the landed receipt: a later merge of T005 is E_ALREADY_LANDED
        code, envl, _l = self.merge("T005", "docs(engine): again", 1)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_ALREADY_LANDED"))
        self.assertEqual(envl["data"]["landed_sha"], landed)


CHAIN_READER = r'''
import hashlib, json, pathlib, sys
here = pathlib.Path(__file__).parent
conf = json.loads((here / "reader.json").read_text(encoding="utf-8"))
value = sys.argv[1]
with open(here / "calls.log", "a", encoding="utf-8", newline="\n") as fh:
    fh.write(hashlib.sha256(value.encode("utf-8")).hexdigest() + "\n")
if value.lower() not in conf["confirm"]:
    sys.exit(1)
print(json.dumps({"chain": "evm", "network": conf.get("network", "testnet"), "from": "a", "to": "b", "value": "1",
                  "block_time": "2026-10-03T07:00:00Z"}))
'''


@NEEDS
class ChainRereadAtMerge(unittest.TestCase):
    """CLI.md merge, "Secret-shaped values in the added lines" (contract revision 3, Q-B10-7), through the REAL
    exec.py: a task that writes new evidence (proof type tx) has each unproven `0x`+64-hex value of its added lines
    re-read on chain with its own reader, as `proof run` reads it. A confirmed value is registered (proven
    chain-reread, source merge:<task>:a<n>) and lands; an unconfirmed one is refused (E_SECRET_IN_STATE, nothing
    registered); the same kind of value in a code task is refused without any re-read, and an explorer link of it
    lands."""

    def setUp(self) -> None:
        self.tools = S.mkdtemp()
        reader = self.tools / "reader.py"
        S.write_text(reader, CHAIN_READER)
        reader_cmd = f"{S.paths.posix(Path(sys.executable))} {S.paths.posix(reader)} {{hash}}"

        def tx_task(tid: str, area: str) -> dict:
            task = B.proof_task(tid, kind="tx", writes=[f"src/{area}/**"])
            task["proof"] = {"type": "tx", "spec": {"chain": "evm", "network": "testnet",
                                                    "hash_from": {"file": f"src/{area}/deployment.json"},
                                                    "reader_cmd": reader_cmd},
                             "expect": {"summary": "the deployment transaction is on chain"}, "max_runtime_min": 1,
                             "negative_control": {"kind": "forgery", "description": "a forged hash is not confirmed",
                                                  "expect_nonzero": True}}
            return task

        self.env = B.B06Env(tasks=[tx_task("T005", "a"), tx_task("T006", "b"),
                                   B.proof_task("T007", writes=["src/c/**"])])
        self.confirmed = "0x" + hashlib.sha256(b"capture-confirmed").hexdigest()       # built at runtime
        self.unconfirmed = "0x" + hashlib.sha256(b"capture-unconfirmed").hexdigest()
        self.confirmable = "0x" + hashlib.sha256(b"capture-in-a-code-task").hexdigest()
        self.configure([self.confirmed, self.confirmable])

    def tearDown(self) -> None:
        self.env.cleanup()
        S.rmtree(self.tools)

    def configure(self, confirm: list[str], network: str = "testnet") -> None:
        S.write_json(self.tools / "reader.json", {"confirm": [v.lower() for v in confirm], "network": network})

    def calls(self) -> int:
        log = self.tools / "calls.log"
        return len(log.read_text(encoding="utf-8").splitlines()) if log.is_file() else 0

    def listed(self) -> list[dict]:
        path = self.env.layout.state / "public-values.jsonl"
        return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()] if path.is_file() else []

    def merge(self, task: str, msg: str, rerun: int = 0) -> tuple[int, dict, list[dict]]:
        mf = self.env.message(msg, f"msg-{task}-{rerun}.txt")
        return B.run_exec_real(["merge", "--task", task, "--attempt", "1", "--rerun", str(rerun), "--wave", "W01",
                                "--single-tree", "--message-file", str(mf)], self.env.repo, self.env.env)

    def test_capture_task_value_confirmed_on_chain(self) -> None:
        env = self.env
        before = env.origin_main()
        # (1) the tx task's new value, re-read but not confirmed: refused, nothing registered, origin unchanged
        env.write("src/b/deployment.json", json.dumps(self.unconfirmed) + "\n")
        code, envl, logs = self.merge("T006", "docs(b): record the deployment tx")
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_SECRET_IN_STATE"), envl["errors"])
        self.assertEqual(self.calls(), 1)
        self.assertIn("not confirmed on chain", valid_receipt(self, envl["data"])["notes"])
        self.assertNotIn(self.unconfirmed[2:], json.dumps(envl) + json.dumps(logs))
        self.assertEqual((self.listed(), env.origin_main()), ([], before))
        # ... nor confirmed by an answer for another network (chain and network must equal the proof spec)
        self.configure([self.confirmed, self.confirmable, self.unconfirmed], network="mainnet")
        code, envl, _l = self.merge("T006", "docs(b): record the deployment tx", 1)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_SECRET_IN_STATE"), envl["errors"])
        self.assertIn("network", envl["data"]["notes"])
        self.assertEqual((self.calls(), self.listed()), (2, []))
        # (2) positive control: the tx task's value the chain confirms is registered, then lands
        self.configure([self.confirmed, self.confirmable])
        env.write("src/a/deployment.json", json.dumps(self.confirmed) + "\n")
        code, envl, _l = self.merge("T005", "docs(a): record the deployment tx")
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual(self.listed(), [{"value": self.confirmed, "kind": "evm-tx-hash", "chain": "evm",
                                          "network": "testnet", "proven": "chain-reread", "source": "merge:T005:a1",
                                          "at_utc": S.FIXED_NOW, "executor": "A"}])
        receipt = valid_receipt(self, envl["data"])
        scan = [s for s in receipt["scans"] if s["id"] == "secrets"][0]
        self.assertEqual((scan["state"], scan["positive_control"]), ("ok", {"ran": True, "caught": True}))
        self.assertIn("confirmed on chain by the task's reader and registered", receipt["notes"])
        landed = env.origin_main()
        self.assertEqual(receipt["landed_sha"], landed)
        # (3) a code task: a value the reader would confirm is never re-read there, and is refused
        calls = self.calls()
        env.write("src/c/notes.md", f"deployment {self.confirmable}\n")
        code, envl, _l = self.merge("T007", "docs(c): note the deployment")
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_SECRET_IN_STATE"), envl["errors"])
        self.assertEqual((self.calls(), env.origin_main()), (calls, landed))
        self.assertNotIn("on chain", valid_receipt(self, envl["data"]).get("notes") or "")  # no re-read attempted
        # ... while an explorer link of it lands, with no re-read and no registration
        env.write("src/c/notes.md", f"deployment: https://testnet.bscscan.com/tx/{self.confirmable}\n")
        code, envl, _l = self.merge("T007", "docs(c): link the deployment", 1)
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual((self.calls(), len(self.listed())), (calls, 1))


@NEEDS
class PushFreeze(unittest.TestCase):
    @SLOW
    def test_push_after_freeze(self) -> None:
        env = B.B06Env(policy_over={"git": dict(S.build_policy()["git"], push_freeze_utc="2026-10-01T00:00:00Z")})
        try:
            env.write("src/engine/eta.mjs", "export const eta = 15;\n")
            before = env.origin_main()
            code, envl, _l = env.merge_single()
            self.assertEqual(code, 4)
            self.assertIn("push-freeze", envl["errors"][0]["message"])
            self.assertEqual(env.origin_main(), before)
            pol = jsonio.read_json(env.layout.policy)
            pol["git"]["push_freeze_utc"] = "2026-10-07T15:59:00Z"
            jsonio.write_json_atomic(env.layout.policy, pol)
            self.assertEqual(env.merge_single(rerun=1)[0], 0)
        finally:
            env.cleanup()


@NEEDS
class Neighbours(unittest.TestCase):
    def test_c_mrg_14_shared_checkout_untouched(self) -> None:
        gate = [{"name": "nm", "cmd": [sys.executable, "-c",
                                       "import os, sys; sys.exit(0 if os.path.isfile('node_modules/marker') else 1)"]}]
        env = B.B06Env(gates=gate)
        try:
            S.write_text(env.repo / "node_modules" / "marker", "installed\n")
            S.write_text(env.repo / ".git" / "info" / "exclude", "node_modules/\n.execution/\n")
            env.write("src/engine/eta.mjs", "export const eta = 21;\n")
            env.write("src/engine/new.mjs", "export const n = 1;\n")
            env.write("src/cli/main.mjs", "export const cli = 'T006 work in progress';\n")
            env.write("src/cli/extra.mjs", "export const x = 'T006';\n")
            before = tree_snapshot(env.repo)
            code, envl, _l = env.merge_single()
            self.assertEqual(code, 0, envl["errors"])
            r = valid_receipt(self, envl["data"])
            self.assertEqual(tree_snapshot(env.repo), before)
            files = S.git(env.repo, "show", "--name-only", "--format=", r["landed_sha"], env=env.env)
            self.assertEqual(sorted(files.stdout.decode().split()), ["src/engine/eta.mjs", "src/engine/new.mjs"])
            self.assertEqual(r["gates"]["exit_code"], 0)  # the junction gave the integration worktree node_modules
            integ = env.scratch / "queue-clock" / "integ" / "T005-a1r0"
            self.assertFalse(integ.exists())
            self.assertTrue((env.repo / "node_modules" / "marker").is_file())  # the junction target survived
            wts = S.git(env.repo, "worktree", "list", "--porcelain", env=env.env).stdout.decode()
            self.assertNotIn("integ", wts)
            self.assertEqual(S.git(env.repo, "rev-parse", "refs/exec/T005/a1r0", env=env.env).stdout.decode().strip(),
                             r["landed_sha"])
        finally:
            env.cleanup()


@NEEDS
class StateOnly(unittest.TestCase):
    def test_c_mrg_22_state_only(self) -> None:
        env = B.B06Env(tasks=[B.proof_task("T005", writes=[".execution/frontend/**"])])
        try:
            S.write_json(env.layout.state / "frontend" / "brief.json", {"hero": {"source": "x"}})
            before = env.origin_main()
            code, envl, _l = env.merge_single(msg="feat(frontend): brief")
            self.assertEqual(code, 0, envl["errors"])
            r = valid_receipt(self, envl["data"])
            self.assertEqual((r["mode"], r["outcome"], r["push_attempts"]), ("state-only", "landed", 0))
            self.assertEqual(r["landed_sha"], before)
            self.assertIsNone(r["gates"]["exit_code"])
            self.assertIn("state-only task", r["notes"])
            self.assertTrue(all(s["positive_control"]["caught"] for s in r["scans"] if s["positive_control"]))
            self.assertEqual(env.origin_main(), before)
        finally:
            env.cleanup()


@NEEDS
class Worktrees(unittest.TestCase):
    def setUp(self) -> None:
        self.env = B.B06Env()
        self.wt = self.env.root / "wt-L1"
        self.env.git("worktree", "add", "--quiet", "-b", "lane/L1", str(self.wt), "origin/main")

    def tearDown(self) -> None:
        self.env.cleanup()

    def lane_commit(self, rel: str, text: str, msg: str = "feat(engine): lane change") -> str:
        S.write_text(self.wt / rel, text)
        S.git(self.wt, "add", "--all", env=self.env.env)
        mf = self.env.message(msg, "lane-msg.txt")
        S.git(self.wt, "commit", "--quiet", "-F", str(mf), env=self.env.env)
        return S.git(self.wt, "rev-parse", "HEAD", env=self.env.env).stdout.decode().strip()

    def merge(self, **kw: object) -> tuple[int, dict, list[dict]]:
        return self.env.run("merge", "--task", "T005", "--attempt", "1", "--rerun", str(kw.get("rerun", 0)),
                            "--wave", "W01", "--worktree", str(self.wt), "--branch", "lane/L1")

    @SLOW
    def test_landed_worktrees(self) -> None:
        self.lane_commit("src/engine/eta.mjs", "export const eta = 31;\n")
        code, envl, _l = self.merge()
        self.assertEqual(code, 0, envl["errors"])
        r = valid_receipt(self, envl["data"])
        self.assertEqual((r["mode"], r["landed_sha"]), ("worktrees", self.env.origin_main()))
        self.assertFalse(r["worktree_removed"])  # no wave manifest: the lane worktree is kept

    @SLOW
    def test_c_mrg_05_conflict(self) -> None:
        other = self.env.repo_obj.clone("other")
        S.write_text(other / "src/engine/eta.mjs", "export const eta = 'theirs';\n")
        S.git(other, "commit", "--quiet", "-am", "feat(engine): theirs", env=self.env.env)
        S.git(other, "push", "--quiet", "origin", "main", env=self.env.env)
        self.lane_commit("src/engine/eta.mjs", "export const eta = 'ours';\n")
        code, envl, _l = self.merge()
        self.assertEqual(code, 1)
        r = valid_receipt(self, envl["data"])
        self.assertEqual((r["outcome"], r["conflict_files"]), ("conflict", ["src/engine/eta.mjs"]))
        status = S.git(self.wt, "status", "--porcelain", env=self.env.env).stdout.decode().strip()
        self.assertEqual(status, "")
        self.assertFalse((self.wt / ".git").is_dir() and (self.wt / ".git" / "rebase-merge").exists())

    @SLOW
    def test_c_mrg_07_writes_scope(self) -> None:
        self.lane_commit("README.md", "# changed by the lane\n")
        code, envl, _l = self.merge()
        self.assertEqual(code, 1)
        r = valid_receipt(self, envl["data"])
        self.assertEqual(r["outcome"], "scan-failed")
        self.assertIn("README.md", envl["errors"][0]["message"])

    @SLOW
    def test_c_mrg_02_rejected_push_loops(self) -> None:
        pre_push_hook(self.env, every=False)
        self.lane_commit("src/engine/eta.mjs", "export const eta = 32;\n")
        code, envl, _l = self.merge()
        self.assertEqual(code, 0, envl["errors"])
        r = valid_receipt(self, envl["data"])
        self.assertEqual(r["push_attempts"], 2)
        log = S.git(self.env.repo_obj.origin, "log", "--format=%s", "main", env=self.env.env).stdout.decode()
        self.assertIn("feat(cli): other", log)
        self.assertEqual(r["landed_sha"], self.env.origin_main())

    @SLOW
    def test_c_mrg_03_exhausted(self) -> None:
        pre_push_hook(self.env, every=True)
        mine = self.lane_commit("src/engine/eta.mjs", "export const eta = 33;\n")
        code, envl, _l = self.merge()
        self.assertEqual(code, 1)
        r = valid_receipt(self, envl["data"])
        self.assertEqual((r["outcome"], r["push_attempts"]), ("push-rejected-exhausted", 3))
        log = S.git(self.env.repo_obj.origin, "log", "--format=%s", "main", env=self.env.env).stdout.decode()
        self.assertNotIn("feat(engine): lane change", log)
        self.assertNotEqual(mine, self.env.origin_main())


@NEEDS
@SLOW
class InProcessOrder(unittest.TestCase):
    """C-MRG-04: merge_task with a Git whose push is rejected twice, then accepted: three attempts, each in the
    order fetch -> rebase -> gates -> proof -> push."""

    def setUp(self) -> None:
        self.env = B.B06Env()
        self.wt = self.env.root / "wt-L1"
        self.env.git("worktree", "add", "--quiet", "-b", "lane/L1", str(self.wt), "origin/main")
        S.write_text(self.wt / "src/engine/eta.mjs", "export const eta = 41;\n")
        S.git(self.wt, "commit", "--quiet", "-am", "feat(engine): eta", env=self.env.env)
        B.install_fakes()

    def tearDown(self) -> None:
        B.remove_fakes()
        self.env.cleanup()

    def test_order_and_retries(self) -> None:
        calls: list[str] = []
        real_fetch, real_rebase, real_push = gitutil.Git.fetch, gitutil.Git.rebase, gitutil.Git.push_sha
        real_gates, real_proof = hardenbridge.gates, proof.run_proof
        pushes = {"n": 0}

        def fetch(self_: gitutil.Git, remote: str = "origin") -> None:
            calls.append("fetch")
            real_fetch(self_, remote)

        def rebase(self_: gitutil.Git, onto: str) -> gitutil.RebaseOutcome:
            calls.append("rebase")
            return real_rebase(self_, onto)

        def push(self_: gitutil.Git, sha: str, branch: str = "main") -> gitutil.PushOutcome:
            calls.append("push")
            pushes["n"] += 1
            if pushes["n"] <= 2:
                return gitutil.PushOutcome(False, True, "! [rejected] main -> main (fetch first)")
            return real_push(self_, sha, branch)

        def gates(*a: object, **kw: object) -> hardenbridge.GatesOutcome:
            label = a[3] if len(a) > 3 else kw.get("label")
            calls.append("gates" if str(label).startswith("merge-") else "proof-gates")
            return real_gates(*a, **kw)  # type: ignore[arg-type]

        def run_proof(*a: object, **kw: object) -> dict:
            calls.append("proof")
            return real_proof(*a, **kw)  # type: ignore[arg-type]

        layout = self.env.layout
        ctx = Ctx(layout=layout, executor="A", now=S.fixed_now(), by="implementer", pretty=False, command="merge",
                  log=get_logger("execlib.merge"))
        plan_raw = jsonio.read_json(layout.plan)
        with S.patched_env(EXEC_TEST="1", EXEC_GOVERNOR_READINGS=str(self.env.readings_path),
                           GIT_CONFIG_GLOBAL=self.env.env["GIT_CONFIG_GLOBAL"], GIT_CONFIG_NOSYSTEM="1"), \
                mock.patch.object(gitutil.Git, "fetch", fetch), mock.patch.object(gitutil.Git, "rebase", rebase), \
                mock.patch.object(gitutil.Git, "push_sha", push), mock.patch.object(hardenbridge, "gates", gates), \
                mock.patch.object(proof, "run_proof", run_proof):
            receipt = merge.merge_task(ctx, plan_raw, plan_raw["tasks"][0], attempt=1, rerun=0, wave="W01",
                                       worktree=self.wt, branch="lane/L1", single_tree=False, message_file=None)
        valid_receipt(self, receipt)
        self.assertEqual(receipt["push_attempts"], 3)
        seq = [c for c in calls if c in ("fetch", "rebase", "gates", "proof", "push")]
        loop = ["fetch", "rebase", "gates", "proof", "push"]
        self.assertEqual(seq[:15], loop * 3)


@NEEDS
@SLOW
class SingleTreeMoves(unittest.TestCase):
    def test_c_mrg_15_origin_moved(self) -> None:
        env = B.B06Env()
        try:
            pre_push_hook(env, every=False)
            env.write("src/engine/eta.mjs", "export const eta = 51;\n")
            code, envl, _l = env.merge_single()
            self.assertEqual(code, 0, envl["errors"])
            r = valid_receipt(self, envl["data"])
            self.assertEqual(r["push_attempts"], 2)
            files = S.git(env.repo, "show", "--name-only", "--format=", r["landed_sha"], env=env.env)
            self.assertEqual(files.stdout.decode().split(), ["src/engine/eta.mjs"])
            parent = S.git(env.repo, "rev-parse", r["landed_sha"] + "^", env=env.env).stdout.decode().strip()
            self.assertEqual(parent, r["origin_before"])
        finally:
            env.cleanup()

    def test_c_mrg_16_crash_after_push(self) -> None:
        env = B.B06Env()
        try:
            env.write("src/engine/eta.mjs", "export const eta = 52;\n")
            mf = env.message("feat(engine): crash test")
            penv = dict(env.env, EXEC_TEST_FAULT="merge-after-push")
            proc = subprocess.run([sys.executable, str(B.DRIVER), "merge", "--task", "T005", "--attempt", "1",
                                   "--wave", "W01", "--single-tree", "--message-file", str(mf)], cwd=str(env.repo),
                                  env=penv, capture_output=True, timeout=240)
            self.assertEqual(proc.returncode, 70)
            intent = env.layout.merge_intent("T005", 1, 0)
            self.assertTrue(intent.is_file())
            self.assertFalse(env.receipt_path().exists())
            landed = env.origin_main()
            code, envl, _l = env.merge_single(rerun=1)
            self.assertEqual(code, 4)
            self.assertEqual(envl["errors"][0]["code"], "E_ALREADY_LANDED")
            self.assertEqual(envl["data"]["landed_sha"], landed)
            self.assertEqual(env.origin_main(), landed)  # never a second copy
            self.assertFalse(intent.exists())
        finally:
            env.cleanup()

    def test_c_mrg_19_budget(self) -> None:
        machine = dict(S.build_profile()["machine"], agent_command_budget_s=120)
        env = B.B06Env()
        try:
            prof = jsonio.read_json(env.layout.profile)
            prof["machine"] = dict(machine, scratch_root=prof["machine"]["scratch_root"])
            jsonio.write_json_atomic(env.layout.profile, prof)
            S.write_json(env.layout.timings, {"merge": {"code": {"gates": 200.0}}})
            env.write("src/engine/eta.mjs", "export const eta = 53;\n")
            before = env.origin_main()
            code, envl, _l = env.merge_single()
            self.assertEqual(code, 3)
            self.assertEqual(envl["errors"][0]["code"], "E_TIME_BUDGET")
            self.assertEqual(env.origin_main(), before)
            self.assertFalse(env.layout.merge_gates_dir("T005", 1, 0).exists())
            # what it did is written (CLI.md 0.6): the partial state and the measured steps; no merge receipt
            partial = envl["data"]["partial"]
            self.assertEqual((partial["stopped_at"], partial["push_attempts"], partial["intent_kept"]),
                             ("gates", 0, False))
            self.assertEqual(jsonio.read_json(Path(envl["data"]["partial_path"])), partial)
            self.assertFalse(env.receipt_path().exists())
            measured = jsonio.read_json(env.layout.timings)["merge"]["code"]
            self.assertEqual(measured["gates"], 200.0)  # the known duration is kept
            self.assertIn("scans", measured)
            prof["machine"].pop("agent_command_budget_s")
            jsonio.write_json_atomic(env.layout.profile, prof)
            code, envl, _l = env.merge_single(rerun=1)
            self.assertEqual(code, 0, envl["errors"])
        finally:
            env.cleanup()

    def test_c_mrg_20_linked_worktree(self) -> None:
        env = B.B06Env()
        try:
            wt = env.repo / ".claude" / "worktrees" / "w1"
            env.git("worktree", "add", "--quiet", "-b", "w1", str(wt), "origin/main")
            env.write("src/engine/eta.mjs", "export const eta = 54;\n")
            mf = env.message("feat(engine): from a worktree")
            code, envl, _l = env.run("merge", "--task", "T005", "--attempt", "1", "--wave", "W01", "--single-tree",
                                     "--message-file", str(mf), cwd=wt)
            self.assertEqual(code, 0, envl["errors"])
            self.assertTrue(env.receipt_path().is_file())
            self.assertFalse((wt / ".execution").exists())
            events_text = env.layout.events.read_text(encoding="utf-8")
            self.assertIn("merge.landed", events_text)
        finally:
            env.cleanup()

    def test_c_mrg_21_env_failure_in_a_gate(self) -> None:
        gate = [{"name": "full", "cmd": [sys.executable, "-c",
                                         "import sys; print('write failed: ENOSPC: no space left on device'); "
                                         "sys.exit(1)"]}]
        env = B.B06Env(gates=gate)
        try:
            env.write("src/engine/eta.mjs", "export const eta = 55;\n")
            code, envl, _l = env.merge_single()
            self.assertEqual(code, 3)
            self.assertEqual(envl["errors"][0]["code"], "E_ENV")
            jsonio.write_json_atomic(env.layout.gates_json, {"install": [], "gates": [
                {"name": "red", "cmd": [sys.executable, "-c", "import sys; sys.exit(1)"]}]})
            code, envl, _l = env.merge_single(rerun=1)
            self.assertEqual(code, 1)  # positive control: a plain red gate is gate-failed
            self.assertEqual(envl["data"]["outcome"], "gate-failed")
        finally:
            env.cleanup()


@unittest.skipUnless(S.tool_available("git"), "git is needed")
class FeWorkspaceAndSnapshot(unittest.TestCase):
    """CLI.md `fe-workspace` (exclusive worktree per run key, idempotent) and `snapshot` (a commit of the given
    paths on origin/main at refs/exec/<task>/td-a<n>r<k>, the checkout untouched)."""

    def setUp(self) -> None:
        self.env = B.B06Env()

    def tearDown(self) -> None:
        self.env.cleanup()

    def test_fe_workspace_created_then_reused_then_rebuilt(self) -> None:
        code, envl, _l = self.env.run("fe-workspace", "--task", "T005", "--attempt", "1", "--by", "implementer")
        self.assertEqual(code, 0, envl["errors"])
        data = envl["data"]
        wt = Path(data["worktree"])
        self.assertEqual((data["branch"], data["reused"]), ("exec/T005-a1r0", False))
        self.assertEqual(data["install"], {"ran": False, "exit_code": None})
        self.assertTrue(wt.is_dir())
        self.assertTrue(S.paths.posix(wt).startswith(S.paths.posix(self.env.scratch)))
        code, envl, _l = self.env.run("fe-workspace", "--task", "T005", "--attempt", "1")
        self.assertEqual((code, envl["data"]["reused"]), (0, True))
        S.write_text(wt / "src" / "engine" / "eta.mjs", "export const eta = 'round 1';\n")
        S.git(wt, "commit", "--quiet", "-am", "fix(engine): round 1", env=self.env.env)
        kept = S.git(wt, "rev-parse", "HEAD", env=self.env.env).stdout.decode().strip()
        S.write_text(wt / "dirty.txt", "uncommitted\n")
        code, envl, _l = self.env.run("fe-workspace", "--task", "T005", "--attempt", "1")
        self.assertEqual((code, envl["data"]["reused"]), (0, False))
        self.assertFalse((wt / "dirty.txt").exists())
        head = S.git(wt, "rev-parse", "HEAD", env=self.env.env).stdout.decode().strip()
        self.assertEqual(head, kept)  # a dead run's commits are never reset away
        code, envl, _l = self.env.run("fe-workspace", "--task", "T005", "--attempt", "1", "--rerun", "1")
        self.assertEqual((code, envl["data"]["branch"]), (0, "exec/T005-a1r1"))

    def test_fe_workspace_low_resources(self) -> None:
        low = self.env.private / "low.json"
        S.write_json(low, {"disk_free_gb": 0.1, "ram_free_gb": 16.0})
        code, envl, _l = self.env.run("fe-workspace", "--task", "T005", "--attempt", "1",
                                      env=dict(self.env.env, EXEC_GOVERNOR_READINGS=str(low)))
        self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_ENV"))

    def test_snapshot(self) -> None:
        self.env.write("src/engine/eta.test.mjs", "test('eta', () => {})\n")
        self.env.write("src/cli/main.mjs", "export const cli = 'neighbour';\n")
        before = tree_snapshot(self.env.repo)
        origin = self.env.origin_main()
        mf = self.env.message("test(engine): eta tests")
        code, envl, _l = self.env.run("snapshot", "--task", "T005", "--attempt", "1", "--paths", "src/engine/**",
                                      "--message-file", str(mf), "--by", "test-designer")
        self.assertEqual(code, 0, envl["errors"])
        data = envl["data"]
        self.assertEqual(data["ref"], "refs/exec/T005/td-a1r0")
        self.assertEqual([p["path"] for p in data["paths"]], ["src/engine/eta.mjs", "src/engine/eta.test.mjs"])
        parent = S.git(self.env.repo, "rev-parse", data["sha"] + "^", env=self.env.env).stdout.decode().strip()
        self.assertEqual(parent, origin)
        self.assertEqual(tree_snapshot(self.env.repo), before)
        self.assertEqual(self.env.origin_main(), origin)
        code, envl, _l = self.env.run("snapshot", "--task", "T005", "--attempt", "1", "--paths", "src/cli/**",
                                      "--message-file", str(mf))
        self.assertEqual(code, 1)
        bad = self.env.message("test: x\n\n" + S.planted("trailer.signoff"), "bad.txt")
        code, envl, _l = self.env.run("snapshot", "--task", "T005", "--attempt", "1", "--paths", "src/engine/**",
                                      "--message-file", str(bad))
        self.assertEqual(code, 4)

    def test_snapshot_budget(self) -> None:
        """CLI.md 0.6: snapshot is agent-invoked, so a step whose last duration no longer fits is not started."""
        self.env.write("src/engine/eta.test.mjs", "test('eta', () => {})\n")
        prof = jsonio.read_json(self.env.layout.profile)
        prof["machine"]["agent_command_budget_s"] = 120
        jsonio.write_json_atomic(self.env.layout.profile, prof)
        S.write_json(self.env.layout.timings, {"snapshot": {"code": {"commit": 900.0}}})
        mf = self.env.message("test(engine): eta tests")
        args = ("snapshot", "--task", "T005", "--attempt", "1", "--paths", "src/engine/**", "--message-file", str(mf),
                "--by", "test-designer")
        code, envl, _l = self.env.run(*args)
        self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_TIME_BUDGET"))
        self.assertEqual(envl["data"]["step"], "commit")
        ref = S.git(self.env.repo, "for-each-ref", "refs/exec/", env=self.env.env).stdout.decode().strip()
        self.assertEqual(ref, "")  # nothing recorded
        self.env.layout.timings.unlink()
        code, envl, _l = self.env.run(*args)  # positive control
        self.assertEqual(code, 0, envl["errors"])
        steps = jsonio.read_json(self.env.layout.timings)["snapshot"]["code"]
        self.assertEqual(sorted(steps), ["commit", "fetch"])

    def test_integration_worktree_default_link(self) -> None:
        """F6: called with the MODULES.md signature (no keyword), node_modules is a junction to the shared install
        unless a manifest changed between origin/main and the commit."""
        git = gitutil.Git(self.env.repo)
        S.write_text(self.env.repo / "node_modules" / "dep" / "index.js", "module.exports = 1;\n")
        exclude = self.env.repo / ".git" / "info" / "exclude"
        old = exclude.read_text(encoding="utf-8") if exclude.is_file() else ""
        S.write_text(exclude, old + ("" if old.endswith("\n") or not old else "\n") + "node_modules/\n")
        parent = S.mkdtemp()
        try:
            self.env.write("src/engine/eta.mjs", "export const eta = 71;\n")
            self.env.repo_obj.commit_all("feat(engine): code only")
            code_only = self.env.repo_obj.head()
            dest = merge.integration_worktree(git, code_only, parent / "a", self.env.repo)
            self.assertTrue(S.paths.is_link_like(dest / "node_modules"))
            self.assertTrue((dest / "node_modules" / "dep" / "index.js").is_file())
            git.worktree_remove_link_safe(dest)
            self.assertTrue((self.env.repo / "node_modules" / "dep" / "index.js").is_file())  # the install survives
            self.env.write("package.json", "{\"name\": \"x\"}\n")
            self.env.repo_obj.commit_all("build: add a manifest")
            manifest = self.env.repo_obj.head()
            dest = merge.integration_worktree(git, manifest, parent / "b", self.env.repo)
            self.assertFalse((dest / "node_modules").exists())
            git.worktree_remove_link_safe(dest)
            # an explicit keyword still wins
            dest = merge.integration_worktree(git, manifest, parent / "c", self.env.repo, link_node_modules=True)
            self.assertTrue(S.paths.is_link_like(dest / "node_modules"))
            git.worktree_remove_link_safe(dest)
        finally:
            S.rmtree(parent)


class Units(unittest.TestCase):
    def test_scan_verdict_policy_first(self) -> None:
        from execlib import integrity
        scans = [integrity.Scan("writes-scope", "fail", "x", None), integrity.Scan("never-show", "fail", "y", None)]
        outcome, err = merge._scan_verdict(scans)
        self.assertEqual(outcome, "refused")
        self.assertIsInstance(err, PolicyRefused)
        self.assertEqual(err.code, "E_NEVER_SHOW")  # type: ignore[union-attr]
        outcome, err = merge._scan_verdict(scans[:1])
        self.assertEqual((outcome, err.exit_code), ("scan-failed", 1))  # type: ignore[union-attr]
        self.assertEqual(merge._scan_verdict([integrity.Scan("trailers", "ok", "", None)]), (None, None))

    def test_manifest_and_state_only(self) -> None:
        self.assertTrue(merge._is_manifest("package.json"))
        self.assertTrue(merge._is_manifest("packages/a/package.json"))
        self.assertTrue(merge._is_manifest(".github/workflows/ci.yml"))
        self.assertFalse(merge._is_manifest("src/a.ts"))
        self.assertTrue(merge._is_state_only({"writes": [".execution/frontend/**"]}))
        self.assertFalse(merge._is_state_only({"writes": [".execution/frontend/**", "src/**"]}))


if __name__ == "__main__":
    unittest.main()
