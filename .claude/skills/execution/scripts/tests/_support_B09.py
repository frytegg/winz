"""Helpers of lane B09's tests (test_notion.py, test_report.py): a fake `execlib.integrity` (lane B06 is not
integrated while B09 is built; the fake follows MODULES.md's revision-3 signatures `scan_secrets_text(text, *,
where, public=frozenset()) -> Scan` and `load_public_values(layout) -> frozenset[str]`), proven-public values
(`public-values.jsonl` lines in the SCHEMAS.md 1.1 format, hashes built at runtime), state directories with a
Notion-configured profile, an in-process CLI runner that keeps the fake in place, fake Notion tool results in the
shapes NOTION.md 6.2 names, and the W03 report scenario (fixtures/B09/wave-W03/fixture.json).

Not a test module (no test_ prefix).
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import re
import sys
import types
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator, Mapping

import _support as S
from execlib import clock, jsonio, log, paths, schema
from execlib import state as state_mod
from execlib.model import Ctx

FIX = S.FIXTURES / "B09"
GOLDEN = FIX / "golden"
NOW = "2026-10-06T07:30:00Z"
HUB = "hub-1"
DS_TASKS = "11111111-2222-3333-4444-555555555555"
DS_WAVES = "66666666-7777-8888-9999-000000000000"
DB_TASKS = "a" * 32
DB_WAVES = "b" * 32
VIEW = {"board": "view://0000000a-0000-0000-0000-000000000001", "needs_dev_a": "view://0000000a-0000-0000-0000-000000000002",
        "needs_dev_b": "view://0000000a-0000-0000-0000-000000000003",
        "to_ingest": "view://0000000a-0000-0000-0000-000000000004", "waves": "view://0000000a-0000-0000-0000-000000000005"}


def unscannable() -> str:
    """A token only the fake secret scan flags (log.redact does not know it): proves the scan runs after redact."""
    return "zz" + "-unredactable-" + "secret-zz"


@dataclass(frozen=True)
class FakeScan:
    id: str
    state: str
    detail: str
    positive_control: dict | None


def tx_hash(label: str) -> str:
    """An EVM transaction hash shape (`0x` + 64 hex, log.redact's hex-key) built at runtime from a label, so no
    source or fixture holds the literal (TESTS.md 1.4)."""
    return "0x" + hashlib.sha256(label.encode("utf-8")).hexdigest()


def public_values_path(layout: paths.Layout) -> Path:
    """The state repo's `public-values.jsonl` (SCHEMAS.md 1.1)."""
    return layout.state / "public-values.jsonl"


def register_public(layout: paths.Layout, value: str, *, kind: str = "evm-tx-hash") -> None:
    """One line of `public-values.jsonl` as `answers ingest` writes it after a chain re-read (SCHEMAS.md 1.1)."""
    jsonio.append_jsonl(public_values_path(layout), {
        "value": value, "kind": kind, "chain": "bnb", "network": "testnet", "proven": "chain-reread",
        "source": "answers/T004-tx.md", "at_utc": NOW, "executor": "A"})


# README.md 8, written here independently of notion.py: an explorer link's value (right after /tx/, /txs/ or
# /transaction/ in the path of an http(s) URL) and a listed value (any case) are not hits.
_FAKE_EXPLORER = re.compile(r"(https?://[^\s?#()<>\"']*/(?:tx|txs|transaction)/)([0-9A-Za-z]+)")


def _fake_masked(text: str, public: frozenset[str]) -> str:
    out = _FAKE_EXPLORER.sub(lambda m: m.group(1) + "PUBLIC", text)
    for value in sorted(public, key=len, reverse=True):
        out = re.sub(re.escape(value), "PUBLIC", out, flags=re.IGNORECASE)
    return out


class FakeIntegrity(types.ModuleType):
    """`scan_secrets_text` flags the redaction shapes and `unscannable()`, except listed and explorer-link values;
    records every call's `where` and `public`. `load_public_values` reads the state repo's `public-values.jsonl`."""

    def __init__(self) -> None:
        super().__init__("execlib.integrity")
        self.calls: list[str] = []
        self.publics: list[frozenset[str]] = []
        self.loads = 0

    def scan_secrets_text(self, text: str, *, where: str, public: frozenset[str] = frozenset()) -> FakeScan:
        self.calls.append(where)
        self.publics.append(frozenset(public))
        masked = _fake_masked(text, frozenset(public))
        hit = unscannable() in masked or bool(log.redaction_ids(masked))
        return FakeScan("secrets-text", "fail" if hit else "ok", "planted shape" if hit else "clean", None)

    def load_public_values(self, layout: paths.Layout) -> frozenset[str]:
        self.loads += 1
        return frozenset(str(doc["value"]).lower() for _n, doc in jsonio.read_jsonl(public_values_path(layout))
                         if isinstance(doc, dict) and isinstance(doc.get("value"), str))


@contextlib.contextmanager
def fake_integrity() -> Iterator[FakeIntegrity]:
    import execlib
    saved = sys.modules.get("execlib.integrity")
    saved_attr = getattr(execlib, "integrity", None)
    fake = FakeIntegrity()
    sys.modules["execlib.integrity"] = fake
    setattr(execlib, "integrity", fake)
    try:
        yield fake
    finally:
        if saved is None:
            sys.modules.pop("execlib.integrity", None)
        else:
            sys.modules["execlib.integrity"] = saved
        if saved_attr is None:
            if hasattr(execlib, "integrity"):
                delattr(execlib, "integrity")
        else:
            setattr(execlib, "integrity", saved_attr)


# --- documents ----------------------------------------------------------------------------------------------------

def notion_block(*, configured: bool = True, hub: str | None = HUB) -> dict:
    if not configured:
        return {"enabled": True, "hub_page_id": hub, "databases": {"tasks": None, "waves": None},
                "views": {k: None for k in VIEW}, "language": "fr"}
    return {"enabled": True, "hub_page_id": hub,
            "databases": {"tasks": {"database_id": DB_TASKS, "data_source_id": DS_TASKS},
                          "waves": {"database_id": DB_WAVES, "data_source_id": DS_WAVES}},
            "views": dict(VIEW), "language": "fr"}


def profile(*, configured: bool = True, hub: str | None = HUB, two_devs: bool = False) -> dict:
    prof = S.build_profile()
    prof["notion"] = notion_block(configured=configured, hub=hub)
    if two_devs:
        prof["team"]["devs"].append({"id": "devB", "name": "Dev B", "executor": "B", "setup": "full",
                                     "notion_member": True, "availability": []})
    return prof


def four_tasks() -> list[dict]:
    """TESTS.md 3.8: T001-T003 executor A, T004 executor B (T004 depends on T001 across executors)."""
    return [S.build_task("T001"), S.build_task("T002"), S.build_task("T003"),
            S.build_task("T004", executor="B", deps=("T001",), lane="L2")]


def plan_with(tasks: list[dict]) -> dict:
    plan = S.build_plan(tasks)
    if any(t.get("lane") == "L2" for t in tasks):
        plan["lanes"].append({"id": "L2", "executor": "B", "title": "Other", "globs": ["web/**"], "contract": False})
        for t in tasks:
            if t.get("lane") == "L2":
                t["writes"] = [f"web/{t['id'].lower()}/**"]
    return plan


def make_state(root: Path, *, plan: dict | None = None, statuses: Mapping[str, dict] | None = None,
               prof: dict | None = None, executor: str = "A", local: dict | None = None) -> paths.Layout:
    layout = paths.layout_for(None, root / ".execution")
    the_plan = plan if plan is not None else plan_with(four_tasks())
    jsonio.write_json_atomic(layout.plan, the_plan)
    for ex, doc in (statuses or {"A": S.build_status("A", {"T001": S.build_task_status("done", wave="W01",
                                                                                         landed_sha=S.SHA_A,
                                                                                         receipt="proofs/T001.json"),
                                                            "T002": S.build_task_status("running", wave="W01"),
                                                            "T003": S.build_task_status("planned")})}).items():
        jsonio.write_json_atomic(layout.status(ex), doc)
    jsonio.write_json_atomic(layout.profile, prof if prof is not None else profile())
    doc = local if local is not None else state_mod.default(executor, "queue-clock", S.fixed_now())
    doc["run_state"] = doc.get("run_state") if local is not None else "RUNNING"
    jsonio.write_json_atomic(layout.local_state, doc)
    return layout


def ctx_for(layout: paths.Layout, *, executor: str = "A", now: str = NOW, command: str = "notion diff") -> Ctx:
    return Ctx(layout=layout, executor=executor, now=clock.parse_utc(now), by="orchestrator", pretty=False,
               command=command, log=log.get_logger("tests.b09"))


def write_receipt(layout: paths.Layout, task: str, **over: Any) -> None:
    doc = S.build_receipt(task, **over)
    report = schema.validate(doc, "proof-receipt")
    if not report.ok:
        raise AssertionError(f"fixture receipt invalid: {[i.message for i in report.issues]}")
    jsonio.write_json_atomic(layout.receipt(task), doc)


# --- the CLI in process (the fake integrity stays in sys.modules) ---------------------------------------------------

def run_cli(args: list[str]) -> tuple[int, dict]:
    from execlib import cli
    buf = io.StringIO()
    with S.patched_env(EXEC_LOG_LEVEL="error"), contextlib.redirect_stdout(buf):
        code = cli.main(args)
    lines = [ln for ln in buf.getvalue().split("\n") if ln.strip()]
    if len(lines) != 1:
        raise AssertionError(f"expected one stdout line, got {len(lines)}: {buf.getvalue()}")
    env = json.loads(lines[0])
    report = schema.validate(env, "envelope")
    if not report.ok:
        raise AssertionError(f"invalid envelope: {[i.message for i in report.issues]}")
    if env["ok"] != (code == 0) or env["exit_code"] != code:
        raise AssertionError(f"envelope ok/exit mismatch: {env['ok']} {env['exit_code']} vs {code}")
    return code, env


def state_args(layout: paths.Layout, now: str = NOW, executor: str = "A") -> list[str]:
    return ["--state", str(layout.state), "--now", now, "--executor", executor]


# --- fake Notion results ------------------------------------------------------------------------------------------

def page_hex(n: int) -> str:
    return f"{n:032x}"


def created_pages_result(count: int, start: int = 1) -> str:
    rows = [{"id": page_hex(start + i), "url": f"https://www.notion.so/Row-{page_hex(start + i)}"}
            for i in range(count)]
    return json.dumps({"pages": rows})


def created_db_result(db: str, ds: str, title: str) -> str:
    return (f"Created database <database url=\"https://www.notion.so/{db}\">{title}</database>\n"
            f"<data-source url=\"collection://{ds}\">\n<sqlite-table>...</sqlite-table>\n</data-source>")


def hub_result(*, markers: tuple[str, ...] = (), adopt: bool = False) -> str:
    parts = ["<page url=\"https://www.notion.so/Hub-" + "c" * 32 + "\">", "<content>"]
    for ex in markers:
        parts += [f"### Maintenant · orchestrateur {ex}", "(en attente du premier tick)", f"— fin du bloc {ex} —"]
    if adopt:
        parts.append(f"<database url=\"https://www.notion.so/{DB_TASKS}\">Tâches · Queue Clock</database>"
                     f" <data-source url=\"collection://{DS_TASKS}\"></data-source>")
    parts += ["</content>", "</page>"]
    return "\n".join(parts)


def access_result(*, missing: str | None = None) -> str:
    tools = []
    for name in ("fetch", "create_database", "update_data_source", "create_view", "create_pages", "update_page",
                 "query_data_sources", "get_async_task"):
        tools.append({"tool_name": name, "status": "unavailable" if name == missing else "available"})
    return json.dumps({"tools": tools})


def query_result(rows: list[tuple[str, str, Mapping[str, Any] | None]], *, has_more: bool = False,
                 cursor: str | None = None) -> str:
    out = []
    for key, page, props in rows:
        p = {"Clé": key, "Tâche": f"{key} · x"}
        p.update(props or {})
        out.append({"id": page, "url": f"https://www.notion.so/Row-{page}", "properties": p})
    doc: dict[str, Any] = {"results": out, "has_more": has_more}
    if cursor:
        doc["next_cursor"] = cursor
    return json.dumps(doc, ensure_ascii=False)


def fetch_page_result(props: Mapping[str, Any]) -> str:
    return ("<page url=\"https://www.notion.so/Row-" + "d" * 32 + "\">\n<properties>"
            + json.dumps(dict(props), ensure_ascii=False) + "</properties>\n<content>x</content>\n</page>")


def write_result(layout: paths.Layout, batch: str, op: str, text: str, *, error: bool = False) -> Path:
    path = layout.local / "notion" / "results" / batch / (f"{op}.error.txt" if error else f"{op}.txt")
    return S.write_text(path, text)


def all_batches(layout: paths.Layout) -> list[dict]:
    folder = layout.local / "notion" / "batches"
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(folder.glob("*.json"))] if folder.exists() \
        else []


