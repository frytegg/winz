"""Task-template libraries and the deterministic instantiation of a planner draft (contract/SCHEMAS.md 6,
FRONTEND.md 2, FIX-MODE.md 6, TWO-DEV.md 8).

Two formats reach `instantiate`:
- /execution's own (`schema: "execution.task-templates/1"`, task-template.schema.json), used by
  `assets/task-templates/execution.json` and by any document already normalised;
- /frontend's own (`library: "frontend"`, integer `version`, `templates[].runner`), validated against /frontend's
  `task-templates.schema.json`, then specialised for the plan's parameter values and normalised by the adapter
  (FRONTEND.md 2.1-2.8) into our shape, which is validated against task-template.schema.json.
Anything else is E_DEPENDENCY_MISSING: never a silent translation, never a fallback UI template.

The same draft, libraries, profile and `now` always give the same plan bytes: every iteration over a mapping is
sorted, ids come from Kahn's algorithm with ties broken by (phase rank, priority, key).

Readings of the contract made here (B02 report, contract questions):
- plan.schema.json's task `key` pattern (`^[a-z0-9][a-z0-9.-]{0,60}$`) refuses the template keys of SCHEMAS.md 6.2
  (`frontend/FE-1x.G1`); the plan stores the key lower-cased with `/` replaced by `.` (`frontend.fe-1x.g1`).
- lane assignment (step 9) needs `globs`, which MODULES.md 8 does not give this module: the caller passes the
  resolver (`validate.lane_for`).
- fixed dependency rules besides the data-driven ones: the build gate, the replay pass and the convergence pass
  depend on every required task of phases setup/contract/build/integrate/verify (P-18); the factual README and
  the claims-ledger verification follow the planner's build tasks; FE-20 follows the claims verification; a
  template task holding `manifest` outside the contract wave follows the contract wave's manifest holders (P-10);
  recording follows FE-21; serial sections chain FE-1x.
"""
from __future__ import annotations

import copy
import json
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Literal, Mapping, Sequence

from . import graph, jsonio, plan, schema
from .clock import format_utc, parse_utc
from .errors import CheckFailed, DependencyMissing, ErrorItem, InternalError, ValidationFailed, warn
from .model import PlanModel
from .paths import SKILL_DIR, Layout, other_skill, posix

PHASE_ORDER: tuple[str, ...] = ("setup", "contract", "build", "integrate", "verify", "ops", "recon", "audit",
                                "manual", "decision", "deliverable", "fix")
PRIORITY_ORDER: tuple[str, ...] = ("P1", "P2", "P3")
OUR_FORMAT = "execution.task-templates/1"
EXEC_LIBRARY = SKILL_DIR / "assets" / "task-templates" / "execution.json"
FE_REL = ("assets", "task-templates", "frontend.json")
FE_SCHEMA_REL = ("assets", "schemas", "task-templates.schema.json")
SKILLS = ("frontend", "harden", "hackathon")
BUILTIN_NAMES = frozenset({"repo", "state_dir", "profile_abs", "execution_skill", "frontend_skill", "hackathon_skill",
                           "harden_skill", "python", "project", "private_dir", "never_show", "claims_ledger",
                           "dx_journal", "run_sheet", "feature_catalogue"})
FRONTEND_NAMES = frozenset({"state", "profile", "design", "preview", "build_prefix", "serve_target", "references",
                            "implementer_agent", "task_id", "workdir", "mode", "ui_root"})
GROUP_NAMES = frozenset({"group", "group_title", "features"})
IMPLEMENTER_AGENT = "execution-implementer"
FE_ENV_ALLOWLIST = ["PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "HOME", "APPDATA",
                    "LOCALAPPDATA", "PNPM_HOME", "FRONTEND_CHROMIUM", "EXEC_PROOF_OUT"]
FE_OUT = ' --out "$EXEC_PROOF_OUT"'
FE_CHANNELS = ["notion", "remote-control", "ask-user-question", "terminal"]
FE_NFR = {"key": "frontend-judged-ui", "title": "Judged UI built and gated by /frontend",
          "text": "The judged UI is built through /frontend's templates and passes frontend-check at its mode's "
                  "phase (build in full mode, small in small mode).", "priority": "P1", "required": True}
IMPORTED_ESTIMATE = {"p10_min": 2, "p50_min": 5, "p90_min": 12}
CPM_TOKEN = "{latest_start:cpm:0}"
SINK_RULE_IDS = ("EX-GATE-BUILD", "EX-REPLAY", "EX-CONVERGE")
FEATURE_FOLLOWERS = ("EX-README", "EX-HB-CLAIMS-VERIFY")
SCREENSHOT_EXCLUDED = frozenset({"EX-DLV-FORM", "EX-DLV-FLIP", "EX-DLV-FLIP-CHECK", "EX-DLV-TAG", "EX-FREEZE-DOCS",
                                 "EX-FREEZE-PUSH-TAG", "EX-DLV-SCREENSHOTS"})
DEFAULT_USD = {"gate": 2.0, "watch": 2.0, "research": 8.0}
# README.md 10 revision 4 (owner effort policy): a task or agent-role effort is low|medium|high; /frontend's schema
# still allows xhigh, so its adapter clamps anything ranked above `high` (FRONTEND.md 13).
EFFORT_RANK: Mapping[str, int] = {"low": 0, "medium": 1, "high": 2, "xhigh": 3, "max": 4}
EFFORT_CAP = "high"

# FRONTEND.md 2.8: plant ops of each /frontend template's negative control, applied to copies by `proof run`.
FE_PLANTS: Mapping[str, list[dict]] = {
    "FE-00": [{"op": "json-set", "target": "state", "path": "brief.json", "pointer": "/hero/source", "value": ""}],
    "FE-02": [{"op": "delete", "target": "state", "path": "refs-index.json", "pointer": "/receipts/0"}],
    "FE-03": [{"op": "delete", "target": "state", "glob": "directions/*/hero-mobile.png"}],
    "FE-05": [{"op": "delete", "target": "state", "glob": "brand/candidates/1/*16*"}],
    "FE-07": [{"op": "json-set", "target": "checkout", "path": "{design}/tokens.json",
               "pointer": "/color/tokens/0/usage", "value": ""}],
    "FE-08": [{"op": "regex-replace", "target": "checkout", "glob": "{ui_root}/**",
               "pattern": "(data-hero=\"h1\"[^>]*>)[^<]*", "replacement": "\\1PLANTED"}],
    "FE-09": [{"op": "regex-replace", "target": "checkout", "path": "{ui_root}/public/icon.svg",
               "pattern": "@media\\s*\\(prefers-color-scheme[^)]*\\)\\s*\\{(?:[^{}]|\\{[^{}]*\\})*\\}",
               "replacement": ""}],
    "FE-1x": [{"op": "regex-replace", "target": "checkout", "glob": "{plant_sections}",
               "pattern": "data-feature=\"{first_feature}\"", "replacement": "data-planted=\"x\""}],
    "FE-20": [{"op": "json-set", "target": "state", "path": "critique/receipt.json", "pointer": "/ok",
               "value": False}],
}
# The execution library's planted defects (same format).
EX_PLANTS: Mapping[str, list[dict]] = {
    "EX-README": [{"op": "regex-replace", "target": "checkout", "path": "README.md", "pattern": "\\A",
                   "replacement": "**TODO** planted defect\n"}],
    "EX-DLV-SCREENSHOTS": [{"op": "delete", "target": "checkout", "glob": "docs/screenshots/*"}],
}
_PLANT_SUBST_FIELDS = ("path", "glob")


@dataclass(frozen=True)
class Library:
    name: str
    version: str
    sha256: str
    raw: dict
    fmt: str = "execution"          # "execution": our format; "frontend": /frontend's own, adapted per plan
    path: Path | None = None


@dataclass
class _Prepared:
    """A library in our format for one set of parameter values, with the adapter's side data per template."""
    lib: Library
    params: dict
    templates: list[dict]
    extras: dict[str, dict] = field(default_factory=dict)
    digests: dict[str, str] = field(default_factory=dict)
    stack_serial: bool = False


@dataclass
class _Node:
    key: str
    norm: str
    origin: Literal["draft", "template", "existing"]
    fields: dict
    deps: list[str] = field(default_factory=list)
    dep_specs: list[dict] = field(default_factory=list)
    lib_key: str | None = None
    lib_name: str | None = None
    tpl_id: str | None = None
    group: str | None = None
    ui_reqs: tuple[str, ...] = ()
    order: int = 0


# --- loading -------------------------------------------------------------------------------------------------------

def library_path(name: str) -> Path:
    if name == "execution":
        return EXEC_LIBRARY
    if name == "frontend":
        return other_skill("frontend").joinpath(*FE_REL)
    raise InternalError(f"unknown template library {name!r}")


def _dep_missing(msg: str, *, issues: Sequence[str] = (), what: str = "frontend.templates") -> DependencyMissing:
    items = [ErrorItem("E_DEPENDENCY_MISSING", msg)] + [ErrorItem("E_DEPENDENCY_MISSING", i) for i in issues[:20]]
    return DependencyMissing(msg, items=items, data={"missing": what})


