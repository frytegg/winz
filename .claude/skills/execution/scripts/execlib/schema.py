"""The internal JSON Schema subset validator (contract/MODULES.md 3, Draft 2020-12 subset).

Supported keywords and their exact semantics are those of MODULES.md 3. Any other keyword in one of our schemas is
E_SCHEMA_KEYWORD at registry load (a bug in the skill, exit 3); in another skill's schema it is reported as
W_SCHEMA_UNSUPPORTED_KEYWORD and skipped. `x-external` blocks are collected, never validated inline: `run_externals`
validates them against the other skill's schema file when it exists and reports a missing file as missing (the
caller decides; never a silent pass).
"""
from __future__ import annotations

import copy
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .errors import ErrorItem, InternalError, ValidationFailed, warn
from .log import get_logger
from .paths import SKILL_DIR, other_skill

ANNOTATIONS: frozenset[str] = frozenset({"$schema", "$id", "$comment", "title", "description", "default", "examples"})
SUPPORTED: frozenset[str] = frozenset({
    "$defs", "$ref", "type", "enum", "const", "properties", "required", "additionalProperties", "patternProperties",
    "propertyNames", "minProperties", "maxProperties", "items", "minItems", "maxItems", "uniqueItems", "minLength",
    "maxLength", "pattern", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "allOf", "anyOf", "oneOf",
    "not", "if", "then", "else", "x-external",
})
MAX_REF_DEPTH = 64
_SCHEMA_KEYS = ("additionalProperties", "propertyNames", "items", "not", "if", "then", "else")
_MAP_KEYS = ("$defs", "properties", "patternProperties")
_LIST_KEYS = ("allOf", "anyOf", "oneOf")
_LOG = get_logger("execlib.schema")


@dataclass(frozen=True)
class SchemaIssue:
    instance_path: str
    schema_path: str
    keyword: str
    message: str


@dataclass(frozen=True)
class ExternalCheck:
    instance_path: str
    skill: str
    rel_path: str
    on_missing: str
    relation: str | None


@dataclass(frozen=True)
class Report:
    issues: tuple[SchemaIssue, ...]
    externals: tuple[ExternalCheck, ...]
    warnings: tuple[ErrorItem, ...] = field(default=())

    @property
    def ok(self) -> bool:
        return not self.issues


# --- JSON helpers --------------------------------------------------------------------------------------------------

