"""Git through argv only (contract/MODULES.md 3 gitutil, README.md 8; LANES.md B01).

Protects: a non-fast-forward push is detected as rejected_non_ff (positive control: a fast-forward push lands);
commit_paths refuses a message with an attribution trailer or a "Generated with" line (positive control: a clean
message commits, and a message that merely names the rule is clean); exclude_add is idempotent; no forbidden argument
(force, +refspec, delete, history rewrite, --no-verify, reset --hard) is reachable through Git.run, and no method
issues one (argv spy); the helpers read history, diffs, worktrees and config correctly.

Run: python -m unittest discover -s scripts/tests -p "test_gitutil.py" -v
"""
from __future__ import annotations

import unittest
from unittest import mock

import _support as S
from execlib import gitutil, procutil
from execlib.errors import GitError, PolicyRefused


class GitTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = S.TempRepo()
        self.env = S.patched_env(**self.repo.date_env())
        self.env.__enter__()
        self.git = gitutil.Git(self.repo.path)

    def tearDown(self) -> None:
        self.env.__exit__(None, None, None)
        self.repo.cleanup()

    def test_non_fast_forward_detected(self) -> None:
        other = self.repo.clone("other")
        S.write_text(other / "a.txt", "from other\n")
        S.git(other, "add", "a.txt", env=self.repo.date_env())
        S.git(other, "commit", "-q", "-m", "feat: other", env=self.repo.date_env())
        S.git(other, "push", "-q", "origin", "main", env=self.repo.date_env())
        self.repo.write("b.txt", "mine\n")
        sha = self.git.commit_paths(["b.txt"], "feat: mine", scratch=self.repo.root / "scratch")
        out = self.git.push_head("main")
        self.assertFalse(out.ok)
        self.assertTrue(out.rejected_non_ff, out.stderr_tail)
        # positive control: after fetching and rebasing, the push is a fast-forward and lands
        self.git.fetch()
        self.assertTrue(self.git.rebase("origin/main").ok)
        landed = self.git.push_head("main")
        self.assertTrue(landed.ok and not landed.rejected_non_ff)
        self.git.fetch()
        self.assertTrue(self.git.is_ancestor(self.git.head() or "", "origin/main"))
        self.assertNotEqual(sha, self.git.head(), "the rebase rewrote the local commit, not origin")

    def test_commit_paths_refuses_attribution(self) -> None:
        self.repo.write("x.txt", "x\n")
        for name in ("trailer.coauthor", "trailer.signoff", "trailer.generated"):
            with self.subTest(trailer=name):
                def negative(n: str = name) -> None:
                    with self.assertRaises(PolicyRefused):
                        self.git.commit_paths(["x.txt"], f"feat: add x\n\n{S.planted(n)}\n",
                                              scratch=self.repo.root / "scratch")

                def positive() -> None:
                    assert gitutil.has_attribution(f"feat: x\n\n{S.planted(name)}")

                S.assert_controlled(self, negative, positive)
        self.assertEqual(self.git.status_porcelain(), ["?? x.txt"], "nothing was committed")
        sha = self.git.commit_paths(["x.txt"], "feat: add x\n\nNo attribution trailers in this repository.",
                                    scratch=self.repo.root / "scratch")
        self.assertEqual(sha, self.git.head())
        self.assertEqual(self.git.status_porcelain(), [])
        msgs = self.git.commit_messages("HEAD~1", "HEAD")
        self.assertEqual(msgs, [(sha, "feat: add x\n\nNo attribution trailers in this repository.")])
        self.assertEqual(sorted(p.name for p in (self.repo.root / "scratch").iterdir()), [],
                         "the message file is removed")

    def test_commit_paths_only_named_paths(self) -> None:
        self.repo.write("in.txt", "in\n")
        self.repo.write("out.txt", "out\n")
        self.git.commit_paths(["in.txt"], "feat: only in", scratch=self.repo.root / "scratch")
        self.assertEqual(self.git.ls_files("in.txt", "out.txt"), ["in.txt"])
        self.assertEqual(self.git.untracked(), ["out.txt"])

    def test_exclude_add_idempotent(self) -> None:
        self.assertTrue(self.git.exclude_add(".execution/"))
        self.assertFalse(self.git.exclude_add(".execution/"))
        self.assertTrue(self.git.exclude_add(".claude/worktrees/"))
        text = self.git.git_path("info/exclude").read_text(encoding="utf-8")
        self.assertEqual(text.count(".execution/"), 1)
        self.assertNotIn("\r", text)

    def test_forbidden_args_refused(self) -> None:
        forbidden = [("push", "--force", "origin", "main"), ("push", "-f", "origin", "main"),
                     ("push", "--force-with-lease", "origin", "main"), ("push", "origin", "+HEAD:main"),
                     ("push", "--mirror", "origin"), ("push", "--delete", "origin", "x"),
                     ("push", "origin", ":refs/heads/x"), ("filter-branch", "HEAD"), ("filter-repo",),
                     ("reset", "--hard", "origin/main"), ("commit", "--no-verify", "-m", "x"),
                     ("commit", "-n", "-m", "x")]
        for args in forbidden:
            with self.subTest(args=args), self.assertRaises(PolicyRefused):
                self.git.run(*args)
        # positive controls: the allowed neighbours run
        self.assertEqual(self.git.run("push", "origin", "HEAD:refs/heads/main").exit_code, 0)
        self.git.run("worktree", "prune")
        self.git.run("fetch", "origin", "+refs/heads/*:refs/remotes/origin/*")

    def test_global_options_never_hide_the_subcommand(self) -> None:
        here = str(self.repo.path)
        git_dir = str(self.repo.path / ".git")
        forbidden = [("-C", here, "push", "--force", "origin", "main"),
                     ("--git-dir", git_dir, "push", "origin", "+main"),
                     ("--git-dir", git_dir, "--work-tree", here, "push", "origin", ":refs/heads/x"),
                     ("-C", here, "reset", "--hard"), ("-c", "user.name=x", "reset", "--hard"),
                     ("-c", "core.quotepath", "commit", "-n", "-m", "x"),
                     ("--namespace", "ns", "commit", "--no-verify", "-m", "x"),
                     ("-c", "alias.p=push --force", "p", "origin", "main"),
                     ("-c", "core.hooksPath=/nowhere", "commit", "-m", "x"),
                     ("--config-env", "core.hooksPath=EXEC_NOWHERE", "commit", "-m", "x"),
                     ("-C", here, "filter-branch", "HEAD")]
        for args in forbidden:
            with self.subTest(args=args), self.assertRaises(PolicyRefused):
                self.git.run(*args)
        # positive controls: the same global options in front of an allowed command run
        self.assertEqual(self.git.run("-C", here, "push", "origin", "HEAD:refs/heads/main").exit_code, 0)
        self.assertEqual(self.git.run("--git-dir", git_dir, "--work-tree", here, "status", "--short").exit_code, 0)
        self.assertEqual(self.git.run("-c", "user.name=x", "reset", "--soft", "HEAD").exit_code, 0)

    def test_no_method_issues_a_forbidden_arg(self) -> None:
        seen: list[list[str]] = []
        real = procutil.run

        def spy(argv, **kw):  # type: ignore[no-untyped-def]
            seen.append(list(argv))
            return real(argv, **kw)

        with mock.patch.object(procutil, "run", side_effect=spy):
            self.repo.write("y.txt", "y\n")
            sha = self.git.commit_paths(["y.txt"], "feat: y", scratch=self.repo.root / "scratch")
            self.git.push_head()
            self.git.push_sha(sha)
            self.git.fetch()
            self.git.is_ancestor(sha, "origin/main")
            self.git.rebase("origin/main")
            self.git.resync_to_origin()
            self.git.exclude_add("x/")
            clone = self.git.clone_no_local(self.repo.root / "clone")
            clone.checkout(sha)
            wt = self.repo.root / "wt"
            self.git.run("worktree", "add", "--quiet", "--detach", str(wt), sha)
            self.git.worktree_remove_link_safe(wt)
        self.assertGreater(len(seen), 10)
        for argv in seen:
            words = argv[1:]
            if "push" in words:
                self.assertFalse({"--force", "-f", "--force-with-lease", "--mirror", "--delete"} & set(words), argv)
                self.assertFalse(any(w.startswith("+") for w in words), argv)
            self.assertFalse({"filter-branch", "filter-repo", "--no-verify"} & set(words), argv)
            if "reset" in words:
                self.assertNotIn("--hard", words)

    def test_history_and_diff_helpers(self) -> None:
        base = self.git.head() or ""
        self.repo.write("src/a.ts", "one\ntwo\n")
        self.git.commit_paths(["src/a.ts"], "feat: a", scratch=self.repo.root / "s")
        self.repo.write("src/a.ts", "one\nTWO\nthree\n")
        head = self.git.commit_paths(["src/a.ts"], "fix: a", scratch=self.repo.root / "s")
        self.assertEqual(self.git.changed_paths(base, head), ["src/a.ts"])
        self.assertEqual(list(self.git.added_lines(base, head)), [("src/a.ts", 1, "one"), ("src/a.ts", 2, "TWO"),
                                                                   ("src/a.ts", 3, "three")])
        self.assertEqual([m for _s, m in self.git.commit_messages(base, head)], ["feat: a", "fix: a"])
        self.assertEqual(self.git.rev_parse("HEAD"), head)
        self.assertTrue(self.git.is_ancestor(base, head))
        self.assertFalse(self.git.is_ancestor(head, base))
        with self.assertRaises(GitError):
            self.git.rev_parse("no-such-ref")

    def test_config_and_worktrees(self) -> None:
        self.assertIsNone(self.git.config_get("exec.nothing"))
        self.git.config_set("exec.flag", "on")
        self.assertEqual(self.git.config_get("exec.flag"), "on")
        wt = self.repo.root / "wt2"
        self.git.run("worktree", "add", "--quiet", "-b", "side", str(wt))
        self.assertIn(wt.resolve(), [p.resolve() for p in self.git.worktrees()])
        self.assertEqual(gitutil.Git(wt).common_dir_root(), self.repo.path.resolve())
        self.git.worktree_remove_link_safe(wt)
        self.assertFalse(wt.exists())

    def test_resync_and_ff(self) -> None:
        other = self.repo.clone("o2")
        S.write_text(other / "n.txt", "n\n")
        S.git(other, "add", "n.txt", env=self.repo.date_env())
        S.git(other, "commit", "-q", "-m", "feat: n", env=self.repo.date_env())
        S.git(other, "push", "-q", "origin", "main", env=self.repo.date_env())
        self.git.fetch()
        out = self.git.resync_to_origin()
        self.assertTrue(out["moved"], out)
        self.assertEqual(self.git.head(), self.git.rev_parse("origin/main"))
        self.assertEqual(self.git.status_porcelain(), [" D n.txt"],
                         "files untouched: n.txt moved into the index only, never written to the work tree")
        self.assertFalse((self.repo.path / "n.txt").exists())
        self.git.run("branch", "lane", "HEAD~1")
        self.git.ff("lane", "origin/main")
        self.assertEqual(self.git.rev_parse("lane"), self.git.rev_parse("origin/main"))

    def test_remote_is_private_local(self) -> None:
        self.assertTrue(gitutil.remote_is_private(self.repo.origin.as_posix()))
        self.assertTrue(gitutil.remote_is_private("file:///C:/x/state.git"))
        self.assertIsNone(gitutil.remote_is_private(""))


class FakeGh(unittest.TestCase):
    def test_gh_visibility(self) -> None:
        tmp = S.mkdtemp()
        try:
            for answer, want in (('{"isPrivate": true, "visibility": "PRIVATE"}', True),
                                 ('{"isPrivate": false, "visibility": "PUBLIC"}', False), ("garbage", None)):
                with self.subTest(answer=answer):
                    S.fake_tool(tmp, "gh", f"print({answer!r})")
                    with S.patched_env(PATH=S.path_with(tmp)["PATH"]):
                        self.assertEqual(gitutil.remote_is_private("https://github.com/o/r.git"), want)
        finally:
            S.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
