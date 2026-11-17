"""Helpers of lane B05's tests (waves, briefs, wave scripts, the planner workflow).

`EmitWorld` extends lane B04's `World` (a TempRepo with a valid `.execution/`) with what `wave emit` needs before it
emits: a governor reading and a quota decision in local state, a passing hooks canary of the bound session, a passing
agents probe-check, a scratch root outside every repository, and optionally a schedule cache. Every exec.py call it
makes runs with a `SkillsHome`: a temp home whose `.claude/skills` holds the /frontend and /hackathon files lane B05
reads (wave fragments, receipt schemas, ledger templates), so no test reads the real `~/.claude` (LANES.md 1). The
harness helpers render a wave script from a hand-built manifest and run it under
`node scripts/tests/js/wave-harness.mjs` with a scripted fake agent().

Fixtures (`fixtures/B05/`): `fragments/` fake feCritique / feDirections (their behaviour is scripted by
`input.behaviour`), `fragments-bad/` a fragment with Math.random in code, `frontend-real/` pinned byte copies of
/frontend's real fragments and receipt schemas (sha256 prefix in the name; the live tier compares them with the
installed files), `hackathon/` pinned copies of /hackathon's ledger templates.

Not a test module. Run the lane's tests from the skill root:
python -m unittest discover -s scripts/tests -p "test_wave*.py" -v
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Mapping, Sequence

import _support as S
from _support_B04 import World

from execlib import events, jsonio, wavejs
from execlib.paths import posix

B05_FIXTURES = S.FIXTURES / "B05"
HARNESS = S.TESTS_DIR / "js" / "wave-harness.mjs"
NODE = shutil.which("node")
FRONTEND_REAL = B05_FIXTURES / "frontend-real"
REAL_FRAGMENTS: Mapping[str, Path] = {"feCritique": FRONTEND_REAL / "critique-32ea88f5.js",
                                      "feDirections": FRONTEND_REAL / "directions-a1d737ed.js"}
RECEIPT_SCHEMAS: Mapping[str, Path] = {
    "critique-receipt.schema.json": FRONTEND_REAL / "critique-receipt.schema-cd9f6ae8.json",
    "directions-receipt.schema.json": FRONTEND_REAL / "directions-receipt.schema-905c2fca.json"}
LEDGER_TEMPLATES: Mapping[str, Path] = {"claims.md": B05_FIXTURES / "hackathon" / "claims-a1173e85.md",
                                        "dx-journal.md": B05_FIXTURES / "hackathon" / "dx-journal-bd6813f3.md"}
FAKE = object()     # SkillsHome: install the fake fragment of the fixtures


def node_available() -> bool:
    return NODE is not None


def live_contract() -> bool:
    """TESTS.md 1.2: the live contract tier reads the sibling skills' real files, read-only."""
    return os.environ.get("EXEC_CONTRACT_LIVE") == "1"


# --- a temp home with the sibling skills' files -------------------------------------------------------------------

