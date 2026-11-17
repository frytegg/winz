"""The argparse surface of every exec.py command and the lazy dispatch table (contract/CLI.md, MODULES.md 5).

Handlers are imported by name inside `main` (no import-time edge from this module to any handler module): a module
or function that does not exist yet answers E_NOT_IMPLEMENTED, exit 3, so the surface is complete before the other
lanes land. Usage errors never reach argparse's own printing: they become an E_USAGE envelope (exit 2). Global
options are accepted before or after the command words.

Two commands take their own `--by` (a dev): `answers ingest` (devA|devB) and `decision resolve` (devA|devB|owner).
For them `args.by` is that dev and the caller's role is `orchestrator` (both are orchestrator-only commands); for
every other command `--by` is the role (CLI.md 0.1) and lands in `args.by_role` / `ctx.by` (`args.role` is
`result put --role`).
"""
from __future__ import annotations

import argparse
import importlib
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from . import envelope
from .clock import utcnow
from .errors import ExecError, InternalError, UsageError
from .jsonio import read_json
from .log import configure, get_logger
from .model import CommandResult, Ctx
from .paths import find_repo, layout_for, resolve_repo


@dataclass(frozen=True)
class CommandSpec:
    words: str
    module: str
    function: str
    orchestrator_only: bool


COMMANDS: tuple[CommandSpec, ...] = (
    CommandSpec("init", "initcmd", "cmd_init", True),
    CommandSpec("preflight", "preflight", "cmd_preflight", True),
    CommandSpec("ingest", "ingest", "cmd_ingest", True),
    CommandSpec("hooks install", "hooksinstall", "cmd_install", True),
    CommandSpec("hooks canary", "hooksinstall", "cmd_canary", True),
    CommandSpec("hooks uninstall", "hooksinstall", "cmd_uninstall", True),
    CommandSpec("agents install", "agents", "cmd_install", True),
    CommandSpec("agents status", "agents", "cmd_status", True),
    CommandSpec("agents probe", "agents", "cmd_probe", True),
    CommandSpec("agents probe-check", "agents", "cmd_probe_check", True),
    CommandSpec("heartbeat plan", "heartbeat", "cmd_plan", True),
    CommandSpec("heartbeat record", "heartbeat", "cmd_record", True),
    CommandSpec("sync", "syncstate", "cmd_sync", True),
    CommandSpec("plan instantiate", "planning", "cmd_instantiate", True),
    CommandSpec("plan emit", "wave", "cmd_plan_emit", True),
    CommandSpec("validate", "planning", "cmd_validate", False),
    CommandSpec("catalogue", "planning", "cmd_catalogue", True),
    CommandSpec("schedule", "schedule", "cmd_schedule", True),
    CommandSpec("simulate", "schedule", "cmd_simulate", False),
    CommandSpec("due", "due", "cmd_due", True),
    CommandSpec("amend", "amend", "cmd_amend", True),
    CommandSpec("status", "reconcile", "cmd_status", True),
    CommandSpec("governor", "governor", "cmd_governor", True),
    CommandSpec("quota", "quota", "cmd_quota", True),
    CommandSpec("manual post", "manual", "cmd_post", True),
    CommandSpec("answers ingest", "answers", "cmd_ingest", True),
    CommandSpec("decision propose", "decisions", "cmd_propose", True),
    CommandSpec("decision resolve", "decisions", "cmd_resolve", True),
    CommandSpec("task set-status", "status", "cmd_set_status", True),
    CommandSpec("wave emit", "wave", "cmd_emit", True),
    CommandSpec("wave launched", "wave", "cmd_launched", True),
    CommandSpec("wave ingest", "wave", "cmd_ingest", True),
    CommandSpec("result put", "results", "cmd_put", False),
    CommandSpec("merge", "merge", "cmd_merge", False),
    CommandSpec("snapshot", "merge", "cmd_snapshot", False),
    CommandSpec("fe-workspace", "merge", "cmd_fe_workspace", False),
    CommandSpec("proof run", "proof", "cmd_run", False),
    CommandSpec("proof verdict", "proof", "cmd_verdict", False),
    CommandSpec("completion generate", "completion", "cmd_generate", True),
    CommandSpec("completion run", "completion", "cmd_run", False),
    CommandSpec("harden-ready", "hardenready", "cmd_harden_ready", True),
    CommandSpec("notion diff", "notion", "cmd_diff", True),
    CommandSpec("notion ack", "notion", "cmd_ack", True),
    CommandSpec("notion poll-plan", "notion", "cmd_poll_plan", True),
    CommandSpec("report", "report", "cmd_report", True),
    CommandSpec("handover", "handover", "cmd_handover", True),
    CommandSpec("fix", "fixmode", "cmd_fix", True),
    CommandSpec("events replay", "replay", "cmd_replay", True),
    CommandSpec("resume", "resume", "cmd_resume", True),
    CommandSpec("fixture new", "fixture", "cmd_new", True),
)
SPECS: dict[str, CommandSpec] = {c.words: c for c in COMMANDS}
ROLES: tuple[str, ...] = ("orchestrator", "verifier", "implementer", "integrator", "test-designer", "planner",
                          "reviewer", "replay")
