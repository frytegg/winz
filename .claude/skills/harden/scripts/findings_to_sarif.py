#!/usr/bin/env python3
"""Convert a harden findings file into the SARIF 2.1.0 companion `.harden/report.sarif`.

Purpose
    Reporting RP-19 asks for a SARIF 2.1.0 log that mirrors every reported finding and keeps
    the raw tool evidence next to it (final-report-and-impact G204-F11, G204-F12). This script
    writes one log with:

      runs[0]  the harden findings, under a synthetic `tool.driver` named "harden":
               - driver.version / semanticVersion from the SKILL.md frontmatter (`version:` or
                 `metadata: version:`), else "0.0.0";
               - driver.rules: one rule per distinct `rule_ref`, titled from the matching
                 `### <ID> — <title>` heading in references/*.md (project:<tool>/<rule> refs are
                 described as that tool's rule);
               - one result per finding: ruleId/ruleIndex, level from severity (critical/high
                 -> error, medium -> warning, low/nit -> note), message = title, a physical
                 location (repo-relative uri under uriBaseId %SRCROOT%, startLine/endLine),
                 partialFingerprints, a properties bag (id, lens, tier, class, severity,
                 severity_criterion, confidence, status, fix_risk, evidence, commit, cwe,
                 threshold_source and the other optional provenance fields when set) and
                 baselineState when the finding has baseline_state;
               - rejected findings keep their result and get a suppression
                 {kind: external, status: accepted, justification: verifier_note (else notes)}
                 (reporting RP-17: "suppressed, not fixed" must never read as absent);
               - invocations[0]: executionSuccessful true, toolExecutionNotifications (every
                 conversion warning, level "warning"), properties.tool_versions.
      runs[1:] every run of every --tool-sarif file, appended unchanged, in argument order.
               Warnings (never edits) for: a SARIF version other than 2.1.0, top-level keys
               that cannot be carried over, a missing driver name, a driver named "harden",
               invocations that failed or do not record executionSuccessful (Limits, RP-09),
               results without fingerprints, a driver version that differs from the findings
               tool_versions pin (RP-11), and more than 20 runs (GitHub's upload limit).

    partialFingerprints (one key per result, never mixed inside a result):
      hardenFingerprint/v1  the finding's own `fingerprint` when it has one;
      hardenLineHash/v1     else sha256("<rule_ref>\\0<path>\\0<trimmed source line>") where the
                            line is read at base_sha (locations refer to base_sha; applied fixes
                            move lines in the working tree), falling back to the working tree;
                            needs a repository (--repo, or the parent of `.harden/`);
      hardenTitleHash/v1    else sha256("<rule_ref>\\0<path>\\0<whitespace-collapsed title>"),
                            with a warning. No source text is copied into the log.

    The findings file is validated first with validate_findings.py (structure and semantics,
    no repository checks); an invalid file is not converted unless --no-validate is given.
    The output is deterministic for identical inputs (no wall-clock timestamps).

CLI
    python findings_to_sarif.py <findings.json> --out FILE [--tool-sarif FILE ...]
                                [--repo DIR | --no-repo] [--no-validate]
    (use python3 on macOS/Linux; also runs under `python -S`)
    --tool-sarif  SARIF logs to append (repeatable, several files per flag). A pattern such as
                  .harden/tools/*.sarif is expanded here when the shell did not (PowerShell);
                  a pattern matching nothing is a warning, a missing plain path an error.
    --repo        repository root the finding paths are relative to (line hashes). Default:
                  the parent of `.harden/` when the findings file sits there.
    --no-repo     do not read source lines (fingerprints fall back to the title hash).
    --no-validate convert even when validate_findings.py reports errors.

Exit codes
    0  SARIF written (warnings, if any, are on stderr and in the log's notifications)
    1  the findings file is invalid (validate_findings.py errors); nothing written
    2  unreadable input (findings file, a --tool-sarif file that is missing, not UTF-8 JSON or
       not a SARIF log), a bad --repo, an --out that names an input, or a write error
"""
from __future__ import annotations

import argparse
import copy
import glob as globmod
import hashlib
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))

