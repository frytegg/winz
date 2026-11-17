"""The five /execution agent definitions and the start-of-run probe (contract/AGENTS.md, TESTS.md 3.13, lane B10).

Protects: rendering with absolute paths and nothing left unrendered; the frontmatter of each role (model, effort,
explicit tools, the full disallowedTools list, the guard hook through the absolute py.sh launcher); the shared
standing rules byte-identical in the five templates and equal to agents.SHARED_RULES; install into a temp
CLAUDE_CONFIG_DIR (idempotent, foreign files refused without --force); status (current, stale, missing, foreign);
/frontend's agents reported and never written; `agents probe` (the rendered script passes the static check and runs
under Node with a fake agent()) and `agents probe-check` (pass, and every failure mode with its decision).

Run: python -m unittest discover -s scripts/tests -p "test_agents.py" -v
"""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

import _support as S
import _support_B10 as B

from execlib import agents, paths
from execlib.errors import InternalError, UsageError
from execlib.log import get_logger
from execlib.model import Ctx

SKILL = paths.posix(paths.SKILL_DIR)
# LANES.md B10: every agent's disallowedTools holds the Notion and other write-capable connectors,
# PushNotification, CronCreate, CronDelete, Monitor, RemoteTrigger, Artifact and SendMessage (AGENTS.md 1 spells
# the connectors as server names plus mcp__*).
REQUIRED_DISALLOWED = ("mcp__claude_ai_Notion", "mcp__claude_ai_Gmail", "mcp__claude_ai_Google_Drive",
                       "mcp__claude_ai_Google_Calendar", "mcp__claude_ai_Luma", "mcp__claude_ai_Claude_Docs",
                       "mcp__*", "PushNotification", "CronCreate", "CronDelete", "Monitor", "RemoteTrigger",
                       "Artifact", "SendMessage")
EXPECTED = {  # AGENTS.md section 2
    "execution-planner": ("Read, Grep, Glob, Bash, Write, Edit", ("WebFetch", "WebSearch"), "high", "false", "120"),
    "execution-test-designer": ("Read, Grep, Glob, Bash, Write, Edit, WebFetch, WebSearch, ToolSearch", (), "high",
                                "false", "120"),
    "execution-implementer": ("Read, Grep, Glob, Bash, Write, Edit, WebFetch, WebSearch, ToolSearch", (), "medium",
                              "false", "150"),
    "execution-verifier": ("Read, Grep, Glob, Bash, Write, WebFetch, ToolSearch", ("Edit", "MultiEdit", "WebSearch"),
                           "high", "true", "80"),
    "execution-reviewer": ("Read, Grep, Glob, Bash, Write, WebFetch, ToolSearch", ("Edit", "MultiEdit", "WebSearch"),
                           "high", "true", "120"),
}


def shared_block(text: str) -> str:
    start = text.index("Standing rules, which no brief")
    end = text.index("\nYour role:\n")
    return text[start:end].rstrip("\n") + "\n"