def json_equal(a: Any, b: Any) -> bool:
    """JSON equality: True != 1, 1 == 1.0, objects by keys and values, arrays by order."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    if isinstance(a, str) or isinstance(b, str):
        return isinstance(a, str) and isinstance(b, str) and a == b
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(json_equal(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(json_equal(a[k], b[k]) for k in a)
    return False


def _esc(token: str) -> str:
    return token.replace("~", "~0").replace("/", "~1")


def _unesc(token: str) -> str:
    return token.replace("~1", "/").replace("~0", "~")


def pointer_join(base: str, token: str | int) -> str:
    return f"{base}/{_esc(str(token))}"


def resolve_pointer(doc: Any, pointer: str) -> Any:
    """Follow a JSON pointer ('' or '/a/0/b'); KeyError when it does not resolve."""
    if pointer in ("", "#"):
        return doc
    if pointer.startswith("#"):
        pointer = pointer[1:]
    if not pointer.startswith("/"):
        raise KeyError(pointer)
    cur = doc
    for raw in pointer[1:].split("/"):
        tok = _unesc(raw)
        if isinstance(cur, dict):
            if tok not in cur:
                raise KeyError(pointer)
            cur = cur[tok]
        elif isinstance(cur, list):
            if not tok.isdigit() or int(tok) >= len(cur):
                raise KeyError(pointer)
            cur = cur[int(tok)]
        else:
            raise KeyError(pointer)
    return cur


def _type_name(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "object"
    return type(v).__name__


def _is_type(v: Any, t: str) -> bool:
    if t == "null":
        return v is None
    if t == "boolean":
        return isinstance(v, bool)
    if t == "object":
        return isinstance(v, dict)
    if t == "array":
        return isinstance(v, list)
    if t == "string":
        return isinstance(v, str)
    if t == "integer":
        if isinstance(v, bool):
            return False
        if isinstance(v, int):
            return True
        return isinstance(v, float) and math.isfinite(v) and v.is_integer()
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    return False


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _show(v: Any) -> str:
    text = json.dumps(v, ensure_ascii=False, default=str)
    return text if len(text) <= 60 else text[:57] + "..."


# --- registry ------------------------------------------------------------------------------------------------------

def _file_name(name: str) -> str:
    return name if name.endswith(".schema.json") else f"{name}.schema.json"


class Registry:
    """Schema documents of one directory, keyed by file name; keywords checked at load."""

    def __init__(self, schema_dir: Path = SKILL_DIR / "assets/schemas", *, foreign: bool = False) -> None:
        self.schema_dir = Path(schema_dir)
        self.foreign = foreign
        self._docs: dict[str, dict] = {}
        self._patterns: dict[str, re.Pattern[str]] = {}
        self.warnings: list[ErrorItem] = []

    def get(self, name: str) -> dict:
        """'plan' or 'plan.schema.json'; loads the file and checks its keywords."""
        fname = _file_name(name)
        if fname in self._docs:
            return self._docs[fname]
        path = self.schema_dir / fname
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError as err:
            raise InternalError(f"schema {fname} not found in {path.parent.as_posix()}") from err
        except json.JSONDecodeError as err:
            raise InternalError(f"schema {fname} is not valid JSON: {err}") from err
        self._check_keywords(doc, fname, "")
        self._docs[fname] = doc
        return doc

    def add(self, fname: str, doc: dict) -> None:
        """Register an in-memory schema document under a file name (keywords checked)."""
        self._check_keywords(doc, fname, "")
        self._docs[_file_name(fname)] = doc

    def _check_keywords(self, schema: Any, fname: str, ptr: str) -> None:
        if isinstance(schema, bool):
            return
        if not isinstance(schema, dict):
            raise InternalError(f"{fname}#{ptr or '/'}: a schema must be an object or a boolean")
        for key, value in schema.items():
            if key in ANNOTATIONS or (key.startswith("x-") and key != "x-external"):
                continue
            if key not in SUPPORTED:
                if self.foreign:
                    item = ErrorItem("W_SCHEMA_UNSUPPORTED_KEYWORD",
                                     f"{fname}#{ptr or '/'} uses unsupported keyword {key!r}: skipped",
                                     path=f"{fname}#{pointer_join(ptr, key)}")
                    self.warnings.append(item)
                    warn(item)
                    continue
                raise InternalError(f"{fname}#{ptr or '/'} uses unsupported keyword {key!r}",
                                    code="E_SCHEMA_KEYWORD",
                                    hint="the skill's schemas use only the subset of contract/MODULES.md 3")
            sub = pointer_join(ptr, key)
            if key in _MAP_KEYS:
                if not isinstance(value, dict):
                    raise InternalError(f"{fname}#{sub}: {key} must be an object", code="E_SCHEMA_KEYWORD")
                for k, v in value.items():
                    if key == "patternProperties":
                        self.compiled(k)
                    self._check_keywords(v, fname, pointer_join(sub, k))
            elif key in _LIST_KEYS:
                if not isinstance(value, list):
                    raise InternalError(f"{fname}#{sub}: {key} must be an array", code="E_SCHEMA_KEYWORD")
                for i, v in enumerate(value):
                    self._check_keywords(v, fname, pointer_join(sub, i))
            elif key in _SCHEMA_KEYS:
                if key == "items" and isinstance(value, list):
                    raise InternalError(f"{fname}#{sub}: array-form items is not supported", code="E_SCHEMA_KEYWORD")
                self._check_keywords(value, fname, sub)
            elif key == "pattern":
                self.compiled(value)

    def compiled(self, pattern: str) -> re.Pattern[str]:
        rx = self._patterns.get(pattern)
        if rx is None:
            try:
                rx = re.compile(pattern)
            except re.error as err:
                raise InternalError(f"invalid schema pattern {pattern!r}: {err}", code="E_SCHEMA_KEYWORD") from err
            self._patterns[pattern] = rx
        return rx

    def resolve(self, ref: str, base_name: str) -> tuple[dict, str]:
        """Resolve '#/...' (in base_name) or '<file>.schema.json#/...'; returns (schema, file name)."""
        if ref.startswith("#"):
            fname, pointer = base_name, ref[1:]
        else:
            fname, _sep, pointer = ref.partition("#")
            fname = Path(fname).name
        doc = self.get(fname)
        try:
            target = resolve_pointer(doc, pointer)
        except KeyError as err:
            raise InternalError(f"unresolvable $ref {ref!r} from {base_name}") from err
        if not isinstance(target, (dict, bool)):
            raise InternalError(f"$ref {ref!r} does not point at a schema")
        return target, fname  # type: ignore[return-value]


_DEFAULT: Registry | None = None


def default_registry() -> Registry:
    """The registry of the skill's own schemas (cached per process)."""
    global _DEFAULT
    if _DEFAULT is None:
        _DEFAULT = Registry()
    return _DEFAULT


