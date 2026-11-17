"""Posting manual and decision tasks (contract/CLI.md `manual post`, ARCHITECTURE.md 11, NOTION.md 2.4, TESTS.md 3.7,
LANES.md B04).

Run: python -m unittest discover -s scripts/tests -p "test_manual.py" -v
"""
from __future__ import annotations

import json
import re
import unittest
from unittest import mock

import _support as S
from _support_B04 import World

from execlib import decisionsio, manual
from execlib.model import Task

FRENCH = ("À faire", "Décision", "Réponds par Remote Control ou dans Notion")
PUSH_FR = S.SKILL_DIR / "assets" / "report-templates" / "push.fr.json"


def static_parts(template: str) -> list[str]:
    """The fixed text of a push.fr.json phrase, between its {{placeholders}}."""
    return [p for p in re.split(r"\{\{[a-z_0-9]+\}\}", template) if p]


class PushText(unittest.TestCase):
    @unittest.skipUnless(PUSH_FR.exists(), "lane B09's push.fr.json is not in the tree")
    def test_push_follows_the_phrases_of_push_fr_json(self) -> None:
        """TESTS.md 3.7: the push text is push.fr.json's `manual` / `decision` phrase, filled, ≤ 200 characters,
        naming the task id; the planner's own push_text wins only when it names the id."""
        doc = json.loads(PUSH_FR.read_text(encoding="utf-8"))
        prof = S.build_profile()
        project = prof["project"]["name"]
        for kind in ("manual", "decision"):
            template = doc[kind]
            for title in ("Signer la transaction de test", "x" * 400):
                task = Task.from_raw(S.build_task("T042", kind=kind, title=title))
                text = manual.push_text_fr(task, prof)
                self.assertLessEqual(len(text), 200, text)
                self.assertIn("T042", text)
                self.assertTrue(text.startswith(project), text)
                at = 0
                for part in static_parts(template):  # every fixed phrase, in the template's order
                    found = text.find(part, at)
                    self.assertGreaterEqual(found, 0, f"{kind}: {part!r} missing from {text!r}")
                    at = found + len(part)
                self.assertNotIn("{{", text)
                if len(title) < 50:
                    self.assertIn(title, text)
            self.assertNotEqual(manual.push_text_fr(Task.from_raw(S.build_task("T042", kind=kind)), prof),
                                manual.push_text_fr(Task.from_raw(S.build_task("T042", kind="manual" if kind ==
                                                                               "decision" else "decision")), prof))

    def test_builtin_phrase_when_push_fr_json_is_absent(self) -> None:
        prof = S.build_profile()
        with mock.patch.object(manual, "PUSH_FR_PATH", S.SKILL_DIR / "no-such-push.fr.json"):
            for kind in ("manual", "decision"):
                for title in ("Signer la transaction de test", "x" * 400):
                    task = Task.from_raw(S.build_task("T042", kind=kind, title=title))
                    text = manual.push_text_fr(task, prof)
                    self.assertLessEqual(len(text), 200, text)
                    self.assertIn("T042", text)
                    self.assertTrue(any(p in text for p in FRENCH), text)

    def test_the_planners_push_text_is_kept_when_it_names_the_id(self) -> None:
        raw = S.build_task("T007", kind="manual")
        raw["manual"]["push_text"] = "T007 : photo du reçu, s'il te plaît."
        self.assertEqual(manual.push_text_fr(Task.from_raw(raw), None), "T007 : photo du reçu, s'il te plaît.")
        raw["manual"]["push_text"] = "Photo du reçu."  # does not name the id: rebuilt
        self.assertIn("T007", manual.push_text_fr(Task.from_raw(raw), None))


class Post(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.w = World()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.w.cleanup()

    def setUp(self) -> None:
        self.w.reset()
        self.w.set_status("T003", "ready")

    def test_post_then_idempotent_without_repost(self) -> None:
        w = self.w
        code, env, _l = w.run(["manual", "post", "--task", "T003"])
        self.assertEqual(code, 0, env)
        posted = env["data"]["posted"]
        self.assertEqual([p["task"] for p in posted], ["T003"])
        self.assertLessEqual(len(posted[0]["push_text_fr"]), 200)
        self.assertIn("T003", posted[0]["push_text_fr"])
        self.assertEqual(w.entry("T003")["status"], "running")
        self.assertIn("T003", [a["ref"] for a in w.local_state()["awaiting"]])
        before = w.status_bytes()
        code, env, _l = w.run(["manual", "post", "--task", "T003"])
        self.assertEqual(code, 0, env)
        self.assertEqual((env["data"]["posted"], env["data"]["already_posted"]), ([], ["T003"]))
        self.assertEqual(w.status_bytes(), before)
        code, env, _l = w.run(["manual", "post", "--task", "T003", "--repost"])
        self.assertEqual(code, 0, env)
        self.assertEqual(w.entry("T003")["posted"]["reposts"], 1)

    def test_all_ready_and_link(self) -> None:
        w = self.w
        w.set_status("T004", "ready")
        code, env, _l = w.run(["manual", "post", "--all-ready", "--link", "https://claude.ai/x"])
        self.assertEqual(code, 0, env)
        self.assertEqual(sorted(p["task"] for p in env["data"]["posted"]), ["T003", "T004"])
        self.assertTrue(all(p["link"] == "https://claude.ai/x" for p in env["data"]["posted"]))

    def test_a_ready_agent_task_is_not_posted(self) -> None:
        self.w.set_status("T001", "ready")
        code, env, _l = self.w.run(["manual", "post", "--task", "T001"])
        self.assertEqual(code, 2, env)

    def test_decision_task_opens_its_proposal_from_the_options_source(self) -> None:
        w = self.w
        folder = w.root / "directions"
        for name in ("A", "B", "C", "generic"):
            (folder / name).mkdir(parents=True)
        raw = S.build_task("T004", kind="decision", params={"decision_kind": "plan-task"})
        raw["manual"] = dict(raw["manual"], options=[], options_source=folder.as_posix())
        w.reset([raw])
        w.set_status("T004", "ready")
        code, env, _l = w.run(["manual", "post", "--task", "T004"])
        self.assertEqual(code, 0, env)
        did = w.entry("T004")["decision"]
        proposal, _res = decisionsio.find(w.layout, did)
        self.assertEqual([o["id"] for o in proposal["options"]], ["a", "b", "c"])
        self.assertEqual((proposal["kind"], proposal["tasks"]), ("plan-task", ["T004"]))

    def test_fix_selection_kind_from_the_template(self) -> None:
        w = self.w
        raw = S.build_task("T004", kind="decision", params={"decision_kind": "fix-selection"})
        w.reset([raw])
        w.set_status("T004", "ready")
        code, env, _l = w.run(["manual", "post", "--task", "T004"])
        self.assertEqual(code, 0, env)
        proposal, _res = decisionsio.find(w.layout, w.entry("T004")["decision"])
        self.assertEqual(proposal["kind"], "fix-selection")


if __name__ == "__main__":
    unittest.main()
