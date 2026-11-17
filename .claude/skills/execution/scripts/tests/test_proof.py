"""Proof runs and verdicts (contract/TESTS.md 5.2, LANES.md B06, FRONTEND.md 2.8): command proofs through the real
gates.py in a clean clone; the pre-implementation and planted-defect controls; file (json_checks), url (local
http.server), ci (fake gh), tx (fake reader) and human-attest types, each with a planted forgery and its honest
control; resources, budget-free env isolation, EXEC_ENV_FILE, forbidden commands, timeout; verdict refusals and the
accepted verdict while the status still says `running`. Contract revision 3: the control requirement of the done
check (an infra task included), a refused verdict that writes nothing (B04's done check before any transition, a
rollback after), the plan's recorded control as evidence on disk only, the proven-public tx hash (registered when the
reader confirms it, named by its sha256 otherwise) and gh answers that are no answer.

Most tests fake the modules of other lanes (results, status: B04; governor: B08) with the MODULES.md signatures
(`_support_B06`), in-process and in the CLI driver. B04 and B08 are integrated: `RealB04Verdict` runs the real
exec.py with the real modules, and the in-process rollback test drives B04's real status module.

Run: python -m unittest discover -s scripts/tests -p "test_proof.py" -v
"""
from __future__ import annotations

import copy
import functools
import hashlib
import json
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path
from unittest import mock

import _support as S
import _support_B06 as B

from execlib import integrity, jsonio, locks, model as model_mod, paths, plan as plan_mod, proof
from execlib.errors import ErrorItem, PolicyRefused, TransitionRefused
from execlib.log import get_logger
from execlib.model import Ctx

HARDEN_OK = (Path.home() / ".claude" / "skills" / "harden" / "scripts" / "gates.py").is_file()
NEEDS = unittest.skipUnless(HARDEN_OK and S.tool_available("git"), "/harden's gates.py and git are needed")
SLOW = unittest.skipUnless(os.environ.get("EXEC_SLOW") == "1",
                           "slow tier (TESTS.md 1.2: real gates.py runs); run with EXEC_SLOW=1")


def land(env: B.B06Env, files: dict[str, str], msg: str = "feat(engine): change", *, task: str = "T005",
         commits: int = 1, wave: str = "W01", attempt: int = 1) -> tuple[str, str]:
    """Commit `files` (in `commits` commits) on main, push, and write the landed merge receipt; (base, sha)."""
    base = env.repo_obj.head()
    items = list(files.items())
    for i in range(commits):
        part = items[i::commits] if commits > 1 else items
        for rel, text in part:
            env.write(rel, text)
        if not part:
            env.write(f"src/engine/filler{i}.txt", f"{i}\n")
        env.repo_obj.commit_all(f"{msg} {i}")
    env.git("push", "--quiet", "origin", "main")
    sha = env.repo_obj.head()
    receipt = S.build_merge_receipt(task, origin_before=base, head_before=base, landed_sha=sha, wave=wave,
                                    attempt=attempt)
    S.write_json(env.layout.result(wave, task, "merge", attempt), receipt)
    return base, sha


def set_proof(env: B.B06Env, task: str, proof_doc: dict) -> None:
    """Replace a task's proof in the state's plan.json (the plan's own schema still applies)."""
    plan = jsonio.read_json(env.layout.plan)
    for t in plan["tasks"]:
        if t["id"] == task:
            t["proof"] = proof_doc
    jsonio.write_json_atomic(env.layout.plan, plan)


def command_proof(cmd: str, **expect: object) -> dict:
    exp = {"summary": "the proof holds", "exit_code": 0}
    exp.update(expect)
    return {"type": "command", "spec": {"cmd": cmd, "shell": "bash", "cwd": ".", "install": False},
            "expect": exp, "max_runtime_min": 2,
            "negative_control": {"kind": "pre-implementation", "description": "fails on the parent",
                                 "expect_nonzero": True}}


def run_proof_cli(env: B.B06Env, sha: str, *extra: str, task: str = "T005", by: str = "verifier"
                  ) -> tuple[int, dict]:
    code, envelope, _logs = env.run("proof", "run", "--task", task, "--sha", sha, "--by", by, *extra)
    return code, envelope


@NEEDS
class CommandProof(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.env = B.B06Env()
        cls.base, cls.sha = land(cls.env, {"src/engine/eta.mjs": "export const eta = 2;\n"})

    @classmethod
    def tearDownClass(cls) -> None:
        cls.env.cleanup()

    def test_c_prf_01_02_clean_clone_and_stable_hash(self) -> None:
        code, env1 = run_proof_cli(self.env, self.sha)
        self.assertEqual(code, 0, env1["errors"])
        doc = env1["data"]
        self.assertEqual(doc["checkout"]["kind"], "clone")
        self.assertTrue(doc["checkout"]["removed"])
        self.assertTrue(doc["checkout"]["path"].startswith(S.paths.posix(self.env.scratch)))
        self.assertFalse(Path(doc["checkout"]["path"]).exists())
        log = Path(doc["output_path"]).read_bytes()
        self.assertEqual(log, b"proof-ok\n")
        self.assertEqual(doc["output_sha256"], hashlib.sha256(b"proof-ok\n").hexdigest())
        self.assertTrue(Path(doc["gates_result_path"]).is_file())
        cfg = jsonio.read_json(Path(doc["output_path"]).parent / "config.json")
        self.assertFalse(cfg["inherit_env"])
        self.assertEqual(len(cfg["gates"]), 1)
        code2, env2 = run_proof_cli(self.env, self.sha)
        self.assertEqual(code2, 0)
        self.assertEqual(env2["data"]["output_sha256"], doc["output_sha256"])
        self.assertNotEqual(env2["data"]["run_id"], doc["run_id"])
        self.assertTrue(doc["run_id"].endswith("-1") and env2["data"]["run_id"].endswith("-2"))

    @SLOW
    def test_c_prf_03_proof_hash(self) -> None:
        task = proof.task_raw(jsonio.read_json(self.env.layout.plan), "T005")
        code, envl = run_proof_cli(self.env, self.sha)
        self.assertEqual(envl["data"]["proof_hash"], plan_mod.proof_digest(task))
        recorded = copy.deepcopy(task)
        recorded["proof"]["negative_control"]["recorded"] = {"run": envl["data"]["run_id"], "exit_code": 1,
                                                             "at_utc": S.FIXED_NOW}
        self.assertEqual(plan_mod.proof_digest(recorded), plan_mod.proof_digest(task))
        edited = copy.deepcopy(task)
        edited["proof"]["spec"]["cmd"] = "printf other"
        self.assertNotEqual(plan_mod.proof_digest(edited), plan_mod.proof_digest(task))

    @SLOW
    def test_c_prf_06_env_isolation_through_gates(self) -> None:
        env = dict(self.env.env)
        env["EXEC_B06_VISIBLE"] = "leak"
        set_proof(self.env, "T005", command_proof('printf "[%s]" "$EXEC_B06_VISIBLE"'))
        try:
            code, envl, _l = run_exec_args(self.env, ["proof", "run", "--task", "T005", "--sha", self.sha,
                                                      "--by", "verifier"], env)
            self.assertEqual(code, 0)
            self.assertEqual(Path(envl["data"]["output_path"]).read_bytes(), b"[]")
            allowed = command_proof('printf "[%s]" "$EXEC_B06_VISIBLE"')
            allowed["spec"]["env_allowlist"] = list(proof.DEFAULT_ALLOWLIST) + ["EXEC_B06_VISIBLE"]
            set_proof(self.env, "T005", allowed)
            code, envl, _l = run_exec_args(self.env, ["proof", "run", "--task", "T005", "--sha", self.sha,
                                                      "--by", "verifier"], env)
            self.assertEqual(Path(envl["data"]["output_path"]).read_bytes(), b"[leak]")
        finally:
            set_proof(self.env, "T005", command_proof(B.PROOF_OK))

    @SLOW
    def test_command_forgeries_and_honest_controls(self) -> None:
        cases = [
            (command_proof("printf PASS; exit 1"), 1),
            (command_proof("printf PASS"), 0),
            (command_proof("printf '{\"ok\": false}'", json=[{"pointer": "/ok", "equals": True}]), 1),
            (command_proof("printf '{\"ok\": true}'", json=[{"pointer": "/ok", "equals": True}]), 0),
            (command_proof("printf 'nothing'", stdout_regex="^all \\d+ passed"), 1),
            (command_proof("printf 'all 3 passed'", stdout_regex="^all \\d+ passed"), 0),
        ]
        try:
            for proof_doc, want in cases:
                with self.subTest(cmd=proof_doc["spec"]["cmd"]):
                    set_proof(self.env, "T005", proof_doc)
                    code, envl = run_proof_cli(self.env, self.sha)
                    self.assertEqual(code, want, envl["errors"])
                    self.assertEqual(envl["data"]["expectation"]["met"], want == 0)
        finally:
            set_proof(self.env, "T005", command_proof(B.PROOF_OK))

    def test_c_prf_07_forbidden_command_refused_before_running(self) -> None:
        runs = self.env.layout.local / "proof-runs" / "T005"
        before = sorted(p.name for p in runs.iterdir()) if runs.is_dir() else []
        try:
            for cmd in (f"node --env-file={S.planted('env.local')} x.js", "printf x --allow-skip"):
                with self.subTest(cmd=cmd):
                    set_proof(self.env, "T005", command_proof(cmd))
                    code, envl = run_proof_cli(self.env, self.sha)
                    self.assertEqual(code, 4)
            pol = jsonio.read_json(self.env.layout.policy)
            pol["deny_commands"] = [{"pattern": "curl\\s", "reason": "no network in proofs"}]
            jsonio.write_json_atomic(self.env.layout.policy, pol)
            set_proof(self.env, "T005", command_proof("curl https://example.invalid"))
            code, _e = run_proof_cli(self.env, self.sha)
            self.assertEqual(code, 4)
            set_proof(self.env, "T005", command_proof(f"cat {S.planted('env.example')} >/dev/null; printf ok"))
            code, _e = run_proof_cli(self.env, self.sha)
            self.assertNotEqual(code, 4)  # positive control: the template name is allowed
        finally:
            pol = jsonio.read_json(self.env.layout.policy)
            pol["deny_commands"] = []
            jsonio.write_json_atomic(self.env.layout.policy, pol)
            set_proof(self.env, "T005", command_proof(B.PROOF_OK))
        after = sorted(p.name for p in runs.iterdir()) if runs.is_dir() else []
        self.assertEqual(len(after) - len(before), 1)  # only the allowed run left a directory

    def test_c_prf_10_governor_below_floor(self) -> None:
        low = self.env.private / "low.json"
        S.write_json(low, {"disk_free_gb": 0.5, "ram_free_gb": 16.0, "scratch_disk_free_gb": 0.5})
        env = dict(self.env.env)
        env["EXEC_GOVERNOR_READINGS"] = str(low)
        runs = self.env.layout.local / "proof-runs" / "T005"
        before = len(list(runs.iterdir())) if runs.is_dir() else 0
        code, envl, _l = run_exec_args(self.env, ["proof", "run", "--task", "T005", "--sha", self.sha], env)
        self.assertEqual(code, 3)
        self.assertEqual(envl["errors"][0]["code"], "E_ENV")
        self.assertEqual(len(list(runs.iterdir())) if runs.is_dir() else 0, before)
        code, _e, _l = run_exec_args(self.env, ["proof", "run", "--task", "T005", "--sha", self.sha], self.env.env)
        self.assertEqual(code, 0)  # positive control: the default readings pass

    @SLOW
    def test_c_prf_10_disk_heavy_serialises(self) -> None:
        holder = self.env.private / "hold.py"
        S.write_text(holder, "\n".join([
            "import sys, time",
            f"sys.path.insert(0, {str(S.SCRIPTS_DIR)!r})",
            "from execlib import locks, paths",
            f"layout = paths.layout_for(None, __import__('pathlib').Path({str(self.env.layout.state)!r}))",
            "with locks.hold(layout, 'disk-heavy', command='test-holder'):",
            "    print('held', flush=True)",
            "    time.sleep(3)",
        ]) + "\n")
        proc = subprocess.Popen([sys.executable, str(holder)], stdout=subprocess.PIPE, env=self.env.env)
        try:
            self.assertEqual(proc.stdout.readline().strip(), b"held")  # type: ignore[union-attr]
            t0 = time.monotonic()
            code, _env = run_proof_cli(self.env, self.sha)
            waited = time.monotonic() - t0
        finally:
            proc.wait(timeout=30)
            proc.stdout.close()  # type: ignore[union-attr]
        self.assertEqual(code, 0)
        self.assertGreater(waited, 2.0)


def run_exec_args(env: B.B06Env, args: list[str], process_env: dict) -> tuple[int, dict, list[dict]]:
    return B.run_exec_fakes(args, env.repo, process_env)


@NEEDS
@SLOW
class Controls(unittest.TestCase):
    def setUp(self) -> None:
        self.env = B.B06Env()

    def tearDown(self) -> None:
        self.env.cleanup()

    def test_c_prf_04_pre_implementation_on_origin_before_not_parent(self) -> None:
        set_proof(self.env, "T005", command_proof("test -f src/engine/feature.txt && printf ok"))
        base, sha = land(self.env, {"src/engine/feature.txt": "f\n", "src/engine/a.txt": "a\n",
                                    "src/engine/b.txt": "b\n"}, commits=3)
        parent_has_it = subprocess.run(["git", "cat-file", "-e", f"{sha}^:src/engine/feature.txt"],
                                       cwd=self.env.repo, env=self.env.env).returncode == 0
        self.assertTrue(parent_has_it)  # sha^ would hold the feature: a control there would wrongly pass
        code, envl = run_proof_cli(self.env, sha, "--negative-control", by="test-designer")
        self.assertEqual(code, 0, envl["errors"])
        nc = envl["data"]["negative_control"]
        self.assertEqual((nc["kind"], nc["ran"], nc["met"]), ("pre-implementation", True, True))
        self.assertIn(base, " ".join(envl["data"]["expectation"]["details"]))
        set_proof(self.env, "T005", command_proof("printf ok"))
        code, envl = run_proof_cli(self.env, sha, "--negative-control", by="test-designer")
        self.assertEqual(code, 1)
        self.assertFalse(envl["data"]["negative_control"]["met"])

    def test_c_prf_05_planted_defect_patch_on_the_clone_only(self) -> None:
        base, sha = land(self.env, {"src/engine/eta.mjs": "export const eta = 2;\n"})
        self.env.write("src/engine/eta.mjs", "export const eta = 0;\n")
        patch = S.git(self.env.repo, "diff", env=self.env.env).stdout.decode("utf-8")
        self.env.git("checkout", "--", "src/engine/eta.mjs")
        S.write_text(self.env.layout.state / "negative-controls" / "T005.patch", patch)
        pd = command_proof("grep -q 'eta = 2' src/engine/eta.mjs && printf ok")
        pd["negative_control"] = {"kind": "planted-defect", "description": "eta zeroed",
                                  "patch_path": "negative-controls/T005.patch", "expect_nonzero": True}
        set_proof(self.env, "T005", pd)
        before = (self.env.repo / "src/engine/eta.mjs").read_bytes()
        code, envl = run_proof_cli(self.env, sha, "--negative-control", by="test-designer")
        self.assertEqual(code, 0, envl["errors"])
        self.assertTrue(envl["data"]["negative_control"]["met"])
        self.assertEqual((self.env.repo / "src/engine/eta.mjs").read_bytes(), before)
        code, envl = run_proof_cli(self.env, sha)  # positive: the honest proof passes on the same SHA
        self.assertEqual(code, 0)

    def test_plant_ops_on_copies_and_missing_target(self) -> None:
        base, sha = land(self.env, {"src/engine/eta.mjs": "export const eta = 2;\n"})
        fe = self.env.layout.state / "frontend"
        S.write_json(fe / "brief.json", {"hero": {"source": "ref-1"}})
        S.write_text(fe / "directions" / "A" / "hero-mobile.png", "png-a")
        S.write_text(fe / "directions" / "B" / "hero-mobile.png", "png-b")
        before = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in fe.rglob("*") if p.is_file()}
        state = S.paths.posix(self.env.layout.state)
        check = (f"python -c \"import json,sys; d=json.load(open('{state}/frontend/brief.json')); "
                 f"sys.exit(0 if d['hero']['source'] else 1)\" && test -f {state}/frontend/directions/B/hero-mobile.png"
                 " && grep -q 'eta = 2' src/engine/eta.mjs")
        plant = {"version": 1, "ops": [
            {"op": "json-set", "target": "state", "path": "brief.json", "pointer": "/hero/source", "value": ""},
            {"op": "delete", "target": "state", "path": "directions/C/hero-mobile.png"},
            {"op": "regex-replace", "target": "checkout", "path": "src/engine/eta.mjs", "pattern": "eta = 2",
             "replacement": "eta = 9"},
        ]}
        S.write_json(self.env.layout.state / "negative-controls" / "T005.plant.json", plant)
        pd = command_proof(check)
        pd["negative_control"] = {"kind": "planted-defect", "description": "plants",
                                  "patch_path": "negative-controls/T005.plant.json", "expect_nonzero": True}
        set_proof(self.env, "T005", pd)
        code, envl = run_proof_cli(self.env, sha, "--negative-control", by="test-designer")
        self.assertEqual(code, 0, envl["errors"])
        self.assertTrue(envl["data"]["negative_control"]["met"])
        after = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in fe.rglob("*") if p.is_file()}
        self.assertEqual(before, after)  # the real state is untouched
        code, envl = run_proof_cli(self.env, sha)
        self.assertEqual(code, 0, envl["errors"])  # positive control: the honest proof passes
        plant["ops"] = [{"op": "delete", "target": "state", "path": "nothing-here/x.png"}]
        S.write_json(self.env.layout.state / "negative-controls" / "T005.plant.json", plant)
        code, envl = run_proof_cli(self.env, sha, "--negative-control", by="test-designer")
        self.assertEqual(code, 3)
        self.assertIn("no target", envl["errors"][0]["message"])

    def test_c_prf_11_snapshot_sha_reachable(self) -> None:
        self.env.write("src/engine/new.test.mjs", "test\n")
        mf = self.env.message("test(engine): snapshot of the new tests")
        code, envl, _l = self.env.run("snapshot", "--task", "T005", "--attempt", "1", "--paths",
                                      "src/engine/new.test.mjs", "--message-file", str(mf), "--by", "test-designer")
        self.assertEqual(code, 0, envl["errors"])
        snap = envl["data"]["sha"]
        branches = S.git(self.env.repo, "branch", "--contains", snap, env=self.env.env).stdout.strip()
        self.assertEqual(branches, b"")  # on no branch
        set_proof(self.env, "T005", command_proof("test -f src/engine/new.test.mjs && printf ok"))
        code, envl = run_proof_cli(self.env, snap, by="test-designer")
        self.assertEqual(code, 0, envl["errors"])

    def test_c_prf_09_long_path_clone(self) -> None:
        long_rel = "src/engine/" + "/".join(["d" * 50] * 4) + "/" + "f" * 40 + ".txt"
        blob = S.git(self.env.repo, "hash-object", "-w", "--stdin", env=self.env.env, input_text="x\n").stdout
        blob_sha = blob.decode().strip()
        self.env.git("update-index", "--add", "--cacheinfo", f"100644,{blob_sha},{long_rel}")
        base = self.env.repo_obj.head()
        msg = self.env.message("feat(engine): long path")
        self.env.git("commit", "--quiet", "-F", str(msg))
        self.env.git("push", "--quiet", "origin", "main")
        sha = self.env.repo_obj.head()
        S.write_json(self.env.layout.result("W01", "T005", "merge", 1),
                     S.build_merge_receipt("T005", origin_before=base, head_before=base, landed_sha=sha))
        self.assertGreater(len(S.paths.posix(self.env.scratch)) + 40 + len(long_rel), 260)
        code, envl = run_proof_cli(self.env, sha)
        self.assertEqual(code, 0, envl["errors"])


