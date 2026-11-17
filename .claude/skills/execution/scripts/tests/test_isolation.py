"""Test isolation (TESTS.md 1.3; LANES.md B01): no write under the real ~/.claude/, no network.

Protects: the watched entries of the real ~/.claude/ (settings.json, settings.local.json, every file of agents/ and
hooks/, the entry names of skills/) are unchanged between the suite's import phase (unittest imports every test module
before running any) and this test, and across CLI runs made here with the isolated environment; env_isolated points
CLAUDE_CONFIG_DIR at a temp dir and sets EXEC_TEST=1 without PYTHONIOENCODING; the network-sensitive helpers work under
a socket guard that refuses non-loopback addresses (positive control: the guard does refuse one).

Never compared, because the owner's own tooling writes them while any Claude Code session runs and the skill never
does: usage-snapshot.json and its usage-snapshot.json.*.tmp temp files at the root (~/.claude/statusline.py, on every
status-line render: a temp file, then os.replace), and hooks/guard.log (the owner's guard hook). Nothing else. The
snapshot helper takes a root: on temp config dirs laid out like ~/.claude/, a change to any other watched entry is
detected, alone or beside a status-line rewrite, and a status-line rewrite alone is not (positive control: the same
temp-file-then-replace write on settings.json is detected).

Run: python -m unittest discover -s scripts/tests -p "test_isolation.py" -v
"""
from __future__ import annotations

import fnmatch
import json
import os
import socket
import unittest
import urllib.request
from pathlib import Path
from typing import Callable
from unittest import mock

import _support as S
from execlib import gitutil

REAL = Path.home() / ".claude"

# The watched entries: what exec.py could write in a config dir if the isolation failed. hooks install writes
# <repo>/.claude/settings.local.json (the real one if the repository resolved to the home directory), agents install
# writes agents/, hookcore's fallback error log is hooks/execution-hooks.log, and no skill may appear in skills/.
ROOT_FILES = ("settings.json", "settings.local.json")
FILE_DIRS = ("agents", "hooks")  # every regular file, one level down
NAME_DIR = "skills"  # the entry names only

# Never compared. ~/.claude/statusline.py rewrites usage-snapshot.json on every status-line render of any session,
# through a temp file usage-snapshot.json.<pid>.tmp and os.replace; exec.py only reads that file (quota.read_snapshot),
# so ignoring it hides nothing the skill writes. hooks/guard.log is the owner's guard hook log (excluded from the
# start).
STATUS_LINE_FILES = ("usage-snapshot.json", "usage-snapshot.json.*.tmp")  # fnmatch patterns, at the root only
GUARD_LOG = "hooks/guard.log"


def ignored(rel: str) -> bool:
    """True for exactly the never-compared paths; `rel` is relative to the config dir, with forward slashes. The
    status-line names count at the root only: anywhere else they are watched like any other file."""
    if "/" in rel or "\\" in rel:
        return rel == GUARD_LOG
    return any(fnmatch.fnmatchcase(rel, pattern) for pattern in STATUS_LINE_FILES)


def _stat(path: Path) -> tuple[int, int] | None:
    """(size, mtime_ns), or None when the path does not exist (or vanished after it was listed)."""
    try:
        st = path.stat()
    except FileNotFoundError:
        return None
    return st.st_size, st.st_mtime_ns


def snapshot(root: Path = REAL) -> dict[str, object]:
    """The watched entries under `root` (default: the real ~/.claude/) minus the ignored() paths, keyed by relative
    path: each root file -> (size, mtime_ns), None when absent; `<dir>/` -> "dir", None when absent, and each regular
    file in it -> (size, mtime_ns); `skills/` -> the sorted entry names, None when absent."""
    snap: dict[str, object] = {}
    for name in ROOT_FILES:
        if not ignored(name):
            snap[name] = _stat(root / name)
    for sub in FILE_DIRS:
        directory = root / sub
        if not directory.is_dir():
            snap[f"{sub}/"] = None
            continue
        snap[f"{sub}/"] = "dir"
        for child in directory.iterdir():
            rel = f"{sub}/{child.name}"
            if ignored(rel) or not child.is_file():
                continue
            stat = _stat(child)
            if stat is not None:
                snap[rel] = stat
    names = root / NAME_DIR
    snap[f"{NAME_DIR}/"] = sorted(c.name for c in names.iterdir()) if names.is_dir() else None
    return snap


_MISSING = object()


