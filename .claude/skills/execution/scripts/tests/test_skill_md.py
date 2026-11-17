"""SKILL.md of /execution (contract/SKILL-OUTLINE.md 1-3, TESTS.md 3.13, lane B10).

Protects: the frontmatter exactly as SKILL-OUTLINE.md 1 gives it (no `model`, no `hooks`, model invocation
disabled); the eight sections of SKILL-OUTLINE.md 2.1-2.8 in order and complete within the first 20,000 characters
(the part re-attached after a compaction), holding the Workflow opt-in sentence, the instruction to call the Workflow
tool once per wave, the EXEC definition line with its fallback, the 17 standing rules, every run state and the eight
tick steps, and the plain-text heartbeat prompt's shape; the later sections of SKILL-OUTLINE.md 3. Each check is a
function that returns problems, and a planted defect proves each one can fire (positive controls).

Run: python -m unittest discover -s scripts/tests -p "test_skill_md.py" -v
"""
from __future__ import annotations

import re
import unittest

import _support_B10 as B

from execlib import state

LIMIT = 20_000
FIRST = ["What this skill does, and the Workflow opt-in", "Standing rules", "Invariants", "State machine",
         "Start-up (first invocation in a repo)", "The tick (every turn)", "Never", "Where to read next"]
REST = ["Invocation forms in detail", "Command cheat sheet", "Talking to the owner", "Files of this skill"]
EXEC_LINE = 'EXEC = python "${CLAUDE_SKILL_DIR}/scripts/exec.py"'
HEARTBEAT = ('execution heartbeat: run python "<SKILL_DIR>/scripts/exec.py" status and follow '
             '<SKILL_DIR>/references/tick.md')
WORKFLOW_ONCE = "call the Workflow tool once per wave"


def outline_frontmatter() -> str:
    """The frontmatter block as contract/SKILL-OUTLINE.md section 1 writes it."""
    text = B.read_doc("contract/SKILL-OUTLINE.md")
    block = text.split("```yaml\n", 1)[1].split("```", 1)[0]
    return block


def outline_opt_in() -> str:
    """The verbatim opt-in of SKILL-OUTLINE.md 2.1 (between the quotes after "verbatim intent:")."""
    text = B.read_doc("contract/SKILL-OUTLINE.md")
    para = text.split('**The opt-in, verbatim intent:** "', 1)[1].split('"\n', 1)[0]
    return " ".join(para.split())


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, ""
    block = text[4:].split("\n---\n", 1)[0]
    keys: dict[str, str] = {}
    for line in block.split("\n"):
        if line and not line[0].isspace() and ":" in line:
            key, _sep, value = line.partition(":")
            keys[key.strip()] = value.strip()
    return keys, "---\n" + block + "\n---\n"


def frontmatter_problems(text: str) -> list[str]:
    keys, block = parse_frontmatter(text)
    problems: list[str] = []
    if set(keys) != {"name", "description", "argument-hint", "disable-model-invocation"}:
        problems.append(f"frontmatter keys {sorted(keys)}")
    if keys.get("disable-model-invocation") != "true":
        problems.append("disable-model-invocation is not true")
    for banned in ("model", "hooks"):
        if banned in keys:
            problems.append(f"frontmatter has {banned}")
    if block != outline_frontmatter():
        problems.append("frontmatter differs from contract/SKILL-OUTLINE.md section 1")
    return problems