def load_library(name: Literal["execution", "frontend"], *, path: Path | None = None) -> Library:
    """Read and check a library (DependencyMissing for /frontend's when absent, unreadable or in neither format)."""
    src = Path(path) if path is not None else library_path(name)
    if not src.is_file():
        if name == "frontend":
            raise _dep_missing(f"/frontend's template library is absent ({posix(src)})")
        raise InternalError(f"the execution template library is missing: {posix(src)}")
    data = src.read_bytes()
    try:
        raw = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as err:
        if name == "frontend":
            raise _dep_missing(f"/frontend's template library is not JSON: {err}") from err
        raise InternalError(f"{posix(src)} is not JSON: {err}") from err
    sha = jsonio.sha256_bytes(data)
    if isinstance(raw, dict) and raw.get("schema") == OUR_FORMAT:
        rep = schema.validate(raw, "task-template")
        if not rep.ok:
            msgs = [i.message for i in rep.issues]
            if name == "frontend":
                raise _dep_missing("/frontend's library fails task-template.schema.json", issues=msgs)
            raise ValidationFailed(f"{posix(src)} fails task-template.schema.json: {msgs[0]}", code="E_SCHEMA",
                                   items=[ErrorItem("E_SCHEMA", m) for m in msgs[:50]])
        if raw.get("library") != name:
            raise _dep_missing(f"{posix(src)} declares library {raw.get('library')!r}, not {name!r}")
        return Library(name, str(raw["version"]), sha, raw, "execution", src)
    if (name == "frontend" and isinstance(raw, dict) and raw.get("library") == "frontend"
            and isinstance(raw.get("version"), int) and not isinstance(raw.get("version"), bool)
            and isinstance(raw.get("templates"), list) and raw["templates"]
            and all(isinstance(t, dict) and "runner" in t for t in raw["templates"])):
        sch_path = other_skill("frontend").joinpath(*FE_SCHEMA_REL)
        if not sch_path.is_file():
            raise _dep_missing(f"/frontend's task-templates schema is absent ({posix(sch_path)})")
        theirs = json.loads(sch_path.read_text(encoding="utf-8"))
        rep = schema.validate_with(raw, theirs, base_dir=sch_path.parent)
        if not rep.ok:
            raise _dep_missing("/frontend's library fails its own task-templates.schema.json",
                               issues=[i.message for i in rep.issues])
        return Library(name, f"{raw['version']}.0.0", sha, raw, "frontend", src)
    raise _dep_missing(f"{posix(src)} is in neither template format (no schema {OUR_FORMAT!r}, no /frontend "
                       "templates[].runner): never translated silently")


# --- parameters ----------------------------------------------------------------------------------------------------

def _pointer(doc: Any, pointer: str) -> Any:
    try:
        return schema.resolve_pointer(doc, pointer)
    except (KeyError, IndexError, TypeError, ValueError, LookupError):
        return None


def _param_error(msg: str) -> CheckFailed:
    return CheckFailed(msg, code="E_TEMPLATE_PARAM")


def _check_type(name: str, decl: Mapping, value: Any) -> None:
    t = decl.get("type")
    if t == "enum" and value not in (decl.get("enum") or ()):
        raise _param_error(f"parameter {name}={value!r} is not one of {decl.get('enum')}")
    if t in ("integer", "port") and (isinstance(value, bool) or not isinstance(value, int)):
        raise _param_error(f"parameter {name} must be an integer")
    if t == "port" and not 1024 <= value <= 65535:
        raise _param_error(f"parameter {name}={value} is not a port 1024-65535")
    if t == "boolean" and not isinstance(value, bool):
        raise _param_error(f"parameter {name} must be a boolean")
    if t in ("string", "glob", "path") and not isinstance(value, str):
        raise _param_error(f"parameter {name} must be a string")


def resolve_params(lib: Library | _Prepared, given: Mapping[str, Any], profile: dict) -> dict:
    """Draft value, else from_profile, else default (SCHEMAS.md 6.2 step 2). An undeclared or missing required
    parameter, or a draft value that contradicts the profile's, is E_TEMPLATE_PARAM."""
    raw = lib.lib.raw if isinstance(lib, _Prepared) else lib.raw
    decls = _declared(lib)
    out: dict[str, Any] = {}
    for name in sorted(given):
        if name not in decls:
            raise _param_error(f"parameter {name!r} is not declared by the {raw.get('library')} library")
    for name in sorted(decls):
        decl = decls[name]
        prof_val = _pointer(profile, decl["from_profile"]) if decl.get("from_profile") else None
        if name in given:
            value = given[name]
            if prof_val is not None and value != prof_val:
                raise _param_error(f"parameter {name}={value!r} contradicts the profile's {decl['from_profile']} "
                                   f"({prof_val!r}), which is authoritative")
        elif prof_val is not None:
            value = prof_val
        elif "default" in decl:
            value = decl["default"]
        elif decl.get("required"):
            raise _param_error(f"required parameter {name!r} of the {raw.get('library')} library has no value")
        else:
            continue
        if value is not None:
            _check_type(name, decl, value)
        out[name] = value
    return out


def _declared(lib: Library | _Prepared) -> dict:
    if isinstance(lib, _Prepared):
        return lib.lib.raw.get("parameters") if lib.lib.fmt == "execution" else _FE_PARAMS
    return lib.raw.get("parameters") if lib.fmt == "execution" else _FE_PARAMS


_FE_PARAMS: dict[str, dict] = {
    "references": {"type": "enum", "enum": ["on", "off"], "default": "on",
                   "description": "FE-01/FE-02 included and FE-03 after FE-02 (on), or dropped (off)."},
    "mode": {"type": "enum", "enum": ["full", "small"], "from_profile": "/frontend/mode", "default": "full",
             "description": "profile.frontend.mode (authoritative)."},
    "stack": {"type": "enum", "enum": ["vite-react", "next", "static-html", "existing"],
              "from_profile": "/frontend/stack", "description": "profile.frontend.stack."},
    "ui_root": {"type": "glob", "required": True, "description": "Repository-relative UI folder, never '.'."},
    "design": {"type": "path", "from_profile": "/frontend/paths/design", "default": "design",
               "description": "Repository-relative design folder."},
    "preview": {"type": "port", "description": "Preview port (stacks next and existing)."},
    "build_prefix": {"type": "string", "description": "existing stack: the build command and ' && ', or ''."},
    "serve_target": {"type": "string", "description": "existing stack: --serve or --start/--url arguments."},
    "executor": {"type": "enum", "enum": ["A", "B"], "default": "A", "description": "Executor of every FE task."},
}


def _fe_values(given: Mapping[str, Any], profile: dict) -> dict:
    vals = resolve_params(Library("frontend", "1.0.0", "", {"library": "frontend"}, "frontend"), given, profile)
    if "stack" not in vals:
        raise _param_error("profile.frontend.stack is required to specialise /frontend's library")
    if vals.get("ui_root") in (None, "", ".") or str(vals["ui_root"]).endswith("/"):
        raise _param_error("ui_root must be a repository-relative folder, not '.' and without a trailing slash")
    if vals["stack"] in ("next", "existing") and "preview" not in vals:
        raise _param_error(f"stack {vals['stack']} needs the preview port parameter")
    if vals["stack"] == "existing":
        for k in ("build_prefix", "serve_target"):
            if k not in vals:
                raise _param_error(f"stack existing needs the {k} parameter")
    return vals


# --- conditions ----------------------------------------------------------------------------------------------------

def facts(profile: dict, draft: Mapping) -> dict[str, bool]:
    prof = profile or {}
    devs = {d.get("id"): d for d in ((prof.get("team") or {}).get("devs") or ())}
    dev_b = devs.get("devB") or {}
    pre = prof.get("prework") or {}
    demo = ((prof.get("event") or {}).get("demo") or {})
    tasks = draft.get("tasks") or ()
    return {
        "name-not-confirmed": not bool((prof.get("project") or {}).get("name_owner_confirmed")),
        "video-format": demo.get("format") == "recording" or demo.get("video") is not None,
        "two-devs": dev_b.get("setup") == "full",
        "dev-b-human-only": dev_b.get("setup") == "human-only",
        "prework-forbidden": bool(pre.get("until_utc")) and (pre.get("code") is False or pre.get("designs") is False),
        "notion-enabled": bool((prof.get("notion") or {}).get("enabled")),
        "has-ui-requirements": any(r.get("surface") == "ui" for r in draft.get("requirements") or ()),
        "has-chain-writes": any(t.get("kind") == "tx" or any(str(r).startswith("wallet:")
                                                             for r in t.get("resources") or ()) for t in tasks),
    }


def condition_holds(cond: Any, params: Mapping[str, Any], fct: Mapping[str, bool]) -> bool:
    if cond is True or cond is None:
        return True
    if "all" in cond:
        return all(condition_holds(c, params, fct) for c in cond["all"])
    if "param" in cond:
        return params.get(cond["param"]) in cond["in"]
    value = bool(fct.get(cond["fact"]))
    return (not value) if cond.get("negate") else value


# --- substitution --------------------------------------------------------------------------------------------------

_TOKEN = re.compile(r"\{\{|\}\}|\{([^{}]*)\}")
_NAME = re.compile(r"^[a-z_]+$")
_LATEST = re.compile(r"^latest_start:([^:]+):(-?\d+)$")


