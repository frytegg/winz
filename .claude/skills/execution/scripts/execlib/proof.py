"""Proof runs and verdict receipts (contract/CLI.md `proof run`, `proof verdict`; SCHEMAS.md 3.3, 4.2, 4.3;
MODULES.md 5; FRONTEND.md 2.6, 2.8).

`proof run` re-runs a task's proof on a clean checkout of a SHA outside the repository, hashes the output and writes
raw evidence (`local/proof-runs/<task>/<run_id>/`): never a verdict. Command proofs run through /harden's gates.py with
a one-gate config in the run directory (`inherit_env: false` plus an allowlist); the other types are evaluated by
exec.py itself (file, url), through `gh` (ci), through an independent chain reader called with argv only (tx), or from
a verified answer file (human-attest). Environment failures (out of memory, ENOSPC, "There is not enough space",
"Filename too long", a checkout or install that could not run, a governor reading below the floors, the 9-minute
budget) are exit 3, never a failed expectation. `--checkout in-place` is merge's in-process pre-push check only (role
integrator); the command line refuses it. Negative controls: pre-implementation (the proof on the base), patch_path (a
git patch or a plant file, on copies), negative_control.command (any proof type, through gates.py like a command
proof, non-zero required), and the built-in forgeries of the ground-truth checkers: tx (the reader is handed a seeded
forged hash) and ci (another commit's run checked as this SHA's: it tests exec.py's CI reader, so a checker task, kind
gate or `params.checker`, must name its own forgery). A tx reading is compared as in `answers ingest`: chain and
network, the bring_back's `verify.expect`, block_time at or after the posting, and the proof's `expect.json`.

`proof verdict` writes the receipt `done` rests on, after checks that refuse (exit 4, nothing written) a pass on a run
whose expectation was not met, a run of another task or SHA, an in-place run or a run by a role other than verifier or
replay, a SHA not on origin/main, a stale proof hash, a missing negative control (only control runs made for the
landed SHA count, or the plan's `recorded` control when its run is on disk and failed as required) or a newest
control of that SHA that passed where it must fail, or an attestation shared with the implementer; a missing guard
attestation is exit 3 (a rerun). The control requirement is the done check's own (P-13 with SCHEMAS.md 4.3 condition
6: required whenever the control is not `not-applicable`, infra and deploy tasks included). The SHA is taken from the
task's landed merge receipt (any wave), so a verdict is accepted while the status still says `running`; the
evidence-backed transitions are applied here. Every file the verdict writes is staged with what it held before: lane
B04's own done check (`status.check_done_evidence`) runs on the written receipt BEFORE any transition, and a refusal
or an error at any step puts every file back and cuts events.jsonl back to its length, so a refused verdict has
written nothing (CLI.md `proof verdict`, contract revision 3).

Proven-public values (README.md 8): a tx proof whose reader confirmed the transaction registers the hash in the state
repo's public-values.jsonl (proven `tx-proof`); a hash that is not proven public (the forged hash of a control, a hash
the reader did not confirm) reaches the run document, and so the tracked copies, only as its sha256.

Lock note: MODULES.md 8 gives `proof` no edge to `locks`; the state lock (events, receipts, status) and the executor's
`disk-heavy` slot are taken through `events.locks` (the module `events` already depends on). See the B06 report.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from argparse import Namespace
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator, Mapping

from . import clock, events, gitutil, hardenbridge, jsonio, plan as plan_mod, procutil, schema, statusio
from .errors import (EnvError, ErrorItem, ExecError, GitError, InternalError, PolicyRefused, TransitionRefused,
                     UsageError, ValidationFailed)
from .jsonio import read_json, read_json_retry, sha256_bytes, sha256_file, write_json_atomic, write_text_atomic
from .log import get_logger, redact
from .model import CommandResult, Ctx, PlanModel, TaskState
from .paths import Layout, posix, rmtree_link_safe, scratch_dir

_LOG = get_logger("execlib.proof")

SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
RUN_ID_RE = re.compile(r"^T[0-9]{3,}-[0-9a-f]{8}-[0-9]{8}T[0-9]{6}Z-[0-9]{1,3}$")
TX_HASH_RE = re.compile(r"^(0x)?[0-9a-fA-F]{64}$")
UTC_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
URL_RE = re.compile(r"^https?://\S+$")
ENV_FAILURE_RE = re.compile(r"(out of memory|ENOSPC|There is not enough space|Filename too long|MemoryError|"
                            r"Cannot allocate memory)", re.IGNORECASE)
ENV_FILE_RE = re.compile(r"(?:^|[\s\"'=/\\:(])\.env(?:\.(?!example\b|sample\b|template\b)[A-Za-z0-9_-]+)?"
                         r"(?=$|[\s\"'/\\;|&)])")
DEFAULT_ALLOWLIST: tuple[str, ...] = ("PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "WINDIR", "TEMP", "TMP",
                                      "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES",
                                      "PROGRAMDATA", "PNPM_HOME")
ROLE_AGENT: Mapping[str, str | None] = {
    "verifier": "execution-verifier", "integrator": "execution-implementer", "implementer": "execution-implementer",
    "test-designer": "execution-test-designer", "reviewer": "execution-reviewer", "orchestrator": None,
    "replay": None,
}
# P-13 with the done check of SCHEMAS.md 4.3 (condition 6), the one source of truth of contract revision 3: a task of
# these kinds needs its negative control whenever the control is not `not-applicable`. It is exactly the rule lane
# B04's status module applies (`status._NC_KINDS`, `status._nc_required`; B04 exposes no public function for it, so
# test_proof pins the two together over every kind and control kind): every agent kind, infra and deploy included.
# Manual and decision tasks complete through answers and resolutions, never through a receipt.
CONTROL_REQUIRED_KINDS = frozenset({"code", "test", "gate", "tx", "infra", "deploy", "watch", "research"})
# The roles whose runs a receipt may cite: the verifier's own clean-checkout re-run, or an orchestrator replay. An
# in-place run (merge's pre-push check, by the integrator) is never evidence (CLI.md proof run, `--checkout`).
VERDICT_RUN_ROLES = frozenset({"verifier", "replay"})
# The efforts an agent call can carry (contract README.md 10, revision 4): `--effort` of `proof verdict` is the
# verifier's own, never `xhigh`.
AGENT_EFFORTS = ("low", "medium", "high")
# The warning code that marks a run document whose run ended in an environment failure (CLI.md proof run: "exit 3,
# never a failed expectation"). Such a run is kept as a record of what happened, but it is never evidence: neither a
# proof run a receipt may cite nor a control that may satisfy (or mask) the negative-control condition.
ENV_FAILURE_CODE = "E_ENV"
DEFAULT_BUDGET_S = 540
ATTEST_MAX_AGE_S = 600
OUTPUT_TAIL_CHARS = 7900


# --- shared context (also used by merge) ----------------------------------------------------------------------------

def validate_doc(doc: Any, name: str, what: str) -> None:
    """schema.check for documents written by this lane and by merge (merge has no direct edge to schema)."""
    schema.check(doc, name, what=what)


def load_profile(layout: Layout) -> dict:
    if not layout.profile.is_file():
        raise UsageError(f"{posix(layout.profile)} is missing", hint="run exec.py ingest first")
    doc = read_json_retry(layout.profile)
    schema.check(doc, "profile", what="profile.json")
    return doc


def load_policy(layout: Layout) -> dict:
    if not layout.policy.is_file():
        raise UsageError(f"{posix(layout.policy)} is missing", hint="run exec.py ingest first")
    doc = read_json_retry(layout.policy)
    schema.check(doc, "policy", what="policy.json")
    return doc


def load_local_state(layout: Layout) -> dict:
    """local/state.json as data (flags.push_frozen, flags.mainnet_open); {} when absent."""
    if not layout.local_state.is_file():
        return {}
    doc = read_json_retry(layout.local_state)
    return doc if isinstance(doc, dict) else {}


def task_raw(plan_raw: dict, task_id: str) -> dict:
    for t in plan_raw.get("tasks") or ():
        if t.get("id") == task_id:
            return t
    raise UsageError(f"unknown task {task_id}", hint="a task id of plan.json")


def project_slug(profile: dict) -> str:
    return str(((profile.get("project") or {}).get("slug")) or "project")


@contextmanager
def hold_lock(layout: Layout, name: str, command: str, timeout_s: float | None = None) -> Iterator[None]:
    """A lock of this state directory (see the module note on the lock edge)."""
    with events.locks.hold(layout, name, command=command, timeout_s=timeout_s):
        yield


def append_event(ctx: Ctx, type_: str, data: dict) -> None:
    with hold_lock(ctx.layout, "state", ctx.command):
        events.append(ctx, type_, data)


# --- proven-public values (README.md 8; CLI.md proof run, tx) -------------------------------------------------------
#
# CLI.md `proof run` (tx) and SCHEMAS.md 5.1 have a tx proof whose reader confirmed the transaction register the hash
# through `integrity.register_public_value`, but MODULES.md 8 gives `proof` no edge to `integrity`, and
# tests/test_import_graph.py (lane B01) enforces that list. Until the contract adds the edge (contract question
# Q-B06-27), the two functions below apply integrity's rule to the same file with the same line: the same kinds and
# shapes, the same refusals (E_POLICY without a chain proof), the same canonical JSON line, False when already listed.
# test_proof pins them to integrity's functions byte for byte. They differ only where proof knows more: the line's
# `at_utc` and `executor` are this command's clock and executor (integrity's signature has neither).

PUBLIC_VALUES_FILE = "public-values.jsonl"
_PUBLIC_KINDS: Mapping[str, re.Pattern[str]] = {
    "evm-tx-hash": re.compile(r"^0x[0-9a-fA-F]{64}$"),
    "tx-hash": re.compile(r"^[0-9a-fA-F]{64}$"),
}
_PUBLIC_PROOFS: tuple[str, ...] = ("chain-reread", "tx-proof")


def _public_values(layout: Layout) -> frozenset[str]:
    """integrity.load_public_values: the values of public-values.jsonl, lower-cased (a line without a value is
    skipped with a warning: that value stays secret-shaped)."""
    values: set[str] = set()
    unreadable: list[int] = []
    for lineno, doc in jsonio.read_jsonl(layout.state / PUBLIC_VALUES_FILE):
        if isinstance(doc, dict) and isinstance(doc.get("value"), str) and doc["value"].strip():
            values.add(doc["value"].strip().lower())
        else:
            unreadable.append(lineno)
    if unreadable:
        _LOG.warning("public-values.jsonl lines without a value were skipped: those values stay secret-shaped",
                     extra={"data": {"lines": unreadable[:20]}})
    return frozenset(values)


def _register_public_value(ctx: Ctx, *, value: str, kind: str, chain: str, network: str, proven: str,
                           source: str) -> bool:
    """integrity.register_public_value (README.md 8), under the state lock this caller holds: one canonical JSON line
    {value, kind, chain, network, proven, source, at_utc, executor}; False when the value is already listed;
    PolicyRefused (E_POLICY) without a chain proof. Messages never carry the value."""
    if proven not in _PUBLIC_PROOFS:
        raise PolicyRefused(f"a value is registered public only after a chain proof ({' or '.join(_PUBLIC_PROOFS)}), "
                            f"not {proven!r}", code="E_POLICY", hint="README.md 8: the format alone never clears a "
                                                                    "value")
    shape = _PUBLIC_KINDS.get(kind)
    if shape is None:
        raise PolicyRefused(f"public-values.jsonl lists transaction hashes only ({', '.join(sorted(_PUBLIC_KINDS))}),"
                            f" not {kind!r}", code="E_POLICY")
    if not isinstance(value, str) or not shape.match(value):
        raise PolicyRefused(f"the value is not a transaction hash of kind {kind}: not registered", code="E_POLICY")
    for name, field in (("chain", chain), ("network", network), ("source", source)):
        if not isinstance(field, str) or not field.strip():
            raise PolicyRefused(f"no {name}: a value is registered only with the chain proof that made it public",
                                code="E_POLICY")
    if not events.locks.is_held("state"):
        raise InternalError("registering a public value requires the state lock (a caller bug)", code="E_INTERNAL")
    if value.lower() in _public_values(ctx.layout):
        return False
    line = {"value": value, "kind": kind, "chain": chain, "network": network, "proven": proven, "source": source,
            "at_utc": clock.format_utc(ctx.now), "executor": ctx.executor if ctx.executor in ("A", "B") else None}
    jsonio.append_jsonl(ctx.layout.state / PUBLIC_VALUES_FILE, line)
    _LOG.info("public value registered", extra={"data": {"kind": kind, "chain": chain, "network": network,
                                                         "proven": proven, "source": source}})
    return True


def tx_hash_kind(value: str) -> str:
    """The public-values.jsonl kind of a transaction hash: `evm-tx-hash` with the `0x` prefix, else `tx-hash`."""
    return "evm-tx-hash" if value[:2].lower() == "0x" else "tx-hash"


def hashed_value(value: str) -> str:
    """How a hash that is not proven public appears in a run document (and so in its tracked copy): its sha256."""
    return "sha256:" + sha256_bytes(value.encode("utf-8"))


# --- the 9-minute budget (CLI.md 0.6) -------------------------------------------------------------------------------

class Budget:
    """Wall-time budget of an agent-invoked command: a step whose last measured duration no longer fits is not
    started (EnvError E_TIME_BUDGET, exit 3: a rerun). Measured durations go to local/timings.json per command and
    task kind."""

    def __init__(self, layout: Layout, profile: dict, command: str, kind: str) -> None:
        machine = profile.get("machine") or {}
        self.limit_s = float(machine.get("agent_command_budget_s") or DEFAULT_BUDGET_S)
        self.layout = layout
        self.command = command
        self.kind = kind
        self.start = time.monotonic()
        self.known: dict[str, float] = {}
        self.measured: dict[str, float] = {}
        try:
            doc = read_json(layout.timings) if layout.timings.is_file() else {}
        except (OSError, ValueError, ExecError):
            doc = {}
        entry = ((doc or {}).get(command) or {}).get(kind) or {}
        self.known = {str(k): float(v) for k, v in entry.items() if isinstance(v, (int, float))}

    def remaining(self) -> float:
        return self.limit_s - (time.monotonic() - self.start)

    def check(self, step: str) -> None:
        last = self.known.get(step)
        left = self.remaining()
        if left <= 0 or (last is not None and last > left):
            raise EnvError(f"{self.command}: step '{step}' needs about {last or 0:.0f} s, {max(left, 0):.0f} s of the "
                           f"{self.limit_s:.0f} s budget remain", code="E_TIME_BUDGET",
                           hint="a rerun, never a failed attempt (CLI.md 0.6)",
                           data={"step": step, "needs_s": last, "remaining_s": round(max(left, 0.0), 3),
                                 "budget_s": self.limit_s})

    @contextmanager
    def step(self, name: str) -> Iterator[None]:
        self.check(name)
        t0 = time.monotonic()
        try:
            yield
        finally:
            self.measured[name] = round(self.measured.get(name, 0.0) + (time.monotonic() - t0), 3)

    def save(self) -> None:
        if not self.measured:
            return
        try:
            doc = read_json(self.layout.timings) if self.layout.timings.is_file() else {}
        except (OSError, ValueError, ExecError):
            doc = {}
        if not isinstance(doc, dict):
            doc = {}
        cmd = doc.setdefault(self.command, {})
        kind = cmd.setdefault(self.kind, {})
        kind.update(self.measured)
        write_json_atomic(self.layout.timings, doc)


# --- governor reading (CLI.md proof run "Resources") ----------------------------------------------------------------

def _readings(profile: dict, repo: Path | None) -> dict:
    """The governor's readings as a dict. EXEC_GOVERNOR_READINGS (a JSON file) replaces the PowerShell reading only
    when EXEC_TEST=1 (tests; the EXEC_NOW pattern of README.md 2)."""
    fake = os.environ.get("EXEC_GOVERNOR_READINGS")
    if fake and os.environ.get("EXEC_TEST") == "1":
        doc = read_json(Path(fake))
        if not isinstance(doc, dict):
            raise EnvError("EXEC_GOVERNOR_READINGS is not a JSON object", code="E_ENV")
        return doc
    try:
        from . import governor  # lane B08
    except ModuleNotFoundError as err:
        if err.name == "execlib.governor":
            raise InternalError("the governor (lane B08) is not available: no resource reading",
                                code="E_NOT_IMPLEMENTED") from err
        raise
    r = governor.read(profile, repo)
    return {k: getattr(r, k, None) for k in ("disk_free_gb", "scratch_disk_free_gb", "ram_free_gb",
                                              "commit_free_gb", "ac_power", "network", "harden_active")}


def check_floors(profile: dict, repo: Path | None) -> dict:
    """Disk and RAM above the profile's floors, else EnvError(E_ENV): a rerun, never a failed attempt."""
    r = _readings(profile, repo)
    machine = profile.get("machine") or {}
    disk_floor = float(machine.get("disk_floor_gb") or 0)
    ram_floor = float(machine.get("ram_floor_gb") or 0)
    disk, ram, scratch_disk = r.get("disk_free_gb"), r.get("ram_free_gb"), r.get("scratch_disk_free_gb")
    if not isinstance(disk, (int, float)) or not isinstance(ram, (int, float)):
        raise EnvError("governor reading failed (disk or RAM unreadable)", code="E_ENV",
                       hint="a rerun; the tick derives PAUSED_RESOURCES")
    problems = []
    if disk < disk_floor:
        problems.append(f"disk {disk:.1f} GB < floor {disk_floor:.1f} GB")
    if isinstance(scratch_disk, (int, float)) and scratch_disk < disk_floor:
        problems.append(f"scratch disk {scratch_disk:.1f} GB < floor {disk_floor:.1f} GB")
    if ram < ram_floor:
        problems.append(f"RAM {ram:.1f} GB < floor {ram_floor:.1f} GB")
    if problems:
        raise EnvError("resources below the floors: " + "; ".join(problems), code="E_ENV",
                       hint="a rerun; the tick derives PAUSED_RESOURCES")
    return r


