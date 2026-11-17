"""French reports for the owner and the TASKLIST-style EXECUTION.md (contract/CLI.md `report`, NOTION.md 9, MODULES.md 5).

Everything here is rendered by script from files (plan, status files, receipts, local state, the schedule cache,
decisions.md headers, the governor and quota readings), never from model prose. The wave report is French and single
column for the phone: headings, bullets, one callout, every line at most 100 characters, at most 6,000 characters in
all; EXECUTION.md is English.

Templates live in `assets/report-templates/` and use a small syntax:
- `{{name}}` a scalar (an unknown name is an InternalError: a template bug, never a silent blank);
- a line `{{#list}}...{{/list}}` is repeated per item (item fields as `{{field}}`); an empty list renders `Rien.`,
  or the text after `|` in `{{#list|text}}`;
- a line `{{*list}}...{{/list}}` is repeated per item and renders nothing when the list is empty.

Layering (MODULES.md 8): report imports plan, statusio and state only. It reads `local/schedule.json`,
`decisions.md` headers and `local/notion/*` as data files (never through schedule, decisionsio or notion). Holding
the state lock and writing the `report.written` event need `locks` and `events`, which MODULES.md 8 does not list
for report: they are reached through `state` (contract question Q-B09-1 in the lane report).
"""
from __future__ import annotations

import json
import math
import re
from argparse import Namespace
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import clock, jsonio, paths, plan as plan_mod, state, statusio
from .errors import InternalError, UsageError
from .log import get_logger, redact
from .model import CommandResult, Ctx, PlanModel, Task

_LOG = get_logger("execlib.report")
# MODULES.md 8 lists `report -> plan, statusio, state`; the lock and the event writer are reached through `state`,
# which imports `locks` and owns the event-line writer (Q-B09-1).
_locks = state.locks

TEMPLATES_DIR: Path = paths.skill_path("assets", "report-templates")
MAX_LINE = 100
MAX_REPORT_CHARS = 6000
MAX_PUSH_CHARS = 200
LIST_CAP = 8

FR_DAYS: Mapping[str, str] = {"Mon": "lun.", "Tue": "mar.", "Wed": "mer.", "Thu": "jeu.", "Fri": "ven.",
                              "Sat": "sam.", "Sun": "dim."}
FR_MONTHS: Mapping[str, str] = {"Jan": "janv.", "Feb": "févr.", "Mar": "mars", "Apr": "avr.", "May": "mai",
                                "Jun": "juin", "Jul": "juil.", "Aug": "août", "Sep": "sept.", "Oct": "oct.",
                                "Nov": "nov.", "Dec": "déc."}
ZONE_WORD: Mapping[str, str] = {"green": "verte", "yellow": "jaune", "red": "rouge", "unknown": "inconnue"}
ZONE_COLOUR: Mapping[str, str] = {"green": "green", "yellow": "yellow", "red": "red", "unknown": "gray"}
WHERE_FR: Mapping[str, str] = {"phone": "téléphone", "laptop": "ordinateur", "venue": "sur place"}
PROOF_FR: Mapping[str, str] = {"command": "commande", "tx": "tx", "ci": "CI verte", "file": "fichier",
                               "url": "URL", "human-attest": "réponse vérifiée"}
RUN_STATE_FR: Mapping[str, str] = {
    "RUNNING": "En marche", "AWAITING_HUMAN": "Attend une action", "AWAITING_DECISION": "Attend une décision",
    "PAUSED_QUOTA": "En pause (quota)", "PAUSED_RESOURCES": "En pause (disque ou RAM)",
    "STUCK": "Bloqué : regarde l'ordinateur", "BUILD_COMPLETE": "Build terminé",
    "HANDED_OVER": "Remis : tape /harden", "FIX": "Correctifs"}
DECISION_PREFIX = "<!-- execution-decision "
DECISION_SUFFIX = " -->"
ID_RANGES: Mapping[str, tuple[int, int]] = {"A": (1, 499), "B": (500, 999)}
OWNER_ONLY_KINDS = frozenset({"approval", "spec-validation", "cut", "policy-exception", "fix-selection"})
BUILD_COMPLETE = "DL-build-complete"


# --- French display (NOTION.md 9.4) -------------------------------------------------------------------------------

def _zone_parts(text: str) -> tuple[str, str, str, str]:
    """('Wed', '7', 'Oct', '23:59') from clock.display's 'Wed 7 Oct 23:59 SGT'."""
    parts = text.split(" ")
    if len(parts) < 5:
        raise InternalError(f"unexpected clock.display rendering {text!r}")
    return parts[0], parts[1], parts[2], parts[3]


def fr_zone_values(dt: datetime, zones: Sequence[clock.ZoneSpec]) -> list[tuple[str, str, str, bool]]:
    """Per display zone: (date part 'mer. 7 oct.', time 'HH:MM', label, fallback used)."""
    rendered, warnings = clock.display(dt, zones)
    fallen = {z.label for z in zones for w in warnings
              if w.code == "W_TZ_FALLBACK" and w.message.endswith(f"used for {z.label}")}
    out: list[tuple[str, str, str, bool]] = []
    for zone in zones:
        wd, day, mon, hm = _zone_parts(rendered[zone.label])
        out.append((f"{FR_DAYS[wd]} {day} {FR_MONTHS[mon]}", hm, zone.label, zone.label in fallen))
    return out