class _Subst:
    def __init__(self, mapping: Mapping[str, str | None], *, where: str, keep: frozenset[str] = frozenset(),
                 latest: Callable[[str, int], str] | None = None) -> None:
        self.mapping = mapping
        self.where = where
        self.keep = keep
        self.latest = latest

    def text(self, s: str, fld: str) -> str:
        def repl(m: re.Match[str]) -> str:
            tok = m.group(0)
            if tok == "{{":
                return "{{" if self.keep else "{"
            if tok == "}}":
                return "}}" if self.keep else "}"
            name = m.group(1)
            lm = _LATEST.match(name)
            if lm:
                if self.latest is None:
                    raise CheckFailed(f"{self.where} {fld}: {{{name}}} cannot be resolved here",
                                      code="E_TEMPLATE_PLACEHOLDER")
                return self.latest(lm.group(1), int(lm.group(2)))
            if not _NAME.match(name):
                raise CheckFailed(f"{self.where} {fld}: unknown placeholder {{{name}}}", code="E_TEMPLATE_PLACEHOLDER")
            if name in self.keep:
                return tok
            if name not in self.mapping:
                raise CheckFailed(f"{self.where} {fld}: unknown placeholder {{{name}}}", code="E_TEMPLATE_PLACEHOLDER")
            value = self.mapping[name]
            if value is None:
                raise CheckFailed(f"{self.where} {fld}: placeholder {{{name}}} has no value in this profile or draft",
                                  code="E_TEMPLATE_PARAM")
            return str(value)
        rest = _TOKEN.sub("", s)
        if "{" in rest or "}" in rest:
            raise CheckFailed(f"{self.where} {fld}: unbalanced brace in {s!r} (escape braces as {{{{ and }}}})",
                              code="E_TEMPLATE_PLACEHOLDER")
        return _TOKEN.sub(repl, s)

    def any(self, obj: Any, fld: str) -> Any:
        if isinstance(obj, str):
            return self.text(obj, fld)
        if isinstance(obj, list):
            return [self.any(x, f"{fld}/{i}") for i, x in enumerate(obj)]
        if isinstance(obj, dict):
            return {k: self.any(v, f"{fld}/{k}") for k, v in obj.items()}
        return obj


def substitute(text: str, mapping: Mapping[str, str]) -> str:
    """Replace {placeholders} from the closed vocabulary (unknown: E_TEMPLATE_PLACEHOLDER); {{ and }} escape."""
    return _Subst(mapping, where="text").text(text, "text")


def builtins(layout: Layout, profile: dict, *, pre_t0: bool = False) -> dict[str, str | None]:
    prof = profile or {}
    ws = (prof.get("workspace") or {}).get("private_dir")
    pb = prof.get("phase_b") or {}
    paths_ = prof.get("paths") or {}
    return {
        "repo": posix(layout.repo) if layout.repo is not None else None,
        "state_dir": posix(layout.state),
        "profile_abs": posix(layout.profile),
        "execution_skill": posix(SKILL_DIR),
        "frontend_skill": posix(other_skill("frontend")),
        "hackathon_skill": posix(other_skill("hackathon")),
        "harden_skill": posix(other_skill("harden")),
        "python": "python" if os.name == "nt" else "python3",
        "project": (prof.get("project") or {}).get("slug"),
        "private_dir": ws,
        "never_show": paths_.get("never_show"),
        "claims_ledger": pb.get("claims_ledger"),
        "dx_journal": pb.get("dx_journal"),
        "run_sheet": pb.get("run_sheet"),
        "feature_catalogue": paths_.get("feature_catalogue") or posix(layout.catalogue_default),
    }


# --- the /frontend adapter (FRONTEND.md 2.1-2.8) ------------------------------------------------------------------

def _fe_dep_list(deps: Sequence[str], self_per_group: bool, per_group_ids: set[str]) -> list[dict]:
    out: list[dict] = []
    for d in deps:
        if d == "decision:project-name":
            out.append({"ref": "@project-name"})
        elif d == "manual:harden-review":
            out.append({"ref": "@harden-review"})
            out.append({"ref": "@fix-gate"})
        elif d.startswith(("decision:", "manual:")):
            raise _dep_missing(f"/frontend's library names an unknown symbolic dependency {d!r}")
        elif d in per_group_ids and not self_per_group:
            out.append({"ref": f"@all-instances:{d}"})
        else:
            out.append({"template": d, "required": True})
    return out


def _fe_writes(writes: Sequence[str], stack: str) -> tuple[list[str], list[str]]:
    plan_writes: list[str] = []
    external: list[str] = []
    for w in writes:
        if w == "{profile}":
            continue
        if w.startswith("{private_dir}/"):
            external.append(w)
            continue
        if w.startswith("{state}/"):
            plan_writes.append(".execution/frontend/" + w[len("{state}/"):])
            continue
        if w == "{ui_root}/**" and stack in ("vite-react", "next"):
            plan_writes += ["{ui_root}/src/**", "{ui_root}/public/**", "{ui_root}/index.html",
                            "{ui_root}/*.config.*", "{ui_root}/app/**"]
            continue
        plan_writes.append(w)
    dedup: list[str] = []
    for w in plan_writes:
        if w not in dedup:
            dedup.append(w)
    return dedup, external


def _fe_cmd(spec: str) -> str:
    parts = spec.split(" && ")
    return " && ".join(p + FE_OUT if "frontend-check.mjs" in p else p for p in parts)


def _fe_proof(t: dict, tid: str) -> dict:
    pr = t["proof"]
    if pr["type"] == "command":
        cmd = _fe_cmd(pr["spec"])
        install = "pnpm -C" in cmd
        timeout = int(max(60, pr["max_runtime_min"] * 60) + (600 if install else 0))
        if tid in FE_PLANTS:
            kind = "forgery" if tid == "FE-20" else "planted-defect"
            nc = {"kind": kind, "description": pr["negative_control"], "expect_nonzero": True}
        else:
            nc = {"kind": "pre-implementation" if t["kind"] in ("code",) else "forgery",
                  "description": pr["negative_control"], "expect_nonzero": True}
        return {"type": "command",
                "spec": {"cmd": cmd, "shell": "bash", "cwd": ".", "install": install, "timeout_s": min(1800, timeout),
                         "env_allowlist": list(FE_ENV_ALLOWLIST)},
                "expect": {"summary": pr["expect"], "exit_code": 0},
                "max_runtime_min": pr["max_runtime_min"], "negative_control": nc}
    nc_na = {"kind": "not-applicable", "description": pr["negative_control"], "expect_nonzero": True,
             "waived_reason": "owner checkpoint: its file proof is evaluated by exec.py; /frontend's control: "
                              + pr["negative_control"]}
    base = {"expect": {"summary": pr["expect"]}, "max_runtime_min": pr["max_runtime_min"], "negative_control": nc_na}
    if tid == "FE-01":
        spec = {"path": "{profile}", "json_pointer": "/frontend/references", "json_checks": [
            {"pointer": "", "check": "min-items", "where": {"owner_confirmed": True}, "value": 2},
            {"pointer": "/*/url", "check": "url"}, {"pointer": "/*/source", "check": "non-empty"}]}
    elif tid in ("FE-04", "FE-06"):
        key, base_dir = ("/H1", "{state}/directions") if tid == "FE-04" else ("/H2", "{state}/brand/candidates")
        spec = {"path": "{state}/choices.json", "json_pointer": key, "json_checks": [
            {"pointer": "/pick", "check": "dir-exists", "base": base_dir},
            {"pointer": "/answered_at", "check": "utc"},
            {"pointer": "/channel", "check": "enum", "values": list(FE_CHANNELS)}]}
    elif tid == "FE-21":
        spec = {"path": "{state}/choices.json", "json_pointer": "/H3", "json_checks": [
            {"pointer": "/signed_off", "check": "equals", "value": True},
            {"pointer": "/changes", "check": "equals", "value": []},
            {"pointer": "/answered_at", "check": "utc"},
            {"pointer": "/channel", "check": "enum", "values": list(FE_CHANNELS)}]}
    else:
        file_, _, ptr = pr["spec"].partition("#")
        spec = {"path": file_, "json_pointer": ptr}
    return {"type": "file", "spec": spec, **base}


def _fe_manual(t: dict, tid: str) -> dict:
    m = t["manual"]
    out = {"steps": list(m["steps"]), "where": m["where"], "latest_start_utc": "{latest_start:cpm:0}",
           "options_source": None, "options": [], "decision_deadline_utc": None}
    text = m["bring_back"]
    if tid == "FE-01":
        bb = [{"key": "{task_id}-refs", "kind": "text", "description": text,
               "verify": {"method": "regex", "spec": "^(?:(?:keep|replace|drop|add) [^\\n]+\\n?)+$"}}]
    elif tid in ("FE-04", "FE-06"):
        bb = [{"key": "{task_id}-pick", "kind": "choice", "description": text,
               "verify": {"method": "choice-in-options"}}]
        out["options_source"] = "{state}/directions/" if tid == "FE-04" else "{state}/brand/candidates/"
    elif tid == "FE-21":
        bb = [{"key": "{task_id}-signoff", "kind": "text", "description": text,
               "verify": {"method": "regex", "spec": "^(?i:oui|yes)\\b"}}]
    else:
        bb = [{"key": "{task_id}-answer", "kind": "text", "description": text, "verify": {"method": "owner-attest"}}]
        if m.get("options_source"):
            out["options_source"] = m["options_source"]
    out["bring_back"] = bb
    return out


