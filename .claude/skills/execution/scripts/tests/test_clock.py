"""The clock (contract/MODULES.md 2 clock, README.md 2 and 7; LANES.md B01).

Protects: strict UTC parsing (a missing Z, an offset or a date-only text is a usage error); formatting and stamps;
display in the profile's zones through zoneinfo, and with the fixed fallback offset plus W_TZ_FALLBACK when the tz
database is missing; EXEC_NOW honoured only with EXEC_TEST=1 (else W_CLOCK_OVERRIDE and the system clock).

Run: python -m unittest discover -s scripts/tests -p "test_clock.py" -v
"""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock
from zoneinfo import ZoneInfoNotFoundError

import _support as S
from execlib import clock, errors
from execlib.errors import UsageError

ZONES = [clock.ZoneSpec("SGT", "Asia/Singapore", 480), clock.ZoneSpec("Paris", "Europe/Paris", 120)]
SUBMISSION = datetime(2026, 10, 7, 15, 59, tzinfo=timezone.utc)


def zoneinfo_available() -> bool:
    try:
        clock._load_zone("Europe/Paris")
        return True
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return False


class Parsing(unittest.TestCase):
    def test_strict_parse(self) -> None:
        self.assertEqual(clock.parse_utc("2026-10-03T07:12:00Z"), S.fixed_now())
        self.assertEqual(clock.parse_utc("2026-10-03T07:12:00.5Z").microsecond, 500000)
        for bad in ("2026-10-03T07:12:00", "2026-10-03T07:12:00+00:00", "2026-10-03", "2026-13-03T07:12:00Z",
                    "2026-10-03 07:12:00Z", "", "yesterday"):
            with self.subTest(text=bad), self.assertRaises(UsageError):
                clock.parse_utc(bad)

    def test_format_and_stamps(self) -> None:
        dt = datetime(2026, 10, 3, 7, 12, 0, 123456, tzinfo=timezone.utc)
        self.assertEqual(clock.format_utc(dt), "2026-10-03T07:12:00Z")
        self.assertEqual(clock.format_utc_precise(dt), "2026-10-03T07:12:00.123456Z")
        self.assertEqual(clock.format_utc_precise(S.fixed_now()), "2026-10-03T07:12:00Z")
        self.assertEqual(clock.stamp(dt), "20261003T071200Z")
        local = dt.astimezone(timezone(timedelta(hours=8)))
        self.assertEqual(clock.format_utc(local), "2026-10-03T07:12:00Z", "aware inputs are converted to UTC")
        with self.assertRaises(ValueError):
            clock.format_utc(datetime(2026, 10, 3))
        self.assertEqual(clock.from_epoch(0), datetime(1970, 1, 1, tzinfo=timezone.utc))
        self.assertEqual(clock.minutes_between(S.fixed_now(), S.fixed_now() + timedelta(minutes=90)), 90.0)
        self.assertEqual(clock.minutes_between(S.fixed_now(), S.fixed_now() - timedelta(minutes=1)), -1.0)


class Display(unittest.TestCase):
    def setUp(self) -> None:
        errors.drain_warnings()

    @unittest.skipUnless(zoneinfo_available(), "the tz database is needed for the zoneinfo case")
    def test_display_with_zoneinfo(self) -> None:
        shown, warnings = clock.display(SUBMISSION, ZONES)
        self.assertEqual(shown, {"SGT": "Wed 7 Oct 23:59 SGT", "Paris": "Wed 7 Oct 17:59 Paris"})
        self.assertEqual(warnings, [])
        after_dst, _w = clock.display(datetime(2026, 10, 26, 12, 0, tzinfo=timezone.utc), ZONES)
        self.assertEqual(after_dst["Paris"], "Mon 26 Oct 13:00 Paris", "zoneinfo follows the end of summer time")

    def test_display_with_fallback_offset(self) -> None:
        def no_db(_iana: str):  # type: ignore[no-untyped-def]
            raise ZoneInfoNotFoundError("no tz database")
        with mock.patch.object(clock, "_load_zone", side_effect=no_db):
            shown, warnings = clock.display(SUBMISSION, ZONES)
        self.assertEqual(shown, {"SGT": "Wed 7 Oct 23:59 SGT", "Paris": "Wed 7 Oct 17:59 Paris"})
        self.assertEqual([w.code for w in warnings], ["W_TZ_FALLBACK", "W_TZ_FALLBACK"])
        self.assertIn("W_TZ_FALLBACK", [w.code for w in errors.drain_warnings()])

    def test_zones_from_profile(self) -> None:
        zones = clock.zones_from_profile(S.build_profile())
        self.assertEqual([(z.label, z.iana, z.fallback_utc_offset_min) for z in zones],
                         [("SGT", "Asia/Singapore", 480), ("Paris", "Europe/Paris", 120)])
        self.assertEqual(clock.zones_from_profile({}), [])


class Override(unittest.TestCase):
    def setUp(self) -> None:
        errors.drain_warnings()

    def test_now_flag_wins(self) -> None:
        self.assertEqual(clock.utcnow("2026-10-05T00:00:00Z"), datetime(2026, 10, 5, tzinfo=timezone.utc))
        self.assertTrue(clock.is_overridden())

    def test_exec_now_needs_exec_test(self) -> None:
        with S.patched_env(EXEC_NOW=S.FIXED_NOW, EXEC_TEST="1"):
            self.assertEqual(clock.utcnow(), S.fixed_now())
            self.assertTrue(clock.is_overridden())
        with S.patched_env(EXEC_NOW=S.FIXED_NOW, EXEC_TEST=None):
            now = clock.utcnow()
            self.assertNotEqual(now, S.fixed_now())
            self.assertFalse(clock.is_overridden())
            self.assertIn("W_CLOCK_OVERRIDE", [w.code for w in errors.drain_warnings()])
        with S.patched_env(EXEC_NOW=None, EXEC_TEST=None):
            real = clock.utcnow()
            self.assertLess(abs((real - datetime.now(timezone.utc)).total_seconds()), 5)
            self.assertEqual(errors.drain_warnings(), [])

    def test_cli_reports_override_warning(self) -> None:
        tmp = S.mkdtemp()
        try:
            env = S.env_isolated(EXEC_TEST=None)
            code, envelope, _logs = S.run_exec(["frobnicate"], cwd=tmp, env=env)
            self.assertEqual(code, 2)
            _code2, env2, _ = S.run_exec(["validate", "--plan", str(tmp / "absent.json")], cwd=tmp, env=env)
            self.assertIn("W_CLOCK_OVERRIDE", [w["code"] for w in env2["warnings"]])
        finally:
            S.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
