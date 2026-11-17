"""The Notion mirror as data: exact MCP operation batches, their acknowledgements, the outbox and the poll plan
(contract/CLI.md 6, NOTION.md, MODULES.md 5, assets/schemas/notion-ops.schema.json).

exec.py never calls Notion. `notion diff` and `notion poll-plan` write a batch (`local/notion/batches/<id>.json`)
that the orchestrator executes verbatim, op by op, handing each raw tool result back to `notion ack`. An op never
uses an id another op of the same batch produces: anything that needs an earlier id is emitted by the next call as
the next stage.

What this module guarantees (tested in test_notion.py):
- only rows of this executor (task rows whose plan executor is ours, decision rows of our id range, our waves, our
  "Now" block); owner-owned properties (Réponse, Répondu, Décision, Pièces jointes) never appear in any op;
- a row is created once and updated only when what the owner sees changed (row hash over the orchestrator-owned
  properties and the page body); only the changed properties are sent;
- every text property, page body and proof link passes `log.redact` and the secret scan
  (`integrity.scan_secrets_text`): a hit is replaced by `[redacted:<pattern id>]` with W_SECRET_REDACTED; a value
  proven public (README.md 8: listed in the state repo's `public-values.jsonl`, or right after `/tx/`, `/txs/` or
  `/transaction/` in an explorer link's path) passes verbatim, the scan receiving `integrity.load_public_values`;
- a failed op goes to the outbox; the next batch is one real read (the token check) before anything is replayed;
  creates are replayed only after the `view:board` map rebuild, so a create whose ack was lost is never duplicated;
- polls read the "À ingérer" view in view mode only (quota-free), never rows mode, never SQL.

Machine-local files (all under `local/notion/`): `batches/`, `results/` (written by the orchestrator), `outbox.jsonl`,
`ids.json`, `access.json`, `rate.json`, `poll.json`, `queue.jsonl` (set-ingested requests from `answers ingest` and
`decision resolve`), `divergence.json`, `degraded.json`, `hub-now.txt`, `profile-ids.patch.json`, and `ledger.json`
(this module's bookkeeping: acks per batch, the values each op will make true, the last acknowledged values per row,
init facts, async polls, replay progress; contract question Q-B09-3).

Layering (MODULES.md 8): notion imports plan, statusio, state, events and integrity (lazily: lane B06). The `locks`
module is reached through `state` (contract question Q-B09-1); decisions.md is read as data (Q-B09-2).
"""
from __future__ import annotations

import functools
import importlib
import json
import math
import re
from argparse import Namespace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import clock, events, jsonio, paths, plan as plan_mod, state, statusio
from .errors import CheckFailed, DependencyMissing, ErrorItem, InternalError, UsageError, warn
from .log import get_logger, redact, redaction_ids
from .model import CommandResult, Ctx, PlanModel, Task

_LOG = get_logger("execlib.notion")
# MODULES.md 8 gives `notion -> plan, statusio, state, events, integrity`; the notion and state locks are taken
# through `state`, which imports `locks`; the batch schema check uses `state`'s `schema` the same way (Q-B09-1).
_locks = state.locks
_schema = state.schema

LEDGER_SCHEMA = "execution.notion-ledger/1"
BATCH_SCHEMA = "execution.notion-ops/1"
MAX_OPS = 60
MAX_TICK_CALLS = 150
MAX_QUERIES = 10
QUERY_SPACING_S = 10
PAGES_PER_CREATE = 100
RELATIONS_PER_REQUEST = 100
HUB_MIN_INTERVAL_MIN = 10
HUB_MAX_CHARS = 1500
MAX_REPLAY_ATTEMPTS = 5
MAX_ASYNC_POLLS = 10
CRASH_REBUILD_DELAY_S = 60
TITLE_MAX = 120
OPTIONS_MAX = 2000
REQUIRED_TOOLS: tuple[str, ...] = ("fetch", "create_database", "update_data_source", "create_view", "create_pages",
                                   "update_page", "query_data_sources", "get_async_task")
OK_ACCESS = frozenset({"available", "available_with_limit"})

# --- labels (NOTION.md 2.2, 2.3) ----------------------------------------------------------------------------------

STATE_LABELS_FR: Mapping[str, str] = {
    "planned": "Prévue", "ready": "Prête", "running": "En cours", "built": "Intégrée", "verifying": "En vérification",
    "done": "Prouvée", "failed": "Échec", "blocked-manual": "Bloquée (action)", "blocked-decision": "Bloquée (décision)",
    "cut-proposed": "Coupe proposée", "cut": "Coupée", "superseded": "Remplacée"}
AWAITING_LABEL = "Attend ta réponse"
RESOLVED_LABEL = "Tranchée"
STATE_OPTIONS: tuple[tuple[str, str], ...] = (
    ("Prévue", "gray"), ("Prête", "blue"), ("En cours", "yellow"), (AWAITING_LABEL, "red"), ("Intégrée", "purple"),
    ("En vérification", "purple"), ("Prouvée", "green"), ("Échec", "orange"), ("Bloquée (action)", "red"),
    ("Bloquée (décision)", "red"), ("Coupe proposée", "pink"), ("Coupée", "brown"), ("Remplacée", "brown"),
    (RESOLVED_LABEL, "green"))
PHASE_FR: Mapping[str, str] = {
    "setup": "Mise en place", "contract": "Contrat", "build": "Construction", "integrate": "Intégration",
    "verify": "Vérification", "ops": "Exploitation", "recon": "Veille", "audit": "Audit", "manual": "Manuel",
    "decision": "Décision", "deliverable": "Livrable", "fix": "Correctif"}
OWNER_FR: Mapping[str, str] = {"agent": "Agent", "devA": "Dev A", "devB": "Dev B"}
KIND_FR: Mapping[str, str] = {
    "tx-hash": "hash de transaction", "screenshot": "capture d'écran", "text": "texte", "transcript": "transcription",
    "file": "fichier", "choice": "choix", "url": "lien", "sha": "SHA de commit"}
METHOD_FR: Mapping[str, str] = {
    "chain-reread": "relu sur la chaîne", "file-exists": "fichier présent", "choice-in-options": "option valide",
    "regex": "format vérifié", "sha-on-origin-main": "commit présent sur origin/main",
    "url-resolves": "lien qui répond", "owner-attest": "ta confirmation"}
WHERE_FR: Mapping[str, str] = {"phone": "téléphone", "laptop": "ordinateur", "venue": "sur place"}
ZONE_WORD: Mapping[str, str] = {"green": "verte", "yellow": "jaune", "red": "rouge", "unknown": "inconnue"}
ZONE_SELECT: Mapping[str, str] = {"green": "Verte", "yellow": "Jaune", "red": "Rouge", "unknown": "Inconnue"}
RUN_STATE_FR: Mapping[str, str] = {
    "RUNNING": "En marche", "AWAITING_HUMAN": "Attend une action", "AWAITING_DECISION": "Attend une décision",
    "PAUSED_QUOTA": "En pause (quota)", "PAUSED_RESOURCES": "En pause (disque ou RAM)",
    "STUCK": "Bloqué : regarde l'ordinateur", "BUILD_COMPLETE": "Build terminé",
    "HANDED_OVER": "Remis : tape /harden", "FIX": "Correctifs"}
OWNER_ONLY_KINDS = frozenset({"approval", "spec-validation", "cut", "policy-exception", "fix-selection"})
ID_RANGES: Mapping[str, tuple[int, int]] = {"A": (1, 499), "B": (500, 999)}
BUILD_COMPLETE = "DL-build-complete"

# properties 1-20 of NOTION.md 2.1 (orchestrator-owned) and 21-24 (owner-owned: never in any op)
ORCHESTRATOR_FIELDS: tuple[str, ...] = (
    "Tâche", "Clé", "État", "Nature", "Responsable", "Orchestrateur", "Phase", "Priorité", "Dépend de",
    "Dépend de (clés)", "date:Échéance:start", "date:Échéance:is_datetime", "Échéance (texte)", "Preuve",
    "Lien de preuve", "Vérifiée par", "Vague", "P80 (min)", "Options", "Ingérée")
OWNER_FIELDS: tuple[str, ...] = ("Réponse", "Répondu", "Décision", "Pièces jointes")
RELATION = "Dépend de"
TEXT_FIELDS: tuple[str, ...] = ("Tâche", "Dépend de (clés)", "Échéance (texte)", "Preuve", "Vérifiée par",
                                "Options", "Vague")

# --- DDL and views (NOTION.md 7.1, 4) -----------------------------------------------------------------------------

_W = "COMMENT 'Écrit par l''orchestrateur'"
DDL_TASKS: str = (
    "CREATE TABLE (\"Tâche\" TITLE " + _W + ", "
    "\"Clé\" RICH_TEXT COMMENT 'Identifiant du plan (T012, D-004) ; écrit par l''orchestrateur', "
    "\"État\" SELECT(" + ", ".join(f"'{label}':{colour}" for label, colour in STATE_OPTIONS) + ") " + _W + ", "
    "\"Nature\" SELECT('Agent':gray, 'Manuelle':orange, 'Décision':red, 'Porte':purple) " + _W + ", "
    "\"Responsable\" SELECT('Agent':gray, 'Dev A':blue, 'Dev B':green) " + _W + ", "
    "\"Orchestrateur\" SELECT('A':blue, 'B':green) COMMENT 'Seul cet orchestrateur écrit la ligne', "
    "\"Phase\" SELECT(" + ", ".join(f"'{label}':default" for label in PHASE_FR.values()) + ") " + _W + ", "
    "\"Priorité\" SELECT('P1':red, 'P2':yellow, 'P3':gray) " + _W + ", "
    "\"Dépend de (clés)\" RICH_TEXT " + _W + ", "
    "\"Échéance\" DATE COMMENT 'UTC ; lis plutôt Échéance (texte)', "
    "\"Échéance (texte)\" RICH_TEXT COMMENT 'Heure de Singapour et de Paris, zone', "
    "\"Preuve\" RICH_TEXT " + _W + ", "
    "\"Lien de preuve\" URL " + _W + ", "
    "\"Vérifiée par\" RICH_TEXT " + _W + ", "
    "\"Vague\" RICH_TEXT " + _W + ", "
    "\"P80 (min)\" NUMBER " + _W + ", "
    "\"Options\" RICH_TEXT COMMENT 'Décisions : identifiant = libellé', "
    "\"Ingérée\" CHECKBOX COMMENT 'Coché par l''orchestrateur quand ta réponse est enregistrée', "
    "\"Réponse\" RICH_TEXT COMMENT 'À toi', "
    "\"Répondu\" CHECKBOX COMMENT 'À toi : coche quand Réponse est complète', "
    "\"Décision\" RICH_TEXT COMMENT 'À toi : tape l''identifiant d''une option', "
    "\"Pièces jointes\" FILES COMMENT 'À toi')")
DDL_WAVES: str = (
    "CREATE TABLE (\"Vague\" TITLE, \"Orchestrateur\" SELECT('A':blue, 'B':green), \"Lancée\" DATE, \"Close\" DATE, "
    "\"Heures (texte)\" RICH_TEXT, \"Zone\" SELECT('Verte':green, 'Jaune':yellow, 'Rouge':red, 'Inconnue':gray), "
    "\"P80 fin de build\" RICH_TEXT, \"Prouvées\" NUMBER, \"Échecs\" NUMBER, \"Ouvertes\" NUMBER, "
    "\"Ta prochaine action\" RICH_TEXT, \"Pouls\" RICH_TEXT)")
_AWAIT = "\"État\" IN (\"Attend ta réponse\", \"Bloquée (action)\", \"Bloquée (décision)\", \"Coupe proposée\")"
_NEEDS_SHOW = "SHOW \"Tâche\", \"Échéance (texte)\", \"Options\", \"Réponse\", \"Décision\", \"Répondu\""
VIEWS: tuple[dict[str, str], ...] = (
    {"key": "board", "name": "Tableau", "db": "tasks", "type": "board",
     "configure": "GROUP BY \"État\"; SORT BY \"Échéance\" ASC; SHOW \"Tâche\", \"Responsable\", \"Échéance (texte)\", "
                  "\"Preuve\""},
    {"key": "needs_dev_a", "name": "À faire · Dev A", "db": "tasks", "type": "list",
     "configure": f"FILTER \"Responsable\" = \"Dev A\" AND {_AWAIT}; SORT BY \"Échéance\" ASC; {_NEEDS_SHOW}"},
    {"key": "needs_dev_b", "name": "À faire · Dev B", "db": "tasks", "type": "list",
     "configure": f"FILTER \"Responsable\" = \"Dev B\" AND {_AWAIT}; SORT BY \"Échéance\" ASC; {_NEEDS_SHOW}"},
    {"key": "to_ingest", "name": "À ingérer", "db": "tasks", "type": "table",
     "configure": "FILTER (\"Répondu\" = TRUE OR \"Décision\" IS NOT EMPTY) AND \"Ingérée\" = FALSE; SORT BY "
                  "\"Échéance\" ASC; SHOW \"Tâche\", \"Clé\", \"Orchestrateur\", \"Répondu\", \"Décision\""},
    {"key": "waves", "name": "Vagues", "db": "waves", "type": "list",
     "configure": "SORT BY \"Lancée\" DESC; SHOW \"Vague\", \"Zone\", \"P80 fin de build\", \"Ta prochaine action\", "
                  "\"Pouls\""},
)

# --- capture pointers (NOTION.md 6.2) -----------------------------------------------------------------------------

P_DS = r're:<data-source url="(collection://[0-9a-f-]{32,36})"'
P_DB = r"re:(?:notion\.so/|^|[^0-9a-f])(?:[A-Za-z0-9-]*-)?([0-9a-f]{32})(?![0-9a-f])"
P_VIEW = r're:(view://[0-9a-f-]{32,36}|https://www\.notion\.so/[^\s"<>]*\?v=[0-9a-f-]{32,36})'
P_ROWS = r're*:https://www\.notion\.so/(?:[^\s"<>/]*-)?([0-9a-f]{32})'
P_ASYNC = r're:"?task_id"?\s*[:=]\s*"?([A-Za-z0-9_-]+)'
P_TO_INGEST = r're*:"?Clé"?\s*[:=]\s*"?((?:T[0-9]{3,}|D-[0-9]{3,}))'
_NOTION_URL = re.compile(r"https://www\.notion\.so/[^\s\"<>]+")
_HEX32 = re.compile(r"[0-9a-f]{32}")


def _marker_start(executor: str) -> str:
    return f"### Maintenant · orchestrateur {executor}"


def _marker_end(executor: str) -> str:
    return f"— fin du bloc {executor} —"


HUB_CALLOUT = (
    "<callout color=\"gray_bg\">\n"
    "\t**Ce hub est un miroir.** La vérité est dans le dépôt d'état privé (.execution/). Tu réponds dans les colonnes "
    "Réponse, Répondu, Décision et Pièces jointes ; tout le reste est écrit par les orchestrateurs et sera réécrit.\n"
    "\tRéponses rapides : réponds au push par Remote Control. Les commentaires Notion ne sont pas des réponses.\n"
    "</callout>")


def _initial_block(executor: str) -> str:
    return f"{_marker_start(executor)}\n(en attente du premier tick)\n{_marker_end(executor)}"


def hub_skeleton(profile: Mapping[str, Any]) -> str:
    """The hub content written by init stage 2: the callout, block A, and block B when the profile has a dev with
    executor B and setup full (NOTION.md 1)."""
    parts = [HUB_CALLOUT, _initial_block("A")]
    if _two_full_devs(profile):
        parts.append(_initial_block("B"))
    return "\n".join(parts)


