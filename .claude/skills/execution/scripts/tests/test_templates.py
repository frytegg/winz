"""Template instantiation from the /frontend libraries (contract/TESTS.md 3.4 U-TPL-01..19, FRONTEND.md 2 and 14,
SCHEMAS.md 6; lane B02).

Two libraries, both always run: the pinned real-format copy fixtures/B02/frontend-real-b05cbd4e.json (through the
adapter: validated against /frontend's own schema, specialised, normalised, then validated against ours) and the
contract-format sample fixtures/B02/frontend-sample.json for the edge cases. A temporary sibling-skills root stands
in for ~/.claude/skills (never read or written here); lanes B03/B04 are faked through their MODULES.md signatures.

Run: python -m unittest discover -s scripts/tests -p "test_templates.py" -v
"""
from __future__ import annotations

import copy
import json
import unittest
from typing import Any

import _support as S
import _support_B02 as B

from execlib import clock, errors, jsonio, planning, schema, templates, validate

NOW = clock.parse_utc(S.FIXED_NOW)


class Base(unittest.TestCase):
    library = B.SAMPLE_LIB

    def setUp(self) -> None:
        self.sd = B.StateDir()

    def tearDown(self) -> None:
        self.sd.cleanup()

    def inst(self, *, draft: dict | None = None, profile: dict | None = None, library_doc: Any = None,
             lib: Any = "default") -> tuple[dict, dict[str, str]]:
        d = draft if draft is not None else self.sd.draft()
        prof = profile if profile is not None else self.sd.profile
        with B.FrontendSkill(self.library if lib == "default" else lib, library_doc=library_doc):
            return templates.instantiate(d, prof, self.sd.policy, self.sd.layout, NOW, lane_of=validate.lane_for)

    def by_key(self, raw: dict) -> dict[str, dict]:
        return {t["key"]: t for t in raw["tasks"]}

    def full_profile(self) -> dict:
        p = copy.deepcopy(self.sd.profile)
        p["frontend"]["mode"] = "full"
        return p


