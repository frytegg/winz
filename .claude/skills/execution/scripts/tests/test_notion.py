"""Notion op generation, acknowledgements, outbox and polls (contract/TESTS.md 3.8 U-NOT-01..13, NOTION.md 14,
LANES.md B09).

Protects: init in four separate stages (token and hub check first, then databases, then the self-relation, then the
views); rows created once and updated only on a hash change with only the changed properties; own-executor rows
only; owner-owned columns in no op ever; redaction and the secret scan of op text, with the proven-public values of
README.md 8 (a listed hash and an explorer link's value pass verbatim, the same hash unlisted is redacted);
divergence holds; the outbox replayed only after a real read, with creates behind the view:board map rebuild; async
polls; view-mode polls, `pending: true` with exit 0 while a batch is pending; schema-valid, deterministic batches;
E_NOTION_UNCONFIGURED. No network: Notion results are canned text.

Run: python -m unittest discover -s scripts/tests -p "test_notion.py" -v
"""
from __future__ import annotations

import inspect
import json
import shlex
import unittest
from pathlib import Path

import _support as S
import _support_B09 as B
from execlib import jsonio, notion, paths, report, schema, statusio
from execlib import plan as plan_mod
from execlib import state as state_mod


# the Waves database's properties (NOTION.md 3), as a wave report op writes them
WAVE_FIELDS: frozenset[str] = frozenset({
    "Vague", "Orchestrateur", "date:Lancée:start", "date:Lancée:is_datetime", "date:Close:start",
    "date:Close:is_datetime", "Heures (texte)", "Zone", "P80 fin de build", "Prouvées", "Échecs", "Ouvertes",
    "Ta prochaine action", "Pouls"})


def _diff(layout, *extra: str, now: str = B.NOW, executor: str = "A") -> tuple[int, dict]:
    return B.run_cli(["notion", "diff", *B.state_args(layout, now, executor), *extra])


def _ack(layout, batch: str, op: str, text: str, *, now: str = B.NOW, executor: str = "A") -> tuple[int, dict]:
    path = B.write_result(layout, batch, op, text)
    return B.run_cli(["notion", "ack", *B.state_args(layout, now, executor), "--batch", batch, "--op", op,
                      "--result-file", str(path)])


def _fail(layout, batch: str, op: str, *, error: str | None = None, code: str | None = None,
          retry: int | None = None, now: str = B.NOW) -> tuple[int, dict]:
    args = ["notion", "ack", *B.state_args(layout, now), "--batch", batch, "--op", op, "--failed"]
    if error is not None:
        args += ["--error-file", str(B.write_result(layout, batch, op, error, error=True))]
    if code is not None:
        args += ["--error-code", code]
    if retry is not None:
        args += ["--retry-after", str(retry)]
    return B.run_cli(args)


def _local(layout) -> dict:
    return json.loads(layout.local_state.read_text(encoding="utf-8"))


def _set_status(layout, executor: str, task: str, **entry) -> None:
    doc = json.loads(layout.status(executor).read_text(encoding="utf-8"))
    doc["tasks"][task] = S.build_task_status(**entry)
    jsonio.write_json_atomic(layout.status(executor), doc)


def _rebuild_empty(test: unittest.TestCase, layout, now: str = B.NOW) -> None:
    """A profile with ids and no local ledger starts with the view:board map rebuild (NOTION.md 11.4)."""
    code, env = _diff(layout, now=now)
    test.assertEqual(code, 0)
    ops = env["data"]["ops"]
    test.assertEqual([(o["tool"], o["key"]) for o in ops], [("notion-query-data-sources", "view:board")])
    code, _env = _ack(layout, env["data"]["batch_id"], "op-1", B.query_result([]), now=now)
    test.assertEqual(code, 0)


def _create_and_ack(test: unittest.TestCase, layout, now: str = B.NOW, executor: str = "A", *,
                    settle: bool = True) -> dict:
    """The first mirror after the map rebuild: creates, plus the hub fetch (no local "Now" block yet, NOTION.md
    9.3); then (settle) the hub block write the fetch leads to, so the test starts from a quiet mirror."""
    code, env = _diff(layout, now=now, executor=executor)
    test.assertEqual(code, 0, env)
    batch = env["data"]
    creates = [o for o in batch["ops"] if o["purpose"] == "create-row"]
    test.assertTrue(creates)
    test.assertEqual([(o["tool"], o["key"]) for o in batch["ops"] if o["purpose"] == "hub-now"],
                     [("notion-fetch", "hub")])
    _ack_batch(test, layout, batch, now=now, executor=executor)
    if settle:
        _settle_hub(test, layout, now=now, executor=executor)
    return batch


def _ack_batch(test: unittest.TestCase, layout, batch: dict, *, now: str = B.NOW, executor: str = "A") -> None:
    """Ack every op with a plausible result: page urls for creates, the hub with both blocks for fetches."""
    for op in batch["ops"]:
        if op["purpose"] in ("create-row", "wave-report"):
            text = B.created_pages_result(len(op["args"]["pages"]), start=1 if op["purpose"] == "create-row" else 50)
        elif op["tool"] == "notion-fetch" and op["purpose"] in ("hub-now", "token-check"):
            text = B.hub_result(markers=("A", "B"))
        elif op["tool"] == "notion-query-data-sources":
            text = B.query_result([])
        else:
            text = json.dumps({"ok": True})
        code, env = _ack(layout, batch["batch_id"], op["op_id"], text, now=now, executor=executor)
        test.assertEqual(code, 0, env)


def _settle_hub(test: unittest.TestCase, layout, *, now: str = B.NOW, executor: str = "A") -> None:
    """Write this executor's "Now" block once the hub fetch stored the old one; afterwards diffs are quiet."""
    code, env = _diff(layout, now=now, executor=executor)
    test.assertEqual(code, 0, env)
    ops = env["data"]["ops"]
    test.assertEqual([(o["tool"], o["purpose"], o["args"].get("command")) for o in ops],
                     [("notion-update-page", "hub-now", "update_content")])
    _ack_batch(test, layout, env["data"], now=now, executor=executor)


def _wave_w01(layout) -> None:
    """Record wave W01 as ingested in the local state (the wave a report row is written for)."""
    local = _local(layout)
    local["waves"] = [{"wave": "W01", "status": "ingested", "manifest": "waves/W01.json", "run_id": "r",
                       "launched_utc": "2026-10-06T06:05:00Z", "finished_utc": "2026-10-06T07:10:00Z",
                       "tasks": ["T001"]}]
    jsonio.write_json_atomic(layout.local_state, local)


def _action(value: str) -> str:
    """The next-action line of `_report_text` (the wave row's « Ta prochaine action »)."""
    return f"T003 · vérifie la transaction {value} — avant mar. 6 oct. 17:00 SGT · 11:00 Paris · ordinateur"


def _report_text(listed: str, linked: str) -> str:
    """A wave report laid out as `report --wave` writes it (NOTION.md 9.1): `listed` bare in the next action,
    `linked` in a proof's explorer link and, as the control, bare in the pulse section."""
    return "\n".join([
        "<callout color=\"gray_bg\">",
        "\t**Zone inconnue** · fin de build P80 inconnue",
        "</callout>",
        "## Fait",
        "- T002 · Task T002 — intégrée 1a2b3c4d",
        "## Prouvé",
        f"- T001 · Task T001 — URL 200 · [preuve](https://testnet.bscscan.com/tx/{linked}) · vérifiée par "
        "execution-verifier (T001-1a2b3c4d-20261006T070000Z-1)",
        "## Ouvert",
        "- 0 en échec, 0 bloquées, 0 prêtes, 1 prévues",
        "## Ta prochaine action",
        f"1. {_action(listed)}",
        "## Zone et P80",
        "- Chemin critique : T003",
        "## Pouls",
        f"- Témoin : {linked}",
        ""])


def _url_task(tid: str, url: str) -> dict:
    """A plan task whose proof is a rendered URL check (an explorer page, plan.schema.json `url`)."""
    task = S.build_task(tid)
    task["proof"].update({"type": "url", "spec": {"url": url, "expect_status": 200, "render": True},
                          "expect": {"summary": "the explorer shows the transaction"}})
    return task


def _stored_fetch(layout, batch_id: str, n: int) -> str:
    """Where the orchestrator Writes op n's raw result (references/notion.md, step 3), as an absolute POSIX path."""
    path = paths.posix(layout.local / "notion" / "results" / batch_id / f"op-{n}.txt")
    assert Path(path).is_absolute(), path
    return path


def _run_printed(test: unittest.TestCase, line: str, cwd: Path, *, now: str) -> tuple[int, dict]:
    """Run one printed command line as printed, from `cwd`, split as the orchestrator's Bash tool splits it (POSIX
    words and quotes). The line starts with this machine's `paths.exec_cmd()`; only the interpreter is this test's
    own Python, and the clock is pinned through EXEC_NOW (a printed line carries no --now). Envelope and stderr are
    checked by `S.run_exec`."""
    argv = shlex.split(line, posix=True)
    test.assertIn(argv[0], ("python", "python3"), line)
    test.assertEqual(Path(argv[1]).resolve(), S.EXEC_PY.resolve(), line)
    code, env, _logs = S.run_exec(argv[2:], cwd=cwd, env=S.env_isolated(EXEC_NOW=now))
    return code, env


def _decision_headers(layout) -> list[dict]:
    """The block headers of decisions.md (proposals and resolutions)."""
    prefix, suffix = "<!-- execution-decision ", " -->"
    return [json.loads(line[len(prefix):-len(suffix)])
            for line in layout.decisions.read_text(encoding="utf-8").split("\n")
            if line.startswith(prefix) and line.endswith(suffix)]


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.root = S.mkdtemp()
        self.fake_cm = B.fake_integrity()
        self.fake = self.fake_cm.__enter__()

    def tearDown(self) -> None:
        self.fake_cm.__exit__(None, None, None)
        S.rmtree(self.root)

    def assert_batches_clean(self, layout) -> None:
        """U-NOT-05 and U-NOT-12 on every batch written in the test. The owner-column check reads the property
        NAMES of every op (`args.properties` and `args.pages[].properties`), so a value such as the `Nature`
        option « Décision » is not mistaken for the owner column `Décision`."""
        batches = B.all_batches(layout)
        self.assertTrue(batches, "the test wrote at least one batch")
        for doc in batches:
            report_ = schema.validate(doc, "notion-ops")
            self.assertTrue(report_.ok, [i.message for i in report_.issues])
            for op in doc["ops"]:
                args = op.get("args") or {}
                names: set[str] = set((args.get("properties") or {}).keys())
                for page in args.get("pages") or []:
                    names |= set((page.get("properties") or {}).keys())
                for name in notion.OWNER_FIELDS:
                    self.assertNotIn(name, names, f"owner column {name} in {doc['batch_id']}/{op['op_id']}")
                self.assertTrue(names <= set(notion.ORCHESTRATOR_FIELDS) | {notion.RELATION} | WAVE_FIELDS,
                                f"unknown property in {doc['batch_id']}/{op['op_id']}: "
                                f"{sorted(names - set(notion.ORCHESTRATOR_FIELDS) - WAVE_FIELDS)}")
            text = json.dumps(doc, ensure_ascii=False)
            self.assertRegex(doc["batch_id"], r"^N-[0-9]{8}T[0-9]{6}Z-[AB]-[0-9]{1,3}$")
            self.assertNotIn('"mode": "rows"', text)
            self.assertNotIn('"sql"', text.lower())