class SkillsHome:
    """A temp home: `.claude/skills/frontend/assets/{wave-fragments,schemas}`, `.claude/skills/hackathon/assets` and,
    with `fe_agents`, `.claude/agents/frontend-{critic,probe}.md` (with their marker line unless `fe_agent_marker` is
    False). Each fragment is FAKE (the fixture fake), a Path
    (copied byte for byte) or None (absent). exec.py subprocesses reach it through `env()` (USERPROFILE/HOME: the
    sibling skills resolve under Path.home(); CLAUDE_CONFIG_DIR: the agents)."""

    def __init__(self, *, critique: Any = FAKE, directions: Any = FAKE, receipt_schemas: bool = True,
                 ledgers: bool = True, fe_agents: bool = True, fe_agent_marker: bool = True,
                 frontend_library: bool = False) -> None:
        self.home = S.mkdtemp()
        self.claude = self.home / ".claude"
        self.frontend = self.claude / "skills" / "frontend"
        self.hackathon = self.claude / "skills" / "hackathon"
        frag_dir = self.frontend / "assets" / "wave-fragments"
        frag_dir.mkdir(parents=True)
        for name, choice in (("feCritique", critique), ("feDirections", directions)):
            target = frag_dir / wavejs.FRAGMENT_FILES[name]
            if choice is FAKE:
                shutil.copyfile(B05_FIXTURES / "fragments" / wavejs.FRAGMENT_FILES[name], target)
            elif choice is not None:
                shutil.copyfile(Path(choice), target)
        schemas = self.frontend / "assets" / "schemas"
        schemas.mkdir(parents=True)
        if receipt_schemas:
            for name, src in RECEIPT_SCHEMAS.items():
                shutil.copyfile(src, schemas / name)
        if frontend_library:
            S.write_text(self.frontend / "assets" / "task-templates" / "frontend.json", "{}\n")
        (self.hackathon / "assets").mkdir(parents=True)
        if ledgers:
            for name, src in LEDGER_TEMPLATES.items():
                shutil.copyfile(src, self.hackathon / "assets" / name)
        (self.claude / "agents").mkdir(parents=True)
        if fe_agents:
            # AGENTS.md 5.2: present = the file carries `frontend-agent-template: <name> v<n>`; without
            # `fe_agent_marker` the files exist but are not /frontend's (another agent under the same name)
            for name in ("frontend-critic", "frontend-probe"):
                marker = f"frontend-agent-template: {name} v1 (installed by install-agents.mjs)\n" \
                    if fe_agent_marker else f"An agent named {name}, not installed by /frontend.\n"
                S.write_text(self.claude / "agents" / f"{name}.md", f"---\nname: {name}\n---\n{marker}")

    def fragment_path(self, name: str) -> Path:
        return self.frontend / "assets" / "wave-fragments" / wavejs.FRAGMENT_FILES[name]

    def env(self, **overrides: Any) -> dict[str, str]:
        return S.env_isolated(USERPROFILE=str(self.home), HOME=str(self.home), CLAUDE_CONFIG_DIR=str(self.claude),
                              **overrides)

    def cleanup(self) -> None:
        S.rmtree(self.home)


# --- an emit-ready world ------------------------------------------------------------------------------------------

def governor_block(*, lanes: int = 3, verifiers: int = 2, browser: int = 1, pause: bool = False,
                   mode: str = "single-tree") -> dict:
    return {"at_utc": S.FIXED_NOW, "disk_free_gb": 50.0, "scratch_disk_free_gb": 50.0, "ram_free_gb": 8.0,
            "commit_free_gb": 16.0, "ac_power": True, "network": True, "harden_active": False,
            "decision": {"pause": pause, "lanes": lanes, "verifiers": verifiers, "browser_slots": browser,
                         "workspace_mode": mode, "reasons": ["disk low"] if pause else []}}


def quota_block(decision: str = "normal", **over: Any) -> dict:
    doc = {"at_utc": S.FIXED_NOW, "snapshot_age_s": 60, "five_hour_pct": 20.0,
           "five_hour_resets_utc": "2026-10-03T10:00:00Z", "seven_day_pct": 30.0,
           "seven_day_resets_utc": "2026-10-08T00:00:00Z", "decision": decision, "pause_until_utc": None,
           "limit_evidence_utc": None, "override": None}
    doc.update(over)
    return doc


