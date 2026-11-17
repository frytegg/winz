"""`exec.py init` (contract/CLI.md 1, SCHEMAS.md 1.1, TESTS.md 5.4, LANES.md B08).

Create; re-run changes no byte; the state repo's `.gitattributes` merges events.jsonl, decisions.md and
public-values.jsonl by union, and a state from before contract revision 3 gains the public-values line when init runs
again; join from the state remote as B; another project's state is exit 1 E_STATE_MISMATCH;
`--pre-t0 --state DIR` then `--import-from` at T0 copies frontend/ and the knowledge files and never a plan; the
exclude lines are added once; a remote `gh` reports PUBLIC is exit 4 with nothing cloned; `.githooks/commit-msg` is
written, `core.hooksPath` set, and the hook refuses an attribution trailer and a non-conventional message and
accepts `feat(x): add y` through a real `git commit`.

Run: python -m unittest discover -s scripts/tests -p "test_init.py" -v
"""
from __future__ import annotations

import json
import unittest
from pathlib import Path

import _support as S
from execlib import jsonio

INIT_A = ["init", "--project", "queue-clock", "--executor", "A"]
# SCHEMAS.md 1.1 (contract revision 3 adds the public-values.jsonl line)
ATTRS = "* text=auto eol=lf\nevents.jsonl merge=union\ndecisions.md merge=union\npublic-values.jsonl merge=union\n"
OLD_ATTRS = "* text=auto eol=lf\nevents.jsonl merge=union\ndecisions.md merge=union\n"


def merge_attr(state_dir: Path, name: str) -> str:
    """The `merge` attribute git applies to `name` in the state repository (union, unspecified, ...)."""
    out = S.git(state_dir, "check-attr", "merge", "--", name).stdout.decode("utf-8")
    return out.strip().rsplit(": ", 1)[-1]


def tree_bytes(root: Path, *, skip_git_objects: bool = True) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if p.is_file() and not (skip_git_objects and "/.git/" in "/" + rel and "/objects/" in rel):
            out[rel] = p.read_bytes()
    return out