class SampleLibrary(Base):
    def test_u_tpl_01_references_on(self) -> None:
        raw, ids = self.inst()
        k = self.by_key(raw)
        self.assertEqual(k["frontend.fe-03"]["depends_on"], [ids["frontend/FE-02"]])
        self.assertIn("frontend.fe-01", k)
        self.assertIn("frontend.fe-02", k)

    def test_u_tpl_02_references_off(self) -> None:
        d = self.sd.draft()
        d["libraries"][1]["params"]["references"] = "off"
        raw, ids = self.inst(draft=d)
        k = self.by_key(raw)
        self.assertNotIn("frontend.fe-01", k)
        self.assertNotIn("frontend.fe-02", k)
        self.assertEqual(k["frontend.fe-03"]["depends_on"], [ids["frontend/FE-00"]])

    def test_u_tpl_03_fe07_after_fe04_and_fe06(self) -> None:
        for refs in ("on", "off"):
            d = self.sd.draft()
            d["libraries"][1]["params"]["references"] = refs
            raw, ids = self.inst(draft=d)
            fe07 = self.by_key(raw)["frontend.fe-07"]
            self.assertEqual(fe07["depends_on"], sorted([ids["frontend/FE-04"], ids["frontend/FE-06"]],
                                                         key=lambda i: int(i[1:])), refs)

    def test_u_tpl_04_project_name(self) -> None:
        raw, ids = self.inst()
        names = [t for t in raw["tasks"] if t["template"] == "execution:EX-NAME"]
        self.assertEqual(len(names), 1)
        self.assertIn(names[0]["id"], self.by_key(raw)["frontend.fe-05"]["depends_on"])
        prof = copy.deepcopy(self.sd.profile)
        prof["project"]["name_owner_confirmed"] = True
        raw2, ids2 = self.inst(profile=prof)
        self.assertFalse([t for t in raw2["tasks"] if t["template"] == "execution:EX-NAME"])
        self.assertEqual(self.by_key(raw2)["frontend.fe-05"]["depends_on"], [ids2["frontend/FE-04"]])

    def test_u_tpl_05_per_group_expansion(self) -> None:
        raw, ids = self.inst(profile=self.full_profile())
        k = self.by_key(raw)
        g1, g2 = k["frontend.fe-1x.g1"], k["frontend.fe-1x.g2"]
        self.assertIn("frontend/FE-1x.G1", ids)
        self.assertIn("frontend/FE-1x.G2", ids)
        self.assertIn("--features FR-001,FR-002,FR-006 ", g1["proof"]["spec"]["cmd"])
        self.assertIn("--features FR-003,FR-007 ", g2["proof"]["spec"]["cmd"])
        self.assertEqual(g1["writes"], ["ui/src/sections/G1/**"])
        self.assertEqual(g1["covers"], ["FR-001", "FR-002", "FR-006"])
        self.assertEqual(g2["covers"], ["FR-003", "FR-007"])
        self.assertEqual((g1["feature_group"], g1["params"]["group"]), ("G1", "G1"))

    def test_u_tpl_06_feature_tasks(self) -> None:
        raw, ids = self.inst(profile=self.full_profile())
        g1 = self.by_key(raw)["frontend.fe-1x.g1"]
        self.assertIn(ids["lookup"], g1["depends_on"])
        self.assertIn(ids["eta-view"], g1["depends_on"])
        self.assertNotIn(ids["engine"], g1["depends_on"])
        d = self.sd.draft()
        for t in d["tasks"]:
            if t["key"] in ("health-data", "backtest"):
                t["covers"] = ["FR-004"]
        with self.assertRaises(errors.CheckFailed) as cm:
            self.inst(draft=d, profile=self.full_profile())
        self.assertEqual(cm.exception.code, "E_TEMPLATE_DEP")
        self.assertIn("G2", cm.exception.message)

    def test_u_tpl_07_all_instances(self) -> None:
        raw, ids = self.inst(profile=self.full_profile())
        fe20 = self.by_key(raw)["frontend.fe-20"]
        self.assertIn(ids["frontend/FE-1x.G1"], fe20["depends_on"])
        self.assertIn(ids["frontend/FE-1x.G2"], fe20["depends_on"])

    def test_u_tpl_08_fe21(self) -> None:
        raw, ids = self.inst()
        fe21 = self.by_key(raw)["frontend.fe-21"]
        self.assertEqual(fe21["phase"], "deliverable")
        review = ids["execution/EX-HARDEN-REVIEW"]
        gate = ids["execution/EX-FIX-GATE"]
        self.assertTrue({ids["frontend/FE-20"], review, gate} <= set(fe21["depends_on"]))

    def test_u_tpl_09_prework_release(self) -> None:
        raw, _ids = self.inst()
        k = self.by_key(raw)
        t0 = self.sd.profile["prework"]["until_utc"]
        for key in ("frontend.fe-03", "frontend.fe-05", "frontend.fe-07"):
            self.assertEqual(k[key]["release_utc"], t0, key)
        for key in ("frontend.fe-00", "frontend.fe-01", "frontend.fe-02"):
            self.assertIsNone(k[key]["release_utc"], key)

    def test_u_tpl_10_mode_estimates(self) -> None:
        raw_small, _ = self.inst()
        raw_full, _ = self.inst(profile=self.full_profile())
        small = self.by_key(raw_small)["frontend.fe-03"]["estimate"]
        full = self.by_key(raw_full)["frontend.fe-03"]["estimate"]
        self.assertEqual((small["p10_min"], small["p50_min"], small["p90_min"]), (10, 22, 40))
        self.assertEqual((full["p10_min"], full["p50_min"], full["p90_min"]), (15, 35, 55))
        self.assertEqual(small["source"], "template:frontend")

    def test_u_tpl_11_unknown_placeholder(self) -> None:
        doc = B.load("frontend-sample.json")
        next(t for t in doc["templates"] if t["id"] == "FE-08")["description"] = "Scaffold at {uiroot}."
        with self.assertRaises(errors.CheckFailed) as cm:
            self.inst(library_doc=doc, lib=None)
        self.assertEqual(cm.exception.code, "E_TEMPLATE_PLACEHOLDER")
        self.assertIn("frontend:FE-08", cm.exception.message)
        self.assertIn("description", cm.exception.message)
        # positive control: the declared spelling instantiates
        next(t for t in doc["templates"] if t["id"] == "FE-08")["description"] = "Scaffold at {ui_root}."
        raw, _ = self.inst(library_doc=doc, lib=None)
        self.assertEqual(self.by_key(raw)["frontend.fe-08"]["description"], "Scaffold at ui.")

    def test_u_tpl_12_undeclared_parameter(self) -> None:
        d = self.sd.draft()
        d["libraries"][1]["params"]["colour"] = "teal"
        with self.assertRaises(errors.CheckFailed) as cm:
            self.inst(draft=d)
        self.assertEqual(cm.exception.code, "E_TEMPLATE_PARAM")
        d2 = self.sd.draft()
        d2["libraries"][1]["params"]["mode"] = "full"  # contradicts the profile's small mode (authoritative)
        with self.assertRaises(errors.CheckFailed) as cm2:
            self.inst(draft=d2)
        self.assertEqual(cm2.exception.code, "E_TEMPLATE_PARAM")

    def test_u_tpl_13_determinism_and_digest(self) -> None:
        with B.fake_lanes():
            self.sd.write_draft(self.sd.draft())
            with B.FrontendSkill(self.library):
                r1 = B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", **B.instantiate_args())
                first = self.sd.layout.plan.read_bytes()
                self.sd.layout.plan.unlink()
                r2 = B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", **B.instantiate_args())
                second = self.sd.layout.plan.read_bytes()
        self.assertEqual((r1.exit_code, r2.exit_code), (0, 0))
        self.assertEqual(first, second)
        raw = json.loads(first)
        sample = {t["id"]: t for t in B.load("frontend-sample.json")["templates"]}
        fe03 = self.by_key(raw)["frontend.fe-03"]
        self.assertEqual(fe03["template_digest"], jsonio.sha256_json(sample["FE-03"]))

    def test_u_tpl_14_ids_kahn_order(self) -> None:
        raw, ids = self.inst()
        tids = [t["id"] for t in raw["tasks"]]
        self.assertEqual(tids, [f"T{i:03d}" for i in range(1, len(tids) + 1)])
        rank = {t["id"]: (validate.PHASE_ORDER.index(t["phase"]), ["P1", "P2", "P3"].index(t["priority"]), t["key"])
                for t in raw["tasks"]}
        done: set[str] = set()
        for t in raw["tasks"]:
            ready = [x for x in raw["tasks"] if x["id"] not in done and set(x["depends_on"]) <= done]
            expected = min(ready, key=lambda x: rank[x["id"]])
            self.assertEqual(t["id"], expected["id"])
            done.add(t["id"])
            self.assertTrue(t["key"])
        self.assertEqual(ids["engine"], self.by_key(raw)["engine"]["id"])

    def test_u_tpl_15_library_absent(self) -> None:
        with B.fake_lanes() as fakes:
            self.sd.write_draft(self.sd.draft())
            with B.FrontendSkill(None):
                with self.assertRaises(errors.DependencyMissing) as cm:
                    B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", **B.instantiate_args())
        self.assertEqual(cm.exception.code, "E_DEPENDENCY_MISSING")
        proposal = cm.exception.data["proposal"]
        self.assertTrue(proposal)
        from execlib import decisionsio
        prop, _res = decisionsio.find(self.sd.layout, proposal)
        self.assertEqual(prop["kind"], "dependency-missing")
        self.assertEqual({o["id"] for o in prop["options"]}, {"wait", "cut-ui"})
        self.assertFalse(self.sd.layout.plan.exists())
        self.assertFalse(self.sd.layout.plan_candidate.exists())
        self.assertEqual([c[1] for c in fakes["decisions"].calls], ["dependency-missing"])

    def test_u_tpl_17_nfr_once(self) -> None:
        raw, _ = self.inst()
        fe_nfr = [r for r in raw["requirements"] if r["source"] == "frontend:standard"]
        self.assertEqual(len(fe_nfr), 1)
        fe_tasks = [t for t in raw["tasks"] if (t["template"] or "").startswith("frontend:") and
                    t["template"] != "frontend:FE-1x"]
        self.assertTrue(all(t["covers"] == [fe_nfr[0]["id"]] for t in fe_tasks))
        d = self.sd.draft()
        d["libraries"] = list(reversed(d["libraries"]))
        raw2, _ = self.inst(draft=d)
        self.assertEqual([r["id"] for r in raw2["requirements"] if r["source"] == "frontend:standard"], ["NFR-900"])

    def test_u_tpl_18_serial_sections(self) -> None:
        raw, ids = self.inst()  # fixture profile: stack static-html (serial)
        k = self.by_key(raw)
        self.assertIn(ids["frontend/FE-09"], k["frontend.fe-1x.g1"]["depends_on"])
        self.assertIn(ids["frontend/FE-1x.G1"], k["frontend.fe-1x.g2"]["depends_on"])
        prof = self.full_profile()
        prof["frontend"]["stack"] = "vite-react"
        raw2, ids2 = self.inst(profile=prof)
        k2 = self.by_key(raw2)
        self.assertNotIn(ids2["frontend/FE-1x.G1"], k2["frontend.fe-1x.g2"]["depends_on"])

    def test_u_tpl_19_planned_only_group(self) -> None:
        d = self.sd.draft()
        for r in d["requirements"]:
            if r["id"] in ("FR-003", "FR-007"):
                r["status_expected"] = "planned"
        for t in d["tasks"]:
            if t["key"] in ("health-data", "backtest"):
                t["covers"] = ["SC-004"] if t["key"] == "health-data" else ["FR-004"]
        raw, ids = self.inst(draft=d, profile=self.full_profile())
        g2 = self.by_key(raw)["frontend.fe-1x.g2"]
        self.assertEqual(g2["covers"], ["FR-003", "FR-007"])
        self.assertNotIn(ids["health-data"], g2["depends_on"])
        # positive control: one non-planned uncovered requirement in the group fails
        d2 = copy.deepcopy(d)
        next(r for r in d2["requirements"] if r["id"] == "FR-003")["status_expected"] = None
        with self.assertRaises(errors.CheckFailed) as cm:
            self.inst(draft=d2, profile=self.full_profile())
        self.assertEqual(cm.exception.code, "E_TEMPLATE_DEP")

    def test_instantiated_plan_validates(self) -> None:
        with B.fake_lanes():
            self.sd.write_draft(self.sd.draft())
            with B.FrontendSkill(self.library):
                res = B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", **B.instantiate_args())
        self.assertEqual(res.exit_code, 0, [e.message for e in res.errors][:5])
        self.assertTrue(res.data["validation"]["ok"])