class EmitWorld(World):
    """A World whose state passes every `wave emit` precondition (each test removes one to see the refusal). Its
    exec.py calls run with `self.skills.env()` unless a test passes its own environment."""

    def __init__(self, tasks: list[dict] | None = None, *, status_tasks: dict | None = None,
                 profile_over: dict | None = None, governor: dict | None = None, quota: dict | None = None,
                 approved: bool = True, canary: bool = True, probe: bool = True, skills: SkillsHome | None = None,
                 **kw: Any) -> None:
        super().__init__(tasks, status_tasks=status_tasks, approved=approved, **kw)
        self.skills = skills if skills is not None else SkillsHome()
        self.scratch = S.mkdtemp()
        prof = S.build_profile()
        prof["machine"] = dict(prof["machine"], scratch_root=posix(self.scratch))
        prof["paths"] = dict(prof["paths"], never_show=posix(self.scratch / "never-show.json"))
        prof.update(profile_over or {})
        self.profile = prof
        jsonio.write_json_atomic(self.layout.profile, prof)
        st = self.local_state()
        st["governor"] = governor if governor is not None else governor_block()
        st["quota"] = quota if quota is not None else quota_block()
        if canary:
            st["hooks"]["canary_ok_utc"] = S.FIXED_NOW
            st["hooks"]["permission_mode"] = "bypassPermissions"
        if probe:
            st["hooks"]["probe_ok_utc"] = S.FIXED_NOW
        self.write_local_state(st)
        if canary:
            with self.locked():
                events.append(self.ctx("hooks canary"), "hooks.canary",
                              {"ok": True, "session_id": S.SESSION_ID, "bound": True,
                               "permission_mode": "bypassPermissions"})

    def run(self, args: list[str], *, env: dict | None = None, now: str | None = None) -> tuple[int, dict, list]:
        return super().run(args, env=env if env is not None else self.skills.env(), now=now)

    def schedule_cache(self, ready: Sequence[str], *, critical: Sequence[str] = ()) -> None:
        doc = {"ready": [{"task": t, "rank": i + 1, "critical": t in critical} for i, t in enumerate(ready)],
               "critical_path": list(critical)}
        jsonio.write_json_atomic(self.layout.schedule_cache, doc)

    def emit(self, *extra: str, env: dict | None = None) -> tuple[int, dict, list]:
        return self.run(["wave", "emit", *extra], env=env)

    def tree_bytes(self) -> dict[str, bytes]:
        """Every file of the state directory except events and local/locks (to prove 'nothing written')."""
        out = {}
        for p in sorted(self.layout.state.rglob("*")):
            if p.is_file() and "locks" not in p.parts:
                out[posix(p.relative_to(self.layout.state))] = p.read_bytes()
        return out

    def cleanup(self) -> None:
        S.rmtree(self.scratch)
        self.skills.cleanup()
        super().cleanup()


def fe_task(tid: str, function: str = "feDirections", *, agents: dict | None = None, inp: object = "default",
            **over: Any) -> dict:
    """An FE-03 / FE-20 plan task as B02's adapter instantiates it: `params.fragment.file` records the planning
    machine's path (wave emit reads this machine's <frontend>/assets/wave-fragments instead, FRONTEND.md 9.1)."""
    name = wavejs.FRAGMENT_FILES[function]
    t = S.build_task(tid, writes=[f"src/fe{tid[1:]}/**"])
    t["template"] = "frontend:FE-03" if function == "feDirections" else "frontend:FE-20"
    given = agents if agents is not None else {"designer": {"model": "opus", "effort": "high"}}
    fragment_input = ({"task": tid, "cwd": "{workdir}", "behaviour": "ok", "agents": given}
                      if inp == "default" else inp)
    t["params"] = {"fragment": {"file": f"C:/planning-machine/frontend/assets/wave-fragments/{name}",
                                "function": function, "sha256": "e" * 64, "input": fragment_input}}
    t.update(over)
    return t


# --- harness ------------------------------------------------------------------------------------------------------

