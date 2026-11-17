#!/usr/bin/env python3
"""Compare two SARIF 2.1.0 logs result by result: new / absent / unchanged, per tool and rule.

Purpose
    A before/after warnings delta is valid only when both runs used the same pinned tool
    version and configuration, and only when results are matched one by one, never by
    subtracting counts (final-report-and-impact G204-F12: equal numbers of new and resolved
    occurrences cancel out in a count diff; G204-F17: report new/absent/unchanged).

    Matching, per (tool, rule):
      1. fingerprints: when every result of that rule on both sides carries the same SARIF
         `fingerprints` keys (preferred) or `partialFingerprints` keys, results are matched on
         (ruleId, key values); for partialFingerprints the normalised URI is added to the key,
         because partial fingerprints such as primaryLocationLineHash hash line content only;
      2. snippet: otherwise, when every result has `region.snippet.text`, on
         (ruleId, normalised URI, sha256 of the whitespace-collapsed snippet);
      3. message: otherwise on (ruleId, normalised URI, sha256 of the message text).
    Start lines are never part of a key, so a result whose code moved is "unchanged" (and
    counted as moved). Identical keys are matched as a multiset, pairing in line order.

    Comparability warnings (the delta is then not valid as improvement evidence):
      - a tool present in only one log;
      - driver version / semanticVersion, or extension (plugin, query pack) versions differ;
      - a rule's defaultConfiguration or the invocation ruleConfigurationOverrides differ;
      - an invocation with executionSuccessful=false or an error-level notification
        (G204-F11: failed tools belong in the Limits section);
      - absolute URIs that could not be made repository-relative;
      - with --repo/--base/--config: a configuration file differs between the two commits.

    Suppressed results (a suppression whose status is absent or "accepted") are matched like
    the others and reported separately, so "suppressed, not fixed" is never shown as absent.

CLI
    python sarif_delta.py <before.sarif> <after.sarif> [--json]
                          [--before-root DIR] [--after-root DIR]
                          [--repo DIR --base REV [--head REV] --config PATH ...]
                          [--max-list N]
    (use python3 on macOS/Linux)
    --before-root/--after-root  checkout directory each run analysed; absolute result URIs
                                under it become repository-relative.
    --config PATH               repository-relative config file (repeatable) whose content is
                                compared between --base and --head (default: working tree),
                                by git blob id.
    --max-list N                text output lists at most N new and N absent results
                                (default 50); --json always lists all of them.

Exit codes
    0  comparison done and valid (no comparability warning)
    1  comparison done but NOT valid as evidence (see the warnings)
    2  unreadable input (missing file, bad UTF-8, malformed JSON, not a SARIF log) or git error
       in --config mode
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import unquote, urlparse

SARIF_VERSION = "2.1.0"
DEFAULT_MAX_LIST = 50
GIT_TIMEOUT_S = 30
NOT_FINDING_KINDS = frozenset({"pass", "notApplicable"})
WINDOWS_DRIVE_RE = re.compile(r"^/?([A-Za-z]):/")
PLACEHOLDER_RE = re.compile(r"\{(\d+)\}")


class SarifError(Exception):
    """Input is unreadable or not a SARIF log."""


# ----------------------------------------------------------------------------
# Data model
# ----------------------------------------------------------------------------
@dataclass
class Result:
    """One SARIF result reduced to what matching needs."""

    tool: str
    rule_id: str
    uri: str
    start_line: Optional[int]
    message: str
    snippet: Optional[str]
    fingerprints: Dict[str, str]
    suppressed: bool
    level: str

    def location(self) -> str:
        return f"{self.uri}:{self.start_line}" if self.start_line else self.uri

    def to_dict(self) -> Dict[str, Any]:
        return {"tool": self.tool, "rule": self.rule_id, "uri": self.uri,
                "line": self.start_line, "level": self.level, "suppressed": self.suppressed,
                "message": self.message}


@dataclass
class ToolRun:
    """Everything one side knows about one tool (all runs of that driver merged)."""

    name: str
    versions: Set[Tuple[str, str]] = field(default_factory=set)  # (version, semanticVersion)
    extensions: Dict[str, Set[str]] = field(default_factory=lambda: defaultdict(set))
    rule_configs: Dict[str, str] = field(default_factory=dict)  # rule id -> canonical JSON
    overrides: Set[str] = field(default_factory=set)
    invocations: int = 0
    failed_invocations: int = 0
    error_notifications: List[str] = field(default_factory=list)
    results: List[Result] = field(default_factory=list)
    skipped_non_findings: int = 0
    unresolved_absolute_uris: int = 0


@dataclass
class SarifSide:
    """A parsed SARIF log."""

    path: str
    sarif_version: str
    tools: Dict[str, ToolRun]


# ----------------------------------------------------------------------------
# Parsing
# ----------------------------------------------------------------------------
def _canon(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _collapse(text: str) -> str:
    return " ".join(text.split())


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _as_path(uri: str) -> Tuple[str, bool]:
    """Decode a URI or path to a forward-slash path; returns (path, is_absolute)."""
    text = uri.strip()
    parsed = urlparse(text)
    if parsed.scheme == "file":
        path = unquote(parsed.path)
        if parsed.netloc and parsed.netloc not in ("", "localhost"):
            path = f"//{parsed.netloc}{path}"
        path = path.replace("\\", "/")
        drive = WINDOWS_DRIVE_RE.match(path)
        if drive:
            path = f"{drive.group(1).lower()}:/" + path[drive.end():]
        return path, True
    if parsed.scheme and len(parsed.scheme) > 1:
        return text, True  # another scheme (http:, sarif:): keep as an opaque absolute id
    path = unquote(text).replace("\\", "/")
    drive = WINDOWS_DRIVE_RE.match(path)
    if drive:
        return f"{drive.group(1).lower()}:/" + path[drive.end():], True
    if path.startswith("/"):
        return path, True
    return path, False


def _clean_rel(path: str) -> str:
    parts: List[str] = []
    for part in path.split("/"):
        if part in ("", "."):
            continue
        if part == ".." and parts and parts[-1] != "..":
            parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def _root_prefix(root: str) -> str:
    path, _ = _as_path(root)
    return path.rstrip("/") + "/"


def _strip_root(path: str, roots: Sequence[str]) -> Optional[str]:
    """Make an absolute path relative to the first root that contains it."""
    for root in roots:
        prefix = _root_prefix(root)
        windows_style = re.match(r"^[a-z]:/", prefix) is not None
        if windows_style:
            inside = path.lower().startswith(prefix.lower())  # Windows paths ignore case
        else:
            inside = path.startswith(prefix)
        if inside:
            return _clean_rel(path[len(prefix):])
    return None


def _join(a: str, b: str) -> str:
    if not a:
        return b
    if not b:
        return a
    return a.rstrip("/") + "/" + b


def _resolve_base(base_id: str, bases: Dict[str, Any], depth: int = 0) -> Tuple[str, str]:
    """Resolve an originalUriBaseIds chain.

    Returns (relative prefix below the absolute root, absolute root path or "" when the
    chain never reaches an absolute URI). Unknown ids give ("", "").
    """
    entry = bases.get(base_id)
    if not isinstance(entry, dict) or depth > 10:
        return "", ""
    uri = _str(entry.get("uri"))
    parent = _str(entry.get("uriBaseId"))
    path, absolute = _as_path(uri) if uri else ("", False)
    if absolute:
        return "", path
    if not parent:
        return path, ""
    parent_rel, parent_root = _resolve_base(parent, bases, depth + 1)
    return _join(parent_rel, path), parent_root


def root_candidates(bases: Dict[str, Any], roots: Sequence[str]) -> List[str]:
    """User roots first, then the run's absolute base URIs, shortest (outermost) first."""
    found = set()
    for key in bases:
        rel, root = _resolve_base(key, bases)
        if root and not rel:
            found.add(root)
    return list(roots) + sorted(found, key=len)