LOG_LEVELS: tuple[str, ...] = ("error", "warning", "info", "debug")
TASK_STATUSES: tuple[str, ...] = ("planned", "ready", "running", "built", "verifying", "done", "failed",
                                  "blocked-manual", "blocked-decision", "cut-proposed", "cut", "superseded")
_GLOBAL_WITH_VALUE = ("--repo", "--state", "--executor", "--now", "--log-level", "--by")
_OWN_BY = {"answers ingest": ("devA", "devB"), "decision resolve": ("devA", "devB", "owner")}


class _Parser(argparse.ArgumentParser):
    """An ArgumentParser that raises UsageError instead of printing and exiting."""

    def error(self, message: str) -> Any:  # type: ignore[override]
        raise UsageError(f"{self.prog}: {message}", hint="see contract/CLI.md for the command's arguments")

    def exit(self, status: int = 0, message: str | None = None) -> Any:  # type: ignore[override]
        raise UsageError((message or f"{self.prog}: usage error").strip())


def _add_globals(p: argparse.ArgumentParser, *, suppress: bool, with_by: bool = True) -> None:
    d: Callable[[Any], Any] = (lambda _v: argparse.SUPPRESS) if suppress else (lambda v: v)
    p.add_argument("--repo", default=d(None), help="product repository root")
    p.add_argument("--state", default=d(None), help="state directory (default <repo>/.execution)")
    p.add_argument("--executor", choices=("A", "B"), default=d(None))
    p.add_argument("--now", default=d(None), help="UTC instant override")
    p.add_argument("--pretty", action="store_true", default=d(False))
    p.add_argument("--log-level", dest="log_level", choices=LOG_LEVELS, default=d(None))
    if with_by:
        p.add_argument("--by", dest="by_role", choices=ROLES, default=d("orchestrator"))


def _leaf(sub: Any, name: str, words: str) -> argparse.ArgumentParser:
    p = sub.add_parser(name, add_help=False, allow_abbrev=False, prog=f"exec.py {words}")
    _add_globals(p, suppress=True, with_by=words not in _OWN_BY)
    if words in _OWN_BY:
        p.add_argument("--by", dest="by", choices=_OWN_BY[words])
    return p


