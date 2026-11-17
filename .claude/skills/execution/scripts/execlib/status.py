"""Task status transitions and the done check (contract/SCHEMAS.md 4.2-4.4, MODULES.md 4 `status.py`).

Only exec.py performs transitions. `transition` finds the row of SCHEMAS.md 4.2 for (current status, target, the
calling subcommand, the task's nature), runs that row's evidence check against files on disk (never against an
agent's word), then appends the history entry and one `task.status` event. Anything else is E_TRANSITION_REFUSED
(exit 4) and the caller's document is left untouched. `check_done_evidence` is SCHEMAS.md 4.3 (seven conditions, a
local and a cross-executor profile).

Helpers shared by the other modules of lane B04 live here because this is their lowest common module: the answer
file reader, the decision-header scanner (MODULES.md 8 gives `status` no `decisionsio` edge), the merge-receipt and
proof-run lookups (no `results` edge), the file-proof evaluator of SCHEMAS.md 3.3 (`proof.check_file` is layer 7,
above this module) and the lock helpers. MODULES.md 8 lists no `locks` edge for status, decisions, answers, manual,
reconcile, replay or resume although CLI.md gives each of their commands a lock; the helpers below reach the locks
module through `statusio` (which imports it) until the contract question Q-B04-1 adds the edge. This is reported in
the lane's build report, not hidden.
"""
from __future__ import annotations

import copy
import json
import re
from argparse import Namespace
from contextlib import AbstractContextManager
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence

from . import clock, events, jsonio, plan as planmod, schema, statusio
from .errors import (ErrorItem, GitError, InternalError, PolicyRefused, TransitionRefused, UsageError,
                     ValidationFailed)
from .gitutil import Git
from .model import CommandResult, Ctx, PlanModel, Task, TaskState
from .paths import Layout, posix

TERMINAL: frozenset[str] = frozenset({"done", "cut", "superseded"})
NON_TERMINAL: frozenset[str] = frozenset({"planned", "ready", "running", "built", "verifying", "failed",
                                          "blocked-manual", "blocked-decision", "cut-proposed"})
ALL_STATUSES: frozenset[str] = TERMINAL | NON_TERMINAL
HUMAN_KINDS: frozenset[str] = frozenset({"manual", "decision"})
OWNER_ONLY_KINDS: frozenset[str] = frozenset({"approval", "spec-validation", "cut", "policy-exception",
                                              "fix-selection"})
FAILED_MERGE_OUTCOMES: frozenset[str] = frozenset({"conflict", "gate-failed", "scan-failed",
                                                   "push-rejected-exhausted", "refused"})
RERUN_CAP = 3
UNBLOCKING_OPS: frozenset[str] = frozenset({"unblock-tasks", "retry-task", "restore-tasks"})
# P-13: the kinds whose negative control is required (anything but not-applicable on these kinds)
_NC_KINDS: frozenset[str] = frozenset({"code", "test", "gate", "tx", "infra", "deploy", "watch", "research"})
_EXACT_UTC = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")


# --- locks (Q-B04-1: reached through statusio, which imports execlib.locks) ---------------------------------------

def state_lock(ctx: Ctx) -> AbstractContextManager[None]:
    """The `state` lock of CLI.md 0.3 for this command."""
    return statusio.locks.hold(ctx.layout, "state", command=ctx.command)


def plan_lock(ctx: Ctx) -> AbstractContextManager[None]:
    """The `plan` lock (taken before `state`, LOCK_ORDER)."""
    return statusio.locks.hold(ctx.layout, "plan", command=ctx.command)


def holds_state_lock() -> bool:
    return bool(statusio.locks.is_held("state"))


# --- the transition table (SCHEMAS.md 4.2) ------------------------------------------------------------------------

@dataclass(frozen=True)
class Rule:
    frm: frozenset[str]
    to: str
    commands: frozenset[str]
    evidence: str
    nature: str | None = None          # "human" (manual/decision), "manual", "decision", "agent" or None (any)


def _r(frm: Iterable[str], to: str, commands: Iterable[str], evidence: str, nature: str | None = None) -> Rule:
    return Rule(frozenset(frm), to, frozenset(commands), evidence, nature)


_TICK = ("wave ingest", "status", "proof verdict")
TRANSITIONS: tuple[Rule, ...] = (
    _r({"planned"}, "ready", {"schedule", "status"}, "deps-done"),
    _r({"ready"}, "planned", {"schedule", "amend"}, "deps-undone"),
    _r({"planned"}, "running", {"plan instantiate"}, "approval-task", "decision"),
    _r({"ready"}, "running", {"wave emit"}, "launch-intent", "agent"),
    _r({"planned"}, "running", {"wave emit"}, "in-wave", "agent"),
    _r({"ready"}, "running", {"manual post"}, "posted", "human"),
    _r({"running"}, "ready", {"wave launched", "wave ingest", "status", "resume"}, "back-to-ready", "agent"),
    _r({"running"}, "planned", {"wave ingest"}, "skipped-dep", "agent"),
    _r({"running"}, "built", _TICK, "landed", "agent"),
    _r({"running"}, "failed", {"wave ingest"}, "attempt-failed", "agent"),
    _r({"running"}, "blocked-manual", {"wave ingest"}, "blocked-manual", "agent"),
    _r({"running"}, "blocked-decision", {"wave ingest"}, "blocked-decision", "agent"),
    _r({"built"}, "verifying", _TICK, "verifier-run", "agent"),
    _r({"verifying"}, "done", _TICK, "done-check", "agent"),
    _r({"verifying"}, "failed", _TICK, "fail-receipt", "agent"),
    _r({"failed"}, "ready", {"wave ingest", "schedule"}, "retry-budget", "agent"),
    _r({"failed"}, "running", {"wave ingest"}, "fix-attempt", "agent"),
    _r({"failed"}, "blocked-decision", {"wave ingest"}, "retries-exhausted", "agent"),
    _r({"running"}, "done", {"answers ingest", "status"}, "answers-verified", "manual"),
    _r({"running"}, "running", {"answers ingest"}, "answer-rejected", "manual"),
    _r({"running"}, "done", {"decision resolve", "status"}, "resolution", "decision"),
    _r({"blocked-manual", "blocked-decision"}, "ready", {"decision resolve", "answers ingest"}, "unblocked"),
    _r(NON_TERMINAL - {"cut-proposed"}, "cut-proposed", {"decision propose"}, "cut-proposal"),
    _r({"cut-proposed"}, "cut", {"decision resolve"}, "cut-chosen"),
    *(_r({"cut-proposed"}, prev, {"decision resolve"}, "cut-refused")
      for prev in sorted(NON_TERMINAL - {"cut-proposed"})),
    # SCHEMAS.md 4.2 lists `amend` only; TWO-DEV.md TD-R1 has `status` apply the same row for an amendment pulled
    # from the other executor (and it covers a crash of `amend` between the plan save and the transitions). The
    # evidence is the same plan amendment record either way. Deviation 9, contract question Q-B04-22.
    _r(NON_TERMINAL, "superseded", {"amend", "status"}, "superseded"),
    _r({"failed", "blocked-manual", "blocked-decision"}, "ready", {"task set-status"}, "manual-override"),
)


