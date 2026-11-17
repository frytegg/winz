"""The never-show list (contract/MODULES.md 4, SCHEMAS.md 8, never-show.schema.json; /frontend's format).

An entry is active iff until_utc is null or in the future. Literal entries match as substrings; regex entries with
Python `re`. Case-insensitive matching folds NFKC then `lower()` on both sides, never `casefold()` (so it agrees with
/frontend's NFKC + JS toLowerCase, e.g. on ß; Q-F9); a case-insensitive regex gets re.IGNORECASE. A `Hit` never
carries the matched text: only the entry id and where.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Sequence

from . import jsonio, schema
from .clock import parse_utc
from .errors import ErrorItem, ValidationFailed, warn
from .log import get_logger
from .paths import other_skill

FRONTEND_SCHEMA_REL = "assets/schemas/never-show.schema.json"
_LOG = get_logger("execlib.nevershow")


@dataclass(frozen=True)
class Entry:
    id: str
    cls: str
    pattern: str
    regex: bool
    case_sensitive: bool
    until: datetime | None
    scope: str


@dataclass(frozen=True)
class Hit:
    entry_id: str
    file: str | None
    line: int | None


def fold(text: str) -> str:
    """NFKC then lower(), never casefold (Q-F9)."""
    return unicodedata.normalize("NFKC", text).lower()


_COMPILED: dict[tuple[str, bool], re.Pattern[str]] = {}


def _regex(entry: Entry) -> re.Pattern[str]:
    key = (entry.pattern, entry.case_sensitive)
    rx = _COMPILED.get(key)
    if rx is None:
        rx = re.compile(entry.pattern, 0 if entry.case_sensitive else re.IGNORECASE)
        _COMPILED[key] = rx
    return rx


def load(path: Path) -> tuple[list[Entry], list[ErrorItem]]:
    """Entries of the never-show file, validated against our schema and, when /frontend's exists, against it too
    (W_NEVER_SHOW_SCHEMA_DRIFT when the two disagree on the document). An invalid file or regex is E_SCHEMA."""
    p = Path(path)
    doc = jsonio.read_json(p)
    ours = schema.validate(doc, "never-show")
    warnings: list[ErrorItem] = []
    theirs_path = other_skill("frontend") / FRONTEND_SCHEMA_REL
    if theirs_path.is_file():
        try:
            theirs_doc = json.loads(theirs_path.read_text(encoding="utf-8"))
            theirs = schema.validate_with(doc, theirs_doc, base_dir=theirs_path.parent)
            if theirs.ok != ours.ok:
                item = ErrorItem("W_NEVER_SHOW_SCHEMA_DRIFT",
                                 f"/frontend's never-show schema says {'valid' if theirs.ok else 'invalid'}, ours says "
                                 f"{'valid' if ours.ok else 'invalid'}", path=p.as_posix())
                warnings.append(item)
                warn(item)
        except json.JSONDecodeError as err:
            item = ErrorItem("W_NEVER_SHOW_SCHEMA_DRIFT", f"/frontend's never-show schema is unreadable: {err.msg}",
                             path=theirs_path.as_posix())
            warnings.append(item)
            warn(item)
    if not ours.ok:
        items = [ErrorItem("E_SCHEMA", i.message, path=i.instance_path or "/") for i in ours.issues[:20]]
        raise ValidationFailed(f"never-show file {p.as_posix()} is invalid: {ours.issues[0].message}",
                               code="E_SCHEMA", items=items)
    entries: list[Entry] = []
    for i, raw in enumerate(doc["entries"]):
        until = parse_utc(raw["until_utc"]) if raw["until_utc"] is not None else None
        entry = Entry(id=raw["id"], cls=raw["class"], pattern=raw["pattern"], regex=bool(raw["regex"]),
                      case_sensitive=bool(raw["case_sensitive"]), until=until, scope=raw["scope"])
        if entry.regex:
            try:
                _regex(entry)
            except re.error as err:
                raise ValidationFailed(f"never-show entry {entry.id} has an invalid regex ({err})", code="E_SCHEMA",
                                       items=[ErrorItem("E_SCHEMA", f"invalid regex in entry {entry.id}",
                                                        path=f"/entries/{i}/pattern")]) from err
        entries.append(entry)
    return entries, warnings


def active(entries: Sequence[Entry], now: datetime, scopes: frozenset[str] = frozenset({"repo", "both"})
           ) -> list[Entry]:
    """Entries whose until_utc is null or in the future, of the given scopes."""
    return [e for e in entries if e.scope in scopes and (e.until is None or e.until > now)]


def _line_hits(text: str, entries: Sequence[Entry]) -> list[str]:
    hits: list[str] = []
    folded: str | None = None
    for e in entries:
        if e.regex:
            if _regex(e).search(text):
                hits.append(e.id)
        elif e.case_sensitive:
            if e.pattern in text:
                hits.append(e.id)
        else:
            if folded is None:
                folded = fold(text)
            if fold(e.pattern) in folded:
                hits.append(e.id)
    return hits


def scan_text(text: str, entries: Sequence[Entry], *, file: str | None = None) -> list[Hit]:
    """Hits per line (1-based) of `text`; never the matched text."""
    hits: list[Hit] = []
    for lineno, line in enumerate((text or "").split("\n"), start=1):
        for eid in _line_hits(line, entries):
            hits.append(Hit(entry_id=eid, file=file, line=lineno))
    return hits


def scan_lines(lines: Iterable[tuple[str, int, str]], entries: Sequence[Entry]) -> list[Hit]:
    """Hits over (file, line number, text) triples, e.g. gitutil.Git.added_lines."""
    hits: list[Hit] = []
    for file, lineno, text in lines:
        for eid in _line_hits(text, entries):
            hits.append(Hit(entry_id=eid, file=file, line=lineno))
    return hits