def _two_full_devs(profile: Mapping[str, Any]) -> bool:
    return any(d.get("executor") == "B" and d.get("setup") == "full"
               for d in ((profile.get("team") or {}).get("devs") or []) if isinstance(d, dict))


# --- small helpers ------------------------------------------------------------------------------------------------

def _notion_dir(layout: paths.Layout) -> Path:
    return layout.local / "notion"


def _file(layout: paths.Layout, name: str) -> Path:
    return _notion_dir(layout) / name


def _read(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return jsonio.read_json_retry(path)


def _utc(text: Any) -> datetime | None:
    if not isinstance(text, str):
        return None
    try:
        return clock.parse_utc(text)
    except UsageError:
        return None


def _fmt(dt: datetime) -> str:
    return clock.format_utc(dt)


def _cut(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def in_range(decision_id: str, executor: str) -> bool:
    try:
        n = int(decision_id[2:])
    except ValueError:
        return False
    lo, hi = ID_RANGES[executor]
    return lo <= n <= hi


def lognormal_p80(p50: float, p90: float) -> float:
    if p50 <= 0:
        return 0.0
    if p90 <= p50:
        return p50
    sigma = math.log(p90 / p50) / 1.2816
    return p50 * math.exp(0.8416 * sigma)


# French display, the same rendering as report.fr_display (report is on this module's layer, so it cannot be
# imported; test_notion asserts both agree; contract question Q-B09-4).
_FR_DAYS = {"Mon": "lun.", "Tue": "mar.", "Wed": "mer.", "Thu": "jeu.", "Fri": "ven.", "Sat": "sam.", "Sun": "dim."}
_FR_MONTHS = {"Jan": "janv.", "Feb": "févr.", "Mar": "mars", "Apr": "avr.", "May": "mai", "Jun": "juin",
              "Jul": "juil.", "Aug": "août", "Sep": "sept.", "Oct": "oct.", "Nov": "nov.", "Dec": "déc."}


def _fr_values(dt: datetime, zones: Sequence[clock.ZoneSpec]) -> list[tuple[str, str, str, bool]]:
    rendered, warnings = clock.display(dt, zones)
    fallen = {z.label for z in zones for w in warnings
              if w.code == "W_TZ_FALLBACK" and w.message.endswith(f"used for {z.label}")}
    out = []
    for zone in zones:
        parts = rendered[zone.label].split(" ")
        out.append((f"{_FR_DAYS[parts[0]]} {parts[1]} {_FR_MONTHS[parts[2]]}", parts[3], zone.label,
                    zone.label in fallen))
    return out


def fr_display(dt: datetime | None, zones: Sequence[clock.ZoneSpec], *, ref: datetime | None = None,
               first_only: bool = False) -> str:
    """'mer. 7 oct. 23:59 SGT · 17:59 Paris' (NOTION.md 9.4); identical to report.fr_display."""
    if dt is None:
        return "non mesuré"
    if not zones:
        return clock.format_utc(dt)
    values = _fr_values(dt, zones)
    ref_date = _fr_values(ref, zones[:1])[0][0] if ref is not None else None
    pieces: list[str] = []
    first_date = values[0][0]
    for i, (date, hm, label, fallback) in enumerate(values):
        lab = label + (" (décalage fixe)" if fallback else "")
        same_day = (i > 0 and date == first_date) or (i == 0 and ref_date == date)
        pieces.append(f"{hm} {lab}" if same_day else f"{date} {hm} {lab}")
        if first_only:
            break
    return " · ".join(pieces)


def _times_only(dt: datetime | None, zones: Sequence[clock.ZoneSpec]) -> str:
    """'14:20 SGT / 08:20 Paris' (the hub's tick)."""
    if dt is None or not zones:
        return "non mesuré"
    return " / ".join(f"{hm} {label}" for _d, hm, label, _f in _fr_values(dt, zones))


def _fr_num(value: Any) -> str:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "non mesuré"
    return f"{float(value):.1f}".replace(".", ",")


def _fr_pct(value: Any) -> str:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "non mesuré"
    return str(int(math.floor(float(value) + 0.5)))


def _fr_unit(value: Any, unit: str) -> str:
    """A reading with its unit ('6,2 Go', '41 %'), or 'non mesuré' alone (never 'non mesuré Go'), as report.fr_unit."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "non mesuré"
    return f"{_fr_pct(value)} %" if unit == "%" else f"{_fr_num(value)} {unit}"


# --- the secret scan on op text (CLI.md notion ack; lane B06's integrity) -------------------------------------------

def _integrity() -> Any:
    try:
        return importlib.import_module("execlib.integrity")
    except ModuleNotFoundError as err:
        if err.name == "execlib.integrity":
            raise DependencyMissing("execlib.integrity (lane B06) is absent: the secret scan of Notion op text "
                                    "cannot run, so no batch is emitted", code="E_DEPENDENCY_MISSING") from err
        raise


def _public_values(layout: paths.Layout) -> frozenset[str]:
    """The proven-public values of the state repo (README.md 8; `integrity.load_public_values`: the values of
    `public-values.jsonl`, lower-cased), read once per batch and passed to every scan of its text."""
    return frozenset(_integrity().load_public_values(layout))


# README.md 8 (contract revision 3): what `log.redact` leaves alone in Notion op text, because the scan does not count
# it as a hit either. An explorer link's value: right after /tx/, /txs/ or /transaction/ in the PATH of an http(s) URL
# (never in its query or fragment). A listed value: a whole token (no letter or digit on either side), matched
# without regard to case (the list is lower-cased); only a listed value shaped like a transaction hash (an optional
# 0x and at least 32 letters or digits) is held back, so a short listed string can never shield text from redaction.
_URL_RE = re.compile(r"https?://[^\s<>\"'`()\[\]{}|\\^]+")
_TX_PATH_RE = re.compile(r"/(?:tx|txs|transaction)/([0-9A-Za-z]+)")
_TX_SHAPED_RE = re.compile(r"(?:0x)?[0-9a-z]{32,}")
# The held-back spans become placeholders while log.redact runs over the whole text: private-use characters that no
# redaction pattern matches, at most 7 characters long (the `assignment` pattern needs 8 after its key).
_MASK_OPEN, _MASK_CLOSE = chr(0xE000), chr(0xE001)
_MASK_RE = re.compile(_MASK_OPEN + "([0-9]+)" + _MASK_CLOSE)


@functools.lru_cache(maxsize=32)
def _listed_re(public: frozenset[str]) -> re.Pattern[str] | None:
    """One pattern for the listed values shaped like transaction hashes (longest first), or None."""
    values = sorted({v.lower() for v in public if isinstance(v, str) and _TX_SHAPED_RE.fullmatch(v.lower())},
                    key=lambda v: (-len(v), v))
    if not values:
        return None
    return re.compile("(?<![0-9A-Za-z])(?:" + "|".join(re.escape(v) for v in values) + ")(?![0-9A-Za-z])",
                      re.IGNORECASE | re.ASCII)


def _cleared_spans(text: str, public: frozenset[str]) -> list[tuple[int, int]]:
    """The spans of `text` README.md 8 clears (explorer-link values, listed values), sorted and merged."""
    spans: list[tuple[int, int]] = []
    for url in _URL_RE.finditer(text):
        raw = url.group(0)
        path_start = raw.find("/", raw.index("://") + 3)
        if path_start < 0:
            continue
        path_end = min([i for i in (raw.find("?"), raw.find("#")) if i >= 0] or [len(raw)])
        for m in _TX_PATH_RE.finditer(raw, path_start, path_end):
            spans.append((url.start() + m.start(1), url.start() + m.end(1)))
    listed = _listed_re(public) if public else None
    if listed is not None:
        spans.extend(m.span() for m in listed.finditer(text))
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _redact_except(text: str, spans: Sequence[tuple[int, int]]) -> tuple[str, list[str]]:
    """`log.redact` with the cleared spans held back: each span becomes a placeholder, the whole text is redacted at
    once (a pattern around a span still fires: a PEM block holding a link swallows the link too), then the spans come
    back verbatim. Returns the text and the ids of the patterns that fired outside the spans. A text that already
    holds a placeholder character is redacted whole."""
    if not spans or _MASK_OPEN in text or _MASK_CLOSE in text:
        return redact(text), redaction_ids(text)
    kept: list[str] = []
    pieces: list[str] = []
    pos = 0
    for start, end in spans:
        pieces.append(text[pos:start])
        pieces.append(f"{_MASK_OPEN}{len(kept)}{_MASK_CLOSE}")
        kept.append(text[start:end])
        pos = end
    pieces.append(text[pos:])
    masked = "".join(pieces)
    return _MASK_RE.sub(lambda m: kept[int(m.group(1))], redact(masked)), redaction_ids(masked)


def clean_text(text: str, *, where: str, public: frozenset[str] = frozenset()) -> str:
    """`log.redact`, then the secret scan with `public` (the batch's `integrity.load_public_values`); a remaining hit
    replaces the whole text by `[redacted:secret-scan]`. The values README.md 8 clears (explorer-link values, listed
    values shaped like a transaction hash) are kept verbatim by both steps. Each replacement adds W_SECRET_REDACTED
    (naming the pattern ids, never the text)."""
    if not isinstance(text, str) or not text:
        return text
    public = frozenset(public)
    out, ids = _redact_except(text, _cleared_spans(text, public))
    if ids:
        warn(ErrorItem("W_SECRET_REDACTED", f"secret-shaped text redacted in {where} ({', '.join(ids)})"))
    scan = _integrity().scan_secrets_text(out, where=where, public=public)
    # fail closed: a scan result without a `state` of exactly "ok" (missing field, other shape) replaces the text
    if getattr(scan, "state", None) != "ok":
        warn(ErrorItem("W_SECRET_REDACTED", f"the secret scan flagged {where}: text replaced",
                       hint=str(getattr(scan, "id", "secrets"))))
        return "[redacted:secret-scan]"
    return out


def clean_url(url: str | None, *, where: str, public: frozenset[str] = frozenset()) -> str | None:
    """A URL property (`Lien de preuve`) through `clean_text`: sent only when the scan leaves it unchanged (an
    explorer link passes), else null, since a URL property cannot carry a redaction label (W_SECRET_REDACTED names
    where)."""
    if not url:
        return url
    return url if clean_text(url, where=where, public=public) == url else None


# --- the ledger ---------------------------------------------------------------------------------------------------

def _ledger_default() -> dict:
    return {"schema": LEDGER_SCHEMA, "batches": {}, "rows": {}, "ingested": {}, "queue_offset": 0,
            "init": {"access_ok": None, "hub_fetched": False, "hub_has_block": {"A": False, "B": False},
                     "skeleton_done": False, "relation_done": False, "refetch": False, "adopted": {}},
            "async": {}, "flags": {"map_rebuild": False, "map_rebuild_not_before": None, "hub_fetch": False,
                                   "hub_reinsert": False, "hub_wave": None},
            "replay": {"token_ok_seq": -1, "map_rebuilt_seq": -1, "waves_checked_seq": -1},
            "outbox_seq": 0, "created_any": False, "last_hub_utc": None, "hub_recreated_utc": None,
            "tick": {"tick_utc": None, "calls": 0}, "auth_failures": 0, "replay_attempts": {}}


def load_ledger(layout: paths.Layout) -> dict:
    doc = _read(_file(layout, "ledger.json"), None)
    base = _ledger_default()
    if not isinstance(doc, dict):
        return base
    for key, value in base.items():
        if key not in doc:
            doc[key] = value
        elif isinstance(value, dict) and isinstance(doc[key], dict):
            for sub, subval in value.items():
                doc[key].setdefault(sub, subval)
    return doc


def _save_ledger(layout: paths.Layout, ledger: dict) -> None:
    jsonio.write_json_atomic(_file(layout, "ledger.json"), ledger)


def _ids(layout: paths.Layout, profile: Mapping[str, Any]) -> dict[str, str]:
    """Known ids: the profile's non-null fields first, then the captures of ids.json."""
    captured = _read(_file(layout, "ids.json"), {})
    out: dict[str, str] = {k: str(v) for k, v in (captured or {}).items() if isinstance(v, str) and v}
    notion = profile.get("notion") or {}
    for name in ("tasks", "waves"):
        db = (notion.get("databases") or {}).get(name)
        if isinstance(db, dict):
            if db.get("database_id"):
                out[f"db:{name}"] = str(db["database_id"])
            if db.get("data_source_id"):
                out[f"ds:{name}"] = str(db["data_source_id"])
    for key, value in (notion.get("views") or {}).items():
        if value:
            out[f"view:{key}"] = str(value)
    return out


def _outbox_lines(layout: paths.Layout) -> tuple[list[dict], set[str]]:
    lines: list[dict] = []
    resolved: set[str] = set()
    for _n, doc in jsonio.read_jsonl(layout.notion_outbox):
        if not isinstance(doc, dict):
            continue
        if "resolved" in doc:
            resolved.add(str(doc["resolved"]))
        else:
            lines.append(doc)
    return lines, resolved


def _unresolved(layout: paths.Layout) -> list[dict]:
    lines, resolved = _outbox_lines(layout)
    return [ln for ln in lines if f"{ln.get('batch_id')}/{ln.get('op_id')}" not in resolved]


def _resolve(layout: paths.Layout, ref: str, by: str) -> None:
    jsonio.append_jsonl(layout.notion_outbox, {"resolved": ref, "by": by})


# --- row content ----------------------------------------------------------------------------------------------------

def row_hash(props: Mapping[str, Any], body: str | None = None) -> str:
    """sha256 of canonical({"properties": props, "body": body}) (NOTION.md 8.2): every orchestrator-owned value as
    sent (dates as the two date:Échéance:* keys, nulls kept), plus the page body."""
    return jsonio.sha256_json({"properties": dict(props), "body": body})


def _zone_word(schedule_cache: Mapping[str, Any] | None) -> str:
    for zone in (schedule_cache or {}).get("zones") or []:
        if isinstance(zone, dict) and zone.get("deadline") == BUILD_COMPLETE and zone.get("zone") in ZONE_WORD:
            return ZONE_WORD[str(zone["zone"])]
    return ZONE_WORD["unknown"]


def _task_instant(task: Task, schedule_cache: Mapping[str, Any] | None) -> str | None:
    if task.deadline is not None:
        return _fmt(task.deadline)
    manual = task.manual or {}
    if manual.get("latest_start_utc"):
        return str(manual["latest_start_utc"])
    per_task = ((schedule_cache or {}).get("tasks") or {}).get(task.id) or {}
    finish = per_task.get("p80_finish_utc") if isinstance(per_task, dict) else None
    return finish if _utc(finish) else None


def _proof_text(task: Task, receipt: Mapping[str, Any] | None) -> str:
    proof = task.proof or {}
    kind = proof.get("type")
    spec = proof.get("spec") or {}
    expect = proof.get("expect") or {}
    if kind == "command":
        text = f"commande · exit {expect.get('exit_code', 0)}"
    elif kind == "tx":
        text = f"tx {spec.get('network', '')} relue".replace("  ", " ")
    elif kind == "ci":
        text = "CI verte"
    elif kind == "file":
        text = "fichier"
    elif kind == "url":
        text = f"URL {spec.get('expect_status', 200)}"
    else:
        text = "réponse vérifiée"
    ok = bool(receipt) and receipt.get("verdict") == "pass" and receipt.get("task") == task.id
    return f"{text} · reçu {'ok' if ok else 'absent'}"


def _proof_link(task: Task) -> str | None:
    proof = task.proof or {}
    url = (proof.get("spec") or {}).get("url") if proof.get("type") == "url" else None
    return url if isinstance(url, str) and re.match(r"^https?://\S+$", url) else None


def _verified_by(task: Task, ts_raw: Mapping[str, Any], receipt: Mapping[str, Any] | None) -> str:
    if receipt and receipt.get("task") == task.id:
        agent = (receipt.get("by") or {}).get("agent_type") or "execution-verifier"
        return f"{agent} · {receipt.get('run', '')}".strip(" ·")
    answer = ts_raw.get("answer")
    if answer and task.manual:
        bring = (task.manual.get("bring_back") or [{}])[0]
        key = bring.get("key", "")
        method = (bring.get("verify") or {}).get("method", "")
        return f"réponse {key} vérifiée ({method})"
    return ""


def _options_text(options: Sequence[Mapping[str, Any]]) -> str:
    return _cut(" · ".join(f"{o.get('id')} = {o.get('label')}" for o in options if isinstance(o, Mapping)),
                OPTIONS_MAX)


def row_properties(task: Task, ts: Any, profile: Mapping[str, Any], *, extra: Mapping[str, Any] | None = None,
                   public: frozenset[str] = frozenset()) -> dict:
    """The orchestrator-owned properties of a task row (NOTION.md 2.1, properties 1-8, 11-20; the relation 9 is
    added by the caller once page ids exist). `ts` is the task's TaskState; `extra` carries the receipt, the
    schedule cache, the ingested flag and the plan version. Text values pass `clean_text` and the proof link
    `clean_url`, both with the proven-public values `public` (README.md 8)."""
    extra = dict(extra or {})
    raw = getattr(ts, "raw", {}) or {}
    status = getattr(ts, "status", "planned")
    zones = clock.zones_from_profile(dict(profile))
    receipt = extra.get("receipt")
    schedule_cache = extra.get("schedule_cache")
    label = STATE_LABELS_FR.get(status, "Prévue")
    if status == "running" and task.kind in ("manual", "decision"):
        label = AWAITING_LABEL
    nature = {"gate": "Porte", "manual": "Manuelle", "decision": "Décision"}.get(task.kind, "Agent")
    instant = _task_instant(task, schedule_cache)
    due_text = ""
    if instant:
        due_text = f"{fr_display(clock.parse_utc(instant), zones)} · zone {_zone_word(schedule_cache)}"
    est = task.estimate
    p80 = int(math.floor(lognormal_p80(est.p50, est.p90) + 0.5))
    options = (task.manual or {}).get("options") or []
    props: dict[str, Any] = {
        "Tâche": _cut(f"{task.id} · {task.title}", TITLE_MAX),
        "Clé": task.id,
        "État": label,
        "Nature": nature,
        "Responsable": OWNER_FR.get(task.owner, "Agent"),
        "Orchestrateur": task.executor,
        "Phase": PHASE_FR.get(task.phase, task.phase),
        "Priorité": task.priority,
        "Dépend de (clés)": ", ".join(task.depends_on),
        "date:Échéance:start": instant,
        "date:Échéance:is_datetime": 1,
        "Échéance (texte)": due_text,
        "Preuve": _proof_text(task, receipt),
        "Lien de preuve": clean_url(_proof_link(task), where=f"Notion {task.id} Lien de preuve", public=public),
        "Vérifiée par": _verified_by(task, raw, receipt),
        "Vague": str(raw.get("wave") or ""),
        "P80 (min)": p80,
        "Options": _options_text(options),
        "Ingérée": extra.get("ingested") or "__NO__",
    }
    for name in TEXT_FIELDS:
        props[name] = clean_text(props[name], where=f"Notion {task.id} {name}", public=public)
    return props


def row_body(task: Task, ts: Any, profile: Mapping[str, Any], plan_version: int, *,
             public: frozenset[str] = frozenset()) -> str:
    """The page body (NOTION.md 2.4): one line for agent tasks; the French phone layout for manual and decision
    tasks (steps and descriptions quoted verbatim, never translated). The text passes `clean_text` with `public`."""
    if task.kind not in ("manual", "decision") or not task.manual:
        return f"Tâche du plan v{plan_version} · voir EXECUTION.md"
    zones = clock.zones_from_profile(dict(profile))
    manual = task.manual
    raw = getattr(ts, "raw", {}) or {}
    lines: list[str] = []
    posted = raw.get("posted") or {}
    if isinstance(posted, dict) and int(posted.get("reposts", 0) or 0) > 0 and getattr(ts, "status", "") != "done":
        when = fr_display(_utc(posted.get("at_utc")), zones, first_only=True)
        lines.append(f"Réponse refusée le {when} : corrige « Réponse » puis décoche et recoche « Répondu »")
    lines.append("### Ce qu'il faut faire")
    for n, step in enumerate(manual.get("steps") or [], start=1):
        lines.append(f"{n}. {step}")
    lines.append("### À rapporter")
    for item in manual.get("bring_back") or []:
        kind = KIND_FR.get(str(item.get("kind")), str(item.get("kind")))
        method = METHOD_FR.get(str((item.get("verify") or {}).get("method")), "vérifié")
        desc = item.get("description") or ""
        lines.append(f"- {item.get('key')} ({kind}) : {desc} · vérifié par {method}".replace(" :  ·", " ·"))
    lines.append("### Où et quand")
    lines.append(f"- Où : {WHERE_FR.get(str(manual.get('where')), 'ordinateur')}")
    latest = _utc(manual.get("latest_start_utc"))
    lines.append(f"- Commencer au plus tard : {fr_display(latest, zones)}")
    options = manual.get("options") or []
    if options:
        lines.append("### Options")
        for opt in options:
            lines.append(f"- `{opt.get('id')}` : {opt.get('label')} — {opt.get('consequence')}")
    lines.append("### Comment répondre")
    lines.append("- Le plus rapide : réponds au push par Remote Control.")
    if task.kind == "decision" or options:
        lines.append("- Ici : écris dans « Réponse » (et l'identifiant d'option dans « Décision » pour une décision), "
                     "puis coche « Répondu ».")
    else:
        lines.append("- Ici : écris dans « Réponse », puis coche « Répondu ».")
    return clean_text("\n".join(lines), where=f"Notion {task.id} body", public=public)


def _decision_blocks(layout: paths.Layout) -> list[dict]:
    """decisions.md headers as data (decisionsio is not an edge of notion, Q-B09-2)."""
    path = layout.decisions
    if not path.exists():
        return []
    prefix, suffix = "<!-- execution-decision ", " -->"
    out: list[dict] = []
    seen: set[str] = set()
    for line in path.read_bytes().decode("utf-8").split("\n"):
        line = line.rstrip("\r")
        if not line.startswith(prefix) or not line.endswith(suffix) or line in seen:
            continue
        seen.add(line)
        try:
            doc = json.loads(line[len(prefix): -len(suffix)])
        except json.JSONDecodeError:
            _LOG.warning("unreadable decision header skipped", extra={"data": {"path": paths.posix(path)}})
            continue
        if isinstance(doc, dict) and isinstance(doc.get("id"), str):
            out.append(doc)
    return out


def decision_responsable(proposal: Mapping[str, Any]) -> str:
    """The `Responsable` of a decision row (NOTION.md 10.5): owner-only kinds always `Dev A`; otherwise `Dev B` when
    dev B (or B's orchestrator) proposed it, else `Dev A`."""
    if proposal.get("kind") in OWNER_ONLY_KINDS:
        return "Dev A"
    return "Dev B" if str(proposal.get("by", "")) in ("devB", "exec@B") else "Dev A"


def _answer_by(layout: paths.Layout, ledger: Mapping[str, Any], plan: PlanModel, key: str) -> str:
    """`--by` of an answer read from row `key` (NOTION.md 10.2, 10.5): the row's `Responsable` as last acknowledged,
    else as the row is built (task owner; decision proposal), `Dev B` -> devB, anything else -> devA."""
    acked = (((ledger.get("rows") or {}).get(key) or {}).get("props") or {}).get("Responsable")
    responsable = acked if acked in ("Dev A", "Dev B") else None
    if responsable is None:
        if key.startswith("T"):
            task = plan.by_id.get(key)
            responsable = OWNER_FR.get(task.owner, "Dev A") if task else "Dev A"
        else:
            proposal = next((b for b in reversed(_decision_blocks(layout))
                             if b.get("id") == key and b.get("record") == "proposal"), None)
            responsable = decision_responsable(proposal) if proposal else "Dev A"
    return "devB" if responsable == "Dev B" else "devA"


def decision_row_properties(proposal: Mapping[str, Any], resolution: Mapping[str, Any] | None,
                            profile: Mapping[str, Any], *, public: frozenset[str] = frozenset()) -> dict:
    """A decision row (key D-nnn) for a proposal not carried by a plan decision task (NOTION.md 2.1); text values
    pass `clean_text` with `public`."""
    zones = clock.zones_from_profile(dict(profile))
    did = str(proposal["id"])
    executor = "A" if in_range(did, "A") else "B"
    owner = decision_responsable(proposal)
    deadline = proposal.get("deadline_utc") if _utc(proposal.get("deadline_utc")) else None
    props: dict[str, Any] = {
        "Tâche": _cut(f"{did} · {proposal.get('title', '')}", TITLE_MAX),
        "Clé": did,
        "État": RESOLVED_LABEL if resolution else AWAITING_LABEL,
        "Nature": "Décision",
        "Responsable": owner,
        "Orchestrateur": executor,
        "Phase": PHASE_FR["decision"],
        "Priorité": "P1",
        "Dépend de (clés)": ", ".join(str(t) for t in proposal.get("tasks") or []),
        "date:Échéance:start": deadline,
        "date:Échéance:is_datetime": 1,
        "Échéance (texte)": fr_display(_utc(deadline), zones) if deadline else "",
        "Preuve": "",
        "Lien de preuve": None,
        "Vérifiée par": f"décision {resolution.get('choice')} ({resolution.get('source', '')})".replace(" ()", "")
        if resolution and resolution.get("choice") else "",
        "Vague": "",
        "P80 (min)": None,
        "Options": _options_text(proposal.get("options") or []),
        "Ingérée": "__YES__" if resolution else "__NO__",
    }
    for name in TEXT_FIELDS:
        props[name] = clean_text(props[name], where=f"Notion {did} {name}", public=public)
    return props


def decision_row_body(proposal: Mapping[str, Any], *, public: frozenset[str] = frozenset()) -> str:
    lines = ["### Options"]
    for opt in proposal.get("options") or []:
        lines.append(f"- `{opt.get('id')}` : {opt.get('label')} — {opt.get('consequence')}")
    if proposal.get("recommended"):
        lines.append(f"- Recommandé : `{proposal['recommended']}`")
    lines.append("### Comment répondre")
    lines.append("- Le plus rapide : réponds au push par Remote Control.")
    lines.append("- Ici : tape l'identifiant d'option dans « Décision », puis coche « Répondu ».")
    return clean_text("\n".join(lines), where=f"Notion {proposal.get('id')} body", public=public)


def _assert_no_owner_fields(op: Mapping[str, Any]) -> None:
    """The owner's columns never appear in any op (NOTION.md 5.1): checked on every op before a batch is written."""
    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, sub in value.items():
                if key in OWNER_FIELDS:
                    raise InternalError(f"op {op.get('op_id')} would write the owner's column {key!r}")
                walk(sub)
        elif isinstance(value, list):
            for sub in value:
                walk(sub)
    args = op.get("args") or {}
    walk(args.get("properties"))
    for page in args.get("pages") or []:
        walk(page.get("properties"))


# --- desired rows ---------------------------------------------------------------------------------------------------

def _desired_rows(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any],
                  ledger: Mapping[str, Any], schedule_cache: Mapping[str, Any] | None, *,
                  public: frozenset[str]) -> list[dict]:
    """Own rows in mirror order (plan order, then decision ids): {key, props, body, deps_same, awaiting}; their text
    is scanned with the proven-public values `public`."""
    layout = ctx.layout
    executor = ctx.executor or "A"
    rows: list[dict] = []
    carried: set[str] = set()
    local_awaiting = {str(a.get("ref")) for a in (_read(layout.local_state, {}) or {}).get("awaiting") or []
                      if isinstance(a, dict)}
    for task in plan.tasks:
        ts = statusio.state_of(task.id, statuses, plan)
        if task.kind == "decision" and ts.raw.get("decision"):
            carried.add(str(ts.raw["decision"]))
        if task.executor != executor:
            continue
        receipt = _read(layout.receipt(task.id), None)
        ingested = "__NO__"
        flag = (ledger.get("ingested") or {}).get(task.id)
        if isinstance(flag, dict):
            posted_at = _utc(((ts.raw.get("posted") or {}) if isinstance(ts.raw.get("posted"), dict) else {})
                             .get("at_utc"))
            flag_at = _utc(flag.get("at_utc"))
            if posted_at is None or (flag_at is not None and flag_at >= posted_at):
                ingested = str(flag.get("value") or "__NO__")
        props = row_properties(task, ts, profile, extra={"receipt": receipt if isinstance(receipt, dict) else None,
                                                         "schedule_cache": schedule_cache, "ingested": ingested},
                               public=public)
        body = row_body(task, ts, profile, plan.version, public=public)
        deps_same = [d for d in task.depends_on if d in plan.by_id and plan.by_id[d].executor == executor]
        rows.append({"key": task.id, "props": props, "body": body, "deps_same": deps_same,
                     "awaiting": task.id in local_awaiting})
    blocks = _decision_blocks(layout)
    resolutions = {b["id"]: b for b in blocks if b.get("record") == "resolution"}
    pages = (_read(layout.local_state, {}) or {}).get("notion", {}).get("pages", {})
    for block in sorted((b for b in blocks if b.get("record") == "proposal"), key=lambda b: b["id"]):
        did = block["id"]
        if not in_range(did, executor) or did in carried:
            continue
        resolution = resolutions.get(did)
        if resolution is not None and did not in pages:
            continue  # resolved before it was ever mirrored: nothing for the owner to see
        rows.append({"key": did, "props": decision_row_properties(block, resolution, profile, public=public),
                     "body": decision_row_body(block, public=public), "deps_same": [],
                     "awaiting": resolution is None})
    return rows


# --- op builders ----------------------------------------------------------------------------------------------------

def _op(tool: str, args: dict, key: str, purpose: str, hash_: str | None = None,
        capture: list[dict] | None = None, **more: Any) -> dict:
    op = {"op_id": "", "tool": tool, "args": args, "key": key, "purpose": purpose, "hash": hash_,
          "capture": capture or []}
    op.update(more)
    return op


def _fetch_hub(hub: str, purpose: str) -> dict:
    return _op("notion-fetch", {"id": hub}, "token" if purpose == "token-check" else "hub", purpose)


def _view_query(view_url: str, key: str, cursor: str | None = None) -> dict:
    data: dict[str, Any] = {"mode": "view", "view_url": view_url, "page_size": 100}
    if cursor:
        data["start_cursor"] = cursor
    capture = [{"pointer": P_TO_INGEST, "as": "rows:to_ingest"}] if key == "poll:to_ingest" else \
        [{"pointer": P_ROWS, "as": "rows:" + key.split(":")[1]}]
    return _op("notion-query-data-sources", {"data": data}, key, "poll", capture=capture)


# --- init stages (NOTION.md 7) --------------------------------------------------------------------------------------

def _init_ops(ctx: Ctx, profile: Mapping[str, Any], ledger: dict, ids: Mapping[str, str]) -> tuple[list[dict], int]:
    """The ops of the first init stage not complete yet, and its stage number; ([], 5) when stages 1-4 are done."""
    hub = str(profile["notion"]["hub_page_id"])
    executor = ctx.executor or "A"
    init = ledger["init"]
    if init.get("access_ok") is not True or not init.get("hub_fetched") or init.get("refetch"):
        ops = []
        if init.get("access_ok") is not True:
            ops.append(_op("notion-get-tool-access", {"tool_names": list(REQUIRED_TOOLS)}, "token", "token-check"))
        ops.append(_fetch_hub(hub, "token-check"))
        return ops, 1
    if executor == "B":
        missing = [k for k in ("ds:tasks", "db:tasks", "ds:waves", "db:waves") if k not in ids]
        if missing:
            raise CheckFailed("dev A's orchestrator has not created the Notion databases yet (profile ids missing: "
                              + ", ".join(missing) + ")", code="E_NOTION_UNCONFIGURED",
                              hint="dev A runs exec.py notion diff --init, then the profile is synced")
        if not init["hub_has_block"].get("B") and not init.get("skeleton_done"):
            block = _initial_block("B")
            return [_op("notion-update-page", {"page_id": hub, "command": "insert_content",
                                               "position": {"type": "end"}, "content": block, "allow_async": False},
                        "hub", "hub-now", jsonio.sha256_bytes(block.encode("utf-8")))], 2
        return [], 5
    ops: list[dict] = []
    if not init["hub_has_block"].get("A") and not init.get("skeleton_done"):
        skel = hub_skeleton(profile)
        ops.append(_op("notion-update-page", {"page_id": hub, "command": "insert_content",
                                              "position": {"type": "start"}, "content": skel, "allow_async": False},
                       "hub", "hub-now", jsonio.sha256_bytes(skel.encode("utf-8"))))
    project = str(profile["project"]["name"])
    specs = (("tasks", f"Tâches · {project}", "Miroir du plan .execution/plan.json, écrit par les orchestrateurs. "
              "Tes colonnes : Réponse, Répondu, Décision, Pièces jointes.", DDL_TASKS),
             ("waves", f"Vagues · {project}", "Un rapport par vague, en français.", DDL_WAVES))
    for name, title, desc, ddl in specs:
        db_known, ds_known = f"db:{name}" in ids, f"ds:{name}" in ids
        if db_known and ds_known:
            continue
        if db_known:  # adopted from the hub fetch: read the database once for its data source
            ops.append(_op("notion-fetch", {"id": ids[f"db:{name}"]}, f"db:{name}", "create-db",
                           capture=[{"pointer": P_DS, "as": f"ds:{name}"}]))
            continue
        ops.append(_op("notion-create-database",
                       {"parent": {"type": "page_id", "page_id": hub}, "title": title, "description": desc,
                        "schema": ddl},
                       f"db:{name}", "create-db",
                       capture=[{"pointer": P_DS, "as": f"ds:{name}"}, {"pointer": P_DB, "as": f"db:{name}"}]))
    if ops:
        return ops, 2
    if not init.get("relation_done"):
        ds = _bare_ds(ids["ds:tasks"])
        stmt = f"ADD COLUMN \"{RELATION}\" RELATION('{ds}', DUAL 'Débloque' 'debloque')"
        return [_op("notion-update-data-source", {"data_source_id": ds, "statements": stmt}, "relation:tasks",
                    "self-relation")], 3
    view_ops = []
    for view in VIEWS:
        if f"view:{view['key']}" in ids:
            continue
        db, ds = ids[f"db:{view['db']}"], _bare_ds(ids[f"ds:{view['db']}"])
        view_ops.append(_op("notion-create-view", {"database_id": db, "data_source_id": ds, "name": view["name"],
                                                   "type": view["type"], "configure": view["configure"]},
                            f"view:{view['key']}", "create-view",
                            capture=[{"pointer": P_VIEW, "as": f"view:{view['key']}"}]))
    if view_ops:
        return view_ops, 4
    return [], 5


def _bare_ds(value: str) -> str:
    return value[len("collection://"):] if value.startswith("collection://") else value


# --- mirror (NOTION.md 8, 9) ------------------------------------------------------------------------------------------

def _queue_consume(layout: paths.Layout, ledger: dict, now: datetime) -> list[str]:
    """Read new lines of queue.jsonl into ledger.ingested; returns the keys touched."""
    path = _file(layout, "queue.jsonl")
    keys: list[str] = []
    if not path.exists():
        return keys
    offset = int(ledger.get("queue_offset", 0))
    n = 0
    for n, doc in jsonio.read_jsonl(path):
        if n <= offset or not isinstance(doc, dict):
            continue
        key = str(doc.get("key", ""))
        if not re.match(r"^(T[0-9]{3,}|D-[0-9]{3,})$", key):
            _LOG.warning("queue line without a valid key skipped", extra={"data": {"line": n}})
            continue
        value = doc.get("ingested")
        if value is None:
            value = (doc.get("properties") or {}).get("Ingérée") == "__YES__"
        ledger["ingested"][key] = {"value": "__YES__" if value in (True, "__YES__") else "__NO__",
                                   "at_utc": str(doc.get("at_utc") or _fmt(now))}
        keys.append(key)
    ledger["queue_offset"] = max(offset, n)
    return keys


def _divergence(layout: paths.Layout) -> dict:
    doc = _read(_file(layout, "divergence.json"), {})
    return doc if isinstance(doc, dict) else {}


def _release_holds(layout: paths.Layout, plan: PlanModel, ledger: dict) -> list[str]:
    """Clear holds whose decision resolved: `rewrite` clears and forces a full rewrite; `amend` clears once the
    plan version moved past the one seen at the divergence."""
    holds = _divergence(layout)
    if not holds:
        return []
    blocks = _decision_blocks(layout)
    by_title = {b.get("title"): b["id"] for b in blocks if b.get("record") == "proposal"}
    resolutions = {b["id"]: b for b in blocks if b.get("record") == "resolution"}
    released: list[str] = []
    for key, entry in sorted(holds.items()):
        did = entry.get("decision") or by_title.get(entry.get("title"))
        res = resolutions.get(did) if did else None
        if not res:
            continue
        choice = res.get("choice")
        if choice == "rewrite" or (choice == "amend" and plan.version > int(entry.get("plan_version", 0))):
            released.append(key)
            ledger["rows"].pop(key, None)
    if released:
        for key in released:
            holds.pop(key, None)
        jsonio.write_json_atomic(_file(layout, "divergence.json"), holds)
    return released


def _hub_block(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any],
               local: Mapping[str, Any], schedule_cache: Mapping[str, Any] | None, wave: str | None, *,
               public: frozenset[str]) -> str:
    """This executor's "Now" block (NOTION.md 9.3), ≤ 1,500 characters; the owner's action passes `clean_text`."""
    executor = ctx.executor or "A"
    zones = clock.zones_from_profile(dict(profile))
    zone_key = "unknown"
    p80 = "inconnue"
    for zone in (schedule_cache or {}).get("zones") or []:
        if isinstance(zone, dict) and zone.get("deadline") == BUILD_COMPLETE:
            zone_key = zone.get("zone") if zone.get("zone") in ZONE_WORD else "unknown"
            p80 = fr_display(_utc(zone.get("p80_utc")), zones) if zone.get("p80_utc") else "inconnue"
    awaiting = sorted((a for a in local.get("awaiting") or [] if isinstance(a, dict)),
                      key=lambda a: (str(a.get("latest_utc") or "9999"), str(a.get("ref"))))
    if awaiting:
        first = awaiting[0]
        ref = str(first.get("ref"))
        task = plan.by_id.get(ref)
        what = ((task.manual or {}).get("steps") or [task.title])[0] if task else "décision à trancher"
        latest = _utc(first.get("latest_utc"))
        action = f"{ref} · {_cut(' '.join(str(what).split()), 60)}" + \
            (f" avant {fr_display(latest, zones, first_only=True)}" if latest else "")
    else:
        action = "rien"
    own = (statuses.get(executor) or {}).get("tasks") or {}
    running = sorted(t for t, e in own.items() if isinstance(e, dict) and e.get("status") == "running")
    waves = [w for w in local.get("waves") or [] if isinstance(w, dict)]
    last_wave = wave or (sorted((w["wave"] for w in waves), key=lambda w: int(w[1:]))[-1] if waves else "aucune")
    gov = local.get("governor") or {}
    quo = local.get("quota") or {}
    disk = _fr_unit(gov.get("disk_free_gb"), "Go")
    ram = _fr_unit(gov.get("ram_free_gb"), "Go")
    week = _fr_unit(quo.get("seven_day_pct"), "%")
    lines = [
        _marker_start(executor),
        f"**{RUN_STATE_FR.get(str(local.get('run_state')), 'Préparation')}** · Zone {ZONE_WORD[zone_key]} · "
        f"fin de build P80 {p80}",
        f"- À toi : {clean_text(action, where='Notion hub', public=public)}",
        f"- En cours : {_cut(', '.join(running), 300) if running else 'rien'} · vague {last_wave}",
        f"- Pouls : disque {disk} · RAM {ram} · quota semaine {week} · tick "
        f"{_times_only(_utc(local.get('last_tick_utc')), zones)}",
        f"- Dernier rapport : {last_wave} (base Vagues)",
        _marker_end(executor),
    ]
    return _cut("\n".join(lines), HUB_MAX_CHARS)


def _report_sections(text: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {"callout": []}
    current = "callout"
    for line in text.split("\n"):
        if line.startswith("## "):
            current = line[3:].strip()
            out[current] = []
        elif line.strip() and line.strip() not in ("</callout>",) and not line.startswith("<callout"):
            out.setdefault(current, []).append(line.strip())
    return out


def _count_items(lines: Sequence[str]) -> int:
    n = 0
    for line in lines:
        m = re.match(r"^- … et ([0-9]+) autres", line)
        if m:
            n += int(m.group(1))
        elif line.startswith("- ") and line != "Rien.":
            n += 1
    return n


def _wave_report_op(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any],
                    local: Mapping[str, Any], ids: Mapping[str, str], wave: str,
                    schedule_cache: Mapping[str, Any] | None, *, public: frozenset[str]) -> dict:
    """The wave report row (NOTION.md 3, 9.1): its text properties and its body (`reports/Wnn.fr.md`) pass
    `clean_text` with `public`."""
    layout = ctx.layout
    executor = ctx.executor or "A"
    path = layout.report(wave)
    if not path.exists():
        raise UsageError(f"no report for {wave} at {layout.rel(path) if path.parent.exists() else path.as_posix()}",
                         hint=f"run {paths.exec_cmd()} report --wave {wave} first")
    text = path.read_bytes().decode("utf-8")
    sections = _report_sections(text)
    zones = clock.zones_from_profile(dict(profile))
    entry = next((w for w in local.get("waves") or [] if isinstance(w, dict) and w.get("wave") == wave), {})
    launched = _utc(entry.get("launched_utc"))
    closed = _utc(entry.get("finished_utc")) or ctx.now
    zone_key = "unknown"
    bc: dict = {}
    for zone in (schedule_cache or {}).get("zones") or []:
        if isinstance(zone, dict) and zone.get("deadline") == BUILD_COMPLETE:
            bc = zone
            zone_key = zone.get("zone") if zone.get("zone") in ZONE_WORD else "unknown"
    p80 = _utc(bc.get("p80_utc"))
    p90 = _utc(bc.get("p90_utc"))
    p80_text = "inconnue"
    if p80 is not None:
        p80_text = fr_display(p80, zones)
        if p90 is not None:
            p80_text += f" (P90 {fr_display(p90, zones, ref=p80, first_only=True)})"
    hours = f"lancée {fr_display(launched, zones)} ; close {fr_display(closed, zones, ref=launched)}" \
        if launched else f"close {fr_display(closed, zones)}"
    own = (statuses.get(executor) or {}).get("tasks") or {}
    open_n = sum(1 for t in plan.tasks if t.executor == executor and
                 (own.get(t.id) or {}).get("status", "planned") not in ("done", "cut", "superseded"))
    counts_line = next((ln for ln in sections.get("Ouvert", []) if " en échec, " in ln), "")
    failed = sum(int(x) for x in re.findall(r"([0-9]+) (?:en échec|bloquées)", counts_line))
    action_lines = sections.get("Ta prochaine action") or [""]
    gov = local.get("governor") or {}
    quo = local.get("quota") or {}
    pouls = (f"disque {_fr_unit(gov.get('disk_free_gb'), 'Go')} · RAM {_fr_unit(gov.get('ram_free_gb'), 'Go')} · "
             f"quota 5 h {_fr_unit(quo.get('five_hour_pct'), '%')} · "
             f"semaine {_fr_unit(quo.get('seven_day_pct'), '%')} · "
             f"tick {_times_only(_utc(local.get('last_tick_utc')), zones)}")
    props = {
        "Vague": f"{wave} · {executor}",
        "Orchestrateur": executor,
        "date:Lancée:start": _fmt(launched) if launched else None,
        "date:Lancée:is_datetime": 1,
        "date:Close:start": _fmt(closed),
        "date:Close:is_datetime": 1,
        "Heures (texte)": hours,
        "Zone": ZONE_SELECT[zone_key],
        "P80 fin de build": p80_text,
        "Prouvées": _count_items(sections.get("Prouvé", [])),
        "Échecs": failed,
        "Ouvertes": open_n,
        "Ta prochaine action": re.sub(r"^[0-9]+\. ", "", action_lines[0]) if action_lines else "",
        "Pouls": pouls,
    }
    for name in ("Heures (texte)", "P80 fin de build", "Ta prochaine action", "Pouls"):
        props[name] = clean_text(str(props[name]), where=f"Notion wave:{wave} {name}", public=public)
    body = clean_text(text.rstrip("\n"), where=f"Notion wave:{wave} report", public=public)
    return _op("notion-create-pages",
               {"parent": {"type": "data_source_id", "data_source_id": _bare_ds(ids["ds:waves"])},
                "allow_async": False, "pages": [{"properties": props, "content": body}]},
               f"wave:{wave}", "wave-report", jsonio.sha256_bytes(text.encode("utf-8")),
               capture=[{"pointer": P_ROWS, "as": "rows:waves"}])


def _mirror_ops(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any],
                ledger: dict, local: Mapping[str, Any], ids: Mapping[str, str], wave: str | None,
                schedule_cache: Mapping[str, Any] | None, *, creates: bool, room: int,
                public: frozenset[str]) -> tuple[list[dict], dict]:
    """Creates, updates, relations, the wave report row, the hub "Now" block and set-ingested updates, in that
    order, own rows only, at most `room` ops; every text scanned with the proven-public values `public`. Returns
    (ops, expectations by op index)."""
    layout = ctx.layout
    pages: dict = dict((local.get("notion") or {}).get("pages") or {})
    holds = _divergence(layout)
    degraded = _read(_file(layout, "degraded.json"), {}) or {}
    can_create = creates and degraded.get("creates") is not False
    queued = set(_queue_consume(layout, ledger, ctx.now))
    rows = _desired_rows(ctx, plan, statuses, profile, ledger, schedule_cache, public=public)
    ds_tasks = _bare_ds(ids["ds:tasks"])
    ops: list[dict] = []
    expect: dict[int, dict] = {}
    to_create: list[dict] = []
    updates: list[tuple[int, dict, dict]] = []
    for row in rows:
        key = row["key"]
        if key in holds or key in (ledger.get("async") or {}):
            continue
        if key not in pages:
            if can_create:
                to_create.append(row)
            continue
        acked = (ledger["rows"].get(key) or {})
        acked_props = acked.get("props") or {}
        desired = dict(row["props"])
        relation: list[str] | None = None
        if row["deps_same"] and all(d in pages for d in row["deps_same"]):
            relation = [str(pages[d]) for d in row["deps_same"]][:RELATIONS_PER_REQUEST]
            desired[RELATION] = relation
        elif RELATION in acked_props:
            desired[RELATION] = acked_props[RELATION]
        delta = {k: v for k, v in desired.items() if k not in acked_props or acked_props[k] != v}
        body_changed = acked.get("body") != row["body"]
        if not acked:  # hash unknown (map rebuilt): rewrite every property once
            delta = dict(desired)
        if not delta and not body_changed:
            continue
        page = str(pages[key])
        if delta:
            only_relation = set(delta) == {RELATION}
            purpose = "set-ingested" if key in queued else ("self-relation" if only_relation else "update-row")
            after = {**acked_props, **delta}
            op = _op("notion-update-page", {"page_id": page, "command": "update_properties", "properties": delta,
                                            "allow_async": False},
                     key, purpose, row_hash(after, acked.get("body") if acked else row["body"]))
            exp = {"rows": {key: {"props": after, "body": acked.get("body") if acked else row["body"]}}}
        else:
            op = _op("notion-update-page", {"page_id": page, "command": "replace_content", "new_str": row["body"],
                                            "allow_async": False},
                     key, "update-row", row_hash(acked_props, row["body"]))
            exp = {"rows": {key: {"props": acked_props, "body": row["body"]}}}
        updates.append((0 if row["awaiting"] else 1, op, exp))
    if to_create:
        for start in range(0, len(to_create), PAGES_PER_CREATE):
            chunk = to_create[start: start + PAGES_PER_CREATE]
            hashes = {r["key"]: row_hash(r["props"], r["body"]) for r in chunk}
            op = _op("notion-create-pages",
                     {"parent": {"type": "data_source_id", "data_source_id": ds_tasks}, "allow_async": False,
                      "pages": [{"properties": r["props"], "content": r["body"]} for r in chunk]},
                     chunk[0]["key"], "create-row", hashes[chunk[0]["key"]],
                     capture=[{"pointer": P_ROWS, "as": "rows:tasks"}], row_hashes=hashes)
            expect[len(ops)] = {"rows": {r["key"]: {"props": r["props"], "body": r["body"]} for r in chunk},
                                "order": [r["key"] for r in chunk]}
            ops.append(op)
    for _prio, op, exp in sorted(updates, key=lambda u: u[0]):
        expect[len(ops)] = exp
        ops.append(op)
    if wave and f"wave:{wave}" not in pages and can_create and "ds:waves" in ids:
        expect[len(ops)] = {"wave": wave}
        ops.append(_wave_report_op(ctx, plan, statuses, profile, local, ids, wave, schedule_cache, public=public))
    hub_op = _hub_op(ctx, plan, statuses, profile, local, ledger, schedule_cache, wave, public=public)
    if hub_op is not None:
        if "_text" in hub_op:
            expect[len(ops)] = {"hub_text": hub_op.pop("_text")}
        ops.append(hub_op)
    if len(ops) > room:
        ops = ops[:room]
        expect = {i: e for i, e in expect.items() if i < room}
    return ops, expect