import _common as C  # noqa: E402  (sibling module, path set above)
import validate_findings as vf  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parent.parent
SARIF_VERSION = "2.1.0"
SARIF_SCHEMA = "https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json"
DRIVER_NAME = "harden"
FALLBACK_VERSION = "0.0.0"  # SemVer placeholder when SKILL.md declares no version
SRCROOT = "%SRCROOT%"
FP_FINDING = "hardenFingerprint/v1"
FP_LINE = "hardenLineHash/v1"
FP_TITLE = "hardenTitleHash/v1"
# GitHub code scanning accepts at most 20 runs per uploaded file (polyglot-tooling dossier).
GITHUB_MAX_RUNS = 20

SEVERITY_LEVELS: Dict[str, str] = {
    "critical": "error", "high": "error", "medium": "warning", "low": "note", "nit": "note",
}
# Finding fields copied into result.properties when present (RP-19 plus the provenance fields).
PROPERTY_FIELDS: Tuple[str, ...] = (
    "id", "lens", "tier", "class", "severity", "severity_criterion", "confidence", "status",
    "fix_risk", "evidence", "commit", "cwe", "threshold_source",
    "verified", "location_class", "blocking", "unblock_condition", "conditions",
    "quality_characteristic", "seen_in_passes", "pass_ids", "verifier_id", "exclusion_class",
    "notes",
)
RULE_HEADING_RE = re.compile(
    r"^###\s+([A-Z][A-Z0-9]{1,3}-[0-9]{2,3})\s+[—–-]+\s+(.+?)\s*$")
SEMVER_RE = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$")
GLOB_CHARS = frozenset("*?[")
SARIF_TOP_KEYS = frozenset({"$schema", "version", "runs"})


class InputError(Exception):
    """An input file is unreadable or not what it should be (exit code 2)."""


# ----------------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------------
def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def normalise_path(path: str) -> str:
    """Forward slashes, no './' or empty segments (finding paths are already repo-relative)."""
    parts = [p for p in C.to_posix(path).split("/") if p not in ("", ".")]
    return "/".join(parts)


def line_hash(rule_ref: str, path: str, text: str) -> str:
    """hardenLineHash/v1: sha256 of rule_ref, normalised path and the trimmed line text."""
    return _sha256(f"{rule_ref}\0{normalise_path(path)}\0{text.strip()}")


def title_hash(rule_ref: str, path: str, title: str) -> str:
    """hardenTitleHash/v1: fallback when no source line can be read."""
    return _sha256(f"{rule_ref}\0{normalise_path(path)}\0{' '.join(title.split())}")


def notification(text: str) -> Dict[str, Any]:
    """A warning-level SARIF notification (never error level: sarif_delta.py reads those as
    failed tool runs)."""
    return {"level": "warning", "message": {"text": text}}


# ----------------------------------------------------------------------------
# Skill metadata: version and rule titles
# ----------------------------------------------------------------------------
def _yaml_scalar(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1].strip()
    return value.split(" #", 1)[0].strip()


def skill_version(skill_md: Path) -> Optional[str]:
    """`version` from the SKILL.md frontmatter, top level or under `metadata:`; None if absent."""
    try:
        text = skill_md.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return None
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    in_metadata = False
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.match(r"^(\s*)([A-Za-z0-9_-]+)\s*:\s*(.*)$", line)
        if not match:
            continue
        indent, key, value = len(match.group(1)), match.group(2), _yaml_scalar(match.group(3))
        if indent == 0:
            in_metadata = key == "metadata" and value == ""
            if key == "version" and value:
                return value
        elif in_metadata and key == "version" and value:
            return value
    return None


def rule_catalogue(skill_dir: Path) -> Dict[str, Tuple[str, str]]:
    """Map skill rule id -> (title, 'references/<file>.md') from the rule block headings."""
    catalogue: Dict[str, Tuple[str, str]] = {}
    refs = skill_dir / "references"
    if not refs.is_dir():
        return catalogue
    for md in sorted(refs.glob("*.md")):
        try:
            text = md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            match = RULE_HEADING_RE.match(line)
            if match and match.group(1) not in catalogue:
                catalogue[match.group(1)] = (match.group(2), f"references/{md.name}")
    return catalogue