class CleanCheck(Base):
    def test_owner_field_check_catches_a_planted_column(self) -> None:
        """Positive control of assert_batches_clean: an owner column planted in a written batch is caught, and the
        Nature value « Décision » alone is not."""
        layout = B.make_state(self.root)
        batch = "N-20261006T073000Z-A-7"
        page = {"properties": {"Tâche": "D-004 · x", "Clé": "D-004", "Nature": "Décision"}}
        doc = {"schema": "execution.notion-ops/1", "batch_id": batch, "executor": "A", "created_utc": B.NOW,
               "kind": "mirror", "stage": 1, "wave": None,
               "ops": [{"op_id": "op-1", "tool": "notion-create-pages",
                        "args": {"parent": {"type": "data_source_id", "data_source_id": B.DS_TASKS},
                                 "allow_async": False, "pages": [page]},
                        "key": "D-004", "purpose": "create-row", "hash": "0" * 64, "capture": []}],
               "budget": {"calls": 1, "query_calls": 0, "max_in_flight": 3}, "followup": None}
        jsonio.write_json_atomic(layout.notion_batch(batch), doc)
        self.assert_batches_clean(layout)
        page["properties"]["Décision"] = "cut"
        jsonio.write_json_atomic(layout.notion_batch(batch), doc)
        with self.assertRaises(AssertionError):
            self.assert_batches_clean(layout)


class Init(Base):
    """U-NOT-01: four separate stages, each only once its inputs are captured."""

    def test_four_stages_then_first_mirror(self) -> None:
        layout = B.make_state(self.root, prof=B.profile(configured=False))
        code, env = _diff(layout, "--init")
        self.assertEqual(code, 0, env)
        b1 = env["data"]
        self.assertEqual((b1["kind"], b1["stage"]), ("init", 1))
        self.assertEqual([o["tool"] for o in b1["ops"]], ["notion-get-tool-access", "notion-fetch"])
        self.assertTrue(all(o["purpose"] == "token-check" for o in b1["ops"]))
        # a second --init before the acks is refused (pending batch), never a second batch
        code, env = _diff(layout, "--init")
        self.assertEqual(code, 1)
        self.assertEqual(env["errors"][0]["code"], "E_NOTION_PENDING")
        self.assertEqual(_ack(layout, b1["batch_id"], "op-1", B.access_result())[0], 0)
        self.assertEqual(_ack(layout, b1["batch_id"], "op-2", B.hub_result())[0], 0)

        code, env = _diff(layout, "--init")
        b2 = env["data"]
        self.assertEqual((b2["kind"], b2["stage"]), ("init", 2))
        self.assertEqual([(o["tool"], o["purpose"]) for o in b2["ops"]],
                         [("notion-update-page", "hub-now"), ("notion-create-database", "create-db"),
                          ("notion-create-database", "create-db")])
        skeleton = b2["ops"][0]["args"]["content"]
        self.assertIn("### Maintenant · orchestrateur A", skeleton)
        self.assertNotIn("orchestrateur B", skeleton)
        ddl = b2["ops"][1]["args"]["schema"]
        self.assertIn("\"État\" SELECT('Prévue':gray", ddl)
        self.assertIn("'Tranchée':green", ddl)
        self.assertNotIn("STATUS", ddl)
        self.assertEqual(ddl.count("SELECT("), 6)
        self.assertNotIn("\n", ddl)
        self.assertIn("l''orchestrateur", ddl)
        self.assertEqual(b2["ops"][1]["args"]["parent"], {"type": "page_id", "page_id": B.HUB})
        self.assertEqual(_ack(layout, b2["batch_id"], "op-1", json.dumps({"ok": True}))[0], 0)
        _c, e = _ack(layout, b2["batch_id"], "op-2", B.created_db_result(B.DB_TASKS, B.DS_TASKS, "Tâches"))
        self.assertEqual(e["data"]["captured"], {"ds:tasks": B.DS_TASKS, "db:tasks": B.DB_TASKS})
        self.assertEqual(_ack(layout, b2["batch_id"], "op-3",
                              B.created_db_result(B.DB_WAVES, B.DS_WAVES, "Vagues"))[0], 0)
        self.assertTrue((layout.local / "notion" / "hub-now.txt").exists())

        code, env = _diff(layout, "--init")
        b3 = env["data"]
        self.assertEqual((b3["kind"], b3["stage"]), ("init", 3))
        self.assertEqual(len(b3["ops"]), 1)
        self.assertEqual(b3["ops"][0]["args"]["data_source_id"], B.DS_TASKS)
        self.assertIn(f"RELATION('{B.DS_TASKS}', DUAL 'Débloque' 'debloque')", b3["ops"][0]["args"]["statements"])
        self.assertEqual(_ack(layout, b3["batch_id"], "op-1", "Updated: added column Dépend de")[0], 0)

        code, env = _diff(layout, "--init")
        b4 = env["data"]
        self.assertEqual((b4["kind"], b4["stage"]), ("init", 4))
        self.assertEqual([o["args"]["name"] for o in b4["ops"]],
                         ["Tableau", "À faire · Dev A", "À faire · Dev B", "À ingérer", "Vagues"])
        self.assertEqual(b4["ops"][4]["args"]["database_id"], B.DB_WAVES)
        nexts: list[str] = []
        for n, op in enumerate(b4["ops"], start=1):
            _c, e = _ack(layout, b4["batch_id"], op["op_id"], f"Created view {B.VIEW[op['key'][5:]]}")
            nexts += e["data"]["next"]
        patch_file = paths.posix(layout.local / "notion" / "profile-ids.patch.json")
        patch_lines = [n for n in nexts if f"ingest --patch \"{patch_file}\" --notion-ids" in n]
        self.assertEqual(len(patch_lines), 1, nexts)
        patch = json.loads((layout.local / "notion" / "profile-ids.patch.json").read_text(encoding="utf-8"))
        self.assertEqual({p["path"] for p in patch},
                         {"/notion/databases/tasks", "/notion/databases/waves", "/notion/views/board",
                          "/notion/views/needs_dev_a", "/notion/views/needs_dev_b", "/notion/views/to_ingest",
                          "/notion/views/waves"})
        self.assertTrue(all(p["op"] == "replace" for p in patch))
        # contract revision 3: the follow-up names the patch file absolutely and runs as printed from the product
        # repo root (the state an init leaves holds a policy.json); the ids then sit in the profile
        jsonio.write_json_atomic(layout.policy, S.build_policy())
        S.git(self.root, "init", "--quiet", "-b", "main")
        code, env = _run_printed(self, patch_lines[0], self.root, now=B.NOW)
        self.assertEqual(code, 0, env)
        notion_block = json.loads(layout.profile.read_text(encoding="utf-8"))["notion"]
        self.assertEqual(notion_block["databases"]["tasks"], {"database_id": B.DB_TASKS, "data_source_id": B.DS_TASKS})
        self.assertEqual(notion_block["views"]["to_ingest"], B.VIEW["to_ingest"])

        code, env = _diff(layout, "--init")
        b5 = env["data"]
        self.assertEqual(b5["stage"], 5)
        self.assertEqual([o["purpose"] for o in b5["ops"]], ["create-row"])
        self.assertEqual(len({b1["batch_id"], b2["batch_id"], b3["batch_id"], b4["batch_id"], b5["batch_id"]}), 5)
        self.assert_batches_clean(layout)

    def test_rerun_after_a_crash_adopts_existing_databases(self) -> None:
        layout = B.make_state(self.root, prof=B.profile(configured=False))
        _c, env = _diff(layout, "--init")
        b1 = env["data"]
        _ack(layout, b1["batch_id"], "op-1", B.access_result())
        _c, e = _ack(layout, b1["batch_id"], "op-2", B.hub_result(markers=("A",), adopt=True))
        self.assertEqual(e["data"]["captured"], {"db:tasks": B.DB_TASKS, "ds:tasks": B.DS_TASKS})
        _c, env = _diff(layout, "--init")
        ops = env["data"]["ops"]
        # positive control: the waves database (not on the hub) is still created
        self.assertEqual([(o["tool"], o["key"]) for o in ops], [("notion-create-database", "db:waves")])

    def test_missing_tool_stops_setup_with_a_decision(self) -> None:
        layout = B.make_state(self.root, prof=B.profile(configured=False))
        _c, env = _diff(layout, "--init")
        bid = env["data"]["batch_id"]
        _c, e = _ack(layout, bid, "op-1", B.access_result(missing="create_view"))
        self.assertTrue(any("decision propose --kind dependency-missing" in n and "create_view" in n
                            for n in e["data"]["next"]))
        _ack(layout, bid, "op-2", B.hub_result())
        _c, env = _diff(layout, "--init")
        self.assertEqual(env["data"]["stage"], 1, "setup stays at the token check while a tool is missing")

    def test_two_full_devs_get_both_blocks(self) -> None:
        self.assertIn("orchestrateur B", notion.hub_skeleton(B.profile(two_devs=True)))
        self.assertNotIn("orchestrateur B", notion.hub_skeleton(B.profile()))


