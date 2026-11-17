"""Deterministic scheduling: CPM, the dispatcher, Monte Carlo, zones, cuts, the build-complete deadline.

Contract: MODULES.md 4 (`schedule.py`), CLI.md `schedule` and `simulate`, SCHEMAS.md 4.2 (planned <-> ready, failed ->
ready), 7.4 (runtime overlap), ARCHITECTURE.md 7. Every random draw goes through `random.Random(seed)`; every
iteration over a set or a dict that reaches an output is sorted, so outputs never depend on PYTHONHASHSEED.

Model used by the dispatcher (parallel schedule generation, priority = latest start, then the longest remaining
path, then the number of direct successors, then the numeric id):
- an agent task holds one writing lane, its resources and its write globs for its implementation time (with the
  extra implement-plus-verify cycles of failed attempts); its final verification follows without holding a lane; its
  dependents start once it is verified;
- a human task (manual, decision) holds `human:<owner>` from the moment it is posted; the owner's response latency
  elapses inside awake windows only, then the work runs inside one window long enough for it (a task never runs
  across a sleep, talk, travel or away window; it waits for the next window that fits);
- `browser` holders are limited to the browser slots; every other resource (ordered or serialized) has one holder;
- two tasks that no dependency path joins never run together when their write globs intersect.

Lane-rule deviation (reported as contract question Q-B03-1): MODULES.md 8 gives this module no `locks` edge although
CLI.md `schedule` runs under the state lock; the lock is reached through `statusio.locks` (statusio's own import),
never through an import of this module. The schema checks of the cross-executor evidence (`_schema_problem`) reach
`statusio.schema` the same way.
"""
from __future__ import annotations

import dataclasses
import json
import math
import random
import re
from argparse import Namespace
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from statistics import NormalDist
from types import MappingProxyType
from typing import Any, Iterator, Mapping, Sequence

from . import clock, events, globs, jsonio, resources, statusio
from . import plan as planmod
from .errors import InternalError, UsageError, ValidationFailed
from .graph import Graph
from .log import get_logger
from .model import CommandResult, Ctx, Deadline, Estimate, PlanModel, Task
from .paths import skill_path

_LOG = get_logger("execlib.schedule")
_ND = NormalDist()
Z90 = 1.2816                       # MODULES.md 4: sigma = ln(p90/p50) / 1.2816
Z80 = _ND.inv_cdf(0.8)             # 0.8416212335729143
EPS = 1e-9
FINISHED = frozenset({"done", "cut", "superseded"})
IN_FLIGHT = frozenset({"running"})
POST_ONLY = frozenset({"built", "verifying"})
WAITING = frozenset({"blocked-manual", "blocked-decision"})
BUILD_PHASES = frozenset({"setup", "contract", "build", "integrate", "verify"})
GATE_BUILD_TEMPLATE = "execution:EX-GATE-BUILD"
SAMPLES_RANGE = (500, 2000)
REFERENCE_PATH = skill_path("assets", "reference-class.json")
_TASK_ANCHOR = re.compile(r"^(T[0-9]{3,})\.(ready|done)$")


# --- reference class --------------------------------------------------------------------------------------------

def _load_reference(path: Path = REFERENCE_PATH) -> dict:
    """assets/reference-class.json, checked for the fields this module reads (InternalError otherwise: a skill bug)."""
    doc = jsonio.read_json(path)
    try:
        for name in ("build", "verify", "research", "manual", "human_response"):
            est = doc["classes"][name]
            if not 0 <= float(est["p10_min"]) <= float(est["p50_min"]) <= float(est["p90_min"]):
                raise ValueError(f"class {name}: p10 <= p50 <= p90 broken")
        bc = doc["build_complete"]
        for key in ("base_min", "per_kloc_min", "clamp_min", "clamp_max", "factor"):
            float(bc["harden"][key])
        float(bc["fix_wave"]["p50_min"]), float(bc["fix_wave"]["p90_min"]), float(bc["buffer_min"])
        for comp in bc["deliverables"].values():
            float(comp["p50_min"]), float(comp["p90_min"])
        for kind, value in doc["failure_probability"].items():
            if kind != "basis" and not 0.0 <= float(value) <= 1.0:
                raise ValueError(f"failure probability of {kind} outside [0, 1]")
    except (KeyError, TypeError, ValueError) as err:
        raise InternalError(f"{path.as_posix()} is malformed: {err}") from err
    return doc


REFERENCE: Mapping[str, Any] = MappingProxyType(_load_reference())
REFERENCE_CLASS: Mapping[str, Estimate] = MappingProxyType({
    name: Estimate(float(v["p10_min"]), float(v["p50_min"]), float(v["p90_min"]), f"reference-class:{name}")
    for name, v in sorted(REFERENCE["classes"].items())})


# --- distributions ------------------------------------------------------------------------------------------------

def lognormal(p50: float, p90: float) -> tuple[float, float]:
    """(mu, sigma) of the lognormal with this median and 0.9 quantile: mu = ln p50, sigma = ln(p90/p50)/1.2816.
    sigma is 0 when p90 <= p50; mu is -inf when p50 <= 0 (every sample is then 0)."""
    if p50 <= 0:
        return float("-inf"), 0.0
    if p90 <= p50:
        return math.log(p50), 0.0
    return math.log(p50), math.log(p90 / p50) / Z90


def quantile(p50: float, p90: float, z: float) -> float:
    """The lognormal quantile at standard-normal z (p50 itself when sigma is 0)."""
    mu, sigma = lognormal(p50, p90)
    if p50 <= 0:
        return 0.0
    if sigma == 0.0:
        return float(p50)
    return math.exp(mu + sigma * z)


def p80(p50: float, p90: float) -> float:
    return quantile(p50, p90, Z80)


class _Draw:
    """All randomness of one simulation: a private random.Random(seed), never the global generator."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)

    def lognormal(self, p50: float, p90: float) -> float:
        mu, sigma = lognormal(p50, p90)
        if p50 <= 0:
            return 0.0
        if sigma == 0.0:
            return float(p50)
        return math.exp(mu + sigma * self.rng.gauss(0.0, 1.0))

    def conditional_total(self, p50: float, p90: float, elapsed: float) -> float:
        """A total duration drawn from the lognormal truncated below at `elapsed` (inverse-CDF sampling)."""
        mu, sigma = lognormal(p50, p90)
        if p50 <= 0:
            return max(elapsed, 0.0)
        if sigma == 0.0:
            return max(float(p50), elapsed)
        if elapsed <= 0:
            return self.lognormal(p50, p90)
        low = _ND.cdf((math.log(elapsed) - mu) / sigma)
        u = low + (1.0 - low) * self.rng.random()
        u = min(max(u, 1e-12), 1.0 - 1e-12)
        return max(math.exp(mu + sigma * _ND.inv_cdf(u)), elapsed)

    def remaining(self, p50: float, p90: float, elapsed: float) -> float:
        """Remaining minutes of a task already `elapsed` minutes in: conditional total minus elapsed."""
        return max(self.conditional_total(p50, p90, elapsed) - max(elapsed, 0.0), 0.0)

    def chance(self, p: float) -> bool:
        return self.rng.random() < p


def _pct(sorted_values: Sequence[float], q: float) -> float:
    """Nearest-rank percentile of an ascending list (0.0 for an empty one)."""
    if not sorted_values:
        return 0.0
    idx = max(0, math.ceil(q * len(sorted_values)) - 1)
    return float(sorted_values[min(idx, len(sorted_values) - 1)])


def _r(x: float, nd: int = 2) -> float:
    """Rounded for output (stable bytes)."""
    return round(float(x) + 0.0, nd)


# --- small readers ------------------------------------------------------------------------------------------------

def _num(tid: str) -> int:
    return int(tid[1:]) if tid[1:].isdigit() else 1 << 62


def _status(task_id: str, statuses: Mapping[str, dict], plan: PlanModel) -> str:
    return statusio.state_of(task_id, statuses, plan).status


def _entry(task_id: str, statuses: Mapping[str, dict], plan: PlanModel) -> dict:
    return statusio.state_of(task_id, statuses, plan).raw


def _est_pair(raw: Any) -> tuple[float, float] | None:
    """(p50, p90) from {p50_min, p90_min} or /frontend's {p50, p90}; None when absent or malformed."""
    if not isinstance(raw, Mapping):
        return None
    try:
        if "p50_min" in raw:
            return float(raw["p50_min"]), float(raw.get("p90_min", raw["p50_min"]))
        if "p50" in raw:
            return float(raw["p50"]), float(raw.get("p90", raw["p50"]))
    except (TypeError, ValueError):
        return None
    return None


def _profile_utc(profile: Mapping | None, *keys: str) -> datetime | None:
    node: Any = profile or {}
    for k in keys:
        node = node.get(k) if isinstance(node, Mapping) else None
    return clock.parse_utc(node) if isinstance(node, str) else None


def task_anchor_ref(task: Task) -> tuple[str, str, float] | None:
    """(task id, 'ready'|'done', offset_min) when the task is anchored on another task; else None."""
    anchor = task.anchor or {}
    m = _TASK_ANCHOR.match(str(anchor.get("relative_to", "")))
    if not m:
        return None
    return m.group(1), m.group(2), float(anchor.get("offset_min", 0))


