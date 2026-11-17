"""Integrity scanners with positive controls (contract/MODULES.md 4, CLI.md `merge` step 3, TESTS.md 3.11).

Every scanner returns a `Scan` (id, state ok|fail|skipped, detail, positive_control). A negative claim ("no trailer",
"no secret", "no never-show hit") is only worth something when the same scanner is shown to catch a planted
violation in the same run: `with_positive_control` runs the scanner on its plant first, and a scanner that misses its
plant makes the scan `fail` with "blind scan" whatever the real input says.

Details never carry matched text: never-show hits name the entry id and file:line (or the commit SHA), secret hits
name the pattern id and file:line. The secret shapes are `log.redaction_ids`, the same family `log.redact` masks, so a
string the logs would hide is a string a merge refuses.

Proven-public values (README.md 8, owner decision of 2026-10-02). A transaction hash and a private key share one shape
(`0x` + 64 hex), so the format alone never clears a value. The secret scans clear a secret-shaped value only when (a)
it is listed in the state repo's `public-values.jsonl` (`public`, from `load_public_values`), or (b) it sits in an
explorer link: an http(s) URL on the same line whose path holds it right after `/tx/`, `/txs/` or `/transaction/`.
Each cleared span is replaced by a neutral character before the patterns run, so a cleared value can neither be a hit
nor complete one (`secret = <listed hash>` is no `assignment` hit), while everything around it is still scanned.
`register_public_value` appends one canonical line to that file, only for a transaction hash a chain proved; the
caller holds the state lock (MODULES.md 8 gives this module no `locks` edge, so it checks the lock file's holder
instead of taking the lock: contract question in the B06 report).
"""
from __future__ import annotations

import functools
import json
import os
import re
import socket
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from . import clock, globs, jsonio
from .errors import ExecError, InternalError, PolicyRefused
from .gitutil import Git, has_attribution
from .log import get_logger, redaction_ids
from .nevershow import Entry, scan_lines, scan_text
from .paths import Layout

_LOG = get_logger("execlib.integrity")

# Scan ids (merge-receipt.schema.json scans[].id).
SCAN_IDS = ("writes-scope", "protected", "trailers", "conventional", "never-show", "secrets", "test-integrity",
            "todo-judge-facing", "push-freeze")

CONVENTIONAL_RE = re.compile(r"^(feat|fix|refactor|test|docs|chore|perf|ci|build|revert)(\([^)]+\))?!?: \S")

# Test files and test-runner configuration (test-integrity scan). Conservative: a path that looks like a test is one.
TEST_FILE_GLOBS: tuple[str, ...] = (
    "**/test_*.py", "**/*_test.py", "**/tests/**", "**/test/**", "**/__tests__/**", "**/*.test.*", "**/*.spec.*",
    "**/*_test.go", "**/*_spec.rb", "**/conftest.py",
)
TEST_CONFIG_GLOBS: tuple[str, ...] = (
    "**/vitest.config.*", "**/vitest.workspace.*", "**/jest.config.*", "**/playwright.config.*", "**/karma.conf.*",
    "**/.mocharc*", "**/pytest.ini", "**/tox.ini", "**/setup.cfg", "**/.nycrc*", "**/ava.config.*",
    "**/cypress.config.*", "**/phpunit.xml*", "**/.c8rc*",
)
SKIP_MARKER_RE = re.compile(
    r"(\b(?:it|test|describe|context|suite|bench)\.(?:only|skip|todo)\s*\(|\b(?:xit|xdescribe|xtest|fdescribe)\s*\(|"
    r"@pytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.(?:skip|xfail)\s*\(|@unittest\.(?:skip|skipIf|skipUnless|"
    r"expectedFailure)\b|#\[ignore\]|\bt\.Skip(?:Now|f)?\s*\(|\.only\s*\(|\.skip\s*\()"
)
ASSERTION_RE = re.compile(
    r"(\bassert\w*\b|\bexpect\s*\(|\bassert_eq!|\bassert_ne!|\bassert!|\bself\.assert\w+|\bt\.(?:Error|Fatal)"
    r"\w*\s*\(|\brequire\.\w+\s*\()"
)
TODO_RE = re.compile(r"(\bTODO\b|\bTBD\b|\bFIXME\b|\bXXX\b|lorem ipsum|\bplaceholder\b)", re.IGNORECASE)
TODO_OK = "<!--todo-ok-->"

