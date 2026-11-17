#!/usr/bin/env python3
"""Flag candidate prose defects in Markdown, with file:line, so a writing pass argues about text and not taste.

    python prose_check.py README.md docs/*.md            # findings, grouped by rule
    python prose_check.py --shape README.md docs/*.md     # the measured shape of the corpus
    python prose_check.py --json README.md                # findings as JSON

It emits CANDIDATES. Every rule here is a surface signal, and a surface signal is evidence of nothing on its own:
the judgement is in `references/01-mechanism-tests.md`, which a reader applies to what this prints. Exit code is 1
when a tier-1 rule fires, 0 otherwise, so it can gate a commit once a project has agreed to its thresholds.

What it deliberately does not do: score prose, compute a readability index, or claim a text was machine-written.
No text-only detector can do the last one reliably (references/05-what-does-not-work.md).
"""
from __future__ import annotations

import json
import re
import statistics
import sys
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------------------- markdown

FENCE = re.compile(r"^\s*(```|~~~)")


@dataclass
class Line:
    number: int
    text: str
    in_code: bool
    in_table: bool
    is_heading: bool

    @property
    def prose(self) -> bool:
        return not (self.in_code or self.in_table or self.is_heading)


def read_lines(path: Path) -> list[Line]:
    lines, in_code = [], False
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if FENCE.match(raw):
            in_code = not in_code
            lines.append(Line(number, raw, True, False, False))
            continue
        lines.append(
            Line(
                number=number,
                text=raw,
                # Four spaces is a code block in Markdown, and a shell transcript is not prose: curl's
                # HTTP3.md gave 18 "sentences" opening with "% git clone" until this was here.
                in_code=in_code or bool(re.match(r"^(?: {4}|\t)\S", raw)),
                in_table=bool(re.match(r"^\s*\|", raw)),
                is_heading=bool(re.match(r"^\s*#{1,6} ", raw)),
            )
        )
    return lines


def without_code_spans(text: str) -> str:
    """Inline code, link targets and image markup are not prose: a rule must not fire on a file path."""
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"`[^`]*`", " • ", text)
    return re.sub(r"<[^>]+>", " ", text)


def sentences_of(line: Line) -> list[str]:
    """The sentences of one line. Use paragraphs_of for anything that counts length."""
    return [text for _, text in split_sentences(without_code_spans(line.text), line.number)]


def split_sentences(text: str, first_line: int) -> list[tuple[int, str]]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z(\"'])", text)
    return [(first_line, part.strip()) for part in parts if len(part.split()) >= 3]


def paragraphs_of(lines: list[Line]) -> list[tuple[int, str]]:
    """Consecutive prose lines joined into one paragraph, with the line it starts on.

    Hard-wrapped Markdown was the flaw this exists to fix: three of the six control documents wrap their
    prose at 48 to 66 characters while the corpus they were compared against puts a whole paragraph on one
    line, so splitting per line measured the wrapping and called it sentence length.
    """
    paragraphs: list[tuple[int, str]] = []
    current: list[str] = []
    start = 0
    for line in lines:
        prose = line.prose and line.text.strip() and not re.match(r"^\s*(?:[-*+>]|\d+\.)\s", line.text)
        if prose:
            if not current:
                start = line.number
            current.append(without_code_spans(line.text).strip())
        elif current:
            paragraphs.append((start, " ".join(current)))
            current = []
    if current:
        paragraphs.append((start, " ".join(current)))
    return paragraphs


# --------------------------------------------------------------------------------------- rules

@dataclass
class Finding:
    file: str
    line: int
    rule: str
    tier: int
    message: str
    quote: str = ""