def static_release(task: Task, plan: PlanModel, profile: Mapping | None) -> tuple[datetime | None, bool]:
    """(release instant, resolvable). A task anchor (Tnnn.ready|done) is dynamic: (None, True). An event or
    deadline anchor whose base is unknown (no profile, no such deadline) is (None, False)."""
    anchor = task.anchor
    if not anchor:
        return task.release, True
    ref = str(anchor.get("relative_to", ""))
    offset = timedelta(minutes=float(anchor.get("offset_min", 0)))
    base: datetime | None
    if ref == "event.start":
        base = _profile_utc(profile, "event", "start_utc")
    elif ref == "event.deadline":
        base = _profile_utc(profile, "event", "deadline_utc")
    elif ref.startswith("DL-"):
        base = next((d.at for d in plan.deadlines if d.id == ref), None)
    elif _TASK_ANCHOR.match(ref):
        return None, True
    else:
        base = None
    if base is None:
        return None, False
    return base + offset, True


def _transition_time(entry: Mapping, to: str) -> datetime | None:
    """The first instant the status entry moved to `to` (history), or since_utc when it is there with no record."""
    for h in entry.get("history") or ():
        if h.get("to") == to:
            return clock.parse_utc(h["at_utc"])
    if entry.get("status") == to and entry.get("since_utc"):
        return clock.parse_utc(entry["since_utc"])
    return None


def release_now(task: Task, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping | None
                ) -> tuple[datetime | None, bool]:
    """The release instant known now (task anchors resolved from the anchor task's history); (None, False) when it
    cannot be computed yet."""
    ref = task_anchor_ref(task)
    if ref is None:
        return static_release(task, plan, profile)
    tid, which, offset = ref
    if tid not in plan.by_id:
        return None, False
    at = _transition_time(_entry(tid, statuses, plan), "done" if which == "done" else "ready")
    if which == "ready" and at is None and _status(tid, statuses, plan) not in ("planned",):
        # past ready without a record (e.g. imported state): its since_utc is the best known instant
        at = clock.parse_utc(_entry(tid, statuses, plan).get("since_utc") or statusio.EPOCH_UTC)
    if at is None:
        return None, False
    return at + timedelta(minutes=offset), True


# --- precedence ---------------------------------------------------------------------------------------------------

def _preds(plan: PlanModel, ids: frozenset[str]) -> dict[str, list[tuple[str, str, float]]]:
    """task -> [(pred, 'fs'|'ss', lag_min)]: dependencies (fs, 0) and task anchors (.done fs / .ready ss with the
    anchor's offset). Predecessors outside `ids` are kept (they count as satisfied at offset 0)."""
    out: dict[str, list[tuple[str, str, float]]] = {}
    for t in plan.tasks:
        if t.id not in ids:
            continue
        items = [(d, "fs", 0.0) for d in sorted(set(t.depends_on), key=_num) if d in plan.by_id]
        ref = task_anchor_ref(t)
        if ref is not None and ref[0] in plan.by_id and ref[0] != t.id:
            items.append((ref[0], "fs" if ref[1] == "done" else "ss", ref[2]))
        out[t.id] = items
    return out


def _topo(ids: Sequence[str], preds: Mapping[str, list[tuple[str, str, float]]]) -> list[str]:
    """Kahn's order over `ids` with ties by numeric id; an anchor edge that would close a cycle is dropped."""
    idset = set(ids)
    indeg = {t: 0 for t in ids}
    succ: dict[str, list[str]] = {t: [] for t in ids}
    for t in ids:
        for p, _k, _l in preds.get(t, ()):
            if p in idset and p != t:
                indeg[t] += 1
                succ[p].append(t)
    ready = sorted((t for t in ids if indeg[t] == 0), key=_num)
    out: list[str] = []
    while ready:
        t = ready.pop(0)
        out.append(t)
        for s in sorted(succ[t], key=_num):
            indeg[s] -= 1
            if indeg[s] == 0:
                ready.append(s)
        ready.sort(key=_num)
    if len(out) != len(ids):
        seen = set(out)
        out.extend(sorted((t for t in ids if t not in seen), key=_num))
    return out


# --- CPM ----------------------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Cpm:
    es: Mapping[str, float]
    lf: Mapping[str, float]
    slack: Mapping[str, float]
    critical: tuple[str, ...]
    ef: Mapping[str, float] = field(default_factory=dict)
    ls: Mapping[str, float] = field(default_factory=dict)
    durations: Mapping[str, float] = field(default_factory=dict)
    remaining: Mapping[str, float] = field(default_factory=dict)
    project_end: float = 0.0


def cpm(plan: PlanModel, statuses: Mapping[str, dict], now: datetime, durations: Mapping[str, float], *,
        releases: Mapping[str, datetime | None] | None = None) -> Cpm:
    """Critical path in minutes from `now` over the tasks not done, cut or superseded. Forward pass with release
    times (not-started tasks) and task anchors; backward pass from the project end and each task's own
    `deadline_utc` (negative slack when a deadline cannot be met). Critical = the tasks whose slack equals the
    smallest slack when it is negative, else the zero-slack tasks; in topological order."""
    live = [t.id for t in plan.tasks if _status(t.id, statuses, plan) not in FINISHED]
    live_set = frozenset(live)
    preds = _preds(plan, live_set)
    order = _topo(live, preds)
    dur = {t: max(float(durations.get(t, plan.by_id[t].estimate.p50)), 0.0) for t in live}
    es: dict[str, float] = {}
    ef: dict[str, float] = {}
    for t in order:
        task = plan.by_id[t]
        state = _status(t, statuses, plan)
        start = 0.0
        if state not in IN_FLIGHT and state not in POST_ONLY:
            rel = releases.get(t) if releases is not None and t in releases else task.release
            if rel is not None:
                start = max(start, clock.minutes_between(now, rel))
            for p, kind, lag in preds[t]:
                if p not in live_set:
                    continue
                start = max(start, (ef[p] if kind == "fs" else es[p]) + lag)
        es[t] = start
        ef[t] = start + dur[t]
    end = max(ef.values(), default=0.0)
    succ: dict[str, list[tuple[str, str, float]]] = {t: [] for t in live}
    for t in live:
        for p, kind, lag in preds[t]:
            if p in live_set:
                succ[p].append((t, kind, lag))
    lf: dict[str, float] = {}
    ls: dict[str, float] = {}
    for t in reversed(order):
        task = plan.by_id[t]
        finish = end
        if task.deadline is not None:
            finish = min(finish, clock.minutes_between(now, task.deadline))
        for s, kind, lag in succ[t]:
            finish = min(finish, (ls[s] - lag) if kind == "fs" else (ls[s] - lag + dur[t]))
        lf[t] = finish
        ls[t] = finish - dur[t]
    slack = {t: lf[t] - ef[t] for t in live}
    floor = min(0.0, min(slack.values(), default=0.0))
    critical = tuple(t for t in order if slack[t] <= floor + 1e-6)
    graph = Graph.of(plan)
    full = {t.id: dur.get(t.id, 0.0) for t in plan.tasks}
    remaining = {t: graph.remaining_path_min(t, full) for t in live}
    return Cpm(es=MappingProxyType(es), lf=MappingProxyType(lf), slack=MappingProxyType(slack), critical=critical,
               ef=MappingProxyType(ef), ls=MappingProxyType(ls), durations=MappingProxyType(dur),
               remaining=MappingProxyType(remaining), project_end=end)


def priority_key(task: Task, cpm: Cpm, graph: Graph) -> tuple:
    """(latest start, -remaining path, -direct successors, numeric id): smaller first."""
    return (round(cpm.ls.get(task.id, 0.0), 6), -round(cpm.remaining.get(task.id, 0.0), 6),
            -graph.successors_count(task.id), task.num)


# --- calendars ----------------------------------------------------------------------------------------------------

def calendars_from_profile(profile: Mapping | None) -> dict[str, list[tuple[datetime, datetime]]]:
    """dev id -> awake windows minus every sleep/talk/travel/away window, merged and sorted. A dev with no
    availability entry is absent (no constraint)."""
    out: dict[str, list[tuple[datetime, datetime]]] = {}
    devs = ((profile or {}).get("team") or {}).get("devs") or []
    for dev in sorted(devs, key=lambda d: str(d.get("id"))):
        avail = dev.get("availability") or []
        if not avail:
            continue
        awake = sorted((clock.parse_utc(a["start_utc"]), clock.parse_utc(a["end_utc"]))
                       for a in avail if a.get("kind") == "awake")
        other = sorted((clock.parse_utc(a["start_utc"]), clock.parse_utc(a["end_utc"]))
                       for a in avail if a.get("kind") != "awake")
        windows: list[tuple[datetime, datetime]] = []
        for a, b in awake:
            pieces = [(a, b)]
            for c, d in other:
                nxt: list[tuple[datetime, datetime]] = []
                for x, y in pieces:
                    if d <= x or c >= y:
                        nxt.append((x, y))
                        continue
                    if c > x:
                        nxt.append((x, c))
                    if d < y:
                        nxt.append((d, y))
                pieces = nxt
            windows.extend(p for p in pieces if p[1] > p[0])
        windows.sort()
        merged: list[tuple[datetime, datetime]] = []
        for w in windows:
            if merged and w[0] <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], w[1]))
            else:
                merged.append(w)
        out[str(dev.get("id"))] = merged
    return out


def _advance_awake(t: float, minutes: float, windows: Sequence[tuple[float, float]] | None) -> float:
    """t plus `minutes` counted inside the windows only (unconstrained without windows or past the last one)."""
    if minutes <= 0:
        return t
    if not windows:
        return t + minutes
    left = minutes
    cur = t
    for a, b in windows:
        if b <= cur:
            continue
        s = max(cur, a)
        if b - s >= left:
            return s + left
        left -= b - s
        cur = b
    return cur + left


