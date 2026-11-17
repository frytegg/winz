"""Tests for scripts/persist_pass.py (pilot-auto-calibration A01-F42 to A01-F45).

Run: python -m unittest discover -s scripts/tests -p "test_persist_pass.py" -v
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import random
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

import persist_pass as PP  # noqa: E402

ARROW = chr(0x2192)
REPORT = {"pass_id": "se-u1-p1", "lens": "security", "candidates": [
    {"id": "se-u1-p1-1", "lens": "security", "rule_ref": "SE-03", "title": "a <b>\tc",
     "file": "src/a.ts", "line": 3, "severity": "high"}]}


def run_main(argv: List[str]) -> Any:
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = PP.main(argv)
    return code, out.getvalue(), err.getvalue()


class Transcript:
    """A synthetic subagent transcript (JSONL) in the shape Claude Code writes."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.lines: List[Dict[str, Any]] = []
        self.n = 0

    def user(self, text: str) -> "Transcript":
        self.lines.append({"type": "user", "timestamp": "2026-09-25T10:00:00Z",
                           "message": {"role": "user", "content": text}})
        return self

    def assistant(self, blocks: List[Dict[str, Any]], mid: Optional[str] = None,
                  model: str = "claude-opus-5-5", effort: Optional[str] = "high",
                  stop: str = "tool_use", usage: Optional[Dict[str, int]] = None) -> str:
        self.n += 1
        mid = mid or "msg_{}".format(self.n)
        entry: Dict[str, Any] = {"type": "assistant", "timestamp": "2026-09-25T10:00:{:02d}Z"
                                 .format(self.n % 60),
                                 "message": {"id": mid, "model": model, "content": blocks,
                                             "stop_reason": stop,
                                             "usage": usage or {"input_tokens": 10,
                                                                "cache_read_input_tokens": 100,
                                                                "cache_creation_input_tokens": 5,
                                                                "output_tokens": 7}}}
        if effort:
            entry["effort"] = effort
        self.lines.append(entry)
        return mid

    def read(self, file_path: str, result: str, tid: Optional[str] = None,
             mid: Optional[str] = None) -> None:
        tid = tid or "tu{}".format(len(self.lines))
        self.assistant([{"type": "tool_use", "id": tid, "name": "Read",
                         "input": {"file_path": file_path}}], mid=mid)
        self.lines.append({"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": tid, "content": result}]}})

    def tool(self, name: str, inp: Dict[str, Any], result: str, error: bool = False) -> None:
        tid = "tu{}".format(len(self.lines))
        self.assistant([{"type": "tool_use", "id": tid, "name": name, "input": inp}])
        self.lines.append({"type": "user", "message": {"content": [
            {"type": "tool_result", "tool_use_id": tid, "content": result, "is_error": error}]}})

    def final(self, text: str) -> None:
        self.assistant([{"type": "text", "text": text}], stop="end_turn")

    def write(self) -> Path:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", encoding="utf-8", newline="\n") as handle:
            for line in self.lines:
                handle.write(json.dumps(line) + "\n")
        return self.path


def numbered(lines: List[str], start: int = 1, arrow: bool = False) -> str:
    sep = ARROW if arrow else "\t"
    return "\n".join("{:>6}{}{}".format(start + i, sep, text) for i, text in enumerate(lines))


