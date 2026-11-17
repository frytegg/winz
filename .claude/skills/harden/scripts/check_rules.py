#!/usr/bin/env python3
"""Lint the harden skill itself: rule blocks, reference layout and SKILL.md frontmatter.

Purpose
    Every rule in the catalogue must carry a source, a grade and a detection method, and the
    catalogue must never be filled from model memory (skill-design T31-F05). The layout must
    follow the platform limits (T31-F02, T31-F14): SKILL.md at most 500 lines, references
    one level deep, a table of contents in reference files over 100 lines.

    Errors (exit 1):
      references/**/*.md
        - a rule heading that is not exactly "### <PREFIX>-NN — <title>" (em dash);
        - a rule block missing one of the five bullets (Rule, Detect, Not when, the
          Tier/Class/Fix risk/Grade line, Source), an empty bullet, or a bullet given twice;
        - Tier not T0|T1|T2, Class not structural|behavioural|report-only, Fix risk not
          low|medium|high, Grade not A|B|C|D; T0 with a class other than structural;
          class report-only with a tier other than T2 (blueprint section 3);
        - a Source without an https:// URL or without "dossier:"; when research/ holds
          dossiers, a cited dossier slug or finding id that does not exist there;
        - duplicate rule ids in a file, several prefixes in one file, a prefix that differs
          from the blueprint file plan, or one prefix used by two files;
        - a file over 100 lines without "## Contents" before its first rule;
        - a markdown link from a reference file to another reference file.
      SKILL.md
        - missing file, more than 500 lines, missing or unparsable frontmatter;
        - name missing, not lowercase-hyphenated, over 64 characters, or not the directory name;
        - description missing, over 1,024 characters, or description + when_to_use over
          1,536 characters;
        - disable-model-invocation not true;
        - allowed-tools pre-approving bare Bash;
        - a mention of references/*.md, scripts/* or assets/* that does not exist.
    Warnings (exit 0):
        - bullets out of order, rule ids not ascending,
          "## Contents" after line 20, more than 5 ALL-CAPS emphasis words in a file,
          a reference file never mentioned in SKILL.md, a description not in third person,
          T2 with a class other than report-only, dossier pointers not checked because
          research/ is empty;
        - a Source URL that appears nowhere in the dossiers the rule's pointer cites (the rule
          must rest on the verified dossier, T31-F05). The URL may sit in a cited finding, in
          another section of a cited dossier (summary, contradictions, "practitioner voice"),
          or be a GitHub issue/PR whose "#<number>" the dossier names; http/https, another
          #fragment, a trailing slash or www. count as the same URL, and so does a page under
          a cited URL or above it;
        - a finding id cited in the rule block that exists in more than one dossier (G102 and
          G105 ids are shared by two dossiers each) without the dossier pointer naming it
          after a slug;
        - an assets/*.md file over 100 lines without a "## Contents" section.

CLI
    python check_rules.py [skill_dir] [--json]
    (use python3 on macOS/Linux; skill_dir defaults to the directory above scripts/)

Exit codes
    0  no violations (warnings may be present)
    1  at least one violation
    2  skill directory missing or unreadable
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

SKILL_MAX_LINES = 500
DESCRIPTION_MAX = 1024
LISTING_MAX = 1536
NAME_MAX = 64
TOC_THRESHOLD = 100
TOC_EARLY_LINES = 20
CAPS_MAX = 5

TIERS = ("T0", "T1", "T2")
CLASSES = ("structural", "behavioural", "report-only")
FIX_RISKS = ("low", "medium", "high")
GRADES = ("A", "B", "C", "D")
BULLETS: Tuple[str, ...] = ("Rule", "Detect", "Not when", "Tier", "Source")

# Blueprint section 4: expected rule-id prefix per reference file.
EXPECTED_PREFIX: Dict[str, str] = {
    "protocol-preflight.md": "PF", "protocol-change.md": "PC", "detection.md": "DT",
    "prioritization.md": "PZ", "reporting.md": "RP",
    "lens-dead-code.md": "DC", "lens-complexity-design.md": "CX", "lens-duplication.md": "DU",
    "lens-errors-resilience.md": "ER", "lens-ops-config.md": "OP", "lens-concurrency.md": "CC",
    "lens-security.md": "SE", "lens-dependencies.md": "DP", "lens-tests.md": "TQ",
    "lens-types-suppressions.md": "TY", "lens-performance.md": "PE",
    "lens-readability-docs.md": "RD", "lens-architecture.md": "AR",
    "lens-ai-failure-modes.md": "AI", "lens-numeric-money-time.md": "NM", "lens-data.md": "DA",
    "lens-build-ci.md": "CI", "lens-frontend.md": "FE", "lens-web3.md": "W3",
    "lang-typescript.md": "TS", "lang-python.md": "PY", "lang-rust.md": "RS",
    "lang-cpp.md": "CP", "lang-go.md": "GO", "lang-solidity.md": "SO",
}

RULE_HEADING_RE = re.compile(r"^###\s+(?P<id>(?P<prefix>[A-Z][A-Z0-9]{1,3})-(?P<num>\d{2,3}))"
                             r" — (?P<title>\S.*)$")
RULE_LIKE_RE = re.compile(r"^#{1,6}\s+(?P<id>[A-Z][A-Z0-9]{1,3}-\d+)\b")
HEADING_RE = re.compile(r"^#{1,6}\s")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
BULLET_RE = re.compile(r"^- \*\*(?P<label>[^*]+?)(?::\*\*|\*\*:)\s*(?P<rest>.*)$")
TIER_RE = re.compile(r"\*\*Tier(?::\*\*|\*\*:)\s*(?P<v>[^\s·|;,]+)")
CLASS_RE = re.compile(r"\*\*Class(?::\*\*|\*\*:)\s*(?P<v>[^\s·|;,]+)")
RISK_RE = re.compile(r"\*\*Fix risk(?::\*\*|\*\*:)\s*(?P<v>[^\s·|;,]+)")
GRADE_RE = re.compile(r"\*\*Grade(?::\*\*|\*\*:)\s*(?P<v>[^\s·|;,]+)")
HTTPS_RE = re.compile(r"https://[^\s)>\]]+")
INLINE_LINK_RE = re.compile(r"\]\(\s*<?(?P<target>[^)\s>]+)")
REF_DEF_RE = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*<?(?P<target>\S+?)>?(\s|$)")
INLINE_CODE_RE = re.compile(r"`[^`]*`")
FINDING_ID_RE = re.compile(r"^[A-Z]{1,2}\d{2,3}-F\d{2,3}$")
FINDING_ID_ANY_RE = re.compile(r"(?<![A-Za-z0-9-])[A-Z]{1,2}\d{2,3}-F\d{2,3}(?![0-9])")
DOSSIER_FINDING_RE = re.compile(r"^###\s+([A-Z]{1,2}\d{2,3}-F\d{2,3})\b")
SLUG_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
CAPS_WORDS = frozenset({
    "NEVER", "ALWAYS", "MUST", "CRITICAL", "IMPORTANT", "MANDATORY", "REQUIRED", "ONLY",
    "NOT", "DO", "DON'T", "STOP", "WARNING", "NO",
})
NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
# A bundled path mentioned in SKILL.md: bare, or after the ${CLAUDE_SKILL_DIR}/ prefix.
MENTION_RE = re.compile(r"(?:(?<=\}/)|(?<![\w/.$-]))"
                        r"(?P<path>(?:references|scripts|assets)/[A-Za-z0-9_./-]*[A-Za-z0-9_])")


# ----------------------------------------------------------------------------
# Result containers
# ----------------------------------------------------------------------------
@dataclass
class Issue:
    level: str
    file: str
    line: int
    message: str

    def render(self) -> str:
        where = f"{self.file}:{self.line}" if self.line else self.file
        return f"{self.level.upper():<7} {where}  {self.message}"

    def to_dict(self) -> Dict[str, Any]:
        return {"level": self.level, "file": self.file, "line": self.line,
                "message": self.message}


@dataclass
class RuleBlock:
    rule_id: str
    prefix: str
    number: int
    title: str
    line: int
    bullets: Dict[str, Tuple[int, str]] = field(default_factory=dict)
    order: List[str] = field(default_factory=list)
    tier: Optional[str] = None
    cls: Optional[str] = None
    fix_risk: Optional[str] = None
    grade: Optional[str] = None


@dataclass
class FileReport:
    path: str
    lines: int
    rules: List[RuleBlock] = field(default_factory=list)

    def summary(self) -> Dict[str, Any]:
        grades = Counter(r.grade for r in self.rules if r.grade in GRADES)
        tiers = Counter(r.tier for r in self.rules if r.tier in TIERS)
        return {"file": self.path, "lines": self.lines, "rules": len(self.rules),
                "grades": {g: grades.get(g, 0) for g in GRADES},
                "tiers": {t: tiers.get(t, 0) for t in TIERS}}


@dataclass
class LintReport:
    skill_dir: str
    issues: List[Issue] = field(default_factory=list)
    files: List[FileReport] = field(default_factory=list)
    skill_lines: Optional[int] = None

    def error(self, file: str, line: int, message: str) -> None:
        self.issues.append(Issue("error", file, line, message))

    def warn(self, file: str, line: int, message: str) -> None:
        self.issues.append(Issue("warning", file, line, message))

    @property
    def errors(self) -> List[Issue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> List[Issue]:
        return [i for i in self.issues if i.level == "warning"]

    def grade_totals(self) -> Dict[str, int]:
        total: Counter = Counter()
        for fr in self.files:
            total.update(r.grade for r in fr.rules if r.grade in GRADES)
        return {g: total.get(g, 0) for g in GRADES}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "skill_dir": self.skill_dir,
            "ok": not self.errors,
            "skill_md_lines": self.skill_lines,
            "files": [f.summary() for f in self.files],
            "rules_total": sum(len(f.rules) for f in self.files),
            "grades_total": self.grade_totals(),
            "errors": [i.to_dict() for i in self.errors],
            "warnings": [i.to_dict() for i in self.warnings],
        }


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def read_lines(path: Path) -> List[str]:
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def unfenced(lines: Sequence[str]) -> List[Tuple[int, str, bool]]:
    """(1-based line number, text, inside a code fence) for every line."""
    out: List[Tuple[int, str, bool]] = []
    fence: Optional[str] = None
    for number, text in enumerate(lines, start=1):
        m = FENCE_RE.match(text)
        if m:
            marker = m.group(1)
            if fence is None:
                fence = marker
                out.append((number, text, True))
                continue
            if marker == fence:
                fence = None
                out.append((number, text, True))
                continue
        out.append((number, text, fence is not None))
    return out


def norm_url(url: str) -> str:
    """Comparable form of a URL: no scheme, trailing punctuation, #fragment, trailing slash or
    www (dossiers sometimes cite the http:// form of a page a rule cites as https://)."""
    value = url.strip().rstrip(".,;:)]}>'\"*`").split("#", 1)[0].rstrip("/").lower()
    value = re.sub(r"^https?://", "", value)
    return value[4:] if value.startswith("www.") else value


# Dossier text may cite http:// URLs; rule Source lines are still required to use https.
DOSSIER_URL_RE = re.compile(r"https?://[^\s)>\]]+")
# Pseudo finding id for a dossier's "## Practitioner voice" section, written in a pointer as
# "practitioner voice" (every URL there was opened by the fact-checker, T31-F05).
PRACTITIONER_VOICE = "PRACTITIONER-VOICE"
# Index key holding every URL of a dossier; never a valid pointer id.
DOSSIER_WIDE = "__DOSSIER__"
# Raw dossier text by slug, filled by _dossier_index (used to match tracker numbers).
_DOSSIER_TEXT: Dict[str, str] = {}


def _dossier_index(research_dir: Path) -> Dict[str, Dict[str, set]]:
    """Map dossier slug -> {finding id with a '### <id>' heading -> normalised URLs cited in
    that finding's section (up to the next '##' or '###' heading)}."""
    index: Dict[str, Dict[str, set]] = {}
    if not research_dir.is_dir():
        return index
    for md in sorted(research_dir.glob("*.md")):
        findings: Dict[str, set] = {}
        current: Optional[set] = None
        # Every URL anywhere in the dossier (summary, contradictions, practitioner voice...):
        # a Source URL found only there is still inside the verified evidence base.
        whole = findings.setdefault(DOSSIER_WIDE, set())
        _DOSSIER_TEXT[md.stem] = chr(10).join(read_lines(md))
        for text in read_lines(md):
            whole.update(norm_url(u) for u in DOSSIER_URL_RE.findall(text))
            m = DOSSIER_FINDING_RE.match(text)
            if m:
                current = findings.setdefault(m.group(1), set())
                continue
            if text.startswith("## ") and "practitioner voice" in text.lower():
                current = findings.setdefault(PRACTITIONER_VOICE, set())
                continue
            if text.startswith("## ") or text.startswith("### "):
                current = None
                continue
            if current is not None:
                current.update(norm_url(u) for u in DOSSIER_URL_RE.findall(text))
        index[md.stem] = findings
    return index


def _issue_cited(url: str, slugs: List[str], texts: Dict[str, str]) -> bool:
    """True when `url` (normalised) is a GitHub issue or pull request whose '#<number>' the cited
    dossier names: fact-checkers often verified tracker items by number, e.g. 'Ruff #18806'."""
    m = re.match(r"github\.com/([^/]+/[^/]+)/(?:issues|pull)/(\d+)$", url)
    if not m:
        return False
    project = m.group(1).split("/")[1].lower()
    pattern = re.compile(r"#" + m.group(2) + r"(?!\d)")
    for slug in slugs:
        text = texts.get(slug, "")
        if pattern.search(text) and project in text.lower():
            return True
    return False


def _url_cited(url: str, cited: set) -> bool:
    """True when `url` equals a cited URL, or one is a page under the other."""
    if url in cited:
        return True
    return any(c.startswith(url + "/") or url.startswith(c + "/") for c in cited)


def parse_dossier_pointer(text: str, known_slugs: Optional[set] = None) -> List[Tuple[str, List[str]]]:
    """Slugs and their finding ids from the text after the first 'dossier:'.

    A lowercase token counts as a slug when it is a known dossier slug or contains a hyphen
    (every multi-word slug does); other plain words ("and", "corrected") are ignored.
    """
    pos = text.find("dossier:")
    if pos < 0:
        return []
    tail = text[pos + len("dossier:"):].replace("dossier:", " ")
    tail = re.sub(r"practitioner[\s-]+voice", PRACTITIONER_VOICE, tail, flags=re.IGNORECASE)
    known = known_slugs or set()
    pairs: List[Tuple[str, List[str]]] = []
    for token in re.split(r"[\s,;/()+·]+", tail):
        token = token.strip("`*.:'\"[]")
        if not token:
            continue
        if token == PRACTITIONER_VOICE:
            if pairs:
                pairs[-1][1].append(token)
            continue
        if FINDING_ID_RE.match(token):
            if pairs:
                pairs[-1][1].append(token)
            else:
                pairs.append(("", [token]))
        elif SLUG_RE.match(token) and (token in known or "-" in token):
            pairs.append((token, []))
    return pairs


# ----------------------------------------------------------------------------
# Reference files
# ----------------------------------------------------------------------------
def lint_reference(path: Path, rel: str, refs_dir: Path, dossiers: Dict[str, set],
                   rep: LintReport) -> FileReport:
    lines = read_lines(path)
    fr = FileReport(path=rel, lines=len(lines))
    numbered = unfenced(lines)

    # Rule headings and blocks.
    blocks: List[RuleBlock] = []
    current: Optional[RuleBlock] = None
    last_label: Optional[str] = None
    previous_blank = False
    contents_line: Optional[int] = None

    def extend(label: str, extra: str) -> None:
        assert current is not None
        ln, body = current.bullets[label]
        current.bullets[label] = (ln, body + "\n" + extra)

    for number, text, fenced in numbered:
        if fenced:
            if current is not None and last_label is not None:
                extend(last_label, text)
            previous_blank = False
            continue
        if re.match(r"^##\s+Contents\s*$", text) and contents_line is None:
            contents_line = number
        if HEADING_RE.match(text):
            current = None
            last_label = None
            m = RULE_HEADING_RE.match(text)
            if m:
                current = RuleBlock(rule_id=m.group("id"), prefix=m.group("prefix"),
                                    number=int(m.group("num")), title=m.group("title").strip(),
                                    line=number)
                blocks.append(current)
            elif RULE_LIKE_RE.match(text):
                rep.error(rel, number, "malformed rule heading; use exactly "
                                       "'### <PREFIX>-NN — <title>' (level 3, em dash)")
            previous_blank = False
            continue
        if current is None:
            continue
        bm = BULLET_RE.match(text)
        if bm:
            label = bm.group("label").strip()
            if label in BULLETS:
                if label in current.bullets:
                    rep.error(rel, number, f"{current.rule_id}: bullet '{label}' appears twice")
                    last_label = None
                else:
                    current.bullets[label] = (number, bm.group("rest"))
                    current.order.append(label)
                    last_label = label
            else:
                last_label = None  # an extra labelled bullet: tolerated, not parsed
        elif text.startswith(("- ", "* ", "+ ")):
            last_label = None  # another top-level list item ends the bullet
        elif text.strip() == "":
            pass
        elif last_label is not None and (text.startswith((" ", "\t")) or not previous_blank):
            extend(last_label, text)  # indented or lazy continuation line
        else:
            last_label = None  # a new paragraph after a blank line ends the bullet
        previous_blank = text.strip() == ""

    fr.rules = blocks
    for block in blocks:
        _lint_block(block, rel, dossiers, rep)

    # Ids, prefixes, numbering.
    seen: Dict[str, int] = {}
    for block in blocks:
        if block.rule_id in seen:
            rep.error(rel, block.line, f"duplicate rule id {block.rule_id} "
                                       f"(first at line {seen[block.rule_id]})")
        else:
            seen[block.rule_id] = block.line
    prefixes = sorted({b.prefix for b in blocks})
    if len(prefixes) > 1:
        rep.error(rel, blocks[0].line, f"several rule-id prefixes in one file: {', '.join(prefixes)}")
    expected = EXPECTED_PREFIX.get(path.name)
    if expected and prefixes and any(p != expected for p in prefixes):
        rep.error(rel, blocks[0].line, f"rule ids must use prefix {expected} for {path.name} "
                                       f"(blueprint file plan), found {', '.join(prefixes)}")
    numbers = [b.number for b in blocks]
    for prev, block in zip(numbers, blocks[1:]):
        if block.number <= prev:
            rep.warn(rel, block.line, f"{block.rule_id} is not numbered after the previous rule; "
                                      "keep ids ascending in file order")

    # Table of contents.
    if len(lines) > TOC_THRESHOLD:
        first_rule = blocks[0].line if blocks else len(lines) + 1
        if contents_line is None or contents_line > first_rule:
            rep.error(rel, contents_line or 1, f"file has {len(lines)} lines (> {TOC_THRESHOLD}) "
                                               "but no '## Contents' section before its first rule")
        elif contents_line > TOC_EARLY_LINES:
            rep.warn(rel, contents_line, f"'## Contents' starts at line {contents_line}; put it in "
                                         f"the first {TOC_EARLY_LINES} lines (agents preview files "
                                         "with head)")

    # Links to other reference files, and emphasis caps.
    caps = 0
    for number, text, fenced in numbered:
        if fenced:
            continue
        targets = [m.group("target") for m in INLINE_LINK_RE.finditer(text)]
        ref_def = REF_DEF_RE.match(text)
        if ref_def:
            targets.append(ref_def.group("target"))
        for target in targets:
            clean = target.split("#", 1)[0].split("?", 1)[0]
            if not clean or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", clean):
                continue
            if not clean.lower().endswith(".md"):
                continue
            resolved = (path.parent / clean).resolve()
            try:
                resolved.relative_to(refs_dir.resolve())
            except ValueError:
                continue
            rep.error(rel, number, f"markdown link to another reference file '{target}'; "
                                   "references stay one level deep: name the file in plain text")
        prose = INLINE_CODE_RE.sub(" ", text)
        caps += sum(1 for w in re.findall(r"\b[A-Z][A-Z']+\b", prose) if w in CAPS_WORDS)
    if caps > CAPS_MAX:
        rep.warn(rel, 0, f"{caps} ALL-CAPS emphasis words (limit about {CAPS_MAX} per file); "
                         "keep emphasis rare")
    return fr


def _lint_block(block: RuleBlock, rel: str, dossiers: Dict[str, Dict[str, set]],
                rep: LintReport) -> None:
    rid = block.rule_id
    for label in BULLETS:
        if label not in block.bullets:
            rep.error(rel, block.line, f"{rid}: missing bullet '- **{label}:**'")
            continue
        ln, body = block.bullets[label]
        if not body.strip():
            rep.error(rel, ln, f"{rid}: bullet '{label}' is empty")
    present = [b for b in block.order if b in BULLETS]
    if present != [b for b in BULLETS if b in present]:
        rep.warn(rel, block.line, f"{rid}: bullets out of order ({', '.join(present)}); "
                                  f"expected {', '.join(BULLETS)}")

    if "Tier" in block.bullets:
        ln, _ = block.bullets["Tier"]
        line_text = "- **Tier:** " + block.bullets["Tier"][1]
        for regex, attr, allowed, label in ((TIER_RE, "tier", TIERS, "Tier"),
                                            (CLASS_RE, "cls", CLASSES, "Class"),
                                            (RISK_RE, "fix_risk", FIX_RISKS, "Fix risk"),
                                            (GRADE_RE, "grade", GRADES, "Grade")):
            m = regex.search(line_text)
            if not m:
                rep.error(rel, ln, f"{rid}: '**{label}:**' is missing from the Tier line")
                continue
            value = m.group("v").strip()
            if value not in allowed:
                rep.error(rel, ln, f"{rid}: {label} '{value}' is not one of {'|'.join(allowed)}")
            else:
                setattr(block, attr, value)
        if block.tier == "T0" and block.cls and block.cls != "structural":
            rep.error(rel, ln, f"{rid}: tier T0 requires class structural, got {block.cls}")
        if block.cls == "report-only" and block.tier and block.tier != "T2":
            rep.error(rel, ln, f"{rid}: class report-only requires tier T2, got {block.tier}")
        if block.tier == "T2" and block.cls and block.cls != "report-only":
            rep.warn(rel, ln, f"{rid}: tier T2 is never edited by the skill; class "
                              f"'{block.cls}' is unusual (report-only expected)")

    if "Source" in block.bullets:
        ln, body = block.bullets["Source"]
        if not HTTPS_RE.search(body):
            rep.error(rel, ln, f"{rid}: Source needs at least one https:// URL")
        if "dossier:" not in body:
            rep.error(rel, ln, f"{rid}: Source needs a dossier pointer ('dossier: <slug> <finding id>')")
        elif dossiers:
            pairs = parse_dossier_pointer(body, set(dossiers))
            if not pairs:
                rep.error(rel, ln, f"{rid}: dossier pointer names no dossier slug")
            cited_urls: set = set()
            resolved = True
            named: set = set()
            for slug, ids in pairs:
                if not slug:
                    rep.error(rel, ln, f"{rid}: finding id(s) {', '.join(ids)} given before a "
                                       "dossier slug")
                    resolved = False
                    continue
                if slug not in dossiers:
                    rep.error(rel, ln, f"{rid}: dossier '{slug}' does not exist in research/")
                    resolved = False
                    continue
                named.update(ids)
                if not ids:
                    for urls in dossiers[slug].values():
                        cited_urls |= urls
                for fid in ids:
                    if fid not in dossiers[slug]:
                        rep.error(rel, ln, f"{rid}: dossier '{slug}' has no finding {fid}")
                        resolved = False
                    else:
                        cited_urls |= dossiers[slug][fid]
            if pairs and resolved:
                dossier_urls: set = set()
                for slug, _ids in pairs:
                    dossier_urls |= dossiers.get(slug, {}).get(DOSSIER_WIDE, set())
                for url in HTTPS_RE.findall(body.split("dossier:", 1)[0]):
                    nu = norm_url(url)
                    if _url_cited(nu, cited_urls) or _url_cited(nu, dossier_urls):
                        continue
                    if _issue_cited(nu, [slug for slug, _ids in pairs], _DOSSIER_TEXT):
                        continue
                    rep.warn(rel, ln, f"{rid}: Source URL {url.rstrip('.,;:')} appears in no "
                                      f"dossier the pointer cites; cite the dossier finding that "
                                      f"verified it (T31-F05)")
            _warn_ambiguous_ids(block, rel, dossiers, named, rep)


_OWNERS_CACHE: Dict[int, Tuple[Dict[str, Dict[str, set]], Dict[str, List[str]]]] = {}


def _warn_ambiguous_ids(block: RuleBlock, rel: str, dossiers: Dict[str, Dict[str, set]],
                        named: set, rep: LintReport) -> None:
    """Warn about a finding id cited in the block that exists in several dossiers when the
    dossier pointer does not name it after a slug (the reader cannot tell which one)."""
    cached = _OWNERS_CACHE.get(id(dossiers))
    if cached is None or cached[0] is not dossiers:
        owners: Dict[str, List[str]] = {}
        for slug, findings in dossiers.items():
            for fid in findings:
                owners.setdefault(fid, []).append(slug)
        _OWNERS_CACHE[id(dossiers)] = (dossiers, owners)
    else:
        owners = cached[1]
    text = "\n".join(body for _, body in block.bullets.values())
    for fid in sorted(set(FINDING_ID_ANY_RE.findall(text))):
        slugs = owners.get(fid, [])
        if len(slugs) > 1 and fid not in named:
            rep.warn(rel, block.line, f"{block.rule_id}: finding id {fid} exists in several "
                                      f"dossiers ({', '.join(sorted(slugs))}); name its slug in "
                                      f"the dossier pointer")


# ----------------------------------------------------------------------------
# SKILL.md
# ----------------------------------------------------------------------------
def parse_frontmatter(lines: Sequence[str]) -> Tuple[Optional[Dict[str, str]], int]:
    """Top-level scalar keys of the YAML frontmatter; nested blocks are kept as raw text.

    Returns (mapping or None when absent/unterminated, index of the closing '---').
    Supports plain, single- and double-quoted scalars and block scalars (| and >).
    """
    if not lines or lines[0].strip() != "---":
        return None, -1
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() in ("---", "..."):
            end = i
            break
    if end < 0:
        return None, -1
    data: Dict[str, str] = {}
    i = 1
    while i < end:
        text = lines[i]
        m = re.match(r"^([A-Za-z0-9_-]+):(?:\s+(.*))?$", text)
        if not m:
            i += 1
            continue
        key, raw = m.group(1), (m.group(2) or "").strip()
        i += 1
        block: List[str] = []
        while i < end and (lines[i].startswith((" ", "\t")) or lines[i].strip() == ""):
            block.append(lines[i])
            i += 1
        if raw[:1] in ("|", ">"):
            body = [b.strip() for b in block]
            value = ("\n" if raw[0] == "|" else " ").join(body).strip()
        elif raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
            try:
                value = str(json.loads(raw))  # JSON escapes cover the common YAML ones
            except ValueError:
                value = raw[1:-1]
        elif raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
            value = raw[1:-1].replace("''", "'")
        elif raw == "" and block:
            value = "\n".join(block)  # nested mapping or list, kept raw
        else:
            value = " ".join([raw] + [b.strip() for b in block if b.strip()]).strip()
        data[key] = value
    return data, end


def lint_skill_md(skill_dir: Path, ref_files: Sequence[Path], rep: LintReport) -> None:
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        rep.error("SKILL.md", 0, "SKILL.md is missing")
        return
    lines = read_lines(skill_md)
    rep.skill_lines = len(lines)
    if len(lines) > SKILL_MAX_LINES:
        rep.error("SKILL.md", 0, f"{len(lines)} lines; keep SKILL.md at or under {SKILL_MAX_LINES}")
    front, _end = parse_frontmatter(lines)
    if front is None:
        rep.error("SKILL.md", 1, "no YAML frontmatter delimited by '---' lines")
        front = {}
    else:
        name = front.get("name", "")
        if not name:
            rep.error("SKILL.md", 1, "frontmatter 'name' is missing")
        else:
            if not NAME_RE.match(name) or len(name) > NAME_MAX:
                rep.error("SKILL.md", 1, f"name '{name}' must be lowercase letters, digits and "
                                         f"hyphens, at most {NAME_MAX} characters")
            if name != skill_dir.name:
                rep.error("SKILL.md", 1, f"name '{name}' does not match the directory "
                                         f"'{skill_dir.name}'")
        desc = front.get("description", "")
        if not desc.strip():
            rep.error("SKILL.md", 1, "frontmatter 'description' is missing or empty")
        else:
            if len(desc) > DESCRIPTION_MAX:
                rep.error("SKILL.md", 1, f"description has {len(desc)} characters "
                                         f"(max {DESCRIPTION_MAX})")
            combined = len(desc) + len(front.get("when_to_use", ""))
            if combined > LISTING_MAX:
                rep.error("SKILL.md", 1, f"description + when_to_use have {combined} characters; "
                                         f"the skill listing truncates at {LISTING_MAX}")
            if re.search(r"\b(I can|You can|I will|I'll)\b", desc):
                rep.warn("SKILL.md", 1, "description should be written in the third person")
        dmi = front.get("disable-model-invocation", "").strip().lower()
        if dmi != "true":
            rep.error("SKILL.md", 1, "frontmatter must set 'disable-model-invocation: true' "
                                     "(user-invoked skill with side effects)")
        allowed = front.get("allowed-tools", "")
        if allowed:
            tokens = [t.strip().strip("'\"-[] ") for t in re.split(r"[,\n]", allowed)]
            if any(t in ("Bash", "Bash(*)", "Bash(*:*)") for t in tokens):
                rep.error("SKILL.md", 1, "allowed-tools pre-approves bare Bash; list specific "
                                         "commands instead")

    # Mentions of bundled files must resolve; every reference file should be mentioned.
    text = "\n".join(lines)
    mentioned: set = set()
    for number, line in enumerate(lines, start=1):
        for m in MENTION_RE.finditer(line):
            rel = m.group("path")
            j = m.end()
            while j < len(line) and line[j] in "-./_":
                j += 1
            if j < len(line) and line[j] in "<{*[":
                continue  # a pattern such as references/lang-<language>.md, not a file
            mentioned.add(rel)
            if not (skill_dir / rel).exists():
                rep.error("SKILL.md", number, f"mentions '{rel}', which does not exist")
    for ref in ref_files:
        rel = ref.relative_to(skill_dir).as_posix()
        if rel not in mentioned and ref.name not in text:
            rep.warn(rel, 0, "reference file is never mentioned in SKILL.md; the agent will not "
                             "know when to read it")


# ----------------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------------
def lint_skill(skill_dir: Path) -> LintReport:
    rep = LintReport(skill_dir=skill_dir.as_posix())
    refs_dir = skill_dir / "references"
    ref_files: List[Path] = []
    if not refs_dir.is_dir():
        rep.error("references/", 0, "references/ directory is missing")
    else:
        ref_files = sorted(p for p in refs_dir.rglob("*.md") if p.is_file())
        if not ref_files:
            rep.error("references/", 0, "references/ holds no .md files")
        for p in ref_files:
            if p.parent != refs_dir:
                rep.warn(p.relative_to(skill_dir).as_posix(), 0,
                         "reference file in a subdirectory; keep references/ flat")
    dossiers = _dossier_index(skill_dir / "research")
    if not dossiers and ref_files:
        rep.warn("research/", 0, "research/ holds no dossiers; dossier pointers were not checked")
    prefix_owner: Dict[str, str] = {}
    for p in ref_files:
        rel = p.relative_to(skill_dir).as_posix()
        fr = lint_reference(p, rel, refs_dir, dossiers, rep)
        rep.files.append(fr)
        for prefix in sorted({b.prefix for b in fr.rules}):
            if prefix in prefix_owner:
                rep.error(rel, 0, f"prefix {prefix} is also used by {prefix_owner[prefix]}; "
                                  "rule ids must be unique across the skill")
            else:
                prefix_owner[prefix] = rel
    lint_assets(skill_dir, rep)
    lint_skill_md(skill_dir, ref_files, rep)
    return rep


def lint_assets(skill_dir: Path, rep: LintReport) -> None:
    """Warn about assets/*.md files over 100 lines without a '## Contents' section (the same
    rule as reference files: agents preview long files with head, T31-F02)."""
    assets = skill_dir / "assets"
    if not assets.is_dir():
        return
    for path in sorted(assets.glob("*.md")):
        lines = read_lines(path)
        # A template whose rendered H2 order is fixed (reporting RP-07) may keep its contents
        # list in a leading HTML comment instead: "Contents" within the first 20 lines counts.
        head_has_contents = any(re.search(r"\bContents\b", ln) for ln in lines[:20])
        if len(lines) > TOC_THRESHOLD and not head_has_contents and not any(
                re.match(r"^##\s+Contents\s*$", ln) for ln in lines):
            rep.warn(path.relative_to(skill_dir).as_posix(), 0,
                     f"file has {len(lines)} lines (> {TOC_THRESHOLD}) but no '## Contents' "
                     f"section")


def render_text(rep: LintReport) -> str:
    out = [f"check_rules: {rep.skill_dir}"]
    if rep.skill_lines is not None:
        out.append(f"SKILL.md: {rep.skill_lines} lines")
    if rep.files:
        width = max(len(f.path) for f in rep.files)
        out.append(f"{'file':<{width}}  lines  rules   A   B   C   D")
        for fr in rep.files:
            s = fr.summary()
            g = s["grades"]
            out.append(f"{fr.path:<{width}}  {fr.lines:>5}  {len(fr.rules):>5}  "
                       f"{g['A']:>2}  {g['B']:>2}  {g['C']:>2}  {g['D']:>2}")
        totals = rep.grade_totals()
        out.append(f"{'total':<{width}}  {'':>5}  {sum(len(f.rules) for f in rep.files):>5}  "
                   f"{totals['A']:>2}  {totals['B']:>2}  {totals['C']:>2}  {totals['D']:>2}")
    state = "OK" if not rep.errors else "FAILED"
    out.append(f"{state}: {len(rep.errors)} violation(s), {len(rep.warnings)} warning(s)")
    out.extend("  " + i.render() for i in rep.errors)
    out.extend("  " + i.render() for i in rep.warnings)
    return "\n".join(out)


def main(argv: Optional[List[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(description="Lint the harden skill's rule catalogue and layout.")
    parser.add_argument("skill_dir", nargs="?", default=str(Path(__file__).resolve().parent.parent),
                        help="skill directory (default: the directory above scripts/)")
    parser.add_argument("--json", action="store_true", help="print a JSON report")
    args = parser.parse_args(argv)
    skill_dir = Path(args.skill_dir).resolve()
    if not skill_dir.is_dir():
        print(f"ERROR   skill directory not found: {skill_dir.as_posix()}", file=sys.stderr)
        return 2
    try:
        rep = lint_skill(skill_dir)
    except OSError as exc:
        print(f"ERROR   cannot read the skill: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(rep.to_dict(), indent=2, ensure_ascii=False))
    else:
        print(render_text(rep))
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
