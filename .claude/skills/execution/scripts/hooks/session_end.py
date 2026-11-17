"""SessionEnd hook of /execution (contract/HOOKS.md 6, MODULES.md 6.3).

The orchestrator session ending with reason `clear` arms the re-key: `rekey_armed_until_utc = now + 120 s` in the
marker (only that field). Anything else does nothing. SessionEnd has no output channel. Fails open.
"""
from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from execlib import hookcore as hc  # noqa: E402

HOOK = "session-end"
REKEY_WINDOW_S = 120


def main() -> None:
    payload = hc.read_payload()
    env = hc.locate(payload)
    if env is None or not hc.is_orchestrator(env, payload) or payload.get("reason") != "clear":
        return
    until = hc.utcnow() + timedelta(seconds=REKEY_WINDOW_S)
    hc.update_marker(env, {"rekey_armed_until_utc": hc.fmt_utc(until)})


if __name__ == "__main__":
    hc.fail_open(main, HOOK)