def adapt_frontend(lib: Library, values: Mapping[str, Any]) -> _Prepared:
    """Specialise /frontend's library for the plan's values and normalise it into our format (FRONTEND.md 2.2-2.3);
    the result is validated against task-template.schema.json (E_DEPENDENCY_MISSING when it does not fit)."""
    doc = lib.raw
    root, local = doc.get("skill_root"), posix(other_skill("frontend"))
    if root and root.rstrip("/") != local.rstrip("/"):
        # frontend.json names its files under its author's skill_root; this machine's /frontend lives elsewhere
        # (dev B's machine, tests): every path is re-rooted, never left pointing at another machine's folder.
        doc = _replace_all(copy.deepcopy(doc), root.rstrip("/"), local.rstrip("/"))
    mode, refs, stack = values["mode"], values["references"], values["stack"]
    stack_def = (doc.get("stacks") or {}).get(stack)
    if stack_def is None:
        raise _dep_missing(f"/frontend's library has no stack {stack!r}")
    selected: list[dict] = []
    for t in doc["templates"]:
        t = copy.deepcopy(t)
        tparams = t.get("params") or {}
        if mode == "small" and not (t.get("small_mode") or {}).get("include", True):
            continue
        ov_r = (tparams.get("references") or {}).get(refs) or {}
        ov_m = (tparams.get("mode") or {}).get(mode) or {}
        if ov_r.get("include") is False or ov_m.get("include") is False:
            continue
        for ov in (ov_r, ov_m):
            if ov.get("depends"):
                t["depends"] = list(t.get("depends") or []) + [d for d in ov["depends"] if d not in t["depends"]]
            if ov.get("writes"):
                t["writes"] = list(ov["writes"])
            if ov.get("instances"):
                t["instances"] = ov["instances"]
        spec = t["proof"]["spec"]
        for rep in stack_def.get("replace") or ():
            spec = spec.replace(rep["from"], rep["to"])
            if t.get("fragment"):
                t["fragment"]["input"] = _replace_all(t["fragment"]["input"], rep["from"], rep["to"])
        t["proof"]["spec"] = spec
        if "--serve" in spec or "--start" in spec:
            res = list(t.get("resources") or [])
            for r in list(stack_def.get("add_resources") or ()) + ["browser"]:
                if r not in res:
                    res.append(r)
            t["resources"] = res
        selected.append(t)
    originals = {t["id"]: t for t in lib.raw["templates"]}
    where = {t["id"]: f"/templates/{i}" for i, t in enumerate(lib.raw["templates"])}
    per_group = {t["id"] for t in selected if t["instances"] == "per-group"}
    templates: list[dict] = []
    extras: dict[str, dict] = {}
    digests: dict[str, str] = {}
    for t in selected:
        tid = t["id"]
        is_pg = t["instances"] == "per-group"
        owner_task = t["kind"] in ("manual", "decision")
        deps = _fe_dep_list(t.get("depends") or (), is_pg, per_group)
        if (t.get("covers") or {}).get("depends_on_covering_tasks"):
            deps.append({"ref": "@feature-tasks"})
        if tid == "FE-00":
            deps.append({"ref": "@spec-approved"})
        if (t.get("covers") or {}).get("rule") == "feature-group":
            covers = {"rule": "group-requirements" if is_pg else "ui-requirements"}
        else:
            covers = {"rule": "nfr", "nfr": dict(FE_NFR)}
        writes, external = _fe_writes(t.get("writes") or (), stack)
        if t["pre_t0"]:
            pclass = "research"
        elif owner_task:
            pclass = "none"
        else:
            pclass = "design"
        est = {m: {"p10_min": t["estimate"][m]["p10"], "p50_min": t["estimate"][m]["p50"],
                   "p90_min": t["estimate"][m]["p90"]} for m in ("full", "small")}
        norm: dict[str, Any] = {
            "id": tid, "title": t["title"], "description": t["description"], "kind": t["kind"],
            "phase": t["phase"], "include": True, "per": "feature-group" if is_pg else None, "covers": covers,
            "depends_on": deps, "writes": writes, "resources": list(t.get("resources") or ()), "estimate": est,
            "model": t["model"], "effort": cap_effort(t["effort"], tid, f"{where[tid]}/effort"),
            "proof": _fe_proof(t, tid), "brief_refs": list(t["brief_refs"]),
            "manual": _fe_manual(t, tid) if owner_task else None,
            "required": "from-requirements" if tid == "FE-1x" else True,
            "priority": "from-requirements" if tid == "FE-1x" else "P1",
            "prework_class": pclass, "max_attempts": 2, "owner": "devA" if owner_task else "agent",
        }
        if not owner_task:
            norm["verify"] = {"model": "opus", "effort": "high"}
        if t["kind"] == "decision":
            norm["decision_kind"] = "plan-task"
        templates.append(norm)
        ex: dict[str, Any] = {"verify_estimate": {"p10_min": t["estimate"]["verify"]["p10"],
                                                  "p50_min": t["estimate"]["verify"]["p50"],
                                                  "p90_min": t["estimate"]["verify"]["p90"]},
                              "estimate_basis": t["estimate"]["basis"]}
        if external:
            ex["external_writes"] = external
        if t.get("fragment"):
            ex["fragment"] = _fe_fragment(t["fragment"], tid, where[tid])
        if tid in FE_PLANTS:
            ex["plant"] = copy.deepcopy(FE_PLANTS[tid])
        if owner_task:
            ex["latest_start_rule"] = "cpm"
        extras[tid] = ex
        digests[tid] = jsonio.sha256_json(originals[tid])
    normalised = {"schema": OUR_FORMAT, "library": "frontend", "version": f"{doc['version']}.0.0",
                  "parameters": copy.deepcopy(_FE_PARAMS), "templates": templates}
    rep = schema.validate(normalised, "task-template")
    if not rep.ok:
        raise _dep_missing("/frontend's library, once normalised, fails task-template.schema.json",
                           issues=[i.message for i in rep.issues])
    prepared_lib = Library("frontend", normalised["version"], lib.sha256, normalised, "execution", lib.path)
    return _Prepared(prepared_lib, dict(values), templates, extras, digests,
                     stack_serial=stack_def.get("sections") == "serial")


def _replace_all(obj: Any, old: str, new: str) -> Any:
    if isinstance(obj, str):
        return obj.replace(old, new)
    if isinstance(obj, list):
        return [_replace_all(x, old, new) for x in obj]
    if isinstance(obj, dict):
        return {k: _replace_all(v, old, new) for k, v in obj.items()}
    return obj


def cap_effort(value: Any, tid: str, pointer: str) -> Any:
    """`high` for an effort ranked above it (xhigh, max), with W_EFFORT_CAPPED naming the template id and the
    effort's place in /frontend's library; any other value is returned unchanged (an unknown effort is left for
    task-template.schema.json to refuse, never guessed)."""
    if isinstance(value, str) and EFFORT_RANK.get(value, -1) > EFFORT_RANK[EFFORT_CAP]:
        warn(ErrorItem("W_EFFORT_CAPPED", f"/frontend template {tid}: effort {value!r} at {pointer} capped at "
                                          f"{EFFORT_CAP!r} (owner effort policy: subagents never above high)",
                       path=f"frontend.json#{pointer}"))
        return EFFORT_CAP
    return value


def _fe_fragment(frag: dict, tid: str, pointer: str) -> dict:
    path = Path(frag["file"])
    if not path.is_file():
        raise _dep_missing(f"/frontend's wave fragment {posix(path)} is absent", what="frontend.fragments")
    inp = copy.deepcopy(frag["input"])
    agents = inp.get("agents") or {}
    for role in sorted(agents):
        a = agents[role]
        if role in ("designer", "implementer", "runner") and not a.get("agentType"):
            a["agentType"] = IMPLEMENTER_AGENT
        if isinstance(a, dict) and "effort" in a:
            a["effort"] = cap_effort(a["effort"], tid, f"{pointer}/fragment/input/agents/{role}/effort")
    return {"file": posix(path), "function": frag["function"], "input": inp, "sha256": jsonio.sha256_file(path)}


def prepare(lib: Library, given: Mapping[str, Any], profile: dict) -> _Prepared:
    """A library ready to instantiate for these parameter values."""
    if lib.fmt == "frontend":
        return adapt_frontend(lib, _fe_values(given, profile))
    params = resolve_params(lib, given, profile)
    stack = ((profile or {}).get("frontend") or {}).get("stack")
    return _Prepared(lib, params, list(lib.raw["templates"]), {},
                     {t["id"]: jsonio.sha256_json(t) for t in lib.raw["templates"]},
                     stack_serial=lib.name == "frontend" and stack in ("static-html", "existing"))


def assign_ids(keys_in_topo_order: Sequence[str], start: int) -> dict[str, str]:
    """T-ids from `start` upward, in the given order."""
    return {k: f"T{start + i:03d}" for i, k in enumerate(keys_in_topo_order)}


def norm_key(key: str) -> str:
    return key.lower().replace("/", ".")


# --- the engine ----------------------------------------------------------------------------------------------------

