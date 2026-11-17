"""The French wave report, EXECUTION.md, the push texts and the hand-over and approval templates (contract/TESTS.md
3.9, NOTION.md 9, CLI.md `report`, LANES.md B09).

Protects: the golden W03 report (fixtures/B09/wave-W03 -> golden/W03.fr.md); the six headings in order; single
column (no table wider than two columns, no line over 100 characters); every instant in SGT and Paris; Prouvé only
with a valid receipt (a done task without one is an "incohérence" line); ≤ 6,000 characters with lists cut at 8;
the push text (≤ 200 characters, naming the task) only when the owner has something to do; "inconnu" instead of a
number when the schedule cache is gone; "non mesuré" instead of 0 for a missing reading; EXECUTION.md in TASKLIST
style; byte-identical reruns.

Golden regeneration (TESTS.md 1.6): EXEC_UPDATE_GOLDEN=1 writes golden/W03.fr.md.new and fails; review, then rename.

Run: python -m unittest discover -s scripts/tests -p "test_report.py" -v
"""
from __future__ import annotations

import json
import os
import re
import unittest
from unittest import mock

import _support as S
import _support_B09 as B
from execlib import clock, jsonio, report
from execlib.errors import InternalError

HEADINGS = ["## Fait", "## Prouvé", "## Ouvert", "## Ta prochaine action", "## Zone et P80", "## Pouls"]


def _tz_data() -> bool:
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo("Asia/Singapore")
        ZoneInfo("Europe/Paris")
        return True
    except Exception:  # noqa: BLE001 - any failure means the golden's zone names cannot be reproduced here
        return False


def _report(layout, *extra: str, now: str | None = None) -> tuple[int, dict]:
    return B.run_cli(["report", *B.state_args(layout, now or B.wave_scenario()["now"]), *extra])


