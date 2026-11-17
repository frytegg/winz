"""StopFailure hook of /execution (contract/HOOKS.md 7, MODULES.md 6.4).

An API-error turn ending fires StopFailure instead of Stop. For an agent of this run: a `stop.failure {agent: true}`
event only, never STUCK (it also fires for helper and subagent failures). For the orchestrator session: a
`stop.failure {error, error_details, keys}` event always, and a STUCK record in hooks-state unless the error is
`rate_limit` (quota evidence, read by `exec.py quota`). `exec.py status` drops a stuck record that a later `stop.*`
event of the same session superseded. No stdout. Fails open.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from execlib import hookcore as hc  # noqa: E402

HOOK = "stop-failure"
DETAILS_MAX = 500


def main() -> None:
    payload = hc.read_payload()
    env = hc.locate(payload)
    if env is None:
        return
    error = payload.get("error")
    error_text = str(error) if isinstance(error, str) else ("unknown" if error is None else str(error)[:80])
    if hc.is_agent(payload):
        if hc.agent_in_run(env, payload):
            hc.append_event(env, HOOK, "stop.failure", payload, {"agent": True, "error": error_text})
        return
    if not hc.is_orchestrator(env, payload):
        return
    details = payload.get("error_details")
    details_text = hc.redact(str(details))[:DETAILS_MAX] if details is not None else None
    keys = sorted(str(k) for k in payload.keys())
    hc.append_event(env, HOOK, "stop.failure", payload,
                    {"error": error_text, "error_details": details_text, "keys": keys})
    if error_text != "rate_limit":
        hs = hc.read_hooks_state(env)
        hs["stuck"] = {"at_utc": hc.fmt_utc(hc.utcnow()), "reason": f"stop-failure: {error_text}",
                       "source": "stop-failure"}
        hc.write_hooks_state(env, hs)


if __name__ == "__main__":
    hc.fail_open(main, HOOK)
