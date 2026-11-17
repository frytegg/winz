"""The stdout envelope (contract/README.md 4-5, envelope.schema.json): the only writer of stdout.

`run` calls a handler, maps ExecError subclasses to their exit codes and any other exception to E_INTERNAL exit 3
(logged with its traceback, never swallowed), adds the warnings collected during the command, validates the envelope
against envelope.schema.json and prints exactly one line (indented with --pretty).
"""
from __future__ import annotations

import json
import re
import sys
from typing import Callable

from . import CONTRACT
from . import schema
from .errors import ErrorItem, ExecError, drain_warnings
from .log import get_logger, redact
from .model import CommandResult

COMMAND_RE = re.compile(r"^[a-z][a-z-]*( [a-z][a-z-]*)?$")
FALLBACK_COMMAND = "exec"
_LOG = get_logger("execlib.envelope")


def emit(envelope: dict, *, pretty: bool) -> None:
    """Write the envelope as one JSON document on stdout (one line unless pretty)."""
    if pretty:
        text = json.dumps(envelope, ensure_ascii=False, indent=2, sort_keys=False)
    else:
        text = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write(text + "\n")
    sys.stdout.flush()


def command_name(command: str) -> str:
    return command if COMMAND_RE.match(command or "") else FALLBACK_COMMAND


def build(command: str, *, data: dict | None, errors: list[ErrorItem], warnings: list[ErrorItem],
          exit_code: int) -> dict:
    return {"ok": exit_code == 0, "command": command_name(command), "data": data,
            "errors": [e.to_dict() for e in errors], "warnings": [w.to_dict() for w in warnings],
            "exit_code": exit_code, "contract": CONTRACT}


def _merge_warnings(*groups: list[ErrorItem]) -> list[ErrorItem]:
    seen: set[tuple] = set()
    out: list[ErrorItem] = []
    for group in groups:
        for w in group:
            key = (w.code, w.message, w.path, w.task, w.hint)
            if key not in seen:
                seen.add(key)
                out.append(w)
    return out


def run(command: str, fn: Callable[[], CommandResult], *, pretty: bool) -> int:
    """Call fn and print its envelope; returns the exit code."""
    data: dict | None = None
    errors: list[ErrorItem] = []
    warnings: list[ErrorItem] = []
    try:
        result = fn()
        if not isinstance(result, CommandResult):
            raise TypeError(f"handler returned {type(result).__name__}, not CommandResult")
        data, warnings, exit_code, errors = result.data, list(result.warnings), int(result.exit_code), \
            list(result.errors)
        if exit_code not in (0, 1, 2, 3, 4):
            raise ValueError(f"handler returned exit code {exit_code}")
        if exit_code != 0 and not errors:
            errors = [ErrorItem("E_CHECK", f"{command_name(command)} failed with exit {exit_code}")]
        if exit_code == 0 and errors:
            exit_code = 1
    except ExecError as err:
        exit_code = err.exit_code
        errors = err.items()
        data = err.data if isinstance(err.data, dict) else None
        _LOG.info("command refused" if exit_code == 4 else "command failed",
                  extra={"data": {"command": command_name(command), "exit_code": exit_code,
                                  "codes": [e.code for e in errors]}})
    except Exception as err:  # noqa: BLE001 - mapped to E_INTERNAL, logged with its traceback, never swallowed
        exit_code = 3
        data = None
        errors = [ErrorItem("E_INTERNAL", redact(f"internal error: {type(err).__name__}: {err}") or "internal error")]
        _LOG.error("uncaught exception", exc_info=True,
                   extra={"data": {"command": command_name(command), "exit_code": 3}})
    envelope = build(command, data=data, errors=errors, warnings=_merge_warnings(warnings, drain_warnings()),
                     exit_code=exit_code)
    try:
        json.dumps(envelope, ensure_ascii=False)
        report = schema.validate(envelope, "envelope")
        problems = [i.message for i in report.issues[:3]]
    except (TypeError, ValueError) as err:
        problems = [f"data is not JSON-serialisable: {err}"]
    if problems:
        _LOG.error("envelope failed its schema", extra={"data": {"issues": problems}})
        envelope = build(command, data=None,
                         errors=[ErrorItem("E_INTERNAL", "the command built an invalid envelope: "
                                           + "; ".join(problems))],
                         warnings=[], exit_code=3)
        exit_code = 3
    emit(envelope, pretty=pretty)
    return exit_code