@NEEDS
@SLOW
class Timeout(unittest.TestCase):
    def test_c_prf_08_timeout(self) -> None:
        env = B.B06Env()
        try:
            _b, sha = land(env, {"src/engine/eta.mjs": "export const eta = 3;\n"})
            pd = command_proof("sleep 40")
            pd["spec"]["timeout_s"] = 10
            set_proof(env, "T005", pd)
            t0 = time.monotonic()
            code, envl = run_proof_cli(env, sha)
            self.assertLess(time.monotonic() - t0, 35)
            self.assertEqual(code, 1)
            self.assertTrue(envl["data"]["timed_out"])
            self.assertFalse(envl["data"]["expectation"]["met"])
        finally:
            env.cleanup()


@NEEDS
class EnvFile(unittest.TestCase):
    @SLOW
    def test_c_prf_12_exec_env_file(self) -> None:
        env = B.B06Env()
        try:
            env_file = S.paths.posix(env.private / "secrets" / "app.vars")
            pol = jsonio.read_json(env.layout.policy)
            pol["secrets"]["env_file"] = env_file
            jsonio.write_json_atomic(env.layout.policy, pol)
            plan = jsonio.read_json(env.layout.plan)
            plan["tasks"][0]["resources"] = ["wallet:test"]
            plan["tasks"][0]["proof"] = command_proof('printf "%s|%s" "$EXEC_ENV_FILE" "$EXEC_B06_OTHER"')
            jsonio.write_json_atomic(env.layout.plan, plan)
            _b, sha = land(env, {"src/engine/eta.mjs": "export const eta = 4;\n"})
            penv = dict(env.env)
            penv["EXEC_B06_OTHER"] = "parent-value"
            code, envl, _l = B.run_exec_fakes(["proof", "run", "--task", "T005", "--sha", sha], env.repo, penv)
            self.assertEqual(code, 0, envl["errors"])
            self.assertEqual(Path(envl["data"]["output_path"]).read_bytes(), f"{env_file}|".encode())
            set_proof(env, "T005", command_proof(f"node --env-file={env_file} x.js"))
            code, envl, _l = B.run_exec_fakes(["proof", "run", "--task", "T005", "--sha", sha], env.repo, penv)
            self.assertEqual(code, 4)
        finally:
            env.cleanup()

    @unittest.skipUnless((Path.home() / ".claude" / "hooks" / "guard.py").is_file(), "the global guard is needed")
    def test_global_guard_allows_the_variable_form(self) -> None:
        guard = Path.home() / ".claude" / "hooks" / "guard.py"
        home = S.mkdtemp()
        try:
            genv = S.env_isolated(HOME=str(home), USERPROFILE=str(home))

            def verdict(cmd: str) -> int:
                payload = {"tool_name": "Bash", "tool_input": {"command": cmd}, "hook_event_name": "PreToolUse"}
                return subprocess.run([sys.executable, str(guard)], input=json.dumps(payload).encode(),
                                      capture_output=True, env=genv, timeout=30).returncode

            S.assert_controlled(self, negative=lambda: self.assertEqual(
                verdict('node --env-file="$EXEC_ENV_FILE" x.js'), 0),
                positive=lambda: self.assertEqual(verdict(f"cat {S.planted('env.local')}"), 2))
        finally:
            S.rmtree(home)


# --- other proof types -----------------------------------------------------------------------------------------------

def file_proof(spec: dict) -> dict:
    return {"type": "file", "spec": spec, "expect": {"summary": "the file holds"}, "max_runtime_min": 1,
            "negative_control": {"kind": "forgery", "description": "a forged file", "expect_nonzero": True}}


