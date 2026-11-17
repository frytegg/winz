#!/usr/bin/env python3
"""
public_apis.py - search the public-apis catalogue offline, and refresh the snapshot.

The catalogue is https://github.com/public-apis/public-apis, a community-curated
README of free APIs. A copy pinned to one commit lives in ../references/apis.md,
with its provenance in ../references/snapshot.json. Searching never touches the
network; only `refresh` does.

Usage
  python public_apis.py search weather forecast          # every term must match
  python public_apis.py search crypto price --no-auth --cors
  python public_apis.py search exchange rates --any      # any term instead of all
  python public_apis.py search --category "Open Data"    # a whole category
  python public_apis.py search sec filings --json
  python public_apis.py categories                       # categories with counts
  python public_apis.py info                             # provenance and age
  python public_apis.py refresh --dry-run                # what would change
  python public_apis.py refresh                          # pull the latest README

Exit codes: 0 ok, 1 search found nothing, 2 error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
SNAPSHOT = SKILL_DIR / "references" / "apis.md"
META = SKILL_DIR / "references" / "snapshot.json"
LICENSE = SKILL_DIR / "LICENSE"

REPO = "public-apis/public-apis"
# The commits feed has no API quota; the REST API (60 an hour unauthenticated) is the fallback.
ATOM = "https://github.com/{repo}/commits/{branch}.atom"
ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}
COMMIT_API = "https://api.github.com/repos/{repo}/commits/{branch}"
RAW = "https://raw.githubusercontent.com/{repo}/{sha}/{path}"
USER_AGENT = "public-apis-skill-refresh"

MCP_SECTION = "MCP Servers"
STALE_AFTER_DAYS = 90
# A refresh that parses fewer entries than this is a format change, not an update.
MIN_ENTRIES = 1000
MIN_CATEGORIES = 40
MAX_SHRINK = 0.20
MAX_UNPARSED_RATIO = 0.02
RETRY_DELAYS = (0, 1, 2, 4, 8)

SHA_RE = re.compile(r"Commit/([0-9a-f]{40})$")
HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$")
# The URL is lazy so links with parentheses in them, like Wikipedia's, survive.
ROW_RE = re.compile(r"^\|\s*\[(?P<name>.+?)\]\((?P<url>\S+?)\s*\)\s*\|(?P<rest>.*)$")
CELL_SPLIT = re.compile(r"(?<!\\)\|")


class CatalogueError(Exception):
    """The snapshot is missing, unreadable, or a refresh would corrupt it."""


@dataclass(frozen=True)
class Entry:
    category: str
    name: str
    url: str
    description: str
    auth: str
    https: str
    cors: str
    transport: str


@dataclass
class Parsed:
    entries: list[Entry]
    unparsed: list[str]

    @property
    def categories(self) -> list[str]:
        return list(dict.fromkeys(e.category for e in self.entries))


def _cell(raw: str) -> str:
    return raw.strip().strip("`").replace("\\|", "|").strip()


def parse(text: str) -> Parsed:
    """Parse the README into entries.

    Only two kinds of section are read: the `### Category` tables after `## Index`,
    and the `## MCP Servers` table. The sponsored tables at the top are skipped, and
    their products appear in the categories anyway.
    """
    entries: list[Entry] = []
    unparsed: list[str] = []
    section: str | None = None
    after_index = False
    for lineno, line in enumerate(text.splitlines(), 1):
        heading = HEADING_RE.match(line)
        if heading:
            level, title = heading.groups()
            if level == "##" and title == "Index":
                after_index, section = True, None
            elif level == "##" and title == MCP_SECTION:
                section = MCP_SECTION
            elif level == "###" and after_index:
                section = title
            else:
                section = None
            continue
        if section is None or not line.startswith("| ["):
            continue
        row = ROW_RE.match(line.strip())
        cells = [_cell(c) for c in CELL_SPLIT.split(row["rest"])] if row else []
        while cells and cells[-1] == "":
            cells.pop()
        if not row or len(cells) < 4:
            unparsed.append(f"{lineno}: {line[:140]}")
            continue
        description = " | ".join(cells[:-3])
        if section == MCP_SECTION:
            auth, transport, _install = cells[-3:]
            https = cors = ""
        else:
            auth, https, cors = cells[-3:]
            transport = ""
        entries.append(Entry(section, row["name"].strip(), row["url"].strip(), description,
                             auth, https, cors, transport))
    return Parsed(entries, unparsed)


def load() -> Parsed:
    if not SNAPSHOT.exists():
        raise CatalogueError(f"no snapshot at {SNAPSHOT}; run `refresh` first")
    return parse(SNAPSHOT.read_text(encoding="utf-8"))


def load_meta() -> dict[str, object]:
    if not META.exists():
        return {}
    return json.loads(META.read_text(encoding="utf-8"))


def snapshot_age_days(meta: dict[str, object]) -> int | None:
    commit_date = meta.get("commit_date")
    if not isinstance(commit_date, str):
        return None
    when = datetime.fromisoformat(commit_date.replace("Z", "+00:00"))
    return (datetime.now(timezone.utc) - when).days


def provenance_line(meta: dict[str, object]) -> str:
    if not meta:
        return "snapshot: provenance unknown (no snapshot.json)"
    age = snapshot_age_days(meta)
    stale = f"  STALE, over {STALE_AFTER_DAYS} days: offer a refresh" if age and age > STALE_AFTER_DAYS else ""
    return (f"snapshot: {REPO}@{str(meta.get('sha', '?'))[:7]}, "
            f"commit of {str(meta.get('commit_date', '?'))[:10]} ({age} days old){stale}")


# --- search -----------------------------------------------------------------

def score(entry: Entry, terms: list[str]) -> int:
    """Two points for a term in the name, one in the description or category."""
    name, rest = entry.name.lower(), f"{entry.description} {entry.category}".lower()
    return sum(2 if t in name else 1 if t in rest else 0 for t in terms)


def matches(entry: Entry, terms: list[str], any_term: bool) -> bool:
    if not terms:
        return True
    hay = f"{entry.name} {entry.description} {entry.category}".lower()
    hits = [t in hay for t in terms]
    return any(hits) if any_term else all(hits)


def resolve_category(wanted: str, categories: list[str]) -> list[str]:
    exact = [c for c in categories if c.lower() == wanted.lower()]
    if exact:
        return exact
    partial = [c for c in categories if wanted.lower() in c.lower()]
    if not partial:
        raise CatalogueError(f"no category matches {wanted!r}. Categories: {', '.join(categories)}")
    return partial


def md_cell(text: str) -> str:
    return text.replace("|", "\\|")


def cmd_search(args: argparse.Namespace) -> int:
    parsed = load()
    terms = [t.lower() for t in args.terms]
    if not terms and not args.category:
        raise CatalogueError("give search terms, a --category, or both")
    wanted = set(resolve_category(args.category, parsed.categories)) if args.category else None

    hits = [
        e for e in parsed.entries
        if (wanted is None or e.category in wanted)
        and matches(e, terms, args.any)
        and (not args.no_auth or e.auth.lower() == "no")
        and (not args.auth or e.auth.lower() == args.auth.lower())
        and (not args.https or e.https.lower() == "yes")
        and (not args.cors or e.cors.lower() == "yes")
        and (not args.mcp or e.category == MCP_SECTION)
    ]
    hits.sort(key=lambda e: (-score(e, terms), e.category, e.name.lower()))
    shown = hits[: args.limit] if args.limit > 0 else hits

    if args.json:
        print(json.dumps({"provenance": load_meta(), "total": len(hits),
                          "entries": [asdict(e) for e in shown]}, indent=2, ensure_ascii=False))
        return 0 if hits else 1

    print(provenance_line(load_meta()))
    if not hits:
        print("no match. Try fewer terms, --any, a synonym, or `categories`.")
        return 1
    print(f"{len(hits)} match(es)" + (f", showing {len(shown)}: narrow the query or raise --limit"
                                      if len(shown) < len(hits) else "") + "\n")
    print("| category | name | auth | https | cors | description | url |")
    print("|---|---|---|---|---|---|---|")
    for e in shown:
        https = e.https or f"({e.transport})"
        print(f"| {md_cell(e.category)} | {md_cell(e.name)} | {e.auth} | {https} | {e.cors or '-'} "
              f"| {md_cell(e.description)} | {e.url} |")
    return 0


def cmd_categories(args: argparse.Namespace) -> int:
    parsed = load()
    rows: dict[str, list[Entry]] = {}
    for e in parsed.entries:
        rows.setdefault(e.category, []).append(e)
    if args.json:
        print(json.dumps({c: len(es) for c, es in rows.items()}, indent=2, ensure_ascii=False))
        return 0
    print(provenance_line(load_meta()) + "\n")
    print("| category | entries | no auth | cors yes |")
    print("|---|---:|---:|---:|")
    for category, es in rows.items():
        no_auth = sum(e.auth.lower() == "no" for e in es)
        cors = sum(e.cors.lower() == "yes" for e in es)
        print(f"| {md_cell(category)} | {len(es)} | {no_auth} | {cors} |")
    print(f"\n{len(parsed.entries)} entries in {len(rows)} categories")
    return 0


def cmd_info(_args: argparse.Namespace) -> int:
    parsed = load()
    meta = load_meta()
    print(provenance_line(meta))
    for key in ("sha", "commit_date", "fetched_at", "branch", "entries", "categories", "sha256"):
        print(f"  {key:<12} {meta.get(key, '?')}")
    print(f"  {'parsed now':<12} {len(parsed.entries)} entries, {len(parsed.categories)} categories, "
          f"{len(parsed.unparsed)} unparsed row(s)")
    for line in parsed.unparsed[:10]:
        print(f"    unparsed {line}")
    return 0


# --- refresh ----------------------------------------------------------------

def fetch(url: str, accept: str = "*/*") -> bytes:
    """GET with the retry ladder: network errors, 429 and 5xx retry, anything else fails."""
    last: Exception | None = None
    for attempt, delay in enumerate(RETRY_DELAYS, 1):
        if delay:
            print(f"  retry {attempt}/{len(RETRY_DELAYS)} in {delay}s: {last}", file=sys.stderr)
            time.sleep(delay)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 403 and error.headers.get("X-RateLimit-Remaining") == "0":
                raise CatalogueError("GitHub API rate limit exhausted (60 an hour unauthenticated); "
                                     "try again after it resets") from error
            if error.code != 429 and error.code < 500:
                raise CatalogueError(f"GET {url} failed: HTTP {error.code}") from error
            last = error
        except (urllib.error.URLError, TimeoutError) as error:
            last = error
    raise CatalogueError(f"GET {url} failed after {len(RETRY_DELAYS)} attempts: {last}")


def upstream_head(branch: str) -> tuple[str, str]:
    """Sha and committer date of the branch head: the Atom feed first, the REST API if it fails."""
    try:
        feed = ET.fromstring(fetch(ATOM.format(repo=REPO, branch=branch), accept="application/atom+xml"))
        entry = feed.find("a:entry", ATOM_NS)
        found = SHA_RE.search(entry.findtext("a:id", "", ATOM_NS)) if entry is not None else None
        updated = entry.findtext("a:updated", "", ATOM_NS) if entry is not None else ""
        if found and updated:
            return found.group(1), updated
        print("  commits feed has no usable entry, falling back to the REST API", file=sys.stderr)
    except (CatalogueError, ET.ParseError) as error:
        print(f"  commits feed unusable ({error}), falling back to the REST API", file=sys.stderr)
    commit = json.loads(fetch(COMMIT_API.format(repo=REPO, branch=branch),
                              accept="application/vnd.github+json"))
    return commit["sha"], commit["commit"]["committer"]["date"]


def normalise(raw: bytes) -> str:
    return raw.decode("utf-8").replace("\r\n", "\n")


def validate(new: Parsed, old: Parsed | None) -> list[str]:
    problems = []
    if len(new.entries) < MIN_ENTRIES:
        problems.append(f"only {len(new.entries)} entries parsed (floor {MIN_ENTRIES})")
    if len(new.categories) < MIN_CATEGORIES:
        problems.append(f"only {len(new.categories)} categories parsed (floor {MIN_CATEGORIES})")
    total_rows = len(new.entries) + len(new.unparsed)
    if total_rows and len(new.unparsed) / total_rows > MAX_UNPARSED_RATIO:
        problems.append(f"{len(new.unparsed)} of {total_rows} rows unparsed: the table format changed")
    if old and len(new.entries) < len(old.entries) * (1 - MAX_SHRINK):
        problems.append(f"entries fell from {len(old.entries)} to {len(new.entries)}, "
                        f"more than {MAX_SHRINK:.0%}")
    return problems


def write_all(files: dict[Path, bytes]) -> None:
    """Stage every file first, then swap them in, so a failed write leaves the old set whole."""
    staged = {path: path.with_name(path.name + ".tmp") for path in files}
    try:
        for path, tmp in staged.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp.write_bytes(files[path])
        for path, tmp in staged.items():
            os.replace(tmp, path)
    finally:
        for tmp in staged.values():
            tmp.unlink(missing_ok=True)


def cmd_refresh(args: argparse.Namespace) -> int:
    old = load() if SNAPSHOT.exists() else None
    old_meta = load_meta()

    sha, commit_date = upstream_head(args.branch)
    print(f"upstream {args.branch} is at {sha[:7]}, committed {commit_date}")
    if old_meta.get("sha") == sha and not args.force:
        print("snapshot already at this commit, nothing to do")
        return 0

    text = normalise(fetch(RAW.format(repo=REPO, sha=sha, path="README.md")))
    licence = normalise(fetch(RAW.format(repo=REPO, sha=sha, path="LICENSE")))
    new = parse(text)

    problems = validate(new, old)
    for line in new.unparsed[:10]:
        print(f"  unparsed {line}", file=sys.stderr)
    if problems:
        for problem in problems:
            print(f"REFUSED: {problem}", file=sys.stderr)
        if not args.force:
            print("nothing written. Read the upstream README, update parse(), or pass --force.",
                  file=sys.stderr)
            return 2

    old_keys = {(e.category, e.name, e.url) for e in old.entries} if old else set()
    new_keys = {(e.category, e.name, e.url) for e in new.entries}
    added, removed = sorted(new_keys - old_keys), sorted(old_keys - new_keys)
    print(f"{len(new.entries)} entries in {len(new.categories)} categories "
          f"({len(added)} added, {len(removed)} removed since {str(old_meta.get('sha', 'nothing'))[:7]})")
    for label, keys in (("+", added), ("-", removed)):
        for category, name, _url in keys[:15]:
            print(f"  {label} [{category}] {name}")
        if len(keys) > 15:
            print(f"  {label} ... and {len(keys) - 15} more")

    licence_changed = LICENSE.exists() and normalise(LICENSE.read_bytes()) != licence
    if licence_changed:
        print("LICENCE CHANGED upstream: read the new LICENSE before committing the refresh.",
              file=sys.stderr)

    if args.dry_run:
        print("dry run: nothing written")
        return 0

    meta = {
        "source": f"https://github.com/{REPO}",
        "branch": args.branch,
        "sha": sha,
        "commit_date": commit_date,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "entries": len(new.entries),
        "categories": len(new.categories),
        "unparsed": len(new.unparsed),
        "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }
    write_all({
        SNAPSHOT: text.encode("utf-8"),
        LICENSE: licence.encode("utf-8"),
        META: (json.dumps(meta, indent=2) + "\n").encode("utf-8"),
    })
    print(f"wrote {SNAPSHOT.name}, {LICENSE.name} and {META.name} at {sha[:7]}")
    print(f"commit it: cd ~/.claude && git add skills/public-apis && "
          f"git commit -m \"chore(skills/public-apis): refresh the snapshot to {sha[:7]}\"")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description="Search the public-apis catalogue offline.")
    sub = ap.add_subparsers(dest="command", required=True)

    s = sub.add_parser("search", help="find entries by keyword and filters")
    s.add_argument("terms", nargs="*", help="keywords, matched against name, description and category")
    s.add_argument("--any", action="store_true", help="match any term instead of all of them")
    s.add_argument("--category", help="restrict to a category (exact, else substring)")
    s.add_argument("--no-auth", action="store_true", help="only entries that need no key")
    s.add_argument("--auth", help="only this auth kind: apiKey, OAuth, X-Mashape-Key, User-Agent")
    s.add_argument("--https", action="store_true", help="only entries served over HTTPS")
    s.add_argument("--cors", action="store_true", help="only entries with CORS confirmed (callable from a browser)")
    s.add_argument("--mcp", action="store_true", help="only the MCP servers section")
    s.add_argument("--limit", type=int, default=40, help="rows to show, 0 for all (default 40)")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_search)

    c = sub.add_parser("categories", help="list categories with counts")
    c.add_argument("--json", action="store_true")
    c.set_defaults(func=cmd_categories)

    i = sub.add_parser("info", help="snapshot provenance, age and parse health")
    i.set_defaults(func=cmd_info)

    r = sub.add_parser("refresh", help="replace the snapshot with the latest upstream README")
    r.add_argument("--branch", default="master")
    r.add_argument("--dry-run", action="store_true", help="fetch and compare, write nothing")
    r.add_argument("--force", action="store_true",
                   help="re-fetch at the same commit, and write even if validation refuses")
    r.set_defaults(func=cmd_refresh)
    return ap


def main() -> int:
    # Windows pipes default to cp1252, which cannot print half the catalogue.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = build_parser().parse_args()
    try:
        return args.func(args)
    except CatalogueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
