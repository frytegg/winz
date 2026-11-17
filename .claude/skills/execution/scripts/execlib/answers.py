"""Human answers: verified files that unblock tasks (contract/MODULES.md 5 `answers.py`, CLI.md `answers ingest`,
SCHEMAS.md 1.1 and 8, README.md 8 "Proven-public values", TWO-DEV.md 6, NOTION.md 10, FRONTEND.md 6.4).

An answer arrives only through a file (`--text-file`, written by the orchestrator with the Write tool) or a stored
Notion fetch result (`--from-notion`); it is never typed into a shell line (CLI.md 0.7). Its value must match its
kind's strict pattern before any verifier runs; readers get the value as an argv element (shell none).

A transaction hash and a private key share one shape (`0x` + 64 hex), so the format alone never clears a value
(owner decision of 2026-10-02, README.md 8). A tx hash that the chain re-read confirmed is first registered in the
state repo's `public-values.jsonl` (`integrity.register_public_value`, proven `chain-reread`), then stored verbatim
as the header's `value`, so a tx proof reads it from the tracked answer. The text then passes the secret scan with
the registered values (`integrity.scan_secrets_text`, `public`): a hit is redacted with `log.redact` in
`answers/<key>.md` (tracked, immutable), the raw text is kept only under `local/answers-raw/<key>.txt`
(W_SECRET_REDACTED), and an unproven secret-shaped value is stored with `value: null`. A verified answer completes a
running manual task when every `bring_back` key is verified (and its file proof holds); `--scope-change` and
`--relay` store the text and unblock nothing.
"""
from __future__ import annotations

import json
import re
import shlex
import urllib.error
import urllib.request
from argparse import Namespace
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping

from . import clock, decisions, events, integrity, jsonio, plan as planmod, procutil, status, statusio
from .errors import ErrorItem, GitError, ImmutableFile, PolicyRefused, UsageError, ValidationFailed, warn
from .log import redact, redaction_ids
from .model import CommandResult, Ctx, PlanModel, Task
from .paths import Layout, posix

STRICT: Mapping[str, re.Pattern[str]] = {
    "tx-hash": re.compile(r"^(0x)?[0-9a-fA-F]{64}$"),
    "sha": re.compile(r"^[0-9a-f]{40}$"),
    "choice": re.compile(r"^[a-z0-9][a-z0-9-]{0,30}$"),
    "url": re.compile(r"^https?://\S+$"),
}
VALUE_KINDS = frozenset(STRICT)
KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
READER_TIMEOUT_S = 120.0
URL_TIMEOUT_S = 20.0


# --- proven-public values and the secret scan of free text (README.md 8; CLI.md `answers ingest`) --------------------

# Kind of a registered hash in public-values.jsonl (SCHEMAS.md 1.1): an EVM hash has the `0x` prefix.
EVM_TX_KIND = "evm-tx-hash"
TX_KIND = "tx-hash"
# A shape the secret scan flags but log.redact does not mask: the whole text is replaced (fail closed).
UNMASKED_ID = "integrity-secret"
# Brackets the index of a registered value while log.redact runs (a private-use character, never typed).
_KEEP = chr(0xE000)
_KEPT_RE = re.compile(_KEEP + r"([0-9]+)" + _KEEP)


def public_values(layout: Layout) -> frozenset[str]:
    """The values proven public on chain: the state repo's `public-values.jsonl`, lower-cased (README.md 8)."""
    return integrity.load_public_values(layout)


def flagged(text: str, *, where: str, public: frozenset[str]) -> bool:
    """True when the secret scan finds a secret shape in `text` that is neither a registered value nor inside an
    explorer link (integrity.scan_secrets_text with `public`, README.md 8). Anything but `ok` counts as a hit."""
    return integrity.scan_secrets_text(text, where=where, public=public).state != "ok"


def _registered_rx(public: frozenset[str]) -> re.Pattern[str] | None:
    """Whole tokens equal to a registered transaction hash, any letter case (the registry is lower-cased). Only
    values of the tx-hash shape count: a hand-edited line holding anything else never shields text."""
    hashes = sorted({v for v in public if STRICT["tx-hash"].match(v)}, key=lambda v: (-len(v), v))
    if not hashes:
        return None
    alternatives = "|".join(re.escape(v) for v in hashes)
    return re.compile(r"(?<![0-9A-Za-z])(?:" + alternatives + r")(?![0-9A-Za-z])", re.IGNORECASE)