class Init(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = S.TempRepo()
        self.remote = self.repo.root / "state.git"
        S.git(self.repo.root, "init", "--quiet", "--bare", "-b", "main", str(self.remote))

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_create_and_rerun_idempotent(self) -> None:
        code, env, _ = S.run_exec(INIT_A + ["--state-remote", self.remote.as_posix()], cwd=self.repo.path)
        self.assertEqual(code, 0, env)
        data = env["data"]
        self.assertTrue(data["created"])
        self.assertFalse(data["cloned"])
        self.assertTrue(data["state_remote_private"])
        self.assertEqual(data["commit_msg_hook"], "written")
        self.assertEqual(data["excluded"], [".execution/", ".claude/settings.local.json", ".claude/worktrees/"])
        sd = self.repo.path / ".execution"
        for d in ("status", "proofs/history", "proofs/runs", "proofs/impl", "proofs/merge", "answers", "briefs",
                  "waves", "reports", "fix", "frontend", "local/locks", "local/hook-events", "local/notion/batches"):
            self.assertTrue((sd / d).is_dir(), d)
        self.assertEqual((sd / ".gitattributes").read_text(encoding="utf-8"), ATTRS)
        self.assertEqual(S.git(sd, "show", "HEAD:.gitattributes").stdout.decode("utf-8"), ATTRS)
        for name in ("events.jsonl", "decisions.md", "public-values.jsonl"):
            self.assertEqual(merge_attr(sd, name), "union", name)
        self.assertEqual(merge_attr(sd, "plan.json"), "unspecified")  # positive control: the check tells them apart
        self.assertEqual((sd / ".gitignore").read_text(encoding="utf-8"), "local/\nfrontend/gates/\n")
        st = jsonio.read_json(sd / "local" / "state.json")
        self.assertEqual((st["run_state"], st["executor"], st["project"]), ("INIT", "A", "queue-clock"))
        types = [json.loads(ln)["type"] for ln in (sd / "events.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual(types, ["run.init", "run.state"])
        self.assertEqual(S.git(self.repo.path, "config", "--get", "core.longpaths").stdout.strip(), b"true")
        self.assertEqual(S.git(self.repo.path, "config", "--get", "core.hooksPath").stdout.strip(), b".githooks")
        heads = S.git(self.repo.root, "ls-remote", "--heads", self.remote.as_posix()).stdout
        self.assertIn(b"refs/heads/main", heads)  # initial commit pushed: B can join
        before_state = tree_bytes(sd)
        before_repo_git = {k: v for k, v in tree_bytes(self.repo.path / ".git").items()
                           if k in ("config", "info/exclude")}
        code2, env2, _ = S.run_exec(INIT_A + ["--state-remote", self.remote.as_posix()], cwd=self.repo.path)
        self.assertEqual(code2, 0, env2)
        self.assertFalse(env2["data"]["created"])
        self.assertEqual(env2["data"]["excluded"], [])
        self.assertEqual(env2["data"]["commit_msg_hook"], "current")
        self.assertEqual(tree_bytes(sd), before_state)
        self.assertEqual({k: v for k, v in tree_bytes(self.repo.path / ".git").items()
                          if k in ("config", "info/exclude")}, before_repo_git)
        exclude = (self.repo.path / ".git" / "info" / "exclude").read_text(encoding="utf-8").split("\n")
        for line in (".execution/", ".claude/settings.local.json", ".claude/worktrees/"):
            self.assertEqual(exclude.count(line), 1)

    def test_rerun_adds_the_public_values_line(self) -> None:
        """A state repository initialised before contract revision 3 gains `public-values.jsonl merge=union` when
        init runs again: the file is rewritten from the asset and committed (the next sync pushes it)."""
        code, env, _ = S.run_exec(INIT_A + ["--state-remote", self.remote.as_posix()], cwd=self.repo.path)
        self.assertEqual(code, 0, env)
        sd = self.repo.path / ".execution"
        S.write_text(sd / ".gitattributes", OLD_ATTRS)
        S.git(sd, "add", "--", ".gitattributes")
        S.git(sd, "commit", "--quiet", "-m", "chore(state): A 20261001T120000Z attributes before revision 3")
        self.assertEqual(merge_attr(sd, "public-values.jsonl"), "unspecified")  # positive control: the old state
        head = S.git(sd, "rev-parse", "HEAD").stdout
        code2, env2, _ = S.run_exec(INIT_A + ["--state-remote", self.remote.as_posix()], cwd=self.repo.path)
        self.assertEqual(code2, 0, env2)
        self.assertFalse(env2["data"]["created"])
        self.assertEqual((sd / ".gitattributes").read_text(encoding="utf-8"), ATTRS)
        self.assertEqual(S.git(sd, "show", "HEAD:.gitattributes").stdout.decode("utf-8"), ATTRS)
        self.assertNotEqual(S.git(sd, "rev-parse", "HEAD").stdout, head)
        self.assertRegex(S.git(sd, "log", "-1", "--format=%s").stdout.decode("utf-8").strip(),
                         r"^chore\(state\): A \d{8}T\d{6}Z init queue-clock$")
        self.assertEqual(merge_attr(sd, "public-values.jsonl"), "union")
        self.assertEqual(S.git(sd, "status", "--porcelain", "--", ".gitattributes", ".gitignore").stdout, b"")

    def test_join_as_b(self) -> None:
        S.run_exec(INIT_A + ["--state-remote", self.remote.as_posix()], cwd=self.repo.path)
        clone_b = self.repo.clone("repo-b")
        code, env, _ = S.run_exec(["init", "--project", "queue-clock", "--executor", "B", "--state-remote",
                                   self.remote.as_posix()], cwd=clone_b)
        self.assertEqual(code, 0, env)
        self.assertTrue(env["data"]["cloned"])
        self.assertFalse(env["data"]["created"])
        st = jsonio.read_json(clone_b / ".execution" / "local" / "state.json")
        self.assertEqual(st["executor"], "B")
        self.assertEqual(S.git(clone_b, "config", "--get", "core.hooksPath").stdout.strip(), b".githooks")

    def test_mismatch(self) -> None:
        S.run_exec(INIT_A, cwd=self.repo.path)
        code, env, _ = S.run_exec(["init", "--project", "other-proj", "--executor", "A"], cwd=self.repo.path)
        self.assertEqual(code, 1)
        self.assertEqual(env["errors"][0]["code"], "E_STATE_MISMATCH")
        code2, env2, _ = S.run_exec(["init", "--project", "queue-clock", "--executor", "B"], cwd=self.repo.path)
        self.assertEqual(code2, 1)
        self.assertEqual(S.run_exec(INIT_A, cwd=self.repo.path)[0], 0)  # positive control

    def test_public_remote_refused(self) -> None:
        url = "https://github.com/example-org/qc-state"
        tools = self.repo.root / "bin"
        S.fake_tool(tools, "gh", 'import json\nprint(json.dumps({"visibility": "PUBLIC", "isPrivate": False}))\n')
        env = S.path_with(tools)
        # No network (LANES.md 1): git rewrites the https URL to the local bare repository, so ls-remote, the clone
        # and the push stay on this machine while the fake gh still answers for the https URL. GIT_ALLOW_PROTOCOL
        # makes git refuse any https transport outright if the rewrite ever stopped applying.
        env.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": f"url.{self.remote.as_uri()}.insteadOf",
                    "GIT_CONFIG_VALUE_0": url, "GIT_ALLOW_PROTOCOL": "file"})
        code, envelope, _ = S.run_exec(INIT_A + ["--state-remote", url], cwd=self.repo.path, env=env)
        self.assertEqual(code, 4)
        self.assertEqual(envelope["errors"][0]["code"], "E_STATE_REMOTE_PUBLIC")
        self.assertFalse((self.repo.path / ".execution").exists())
        self.assertEqual(S.git(self.repo.root, "ls-remote", "--heads", self.remote.as_posix()).stdout, b"")
        # Positive control: the same URL with gh answering PRIVATE passes the check and creates the state.
        S.fake_tool(tools, "gh", 'import json\nprint(json.dumps({"visibility": "PRIVATE", "isPrivate": True}))\n')
        code2, env2, _ = S.run_exec(INIT_A + ["--state-remote", url], cwd=self.repo.path, env=env)
        self.assertEqual(code2, 0, env2)
        self.assertIs(env2["data"]["state_remote_private"], True)
        self.assertTrue(env2["data"]["created"])
        self.assertTrue(env2["data"]["pushed"])
        sd = self.repo.path / ".execution"
        self.assertTrue((sd / "local" / "state.json").is_file())
        self.assertEqual(S.git(sd, "remote", "get-url", "origin").stdout.strip(), url.encode())
        self.assertIn(b"refs/heads/main", S.git(self.repo.root, "ls-remote", "--heads", self.remote.as_posix()).stdout)

    def test_pre_t0_then_import(self) -> None:
        private = self.repo.root / "private"
        pre = private / "execution-pre"
        code, env, _ = S.run_exec(["init", "--project", "queue-clock", "--executor", "A", "--pre-t0", "--state",
                                   str(pre)], cwd=self.repo.root)
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["commit_msg_hook"], "skipped")
        S.write_json(pre / "profile.json", S.build_profile())
        S.write_json(pre / "plan.json", S.build_plan())
        S.write_text(pre / "answers" / "T002-refs.md", "answer\n")
        S.write_json(private / "frontend" / "brief.json", {"brief": True})
        S.write_text(private / "frontend" / "captures" / "shot.txt", "capture\n")
        code2, env2, _ = S.run_exec(INIT_A + ["--import-from", str(pre)], cwd=self.repo.path)
        self.assertEqual(code2, 0, env2)
        sd = self.repo.path / ".execution"
        self.assertTrue((sd / "frontend" / "brief.json").exists())
        self.assertFalse((sd / "frontend" / "captures").exists())
        self.assertTrue((sd / "profile.json").exists())
        self.assertTrue((sd / "answers" / "T002-refs.md").exists())
        self.assertFalse((sd / "plan.json").exists())
        record = jsonio.read_json(sd / "local" / "import.json")
        paths_ = [f["path"] for f in record["files"]]
        self.assertIn("frontend/brief.json", paths_)
        self.assertTrue(all(len(f["sha256"]) == 64 for f in record["files"]))
        self.assertTrue(any("plan.json" in s for s in record["skipped"]))

    def test_pre_t0_needs_state(self) -> None:
        code, env, _ = S.run_exec(["init", "--project", "queue-clock", "--executor", "A", "--pre-t0"],
                                  cwd=self.repo.root)
        self.assertEqual(code, 2)

    def test_commit_msg_hook_through_git(self) -> None:
        S.run_exec(INIT_A, cwd=self.repo.path)
        self.assertTrue((self.repo.path / ".githooks" / "commit-msg").exists())

        def commit(message: str) -> int:
            self.repo.write("notes.md", message + "\n")
            S.git(self.repo.path, "add", "notes.md", env=self.repo.env)
            msg = self.repo.root / "msg.txt"
            S.write_text(msg, message + "\n")
            return S.git(self.repo.path, "commit", "-q", "-F", str(msg), env=self.repo.env, check=False).returncode

        S.assert_controlled(
            self,
            negative=lambda: (self.assertNotEqual(commit("feat(x): add y\n\n" + S.planted("trailer.coauthor")), 0),
                              self.assertNotEqual(commit("fix: z\n\n" + S.planted("trailer.signoff")), 0),
                              self.assertNotEqual(commit("docs: w\n\n" + S.planted("trailer.generated")), 0),
                              self.assertNotEqual(commit("updated stuff"), 0),
                              self.assertNotEqual(commit('Revert "x"'), 0)),
            positive=lambda: self.assertEqual(commit("feat(x): add y"), 0))
        self.assertEqual(commit("docs: explain that attribution trailers are refused"), 0)


if __name__ == "__main__":
    unittest.main()
