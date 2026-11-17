"""The JSON Schema subset validator (contract/MODULES.md 3, TESTS.md 3.1 U-SCH-01..10, 12, 13).

Protects: type semantics (bool is never an integer), JSON equality for enum/const, $ref pointers across files with
~0/~1 escapes, the ref-depth guard, if/then/else, oneOf "exactly one", additionalProperties with patternProperties,
propertyNames, x-external collection and run_externals (a missing schema is reported, never a pass), unsupported
keywords (ours: E_SCHEMA_KEYWORD exit 3; another skill's: W_SCHEMA_UNSUPPORTED_KEYWORD, skipped), issue ordering.

Run: python -m unittest discover -s scripts/tests -p "test_schema.py" -v
"""
from __future__ import annotations

import contextlib
import io
import json
import shutil
import unittest
from pathlib import Path

import _support as S
from execlib import envelope, paths, schema
from execlib.errors import InternalError, ValidationFailed
from execlib.model import CommandResult

SCHEMAS = S.SKILL_DIR / "assets" / "schemas"


def ok(inst: object, sch: dict) -> bool:
    return schema.validate_with(inst, sch, base_dir=SCHEMAS).ok


class TempSchemas(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.dir)

    def put(self, name: str, doc: dict) -> None:
        S.write_json(self.dir / name, doc)


class TypeAndEquality(unittest.TestCase):
    def test_u_sch_01_integer_type(self) -> None:
        sch = {"type": "integer"}
        self.assertEqual([ok(v, sch) for v in (True, 1, 1.0, 1.5)], [False, True, True, False])
        self.assertEqual([ok(v, {"type": "number"}) for v in (True, 1, 2.5, "1")], [False, True, True, False])
        self.assertTrue(ok(None, {"type": ["string", "null"]}))
        self.assertFalse(ok(0, {"type": ["string", "null"]}))

    def test_u_sch_02_enum_const_json_equality(self) -> None:
        self.assertTrue(ok(1.0, {"enum": [1]}))
        self.assertFalse(ok(True, {"enum": [1]}))
        self.assertTrue(ok({"a": [1, 2]}, {"const": {"a": [1, 2]}}))
        self.assertFalse(ok({"a": [2, 1]}, {"const": {"a": [1, 2]}}))
        self.assertFalse(ok(1, {"const": True}))
        self.assertTrue(ok(None, {"enum": ["x", None]}))

    def test_type_specific_keywords_ignore_other_types(self) -> None:
        sch = {"type": ["string", "null"], "pattern": "^[0-9a-f]{16}$", "minLength": 16}
        self.assertTrue(ok(None, sch))
        self.assertTrue(ok("0123456789abcdef", sch))
        self.assertFalse(ok("xyz", sch))
        self.assertTrue(ok("é" * 3, {"maxLength": 3}))  # code points, not bytes

    def test_numbers_arrays_unique(self) -> None:
        self.assertFalse(ok(0, {"exclusiveMinimum": 0}))
        self.assertTrue(ok(0, {"minimum": 0}))
        self.assertFalse(ok(31, {"maximum": 30}))
        self.assertFalse(ok([1, 1.0], {"uniqueItems": True}))
        self.assertTrue(ok([1, True], {"uniqueItems": True}))
        self.assertFalse(ok([1], {"minItems": 2}))
        self.assertFalse(ok([1, "a"], {"items": {"type": "integer"}}))


class Refs(TempSchemas):
    def test_u_sch_03_refs_across_files_and_deep_pointers(self) -> None:
        reg = schema.Registry(SCHEMAS)
        good = schema.validate({"model": "opus", "effort": "high"}, "plan#/$defs/task/properties/verify",
                               registry=reg)
        self.assertTrue(good.ok, good.issues)
        badr = schema.validate({"model": "gpt", "effort": "high"}, "plan#/$defs/task/properties/verify",
                               registry=reg)
        self.assertFalse(badr.ok)
        self.assertEqual(badr.issues[0].instance_path, "/model")
        self.assertTrue(badr.issues[0].message.startswith("/model:"))
        shutil.copy(SCHEMAS / "common.schema.json", self.dir / "common.schema.json")
        self.put("t.schema.json", {"type": "object", "properties": {
            "at": {"$ref": "common.schema.json#/$defs/utc"},
            "odd": {"$ref": "#/$defs/a~1b~0c"}},
            "$defs": {"a/b~c": {"type": "integer"}}})
        reg2 = schema.Registry(self.dir)
        self.assertTrue(schema.validate({"at": S.FIXED_NOW, "odd": 3}, "t", registry=reg2).ok)
        rep = schema.validate({"at": "2026-10-03 07:12", "odd": "x"}, "t", registry=reg2)
        self.assertEqual([i.instance_path for i in rep.issues], ["/at", "/odd"])
        self.assertIn("common.schema.json#/$defs/utc", rep.issues[0].schema_path)

    def test_ref_with_siblings_applies_both(self) -> None:
        self.put("s.schema.json", {"$defs": {"n": {"type": "integer"}}, "$ref": "#/$defs/n", "minimum": 5})
        reg = schema.Registry(self.dir)
        self.assertTrue(schema.validate(7, "s", registry=reg).ok)
        self.assertFalse(schema.validate(3, "s", registry=reg).ok)
        self.assertFalse(schema.validate("7", "s", registry=reg).ok)

    def test_u_sch_04_ref_cycle_depth(self) -> None:
        self.put("cyc.schema.json", {"$defs": {"a": {"$ref": "#/$defs/b"}, "b": {"$ref": "#/$defs/a"}},
                                     "$ref": "#/$defs/a"})
        reg = schema.Registry(self.dir)
        with self.assertRaises(ValidationFailed) as cm:
            schema.validate({}, "cyc", registry=reg)
        self.assertEqual(cm.exception.code, "E_SCHEMA_DEPTH")
        self.assertEqual(schema.MAX_REF_DEPTH, 64)
        # positive control: a finite chain of refs resolves
        self.put("chain.schema.json", {"$defs": {"a": {"$ref": "#/$defs/b"}, "b": {"type": "string"}},
                                       "$ref": "#/$defs/a"})
        self.assertTrue(schema.validate("x", "chain", registry=reg).ok)