class _Engine:
    def __init__(self, draft: Mapping, profile: dict, policy: dict | None, layout: Layout, now: datetime, *,
                 pre_t0: bool, existing: Mapping | None, lane_of: Callable[[Sequence[str], Sequence[Mapping]], str],
                 libraries: Mapping[str, Library] | None) -> None:
        self.draft = draft
        self.profile = profile or {}
        self.policy = policy
        self.layout = layout
        self.now = now
        self.pre_t0 = pre_t0
        self.existing = existing
        self.lane_of = lane_of
        self.libraries = dict(libraries or {})
        self.facts = facts(self.profile, draft if existing is None else {**existing, **draft})
        self.reqs: list[dict] = [copy.deepcopy(r) for r in (existing or draft).get("requirements") or ()]
        if existing is not None:
            self.reqs += [copy.deepcopy(r) for r in draft.get("add_requirements") or ()]
        self.groups = {g["id"]: g for g in (existing or draft).get("feature_groups") or ()}
        self.deadlines = list((existing or draft).get("deadlines") or ())
        self.nodes: dict[str, _Node] = {}
        self.nfr_by_key: dict[str, str] = {}
        self.requirements_added: list[str] = []
        self.builtins = builtins(layout, self.profile, pre_t0=pre_t0)
        self.serial: dict[str, bool] = {}
        self._order = 0
        for r in self.reqs:
            src = str(r.get("source", ""))
            if src.endswith(":standard") and r.get("id", "").startswith("NFR-"):
                self.nfr_by_key[(src, r["title"])] = r["id"]  # type: ignore[index]

    # -- helpers --
    def lib(self, name: str) -> Library:
        if name not in self.libraries:
            self.libraries[name] = load_library(name)  # type: ignore[arg-type]
        return self.libraries[name]

    def ui_reqs(self) -> list[dict]:
        return [r for r in self.reqs if r.get("surface") == "ui"]

    def latest(self, ref: str, offset: int) -> str:
        if ref == "cpm":
            dl = (self.profile.get("event") or {}).get("deadline_utc") or (self.profile.get("event") or {}).get(
                "start_utc")
            base = parse_utc(dl) if dl else self.now
            return format_utc(base)
        ev = self.profile.get("event") or {}
        if ref == "event.start":
            v = ev.get("start_utc")
        elif ref == "event.deadline":
            v = ev.get("deadline_utc")
        elif ref.startswith("DL-"):
            v = next((d["at_utc"] for d in self.deadlines if d["id"] == ref), None)
        else:
            raise CheckFailed(f"{{latest_start:{ref}:{offset}}}: a task-relative anchor cannot be resolved at "
                              "instantiation", code="E_TEMPLATE_PARAM")
        if v is None:
            raise CheckFailed(f"{{latest_start:{ref}:{offset}}}: {ref} has no instant", code="E_TEMPLATE_PARAM")
        return format_utc(parse_utc(v) + timedelta(minutes=offset))

    def nfr_id(self, lib_name: str, nfr: Mapping) -> str:
        src = f"{lib_name}:standard"
        key = (src, nfr["title"])
        if key in self.nfr_by_key:
            return self.nfr_by_key[key]
        used = [int(r["id"][4:]) for r in self.reqs if str(r.get("id", "")).startswith("NFR-")]
        nxt = max([n for n in used if n >= 900], default=899) + 1
        rid = f"NFR-{nxt:03d}"
        self.reqs.append({"id": rid, "title": nfr["title"], "text": nfr["text"], "priority": nfr["priority"],
                          "required": bool(nfr["required"]), "feature_group": None, "surface": "none",
                          "status_expected": None, "story": None, "source": src})
        self.requirements_added.append(rid)
        self.nfr_by_key[key] = rid
        return rid

    def add_node(self, node: _Node) -> None:
        if node.norm in {n.norm for n in self.nodes.values()} or node.key in self.nodes:
            raise CheckFailed(f"duplicate task key {node.key!r} (keys are compared lower-cased, '/' as '.')",
                              code="E_DRAFT_KEY")
        node.order = self._order
        self._order += 1
        self.nodes[node.key] = node

    # -- template expansion --
    def expand(self, prep: _Prepared, tpl: dict, lib_key: str, executor: str, extra_deps: Sequence[str],
               key_override: str | None = None) -> list[_Node]:
        tid = tpl["id"]
        lib_name = prep.lib.name
        ui = self.ui_reqs()
        if tpl.get("per") == "feature-group":
            instances = []
            for gid in sorted(self.groups, key=lambda g: int(g[1:])):
                g_ui = [r["id"] for r in ui if r.get("feature_group") == gid]
                if g_ui:
                    instances.append((gid, self.groups[gid].get("title", gid), g_ui))
        else:
            instances = [("all", "all", [r["id"] for r in ui])]
            if (tpl.get("covers") or {}).get("rule") in ("ui-requirements", "group-requirements") and not ui:
                instances = []
        out = []
        for gid, gtitle, g_ui in instances:
            per = tpl.get("per") == "feature-group"
            if key_override is not None:
                key = f"{key_override}/{tid}.{gid}" if per else key_override
            else:
                key = f"{lib_key}/{tid}.{gid}" if per else f"{lib_key}/{tid}"
            node = self.build_template_node(prep, tpl, key, gid if per else None, gtitle, g_ui, executor)
            node.lib_key = lib_key
            node.lib_name = lib_name
            node.dep_specs = list(tpl.get("depends_on") or ()) + [{"key": d} for d in extra_deps]
            out.append(node)
        return out

    def build_template_node(self, prep: _Prepared, tpl: dict, key: str, group: str | None, gtitle: str,
                            g_ui: list[str], executor: str) -> _Node:
        tid = tpl["id"]
        lib_name = prep.lib.name
        ex = prep.extras.get(tid, {})
        params = dict(prep.params)
        is_fe = lib_name == "frontend"
        state_abs = posix(self.layout.state / "frontend")
        if self.pre_t0 and is_fe:
            ws = (self.profile.get("workspace") or {}).get("private_dir")
            state_abs = f"{ws}/frontend" if ws else state_abs
        mapping: dict[str, str | None] = dict(self.builtins)
        for name in sorted(_declared(prep)):
            value = params.get(name)
            if value is None or isinstance(value, (dict, list)):
                mapping[name] = None
            else:
                mapping[name] = str(value).lower() if isinstance(value, bool) else str(value)
        if is_fe:
            mapping.update({"state": state_abs, "profile": self.builtins["profile_abs"],
                            "implementer_agent": IMPLEMENTER_AGENT})
            mapping.setdefault("design", "design")
        mapping.update({"group": group or "all", "group_title": gtitle, "features": ",".join(g_ui),
                        "features_all": ",".join(r["id"] for r in self.ui_reqs())})
        where = f"template {lib_name}:{tid}"
        sub = _Subst(mapping, where=where, keep=frozenset({"task_id"}), latest=self.latest)
        fields: dict[str, Any] = {}
        for fld in ("title", "description"):
            fields[fld] = sub.text(tpl[fld], fld)
        fields["writes"] = [sub.text(w, "writes") for w in tpl.get("writes") or ()]
        fields["resources"] = [sub.text(r, "resources") for r in tpl.get("resources") or ()]
        fields["brief_refs"] = [sub.text(b, "brief_refs") for b in tpl.get("brief_refs") or ()]
        fields["proof"] = sub.any(copy.deepcopy(tpl["proof"]), "proof")
        fields["manual"] = sub.any(copy.deepcopy(tpl["manual"]), "manual") if tpl.get("manual") else None
        fields["anchor"] = sub.any(copy.deepcopy(tpl.get("anchor")), "anchor") if tpl.get("anchor") else None
        covers = self.covers(tpl, lib_name, g_ui)
        req_by = {r["id"]: r for r in self.reqs}
        if tpl.get("required") == "from-requirements":
            required = any(req_by[c].get("required") for c in covers if c in req_by)
        else:
            required = bool(tpl.get("required"))
        if tpl.get("priority") == "from-requirements":
            pr = [req_by[c]["priority"] for c in covers if c in req_by]
            priority = min(pr, key=PRIORITY_ORDER.index) if pr else "P2"
        else:
            priority = tpl["priority"]
        mode = params.get("mode")
        est_src = tpl["estimate"].get(mode) if mode in ("full", "small") else None
        est_src = est_src or tpl["estimate"].get("default") or tpl["estimate"].get("full") or tpl["estimate"]["small"]
        estimate = {**{k: est_src[k] for k in ("p10_min", "p50_min", "p90_min")}, "source": f"template:{lib_name}"}
        imported = self.imported(tid) if is_fe else False
        if imported:
            estimate = {**IMPORTED_ESTIMATE, "source": f"template:{lib_name}"}
        pclass = tpl.get("prework_class", "none")
        release = None if fields["anchor"] else self.release_for(pclass)
        task_params = dict(params)
        if group is not None:
            task_params["group"] = group
        task_params["prework_class"] = pclass
        if tpl.get("decision_kind"):
            task_params["decision_kind"] = tpl["decision_kind"]
        for k in ("verify_estimate", "estimate_basis", "latest_start_rule"):
            if k in ex:
                task_params[k] = copy.deepcopy(ex[k])
        if (tpl.get("manual") or {}).get("latest_start_utc") == CPM_TOKEN:
            task_params["latest_start_rule"] = "cpm"
        if "external_writes" in ex:
            task_params["external_writes"] = [_Subst(mapping, where=where).text(w, "writes") for w in
                                              ex["external_writes"]]
        if "fragment" in ex:
            frag = copy.deepcopy(ex["fragment"])
            frag["input"] = _Subst(mapping, where=where, keep=frozenset({"task_id", "workdir"})).any(frag["input"],
                                                                                                   "fragment.input")
            task_params["fragment"] = frag
        if imported:
            task_params["imported"] = True
        if tpl.get("notes") and "checker" in str(tpl.get("notes")):
            task_params["checker"] = True
        plant = ex["plant"] if "plant" in ex else (EX_PLANTS.get(tid) if lib_name == "execution" else None)
        if plant:
            pm = dict(mapping)
            pm["plant_sections"] = (f"{mapping.get('ui_root')}/src/sections/{group}/**" if group
                                    else f"{mapping.get('ui_root')}/**")
            pm["first_feature"] = g_ui[0] if g_ui else ""
            ops = []
            for op in copy.deepcopy(plant):
                for f in _PLANT_SUBST_FIELDS:
                    if f in op:
                        op[f] = _Subst(pm, where=where).text(op[f], f"plant.{f}")
                if "pattern" in op and "{first_feature}" in op["pattern"]:
                    op["pattern"] = op["pattern"].replace("{first_feature}", re.escape(pm["first_feature"]))
                ops.append(op)
            task_params["plant"] = {"version": 1, "ops": ops}
        owner = tpl.get("owner") or ("devA" if tpl["kind"] in ("manual", "decision") else "agent")
        fields.update({
            "template": f"{lib_name}:{tid}", "template_digest": prep.digests[tid], "params": task_params,
            "feature_group": group, "covers": covers, "story": None, "priority": priority, "required": required,
            "phase": tpl["phase"], "kind": tpl["kind"], "owner": owner, "executor": executor,
            "release_utc": release, "deadline_utc": None, "estimate": estimate,
            "tokens_est": copy.deepcopy(tpl.get("tokens_est")) or self.default_tokens(tpl["kind"]),
            "model": tpl.get("model"), "effort": tpl.get("effort"), "proof_author": "template",
            "max_attempts": tpl.get("max_attempts", 2),
        })
        if tpl.get("verify"):
            fields["verify"] = copy.deepcopy(tpl["verify"])
        return _Node(key=key, norm=norm_key(key), origin="template", fields=fields, tpl_id=tid, group=group,
                     ui_reqs=tuple(g_ui))

    def default_tokens(self, kind: str) -> dict:
        if kind in ("manual", "decision"):
            return {"usd_list": 0, "basis": "owner task: no agent tokens"}
        usd = DEFAULT_USD.get(kind, 15.0)
        return {"usd_list": usd, "basis": "reference class median list cost (ARCHITECTURE.md 7.1)"}

    def covers(self, tpl: dict, lib_name: str, g_ui: list[str]) -> list[str]:
        rule = tpl["covers"]["rule"]
        if rule in ("ui-requirements", "group-requirements"):
            return list(g_ui)
        if rule == "all-required":
            return [r["id"] for r in self.reqs if r.get("required") and r.get("source", "").find(":standard") < 0]
        if rule == "explicit":
            return list(tpl["covers"].get("ids") or ())
        return [self.nfr_id(lib_name, tpl["covers"]["nfr"])]

    def release_for(self, pclass: str) -> str | None:
        pre = self.profile.get("prework") or {}
        until = pre.get("until_utc")
        if not until:
            return None
        designs = (self.profile.get("frontend") or {}).get("prework_designs", pre.get("designs"))
        if pclass == "design" and designs is False:
            return until
        if pclass in ("design", "code") and pre.get("code") is False:
            return until
        return None

    def imported(self, tid: str) -> bool:
        fe = self.layout.state / "frontend"
        if tid == "FE-00":
            return (fe / "brief.json").is_file()
        if tid == "FE-01":
            refs = (self.profile.get("frontend") or {}).get("references") or ()
            return sum(1 for r in refs if isinstance(r, dict) and r.get("owner_confirmed") is True) >= 2
        if tid == "FE-02":
            return (fe / "refs-index.json").is_file() and (fe / "pattern-ledger.json").is_file()
        return False

    # -- draft tasks --
    def draft_node(self, t: dict, *, template_ref: str | None = None) -> _Node:
        fields = copy.deepcopy(t)
        deps = list(fields.pop("depends_on", []) or [])
        tref = fields.pop("template", None) or template_ref
        params = fields.pop("params", None)
        fields.pop("key", None)
        fields.setdefault("feature_group", None)
        fields.setdefault("story", None)
        fields.setdefault("release_utc", None)
        fields.setdefault("deadline_utc", None)
        fields.setdefault("anchor", None)
        fields.setdefault("brief_refs", [])
        fields.setdefault("manual", None)
        fields.setdefault("max_attempts", 2)
        fields.setdefault("tokens_est", self.default_tokens(fields["kind"]))
        fields["params"] = params or {}
        fields["template"] = tref
        if tref:
            lib_name, _, tid = tref.partition(":")
            prep = prepare(self.lib(lib_name), {}, self.profile) if lib_name == "execution" else None
            if prep is not None and tid in prep.digests:
                fields["template_digest"] = prep.digests[tid]
            elif lib_name == "execution":
                raise CheckFailed(f"draft task {t['key']} names unknown template {tref}", code="E_TEMPLATE_DEP")
        node = _Node(key=t["key"], norm=norm_key(t["key"]), origin="draft", fields=fields,
                     tpl_id=tref.partition(":")[2] if tref else None)
        node.dep_specs = [{"key": d} for d in deps]
        return node

    # -- dependency resolution --
    def find_template(self, tref: str, node: _Node) -> list[_Node]:
        """The instance(s) of a template this node depends on: a bare id names the node's own library (the same
        library instantiation first, else any instantiation of that library: a per-item instance depends on the
        whole-library one); `library:id` names any instantiation of that library. Per-group to per-group keeps the
        group."""
        lib_name, _, tid = tref.partition(":") if ":" in tref else (node.lib_name, "", tref)
        cands = [n for n in self.nodes.values() if n.tpl_id == tid and n.origin == "template" and n.lib_name == lib_name]
        if ":" not in tref:
            same_inst = [n for n in cands if n.lib_key == node.lib_key]
            if same_inst:
                cands = same_inst
        if node.group is not None:
            same = [n for n in cands if n.group == node.group]
            if same:
                return same
        return cands

    def existing_with(self, tref: str) -> list[str]:
        if self.existing is None:
            return []
        sup = set()
        for am in self.existing.get("amendments") or ():
            sup.update(am.get("superseded") or ())
        sup.update(self.draft.get("supersede") or ())
        return [t["id"] for t in self.existing.get("tasks") or () if t.get("template") == tref and t["id"] not in sup]

    def newest(self, tref: str) -> list[str]:
        """The newest non-superseded instance: a new node of this template wins over existing tasks."""
        tid = tref.partition(":")[2]
        new = sorted((n for n in self.nodes.values() if n.tpl_id == tid and n.origin != "existing"),
                     key=lambda n: n.order)
        if new:
            return [new[-1].key]
        ex = self.existing_with(tref)
        return [max(ex, key=lambda i: int(i[1:]))] if ex else []

    def resolve_ref(self, ref: str, node: _Node, required: bool) -> list[str]:
        if ref == "@project-name":
            if not self.facts["name-not-confirmed"]:
                return []
            found = self.newest("execution:EX-NAME")
            if not found:
                prep = prepare(self.lib("execution"), {}, self.profile)
                tpl = next(t for t in prep.templates if t["id"] == "EX-NAME")
                (n,) = self.expand(prep, tpl, "execution", "A", ())
                self.add_node(n)
                self.resolve(n)
                found = [n.key]
            return found
        if ref == "@feature-tasks":
            reqs = set(node.ui_reqs)
            planned = {r["id"] for r in self.ui_reqs() if r.get("status_expected") == "planned"}
            if reqs and reqs <= planned:
                return []
            hits = [n.key for n in self.nodes.values() if n.origin != "existing" and n is not node and (
                n.origin == "draft" or (n.lib_name == "execution" and n.fields.get("phase") == "build"))
                and reqs & set(n.fields.get("covers") or ())]
            hits += [t["id"] for t in (self.existing or {}).get("tasks") or ()
                     if not t.get("template") and reqs & set(t.get("covers") or ())]
            if not hits:
                raise CheckFailed(f"{node.key}: no build task covers the requirements of group {node.group or 'all'} "
                                  f"({', '.join(sorted(reqs))}): the planner must give each ui feature a build task",
                                  code="E_TEMPLATE_DEP")
            return sorted(hits)
        if ref.startswith("@all-instances:"):
            tid = ref.split(":", 1)[1]
            return sorted(n.key for n in self.nodes.values() if n.tpl_id == tid and n.lib_key == node.lib_key
                          and n.origin == "template")
        named = {"@spec-approved": "execution:EX-APPROVE", "@build-complete": "execution:EX-GATE-BUILD",
                 "@harden-review": "execution:EX-HARDEN-REVIEW", "@fix-gate": "execution:EX-FIX-GATE"}
        if ref in named:
            found = self.newest(named[ref])
        elif ref == "@contract-wave":
            found = sorted(n.key for n in self.nodes.values() if n.fields.get("phase") == "contract" and n is not node)
            found += [t["id"] for t in (self.existing or {}).get("tasks") or () if t.get("phase") == "contract"]
        elif ref == "@deliverables-before-screenshots":
            found = sorted(n.key for n in self.nodes.values() if n is not node and n.origin != "existing"
                           and n.fields.get("phase") == "deliverable" and n.tpl_id not in SCREENSHOT_EXCLUDED)
        else:
            raise CheckFailed(f"{node.key}: unknown dependency symbol {ref}", code="E_TEMPLATE_DEP")
        if not found and required and not self.pre_t0:
            raise CheckFailed(f"{node.key}: {ref} resolves to no task of the plan (instantiate the execution "
                              "library, or drop the dependency)", code="E_TEMPLATE_DEP")
        return found

    def resolve_key(self, ref: str, node: _Node) -> list[str]:
        if ref.startswith("@"):
            return self.resolve_ref(ref, node, True)
        if re.fullmatch(r"T\d{3,}", ref):
            if self.existing is None or ref not in {t["id"] for t in self.existing.get("tasks") or ()}:
                raise CheckFailed(f"{node.key} depends on unknown task {ref}", code="E_DRAFT_KEY")
            return [ref]
        if ref in self.nodes:
            return [ref]
        by_norm = {n.norm: n.key for n in self.nodes.values()}
        if norm_key(ref) in by_norm:
            return [by_norm[norm_key(ref)]]
        multi = sorted(k for k in self.nodes if k.startswith(ref + "/"))
        if multi:
            return multi
        for t in (self.existing or {}).get("tasks") or ():
            if t.get("key") == norm_key(ref):
                return [t["id"]]
        raise CheckFailed(f"{node.key} depends on unknown key {ref!r}", code="E_DRAFT_KEY")

    def resolve(self, node: _Node) -> None:
        deps: list[str] = []
        for spec in node.dep_specs:
            if "key" in spec:
                deps += self.resolve_key(spec["key"], node)
                continue
            if spec.get("when") is not None:
                params = node.fields.get("params") or {}
                if not condition_holds(spec["when"], params, self.facts):
                    continue
            req = spec.get("required", True)
            if "ref" in spec:
                deps += self.resolve_ref(spec["ref"], node, req is not False)
                continue
            tref = spec["template"]
            found = self.find_template(tref, node)
            if not found:
                found_ids = self.existing_with(tref if ":" in tref else f"{node.lib_name}:{tref}")
                if found_ids:
                    deps.append(max(found_ids, key=lambda i: int(i[1:])))
                    continue
                if spec.get("required"):
                    raise CheckFailed(f"{node.key} requires template {tref}, which is not included",
                                      code="E_TEMPLATE_DEP")
                continue
            deps += [n.key for n in found]
        seen: list[str] = []
        for d in deps:
            if d != node.key and d not in seen:
                seen.append(d)
        node.deps = seen

    # -- fixed rules --
    def ancestors(self, key: str) -> set[str]:
        out: set[str] = set()
        stack = [key]
        while stack:
            k = stack.pop()
            n = self.nodes.get(k)
            if n is None:
                continue
            for d in n.deps:
                if d not in out:
                    out.add(d)
                    stack.append(d)
        return out

    def add_dep(self, node: _Node, dep: str) -> None:
        if dep != node.key and dep not in node.deps and node.key not in self.ancestors(dep):
            node.deps.append(dep)

    def apply_rules(self) -> None:
        new = [n for n in self.nodes.values() if n.origin != "existing"]
        by_tpl: dict[str, list[_Node]] = {}
        for n in new:
            if n.tpl_id:
                by_tpl.setdefault(n.tpl_id, []).append(n)
        sinks = [n for tid in SINK_RULE_IDS for n in by_tpl.get(tid, []) if n.origin == "template"]
        sink_keys = {n.key for n in sinks}
        if sinks:
            scope = [n for n in new if n.key not in sink_keys and n.fields.get("required")
                     and n.fields.get("phase") in ("setup", "contract", "build", "integrate", "verify")]
            for s in sinks:
                for n in sorted(scope, key=lambda x: x.order):
                    if s.key not in self.ancestors(n.key):
                        self.add_dep(s, n.key)
        builders = [n for n in new if n.origin == "draft" and n.fields.get("required")
                    and n.fields.get("phase") in ("build", "integrate")]
        for tid in FEATURE_FOLLOWERS:
            for f in by_tpl.get(tid, []):
                for b in builders:
                    if f.key not in self.ancestors(b.key):
                        self.add_dep(f, b.key)
        for fe20 in by_tpl.get("FE-20", []):
            for cv in by_tpl.get("EX-HB-CLAIMS-VERIFY", []):
                self.add_dep(fe20, cv.key)
        fe21 = by_tpl.get("FE-21", [])
        for tid in ("EX-DLV-RECORD", "EX-DLV-FLIP", "EX-DLV-TAG"):
            for rec in by_tpl.get(tid, []):
                for f in fe21:
                    self.add_dep(rec, f.key)
        for chk in by_tpl.get("EX-DEVB-CHECK", []):
            for n in new:
                if n.fields.get("executor") == "B" and n is not chk:
                    self.add_dep(n, chk.key)
        holders = [n for n in new if "manifest" in (n.fields.get("resources") or ())
                   and n.fields.get("phase") in ("setup", "contract")]
        for n in new:
            if n.origin == "template" and "manifest" in (n.fields.get("resources") or ()) \
                    and n.fields.get("phase") not in ("setup", "contract"):
                for h in holders:
                    self.add_dep(n, h.key)
        fe_serial = [n for n in by_tpl.get("FE-1x", []) if self.serial.get(n.lib_key or "")
                     and n.origin == "template"]
        fe_serial.sort(key=lambda n: (int(n.group[1:]) if n.group and n.group[1:].isdigit() else 0))
        for i, n in enumerate(fe_serial):
            if i == 0:
                for f9 in by_tpl.get("FE-09", []):
                    if f9.lib_key == n.lib_key:
                        self.add_dep(n, f9.key)
            else:
                self.add_dep(n, fe_serial[i - 1].key)

    # -- ids --
    def topo(self, keys: Sequence[str]) -> list[str]:
        keyset = set(keys)
        indeg = {k: sum(1 for d in self.nodes[k].deps if d in keyset) for k in keys}
        succ: dict[str, list[str]] = {k: [] for k in keys}
        for k in keys:
            for d in self.nodes[k].deps:
                if d in keyset:
                    succ[d].append(k)

        def rank(k: str) -> tuple:
            f = self.nodes[k].fields
            return (PHASE_ORDER.index(f["phase"]), PRIORITY_ORDER.index(f["priority"]), self.nodes[k].norm)
        ready = sorted((k for k in keys if indeg[k] == 0), key=rank)
        out: list[str] = []
        while ready:
            k = ready.pop(0)
            out.append(k)
            for s in succ[k]:
                indeg[s] -= 1
                if indeg[s] == 0:
                    ready.append(s)
            ready.sort(key=rank)
        if len(out) != len(keys):
            stuck = sorted(k for k in keys if k not in out)
            raise CheckFailed(f"dependency cycle among {', '.join(stuck[:6])}", code="E_TEMPLATE_DEP")
        return out

    def build(self, start: int) -> tuple[list[dict], dict[str, str]]:
        keys = [k for k, n in self.nodes.items() if n.origin != "existing"]
        order = self.topo(keys)
        ids = assign_ids(order, start)
        lanes = list((self.existing or self.draft).get("lanes") or ())
        tasks: list[dict] = []
        for k in order:
            n = self.nodes[k]
            f = copy.deepcopy(n.fields)
            tid = ids[k]
            f["id"] = tid
            f["key"] = n.norm
            f["depends_on"] = sorted({ids.get(d, d) for d in n.deps}, key=lambda i: int(i[1:]))
            sub = _Subst({"task_id": tid}, where=f"task {n.key}")
            for fld in ("title", "description", "proof", "manual", "brief_refs"):
                if f.get(fld) is not None and n.origin == "template":
                    f[fld] = sub.any(f[fld], fld)
            if isinstance(f.get("params", {}).get("fragment"), dict):
                frag = f["params"]["fragment"]
                frag["input"] = _Subst({"task_id": tid}, where=f"task {n.key}",
                                       keep=frozenset({"workdir"})).any(frag["input"], "fragment.input")
            plant = f.get("params", {}).pop("plant", None)
            if plant is not None:
                nc = f["proof"].get("negative_control") or {}
                if nc.get("kind") in ("planted-defect", "forgery"):
                    nc["patch_path"] = f"negative-controls/{n.norm}.plant.json"
                    f["params"]["plant"] = plant
            if f["kind"] in ("code", "test", "infra"):
                f["lane"] = self.lane_of(f["writes"], lanes)
            else:
                f.pop("lane", None)
            tasks.append(f)
        return tasks, {self.nodes[k].key: ids[k] for k in order}


