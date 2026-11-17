"""Posting ready manual and decision tasks to the owner (contract/MODULES.md 5 `manual.py`, CLI.md `manual post`,
ARCHITECTURE.md 11, NOTION.md 2.4).

`manual post` moves each ready human task to running with its French push text (≤ 200 characters, naming the task
id) recorded in the status entry, adds the item to `local/state.json.awaiting` and queues the Notion row update.
A decision task also opens its linked proposal, of the kind named by the template's `decision_kind` (copied into
`params.decision_kind`; default plan-task), with options from `manual.options` or the folders of
`manual.options_source` (FE-03's directions, FE-05's logo candidates; `generic` excluded). Without `--repost` an
already-posted task is listed under `already_posted` and nothing changes (idempotent).
"""
from __future__ import annotations

import json
import re
from argparse import Namespace
from pathlib import Path
from typing import Any

from . import clock, decisions, events, jsonio, plan as planmod, state, status, statusio
from .errors import PolicyRefused, UsageError, ValidationFailed
from .model import CommandResult, Ctx, PlanModel, Task
from .paths import posix, skill_path

PUSH_FR_PATH: Path = skill_path("assets", "report-templates", "push.fr.json")
_PLACEHOLDER = re.compile(r"\{\{([a-z_0-9]+)\}\}")
WHERE_FR = {"phone": "sur ton téléphone", "laptop": "à l'ordinateur", "venue": "sur place"}
_MONTHS_FR = ("janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc.")
_DAYS_FR = ("lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim.")
PUSH_MAX = 200


def _short_fr(at_utc: str | None, profile: dict | None) -> str:
    """'mer. 7 oct. 23:59 SGT' in the first display zone (UTC when the profile has none)."""
    if not at_utc:
        return ""
    dt = clock.parse_utc(at_utc)
    zones = clock.zones_from_profile(profile or {})
    if zones:
        from datetime import timedelta, timezone

        zone = zones[0]
        try:
            from zoneinfo import ZoneInfo

            local = dt.astimezone(ZoneInfo(zone.iana))
        except Exception:  # noqa: BLE001 - no tz database: the profile's fixed offset (W_TZ_FALLBACK path)
            local = dt.astimezone(timezone(timedelta(minutes=zone.fallback_utc_offset_min)))
        label = zone.label
    else:
        local, label = dt, "UTC"
    return f"{_DAYS_FR[local.weekday()]} {local.day} {_MONTHS_FR[local.month - 1]} {local:%H:%M} {label}"


def push_templates() -> dict | None:
    """assets/report-templates/push.fr.json (lane B09's phrases: `manual` and `decision`), or None when absent or
    not an execution.push-fr/1 document. Read as an asset: MODULES.md 8 gives manual no `report` edge."""
    try:
        doc = json.loads(PUSH_FR_PATH.read_bytes().decode("utf-8"))
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) and doc.get("schema") == "execution.push-fr/1" else None


def _fill(template: str, values: dict[str, str]) -> str | None:
    """{{name}} placeholders filled; None when the template names a placeholder this module does not know."""
    names = _PLACEHOLDER.findall(template)
    if any(n not in values for n in names):
        return None
    return _PLACEHOLDER.sub(lambda m: values[m.group(1)], template)


def _from_template(template: str, task: Task, profile: dict | None) -> str | None:
    manual = task.manual or {}
    project = str(((profile or {}).get("project") or {}).get("name") or "execution")
    values = {"project": project, "id": task.id,
              "where": WHERE_FR.get(str(manual.get("where")), str(manual.get("where") or "")),
              "latest": _short_fr(manual.get("latest_start_utc") if task.kind == "manual"
                                  else manual.get("decision_deadline_utc") or manual.get("latest_start_utc"),
                                  profile) or "dès que possible",
              "what": ""}
    bare = _fill(template, values)
    if bare is None:
        return None
    room = PUSH_MAX - len(bare)
    if room < 8 and len(project) > 12:  # a long project name gives way to the task's own words
        values["project"] = project[:11].rstrip() + "…"
        bare = _fill(template, values) or bare
        room = PUSH_MAX - len(bare)
    title = task.title
    values["what"] = title if len(title) <= room else title[: max(0, room - 1)].rstrip() + "…"
    text = _fill(template, values) or ""
    if len(text) > PUSH_MAX or task.id not in text:
        return None
    return text