def normalise_uri(location: Dict[str, Any], bases: Dict[str, Any],
                  candidates: Sequence[str]) -> Tuple[str, bool]:
    """Repository-relative URI of an artifactLocation; returns (uri, resolved)."""
    uri = _str(location.get("uri"))
    base_id = _str(location.get("uriBaseId"))
    path, absolute = _as_path(uri)
    if not absolute and base_id:
        rel, root = _resolve_base(base_id, bases)
        if root:
            stripped = _strip_root(_join(_join(root, rel), path), candidates)
            if stripped is not None:
                return stripped, True
        # Relative to its base (the analysis root when the base is unknown): keep it relative.
        return _clean_rel(_join(rel, path)), True
    if not absolute:
        return _clean_rel(path), True
    stripped = _strip_root(path, candidates)
    if stripped is not None:
        return stripped, True
    return path, False


def _message_text(result: Dict[str, Any], rule_messages: Dict[str, Dict[str, Any]]) -> str:
    message = result.get("message") if isinstance(result.get("message"), dict) else {}
    text = _str(message.get("text")) or _str(message.get("markdown"))
    args = [str(a) for a in message.get("arguments", [])] if isinstance(
        message.get("arguments"), list) else []
    if not text and message.get("id"):
        rule_entry = rule_messages.get(_str(message.get("id")))
        if isinstance(rule_entry, dict):
            text = _str(rule_entry.get("text"))
        if not text:
            text = f"{message.get('id')}:{'|'.join(args)}"
    if args:
        text = PLACEHOLDER_RE.sub(
            lambda m: args[int(m.group(1))] if int(m.group(1)) < len(args) else m.group(0), text)
    return _collapse(text)