def _validate_task(task: dict, where: str) -> None:
    rep = schema.validate(task, "plan#/$defs/task")
    if not rep.ok:
        items = [ErrorItem("E_SCHEMA", f"{where}: {i.message}", task=task.get("id")) for i in rep.issues[:20]]
        raise ValidationFailed(f"{where} does not instantiate into a valid task: {rep.issues[0].message}",
                               code="E_SCHEMA", items=items)


def _collect(eng: _Engine, draft: Mapping) -> None:
    """Draft tasks, whole-library instantiations and single instances, in draft order."""
    for t in draft.get("tasks") or ():
        eng.add_node(eng.draft_node(t))
    for spec in draft.get("libraries") or ():
        name = spec["library"]
        if eng.pre_t0 and name != "frontend":
            continue
        given = dict(spec.get("params") or {})
        executor = spec.get("executor") or given.pop("executor", None) or "A"
        lib = eng.lib(name)
        if lib.fmt == "frontend":
            given.setdefault("executor", executor)
        prep = prepare(lib, given, eng.profile)
        eng.serial[spec["key"]] = prep.stack_serial
        for tpl in prep.templates:
            if eng.pre_t0 and tpl.get("prework_class") != "research":
                continue
            if not condition_holds(tpl.get("include", True), prep.params, eng.facts):
                continue
            for node in eng.expand(prep, tpl, spec["key"], executor, ()):
                eng.add_node(node)
    for inst in draft.get("instances") or ():
        lib_name, _, tid = inst["template"].partition(":")
        if eng.pre_t0 and lib_name != "frontend":
            continue
        given = dict(inst.get("params") or {})
        executor = inst.get("executor") or "A"
        prep = prepare(eng.lib(lib_name), given, eng.profile)
        tpl = next((t for t in prep.templates if t["id"] == tid), None)
        if tpl is None:
            raise CheckFailed(f"instance {inst['key']} names unknown template {inst['template']}",
                              code="E_TEMPLATE_DEP")
        eng.serial[inst["key"]] = prep.stack_serial
        for node in eng.expand(prep, tpl, inst["key"], executor, list(inst.get("depends_on_extra") or ()),
                               key_override=inst["key"]):
            eng.add_node(node)


