"""The feature catalogue for /frontend (contract/SCHEMAS.md 6.3, FRONTEND.md 5).

One entry per requirement with `surface: ui`, in `requirements` order: `{id, group, title, priority}` plus
`status_expected` when not null. Written to `profile.paths.feature_catalogue` through `jsonio` (keys sorted inside
each entry, the array in plan order, LF, final newline), so the same plan gives the same bytes. Validated against
our `feature-catalogue.schema.json` and, when present, /frontend's own (which also requires at least one entry). A
plan with no ui requirement writes no catalogue.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import jsonio, schema
from .errors import ErrorItem, ValidationFailed
from .log import get_logger
from .model import Ctx
from .paths import other_skill

FRONTEND_SCHEMA_REL = "assets/schemas/feature-catalogue.schema.json"
_LOG = get_logger("execlib.catalogue")


def generate(plan_raw: dict) -> list[dict]:
    """SCHEMAS.md 6.3: the ui requirements in plan order."""
    out: list[dict] = []
    for r in plan_raw.get("requirements") or ():
        if r.get("surface") != "ui":
            continue
        entry = {"id": r["id"], "group": r["feature_group"], "title": r["title"], "priority": r["priority"]}
        if r.get("status_expected") is not None:
            entry["status_expected"] = r["status_expected"]
        out.append(entry)
    return out


def check(entries: list[dict]) -> list[ErrorItem]:
    """Our schema always; /frontend's when its file exists (absence is logged, our schema still validates)."""
    items: list[ErrorItem] = []
    rep = schema.validate(entries, "feature-catalogue")
    items += [ErrorItem("E_SCHEMA", i.message, path=i.instance_path or "/") for i in rep.issues]
    ids = [e.get("id") for e in entries]
    if len(set(ids)) != len(ids):
        items.append(ErrorItem("E_SCHEMA", "feature catalogue ids are not unique"))
    path = other_skill("frontend") / FRONTEND_SCHEMA_REL
    if path.is_file():
        theirs = json.loads(path.read_text(encoding="utf-8"))
        rep2 = schema.validate_with(entries, theirs, base_dir=path.parent)
        items += [ErrorItem("E_SCHEMA", f"/frontend's catalogue schema: {i.message}", path=i.instance_path or "/")
                  for i in rep2.issues]
    else:
        _LOG.warning("/frontend's feature-catalogue schema is absent; validated against ours only",
                     extra={"data": {"path": path.as_posix()}})
    return items


def target_path(profile: dict, ctx_state: Path) -> Path:
    """profile.paths.feature_catalogue, else <state>/feature-catalogue.json."""
    p = ((profile or {}).get("paths") or {}).get("feature_catalogue")
    return Path(p) if p else Path(ctx_state) / "feature-catalogue.json"


def write(ctx: Ctx, profile: dict, entries: list[dict]) -> Path:
    """Write the catalogue to profile.paths.feature_catalogue (schema-checked)."""
    items = check(entries)
    if items:
        raise ValidationFailed(f"the feature catalogue is invalid: {items[0].message}", code="E_SCHEMA", items=items)
    path = target_path(profile, ctx.layout.state)
    jsonio.write_json_atomic(path, entries)
    return path


def sha256_of(entries: list[dict]) -> str:
    return jsonio.sha256_bytes(jsonio.dumps_document(entries).encode("utf-8"))