def _is_suppressed(result: Dict[str, Any]) -> bool:
    supp = result.get("suppressions")
    if not isinstance(supp, list) or not supp:
        return False
    for s in supp:
        if isinstance(s, dict) and s.get("status") in (None, "accepted"):
            return True
    return False


def _rule_id(result: Dict[str, Any], rules: List[Any]) -> str:
    rid = _str(result.get("ruleId"))
    if rid:
        return rid
    rule = result.get("rule")
    if isinstance(rule, dict):
        if _str(rule.get("id")):
            return _str(rule["id"])
        idx = rule.get("index")
        if isinstance(idx, int) and 0 <= idx < len(rules) and isinstance(rules[idx], dict):
            return _str(rules[idx].get("id")) or "<no-rule>"
    idx = result.get("ruleIndex")
    if isinstance(idx, int) and 0 <= idx < len(rules) and isinstance(rules[idx], dict):
        return _str(rules[idx].get("id")) or "<no-rule>"
    return "<no-rule>"


def _first_physical(result: Dict[str, Any]) -> Dict[str, Any]:
    locations = result.get("locations")
    if isinstance(locations, list):
        for loc in locations:
            if isinstance(loc, dict) and isinstance(loc.get("physicalLocation"), dict):
                return loc["physicalLocation"]
    return {}