def _hub_op(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any],
            local: Mapping[str, Any], ledger: dict, schedule_cache: Mapping[str, Any] | None,
            wave: str | None, *, public: frozenset[str]) -> dict | None:
    hub = str(profile["notion"]["hub_page_id"])
    flags = ledger["flags"]
    text = _hub_block(ctx, plan, statuses, profile, local, schedule_cache, wave, public=public)
    digest = jsonio.sha256_bytes(text.encode("utf-8"))
    if flags.get("hub_reinsert"):
        op = _op("notion-update-page", {"page_id": hub, "command": "insert_content", "position": {"type": "end"},
                                        "content": text, "allow_async": False}, "hub", "hub-now", digest)
        op["_text"] = text
        return op
    old_path = _file(ctx.layout, "hub-now.txt")
    if flags.get("hub_fetch") or not old_path.exists():
        # The last acked block is unknown (local/ lost, a fresh clone, a no-match ack): fetch the hub; its ack stores
        # the current block between this executor's markers (or arms the re-insert when they are gone), and the next
        # diff writes the block, without the 10-minute floor when a wave report was due (NOTION.md 9.3).
        if not flags.get("hub_fetch"):
            _LOG.warning("hub \"Now\" block unknown locally: the hub is fetched first",
                         extra={"data": {"missing": paths.posix(old_path), "wave": wave}})
        flags["hub_fetch"] = True
        if wave:
            flags["hub_wave"] = wave
        return _fetch_hub(hub, "hub-now")
    old = old_path.read_bytes().decode("utf-8")
    if old.endswith("\n"):  # the file carries the final newline every file gets; the block itself has none
        old = old[:-1]
    if old == text:
        return None
    last = _utc(ledger.get("last_hub_utc"))
    due = wave or flags.get("hub_wave")
    if not due and last is not None and clock.minutes_between(last, ctx.now) < HUB_MIN_INTERVAL_MIN:
        return None
    op = _op("notion-update-page", {"page_id": hub, "command": "update_content",
                                    "content_updates": [{"old_str": old, "new_str": text}], "allow_async": False},
             "hub", "hub-now", digest)
    op["_text"] = text
    return op


