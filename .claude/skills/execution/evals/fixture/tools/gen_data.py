#!/usr/bin/env python3
"""Regenerate the frozen synthetic data of the "Queue Clock" fixture (contract/FIXTURE.md section 5).

Deterministic: random.Random(20260110), template anchor 2026-01-10T12:00:00Z (the last oracle frame).
The numbers are SYNTHETIC. They imitate the shape of a liquid-staking withdrawal queue (a backlog,
new requests between frames, one finalization per daily oracle frame funded by buffer, rewards and
validator exits) and describe no real protocol.

Usage: python gen_data.py <out_dir>
Writes <out_dir>/exit-rate-series.json, queue-snapshots.json and requests.json (UTF-8, LF), and prints
a JSON summary on stdout (the figures the fixture's claims ledger cites).
"""
from __future__ import annotations

import json
import random
import statistics
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

SEED = 20260110
ANCHOR = datetime(2026, 1, 10, 12, 0, 0, tzinfo=timezone.utc)
FRAMES = 14
BACKLOG_ETH = Decimal("45000")
Q = Decimal("0.01")
SIZES_BACKLOG = [0.5, 1, 2, 5, 10, 16, 32, 32, 64, 100, 250, 500]
SIZES_NEW = [0.5, 1, 2, 5, 10, 16, 32, 32, 64, 100, 250]


@dataclass
class Request:
    rid: int
    at: datetime
    amount: Decimal
    start: Decimal
    end: Decimal


def eth(x: float) -> Decimal:
    return Decimal(str(x)).quantize(Q, rounding=ROUND_HALF_UP)


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def write_json(path: Path, obj: Any) -> None:
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8", newline="\n")


def generate() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    rng = random.Random(SEED)
    frame_times = [ANCHOR - timedelta(days=FRAMES - 1 - i) for i in range(FRAMES)]
    start = frame_times[0] - timedelta(days=1)

    reqs: list[Request] = []
    next_id = 47000
    pos = Decimal("0")
    t = start - timedelta(days=6)
    while pos < BACKLOG_ETH:
        amount = eth(rng.choice(SIZES_BACKLOG) * rng.uniform(0.6, 1.4))
        reqs.append(Request(next_id, t, amount, pos, pos + amount))
        pos += amount
        next_id += 1
        t += timedelta(minutes=rng.randint(1, 12))
        if t > start:
            t = start
    t = start
    end_time = ANCHOR + timedelta(hours=1)
    while t < end_time:
        amount = eth(rng.choice(SIZES_NEW) * rng.uniform(0.6, 1.4))
        reqs.append(Request(next_id, t, amount, pos, pos + amount))
        pos += amount
        next_id += 1
        t += timedelta(minutes=rng.randint(8, 30))

    frames: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []
    finalized = Decimal("0")
    for ft in frame_times:
        buffer_eth = eth(rng.uniform(300, 3200))
        rewards_eth = eth(rng.uniform(640, 780))
        exits_eth = eth(rng.choice([0, 0, 960, 1920, 2880, 4160, 5120]) * rng.uniform(0.9, 1.1))
        capacity = buffer_eth + rewards_eth + exits_eth
        requested = sum((r.amount for r in reqs if r.at <= ft), Decimal("0"))
        usable = min(capacity, requested - finalized)
        new_final = finalized
        count = 0
        last_final_id: int | None = None
        for r in reqs:  # whole requests only, in id order
            if r.at > ft:
                break
            if r.end <= finalized:
                last_final_id = r.rid
                continue
            if r.end <= finalized + usable:
                new_final = r.end
                count += 1
                last_final_id = r.rid
            else:
                break
        frames.append({
            "frame_at": iso(ft),
            "capacity_eth": str(capacity),
            "from_buffer_eth": str(buffer_eth),
            "from_rewards_eth": str(rewards_eth),
            "from_exits_eth": str(exits_eth),
            "finalized_eth": str(new_final - finalized),
            "requests_finalized": count,
        })
        finalized = new_final
        snapshots.append({
            "as_of": iso(ft),
            "unfinalized_eth": str(requested - finalized),
            "unfinalized_requests": len([r for r in reqs if r.at <= ft and r.end > finalized]),
            "last_finalized_request_id": last_final_id,
            "last_request_id": max(r.rid for r in reqs if r.at <= ft),
            "buffer_eth": str(buffer_eth),
        })

    def finalized_at(r: Request) -> str | None:
        acc = Decimal("0")
        for f in frames:
            acc += Decimal(f["finalized_eth"])
            if r.end <= acc and r.at <= parse(f["frame_at"]):
                return f["frame_at"]
        return None

    def finalized_before(at: datetime) -> Decimal:
        return sum((Decimal(f["finalized_eth"]) for f in frames if parse(f["frame_at"]) <= at), Decimal("0"))

    in_window = [r for r in reqs if r.at >= start and finalized_at(r) is not None]
    step = len(in_window) / 12
    backtest = [in_window[int(k * step + step / 2)] for k in range(12)]
    still_open = [r for r in reqs if r.at <= ANCHOR and r.end > finalized]
    demo = still_open[len(still_open) // 2]
    tail = still_open[-1]

    rows: list[dict[str, Any]] = []
    for r in sorted(backtest, key=lambda x: x.rid):
        rows.append({
            "request_id": r.rid, "requested_at": iso(r.at), "amount_eth": str(r.amount),
            "eth_ahead_at_request": str(r.start - finalized_before(r.at)), "eth_ahead_now": None,
            "finalized_at": finalized_at(r), "role": "backtest",
        })
    for r, role in ((demo, "demo"), (tail, "open")):
        rows.append({
            "request_id": r.rid, "requested_at": iso(r.at), "amount_eth": str(r.amount),
            "eth_ahead_at_request": None, "eth_ahead_now": str(r.start - finalized),
            "finalized_at": None, "role": role,
        })

    meta = {
        "synthetic": True,
        "seed": SEED,
        "generator": "evals/fixture/tools/gen_data.py",
        "unit": "ETH as decimal strings, never floats",
        "frame_cadence": "one oracle frame per day at 12:00 UTC",
        "note": "Synthetic data for a rehearsal fixture. It describes no real protocol and no real request.",
    }
    capacities = [Decimal(f["capacity_eth"]) for f in frames]
    summary = {
        "frames": len(frames),
        "median_capacity_last7_eth": str(statistics.median(capacities[-7:])),
        "unfinalized_eth_last_frame": snapshots[-1]["unfinalized_eth"],
        "demo_request": {"request_id": demo.rid, "eth_ahead_now": str(demo.start - finalized)},
        "backtest_rows": len(backtest),
        "backtest_unfinalized": [r.rid for r in backtest if finalized_at(r) is None],
        "requests_generated": len(reqs),
    }
    return ({"meta": meta, "frames": frames}, {"meta": meta, "snapshots": snapshots},
            {"meta": meta, "requests": rows}, summary)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write('{"level":"error","module":"gen_data","msg":"usage: gen_data.py <out_dir>"}\n')
        return 2
    out = Path(argv[0])
    out.mkdir(parents=True, exist_ok=True)
    series, snaps, requests, summary = generate()
    write_json(out / "exit-rate-series.json", series)
    write_json(out / "queue-snapshots.json", snaps)
    write_json(out / "requests.json", requests)
    sys.stdout.write(json.dumps(summary, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