def parse_sarif(doc: Any, path: str, roots: Sequence[str] = ()) -> SarifSide:
    """Turn a SARIF document into per-tool runs and results."""
    if not isinstance(doc, dict) or not isinstance(doc.get("runs"), list):
        raise SarifError(f"{path}: not a SARIF log (no 'runs' array)")
    tools: Dict[str, ToolRun] = {}
    for run_index, run in enumerate(doc["runs"]):
        if not isinstance(run, dict):
            raise SarifError(f"{path}: runs[{run_index}] is not an object")
        tool = run.get("tool") if isinstance(run.get("tool"), dict) else {}
        driver = tool.get("driver") if isinstance(tool.get("driver"), dict) else {}
        name = _str(driver.get("name")) or f"<unnamed run {run_index}>"
        key = name.lower()
        tr = tools.setdefault(key, ToolRun(name=name))
        tr.versions.add((_str(driver.get("version")), _str(driver.get("semanticVersion"))))
        for ext in tool.get("extensions", []) if isinstance(tool.get("extensions"), list) else []:
            if isinstance(ext, dict):
                ext_version = _str(ext.get("semanticVersion")) or _str(ext.get("version"))
                tr.extensions[_str(ext.get("name")) or "<unnamed>"].add(ext_version)
        rules = driver.get("rules") if isinstance(driver.get("rules"), list) else []
        rule_messages: Dict[str, Dict[str, Dict[str, Any]]] = {}
        for rule in rules:
            if isinstance(rule, dict) and _str(rule.get("id")):
                tr.rule_configs[rule["id"]] = _canon(rule.get("defaultConfiguration"))
                ms = rule.get("messageStrings")
                if isinstance(ms, dict):
                    rule_messages[rule["id"]] = {k: v for k, v in ms.items() if isinstance(v, dict)}
        for inv in run.get("invocations", []) if isinstance(run.get("invocations"), list) else []:
            if not isinstance(inv, dict):
                continue
            tr.invocations += 1
            if inv.get("executionSuccessful") is False:
                tr.failed_invocations += 1
            overrides = inv.get("ruleConfigurationOverrides")
            if isinstance(overrides, list) and overrides:
                tr.overrides.add(_canon(overrides))
            for key_name in ("toolExecutionNotifications", "toolConfigurationNotifications"):
                notes = inv.get(key_name)
                if isinstance(notes, list):
                    for note in notes:
                        if isinstance(note, dict) and note.get("level") == "error":
                            msg = note.get("message") if isinstance(note.get("message"), dict) else {}
                            tr.error_notifications.append(_collapse(_str(msg.get("text")))[:200])
        bases = run.get("originalUriBaseIds") if isinstance(run.get("originalUriBaseIds"), dict) else {}
        candidates = root_candidates(bases, roots)
        artifacts = run.get("artifacts") if isinstance(run.get("artifacts"), list) else []
        for result in run.get("results", []) if isinstance(run.get("results"), list) else []:
            if not isinstance(result, dict):
                continue
            if result.get("kind") in NOT_FINDING_KINDS:
                tr.skipped_non_findings += 1
                continue
            phys = _first_physical(result)
            art = phys.get("artifactLocation") if isinstance(phys.get("artifactLocation"), dict) else {}
            idx = art.get("index")
            if not _str(art.get("uri")) and isinstance(idx, int) and 0 <= idx < len(artifacts):
                entry = artifacts[idx] if isinstance(artifacts[idx], dict) else {}
                if isinstance(entry.get("location"), dict):
                    art = entry["location"]  # SARIF 3.4.5: the uri lives in run.artifacts[index]
            uri, resolved = normalise_uri(art, bases, candidates) if art else ("<no-location>", True)
            if not resolved:
                tr.unresolved_absolute_uris += 1
            region = phys.get("region") if isinstance(phys.get("region"), dict) else {}
            start = region.get("startLine")
            snippet_obj = region.get("snippet") if isinstance(region.get("snippet"), dict) else {}
            snippet = _collapse(_str(snippet_obj.get("text"))) or None
            fps: Dict[str, str] = {}
            for prop, tag in (("fingerprints", "fingerprints"),
                              ("partialFingerprints", "partialFingerprints")):
                value = result.get(prop)
                if isinstance(value, dict):
                    for k, v in value.items():
                        if isinstance(v, str) and v:
                            fps[f"{tag}/{k}"] = v
            rule_id = _rule_id(result, rules)
            tr.results.append(Result(
                tool=name,
                rule_id=rule_id,
                uri=uri,
                start_line=start if isinstance(start, int) and not isinstance(start, bool) else None,
                message=_message_text(result, rule_messages.get(rule_id, {})),
                snippet=snippet,
                fingerprints=fps,
                suppressed=_is_suppressed(result),
                level=_str(result.get("level")) or "warning",
            ))
    return SarifSide(path=path, sarif_version=_str(doc.get("version")), tools=tools)


def load_sarif(path: Path, root: Optional[str] = None) -> SarifSide:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError as exc:
        raise SarifError(f"file not found: {path.as_posix()}") from exc
    except UnicodeDecodeError as exc:
        raise SarifError(f"not valid UTF-8: {path.as_posix()} ({exc})") from exc
    except OSError as exc:
        raise SarifError(f"cannot read {path.as_posix()}: {exc}") from exc
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SarifError(f"malformed JSON in {path.as_posix()} at line {exc.lineno} "
                         f"column {exc.colno}: {exc.msg}") from exc
    return parse_sarif(doc, path.as_posix(), [root] if root else [])


# ----------------------------------------------------------------------------
# Matching
# ----------------------------------------------------------------------------
@dataclass
class RuleDelta:
    """Delta for one (tool, rule)."""

    tool: str
    rule: str
    basis: str
    new: List[Result] = field(default_factory=list)
    absent: List[Result] = field(default_factory=list)
    unchanged: int = 0
    moved: int = 0
    newly_suppressed: int = 0
    newly_unsuppressed: int = 0
    ambiguous_keys: int = 0

    def to_dict(self, with_lists: bool = True) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "tool": self.tool, "rule": self.rule, "basis": self.basis,
            "new": len(self.new), "absent": len(self.absent), "unchanged": self.unchanged,
            "moved": self.moved,
            "new_suppressed": sum(1 for r in self.new if r.suppressed),
            "absent_were_suppressed": sum(1 for r in self.absent if r.suppressed),
            "unchanged_now_suppressed": self.newly_suppressed,
            "unchanged_now_unsuppressed": self.newly_unsuppressed,
            "count_matched_keys": self.ambiguous_keys,
        }
        if with_lists:
            out["new_results"] = [r.to_dict() for r in self.new]
            out["absent_results"] = [r.to_dict() for r in self.absent]
        return out


