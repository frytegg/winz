"""Helpers of lane B04's tests (status, reconcile, results, decisions, answers, manual, replay, resume).

`World` = a TempRepo (work tree + bare origin) with a minimal valid `.execution/` (approved plan of the given tasks,
status file, local state, marker) and builders for the evidence files the transition rows read: merge receipts in
any wave, proof runs (local and tracked copies), receipts, manifests, answers, decisions. In-process calls use
`world.ctx(command)`, a `model.Ctx` at the fixed instant; CLI calls use `world.run([...])`, which passes --repo.

Not a test module. Run the lane's tests from the skill root:
python -m unittest discover -s scripts/tests -p "test_*.py" -v
"""
from __future__ import annotations

import copy
import json
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator

import _support as S

from execlib import clock, jsonio, plan as planmod, statusio
from execlib.log import get_logger
from execlib.model import Ctx

B04_FIXTURES = S.FIXTURES / "B04"
B01_DOCS = S.B01_FIXTURES / "docs"


def b01_doc(name: str) -> dict:
    return json.loads((B01_DOCS / f"{name}.ok.json").read_text(encoding="utf-8"))


def default_tasks() -> list[dict]:
    """T001 code, T002 code after T001, T003 manual, T004 decision, T005 gate after T002."""
    return [S.build_task("T001"),
            S.build_task("T002", deps=("T001",), writes=["src/t2/**"]),
            S.build_task("T003", kind="manual"),
            S.build_task("T004", kind="decision"),
            S.build_task("T005", kind="gate", deps=("T002",), writes=[],
                         proof={"type": "command", "spec": {"cmd": "node check.mjs", "shell": "bash", "cwd": ".",
                                                            "install": False},
                                "expect": {"summary": "the gate passes", "exit_code": 0}, "max_runtime_min": 2,
                                "negative_control": {"kind": "forgery", "description": "a forged state fails",
                                                     "expect_nonzero": True}})]