class FileChecks(unittest.TestCase):
    """check_file / json_checks in-process (honest and forged, TESTS.md C-PRF-13 and the file forgeries)."""

    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        (self.tmp / "directions" / "A").mkdir(parents=True)
        self.base = S.paths.posix(self.tmp / "directions")

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def _choices(self, **h1: object) -> Path:
        entry = {"pick": "A", "answered_at": S.FIXED_NOW, "channel": "notion"}
        entry.update(h1)
        return S.write_json(self.tmp / "choices.json", {"H1": entry})

    def _spec(self) -> dict:
        return {"path": S.paths.posix(self.tmp / "choices.json"), "json_pointer": "/H1", "json_checks": [
            {"pointer": "/pick", "check": "dir-exists", "base": self.base},
            {"pointer": "/answered_at", "check": "utc"},
            {"pointer": "/channel", "check": "enum", "values": ["notion", "remote-control", "ask-user-question",
                                                                "terminal"]}]}

    def test_choices_honest_and_forged(self) -> None:
        self._choices()
        self.assertTrue(proof.check_file(self._spec())["met"])
        for forged in ({"pick": "Z"}, {"pick": "../A"}, {"answered_at": "2026-10-03 07:12"},
                       {"channel": "email"}):
            with self.subTest(forged=forged):
                self._choices(**forged)
                self.assertFalse(proof.check_file(self._spec())["met"])

    def test_references_min_items_and_url(self) -> None:
        refs = [{"url": "https://a.example", "source": "x", "owner_confirmed": True},
                {"url": "https://b.example", "source": "y", "owner_confirmed": True}]
        p = S.write_json(self.tmp / "profile.json", {"frontend": {"references": refs}})
        spec = {"path": S.paths.posix(p), "json_pointer": "/frontend/references", "json_checks": [
            {"pointer": "", "check": "min-items", "where": {"owner_confirmed": True}, "value": 2},
            {"pointer": "/*/url", "check": "url"}, {"pointer": "/*/source", "check": "non-empty"}]}
        self.assertTrue(proof.check_file(spec)["met"])
        one = copy.deepcopy(refs)
        one[1]["owner_confirmed"] = False
        S.write_json(p, {"frontend": {"references": one}})
        self.assertFalse(proof.check_file(spec)["met"])
        bad_url = copy.deepcopy(refs)
        bad_url[0]["url"] = "ftp://a.example"
        S.write_json(p, {"frontend": {"references": bad_url}})
        self.assertFalse(proof.check_file(spec)["met"])

    def test_file_forgeries(self) -> None:
        S.write_json(self.tmp / "repo" / "out.json", {"version": 2, "name": "queue-clock"})
        base = self.tmp / "repo"
        honest = {"path": "out.json", "json_pointer": "/version", "json_equals": 2, "min_bytes": 5,
                  "must_match": "queue-clock"}
        self.assertTrue(proof.check_file(honest, base=base)["met"])
        for change in ({"json_equals": 3}, {"min_bytes": 10_000}, {"must_match": "absent-text"},
                       {"path": "../outside.json"}, {"path": "missing.json"}):
            with self.subTest(change=change):
                spec = dict(honest)
                spec.update(change)
                self.assertFalse(proof.check_file(spec, base=base)["met"])
        S.write_json(self.tmp / "outside.json", {"version": 2})
        spec = dict(honest, path="../outside.json")
        self.assertIn("escapes", " ".join(proof.check_file(spec, base=base)["details"]))

    def test_json_equality_semantics(self) -> None:
        self.assertFalse(proof.json_equal(True, 1))
        self.assertTrue(proof.json_equal(1, 1.0))
        self.assertTrue(proof.json_equal({"a": [1, {"b": None}]}, {"a": [1, {"b": None}]}))
        self.assertFalse(proof.json_equal([1, 2], [2, 1]))


class _OtherTypes(unittest.TestCase):
    env: B.B06Env
    sha: str

    @classmethod
    def setUpClass(cls) -> None:
        cls.env = B.B06Env()
        cls.base, cls.sha = land(cls.env, {"src/engine/eta.mjs": "export const eta = 5;\n"})

    @classmethod
    def tearDownClass(cls) -> None:
        cls.env.cleanup()

    def run_type(self, proof_doc: dict, env: dict | None = None) -> tuple[int, dict]:
        set_proof(self.env, "T005", proof_doc)
        code, envl, _l = B.run_exec_fakes(["proof", "run", "--task", "T005", "--sha", self.sha, "--by", "verifier"],
                                          self.env.repo, env or self.env.env)
        return code, envl


@NEEDS
class UrlProof(_OtherTypes):
    def test_url_honest_and_forged(self) -> None:
        url, close = S.http_fixture({
            "/ok": (200, "deployed queue clock"), "/plain": (200, "hello"),
            "/away": (302, "", {"Location": "http://localhost:1/elsewhere"}),
            "/same": (302, "", {"Location": "/ok"}),
        })
        try:
            def spec(path: str, status: int = 200) -> dict:
                return {"type": "url", "spec": {"url": url + path, "expect_status": status,
                                                "must_contain": "queue clock", "render": False},
                        "expect": {"summary": "deployed"}, "max_runtime_min": 1,
                        "negative_control": {"kind": "not-applicable", "description": "url",
                                             "expect_nonzero": True, "waived_reason": "deploy url proof"}}
            for path, want in (("/ok", 0), ("/same", 0), ("/plain", 1), ("/missing", 1), ("/away", 1)):
                with self.subTest(path=path):
                    code, envl = self.run_type(spec(path))
                    self.assertEqual(code, want, envl["errors"])
                    self.assertEqual(envl["data"]["checkout"]["kind"], "none")
        finally:
            close()


GH_FAKE = r'''
import json, os, sys
mode = os.environ.get("FAKE_GH_MODE", "ok")
sha = os.environ["FAKE_GH_SHA"]
args = sys.argv[1:]
if args[:2] == ["run", "list"]:
    print(json.dumps([{"databaseId": 42, "status": "completed", "conclusion": "success", "headSha": sha}]))
elif args[:2] == ["run", "view"]:
    doc = {"headSha": sha, "status": "completed", "conclusion": "success", "jobs": []}
    if mode == "other-sha": doc["headSha"] = "f" * 40
    if mode == "skipped": doc["conclusion"] = "skipped"
    if mode == "in-progress": doc["status"] = "in_progress"; doc["conclusion"] = ""
    print(json.dumps(doc))
elif args[:1] == ["api"]:
    print(".github/workflows/other.yml" if mode == "other-workflow" else ".github/workflows/ci.yml")
else:
    sys.exit(2)
'''


@NEEDS
class CiProof(_OtherTypes):
    def test_ci_honest_and_forged(self) -> None:
        tools = S.mkdtemp()
        try:
            B_fake = S.fake_tool(tools, "gh", GH_FAKE)
            self.assertTrue(B_fake.exists())
            doc = {"type": "ci", "spec": {"workflow": "ci.yml", "require": "success"},
                   "expect": {"summary": "CI green"}, "max_runtime_min": 1,
                   "negative_control": {"kind": "forgery", "description": "a forged run", "expect_nonzero": True}}
            for mode, want in (("ok", 0), ("other-sha", 1), ("skipped", 1), ("in-progress", 1),
                               ("other-workflow", 1)):
                with self.subTest(mode=mode):
                    env = S.path_with(tools, self.env.env)
                    env.update({"FAKE_GH_MODE": mode, "FAKE_GH_SHA": self.sha})
                    code, envl = self.run_type(doc, env)
                    self.assertEqual(code, want, envl["errors"])
        finally:
            S.rmtree(tools)

    def test_ci_forgery_control_runs(self) -> None:
        """F2: the EX-CI-shaped forgery control (no command, no patch) runs the built-in forgery: the checks applied
        to a run of another commit (origin_before first) as if it were this SHA's must fail."""
        tools = S.mkdtemp()
        try:
            S.fake_tool(tools, "gh", GH_TABLE_FAKE)
            doc = {"type": "ci", "spec": {"workflow": "ci.yml", "require": "success"},
                   "expect": {"summary": "CI green"}, "max_runtime_min": 5,
                   "negative_control": {"kind": "forgery", "description": "a run of another commit must not do",
                                        "expect_nonzero": True}}
            task = copy.deepcopy(jsonio.read_json(self.env.layout.plan)["tasks"][0])
            task["kind"], task["proof"] = "infra", doc
            self.assertTrue(proof.control_required(task))
            own = {"databaseId": 42, "headSha": self.sha, "status": "completed", "conclusion": "success"}
            before = {"databaseId": 41, "headSha": self.base, "status": "completed", "conclusion": "success"}
            third = {"databaseId": 40, "headSha": "c" * 40, "status": "completed", "conclusion": "success"}

            def go(runs: list[dict], *, control: bool, mode: str = "honest") -> tuple[int, dict]:
                set_proof(self.env, "T005", doc)
                env = S.path_with(tools, self.env.env)
                env.update({"FAKE_GH_RUNS": json.dumps(runs), "FAKE_GH_MODE": mode, "FAKE_GH_SHA": self.sha})
                argv = ["proof", "run", "--task", "T005", "--sha", self.sha,
                        "--by", "test-designer" if control else "verifier"]
                code, envl, _l = B.run_exec_fakes(argv + (["--negative-control"] if control else []),
                                                  self.env.repo, env)
                return code, envl

            self.assertEqual(go([own, before], control=False)[0], 0)  # the honest proof passes
            code, envl = go([own, before], control=True)
            self.assertEqual(code, 0, envl["errors"])
            self.assertTrue(envl["data"]["negative_control"]["met"])
            self.assertIn("origin_before", envl["data"]["command"])
            self.assertIn("head SHA is not the proof's SHA", " ".join(envl["data"]["expectation"]["details"]))
            # no run of origin_before: any other commit's run of the workflow is forged
            code, envl = go([own, third], control=True)
            self.assertEqual(code, 0, envl["errors"])
            self.assertIn("c" * 12, envl["data"]["command"])
            # only this SHA has a run: it is checked as the proof of another commit
            code, envl = go([own], control=True)
            self.assertEqual(code, 0, envl["errors"])
            self.assertIn(self.base[:12], envl["data"]["command"])
            # a CI source that reports any run as this SHA's: the honest proof passes, the control catches it
            self.assertEqual(go([own, before], control=False, mode="lying")[0], 0)
            code, envl = go([own, before], control=True, mode="lying")
            self.assertEqual(code, 1)
            self.assertFalse(envl["data"]["negative_control"]["met"])
            # no run at all: the control cannot run (a rerun), never a vacuous pass
            code, envl = go([], control=True)
            self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_ENV"))
            # F12: gh failing (rate limit, network, auth) is an environment failure, exit 3, for the control and for
            # the honest proof alike: never "the forged run was rejected" without a check, never a failed expectation
            for mode in ("view-fails", "api-fails"):
                with self.subTest(gh=mode):
                    code, envl = go([own, before], control=True, mode=mode)
                    self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_ENV"), envl["errors"])
                    nc = envl["data"]["negative_control"]
                    self.assertEqual((nc["ran"], nc["met"]), (False, False))
                    self.assertTrue(proof.env_failed(envl["data"]))
                    self.assertIn("rate limit", envl["data"]["output_tail"])
            for runs, mode in (([own, before], "list-fails"), ([own, third], "list-fails-unfiltered")):
                with self.subTest(gh=mode):
                    code, envl = go(runs, control=True, mode=mode)
                    self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_ENV"), envl["errors"])
                    self.assertIn("gh failed", envl["errors"][0]["message"])
            for mode in ("view-fails", "api-fails", "list-fails"):
                with self.subTest(honest=mode):
                    code, envl = go([own, before], control=False, mode=mode)
                    self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_ENV"), envl["errors"])
                    self.assertFalse(envl["data"]["expectation"]["met"])
                    self.assertTrue(proof.env_failed(envl["data"]))
            # F15: gh exiting 0 without its answer (no output, not JSON, an object without the run's fields, an
            # empty workflow path) is the same environment failure: no comparison ran, so the control is not met and
            # the honest proof did not fail
            for mode in ("view-empty", "view-garbage", "view-keyless", "api-empty"):
                for control in (True, False):
                    with self.subTest(unanswered=mode, control=control):
                        code, envl = go([own, before], control=control, mode=mode)
                        self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_ENV"), envl["errors"])
                        self.assertTrue(proof.env_failed(envl["data"]))
                        self.assertFalse(envl["data"]["expectation"]["met"])
                        if control:
                            nc = envl["data"]["negative_control"]
                            self.assertEqual((nc["ran"], nc["met"]), (False, False))
            # positive control: the same calls with gh answering are a met control and a met proof
            code, envl = go([own, before], control=True)
            self.assertEqual(code, 0, envl["errors"])
            self.assertTrue(envl["data"]["negative_control"]["ran"] and envl["data"]["negative_control"]["met"])
            self.assertFalse(proof.env_failed(envl["data"]))
            self.assertEqual(go([own, third], control=True)[0], 0)
            self.assertEqual(go([own, before], control=False)[0], 0)
            # F10: the built-in forgery says what it tests (exec.py's CI reader, not the workflow) ...
            code, envl = go([own, before], control=True)
            self.assertIn("not whether the workflow itself fails a bad commit",
                          " ".join(envl["data"]["expectation"]["details"]))
            # ... and a checker task (its deliverable is the checker) cannot rest on it
            plan = jsonio.read_json(self.env.layout.plan)
            plan["tasks"][0]["params"] = dict(plan["tasks"][0]["params"] or {}, checker=True)
            jsonio.write_json_atomic(self.env.layout.plan, plan)
            code, envl = go([own, before], control=True)
            self.assertEqual((code, envl["errors"][0]["code"]), (2, "E_USAGE"))
            self.assertIn("checker task", envl["errors"][0]["message"])
            # positive control: the checker task's own forgery command runs (through gates.py, held to exit 0, and
            # its failure is the control met)
            py = S.paths.posix(Path(sys.executable))
            with_cmd = copy.deepcopy(doc)
            with_cmd["negative_control"]["command"] = f"{py} -c \"import sys; sys.exit(1)\""
            set_proof(self.env, "T005", with_cmd)
            env = S.path_with(tools, self.env.env)
            env.update({"FAKE_GH_RUNS": json.dumps([own, before]), "FAKE_GH_SHA": self.sha})
            code, envl, _l = B.run_exec_fakes(["proof", "run", "--task", "T005", "--sha", self.sha, "--by",
                                               "test-designer", "--negative-control"], self.env.repo, env)
            self.assertEqual(code, 0, envl["errors"])
            self.assertTrue(envl["data"]["negative_control"]["met"])
            self.assertEqual(envl["data"]["checkout"]["kind"], "clone")
        finally:
            plan = jsonio.read_json(self.env.layout.plan)
            if (plan["tasks"][0].get("params") or {}).get("checker"):
                plan["tasks"][0]["params"] = {k: v for k, v in plan["tasks"][0]["params"].items() if k != "checker"}
                jsonio.write_json_atomic(self.env.layout.plan, plan)
            S.rmtree(tools)