# --- proven-public values (README.md 8; SCHEMAS.md 1.1 and 5.1) ---------------------------------------------------
PUBLIC_VALUES_FILE = "public-values.jsonl"
# The kinds of public-values.jsonl and the exact shape of each: an EVM hash carries the `0x` prefix, another chain's
# hash is the bare 64 hex (`answers ingest` and `proof run` read hashes with `^(0x)?[0-9a-fA-F]{64}$`).
PUBLIC_KINDS: Mapping[str, re.Pattern[str]] = {
    "evm-tx-hash": re.compile(r"^0x[0-9a-fA-F]{64}$"),
    "tx-hash": re.compile(r"^[0-9a-fA-F]{64}$"),
}
# The only proofs that make a value public: `answers ingest` chain-reread ok, or a tx `proof run` whose reader
# confirmed the transaction.
PUBLIC_PROOFS: tuple[str, ...] = ("chain-reread", "tx-proof")
# (b) an explorer link: an http(s) URL (the same characters lane B09's Notion redaction reads), the value right after
# /tx/, /txs/ or /transaction/ in its PATH (never in its query or fragment).
_URL_RE = re.compile(r"https?://[^\s<>\"'`()\[\]{}|\\^]+")
_TX_PATH_RE = re.compile(r"/(?:tx|txs|transaction)/([0-9A-Za-z]+)")
# (a) a listed value clears only whole tokens shaped like a transaction hash (an optional 0x and at least 32 letters
# or digits): a short or odd listed string can never shield text from the scan (the rule of lane B09's redaction).
_TX_SHAPED_RE = re.compile(r"(?:0x)?[0-9a-z]{32,}")
# What a cleared span becomes before the patterns run: a character every pattern's value class excludes, so it can
# neither match nor complete a match (`password: <listed hash>` is no `assignment` hit).
_CLEARED = ";"


@dataclass(frozen=True)
class Scan:
    id: str
    state: str
    detail: str
    positive_control: dict | None

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "state": self.state, "detail": self.detail, "positive_control": self.positive_control}

    @property
    def ok(self) -> bool:
        return self.state == "ok"


def _ok(scan_id: str, detail: str) -> Scan:
    return Scan(scan_id, "ok", detail, None)


def _fail(scan_id: str, detail: str) -> Scan:
    return Scan(scan_id, "fail", detail, None)


def matches_any(path: str, patterns: Sequence[str]) -> bool:
    """True when `path` matches one of the POSIX globs (SCHEMAS.md 7.1 dialect)."""
    return any(globs.matches(g, path) for g in patterns)


def glob_contains(outer: str, inner: str) -> bool:
    """True only when every path matching `inner` matches `outer` (SCHEMAS.md 7.2, conservative)."""
    return globs.contains(outer, inner)


def _first_line(message: str) -> str:
    return (message or "").split("\n", 1)[0].strip()


def _short(sha: str) -> str:
    return (sha or "")[:12]


# --- scanners -----------------------------------------------------------------------------------------------------

def scan_trailers(messages: Sequence[tuple[str, str]]) -> Scan:
    """No AI-attribution trailer and no "Generated with Claude" line in any message (gitutil's guard.py family)."""
    bad = [sha for sha, msg in messages if has_attribution(msg)]
    if bad:
        return _fail("trailers", "attribution trailer or line in commit(s) " + ", ".join(_short(s) for s in bad))
    return _ok("trailers", f"{len(messages)} message(s) without attribution")


def scan_conventional(messages: Sequence[tuple[str, str]]) -> Scan:
    """Every first line is a conventional-commit header; git's default `Revert "..."` and `Merge ...` fail."""
    bad = [sha for sha, msg in messages if not CONVENTIONAL_RE.match(_first_line(msg))]
    if bad:
        return _fail("conventional", "first line is not a conventional-commit header in commit(s) "
                     + ", ".join(_short(s) for s in bad))
    return _ok("conventional", f"{len(messages)} conventional header(s)")