def harness_task(tid: str, *, chain: Sequence[str] = ("implementer", "verifier"), lane: str | None = "L1",
                 deps: Sequence[str] = (), rank: int = 0, resources: Sequence[str] = (), attempt: int = 1,
                 fix_attempts: Sequence[int] = (), kind: str = "code") -> dict:
    agents = {}
    phases = {"implementer": "Implement", "test-designer": "Implement", "integrator": "Integrate",
              "verifier": "Verify", "reviewer": "Review"}
    types = {"implementer": "execution-implementer", "test-designer": "execution-test-designer",
             "integrator": "execution-implementer", "verifier": "execution-verifier",
             "reviewer": "execution-reviewer"}
    schemas = {"implementer": "result-implementer", "test-designer": "result-test-designer",
               "integrator": "merge-result", "verifier": "result-verifier", "reviewer": "result-reviewer"}
    for role in chain:
        if role in types:
            agents[role] = {"agentType": types[role], "model": "opus", "effort": "high", "isolation": None,
                            "label": f"{tid} {role}", "phase": phases[role], "schema": schemas[role]}
    item = {"task": tid, "lane": lane, "attempt": attempt, "rerun": 0, "kind": kind, "chain": list(chain),
            "brief_path": f"C:/repo/.execution/briefs/{tid}.a{attempt}.md", "inbox": "C:/repo/.execution/local/inbox/W01",
            "results": {}, "agents": agents, "deps_in_wave": list(deps), "priority_rank": rank, "critical": False,
            "resources": list(resources), "from_status": "ready"}
    if fix_attempts:
        item["fix_attempts"] = list(fix_attempts)
    return item


def harness_manifest(tasks: list[dict], *, writers: int = 3, verifiers: int = 2, browser: int = 1,
                     integrators: int = 1, pre_t0: bool = False, skip: Sequence[str] = ()) -> dict:
    man = {"schema": "execution.wave-manifest/1", "wave": "W01", "executor": "A", "plan_version": 1,
           "plan_sha256": "d" * 64, "created_utc": S.FIXED_NOW, "launching_utc": S.FIXED_NOW,
           "script_path": "C:/repo/.execution/waves/W01.js", "script_sha256": "0" * 64,
           "workflow_name": "execution-wave-w01", "args": {"now_utc": S.FIXED_NOW, "skip": list(skip)},
           "limits": {"writers": writers, "verifiers": verifiers, "integrators": integrators,
                      "browser_slots": browser, "concurrency_env": 8},
           "lanes": [], "tasks": tasks, "fragments": [], "launch": None, "status": "launching"}
    if pre_t0:
        man["pre_t0"] = True
    return man


def harness_extra(*, fe: dict | None = None, fix: dict | None = None, in_wave_fix: bool = True) -> dict:
    return {"schemas": wavejs.result_schemas(), "runner": {"agentType": "execution-implementer", "model": "sonnet",
                                                             "effort": "low"},
            "fe": fe or {}, "in_wave_fix": in_wave_fix, "fix": fix or {}}


def fake_fragment(name: str) -> wavejs.Fragment:
    path = B05_FIXTURES / "fragments" / wavejs.FRAGMENT_FILES[name]
    return wavejs.load_fragment_full(name, path)


def render_script(man: dict, *, extra: dict | None = None, fragments: Sequence[wavejs.Fragment] = ()) -> str:
    ids = [t["task"] for t in man["tasks"]]
    return wavejs.render(man, list(fragments), extra=extra or harness_extra(),
                         description=f"Wave W01 of test: {len(ids)} tasks ({' '.join(ids[:12])})")


def run_harness(script: str, scenario: Mapping[str, Any], tmp: Path) -> dict:
    """Run the harness on `script`; returns its JSON (returned, error, calls, logs, peaks, intervals)."""
    tmp.mkdir(parents=True, exist_ok=True)
    sp = S.write_text(tmp / "script.js", script)
    sc = S.write_text(tmp / "scenario.json", json.dumps(scenario))
    proc = subprocess.run([NODE or "node", str(HARNESS), str(sp), str(sc)], capture_output=True, timeout=60)
    out = proc.stdout.decode("utf-8")
    if not out.strip():
        raise AssertionError(f"harness printed nothing: {proc.stderr.decode('utf-8', 'replace')}")
    doc = json.loads(out.strip().splitlines()[-1])
    doc["exit_code"] = proc.returncode
    return doc


def calls_of(doc: dict, label_prefix: str) -> list[dict]:
    return [c for c in doc["calls"] if c["label"].startswith(label_prefix)]


def overlap(a: Sequence[int], b: Sequence[int]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def deep(obj: Any) -> Any:
    return copy.deepcopy(obj)