class Combinators(unittest.TestCase):
    def test_u_sch_05_if_then_else_embargo(self) -> None:
        entry = json.loads((S.RENDERED / "never-show.json").read_text(encoding="utf-8"))
        good = schema.validate(entry, "never-show")
        self.assertTrue(good.ok, good.issues)
        entry["entries"][0]["until_utc"] = None
        badr = schema.validate(entry, "never-show")
        self.assertFalse(badr.ok)
        self.assertEqual(badr.issues[0].instance_path, "/entries/0/until_utc")
        sch = {"if": {"properties": {"k": {"const": "a"}}}, "then": {"required": ["x"]}, "else": {"required": ["y"]}}
        self.assertTrue(ok({"k": "a", "x": 1}, sch))
        self.assertFalse(ok({"k": "a", "y": 1}, sch))
        self.assertTrue(ok({"k": "b", "y": 1}, sch))
        self.assertFalse(ok({"k": "b", "x": 1}, sch))

    def test_u_sch_05_one_of_exactly_one(self) -> None:
        sch = {"oneOf": [{"type": "integer"}, {"minimum": 0}]}
        rep = schema.validate_with(3, sch, base_dir=SCHEMAS)
        self.assertFalse(rep.ok)
        self.assertIn("exactly one", rep.issues[0].message)
        self.assertTrue(ok(-1, sch))
        self.assertTrue(ok(2.5, sch))
        self.assertFalse(ok("x", {"oneOf": [{"type": "integer"}, {"type": "null"}]}))

    def test_not_and_all_of(self) -> None:
        self.assertFalse(ok(1, {"not": {"type": "integer"}}))
        self.assertTrue(ok("1", {"not": {"type": "integer"}}))
        self.assertFalse(ok(5, {"allOf": [{"minimum": 0}, {"maximum": 3}]}))

    def test_u_sch_06_additional_and_pattern_properties(self) -> None:
        sch = {"type": "object", "properties": {"a": {"type": "integer"}},
               "patternProperties": {"^x-": {"type": "string"}}, "additionalProperties": False}
        self.assertTrue(ok({"a": 1, "x-note": "n"}, sch))
        rep = schema.validate_with({"a": 1, "b": 2}, sch, base_dir=SCHEMAS)
        self.assertEqual([(i.instance_path, i.keyword) for i in rep.issues], [("/b", "additionalProperties")])
        self.assertFalse(ok({"x-note": 3}, sch))
        names = {"type": "object", "propertyNames": {"pattern": "^T[0-9]{3,}$"}}
        self.assertTrue(ok({"T001": 1}, names))
        rep2 = schema.validate_with({"T001": 1, "X1": 2}, names, base_dir=SCHEMAS)
        self.assertEqual([i.instance_path for i in rep2.issues], ["/X1"])
        sized = {"minProperties": 1, "maxProperties": 1}
        self.assertFalse(ok({}, sized))
        self.assertFalse(ok({"a": 1, "b": 2}, sized))
        self.assertTrue(ok({"a": 1}, sized))

    def test_u_sch_10_ordering_and_any_of_branch(self) -> None:
        sch = {"type": "object", "properties": {"b": {"type": "integer"}, "a": {"type": "integer"}},
               "required": ["z"]}
        rep = schema.validate_with({"b": "x", "a": "y"}, sch, base_dir=SCHEMAS)
        self.assertEqual([i.instance_path for i in rep.issues], ["", "/a", "/b"])
        any_of = {"anyOf": [{"type": "object", "required": ["p", "q", "r"]},
                            {"type": "object", "required": ["s"]}]}
        rep2 = schema.validate_with({}, any_of, base_dir=SCHEMAS)
        self.assertEqual(len(rep2.issues), 1)
        self.assertIn("'s'", rep2.issues[0].message)