def _fit(t: float, dur: float, windows: Sequence[tuple[float, float]] | None) -> float:
    """The earliest start >= t such that [start, start + dur] lies inside one window. Without windows, or when no
    window can hold the task, the task starts at t (a calendar that cannot hold it is P-14's warning)."""
    if not windows:
        return t
    for a, b in windows:
        s = max(t, a)
        if s + dur <= b + EPS:
            return s
    return t


# --- the dispatcher -----------------------------------------------------------------------------------------------

@dataclass
class _Item:
    task: Task
    human: bool
    impl: float
    post: float
    latency: float
    in_flight: bool
    release: float | None
    preds: list[tuple[str, str, float]]


@dataclass
class _Run:
    start: dict[str, float]
    hold_end: dict[str, float]
    finish: dict[str, float]
    ready: dict[str, float]
    binding: dict[str, str | None]


def _dispatch_offsets(items: Mapping[str, _Item], order: Sequence[str], *, lanes: int, browser_slots: int,
                      windows: Mapping[str, list[tuple[float, float]]], graph: Graph) -> _Run:
    """Parallel schedule generation in minutes from now. `order` is the static priority order of `items`."""
    lanes = max(1, int(lanes))
    browser_slots = max(1, int(browser_slots))
    run = _Run(start={}, hold_end={}, finish={}, ready={}, binding={})
    holding: list[str] = []

    def ready_time(tid: str) -> float | None:
        if tid in run.ready:
            return run.ready[tid]
        it = items[tid]
        at = max(it.release, 0.0) if it.release is not None else 0.0
        bind: str | None = None
        for p, kind, lag in it.preds:
            if p not in items:
                at = max(at, lag)
                continue
            if kind == "fs":
                if p not in run.finish:
                    return None
                cand = run.finish[p] + lag
            else:
                pr = ready_time(p)
                if pr is None:
                    return None
                cand = pr + lag
            if cand > at + EPS or (bind is None and abs(cand - at) <= EPS and cand > 0):
                at = max(at, cand)
                bind = p
        run.ready[tid] = at
        run.binding[tid] = bind
        return at

    def holds(tid: str) -> list[str]:
        it = items[tid]
        res = list(it.task.resources)
        if it.human:
            res.append(f"human:{it.task.owner}")
        return res

    def can_start(tid: str, active: list[str]) -> bool:
        it = items[tid]
        if not it.human and sum(1 for a in active if not items[a].human) >= lanes:
            return False
        for r in holds(tid):
            kind = resources.parse(r).kind if not r.startswith("human:") else "human"
            users = [a for a in active if r in holds(a)]
            if kind == "browser":
                if len(users) >= browser_slots:
                    return False
            elif users:
                return False
        if it.task.writes:
            for a in active:
                other = items[a].task
                if other.writes and not graph.joined(a, tid) and globs.overlapping(it.task.writes, other.writes):
                    return False
        return True

    def start(tid: str, t: float) -> None:
        it = items[tid]
        if it.human:
            begin = _fit(_advance_awake(t, it.latency, windows.get(it.task.owner)), it.impl,
                         windows.get(it.task.owner))
            run.start[tid] = begin
            run.hold_end[tid] = begin + it.impl
            run.finish[tid] = begin + it.impl
        else:
            run.start[tid] = t
            run.hold_end[tid] = t + it.impl
            run.finish[tid] = t + it.impl + it.post
        holding.append(tid)

    pending = [tid for tid in order if tid in items]
    for tid in [p for p in pending if items[p].in_flight]:
        run.ready[tid] = 0.0
        run.binding[tid] = None
        start(tid, 0.0)
        pending.remove(tid)
    t = 0.0
    while pending:
        progressed = True
        while progressed:
            progressed = False
            active = [a for a in holding if run.hold_end[a] > t + EPS]
            for tid in pending:
                rt = ready_time(tid)
                if rt is None or rt > t + EPS:
                    continue
                if can_start(tid, active):
                    start(tid, t)
                    pending.remove(tid)
                    progressed = True
                    break
        if not pending:
            break
        cands = [run.hold_end[a] for a in holding if run.hold_end[a] > t + EPS]
        cands += [f for f in run.finish.values() if f > t + EPS]
        for tid in pending:
            rt = ready_time(tid)
            if rt is not None and rt > t + EPS:
                cands.append(rt)
        if not cands:
            raise InternalError("the dispatcher cannot place " + ", ".join(pending[:5]),
                                hint="a task waits on a predecessor that never finishes")
        t = min(cands)
    return run


def dispatch(plan: PlanModel, statuses: Mapping[str, dict], *, now: datetime, lanes: int,
             durations: Mapping[str, float], calendars: Mapping[str, list[tuple[datetime, datetime]]],
             browser_slots: int, releases: Mapping[str, datetime | None] | None = None,
             post: Mapping[str, float] | None = None, latencies: Mapping[str, float] | None = None
             ) -> dict[str, tuple[datetime, datetime]]:
    """{task: (start, end)} for every task not done, cut or superseded. `durations` are the implementation
    minutes (remaining minutes for a running task), `post` the verification minutes that follow without a lane,
    `latencies` the owners' response minutes of human tasks (inside awake windows); `releases` overrides
    `release_utc` (computed anchors). Priorities come from the CPM on durations + post."""
    items, order, graph = _prepare(plan, statuses, now=now, durations=durations, post=post or {},
                                   latencies=latencies or {}, releases=releases)
    windows = _window_offsets(calendars, now)
    run = _dispatch_offsets(items, order, lanes=lanes, browser_slots=browser_slots, windows=windows, graph=graph)
    return {tid: (now + timedelta(minutes=run.start[tid]), now + timedelta(minutes=run.finish[tid]))
            for tid in sorted(run.start, key=_num)}


def _window_offsets(calendars: Mapping[str, list[tuple[datetime, datetime]]], now: datetime
                    ) -> dict[str, list[tuple[float, float]]]:
    return {dev: [(clock.minutes_between(now, a), clock.minutes_between(now, b)) for a, b in ws]
            for dev, ws in sorted(calendars.items())}


def _prepare(plan: PlanModel, statuses: Mapping[str, dict], *, now: datetime, durations: Mapping[str, float],
             post: Mapping[str, float], latencies: Mapping[str, float],
             releases: Mapping[str, datetime | None] | None) -> tuple[dict[str, _Item], list[str], Graph]:
    live = [t for t in plan.tasks if _status(t.id, statuses, plan) not in FINISHED]
    preds = _preds(plan, frozenset(t.id for t in live))
    items: dict[str, _Item] = {}
    for t in live:
        state = _status(t.id, statuses, plan)
        rel = releases.get(t.id) if releases is not None and t.id in releases else t.release
        started = state in IN_FLIGHT or state in POST_ONLY
        items[t.id] = _Item(task=t, human=t.is_human, impl=max(float(durations.get(t.id, t.estimate.p50)), 0.0),
                            post=max(float(post.get(t.id, 0.0)), 0.0),
                            latency=max(float(latencies.get(t.id, 0.0)), 0.0), in_flight=started,
                            release=None if (rel is None or started) else clock.minutes_between(now, rel),
                            preds=[] if started else preds[t.id])
    graph = Graph.of(plan)
    total = {tid: it.impl + it.post + (it.latency if it.human else 0.0) for tid, it in items.items()}
    cp = cpm(plan, statuses, now, total, releases=releases)
    order = sorted(items, key=lambda tid: priority_key(plan.by_id[tid], cp, graph))
    return items, order, graph


# --- deadlines and Monte Carlo ------------------------------------------------------------------------------------

def deadline_scope(plan: PlanModel, deadline: Deadline) -> list[str]:
    """The tasks that must be finished by `deadline`: tasks whose own deadline_utc is at or before it; for a
    build-complete deadline also the EX-GATE-BUILD task (or, without one, every required task of phases setup,
    contract, build, integrate and verify); for a submission deadline every task of the plan."""
    ids = {t.id for t in plan.tasks if t.deadline is not None and t.deadline <= deadline.at}
    if deadline.kind == "build-complete":
        gates = [t.id for t in plan.tasks if t.template == GATE_BUILD_TEMPLATE]
        ids |= set(gates) if gates else {t.id for t in plan.tasks if t.required and t.phase in BUILD_PHASES}
    elif deadline.kind == "submission":
        ids |= {t.id for t in plan.tasks}
    return sorted(ids, key=_num)


def _calib(calibration: Mapping[str, float], key: str, default: float) -> float:
    value = calibration.get(key)
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else default


def _what_if(what_if: Mapping | None) -> tuple[frozenset[str], dict[str, float], int | None]:
    if what_if is None:
        return frozenset(), {}, None
    if not isinstance(what_if, Mapping) or set(what_if) - {"cut", "scale", "lanes"}:
        raise ValidationFailed("--what-if must be an object with only cut, scale and lanes", code="E_SCHEMA")
    cut = what_if.get("cut") or []
    scale = what_if.get("scale") or {}
    lanes = what_if.get("lanes")
    if not isinstance(cut, list) or not all(isinstance(c, str) and re.match(r"^T[0-9]{3,}$", c) for c in cut):
        raise ValidationFailed("--what-if cut must be a list of task ids", code="E_SCHEMA")
    if not isinstance(scale, Mapping) or not all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 for v in scale.values()):
        raise ValidationFailed("--what-if scale must map task ids or kinds to positive factors", code="E_SCHEMA")
    if lanes is not None and (isinstance(lanes, bool) or not isinstance(lanes, int) or lanes < 1):
        raise ValidationFailed("--what-if lanes must be an integer >= 1", code="E_SCHEMA")
    return frozenset(cut), {str(k): float(v) for k, v in scale.items()}, lanes


