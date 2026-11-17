"""The only clock of exec.py (contract/MODULES.md 2, README.md 2 and 7).

Stored instants are UTC `YYYY-MM-DDTHH:MM:SSZ`; events may carry microseconds. `utcnow` honours `--now`, and
`EXEC_NOW` only when `EXEC_TEST=1` is also set (tests); otherwise `EXEC_NOW` is ignored with W_CLOCK_OVERRIDE. The
laptop's own zone is never used: display strings come from the profile's zones, through zoneinfo or, when the
machine has no tz database, the zone's fixed fallback offset with W_TZ_FALLBACK.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Sequence

from .errors import ErrorItem, UsageError, warn
from .log import get_logger

_UTC_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?Z$")
_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

_overridden = False
_LOG = get_logger("execlib.clock")


@dataclass(frozen=True)
class ZoneSpec:
    label: str
    iana: str
    fallback_utc_offset_min: int


def parse_utc(text: str) -> datetime:
    """Strict `YYYY-MM-DDTHH:MM:SS[.ffffff]Z` to an aware UTC datetime; UsageError otherwise."""
    if not isinstance(text, str):
        raise UsageError(f"not a UTC instant: {text!r}", hint="use YYYY-MM-DDTHH:MM:SSZ")
    m = _UTC_RE.match(text)
    if not m:
        raise UsageError(f"not a UTC instant: {text!r}", hint="use YYYY-MM-DDTHH:MM:SSZ")
    year, month, day, hour, minute, second = (int(m.group(i)) for i in range(1, 7))
    frac = m.group(7)
    micro = int(frac.ljust(6, "0")) if frac else 0
    try:
        return datetime(year, month, day, hour, minute, second, micro, tzinfo=timezone.utc)
    except ValueError as err:
        raise UsageError(f"not a valid instant: {text!r} ({err})") from err


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        raise ValueError("naive datetime: every instant of exec.py is UTC-aware")
    return dt.astimezone(timezone.utc)


def format_utc(dt: datetime) -> str:
    return f"{_aware(dt):%Y-%m-%dT%H:%M:%S}Z"


def format_utc_precise(dt: datetime) -> str:
    d = _aware(dt)
    if d.microsecond:
        return f"{d:%Y-%m-%dT%H:%M:%S}.{d.microsecond:06d}Z"
    return f"{d:%Y-%m-%dT%H:%M:%S}Z"


def from_epoch(seconds: int | float) -> datetime:
    return datetime.fromtimestamp(float(seconds), timezone.utc)


def stamp(dt: datetime) -> str:
    """`YYYYMMDDTHHMMSSZ` (run ids, batch ids)."""
    return f"{_aware(dt):%Y%m%dT%H%M%S}Z"


def minutes_between(a: datetime, b: datetime) -> float:
    """b - a in minutes (negative when b is earlier)."""
    return (_aware(b) - _aware(a)).total_seconds() / 60.0


def utcnow(override: str | None = None) -> datetime:
    """Aware UTC now. override = --now; EXEC_NOW only with EXEC_TEST=1 (else W_CLOCK_OVERRIDE, system clock)."""
    global _overridden
    if override:
        _overridden = True
        return parse_utc(override)
    env_now = os.environ.get("EXEC_NOW")
    if env_now:
        if os.environ.get("EXEC_TEST") == "1":
            _overridden = True
            return parse_utc(env_now)
        item = ErrorItem("W_CLOCK_OVERRIDE", "EXEC_NOW is set without EXEC_TEST=1: ignored, system clock used",
                         hint="unset EXEC_NOW (preflight PF-28 fails while it is set)")
        warn(item)
        _LOG.warning(item.message, extra={"data": {"code": item.code}})
    _overridden = False
    return datetime.now(timezone.utc)


def is_overridden() -> bool:
    """True when the last utcnow() used an override (the digest then says `clock: override`)."""
    return _overridden


def _load_zone(iana: str):  # type: ignore[no-untyped-def]
    """zoneinfo lookup; separated so tests can simulate a machine without a tz database."""
    from zoneinfo import ZoneInfo

    return ZoneInfo(iana)


def _render(local: datetime, label: str) -> str:
    return f"{_WEEKDAYS[local.weekday()]} {local.day} {_MONTHS[local.month - 1]} {local:%H:%M} {label}"


def display(dt: datetime, zones: Sequence[ZoneSpec]) -> tuple[dict[str, str], list[ErrorItem]]:
    """{"SGT": "Wed 7 Oct 23:59 SGT", "Paris": "Wed 7 Oct 17:59 Paris"}; W_TZ_FALLBACK when zoneinfo lacks data."""
    from zoneinfo import ZoneInfoNotFoundError

    utc = _aware(dt)
    out: dict[str, str] = {}
    warnings: list[ErrorItem] = []
    for zone in zones:
        try:
            local = utc.astimezone(_load_zone(zone.iana))
        except (ZoneInfoNotFoundError, ValueError, OSError):
            local = utc.astimezone(timezone(timedelta(minutes=zone.fallback_utc_offset_min)))
            item = ErrorItem("W_TZ_FALLBACK",
                             f"no tz data for {zone.iana}: fixed offset {zone.fallback_utc_offset_min} min used for "
                             f"{zone.label}", hint="install a tz database or check the profile's fallback offset")
            warnings.append(item)
            warn(item)
        out[zone.label] = _render(local, zone.label)
    return out, warnings


def zones_from_profile(profile: dict) -> list[ZoneSpec]:
    """The profile's `event.display_zones` as ZoneSpec values (empty when absent)."""
    zones = (profile or {}).get("event", {}).get("display_zones") or []
    return [ZoneSpec(z["label"], z["iana"], int(z["fallback_utc_offset_min"])) for z in zones]
