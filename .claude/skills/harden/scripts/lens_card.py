#!/usr/bin/env python3
"""lens_card.py - detector cards, lens-pass task files and Source-free reference copies.

Purpose
    Rule text was 73% of a lens pass's context in the second pilot, and a quarter of it was
    Source lines no pass needs to detect (pilot-auto-calibration A01-F44). The orchestrator
    re-read whole references after compactions (A01-F46). This script:
      card     builds one detector card per lens (or lens bundle, detection step 7) and run:
               the lens file and the language files without their Source lines, Contents and
               Evidence limits, and without the language files' Refactoring engines rules
               (edit-phase rules no candidate ever cited), split into parts of at most
               --max-chars characters, each of which fits one Read
      task     writes a lens pass's task file .harden/prompts/<pass-id>.md from
               assets/lens-pass-prompt.md and prints the two-line prompt of its harden-lens
               subagent; it refuses a pass whose estimate exceeds --max-tokens
      refs     writes Source-free copies of the five process references to .harden/refs/,
               plus their Steps parts (<name>.steps.md)
      show     prints named rule blocks without their Source bullet
      sources  maps rule ids to their Source bullets, for the report
    card, refs and task refuse to run while git tracks .harden/cards or .harden/refs, and task
    refuses card parts whose recorded sha256 (manifest.json) or source sha256 changed: the
    rule text a pass reads comes from the skill, never from repository files (invariant 6).

CLI (python3 on macOS/Linux)
    python lens_card.py card --lens NAME[,NAME...] [--langs typescript,solidity]
                             [--out-dir .harden/cards] [--max-chars 40000] [--repo .]
    python lens_card.py task --lens NAME[,NAME...] (--unit UNIT | --slice-from FILE [--unit UNIT])
                             [--pass N] [--pass-id ID] [--unseeded | --tools F [F ...] | --no-tools]
                             [--context-file .harden/prompts/context.md] [--classes a,b]
                             [--fallback] [--max-tokens 150000] [--replace] [--repo .]
    python lens_card.py refs [--out-dir .harden/refs] [--repo .]
    python lens_card.py show --rules ID[,ID...]
    python lens_card.py sources (--ids ID[,ID...] | --findings .harden/findings.json)
                                [--out .harden/tools/rule-sources.json] [--repo .]

    Lens names are the stems after `lens-` (dead-code, security, ...) plus `exploration` (DT-22's
    open pass: language rules only); language names the stems after `lang-` (typescript, python,
    rust, cpp, go, solidity). A bundle is written a,b,c and its card is named a+b+c.
    task names the pass <lens abbreviation>-<unit slug>-p<N> when --pass-id is not given: the
    abbreviation is the lens's rule prefix in lower case (dots join a bundle's), and the slug is
    the unit id with every character outside [A-Za-z0-9._-] replaced by `_` (cut, with the
    first 6 hex of sha1(unit id) appended, when the id would exceed 80 characters).
    The estimate is card, schema and tool-output characters / 2.5, the slice's ledger
    est_tokens (pro rata for ranges), 8,000 tokens of overhead and a 30,000-token reserve.

Exit codes
    0  written or printed
    1  show: an unknown rule id
    2  usage error: an unknown lens or language, a tracked .harden/cards or .harden/refs, a
       missing or changed card, a pass over its token limit, an existing task file without
       --replace, a seeded task without --tools or --no-tools, --unseeded with --context-file

Python 3.9+ standard library only; UTF-8 in, UTF-8 with LF out; absolute paths are printed with
forward slashes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.dont_write_bytecode = True
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import harden_agents as HA  # noqa: E402  (sibling module, stdlib only)
import persist_pass as PP  # noqa: E402

SKILL_DIR = _HERE.parent
REFS = SKILL_DIR / "references"
PROMPT_TEMPLATE = SKILL_DIR / "assets" / "lens-pass-prompt.md"
SCHEMA = SKILL_DIR / "assets" / "findings.schema.json"
PROCESS_REFS = ("detection", "protocol-preflight", "protocol-change", "prioritization",
                "reporting")
LENS_DROP = ("Contents", "Evidence limits")
LANG_DROP = ("Contents", "Evidence limits", "Refactoring engines")
EXPLORATION = "exploration"
CHARS_PER_TOKEN = 2.5
OVERHEAD = 8000
RESERVE = 30000
RULE_HEAD_RE = re.compile(r"^### ([A-Z][A-Z0-9]-\d{2}) " + chr(0x2014) + " (.*)$")
SOURCE_RE = re.compile(r"^- \*\*Source:\*\*")
ID_RE = PP.ID_RE


class CardError(Exception):
    """A usage error (exit 2)."""


def posix(path: str) -> str:
    return PP.posix(path)


def sha(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def read_ref(path: Path) -> str:
    return path.read_bytes().decode("utf-8").lstrip(chr(0xFEFF)).replace("\r\n", "\n")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def names(prefix: str) -> List[str]:
    return sorted(p.stem[len(prefix):] for p in REFS.glob(prefix + "*.md"))


def parse_lenses(raw: str) -> List[str]:
    lenses = [x.strip() for x in raw.split(",") if x.strip()]
    valid = names("lens-")
    bad = [x for x in lenses if x not in valid and x != EXPLORATION]
    if not lenses or bad or len(set(lenses)) != len(lenses):
        raise CardError("unknown or repeated lens {}: valid lenses are {}, {}".format(
            ", ".join(bad) or raw, ", ".join(valid), EXPLORATION))
    if len(lenses) > 3:
        raise CardError("a bundle holds at most three lenses (pilot-auto-calibration A01-F33)")
    return lenses


def parse_langs(raw: Optional[str]) -> List[str]:
    langs = [x.strip() for x in (raw or "").split(",") if x.strip()]
    valid = names("lang-")
    bad = [x for x in langs if x not in valid]
    if bad:
        raise CardError("unknown language {}: valid languages are {}".format(
            ", ".join(bad), ", ".join(valid)))
    return langs


def strip_sources(lines: List[str]) -> List[str]:
    """Every `- **Source:**` bullet with its continuation lines removed."""
    out: List[str] = []
    skipping = False
    for line in lines:
        if SOURCE_RE.match(line):
            skipping = True
            continue
        if skipping:
            if not line.strip() or line.startswith(("- **", "### ", "## ")):
                skipping = False
            else:
                continue
        out.append(line)
    return out


def sections(text: str) -> Tuple[List[str], List[Tuple[str, List[str]]]]:
    """(the lines before the first `## ` heading, [(heading title, lines)])."""
    pre: List[str] = []
    secs: List[Tuple[str, List[str]]] = []
    for line in text.split("\n"):
        if line.startswith("## "):
            secs.append((line[3:].strip(), [line]))
        elif secs:
            secs[-1][1].append(line)
        else:
            pre.append(line)
    return pre, secs


def filtered(text: str, drop: Sequence[str]) -> List[str]:
    pre, secs = sections(text)
    keep = [pre[0]] if pre else []
    keep += [line for line in pre[1:] if line.startswith(">")]
    keep.append("")
    for title, lines in secs:
        if title in drop:
            continue
        keep += lines
    return strip_sources(keep)


def split_parts(lines: List[str], max_chars: int, name: str) -> List[str]:
    """Parts of at most max_chars characters, cut only before a `## ` or `### ` line (or
    between lines when one block alone is larger)."""
    blocks: List[List[str]] = [[]]
    for line in lines:
        if line.startswith(("## ", "### ")) and blocks[-1]:
            blocks.append([])
        blocks[-1].append(line)
    marker_room = len("<!-- card part 99 of 99: {} -->\n".format(name))
    budget = max_chars - marker_room
    if budget < 1000:
        raise CardError("--max-chars is too small")
    parts: List[List[str]] = [[]]
    size = 0
    for block in blocks:
        text_len = sum(len(line) + 1 for line in block)
        if size and size + text_len > budget:
            parts.append([])
            size = 0
        if text_len > budget:
            for line in block:
                if size and size + len(line) + 1 > budget:
                    parts.append([])
                    size = 0
                parts[-1].append(line)
                size += len(line) + 1
            continue
        parts[-1] += block
        size += text_len
    count = len(parts)
    out = []
    for k, part in enumerate(parts, 1):
        body = "\n".join(part).strip("\n") + "\n"
        if k > 1:
            body = "<!-- card part {} of {}: {} -->\n".format(k, count, name) + body
        out.append(body)
    return out


def repo_root(start: str) -> Path:
    try:
        out = subprocess.run(["git", "-C", start, "rev-parse", "--show-toplevel"],
                             capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CardError("git is not available: {}".format(exc)) from exc
    top = out.stdout.decode("utf-8", errors="replace").strip()
    if out.returncode != 0 or not top:
        raise CardError("{} is not in a git repository".format(posix(start)))
    return Path(posix(top))


def refuse_tracked(root: Path) -> None:
    out = subprocess.run(["git", "-C", str(root), "ls-files", "--", ".harden/cards",
                          ".harden/refs"], capture_output=True, timeout=60)
    listed = out.stdout.decode("utf-8", errors="replace").strip()
    if listed:
        raise CardError("git tracks files under .harden/cards or .harden/refs ({}): rule text "
                        "must come from the skill, not from the repository (invariant 6)"
                        .format(listed.split("\n")[0]))


def card_name(lenses: Sequence[str]) -> str:
    return "+".join(lenses)


def build_card(lenses: Sequence[str], langs: Sequence[str], max_chars: int
               ) -> Tuple[List[str], Dict[str, str]]:
    sources: Dict[str, str] = {}
    body: List[str] = []
    for lens in lenses:
        if lens == EXPLORATION:
            continue
        rel = "references/lens-{}.md".format(lens)
        text = read_ref(SKILL_DIR / rel)
        sources[rel] = sha(text)
        body += filtered(text, LENS_DROP) + [""]
    for lang in langs:
        rel = "references/lang-{}.md".format(lang)
        text = read_ref(SKILL_DIR / rel)
        sources[rel] = sha(text)
        body += filtered(text, LANG_DROP) + [""]
    name = card_name(lenses)
    header = ["# Detector card: {}{}".format(name, " (+ {})".format(", ".join(langs))
                                              if langs else ""),
              "> Generated by lens_card.py from {} (sha256 {}).".format(
                  ", ".join(sources) or "no reference file",
                  ", ".join(v[:12] for v in sources.values()) or "-"),
              "> Omitted: Source lines, Contents, Evidence limits and the language files' "
              "Refactoring engines rules. The report joins",
              "> sources back by rule id (lens_card.py sources). This card replaces those "
              "files: do not open them.",
              "> Parts of at most {:,} characters: about {:,}k tokens at the 2.47 chars/token "
              "measured on detection.md, under the 25,000-token Read cap.".format(
                  max_chars, int(max_chars / 2.47 / 1000)), ""]
    if lenses == [EXPLORATION]:
        header.insert(4, "> Exploration pass (DT-22): no lens file; check any catalogue rule a "
                         "defect fits.")
    return split_parts(header + body, max_chars, name), sources


def cmd_card(args: argparse.Namespace) -> int:
    root = repo_root(args.repo)
    refuse_tracked(root)
    lenses = parse_lenses(args.lens)
    langs = parse_langs(args.langs)
    parts, sources = build_card(lenses, langs, args.max_chars)
    out_dir = Path(args.out_dir) if os.path.isabs(args.out_dir) else root / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    name = card_name(lenses)
    pattern = re.compile(r"^" + re.escape(name) + r"\.\d+\.md$")
    for old in out_dir.iterdir():
        if pattern.match(old.name):
            old.unlink()
    files = []
    for k, part in enumerate(parts, 1):
        path = out_dir / "{}.{}.md".format(name, k)
        write_text(path, part)
        files.append({"file": path.name, "sha256": sha(part), "chars": len(part)})
    manifest_path = out_dir / "manifest.json"
    manifest = PP.read_json_opt(manifest_path) or {}
    manifest[name] = {"parts": files, "sources": sources, "langs": list(langs),
                      "max_chars": args.max_chars}
    PP.write_json(manifest_path, dict(sorted(manifest.items())))
    chars = sum(f["chars"] for f in files)
    whole = hashlib.sha256("".join(parts).encode("utf-8")).hexdigest()
    print("card {}: {} parts, {:,} chars (~{:,} tokens), sha256 {}".format(
        name, len(parts), chars, int(chars / CHARS_PER_TOKEN), whole[:12]))
    for f in files:
        print("  {}".format(posix(str((out_dir / f["file"]).resolve()))))
    return 0


def check_card(root: Path, name: str) -> List[Path]:
    out_dir = root / ".harden" / "cards"
    manifest = (PP.read_json_opt(out_dir / "manifest.json") or {}).get(name)
    parts = sorted(out_dir.glob("{}.*.md".format(name)),
                   key=lambda p: int(p.name.rsplit(".", 2)[-2]) if p.name.rsplit(".", 2)[-2]
                   .isdigit() else 0)
    parts = [p for p in parts if re.match(r"^" + re.escape(name) + r"\.\d+\.md$", p.name)]
    if not parts or not isinstance(manifest, dict):
        raise CardError("no card for {}: run lens_card.py card --lens {} first".format(
            name, name.replace("+", ",")))
    recorded = {f.get("file"): f.get("sha256") for f in manifest.get("parts") or []}
    stale = [p.name for p in parts if recorded.get(p.name) != sha(read_ref(p))]
    if len(recorded) != len(parts):
        stale.append("part count")
    for rel, digest in (manifest.get("sources") or {}).items():
        try:
            if sha(read_ref(SKILL_DIR / rel)) != digest:
                stale.append(rel)
        except OSError:
            stale.append(rel)
    if stale:
        raise CardError("the card {} changed or its source did ({}): run lens_card.py card "
                        "--lens {} again".format(name, ", ".join(stale),
                                                 name.replace("+", ",")))
    return parts


def lens_abbrev(lens: str) -> str:
    if lens == EXPLORATION:
        return "ex"
    for line in read_ref(REFS / "lens-{}.md".format(lens)).split("\n"):
        m = RULE_HEAD_RE.match(line)
        if m:
            return m.group(1).split("-")[0].lower()
    return re.sub(r"[^a-z0-9]", "", lens)[:2]


def rule_ids(lenses: Sequence[str]) -> List[str]:
    ids: List[str] = []
    for lens in lenses:
        if lens == EXPLORATION:
            continue
        for line in read_ref(REFS / "lens-{}.md".format(lens)).split("\n"):
            m = RULE_HEAD_RE.match(line)
            if m and m.group(1) not in ids:
                ids.append(m.group(1))
    return ids


def make_pass_id(lenses: Sequence[str], unit: str, number: int) -> str:
    abbr = ".".join(lens_abbrev(x) for x in lenses)
    slug = re.sub(r"[^A-Za-z0-9._-]", "_", unit).strip("._-") or "unit"
    tail = "-p{}".format(number)
    pid = "{}-{}{}".format(abbr, slug, tail)
    if len(pid) > 80:
        digest = hashlib.sha1(unit.encode("utf-8")).hexdigest()[:6]
        room = 80 - len(abbr) - len(tail) - 2 - 7
        pid = "{}-{}-{}{}".format(abbr, slug[:room].rstrip("._-"), digest, tail)
    if not ID_RE.match(pid):
        raise CardError("cannot build a valid pass id from unit {!r}".format(unit))
    return pid


def load_ledger(root: Path) -> Dict[str, Any]:
    data = PP.read_json_opt(root / ".harden" / "tools" / "ledger.json")
    if data is None:
        raise CardError("no .harden/tools/ledger.json: run ledger.py init first")
    return data


def _key(path: str) -> str:
    text = posix(path).strip("/")
    return text.lower() if os.name == "nt" else text


def slice_entries(root: Path, args: argparse.Namespace) -> Tuple[str, List[Dict[str, Any]]]:
    """(unit label, [{"path", "ranges" or None, "lines", "est_tokens"}])."""
    ledger = load_ledger(root)
    rows = {_key(f.get("path", "")): f for f in ledger.get("files") or [] if isinstance(f, dict)}
    out: List[Dict[str, Any]] = []
    if args.slice_from:
        try:
            data = json.loads(Path(args.slice_from).read_text(encoding="utf-8-sig"))
        except (OSError, ValueError) as exc:
            raise CardError("cannot read --slice-from: {}".format(exc)) from exc
        if isinstance(data, dict):
            data = data.get("files_read") or data.get("files") or []
        for item in data if isinstance(data, list) else []:
            path = item if isinstance(item, str) else item.get("path") if isinstance(
                item, dict) else None
            if not isinstance(path, str):
                continue
            row = rows.get(_key(path))
            if row is None:
                raise CardError("{} is not an in-scope ledger file".format(path))
            ranges = item.get("ranges") if isinstance(item, dict) else None
            out.append({"path": row["path"], "ranges": ranges if ranges else None,
                        "lines": int(row.get("lines") or 0),
                        "est_tokens": int(row.get("est_tokens") or 0)})
        label = args.unit or "gaps of {}".format(posix(args.slice_from))
        return label, out
    unit = None
    for candidate in ledger.get("units") or []:
        if isinstance(candidate, dict) and _key(str(candidate.get("id"))) == _key(args.unit):
            unit = candidate
            break
    if unit is None:
        raise CardError("unknown unit {!r} in .harden/tools/ledger.json".format(args.unit))
    for f in unit.get("files") or []:
        ranges = f.get("ranges") if isinstance(f.get("ranges"), list) and f.get("ranges") \
            else None
        out.append({"path": f["path"], "ranges": ranges, "lines": int(f.get("lines") or 0),
                    "est_tokens": int(f.get("est_tokens") or 0)})
    return str(unit.get("id")), out


def slice_tokens(entry: Dict[str, Any]) -> int:
    if not entry["ranges"] or not entry["lines"]:
        return entry["est_tokens"]
    covered = sum(int(b) - int(a) + 1 for a, b in entry["ranges"])
    return int(round(entry["est_tokens"] * min(1.0, covered / entry["lines"])))


def fill(template: str, values: Dict[str, str]) -> str:
    text = template
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", value)
    if "{{" in text:
        raise CardError("assets/lens-pass-prompt.md holds an unknown placeholder")
    return text


def cmd_task(args: argparse.Namespace) -> int:
    root = repo_root(args.repo)
    refuse_tracked(root)
    lenses = parse_lenses(args.lens)
    if not args.unit and not args.slice_from:
        raise CardError("give --unit or --slice-from")
    if args.unseeded and args.context_file:
        raise CardError("the unseeded pass gets no orchestrator context (DT-21): drop "
                        "--context-file")
    if (args.unseeded or args.no_tools) and args.tools:
        raise CardError("--tools contradicts --unseeded and --no-tools")
    if not args.unseeded and not args.tools and not args.no_tools:
        raise CardError("name the tool outputs this lens reads (--tools F ...), or pass "
                        "--no-tools")
    label, entries = slice_entries(root, args)
    naming = args.unit or Path(args.slice_from).stem
    pass_id = args.pass_id or make_pass_id(lenses, naming, args.pass_number)
    if not ID_RE.match(pass_id):
        raise CardError("--pass-id must match [A-Za-z0-9][A-Za-z0-9._-]{0,79}")
    prompts = root / ".harden" / "prompts"
    dest = prompts / "{}.md".format(pass_id)
    if dest.exists() and not args.replace:
        raise CardError("{} exists: add --replace".format(posix(str(dest))))
    name = card_name(lenses)
    parts = check_card(root, name)
    card_chars = sum(len(read_ref(p)) for p in parts)
    schema_text = read_ref(SCHEMA)
    tools: List[Path] = []
    tool_chars = 0
    for raw in args.tools or []:
        path = Path(raw) if os.path.isabs(raw) else root / raw
        if not path.is_file():
            raise CardError("tool output {} does not exist".format(raw))
        tools.append(path)
        tool_chars += len(path.read_bytes().decode("utf-8", errors="replace"))
    slice_est = sum(slice_tokens(e) for e in entries)
    card_t = int(card_chars / CHARS_PER_TOKEN)
    schema_t = int(len(schema_text) / CHARS_PER_TOKEN)
    tools_t = int(tool_chars / CHARS_PER_TOKEN)
    estimate = card_t + schema_t + tools_t + slice_est + OVERHEAD + RESERVE
    if estimate > args.max_tokens:
        raise CardError("pass {} would need ~{:,} tokens (limit {:,}): split unit {} (ledger.py "
                        "unit) or pass --slice-from with ranges".format(
                            pass_id, estimate, args.max_tokens, label))
    context = "none"
    if args.context_file:
        try:
            context = Path(args.context_file).read_text(encoding="utf-8-sig").strip() or "none"
        except OSError as exc:
            raise CardError("cannot read --context-file: {}".format(exc)) from exc
    marker = PP.read_json_opt(root / ".harden" / "active") or {}
    abs_root = posix(str(root.resolve()))
    if args.unseeded:
        seeded_block = ("You are the unseeded pass: open nothing under .harden/ except this file "
                        "and the card; skip the Procedure's step that loads tool output and use "
                        "no prior findings.")
    elif tools:
        seeded_block = ("You may also read these tool outputs, in the same first message: {}. A "
                        "tool listed under not_run in triage.json did not run: treat it as not "
                        "run, never as clean. Tool leads are verification targets, not "
                        "findings.".format(", ".join(posix(str(t.resolve())) for t in tools)))
    else:
        seeded_block = ("No tool output is listed for this pass: skip the Procedure's step that "
                        "loads tool output.")
    classes = [c.strip() for c in (args.classes or "").split(",") if c.strip()] or \
        rule_ids(lenses)
    slice_lines: List[str] = []
    total_lines = 0
    for e in entries:
        if e["ranges"]:
            for a, b in e["ranges"]:
                slice_lines.append("{}:{}-{}".format(e["path"], a, b))
                total_lines += int(b) - int(a) + 1
        else:
            slice_lines.append("{} ({} lines)".format(e["path"], e["lines"]))
            total_lines += e["lines"]
    lens_text = ",".join(lenses)
    head = ["pass-id: {}".format(pass_id), "kind: lens", "lens: {}".format(lens_text),
            "unit: {}".format(label), "seeded: {}".format("no" if args.unseeded else "yes")]
    head += ["card: {}".format(posix(str(p.resolve()))) for p in parts]
    head += ["tool: {}".format(posix(str(t.resolve()))) for t in tools]
    head += ["schema: {}".format(posix(str(SCHEMA.resolve()))),
             "repository: {} (working tree = base commit {})".format(
                 abs_root, marker.get("base_sha") or "unknown"),
             "estimated_tokens: {}".format(estimate), ""]
    template = read_ref(PROMPT_TEMPLATE)
    template = re.sub(r"^<!--.*?-->\n", "", template, flags=re.S)
    body = fill(template, {
        "pass_id": pass_id,
        "lens_phrase": "the {} lens".format(lens_text) if len(lenses) == 1 else
        "the bundle of lenses {}".format(lens_text),
        "lens": lens_text, "seeded_block": seeded_block,
        "rule_ids": ", ".join(classes) or "any catalogue rule a defect fits",
        "context": context, "slice_count": str(len(entries)),
        "slice_lines": "{:,}".format(total_lines), "slice": "\n".join(slice_lines)})
    agent_line = "agent: harden-lens"
    if args.fallback:
        _front, lens_body = HA.split_front(HA.rendered("harden-lens"))
        body = body.replace("# Task\n", "# Standing instructions\n" + lens_body.strip("\n") +
                            "\n\n# Task\n", 1)
        agents = PP.read_json_opt(root / ".harden" / "agents.json") or {}
        fallback = agents.get("fallback_agent") or HA.fallback_agent(HA.agents_dir(None))
        agent_line = "agent: {}, model: {}".format(fallback, HA.template_model("harden-lens"))
    text = "\n".join(head) + "\n" + body
    write_text(dest, text)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    print(agent_line)
    print("prompt:")
    print("pass-id: {}".format(pass_id))
    print("Task file: {}/.harden/prompts/{}.md. Read it first and follow it exactly.".format(
        abs_root, pass_id))
    print("task: .harden/prompts/{}.md sha256 {} est {:,} tokens (card {:,}, slice {:,}, schema "
          "{:,}, tools {:,}, overhead {:,})".format(pass_id, digest[:12], estimate, card_t,
                                                    slice_est, schema_t, tools_t,
                                                    OVERHEAD + RESERVE))
    return 0


def cmd_refs(args: argparse.Namespace) -> int:
    root = repo_root(args.repo)
    refuse_tracked(root)
    out_dir = Path(args.out_dir) if os.path.isabs(args.out_dir) else root / args.out_dir
    manifest: Dict[str, Any] = {}
    for name in PROCESS_REFS:
        text = read_ref(REFS / "{}.md".format(name))
        full = "\n".join(strip_sources(text.split("\n")))
        steps = full.split("\n## Rules", 1)[0].rstrip("\n") + "\n"
        write_text(out_dir / "{}.md".format(name), full)
        write_text(out_dir / "{}.steps.md".format(name), steps)
        manifest[name] = {"source_sha256": sha(text), "sha256": sha(full),
                          "steps_sha256": sha(steps)}
        print("refs {}: {:,} chars; steps {:,} chars".format(name, len(full), len(steps)))
    PP.write_json(out_dir / "manifest.json", manifest)
    return 0


def rule_blocks() -> Dict[str, Tuple[str, List[str]]]:
    """rule id -> (reference file, the block's lines)."""
    found: Dict[str, Tuple[str, List[str]]] = {}
    for path in sorted(REFS.glob("*.md")):
        current: Optional[str] = None
        for line in read_ref(path).split("\n"):
            m = RULE_HEAD_RE.match(line)
            if m:
                current = m.group(1)
                found[current] = ("references/" + path.name, [line])
                continue
            if current is None:
                continue
            if line.startswith(("## ", "### ")):
                current = None
                continue
            found[current][1].append(line)
    return found


def cmd_show(args: argparse.Namespace) -> int:
    blocks = rule_blocks()
    wanted = [x.strip() for x in args.rules.split(",") if x.strip()]
    unknown = [x for x in wanted if x not in blocks]
    for rid in wanted:
        if rid in blocks:
            print("\n".join(strip_sources(blocks[rid][1])).rstrip("\n"))
            print("")
    if unknown:
        print("unknown rule id(s): {}".format(", ".join(unknown)), file=sys.stderr)
        return 1
    return 0


def cmd_sources(args: argparse.Namespace) -> int:
    root = repo_root(args.repo)
    blocks = rule_blocks()
    ids: List[str] = []
    if args.ids:
        ids = [x.strip() for x in args.ids.split(",") if x.strip()]
    else:
        data = PP.read_json_opt(Path(args.findings)) if Path(args.findings).is_absolute() else \
            PP.read_json_opt(root / args.findings)
        findings = data.get("findings") if isinstance(data, dict) else None
        if findings is None:
            try:
                findings = json.loads((root / args.findings).read_text(encoding="utf-8-sig"))
            except (OSError, ValueError) as exc:
                raise CardError("cannot read --findings: {}".format(exc)) from exc
        for item in findings if isinstance(findings, list) else []:
            ref = item.get("rule_ref") if isinstance(item, dict) else None
            if isinstance(ref, str) and not ref.startswith("project:") and ref not in ids:
                ids.append(ref)
    out: Dict[str, Any] = {}
    for rid in ids:
        if rid not in blocks:
            out[rid] = None
            continue
        rel, lines = blocks[rid]
        title = RULE_HEAD_RE.match(lines[0]).group(2)
        source = None
        for n, line in enumerate(lines):
            if SOURCE_RE.match(line):
                chunk = [line]
                for more in lines[n + 1:]:
                    if not more.strip() or more.startswith(("- **", "### ", "## ")):
                        break
                    chunk.append(more)
                source = " ".join(x.strip() for x in chunk)[len("- **Source:** "):]
                break
        out[rid] = {"title": title, "source": source, "file": rel}
    dest = Path(args.out) if os.path.isabs(args.out) else root / args.out
    PP.write_json(dest, out)
    print("sources: {} rule id(s) -> {}{}".format(
        len(out), posix(os.path.relpath(str(dest), str(root))),
        "; unknown: " + ", ".join(k for k, v in out.items() if v is None)
        if any(v is None for v in out.values()) else ""))
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="lens_card.py",
        description="Detector cards, lens-pass task files and Source-free references "
                    "(pilot-auto-calibration A01-F44, A01-F46).")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("card", help="build a lens's (or bundle's) detector card")
    p.add_argument("--lens", required=True)
    p.add_argument("--langs")
    p.add_argument("--out-dir", default=".harden/cards")
    p.add_argument("--max-chars", type=int, default=40000)
    p.add_argument("--repo", default=".")
    p = sub.add_parser("task", help="write a lens pass's task file and print its prompt")
    p.add_argument("--lens", required=True)
    p.add_argument("--unit")
    p.add_argument("--slice-from")
    p.add_argument("--pass", dest="pass_number", type=int, default=1)
    p.add_argument("--pass-id")
    seeding = p.add_mutually_exclusive_group()
    seeding.add_argument("--unseeded", action="store_true")
    seeding.add_argument("--no-tools", action="store_true")
    p.add_argument("--tools", nargs="+")
    p.add_argument("--context-file")
    p.add_argument("--classes")
    p.add_argument("--fallback", action="store_true")
    p.add_argument("--max-tokens", type=int, default=150000)
    p.add_argument("--replace", action="store_true")
    p.add_argument("--repo", default=".")
    p = sub.add_parser("refs", help="Source-free copies of the process references")
    p.add_argument("--out-dir", default=".harden/refs")
    p.add_argument("--repo", default=".")
    p = sub.add_parser("show", help="print rule blocks without their Source bullet")
    p.add_argument("--rules", required=True)
    p = sub.add_parser("sources", help="rule id -> Source bullet, for the report")
    which = p.add_mutually_exclusive_group(required=True)
    which.add_argument("--ids")
    which.add_argument("--findings")
    p.add_argument("--out", default=".harden/tools/rule-sources.json")
    p.add_argument("--repo", default=".")
    args = parser.parse_args(argv)
    handlers = {"card": cmd_card, "task": cmd_task, "refs": cmd_refs, "show": cmd_show,
                "sources": cmd_sources}
    try:
        return handlers[args.command](args)
    except (CardError, HA.AgentError, OSError) as exc:
        print("lens_card.py: {}".format(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