class Mirror(Base):
    def test_U_NOT_02_03_creates_once_own_rows_only(self) -> None:
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        batch = _create_and_ack(self, layout)
        create = [o for o in batch["ops"] if o["purpose"] == "create-row"][0]
        keys = [p["properties"]["Clé"] for p in create["args"]["pages"]]
        self.assertEqual(keys, ["T001", "T002", "T003"])
        self.assertEqual(create["args"]["parent"], {"type": "data_source_id", "data_source_id": B.DS_TASKS})
        self.assertIs(create["args"]["allow_async"], False)
        self.assertEqual(set(create["row_hashes"]), {"T001", "T002", "T003"})
        self.assertEqual(create["hash"], create["row_hashes"]["T001"])
        local = _local(layout)
        self.assertEqual(sorted(local["notion"]["pages"]), ["T001", "T002", "T003"])
        self.assertEqual(local["notion"]["pages"]["T002"], B.page_hex(2))
        self.assertEqual(local["notion"]["hashes"]["T003"], create["row_hashes"]["T003"])
        code, env = _diff(layout)
        self.assertEqual(code, 0)
        self.assertEqual(env["data"]["ops"], [], "idempotent until something changes")
        self.assertEqual(env["data"]["count"], 0)
        self.assert_batches_clean(layout)

    def test_U_NOT_02_large_plan_splits_creates_by_100(self) -> None:
        tasks = [S.build_task(f"T{n:03d}") for n in range(1, 231)]
        layout = B.make_state(self.root, plan=B.plan_with(tasks), statuses={"A": S.build_status("A")})
        _rebuild_empty(self, layout)
        _c, env = _diff(layout)
        creates = [o for o in env["data"]["ops"] if o["purpose"] == "create-row"]
        self.assertEqual([len(o["args"]["pages"]) for o in creates], [100, 100, 30])
        self.assertEqual(creates[1]["key"], "T101")
        self.assert_batches_clean(layout)

    def test_U_NOT_04_one_update_with_only_changed_owned_properties(self) -> None:
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        _set_status(layout, "A", "T002", status="built", wave="W01", landed_sha=S.SHA_A)
        _c, env = _diff(layout)
        ops = env["data"]["ops"]
        self.assertEqual(len(ops), 1)
        op = ops[0]
        self.assertEqual((op["tool"], op["key"], op["purpose"]), ("notion-update-page", "T002", "update-row"))
        self.assertEqual(op["args"]["page_id"], B.page_hex(2))
        self.assertEqual(op["args"]["command"], "update_properties")
        self.assertEqual(op["args"]["properties"], {"État": "Intégrée"})
        self.assertTrue(set(op["args"]["properties"]) <= set(notion.ORCHESTRATOR_FIELDS))
        _ack(layout, env["data"]["batch_id"], "op-1", json.dumps({"ok": True}))
        self.assertEqual(_diff(layout)[1]["data"]["ops"], [])
        self.assert_batches_clean(layout)

    def test_relation_stage_after_creates(self) -> None:
        tasks = [S.build_task("T001"), S.build_task("T002", deps=("T001",)), S.build_task("T003")]
        layout = B.make_state(self.root, plan=B.plan_with(tasks), statuses={"A": S.build_status("A")})
        _rebuild_empty(self, layout)
        batch = _create_and_ack(self, layout, settle=False)
        create = [o for o in batch["ops"] if o["purpose"] == "create-row"][0]
        for page in create["args"]["pages"]:
            self.assertNotIn("Dépend de", page["properties"], "no relation before every page id exists")
            self.assertIn("Dépend de (clés)", page["properties"])
        _c, env = _diff(layout)
        ops = env["data"]["ops"]
        self.assertEqual([(o["key"], o["purpose"]) for o in ops], [("T002", "self-relation"), ("hub", "hub-now")])
        self.assertEqual(ops[0]["args"]["properties"], {"Dépend de": [B.page_hex(1)]})
        _ack_batch(self, layout, env["data"])
        self.assertEqual(_diff(layout)[1]["data"]["ops"], [])
        self.assert_batches_clean(layout)

    def test_cross_executor_dependency_only_in_keys(self) -> None:
        layout = B.make_state(self.root, executor="B",
                              statuses={"A": S.build_status("A"), "B": S.build_status("B")})
        _rebuild_empty_b = _diff(layout, executor="B")
        self.assertEqual(_rebuild_empty_b[0], 0)
        bid = _rebuild_empty_b[1]["data"]["batch_id"]
        _ack(layout, bid, "op-1", B.query_result([]), executor="B")
        _c, env = _diff(layout, executor="B")
        creates = [o for o in env["data"]["ops"] if o["purpose"] == "create-row"]
        self.assertEqual([p["properties"]["Clé"] for p in creates[0]["args"]["pages"]], ["T004"])
        props = creates[0]["args"]["pages"][0]["properties"]
        self.assertEqual(props["Dépend de (clés)"], "T001")
        self.assertEqual(props["Orchestrateur"], "B")
        self.assert_batches_clean(layout)

    def test_U_NOT_11_dates(self) -> None:
        tasks = [S.build_task("T001", deadline_utc="2026-10-07T15:59:00Z"), S.build_task("T002")]
        layout = B.make_state(self.root, plan=B.plan_with(tasks), statuses={"A": S.build_status("A")})
        _rebuild_empty(self, layout)
        _c, env = _diff(layout)
        pages = env["data"]["ops"][0]["args"]["pages"]
        p1 = pages[0]["properties"]
        self.assertEqual(p1["date:Échéance:start"], "2026-10-07T15:59:00Z")
        self.assertEqual(p1["date:Échéance:is_datetime"], 1)
        self.assertEqual(p1["Échéance (texte)"], "mer. 7 oct. 23:59 SGT · 17:59 Paris · zone inconnue")
        self.assertNotIn("date:Échéance:time_zone", p1)
        p2 = pages[1]["properties"]
        self.assertIsNone(p2["date:Échéance:start"], "no deadline, no latest start, no schedule: never invented")
        self.assertEqual(p2["Échéance (texte)"], "")
        self.assert_batches_clean(layout)

    def test_readings_fold_the_unit_into_the_value(self) -> None:
        """m6: `non mesuré` alone for a missing reading; the unit only follows a number (as report.fr_unit)."""
        self.assertEqual(notion._fr_unit(None, "Go"), "non mesuré")
        self.assertEqual(notion._fr_unit(None, "%"), "non mesuré")
        self.assertEqual(notion._fr_unit(True, "%"), "non mesuré", "a boolean is not a reading")
        self.assertEqual(notion._fr_unit(6.24, "Go"), "6,2 Go")
        self.assertEqual(notion._fr_unit(41.4, "%"), "41 %")
        self.assertEqual(notion._fr_unit(6.24, "Go"), report.fr_unit(6.24, "Go"))

    def test_fr_display_matches_report(self) -> None:
        zones = notion.clock.zones_from_profile(B.profile())
        for text in ("2026-10-07T15:59:00Z", "2026-10-06T20:30:00Z", "2026-10-25T00:30:00Z"):
            dt = notion.clock.parse_utc(text)
            self.assertEqual(notion.fr_display(dt, zones), report.fr_display(dt, zones))
            self.assertEqual(notion.fr_display(dt, zones, first_only=True),
                             report.fr_display(dt, zones, first_only=True))
        self.assertEqual(notion.fr_display(notion.clock.parse_utc("2026-10-06T20:30:00Z"), zones),
                         "mer. 7 oct. 04:30 SGT · mar. 6 oct. 22:30 Paris")

    def test_manual_row_body_and_awaiting_state(self) -> None:
        manual = S.build_task("T003", kind="manual")
        manual["manual"]["steps"] = ["Ouvre le portefeuille.", "Copie le hash."]
        manual["manual"]["bring_back"][0]["description"] = "le hash"
        tasks = [S.build_task("T001"), S.build_task("T002"), manual]
        status = S.build_status("A", {"T003": S.build_task_status(
            "running", posted={"at_utc": B.NOW, "push_text": "T003 à faire", "reposts": 0})})
        layout = B.make_state(self.root, plan=B.plan_with(tasks), statuses={"A": status})
        _rebuild_empty(self, layout)
        _c, env = _diff(layout)
        page = env["data"]["ops"][0]["args"]["pages"][2]
        self.assertEqual(page["properties"]["État"], "Attend ta réponse")
        self.assertEqual(page["properties"]["Nature"], "Manuelle")
        self.assertEqual(page["properties"]["Responsable"], "Dev A")
        body = page["content"]
        for heading in ("### Ce qu'il faut faire", "### À rapporter", "### Où et quand", "### Comment répondre"):
            self.assertIn(heading, body)
        self.assertIn("1. Ouvre le portefeuille.", body)
        self.assertIn("- T003-done (texte) : le hash · vérifié par ta confirmation", body)
        self.assertIn("- Où : ordinateur", body)
        agent_body = env["data"]["ops"][0]["args"]["pages"][0]["content"]
        self.assertEqual(agent_body, "Tâche du plan v1 · voir EXECUTION.md")
        self.assert_batches_clean(layout)

    def test_decision_rows_own_range_not_carried(self) -> None:
        layout = B.make_state(self.root)
        blocks = [
            {"schema": "execution.decision/1", "record": "proposal", "id": "D-004", "at_utc": B.NOW, "by": "exec@A",
             "kind": "cut", "title": "Cut T003", "tasks": ["T003"],
             "options": [{"id": "cut", "label": "Couper", "consequence": "T003 est coupée"},
                         {"id": "keep", "label": "Garder", "consequence": "rien"}], "recommended": "cut"},
            {"schema": "execution.decision/1", "record": "proposal", "id": "D-512", "at_utc": B.NOW, "by": "exec@B",
             "kind": "other", "title": "B's question", "tasks": [],
             "options": [{"id": "yes", "label": "Oui", "consequence": "ok"}]},
        ]
        S.write_text(layout.decisions, "".join(f"<!-- execution-decision {json.dumps(b, ensure_ascii=False)} -->\n"
                                               "prose\n" for b in blocks))
        _rebuild_empty(self, layout)
        _c, env = _diff(layout)
        keys = [p["properties"]["Clé"] for p in env["data"]["ops"][0]["args"]["pages"]]
        self.assertEqual(keys, ["T001", "T002", "T003", "D-004"])
        d = env["data"]["ops"][0]["args"]["pages"][3]["properties"]
        self.assertEqual((d["État"], d["Nature"], d["Responsable"], d["Orchestrateur"]),
                         ("Attend ta réponse", "Décision", "Dev A", "A"))
        self.assertEqual(d["Options"], "cut = Couper · keep = Garder")
        self.assert_batches_clean(layout)

    def test_U_NOT_12_byte_identical_for_identical_inputs(self) -> None:
        texts = []
        for name in ("one", "two"):
            root = self.root / name
            layout = B.make_state(root)
            _rebuild_empty(self, layout)
            _c, env = _diff(layout)
            texts.append(layout.notion_batch(env["data"]["batch_id"]).read_bytes())
        self.assertEqual(texts[0], texts[1])

    def test_hub_now_and_wave_report_row(self) -> None:
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        S.write_text(layout.local / "notion" / "hub-now.txt", "### Maintenant · orchestrateur A\n(en attente du premier "
                     "tick)\n— fin du bloc A —")
        local = _local(layout)
        local["waves"] = [{"wave": "W01", "status": "ingested", "manifest": "waves/W01.json", "run_id": "r",
                           "launched_utc": "2026-10-06T06:05:00Z", "finished_utc": "2026-10-06T07:10:00Z",
                           "tasks": ["T001"]}]
        jsonio.write_json_atomic(layout.local_state, local)
        code, env = B.run_cli(["report", "--wave", "W01", *B.state_args(layout)])
        self.assertEqual(code, 0, env)
        code, env = _diff(layout, "--wave", "W01")
        self.assertEqual(code, 0, env)
        batch = env["data"]
        self.assertEqual(batch["kind"], "report")
        by_purpose = {o["purpose"]: o for o in batch["ops"]}
        row = by_purpose["wave-report"]
        props = row["args"]["pages"][0]["properties"]
        self.assertEqual(props["Vague"], "W01 · A")
        self.assertEqual(props["date:Lancée:start"], "2026-10-06T06:05:00Z")
        self.assertEqual(props["Heures (texte)"], "lancée mar. 6 oct. 14:05 SGT · 08:05 Paris ; close 15:10 SGT · "
                                                  "09:10 Paris")
        self.assertEqual(row["args"]["parent"]["data_source_id"], B.DS_WAVES)
        # m6: a missing reading reads "non mesuré" alone, never followed by its unit
        self.assertNotRegex(props["Pouls"], r"non mesuré (Go|%)")
        self.assertRegex(props["Pouls"], r"^disque (non mesuré|[0-9]+,[0-9] Go) · RAM (non mesuré|[0-9]+,[0-9] Go) · "
                                         r"quota 5 h (non mesuré|[0-9]+ %) · semaine (non mesuré|[0-9]+ %) · tick ")
        self.assertEqual(row["hash"], S.sha(layout.report("W01").read_bytes()))
        hub = by_purpose["hub-now"]
        self.assertEqual(hub["args"]["command"], "update_content")
        self.assertEqual(hub["args"]["content_updates"][0]["old_str"],
                         "### Maintenant · orchestrateur A\n(en attente du premier tick)\n— fin du bloc A —")
        new = hub["args"]["content_updates"][0]["new_str"]
        self.assertTrue(new.startswith("### Maintenant · orchestrateur A\n**En marche**"))
        self.assertTrue(new.endswith("— fin du bloc A —"))
        self.assertLessEqual(len(new), 1500)
        for op in batch["ops"]:
            _ack(layout, batch["batch_id"], op["op_id"], B.created_pages_result(1, start=50)
                 if op["purpose"] == "wave-report" else json.dumps({"ok": True}))
        self.assertEqual((layout.local / "notion" / "hub-now.txt").read_text(encoding="utf-8"), new + "\n")
        self.assertIn("wave:W01", _local(layout)["notion"]["pages"])
        _c, env = _diff(layout, "--wave", "W01")
        self.assertEqual(env["data"]["ops"], [], "a wave report row is created once; the hub is unchanged")
        self.assert_batches_clean(layout)


