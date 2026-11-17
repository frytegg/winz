"""Tests for scripts/harden_agents.py (pilot-auto-calibration A01-F41, A01-F45).

Run: python -m unittest discover -s scripts/tests -p "test_harden_agents.py" -v
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Dict, List, Optional

SCRIPTS = Path(__file__).resolve().parent.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import harden_agents as HA  # noqa: E402
import persist_pass as PP  # noqa: E402


def run(argv: List[str], cwd: Optional[Path] = None) -> Any:
    out, err = io.StringIO(), io.StringIO()
    old = os.getcwd()
    try:
        if cwd is not None:
            os.chdir(str(cwd))
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = HA.main(argv)
    finally:
        os.chdir(old)
    return code, out.getvalue(), err.getvalue()


class RenderTests(unittest.TestCase):
    def test_verifier_template_states_the_output_contract_and_turn_budget(self) -> None:
        """pilot-auto-calibration A01-F55: no preamble, and a turn budget with null verdicts."""
        text = HA.rendered("harden-verifier")
        for phrase in ("Respond directly without preamble",
                       "no sentence, summary, heading, blank line or code fence before it",
                       '"verified": null', "about 45 turns",
                       "harden-agent-template: harden-verifier v1"):
            self.assertIn(phrase, text)
        self.assertLess(len(text.split("\n")), 100)
        front, _body = HA.split_front(text)
        self.assertIn("\nmaxTurns: 60\n", "\n" + front)

    def test_render_fills_the_skill_directory(self) -> None:
        for name, model, tools, turns in (("harden-lens", "opus", "Read, Grep, Glob", 60),
                                          ("harden-verifier", "sonnet", "Read, Grep, Glob, Bash",
                                           60)):
            with self.subTest(name=name):
                text = HA.rendered(name)
                self.assertNotIn("{{", text)
                self.assertTrue(text.startswith("---\n"))
                self.assertFalse(text.encode("utf-8").startswith(b"\xef\xbb\xbf"))
                self.assertLess(len(text.split("\n")), 100)
                front, body = HA.split_front(text)
                for line in ("name: " + name, "model: " + model, "omitClaudeMd: true",
                             "tools: " + tools, "maxTurns: {}".format(turns), "effort: high"):
                    self.assertIn("\n" + line + "\n", "\n" + front)
                self.assertIn("harden-agent-template: {} v1".format(name), body)
                self.assertNotIn("\r", text)
        verifier = HA.rendered("harden-verifier")
        self.assertIn("the commands your task file names", verifier)
        self.assertIn("scripts/hook_guard.py", verifier)
        self.assertIn("scripts/persist_pass.py", HA.rendered("harden-lens"))

    def test_unsafe_skill_directory_is_refused(self) -> None:
        for bad in ("C:/it's/harden", 'C:/a"b', "C:/$HOME/x", "C:/a`b", "C:/a\nb"):
            with self.subTest(bad=bad), self.assertRaises(HA.AgentError):
                HA.render(HA.template_text("harden-lens"), bad)

    def test_json_matches_the_rendered_frontmatter(self) -> None:
        code, out, _err = run(["json"])
        self.assertEqual(code, 0)
        data = json.loads(out)
        self.assertEqual(sorted(data), ["harden-lens", "harden-verifier"])
        lens = data["harden-lens"]
        self.assertEqual((lens["model"], lens["tools"], lens["omitClaudeMd"], lens["maxTurns"]),
                         ("opus", ["Read", "Grep", "Glob"], True, 60))
        self.assertIn("harden-agent-template: harden-lens v1", lens["prompt"])
        for name in HA.AGENTS:
            front, _body = HA.split_front(HA.rendered(name))
            rendered = [ln.strip()[len("command: "):].strip("'") for ln in front.split("\n")
                        if ln.strip().startswith("command:")]
            from_json = [h["command"] for event in data[name]["hooks"].values()
                         for group in event for h in group["hooks"]]
            self.assertEqual(from_json, rendered)
        self.assertEqual(data["harden-verifier"]["hooks"]["PreToolUse"][0]["matcher"],
                         "Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit")


class InstallStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-agents-")).resolve()
        self.agents = self.tmp / "agents"
        self.agents.mkdir()

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_states_install_and_refusals(self) -> None:
        code, out, _err = run(["status", "--agents-dir", str(self.agents)])
        self.assertEqual(code, 1)
        self.assertIn("harden-lens: missing", out)
        code, out, _err = run(["install", "--agents-dir", str(self.agents)], cwd=self.tmp)
        self.assertEqual(code, 0, out)
        self.assertIn("Start a new Claude Code session", out)
        self.assertIn("--agents", out)
        self.assertEqual(run(["status", "--agents-dir", str(self.agents)])[0], 0)
        lens = self.agents / "harden-lens.md"
        self.assertEqual(lens.read_bytes(), HA.rendered("harden-lens").encode("utf-8"))
        lens.write_text(lens.read_text() + "\nedited\n", encoding="utf-8")
        code, out, _err = run(["status", "--agents-dir", str(self.agents)])
        self.assertIn("harden-lens: stale", out)
        lens.write_text("---\nname: harden-lens\n---\nsomeone else's agent\n", encoding="utf-8")
        self.assertIn("harden-lens: foreign", run(["status", "--agents-dir",
                                                   str(self.agents)])[1])
        code, out, _err = run(["install", "--agents-dir", str(self.agents)], cwd=self.tmp)
        self.assertEqual(code, 1)
        self.assertIn("REFUSED", out)
        code, _out, _err = run(["install", "--agents-dir", str(self.agents), "--force"],
                               cwd=self.tmp)
        self.assertEqual(code, 0)

    def test_install_into_a_new_directory_warns_and_config_dir_is_used(self) -> None:
        target = self.tmp / "cfg"
        old = os.environ.get("CLAUDE_CONFIG_DIR")
        os.environ["CLAUDE_CONFIG_DIR"] = str(target).replace("/", "\\")
        try:
            code, out, _err = run(["install"], cwd=self.tmp)
        finally:
            if old is None:
                os.environ.pop("CLAUDE_CONFIG_DIR", None)
            else:
                os.environ["CLAUDE_CONFIG_DIR"] = old
        self.assertEqual(code, 0)
        self.assertIn("did not exist", out)
        self.assertTrue((target / "agents" / "harden-verifier.md").is_file())

    def test_install_inside_an_active_run_is_refused(self) -> None:
        repo = self.tmp / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        (repo / ".harden").mkdir()
        (repo / ".harden" / "active").write_text("{}")
        code, _out, err = run(["install", "--agents-dir", str(self.agents)], cwd=repo)
        self.assertEqual(code, 2)
        self.assertIn("never during a run", err)

    def test_fallback_agent_detection(self) -> None:
        self.assertEqual(HA.fallback_agent(self.agents), "general-purpose")
        (self.agents / "codebase-explorer.md").write_text(
            "---\nname: codebase-explorer\ntools: Read, Glob, Grep\nmodel: haiku\n---\nx\n")
        self.assertEqual(HA.fallback_agent(self.agents), "codebase-explorer")
        (self.agents / "codebase-explorer.md").write_text(
            "---\nname: codebase-explorer\ntools: Read, Glob, Grep, Bash\n---\nx\n")
        self.assertEqual(HA.fallback_agent(self.agents), "general-purpose")


class ProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-probe-")).resolve()
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.hdir = self.repo / ".harden"
        self.hdir.mkdir()
        (self.hdir / "active").write_text(json.dumps({"base_sha": "x"}))
        (self.hdir / "progress.md").write_text("# progress\n")
        self.agents = self.tmp / "agents"
        self.agents.mkdir()
        self.main = self.tmp / "main.jsonl"
        self.write_jsonl(self.main, [self.assistant("claude-opus-5-5", "m0", "orchestrating")])
        (self.hdir / "session.json").write_text(json.dumps({"transcript_path": str(self.main)}))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    @staticmethod
    def write_jsonl(path: Path, lines: List[Dict[str, Any]]) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8")
        return path

    @staticmethod
    def assistant(model: str, mid: str, text: str) -> Dict[str, Any]:
        return {"type": "assistant", "effort": "high", "timestamp": "2026-09-25T10:00:00Z",
                "message": {"id": mid, "model": model, "stop_reason": "end_turn",
                            "content": [{"type": "text", "text": text}],
                            "usage": {"input_tokens": 1, "output_tokens": 1}}}

    def probe(self) -> None:
        code, out, _err = run(["probe", "--repo", str(self.repo)])
        self.assertEqual(code, 0)
        self.assertIn("subagent_type: harden-lens", out)
        self.assertIn("subagent_type: harden-verifier", out)
        self.assertIn("no model parameter", out)

    def agent_stop(self, name: str, agent_type: str, model: str, report: Dict[str, Any],
                   snapshot: Optional[str] = None) -> None:
        message = "pass-id: {}\n{}".format(name, json.dumps(report))
        lines: List[Dict[str, Any]] = [{"type": "user", "message": {"content": (
            "pass-id: {}\nTask file: {}/.harden/prompts/{}.md. Read it first and follow it "
            "exactly.".format(name, PP.posix(str(self.repo)), name))}}]
        if snapshot is not None:
            lines.append({"type": "attachment", "attachment": {"type": "prompt_snapshot",
                                                               "systemPrompt": snapshot}})
        lines.append(self.assistant(model, name + "-m1", message))
        transcript = self.write_jsonl(self.tmp / "sub" / "agent-{}.jsonl".format(name), lines)
        payload = {"hook_event_name": "SubagentStop", "agent_id": name + "x",
                   "agent_type": agent_type, "agent_transcript_path": str(transcript),
                   "cwd": str(self.repo), "last_assistant_message": message}
        self.assertEqual(PP.hook(json.dumps(payload).encode("utf-8"))[0], 0)

    def canary(self, agent_type: str = "harden-verifier", ts: Optional[str] = None) -> None:
        when = ts or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 1))
        with open(self.hdir / "hook_events.log", "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"ts": when, "event": "PreToolUse", "tool": "Bash",
                                     "reason_code": "canary-bash", "agent_id": "v",
                                     "agent_type": agent_type}) + "\n")

    def full(self, lens_model: str = "claude-opus-5-5", verifier_report: Optional[Dict] = None,
             lens_report: Optional[Dict] = None, snapshot: Optional[str] = None) -> None:
        self.probe()
        self.agent_stop("probe-lens", "harden-lens", lens_model, lens_report or {
            "pass_id": "probe-lens", "lens": "probe", "candidates": []}, snapshot=snapshot)
        self.agent_stop("probe-verifier", "harden-verifier", "claude-sonnet-5",
                        verifier_report or {"pass_id": "probe-verifier", "canary": "refused"})

    def check(self) -> Any:
        code, out, err = run(["probe-check", "--repo", str(self.repo), "--agents-dir",
                              str(self.agents)])
        data = json.loads((self.hdir / "agents.json").read_text())
        return code, out + err, data

    def test_probe_writes_two_task_files(self) -> None:
        self.probe()
        first = [(self.hdir / "prompts" / n).read_text().split("\n")[0]
                 for n in ("probe-lens.md", "probe-verifier.md")]
        self.assertEqual(first, ["pass-id: probe-lens", "pass-id: probe-verifier"])
        (self.hdir / "active").unlink()
        self.assertEqual(run(["probe", "--repo", str(self.repo)])[0], 2)

    def test_probe_check_passes_with_installed_files_missing(self) -> None:
        self.full(snapshot="... harden-agent-template: harden-lens v1 (rendered ...)")
        self.canary()
        code, out, data = self.check()
        self.assertEqual(code, 0, out)
        self.assertEqual(data["status"], "pass")
        self.assertEqual(data["installed"], {"harden-lens": "missing",
                                             "harden-verifier": "missing"})
        self.assertEqual((data["lens"]["model"], data["verifier"]["model"],
                          data["verifier"]["guard"]), ("claude-opus-5-5", "claude-sonnet-5",
                                                       "refused"))
        self.assertEqual(data["lens"]["definition"], "verified")
        self.assertEqual(data["verifier"]["definition"], "unverified (no prompt_snapshot)")
        self.assertFalse(data["cheaper_lens_than_orchestrator"])
        self.assertIn("Agents: PASS", (self.hdir / "progress.md").read_text())

    def test_wrong_model_family_fails_and_prints_the_fallback(self) -> None:
        self.full(lens_model="claude-haiku-4-5-20251001")
        self.canary()
        code, out, data = self.check()
        self.assertEqual(code, 1)
        self.assertTrue(any("family haiku" in p for p in data["problems"]), data["problems"])
        self.assertIn("Fallback for this run", out)
        self.assertTrue(data["fallback"])

    def test_missing_canary_denial_fails(self) -> None:
        self.full()
        self.canary(agent_type="general-purpose")
        code, _out, data = self.check()
        self.assertEqual(code, 1)
        self.assertEqual(data["verifier"]["guard"], "not refused")

    def test_old_canary_denial_does_not_count(self) -> None:
        self.full()
        self.canary(ts="2020-01-01T00:00:00Z")
        self.assertEqual(self.check()[0], 1)

    def test_content_checks(self) -> None:
        cases = [({"verifier_report": {"pass_id": "probe-verifier", "canary": "ran"}}, "canary"),
                 ({"lens_report": {"pass_id": "probe-lens", "lens": "probe",
                                   "candidates": [{"x": 1}]}}, "not the probe's object"),
                 ({"snapshot": "an older agent without the marker"}, "stale or foreign")]
        for kwargs, expected in cases:
            with self.subTest(expected=expected):
                shutil.rmtree(str(self.hdir / "passes"), ignore_errors=True)
                shutil.rmtree(str(self.hdir / "verifiers"), ignore_errors=True)
                self.full(**kwargs)
                self.canary()
                code, _out, data = self.check()
                self.assertEqual(code, 1)
                self.assertTrue(any(expected in p for p in data["problems"]), data["problems"])

    def test_unparsed_probe_report_fails(self) -> None:
        self.probe()
        transcript = self.write_jsonl(self.tmp / "sub" / "agent-u.jsonl", [
            {"type": "user", "message": {"content": "pass-id: probe-lens\nTask file: {}/.harden/"
                                                    "prompts/probe-lens.md.".format(
                                                        PP.posix(str(self.repo)))}},
            self.assistant("claude-opus-5-5", "u1", "prose only")])
        PP.hook(json.dumps({"hook_event_name": "SubagentStop", "agent_id": "u",
                            "agent_type": "harden-lens", "agent_transcript_path":
                                str(transcript), "cwd": str(self.repo),
                            "last_assistant_message": "prose only"}).encode("utf-8"))
        self.canary()
        code, _out, data = self.check()
        self.assertEqual(code, 1)
        self.assertTrue(any("no saved report" in p or "did not parse" in p
                            for p in data["problems"]), data["problems"])

    def test_cheaper_lens_than_orchestrator(self) -> None:
        self.full(lens_model="claude-sonnet-5")
        self.canary()
        _code, _out, data = self.check()
        self.assertTrue(data["cheaper_lens_than_orchestrator"])


class ReviewFixTests(unittest.TestCase):
    """Safety review, round 3."""

    def test_probe_asks_for_foreground_agents_and_a_check_after_both_returned(self) -> None:
        # A probe-check run while the two probes still run in the background fails and sends
        # every pass and verifier of the run to the fallback.
        tmp = Path(tempfile.mkdtemp(prefix="harden-probe-fg-")).resolve()
        try:
            repo = tmp / "repo"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / ".harden").mkdir()
            (repo / ".harden" / "active").write_text(json.dumps({"base_sha": "x"}))
            code, out, _err = run(["probe", "--repo", str(repo)])
            self.assertEqual(code, 0)
            self.assertIn("in the foreground", out)
            self.assertNotIn("Start these two subagents in the background", out)
            self.assertIn("When both have returned, run:", out)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_a_crlf_or_bom_template_renders_like_the_lf_one(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="harden-tpl-crlf-")).resolve()
        old = HA.TEMPLATE_DIR
        try:
            want = {name: HA.rendered(name, "C:/skill") for name in HA.AGENTS}
            for name in HA.AGENTS:
                raw = (old / "{}.md".format(name)).read_bytes().replace(b"\r\n", b"\n")
                (tmp / "{}.md".format(name)).write_bytes(b"\xef\xbb\xbf" +
                                                         raw.replace(b"\n", b"\r\n"))
            HA.TEMPLATE_DIR = tmp
            for name in HA.AGENTS:
                with self.subTest(name=name):
                    self.assertEqual(HA.rendered(name, "C:/skill"), want[name])
                    self.assertEqual(HA.template_model(name), "opus" if name == "harden-lens"
                                     else "sonnet")
        finally:
            HA.TEMPLATE_DIR = old
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