GH_TABLE_FAKE = r'''
import json, os, sys
runs = json.loads(os.environ.get("FAKE_GH_RUNS", "[]"))
mode = os.environ.get("FAKE_GH_MODE", "honest")
args = sys.argv[1:]
def opt(name):
    return args[args.index(name) + 1] if name in args else None
def rate_limited(name):
    if mode == name:
        sys.stderr.write("HTTP 403: API rate limit exceeded\n"); sys.exit(1)
if args[:2] == ["run", "list"]:
    rate_limited("list-fails")
    if mode == "list-fails-unfiltered" and opt("--commit") is None:
        rate_limited("list-fails-unfiltered")
    commit = opt("--commit")
    out = [r for r in runs if commit is None or r["headSha"] == commit]
    print(json.dumps(out))
elif args[:2] == ["run", "view"]:
    rate_limited("view-fails")
    if mode == "view-empty":  # F15: exit 0 and nothing printed
        sys.exit(0)
    if mode == "view-garbage":
        print("<html>temporarily unavailable</html>"); sys.exit(0)
    if mode == "view-keyless":
        print("{}"); sys.exit(0)
    rid = int(args[2])
    found = [r for r in runs if r["databaseId"] == rid]
    if not found:
        sys.exit(1)
    doc = dict(found[0], jobs=[])
    if mode == "lying":
        doc["headSha"] = os.environ["FAKE_GH_SHA"]
    print(json.dumps(doc))
elif args[:1] == ["api"]:
    rate_limited("api-fails")
    if mode == "api-empty":
        sys.exit(0)
    print(".github/workflows/ci.yml")
else:
    sys.exit(2)
'''


READER_FAKE = r'''
import json, os, sys, pathlib
h = sys.argv[1]
conf = json.loads((pathlib.Path(__file__).parent / "reader.json").read_text())
mode = conf["mode"]
want = conf["hash"]
if mode == "any":  # a lax reader: confirms any hash it is handed
    print(json.dumps({"chain": "evm", "network": "testnet", "from": "a", "to": "b", "value": "1",
                      "block_time": "2026-10-03T07:00:00Z"})); sys.exit(0)
if h != want or mode == "unknown": sys.exit(1)
if mode == "other-chain": print(json.dumps({"chain": "other", "network": "testnet"})); sys.exit(1)
if mode == "failed": sys.exit(1)
if mode == "wrong-json": print(json.dumps({"chain": "other", "network": "testnet"})); sys.exit(0)
print(json.dumps({"chain": "evm", "network": "testnet", "from": "a", "to": "b", "value": "1",
                  "block_time": "2026-10-03T07:00:00Z"}))
'''


def write_answer(layout: S.paths.Layout, key: str, *, task: str, value: str | None, ok: bool = True,
                 kind: str = "text") -> Path:
    header = {"schema": "execution.answer/1", "key": key, "task": task, "decision": None, "bring_back_key": key,
              "kind": kind, "source": "terminal", "received_utc": S.FIXED_NOW, "by": "devA", "value": value,
              "attachments": [], "verification": {"method": "regex", "ok": ok, "detail": "checked",
                                                  "at_utc": S.FIXED_NOW}}
    return S.write_text(layout.answer(key), "```json\n" + json.dumps(header, indent=2) + "\n```\nthe text\n")


@NEEDS
class TxProof(_OtherTypes):
    def test_tx_honest_and_forged(self) -> None:
        tools = S.mkdtemp()
        try:
            S.write_text(tools / "reader.py", READER_FAKE)
            tx_hash = "0x" + "12" * 32
            write_answer(self.env.layout, "T005-tx", task="T005", value=tx_hash, kind="tx-hash")
            impl = self.env.layout.result("W01", "T005", "implementer", 1)
            S.write_json(impl, {"claimed_tx": "0x" + "34" * 32})  # the implementer's claim is never read
            reader = f"{S.paths.posix(Path(sys.executable))} {S.paths.posix(tools / 'reader.py')} {{hash}}"
            doc = {"type": "tx", "spec": {"chain": "evm", "network": "testnet",
                                          "hash_from": {"answer_key": "T005-tx"}, "reader_cmd": reader},
                   "expect": {"summary": "tx re-read"}, "max_runtime_min": 1,
                   "negative_control": {"kind": "forgery", "description": "forged hash", "expect_nonzero": True}}
            for mode, want in (("ok", 0), ("unknown", 1), ("other-chain", 1), ("failed", 1), ("wrong-json", 1)):
                with self.subTest(mode=mode):
                    S.write_json(tools / "reader.json", {"mode": mode, "hash": tx_hash})
                    code, envl = self.run_type(doc)
                    self.assertEqual(code, want, envl["errors"])
            S.write_json(tools / "reader.json", {"mode": "ok", "hash": "0x" + "34" * 32})
            code, _e = self.run_type(doc)
            self.assertEqual(code, 1)  # the reader got the answer's hash, not the implementer's claim
        finally:
            S.rmtree(tools)

    def control(self, proof_doc: dict) -> tuple[int, dict]:
        set_proof(self.env, "T005", proof_doc)
        code, envl, _l = B.run_exec_fakes(["proof", "run", "--task", "T005", "--sha", self.sha, "--by",
                                           "test-designer", "--negative-control"], self.env.repo, self.env.env)
        return code, envl

    def test_tx_forgery_controls_run(self) -> None:
        """F2: the forgery control of a tx proof runs (P-13 requires it): built in (the reader is handed a seeded
        forged hash) or through negative_control.command (through gates.py, isolated, non-zero required)."""
        tools = S.mkdtemp()
        try:
            S.write_text(tools / "reader.py", READER_FAKE)
            tx_hash = "0x" + "56" * 32
            write_answer(self.env.layout, "T005-tx", task="T005", value=tx_hash, kind="tx-hash")
            py = S.paths.posix(Path(sys.executable))
            reader = f"{py} {S.paths.posix(tools / 'reader.py')}"
            doc = {"type": "tx", "spec": {"chain": "evm", "network": "testnet",
                                          "hash_from": {"answer_key": "T005-tx"}, "reader_cmd": reader + " {hash}"},
                   "expect": {"summary": "tx re-read"}, "max_runtime_min": 1,
                   "negative_control": {"kind": "forgery", "description": "a forged hash must not be confirmed",
                                        "expect_nonzero": True}}
            task = copy.deepcopy(jsonio.read_json(self.env.layout.plan)["tasks"][0])
            task["kind"], task["proof"] = "tx", doc
            self.assertTrue(proof.control_required(task))
            # built-in forgery, honest reader: the forged hash is not found, the control fails as required
            S.write_json(tools / "reader.json", {"mode": "ok", "hash": tx_hash})
            self.assertEqual(self.run_type(doc)[0], 0)  # the honest proof itself passes
            code, envl = self.control(doc)
            self.assertEqual(code, 0, envl["errors"])
            data = envl["data"]
            self.assertTrue(data["negative_control"]["met"])
            forged = proof.forged_tx_hash("T005", self.sha, tx_hash, "evm")
            self.assertNotEqual(forged, tx_hash)
            self.assertTrue(forged.startswith("0x") and len(forged) == 66)
            # README.md 8: the forged hash is never registered and appears in the run document only as its sha256
            self.assertIn(proof.hashed_value(forged), data["command"])
            self.assertNotIn(forged[2:], json.dumps(data))
            self.assertNotIn(tx_hash[2:], data["command"])
            # a lax reader confirming any hash: the honest proof passes, the forgery control catches it
            S.write_json(tools / "reader.json", {"mode": "any", "hash": tx_hash})
            self.assertEqual(self.run_type(doc)[0], 0)
            code, envl = self.control(doc)
            self.assertEqual(code, 1)
            self.assertFalse(envl["data"]["negative_control"]["met"])
            self.assertIn("negative control passed", envl["errors"][0]["message"])
            # negative_control.command (the reader on a forged hash), run through gates.py in a clean clone
            S.write_json(tools / "reader.json", {"mode": "ok", "hash": tx_hash})
            with_cmd = copy.deepcopy(doc)
            with_cmd["negative_control"]["command"] = f"{reader} 0x{'00' * 32}"
            code, envl = self.control(with_cmd)
            self.assertEqual(code, 0, envl["errors"])
            self.assertEqual(envl["data"]["checkout"]["kind"], "clone")
            self.assertIsNotNone(envl["data"]["gates_result_path"])
            self.assertTrue(envl["data"]["negative_control"]["met"])
            # ... and a control command that succeeds is not a control
            with_cmd["negative_control"]["command"] = f"{py} -c \"print('confirmed')\""
            code, envl = self.control(with_cmd)
            self.assertEqual(code, 1)
            # the control command passes the forbidden-command check like the proof's own
            with_cmd["negative_control"]["command"] = f"{reader} --allow-skip 0x{'00' * 32}"
            code, envl = self.control(with_cmd)
            self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        finally:
            S.rmtree(tools)

    def test_tx_reading_compared_as_answers_ingest(self) -> None:
        """F9: the reader's JSON is compared as in `answers ingest` (CLI.md `proof run`, tx): a real but older
        transaction (block_time before the task's posting) or a foreign one (the proof's expect.json, or the
        bring_back's verify.expect) fails; each refusal next to the honest reading that passes."""
        tools = S.mkdtemp()
        status_path = self.env.layout.status("A")
        try:
            S.write_text(tools / "reader.py", READER_FAKE)
            tx_hash = "0x" + "78" * 32
            write_answer(self.env.layout, "T005-tx", task="T005", value=tx_hash, kind="tx-hash")
            S.write_json(tools / "reader.json", {"mode": "ok", "hash": tx_hash})  # block_time 07:00:00Z
            reader = f"{S.paths.posix(Path(sys.executable))} {S.paths.posix(tools / 'reader.py')} {{hash}}"
            doc = {"type": "tx", "spec": {"chain": "evm", "network": "testnet",
                                          "hash_from": {"answer_key": "T005-tx"}, "reader_cmd": reader},
                   "expect": {"summary": "tx re-read"}, "max_runtime_min": 1,
                   "negative_control": {"kind": "forgery", "description": "forged hash", "expect_nonzero": True}}

            def posted(at: str) -> None:
                entry = S.build_task_status("running", posted={"at_utc": at, "push_text": "send the tx"})
                jsonio.write_json_atomic(status_path, S.build_status("A", {"T005": entry}))

            # older: the transaction was mined before the task was posted
            posted("2026-10-03T07:05:00Z")
            code, envl = self.run_type(doc)
            self.assertEqual(code, 1, envl["errors"])
            self.assertTrue(any("older transaction" in d for d in envl["data"]["expectation"]["details"]))
            posted("2026-10-03T06:55:00Z")  # positive control: mined after the posting
            code, envl = self.run_type(doc)
            self.assertEqual(code, 0, envl["errors"])
            # foreign: the proof's own expect.json pins the sender
            foreign = copy.deepcopy(doc)
            foreign["expect"]["json"] = [{"pointer": "/from", "equals": "someone-else"}]
            code, envl = self.run_type(foreign)
            self.assertEqual(code, 1, envl["errors"])
            self.assertTrue(any("/from" in d for d in envl["data"]["expectation"]["details"]))
            foreign["expect"]["json"] = [{"pointer": "/from", "equals": "a"}, {"pointer": "/to", "equals": "b"}]
            self.assertEqual(self.run_type(foreign)[0], 0)
        finally:
            if status_path.exists():
                status_path.unlink()
            S.rmtree(tools)
        # the bring_back's verify.expect of the answer key (in process: a code task carries no manual block)
        task = copy.deepcopy(jsonio.read_json(self.env.layout.plan)["tasks"][0])
        task["proof"] = {"type": "tx", "spec": {"chain": "evm", "network": "testnet",
                                                "hash_from": {"answer_key": "T005-tx"}, "reader_cmd": "r {hash}"}}
        task["manual"] = {"bring_back": [{"key": "T005-tx", "kind": "tx-hash",
                                          "verify": {"method": "chain-reread", "expect": {"from": "a", "to": "zz"}}}]}
        ctx = Ctx(layout=self.env.layout, executor="A", now=S.fixed_now(), by="verifier", pretty=False,
                  command="proof run", log=get_logger("execlib.proof"))
        expect, posted_at = proof._tx_expectations(ctx, task)
        self.assertEqual((expect, posted_at), ({"from": "a", "to": "zz"}, None))
        reading = {"chain": "evm", "network": "testnet", "from": "a", "to": "b", "value": "1",
                   "block_time": "2026-10-03T07:00:00Z"}
        problems = proof.compare_tx_reading(reading, task["proof"]["spec"], expect, None, {})
        self.assertEqual(problems, ["reader to differs from verify.expect.to"])
        self.assertEqual(proof.compare_tx_reading(reading, task["proof"]["spec"], {"from": "a", "to": "b"}, None,
                                                  {}), [])
        # block_time: unreadable fails; epoch seconds read; another network fails
        self.assertIn("no readable block_time",
                      " ".join(proof.compare_tx_reading(dict(reading, block_time="soon"), task["proof"]["spec"], {},
                                                        None, {})))
        self.assertEqual(proof.compare_tx_reading(dict(reading, block_time=1791010800), task["proof"]["spec"], {},
                                                  "2026-10-03T06:00:00Z", {}), [])
        self.assertIn("older transaction",
                      " ".join(proof.compare_tx_reading(dict(reading, block_time="1791010800"), task["proof"]["spec"],
                                                        {}, "2026-10-03T07:30:00Z", {})))
        self.assertTrue(proof.compare_tx_reading(dict(reading, network="mainnet"), task["proof"]["spec"], {}, None,
                                                 {}))

    def test_forged_hash_style(self) -> None:
        rec = "ab" * 32
        self.assertEqual(len(proof.forged_tx_hash("T005", self.sha, rec, "xrpl")), 64)
        self.assertTrue(proof.forged_tx_hash("T005", self.sha, None, "evm").startswith("0x"))
        self.assertFalse(proof.forged_tx_hash("T005", self.sha, None, "cardano").startswith("0x"))
        self.assertEqual(proof.forged_tx_hash("T005", self.sha, None, "evm"),
                         proof.forged_tx_hash("T005", self.sha, "0x" + "11" * 32, "evm"))  # seeded: stable


