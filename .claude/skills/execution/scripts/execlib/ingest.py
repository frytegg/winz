"""`exec.py ingest`: profile.json and policy.json from the orchestrator's drafts, and the spec check (contract/CLI.md
1 `ingest`, FRONTEND.md 6.4 and 7, NOTION.md 7.3).

Never invents a field: a draft field that is null or absent where the schema requires a value is listed in
`missing` (`{field, action, why}`) and the document is written only when it validates. The profile's `frontend`
block is checked in full against /frontend's profile schema (x-external); that schema missing while the profile
has a frontend block is E_DEPENDENCY_MISSING with a `dependency-missing` proposal, never a silent pass. The mirrors
/frontend reads (frontend.paths.*, frontend.workspace.private_dir) are copied from their authoritative top-level
fields. Later changes go through `--patch` (an RFC 6902 subset, below) under a resolved decision, or without one
for Notion ids (`--notion-ids`) and the FE-01 references answer (`--answer`).

Patch file: a JSON list of `{op: add|replace|remove, path: <JSON pointer>, value?, doc?: profile|policy}` (doc
defaults to profile), or an object `{profile: [...], policy: [...]}` (contract question Q-B02-5: CLI.md does not fix
the patch format).
"""
from __future__ import annotations

import argparse
import copy
import dataclasses
import json
import re
from pathlib import Path
from typing import Any

from . import decisionsio, events, schema, state
from .errors import (DependencyMissing, ErrorItem, InternalError, PolicyRefused, UsageError, ValidationFailed)
from .jsonio import read_json, sha256_file, write_json_atomic
from .log import get_logger
from .model import CommandResult, Ctx
from .paths import Layout

_LOG = get_logger("execlib.ingest")
REQ_ID_RE = re.compile(r"\b((?:FR|SC|NFR)-\d{3,}|US\d{1,3})\b")
_REQUIRED_RE = re.compile(r"required property '([^']+)' is missing")
DECISION_FIELDS = ("/frontend", "/harden", "/models", "/prework", "/event/demo", "/event/judging", "/notion/enabled",
                   "/event_tools")
PATCH_DECISION_KINDS = ("policy-exception", "scope-change")
FRONTEND_MIRRORS: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (("frontend", "paths", "claims_ledger"), ("phase_b", "claims_ledger")),
    (("frontend", "paths", "never_show"), ("paths", "never_show")),
    (("frontend", "paths", "feature_catalogue"), ("paths", "feature_catalogue")),
    (("frontend", "paths", "spec"), ("paths", "spec")),
    (("frontend", "paths", "research"), ("paths", "research")),
    (("frontend", "workspace", "private_dir"), ("workspace", "private_dir")),
)


def _locks() -> Any:
    """MODULES.md 8 gives ingest no `locks` edge although CLI.md has it hold the state lock (contract question
    Q-B02-1); reached through decisionsio, an allowed edge."""
    return decisionsio.locks


def _decisions_mod() -> Any:
    try:
        from . import decisions
    except ImportError as err:
        if not (Path(__file__).resolve().parent / "decisions.py").is_file():
            raise InternalError("this step needs execlib.decisions (lane B04), which is not installed yet",
                                code="E_NOT_IMPLEMENTED") from err
        raise
    return decisions


# --- merging -------------------------------------------------------------------------------------------------------

def _deep_merge(base: Any, over: Any) -> Any:
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k in over:
            out[k] = _deep_merge(base.get(k), over[k]) if k in base else copy.deepcopy(over[k])
        return out
    return copy.deepcopy(over)


def _action(field: str, schema_name: str) -> str:
    if schema_name == "policy":
        return "decision"
    return "decision" if any(field == p or field.startswith(p + "/") for p in DECISION_FIELDS) else "manual-task"


def missing_from(issues: Any, schema_name: str, doc: Any) -> tuple[list[dict], list[schema.SchemaIssue]]:
    """Split schema issues into missing fields (absent required, or null where a value is required) and the rest."""
    missing: list[dict] = []
    other: list[schema.SchemaIssue] = []
    for it in issues:
        m = _REQUIRED_RE.search(it.message)
        if it.keyword == "required" and m:
            fld = f"{it.instance_path}/{m.group(1)}"
        elif it.keyword in ("type", "anyOf", "oneOf") and _value_at(doc, it.instance_path) is None \
                and it.instance_path:
            fld = it.instance_path
        else:
            other.append(it)
            continue
        if not any(x["field"] == fld for x in missing):
            missing.append({"field": fld, "action": _action(fld, schema_name),
                            "why": f"{schema_name}.schema.json requires a value at {fld} ({it.message})"})
    return sorted(missing, key=lambda x: x["field"]), other


