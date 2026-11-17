"""Stop gate of /execution (contract/HOOKS.md 4, MODULES.md 6.1).

Decides, at every end of turn of the orchestrator session, whether the turn may end (allow: nothing printed) or
must continue (one JSON line with `additionalContext`; never `decision: block`, never exit 2). Rows 0-9 of HOOKS.md
4.1, first match wins. The fifth consecutive continuation becomes an allow plus a STUCK record that `exec.py status`
imports. The payload's `effort` is recorded as hooks-state `last_effort` (hookcore.note_effort). Fails open on any
internal error.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from execlib import hookcore as hc  # noqa: E402

HOOK = "stop-gate"
RUNNING_STATUSES = frozenset({"running", "pending", "queued", "in_progress"})
SETUP_STATES = frozenset({"INIT", "PREFLIGHT", "INGEST", "PLAN"})
TERMINAL_OR_STUCK = frozenset({"BUILD_COMPLETE", "HANDED_OVER", "STUCK"})
WAITING_STATES = frozenset({"AWAIT_APPROVAL", "AWAITING_HUMAN", "AWAITING_DECISION", "PAUSED_QUOTA",
                            "PAUSED_RESOURCES"})
CAP = 4
TEXT_MAX = 600
HEARTBEAT_MAX_DAYS = 7.0
PUSH_FALLBACK = "execution BLOQUÉ : {project} a besoin de toi à l'ordinateur"


def running_items(bg: object) -> list[str]:
    if not isinstance(bg, list):
        return []
    names: list[str] = []
    for item in bg:
        if not isinstance(item, dict):
            continue
        if str(item.get("status") or "").strip().lower() in RUNNING_STATUSES:
            name = item.get("description") or item.get("name") or item.get("id") or item.get("type") or "task"
            names.append(str(name)[:60])
    return names


def heartbeat_in_crons(crons: list) -> bool:
    for item in crons:
        if not isinstance(item, dict):
            continue
        prompt = item.get("prompt")
        if not isinstance(prompt, str) or not prompt.lstrip().lower().startswith("execution heartbeat"):
            continue
        if item.get("recurring") is False:
            continue
        return True
    return False


def heartbeat_armed(env: hc.HookEnv, st: dict, payload: dict) -> bool:
    """HOOKS.md 4.2: session_crons when present; else the recorded heartbeat of the bound session, < 7 days old."""
    crons = payload.get("session_crons")
    if isinstance(crons, list):
        return heartbeat_in_crons(crons)
    hb = st.get("heartbeat") if isinstance(st.get("heartbeat"), dict) else {}
    if not hb.get("cron_id"):
        return False
    if hb.get("session_id") is None or hb.get("session_id") != env.marker.get("session_id"):
        return False
    age = hc.days_old(hb.get("recorded_utc"), hc.utcnow())
    return age is not None and 0 <= age <= HEARTBEAT_MAX_DAYS


def ready_ids(env: hc.HookEnv) -> list[str] | None:
    """local/schedule.json ready[].task; None when the file is absent (unknown, never empty)."""
    doc = hc.read_json_quiet(env.layout_local / "schedule.json")
    if not isinstance(doc, dict) or not isinstance(doc.get("ready"), list):
        return None
    out: list[str] = []
    for item in doc["ready"]:
        if isinstance(item, dict) and isinstance(item.get("task"), str):
            out.append(item["task"])
        elif isinstance(item, str):
            out.append(item)
    return out


def decision_paused(st: dict) -> bool:
    gov = st.get("governor") if isinstance(st.get("governor"), dict) else None
    if gov and isinstance(gov.get("decision"), dict) and gov["decision"].get("pause") is True:
        return True
    quota = st.get("quota") if isinstance(st.get("quota"), dict) else None
    return bool(quota and quota.get("decision") == "pause")


def launched_unfinished(st: dict) -> list[str]:
    waves = st.get("waves") if isinstance(st.get("waves"), list) else []
    return [str(w.get("wave")) for w in waves
            if isinstance(w, dict) and w.get("status") == "launched" and w.get("finished_utc") is None]


def push_text(env: hc.HookEnv) -> str:
    """The French `stuck` entry of assets/report-templates/push.fr.json rendered with the project name."""
    project = str(env.marker.get("project") or "le projet")
    profile = hc.read_json_quiet(env.state_dir / "profile.json")
    if isinstance(profile, dict) and isinstance(profile.get("project"), dict):
        project = str(profile["project"].get("name") or project)
    template = PUSH_FALLBACK
    doc = hc.read_json_quiet(hc.SKILL_DIR / "assets" / "report-templates" / "push.fr.json")
    if isinstance(doc, dict):
        entry = doc.get("stuck")
        if isinstance(entry, dict):
            entry = entry.get("text") or entry.get("template") or entry.get("fr")
        if isinstance(entry, str) and entry.strip():
            template = entry
    text = template
    for token in ("{project}", "{projet}", "<projet>", "<project>", "{{project}}", "{{projet}}"):
        text = text.replace(token, project)
    return text[:200]


def continuation_text(env: hc.HookEnv, n: int, nothing_can_launch: bool, ready: list[str] | None,
                      awaiting: list[str], waves: list[str], bg_present_empty: bool) -> str:
    exe = hc.exec_cmd()
    if nothing_can_launch:
        text = (f"execution: nothing can launch now and no wake source is armed (continuation {n}/{CAP}). Arm the "
                f"heartbeat: {exe} heartbeat plan, then CronCreate with its arguments, then {exe} heartbeat record.")
    else:
        ready_txt = ", ".join(ready[:8]) if ready else ("none" if ready is not None else "unknown")
        await_txt = ", ".join(awaiting[:5]) if awaiting else "none"
        text = (f"execution: the plan is open and nothing is armed (continuation {n}/{CAP}). Ready: {ready_txt}. "
                f"Awaiting: {await_txt}. Run {exe} status, then {exe} wave emit or {exe} manual post, and arm the "
                f"heartbeat ({exe} heartbeat plan, then CronCreate, then {exe} heartbeat record).")
        if bg_present_empty and waves:
            text += f" Wave {waves[0]} is launched and no background task runs: run {exe} wave ingest."
    if len(text) > TEXT_MAX - (260 if n >= CAP else 0):
        # keep the absolute command once; later mentions use the SKILL.md shorthand "exec.py <command>"
        first = text.find(exe) + len(exe)
        text = text[:first] + text[first:].replace(exe, "exec.py")
    if n >= CAP:
        tail = (" This is the last continuation: if you cannot arm a wake source now, send PushNotification \""
                f"{push_text(env)}\" before ending the turn.")
        if len(text) + len(tail) > TEXT_MAX:
            text = text[:max(0, TEXT_MAX - len(tail) - 3)].rstrip() + "..."
        text += tail
    return text[:TEXT_MAX]


def main() -> None:
    payload = hc.read_payload()
    env = hc.locate(payload)
    if env is None or not hc.is_orchestrator(env, payload):
        return  # row 0
    now = hc.utcnow()
    now_txt = hc.fmt_utc(now)
    hs = hc.read_hooks_state(env)
    hc.note_effort(hs, payload)  # last_effort for preflight PF-30 (revision 4); every path below writes hs
    if payload.get("stop_hook_active") is not True:
        hs["consecutive_continuations"] = 0  # row 1 (no decision)
    hs["last_stop_utc"] = now_txt
    st = hc.local_state(env)
    run_state = st.get("run_state")
    bg = payload.get("background_tasks") if "background_tasks" in payload else None
    bg_present = isinstance(bg, list)

    def allow(reason: str, **extra: object) -> None:
        hs["consecutive_continuations"] = 0
        hc.write_hooks_state(env, hs)
        hc.append_event(env, HOOK, "stop.allow", payload, {"reason": reason, **extra})

    running = running_items(bg)
    if running:
        return allow("running", items=running)  # row 2
    if run_state in SETUP_STATES:
        return allow("setup")  # row 3
    if run_state in TERMINAL_OR_STUCK:
        return allow("terminal-or-stuck")  # row 4
    armed = heartbeat_armed(env, st, payload)
    awaiting = [str(a.get("ref")) for a in (st.get("awaiting") or []) if isinstance(a, dict) and a.get("ref")]
    if (awaiting or run_state in WAITING_STATES) and armed:
        return allow("awaiting", refs=awaiting)  # row 5
    ready = ready_ids(env)
    nothing_can_launch = (ready is not None and not ready) or decision_paused(st)
    if nothing_can_launch and armed:
        return allow("idle-armed")  # row 6
    waves = launched_unfinished(st)
    if not bg_present and waves and armed:
        return allow("wave-launched-unknown-bg", waves=waves)  # row 7
    count = int(hs.get("consecutive_continuations") or 0)
    if count + 1 > CAP:  # row 8
        hs["consecutive_continuations"] = 0
        hs["stuck"] = {"at_utc": now_txt, "source": "stop-gate",
                       "reason": "stop-gate: 5th consecutive stop with the plan open and nothing armed"}
        hc.write_hooks_state(env, hs)
        hc.append_event(env, HOOK, "stop.stuck", payload, {"reason": hs["stuck"]["reason"]})
        return
    n = count + 1  # row 9
    text = continuation_text(env, n, nothing_can_launch, ready, awaiting, waves, bg_present and not bg)
    hs["consecutive_continuations"] = n
    hs["last_continuation_utc"] = now_txt
    hc.write_hooks_state(env, hs)
    hc.append_event(env, HOOK, "stop.continue", payload, {"n": n, "nothing_can_launch": nothing_can_launch})
    hc.emit_context("Stop", text)


if __name__ == "__main__":
    hc.fail_open(main, HOOK)