def redact_keeping(text: str, public: frozenset[str]) -> str:
    """log.redact on `text`, except the registered values, kept verbatim. A registered value that a redaction
    pattern swallows with its surroundings stays redacted (the safe side)."""
    rx = _registered_rx(public)
    if rx is None or _KEEP in text:
        return redact(text)
    kept: list[str] = []

    def hide(m: re.Match[str]) -> str:
        kept.append(m.group(0))
        return f"{_KEEP}{len(kept) - 1}{_KEEP}"

    out = redact(rx.sub(hide, text))
    return _KEPT_RE.sub(lambda m: kept[int(m.group(1))], out).replace(_KEEP, "")


def hygiene(text: str, *, where: str, public: frozenset[str]) -> tuple[str, list[str]]:
    """CLI.md `answers ingest` "Text hygiene": (the text to store, the pattern ids of its hits). A text the secret
    scan (with the registered values) passes is kept as is. Otherwise every secret shape in it is replaced by
    `[redacted:<pattern id>]` (log.redact), the registered values kept verbatim; a text the scan still flags after
    that is replaced whole. Never returns the matched text."""
    if not flagged(text, where=where, public=public):
        return text, []
    rx = _registered_rx(public)
    ids = set(redaction_ids(rx.sub(" ", text) if rx is not None else text))
    stored = redact_keeping(text, public)
    if not ids or flagged(stored, where=where, public=public):
        ids.add(UNMASKED_ID)
        stored = f"[redacted:{UNMASKED_ID}]\n"
    return stored, sorted(ids)


def register_proven(ctx: Ctx, value: str, reread: Mapping[str, str], key: str) -> bool:
    """README.md 8: a tx hash the chain re-read confirmed is listed in public-values.jsonl BEFORE the answer that
    holds it is written (state lock held). True when appended, False when already listed."""
    kind = EVM_TX_KIND if value[:2].lower() == "0x" else TX_KIND
    return integrity.register_public_value(ctx.layout, value=value, kind=kind, chain=reread["chain"],
                                           network=reread["network"], proven="chain-reread",
                                           source=f"answers/{key}.md")


# --- verification -------------------------------------------------------------------------------------------------

def _result(method: str, ok: bool, detail: str, now: datetime, *, command: str | None = None,
            exit_code: int | None = None) -> dict:
    return {"method": method, "ok": ok, "detail": detail, "at_utc": clock.format_utc(now), "command": command,
            "exit_code": exit_code}


def _parse_block_time(value: Any) -> datetime | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return clock.from_epoch(value)
    if isinstance(value, str):
        text = value.strip()
        if re.match(r"^[0-9]+(\.[0-9]+)?$", text):
            return clock.from_epoch(float(text))
        try:
            return clock.parse_utc(text)
        except Exception:  # noqa: BLE001 - an unparsable block_time fails the verification below
            return None
    return None


