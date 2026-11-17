"""Hook latency budget (contract/HOOKS.md 10.1, TESTS.md 4.5, LANES.md B08), with a plan of 120 tasks in the state
and 30 runs of each hook through the real launcher (`bash py.sh <hook>.py`, Git Bash plus `python -S`).

Two tiers, because wall-clock time on a shared machine depends on what else runs:

- Relative (always on, deterministic under load). Each hook run is interleaved with a run of a baseline: a trivial
  Python script (`noop.py`, no import, no read) started the same way, through a copy of the same `py.sh`, by the
  same Git Bash, with the same payload on stdin. Both see the same load, so the baseline's p95 absorbs what the
  machine adds to process start-up. The assertion is p95(hook) - p95(baseline) <= RELATIVE_BUDGET_MS * load: the
  hook's own work (imports, file reads, parsing, writes) against the share HOOKS.md 10.1 leaves it once the
  launcher's start (Git Bash about 80 ms, `python -S` about 40 ms, LAUNCHER_MS) is paid out of the 250 ms total.
  `load` = max(1, p95(baseline) / LAUNCHER_MS) is how much slower than the contract's estimate this machine starts a
  process right now; the hook's own work is CPU work and slows down by the same factor (measured on 16 cores: deltas
  25-72 ms quiet, up to 94 ms with three full test suites running, up to 240 ms with every core saturated, where the
  baseline's p95 reached 350-510 ms).
- Absolute (EXEC_LATENCY=1 only, run by the owner on a quiet machine): p95(hook) <= P95_MS, the contract's 250 ms
  as written. Off by default because it fails whenever other test suites share the CPU (270-450 ms measured).

Positive control: a copy of the hooks with a sleep planted at the top of one hook (a test double, never the skill's
own file) must fail the relative check, so a check that cannot fail is caught. The sleep is twice the budget the
unplanted copy was just held to (a sleep does not slow down with the load, the budget does).

EXEC_SKIP_LATENCY=1 skips every measurement (slow CI-like environments).

Run: python -m unittest discover -s scripts/tests -p "test_hook_latency.py" -v
"""
from __future__ import annotations

import os
import shutil
import unittest
from collections.abc import Callable
from pathlib import Path

import _support as S
import _support_B08 as B

RUNS = 30
P95_MS = 250.0  # absolute, HOOKS.md 10.1 (EXEC_LATENCY=1)
LAUNCHER_MS = 120.0  # HOOKS.md 10.1 budget split: Git Bash start about 80 ms + `python -S` start about 40 ms
RELATIVE_BUDGET_MS = P95_MS - LAUNCHER_MS  # what a hook may add on top of a no-op started the same way, at load 1
BASELINE = "noop.py"
ABSOLUTE = os.environ.get("EXEC_LATENCY") == "1"


def p95(values: list[float]) -> float:
    ordered = sorted(values)
    idx = max(0, int(round(0.95 * len(ordered))) - 1)
    return ordered[idx]


def hooks_copy(dest: Path) -> Path:
    """The hooks' part of the skill (scripts/hooks, execlib's __init__ and hookcore, assets/schemas) copied to `dest`,
    plus the baseline `noop.py` next to the copied launcher. Hooks run from it exactly as from the skill."""
    src = S.SKILL_DIR
    shutil.copytree(src / "scripts" / "hooks", dest / "scripts" / "hooks",
                    ignore=shutil.ignore_patterns("__pycache__"))
    (dest / "scripts" / "execlib").mkdir(parents=True)
    for name in ("__init__.py", "hookcore.py"):
        shutil.copyfile(src / "scripts" / "execlib" / name, dest / "scripts" / "execlib" / name)
    shutil.copytree(src / "assets" / "schemas", dest / "assets" / "schemas")
    S.write_text(dest / "scripts" / "hooks" / BASELINE, "pass\n")
    return dest


def plant_sleep(root: Path, script: str, seconds: float) -> None:
    """Prepend a sleep to the copied hook `script` (after its `from __future__` line, which must stay first)."""
    path = root / "scripts" / "hooks" / script
    lines = path.read_text(encoding="utf-8").split("\n")
    at = next((i + 1 for i, ln in enumerate(lines) if ln.startswith("from __future__")), 0)
    lines[at:at] = ["import time as _planted_time", f"_planted_time.sleep({seconds!r})"]
    S.write_text(path, "\n".join(lines))