# ----------------------------------------------------------------------------
# Source lines for hardenLineHash/v1
# ----------------------------------------------------------------------------
class SourceLines:
    """Reads a file's lines at base_sha (git show) or, failing that, from the working tree."""

    def __init__(self, repo: Path, base_sha: Optional[str], warnings: List[str]):
        self.repo = repo
        self.base: Optional[str] = None
        self._cache: Dict[Tuple[str, str], Optional[List[str]]] = {}
        is_git = C.git_available() and C.git_ok(repo, ["rev-parse", "--is-inside-work-tree"]) == "true"
        if is_git and base_sha:
            if C.git_ok(repo, ["cat-file", "-e", f"{base_sha}^{{commit}}"]) is not None:
                self.base = base_sha
            else:
                warnings.append(f"base_sha {base_sha} is not a commit in {repo.as_posix()}; line "
                                "hashes were read from the working tree, where applied fixes "
                                "may have moved lines")

    @property
    def revision(self) -> str:
        return self.base if self.base else "worktree"

    @staticmethod
    def _split(data: bytes) -> List[str]:
        text = data.decode("utf-8", errors="replace")
        if text.startswith("\ufeff"):
            text = text[1:]
        lines = text.split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        return lines

    def _load(self, where: str, rel: str) -> Optional[List[str]]:
        key = (where, rel)
        if key not in self._cache:
            data: Optional[bytes] = None
            if where == "base" and self.base:
                try:
                    data = C.git_bytes(self.repo, ["show", f"{self.base}:./{rel}"])
                except C.GitError:
                    data = None
            elif where == "worktree":
                path = self.repo / rel
                try:
                    data = path.read_bytes() if path.is_file() else None
                except OSError:
                    data = None
            self._cache[key] = self._split(data) if data is not None else None
        return self._cache[key]

    def line(self, rel: str, number: int) -> Tuple[Optional[str], str]:
        """(line text or None, where it was read: 'base' or 'worktree').

        base_sha first, because finding locations refer to it; the working tree when the file
        or the line does not exist there (validate_findings.py --at auto accepts either)."""
        for where in ("base", "worktree"):
            if where == "base" and not self.base:
                continue
            lines = self._load(where, rel)
            if lines is not None and 1 <= number <= len(lines):
                return lines[number - 1], where
        return None, "worktree"


# ----------------------------------------------------------------------------
# Tool SARIF inputs
# ----------------------------------------------------------------------------
@dataclass
class ToolLog:
    """A --tool-sarif file: its runs are appended unchanged."""

    path: str
    runs: List[Any]
    version: str
    dropped_keys: List[str] = field(default_factory=list)


def load_tool_sarif(path: Path) -> ToolLog:
    """Read a SARIF log (UTF-8, BOM accepted). Raises InputError when it is not one."""
    try:
        doc = vf.load_json(path)
    except vf.UnreadableInput as exc:
        raise InputError(str(exc)) from exc
    if not isinstance(doc, dict) or not isinstance(doc.get("runs"), list):
        raise InputError(f"{path.as_posix()} is not a SARIF log (no top-level 'runs' array)")
    dropped = sorted(k for k in doc if k not in SARIF_TOP_KEYS)
    return ToolLog(path=path.as_posix(), runs=doc["runs"], version=_str(doc.get("version")),
                   dropped_keys=dropped)


def expand_tool_paths(args: Sequence[str], warnings: List[str]) -> List[Path]:
    """Expand patterns the shell left alone; a plain path that is missing raises InputError."""
    out: List[Path] = []
    for arg in args:
        if Path(arg).exists() or not (set(arg) & GLOB_CHARS):
            if not Path(arg).is_file():
                raise InputError(f"--tool-sarif {arg}: no such file")
            out.append(Path(arg))
            continue
        matches = sorted(m for m in globmod.glob(arg) if Path(m).is_file())
        if not matches:
            warnings.append(f"--tool-sarif pattern '{arg}' matched no file; no tool run added "
                            "from it")
        out.extend(Path(m) for m in matches)
    return out