def _value_at(doc: Any, pointer: str) -> Any:
    try:
        return schema.resolve_pointer(doc, pointer)
    except (KeyError, IndexError, TypeError, ValueError, LookupError):
        return None


def merge_draft(existing: dict | None, draft: dict | None, schema_name: str) -> tuple[dict, list[dict]]:
    """(merged document, missing fields): the existing document overlaid by the draft, then checked."""
    doc = _deep_merge(existing or {}, draft or {})
    rep = schema.validate(doc, schema_name)
    missing, _other = missing_from(rep.issues, schema_name, doc)
    return doc, missing


def _set_mirror(doc: dict, target: tuple[str, ...], value: Any) -> None:
    cur = doc
    for k in target[:-1]:
        if not isinstance(cur.get(k), dict):
            cur[k] = {}
        cur = cur[k]
    cur[target[-1]] = value


def write_mirrors(profile: dict) -> dict:
    """FRONTEND.md 7: /frontend reads mirrors of authoritative top-level fields; copy them (never invent one)."""
    if not isinstance(profile.get("frontend"), dict):
        return profile
    out = copy.deepcopy(profile)
    for target, source in FRONTEND_MIRRORS:
        val = _value_at(out, "/" + "/".join(source))
        if val is not None:
            _set_mirror(out, target, val)
    return out


# --- input files named on the command line ----------------------------------------------------------------------

def input_file(arg: str | Path, flag: str) -> Path:
    """The file a command-line flag names, or E_USAGE naming the flag and the path (README.md 5-6: a missing input
    file is a usage error, exit 2, never an E_INTERNAL FileNotFoundError). A relative path resolves against the
    working directory, as every other path argument does."""
    p = Path(arg)
    if not p.is_file():
        what = "is a directory, not a file" if p.is_dir() else "does not exist"
        where = "" if p.is_absolute() else f" (relative to {Path.cwd().as_posix()})"
        raise UsageError(f"{flag} {p.as_posix()} {what}{where}")
    return p


# --- the spec --------------------------------------------------------------------------------------------------------

def spec_info(path: Path) -> dict:
    """sha256 and the requirement ids found by regex (FR/SC/NFR-nnn, USn)."""
    p = input_file(path, "--spec")
    text = p.read_bytes().decode("utf-8", errors="replace")
    ids = sorted(set(REQ_ID_RE.findall(text)), key=lambda s: (s.split("-")[0], s))
    return {"path": p.as_posix(), "sha256": sha256_file(p), "requirement_ids": ids,
            "ids_missing": not any(i.startswith("FR-") for i in ids)}


def validated_decision(layout: Layout, sha: str) -> str | None:
    blocks = decisionsio.read_blocks(layout)
    res_by = {b["id"]: b for b in blocks if b["record"] == "resolution"}
    for prop in sorted((b for b in blocks if b["record"] == "proposal" and b.get("kind") == "spec-validation"
                        and b.get("spec_sha256") == sha), key=lambda b: int(b["id"][2:]), reverse=True):
        res = res_by.get(prop["id"])
        if res is None:
            continue
        opt = next((o for o in prop.get("options") or () if o.get("id") == res.get("choice")), None)
        if opt and any(e.get("op") == "validate-spec" for e in opt.get("effects") or ()):
            return prop["id"]
    return None


def _spec_options() -> list[dict]:
    return [{"id": "validate", "label": "Spécification validée", "consequence": "Le plan peut être construit sur ce "
             "fichier (son empreinte est enregistrée).", "effects": [{"op": "validate-spec"}]},
            {"id": "revise", "label": "À reprendre", "consequence": "Rien n'est planifié ; corrige la spécification "
             "puis relance l'ingestion.", "effects": [{"op": "none"}]}]


def _dependency_options() -> list[dict]:
    return [{"id": "wait", "label": "J'attends que /frontend soit réparé ; le reste du plan continue",
             "consequence": "Le profil n'est pas écrit tant que le schéma de /frontend manque.",
             "effects": [{"op": "none"}]},
            {"id": "cut-ui", "label": "Couper les exigences UI concernées",
             "consequence": "Une proposition de coupe (réservée au propriétaire) est ouverte.",
             "effects": [{"op": "none"}]}]


# --- patches -----------------------------------------------------------------------------------------------------------

