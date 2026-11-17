"""`exec.py heartbeat plan | record` (contract/CLI.md 1, HOOKS.md 4.2, MODULES.md 5).

plan prints the CronCreate arguments: the minutes `sorted({(offset + k * every) % 60})` of profile.heartbeat and a
plain-text prompt carrying this machine's absolute exec.py command and tick reference (a cron may fire after a
compaction or a /clear dropped the skill body, and /execution is not model-invocable). record stores the cron the
orchestrator created, with the session id it belongs to (crons are session-scoped: the Stop gate counts the record
only for the bound session, under 7 days old).
"""
from __future__ import annotations

import os
import re
from argparse import Namespace

from . import clock, jsonio, paths, state
from .errors import UsageError, ValidationFailed
from .model import CommandResult, Ctx

EVERY_ALLOWED = (10, 12, 15, 20, 30)
CRON_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")
CRON_EXPR_RE = re.compile(r"^[0-9*,/-]+( [0-9*,/-]+){4}$")

# The state lock through state's own import of locks (MODULES.md 8 lists heartbeat -> state, events only;
# contract question Q-B08-5).
hold_lock = state.locks.hold


def prompt_text() -> str:
    skill = paths.posix(paths.SKILL_DIR)
    return f"execution heartbeat: run {paths.exec_cmd()} status and follow {skill}/references/tick.md"


def cron_for(profile: dict) -> dict:
    """{cron, prompt, recurring: true} from profile.heartbeat {every_min, minute_offset}."""
    hb = profile.get("heartbeat") if isinstance(profile, dict) else None
    if not isinstance(hb, dict):
        raise UsageError("profile.heartbeat is missing", hint="run exec.py ingest with a profile draft first")
    every = hb.get("every_min")
    offset = hb.get("minute_offset")
    if every not in EVERY_ALLOWED or not isinstance(offset, int) or isinstance(offset, bool):
        raise UsageError(f"profile.heartbeat {{every_min: {every}, minute_offset: {offset}}} is not usable",
                         hint="every_min divides 60 (10, 12, 15, 20 or 30); minute_offset is an integer")
    minutes = sorted({(offset + k * every) % 60 for k in range(60 // every)})
    return {"cron": ",".join(str(m) for m in minutes) + " * * * *", "prompt": prompt_text(), "recurring": True}


def _profile(ctx: Ctx) -> dict:
    if not ctx.layout.profile.exists():
        raise UsageError("no profile.json", hint="run exec.py ingest first")
    try:
        doc = jsonio.read_json_retry(ctx.layout.profile)
    except ValidationFailed as err:
        raise UsageError(f"profile.json is unreadable: {err.message}") from err
    if not isinstance(doc, dict):
        raise UsageError("profile.json is not an object")
    return doc


def cmd_plan(ctx: Ctx, args: Namespace) -> CommandResult:
    return CommandResult(data=cron_for(_profile(ctx)))


def cmd_record(ctx: Ctx, args: Namespace) -> CommandResult:
    cron_id = str(args.cron_id)
    expr = str(args.expr).strip()
    if not CRON_ID_RE.match(cron_id):
        raise UsageError(f"--cron-id {cron_id[:40]!r} is not a cron id")
    if not CRON_EXPR_RE.match(expr):
        raise UsageError(f"--expr {expr[:60]!r} is not a five-field cron expression")
    session = os.environ.get("CLAUDE_CODE_SESSION_ID") or None
    prompt = prompt_text()
    with hold_lock(ctx.layout, "state", command=ctx.command):
        st = state.load(ctx.layout)
        record = {"cron_id": cron_id, "cron_expr": expr, "prompt": prompt, "recorded_utc": clock.format_utc(ctx.now),
                  "session_id": session}
        changed = st["heartbeat"] != record
        if changed:
            st["heartbeat"] = record
            state.save(ctx, st)  # no event: event.schema.json has no heartbeat type (CLI.md lists none)
    data = dict(record)
    data["changed"] = changed
    data["bound_session_id"] = (state.read_active(ctx.layout) or {}).get("session_id")
    data["counts_for_stop_gate"] = session is not None and session == data["bound_session_id"]
    return CommandResult(data=data)