def _nature_ok(rule: Rule, task: Task) -> bool:
    if rule.nature is None:
        return True
    if rule.nature == "human":
        return task.kind in HUMAN_KINDS
    if rule.nature == "agent":
        return task.kind not in HUMAN_KINDS
    return task.kind == rule.nature


def find_rule(current: str, to: str, command: str, task: Task) -> Rule | None:
    for rule in TRANSITIONS:
        if current in rule.frm and rule.to == to and command in rule.commands and _nature_ok(rule, task):
            return rule
    return None


# --- small readers (shared by lane B04) ---------------------------------------------------------------------------

def entry_of(doc: Mapping[str, Any], task_id: str) -> dict | None:
    return (doc.get("tasks") or {}).get(task_id)


def current_status(doc: Mapping[str, Any], task_id: str) -> str:
    entry = entry_of(doc, task_id)
    return str(entry["status"]) if entry else "planned"


def current_attempt(entry: Mapping[str, Any] | None) -> int:
    """The attempt being run: counted failures + 1 (SCHEMAS.md 4.4)."""
    return int((entry or {}).get("attempts", 0)) + 1


def new_entry(ctx: Ctx) -> dict:
    return {"status": "planned", "since_utc": clock.format_utc(ctx.now), "attempts": 0, "reruns": 0,
            "consecutive_reruns": 0, "history": []}


def _read_json_quiet(path: Path) -> Any | None:
    try:
        return jsonio.read_json_retry(path)
    except FileNotFoundError:
        return None
    except ValidationFailed:
        return None


def decision_headers(layout: Layout) -> list[dict]:
    """The decision block headers of decisions.md (schema-valid ones; identical union echoes read once)."""
    path = layout.decisions
    if not path.exists():
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for line in path.read_bytes().decode("utf-8").split("\n"):
        line = line.rstrip("\r")
        if not line.startswith("<!-- execution-decision ") or not line.endswith(" -->") or line in seen:
            continue
        seen.add(line)
        try:
            doc = json.loads(line[len("<!-- execution-decision "):-len(" -->")])
        except json.JSONDecodeError:
            continue
        if schema.validate(doc, "decision").ok:
            out.append(doc)
    return out


def decision_pair(layout: Layout, decision_id: str) -> tuple[dict | None, dict | None]:
    proposal = resolution = None
    for doc in decision_headers(layout):
        if doc["id"] == decision_id:
            if doc["record"] == "proposal":
                proposal = doc
            elif doc["record"] == "resolution":
                resolution = doc
    return proposal, resolution


def chosen_option(proposal: Mapping[str, Any] | None, resolution: Mapping[str, Any] | None) -> dict | None:
    if not proposal or not resolution:
        return None
    for opt in proposal.get("options") or ():
        if opt.get("id") == resolution.get("choice"):
            return dict(opt)
    return None


def option_targets(option: Mapping[str, Any], op_names: Iterable[str], proposal: Mapping[str, Any],
                   task_id: str) -> bool:
    """True when one of the option's effects named in op_names applies to task_id (an effect without `tasks`
    applies to the proposal's tasks)."""
    names = set(op_names)
    for eff in option.get("effects") or ():
        if eff.get("op") not in names:
            continue
        targets = eff.get("tasks") or proposal.get("tasks") or []
        if task_id in targets:
            return True
    return False


def read_answer(path: Path) -> tuple[dict, str]:
    """An answers/<key>.md file: (header, body). The header is the first fenced ```json block (answer.schema.json),
    the body the verbatim human text after it. ValidationFailed (E_STATE_INVALID) when the format is broken."""
    text = path.read_bytes().decode("utf-8")
    if not text.startswith("```json\n"):
        raise ValidationFailed(f"{posix(path)}: an answer file starts with a ```json fence", code="E_STATE_INVALID")
    end = text.find("\n```\n", len("```json\n") - 1)
    if end < 0:
        raise ValidationFailed(f"{posix(path)}: the ```json fence is not closed", code="E_STATE_INVALID")
    try:
        header = json.loads(text[len("```json\n"):end + 1])
    except json.JSONDecodeError as err:
        raise ValidationFailed(f"{posix(path)}: answer header is not JSON: {err.msg}",
                               code="E_STATE_INVALID") from err
    report = schema.validate(header, "answer")
    if not report.ok:
        raise ValidationFailed(f"{posix(path)}: answer header is invalid: {report.issues[0].message}",
                               code="E_STATE_INVALID")
    body = text[end + len("\n```\n"):]
    if body.startswith("\n"):
        body = body[1:]
    return header, body


def schema_problem(doc: Any, name: str) -> str | None:
    """The first schema issue of `doc` against `name` (e.g. "wave-manifest", "local-state#/$defs/hook_event"), or
    None when valid. For the modules of lane B04 whose MODULES.md 8 edges give them no `schema` edge."""
    report = schema.validate(doc, name)
    return None if report.ok else f"{report.issues[0].instance_path or '/'}: {report.issues[0].message}"


def check_answer_header(header: Mapping[str, Any]) -> None:
    """ValidationFailed (E_SCHEMA) unless the header validates against answer.schema.json."""
    report = schema.validate(dict(header), "answer")
    if not report.ok:
        raise ValidationFailed(f"answer header invalid: {report.issues[0].message}", code="E_SCHEMA",
                               items=[ErrorItem("E_SCHEMA", i.message, path=i.instance_path or "/")
                                      for i in report.issues[:10]])


def answers_of(layout: Layout, task_id: str) -> list[tuple[Path, dict]]:
    """Every readable answer file of the task (header only), in key order."""
    folder = layout.state / "answers"
    out: list[tuple[Path, dict]] = []
    if not folder.is_dir():
        return out
    for path in sorted(folder.glob("*.md")):
        try:
            header, _body = read_answer(path)
        except ValidationFailed:
            continue
        if header.get("task") == task_id:
            out.append((path, header))
    return out


def _wave_num(name: str) -> int:
    try:
        return int(name[1:])
    except ValueError:
        return -1


def merge_receipts(layout: Layout, task_id: str, *, attempt: int | None = None, tracked: bool = False
                   ) -> list[tuple[Path, dict]]:
    """Merge receipts of the task found in ANY wave's results (newest wave first), or the tracked copies under
    proofs/merge/ when `tracked`. Schema-valid documents only."""
    found: list[tuple[Path, dict]] = []
    if tracked:
        folder = layout.state / "proofs" / "merge"
        candidates = sorted(folder.glob(f"{task_id}.a*.json")) if folder.is_dir() else []
    else:
        root = layout.local / "results"
        candidates = []
        if root.is_dir():
            for wave_dir in sorted((d for d in root.iterdir() if d.is_dir()), key=lambda d: -_wave_num(d.name)):
                candidates += sorted(wave_dir.glob(f"{task_id}.merge.a*.json"))
    for path in candidates:
        doc = _read_json_quiet(path)
        if not isinstance(doc, dict) or doc.get("task") != task_id:
            continue
        if not schema.validate(doc, "merge-receipt").ok:
            continue
        if attempt is not None and doc.get("attempt") != attempt:
            continue
        found.append((path, doc))
    return found