@NEEDS
class AttestProof(_OtherTypes):
    def test_human_attest(self) -> None:
        doc = {"type": "human-attest", "spec": {"answer_key": "T005-done", "attest": "the owner did it"},
               "expect": {"summary": "confirmed"}, "max_runtime_min": 1,
               "negative_control": {"kind": "not-applicable", "description": "human", "expect_nonzero": True,
                                    "waived_reason": "a human step, nothing to falsify"}}
        plan = jsonio.read_json(self.env.layout.plan)
        manual = S.build_task("T006", kind="manual")
        manual["proof"] = doc
        plan["tasks"] = [t for t in plan["tasks"] if t["id"] != "T006"] + [manual]
        jsonio.write_json_atomic(self.env.layout.plan, plan)

        def run() -> int:
            code, envl, _l = B.run_exec_fakes(["proof", "run", "--task", "T006", "--sha", self.sha, "--by",
                                               "orchestrator"], self.env.repo, self.env.env)
            return code

        write_answer(self.env.layout, "T005-done", task="T006", value=None, ok=True)
        self.assertEqual(run(), 0)
        write_answer(self.env.layout, "T005-done", task="T006", value=None, ok=False)
        self.assertEqual(run(), 1)
        write_answer(self.env.layout, "T005-done", task="T004", value=None, ok=True)
        self.assertEqual(run(), 1)


# --- verdicts --------------------------------------------------------------------------------------------------------

def findings(path: Path, **integrity: object) -> Path:
    integ = {"tests_modified": [], "skip_markers_added": 0, "assertion_delta": 0, "todo_added": 0,
             "protected_touched": [], "stubs": []}
    integ.update(integrity)
    return S.write_json(path, {"criteria": [{"criterion": "the proof passes", "met": True, "evidence": "exit 0"}],
                               "findings": [], "integrity": integ, "implementer_result": None})


def set_status(env: B.B06Env, task: str, status: str, **over: object) -> None:
    doc = S.build_status("A", {task: S.build_task_status(status, **over)})
    jsonio.write_json_atomic(env.layout.status("A"), doc)


def state_bytes(env: B.B06Env) -> tuple[dict[str, str], bytes, bytes]:
    """Everything a verdict may write: the tracked proofs/ tree, events.jsonl and the status file."""
    layout = env.layout
    return (B.tree_digest(layout.state / "proofs"), layout.events.read_bytes() if layout.events.is_file() else b"",
            layout.status("A").read_bytes())


