"""SKILL.md and references/*.md cite only what exists (contract/SKILL-OUTLINE.md 4-5, TESTS.md 3.13, lane B10).

Protects: every `exec.py <words>` mentioned is a command of `cli.COMMANDS`, and every `--option` written after it in
the same code span is an option CLI.md defines for that command (read from the real argparse surface, so an invented
command or flag fails); the command cheat sheet lists exactly `cli.COMMANDS`; every reference of SKILL-OUTLINE.md 4
exists, opens with a paragraph saying when to read it, and has the required headings in order; the pointer table of
SKILL.md names every reference and only existing ones; every skill-relative path mentioned exists; no TODO, TBD or
FIXME; no `${CLAUDE_SKILL_DIR}` in any reference. Paths and references owned by another lane that has not landed yet
are reported by a separate test that is skipped (never passed) while any is missing. Planted defects prove each check
fires.

Run: python -m unittest discover -s scripts/tests -p "test_references.py" -v
"""
from __future__ import annotations

import argparse
import re
import unittest

import _support_B10 as B

from execlib import cli

REQUIRED_HEADINGS: dict[str, list[str]] = {  # SKILL-OUTLINE.md section 4
    "tick": ["The tick, step by step", "What woke me", "Launching a wave", "Ending the turn", "Per run_state",
             "Clock work"],
    "planning": ["Inputs", "Two-step planning before T0", "The planner workflow", "Writing the draft",
                 "Validation errors and their fixes", "Scheduling and the approval summary", "After approval"],
    "waves": ["A wave is a reporting epoch", "Wave 0, the contract wave", "Per task: implement, merge, verify, fix",
              "Workspaces", "Nulls, usage limits and relaunches", "Ingesting"],
    "manual-tasks": ["Manual tasks", "Decisions", "Getting answers", "The /frontend checkpoints", "AskUserQuestion"],
    "notion": ["Layout", "Property formats", "Executing a batch", "Rate limits and polling", "Failures",
               "Two developers"],
    "hackathon-profile": ["Phase B as scheduled tasks", "Prework", "UI budget", "Deliverable sub-plan",
                          "Event-shipped tools"],
    "frontend": ["Mode A in one paragraph", "Templates and their instantiation",
                 "The profile block and the shared files", "Proofs and gates", "Fragments and agents",
                 "When /frontend is missing"],
    "two-dev": ["Static ownership", "The state repository between two machines", "Cross-developer dependencies",
                "Dev B without the setup", "Dev B's setup task", "Talking across"],
    "fix-mode": ["When", "Parsing the report", "Selection", "Running fixes"],
    "recovery": ["Playbook", "Usage limits", "Notion down or token rejected", "Disk and RAM", "Process dead while away",
                 "Rehearsal drills"],
    "handover": ["Build complete", "Harden-ready", "The hand-over", "After /harden", "Postable moments"],
    "agents": ["The five agents", "Installing and checking", "/frontend's agents", "Briefs", "Model and effort"],
}
MARKER_RE = re.compile(r"\b(TODO|TBD|FIXME)\b(?!\.judge)")  # TODO.judge is a gate id (CLI.md)


def leaf_options() -> dict[str, set[str]]:
    """Command words → the option strings argparse accepts for that leaf (global options included)."""
    def subparsers(p: argparse.ArgumentParser) -> dict[str, argparse.ArgumentParser]:
        for action in p._actions:  # noqa: SLF001 - argparse has no public accessor
            if isinstance(action, argparse._SubParsersAction):  # noqa: SLF001
                return dict(action.choices)
        return {}

    def opts(p: argparse.ArgumentParser) -> set[str]:
        return {s for a in p._actions for s in a.option_strings}  # noqa: SLF001

    out: dict[str, set[str]] = {}
    for name, parser in subparsers(cli.build_parser()).items():
        inner = subparsers(parser)
        if inner:
            for sub, leaf in inner.items():
                out[f"{name} {sub}"] = opts(leaf)
        else:
            out[name] = opts(parser)
    return out


OPTIONS = leaf_options()


