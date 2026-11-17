"""Tests for scripts/check_rules.py (run: python -m unittest discover -s scripts/tests)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import List, Optional

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import check_rules as cr  # noqa: E402

DASH = "—"

SKILL_MD = """---
name: harden
description: Independent, evidence-based hardening review of a finished codebase. Use when a project is feature-complete and its tests pass.
argument-hint: "[paths...] [--report-only]"
disable-model-invocation: true
hooks:
  Stop:
    - hooks:
        - type: command
          command: 'python "$HOME/.claude/skills/harden/scripts/hook_guard.py"'
---

# /harden

Read `references/lens-dead-code.md` when the dead-code lens runs.
Run `python "${CLAUDE_SKILL_DIR}/scripts/check_rules.py"` to lint the catalogue.
Language files follow the pattern references/lang-<language>.md.
"""

DOSSIER = """# Dead code evidence
> Code G101 · slug dead-code-evidence

### G101-F01 — Tests are not a liveness signal
- text
- [Dead code study](https://example.org/paper) — verified

### G101-F02 — Another finding
- text
- [X](https://example.org/x/) — verified
"""


def rule(rule_id: str = "DC-01", title: str = "Tests are not a liveness signal",
         tier_line: str = "- **Tier:** T1 · **Class:** structural · **Fix risk:** low · **Grade:** B",
         source: Optional[str] = None, drop: Optional[str] = None) -> str:
    src = source if source is not None else (
        "- **Source:** [Dead code study](https://example.org/paper) (Author, 2024) · "
        "dossier: dead-code-evidence G101-F01")
    bullets = {
        "Rule": "- **Rule:** Do not treat a test reference as proof that code is live.",
        "Detect": "- **Detect:** `vulture src --min-confidence 80`, then grep callers outside tests.",
        "Not when": "- **Not when:** Test-only helpers shipped as a public testing API.",
        "Tier": tier_line,
        "Source": src,
    }
    lines = [f"### {rule_id} {DASH} {title}"]
    lines += [text for label, text in bullets.items() if label != drop]
    return "\n".join(lines) + "\n"


class SkillFixture:
    """A temporary skill directory named 'harden' with one reference and one dossier."""

    def __init__(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "harden"
        (self.dir / "references").mkdir(parents=True)
        (self.dir / "research").mkdir()
        (self.dir / "scripts").mkdir()
        (self.dir / "scripts" / "check_rules.py").write_text("# stub\n", encoding="utf-8")
        (self.dir / "research" / "dead-code-evidence.md").write_text(DOSSIER, encoding="utf-8")
        self.write("SKILL.md", SKILL_MD)
        self.reference(rule() + "\n" + rule("DC-02", "Second rule",
                                            source="- **Source:** [X](https://example.org/x) · "
                                                   "dossier: dead-code-evidence G101-F02"))

    def write(self, rel: str, text: str) -> Path:
        path = self.dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def reference(self, body: str, name: str = "lens-dead-code.md", header: str = "") -> Path:
        return self.write(f"references/{name}", "# Dead code lens\n\n" + header + body)

    def lint(self) -> cr.LintReport:
        return cr.lint_skill(self.dir)

    def cleanup(self) -> None:
        self.tmp.cleanup()


def messages(rep: cr.LintReport, level: str = "error") -> List[str]:
    items = rep.errors if level == "error" else rep.warnings
    return [f"{i.file}:{i.line} {i.message}" for i in items]


class RuleBlockTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = SkillFixture()

    def tearDown(self) -> None:
        self.fx.cleanup()

    def assertError(self, rep: cr.LintReport, fragment: str) -> None:
        found = [m for m in messages(rep) if fragment in m]
        self.assertTrue(found, f"no error containing {fragment!r}; errors: {messages(rep)}")

    def test_good_skill_passes_and_counts_grades(self) -> None:
        rep = self.fx.lint()
        self.assertEqual(messages(rep), [])
        self.assertEqual(messages(rep, "warning"), [])
        summary = rep.to_dict()
        self.assertTrue(summary["ok"])
        self.assertEqual(summary["rules_total"], 2)
        self.assertEqual(summary["grades_total"], {"A": 0, "B": 2, "C": 0, "D": 0})
        self.assertEqual(summary["files"][0]["tiers"]["T1"], 2)

    def test_missing_bullet(self) -> None:
        self.fx.reference(rule(drop="Detect"))
        self.assertError(self.fx.lint(), "DC-01: missing bullet '- **Detect:**'")

    def test_empty_bullet(self) -> None:
        self.fx.reference(rule().replace("- **Not when:** Test-only helpers shipped as a public "
                                         "testing API.", "- **Not when:**"))
        self.assertError(self.fx.lint(), "bullet 'Not when' is empty")

    def test_bad_enums_on_tier_line(self) -> None:
        self.fx.reference(rule(tier_line="- **Tier:** T3 · **Class:** cosmetic · **Fix risk:** tiny "
                                         "· **Grade:** E"))
        rep = self.fx.lint()
        for fragment in ("Tier 'T3'", "Class 'cosmetic'", "Fix risk 'tiny'", "Grade 'E'"):
            self.assertError(rep, fragment)

    def test_missing_grade_on_tier_line(self) -> None:
        self.fx.reference(rule(tier_line="- **Tier:** T1 · **Class:** structural · **Fix risk:** low"))
        self.assertError(self.fx.lint(), "'**Grade:**' is missing")

    def test_tier_class_consistency(self) -> None:
        self.fx.reference(rule(tier_line="- **Tier:** T0 · **Class:** behavioural · "
                                         "**Fix risk:** low · **Grade:** A"))
        self.assertError(self.fx.lint(), "tier T0 requires class structural")
        self.fx.reference(rule(tier_line="- **Tier:** T1 · **Class:** report-only · "
                                         "**Fix risk:** low · **Grade:** A"))
        self.assertError(self.fx.lint(), "class report-only requires tier T2")

    def test_source_needs_https_and_dossier(self) -> None:
        self.fx.reference(rule(source="- **Source:** Some book (2019) · dossier: dead-code-evidence G101-F01"))
        self.assertError(self.fx.lint(), "https:// URL")
        self.fx.reference(rule(source="- **Source:** [X](https://example.org/x) (2019)"))
        self.assertError(self.fx.lint(), "dossier pointer")

    def test_source_on_continuation_line(self) -> None:
        self.fx.reference(rule(source="- **Source:** [X](https://example.org/x) (2019)\n"
                                      "  · dossier: dead-code-evidence G101-F01"))
        self.assertEqual(messages(self.fx.lint()), [])

    def test_unknown_dossier_or_finding(self) -> None:
        self.fx.reference(rule(source="- **Source:** [X](https://example.org/x) · "
                                      "dossier: dead-code-tools G102-F01"))
        self.assertError(self.fx.lint(), "dossier 'dead-code-tools' does not exist")
        self.fx.reference(rule(source="- **Source:** [X](https://example.org/x) · "
                                      "dossier: dead-code-evidence G101-F09"))
        self.assertError(self.fx.lint(), "has no finding G101-F09")

    def test_duplicate_and_mixed_ids(self) -> None:
        self.fx.reference(rule() + "\n" + rule())
        self.assertError(self.fx.lint(), "duplicate rule id DC-01")
        self.fx.reference(rule() + "\n" + rule("CX-02"))
        rep = self.fx.lint()
        self.assertError(rep, "several rule-id prefixes")
        self.assertError(rep, "must use prefix DC")

    def test_prefix_must_match_file_plan(self) -> None:
        self.fx.reference(rule("CX-01"))
        self.assertError(self.fx.lint(), "must use prefix DC for lens-dead-code.md")

    def test_prefix_unique_across_files(self) -> None:
        self.fx.reference(rule("ZZ-01"), name="extra-a.md")
        self.fx.reference(rule("ZZ-02"), name="extra-b.md")
        self.fx.write("SKILL.md", SKILL_MD + "\nAlso references/extra-a.md and references/extra-b.md.\n")
        self.assertError(self.fx.lint(), "prefix ZZ is also used by")

    def test_malformed_heading(self) -> None:
        self.fx.reference(rule().replace(f"### DC-01 {DASH} ", "### DC-01 - "))
        self.assertError(self.fx.lint(), "malformed rule heading")

    def test_rule_in_code_fence_is_ignored(self) -> None:
        fenced = "```markdown\n" + rule("DC-09", drop="Source") + "```\n\n"
        self.fx.reference(fenced + rule())
        rep = self.fx.lint()
        self.assertEqual(messages(rep), [])
        self.assertEqual(rep.to_dict()["rules_total"], 1)

    def test_long_file_needs_contents_before_first_rule(self) -> None:
        filler = "".join(f"Paragraph line {i}.\n" for i in range(110))
        self.fx.reference(rule() + "\n" + filler)
        self.assertError(self.fx.lint(), "no '## Contents' section")
        self.fx.reference(rule() + "\n" + filler, header="## Contents\n- DC-01 Tests\n\n")
        self.assertEqual(messages(self.fx.lint()), [])

    def test_link_to_other_reference_file(self) -> None:
        self.fx.write("references/lens-duplication.md", "# Duplication\n")
        self.fx.write("SKILL.md", SKILL_MD + "\nreferences/lens-duplication.md\n")
        self.fx.reference(rule() + "\nSee [duplication](lens-duplication.md#du-01).\n")
        self.assertError(self.fx.lint(), "markdown link to another reference file")
        self.fx.reference(rule() + "\nSee the duplication lens and [SARIF](https://example.org/s.md).\n")
        self.assertEqual(messages(self.fx.lint()), [])

    def test_out_of_order_bullets_warn(self) -> None:
        text = rule()
        lines = text.splitlines()
        lines[1], lines[2] = lines[2], lines[1]
        self.fx.reference("\n".join(lines) + "\n")
        rep = self.fx.lint()
        self.assertEqual(messages(rep), [])
        self.assertTrue(any("out of order" in m for m in messages(rep, "warning")))


class EvidenceWarningTest(unittest.TestCase):
    """Warnings that tie a rule's Source to the findings its dossier pointer cites."""

    def setUp(self) -> None:
        self.fx = SkillFixture()

    def tearDown(self) -> None:
        self.fx.cleanup()

    def warnings(self) -> List[str]:
        return messages(self.fx.lint(), "warning")

    def test_source_url_missing_from_cited_findings_warns(self) -> None:
        self.fx.reference(rule(source="- **Source:** [Paper](https://example.org/paper#s2) and "
                                      "[Other](https://example.org/unverified) · dossier: "
                                      "dead-code-evidence G101-F01"))
        rep = self.fx.lint()
        self.assertEqual(messages(rep), [])
        found = [w for w in messages(rep, "warning") if "Source URL" in w]
        self.assertEqual(len(found), 1, found)
        self.assertIn("https://example.org/unverified", found[0])
        # The URL is verified in G101-F02 of the cited dossier: provenance holds even though the
        # pointer names G101-F01 only (dossier-wide match, T31-F05).
        self.fx.reference(rule(source="- **Source:** [X](https://www.example.org/x) · dossier: "
                                      "dead-code-evidence G101-F01"))
        self.assertFalse(any("Source URL" in w for w in self.warnings()))
        self.fx.reference(rule(source="- **Source:** [X](https://www.example.org/x) · dossier: "
                                      "dead-code-evidence G101-F01, G101-F02"))
        self.assertFalse(any("Source URL" in w for w in self.warnings()))

    def test_http_url_in_dossier_and_issue_number_count_as_verified(self) -> None:
        self.fx.write("research/dead-code-evidence.md",
                      "# D\n\n### G101-F01 — A\n- [P](http://example.org/plain)\n"
                      "- The titles of Ruff #18806 and #6148 are confirmed.\n")
        self.fx.reference(rule(source="- **Source:** [P](https://example.org/plain); "
                                      "[I](https://github.com/astral-sh/ruff/issues/18806) · "
                                      "dossier: dead-code-evidence G101-F01"))
        self.assertFalse(any("Source URL" in w for w in self.warnings()))
        self.fx.reference(rule(source="- **Source:** "
                                      "[I](https://github.com/astral-sh/ruff/issues/99999) · "
                                      "dossier: dead-code-evidence G101-F01"))
        self.assertTrue(any("Source URL" in w for w in self.warnings()))

    def test_shared_finding_id_without_slug_warns(self) -> None:
        self.fx.write("research/other-dossier.md",
                      "# Other\n\n### G101-F01 — Same id, other dossier\n"
                      "- [Paper](https://example.org/paper)\n")
        body = rule(source="- **Source:** [Paper](https://example.org/paper) · dossier: "
                           "dead-code-evidence G101-F02")
        body = body.replace("Do not treat", "Per G101-F01, do not treat")
        self.fx.reference(body)
        found = [w for w in self.warnings() if "several dossiers" in w]
        self.assertEqual(len(found), 1, found)
        self.assertIn("G101-F01", found[0])
        # Naming the id after its slug in the pointer resolves the ambiguity.
        self.fx.reference(body.replace("G101-F02", "G101-F01, G101-F02"))
        self.assertFalse(any("several dossiers" in w for w in self.warnings()))

    def test_long_asset_without_contents_warns(self) -> None:
        self.fx.write("assets/report-template.md", "# Report\n" + "line\n" * 120)
        self.assertTrue(any("assets/report-template.md" in w and "Contents" in w
                            for w in self.warnings()))
        self.fx.write("assets/report-template.md", "# Report\n## Contents\n" + "line\n" * 120)
        self.assertFalse(any("assets/report-template.md" in w for w in self.warnings()))
        self.assertEqual(messages(self.fx.lint()), [])


class SkillMdTest(unittest.TestCase):
    def setUp(self) -> None:
        self.fx = SkillFixture()

    def tearDown(self) -> None:
        self.fx.cleanup()

    def errors_for(self, skill_md: str) -> List[str]:
        self.fx.write("SKILL.md", skill_md)
        return messages(self.fx.lint())

    def test_too_many_lines(self) -> None:
        errs = self.errors_for(SKILL_MD + "line\n" * 500)
        self.assertTrue(any("keep SKILL.md at or under 500" in e for e in errs), errs)

    def test_missing_frontmatter(self) -> None:
        errs = self.errors_for("# no frontmatter\nreferences/lens-dead-code.md\n")
        self.assertTrue(any("no YAML frontmatter" in e for e in errs), errs)

    def test_description_too_long(self) -> None:
        long_desc = "Reviews code. " * 80
        errs = self.errors_for(SKILL_MD.replace(
            "description: Independent, evidence-based hardening review of a finished codebase. "
            "Use when a project is feature-complete and its tests pass.",
            f"description: {long_desc}"))
        self.assertTrue(any("description has" in e for e in errs), errs)

    def test_block_scalar_description_is_parsed(self) -> None:
        front, _ = cr.parse_frontmatter(["---", "name: harden", "description: >-",
                                         "  First line", "  second line", "---"])
        self.assertEqual(front["description"], "First line second line")

    def test_model_invocation_must_be_disabled(self) -> None:
        errs = self.errors_for(SKILL_MD.replace("disable-model-invocation: true",
                                                "disable-model-invocation: false"))
        self.assertTrue(any("disable-model-invocation: true" in e for e in errs), errs)

    def test_name_must_match_directory(self) -> None:
        errs = self.errors_for(SKILL_MD.replace("name: harden", "name: hardener"))
        self.assertTrue(any("does not match the directory" in e for e in errs), errs)
        errs = self.errors_for(SKILL_MD.replace("name: harden", "name: Harden_Skill"))
        self.assertTrue(any("lowercase letters" in e for e in errs), errs)

    def test_bare_bash_in_allowed_tools(self) -> None:
        errs = self.errors_for(SKILL_MD.replace("disable-model-invocation: true",
                                                "disable-model-invocation: true\nallowed-tools: Read, Grep, Bash"))
        self.assertTrue(any("bare Bash" in e for e in errs), errs)

    def test_mentioned_file_must_exist(self) -> None:
        errs = self.errors_for(SKILL_MD + "\nRun scripts/missing_tool.py first.\n")
        self.assertTrue(any("scripts/missing_tool.py" in e for e in errs), errs)

    def test_orphan_reference_warns(self) -> None:
        self.fx.write("references/lens-duplication.md", "# Duplication\n")
        rep = self.fx.lint()
        self.assertTrue(any("never mentioned in SKILL.md" in m for m in messages(rep, "warning")))

    def test_missing_skill_md(self) -> None:
        (self.fx.dir / "SKILL.md").unlink()
        self.assertTrue(any("SKILL.md is missing" in e for e in messages(self.fx.lint())))


class DossierPointerTest(unittest.TestCase):
    def test_parse_pointer(self) -> None:
        pairs = cr.parse_dossier_pointer(
            "[x](https://a.b) · dossier: skill-design T31-F05, T31-F10; standards T01-F01 (corrected)",
            known_slugs={"skill-design", "standards"})
        self.assertEqual(pairs, [("skill-design", ["T31-F05", "T31-F10"]), ("standards", ["T01-F01"])])


class CliTest(unittest.TestCase):
    def run_cli(self, *args: str) -> subprocess.CompletedProcess:
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        return subprocess.run([sys.executable, str(SCRIPTS / "check_rules.py"), *args],
                              capture_output=True, env=env, timeout=120)

    def test_exit_codes(self) -> None:
        fx = SkillFixture()
        try:
            ok = self.run_cli(str(fx.dir), "--json")
            self.assertEqual(ok.returncode, 0, ok.stdout)
            self.assertTrue(json.loads(ok.stdout.decode("utf-8"))["ok"])
            fx.reference(rule(drop="Rule"))
            self.assertEqual(self.run_cli(str(fx.dir)).returncode, 1)
            self.assertEqual(self.run_cli(str(fx.dir / "nope")).returncode, 2)
        finally:
            fx.cleanup()


if __name__ == "__main__":
    unittest.main()
