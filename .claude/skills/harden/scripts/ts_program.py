#!/usr/bin/env python3
"""Offline whole-program evidence for TypeScript and JavaScript dead-code candidates.

Purpose
    DC-02's E1 level needs a production-mode whole-program finding. When Knip cannot be
    downloaded (network `registry-only` or `denied`), the project's own TypeScript answers the
    same question offline (pilot-auto-calibration A01-F16): this script loads the TypeScript in
    the repository's own node_modules through Node, runs the language service's
    findReferences on every export of every project configuration, resolves the exports of the
    package entry modules through the checker (so `export *` and aliased re-exports count as
    public API), and builds the module graph from the package entries. It never installs or
    downloads anything, and never runs project code. Production and test uses are kept apart,
    as Knip's production mode does.

    Per-export status, first match wins:
      public-api      the declaring file or a file re-exporting it is a package entry, or an
                      entry module exports it (resolved through aliases and `export *`)
      not-analysed    a default export, an export with no identifier name, or a CommonJS file
                      (module.exports / exports.x = ...) with no ES export statement
      referenced      used in another production file
      same-file-only  used only in its own file
      imported-only   imported or re-exported by another production file, never used
      test-only       referenced only from test files
      unreferenced    no reference of any kind outside its declaration
    Only `unreferenced` and `test-only` can support DC-02's E1, and only when
    `entry_resolution` is `complete` or `none` (DC-02). Names built from strings, non-literal
    dynamic imports and framework conventions are not modelled (DC-08, DC-09).
    TypeScript 7 has no stable programmatic API: without the @typescript/typescript6 alias
    the script reports `unavailable`.

CLI
    python ts_program.py [--repo DIR] [--files-from FILE] [--project TSCONFIG ...]
                         [--symbol NAME@PATH ...] [--no-refs] [--typescript DIR]
                         [--timeout SECONDS] [--out FILE|-] [--json]
    (use python3 on macOS/Linux)
    --repo        default: the git top level of the current directory
    --files-from  the in-scope list (default .harden/tools/inscope.txt, else git ls-files)
    --project     tsconfig/jsconfig files (default: every in-scope ts|jsconfig*.json; none: a
                  synthetic project over the TS/JS files with allowJs)
    --symbol      only these exports (reference search limited to them)
    --no-refs     module graph and emitted-output map only
    --typescript  a directory holding typescript, or a node_modules parent; for the unit tests
                  only: a run never passes it (the project's own TypeScript is the evidence)
    --timeout     seconds for the Node driver (default 600)
    --out         default .harden/tools/ts-program.json; '-' prints the JSON
    --json        print a summary to stdout

Exit codes
    0  ran, or no TypeScript/JavaScript file is in scope
    2  usage error: not a git repository, unreadable --files-from, a bad --symbol
    3  unavailable: no node, no typescript inside the repository, a driver failure or timeout
       (the JSON is still written, with status "unavailable" and the reason)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from collections import deque
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import _common as C  # noqa: E402  (sibling module, path set above; stdlib only)

VERSION = 1
TS_EXTS = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
DTS_SUFFIXES = (".d.ts", ".d.mts", ".d.cts")
CONFIG_RE = re.compile(r"^(ts|js)config[^/]*\.json$")
TOOL_CONFIG_RES = [re.compile(r"^[\w.-]*\.config\.[cm]?[jt]s$"),
                   re.compile(r"^\.?[\w-]*rc\.[cm]?[jt]s$")]
CJS_RE = re.compile(r"\bmodule\.exports\b|\bexports\.\w+\s*=")
ES_EXPORT_RE = re.compile(r"^\s*export\s", re.M)
DYN_RE = re.compile(r"\b(import|require)\s*\(")
ENTRY_FIELDS = ("main", "module", "types", "typings")
STATUSES = ("public-api", "not-analysed", "referenced", "same-file-only", "imported-only",
            "test-only", "unreferenced")

DRIVER_JS = r"""'use strict';
const fs = require('fs');
const path = require('path');
function main() {
  const req = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const ts = require(req.typescript_main);
  if (typeof ts.createLanguageService !== 'function' || typeof ts.getParsedCommandLineOfConfigFile !== 'function') {
    process.stdout.write(JSON.stringify({ error: 'typescript ' + ts.version + ' exposes no language service API (TypeScript 7 has no stable programmatic API; use the @typescript/typescript6 alias)' }));
    process.exitCode = 1;
    return;
  }
  const repo = norm(req.repo);
  const fold = (p) => (ts.sys.useCaseSensitiveFileNames ? p : p.toLowerCase());
  const repoKey = fold(repo.replace(/\/+$/, '')) + '/';
  const rel = (abs) => { const n = norm(abs); return fold(n).startsWith(repoKey) ? n.slice(repoKey.length) : null; };
  const out = { typescript_version: ts.version, projects: [], symbols: [], edges: [], emitted: {}, unresolved: [], diagnostics: [], resolved_exports: {} };
  const want = new Set(req.files);
  const symbolFilter = req.symbols ? new Set(req.symbols.map((s) => s.file + '\x00' + s.name)) : null;
  const seenSymbols = new Map(); const seenEdges = new Set(); const inPrograms = new Set();
  for (const proj of req.projects) {
    let parsed;
    if (proj.config) {
      const diags = [];
      const host = Object.assign({}, ts.sys, { onUnRecoverableConfigFileDiagnostic: (d) => diags.push(flat(ts, d)) });
      parsed = ts.getParsedCommandLineOfConfigFile(proj.config, undefined, host);
      if (!parsed) { out.projects.push({ config: rel(proj.config), error: diags.join('; ') || 'unparsable' }); continue; }
      for (const d of parsed.errors || []) out.diagnostics.push(flat(ts, d));
    } else {
      parsed = { fileNames: proj.files.map((f) => path.join(repo, f)), projectReferences: undefined,
                 options: { allowJs: true, checkJs: false, noEmit: true, module: ts.ModuleKind.NodeNext,
                            moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.Preserve } };
    }
    const files = parsed.fileNames.map(norm);
    const lsHost = {
      getScriptFileNames: () => files, getScriptVersion: () => '0',
      getScriptSnapshot: (f) => { const t = ts.sys.readFile(f); return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t); },
      getCurrentDirectory: () => (proj.config ? norm(path.dirname(proj.config)) : repo),
      getCompilationSettings: () => parsed.options, getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      getProjectReferences: () => parsed.projectReferences,
      fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists, getDirectories: ts.sys.getDirectories,
      realpath: ts.sys.realpath, useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    };
    const ls = ts.createLanguageService(lsHost, ts.createDocumentRegistry());
    const program = ls.getProgram(); const checker = program.getTypeChecker();
    const mine = program.getSourceFiles().filter((sf) => { const r = rel(sf.fileName); return r !== null && want.has(r); });
    out.projects.push({ config: proj.config ? rel(proj.config) : null, files: mine.length,
                        out_dir: parsed.options.outDir ? rel(parsed.options.outDir) : null,
                        root_dir: parsed.options.rootDir ? rel(parsed.options.rootDir) : null, no_emit: !!parsed.options.noEmit });
    for (const sf of mine) {
      const from = rel(sf.fileName); inPrograms.add(from);
      if (proj.config && !parsed.options.noEmit) {
        try {
          const outs = ts.getOutputFileNames(parsed, sf.fileName, !ts.sys.useCaseSensitiveFileNames).map(rel).filter((x) => x !== null);
          if (outs.length) out.emitted[from] = Array.from(new Set((out.emitted[from] || []).concat(outs)));
        } catch (e) { /* no output for this input */ }
      }
      if (req.want_graph) {
        const info = ts.preProcessFile(sf.text, true, true);
        for (const imp of info.importedFiles) {
          const r = ts.resolveModuleName(imp.fileName, sf.fileName, parsed.options, ts.sys);
          const target = r.resolvedModule && !r.resolvedModule.isExternalLibraryImport ? rel(r.resolvedModule.resolvedFileName) : null;
          const line = sf.getLineAndCharacterOfPosition(imp.pos).line + 1;
          if (target === null) { if (!r.resolvedModule && /^[.\/]/.test(imp.fileName)) out.unresolved.push({ file: from, line, specifier: imp.fileName }); continue; }
          const key = from + '\x00' + target;
          if (!seenEdges.has(key)) { seenEdges.add(key); out.edges.push({ from, to: target, line, specifier: imp.fileName }); }
        }
      }
      const moduleSymbol = checker.getSymbolAtLocation(sf);
      if (!moduleSymbol) continue;
      const exportsOf = checker.getExportsOfModule(moduleSymbol);
      const resolved = [];
      for (const exp of exportsOf) {
        let target = exp;
        try { if (exp.flags & ts.SymbolFlags.Alias) target = checker.getAliasedSymbol(exp); } catch (e) { target = exp; }
        const d0 = (target.declarations || [])[0];
        if (!d0) continue;
        const dsf = d0.getSourceFile();
        const dfile = rel(dsf.fileName);
        if (dfile === null) continue;
        const nn = d0.name && ts.isIdentifier(d0.name) ? d0.name : null;
        resolved.push({ name: String(target.escapedName), exported_as: String(exp.escapedName), decl_file: dfile,
                        decl_line: dsf.getLineAndCharacterOfPosition(nn ? nn.getStart(dsf) : d0.getStart(dsf)).line + 1 });
      }
      out.resolved_exports[from] = resolved;
      if (!req.want_refs) continue;
      for (const exp of exportsOf) {
        if (exp.flags & ts.SymbolFlags.Alias) continue;
        const name = String(exp.escapedName);
        if (name === 'export=') continue;
        for (const decl of exp.declarations || []) {
          if (decl.getSourceFile() !== sf) continue;
          if (symbolFilter && !symbolFilter.has(from + '\x00' + name)) break;
          const nameNode = decl.name && ts.isIdentifier(decl.name) ? decl.name : null;
          const pos = nameNode ? nameNode.getStart(sf) : decl.getStart(sf);
          const key = from + '\x00' + name + '\x00' + pos;
          let rec = seenSymbols.get(key);
          if (!rec) { rec = { file: from, name, line: sf.getLineAndCharacterOfPosition(pos).line + 1, kind: ts.SyntaxKind[decl.kind], refs: new Map(), no_identifier: !nameNode || name === 'default' }; seenSymbols.set(key, rec); }
          if (rec.no_identifier) break;
          for (const g of ls.findReferences(sf.fileName, pos) || []) {
            for (const r of g.references) {
              const rf = rel(r.fileName); if (rf === null) continue;
              const rsf = program.getSourceFile(r.fileName); if (!rsf) continue;
              const lc = rsf.getLineAndCharacterOfPosition(r.textSpan.start);
              const rkey = rf + ':' + (lc.line + 1) + ':' + (lc.character + 1);
              if (!rec.refs.has(rkey)) rec.refs.set(rkey, { file: rf, line: lc.line + 1, col: lc.character + 1, role: role(ts, rsf, r.textSpan.start, r.isDefinition === true) });
            }
          }
          break;
        }
      }
    }
  }
  for (const rec of seenSymbols.values()) out.symbols.push({ file: rec.file, name: rec.name, line: rec.line, kind: rec.kind, no_identifier: rec.no_identifier, references: Array.from(rec.refs.values()) });
  out.files_outside_programs = req.files.filter((f) => !inPrograms.has(f));
  process.stdout.write(JSON.stringify(out));
}
function norm(p) { return String(p).replace(/\\/g, '/'); }
function flat(ts, d) { return ts.flattenDiagnosticMessageText(d.messageText, '\n'); }
function role(ts, sf, pos, isDefinition) {
  const n = nodeAt(ts, sf, pos);
  if (isDefinition) {
    if (n && inside(ts, n, (a) => ts.isExportSpecifier(a) || ts.isExportDeclaration(a))) return 're-export';
    if (n && inside(ts, n, (a) => ts.isImportSpecifier(a) || ts.isImportClause(a) || ts.isNamespaceImport(a) || ts.isImportEqualsDeclaration(a))) return 'import';
    return 'definition';
  }
  if (!n) return 'use';
  if (inside(ts, n, (a) => ts.isExportSpecifier(a) || ts.isExportDeclaration(a) || ts.isExportAssignment(a))) return 're-export';
  if (inside(ts, n, (a) => ts.isImportDeclaration(a) || ts.isImportEqualsDeclaration(a))) return 'import';
  return 'use';
}
function nodeAt(ts, sf, pos) { let found = null; (function visit(node) { if (pos < node.getStart(sf) || pos >= node.getEnd()) return; found = node; ts.forEachChild(node, visit); })(sf); return found; }
function inside(ts, node, test) { for (let a = node; a; a = a.parent) { if (test(a)) return true; if (ts.isSourceFile(a)) break; } return false; }
try { main(); } catch (e) { process.stdout.write(JSON.stringify({ error: String(e && e.stack || e) })); process.exitCode = 1; }
"""


class UsageError(Exception):
    """Bad arguments (exit 2)."""


class Unavailable(Exception):
    """The analysis cannot run here (exit 3)."""


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------
def read_list(path: Path) -> List[str]:
    try:
        text = path.read_bytes().decode("utf-8-sig", errors="replace")
    except OSError as exc:
        raise UsageError("cannot read {}: {}".format(path, exc)) from exc
    out: List[str] = []
    for line in text.splitlines():
        line = line.strip().replace("\\", "/")
        if not line or line.startswith("#"):
            continue
        while line.startswith("./"):
            line = line[2:]
        out.append(line)
    return out


def is_ts_file(path: str) -> bool:
    lower = path.lower()
    return lower.endswith(TS_EXTS) and not lower.endswith(DTS_SUFFIXES)


def load_test_globs(repo: Path) -> List[str]:
    cfg = repo / ".harden" / "config.json"
    try:
        data = C.read_json(cfg)
    except (OSError, ValueError):
        return []
    globs = data.get("test_globs") if isinstance(data, dict) else None
    return [g for g in globs if isinstance(g, str)] if isinstance(globs, list) else []


def is_test(path: str, test_globs: Sequence[str] = ()) -> bool:
    return C.is_test_path(path) or (bool(test_globs) and C.match_any(path, test_globs))


# ---------------------------------------------------------------------------
# Post-processing (pure functions, unit-tested)
# ---------------------------------------------------------------------------
def _strings(value: Any) -> List[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        out: List[str] = []
        for v in value:
            out += _strings(v)
        return out
    if isinstance(value, dict):
        out = []
        for v in value.values():
            out += _strings(v)
        return out
    return []


def _norm_rel(pkg_dir: str, value: str) -> str:
    v = value.strip().replace("\\", "/")
    while v.startswith("./"):
        v = v[2:]
    joined = (pkg_dir + "/" + v) if pkg_dir else v
    parts: List[str] = []
    for seg in joined.split("/"):
        if seg in ("", "."):
            continue
        if seg == "..":
            if parts:
                parts.pop()
            continue
        parts.append(seg)
    return "/".join(parts)


def _reverse_emitted(emitted: Dict[str, List[str]]) -> Dict[str, str]:
    rev: Dict[str, str] = {}
    for src, outs in emitted.items():
        for o in outs:
            rev.setdefault(o, src)
            rev.setdefault(o.lower(), src)
    return rev


def _map_value(value: str, files: Set[str], rev: Dict[str, str]) -> List[str]:
    if "*" in value:
        rx = re.compile("^" + "[^/]*".join(re.escape(p) for p in value.split("*")) + "$")
        hits = sorted({src for out, src in rev.items() if rx.match(out)})
        hits += sorted(f for f in files if rx.match(f))
        return sorted(set(hits))
    if value in files:
        return [value]
    if value in rev:
        return [rev[value]]
    if value.lower() in rev:
        return [rev[value.lower()]]
    return []


def package_entries(package_jsons: Dict[str, Any], files: Iterable[str],
                    emitted: Dict[str, List[str]]) -> Dict[str, Any]:
    """Entry sources from each package.json (path -> parsed JSON). Returns entry_sources,
    entries_unresolved, script_entries and entry_resolution (complete | incomplete | none)."""
    fileset = set(files)
    rev = _reverse_emitted(emitted)
    entries: Set[str] = set()
    unresolved: List[Dict[str, str]] = []
    scripts: Set[str] = set()
    declared = 0
    for pj_path, data in sorted(package_jsons.items()):
        if not isinstance(data, dict):
            continue
        pkg_dir = pj_path.rsplit("/", 1)[0] if "/" in pj_path else ""
        values: List[str] = []
        for field in ENTRY_FIELDS:
            if isinstance(data.get(field), str):
                values.append(data[field])
        if isinstance(data.get("browser"), str):
            values.append(data["browser"])
        bin_field = data.get("bin")
        if isinstance(bin_field, str):
            values.append(bin_field)
        elif isinstance(bin_field, dict):
            values += [v for v in bin_field.values() if isinstance(v, str)]
        values += _strings(data.get("exports"))
        for value in values:
            declared += 1
            rel = _norm_rel(pkg_dir, value)
            hits = _map_value(rel, fileset, rev)
            if hits:
                entries.update(hits)
            else:
                unresolved.append({"value": value, "package_json": pj_path})
        script_map = data.get("scripts")
        if isinstance(script_map, dict):
            for command in script_map.values():
                if not isinstance(command, str):
                    continue
                try:
                    tokens = shlex.split(command, posix=True)
                except ValueError:
                    continue
                for tok in tokens:
                    rel = _norm_rel(pkg_dir, tok)
                    for hit in _map_value(rel, fileset, rev) if "*" not in rel else []:
                        if is_ts_file(hit):
                            scripts.add(hit)
    if declared == 0:
        resolution = "none"
    elif unresolved:
        resolution = "incomplete"
    else:
        resolution = "complete"
    return {"entry_sources": sorted(entries), "entries_unresolved": unresolved,
            "script_entries": sorted(scripts), "entry_resolution": resolution}


def _is_commonjs(text: Optional[str]) -> bool:
    return bool(text) and bool(CJS_RE.search(text)) and not ES_EXPORT_RE.search(text)


def classify(symbol: Dict[str, Any], entry_sources: Iterable[str],
             test_pred: Callable[[str], bool],
             resolved_exports: Optional[Dict[str, List[Dict[str, Any]]]] = None,
             file_text: Optional[Callable[[str], Optional[str]]] = None) -> Dict[str, Any]:
    """Status and use lists of one exported symbol (see the module docstring)."""
    decl = symbol["file"]
    entries = set(entry_sources)
    refs = symbol.get("references") or []
    uses = [r for r in refs if r.get("role") == "use"]
    same = [r for r in uses if r["file"] == decl]
    prod = [r for r in uses if r["file"] != decl and not test_pred(r["file"])]
    test_refs = [r for r in refs if r["file"] != decl and test_pred(r["file"])
                 and r.get("role") in ("use", "import", "re-export")]
    test_uses = [r for r in uses if r["file"] != decl and test_pred(r["file"])]
    reexport_files = sorted({r["file"] for r in refs
                             if r["file"] != decl and r.get("role") == "re-export"})
    other_imports = [r for r in refs if r["file"] != decl and not test_pred(r["file"])
                     and r.get("role") in ("import", "re-export")]
    outside = [r for r in refs if not (r["file"] == decl and r.get("role") == "definition")]
    exposed = decl in entries or any(f in entries for f in reexport_files)
    if not exposed and resolved_exports:
        for entry in entries:
            for item in resolved_exports.get(entry, []):
                if item.get("decl_file") == decl and item.get("name") == symbol["name"]:
                    exposed = True
                    break
            if exposed:
                break
    if exposed:
        status = "public-api"
    elif symbol.get("no_identifier") or symbol["name"] == "default" or (
            decl.lower().endswith((".js", ".cjs")) and file_text is not None
            and _is_commonjs(file_text(decl))):
        status = "not-analysed"
    elif prod:
        status = "referenced"
    elif same:
        status = "same-file-only"
    elif other_imports:
        status = "imported-only"
    elif test_refs:
        status = "test-only"
    elif not outside:
        status = "unreferenced"
    elif all(r["file"] == decl for r in outside):
        status = "same-file-only"  # e.g. a local re-export: never E1
    else:
        status = "imported-only"  # any other reference keeps it out of E1
    return {"status": status,
            "production_uses": [{"file": r["file"], "line": r["line"]} for r in prod],
            "test_uses": [{"file": r["file"], "line": r["line"]} for r in test_uses],
            "same_file_uses": len(same), "reexported_by": reexport_files,
            "entry_exposed": exposed}


def _is_tool_config(path: str) -> bool:
    base = path.rsplit("/", 1)[-1]
    return any(rx.match(base) for rx in TOOL_CONFIG_RES)


def reachability(edges: Sequence[Dict[str, Any]], entry_sources: Iterable[str],
                 script_entries: Iterable[str], files: Iterable[str],
                 test_pred: Callable[[str], bool],
                 outside: Iterable[str] = ()) -> Dict[str, Any]:
    """Files the package entries reach over production import edges, and those they do not."""
    starts = set(entry_sources) | set(script_entries)
    out_set = set(outside)
    adj: Dict[str, List[str]] = {}
    for e in edges:
        adj.setdefault(e["from"], []).append(e["to"])

    def bfs(roots: Iterable[str], allow: Callable[[str], bool]) -> Set[str]:
        seen = set(roots)
        queue = deque(seen)
        while queue:
            cur = queue.popleft()
            if not allow(cur):
                continue
            for nxt in adj.get(cur, []):
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append(nxt)
        return seen

    files = [f for f in files if is_ts_file(f)]
    tests = [f for f in files if test_pred(f)]
    from_tests = bfs(tests, lambda f: True)
    if not starts:
        prod = set()
        unreachable = None
        note = "no package entry resolved"
    else:
        prod = bfs(starts, lambda f: not test_pred(f))
        unreachable = sorted(f for f in files if f not in prod and not test_pred(f)
                             and f not in out_set and not _is_tool_config(f))
        note = None
    test_only = sorted(f for f in from_tests if f in set(files) and f not in prod
                       and not test_pred(f))
    return {"unreachable_production_files": unreachable, "reachability_note": note,
            "test_only_files": test_only}


def dynamic_imports(texts: Dict[str, str]) -> List[Dict[str, Any]]:
    """`import(...)` and `require(...)` calls whose argument is not a plain string literal."""
    found: List[Dict[str, Any]] = []
    for path in sorted(texts):
        text = texts[path].replace("\r\n", "\n").replace("\r", "\n")
        for m in DYN_RE.finditer(text):
            k = m.end()
            while k < len(text) and text[k] in " \t\n":
                k += 1
            ch = text[k] if k < len(text) else ""
            static = False
            if ch in ("'", '"'):
                static = True
            elif ch == "`":
                close = text.find("`", k + 1)
                static = close != -1 and "${" not in text[k + 1:close]
            if not static:
                found.append({"file": path, "line": text.count("\n", 0, m.start()) + 1})
    return found


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
def _child_env() -> Dict[str, str]:
    env = dict(os.environ)
    env.pop("NODE_OPTIONS", None)
    env.pop("NODE_PATH", None)
    return env


def resolve_typescript(node: str, repo: str, flag: Optional[str]) -> Tuple[str, str]:
    """(absolute typescript main, source 'project' | 'flag')."""
    if flag:
        base = Path(flag)
        pkg = base / "package.json"
        target = str(base) if pkg.is_file() and _pkg_name(pkg) == "typescript" else None
        script = ("const t=process.argv[1],p=process.argv[2];process.stdout.write(t?"
                  "require.resolve(t):require.resolve('typescript',{paths:[p]}))")
        args = [node, "-e", script, target or "", str(base)]
        source = "flag"
    else:
        args = [node, "-e", "process.stdout.write(require.resolve('typescript',"
                "{paths:[process.argv[1]]}))", repo]
        source = "project"
    try:
        proc = subprocess.run(args, capture_output=True, timeout=60, env=_child_env())
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Unavailable("cannot run node to resolve typescript: {}".format(exc)) from exc
    main = proc.stdout.decode("utf-8", errors="replace").strip()
    if proc.returncode != 0 or not main:
        if source == "project":
            raise Unavailable("typescript not resolvable inside the repository (the project's "
                              "own node_modules)")
        raise Unavailable("typescript not resolvable from --typescript {}".format(flag))
    if source == "project":
        lexical = Path(repo) / "node_modules" / "typescript"
        real_main = os.path.realpath(main)
        real_repo = os.path.realpath(repo)
        inside = os.path.normcase(real_main).startswith(os.path.normcase(real_repo) + os.sep)
        if not (lexical.exists() or inside):
            raise Unavailable("typescript not resolvable inside the repository (the project's "
                              "own node_modules); found {}".format(C.to_posix(main)))
    return main, source


def _relative_or_absolute(path: str, repo: str) -> str:
    try:
        rel = os.path.relpath(path, repo)
    except ValueError:  # another drive on Windows
        return C.to_posix(path)
    return C.to_posix(path) if rel.startswith("..") else C.to_posix(rel)


def _pkg_name(path: Path) -> Optional[str]:
    try:
        return C.read_json(path).get("name")
    except (OSError, ValueError, AttributeError):
        return None


def run_driver(node: str, request_path: Path, timeout: int) -> Dict[str, Any]:
    try:
        proc = subprocess.run([node, "-", str(request_path)], input=DRIVER_JS.encode("utf-8"),
                              capture_output=True, timeout=timeout, env=_child_env())
    except subprocess.TimeoutExpired as exc:
        raise Unavailable("the TypeScript driver timed out after {} s".format(timeout)) from exc
    except OSError as exc:
        raise Unavailable("cannot run node: {}".format(exc)) from exc
    stdout = proc.stdout.decode("utf-8", errors="replace")
    stderr = proc.stderr.decode("utf-8", errors="replace")[:2000]
    try:
        data = json.loads(stdout) if stdout.strip() else None
    except ValueError:
        data = None
    if isinstance(data, dict) and data.get("error"):
        raise Unavailable(str(data["error"])[:2000])
    if proc.returncode != 0 or not isinstance(data, dict):
        raise Unavailable("the TypeScript driver failed (exit {}): {}".format(
            proc.returncode, stderr or stdout[:2000]))
    return data


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def _base_output(repo: str, status: str, reason: Optional[str]) -> Dict[str, Any]:
    return {"tool": "ts_program.py", "version": VERSION, "status": status, "reason": reason,
            "generated": C.utc_iso(), "repo": repo}


def _write(out: str, data: Dict[str, Any]) -> None:
    if out == "-":
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        C.write_json(Path(out), data)


def _summary(data: Dict[str, Any]) -> Dict[str, Any]:
    counts = {s: 0 for s in STATUSES}
    for sym in data.get("symbols", []):
        counts[sym["status"]] = counts.get(sym["status"], 0) + 1
    return {"status": data["status"], "reason": data.get("reason"),
            "entry_resolution": data.get("entry_resolution"), "counts": counts,
            "files_outside_programs": data.get("files_outside_programs", []),
            "unreachable_production_files": data.get("unreachable_production_files")}


def main(argv: Optional[Sequence[str]] = None) -> int:
    C.configure_stdio()
    parser = argparse.ArgumentParser(
        prog="ts_program.py",
        description="Offline export references and module graph from the project's own "
                    "TypeScript (DC-02 E1 evidence).")
    parser.add_argument("--repo", help="repository (default: git top level of the cwd)")
    parser.add_argument("--files-from", help="in-scope list (default .harden/tools/inscope.txt)")
    parser.add_argument("--project", action="append", default=[], help="tsconfig or jsconfig")
    parser.add_argument("--symbol", action="append", default=[], help="NAME@PATH to analyse")
    parser.add_argument("--no-refs", action="store_true", help="graph and emitted map only")
    parser.add_argument("--typescript", help="typescript location, unit tests only; a run never "
                                             "passes it")
    parser.add_argument("--timeout", type=int, default=600, help="driver timeout in seconds")
    parser.add_argument("--out", help="output JSON (default .harden/tools/ts-program.json)")
    parser.add_argument("--json", action="store_true", help="print a summary")
    args = parser.parse_args(argv)
    try:
        start = Path(args.repo) if args.repo else Path.cwd()
        top = C.git_ok(start, ["rev-parse", "--show-toplevel"]) if C.git_available() else None
        if not top:
            raise UsageError("{} is not in a git repository".format(C.posix_abs(start)))
        repo = C.to_posix(os.path.realpath(top))
        repo_path = Path(repo)
        if args.files_from:
            scope = read_list(Path(args.files_from))
        elif (repo_path / ".harden" / "tools" / "inscope.txt").is_file():
            scope = read_list(repo_path / ".harden" / "tools" / "inscope.txt")
        else:
            listed = C.git_bytes(repo_path, ["ls-files", "-z"]).decode("utf-8", "replace")
            scope = [p for p in listed.split("\0") if p]
        files = sorted({p for p in scope if is_ts_file(p)})
        symbols = []
        for spec in args.symbol:
            if "@" not in spec:
                raise UsageError("--symbol {!r} is not NAME@PATH".format(spec))
            name, path = spec.split("@", 1)
            path = path.replace("\\", "/")
            while path.startswith("./"):
                path = path[2:]
            if not name or path not in files:
                raise UsageError("--symbol {!r}: the path is not an in-scope TypeScript or "
                                 "JavaScript file".format(spec))
            symbols.append({"name": name, "file": path})
    except (UsageError, C.GitError) as exc:
        print("ts_program.py: {}".format(exc), file=sys.stderr)
        return 2
    out = args.out or str(repo_path / ".harden" / "tools" / "ts-program.json")
    if not files:
        data = _base_output(repo, "no-typescript-files", None)
        _write(out, data)
        if args.json:
            print(json.dumps(_summary(data), indent=2))
        return 0
    data = _base_output(repo, "ok", None)
    try:
        node = shutil.which("node")
        if not node:
            raise Unavailable("node not found")
        ts_main, source = resolve_typescript(node, repo, args.typescript)
        configs = [c.replace("\\", "/") for c in args.project] or sorted(
            p for p in scope if CONFIG_RE.match(p.rsplit("/", 1)[-1]))
        if configs:
            projects = [{"config": C.to_posix(str(repo_path / c))} for c in configs]
        else:
            projects = [{"config": None, "files": files}]
        request = {"repo": repo, "typescript_main": C.to_posix(ts_main), "files": files,
                   "projects": projects, "symbols": symbols or None,
                   "want_refs": not args.no_refs, "want_graph": True}
        req_dir = (Path(out).parent if out != "-" else repo_path / ".harden" / "tools")
        req_dir.mkdir(parents=True, exist_ok=True)
        req_path = req_dir / "ts-program.request.json"
        C.write_json(req_path, request)
        raw = run_driver(node, req_path, args.timeout)
    except Unavailable as exc:
        data["status"] = "unavailable"
        data["reason"] = str(exc)
        _write(out, data)
        if args.json:
            print(json.dumps(_summary(data), indent=2))
        else:
            print("ts_program.py: unavailable: {}".format(exc), file=sys.stderr)
        return 3
    test_globs = load_test_globs(repo_path)

    def test_pred(p: str) -> bool:
        return is_test(p, test_globs)

    package_jsons: Dict[str, Any] = {}
    for p in scope:
        if p.rsplit("/", 1)[-1] == "package.json" and "node_modules/" not in p + "/":
            try:
                package_jsons[p] = C.read_json(repo_path / p)
            except (OSError, ValueError):
                continue
    emitted = raw.get("emitted", {})
    entries = package_entries(package_jsons, files, emitted)
    texts: Dict[str, str] = {}

    def file_text(p: str) -> Optional[str]:
        if p not in texts:
            try:
                texts[p] = C.read_text(repo_path / p)
            except OSError:
                texts[p] = ""
        return texts[p]

    resolved_exports = raw.get("resolved_exports", {})
    out_symbols = []
    for sym in raw.get("symbols", []):
        if test_pred(sym["file"]) or sym["file"].lower().endswith(DTS_SUFFIXES):
            continue
        cls = classify(sym, entries["entry_sources"], test_pred, resolved_exports, file_text)
        rec = {"file": sym["file"], "name": sym["name"], "line": sym["line"],
               "kind": sym.get("kind"), "no_identifier": bool(sym.get("no_identifier"))}
        rec.update(cls)
        rec["references"] = sym.get("references", [])
        out_symbols.append(rec)
    out_symbols.sort(key=lambda s: (s["file"], s["line"], s["name"]))
    reach = reachability(raw.get("edges", []), entries["entry_sources"],
                         entries["script_entries"], files, test_pred,
                         raw.get("files_outside_programs", []))
    for f in files:
        file_text(f)
    data.update({
        "typescript_version": raw.get("typescript_version"),
        "typescript_path": _relative_or_absolute(ts_main, repo),
        "typescript_source": source,
        "projects": raw.get("projects", []), "diagnostics": raw.get("diagnostics", []),
        "files_outside_programs": raw.get("files_outside_programs", []),
        "entry_sources": entries["entry_sources"], "script_entries": entries["script_entries"],
        "entries_unresolved": entries["entries_unresolved"],
        "entry_resolution": entries["entry_resolution"],
        "symbols": out_symbols, "edges": raw.get("edges", []),
        "unresolved": raw.get("unresolved", []), "emitted": emitted,
        "resolved_exports": resolved_exports,
        "unreachable_production_files": reach["unreachable_production_files"],
        "reachability_note": reach["reachability_note"],
        "test_only_files": reach["test_only_files"],
        "dynamic_imports": dynamic_imports({f: texts.get(f, "") for f in files}),
    })
    _write(out, data)
    if args.json:
        print(json.dumps(_summary(data), indent=2))
    elif out != "-":
        s = _summary(data)
        print("ts_program.py: {} exports ({}); entry resolution {} -> {}".format(
            len(out_symbols), ", ".join("{} {}".format(v, k) for k, v in s["counts"].items() if v),
            data["entry_resolution"], out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