def _apply_cuts(statuses: Mapping[str, dict], plan: PlanModel, cut: frozenset[str]) -> dict[str, dict]:
    if not cut:
        return dict(statuses)
    out: dict[str, dict] = {}
    for ex in ("A", "B"):
        doc = dict(statuses.get(ex) or statusio.default_doc(ex))
        tasks = dict(doc.get("tasks") or {})
        for tid in sorted(cut):
            task = plan.by_id.get(tid)
            if task is not None and task.executor == ex:
                tasks[tid] = {"status": "cut", "since_utc": statusio.EPOCH_UTC, "attempts": 0, "history": []}
        doc["tasks"] = tasks
        out[ex] = doc
    return out


def _elapsed(entry: Mapping, now: datetime) -> float:
    actual = entry.get("actual") or {}
    started = actual.get("started_utc") or entry.get("since_utc")
    if not started:
        return 0.0
    return max(clock.minutes_between(clock.parse_utc(started), now), 0.0)


def simulate(plan: PlanModel, statuses: Mapping[str, dict], profile: dict, *, samples: int, seed: int, lanes: int,
             now: datetime, calibration: Mapping[str, float], what_if: dict | None = None,
             browser_slots: int | None = None) -> dict:
    """Monte Carlo through the dispatcher (module docstring). `calibration` keys: `<kind>` duration ratio
    (actual/p50), `fail.<kind>` failure probability per attempt, `human_response_p50|p90`, `verify_p50|p90`
    (minutes; defaults from assets/reference-class.json). Returns {now_utc, seed, samples, lanes, browser_slots,
    makespan_min {p50,p80,p90}, histogram [[bin start min, count]], deadlines {id: {at_utc, tasks, p_on_time,
    p50_min, p80_min, p90_min}}, criticality {task: index}, agent_hours {p50,p80,p90}}."""
    if samples < 1:
        raise UsageError("samples must be >= 1")
    cut, scale, lanes_override = _what_if(what_if)
    statuses = _apply_cuts(statuses, plan, cut)
    lanes = lanes_override or lanes
    if browser_slots is None:
        browser_slots = int(((profile or {}).get("machine") or {}).get("browser_slots") or 1)
    ref = REFERENCE_CLASS
    hr = (_calib(calibration, "human_response_p50", ref["human_response"].p50),
          _calib(calibration, "human_response_p90", ref["human_response"].p90))
    default_verify = (_calib(calibration, "verify_p50", ref["verify"].p50),
                      _calib(calibration, "verify_p90", ref["verify"].p90))
    fail_default = REFERENCE["failure_probability"]
    windows = _window_offsets(calendars_from_profile(profile), now)
    live = [t for t in plan.tasks if _status(t.id, statuses, plan) not in FINISHED]
    releases: dict[str, datetime | None] = {}
    for t in live:
        rel, ok = static_release(t, plan, profile)
        if not ok:
            _LOG.warning("anchor base unknown: released now in the simulation",
                         extra={"data": {"task": t.id, "anchor": t.anchor}})
        releases[t.id] = rel
    specs: list[dict] = []
    for t in live:
        entry = _entry(t.id, statuses, plan)
        state = str(entry.get("status") or "planned")
        factor = scale.get(t.id, scale.get(t.kind, 1.0)) * _calib(calibration, t.kind, 1.0)
        verify = _est_pair((t.raw.get("params") or {}).get("verify_estimate")) or default_verify
        specs.append({
            "task": t, "state": state, "factor": factor, "verify": verify,
            "fail": min(max(_calib(calibration, f"fail.{t.kind}", float(fail_default.get(t.kind, 0.0))), 0.0), 1.0),
            "extra": max(int(t.max_attempts) - 1 - int(entry.get("attempts", 0) or 0), 0),
            "elapsed": _elapsed(entry, now) if state in IN_FLIGHT or state in POST_ONLY else 0.0,
        })
    graph = Graph.of(plan)
    # static priorities: CPM on the calibrated medians (implementation + verification, or latency + work)
    med: dict[str, float] = {}
    for s in specs:
        t = s["task"]
        if t.is_human:
            med[t.id] = hr[0] + t.estimate.p50 * s["factor"]
        elif s["state"] in POST_ONLY:
            med[t.id] = s["verify"][0]
        else:
            med[t.id] = t.estimate.p50 * s["factor"] + s["verify"][0]
    cp = cpm(plan, statuses, now, med, releases=releases)
    order = sorted((s["task"].id for s in specs), key=lambda tid: priority_key(plan.by_id[tid], cp, graph))
    scopes = {d.id: deadline_scope(plan, d) for d in plan.deadlines}
    live_ids = {t.id for t in live}
    all_preds = _preds(plan, frozenset(live_ids))
    owner_dev = next((str(d.get("id")) for d in ((profile or {}).get("team") or {}).get("devs") or []
                      if d.get("executor") == "A"), "devA")
    draw = _Draw(seed)
    makespans: list[float] = []
    agent_minutes: list[float] = []
    finishes: dict[str, list[float]] = {d: [] for d in scopes}
    crit_count: dict[str, int] = {t.id: 0 for t in live}
    for _k in range(samples):
        items: dict[str, _Item] = {}
        busy = 0.0
        for s in specs:
            t: Task = s["task"]
            state = s["state"]
            p50, p90 = t.estimate.p50 * s["factor"], t.estimate.p90 * s["factor"]
            rel_dt = releases.get(t.id)
            rel = clock.minutes_between(now, rel_dt) if rel_dt is not None else None
            latency = 0.0
            post = 0.0
            if t.is_human:
                if state in IN_FLIGHT:
                    latency = draw.remaining(hr[0], hr[1], s["elapsed"])
                else:
                    latency = draw.lognormal(*hr)
                impl = draw.lognormal(p50, p90)
            else:
                if state in POST_ONLY:
                    impl = 0.0
                    post = (draw.remaining(*s["verify"], s["elapsed"]) if state == "verifying"
                            else draw.lognormal(*s["verify"]))
                else:
                    impl = draw.remaining(p50, p90, s["elapsed"]) if state in IN_FLIGHT else draw.lognormal(p50, p90)
                    for _x in range(s["extra"]):
                        if not draw.chance(s["fail"]):
                            break
                        impl += draw.lognormal(*s["verify"]) + draw.lognormal(p50, p90)
                    post = draw.lognormal(*s["verify"])
                busy += impl + post
            if state in WAITING:
                # a blocked task waits for the owner's answer (dev A answers decisions) inside awake windows
                wait = draw.lognormal(*hr)
                rel = max(rel or 0.0, _advance_awake(0.0, wait, windows.get(owner_dev)))
            started = state in IN_FLIGHT or state in POST_ONLY
            items[t.id] = _Item(task=t, human=t.is_human, impl=impl, post=post, latency=latency, in_flight=started,
                                release=None if started else rel, preds=[] if started else all_preds[t.id])
        run = _dispatch_offsets(items, order, lanes=lanes, browser_slots=browser_slots, windows=windows,
                                graph=graph)
        span = max(run.finish.values(), default=0.0)
        makespans.append(span)
        agent_minutes.append(busy)
        for d, ids in scopes.items():
            finishes[d].append(max((run.finish.get(x, 0.0) for x in ids if x in live_ids), default=0.0))
        if run.finish:
            cur: str | None = max(sorted(run.finish, key=_num), key=lambda x: run.finish[x])
            seen: set[str] = set()
            while cur is not None and cur not in seen:
                seen.add(cur)
                crit_count[cur] += 1
                cur = run.binding.get(cur)
    makespans.sort()
    agent_minutes.sort()
    deadlines_out: dict[str, dict] = {}
    for d in sorted(plan.deadlines, key=lambda x: (x.at, x.id)):
        ids = scopes[d.id]
        if not ids:
            continue
        vals = sorted(finishes[d.id])
        limit = clock.minutes_between(now, d.at)
        on_time = sum(1 for v in vals if v <= limit + EPS)
        deadlines_out[d.id] = {"at_utc": clock.format_utc(d.at), "tasks": len(ids),
                               "p_on_time": _r(on_time / samples, 6), "p50_min": _r(_pct(vals, 0.5)),
                               "p80_min": _r(_pct(vals, 0.8)), "p90_min": _r(_pct(vals, 0.9))}
    return {
        "now_utc": clock.format_utc(now), "seed": seed, "samples": samples, "lanes": lanes,
        "browser_slots": browser_slots,
        "makespan_min": {"p50": _r(_pct(makespans, 0.5)), "p80": _r(_pct(makespans, 0.8)),
                         "p90": _r(_pct(makespans, 0.9))},
        "histogram": _histogram(makespans),
        "deadlines": deadlines_out,
        "criticality": {tid: _r(crit_count[tid] / samples, 4) for tid in sorted(crit_count, key=_num)},
        "agent_hours": {"p50": _r(_pct(agent_minutes, 0.5) / 60.0, 3), "p80": _r(_pct(agent_minutes, 0.8) / 60.0, 3),
                        "p90": _r(_pct(agent_minutes, 0.9) / 60.0, 3)},
        "cut": sorted(cut, key=_num),
    }


