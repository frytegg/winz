"""The exec.py command surface (contract/CLI.md 9 and 0.1-0.2, MODULES.md 5 cli; LANES.md B01; TESTS.md 1.7).

Protects: every command word of CLI.md section 9 parses with its documented options; global options before or after
the command words; an unknown command or a bad flag is exit 2 with an E_USAGE envelope (never argparse's own output);
a missing handler is E_NOT_IMPLEMENTED exit 3; an uncaught handler exception is E_INTERNAL exit 3 with a logged
traceback; stdout holds exactly one JSON line and stderr only JSON log lines (checked by _support.run_exec).

Run: python -m unittest discover -s scripts/tests -p "test_cli.py" -v
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import unittest
from unittest import mock

import _support as S
from execlib import cli, errors
from execlib.errors import UsageError

CLI_MD = S.SKILL_DIR / "contract" / "CLI.md"

# Minimal valid argv per command (required options only).
MINIMAL: dict[str, list[str]] = {
    "init": ["--project", "queue-clock"],
    "hooks canary": ["--nonce", "0123456789abcdef"],
    "agents probe-check": ["--result", "r.json"],
    "heartbeat record": ["--cron-id", "c1", "--expr", "7,27,47 * * * *"],
    "amend": ["--decision", "D-004", "--patch", "p.json"],
    "decision propose": ["--kind", "cut", "--title", "Cut T007"],
    "decision resolve": ["--id", "D-004"],
    "task set-status": ["--task", "T001", "--to", "ready", "--reason", "r", "--decision", "D-004"],
    "wave launched": ["--wave", "W01"],
    "wave ingest": ["--wave", "W01"],
    "result put": ["--wave", "W01", "--role", "implementer", "--attempt", "1", "--file", "f.json"],
    "merge": ["--task", "T001", "--attempt", "1", "--wave", "W01"],
    "fe-workspace": ["--task", "T001", "--attempt", "1"],
    "snapshot": ["--task", "T001", "--attempt", "1", "--paths", "src/a.ts", "--message-file", "m.txt"],
    "proof run": ["--task", "T001", "--sha", "1" * 40],
    "proof verdict": ["--task", "T001", "--run", "R", "--verdict", "pass", "--findings", "f.json", "--attempt", "1",
                      "--model", "sonnet", "--effort", "medium"],
    "notion ack": ["--batch", "N-1", "--op", "op-1"],
    "fix": ["--report", "r.md"],
    "fixture new": ["--dest", "d"],
}


def cli_md_commands() -> list[str]:
    """Command words from CLI.md section 9's quick index (the first column, 'a / b / c' expanded)."""
    text = CLI_MD.read_text(encoding="utf-8")
    section = text.split("## 9. Quick index", 1)[1]
    words: list[str] = []
    for line in section.split("\n"):
        m = re.match(r"^\| ([a-z][a-z -/]*?) \|", line)
        if not m or m.group(1) == "command":
            continue
        cell = m.group(1).strip()
        parts = [p.strip() for p in cell.split("/")]
        head = parts[0].split(" ")
        prefix = " ".join(head[:-1]) if len(head) > 1 else ""
        for i, part in enumerate(parts):
            words.append(part if i == 0 or not prefix else f"{prefix} {part}")
    return words


def in_process(argv: list[str]) -> tuple[int, dict, list[dict]]:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = cli.main(argv)
    lines = [ln for ln in out.getvalue().split("\n") if ln]
    assert len(lines) == 1, out.getvalue()
    logs = [json.loads(ln) for ln in err.getvalue().split("\n") if ln.strip()]
    return code, json.loads(lines[0]), logs