# --- batches ------------------------------------------------------------------------------------------------------------

def _next_batch_id(layout: paths.Layout, executor: str, now: datetime) -> str:
    prefix = f"N-{clock.stamp(now)}-{executor}-"
    folder = _notion_dir(layout) / "batches"
    used = [0]
    if folder.exists():
        for p in folder.glob(prefix + "*.json"):
            tail = p.stem[len(prefix):]
            if tail.isdigit():
                used.append(int(tail))
    n = max(used) + 1
    if n > 999:
        raise InternalError(f"more than 999 Notion batches at {clock.stamp(now)}")
    return f"{prefix}{n}"


def _batch_doc(ctx: Ctx, batch_id: str, kind: str, stage: int, ops: list[dict], wave: str | None,
               followup: str | None) -> dict:
    for n, op in enumerate(ops, start=1):
        op["op_id"] = f"op-{n}"
    queries = sum(1 for op in ops if op["tool"] == "notion-query-data-sources")
    doc = {"schema": BATCH_SCHEMA, "batch_id": batch_id, "executor": ctx.executor, "created_utc": _fmt(ctx.now),
           "kind": kind, "stage": stage, "wave": wave, "ops": ops,
           "budget": {"calls": len(ops), "query_calls": queries, "max_in_flight": 3}, "followup": followup}
    report = _schema.validate(doc, "notion-ops")
    if not report.ok:
        raise InternalError(f"emitted batch fails notion-ops.schema.json: {report.issues[0].message} "
                            f"at {report.issues[0].instance_path}")
    for op in ops:
        _assert_no_owner_fields(op)
        if op["tool"] == "notion-query-data-sources":
            data = (op.get("args") or {}).get("data") or {}
            if data.get("mode") != "view" or "sql" in json.dumps(op["args"]).lower():
                raise InternalError("a query op must use view mode (never rows mode or SQL)")
    return doc