class WaveReport(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.root)

    @unittest.skipUnless(_tz_data(), "the golden is rendered with the IANA zones (no tz database here)")
    def test_golden_w03(self) -> None:
        layout = B.build_wave_state(self.root)
        code, env = _report(layout, "--wave", "W03")
        self.assertEqual(code, 0, env)
        text = env["data"]["text_fr"]
        self.assertEqual(layout.report("W03").read_text(encoding="utf-8"), text)
        golden = B.GOLDEN / "W03.fr.md"
        if os.environ.get("EXEC_UPDATE_GOLDEN") == "1":
            S.write_text(B.GOLDEN / "W03.fr.md.new", text)
            self.fail("EXEC_UPDATE_GOLDEN=1: wrote golden/W03.fr.md.new; review it and rename")
        self.assertEqual(text.encode("utf-8"), golden.read_bytes())

    def test_structure_single_column_and_zones(self) -> None:
        layout = B.build_wave_state(self.root)
        code, env = _report(layout, "--wave", "W03")
        self.assertEqual(code, 0)
        text = env["data"]["text_fr"]
        lines = text.rstrip("\n").split("\n")
        self.assertEqual([ln for ln in lines if ln.startswith("## ")], HEADINGS)
        self.assertTrue(lines[0].startswith("<callout color=\"yellow_bg\">"))
        self.assertEqual(sum(1 for ln in lines if ln.startswith("<callout")), 1, "one callout")
        for ln in lines:
            self.assertLessEqual(len(ln), 100, ln)
            if ln.lstrip().startswith("|"):
                self.assertLessEqual(ln.count("|") - 1, 2, f"table wider than 2 columns: {ln}")
        for ln in lines:
            if "SGT" in ln:
                self.assertIn("Paris", ln, f"an instant shown in one zone only: {ln}")
        self.assertNotRegex(text, r"[0-9]{2}:[0-9]{2}:[0-9]{2}Z", "never UTC alone")
        self.assertLessEqual(len(text), 6000)
        self.assertIn("- T004 · Status page with the queue clock — intégrée 3c4d5e6f, en vérification", text)
        self.assertIn("`proofs/T001.json`", text)
        self.assertIn("`proofs/T002.json`", text)
        self.assertIn("1. T003 · Ouvre le portefeuille preprod", text)
        self.assertIn("téléphone", text)
        self.assertIn("Disque libre 3,1 Go (plancher 2,0 Go) · RAM libre 1,9 Go", text)
        self.assertIn("Quota 5 h : 62 %", text)
        self.assertIn("Quota semaine : 71 %", text)
        self.assertIn("À l'heure avec 64 % de chances · zone jaune", text)
        self.assertIn("mer. 7 oct. 09:40 SGT · 03:40 Paris", text)
        self.assertIn("durée 1 h 05", text)
        push = env["data"]["push_text_fr"]
        self.assertIsNotNone(push)
        self.assertLessEqual(len(push), 200)
        self.assertIn("T003", push)
        self.assertTrue(env["data"]["notion"].endswith("notion diff --wave W03"))

    def test_incoherent_done_task_is_never_proven(self) -> None:
        layout = B.build_wave_state(self.root, incoherent="T001")
        _c, env = _report(layout, "--wave", "W03")
        text = env["data"]["text_fr"]
        prouve = text.split("## Prouvé\n", 1)[1].split("## Ouvert", 1)[0]
        self.assertNotIn("T001", prouve)
        self.assertIn("T002", prouve, "positive control: the task with its receipt is proven")
        self.assertIn("- incohérence : T001 marquée prouvée sans reçu valide", text)

    def test_receipt_for_another_sha_is_incoherent(self) -> None:
        layout = B.build_wave_state(self.root)
        doc = json.loads(layout.receipt("T002").read_text(encoding="utf-8"))
        doc["sha"] = "9" * 40
        jsonio.write_json_atomic(layout.receipt("T002"), doc)
        _c, env = _report(layout, "--wave", "W03")
        self.assertIn("incohérence : T002", env["data"]["text_fr"])

    def test_missing_schedule_cache_is_unknown_never_a_number(self) -> None:
        layout = B.build_wave_state(self.root, drop_schedule=True)
        _c, env = _report(layout, "--wave", "W03")
        text = env["data"]["text_fr"]
        zone = text.split("## Zone et P80\n", 1)[1].split("## Pouls", 1)[0]
        self.assertIn("zone inconnue", zone)
        for label in ("P50", "P80", "P90"):
            line = next(ln for ln in zone.split("\n") if f"Fin de build {label}" in ln)
            self.assertTrue(line.endswith("inconnu"), line)
        self.assertNotIn("%", zone)
        self.assertIn("Chemin critique : inconnu", zone)
        self.assertTrue(text.startswith("<callout color=\"gray_bg\">\n\t**Zone inconnue**"))
        # positive control: with the cache the same lines carry instants and a percentage
        layout2 = B.build_wave_state(self.root / "with")
        _c, env2 = _report(layout2, "--wave", "W03")
        self.assertIn("64 %", env2["data"]["text_fr"])

    def test_stale_schedule_cache_is_unknown(self) -> None:
        layout = B.build_wave_state(self.root)
        cache = json.loads(layout.schedule_cache.read_text(encoding="utf-8"))
        cache["plan_sha256"] = "f" * 64
        jsonio.write_json_atomic(layout.schedule_cache, cache)
        _c, env = _report(layout, "--wave", "W03")
        self.assertIn("zone inconnue", env["data"]["text_fr"])

    def test_missing_readings_are_non_mesure(self) -> None:
        layout = B.build_wave_state(self.root)
        local = json.loads(layout.local_state.read_text(encoding="utf-8"))
        local["governor"] = None
        local["quota"] = None
        local["last_tick_utc"] = None
        jsonio.write_json_atomic(layout.local_state, local)
        _c, env = _report(layout, "--wave", "W03")
        pouls = env["data"]["text_fr"].split("## Pouls\n", 1)[1]
        self.assertIn("Disque libre non mesuré", pouls)
        self.assertIn("RAM libre non mesuré", pouls)
        self.assertIn("Quota 5 h : non mesuré", pouls)
        self.assertIn("Dernier tick : non mesuré", pouls)
        self.assertNotRegex(pouls, r"libre 0|: 0 %|0 min", "a missing reading never renders as 0")

    def test_nothing_to_do_means_no_push(self) -> None:
        sc = B.wave_scenario()
        sc["awaiting"] = []
        for t in sc["tasks"]:
            if t["id"] == "T003":
                t["status"] = "done"
                t["wave"] = None
        layout = B.build_wave_state(self.root, sc)
        _c, env = _report(layout, "--wave", "W03")
        self.assertIsNone(env["data"]["push_text_fr"])
        self.assertIn("## Ta prochaine action\nRien à faire pour l'instant.\n", env["data"]["text_fr"])

    def test_empty_lists_render_rien(self) -> None:
        sc = B.wave_scenario()
        sc["wave"] = "W04"
        sc["wave_entry"] = dict(sc["wave_entry"], wave="W04")
        layout = B.build_wave_state(self.root, sc)
        _c, env = _report(layout, "--wave", "W04")
        text = env["data"]["text_fr"]
        self.assertIn("## Fait\nRien.\n## Prouvé\nRien.\n## Ouvert", text)

    def test_long_lists_are_cut_at_8_and_text_capped(self) -> None:
        layout = B.build_wave_state(self.root, extra_tasks=40)
        _c, env = _report(layout, "--wave", "W03")
        text = env["data"]["text_fr"]
        self.assertLessEqual(len(text), 6000)
        self.assertIn("- … et 32 autres (voir EXECUTION.md)", text)
        for ln in text.split("\n"):
            self.assertLessEqual(len(ln), 100, ln)

    def test_idempotent_byte_identical(self) -> None:
        layout = B.build_wave_state(self.root)
        _report(layout, "--wave", "W03")
        first = (layout.report("W03").read_bytes(), layout.execution_md.read_bytes())
        _report(layout, "--wave", "W03")
        second = (layout.report("W03").read_bytes(), layout.execution_md.read_bytes())
        self.assertEqual(first, second)

    def test_default_wave_and_bad_wave(self) -> None:
        layout = B.build_wave_state(self.root)
        code, env = _report(layout)
        self.assertEqual(code, 0)
        self.assertEqual(env["data"]["report_path"], "reports/W03.fr.md")
        code, env = _report(layout, "--wave", "nope")
        self.assertEqual(code, 2)

    def test_cli_subprocess_envelope_and_event(self) -> None:
        layout = B.build_wave_state(self.root)
        code, env, logs = S.run_exec(["report", "--wave", "W03", *B.state_args(layout, B.wave_scenario()["now"])],
                                     cwd=self.root)
        self.assertEqual(code, 0, env)
        self.assertLessEqual(len(env["data"]["text_fr"]), 6000)
        events = [json.loads(x) for x in layout.events.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(events[-1]["type"], "report.written")
        self.assertEqual(events[-1]["data"]["wave"], "W03")
        self.assertTrue(all("ts" in entry for entry in logs))

    def test_fallback_zone_label(self) -> None:
        zones = clock.zones_from_profile(S.build_profile())
        dt = clock.parse_utc("2026-10-07T15:59:00Z")

        def no_tz(_iana: str):  # type: ignore[no-untyped-def]
            from zoneinfo import ZoneInfoNotFoundError
            raise ZoneInfoNotFoundError("no tz database")

        with mock.patch.object(clock, "_load_zone", no_tz):
            text = report.fr_display(dt, zones)
        self.assertEqual(text, "mer. 7 oct. 23:59 SGT (décalage fixe) · 17:59 Paris (décalage fixe)")
        self.assertEqual(report.fr_display(dt, zones), "mer. 7 oct. 23:59 SGT · 17:59 Paris") if _tz_data() \
            else None


class ExecutionMd(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.root)

    def test_view_writes_tasklist_style(self) -> None:
        layout = B.build_wave_state(self.root)
        code, env = _report(layout, "--view")
        self.assertEqual(code, 0)
        self.assertIsNone(env["data"]["report_path"])
        self.assertFalse(layout.report("W03").exists(), "--view regenerates EXECUTION.md only")
        text = layout.execution_md.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("# EXECUTION — Queue Clock: the build is not finished until every box is "
                                        "ticked\n"))
        self.assertIn("- [x] **C** — **T001** Queue length endpoint", text)
        self.assertIn("- [ ] **A** — **T003** Fund the preprod wallet", text)
        self.assertIn("latest: 2026-10-06T09:00:00Z (Tue 6 Oct 17:00 SGT, Tue 6 Oct 11:00 Paris)", text) \
            if _tz_data() else None
        self.assertIn("status: done, receipt `proofs/T001.json`", text)
        self.assertIn("proof: command (the task's tests pass)", text)
        self.assertIn("Progress: 2/6 tasks done.", text)
        self.assertEqual(text.count("- [x]"), 2)
        self.assertNotRegex(text, r"[éèàù]", "EXECUTION.md is English")
        _report(layout, "--view")
        self.assertEqual(layout.execution_md.read_text(encoding="utf-8"), text, "idempotent")