def changed(before: dict[str, object], after: dict[str, object]) -> list[str]:
    """The keys added, removed or changed between two snapshots, sorted."""
    return sorted(k for k in before.keys() | after.keys() if before.get(k, _MISSING) != after.get(k, _MISSING))


def describe(before: dict[str, object], after: dict[str, object]) -> str:
    return "; ".join(f"{k}: {before.get(k, 'absent')} -> {after.get(k, 'absent')}" for k in changed(before, after))


AT_IMPORT = snapshot()


# --- temp config dirs laid out like ~/.claude/ (these controls never write the real one) ----------------------------

FIXED_NS = int(S.fixed_now().timestamp()) * 1_000_000_000
LATER_NS = FIXED_NS + 10 * 1_000_000_000
LAYOUT = {
    "settings.json": '{"model": "opus"}\n',
    "settings.local.json": '{"permissions": {"allow": []}}\n',
    "usage-snapshot.json": '{"captured_at_utc": "2026-10-03T07:00:00Z", "five_hour": {"used_percentage": 1}}\n',
    "agents/a.md": "agent\n",
    "hooks/h.py": "HOOK = 1\n",
    "hooks/guard.log": "guard\n",
    "skills/s1/SKILL.md": "skill\n",
}

Mutation = Callable[[Path], object]


def make_layout(root: Path) -> Path:
    """Every kind of watched entry plus the owner's files beside them, each mtime set to the suite's fixed instant so
    that a later write shows even when it keeps the size."""
    for rel, text in LAYOUT.items():
        os.utime(S.write_text(root / rel, text), ns=(FIXED_NS, FIXED_NS))
    return root


def status_line_render(root: Path) -> None:
    """What ~/.claude/statusline.py does on every render: write usage-snapshot.json.<pid>.tmp, then os.replace it onto
    usage-snapshot.json."""
    doc = {"captured_at_utc": S.FIXED_NOW, "session_id": "sess-other-window", "model": "Opus",
           "five_hour": {"used_percentage": 57.0, "resets_at": 1791014400},
           "seven_day": {"used_percentage": 12.0, "resets_at": 1791360000}}
    tmp = root / f"usage-snapshot.json.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh)
    os.replace(tmp, root / "usage-snapshot.json")


def leftover_status_line_temps(root: Path) -> None:
    """Temp files of two sessions' renders interrupted before their os.replace."""
    for pid in (4242, 4243):
        S.write_text(root / f"usage-snapshot.json.{pid}.tmp", '{"five_hour": null}\n')


def root_files(root: Path) -> list[tuple[str, int, int]]:
    """Every regular file at the root with its size and mtime: where the ignored writes do show on disk."""
    return sorted((p.name, p.stat().st_size, p.stat().st_mtime_ns) for p in root.iterdir() if p.is_file())


def write(rel: str, text: str = "changed, and longer than any original\n") -> Mutation:
    return lambda root: S.write_text(root / rel, text)


def replace_atomically(rel: str, text: str) -> Mutation:
    """The status line's write pattern (a temp file beside the target, then os.replace) applied to another file."""
    def run(root: Path) -> None:
        tmp = S.write_text(root / f"{rel}.{os.getpid()}.tmp", text)
        os.replace(tmp, root / rel)
    return run


def touch(rel: str) -> Mutation:
    """The same bytes with a later mtime."""
    return lambda root: os.utime(root / rel, ns=(LATER_NS, LATER_NS))


def unlink(rel: str) -> Mutation:
    return lambda root: (root / rel).unlink()


def remove_tree(rel: str) -> Mutation:
    return lambda root: S.rmtree(root / rel)


def make_dir(rel: str) -> Mutation:
    return lambda root: (root / rel).mkdir()


def nothing(root: Path) -> None:
    """No preparation."""


