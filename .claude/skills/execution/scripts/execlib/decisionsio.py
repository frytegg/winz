"""decisions.md, read side and the single writer of blocks (contract/MODULES.md 4, SCHEMAS.md 8, TWO-DEV.md C11).

The file is append-only and union-merged. Each block opens with `<!-- execution-decision {canonical json} -->` on its
own line, then prose for humans; machines read only headers. Ids are allocated per executor in disjoint ranges (A:
D-001..D-499, B: D-500..D-999) so the two clones never collide. A duplicate proposal (or resolution) for one id with
different content is E_STATE_INVALID; an identical duplicate line (a union-merge echo) is read once.
"""
from __future__ import annotations

import json
import os

from . import jsonio, locks, schema
from .errors import ErrorItem, InternalError, ValidationFailed
from .model import Ctx
from .paths import Layout

HEADER_PREFIX = "<!-- execution-decision "
HEADER_SUFFIX = " -->"
RANGES: dict[str, tuple[int, int]] = {"A": (1, 499), "B": (500, 999)}


def _parse_header(line: str, lineno: int, where: str) -> dict:
    body = line[len(HEADER_PREFIX):]
    if not body.endswith(HEADER_SUFFIX):
        raise ValidationFailed(f"{where}:{lineno}: decision header without its closing ' -->'",
                               code="E_STATE_INVALID")
    try:
        doc = json.loads(body[: -len(HEADER_SUFFIX)])
    except json.JSONDecodeError as err:
        raise ValidationFailed(f"{where}:{lineno}: decision header is not JSON: {err.msg}",
                               code="E_STATE_INVALID") from err
    report = schema.validate(doc, "decision")
    if not report.ok:
        items = [ErrorItem("E_STATE_INVALID", i.message, path=f"{where}:{lineno}") for i in report.issues[:10]]
        raise ValidationFailed(f"{where}:{lineno}: decision header is invalid: {report.issues[0].message}",
                               code="E_STATE_INVALID", items=items)
    return doc


def read_blocks(layout: Layout) -> list[dict]:
    """Every block header in file order (validated); identical duplicates read once."""
    path = layout.decisions
    if not path.exists():
        return []
    where = path.as_posix()
    text = path.read_bytes().decode("utf-8")
    seen_lines: set[str] = set()
    by_key: dict[tuple[str, str], dict] = {}
    out: list[dict] = []
    for lineno, line in enumerate(text.split("\n"), start=1):
        line = line.rstrip("\r")
        if not line.startswith(HEADER_PREFIX):
            continue
        if line in seen_lines:
            continue
        seen_lines.add(line)
        doc = _parse_header(line, lineno, where)
        record = doc["record"]
        if record in ("proposal", "resolution"):
            key = (doc["id"], record)
            if key in by_key:
                raise ValidationFailed(f"{where}:{lineno}: a second {record} for {doc['id']}",
                                       code="E_STATE_INVALID")
            by_key[key] = doc
        out.append(doc)
    return out


def find(layout: Layout, decision_id: str) -> tuple[dict | None, dict | None]:
    """(proposal, resolution) of one decision id."""
    proposal = resolution = None
    for doc in read_blocks(layout):
        if doc["id"] != decision_id:
            continue
        if doc["record"] == "proposal":
            proposal = doc
        elif doc["record"] == "resolution":
            resolution = doc
    return proposal, resolution


def open_proposals(layout: Layout) -> list[dict]:
    """Proposals without a resolution, by id."""
    blocks = read_blocks(layout)
    resolved = {d["id"] for d in blocks if d["record"] == "resolution"}
    props = [d for d in blocks if d["record"] == "proposal" and d["id"] not in resolved]
    return sorted(props, key=lambda d: int(d["id"][2:]))


def next_id(layout: Layout, executor: str) -> str:
    """The next free id of this executor's range (A: D-001..D-499, B: D-500..D-999)."""
    if executor not in RANGES:
        raise InternalError(f"unknown executor {executor!r}")
    lo, hi = RANGES[executor]
    used = [int(d["id"][2:]) for d in read_blocks(layout)]
    mine = [n for n in used if lo <= n <= hi]
    nxt = (max(mine) + 1) if mine else lo
    if nxt > hi:
        raise InternalError(f"decision ids of executor {executor} exhausted (D-{hi:03d})")
    return f"D-{nxt:03d}"


def _safe_prose(prose: str) -> str:
    text = (prose or "").replace("\r\n", "\n").replace("\r", "\n")
    return text.replace("<!--", "&lt;!--")


def append_block(ctx: Ctx, header: dict, prose: str) -> None:
    """Append one block (state lock held): the validated header line, a blank line, the prose."""
    if not locks.is_held("state"):
        raise InternalError("decisionsio.append_block requires the state lock")
    report = schema.validate(header, "decision")
    if not report.ok:
        items = [ErrorItem("E_SCHEMA", i.message, path=i.instance_path or "/") for i in report.issues[:10]]
        raise ValidationFailed(f"decision header is invalid: {report.issues[0].message}", code="E_SCHEMA",
                               items=items)
    line = HEADER_PREFIX + jsonio.canonical_bytes(header).decode("utf-8") + HEADER_SUFFIX
    if "\n" in line or "\r" in line:
        raise InternalError("a decision header must be one line")
    path = ctx.layout.decisions
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_bytes() if path.exists() else b""
    lead = b"" if not existing else (b"\n" if existing.endswith(b"\n") else b"\n\n")
    body = _safe_prose(prose).strip("\n")
    chunk = lead + line.encode("utf-8") + b"\n"
    if body:
        chunk += b"\n" + body.encode("utf-8") + b"\n"
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_BINARY", 0)
    fd = os.open(path, flags, 0o644)
    try:
        view = memoryview(chunk)
        while view:
            view = view[os.write(fd, view):]
        os.fsync(fd)
    finally:
        os.close(fd)
