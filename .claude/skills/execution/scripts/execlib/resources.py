"""Unary resources of tasks (SCHEMAS.md P-10 and 7.4, common.schema.json#/$defs/resource).

Ordered resources (manifest, wallet:*, db:*) may never be shared by two tasks that are not joined by a dependency
path (P-10). Serialized resources (browser, disk-heavy, port:*, human:*) may be shared; the dispatcher never runs two
holders at once.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

from .errors import ErrorItem, ValidationFailed

ORDERED: frozenset[str] = frozenset({"manifest", "wallet", "db"})
SERIALIZED: frozenset[str] = frozenset({"browser", "disk-heavy", "port", "human"})
_RES_RE = re.compile(r"^(manifest|browser|disk-heavy|wallet:[a-z0-9][a-z0-9-]{0,30}|port:[0-9]{2,5}|"
                     r"db:[a-z0-9][a-z0-9-]{0,30}|human:(devA|devB))$")


@dataclass(frozen=True)
class Resource:
    kind: str
    name: str | None


def parse(resource: str) -> Resource:
    """'wallet:hot' -> Resource('wallet', 'hot'); 'manifest' -> Resource('manifest', None)."""
    if not isinstance(resource, str) or not _RES_RE.match(resource):
        msg = f"invalid resource {resource!r}"
        raise ValidationFailed(msg, code="E_SCHEMA", items=[ErrorItem("E_SCHEMA", msg)])
    kind, sep, name = resource.partition(":")
    return Resource(kind, name if sep else None)


def _shared(a: Sequence[str], b: Sequence[str], kinds: frozenset[str]) -> list[str]:
    common = set(a) & set(b)
    return sorted(r for r in common if parse(r).kind in kinds)


def ordered_conflicts(a: Sequence[str], b: Sequence[str]) -> list[str]:
    """Ordered resources held by both sides (sorted)."""
    return _shared(a, b, ORDERED)


def serialized_conflicts(a: Sequence[str], b: Sequence[str]) -> list[str]:
    """Serialized resources held by both sides (sorted)."""
    return _shared(a, b, SERIALIZED)
