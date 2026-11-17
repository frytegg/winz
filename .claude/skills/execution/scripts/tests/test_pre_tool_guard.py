"""PreToolUse guard (contract/HOOKS.md 8, TESTS.md 4.4, LANES.md B08).

Binding from the main thread only, the run lease of another session, every deny rule of HOOKS.md 8.4 with its
allowed neighbour (positive control), the role table of SCHEMAS.md 5.3 cell by cell, generic agents under the
strictest rules, foreign agents left alone, the attestation of verifier verdicts, fail-open on a corrupt marker, and
the deny output: one JSON object, `permissionDecision: deny`, a reason starting with its code, exit 0, a
`guard.deny` event whose command excerpt is redacted and at most 120 characters.

Run: python -m unittest discover -s scripts/tests -p "test_pre_tool_guard.py" -v
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

import _support as S
import _support_B08 as B
from execlib import cli, jsonio

sys.path.insert(0, str(S.SCRIPTS_DIR / "hooks"))
import pre_tool_guard as G  # noqa: E402
from execlib import hookcore as hc  # noqa: E402

AGENT = {"agent_id": "agent-7"}
EXEC = f'python "{S.EXEC_PY.as_posix()}"'


class Static(unittest.TestCase):
    """Pure functions of the guard (no subprocess)."""

    def test_command_words_match_cli(self) -> None:
        self.assertEqual(list(hc.COMMAND_WORDS), [c.words for c in cli.COMMANDS])
        self.assertEqual(hc.ORCHESTRATOR_ONLY, frozenset(c.words for c in cli.COMMANDS if c.orchestrator_only))

    def test_tokenizer_bash(self) -> None:
        segs = G.tokenize("echo 'a b' > out.txt && cat x 2>&1 | tee -a log.txt; ls >/dev/null", False)
        self.assertEqual([s.words for s in segs], [["echo", "a b"], ["cat", "x"], ["tee", "-a", "log.txt"], ["ls"]])
        self.assertEqual(segs[0].redirect_targets, ["out.txt"])
        self.assertEqual(segs[1].redirect_targets, [])
        self.assertEqual(G.write_targets(segs[2]), ["log.txt"])
        self.assertEqual(segs[3].redirect_targets, ["/dev/null"])

    def test_tokenizer_powershell_keeps_backslashes(self) -> None:
        segs = G.tokenize(r"Set-Content C:\repo\.execution\plan.json x; & 'C:\p y\python.exe' a", True)
        self.assertEqual(segs[0].words, ["Set-Content", r"C:\repo\.execution\plan.json", "x"])
        self.assertEqual(G.write_targets(segs[0]), [r"C:\repo\.execution\plan.json"])
        self.assertEqual(segs[1].words, [r"C:\p y\python.exe", "a"])
        bash = G.tokenize(r"echo C:\repo\x", False)  # posix tokenizing eats the separators: the reason for 8.5
        self.assertEqual(bash[0].words[1], "C:repox")

    def test_exec_call_parsing(self) -> None:
        seg = G.tokenize(f'{EXEC} --state ".execution" result put --file x.json --by implementer', False)[0]
        call = G.exec_call(seg)
        assert call is not None
        self.assertEqual(call.command, "result put")
        self.assertEqual(call.by, "implementer")
        seg2 = G.tokenize(f"{EXEC} status --digest", False)[0]
        call2 = G.exec_call(seg2)
        assert call2 is not None
        self.assertTrue(G.command_allowed(call2, G.ROLE_COMMANDS["execution-implementer"]))
        seg3 = G.tokenize(f"{EXEC} status", False)[0]
        call3 = G.exec_call(seg3)
        assert call3 is not None
        self.assertFalse(G.command_allowed(call3, G.ROLE_COMMANDS["execution-implementer"]))

    def test_commit_message_is_never_analysed(self) -> None:
        cmd = 'git commit -m "docs: never write .execution/plan.json > x"'
        self.assertNotIn("plan.json", G.without_commit_message(cmd))
        self.assertIn("plan.json", G.without_commit_message("echo .execution/plan.json"))

    def test_glob_match(self) -> None:
        self.assertTrue(G.glob_match("status/**", "status/A.json"))
        self.assertTrue(G.glob_match("C:/p/research/probes/**", "C:/p/research/probes"))
        self.assertTrue(G.glob_match("tests/acceptance/**", "tests/acceptance/a/b.test.mjs"))
        self.assertFalse(G.glob_match("tests/acceptance/**", "tests/unit/a.mjs"))
        self.assertTrue(G.glob_match("src/*.{js,mjs}", "src/a.mjs"))


@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class GuardCase(unittest.TestCase):
    def setUp(self) -> None:
        self.r = B.HookRepo(plan=S.build_plan(protected=["tests/acceptance/**"]))
        self.root = self.r.tmp.root
        self.private = self.root / "private"
        (self.private / "research" / "probes").mkdir(parents=True)
        self.scratch = self.root / "scratch"
        self.allowed_dir = self.root / "allowed"
        self.S = self.r.layout.state.as_posix()
        profile = S.build_profile()
        profile["machine"]["scratch_root"] = self.scratch.as_posix()
        jsonio.write_json_atomic(self.r.layout.profile, profile)
        self.policy = S.build_policy(
            deny_endpoints=[{"pattern": "wq-api.lido.fi", "regex": False, "reason": "the live queue API"}],
            deny_commands=[{"pattern": r"\bdropdb\b", "reason": "databases are never dropped"}],
            fences={"deny_read": [f"{self.private.as_posix()}/research/probes/**"], "deny_write_outside_repo": True,
                    "allow_write_outside": [self.allowed_dir.as_posix()]})
        self.policy["networks"]["mainnet"]["broadcast_patterns"] = [r"cast\s+send.*mainnet"]
        jsonio.write_json_atomic(self.r.layout.policy, self.policy)

    def tearDown(self) -> None:
        self.r.cleanup()

    def call(self, tool: str, tool_input: dict, *, agent: str | None = None, session: str = S.SESSION_ID,
             as_role: str | None = None, **extra: object) -> B.HookRun:
        doc = S.payload("pre_tool.base", tool_name=tool, tool_input=tool_input, session_id=session, **extra)
        if agent is not None:
            doc.update(AGENT)
            doc["agent_type"] = agent
        args = ["--as", as_role] if as_role else None
        res = self.r.run("pre_tool_guard.py", doc, args=args)
        obj = res.obj
        if obj is not None:
            self.assertNotIn("decision", obj)
            self.assertEqual(obj["hookSpecificOutput"]["hookEventName"], "PreToolUse")
            self.assertEqual(obj["hookSpecificOutput"]["permissionDecision"], "deny")
        return res

    def bash(self, command: str, **kw: object) -> B.HookRun:
        return self.call("Bash", {"command": command}, **kw)  # type: ignore[arg-type]

    def write(self, path: str, **kw: object) -> B.HookRun:
        return self.call("Write", {"file_path": path, "content": "x"}, **kw)  # type: ignore[arg-type]

    def denied(self, res: B.HookRun, code: str) -> None:
        reason = res.deny_reason
        self.assertIsNotNone(reason, f"expected {code}, got an allow")
        assert reason is not None
        self.assertTrue(reason.startswith(code + ":"), reason)
        self.assertTrue(reason.endswith("Do not retry in another form."), reason)
        self.assertLessEqual(len(reason), 300)
        ev = self.r.events()[-1]
        self.assertEqual(ev["type"], "guard.deny")
        self.assertEqual(ev["data"]["code"], code)

    def allowed(self, res: B.HookRun) -> None:
        self.assertEqual(res.stdout, b"", res.stdout)

    def deny_and_allow(self, deny: B.HookRun, code: str, allow: B.HookRun) -> None:
        self.allowed(allow)
        self.denied(deny, code)


class Binding(GuardCase):
    # H-PT-01
    def test_bind_from_main_thread(self) -> None:
        self.r.set_marker(session_id=None)
        self.allowed(self.bash(f"{EXEC} hooks canary --nonce ffffffffffffffff", session="sess-new"))
        self.assertIsNone(self.r.marker()["session_id"])  # wrong nonce: nothing bound
        self.allowed(self.bash(f"{EXEC} hooks canary --nonce 0123456789abcdef", session="sess-new"))
        self.assertEqual(self.r.marker()["session_id"], "sess-new")
        types = self.r.event_types()
        self.assertIn("hooks.bound", types)
        canary = [e for e in self.r.events() if e["type"] == "hooks.canary"][-1]
        self.assertTrue(canary["data"]["bound"])
        self.assertEqual(canary["data"]["permission_mode"], "bypassPermissions")
        self.assertEqual(canary["data"]["session_id"], "sess-new")
        # same session again: allow, no rebind
        self.allowed(self.bash(f"{EXEC} hooks canary --nonce 0123456789abcdef", session="sess-new"))
        self.assertFalse([e for e in self.r.events() if e["type"] == "hooks.canary"][-1]["data"]["rebind"])
        # another session: allowed, refused binding recorded, marker unchanged
        self.allowed(self.bash(f"{EXEC} hooks canary --nonce 0123456789abcdef", session="sess-x"))
        last = [e for e in self.r.events() if e["type"] == "hooks.canary"][-1]
        self.assertFalse(last["data"]["bound"])
        self.assertEqual(self.r.marker()["session_id"], "sess-new")

    # H-PT-02 (agents never bind; HOOKS.md 8.4 B5 then denies the O-command: contract question Q-B08-2)
    def test_agent_cannot_bind(self) -> None:
        self.r.set_marker(session_id=None)
        self.r.set_local(hooks={**self.r.local_state()["hooks"], "agent_session_scoped": False})
        res = self.bash(f"{EXEC} hooks canary --nonce 0123456789abcdef", agent="execution-implementer")
        self.assertIsNone(self.r.marker()["session_id"])
        self.assertNotIn("hooks.bound", self.r.event_types())
        self.denied(res, "E_GUARD_COMMAND_ROLE")

    def test_binding_pending_checks_nothing_else(self) -> None:
        self.r.set_marker(session_id=None)
        self.allowed(self.write(".execution/plan.json", session="sess-any"))
        self.r.set_marker(session_id=S.SESSION_ID)  # positive control: bound, the same write is denied
        self.denied(self.write(".execution/plan.json"), "E_GUARD_STATE_PATH")

    # H-PT-21
    def test_run_lease_of_another_session(self) -> None:
        for cmd in ("wave emit", "decision resolve --decision D-001 --choice-file x"):
            with self.subTest(cmd=cmd):
                self.denied(self.bash(f"{EXEC} {cmd}", session="sess-x"), "E_GUARD_RUN_LEASE")
        for cmd in ("status --digest", "resume --takeover", "validate", "simulate", "hooks canary --nonce 1"):
            with self.subTest(cmd=cmd):
                self.allowed(self.bash(f"{EXEC} {cmd}", session="sess-x"))
        self.allowed(self.write(".execution/plan.json", session="sess-x"))  # nothing else checked for that session

    # H-PT-20
    def test_no_marker_and_corrupt_marker(self) -> None:
        self.r.layout.active.write_bytes(b"{not json")
        self.allowed(self.write(".execution/plan.json"))
        lines = self.r.layout.hook_errors.read_text(encoding="utf-8").strip().split("\n")
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["module"], "hook.pre-tool-guard")
        self.r.layout.active.unlink()
        self.allowed(self.write(".execution/plan.json"))
        self.assertEqual(len(self.r.layout.hook_errors.read_text(encoding="utf-8").strip().split("\n")), 1)

    def test_probe_rule(self) -> None:
        res = self.bash("echo execution-probe 0123456789abcdef execution-verifier", agent="execution-verifier",
                        as_role="execution-verifier")
        self.allowed(res)
        ev = self.r.events()[-1]
        self.assertEqual(ev["type"], "hooks.canary")
        self.assertTrue(ev["data"]["probe"])
        self.assertEqual(ev["data"]["layer"], "agent")
        self.assertEqual(ev["data"]["role_resolved"], "execution-verifier")


class EveryoneRules(GuardCase):
    # H-PT-03
    def test_force_push(self) -> None:
        for cmd in ("git push --force origin main", "git push -f", "git push --force-with-lease",
                    "git push --mirror", "git push --delete origin x", "git push origin +main",
                    "git push origin :main"):
            with self.subTest(cmd=cmd):
                self.deny_and_allow(self.bash(cmd), "E_GUARD_FORCE_PUSH", self.bash("git push origin HEAD:main"))
                self.denied(self.bash(cmd, agent="execution-implementer"), "E_GUARD_FORCE_PUSH")

    # H-PT-04
    def test_history_rewrite(self) -> None:
        for cmd in ("git filter-branch --all", "git filter-repo --path x", "git reset --hard origin/main",
                    "git branch -D main"):
            with self.subTest(cmd=cmd):
                self.deny_and_allow(self.bash(cmd), "E_GUARD_FORCE_PUSH", self.bash("git reset --hard HEAD~0"))

    # H-PT-05
    def test_push_freeze(self) -> None:
        self.allowed(self.bash("git push origin HEAD:main"))
        self.r.set_local(flags={"mainnet_open": False, "push_frozen": True})
        self.denied(self.bash("git push origin HEAD:main"), "E_GUARD_PUSH_FROZEN")
        self.r.set_local(flags={"mainnet_open": False, "push_frozen": False})
        self.policy["git"]["push_freeze_utc"] = "2026-10-03T07:00:00Z"
        jsonio.write_json_atomic(self.r.layout.policy, self.policy)
        self.denied(self.bash("git push origin HEAD:main"), "E_GUARD_PUSH_FROZEN")

    # H-PT-06
    def test_mainnet_closed(self) -> None:
        self.deny_and_allow(self.bash("cast send 0x1 --rpc-url https://eth-mainnet.example.invalid"),
                            "E_GUARD_MAINNET_CLOSED",
                            self.bash("cast send 0x1 --rpc-url https://hoodi.example.invalid"))

    # H-PT-07
    def test_endpoints(self) -> None:
        self.deny_and_allow(self.bash("curl https://wq-api.lido.fi/v2/request-time"), "E_GUARD_ENDPOINT",
                            self.bash("curl https://example.invalid/v2/request-time"))
        self.deny_and_allow(self.call("WebFetch", {"url": "https://wq-api.lido.fi/x", "prompt": "p"}),
                            "E_GUARD_ENDPOINT", self.call("WebFetch", {"url": "https://example.invalid/x",
                                                                       "prompt": "p"}))

    def test_deny_commands(self) -> None:
        self.deny_and_allow(self.bash("dropdb queue"), "E_GUARD_DENY_COMMAND", self.bash("createdb queue"))

    # H-PT-08
    def test_read_fence(self) -> None:
        probes = f"{self.private.as_posix()}/research/probes/run1.json"
        ok = f"{self.private.as_posix()}/research/README.md"
        kw = {"agent": "execution-implementer"}
        self.deny_and_allow(self.call("Read", {"file_path": probes}, **kw), "E_GUARD_FENCE_READ",
                            self.call("Read", {"file_path": ok}, **kw))
        self.deny_and_allow(self.call("Grep", {"pattern": "x", "path": f"{self.private.as_posix()}/research/probes"},
                                      **kw), "E_GUARD_FENCE_READ",
                            self.call("Grep", {"pattern": "x", "path": ok}, **kw))
        self.deny_and_allow(self.call("Glob", {"pattern": f"{self.private.as_posix()}/research/probes/*.json"}, **kw),
                            "E_GUARD_FENCE_READ", self.call("Glob", {"pattern": "src/**/*.mjs"}, **kw))
        self.deny_and_allow(self.bash(f"cat {probes}", **kw), "E_GUARD_FENCE_READ", self.bash(f"cat {ok}", **kw))

    # H-PT-09
    def test_orchestrator_state_writes(self) -> None:
        for res in (self.write(".execution/plan.json"),
                    self.call("Edit", {"file_path": ".execution/status/A.json", "old_string": "a",
                                       "new_string": "b"}),
                    self.bash("echo x > .execution/events.jsonl")):
            with self.subTest():
                self.denied(res, "E_GUARD_STATE_PATH")
        self.allowed(self.write(".execution/local/planner/x.json"))
        self.allowed(self.write(".execution/local/profile.draft.json"))
        self.allowed(self.write(".execution/frontend/choices.json"))

    def test_public_values_written_by_exec_py_only(self) -> None:
        """README.md 8, HOOKS.md 8.4 A8 (Q-B10-6): public-values.jsonl is the secret scans' exemption list and exec.py
        alone appends to it, so the main thread's Write, Edit and shell appends are refused (A8) and so are an
        agent's (B1). The allowed neighbours: an agent's write to its own inbox, the orchestrator's own choices file,
        and the exec.py command that registers a value."""
        target = ".execution/public-values.jsonl"
        for res in (self.write(target),
                    self.call("Edit", {"file_path": target, "old_string": "a", "new_string": "b"}),
                    self.bash(f"echo x >> {target}"),
                    self.write(target, agent="execution-verifier")):
            with self.subTest():
                self.denied(res, "E_GUARD_STATE_PATH")
        self.allowed(self.write(".execution/local/inbox/W03/T005.verifier.a1.json", agent="execution-verifier"))
        self.allowed(self.write(".execution/frontend/choices.json"))
        self.allowed(self.bash(f"{EXEC} answers ingest --key T001-tx --text-file t.txt --source terminal --task T001 "
                               "--by devA"))

    def test_settings_backup_written_by_exec_py_only(self) -> None:
        """HOOKS.md 8.4 A8, contract revision 4 (Q-B08-19): local/settings-backup.json holds the owner's settings
        values `hooks install` changed and `hooks uninstall` restores, so the main thread's Write, Edit, shell writes
        and PowerShell writes onto it are refused (A8) and so is an agent's. Allowed neighbours: another file of
        local/ that A8 does not list, and the exec.py command that writes the backup."""
        target = ".execution/local/settings-backup.json"
        native = str(self.r.layout.local / "settings-backup.json").replace("/", "\\")
        for res in (self.write(target),
                    self.call("Edit", {"file_path": target, "old_string": "a", "new_string": "b"}),
                    self.bash(f"echo x > {target}"),
                    self.call("PowerShell", {"command": f"Set-Content {native} x"}),
                    self.write(target, agent="execution-verifier")):
            with self.subTest():
                self.denied(res, "E_GUARD_STATE_PATH")
        self.allowed(self.write(".execution/local/settings-notes.json"))
        self.allowed(self.bash(f"{EXEC} hooks install"))

    def test_settings_files_protected(self) -> None:
        self.deny_and_allow(self.write(".claude/settings.local.json"), "E_GUARD_PROTECTED",
                            self.write(".claude/notes.md"))

    # H-PT-22
    def test_orchestrator_command_role(self) -> None:
        for cmd in ("proof verdict --task T005 --run r", "merge --task T005 --by verifier", "snapshot --task T005"):
            with self.subTest(cmd=cmd):
                self.deny_and_allow(self.bash(f"{EXEC} {cmd}"), "E_GUARD_COMMAND_ROLE", self.bash(f"{EXEC} status"))
        self.allowed(self.bash(f"{EXEC} decision resolve --decision D-001 --choice-file c.txt --by devA"))

    # H-PT-23
    def test_powershell(self) -> None:
        native = str(self.r.layout.plan).replace("/", "\\")
        self.deny_and_allow(self.call("PowerShell", {"command": f"Set-Content {native} x"}), "E_GUARD_STATE_PATH",
                            self.call("PowerShell", {"command": "Get-Date"}))
        self.denied(self.call("PowerShell", {"command": "python exec.py status"}), "E_GUARD_COMMAND_ROLE")
        self.denied(self.call("PowerShell", {"command": "git status"}), "E_GUARD_COMMAND_ROLE")

    # H-PT-18
    def test_env_example_read_never_denied(self) -> None:
        name = S.planted("env.example")
        self.allowed(self.call("Read", {"file_path": name}))
        self.allowed(self.call("Read", {"file_path": name}, agent="execution-implementer"))
        self.denied(self.write(".execution/plan.json"), "E_GUARD_STATE_PATH")  # positive control: the guard fires

    # H-PT-19
    def test_deny_event_redacted(self) -> None:
        key = S.planted("key.private")
        res = self.bash(f"git push --force origin main # {key} " + "y" * 200)
        self.denied(res, "E_GUARD_FORCE_PUSH")
        head = self.r.events()[-1]["data"]["command_head"]
        self.assertLessEqual(len(head), 120)
        self.assertNotIn(key, head)
        self.assertNotIn(key[2:30], head)
        self.assertNotIn(key.encode(), res.stdout)


class AgentRules(GuardCase):
    IMPL = {"agent": "execution-implementer"}

    # H-PT-10
    def test_write_outside(self) -> None:
        self.deny_and_allow(self.write((self.root / "elsewhere" / "x.txt").as_posix(), **self.IMPL),
                            "E_GUARD_WRITE_OUTSIDE",
                            self.write((self.allowed_dir / "x.txt").as_posix(), **self.IMPL))
        self.allowed(self.write((self.scratch / "queue-clock" / "t1" / "x.txt").as_posix(), **self.IMPL))

    # H-PT-11
    def test_inbox_and_proofs(self) -> None:
        self.deny_and_allow(self.write(".execution/proofs/T005.json", **self.IMPL), "E_GUARD_STATE_PATH",
                            self.write(".execution/local/inbox/W03/T005.implementer.a1.json", **self.IMPL))
        self.denied(self.write(".execution/local/notes.json", **self.IMPL), "E_GUARD_STATE_PATH")

    # H-PT-12
    def test_protected_dirs(self) -> None:
        for rel in (".claude/settings.local.json", ".githooks/commit-msg", ".git/config", ".claude/agents/x.md"):
            with self.subTest(rel=rel):
                self.deny_and_allow(self.write(rel, **self.IMPL), "E_GUARD_PROTECTED",
                                    self.write("src/t1/a.mjs", **self.IMPL))

    # H-PT-13
    def test_plan_protected_globs(self) -> None:
        self.deny_and_allow(self.write("tests/acceptance/a.test.mjs", **self.IMPL), "E_GUARD_PROTECTED",
                            self.write("tests/acceptance/a.test.mjs", agent="execution-test-designer"))

    # H-PT-14
    def inproc(self, command: str, agent_type: str) -> str | None:
        """The guard's rules in this process (the 400-cell matrix through subprocesses would take a minute)."""
        doc = B.fill(S.payload("pre_tool.agent", tool_input={"command": command}, agent_type=agent_type), self.r.path)
        hc._STATE["local_state"] = None  # noqa: SLF001 - per-call cache of the hook process
        env = hc.locate(doc)
        assert env is not None
        guard = G.Guard(env, doc, None)
        guard.role = guard.resolve_role()
        try:
            guard.rules_everyone(main_thread=False)
            guard.rules_agents(guard.role)
            guard.rules_role(guard.role)
        except G.Deny as err:
            return err.code
        return None

    def test_role_command_matrix(self) -> None:
        flags = {"status": "--digest", "plan instantiate": "--dry-run", "proof run": "--negative-control"}
        for role in G.ROLE_COMMANDS:
            agent_type = "general-purpose" if role == "generic" else role
            allowed = G.ROLE_COMMANDS[role]
            for word in hc.COMMAND_WORDS:
                plain_ok = word in allowed
                with self.subTest(role=role, word=word):
                    got = self.inproc(f"{EXEC} {word}", agent_type)
                    self.assertEqual(got, None if plain_ok else "E_GUARD_COMMAND_ROLE")
                    flagged = f"{word} {flags[word]}" if word in flags else None
                    if flagged is not None and flagged in allowed and not plain_ok:
                        self.assertIsNone(self.inproc(f"{EXEC} {flagged}", agent_type))
        # the same verdicts through the real launcher for a sample of cells
        self.allowed(self.bash(f"{EXEC} status --digest", agent="execution-verifier"))
        self.denied(self.bash(f"{EXEC} status", agent="execution-verifier"), "E_GUARD_COMMAND_ROLE")
        self.denied(self.bash(f"{EXEC} wave emit", agent="execution-planner"), "E_GUARD_COMMAND_ROLE")

    def test_by_orchestrator_refused_for_agents(self) -> None:
        self.deny_and_allow(self.bash(f"{EXEC} result put --file f --by orchestrator", **self.IMPL),
                            "E_GUARD_COMMAND_ROLE", self.bash(f"{EXEC} result put --file f --by implementer",
                                                              **self.IMPL))

    # H-PT-15
    def test_read_only_roles(self) -> None:
        for role in G.READ_ONLY_ROLES:
            for cmd in ("git commit -F msg.txt", "git push origin HEAD:main", "git rebase origin/main"):
                with self.subTest(role=role, cmd=cmd):
                    self.deny_and_allow(self.bash(cmd, agent=role), "E_GUARD_COMMAND_ROLE",
                                        self.bash("git log --oneline -5", agent=role))
            with self.subTest(role=role, write="src"):
                self.deny_and_allow(self.write("src/t1/a.mjs", agent=role), "E_GUARD_PROTECTED",
                                    self.write(".execution/local/inbox/W03/T005.verifier.a1.json", agent=role))

    def test_reviewer_scratch_review_clone(self) -> None:
        review = (self.scratch / "queue-clock" / "review" / "c1").as_posix()
        self.deny_and_allow(self.bash("git apply x.patch", agent="execution-verifier"), "E_GUARD_COMMAND_ROLE",
                            self.bash(f"git -C {review} apply x.patch", agent="execution-reviewer"))

    # H-PT-16
    def test_connectors(self) -> None:
        for tool in ("mcp__claude_ai_Notion__notion-update-page", "mcp__claude_ai_Gmail__send_message",
                     "PushNotification", "CronCreate", "CronDelete", "RemoteTrigger", "SendMessage", "Monitor",
                     "mcp__other__create_thing"):
            with self.subTest(tool=tool):
                self.deny_and_allow(self.call(tool, {}, **self.IMPL), "E_GUARD_CONNECTOR",
                                    self.call(tool, {}))
        self.allowed(self.call("mcp__other__get_thing", {}, **self.IMPL))

    # H-PT-17
    def test_generic_agents(self) -> None:
        for agent_type in ("general-purpose", "workflow-subagent", ""):
            with self.subTest(agent_type=agent_type):
                self.denied(self.bash(f"{EXEC} merge --task T005", agent=agent_type), "E_GUARD_COMMAND_ROLE")
                self.denied(self.write("tests/acceptance/a.test.mjs", agent=agent_type), "E_GUARD_PROTECTED")
                self.denied(self.write(".execution/plan.json", agent=agent_type), "E_GUARD_STATE_PATH")
                self.allowed(self.bash(f"{EXEC} result put --file f", agent=agent_type))
        self.allowed(self.bash(f"{EXEC} merge --task T005", agent="execution-implementer"))

    def test_role_mismatch_is_generic(self) -> None:
        res = self.bash(f"{EXEC} merge --task T005", agent="execution-verifier", as_role="execution-implementer")
        self.denied(res, "E_GUARD_COMMAND_ROLE")
        self.assertIn("role-mismatch", [e["data"].get("kind") for e in self.r.events() if e["type"] == "error"])
        self.allowed(self.bash(f"{EXEC} merge --task T005", agent="execution-implementer",
                               as_role="execution-implementer"))

    # H-PT-24
    def test_b9_state_paths_in_commands(self) -> None:
        self.denied(self.bash("python -c \"open('.execution/proofs/T1.json','w').write('x')\"", **self.IMPL),
                    "E_GUARD_STATE_PATH")
        self.denied(self.bash("cp x .execution/status/A.json", **self.IMPL), "E_GUARD_STATE_PATH")
        self.allowed(self.bash(f'{EXEC} --state ".execution" result put --file '
                               '.execution/local/inbox/W03/T005.implementer.a1.json', **self.IMPL))

    def test_b8_heredoc_write(self) -> None:
        self.deny_and_allow(self.bash("cat <<'EOF' > notes.md\nhello\nEOF", **self.IMPL), "E_GUARD_COMMAND_ROLE",
                            self.bash("git commit -F - <<'EOF'\nfeat: x\nEOF", **self.IMPL))

    def test_b2_git_in_state_repo(self) -> None:
        self.deny_and_allow(self.bash(f"git -C {self.S} commit -F m.txt", **self.IMPL), "E_GUARD_STATE_PATH",
                            self.bash(f"git -C {self.S} log --oneline", **self.IMPL))

    # H-PT-25
    def test_foreign_agents(self) -> None:
        outside = (self.root / "elsewhere" / "x.txt").as_posix()
        self.r.set_local(hooks={**self.r.local_state()["hooks"], "agent_session_scoped": True})
        before = self.r.snapshot()
        self.allowed(self.write(outside, agent="execution-implementer", session="sess-other"))
        self.assertEqual(self.r.snapshot(), before)
        self.r.set_local(hooks={**self.r.local_state()["hooks"], "agent_session_scoped": False})
        self.denied(self.write(outside, agent="execution-implementer", session="sess-other"),
                    "E_GUARD_WRITE_OUTSIDE")
        harden = self.r.path / ".harden"
        harden.mkdir()
        (harden / "active").write_text("x", encoding="utf-8")
        self.allowed(self.write(outside, agent="execution-implementer", session="sess-other"))
        self.denied(self.write(outside, agent="execution-implementer"), "E_GUARD_WRITE_OUTSIDE")  # bound session

    # H-PT-26
    def test_attestation(self) -> None:
        self.allowed(self.bash(f"{EXEC} proof verdict --task T005 --run T005-11111111-20261003T071200Z-1 "
                               "--verdict pass", agent="execution-verifier"))
        ev = self.r.events()[-1]
        self.assertEqual(ev["type"], "guard.attest")
        self.assertEqual(ev["data"]["task"], "T005")
        self.assertEqual(ev["data"]["run"], "T005-11111111-20261003T071200Z-1")
        self.assertEqual(ev["data"]["agent_id"], "agent-7")
        self.assertEqual(ev["data"]["command"], "proof verdict")
        self.r.clear_events()
        self.allowed(self.bash(f"{EXEC} result put --file f", agent="execution-verifier"))
        self.assertNotIn("guard.attest", self.r.event_types())

    # H-PT-27 (contract question Q-B08-1: HOOKS.md 8.4 gives B1 E_GUARD_STATE_PATH before the C row)
    def test_frontend_state_dir(self) -> None:
        self.allowed(self.write(".execution/frontend/brief.json", **self.IMPL))
        self.denied(self.write(".execution/frontend/brief.json", agent="execution-verifier"), "E_GUARD_STATE_PATH")

    def test_planner(self) -> None:
        self.deny_and_allow(self.write("src/t1/a.mjs", agent="execution-planner"), "E_GUARD_PROTECTED",
                            self.write(".execution/local/planner/plan.draft.json", agent="execution-planner"))

    def test_deny_events_validate(self) -> None:
        from execlib import schema
        self.denied(self.write(".execution/plan.json", **self.IMPL), "E_GUARD_STATE_PATH")
        for ev in self.r.events():
            self.assertTrue(schema.validate(ev, "local-state#/$defs/hook_event").ok, ev)


if __name__ == "__main__":
    unittest.main()