def _chain_reread(bring_back: Mapping[str, Any], value: str, task: Task | None, posted_at: str | None,
                  cwd: Path, now: datetime) -> tuple[dict, dict[str, str] | None]:
    """(verification, {chain, network} the reader confirmed the transaction on, or None when it did not)."""
    verify = bring_back.get("verify") or {}
    spec = str(verify.get("spec") or "").strip()
    if not spec:
        return _result("chain-reread", False, "no reader command in verify.spec", now), None
    argv = shlex.split(spec, posix=True) + [value]
    res = procutil.run(argv, cwd=cwd, timeout_s=READER_TIMEOUT_S, shell="none")
    shown = " ".join(argv[:-1]) + " <value>"
    if res.timed_out or res.exit_code != 0:
        return _result("chain-reread", False, f"reader exit {res.exit_code}{' (timeout)' if res.timed_out else ''}",
                       now, command=shown, exit_code=res.exit_code), None
    try:
        doc = json.loads(res.stdout.strip())
    except json.JSONDecodeError:
        return _result("chain-reread", False, "the reader did not print one JSON object", now, command=shown,
                       exit_code=0), None
    if not isinstance(doc, dict):
        return _result("chain-reread", False, "the reader's output is not a JSON object", now, command=shown,
                       exit_code=0), None
    problems: list[str] = []
    proof_spec = ((task.proof if task else {}) or {}).get("spec") or {}
    expect = dict(verify.get("expect") or {})
    for field in ("chain", "network"):
        want = proof_spec.get(field) if proof_spec.get(field) is not None else expect.get(field)
        if not isinstance(doc.get(field), str) or not doc.get(field):
            problems.append(f"the reader's JSON has no {field}")  # CLI.md: {chain, network, from, to, value, ...}
        elif want is not None and doc.get(field) != want:
            problems.append(f"{field} is {doc.get(field)!r}, expected {want!r}")
    for field in ("from", "to", "value"):
        want = expect.get(field)
        if want is not None and str(doc.get(field)) != str(want):
            problems.append(f"{field} differs from verify.expect.{field}")
    block = _parse_block_time(doc.get("block_time"))
    if block is None:
        problems.append("no readable block_time")
    elif posted_at and block < clock.parse_utc(posted_at):
        problems.append("block_time is before the task was posted (an older transaction)")
    if problems:
        return _result("chain-reread", False, "; ".join(problems), now, command=shown, exit_code=0), None
    chain, network = str(doc["chain"]), str(doc["network"])
    return (_result("chain-reread", True, f"re-read on {chain}/{network}", now, command=shown, exit_code=0),
            {"chain": chain, "network": network})


def _options_of(task: Task | None) -> list[str]:
    if task is None:
        return []
    ids = [str(o["id"]) for o in (task.manual or {}).get("options") or ()]
    source = (task.manual or {}).get("options_source")
    if not ids and source and Path(str(source)).is_dir():
        ids = sorted(p.name.lower() for p in Path(str(source)).iterdir() if p.is_dir() and p.name.lower() != "generic")
    return ids


def verify(bring_back: Mapping[str, Any], value: str | None, attachments: list[str], ctx: Ctx, *,
           text: str = "", task: Task | None = None, posted_at: str | None = None) -> dict:
    """Verify one answer by `bring_back.verify.method` (CLI.md `answers ingest`). The value of a tx-hash, sha,
    choice or url kind must match its strict pattern first; nothing runs otherwise."""
    return verify_proven(bring_back, value, attachments, ctx, text=text, task=task, posted_at=posted_at)[0]


def verify_proven(bring_back: Mapping[str, Any], value: str | None, attachments: list[str], ctx: Ctx, *,
                  text: str = "", task: Task | None = None, posted_at: str | None = None
                  ) -> tuple[dict, dict[str, str] | None]:
    """`verify`, plus the chain proof that makes a tx-hash value public (README.md 8): {chain, network} when a
    chain re-read confirmed the transaction, else None."""
    kind = str(bring_back.get("kind"))
    method = str((bring_back.get("verify") or {}).get("method"))
    now = ctx.now
    if kind in VALUE_KINDS and (value is None or not STRICT[kind].match(value)):
        return _result(method, False, f"the value does not match the strict {kind} pattern; nothing was run",
                       now), None
    if method == "chain-reread":
        if kind != "tx-hash":
            return _result(method, False, "chain-reread verifies tx-hash answers only", now), None
        cwd = ctx.layout.repo or ctx.layout.state
        return _chain_reread(bring_back, str(value), task, posted_at, Path(cwd), now)
    return _verify_other(bring_back, kind, method, value, attachments, ctx, text=text, task=task), None


