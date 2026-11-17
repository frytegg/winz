"""Paths and the state layout (contract/MODULES.md 2 paths, SCHEMAS.md 1.1, CLI.md 0.1 and 0.4; LANES.md B01).

Protects: every Layout path matches SCHEMAS.md 1.1; exec_cmd is this machine's absolute command; resolve_repo returns
the main working tree from a linked worktree and refuses `.execution/`; scratch inside a git work tree is refused
(positive control: outside is accepted); the link-safe remover never follows a junction or symlink.

Run: python -m unittest discover -s scripts/tests -p "test_paths.py" -v
"""
from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

import _support as S
from execlib import paths
from execlib.errors import UsageError


class LayoutPaths(unittest.TestCase):
    def test_layout_matches_schemas_1_1(self) -> None:
        root = S.mkdtemp()
        try:
            lay = paths.layout_for(root, None)
            st = (root / ".execution")
            rel = {name: getattr(lay, name).relative_to(st).as_posix() for name in (
                "plan", "plan_candidate", "planner_draft", "profile", "policy", "catalogue_default", "events",
                "decisions", "gates_json", "completion_script", "execution_md", "local", "local_state", "active",
                "hooks_state", "hook_events_dir", "hook_errors", "merge_pending_dir", "timings", "notion_outbox",
                "harden_ready_dir", "completion_dir", "schedule_cache", "digest")}
            self.assertEqual(rel, {
                "plan": "plan.json", "plan_candidate": "local/plan.candidate.json",
                "planner_draft": "local/planner/plan.draft.json", "profile": "profile.json",
                "policy": "policy.json", "catalogue_default": "feature-catalogue.json", "events": "events.jsonl",
                "decisions": "decisions.md", "gates_json": "gates.json", "completion_script": "completion-check.mjs",
                "execution_md": "EXECUTION.md", "local": "local", "local_state": "local/state.json",
                "active": "local/active", "hooks_state": "local/hooks-state.json",
                "hook_events_dir": "local/hook-events", "hook_errors": "local/hook-errors.log",
                "merge_pending_dir": "local/merge-pending", "timings": "local/timings.json",
                "notion_outbox": "local/notion/outbox.jsonl", "harden_ready_dir": "local/harden-ready",
                "completion_dir": "local/completion", "schedule_cache": "local/schedule.json",
                "digest": "local/digest.txt"})
            run_id = "T012-1a2b3c4d-20261006T081500Z-1"
            calls = {
                lay.proof_run_copy("T012", run_id): f"proofs/runs/T012/{run_id}.json",
                lay.impl_copy("T012", 2): "proofs/impl/T012.a2.json",
                lay.merge_copy("T012", 2): "proofs/merge/T012.a2.json",
                lay.merge_intent("T012", 2, 1): "local/merge-pending/T012.a2r1.json",
                lay.status("A"): "status/A.json", lay.status("B"): "status/B.json",
                lay.receipt("T012"): "proofs/T012.json",
                lay.receipt_history("T012", 1): "proofs/history/T012.a1.json",
                lay.result("W03", "T012", "implementer", 1): "local/results/W03/T012.implementer.a1.json",
                lay.result("W03", "T012", "merge", 2): "local/results/W03/T012.merge.a2.json",
                lay.result("W00", None, "planner", 1): "local/results/W00/planner.a1.json",
                lay.inbox("W03"): "local/inbox/W03",
                lay.proof_run_dir("T012", run_id): f"local/proof-runs/T012/{run_id}",
                lay.merge_gates_dir("T012", 1, 0): "local/merge-gates/T012-a1r0/gates",
                lay.answer("T004-tx"): "answers/T004-tx.md",
                lay.wave_script("W03"): "waves/W03.js", lay.wave_manifest("W03"): "waves/W03.json",
                lay.brief("T012", 1): "briefs/T012.a1.md", lay.report("W03"): "reports/W03.fr.md",
                lay.lock("state"): "local/locks/state",
                lay.notion_batch("N-20261006T081500Z-A-1"): "local/notion/batches/N-20261006T081500Z-A-1.json",
            }
            for got, want in calls.items():
                self.assertEqual(got.relative_to(st).as_posix(), want)
            with self.assertRaises(UsageError):
                lay.status("C")
            self.assertEqual(lay.rel(lay.receipt("T001")), "proofs/T001.json")
            self.assertEqual(paths.layout_for(None, root / "elsewhere").state, root / "elsewhere")
            with self.assertRaises(UsageError):
                paths.layout_for(None, None)
            # merge gates never live under local/gates (its parent holds `active`, CLI.md 0.4)
            self.assertNotEqual(lay.merge_gates_dir("T1", 1, 0).parent, lay.local)
        finally:
            S.rmtree(root)

    def test_exec_cmd_and_skill_dir(self) -> None:
        cmd = paths.exec_cmd()
        self.assertTrue(cmd.endswith(f'"{paths.posix(paths.SKILL_DIR)}/scripts/exec.py"'))
        self.assertTrue(cmd.startswith("python " if os.name == "nt" else "python3 "))
        self.assertNotIn("\\", cmd)
        self.assertNotIn("${CLAUDE_SKILL_DIR}", cmd)
        self.assertEqual(paths.SKILL_DIR, S.SKILL_DIR)
        self.assertEqual(paths.skill_path("assets", "schemas"), S.SKILL_DIR / "assets" / "schemas")
        self.assertEqual(paths.other_skill("harden").name, "harden")
        with self.assertRaises(UsageError):
            paths.other_skill("nope")  # type: ignore[arg-type]