# (what, preparation before the first snapshot, the change, the keys the snapshot must report: exactly these)
OTHER_CHANGES: tuple[tuple[str, Mutation, Mutation, list[str]], ...] = (
    ("settings.json rewritten", nothing, write("settings.json"), ["settings.json"]),
    ("settings.json replaced atomically at the same size", nothing,
     replace_atomically("settings.json", '{"model": "fast"}\n'), ["settings.json"]),
    ("settings.json mtime only", nothing, touch("settings.json"), ["settings.json"]),
    ("settings.local.json deleted", nothing, unlink("settings.local.json"), ["settings.local.json"]),
    ("settings.local.json created", unlink("settings.local.json"), write("settings.local.json"),
     ["settings.local.json"]),
    ("agents/ file rewritten", nothing, write("agents/a.md"), ["agents/a.md"]),
    ("agents/ file mtime only", nothing, touch("agents/a.md"), ["agents/a.md"]),
    ("agents/ file created", nothing, write("agents/new.md"), ["agents/new.md"]),
    ("agents/ file deleted", nothing, unlink("agents/a.md"), ["agents/a.md"]),
    ("agents/ created", remove_tree("agents"), write("agents/new.md"), ["agents/", "agents/new.md"]),
    ("agents/ removed", nothing, remove_tree("agents"), ["agents/", "agents/a.md"]),
    ("hooks/ file rewritten", nothing, write("hooks/h.py"), ["hooks/h.py"]),
    ("hooks/ file created: hookcore's fallback error log", nothing, write("hooks/execution-hooks.log"),
     ["hooks/execution-hooks.log"]),
    ("the snapshot's name below the root", nothing, write("agents/usage-snapshot.json"),
     ["agents/usage-snapshot.json"]),
    ("a status-line temp name below the root", nothing, write("hooks/usage-snapshot.json.4242.tmp"),
     ["hooks/usage-snapshot.json.4242.tmp"]),
    ("guard.log outside hooks/", nothing, write("agents/guard.log"), ["agents/guard.log"]),
    ("skills/ entry added", nothing, make_dir("skills/s2"), ["skills/"]),
    ("skills/ entry removed", nothing, remove_tree("skills/s1"), ["skills/"]),
)

# (what, preparation before the first snapshot, the owner's write): each must leave the snapshot unchanged
STATUS_LINE_WRITES: tuple[tuple[str, Mutation, Mutation], ...] = (
    ("rewritten by a render", nothing, status_line_render),
    ("created by the first render", unlink("usage-snapshot.json"), status_line_render),
    ("deleted", nothing, unlink("usage-snapshot.json")),
    ("temp files left by interrupted renders", nothing, leftover_status_line_temps),
)