def _cmd(text: str) -> str:
    return f"{paths.exec_cmd()} {text}"


def _path_arg(path: Path) -> str:
    """A state file named in a printed command: absolute, forward slashes, double-quoted like exec.py itself, so the
    line runs as printed from any directory (contract revision 3, README.md 10)."""
    return f"\"{paths.posix(Path(path).resolve())}\""


def _write_batch(ctx: Ctx, doc: dict, ledger: dict, local: dict, expect: Mapping[int, dict]) -> None:
    layout = ctx.layout
    jsonio.write_json_atomic(layout.notion_batch(doc["batch_id"]), doc)
    ledger["batches"][doc["batch_id"]] = {
        "kind": doc["kind"], "stage": doc["stage"], "created_utc": doc["created_utc"], "ops": len(doc["ops"]),
        "acks": {}, "expect": {f"op-{i + 1}": e for i, e in sorted(expect.items())}}
    local["notion"]["pending_batches"] = sorted(set(local["notion"]["pending_batches"]) | {doc["batch_id"]})
    tick = ledger["tick"]
    if tick.get("tick_utc") != local.get("last_tick_utc"):
        tick["tick_utc"], tick["calls"] = local.get("last_tick_utc"), 0
    tick["calls"] = int(tick.get("calls", 0)) + len(doc["ops"])
    if doc["budget"]["query_calls"]:
        rate = _read(_file(layout, "rate.json"), {}) or {}
        rate["last_query_utc"] = doc["created_utc"]
        jsonio.write_json_atomic(_file(layout, "rate.json"), rate)
    events.append(ctx, "notion.batch", {"batch_id": doc["batch_id"], "kind": doc["kind"], "stage": doc["stage"],
                                        "ops": len(doc["ops"]), "query_calls": doc["budget"]["query_calls"]})


def _batch_complete(ledger: Mapping[str, Any], batch_id: str) -> bool:
    entry = (ledger.get("batches") or {}).get(batch_id)
    if not entry:
        return True
    return len(entry.get("acks") or {}) >= int(entry.get("ops", 0))


def check_configured(profile: Mapping[str, Any] | None) -> dict:
    notion = (profile or {}).get("notion") if isinstance(profile, Mapping) else None
    if not isinstance(notion, Mapping) or not notion.get("enabled"):
        raise CheckFailed("Notion is disabled in the profile", code="E_NOTION_UNCONFIGURED",
                          hint="set profile.notion.enabled through exec.py ingest")
    if not notion.get("hub_page_id"):
        raise CheckFailed("profile.notion.hub_page_id is null: the owner creates the hub page and its id goes in "
                          "through exec.py ingest", code="E_NOTION_UNCONFIGURED")
    return dict(notion)


def _first_pending(ledger: Mapping[str, Any], local: Mapping[str, Any]) -> str | None:
    """The first written batch not fully acknowledged, or None."""
    return next((bid for bid in local["notion"]["pending_batches"] if not _batch_complete(ledger, bid)), None)


def _refuse_pending(ledger: Mapping[str, Any], local: Mapping[str, Any]) -> None:
    bid = _first_pending(ledger, local)
    if bid is not None:
        raise CheckFailed(f"batch {bid} is not fully acknowledged", code="E_NOTION_PENDING",
                          hint=f"ack every op with {paths.exec_cmd()} notion ack --batch {bid} --op <op>",
                          data={"pending": bid})


def _wait_batch(ctx: Ctx, kind: str, until: datetime, why: str) -> dict:
    """An empty batch whose followup says when to come back (nothing is written, nothing is pending)."""
    return {"schema": BATCH_SCHEMA, "batch_id": _next_batch_id(ctx.layout, ctx.executor or "A", ctx.now),
            "executor": ctx.executor, "created_utc": _fmt(ctx.now), "kind": kind, "stage": 1, "wave": None,
            "ops": [], "budget": {"calls": 0, "query_calls": 0, "max_in_flight": 3},
            "followup": f"wait until {_fmt(until)} ({why})"}


def _empty_batch(ctx: Ctx, kind: str, wave: str | None, followup: str | None) -> dict:
    return {"schema": BATCH_SCHEMA, "batch_id": _next_batch_id(ctx.layout, ctx.executor or "A", ctx.now),
            "executor": ctx.executor, "created_utc": _fmt(ctx.now), "kind": kind, "stage": 1, "wave": wave,
            "ops": [], "budget": {"calls": 0, "query_calls": 0, "max_in_flight": 3}, "followup": followup}


def _rate_wait(layout: paths.Layout, now: datetime, *, queries: bool) -> tuple[datetime, str] | None:
    rate = _read(_file(layout, "rate.json"), {}) or {}
    not_before = _utc(rate.get("not_before_utc"))
    if not_before is not None and not_before > now:
        return not_before, "Notion rate limit"
    if queries:
        last = _utc(rate.get("last_query_utc"))
        if last is not None and (now - last).total_seconds() < QUERY_SPACING_S:
            return last + timedelta(seconds=QUERY_SPACING_S), "query spacing"
    return None


def diff(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any], *,
         init: bool = False, wave: str | None = None, replay_outbox: bool = False) -> dict:
    """Build, write and return the next batch (NOTION.md 6-9, 11). Holds the state and notion locks."""
    check_configured(profile)
    layout = ctx.layout
    executor = ctx.executor or "A"
    with _locks.hold(layout, "state", command=ctx.command), _locks.hold(layout, "notion", command=ctx.command):
        local = state.load(layout)
        ledger = load_ledger(layout)
        _refuse_pending(ledger, local)
        wait = _rate_wait(layout, ctx.now, queries=False)
        if wait is not None:
            return _wait_batch(ctx, "mirror", wait[0], wait[1])
        ids = _ids(layout, profile)
        schedule_cache = _read(layout.schedule_cache, None)
        schedule_cache = schedule_cache if isinstance(schedule_cache, dict) else None
        tick = ledger["tick"]
        used = int(tick.get("calls", 0)) if tick.get("tick_utc") == local.get("last_tick_utc") else 0
        room = min(MAX_OPS, MAX_TICK_CALLS - used)
        if room <= 0:
            return _empty_batch(ctx, "mirror", wave, "tick budget of 150 Notion calls spent: run notion diff at the "
                                                      "next tick")
        _release_holds(layout, plan, ledger)
        ops: list[dict] = []
        expect: dict[int, dict] = {}
        kind, stage = "mirror", 1
        followup: str | None = None
        replay_lines = [ln for ln in _unresolved(layout) if int(ln.get("attempts", 0) or 0) < MAX_REPLAY_ATTEMPTS]
        init_ops, init_stage = (_init_ops(ctx, profile, ledger, ids) if init else ([], 5))
        resolutions: list[tuple[str, int | None]] = []
        if (replay_lines or replay_outbox) and init_stage == 5:
            ops, expect, kind, stage, resolutions = _replay_ops(ctx, plan, statuses, profile, ledger, local, ids,
                                                                wave, schedule_cache, replay_lines, room)
            followup = _cmd("notion diff") if ops else None
            not_before = _utc(ledger["flags"].get("map_rebuild_not_before"))
            if not ops and not_before is not None and not_before > ctx.now:
                _save_ledger(layout, ledger)
                return _wait_batch(ctx, kind, not_before, "a view query can lag a fresh create")
        elif ledger["async"]:
            kind = "async-poll"
            for key, entry in sorted(ledger["async"].items()):
                ops.append(_op("notion-get-async-task", {"task_id": entry["task_id"]}, key, "async-poll"))
            ops = ops[:room]
            followup = _cmd("notion diff")
        elif init and init_stage < 5:
            kind, stage, ops = "init", init_stage, init_ops
            followup = _cmd("notion diff --init")
        else:
            if "ds:tasks" not in ids:
                raise CheckFailed("the Notion databases are not set up yet", code="E_NOTION_UNCONFIGURED",
                                  hint=f"run {paths.exec_cmd()} notion diff --init")
            flags = ledger["flags"]
            pages = (local.get("notion") or {}).get("pages") or {}
            needs_rebuild = flags.get("map_rebuild") or (not pages and (ledger.get("created_any")
                                                                         or not ledger["batches"]))
            if flags.get("hub_fetch"):
                ops = [_fetch_hub(str(profile["notion"]["hub_page_id"]), "hub-now")]
                followup = _cmd("notion diff")
            elif needs_rebuild and "view:board" in ids:
                not_before = _utc(flags.get("map_rebuild_not_before"))
                if not_before is not None and not_before > ctx.now:
                    return _wait_batch(ctx, "mirror", not_before, "a view query can lag a fresh create")
                ops = [_view_query(ids["view:board"], "view:board", flags.get("map_rebuild_cursor"))]
                followup = _cmd("notion diff")
            else:
                ops, expect = _mirror_ops(ctx, plan, statuses, profile, ledger, local, ids, wave, schedule_cache,
                                          creates=True, room=room, public=_public_values(layout))
                if init:
                    stage = 5
                kind = "report" if wave and any(op["purpose"] == "wave-report" for op in ops) else "mirror"
                followup = _cmd("notion diff") if any(
                    op["purpose"] == "create-row" or (op["purpose"] == "hub-now" and op["tool"] == "notion-fetch")
                    for op in ops) else None
        if any(op["tool"] == "notion-query-data-sources" for op in ops):
            if sum(1 for op in ops if op["tool"] == "notion-query-data-sources") > MAX_QUERIES:
                raise InternalError("more than 10 query calls in one batch")
            wait = _rate_wait(layout, ctx.now, queries=True)
            if wait is not None:
                _save_ledger(layout, ledger)
                return _wait_batch(ctx, kind, wait[0], wait[1])
        if not ops:
            _apply_resolutions(layout, resolutions, None)
            local["notion"]["outbox_count"] = len(_unresolved(layout))
            _save_ledger(layout, ledger)
            state.save(ctx, local)
            return _empty_batch(ctx, kind, wave, followup)
        doc = _batch_doc(ctx, _next_batch_id(layout, executor, ctx.now), kind, stage, ops, wave, followup)
        _write_batch(ctx, doc, ledger, local, expect)
        _apply_resolutions(layout, resolutions, doc["batch_id"])
        local["notion"]["outbox_count"] = len(_unresolved(layout))
        _save_ledger(layout, ledger)
        state.save(ctx, local)
        return doc