def push_text_fr(task: Task, profile: dict | None) -> str:
    """The French push of a manual or decision task: ≤ 200 characters, names the task id (P-14). The planner's
    `manual.push_text` is used when it is present and names the id; otherwise push.fr.json's `manual` or `decision`
    phrase (lane B09) is filled; the built-in phrase below is the fallback when that file is absent."""
    manual = task.manual or {}
    own = manual.get("push_text")
    if isinstance(own, str) and task.id in own and len(own) <= PUSH_MAX:
        return own
    templates = push_templates() or {}
    template = templates.get("decision" if task.kind == "decision" else "manual")
    if isinstance(template, str):
        text = _from_template(template, task, profile)
        if text is not None:
            return text
    nature = "Décision" if task.kind == "decision" else "À faire"
    where = WHERE_FR.get(str(manual.get("where")), "")
    when = _short_fr(manual.get("latest_start_utc"), profile)
    tail = f" ({where}, avant {when})." if where and when else "."
    tail += " Réponds par Remote Control ou dans Notion."
    head = f"{task.id} · {nature} : "
    room = PUSH_MAX - len(head) - len(tail)
    title = task.title if len(task.title) <= room else task.title[: max(0, room - 1)].rstrip() + "…"
    text = head + title + tail
    if len(text) > PUSH_MAX:
        text = (head + title)[: PUSH_MAX - 1] + "…"
    return text


def _options_for(task: Task) -> list[dict]:
    manual = task.manual or {}
    options = [dict(o) for o in manual.get("options") or ()]
    source = manual.get("options_source")
    if not options and source:
        folder = Path(str(source))
        if folder.is_dir():
            for d in sorted(p for p in folder.iterdir() if p.is_dir() and p.name.lower() != "generic"):
                oid = d.name.lower()
                if re.match(r"^[a-z0-9][a-z0-9-]{0,30}$", oid):
                    options.append({"id": oid, "label": f"Option {d.name}",
                                    "consequence": f"{posix(d)} est retenue"})
    return options


def _display(at_utc: str | None, profile: dict | None) -> dict | None:
    if not at_utc:
        return None
    shown, _w = clock.display(clock.parse_utc(at_utc), clock.zones_from_profile(profile or {}))
    return {"utc": at_utc, "display": shown}