def fr_display(dt: datetime | None, zones: Sequence[clock.ZoneSpec], *, ref: datetime | None = None,
               first_only: bool = False) -> str:
    """'mer. 7 oct. 23:59 SGT · 17:59 Paris': the second zone drops the date when it is the same day; with `ref`,
    the first zone drops it too when `ref` falls on the same day there. The fixed-offset fallback appends
    ' (décalage fixe)' to the label. None renders 'non mesuré'."""
    if dt is None:
        return "non mesuré"
    if not zones:
        return clock.format_utc(dt)
    values = fr_zone_values(dt, zones)
    ref_date = fr_zone_values(ref, zones[:1])[0][0] if ref is not None else None
    pieces: list[str] = []
    first_date = values[0][0]
    for i, (date, hm, label, fallback) in enumerate(values):
        lab = label + (" (décalage fixe)" if fallback else "")
        same_day = (i > 0 and date == first_date) or (i == 0 and ref_date == date)
        pieces.append(f"{hm} {lab}" if same_day else f"{date} {hm} {lab}")
        if first_only:
            break
    return " · ".join(pieces)


def zones_of(profile: Mapping[str, Any] | None) -> list[clock.ZoneSpec]:
    return clock.zones_from_profile(dict(profile or {}))


def fr_number(value: float | int | None, decimals: int = 1) -> str:
    """French decimal comma ('6,2'); None renders 'non mesuré'."""
    if value is None:
        return "non mesuré"
    return f"{float(value):.{decimals}f}".replace(".", ",")


def fr_pct(value: float | int | None) -> str:
    """An integer percentage; None renders 'non mesuré'."""
    if value is None:
        return "non mesuré"
    return str(int(math.floor(float(value) + 0.5)))


def fr_unit(value: float | int | None, unit: str, *, pct: bool = False) -> str:
    """'6,2 Go' / '62 %'; a missing reading renders 'non mesuré', never 0."""
    if value is None or isinstance(value, bool):
        return "non mesuré"
    return f"{fr_pct(value) if pct else fr_number(value)} {unit}"


def fr_duration_min(minutes: float | None) -> str:
    if minutes is None:
        return "non mesuré"
    total = int(math.floor(minutes + 0.5))
    if total < 60:
        return f"{total} min"
    return f"{total // 60} h {total % 60:02d}"


def lognormal_p80(p50: float, p90: float) -> float:
    """P80 of the lognormal fitted to p50 and p90 (sigma = ln(p90/p50)/1.2816)."""
    if p50 <= 0:
        return 0.0
    if p90 <= p50:
        return p50
    sigma = math.log(p90 / p50) / 1.2816
    return p50 * math.exp(0.8416 * sigma)


# --- templates ----------------------------------------------------------------------------------------------------

_SCALAR = re.compile(r"\{\{([a-z0-9_]+)\}\}")
_REPEAT = re.compile(r"^\{\{([#*])([a-z0-9_]+)(?:\|([^}]*))?\}\}(.*)\{\{/\2\}\}$")


def load_template(name: str) -> str:
    path = TEMPLATES_DIR / name
    if not path.exists():
        raise InternalError(f"report template {paths.posix(path)} is missing (lane B09 asset)")
    return path.read_bytes().decode("utf-8")