# --- validation ----------------------------------------------------------------------------------------------------

class _Validator:
    def __init__(self, registry: Registry) -> None:
        self.reg = registry

    def run(self, inst: Any, schema: Any, ip: str, sp: str, base: str, depth: int
            ) -> tuple[list[SchemaIssue], list[ExternalCheck]]:
        if schema is True or schema == {}:
            return [], []
        if schema is False:
            return [SchemaIssue(ip, sp, "false", f"{ip or '/'}: no value is allowed here")], []
        issues: list[SchemaIssue] = []
        exts: list[ExternalCheck] = []
        s: dict = schema
        reg = self.reg

        def add(keyword: str, message: str, at: str | None = None) -> None:
            path = ip if at is None else at
            issues.append(SchemaIssue(path, pointer_join(sp, keyword), keyword, f"{path or '/'}: {message}"))

        def sub(value: Any, sch: Any, ipath: str, spath: str, b: str = base, d: int = depth) -> None:
            i2, e2 = self.run(value, sch, ipath, spath, b, d)
            issues.extend(i2)
            exts.extend(e2)

        if "$ref" in s:
            if depth + 1 > MAX_REF_DEPTH:
                raise ValidationFailed(f"$ref depth above {MAX_REF_DEPTH} at {sp} (a reference cycle?)",
                                       code="E_SCHEMA_DEPTH")
            target, fname = reg.resolve(s["$ref"], base)
            ref = s["$ref"]
            tsp = f"{fname}#{ref.partition('#')[2]}"
            sub(inst, target, ip, tsp, fname, depth + 1)
        if "x-external" in s:
            x = s["x-external"]
            if isinstance(x, dict):
                exts.append(ExternalCheck(ip, str(x.get("skill", "")), str(x.get("path", "")),
                                          str(x.get("on_missing", "decision")), x.get("relation")))
        if "type" in s:
            types = s["type"] if isinstance(s["type"], list) else [s["type"]]
            if not any(_is_type(inst, t) for t in types):
                add("type", f"expected {' or '.join(types)}, got {_type_name(inst)}")
        if "enum" in s:
            if not any(json_equal(inst, e) for e in s["enum"]):
                add("enum", f"{_show(inst)} is not one of {_show(s['enum'])}")
        if "const" in s:
            if not json_equal(inst, s["const"]):
                add("const", f"{_show(inst)} is not {_show(s['const'])}")
        if isinstance(inst, str):
            if "minLength" in s and len(inst) < s["minLength"]:
                add("minLength", f"shorter than {s['minLength']} characters")
            if "maxLength" in s and len(inst) > s["maxLength"]:
                add("maxLength", f"longer than {s['maxLength']} characters")
            if "pattern" in s and not reg.compiled(s["pattern"]).search(inst):
                add("pattern", f"{_show(inst)} does not match {s['pattern']}")
        if _is_num(inst):
            if "minimum" in s and inst < s["minimum"]:
                add("minimum", f"{inst} is below the minimum {s['minimum']}")
            if "maximum" in s and inst > s["maximum"]:
                add("maximum", f"{inst} is above the maximum {s['maximum']}")
            if "exclusiveMinimum" in s and inst <= s["exclusiveMinimum"]:
                add("exclusiveMinimum", f"{inst} must be greater than {s['exclusiveMinimum']}")
            if "exclusiveMaximum" in s and inst >= s["exclusiveMaximum"]:
                add("exclusiveMaximum", f"{inst} must be less than {s['exclusiveMaximum']}")
        if isinstance(inst, list):
            if "minItems" in s and len(inst) < s["minItems"]:
                add("minItems", f"fewer than {s['minItems']} items")
            if "maxItems" in s and len(inst) > s["maxItems"]:
                add("maxItems", f"more than {s['maxItems']} items")
            if s.get("uniqueItems") is True:
                for i in range(len(inst)):
                    if any(json_equal(inst[i], inst[j]) for j in range(i)):
                        add("uniqueItems", f"item {i} duplicates an earlier item")
                        break
            if "items" in s:
                for i, item in enumerate(inst):
                    sub(item, s["items"], pointer_join(ip, i), pointer_join(sp, "items"))
        if isinstance(inst, dict):
            for req in s.get("required", ()):
                if req not in inst:
                    add("required", f"required property {req!r} is missing")
            if "minProperties" in s and len(inst) < s["minProperties"]:
                add("minProperties", f"fewer than {s['minProperties']} properties")
            if "maxProperties" in s and len(inst) > s["maxProperties"]:
                add("maxProperties", f"more than {s['maxProperties']} properties")
            props = s.get("properties", {})
            pats = s.get("patternProperties", {})
            for key in sorted(inst):
                value = inst[key]
                kp = pointer_join(ip, key)
                matched = False
                if key in props:
                    matched = True
                    sub(value, props[key], kp, pointer_join(pointer_join(sp, "properties"), key))
                for pat, psch in pats.items():
                    if reg.compiled(pat).search(key):
                        matched = True
                        sub(value, psch, kp, pointer_join(pointer_join(sp, "patternProperties"), pat))
                if not matched and "additionalProperties" in s:
                    ap = s["additionalProperties"]
                    if ap is False:
                        issues.append(SchemaIssue(kp, pointer_join(sp, "additionalProperties"),
                                                  "additionalProperties",
                                                  f"{kp}: property {key!r} is not allowed"))
                    elif ap is not True:
                        sub(value, ap, kp, pointer_join(sp, "additionalProperties"))
                if "propertyNames" in s:
                    i2, _e = self.run(key, s["propertyNames"], kp, pointer_join(sp, "propertyNames"), base, depth)
                    for it in i2:
                        issues.append(SchemaIssue(kp, it.schema_path, it.keyword,
                                                  f"{kp}: property name {key!r} is invalid ({it.message})"))
        if "allOf" in s:
            for i, branch in enumerate(s["allOf"]):
                sub(inst, branch, ip, pointer_join(pointer_join(sp, "allOf"), i))
        if "anyOf" in s:
            results = [self.run(inst, b, ip, pointer_join(pointer_join(sp, "anyOf"), i), base, depth)
                       for i, b in enumerate(s["anyOf"])]
            passing = [r for r in results if not r[0]]
            if passing:
                exts.extend(passing[0][1])
            else:
                best = min(results, key=lambda r: len(r[0]))
                issues.extend(best[0])
        if "oneOf" in s:
            results = [self.run(inst, b, ip, pointer_join(pointer_join(sp, "oneOf"), i), base, depth)
                       for i, b in enumerate(s["oneOf"])]
            passing = [r for r in results if not r[0]]
            if len(passing) == 1:
                exts.extend(passing[0][1])
            elif not passing:
                best = min(results, key=lambda r: len(r[0]))
                issues.extend(best[0])
            else:
                add("oneOf", f"matches {len(passing)} branches, exactly one required")
        if "not" in s:
            i2, _e = self.run(inst, s["not"], ip, pointer_join(sp, "not"), base, depth)
            if not i2:
                add("not", "matches a schema it must not match")
        if "if" in s:
            cond, _e = self.run(inst, s["if"], ip, pointer_join(sp, "if"), base, depth)
            if not cond:
                if "then" in s:
                    sub(inst, s["then"], ip, pointer_join(sp, "then"))
            elif "else" in s:
                sub(inst, s["else"], ip, pointer_join(sp, "else"))
        return issues, exts


