"""Shared test helpers of /execution (contract/TESTS.md 1-2, LANES.md B01).

Temp git repositories with a local bare origin, the fixed clock, the isolated environment (never the real
~/.claude/), planted literals built at runtime (never typed in a source file), positive-control assertions, the
CLI runner with the envelope assertions of TESTS.md 1.7, fake tools on a temp PATH, a loopback HTTP fixture, and
builders for minimal valid documents (plan, draft, profile, policy, status, receipts, local state, marker).

Not a test module (no test_ prefix); every lane imports it: `from _support import ...` (scripts/tests is on
sys.path when unittest discovers from there).
"""
from __future__ import annotations

import atexit
import copy
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Mapping

TESTS_DIR = Path(__file__).resolve().parent
SCRIPTS_DIR = TESTS_DIR.parent
SKILL_DIR = SCRIPTS_DIR.parent
EXEC_PY = SCRIPTS_DIR / "exec.py"
FIXTURES = TESTS_DIR / "fixtures"
B01_FIXTURES = FIXTURES / "B01"
RENDERED = B01_FIXTURES / "fixture-rendered"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from execlib import jsonio, log, paths, schema  # noqa: E402
from execlib import state as state_mod  # noqa: E402
from execlib.plan import plan_digest  # noqa: E402

log.configure(os.environ.get("EXEC_TEST_LOG_LEVEL") or "error")  # in-process noise off; the CLI logs at debug

FIXED_NOW = "2026-10-03T07:12:00Z"
FIXED_T0 = "2026-10-03T07:45:00Z"
FIXED_END = "2026-10-03T13:45:00Z"
SESSION_ID = "sess-orch-1"
TEST_NAME = "Exec Test"
TEST_EMAIL = "exec-test@example.invalid"
ABSENT = object()
TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def fixed_now() -> datetime:
    """The suite's fixed instant (2026-10-03T07:12:00Z), aware UTC."""
    return datetime(2026, 10, 3, 7, 12, 0, tzinfo=timezone.utc)


# --- temp directories and isolation -------------------------------------------------------------------------------

_PROCESS_TMP: dict[str, Path] = {}


def mkdtemp() -> Path:
    """A fresh temp directory, resolved (the Windows temp path holds a short name that must never leak)."""
    return Path(tempfile.mkdtemp(prefix="exec-test-")).resolve()


def rmtree(path: Path | str) -> None:
    """Link-safe removal (junctions and symlinks unlinked first)."""
    paths.rmtree_link_safe(Path(path))


def _process_dir(name: str) -> Path:
    if name not in _PROCESS_TMP:
        d = mkdtemp()
        _PROCESS_TMP[name] = d
    return _PROCESS_TMP[name]


@atexit.register
def _cleanup_process_dirs() -> None:
    for d in _PROCESS_TMP.values():
        try:
            rmtree(d)
        except OSError:
            pass


def claude_config_dir() -> Path:
    """The per-process temp CLAUDE_CONFIG_DIR (never the real ~/.claude/)."""
    return _process_dir("claude-config")


def git_config_global() -> Path:
    path = _process_dir("gitcfg") / "gitconfig"
    if not path.exists():
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(f"[user]\n\tname = {TEST_NAME}\n\temail = {TEST_EMAIL}\n[init]\n\tdefaultBranch = main\n"
                     "[core]\n\tautocrlf = false\n\tlongpaths = true\n[commit]\n\tgpgsign = false\n")
    return path