# Words whose frequency rose in machine-written corpora. Used as a DENSITY PROBE, never as a blocklist: one is
# nothing, a cluster is a signal. Sources: PubMed excess-vocabulary study; Wikipedia "Signs of AI writing".
DRIFT_WORDS = [
    "delve", "delves", "delving", "intricate", "intricacies", "tapestry", "testament", "underscore",
    "underscores", "showcasing", "showcases", "boasts", "pivotal", "meticulous", "meticulously",
    "realm", "landscape", "interplay", "garner", "garnered", "bolstered", "vibrant", "crucial",
    "seamless", "seamlessly", "robust", "leverage", "leveraging", "myriad", "plethora", "harness",
    "unlock", "unleash", "elevate", "empower", "navigate", "foster", "fostering", "align", "aligns",
]
# Wikipedia MOS:PEACOCK, verbatim list, plus the developer-marketing neighbours.
# Trimmed against the control corpus: every word here has to be unambiguous praise. "greatest" fired on
# esbuild's "to the greatest extent possible" and "leading" would fire on "leading zeros", so both are out.
PEACOCK = [
    "best-in-class", "world-class", "cutting-edge", "state-of-the-art", "game-changing", "revolutionary",
    "blazing", "blazingly", "lightning-fast", "seamlessly integrates", "battle-tested", "enterprise-grade",
    "unparalleled", "unrivalled", "unrivaled", "next-generation", "industry-leading",
]
# Google's "timeless documentation" list: each of these needs a date or a version beside it.
TIME_BOUND = [
    "as of this writing", "currently", "does not yet", "eventually", "in the future", "latest",
    "newer", "now supports", "presently", "at present", "soon", "recently", "these days", "modern",
]
# Adjectives that stand where a measurement belongs (Google technical-writing course).
UNMEASURED = ["fast", "slow", "quick", "quickly", "large", "small", "huge", "tiny", "many", "few", "efficient", "lightweight", "scalable"]
HEDGES = [
    "arguably", "essentially", "fundamentally", "generally", "in essence", "largely", "perhaps",
    "quite", "rather", "relatively", "somewhat", "typically", "usually", "very", "often", "may be able to",
    "helps ensure", "it is worth noting", "it's worth noting", "it is important to", "it's important to",
]
COPULA_DISPLACEMENT = ["serves as", "stands as", "functions as", "operates as", "represents a", "marks a"]

NUMBER = re.compile(r"\b\d[\d,._]*\b|\bv\d|\b20\d\d\b")


def rules_for_line(line: Line, path: str, state: dict) -> list[Finding]:
    found: list[Finding] = []
    if not line.prose:
        return found
    text = without_code_spans(line.text)
    if not text.strip():
        return found
    low = text.lower()

    def add(rule: str, tier: int, message: str, quote: str = "") -> None:
        found.append(Finding(path, line.number, rule, tier, message, quote))

    # PR-01 em dash. Measured: 0.0 per 1000 words across ripgrep, esbuild, curl, svelte and Diataxis;
    # 0.5 in the Rust book. A dash is not a defect, a dash habit is.
    # A dash separating a term from its definition in a list is typography, not rhetoric. Exempting list
    # lines was measured first: it removes 2% of the dashes in the corpus this rule was built on and 24% in
    # a document written as a definition list, so it hides nothing that matters.
    if not re.match(r"^\s*(?:[-*+]|\d+\.)\s", line.text):
        for _ in range(text.count("—")):
            state["em_dashes"].append(line.number)

    # PR-03 negative parallelism, the most cited structural tell.
    if re.search(r"\bnot (?:only|just)\b[^.]{0,90}\bbut\b", low):
        add("PR-03", 1, "\"not only/just X but Y\": say the thing it is, then the thing it is not, or cut one")
    if re.search(r"\bit(?:'s| is) not\b[^.]{0,60}\bit(?:'s| is)\b", low):
        add("PR-03", 1, "\"it's not X, it's Y\": rhetorical inversion standing in for a claim")

    # PR-04 copula displacement.
    for phrase in COPULA_DISPLACEMENT:
        if phrase in low:
            add("PR-04", 2, f"\"{phrase}\" where \"is\" would do, unless the verb does concrete work")

    # PR-05 drift vocabulary, as a density probe over a window, handled in the file pass.
    for word in DRIFT_WORDS:
        if re.search(rf"\b{word}\b", low):
            state["drift"].append((line.number, word))

    # PR-06 peacock terms: an unearned superlative is a claim with no number behind it.
    for word in PEACOCK:
        if re.search(rf"\b{re.escape(word)}\b", low):
            add("PR-06", 1, f"\"{word}\" is a claim with no measurement", text.strip()[:90])

    # PR-07 time-bound word with no date or version in the same sentence (Google, timeless documentation).
    for phrase in TIME_BOUND:
        if phrase in low and not NUMBER.search(text):
            add("PR-07", 2, f"\"{phrase}\" without a date or a version: it will be wrong and nobody will know when")

    # PR-08 an adjective where a measurement belongs — only where a comparison or a superlative is being
    # claimed. Plain description ("many programmers", "a fast path") is ordinary English: firing on it gave
    # 10 findings in one chapter of the Rust book, all of them wrong.
    comparative = re.search(r"\b(?:faster|slower|quicker|larger|smaller|cheaper|lighter|fastest|slowest|"
                            r"most|significantly|dramatically|orders of magnitude)\b", low) or re.search(
                            r"\b(?:very|extremely|incredibly|super)\s+(?:fast|slow|large|small|efficient)\b", low)
    if comparative and not NUMBER.search(text):
        add("PR-08", 2, "a comparison with no figure in the sentence: say what you measured, and against what",
            text.strip()[:90])

    # PR-09 hedges.
    for hedge in HEDGES:
        if re.search(rf"\b{re.escape(hedge)}\b", low):
            state["hedges"].append((line.number, hedge))

    # PR-10 heading shape: title case and the "X and Y" formula.
    return found