def build_parser() -> argparse.ArgumentParser:
    """Every option of CLI.md; usage errors raise UsageError (exit 2)."""
    root = _Parser(prog="exec.py", add_help=False, allow_abbrev=False)
    _add_globals(root, suppress=False)
    cmds = root.add_subparsers(dest="cmd", parser_class=_Parser, metavar="command")
    cmds.required = True
    groups: dict[str, Any] = {}

    def leaf(words: str) -> argparse.ArgumentParser:
        parts = words.split(" ")
        if len(parts) == 1:
            return _leaf(cmds, parts[0], words)
        if parts[0] not in groups:
            gp = cmds.add_parser(parts[0], add_help=False, allow_abbrev=False, prog=f"exec.py {parts[0]}")
            _add_globals(gp, suppress=True)
            gsub = gp.add_subparsers(dest="sub", parser_class=_Parser, metavar="subcommand")
            gsub.required = True
            groups[parts[0]] = gsub
        return _leaf(groups[parts[0]], parts[1], words)

    # 1. Run setup
    p = leaf("init")
    p.add_argument("--project", required=True)
    p.add_argument("--state-remote", dest="state_remote")
    p.add_argument("--pre-t0", dest="pre_t0", action="store_true")
    p.add_argument("--import-from", dest="import_from")
    p = leaf("preflight")
    p.add_argument("--for", dest="for_", choices=("rehearsal", "event"), default="rehearsal")
    p.add_argument("--confirm")
    p.add_argument("--strict", action="store_true")
    p = leaf("ingest")
    p.add_argument("--spec")
    p.add_argument("--profile-draft", dest="profile_draft")
    p.add_argument("--policy-draft", dest="policy_draft")
    p.add_argument("--patch")
    p.add_argument("--decision")
    p.add_argument("--notion-ids", dest="notion_ids", action="store_true")
    p.add_argument("--answer")
    p.add_argument("--propose-spec-validation", dest="propose_spec_validation", action="store_true")
    p = leaf("hooks install")
    p.add_argument("--no-prompt-hook", dest="no_prompt_hook", action="store_true")
    p = leaf("hooks canary")
    p.add_argument("--nonce", required=True)
    leaf("hooks uninstall")
    p = leaf("agents install")
    p.add_argument("--force", action="store_true")
    leaf("agents status")
    leaf("agents probe")
    p = leaf("agents probe-check")
    p.add_argument("--result", required=True)
    leaf("heartbeat plan")
    p = leaf("heartbeat record")
    p.add_argument("--cron-id", dest="cron_id", required=True)
    p.add_argument("--expr", required=True)
    p = leaf("sync")
    p.add_argument("--pull-only", dest="pull_only", action="store_true")
    p.add_argument("--push-only", dest="push_only", action="store_true")
    # 2. Planning
    p = leaf("plan instantiate")
    p.add_argument("--draft")
    p.add_argument("--dry-run", dest="dry_run", action="store_true")
    p.add_argument("--proofs")
    p.add_argument("--propose-approval", dest="propose_approval", action="store_true")
    p.add_argument("--pre-t0", dest="pre_t0", action="store_true")
    p = leaf("plan emit")
    p.add_argument("--rounds", type=int, default=2)
    p.add_argument("--mode", choices=("design", "pre-t0"), default="design")
    p = leaf("validate")
    p.add_argument("--plan")
    p.add_argument("--with-status", dest="with_status", action="store_true")
    p.add_argument("--strict", action="store_true")
    leaf("catalogue")
    p = leaf("schedule")
    p.add_argument("--samples", type=int, default=800)
    p.add_argument("--seed", type=int)
    p.add_argument("--lanes", type=int)
    p = leaf("simulate")
    p.add_argument("--plan")
    p.add_argument("--samples", type=int, default=800)
    p.add_argument("--seed", type=int)
    p.add_argument("--lanes", type=int)
    p.add_argument("--what-if", dest="what_if")
    p.add_argument("--from-status", dest="from_status", action="store_true")
    p = leaf("due")
    p.add_argument("--horizon-min", dest="horizon_min", type=int, default=120)
    p = leaf("amend")
    p.add_argument("--decision", required=True)
    p.add_argument("--patch", required=True)
    # 3. The tick
    p = leaf("status")
    p.add_argument("--digest", action="store_true")
    p.add_argument("--max-chars", dest="max_chars", type=int, default=2000)
    p = leaf("governor")
    p.add_argument("--for", dest="for_", choices=("wave", "install", "handover"), default="wave")
    p.add_argument("--apply-sweep", dest="apply_sweep", action="store_true")
    leaf("quota")
    p = leaf("manual post")
    p.add_argument("--task", dest="tasks", action="append", default=[])
    p.add_argument("--all-ready", dest="all_ready", action="store_true")
    p.add_argument("--repost", action="store_true")
    p.add_argument("--link")
    p = leaf("answers ingest")
    p.add_argument("--from-notion", dest="from_notion")
    p.add_argument("--key")
    p.add_argument("--text-file", dest="text_file")
    p.add_argument("--source", choices=("terminal", "remote-control"))
    p.add_argument("--task")
    p.add_argument("--decision")
    p.add_argument("--attachment", dest="attachments", action="append", default=[])
    p.add_argument("--scope-change", dest="scope_change", action="store_true")
    p.add_argument("--relay", action="store_true")
    p = leaf("decision propose")
    p.add_argument("--kind", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--options-file", dest="options_file")
    p.add_argument("--recommended")
    p.add_argument("--deadline-utc", dest="deadline_utc")
    p.add_argument("--task", dest="tasks", action="append", default=[])
    p = leaf("decision resolve")
    p.add_argument("--id", required=True)
    p.add_argument("--choice-file", dest="choice_file")
    p.add_argument("--source", choices=("terminal", "remote-control", "notion"))
    p.add_argument("--quote-file", dest="quote_file")
    p.add_argument("--from-notion", dest="from_notion")
    p = leaf("task set-status")
    p.add_argument("--task", required=True)
    p.add_argument("--to", required=True, choices=TASK_STATUSES)
    p.add_argument("--reason", required=True)
    p.add_argument("--decision", required=True)
    # 4. Waves
    p = leaf("wave emit")
    p.add_argument("--max-tasks", dest="max_tasks", type=int)
    p.add_argument("--include", action="append", default=[])
    p.add_argument("--wave")
    p.add_argument("--force-critical", dest="force_critical", action="store_true")
    p.add_argument("--pre-t0", dest="pre_t0", action="store_true")
    p = leaf("wave launched")
    p.add_argument("--wave", required=True)
    p.add_argument("--run-id", dest="run_id")
    p.add_argument("--transcript-dir", dest="transcript_dir")
    p.add_argument("--error-file", dest="error_file")
    p.add_argument("--relaunch", action="store_true")
    p = leaf("result put")
    p.add_argument("--wave", required=True)
    p.add_argument("--task")
    p.add_argument("--role", required=True)
    p.add_argument("--attempt", type=int, required=True)
    p.add_argument("--file", required=True)
    p = leaf("wave ingest")
    p.add_argument("--wave", required=True)
    p.add_argument("--journal")
    p.add_argument("--finished", action="store_true")
    p = leaf("merge")
    p.add_argument("--task", required=True)
    p.add_argument("--attempt", type=int, required=True)
    p.add_argument("--wave", required=True)
    p.add_argument("--rerun", type=int, default=0)
    p.add_argument("--worktree")
    p.add_argument("--branch")
    p.add_argument("--single-tree", dest="single_tree", action="store_true")
    p.add_argument("--message-file", dest="message_file")
    p = leaf("fe-workspace")
    p.add_argument("--task", required=True)
    p.add_argument("--attempt", type=int, required=True)
    p.add_argument("--rerun", type=int, default=0)
    p = leaf("snapshot")
    p.add_argument("--task", required=True)
    p.add_argument("--attempt", type=int, required=True)
    p.add_argument("--rerun", type=int, default=0)
    p.add_argument("--paths", nargs="+", required=True)
    p.add_argument("--message-file", dest="message_file", required=True)
    # 5. Proofs
    p = leaf("proof run")
    p.add_argument("--task", required=True)
    p.add_argument("--sha", required=True)
    p.add_argument("--negative-control", dest="negative_control", action="store_true")
    p.add_argument("--checkout", choices=("clone", "in-place"), default="clone")
    p.add_argument("--tree")
    p.add_argument("--keep", action="store_true")
    p = leaf("proof verdict")
    p.add_argument("--task", required=True)
    p.add_argument("--run", required=True)
    p.add_argument("--verdict", choices=("pass", "fail"), required=True)
    p.add_argument("--findings", required=True)
    p.add_argument("--attempt", type=int, required=True)
    p.add_argument("--model", required=True)
    p.add_argument("--effort", required=True)
    leaf("completion generate")
    p = leaf("completion run")
    p.add_argument("--phase", default="all")
    p = leaf("harden-ready")
    p.add_argument("--only")
    p.add_argument("--scratch")
    p.add_argument("--after-harden", dest="after_harden", action="store_true")
    p.add_argument("--keep", action="store_true")
    # 6. Notion
    p = leaf("notion diff")
    p.add_argument("--init", action="store_true")
    p.add_argument("--wave")
    p.add_argument("--replay-outbox", dest="replay_outbox", action="store_true")
    p = leaf("notion ack")
    p.add_argument("--batch", required=True)
    p.add_argument("--op", required=True)
    p.add_argument("--result-file", dest="result_file")
    p.add_argument("--failed", action="store_true")
    p.add_argument("--error-file", dest="error_file")
    p.add_argument("--error-code", dest="error_code")
    p.add_argument("--retry-after", dest="retry_after", type=int)
    leaf("notion poll-plan")
    # 7. Reporting, hand-over, fix mode
    p = leaf("report")
    p.add_argument("--wave")
    p.add_argument("--view", action="store_true")
    p = leaf("handover")
    p.add_argument("--decision")
    p.add_argument("--final", action="store_true")
    p = leaf("fix")
    p.add_argument("--report", required=True)
    p.add_argument("--list", dest="list_only", action="store_true")
    p.add_argument("--select")
    p.add_argument("--select-file", dest="select_file")
    p.add_argument("--decision")
    p.add_argument("--reason-unselected-file", dest="reason_unselected_file")
    # 8. Recovery and maintenance
    p = leaf("events replay")
    p.add_argument("--since")
    p.add_argument("--rebuild-state", dest="rebuild_state", action="store_true")
    p = leaf("resume")
    p.add_argument("--takeover", action="store_true")
    p = leaf("fixture new")
    p.add_argument("--dest", required=True)
    p.add_argument("--variant", choices=("a", "b"), default="a")
    p.add_argument("--with-remote", dest="with_remote", action="store_true")
    p.add_argument("--two-dev", dest="two_dev", action="store_true")
    p.add_argument("--frontend-mode", dest="frontend_mode", choices=("small", "full"), default="small")
    return root


def guess_command(argv: list[str]) -> str:
    """The command words of argv (for the envelope of a usage error), or 'exec' when none are recognisable."""
    words: list[str] = []
    skip = False
    for tok in argv:
        if skip:
            skip = False
            continue
        if tok.startswith("--"):
            if tok in _GLOBAL_WITH_VALUE:
                skip = True
            continue
        words.append(tok)
        if len(words) == 2:
            break
    if not words:
        return envelope.FALLBACK_COMMAND
    two = " ".join(words[:2])
    if two in SPECS:
        return two
    if words[0] in SPECS:
        return words[0]
    return envelope.command_name(words[0])


def words_of(args: argparse.Namespace) -> str:
    sub = getattr(args, "sub", None)
    return f"{args.cmd} {sub}" if sub else str(args.cmd)


def _local_executor(state_file: Path) -> str | None:
    try:
        doc = read_json(state_file)
    except (FileNotFoundError, ExecError, OSError):
        return None
    value = doc.get("executor") if isinstance(doc, dict) else None
    return value if value in ("A", "B") else None


def build_ctx(args: argparse.Namespace, spec: CommandSpec) -> Ctx:
    """Clock, repository, state directory, executor and role of this call."""
    now = utcnow(args.now)
    cwd = Path.cwd()
    repo = resolve_repo(cwd, args.repo) if args.repo else find_repo(cwd)
    if args.state:
        layout = layout_for(repo, Path(args.state))
    elif repo is not None:
        layout = layout_for(repo, None)
    else:
        layout = layout_for(None, cwd / ".execution")
    executor = args.executor or _local_executor(layout.local_state)
    role = getattr(args, "by_role", "orchestrator") or "orchestrator"
    return Ctx(layout=layout, executor=executor, now=now, by=role, pretty=bool(args.pretty), command=spec.words,
               log=get_logger(f"execlib.{spec.module}"))


def load_handler(spec: CommandSpec) -> Callable[[Ctx, argparse.Namespace], CommandResult]:
    """Import execlib.<module>.<function> by name; E_NOT_IMPLEMENTED (exit 3) when either is absent."""
    full = f"execlib.{spec.module}"
    try:
        module = importlib.import_module(full)
    except ModuleNotFoundError as err:
        if err.name == full:
            raise InternalError(f"'{spec.words}' is not implemented yet (module {full} absent)",
                                code="E_NOT_IMPLEMENTED") from err
        raise
    fn = getattr(module, spec.function, None)
    if fn is None or not callable(fn):
        raise InternalError(f"'{spec.words}' is not implemented yet ({full}.{spec.function} absent)",
                            code="E_NOT_IMPLEMENTED")
    return fn  # type: ignore[no-any-return]


def _flush_broken_locks(ctx: Ctx) -> None:
    """Write `error` events for dead holders' locks this call broke but no later event carried (lazy, by name)."""
    locks = importlib.import_module("execlib.locks")
    pending = locks.drain_broken()
    if not pending:
        return
    log = get_logger("execlib.cli")
    if ctx.executor not in ("A", "B") or not ctx.layout.state.exists():
        log.warning("broken lock records not written: no executor or state", extra={"data": {"records": pending}})
        return
    events = importlib.import_module("execlib.events")
    try:
        with locks.hold(ctx.layout, "state", command=ctx.command):
            for record in pending:
                events.append(ctx, "error", {"kind": "lock-broken", **record})
    except ExecError as err:
        log.error("could not write the broken-lock events", extra={"data": {"error": err.message,
                                                                           "records": pending}})


def _dispatch(args: argparse.Namespace, spec: CommandSpec) -> CommandResult:
    ctx = build_ctx(args, spec)
    handler = load_handler(spec)
    try:
        return handler(ctx, args)
    finally:
        _flush_broken_locks(ctx)


def main(argv: list[str]) -> int:
    """Configure logging, parse, build the context and run the handler inside the envelope."""
    try:
        configure(os.environ.get("EXEC_LOG_LEVEL") or "info")
    except ValueError:
        configure("info")
    pretty = "--pretty" in argv
    try:
        args = build_parser().parse_args(argv)
    except ExecError as err:
        error = err
        return envelope.run(guess_command(argv), lambda: _raise(error), pretty=pretty)
    if args.log_level:
        configure(args.log_level)
    words = words_of(args)
    spec = SPECS[words]
    return envelope.run(words, lambda: _dispatch(args, spec), pretty=bool(args.pretty))


def _raise(err: ExecError) -> CommandResult:
    raise err