@NEEDS
class Verdicts(unittest.TestCase):
    def setUp(self) -> None:
        self.env = B.B06Env()
        set_proof(self.env, "T005", command_proof("test -f src/engine/feature.txt && printf ok"))
        self.base, self.sha = land(self.env, {"src/engine/feature.txt": "f\n"})
        set_status(self.env, "T005", "running")
        code, envl = run_proof_cli(self.env, self.sha, "--keep")
        self.assertEqual(code, 0, envl["errors"])
        self.run_doc = envl["data"]
        code, envl = run_proof_cli(self.env, self.sha, "--negative-control", by="test-designer")
        self.assertEqual(code, 0, envl["errors"])
        self.findings = findings(self.env.private / "findings.json")
        self.env.attest(command="merge", task="T005", attempt=1, agent_id="agent-impl",
                        agent_type="execution-implementer", n=1)

    def tearDown(self) -> None:
        self.env.cleanup()

    def verdict(self, run_id: str | None = None, verdict: str = "pass", findings_path: Path | None = None,
                env: dict | None = None, attempt: int = 1) -> tuple[int, dict]:
        code, envl, _l = B.run_exec_fakes(
            ["proof", "verdict", "--task", "T005", "--run", run_id or self.run_doc["run_id"], "--verdict", verdict,
             "--findings", str(findings_path or self.findings), "--attempt", str(attempt), "--model", "opus",
             "--effort", "high", "--by", "verifier"], self.env.repo, env or self.env.env)
        return code, envl

    def attest_verifier(self, agent_id: str = "agent-ver", run_id: str | None = None) -> None:
        self.env.attest(command="proof verdict", task="T005", run=run_id or self.run_doc["run_id"],
                        agent_id=agent_id, agent_type="execution-verifier", n=2)

    def test_accepted_while_running_and_history(self) -> None:
        self.attest_verifier()
        kept = Path(self.run_doc["checkout"]["path"])
        self.assertTrue(kept.exists())
        code, envl = self.verdict()
        self.assertEqual(code, 0, envl["errors"])
        data = envl["data"]
        receipt = self.env.layout.receipt("T005")
        self.assertEqual(data["receipt_sha256"], hashlib.sha256(receipt.read_bytes()).hexdigest())
        self.assertEqual(data["sha"], self.sha)
        self.assertEqual(data["by"]["agent_id"], "agent-ver")
        self.assertEqual(data["implementer"]["agent_id"], "agent-impl")
        self.assertTrue(data["negative_control"]["met"])
        st = jsonio.read_json(self.env.layout.status("A"))["tasks"]["T005"]
        self.assertEqual(st["status"], "done")
        self.assertEqual([h["to"] for h in st["history"]], ["built", "verifying", "done"])
        self.assertTrue(self.env.layout.proof_run_copy("T005", self.run_doc["run_id"]).is_file())
        self.assertTrue(self.env.layout.merge_copy("T005", 1).is_file())
        self.assertFalse(kept.exists())  # the kept checkout is deleted by the verdict
        self.attest_verifier("agent-ver-2")
        code, envl = self.verdict()
        self.assertEqual(code, 0, envl["errors"])
        self.assertTrue(self.env.layout.receipt_history("T005", 1).is_file())

    def test_refusals_write_nothing(self) -> None:
        self.attest_verifier()
        receipt = self.env.layout.receipt("T005")
        # contract revision 4: an agent's effort is low, medium or high; `xhigh` is the orchestrator's alone
        code, envl, _l = B.run_exec_fakes(
            ["proof", "verdict", "--task", "T005", "--run", self.run_doc["run_id"], "--verdict", "pass", "--findings",
             str(self.findings), "--attempt", "1", "--model", "opus", "--effort", "xhigh", "--by", "verifier"],
            self.env.repo, self.env.env)
        self.assertEqual((code, envl["errors"][0]["code"]), (2, "E_USAGE"))
        self.assertFalse(receipt.exists())
        # a pass on a run whose expectation was not met (under the current proof, so the mismatch is what refuses)
        set_proof(self.env, "T005", command_proof("test -f src/engine/absent.txt && printf ok"))
        code, envl = run_proof_cli(self.env, self.sha)
        self.assertEqual(code, 1)
        failed_run = envl["data"]["run_id"]
        self.attest_verifier(run_id=failed_run)
        code, envl = self.verdict(run_id=failed_run)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_VERDICT_MISMATCH"))
        set_proof(self.env, "T005", command_proof("test -f src/engine/feature.txt && printf ok"))
        self.attest_verifier()
        # stale proof hash after an amendment of the proof
        set_proof(self.env, "T005", command_proof("test -f src/engine/feature.txt && printf changed"))
        code, envl = self.verdict()
        self.assertEqual(code, 4)
        self.assertIn("stale", envl["errors"][0]["message"])
        set_proof(self.env, "T005", command_proof("test -f src/engine/feature.txt && printf ok"))
        # the findings file fails its schema
        bad = S.write_json(self.env.private / "bad.json", {"criteria": []})
        self.assertEqual(self.verdict(findings_path=bad)[0], 1)
        # integrity inconsistent with a pass
        self.assertEqual(self.verdict(findings_path=findings(self.env.private / "f2.json",
                                                             skip_markers_added=1))[0], 4)
        self.assertFalse(receipt.exists())
        # the 9-minute budget (CLI.md 0.6): a step whose last duration no longer fits is not started
        prof = jsonio.read_json(self.env.layout.profile)
        prof["machine"]["agent_command_budget_s"] = 120
        jsonio.write_json_atomic(self.env.layout.profile, prof)
        S.write_json(self.env.layout.timings, {"proof verdict": {"code": {"fetch": 900.0}}})
        code, envl = self.verdict()
        self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_TIME_BUDGET"))
        self.assertEqual(envl["data"]["step"], "fetch")
        self.assertFalse(receipt.exists())
        self.env.layout.timings.unlink()
        # positive control: the same call with honest inputs writes the receipt
        code, envl = self.verdict()
        self.assertEqual(code, 0, envl["errors"])
        self.assertIn("write", jsonio.read_json(self.env.layout.timings)["proof verdict"]["code"])

    def test_in_place_and_foreign_role_runs_are_not_evidence(self) -> None:
        """F1: an in-place run (merge's pre-push check) is never evidence, from the command line it is refused, and a
        verdict cites only a verifier's (or a replay's) run; each refusal with its positive control."""
        forged = self.env.private / "forged"
        S.write_text(forged / "src" / "engine" / "feature.txt", "forged\n")
        runs_dir = self.env.layout.local / "proof-runs" / "T005"
        n_runs = len(list(runs_dir.iterdir()))
        # CLI: --checkout in-place is refused for every role, before any run directory exists
        for by in ("verifier", "integrator"):
            with self.subTest(by=by):
                code, envl = run_proof_cli(self.env, self.sha, "--checkout", "in-place", "--tree", str(forged), by=by)
                self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertEqual(len(list(runs_dir.iterdir())), n_runs)
        # in process: only the integrator (merge's pre-push check) runs in place
        plan_raw = jsonio.read_json(self.env.layout.plan)
        task = plan_raw["tasks"][0]

        def in_place(by: str) -> dict:
            ctx = Ctx(layout=self.env.layout, executor="A", now=S.fixed_now(), by=by, pretty=False,
                      command="merge", log=get_logger("execlib.proof"))
            with S.patched_env(EXEC_TEST="1", EXEC_GOVERNOR_READINGS=str(self.env.readings_path),
                               GIT_CONFIG_GLOBAL=self.env.env["GIT_CONFIG_GLOBAL"], GIT_CONFIG_NOSYSTEM="1"):
                return proof.run_proof(ctx, plan_raw, task, self.sha, negative_control=False, checkout="in-place",
                                       keep=True, tree=forged)

        with self.assertRaises(PolicyRefused):
            in_place("verifier")
        doc = in_place("integrator")  # positive control: merge's own check runs
        self.assertEqual((doc["checkout"]["kind"], doc["by"]["role"]), ("in-place", "integrator"))
        self.assertTrue(doc["expectation"]["met"])
        # verdict: the integrator's in-place run is refused although its expectation was met
        self.attest_verifier(run_id=doc["run_id"])
        code, envl = self.verdict(run_id=doc["run_id"])
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("in place", envl["errors"][0]["message"])
        # a clean-clone run by another role (test-designer) is not the verifier's re-run
        code, envl = run_proof_cli(self.env, self.sha, by="test-designer")
        self.assertEqual(code, 0, envl["errors"])
        td_run = envl["data"]["run_id"]
        self.attest_verifier(run_id=td_run)
        code, envl = self.verdict(run_id=td_run)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("test-designer", envl["errors"][0]["message"])
        self.assertFalse(self.env.layout.receipt("T005").exists())
        # positive controls: an orchestrator replay and the verifier's own run are accepted
        code, envl = run_proof_cli(self.env, self.sha, by="replay")
        self.assertEqual(code, 0, envl["errors"])
        replay_run = envl["data"]["run_id"]
        self.attest_verifier(run_id=replay_run)
        code, envl = self.verdict(run_id=replay_run)
        self.assertEqual(code, 0, envl["errors"])
        self.attest_verifier("agent-ver-2")
        code, envl = self.verdict()
        self.assertEqual(code, 0, envl["errors"])

    @SLOW
    def test_run_of_another_sha_or_task(self) -> None:
        self.attest_verifier()
        other = S.build_merge_receipt("T005", origin_before=self.base, head_before=self.base,
                                      landed_sha=self.base, attempt=1, wave="W02", finished_utc="2026-10-03T07:13:00Z")
        S.write_json(self.env.layout.result("W02", "T005", "merge", 1), other)
        code, envl = self.verdict()
        self.assertEqual(code, 4)
        self.assertIn("landed SHA", envl["errors"][0]["message"])
        self.env.layout.result("W02", "T005", "merge", 1).unlink()
        fake_other = self.run_doc["run_id"].replace("T005", "T004")
        # a run id of another task that exists nowhere: a usage error
        code, envl = self.verdict(run_id=fake_other)
        self.assertEqual((code, envl["errors"][0]["code"]), (2, "E_USAGE"))
        # the same id where it exists, under the other task: a policy refusal
        other_dir = self.env.layout.proof_run_dir("T004", fake_other)
        other_dir.mkdir(parents=True)
        S.write_json(other_dir / "run.json", dict(self.run_doc, run_id=fake_other, task="T004"))
        code, envl = self.verdict(run_id=fake_other)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("belongs to T004", envl["errors"][0]["message"])
        self.assertEqual(self.verdict()[0], 0)

    def test_control_counts_only_for_the_landed_sha(self) -> None:
        """F8 (SCHEMAS.md 4.3 condition 6): a verdict counts only the negative-control runs made for the landed SHA
        under verdict, and refuses a pass when the newest of them passed where it must fail, whatever older control
        or plan record exists; the honest flow of the same attempt is the positive control."""
        receipt = self.env.layout.receipt("T005")
        # attempt 1 failed (the status counts it), so attempt 2 runs and lands sha2 on top of attempt 1; its
        # pre-implementation base is attempt 1's SHA
        set_status(self.env, "T005", "running", attempts=1)
        _b, sha2 = land(self.env, {"src/engine/second.txt": "s\n"}, msg="feat(engine): second", wave="W02",
                        attempt=2)
        code, envl = run_proof_cli(self.env, sha2)
        self.assertEqual(code, 0, envl["errors"])
        run2 = envl["data"]["run_id"]
        self.attest_verifier(run_id=run2)
        # (1) the only control on record was made for attempt 1's SHA (self.sha) and met: it does not count
        code, envl = self.verdict(run_id=run2, attempt=2)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("no control run of the landed SHA", envl["errors"][0]["message"])
        self.assertFalse(receipt.exists())
        # (2) the control of sha2 runs the proof on its base self.sha, where feature.txt already exists: the proof
        # passes there, so the control fails its requirement, and it is the newest control of sha2
        code, envl = run_proof_cli(self.env, sha2, "--negative-control", by="test-designer")
        self.assertEqual(code, 1)
        self.assertFalse(envl["data"]["negative_control"]["met"])
        failing_control = envl["data"]["run_id"]
        code, envl = self.verdict(run_id=run2, attempt=2)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("passed where it must fail", envl["errors"][0]["message"])
        self.assertIn(failing_control, envl["errors"][0]["message"])
        # ... and a control recorded in the plan does not outweigh it
        plan = jsonio.read_json(self.env.layout.plan)
        plan["tasks"][0]["proof"]["negative_control"]["recorded"] = {"run": self.run_doc["run_id"], "exit_code": 1,
                                                                     "at_utc": S.FIXED_NOW}
        jsonio.write_json_atomic(self.env.layout.plan, plan)
        code, envl = self.verdict(run_id=run2, attempt=2)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("passed where it must fail", envl["errors"][0]["message"])
        self.assertFalse(receipt.exists())
        set_proof(self.env, "T005", command_proof("test -f src/engine/feature.txt && printf ok"))
        # a fail verdict is still written, its receipt carrying the failing control as it is
        code, envl = self.verdict(run_id=run2, attempt=2, verdict="fail")
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual(envl["data"]["negative_control"],
                         {"required": True, "ran": True, "exit_code": 0, "met": False})
        self.assertTrue(self.env.layout.proof_run_copy("T005", failing_control).is_file())
        # positive control, the honest flow on sha2: a proof that sha2 adds, its control failing as required on
        # the base, then the pass verdict
        set_status(self.env, "T005", "running", attempts=1)
        set_proof(self.env, "T005", command_proof("test -f src/engine/second.txt && printf ok"))
        code, envl = run_proof_cli(self.env, sha2)
        self.assertEqual(code, 0, envl["errors"])
        run3 = envl["data"]["run_id"]
        code, envl = run_proof_cli(self.env, sha2, "--negative-control", by="test-designer")
        self.assertEqual(code, 0, envl["errors"])
        self.attest_verifier("agent-ver-2", run_id=run3)
        code, envl = self.verdict(run_id=run3, attempt=2)
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual((envl["data"]["sha"], envl["data"]["negative_control"]["met"]), (sha2, True))
        self.assertEqual(jsonio.read_json(self.env.layout.status("A"))["tasks"]["T005"]["status"], "done")

    def test_env_failed_runs_are_no_evidence(self) -> None:
        """F11 (CLI.md proof run: an environment failure is exit 3, never a failed expectation): a control run that
        died of the environment neither satisfies the negative-control condition nor, being newer, masks an older
        control that failed its requirement, and a proof run that died of it is cited by no verdict. A flag file
        simulates the machine running out of memory during one run; the honest flow is the positive control."""
        receipt = self.env.layout.receipt("T005")
        flag = self.env.private / "oom.flag"
        oom = f'if [ -f "{S.paths.posix(flag)}" ]; then echo "fatal: out of memory"; exit 137; fi; '

        def control(want: int) -> dict:
            code, envl = run_proof_cli(self.env, self.sha, "--negative-control", by="test-designer")
            self.assertEqual(code, want, envl["errors"])
            if want == 3:
                self.assertEqual(envl["errors"][0]["code"], "E_ENV")
            return envl["data"]

        # a lax proof (it passes on any tree, the base included): its only honest control fails its requirement
        set_proof(self.env, "T005", command_proof(oom + "printf ok"))
        code, envl = run_proof_cli(self.env, self.sha)
        self.assertEqual(code, 0, envl["errors"])
        lax_run = envl["data"]["run_id"]
        self.attest_verifier(run_id=lax_run)
        # (1) an env-failed control alone: recorded as such (ran and met false, an E_ENV warning), and no control
        flag.write_bytes(b"1")
        doc = control(3)
        self.assertEqual((doc["negative_control"]["ran"], doc["negative_control"]["met"]), (False, False))
        self.assertFalse(doc["expectation"]["met"])
        self.assertIn("E_ENV", [w["code"] for w in doc["warnings"]])
        run_json = self.env.layout.proof_run_dir("T005", doc["run_id"]) / "run.json"
        on_disk = jsonio.read_json(run_json)
        self.assertTrue(proof.env_failed(on_disk))
        flag.unlink()
        code, envl = self.verdict(run_id=lax_run)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("no control run of the landed SHA", envl["errors"][0]["message"])
        self.assertFalse(receipt.exists())
        # the E_ENV mark alone excludes it: the same document claiming ran and met (a hand-edited or tracked copy)
        jsonio.write_json_atomic(run_json, dict(on_disk, negative_control=dict(on_disk["negative_control"],
                                                                               ran=True, met=True)))
        layout, tid, phash = self.env.layout, "T005", on_disk["proof_hash"]
        self.assertEqual(proof._control_runs(layout, tid, phash, self.sha), [])
        code, envl = self.verdict(run_id=lax_run)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertFalse(receipt.exists())
        jsonio.write_json_atomic(run_json, on_disk)
        # (2) an honest control that catches the lax proof, then a newer env-failed control: the honest one decides
        honest = control(1)
        self.assertFalse(honest["negative_control"]["met"])
        flag.write_bytes(b"1")
        control(3)
        flag.unlink()
        code, envl = self.verdict(run_id=lax_run)
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("passed where it must fail", envl["errors"][0]["message"])
        self.assertIn(honest["run_id"], envl["errors"][0]["message"])
        self.assertFalse(receipt.exists())
        # (3) a proof run that died of the environment is cited by no verdict, fail included (a rerun)
        set_proof(self.env, "T005", command_proof(oom + "test -f src/engine/feature.txt && printf ok"))
        flag.write_bytes(b"1")
        code, envl = run_proof_cli(self.env, self.sha)
        self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_ENV"))
        env_run = envl["data"]["run_id"]
        flag.unlink()
        self.attest_verifier(run_id=env_run)
        for verdict in ("fail", "pass"):
            with self.subTest(verdict=verdict):
                code, envl = self.verdict(run_id=env_run, verdict=verdict)
                self.assertEqual((code, envl["errors"][0]["code"]), (3, "E_ENV"))
                self.assertIn("environment failure", envl["errors"][0]["message"])
        self.assertFalse(receipt.exists())
        self.assertEqual(jsonio.read_json(self.env.layout.status("A"))["tasks"]["T005"]["status"], "running")
        # positive control, the honest flow under the same (strict) proof: its run and its met control pass, and a
        # newer env-failed control masks the met one no more than it masked the failing one
        code, envl = run_proof_cli(self.env, self.sha)
        self.assertEqual(code, 0, envl["errors"])
        strict_run = envl["data"]["run_id"]
        met = control(0)
        self.assertTrue(met["negative_control"]["met"])
        flag.write_bytes(b"1")
        control(3)
        flag.unlink()
        self.attest_verifier("agent-ver-2", run_id=strict_run)
        code, envl = self.verdict(run_id=strict_run)
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual(envl["data"]["negative_control"],
                         {"required": True, "ran": True, "exit_code": met["negative_control"]["exit_code"],
                          "met": True})
        self.assertTrue(self.env.layout.proof_run_copy("T005", met["run_id"]).is_file())
        self.assertEqual(jsonio.read_json(self.env.layout.status("A"))["tasks"]["T005"]["status"], "done")

    def test_recorded_control_counts_only_as_evidence_on_disk(self) -> None:
        """F16 (SCHEMAS.md 4.3 condition 6, "recorded in the plan ... for this proof digest"): the plan's
        `negative_control.recorded` comes from a test-designer's result, so it counts only when lane B04's done check
        would count it (a non-zero exit code) AND the run it names is on disk as a control run of this task and
        proof digest that failed as required with that exit code; each refusal next to the accepted record."""
        receipt = self.env.layout.receipt("T005")
        self.attest_verifier()
        # the landed SHA's own control is set aside: only the plan record can satisfy the requirement now
        runs = self.env.layout.local / "proof-runs" / "T005"
        controls = [p for p in sorted(runs.glob("*/run.json")) if jsonio.read_json(p).get("negative_control")]
        self.assertEqual(len(controls), 1)
        control = jsonio.read_json(controls[0])
        os.replace(controls[0], controls[0].with_name("run.json.moved"))
        # a control the test designer ran on its own base (another SHA), as `proof run` writes it
        td_id = f"T005-{self.base[:8]}-20261003T070000Z-1"
        td_doc = dict(control, run_id=td_id, sha=self.base, started_utc="2026-10-03T07:00:00Z",
                      finished_utc="2026-10-03T07:00:05Z")
        td_run = self.env.layout.proof_run_dir("T005", td_id) / "run.json"
        S.write_json(td_run, td_doc)
        exit_code = control["negative_control"]["exit_code"]
        self.assertNotIn(exit_code, (None, 0))

        def record(run: str, code: int) -> None:
            plan = jsonio.read_json(self.env.layout.plan)
            plan["tasks"][0]["proof"]["negative_control"]["recorded"] = {"run": run, "exit_code": code,
                                                                         "at_utc": S.FIXED_NOW}
            jsonio.write_json_atomic(self.env.layout.plan, plan)

        cases = [
            (self.run_doc["run_id"], 1, "is not a control that failed as required"),  # the verifier's proof run
            (td_id, 0, "no non-zero exit code"),                                       # B04's own rule
            ("T005-deadbeef-20261003T070000Z-9", 1, "on disk neither as a run nor as a tracked copy"),
            (td_id, exit_code + 1, f"the plan records {exit_code + 1}"),
        ]
        for run, code_, why in cases:
            with self.subTest(run=run, exit_code=code_):
                record(run, code_)
                code, envl = self.verdict()
                self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"), envl["errors"])
                self.assertIn(why, envl["errors"][0]["message"])
                self.assertFalse(receipt.exists())
        # a recorded control of another proof (a stale digest) does not count either
        S.write_json(td_run, dict(td_doc, proof_hash="0" * 64))
        record(td_id, exit_code)
        code, envl = self.verdict()
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"))
        self.assertIn("ran another proof", envl["errors"][0]["message"])
        self.assertFalse(receipt.exists())
        # positive control: the record of a control on disk, of this proof, failed as required with that exit code
        S.write_json(td_run, td_doc)
        code, envl = self.verdict()
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual(envl["data"]["negative_control"],
                         {"required": True, "ran": True, "exit_code": exit_code, "met": True})
        self.assertTrue(self.env.layout.proof_run_copy("T005", td_id).is_file())

    def test_transition_evidence_checked_before_writing(self) -> None:
        """F13: the rows of SCHEMAS.md 4.2 this verdict applies are checked as lane B04 checks them, before anything is
        written: running -> built reads the status's own attempt (counted failures + 1), built -> verifying needs a
        proof run of the landed SHA by role verifier, and the done check reads only a schema-valid cited run. Each
        refusal leaves the state as it was; the honest call is the positive control."""
        before = state_bytes(self.env)
        # the status counts one failure: it runs attempt 2, the verdict names attempt 1
        set_status(self.env, "T005", "running", attempts=1)
        status_bytes = self.env.layout.status("A").read_bytes()
        self.attest_verifier()
        code, envl = self.verdict()
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"), envl["errors"])
        self.assertIn("runs attempt 2", envl["errors"][0]["message"])
        self.assertEqual(state_bytes(self.env)[:2], before[:2])
        self.assertEqual(self.env.layout.status("A").read_bytes(), status_bytes)
        set_status(self.env, "T005", "running")
        # a replay run cited while no verifier run of the landed SHA exists: B04's built -> verifying would refuse
        verifier_run = self.env.layout.proof_run_dir("T005", self.run_doc["run_id"]) / "run.json"
        os.replace(verifier_run, verifier_run.with_name("run.json.moved"))
        code, envl = run_proof_cli(self.env, self.sha, by="replay")
        self.assertEqual(code, 0, envl["errors"])
        replay = envl["data"]
        self.env.attest(command="proof verdict", task="T005", run=replay["run_id"], agent_id="agent-ver",
                        agent_type="execution-verifier", n=3)
        code, envl = self.verdict(run_id=replay["run_id"])
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"), envl["errors"])
        self.assertIn("by role verifier", envl["errors"][0]["message"])
        self.assertFalse(self.env.layout.receipt("T005").exists())
        # a cited run that is not a valid proof-run document (the done check would never find it)
        replay_json = self.env.layout.proof_run_dir("T005", replay["run_id"]) / "run.json"
        S.write_json(replay_json, {k: v for k, v in replay.items() if k != "output_sha256"})
        os.replace(verifier_run.with_name("run.json.moved"), verifier_run)
        code, envl = self.verdict(run_id=replay["run_id"])
        self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"), envl["errors"])
        self.assertIn("not a valid proof-run document", envl["errors"][0]["message"])
        self.assertFalse(self.env.layout.receipt("T005").exists())
        # positive control: the valid replay run, with the verifier's run of the landed SHA on record
        S.write_json(replay_json, replay)
        code, envl = self.verdict(run_id=replay["run_id"])
        self.assertEqual(code, 0, envl["errors"])
        self.assertEqual(jsonio.read_json(self.env.layout.status("A"))["tasks"]["T005"]["status"], "done")

    def in_process_verdict(self, verdict: str = "pass") -> dict:
        """proof.write_verdict in this process: lane B04's REAL status and results modules (no fake installed)."""
        ctx = Ctx(layout=self.env.layout, executor="A", now=S.fixed_now(), by="verifier", pretty=False,
                  command="proof verdict", log=get_logger("execlib.proof"))
        plan = jsonio.read_json(self.env.layout.plan)
        with S.patched_env(EXEC_TEST="1", GIT_CONFIG_GLOBAL=self.env.env["GIT_CONFIG_GLOBAL"],
                           GIT_CONFIG_NOSYSTEM="1"):
            return proof.write_verdict(ctx, plan, proof.task_raw(plan, "T005"), self.run_doc["run_id"], verdict,
                                       jsonio.read_json(self.findings), 1, "opus", "high")

    def test_refusal_after_the_writes_leaves_nothing(self) -> None:
        """F13 (CLI.md proof verdict: "each failure: exit 4, nothing written"), with lane B04's real status module in
        process: when B04's done check refuses the written receipt, or a transition refuses after built and
        verifying appended their events, every file is put back and events.jsonl is cut to its length (a broken
        lock's record excepted); the same call with nothing planted reaches done (positive control)."""
        from execlib import events as events_mod, status
        self.attest_verifier()
        before = state_bytes(self.env)
        planted = [ErrorItem("E_TRANSITION_REFUSED", "done condition 6: a planted disagreement", task="T005")]
        real_append = events_mod.append
        with mock.patch.object(status, "check_done_evidence", return_value=planted), \
                mock.patch.object(events_mod, "append", side_effect=real_append) as appended:
            with self.assertRaises(TransitionRefused) as cm:
                self.in_process_verdict()
        self.assertIn("planted disagreement", cm.exception.message)
        self.assertEqual(cm.exception.exit_code, 4)
        self.assertEqual(state_bytes(self.env), before)
        # B04's done check refused BEFORE any transition: not one task.status event was even appended
        self.assertEqual([c.args[1] for c in appended.call_args_list], [])
        real = status.transition
        lock_record = {"ts": "2026-10-03T07:12:00.000001Z", "actor": "exec:proof verdict@A", "type": "error",
                       "data": {"kind": "lock-broken", "lock": "notion", "holder": None}, "executor": "A", "seq": 990}
        seen: list[str] = []

        def refuse_done(ctx: Ctx, doc: dict, task: object, to: str, *, evidence: list[str],
                        reason: str | None = None, plan: object = None, git: object = None) -> dict:
            seen.append(to)
            if to == "done":
                jsonio.append_jsonl(self.env.layout.events, lock_record)  # a lock broken meanwhile: kept
                raise TransitionRefused("planted: verifying -> done refused", code="E_TRANSITION_REFUSED")
            return real(ctx, doc, task, to, evidence=evidence, reason=reason, plan=plan, git=git)

        with mock.patch.object(status, "transition", refuse_done):
            with self.assertRaises(TransitionRefused):
                self.in_process_verdict()
        self.assertEqual(seen, ["built", "verifying", "done"])  # two task.status events were appended, then cut
        proofs, events_now, status_now = state_bytes(self.env)
        self.assertEqual((proofs, status_now), (before[0], before[2]))
        self.assertEqual(events_now, before[1] + jsonio.canonical_bytes(lock_record) + b"\n")
        # positive control: nothing planted, the real done check and transitions reach done
        out = self.in_process_verdict()
        self.assertEqual(out["negative_control"]["required"], True)
        st = jsonio.read_json(self.env.layout.status("A"))["tasks"]["T005"]
        self.assertEqual((st["status"], [h["to"] for h in st["history"]]), ("done", ["built", "verifying", "done"]))
        self.assertTrue(self.env.layout.receipt("T005").is_file())

    def test_run_order_counts_numerically(self) -> None:
        older = {"run_id": "T005-abcdef12-20261003T071200Z-9", "started_utc": "2026-10-03T07:12:00Z"}
        newer = {"run_id": "T005-abcdef12-20261003T071200Z-10", "started_utc": "2026-10-03T07:12:00Z"}
        later = {"run_id": "T005-abcdef12-20261003T071300Z-1", "started_utc": "2026-10-03T07:13:00Z"}
        self.assertEqual(sorted([later, newer, older], key=proof._run_order), [older, newer, later])

    @SLOW
    def test_not_on_origin_main(self) -> None:
        self.attest_verifier()
        S.git(self.env.repo_obj.origin, "update-ref", "refs/heads/main", self.base, env=self.env.env)
        code, envl = self.verdict()
        self.assertEqual(code, 4)
        self.assertEqual(envl["errors"][0]["code"], "E_NOT_ON_MAIN")
        S.git(self.env.repo_obj.origin, "update-ref", "refs/heads/main", self.sha, env=self.env.env)
        self.assertEqual(self.verdict()[0], 0)

    @SLOW
    def test_negative_control_required(self) -> None:
        self.attest_verifier()
        for p in (self.env.layout.local / "proof-runs" / "T005").glob("*/run.json"):
            if jsonio.read_json(p).get("negative_control"):
                os.replace(p, p.with_name("run.json.moved"))
        code, envl = self.verdict()
        self.assertEqual(code, 4)
        self.assertIn("negative control", envl["errors"][0]["message"])

    @SLOW
    def test_attestation_missing_and_shared_agent(self) -> None:
        code, envl = self.verdict()
        self.assertEqual(code, 3)
        self.assertEqual(envl["errors"][0]["code"], "E_ATTESTATION_MISSING")
        self.attest_verifier(agent_id="agent-impl")
        code, envl = self.verdict()
        self.assertEqual(code, 4)
        self.env.attest(command="proof verdict", task="T005", run=self.run_doc["run_id"], agent_id="agent-ver",
                        agent_type="execution-verifier", ts="2026-10-03T07:11:45.000000Z")
        self.assertEqual(self.verdict()[0], 0)

    @SLOW
    def test_old_attestation_ignored(self) -> None:
        self.env.attest(command="proof verdict", task="T005", run=self.run_doc["run_id"], agent_id="agent-ver",
                        agent_type="execution-verifier", ts="2026-10-03T06:50:00.000000Z", n=3)
        self.assertEqual(self.verdict()[0], 3)

    @SLOW
    def test_fail_verdict_moves_to_failed(self) -> None:
        self.attest_verifier()
        code, envl = self.verdict(verdict="fail")
        self.assertEqual(code, 0, envl["errors"])
        st = jsonio.read_json(self.env.layout.status("A"))["tasks"]["T005"]
        self.assertEqual(st["status"], "failed")