class PersistCase(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="harden-pp-")).resolve()
        self.repo = self.tmp / "Repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.hdir = self.repo / ".harden"
        (self.hdir / "prompts").mkdir(parents=True)
        (self.hdir / "active").write_text(json.dumps({"base_sha": "x"}), encoding="utf-8")
        self.subdir = self.tmp / "session" / "subagents"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def task(self, pass_id: str, extra: str = "", kind: str = "lens") -> Path:
        path = self.hdir / "prompts" / "{}.md".format(pass_id)
        path.write_text("pass-id: {}\nkind: {}\n{}\n# Task\n".format(pass_id, kind, extra),
                        encoding="utf-8", newline="\n")
        return path

    def prompt(self, pass_id: str) -> str:
        return "pass-id: {}\nTask file: {}/.harden/prompts/{}.md. Read it first and follow it " \
               "exactly.".format(pass_id, PP.posix(str(self.repo)), pass_id)

    def transcript(self, agent: str, pass_id: Optional[str] = "se-u1-p1") -> Transcript:
        tr = Transcript(self.subdir / "agent-{}.jsonl".format(agent))
        if pass_id:
            tr.user(self.prompt(pass_id))
        return tr

    def payload(self, message: Any, agent: str = "a1", agent_type: str = "harden-lens",
                transcript: Optional[Path] = None, active: bool = False) -> bytes:
        return json.dumps({"hook_event_name": "SubagentStop", "agent_id": agent,
                           "agent_type": agent_type, "session_id": "s1",
                           "agent_transcript_path": str(transcript) if transcript else None,
                           "cwd": str(self.repo), "stop_hook_active": active,
                           "last_assistant_message": message}).encode("utf-8")

    def message(self, pass_id: str = "se-u1-p1", obj: Optional[Dict[str, Any]] = None) -> str:
        return "pass-id: {}\n{}".format(pass_id, json.dumps(obj or dict(REPORT,
                                                                        pass_id=pass_id)))


