#!/usr/bin/env python3
"""harden_agents.py - render, install, check and probe the /harden skill's own agents.

Purpose
    Lens passes and verifiers run as two agent definitions that ship as templates in
    assets/agents/ (pilot-auto-calibration A01-F41): harden-lens (Read, Grep and Glob only, a
    pinned model, no CLAUDE.md, a Stop hook that saves its report, A01-F42) and harden-verifier
    (the same plus Bash, with the run's hook_guard.py as its own PreToolUse hook, because a
    skill's hooks do not reach a subagent's tool calls, A01-F45). The owner installs them
    before a session: agent files added during a `claude -p` session were not loaded (n = 1).
    A run never installs them; its Phase 0 probe proves that they loaded, run on their pinned
    model family, persist through their hook, and that the verifier's Bash is guarded.

CLI (python3 on macOS/Linux)
    python harden_agents.py status  [--agents-dir DIR] [--json]
    python harden_agents.py install [--agents-dir DIR] [--force]
    python harden_agents.py json
    python harden_agents.py probe   [--repo .]
    python harden_agents.py probe-check [--repo .] [--agents-dir DIR] [--json]

    status       one line per agent: missing, current (installed bytes equal the render),
                 stale (a harden template marker, other bytes) or foreign (no marker); plus
                 the fallback agent and the fallback models read from the templates
    install      writes each render atomically (UTF-8, no BOM, LF); refuses a foreign file
                 without --force, and any install from a repository with .harden/active
    json         prints {"harden-lens": {...}, "harden-verifier": {...}} for `claude --agents`,
                 the configuration the agent probes measured
    probe        writes .harden/prompts/probe-lens.md and probe-verifier.md and prints the two
                 Agent calls to make (in a run: .harden/active must exist)
    probe-check  reads both saved probe reports and their transcripts (persist_pass.py
                 observe) and the verifier's canary denial in .harden/hook_events.log, writes
                 .harden/agents.json and appends one line to .harden/progress.md

    Agents directory: --agents-dir, else $CLAUDE_CONFIG_DIR/agents, else ~/.claude/agents.

Exit codes
    status       0 both current; 1 missing, stale or foreign; 2 error
    install      0 installed or already current; 1 refused (a foreign file); 2 error
    json, probe  0 written; 2 error
    probe-check  0 pass; 1 fail (it prints the fallback of detection step 8)

Python 3.9+ standard library only.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

sys.dont_write_bytecode = True
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import persist_pass as PP  # noqa: E402  (sibling module, stdlib only)

SKILL_DIR = _HERE.parent
TEMPLATE_DIR = SKILL_DIR / "assets" / "agents"
AGENTS = ("harden-lens", "harden-verifier")
MARKER = "harden-agent-template: {}"
FAMILIES = {"opus": "claude-opus-", "sonnet": "claude-sonnet-", "haiku": "claude-haiku-"}
RANK = {"haiku": 0, "sonnet": 1, "opus": 2}
UNSAFE_CHARS = ("'", '"', "$", "`", "\n", "\r")
RESTART = ("Start a new Claude Code session. In one claude -p session on 2.1.282 an agent file "
           "added mid-session was not loaded (n = 1), although the docs say files in an existing "
           "agents directory are picked up within seconds.")
PROBE_LENS = ("This is the agent check of a /harden run. There is no card and no slice: read no "
              "file. Your final message: line 1 `pass-id: probe-lens`, then the JSON object "
              "{\"pass_id\": \"probe-lens\", \"lens\": \"probe\", \"candidates\": []}.")
PROBE_VERIFIER = ("Run the Bash command `echo HARDEN_HOOK_CANARY` once. The run's hook must "
                  "refuse it; do not retry or rephrase it. Your final message: line 1 "
                  "`pass-id: probe-verifier`, then the JSON object {\"pass_id\": "
                  "\"probe-verifier\", \"canary\": \"refused\"} or {\"pass_id\": "
                  "\"probe-verifier\", \"canary\": \"ran\"}.")


class AgentError(Exception):
    """A usage or environment error (exit 2)."""


def posix(path: str) -> str:
    return PP.posix(path)


def agents_dir(explicit: Optional[str]) -> Path:
    if explicit:
        return Path(posix(explicit))
    config = os.environ.get("CLAUDE_CONFIG_DIR")
    if config and config.strip():
        return Path(posix(config.strip())) / "agents"
    return Path.home() / ".claude" / "agents"


def skill_dir_text() -> str:
    return posix(str(SKILL_DIR.resolve()))


def template_text(name: str) -> str:
    path = TEMPLATE_DIR / "{}.md".format(name)
    try:
        # LF and no BOM whatever the checkout did: render() requires "---\n" first, and the
        # installed file must equal the render byte for byte.
        return path.read_bytes().decode("utf-8").lstrip(chr(0xFEFF)).replace("\r\n", "\n")
    except OSError as exc:
        raise AgentError("cannot read template {}: {}".format(posix(str(path)), exc)) from exc


def render(template: str, skill_dir: str) -> str:
    """The template with {{SKILL_DIR}} replaced; refuses a directory that would break the
    single-quoted YAML scalar or the double-quoted shell string it sits in."""
    bad = [c for c in UNSAFE_CHARS if c in skill_dir]
    if bad:
        raise AgentError("the skill directory {!r} holds {}: it cannot sit inside the hook "
                         "command; move the skill".format(skill_dir, " ".join(repr(c) for c in bad)))
    text = template.replace("{{SKILL_DIR}}", skill_dir)
    if "{{" in text:
        raise AgentError("an unreplaced placeholder is left in the rendered agent")
    if not text.startswith("---\n"):
        raise AgentError("a rendered agent must start with its frontmatter line ---")
    return text


def rendered(name: str, skill_dir: Optional[str] = None) -> str:
    return render(template_text(name), skill_dir or skill_dir_text())


def split_front(text: str) -> Tuple[str, str]:
    parts = text.lstrip(chr(0xFEFF)).replace("\r\n", "\n").split("---\n", 2)
    if len(parts) < 3 or parts[0] != "":
        raise AgentError("no frontmatter")
    return parts[1], parts[2]


# A small YAML subset: nested mappings and lists, plain, single- or double-quoted scalars.
def _scalar(raw: str) -> Any:
    raw = raw.strip()
    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        return raw[1:-1].replace("''", "'")
    if raw.startswith('"') and raw.endswith('"') and len(raw) >= 2:
        return json.loads(raw)
    if raw in ("true", "false"):
        return raw == "true"
    if re.match(r"^-?\d+$", raw):
        return int(raw)
    return raw


def _parse_block(lines: List[Tuple[int, str]], pos: int, indent: int) -> Tuple[Any, int]:
    if pos < len(lines) and lines[pos][1].startswith("- ") and lines[pos][0] == indent:
        items: List[Any] = []
        while pos < len(lines) and lines[pos][0] == indent and lines[pos][1].startswith("- "):
            inner = lines[pos][1][2:]
            sub = [(indent + 2, inner)] + lines[pos + 1:]
            value, used = _parse_block(sub, 0, indent + 2)
            items.append(value)
            pos = pos + used
        return items, pos
    mapping: Dict[str, Any] = {}
    while pos < len(lines) and lines[pos][0] == indent and not lines[pos][1].startswith("- "):
        key, _, rest = lines[pos][1].partition(":")
        rest = rest.strip()
        pos += 1
        if rest:
            mapping[key.strip()] = _scalar(rest)
        elif pos < len(lines) and lines[pos][0] > indent:
            value, pos = _parse_block(lines, pos, lines[pos][0])
            mapping[key.strip()] = value
        else:
            mapping[key.strip()] = None
    return mapping, pos


def parse_front(front: str) -> Dict[str, Any]:
    lines = [(len(line) - len(line.lstrip(" ")), line.strip()) for line in front.split("\n")
             if line.strip() and not line.strip().startswith("#")]
    value, _pos = _parse_block(lines, 0, 0)
    return value if isinstance(value, dict) else {}


def definition(name: str, skill_dir: Optional[str] = None) -> Dict[str, Any]:
    """The `claude --agents` form of one agent, from the same render as the installed file."""
    front, body = split_front(rendered(name, skill_dir))
    data = parse_front(front)
    out: Dict[str, Any] = {"description": data.get("description"), "prompt": body.strip("\n") +
                           "\n"}
    tools = data.get("tools")
    out["tools"] = [t.strip() for t in str(tools).split(",") if t.strip()] if tools else []
    for key in ("model", "effort", "omitClaudeMd", "maxTurns", "hooks"):
        if key in data:
            out[key] = data[key]
    return out


def template_model(name: str) -> str:
    front, _body = split_front(template_text(name))
    return str(parse_front(front).get("model") or "inherit")


def model_family(model: Optional[str]) -> Optional[str]:
    if not isinstance(model, str):
        return None
    for family, prefix in FAMILIES.items():
        if model.lower().startswith(prefix) or model.lower() == family:
            return family
    return None


def state_of(path: Path, want: str, name: str) -> str:
    if not path.is_file():
        return "missing"
    try:
        have = path.read_bytes().decode("utf-8", errors="replace")
    except OSError:
        return "missing"
    if have == want:
        return "current"
    if MARKER.format(name) in have:
        return "stale"
    return "foreign"


def fallback_agent(directory: Path) -> str:
    """codebase-explorer when the owner's file restricts it to Read, Glob and Grep (read-only
    and enforced, what pilots 1 and 2 used), else general-purpose."""
    path = directory / "codebase-explorer.md"
    try:
        front, _body = split_front(path.read_bytes().decode("utf-8", errors="replace"))
    except (OSError, AgentError):
        return "general-purpose"
    tools = parse_front(front).get("tools")
    names = {t.strip() for t in str(tools or "").split(",") if t.strip()}
    return "codebase-explorer" if names == {"Read", "Glob", "Grep"} else "general-purpose"


def status(directory: Optional[Path] = None) -> Dict[str, Any]:
    directory = directory or agents_dir(None)
    states = {}
    for name in AGENTS:
        states[name] = state_of(directory / "{}.md".format(name), rendered(name), name)
    return {"agents_dir": posix(str(directory)), "states": states,
            "fallback_agent": fallback_agent(directory),
            "fallback_models": {"lens": template_model("harden-lens"),
                                "verifier": template_model("harden-verifier")}}


def run_root(start: Path) -> Optional[Path]:
    here = start.resolve()
    for candidate in [here] + list(here.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def write_atomic(path: Path, text: str) -> None:
    data = text.encode("utf-8")
    for attempt in range(4):
        fd, tmp = tempfile.mkstemp(prefix=".tmp-harden-", dir=str(path.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, str(path))
            return
        except PermissionError as exc:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            if attempt == 3:
                raise AgentError("cannot replace {} (held open by another process?): {}".format(
                    posix(str(path)), exc)) from exc
            time.sleep(0.1)


def cmd_status(args: argparse.Namespace) -> int:
    info = status(agents_dir(args.agents_dir))
    if args.json:
        print(json.dumps(info, indent=2))
    else:
        for name, state in info["states"].items():
            print("{}: {} ({}/{}.md)".format(name, state, info["agents_dir"], name))
        print("fallback agent: {}; fallback models: lens {}, verifier {}".format(
            info["fallback_agent"], info["fallback_models"]["lens"],
            info["fallback_models"]["verifier"]))
    return 0 if all(s == "current" for s in info["states"].values()) else 1


def cmd_install(args: argparse.Namespace) -> int:
    root = run_root(Path.cwd())
    if root is not None and (root / ".harden" / "active").is_file():
        raise AgentError("install before the session, never during a run ({} holds "
                         ".harden/active)".format(posix(str(root))))
    directory = agents_dir(args.agents_dir)
    created = False
    if not directory.is_dir():
        directory.mkdir(parents=True, exist_ok=True)
        created = True
    refused = []
    for name in AGENTS:
        path = directory / "{}.md".format(name)
        want = rendered(name)
        state = state_of(path, want, name)
        if state == "current":
            print("current {}".format(posix(str(path))))
            continue
        if state == "foreign" and not args.force:
            refused.append(name)
            print("REFUSED {}: a file of that name exists without the harden template marker; "
                  "move it, or pass --force to overwrite it".format(posix(str(path))))
            continue
        write_atomic(path, want)
        print("installed {}".format(posix(str(path))))
    if created:
        print("WARNING: {} did not exist: the agent watcher covers only directories that "
              "existed when the session started".format(posix(str(directory))))
    print(RESTART)
    print("Unattended launches pass the same definitions with --agents \"$(python {}/scripts/"
          "harden_agents.py json)\"".format(skill_dir_text()))
    return 1 if refused else 0


def cmd_json(_args: argparse.Namespace) -> int:
    print(json.dumps({name: definition(name) for name in AGENTS}, ensure_ascii=True))
    return 0


def cmd_probe(args: argparse.Namespace) -> int:
    root = run_root(Path(args.repo))
    if root is None or not (root / ".harden" / "active").is_file():
        raise AgentError("the probe runs inside a /harden run: .harden/active is missing")
    prompts = root / ".harden" / "prompts"
    prompts.mkdir(parents=True, exist_ok=True)
    abs_prompts = posix(str(prompts.resolve()))
    for name, kind, body in (("probe-lens", "lens", PROBE_LENS),
                             ("probe-verifier", "verifier", PROBE_VERIFIER)):
        write_atomic(prompts / "{}.md".format(name),
                     "pass-id: {}\nkind: {}\n\n{}\n".format(name, kind, body))
    print("Start these two subagents together in one message, in the foreground (not in the "
          "background, so both have returned before the check), each with exactly this prompt "
          "and no model parameter:")
    for n, (agent, name) in enumerate((("harden-lens", "probe-lens"),
                                       ("harden-verifier", "probe-verifier")), 1):
        print("[{}] subagent_type: {}".format(n, agent))
        print("pass-id: {}".format(name))
        print("Task file: {}/{}.md. Read it first and follow it exactly.".format(abs_prompts, name))
    print("When both have returned, run: python \"{}/scripts/harden_agents.py\" probe-check"
          .format(skill_dir_text()))
    return 0


def _ts(value: Any) -> Optional[float]:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        when = _dt.datetime.fromisoformat(text)
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=_dt.timezone.utc)
    return when.timestamp()


def verifier_canary(root: Path, since: float) -> bool:
    try:
        lines = (root / ".harden" / "hook_events.log").read_text(
            encoding="utf-8", errors="replace").split("\n")
    except OSError:
        return False
    for line in lines:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict) or event.get("reason_code") != "canary-bash" or \
                event.get("agent_type") != "harden-verifier":
            continue
        when = _ts(event.get("ts"))
        if when is not None and when >= int(since):
            return True
    return False


def orchestrator_model(root: Path) -> Optional[str]:
    main = PP.session_transcript(root)
    if main is None or not main.is_file():
        return None
    model = None
    for entry in PP.iter_entries(main):
        if entry.get("type") != "assistant":
            continue
        message = entry.get("message")
        value = message.get("model") if isinstance(message, dict) else None
        if isinstance(value, str) and value and value != "<synthetic>":
            model = value
    return model


def check_agent(root: Path, name: str, agent: str, expected: Dict[str, Any],
                problems: List[str]) -> Dict[str, Any]:
    kind = "lens" if agent == "harden-lens" else "verifier"
    code, _lines, observed = PP.observe(name, root, kind)
    dirname = PP.DIRS[kind]
    meta = PP.read_json_opt(root / ".harden" / dirname / "{}.meta.json".format(name)) or {}
    result = PP.read_json_opt(root / ".harden" / dirname / "{}.result.json".format(name))
    info: Dict[str, Any] = {"model": observed.get("model"),
                            "effort": ",".join(observed.get("effort") or []) or None,
                            "persist": meta.get("source") if code != 3 else "not persisted"}
    if code == 3:
        problems.append("{}: no saved report (the agent did not load, or its Stop hook did not "
                        "fire)".format(name))
        return info
    if meta.get("source") != "hook":
        problems.append("{}: saved by {}, not by the agent's own hook".format(
            name, meta.get("source")))
    if meta.get("agent_type") != agent:
        problems.append("{}: ran as {!r}, not {}".format(name, meta.get("agent_type"), agent))
    if not meta.get("parsed") or result is None:
        problems.append("{}: its report did not parse".format(name))
    elif result != expected and kind == "lens":
        problems.append("{}: its report is not the probe's object".format(name))
    elif kind == "verifier" and result.get("canary") != "refused":
        problems.append("{}: its report says the canary {!r}".format(name, result.get("canary")))
    want = template_model(agent)
    family = model_family(observed.get("model"))
    if want != "inherit" and family != want:
        problems.append("{}: ran on {} (family {}), the template pins {}".format(
            name, observed.get("model"), family, want))
    markers = observed.get("definition_markers") or []
    if observed.get("prompt_snapshot"):
        if "{} v1".format(agent) in markers:
            info["definition"] = "verified"
        else:
            info["definition"] = "not the harden template"
            problems.append("{}: its system prompt lacks the {} v1 marker: a stale or foreign "
                            "definition loaded".format(name, agent))
    else:
        info["definition"] = "unverified (no prompt_snapshot)"
    return info


def cmd_probe_check(args: argparse.Namespace) -> int:
    root = run_root(Path(args.repo))
    if root is None or not (root / ".harden" / "active").is_file():
        raise AgentError(".harden/active is missing: probe-check runs inside a /harden run")
    directory = agents_dir(args.agents_dir)
    info = status(directory)
    problems: List[str] = []
    lens = check_agent(root, "probe-lens", "harden-lens",
                       {"pass_id": "probe-lens", "lens": "probe", "candidates": []}, problems)
    verifier = check_agent(root, "probe-verifier", "harden-verifier", {}, problems)
    task = root / ".harden" / "prompts" / "probe-verifier.md"
    since = task.stat().st_mtime if task.is_file() else 0.0
    verifier["guard"] = "refused" if verifier_canary(root, since) else "not refused"
    if verifier["guard"] != "refused":
        problems.append("probe-verifier: no canary-bash denial from inside harden-verifier in "
                        ".harden/hook_events.log: its Bash is not guarded")
    orch = orchestrator_model(root)
    lens_family = model_family(lens.get("model"))
    orch_family = model_family(orch)
    cheaper = bool(lens_family and orch_family and RANK[lens_family] < RANK[orch_family])
    passed = not problems
    data = {"checked": PP.utc_iso(), "status": "pass" if passed else "fail",
            "agents_dir": info["agents_dir"], "installed": info["states"],
            "lens": lens, "verifier": verifier, "orchestrator_model": orch,
            "cheaper_lens_than_orchestrator": cheaper, "fallback": not passed,
            "fallback_agent": info["fallback_agent"], "problems": problems,
            "env": {k: os.environ.get(k) for k in ("CLAUDE_CODE_SUBAGENT_MODEL",
                                                    "CLAUDE_CODE_SUBAGENT_MODEL_FORCE")}}
    PP.write_json(root / ".harden" / "agents.json", data)
    line = "- {} Agents: {} (lens {}, verifier {}, guard {}{})".format(
        data["checked"], "PASS" if passed else "FAIL", lens.get("model") or "not observed",
        verifier.get("model") or "not observed", verifier["guard"],
        "" if passed else "; " + "; ".join(problems[:3]))
    try:
        with open(root / ".harden" / "progress.md", "a", encoding="utf-8", newline="\n") as fh:
            fh.write(line + "\n")
    except OSError:
        pass
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print(line[2:])
        for problem in problems:
            print("PROBLEM: " + problem)
    if not passed:
        print("Fallback for this run (detection step 8): lens passes start {0} with model "
              "\"{1}\", verifiers start {0} with model \"{2}\". A verifier task then says 'run "
              "no command': before starting it, run each tool or test its candidates cite "
              "yourself, under the run's hook, and list the output files in its task. Run "
              "persist_pass.py recover after each subagent, and name the fallback under Limits."
              .format(info["fallback_agent"], info["fallback_models"]["lens"],
                      info["fallback_models"]["verifier"]))
    return 0 if passed else 1


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="harden_agents.py",
        description="Render, install, check and probe the harden-lens and harden-verifier "
                    "agents (pilot-auto-calibration A01-F41, A01-F45).")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("status", help="missing, current, stale or foreign (exit 0/1)")
    p.add_argument("--agents-dir")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("install", help="write the rendered agents (before a session)")
    p.add_argument("--agents-dir")
    p.add_argument("--force", action="store_true", help="overwrite a foreign file")
    sub.add_parser("json", help="the definitions for claude --agents")
    p = sub.add_parser("probe", help="write the two probe task files of a run")
    p.add_argument("--repo", default=".")
    p = sub.add_parser("probe-check", help="check the probe; write .harden/agents.json")
    p.add_argument("--repo", default=".")
    p.add_argument("--agents-dir")
    p.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    handlers = {"status": cmd_status, "install": cmd_install, "json": cmd_json,
                "probe": cmd_probe, "probe-check": cmd_probe_check}
    try:
        return handlers[args.command](args)
    except (AgentError, PP.UsageError) as exc:
        print("harden_agents.py: {}".format(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