# --- forbidden commands (exit 4 before anything runs) ---------------------------------------------------------------

def forbidden_reason(text: str, policy: dict, local_state: dict) -> str | None:
    """Why a proof command text is refused: --allow-skip, an env file named, the policy's env file path, a
    deny_commands pattern, or a mainnet broadcast pattern while mainnet is closed. Never echoes the text."""
    if not text:
        return None
    if "--allow-skip" in text:
        return "the command passes --allow-skip (a skipped gate is open, P-12)"
    if ENV_FILE_RE.search(text):
        return "the command names an env file (programs read $EXEC_ENV_FILE)"
    env_file = ((policy.get("secrets") or {}).get("env_file"))
    if env_file and (env_file in text or env_file.replace("/", "\\") in text):
        return "the command names the policy's env file (programs read $EXEC_ENV_FILE)"
    for i, item in enumerate(policy.get("deny_commands") or []):
        try:
            if re.search(item["pattern"], text):
                return f"policy deny_commands[{i}]: {item.get('reason', 'denied')}"
        except re.error as err:
            raise ValidationFailed(f"policy deny_commands[{i}] is not a valid regex: {err}", code="E_SCHEMA") from err
    mainnet = ((policy.get("networks") or {}).get("mainnet") or {})
    closed = mainnet.get("mode") == "read-only" or not ((local_state.get("flags") or {}).get("mainnet_open"))
    if closed:
        for i, pat in enumerate(mainnet.get("broadcast_patterns") or []):
            if re.search(pat, text):
                return f"mainnet broadcast pattern {i} while mainnet writes are closed"
    return None


def proof_texts(task: dict) -> list[str]:
    proof = task.get("proof") or {}
    spec = proof.get("spec") or {}
    out = [str(spec.get("cmd") or ""), str(spec.get("reader_cmd") or "")]
    nc = proof.get("negative_control") or {}
    out.append(str(nc.get("command") or ""))
    return [t for t in out if t]


def assert_allowed(task: dict, policy: dict, local_state: dict) -> None:
    for text in proof_texts(task):
        why = forbidden_reason(text, policy, local_state)
        if why:
            raise PolicyRefused(f"{task['id']}: proof refused: {why}", code="E_POLICY", hint="P-12; CLI.md proof run")


# --- run ids, checkouts ---------------------------------------------------------------------------------------------

def make_run_id(task: str, sha: str, now: datetime, n: int) -> str:
    return f"{task}-{sha[:8]}-{clock.stamp(now)}-{n}"


def _allocate_run(layout: Layout, task: str, sha: str, now: datetime) -> tuple[str, Path]:
    base = layout.local / "proof-runs" / task
    base.mkdir(parents=True, exist_ok=True)
    for n in range(1, 1000):
        run_id = make_run_id(task, sha, now, n)
        try:
            (base / run_id).mkdir()
        except FileExistsError:
            continue
        return run_id, base / run_id
    raise EnvError(f"no free run id for {task} at {clock.stamp(now)}", code="E_ENV")


def clean_checkout(repo: Path, sha: str, dest: Path) -> Path:
    """`git clone --no-local` of the product repo with core.longpaths, refs/exec/* and the repo's origin refs
    fetched, then a detached checkout of `sha` (EnvError when it cannot be made)."""
    src = gitutil.Git(repo, timeout_s=600)
    if src.config_get("remote.origin.url"):
        try:
            src.fetch("origin")
        except GitError as err:
            _LOG.warning("fetch before the clone failed", extra={"data": {"error": err.message}})
    if dest.exists():
        rmtree_link_safe(dest)
    try:
        clone = src.clone_no_local(dest)
        clone.run("fetch", "--quiet", "origin", "+refs/remotes/origin/*:refs/exec-upstream/*", check=False)
        clone.checkout(sha)
    except GitError as err:
        raise EnvError(f"the clean checkout of {sha[:12]} could not be made: {err.message}", code="E_ENV") from err
    return dest


# --- install (gates.json install step) ------------------------------------------------------------------------------

def _default_install(checkout: Path) -> list[dict]:
    if (checkout / "pnpm-lock.yaml").is_file():
        return [{"name": "install", "cmd": ["pnpm", "install", "--frozen-lockfile"], "timeout_s": 1800}]
    if (checkout / "package-lock.json").is_file():
        return [{"name": "install", "cmd": ["npm", "ci"], "timeout_s": 1800}]
    if (checkout / "yarn.lock").is_file():
        berry = (checkout / ".yarnrc.yml").is_file()
        return [{"name": "install", "cmd": ["yarn", "install", "--immutable" if berry else "--frozen-lockfile"],
                 "timeout_s": 1800}]
    if (checkout / "uv.lock").is_file():
        return [{"name": "install", "cmd": ["uv", "sync", "--locked"], "timeout_s": 1800}]
    if (checkout / "Cargo.lock").is_file():
        return [{"name": "install", "cmd": ["cargo", "build", "--locked"], "timeout_s": 1800}]
    return []


def install_config(layout: Layout, checkout: Path) -> dict | None:
    """The gates.py config of the gates.json install step (harden's `install`: a gate object or a list; absent =
    the lockfile default; [] = disabled). None when nothing is to install."""
    top: dict = {}
    if layout.gates_json.is_file():
        doc = read_json(layout.gates_json)
        top = doc if isinstance(doc, dict) else {}
    raw = top.get("install", None) if "install" in top else None
    if raw is None:
        steps = _default_install(checkout)
    elif isinstance(raw, dict):
        steps = [raw]
    elif isinstance(raw, list):
        steps = [s for s in raw if isinstance(s, dict)]
    else:
        raise ValidationFailed("gates.json install must be a gate object or a list", code="E_SCHEMA")
    if not steps:
        return None
    gates = []
    for i, s in enumerate(steps):
        g = dict(s)
        g.setdefault("name", "install" if len(steps) == 1 else f"install-{i + 1}")
        gates.append(g)
    cfg: dict[str, Any] = {"comment": ["exec.py: the gates.json install step"], "gates": gates}
    for key in ("inherit_env", "env_allowlist", "env_policy"):
        if key in top:
            cfg[key] = top[key]
    return cfg


def run_install(layout: Layout, checkout: Path, run_dir: Path, label: str, budget: Budget | None) -> dict:
    cfg = install_config(layout, checkout)
    if cfg is None:
        return {"ran": False, "exit_code": None, "duration_s": None}
    cfg_path = run_dir / "install.config.json"
    write_json_atomic(cfg_path, cfg)
    t0 = time.monotonic()
    ctxm = budget.step("install") if budget else _null()
    with ctxm:
        outcome = hardenbridge.gates(cfg_path, checkout, run_dir / "install-gates", label)
    duration = round(time.monotonic() - t0, 3)
    if outcome.exit_code != 0:
        raise EnvError(f"the install step failed (exit {outcome.exit_code}): the checkout could not be prepared",
                       code="E_ENV", hint="a rerun; check disk and network")
    return {"ran": True, "exit_code": outcome.exit_code, "duration_s": duration}


@contextmanager
def _null() -> Iterator[None]:
    yield


# --- JSON helpers ---------------------------------------------------------------------------------------------------

def json_equal(a: Any, b: Any) -> bool:
    """JSON equality: True != 1, 1 == 1.0, objects by keys and values, arrays by order."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(json_equal(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(json_equal(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


_MISSING = object()


def _unescape(seg: str) -> str:
    return seg.replace("~1", "/").replace("~0", "~")


def pointer_get(doc: Any, pointer: str) -> Any:
    """RFC 6901 lookup; _MISSING when absent."""
    if pointer in ("", None):
        return doc
    cur = doc
    for raw in pointer.split("/")[1:]:
        seg = _unescape(raw)
        if isinstance(cur, dict) and seg in cur:
            cur = cur[seg]
        elif isinstance(cur, list) and seg.isdigit() and int(seg) < len(cur):
            cur = cur[int(seg)]
        else:
            return _MISSING
    return cur


def pointer_select(doc: Any, pointer: str) -> list[tuple[str, Any]]:
    """Every value at `pointer`, where a segment `*` means every item of an array; missing values are _MISSING."""
    items: list[tuple[str, Any]] = [("", doc)]
    if pointer in ("", None):
        return items
    for raw in pointer.split("/")[1:]:
        seg = _unescape(raw)
        nxt: list[tuple[str, Any]] = []
        for where, cur in items:
            if cur is _MISSING:
                nxt.append((f"{where}/{raw}", _MISSING))
            elif seg == "*":
                if isinstance(cur, list):
                    nxt.extend((f"{where}/{i}", v) for i, v in enumerate(cur))
                else:
                    nxt.append((f"{where}/*", _MISSING))
            elif isinstance(cur, dict):
                nxt.append((f"{where}/{raw}", cur.get(seg, _MISSING)))
            elif isinstance(cur, list) and seg.isdigit() and int(seg) < len(cur):
                nxt.append((f"{where}/{raw}", cur[int(seg)]))
            else:
                nxt.append((f"{where}/{raw}", _MISSING))
        items = nxt
    return items


def _inside(child: Path, root: Path) -> bool:
    try:
        child.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def run_json_check(value: Any, check: dict) -> list[str]:
    """Failures (texts) of one json_checks item on the value at the proof's json_pointer."""
    kind = check.get("check")
    failures: list[str] = []
    selected = pointer_select(value, str(check.get("pointer", "")))
    if kind == "min-items":
        for where, v in selected:
            if not isinstance(v, list):
                failures.append(f"min-items: {where or '/'} is not an array")
                continue
            want = check.get("where") or {}
            n = sum(1 for item in v if isinstance(item, dict)
                    and all(k in item and json_equal(item[k], w) for k, w in want.items()))
            if n < int(check.get("value") or 0):
                failures.append(f"min-items: {where or '/'} has {n} matching item(s), {check.get('value')} required")
        return failures
    for where, v in selected:
        label = where or "/"
        if v is _MISSING:
            failures.append(f"{kind}: {label} is missing")
        elif kind == "utc":
            if not (isinstance(v, str) and UTC_RE.match(v)):
                failures.append(f"utc: {label} is not a UTC instant ending in Z")
        elif kind == "enum":
            if not any(json_equal(v, x) for x in (check.get("values") or [])):
                failures.append(f"enum: {label} is outside the allowed values")
        elif kind == "non-empty":
            if not ((isinstance(v, str) and v.strip()) or (isinstance(v, list) and v)):
                failures.append(f"non-empty: {label} is empty")
        elif kind == "url":
            if not (isinstance(v, str) and URL_RE.match(v)):
                failures.append(f"url: {label} is not an http(s) URL")
        elif kind == "equals":
            if not json_equal(v, check.get("value")):
                failures.append(f"equals: {label} differs from the expected value")
        elif kind == "dir-exists":
            base = check.get("base")
            if not (isinstance(v, str) and v and base and "/" not in v.strip("/") and ".." not in v):
                failures.append(f"dir-exists: {label} names no folder")
            else:
                target = Path(base) / v
                if not (target.is_dir() and _inside(target, Path(base))):
                    failures.append(f"dir-exists: {label} names no folder under the base")
        else:
            failures.append(f"unknown check {kind!r}")
    return failures