class HookTests(PersistCase):
    def test_valid_lens_report_is_saved_byte_for_byte_and_acknowledged(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        message = "pass-id: se-u1-p1\r\n" + json.dumps(dict(REPORT, notes="caf" + chr(0xE9)),
                                                       ensure_ascii=False) + "\n"
        code, out = PP.hook(self.payload(message, transcript=tr))
        self.assertEqual(code, 0)
        saved = self.hdir / "passes" / "se-u1-p1.md"
        self.assertEqual(saved.read_bytes(), message.encode("utf-8"))
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        self.assertEqual((meta["source"], meta["id_line"], meta["parsed"]), ("hook", "match", True))
        decision = json.loads(out)
        self.assertEqual(decision["decision"], "block")
        self.assertTrue(decision["reason"].endswith("pass-id: se-u1-p1 saved"))
        # second stop: the acknowledgement
        code, out = PP.hook(self.payload("pass-id: se-u1-p1 saved", transcript=tr, active=True))
        self.assertEqual((code, out), (0, ""))
        self.assertEqual(saved.read_bytes(), message.encode("utf-8"))
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        self.assertEqual(meta["ack"], "pass-id: se-u1-p1 saved")

    def test_lone_surrogate_is_replaced_and_marked_lossy(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        message = "pass-id: se-u1-p1\n" + json.dumps(dict(REPORT, notes="x" + chr(0xD800)),
                                                     ensure_ascii=False)
        data = json.dumps({"hook_event_name": "SubagentStop", "agent_id": "a1",
                           "agent_type": "harden-lens", "agent_transcript_path": str(tr),
                           "cwd": str(self.repo), "last_assistant_message": message},
                          ensure_ascii=True).encode("ascii")
        self.assertEqual(PP.hook(data)[0], 0)
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        self.assertTrue(meta["lossy"])

    def test_verifier_routing(self) -> None:
        self.task("V01", kind="verifier")
        tr = self.transcript("v1", "V01").write()
        code, out = PP.hook(self.payload('pass-id: V01\n{"pass_id": "V01", "verdict": "ok"}',
                                         agent="v1", agent_type="harden-verifier", transcript=tr))
        self.assertEqual(code, 0)
        self.assertTrue((self.hdir / "verifiers" / "V01.md").is_file())
        self.assertIn("block", out)

    def test_other_agent_types_and_no_active_run_write_nothing(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        self.assertEqual(PP.hook(self.payload(self.message(), agent_type="Explore",
                                              transcript=tr)), (0, ""))
        (self.hdir / "active").unlink()
        self.assertEqual(PP.hook(self.payload(self.message(), transcript=tr)), (0, ""))
        self.assertFalse((self.hdir / "passes").exists())

    def test_no_active_marker_with_a_git_root_writes_nothing(self) -> None:
        (self.hdir / "active").unlink()
        tr = self.transcript("a1").write()
        os.environ.pop("CLAUDE_PROJECT_DIR", None)
        self.assertEqual(PP.hook(self.payload(self.message(), transcript=tr)), (0, ""))
        self.assertFalse((self.hdir / "passes").exists())

    def test_prompt_unreadable_routes_to_unrouted_whatever_the_message_says(self) -> None:
        code, out = PP.hook(self.payload("pass-id: ../../evil\n{}", agent="a9",
                                         transcript=None))
        self.assertEqual((code, out), (0, ""))
        self.assertTrue((self.hdir / "passes" / "_unrouted" / "a9.md").is_file())
        code, out = PP.hook(self.payload(self.message("se-u1-p2"), agent="a8", transcript=None))
        self.assertEqual((code, out), (0, ""))
        self.assertFalse((self.hdir / "passes" / "se-u1-p2.md").exists())
        self.assertTrue((self.hdir / "passes" / "_unrouted" / "a8.md").is_file())
        written = [p for p in self.tmp.rglob("*") if p.is_file() and "evil" in p.name]
        self.assertEqual(written, [])

    def test_prompt_and_message_ids_disagree(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        PP.hook(self.payload(self.message("se-u1-p2"), transcript=tr))
        self.assertTrue((self.hdir / "passes" / "se-u1-p1.md").is_file())
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        self.assertEqual(meta["id_line"], "mismatch")

    def test_unparsable_report_gets_one_format_retry(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        code, out = PP.hook(self.payload("I found nothing worth reporting.", transcript=tr))
        self.assertTrue((self.hdir / "passes" / "se-u1-p1.unparsed.md").is_file())
        self.assertIn("could not be read", json.loads(out)["reason"])
        code, out = PP.hook(self.payload(self.message(), transcript=tr, active=True))
        self.assertEqual((code, out), (0, ""))
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        self.assertTrue(meta["format_retry"])
        self.assertTrue((self.hdir / "passes" / "se-u1-p1.md").is_file())

    def test_a_different_second_message_is_kept_as_a_version(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        PP.hook(self.payload(self.message(), transcript=tr))
        other = self.message(obj=dict(REPORT, candidates=[]))
        code, out = PP.hook(self.payload(other, transcript=tr))
        self.assertTrue((self.hdir / "passes" / "se-u1-p1.v2.md").is_file())
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        self.assertEqual(meta["versions"], ["se-u1-p1.v2.md"])
        self.assertIn("saved", json.loads(out)["reason"])

    def test_robustness_never_exits_2(self) -> None:
        for data in (b"not json", b"", json.dumps({"hook_event_name": "SubagentStop",
                                                    "agent_type": "harden-lens",
                                                    "last_assistant_message": 42}).encode(),
                     b"\xef\xbb\xbf" + self.payload(self.message())):
            self.assertEqual(PP.hook(data)[0], 0)
        rng = random.Random(7)
        keys = ["hook_event_name", "agent_type", "agent_id", "last_assistant_message",
                "agent_transcript_path", "cwd", "stop_hook_active", "session_id"]
        values = [None, 1, "x", [], {}, True, "SubagentStop", "harden-lens", str(self.repo),
                  "pass-id: a\n{}", "../..", "\ud800"]
        for _ in range(50):
            payload = {k: rng.choice(values) for k in keys if rng.random() < 0.7}
            data = json.dumps(payload).encode("utf-8", errors="surrogatepass")
            self.assertEqual(PP.hook(data)[0], 0)

    def test_hook_process_exit_code_and_concurrent_duplicates(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        data = self.payload(self.message(), transcript=tr)
        env = dict(os.environ)
        env.pop("CLAUDE_PROJECT_DIR", None)
        procs = [subprocess.Popen([sys.executable, "-S", str(SCRIPTS / "persist_pass.py")],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, env=env) for _ in range(2)]
        results = [p.communicate(data, timeout=60) for p in procs]
        self.assertEqual([p.returncode for p in procs], [0, 0], results)
        passes = sorted(p.name for p in (self.hdir / "passes").glob("se-u1-p1*.md"))
        self.assertEqual(passes, ["se-u1-p1.md"])
        for out, _err in results:
            self.assertIn(b'"decision": "block"', out)


class ObserveTests(PersistCase):
    def build(self, extra_task: str = "", seeded: str = "yes") -> Path:
        src = self.repo / "src"
        src.mkdir()
        (src / "ten.py").write_text("".join("x{}\n".format(i) for i in range(10)))
        (src / "three.py").write_text("a\nb\nc\n")
        (src / "legacy.py").write_text("l1\nl2\n")
        (src / "empty.py").write_text("")
        card = self.hdir / "cards" / "security.1.md"
        card.parent.mkdir(parents=True)
        card.write_text("# card\nrule\n", encoding="utf-8", newline="\n")
        self.task("se-u1-p1", "seeded: {}\ncard: {}\n{}".format(
            seeded, PP.posix(str(card)), extra_task))
        tr = self.transcript("a1")
        root = PP.posix(str(self.repo))
        tr.read(root + "/src/ten.py", numbered(["x{}".format(i) for i in range(5)]) +
                "\n\nNote: PARTIAL view: showing lines 1-5 of 10.")
        tr.read(root + "/src/three.py", numbered(["a", "b", "c"]))
        tr.read(PP.posix(str(card)), numbered(["# card", "rule"]))
        tr.read(root + "/src/legacy.py", numbered(["l1", "l2"], arrow=True))
        tr.read(root + "/src/empty.py", "<system-reminder>Warning: the file exists but its "
                "contents are empty.</system-reminder>")
        tr.lines.append({"type": "system", "subtype": "compact_boundary"})
        shared = tr.assistant([{"type": "text", "text": "thinking"}], mid="shared")
        tr.assistant([{"type": "text", "text": "more"}], mid=shared)
        self.tr = tr
        return card

    def save(self) -> None:
        message = self.message()
        self.tr.final(message)
        path = self.tr.write()
        code, _out = PP.hook(self.payload(message, transcript=path))
        self.assertEqual(code, 0)

    def test_observe_reads_models_usage_and_compaction(self) -> None:
        self.build()
        self.save()
        code, out, err = run_main(["observe", "se-u1-p1", "--repo", str(self.repo)])
        self.assertEqual(code, 0, out + err)
        lines = [ln for ln in out.strip().split("\n") if ln]
        self.assertEqual(len([ln for ln in lines if not ln.startswith("WARN")]), 1, lines)
        self.assertIn("model claude-opus-5-5", lines[0])
        reads = json.loads((self.hdir / "passes" / "se-u1-p1.reads.json").read_text())
        by_path = {r["path"] if isinstance(r, dict) else r: r for r in reads["files_read"]}
        self.assertEqual(by_path["src/ten.py"]["ranges"], [[1, 5]])
        self.assertEqual(by_path["src/three.py"]["ranges"], [[1, 3]])
        self.assertEqual(by_path["src/legacy.py"]["ranges"], [[1, 2]])
        self.assertEqual(by_path["src/empty.py"], "src/empty.py")
        self.assertEqual(reads["support_reads"], [".harden/cards/security.1.md"])
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        obs = meta["observed"]
        self.assertTrue(obs["compacted"])
        self.assertTrue(obs["complete"])
        self.assertEqual(obs["requests"], 7)  # 5 reads, 1 shared message, 1 final
        self.assertEqual(obs["usage"]["output_tokens"], 7 * 7)
        self.assertEqual(obs["effort"], ["high"])
        self.assertEqual(obs["candidates"], 1)
        self.assertTrue((self.hdir / "passes" / "se-u1-p1.result.json").is_file())

    def test_card_read_only_in_part_is_incomplete(self) -> None:
        card = self.build()
        card.write_text("".join("r{}\n".format(i) for i in range(300)))
        self.save()
        code, out, _err = run_main(["observe", "se-u1-p1", "--repo", str(self.repo)])
        self.assertEqual(code, 1)
        self.assertIn("card not fully read", out)

    def test_out_of_scope_reads_are_left_out(self) -> None:
        self.build()
        (self.hdir / "tools").mkdir()
        (self.hdir / "tools" / "inscope.txt").write_text("src/ten.py\nsrc/three.py\n")
        self.save()
        run_main(["observe", "se-u1-p1", "--repo", str(self.repo)])
        reads = json.loads((self.hdir / "passes" / "se-u1-p1.reads.json").read_text())
        paths = sorted(r["path"] if isinstance(r, dict) else r for r in reads["files_read"])
        self.assertEqual(paths, ["src/ten.py", "src/three.py"])
        self.assertIn("src/legacy.py", reads["out_of_scope_reads"])

    def test_unseeded_pass_reading_tool_output_or_grepping_harden_is_flagged(self) -> None:
        self.build(seeded="no")
        tools = self.hdir / "tools"
        tools.mkdir()
        (tools / "eslint.json").write_text("{}\n")
        self.tr.read(PP.posix(str(tools / "eslint.json")), numbered(["{}"]))
        self.tr.tool("Grep", {"pattern": "x", "path": ".harden/passes"}, "No matches")
        self.save()
        code, out, _err = run_main(["observe", "se-u1-p1", "--repo", str(self.repo)])
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        violations = meta["observed"]["unseeded_violations"]
        self.assertIn(".harden/tools/eslint.json", violations)
        self.assertTrue(any(v.startswith("Grep path=") for v in violations), violations)
        self.assertIn("WARN", out)

    def test_notebook_read_without_numbered_lines_counts_whole(self) -> None:
        self.build()
        (self.repo / "nb.ipynb").write_text("{}\n")
        self.tr.read(PP.posix(str(self.repo / "nb.ipynb")), "Cell 1: print('x')")
        self.save()
        run_main(["observe", "se-u1-p1", "--repo", str(self.repo)])
        reads = json.loads((self.hdir / "passes" / "se-u1-p1.reads.json").read_text())
        self.assertIn("nb.ipynb", reads["files_read"])

    def test_not_persisted_and_missing_transcript(self) -> None:
        code, out, _err = run_main(["observe", "zz-u1-p1", "--repo", str(self.repo)])
        self.assertEqual(code, 3)
        self.assertIn("recover", out)
        (self.hdir / "passes").mkdir()
        (self.hdir / "passes" / "zz-u1-p1.md").write_text(self.message("zz-u1-p1"))
        (self.hdir / "passes" / "zz-u1-p1.meta.json").write_text(json.dumps(
            {"pass_id": "zz-u1-p1", "kind": "lens",
             "agent_transcript_path": str(self.tmp / "gone.jsonl")}))
        code, out, _err = run_main(["observe", "zz-u1-p1", "--repo", str(self.repo)])
        self.assertEqual(code, 1)
        meta = json.loads((self.hdir / "passes" / "zz-u1-p1.meta.json").read_text())
        self.assertFalse(meta["observed"]["complete"])

    def test_verifier_forbidden_command_audit(self) -> None:
        (self.hdir / "active").write_text(json.dumps({"base_sha": "x", "forbidden_commands":
                                                      ["/\\bhardhat\\s+deploy\\b/"]}))
        self.task("V02", kind="verifier")
        tr = self.transcript("v2", "V02")
        tr.tool("Bash", {"command": "npx hardhat deploy --network x"}, "deployed")
        tr.tool("Bash", {"command": "hardhat deploy"}, "/harden: refused by hook", error=True)
        tr.tool("Bash", {"command": "npm test"}, "ok")
        message = 'pass-id: V02\n{"pass_id": "V02", "verdict": "verified"}'
        tr.final(message)
        path = tr.write()
        PP.hook(self.payload(message, agent="v2", agent_type="harden-verifier", transcript=path))
        code, out, _err = run_main(["observe", "V02", "--repo", str(self.repo)])
        self.assertEqual(code, 0, out)
        self.assertIn("WARN: forbidden command ran in verifier V02: npx hardhat deploy", out)
        meta = json.loads((self.hdir / "verifiers" / "V02.meta.json").read_text())
        self.assertEqual(meta["observed"]["forbidden_ran"], ["npx hardhat deploy --network x"])

    @unittest.skipUnless(os.name == "nt", "drive-letter path forms")
    def test_windows_path_forms_map_to_one_file(self) -> None:
        src = self.repo / "src"
        src.mkdir()
        (src / "a.ts").write_text("1\n2\n3\n")
        self.task("se-u1-p1")
        tr = self.transcript("a1")
        win = str(self.repo).replace("/", "\\") + "\\src\\a.ts"
        low = PP.posix(str(self.repo)).lower() + "/src/a.ts"
        msys = "/" + PP.posix(str(self.repo))[0].lower() + PP.posix(str(self.repo))[2:] + \
            "/src/a.ts"
        tr.read(win, numbered(["1"]))
        tr.read(low, numbered(["2"], start=2))
        tr.read(msys, numbered(["3"], start=3))
        message = self.message()
        tr.final(message)
        PP.hook(self.payload(message, transcript=tr.write()))
        run_main(["observe", "se-u1-p1", "--repo", str(self.repo)])
        reads = json.loads((self.hdir / "passes" / "se-u1-p1.reads.json").read_text())
        self.assertEqual(reads["files_read"], [{"path": "src/a.ts", "ranges": [[1, 3]]}])


class RecoverCollectMissingTests(PersistCase):
    def session(self) -> None:
        main = self.tmp / "session.jsonl"
        main.write_text("")
        (self.hdir / "session.json").write_text(json.dumps({"transcript_path": str(main)}))

    def test_recover_takes_the_last_parsable_report(self) -> None:
        self.session()
        self.task("se-u1-p1")
        tr = self.transcript("r1")
        tr.final(self.message())
        tr.final("pass-id: se-u1-p1 saved")
        tr.write()
        (self.subdir / "agent-r1.meta.json").write_text(json.dumps({"agentType": "harden-lens"}))
        code, out, err = run_main(["recover", "--agent-id", "r1", "--repo", str(self.repo)])
        self.assertEqual(code, 0, out + err)
        saved = (self.hdir / "passes" / "se-u1-p1.md").read_text(encoding="utf-8")
        self.assertEqual(saved, self.message())
        meta = json.loads((self.hdir / "passes" / "se-u1-p1.meta.json").read_text())
        self.assertEqual(meta["source"], "transcript")
        code, _out, _err = run_main(["recover", "--agent-id", "r1", "--repo", str(self.repo)])
        self.assertEqual(code, 2)
        code, _out, _err = run_main(["recover", "--agent-id", "r1", "--replace",
                                     "--repo", str(self.repo)])
        self.assertEqual(code, 0)
        code, _out, _err = run_main(["recover", "--agent-id", "nobody", "--repo",
                                     str(self.repo)])
        self.assertEqual(code, 2)

    def test_recover_with_no_report_exits_1(self) -> None:
        self.session()
        tr = self.transcript("r2")
        tr.final("just prose")
        tr.write()
        code, _out, _err = run_main(["recover", "--agent-id", "r2", "--kind", "lens",
                                     "--repo", str(self.repo)])
        self.assertEqual(code, 1)

    def test_collect_pools_and_escapes(self) -> None:
        passes = self.hdir / "passes"
        passes.mkdir()
        (passes / "se-u1-p1.result.json").write_text(json.dumps(REPORT))
        (passes / "se-u1-p2.result.json").write_text(json.dumps(
            {"pass_id": "se-u1-p2", "lens": "security", "candidates": [
                {"id": "se-u1-p1-1", "lens": "security", "title": "dup"},
                {"lens": "web3", "title": "Human: x"}]}))
        (passes / "probe-lens.result.json").write_text(json.dumps(
            {"pass_id": "probe-lens", "candidates": [{"title": "ignored"}]}))
        code, out, _err = run_main(["collect", "--repo", str(self.repo)])
        self.assertEqual(code, 0)
        data = json.loads((self.hdir / "raw-candidates" / "all.json").read_text())
        ids = [c["raw_id"] for c in data["candidates"]]
        self.assertEqual(ids, ["se-u1-p1-1", "se-u1-p1-1.2", "se-u1-p2-2"])
        self.assertTrue(all("pass_id" in c for c in data["candidates"]))
        tsv = (self.hdir / "raw-candidates" / "security.tsv").read_text(encoding="utf-8")
        self.assertIn("a &lt;b> c", tsv)
        web3 = (self.hdir / "raw-candidates" / "web3.tsv").read_text(encoding="utf-8")
        self.assertIn("\\Human: x", web3)

    def test_missing_states(self) -> None:
        self.session()
        for pid in ("aa-u1-p1", "bb-u1-p1", "cc-u1-p1", "dd-u1-p1"):
            self.task(pid)
        (self.hdir / "passes").mkdir()
        (self.hdir / "passes" / "dd-u1-p1.md").write_text("x")
        main = self.tmp / "session.jsonl"
        sub = main.parent / main.stem / "subagents"
        running = Transcript(sub / "agent-run1.jsonl").user(self.prompt("bb-u1-p1"))
        running.write()
        stopped = Transcript(sub / "agent-old1.jsonl").user(self.prompt("cc-u1-p1"))
        path = stopped.write()
        old = time.time() - 3600
        os.utime(path, (old, old))
        code, out, _err = run_main(["missing", "--repo", str(self.repo)])
        self.assertEqual(code, 1)
        self.assertIn("aa-u1-p1 (task written", out)
        self.assertIn("aa-u1-p1", [ln.split()[1] for ln in out.split("\n") if "not launched" in ln])
        self.assertIn("bb-u1-p1", [ln.split()[1] for ln in out.split("\n") if "running (agent run1" in ln])
        self.assertIn("recover --agent-id old1", out)
        self.assertNotIn("dd-u1-p1", out)
        for pid in ("aa-u1-p1", "bb-u1-p1", "cc-u1-p1"):
            (self.hdir / "passes" / "{}.md".format(pid)).write_text("x")
        code, out, _err = run_main(["missing", "--repo", str(self.repo)])
        self.assertEqual(code, 0)


class AckWithoutFlagTests(PersistCase):
    """Safety review, round 3: the acknowledgement line ends the exchange even when the
    payload lacks stop_hook_active, so the hook cannot block the agent turn after turn."""

    def test_ack_line_without_the_flag_is_recorded_not_versioned_or_blocked(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        message = self.message()
        code, out = PP.hook(self.payload(message, transcript=tr))
        self.assertEqual(json.loads(out)["decision"], "block")
        for _ in range(3):
            code, out = PP.hook(self.payload("pass-id: se-u1-p1 saved\n", transcript=tr,
                                             active=False))
            self.assertEqual((code, out), (0, ""))
        passes = self.hdir / "passes"
        self.assertEqual(sorted(p.name for p in passes.glob("se-u1-p1*.md")), ["se-u1-p1.md"])
        self.assertEqual((passes / "se-u1-p1.md").read_text(encoding="utf-8"), message)
        meta = json.loads((passes / "se-u1-p1.meta.json").read_text())
        self.assertEqual((meta["ack"], meta["versions"]), ("pass-id: se-u1-p1 saved\n", []))

    def test_ack_line_before_any_report_is_not_an_ack(self) -> None:
        self.task("se-u1-p1")
        tr = self.transcript("a1").write()
        code, out = PP.hook(self.payload("pass-id: se-u1-p1 saved", transcript=tr))
        self.assertEqual(code, 0)
        self.assertIn("could not be read", json.loads(out)["reason"])
        self.assertFalse((self.hdir / "passes" / "se-u1-p1.md").exists())


class PrefaceTests(PersistCase):
    """pilot-auto-calibration A01-F55: a short preface before the pass-id line is tolerated;
    only the prompt's own id matches, and the file is named by the prompt."""

    OBJ = {"pass_id": "V03", "verdicts": []}

    def run_v03(self, message: str) -> Dict[str, Any]:
        self.task("V03", kind="verifier")
        tr = self.transcript("v3", "V03")
        tr.final(message)
        path = tr.write()
        code, _out = PP.hook(self.payload(message, agent="v3", agent_type="harden-verifier",
                                          transcript=path))
        self.assertEqual(code, 0)
        return json.loads((self.hdir / "verifiers" / "V03.meta.json").read_text(
            encoding="utf-8"))

    def observe(self) -> str:
        _code, out, err = run_main(["observe", "V03", "--repo", str(self.repo)])
        return out + err

    def test_short_preface_is_tolerated_and_recorded(self) -> None:
        message = ("All evidence gathered. I'm ready to write the final verdicts.\n\n"
                   "pass-id: V03\n" + json.dumps(self.OBJ))
        meta = self.run_v03(message)
        saved = (self.hdir / "verifiers" / "V03.md").read_bytes()
        self.assertEqual(saved, message.encode("utf-8"))
        self.assertEqual(meta["id_line"], "after-preface")
        self.assertEqual(meta["preface_lines"], 2)
        self.assertIs(meta["parsed"], True)
        self.assertNotIn("id line", self.observe())

    def test_sixteen_line_preface_like_pilot3_v_trades(self) -> None:
        preface = "".join("Line {} checks `src/portfolio/trades.ts:56` again.\n".format(i)
                          for i in range(16))
        meta = self.run_v03(preface + "pass-id: V03\n" + json.dumps(self.OBJ))
        self.assertEqual(meta["id_line"], "after-preface")
        self.assertIs(meta["parsed"], True)

    def test_braces_in_the_preface_do_not_break_parsing(self) -> None:
        meta = self.run_v03("The value `{}` is returned when the file is missing.\n"
                            "pass-id: V03\n" + json.dumps(self.OBJ))
        self.assertIs(meta["parsed"], True)

    def test_preface_quoting_another_id_is_a_mismatch_and_never_names_the_file(self) -> None:
        meta = self.run_v03("The file says\npass-id: V09\nso:\npass-id: V03\n" +
                            json.dumps(self.OBJ))
        self.assertEqual(meta["id_line"], "mismatch")
        self.assertTrue((self.hdir / "verifiers" / "V03.md").is_file())
        self.assertFalse((self.hdir / "verifiers" / "V09.md").exists())
        self.assertIn("WARN: V03: id line mismatch", self.observe())

    def test_object_pass_id_that_disagrees_is_a_mismatch(self) -> None:
        meta = self.run_v03("pass-id: V03\n" + json.dumps({"pass_id": "V04", "verdicts": []}))
        self.assertEqual(meta["id_line"], "mismatch")

    def test_id_line_beyond_the_preface_window_is_missing(self) -> None:
        preface = "".join("prose line {}\n".format(i) for i in range(41))
        meta = self.run_v03(preface + "pass-id: V03\n" + json.dumps(self.OBJ))
        self.assertEqual(meta["id_line"], "missing")
        self.assertIs(meta["parsed"], True)
        self.assertIn("WARN: V03: id line missing", self.observe())

    def test_id_line_after_the_object_is_not_used(self) -> None:
        meta = self.run_v03(json.dumps(self.OBJ) + "\npass-id: V03")
        self.assertEqual(meta["id_line"], "missing")

    def test_crlf_and_bom_preface(self) -> None:
        meta = self.run_v03(chr(0xFEFF) + "Done.\r\n\r\npass-id: V03\r\n" +
                            json.dumps(self.OBJ))
        self.assertEqual(meta["id_line"], "after-preface")

    def test_recover_records_the_preface(self) -> None:
        main = self.tmp / "session.jsonl"
        main.write_text("")
        (self.hdir / "session.json").write_text(json.dumps({"transcript_path": str(main)}))
        self.task("V03", kind="verifier")
        tr = self.transcript("r3", "V03")
        tr.final("Done.\n\npass-id: V03\n" + json.dumps(self.OBJ))
        tr.write()
        (self.subdir / "agent-r3.meta.json").write_text(
            json.dumps({"agentType": "harden-verifier"}))
        code, out, err = run_main(["recover", "--agent-id", "r3", "--repo", str(self.repo)])
        self.assertEqual(code, 0, out + err)
        meta = json.loads((self.hdir / "verifiers" / "V03.meta.json").read_text(
            encoding="utf-8"))
        self.assertEqual(meta["id_line"], "after-preface")


if __name__ == "__main__":
    unittest.main()
