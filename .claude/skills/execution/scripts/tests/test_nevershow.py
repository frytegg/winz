"""The never-show list (contract/MODULES.md 4 nevershow, SCHEMAS.md 8; TESTS.md 3.11; Q-F9).

Protects, on the rendered fixture file at now = 2026-10-03T07:12:00Z: the live embargo is active and the expired one
inactive, and the live one becomes inactive at its end + 1 s; NFKC + lower() folding (full-width text matches; a
literal `straße` does not match `STRASSE`, because lower() keeps ß like /frontend's toLowerCase); the regex entry is
case-sensitive; the scope filter; a Hit holds the entry id, file and line and never the matched text; an invalid
regex is refused.

Run: python -m unittest discover -s scripts/tests -p "test_nevershow.py" -v
"""
from __future__ import annotations

import dataclasses
import json
import unittest
from datetime import timedelta

import _support as S
from execlib import nevershow, paths
from execlib.errors import ValidationFailed

NS = S.RENDERED / "never-show.json"


def entry(eid: str, pattern: str, *, regex: bool = False, cs: bool = False, scope: str = "both") -> nevershow.Entry:
    return nevershow.Entry(id=eid, cls="never-public", pattern=pattern, regex=regex, case_sensitive=cs, until=None,
                           scope=scope)


class NeverShow(unittest.TestCase):
    def setUp(self) -> None:
        self.entries, self.warnings = nevershow.load(NS)

    def test_live_versus_expired(self) -> None:
        now = S.fixed_now()
        ids = [e.id for e in nevershow.active(self.entries, now)]
        self.assertIn("ns-embargo-live", ids)
        self.assertNotIn("ns-embargo-expired", ids)
        live = next(e for e in self.entries if e.id == "ns-embargo-live")
        self.assertEqual(live.until.isoformat(), "2026-10-04T13:45:00+00:00")  # type: ignore[union-attr]
        later = live.until + timedelta(seconds=1)  # type: ignore[operator]
        self.assertNotIn("ns-embargo-live", [e.id for e in nevershow.active(self.entries, later)])
        self.assertIn("ns-do-not-carry", [e.id for e in nevershow.active(self.entries, later)], "null = forever")

    def test_fold_nfkc_lower_not_casefold(self) -> None:
        live = [e for e in nevershow.active(self.entries, S.fixed_now()) if e.id == "ns-embargo-live"]
        text = "intro\nwe ship with Ｈａｒｂｏｒ ＤＥＳＫ today\n"
        hits = nevershow.scan_text(text, live, file="README.md")
        self.assertEqual([(h.entry_id, h.file, h.line) for h in hits], [("ns-embargo-live", "README.md", 2)])
        self.assertEqual(nevershow.fold("STRASSE"), "strasse")
        self.assertEqual(nevershow.fold("straße"), "straße")
        sharp = [entry("e-sharp", "straße")]
        self.assertEqual(nevershow.scan_text("STRASSE", sharp), [], "lower() keeps ß: no match (Q-F9)")
        self.assertEqual(len(nevershow.scan_text("Straße", sharp)), 1, "positive control")

    def test_regex_case_sensitive(self) -> None:
        regex = [e for e in self.entries if e.id == "ns-never-public-ticket"]
        self.assertEqual(nevershow.scan_text("ticket qc-int-123", regex), [])
        self.assertEqual([h.line for h in nevershow.scan_text("ok\nticket QC-INT-123", regex)], [2])
        insensitive = [entry("e-ci", r"\bqc-int-[0-9]+", regex=True, cs=False)]
        self.assertEqual(len(nevershow.scan_text("QC-INT-9", insensitive)), 1, "IGNORECASE when not sensitive")

    def test_scope_filter(self) -> None:
        now = S.fixed_now()
        rendered = [e.id for e in nevershow.active(self.entries, now, frozenset({"rendered", "both"}))]
        repo = [e.id for e in nevershow.active(self.entries, now)]
        self.assertNotIn("ns-never-public-ticket", rendered)
        self.assertIn("ns-never-public-ticket", repo)
        self.assertIn("ns-embargo-live", rendered)

    def test_hit_never_carries_text(self) -> None:
        live_text = S.planted("nevershow.live")
        fields = {f.name for f in dataclasses.fields(nevershow.Hit)}
        self.assertEqual(fields, {"entry_id", "file", "line"})
        hits = nevershow.scan_lines([("docs/a.md", 7, f"the {live_text} launch")],
                                    nevershow.active(self.entries, S.fixed_now()))
        self.assertEqual(len(hits), 1)
        self.assertNotIn(live_text.lower(), json.dumps([dataclasses.asdict(h) for h in hits]).lower())
        self.assertEqual(nevershow.scan_lines([("docs/a.md", 7, "nothing here")],
                                              nevershow.active(self.entries, S.fixed_now())), [])

    def test_invalid_file_and_regex(self) -> None:
        tmp = S.mkdtemp()
        try:
            doc = json.loads(NS.read_text(encoding="utf-8"))
            doc["entries"][3]["pattern"] = "(unclosed"
            path = S.write_json(tmp / "ns.json", doc)
            with self.assertRaises(ValidationFailed):
                nevershow.load(path)
            doc["entries"][3]["pattern"] = "fine"
            doc["entries"][0]["until_utc"] = None
            path = S.write_json(tmp / "ns.json", doc)
            with self.assertRaises(ValidationFailed):
                nevershow.load(path)
        finally:
            S.rmtree(tmp)

    def test_frontend_schema_drift_warning(self) -> None:
        tmp = S.mkdtemp()
        old = paths._SKILLS_ROOT_OVERRIDE
        try:
            paths._SKILLS_ROOT_OVERRIDE = tmp
            target = tmp / "frontend" / "assets" / "schemas" / "never-show.schema.json"
            S.write_json(target, {"type": "object", "required": ["version", "entries", "owner"]})
            _entries, warnings = nevershow.load(NS)
            self.assertEqual([w.code for w in warnings], ["W_NEVER_SHOW_SCHEMA_DRIFT"])
            S.write_json(target, json.loads((S.SKILL_DIR / "assets/schemas/never-show.schema.json")
                                            .read_text(encoding="utf-8")))
            _entries, warnings = nevershow.load(NS)
            self.assertEqual(warnings, [], "the same verdict: no drift")
        finally:
            paths._SKILLS_ROOT_OVERRIDE = old
            S.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
