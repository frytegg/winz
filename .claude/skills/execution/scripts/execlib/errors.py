"""Exception hierarchy and error items (contract/MODULES.md 2, README.md 5-6).

Every exec.py failure is an ExecError subclass whose class fixes the exit code; the code string can be refined per
raise (`code=`). A process-wide warning collector lets lower layers report W_* items that `envelope.run` copies into
the envelope's `warnings` (a warning never changes the exit code).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

CODE_RE = re.compile(r"^[EW]_[A-Z0-9_]{2,40}$")


@dataclass(frozen=True)
class ErrorItem:
    code: str
    message: str
    path: str | None = None
    task: str | None = None
    hint: str | None = None

    def __post_init__(self) -> None:
        if not CODE_RE.match(self.code):
            raise ValueError(f"invalid error code {self.code!r}")
        if not self.message:
            raise ValueError("an error item needs a message")

    def to_dict(self) -> dict[str, str]:
        out: dict[str, str] = {"code": self.code, "message": self.message}
        if self.path is not None:
            out["path"] = self.path
        if self.task is not None:
            out["task"] = self.task
        if self.hint is not None:
            out["hint"] = self.hint
        return out


class ExecError(Exception):
    exit_code: int = 3
    default_code: str = "E_INTERNAL"

    def __init__(self, message: str, *, code: str | None = None, items: list[ErrorItem] | None = None,
                 hint: str | None = None, data: dict | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code or self.default_code
        self.items_ = list(items) if items else []
        self.hint = hint
        self.data = data

    def items(self) -> list[ErrorItem]:
        if self.items_:
            return list(self.items_)
        return [ErrorItem(self.code, self.message or self.code, hint=self.hint)]


class UsageError(ExecError):
    exit_code = 2
    default_code = "E_USAGE"


class CheckFailed(ExecError):
    exit_code = 1
    default_code = "E_CHECK"


class ValidationFailed(CheckFailed):
    default_code = "E_SCHEMA"


class CasRejected(CheckFailed):
    default_code = "E_CAS_REJECTED"


class DependencyMissing(CheckFailed):
    default_code = "E_DEPENDENCY_MISSING"


class EnvError(ExecError):
    exit_code = 3
    default_code = "E_ENV"


class GitError(EnvError):
    default_code = "E_GIT"


class LockTimeout(EnvError):
    default_code = "E_LOCK_TIMEOUT"


class InternalError(ExecError):
    exit_code = 3
    default_code = "E_INTERNAL"


class PolicyRefused(ExecError):
    exit_code = 4
    default_code = "E_POLICY"


class TransitionRefused(PolicyRefused):
    default_code = "E_TRANSITION_REFUSED"


class ImmutableFile(PolicyRefused):
    default_code = "E_IMMUTABLE"


# --- warnings collected for the envelope ------------------------------------------------------------------------

_WARNINGS: list[ErrorItem] = []


def warn(item: ErrorItem) -> None:
    """Record a W_* item for the current command's envelope (deduplicated on drain)."""
    if not item.code.startswith("W_"):
        raise ValueError(f"warn() takes W_* items, got {item.code}")
    _WARNINGS.append(item)


def drain_warnings() -> list[ErrorItem]:
    """Return and clear the collected warnings, in first-seen order without duplicates."""
    seen: set[tuple[Any, ...]] = set()
    out: list[ErrorItem] = []
    for item in _WARNINGS:
        key = (item.code, item.message, item.path, item.task, item.hint)
        if key not in seen:
            seen.add(key)
            out.append(item)
    _WARNINGS.clear()
    return out