class Externals(TempSchemas):
    def test_u_sch_07_x_external_collected_and_run(self) -> None:
        prof = json.loads((S.RENDERED / "profile.draft.json").read_text(encoding="utf-8"))
        rep = schema.validate(prof, "profile")
        self.assertTrue(rep.ok, rep.issues)
        self.assertEqual([(e.instance_path, e.skill, e.rel_path) for e in rep.externals],
                         [("/frontend", "frontend", "assets/schemas/profile-frontend.schema.json")])
        old = paths._SKILLS_ROOT_OVERRIDE
        try:
            paths._SKILLS_ROOT_OVERRIDE = self.dir
            issues, missing = schema.run_externals(prof, rep)
            self.assertEqual(issues, [])
            self.assertEqual(len(missing), 1, "a missing external schema is reported, never a pass")
            target = self.dir / "frontend" / "assets" / "schemas"
            S.write_json(target / "profile-frontend.schema.json",
                         {"type": "object", "required": ["mode", "stack"],
                          "properties": {"stack": {"enum": ["vite-react"]}}})
            issues, missing = schema.run_externals(prof, rep)
            self.assertEqual(missing, [])
            self.assertEqual([i.instance_path for i in issues], ["/frontend/stack"])
            prof["frontend"]["stack"] = "vite-react"
            issues, missing = schema.run_externals(prof, schema.validate(prof, "profile"))
            self.assertEqual((issues, missing), ([], []))
        finally:
            paths._SKILLS_ROOT_OVERRIDE = old


class Keywords(TempSchemas):
    def test_u_sch_08_unsupported_keyword_in_ours(self) -> None:
        self.put("bad.schema.json", {"type": "string", "format": "uri"})
        self.put("dep.schema.json", {"type": "object", "dependentRequired": {"a": ["b"]}})
        self.put("fine.schema.json", {"type": "string", "x-note": "annotations are fine", "title": "t"})
        reg = schema.Registry(self.dir)
        self.assertEqual(reg.get("fine")["type"], "string")
        for name in ("bad", "dep"):
            with self.assertRaises(InternalError) as cm:
                reg.get(name)
            self.assertEqual(cm.exception.code, "E_SCHEMA_KEYWORD")
            self.assertEqual(cm.exception.exit_code, 3)
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            code = envelope.run("validate", lambda: (schema.Registry(self.dir).get("bad"), CommandResult({}))[1],
                                pretty=False)
        env = json.loads(out.getvalue())
        self.assertEqual((code, env["exit_code"], env["errors"][0]["code"]), (3, 3, "E_SCHEMA_KEYWORD"))

    def test_u_sch_09_foreign_unsupported_keyword_warns(self) -> None:
        sch = {"type": "object", "required": ["url"], "properties": {"url": {"type": "string", "format": "uri"}}}
        rep = schema.validate_with({"url": "https://example.invalid"}, sch, base_dir=self.dir)
        self.assertTrue(rep.ok)
        self.assertEqual([w.code for w in rep.warnings], ["W_SCHEMA_UNSUPPORTED_KEYWORD"])
        self.assertIn("'format'", rep.warnings[0].message)
        rep2 = schema.validate_with({"url": 3}, sch, base_dir=self.dir)
        self.assertEqual([i.instance_path for i in rep2.issues], ["/url"], "the rest is still validated")

    def test_all_our_schemas_load(self) -> None:
        reg = schema.Registry()
        for path in sorted(SCHEMAS.glob("*.schema.json")):
            self.assertIsInstance(reg.get(path.name), dict)


class Bundle(unittest.TestCase):
    def test_u_sch_12_bundle_has_no_ref(self) -> None:
        for path in sorted(SCHEMAS.glob("*.schema.json")):
            bundled = schema.bundle(path.name)
            self.assertNotIn('"$ref"', json.dumps(bundled), path.name)
        plan = S.build_plan()
        self.assertTrue(schema.validate_with(plan, schema.bundle("plan"), base_dir=SCHEMAS).ok)
        broken = S.build_plan()
        broken["tasks"][0]["kind"] = "poetry"
        self.assertFalse(schema.validate_with(broken, schema.bundle("plan"), base_dir=SCHEMAS).ok)


class RealDocument(unittest.TestCase):
    def test_u_sch_13_rendered_profile(self) -> None:
        prof = json.loads((S.RENDERED / "profile.draft.json").read_text(encoding="utf-8"))
        self.assertTrue(schema.validate(prof, "profile").ok)
        prof["notion"]["language"] = "en"
        rep = schema.validate(prof, "profile")
        self.assertEqual(rep.issues[0].instance_path, "/notion/language")

    def test_check_raises_with_items(self) -> None:
        with self.assertRaises(ValidationFailed) as cm:
            schema.check({"ok": "yes"}, "envelope", what="an envelope")
        items = cm.exception.items()
        self.assertIn("/ok", [i.path for i in items])
        schema.check(json.loads(Path(S.B01_FIXTURES / "docs" / "envelope.ok.json").read_text(encoding="utf-8")),
                     "envelope", what="an envelope")


if __name__ == "__main__":
    unittest.main()