class World:
    """A product repository with a state directory, for in-process and CLI tests."""

    def __init__(self, tasks: list[dict] | None = None, *, approved: bool = True, run_state: str = "RUNNING",
                 status_tasks: dict | None = None, executor: str = "A", plan_over: dict | None = None) -> None:
        self.repo = S.TempRepo()
        self.root = self.repo.root
        self.path = self.repo.path
        self.executor = executor
        self.now = S.fixed_now()
        self.reset(tasks, approved=approved, run_state=run_state, status_tasks=status_tasks, plan_over=plan_over)

    def reset(self, tasks: list[dict] | None = None, *, approved: bool = True, run_state: str = "RUNNING",
              status_tasks: dict | None = None, plan_over: dict | None = None) -> None:
        """A fresh `.execution/` in the same repository (git history is kept: tests stay fast)."""
        state = self.path / ".execution"
        if state.exists():
            S.rmtree(state)
        self.repo.git("fetch", "--quiet", "origin")
        if self.repo.git("rev-parse", "HEAD") != self.repo.git("rev-parse", "origin/main"):
            self.repo.git("reset", "--quiet", "--hard", "origin/main")
        plan = S.build_plan(tasks if tasks is not None else default_tasks(), **(plan_over or {}))
        self.layout = S.state_dir(self.path, executor=self.executor, run_state=run_state, plan=plan,
                                  approved=approved, status=S.build_status(self.executor, status_tasks or {}))
        jsonio.write_json_atomic(self.layout.profile, S.build_profile())
        jsonio.write_json_atomic(self.layout.policy, S.build_policy())
        self.repo.git("update-index", "-q", "--refresh", check=False)
        exclude = self.path / ".git" / "info" / "exclude"
        if ".execution/" not in exclude.read_text(encoding="utf-8"):
            with open(exclude, "a", encoding="utf-8", newline="\n") as fh:
                fh.write(".execution/\n")

    # -- context -------------------------------------------------------------------------------------------------
    def ctx(self, command: str, *, executor: str | None = None, by: str = "orchestrator",
            now: datetime | None = None) -> Ctx:
        return Ctx(layout=self.layout, executor=executor or self.executor, now=now or self.now, by=by, pretty=False,
                   command=command, log=get_logger("tests.B04"))

    @contextmanager
    def locked(self, *names: str) -> Iterator[None]:
        from execlib import locks

        ctxs = [locks.hold(self.layout, n, command="test") for n in (names or ("state",))]
        env = S.patched_env(CLAUDE_CODE_SESSION_ID=S.SESSION_ID)  # in-process events carry the test session
        env.__enter__()
        for c in ctxs:
            c.__enter__()
        try:
            yield
        finally:
            for c in reversed(ctxs):
                c.__exit__(None, None, None)
            env.__exit__(None, None, None)

    def run(self, args: list[str], *, env: dict | None = None, now: str | None = None) -> tuple[int, dict, list]:
        extra = ["--repo", str(self.path)]
        if now:
            extra += ["--now", now]
        return S.run_exec([*args, *extra], cwd=self.path, env=env)

    # -- documents -----------------------------------------------------------------------------------------------
    def plan(self) -> Any:
        return planmod.load(self.layout)

    def task(self, tid: str) -> Any:
        return self.plan().by_id[tid]

    def status_doc(self) -> dict:
        return statusio.load(self.layout, self.executor)

    def status_bytes(self) -> bytes:
        path = self.layout.status(self.executor)
        return path.read_bytes() if path.exists() else b""

    def set_status(self, tid: str, status: str, **over: Any) -> None:
        doc = self.status_doc()
        doc["tasks"][tid] = S.build_task_status(status, **over)
        jsonio.write_json_atomic(self.layout.status(self.executor), doc)

    def entry(self, tid: str) -> dict | None:
        return (self.status_doc().get("tasks") or {}).get(tid)

    def events(self, type_: str | None = None) -> list[dict]:
        out = []
        for _n, ev in jsonio.read_jsonl(self.layout.events):
            if isinstance(ev, dict) and (type_ is None or ev.get("type") == type_):
                out.append(ev)
        return out

    def local_state(self) -> dict:
        return jsonio.read_json(self.layout.local_state)

    def write_local_state(self, doc: dict) -> None:
        jsonio.write_json_atomic(self.layout.local_state, doc)

    # -- git -----------------------------------------------------------------------------------------------------
    def land(self, rel: str = "src/t1/a.ts", text: str = "export const a = 1;\n", message: str = "feat: land") -> str:
        """A commit pushed to origin/main; returns its SHA (the content carries a counter: never an empty commit)."""
        self._n = getattr(self, "_n", 0) + 1
        self.repo.write(rel, f"{text}// {self._n}\n")
        sha = self.repo.commit_all(message)
        self.repo.git("push", "--quiet", "origin", "main")
        return sha

    def local_commit(self, rel: str = "src/t1/b.ts") -> str:
        """A commit that is NOT on origin/main (local main is then ahead; reset() puts it back on origin/main)."""
        self._n = getattr(self, "_n", 0) + 1
        self.repo.write(rel, f"export const b = {self._n};\n")
        return self.repo.commit_all("feat: local only")

    # -- evidence ------------------------------------------------------------------------------------------------
    def merge_receipt(self, tid: str, sha: str | None, *, wave: str = "W01", attempt: int = 1, outcome: str = "landed",
                      tracked: bool = False, rerun: int = 0) -> Path:
        doc = S.build_merge_receipt(tid, outcome=outcome, wave=wave, attempt=attempt, rerun=rerun,
                                    gates={"label": f"merge-{tid}-a{attempt}r{rerun}", "result_path": None,
                                           "exit_code": 0, "flaky": []})
        doc["landed_sha"] = sha if outcome == "landed" else None
        path = (self.layout.merge_copy(tid, attempt) if tracked
                else self.layout.result(wave, tid, "merge", attempt))
        jsonio.write_json_atomic(path, doc)
        return path

    def proof_run(self, tid: str, sha: str, *, run_id: str | None = None, met: bool = True, exit_code: int = 0,
                  role: str = "verifier", tracked: bool = False, nc_met: bool = True) -> str:
        doc = b01_doc("proof-run")
        rid = run_id or f"{tid}-{sha[:8]}-20261003T071200Z-1"
        doc.update({"run_id": rid, "task": tid, "sha": sha, "exit_code": exit_code,
                    "proof_hash": planmod.proof_digest(self.task(tid).raw),
                    "expectation": {"met": met, "details": ["test"]}})
        doc["by"] = {"role": role, "agent_type": "execution-verifier", "executor": self.executor}
        doc["negative_control"]["met"] = nc_met
        path = self.layout.proof_run_copy(tid, rid) if tracked else self.layout.proof_run_dir(tid, rid) / "run.json"
        jsonio.write_json_atomic(path, doc)
        return rid

    def receipt(self, tid: str, sha: str, run_id: str, **over: Any) -> dict:
        fields: dict[str, Any] = {"sha": sha, "run": run_id, "proof_hash": planmod.proof_digest(self.task(tid).raw),
                                  "run_copy": f"proofs/runs/{tid}/{run_id}.json"}
        fields.update(over)
        doc = S.build_receipt(tid, **fields)
        jsonio.write_json_atomic(self.layout.receipt(tid), doc)
        return doc

    def impl_result(self, tid: str, *, wave: str = "W01", attempt: int = 1, status: str = "built",
                    blocked: dict | None = None, tracked: bool = False) -> Path:
        doc = b01_doc("result-implementer")
        doc.update({"task": tid, "wave": wave, "attempt": attempt, "status": status, "blocked": blocked})
        doc["merge"] = dict(doc["merge"], receipt_path=f"local/results/{wave}/{tid}.merge.a{attempt}.json")
        if status != "built":
            doc["merge"] = None
        path = self.layout.impl_copy(tid, attempt) if tracked else self.layout.result(wave, tid, "implementer",
                                                                                         attempt)
        jsonio.write_json_atomic(path, doc)
        return path

    def done_fixture(self, tid: str = "T001", *, tracked: bool = False) -> dict:
        """Everything SCHEMAS.md 4.3 needs for `tid` (landed on origin/main, verifier run, pass receipt)."""
        sha = self.land(f"src/{tid.lower()}/done.ts")
        self.merge_receipt(tid, sha, tracked=False)
        self.impl_result(tid)
        rid = self.proof_run(tid, sha)
        if tracked:
            self.merge_receipt(tid, sha, tracked=True)
            self.impl_result(tid, tracked=True)
            self.proof_run(tid, sha, run_id=rid, tracked=True)
        receipt = self.receipt(tid, sha, rid)
        return {"sha": sha, "run": rid, "receipt": receipt}

    def manifest(self, wave: str, tasks: list[dict], *, status: str = "launching", launch: dict | None = None,
                 launching_utc: str | None = None) -> dict:
        doc = b01_doc("wave-manifest")
        doc.update({"wave": wave, "executor": self.executor, "status": status, "launch": launch,
                    "launching_utc": launching_utc or S.FIXED_NOW, "workflow_name": f"queue-clock-{wave.lower()}"})
        base = copy.deepcopy(doc["tasks"][0])
        items = []
        for t in tasks:
            item = copy.deepcopy(base)
            item.update(t)
            item["results"] = {"implementer": f"local/results/{wave}/{item['task']}.implementer.a{item['attempt']}.json"}
            items.append(item)
        doc["tasks"] = items
        doc["lanes"] = [{"lane": "L1", "workspace_mode": "single-tree", "tasks": [i["task"] for i in items]}]
        jsonio.write_json_atomic(self.layout.wave_manifest(wave), doc)
        return doc

    def answer(self, key: str, task: str, *, ok: bool = True, kind: str = "text", bb: str | None = None,
               method: str = "owner-attest") -> Path:
        header = {"schema": "execution.answer/1", "key": key, "task": task, "decision": None,
                  "bring_back_key": bb or key, "kind": kind, "source": "terminal", "received_utc": S.FIXED_NOW,
                  "by": "devA", "value": None, "attachments": [],
                  "verification": {"method": method, "ok": ok, "detail": "test", "at_utc": S.FIXED_NOW,
                                   "command": None, "exit_code": None}}
        path = self.layout.answer(key)
        S.write_text(path, "```json\n" + json.dumps(header, indent=2, sort_keys=True) + "\n```\n\nok\n")
        return path

    def text_file(self, name: str, text: str) -> Path:
        return S.write_text(self.root / "inputs" / name, text)

    def state_repo(self) -> None:
        """Make `.execution/` its own git repository with everything committed, as `exec.py init` leaves it
        (SCHEMAS.md 1.1: `.gitattributes`, `.gitignore` = local/ and frontend/gates/). Without an origin, `exec.py
        sync` commits what changed afterwards (its secret scan included) and pushes nothing."""
        sd = self.layout.state
        S.write_text(sd / ".gitattributes", "* text=auto eol=lf\nevents.jsonl merge=union\ndecisions.md merge=union\n"
                                            "public-values.jsonl merge=union\n")
        S.write_text(sd / ".gitignore", "local/\nfrontend/gates/\n")
        S.git(sd, "init", "--quiet", "-b", "main")
        S.git(sd, "add", "--all")
        S.write_text(self.root / "state-commit-msg.txt", "chore(state): initial state\n")
        S.git(sd, "commit", "--quiet", "-F", str(self.root / "state-commit-msg.txt"))

    def state_git(self, *args: str) -> str:
        return S.git(self.layout.state, *args).stdout.decode("utf-8")

    def public_rows(self) -> list[dict]:
        """The lines of the state repo's public-values.jsonl (README.md 8, SCHEMAS.md 1.1)."""
        path = self.layout.state / "public-values.jsonl"
        if not path.exists():
            return []
        return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]

    def cleanup(self) -> None:
        self.repo.cleanup()


def utc(text: str) -> datetime:
    return clock.parse_utc(text)