def _verify_other(bring_back: Mapping[str, Any], kind: str, method: str, value: str | None, attachments: list[str],
                  ctx: Ctx, *, text: str, task: Task | None) -> dict:
    """Every method but chain-reread (none of them proves a value public)."""
    now = ctx.now
    if method == "file-exists":
        files = [Path(a) for a in attachments] or ([Path(value)] if value else [])
        missing = [posix(f) for f in files if not f.is_file() or f.stat().st_size == 0]
        if not files or missing:
            return _result(method, False, "missing or empty: " + (", ".join(missing) or "no file given"), now)
        return _result(method, True, f"{len(files)} file(s) present", now)
    if method == "choice-in-options":
        options = _options_of(task)
        candidate = value if value is not None else text.strip().lower()
        ok = candidate in options
        return _result(method, ok, f"{candidate!r} {'is' if ok else 'is not'} an option ({', '.join(options)})", now)
    if method == "regex":
        pattern = str((bring_back.get("verify") or {}).get("spec") or "")
        subject = value if value is not None else text
        try:
            ok = bool(re.search(pattern, subject))
        except re.error as err:
            return _result(method, False, f"verify.spec is not a valid regex: {err}", now)
        return _result(method, ok, "format checked" if ok else "the answer does not match the expected format", now)
    if method == "sha-on-origin-main":
        if kind != "sha":
            return _result(method, False, "sha-on-origin-main verifies sha answers only", now)
        git = status.product_git(ctx.layout)
        if git is None:
            return _result(method, False, "no product repository", now)
        try:
            git.fetch()
        except GitError as err:
            return _result(method, False, f"git fetch failed: {err.message}", now)
        ok, why = status.on_origin_main(git, str(value))
        return _result(method, ok, why or f"{str(value)[:8]} is on origin/main", now)
    if method == "url-resolves":
        target = value if value is not None else text.strip()
        if not STRICT["url"].match(target or ""):
            return _result(method, False, "not an http(s) URL", now)
        try:
            with urllib.request.urlopen(urllib.request.Request(target, method="GET"),
                                        timeout=URL_TIMEOUT_S) as resp:  # noqa: S310 - http(s) only, checked above
                code = int(resp.status)
        except urllib.error.HTTPError as err:
            code = int(err.code)
        except (urllib.error.URLError, OSError) as err:
            return _result(method, False, f"no answer from the URL: {type(err).__name__}", now)
        ok = 200 <= code < 400
        return _result(method, ok, f"HTTP {code}", now, exit_code=None)
    if method == "owner-attest":
        if kind not in ("text", "transcript"):
            return _result(method, False, "owner-attest is allowed only for text and transcript answers", now)
        ok = bool(text.strip())
        return _result(method, ok, "the owner's own words" if ok else "empty answer", now)
    return _result(method if method in ("chain-reread", "file-exists", "choice-in-options", "regex",
                                        "sha-on-origin-main", "url-resolves", "owner-attest") else "regex",
                   False, f"unknown verification method {method!r}", now)


# --- answer files -------------------------------------------------------------------------------------------------

def render_answer(header: Mapping[str, Any], body: str) -> str:
    text = "```json\n" + json.dumps(header, sort_keys=True, indent=2, ensure_ascii=False) + "\n```\n\n" + body
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text if text.endswith("\n") else text + "\n"


def parse_answer(path: Path) -> tuple[dict, str]:
    return status.read_answer(path)


def write_answer(ctx: Ctx, header: dict, body: str) -> Path:
    """answers/<key>.md, immutable: identical bytes are a no-op, other bytes E_ANSWER_IMMUTABLE (exit 4).

    Text hygiene (CLI.md `answers ingest`, README.md 8): the body and the header's `value` pass the secret scan with
    the registered values (public-values.jsonl). A registered value (a tx hash the chain proved, listed by
    `register_proven` before this call) and a value with no secret shape (a sha, a bare 64-hex hash, a URL) stay
    verbatim and alone raise no W_SECRET_REDACTED. A hit is redacted in the tracked body ([redacted:<id>]), the raw
    text is kept only under local/answers-raw/<key>.txt and W_SECRET_REDACTED is emitted; an unproven secret-shaped
    `value` is stored as null."""
    header = dict(header)
    key = str(header["key"])
    where = f"answers/{key}.md"
    public = public_values(ctx.layout)
    stored_body, hits = hygiene(body, where=where, public=public)
    found = set(hits)
    value = header.get("value")
    if isinstance(value, str) and flagged(value, where=where, public=public):
        header["value"] = None  # an unproven secret-shaped value never reaches the tracked file
        found |= set(redaction_ids(value)) or {UNMASKED_ID}
    if found:
        raw = ctx.layout.local / "answers-raw" / f"{key}.txt"
        jsonio.write_text_atomic(raw, body.replace("\r\n", "\n").replace("\r", "\n"))
        warn(ErrorItem("W_SECRET_REDACTED", f"answer {key}: secret shapes redacted ({', '.join(sorted(found))})",
                       path=where))
    status.check_answer_header(header)
    path = ctx.layout.answer(str(header["key"]))
    text = render_answer(header, stored_body)
    if path.exists():
        if path.read_bytes() == text.encode("utf-8"):
            return path
        raise ImmutableFile(f"answers/{header['key']}.md already exists with other content",
                            code="E_ANSWER_IMMUTABLE", hint="a corrected answer is a new key (<key>-2)")
    jsonio.write_text_atomic(path, text)
    return path