def first_part_problems(text: str) -> list[str]:
    problems: list[str] = []
    found = B.headings(text)
    expected = FIRST + REST
    if found != expected:
        problems.append(f"level-2 headings {found} != {expected}")
    first = text[:LIMIT]
    for heading in FIRST:
        if f"\n## {heading}\n" not in first:
            problems.append(f"heading {heading!r} not within the first {LIMIT} characters")
    end_of_first = text.find("\n## " + REST[0] + "\n")
    if end_of_first == -1 or end_of_first > LIMIT:
        problems.append(f"the eight first sections end at {end_of_first}, past {LIMIT}")
    flat = " ".join(first.split())
    if outline_opt_in() not in flat:
        problems.append("the Workflow opt-in sentence of SKILL-OUTLINE.md 2.1 is missing")
    if WORKFLOW_ONCE not in flat:
        problems.append("no sentence tells Claude to call the Workflow tool once per wave")
    if EXEC_LINE not in first or "is not substituted" not in first:
        problems.append("the EXEC definition line or its fallback is missing")
    if HEARTBEAT not in first:
        problems.append("the heartbeat prompt's shape is missing")
    return problems


def section(text: str, heading: str) -> str:
    start = text.find(f"\n## {heading}\n")
    if start == -1:
        return ""
    nxt = text.find("\n## ", start + 1)
    return text[start: nxt if nxt != -1 else len(text)]


def content_problems(text: str) -> list[str]:
    problems: list[str] = []
    rules = section(text, "Standing rules")
    numbers = [int(n) for n in re.findall(r"^(\d+)\. ", rules, re.M)]
    if numbers != list(range(1, 18)):
        problems.append(f"standing rules numbered {numbers}, expected 1-17")
    machine = section(text, "State machine")
    for run_state in state.RUN_STATES:
        if run_state not in machine:
            problems.append(f"state machine misses {run_state}")
    tick = section(text, "The tick (every turn)")
    if [int(n) for n in re.findall(r"^(\d+)\. ", tick, re.M)] != list(range(1, 9)):
        problems.append("the tick does not list steps 1-8")
    startup = section(text, "Start-up (first invocation in a repo)")
    if [int(n) for n in re.findall(r"^(\d+)\. ", startup, re.M)] != list(range(1, 11)):
        problems.append("the start-up does not list steps 1-10")
    for form in ("`resume`", "`pre-t0`", "`rehearsal <dest>`", "`--fix <report>`"):
        if form not in section(text, "What this skill does, and the Workflow opt-in"):
            problems.append(f"invocation form {form} not described")
    return problems


class SkillMd(unittest.TestCase):
    def setUp(self) -> None:
        self.text = B.read_doc("SKILL.md")

    def test_encoding(self) -> None:
        raw = (B.S.SKILL_DIR / "SKILL.md").read_bytes()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))
        self.assertNotIn(b"\r", raw)
        self.assertTrue(raw.endswith(b"\n"))

    def test_frontmatter(self) -> None:
        self.assertEqual(frontmatter_problems(self.text), [])
        planted = self.text.replace("disable-model-invocation: true\n", "disable-model-invocation: true\nmodel: opus\n")
        self.assertTrue(frontmatter_problems(planted))
        self.assertTrue(frontmatter_problems(self.text.replace("disable-model-invocation: true",
                                                               "disable-model-invocation: false")))

    def test_first_five_thousand_tokens(self) -> None:
        self.assertEqual(first_part_problems(self.text), [])
        # positive controls: each check fires on a planted defect
        moved = self.text.replace("\n## Never\n", "\n## Never!\n")
        self.assertTrue(first_part_problems(moved))
        padded = self.text.replace("\n## Standing rules\n", "\n" + ("x" * LIMIT) + "\n\n## Standing rules\n")
        self.assertTrue(first_part_problems(padded))
        self.assertTrue(first_part_problems(self.text.replace(HEARTBEAT, "execution heartbeat")))
        self.assertTrue(first_part_problems(self.text.replace(WORKFLOW_ONCE, "call the Workflow tool")))
        self.assertTrue(first_part_problems(self.text.replace(EXEC_LINE, "EXEC = exec.py")))

    def test_content(self) -> None:
        self.assertEqual(content_problems(self.text), [])
        self.assertTrue(content_problems(self.text.replace("17. The owner's", "18. The owner's")))
        self.assertTrue(content_problems(self.text.replace("PAUSED_RESOURCES", "PAUSED")))


if __name__ == "__main__":
    unittest.main()