def _fingerprint_keys(results: Iterable[Result]) -> Optional[List[str]]:
    """Fingerprint keys every result carries (fingerprints/ preferred over partialFingerprints/)."""
    common: Optional[Set[str]] = None
    for r in results:
        keys = set(r.fingerprints)
        common = keys if common is None else common & keys
        if not common:
            return None
    if not common:
        return None
    full = sorted(k for k in common if k.startswith("fingerprints/"))
    return full or sorted(common)


def choose_basis(before: Sequence[Result], after: Sequence[Result]) -> Tuple[str, List[str]]:
    """Pick the matching basis for one rule; returns (basis label, fingerprint keys)."""
    both = list(before) + list(after)
    keys = _fingerprint_keys(both)
    if keys:
        return "fingerprint", keys
    if all(r.snippet for r in both):
        return "snippet", []
    return "message", []


def match_key(r: Result, basis: str, fp_keys: Sequence[str]) -> Tuple[str, ...]:
    if basis == "fingerprint":
        values = tuple(r.fingerprints[k] for k in fp_keys)
        if all(k.startswith("fingerprints/") for k in fp_keys):
            return (r.rule_id,) + values
        return (r.rule_id, r.uri) + values
    if basis == "snippet":
        return (r.rule_id, r.uri, _sha(r.snippet or ""))
    return (r.rule_id, r.uri, _sha(r.message))


def _line_order(r: Result) -> Tuple[int, str]:
    return (r.start_line if r.start_line is not None else 0, r.message)


def diff_rule(tool: str, rule: str, before: Sequence[Result],
              after: Sequence[Result]) -> RuleDelta:
    """Multiset match of one rule's results; start lines never enter the key."""
    basis, fp_keys = choose_basis(before, after)
    label = basis if basis != "fingerprint" else "fingerprint(" + ",".join(fp_keys) + ")"
    delta = RuleDelta(tool=tool, rule=rule, basis=label)
    groups_b: Dict[Tuple[str, ...], List[Result]] = defaultdict(list)
    groups_a: Dict[Tuple[str, ...], List[Result]] = defaultdict(list)
    for r in before:
        groups_b[match_key(r, basis, fp_keys)].append(r)
    for r in after:
        groups_a[match_key(r, basis, fp_keys)].append(r)
    for key in sorted(set(groups_b) | set(groups_a)):
        rb = sorted(groups_b.get(key, []), key=_line_order)
        ra = sorted(groups_a.get(key, []), key=_line_order)
        if len(rb) > 1 or len(ra) > 1:
            delta.ambiguous_keys += 1
        paired = min(len(rb), len(ra))
        for x, y in zip(rb[:paired], ra[:paired]):
            delta.unchanged += 1
            if x.start_line != y.start_line:
                delta.moved += 1
            if not x.suppressed and y.suppressed:
                delta.newly_suppressed += 1
            elif x.suppressed and not y.suppressed:
                delta.newly_unsuppressed += 1
        delta.absent.extend(rb[paired:])
        delta.new.extend(ra[paired:])
    return delta


# ----------------------------------------------------------------------------
# Comparability
# ----------------------------------------------------------------------------
def _fmt_versions(versions: Set[Tuple[str, str]]) -> str:
    parts = []
    for version, semver in sorted(versions):
        text = version or "?"
        if semver and semver != version:
            text += f" (semanticVersion {semver})"
        parts.append(text)
    return ", ".join(parts) or "?"