# --- ingest -------------------------------------------------------------------------------------------------------

def _bring_back_for(task: Task, key: str) -> dict | None:
    for bb in (task.manual or {}).get("bring_back") or ():
        if key == bb["key"] or re.match(re.escape(bb["key"]) + r"-[2-9][0-9]*$", key):
            return dict(bb)
    return None


def _next_free_key(ctx: Ctx, base: str) -> str:
    if not ctx.layout.answer(base).exists():
        return base
    n = 2
    while ctx.layout.answer(f"{base}-{n}").exists():
        n += 1
    return f"{base}-{n}"


def _extract_value(kind: str, text: str) -> str | None:
    if kind not in VALUE_KINDS:
        return None
    return text.strip()


def _rejected_store(ctx: Ctx) -> Path:
    return ctx.layout.local / "notion" / "rejected.json"


def _fe21_choice(ctx: Ctx, task: Task, key: str, ok: bool, text: str, by: str, source: str) -> dict | None:
    if task.template != "frontend:FE-21":
        return None
    base = {"answered_at": clock.format_utc(ctx.now), "by": by, "channel": source,
            "source": f".execution/answers/{key}.md"}
    if ok:
        value = {"signed_off": True, "changes": [], **base}
    else:
        lines = [re.sub(r"^\s*(?:[0-9]+[.)]|[-*])\s*", "", ln).strip() for ln in text.splitlines()[1:]]
        changes = [ln for ln in lines if ln] or [text.strip() or "refus sans détail"]
        value = {"signed_off": False, "changes": changes, **base}
    return {"path": posix(ctx.layout.state / "frontend" / "choices.json"), "key": "H3", "value": value}