# --- the W03 scenario of TESTS.md 3.9 --------------------------------------------------------------------------------

def wave_scenario() -> dict:
    return json.loads((FIX / "wave-W03" / "fixture.json").read_text(encoding="utf-8"))


def build_wave_state(root: Path, scenario: dict | None = None, *, drop_schedule: bool = False,
                     incoherent: str | None = None, extra_tasks: int = 0) -> paths.Layout:
    """The W03 state as schema-valid documents under root/.execution."""
    sc = copy.deepcopy(scenario or wave_scenario())
    tasks: list[dict] = []
    entries: dict[str, dict] = {}
    for spec in sc["tasks"]:
        kind = spec["kind"]
        task = S.build_task(spec["id"], kind=kind, deps=tuple(spec.get("deps", ())), title=spec["title"])
        if kind == "manual":
            task["manual"]["steps"] = spec["steps"]
            task["manual"]["where"] = spec["where"]
            task["manual"]["latest_start_utc"] = spec["latest_start_utc"]
            task["manual"]["bring_back"][0]["description"] = "le hash de la transaction de financement"
        tasks.append(task)
        entry = S.build_task_status(spec["status"], wave=spec.get("wave"), attempts=spec.get("attempts", 0))
        if spec.get("landed_sha"):
            entry["landed_sha"] = spec["landed_sha"]
        if spec.get("receipt"):
            entry["receipt"] = f"proofs/{spec['id']}.json"
        if spec.get("posted_utc"):
            entry["posted"] = {"at_utc": spec["posted_utc"], "push_text": f"{spec['id']} à faire", "reposts": 0}
        entries[spec["id"]] = entry
    for n in range(extra_tasks):
        tid = f"T{100 + n:03d}"
        tasks.append(S.build_task(tid, title=f"Extra failing task number {n} with a long descriptive title"))
        entries[tid] = S.build_task_status("failed", wave=sc["wave"], attempts=1,
                                           landed_sha="4" * 40)
    plan = S.build_plan(tasks, deadlines=sc["deadlines"])
    prof = S.build_profile()
    prof["project"]["name"] = sc["project"]
    layout = paths.layout_for(None, root / ".execution")
    jsonio.write_json_atomic(layout.plan, plan)
    jsonio.write_json_atomic(layout.status("A"), S.build_status("A", entries))
    jsonio.write_json_atomic(layout.profile, prof)
    local = state_mod.default("A", "queue-clock", clock.parse_utc(sc["now"]))
    local["run_state"] = "AWAITING_HUMAN"
    local["waves"] = [sc["wave_entry"]]
    local["awaiting"] = sc["awaiting"]
    local["last_tick_utc"] = sc["last_tick_utc"]
    local["governor"] = sc["governor"]
    local["quota"] = sc["quota"]
    report = schema.validate(local, "local-state")
    if not report.ok:
        raise AssertionError(f"fixture local state invalid: {[(i.instance_path, i.message) for i in report.issues]}")
    jsonio.write_json_atomic(layout.local_state, local)
    if not drop_schedule:
        jsonio.write_json_atomic(layout.schedule_cache, sc["schedule"])
    for spec in sc["tasks"]:
        if spec.get("receipt") and spec["id"] != incoherent:
            sha = spec["landed_sha"]
            run = f"{spec['id']}-{sha[:8]}-20261006T070000Z-1"
            write_receipt(layout, spec["id"], sha=sha, run=run, run_copy=f"proofs/runs/{spec['id']}/{run}.json",
                          attempt=spec.get("attempts", 0) + 1)
    return layout


def now_of(scenario: Mapping[str, Any] | None = None) -> datetime:
    return clock.parse_utc((scenario or wave_scenario())["now"])