def _histogram(sorted_values: Sequence[float]) -> list[list[float]]:
    """[[bin start minute, count]] with the smallest 'nice' width giving at most 30 bins."""
    if not sorted_values:
        return []
    lo, hi = sorted_values[0], sorted_values[-1]
    width = 120.0
    for w in (1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0):
        if (math.floor(hi / w) - math.floor(lo / w)) + 1 <= 30:
            width = w
            break
    counts: dict[float, int] = {}
    for v in sorted_values:
        b = math.floor(v / width + EPS) * width
        counts[b] = counts.get(b, 0) + 1
    return [[_r(b), c] for b, c in sorted(counts.items())]


def zones(sim: dict, deadlines: Sequence[Deadline], now: datetime) -> list[dict]:
    """[{deadline, p_on_time, p50_utc, p80_utc, p90_utc, zone}] for the deadlines the simulation measured, in time
    order: green when p_on_time >= 0.8, yellow from 0.5 to 0.8, red below 0.5."""
    out: list[dict] = []
    measured = sim.get("deadlines") or {}
    for d in sorted(deadlines, key=lambda x: (x.at, x.id)):
        m = measured.get(d.id)
        if m is None:
            continue
        p = float(m["p_on_time"])
        zone = "green" if p >= 0.8 else "yellow" if p >= 0.5 else "red"
        out.append({"deadline": d.id, "p_on_time": p, "zone": zone,
                    "p50_utc": clock.format_utc(now + timedelta(minutes=float(m["p50_min"]))),
                    "p80_utc": clock.format_utc(now + timedelta(minutes=float(m["p80_min"]))),
                    "p90_utc": clock.format_utc(now + timedelta(minutes=float(m["p90_min"])))})
    return out


# --- build-complete deadline --------------------------------------------------------------------------------------

def harden_p80_min(profile: Mapping | None, loc: int | None = None) -> float:
    """/harden's budget: profile.harden.budget_min_p80 when set, else factor x clamp(base + per_kloc x loc/1000,
    clamp_min, clamp_max) (HANDOVER.md H9; loc unknown counts as 0)."""
    budget = ((profile or {}).get("harden") or {}).get("budget_min_p80")
    if isinstance(budget, (int, float)) and not isinstance(budget, bool):
        return float(budget)
    h = REFERENCE["build_complete"]["harden"]
    raw = float(h["base_min"]) + float(h["per_kloc_min"]) * float(loc or 0) / 1000.0
    return float(h["factor"]) * min(max(raw, float(h["clamp_min"])), float(h["clamp_max"]))


def submission_instant(profile: Mapping | None, plan: PlanModel) -> datetime | None:
    """profile.event.deadline_utc, else the plan's earliest submission deadline."""
    at = _profile_utc(profile, "event", "deadline_utc")
    if at is not None:
        return at
    subs = sorted(d.at for d in plan.deadlines if d.kind == "submission")
    return subs[0] if subs else None


def _chain_p80(plan: PlanModel, ids: set[str]) -> float:
    """Longest path, by the sum of per-task P80 minutes, through the tasks `ids` (dependencies inside the set)."""
    best: dict[str, float] = {}
    for tid in Graph.of(plan).topo():
        if tid not in ids:
            continue
        t = plan.by_id[tid]
        before = max((best[d] for d in t.depends_on if d in best), default=0.0)
        best[tid] = before + p80(t.estimate.p50, t.estimate.p90)
    return max(best.values(), default=0.0)


def build_complete_breakdown(profile: Mapping | None, plan: PlanModel, harden_p80: float) -> dict:
    """Every input and output of the build-complete formula (ARCHITECTURE.md 7.3), minutes rounded to 0.01:
    deadline = submission - (harden P80 + fix wave P80 + deliverables P80 + buffer), floored to the minute;
    harden_end_latest = submission - after_harden (the fix wave, the deliverables and the buffer), floored."""
    bc = REFERENCE["build_complete"]
    fix_ids = {t.id for t in plan.tasks if t.phase == "fix"}
    deliv_ids = {t.id for t in plan.tasks if t.phase == "deliverable"}
    fix = _chain_p80(plan, fix_ids) if fix_ids else p80(float(bc["fix_wave"]["p50_min"]),
                                                       float(bc["fix_wave"]["p90_min"]))
    if deliv_ids:
        deliverables = _chain_p80(plan, deliv_ids)
        components = {"plan_deliverable_tasks": _r(deliverables)}
    else:
        components = {k: _r(p80(float(v["p50_min"]), float(v["p90_min"])))
                      for k, v in sorted(bc["deliverables"].items())}
        deliverables = sum(p80(float(v["p50_min"]), float(v["p90_min"])) for v in bc["deliverables"].values())
    buffer = float(bc["buffer_min"])
    after = fix + deliverables + buffer
    sub = submission_instant(profile, plan)
    out: dict[str, Any] = {"submission_utc": clock.format_utc(sub) if sub else None,
                           "harden_p80_min": _r(harden_p80), "fix_wave_p80_min": _r(fix),
                           "fix_wave_source": "plan" if fix_ids else "reference-class",
                           "deliverables_source": "plan" if deliv_ids else "reference-class",
                           "deliverable_components_p80_min": components, "buffer_min": _r(buffer),
                           "after_harden_min": _r(after), "deliverables_p80_min": _r(deliverables + buffer),
                           "deadline_utc": None, "harden_end_latest_utc": None}
    if sub is not None:
        deadline = sub - timedelta(minutes=harden_p80 + after)
        latest = sub - timedelta(minutes=after)
        out["deadline_utc"] = clock.format_utc(deadline.replace(second=0, microsecond=0))
        out["harden_end_latest_utc"] = clock.format_utc(latest.replace(second=0, microsecond=0))
    return out


def build_complete_deadline(profile: dict, plan: PlanModel, harden_p80_min: float) -> datetime:
    """The DL-build-complete instant (P-24); UsageError when there is no submission deadline."""
    b = build_complete_breakdown(profile, plan, harden_p80_min)
    if b["deadline_utc"] is None:
        raise UsageError("no submission deadline: profile.event.deadline_utc and the plan's submission deadline "
                         "are both absent")
    return clock.parse_utc(b["deadline_utc"])


# --- cuts and calibration -----------------------------------------------------------------------------------------

def cut_candidates(plan: PlanModel, statuses: Mapping[str, dict], sim: dict) -> list[str]:
    """Tasks the owner could cut, in the order optional (required false), then P3, then P2; never a P1 required
    task, never a task a live required task depends on, never a task on the must-have critical path (criticality
    >= 0.5 for a required task), never a task already running, built or verifying. Ties by numeric id."""
    graph = Graph.of(plan)
    crit = sim.get("criticality") or {}
    live = [t for t in plan.tasks if _status(t.id, statuses, plan) not in FINISHED]
    must_ancestors: set[str] = set()
    for t in live:
        if t.required:
            must_ancestors |= set(graph.ancestors(t.id))
    tiers: list[tuple[int, int, str]] = []
    for t in live:
        if _status(t.id, statuses, plan) in IN_FLIGHT | POST_ONLY | {"cut-proposed"}:
            continue
        if t.id in must_ancestors:
            continue
        if t.required and float(crit.get(t.id, 0.0)) >= 0.5:
            continue
        if not t.required:
            tier = 0
        elif t.priority == "P3":
            tier = 1
        elif t.priority == "P2":
            tier = 2
        else:
            continue
        tiers.append((tier, t.num, t.id))
    return [tid for _tier, _n, tid in sorted(tiers)]


def recalibrate(calibration: dict, done: Sequence[tuple[Task, float]]) -> dict:
    """The local-state calibration block recomputed from the COMPLETE list of done tasks with their actual minutes:
    ratios[kind] = geometric mean of actual/p50, samples[kind] = count; kinds without a done task keep their
    previous values; pct_per_agent_hour is kept. Passing the same list twice gives the same block (idempotent)."""
    ratios = dict((calibration or {}).get("ratios") or {})
    counts = dict((calibration or {}).get("samples") or {})
    logs: dict[str, list[float]] = {}
    for task, actual in done:
        if task.estimate.p50 <= 0 or actual is None or actual <= 0:
            continue
        logs.setdefault(task.kind, []).append(math.log(float(actual) / task.estimate.p50))
    for kind in sorted(logs):
        ratios[kind] = round(math.exp(sum(logs[kind]) / len(logs[kind])), 6)
        counts[kind] = len(logs[kind])
    return {"ratios": {k: ratios[k] for k in sorted(ratios)}, "samples": {k: counts[k] for k in sorted(counts)},
            "pct_per_agent_hour": (calibration or {}).get("pct_per_agent_hour")}


def calibration_from(local_state: Mapping | None, plan: PlanModel, statuses: Mapping[str, dict]) -> dict[str, float]:
    """simulate()'s calibration mapping: local-state duration ratios, plus per-kind failure probabilities measured
    from the status histories (transitions into failed over attempts that ended, at least 3 per kind)."""
    out: dict[str, float] = {}
    ratios = ((local_state or {}).get("calibration") or {}).get("ratios") or {}
    for kind in sorted(ratios):
        if isinstance(ratios[kind], (int, float)) and ratios[kind] > 0:
            out[kind] = float(ratios[kind])
    fails: dict[str, int] = {}
    ends: dict[str, int] = {}
    for t in plan.tasks:
        entry = _entry(t.id, statuses, plan)
        f = sum(1 for h in entry.get("history") or () if h.get("to") == "failed")
        d = 1 if entry.get("status") == "done" else 0
        if f or d:
            fails[t.kind] = fails.get(t.kind, 0) + f
            ends[t.kind] = ends.get(t.kind, 0) + f + d
    for kind in sorted(ends):
        if ends[kind] >= 3:
            out[f"fail.{kind}"] = round(fails[kind] / ends[kind], 6)
    return out