def landed_merge(layout: Layout, task_id: str, attempt: int | None = None, *, tracked: bool = False
                 ) -> tuple[Path, dict] | None:
    """The latest `outcome: landed` merge receipt of (task, attempt) by (attempt, rerun, finished_utc)."""
    landed = [(p, d) for p, d in merge_receipts(layout, task_id, attempt=attempt, tracked=tracked)
              if d.get("outcome") == "landed" and d.get("landed_sha")]
    if not landed:
        return None
    landed.sort(key=lambda pd: (int(pd[1]["attempt"]), int(pd[1].get("rerun", 0)), str(pd[1]["finished_utc"])))
    return landed[-1]


def proof_runs(layout: Layout, task_id: str, *, tracked: bool | None = None) -> list[tuple[Path, dict]]:
    """Proof-run documents of the task: local/proof-runs/<task>/*/run.json and/or proofs/runs/<task>/*.json."""
    paths: list[Path] = []
    if tracked in (None, False):
        local = layout.local / "proof-runs" / task_id
        if local.is_dir():
            paths += sorted(local.glob("*/run.json"))
    if tracked in (None, True):
        copies = layout.state / "proofs" / "runs" / task_id
        if copies.is_dir():
            paths += sorted(copies.glob("*.json"))
    out: list[tuple[Path, dict]] = []
    for path in paths:
        doc = _read_json_quiet(path)
        if isinstance(doc, dict) and doc.get("task") == task_id and schema.validate(doc, "proof-run").ok:
            out.append((path, doc))
    return out


def find_run(layout: Layout, task_id: str, run_id: str, *, tracked: bool | None = None) -> dict | None:
    for _path, doc in proof_runs(layout, task_id, tracked=tracked):
        if doc.get("run_id") == run_id:
            return doc
    return None


def load_receipt(layout: Layout, task_id: str) -> dict | None:
    doc = _read_json_quiet(layout.receipt(task_id))
    return doc if isinstance(doc, dict) else None


def manifest(layout: Layout, wave: str) -> dict | None:
    doc = _read_json_quiet(layout.wave_manifest(wave))
    return doc if isinstance(doc, dict) else None


def manifest_task(man: Mapping[str, Any] | None, task_id: str) -> dict | None:
    for item in (man or {}).get("tasks") or ():
        if item.get("task") == task_id:
            return dict(item)
    return None


# --- the evidence vocabulary of `transition` (contract question Q-B04-21) -----------------------------------------
#
# MODULES.md types `evidence` as list[str] and leaves the items' shape open. Every row reads its proof from files on
# disk; the evidence list only tells the check WHICH file or decision to read when that cannot be derived. This is
# the complete vocabulary, one entry per evidence family of TRANSITIONS: the items a caller passes, `<…>` being
# the value. A family with no item derives everything from disk (the status entry, the plan, receipts, proof runs).
# Items a check finds itself (a merge-receipt path, a proof-run path, proofs/<task>.json, decision:<id>) are
# appended to the history record. Callers build items with `evidence_item(prefix, value)`.
EVIDENCE: Mapping[str, tuple[str, ...]] = {
    "deps-done": ("release:<utc> (an anchored task without release_utc: the instant `schedule` computed)",),
    "deps-undone": (),
    "approval-task": ("decision:<D-nnn> or the bare <D-nnn>: the open approval proposal",),
    "launch-intent": ("launch-intent:<Wnnn>: the manifest written with status launching",),
    "in-wave": ("launch-intent:<Wnnn>", "release:<utc> (anchored task)"),
    "posted": ("posted:<utc> (the instant `manual post` recorded the push; the check reads the entry's `posted`)",),
    "back-to-ready": ("launch-failed:<Wnnn> (manifest status launch-failed)",
                      "abandoned:<Wnnn> (manifest status abandoned)",
                      "rerun:<Wnnn> (agent result null or missing; reruns + 1)"),
    "skipped-dep": ("skipped-dep:<Wnnn>",),
    "landed": (),
    "attempt-failed": ("<state-relative path of <task>.implementer.a<n>.json with status failed>",
                       "<state-relative path of <task>.merge.a<n>.json with a failed outcome>"),
    "blocked-manual": ("<state-relative path of the implementer result, blocked.kind manual>",
                       "decision:<D-nnn> (kind spec-gap or plan-task)"),
    "blocked-decision": ("<implementer result path, blocked.kind decision> with decision:<D-nnn>",
                         "infra-error:<Wnnn> with decision:<D-nnn> (kind dependency-missing)",
                         "retry-exhausted:<Wnnn> with decision:<D-nnn> (kind retry-exhausted)"),
    "verifier-run": (),
    "done-check": (),
    "fail-receipt": (),
    "retry-budget": (),
    "fix-attempt": ("fix-attempt:<Wnnn>",),
    "retries-exhausted": ("decision:<D-nnn> (kind retry-exhausted)",),
    "answers-verified": (),
    "answer-rejected": ("answers/<key>.md (the rejected answer)",),
    "resolution": (),
    "unblocked": ("answers/<key>.md (a verified answer, blocked-manual), else the entry's resolved decision",),
    "cut-proposal": ("decision:<D-nnn> (kind cut, listing the task)",),
    "cut-chosen": (),
    "cut-refused": (),
    "superseded": ("amendment:<plan_version>:<D-nnn> (TWO-DEV.md TD-R1)",),
    "manual-override": ("decision:<D-nnn> (resolved)", "reason:<text>"),
}
EVIDENCE_PREFIXES: frozenset[str] = frozenset({"release", "decision", "launch-intent", "launch-failed", "abandoned",
                                               "rerun", "skipped-dep", "infra-error", "retry-exhausted",
                                               "fix-attempt", "amendment", "reason", "posted"})
_DECISION_ID = re.compile(r"^D-[0-9]{3,}$")


def evidence_item(prefix: str, value: str) -> str:
    """One evidence item of the vocabulary above, e.g. evidence_item("launch-intent", "W003")."""
    if prefix not in EVIDENCE_PREFIXES:
        raise InternalError(f"unknown evidence prefix {prefix!r}", code="E_INTERNAL")
    return f"{prefix}:{value}"


def normalize_evidence(evidence: Iterable[str]) -> list[str]:
    """The caller's items in canonical form: a bare decision id `D-nnn` is `decision:D-nnn` (the shape lane B02's
    `plan instantiate` passes); paths use forward slashes; empty items are dropped."""
    out: list[str] = []
    for raw in evidence:
        item = str(raw).strip()
        if not item:
            continue
        if _DECISION_ID.match(item):
            item = f"decision:{item}"
        elif item.split(":", 1)[0] not in EVIDENCE_PREFIXES:
            item = item.replace("\\", "/")
        if item not in out:
            out.append(item)
    return out


def evidence_value(evidence: Sequence[str], prefix: str) -> str | None:
    for item in evidence:
        if item.startswith(prefix + ":"):
            return item[len(prefix) + 1:]
        if prefix == "decision" and _DECISION_ID.match(item):
            return item
    return None


def product_git(layout: Layout) -> Git | None:
    """A Git handle on the product repository when one is known and has an `origin` remote."""
    if layout.repo is None or not (Path(layout.repo) / ".git").exists():
        return None
    return Git(Path(layout.repo))


def on_origin_main(git: Git | None, sha: str) -> tuple[bool, str]:
    if git is None:
        return False, "no product repository to check the SHA against origin/main"
    try:
        ok = git.is_ancestor(sha, "origin/main")
    except GitError as err:
        return False, f"git could not check {sha[:8]} against origin/main: {err.message}"
    return ok, "" if ok else f"{sha[:8]} is not an ancestor of origin/main"