def instantiate(draft: dict, profile: dict, policy: dict, layout: Layout, now: datetime, *,
                lane_of: Callable[[Sequence[str], Sequence[Mapping]], str] | None = None, pre_t0: bool = False,
                spec_decision: str | None = None, libraries: Mapping[str, Library] | None = None
                ) -> tuple[dict, dict[str, str]]:
    """SCHEMAS.md 6.2 steps 1-9: the plan document (not yet validated against the invariants) and key -> id."""
    if lane_of is None:
        raise InternalError("templates.instantiate needs the lane resolver (validate.lane_for)")
    rep = schema.validate(draft, "plan-draft")
    if not rep.ok:
        raise ValidationFailed(f"the planner draft fails plan-draft.schema.json: {rep.issues[0].message}",
                               code="E_SCHEMA", items=[ErrorItem("E_SCHEMA", i.message, path=i.instance_path or "/")
                                                       for i in rep.issues[:50]])
    eng = _Engine(draft, profile, policy, layout, now, pre_t0=pre_t0, existing=None, lane_of=lane_of,
                  libraries=libraries)
    _collect(eng, draft)
    for node in list(eng.nodes.values()):
        eng.resolve(node)
    eng.apply_rules()
    tasks, ids = eng.build(1)
    stamp = format_utc(now)
    raw = {
        "schema": "execution.plan/1", "project": draft["project"], "plan_version": 1, "created_utc": stamp,
        "updated_utc": stamp, "approved": None,
        "spec": {"path": draft["spec"]["path"], "sha256": draft["spec"]["sha256"],
                 "validated_decision": spec_decision or "D-000"},
        "deadlines": copy.deepcopy(list(draft.get("deadlines") or ())),
        "requirements": eng.reqs, "feature_groups": copy.deepcopy(list(draft.get("feature_groups") or ())),
        "lanes": copy.deepcopy(list(draft.get("lanes") or ())), "protected": list(draft.get("protected") or ()),
        "tasks": tasks, "amendments": [],
    }
    for t in tasks:
        _validate_task(t, f"task {t['key']} ({t.get('template') or 'draft'})")
    return raw, ids