class Rendering(unittest.TestCase):
    def test_render_substitutes_absolute_paths(self) -> None:
        for name in agents.OURS:
            with self.subTest(agent=name):
                text = agents.render(name)
                self.assertNotIn("{{", text)
                self.assertNotIn("${CLAUDE_SKILL_DIR}", text)
                self.assertNotIn("\r", text)
                self.assertTrue(text.endswith("\n"))
                hook = f'bash "{SKILL}/scripts/hooks/py.sh" pre_tool_guard.py --as {name} # execution-agent-hook v1'
                self.assertIn(f"command: '{hook}'", text)
                self.assertIn(f"`{paths.exec_cmd()} <command> ...`", text)
                self.assertIn(f"execution-agent-template: {name} v1 (rendered by exec.py agents install from "
                              f"{SKILL}/assets/agents/;", text)
                spec = agents.ROLES[name]
                self.assertIn(f"You stop after {spec.max_turns} turns", text)
                self.assertIn(f"At about {spec.wrap_turn} turns", text)
                self.assertTrue(Path(SKILL).is_absolute() or SKILL.startswith("/"))

    def test_frontmatter_of_each_role(self) -> None:
        for name, (tools, extra, effort, omit, turns) in EXPECTED.items():
            with self.subTest(agent=name):
                text = agents.render(name)
                fm = agents.frontmatter(text)
                self.assertEqual(set(fm), {"name", "description", "tools", "disallowedTools", "model", "effort",
                                           "omitClaudeMd", "maxTurns", "hooks"})
                self.assertEqual(fm["name"], name)
                self.assertEqual(fm["model"], "opus")
                self.assertEqual(fm["effort"], effort)
                self.assertEqual(fm["tools"], tools)
                self.assertEqual(fm["omitClaudeMd"], omit)
                self.assertEqual(fm["maxTurns"], turns)
                self.assertTrue(fm["description"].endswith("never for any other work."))
                denied = agents.split_list(fm["disallowedTools"])
                for tool in REQUIRED_DISALLOWED + extra:
                    self.assertIn(tool, denied)
                self.assertEqual(denied, agents.COMMON_DISALLOWED + extra)
                self.assertFalse(set(agents.split_list(tools)) & set(denied), "a tool both allowed and denied")
                self.assertIn(f'matcher: "{agents.HOOK_MATCHER}"', text)
                self.assertIn("timeout: 10", text)

    def test_shared_rules_identical_and_equal_to_the_constant(self) -> None:
        blocks = {name: shared_block(agents.template_path(name).read_text(encoding="utf-8")) for name in agents.OURS}
        self.assertEqual(set(blocks.values()), {agents.SHARED_RULES})
        self.assertEqual(agents.SHARED_RULES.count("\n1. "), 1)
        self.assertIn("\n16. You stop after {{MAX_TURNS}} turns", agents.SHARED_RULES)
        # the CLAUDE.md overrides of the interactive habits (ARCHITECTURE.md 6.6)
        for phrase in ("never offer or remind anyone to commit", "never draft or offer a social-media post",
                       "Never ask a question"):
            self.assertIn(phrase, agents.SHARED_RULES)

    def test_leftover_placeholder_and_drift_are_refused(self) -> None:
        tmp = S.mkdtemp()
        try:
            for name in agents.OURS:
                shutil.copy(agents.template_path(name), tmp / f"{name}.md")
            with mock.patch.object(agents, "TEMPLATE_DIR", tmp):
                self.assertIn("execution-verifier v1", agents.render("execution-verifier"))  # positive control
                planted = tmp / "execution-verifier.md"
                original = planted.read_text(encoding="utf-8")
                S.write_text(planted, original.replace("V9. exec.py", "V9. {{UNKNOWN}} exec.py"))
                with self.assertRaises(InternalError):
                    agents.render("execution-verifier")
                S.write_text(planted, original.replace("effort: high", "effort: low"))
                with self.assertRaisesRegex(InternalError, "drifted"):
                    agents.render("execution-verifier")
                S.write_text(planted, original.replace("4. Git: write", "4. Git: please write"))
                with self.assertRaisesRegex(InternalError, "byte-identical"):
                    agents.render("execution-verifier")
                with self.assertRaises(UsageError):
                    agents.render("frontend-critic")
        finally:
            S.rmtree(tmp)