class Redaction(Base):
    """U-NOT-05: a planted key in text that reaches Notion is never in any op."""

    def test_planted_secrets_never_reach_an_op(self) -> None:
        key = S.planted("key.private")
        task = S.build_task("T001", title=f"Rotate {key} now")
        tasks = [task, S.build_task("T002", title=f"Check {B.unscannable()} too"), S.build_task("T003")]
        layout = B.make_state(self.root, plan=B.plan_with(tasks), statuses={"A": S.build_status("A")})
        _rebuild_empty(self, layout)
        code, env = _diff(layout)
        self.assertEqual(code, 0)
        text = json.dumps(env["data"], ensure_ascii=False)
        self.assertNotIn(key, text)
        self.assertNotIn(B.unscannable(), text)
        pages = env["data"]["ops"][0]["args"]["pages"]
        self.assertIn("[redacted:hex-key]", pages[0]["properties"]["Tâche"])
        self.assertEqual(pages[1]["properties"]["Tâche"], "[redacted:secret-scan]")
        self.assertEqual(pages[2]["properties"]["Tâche"], "T003 · Task T003", "clean text passes unchanged")
        codes = [w["code"] for w in env["warnings"]]
        self.assertIn("W_SECRET_REDACTED", codes)
        self.assertTrue(any("Tâche" in w for w in self.fake.calls), "the secret scan ran on the op text")

    def test_verifier_finding_in_the_report_is_redacted(self) -> None:
        key = S.planted("key.private")
        layout = B.make_state(self.root, statuses={"A": S.build_status("A", {
            "T001": S.build_task_status("failed", wave="W01", attempts=1, landed_sha=S.SHA_A)})})
        B.write_receipt(layout, "T001", verdict="fail", findings=[
            {"id": "F1", "severity": "blocker", "claim": f"the key {key} is printed", "evidence": "log line"}])
        local = _local(layout)
        local["waves"] = [{"wave": "W01", "status": "ingested", "manifest": "waves/W01.json", "run_id": "r",
                           "launched_utc": "2026-10-06T06:05:00Z", "finished_utc": "2026-10-06T07:10:00Z",
                           "tasks": ["T001"]}]
        jsonio.write_json_atomic(layout.local_state, local)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        code, env = B.run_cli(["report", "--wave", "W01", *B.state_args(layout)])
        self.assertEqual(code, 0)
        self.assertIn("the key [redacted:hex-key] is printed", env["data"]["text_fr"])
        code, env = _diff(layout, "--wave", "W01")
        text = json.dumps(env["data"], ensure_ascii=False)
        self.assertIn("[redacted:hex-key]", text)
        self.assertNotIn(key, text)
        self.assert_batches_clean(layout)

    def test_missing_integrity_is_a_dependency_failure(self) -> None:
        """The scan never fails open: without `execlib.integrity` (simulated with a None entry in sys.modules, which
        makes the import raise ModuleNotFoundError whether or not integrity.py exists) no text-carrying batch goes
        out."""
        import sys
        import execlib
        layout = B.make_state(self.root)
        _rebuild_empty_code = _diff(layout)  # the map rebuild has no text: it passes
        self.assertEqual(_rebuild_empty_code[0], 0)
        _ack(layout, _rebuild_empty_code[1]["data"]["batch_id"], "op-1", B.query_result([]))
        saved_mod = sys.modules.get("execlib.integrity")
        saved_attr = execlib.__dict__.get("integrity")
        sys.modules["execlib.integrity"] = None  # type: ignore[assignment]
        execlib.__dict__.pop("integrity", None)
        try:
            code, env = _diff(layout)
        finally:
            sys.modules["execlib.integrity"] = saved_mod  # type: ignore[assignment]
            if saved_attr is not None:
                execlib.integrity = saved_attr  # type: ignore[attr-defined]
        self.assertEqual(code, 1, env)
        self.assertEqual(env["errors"][0]["code"], "E_DEPENDENCY_MISSING")
        self.assertEqual(B.all_batches(layout)[-1]["ops"][0]["key"], "view:board", "no mirror batch was written")
        # positive control: with the scan back, the same diff emits the creates
        code, env = _diff(layout)
        self.assertEqual(code, 0, env)
        self.assertIn("create-row", [o["purpose"] for o in env["data"]["ops"]])

    def test_scan_result_without_a_state_fails_closed(self) -> None:
        """m2: a scan result object without `state` replaces the text (it is never read as "ok")."""
        class NoState:
            id = "secrets-text"

        def no_state(text: str, *, where: str, public: frozenset[str] = frozenset()) -> NoState:
            del text, where, public
            return NoState()

        original = self.fake.scan_secrets_text
        self.fake.scan_secrets_text = no_state  # type: ignore[method-assign]
        try:
            self.assertEqual(notion.clean_text("T001 · plain title", where="test"), "[redacted:secret-scan]")
        finally:
            self.fake.scan_secrets_text = original  # type: ignore[method-assign]
        self.assertEqual(notion.clean_text("T001 · plain title", where="test"), "T001 · plain title",
                         "positive control: a result with state ok keeps the text")