def _fill(fmt: str, values: Mapping[str, Any], where: str) -> str:
    def sub(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in values:
            raise InternalError(f"template {where}: no value for {{{{{key}}}}}")
        value = values[key]
        return "" if value is None else str(value)
    return _SCALAR.sub(sub, fmt)


def shorten(text: str, limit: int) -> str:
    """Cut to `limit` characters with a final '…' (never returns more than `limit`)."""
    if len(text) <= limit:
        return text
    if limit <= 1:
        return "…"[:limit]
    return text[: limit - 1].rstrip() + "…"


def fit_line(fmt: str, item: Mapping[str, Any], shrink: Sequence[str], where: str, limit: int = MAX_LINE) -> str:
    """Render one item line; while it is longer than `limit`, cut the fields of `shrink` in order (each down to 6
    characters at least) with '…'. Fields outside `shrink` (a proof link) are never cut."""
    values = dict(item)
    line = _fill(fmt, values, where)
    for field in shrink:
        if len(line) <= limit:
            break
        text = str(values.get(field) or "")
        over = len(line) - limit
        keep = max(6, len(text) - over)
        if keep < len(text):
            values[field] = shorten(text, keep)
            line = _fill(fmt, values, where)
    return line


def render_template(text: str, values: Mapping[str, Any], *, lists: Mapping[str, Sequence[Mapping[str, Any]]]
                    | None = None, shrink: Mapping[str, Sequence[str]] | None = None, where: str = "template",
                    limit: int | None = MAX_LINE) -> str:
    """Render the template syntax of this module (see the module docstring)."""
    lists = lists or {}
    shrink = shrink or {}
    out: list[str] = []
    for raw in text.split("\n"):
        m = _REPEAT.match(raw)
        if m:
            mode, name, empty_text, fmt = m.group(1), m.group(2), m.group(3), m.group(4)
            if name not in lists:
                raise InternalError(f"template {where}: no list for {{{{{mode}{name}}}}}")
            items = lists[name]
            if not items:
                if mode == "#":
                    out.append(empty_text if empty_text is not None else "Rien.")
                continue
            for item in items:
                merged = {**values, **item}
                out.append(fit_line(fmt, merged, shrink.get(name, ()), where, limit or 10**9))
            continue
        line = _fill(raw, values, where)
        if limit is not None and len(line) > limit:
            line = shorten(line, limit)
        out.append(line)
    return "\n".join(out)


def capped(items: list[dict], cap: int, more_fmt: str = "… et {n} autres (voir EXECUTION.md)",
           field: str = "text") -> list[dict]:
    """The first `cap` items, then one item whose `field` says how many were left out."""
    if len(items) <= cap:
        return items
    rest = len(items) - cap
    return items[:cap] + [{"__more__": True, field: more_fmt.format(n=rest)}]


# --- data files read as data ----------------------------------------------------------------------------------------

def _read_json_or_none(path: Path) -> Any:
    if not path.exists():
        return None
    return jsonio.read_json_retry(path)


def decision_blocks(layout: paths.Layout) -> list[dict]:
    """decisions.md block headers as data (tolerant reader; decisionsio is not an edge of report, Q-B09-2)."""
    path = layout.decisions
    if not path.exists():
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for line in path.read_bytes().decode("utf-8").split("\n"):
        line = line.rstrip("\r")
        if not line.startswith(DECISION_PREFIX) or not line.endswith(DECISION_SUFFIX) or line in seen:
            continue
        seen.add(line)
        try:
            doc = json.loads(line[len(DECISION_PREFIX): -len(DECISION_SUFFIX)])
        except json.JSONDecodeError:
            _LOG.warning("unreadable decision header skipped", extra={"data": {"path": paths.posix(path)}})
            continue
        if isinstance(doc, dict) and isinstance(doc.get("id"), str):
            out.append(doc)
    return out


def open_proposals(layout: paths.Layout, executor: str | None = None) -> list[dict]:
    """Open proposals (no resolution), optionally only the ids of `executor`'s range, sorted by id."""
    blocks = decision_blocks(layout)
    resolved = {b["id"] for b in blocks if b.get("record") == "resolution"}
    out = []
    for b in blocks:
        if b.get("record") != "proposal" or b["id"] in resolved:
            continue
        if executor is not None and not in_range(b["id"], executor):
            continue
        out.append(b)
    return sorted(out, key=lambda b: b["id"])


def in_range(decision_id: str, executor: str) -> bool:
    try:
        n = int(decision_id[2:])
    except ValueError:
        return False
    lo, hi = ID_RANGES[executor]
    return lo <= n <= hi


def load_receipt(layout: paths.Layout, task_id: str) -> dict | None:
    doc = _read_json_or_none(layout.receipt(task_id))
    return doc if isinstance(doc, dict) else None


def receipt_valid(receipt: Mapping[str, Any] | None, task: Task, entry: Mapping[str, Any]) -> bool:
    """The report's view of a done task's evidence: a pass receipt for this task, on origin/main, matching the
    landed SHA when one is recorded. (The full done check is status.check_done_evidence, B04; a task failing this
    lighter check is certainly incoherent.)"""
    if not receipt:
        return False
    if receipt.get("task") != task.id or receipt.get("verdict") != "pass" or receipt.get("on_origin_main") is not True:
        return False
    landed = entry.get("landed_sha")
    return not landed or receipt.get("sha") == landed


def proof_label_fr(task: Task) -> str:
    """'commande · exit 0', 'tx preprod relue', 'CI verte', 'fichier', 'URL 200', 'réponse vérifiée'."""
    proof = task.proof or {}
    kind = proof.get("type")
    expect = proof.get("expect") or {}
    spec = proof.get("spec") or {}
    if kind == "command":
        return f"commande · exit {expect.get('exit_code', 0)}"
    if kind == "tx":
        return f"tx {spec.get('network', '')} relue".replace("  ", " ")
    if kind == "url":
        return f"URL {spec.get('expect_status', 200)}"
    return PROOF_FR.get(str(kind), str(kind))


def proof_url(task: Task) -> str | None:
    """A URL for the proof when the plan names one (url proofs); a local receipt has none (never invented)."""
    spec = (task.proof or {}).get("spec") or {}
    url = spec.get("url") if (task.proof or {}).get("type") == "url" else None
    return url if isinstance(url, str) and re.match(r"^https?://\S+$", url) else None


def _executor_entries(plan: PlanModel, statuses: Mapping[str, dict], executor: str) -> list[tuple[Task, dict]]:
    tasks = (statuses.get(executor) or {}).get("tasks") or {}
    out: list[tuple[Task, dict]] = []
    for task in plan.tasks:
        if task.executor != executor:
            continue
        out.append((task, tasks.get(task.id) or {"status": "planned", "attempts": 0, "reruns": 0}))
    return out


def schedule_zone(schedule_cache: Mapping[str, Any] | None, deadline_id: str) -> dict | None:
    for zone in (schedule_cache or {}).get("zones") or []:
        if isinstance(zone, dict) and zone.get("deadline") == deadline_id:
            return zone
    return None


def schedule_known(schedule_cache: Mapping[str, Any] | None, plan: PlanModel) -> bool:
    """False when there is no cache, or the cache names another plan version or digest than the current plan."""
    if not schedule_cache or not isinstance(schedule_cache, Mapping):
        return False
    version = schedule_cache.get("plan_version")
    if isinstance(version, int) and version < plan.version:
        return False
    digest = schedule_cache.get("plan_sha256")
    if isinstance(digest, str) and digest != plan_mod.plan_digest(plan.raw):
        return False
    return bool(schedule_cache.get("zones"))


def _utc(text: Any) -> datetime | None:
    if not isinstance(text, str):
        return None
    try:
        return clock.parse_utc(text)
    except UsageError:
        return None


def outbox_failures(layout: paths.Layout) -> int:
    """Unresolved outbox lines that are no longer replayed (attempts >= 5)."""
    path = layout.notion_outbox
    if not path.exists():
        return 0
    lines: dict[str, dict] = {}
    resolved: set[str] = set()
    for _n, doc in jsonio.read_jsonl(path):
        if not isinstance(doc, dict):
            continue
        if "resolved" in doc:
            resolved.add(str(doc["resolved"]))
            continue
        ref = f"{doc.get('batch_id')}/{doc.get('op_id')}"
        lines[ref] = doc
    return sum(1 for ref, doc in lines.items()
               if ref not in resolved and int(doc.get("attempts", 0) or 0) >= 5)


# --- the wave report ----------------------------------------------------------------------------------------------

def _wave_entry(local: Mapping[str, Any] | None, wave: str) -> dict:
    for entry in (local or {}).get("waves") or []:
        if isinstance(entry, dict) and entry.get("wave") == wave:
            return entry
    return {}


def _manifest(layout: paths.Layout, wave: str) -> dict | None:
    doc = _read_json_or_none(layout.wave_manifest(wave))
    return doc if isinstance(doc, dict) else None


def _first_finding(receipt: Mapping[str, Any] | None) -> str | None:
    for finding in (receipt or {}).get("findings") or []:
        claim = finding.get("claim") if isinstance(finding, dict) else None
        if isinstance(claim, str) and claim.strip():
            return claim.strip()
    return None


def wave_facts(ctx: Ctx, wave: str, plan: PlanModel, statuses: Mapping[str, dict],
               schedule_cache: Mapping[str, Any] | None, governor: Mapping[str, Any] | None,
               quota: Mapping[str, Any] | None, *, cap: int = LIST_CAP) -> dict:
    """Every value and list the wave report shows, computed from files only."""
    layout = ctx.layout
    executor = ctx.executor or "A"
    profile = _read_json_or_none(layout.profile) or {}
    zones = zones_of(profile)
    local = _read_json_or_none(layout.local_state) or {}
    entries = _executor_entries(plan, statuses, executor)

    fait: list[dict] = []
    prouve: list[dict] = []
    incoh: list[dict] = []
    open_items: list[dict] = []
    counts = {"failed": 0, "blocked": 0, "ready": 0, "planned": 0, "running": 0, "done_wave": 0, "failed_wave": 0}
    for task, entry in entries:
        status = entry.get("status", "planned")
        in_wave = entry.get("wave") == wave
        receipt = load_receipt(layout, task.id)
        if status == "failed":
            counts["failed"] += 1
        elif status in ("blocked-manual", "blocked-decision"):
            counts["blocked"] += 1
        elif status == "ready":
            counts["ready"] += 1
        elif status == "planned":
            counts["planned"] += 1
        elif status == "running":
            counts["running"] += 1
        if status == "done":
            if not receipt_valid(receipt, task, entry):
                incoh.append({"task_id": task.id})
                continue
            if in_wave:
                counts["done_wave"] += 1
                url = proof_url(task)
                ref = f"[preuve]({url})" if url else f"`{layout.rel(layout.receipt(task.id))}`"
                prouve.append({"task_id": task.id, "title": redact(task.title), "proof_fr": proof_label_fr(task),
                               "proof_ref": ref, "verifier": str((receipt or {}).get("by", {}).get("agent_type", "")),
                               "run_id": str((receipt or {}).get("run", ""))})
            continue
        if in_wave and status in ("failed", "blocked-manual", "blocked-decision"):
            counts["failed_wave"] += 1
        if in_wave:
            landed = entry.get("landed_sha")
            verdict = None
            if status in ("built", "verifying"):
                verdict = "en vérification"
            elif status == "failed" and landed:
                verdict = f"preuve échouée (tentative {int(entry.get('attempts', 0))}/{task.max_attempts})"
            elif int(entry.get("reruns", 0) or 0) > 0 and status in ("ready", "planned", "running"):
                verdict = "relancée (agent absent)"
            elif landed:
                verdict = ""
            if verdict is not None:
                if landed:
                    landed_text = f"intégrée {landed[:8]}" + (", " if verdict else "")
                else:
                    landed_text = ""
                fait.append({"task_id": task.id, "title": redact(task.title), "landed": landed_text,
                             "verdict_fr": verdict})
        if status in ("failed", "blocked-manual", "blocked-decision"):
            blocked = entry.get("blocked") or {}
            reason = blocked.get("reason") if isinstance(blocked, dict) else None
            reason = reason or _first_finding(receipt)
            if not reason:
                reason = ("en échec, tentative " f"{int(entry.get('attempts', 0))}/{task.max_attempts}"
                          if status == "failed" else "bloquée")
            open_items.append({"task_id": task.id, "title": redact(task.title),
                               "open_reason_fr": redact(" ".join(str(reason).split()))})

    actions = next_actions(ctx, plan, statuses, profile, local)
    known = schedule_known(schedule_cache, plan)
    bc = schedule_zone(schedule_cache, BUILD_COMPLETE) if known else None
    submission = _submission_deadline(plan)
    sub_zone = schedule_zone(schedule_cache, submission.id) if (known and submission is not None) else None
    main_zone = bc or sub_zone
    zone_key = str(main_zone.get("zone")) if main_zone and main_zone.get("zone") in ("green", "yellow", "red") \
        else "unknown"
    p_on_time = main_zone.get("p_on_time") if main_zone else None

    def zdisp(key: str, zone: Mapping[str, Any] | None) -> str:
        return fr_display(_utc((zone or {}).get(key)), zones) if zone and zone.get(key) else "inconnu"

    deadlines: list[dict] = []
    bc_deadline = next((d for d in plan.deadlines if d.id == BUILD_COMPLETE), None)
    if bc_deadline is not None:
        deadlines.append({"deadline_label": "build complet", "deadline_display": fr_display(bc_deadline.at, zones)})
    if submission is not None:
        deadlines.append({"deadline_label": "de rendu", "deadline_display": fr_display(submission.at, zones)})

    if main_zone is not None and isinstance(p_on_time, (int, float)):
        pct = fr_pct(float(p_on_time) * 100.0)
        on_time_line = f"À l'heure avec {pct} % de chances · zone {ZONE_WORD[zone_key]}"
        status_tail = f"le build tient l'échéance avec {pct} % de chances."
    else:
        on_time_line = "Chances d'être à l'heure : inconnues · zone inconnue"
        status_tail = "chances inconnues (planning à recalculer)."
    critical = (schedule_cache or {}).get("critical_path") if known else None
    critical_ids = ", ".join(str(x) for x in critical) if isinstance(critical, list) and critical else "inconnu"
    one_line = (f"{counts['done_wave']} prouvées, {counts['failed_wave']} échec"
                f"{'s' if counts['failed_wave'] > 1 else ''}, {counts['running']} en cours ; {status_tail}")

    # pulse
    gov = governor if isinstance(governor, Mapping) else None
    quo = quota if isinstance(quota, Mapping) else None
    floor = ((profile.get("machine") or {}).get("disk_floor_gb"))
    entry_w = _wave_entry(local, wave)
    launched = _utc(entry_w.get("launched_utc"))
    finished = _utc(entry_w.get("finished_utc"))
    duration = clock.minutes_between(launched, finished) if launched and finished else None
    manifest = _manifest(layout, wave)
    n_agents = sum(len(t.get("chain") or []) for t in (manifest or {}).get("tasks") or []) if manifest else None
    reruns = sum(int(e.get("reruns", 0) or 0) for _t, e in entries if e.get("wave") == wave)
    age_s = quo.get("snapshot_age_s") if quo else None
    failures = outbox_failures(layout)
    ledger = _read_json_or_none(layout.local / "notion" / "ledger.json") or {}
    hub_recreated = bool(isinstance(ledger, dict) and ledger.get("hub_recreated_utc"))

    values = {
        "zone_colour": ZONE_COLOUR[zone_key],
        "zone_label": f"Zone {ZONE_WORD[zone_key]}",
        "p80_build_complete": zdisp("p80_utc", bc),
        "p90_build_complete": zdisp("p90_utc", bc),
        "one_line_status": one_line,
        "n_failed": counts["failed"], "n_blocked": counts["blocked"], "n_ready": counts["ready"],
        "n_planned": counts["planned"],
        "on_time_line": on_time_line,
        "zone_word": ZONE_WORD[zone_key],
        "p50": zdisp("p50_utc", bc), "p80": zdisp("p80_utc", bc), "p90": zdisp("p90_utc", bc),
        "critical_path_ids": critical_ids,
        "disk_free": fr_unit(gov.get("disk_free_gb") if gov else None, "Go"),
        "disk_floor": fr_unit(floor if isinstance(floor, (int, float)) else None, "Go"),
        "ram_free": fr_unit(gov.get("ram_free_gb") if gov else None, "Go"),
        "five_hour": fr_unit(quo.get("five_hour_pct") if quo else None, "%", pct=True),
        "five_hour_resets": fr_display(_utc(quo.get("five_hour_resets_utc")), zones) if quo else "non mesuré",
        "seven_day": fr_unit(quo.get("seven_day_pct") if quo else None, "%", pct=True),
        "seven_day_resets": fr_display(_utc(quo.get("seven_day_resets_utc")), zones) if quo else "non mesuré",
        "snapshot_age": fr_duration_min(age_s / 60.0) if isinstance(age_s, (int, float)) else "non mesuré",
        "last_tick": fr_display(_utc(local.get("last_tick_utc")), zones),
        "wave": wave,
        "agents": f"{n_agents} agents" if n_agents is not None else "agents non mesurés",
        "reruns": reruns,
        "wave_duration": fr_duration_min(duration),
    }
    extra_pulse: list[dict] = []
    if failures:
        extra_pulse.append({"text": f"Notion : {failures} opérations en échec, voir local/notion/outbox.jsonl"})
    if hub_recreated:
        extra_pulse.append({"text": "Bloc « Maintenant » recréé : il avait été modifié à la main."})
    lists = {
        "fait": capped(sorted(fait, key=lambda i: i["task_id"]), cap),
        "prouve": capped(sorted(prouve, key=lambda i: i["task_id"]), cap),
        "incoh": sorted(incoh, key=lambda i: i["task_id"]),
        "ouvert": capped(sorted(open_items, key=lambda i: i["task_id"]), cap),
        "actions": capped(actions, cap),
        "deadlines": deadlines,
        "pulse_extra": extra_pulse,
    }
    return {"values": values, "lists": lists, "actions": actions, "zone": zone_key, "counts": counts,
            "prouvees": counts["done_wave"], "echecs": counts["failed_wave"]}


def _submission_deadline(plan: PlanModel) -> Any:
    subs = [d for d in plan.deadlines if d.kind == "submission"]
    if subs:
        return sorted(subs, key=lambda d: (d.at, d.id))[0]
    others = [d for d in plan.deadlines if d.id != BUILD_COMPLETE]
    return sorted(others, key=lambda d: (d.at, d.id))[0] if others else None


def next_actions(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any],
                 local: Mapping[str, Any]) -> list[dict]:
    """'Ta prochaine action': awaited manual and decision items by latest start, then the other open proposals of
    this executor's range (cuts, red zone, divergence, ...). Each item: {n, ref, what_fr, when_where, latest}."""
    zones = zones_of(profile)
    executor = ctx.executor or "A"
    proposals = {b["id"]: b for b in open_proposals(ctx.layout)}
    items: list[tuple[str, str, dict]] = []
    listed: set[str] = set()
    for aw in (local.get("awaiting") or []):
        if not isinstance(aw, dict):
            continue
        ref = str(aw.get("ref"))
        latest = aw.get("latest_utc")
        if ref.startswith("T"):
            task = plan.by_id.get(ref)
            if task is None:
                continue
            manual = task.manual or {}
            steps = manual.get("steps") or []
            what = steps[0] if steps else task.title
            where = WHERE_FR.get(str(manual.get("where")), "ordinateur")
            latest = latest or manual.get("latest_start_utc")
            ts = statusio.state_of(ref, statuses, plan)
            if ts.raw.get("decision"):
                listed.add(str(ts.raw["decision"]))
        else:
            prop = proposals.get(ref)
            what = (prop or {}).get("title") or "décision à trancher"
            where = "téléphone ou ordinateur"
            latest = latest or (prop or {}).get("deadline_utc")
        listed.add(ref)
        when = f"avant {fr_display(_utc(latest), zones)} · {where}" if latest else f"dès que possible · {where}"
        items.append((str(latest or "9999"), ref, {"ref": ref, "what_fr": redact(" ".join(str(what).split())),
                                                    "when_where": when, "latest": latest}))
    items.sort(key=lambda t: (t[0], t[1]))
    extra: list[dict] = []
    for pid, prop in sorted(proposals.items()):
        if pid in listed or not in_range(pid, executor):
            continue
        latest = prop.get("deadline_utc")
        when = f"avant {fr_display(_utc(latest), zones)} · téléphone ou ordinateur" if latest else \
            "à trancher · téléphone ou ordinateur"
        extra.append({"ref": pid, "what_fr": redact(" ".join(str(prop.get("title", "")).split())),
                      "when_where": when, "latest": latest})
    out = [i for _l, _r, i in items] + extra
    for n, item in enumerate(out, start=1):
        item["n"] = n
    return out


