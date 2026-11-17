"""JSON-lines logging to stderr and secret redaction (contract/MODULES.md 2, README.md 2).

Every line: ts (UTC, milliseconds, Z), level (error|warning|info|debug), module, msg, plus the `data` dict passed as
`extra={"data": {...}}`. Messages, string data values and tracebacks go through `redact` before they are written, so
a key, a bearer token or a mnemonic never reaches a log line even when a caller forgot to mask it.
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from typing import Any

LEVELS = {"error": logging.ERROR, "warning": logging.WARNING, "warn": logging.WARNING, "info": logging.INFO,
          "debug": logging.DEBUG}
_LEVEL_NAMES = {logging.ERROR: "error", logging.CRITICAL: "error", logging.WARNING: "warning", logging.INFO: "info",
                logging.DEBUG: "debug"}
ROOTS = ("execlib", "hook", "tests")

# (pattern id, compiled regex, replacement). Order matters: the PEM block first, then specific token shapes, then the
# generic `name = value` form. Replacements keep a label so a reader knows something was there.
_MNEMONIC_WORD = r"[a-z]{3,8}"
_REDACTIONS: list[tuple[str, re.Pattern[str], str]] = [
    ("pem", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:.*?-----END [A-Z0-9 ]*PRIVATE KEY-----|.*\Z)",
                       re.S), "[redacted:pem]"),
    ("hex-key", re.compile(r"(?<![0-9A-Za-z])0x[0-9a-fA-F]{64}(?![0-9A-Za-z])"), "[redacted:hex-key]"),
    ("hex-key", re.compile(r"(?i)((?:private|secret|signing)[ _-]?key[\"']?\s*[:=]\s*[\"']?)[0-9a-f]{64}\b"),
     r"\1[redacted:hex-key]"),
    ("mnemonic", re.compile(r"(?i)((?:mnemonic|seed phrase|seed|recovery phrase|secret phrase)[\"']?\s*[:=]?\s*"
                            r"[\"']?)(" + _MNEMONIC_WORD + r"(?: " + _MNEMONIC_WORD + r"){11,23})"),
     r"\1[redacted:mnemonic]"),
    ("mnemonic", re.compile(r"(?m)^\s*(" + _MNEMONIC_WORD + r"(?: " + _MNEMONIC_WORD + r"){11}"
                            r"(?:(?: " + _MNEMONIC_WORD + r"){12})?)\s*$"), "[redacted:mnemonic]"),
    ("bearer", re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}"), r"\1 [redacted:bearer]"),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{16,}"), "[redacted:anthropic-key]"),
    ("api-key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), "[redacted:api-key]"),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"), "[redacted:github-token]"),
    ("github-token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), "[redacted:github-token]"),
    ("slack-token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), "[redacted:slack-token]"),
    ("aws-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[redacted:aws-key]"),
    ("google-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"), "[redacted:google-key]"),
    ("notion-token", re.compile(r"\b(?:ntn_[A-Za-z0-9]{20,}|secret_[A-Za-z0-9]{30,})\b"), "[redacted:notion-token]"),
    ("gitlab-token", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"), "[redacted:gitlab-token]"),
    ("npm-token", re.compile(r"\bnpm_[A-Za-z0-9]{36}\b"), "[redacted:npm-token]"),
    ("assignment", re.compile(r"(?i)\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|"
                              r"passwd|secret)[\"']?\s*[:=]\s*[\"']?)(?!\[redacted)[^\s\"',;]{8,}"),
     r"\1[redacted:assignment]"),
]


def redact(text: str) -> str:
    """Mask private-key, mnemonic, bearer and API-key shapes with `[redacted:<pattern id>]`."""
    if not text:
        return text
    out = text
    for _pid, rx, repl in _REDACTIONS:
        out = rx.sub(repl, out)
    return out


def redaction_ids(text: str) -> list[str]:
    """The pattern ids that would fire on `text` (sorted, unique): callers report them without the text."""
    return sorted({pid for pid, rx, _repl in _REDACTIONS if text and rx.search(text)})


def _ts(created: float) -> str:
    dt = datetime.fromtimestamp(created, timezone.utc)
    return f"{dt:%Y-%m-%dT%H:%M:%S}.{dt.microsecond // 1000:03d}Z"


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        return redact(value)
    if isinstance(value, dict):
        return {str(k): _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    return value


class JsonLinesFormatter(logging.Formatter):
    """{"ts": "...Z", "level": "info", "module": ..., "msg": ..., **record.data} on one line."""

    def format(self, record: logging.LogRecord) -> str:
        obj: dict[str, Any] = {
            "ts": _ts(record.created),
            "level": _LEVEL_NAMES.get(record.levelno, "info"),
            "module": record.name,
            "msg": redact(record.getMessage()),
        }
        data = getattr(record, "data", None)
        if isinstance(data, dict):
            for key, value in data.items():
                if key not in obj:
                    obj[str(key)] = _clean(value)
        if record.exc_info:
            obj["traceback"] = redact("".join(traceback.format_exception(*record.exc_info)))
        return json.dumps(obj, ensure_ascii=False, default=str)


class _StderrHandler(logging.StreamHandler):  # type: ignore[type-arg]
    """A stream handler that always writes to the current sys.stderr (tests swap it)."""

    def __init__(self) -> None:
        super().__init__(sys.stderr)

    @property  # type: ignore[override]
    def stream(self) -> Any:
        return sys.stderr

    @stream.setter
    def stream(self, _value: Any) -> None:
        pass


_HANDLER: logging.Handler | None = None


def _level_from(level: str | None) -> int:
    name = (level or os.environ.get("EXEC_LOG_LEVEL") or "info").strip().lower()
    if name not in LEVELS:
        raise ValueError(f"unknown log level {name!r} (error|warning|info|debug)")
    return LEVELS[name]


def configure(level: str = "info") -> None:
    """Attach the JSON-lines stderr handler to the package loggers (idempotent; the level can change)."""
    global _HANDLER
    lvl = _level_from(level)
    if _HANDLER is None:
        _HANDLER = _StderrHandler()
        _HANDLER.setFormatter(JsonLinesFormatter())
    for root in ROOTS:
        logger = logging.getLogger(root)
        if _HANDLER not in logger.handlers:
            logger.addHandler(_HANDLER)
        logger.setLevel(lvl)
        logger.propagate = False


def get_logger(module: str) -> logging.Logger:
    """A logger named after the module (`execlib.merge`); configure() must have run for output."""
    if _HANDLER is None:
        try:
            configure(os.environ.get("EXEC_LOG_LEVEL") or "info")
        except ValueError:
            configure("info")
    return logging.getLogger(module)