@functools.lru_cache(maxsize=64)
def _listed_re(public: frozenset[str]) -> re.Pattern[str] | None:
    """One pattern for the listed values shaped like a transaction hash, as whole tokens, any letter case (longest
    first); None when there is none."""
    values = sorted({v.lower() for v in public if isinstance(v, str) and _TX_SHAPED_RE.fullmatch(v.lower())},
                    key=lambda v: (-len(v), v))
    if not values:
        return None
    return re.compile("(?<![0-9A-Za-z])(?:" + "|".join(re.escape(v) for v in values) + ")(?![0-9A-Za-z])",
                      re.IGNORECASE | re.ASCII)


def cleared_spans(line: str, public: frozenset[str] = frozenset()) -> list[tuple[int, int]]:
    """The spans of one line README.md 8 clears, sorted and merged: (b) every value right after /tx/, /txs/ or
    /transaction/ in the path of an http(s) URL of the line, and (a) every whole token equal to a listed value."""
    spans: list[tuple[int, int]] = []
    for url in _URL_RE.finditer(line):
        raw = url.group(0)
        path_start = raw.find("/", raw.index("://") + 3)
        if path_start < 0:
            continue
        ends = [i for i in (raw.find("?"), raw.find("#")) if i >= 0]
        path_end = min(ends) if ends else len(raw)
        for m in _TX_PATH_RE.finditer(raw, path_start, path_end):
            spans.append((url.start() + m.start(1), url.start() + m.end(1)))
    listed = _listed_re(frozenset(public)) if public else None
    if listed is not None:
        spans.extend(m.span() for m in listed.finditer(line))
    merged: list[tuple[int, int]] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _without_cleared(line: str, public: frozenset[str]) -> tuple[str, int]:
    """(the line with every cleared span replaced by the neutral character, the number of those spans that held a
    secret shape)."""
    spans = cleared_spans(line, public)
    if not spans:
        return line, 0
    parts: list[str] = []
    pos = 0
    cleared = 0
    for start, end in spans:
        parts.append(line[pos:start])
        parts.append(_CLEARED)
        if redaction_ids(line[start:end]):
            cleared += 1
        pos = end
    parts.append(line[pos:])
    return "".join(parts), cleared


def _cleared_note(cleared: int) -> str:
    return f"; {cleared} proven-public value(s) cleared (README.md 8)" if cleared else ""


def scan_secrets_text(text: str, *, where: str, public: frozenset[str] = frozenset()) -> Scan:
    """The secret scan on free text (state repo diff, Notion op text, answers): pattern ids and line numbers only.
    Values in `public` (load_public_values) and explorer-link values are not hits (README.md 8)."""
    hits: list[str] = []
    kept: list[str] = []
    cleared = 0
    for lineno, line in enumerate((text or "").split("\n"), start=1):
        scanned, n = _without_cleared(line, public)
        cleared += n
        kept.append(scanned)
        for pid in redaction_ids(scanned):
            hits.append(f"{pid} at {where}:{lineno}")
    whole = redaction_ids("\n".join(kept))
    if not hits and whole:  # a multi-line shape (a PEM block) that no single line shows
        hits = [f"{pid} in {where}" for pid in whole]
    if hits:
        return _fail("secrets", "secret shape(s): " + "; ".join(hits[:20]))
    return _ok("secrets", f"no secret shape in {where}{_cleared_note(cleared)}")


def scan_secrets(added: Sequence[tuple[str, int, str]], *, public: frozenset[str] = frozenset()) -> Scan:
    """The secret scan on added lines (path, line, text): pattern ids and file:line, never the text. Values in
    `public` (load_public_values) and explorer-link values are not hits (README.md 8)."""
    hits: list[str] = []
    cleared = 0
    for path, lineno, text in added:
        scanned, n = _without_cleared(text, public)
        cleared += n
        for pid in redaction_ids(scanned):
            hits.append(f"{pid} at {path}:{lineno}")
    if hits:
        return _fail("secrets", "secret shape(s): " + "; ".join(hits[:20]))
    return _ok("secrets", f"no secret shape in {len(added)} added line(s){_cleared_note(cleared)}")


# --- the registry of proven-public values (README.md 8) -----------------------------------------------------------

def public_values_path(layout: Layout) -> Path:
    """<state>/public-values.jsonl (tracked in the state repo, merge=union)."""
    return layout.state / PUBLIC_VALUES_FILE