# --- readiness (planned <-> ready, failed -> ready) ---------------------------------------------------------------

def _task_raw(plan: PlanModel, tid: str) -> dict | None:
    for t in plan.raw.get("tasks") or ():
        if isinstance(t, dict) and t.get("id") == tid:
            return t
    return None


NC_KINDS: frozenset[str] = frozenset({"code", "test", "gate", "tx", "infra", "deploy", "watch", "research"})
"""Kinds whose negative control is required unless waived (SCHEMAS.md P-13; `not-applicable` is allowed only for
research, manual, decision, watch and a url-proof deploy). The same set as `status._NC_KINDS`."""
_RELAY_KEY = re.compile(r"-relay-[AB]$")
_DECISION_HEAD = "<!-- execution-decision "
_DECISION_TAIL = " -->"


def _schema_problem(doc: Any, name: str) -> str | None:
    """The first issue of `doc` against schema `name`, None when valid. The schema module is reached through
    statusio's own import, as `due` and `quota` do: MODULES.md 8 gives `schedule` no `schema` edge (Q-B03-1)."""
    report = statusio.schema.validate(doc, name)
    if report.ok:
        return None
    issue = report.issues[0]
    return f"{issue.instance_path or '/'}: {issue.message}"


def _read_quiet(path: Path) -> Any:
    """A JSON document, or None when the file is absent or is not JSON (a broken tracked copy is no evidence)."""
    try:
        return jsonio.read_json_retry(path)
    except FileNotFoundError:
        return None
    except ValidationFailed as err:
        _LOG.warning("tracked evidence copy is not JSON", extra={"data": {"path": path.as_posix(),
                                                                           "error": err.message}})
        return None


def _nc_required(dep: Task) -> bool:
    nc = (dep.proof or {}).get("negative_control") or {}
    return nc.get("kind") not in (None, "not-applicable") and dep.kind in NC_KINDS


def cross_receipt_problems(dep: Task, plan: PlanModel, layout: Any, entry: Mapping | None = None) -> list[str]:
    """The cross-executor done check of an agent task (TWO-DEV.md 5 #2, SCHEMAS.md 4.3 in its cross-executor profile)
    run on the tracked copies the other machine's `proof verdict` committed; empty when every condition holds.

    Checked, git-free: #1 the receipt validates against proof-receipt, names the task and has verdict pass; #2 the
    tracked merge copy `proofs/merge/<task>.a<attempt>.json` validates against merge-receipt, is `landed` with
    `landed_sha` equal to the receipt's SHA, the status `landed_sha` (when set) is the same SHA, and the receipt
    records `on_origin_main: true`; #3 `proof_hash` equals the current plan's `proof_digest`; #4 the cited run's
    tracked copy `proofs/runs/<task>/<run>.json` validates against proof-run, belongs to the task and SHA, has its
    expectation met and the receipt's exit code; #5 the verifier is an `execution-verifier` whose agent id is set and
    differs from the implementer's, and the implementer result the receipt names exists (or, when it names none, the
    landed merge copy stands for it); #6 the required negative control ran and failed as required (receipt, run copy,
    or recorded in the plan); #7 no skip marker added, no protected path touched. The one condition left to `status`
    is `git merge-base --is-ancestor <sha> origin/main` in this machine's product clone: it needs `gitutil`, an edge
    MODULES.md 8 does not give `schedule` (contract question Q-B03-2); `on_origin_main` is A's own record of it."""
    path = layout.receipt(dep.id)
    if not path.exists():
        return [f"no receipt {path.as_posix()}"]
    doc = _read_quiet(path)
    if not isinstance(doc, dict):
        return ["receipt is not a JSON object"]
    problems: list[str] = []
    invalid = _schema_problem(doc, "proof-receipt")
    if invalid:
        problems.append(f"#1 receipt invalid against proof-receipt: {invalid}")
    sha = doc.get("sha")
    if doc.get("task") != dep.id:
        problems.append(f"#1 receipt names task {doc.get('task')!r}")
    if doc.get("verdict") != "pass":
        problems.append(f"#1 verdict {doc.get('verdict')!r}")
    if not isinstance(sha, str) or not sha:
        return problems + ["#2 receipt has no sha"]
    # 2. tracked landed merge copy of the receipt's attempt, status landed_sha, A's origin/main record
    if doc.get("on_origin_main") is not True:
        problems.append("#2 sha not recorded on origin/main")
    attempt = doc.get("attempt")
    merge: Any = None
    if isinstance(attempt, int) and not isinstance(attempt, bool):
        mpath = layout.merge_copy(dep.id, attempt)
        merge = _read_quiet(mpath)
        if (not isinstance(merge, dict) or _schema_problem(merge, "merge-receipt") or merge.get("task") != dep.id
                or merge.get("outcome") != "landed" or merge.get("landed_sha") != sha):
            problems.append(f"#2 no valid landed merge copy {mpath.as_posix()} with landed_sha equal to the receipt sha")
            merge = None
    else:
        problems.append("#2 receipt has no attempt")
    status_sha = (entry or {}).get("landed_sha")
    if status_sha and status_sha != sha:
        problems.append("#2 receipt sha differs from the status landed_sha")
    # 3. proof hash of the current plan
    raw = _task_raw(plan, dep.id)
    if raw is None or doc.get("proof_hash") != planmod.proof_digest(raw):
        problems.append("#3 proof_hash differs from the current plan's proof digest")
    # 4. the cited run's tracked copy
    run_id = doc.get("run")
    run: Any = None
    if isinstance(run_id, str) and run_id:
        rpath = layout.proof_run_copy(dep.id, run_id)
        run = _read_quiet(rpath)
        if not isinstance(run, dict) or _schema_problem(run, "proof-run") or run.get("task") != dep.id \
                or run.get("run_id") != run_id:
            problems.append(f"#4 no valid run copy {rpath.as_posix()}")
            run = None
        else:
            if run.get("sha") != sha:
                problems.append("#4 the cited run is of another sha")
            if (run.get("expectation") or {}).get("met") is not True:
                problems.append("#4 pass verdict on a run whose expectation was not met")
            if doc.get("exit_code") is not None and run.get("exit_code") != doc.get("exit_code"):
                problems.append("#4 the run's exit code differs from the receipt's")
    else:
        problems.append("#4 receipt cites no run")
    # 5. verifier identity, implementer result
    by = doc.get("by") if isinstance(doc.get("by"), dict) else {}
    impl = doc.get("implementer") if isinstance(doc.get("implementer"), dict) else {}
    if by.get("agent_type") != "execution-verifier":
        problems.append(f"#5 verifier agent_type {by.get('agent_type')!r}")
    if not by.get("agent_id") or by.get("agent_id") == impl.get("agent_id"):
        problems.append("#5 verifier agent id missing or equal to the implementer's")
    if impl.get("result"):
        if not (layout.state / str(impl["result"])).is_file():
            problems.append(f"#5 the implementer result {impl['result']} does not exist")
    elif merge is None:
        problems.append("#5 no implementer result and no landed merge copy standing for it")
    # 6. negative control
    if _nc_required(dep):
        nc = doc.get("negative_control") if isinstance(doc.get("negative_control"), dict) else {}
        satisfied = bool(nc.get("ran")) and nc.get("met") is True
        if not satisfied and run is not None:
            rnc = run.get("negative_control") or {}
            satisfied = bool(rnc.get("ran")) and rnc.get("met") is True
        recorded = ((dep.proof or {}).get("negative_control") or {}).get("recorded")
        if not satisfied and isinstance(recorded, dict) and recorded.get("exit_code") not in (None, 0):
            satisfied = True
        if not satisfied:
            problems.append("#6 the required negative control did not run or did not fail as required")
    # 7. integrity
    integ = doc.get("integrity") if isinstance(doc.get("integrity"), dict) else {}
    if integ.get("skip_markers_added", 0) != 0:
        problems.append(f"#7 {integ.get('skip_markers_added')} skip markers added")
    if integ.get("protected_touched"):
        problems.append("#7 protected paths touched")
    return problems


def _answer_header(path: Path) -> dict | None:
    """The schema-valid header (first ```json fence) of an answers/<key>.md file, None when broken."""
    try:
        text = path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as err:
        _LOG.warning("answer file unreadable", extra={"data": {"path": path.as_posix(), "error": str(err)}})
        return None
    head = "```json\n"
    end = text.find("\n```\n", len(head) - 1)
    if not text.startswith(head) or end < 0:
        return None
    try:
        doc = json.loads(text[len(head):end + 1])
    except json.JSONDecodeError:
        return None
    return doc if isinstance(doc, dict) and _schema_problem(doc, "answer") is None else None


def _decision_records(layout: Any, decision_id: str) -> tuple[dict | None, dict | None]:
    """(proposal, resolution) of a decision id from the schema-valid `<!-- execution-decision {json} -->` headers of
    decisions.md (the last of each record kind wins, as an append-only union file is read)."""
    proposal = resolution = None
    path = layout.decisions
    if not decision_id or not path.exists():
        return None, None
    for line in path.read_bytes().decode("utf-8").split("\n"):
        line = line.rstrip("\r")
        if not line.startswith(_DECISION_HEAD) or not line.endswith(_DECISION_TAIL):
            continue
        try:
            doc = json.loads(line[len(_DECISION_HEAD):-len(_DECISION_TAIL)])
        except json.JSONDecodeError:
            continue
        if not isinstance(doc, dict) or doc.get("id") != decision_id or _schema_problem(doc, "decision"):
            continue
        if doc.get("record") == "proposal":
            proposal = doc
        elif doc.get("record") == "resolution":
            resolution = doc
    return proposal, resolution