_WAVE_SHRINK: Mapping[str, Sequence[str]] = {
    "fait": ("title",), "prouve": ("title", "verifier", "run_id"), "ouvert": ("title", "open_reason_fr"),
    "actions": ("what_fr", "ref"), "deadlines": ("deadline_display",), "pulse_extra": ("text",),
    "incoh": (),
}


def _render_wave_lists(template: str, values: Mapping[str, Any], lists: Mapping[str, list[dict]]) -> str:
    """Render the wave template line by line; a list cut by `capped` gets its '… et n autres' line after its
    items (that line bypasses the item format)."""
    out: list[str] = []
    for raw in template.split("\n"):
        m = _REPEAT.match(raw)
        if not m:
            out.append(render_template(raw, values, where="wave.fr.md"))
            continue
        name = m.group(2)
        if name not in lists:
            raise InternalError(f"template wave.fr.md: no list for {{{{{m.group(1)}{name}}}}}")
        items = lists[name]
        plain = [i for i in items if not i.get("__more__")]
        block = render_template(raw, values, lists={name: plain}, shrink=_WAVE_SHRINK, where="wave.fr.md")
        if block:  # an empty {{*list}} renders nothing, not a blank line
            out.append(block)
        more = [i for i in items if i.get("__more__")]
        if more:
            out.append(shorten("- " + str(more[0]["text"]), MAX_LINE))
    return "\n".join(out)


