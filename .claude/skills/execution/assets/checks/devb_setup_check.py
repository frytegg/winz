#!/usr/bin/env python3
"""Dev B's setup checker, the proof of execution:EX-DEVB-CHECK (contract/TWO-DEV.md 8.3). Standard library only.

    python devb_setup_check.py --state <state dir> --executor B --require-notion true|false [--json]

Reads <state>/events.jsonl (after A's `sync --pull-only` brought B's lines) and passes only when all of these
lines exist from `executor: "B"`, newest per type, all at or after the EX-DEVB-SETUP answer's `received_utc` minus
24 h:
- `preflight` with data.for == "event", data.ok true, data.failed == 0, data.open == [];
- `hooks.canary` with data.bound true;
- with --require-notion true: `notion.ack` with data.purpose == "token-check" and data.ok true.
The EX-DEVB-SETUP answer is the answers/<key>.md file whose fenced header names the plan's EX-DEVB-SETUP task.
Output (stdout, one JSON object): {ok, checks: [{id, state, detail}]}; exit 0 iff every check is ok, 1 otherwise,
2 on a usage error. A forged state copy whose B preflight line has ok false and a non-empty open list exits 1
(the task's negative control).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

WINDOW = timedelta(hours=24)
_TS = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d{1,6})?Z$")


def parse_ts(text: str) -> datetime | None:
    m = _TS.match(str(text or ""))
    if not m:
        return None
    base = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    if m.group(2):
        base += timedelta(microseconds=int((m.group(2)[1:] + "000000")[:6]))
    return base


def read_events(path: Path) -> list[dict]:
    out: list[dict] = []
    if not path.is_file():
        return out
    for line in path.read_bytes().decode("utf-8").split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            doc = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(doc, dict):
            out.append(doc)
    return out


def setup_answer_utc(state: Path) -> tuple[datetime | None, str]:
    """received_utc of the EX-DEVB-SETUP task's answer."""
    plan_path = state / "plan.json"
    if not plan_path.is_file():
        return None, "no plan.json in the state directory"
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    setup_ids = {t.get("id") for t in plan.get("tasks") or () if t.get("template") == "execution:EX-DEVB-SETUP"}
    if not setup_ids:
        return None, "the plan has no execution:EX-DEVB-SETUP task"
    best: datetime | None = None
    for f in sorted((state / "answers").glob("*.md")) if (state / "answers").is_dir() else []:
        m = re.search(r"```json\n(.*?)\n```", f.read_text(encoding="utf-8"), re.S)
        if not m:
            continue
        try:
            header = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue
        if header.get("task") in setup_ids:
            ts = parse_ts(header.get("received_utc"))
            if ts is not None and (best is None or ts > best):
                best = ts
    if best is None:
        return None, f"no answer file for {', '.join(sorted(setup_ids))}"
    return best, f"EX-DEVB-SETUP answered at {best.strftime('%Y-%m-%dT%H:%M:%SZ')}"


def newest(events: list[dict], executor: str, type_: str, since: datetime, pred: Any = None) -> dict | None:
    cands = []
    for ev in events:
        if ev.get("executor") != executor or ev.get("type") != type_:
            continue
        ts = parse_ts(ev.get("ts"))
        if ts is None or ts < since:
            continue
        if pred is not None and not pred(ev):
            continue
        cands.append((ts, int(ev.get("seq") or 0), ev))
    return max(cands, key=lambda c: (c[0], c[1]))[2] if cands else None


def run(state: Path, executor: str, require_notion: bool) -> dict:
    checks: list[dict] = []
    answered, detail = setup_answer_utc(state)
    checks.append({"id": "setup-answer", "state": "ok" if answered else "fail", "detail": detail})
    events = read_events(state / "events.jsonl")
    since = (answered - WINDOW) if answered else datetime.max.replace(tzinfo=timezone.utc)
    pf = newest(events, executor, "preflight", since)
    if pf is None:
        checks.append({"id": "preflight", "state": "fail", "detail": f"no preflight line from {executor} in the window"})
    else:
        d = pf.get("data") or {}
        good = d.get("for") == "event" and d.get("ok") is True and d.get("failed") == 0 and d.get("open") == []
        checks.append({"id": "preflight", "state": "ok" if good else "fail",
                       "detail": f"newest preflight at {pf.get('ts')}: for={d.get('for')} ok={d.get('ok')} "
                                 f"failed={d.get('failed')} open={d.get('open')}"})
    can = newest(events, executor, "hooks.canary", since)
    if can is None:
        checks.append({"id": "hooks-canary", "state": "fail", "detail": f"no hooks.canary line from {executor}"})
    else:
        bound = (can.get("data") or {}).get("bound") is True
        checks.append({"id": "hooks-canary", "state": "ok" if bound else "fail",
                       "detail": f"newest canary at {can.get('ts')}: bound={(can.get('data') or {}).get('bound')}"})
    if require_notion:
        ack = newest(events, executor, "notion.ack", since,
                     lambda e: (e.get("data") or {}).get("purpose") == "token-check")
        if ack is None:
            checks.append({"id": "notion-token", "state": "fail", "detail": f"no token-check ack from {executor}"})
        else:
            ok = (ack.get("data") or {}).get("ok") is True
            checks.append({"id": "notion-token", "state": "ok" if ok else "fail",
                           "detail": f"newest token check at {ack.get('ts')}: ok={(ack.get('data') or {}).get('ok')}"})
    return {"ok": all(c["state"] == "ok" for c in checks), "checks": checks}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="devb_setup_check.py", description=__doc__.split("\n")[0])
    ap.add_argument("--state", required=True)
    ap.add_argument("--executor", default="B", choices=("A", "B"))
    ap.add_argument("--require-notion", dest="require_notion", default="true", choices=("true", "false"))
    ap.add_argument("--json", action="store_true")
    try:
        args = ap.parse_args(argv)
    except SystemExit as err:
        return 2 if err.code else 0
    result = run(Path(args.state), args.executor, args.require_notion == "true")
    out = json.dumps(result, sort_keys=True, ensure_ascii=True)
    if args.json:
        sys.stdout.write(out + "\n")
    else:
        for c in result["checks"]:
            sys.stdout.write(f"{c['state']:5} {c['id']}: {c['detail']}\n")
        sys.stdout.write(("ok" if result["ok"] else "FAIL") + "\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
