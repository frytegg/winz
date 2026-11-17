"""Tests for scripts/dead_history.py (run: python -m unittest discover -s scripts/tests -p "test_dead_history.py")."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest import mock

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))

import dead_history as H  # noqa: E402

HAS_GIT = shutil.which("git") is not None

CSV = "export function toCsv(rows: string[]): string {\n  return rows.join(',');\n}\n"
CLI_CALL = "import { toCsv } from './csv';\nexport function main() { return toCsv([]); }\n"
CLI_NONE = "export function main() { return ''; }\n"


@unittest.skipUnless(HAS_GIT, "git is needed")
class DeadHistoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        (self.root / "nohooks").mkdir()
        self.git("init", "-q", "-b", "main")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def git(self, *args: str) -> str:
        cmd = ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", "-c",
               "commit.gpgsign=false", "-c",
               "core.hooksPath=" + (self.root / "nohooks").as_posix(), *args]
        return subprocess.run(cmd, cwd=str(self.repo), capture_output=True,
                              check=True).stdout.decode("utf-8")

    def commit(self, message: str, files: Dict[str, Optional[str]]) -> str:
        for rel, text in files.items():
            path = self.repo / rel
            if text is None:
                path.unlink()
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(text.encode("utf-8"))
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD").strip()

    def run_tool(self, *args: str) -> List[Dict[str, Any]]:
        out = self.root / "out.json"
        extra = list(args)
        if "--profile" not in extra and "--future-work-none" not in extra \
                and "--future-work" not in extra:
            extra += ["--profile", str(self.root / "no-profile.json")]
        code = H.main(["--repo", str(self.repo), "--out", str(out)] + extra)
        self.assertEqual(code, 0)
        return json.loads(out.read_text(encoding="utf-8"))["symbols"]

    def orphan_history(self, removal_message: str = "feat: drop the --csv output") -> str:
        self.commit("feat: csv export", {"src/csv.ts": CSV, "src/cli.ts": CLI_CALL})
        orphan = self.commit(removal_message, {"src/cli.ts": CLI_NONE})
        return orphan

    def test_orphaned_by_explicit_removal_is_e2_eligible(self) -> None:
        orphan = self.orphan_history()
        self.commit("docs: readme", {"README.md": "x\n"})
        rec = self.run_tool("toCsv@src/csv.ts")[0]
        self.assertEqual(rec["event"], "orphaned")
        self.assertEqual(rec["orphaned_in"]["sha"], orphan)
        self.assertTrue(rec["explicit_removal"])
        self.assertEqual(rec["later_commits"], 1)
        self.assertFalse(rec["wip"], rec["wip_reasons"])
        self.assertEqual(rec["evidence_level"], "E2 eligible")
        self.assertTrue(any(c.startswith("grep -c -w -F") for c in rec["commands"]))

    def test_orphaning_commit_at_base_is_wip(self) -> None:
        self.orphan_history()
        rec = self.run_tool("toCsv@src/csv.ts")[0]
        self.assertTrue(rec["wip"])
        self.assertIn("event is the base commit", rec["wip_reasons"])

    def test_removal_word_gone_is_not_explicit(self) -> None:
        self.orphan_history("refactor(cli): the csv flag is gone")
        self.commit("docs: readme", {"README.md": "x\n"})
        rec = self.run_tool("toCsv@src/csv.ts")[0]
        self.assertFalse(rec["explicit_removal"])
        self.assertEqual(rec["evidence_level"], "E1 at most")

    def never_referenced(self) -> None:
        self.commit("feat: csv helper", {"src/csv.ts": CSV, "src/cli.ts": CLI_NONE})
        self.commit("docs: readme", {"README.md": "x\n"})

    def test_never_referenced_with_live_none_answer_is_not_wip(self) -> None:
        self.never_referenced()
        rec = self.run_tool("toCsv@src/csv.ts", "--future-work-none")[0]
        self.assertEqual(rec["event"], "never-referenced")
        self.assertFalse(rec["wip"], rec["wip_reasons"])
        self.assertEqual(rec["evidence_level"], "E1 at most")

    def test_profile_empty_future_work_counts_as_unknown(self) -> None:
        self.never_referenced()
        profile = self.root / "profile.json"
        profile.write_text(json.dumps({"version": 1, "future_work": []}), encoding="utf-8")
        rec = self.run_tool("toCsv@src/csv.ts", "--profile", str(profile))[0]
        self.assertEqual(rec["future_work"], "unknown")
        self.assertTrue(rec["wip"])
        self.assertIn("never referenced and no declared future work", rec["wip_reasons"])

    def test_declared_future_work_glob_is_wip(self) -> None:
        self.never_referenced()
        rec = self.run_tool("toCsv@src/csv.ts", "--future-work", "src/**")[0]
        self.assertEqual(rec["future_work"], "covered")
        self.assertIn("declared future work", rec["wip_reasons"])

    def test_unmerged_branch_reference_is_wip(self) -> None:
        self.orphan_history()
        self.commit("docs: readme", {"README.md": "x\n"})
        self.git("checkout", "-q", "-b", "feature")
        self.commit("feat: use csv again", {"src/other.ts": "export const x = toCsv;\n"})
        self.git("checkout", "-q", "main")
        rec = self.run_tool("toCsv@src/csv.ts")[0]
        self.assertEqual(rec["other_refs"], ["refs/heads/feature"])
        self.assertTrue(rec["wip"])

    def test_marker_above_definition_is_wip(self) -> None:
        self.commit("feat: csv export", {"src/csv.ts": CSV, "src/cli.ts": CLI_CALL})
        self.commit("feat: drop the --csv output",
                    {"src/cli.ts": CLI_NONE, "src/csv.ts": "// TODO: wire into the cli\n" + CSV})
        self.commit("docs: readme", {"README.md": "x\n"})
        rec = self.run_tool("toCsv@src/csv.ts")[0]
        self.assertTrue(rec["wip"])
        self.assertEqual(rec["wip_markers"][0]["where"], "definition")
        self.assertIn("TODO", rec["wip_markers"][0]["text"])

    def test_revived_then_removed_uses_latest_orphaning(self) -> None:
        self.orphan_history()
        self.commit("feat: csv again", {"src/cli.ts": CLI_CALL})
        latest = self.commit("chore: remove csv once more", {"src/cli.ts": CLI_NONE})
        self.commit("docs: readme", {"README.md": "x\n"})
        rec = self.run_tool("toCsv@src/csv.ts")[0]
        self.assertEqual(rec["orphaned_in"]["sha"], latest)

    def test_referenced_at_base_reports_count(self) -> None:
        self.commit("feat: csv export", {"src/csv.ts": CSV, "src/cli.ts": CLI_CALL})
        rec = self.run_tool("toCsv@src/csv.ts")[0]
        self.assertEqual(rec["event"], "referenced-at-base")
        self.assertTrue(rec["evidence_level"].startswith("n/a: referenced at base (2 occurrences"))

    def test_rename_of_defining_file_is_not_a_reference(self) -> None:
        orphan = self.orphan_history()
        self.git("mv", "src/csv.ts", "src/lib_csv.ts")
        self.git("commit", "-q", "-m", "refactor: move csv")
        rec = self.run_tool("toCsv@src/lib_csv.ts")[0]
        self.assertEqual(rec["event"], "orphaned")
        self.assertEqual(rec["orphaned_in"]["sha"], orphan)
        self.assertEqual(rec["later_commits"], 1)

    def test_symbols_from_ts_program_json_takes_unreferenced_and_test_only(self) -> None:
        self.never_referenced()
        tsp = self.root / "ts-program.json"
        tsp.write_text(json.dumps({"tool": "ts_program.py", "symbols": [
            {"name": "toCsv", "file": "src/csv.ts", "status": "unreferenced"},
            {"name": "main", "file": "src/cli.ts", "status": "public-api"},
            {"name": "helper", "file": "src/cli.ts", "status": "test-only"}]}),
            encoding="utf-8")
        recs = self.run_tool("--symbols-from", str(tsp))
        self.assertEqual([(r["symbol"], r["file"]) for r in recs],
                         [("toCsv", "src/csv.ts"), ("helper", "src/cli.ts")])

    def test_fixed_string_symbol_with_dollar(self) -> None:
        self.commit("feat: dollar", {"src/d.ts": "export const $helper = 1;\n",
                                     "src/u.ts": "import { $helper } from './d';\n"})
        rec = self.run_tool("$helper@src/d.ts")[0]
        self.assertEqual(rec["event"], "referenced-at-base")

    def test_truncated_history_is_wip(self) -> None:
        self.orphan_history()
        self.commit("feat: csv again", {"src/cli.ts": CLI_CALL})
        self.commit("chore: remove csv once more", {"src/cli.ts": CLI_NONE})
        self.commit("docs: readme", {"README.md": "x\n"})
        rec = self.run_tool("toCsv@src/csv.ts", "--max-commits", "1")[0]
        self.assertTrue(rec["truncated"])
        self.assertIsNone(rec["introduced_in"])
        self.assertIn("history truncated at --max-commits", rec["wip_reasons"])
        self.assertTrue(rec["wip"])

    def test_timeout_marks_remaining_symbols_not_checked(self) -> None:
        self.orphan_history()
        self.commit("docs: readme", {"README.md": "x\n"})
        ticks = iter([0.0, 0.0, 1000.0, 1000.0])
        with mock.patch.object(H, "_now", side_effect=lambda: next(ticks)):
            recs = self.run_tool("toCsv@src/csv.ts", "main@src/cli.ts", "--timeout", "10")
        self.assertEqual(recs[0]["event"], "orphaned")
        self.assertEqual(recs[1]["event"], "not-checked")
        self.assertTrue(recs[1]["wip"])
        self.assertEqual(recs[1]["wip_reasons"], ["time budget spent"])

    def test_empty_input_exit_0(self) -> None:
        self.never_referenced()
        self.assertEqual(self.run_tool(), [])

    def test_not_a_repo_exit_2(self) -> None:
        plain = self.root / "plain"
        plain.mkdir()
        self.assertEqual(H.main(["--repo", str(plain), "a@b.ts"]), 2)
        self.never_referenced()
        self.assertEqual(H.main(["--repo", str(self.repo), "--base", "nope", "a@b.ts"]), 2)
        self.assertEqual(H.main(["--repo", str(self.repo), "not-a-spec"]), 2)

    def test_backslash_path_argument(self) -> None:
        self.orphan_history()
        self.commit("docs: readme", {"README.md": "x\n"})
        rec = self.run_tool("toCsv@src\\csv.ts")[0]
        self.assertEqual(rec["file"], "src/csv.ts")
        self.assertEqual(rec["event"], "orphaned")

    def test_missing_file_is_not_found_and_wip(self) -> None:
        self.never_referenced()
        rec = self.run_tool("toCsv@src/missing.ts")[0]
        self.assertEqual(rec["event"], "not-found")
        self.assertTrue(rec["wip"])


if __name__ == "__main__":
    unittest.main()