class PublicValues(Base):
    """README.md 8 (contract revision 3, owner decision on Q-B04-24/25): a value listed in the state repo's
    public-values.jsonl and an explorer link's value reach Notion verbatim; the same value unlisted is redacted as
    before. Every scan of op text receives `integrity.load_public_values(layout)` as `public`."""

    def _wave_report(self, name: str, text: str, listed: str | None) -> tuple[dict, list[dict], set]:
        """The wave report row of W01 for the report `text`, with `listed` registered first (or nothing): (the
        page, the envelope warnings, the distinct `public` sets the scan received)."""
        layout = B.make_state(self.root / name)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        _wave_w01(layout)
        S.write_text(layout.report("W01"), text)
        if listed is not None:
            B.register_public(layout, listed)
        self.fake.publics.clear()
        code, env = _diff(layout, "--wave", "W01")
        self.assertEqual(code, 0, env)
        self.assert_batches_clean(layout)
        page = next(o for o in env["data"]["ops"] if o["purpose"] == "wave-report")["args"]["pages"][0]
        return page, env["warnings"], set(self.fake.publics)

    def test_registered_hash_in_the_wave_report_row_passes(self) -> None:
        listed, linked = B.tx_hash("b09-listed"), B.tx_hash("b09-linked")
        text = _report_text(listed, linked)
        # control: nothing listed, so the hash is redacted as before (property, body, warning)
        before, warnings, publics = self._wave_report("unlisted", text, None)
        self.assertNotIn(listed, json.dumps(before, ensure_ascii=False))
        self.assertEqual(before["properties"]["Ta prochaine action"], _action("[redacted:hex-key]"))
        self.assertIn(_action("[redacted:hex-key]"), before["content"])
        self.assertTrue(any(w["code"] == "W_SECRET_REDACTED" and "Ta prochaine action" in w["message"]
                            for w in warnings))
        self.assertEqual(publics, {frozenset()})
        # listed in public-values.jsonl: verbatim in the property and the body, no warning for it, and every scan
        # of the batch received the listed value
        after, warnings, publics = self._wave_report("listed", text, listed)
        self.assertEqual(after["properties"]["Ta prochaine action"], _action(listed))
        self.assertIn(_action(listed), after["content"])
        self.assertFalse(any("Ta prochaine action" in w["message"] for w in warnings))
        self.assertEqual(publics, {frozenset({listed})})
        # an explorer link's value passes in both runs; the same value bare (the pulse line) is redacted in both
        for page in (before, after):
            self.assertIn(f"[preuve](https://testnet.bscscan.com/tx/{linked})", page["content"])
            self.assertEqual(page["content"].count(linked), 1)
            self.assertIn("- Témoin : [redacted:hex-key]", page["content"])

    def test_a_registration_sends_the_hash_to_its_task_row_in_one_update(self) -> None:
        listed = B.tx_hash("b09-title")
        tasks = [S.build_task("T001", title=f"Fund the wallet, tx {listed}"), S.build_task("T002"),
                 S.build_task("T003")]
        layout = B.make_state(self.root, plan=B.plan_with(tasks), statuses={"A": S.build_status("A")})
        _rebuild_empty(self, layout)
        code, env = _diff(layout)
        self.assertEqual(code, 0, env)
        creates = next(o for o in env["data"]["ops"] if o["purpose"] == "create-row")
        self.assertEqual(creates["args"]["pages"][0]["properties"]["Tâche"],
                         "T001 · Fund the wallet, tx [redacted:hex-key]", "unlisted: redacted as before")
        self.assertNotIn(listed, json.dumps(env["data"], ensure_ascii=False))
        self.assertIn("W_SECRET_REDACTED", [w["code"] for w in env["warnings"]])
        _ack_batch(self, layout, env["data"])
        _settle_hub(self, layout)
        self.assertEqual(_diff(layout)[1]["data"]["ops"], [], "quiet while the hash is not listed")
        B.register_public(layout, listed)
        code, env = _diff(layout)
        self.assertEqual(code, 0, env)
        self.assertEqual([(o["key"], o["purpose"], o["args"]["properties"]) for o in env["data"]["ops"]],
                         [("T001", "update-row", {"Tâche": f"T001 · Fund the wallet, tx {listed}"})])
        self.assertNotIn("W_SECRET_REDACTED", [w["code"] for w in env["warnings"]])
        _ack_batch(self, layout, env["data"])
        self.assertEqual(_diff(layout)[1]["data"]["ops"], [], "settled: the listed hash is the acknowledged value")
        self.assert_batches_clean(layout)

    def test_explorer_link_passes_in_the_proof_link_and_the_report(self) -> None:
        value = B.tx_hash("b09-explorer")
        explorer = f"https://testnet.bscscan.com/tx/{value}"
        tasks = [_url_task("T001", explorer), _url_task("T002", f"https://example.org/address/{value}"),
                 S.build_task("T003", title=f"Read {value} again")]
        layout = B.make_state(self.root, plan=B.plan_with(tasks))
        B.write_receipt(layout, "T001")
        _wave_w01(layout)
        _rebuild_empty(self, layout)
        code, env = _diff(layout)
        self.assertEqual(code, 0, env)
        creates = next(o for o in env["data"]["ops"] if o["purpose"] == "create-row")
        rows = {p["properties"]["Clé"]: p["properties"] for p in creates["args"]["pages"]}
        self.assertEqual(rows["T001"]["Lien de preuve"], explorer, "an explorer link passes, nothing listed")
        self.assertIsNone(rows["T002"]["Lien de preuve"], "the same value outside /tx/: the URL is not sent")
        self.assertEqual(rows["T003"]["Tâche"], "T003 · Read [redacted:hex-key] again", "and bare: redacted")
        self.assertTrue(any(w["code"] == "W_SECRET_REDACTED" and "T002 Lien de preuve" in w["message"]
                            for w in env["warnings"]))
        _ack_batch(self, layout, env["data"])
        _settle_hub(self, layout)
        code, env = B.run_cli(["report", "--wave", "W01", *B.state_args(layout)])
        self.assertEqual(code, 0, env)
        self.assertIn(f"[preuve]({explorer})", env["data"]["text_fr"])
        code, env = _diff(layout, "--wave", "W01")
        self.assertEqual(code, 0, env)
        page = next(o for o in env["data"]["ops"] if o["purpose"] == "wave-report")["args"]["pages"][0]
        self.assertIn(f"[preuve]({explorer})", page["content"], "the report row keeps the proof's explorer link")
        self.assert_batches_clean(layout)

    def test_clean_text_rules(self) -> None:
        """The edges of the exemption: any case, whole tokens, the URL path only, a short listed string shields
        nothing, a PEM block swallows the link it holds, the proof link is kept or nulled."""
        value = B.tx_hash("b09-rules")
        public = frozenset({value})
        clean = notion.clean_text
        self.assertEqual(clean(f"tx {value}.", where="t", public=public), f"tx {value}.")
        upper = "0x" + value[2:].upper()
        self.assertEqual(clean(f"tx {upper}", where="t", public=public), f"tx {upper}", "the list is lower-cased")
        self.assertEqual(clean(f"tx {value}.", where="t"), "tx [redacted:hex-key].", "control: unlisted")
        bare = value[2:]  # listed as another chain's hash (64 hex, no 0x): the same digits behind 0x stay secret
        self.assertEqual(clean(f"key {value}", where="t", public=frozenset({bare})), "key [redacted:hex-key]",
                         "a listed value clears whole tokens only")
        for segment in ("tx", "txs", "transaction"):
            url = f"https://explorer.example/testnet/{segment}/{value}?tab=logs"
            self.assertEqual(clean(url, where="t"), url)
        for url in (f"https://explorer.example/address/{value}", f"https://explorer.example/s?q=/tx/{value}",
                    f"https://explorer.example/page#/tx/{value}", f"ftp://explorer.example/tx/{value}"):
            # redacted by log.redact itself, not left for the scan to replace the whole text
            self.assertEqual(clean(url, where="t"), url.replace(value, "[redacted:hex-key]"), url)
        password = "hunter2" + "hunter2"
        self.assertEqual(clean(f"password: {password}", where="t", public=frozenset({password})),
                         "password: [redacted:assignment]", "a listed value not shaped like a hash shields nothing")
        pem = S.planted("key.pem").split("\n")
        held = "\n".join([pem[0], pem[1], f"https://explorer.example/tx/{value}", pem[2]])
        self.assertEqual(clean(held, where="t", public=public), "[redacted:pem]")
        odd = chr(0xE000) + f" tx {value}"
        self.assertEqual(clean(odd, where="t", public=public), chr(0xE000) + " tx [redacted:hex-key]",
                         "a text holding a placeholder character is redacted whole")
        link = f"https://explorer.example/tx/{value}"
        self.assertEqual(notion.clean_url(link, where="t"), link)
        self.assertIsNone(notion.clean_url(f"https://explorer.example/address/{value}", where="t"))
        self.assertIsNone(notion.clean_url(None, where="t"))


class RowHash(unittest.TestCase):
    """U-NOT-06."""

    def test_hash_depends_only_on_owned_properties(self) -> None:
        props = {"Tâche": "T001 · x", "Clé": "T001", "État": "Prête", "Ingérée": "__NO__"}
        reordered = dict(reversed(list(props.items())))
        self.assertEqual(notion.row_hash(props, "b"), notion.row_hash(reordered, "b"))
        self.assertNotEqual(notion.row_hash(props, "b"), notion.row_hash({**props, "État": "Prouvée"}, "b"))
        self.assertNotEqual(notion.row_hash(props, "b"), notion.row_hash(props, "c"))
        fetched = {**props, "Réponse": "fait", "Répondu": "__YES__"}
        owned = {k: v for k, v in fetched.items() if k in notion.ORCHESTRATOR_FIELDS}
        self.assertEqual(notion.row_hash(owned, "b"), notion.row_hash(props, "b"))
        fetched2 = {**fetched, "Réponse": "autre chose"}
        owned2 = {k: v for k, v in fetched2.items() if k in notion.ORCHESTRATOR_FIELDS}
        self.assertEqual(notion.row_hash(owned2, "b"), notion.row_hash(props, "b"))


class Divergence(Base):
    """U-NOT-07: a human edit of an owned field is a proposal and a hold, never an overwrite."""

    def test_divergent_row_is_held(self) -> None:
        layout = B.make_state(self.root)
        local = _local(layout)
        local["awaiting"] = [{"kind": "manual", "ref": "T003", "since_utc": B.NOW, "latest_utc": None}]
        jsonio.write_json_atomic(layout.local_state, local)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        ledger = notion.load_ledger(layout)
        acked = ledger["rows"]["T003"]["props"]
        batch = "N-20261006T073000Z-A-9"
        jsonio.write_json_atomic(layout.notion_batch(batch), {
            "schema": "execution.notion-ops/1", "batch_id": batch, "executor": "A", "created_utc": B.NOW,
            "kind": "answer-fetch", "stage": 2, "wave": None,
            "ops": [{"op_id": "op-1", "tool": "notion-fetch", "args": {"id": B.page_hex(3)}, "key": "answer:T003",
                     "purpose": "fetch-answer", "hash": None, "capture": []}],
            "budget": {"calls": 1, "query_calls": 0, "max_in_flight": 3}, "followup": None})
        fetched = {**acked, "État": "Prouvée", "Réponse": "fait", "Répondu": True}
        _c, env = _ack(layout, batch, "op-1", B.fetch_page_result(fetched))
        self.assertTrue(any("decision propose --kind other" in n and "T003" in n and "État" in n
                            for n in env["data"]["next"]))
        holds = json.loads((layout.local / "notion" / "divergence.json").read_text(encoding="utf-8"))
        self.assertEqual(holds["T003"]["fields"], ["État"])
        _set_status(layout, "A", "T003", status="ready")
        _set_status(layout, "A", "T002", status="built", wave="W01", landed_sha=S.SHA_A)
        _c, env = _diff(layout)
        keys = [o["key"] for o in env["data"]["ops"]]
        self.assertNotIn("T003", keys, "a held row emits nothing")
        self.assertIn("T002", keys, "positive control: another changed row is still updated")
        self.assert_batches_clean(layout)


