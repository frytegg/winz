"""Repository-relative POSIX globs: matching, conservative intersection and containment (SCHEMAS.md 7.1-7.3).

Globs split on `/`; `**` matches zero or more segments; other segments are fnmatch patterns (`*`, `?`, `[...]`)
that never cross `/`. Matching is case-sensitive (git paths). `intersects` may answer true for globs that do not
intersect, never false for globs that do; `contains` answers true only when it can prove every path of the inner
glob matches the outer one.
"""
from __future__ import annotations

from fnmatch import fnmatchcase
from functools import lru_cache
from typing import Sequence

_WILD = "*?["

MANIFEST_GLOBS: tuple[str, ...] = (
    "**/package.json", "**/pnpm-lock.yaml", "**/pnpm-workspace.yaml", "**/package-lock.json", "**/yarn.lock",
    "**/Cargo.toml", "**/Cargo.lock", "**/pyproject.toml", "**/requirements*.txt", "**/uv.lock", "**/go.mod",
    "**/go.sum", "**/foundry.toml", "**/aiken.toml", "tsconfig*.json", ".github/workflows/*",
)


def normalize(glob: str) -> str:
    """Strip './', collapse '//' and consecutive '**' segments, drop a trailing '/'."""
    g = glob.strip().replace("\\", "/")
    while g.startswith("./"):
        g = g[2:]
    parts = [p for p in g.split("/") if p not in ("", ".")]
    out: list[str] = []
    for p in parts:
        if p == "**" and out and out[-1] == "**":
            continue
        out.append(p)
    return "/".join(out)


def _segments(glob: str) -> tuple[str, ...]:
    n = normalize(glob)
    return tuple(n.split("/")) if n else ()


def _has_wild(seg: str) -> bool:
    return any(c in seg for c in _WILD)


def matches(glob: str, path: str) -> bool:
    """True when the repository-relative path matches the glob."""
    return _match(_segments(glob), tuple(p for p in path.replace("\\", "/").split("/") if p))


@lru_cache(maxsize=65536)
def _match(g: tuple[str, ...], p: tuple[str, ...]) -> bool:
    if not g:
        return not p
    if g[0] == "**":
        return _match(g[1:], p) or (bool(p) and _match(g, p[1:]))
    if not p:
        return False
    return fnmatchcase(p[0], g[0]) and _match(g[1:], p[1:])


def _literal_prefix(seg: str) -> str:
    for i, c in enumerate(seg):
        if c in _WILD:
            return seg[:i]
    return seg


def _literal_suffix(seg: str) -> str:
    for i in range(len(seg) - 1, -1, -1):
        if seg[i] in _WILD or seg[i] == "]":
            return seg[i + 1:]
    return seg


def _segments_intersect(a: str, b: str) -> bool:
    wa, wb = _has_wild(a), _has_wild(b)
    if not wa and not wb:
        return a == b
    if not wa:
        return fnmatchcase(a, b)
    if not wb:
        return fnmatchcase(b, a)
    pa, pb = _literal_prefix(a), _literal_prefix(b)
    if not (pa.startswith(pb) or pb.startswith(pa)):
        return False
    sa, sb = _literal_suffix(a), _literal_suffix(b)
    if not (sa.endswith(sb) or sb.endswith(sa)):
        return False
    return True


@lru_cache(maxsize=65536)
def _inter(a: tuple[str, ...], b: tuple[str, ...]) -> bool:
    if not a and not b:
        return True
    if not a:
        return all(s == "**" for s in b)
    if not b:
        return all(s == "**" for s in a)
    sa, sb = a[0], b[0]
    if sa == "**" and sb == "**":
        return _inter(a[1:], b) or _inter(a, b[1:])
    if sa == "**":
        # ** matches zero segments, or absorbs one path segment that matches sb.
        return _inter(a[1:], b) or _inter(a, b[1:])
    if sb == "**":
        return _inter(a, b[1:]) or _inter(a[1:], b)
    return _segments_intersect(sa, sb) and _inter(a[1:], b[1:])


def intersects(a: str, b: str) -> bool:
    """Conservative: true when some path may match both globs (never false for a real overlap)."""
    return _inter(_segments(a), _segments(b))


def _seg_contains(outer: str, inner: str) -> bool:
    if outer == inner:
        return True
    if not _has_wild(inner):
        return fnmatchcase(inner, outer)
    if outer == "*":
        return True
    if not _has_wild(outer):
        return False
    # outer = prefix*suffix with a single star and no other wildcard: inner's literal prefix and suffix must carry it.
    if outer.count("*") == 1 and "?" not in outer and "[" not in outer:
        op, osuf = outer.split("*")
        ip, isuf = _literal_prefix(inner), _literal_suffix(inner)
        if ip.startswith(op) and isuf.endswith(osuf) and len(ip) + len(isuf) <= len(inner):
            return True
    return False


@lru_cache(maxsize=65536)
def _cont(o: tuple[str, ...], i: tuple[str, ...]) -> bool:
    if not o:
        return not i
    if o[0] == "**":
        if len(o) == 1:
            return True
        return _cont(o[1:], i) or (bool(i) and _cont(o, i[1:]))
    if not i or i[0] == "**":
        return False
    return _seg_contains(o[0], i[0]) and _cont(o[1:], i[1:])


def contains(outer: str, inner: str) -> bool:
    """Conservative: true only when every path matching `inner` matches `outer`."""
    return _cont(_segments(outer), _segments(inner))


def overlapping(a: Sequence[str], b: Sequence[str]) -> list[tuple[str, str]]:
    """Every (x, y), x from a and y from b, that may intersect, sorted."""
    return sorted({(x, y) for x in a for y in b if intersects(x, y)})


def is_manifest_glob(glob: str) -> bool:
    """True when the glob can match a manifest file of SCHEMAS.md 7.3."""
    return any(intersects(glob, m) for m in MANIFEST_GLOBS)