class Surface(unittest.TestCase):
    def test_every_quick_index_command_has_a_spec(self) -> None:
        words = cli_md_commands()
        self.assertGreaterEqual(len(words), 50, words)
        self.assertEqual(sorted(set(words)), sorted(cli.SPECS), "CLI.md section 9 and cli.COMMANDS differ")

    def test_every_command_parses(self) -> None:
        parser = cli.build_parser()
        for spec in cli.COMMANDS:
            with self.subTest(command=spec.words):
                argv = spec.words.split(" ") + MINIMAL.get(spec.words, [])
                ns = parser.parse_args(argv)
                self.assertEqual(cli.words_of(ns), spec.words)
                self.assertEqual(ns.by_role if hasattr(ns, "by_role") else "orchestrator", "orchestrator")

    def test_documented_options(self) -> None:
        p = cli.build_parser()
        ns = p.parse_args(["merge", "--task", "T003", "--attempt", "2", "--wave", "W04", "--rerun", "1",
                           "--single-tree", "--message-file", "m.txt", "--by", "implementer"])
        self.assertEqual((ns.task, ns.attempt, ns.rerun, ns.single_tree, ns.by_role),
                         ("T003", 2, 1, True, "implementer"))
        ns = p.parse_args(["answers", "ingest", "--key", "T004-tx", "--text-file", "a.txt", "--source", "terminal",
                           "--task", "T004", "--by", "devB", "--attachment", "x.png", "--attachment", "y.png"])
        self.assertEqual((ns.by, ns.attachments, ns.by_role), ("devB", ["x.png", "y.png"], "orchestrator"))
        ns = p.parse_args(["decision", "resolve", "--id", "D-004", "--choice-file", "c.txt", "--by", "owner",
                           "--source", "notion", "--quote-file", "q.txt"])
        self.assertEqual((ns.by, ns.source), ("owner", "notion"))
        ns = p.parse_args(["result", "put", "--wave", "W00", "--role", "planner", "--attempt", "1", "--file", "f"])
        self.assertEqual((ns.role, ns.task), ("planner", None))
        ns = p.parse_args(["manual", "post", "--task", "T004", "--task", "T005", "--repost", "--link", "https://x"])
        self.assertEqual(ns.tasks, ["T004", "T005"])
        ns = p.parse_args(["snapshot", "--task", "T1", "--attempt", "1", "--paths", "a", "b", "--message-file", "m"])
        self.assertEqual(ns.paths, ["a", "b"])
        ns = p.parse_args(["task", "set-status", "--task", "T001", "--to", "done", "--reason", "r", "--decision",
                           "D-001"])
        self.assertEqual(ns.to, "done", "built/verifying/done parse; the handler refuses them with exit 4")

    def test_globals_before_and_after(self) -> None:
        p = cli.build_parser()
        before = p.parse_args(["--pretty", "--executor", "B", "--now", S.FIXED_NOW, "status", "--digest"])
        after = p.parse_args(["status", "--digest", "--pretty", "--executor", "B", "--now", S.FIXED_NOW])
        middle = p.parse_args(["wave", "--pretty", "emit", "--executor", "B"])
        for ns in (before, after):
            self.assertEqual((ns.pretty, ns.executor, ns.now, ns.digest), (True, "B", S.FIXED_NOW, True))
        self.assertEqual((middle.pretty, middle.executor), (True, "B"))
        plain = p.parse_args(["status"])
        self.assertEqual((plain.pretty, plain.executor, plain.by_role, plain.repo), (False, None, "orchestrator",
                                                                                     None))

    def test_usage_errors_raise(self) -> None:
        p = cli.build_parser()
        for argv in (["frobnicate"], [], ["wave"], ["merge", "--task", "T001"], ["result", "put", "--wave", "W01",
                                                                                   "--role", "x", "--attempt",
                                                                                   "one", "--file", "f"],
                     ["status", "--bogus"], ["--by", "hacker", "status"]):
            with self.subTest(argv=argv), self.assertRaises(UsageError):
                p.parse_args(argv)

    def test_guess_command(self) -> None:
        self.assertEqual(cli.guess_command(["--now", S.FIXED_NOW, "wave", "emit", "--x"]), "wave emit")
        self.assertEqual(cli.guess_command(["status", "--bogus"]), "status")
        self.assertEqual(cli.guess_command([]), "exec")
        self.assertEqual(cli.guess_command(["/x"]), "exec")