def check_file(spec: dict, *, base: Path | None = None) -> dict:
    """Evaluate a file proof spec (path, must_match, json_pointer, json_equals, min_bytes, json_checks).

    Returns {met, details, path, bytes}. A relative path is resolved in `base` (the clean checkout) and must not escape
    it; an absolute path is read as is (a private file outside the repo)."""
    details: list[str] = []
    raw_path = str(spec.get("path") or "")
    p = Path(raw_path)
    if not p.is_absolute():
        if base is None:
            return {"met": False, "details": ["a relative file proof path needs a checkout"], "path": raw_path,
                    "bytes": b""}
        p = Path(base) / raw_path
        if not _inside(p, Path(base)):
            return {"met": False, "details": [f"path {raw_path} escapes the checkout: refused"], "path": raw_path,
                    "bytes": b""}
    if not p.is_file():
        return {"met": False, "details": [f"file {raw_path} is missing"], "path": posix(p), "bytes": b""}
    data = p.read_bytes()
    met = True
    if spec.get("min_bytes") is not None and len(data) < int(spec["min_bytes"]):
        met = False
        details.append(f"{len(data)} bytes < min_bytes {spec['min_bytes']}")
    text = data.decode("utf-8", errors="replace")
    if spec.get("must_match"):
        if not re.search(str(spec["must_match"]), text):
            met = False
            details.append("must_match not found")
    if spec.get("json_pointer") is not None or spec.get("json_checks") or "json_equals" in spec:
        try:
            doc = json.loads(text)
        except json.JSONDecodeError as err:
            return {"met": False, "details": details + [f"not JSON: {err.msg}"], "path": posix(p), "bytes": data}
        value = pointer_get(doc, str(spec.get("json_pointer") or ""))
        if value is _MISSING:
            met = False
            details.append(f"json_pointer {spec.get('json_pointer')} is missing")
        else:
            if "json_equals" in spec and not json_equal(value, spec["json_equals"]):
                met = False
                details.append("json_equals: the value differs")
            for check in spec.get("json_checks") or []:
                fails = run_json_check(value, check)
                if fails:
                    met = False
                    details.extend(fails)
    if met:
        details.append(f"file {raw_path}: every check holds")
    return {"met": met, "details": details, "path": posix(p), "bytes": data}


# --- plant files (FRONTEND.md 2.8) ----------------------------------------------------------------------------------

def _resolve_plant_target(root: Path, rel: str) -> Path:
    """The plant's target under `root`: the literal path, a glob's last match, or, when a segment is missing, the
    last existing item at that level (FRONTEND.md 2.8). EnvError when nothing exists."""
    literal = root / rel
    if any(ch in rel for ch in "*?["):
        found = sorted(root.glob(rel))
        if found:
            return found[-1]
    elif literal.exists():
        return literal
    parts = Path(rel).parts
    for i in range(len(parts)):
        if not (root.joinpath(*parts[: i + 1])).exists() and not any(ch in parts[i] for ch in "*?["):
            pattern = "/".join([*parts[:i], "*", *parts[i + 1:]])
            found = sorted(root.glob(pattern))
            if found:
                return found[-1]
            break
    raise EnvError(f"the plant has no target ({rel})", code="E_ENV", hint="never a pass: the control cannot run")


def apply_plant(plant: dict, *, state_copy: Path | None, checkout: Path | None) -> list[str]:
    """Apply a plant file's ops to copies only: target `state` = the copy of <state>/frontend, `checkout` = the
    clean clone. Returns one line per op applied."""
    if plant.get("version") != 1 or not isinstance(plant.get("ops"), list):
        raise ValidationFailed("plant file: version 1 with an ops list is required", code="E_SCHEMA")
    applied: list[str] = []
    for i, op in enumerate(plant["ops"]):
        target = op.get("target")
        root = state_copy if target == "state" else checkout if target == "checkout" else None
        if root is None:
            raise EnvError(f"plant op {i}: target {target!r} has no copy to act on", code="E_ENV")
        kind = op.get("op")
        if kind == "json-set":
            path = _resolve_plant_target(root, str(op["path"]))
            doc = json.loads(path.read_text(encoding="utf-8"))
            _json_set(doc, str(op.get("pointer", "")), op.get("value"))
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
            applied.append(f"json-set {posix(path.relative_to(root))}{op.get('pointer', '')}")
        elif kind == "delete":
            path = _resolve_plant_target(root, str(op["path"]))
            if path.is_dir():
                rmtree_link_safe(path)
            else:
                path.unlink()
            applied.append(f"delete {posix(path.relative_to(root))}")
        elif kind == "regex-replace":
            rx = re.compile(str(op["pattern"]))
            pattern = str(op.get("glob") or op.get("path"))
            files = sorted(p for p in root.glob(pattern) if p.is_file()) if any(c in pattern for c in "*?[") \
                else [_resolve_plant_target(root, pattern)]
            done = False
            for f in files:
                text = f.read_text(encoding="utf-8", errors="replace")
                if rx.search(text):
                    with open(f, "w", encoding="utf-8", newline="\n") as fh:
                        fh.write(rx.sub(str(op.get("replacement", "")), text, count=1))
                    applied.append(f"regex-replace {posix(f.relative_to(root))}")
                    done = True
                    break
            if not done:
                raise EnvError(f"the plant has no target (op {i}: pattern not found under {pattern})", code="E_ENV")
        else:
            raise ValidationFailed(f"plant op {i}: unknown op {kind!r}", code="E_SCHEMA")
    return applied


def _json_set(doc: Any, pointer: str, value: Any) -> None:
    segs = [_unescape(s) for s in pointer.split("/")[1:]]
    if not segs:
        raise ValidationFailed("json-set needs a non-empty pointer", code="E_SCHEMA")
    cur = doc
    for seg in segs[:-1]:
        cur = cur[int(seg)] if isinstance(cur, list) else cur[seg]
    last = segs[-1]
    if isinstance(cur, list):
        cur[int(last)] = value
    else:
        cur[last] = value


# --- per-type runners -----------------------------------------------------------------------------------------------

class Outcome:
    """What a type runner observed."""

    def __init__(self, *, command: str | None, exit_code: int | None, timed_out: bool, output: bytes, met: bool,
                 details: list[str], gates_result_path: Path | None = None, env_failure: str | None = None) -> None:
        self.command = command
        self.exit_code = exit_code
        self.timed_out = timed_out
        self.output = output
        self.met = met
        self.details = details
        self.gates_result_path = gates_result_path
        self.env_failure = env_failure


def _evaluate_command(expect: dict, exit_code: int | None, timed_out: bool, stdout: bytes) -> tuple[bool, list[str]]:
    details: list[str] = []
    met = True
    if timed_out:
        met = False
        details.append("timed out: the process tree was killed")
    want = expect.get("exit_code")
    if want is not None and exit_code != want:
        met = False
        details.append(f"exit code {exit_code}, expected {want}")
    text = stdout.decode("utf-8", errors="replace")
    if expect.get("stdout_regex"):
        if not re.search(str(expect["stdout_regex"]), text):
            met = False
            details.append("stdout_regex not found in stdout")
    if expect.get("json"):
        try:
            doc = json.loads(text)
        except json.JSONDecodeError:
            doc = _MISSING
            met = False
            details.append("stdout is not JSON")
        if doc is not _MISSING:
            for item in expect["json"]:
                got = pointer_get(doc, str(item["pointer"]))
                if got is _MISSING or not json_equal(got, item.get("equals")):
                    met = False
                    details.append(f"json {item['pointer']} differs from the expected value")
    if met:
        details.append(f"exit {exit_code}: expectation met")
    return met, details


def _run_command(ctx: Ctx, task: dict, policy: dict, checkout: Path, run_dir: Path, run_id: str, cmd: str,
                 budget: Budget | None, expect: dict | None = None) -> Outcome:
    """`cmd` through gates.py (one gate, `inherit_env: false` plus the allowlist). `expect` defaults to the proof's
    own; a forgery control of a non-command proof passes {exit_code: 0} (the control must make it non-zero)."""
    proof = task["proof"]
    spec = proof["spec"] if proof.get("type") == "command" else {}
    timeout = int(spec.get("timeout_s") or max(10, int(float(proof.get("max_runtime_min") or 5) * 60)))
    allow = list(spec.get("env_allowlist") or DEFAULT_ALLOWLIST)
    env: dict[str, str] = {"EXEC_PROOF_OUT": posix(run_dir / "frontend-out")}
    env_file = (policy.get("secrets") or {}).get("env_file")
    needs_env_file = task.get("kind") == "tx" or any(str(r).startswith("wallet:") for r in task.get("resources") or [])
    if needs_env_file and env_file:
        env["EXEC_ENV_FILE"] = env_file
    for name in env:
        if name not in allow:
            allow.append(name)
    gate: dict[str, Any] = {"name": "proof", "cmd": cmd, "cwd": spec.get("cwd") or ".", "timeout_s": timeout,
                            "env": env, "inherit_env": False, "env_allowlist": allow}
    if spec.get("shell", "bash") == "bash":
        gate["shell"] = "bash"
    config = {"comment": [f"exec.py proof run {run_id}: one gate, the task's proof"], "env_policy": "allowlist",
              "inherit_env": False, "env_allowlist": allow, "gates": [gate]}
    cfg_path = run_dir / "config.json"
    write_json_atomic(cfg_path, config)
    label = f"proof-{run_id}"
    ctxm = budget.step("proof") if budget else _null()
    with ctxm:
        outcome = hardenbridge.gates(cfg_path, checkout, run_dir / "gates", label, timeout_s=timeout + 300)
    runs = hardenbridge.gate_outputs(outcome.result)
    rec = ((outcome.result or {}).get("runs") or [{}])[0].get("results", [{}])[0]
    stdout, stderr = (runs[0][2], runs[0][3]) if runs else (b"", b"")
    exit_code = rec.get("exit_code")
    timed_out = bool(rec.get("timed_out"))
    if rec.get("error") and not timed_out and exit_code is None:
        raise EnvError(f"the proof command could not start: {rec.get('error')}", code="E_ENV")
    output = stdout + stderr
    met, details = _evaluate_command(expect if expect is not None else (proof.get("expect") or {}), exit_code,
                                     timed_out, stdout)
    env_failure = None
    if not met and ENV_FAILURE_RE.search(output.decode("utf-8", errors="replace")):
        env_failure = "the output matches an environment failure pattern (memory, disk space, path length)"
    return Outcome(command=cmd, exit_code=exit_code, timed_out=timed_out, output=output, met=met, details=details,
                   gates_result_path=outcome.result_path, env_failure=env_failure)


def _run_file(task: dict, checkout: Path | None, spec_override: dict | None = None) -> Outcome:
    spec = spec_override or task["proof"]["spec"]
    res = check_file(spec, base=checkout)
    return Outcome(command=None, exit_code=None, timed_out=False, output=res["bytes"], met=res["met"],
                   details=res["details"])


