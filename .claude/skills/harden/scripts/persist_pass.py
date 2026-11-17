#!/usr/bin/env python3
"""persist_pass.py - save and read back the reports of the /harden skill's own subagents.

Purpose
    The harden agents (assets/agents/harden-lens.md, harden-verifier.md, installed by
    harden_agents.py) run this script as their own Stop hook, which Claude Code delivers as
    SubagentStop with the subagent's final message in `last_assistant_message`
    (pilot-auto-calibration A01-F42). Hook mode saves that message byte for byte to
    .harden/passes/<pass-id>.md (a lens pass) or .harden/verifiers/<id>.md (a verifier), then
    blocks the stop once and asks the agent for the single line `pass-id: <id> saved`, so the
    report body never reaches the orchestrator's context and nobody re-types it. The file is
    named by the `pass-id:` line of the agent's first prompt, never by the report's own line,
    which repository text could steer.
    observe   reads the pass's own transcript: the models and effort of its requests, their
              usage, whether it compacted, and the exact line ranges its Read calls returned
              (A01-F43), and checks that it read every card and schema line of its task file
              (A01-F44); an unseeded pass that opened tool output under .harden/ and a verifier
              that ran a forbidden command are flagged (A01-F45).
    recover   extracts the last parsable report from a subagent transcript when the hook did
              not fire (the agents were not loaded: the fallback of detection step 8), never
              from the empty `tasks/<id>.output` file.
    collect   pools the candidates of every observed pass for clustering (detection step 9).
    missing   lists task files without a saved report: not launched, running or stopped.
    A report whose pass-id line follows a short preface (at most 40 lines and 8,000 characters
    before the object) is read from that line and recorded as id_line "after-preface", without
    a warning; only the prompt's own id matches, and the file is still named by the prompt
    (pilot-auto-calibration A01-F55).

CLI (python3 on macOS/Linux)
    python persist_pass.py                 hook mode: the SubagentStop JSON on stdin; always exit 0
    python persist_pass.py observe PASS_ID [--repo .] [--kind lens|verifier] [--json]
    python persist_pass.py recover --agent-id ID [--transcript PATH] [--kind lens|verifier]
                                   [--replace] [--repo .]
    python persist_pass.py collect [--repo .] [--out .harden/raw-candidates/all.json]
    python persist_pass.py missing [--repo .] [--all]

Files
    reads  the hook payload, the subagent transcript (agent_transcript_path, or
           <session transcript without .jsonl>/subagents/agent-<id>.jsonl from
           .harden/session.json), the task file .harden/prompts/<id>.md, .harden/active,
           .harden/tools/inscope.txt
    writes .harden/passes/<id>.md, .meta.json, .reads.json, .result.json (lens passes) and the
           same under .harden/verifiers/ (verifiers); <dir>/_unrouted/<agent>.md when the
           prompt cannot be read; .harden/passes/persist.log; .harden/raw-candidates/ (collect)

Exit codes
    hook     always 0 (a hook that fails never blocks the subagent; the report then reaches
             the orchestrator in full and `observe` exits 3)
    observe  0 complete; 1 incomplete (the report did not parse, the transcript is missing, a
             card or the schema was not read to its end); 3 not persisted; 2 usage error
    recover  0 written; 1 no report in the transcript; 2 transcript not found, or the file
             exists and --replace was not given
    collect  0
    missing  0 none missing; 1 some missing

Python 3.9+ standard library only; runs under `python -S`; the hook mode imports no sibling
module. Files are UTF-8 without BOM; a saved report keeps the message's own line ends.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import glob
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Sequence, Set, Tuple

sys.dont_write_bytecode = True

VERSION = 1
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
AGENT_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
PASS_LINE_RE = re.compile(r"^\s*pass-id:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,79})\s*$")
# A short preface before the pass-id line is tolerated (pilot-auto-calibration A01-F55): the
# third autonomous pilot's longest was 16 lines and 3,077 bytes.
PREFACE_MAX_LINES = 40
PREFACE_MAX_CHARS = 8000
TASK_LINE_RE = re.compile(r"^\s*Task file:\s*(.+?)(?:\.\s+Read it first.*)?\s*$")
NUMBERED_RE = re.compile(r"^\s*(\d+)(?:\t|" + chr(0x2192) + ")")
EMPTY_NOTICE_RE = re.compile(r"exists but its contents are empty", re.I)
PERSISTED_RE = re.compile(r"Full output saved to:\s*(.+?)\s*$", re.M)
KINDS = {"harden-lens": ("lens", "passes"), "harden-verifier": ("verifier", "verifiers")}
DIRS = {"lens": "passes", "verifier": "verifiers"}
PROMPT_SCAN_LINES = 200
RUNNING_SECONDS = 600
UNSEEDED_DIRS = (".harden/tools/", ".harden/passes/", ".harden/verifiers/", ".harden/candidates")
BOM = chr(0xFEFF)


class UsageError(Exception):
    """Bad arguments or unreadable input (exit 2)."""


# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------
def utc_iso(ts: Optional[float] = None) -> str:
    when = _dt.datetime.fromtimestamp(ts if ts is not None else time.time(), _dt.timezone.utc)
    return when.strftime("%Y-%m-%dT%H:%M:%SZ")


def posix(path: str) -> str:
    """Forward slashes; an MSYS path /c/x becomes C:/x."""
    text = str(path).replace("\\", "/")
    m = re.match(r"^/([A-Za-z])/(.*)$", text)
    if m:
        text = "{}:/{}".format(m.group(1).upper(), m.group(2))
    m = re.match(r"^([A-Za-z]):/", text)
    if m:
        text = m.group(1).upper() + text[1:]
    return text


def _fold(path: str) -> str:
    text = posix(path).rstrip("/")
    return text.lower() if (os.name == "nt" or re.match(r"^[A-Za-z]:/", text)) else text


def rel_to(root: Path, path: str) -> Optional[str]:
    """The repository-relative form of `path`, or None when it lies outside the root."""
    base = _fold(str(root))
    folded = _fold(path)
    if folded == base:
        return ""
    if folded.startswith(base + "/"):
        return posix(path).rstrip("/")[len(base) + 1:]
    return None


def locate_report(text: str) -> Tuple[Optional[int], List[Tuple[int, str]], List[str]]:
    """(index of the pass-id line the report object follows, or None; every pass-id line
    before the object as (index, id); the message's lines). Scans at most PREFACE_MAX_LINES
    lines and PREFACE_MAX_CHARS characters, and stops at the first line that starts the
    object ('{' or a ``` fence after leading blanks). The last pass-id line before the object
    is the report's (pilot-auto-calibration A01-F55)."""
    lines = text.lstrip(BOM).split("\n")
    seen: List[Tuple[int, str]] = []
    count = 0
    for index, raw in enumerate(lines):
        line = raw.rstrip("\r")
        if line.lstrip().startswith(("{", "```")):
            break
        match = PASS_LINE_RE.match(line)
        if match:
            seen.append((index, match.group(1)))
        count += len(raw) + 1
        if index >= PREFACE_MAX_LINES - 1 or count > PREFACE_MAX_CHARS:
            break
    chosen = seen[-1][0] if seen else None
    return chosen, seen, lines


def id_line_status(text: str, prompt_id: str, obj: Optional[Dict[str, Any]]
                   ) -> Tuple[str, Optional[int]]:
    """("match" | "after-preface" | "mismatch" | "missing", preface line count). Only the
    prompt's own id can match: any pass-id line before the object with another id, or an
    object whose "pass_id" differs, is a mismatch. The file is always named by the prompt's
    pass-id line, never by the message (A01-F42)."""
    chosen, seen, _lines = locate_report(text)
    if chosen is None:
        return "missing", None
    if {pid for _i, pid in seen} != {prompt_id}:
        return "mismatch", chosen
    if isinstance(obj, dict) and isinstance(obj.get("pass_id"), str) and \
            obj["pass_id"] != prompt_id:
        return "mismatch", chosen
    return ("match" if chosen == 0 else "after-preface"), chosen


def parse_report(text: str) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """(the id of the pass-id line the report follows, after a preface of at most
    PREFACE_MAX_LINES lines, or None; the report object or None)."""
    text = text.lstrip(BOM)
    chosen, seen, lines = locate_report(text)
    pass_id = dict(seen).get(chosen) if chosen is not None else None
    body = "\n".join(lines[chosen + 1:]) if chosen is not None else text
    candidates: List[str] = [body.strip()]
    fences = re.findall(r"```(?:json)?[ \t]*\r?\n(.*?)```", body, re.S)
    if fences:
        candidates.append(fences[-1].strip())
    first, last = body.find("{"), body.rfind("}")
    if first != -1 and last > first:
        candidates.append(body[first:last + 1])
    for chunk in candidates:
        if not chunk:
            continue
        try:
            obj = json.loads(chunk)
        except ValueError:
            continue
        if isinstance(obj, dict):
            return pass_id, obj
    return pass_id, None


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    parts: List[str] = []
    for block in content if isinstance(content, list) else []:
        if isinstance(block, dict) and block.get("type") == "text" and \
                isinstance(block.get("text"), str):
            parts.append(block["text"])
        elif isinstance(block, str):
            parts.append(block)
    return "\n".join(parts)


def iter_entries(path: Path, limit: Optional[int] = None) -> Iterator[Dict[str, Any]]:
    """The JSON objects of a JSONL transcript; unreadable lines are skipped."""
    try:
        handle = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with handle:
        for number, line in enumerate(handle):
            if limit is not None and number >= limit:
                break
            line = line.lstrip(BOM).strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if isinstance(entry, dict):
                yield entry


def read_prompt(transcript: Optional[Path]) -> Tuple[Optional[str], Optional[str]]:
    """(pass id, task file) from the first user message of a subagent transcript."""
    if transcript is None:
        return None, None
    for entry in iter_entries(transcript, PROMPT_SCAN_LINES):
        if entry.get("type") != "user":
            continue
        message = entry.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        text = _content_text(content).lstrip(BOM)
        lines = text.split("\n")
        match = PASS_LINE_RE.match(lines[0].rstrip("\r")) if lines else None
        pass_id = match.group(1) if match else None
        task = None
        if len(lines) > 1:
            tmatch = TASK_LINE_RE.match(lines[1].rstrip("\r"))
            if tmatch:
                task = tmatch.group(1).strip()
        return pass_id, task
    return None, None


def find_root(task_file: Optional[str], cwd: Optional[str]) -> Optional[Path]:
    """The run's repository: every branch requires <root>/.harden/active."""
    if task_file:
        task = Path(posix(task_file))
        if task.parent.name == "prompts" and task.parent.parent.name == ".harden":
            root = task.parent.parent.parent
            if (root / ".harden" / "active").is_file():
                return root
    if cwd:
        here = Path(posix(cwd))
        for candidate in [here] + list(here.parents):
            if (candidate / ".git").exists():
                if (candidate / ".harden" / "active").is_file():
                    return candidate
                break
    project = os.environ.get("CLAUDE_PROJECT_DIR")
    if project and (Path(posix(project)) / ".harden" / "active").is_file():
        return Path(posix(project))
    return None


def read_json_opt(path: Path) -> Optional[Dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def write_bytes_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(4):
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", dir=str(path.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, str(path))
            return
        except PermissionError:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            if attempt == 3:
                raise
            time.sleep(0.1)


def write_json(path: Path, data: Any) -> None:
    write_bytes_atomic(path, (json.dumps(data, indent=2, ensure_ascii=True) + "\n")
                       .encode("ascii"))


def encode_message(message: str) -> Tuple[bytes, bool]:
    """UTF-8 bytes of the message; lone surrogates are replaced and reported as lossy."""
    try:
        return message.encode("utf-8"), False
    except UnicodeEncodeError:
        return message.encode("utf-8", errors="replace"), True


def log_line(root: Path, event: str, kind: str, pass_id: str, agent: Optional[str],
             action: str, size: int) -> None:
    try:
        path = root / ".harden" / "passes" / "persist.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        line = "{} {} {} {} {} {} {}\n".format(utc_iso(), event or "-", kind, pass_id or "-",
                                              agent or "-", action, size)
        with open(path, "a", encoding="utf-8", newline="\n") as handle:
            handle.write(line)
    except OSError:
        pass


def log_error(root: Optional[Path], exc: BaseException) -> None:
    if root is None:
        return
    try:
        with open(root / ".harden" / "hook_errors.log", "a", encoding="utf-8",
                  newline="\n") as handle:
            handle.write("{} persist_pass.py {}: {}\n".format(
                utc_iso(), type(exc).__name__, str(exc).replace("\n", " ")[:300]))
    except OSError:
        pass


# ---------------------------------------------------------------------------
# hook mode
# ---------------------------------------------------------------------------
def _block(reason: str) -> str:
    return json.dumps({"decision": "block", "reason": reason}, ensure_ascii=True)


def ack_reason(rel: str, pass_id: str) -> str:
    return ("The harness saved your report as {}. Reply now with exactly this line and nothing "
            "else: pass-id: {} saved".format(rel, pass_id))


def format_reason(pass_id: str) -> str:
    return ("Your final message could not be read. It must be the line pass-id: {} followed by "
            "exactly one JSON object, as your task file specifies, and nothing else. Send that "
            "final message again now, complete.".format(pass_id))


def hook(stdin_bytes: bytes) -> Tuple[int, str]:
    """(exit code, stdout) of hook mode; never raises."""
    root: Optional[Path] = None
    try:
        text = stdin_bytes.decode("utf-8", errors="replace").lstrip(BOM)
        try:
            payload = json.loads(text) if text.strip() else None
        except ValueError:
            return 0, ""
        if not isinstance(payload, dict):
            return 0, ""
        if payload.get("hook_event_name") not in ("SubagentStop", "Stop"):
            return 0, ""
        agent_type = payload.get("agent_type")
        if not isinstance(agent_type, str) or agent_type not in KINDS:
            return 0, ""
        kind, dirname = KINDS[agent_type]
        message = payload.get("last_assistant_message")
        if not isinstance(message, str):
            return 0, ""
        transcript_raw = payload.get("agent_transcript_path")
        transcript = Path(posix(transcript_raw)) if isinstance(transcript_raw, str) and \
            transcript_raw.strip() else None
        if transcript is not None and not transcript.is_file():
            transcript = None
        prompt_id, task_file = read_prompt(transcript)
        cwd = payload.get("cwd") if isinstance(payload.get("cwd"), str) else None
        root = find_root(task_file, cwd)
        if root is None:
            return 0, ""
        agent = payload.get("agent_id") if isinstance(payload.get("agent_id"), str) and \
            AGENT_RE.match(payload.get("agent_id") or "") else None
        event = str(payload.get("hook_event_name"))
        data, lossy = encode_message(message)
        outdir = root / ".harden" / dirname
        msg_id, _obj = parse_report(message)
        if not prompt_id or not ID_RE.match(prompt_id):
            name = agent or utc_iso().replace(":", "")
            write_bytes_atomic(outdir / "_unrouted" / "{}.md".format(name), data)
            log_line(root, event, kind, msg_id, agent, "unrouted", len(data))
            return 0, ""
        pass_id = prompt_id
        id_line, preface = id_line_status(message, pass_id, _obj)
        dest = outdir / "{}.md".format(pass_id)
        meta_path = outdir / "{}.meta.json".format(pass_id)
        rel = ".harden/{}/{}.md".format(dirname, pass_id)
        sha = hashlib.sha256(data).hexdigest()
        meta = read_json_opt(meta_path) or {}
        parsed = _obj is not None and (kind == "verifier" or isinstance(
            _obj.get("candidates"), list))
        base_meta = {
            "version": VERSION, "pass_id": pass_id, "kind": kind, "agent_id": agent,
            "agent_type": agent_type, "agent_transcript_path":
                posix(transcript_raw) if isinstance(transcript_raw, str) else None,
            "session_id": payload.get("session_id"), "source": "hook",
            "persisted_at": utc_iso(), "message_sha256": sha, "message_bytes": len(data),
            "id_line": id_line, "preface_lines": preface, "prompt_pass_id": prompt_id,
            "message_pass_id": msg_id,
            "task_file": posix(task_file) if task_file else None, "parsed": parsed,
            "versions": [], "ack": None, "format_retry": False, "observed": None}
        if lossy:
            base_meta["lossy"] = True
        # The stop after a block carries stop_hook_active. The acknowledgement line itself also
        # ends it: a payload without the flag must not turn `pass-id: <id> saved` into a new
        # version and block the agent again, turn after turn, until maxTurns.
        is_ack = dest.is_file() and message.strip() == "pass-id: {} saved".format(pass_id)
        if payload.get("stop_hook_active") is True or is_ack:
            if dest.is_file():
                meta = meta or dict(base_meta)
                meta["ack"] = message[:200]
                write_json(meta_path, meta)
                log_line(root, event, kind, pass_id, agent, "ack", len(data))
                return 0, ""
            write_bytes_atomic(dest, data)
            base_meta["format_retry"] = True
            write_json(meta_path, base_meta)
            log_line(root, event, kind, pass_id, agent, "format-retry", len(data))
            return 0, ""
        if dest.is_file():
            if hashlib.sha256(dest.read_bytes()).hexdigest() == sha:
                log_line(root, event, kind, pass_id, agent, "same", len(data))
                return 0, _block(ack_reason(rel, pass_id))
            n = 2
            while (outdir / "{}.v{}.md".format(pass_id, n)).exists():
                n += 1
            version = outdir / "{}.v{}.md".format(pass_id, n)
            write_bytes_atomic(version, data)
            meta = meta or dict(base_meta)
            meta.setdefault("versions", []).append(version.name)
            write_json(meta_path, meta)
            log_line(root, event, kind, pass_id, agent, "version-{}".format(n), len(data))
            return 0, _block(ack_reason(rel, pass_id))
        if _obj is not None:
            write_bytes_atomic(dest, data)
            write_json(meta_path, base_meta)
            log_line(root, event, kind, pass_id, agent, "saved", len(data))
            return 0, _block(ack_reason(rel, pass_id))
        write_bytes_atomic(outdir / "{}.unparsed.md".format(pass_id), data)
        base_meta["parsed"] = False
        write_json(meta_path, base_meta)
        log_line(root, event, kind, pass_id, agent, "unparsed", len(data))
        return 0, _block(format_reason(pass_id))
    except Exception as exc:  # noqa: BLE001 - a hook never blocks on its own failure
        log_error(root, exc)
        return 0, ""


# ---------------------------------------------------------------------------
# observe
# ---------------------------------------------------------------------------
def task_lines(task_file: Optional[str]) -> Dict[str, List[str]]:
    """`key: value` header lines of a task file (card, schema, tool, seeded, kind, ...)."""
    out: Dict[str, List[str]] = {}
    if not task_file:
        return out
    try:
        text = Path(posix(task_file)).read_text(encoding="utf-8-sig")
    except OSError:
        return out
    for line in text.split("\n"):
        line = line.rstrip("\r")
        if not line.strip() or line.startswith("#"):
            if line.startswith("#"):
                break
            continue
        m = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if m:
            out.setdefault(m.group(1), []).append(m.group(2).strip())
    return out


def _result_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    parts: List[str] = []
    for block in content if isinstance(content, list) else []:
        if isinstance(block, dict):
            if isinstance(block.get("text"), str):
                parts.append(block["text"])
        elif isinstance(block, str):
            parts.append(block)
    return "\n".join(parts)


def numbered_lines(text: str) -> Set[int]:
    found: Set[int] = set()
    for line in text.split("\n"):
        m = NUMBERED_RE.match(line)
        if m:
            found.add(int(m.group(1)))
    return found


def merge(numbers: Set[int]) -> List[List[int]]:
    ranges: List[List[int]] = []
    for n in sorted(numbers):
        if ranges and n == ranges[-1][1] + 1:
            ranges[-1][1] = n
        else:
            ranges.append([n, n])
    return ranges


def line_count(path: Path) -> Optional[int]:
    try:
        text = path.read_bytes().decode("utf-8", errors="replace")
    except OSError:
        return None
    if text == "":
        return 0
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.count("\n") + (0 if text.endswith("\n") else 1)


def scan_transcript(path: Path) -> Dict[str, Any]:
    """Models, effort, usage, compaction, tool calls and results of a subagent transcript."""
    models: Dict[str, int] = {}
    efforts: Set[str] = set()
    seen_ids: Set[str] = set()
    usage = {"input_tokens": 0, "cache_read_input_tokens": 0,
             "cache_creation_input_tokens": 0, "output_tokens": 0}
    compacted = False
    stamps: List[str] = []
    calls: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    results: Dict[str, Dict[str, Any]] = {}
    texts: List[str] = []
    last_stop: Optional[str] = None
    snapshots: List[str] = []
    for entry in iter_entries(path):
        ts = entry.get("timestamp")
        if isinstance(ts, str):
            stamps.append(ts)
        etype = entry.get("type")
        if etype == "system" and entry.get("subtype") == "compact_boundary":
            compacted = True
        if etype == "attachment":
            att = entry.get("attachment")
            if isinstance(att, dict) and att.get("type") == "prompt_snapshot":
                snapshots.append(json.dumps(att, ensure_ascii=False))
        if etype == "assistant":
            if isinstance(entry.get("effort"), str):
                efforts.add(entry["effort"])
            message = entry.get("message")
            if not isinstance(message, dict):
                continue
            model = message.get("model")
            mid = message.get("id") if isinstance(message.get("id"), str) else None
            key = mid or "entry-{}".format(len(seen_ids) + len(order) + len(stamps))
            if key not in seen_ids:
                seen_ids.add(key)
                if isinstance(model, str) and model and model != "<synthetic>":
                    models[model] = models.get(model, 0) + 1
                use = message.get("usage")
                if isinstance(use, dict):
                    for field in usage:
                        value = use.get(field)
                        if isinstance(value, int):
                            usage[field] += value
            if isinstance(message.get("stop_reason"), str):
                last_stop = message["stop_reason"]
            for block in message.get("content") if isinstance(message.get("content"),
                                                                list) else []:
                if not isinstance(block, dict):
                    continue
                if block.get("type") == "tool_use" and isinstance(block.get("id"), str):
                    calls[block["id"]] = {"name": block.get("name"),
                                          "input": block.get("input") or {}}
                    order.append(block["id"])
                elif block.get("type") == "text" and isinstance(block.get("text"), str):
                    texts.append(block["text"])
        elif etype == "user":
            message = entry.get("message")
            content = message.get("content") if isinstance(message, dict) else None
            for block in content if isinstance(content, list) else []:
                if isinstance(block, dict) and block.get("type") == "tool_result" and \
                        isinstance(block.get("tool_use_id"), str):
                    results[block["tool_use_id"]] = {
                        "text": _result_text(block.get("content")),
                        "is_error": bool(block.get("is_error"))}
    model = max(models, key=lambda m: (models[m], m)) if models else None
    return {"models": models, "model": model, "effort": sorted(efforts),
            "requests": len(seen_ids), "usage": usage, "compacted": compacted,
            "started": stamps[0] if stamps else None, "ended": stamps[-1] if stamps else None,
            "last_stop_reason": last_stop, "calls": calls, "order": order,
            "results": results, "texts": texts, "prompt_snapshots": snapshots}


def read_result_lines(result: Dict[str, Any]) -> Tuple[Set[int], bool]:
    """(line numbers a Read result delivered, whether it announced an empty file)."""
    text = result.get("text") or ""
    lines = numbered_lines(text)
    if not lines:
        m = PERSISTED_RE.search(text)
        if m:
            try:
                lines = numbered_lines(Path(posix(m.group(1))).read_text(
                    encoding="utf-8", errors="replace"))
            except OSError:
                lines = set()
    return lines, bool(EMPTY_NOTICE_RE.search(text))


def inscope_set(root: Path) -> Optional[Set[str]]:
    path = root / ".harden" / "tools" / "inscope.txt"
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError:
        return None
    return {_fold(line.strip()) for line in text.split("\n") if line.strip()}


def observe(pass_id: str, root: Path, kind: Optional[str] = None
            ) -> Tuple[int, List[str], Dict[str, Any]]:
    """(exit code, printed lines, observed record) for one saved report."""
    if not ID_RE.match(pass_id or ""):
        raise UsageError("pass id {!r} is not valid".format(pass_id))
    kinds = [kind] if kind else ["lens", "verifier"]
    outdir: Optional[Path] = None
    for k in kinds:
        d = root / ".harden" / DIRS[k]
        if (d / "{}.md".format(pass_id)).is_file() or (d / "{}.meta.json".format(
                pass_id)).is_file():
            outdir, kind = d, k
            break
    if outdir is None or kind is None:
        return 3, ["{}: not persisted; run persist_pass.py recover --agent-id <agent id from the "
                   "launch or the notification>".format(pass_id)], {}
    meta_path = outdir / "{}.meta.json".format(pass_id)
    meta = read_json_opt(meta_path) or {"pass_id": pass_id, "kind": kind, "source": "unknown"}
    report = outdir / "{}.md".format(pass_id)
    observed: Dict[str, Any] = {"observed_at": utc_iso(), "complete": False, "reasons": []}
    warnings: List[str] = []
    transcript_raw = meta.get("agent_transcript_path")
    transcript = Path(posix(transcript_raw)) if isinstance(transcript_raw, str) else None
    if transcript is None or not transcript.is_file():
        observed["reasons"].append("transcript not found")
        meta["observed"] = observed
        write_json(meta_path, meta)
        return 1, ["{}: incomplete; transcript not found ({})".format(
            pass_id, transcript_raw or "no agent_transcript_path in the meta")], observed
    scan = scan_transcript(transcript)
    for key in ("models", "model", "effort", "requests", "usage", "compacted", "started",
                "ended", "last_stop_reason"):
        observed[key] = scan[key]
    markers = sorted(set(re.findall(r"harden-agent-template: (harden-[a-z]+ v\d+)",
                                    " ".join(scan["prompt_snapshots"]))))
    observed["prompt_snapshot"] = bool(scan["prompt_snapshots"])
    observed["definition_markers"] = markers
    task = meta.get("task_file")
    header = task_lines(task)
    # Reads (lens passes): the line numbers each Read result delivered.
    per_file: Dict[str, Set[int]] = {}
    whole: Set[str] = set()
    raw_paths: Dict[str, str] = {}
    for cid in scan["order"]:
        call = scan["calls"][cid]
        if call.get("name") != "Read":
            continue
        file_path = call["input"].get("file_path") if isinstance(call["input"], dict) else None
        result = scan["results"].get(cid)
        if not isinstance(file_path, str) or result is None or result.get("is_error"):
            continue
        lines, empty = read_result_lines(result)
        key = _fold(file_path)
        raw_paths.setdefault(key, posix(file_path))
        if empty or (not lines and file_path.lower().endswith(".ipynb") and
                     (result.get("text") or "").strip()):
            whole.add(key)
            continue
        per_file.setdefault(key, set()).update(lines)
    inscope = inscope_set(root)
    files_read: List[Any] = []
    support: List[str] = []
    outside: List[str] = []
    out_scope: List[str] = []
    total_lines = 0
    for key in sorted(set(per_file) | whole):
        rel = rel_to(root, raw_paths[key])
        if rel is None:
            outside.append(raw_paths[key])
            continue
        if rel == ".harden" or rel.startswith(".harden/"):
            support.append(rel)
            continue
        if inscope is not None and _fold(rel) not in inscope:
            out_scope.append(rel)
            continue
        if key in whole:
            files_read.append(rel)
        else:
            ranges = merge(per_file[key])
            total_lines += sum(b - a + 1 for a, b in ranges)
            files_read.append({"path": rel, "ranges": ranges})
    reasons: List[str] = observed["reasons"]
    if kind == "lens":
        reads_path = outdir / "{}.reads.json".format(pass_id)
        write_json(reads_path, {"files_read": files_read, "source": "transcript",
                                "pass_id": pass_id, "support_reads": support,
                                "outside_repo_reads": outside, "out_of_scope_reads": out_scope})
        observed["reads_path"] = ".harden/{}/{}.reads.json".format(DIRS[kind], pass_id)
        observed["files"] = len(files_read)
        observed["lines"] = total_lines
        observed["support_reads"] = support
        observed["outside_repo_reads"] = outside
        observed["out_of_scope_reads"] = out_scope
        # Every card part and the schema read to their end (A01-F44).
        for key, label in (("card", "card"), ("schema", "schema"), ("tool", "tool")):
            for value in header.get(key, []):
                path = Path(posix(value))
                need = line_count(path)
                got = per_file.get(_fold(str(path)), set())
                if need is None:
                    continue
                if (need == 0 and _fold(str(path)) in whole) or \
                        set(range(1, need + 1)) <= got:
                    continue
                if label == "tool":
                    warnings.append("WARN: {}: tool output {} was not read to its end".format(
                        pass_id, posix(value)))
                    continue
                reasons.append("{} not fully read".format(label))
                warnings.append("WARN: {}: {} {} not fully read ({} of {} lines)".format(
                    pass_id, label, posix(value), len(got & set(range(1, need + 1))), need))
        # An unseeded pass that opened tool output or prior results (DT-21).
        if (header.get("seeded") or [""])[0].lower().startswith("no"):
            violations = [s for s in support if any(s.startswith(d) or s == d.rstrip("/")
                                                    for d in UNSEEDED_DIRS)]
            allowed = {_fold(v) for v in header.get("card", [])}
            if task:
                allowed.add(_fold(task))
            for cid in scan["order"]:
                call = scan["calls"][cid]
                if call.get("name") not in ("Grep", "Glob") or \
                        not isinstance(call["input"], dict):
                    continue
                for field in ("path", "pattern"):
                    value = call["input"].get(field)
                    if not isinstance(value, str) or ".harden" not in value.replace("\\", "/"):
                        continue
                    norm = posix(value)
                    target = norm if re.match(r"^(?:[A-Za-z]:)?/", norm) else \
                        posix(str(root / norm))
                    rel = rel_to(root, target)
                    probe = "/" + (rel if rel is not None else norm) + "/"
                    if "/.harden/" not in probe or "/.harden/cards" in probe or \
                            _fold(target) in allowed:
                        continue
                    violations.append("{} {}={}".format(call.get("name"), field, value))
            observed["unseeded_violations"] = violations
            if violations:
                warnings.append("WARN: {}: the unseeded pass opened {}: it counts as seeded "
                                "(DT-21)".format(pass_id, "; ".join(violations[:5])))
    else:
        observed["forbidden_ran"] = verifier_audit(root, scan)
        for cmd in observed["forbidden_ran"]:
            warnings.append("WARN: forbidden command ran in verifier {}: {}".format(pass_id, cmd))
    # The report itself.
    try:
        message = report.read_bytes().decode("utf-8", errors="replace")
    except OSError:
        message = None
    obj = None
    if message is None:
        reasons.append("report file missing")
    else:
        _mid, obj = parse_report(message)
        if obj is None:
            reasons.append("report did not parse")
        else:
            write_json(outdir / "{}.result.json".format(pass_id), obj)
            if kind == "lens" and not isinstance(obj.get("candidates"), list):
                reasons.append("report has no candidates list")
        said = message.strip()
        if said and said not in "".join(scan["texts"]) and \
                said not in "\n".join(scan["texts"]):
            warnings.append("WARN: {}: the saved message is not among the transcript's "
                            "assistant texts (transcript lag or an edited file)".format(pass_id))
    observed["candidates"] = len(obj.get("candidates") or []) if isinstance(obj, dict) and \
        isinstance(obj.get("candidates"), list) else None
    observed["complete"] = not reasons
    if len(scan["models"]) > 1:
        warnings.append("WARN: {}: more than one model: {}".format(
            pass_id, ", ".join(sorted(scan["models"]))))
    if meta.get("id_line") not in (None, "match", "after-preface"):
        warnings.append("WARN: {}: id line {}".format(pass_id, meta.get("id_line")))
    if scan["last_stop_reason"] not in (None, "end_turn"):
        warnings.append("WARN: {}: last stop reason {} (maxTurns reached?)".format(
            pass_id, scan["last_stop_reason"]))
    meta["observed"] = observed
    write_json(meta_path, meta)
    head = "{}: {}; model {} ({} requests), effort {}".format(
        pass_id, "complete" if observed["complete"] else "incomplete (" +
        "; ".join(reasons) + ")", scan["model"] or "unknown", scan["requests"],
        ",".join(scan["effort"]) or "n/a")
    if kind == "lens":
        head += "; reads {} files / {:,} lines -> {}".format(
            len(files_read), total_lines, observed["reads_path"])
    head += "; compacted {}".format("yes" if scan["compacted"] else "no")
    if observed["candidates"] is not None:
        head += "; {} candidates".format(observed["candidates"])
    head += "; persisted by {}".format(meta.get("source") or "unknown")
    return (0 if observed["complete"] else 1), [head] + warnings, observed


def verifier_audit(root: Path, scan: Dict[str, Any]) -> List[str]:
    """Bash commands a verifier ran (not refused by a hook) that match the run's bans."""
    marker = read_json_opt(root / ".harden" / "active") or {}
    bans = [b for b in marker.get("forbidden_commands") or [] if isinstance(b, str)]
    ran: List[str] = []
    commands: List[str] = []
    for cid in scan["order"]:
        call = scan["calls"][cid]
        if call.get("name") not in ("Bash", "PowerShell") or not isinstance(call["input"], dict):
            continue
        command = call["input"].get("command")
        result = scan["results"].get(cid) or {}
        text = (result.get("text") or "").lower()
        refused = result.get("is_error") and ("/harden" in text or "hook" in text)
        if isinstance(command, str) and not refused:
            commands.append(command)
    if not bans or not commands:
        return ran
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    import validate_profile as vp  # noqa: E402  (lazy: observe mode only)
    patterns, _problems = vp.compile_patterns(bans)
    for command in commands:
        if vp.forbidden_match(command, patterns) is not None:
            ran.append(command[:200])
    return ran


# ---------------------------------------------------------------------------
# recover, collect, missing
# ---------------------------------------------------------------------------
def config_dir() -> Path:
    raw = os.environ.get("CLAUDE_CONFIG_DIR")
    return Path(posix(raw)) if raw else Path.home() / ".claude"


def session_transcript(root: Path) -> Optional[Path]:
    data = read_json_opt(root / ".harden" / "session.json") or {}
    value = data.get("transcript_path")
    return Path(posix(value)) if isinstance(value, str) and value.strip() else None


def find_transcript(root: Path, agent: str, explicit: Optional[str]) -> Optional[Path]:
    name = "agent-{}.jsonl".format(agent)
    candidates: List[Path] = []
    if explicit:
        candidates.append(Path(posix(explicit)))
    for dirname in DIRS.values():
        for meta_path in sorted((root / ".harden" / dirname).glob("*.meta.json")):
            meta = read_json_opt(meta_path) or {}
            value = meta.get("agent_transcript_path")
            if isinstance(value, str) and value:
                candidates.append(Path(posix(value)).parent / name)
    main = session_transcript(root)
    if main is not None:
        candidates.append(main.parent / main.stem / "subagents" / name)
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    found = glob.glob(str(config_dir() / "projects" / "*" / "*" / "subagents" / name))
    found.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return Path(found[0]) if found else None


def last_report(transcript: Path) -> Optional[str]:
    """The newest assistant message (text blocks joined, or a SubagentHandback message) that
    parses as a report; an acknowledgement line is skipped."""
    messages: List[Tuple[str, List[str]]] = []
    index: Dict[str, int] = {}
    for entry in iter_entries(transcript):
        if entry.get("type") != "assistant":
            continue
        message = entry.get("message")
        if not isinstance(message, dict):
            continue
        mid = message.get("id") if isinstance(message.get("id"), str) else \
            "anon-{}".format(len(messages))
        if mid not in index:
            index[mid] = len(messages)
            messages.append((mid, []))
        parts = messages[index[mid]][1]
        content = message.get("content")
        if isinstance(content, str):
            parts.append(content)
            continue
        for block in content if isinstance(content, list) else []:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif block.get("type") == "tool_use" and block.get("name") == "SubagentHandback":
                inp = block.get("input")
                if isinstance(inp, dict) and isinstance(inp.get("message"), str):
                    parts.append(inp["message"])
    for _mid, parts in reversed(messages):
        text = "\n".join(parts)
        if text.strip() and parse_report(text)[1] is not None:
            return text
    return None


def cmd_recover(args: argparse.Namespace, root: Path) -> int:
    agent = (args.agent_id or "").strip()
    if not AGENT_RE.match(agent):
        raise UsageError("--agent-id must be the agent id of the launch (letters, digits, _ -)")
    transcript = find_transcript(root, agent, args.transcript)
    if transcript is None:
        print("agent {}: transcript not found (never the tasks/<id>.output file, which is "
              "empty)".format(agent), file=sys.stderr)
        return 2
    prompt_id, task_file = read_prompt(transcript)
    if not prompt_id or not ID_RE.match(prompt_id):
        print("agent {}: its first prompt has no pass-id line".format(agent), file=sys.stderr)
        return 2
    kind = args.kind
    agent_type = None
    meta_side = read_json_opt(transcript.with_name("agent-{}.meta.json".format(agent))) or {}
    if isinstance(meta_side.get("agentType"), str):
        agent_type = meta_side["agentType"]
    if kind is None and agent_type in KINDS:
        kind = KINDS[agent_type][0]
    if kind is None:
        kinds = task_lines(task_file).get("kind") or []
        kind = kinds[0] if kinds and kinds[0] in DIRS else None
    if kind is None:
        raise UsageError("cannot tell lens from verifier: pass --kind")
    outdir = root / ".harden" / DIRS[kind]
    dest = outdir / "{}.md".format(prompt_id)
    if dest.exists() and not args.replace:
        print("{} exists: add --replace".format(posix(str(dest))), file=sys.stderr)
        return 2
    text = last_report(transcript)
    if text is None:
        print("agent {} (pass {}): no parsable report in its transcript; start the pass again"
              .format(agent, prompt_id))
        return 1
    data, lossy = encode_message(text)
    write_bytes_atomic(dest, data)
    msg_id, obj = parse_report(text)
    id_line, preface = id_line_status(text, prompt_id, obj)
    meta = {"version": VERSION, "pass_id": prompt_id, "kind": kind, "agent_id": agent,
            "agent_type": agent_type, "agent_transcript_path": posix(str(transcript)),
            "session_id": None, "source": "transcript", "persisted_at": utc_iso(),
            "message_sha256": hashlib.sha256(data).hexdigest(), "message_bytes": len(data),
            "id_line": id_line, "preface_lines": preface,
            "prompt_pass_id": prompt_id, "message_pass_id": msg_id,
            "task_file": posix(task_file) if task_file else None, "parsed": obj is not None,
            "versions": [], "ack": None, "format_retry": False, "observed": None}
    if lossy:
        meta["lossy"] = True
    write_json(outdir / "{}.meta.json".format(prompt_id), meta)
    log_line(root, "recover", kind, prompt_id, agent, "recovered", len(data))
    print("recovered {}: {} bytes from {} -> .harden/{}/{}.md; run persist_pass.py observe {}"
          .format(prompt_id, len(data), transcript.name, DIRS[kind], prompt_id, prompt_id))
    return 0


def _cell(value: Any, limit: int = 0) -> str:
    text = str(value if value is not None else "").replace("\t", " ").replace("\r", " ") \
        .replace("\n", " ").replace("<", "&lt;")
    if re.match(r"^\s*(Human|Assistant):", text):
        text = "\\" + text
    return text[:limit] if limit else text


def cmd_collect(args: argparse.Namespace, root: Path) -> int:
    passes_dir = root / ".harden" / "passes"
    out = Path(args.out) if args.out else root / ".harden" / "raw-candidates" / "all.json"
    if not out.is_absolute():
        out = root / out
    pooled: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    names: List[str] = []
    for path in sorted(passes_dir.glob("*.result.json")):
        pass_id = path.name[:-len(".result.json")]
        if pass_id.startswith("probe-"):
            continue
        obj = read_json_opt(path) or {}
        cands = obj.get("candidates") if isinstance(obj.get("candidates"), list) else []
        names.append(pass_id)
        for n, cand in enumerate(cands, 1):
            if not isinstance(cand, dict):
                continue
            raw = cand.get("id") if isinstance(cand.get("id"), str) and cand.get("id") else \
                "{}-{}".format(pass_id, n)
            base, k = raw, 2
            while raw in seen:
                raw = "{}.{}".format(base, k)
                k += 1
            seen.add(raw)
            lens = cand.get("lens") if isinstance(cand.get("lens"), str) else obj.get("lens")
            item = dict(cand, raw_id=raw, pass_id=pass_id, lens=lens if isinstance(lens, str)
                        else "unknown")
            pooled.append(item)
    write_json(out, {"generated": utc_iso(), "passes": names, "candidates": pooled})
    tables: Dict[str, List[Dict[str, Any]]] = {}
    for item in pooled:
        tables.setdefault(re.sub(r"[^A-Za-z0-9._-]", "_", item["lens"]), []).append(item)
    for lens, items in sorted(tables.items()):
        rows = ["raw_id\tpass\trule_ref\tfile:line\tseverity\ttitle"]
        for item in items:
            rows.append("\t".join([_cell(item["raw_id"]), _cell(item["pass_id"]),
                                   _cell(item.get("rule_ref")),
                                   _cell("{}:{}".format(item.get("file"), item.get("line"))),
                                   _cell(item.get("severity")), _cell(item.get("title"), 80)]))
        write_bytes_atomic(out.parent / "{}.tsv".format(lens),
                           ("\n".join(rows) + "\n").encode("utf-8"))
    print("collect: {} candidates from {} passes -> {} ({})".format(
        len(pooled), len(names), posix(os.path.relpath(str(out), str(root))),
        ", ".join("{} {}".format(k, len(v)) for k, v in sorted(tables.items())) or "none"))
    return 0


def cmd_missing(args: argparse.Namespace, root: Path) -> int:
    prompts = root / ".harden" / "prompts"
    missing: List[Tuple[str, Path]] = []
    for path in sorted(prompts.glob("*.md")):
        try:
            first = path.read_text(encoding="utf-8-sig").split("\n", 1)[0]
        except OSError:
            continue
        m = PASS_LINE_RE.match(first.rstrip("\r"))
        if not m:
            continue
        pass_id = m.group(1)
        if pass_id.startswith("probe-") and not args.all:
            continue
        if any((root / ".harden" / d / "{}.md".format(pass_id)).is_file()
               for d in DIRS.values()):
            continue
        missing.append((pass_id, path))
    if not missing:
        print("missing: none")
        return 0
    main = session_transcript(root)
    subdir = main.parent / main.stem / "subagents" if main is not None else None
    by_id: Dict[str, Path] = {}
    if subdir is not None and subdir.is_dir():
        for transcript in sorted(subdir.glob("agent-*.jsonl"), key=os.path.getmtime):
            pid, _task = read_prompt(transcript)
            if pid:
                by_id[pid] = transcript
    now = time.time()
    for pass_id, path in missing:
        written = utc_iso(path.stat().st_mtime)
        transcript = by_id.get(pass_id)
        if transcript is None:
            state = "not launched"
        else:
            agent = transcript.stem[len("agent-"):]
            mtime = transcript.stat().st_mtime
            if now - mtime <= RUNNING_SECONDS:
                state = "running (agent {}, last write {})".format(agent, utc_iso(mtime))
            else:
                state = "stopped without report: persist_pass.py recover --agent-id {}".format(
                    agent)
        print("missing: {} (task written {}): {}".format(pass_id, written, state))
    return 1


def repo_root(start: Optional[str]) -> Path:
    here = Path(start or ".").resolve()
    for candidate in [here] + list(here.parents):
        if (candidate / ".git").exists():
            return candidate
    raise UsageError("{} is not in a git repository".format(posix(str(here))))


def main(argv: Optional[Sequence[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        try:
            data = sys.stdin.buffer.read()
        except (OSError, ValueError):
            data = b""
        code, out = hook(data)
        if out:
            sys.stdout.write(out + "\n")
            sys.stdout.flush()
        return code
    parser = argparse.ArgumentParser(
        prog="persist_pass.py",
        description="Save and read back the harden agents' reports (pilot-auto-calibration "
                    "A01-F42, A01-F43). Without arguments: hook mode, the SubagentStop JSON on "
                    "stdin, always exit 0.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("observe", help="read a saved report's transcript (exit 0/1/3)")
    p.add_argument("pass_id")
    p.add_argument("--kind", choices=sorted(DIRS))
    p.add_argument("--json", action="store_true")
    p.add_argument("--repo", default=".")
    p = sub.add_parser("recover", help="extract a report from a subagent transcript (0/1/2)")
    p.add_argument("--agent-id", required=True)
    p.add_argument("--transcript")
    p.add_argument("--kind", choices=sorted(DIRS))
    p.add_argument("--replace", action="store_true")
    p.add_argument("--repo", default=".")
    p = sub.add_parser("collect", help="pool the observed passes' candidates")
    p.add_argument("--out")
    p.add_argument("--repo", default=".")
    p = sub.add_parser("missing", help="task files without a saved report (exit 0/1)")
    p.add_argument("--all", action="store_true", help="include the probe-* tasks")
    p.add_argument("--repo", default=".")
    args = parser.parse_args(argv)
    try:
        root = repo_root(args.repo)
        if args.command == "observe":
            code, lines, observed = observe(args.pass_id, root, args.kind)
            if args.json:
                print(json.dumps({"exit": code, "lines": lines, "observed": observed},
                                 indent=2, ensure_ascii=False))
            else:
                for line in lines:
                    print(line)
            return code
        if args.command == "recover":
            return cmd_recover(args, root)
        if args.command == "collect":
            return cmd_collect(args, root)
        return cmd_missing(args, root)
    except UsageError as exc:
        print("persist_pass.py: {}".format(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