def _apply_resolutions(layout: paths.Layout, resolutions: Sequence[tuple[str, int | None]],
                       batch_id: str | None) -> None:
    """Resolve replayed outbox lines once their batch is written: `by` the resending op, or `superseded`."""
    for ref, index in resolutions:
        by = f"{batch_id}/op-{index + 1}" if (index is not None and batch_id) else "superseded"
        _resolve(layout, ref, by)


def _replay_ops(ctx: Ctx, plan: PlanModel, statuses: Mapping[str, dict], profile: Mapping[str, Any], ledger: dict,
                local: dict, ids: Mapping[str, str], wave: str | None, schedule_cache: Mapping[str, Any] | None,
                lines: list[dict], room: int
                ) -> tuple[list[dict], dict, str, int, list[tuple[str, int | None]]]:
    """Outbox replay (NOTION.md 11.3): a real read first; then queries before creates; updates regenerated.
    Returns (ops, expectations, kind, stage, resolutions); a resolution names the index of the op that resends
    the line, or None for a line the regenerated mirror supersedes."""
    seq = int(ledger.get("outbox_seq", 0))
    replay = ledger["replay"]
    hub = str(profile["notion"]["hub_page_id"])
    resolutions: list[tuple[str, int | None]] = []
    if int(replay.get("token_ok_seq", -1)) < seq:
        return [_fetch_hub(hub, "token-check")], {}, "outbox-replay", 1, resolutions
    create_seqs = [int(ln.get("seq", 0)) for ln in lines if ln.get("purpose") == "create-row"]
    wave_lines = [ln for ln in lines if ln.get("purpose") == "wave-report"]
    need_board = bool(create_seqs) and int(replay.get("map_rebuilt_seq", -1)) < max(create_seqs)
    need_waves = bool(wave_lines) and int(replay.get("waves_checked_seq", -1)) < max(
        int(ln.get("seq", 0)) for ln in wave_lines)
    ops: list[dict] = []
    expect: dict[int, dict] = {}
    if need_board:
        crash = [ln for ln in lines if ln.get("purpose") == "create-row" and ln.get("error") == "crash-unknown"]
        for ln in crash:
            created = _utc((ledger["batches"].get(ln.get("batch_id")) or {}).get("created_utc"))
            if created is not None and (ctx.now - created).total_seconds() < CRASH_REBUILD_DELAY_S:
                ledger["flags"]["map_rebuild_not_before"] = _fmt(created + timedelta(seconds=CRASH_REBUILD_DELAY_S))
        nb = _utc(ledger["flags"].get("map_rebuild_not_before"))
        if nb is None or nb <= ctx.now:
            if "view:board" in ids:
                ops.append(_view_query(ids["view:board"], "view:board"))
            else:
                replay["map_rebuilt_seq"] = max(create_seqs)
                need_board = False
    if need_waves:
        if "view:waves" in ids:
            ops.append(_view_query(ids["view:waves"], "view:waves"))
        else:
            replay["waves_checked_seq"] = seq
            need_waves = False
    pages = (local.get("notion") or {}).get("pages") or {}
    for ln in sorted(lines, key=lambda x: int(x.get("seq", 0))):
        ref = f"{ln.get('batch_id')}/{ln.get('op_id')}"
        purpose = ln.get("purpose")
        if purpose == "set-ingested" and isinstance(ln.get("op"), dict):
            again = json.loads(json.dumps(ln["op"]))
            again["replay_of"] = ref
            resolutions.append((ref, len(ops)))
            ops.append(again)
        elif purpose == "wave-report":
            if need_waves:
                continue
            if ln.get("key") in pages:
                resolutions.append((ref, None))
            elif isinstance(ln.get("op"), dict):
                again = json.loads(json.dumps(ln["op"]))
                again["replay_of"] = ref
                expect[len(ops)] = {"wave": str(ln.get("key", ""))[5:]}
                resolutions.append((ref, len(ops)))
                ops.append(again)
        elif purpose == "create-row":
            if not need_board:
                resolutions.append((ref, None))
        else:
            resolutions.append((ref, None))
    stage = 2 if (need_board or need_waves) else 3
    if "ds:tasks" not in ids:
        pass
    elif not need_board and len(ops) < room:
        mirror, mexp = _mirror_ops(ctx, plan, statuses, profile, ledger, local, ids, wave, schedule_cache,
                                   creates=True, room=room - len(ops), public=_public_values(ctx.layout))
        base = len(ops)
        for i, e in mexp.items():
            expect[base + i] = e
        ops.extend(mirror)
    elif need_board and len(ops) < room:
        mirror, mexp = _mirror_ops(ctx, plan, statuses, profile, ledger, local, ids, None, schedule_cache,
                                   creates=False, room=room - len(ops), public=_public_values(ctx.layout))
        base = len(ops)
        for i, e in mexp.items():
            expect[base + i] = e
        ops.extend(mirror)
    kept = [(ref, i) for ref, i in resolutions if i is None or i < room]
    return ops[:room], {i: e for i, e in expect.items() if i < room}, "outbox-replay", stage, kept


# --- acknowledgements (NOTION.md 6.2, 6.3, 11.2) ----------------------------------------------------------------------

def _apply_pointer(pointer: str, raw: str, as_name: str) -> list[str]:
    """Matches of one capture pointer over the raw result (JSON pointer, `re:` or `re*:`)."""
    if pointer.startswith("re*:"):
        return [m.group(1) for m in re.finditer(pointer[4:], raw)]
    if pointer.startswith("re:"):
        text = raw
        if as_name.startswith("db:"):
            first = _NOTION_URL.search(raw)
            text = first.group(0) if first else ""
        m = re.search(pointer[3:], text, re.M)
        return [m.group(1)] if m else []
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError:
        return []
    value: Any = doc
    for part in pointer.split("/")[1:]:
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        elif isinstance(value, dict) and part in value:
            value = value[part]
        else:
            return []
    return [str(value)] if value is not None else []


def _normalise_id(name: str, value: str) -> str:
    if name.startswith(("page:", "rows:", "db:")):
        m = _HEX32.search(value.replace("-", "").lower())
        return m.group(0) if m else value
    if name.startswith("ds:"):
        return _bare_ds(value)
    return value


def classify_error(text: str, code: str | None) -> str:
    """NOTION.md 11.2: rate-limit, deferred, crash, block-cap, auth, validation, transient."""
    if code == "deferred:rate_limited":
        return "deferred"
    if code == "crash-unknown":
        return "crash"
    low = (text or "").lower()
    if "rate_limited" in low or "retry_after_seconds" in low:
        return "rate-limit"
    if re.search(r"\b403\b", low) and "restricted_resource" in low:
        return "block-cap"
    if (re.search(r"\b401\b", low) or "unauthorized" in low or "invalid_grant" in low or "session token" in low
            or "token rejected" in low or "/login" in low):
        return "auth"
    if re.search(r"\b400\b", low) or "validation" in low or "invalid" in low:
        return "validation"
    return "transient"


def _parse_access(raw: str) -> dict[str, str]:
    """get-tool-access result -> {tool: status} for the required tools ('unknown' when a tool is not named)."""
    out: dict[str, str] = {}
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError:
        doc = None

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            name = value.get("tool_name") or value.get("name") or value.get("tool")
            status = value.get("status")
            if isinstance(name, str) and isinstance(status, str):
                for tool in REQUIRED_TOOLS:
                    if name == tool or name.endswith(tool) or name.replace("-", "_").endswith(tool):
                        out[tool] = status
            for key, sub in value.items():
                if isinstance(sub, dict) and isinstance(sub.get("status"), str):
                    for tool in REQUIRED_TOOLS:
                        if key == tool or key.replace("-", "_").endswith(tool):
                            out[tool] = sub["status"]
                walk(sub)
        elif isinstance(value, list):
            for sub in value:
                walk(sub)
    walk(doc)
    for tool in REQUIRED_TOOLS:
        if tool in out:
            continue
        m = re.search(r"(?:notion[-_])?" + re.escape(tool).replace("_", "[-_]") +
                      r"[\"']?[^\n]{0,80}?\b(available_with_limit|available|unavailable|not_available|denied|"
                      r"disabled|forbidden|blocked)\b", raw)
        out[tool] = m.group(1) if m else "unknown"
    return out


def _hub_facts(raw: str) -> dict:
    """From a hub fetch: which "Now" markers exist, and the child databases to adopt (by their titles)."""
    facts: dict[str, Any] = {"A": _marker_start("A") in raw, "B": _marker_start("B") in raw, "adopt": {}}
    urls = [(m.start(), m.group(0)) for m in _NOTION_URL.finditer(raw)]
    colls = [(m.start(), m.group(1)) for m in re.finditer(r"(collection://[0-9a-f-]{32,36})", raw)]
    for name, title in (("tasks", "Tâches · "), ("waves", "Vagues · ")):
        pos = raw.find(title)
        if pos < 0:
            continue
        near = sorted(((abs(p - pos), u) for p, u in urls if abs(p - pos) <= 400), key=lambda t: t[0])
        if near:
            m = _HEX32.search(near[0][1].replace("-", "").lower().split("?")[0])
            if m:
                facts["adopt"][f"db:{name}"] = m.group(0)
        nearc = sorted(((abs(p - pos), c) for p, c in colls if abs(p - pos) <= 400), key=lambda t: t[0])
        if nearc:
            facts["adopt"][f"ds:{name}"] = _bare_ds(nearc[0][1])
    return facts


def _block_of(raw: str, executor: str) -> str | None:
    start = raw.find(_marker_start(executor))
    if start < 0:
        return None
    end = raw.find(_marker_end(executor), start)
    if end < 0:
        return None
    return raw[start: end + len(_marker_end(executor))]


def _query_rows(raw: str) -> list[dict]:
    """Rows of a view query: [{key, page_id, props}] (JSON first, then one regex segment per page URL)."""
    out: list[dict] = []
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError:
        doc = None
    if doc is not None:
        def walk(value: Any) -> None:
            if isinstance(value, dict):
                props = value.get("properties") if isinstance(value.get("properties"), dict) else value
                key = props.get("Clé") if isinstance(props, dict) else None
                ident = value.get("id") or value.get("url") or value.get("page_id")
                if isinstance(key, str) and isinstance(ident, str):
                    m = _HEX32.search(ident.replace("-", "").lower())
                    if m:
                        out.append({"key": key.strip(), "page_id": m.group(0), "props": props,
                                    "title": props.get("Vague") or props.get("Tâche")})
                for sub in value.values():
                    walk(sub)
            elif isinstance(value, list):
                for sub in value:
                    walk(sub)
        walk(doc)
        if out:
            return out
    marks = list(re.finditer(P_ROWS[4:], raw))
    for i, m in enumerate(marks):
        seg = raw[m.end(): marks[i + 1].start() if i + 1 < len(marks) else len(raw)]
        km = re.search(P_TO_INGEST[4:], seg)
        tm = re.search(r"\b(W[0-9]{2,3} · [AB])\b", seg)
        out.append({"key": km.group(1) if km else None, "page_id": m.group(1), "props": {},
                    "title": tm.group(1) if tm else None})
    return out


def _fetched_props(raw: str) -> dict | None:
    """Properties of a page from a fetch result (`<properties>{json}</properties>` or a JSON document)."""
    m = re.search(r"<properties>\s*(\{.*?\})\s*</properties>", raw, re.S)
    text = m.group(1) if m else raw
    try:
        doc = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(doc, dict) and isinstance(doc.get("properties"), dict):
        return doc["properties"]
    return doc if isinstance(doc, dict) else None


def _norm(value: Any) -> Any:
    if isinstance(value, bool):
        return "__YES__" if value else "__NO__"
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        v = value.strip()
        if v in ("__YES__", "__NO__"):
            return v
        try:
            return float(v)
        except ValueError:
            return v
    if isinstance(value, list):
        return [str(x) for x in value]
    return value


def _check_divergence(ctx: Ctx, ledger: dict, key: str, fetched: Mapping[str, Any], plan: PlanModel) -> list[str]:
    """Compare the fetched orchestrator-owned values with the last acknowledged ones (NOTION.md 5.2). On mismatch:
    the row is held and a decision proposal command is returned."""
    acked = (ledger["rows"].get(key) or {}).get("props")
    if not acked:
        return []
    fields = sorted(name for name in ORCHESTRATOR_FIELDS
                    if name in fetched and name in acked and name != RELATION
                    and _norm(fetched[name]) != _norm(acked[name]))
    if not fields:
        return []
    layout = ctx.layout
    holds = _divergence(layout)
    title = f"Notion : {key} modifiée à la main ({', '.join(fields)})"
    holds[key] = {"seen_utc": _fmt(ctx.now), "fields": fields, "title": _cut(title, 160),
                  "plan_version": plan.version}
    jsonio.write_json_atomic(_file(layout, "divergence.json"), holds)
    options = [{"id": "rewrite", "label": "Réécrire depuis le dépôt",
                "consequence": "la ligne est réécrite depuis le dépôt d'état au prochain miroir"},
               {"id": "amend", "label": "Proposer une modification du plan",
                "consequence": "la modification passe par exec.py amend ; la ligne reste figée jusque-là"}]
    opt_path = _file(layout, f"divergence-{key}.options.json")
    jsonio.write_json_atomic(opt_path, options)
    task_arg = f" --task {key}" if key.startswith("T") else ""
    return [_cmd(f"decision propose --kind other --title \"{_cut(title, 160)}\" --options-file "
                 f"{_path_arg(opt_path)} --recommended rewrite{task_arg}")]


def _outbox_append(ctx: Ctx, ledger: dict, local: dict, batch: Mapping[str, Any], op: Mapping[str, Any],
                   error: str, cls: str, retry_after: int | None) -> dict:
    replay_of = op.get("replay_of")
    attempts = 99 if cls == "validation" else int(ledger["replay_attempts"].get(str(replay_of), 0)) + 1 \
        if replay_of else 1
    ledger["outbox_seq"] = int(ledger.get("outbox_seq", 0)) + 1
    line = {"at_utc": _fmt(ctx.now), "batch_id": batch["batch_id"], "op_id": op["op_id"], "kind": batch["kind"],
            "key": op["key"], "purpose": op["purpose"], "error": _cut(redact(error or ""), 300),
            "retry_after_s": retry_after, "attempts": attempts, "op": op, "class": cls, "seq": ledger["outbox_seq"]}
    ledger["replay_attempts"][f"{batch['batch_id']}/{op['op_id']}"] = attempts
    jsonio.append_jsonl(ctx.layout.notion_outbox, line)
    local["notion"]["outbox_count"] = len(_unresolved(ctx.layout))
    events.append(ctx, "notion.outbox", {"batch": batch["batch_id"], "op": op["op_id"], "class": cls,
                                         "attempts": attempts})
    return line