def mask_fences(text: str) -> str:
    """Fenced code blocks blanked (lines kept) so their content is never read as a mention."""
    out: list[str] = []
    fence = False
    for line in text.split("\n"):
        if line.startswith("```"):
            fence = not fence
            out.append("")
            continue
        out.append("" if fence else line)
    return "\n".join(out)


def command_problems(rel: str, text: str) -> list[str]:
    """Every exec.py mention resolves to a command; its options in the same code span are that command's."""
    problems: list[str] = []
    flat = mask_fences(text)
    joined = re.sub(r"\n[ \t]*", " ", flat)  # code spans and commands may wrap across lines
    for mention in B.exec_mentions(rel, joined):
        w1, w2 = (mention.words + ("",))[:2]
        words = f"{w1} {w2}" if w2 and f"{w1} {w2}" in cli.SPECS else w1
        if words not in cli.SPECS:
            problems.append(f"{rel}: exec.py {' '.join(mention.words)}: not a command of cli.COMMANDS")
            continue
        for option in mention.options:
            if option not in OPTIONS[words]:
                problems.append(f"{rel}: exec.py {words} {option}: not an option CLI.md defines for it")
    return problems


def heading_problems(name: str, text: str) -> list[str]:
    problems: list[str] = []
    if B.headings(text) != REQUIRED_HEADINGS[name]:
        problems.append(f"references/{name}.md headings {B.headings(text)} != {REQUIRED_HEADINGS[name]}")
    lines = [ln for ln in text.split("\n") if ln.strip()]
    if not lines or not lines[0].startswith("# "):
        problems.append(f"references/{name}.md does not start with a title")
    elif len(lines) < 2 or not lines[1].startswith("Read this"):
        problems.append(f"references/{name}.md does not open with a paragraph saying when to read it")
    return problems


def doc_files() -> list[str]:
    refs = sorted(p.name for p in (B.S.SKILL_DIR / "references").glob("*.md"))
    return ["SKILL.md"] + [f"references/{r}" for r in refs]


def path_status() -> tuple[list[str], list[str]]:
    """(problems for paths this lane owns or nobody owns, pending paths owned by another lane), over every doc."""
    own: list[str] = []
    pending: list[str] = []
    for rel in doc_files():
        for lineno, path in B.path_mentions(mask_fences(B.read_doc(rel))):
            probe = B.literal_prefix(path)
            if not probe or (B.S.SKILL_DIR / probe).exists():
                continue
            lane = B.owner_of(probe) or B.owner_of(path)
            entry = f"{rel}:{lineno}: {path} (owner {lane or 'none'})"
            (pending if lane not in (None, "B10") else own).append(entry)
    return own, pending


def pointer_table(text: str) -> list[str]:
    start = text.index("\n## Where to read next\n")
    end = text.index("\n## ", start + 1)
    return re.findall(r"`references/([a-z-]+)\.md`", text[start:end])


class Commands(unittest.TestCase):
    def test_every_exec_mention_is_a_command_with_its_options(self) -> None:
        problems: list[str] = []
        count = 0
        for rel in doc_files():
            text = B.read_doc(rel)
            count += len(list(B.exec_mentions(rel, text)))
            problems += command_problems(rel, text)
        self.assertEqual(problems, [])
        self.assertGreater(count, 150)

    def test_invented_commands_and_options_are_caught(self) -> None:
        planted = {
            "exec.py wave relaunch --wave W03": "not a command",
            "run `exec.py wave emit --dry-run` now": "not an option",
            "`exec.py decision\n   resolve --id D-001 --choise-file f`": "not an option",
            "`exec.py agents`": "not a command",
        }
        for text, expect in planted.items():
            with self.subTest(text=text):
                self.assertTrue(any(expect in p for p in command_problems("x.md", text)))
        # positive control: real commands, global options and wrapped spans pass
        ok = ("`exec.py --state S plan instantiate --dry-run --draft d`, `exec.py wave launched --wave W01\n"
              "  --run-id r --relaunch`, `exec.py status --digest`, `python \"C:/s/scripts/exec.py\" status`")
        self.assertEqual(command_problems("x.md", ok), [])

    def test_cheat_sheet_lists_exactly_the_commands(self) -> None:
        text = B.read_doc("SKILL.md")
        start = text.index("\n## Command cheat sheet\n")
        end = text.index("\n## ", start + 1)
        rows = re.findall(r"^\| `exec\.py ([a-z -]+)` \|", text[start:end], re.M)
        self.assertEqual(sorted(rows), sorted(c.words for c in cli.COMMANDS))
        self.assertEqual(len(rows), len(set(rows)))