def load_public_values(layout: Layout) -> frozenset[str]:
    """The values of public-values.jsonl, lower-cased; empty when the file is absent. A line that is not an object
    with a string `value` is skipped with a warning: its value stays secret-shaped (the scans fail closed)."""
    values: set[str] = set()
    unreadable: list[int] = []
    for lineno, doc in jsonio.read_jsonl(public_values_path(layout)):
        if isinstance(doc, dict) and isinstance(doc.get("value"), str) and doc["value"].strip():
            values.add(doc["value"].strip().lower())
        else:
            unreadable.append(lineno)
    if unreadable:
        _LOG.warning("public-values.jsonl lines without a value were skipped: those values stay secret-shaped",
                     extra={"data": {"lines": unreadable[:20]}})
    return frozenset(values)


def _holds_state_lock(layout: Layout) -> bool:
    """True when the state lock file names this process as its holder (locks.hold writes {pid, host, ...})."""
    try:
        holder = json.loads(layout.lock("state").read_bytes().decode("utf-8"))
    except (FileNotFoundError, PermissionError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    return isinstance(holder, dict) and holder.get("pid") == os.getpid() and \
        holder.get("host") in (None, socket.gethostname())


def _executor_of(layout: Layout) -> str | None:
    """This machine's executor: local/state.json, else the active marker (the line records who registered)."""
    for path in (layout.local_state, layout.active):
        try:
            doc = jsonio.read_json_retry(path)
        except FileNotFoundError:
            continue
        except (ExecError, OSError) as err:
            _LOG.warning("the executor could not be read", extra={"data": {"path": str(path), "error": str(err)}})
            continue
        executor = doc.get("executor") if isinstance(doc, dict) else None
        if executor in ("A", "B"):
            return str(executor)
    return None


def _instant() -> str:
    """Now through clock.utcnow (EXEC_NOW under EXEC_TEST, else the system clock): MODULES.md gives this function no
    `now`. A command running under `--now` keeps its override mark for its later events and digests."""
    overridden = clock.is_overridden()
    now = clock.utcnow()
    if overridden and not clock.is_overridden():
        clock.utcnow(clock.format_utc(now))  # re-arms the override mark only; `now` is unchanged
    return clock.format_utc(now)


def register_public_value(layout: Layout, *, value: str, kind: str, chain: str, network: str, proven: str,
                          source: str) -> bool:
    """Append one canonical JSON line {value, kind, chain, network, proven, source, at_utc, executor} to the state
    repo's public-values.jsonl, for a transaction hash a chain proved public (`answers ingest` chain-reread ok, or a
    tx `proof run` whose reader confirmed it; SCHEMAS.md 5.1). True when appended, False when the value (any letter
    case) is already listed. PolicyRefused (E_POLICY, exit 4) without a chain proof: `proven` not one of
    PUBLIC_PROOFS, a value that is not a transaction hash of `kind`, or no chain, network or source. The caller holds
    the state lock (InternalError otherwise: a caller bug). Messages never carry the value."""
    if proven not in PUBLIC_PROOFS:
        raise PolicyRefused(f"a value is registered public only after a chain proof ({' or '.join(PUBLIC_PROOFS)}), "
                            f"not {proven!r}", code="E_POLICY", hint="README.md 8: the format alone never clears a "
                                                                    "value")
    shape = PUBLIC_KINDS.get(kind)
    if shape is None:
        raise PolicyRefused(f"public-values.jsonl lists transaction hashes only ({', '.join(sorted(PUBLIC_KINDS))}), "
                            f"not {kind!r}", code="E_POLICY")
    if not isinstance(value, str) or not shape.match(value):
        raise PolicyRefused(f"the value is not a transaction hash of kind {kind}: not registered", code="E_POLICY")
    for name, field in (("chain", chain), ("network", network), ("source", source)):
        if not isinstance(field, str) or not field.strip():
            raise PolicyRefused(f"no {name}: a value is registered only with the chain proof that made it public",
                                code="E_POLICY")
    if not _holds_state_lock(layout):
        raise InternalError("integrity.register_public_value requires the state lock held by its caller (a caller "
                            "bug, never the owner's)", code="E_INTERNAL")
    if value.lower() in load_public_values(layout):
        return False
    executor = _executor_of(layout)
    if executor is None:
        _LOG.warning("public value registered without a known executor (no local state, no active marker)")
    line = {"value": value, "kind": kind, "chain": chain, "network": network, "proven": proven, "source": source,
            "at_utc": _instant(), "executor": executor}
    jsonio.append_jsonl(public_values_path(layout), line)
    _LOG.info("public value registered", extra={"data": {"kind": kind, "chain": chain, "network": network,
                                                         "proven": proven, "source": source}})
    return True


def scan_never_show(added: Sequence[tuple[str, int, str]], entries: Sequence[Entry]) -> Scan:
    """Active never-show entries on added lines: entry ids and file:line only (SCHEMAS.md 8)."""
    hits = scan_lines(added, entries)
    if hits:
        where = "; ".join(f"{h.entry_id} at {h.file}:{h.line}" for h in hits[:20])
        return _fail("never-show", "never-show entry hit: " + where)
    return _ok("never-show", f"{len(entries)} active entr(ies), no hit in {len(added)} added line(s)")


def scan_never_show_messages(messages: Sequence[tuple[str, str]], entries: Sequence[Entry]) -> Scan:
    """Active never-show entries on commit messages: entry ids and commit SHAs only."""
    found: list[str] = []
    for sha, msg in messages:
        for h in scan_text(msg, entries):
            found.append(f"{h.entry_id} in commit {_short(sha)} message line {h.line}")
    if found:
        return _fail("never-show", "never-show entry hit: " + "; ".join(found[:20]))
    return _ok("never-show", f"no hit in {len(messages)} message(s)")


def scan_writes_scope(paths: Sequence[str], writes: Sequence[str]) -> Scan:
    """Every changed path matches one of the task's write globs."""
    outside = [p for p in paths if not matches_any(p, writes)]
    if outside:
        return _fail("writes-scope", "changed outside the task's writes: " + ", ".join(outside[:20]))
    return _ok("writes-scope", f"{len(paths)} path(s) inside the task's writes")


def scan_protected(paths: Sequence[str], protected: Sequence[str], allowed: bool) -> Scan:
    """No protected glob touched, unless the task may write it (P-20: test-designer tests, contract wave)."""
    touched = [p for p in paths if matches_any(p, protected)]
    if touched and not allowed:
        return _fail("protected", "protected path(s) touched: " + ", ".join(touched[:20]))
    if touched:
        return _ok("protected", "protected path(s) touched by an allowed task: " + ", ".join(touched[:20]))
    return _ok("protected", f"{len(paths)} path(s), none protected")


def test_integrity_core(changes: Sequence[tuple[str, str | None, str | None]]) -> Scan:
    """The pure part of the test-integrity scan over (path, base text or None, head text or None).

    Fails on a skip/only/xfail marker added to a test file, an assertion count reduced in an existing test file, or a
    test-runner configuration changed."""
    problems: list[str] = []
    for path, base, head in changes:
        if matches_any(path, TEST_CONFIG_GLOBS):
            problems.append(f"test configuration changed: {path}")
            continue
        if not matches_any(path, TEST_FILE_GLOBS):
            continue
        base_lines = (base or "").split("\n") if base is not None else []
        head_lines = (head or "").split("\n") if head is not None else []
        base_markers = sum(1 for ln in base_lines if SKIP_MARKER_RE.search(ln))
        head_markers = sum(1 for ln in head_lines if SKIP_MARKER_RE.search(ln))
        if head_markers > base_markers:
            problems.append(f"skip/only/xfail marker added in {path} ({base_markers} -> {head_markers})")
        if base is not None:
            base_asserts = sum(len(ASSERTION_RE.findall(ln)) for ln in base_lines)
            head_asserts = sum(len(ASSERTION_RE.findall(ln)) for ln in head_lines)
            if head_asserts < base_asserts:
                problems.append(f"assertions reduced in {path} ({base_asserts} -> {head_asserts})")
    if problems:
        return _fail("test-integrity", "; ".join(problems[:20]))
    return _ok("test-integrity", f"{len(changes)} changed path(s): no marker added, no assertion removed")


def _blob_text(git: Git, rev: str, path: str) -> str | None:
    res = git.run("show", f"{rev}:{path}", check=False)
    return res.stdout if res.exit_code == 0 else None


def test_integrity_changes(git: Git, base: str, head: str) -> list[tuple[str, str | None, str | None]]:
    """(path, base text, head text) of the changed paths that matter to the test-integrity scan."""
    out: list[tuple[str, str | None, str | None]] = []
    for path in git.changed_paths(base, head):
        if matches_any(path, TEST_CONFIG_GLOBS):
            out.append((path, None, None))
        elif matches_any(path, TEST_FILE_GLOBS):
            out.append((path, _blob_text(git, base, path), _blob_text(git, head, path)))
    return out


def scan_test_integrity(git: Git, base: str, head: str) -> Scan:
    """Skip/only/xfail markers, assertion counts and runner configuration on base..head."""
    return test_integrity_core(test_integrity_changes(git, base, head))


def scan_todo(added: Sequence[tuple[str, int, str]], judge_globs: Sequence[str]) -> Scan:
    """No TODO/TBD/FIXME/placeholder added to a judge-facing file; `<!--todo-ok-->` on the line exempts it."""
    hits = [f"{path}:{lineno}" for path, lineno, text in added
            if matches_any(path, judge_globs) and TODO_RE.search(text) and TODO_OK not in text]
    if hits:
        return _fail("todo-judge-facing", "deferral marker added to judge-facing file(s): " + ", ".join(hits[:20]))
    return _ok("todo-judge-facing", f"no deferral marker in {len(judge_globs)} judge-facing glob(s)")


def scan_push_freeze(now_utc: str, freeze_utc: str | None, frozen_flag: bool) -> Scan:
    """No push at or after policy.git.push_freeze_utc, nor while local state flags.push_frozen is set."""
    if frozen_flag:
        return _fail("push-freeze", "local state flags.push_frozen is set")
    if freeze_utc is not None and now_utc >= freeze_utc:
        return _fail("push-freeze", f"push freeze since {freeze_utc} (now {now_utc})")
    return _ok("push-freeze", f"push allowed until {freeze_utc}" if freeze_utc else "no push freeze configured")


# --- positive controls --------------------------------------------------------------------------------------------

def with_positive_control(scanner: Callable[..., Scan], planted: Any, *args: Any) -> Scan:
    """Run `scanner` on the planted violation first (a tuple is unpacked as its arguments), then on `args`.

    A scanner that misses its plant makes the scan fail with "blind scan", whatever the real input says."""
    control = scanner(*planted) if isinstance(planted, tuple) else scanner(planted)
    if control.state != "fail":
        return Scan(control.id, "fail", "blind scan: the scanner missed its planted violation (positive control)",
                    {"ran": True, "caught": False})
    real = scanner(*args)
    return replace(real, positive_control={"ran": True, "caught": True})


def planted_messages(kind: str) -> list[tuple[str, str]]:
    """Planted commit messages, assembled at runtime so no source holds the literal (TESTS.md 1.4)."""
    if kind == "trailer":
        return [("0" * 40, "fix: x\n\n" + "Co-" + "Authored-By: planted <planted@example.invalid>")]
    if kind == "conventional":
        return [("0" * 40, 'Revert "planted"')]
    raise ValueError(kind)


def planted_secret_line() -> list[tuple[str, int, str]]:
    """A planted private-key shape (built from parts; never a real key)."""
    return [("planted.txt", 1, "k = 0x" + "ab" * 32)]


def planted_never_show(entries: Sequence[Entry]) -> tuple[list[tuple[str, int, str]], list[Entry]]:
    """A line built to hit a synthetic literal entry (so the control works even with no live entry)."""
    marker = "planted-" + "never-show-control"
    entry = Entry(id="ns-positive-control", cls="other", pattern=marker, regex=False, case_sensitive=False,
                  until=None, scope="repo")
    return [("planted.txt", 1, f"x {marker.upper()} y")], [entry]


def planted_test_change() -> list[tuple[str, str | None, str | None]]:
    return [("tests/planted.test.js", 'it("x", () => { expect(1).toBe(1) })\n',
             'it.only("x", () => { expect(1).toBe(1) })\n')]


def planted_todo() -> tuple[list[tuple[str, int, str]], list[str]]:
    return [("README.md", 1, "TO" + "DO: planted")], ["README.md"]