def ack(ctx: Ctx, batch_id: str, op_id: str, result: str | None, error: str | None, retry_after: int | None, *,
        error_code: str | None = None) -> dict:
    """Record one op's outcome (CLI.md `notion ack`; MODULES.md 5) and return its data `{op, ok, captured,
    outbox_count, next}`. Idempotent per op: a second ack returns the first one's data. The optional keyword
    `error_code` (contract revision 3) is the `--error-code` of a failed ack (`deferred:rate_limited`,
    `crash-unknown`). A capture failure or an async timeout is recorded (and repeated identically) but only
    `cmd_ack`'s envelope carries its error code and exit 1."""
    return _ack_result(ctx, batch_id, op_id, result, error, retry_after, error_code).data


def _ack_result(ctx: Ctx, batch_id: str, op_id: str, result: str | None, error: str | None,
                retry_after: int | None, error_code: str | None) -> CommandResult:
    """`ack` with its exit code and errors, for the command envelope (Q-B09-10)."""
    layout = ctx.layout
    with _locks.hold(layout, "state", command=ctx.command), _locks.hold(layout, "notion", command=ctx.command):
        path = layout.notion_batch(batch_id)
        if not path.exists():
            raise UsageError(f"unknown Notion batch {batch_id}")
        batch = jsonio.read_json_retry(path)
        op = next((o for o in batch.get("ops") or [] if o.get("op_id") == op_id), None)
        if op is None:
            raise UsageError(f"batch {batch_id} has no op {op_id}")
        ledger = load_ledger(layout)
        entry = ledger["batches"].setdefault(batch_id, {"kind": batch["kind"], "stage": batch["stage"],
                                                        "created_utc": batch["created_utc"],
                                                        "ops": len(batch["ops"]), "acks": {}, "expect": {}})
        if op_id in entry["acks"]:
            prior = entry["acks"][op_id]
            return CommandResult(data=prior["data"], exit_code=int(prior.get("exit_code", 0)),
                                 errors=[ErrorItem(**e) for e in prior.get("errors") or []])
        local = state.load(layout)
        profile = _read(layout.profile, {}) or {}
        plan = plan_mod.load(layout)
        data, errors = _ack_one(ctx, ledger, local, profile, plan, batch, op, entry, result, error, retry_after,
                                error_code)
        exit_code = 1 if errors else 0
        entry["acks"][op_id] = {"data": data, "exit_code": exit_code, "errors": [e.to_dict() for e in errors]}
        if _batch_complete(ledger, batch_id):
            local["notion"]["pending_batches"] = [b for b in local["notion"]["pending_batches"] if b != batch_id]
            if batch.get("followup") and batch["followup"] not in data["next"]:
                data["next"].append(batch["followup"])
        local["notion"]["outbox_count"] = len(_unresolved(layout))
        data["outbox_count"] = local["notion"]["outbox_count"]
        entry["acks"][op_id]["data"] = data
        events.append(ctx, "notion.ack", {"batch": batch_id, "op": op_id, "purpose": op["purpose"], "key": op["key"],
                                          "ok": data["ok"], "captured": sorted(data["captured"])})
        _save_ledger(layout, ledger)
        state.save(ctx, local)
        return CommandResult(data=data, exit_code=exit_code, errors=errors)


def _record_rows(ledger: dict, local: dict, exp: Mapping[str, Any] | None) -> None:
    for key, rec in ((exp or {}).get("rows") or {}).items():
        ledger["rows"][key] = {"props": rec["props"], "body": rec["body"]}
        local["notion"]["hashes"][key] = row_hash(rec["props"], rec["body"])


def _ack_one(ctx: Ctx, ledger: dict, local: dict, profile: Mapping[str, Any], plan: PlanModel,
             batch: Mapping[str, Any], op: Mapping[str, Any], entry: Mapping[str, Any], result: str | None,
             error: str | None, retry_after: int | None, error_code: str | None) -> tuple[dict, list[ErrorItem]]:
    layout = ctx.layout
    executor = ctx.executor or "A"
    data: dict[str, Any] = {"op": op["op_id"], "ok": False, "captured": {}, "outbox_count": 0, "next": []}
    errors: list[ErrorItem] = []
    notion_state = local["notion"]
    exp = (entry.get("expect") or {}).get(op["op_id"])
    if result is None:
        cls = classify_error(error or "", error_code)
        text = error if error is not None else str(error_code)
        if cls == "rate-limit":
            m = re.search(r"retry_after_seconds\D{0,5}([0-9]+)", error or "")
            secs = retry_after if retry_after is not None else (int(m.group(1)) if m else 30)
            secs = max(2, secs)
            rate = _read(_file(layout, "rate.json"), {}) or {}
            rate["not_before_utc"] = _fmt(ctx.now + timedelta(seconds=secs))
            jsonio.write_json_atomic(_file(layout, "rate.json"), rate)
            retry_after = secs
        if cls == "auth":
            ledger["auth_failures"] = int(ledger.get("auth_failures", 0)) + 1
            if ledger["auth_failures"] >= 2:
                notion_state["token_ok"] = False
                data["next"].append("push: Notion refuse le jeton : tape /login sur l'ordinateur, puis /mcp "
                                    "reconnect. Le build continue.")
        if cls == "block-cap":
            jsonio.write_json_atomic(_file(layout, "degraded.json"), {"creates": False, "since_utc": _fmt(ctx.now)})
        if op["purpose"] == "hub-now" and re.search(r"no match|not found|old_str", (error or "").lower()):
            ledger["flags"]["hub_fetch"] = True
        if cls == "crash" and op["purpose"] == "create-row":
            ledger["flags"]["map_rebuild"] = True
            created = _utc(batch.get("created_utc")) or ctx.now
            ledger["flags"]["map_rebuild_not_before"] = _fmt(created + timedelta(seconds=CRASH_REBUILD_DELAY_S))
        if op["purpose"] == "async-poll":
            data["next"].append(_cmd("notion diff"))
        _outbox_append(ctx, ledger, local, batch, op, text, cls, retry_after)
        if cls == "validation":
            data["next"].append(_cmd(f"decision propose --kind dependency-missing --title \"Notion : format refusé "
                                     f"pour {op['tool']} ({op['key']})\""))
        data["next"].append(_cmd("notion diff"))
        return data, errors

    raw = result
    purpose, tool, key = op["purpose"], op["tool"], op["key"]
    if tool in ("notion-create-pages", "notion-update-page", "notion-create-database") and \
            re.search(r"async_task", raw):
        found = _apply_pointer(P_ASYNC, raw, "async:" + key)
        if not found:
            errors.append(ErrorItem("E_CAPTURE_EMPTY", f"{op['op_id']}: async result without a task id",
                                    hint="the rehearsal R-N1 checks the async pattern"))
            return data, errors
        ledger["async"][key] = {"task_id": found[0], "batch": batch["batch_id"], "op": op["op_id"], "polls": 0}
        data["ok"], data["captured"] = True, {f"async:{key}": found[0]}
        data["next"].append(_cmd("notion diff"))
        return data, errors

    if purpose == "async-poll":
        pending = ledger["async"].get(key) or {}
        m = re.search(r"\"?status\"?\s*[:=]\s*\"?(succeeded|queued|running|retrying|failed)", raw)
        status = m.group(1) if m else "unknown"
        if status == "succeeded":
            origin_batch = jsonio.read_json_retry(layout.notion_batch(pending["batch"])) if pending else None
            origin_op = next((o for o in (origin_batch or {}).get("ops") or [] if o.get("op_id") == pending.get("op")),
                             None)
            origin_entry = ledger["batches"].get(pending.get("batch"), {})
            ledger["async"].pop(key, None)
            if origin_op is not None:
                sub, errs = _success(ctx, ledger, local, profile, plan, origin_batch, origin_op,
                                     (origin_entry.get("expect") or {}).get(origin_op["op_id"]), raw)
                data["captured"] = sub
                errors.extend(errs)
            data["ok"] = not errors
            return data, errors
        if status in ("queued", "running", "retrying", "unknown"):
            pending["polls"] = int(pending.get("polls", 0)) + 1
            if pending["polls"] >= MAX_ASYNC_POLLS:
                ledger["async"].pop(key, None)
                origin_batch = jsonio.read_json_retry(layout.notion_batch(pending["batch"]))
                origin_op = next(o for o in origin_batch["ops"] if o["op_id"] == pending["op"])
                _outbox_append(ctx, ledger, local, origin_batch, origin_op, "E_ASYNC_TIMEOUT", "transient", None)
                errors.append(ErrorItem("E_ASYNC_TIMEOUT", f"async task of {key} still {status} after "
                                        f"{MAX_ASYNC_POLLS} polls: moved to the outbox"))
                return data, errors
            ledger["async"][key] = pending
            data["ok"] = True
            data["next"].append(_cmd("notion diff"))
            return data, errors
        ledger["async"].pop(key, None)
        origin_batch = jsonio.read_json_retry(layout.notion_batch(pending["batch"]))
        origin_op = next(o for o in origin_batch["ops"] if o["op_id"] == pending["op"])
        _outbox_append(ctx, ledger, local, origin_batch, origin_op, "async task failed", "transient", None)
        data["next"].append(_cmd("notion diff"))
        return data, errors

    captured, errs = _success(ctx, ledger, local, profile, plan, batch, op, exp, raw)
    data["captured"] = captured
    errors.extend(errs)
    data["ok"] = not errors
    if errors:
        return data, errors
    notion_state["last_ok_utc"] = _fmt(ctx.now)
    if purpose == "token-check":
        ledger["auth_failures"] = 0
    if tool == "notion-get-tool-access":
        access = _parse_access(raw)
        jsonio.write_json_atomic(_file(layout, "access.json"), access)
        bad = sorted(t for t, s in access.items() if s not in OK_ACCESS)
        ledger["init"]["access_ok"] = not bad
        if bad:
            data["next"].append(_cmd(f"decision propose --kind dependency-missing --title \"Notion : outils "
                                     f"indisponibles ({', '.join(bad)})\""))
    elif tool == "notion-fetch" and purpose == "token-check":
        notion_state["token_ok"] = True
        ledger["replay"]["token_ok_seq"] = int(ledger.get("outbox_seq", 0))
        for ln in _unresolved(layout):
            if ln.get("purpose") == "token-check":
                _resolve(layout, f"{ln['batch_id']}/{ln['op_id']}", f"{batch['batch_id']}/{op['op_id']}")
        if batch["kind"] == "init":
            facts = _hub_facts(raw)
            ledger["init"]["hub_fetched"] = True
            ledger["init"]["refetch"] = False
            ledger["init"]["hub_has_block"] = {"A": facts["A"], "B": facts["B"]}
            ids_doc = _read(_file(layout, "ids.json"), {}) or {}
            for name, value in sorted(facts["adopt"].items()):
                if name not in ids_doc and not _ids(layout, profile).get(name):
                    ids_doc[name] = value
                    data["captured"][name] = value
            jsonio.write_json_atomic(_file(layout, "ids.json"), ids_doc)
            block = _block_of(raw, executor)
            if block is not None and not _file(layout, "hub-now.txt").exists():
                jsonio.write_text_atomic(_file(layout, "hub-now.txt"), block)
    elif tool == "notion-fetch" and purpose == "hub-now":
        block = _block_of(raw, executor)
        ledger["flags"]["hub_fetch"] = False
        if block is None:
            ledger["flags"]["hub_reinsert"] = True
            ledger["hub_recreated_utc"] = _fmt(ctx.now)
        else:
            jsonio.write_text_atomic(_file(layout, "hub-now.txt"), block)
            notion_state["last_hub_text_sha256"] = jsonio.sha256_bytes(block.encode("utf-8"))
    elif purpose == "fetch-answer":
        fetched = _fetched_props(raw)
        target = key.split(":", 1)[1]
        if fetched:
            data["next"].extend(_check_divergence(ctx, ledger, target, fetched, plan))
        poll = _read(_file(layout, "poll.json"), {}) or {}
        poll["hits"] = [h for h in poll.get("hits") or [] if h.get("key") != target]
        jsonio.write_json_atomic(_file(layout, "poll.json"), poll)
    elif purpose == "poll":
        _ack_query(ctx, ledger, local, plan, op, raw, data)
    if _init_complete(ledger, layout, profile) and batch["kind"] == "init":
        patch = _profile_patch(layout, profile)
        if patch:
            patch_path = _file(layout, "profile-ids.patch.json")
            jsonio.write_json_atomic(patch_path, patch)
            data["next"].append(_cmd(f"ingest --patch {_path_arg(patch_path)} --notion-ids"))
    return data, errors


def _success(ctx: Ctx, ledger: dict, local: dict, profile: Mapping[str, Any], plan: PlanModel,
             batch: Mapping[str, Any], op: Mapping[str, Any], exp: Mapping[str, Any] | None, raw: str
             ) -> tuple[dict, list[ErrorItem]]:
    """Captures and recorded hashes of a successful op (also used for an async op that succeeded)."""
    layout = ctx.layout
    notion_state = local["notion"]
    captured: dict[str, str] = {}
    errors: list[ErrorItem] = []
    purpose, key = op["purpose"], op["key"]
    ids_doc = _read(_file(layout, "ids.json"), {}) or {}
    for cap in op.get("capture") or []:
        name, pointer = cap["as"], cap["pointer"]
        if name.startswith("rows:"):
            continue
        found = _apply_pointer(pointer, raw, name)
        if not found:
            errors.append(ErrorItem("E_CAPTURE_EMPTY", f"{op['op_id']}: the capture {name} matched nothing",
                                    hint="the result format differs from NOTION.md 6.2 (rehearsal R-N1)"))
            continue
        value = _normalise_id(name, found[0])
        captured[name] = value
        ids_doc[name] = value
    if captured:
        jsonio.write_json_atomic(_file(layout, "ids.json"), ids_doc)
    if purpose == "create-db" and errors:
        ledger["init"]["refetch"] = True  # adopt what was created through a hub fetch, never create twice
    if purpose == "self-relation" and key == "relation:tasks":
        if RELATION in raw:
            ledger["init"]["relation_done"] = True
        else:
            errors.append(ErrorItem("E_CAPTURE_EMPTY", f"{op['op_id']}: the result does not mention {RELATION!r}"))
    if purpose == "hub-now" and op["tool"] == "notion-update-page" and not errors:
        content = op["args"].get("content")
        if content is None:
            content = (op["args"].get("content_updates") or [{}])[0].get("new_str")
        if exp and exp.get("hub_text"):
            content = exp["hub_text"]
        executor = ctx.executor or "A"
        block = _block_of(str(content or ""), executor)
        if block is not None:
            jsonio.write_text_atomic(_file(layout, "hub-now.txt"), block)
            notion_state["last_hub_text_sha256"] = jsonio.sha256_bytes(block.encode("utf-8"))
        ledger["init"]["skeleton_done"] = True if batch["kind"] == "init" else ledger["init"].get("skeleton_done")
        ledger["flags"]["hub_reinsert"] = False
        ledger["flags"]["hub_wave"] = None
        ledger["last_hub_utc"] = _fmt(ctx.now)
        if op.get("hash"):
            notion_state["hashes"]["hub"] = op["hash"]
    if purpose in ("create-row", "wave-report") and not errors:
        pages = notion_state["pages"]
        found = [m for m in re.finditer(P_ROWS[4:], raw)]
        page_ids = []
        for m in found:
            pid = m.group(1)
            if pid not in page_ids:
                page_ids.append(pid)
        if purpose == "create-row":
            order = list((exp or {}).get("order") or [p["properties"]["Clé"] for p in op["args"]["pages"]])
            if len(page_ids) != len(order):
                ledger["flags"]["map_rebuild"] = True
                errors.append(ErrorItem("E_CAPTURE_COUNT", f"{op['op_id']}: {len(page_ids)} page ids for "
                                        f"{len(order)} pages; the view:board map is rebuilt before any create"))
                return captured, errors
            for k, pid in zip(order, page_ids):
                pages[k] = pid
                captured[f"page:{k}"] = pid
            _record_rows(ledger, local, exp)
            ledger["created_any"] = True
        else:
            if not page_ids:
                errors.append(ErrorItem("E_CAPTURE_EMPTY", f"{op['op_id']}: no page id in the result"))
                return captured, errors
            pages[key] = page_ids[0]
            captured[f"page:{key}"] = page_ids[0]
            if op.get("hash"):
                notion_state["hashes"][key] = op["hash"]
    if purpose in ("update-row", "self-relation", "set-ingested") and key != "relation:tasks" and not errors:
        _record_rows(ledger, local, exp)
        if key in (ledger.get("ingested") or {}) and purpose == "set-ingested":
            pass
    return captured, errors