# --- file proofs evaluated by exec.py (SCHEMAS.md 3.3; manual and decision tasks) ---------------------------------

def _pointer_get(doc: Any, pointer: str) -> tuple[bool, Any]:
    if pointer in ("", "/"):
        return True, doc
    cur = doc
    for raw in pointer.lstrip("/").split("/"):
        part = raw.replace("~1", "/").replace("~0", "~")
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return False, None
    return True, cur


def _expand(doc: Any, pointer: str) -> list[tuple[str, bool, Any]]:
    """Values at a pointer whose `*` segments mean every item of an array."""
    if pointer in ("", "/"):
        return [("", True, doc)]
    parts = pointer.lstrip("/").split("/")
    current: list[tuple[str, Any]] = [("", doc)]
    out_missing: list[tuple[str, bool, Any]] = []
    for part in parts:
        nxt: list[tuple[str, Any]] = []
        for where, value in current:
            if part == "*":
                if isinstance(value, list):
                    nxt += [(f"{where}/{i}", v) for i, v in enumerate(value)]
                else:
                    out_missing.append((f"{where}/*", False, None))
                continue
            ok, child = _pointer_get(value, "/" + part)
            if ok:
                nxt.append((f"{where}/{part}", child))
            else:
                out_missing.append((f"{where}/{part}", False, None))
        current = nxt
    return [(w, True, v) for w, v in current] + out_missing


def _check_one(check: Mapping[str, Any], base_value: Any) -> list[str]:
    kind = check.get("check")
    problems: list[str] = []
    for where, found, value in _expand(base_value, str(check.get("pointer", ""))):
        label = where or "/"
        if kind == "min-items":
            if not found or not isinstance(value, list):
                problems.append(f"{label}: not an array")
                continue
            where_eq = check.get("where") or {}
            count = sum(1 for item in value if isinstance(item, dict)
                        and all(schema.json_equal(item.get(k), v) for k, v in where_eq.items()))
            if count < int(check.get("value", 0)):
                problems.append(f"{label}: {count} matching items, {check.get('value')} required")
            continue
        if not found:
            problems.append(f"{label}: missing")
            continue
        if kind == "utc":
            if not (isinstance(value, str) and _EXACT_UTC.match(value)):
                problems.append(f"{label}: not a UTC instant")
        elif kind == "enum":
            if not any(schema.json_equal(value, v) for v in check.get("values") or ()):
                problems.append(f"{label}: not one of the allowed values")
        elif kind == "non-empty":
            if not (isinstance(value, (str, list)) and len(value) > 0 and (not isinstance(value, str)
                                                                            or value.strip())):
                problems.append(f"{label}: empty")
        elif kind == "url":
            if not (isinstance(value, str) and re.match(r"^https?://\S+$", value)):
                problems.append(f"{label}: not an http(s) URL")
        elif kind == "equals":
            if not schema.json_equal(value, check.get("value")):
                problems.append(f"{label}: not equal to the expected value")
        elif kind == "dir-exists":
            base = check.get("base")
            if not (isinstance(value, str) and value and base and "/" not in value and "\\" not in value
                    and value not in (".", "..") and (Path(str(base)) / value).is_dir()):
                problems.append(f"{label}: no directory of that name under the base")
        else:
            problems.append(f"{label}: unknown check {kind!r}")
    return problems