def compare_tool(before: ToolRun, after: ToolRun) -> Tuple[List[str], List[str]]:
    """Comparability warnings and neutral notes for one tool present on both sides."""
    warnings: List[str] = []
    notes: List[str] = []
    name = before.name
    for side, tr in (("before", before), ("after", after)):
        if len(tr.versions) > 1:
            warnings.append(f"{name}: the {side} log mixes versions {_fmt_versions(tr.versions)}")
        if tr.failed_invocations:
            warnings.append(f"{name}: {tr.failed_invocations} {side} invocation(s) have "
                            "executionSuccessful=false; results are incomplete (list it under Limits)")
        if tr.error_notifications:
            warnings.append(f"{name}: {len(tr.error_notifications)} error-level notification(s) in "
                            f"the {side} run, e.g. '{tr.error_notifications[0]}'")
        if tr.invocations == 0:
            notes.append(f"{name}: the {side} log has no invocation record; tool success is unknown")
        if tr.unresolved_absolute_uris:
            warnings.append(f"{name}: {tr.unresolved_absolute_uris} {side} result(s) use absolute "
                            f"URIs that could not be made repository-relative; pass --{side}-root")
    if before.versions != after.versions:
        warnings.append(f"{name}: tool version differs (before {_fmt_versions(before.versions)}, "
                        f"after {_fmt_versions(after.versions)}); pin one version and re-run both")
    elif all(not v and not s for v, s in before.versions):
        notes.append(f"{name}: neither log records a driver version, so pinning cannot be checked")
    ext_names = set(before.extensions) | set(after.extensions)
    for ext in sorted(ext_names):
        vb, va = before.extensions.get(ext, set()), after.extensions.get(ext, set())
        if ext not in before.extensions or ext not in after.extensions:
            side = "after" if ext not in after.extensions else "before"
            warnings.append(f"{name}: extension '{ext}' is missing from the {side} log")
        elif vb != va:
            warnings.append(f"{name}: extension '{ext}' version differs "
                            f"({', '.join(sorted(vb)) or '?'} vs {', '.join(sorted(va)) or '?'})")
    shared = set(before.rule_configs) & set(after.rule_configs)
    changed = sorted(r for r in shared if before.rule_configs[r] != after.rule_configs[r])
    if changed:
        shown = ", ".join(changed[:10]) + (" ..." if len(changed) > 10 else "")
        warnings.append(f"{name}: defaultConfiguration differs for {len(changed)} rule(s): {shown}")
    if before.overrides != after.overrides:
        warnings.append(f"{name}: invocation ruleConfigurationOverrides differ between the runs")
    only_b = sorted(set(before.rule_configs) - set(after.rule_configs))
    only_a = sorted(set(after.rule_configs) - set(before.rule_configs))
    if only_b or only_a:
        notes.append(f"{name}: rule metadata lists differ ({len(only_b)} only before, "
                     f"{len(only_a)} only after). Some tools list only rules that fired; others "
                     "list every enabled rule, in which case a rule was enabled or disabled. "
                     "Confirm with --config hashing.")
    return warnings, notes


def _git(repo: Path, *args: str) -> Tuple[int, str, str]:
    env = dict(os.environ)
    env["GIT_TERMINAL_PROMPT"] = "0"
    try:
        proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                              timeout=GIT_TIMEOUT_S, check=False, env=env)
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, "", str(exc)
    return (proc.returncode, proc.stdout.decode("utf-8", errors="replace").strip(),
            proc.stderr.decode("utf-8", errors="replace").strip())


def compare_configs(repo: Path, base: str, head: Optional[str],
                    configs: Sequence[str]) -> Tuple[List[str], List[Dict[str, Any]]]:
    """Compare config files between two revisions (or base vs working tree) by blob id."""
    warnings: List[str] = []
    rows: List[Dict[str, Any]] = []
    rc, _, err = _git(repo, "rev-parse", "--verify", f"{base}^{{commit}}")
    if rc != 0:
        raise SarifError(f"--base {base} is not a commit in {repo.as_posix()}: {err}")
    if head:
        rc, _, err = _git(repo, "rev-parse", "--verify", f"{head}^{{commit}}")
        if rc != 0:
            raise SarifError(f"--head {head} is not a commit in {repo.as_posix()}: {err}")
    for cfg in configs:
        rel = cfg.replace("\\", "/")
        while rel.startswith("./"):
            rel = rel[2:]
        rc_b, blob_b, _ = _git(repo, "rev-parse", f"{base}:{rel}")
        before_id = blob_b if rc_b == 0 else None
        if head:
            rc_a, blob_a, _ = _git(repo, "rev-parse", f"{head}:{rel}")
            after_id = blob_a if rc_a == 0 else None
            where = head
        else:
            full = repo / rel
            if full.is_file():
                rc_a, blob_a, _ = _git(repo, "hash-object", "--", rel)
                after_id = blob_a if rc_a == 0 else None
            else:
                after_id = None
            where = "working tree"
        rows.append({"config": rel, "before": before_id, "after": after_id,
                     "same": before_id is not None and before_id == after_id})
        if before_id is None and after_id is None:
            warnings.append(f"config '{rel}' exists neither at {base} nor in {where}; check the path")
        elif before_id is None or after_id is None:
            side = base if before_id is None else where
            warnings.append(f"config '{rel}' is missing at {side}; the runs used different "
                            "configuration")
        elif before_id != after_id:
            warnings.append(f"config '{rel}' differs between {base} and {where}; the delta is not "
                            "valid under a changed configuration")
    return warnings, rows


