"""Helpers of lane B08's tests (hooks, install, governor, init, sync, heartbeat, launcher).

Not a test module. `HookRepo` is a temp repository with a minimal valid `.execution/` (B01's `state_dir`) whose
marker binds `sess-orch-1`; `run` executes a hook exactly as the settings command does (`bash py.sh <script>`)
with `<REPO>` / `<SKILL>` placeholders of the payload fixtures replaced, and returns the decoded result.
`fake_integrity` stands in for lane B06's `execlib.integrity` (not integrated) in the sync tests.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import types
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import _support as S
from execlib import jsonio, paths


@dataclass
class HookRun:
    code: int
    stdout: bytes
    stderr: bytes
    ms: float

    @property
    def obj(self) -> dict | None:
        text = self.stdout.decode("ascii").strip()
        if not text:
            return None
        lines = [ln for ln in text.split("\n") if ln.strip()]
        assert len(lines) == 1, f"more than one stdout line: {text!r}"
        return json.loads(lines[0])

    @property
    def context(self) -> str | None:
        obj = self.obj
        return None if obj is None else obj["hookSpecificOutput"].get("additionalContext")

    @property
    def deny_reason(self) -> str | None:
        obj = self.obj
        if obj is None:
            return None
        out = obj["hookSpecificOutput"]
        return out.get("permissionDecisionReason") if out.get("permissionDecision") == "deny" else None


def fill(doc: Any, repo: Path) -> Any:
    """Replace <REPO> and <SKILL> placeholders in a payload."""
    if isinstance(doc, str):
        return doc.replace("<REPO>", paths.posix(repo)).replace("<SKILL>", paths.posix(S.SKILL_DIR))
    if isinstance(doc, list):
        return [fill(x, repo) for x in doc]
    if isinstance(doc, dict):
        return {k: fill(v, repo) for k, v in doc.items()}
    return doc


class HookRepo:
    """A TempRepo with `.execution/` written by `_support.state_dir`."""

    def __init__(self, *, run_state: str = "RUNNING", session_id: str | None = S.SESSION_ID,
                 plan: dict | None = None) -> None:
        self.tmp = S.TempRepo()
        self.path = self.tmp.path
        self.layout = S.state_dir(self.path, run_state=run_state, session_id=session_id, plan=plan)
        self.env = S.env_isolated()

    def cleanup(self) -> None:
        self.tmp.cleanup()

    # documents
    def local_state(self) -> dict:
        return jsonio.read_json(self.layout.local_state)

    def set_local(self, **fields: Any) -> dict:
        doc = self.local_state()
        doc.update(fields)
        jsonio.write_json_atomic(self.layout.local_state, doc)
        return doc

    def marker(self) -> dict:
        return jsonio.read_json(self.layout.active)

    def set_marker(self, **fields: Any) -> dict:
        doc = self.marker()
        doc.update(fields)
        jsonio.write_json_atomic(self.layout.active, doc)
        return doc

    def hooks_state(self) -> dict | None:
        return jsonio.read_json(self.layout.hooks_state) if self.layout.hooks_state.exists() else None

    def set_hooks_state(self, **fields: Any) -> None:
        base = {"schema": "execution.hooks-state/1", "consecutive_continuations": 0, "last_continuation_utc": None,
                "last_digest_sha256": None, "stuck": None, "last_stop_utc": None}
        base.update(fields)
        jsonio.write_json_atomic(self.layout.hooks_state, base)

    def write_schedule(self, ready: list[str]) -> None:
        jsonio.write_json_atomic(self.layout.schedule_cache,
                                 {"ready": [{"task": t, "rank": i + 1} for i, t in enumerate(ready)]})

    def events(self) -> list[dict]:
        d = self.layout.hook_events_dir
        if not d.exists():
            return []
        files = sorted(d.glob("*.json"), key=lambda p: (p.stat().st_mtime_ns, p.name))
        return [json.loads(p.read_text(encoding="utf-8")) for p in files]

    def clear_events(self) -> None:
        d = self.layout.hook_events_dir
        if d.exists():
            for p in d.glob("*.json"):
                p.unlink()

    def event_types(self) -> list[str]:
        return [e["type"] for e in self.events()]

    def snapshot(self) -> dict[str, bytes]:
        """Bytes of every file under .execution/local (for 'nothing written' assertions)."""
        out: dict[str, bytes] = {}
        for p in sorted(self.layout.local.rglob("*")):
            if p.is_file():
                out[p.relative_to(self.layout.local).as_posix()] = p.read_bytes()
        return out

    # running
    def run(self, script: str, payload: dict, *, env: dict | None = None, cwd: Path | None = None,
            args: list[str] | None = None) -> HookRun:
        doc = fill(payload, self.path)
        name = script if not args else script + " " + " ".join(args)
        if args:
            code, out, err, ms = run_hook_args(script, args, doc, env or self.env, cwd or self.path)
        else:
            code, out, err, ms = S.run_hook(script, doc, env or self.env, cwd or self.path)
        assert code == 0, f"{name} exited {code}: {err.decode('utf-8', 'replace')}"
        return HookRun(code, out, err, ms)


def run_hook_args(script: str, args: list[str], payload_doc: dict, env: dict, cwd: Path
                  ) -> tuple[int, bytes, bytes, float]:
    """S.run_hook with extra arguments after the script name (the agent-definition layer's `--as`)."""
    import subprocess
    import time

    from execlib import procutil
    bash = procutil.git_bash()
    assert bash is not None, "Git Bash is needed"
    launcher = (S.SCRIPTS_DIR / "hooks" / "py.sh").as_posix()
    data = json.dumps(payload_doc, ensure_ascii=False).encode("utf-8")
    start = time.perf_counter()
    proc = subprocess.run([bash, launcher, script, *args], input=data, capture_output=True, env=env,
                          cwd=str(cwd), timeout=60)
    return proc.returncode, proc.stdout, proc.stderr, (time.perf_counter() - start) * 1000.0


def git_bash_available() -> bool:
    from execlib import procutil
    return procutil.git_bash() is not None


EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")


def skill_copy_with_last_effort(dest: Path) -> Path:
    """A copy of the hooks' part of the skill (scripts/hooks, execlib's __init__ and hookcore, assets/schemas) whose
    local-state schema lists `hooks_state.last_effort`, the property lane B01 is asked to add (contract revision 4,
    Q-B08-18). Hooks run from it exactly as from the skill: hookcore reads the schema next to itself."""
    src = S.SKILL_DIR
    shutil.copytree(src / "scripts" / "hooks", dest / "scripts" / "hooks",
                    ignore=shutil.ignore_patterns("__pycache__"))
    (dest / "scripts" / "execlib").mkdir(parents=True)
    for name in ("__init__.py", "hookcore.py"):
        shutil.copyfile(src / "scripts" / "execlib" / name, dest / "scripts" / "execlib" / name)
    shutil.copytree(src / "assets" / "schemas", dest / "assets" / "schemas")
    path = dest / "assets" / "schemas" / "local-state.schema.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["$defs"]["hooks_state"]["properties"]["last_effort"] = {"enum": list(EFFORT_LEVELS)}
    S.write_text(path, json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    return dest


def run_hook_from(skill_root: Path, repo: HookRepo, script: str, payload: dict) -> HookRun:
    """HookRepo.run, with the launcher of another skill tree (`bash <skill_root>/scripts/hooks/py.sh <script>`)."""
    import subprocess
    import time

    from execlib import procutil
    bash = procutil.git_bash()
    assert bash is not None, "Git Bash is needed"
    data = json.dumps(fill(payload, repo.path), ensure_ascii=False).encode("utf-8")
    start = time.perf_counter()
    proc = subprocess.run([bash, (skill_root / "scripts" / "hooks" / "py.sh").as_posix(), script], input=data,
                          capture_output=True, env=repo.env, cwd=str(repo.path), timeout=60)
    ms = (time.perf_counter() - start) * 1000.0
    assert proc.returncode == 0, f"{script} exited {proc.returncode}: {proc.stderr.decode('utf-8', 'replace')}"
    return HookRun(proc.returncode, proc.stdout, proc.stderr, ms)


def env_with(**over: Any) -> dict[str, str]:
    return S.env_isolated(**over)


def utc_minus(minutes: float = 0, days: float = 0) -> str:
    from datetime import timedelta
    return (S.fixed_now() - timedelta(minutes=minutes, days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


def set_mtime_minutes_before_now(path: Path, minutes: float) -> None:
    ts = S.fixed_now().timestamp() - minutes * 60
    os.utime(path, (ts, ts))


# --- a stand-in for lane B06's integrity module (MODULES.md 4, contract revision 3) ---------------------------------

PUBLIC_VALUES_FILE = "public-values.jsonl"
_PUBLIC_MASK = "<public-value>"
_HEX_VALUE_RE = re.compile(r"(?<![0-9A-Za-z])0x[0-9a-fA-F]{64}(?![0-9A-Za-z])")
_EXPLORER_VALUE_RE = re.compile(r"(https?://[^\s\"'<>]*?/(?:tx|txs|transaction)/)(0x[0-9a-fA-F]{64})(?![0-9A-Za-z])")


def fake_integrity() -> types.ModuleType:
    """`execlib.integrity` with the MODULES.md 4 signatures that `sync` uses (contract revision 3), for lane B08's
    tests while lane B06 is not integrated.

    `scan_secrets(added, *, public)` reports log.redact's shapes (the family the real scan reuses) after masking the
    proven-public values of README.md 8: a value listed in `public` (compared lower-cased) and a value right after
    `/tx/`, `/txs/` or `/transaction/` in an http(s) URL. `load_public_values` and `register_public_value` read and
    append `public-values.jsonl` (SCHEMAS.md 1.1); like B06's, the registration expects its caller to hold the state
    lock. `with_positive_control` runs the scanner on its plant first."""
    from execlib import errors
    from execlib.log import redaction_ids

    mod = types.ModuleType("execlib.integrity")

    @dataclass(frozen=True)
    class Scan:
        id: str
        state: str
        detail: str
        positive_control: dict | None

    def masked(text: str, public: frozenset[str]) -> str:
        text = _EXPLORER_VALUE_RE.sub(lambda m: m.group(1) + _PUBLIC_MASK, text)
        return _HEX_VALUE_RE.sub(lambda m: _PUBLIC_MASK if m.group(0).lower() in public else m.group(0), text)

    def scan_secrets(added: Any, *, public: frozenset[str] = frozenset()) -> Scan:
        hits = [f"{pid} at {f}:{n}" for f, n, text in added for pid in redaction_ids(masked(text, public))]
        return Scan("secrets", "fail" if hits else "ok", "; ".join(hits) or "clean", None)

    def load_public_values(layout: Any) -> frozenset[str]:
        path = layout.state / PUBLIC_VALUES_FILE
        if not path.exists():
            return frozenset()
        docs = [json.loads(ln) for ln in path.read_text(encoding="utf-8").split("\n") if ln.strip()]
        return frozenset(d["value"].lower() for d in docs if isinstance(d.get("value"), str))

    def register_public_value(layout: Any, *, value: str, kind: str, chain: str, network: str, proven: str,
                              source: str) -> bool:
        if proven not in ("chain-reread", "tx-proof"):
            raise errors.PolicyRefused("a value is registered only after a chain proof", code="E_POLICY")
        if value.lower() in load_public_values(layout):
            return False
        executor = jsonio.read_json(layout.local_state).get("executor")
        jsonio.append_jsonl(layout.state / PUBLIC_VALUES_FILE,
                            {"value": value, "kind": kind, "chain": chain, "network": network, "proven": proven,
                             "source": source, "at_utc": S.FIXED_NOW, "executor": executor})
        return True

    def with_positive_control(scanner: Any, planted: Any, *args: Any) -> Scan:
        control = scanner(*planted) if isinstance(planted, tuple) else scanner(planted)
        if control.state != "fail":
            return Scan(control.id, "fail", "blind scan", {"ran": True, "caught": False})
        return replace(scanner(*args), positive_control={"ran": True, "caught": True})

    for name, obj in (("Scan", Scan), ("scan_secrets", scan_secrets), ("load_public_values", load_public_values),
                      ("register_public_value", register_public_value),
                      ("with_positive_control", with_positive_control)):
        setattr(mod, name, obj)
    return mod