def render_wave_fr(ctx: Ctx, wave: str, plan: PlanModel, statuses: Mapping[str, dict],
                   schedule_cache: Mapping[str, Any] | None, governor: Mapping[str, Any] | None,
                   quota: Mapping[str, Any] | None) -> str:
    """The French wave report (NOTION.md 9.1) from `assets/report-templates/wave.fr.md`; ≤ 6,000 characters (lists
    are cut further when needed), every line ≤ 100 characters. Ends with a newline."""
    template = load_template("wave.fr.md").rstrip("\n")
    text = ""
    for cap in range(LIST_CAP, -1, -1):
        facts = wave_facts(ctx, wave, plan, statuses, schedule_cache, governor, quota, cap=cap)
        text = _render_wave_lists(template, facts["values"], facts["lists"]) + "\n"
        if len(text) <= MAX_REPORT_CHARS:
            return text
    raise InternalError(f"the wave report of {wave} exceeds {MAX_REPORT_CHARS} characters even with empty lists")


# --- push texts ----------------------------------------------------------------------------------------------------

def push_templates() -> dict:
    doc = json.loads(load_template("push.fr.json"))
    if not isinstance(doc, dict) or doc.get("schema") != "execution.push-fr/1":
        raise InternalError("assets/report-templates/push.fr.json is not an execution.push-fr/1 document")
    return doc