class Templates(unittest.TestCase):
    def test_unknown_placeholder_is_a_template_bug(self) -> None:
        with self.assertRaises(InternalError):
            report.render_template("- {{nope}}", {})
        self.assertEqual(report.render_template("- {{yes}}", {"yes": "ok"}), "- ok")

    def test_repeat_syntax(self) -> None:
        tpl = "{{#a}}- {{x}}{{/a}}\n{{*b}}- {{x}}{{/b}}\n{{#c|vide}}- {{x}}{{/c}}"
        self.assertEqual(report.render_template(tpl, {}, lists={"a": [], "b": [], "c": []}), "Rien.\nvide")
        self.assertEqual(report.render_template(tpl, {}, lists={"a": [{"x": 1}], "b": [{"x": 2}], "c": [{"x": 3}]}),
                         "- 1\n- 2\n- 3")

    def test_fit_line_cuts_title_first_never_the_link(self) -> None:
        fmt = "- {{task_id}} · {{title}} — [preuve]({{url}}) · {{verifier}}"
        item = {"task_id": "T001", "title": "A" * 80, "url": "https://example.invalid/" + "x" * 10,
                "verifier": "execution-verifier"}
        line = report.fit_line(fmt, item, ("title", "verifier"), "t")
        self.assertLessEqual(len(line), 100)
        self.assertIn(item["url"], line)
        self.assertIn("…", line)
        self.assertIn("execution-verifier", line, "the title absorbed the whole cut")

    def test_push_texts(self) -> None:
        stuck = report.stuck_push_fr("Queue Clock")
        self.assertEqual(stuck, "execution BLOQUÉ : Queue Clock a besoin de toi à l'ordinateur")
        doc = report.push_templates()
        self.assertIn("stuck", doc)
        for name, text in doc.items():
            if name in ("schema", "description"):
                continue
            rendered = report.render_push(name, {k: "x" * 40 for k in re.findall(r"\{\{([a-z0-9_]+)\}\}", text)})
            self.assertLessEqual(len(rendered), 200, name)

    def test_handover_text(self) -> None:
        values = {"project": "Queue Clock", "final_sha": "1" * 40, "completion_at": "mer. 7 oct. 09:40 SGT · 03:40 "
                  "Paris", "completion_report": "local/completion/x.json", "harden_ready_at": "mer. 7 oct.",
                  "harden_ready_report": "local/harden-ready/x.json", "harden_end_latest": "mer. 7 oct. 20:00 SGT",
                  "minutes_left": 300, "harden_budget_min": 240, "disk_free_gb": "6,2", "disk_need_gb": "3,0",
                  "profile_step": "Relis le brouillon.", "repo": "C:/x/qc/repo", "type_this": "/harden",
                  "scope_note": "", "open_after_harden": "T020 · Vidéo", "final_sha8": "11111111",
                  "type_this_short": "/harden", "harden_start_latest": "mer. 7 oct. 15:00 SGT"}
        text, push = report.render_handover_fr(values)
        self.assertTrue(text.startswith("# Prêt pour /harden · Queue Clock\n"))
        self.assertIn("   `/harden`", text)
        self.assertIn("/execution --fix C:/x/qc/repo/.harden/report.md", text)
        self.assertEqual(push, "Build prouvé (11111111). Tape /harden avant mer. 7 oct. 15:00 SGT. Détails dans le hub.")
        with self.assertRaises(InternalError):
            report.render_handover_fr({k: v for k, v in values.items() if k != "repo"})

    def test_approval_summary(self) -> None:
        values = {"project": "Queue Clock", "plan_version": 1, "n_tasks": 30, "n_agent": 24, "n_manual": 4,
                  "n_decisions": 2, "p50": "mar. 6 oct. 22:00 SGT", "p80": "mer. 7 oct. 01:40 SGT",
                  "p90": "mer. 7 oct. 03:15 SGT", "decision_id": "D-002", "recommended": "approve"}
        text = report.render_approval_fr(values, manual_tasks=[{"task_id": "T003", "title": "Fund the wallet",
                                                                  "latest": "mar. 6 oct. 17:00 SGT"}],
                                         decision_gates=[], risks=[{"text": "quota hebdomadaire à 71 %"}],
                                         critical_path=["T003", "T006"])
        self.assertIn("# Plan à approuver · Queue Clock", text)
        self.assertIn("- Chemin critique : T003, T006", text)
        self.assertIn("## Décisions prévues\nRien.\n", text)
        self.assertIn("D-002", text)
        for ln in text.split("\n"):
            self.assertLessEqual(len(ln), 100, ln)


class Numbers(unittest.TestCase):
    def test_french_numbers(self) -> None:
        self.assertEqual(report.fr_number(6.25), "6,2")
        self.assertEqual(report.fr_number(3.1), "3,1")
        self.assertEqual(report.fr_unit(None, "Go"), "non mesuré")
        self.assertEqual(report.fr_unit(0, "Go"), "0,0 Go", "a measured zero stays a number")
        self.assertEqual(report.fr_pct(71.5), "72")
        self.assertEqual(report.fr_duration_min(65), "1 h 05")
        self.assertEqual(report.fr_duration_min(42), "42 min")
        self.assertAlmostEqual(report.lognormal_p80(26.7, 46.0), 26.7 * pow(46.0 / 26.7, 0.8416 / 1.2816), places=6)


if __name__ == "__main__":
    unittest.main()