class Measure:
    """p95 of a hook and of the baseline over RUNS interleaved pairs (baseline, hook), same payload, same load, and
    the relative verdict."""

    def __init__(self, hook_ms: list[float], base_ms: list[float]) -> None:
        self.hook = p95(hook_ms)
        self.base = p95(base_ms)
        self.delta = self.hook - self.base
        self.load = max(1.0, self.base / LAUNCHER_MS)
        self.budget = RELATIVE_BUDGET_MS * self.load
        self.ok = self.delta <= self.budget

    def __repr__(self) -> str:
        return (f"p95 {self.hook:.1f} ms, baseline {self.base:.1f} ms, delta {self.delta:.1f} ms, "
                f"load {self.load:.2f}, budget {self.budget:.1f} ms")


def measure(run_hook: Callable[[], float], run_base: Callable[[], float], before: Callable[[], None]) -> Measure:
    hook_ms: list[float] = []
    base_ms: list[float] = []
    for _ in range(RUNS):
        base_ms.append(run_base())
        before()
        hook_ms.append(run_hook())
    return Measure(hook_ms, base_ms)


@unittest.skipIf(os.environ.get("EXEC_SKIP_LATENCY") == "1", "EXEC_SKIP_LATENCY=1: latency budget not measured")
@unittest.skipUnless(B.git_bash_available(), "Git Bash is needed")
class HookLatency(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        tasks = [S.build_task(f"T{i:03d}", deps=(f"T{i - 1:03d}",) if i > 1 else ()) for i in range(1, 121)]
        cls.r = B.HookRepo(plan=S.build_plan(tasks=tasks, protected=["tests/acceptance/**"]))
        cls.r.write_schedule([f"T{i:03d}" for i in range(1, 9)])
        cls.root = hooks_copy(cls.r.tmp.root / "skill-copy")
        cls.cases = {
            "stop_gate.py": S.payload("stop.base", background_tasks=[], session_crons=[]),
            "session_start.py": S.payload("session_start.base"),
            "session_end.py": S.payload("session_end.base", reason="logout"),
            "stop_failure.py": S.payload("stop_failure.base", error="rate_limit"),
            "pre_tool_guard.py": S.payload("pre_tool.agent", tool_name="Write",
                                           tool_input={"file_path": "tests/acceptance/a.test.mjs", "content": "x"}),
            "user_prompt.py": S.payload("user_prompt.base"),
        }

    @classmethod
    def tearDownClass(cls) -> None:
        cls.r.cleanup()

    def before(self, hook: str) -> Callable[[], None]:
        def reset() -> None:
            if hook == "stop_gate.py":
                self.r.set_hooks_state()  # every stop measured from the same state (no continuation counting up)
        return reset

    def baseline(self, payload: dict) -> Callable[[], float]:
        return lambda: B.run_hook_from(self.root, self.r, BASELINE, payload).ms

    def measure_skill_hook(self, hook: str) -> Measure:
        payload = self.cases[hook]
        return measure(lambda: self.r.run(hook, payload).ms, self.baseline(payload), self.before(hook))

    def test_p95_per_hook(self) -> None:
        """Relative tier always; absolute tier as well with EXEC_LATENCY=1."""
        results = {hook: self.measure_skill_hook(hook) for hook in self.cases}
        over = {h: repr(m) for h, m in results.items() if not m.ok}
        self.assertEqual(over, {}, f"p95 above a no-op launched the same way exceeds {RELATIVE_BUDGET_MS} ms x load: "
                                   f"{results}")
        if ABSOLUTE:
            slow = {h: round(m.hook, 1) for h, m in results.items() if m.hook > P95_MS}
            self.assertEqual(slow, {}, f"absolute p95 exceeds {P95_MS} ms (EXEC_LATENCY=1): {results}")

    def test_positive_control_slow_hook_fails_the_relative_check(self) -> None:
        """A hook copy with a planted sleep of twice the budget its unplanted twin was held to is caught; the twin
        is not."""
        hook = "user_prompt.py"
        payload = self.cases[hook]
        baseline = self.baseline(payload)
        fast = measure(lambda: B.run_hook_from(self.root, self.r, hook, payload).ms, baseline, self.before(hook))
        self.assertTrue(fast.ok, f"unplanted copy: {fast}")
        seconds = 2 * fast.budget / 1000.0
        slow_root = hooks_copy(self.r.tmp.root / "skill-slow")
        plant_sleep(slow_root, hook, seconds)
        slow = measure(lambda: B.run_hook_from(slow_root, self.r, hook, payload).ms, baseline, self.before(hook))
        self.assertFalse(slow.ok, f"planted sleep of {seconds:.3f} s not caught: {slow}")
        self.assertIn(f"_planted_time.sleep({seconds!r})", (slow_root / "scripts" / "hooks" / hook).read_text(
            encoding="utf-8"))  # the plant is in the double, never in the skill's own hook
        self.assertNotIn("_planted_time", (S.SKILL_DIR / "scripts" / "hooks" / hook).read_text(encoding="utf-8"))

if __name__ == "__main__":
    unittest.main()