class Outbox(Base):
    """U-NOT-08 and the error classes of NOTION.md 11.2."""

    def _ready(self):
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        return layout

    def test_failed_update_replays_after_a_real_read(self) -> None:
        layout = self._ready()
        _set_status(layout, "A", "T002", status="built", wave="W01", landed_sha=S.SHA_A)
        _c, env = _diff(layout)
        bid = env["data"]["batch_id"]
        code, e = _fail(layout, bid, "op-1", error="HTTP 503 service unavailable")
        self.assertEqual(code, 0, "a recorded failure is not an exit failure")
        self.assertEqual(e["data"]["outbox_count"], 1)
        self.assertFalse(e["data"]["ok"])
        _c, env = _diff(layout)
        ops = env["data"]["ops"]
        self.assertEqual(env["data"]["kind"], "outbox-replay")
        self.assertEqual([(o["tool"], o["purpose"], o["key"]) for o in ops], [("notion-fetch", "token-check", "token")])
        _ack(layout, env["data"]["batch_id"], "op-1", B.hub_result(markers=("A",)))
        _c, env = _diff(layout)
        ops = env["data"]["ops"]
        self.assertEqual([(o["key"], o["purpose"]) for o in ops], [("T002", "update-row")])
        self.assertEqual(ops[0]["args"]["properties"], {"État": "Intégrée"}, "regenerated from the current state")
        self.assertEqual(_local(layout)["notion"]["outbox_count"], 0)
        lines = [json.loads(x) for x in layout.notion_outbox.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(lines[-1], {"resolved": f"{bid}/op-1", "by": "superseded"})
        self.assert_batches_clean(layout)

    def test_crashed_create_goes_through_the_map_rebuild(self) -> None:
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        _c, env = _diff(layout)
        bid = env["data"]["batch_id"]
        from execlib import notion as n
        ctx = B.ctx_for(layout, command="resume")
        self.assertEqual([o["purpose"] for o in env["data"]["ops"]], ["create-row", "hub-now"])
        self.assertEqual(n.ack_pending_as_crashed(ctx), [f"{bid}/op-1", f"{bid}/op-2"])
        # the token check comes first
        _c, env = _diff(layout)
        self.assertEqual([o["purpose"] for o in env["data"]["ops"]], ["token-check"])
        _ack(layout, env["data"]["batch_id"], "op-1", B.hub_result())
        # the 60 s delay holds creates only: the crashed hub read is regenerated at once, then the block it leads to
        _c, env = _diff(layout)
        self.assertEqual([(o["tool"], o["purpose"]) for o in env["data"]["ops"]], [("notion-fetch", "hub-now")])
        _ack(layout, env["data"]["batch_id"], "op-1", B.hub_result(markers=("A",)))
        _c, env = _diff(layout)
        self.assertEqual([(o["purpose"], o["args"].get("command")) for o in env["data"]["ops"]],
                         [("hub-now", "update_content")])
        _ack(layout, env["data"]["batch_id"], "op-1", json.dumps({"ok": True}))
        # no create sooner than 60 s after the crashed batch's emit time
        _c, env = _diff(layout)
        self.assertEqual(env["data"]["ops"], [])
        self.assertIn("wait until 2026-10-06T07:31:00Z", env["data"]["followup"])
        later = "2026-10-06T07:31:30Z"
        _c, env = _diff(layout, now=later)
        ops = env["data"]["ops"]
        self.assertEqual([(o["tool"], o["key"]) for o in ops], [("notion-query-data-sources", "view:board")])
        self.assertEqual(ops[0]["args"]["data"]["mode"], "view")
        # the lost create had landed T001 and T002: only T003 is created again
        _ack(layout, env["data"]["batch_id"], "op-1",
             B.query_result([("T001", B.page_hex(11), None), ("T002", B.page_hex(12), None)]), now=later)
        _c, env = _diff(layout, now=later)
        creates = [o for o in env["data"]["ops"] if o["purpose"] == "create-row"]
        self.assertEqual([p["properties"]["Clé"] for p in creates[0]["args"]["pages"]], ["T003"])
        rewrites = sorted(o["key"] for o in env["data"]["ops"] if o["purpose"] == "update-row")
        self.assertEqual(rewrites, ["T001", "T002"], "rows found by the map are rewritten once (hash unknown)")
        self.assert_batches_clean(layout)

    def test_rate_limit_waits_until_not_before(self) -> None:
        layout = self._ready()
        _set_status(layout, "A", "T002", status="built", wave="W01", landed_sha=S.SHA_A)
        _set_status(layout, "A", "T003", status="ready")
        _c, env = _diff(layout)
        bid = env["data"]["batch_id"]
        self.assertEqual(len(env["data"]["ops"]), 2)
        _fail(layout, bid, "op-1", error='{"error": "rate_limited", "retry_after_seconds": 40}', retry=40)
        _fail(layout, bid, "op-2", code="deferred:rate_limited")
        _c, env = _diff(layout, now="2026-10-06T07:30:20Z")
        self.assertEqual(env["data"]["ops"], [])
        self.assertIn("wait until 2026-10-06T07:30:40Z", env["data"]["followup"])
        _c, env = _diff(layout, now="2026-10-06T07:30:41Z")
        self.assertEqual([o["purpose"] for o in env["data"]["ops"]], ["token-check"], "positive control: resumes")
        lines = [json.loads(x) for x in layout.notion_outbox.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([ln.get("class") for ln in lines], ["rate-limit", "deferred"])
        self.assert_batches_clean(layout)

    def test_auth_failures_flip_the_token_and_stop_polls(self) -> None:
        layout = self._ready()
        _set_status(layout, "A", "T002", status="built", wave="W01", landed_sha=S.SHA_A)
        _c, env = _diff(layout)
        _c, e = _fail(layout, env["data"]["batch_id"], "op-1", error="401 unauthorized")
        self.assertIsNot(_local(layout)["notion"]["token_ok"], False, "one auth failure does not flip the token")
        _c, env = _diff(layout)
        _c, e = _fail(layout, env["data"]["batch_id"], "op-1", error="token rejected: run /login")
        self.assertIs(_local(layout)["notion"]["token_ok"], False)
        self.assertTrue(any("Notion refuse le jeton" in n for n in e["data"]["next"]))
        local = _local(layout)
        local["awaiting"] = [{"kind": "manual", "ref": "T003", "since_utc": B.NOW, "latest_utc": None}]
        jsonio.write_json_atomic(layout.local_state, local)
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout)])
        self.assertEqual(code, 0)
        self.assertEqual(env["data"]["ops"], [])
        self.assertIn("notion diff --replay-outbox", env["data"]["followup"])

    def test_validation_errors_are_never_replayed(self) -> None:
        layout = self._ready()
        _set_status(layout, "A", "T002", status="built", wave="W01", landed_sha=S.SHA_A)
        _c, env = _diff(layout)
        _c, e = _fail(layout, env["data"]["batch_id"], "op-1", error="400 validation_error: invalid property")
        self.assertTrue(any("decision propose --kind dependency-missing" in n for n in e["data"]["next"]))
        line = json.loads(layout.notion_outbox.read_text(encoding="utf-8").splitlines()[-1])
        self.assertEqual(line["attempts"], 99)
        self.assertEqual(line["class"], "validation")

    def test_block_cap_stops_creates_only(self) -> None:
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        _c, env = _diff(layout)
        self.assertEqual([(o["purpose"], o["tool"]) for o in env["data"]["ops"]],
                         [("create-row", "notion-create-pages"), ("hub-now", "notion-fetch")])
        _fail(layout, env["data"]["batch_id"], "op-1", error="403 restricted_resource: block limit reached")
        _ack(layout, env["data"]["batch_id"], "op-2", B.hub_result(markers=("A",)))
        degraded = json.loads((layout.local / "notion" / "degraded.json").read_text(encoding="utf-8"))
        self.assertIs(degraded["creates"], False)
        _c, env = _diff(layout)
        self.assertEqual([o["purpose"] for o in env["data"]["ops"]], ["token-check"])
        _ack(layout, env["data"]["batch_id"], "op-1", B.hub_result(markers=("A",)))
        # the replayed create needs the view:board check, a query: not sooner than 10 s after the last query batch
        _c, env = _diff(layout)
        self.assertEqual(env["data"]["ops"], [])
        self.assertIn("query spacing", env["data"]["followup"])
        _c, env = _diff(layout, now="2026-10-06T07:30:11Z")
        purposes = [o["purpose"] for o in env["data"]["ops"]]
        self.assertNotIn("create-row", purposes)
        self.assertIn("hub-now", purposes, "positive control: writes other than creates still go out")

    def test_ack_is_idempotent_and_unknown_ids_are_usage_errors(self) -> None:
        layout = self._ready()
        _set_status(layout, "A", "T002", status="built", wave="W01", landed_sha=S.SHA_A)
        _c, env = _diff(layout)
        bid = env["data"]["batch_id"]
        first = _ack(layout, bid, "op-1", json.dumps({"ok": True}))
        second = _ack(layout, bid, "op-1", json.dumps({"something": "else"}))
        self.assertEqual(first, second)
        # m5 (MODULES.md 5): the module-level ack returns the data dict, the same one the envelope carries
        data = notion.ack(B.ctx_for(layout, command="notion ack"), bid, "op-1", json.dumps({"third": 3}), None, None)
        self.assertIsInstance(data, dict)
        self.assertEqual(data, first[1]["data"])
        code, env = B.run_cli(["notion", "ack", *B.state_args(layout), "--batch", "N-20261006T073000Z-A-99",
                               "--op", "op-1", "--result-file", str(layout.local_state)])
        self.assertEqual(code, 2)
        code, env = B.run_cli(["notion", "ack", *B.state_args(layout), "--batch", bid, "--op", "op-1", "--failed",
                               "--error-code", "made-up"])
        self.assertEqual(code, 2)


class Async(Base):
    """U-NOT-09."""

    def test_async_result_schedules_a_poll_and_holds_the_row(self) -> None:
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        _set_status(layout, "A", "T002", status="built", wave="W01", landed_sha=S.SHA_A)
        _c, env = _diff(layout)
        bid = env["data"]["batch_id"]
        hash_before = _local(layout)["notion"]["hashes"]["T002"]
        _c, e = _ack(layout, bid, "op-1", json.dumps({"async_task": {"task_id": "task-77", "status": "queued"}}))
        self.assertEqual(e["data"]["captured"], {"async:T002": "task-77"})
        self.assertEqual(_local(layout)["notion"]["hashes"]["T002"], hash_before, "no hash before succeeded")
        _set_status(layout, "A", "T002", status="verifying", wave="W01", landed_sha=S.SHA_A)
        _c, env = _diff(layout)
        ops = env["data"]["ops"]
        self.assertEqual(env["data"]["kind"], "async-poll")
        self.assertEqual([(o["tool"], o["args"]) for o in ops], [("notion-get-async-task", {"task_id": "task-77"})])
        _c, e = _ack(layout, env["data"]["batch_id"], "op-1", json.dumps({"status": "running"}))
        _c, env = _diff(layout)
        self.assertEqual(env["data"]["kind"], "async-poll", "still pending: polled again")
        _ack(layout, env["data"]["batch_id"], "op-1", json.dumps({"status": "succeeded", "result": {}}))
        self.assertNotEqual(_local(layout)["notion"]["hashes"]["T002"], hash_before)
        _c, env = _diff(layout)
        self.assertEqual([(o["key"], o["args"]["properties"]) for o in env["data"]["ops"]],
                         [("T002", {"État": "En vérification"})], "the dependent update ran after the poll")
        self.assert_batches_clean(layout)


