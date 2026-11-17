"""The bridge to /harden's scripts (contract/MODULES.md 4, CLI.md 0.4, HANDOVER.md 1 H4-H6).

/execution never invokes /harden and never writes `.harden/`: it runs /harden's `gates.py` as its proof engine with an
explicit `--config` and `--out-dir`, and /harden's self-setup scripts only as a dry run whose outputs live outside the
repository. Two rules are enforced here, before any subprocess starts:
- a gates.py `--out-dir` never has a sibling file named `active` (gates.py reads `<out-dir>/../active` as a
  forbidden-commands marker) and never lies under a `.harden/` directory (`assert_out_dir_safe`);
- `infer_profile.py finalize` is never given `--install` (`finalize` builds its argv itself and asserts it).
Every subprocess goes through `procutil.run` with an explicit timeout; argv only, never a shell line.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from . import procutil
from .errors import EnvError, InternalError, PolicyRefused
from .jsonio import read_json
from .log import get_logger
from .paths import other_skill, posix

_LOG = get_logger("execlib.hardenbridge")

HARDEN: Path = other_skill("harden")
SCRIPTS = ("gates.py", "prescan.py", "inventory.py", "infer_profile.py", "harden_agents.py")
DEFAULT_TIMEOUT_S = 900.0


def harden_dir() -> Path:
    """The /harden skill directory, resolved at call time (tests point the sibling-skills root elsewhere)."""
    return other_skill("harden")


def script(name: str) -> Path:
    """Absolute path of one of /harden's scripts; EnvError when it is absent (preflight PF-14 names the fix)."""
    path = harden_dir() / "scripts" / name
    if not path.is_file():
        raise EnvError(f"/harden script missing: {posix(path)}", code="E_ENV",
                       hint="install the /harden skill (preflight PF-14)")
    return path


def assert_out_dir_safe(out_dir: Path) -> None:
    """Refuse (PolicyRefused, exit 4) an out-dir whose parent holds a file named `active` or that lies under
    `.harden/` (CLI.md 0.4, HANDOVER.md standing rules)."""
    p = Path(out_dir)
    if ".harden" in p.parts:
        raise PolicyRefused(f"gates out-dir {posix(p)} lies under .harden/ (never written by /execution)",
                            code="E_POLICY")
    marker = p.parent / "active"
    if marker.exists():
        raise PolicyRefused(f"gates out-dir {posix(p)} has a sibling 'active' file: gates.py would read it as a "
                            "forbidden-commands marker", code="E_POLICY",
                            hint="use local/proof-runs/<task>/<run_id>/gates or local/merge-gates/<key>/gates")


def _run(argv: list[str], *, cwd: Path, timeout_s: float) -> procutil.RunResult:
    if any(a == "--install" for a in argv):  # the finalize rule, held for every bridge call
        raise InternalError("hardenbridge never passes --install to a /harden script", code="E_INTERNAL")
    _LOG.debug("harden script", extra={"data": {"argv": [posix(a) for a in argv[1:4]]}})
    return procutil.run(argv, cwd=cwd, timeout_s=timeout_s)


@dataclass(frozen=True)
class GatesOutcome:
    exit_code: int
    result: dict | None
    result_path: Path
    flaky: tuple[str, ...]


def gates(config: Path, repo: Path, out_dir: Path, label: str, *, repeat: int = 1,
          timeout_s: float = 3600) -> GatesOutcome:
    """Run /harden's gates.py with an explicit --config and --out-dir; the result is read from <out-dir>/<label>.json.

    A gates.py that cannot start, times out, or exits 2 (configuration error, forbidden command) is an environment
    error for the caller to classify; exit 0/1 is the gates' verdict."""
    assert_out_dir_safe(out_dir)
    Path(out_dir).mkdir(parents=True, exist_ok=True)
    argv = [procutil.python_exe(), posix(script("gates.py")), "--label", label, "--repeat", str(repeat),
            "--config", posix(config), "--repo", posix(repo), "--out-dir", posix(out_dir), "--json"]
    res = _run(argv, cwd=Path(repo), timeout_s=timeout_s)
    result_path = Path(out_dir) / f"{label}.json"
    if res.timed_out:
        raise EnvError(f"gates.py {label} timed out after {timeout_s:g} s", code="E_ENV")
    result: dict | None = None
    if result_path.is_file():
        try:
            doc = read_json(result_path)
            result = doc if isinstance(doc, dict) else None
        except (OSError, ValueError) as err:
            raise EnvError(f"gates.py result {posix(result_path)} is unreadable: {err}", code="E_ENV") from err
    if result is None and res.stdout.strip():
        try:
            doc = json.loads(res.stdout)
            result = doc if isinstance(doc, dict) else None
        except json.JSONDecodeError:
            result = None
    code = res.exit_code if res.exit_code is not None else 3
    if code == 2 or (code not in (0, 1)) or result is None:
        tail = (res.stderr.strip() or res.stdout.strip())[-600:]
        raise EnvError(f"gates.py {label} could not run its gates (exit {code}): {tail}", code="E_ENV")
    flaky = tuple(sorted(str(n) for n in (result.get("flaky") or [])))
    return GatesOutcome(exit_code=code, result=result, result_path=result_path, flaky=flaky)