# --- contract revision 3: one control rule, proven-public values, the real B04 modules ------------------------------

class ControlRequirement(unittest.TestCase):
    """F13 (README.md 10, revision 3): `proof verdict` applies exactly the rule of the done check. Lane B04 exposes
    no public function for it, so proof.control_required is pinned here to B04's `status._nc_required` over every
    kind and control kind (a change on either side fails this test)."""

    def test_same_rule_as_the_done_check(self) -> None:
        from execlib import status
        self.assertTrue(callable(getattr(status, "_nc_required", None)), "B04's done-check rule moved: re-pin it")
        kinds = ("code", "test", "infra", "deploy", "tx", "research", "watch", "gate", "manual", "decision")
        controls = ("pre-implementation", "planted-defect", "forgery", "not-applicable", None)
        for kind in kinds:
            for nc in controls:
                with self.subTest(kind=kind, control=nc):
                    task = S.build_task("T005", kind=kind)
                    if nc is None:
                        task["proof"].pop("negative_control", None)
                    else:
                        task["proof"]["negative_control"] = {"kind": nc, "description": "control",
                                                             "expect_nonzero": True}
                    self.assertEqual(proof.control_required(task),
                                     status._nc_required(model_mod.Task.from_raw(task)))
        # the F13 cases: EX-BOOT and EX-DLV-TAG (infra, pre-implementation) and a deploy with a forgery need theirs
        infra = S.build_task("T005", kind="infra")
        self.assertTrue(proof.control_required(infra))
        deploy = S.build_task("T005", kind="deploy")
        deploy["proof"]["negative_control"] = {"kind": "forgery", "description": "x", "expect_nonzero": True}
        self.assertTrue(proof.control_required(deploy))
        waived = S.build_task("T005", kind="research")
        waived["proof"]["negative_control"] = {"kind": "not-applicable", "description": "x", "expect_nonzero": True,
                                               "waived_reason": "a research note"}
        self.assertFalse(proof.control_required(waived))  # positive control: a waived control is not required