def run_problems(run: Any, where: str, require_locations: bool,
                 require_fingerprints: Optional[bool] = None) -> List[str]:
    """Structural problems of one SARIF run (the parts reporting RP-19 and sarif_delta rely on).

    require_fingerprints defaults to require_locations (both hold for the harden run)."""
    if require_fingerprints is None:
        require_fingerprints = require_locations
    if not isinstance(run, dict):
        return [f"{where} is not an object"]
    problems: List[str] = []
    tool = run.get("tool")
    driver = tool.get("driver") if isinstance(tool, dict) else None
    if not isinstance(driver, dict) or not _str(driver.get("name")).strip():
        problems.append(f"{where}.tool.driver.name is missing")
    results = run.get("results")
    if results is None:
        return problems
    if not isinstance(results, list):
        return problems + [f"{where}.results is not an array"]
    for i, result in enumerate(results):
        rw = f"{where}.results[{i}]"
        if not isinstance(result, dict):
            problems.append(f"{rw} is not an object")
            continue
        message = result.get("message")
        if not isinstance(message, dict) or not (_str(message.get("text")) or _str(message.get("id"))):
            problems.append(f"{rw}.message has neither text nor id")
        locations = result.get("locations")
        if locations is not None and not isinstance(locations, list):
            problems.append(f"{rw}.locations is not an array")
        elif require_locations and not locations:
            problems.append(f"{rw}.locations is missing or empty")
        if require_fingerprints and not (isinstance(result.get("partialFingerprints"), dict)
                                         and result["partialFingerprints"]):
            problems.append(f"{rw}.partialFingerprints is missing")
    return problems


def sarif_problems(log: Any, require_locations_for: Sequence[str] = (DRIVER_NAME,)) -> List[str]:
    """Structural check of a whole log: version, $schema, runs, driver names, result locations."""
    if not isinstance(log, dict):
        return ["the log is not a JSON object"]
    problems: List[str] = []
    if log.get("version") != SARIF_VERSION:
        problems.append(f"version is {log.get('version')!r}, expected '{SARIF_VERSION}'")
    schema = log.get("$schema")
    if not (isinstance(schema, str) and schema.startswith("https://")):
        problems.append("$schema is missing or not an https URL")
    runs = log.get("runs")
    if not isinstance(runs, list):
        return problems + ["runs is not an array"]
    for i, run in enumerate(runs):
        name = ""
        if isinstance(run, dict) and isinstance(run.get("tool"), dict) \
                and isinstance(run["tool"].get("driver"), dict):
            name = _str(run["tool"]["driver"].get("name"))
        problems.extend(run_problems(run, f"runs[{i}]", name in require_locations_for))
    return problems


def tool_run_notes(run: Any, where: str) -> List[str]:
    """Report-relevant gaps of an appended tool run: failed or unrecorded invocations (they go
    under Limits, reporting RP-09) and results without fingerprints (RP-19's check counts them;
    sarif_delta.py then matches that rule by snippet or message)."""
    if not isinstance(run, dict):
        return []
    name = _str(_driver(run).get("name")) or "<unnamed>"
    notes: List[str] = []
    invocations = run.get("invocations")
    if not isinstance(invocations, list) or not invocations:
        notes.append(f"{where} ({name}) has no invocation record, so its success is unknown; "
                     "say so under Limits (RP-09)")
    else:
        failed = sum(1 for inv in invocations
                     if isinstance(inv, dict) and inv.get("executionSuccessful") is False)
        unknown = sum(1 for inv in invocations
                      if not isinstance(inv, dict) or not isinstance(inv.get("executionSuccessful"), bool))
        if failed:
            notes.append(f"{where} ({name}): {failed} invocation(s) have executionSuccessful=false; "
                         "name the tool under Limits (RP-09)")
        if unknown:
            notes.append(f"{where} ({name}): {unknown} invocation(s) do not record "
                         "executionSuccessful")
    results = run.get("results") if isinstance(run.get("results"), list) else []
    bare = sum(1 for r in results if isinstance(r, dict)
               and not r.get("partialFingerprints") and not r.get("fingerprints"))
    if bare:
        notes.append(f"{where} ({name}): {bare} of {len(results)} result(s) carry no fingerprints; "
                     "sarif_delta.py matches them by snippet or message text")
    return notes


def _driver(run: Any) -> Dict[str, Any]:
    if isinstance(run, dict) and isinstance(run.get("tool"), dict) \
            and isinstance(run["tool"].get("driver"), dict):
        return run["tool"]["driver"]
    return {}


