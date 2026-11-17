"""Encodings (README.md 2-3.3, TESTS.md 1.3 and 9; LANES.md B01).

Protects: without PYTHONIOENCODING (Windows pipes default to cp1252) the CLI prints UTF-8 envelopes and log lines that
carry emoji, arrows, comparison signs and U+202F intact; the hook scripts, when lane B08 has delivered all six, print
ASCII-only JSON for payloads holding the same characters; every file of the skill tree is UTF-8 without BOM, LF only,
with a final newline (a heredoc-written CRLF file is caught; positive control: a planted CRLF file fails the check).
research/ (the approved research digests, owned by B00 and edited by no lane) is outside the check: see the B01 report.

Run: python -m unittest discover -s scripts/tests -p "test_encoding.py" -v
"""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

import _support as S
from execlib import procutil

SPECIAL = "statüs→≤\U0001F600 "
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".mp4", ".woff", ".woff2", ".zip",
                   ".pyc"}
EXCLUDED_DIRS = {"__pycache__", ".git", "research", "node_modules"}
HOOKS = ["stop_gate.py", "session_start.py", "session_end.py", "stop_failure.py", "pre_tool_guard.py",
         "user_prompt.py"]


def file_problems(path: Path) -> list[str]:
    raw = path.read_bytes()
    out: list[str] = []
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        out.append("not UTF-8")
    if raw.startswith(b"\xef\xbb\xbf"):
        out.append("BOM")
    if b"\r" in raw:
        out.append("CR")
    if raw and not raw.endswith(b"\n"):
        out.append("no final newline")
    return out


def skill_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if any(part in EXCLUDED_DIRS for part in rel.parts) or not p.is_file():
            continue
        if p.suffix.lower() in BINARY_SUFFIXES:
            continue
        files.append(p)
    return files


class CliEncoding(unittest.TestCase):
    def test_utf8_envelope_without_pythonioencoding(self) -> None:
        tmp = S.mkdtemp()
        try:
            env = S.env_isolated()
            self.assertNotIn("PYTHONIOENCODING", env)
            proc = subprocess.run([sys.executable, str(S.EXEC_PY), SPECIAL], cwd=str(tmp), env=env,
                                  capture_output=True, timeout=60)
            text = proc.stdout.decode("utf-8")  # strict: a cp1252 or replacement byte would fail here
            envelope = json.loads(text)
            self.assertEqual(proc.returncode, 2)
            # argparse quotes the token with repr(), which escapes U+202F (not printable); the rest arrives intact
            self.assertIn(SPECIAL[:-1], envelope["errors"][0]["message"])
            self.assertIn("\U0001F600".encode("utf-8"), proc.stdout, "raw UTF-8 bytes, not an ASCII escape")
            for line in proc.stderr.decode("utf-8").splitlines():
                json.loads(line)
            code, env2, _logs = S.run_exec([SPECIAL], cwd=tmp)
            self.assertEqual(code, 2)
            with self.assertRaises(UnicodeEncodeError):
                SPECIAL.encode("cp1252")  # positive control: the default pipe encoding cannot carry it
        finally:
            S.rmtree(tmp)


class HookEncoding(unittest.TestCase):
    def test_hooks_print_ascii(self) -> None:
        hooks_dir = S.SCRIPTS_DIR / "hooks"
        if not all((hooks_dir / h).exists() for h in HOOKS) or not (hooks_dir / "py.sh").exists():
            self.skipTest("the six hook scripts and py.sh are lane B08's and not all present yet")
        if procutil.git_bash() is None:
            self.skipTest("Git Bash is needed")
        with S.TempRepo() as repo:
            S.state_dir(repo.path)
            payload = {"session_id": S.SESSION_ID, "cwd": str(repo.path), "hook_event_name": "Stop",
                       "prompt": f"note {SPECIAL}", "stop_hook_active": False, "tool_name": "Bash",
                       "tool_input": {"command": f"echo {SPECIAL}"}, "source": "startup", "reason": "other",
                       "error": "server_error"}
            for hook in HOOKS:
                with self.subTest(hook=hook):
                    code, out, _err, _ms = S.run_hook(hook, payload, cwd=repo.path)
                    self.assertEqual(code, 0)
                    out.decode("ascii")  # strict ASCII
                    if out.strip():
                        json.loads(out.decode("ascii"))


class TreeEncoding(unittest.TestCase):
    def test_every_file_utf8_lf_final_newline(self) -> None:
        files = skill_files(S.SKILL_DIR)
        self.assertGreater(len(files), 50)
        problems = {str(p.relative_to(S.SKILL_DIR)).replace("\\", "/"): file_problems(p) for p in files}
        self.assertEqual({k: v for k, v in problems.items() if v}, {})

    def test_planted_crlf_is_caught(self) -> None:
        tmp = S.mkdtemp()
        try:
            (tmp / "heredoc.md").write_bytes(b"line one\r\nline two\r\n")
            (tmp / "bom.json").write_bytes(b"\xef\xbb\xbf{}\n")
            (tmp / "nofinal.py").write_bytes(b"x = 1")
            (tmp / "good.md").write_bytes("café\n".encode("utf-8"))
            found = {p.name: file_problems(p) for p in skill_files(tmp)}
            self.assertEqual(found, {"bom.json": ["BOM"], "good.md": [], "heredoc.md": ["CR"],
                                     "nofinal.py": ["no final newline"]})
        finally:
            S.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