def render_push(name: str, values: Mapping[str, Any]) -> str:
    """One push text of push.fr.json, rendered and cut to 200 characters."""
    templates = push_templates()
    if name not in templates or name == "schema":
        raise InternalError(f"push.fr.json has no entry {name!r}")
    return shorten(_fill(str(templates[name]), values, f"push.fr.json:{name}"), MAX_PUSH_CHARS)


def push_text_fr(actions: Sequence[Mapping[str, Any]], profile: Mapping[str, Any], wave: str | None) -> str | None:
    """The wave push (≤ 200 characters, names the first item's id) when the owner has something to do; else None."""
    if not actions:
        return None
    first = actions[0]
    project = str(((profile or {}).get("project") or {}).get("name") or "execution")
    zones = zones_of(profile)
    latest = _utc(first.get("latest"))
    more = f" (+{len(actions) - 1} autre{'s' if len(actions) > 2 else ''})" if len(actions) > 1 else ""
    values = {"project": project, "wave": wave or "", "id": first.get("ref", ""),
              "what": shorten(str(first.get("what_fr", "")), 70),
              "latest": fr_display(latest, zones, first_only=True) if latest else "dès que possible", "more": more}
    text = render_push("wave_action", values)
    if str(first.get("ref", "")) not in text:
        values["what"] = shorten(str(first.get("what_fr", "")), 20)
        text = render_push("wave_action", values)
    return text