def _norm_tool(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def check_tool_versions(log: ToolLog, tool_versions: Dict[str, Any], warnings: List[str]) -> None:
    """Warn when an appended tool's driver version disagrees with findings tool_versions
    (reporting RP-11: deltas need identical pinned versions; G201-F12)."""
    pinned = {_norm_tool(k): (k, v) for k, v in tool_versions.items() if isinstance(v, str)}
    for i, run in enumerate(log.runs):
        driver = _driver(run)
        name = _str(driver.get("name"))
        if not name:
            continue
        key = _norm_tool(name)
        match = pinned.get(key)
        if match is None:
            candidates = [v for k, v in pinned.items() if k and key and (k in key or key in k)]
            match = candidates[0] if len(candidates) == 1 else None
        if match is None:
            warnings.append(f"{log.path} runs[{i}]: tool '{name}' has no pinned version in the "
                            "findings tool_versions (tool claims need a recorded version)")
            continue
        pinned_name, pinned_version = match
        versions = {_str(driver.get("version")), _str(driver.get("semanticVersion"))} - {""}
        if versions and pinned_version not in versions:
            warnings.append(f"{log.path} runs[{i}]: tool '{name}' reports version "
                            f"{', '.join(sorted(versions))} but tool_versions pins "
                            f"{pinned_name} {pinned_version}")


# ----------------------------------------------------------------------------
# The harden run
# ----------------------------------------------------------------------------
def _rule_entry(rule_ref: str, catalogue: Dict[str, Tuple[str, str]],
                tool_versions: Dict[str, Any], tags: List[str]) -> Dict[str, Any]:
    props: Dict[str, Any] = {}
    match = vf.PROJECT_RULE_RE.match(rule_ref)
    if match:
        tool, rule = match.group("tool"), match.group("rule")
        text = f"{tool} rule {rule}, verified and reported by harden"
        props["source"] = "project-tool"
        props["tool"] = tool
        version = {k.lower(): v for k, v in tool_versions.items()}.get(tool.lower())
        if isinstance(version, str):
            props["tool_version"] = version
        help_text = f"See the {tool} documentation for rule {rule}."
    elif rule_ref in catalogue:
        title, reference = catalogue[rule_ref]
        text = title
        props["source"] = "harden-skill"
        props["reference"] = reference
        help_text = f"harden skill rule {rule_ref}: {reference}"
    else:
        text = f"harden rule {rule_ref}"
        props["source"] = "harden-skill"
        help_text = f"harden skill rule {rule_ref} (not found in the skill's references/)"
    if tags:
        props["tags"] = tags
    return {"id": rule_ref, "shortDescription": {"text": text}, "help": {"text": help_text},
            "properties": props}


def _result_tags(f: Dict[str, Any]) -> List[str]:
    tags: List[str] = []
    if _str(f.get("lens")):
        tags.append(f["lens"])
    cwe = _str(f.get("cwe"))
    if re.match(r"^CWE-[0-9]+$", cwe):
        tags.append("external/cwe/cwe-" + cwe.split("-", 1)[1])
    return tags


def build_harden_run(doc: Dict[str, Any], repo: Optional[Path], skill_dir: Path,
                     warnings: List[str]) -> Dict[str, Any]:
    """The run holding the harden findings (runs[0] of report.sarif)."""
    raw_findings = doc.get("findings") if isinstance(doc.get("findings"), list) else []
    findings = [f for f in raw_findings if isinstance(f, dict)]
    if len(findings) != len(raw_findings):
        warnings.append(f"{len(raw_findings) - len(findings)} finding(s) are not objects and "
                        "were skipped")
    tool_versions = doc.get("tool_versions") if isinstance(doc.get("tool_versions"), dict) else {}
    base_sha = _str(doc.get("base_sha")) or None

    version = skill_version(skill_dir / "SKILL.md")
    driver: Dict[str, Any] = {"name": DRIVER_NAME}
    if version is None:
        driver["version"] = FALLBACK_VERSION
        driver["semanticVersion"] = FALLBACK_VERSION
    else:
        driver["version"] = version
        if SEMVER_RE.match(version):
            driver["semanticVersion"] = version
        else:
            warnings.append(f"SKILL.md version '{version}' is not SemVer 2.0; "
                            "driver.semanticVersion omitted")

    rule_refs = sorted({_str(f.get("rule_ref")) or "harden-unclassified" for f in findings})
    catalogue = rule_catalogue(skill_dir) if any(vf.SKILL_RULE_RE.match(r) for r in rule_refs) else {}
    tags_by_rule: Dict[str, set] = {r: set() for r in rule_refs}
    for f in findings:
        tags_by_rule[_str(f.get("rule_ref")) or "harden-unclassified"].update(_result_tags(f))
    driver["rules"] = [_rule_entry(r, catalogue, tool_versions, sorted(tags_by_rule[r]))
                       for r in rule_refs]
    rule_index = {r: i for i, r in enumerate(rule_refs)}

    sources = SourceLines(repo, base_sha, warnings) if repo is not None else None
    no_location: List[str] = []   # title hash: the finding has no file:line
    no_repo: List[str] = []       # title hash: no repository to read the line from
    no_line: List[str] = []       # title hash: the line could not be read
    no_justification: List[str] = []
    results: List[Dict[str, Any]] = []
    for index, f in enumerate(findings):
        fid = _str(f.get("id")) or f"finding[{index}]"
        rule_ref = _str(f.get("rule_ref")) or "harden-unclassified"
        title = _str(f.get("title")).strip() or f"{rule_ref} finding"
        path = normalise_path(_str(f.get("file")))
        line = f.get("line") if _is_int(f.get("line")) and f.get("line") >= 1 else None
        end_line = f.get("end_line") if _is_int(f.get("end_line")) else None

        result: Dict[str, Any] = {
            "ruleId": rule_ref,
            "ruleIndex": rule_index[rule_ref],
            "level": SEVERITY_LEVELS.get(_str(f.get("severity")), "warning"),
            "message": {"text": title},
        }
        if path:
            physical: Dict[str, Any] = {
                "artifactLocation": {"uri": quote(path, safe="/"), "uriBaseId": SRCROOT}}
            if line is not None:
                region: Dict[str, Any] = {"startLine": line}
                if end_line is not None and end_line >= line:
                    region["endLine"] = end_line
                physical["region"] = region
            result["locations"] = [{"physicalLocation": physical}]
        else:
            result["locations"] = []
            warnings.append(f"{fid}: no file, so the SARIF result has no location")

        # partialFingerprints: the finding's own fingerprint, else a line hash, else a title hash.
        fingerprint = _str(f.get("fingerprint")).strip()
        if fingerprint:
            result["partialFingerprints"] = {FP_FINDING: fingerprint}
            basis = "finding"
        else:
            text: Optional[str] = None
            where = "worktree"
            if not path or line is None:
                no_location.append(fid)
            elif sources is None:
                no_repo.append(fid)
            else:
                text, where = sources.line(path, line)
                if text is None:
                    no_line.append(f"{fid} ({path}:{line})")
            if text is not None and sources is not None:
                result["partialFingerprints"] = {FP_LINE: line_hash(rule_ref, path, text)}
                basis = "line-hash@" + (sources.revision if where == "base" else "worktree")
            else:
                result["partialFingerprints"] = {FP_TITLE: title_hash(rule_ref, path, title)}
                basis = "title-hash"

        props: Dict[str, Any] = {}
        for key in PROPERTY_FIELDS:
            if f.get(key) is not None:
                props[key] = copy.deepcopy(f[key])
        props["fingerprint_basis"] = basis
        tags = _result_tags(f)
        if tags:
            props["tags"] = tags
        result["properties"] = props

        state = _str(f.get("baseline_state"))
        if state:
            result["baselineState"] = state
        if f.get("status") == "rejected":
            suppression: Dict[str, Any] = {"kind": "external", "status": "accepted"}
            justification = _str(f.get("verifier_note")).strip() or _str(f.get("notes")).strip()
            if justification:
                suppression["justification"] = justification
            else:
                no_justification.append(fid)
            if _str(f.get("exclusion_class")):
                suppression["properties"] = {"exclusion_class": f["exclusion_class"]}
            result["suppressions"] = [suppression]
        results.append(result)

    for ids, reason in (
            (no_repo, "no repository to read their line from (pass --repo)"),
            (no_line, "a file:line that could not be read at base_sha or in the working tree"),
            (no_location, "no file:line")):
        if ids:
            warnings.append(f"{len(ids)} finding(s) have no fingerprint and {reason}; they use "
                            f"{FP_TITLE}, which breaks when the title is edited: "
                            + ", ".join(ids[:10]) + (" ..." if len(ids) > 10 else ""))
    if no_justification:
        warnings.append("rejected finding(s) without verifier_note or notes, so their "
                        f"suppression has no justification (reporting RP-17): "
                        f"{', '.join(no_justification[:10])}")
    with_state = sum(1 for r in results if "baselineState" in r)
    if 0 < with_state < len(results):
        warnings.append(f"{len(results) - with_state} of {len(results)} result(s) have no "
                        "baseline_state; the final run sets baselineState on every result "
                        "(reporting RP-19)")

    run: Dict[str, Any] = {
        "tool": {"driver": driver},
        "invocations": [{
            "executionSuccessful": True,
            "toolExecutionNotifications": [],
            "properties": {"tool_versions": copy.deepcopy(tool_versions)},
        }],
        "originalUriBaseIds": {SRCROOT: {"description": {
            "text": "Root of the analysed repository; finding paths are relative to it at "
                    "base_sha"}}},
        "results": results,
        "properties": {
            "base_sha": base_sha,
            "generated": doc.get("generated"),
            "findings_version": doc.get("version"),
            "fingerprint_revision": (sources.revision if sources is not None else None),
        },
    }
    return run


# ----------------------------------------------------------------------------
# Whole conversion
# ----------------------------------------------------------------------------
@dataclass
class Conversion:
    """The SARIF log plus what the CLI reports."""

    log: Dict[str, Any]
    warnings: List[str]
    counts: Dict[str, int]


def convert(doc: Dict[str, Any], tool_logs: Sequence[ToolLog], repo: Optional[Path] = None,
            skill_dir: Path = SKILL_DIR, warnings: Optional[List[str]] = None) -> Conversion:
    """Build the report.sarif log from a parsed findings document and loaded tool logs.

    `warnings` seeds the list (e.g. argument-expansion warnings from the CLI); every warning
    ends up in the harden invocation's toolExecutionNotifications."""
    warnings = list(warnings or [])
    harden = build_harden_run(doc, repo, skill_dir, warnings)
    runs: List[Any] = [harden]
    tool_versions = doc.get("tool_versions") if isinstance(doc.get("tool_versions"), dict) else {}
    for log in tool_logs:
        if log.version != SARIF_VERSION:
            warnings.append(f"{log.path}: SARIF version is '{log.version or '?'}', expected "
                            f"{SARIF_VERSION}; its runs are appended unchanged")
        if log.dropped_keys:
            warnings.append(f"{log.path}: top-level {', '.join(log.dropped_keys)} not carried "
                            "over (only runs are appended)")
        for i, run in enumerate(log.runs):
            for problem in run_problems(run, f"runs[{i}]", require_locations=False):
                warnings.append(f"{log.path}: {problem}")
            for note in tool_run_notes(run, f"runs[{i}]"):
                warnings.append(f"{log.path} {note}")
            if _str(_driver(run).get("name")).lower() == DRIVER_NAME:
                warnings.append(f"{log.path} runs[{i}]: driver name '{DRIVER_NAME}' collides with "
                                "the synthetic harden run; sarif_delta.py merges runs by name")
        check_tool_versions(log, tool_versions, warnings)
        runs.extend(log.runs)
    if len(runs) > GITHUB_MAX_RUNS:
        warnings.append(f"{len(runs)} runs; GitHub code scanning accepts at most "
                        f"{GITHUB_MAX_RUNS} runs per uploaded file")
    harden["invocations"][0]["toolExecutionNotifications"] = [notification(w) for w in warnings]
    log_doc: Dict[str, Any] = {"$schema": SARIF_SCHEMA, "version": SARIF_VERSION, "runs": runs}
    results = harden["results"]
    counts = {
        "results": len(results),
        "rules": len(harden["tool"]["driver"]["rules"]),
        "suppressed": sum(1 for r in results if r.get("suppressions")),
        "with_baseline_state": sum(1 for r in results if "baselineState" in r),
        "tool_runs": len(runs) - 1,
        "tool_files": len(tool_logs),
    }
    return Conversion(log=log_doc, warnings=warnings, counts=counts)


def _same_file(a: Path, b: Path) -> bool:
    try:
        return a.resolve() == b.resolve()
    except OSError:
        return False


def main(argv: Optional[List[str]] = None) -> int:
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        description="Write the SARIF 2.1.0 companion of a harden findings file (reporting RP-19).")
    parser.add_argument("findings", help="path to findings.json (or candidates.json)")
    parser.add_argument("--out", required=True, help="SARIF file to write, e.g. .harden/report.sarif")
    parser.add_argument("--tool-sarif", nargs="+", action="extend", default=[], metavar="FILE",
                        help="tool SARIF log(s) appended unchanged as extra runs (repeatable; "
                             "patterns are expanded)")
    repo_group = parser.add_mutually_exclusive_group()
    repo_group.add_argument("--repo", help="repository root for line hashes "
                                           "(default: parent of .harden/)")
    repo_group.add_argument("--no-repo", action="store_true",
                            help="do not read source lines; fingerprints fall back to title hashes")
    parser.add_argument("--no-validate", action="store_true",
                        help="convert even when validate_findings.py reports errors")
    args = parser.parse_args(argv)

    findings_path = Path(args.findings)
    out_path = Path(args.out)
    warnings: List[str] = []
    try:
        doc = vf.load_json(findings_path)
        tool_paths = expand_tool_paths(args.tool_sarif, warnings)
        unique: List[Path] = []
        for p in tool_paths:
            if _same_file(p, out_path):
                warnings.append(f"--tool-sarif {p.as_posix()} is the --out file; skipped")
            elif any(_same_file(p, q) for q in unique):
                warnings.append(f"--tool-sarif {p.as_posix()} given twice; appended once")
            else:
                unique.append(p)
        if _same_file(findings_path, out_path):
            raise InputError(f"--out {out_path.as_posix()} is the findings file; refusing to "
                             "overwrite an input")
        tool_logs = [load_tool_sarif(p) for p in unique]
    except vf.UnreadableInput as exc:
        print(f"ERROR   {exc}", file=sys.stderr)
        return 2
    except InputError as exc:
        print(f"ERROR   {exc}", file=sys.stderr)
        return 2

    if not isinstance(doc, dict):
        print(f"ERROR   {findings_path.as_posix()}: must be a JSON object, got "
              f"{type(doc).__name__}", file=sys.stderr)
        return 1
    if not args.no_validate:
        report = vf.validate_document(doc, repo=None)
        if not report.valid:
            print(f"ERROR   {findings_path.as_posix()} is invalid ({len(report.errors)} error(s)); "
                  "fix it (validate_findings.py) or pass --no-validate. Nothing written.",
                  file=sys.stderr)
            for issue in report.errors:
                print("  " + issue.render(), file=sys.stderr)
            return 1

    repo: Optional[Path] = None
    if args.repo:
        repo = Path(args.repo).resolve()
        if not repo.is_dir():
            print(f"ERROR   --repo {args.repo} is not a directory", file=sys.stderr)
            return 2
    elif not args.no_repo:
        repo = vf.default_repo_for(findings_path)

    result = convert(doc, tool_logs, repo=repo, warnings=warnings)
    # Self-check of what this script generated (tool runs are appended unchanged and were
    # already reported as warnings). Locations may be missing only under --no-validate.
    own = [p for p in sarif_problems(result.log, require_locations_for=())
           if not p.startswith("runs[")]
    own += run_problems(result.log["runs"][0], "runs[0]", require_locations=not args.no_validate,
                        require_fingerprints=True)
    if own:
        print("ERROR   internal: the generated SARIF is not well formed: " + "; ".join(own),
              file=sys.stderr)
        return 2
    try:
        C.write_json(out_path, result.log)
    except OSError as exc:
        print(f"ERROR   cannot write {out_path.as_posix()}: {exc}", file=sys.stderr)
        return 2
    counts = result.counts
    print(f"{out_path.as_posix()}: SARIF {SARIF_VERSION} written - harden run: "
          f"{counts['results']} result(s), {counts['rules']} rule(s), {counts['suppressed']} "
          f"suppressed, {counts['with_baseline_state']} with baselineState; "
          f"{counts['tool_runs']} tool run(s) appended from {counts['tool_files']} file(s); "
          f"{len(result.warnings)} warning(s)")
    for warning in result.warnings:
        print(f"WARNING {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