def heading_findings(line: Line, path: str) -> list[Finding]:
    title = re.sub(r"^\s*#{1,6}\s*", "", line.text).strip()
    words = [w for w in re.findall(r"[A-Za-z][\w'-]*", title)]
    if len(words) >= 4:
        capitalised = sum(1 for w in words[1:] if w[:1].isupper() and not w.isupper())
        if capitalised >= len(words[1:]) * 0.8:
            return [Finding(path, line.number, "PR-10", 2, "title case in a heading: sentence case reads as written by a person", title[:80])]
    return []


# --------------------------------------------------------------------------------------- file pass

def check_file(path: Path) -> tuple[list[Finding], dict]:
    lines = read_lines(path)
    state: dict = {"em_dashes": [], "lengths": [], "drift": [], "hedges": [], "words": 0, "openings": []}
    findings: list[Finding] = []
    name = path.as_posix()

    # PR-02, over paragraphs rather than lines: a sentence does not end where the line does.
    for start, paragraph in paragraphs_of(lines):
        for _, sentence in split_sentences(paragraph, start):
            words = len(sentence.split())
            state["lengths"].append(words)
            if words >= 35:
                findings.append(
                    Finding(name, start, "PR-02", 2, f"{words}-word sentence: the control corpus has a median of 12 to 18", sentence[:90])
                )

    for line in lines:
        if line.is_heading:
            findings.extend(heading_findings(line, name))
            continue
        if line.prose:
            state["words"] += len(without_code_spans(line.text).split())
            # A list is meant to be parallel: ripgrep's twenty "If you're a…" bullets are a table of
            # contents, not a tic. Openings are counted in flowing prose only.
            if not re.match(r"^\s*(?:[-*+]|\d+\.)\s", line.text):
                # A bold label at the start of a line is a field name, not a sentence opening: a page built of
                # "**What it means.** … **What to do.** …" is a definition list wearing prose clothes.
                body = re.sub(r"^\s*\*\*[^*]{1,40}\*\*[.:]?\s*", "", line.text)
                for sentence in sentences_of(Line(line.number, body, False, False, False)):
                    state["openings"].append((line.number, " ".join(sentence.split()[:3]).lower()))
        findings.extend(rules_for_line(line, name, state))

    words = max(state["words"], 1)
    per_1k = lambda n: 1000 * n / words

    # PR-01, judged over the file: the habit, not the instance.
    density = per_1k(len(state["em_dashes"]))
    if density > 2.0:
        for number in state["em_dashes"][:12]:
            findings.append(
                Finding(name, number, "PR-01", 1, f"em dash; this file has {density:.1f} per 1000 words, the human control corpus 0.0 to 0.5")
            )

    # PR-02, judged over the file. Measured over joined paragraphs: ripgrep 4%, esbuild 5%, curl 1%, the Rust
    # book 5% of sentences run to 35 words or more. Tier 1 is set at five times the worst of those.
    lengths = state["lengths"]
    if len(lengths) >= 25:
        share = sum(1 for n in lengths if n >= 35) / len(lengths)
        if share >= 0.25:
            findings.append(
                Finding(name, 1, "PR-02", 1, f"{share:.0%} of sentences run to 35 words or more; the human control "
                                             f"corpus is 1% to 5%. One long sentence is a sentence. Half of them "
                                             f"being long is a voice")
            )
        elif share >= 0.12:
            findings.append(
                Finding(name, 1, "PR-02", 2, f"{share:.0%} of sentences run to 35 words or more; the human control "
                                             f"corpus is 1% to 5%")
            )

    # PR-05, judged over a window of 40 lines: three or more drift words together is the signal.
    by_window: dict[int, list[tuple[int, str]]] = {}
    for number, word in state["drift"]:
        by_window.setdefault(number // 40, []).append((number, word))
    for hits in by_window.values():
        if len(hits) >= 3:
            findings.append(
                Finding(name, hits[0][0], "PR-05", 1, "drift vocabulary clustered: " + ", ".join(w for _, w in hits))
            )

    # PR-09, judged over the file.
    hedge_density = per_1k(len(state["hedges"]))
    if hedge_density > 4.0:
        for number, hedge in state["hedges"][:8]:
            findings.append(Finding(name, number, "PR-09", 2, f"hedge \"{hedge}\"; {hedge_density:.1f} per 1000 words in this file"))

    # PR-11 repeated sentence openings: the shape a reader notices before the words.
    counts: dict[str, list[int]] = {}
    for number, opening in state["openings"]:
        counts.setdefault(opening, []).append(number)
    for opening, numbers in counts.items():
        if len(numbers) >= 4 and len(opening.split()) >= 2:
            findings.append(
                Finding(name, numbers[0], "PR-11", 2, f"{len(numbers)} sentences open with \"{opening}\" (lines {', '.join(map(str, numbers[:6]))})")
            )

    return findings, state


def shape(paths: list[Path]) -> None:
    for path in paths:
        _, state = check_file(path)
        lengths = state["lengths"] or [0]
        words = max(state["words"], 1)
        print(f"{path.as_posix()}")
        print(f"   words {words} | sentences {len(state['lengths'])}")
        print(
            f"   sentence words: median {statistics.median(lengths):.0f}, mean {statistics.mean(lengths):.1f}, "
            f"sd {statistics.pstdev(lengths):.1f}, share 35+ {sum(1 for n in lengths if n >= 35) / len(lengths):.0%}, "
            f"share under 9 {sum(1 for n in lengths if n < 9) / len(lengths):.0%}"
        )
        print(f"   em dashes per 1000 words {1000 * len(state['em_dashes']) / words:.1f} | hedges {1000 * len(state['hedges']) / words:.1f}")


TIERS = {1: "must fix", 2: "look again"}


def main(argv: list[str]) -> int:
    # A Windows console defaults to a codepage that cannot print what Markdown routinely contains, and a tool
    # that dies on a minus sign is a tool nobody runs twice.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass
    as_json = "--json" in argv
    want_shape = "--shape" in argv
    paths = [Path(a) for a in argv if not a.startswith("--")]
    if not paths:
        print(__doc__)
        return 2
    if want_shape:
        shape(paths)
        return 0

    findings: list[Finding] = []
    for path in paths:
        found, _ = check_file(path)
        findings.extend(found)
    findings.sort(key=lambda f: (f.rule, f.file, f.line))

    if as_json:
        print(json.dumps([f.__dict__ for f in findings], indent=2))
    else:
        for finding in findings:
            quote = f"  |  {finding.quote}" if finding.quote else ""
            print(f"{finding.file}:{finding.line}  {finding.rule} [{TIERS[finding.tier]}]  {finding.message}{quote}")
        tier1 = sum(1 for f in findings if f.tier == 1)
        print(f"\n{len(findings)} candidates, {tier1} at tier 1, over {len(paths)} file(s)")
        print("Candidates, not verdicts: apply references/01-mechanism-tests.md to each before changing a word.")
    return 1 if any(f.tier == 1 for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