class Poll(Base):
    """U-NOT-10."""

    def test_view_mode_poll_then_one_fetch_per_own_hit(self) -> None:
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        later = "2026-10-06T07:31:00Z"  # 10 s spacing after the map rebuild query
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout, later)])
        self.assertEqual(env["data"]["ops"], [], "nothing awaited: no poll")
        local = _local(layout)
        local["awaiting"] = [{"kind": "manual", "ref": "T003", "since_utc": B.NOW, "latest_utc": None}]
        jsonio.write_json_atomic(layout.local_state, local)
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout, later)])
        self.assertEqual(code, 0)
        ops = env["data"]["ops"]
        self.assertEqual(len(ops), 1)
        self.assertEqual(ops[0]["tool"], "notion-query-data-sources")
        self.assertEqual(ops[0]["args"], {"data": {"mode": "view", "view_url": B.VIEW["to_ingest"], "page_size": 100}})
        _ack(layout, env["data"]["batch_id"], "op-1", now=later, text=
             B.query_result([("T003", B.page_hex(3), None), ("T004", B.page_hex(40), None)]))
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout, later)])
        batch = env["data"]
        self.assertEqual(batch["kind"], "answer-fetch")
        self.assertEqual([(o["tool"], o["key"], o["args"]) for o in batch["ops"]],
                         [("notion-fetch", "answer:T003", {"id": B.page_hex(3)})])
        self.assertIn(f"answers ingest --from-notion \"{_stored_fetch(layout, batch['batch_id'], 1)}\" --task T003 "
                      "--by devA", batch["followup"])
        _ack(layout, batch["batch_id"], "op-1", B.fetch_page_result({"Clé": "T003", "Réponse": "fait"}), now=later)
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout, later)])
        self.assertEqual(env["data"]["ops"], [], "polled 0 min ago: the next poll waits")
        self.assertIn("wait until", env["data"]["followup"])
        self.assert_batches_clean(layout)

    def test_poll_plan_waits_for_a_pending_batch_with_exit_0(self) -> None:
        """m4, settled by contract revision 3 (Q-B09-16): an unacked diff batch makes poll-plan exit 0 with
        `data.pending: true` and an empty batch whose followup names it, never a second pending batch; `notion
        diff` keeps refusing with E_NOTION_PENDING."""
        layout = B.make_state(self.root)
        code, env = _diff(layout)
        pending = env["data"]["batch_id"]
        self.assertEqual([o["key"] for o in env["data"]["ops"]], ["view:board"])
        local = _local(layout)
        local["awaiting"] = [{"kind": "manual", "ref": "T003", "since_utc": B.NOW, "latest_utc": None}]
        jsonio.write_json_atomic(layout.local_state, local)
        later = "2026-10-06T07:31:00Z"
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout, later)])
        self.assertEqual(code, 0, env)
        self.assertIs(env["data"]["pending"], True)
        self.assertEqual(env["data"]["ops"], [])
        self.assertIn(f"ack every op of batch {pending} first", env["data"]["followup"])
        self.assertEqual(_local(layout)["notion"]["pending_batches"], [pending], "no second pending batch")
        code, env = _diff(layout, now=later)
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_NOTION_PENDING"), "diff still refuses")
        # positive control: once the batch is acked, the same poll-plan emits the view query, pending false
        _ack(layout, pending, "op-1", B.query_result([]))
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout, later)])
        self.assertEqual(code, 0, env)
        self.assertIs(env["data"]["pending"], False)
        self.assertEqual([(o["tool"], o["key"]) for o in env["data"]["ops"]],
                         [("notion-query-data-sources", "poll:to_ingest")])
        written = json.loads(layout.notion_batch(env["data"]["batch_id"]).read_text(encoding="utf-8"))
        self.assertNotIn("pending", written, "the flag is envelope data, never part of a written batch")

    def _decision_poll(self, executor: str, blocks: list[dict]) -> tuple[dict, dict, paths.Layout]:
        """Create the rows of `executor` (two full devs), await every decision of `blocks`, poll, ack the hits,
        and return (the answer-fetch batch, the created rows' Responsable by key, the layout)."""
        root = self.root / executor
        layout = B.make_state(root, executor=executor, prof=B.profile(two_devs=True),
                              statuses={"A": S.build_status("A"), "B": S.build_status("B")})
        S.write_text(layout.decisions, "".join(f"<!-- execution-decision {json.dumps(b, ensure_ascii=False)} -->\n"
                                               "prose\n" for b in blocks))
        code, env = _diff(layout, executor=executor)
        self.assertEqual([o["key"] for o in env["data"]["ops"]], ["view:board"])
        _ack_batch(self, layout, env["data"], executor=executor)
        batch = _create_and_ack(self, layout, executor=executor)
        responsable = {p["properties"]["Clé"]: p["properties"]["Responsable"]
                       for o in batch["ops"] if o["purpose"] == "create-row" for p in o["args"]["pages"]}
        local = _local(layout)
        local["awaiting"] = [{"kind": "decision", "ref": b["id"], "since_utc": B.NOW, "latest_utc": None}
                             for b in blocks]
        jsonio.write_json_atomic(layout.local_state, local)
        later = "2026-10-06T07:31:00Z"
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout, later, executor)])
        self.assertEqual(code, 0, env)
        pages = _local(layout)["notion"]["pages"]
        hits = [(b["id"], pages[b["id"]], {"Orchestrateur": executor}) for b in blocks]
        _ack(layout, env["data"]["batch_id"], "op-1", B.query_result(hits), now=later, executor=executor)
        code, env = B.run_cli(["notion", "poll-plan", *B.state_args(layout, later, executor)])
        self.assertEqual(code, 0, env)
        self.assertEqual(env["data"]["kind"], "answer-fetch")
        self.assert_batches_clean(layout)
        return env["data"], responsable, layout

    @staticmethod
    def _proposal(did: str, by: str, kind: str) -> dict:
        return {"schema": "execution.decision/1", "record": "proposal", "id": did, "at_utc": B.NOW, "by": by,
                "kind": kind, "title": f"question {did}", "tasks": [],
                "options": [{"id": "yes", "label": "Oui", "consequence": "ok"}]}

    @staticmethod
    def _resolvable(did: str, by: str) -> dict:
        """A proposal `decision resolve` accepts: two options with their effects, a recommendation, a deadline."""
        return {"schema": "execution.decision/1", "record": "proposal", "id": did, "at_utc": B.NOW, "by": by,
                "kind": "other", "title": f"question {did}", "tasks": [],
                "options": [{"id": "yes", "label": "Oui", "consequence": "ok", "effects": [{"op": "none"}]},
                            {"id": "no", "label": "Non", "consequence": "ok", "effects": [{"op": "none"}]}],
                "recommended": "yes", "deadline_utc": "2026-10-07T00:00:00Z",
                "dedup": jsonio.sha256_bytes(did.encode("utf-8"))}

    def test_decision_hit_resolves_with_the_rows_responsable(self) -> None:
        """M1 (NOTION.md 10.2, 10.5): `--by` of `decision resolve` is the row's Responsable, never a fixed devA.
        Executor B: a dev-B question goes to devB, an owner-only kind proposed by B stays devA; executor A is the
        control (devA for its own question, devB for a question dev B raised in A's range)."""
        batch_b, resp_b, layout_b = self._decision_poll("B", [self._proposal("D-512", "exec@B", "other"),
                                                              self._proposal("D-513", "exec@B", "approval")])
        self.assertEqual((resp_b["D-512"], resp_b["D-513"]), ("Dev B", "Dev A"))
        self.assertEqual([o["key"] for o in batch_b["ops"]], ["answer:D-512", "answer:D-513"])
        follow = batch_b["followup"].split("\n")
        self.assertEqual(len(follow), 2)
        stored_1, stored_2 = (_stored_fetch(layout_b, batch_b["batch_id"], n) for n in (1, 2))
        self.assertIn(f"decision resolve --id D-512 --from-notion \"{stored_1}\" --by devB --source notion", follow[0])
        self.assertIn(f"decision resolve --id D-513 --from-notion \"{stored_2}\" --by devA --source notion", follow[1])
        batch_a, resp_a, _layout_a = self._decision_poll("A", [self._proposal("D-004", "exec@A", "other"),
                                                               self._proposal("D-005", "devB", "other")])
        self.assertEqual((resp_a["D-004"], resp_a["D-005"]), ("Dev A", "Dev B"))
        follow = batch_a["followup"].split("\n")
        self.assertIn("decision resolve --id D-004 ", follow[0])
        self.assertIn("--by devA --source notion", follow[0])
        self.assertIn("decision resolve --id D-005 ", follow[1])
        self.assertIn("--by devB --source notion", follow[1])

    def test_printed_followups_run_as_printed_from_the_repo_root(self) -> None:
        """Contract revision 3 (README.md 10): a printed follow-up names its state file by absolute path, so it runs
        as printed from the product repo root: exit 0, each decision resolved with its row's Responsable as --by.
        Positive control: the same line with the state-relative path B09 used to print exits 2 (E_USAGE) there."""
        batch, _resp, layout = self._decision_poll("A", [self._resolvable("D-004", "exec@A"),
                                                         self._resolvable("D-005", "devB")])
        root = layout.state.parent
        S.git(root, "init", "--quiet", "-b", "main")
        later = "2026-10-06T07:31:00Z"
        lines = batch["followup"].split("\n")
        self.assertEqual(len(lines), 2)
        for n, op in enumerate(batch["ops"], start=1):  # the orchestrator Writes each raw result, then acks it
            key = op["key"].split(":", 1)[1]
            _ack(layout, batch["batch_id"], op["op_id"],
                 B.fetch_page_result({"Clé": key, "Réponse": "oui, vas-y", "Décision": "yes"}), now=later)
            self.assertIn(f"--from-notion \"{_stored_fetch(layout, batch['batch_id'], n)}\"", lines[n - 1])
        relative = lines[0].replace(f"\"{_stored_fetch(layout, batch['batch_id'], 1)}\"",
                                    f"local/notion/results/{batch['batch_id']}/op-1.txt")
        code, env = _run_printed(self, relative, root, now=later)
        self.assertEqual((code, env["errors"][0]["code"]), (2, "E_USAGE"), "control: the state-relative form")
        for line in lines:
            code, env = _run_printed(self, line, root, now=later)
            self.assertEqual(code, 0, env)
        resolved = {h["id"]: h["by"] for h in _decision_headers(layout) if h.get("record") == "resolution"}
        self.assertEqual(resolved, {"D-004": "devA", "D-005": "devB"})

    def test_answer_by_without_an_acked_row(self) -> None:
        """After a map rebuild the ledger has no acked values: `--by` falls back to the rule the row is built
        with (task owner; decision proposal), and to devA for an unknown key."""
        layout = B.make_state(self.root, executor="B", prof=B.profile(two_devs=True))
        S.write_text(layout.decisions, "".join(
            f"<!-- execution-decision {json.dumps(b, ensure_ascii=False)} -->\nprose\n"
            for b in (self._proposal("D-512", "exec@B", "other"), self._proposal("D-513", "devB", "cut"))))
        ledger = notion.load_ledger(layout)
        the_plan = plan_mod.load(layout)
        self.assertEqual(notion._answer_by(layout, ledger, the_plan, "D-512"), "devB")
        self.assertEqual(notion._answer_by(layout, ledger, the_plan, "D-513"), "devA", "owner-only kind")
        self.assertEqual(notion._answer_by(layout, ledger, the_plan, "D-999"), "devA", "unknown proposal")
        ledger["rows"]["D-999"] = {"props": {"Responsable": "Dev B"}, "body": ""}
        self.assertEqual(notion._answer_by(layout, ledger, the_plan, "D-999"), "devB", "the acked value wins")