def _tokens(pointer: str) -> list[str]:
    if not pointer.startswith("/"):
        raise UsageError(f"patch path {pointer!r} is not a JSON pointer")
    return [t.replace("~1", "/").replace("~0", "~") for t in pointer[1:].split("/")]


def apply_ops(doc: dict, ops: list[dict]) -> dict:
    out = copy.deepcopy(doc)
    for op in ops:
        kind = op.get("op")
        toks = _tokens(op.get("path", ""))
        parent: Any = out
        for t in toks[:-1]:
            parent = parent[int(t)] if isinstance(parent, list) else parent.setdefault(t, {})
        last = toks[-1]
        if kind in ("add", "replace"):
            if "value" not in op:
                raise UsageError(f"patch op {kind} {op['path']} has no value")
            if isinstance(parent, list):
                if last == "-":
                    parent.append(copy.deepcopy(op["value"]))
                elif kind == "add":
                    parent.insert(int(last), copy.deepcopy(op["value"]))
                else:
                    parent[int(last)] = copy.deepcopy(op["value"])
            else:
                if kind == "replace" and last not in parent:
                    raise UsageError(f"patch replace {op['path']}: nothing to replace")
                parent[last] = copy.deepcopy(op["value"])
        elif kind == "remove":
            if isinstance(parent, list):
                del parent[int(last)]
            elif last in parent:
                del parent[last]
            else:
                raise UsageError(f"patch remove {op['path']}: nothing to remove")
        else:
            raise UsageError(f"patch op {kind!r} is not add, replace or remove")
    return out


def _load_patch(path: Path) -> dict[str, list[dict]]:
    raw = read_json(path)
    if isinstance(raw, list):
        out: dict[str, list[dict]] = {"profile": [], "policy": []}
        for op in raw:
            doc = op.get("doc", "profile") if isinstance(op, dict) else None
            if doc not in out:
                raise UsageError(f"patch op names doc {doc!r} (profile|policy)")
            out[doc].append({k: v for k, v in op.items() if k != "doc"})
        return out
    if isinstance(raw, dict) and set(raw) <= {"profile", "policy"}:
        return {"profile": list(raw.get("profile") or []), "policy": list(raw.get("policy") or [])}
    raise UsageError("the patch file is a list of ops or {profile: [...], policy: [...]}")


def parse_answer(path: Path) -> tuple[dict, str]:
    text = path.read_bytes().decode("utf-8")
    m = re.search(r"```json\n(.*?)\n```", text, re.S)
    if not m:
        raise ValidationFailed(f"{path.as_posix()} has no fenced json header", code="E_SCHEMA")
    header = json.loads(m.group(1))
    schema.check(header, "answer", what=path.as_posix())
    return header, text[m.end():].lstrip("\n")


def _fe01_tasks(layout: Layout) -> set[str]:
    if not layout.plan.is_file():
        return set()
    raw = read_json(layout.plan)
    return {t["id"] for t in (raw.get("tasks") or ()) if t.get("template") == "frontend:FE-01"}


def _check_patch_rights(ctx: Ctx, args: argparse.Namespace, ops: dict[str, list[dict]],
                        profile: dict) -> str:
    modes = [m for m in ("decision", "notion_ids", "answer") if getattr(args, m)]
    if len(modes) != 1:
        raise UsageError("--patch needs exactly one of --decision D-nnn, --notion-ids, --answer KEY")
    mode = modes[0]
    if mode == "decision":
        prop, res = decisionsio.find(ctx.layout, args.decision)
        if prop is None or res is None:
            raise PolicyRefused(f"{args.decision} is not a resolved decision", code="E_POLICY")
        if prop.get("kind") not in PATCH_DECISION_KINDS:
            raise PolicyRefused(f"{args.decision} is of kind {prop.get('kind')}, not policy-exception or scope-change",
                                code="E_POLICY")
        return "decision"
    if mode == "notion_ids":
        if ops["policy"]:
            raise PolicyRefused("--notion-ids patches only profile.notion ids", code="E_POLICY")
        for op in ops["profile"]:
            path = op.get("path", "")
            if not (path.startswith("/notion/databases/") or path.startswith("/notion/views/")) \
                    or op.get("op") == "remove":
                raise PolicyRefused(f"--notion-ids may only set /notion/databases or /notion/views ids, not {path}",
                                    code="E_POLICY")
            if _value_at(profile, path) is not None:
                raise PolicyRefused(f"--notion-ids sets only null values; {path} already holds one", code="E_POLICY")
        return "notion-ids"
    key = args.answer
    apath = ctx.layout.answer(key)
    if not apath.is_file():
        raise PolicyRefused(f"answer {key} does not exist", code="E_POLICY")
    header, _body = parse_answer(apath)
    if not (header.get("verification") or {}).get("ok"):
        raise PolicyRefused(f"answer {key} is not verified", code="E_POLICY")
    if header.get("task") not in _fe01_tasks(ctx.layout):
        raise PolicyRefused(f"answer {key} is not an answer of the FE-01 task", code="E_POLICY")
    if ops["policy"]:
        raise PolicyRefused("--answer patches only profile /frontend/references", code="E_POLICY")
    for op in ops["profile"]:
        path = op.get("path", "")
        if not (path == "/frontend/references" or path.startswith("/frontend/references/")):
            raise PolicyRefused(f"--answer may only patch /frontend/references, not {path}", code="E_POLICY")
    return "answer"