def env_isolated(**overrides: Any) -> dict[str, str]:
    """TESTS.md 1.3: EXEC_TEST=1 with EXEC_NOW fixed, a temp CLAUDE_CONFIG_DIR and git identity, no
    PYTHONIOENCODING / PYTHONUTF8. An override set to None (or ABSENT) removes the variable."""
    env = {k: v for k, v in os.environ.items()
           if k not in ("PYTHONIOENCODING", "PYTHONUTF8") and not k.startswith("EXEC_")
           and not k.startswith("GIT_")}
    env.update({
        "EXEC_TEST": "1",
        "EXEC_NOW": FIXED_NOW,
        "CLAUDE_CONFIG_DIR": str(claude_config_dir()),
        "GIT_CONFIG_GLOBAL": str(git_config_global()),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "EXEC_LOG_LEVEL": "debug",
        "CLAUDE_CODE_SESSION_ID": SESSION_ID,
    })
    for key, value in overrides.items():
        if value is None or value is ABSENT:
            env.pop(key, None)
        else:
            env[key] = str(value)
    return env


class patched_env:
    """Context manager: apply env_isolated()-style changes to os.environ in-process, restore afterwards."""

    def __init__(self, **changes: Any) -> None:
        self.changes = changes
        self.saved: dict[str, str | None] = {}

    def __enter__(self) -> patched_env:
        for key, value in self.changes.items():
            self.saved[key] = os.environ.get(key)
            if value is None or value is ABSENT:
                os.environ.pop(key, None)
            else:
                os.environ[key] = str(value)
        return self

    def __exit__(self, *exc: Any) -> None:
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


# --- planted literals (TESTS.md 1.4) ------------------------------------------------------------------------------

def planted(name: str) -> str:
    """Assemble a literal that must never appear in a source or fixture file."""
    if name == "trailer.coauthor":
        return "Co-" + "Authored-By: X <x@example.invalid>"
    if name == "trailer.signoff":
        return "Signed-" + "off-by: X <x@example.invalid>"
    if name == "trailer.generated":
        return "Generated " + "with [Claude Code](https://example.invalid)"
    if name == "env.local":
        return "." + "env" + ".local"
    if name == "env.plain":
        return "." + "env"
    if name == "env.example":
        return "." + "env" + ".example"
    if name == "key.private":
        rng = random.Random(1729)
        return "0x" + "".join(rng.choice("0123456789abcdef") for _ in range(64))
    if name == "key.pem":
        rng = random.Random(4242)
        body = "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/") for _ in range(64))
        kind = "PRI" + "VATE KEY"
        return f"-----BEGIN {kind}-----\n{body}\n-----END {kind}-----"
    if name == "nevershow.live":
        doc = json.loads((RENDERED / "never-show.json").read_text(encoding="utf-8"))
        for entry in doc["entries"]:
            if entry["id"] == "ns-embargo-live":
                return str(entry["pattern"])
        raise KeyError("ns-embargo-live missing from the rendered never-show file")
    raise KeyError(f"unknown planted literal {name!r}")


def assert_controlled(test: Any, negative: Callable[[], Any], positive: Callable[[], Any]) -> None:
    """TESTS.md 1.5: run the positive control (the mechanism can fire), then the negative assertion. A positive
    control that fails is itself a test failure."""
    try:
        positive()
    except AssertionError as err:
        test.fail(f"positive control failed (the negative assertion would prove nothing): {err}")
    negative()


# --- canonical JSON -----------------------------------------------------------------------------------------------