class Repo(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = S.TempRepo()

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_resolve_repo_from_tree_and_subdir(self) -> None:
        sub = self.repo.path / "src" / "deep"
        sub.mkdir(parents=True)
        with S.patched_env(**S.env_isolated()):
            self.assertEqual(paths.resolve_repo(self.repo.path, None), self.repo.path)
            self.assertEqual(paths.resolve_repo(sub, None), self.repo.path)
            self.assertEqual(paths.find_repo(sub), self.repo.path)
            self.assertIsNone(paths.find_repo(self.repo.root))
            with self.assertRaises(UsageError):
                paths.resolve_repo(self.repo.root, None)
            self.assertEqual(paths.resolve_repo(Path("/unused"), str(self.repo.path)), self.repo.path)

    def test_resolve_repo_from_linked_worktree(self) -> None:
        wt = self.repo.root / "wt"
        self.repo.git("worktree", "add", "--quiet", "-b", "side", str(wt))
        with S.patched_env(**S.env_isolated()):
            self.assertEqual(paths.resolve_repo(wt, None), self.repo.path)
            (wt / "src").mkdir()
            self.assertEqual(paths.resolve_repo(wt / "src", None), self.repo.path)
            self.assertEqual(S.git(wt, "rev-parse", "--show-toplevel").stdout.decode().strip(), wt.as_posix(),
                             "positive control: git itself sees the linked worktree as its own top level")

    def test_refused_inside_state_dir(self) -> None:
        state = self.repo.path / ".execution"
        state.mkdir()
        S.git(state, "init", "--quiet", "-b", "main")
        with S.patched_env(**S.env_isolated()):
            with self.assertRaises(UsageError):
                paths.resolve_repo(state, None)
            with self.assertRaises(UsageError):
                paths.resolve_repo(Path("."), str(state))
            (state / "local").mkdir()
            with self.assertRaises(UsageError):
                paths.find_repo(state / "local")
            self.assertEqual(paths.resolve_repo(self.repo.path, None), self.repo.path)

    def test_scratch_refused_inside_work_tree(self) -> None:
        inside = S.build_profile()
        inside["machine"]["scratch_root"] = paths.posix(self.repo.path / "scratch")
        outside = S.build_profile()
        outside["machine"]["scratch_root"] = paths.posix(self.repo.root / "scratch")

        def negative() -> None:
            with S.patched_env(**S.env_isolated()), self.assertRaises(UsageError):
                paths.scratch_dir(inside, "queue-clock", "proof")

        def positive() -> None:
            with S.patched_env(**S.env_isolated()):
                got = paths.scratch_dir(outside, "queue-clock", "proof", "r1")
            assert got == self.repo.root / "scratch" / "queue-clock" / "proof" / "r1", got

        S.assert_controlled(self, negative, positive)
        with self.assertRaises(UsageError):
            paths.scratch_dir({}, "queue-clock")


class LinkSafeRemoval(unittest.TestCase):
    def test_junction_target_survives(self) -> None:
        root = S.mkdtemp()
        try:
            target = root / "target"
            (target / "keep").mkdir(parents=True)
            S.write_text(target / "keep" / "file.txt", "precious\n")
            tree = root / "tree"
            (tree / "sub").mkdir(parents=True)
            S.write_text(tree / "sub" / "own.txt", "own\n")
            link = tree / "sub" / "node_modules"
            if os.name == "nt":
                res = subprocess.run(["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
                                     capture_output=True)
                if res.returncode != 0:
                    self.skipTest("cannot create a junction here")
            else:
                os.symlink(target, link, target_is_directory=True)
            self.assertTrue(paths.is_link_like(link))
            self.assertFalse(paths.is_link_like(tree / "sub"))
            paths.rmtree_link_safe(tree)
            self.assertFalse(tree.exists())
            self.assertEqual((target / "keep" / "file.txt").read_text(encoding="utf-8"), "precious\n")
        finally:
            S.rmtree(root)


if __name__ == "__main__":
    unittest.main()