def _patch(ctx: Ctx, args: argparse.Namespace) -> CommandResult:
    layout = ctx.layout
    patch_path = input_file(args.patch, "--patch")
    if not layout.profile.is_file() or not layout.policy.is_file():
        raise UsageError("--patch needs an existing profile.json and policy.json (run ingest first)")
    ops = _load_patch(patch_path)
    profile = read_json(layout.profile)
    policy = read_json(layout.policy)
    mode = _check_patch_rights(ctx, args, ops, profile)
    new_profile = write_mirrors(apply_ops(profile, ops["profile"]))
    new_policy = apply_ops(policy, ops["policy"])
    errors: list[ErrorItem] = []
    for name, doc in (("profile", new_profile), ("policy", new_policy)):
        rep = schema.validate(doc, name)
        errors += [ErrorItem("E_SCHEMA", f"{name}: {i.message}", path=i.instance_path or "/") for i in rep.issues]
        if name == "profile":
            ext_issues, _missing = schema.run_externals(doc, rep)
            errors += [ErrorItem("E_SCHEMA", f"profile frontend block: {i.message}", path=i.instance_path or "/")
                       for i in ext_issues]
    data = {"profile_path": None, "policy_path": None, "missing": [], "patch": {"mode": mode,
            "ops": len(ops["profile"]) + len(ops["policy"])}, "spec": None, "frontend_schema": None}
    if errors:
        return CommandResult(data=data, exit_code=1, errors=errors)
    with _locks().hold(layout, "state", command=ctx.command):
        if ops["profile"]:
            write_json_atomic(layout.profile, new_profile)
        if ops["policy"]:
            write_json_atomic(layout.policy, new_policy)
        events.append(ctx, "ingest", {"patch": mode, "decision": getattr(args, "decision", None),
                                     "answer": getattr(args, "answer", None),
                                     "pointers": sorted(op["path"] for d in ops.values() for op in d)})
    data["profile_path"] = layout.profile.as_posix()
    data["policy_path"] = layout.policy.as_posix()
    return CommandResult(data=data)


# --- the command -------------------------------------------------------------------------------------------------------