class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        old = urllib.parse.urlsplit(req.full_url)
        new = urllib.parse.urlsplit(urllib.parse.urljoin(req.full_url, newurl))
        if (old.scheme, old.netloc) != (new.scheme, new.netloc):
            raise urllib.error.HTTPError(req.full_url, code, f"redirect to another host refused ({new.netloc})",
                                         headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _run_url(task: dict) -> Outcome:
    spec = task["proof"]["spec"]
    if spec.get("render"):
        raise EnvError("url proof with render: true needs the browser command, which the profile does not declare",
                       code="E_ENV", hint="contract question Q-B06 (render delegation)")
    url = str(spec["url"])
    opener = urllib.request.build_opener(_SameHostRedirect())
    details: list[str] = []
    status: int | None = None
    body = b""
    try:
        with opener.open(urllib.request.Request(url, method="GET"), timeout=30) as resp:
            status = int(resp.status)
            body = resp.read()
    except urllib.error.HTTPError as err:
        status = int(err.code)
        details.append(str(err.reason))
        try:
            body = err.read() or b""
        except (OSError, AttributeError):
            body = b""
    except (urllib.error.URLError, OSError) as err:
        return Outcome(command=f"GET {url}", exit_code=None, timed_out=False, output=b"", met=False,
                       details=[f"fetch failed: {err}"])
    met = status == int(spec["expect_status"])
    if not met:
        details.append(f"status {status}, expected {spec['expect_status']}")
    if spec.get("must_contain") and str(spec["must_contain"]).encode("utf-8") not in body:
        met = False
        details.append("must_contain not found in the body")
    if met:
        details.append(f"status {status}: expectation met")
    return Outcome(command=f"GET {url}", exit_code=status, timed_out=False, output=body, met=met, details=details)


def _gh(repo: Path, argv: list[str]) -> procutil.RunResult:
    if procutil.which("gh") is None:
        raise EnvError("gh is not installed or not on PATH", code="E_ENV")
    res = procutil.run(["gh", *argv], cwd=repo, timeout_s=60)
    if res.timed_out:
        raise EnvError(f"gh {argv[0]} timed out", code="E_ENV")
    return res


CI_LIST_FIELDS = "conclusion,status,databaseId,headSha"


def _ci_list(repo: Path, workflow: str, commit: str | None, text: list[str]) -> list[dict] | None:
    """`gh run list [--commit C] --workflow W`; the runs, or None when gh failed or printed no JSON array."""
    argv = ["run", "list", *(["--commit", commit] if commit else []), "--workflow", workflow, "--json",
            CI_LIST_FIELDS, "--limit", "20" if commit else "50"]
    res = _gh(repo, argv)
    text += [f"$ gh run list{' --commit ' + commit if commit else ''} --workflow {workflow}", res.stdout]
    if res.exit_code != 0:
        return None
    try:
        runs = json.loads(res.stdout or "[]")
    except json.JSONDecodeError:
        return None
    return [r for r in runs if isinstance(r, dict)] if isinstance(runs, list) else None


def _run_ci(task: dict, sha: str, repo: Path) -> Outcome:
    spec = task["proof"]["spec"]
    workflow = str(spec["workflow"])
    text: list[str] = []
    runs = _ci_list(repo, workflow, sha, text)
    command = f"gh run list --commit {sha} --workflow {workflow}"
    if runs is None:
        # gh could not answer (rate limit, network, auth): the check did not run, so it is no failed expectation.
        return Outcome(command=command, exit_code=None, timed_out=False, output="\n".join(text).encode("utf-8"),
                       met=False, details=["gh run list failed or printed no JSON array"],
                       env_failure="gh run list failed (rate limit, network or auth): the CI check could not run")
    if not runs:
        return Outcome(command=command, exit_code=0, timed_out=False, output="\n".join(text).encode("utf-8"),
                       met=False, details=[f"no run of {workflow} for {sha[:12]}"])
    return _ci_evaluate(repo, spec, sha, runs[0].get("databaseId"), text, command)


def _ci_evaluate(repo: Path, spec: dict, sha: str, run_id: Any, text: list[str], command: str) -> Outcome:
    """The checks of a ci proof on one run: its head SHA is `sha`, completed, success, the workflow file, the job."""
    workflow = str(spec["workflow"])
    view = _gh(repo, ["run", "view", str(run_id), "--json", "conclusion,status,headSha,jobs"])
    path = _gh(repo, ["api", f"repos/{{owner}}/{{repo}}/actions/runs/{run_id}", "--jq", ".path"])
    text += [f"$ gh run view {run_id}", view.stdout, f"$ gh api .../actions/runs/{run_id} --jq .path", path.stdout]
    failed = [f"gh {name} exited {res.exit_code}" for name, res in (("run view", view), ("api", path))
              if res.exit_code != 0]
    if failed:
        # The checks never ran. Folding this into `met = False` would make a forgery control read "the forged run
        # was rejected" without any check (F12): an environment failure instead, for the proof and its control alike.
        text += [res.stderr for res in (view, path) if res.exit_code != 0 and res.stderr]
        return Outcome(command=command, exit_code=None, timed_out=False, output="\n".join(text).encode("utf-8"),
                       met=False, details=[f"{'; '.join(failed)}: the checks of run {run_id} did not run"],
                       env_failure=f"{'; '.join(failed)} (rate limit, network or auth): the CI check could not run")
    try:
        doc = json.loads(view.stdout or "")
    except json.JSONDecodeError:
        doc = None
    wf_path = (path.stdout or "").strip()
    unanswered: list[str] = []
    if not isinstance(doc, dict) or any(k not in doc for k in ("headSha", "status", "conclusion")):
        unanswered.append(f"gh run view {run_id} exited 0 without the run's JSON object (headSha, status, "
                          "conclusion)")
    if not wf_path:
        unanswered.append(f"gh api .../actions/runs/{run_id} --jq .path exited 0 without the workflow path")
    if unanswered or not isinstance(doc, dict):
        # F15: an answer that is no answer is the same as a failed call (F12): no comparison ran, so neither a
        # forgery control "rejected" nor a proof "failed" anything; an environment failure, a rerun.
        return Outcome(command=command, exit_code=None, timed_out=False, output="\n".join(text).encode("utf-8"),
                       met=False, details=[f"{'; '.join(unanswered)}: the checks of run {run_id} did not run"],
                       env_failure=f"{'; '.join(unanswered)}: the CI check could not run")
    details: list[str] = []
    met = True
    if doc.get("headSha") != sha:
        met = False
        details.append("the run's head SHA is not the proof's SHA")
    if doc.get("status") != "completed":
        met = False
        details.append(f"run status {doc.get('status')!r}, completed required")
    if doc.get("conclusion") != "success":
        met = False
        details.append(f"run conclusion {doc.get('conclusion')!r}, success required")
    if not (wf_path == workflow or wf_path.endswith("/" + workflow)):
        met = False
        details.append("the run belongs to another workflow file")
    if spec.get("job"):
        jobs = [j for j in doc.get("jobs") or [] if j.get("name") == spec["job"]]
        if not jobs or any(j.get("conclusion") != "success" for j in jobs):
            met = False
            details.append(f"job {spec['job']!r} did not succeed")
    if met:
        details.append(f"run {run_id} of {workflow} succeeded for {sha[:12]}")
    return Outcome(command=command, exit_code=0 if met else 1, timed_out=False,
                   output="\n".join(text).encode("utf-8"), met=met, details=details)


def _seeded_sha(task_id: str, sha: str) -> str:
    """A 40-hex commit id derived from (task, sha), never equal to `sha`: the forged head of a ci forgery."""
    forged = sha256_bytes(f"execution-forgery:ci:{task_id}:{sha}".encode("utf-8"))[:40]
    return forged if forged != sha else sha256_bytes(forged.encode("utf-8"))[:40]


def _run_ci_forgery(ctx: Ctx, task: dict, sha: str, repo: Path) -> Outcome:
    """The built-in forgery of a ci proof: the checks run against a run of another commit (the merge receipt's
    `origin_before` first, else any other commit's run of the workflow) as if it were this SHA's; when only this SHA
    has a run, that run is checked as the proof of another commit (`origin_before`, else a seeded id). Either way the
    ci checker must reject it. No run at all: the control cannot run (EnvError, a rerun once CI has run)."""
    spec = task["proof"]["spec"]
    workflow = str(spec["workflow"])
    from . import results  # lane B04
    receipt = results.landed_receipt(ctx.layout, task["id"])
    origin_before = None
    if receipt and receipt.get("landed_sha") == sha and SHA40_RE.match(str(receipt.get("origin_before") or "")):
        origin_before = str(receipt["origin_before"])
    text: list[str] = []

    def listed_or_env(commit: str | None) -> list[dict]:
        runs = _ci_list(repo, workflow, commit, text)
        if runs is None:
            # A gh failure is never "no run": the control would then be decided by which listing happened to fail.
            raise EnvError(f"the ci forgery could not list the workflow's runs{' of ' + commit[:12] if commit else ''}"
                           " (gh failed)", code="E_ENV", hint="a rerun; never a met control without a forged run "
                                                              "checked")
        return runs

    if origin_before and origin_before != sha:
        for r in listed_or_env(origin_before):
            if r.get("databaseId") is not None and r.get("headSha") not in (None, sha):
                return _ci_evaluate(repo, spec, sha, r["databaseId"], text,
                                    f"forgery: run {r['databaseId']} of {str(r['headSha'])[:12]} (origin_before) "
                                    f"checked as the proof of {sha[:12]}")
    for r in listed_or_env(None):
        if r.get("databaseId") is not None and r.get("headSha") not in (None, sha):
            return _ci_evaluate(repo, spec, sha, r["databaseId"], text,
                                f"forgery: run {r['databaseId']} of {str(r['headSha'])[:12]} checked as the proof of "
                                f"{sha[:12]}")
    own = [r for r in listed_or_env(sha) if r.get("databaseId") is not None]
    if own:
        forged = origin_before if origin_before and origin_before != sha else _seeded_sha(task["id"], sha)
        return _ci_evaluate(repo, spec, forged, own[0]["databaseId"], text,
                            f"forgery: run {own[0]['databaseId']} of {sha[:12]} checked as the proof of {forged[:12]}")
    raise EnvError(f"the ci forgery has no run of {workflow} to forge from", code="E_ENV",
                   hint="a rerun once the workflow has run")


def read_answer(layout: Layout, key: str) -> tuple[dict, str] | None:
    """(header, body) of answers/<key>.md: a fenced ```json block, then the human text. None when absent."""
    path = layout.answer(key)
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    m = re.match(r"\s*```json\s*\n(.*?)\n```\s*\n?(.*)\Z", text, re.S)
    if not m:
        raise ValidationFailed(f"{posix(path)} has no fenced json header", code="E_SCHEMA")
    header = json.loads(m.group(1))
    schema.check(header, "answer", what=f"answers/{key}.md header")
    return header, m.group(2)


def _recorded_tx_hash(ctx: Ctx, task: dict, checkout: Path | None) -> tuple[str | None, list[str]]:
    """(the hash `hash_from` records, why not): only the answer file or the checkout file, never an agent's claim.
    An answer's hash is the verbatim `value` of its tracked header: `answers ingest` registers a chain-verified hash
    in public-values.jsonl and stores it there (README.md 8); an unproven secret-shaped value is stored as null, and
    the machine-local raw copy is never read."""
    source = task["proof"]["spec"]["hash_from"]
    value: Any = None
    if "answer_key" in source:
        ans = read_answer(ctx.layout, source["answer_key"])
        if ans is None:
            return None, [f"answer {source['answer_key']} is missing"]
        value = ans[0].get("value")
        if value is None:
            return None, [f"answer {source['answer_key']} holds no value: an answer whose hash the chain did not "
                          "prove is stored with value null (CLI.md answers ingest)"]
    else:
        if checkout is None:
            raise InternalError("a tx proof reading a checkout file needs a checkout", code="E_INTERNAL")
        res = check_file({"path": source["file"], "json_pointer": source.get("json_pointer", "")}, base=checkout)
        if not res["met"]:
            return None, list(res["details"])
        try:
            doc = json.loads(res["bytes"].decode("utf-8"))
        except json.JSONDecodeError:
            return None, [f"{source['file']} is not JSON"]
        value = pointer_get(doc, str(source.get("json_pointer") or ""))
    if not isinstance(value, str) or not TX_HASH_RE.match(value):
        return None, ["the recorded value is not a transaction hash"]
    return value, []


def forged_tx_hash(task_id: str, sha: str, recorded: str | None, chain: str) -> str:
    """The seeded forged hash of a tx forgery control: 64 hex derived from (task, sha), never the recorded hash, with
    the recorded hash's `0x` style (without a recorded hash: `0x` for chain evm)."""
    digest = sha256_bytes(f"execution-forgery:tx:{task_id}:{sha}".encode("utf-8"))
    bare = (recorded or "")[2:] if (recorded or "").lower().startswith("0x") else (recorded or "")
    if digest == bare.lower():
        digest = sha256_bytes(digest.encode("utf-8"))
    prefixed = recorded.lower().startswith("0x") if recorded else chain == "evm"
    return ("0x" if prefixed else "") + digest


def parse_block_time(value: Any) -> datetime | None:
    """A reader's `block_time`: epoch seconds (number or numeric string) or a strict UTC instant; None otherwise.
    (The same reading as `answers ingest`; proof never imports answers, MODULES.md 8.)"""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        try:
            return clock.from_epoch(value)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if re.match(r"^[0-9]+(\.[0-9]+)?$", text):
            try:
                return clock.from_epoch(float(text))
            except (OverflowError, OSError, ValueError):
                return None
        try:
            return clock.parse_utc(text)
        except ExecError:
            return None
    return None


def _tx_expectations(ctx: Ctx, task: dict) -> tuple[dict, str | None]:
    """(the bring_back `verify.expect` of the answer key the hash comes from, the task's `posted.at_utc`): the
    expected values `answers ingest` compares a chain re-read with (CLI.md `proof run`, tx). Empty / None when the
    plan or the status holds none (a hash recorded in a checkout file has no bring_back entry)."""
    source = task["proof"]["spec"].get("hash_from") or {}
    expect: dict = {}
    key = source.get("answer_key")
    if key:
        for bb in (task.get("manual") or {}).get("bring_back") or ():
            if isinstance(bb, dict) and bb.get("key") == key:
                expect = dict((bb.get("verify") or {}).get("expect") or {})
                break
    posted_at: str | None = None
    executor = task.get("executor") or ctx.executor
    if executor in ("A", "B"):
        try:
            entry = statusio.load(ctx.layout, executor).get("tasks", {}).get(task["id"]) or {}
        except (OSError, ValueError, ExecError) as err:
            _LOG.warning("could not read the status for the tx posting time", extra={"data": {"error": str(err)}})
            entry = {}
        posted = entry.get("posted") if isinstance(entry, dict) else None
        if isinstance(posted, dict) and isinstance(posted.get("at_utc"), str):
            posted_at = posted["at_utc"]
    return expect, posted_at


def compare_tx_reading(doc: dict, spec: dict, expect: Mapping[str, Any], posted_at: str | None,
                       proof_expect: Mapping[str, Any]) -> list[str]:
    """The problems of a reader's JSON `{chain, network, from, to, value, block_time}`, compared as in `answers
    ingest`: chain and network equal the proof spec; from, to and value equal `verify.expect` when given; block_time
    readable and at or after the task's posting when known; plus the proof's own `expect.json` pointers. A real but
    foreign, older or other-network transaction fails."""
    problems: list[str] = []
    for field in ("chain", "network"):
        want = spec.get(field) if spec.get(field) is not None else expect.get(field)
        if doc.get(field) != want:
            problems.append(f"reader {field} is {doc.get(field)!r}, the proof spec says {want!r}")
    for field in ("from", "to", "value"):
        want = expect.get(field)
        if want is not None and str(doc.get(field)) != str(want):
            problems.append(f"reader {field} differs from verify.expect.{field}")
    block = parse_block_time(doc.get("block_time"))
    if block is None:
        problems.append("the reader gave no readable block_time")
    elif posted_at:
        try:
            floor = clock.parse_utc(posted_at)
        except ExecError:
            floor = None
            problems.append(f"the task's posted time {posted_at!r} is not a UTC instant")
        if floor is not None and block < floor:
            problems.append("block_time is before the task was posted (an older transaction)")
    for item in proof_expect.get("json") or ():
        got = pointer_get(doc, str(item.get("pointer") or ""))
        if got is _MISSING or not json_equal(got, item.get("equals")):
            problems.append(f"reader json {item.get('pointer')} differs from the expected value")
    return problems


READER_TIMEOUT_S = 120


def _reader(task: dict, policy: dict, value: str, cwd: Path) -> tuple[procutil.RunResult, list[str]]:
    """The task's chain reader on one hash (CLI.md proof run, tx): argv only, the hash one argv element (shell none),
    the allowlisted environment plus EXEC_ENV_FILE. EnvError when the reader cannot start."""
    spec = task["proof"]["spec"]
    argv = [part.replace("{hash}", value) for part in shlex.split(str(spec["reader_cmd"]), posix=True)]
    env = {k: v for k, v in os.environ.items() if k.upper() in {n.upper() for n in DEFAULT_ALLOWLIST}}
    env_file = (policy.get("secrets") or {}).get("env_file")
    if env_file:
        env["EXEC_ENV_FILE"] = env_file
    return procutil.run(argv, cwd=cwd, timeout_s=READER_TIMEOUT_S, env=env), argv


def chain_reread(task: dict, policy: dict, value: str, cwd: Path) -> tuple[bool, str]:
    """CLI.md `merge`, "Secret-shaped values in the added lines" (Q-B10-7): does the task's own reader, run exactly as
    `proof run` runs it, confirm `value` on chain? Confirmed = exit 0 and one JSON object whose chain and network
    equal the proof spec's. Returns (confirmed, detail); the detail never carries the value. A task without a tx
    reader, a reader that cannot start, times out or answers otherwise is (False, why): the value stays a hit."""
    proof_doc = task.get("proof") or {}
    spec = proof_doc.get("spec") or {}
    if proof_doc.get("type") != "tx" or not spec.get("reader_cmd"):
        return False, "the task's proof has no chain reader (proof type tx, reader_cmd)"
    chain, network = spec.get("chain"), spec.get("network")
    if not (isinstance(chain, str) and chain and isinstance(network, str) and network):
        return False, "the task's proof spec names no chain and network"
    try:
        res, _argv = _reader(task, policy, value, cwd)
    except EnvError as err:
        return False, f"the reader could not run ({err.message})"
    if res.timed_out or res.exit_code != 0:
        return False, f"reader exit {res.exit_code}{' (timeout)' if res.timed_out else ''}"
    try:
        doc = json.loads(res.stdout)
    except json.JSONDecodeError:
        doc = None
    if not isinstance(doc, dict):
        return False, "the reader did not print one JSON object"
    problems = [f"reader {f} is {doc.get(f)!r}, the proof spec says {spec.get(f)!r}" for f in ("chain", "network")
                if doc.get(f) != spec.get(f)]
    if problems:
        return False, "; ".join(problems)
    return True, f"confirmed on {chain}/{network}"


def _run_tx(ctx: Ctx, task: dict, policy: dict, checkout: Path | None, *, forge_for: str | None = None,
            run_id: str | None = None) -> Outcome:
    """Re-read the recorded transaction with the reader (argv only). `forge_for` (the run's SHA): the built-in
    forgery control, the reader is handed a seeded forged hash instead and must not confirm it.

    README.md 8: when the reader confirms the recorded hash (the expectation met), the chain has proved it public and
    it is registered in public-values.jsonl (proven `tx-proof`) before any document names it. The run document then
    shows it verbatim; a hash that is not proven public (the forged one, never registered, or one the reader did not
    confirm and no earlier proof listed) appears only as its sha256."""
    spec = task["proof"]["spec"]
    value, why = _recorded_tx_hash(ctx, task, checkout)
    forged = forge_for is not None
    if forge_for is not None:
        value = forged_tx_hash(task["id"], forge_for, value, str(spec.get("chain") or ""))
    elif value is None:
        return Outcome(command=None, exit_code=None, timed_out=False, output=b"", met=False, details=why)
    res, argv = _reader(task, policy, value, checkout or ctx.layout.repo or Path.cwd())
    out = (res.stdout or "").encode("utf-8") + (res.stderr or "").encode("utf-8")
    details: list[str] = []
    met = res.exit_code == 0 and not res.timed_out
    if not met:
        details.append(f"reader exit {res.exit_code}")
    else:
        try:
            doc = json.loads(res.stdout)
        except json.JSONDecodeError:
            doc = None
        if not isinstance(doc, dict):
            met = False
            details.append("the reader did not print one JSON object")
        else:
            expect, posted_at = _tx_expectations(ctx, task)
            problems = compare_tx_reading(doc, spec, expect, posted_at, task["proof"].get("expect") or {})
            if problems:
                met = False
                details.extend(problems)
    if met:
        details.append("the transaction was re-read on chain and matches")
    public = False
    if not forged:
        chain, network = spec.get("chain"), spec.get("network")
        if met and isinstance(chain, str) and chain and isinstance(network, str) and network:
            source = (f"local/proof-runs/{task['id']}/{run_id}/run.json" if run_id
                      else f"proof run of {task['id']}")
            with hold_lock(ctx.layout, "state", ctx.command):
                _register_public_value(ctx, value=value, kind=tx_hash_kind(value), chain=chain, network=network,
                                       proven="tx-proof", source=source)
            public = True
            details.append("the confirmed hash is listed in public-values.jsonl (proven tx-proof, README.md 8)")
        else:
            public = value.lower() in _public_values(ctx.layout)
    shown = value if public else hashed_value(value)
    if not public and not forged:
        details.append("the hash is not proven public: this document names it by its sha256 (README.md 8)")
    if forged:
        details.insert(0, f"forgery: the reader was handed the seeded forged hash {shown} (never registered)")
    command = " ".join(shlex.quote(a.replace(value, shown)) for a in argv)
    return Outcome(command=command, exit_code=res.exit_code, timed_out=res.timed_out, output=out, met=met,
                   details=details)


def _run_attest(ctx: Ctx, task: dict) -> Outcome:
    spec = task["proof"]["spec"]
    key = str(spec["answer_key"])
    ans = read_answer(ctx.layout, key)
    if ans is None:
        return Outcome(command=None, exit_code=None, timed_out=False, output=b"", met=False,
                       details=[f"answer {key} is missing"])
    header, _body = ans
    details: list[str] = []
    met = True
    if header.get("key") != key or header.get("task") != task["id"]:
        met = False
        details.append("the answer belongs to another task or key")
    if not (header.get("verification") or {}).get("ok"):
        met = False
        details.append("the answer is not verified")
    if met:
        details.append(f"answer {key} verified")
    raw = ctx.layout.answer(key).read_bytes()
    return Outcome(command=None, exit_code=None, timed_out=False, output=raw, met=met, details=details)


# --- proof run ------------------------------------------------------------------------------------------------------

def _control_mode(task: dict, control_kind: str | None) -> str | None:
    """How a negative control runs: `base` (pre-implementation: the proof on the base), `patch` (patch_path: a git
    patch or a FRONTEND.md 2.8 plant file), `command` (negative_control.command, for every proof type: "the proof
    against a forged artifact", plan.schema.json), `forge-tx` / `forge-ci` (the built-in forgeries of the checkers
    that read ground truth, SCHEMAS.md 3.3). UsageError when the control names nothing runnable."""
    if control_kind is None:
        return None
    if control_kind == "pre-implementation":
        return "base"
    nc = task["proof"].get("negative_control") or {}
    ptype = task["proof"]["type"]
    if nc.get("patch_path"):
        return "patch"
    if control_kind == "planted-defect":
        raise UsageError(f"{task['id']}: the planted-defect control has no patch_path")
    if nc.get("command"):
        return "command"
    if ptype == "tx":
        return "forge-tx"
    if ptype == "ci":
        if is_checker_task(task):
            # The built-in ci forgery hands exec.py's own CI reader a run of another commit: it proves the reader
            # checks the head SHA, never that the task's deliverable (the checker) rejects a bad commit.
            raise UsageError(f"{task['id']}: a checker task's ci proof needs a forgery that exercises the "
                             "deliverable: name negative_control.command or patch_path (the built-in ci forgery "
                             "only tests exec.py's CI reader)")
        return "forge-ci"
    raise UsageError(f"{task['id']}: the forgery control of a {ptype} proof names neither negative_control.command "
                     "nor patch_path (built-in forgeries exist for tx and ci proofs only)")


def _checkout_kind(task: dict, checkout: str, control_mode: str | None = None) -> str:
    if checkout == "in-place":
        return "in-place"
    if control_mode == "command":
        return "clone"  # the control's command runs from a clean checkout, like a command proof
    ptype = task["proof"]["type"]
    spec = task["proof"]["spec"]
    if ptype == "command":
        return "clone"
    if ptype == "file":
        return "none" if Path(str(spec.get("path", ""))).is_absolute() else "clone"
    if ptype == "tx":
        return "clone" if "file" in (spec.get("hash_from") or {}) else "none"
    return "none"


def _control_target(ctx: Ctx, task: dict, sha: str, git: gitutil.Git) -> tuple[str, str]:
    """(kind, sha to check out) of the task's negative control."""
    nc = task["proof"].get("negative_control") or {}
    kind = nc.get("kind")
    if kind == "not-applicable" or kind is None:
        raise UsageError(f"{task['id']} has no negative control to run ({kind})")
    if kind != "pre-implementation":
        return kind, sha
    from . import results  # lane B04
    receipt = results.landed_receipt(ctx.layout, task["id"])
    if receipt and receipt.get("landed_sha") == sha and receipt.get("origin_before"):
        return kind, str(receipt["origin_before"])
    refs = git.run("for-each-ref", "--format=%(objectname) %(refname)", f"refs/exec/{task['id']}/", check=False)
    for line in (refs.stdout or "").split("\n"):
        obj, _sp, ref = line.partition(" ")
        if obj == sha and "/td-" in ref:
            return kind, sha  # a test-designer snapshot: the tests over the pre-implementation base
    raise UsageError(f"{task['id']}: no base for the pre-implementation control of {sha[:12]} (no landed merge "
                     "receipt for this SHA and no test-designer snapshot)")


def run_proof(ctx: Ctx, plan: dict, task: dict, sha: str, *, negative_control: bool, checkout: str,
              keep: bool, tree: Path | None = None, budget: Budget | None = None, check_resources: bool = True,
              profile: dict | None = None, policy: dict | None = None) -> dict:
    """Run a task's proof (or its negative control) and write the run directory; returns the proof-run document.
    `plan` is the plan document (plan.json as loaded, MODULES.md 5).

    EnvError (exit 3) when the run could not be made; PolicyRefused (exit 4) for a forbidden command."""
    if not SHA40_RE.match(sha or ""):
        raise UsageError(f"--sha must be a full 40-hex commit id, got {sha!r}")
    layout = ctx.layout
    if layout.repo is None:
        raise UsageError("proof run needs the product repository (--repo)")
    profile = profile if profile is not None else load_profile(layout)
    policy = policy if policy is not None else load_policy(layout)
    local_state = load_local_state(layout)
    ptype = task["proof"]["type"]
    assert_allowed(task, policy, local_state)
    if checkout not in ("clone", "in-place"):
        raise UsageError(f"--checkout {checkout!r}: clone or in-place")
    by_role = ctx.by if ctx.by in ROLE_AGENT else None
    if by_role is None:
        raise UsageError(f"--by {ctx.by} cannot run a proof")
    if checkout == "in-place":
        # CLI.md: `in-place --tree DIR` only for merge's pre-push check, which is never a receipt.
        if by_role != "integrator":
            raise PolicyRefused(f"{task['id']}: --checkout in-place is merge's pre-push check (by the integrator), "
                                f"not a proof run by {by_role}", code="E_POLICY",
                                hint="a proof that a receipt can cite runs on a clean clone (the default)")
        if negative_control:
            raise UsageError("a negative control never runs in place")
        if tree is None:
            raise UsageError("--checkout in-place needs --tree DIR (merge's pre-push check)")
    if check_resources and checkout != "in-place":
        check_floors(profile, layout.repo)
    own_budget = budget is None
    budget = budget or Budget(layout, profile, "proof run", str(task.get("kind")))
    repo_git = gitutil.Git(layout.repo)
    control_kind, target_sha = (None, sha)
    if negative_control:
        control_kind, target_sha = _control_target(ctx, task, sha, repo_git)
    control_mode = _control_mode(task, control_kind)
    run_id, run_dir = _allocate_run(layout, task["id"], sha, ctx.now)
    started = time.monotonic()
    kind = _checkout_kind(task, checkout, control_mode)
    checkout_path: Path | None = None
    removed = False
    install = {"ran": False, "exit_code": None, "duration_s": None}
    warnings: list[ErrorItem] = []
    nc = task["proof"].get("negative_control") or {}
    cmd = str(task["proof"]["spec"].get("cmd") or "")
    spec_override: dict | None = None
    project = project_slug(profile)
    scratch = scratch_dir(profile, project, "proof", run_id)
    try:
        with (hold_lock(layout, "disk-heavy", ctx.command, timeout_s=180) if kind == "clone" else _null()):
            if kind == "clone":
                with budget.step("checkout"):
                    checkout_path = clean_checkout(layout.repo, target_sha, scratch / "checkout")
                if task["proof"]["spec"].get("install") and ptype == "command":
                    install = run_install(layout, checkout_path, run_dir, f"install-{run_id}", budget)
            elif kind == "in-place":
                checkout_path = Path(tree)  # type: ignore[arg-type]
            control_expect: dict | None = None
            if control_mode == "patch":
                patch = nc.get("patch_path")
                if patch:
                    patch_file = layout.state / str(patch)
                    if not patch_file.is_file():
                        raise EnvError(f"the control's patch {patch} is missing", code="E_ENV")
                    if str(patch).endswith(".plant.json"):
                        plant = read_json(patch_file)
                        state_copy = None
                        if any(op.get("target") == "state" for op in plant.get("ops") or []):
                            src = layout.state / "frontend"
                            state_copy = scratch / "frontend-copy"
                            if state_copy.exists():
                                rmtree_link_safe(state_copy)
                            shutil.copytree(src, state_copy, symlinks=True)
                            for form in (posix(src), str(src)):
                                cmd = cmd.replace(form, posix(state_copy))
                            spath = str(task["proof"]["spec"].get("path") or "")
                            if ptype == "file" and spath.startswith(posix(src)):
                                spec_override = dict(task["proof"]["spec"])
                                spec_override["path"] = posix(state_copy) + spath[len(posix(src)):]
                        apply_plant(plant, state_copy=state_copy, checkout=checkout_path if kind == "clone"
                                    else None)
                    else:
                        if checkout_path is None or kind != "clone":
                            raise EnvError("a patch control needs a clean clone", code="E_ENV")
                        res = gitutil.Git(checkout_path).run("apply", posix(patch_file), check=False)
                        if res.exit_code != 0:
                            raise EnvError(f"the control's patch does not apply: {res.stderr.strip()[-300:]}",
                                           code="E_ENV")
            elif control_mode == "command":
                cmd = str(nc["command"])
                # A command proof keeps its own expectation; any other type's control command is held to exit 0
                # (and must make it non-zero, expect_nonzero).
                control_expect = None if ptype == "command" else {"exit_code": 0}
            if control_mode == "command" or ptype == "command":
                outcome = _run_command(ctx, task, policy, checkout_path or layout.repo, run_dir, run_id, cmd, budget,
                                       expect=control_expect)
            elif control_mode == "forge-tx":
                outcome = _run_tx(ctx, task, policy, checkout_path, forge_for=sha, run_id=run_id)
            elif control_mode == "forge-ci":
                outcome = _run_ci_forgery(ctx, task, sha, layout.repo)
                outcome.details.append("scope: the built-in ci forgery tests exec.py's CI reader (head SHA, workflow, "
                                       "conclusion), not whether the workflow itself fails a bad commit")
            elif ptype == "file":
                outcome = _run_file(task, checkout_path, spec_override)
            elif ptype == "url":
                outcome = _run_url(task)
            elif ptype == "ci":
                outcome = _run_ci(task, target_sha, layout.repo)
            elif ptype == "tx":
                outcome = _run_tx(ctx, task, policy, checkout_path, run_id=run_id)
            elif ptype == "human-attest":
                outcome = _run_attest(ctx, task)
            else:
                raise UsageError(f"unknown proof type {ptype!r}")
    finally:
        if kind == "clone" and checkout_path is not None and not keep:
            try:
                rmtree_link_safe(scratch)
                removed = True
            except OSError as err:
                _LOG.warning("could not remove the proof checkout", extra={"data": {"error": str(err)}})
        elif kind == "clone" and checkout_path is None:
            if scratch.exists() and not keep:
                rmtree_link_safe(scratch)
    output_path = run_dir / "output.log"
    with open(output_path, "wb") as fh:
        fh.write(outcome.output)
    text = outcome.output.decode("utf-8", errors="replace")
    elapsed = time.monotonic() - started
    expectation_met = bool(outcome.met)
    details = [d for d in outcome.details if d]
    if outcome.env_failure:
        # CLI.md proof run: an environment failure is exit 3, never a failed expectation. The run document says so
        # (a warnings item of code E_ENV), so no later reader takes it for evidence: a control that died of the
        # environment did not fail "as required" (ran and met false), and _control_runs skips it entirely.
        expectation_met = False
        details.append(f"environment failure: {outcome.env_failure} (a rerun, never evidence)")
        warnings.append(ErrorItem(ENV_FAILURE_CODE, f"{task['id']}: {outcome.env_failure}", task=task["id"],
                                  hint="a rerun, never a failed expectation"))
    control = None
    if negative_control:
        control = {"kind": control_kind, "ran": not outcome.env_failure, "exit_code": outcome.exit_code,
                   "met": False if outcome.env_failure else not outcome.met,
                   "output_sha256": sha256_bytes(outcome.output)}
    doc: dict[str, Any] = {
        "schema": "execution.proof-run/1", "run_id": run_id, "task": task["id"], "sha": sha,
        "plan_version": int(plan.get("plan_version") or 1), "proof_hash": plan_mod.proof_digest(task),
        "type": ptype, "command": outcome.command,
        "checkout": {"kind": kind, "path": posix(checkout_path) if checkout_path is not None else None,
                     "removed": removed},
        "install": install,
        "started_utc": clock.format_utc(ctx.now),
        "finished_utc": clock.format_utc(ctx.now + timedelta(seconds=int(elapsed))),
        "exit_code": outcome.exit_code, "timed_out": outcome.timed_out,
        "output_sha256": sha256_bytes(outcome.output), "output_path": posix(output_path),
        "output_tail": redact(text[-OUTPUT_TAIL_CHARS:]),
        "expectation": {"met": expectation_met, "details": details or ["no detail"]},
        "negative_control": control,
        "gates_result_path": posix(outcome.gates_result_path) if outcome.gates_result_path else None,
        "by": {"role": by_role, "agent_type": ROLE_AGENT.get(by_role), "executor": ctx.executor or "A"},
    }
    if negative_control and target_sha != sha:
        doc["expectation"]["details"].append(f"control ran on {target_sha} (pre-implementation base)")
    if warnings:
        doc["warnings"] = [w.to_dict() for w in warnings]
    validate_doc(doc, "proof-run", f"proof run {run_id}")
    write_json_atomic(run_dir / "run.json", doc)
    if own_budget:
        budget.save()
    if ctx.executor in ("A", "B"):
        append_event(ctx, "proof.run", {"task": task["id"], "run": run_id, "sha": sha, "type": ptype,
                                        "exit_code": outcome.exit_code, "met": expectation_met,
                                        "control": control_kind})
    if outcome.env_failure:
        raise EnvError(f"{task['id']}: {outcome.env_failure}", code="E_ENV", data=doc,
                       hint="a rerun, never a failed expectation")
    return doc


def env_failed(doc: Any) -> bool:
    """True when a proof-run document records an environment failure (a `warnings` item of code E_ENV): the run
    could not reach a verdict, so it counts neither as a met nor as a failed expectation or control."""
    if not isinstance(doc, dict):
        return False
    return any(isinstance(w, dict) and w.get("code") == ENV_FAILURE_CODE for w in doc.get("warnings") or [])


def proof_exit(doc: dict) -> int:
    if doc.get("negative_control"):
        return 0 if doc["negative_control"]["met"] else 1
    return 0 if doc["expectation"]["met"] else 1


def cmd_run(ctx: Ctx, args: Namespace) -> CommandResult:
    plan_raw = plan_mod.load_raw(ctx.layout)
    task = task_raw(plan_raw, args.task)
    if args.checkout == "in-place":
        # merge runs its pre-push check in process (merge._pre_push_proof); from the command line an in-place run
        # could only be evidence made on an arbitrary tree, which no receipt may cite.
        raise PolicyRefused(f"{args.task}: --checkout in-place is merge's in-process pre-push check, never a "
                            "command-line proof run", code="E_POLICY",
                            hint="run the proof on a clean clone (the default --checkout clone)")
    if getattr(args, "tree", None):
        raise UsageError("--tree goes with --checkout in-place only")
    tree = None
    doc = run_proof(ctx, plan_raw, task, args.sha, negative_control=bool(args.negative_control),
                    checkout=args.checkout, keep=bool(args.keep), tree=tree)
    code = proof_exit(doc)
    errors: list[ErrorItem] = []
    if code:
        what = "the negative control passed (it must fail)" if doc.get("negative_control") else \
            "the expectation was not met"
        errors.append(ErrorItem("E_CHECK", f"{args.task}: {what}", task=args.task, path=doc["output_path"]))
    return CommandResult(data=doc, exit_code=code, errors=errors)


# --- attestations (HOOKS.md 8.2 step 6) -----------------------------------------------------------------------------

def attestations(layout: Layout) -> list[dict]:
    """Every guard.attest record: hook-event files not yet imported, and imported events.jsonl lines."""
    found: list[dict] = []
    if layout.hook_events_dir.is_dir():
        for path in sorted(layout.hook_events_dir.glob("*.json")):
            try:
                ev = read_json_retry(path)
            except (OSError, ValueError, ExecError):
                continue
            if isinstance(ev, dict) and ev.get("type") == "guard.attest":
                data = dict(ev.get("data") or {})
                data.setdefault("agent_type", ev.get("agent_type"))
                data.setdefault("at", ev.get("ts"))
                found.append(data)
    evs, _errs = events.read_all(layout)
    for ev in evs:
        if ev.get("type") == "guard.attest":
            data = dict(ev.get("data") or {})
            data.setdefault("at", ev.get("ts"))
            found.append(data)
    return found


def _at(record: dict) -> datetime | None:
    text = str(record.get("at") or "")
    m = re.match(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?Z$", text)
    if not m:
        return None
    return clock.parse_utc(m.group(1) + "Z")


def find_attestation(layout: Layout, *, command: str, task: str, now: datetime, run: str | None = None,
                     attempt: int | None = None, agent_type: str | None = None,
                     max_age_s: float | None = None) -> dict | None:
    """The newest matching attestation (by its instant), or None."""
    best: tuple[datetime, dict] | None = None
    for rec in attestations(layout):
        if rec.get("command") != command or rec.get("task") != task:
            continue
        if run is not None and rec.get("run") != run:
            continue
        if attempt is not None and str(rec.get("attempt")) != str(attempt):
            continue
        if agent_type is not None and rec.get("agent_type") != agent_type:
            continue
        at = _at(rec)
        if at is None:
            continue
        if max_age_s is not None and ((now - at).total_seconds() > max_age_s or (at - now).total_seconds() > 60):
            continue
        if best is None or at > best[0]:
            best = (at, rec)
    return best[1] if best else None


# --- proof verdict --------------------------------------------------------------------------------------------------

def _findings_schema() -> dict:
    receipt = schema.default_registry().get("proof-receipt")
    props = receipt["properties"]
    return {"type": "object", "additionalProperties": False, "required": ["criteria", "findings", "integrity"],
            "properties": {"criteria": props["criteria"], "findings": props["findings"],
                           "integrity": props["integrity"],
                           "implementer_result": {"type": ["string", "null"]}}}


def load_findings(path: Path) -> dict:
    if not path.is_file():
        raise UsageError(f"--findings {posix(path)} does not exist")
    doc = read_json(path)
    report = schema.validate_with(doc, _findings_schema(), base_dir=schema.default_registry().schema_dir)
    if not report.ok:
        items = [ErrorItem("E_SCHEMA", i.message, path=i.instance_path or "/") for i in report.issues[:20]]
        raise ValidationFailed(f"the findings file fails its schema: {report.issues[0].message}", code="E_SCHEMA",
                               items=items)
    return doc


def _load_run(layout: Layout, task: str, run_id: str) -> dict:
    """The cited run document (local run directory first, then its tracked copy). A document that fails the
    proof-run schema is refused before anything is written: the done check reads only schema-valid runs (SCHEMAS.md
    4.3 condition 4), so a receipt citing one could never reach `done`."""
    if not RUN_ID_RE.match(run_id or ""):
        raise UsageError(f"--run {run_id!r} is not a proof-run id")
    for path in (layout.proof_run_dir(task, run_id) / "run.json", layout.proof_run_copy(task, run_id)):
        if path.is_file():
            doc = read_json(path)
            report = schema.validate(doc, "proof-run")
            if not report.ok:
                issue = report.issues[0]
                raise PolicyRefused(f"run {run_id} is not a valid proof-run document ({issue.instance_path or '/'}: "
                                    f"{issue.message})", code="E_POLICY", hint="cite a run exec.py proof run wrote")
            return doc
    owner = run_id.split("-", 1)[0]
    if owner != task and (layout.proof_run_dir(owner, run_id) / "run.json").is_file():
        raise PolicyRefused(f"run {run_id} belongs to {owner}, not {task}", code="E_POLICY")
    raise UsageError(f"proof run {run_id} of {task} not found")


def _run_order(doc: dict) -> tuple[str, str, int]:
    """Chronological order of proof runs: started_utc, then the run id's stamp and counter (`<task>-<sha8>-<stamp>-
    <n>`; the counter compared as a number, so run 10 comes after run 9)."""
    run_id = str(doc.get("run_id") or "")
    head, _sep, n = run_id.rpartition("-")
    stamp = head.rpartition("-")[2]
    return (str(doc.get("started_utc") or ""), stamp, int(n) if n.isdigit() else 0)


def _control_runs(layout: Layout, task: str, proof_hash: str, sha: str) -> list[dict]:
    """Every control run of this task made for `sha` (the landed SHA under verdict) under this proof digest whose
    control ran, met or not, oldest first (local run directories and tracked copies, each run once).

    A control made for another SHA of the task (an earlier attempt's commit) says nothing about the code under
    verdict (SCHEMAS.md 4.3 condition 6, "in this run"): it is never counted. Nor is a control that ended in an
    environment failure (`env_failed`): it reached no verdict, so it neither satisfies the condition nor, being newer,
    masks an older control that failed its requirement."""
    out: list[dict] = []
    candidates = list((layout.local / "proof-runs" / task).glob("*/run.json"))
    candidates += list((layout.state / "proofs" / "runs" / task).glob("*.json"))
    seen: set[str] = set()
    for p in sorted(candidates):
        try:
            doc = read_json(p)
        except (OSError, ValueError, ExecError):
            continue
        nc = doc.get("negative_control") if isinstance(doc, dict) else None
        if not isinstance(nc, dict) or not nc.get("ran") or doc.get("run_id") in seen or env_failed(doc):
            continue
        if doc.get("task") != task or doc.get("sha") != sha or doc.get("proof_hash") != proof_hash:
            continue
        seen.add(doc["run_id"])
        out.append(doc)
    return sorted(out, key=_run_order)


def is_checker_task(task: dict) -> bool:
    """A task whose deliverable is a checker (SCHEMAS.md P-13): kind gate, or `params.checker` true."""
    return task.get("kind") == "gate" or bool((task.get("params") or {}).get("checker"))


def control_required(task: dict) -> bool:
    """P-13 with SCHEMAS.md 4.3 condition 6, exactly as the done check reads it (contract revision 3, F13): the
    negative control is required whenever its kind is not `not-applicable`, for every agent kind (infra and deploy
    included)."""
    nc = (task.get("proof") or {}).get("negative_control") or {}
    return nc.get("kind") not in (None, "not-applicable") and task.get("kind") in CONTROL_REQUIRED_KINDS


def _recorded_control(layout: Layout, task: dict, proof_hash: str) -> tuple[dict | None, str | None]:
    """(the run document behind the plan's `negative_control.recorded`, why it does not count). The plan record comes
    from a test-designer's result, and SCHEMAS.md 4.3 takes nothing from an agent's word: it counts only when lane
    B04's done check would count it (a non-zero `exit_code`) AND the run it names is on disk (its local directory or
    its tracked copy) as a control run of this task, for this proof digest ("recorded in the plan ... for this proof
    digest"), whose control ran and failed as required with that exit code and did not end in an environment
    failure. Its SHA is the test-designer's base, never the landed SHA, so it is not compared (F16)."""
    recorded = ((task.get("proof") or {}).get("negative_control") or {}).get("recorded")
    if not isinstance(recorded, dict):
        return None, None
    code = recorded.get("exit_code")
    run_id = str(recorded.get("run") or "")
    if isinstance(code, bool) or not isinstance(code, int) or code == 0:
        return None, f"the plan's recorded control {run_id} has no non-zero exit code"
    doc: Any = None
    if RUN_ID_RE.match(run_id):
        for path in (layout.proof_run_dir(task["id"], run_id) / "run.json", layout.proof_run_copy(task["id"], run_id)):
            if path.is_file():
                try:
                    doc = read_json(path)
                except (OSError, ExecError) as err:
                    return None, f"the plan's recorded control run {run_id} is unreadable ({err})"
                break
    if not isinstance(doc, dict):
        return None, f"the plan's recorded control run {run_id} is on disk neither as a run nor as a tracked copy"
    problems: list[str] = []
    if not schema.validate(doc, "proof-run").ok:
        problems.append("is not a valid proof-run document")
    if doc.get("task") != task["id"]:
        problems.append(f"belongs to {doc.get('task')}")
    if doc.get("proof_hash") != proof_hash:
        problems.append("ran another proof (its proof_hash is not the current plan's)")
    nc = doc.get("negative_control")
    if not isinstance(nc, dict) or not nc.get("ran") or nc.get("met") is not True:
        problems.append("is not a control that failed as required")
    elif nc.get("exit_code") != code:
        problems.append(f"exited {nc.get('exit_code')}, the plan records {code}")
    if env_failed(doc):
        problems.append("ended in an environment failure")
    if problems:
        return None, f"the plan's recorded control run {run_id} " + "; ".join(problems)
    return doc, None


def _verifier_run_of(layout: Layout, task: str, sha: str) -> bool:
    """A schema-valid proof run of `sha` by role verifier, local or tracked copy: the evidence of built -> verifying
    (SCHEMAS.md 4.2), read the way lane B04's transition reads it."""
    paths = sorted((layout.local / "proof-runs" / task).glob("*/run.json"))
    paths += sorted((layout.state / "proofs" / "runs" / task).glob("*.json"))
    for path in paths:
        try:
            doc = read_json(path)
        except (OSError, ExecError):
            continue
        if isinstance(doc, dict) and doc.get("task") == task and doc.get("sha") == sha and \
                (doc.get("by") or {}).get("role") == "verifier" and schema.validate(doc, "proof-run").ok:
            return True
    return False


_CHAINS: Mapping[str, tuple[str, ...]] = {"running": ("built", "verifying"), "built": ("verifying",),
                                          "verifying": ()}


def _chain(current: str, verdict: str) -> list[str]:
    """The evidence-backed rows of SCHEMAS.md 4.2 a verdict applies from `current` (none from any other status)."""
    if current not in _CHAINS:
        return []
    return [*_CHAINS[current], "done" if verdict == "pass" else "failed"]


def _restore_bytes(path: Path, raw: bytes) -> None:
    try:
        text: str | None = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = None
    if text is not None and "\r" not in text and (not text or text.endswith("\n")):
        write_text_atomic(path, text)
        return
    tmp = path.with_name(f".{path.name}.{os.getpid()}.restore")
    tmp.write_bytes(raw)
    os.replace(tmp, path)


def _unlink(path: Path) -> None:
    """Remove a file this call created; a Windows sharing error (a reader holds it) is retried for about 1.5 s."""
    for delay in (0.02, 0.04, 0.08, 0.16, 0.2, 0.2, 0.2, 0.2, 0.2, None):
        try:
            path.unlink(missing_ok=True)
            return
        except PermissionError:
            if delay is None:
                raise
            time.sleep(delay)


def _lock_record(line: bytes) -> bool:
    """True for the `error` event of a lock this process broke (locks.drain_broken): never cut by a rollback."""
    try:
        ev = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False
    return isinstance(ev, dict) and ev.get("type") == "error" and (ev.get("data") or {}).get("kind") == "lock-broken"


class _StagedWrites:
    """Every file one `proof verdict` changes under the state lock, each with the bytes it held before, so that a
    refusal or an error after the first write puts the state back as it was (CLI.md `proof verdict`: "each failure:
    exit 4, nothing written"). events.jsonl is cut back to the length it had when the lock was taken: under the held
    state lock every byte after it is this call's own (lane B04's transitions append their task.status events before
    the status file is saved), except the `error` records of locks broken meanwhile, which are kept."""

    def __init__(self, layout: Layout) -> None:
        if not events.locks.is_held("state"):
            raise InternalError("the verdict's staged writes need the state lock (a caller bug)", code="E_INTERNAL")
        self.layout = layout
        self.before: dict[Path, bytes | None] = {}
        self.events_size: int | None = layout.events.stat().st_size if layout.events.is_file() else None

    def keep(self, path: Path) -> None:
        if path not in self.before:
            self.before[path] = path.read_bytes() if path.is_file() else None

    def write_json(self, path: Path, doc: Any) -> None:
        self.keep(path)
        write_json_atomic(path, doc)

    def move(self, src: Path, dest: Path) -> None:
        self.keep(src)
        self.keep(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        os.replace(src, dest)

    def _cut_events(self) -> None:
        path = self.layout.events
        if not path.is_file():
            return
        size = self.events_size or 0
        with open(path, "r+b") as fh:
            fh.seek(size)
            tail = fh.read()
            if not tail:
                return
            kept = [line for line in tail.split(b"\n") if line.strip() and _lock_record(line)]
            fh.seek(size)
            fh.truncate()
            if kept:
                fh.write(b"\n".join(kept) + b"\n")
            fh.flush()
            os.fsync(fh.fileno())
        if self.events_size is None and path.stat().st_size == 0:
            _unlink(path)

    def rollback(self) -> list[str]:
        """Undo every write (files in reverse order of their first change, events.jsonl cut); the problems left."""
        problems: list[str] = []
        try:
            self._cut_events()
        except OSError as err:
            problems.append(f"events.jsonl: {err}")
        for path, raw in reversed(list(self.before.items())):
            try:
                if raw is None:
                    _unlink(path)
                else:
                    _restore_bytes(path, raw)
            except (OSError, ExecError) as err:
                problems.append(f"{posix(path)}: {err}")
        if problems:
            _LOG.error("a refused verdict could not undo all its writes", extra={"data": {"problems": problems}})
        else:
            _LOG.info("a refused verdict's writes were undone", extra={"data": {"files": len(self.before)}})
        return problems


def _move_to_history(layout: Layout, task: str, staged: _StagedWrites) -> str | None:
    current = layout.receipt(task)
    if not current.is_file():
        return None
    old = read_json(current)
    attempt = int(old.get("attempt") or 1) if isinstance(old, dict) else 1
    dest = layout.receipt_history(task, attempt)
    k = 2
    while dest.exists():
        dest = dest.with_name(f"{task}.a{attempt}-{k}.json")
        k += 1
    staged.move(current, dest)
    return layout.rel(dest)


def _done_check(ctx: Ctx, plan: dict, task_id: str, entry: dict | None, sha: str,
                git: gitutil.Git) -> list[ErrorItem]:
    """Lane B04's done check (`status.check_done_evidence`, SCHEMAS.md 4.3) on the receipt just written, before any
    transition, with the status entry as the transitions leave it (landed_sha set, verifying)."""
    import inspect  # noqa: PLC0415 - only here
    from . import status as status_mod  # lane B04
    model = PlanModel.from_raw(plan)
    raw = dict(entry or {})
    raw["landed_sha"] = sha
    raw["status"] = "verifying"
    ts = TaskState(status="verifying", since=ctx.now, attempts=int(raw.get("attempts", 0)),
                   reruns=int(raw.get("reruns", 0)), raw=raw)
    check = status_mod.check_done_evidence
    try:
        params = inspect.signature(check).parameters
    except (TypeError, ValueError):
        params = {}  # type: ignore[assignment]
    extras = {"executor": ctx.executor} if "executor" in params else {}
    return list(check(ctx.layout, model, model.by_id[task_id], ts, git, **extras))


def write_verdict(ctx: Ctx, plan: dict, task: dict, run_id: str, verdict: str, findings: dict, attempt: int,
                  model: str, effort: str) -> dict:
    """The checks of CLI.md `proof verdict`, every one before anything is written (exit 4, nothing written; a missing
    attestation is exit 3), then the receipt, the tracked copies and the transitions. `plan` is the plan document
    (plan.json as loaded, MODULES.md 5). The writes are staged: lane B04's done check runs on the written receipt
    before any transition, and a refusal or an error at any later step puts every file back (F13)."""
    from . import results  # lane B04
    layout = ctx.layout
    tid = task["id"]
    if ctx.executor not in ("A", "B"):
        raise UsageError("proof verdict needs the executor (local state or --executor)")
    if task.get("executor") != ctx.executor:
        raise PolicyRefused(f"{tid} belongs to executor {task.get('executor')}, not {ctx.executor}", code="E_POLICY")
    if model not in ("opus", "sonnet", "haiku") or effort not in AGENT_EFFORTS:
        # contract revision 4: an agent's effort is low, medium or high (`xhigh` is the orchestrator's alone)
        raise UsageError("--model opus|sonnet|haiku and --effort low|medium|high (the verifier's own effort)")
    run = _load_run(layout, tid, run_id)
    if run.get("task") != tid:
        raise PolicyRefused(f"run {run_id} belongs to {run.get('task')}, not {tid}", code="E_POLICY")
    if run.get("negative_control"):
        raise PolicyRefused(f"run {run_id} is a negative-control run, not the proof run", code="E_POLICY")
    if env_failed(run):
        # Neither verdict may rest on it: a pass is impossible (not met) and a fail would record the environment as
        # the code's failure (CLI.md proof run: "never a failed expectation").
        raise EnvError(f"run {run_id} ended in an environment failure: it is no evidence either way",
                       code="E_ENV", hint="a rerun: exec.py proof run --by verifier on a clean clone, then cite it")
    run_checkout = (run.get("checkout") or {}).get("kind")
    if run_checkout == "in-place":
        raise PolicyRefused(f"run {run_id} ran in place (merge's pre-push check): never evidence for a receipt",
                            code="E_POLICY", hint="cite a proof run made on a clean clone of the landed SHA")
    run_role = (run.get("by") or {}).get("role")
    if run_role not in VERDICT_RUN_ROLES:
        raise PolicyRefused(f"run {run_id} was made by role {run_role}: a receipt cites the verifier's own re-run "
                            "(or an orchestrator replay)", code="E_POLICY",
                            hint="exec.py proof run --by verifier on a clean clone")
    profile = load_profile(layout) if layout.profile.is_file() else {}
    budget = Budget(layout, profile, "proof verdict", str(task.get("kind")))
    merge_receipt = results.landed_receipt(layout, tid, attempt)
    expected = (merge_receipt or {}).get("landed_sha")
    if expected is None:
        st = statusio.load(layout, ctx.executor).get("tasks", {}).get(tid) or {}
        expected = st.get("landed_sha")
    if expected is None:
        raise PolicyRefused(f"{tid} attempt {attempt}: no landed merge receipt and no landed SHA", code="E_POLICY")
    if run.get("sha") != expected:
        raise PolicyRefused(f"run {run_id} is of {str(run.get('sha'))[:12]}, the landed SHA is {expected[:12]}",
                            code="E_POLICY")
    current_hash = plan_mod.proof_digest(task)
    if run.get("proof_hash") != current_hash:
        raise PolicyRefused(f"run {run_id} ran an older proof (stale proof_hash): re-run the proof", code="E_POLICY")
    met = bool((run.get("expectation") or {}).get("met"))
    if verdict == "pass" and not met:
        raise PolicyRefused(f"pass verdict on run {run_id} whose expectation was not met", code="E_VERDICT_MISMATCH")
    git = gitutil.Git(layout.repo) if layout.repo else None
    if git is None:
        raise UsageError("proof verdict needs the product repository (--repo)")
    try:
        with budget.step("fetch"):
            git.fetch("origin")
    except GitError as err:
        raise EnvError(f"git fetch failed: {err.message}", code="E_GIT") from err
    on_main = git.is_ancestor(expected, "origin/main") if _has_commit(git, expected) else False
    if verdict == "pass" and not on_main:
        raise PolicyRefused(f"{expected[:12]} is not on origin/main", code="E_NOT_ON_MAIN")
    required = control_required(task)
    controls = _control_runs(layout, tid, current_hash, expected)
    latest_control = controls[-1] if controls else None
    recorded_doc, recorded_why = (None, None) if latest_control is not None else \
        _recorded_control(layout, task, current_hash)
    if verdict == "pass" and latest_control is not None and not latest_control["negative_control"].get("met"):
        # The newest control of the landed SHA passed where it had to fail: the checker no longer tells the honest
        # artifact from the forged (or the pre-implementation) one. An older control, or one recorded in the plan,
        # never outweighs it.
        raise PolicyRefused(f"{tid}: the latest negative control of {expected[:12]} "
                            f"({latest_control['run_id']}) passed where it must fail", code="E_POLICY",
                            hint="the checker regressed: a fail verdict, or fix it and run the control again")
    if verdict == "pass" and required and latest_control is None and recorded_doc is None:
        raise PolicyRefused(f"{tid}: the negative control is required (P-13, SCHEMAS.md 4.3 condition 6) and no "
                            f"control run of the landed SHA {expected[:12]} failed as required"
                            + (f"; {recorded_why}" if recorded_why else ""), code="E_POLICY",
                            hint=f"run exec.py proof run --sha {expected} --negative-control first")
    integ = findings["integrity"]
    if verdict == "pass" and (integ.get("skip_markers_added", 0) != 0 or integ.get("protected_touched")):
        raise PolicyRefused("integrity findings are inconsistent with a pass (skip markers or protected paths)",
                            code="E_POLICY")
    attest = find_attestation(layout, command="proof verdict", task=tid, run=run_id, now=ctx.now,
                              agent_type="execution-verifier", max_age_s=ATTEST_MAX_AGE_S)
    if attest is None or not attest.get("agent_id"):
        raise EnvError(f"no guard attestation of an execution-verifier for ({tid}, {run_id}) younger than 10 min",
                       code="E_ATTESTATION_MISSING", hint="a rerun: the PreToolUse hook did not fire")
    merge_attest = find_attestation(layout, command="merge", task=tid, attempt=attempt, now=ctx.now)
    impl_agent = merge_attest.get("agent_id") if merge_attest else None
    if impl_agent is not None and impl_agent == attest.get("agent_id"):
        raise PolicyRefused("the verifier's agent id equals the implementer's (SCHEMAS.md 4.3 condition 5)",
                            code="E_POLICY")
    # The evidence-backed rows of SCHEMAS.md 4.2 this verdict will apply, checked as lane B04's transitions check them,
    # so that they refuse here, before anything is written (the staged writes below are the net, not the rule).
    entry = (statusio.load(layout, ctx.executor).get("tasks") or {}).get(tid)
    chain = _chain(entry.get("status") if entry else "planned", verdict)
    if "built" in chain:
        current_attempt = int((entry or {}).get("attempts", 0)) + 1
        if attempt != current_attempt:
            raise PolicyRefused(f"{tid} runs attempt {current_attempt} (its status counts "
                                f"{current_attempt - 1} failure(s)); the verdict names attempt {attempt}",
                                code="E_POLICY", hint="running -> built reads the landed merge receipt of the status's "
                                                      "attempt (SCHEMAS.md 4.2, 4.4)")
        if merge_receipt is None:
            raise PolicyRefused(f"{tid} attempt {attempt}: running -> built needs the landed merge receipt (SCHEMAS.md "
                                "4.2); only a status landed_sha is known", code="E_POLICY")
        if not on_main:
            raise PolicyRefused(f"{expected[:12]} is not on origin/main: running -> built needs it (SCHEMAS.md 4.2)",
                                code="E_NOT_ON_MAIN")
    if "verifying" in chain and not _verifier_run_of(layout, tid, expected):
        raise PolicyRefused(f"{tid}: built -> verifying needs a proof run of {expected[:12]} by role verifier "
                            "(SCHEMAS.md 4.2); the cited run is a replay", code="E_POLICY",
                            hint=f"exec.py proof run --by verifier --sha {expected}")
    control = latest_control if latest_control is not None else recorded_doc
    if control is not None:
        nc_receipt = {"required": required, "ran": True, "exit_code": control["negative_control"].get("exit_code"),
                      "met": bool(control["negative_control"].get("met"))}
    else:
        nc_receipt = {"required": required, "ran": False, "exit_code": None, "met": False if required else None}
    run_copy = layout.proof_run_copy(tid, run_id)
    merge_copy_rel = layout.rel(layout.merge_copy(tid, attempt)) if merge_receipt is not None else None
    impl = _implementer_result(ctx, results, tid, attempt, findings.get("implementer_result"))
    impl_rel = layout.rel(layout.impl_copy(tid, attempt)) if impl is not None else None
    receipt: dict[str, Any] = {
        "schema": "execution.proof-receipt/1", "task": tid, "attempt": attempt, "executor": ctx.executor,
        "plan_version": int(plan.get("plan_version") or 1), "proof_hash": current_hash, "sha": expected,
        "on_origin_main": bool(on_main), "run": run_id, "command": run.get("command"),
        "exit_code": run.get("exit_code"), "output_sha256": run["output_sha256"],
        "negative_control": nc_receipt,
        "verdict": verdict, "criteria": findings["criteria"], "findings": findings["findings"],
        "integrity": integ,
        "by": {"role": "verifier", "agent_type": "execution-verifier", "agent_id": attest.get("agent_id"),
               "model": model, "effort": effort},
        "implementer": {"commit": (impl or {}).get("commit") if isinstance((impl or {}).get("commit"), str)
                        and SHA40_RE.match(str((impl or {}).get("commit"))) else expected,
                        "agent_type": "execution-implementer" if impl_agent else None,
                        "agent_id": impl_agent, "result": impl_rel, "merge_receipt": merge_copy_rel},
        "run_copy": layout.rel(run_copy), "written_utc": clock.format_utc(ctx.now),
    }
    validate_doc(receipt, "proof-receipt", f"receipt of {tid}")
    with budget.step("write"), hold_lock(layout, "state", ctx.command):
        staged = _StagedWrites(layout)
        try:
            staged.write_json(run_copy, run)
            if control is not None:
                staged.write_json(layout.proof_run_copy(tid, control["run_id"]), control)
            if merge_receipt is not None:
                staged.write_json(layout.merge_copy(tid, attempt), merge_receipt)
            if impl is not None:
                staged.write_json(layout.impl_copy(tid, attempt), impl)
            history = _move_to_history(layout, tid, staged)
            staged.write_json(layout.receipt(tid), receipt)
            receipt_sha = sha256_file(layout.receipt(tid))
            doc = statusio.load(layout, ctx.executor)
            if verdict == "pass":
                problems = _done_check(ctx, plan, tid, (doc.get("tasks") or {}).get(tid), expected, git)
                if problems:
                    raise TransitionRefused(f"{tid}: the done check refuses this receipt (SCHEMAS.md 4.3): "
                                            f"{problems[0].message}; nothing was written", code="E_TRANSITION_REFUSED",
                                            items=problems[:20])
            staged.keep(layout.status(ctx.executor))
            transitions = _apply_transitions(ctx, plan, tid, verdict, expected, merge_copy_rel or "",
                                             layout.rel(run_copy), git=git, doc=doc)
            events.append(ctx, "proof.verdict", {"task": tid, "run": run_id, "verdict": verdict, "sha": expected,
                                                 "attempt": attempt, "receipt_sha256": receipt_sha,
                                                 "transitions": transitions, "history": history})
        except BaseException as err:
            left = staged.rollback()
            if left:
                raise InternalError(f"{tid}: the verdict failed ({err}) and {len(left)} write(s) could not be "
                                    f"undone: {'; '.join(left)[:400]}", code="E_INTERNAL",
                                    hint="restore those files from the state repo before the next verdict") from err
            raise
    kept = (run.get("checkout") or {})
    if kept.get("kind") == "clone" and not kept.get("removed") and kept.get("path"):
        checkout_dir = Path(kept["path"])
        scratch_run = checkout_dir.parent
        target = scratch_run if scratch_run.name == run_id else checkout_dir
        if target.exists():
            rmtree_link_safe(target)
    budget.save()
    out = dict(receipt)
    out["receipt_sha256"] = receipt_sha
    return out


def _has_commit(git: gitutil.Git, sha: str) -> bool:
    return git.run("cat-file", "-e", f"{sha}^{{commit}}", check=False).exit_code == 0


def _implementer_result(ctx: Ctx, results: Any, task: str, attempt: int, named: Any) -> dict | None:
    if isinstance(named, str) and named:
        p = Path(named)
        if not p.is_absolute():
            p = ctx.layout.state / named
        if p.is_file() and _inside(p, ctx.layout.state):
            doc = read_json(p)
            return doc if isinstance(doc, dict) else None
    found = results.find_any_wave(ctx.layout, task, "implementer", attempt)
    return found[1] if found else None


def _transition_extras(transition: Any, git: gitutil.Git | None, model: PlanModel) -> dict:
    """Keyword arguments beyond the MODULES.md signature `transition(ctx, doc, task, to, *, evidence)` that the
    status module accepts: B04's evidence checks take `git=` (the done check's origin/main ancestry) and `plan=`.
    Passed only when the callee declares them, so both signatures work (see the B06 report, F4)."""
    import inspect  # noqa: PLC0415 - only here
    try:
        params = inspect.signature(transition).parameters
    except (TypeError, ValueError):
        return {}
    extras: dict[str, Any] = {}
    if "git" in params and git is not None:
        extras["git"] = git
    if "plan" in params:
        extras["plan"] = model
    return extras


def _apply_transitions(ctx: Ctx, plan: dict, task_id: str, verdict: str, sha: str, merge_evidence: str,
                       run_evidence: str, *, git: gitutil.Git | None = None, doc: dict | None = None) -> list[str]:
    """running -> built -> verifying -> done|failed on this executor's status (`doc`, read under the held state
    lock), saved once every row is applied."""
    from . import status as status_mod  # lane B04
    doc = doc if doc is not None else statusio.load(ctx.layout, ctx.executor or "A")
    entry = (doc.get("tasks") or {}).get(task_id)
    chain = _chain(entry.get("status") if entry else "planned", verdict)
    if not chain:
        return []
    if entry is not None:
        entry["landed_sha"] = sha
        entry["receipt"] = f"proofs/{task_id}.json"
    model = PlanModel.from_raw(plan)
    task = model.by_id[task_id]
    applied: list[str] = []
    evidence = {"built": [merge_evidence] if merge_evidence else [f"landed:{sha}"], "verifying": [run_evidence],
                "done": [f"proofs/{task_id}.json"], "failed": [f"proofs/{task_id}.json"]}
    extras = _transition_extras(status_mod.transition, git, model)
    for to in chain:
        status_mod.transition(ctx, doc, task, to, evidence=evidence[to], **extras)
        applied.append(to)
    statusio.save(ctx, doc)
    return applied


def cmd_verdict(ctx: Ctx, args: Namespace) -> CommandResult:
    plan = plan_mod.load_raw(ctx.layout)
    task = task_raw(plan, args.task)
    findings = load_findings(Path(args.findings))
    data = write_verdict(ctx, plan, task, args.run, args.verdict, findings, int(args.attempt), args.model,
                         args.effort)
    return CommandResult(data=data)


__all__ = ["Budget", "make_run_id", "clean_checkout", "run_proof", "check_file", "write_verdict", "cmd_run",
           "cmd_verdict", "check_floors", "validate_doc", "attestations", "find_attestation", "apply_plant",
           "install_config", "run_install", "proof_exit", "forged_tx_hash", "control_required", "tx_hash_kind",
           "hashed_value", "chain_reread"]