class PublicValuesMirror(unittest.TestCase):
    """MODULES.md 8 gives proof no edge to integrity (contract question Q-B06-27), so `proof run` registers a confirmed
    hash through a mirror of integrity.register_public_value: the same inputs give the same file bytes, the same
    refusals and the same idempotence, and integrity reads what proof wrote."""

    def test_same_line_same_refusals(self) -> None:
        tmp = S.mkdtemp()
        try:
            via_integrity = paths.layout_for(None, tmp / "integrity" / ".execution")
            via_proof = paths.layout_for(None, tmp / "proof" / ".execution")
            for layout in (via_integrity, via_proof):
                jsonio.write_json_atomic(layout.local_state, S.build_local_state("A"))
            ctx = Ctx(layout=via_proof, executor="A", now=S.fixed_now(), by="verifier", pretty=False,
                      command="proof run", log=get_logger("execlib.proof"))
            values = ["0x" + hashlib.sha256(b"mirror-1").hexdigest(), hashlib.sha256(b"mirror-2").hexdigest()]

            def both(**kw: str) -> tuple[object, object]:
                out: list[object] = []
                for layout, call in ((via_integrity, lambda: integrity.register_public_value(via_integrity, **kw)),
                                     (via_proof, lambda: proof._register_public_value(ctx, **kw))):
                    with locks.hold(layout, "state", command="test"):
                        try:
                            out.append(call())
                        except PolicyRefused as err:
                            out.append((err.code, err.message))
                return out[0], out[1]

            with S.patched_env(EXEC_TEST="1", EXEC_NOW=S.FIXED_NOW):
                for value in values + values:  # the second round finds every value listed
                    first, second = both(value=value, kind=proof.tx_hash_kind(value), chain="evm",
                                         network="testnet", proven="tx-proof",
                                         source="local/proof-runs/T005/r/run.json")
                    self.assertEqual(first, second)
                for over in ({"proven": "owner-attest"}, {"kind": "address"}, {"value": values[0][2:]},
                             {"chain": ""}, {"source": " "}):
                    kw = {"value": values[0], "kind": "evm-tx-hash", "chain": "evm", "network": "testnet",
                          "proven": "tx-proof", "source": "s"}
                    kw.update(over)
                    with self.subTest(refusal=sorted(over)):
                        first, second = both(**kw)
                        self.assertEqual(first, second)
                        self.assertEqual(first[0], "E_POLICY")  # type: ignore[index]
            raw = integrity.public_values_path(via_integrity).read_bytes()
            self.assertEqual(raw, (via_proof.state / proof.PUBLIC_VALUES_FILE).read_bytes())
            self.assertEqual(len(raw.splitlines()), 2)
            self.assertEqual(integrity.load_public_values(via_proof), proof._public_values(via_proof))
            self.assertEqual(proof._public_values(via_proof), frozenset(v.lower() for v in values))
        finally:
            S.rmtree(tmp)


@NEEDS
class TxPublicValues(unittest.TestCase):
    """README.md 8 and CLI.md `proof run` (tx), contract revision 3 (F14): a tx proof whose reader confirms the
    transaction registers the hash (proven tx-proof, once); a hash that is not proven public reaches the run document,
    so the tracked copies, only as its sha256; the copies a verdict writes pass the state repo's secret scan with the
    registered values and fail it without them (positive control)."""

    def setUp(self) -> None:
        self.env = B.B06Env(tasks=[B.proof_task("T005", kind="tx", phase="build")])
        self.tools = S.mkdtemp()
        S.write_text(self.tools / "reader.py", READER_FAKE)
        self.tx_hash = "0x" + hashlib.sha256(b"confirmed-tx").hexdigest()
        write_answer(self.env.layout, "T005-tx", task="T005", value=self.tx_hash, kind="tx-hash")
        reader = f"{S.paths.posix(Path(sys.executable))} {S.paths.posix(self.tools / 'reader.py')} {{hash}}"
        set_proof(self.env, "T005", {
            "type": "tx", "spec": {"chain": "evm", "network": "testnet", "hash_from": {"answer_key": "T005-tx"},
                                   "reader_cmd": reader},
            "expect": {"summary": "tx re-read"}, "max_runtime_min": 1,
            "negative_control": {"kind": "forgery", "description": "a forged hash must not be confirmed",
                                 "expect_nonzero": True}})
        self.base, self.sha = land(self.env, {"src/engine/feature.txt": "f\n"})
        set_status(self.env, "T005", "running")

    def tearDown(self) -> None:
        S.rmtree(self.tools)
        self.env.cleanup()

    def reader(self, mode: str) -> None:
        S.write_json(self.tools / "reader.json", {"mode": mode, "hash": self.tx_hash})

    def listed(self) -> list[dict]:
        path = self.env.layout.state / proof.PUBLIC_VALUES_FILE
        return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()] if path.is_file() else []

    def test_confirmed_hash_registered_others_by_sha256(self) -> None:
        # (1) the reader does not confirm it: nothing registered, the run names it only by its sha256
        self.reader("unknown")
        code, envl = run_proof_cli(self.env, self.sha)
        self.assertEqual(code, 1, envl["errors"])
        self.assertEqual(self.listed(), [])
        self.assertIn(proof.hashed_value(self.tx_hash), envl["data"]["command"])
        self.assertNotIn(self.tx_hash[2:], json.dumps(envl["data"]))
        # (2) confirmed: registered once, proven tx-proof, this run as its source; named verbatim from then on
        self.reader("ok")
        code, envl = run_proof_cli(self.env, self.sha)
        self.assertEqual(code, 0, envl["errors"])
        run_id = envl["data"]["run_id"]
        self.assertEqual(self.listed(), [{"value": self.tx_hash, "kind": "evm-tx-hash", "chain": "evm",
                                          "network": "testnet", "proven": "tx-proof",
                                          "source": f"local/proof-runs/T005/{run_id}/run.json",
                                          "at_utc": S.FIXED_NOW, "executor": "A"}])
        self.assertIn(self.tx_hash, envl["data"]["command"])
        code, _e = run_proof_cli(self.env, self.sha)
        self.assertEqual(code, 0)
        self.assertEqual(len(self.listed()), 1)  # a second confirmation adds no line
        # (3) the forgery control: the seeded hash is never registered and appears only as its sha256
        code, envl = run_proof_cli(self.env, self.sha, "--negative-control", by="test-designer")
        self.assertEqual(code, 0, envl["errors"])
        forged = proof.forged_tx_hash("T005", self.sha, self.tx_hash, "evm")
        self.assertIn(proof.hashed_value(forged), envl["data"]["command"])
        self.assertNotIn(forged[2:], json.dumps(envl["data"]))
        self.assertEqual(len(self.listed()), 1)
        # (4) the verdict's tracked copies (receipt, run, control, merge receipt)
        self.env.attest(command="merge", task="T005", attempt=1, agent_id="agent-impl",
                        agent_type="execution-implementer", n=1)
        self.env.attest(command="proof verdict", task="T005", run=run_id, agent_id="agent-ver",
                        agent_type="execution-verifier", n=2)
        code, envl, _l = B.run_exec_fakes(
            ["proof", "verdict", "--task", "T005", "--run", run_id, "--verdict", "pass", "--findings",
             str(findings(self.env.private / "findings.json")), "--attempt", "1", "--model", "opus", "--effort",
             "high", "--by", "verifier"], self.env.repo, self.env.env)
        self.assertEqual(code, 0, envl["errors"])
        state = self.env.layout.state
        added = [(p.relative_to(state).as_posix(), i, line) for p in sorted((state / "proofs").rglob("*.json"))
                 for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)]
        self.assertEqual(len({a[0] for a in added}), 4)
        self.assertNotIn(forged[2:], "\n".join(a[2] for a in added))
        public = integrity.load_public_values(self.env.layout)
        scanner = functools.partial(integrity.scan_secrets, public=public)
        scan = integrity.with_positive_control(scanner, (integrity.planted_secret_line(),), added)
        self.assertEqual(scan.state, "ok", scan.detail)
        # positive control: without the registry the honest hash, named verbatim, is a hit
        self.assertEqual(integrity.scan_secrets(added).state, "fail")


@NEEDS
class RealB04Verdict(unittest.TestCase):
    """F13 and F18 through the REAL exec.py with lane B04's real results and status modules (the governor reading
    from the EXEC_GOVERNOR_READINGS test seam): an infra task of the EX-BOOT shape (a pre-implementation control)
    needs its negative control like every agent task (P-13, SCHEMAS.md 4.3 condition 6). Without a control run the
    pass verdict is refused with exit 4 and nothing written (no receipt, no copy, no event, the status untouched);
    with a met control the same verdict reaches done and its receipt says the control was required."""

    def test_infra_task_needs_its_control(self) -> None:
        env = B.B06Env(tasks=[B.proof_task("T005", kind="infra", phase="setup")])
        try:
            set_proof(env, "T005", command_proof("test -f src/engine/feature.txt && printf ok"))
            _base, sha = land(env, {"src/engine/feature.txt": "f\n"})
            set_status(env, "T005", "running")

            def real(*args: str) -> tuple[int, dict]:
                code, envl, _l = B.run_exec_real(list(args), env.repo, env.env)
                return code, envl

            code, envl = real("proof", "run", "--task", "T005", "--sha", sha, "--by", "verifier")
            self.assertEqual(code, 0, envl["errors"])
            run_id = envl["data"]["run_id"]
            env.attest(command="merge", task="T005", attempt=1, agent_id="agent-impl",
                       agent_type="execution-implementer", n=1)
            env.attest(command="proof verdict", task="T005", run=run_id, agent_id="agent-ver",
                       agent_type="execution-verifier", n=2)
            verdict = ["proof", "verdict", "--task", "T005", "--run", run_id, "--verdict", "pass", "--findings",
                       str(findings(env.private / "findings.json")), "--attempt", "1", "--model", "opus",
                       "--effort", "high", "--by", "verifier"]
            before = state_bytes(env)
            code, envl = real(*verdict)
            self.assertEqual((code, envl["errors"][0]["code"]), (4, "E_POLICY"), envl["errors"])
            self.assertIn("negative control is required", envl["errors"][0]["message"])
            self.assertEqual(state_bytes(env), before)
            self.assertEqual(jsonio.read_json(env.layout.status("A"))["tasks"]["T005"]["status"], "running")
            # positive control: the met control of the landed SHA, then the same verdict reaches done
            code, envl = real("proof", "run", "--task", "T005", "--sha", sha, "--negative-control", "--by",
                              "test-designer")
            self.assertEqual(code, 0, envl["errors"])
            control_exit = envl["data"]["negative_control"]["exit_code"]
            code, envl = real(*verdict)
            self.assertEqual(code, 0, envl["errors"])
            self.assertEqual(envl["data"]["negative_control"],
                             {"required": True, "ran": True, "exit_code": control_exit, "met": True})
            st = jsonio.read_json(env.layout.status("A"))["tasks"]["T005"]
            self.assertEqual((st["status"], [h["to"] for h in st["history"]]), ("done", ["built", "verifying", "done"]))
        finally:
            env.cleanup()


if __name__ == "__main__":
    unittest.main()
