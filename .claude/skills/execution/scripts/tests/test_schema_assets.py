"""The 25 delivered schemas against their fixture documents (TESTS.md 3.1 U-SCH-11, U-SCH-12; LANES.md B01).

Protects: every schema loads with only supported keywords; each schema has at least one valid and one invalid
fixture (fixtures/B01/docs/, listed in manifest.json with the expected first issue path); the result-* schemas hold
no $ref (they are inlined into agent() calls).

Run: python -m unittest discover -s scripts/tests -p "test_schema_assets.py" -v
"""
from __future__ import annotations

import json
import unittest

import _support as S
from execlib import schema

SCHEMAS = S.SKILL_DIR / "assets" / "schemas"
DOCS = S.B01_FIXTURES / "docs"
EXPECTED_COUNT = 25


class SchemaAssets(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = json.loads((DOCS / "manifest.json").read_text(encoding="utf-8"))

    def test_twenty_five_schemas_load(self) -> None:
        files = sorted(p.name for p in SCHEMAS.glob("*.schema.json"))
        self.assertEqual(len(files), EXPECTED_COUNT, files)
        reg = schema.Registry()
        for name in files:
            with self.subTest(schema=name):
                doc = reg.get(name)
                self.assertEqual(doc.get("$schema"), "https://json-schema.org/draft/2020-12/schema")

    def test_each_schema_has_ok_and_bad_fixture(self) -> None:
        files = sorted(p.name[: -len(".schema.json")] for p in SCHEMAS.glob("*.schema.json"))
        for name in files:
            with self.subTest(schema=name):
                kinds = {m["valid"] for f, m in self.manifest.items() if m["schema"].split("#")[0] == name}
                self.assertEqual(kinds, {True, False}, f"{name} needs an ok and a bad fixture")
                self.assertTrue((DOCS / f"{name}.ok.json").exists())
                self.assertTrue((DOCS / f"{name}.bad.json").exists())

    def test_fixtures_give_the_expected_result(self) -> None:
        for fname, meta in sorted(self.manifest.items()):
            with self.subTest(fixture=fname):
                doc = json.loads((DOCS / fname).read_text(encoding="utf-8"))
                rep = schema.validate(doc, meta["schema"])
                self.assertEqual(rep.ok, meta["valid"], [i.message for i in rep.issues][:3])
                if not meta["valid"]:
                    self.assertEqual(rep.issues[0].instance_path, meta["first_issue_path"], meta["breaks"])

    def test_effort_is_capped_at_high(self) -> None:
        """README.md section 10, revision 4: a task, a profile override or an agent call carries low|medium|high only;
        the orchestrator's own last_effort in hooks_state keeps xhigh and max."""
        for value, ok in (("low", True), ("medium", True), ("high", True), ("xhigh", False), ("max", False)):
            with self.subTest(defn="common#/$defs/effort", effort=value):
                self.assertEqual(schema.validate(value, "common#/$defs/effort").ok, ok)
        # every carrier: the ok fixture's non-null efforts set to the value under test
        for name in ("plan", "task-template", "wave-manifest", "proof-receipt"):
            base = json.loads((DOCS / f"{name}.ok.json").read_text(encoding="utf-8"))
            for value, ok in (("high", True), ("xhigh", False), ("max", False)):
                with self.subTest(schema=name, effort=value):
                    doc, paths = _set_efforts(base, value)
                    self.assertTrue(paths, f"{name}.ok.json carries no effort")
                    rep = schema.validate(doc, name)
                    self.assertEqual(rep.ok, ok, [i.message for i in rep.issues][:3])
                    if not ok:
                        self.assertIn(rep.issues[0].instance_path, paths)
        profile = json.loads((DOCS / "profile.ok.json").read_text(encoding="utf-8"))
        for value, ok in (("high", True), ("xhigh", False), ("max", False)):
            with self.subTest(schema="profile", effort=value):
                doc = dict(profile, models={"overrides": {"implementer": {"model": "opus", "effort": value}}})
                rep = schema.validate(doc, "profile")
                self.assertEqual(rep.ok, ok, [i.message for i in rep.issues][:3])
                if not ok:
                    self.assertEqual(rep.issues[0].instance_path, "/models/overrides/implementer/effort")
        hooks = json.loads((DOCS / "local-state.hooks-state.ok.json").read_text(encoding="utf-8"))
        for value in ("low", "medium", "high", "xhigh", "max"):
            with self.subTest(defn="hooks_state.last_effort", effort=value):
                rep = schema.validate(dict(hooks, last_effort=value), "local-state#/$defs/hooks_state")
                self.assertTrue(rep.ok, [i.message for i in rep.issues][:3])
        without = {k: v for k, v in hooks.items() if k != "last_effort"}
        self.assertTrue(schema.validate(without, "local-state#/$defs/hooks_state").ok, "last_effort is optional")

    def test_result_schemas_have_no_ref(self) -> None:
        results = sorted(SCHEMAS.glob("result-*.schema.json"))
        self.assertEqual(len(results), 5)
        for path in results:
            with self.subTest(schema=path.name):
                self.assertNotIn('"$ref"', path.read_text(encoding="utf-8"))
        # positive control: the check can see a $ref where there is one
        self.assertIn('"$ref"', (SCHEMAS / "plan.schema.json").read_text(encoding="utf-8"))


def _set_efforts(node: object, value: str, path: str = "") -> tuple[object, list[str]]:
    """A deep copy of `node` with every non-null "effort" set to `value`, and the JSON pointers it changed."""
    if isinstance(node, dict):
        out: dict = {}
        changed: list[str] = []
        for key, sub in node.items():
            here = f"{path}/{key}"
            if key == "effort" and isinstance(sub, str):
                out[key] = value
                changed.append(here)
            else:
                out[key], more = _set_efforts(sub, value, here)
                changed.extend(more)
        return out, changed
    if isinstance(node, list):
        items: list = []
        changed = []
        for i, sub in enumerate(node):
            copy, more = _set_efforts(sub, value, f"{path}/{i}")
            items.append(copy)
            changed.extend(more)
        return items, changed
    return node, []


if __name__ == "__main__":
    unittest.main()