def canonical(obj: Any) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def write_text(path: Path, text: str) -> Path:
    """UTF-8, LF, as the skill writes files."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    return path


def write_json(path: Path, obj: Any) -> Path:
    return write_text(path, json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


# --- git ----------------------------------------------------------------------------------------------------------

def git(cwd: Path, *args: str, env: Mapping[str, str] | None = None, check: bool = True,
        input_text: str | None = None) -> subprocess.CompletedProcess:
    proc = subprocess.run(["git", *args], cwd=str(cwd), env=dict(env or env_isolated()), capture_output=True,
                          input=input_text.encode("utf-8") if input_text is not None else None)
    if check and proc.returncode != 0:
        raise AssertionError(f"git {' '.join(args)} failed ({proc.returncode}): "
                             f"{proc.stderr.decode('utf-8', 'replace')}")
    return proc


class TempRepo:
    """A work tree `repo` plus a local bare `origin.git` (main branch, autocrlf false, longpaths true) and an initial
    commit with a fixed author date, pushed. Use as a context manager or call cleanup()."""

    def __init__(self, *, files: Mapping[str, str] | None = None, env: Mapping[str, str] | None = None) -> None:
        self.root = mkdtemp()
        self.env = dict(env or env_isolated())
        self.path = self.root / "repo"
        self.origin = self.root / "origin.git"
        git(self.root, "init", "--quiet", "--bare", "-b", "main", str(self.origin), env=self.env)
        git(self.root, "init", "--quiet", "-b", "main", str(self.path), env=self.env)
        for key, value in (("core.autocrlf", "false"), ("core.longpaths", "true")):
            self.git("config", key, value)
        for rel, text in (files or {"README.md": "# temp repo\n"}).items():
            self.write(rel, text)
        self.git("add", "--all")
        self.commit_all("chore: initial commit")
        self.git("remote", "add", "origin", self.origin.as_posix())
        self.git("push", "--quiet", "-u", "origin", "main")

    def date_env(self) -> dict[str, str]:
        env = dict(self.env)
        env["GIT_AUTHOR_DATE"] = FIXED_NOW
        env["GIT_COMMITTER_DATE"] = FIXED_NOW
        return env

    def git(self, *args: str, check: bool = True, cwd: Path | None = None) -> str:
        proc = git(cwd or self.path, *args, env=self.date_env(), check=check)
        return proc.stdout.decode("utf-8", "replace").strip()

    def write(self, rel: str, text: str) -> Path:
        return write_text(self.path / rel, text)

    def commit_all(self, message: str) -> str:
        self.git("add", "--all")
        msg = self.root / "commit-msg.txt"
        write_text(msg, message + "\n")
        self.git("commit", "--quiet", "-F", str(msg))
        return self.git("rev-parse", "HEAD")

    def head(self) -> str:
        return self.git("rev-parse", "HEAD")

    def clone(self, name: str) -> Path:
        dest = self.root / name
        git(self.root, "clone", "--quiet", self.origin.as_posix(), str(dest), env=self.env)
        git(dest, "config", "core.autocrlf", "false", env=self.env)
        return dest

    def cleanup(self) -> None:
        rmtree(self.root)

    def __enter__(self) -> TempRepo:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.cleanup()


# --- the CLI ------------------------------------------------------------------------------------------------------

def run_exec(args: list[str], cwd: Path | str, env: Mapping[str, str] | None = None, *, timeout: float = 120
             ) -> tuple[int, dict, list[dict]]:
    """Run exec.py and assert TESTS.md 1.7 on every call: one stdout line, a valid envelope, ok == (exit == 0),
    the envelope's exit_code equals the process's, every stderr line a JSON log object, no planted secret in stderr.
    Returns (exit code, envelope, stderr lines)."""
    proc = subprocess.run([sys.executable, str(EXEC_PY), *args], cwd=str(cwd), env=dict(env or env_isolated()),
                          capture_output=True, timeout=timeout)
    out = proc.stdout.decode("utf-8")
    err = proc.stderr.decode("utf-8")
    lines = [ln for ln in out.split("\n") if ln.strip()]
    if len(lines) != 1:
        raise AssertionError(f"exec.py {' '.join(args)}: expected one stdout line, got {len(lines)}:\n{out}\n{err}")
    envelope = json.loads(lines[0])
    report = schema.validate(envelope, "envelope")
    if not report.ok:
        raise AssertionError(f"invalid envelope: {[i.message for i in report.issues]}")
    if envelope["ok"] != (proc.returncode == 0):
        raise AssertionError(f"ok={envelope['ok']} with exit {proc.returncode}")
    if envelope.get("exit_code") != proc.returncode:
        raise AssertionError(f"envelope exit_code {envelope.get('exit_code')} != process {proc.returncode}")
    logs: list[dict] = []
    secrets = [planted("key.private"), planted("key.pem").split("\n")[1]]
    for line in err.split("\n"):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            raise AssertionError(f"stderr line is not JSON: {line!r}") from exc
        if not isinstance(obj, dict) or not {"ts", "level", "module", "msg"} <= obj.keys():
            raise AssertionError(f"stderr line lacks ts/level/module/msg: {line!r}")
        if not TS_RE.match(obj["ts"]) or obj["level"] not in ("error", "warning", "info", "debug"):
            raise AssertionError(f"stderr line has a bad ts or level: {line!r}")
        for secret in secrets:
            if secret in line:
                raise AssertionError("a planted secret reached stderr")
        logs.append(obj)
    return proc.returncode, envelope, logs


# --- fake tools and HTTP ------------------------------------------------------------------------------------------

def fake_tool(directory: Path, name: str, script: str) -> Path:
    """A fake executable `name` on a temp PATH directory, implemented by the Python source `script`.

    Windows: `<name>.cmd` shim (PATHEXT) plus an extension-less sh shim for Git Bash; POSIX: an executable shim."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    impl = write_text(directory / f"{name}_impl.py", script if script.endswith("\n") else script + "\n")
    py = sys.executable
    sh = write_text(directory / name, f'#!/bin/sh\nexec "{Path(py).as_posix()}" "{impl.as_posix()}" "$@"\n')
    os.chmod(sh, 0o755)
    if os.name == "nt":
        return write_text(directory / f"{name}.cmd", f'@"{py}" "{impl}" %*\r\n'.replace("\r\n", "\n"))
    return sh