def cross_human_problems(dep: Task, plan: PlanModel, layout: Any, entry: Mapping | None = None) -> list[str]:
    """The cross-executor done check of a manual or decision task (TWO-DEV.md 5 #3; SCHEMAS.md 4.3 #2 for human
    kinds: the receipt is replaced by the answer or the resolution and, for a file proof, its run), read git-free
    from the shared state; empty when it holds.

    manual: every `bring_back` key has an answer file (answers/<key>.md, header valid against answer) for the task
    with `verification.ok: true`; a relayed answer (`<key>-relay-<executor>`) or a `scope_change` answer unblocks
    nothing (TWO-DEV.md 6). decision: the decision id recorded on the task's status entry has a proposal and a
    resolution in decisions.md whose choice is one of the proposal's options. File proof: a tracked run copy
    `proofs/runs/<task>/*.json` (valid proof-run, type file) for the current proof digest with its expectation met."""
    problems: list[str] = []
    if dep.kind == "manual":
        folder = layout.state / "answers"
        headers = [h for h in (_answer_header(p) for p in sorted(folder.glob("*.md")))
                   if h is not None] if folder.is_dir() else []
        for bb in (dep.manual or {}).get("bring_back") or ():
            key = bb.get("key") if isinstance(bb, Mapping) else None
            if not any(h.get("task") == dep.id and h.get("bring_back_key") == key
                       and (h.get("verification") or {}).get("ok") is True and not h.get("scope_change")
                       and not _RELAY_KEY.search(str(h.get("key", ""))) for h in headers):
                problems.append(f"bring_back {key} has no verified answer")
    else:
        did = str((entry or {}).get("decision") or "")
        proposal, resolution = _decision_records(layout, did)
        options = {o.get("id") for o in (proposal or {}).get("options") or () if isinstance(o, Mapping)}
        if proposal is None or resolution is None or resolution.get("choice") not in options:
            problems.append(f"decision {did or '(none recorded)'} has no valid resolution")
    if (dep.proof or {}).get("type") == "file":
        raw = _task_raw(plan, dep.id)
        digest = planmod.proof_digest(raw) if raw is not None else None
        folder = layout.state / "proofs" / "runs" / dep.id
        runs = [_read_quiet(p) for p in sorted(folder.glob("*.json"))] if folder.is_dir() else []
        if not any(isinstance(r, dict) and _schema_problem(r, "proof-run") is None and r.get("task") == dep.id
                   and r.get("type") == "file" and r.get("proof_hash") == digest
                   and (r.get("expectation") or {}).get("met") is True for r in runs):
            problems.append(f"file proof: no tracked run copy under {folder.as_posix()} met for the current proof")
    return problems


def _dep_check(dep: Task, statuses: Mapping[str, dict], plan: PlanModel, executor: str,
               layout: Any) -> tuple[bool, list[str]]:
    """(status_done, problems). Own dependency: its status. Cross-executor dependency (TWO-DEV.md 5): its status in
    the other file AND its evidence in the shared state (`cross_receipt_problems`, or `cross_human_problems` for a
    manual or decision task); a status line without its evidence never satisfies it, so a layout is required."""
    if _status(dep.id, statuses, plan) != "done":
        return False, []
    if dep.executor == executor:
        return True, []
    if layout is None:
        raise InternalError(f"cross-executor dependency {dep.id} evaluated without a layout: a status line without "
                            "its receipt never satisfies a dependency (TWO-DEV.md 5)", code="E_INTERNAL")
    entry = _entry(dep.id, statuses, plan)
    check = cross_human_problems if dep.is_human else cross_receipt_problems
    problems = check(dep, plan, layout, entry)
    if problems:
        _LOG.debug("cross-executor dependency not satisfied", extra={"data": {"dep": dep.id, "problems": problems}})
    return True, problems


def readiness(plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping | None, *, now: datetime,
              executor: str, layout: Any = None) -> tuple[list[dict], list[dict]]:
    """(transitions, waiting_on_other) for the executor's own tasks. A transition is {task, from, to, evidence}.

    planned -> ready: plan approved, every dependency done (a cross-executor one with its evidence verified), release
    (or computed anchor) past. ready -> planned (SCHEMAS.md 4.2): only when a dependency's status is no longer done or
    the release moved later; never because a cross-executor dependency's evidence is not verifiable here (`status`
    may have made the task ready with its own full check, and that move is not schedule's to undo). failed -> ready:
    attempts < max_attempts. `layout` is required as soon as a cross-executor dependency's status is done
    (InternalError otherwise)."""
    moves: list[dict] = []
    waiting: list[dict] = []
    for t in plan.tasks:
        if t.executor != executor:
            continue
        entry = _entry(t.id, statuses, plan)
        state = str(entry.get("status") or "planned")
        if state == "failed":
            if int(entry.get("attempts", 0)) < t.max_attempts:
                moves.append({"task": t.id, "from": "failed", "to": "ready",
                              "evidence": [f"attempts:{entry.get('attempts', 0)}<{t.max_attempts}"]})
            continue
        if state not in ("planned", "ready"):
            continue
        if state == "planned" and t.template == "execution:EX-APPROVE":
            continue
        evidence: list[str] = []
        deps_verified = True     # every dependency done, cross-executor evidence included: planned -> ready
        deps_status_done = True  # every dependency's status done: the only dependency ground for ready -> planned
        for d in sorted(set(t.depends_on), key=_num):
            dep = plan.by_id.get(d)
            if dep is None:
                continue
            status_done, problems = _dep_check(dep, statuses, plan, executor, layout)
            if status_done and not problems:
                evidence.append(f"{d}:done")
                continue
            deps_verified = False
            deps_status_done = deps_status_done and status_done
            if dep.executor != executor and _status(d, statuses, plan) not in FINISHED - {"done"}:
                waiting.append({"task": t.id, "dep": d, "executor": dep.executor})
        rel, ok = release_now(t, plan, statuses, profile)
        released = ok and (rel is None or rel <= now)
        if rel is not None:
            evidence.append(f"release:{clock.format_utc(rel)}")
        if state == "planned" and deps_verified and released and plan.approved:
            moves.append({"task": t.id, "from": "planned", "to": "ready",
                          "evidence": evidence + [f"plan-approved:{plan.raw['approved'].get('plan_sha256', '')}"]})
        elif state == "ready" and not (deps_status_done and released):
            reason = "dependency-not-done" if not deps_status_done else "release-later"
            moves.append({"task": t.id, "from": "ready", "to": "planned", "evidence": evidence + [reason]})
        elif state == "ready" and not deps_verified:
            _LOG.info("ready task kept: a cross-executor dependency is done but its evidence is not verifiable here",
                      extra={"data": {"task": t.id}})
    return moves, waiting


def _apply_moves(ctx: Ctx, plan: PlanModel, moves: Sequence[dict]) -> None:
    """Write the moves into the own status file and one task.status event each (caller holds the state lock)."""
    if not moves:
        return
    doc = statusio.load(ctx.layout, str(ctx.executor))
    tasks = doc.setdefault("tasks", {})
    at = clock.format_utc(ctx.now)
    for m in moves:
        entry = tasks.get(m["task"]) or {"status": "planned", "since_utc": at, "attempts": 0, "reruns": 0,
                                         "consecutive_reruns": 0, "history": []}
        entry["history"] = list(entry.get("history") or []) + [
            {"from": m["from"], "to": m["to"], "at_utc": at, "by": "schedule", "evidence": list(m["evidence"])}]
        entry["status"] = m["to"]
        entry["since_utc"] = at
        tasks[m["task"]] = entry
    statusio.save(ctx, doc)
    for m in moves:
        events.append(ctx, "task.status", {"task": m["task"], "from": m["from"], "to": m["to"],
                                           "evidence": list(m["evidence"])})


# --- commands -----------------------------------------------------------------------------------------------------

def _state_lock(ctx: Ctx) -> Iterator[None]:
    """The state lock (CLI.md schedule). Reached through statusio's own `locks` import: MODULES.md 8 lists no
    schedule -> locks edge (contract question Q-B03-1)."""
    return statusio.locks.hold(ctx.layout, "state", command=ctx.command)


def _read_optional(path: Path) -> Any:
    return jsonio.read_json_retry(path) if path.exists() else None


def _newest_loc(layout: Any) -> int | None:
    """`loc` of the newest local/harden-ready/*.facts.json (HANDOVER.md 1.5), when one exists."""
    folder = layout.harden_ready_dir
    if not folder.is_dir():
        return None
    for path in sorted(folder.glob("*.facts.json"), reverse=True):
        doc = jsonio.read_json_retry(path)
        if isinstance(doc, dict) and isinstance(doc.get("loc"), int):
            return int(doc["loc"])
    return None


def _default_lanes(profile: Mapping | None, local_state: Mapping | None) -> tuple[int, int]:
    machine = (profile or {}).get("machine") or {}
    lanes = int(machine.get("max_lanes") or 3)
    slots = int(machine.get("browser_slots") or 1)
    decision = ((local_state or {}).get("governor") or {}).get("decision") or {}
    if isinstance(decision.get("lanes"), int) and decision["lanes"] >= 1:
        lanes = min(lanes, int(decision["lanes"])) if machine.get("max_lanes") else int(decision["lanes"])
    if isinstance(decision.get("browser_slots"), int) and decision["browser_slots"] >= 1:
        slots = int(decision["browser_slots"])
    return max(lanes, 1), max(slots, 1)