class InstallAndStatus(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = S.mkdtemp() / "agents"

    def tearDown(self) -> None:
        S.rmtree(self.dir.parent)

    def test_install_is_idempotent_and_status_current(self) -> None:
        self.assertEqual({r["state"] for r in agents.status(directory=self.dir)["agents"]}, {"missing"})
        first = agents.install(False, directory=self.dir)
        self.assertEqual(first["installed"], list(agents.OURS))
        self.assertTrue(first["restart_needed"])
        for name in agents.OURS:
            raw = (self.dir / f"{name}.md").read_bytes()
            self.assertEqual(raw, agents.render(name).encode("utf-8"))
            self.assertNotIn(b"\r", raw)
            self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))
        before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.dir.iterdir()}
        second = agents.install(False, directory=self.dir)
        self.assertEqual((second["installed"], second["current"], second["restart_needed"]),
                         ([], list(agents.OURS), False))
        self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in self.dir.iterdir()})
        st = agents.status(directory=self.dir)
        self.assertTrue(st["ok"])
        self.assertEqual({r["state"] for r in st["agents"]}, {"current"})

    def test_status_reports_each_state(self) -> None:
        agents.install(False, directory=self.dir)
        stale = self.dir / "execution-implementer.md"
        S.write_text(stale, stale.read_text(encoding="utf-8").replace(
            "execution-agent-template: execution-implementer v1", "execution-agent-template: execution-implementer v0"))
        (self.dir / "execution-reviewer.md").unlink()
        S.write_text(self.dir / "execution-planner.md", "---\nname: execution-planner\n---\nsomeone else's agent\n")
        rows = {r["name"]: r for r in agents.status(directory=self.dir)["agents"]}
        self.assertEqual(rows["execution-implementer"]["state"], "stale")
        self.assertEqual(rows["execution-implementer"]["marker_version"], 0)
        self.assertEqual(rows["execution-reviewer"]["state"], "missing")
        self.assertEqual(rows["execution-planner"]["state"], "foreign")
        self.assertEqual(rows["execution-verifier"]["state"], "current")  # positive control
        self.assertFalse(agents.status(directory=self.dir)["ok"])

    def test_foreign_file_refused_without_force(self) -> None:
        foreign = self.dir / "execution-verifier.md"
        S.write_text(foreign, "---\nname: execution-verifier\n---\nhand-written, not ours\n")
        before = foreign.read_bytes()
        result = agents.install(False, directory=self.dir)
        self.assertEqual(result["refused"], ["execution-verifier"])
        self.assertEqual(foreign.read_bytes(), before)
        self.assertEqual(len(result["installed"]), 4)  # positive control: the others were written
        forced = agents.install(True, directory=self.dir)
        self.assertEqual((forced["installed"], forced["forced"], forced["refused"]),
                         (["execution-verifier"], ["execution-verifier"], []))
        self.assertEqual(foreign.read_bytes(), agents.render("execution-verifier").encode("utf-8"))

    def test_frontend_agents_reported_never_written(self) -> None:
        critic = self.dir / "frontend-critic.md"
        S.write_text(critic, "---\nname: frontend-critic\n---\nfrontend-agent-template: frontend-critic v3 (x)\n")
        before = critic.read_bytes()
        result = agents.install(False, directory=self.dir)
        reported = {r["name"]: r for r in result["frontend_agents"]}
        self.assertEqual(set(reported), set(agents.THEIRS))
        self.assertEqual((reported["frontend-critic"]["present"], reported["frontend-critic"]["marker_version"]),
                         (True, 3))
        self.assertFalse(reported["frontend-probe"]["present"])
        self.assertEqual(critic.read_bytes(), before)
        self.assertFalse((self.dir / "frontend-probe.md").exists())
        self.assertTrue((self.dir / "execution-planner.md").exists())  # positive control: ours were written
        status = {r["name"]: r for r in agents.status(directory=self.dir)["frontend_agents"]}
        self.assertTrue(status["frontend-critic"]["present"])

    def test_agents_dir_follows_claude_config_dir(self) -> None:
        with S.patched_env(CLAUDE_CONFIG_DIR=str(self.dir.parent / "cfg")):
            self.assertEqual(agents.agents_dir(), self.dir.parent / "cfg" / "agents")


class Cli(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.env = S.env_isolated(CLAUDE_CONFIG_DIR=str(self.tmp / "cfg"))

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def test_install_and_status_envelopes(self) -> None:
        code, env, _ = S.run_exec(["agents", "status"], self.tmp, self.env)
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_CHECK"))
        self.assertEqual({r["state"] for r in env["data"]["agents"]}, {"missing"})
        code, env, _ = S.run_exec(["agents", "install"], self.tmp, self.env)
        self.assertEqual(code, 0)
        self.assertEqual(env["data"]["installed"], list(agents.OURS))
        self.assertTrue((self.tmp / "cfg" / "agents" / "execution-verifier.md").exists())
        code, env, _ = S.run_exec(["agents", "status"], self.tmp, self.env)
        self.assertEqual(code, 0)
        S.write_text(self.tmp / "cfg" / "agents" / "execution-reviewer.md", "not ours\n")
        code, env, _ = S.run_exec(["agents", "install"], self.tmp, self.env)
        self.assertEqual((code, env["data"]["refused"]), (1, ["execution-reviewer"]))
        code, env, _ = S.run_exec(["agents", "install", "--force"], self.tmp, self.env)
        self.assertEqual((code, env["data"]["forced"]), (0, ["execution-reviewer"]))


# ------------------------------------------------------------------------------------------------ the probe

BOUND = S.SESSION_ID


def make_ctx(layout: paths.Layout, now: str = S.FIXED_NOW, command: str = "agents probe") -> Ctx:
    when = datetime.fromisoformat(now.replace("Z", "+00:00")).astimezone(timezone.utc)
    return Ctx(layout=layout, executor="A", now=when, by="orchestrator", pretty=False, command=command,
               log=get_logger("tests.agents"))


def hook_event(layout: paths.Layout, n: int, type_: str, data: dict, *, session: str = BOUND,
               agent_type: str | None = None, ts: str = "2026-10-03T07:20:00.000000Z") -> None:
    layout.hook_events_dir.mkdir(parents=True, exist_ok=True)
    doc = {"ts": ts, "hook": "pre-tool-guard", "session_id": session, "agent_type": agent_type, "type": type_,
           "data": data}
    with open(layout.hook_events_dir / f"20261003T072000000000-{n:05d}-0.json", "w", encoding="utf-8",
              newline="\n") as fh:
        json.dump(doc, fh)


def answers_file(path: Path, *, names: tuple[str, ...] = agents.OURS, bad_marker: str | None = None) -> Path:
    rows = []
    for name in names:
        marker = "execution-agent-template: execution-planner v1 (x)" if name == bad_marker \
            else agents.marker_line(name)
        rows.append({"name": name, "outcome": "returned", "error": None,
                     "result": {"name": name, "marker": marker, "refused": ["E_GUARD_STATE_PATH"]}})
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"probe": agents.PROBE_WORKFLOW_NAME, "agents": rows}, fh)
    return path


