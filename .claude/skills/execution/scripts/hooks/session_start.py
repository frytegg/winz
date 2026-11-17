"""SessionStart hook of /execution (contract/HOOKS.md 5, MODULES.md 6.2; matcher startup|resume|clear|compact).

Re-keys the run to the new session id after a `/clear` that SessionEnd armed (within 120 s), then, for the
orchestrator session only, records the payload's `effort` as hooks-state `last_effort` (hookcore.record_effort) and
prints the state digest context (<= 2,000 characters) with this machine's absolute exec.py command and the re-read
instruction. Other sessions and agents get nothing. Fails open.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from execlib import hookcore as hc  # noqa: E402

HOOK = "session-start"
TEXT_MAX = 2000
KEEP_PREVIOUS = 10


def age_text(path: Path) -> str:
    try:
        mtime = os.stat(path).st_mtime
    except OSError:
        return "unknown age"
    seconds = hc.utcnow().timestamp() - mtime
    if seconds < 0:
        return "unknown age"
    if seconds < 60:
        return f"{int(seconds)} s ago"
    minutes = int(seconds // 60)
    if minutes < 120:
        return f"{minutes} min ago"
    return f"{minutes // 60} h {minutes % 60} min ago"


def maybe_rekey(env: hc.HookEnv, payload: dict) -> bool:
    """Source clear with the marker armed by SessionEnd(clear) and not expired: the run follows the new id."""
    if payload.get("source") != "clear" or hc.is_agent(payload):
        return False
    new_id = payload.get("session_id")
    old_id = env.marker.get("session_id")
    armed = hc.parse_utc_or_none(env.marker.get("rekey_armed_until_utc"))
    if not new_id or armed is None or hc.utcnow() > armed or new_id == old_id:
        return False
    previous = [s for s in (env.marker.get("previous_session_ids") or []) if isinstance(s, str)]
    if old_id:
        previous.append(old_id)
    marker = hc.update_marker(env, {"session_id": new_id, "previous_session_ids": previous[-KEEP_PREVIOUS:],
                                    "rekey_armed_until_utc": None})
    env.marker.clear()
    env.marker.update(marker)
    hs = hc.read_hooks_state(env)
    hs["consecutive_continuations"] = 0
    hc.write_hooks_state(env, hs)
    hc.append_event(env, HOOK, "hooks.rekeyed", payload, {"from": old_id, "to": new_id})
    return True


def context_text(env: hc.HookEnv, payload: dict, rekeyed: bool) -> str:
    skill = hc.skill_posix()
    exe = hc.exec_cmd()
    st = hc.local_state(env)
    run_state = st.get("run_state") or "unknown"
    source = payload.get("source") or "unknown"
    head = (f"/execution run active: project {env.marker.get('project')}, executor {env.marker.get('executor')}, "
            f"run_state {run_state} (source {source}).\n"
            f"EXEC = {exe}  (in SKILL.md and the references, \"exec.py <command>\" means \"<EXEC> <command>\")\n")
    tail = ""
    if source == "resume" or (source == "clear" and rekeyed):
        tail += (f"After a resume or a /clear: run {exe} resume (it classifies launched waves against the current "
                 f"session id: resumeFromRunId works only in the launching session), then CronList (recreate the "
                 f"heartbeat with {exe} heartbeat plan if it is missing; after a /clear it is not counted until "
                 f"re-recorded), then {exe} hooks canary --nonce {env.marker.get('bind_nonce')}.\n")
    tail += (f"Before anything else: re-read {skill}/SKILL.md (standing rules, state machine, tick) and "
             f"{skill}/references/tick.md, then run {exe} status. Do not rely on memory of this conversation for "
             f"task states.")
    digest_path = env.layout_local / "digest.txt"
    digest = hc.read_text_quiet(digest_path)
    if digest is None:
        middle = f"No digest yet; run_state from local/state.json: {run_state}.\n"
    else:
        label = f"State digest, written {age_text(digest_path)} by exec.py status:\n"
        room = TEXT_MAX - len(head) - len(tail) - len(label) - 1
        body = digest.replace("\r\n", "\n").rstrip("\n")
        if len(body) > room:
            cut = body[:max(0, room)]
            nl = cut.rfind("\n")
            body = cut[:nl] if nl > 0 else cut
        middle = label + body + "\n"
    text = head + middle + tail
    return text[:TEXT_MAX]


def main() -> None:
    payload = hc.read_payload()
    env = hc.locate(payload)
    if env is None:
        return
    rekeyed = maybe_rekey(env, payload)
    if not hc.is_orchestrator(env, payload):
        return
    hc.record_effort(env, payload)  # last_effort for preflight PF-30 (revision 4)
    hc.append_event(env, HOOK, "session.start", payload, {"source": payload.get("source"), "rekeyed": rekeyed})
    hc.emit_context("SessionStart", context_text(env, payload, rekeyed))


if __name__ == "__main__":
    hc.fail_open(main, HOOK)