def post(ctx: Ctx, task_ids: list[str], repost: bool, link: str | None) -> dict:
    """Post (state lock held by the caller). Returns the data of CLI.md `manual post`."""
    plan = planmod.load(ctx.layout)
    profile = jsonio.read_json(ctx.layout.profile) if ctx.layout.profile.exists() else None
    doc = statusio.load(ctx.layout, str(ctx.executor))
    waiting: list[dict] = []
    posted: list[dict] = []
    already: list[str] = []
    changed = False
    for tid in task_ids:
        task = plan.by_id.get(tid)
        if task is None:
            raise UsageError(f"unknown task {tid}")
        if task.kind not in status.HUMAN_KINDS:
            raise UsageError(f"{tid} is a {task.kind} task: only manual and decision tasks are posted")
        if task.executor != ctx.executor:
            raise PolicyRefused(f"{tid} belongs to orchestrator {task.executor}", code="E_POLICY",
                                hint="each orchestrator posts its own tasks (TWO-DEV.md 6)")
        current = status.current_status(doc, tid)
        entry = status.entry_of(doc, tid)
        text = push_text_fr(task, profile)
        if link and len(text) + 1 + len(link) <= PUSH_MAX:
            text = f"{text} {link}"
        now = clock.format_utc(ctx.now)
        if current == "running" and entry and entry.get("posted"):
            if not repost:
                already.append(tid)
                continue
            entry["posted"] = {"at_utc": now, "push_text": text,
                               "reposts": int(entry["posted"].get("reposts", 0)) + 1}
        elif current == "ready":
            entry = status.entry_of(doc, tid)
            if entry is None:
                entry = status.new_entry(ctx)
                entry["status"] = "ready"
                doc.setdefault("tasks", {})[tid] = entry
            entry["posted"] = {"at_utc": now, "push_text": text, "reposts": 0}
            if task.kind == "decision":
                options = _options_for(task)
                if len(options) < 1:
                    raise ValidationFailed(f"{tid}: no options in manual.options or {task.manual.get('options_source')}"
                                           if task.manual else f"{tid}: no options", code="E_MANUAL")
                kind = str((task.raw.get("params") or {}).get("decision_kind") or "plan-task")
                did, _dedup = decisions.propose(ctx, kind=kind, title=f"{tid} · {task.title}"[:160], options=options,
                                                tasks=[tid], deadline=(task.manual or {}).get("decision_deadline_utc"),
                                                recommended=None)
                entry["decision"] = did
            status.transition(ctx, doc, task, "running", evidence=[f"posted:{now}"], plan=plan)
        else:
            raise PolicyRefused(f"{tid} is {current}: only a ready task is posted (or a posted one with --repost)",
                                code="E_TRANSITION_REFUSED")
        changed = True
        manual = task.manual or {}
        waiting.append({"kind": "decision" if task.kind == "decision" else "manual", "ref": tid, "since": now,
                        "latest": manual.get("latest_start_utc")})
        decisions.queue_notion(ctx, tid, {"État": "Attend ta réponse", "Ingérée": "__NO__"}, purpose="post")
        events.append(ctx, "manual.posted", {"task": tid, "repost": current == "running", "link": link,
                                             "push_text": text})
        posted.append({"task": tid, "push_text_fr": text, "where": manual.get("where"),
                       "latest_start": _display(manual.get("latest_start_utc"), profile),
                       "steps": list(manual.get("steps") or []),
                       "bring_back": [dict(b) for b in manual.get("bring_back") or ()],
                       "decision": (status.entry_of(doc, tid) or {}).get("decision"), "link": link})
    if changed:
        statusio.save(ctx, doc)
        st = decisions.load_local(ctx)
        if st is not None:
            for item in waiting:
                decisions.awaiting_add(st, kind=item["kind"], ref=item["ref"], since=item["since"],
                                       latest=item["latest"])
            state.save(ctx, st)
    return {"posted": posted, "already_posted": already, "notion": "run exec.py notion diff"}


def _ready_human(ctx: Ctx, plan: PlanModel) -> list[str]:
    doc = statusio.load(ctx.layout, str(ctx.executor))
    return [t.id for t in plan.tasks if t.kind in status.HUMAN_KINDS and t.executor == ctx.executor
            and status.current_status(doc, t.id) == "ready"]


def cmd_post(ctx: Ctx, args: Namespace) -> CommandResult:
    """`manual post --task T ... | --all-ready [--repost] [--link URL]`."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    if not args.tasks and not args.all_ready:
        raise UsageError("give --task T (repeatable) or --all-ready")
    if args.link and not re.match(r"^https?://\S+$", str(args.link)):
        raise UsageError("--link must be an http(s) URL")
    with status.state_lock(ctx):
        ids: list[Any] = list(args.tasks)
        if args.all_ready:
            ids += _ready_human(ctx, planmod.load(ctx.layout))
        seen: list[str] = []
        for tid in ids:
            if tid not in seen:
                seen.append(tid)
        data = post(ctx, seen, bool(args.repost), args.link)
    return CommandResult(data=data)