class Probe(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.layout = S.state_dir(self.tmp)
        self.ctx = make_ctx(self.layout)

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def emit(self) -> dict:
        with B.wavejs_installed():
            return agents.probe_script(self.ctx)

    def test_probe_script_written_and_checked(self) -> None:
        data = self.emit()
        script = Path(data["script_path"])
        self.assertEqual(script, self.layout.local / "probe" / "probe.js")
        js = script.read_text(encoding="utf-8")
        self.assertNotIn("@@", js)
        self.assertIn('"bind_nonce":"0123456789abcdef"', js)
        self.assertEqual(data["workflow_call"], {"scriptPath": paths.posix(script),
                                                 "name": "execution-agents-probe",
                                                 "args": {"now_utc": S.FIXED_NOW}})
        self.assertEqual(B._static_check(js), [])
        planted = js.replace("const NOW_UTC =", "const STAMP = Date.now();\nconst NOW_UTC =")
        self.assertTrue(B._static_check(planted))  # positive control: the check fires on code
        self.assertTrue((self.layout.inbox("probe") / "msg.txt").read_text(encoding="utf-8").startswith("chore("))
        emitted = json.loads((self.layout.local / "probe" / "emitted.json").read_text(encoding="utf-8"))
        self.assertEqual((emitted["emitted_utc"], emitted["bind_nonce"]), (S.FIXED_NOW, "0123456789abcdef"))
        again = self.emit()
        self.assertEqual(again["script_sha256"], data["script_sha256"])  # same inputs, same bytes

    def test_forbidden_token_in_the_template_is_refused(self) -> None:
        tmp = self.tmp / "tpl.js"
        S.write_text(tmp, agents.PROBE_TEMPLATE.read_text(encoding="utf-8").replace(
            "const ARGS =", "const R = Math.random();\nconst ARGS ="))
        with mock.patch.object(agents, "PROBE_TEMPLATE", tmp):
            with self.assertRaises(Exception) as caught:
                self.emit()
        self.assertEqual(getattr(caught.exception, "code", None), "E_WAVE_FORBIDDEN_TOKEN")

    def test_probe_needs_a_marker_with_a_nonce(self) -> None:
        self.layout.active.unlink()
        with self.assertRaises(UsageError):
            self.emit()

    @unittest.skipUnless(B.node_available(), "node is needed")
    def test_probe_script_runs_under_node_with_a_fake_agent(self) -> None:
        data = self.emit()
        self.assertEqual(data["node_check"]["state"], "ok")
        js = Path(data["script_path"]).read_text(encoding="utf-8").replace("export const meta", "const meta")
        harness = (
            "const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;\n"
            "const calls = [];\n"
            "async function agent(prompt, opts) {\n"
            "  calls.push(opts);\n"
            "  if (opts.agentType === 'execution-reviewer') return null;\n"
            "  if (opts.agentType === 'execution-planner') throw new Error('Agent type not found');\n"
            "  return {name: opts.agentType, marker: 'execution-agent-template: ' + opts.agentType + ' v1 (x)',\n"
            "          refused: prompt.indexOf('git commit') === -1 ? ['E_GUARD_STATE_PATH'] :\n"
            "                   ['E_GUARD_STATE_PATH', 'E_GUARD_COMMAND_ROLE']};\n"
            "}\n"
            "const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'log', 'phase', 'args', "
            + json.dumps(js) + ");\n"
            "const out = await fn(agent, null, null, () => {}, null, {now_utc: '2026-10-03T07:12:00Z'});\n"
            "console.log(JSON.stringify({out, calls}));\n")
        path = self.tmp / "harness.mjs"
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(harness)
        proc = subprocess.run(["node", str(path)], capture_output=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        result = json.loads(proc.stdout.decode("utf-8"))
        outcomes = {a["name"]: a["outcome"] for a in result["out"]["agents"]}
        self.assertEqual(outcomes["execution-reviewer"], "null")
        self.assertEqual(outcomes["execution-planner"], "threw")
        self.assertEqual(outcomes["execution-verifier"], "returned")
        self.assertEqual(sorted(c["agentType"] for c in result["calls"]), sorted(agents.OURS))
        for opts in result["calls"]:
            self.assertEqual((opts["model"], opts["effort"], opts["phase"]), ("sonnet", "low", "Probe"))
            self.assertEqual(opts["schema"], agents.PROBE_SCHEMA)
        # the answers file the workflow returns feeds probe-check (the returned object shape is understood)
        answers = agents.read_probe_answers(self.write_json("returned.json", result["out"]))
        self.assertEqual(set(answers), set(agents.OURS) - {"execution-reviewer", "execution-planner"})

    def write_json(self, name: str, obj: object) -> Path:
        path = self.tmp / name
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(obj, fh)
        return path

    # -------------------------------------------------------------------------------------------- probe-check

    def plant_good_evidence(self, *, layer: str = "settings", skip_commit: bool = False,
                            deny_with_path: bool = True, session: str = BOUND) -> None:
        n = 0
        for name in agents.OURS:
            n += 1
            data = {"probe": True, "layer": layer, "agent_type": name, "session_id": session}
            data["role_resolved" if layer == "settings" else "as_role"] = name
            hook_event(self.layout, n, "hooks.canary", data, session=session, agent_type=name)
            n += 1
            deny = {"tool": "Write", "rule": "B1", "code": "E_GUARD_STATE_PATH", "role": name, "agent_type": name,
                    "layer": "settings", "command_head": ""}
            if deny_with_path:
                deny["path"] = paths.posix(self.layout.local / "probe" / f"{name}.forbidden")
            hook_event(self.layout, n, "guard.deny", deny, agent_type=name)
        if not skip_commit:
            hook_event(self.layout, 99, "guard.deny",
                       {"tool": "Bash", "rule": "C", "code": "E_GUARD_COMMAND_ROLE", "role": "execution-verifier",
                        "agent_type": "execution-verifier", "layer": "settings",
                        "command_head": "git commit --allow-empty -F x/msg.txt"}, agent_type="execution-verifier")

    def check(self, answers: Path) -> object:
        return agents.probe_check(make_ctx(self.layout, "2026-10-03T07:30:00Z", "agents probe-check"), answers)

    def test_probe_check_passes_on_complete_evidence(self) -> None:
        self.emit()
        self.plant_good_evidence()
        result = self.check(answers_file(self.tmp / "answers.json"))
        self.assertEqual(result.exit_code, 0, result.data["failures"])
        self.assertTrue(result.data["passed"])
        self.assertEqual(result.data["agent_role_source"], "settings")
        self.assertTrue(result.data["agent_session_scoped"])
        self.assertEqual(result.data["local_state"]["fields"]["hooks.probe_ok_utc"], "2026-10-03T07:30:00Z")
        check = json.loads((self.layout.local / "probe" / "check.json").read_text(encoding="utf-8"))
        self.assertTrue(check["passed"])
        self.assertFalse((self.layout.local / "probe" / "decision-options.json").exists())

    def test_agent_only_role_source_fails_with_the_decision(self) -> None:
        self.emit()
        self.plant_good_evidence(layer="agent")
        result = self.check(answers_file(self.tmp / "answers.json"))
        self.assertEqual(result.exit_code, 1)
        self.assertEqual(result.errors[0].code, "E_DEPENDENCY_MISSING")
        self.assertEqual(result.data["agent_role_source"], "agent-only")
        options = json.loads(Path(result.data["decision"]["options_path"]).read_text(encoding="utf-8"))
        self.assertEqual([o["id"] for o in options], ["trust-agent-layer", "generic-ab-only", "reinstall-reprobe"])
        self.assertIn("--kind dependency-missing", result.data["next"][0])
        self.assertTrue(result.data["next"][0].startswith("exec.py decision propose"))

    def test_each_missing_piece_of_evidence_fails(self) -> None:
        cases = {
            "no canary at all": dict(evidence=False),
            "forbidden file written": dict(write_forbidden="execution-implementer"),
            "commit not denied": dict(skip_commit=True),
            "wrong definition loaded": dict(bad_marker="execution-reviewer"),
            "one agent returned nothing": dict(names=agents.OURS[:-1]),
        }
        for label, case in cases.items():
            with self.subTest(case=label):
                S.rmtree(self.layout.hook_events_dir) if self.layout.hook_events_dir.exists() else None
                self.emit()
                if case.get("evidence", True):
                    self.plant_good_evidence(skip_commit=case.get("skip_commit", False))
                if "write_forbidden" in case:
                    S.write_text(self.layout.local / "probe" / f"{case['write_forbidden']}.forbidden", "probe\n")
                answers = answers_file(self.tmp / "answers.json", names=case.get("names", agents.OURS),
                                       bad_marker=case.get("bad_marker"))
                result = self.check(answers)
                self.assertEqual(result.exit_code, 1, label)
                self.assertFalse(result.data["passed"])
                self.assertTrue(result.data["failures"])

    def test_old_events_and_foreign_sessions(self) -> None:
        self.emit()
        # evidence older than the probe's emission never counts
        for i, name in enumerate(agents.OURS):
            hook_event(self.layout, 200 + i, "hooks.canary",
                       {"probe": True, "layer": "settings", "role_resolved": name, "session_id": BOUND},
                       ts="2026-10-03T07:00:00.000000Z")
        result = self.check(answers_file(self.tmp / "answers.json"))
        self.assertEqual(result.data["agent_role_source"], "none")
        # canaries from another session: the role resolves, but the agents are not session-scoped
        self.plant_good_evidence(session="sess-other")
        result = self.check(answers_file(self.tmp / "answers.json"))
        self.assertEqual(result.data["agent_role_source"], "settings")
        self.assertFalse(result.data["agent_session_scoped"])

    def test_deny_matched_by_role_when_the_record_has_no_path(self) -> None:
        self.emit()
        self.plant_good_evidence(deny_with_path=False)
        result = self.check(answers_file(self.tmp / "answers.json"))
        self.assertEqual(result.exit_code, 0, result.data["failures"])
        self.assertEqual({r["deny_match"] for r in result.data["agents"]}, {"role"})

    def test_journal_lines_are_understood(self) -> None:
        lines = [json.dumps({"type": "log", "text": "not an answer"}), "not json at all"]
        for name in agents.OURS:
            payload = {"name": name, "marker": agents.marker_line(name), "refused": []}
            lines.append(json.dumps({"type": "agent_result", "agent": name, "result": json.dumps(payload)}))
        journal = self.tmp / "journal.jsonl"
        with open(journal, "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines) + "\n")
        self.assertEqual(set(agents.read_probe_answers(journal)), set(agents.OURS))
        with self.assertRaises(UsageError):
            agents.read_probe_answers(self.tmp / "absent.json")

    def test_probe_check_cli_envelope(self) -> None:
        self.emit()
        self.plant_good_evidence()
        answers = answers_file(self.tmp / "answers.json")
        args = ["--state", str(self.layout.state), "--now", "2026-10-03T07:30:00Z", "agents", "probe-check",
                "--result", str(answers)]
        code, env, _ = S.run_exec(args, self.tmp)
        self.assertEqual(code, 0, env["errors"])
        self.assertTrue(env["data"]["passed"])
        (self.layout.local / "probe" / "execution-verifier.forbidden").write_bytes(b"probe\n")
        code, env, _ = S.run_exec(args, self.tmp)
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_DEPENDENCY_MISSING"))

    def test_probe_cli(self) -> None:
        args = ["--state", str(self.layout.state), "agents", "probe"]
        code, env, _ = S.run_exec(args, self.tmp)
        if B.real_wavejs_exists():
            self.assertEqual(code, 0, env["errors"])
            self.assertEqual(env["data"]["workflow_call"]["name"], "execution-agents-probe")
        else:
            # lane B05 not integrated yet: the command says so, it never pretends (reported as missing)
            self.assertEqual((code, env["errors"][0]["code"]), (3, "E_NOT_IMPLEMENTED"))
            self.assertIn("wavejs", env["errors"][0]["message"])


if __name__ == "__main__":
    unittest.main()