# ----------------------------------------------------------------------------
# Top level
# ----------------------------------------------------------------------------
@dataclass
class DeltaReport:
    before: str
    after: str
    rules: List[RuleDelta] = field(default_factory=list)
    tools: List[Dict[str, Any]] = field(default_factory=list)
    not_compared: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)
    configs: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.warnings

    def totals(self) -> Dict[str, int]:
        return {
            "new": sum(len(r.new) for r in self.rules),
            "absent": sum(len(r.absent) for r in self.rules),
            "unchanged": sum(r.unchanged for r in self.rules),
            "moved": sum(r.moved for r in self.rules),
            "unchanged_now_suppressed": sum(r.newly_suppressed for r in self.rules),
            "new_suppressed": sum(1 for r in self.rules for x in r.new if x.suppressed),
            "absent_were_suppressed": sum(1 for r in self.rules for x in r.absent if x.suppressed),
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "before": self.before, "after": self.after, "valid": self.valid,
            "totals": self.totals(), "tools": self.tools,
            "rules": [r.to_dict() for r in self.rules],
            "not_compared": self.not_compared, "configs": self.configs,
            "warnings": self.warnings, "notes": self.notes,
        }


def compute_delta(before: SarifSide, after: SarifSide) -> DeltaReport:
    report = DeltaReport(before=before.path, after=after.path)
    for side in (before, after):
        if side.sarif_version != SARIF_VERSION:
            report.warnings.append(f"{side.path}: SARIF version is '{side.sarif_version or '?'}', "
                                   f"expected {SARIF_VERSION}")
    for key in sorted(set(before.tools) | set(after.tools)):
        tb, ta = before.tools.get(key), after.tools.get(key)
        if tb is None or ta is None:
            present = tb or ta
            assert present is not None
            missing_side = "after" if ta is None else "before"
            report.warnings.append(
                f"{present.name}: tool missing from the {missing_side} log; its "
                f"{len(present.results)} result(s) were not compared (they are not 'absent' or 'new')")
            report.not_compared.append({"tool": present.name, "missing_from": missing_side,
                                        "results": len(present.results)})
            continue
        warns, notes = compare_tool(tb, ta)
        report.warnings.extend(warns)
        report.notes.extend(notes)
        by_rule_b: Dict[str, List[Result]] = defaultdict(list)
        by_rule_a: Dict[str, List[Result]] = defaultdict(list)
        for r in tb.results:
            by_rule_b[r.rule_id].append(r)
        for r in ta.results:
            by_rule_a[r.rule_id].append(r)
        tool_rules = [diff_rule(tb.name, rule, by_rule_b.get(rule, []), by_rule_a.get(rule, []))
                      for rule in sorted(set(by_rule_b) | set(by_rule_a))]
        report.rules.extend(tool_rules)
        bases = sorted({r.basis.split("(")[0] for r in tool_rules})
        report.tools.append({
            "tool": tb.name, "before_version": _fmt_versions(tb.versions),
            "after_version": _fmt_versions(ta.versions),
            "results_before": len(tb.results), "results_after": len(ta.results),
            "match_basis": bases,
        })
        ambiguous = sum(r.ambiguous_keys for r in tool_rules if r.basis == "message")
        if ambiguous:
            report.notes.append(
                f"{tb.name}: {ambiguous} message-matched key(s) occur more than once in a file; "
                "inside those groups results are matched by count, so a fix and a new identical "
                "result in the same file cancel out. Emit snippets or fingerprints to avoid this.")
        if any(r.basis.startswith("fingerprint") for r in tool_rules):
            report.notes.append(
                f"{tb.name}: line-hash fingerprints can turn a moved or edited-but-unchanged issue "
                "into absent+new after large refactors (G204-F12); say so next to the delta.")
    report.notes.append("An absent result may have been suppressed in source or excluded by "
                        "configuration rather than fixed: cross-check with diff_guard.py "
                        "(new suppressions, config weakening) before calling it fixed.")
    return report