class RealLibrary(Base):
    library = B.REAL_LIB

    def test_u_tpl_16_adapter_end_to_end(self) -> None:
        with B.FrontendSkill(B.REAL_LIB):
            lib = templates.load_library("frontend")
            self.assertEqual(lib.fmt, "frontend")
            self.assertEqual(lib.sha256, "b05cbd4e3123ab412ab4f86fbbac6b5e27d28e7e92b6025012917cc12e25d701")
            prep = templates.prepare(lib, {"ui_root": "ui"}, self.sd.profile)
            self.assertTrue(schema.validate(prep.lib.raw, "task-template").ok)
        with B.fake_lanes():
            self.sd.write_draft(self.sd.draft())
            with B.FrontendSkill(B.REAL_LIB):
                res = B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", **B.instantiate_args())
        self.assertEqual(res.exit_code, 0, [e.message for e in res.errors][:5])
        self.assertTrue(res.data["validation"]["ok"])

    def test_u_tpl_16_neither_format_refused(self) -> None:
        doc = {"library": "frontend", "templates": [{"id": "FE-00"}]}
        with B.fake_lanes():
            self.sd.write_draft(self.sd.draft())
            with B.FrontendSkill(None, library_doc=doc):
                with self.assertRaises(errors.DependencyMissing) as cm:
                    B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", **B.instantiate_args())
        self.assertIn("neither template format", cm.exception.message)
        self.assertTrue(cm.exception.data["proposal"])
        self.assertFalse(self.sd.layout.plan.exists())
        # an invalid document in /frontend's own format is refused as well (step 1)
        bad = B.load("frontend-real-b05cbd4e.json")
        bad["templates"][0]["kind"] = "nonsense"
        with B.FrontendSkill(None, library_doc=bad):
            with self.assertRaises(errors.DependencyMissing):
                templates.load_library("frontend")

    def test_specialisation_every_mode_references_stack(self) -> None:
        with B.FrontendSkill(B.REAL_LIB):
            lib = templates.load_library("frontend")
            for mode in ("full", "small"):
                for refs in ("on", "off"):
                    for stack in ("vite-react", "next", "static-html", "existing"):
                        with self.subTest(mode=mode, refs=refs, stack=stack):
                            prof = copy.deepcopy(self.sd.profile)
                            prof["frontend"].update({"mode": mode, "stack": stack})
                            given: dict[str, Any] = {"ui_root": "ui", "references": refs}
                            if stack in ("next", "existing"):
                                given["preview"] = 4173
                            if stack == "existing":
                                given.update({"build_prefix": "pnpm build && ", "serve_target": "--serve \"out\""})
                            prep = templates.prepare(lib, given, prof)
                            self.assertTrue(schema.validate(prep.lib.raw, "task-template").ok)
                            ids = {t["id"] for t in prep.templates}
                            self.assertEqual("FE-01" in ids, refs == "on")
                            fe1x = next(t for t in prep.templates if t["id"] == "FE-1x")
                            self.assertEqual(fe1x["per"], None if mode == "small" else "feature-group")
                            self.assertEqual(prep.stack_serial, stack in ("next", "static-html", "existing"))
            with self.assertRaises(errors.CheckFailed):
                templates.prepare(lib, {"ui_root": "ui"}, {**self.sd.profile,
                                                           "frontend": {**self.sd.profile["frontend"],
                                                                        "stack": "next"}})

    def test_small_mode_single_fe1x_after_fe09(self) -> None:
        raw, ids = self.inst()
        k = self.by_key(raw)
        fe1x = k["frontend.fe-1x"]
        self.assertIsNone(fe1x["feature_group"])
        self.assertEqual(fe1x["covers"], ["FR-001", "FR-002", "FR-003", "FR-006", "FR-007"])
        self.assertIn(ids["frontend/FE-09"], fe1x["depends_on"])
        self.assertIn("--features FR-001,FR-002,FR-003,FR-006,FR-007 ", fe1x["proof"]["spec"]["cmd"])
        self.assertEqual(fe1x["writes"], ["ui/**"])

    def test_per_group_in_full_mode_with_narrowed_writes(self) -> None:
        prof = self.full_profile()
        prof["frontend"]["stack"] = "vite-react"
        d = self.sd.draft()
        d["lanes"][0]["globs"].append("ui/package.json")
        next(ln for ln in d["lanes"] if ln["id"] == "L4")["globs"] = [
            "ui/src/**", "ui/public/**", "ui/index.html", "ui/*.config.*", "ui/app/**", "design/**", "brand/**",
            ".execution/frontend/**"]
        raw, ids = self.inst(draft=d, profile=prof)
        k = self.by_key(raw)
        self.assertEqual(k["frontend.fe-08"]["writes"][:5], ["ui/src/**", "ui/public/**", "ui/index.html",
                                                             "ui/*.config.*", "ui/app/**"])
        self.assertIn("manifest", k["frontend.fe-08"]["resources"])
        self.assertIn("frontend.fe-1x.g2", k)
        self.assertIn("pnpm -C \"ui\" build && ", k["frontend.fe-1x.g1"]["proof"]["spec"]["cmd"])
        self.assertTrue(k["frontend.fe-1x.g1"]["proof"]["spec"]["install"])
        self.assertTrue(set(ids[f"execution/{x}"] for x in ("EX-CI",)) <= set(k["frontend.fe-08"]["depends_on"]))

    def test_adapter_fields(self) -> None:
        raw, ids = self.inst()
        raw = templates.compute_latest_starts(raw, self.sd.profile)
        k = self.by_key(raw)
        fe03 = k["frontend.fe-03"]
        frag = fe03["params"]["fragment"]
        self.assertEqual(frag["function"], "feDirections")
        self.assertEqual(frag["input"]["cwd"], "{workdir}")
        self.assertEqual(frag["input"]["task"], fe03["id"])
        self.assertEqual(frag["input"]["agents"]["designer"]["agentType"], "execution-implementer")
        self.assertEqual(frag["input"]["agents"]["runner"]["agentType"], "execution-implementer")
        self.assertRegex(frag["sha256"], r"^[0-9a-f]{64}$")
        fe20 = k["frontend.fe-20"]
        crit = fe20["params"]["fragment"]["input"]["agents"]
        self.assertEqual((crit["critic"]["agentType"], crit["probe"]["agentType"]), ("frontend-critic", "frontend-probe"))
        self.assertEqual(fe20["params"]["fragment"]["input"]["critique"], {"$from": "frontend.critique"})
        self.assertEqual(fe20["proof"]["negative_control"]["kind"], "forgery")
        self.assertTrue(fe20["proof"]["spec"]["cmd"].endswith(' --out "$EXEC_PROOF_OUT"'))
        self.assertNotIn("pnpm -C", fe20["proof"]["spec"]["cmd"])  # static-html: no build prefix
        fe21 = k["frontend.fe-21"]
        self.assertTrue({ids["execution/EX-HARDEN-REVIEW"], ids["execution/EX-FIX-GATE"]} <= set(fe21["depends_on"]))
        checks = fe21["proof"]["spec"]["json_checks"]
        self.assertIn({"pointer": "/signed_off", "check": "equals", "value": True}, checks)
        fe04 = k["frontend.fe-04"]
        self.assertEqual(fe04["proof"]["spec"]["json_pointer"], "/H1")
        self.assertTrue(fe04["manual"]["options_source"].endswith("/frontend/directions/"))
        self.assertTrue(fe04["manual"]["decision_deadline_utc"])
        fe01 = k["frontend.fe-01"]
        self.assertEqual(fe01["proof"]["spec"]["json_pointer"], "/frontend/references")
        self.assertEqual(fe01["manual"]["bring_back"][0]["key"], f"{fe01['id']}-refs")
        fe02 = k["frontend.fe-02"]
        self.assertTrue(fe02["params"]["external_writes"][0].endswith("/private/frontend/captures/**"))
        self.assertTrue(all(w.startswith(".execution/frontend/") for w in fe02["writes"]))
        fe00 = k["frontend.fe-00"]
        self.assertIn(ids["execution/EX-APPROVE"], fe00["depends_on"])
        self.assertEqual(fe00["proof"]["negative_control"]["patch_path"], "negative-controls/frontend.fe-00.plant.json")
        self.assertEqual(fe00["params"]["plant"]["ops"][0]["pointer"], "/hero/source")
        for t in raw["tasks"]:
            if (t["template"] or "").startswith("frontend:"):
                self.assertFalse(any("C:/Users/Utilisateur/.claude/skills/frontend" in r for r in t["brief_refs"]),
                                 "paths are re-rooted to this machine's /frontend")

    def test_plant_files_written(self) -> None:
        with B.fake_lanes():
            self.sd.write_draft(self.sd.draft())
            with B.FrontendSkill(B.REAL_LIB):
                res = B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate", **B.instantiate_args())
        self.assertEqual(res.exit_code, 0)
        raw = json.loads(self.sd.layout.plan.read_text(encoding="utf-8"))
        for t in raw["tasks"]:
            nc = t["proof"]["negative_control"]
            if nc.get("patch_path"):
                plant = json.loads((self.sd.state / nc["patch_path"]).read_text(encoding="utf-8"))
                self.assertEqual(plant["version"], 1)
                self.assertTrue(plant["ops"])

    def test_imported_pre_t0_outputs(self) -> None:
        S.write_text(self.sd.state / "frontend" / "brief.json", "{}\n")
        raw, _ids = self.inst()
        fe00 = self.by_key(raw)["frontend.fe-00"]
        self.assertTrue(fe00["params"]["imported"])
        self.assertEqual((fe00["estimate"]["p10_min"], fe00["estimate"]["p50_min"]), (2, 5))
        self.assertNotIn("imported", self.by_key(raw)["frontend.fe-02"]["params"])

    def test_pre_t0_instantiates_research_only(self) -> None:
        with B.FrontendSkill(B.REAL_LIB):
            raw, _ids = templates.instantiate(self.sd.draft(), self.sd.profile, self.sd.policy, self.sd.layout, NOW,
                                              lane_of=validate.lane_for, pre_t0=True)
        fe = sorted(t["template"] for t in raw["tasks"] if t["template"])
        self.assertEqual(fe, ["frontend:FE-00", "frontend:FE-01", "frontend:FE-02"])
        fe00 = next(t for t in raw["tasks"] if t["template"] == "frontend:FE-00")
        self.assertIn("/private/frontend", fe00["proof"]["spec"]["cmd"])
        # the knowledge-level skeleton (the planner's own tasks) is kept, and the plan is never approved (CLI.md
        # `plan instantiate --pre-t0`, FRONTEND.md 11)
        self.assertTrue({"contract-types", "engine", "cli"} <= {t["key"] for t in raw["tasks"]})
        self.assertIsNone(raw.get("approved"))
        # positive control: the same inputs without pre_t0 hold the execution library and the later FE templates
        with B.FrontendSkill(B.REAL_LIB):
            full, _ = templates.instantiate(self.sd.draft(), self.sd.profile, self.sd.policy, self.sd.layout, NOW,
                                            lane_of=validate.lane_for)
        full_tpl = {t["template"] for t in full["tasks"] if t["template"]}
        self.assertIn("frontend:FE-03", full_tpl)
        self.assertIn("execution:EX-GATE-BUILD", full_tpl)