def instantiate_more(plan_raw: dict, additions: dict, profile: dict, layout: Layout, now: datetime, *,
                     lane_of: Callable[[Sequence[str], Sequence[Mapping]], str] | None = None,
                     libraries: Mapping[str, Library] | None = None) -> tuple[dict, dict[str, str]]:
    """For amend: new tasks (draft tasks, template-referencing draft tasks, or instances) with ids above the plan's
    maximum; dependencies may name existing T-ids, existing keys or new keys. Returns (plan raw with the new tasks
    and requirements appended, key -> id)."""
    if lane_of is None:
        raise InternalError("templates.instantiate_more needs the lane resolver (validate.lane_for)")
    eng = _Engine(additions, profile, None, layout, now, pre_t0=False, existing=plan_raw, lane_of=lane_of,
                  libraries=libraries)
    existing_ids = {t["id"] for t in plan_raw.get("tasks") or ()}
    for t in additions.get("add_tasks") or ():
        if "template" in t and "kind" not in t:
            lib_name, _, tid = t["template"].partition(":")
            prep = prepare(eng.lib(lib_name), dict(t.get("params") or {}), eng.profile)
            tpl = next((x for x in prep.templates if x["id"] == tid), None)
            if tpl is None:
                raise CheckFailed(f"{t.get('key')}: unknown template {t['template']}", code="E_TEMPLATE_DEP")
            for node in eng.expand(prep, tpl, t["key"], t.get("executor") or "A",
                                   list(t.get("depends_on_extra") or ()), key_override=t["key"]):
                eng.add_node(node)
        else:
            eng.add_node(eng.draft_node(t))
    for node in list(eng.nodes.values()):
        eng.resolve(node)
    start = plan.max_id_num(plan_raw) + 1
    tasks, ids = eng.build(start)
    out = copy.deepcopy(plan_raw)
    out["requirements"] = eng.reqs
    out["tasks"] = list(out.get("tasks") or []) + tasks
    for t in tasks:
        if t["id"] in existing_ids:
            raise InternalError(f"new task id {t['id']} collides with an existing one")
        _validate_task(t, f"task {t['key']} ({t.get('template') or 'patch'})")
    return out, ids


# --- after instantiation -------------------------------------------------------------------------------------------

def plant_files(plan_raw: Mapping) -> dict[str, dict]:
    """State-relative path -> plant document, for every task whose negative control carries a plant."""
    out: dict[str, dict] = {}
    for t in plan_raw.get("tasks") or ():
        plant = (t.get("params") or {}).get("plant")
        nc = (t.get("proof") or {}).get("negative_control") or {}
        if plant and nc.get("patch_path"):
            out[nc["patch_path"]] = plant
    return dict(sorted(out.items()))


def _free_windows(profile: Mapping, dev: str) -> list[tuple[datetime, datetime]]:
    d = next((x for x in ((profile.get("team") or {}).get("devs") or ()) if x.get("id") == dev), None) or {}
    awake = [(parse_utc(w["start_utc"]), parse_utc(w["end_utc"])) for w in d.get("availability") or ()
             if w["kind"] == "awake"]
    busy = [(parse_utc(w["start_utc"]), parse_utc(w["end_utc"])) for w in d.get("availability") or ()
            if w["kind"] != "awake"]
    free: list[tuple[datetime, datetime]] = []
    for a, b in sorted(awake):
        pieces = [(a, b)]
        for c, e in sorted(busy):
            nxt = []
            for x, y in pieces:
                if e <= x or c >= y:
                    nxt.append((x, y))
                    continue
                if x < c:
                    nxt.append((x, c))
                if e < y:
                    nxt.append((e, y))
            pieces = nxt
        free += pieces
    return sorted(free)


def compute_latest_starts(plan_raw: dict, profile: dict) -> dict:
    """FRONTEND.md 2.7: owner tasks marked `latest_start_rule: cpm` get the CPM latest start on P50 durations against
    DL-build-complete (ancestors of the build gate) or the submission deadline, moved earlier into the owner's
    previous free window when outside one; decision tasks get decision_deadline_utc = latest start + owner P90."""
    tasks = plan_raw.get("tasks") or []
    if not any((t.get("params") or {}).get("latest_start_rule") == "cpm" for t in tasks):
        return plan_raw
    dls = {d["id"]: parse_utc(d["at_utc"]) for d in plan_raw.get("deadlines") or ()}
    subs = [parse_utc(d["at_utc"]) for d in plan_raw.get("deadlines") or () if d["kind"] == "submission"]
    ev = ((profile or {}).get("event") or {}).get("deadline_utc")
    final = min(subs) if subs else (parse_utc(ev) if ev else None)
    bc = dls.get("DL-build-complete")
    model = PlanModel.from_raw(plan_raw)
    g = graph.Graph.of(model)
    gate = next((t.id for t in model.tasks if t.template == "execution:EX-GATE-BUILD"), None)
    before_gate = g.ancestors(gate) | {gate} if gate else frozenset()
    ls: dict[str, datetime] = {}
    for tid in reversed(g.topo()):
        t = model.by_id[tid]
        bound = bc if (bc is not None and tid in before_gate) else final
        succ = [ls[s] for s in g.successors(tid) if s in ls]
        lf = min([x for x in succ + ([bound] if bound else [])], default=None)
        if lf is None:
            continue
        ls[tid] = lf - timedelta(minutes=t.estimate.p50)
    out = copy.deepcopy(plan_raw)
    for t in out["tasks"]:
        if (t.get("params") or {}).get("latest_start_rule") != "cpm" or not t.get("manual") or t["id"] not in ls:
            continue
        at = ls[t["id"]].replace(second=0, microsecond=0)
        free = _free_windows(profile or {}, t["owner"])
        if free and not any(a <= at < b for a, b in free):
            prev = [w for w in free if w[0] <= at]
            if prev:
                at = prev[-1][1] - timedelta(minutes=1)
        t["manual"]["latest_start_utc"] = format_utc(at)
        if t["kind"] == "decision":
            t["manual"]["decision_deadline_utc"] = format_utc(at + timedelta(minutes=t["estimate"]["p90_min"]))
    return out


def template_index(lib: Library) -> dict[str, dict]:
    return {t["id"]: t for t in lib.raw.get("templates") or ()}


def check_library_digest(task_raw: Mapping, lib: Library) -> bool:
    """True when the task's template_digest still matches the library's template object (our format)."""
    tid = (task_raw.get("template") or "").partition(":")[2]
    tpl = template_index(lib).get(tid)
    return tpl is not None and jsonio.sha256_json(tpl) == task_raw.get("template_digest")