def render_text(report: DeltaReport, max_list: int) -> str:
    lines = [f"sarif_delta: {report.before} -> {report.after}"]
    if report.valid:
        lines.append("VALID comparison (same tools, versions and visible rule configuration)")
    else:
        lines.append(f"NOT VALID as improvement evidence: {len(report.warnings)} comparability "
                     "warning(s) below")
    for tool in report.tools:
        lines.append("")
        lines.append(f"tool {tool['tool']}  version {tool['before_version']} -> "
                     f"{tool['after_version']}  match basis: {', '.join(tool['match_basis']) or '-'}")
        rows = [r for r in report.rules if r.tool == tool["tool"]]
        width = max([len(r.rule) for r in rows] + [4])
        lines.append(f"  {'rule':<{width}}  {'new':>5} {'absent':>7} {'unchanged':>10} {'moved':>6}"
                     f"  suppressed(new/absent/now)")
        for r in rows:
            d = r.to_dict(with_lists=False)
            lines.append(f"  {r.rule:<{width}}  {d['new']:>5} {d['absent']:>7} {d['unchanged']:>10} "
                         f"{d['moved']:>6}  {d['new_suppressed']}/{d['absent_were_suppressed']}/"
                         f"{d['unchanged_now_suppressed']}")
    totals = report.totals()
    lines.append("")
    lines.append(f"totals: new {totals['new']}, absent {totals['absent']}, unchanged "
                 f"{totals['unchanged']} (moved {totals['moved']}); suppressed: new "
                 f"{totals['new_suppressed']}, unchanged but now suppressed "
                 f"{totals['unchanged_now_suppressed']}")
    for title, attr in (("new results", "new"), ("absent results", "absent")):
        items = [x for r in report.rules for x in getattr(r, attr)]
        if not items:
            continue
        lines.append("")
        lines.append(f"{title} ({len(items)}):")
        for x in items[:max_list]:
            flag = " [suppressed]" if x.suppressed else ""
            lines.append(f"  {x.tool} {x.rule_id} {x.location()}{flag}  {x.message[:120]}")
        if len(items) > max_list:
            lines.append(f"  ... {len(items) - max_list} more (use --json)")
    if report.configs:
        lines.append("")
        lines.append("config files:")
        for row in report.configs:
            state = "same" if row["same"] else "DIFFERENT or missing"
            lines.append(f"  {row['config']}: {state}")
    if report.warnings:
        lines.append("")
        lines.append("warnings:")
        lines.extend(f"  - {w}" for w in report.warnings)
    if report.notes:
        lines.append("")
        lines.append("notes:")
        lines.extend(f"  - {n}" for n in report.notes)
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(
        description="Compare two SARIF logs by fingerprint: new / absent / unchanged per rule.")
    parser.add_argument("before", help="SARIF log of the baseline run")
    parser.add_argument("after", help="SARIF log of the later run")
    parser.add_argument("--json", action="store_true", help="print a JSON report")
    parser.add_argument("--before-root", help="checkout directory analysed by the before run")
    parser.add_argument("--after-root", help="checkout directory analysed by the after run")
    parser.add_argument("--repo", help="git repository holding the config files (with --config)")
    parser.add_argument("--base", help="revision the before run analysed (with --config)")
    parser.add_argument("--head", help="revision the after run analysed (default: working tree)")
    parser.add_argument("--config", action="append", default=[],
                        help="repository-relative config file to compare (repeatable)")
    parser.add_argument("--max-list", type=int, default=DEFAULT_MAX_LIST,
                        help=f"text output: list at most N new and N absent results "
                             f"(default {DEFAULT_MAX_LIST})")
    args = parser.parse_args(argv)
    if args.config and not (args.repo and args.base):
        parser.error("--config needs --repo and --base")
    try:
        before = load_sarif(Path(args.before), args.before_root)
        after = load_sarif(Path(args.after), args.after_root)
        report = compute_delta(before, after)
        if args.config:
            warns, rows = compare_configs(Path(args.repo).resolve(), args.base, args.head,
                                          args.config)
            report.warnings.extend(warns)
            report.configs = rows
        else:
            report.notes.append("Rule configuration is only partly visible in SARIF; pass "
                                "--repo/--base/--config to compare the config files by hash.")
    except SarifError as exc:
        if args.json:
            print(json.dumps({"valid": False, "unreadable": str(exc)}, indent=2))
        else:
            print(f"ERROR   {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(report.to_dict(), indent=2, ensure_ascii=False))
    else:
        print(render_text(report, max(0, args.max_list)))
    return 0 if report.valid else 1


if __name__ == "__main__":
    sys.exit(main())