class HubRecovery(Base):
    """M2 (NOTION.md 9.3): the hub "Now" block comes back when local/notion is lost, at every wave report."""

    def _wave_ready(self) -> object:
        layout = B.make_state(self.root)
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        local = _local(layout)
        local["waves"] = [{"wave": "W01", "status": "ingested", "manifest": "waves/W01.json", "run_id": "r",
                           "launched_utc": "2026-10-06T06:05:00Z", "finished_utc": "2026-10-06T07:10:00Z",
                           "tasks": ["T001"]}]
        jsonio.write_json_atomic(layout.local_state, local)
        code, env = B.run_cli(["report", "--wave", "W01", *B.state_args(layout)])
        self.assertEqual(code, 0, env)
        return layout

    def test_lost_local_notion_brings_the_hub_block_back(self) -> None:
        import shutil
        layout = self._wave_ready()
        pages = dict(_local(layout)["notion"]["pages"])
        shutil.rmtree(layout.local / "notion")
        local = _local(layout)
        local["notion"]["pages"], local["notion"]["hashes"] = {}, {}
        jsonio.write_json_atomic(layout.local_state, local)
        later = "2026-10-06T07:45:00Z"
        code, env = _diff(layout, "--wave", "W01", now=later)
        self.assertEqual([o["key"] for o in env["data"]["ops"]], ["view:board"], "the map rebuild comes first")
        _ack(layout, env["data"]["batch_id"], "op-1", B.query_result([(k, v, None) for k, v in pages.items()]),
             now=later)
        code, env = _diff(layout, "--wave", "W01", now=later)
        self.assertEqual(code, 0, env)
        ops = env["data"]["ops"]
        purposes = [(o["purpose"], o["tool"]) for o in ops]
        self.assertIn(("wave-report", "notion-create-pages"), purposes)
        self.assertEqual(purposes[-1], ("hub-now", "notion-fetch"), "the unknown block is fetched, never dropped")
        self.assertEqual(ops[-1]["args"], {"id": B.HUB})
        self.assertIn("notion diff", env["data"]["followup"])
        _ack_batch(self, layout, env["data"], now=later)
        self.assertEqual((layout.local / "notion" / "hub-now.txt").read_text(encoding="utf-8"),
                         "### Maintenant · orchestrateur A\n(en attente du premier tick)\n— fin du bloc A —\n")
        code, env = _diff(layout, now=later)
        ops = env["data"]["ops"]
        self.assertEqual([(o["purpose"], o["args"].get("command")) for o in ops], [("hub-now", "update_content")])
        upd = ops[0]["args"]["content_updates"][0]
        self.assertEqual(upd["old_str"], "### Maintenant · orchestrateur A\n(en attente du premier tick)\n"
                                         "— fin du bloc A —")
        self.assertTrue(upd["new_str"].startswith("### Maintenant · orchestrateur A\n**En marche**"))
        self.assertIn("- Dernier rapport : W01 (base Vagues)", upd["new_str"])
        _ack_batch(self, layout, env["data"], now=later)
        self.assertEqual((layout.local / "notion" / "hub-now.txt").read_text(encoding="utf-8"), upd["new_str"] + "\n")
        self.assertEqual(_diff(layout, now=later)[1]["data"]["ops"], [], "settled again")
        self.assert_batches_clean(layout)

    def test_wave_report_after_a_lost_block_skips_the_floor_once(self) -> None:
        layout = self._wave_ready()
        (layout.local / "notion" / "hub-now.txt").unlink()
        t1 = "2026-10-06T07:32:00Z"  # 2 minutes after the last hub write: inside the 10-minute floor
        code, env = _diff(layout, "--wave", "W01", now=t1)
        self.assertEqual([(o["purpose"], o["tool"]) for o in env["data"]["ops"]],
                         [("wave-report", "notion-create-pages"), ("hub-now", "notion-fetch")])
        _ack_batch(self, layout, env["data"], now=t1)
        code, env = _diff(layout, now=t1)
        self.assertEqual([(o["purpose"], o["args"].get("command")) for o in env["data"]["ops"]],
                         [("hub-now", "update_content")], "the wave report's block is not held by the floor")
        _ack_batch(self, layout, env["data"], now=t1)
        # control: the floor holds an ordinary change of the block afterwards (a new tick time in the pulse line)
        local = _local(layout)
        local["last_tick_utc"] = "2026-10-06T07:33:00Z"
        jsonio.write_json_atomic(layout.local_state, local)
        self.assertEqual(_diff(layout, now="2026-10-06T07:33:00Z")[1]["data"]["ops"], [])
        code, env = _diff(layout, now="2026-10-06T07:43:00Z")
        self.assertEqual([o["purpose"] for o in env["data"]["ops"]], ["hub-now"], "positive control: after 10 min")
        self.assert_batches_clean(layout)

    def test_block_gone_from_the_hub_is_reinserted_at_the_end(self) -> None:
        layout = self._wave_ready()
        (layout.local / "notion" / "hub-now.txt").unlink()
        code, env = _diff(layout)
        self.assertEqual([(o["purpose"], o["tool"]) for o in env["data"]["ops"]], [("hub-now", "notion-fetch")])
        _ack(layout, env["data"]["batch_id"], "op-1", B.hub_result(markers=("B",)))
        code, env = _diff(layout)
        ops = env["data"]["ops"]
        self.assertEqual([(o["purpose"], o["args"].get("command")) for o in ops], [("hub-now", "insert_content")])
        self.assertEqual(ops[0]["args"]["position"], {"type": "end"})
        self.assertTrue(ops[0]["args"]["content"].startswith("### Maintenant · orchestrateur A\n"))
        _ack(layout, env["data"]["batch_id"], "op-1", json.dumps({"ok": True}))
        self.assertEqual((layout.local / "notion" / "hub-now.txt").read_text(encoding="utf-8"),
                         ops[0]["args"]["content"] + "\n")
        self.assertEqual(_diff(layout)[1]["data"]["ops"], [])
        self.assert_batches_clean(layout)


class Unconfigured(Base):
    """U-NOT-13."""

    def test_hub_null_exits_1_through_the_real_cli(self) -> None:
        layout = B.make_state(self.root, prof=B.profile(hub=None))
        code, env, _logs = S.run_exec(["notion", "diff", *B.state_args(layout)], cwd=self.root)
        self.assertEqual(code, 1)
        self.assertEqual(env["errors"][0]["code"], "E_NOTION_UNCONFIGURED")
        code, env, _logs = S.run_exec(["notion", "poll-plan", *B.state_args(layout)], cwd=self.root)
        self.assertEqual(code, 1)
        self.assertEqual(env["errors"][0]["code"], "E_NOTION_UNCONFIGURED")
        # positive control: the same state with a hub id goes past the check
        jsonio.write_json_atomic(layout.profile, B.profile())
        code, env = _diff(layout)
        self.assertEqual(code, 0)

    def test_disabled_and_missing_databases(self) -> None:
        prof = B.profile()
        prof["notion"]["enabled"] = False
        layout = B.make_state(self.root, prof=prof)
        code, env = _diff(layout)
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_NOTION_UNCONFIGURED"))
        jsonio.write_json_atomic(layout.profile, B.profile(configured=False))
        code, env = _diff(layout)
        self.assertEqual((code, env["errors"][0]["code"]), (1, "E_NOTION_UNCONFIGURED"), "mirror before --init")


class Labels(unittest.TestCase):
    def test_state_labels_cover_every_status_and_the_ddl(self) -> None:
        statuses = ("planned", "ready", "running", "built", "verifying", "done", "failed", "blocked-manual",
                    "blocked-decision", "cut-proposed", "cut", "superseded")
        self.assertEqual(set(notion.STATE_LABELS_FR), set(statuses))
        labels = [label for label, _c in notion.STATE_OPTIONS]
        self.assertEqual(len(labels), 14)
        self.assertEqual(labels[-1], "Tranchée")
        for label in labels:
            self.assertIn(f"'{label}':", notion.DDL_TASKS)
        self.assertEqual([v["key"] for v in notion.VIEWS], ["board", "needs_dev_a", "needs_dev_b", "to_ingest",
                                                           "waves"])
        self.assertIn("\"Ingérée\" = FALSE", notion.VIEWS[3]["configure"])

    def test_error_classes(self) -> None:
        c = notion.classify_error
        self.assertEqual(c('{"error":"rate_limited","retry_after_seconds":3}', None), "rate-limit")
        self.assertEqual(c("", "deferred:rate_limited"), "deferred")
        self.assertEqual(c("", "crash-unknown"), "crash")
        self.assertEqual(c("403 restricted_resource", None), "block-cap")
        self.assertEqual(c("invalid_grant", None), "auth")
        self.assertEqual(c("400 bad request: validation", None), "validation")
        self.assertEqual(c("504 gateway timeout", None), "transient")

    def test_ack_keeps_the_settled_signature(self) -> None:
        """Contract revision 3 (Q-B09-17): MODULES.md 5's positional parameters, plus an optional keyword-only
        `error_code` (resume R9 passes `crash-unknown` through it)."""
        params = inspect.signature(notion.ack).parameters
        self.assertEqual(list(params)[:6], ["ctx", "batch_id", "op_id", "result", "error", "retry_after"])
        self.assertEqual(params["error_code"].kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertIsNone(params["error_code"].default)


INTEGRITY_PRESENT = (S.SCRIPTS_DIR / "execlib" / "integrity.py").exists()


class RealIntegrity(unittest.TestCase):
    """Lane B06's real `execlib.integrity` (no fake): the scan, `load_public_values` and README.md 8."""

    def setUp(self) -> None:
        self.root = S.mkdtemp()

    def tearDown(self) -> None:
        S.rmtree(self.root)

    @unittest.skipUnless(INTEGRITY_PRESENT, "lane B06's integrity is absent")
    def test_clean_text_with_the_real_scanner(self) -> None:
        key = S.planted("key.private")
        out = notion.clean_text(f"value {key}", where="test")
        self.assertNotIn(key, out)
        self.assertEqual(notion.clean_text("T001 · Queue length endpoint", where="test"),
                         "T001 · Queue length endpoint")

    @unittest.skipUnless(INTEGRITY_PRESENT, "lane B06's integrity is absent")
    def test_public_values_with_the_real_scanner(self) -> None:
        from execlib import integrity
        layout = B.make_state(self.root)
        listed, linked = B.tx_hash("b09-real-listed"), B.tx_hash("b09-real-linked")
        self.assertEqual(integrity.load_public_values(layout), frozenset(), "no public-values.jsonl: empty")
        B.register_public(layout, listed)
        public = integrity.load_public_values(layout)
        self.assertEqual(public, frozenset({listed}))
        self.assertEqual(notion.clean_text(f"tx {listed}", where="test", public=public), f"tx {listed}")
        self.assertEqual(notion.clean_text(f"tx {listed}", where="test"), "tx [redacted:hex-key]",
                         "control: the same hash unlisted")
        link = f"[preuve](https://testnet.bscscan.com/tx/{linked})"
        self.assertEqual(notion.clean_text(link, where="test", public=public), link)
        self.assertEqual(notion.clean_text(f"bare {linked}", where="test", public=public), "bare [redacted:hex-key]",
                         "control: the linked value outside its link")

    @unittest.skipUnless(INTEGRITY_PRESENT, "lane B06's integrity is absent")
    def test_wave_report_row_through_the_real_exec_py(self) -> None:
        """The wave report row through a real exec.py subprocess (envelope and stderr checked by run_exec): the
        listed hash and the explorer link pass, the linked value bare is redacted."""
        layout = B.make_state(self.root)
        listed, linked = B.tx_hash("b09-sub-listed"), B.tx_hash("b09-sub-linked")
        _rebuild_empty(self, layout)
        _create_and_ack(self, layout)
        _wave_w01(layout)
        S.write_text(layout.report("W01"), _report_text(listed, linked))
        B.register_public(layout, listed)
        code, env, _logs = S.run_exec(["notion", "diff", *B.state_args(layout), "--wave", "W01"], cwd=self.root)
        self.assertEqual(code, 0, env)
        page = next(o for o in env["data"]["ops"] if o["purpose"] == "wave-report")["args"]["pages"][0]
        self.assertEqual(page["properties"]["Ta prochaine action"], _action(listed))
        self.assertIn(_action(listed), page["content"])
        self.assertIn(f"[preuve](https://testnet.bscscan.com/tx/{linked})", page["content"])
        self.assertIn("- Témoin : [redacted:hex-key]", page["content"])
        self.assertEqual(page["content"].count(linked), 1)


if __name__ == "__main__":
    unittest.main()