def _sorted(issues: list[SchemaIssue]) -> tuple[SchemaIssue, ...]:
    unique = list(dict.fromkeys(issues))
    return tuple(sorted(unique, key=lambda i: (i.instance_path, i.schema_path)))


def _split_name(name: str) -> tuple[str, str]:
    fname, _sep, pointer = name.partition("#")
    return _file_name(fname), pointer


def validate(instance: Any, name: str, *, registry: Registry | None = None) -> Report:
    """Validate against one of our schemas: 'plan', 'plan.schema.json' or 'local-state#/$defs/active_marker'."""
    reg = registry or default_registry()
    fname, pointer = _split_name(name)
    doc = reg.get(fname)
    schema = resolve_pointer(doc, pointer) if pointer else doc
    issues, exts = _Validator(reg).run(instance, schema, "", f"{fname}#{pointer}", fname, 0)
    return Report(_sorted(issues), tuple(exts), tuple(reg.warnings))


def check(instance: Any, name: str, *, what: str, code: str = "E_SCHEMA") -> None:
    """Raise ValidationFailed (one ErrorItem per issue) when `instance` fails `name`."""
    report = validate(instance, name)
    if report.ok:
        return
    items = [ErrorItem(code, i.message, path=i.instance_path or "/") for i in report.issues[:50]]
    first = report.issues[0]
    raise ValidationFailed(f"{what} fails {_split_name(name)[0]}: {first.message}"
                           + (f" (+{len(report.issues) - 1} more)" if len(report.issues) > 1 else ""),
                           code=code, items=items)


