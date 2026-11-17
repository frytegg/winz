"""UserPromptSubmit hook of /execution (contract/HOOKS.md 9, MODULES.md 6.6).

A workflow completion (`<task-notification ...`) is not the owner: nothing. An owner prompt in the orchestrator
session gets one line of context (run state, waves running, what is awaited, and the instruction to run status
first), at most 200 characters, and its `effort` is recorded as hooks-state `last_effort` (hookcore.record_effort).
Other sessions and agents: nothing. Fails open.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from execlib import hookcore as hc  # noqa: E402

HOOK = "user-prompt"
TEXT_MAX = 200


def main() -> None:
    payload = hc.read_payload()
    prompt = payload.get("prompt")
    if isinstance(prompt, str):
        head = prompt.lstrip()
        if head.startswith("<task-notification") or head.startswith("<\\task-notification"):
            return
    env = hc.locate(payload)
    if env is None or not hc.is_orchestrator(env, payload):
        return
    hc.record_effort(env, payload)  # last_effort for preflight PF-30 (revision 4)
    st = hc.local_state(env)
    run_state = st.get("run_state") or "unknown"
    waves = [w for w in (st.get("waves") or []) if isinstance(w, dict) and w.get("status") == "launched"]
    refs = [str(a.get("ref")) for a in (st.get("awaiting") or []) if isinstance(a, dict) and a.get("ref")]
    tail = "; run exec.py status first."
    head_text = f"execution: {run_state}, {len(waves)} waves running, awaiting "
    room = TEXT_MAX - len(head_text) - len(tail)
    awaiting = ", ".join(refs) if refs else "none"
    if len(awaiting) > room:
        awaiting = awaiting[:max(0, room - 3)].rsplit(",", 1)[0] + "..."
    hc.emit_context("UserPromptSubmit", (head_text + awaiting + tail)[:TEXT_MAX])


if __name__ == "__main__":
    hc.fail_open(main, HOOK)