def _ack_query(ctx: Ctx, ledger: dict, local: dict, plan: PlanModel, op: Mapping[str, Any], raw: str,
               data: dict) -> None:
    layout = ctx.layout
    executor = ctx.executor or "A"
    key = op["key"]
    rows = _query_rows(raw)
    more = re.search(r"\"?has_more\"?\s*[:=]\s*true", raw)
    cursor_m = re.search(r"\"?next_cursor\"?\s*[:=]\s*\"([^\"]+)\"", raw)
    cursor = cursor_m.group(1) if (more and cursor_m) else None
    pages = local["notion"]["pages"]

    def own(k: str) -> bool:
        if k.startswith("D-"):
            return in_range(k, executor)
        task = plan.by_id.get(k)
        return task is not None and task.executor == executor

    if key == "view:board":
        for row in rows:
            k = row.get("key")
            if not k or not own(k):
                continue
            pages[k] = row["page_id"]
            if row.get("props") and (ledger["rows"].get(k) or {}).get("props"):
                data["next"].extend(_check_divergence(ctx, ledger, k, row["props"], plan))
            ledger["rows"].pop(k, None)  # hash unknown: rewritten once
            local["notion"]["hashes"].pop(k, None)
        if cursor:
            ledger["flags"]["map_rebuild_cursor"] = cursor
        else:
            ledger["flags"]["map_rebuild"] = False
            ledger["flags"].pop("map_rebuild_cursor", None)
            ledger["flags"]["map_rebuild_not_before"] = None
            ledger["replay"]["map_rebuilt_seq"] = int(ledger.get("outbox_seq", 0))
        data["captured"] = {"rows:board": str(len(rows))}
        data["next"].append(_cmd("notion diff"))
    elif key == "view:waves":
        for row in rows:
            title = str(row.get("title") or "")
            m = re.match(r"^(W[0-9]{2,3}) · ([AB])$", title)
            if m and m.group(2) == executor:
                pages[f"wave:{m.group(1)}"] = row["page_id"]
        ledger["replay"]["waves_checked_seq"] = int(ledger.get("outbox_seq", 0))
        data["captured"] = {"rows:waves": str(len(rows))}
        data["next"].append(_cmd("notion diff"))
    elif key == "poll:to_ingest":
        keys = [m.group(1) for m in re.finditer(P_TO_INGEST[4:], raw)]
        awaited = {str(a.get("ref")) for a in local.get("awaiting") or [] if isinstance(a, dict)}
        by_key = {r["key"]: r["page_id"] for r in rows if r.get("key")}
        poll = _read(_file(layout, "poll.json"), {}) or {}
        hits = {h["key"]: h for h in poll.get("hits") or [] if isinstance(h, dict) and h.get("key")}
        for k in keys:
            if not own(k) or k not in awaited:
                continue
            page = pages.get(k) or by_key.get(k)
            if not page:
                _LOG.warning("a polled row has no known page id", extra={"data": {"key": k}})
                continue
            hits[k] = {"key": k, "page_id": page}
        poll["hits"] = [hits[k] for k in sorted(hits)]
        poll["cursor"] = cursor
        jsonio.write_json_atomic(_file(layout, "poll.json"), poll)
        data["captured"] = {"rows:to_ingest": ",".join(sorted(hits))}
        if hits or cursor:
            data["next"].append(_cmd("notion poll-plan"))


def _init_complete(ledger: Mapping[str, Any], layout: paths.Layout, profile: Mapping[str, Any]) -> bool:
    ids = _ids(layout, profile)
    return (ledger["init"].get("relation_done") is True
            and all(f"view:{v['key']}" in ids for v in VIEWS)
            and all(k in ids for k in ("db:tasks", "ds:tasks", "db:waves", "ds:waves")))


def _profile_patch(layout: paths.Layout, profile: Mapping[str, Any]) -> list[dict]:
    """RFC 6902 `replace` ops filling only the null id fields of profile.notion (NOTION.md 7.3)."""
    captured = _read(_file(layout, "ids.json"), {}) or {}
    notion = profile.get("notion") or {}
    ops: list[dict] = []
    for name in ("tasks", "waves"):
        if (notion.get("databases") or {}).get(name) is None and f"db:{name}" in captured \
                and f"ds:{name}" in captured:
            ops.append({"op": "replace", "path": f"/notion/databases/{name}",
                        "value": {"database_id": captured[f"db:{name}"], "data_source_id": captured[f"ds:{name}"]}})
    for view in VIEWS:
        if (notion.get("views") or {}).get(view["key"]) is None and f"view:{view['key']}" in captured:
            ops.append({"op": "replace", "path": f"/notion/views/{view['key']}",
                        "value": captured[f"view:{view['key']}"]})
    return ops


def ack_pending_as_crashed(ctx: Ctx) -> list[str]:
    """Resume step R9: ack every unacknowledged op of every pending batch `--failed --error-code crash-unknown`.
    Returns the acknowledged `batch/op` references."""
    layout = ctx.layout
    done: list[str] = []
    with _locks.hold(layout, "state", command=ctx.command), _locks.hold(layout, "notion", command=ctx.command):
        local = state.load(layout)
        ledger = load_ledger(layout)
        pending = list(local["notion"]["pending_batches"])
    for bid in sorted(pending):
        path = layout.notion_batch(bid)
        if not path.exists():
            continue
        batch = jsonio.read_json_retry(path)
        acked = set(((ledger["batches"].get(bid) or {}).get("acks") or {}).keys())
        for op in batch.get("ops") or []:
            if op["op_id"] in acked:
                continue
            ack(ctx, bid, op["op_id"], None, None, None, error_code="crash-unknown")
            done.append(f"{bid}/{op['op_id']}")
    return done


# --- the poll plan (NOTION.md 10) -------------------------------------------------------------------------------------

def poll_plan(ctx: Ctx, profile: Mapping[str, Any]) -> dict:
    """Stage 1: one view-mode query on "À ingérer"; stage 2 (after a poll with hits): one fetch per hit, whose
    stored results go to `answers ingest --from-notion` or `decision resolve --from-notion`. While an earlier batch
    is not fully acknowledged: an empty batch with `pending: true` whose followup names that batch (exit 0)."""
    check_configured(profile)
    layout = ctx.layout
    executor = ctx.executor or "A"
    with _locks.hold(layout, "state", command=ctx.command), _locks.hold(layout, "notion", command=ctx.command):
        local = state.load(layout)
        ledger = load_ledger(layout)
        pending = _first_pending(ledger, local)
        if pending is not None:
            # Contract revision 3 (README.md 10): exit 0 with `pending: true`; the poll waits for the batch being
            # executed, so there is never a second pending batch (`notion diff` refuses with E_NOTION_PENDING).
            doc = _empty_batch(ctx, "poll", None, f"ack every op of batch {pending} first ({paths.exec_cmd()} "
                                                  f"notion ack --batch {pending} --op <op>), then "
                                                  + _cmd("notion poll-plan"))
            return {**doc, "pending": True}
        ids = _ids(layout, profile)
        if "view:to_ingest" not in ids:
            raise CheckFailed("the \"À ingérer\" view is not known yet", code="E_NOTION_UNCONFIGURED",
                              hint=f"run {paths.exec_cmd()} notion diff --init")
        wait = _rate_wait(layout, ctx.now, queries=False)
        if wait is not None:
            return _wait_batch(ctx, "poll", wait[0], wait[1])
        if local["notion"].get("token_ok") is False:
            return _empty_batch(ctx, "poll", None, _cmd("notion diff --replay-outbox") + " (the token check comes "
                                                                                       "first)")
        awaiting = [a for a in local.get("awaiting") or [] if isinstance(a, dict)]
        poll = _read(_file(layout, "poll.json"), {}) or {}
        hits = [h for h in poll.get("hits") or [] if isinstance(h, dict)]
        plan = plan_mod.load(layout)
        if hits:
            ops = []
            follow = []
            batch_id = _next_batch_id(layout, executor, ctx.now)
            for n, hit in enumerate(hits, start=1):
                k = hit["key"]
                ops.append(_op("notion-fetch", {"id": hit["page_id"]}, f"answer:{k}", "fetch-answer"))
                # where the orchestrator Writes this op's raw result (references/notion.md), named absolutely
                result = _path_arg(_notion_dir(layout) / "results" / batch_id / f"op-{n}.txt")
                by = _answer_by(layout, ledger, plan, k)
                if k.startswith("T"):
                    follow.append(_cmd(f"answers ingest --from-notion {result} --task {k} --by {by}"))
                else:
                    follow.append(_cmd(f"decision resolve --id {k} --from-notion {result} --by {by} "
                                       f"--source notion"))
            doc = _batch_doc(ctx, batch_id, "answer-fetch", 2, ops[:MAX_OPS], None, "\n".join(follow))
            _write_batch(ctx, doc, ledger, local, {})
            _save_ledger(layout, ledger)
            state.save(ctx, local)
            events.append(ctx, "notion.poll", {"batch_id": batch_id, "stage": 2, "hits": len(ops)})
            return doc
        if not awaiting and not poll.get("cursor"):
            return _empty_batch(ctx, "poll", None, None)
        last = _utc(poll.get("last_poll_utc"))
        if last is not None:
            urgent = _poll_urgent(ctx, plan, local, awaiting)
            min_gap = 3 if urgent else 15
            if clock.minutes_between(last, ctx.now) < min_gap:
                return _wait_batch(ctx, "poll", last + timedelta(minutes=min_gap),
                                   "poll interval (3 min when urgent, else 15 min)")
        wait = _rate_wait(layout, ctx.now, queries=True)
        if wait is not None:
            return _wait_batch(ctx, "poll", wait[0], wait[1])
        op = _view_query(ids["view:to_ingest"], "poll:to_ingest", poll.get("cursor"))
        batch_id = _next_batch_id(layout, executor, ctx.now)
        doc = _batch_doc(ctx, batch_id, "poll", 1, [op], None, _cmd("notion poll-plan"))
        _write_batch(ctx, doc, ledger, local, {})
        poll["last_poll_utc"] = _fmt(ctx.now)
        jsonio.write_json_atomic(_file(layout, "poll.json"), poll)
        _save_ledger(layout, ledger)
        state.save(ctx, local)
        events.append(ctx, "notion.poll", {"batch_id": batch_id, "stage": 1, "awaiting": len(awaiting)})
        return doc


def _poll_urgent(ctx: Ctx, plan: PlanModel, local: Mapping[str, Any], awaiting: Sequence[Mapping[str, Any]]) -> bool:
    """An awaited item on the critical path, a latest start within 60 minutes, or a wave boundary since the last
    poll."""
    schedule_cache = _read(ctx.layout.schedule_cache, None) or {}
    critical = set((schedule_cache or {}).get("critical_path") or [])
    for item in awaiting:
        if str(item.get("ref")) in critical:
            return True
        latest = _utc(item.get("latest_utc"))
        if latest is not None and clock.minutes_between(ctx.now, latest) <= 60:
            return True
    poll = _read(_file(ctx.layout, "poll.json"), {}) or {}
    last = _utc(poll.get("last_poll_utc"))
    for wave in local.get("waves") or []:
        finished = _utc((wave or {}).get("finished_utc"))
        if finished is not None and last is not None and finished > last:
            return True
    return False


# --- commands ---------------------------------------------------------------------------------------------------------

def _load_inputs(ctx: Ctx) -> tuple[PlanModel, dict[str, dict], dict]:
    layout = ctx.layout
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    profile = _read(layout.profile, None)
    if not isinstance(profile, dict):
        raise UsageError(f"no profile at {paths.posix(layout.profile)}", hint="run exec.py ingest first")
    check_configured(profile)
    return plan_mod.load(layout), statusio.load_all(layout), profile


def cmd_diff(ctx: Ctx, args: Namespace) -> CommandResult:
    """`exec.py notion diff [--init] [--wave Wnn] [--replay-outbox]`."""
    if args.wave and not re.match(r"^W[0-9]{2,3}$", args.wave):
        raise UsageError(f"not a wave id: {args.wave!r}")
    plan, statuses, profile = _load_inputs(ctx)
    doc = diff(ctx, plan, statuses, profile, init=bool(args.init), wave=args.wave,
               replay_outbox=bool(args.replay_outbox))
    return CommandResult(data={**doc, "count": len(doc["ops"])})


def cmd_ack(ctx: Ctx, args: Namespace) -> CommandResult:
    """`exec.py notion ack --batch ID --op ID (--result-file F | --failed --error-file F | --failed --error-code C)`."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    if not re.match(r"^N-[0-9]{8}T[0-9]{6}Z-[AB]-[0-9]{1,3}$", args.batch or ""):
        raise UsageError(f"not a batch id: {args.batch!r}")
    if not re.match(r"^op-[0-9]{1,3}$", args.op or ""):
        raise UsageError(f"not an op id: {args.op!r}")
    if args.failed:
        if bool(args.error_file) == bool(args.error_code) or args.result_file:
            raise UsageError("--failed takes exactly one of --error-file or --error-code (and no --result-file)")
        if args.error_code and args.error_code not in ("deferred:rate_limited", "crash-unknown"):
            raise UsageError(f"unknown --error-code {args.error_code!r} (deferred:rate_limited | crash-unknown)")
        error = None
        if args.error_file:
            path = Path(args.error_file)
            if not path.exists():
                raise UsageError(f"no error file at {paths.posix(path)}")
            error = path.read_bytes().decode("utf-8", errors="replace")[:300]
        return _ack_result(ctx, args.batch, args.op, None, error, args.retry_after, args.error_code)
    if not args.result_file or args.error_file or args.error_code:
        raise UsageError("pass --result-file, or --failed with --error-file or --error-code")
    path = Path(args.result_file)
    if not path.exists():
        raise UsageError(f"no result file at {paths.posix(path)}")
    raw = path.read_bytes().decode("utf-8", errors="replace")
    return _ack_result(ctx, args.batch, args.op, raw, None, None, None)


def cmd_poll_plan(ctx: Ctx, args: Namespace) -> CommandResult:
    """`exec.py notion poll-plan`: the batch plus `count` and `pending` (true only while an earlier batch is not
    fully acknowledged; exit 0 either way, contract revision 3)."""
    del args
    _plan, _statuses, profile = _load_inputs(ctx)
    doc = poll_plan(ctx, profile)
    return CommandResult(data={**doc, "count": len(doc["ops"]), "pending": doc.get("pending") is True})