class References(unittest.TestCase):
    def test_b10_references_exist_with_their_headings(self) -> None:
        problems: list[str] = []
        for name in B.B10_REFERENCES:
            path = B.S.SKILL_DIR / "references" / f"{name}.md"
            if not path.exists():
                problems.append(f"references/{name}.md missing")
                continue
            raw = path.read_bytes()
            if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw or not raw.endswith(b"\n"):
                problems.append(f"references/{name}.md is not UTF-8 LF with a final newline")
            problems += heading_problems(name, raw.decode("utf-8"))
        self.assertEqual(problems, [])
        # positive control: a missing or renamed heading is caught
        tick = B.read_doc("references/tick.md")
        self.assertTrue(heading_problems("tick", tick.replace("## Clock work", "## Clock")))
        self.assertTrue(heading_problems("tick", tick.replace("Read this on every turn", "This file")))

    def test_notion_reference_when_present(self) -> None:
        path = B.S.SKILL_DIR / "references" / "notion.md"
        if not path.exists():
            self.skipTest("references/notion.md belongs to lane B09, not landed yet")
        self.assertEqual(heading_problems("notion", path.read_text(encoding="utf-8")), [])

    def test_no_markers_and_no_skill_dir_variable(self) -> None:
        problems: list[str] = []
        for rel in doc_files():
            text = B.read_doc(rel)
            for lineno, line in enumerate(text.split("\n"), start=1):
                if MARKER_RE.search(line):
                    problems.append(f"{rel}:{lineno}: deferral marker")
                if rel != "SKILL.md" and "${CLAUDE_SKILL_DIR}" in line:
                    problems.append(f"{rel}:{lineno}: ${{CLAUDE_SKILL_DIR}} in a reference")
        self.assertEqual(problems, [])
        self.assertTrue(MARKER_RE.search("a " + "TO" + "DO here"))  # positive control
        self.assertEqual(B.read_doc("SKILL.md").count("${CLAUDE_SKILL_DIR}"), 2)  # the EXEC line and its fallback

    def test_pointer_table_names_every_reference(self) -> None:
        named = pointer_table(B.read_doc("SKILL.md"))
        self.assertEqual(sorted(named), sorted(B.REFERENCES))
        existing = {p.stem for p in (B.S.SKILL_DIR / "references").glob("*.md")}
        self.assertLessEqual(existing, set(named), "a reference file the pointer table does not name")
        missing_own = [n for n in named if n in B.B10_REFERENCES and n not in existing]
        self.assertEqual(missing_own, [])


class Paths(unittest.TestCase):
    def test_paths_of_this_lane_exist(self) -> None:
        own, _pending = path_status()
        self.assertEqual(own, [])
        # positive controls: a missing path is reported, an existing one is not, ownership is read from LANES.md
        self.assertEqual(B.owner_of("references/tick.md"), "B10")
        self.assertEqual(B.owner_of("assets/task-templates/execution.json"), "B02")
        self.assertEqual(B.owner_of("references/notion.md"), "B09")
        self.assertEqual(B.literal_prefix("references/<name>.md"), "references")
        self.assertEqual([p for _l, p in B.path_mentions("see `references/nope.md` and `assets/agents/`")],
                         ["references/nope.md", "assets/agents/"])

    def test_paths_of_other_lanes_exist(self) -> None:
        own, pending = path_status()
        missing_refs = [f"references/{n}.md" for n in B.REFERENCES
                        if not (B.S.SKILL_DIR / "references" / f"{n}.md").exists()]
        if pending or missing_refs:
            self.skipTest("waiting for other lanes: " + "; ".join(sorted(set(pending + missing_refs))))
        self.assertEqual(own, [])


if __name__ == "__main__":
    unittest.main()