def ingest(ctx: Ctx, args: Namespace) -> CommandResult:
    """The body of `answers ingest` (state lock held by the caller)."""
    if args.by not in ("devA", "devB"):
        raise UsageError("--by devA|devB is required")
    plan: PlanModel = planmod.load(ctx.layout)
    task: Task | None = None
    if args.task:
        task = plan.by_id.get(args.task)
        if task is None:
            raise UsageError(f"unknown task {args.task}")
    elif not args.decision:
        raise UsageError("give --task T or --decision D-nnn")
    notion_hash: str | None = None
    if args.from_notion:
        ref = args.task or args.decision
        fields = decisions.notion_fields(Path(args.from_notion), str(ref))
        text = fields["answer"]
        source = "notion"
        notion_hash = jsonio.sha256_bytes((fields["answer"] + "\n" + fields["decision"]).encode("utf-8"))
        rejected = jsonio.read_json(_rejected_store(ctx)) if _rejected_store(ctx).exists() else {}
        if isinstance(rejected, dict) and rejected.get(str(ref)) == notion_hash:
            raise ValidationFailed(f"the Notion answer of {ref} is the one already rejected", code="E_ANSWER_UNCHANGED",
                                   hint="wait for the owner to correct « Réponse »")
        key = args.key
        if key is None and task is not None:
            verified = {h.get("bring_back_key") for _p, h in status.answers_of(ctx.layout, task.id)
                        if h["verification"]["ok"]}
            pending = [bb["key"] for bb in (task.manual or {}).get("bring_back") or () if bb["key"] not in verified]
            if not pending:
                raise UsageError(f"{task.id}: every bring_back key is already verified")
            key = _next_free_key(ctx, pending[0])
        elif key is None:
            key = _next_free_key(ctx, f"{args.decision}-answer")
    else:
        if not args.key or not args.text_file:
            raise UsageError("give --from-notion RESULT_FILE, or --key K --text-file F --source S")
        p = Path(args.text_file)
        if not p.is_file():
            raise UsageError(f"--text-file {posix(p)} does not exist")
        text = p.read_bytes().decode("utf-8-sig").replace("\r\n", "\n")
        source = args.source or "terminal"
        key = str(args.key)
    if not KEY_RE.match(key):
        raise UsageError(f"--key {key!r} is not an answer key")
    attachments = [posix(Path(a).resolve()) for a in args.attachments]
    now = clock.format_utc(ctx.now)
    # -- relay: stored under <key>-relay-<executor>, nothing unblocked, no proposal (TWO-DEV.md 6)
    if args.relay:
        rkey = f"{key}-relay-{ctx.executor}"
        bb = _bring_back_for(task, key) if task else None
        header = {"schema": "execution.answer/1", "key": rkey, "task": task.id if task else None,
                  "decision": args.decision, "bring_back_key": key, "kind": (bb or {}).get("kind", "text"),
                  "source": source, "received_utc": now, "by": args.by, "value": None, "attachments": attachments,
                  "verification": _result("owner-attest", False, "relayed: the owning orchestrator confirms it",
                                          ctx.now)}
        path = write_answer(ctx, header, text)
        events.append(ctx, "answer.relayed", {"key": rkey, "task": header["task"], "decision": args.decision})
        return CommandResult(data={"answer_path": ctx.layout.rel(path), "verification": header["verification"],
                                   "task_status": None, "unblocked": [], "proposal": None, "frontend_choice": None})
    if task is None:
        # a free-text answer attached to a decision: stored, unblocks nothing (the decision resolves through
        # `decision resolve`)
        header = {"schema": "execution.answer/1", "key": key, "task": None, "decision": args.decision,
                  "bring_back_key": key, "kind": "text", "source": source, "received_utc": now, "by": args.by,
                  "value": None, "attachments": attachments,
                  "verification": verify({"kind": "text", "verify": {"method": "owner-attest"}}, None, attachments,
                                         ctx, text=text)}
        proposal = None
        if args.scope_change:
            header["scope_change"] = True
        path = write_answer(ctx, header, text)
        if args.scope_change:
            proposal, _d = decisions.propose(ctx, kind="scope-change", title=f"Réponse hors périmètre : {key}",
                                             options=decisions.default_options("scope-change"), tasks=[],
                                             deadline=None, recommended=None)
        events.append(ctx, "answer.ingested", {"key": key, "decision": args.decision, "ok": True})
        return CommandResult(data={"answer_path": ctx.layout.rel(path), "verification": header["verification"],
                                   "task_status": None, "unblocked": [], "proposal": proposal,
                                   "frontend_choice": None})
    bb = _bring_back_for(task, key)
    if bb is None:
        raise UsageError(f"{key} is not a bring_back key of {task.id}",
                         hint="keys: " + ", ".join(b["key"] for b in (task.manual or {}).get("bring_back") or ()))
    if task.executor != ctx.executor:
        raise PolicyRefused(f"{task.id} belongs to orchestrator {task.executor}", code="E_POLICY",
                            hint="store it with --relay; the owning orchestrator confirms it (TWO-DEV.md 6)")
    doc = statusio.load(ctx.layout, str(ctx.executor))
    entry = status.entry_of(doc, task.id) or {}
    posted_at = (entry.get("posted") or {}).get("at_utc")
    value = _extract_value(str(bb["kind"]), text)
    verification, reread = verify_proven(bb, value, attachments, ctx, text=text, task=task, posted_at=posted_at)
    if reread is not None and value is not None:
        # README.md 8: the chain proved the hash names an existing transaction; it is listed before the answer that
        # holds it is written, so write_answer stores it verbatim (a tx proof reads it from the tracked header)
        register_proven(ctx, value, reread, key)
    header = {"schema": "execution.answer/1", "key": key, "task": task.id, "decision": None,
              "bring_back_key": bb["key"], "kind": bb["kind"], "source": source, "received_utc": now,
              "by": args.by, "value": value if verification["ok"] or value is None or
              (bb["kind"] in VALUE_KINDS and STRICT[bb["kind"]].match(value or "")) else None,
              "attachments": attachments, "verification": verification}
    if args.scope_change:
        header["scope_change"] = True
    path = write_answer(ctx, header, text)
    rel = ctx.layout.rel(path)
    unblocked: list[str] = []
    proposal: str | None = None
    fe_choice = None
    if args.scope_change:
        proposal, _d = decisions.propose(ctx, kind="scope-change", title=f"Réponse hors périmètre : {key}",
                                         options=decisions.default_options("scope-change"), tasks=[task.id],
                                         deadline=None, recommended=None)
        events.append(ctx, "answer.ingested", {"key": key, "task": task.id, "ok": verification["ok"],
                                               "scope_change": True})
    else:
        current = status.current_status(doc, task.id)
        if verification["ok"]:
            if current == "running" and task.kind == "manual":
                remaining = [b["key"] for b in (task.manual or {}).get("bring_back") or ()
                             if not any(h.get("bring_back_key") == b["key"] and h["verification"]["ok"]
                                        for _p, h in status.answers_of(ctx.layout, task.id))]
                fp_ok, _details = status.file_proof_status(task)
                if not remaining and fp_ok:
                    status.transition(ctx, doc, task, "done", evidence=[rel], plan=plan)
                    unblocked.append(task.id)
            elif current == "blocked-manual":
                status.transition(ctx, doc, task, "ready", evidence=[rel], plan=plan)
                unblocked.append(task.id)
            events.append(ctx, "answer.ingested", {"key": key, "task": task.id, "ok": True})
        else:
            if current == "running" and task.kind == "manual":
                status.transition(ctx, doc, task, "running", evidence=[rel], plan=plan,
                                  reason=f"answer {key} rejected: {verification['detail']}"[:300])
            events.append(ctx, "answer.rejected", {"key": key, "task": task.id, "detail": verification["detail"]})
            if notion_hash is not None:
                store = _rejected_store(ctx)
                rejected = jsonio.read_json(store) if store.exists() else {}
                rejected = rejected if isinstance(rejected, dict) else {}
                rejected[task.id] = notion_hash
                jsonio.write_json_atomic(store, rejected)
        statusio.save(ctx, doc)
        fe_choice = _fe21_choice(ctx, task, key, bool(verification["ok"]), text, args.by, source)
        if fe_choice is not None and not verification["ok"]:
            proposal, _d = decisions.propose(
                ctx, kind="amendment", title=f"{task.id} : retouches demandées avant l'enregistrement",
                options=[{"id": "fix", "label": "Ajouter les corrections", "consequence":
                          "des tâches de correction et une nouvelle validation", "effects": [{"op": "amend"}]},
                         {"id": "keep", "label": "Garder tel quel", "consequence": "rien ne change",
                          "effects": [{"op": "none"}]}],
                tasks=[task.id], deadline=None, recommended="fix")
    if task.id in unblocked:
        decisions.drop_awaiting(ctx, task.id)
    if source == "notion":
        decisions.queue_notion(ctx, task.id, {"Ingérée": "__YES__"})
    new_status = status.current_status(statusio.load(ctx.layout, str(ctx.executor)), task.id)
    data = {"answer_path": rel, "verification": verification, "task_status": new_status, "unblocked": unblocked,
            "proposal": proposal, "frontend_choice": fe_choice}
    if verification["ok"] or args.scope_change:
        return CommandResult(data=data)
    return CommandResult(data=data, exit_code=1,
                         errors=[ErrorItem("E_CHECK", f"answer {key} failed its verification: "
                                           f"{verification['detail']}", task=task.id)])


def cmd_ingest(ctx: Ctx, args: Namespace) -> CommandResult:
    """`answers ingest` (CLI.md)."""
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    with status.state_lock(ctx):
        return ingest(ctx, args)