def gate_outputs(result: dict | None) -> list[tuple[str, int, bytes, bytes]]:
    """(gate name, run index, stdout bytes, stderr bytes) of every gate run, from the logs gates.py wrote."""
    out: list[tuple[str, int, bytes, bytes]] = []
    for run in (result or {}).get("runs") or []:
        for rec in run.get("results") or []:
            logs = rec.get("log_paths") or {}
            data: dict[str, bytes] = {}
            for kind in ("stdout", "stderr"):
                p = logs.get(kind)
                data[kind] = Path(p).read_bytes() if p and Path(p).is_file() else \
                    str(rec.get(f"{kind}_tail") or "").encode("utf-8")
            out.append((str(rec.get("name")), int(rec.get("run") or 1), data["stdout"], data["stderr"]))
    return out


def prescan(repo: Path, out: Path, *, timeout_s: float = DEFAULT_TIMEOUT_S) -> procutil.RunResult:
    """prescan.py --repo R --out OUT --json (HANDOVER.md H4)."""
    return _run([procutil.python_exe(), posix(script("prescan.py")), "--repo", posix(repo), "--out", posix(out),
                 "--json"], cwd=Path(repo), timeout_s=timeout_s)


def inventory(repo: Path, out: Path, *, timeout_s: float = DEFAULT_TIMEOUT_S) -> procutil.RunResult:
    """inventory.py --repo R --out OUT --quiet (HANDOVER.md H4)."""
    return _run([procutil.python_exe(), posix(script("inventory.py")), "--repo", posix(repo), "--out", posix(out),
                 "--quiet"], cwd=Path(repo), timeout_s=timeout_s)


def infer(repo: Path, inventory_path: Path, out_dir: Path, *, now: str | None = None, base: str = "HEAD",
          timeout_s: float = DEFAULT_TIMEOUT_S) -> procutil.RunResult:
    """infer_profile.py infer --repo R --base HEAD --inventory INV --out-dir OUT [--now UTC] --json."""
    argv = [procutil.python_exe(), posix(script("infer_profile.py")), "infer", "--repo", posix(repo), "--base", base,
            "--inventory", posix(inventory_path), "--out-dir", posix(out_dir)]
    if now:
        argv += ["--now", now]
    return _run(argv + ["--json"], cwd=Path(repo), timeout_s=timeout_s)


def probe(repo: Path, out_dir: Path, *, timeout_s: float = DEFAULT_TIMEOUT_S) -> procutil.RunResult:
    """infer_profile.py probe --repo R --out-dir OUT --json."""
    return _run([procutil.python_exe(), posix(script("infer_profile.py")), "probe", "--repo", posix(repo),
                 "--out-dir", posix(out_dir), "--json"], cwd=Path(repo), timeout_s=timeout_s)


def finalize_argv(repo: Path, out_dir: Path, *, base: str = "HEAD") -> list[str]:
    """The finalize command line; never `--install` (asserted)."""
    argv = [procutil.python_exe(), posix(script("infer_profile.py")), "finalize", "--repo", posix(repo), "--base",
            base, "--out-dir", posix(out_dir), "--json"]
    if "--install" in argv:
        raise InternalError("finalize must never get --install", code="E_INTERNAL")
    return argv


def finalize(repo: Path, out_dir: Path, *, base: str = "HEAD",
             timeout_s: float = DEFAULT_TIMEOUT_S) -> procutil.RunResult:
    """infer_profile.py finalize --repo R --base HEAD --out-dir OUT --json (dry run: never --install)."""
    return _run(finalize_argv(repo, out_dir, base=base), cwd=Path(repo), timeout_s=timeout_s)


def agents_status(*, timeout_s: float = 60) -> procutil.RunResult:
    """harden_agents.py status --json."""
    return _run([procutil.python_exe(), posix(script("harden_agents.py")), "status", "--json"],
                cwd=harden_dir(), timeout_s=timeout_s)


def scripts_present() -> dict[str, bool]:
    """Which of /harden's scripts exist (preflight PF-14)."""
    base = harden_dir() / "scripts"
    return {name: (base / name).is_file() for name in SCRIPTS}


def check_argv(argv: Sequence[str]) -> None:
    """Assert an argv built elsewhere for a /harden script never carries --install."""
    if "--install" in argv:
        raise InternalError("hardenbridge never passes --install to a /harden script", code="E_INTERNAL")