def _check_samples(samples: int) -> int:
    lo, hi = SAMPLES_RANGE
    if not lo <= int(samples) <= hi:
        raise UsageError(f"--samples must be between {lo} and {hi}")
    return int(samples)


def _cut_draft(deadline_id: str, zone: dict, candidates: Sequence[str], deadline_at: datetime | None) -> dict:
    title = f"Zone rouge sur {deadline_id} : P(à l'heure) = {zone['p_on_time']:.2f}"
    if candidates:
        return {"kind": "cut", "title": title, "tasks": list(candidates),
                "options": [
                    {"id": "cut", "label": "Couper les tâches proposées",
                     "consequence": "Ces tâches passent à « coupée » ; le reste du plan continue.",
                     "effects": [{"op": "cut-tasks", "tasks": list(candidates)}]},
                    {"id": "keep", "label": "Tout garder et accepter le risque",
                     "consequence": "Le plan reste entier ; la zone rouge demeure.",
                     "effects": [{"op": "none"}]}],
                "recommended": None,
                "deadline_utc": clock.format_utc(deadline_at) if deadline_at else None}
    return {"kind": "other", "title": title + " (aucune tâche coupable hors chemin critique)", "tasks": [],
            "options": [
                {"id": "amend", "label": "Amender le plan", "consequence": "Une modification du plan est préparée.",
                 "effects": [{"op": "none"}]},
                {"id": "keep", "label": "Accepter le risque", "consequence": "Le plan reste entier.",
                 "effects": [{"op": "none"}]}],
            "recommended": None, "deadline_utc": clock.format_utc(deadline_at) if deadline_at else None}


def compute(plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping | None, local_state: Mapping | None, *,
            now: datetime, samples: int, seed: int, lanes: int, browser_slots: int, executor: str,
            layout: Any = None, waiting_on_other: Sequence[dict] = (), loc: int | None = None) -> dict:
    """The data of `schedule` (CLI.md) from documents already loaded (no writes)."""
    calibration = calibration_from(local_state, plan, statuses)
    sim = simulate(plan, statuses, dict(profile or {}), samples=samples, seed=seed, lanes=lanes, now=now,
                   calibration=calibration, browser_slots=browser_slots)
    live = [t for t in plan.tasks if _status(t.id, statuses, plan) not in FINISHED]
    releases = {t.id: static_release(t, plan, profile)[0] for t in live}
    med: dict[str, float] = {}
    verify_p50 = REFERENCE_CLASS["verify"].p50
    for t in live:
        ratio = calibration.get(t.kind, 1.0)
        v = _est_pair((t.raw.get("params") or {}).get("verify_estimate"))
        med[t.id] = t.estimate.p50 * ratio + (0.0 if t.is_human else (v[0] if v else verify_p50))
    cp = cpm(plan, statuses, now, med, releases=releases)
    graph = Graph.of(plan)
    ready_tasks = [t for t in plan.tasks if t.executor == executor and _status(t.id, statuses, plan) == "ready"]
    ready_tasks.sort(key=lambda t: priority_key(t, cp, graph))
    critical_set = set(cp.critical)
    ready = [{"task": t.id, "rank": i + 1,
              "lst_utc": clock.format_utc(now + timedelta(minutes=cp.ls.get(t.id, 0.0))),
              "slack_min": _r(cp.slack.get(t.id, 0.0)), "remaining_path_min": _r(cp.remaining.get(t.id, 0.0)),
              "critical": t.id in critical_set} for i, t in enumerate(ready_tasks)]
    zs = zones(sim, plan.deadlines, now)
    proposals: list[dict] = []
    by_id = {d.id: d for d in plan.deadlines}
    red = [z for z in zs if z["zone"] == "red"]
    if red:
        cands = cut_candidates(plan, statuses, sim)
        for z in red:
            proposals.append(_cut_draft(z["deadline"], z, cands, by_id[z["deadline"]].at))
    hp80 = harden_p80_min(profile, loc)
    bc = build_complete_breakdown(profile, plan, hp80)
    current = next((d for d in plan.deadlines if d.id == "DL-build-complete"), None)
    bc["plan_deadline_utc"] = clock.format_utc(current.at) if current else None
    bc["stale"] = bc["deadline_utc"] is not None and bc["plan_deadline_utc"] != bc["deadline_utc"]
    pct = ((local_state or {}).get("calibration") or {}).get("pct_per_agent_hour")
    hours = sim["agent_hours"]["p80"]
    return {
        "computed_utc": clock.format_utc(now), "seed": seed, "samples": samples, "lanes": sim["lanes"],
        "browser_slots": sim["browser_slots"],
        "ready": ready, "zones": zs, "criticality": sim["criticality"], "critical_path": list(cp.critical),
        "slack_min": {t: _r(cp.slack[t]) for t in sorted(cp.slack, key=_num)},
        "makespan_min": sim["makespan_min"],
        "build_complete_deadline_utc": bc["deadline_utc"], "build_complete": bc,
        "waiting_on_other": list(waiting_on_other),
        "quota_projection": {"agent_hours_p80": hours,
                             "weekly_pct_needed": (_r(hours * float(pct), 3)
                                                   if isinstance(pct, (int, float)) and not isinstance(pct, bool)
                                                   else None)},
        "proposals": proposals,
    }


def cmd_schedule(ctx: Ctx, args: Namespace) -> CommandResult:
    """CLI.md `schedule`: readiness transitions, then CPM and Monte Carlo; writes local/schedule.json."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    samples = _check_samples(getattr(args, "samples", 800) or 800)
    raw = planmod.load_raw(ctx.layout)
    plan = PlanModel.from_raw(raw)
    seed = args.seed if getattr(args, "seed", None) is not None else int(planmod.plan_digest(raw)[:8], 16)
    profile = _read_optional(ctx.layout.profile)
    local_state = _read_optional(ctx.layout.local_state)
    lanes, slots = _default_lanes(profile, local_state)
    if getattr(args, "lanes", None) is not None:
        if int(args.lanes) < 1:
            raise UsageError("--lanes must be >= 1")
        lanes = int(args.lanes)
    with _state_lock(ctx):
        statuses = statusio.load_all(ctx.layout)
        moves, waiting = readiness(plan, statuses, profile, now=ctx.now, executor=ctx.executor, layout=ctx.layout)
        _apply_moves(ctx, plan, moves)
        statuses = statusio.load_all(ctx.layout)
    data = compute(plan, statuses, profile, local_state, now=ctx.now, samples=samples, seed=int(seed), lanes=lanes,
                   browser_slots=slots, executor=ctx.executor, layout=ctx.layout, waiting_on_other=waiting,
                   loc=_newest_loc(ctx.layout))
    data["transitions"] = moves
    with _state_lock(ctx):
        jsonio.write_json_atomic(ctx.layout.schedule_cache, data)
        events.append(ctx, "schedule", {
            "seed": data["seed"], "samples": samples, "lanes": data["lanes"], "ready": len(data["ready"]),
            "transitions": len(moves), "zones": {z["deadline"]: z["zone"] for z in data["zones"]},
            "build_complete_deadline_utc": data["build_complete_deadline_utc"]})
    _LOG.info("schedule computed", extra={"data": {"ready": len(data["ready"]), "transitions": len(moves),
                                                   "zones": [z["zone"] for z in data["zones"]]}})
    return CommandResult(data=data)


def cmd_simulate(ctx: Ctx, args: Namespace) -> CommandResult:
    """CLI.md `simulate`: Monte Carlo only, read-only."""
    if getattr(args, "plan", None):
        path = Path(args.plan)
        if not path.is_file():
            raise UsageError(f"no plan file at {path.as_posix()}")
        # plan.load_raw (MODULES.md 4) on a layout whose plan path is this file: the same schema check and
        # E_PLAN_INVALID (exit 1) as the state's own plan, through the public surface only (B03-V4)
        raw = planmod.load_raw(dataclasses.replace(ctx.layout, plan=path))
    else:
        raw = planmod.load_raw(ctx.layout)
    plan = PlanModel.from_raw(raw)
    samples = _check_samples(getattr(args, "samples", 800) or 800)
    seed = args.seed if getattr(args, "seed", None) is not None else int(planmod.plan_digest(raw)[:8], 16)
    profile = _read_optional(ctx.layout.profile) if ctx.layout.state.exists() else None
    local_state = _read_optional(ctx.layout.local_state) if ctx.layout.state.exists() else None
    statuses: Mapping[str, dict] = {}
    if getattr(args, "from_status", False):
        statuses = statusio.load_all(ctx.layout)
    what_if = None
    if getattr(args, "what_if", None):
        wpath = Path(args.what_if)
        if not wpath.is_file():
            raise UsageError(f"no what-if file at {wpath.as_posix()}")
        what_if = jsonio.read_json_retry(wpath)
    lanes, slots = _default_lanes(profile, local_state)
    if getattr(args, "lanes", None) is not None:
        if int(args.lanes) < 1:
            raise UsageError("--lanes must be >= 1")
        lanes = int(args.lanes)
    sim = simulate(plan, statuses, dict(profile or {}), samples=samples, seed=int(seed), lanes=lanes, now=ctx.now,
                   calibration=calibration_from(local_state, plan, statuses), what_if=what_if, browser_slots=slots)
    data = dict(sim)
    data["zones"] = zones(sim, plan.deadlines, ctx.now)
    return CommandResult(data=data)

