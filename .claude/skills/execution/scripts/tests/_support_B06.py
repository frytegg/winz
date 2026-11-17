"""Test helpers of lane B06 (proof, merge, integrity, hardenbridge).

Fakes of the modules of other lanes, through the signatures of contract/MODULES.md (LANES.md 1: fakes live in the
test helpers, never in execlib/): `results.landed_receipt`, `results.find_any_wave`, `results.finalize_merge_intents`
(B04), `status.transition` and `status.check_done_evidence` (B04) and `governor.read` (B08). They are installed
in-process by `install_fakes()` and in the CLI subprocess by the driver `fixtures/B06/exec_fakes.py`, which runs
`execlib.cli.main` exactly as exec.py does after installing them. The governor's reading itself comes from
EXEC_GOVERNOR_READINGS (honoured with EXEC_TEST=1). B04 and B08 are integrated: the tests that must see their real
behaviour (the done check, the transitions, the landed-receipt lookup) run the real exec.py through `run_exec_real`.

`B06Env` builds a product repo (work tree + bare origin), an approved plan, a profile whose scratch root lies outside
every work tree, a policy, a gates.json with one offline gate, and the governor readings file.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import sys
import types
from pathlib import Path
from typing import Any, Mapping

import _support as S

from execlib import clock, events, jsonio, paths

DRIVER = S.FIXTURES / "B06" / "exec_fakes.py"
PROOF_OK = "printf 'proof-ok\\n'"


# --- fakes (MODULES.md signatures) ---------------------------------------------------------------------------------

def _fake_results() -> types.ModuleType:
    mod = types.ModuleType("execlib.results")

    def _receipts(layout: paths.Layout, task: str) -> list[dict]:
        root = layout.local / "results"
        out = []
        for p in sorted(root.glob(f"*/{task}.merge.a*.json")) if root.is_dir() else []:
            try:
                doc = jsonio.read_json(p)
            except (OSError, ValueError):
                continue
            if isinstance(doc, dict) and doc.get("task") == task:
                out.append(doc)
        return out

    def landed_receipt(layout: paths.Layout, task: str, attempt: int | None = None) -> dict | None:
        best = None
        for doc in _receipts(layout, task):
            if doc.get("outcome") != "landed" or not doc.get("landed_sha"):
                continue
            if attempt is not None and doc.get("attempt") != attempt:
                continue
            key = (int(doc["attempt"]), int(doc.get("rerun", 0)), str(doc.get("finished_utc")))
            if best is None or key > best[0]:
                best = (key, doc)
        return best[1] if best else None

    def find_any_wave(layout: paths.Layout, task: str, role: str, attempt: int) -> tuple[str, dict] | None:
        root = layout.local / "results"
        hits = sorted(root.glob(f"*/{task}.{role}.a{attempt}.json"), reverse=True) if root.is_dir() else []
        for p in hits:
            return p.parent.name, jsonio.read_json(p)
        return None

    def finalize_merge_intents(ctx: Any, git: Any) -> list[str]:
        done = []
        folder = ctx.layout.merge_pending_dir
        for p in sorted(folder.glob("*.json")) if folder.is_dir() else []:
            m = re.match(r"^(T\d{3,})\.a(\d+)r(\d+)\.json$", p.name)
            intent = jsonio.read_json(p)
            head = intent.get("head_sha")
            if not m or not git.is_ancestor(head, "origin/main"):
                continue
            task, attempt, rerun = m.group(1), int(m.group(2)), int(m.group(3))
            now = clock.format_utc(ctx.now)
            doc = {"schema": "execution.merge-receipt/1", "task": task, "attempt": attempt, "rerun": rerun,
                   "wave": intent["wave"], "lane": intent.get("lane"), "mode": intent.get("mode", "single-tree"),
                   "branch": intent.get("branch", "main"), "origin_before": intent["origin_before"],
                   "head_before": intent.get("head_before") or intent["origin_before"], "landed_sha": head,
                   "outcome": "landed", "push_attempts": 1,
                   "gates": {"label": None, "result_path": None, "exit_code": None, "flaky": []},
                   "task_proof": {"run": None, "exit_code": None}, "scans": [], "conflict_files": [],
                   "worktree_removed": False, "started_utc": now, "finished_utc": now,
                   "notes": "finalised from the merge intent (fake)"}
            jsonio.write_json_atomic(ctx.layout.result(intent["wave"], task, "merge", attempt), doc)
            p.unlink()
            done.append(f"{task}.a{attempt}r{rerun}")
        return done

    mod.landed_receipt = landed_receipt  # type: ignore[attr-defined]
    mod.find_any_wave = find_any_wave  # type: ignore[attr-defined]
    mod.finalize_merge_intents = finalize_merge_intents  # type: ignore[attr-defined]
    return mod


ALLOWED = {("running", "built"), ("built", "verifying"), ("verifying", "done"), ("verifying", "failed")}


def _fake_status() -> types.ModuleType:
    mod = types.ModuleType("execlib.status")

    def transition(ctx: Any, doc: dict, task: Any, to: str, *, evidence: list[str], reason: str | None = None,
                   **_kw: Any) -> dict:
        from execlib.errors import TransitionRefused
        entry = doc.setdefault("tasks", {}).get(task.id) or {"status": "planned", "since_utc": S.FIXED_NOW,
                                                              "attempts": 0, "history": []}
        current = entry["status"]
        if (current, to) not in ALLOWED or ctx.command != "proof verdict":
            raise TransitionRefused(f"fake: {current} -> {to} refused for {ctx.command}")
        at = clock.format_utc(ctx.now)
        entry["history"].append({"from": current, "to": to, "at_utc": at, "by": ctx.command,
                                 "evidence": evidence})
        entry["status"] = to
        entry["since_utc"] = at
        if to == "failed":
            entry["attempts"] = int(entry.get("attempts") or 0) + 1
        doc["tasks"][task.id] = entry
        events.append(ctx, "task.status", {"task": task.id, "from": current, "to": to, "evidence": evidence})
        return entry

    def check_done_evidence(layout: Any, plan: Any, task: Any, ts: Any, git: Any, **_kw: Any) -> list:
        """MODULES.md 4 signature; the fake has no opinion (the real done check runs in the RealB04 tests)."""
        return []

    mod.transition = transition  # type: ignore[attr-defined]
    mod.check_done_evidence = check_done_evidence  # type: ignore[attr-defined]
    return mod


def _fake_governor() -> types.ModuleType:
    mod = types.ModuleType("execlib.governor")

    class Readings:
        def __init__(self, **kw: Any) -> None:
            self.__dict__.update(kw)

    def read(profile: dict, repo: Path | None) -> Readings:
        return Readings(disk_free_gb=100.0, scratch_disk_free_gb=100.0, ram_free_gb=16.0, commit_free_gb=16.0,
                        ac_power=True, network=True, harden_active=False)

    mod.read = read  # type: ignore[attr-defined]
    mod.Readings = Readings  # type: ignore[attr-defined]
    return mod


_SAVED: dict[str, Any] = {}


def install_fakes() -> None:
    """Install the fakes in sys.modules and on the execlib package (idempotent)."""
    import execlib
    for name, factory in (("results", _fake_results), ("status", _fake_status), ("governor", _fake_governor)):
        full = f"execlib.{name}"
        if full not in _SAVED:
            _SAVED[full] = (sys.modules.get(full), getattr(execlib, name, None))
        mod = factory()
        sys.modules[full] = mod
        setattr(execlib, name, mod)


def remove_fakes() -> None:
    import execlib
    for full, (mod, attr) in list(_SAVED.items()):
        name = full.split(".")[1]
        if mod is None:
            sys.modules.pop(full, None)
        else:
            sys.modules[full] = mod
        if attr is None:
            if hasattr(execlib, name):
                delattr(execlib, name)
        else:
            setattr(execlib, name, attr)
    _SAVED.clear()


# --- the CLI through the driver -------------------------------------------------------------------------------------

def run_exec_fakes(args: list[str], cwd: Path | str, env: Mapping[str, str] | None = None, *,
                   timeout: float = 240) -> tuple[int, dict, list[dict]]:
    """_support.run_exec (every TESTS.md 1.7 assertion) through the driver that installs the fakes first."""
    old = S.EXEC_PY
    S.EXEC_PY = DRIVER
    try:
        return S.run_exec(args, cwd, env, timeout=timeout)
    finally:
        S.EXEC_PY = old


def run_exec_real(args: list[str], cwd: Path | str, env: Mapping[str, str] | None = None, *,
                  timeout: float = 600) -> tuple[int, dict, list[dict]]:
    """The real scripts/exec.py (lanes B04 and B08 integrated: no fake), with every TESTS.md 1.7 assertion."""
    return S.run_exec(args, cwd, env, timeout=timeout)


def tree_digest(root: Path) -> dict[str, str]:
    """sha256 of every file under `root` (relative POSIX path -> digest); empty when `root` is absent."""
    if not root.is_dir():
        return {}
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file()}


def register_public(layout: paths.Layout, value: str, *, chain: str = "evm", network: str = "testnet",
                    proven: str = "chain-reread", source: str = "answers/T004-tx.md") -> bool:
    """integrity.register_public_value under the state lock (as `answers ingest` calls it)."""
    from execlib import integrity, locks
    with locks.hold(layout, "state", command="test"):
        return integrity.register_public_value(layout, value=value, kind="evm-tx-hash" if value.startswith("0x")
                                               else "tx-hash", chain=chain, network=network, proven=proven,
                                               source=source)


# --- environment ----------------------------------------------------------------------------------------------------

def proof_task(tid: str = "T005", *, cmd: str = PROOF_OK, kind: str = "code", writes: list[str] | None = None,
               deps: tuple[str, ...] = (), proof: dict | None = None, **over: Any) -> dict:
    task = S.build_task(tid, kind=kind, deps=deps, writes=writes or ["src/engine/**"])
    task["proof"]["spec"]["cmd"] = cmd
    if proof is not None:
        task["proof"] = proof
    task.update(over)
    return task


class B06Env:
    """A product repo with an approved plan, profile, policy, gates.json and governor readings."""

    def __init__(self, tasks: list[dict] | None = None, *, files: Mapping[str, str] | None = None,
                 gates: list[dict] | None = None, profile_over: Mapping[str, Any] | None = None,
                 policy_over: Mapping[str, Any] | None = None, never_show: bool = True,
                 protected: list[str] | None = None, readings: Mapping[str, Any] | None = None) -> None:
        self.repo_obj = S.TempRepo(files=files or {"README.md": "# temp repo\n",
                                                   "src/engine/eta.mjs": "export const eta = 1;\n",
                                                   "src/cli/main.mjs": "export const cli = 1;\n"})
        self.repo = self.repo_obj.path
        self.root = self.repo_obj.root
        self.scratch = S.mkdtemp()
        self.private = S.mkdtemp()
        self.tasks = tasks if tasks is not None else [proof_task("T005")]
        plan = S.build_plan(self.tasks)
        plan["lanes"][1]["globs"] = ["src/**", "tests/**", ".github/**", "README.md", ".execution/frontend/**"]
        if protected is not None:
            plan["protected"] = protected
        self.layout = S.state_dir(self.repo, plan=plan)
        exclude = self.repo / ".git" / "info" / "exclude"
        S.write_text(exclude, (exclude.read_text(encoding="utf-8") if exclude.exists() else "") + ".execution/\n")
        self.plan = jsonio.read_json(self.layout.plan)
        ns_path = None
        if never_show:
            ns_doc = json.loads((S.RENDERED / "never-show.json").read_text(encoding="utf-8"))
            ns_path = self.private / "never-show.json"
            S.write_json(ns_path, ns_doc)
        machine = copy.deepcopy(S.build_profile()["machine"])
        machine["scratch_root"] = paths.posix(self.scratch)
        prof_paths = copy.deepcopy(S.build_profile()["paths"])
        prof_paths["never_show"] = paths.posix(ns_path) if ns_path else None
        profile = S.build_profile(machine=machine, paths=prof_paths)
        for k, v in (profile_over or {}).items():
            profile[k] = v
        S.write_json(self.layout.profile, profile)
        self.profile = profile
        policy = S.build_policy()
        policy["git"]["push_freeze_utc"] = "2026-10-07T15:59:00Z"
        for k, v in (policy_over or {}).items():
            policy[k] = v
        S.write_json(self.layout.policy, policy)
        self.policy = policy
        g = gates if gates is not None else [{"name": "offline", "cmd": [sys.executable, "-c",
                                                                         "import sys; sys.exit(0)"],
                                              "timeout_s": 120}]
        if g:  # gates=[] leaves the state without gates.json (the contract wave has not landed it)
            S.write_json(self.layout.gates_json, {"install": [], "gates": g})
        self.readings_path = self.private / "readings.json"
        r = {"disk_free_gb": 100.0, "scratch_disk_free_gb": 100.0, "ram_free_gb": 16.0, "commit_free_gb": 16.0,
             "ac_power": True, "network": True, "harden_active": False}
        r.update(readings or {})
        S.write_json(self.readings_path, r)
        self.env = S.env_isolated(EXEC_GOVERNOR_READINGS=str(self.readings_path))

    # git helpers
    def git(self, *args: str, cwd: Path | None = None, check: bool = True) -> str:
        return self.repo_obj.git(*args, cwd=cwd, check=check)

    def origin_main(self) -> str:
        return S.git(self.repo_obj.origin, "rev-parse", "main", env=self.env).stdout.decode().strip()

    def write(self, rel: str, text: str) -> Path:
        return self.repo_obj.write(rel, text)

    def message(self, text: str, name: str = "msg.txt") -> Path:
        return S.write_text(self.private / name, text if text.endswith("\n") else text + "\n")

    def run(self, *args: str, env: Mapping[str, str] | None = None, cwd: Path | None = None
            ) -> tuple[int, dict, list[dict]]:
        return run_exec_fakes(list(args), cwd or self.repo, env or self.env)

    def merge_single(self, task: str = "T005", msg: str = "feat(engine): add the eta", *, attempt: int = 1,
                     rerun: int = 0, wave: str = "W01", extra: tuple[str, ...] = (),
                     env: Mapping[str, str] | None = None) -> tuple[int, dict, list[dict]]:
        mf = self.message(msg, f"msg-{task}-{attempt}-{rerun}.txt")
        return self.run("merge", "--task", task, "--attempt", str(attempt), "--rerun", str(rerun), "--wave", wave,
                        "--single-tree", "--message-file", str(mf), *extra, env=env)

    def receipt_path(self, task: str = "T005", wave: str = "W01", attempt: int = 1) -> Path:
        return self.layout.result(wave, task, "merge", attempt)

    def attest(self, *, command: str, task: str, agent_id: str, agent_type: str, run: str | None = None,
               attempt: int | None = None, ts: str = "2026-10-03T07:11:30.000000Z", n: int = 0) -> Path:
        data: dict[str, Any] = {"agent_id": agent_id, "agent_type": agent_type, "command": command, "task": task,
                                "at": ts}
        if run is not None:
            data["run"] = run
        if attempt is not None:
            data["attempt"] = attempt
        ev = {"ts": ts, "hook": "pre-tool-guard", "session_id": S.SESSION_ID, "agent_type": agent_type,
              "type": "guard.attest", "data": data}
        self._attest_n = getattr(self, "_attest_n", 0) + 1
        stamp = re.sub(r"[^0-9]", "", ts)
        path = self.layout.hook_events_dir / f"{stamp}Z-{n}-{self._attest_n}.json"
        S.write_json(path, ev)
        return path

    def cleanup(self) -> None:
        self.repo_obj.cleanup()
        S.rmtree(self.scratch)
        S.rmtree(self.private)