class EffortCap(Base):
    """README.md 10 revision 4 / FRONTEND.md 13: /frontend's schema still allows `xhigh`; the adapter clamps any
    template or agent-role effort above `high` to `high` with W_EFFORT_CAPPED naming the template id, so the
    instantiated plan validates. Positive control: the pinned library as is (efforts low|medium|high) is unchanged
    and raises no warning. The pinned /frontend copies are never edited: the variant is a modified in-memory doc."""

    def instantiate_cmd(self, doc: dict) -> tuple[Any, list, dict, Any]:
        errors.drain_warnings()
        with B.fake_lanes():
            self.sd.write_draft(self.sd.draft())
            with B.FrontendSkill(None, library_doc=doc):
                res = B.run_handler(planning.cmd_instantiate, self.sd.layout, "plan instantiate",
                                    **B.instantiate_args())
                capped = [w for w in errors.drain_warnings() if w.code == "W_EFFORT_CAPPED"]
                checked = B.run_handler(planning.cmd_validate, self.sd.layout, "validate", plan=None,
                                        with_status=False, strict=False)
        raw = json.loads(self.sd.layout.plan.read_text(encoding="utf-8"))
        return res, capped, raw, checked

    def test_positive_control_unchanged_without_warning(self) -> None:
        doc = B.load("frontend-real-b05cbd4e.json")
        res, capped, raw, checked = self.instantiate_cmd(doc)
        self.assertEqual(res.exit_code, 0, [e.message for e in res.errors][:5])
        self.assertEqual(capped, [])
        self.assertEqual(checked.exit_code, 0, [e.message for e in checked.errors][:5])
        source = {t["id"]: t["effort"] for t in doc["templates"]}
        fe = [t for t in raw["tasks"] if (t["template"] or "").startswith("frontend:")]
        self.assertTrue(fe)
        for t in fe:
            self.assertEqual(t["effort"], source[t["template"].split(":", 1)[1]], t["key"])
        self.assertIn("medium", {t["effort"] for t in fe})

    def test_xhigh_capped_with_warning_and_plan_validates(self) -> None:
        doc = B.load("frontend-real-b05cbd4e.json")
        frag = next(t for t in doc["templates"] if (t.get("fragment") or {}).get("input", {}).get("agents"))
        medium = next(t for t in doc["templates"] if t["effort"] == "medium" and t is not frag
                      and t["id"] in ("FE-00", "FE-08", "FE-1x", "FE-07", "FE-09"))
        medium["effort"] = "xhigh"
        frag["effort"] = "xhigh"
        role = sorted(frag["fragment"]["input"]["agents"])[0]
        frag["fragment"]["input"]["agents"][role]["effort"] = "xhigh"
        # /frontend's own (pinned) schema still accepts the variant: the clamp is the adapter's, not a refusal
        with B.FrontendSkill(None, library_doc=doc):
            self.assertEqual(templates.load_library("frontend").fmt, "frontend")
        res, capped, raw, checked = self.instantiate_cmd(doc)
        self.assertEqual(res.exit_code, 0, [e.message for e in res.errors][:5])
        self.assertTrue(res.data["validation"]["ok"])
        self.assertEqual(checked.exit_code, 0, [e.message for e in checked.errors][:5])
        by_tpl = {t["template"]: t for t in raw["tasks"] if t["template"]}
        self.assertEqual(by_tpl[f"frontend:{medium['id']}"]["effort"], "high")
        ft = by_tpl[f"frontend:{frag['id']}"]
        self.assertEqual(ft["effort"], "high")
        self.assertEqual(ft["params"]["fragment"]["input"]["agents"][role]["effort"], "high")
        self.assertNotIn("xhigh", json.dumps(raw))
        msgs = " | ".join(w.message for w in capped)
        for tid in (medium["id"], frag["id"]):
            self.assertIn(f"template {tid}:", msgs)
        self.assertIn(f"/agents/{role}/effort", msgs)
        self.assertEqual(len(capped), 3, msgs)
        self.assertTrue(all(w.path and w.path.startswith("frontend.json#/templates/") for w in capped))

    def test_cap_effort_unit(self) -> None:
        errors.drain_warnings()
        self.assertEqual([templates.cap_effort(v, "FE-00", "/templates/0/effort")
                          for v in ("low", "medium", "high", None)], ["low", "medium", "high", None])
        self.assertEqual(errors.drain_warnings(), [])
        self.assertEqual(templates.cap_effort("max", "FE-03", "/templates/3/effort"), "high")
        self.assertEqual(templates.cap_effort("bogus", "FE-03", "/templates/3/effort"), "bogus")
        w = errors.drain_warnings()
        self.assertEqual([x.code for x in w], ["W_EFFORT_CAPPED"])
        self.assertIn("FE-03", w[0].message)


if __name__ == "__main__":
    unittest.main()