def evaluate_file_proof(spec: Mapping[str, Any], *, base_dir: Path | None = None) -> tuple[bool, list[str]]:
    """A `file` proof spec evaluated by exec.py (path, must_match, json_pointer, json_equals, min_bytes,
    json_checks). Returns (ok, details). A relative path is resolved against base_dir (the product checkout)."""
    raw_path = str(spec.get("path", ""))
    path = Path(raw_path)
    if not path.is_absolute():
        if base_dir is None:
            return False, [f"{raw_path}: a repository-relative file proof needs a checkout"]
        path = Path(base_dir) / raw_path
    if not path.is_file():
        return False, [f"{posix(path)}: file absent"]
    data = path.read_bytes()
    details: list[str] = []
    if spec.get("min_bytes") is not None and len(data) < int(spec["min_bytes"]):
        details.append(f"{posix(path)}: {len(data)} bytes, at least {spec['min_bytes']} required")
    if spec.get("must_match"):
        try:
            if not re.search(str(spec["must_match"]), data.decode("utf-8", errors="replace")):
                details.append(f"{posix(path)}: must_match not found")
        except re.error as err:
            details.append(f"must_match is not a valid regex: {err}")
    needs_json = any(k in spec for k in ("json_pointer", "json_equals", "json_checks"))
    if needs_json:
        try:
            doc = json.loads(data.decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False, details + [f"{posix(path)}: not JSON"]
        found, value = _pointer_get(doc, str(spec.get("json_pointer", "")))
        if not found:
            return False, details + [f"{spec.get('json_pointer')}: pointer not found"]
        if "json_equals" in spec and not schema.json_equal(value, spec["json_equals"]):
            details.append(f"{spec.get('json_pointer')}: value differs from json_equals")
        for check in spec.get("json_checks") or ():
            details += _check_one(check, value)
    return (not details), (details or [f"{posix(path)}: file proof ok"])


def file_proof_status(task: Task) -> tuple[bool, list[str]]:
    """(ok, details) of a manual/decision task's file proof; tasks without one are ok."""
    if (task.proof or {}).get("type") != "file":
        return True, ["no file proof"]
    return evaluate_file_proof(task.proof.get("spec") or {})


# --- evidence checks (one per row family; each returns the problems, [] = evidence present) ----------------------

@dataclass
class _Env:
    ctx: Ctx
    doc: dict
    task: Task
    entry: dict
    evidence: list[str]
    plan: PlanModel | None
    git: Git | None
    to: str


def _plan(env: _Env) -> PlanModel:
    if env.plan is None:
        env.plan = planmod.load(env.ctx.layout)
    return env.plan


def _dep_status(env: _Env, dep: str) -> str:
    plan = _plan(env)
    dep_task = plan.by_id.get(dep)
    if dep_task is None:
        return "missing"
    if dep_task.executor == env.doc.get("executor"):
        return current_status(env.doc, dep)
    other = statusio.load(env.ctx.layout, dep_task.executor)
    return current_status(other, dep)


def _release_ok(env: _Env) -> list[str]:
    t = env.task
    if t.anchor is not None and t.release is None:
        rel = evidence_value(env.evidence, "release")
        if rel is None:
            return ["an anchored task needs the computed release instant (evidence release:<utc>, from schedule)"]
        if clock.parse_utc(rel) > env.ctx.now:
            return [f"release {rel} is in the future"]
        return []
    if t.release is not None and t.release > env.ctx.now:
        return [f"release {clock.format_utc(t.release)} is in the future"]
    return []


def _ev_deps_done(env: _Env) -> list[str]:
    plan = _plan(env)
    problems = [] if plan.approved else ["the plan is not approved"]
    for dep in env.task.depends_on:
        st = _dep_status(env, dep)
        if st != "done":
            problems.append(f"dependency {dep} is {st}")
            continue
        dep_task = plan.by_id[dep]
        if dep_task.executor != env.doc.get("executor"):
            other = statusio.load(env.ctx.layout, dep_task.executor)
            ts = statusio.state_of(dep, {dep_task.executor: other}, plan)
            items = check_done_evidence(env.ctx.layout, plan, dep_task, ts, env.git, profile="cross")
            problems += [f"cross-executor dependency {dep}: {i.message}" for i in items]
    return problems + _release_ok(env)


def _ev_deps_undone(env: _Env) -> list[str]:
    if any(_dep_status(env, d) != "done" for d in env.task.depends_on):
        return []
    if env.task.release is not None and env.task.release > env.ctx.now:
        return []
    return ["every dependency is done and the release is past"]


def _ev_approval_task(env: _Env) -> list[str]:
    if env.task.template != "execution:EX-APPROVE":
        return ["only the execution:EX-APPROVE task runs before approval"]
    did = evidence_value(env.evidence, "decision")
    proposal, resolution = decision_pair(env.ctx.layout, did or "")
    if not proposal or proposal.get("kind") != "approval" or resolution is not None:
        return [f"no open approval proposal {did}"]
    env.entry["decision"] = did
    return []


def _launching_manifest(env: _Env, prefix: str) -> tuple[dict | None, dict | None, list[str]]:
    wave = evidence_value(env.evidence, prefix)
    man = manifest(env.ctx.layout, wave or "") if wave else None
    if man is None:
        return None, None, [f"no wave manifest for evidence {prefix}:{wave}"]
    if man.get("status") != "launching":
        return man, None, [f"wave {wave} is {man.get('status')}, not launching"]
    item = manifest_task(man, env.task.id)
    if item is None:
        return man, None, [f"wave {wave} does not list {env.task.id}"]
    return man, item, []


def _ev_launch_intent(env: _Env) -> list[str]:
    man, item, problems = _launching_manifest(env, "launch-intent")
    if not problems and man is not None:
        env.entry["wave"] = man["wave"]
        env.entry["lane"] = item.get("lane") if item else None
    return problems


def _ev_in_wave(env: _Env) -> list[str]:
    man, item, problems = _launching_manifest(env, "launch-intent")
    if problems or item is None or man is None:
        return problems
    in_wave = set(item.get("deps_in_wave") or ())
    for dep in env.task.depends_on:
        if dep not in in_wave and _dep_status(env, dep) != "done":
            problems.append(f"dependency {dep} is neither done nor in the wave")
    problems += _release_ok(env)
    if not problems:
        env.entry["wave"] = man["wave"]
        env.entry["lane"] = item.get("lane")
    return problems


def _ev_posted(env: _Env) -> list[str]:
    return [] if env.entry.get("posted") else ["the task was not posted (no push text recorded)"]


def _ev_back_to_ready(env: _Env) -> list[str]:
    for prefix, status_needed in (("launch-failed", "launch-failed"), ("abandoned", "abandoned")):
        wave = evidence_value(env.evidence, prefix)
        if wave is not None:
            man = manifest(env.ctx.layout, wave)
            if man is None or man.get("status") != status_needed:
                return [f"wave {wave} is not {status_needed}"]
            return []
    wave = evidence_value(env.evidence, "rerun")
    if wave is None:
        return ["no launch-failed, abandoned or rerun evidence"]
    attempt = current_attempt(env.entry)
    if landed_merge(env.ctx.layout, env.task.id, attempt) is not None:
        return [f"attempt {attempt} has a landed merge receipt: the task is built, not a rerun"]
    env.entry["reruns"] = int(env.entry.get("reruns", 0)) + 1
    env.entry["consecutive_reruns"] = int(env.entry.get("consecutive_reruns", 0)) + 1
    return []


def _ev_skipped_dep(env: _Env) -> list[str]:
    wave = evidence_value(env.evidence, "skipped-dep")
    item = manifest_task(manifest(env.ctx.layout, wave or ""), env.task.id) if wave else None
    if item is None:
        return [f"wave {wave} does not list {env.task.id}"]
    in_wave = list(item.get("deps_in_wave") or ())
    if not in_wave:
        return ["the task has no in-wave dependency"]
    if all(_dep_status(env, d) == "done" for d in in_wave):
        return ["every in-wave dependency ended done"]
    return []


def _ev_landed(env: _Env) -> list[str]:
    attempt = current_attempt(env.entry)
    found = landed_merge(env.ctx.layout, env.task.id, attempt)
    if found is None:
        return [f"no landed merge receipt for {env.task.id} attempt {attempt} in any wave"]
    path, doc = found
    ok, why = on_origin_main(env.git, str(doc["landed_sha"]))
    if not ok:
        return [why]
    env.entry["landed_sha"] = doc["landed_sha"]
    env.entry["consecutive_reruns"] = 0
    rel = env.ctx.layout.rel(path)
    if rel not in env.evidence:
        env.evidence.append(rel)
    return []


def _result_doc(env: _Env, role: str) -> tuple[str, dict] | None:
    for item in env.evidence:
        if item.endswith(".json") and f".{role}." in item:
            doc = _read_json_quiet(env.ctx.layout.state / item)
            if isinstance(doc, dict) and doc.get("task") == env.task.id:
                return item, doc
    return None


def _ev_attempt_failed(env: _Env) -> list[str]:
    impl = _result_doc(env, "implementer")
    if impl and impl[1].get("status") == "failed":
        return _count_failure(env)
    merge = _result_doc(env, "merge")
    if merge and merge[1].get("outcome") in FAILED_MERGE_OUTCOMES:
        return _count_failure(env)
    return ["no implementer result with status failed and no failed merge receipt in the evidence"]


def _count_failure(env: _Env) -> list[str]:
    env.entry["attempts"] = int(env.entry.get("attempts", 0)) + 1
    env.entry["consecutive_reruns"] = 0
    return []


def _proposal_of(env: _Env, kinds: Iterable[str]) -> tuple[str | None, list[str]]:
    did = evidence_value(env.evidence, "decision")
    proposal, _res = decision_pair(env.ctx.layout, did or "")
    if proposal is None or proposal.get("kind") not in set(kinds):
        return None, [f"no proposal {did} of kind {'/'.join(sorted(kinds))}"]
    return did, []


def _ev_blocked_manual(env: _Env) -> list[str]:
    impl = _result_doc(env, "implementer")
    if not impl or (impl[1].get("blocked") or {}).get("kind") != "manual":
        return ["no implementer result blocked on a manual step"]
    did, problems = _proposal_of(env, ("spec-gap", "plan-task"))
    if not problems:
        env.entry["decision"] = did
        env.entry["blocked"] = {"kind": "manual", "reason": impl[1]["blocked"]["reason"],
                                "needed": impl[1]["blocked"].get("needed", "")}
    return problems


def _ev_blocked_decision(env: _Env) -> list[str]:
    impl = _result_doc(env, "implementer")
    if impl and (impl[1].get("blocked") or {}).get("kind") == "decision":
        did, problems = _proposal_of(env, ("spec-gap", "plan-task", "amendment", "scope-change", "other"))
        reason = impl[1]["blocked"]["reason"]
        kind = "decision"
    elif evidence_value(env.evidence, "infra-error") is not None:
        did, problems = _proposal_of(env, ("dependency-missing",))
        reason, kind = f"infra-error in wave {evidence_value(env.evidence, 'infra-error')}", "dependency"
    elif evidence_value(env.evidence, "retry-exhausted") is not None:
        if int(env.entry.get("consecutive_reruns", 0)) + 1 < RERUN_CAP:
            return [f"consecutive reruns {env.entry.get('consecutive_reruns', 0)} + 1 is below {RERUN_CAP}"]
        did, problems = _proposal_of(env, ("retry-exhausted",))
        reason, kind = "relances épuisées", "retry-exhausted"
        if not problems:
            env.entry["reruns"] = int(env.entry.get("reruns", 0)) + 1
            env.entry["consecutive_reruns"] = int(env.entry.get("consecutive_reruns", 0)) + 1
    else:
        return ["no blocked implementer result, infra-error or retry-exhausted evidence"]
    if not problems:
        env.entry["decision"] = did
        env.entry["blocked"] = {"kind": kind, "reason": reason}
    return problems


def _ev_verifier_run(env: _Env) -> list[str]:
    sha = env.entry.get("landed_sha")
    if not sha:
        return ["no landed_sha in the status entry"]
    for path, doc in proof_runs(env.ctx.layout, env.task.id):
        if doc.get("sha") == sha and (doc.get("by") or {}).get("role") == "verifier":
            rel = env.ctx.layout.rel(path)
            if rel not in env.evidence:
                env.evidence.append(rel)
            return []
    return [f"no verifier proof run of {str(sha)[:8]}"]


def _ev_done_check(env: _Env) -> list[str]:
    ts = TaskState(status=str(env.entry.get("status")), since=env.ctx.now,
                   attempts=int(env.entry.get("attempts", 0)), reruns=int(env.entry.get("reruns", 0)),
                   raw=env.entry)
    items = check_done_evidence(env.ctx.layout, _plan(env), env.task, ts, env.git,
                                executor=str(env.doc.get("executor")))
    if items:
        return [i.message for i in items]
    env.entry["receipt"] = f"proofs/{env.task.id}.json"
    env.entry["consecutive_reruns"] = 0
    if f"proofs/{env.task.id}.json" not in env.evidence:
        env.evidence.append(f"proofs/{env.task.id}.json")
    return []


def _ev_fail_receipt(env: _Env) -> list[str]:
    receipt = load_receipt(env.ctx.layout, env.task.id)
    if not receipt or receipt.get("verdict") != "fail" or receipt.get("sha") != env.entry.get("landed_sha"):
        return ["no fail receipt for the landed SHA"]
    env.entry["receipt"] = f"proofs/{env.task.id}.json"
    return _count_failure(env)


def _ev_retry_budget(env: _Env) -> list[str]:
    attempts = int(env.entry.get("attempts", 0))
    if attempts >= env.task.max_attempts:
        return [f"attempts {attempts} >= max_attempts {env.task.max_attempts}"]
    env.entry["landed_sha"] = None
    return []


def _ev_fix_attempt(env: _Env) -> list[str]:
    wave = evidence_value(env.evidence, "fix-attempt")
    item = manifest_task(manifest(env.ctx.layout, wave or ""), env.task.id) if wave else None
    attempt = current_attempt(env.entry)
    if item is None or attempt not in (item.get("fix_attempts") or ()):
        return [f"wave {wave} prepared no fix attempt {attempt} for {env.task.id}"]
    results = env.ctx.layout.local / "results" / str(wave)
    names = [f"{env.task.id}.implementer.a{attempt}.json", f"{env.task.id}.merge.a{attempt}.json"]
    if not any((results / n).is_file() for n in names):
        return [f"no result or merge receipt of attempt {attempt} in wave {wave}"]
    env.entry["landed_sha"] = None
    return []


def _ev_retries_exhausted(env: _Env) -> list[str]:
    attempts = int(env.entry.get("attempts", 0))
    if attempts < env.task.max_attempts:
        return [f"attempts {attempts} < max_attempts {env.task.max_attempts}"]
    did, problems = _proposal_of(env, ("retry-exhausted",))
    if not problems:
        env.entry["decision"] = did
        env.entry["blocked"] = {"kind": "retry-exhausted", "reason": f"{attempts} attempts failed"}
    return problems


def _ev_answers_verified(env: _Env) -> list[str]:
    manual = env.task.manual or {}
    answers = answers_of(env.ctx.layout, env.task.id)
    problems: list[str] = []
    last: str | None = None
    for bb in manual.get("bring_back") or ():
        ok = [(p, h) for p, h in answers if h.get("bring_back_key") == bb["key"] and h["verification"]["ok"]]
        if not ok:
            problems.append(f"bring_back {bb['key']}: no verified answer")
        else:
            last = env.ctx.layout.rel(ok[-1][0])
            if last not in env.evidence:
                env.evidence.append(last)
    fp_ok, details = file_proof_status(env.task)
    if not fp_ok:
        problems += [f"file proof: {d}" for d in details]
    if not problems and last:
        env.entry["answer"] = last
    return problems


def _ev_answer_rejected(env: _Env) -> list[str]:
    for item in env.evidence:
        if item.startswith("answers/"):
            try:
                header, _b = read_answer(env.ctx.layout.state / item)
            except (ValidationFailed, FileNotFoundError):
                continue
            if header.get("task") == env.task.id and not header["verification"]["ok"]:
                return []
    return ["no rejected answer of this task in the evidence"]


def _ev_resolution(env: _Env) -> list[str]:
    did = env.entry.get("decision")
    proposal, resolution = decision_pair(env.ctx.layout, str(did or ""))
    if not resolution or not resolution.get("quote") or chosen_option(proposal, resolution) is None:
        return [f"decision {did} has no resolution with a quote and a valid option"]
    fp_ok, details = file_proof_status(env.task)
    if not fp_ok:
        return [f"file proof: {d}" for d in details]
    if f"decision:{did}" not in env.evidence:
        env.evidence.append(f"decision:{did}")
    return []


def _ev_unblocked(env: _Env) -> list[str]:
    for item in env.evidence:
        if item.startswith("answers/") and env.entry.get("status") == "blocked-manual":
            try:
                header, _b = read_answer(env.ctx.layout.state / item)
            except (ValidationFailed, FileNotFoundError):
                continue
            if header["verification"]["ok"]:
                env.entry["blocked"] = None
                return []
    did = env.entry.get("decision")
    proposal, resolution = decision_pair(env.ctx.layout, str(did or ""))
    option = chosen_option(proposal, resolution)
    if option is None or proposal is None:
        return [f"the attached decision {did} is not resolved"]
    if not option_targets(option, UNBLOCKING_OPS, proposal, env.task.id):
        return [f"decision {did} resolved with {option['id']}, which does not unblock {env.task.id}"]
    env.entry["blocked"] = None
    if any(e.get("op") == "retry-task" for e in option.get("effects") or ()):
        env.entry["consecutive_reruns"] = 0
    return []


def _ev_cut_proposal(env: _Env) -> list[str]:
    did, problems = _proposal_of(env, ("cut",))
    if problems:
        return problems
    proposal, _res = decision_pair(env.ctx.layout, str(did))
    if env.task.id not in (proposal or {}).get("tasks", []):
        return [f"proposal {did} does not list {env.task.id}"]
    env.entry["previous_status"] = env.entry.get("status")
    env.entry["decision"] = did
    return []


def _ev_cut_chosen(env: _Env) -> list[str]:
    did = env.entry.get("decision")
    proposal, resolution = decision_pair(env.ctx.layout, str(did or ""))
    option = chosen_option(proposal, resolution)
    if option is None or proposal is None or not option_targets(option, ("cut-tasks",), proposal, env.task.id):
        return [f"decision {did} did not choose to cut {env.task.id}"]
    return []


def _ev_cut_refused(env: _Env) -> list[str]:
    did = env.entry.get("decision")
    proposal, resolution = decision_pair(env.ctx.layout, str(did or ""))
    option = chosen_option(proposal, resolution)
    if option is None or proposal is None:
        return [f"decision {did} is not resolved"]
    if option_targets(option, ("cut-tasks",), proposal, env.task.id):
        return [f"decision {did} chose to cut {env.task.id}"]
    if env.entry.get("previous_status") != env.to:
        return [f"the saved previous status is {env.entry.get('previous_status')}, not {env.to}"]
    env.entry["previous_status"] = None
    return []


def _ev_superseded(env: _Env) -> list[str]:
    value = evidence_value(env.evidence, "amendment")
    if not value or ":" not in value:
        return ["no amendment:<version>:<decision> evidence"]
    version_text, decision = value.split(":", 1)
    for record in _plan(env).raw.get("amendments") or ():
        if str(record.get("plan_version")) == version_text and record.get("decision") == decision \
                and env.task.id in (record.get("superseded") or ()):
            return []
    return [f"amendment v{version_text} ({decision}) does not supersede {env.task.id}"]


def _ev_manual_override(env: _Env) -> list[str]:
    did = evidence_value(env.evidence, "decision")
    _proposal, resolution = decision_pair(env.ctx.layout, did or "")
    problems = [] if resolution is not None else [f"decision {did} is not resolved"]
    reason = evidence_value(env.evidence, "reason")
    if not reason or not reason.strip():
        problems.append("a reason is required")
    if not problems:
        env.entry["blocked"] = None
        env.entry["decision"] = did
    return problems


_CHECKS: Mapping[str, Callable[[_Env], list[str]]] = {
    "deps-done": _ev_deps_done, "deps-undone": _ev_deps_undone, "approval-task": _ev_approval_task,
    "launch-intent": _ev_launch_intent, "in-wave": _ev_in_wave, "posted": _ev_posted,
    "back-to-ready": _ev_back_to_ready, "skipped-dep": _ev_skipped_dep, "landed": _ev_landed,
    "attempt-failed": _ev_attempt_failed, "blocked-manual": _ev_blocked_manual,
    "blocked-decision": _ev_blocked_decision, "verifier-run": _ev_verifier_run, "done-check": _ev_done_check,
    "fail-receipt": _ev_fail_receipt, "retry-budget": _ev_retry_budget, "fix-attempt": _ev_fix_attempt,
    "retries-exhausted": _ev_retries_exhausted, "answers-verified": _ev_answers_verified,
    "answer-rejected": _ev_answer_rejected, "resolution": _ev_resolution, "unblocked": _ev_unblocked,
    "cut-proposal": _ev_cut_proposal, "cut-chosen": _ev_cut_chosen, "cut-refused": _ev_cut_refused,
    "superseded": _ev_superseded, "manual-override": _ev_manual_override,
}


def transition(ctx: Ctx, doc: dict, task: Task, to: str, *, evidence: list[str], reason: str | None = None,
               plan: PlanModel | None = None, git: Git | None = None) -> dict:
    """Apply one row of SCHEMAS.md 4.2 to `doc` (the caller's own status document, saved by the caller under the
    state lock). Returns the new entry. `evidence` uses the vocabulary of EVIDENCE (normalised first). Refused with
    TransitionRefused (exit 4) when no row matches or its evidence is absent; `doc` is then unchanged. Called
    without the state lock: InternalError (E_INTERNAL, exit 3), a caller bug."""
    if not holds_state_lock():
        raise InternalError("status.transition requires the state lock (a caller bug, never the owner's)",
                            code="E_INTERNAL")
    if to not in ALL_STATUSES:
        raise UsageError(f"unknown task status {to!r}")
    if doc.get("executor") != task.executor:
        raise TransitionRefused(f"{task.id} belongs to executor {task.executor}, not {doc.get('executor')}",
                                code="E_TRANSITION_REFUSED", hint="each orchestrator moves only its own tasks")
    current = current_status(doc, task.id)
    rule = find_rule(current, to, ctx.command, task)
    if rule is None:
        raise TransitionRefused(f"{task.id}: {current} -> {to} is not a transition '{ctx.command}' may perform",
                                code="E_TRANSITION_REFUSED", hint="see SCHEMAS.md 4.2")
    entry = copy.deepcopy(entry_of(doc, task.id) or new_entry(ctx))
    env = _Env(ctx=ctx, doc=doc, task=task, entry=entry, evidence=normalize_evidence(evidence), plan=plan, git=git,
               to=to)
    problems = _CHECKS[rule.evidence](env)
    if problems:
        raise TransitionRefused(f"{task.id}: {current} -> {to} refused, evidence missing: {problems[0]}",
                                code="E_TRANSITION_REFUSED",
                                items=[ErrorItem("E_TRANSITION_REFUSED", p, task=task.id) for p in problems[:20]])
    at = clock.format_utc(ctx.now)
    record: dict[str, Any] = {"from": current, "to": to, "at_utc": at, "by": ctx.command,
                              "evidence": [e for e in env.evidence if e] or [rule.evidence]}
    if reason:
        record["reason"] = reason
    entry["status"] = to
    entry["since_utc"] = at
    entry.setdefault("history", []).append(record)
    doc.setdefault("tasks", {})[task.id] = entry
    data: dict[str, Any] = {"task": task.id, "from": current, "to": to, "evidence": record["evidence"]}
    if reason:
        data["reason"] = reason
    events.append(ctx, "task.status", data)
    return entry


def with_command(ctx: Ctx, command: str) -> Ctx:
    """The same context acting as another subcommand (internal steps, e.g. proof verdict's own transitions)."""
    return replace(ctx, command=command)


# --- the done check (SCHEMAS.md 4.3) ------------------------------------------------------------------------------

def _nc_required(task: Task) -> bool:
    nc = (task.proof or {}).get("negative_control") or {}
    return nc.get("kind") not in (None, "not-applicable") and task.kind in _NC_KINDS


def _item(n: int, message: str, task: str, code: str = "E_TRANSITION_REFUSED") -> ErrorItem:
    return ErrorItem(code, f"done condition {n}: {message}", path=f"SCHEMAS.md 4.3/{n}", task=task)


def check_done_evidence(layout: Layout, plan: PlanModel, task: Task, ts: TaskState, git: Git | None, *,
                        profile: str | None = None, executor: str | None = None) -> list[ErrorItem]:
    """SCHEMAS.md 4.3, re-read at call time. `profile` local (machine-local results and proof runs) or cross (the
    tracked copies the other machine's `proof verdict` committed); default: cross when the task's executor is not
    this machine's executor. Manual and decision tasks: their answers or resolution, plus the file proof."""
    tid = task.id
    if task.kind in HUMAN_KINDS:
        return _human_done(layout, task, ts)
    if profile is None:
        mine = executor
        if mine is None:
            local = _read_json_quiet(layout.local_state)
            mine = local.get("executor") if isinstance(local, dict) else None
        profile = "local" if mine == task.executor else "cross"
    tracked = profile == "cross"
    items: list[ErrorItem] = []
    receipt = load_receipt(layout, tid)
    # 1. receipt valid, verdict pass
    if receipt is None:
        return [_item(1, f"proofs/{tid}.json is missing", tid)]
    report = schema.validate(receipt, "proof-receipt")
    if not report.ok:
        items.append(_item(1, f"proofs/{tid}.json is invalid: {report.issues[0].instance_path}: "
                              f"{report.issues[0].message}", tid))
        if not (isinstance(receipt.get("sha"), str) and isinstance(receipt.get("attempt"), int)
                and isinstance(receipt.get("run"), str)):
            return items
    if receipt.get("verdict") != "pass":
        items.append(_item(1, f"the receipt's verdict is {receipt.get('verdict')}", tid))
    sha = str(receipt["sha"])
    attempt = int(receipt["attempt"])
    # 2. receipt SHA = landed SHA of the latest landed merge receipt of that attempt, and on origin/main
    landed = landed_merge(layout, tid, attempt, tracked=tracked)
    if landed is None:
        items.append(_item(2, f"no landed merge receipt for attempt {attempt}"
                              f" ({'proofs/merge copy' if tracked else 'local results'})", tid))
    elif landed[1]["landed_sha"] != sha:
        items.append(_item(2, f"receipt sha {sha[:8]} is not the landed sha {landed[1]['landed_sha'][:8]}", tid))
    status_sha = ts.raw.get("landed_sha") if ts.raw else None
    if status_sha and status_sha != sha:
        items.append(_item(2, f"receipt sha {sha[:8]} differs from the status landed_sha {status_sha[:8]}", tid))
    ok, why = on_origin_main(git, sha)
    if not ok:
        items.append(_item(2, why, tid, "E_NOT_ON_MAIN"))
    # 3. proof hash of the current plan
    if receipt.get("proof_hash") != planmod.proof_digest(task.raw):
        items.append(_item(3, "the receipt's proof_hash is not the current plan's proof digest", tid))
    # 4. the cited run exists, belongs to the task and SHA, agrees with the verdict
    run = find_run(layout, tid, str(receipt["run"]), tracked=True if tracked else None)
    if run is None:
        items.append(_item(4, f"the cited run {receipt['run']} does not exist", tid))
    else:
        if run.get("sha") != sha:
            items.append(_item(4, "the cited run is of another SHA", tid))
        met = bool((run.get("expectation") or {}).get("met"))
        if receipt.get("verdict") == "pass" and not met:
            items.append(_item(4, "a pass verdict on a run whose expectation was not met", tid, "E_VERDICT_MISMATCH"))
        if receipt.get("exit_code") is not None and run.get("exit_code") != receipt.get("exit_code"):
            items.append(_item(4, "the run's exit code differs from the receipt's", tid))
    # 5. verifier identity
    by = receipt.get("by") or {}
    impl = receipt.get("implementer") or {}
    if by.get("agent_type") != "execution-verifier":
        items.append(_item(5, "the receipt was not written by an execution-verifier", tid))
    if not by.get("agent_id"):
        items.append(_item(5, "the verifier's agent_id is null (no guard attestation)", tid))
    elif by.get("agent_id") == impl.get("agent_id"):
        items.append(_item(5, "the verifier and the implementer are the same agent", tid))
    if impl.get("result"):
        impl_path = layout.state / str(impl["result"])
        local_impl = list((layout.local / "results").glob(f"*/{tid}.implementer.a{attempt}.json")) \
            if (layout.local / "results").is_dir() and not tracked else []
        if not impl_path.is_file() and not local_impl:
            items.append(_item(5, f"the implementer result {impl['result']} does not exist", tid))
    elif landed is None:
        items.append(_item(5, "no implementer result and no landed merge receipt standing for it", tid))
    # 6. negative control
    if _nc_required(task):
        nc = receipt.get("negative_control") or {}
        satisfied = bool(nc.get("ran")) and nc.get("met") is True
        if not satisfied and run is not None:
            rnc = run.get("negative_control") or {}
            satisfied = bool(rnc.get("ran")) and rnc.get("met") is True
        recorded = ((task.proof or {}).get("negative_control") or {}).get("recorded")
        if not satisfied and isinstance(recorded, dict) and recorded.get("exit_code") not in (None, 0):
            satisfied = True
        if not satisfied:
            items.append(_item(6, "the required negative control did not run or did not fail as required", tid))
    # 7. integrity
    integ = receipt.get("integrity") or {}
    if int(integ.get("skip_markers_added", 0)) != 0:
        items.append(_item(7, f"{integ.get('skip_markers_added')} skip markers added", tid))
    if integ.get("protected_touched"):
        items.append(_item(7, "protected paths touched", tid))
    return items


def _human_done(layout: Layout, task: Task, ts: TaskState) -> list[ErrorItem]:
    tid = task.id
    items: list[ErrorItem] = []
    if task.kind == "manual":
        answers = answers_of(layout, tid)
        for bb in (task.manual or {}).get("bring_back") or ():
            if not any(h.get("bring_back_key") == bb["key"] and h["verification"]["ok"] for _p, h in answers):
                items.append(_item(1, f"bring_back {bb['key']} has no verified answer", tid))
    else:
        did = (ts.raw or {}).get("decision")
        proposal, resolution = decision_pair(layout, str(did or ""))
        if not resolution or chosen_option(proposal, resolution) is None:
            items.append(_item(1, f"decision {did} has no valid resolution", tid))
    ok, details = file_proof_status(task)
    if not ok:
        items += [_item(4, f"file proof: {d}", tid) for d in details]
    return items


# --- task set-status (the only manual override) -------------------------------------------------------------------

_SET_TARGETS = ("ready", "blocked-manual", "blocked-decision")


def cmd_set_status(ctx: Ctx, args: Namespace) -> CommandResult:
    """`task set-status --task T --to ready|blocked-manual|blocked-decision --reason TEXT --decision D-nnn`."""
    if ctx.by != "orchestrator":
        raise PolicyRefused("task set-status is orchestrator-only", code="E_TRANSITION_REFUSED",
                            hint="agents never run it (SCHEMAS.md 5.3)")
    if args.to not in _SET_TARGETS:
        raise TransitionRefused(f"task set-status never targets {args.to}", code="E_TRANSITION_REFUSED",
                                hint="built, verifying and done rest on evidence only (SCHEMAS.md 4.2)")
    if ctx.executor not in ("A", "B"):
        raise UsageError("no executor: pass --executor or run exec.py init first")
    plan = planmod.load(ctx.layout)
    task = plan.by_id.get(args.task)
    if task is None:
        raise UsageError(f"unknown task {args.task}")
    if not re.match(r"^D-[0-9]{3,}$", str(args.decision)):
        raise UsageError(f"--decision {args.decision!r} is not a decision id")
    with state_lock(ctx):
        doc = statusio.load(ctx.layout, ctx.executor)
        before = current_status(doc, task.id)
        if task.executor != ctx.executor:
            raise TransitionRefused(f"{task.id} belongs to executor {task.executor}", code="E_TRANSITION_REFUSED")
        evidence = [f"decision:{args.decision}", f"reason:{args.reason}"]
        entry = transition(ctx, doc, task, args.to, evidence=evidence, reason=str(args.reason), plan=plan)
        statusio.save(ctx, doc)
    return CommandResult(data={"task": task.id, "from": before, "to": entry["status"], "decision": args.decision})