class Isolation(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = S.mkdtemp()
        self.layouts = 0

    def tearDown(self) -> None:
        S.rmtree(self.tmp)

    def fresh_layout(self, prepare: Mutation) -> Path:
        self.layouts += 1
        root = make_layout(self.tmp / f"cfg-{self.layouts}")
        prepare(root)
        return root

    def test_env_isolated(self) -> None:
        env = S.env_isolated()
        self.assertEqual(env["EXEC_TEST"], "1")
        self.assertEqual(env["EXEC_NOW"], S.FIXED_NOW)
        self.assertNotIn("PYTHONIOENCODING", env)
        self.assertNotIn("PYTHONUTF8", env)
        cfg = Path(env["CLAUDE_CONFIG_DIR"]).resolve()
        self.assertTrue(cfg.is_dir())
        self.assertNotIn(REAL.resolve(), [cfg, *cfg.parents])
        self.assertEqual(env["CLAUDE_CODE_SESSION_ID"], S.SESSION_ID)
        self.assertEqual(env["HOME" if "HOME" in os.environ else "USERPROFILE"],
                         os.environ["HOME" if "HOME" in os.environ else "USERPROFILE"])
        self.assertNotIn("EXEC_NOW", S.env_isolated(EXEC_NOW=None))

    def test_real_claude_dir_unchanged_since_import(self) -> None:
        now = snapshot()
        self.assertEqual(changed(AT_IMPORT, now), [],
                         f"written under {REAL} since the suite's import phase: {describe(AT_IMPORT, now)}")

    def test_cli_runs_leave_real_claude_dir_alone(self) -> None:
        before = snapshot()
        for args in (["frobnicate"], ["status", "--digest"], ["agents", "status"], ["validate"],
                     ["quota"], ["hooks", "install"]):
            S.run_exec(args, cwd=self.tmp)
        # positive control: the same helper, pointed at the isolated config dir, sees a write there
        cfg = Path(S.env_isolated()["CLAUDE_CONFIG_DIR"])
        (cfg / "agents").mkdir(parents=True, exist_ok=True)
        cfg_before = snapshot(cfg)
        probe = S.write_text(cfg / "agents" / "probe.md", "x\n")
        try:
            self.assertEqual(changed(cfg_before, snapshot(cfg)), ["agents/probe.md"])
        finally:
            probe.unlink()
        self.assertEqual(changed(cfg_before, snapshot(cfg)), [])
        after = snapshot()
        self.assertEqual(changed(before, after), [], f"written under {REAL} by the CLI runs: {describe(before, after)}")

    def test_ignore_rule_is_exact(self) -> None:
        for rel in ("usage-snapshot.json", "usage-snapshot.json.4242.tmp", "usage-snapshot.json.1.tmp", GUARD_LOG):
            with self.subTest(rel=rel):
                self.assertTrue(ignored(rel))
        for rel in (*ROOT_FILES, "usage-snapshot.json.bak", "usage-snapshot.json.tmp",
                    "usage-snapshot.json.4242.tmp.bak", "usage-snapshot.jsonl", "old-usage-snapshot.json",
                    "Usage-Snapshot.json", "USAGE-SNAPSHOT.JSON.1.TMP",
                    ".usage-snapshot.json.4242.987654321.tmp",  # the shape of jsonio's own temp files
                    "usage-snapshot.json.4242/x.tmp", "usage-snapshot.json/x", "agents\\usage-snapshot.json",
                    "agents/usage-snapshot.json", "hooks/usage-snapshot.json.4242.tmp", "skills/usage-snapshot.json",
                    "guard.log", "agents/guard.log", "hooks/guard.log.1", "hooks/sub/guard.log",
                    "agents/a.md", "hooks/h.py"):
            with self.subTest(rel=rel):
                self.assertFalse(ignored(rel))
        # end to end: with every watched kind, the owner's files and leftover status-line temp files on disk, the
        # snapshot holds every watched entry and nothing the rule ignores
        root = self.fresh_layout(leftover_status_line_temps)
        self.assertEqual(sorted(snapshot(root)), ["agents/", "agents/a.md", "hooks/", "hooks/h.py", "settings.json",
                                                  "settings.local.json", "skills/"])

    def test_change_to_any_other_watched_file_is_detected(self) -> None:
        """Positive control of the two real-dir tests above: each kind of change to a watched entry shows, exactly,
        alone or beside a status-line rewrite in the same window."""
        for what, prepare, change, expected in OTHER_CHANGES:
            for beside_status_line in (False, True):
                with self.subTest(what=what, beside_status_line=beside_status_line):
                    root = self.fresh_layout(prepare)
                    before = snapshot(root)
                    change(root)
                    if beside_status_line:
                        status_line_render(root)
                    self.assertEqual(changed(before, snapshot(root)), expected)

    def test_status_line_rewrite_alone_is_ignored(self) -> None:
        def positive() -> None:  # the same write pattern on a watched file is caught
            root = self.fresh_layout(nothing)
            before = snapshot(root)
            replace_atomically("settings.json", '{"model": "fast"}\n')(root)
            self.assertEqual(changed(before, snapshot(root)), ["settings.json"])

        def negative() -> None:
            for what, prepare, owner_write in STATUS_LINE_WRITES:
                with self.subTest(what=what):
                    root = self.fresh_layout(prepare)
                    before, on_disk = snapshot(root), root_files(root)
                    owner_write(root)
                    self.assertNotEqual(root_files(root), on_disk, "the owner's write left no trace on disk")
                    after = snapshot(root)
                    self.assertEqual(changed(before, after), [], describe(before, after))

        S.assert_controlled(self, negative, positive)


class NoNetwork(unittest.TestCase):
    def setUp(self) -> None:
        self.real_connect = socket.socket.connect

        def guarded(sock: socket.socket, address: object) -> object:
            host = address[0] if isinstance(address, tuple) else str(address)
            if host not in ("127.0.0.1", "::1", "localhost"):
                raise ConnectionRefusedError(f"socket guard: non-loopback address {host}")
            return self.real_connect(sock, address)  # type: ignore[arg-type]

        self.patch = mock.patch.object(socket.socket, "connect", guarded)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()

    def test_guard_refuses_non_loopback(self) -> None:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            with self.assertRaises(ConnectionRefusedError):
                s.connect(("192.0.2.1", 80))
        finally:
            s.close()

    def test_helpers_stay_local(self) -> None:
        url, close = S.http_fixture({"/ok": (200, json.dumps({"ok": True}))})
        try:
            with urllib.request.urlopen(url + "/ok", timeout=10) as resp:  # noqa: S310 - loopback fixture
                self.assertEqual(json.loads(resp.read().decode("utf-8")), {"ok": True})
        finally:
            close()
        with S.TempRepo() as repo:
            self.assertTrue(gitutil.remote_is_private(repo.origin.as_posix()))


if __name__ == "__main__":
    unittest.main()