def validate_with(instance: Any, schema: dict, *, base_dir: Path) -> Report:
    """Validate against another skill's schema document; its $refs resolve by file name in base_dir. Unsupported
    keywords are skipped with W_SCHEMA_UNSUPPORTED_KEYWORD."""
    reg = Registry(Path(base_dir), foreign=True)
    fname = "__inline__.schema.json"
    reg.add(fname, schema)
    issues, exts = _Validator(reg).run(instance, schema, "", f"{fname}#", fname, 0)
    return Report(_sorted(issues), tuple(exts), tuple(reg.warnings))


def run_externals(instance: Any, report: Report) -> tuple[list[SchemaIssue], list[ExternalCheck]]:
    """Validate each x-external block against the other skill's schema when the file exists.

    Returns (issues, missing): issues carry instance paths of the whole document; missing lists the checks whose
    schema file does not exist (the caller decides: plan-time commands raise DependencyMissing)."""
    issues: list[SchemaIssue] = []
    missing: list[ExternalCheck] = []
    for ext in report.externals:
        path = other_skill(ext.skill) / ext.rel_path  # type: ignore[arg-type]
        if not path.is_file():
            missing.append(ext)
            continue
        try:
            schema = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            raise InternalError(f"{path.as_posix()} is not valid JSON: {err}") from err
        sub = resolve_pointer(instance, ext.instance_path)
        rep = validate_with(sub, schema, base_dir=path.parent)
        for it in rep.issues:
            ipath = ext.instance_path + it.instance_path
            issues.append(SchemaIssue(ipath, f"{ext.skill}:{ext.rel_path}#{it.schema_path.partition('#')[2]}",
                                      it.keyword, f"{ipath or '/'}: {it.message.partition(': ')[2] or it.message}"))
    return issues, missing


# --- bundling ------------------------------------------------------------------------------------------------------

MAX_UNROLL = 3


def bundle(name: str) -> dict:
    """Inline every $ref (for an agent() schema option). A recursive reference is unrolled MAX_UNROLL times, then
    replaced by an unconstrained schema with a $comment saying so."""
    reg = default_registry()
    fname, pointer = _split_name(name)
    doc = reg.get(fname)
    root = resolve_pointer(doc, pointer) if pointer else doc

    def inline(node: Any, base: str, stack: tuple[str, ...]) -> Any:
        if isinstance(node, list):
            return [inline(n, base, stack) for n in node]
        if not isinstance(node, dict):
            return node
        out: dict[str, Any] = {}
        ref_schema: Any = None
        for key, value in node.items():
            if key == "$defs":
                continue
            if key == "$ref":
                target, tf = reg.resolve(value, base)
                ident = f"{tf}#{value.partition('#')[2]}"
                if stack.count(ident) >= MAX_UNROLL:
                    ref_schema = {"$comment": f"recursive reference {ident} cut after {MAX_UNROLL} levels"}
                else:
                    ref_schema = inline(copy.deepcopy(target), tf, stack + (ident,))
                continue
            if key in _MAP_KEYS:
                out[key] = {k: inline(v, base, stack) for k, v in value.items()}
            elif key in _LIST_KEYS:
                out[key] = [inline(v, base, stack) for v in value]
            elif key in _SCHEMA_KEYS:
                out[key] = inline(value, base, stack)
            else:
                out[key] = copy.deepcopy(value)
        if ref_schema is None:
            return out
        constraints = {k: v for k, v in out.items() if k not in ANNOTATIONS}
        if not constraints:
            merged = dict(ref_schema) if isinstance(ref_schema, dict) else {"allOf": [ref_schema]}
            for k, v in out.items():
                merged.setdefault(k, v)
            return merged
        allof = list(out.get("allOf", []))
        out["allOf"] = [ref_schema] + allof
        return out

    result = inline(copy.deepcopy(root), fname, ())
    if isinstance(result, dict):
        result.pop("$defs", None)
    return result