def path_with(directory: Path, env: Mapping[str, str] | None = None) -> dict[str, str]:
    """env with `directory` first on PATH."""
    out = dict(env or env_isolated())
    out["PATH"] = str(directory) + os.pathsep + out.get("PATH", "")
    return out


def http_fixture(routes: Mapping[str, tuple[int, str] | tuple[int, str, Mapping[str, str]]]
                 ) -> tuple[str, Callable[[], None]]:
    """A loopback HTTP server answering canned (status, body[, headers]) per path; returns (base url, close)."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            spec = routes.get(self.path.split("?")[0])
            if spec is None:
                status, body, headers = 404, "not found", {}
            else:
                status, body = spec[0], spec[1]
                headers = spec[2] if len(spec) > 2 else {}  # type: ignore[misc]
            data = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Length", str(len(data)))
            for k, v in dict(headers).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_a: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def close() -> None:
        server.shutdown()
        server.server_close()

    return f"http://127.0.0.1:{server.server_address[1]}", close


# --- hook helpers (used by B08's tests) ---------------------------------------------------------------------------

def payload(name: str, **overrides: Any) -> dict:
    """fixtures/B08/payloads/<name>.json with overrides applied; keys set to ABSENT are deleted."""
    doc = json.loads((FIXTURES / "B08" / "payloads" / f"{name}.json").read_text(encoding="utf-8"))
    for key, value in overrides.items():
        if value is ABSENT:
            doc.pop(key, None)
        else:
            doc[key] = value
    return doc


def run_hook(script: str, payload_doc: Mapping[str, Any], env: Mapping[str, str] | None = None,
             cwd: Path | str | None = None) -> tuple[int, bytes, bytes, float]:
    """Run `bash scripts/hooks/py.sh <script>` as the settings command does; returns (exit, stdout, stderr, ms)."""
    from execlib import procutil

    bash = procutil.git_bash()
    if bash is None:
        raise AssertionError("Git Bash is needed to run a hook")
    launcher = (SCRIPTS_DIR / "hooks" / "py.sh").as_posix()
    data = json.dumps(payload_doc, ensure_ascii=False).encode("utf-8")
    start = time.perf_counter()
    proc = subprocess.run([bash, launcher, script], input=data, capture_output=True, env=dict(env or env_isolated()),
                          cwd=str(cwd) if cwd else None, timeout=60)
    ms = (time.perf_counter() - start) * 1000.0
    return proc.returncode, proc.stdout, proc.stderr, ms


# --- document builders --------------------------------------------------------------------------------------------

SPEC_PATH = "C:/x/qc/private/SPEC.md"


def build_task(tid: str = "T001", *, kind: str = "code", deps: tuple[str, ...] = (), **over: Any) -> dict:
    """A schema-valid plan task. kind code/test/infra get lane L1 and writes; manual/decision get a dev owner."""
    num = int(tid[1:])
    task: dict[str, Any] = {
        "id": tid, "key": f"task-{num}", "title": f"Task {tid}", "description": f"Deliverable of {tid}.",
        "template": None, "params": {}, "feature_group": None, "covers": ["FR-001"], "story": None,
        "priority": "P1", "required": True, "phase": "build", "kind": kind, "owner": "agent", "executor": "A",
        "depends_on": list(deps), "release_utc": None, "deadline_utc": None, "anchor": None,
        "writes": [f"src/t{num}/**"], "resources": [],
        "estimate": {"p10_min": 10, "p50_min": 20, "p90_min": 40, "source": "reference-class:build"},
        "tokens_est": {"usd_list": 1.5, "basis": "reference class"}, "model": "sonnet", "effort": "medium",
        "proof": {
            "type": "command",
            "spec": {"cmd": "node --test", "shell": "bash", "cwd": ".", "install": False},
            "expect": {"summary": "the task's tests pass", "exit_code": 0},
            "max_runtime_min": 2,
            "negative_control": {"kind": "pre-implementation", "description": "fails on the parent commit",
                                 "expect_nonzero": True},
        },
        "proof_author": "template", "brief_refs": [], "manual": None, "max_attempts": 2,
    }
    if kind in ("code", "test", "infra"):
        task["lane"] = "L1"
    if kind in ("manual", "decision"):
        task.update({
            "phase": "manual" if kind == "manual" else "decision", "owner": "devA", "model": None, "effort": None,
            "writes": [], "proof_author": "owner",
            "estimate": {"p10_min": 5, "p50_min": 10, "p90_min": 30, "source": "reference-class:manual"},
            "proof": {"type": "human-attest", "spec": {"answer_key": f"{tid}-done", "attest": "the owner did it"},
                      "expect": {"summary": "the owner confirms"}, "max_runtime_min": 1,
                      "negative_control": {"kind": "not-applicable", "description": "a human step",
                                           "expect_nonzero": True, "waived_reason": "nothing to falsify by script"}},
            "manual": {"steps": ["Do the step."],
                       "bring_back": [{"key": f"{tid}-done", "kind": "text", "verify": {"method": "owner-attest"}}],
                       "where": "laptop", "latest_start_utc": FIXED_END, "options_source": None,
                       "options": ([{"id": "yes", "label": "Yes", "consequence": "go"},
                                    {"id": "no", "label": "No", "consequence": "stop"}] if kind == "decision" else []),
                       "decision_deadline_utc": None},
        })
    if kind == "gate":
        task.update({"phase": "verify"})
    task.update(over)
    return task


def build_plan(tasks: list[dict] | None = None, **over: Any) -> dict:
    """A minimal schema-valid plan (not approved): one requirement, a contract lane L0 and lane L1."""
    plan: dict[str, Any] = {
        "schema": "execution.plan/1", "project": "queue-clock", "plan_version": 1,
        "created_utc": FIXED_NOW, "updated_utc": FIXED_NOW, "approved": None,
        "spec": {"path": SPEC_PATH, "sha256": "a" * 64, "validated_decision": "D-001"},
        "deadlines": [{"id": "DL-submission", "title": "Submission", "at_utc": FIXED_END, "kind": "submission",
                       "irrecoverable": True, "gate_phase": "deliverable", "source": "event-brief.md:12"}],
        "requirements": [{"id": "FR-001", "title": "Queue position", "text": "Show the queue position.",
                          "priority": "P1", "required": True, "feature_group": None, "surface": "api",
                          "status_expected": None, "story": None, "source": f"spec:{SPEC_PATH}#L10"}],
        "feature_groups": [],
        "lanes": [{"id": "L0", "executor": "A", "title": "Contract", "globs": ["package.json"], "contract": True},
                  {"id": "L1", "executor": "A", "title": "Engine", "globs": ["src/**"], "contract": False}],
        "protected": [".github/workflows/**"],
        "tasks": tasks if tasks is not None else [build_task("T001")],
        "amendments": [],
    }
    plan.update(over)
    return plan


def approve(plan: dict, *, decision: str = "D-002", by: str = "devA") -> dict:
    """The plan with its `approved` block set to the current digest."""
    out = copy.deepcopy(plan)
    out["approved"] = {"at_utc": FIXED_NOW, "by": by, "decision": decision, "plan_sha256": plan_digest(out)}
    return out


def build_draft(**over: Any) -> dict:
    """A minimal schema-valid planner draft."""
    task = build_task("T001")
    draft_task = {k: v for k, v in task.items() if k not in ("id", "template", "params", "anchor", "lane")}
    draft_task["key"] = "engine-core"
    draft: dict[str, Any] = {
        "schema": "execution.plan-draft/1", "project": "queue-clock",
        "spec": {"path": SPEC_PATH, "sha256": "a" * 64},
        "deadlines": build_plan()["deadlines"], "requirements": build_plan()["requirements"],
        "feature_groups": [], "lanes": build_plan()["lanes"], "protected": [".github/workflows/**"],
        "tasks": [draft_task], "instances": [], "libraries": [],
    }
    draft.update(over)
    return draft


def build_profile(*, frontend: bool = False, **over: Any) -> dict:
    """A minimal schema-valid profile (paths under C:/x/qc)."""
    prof: dict[str, Any] = {
        "schema": "execution.profile/1",
        "project": {"name": "Queue Clock", "slug": "queue-clock", "name_owner_confirmed": False,
                    "product_repo": {"path": "C:/x/qc/repo", "remote_url": None, "default_branch": "main"},
                    "state_repo": {"remote_url": None, "private": True}},
        "event": {"kind": "hackathon", "presence": "in-person", "start_utc": FIXED_T0, "deadline_utc": FIXED_END,
                  "display_zones": [{"label": "SGT", "iana": "Asia/Singapore", "fallback_utc_offset_min": 480},
                                    {"label": "Paris", "iana": "Europe/Paris", "fallback_utc_offset_min": 120}],
                  "judging": {"mode": "stage", "readme_is_pitch": False, "surfaces": ["repo"]},
                  "demo": {"format": "recording", "live_allowed": False, "video": {"max_s": 180, "embed": "mp4"}},
                  "deliverables": [], "rubric": {"tracks": []}, "tracks": [], "source": "event-brief.md"},
        "team": {"devs": [{"id": "devA", "name": "Dev A", "executor": "A", "setup": "full", "notion_member": True,
                           "availability": []}]},
        "channels": [],
        "prework": {"code": True, "designs": False, "until_utc": FIXED_T0},
        "freezes": [],
        "workspace": {"private_dir": "C:/x/qc/private"},
        "paths": {"never_show": "C:/x/qc/private/never-show.json",
                  "feature_catalogue": "C:/x/qc/repo/.execution/feature-catalogue.json", "spec": SPEC_PATH,
                  "research": None, "judge_facing": ["README.md", "docs/**/*.md"]},
        "phase_b": {"claims_ledger": None, "dx_journal": None, "run_sheet": None, "private": True},
        "machine": {"max_lanes": 3, "max_verifiers": 2, "disk_floor_gb": 2.0, "ram_floor_gb": 1.5,
                    "workspace_mode": "auto", "lane_footprint_gb": 0.3, "workflow_concurrency": 6,
                    "browser_slots": 1, "scratch_root": "C:/x/qc/scratch"},
        "notion": {"enabled": False, "hub_page_id": None, "databases": {"tasks": None, "waves": None},
                   "views": {"board": None, "needs_dev_a": None, "needs_dev_b": None, "to_ingest": None,
                             "waves": None}, "language": "fr"},
        "harden": {"budget_min_p80": None, "scope_paths": [], "exclude_globs": [], "profile_draft_path": None},
        "quota": {"snapshot_path": "C:/x/qc/claude-config/usage-snapshot.json", "max_age_s": 900,
                  "five_hour_critical_only_pct": 85, "weekly_reserve_pct": 10},
        "heartbeat": {"every_min": 20, "minute_offset": 7},
        "event_tools": [],
    }
    if frontend:
        prof["frontend"] = {"mode": "small", "run_mode": "A"}
    prof.update(over)
    return prof


def build_policy(**over: Any) -> dict:
    pol: dict[str, Any] = {
        "schema": "execution.policy/1",
        "git": {"commit": True, "push": True, "force": "never", "history_rewrite": "never",
                "push_freeze_utc": FIXED_END, "conventional_commits": True, "attribution_trailers": "never"},
        "networks": {"testnet": {"allowed": False, "chains": []},
                     "mainnet": {"mode": "read-only", "setup_task": None, "ceiling": None, "unit": None,
                                 "per_wave_ceiling": None, "broadcast_patterns": []}},
        "deny_endpoints": [], "deny_commands": [],
        "fences": {"deny_read": [], "deny_write_outside_repo": True, "allow_write_outside": ["C:/x/qc/scratch"]},
        "secrets": {"env_file": None, "agents_read_keys": False, "loading": "in-process"},
    }
    pol.update(over)
    return pol


def build_task_status(status: str = "ready", **over: Any) -> dict:
    entry: dict[str, Any] = {"status": status, "since_utc": FIXED_NOW, "attempts": 0, "reruns": 0,
                             "consecutive_reruns": 0, "history": []}
    entry.update(over)
    return entry


def build_status(executor: str = "A", tasks: Mapping[str, dict] | None = None, **over: Any) -> dict:
    doc: dict[str, Any] = {"schema": "execution.status/1", "executor": executor, "plan_version": 1,
                           "updated_utc": FIXED_NOW, "seq": 1, "tasks": dict(tasks or {})}
    doc.update(over)
    return doc


SHA_A = "1" * 40
RUN_ID = "T001-11111111-20261003T071200Z-1"


def build_receipt(task: str = "T001", *, verdict: str = "pass", **over: Any) -> dict:
    """A schema-valid proof receipt."""
    doc: dict[str, Any] = {
        "schema": "execution.proof-receipt/1", "task": task, "attempt": 1, "executor": "A", "plan_version": 1,
        "proof_hash": "b" * 64, "sha": SHA_A, "on_origin_main": True, "run": RUN_ID.replace("T001", task),
        "command": "node --test", "exit_code": 0, "output_sha256": "c" * 64,
        "negative_control": {"required": True, "ran": True, "exit_code": 1, "met": True},
        "verdict": verdict, "criteria": [{"criterion": "tests pass", "met": True, "evidence": "exit 0"}],
        "findings": [],
        "integrity": {"tests_modified": [], "skip_markers_added": 0, "assertion_delta": 0, "todo_added": 0,
                      "protected_touched": [], "stubs": []},
        "by": {"role": "verifier", "agent_type": "execution-verifier", "agent_id": "agent-v1", "model": "sonnet",
               "effort": "medium"},
        "implementer": {"commit": SHA_A, "agent_type": "execution-implementer", "agent_id": "agent-i1",
                        "result": f"proofs/impl/{task}.a1.json", "merge_receipt": f"proofs/merge/{task}.a1.json"},
        "run_copy": f"proofs/runs/{task}/{RUN_ID.replace('T001', task)}.json",
        "written_utc": FIXED_NOW,
    }
    doc.update(over)
    return doc


def build_merge_receipt(task: str = "T001", *, outcome: str = "landed", **over: Any) -> dict:
    doc: dict[str, Any] = {
        "schema": "execution.merge-receipt/1", "task": task, "attempt": 1, "rerun": 0, "wave": "W01",
        "lane": "L1", "mode": "single-tree", "branch": "main", "origin_before": "2" * 40, "head_before": "2" * 40,
        "landed_sha": SHA_A if outcome == "landed" else None, "outcome": outcome, "push_attempts": 1,
        "gates": {"label": f"merge-{task}-a1r0", "result_path": None, "exit_code": 0, "flaky": []},
        "task_proof": {"run": None, "exit_code": 0}, "scans": [], "conflict_files": [], "worktree_removed": True,
        "started_utc": FIXED_NOW, "finished_utc": FIXED_NOW,
    }
    doc.update(over)
    return doc


def build_local_state(executor: str = "A", *, run_state: str = "RUNNING", project: str = "queue-clock") -> dict:
    doc = state_mod.default(executor, project, fixed_now())
    doc["run_state"] = run_state
    return doc


def build_active(repo: Path, state_dir: Path, *, executor: str = "A", session_id: str | None = SESSION_ID,
                 nonce: str | None = "0123456789abcdef") -> dict:
    return {"schema": "execution.active/1", "executor": executor, "project": "queue-clock",
            "repo": paths.posix(repo), "state_dir": paths.posix(state_dir), "session_id": session_id,
            "bind_nonce": nonce, "previous_session_ids": [], "created_utc": FIXED_NOW, "rekey_armed_until_utc": None}


def state_dir(repo: Path, *, executor: str = "A", run_state: str = "RUNNING", plan: dict | None = None,
              approved: bool = True, session_id: str | None = SESSION_ID, status: dict | None = None
              ) -> paths.Layout:
    """Write a minimal valid `.execution/` (plan, status, local/state.json, local/active) and return its Layout."""
    layout = paths.layout_for(Path(repo), None)
    the_plan = plan if plan is not None else build_plan()
    if approved and the_plan.get("approved") is None:
        the_plan = approve(the_plan)
    jsonio.write_json_atomic(layout.plan, the_plan)
    jsonio.write_json_atomic(layout.status(executor), status or build_status(executor))
    jsonio.write_json_atomic(layout.local_state, build_local_state(executor, run_state=run_state))
    jsonio.write_json_atomic(layout.active, build_active(Path(repo), layout.state, executor=executor,
                                                         session_id=session_id))
    return layout


def fixture_instance(dest: Path | None = None, **flags: Any) -> dict:
    """The rendered fixture: `exec.py fixture new --now 2026-10-03T07:12:00Z` once B11's module exists, else the
    static copies of the rendered drafts in fixtures/B01/fixture-rendered/ (no repository)."""
    if (SCRIPTS_DIR / "execlib" / "fixture.py").exists() and dest is not None:
        args = ["fixture", "new", "--dest", str(dest), "--now", FIXED_NOW]
        for key, value in flags.items():
            opt = "--" + key.replace("_", "-")
            if value is True:
                args.append(opt)
            elif value not in (None, False):
                args += [opt, str(value)]
        code, env, _logs = run_exec(args, cwd=Path(dest).parent)
        if code != 0:
            raise AssertionError(f"fixture new failed: {env['errors']}")
        return env["data"]
    return {"dest": None, "spec": None,
            "drafts": {"profile": str(RENDERED / "profile.draft.json"), "policy": str(RENDERED / "policy.draft.json")},
            "never_show": str(RENDERED / "never-show.json"), "commit": None}


def tool_available(name: str) -> bool:
    return shutil.which(name) is not None