# --- EXECUTION.md (English, TASKLIST style) -------------------------------------------------------------------------

_OWNER_EN = {"agent": "C", "devA": "A", "devB": "B"}
_TICKED = frozenset({"done"})
_STRUCK = frozenset({"cut", "superseded"})


def _latest_utc(task: Task) -> str | None:
    if task.deadline is not None:
        return clock.format_utc(task.deadline)
    manual = task.manual or {}
    if manual.get("latest_start_utc"):
        return str(manual["latest_start_utc"])
    return None


def render_execution_md(plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any]) -> str:
    """EXECUTION.md: one box per task, grouped by phase in plan order; a box is ticked only when the task is done
    (its receipt exists). Deterministic: no clock, only the plan, the status files and the profile."""
    zones = zones_of(profile)
    name = str(((profile or {}).get("project") or {}).get("name") or plan.raw.get("project") or "project")
    lines = [
        f"# EXECUTION — {name}: the build is not finished until every box is ticked",
        "",
        f"Generated by `exec.py report --view` from plan.json v{plan.version} and the status files; never edit it "
        "by hand.",
        "A box is ticked only when its proof is satisfied (a verdict receipt under `proofs/`). Owner: \"C\" = an "
        "agent does it, \"A\" = dev A, \"B\" = dev B. Dates are the latest acceptable (UTC, then the display "
        "zones).",
        "",
    ]
    done = sum(1 for t in plan.tasks if statusio.state_of(t.id, statuses, plan).status == "done")
    lines.append(f"Progress: {done}/{len(plan.tasks)} tasks done.")
    phases: list[str] = []
    for task in plan.tasks:
        if task.phase not in phases:
            phases.append(task.phase)
    for phase in phases:
        lines.append("")
        lines.append(f"## {phase}")
        lines.append("")
        for task in plan.tasks:
            if task.phase != phase:
                continue
            ts = statusio.state_of(task.id, statuses, plan)
            box = "[x]" if ts.status in _TICKED else "[ ]"
            title = f"~~{task.title}~~" if ts.status in _STRUCK else task.title
            owner = _OWNER_EN.get(task.owner, task.owner)
            proof = (task.proof or {}).get("type", "?")
            summary = ((task.proof or {}).get("expect") or {}).get("summary", "")
            latest = _latest_utc(task)
            if latest:
                shown = ", ".join(clock.display(clock.parse_utc(latest), zones)[0].values()) if zones else ""
                latest_text = f"{latest} ({shown})" if shown else latest
            else:
                latest_text = "none"
            receipt = ts.raw.get("receipt")
            status_text = ts.status + (f", receipt `{receipt}`" if receipt else "")
            deps = ", ".join(task.depends_on) if task.depends_on else "none"
            lines.append(f"- {box} **{owner}** — **{task.id}** {redact(title)} · executor {task.executor} · "
                         f"proof: {proof} ({redact(summary)}) · latest: {latest_text} · depends on: {deps} · "
                         f"status: {status_text}")
    return "\n".join(lines) + "\n"