def cmd_ingest(ctx: Ctx, args: argparse.Namespace) -> CommandResult:
    if ctx.executor is None:
        ctx = dataclasses.replace(ctx, executor="A")
    if ctx.executor != "A":
        raise PolicyRefused("ingest is orchestrator A's (TWO-DEV.md 1.3)", code="E_POLICY")
    if args.patch:
        return _patch(ctx, args)
    if not args.spec:
        raise UsageError("ingest needs --spec PATH (or --patch PATH with --decision, --notion-ids or --answer)")
    layout = ctx.layout
    # every file argument is checked before anything is read or written, so a typo never leaves half a run behind
    spec_path = input_file(args.spec, "--spec")
    prof_path = input_file(args.profile_draft, "--profile-draft") if args.profile_draft else None
    pol_path = input_file(args.policy_draft, "--policy-draft") if args.policy_draft else None
    existing_profile = read_json(layout.profile) if layout.profile.is_file() else None
    existing_policy = read_json(layout.policy) if layout.policy.is_file() else None
    prof_draft = read_json(prof_path) if prof_path is not None else None
    pol_draft = read_json(pol_path) if pol_path is not None else None
    for name, doc in (("profile draft", prof_draft), ("policy draft", pol_draft)):
        if doc is not None and not isinstance(doc, dict):
            raise ValidationFailed(f"the {name} is not a JSON object", code="E_SCHEMA")
    profile, missing_p = merge_draft(existing_profile, prof_draft, "profile")
    profile = write_mirrors(profile)
    policy, missing_q = merge_draft(existing_policy, pol_draft, "policy")
    if existing_profile is None and prof_draft is None:
        missing_p = [{"field": "/", "action": "manual-task", "why": "no profile draft and no profile.json"}]
    if existing_policy is None and pol_draft is None:
        missing_q = [{"field": "/", "action": "manual-task", "why": "no policy draft and no policy.json"}]
    rep_p = schema.validate(profile, "profile")
    _m, other_p = missing_from(rep_p.issues, "profile", profile)
    rep_q = schema.validate(policy, "policy")
    _m2, other_q = missing_from(rep_q.issues, "policy", policy)
    errors: list[ErrorItem] = [ErrorItem("E_SCHEMA", f"profile: {i.message}", path=i.instance_path or "/")
                               for i in other_p]
    errors += [ErrorItem("E_SCHEMA", f"policy: {i.message}", path=i.instance_path or "/") for i in other_q]
    frontend_schema = None
    proposal = None
    missing_ext: list[dict] = []
    if isinstance(profile.get("frontend"), dict):
        ext_issues, ext_missing = schema.run_externals(profile, rep_p)
        frontend_schema = "missing" if ext_missing else "present"
        if not ext_missing:
            m_ext, other_ext = missing_from(ext_issues, "profile", profile)
            for m in m_ext:
                m["action"] = "decision"
            missing_ext = m_ext
            errors += [ErrorItem("E_SCHEMA", f"profile frontend block: {i.message}", path=i.instance_path or "/")
                       for i in other_ext]
    missing = sorted(missing_p + missing_ext + [{**m, "field": "policy:" + m["field"]} for m in missing_q],
                     key=lambda m: m["field"])
    spec = spec_info(spec_path)
    vd = validated_decision(layout, spec["sha256"])
    spec_data = {**spec, "validated": vd is not None, "validated_decision": vd}
    profile_ok = not missing_p and not missing_ext and not other_p and frontend_schema != "missing" \
        and not any(e.message.startswith("profile frontend block") for e in errors)
    policy_ok = not missing_q and not other_q
    data: dict[str, Any] = {"profile_path": None, "policy_path": None, "missing": missing, "spec": spec_data,
                            "frontend_schema": frontend_schema, "proposal": None}
    with _locks().hold(layout, "state", command=ctx.command):
        if frontend_schema == "missing":
            did, _dedup = _decisions_mod().propose(
                ctx, kind="dependency-missing", title="Schéma de profil /frontend manquant "
                "(assets/schemas/profile-frontend.schema.json)", options=_dependency_options(), tasks=[],
                deadline=None, recommended="wait")
            proposal = did
        if profile_ok:
            write_json_atomic(layout.profile, profile)
            data["profile_path"] = layout.profile.as_posix()
        if policy_ok:
            write_json_atomic(layout.policy, policy)
            data["policy_path"] = layout.policy.as_posix()
        if args.propose_spec_validation and vd is None:
            name = Path(args.spec).name
            did, _dedup = _decisions_mod().propose(
                ctx, kind="spec-validation", title=f"Valider la spécification {name} ({spec['sha256'][:8]})",
                options=_spec_options(), tasks=[], deadline=None, recommended="validate",
                extra={"spec_sha256": spec["sha256"]})
            data["spec"]["proposal"] = did
        events.append(ctx, "ingest", {"profile_written": profile_ok, "policy_written": policy_ok,
                                     "missing": len(missing), "spec_sha256": spec["sha256"],
                                     "frontend_schema": frontend_schema})
        _run_state_ingest(ctx)
    data["proposal"] = proposal
    if frontend_schema == "missing":
        raise DependencyMissing("/frontend's profile schema (assets/schemas/profile-frontend.schema.json) is absent "
                                "while the profile has a frontend block", data={**data, "proposal": proposal})
    exit_code = 0 if (profile_ok and policy_ok and not missing and not errors) else 1
    if exit_code:
        errs = errors + [ErrorItem("E_SCHEMA", f"missing {m['field']} ({m['action']})", path=m["field"])
                         for m in missing]
        return CommandResult(data=data, exit_code=1, errors=errs)
    return CommandResult(data=data)


def _run_state_ingest(ctx: Ctx) -> None:
    if not ctx.layout.local_state.is_file():
        return
    st = state.load(ctx.layout)
    if st.get("run_state") == "PREFLIGHT":
        state.set_run_state(ctx, st, "INGEST", "profile and policy ingested")
        state.save(ctx, st)