class Subprocess(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def test_unknown_command_exit_2(self) -> None:
        code, env, logs = S.run_exec(["frobnicate"], cwd=self.tmp)
        self.assertEqual((code, env["errors"][0]["code"], env["command"]), (2, "E_USAGE", "frobnicate"))
        self.assertTrue(logs, "the failure is logged")

    def test_bad_flag_exit_2(self) -> None:
        code, env, _ = S.run_exec(["result", "put", "--wave", "W01", "--role", "implementer", "--attempt", "x",
                                   "--file", "f"], cwd=self.tmp)
        self.assertEqual((code, env["command"], env["errors"][0]["code"]), (2, "result put", "E_USAGE"))

    def test_not_implemented_exit_3(self) -> None:
        # A module of another lane may already exist: force a missing one through the dispatch table.
        spec = cli.CommandSpec("quota", "module_that_does_not_exist", "cmd_quota", True)
        with self.assertRaises(errors.InternalError) as cm:
            cli.load_handler(spec)
        self.assertEqual((cm.exception.code, cm.exception.exit_code), ("E_NOT_IMPLEMENTED", 3))
        spec2 = cli.CommandSpec("quota", "envelope", "cmd_absent_function", True)
        with self.assertRaises(errors.InternalError) as cm2:
            cli.load_handler(spec2)
        self.assertEqual(cm2.exception.code, "E_NOT_IMPLEMENTED")
        # positive control: an existing function loads
        self.assertTrue(callable(cli.load_handler(cli.CommandSpec("x", "envelope", "emit", False))))

    def test_not_implemented_through_main(self) -> None:
        fake = {**cli.SPECS, "quota": cli.CommandSpec("quota", "module_that_does_not_exist", "cmd_quota", True)}
        with mock.patch.object(cli, "SPECS", fake), S.patched_env(**S.env_isolated()):
            code, env, _ = in_process(["quota", "--repo", str(self.tmp)])
        self.assertEqual((code, env["exit_code"], env["errors"][0]["code"]), (3, 3, "E_NOT_IMPLEMENTED"))

    def test_internal_error_exit_3_with_traceback(self) -> None:
        def boom(_ctx, _args):  # type: ignore[no-untyped-def]
            raise ZeroDivisionError("injected")
        with mock.patch.object(cli, "load_handler", return_value=boom), S.patched_env(**S.env_isolated()):
            code, env, logs = in_process(["status", "--repo", str(self.tmp)])
        self.assertEqual((code, env["errors"][0]["code"]), (3, "E_INTERNAL"))
        self.assertTrue(any("ZeroDivisionError: injected" in ln.get("traceback", "") for ln in logs))

    def test_handler_receives_ctx(self) -> None:
        seen = {}

        def handler(ctx, args):  # type: ignore[no-untyped-def]
            seen.update(executor=ctx.executor, by=ctx.by, command=ctx.command, now=ctx.now, state=ctx.layout.state)
            from execlib.model import CommandResult
            return CommandResult({"ok": True})
        with S.TempRepo() as repo, mock.patch.object(cli, "load_handler", return_value=handler), \
                S.patched_env(**S.env_isolated()):
            code, env, _ = in_process(["--by", "verifier", "proof", "run", "--task", "T001", "--sha", "1" * 40,
                                       "--executor", "B", "--repo", str(repo.path)])
        self.assertEqual(code, 0)
        self.assertEqual((seen["executor"], seen["by"], seen["command"]), ("B", "verifier", "proof run"))
        self.assertEqual(seen["state"], (repo.path / ".execution").resolve())
        self.assertEqual(seen["now"].isoformat(), "2026-10-03T07:12:00+00:00")

    def test_every_command_dispatches_to_a_valid_envelope(self) -> None:
        from execlib import schema
        from execlib.model import CommandResult
        calls: list[str] = []

        def stub(ctx, _args):  # type: ignore[no-untyped-def]
            calls.append(ctx.command)
            return CommandResult({"command": ctx.command})
        with mock.patch.object(cli, "load_handler", return_value=stub), S.patched_env(**S.env_isolated()):
            for spec in cli.COMMANDS:
                with self.subTest(command=spec.words):
                    argv = spec.words.split(" ") + MINIMAL.get(spec.words, []) + ["--repo", str(self.tmp)]
                    code, env, _logs = in_process(argv)
                    self.assertEqual((code, env["command"], env["data"]), (0, spec.words, {"command": spec.words}))
                    self.assertTrue(schema.validate(env, "envelope").ok)
        self.assertEqual(calls, [c.words for c in cli.COMMANDS])

    def test_bad_now_is_usage(self) -> None:
        code, env, _ = S.run_exec(["validate", "--now", "yesterday"], cwd=self.tmp)
        self.assertEqual((code, env["errors"][0]["code"]), (2, "E_USAGE"))

    def test_inside_state_dir_refused(self) -> None:
        state = self.tmp / ".execution"
        state.mkdir()
        S.git(state, "init", "--quiet", "-b", "main")
        code, env, _ = S.run_exec(["validate"], cwd=state)
        self.assertEqual((code, env["errors"][0]["code"]), (2, "E_USAGE"))


if __name__ == "__main__":
    unittest.main()