# --- approval summary and hand-over --------------------------------------------------------------------------------

def render_approval_fr(values: Mapping[str, Any], *, manual_tasks: Sequence[Mapping[str, Any]],
                       decision_gates: Sequence[Mapping[str, Any]], risks: Sequence[Mapping[str, Any]],
                       critical_path: Sequence[str]) -> str:
    """The French approval summary from approval.fr.md. `values`: project, plan_version, n_tasks, n_agent,
    n_manual, n_decisions, p50, p80, p90 (French display strings), decision_id, recommended. Lists: manual_tasks
    [{task_id, title, latest}], decision_gates [{task_id, title}], risks [{text}]."""
    vals = dict(values)
    vals["critical_path"] = ", ".join(critical_path) if critical_path else "inconnu"
    lists = {"manual_tasks": [dict(i) for i in manual_tasks], "decision_gates": [dict(i) for i in decision_gates],
             "risks": [dict(i) for i in risks]}
    shrink = {"manual_tasks": ("title",), "decision_gates": ("title",), "risks": ("text",)}
    text = render_template(load_template("approval.fr.md").rstrip("\n"), vals, lists=lists, shrink=shrink,
                           where="approval.fr.md")
    return text + "\n"


def render_handover_fr(values: Mapping[str, Any]) -> tuple[str, str]:
    """The hand-over text (HANDOVER.md 3.5) and its push text (≤ 200 characters). `values` carries every
    placeholder of handover.fr.md plus final_sha8, type_this_short and harden_start_latest for the push."""
    text = render_template(load_template("handover.fr.md").rstrip("\n"), values, where="handover.fr.md",
                           limit=None)
    push = render_push("handover", values)
    return text + "\n", push


def stuck_push_fr(project: str) -> str:
    """The French STUCK push the Stop hook appends on its last continuation (HOOKS.md 4.3)."""
    return render_push("stuck", {"project": project})


# --- the command ------------------------------------------------------------------------------------------------------

def _default_wave(local: Mapping[str, Any]) -> str:
    waves = [w for w in (local.get("waves") or []) if isinstance(w, dict)]
    for wanted in ("ingested", "finished"):
        found = [w["wave"] for w in waves if w.get("status") == wanted]
        if found:
            return sorted(found, key=lambda w: int(w[1:]))[-1]
    raise UsageError("no ingested wave to report on", hint="pass --wave Wnn or run exec.py wave ingest first")


def cmd_report(ctx: Ctx, args: Namespace) -> CommandResult:
    """`exec.py report [--wave Wnn] [--view]` (CLI.md 7)."""
    layout = ctx.layout
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    plan = plan_mod.load(layout)
    statuses = statusio.load_all(layout)
    profile = _read_json_or_none(layout.profile)
    if not isinstance(profile, dict):
        raise UsageError(f"no profile at {paths.posix(layout.profile)}", hint="run exec.py ingest first")
    with _locks.hold(layout, "state", command=ctx.command):
        local = state.load(layout)
        execution_md = render_execution_md(plan, statuses, profile)
        jsonio.write_text_atomic(layout.execution_md, execution_md)
        if args.view:
            state._write_event(ctx, local, "report.written", {"view": True, "execution_md": "EXECUTION.md"})
            state.save(ctx, local)
            return CommandResult(data={"report_path": None, "execution_md": layout.rel(layout.execution_md),
                                       "text_fr": None, "push_text_fr": None, "notion": None})
        wave = args.wave or _default_wave(local)
        if not re.match(r"^W[0-9]{2,3}$", wave):
            raise UsageError(f"not a wave id: {wave!r}")
        schedule_cache = _read_json_or_none(layout.schedule_cache)
        text = render_wave_fr(ctx, wave, plan, statuses, schedule_cache if isinstance(schedule_cache, dict) else None,
                              local.get("governor"), local.get("quota"))
        path = layout.report(wave)
        jsonio.write_text_atomic(path, text)
        actions = next_actions(ctx, plan, statuses, profile, local)
        push = push_text_fr(actions, profile, wave)
        state._write_event(ctx, local, "report.written",
                           {"wave": wave, "report": layout.rel(path), "chars": len(text), "push": push is not None})
        state.save(ctx, local)
    return CommandResult(data={"report_path": layout.rel(path), "execution_md": layout.rel(layout.execution_md),
                               "text_fr": text, "push_text_fr": push,
                               "notion": f"run {paths.exec_cmd()} notion diff --wave {wave}"})
