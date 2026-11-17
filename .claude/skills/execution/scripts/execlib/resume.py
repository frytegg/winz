"""The script half of the recovery playbook: `exec.py resume` (contract/CLI.md `resume`, ARCHITECTURE.md 16,
HOOKS.md 2.2, NOTION.md 6.4).

Steps R0-R10 are reported, each `{id, done, detail, command?}`; the orchestrator does the tool half (CronList,
CronCreate, re-arming watchers, the Workflow relaunch). `resume --takeover` is the only way a new session takes a
bound run over: it moves the old session id to `previous_session_ids`, clears the binding, writes a fresh bind nonce
and clears the recorded heartbeat; the next turn's `hooks canary --nonce <new>` binds the new session.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from argparse import Namespace
from pathlib import Path
from typing import Any, Mapping

from . import clock, events, gitutil, jsonio, reconcile, replay, results, state
from .errors import EnvError, GitError, UsageError
from .model import CommandResult, Ctx
from .paths import exec_cmd, posix

ENV_REQUIRED = ("CLAUDE_CODE_RETRY_WATCHDOG", "CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS",
                "CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH", "MSYS_NO_PATHCONV")
HOOK_TAG = "# execution-hook v1"
HOOK_EVENTS = ("Stop", "StopFailure", "SessionStart", "SessionEnd", "PreToolUse")
RESTART = "restart through launch-exec.ps1 -Resume (claude --resume \"<proj>-exec\" --dangerously-skip-permissions)"


def _step(sid: str, done: bool, detail: str, command: str | None = None) -> dict:
    out: dict[str, Any] = {"id": sid, "done": done, "detail": detail}
    if command:
        out["command"] = command
    return out


def _profile(ctx: Ctx) -> dict:
    return jsonio.read_json(ctx.layout.profile) if ctx.layout.profile.exists() else {}


def r0_environment(ctx: Ctx, env: Mapping[str, str]) -> dict:
    prof = _profile(ctx)
    want_conc = str(((prof.get("machine") or {}).get("workflow_concurrency")) or "")
    problems: list[str] = []
    if env.get("CLAUDE_CODE_RETRY_WATCHDOG") != "1":
        problems.append("CLAUDE_CODE_RETRY_WATCHDOG is not 1")
    conc = env.get("CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS")
    if not conc or (want_conc and conc != want_conc):
        problems.append(f"CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS is {conc!r}, "
                        f"profile wants {want_conc or 'a value'}")
    try:
        mcp_ok = int(env.get("CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH", "0")) >= 60000
    except ValueError:
        mcp_ok = False
    if not mcp_ok:
        problems.append("CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH is below 60000")
    if env.get("MSYS_NO_PATHCONV") != "1":
        problems.append("MSYS_NO_PATHCONV is not 1")
    if problems:
        return _step("R0", False, "; ".join(problems), RESTART)
    return _step("R0", True, "the launcher's environment is present")


def r1_session(ctx: Ctx, env: Mapping[str, str]) -> tuple[dict, dict]:
    marker = state.read_active(ctx.layout)
    env_id = env.get("CLAUDE_CODE_SESSION_ID") or None
    bound = (marker or {}).get("session_id")
    if marker is None:
        return _step("R1", False, "no local/active marker: the run is not installed",
                     f"{exec_cmd()} hooks install"), {"env_id": env_id, "bound_id": None, "same": None}
    if env_id is None:
        same = None
        step = _step("R1", False, "CLAUDE_CODE_SESSION_ID is absent: treated as a different session",
                     f"{exec_cmd()} resume --takeover")
    elif bound == env_id:
        same = True
        step = _step("R1", True, "this session is the bound one (a claude --resume keeps the id)")
    else:
        same = False
        step = _step("R1", False, f"bound to another session ({bound or 'none'}); nothing was rebound",
                     f"{exec_cmd()} resume --takeover")
    return step, {"env_id": env_id, "bound_id": bound, "same": same}


def r2_hooks(ctx: Ctx) -> dict:
    if ctx.layout.repo is None:
        return _step("R2", False, "no product repository", f"{exec_cmd()} hooks install")
    path = Path(ctx.layout.repo) / ".claude" / "settings.local.json"
    if not path.is_file():
        return _step("R2", False, f"{posix(path)} is absent", f"{exec_cmd()} hooks install")
    try:
        doc = json.loads(path.read_bytes().decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _step("R2", False, f"{posix(path)} is not valid JSON (never overwritten)", None)
    hooks = (doc or {}).get("hooks") or {}
    missing = [ev for ev in HOOK_EVENTS
               if not any(HOOK_TAG in str(h.get("command", "")) for entry in hooks.get(ev) or ()
                          for h in (entry.get("hooks") or ()))]
    if missing:
        return _step("R2", False, "hook entries missing: " + ", ".join(missing), f"{exec_cmd()} hooks install")
    return _step("R2", True, "every hook entry is installed")


def _git_running() -> bool | None:
    """True when a git process runs on this machine (None when it cannot be told)."""
    try:
        if os.name == "nt":
            out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq git.exe", "/NH"], capture_output=True, timeout=20,
                                 check=False, stdin=subprocess.DEVNULL)
            return b"git.exe" in out.stdout.lower()
        out = subprocess.run(["pgrep", "-x", "git"], capture_output=True, timeout=20, check=False,
                             stdin=subprocess.DEVNULL)
        return out.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return None


def r3_residue(ctx: Ctx, *, git_running: bool | None = None) -> dict:
    if ctx.layout.repo is None:
        return _step("R3", True, "no product repository")
    lock = Path(ctx.layout.repo) / ".git" / "index.lock"
    if not lock.exists():
        return _step("R3", True, "no stale index.lock; ports are not measured by the script")
    running = _git_running() if git_running is None else git_running
    if running is None:
        return _step("R3", False, "an index.lock exists and the git process list could not be read: left in place")
    if running:
        return _step("R3", False, "an index.lock exists while a git process runs: left in place")
    os.remove(lock)
    return _step("R3", True, "stale .git/index.lock removed (no git process running)")


def _glob_rx(glob: str) -> re.Pattern[str]:
    out = ""
    i = 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif glob.startswith("**", i):
            out += ".*"
            i += 2
        elif glob[i] == "*":
            out += "[^/]*"
            i += 1
        elif glob[i] == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(glob[i])
            i += 1
    return re.compile("^" + out + "$")


def r4_worktrees(ctx: Ctx, plan: Any, live: list[dict]) -> dict:
    if ctx.layout.repo is None:
        return _step("R4", True, "no product repository")
    git = gitutil.Git(Path(ctx.layout.repo))
    try:
        dirty = [line[3:] for line in git.status_porcelain()]
    except GitError as err:
        return _step("R4", False, f"git status failed: {err.message}")
    notes = 0
    lines: list[str] = []
    for man in live:
        for item in man.get("tasks") or ():
            tid = item["task"] if isinstance(item, dict) else str(item)
            task = plan.by_id.get(tid) if plan is not None else None
            if task is None:
                continue
            mine = [p for p in dirty if any(_glob_rx(g).match(p) for g in task.writes)]
            refs = git.run("for-each-ref", "--format=%(refname) %(objectname)", f"refs/exec/{tid}/",
                           check=False).stdout.split("\n")
            refs = [r for r in refs if r.strip()]
            if not mine and not refs:
                continue
            body = [f"# Resume note for {tid} (wave {man['wave']})", "",
                    "Review this as someone else's work: verify it before you build on it.", "",
                    "## Commits recorded", *([f"- {r}" for r in refs] or ["- none"]), "",
                    "## Uncommitted files in the checkout", *([f"- {p}" for p in mine] or ["- none"])]
            jsonio.write_text_atomic(ctx.layout.state / "briefs" / f"{tid}.resume.md", "\n".join(body) + "\n")
            notes += 1
            lines.append(f"{tid}: {len(mine)} uncommitted, {len(refs)} recorded commit(s)")
    detail = f"{len(dirty)} uncommitted path(s) in the checkout; {notes} resume note(s) written"
    if lines:
        detail += " (" + "; ".join(lines) + ")"
    return _step("R4", True, detail)


def r5_waves(ctx: Ctx, session: Mapping[str, Any]) -> tuple[dict, list[dict]]:
    st = state.load(ctx.layout)
    by_wave = {w["wave"]: w for w in st.get("waves") or ()}
    env_id = session.get("env_id")
    out: list[dict] = []
    for man in reconcile.manifests(ctx):
        status = man.get("status")
        if status in ("ingested", "abandoned"):
            continue
        local = by_wave.get(man["wave"]) or {}
        run_id = (man.get("launch") or {}).get("run_id") or local.get("run_id")
        launch_session = local.get("session_id")
        same = None if not env_id or not launch_session else (env_id == launch_session)
        if status == "launched":
            action = "resumeFromRunId" if same is True else "relaunch"
        elif status == "finished" or local.get("status") == "finished":
            action = "ingest"
        elif status == "launch-failed":
            action = "relaunch"
        elif status == "launching":
            since = man.get("launching_utc") or man.get("created_utc")
            young = since and ctx.now - clock.parse_utc(str(since)) < reconcile.LAUNCHING_GRACE
            if run_id:
                action = "record-launch"
            elif young:
                action = "record-launch"
            elif reconcile.wave_activity(ctx, man["wave"]):
                action = "decide"
            else:
                action = "abandon"
        else:
            action = "ingest"
        out.append({"wave": man["wave"], "status": status, "run_id": run_id, "same_session": same,
                    "action": action})
    return _step("R5", True, f"{len(out)} wave(s) not ingested"), out


def r9_notion(ctx: Ctx) -> dict:
    try:
        from . import notion  # lane B09; absent until it lands
    except ImportError:
        return _step("R9", False, "the notion module (lane B09) is absent: pending batches not acked")
    acked = notion.ack_pending_as_crashed(ctx)
    return _step("R9", True, f"{len(acked)} unacked op(s) acked as crash-unknown; creates go through the board "
                             "map rebuild, no sooner than 60 s after the batch's emit time")


def steps(ctx: Ctx) -> list[dict]:
    """R0 … R10 (state lock held), the MODULES.md signature: the step list only. `cmd_resume` also reports the R5
    wave classification and the R1 session, so it calls `sweep`, which runs the same steps once."""
    return sweep(ctx)[0]


def sweep(ctx: Ctx, env: Mapping[str, str] | None = None) -> tuple[list[dict], list[dict], dict]:
    """R0 … R10 (state lock held). Returns (steps, waves, session): the CLI.md `resume` data fields `steps`, `waves`
    and `session` from one pass (each step runs once; R6-R9 write). `env` defaults to os.environ (a test seam)."""
    env = dict(os.environ if env is None else env)
    out: list[dict] = [r0_environment(ctx, env)]
    r1, session = r1_session(ctx, env)
    out.append(r1)
    out.append(r2_hooks(ctx))
    out.append(r3_residue(ctx))
    plan = reconcile.load_plan(ctx.layout)
    live = [m for m in reconcile.manifests(ctx) if m.get("status") in ("launching", "launched")]
    out.append(r4_worktrees(ctx, plan, live))
    r5, waves = r5_waves(ctx, session)
    out.append(r5)
    pending: list[str] = []
    git = None
    if ctx.layout.repo is not None and (Path(ctx.layout.repo) / ".git").exists():
        git = gitutil.Git(Path(ctx.layout.repo))
        try:
            git.fetch()
        except GitError:
            git = None
    finalised = results.finalize_merge_intents(ctx, git) if git is not None else []
    if ctx.layout.merge_pending_dir.is_dir():
        pending = sorted(p.name for p in ctx.layout.merge_pending_dir.glob("*.json"))
    out.append(_step("R6", True, f"{len(finalised)} intent(s) finalised; open: {', '.join(pending) or 'none'}"))
    rebuilt = replay.rebuild_local_state(ctx)
    out.append(_step("R7", True, "local state rebuilt from events (fields changed: "
                     + (", ".join(sorted(rebuilt["diff"])) or "none") + ")"))
    data = reconcile.run_status(ctx)
    out.append(_step("R8", True, f"status reconciled: run_state {data['run_state']}"))
    out.append(r9_notion(ctx))
    out.append(_step("R10", False, "check the heartbeat with CronList; recreate it if absent",
                     f"{exec_cmd()} heartbeat plan (then CronCreate and heartbeat record)"))
    return out, waves, session


def _fresh_nonce(ctx: Ctx, old: str | None, new: str | None) -> str:
    return jsonio.sha256_json(["bind", clock.format_utc_precise(ctx.now), old, new, os.getpid()])[:16]


def takeover(ctx: Ctx, env: Mapping[str, str] | None = None) -> dict:
    """`resume --takeover` (state lock held). Returns {session, rebind_nonce, steps}."""
    env = dict(os.environ if env is None else env)
    marker = state.read_active(ctx.layout)
    if marker is None:
        raise UsageError("no local/active marker: nothing to take over", hint=f"{exec_cmd()} hooks install")
    env_id = env.get("CLAUDE_CODE_SESSION_ID") or None
    if env_id is None:
        raise EnvError("CLAUDE_CODE_SESSION_ID is not set: run resume --takeover from the session's Bash tool",
                       code="E_ENV")
    old = marker.get("session_id")
    if old == env_id:
        return {"session": {"env_id": env_id, "bound_id": old, "same": True}, "rebind_nonce": None,
                "steps": [_step("T0", True, "this session is already the bound one")]}
    prev = [s for s in marker.get("previous_session_ids") or [] if s != old]
    if old:
        prev.append(old)
    marker = dict(marker)
    marker["previous_session_ids"] = prev[-10:]
    marker["session_id"] = None
    marker["bind_nonce"] = _fresh_nonce(ctx, old, env_id)
    state.write_active(ctx.layout, marker)
    st = state.load(ctx.layout)
    st["heartbeat"] = {"cron_id": None, "cron_expr": None, "prompt": (st.get("heartbeat") or {}).get("prompt", ""),
                       "recorded_utc": None, "session_id": None}
    state.save(ctx, st)
    events.append(ctx, "resume", {"takeover": True, "from_session": old, "to_session": env_id})
    cmd = exec_cmd()
    return {"session": {"env_id": env_id, "bound_id": None, "same": False}, "rebind_nonce": marker["bind_nonce"],
            "steps": [
                _step("T1", False, "if the old session still runs: CronDelete its heartbeat, or close it"),
                _step("T2", False, "next turn: bind this session",
                      f"{cmd} hooks canary --nonce {marker['bind_nonce']}"),
                _step("T3", False, "then arm a new heartbeat", f"{cmd} heartbeat plan (CronCreate, heartbeat record)"),
            ]}


def cmd_resume(ctx: Ctx, args: Namespace) -> CommandResult:
    """`resume [--takeover]`."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    with reconcile.state_lock(ctx):
        if args.takeover:
            out = takeover(ctx)
            return CommandResult(data={"steps": out["steps"], "waves": [], "session": out["session"],
                                       "rebind_nonce": out["rebind_nonce"]})
        st, waves, session = sweep(ctx)
        events.append(ctx, "resume", {"steps": [s["id"] for s in st if not s["done"]],
                                      "waves": [{"wave": w["wave"], "action": w["action"]} for w in waves]})
    return CommandResult(data={"steps": st, "waves": waves, "session": session, "rebind_nonce": None})
