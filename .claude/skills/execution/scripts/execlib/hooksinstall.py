"""`exec.py hooks install | canary | uninstall` (contract/CLI.md 1, HOOKS.md 11 and 13.1, MODULES.md 5).

install merges the tagged hook entries (HOOKS.md 11.2) into `<repo>/.claude/settings.local.json`, keeping every
foreign entry's values and order, backs up and sets `switchModelsOnFlag` and the orchestrator's effort
(`modelSettings.<model id>.effortLevel: "xhigh"`, contract revision 4), adds the `.git/info/exclude` lines, and
writes the run marker `local/active` with a fresh bind nonce when the run is not bound. canary checks the binding
the PreToolUse hook made from the main thread and cross-checks it with this process's CLAUDE_CODE_SESSION_ID and the
recorded permission mode. uninstall removes only tagged entries, restores the flag and the effort levels exactly
(an absent value stays absent) and deletes the marker.

The session's model id is in no hook payload, so the effort is set for every model id the owner's user-level
`modelSettings` names plus `claude-opus-5-5`. Its backup lives in `local/settings-backup.json`: local state's
`settings_backup` cannot hold it while local-state.schema.json closes that object (contract question Q-B08-19).
"""
from __future__ import annotations

import json
import os
import secrets
from argparse import Namespace
from datetime import timedelta
from pathlib import Path
from typing import Any

from . import clock, jsonio, paths, state
from . import events as events_mod
from .errors import CheckFailed, ErrorItem, UsageError, ValidationFailed
from .gitutil import Git
from .log import get_logger
from .model import CommandResult, Ctx

_LOG = get_logger("execlib.hooksinstall")

TAG = "# execution-hook v1"
PRE_TOOL_MATCHER = ("Bash|PowerShell|Read|Edit|MultiEdit|Write|Grep|Glob|NotebookEdit|NotebookRead|WebFetch|"
                    "PushNotification|CronCreate|CronDelete|RemoteTrigger|SendMessage|Monitor|Artifact|"
                    "ArtifactComments|ArtifactData|DesignSync|EnterWorktree|ExitWorktree|mcp__.*")
EVENTS_ORDER = ("Stop", "StopFailure", "SessionStart", "SessionEnd", "PreToolUse", "UserPromptSubmit")
SCRIPTS = {"Stop": "stop_gate.py", "StopFailure": "stop_failure.py", "SessionStart": "session_start.py",
           "SessionEnd": "session_end.py", "PreToolUse": "pre_tool_guard.py", "UserPromptSubmit": "user_prompt.py"}
MATCHERS = {"SessionStart": "startup|resume|clear|compact", "PreToolUse": PRE_TOOL_MATCHER}
EXCLUDES = (".execution/", ".claude/settings.local.json", ".claude/worktrees/")
TIMEOUT_S = 10
CANARY_MAX_AGE_S = 300
# The orchestrator strategises at xhigh during a run (owner policy of 2026-10-02, contract revision 4).
EFFORT_LEVEL = "xhigh"
EFFORT_DEFAULT_MODELS = ("claude-opus-5-5",)
SETTINGS_BACKUP = "settings-backup.json"  # under local/

# The state lock (CLI.md: "Lock: state") through state's own import of locks: MODULES.md 8 lists
# hooksinstall -> state, events, gitutil but no `locks` edge although events.append and state.save require the lock
# (contract question Q-B08-5; test_import_graph enforces the listed edges).
hold_lock = state.locks.hold


def command_for(skill_dir: Path, script: str) -> str:
    return f'bash "{paths.posix(skill_dir)}/scripts/hooks/py.sh" {script} {TAG}'


def entries(skill_dir: Path, prompt_hook: bool = True) -> dict:
    """The settings `hooks` block of HOOKS.md 11.2 (absolute paths, tagged commands)."""
    out: dict[str, list] = {}
    for event in EVENTS_ORDER:
        if event == "UserPromptSubmit" and not prompt_hook:
            continue
        group: dict[str, Any] = {}
        if event in MATCHERS:
            group["matcher"] = MATCHERS[event]
        group["hooks"] = [{"type": "command", "command": command_for(skill_dir, SCRIPTS[event]),
                           "timeout": TIMEOUT_S}]
        out[event] = [group]
    return out


def _is_ours(hook: Any) -> bool:
    return isinstance(hook, dict) and isinstance(hook.get("command"), str) and hook["command"].rstrip().endswith(TAG)


def _strip_ours(groups: Any) -> tuple[list, bool]:
    """Remove our tagged hooks from an event's group list; drop groups left empty. (new list, anything removed)."""
    if not isinstance(groups, list):
        return groups, False
    out: list = []
    removed = False
    for group in groups:
        if isinstance(group, dict) and isinstance(group.get("hooks"), list):
            kept = [h for h in group["hooks"] if not _is_ours(h)]
            if len(kept) != len(group["hooks"]):
                removed = True
                if not kept:
                    continue
                group = {**group, "hooks": kept}
        out.append(group)
    return out, removed


def settings_path(ctx: Ctx) -> Path:
    if ctx.layout.repo is None:
        raise UsageError("hooks install needs the product repository", hint="run from the repo or pass --repo")
    return ctx.layout.repo / ".claude" / "settings.local.json"


def read_settings(path: Path) -> dict:
    """The settings object; {} when absent; E_SETTINGS_INVALID (exit 1, file untouched) when not a JSON object."""
    if not path.exists():
        return {}
    try:
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as err:
        raise CheckFailed(f"{paths.posix(path)} is not valid JSON ({err}); it was not modified",
                          code="E_SETTINGS_INVALID", hint="fix the file by hand, then run hooks install again") \
            from err
    if not isinstance(doc, dict):
        raise CheckFailed(f"{paths.posix(path)} is not a JSON object; it was not modified", code="E_SETTINGS_INVALID")
    return doc


def write_settings(path: Path, doc: dict) -> None:
    jsonio.write_text_atomic(path, json.dumps(doc, indent=2, ensure_ascii=False) + "\n")


def merged(doc: dict, skill_dir: Path, prompt_hook: bool) -> tuple[dict, list[str]]:
    out = dict(doc)
    hooks = dict(out.get("hooks")) if isinstance(out.get("hooks"), dict) else {}
    ours = entries(skill_dir, prompt_hook)
    for event in EVENTS_ORDER:
        if event in hooks:
            hooks[event], _ = _strip_ours(hooks[event])
            if hooks[event] == []:
                del hooks[event]
    added: list[str] = []
    for event, groups in ours.items():
        existing = hooks.get(event)
        hooks[event] = (existing if isinstance(existing, list) else []) + groups
        added.append(event)
    out["hooks"] = hooks
    out["switchModelsOnFlag"] = True
    return out, added


def unmerged(doc: dict) -> tuple[dict, list[str]]:
    out = dict(doc)
    if not isinstance(out.get("hooks"), dict):
        return out, []
    hooks = dict(out["hooks"])
    removed: list[str] = []
    for event in list(hooks):
        new, did = _strip_ours(hooks[event])
        if did:
            removed.append(event)
            if new == []:
                del hooks[event]
            else:
                hooks[event] = new
    if hooks:
        out["hooks"] = hooks
    else:
        del out["hooks"]
    return out, removed


# --- the orchestrator's effort (contract revision 4) ------------------------------------------------------------------

def user_settings_path() -> Path:
    """The owner's user-level settings: `$CLAUDE_CONFIG_DIR/settings.json`, else `~/.claude/settings.json`."""
    base = os.environ.get("CLAUDE_CONFIG_DIR")
    return (Path(base) if base else Path.home() / ".claude") / "settings.json"


def effort_model_ids(user_settings: Path | None = None) -> list[str]:
    """The model ids whose effort install sets: every key of the user-level `modelSettings` (the session's model id
    is in no hook payload) plus EFFORT_DEFAULT_MODELS, sorted. The user file is only read; when it is not readable
    JSON, only the defaults are used and a warning names the file."""
    path = user_settings if user_settings is not None else user_settings_path()
    ids = set(EFFORT_DEFAULT_MODELS)
    if path.is_file():
        try:
            doc = json.loads(path.read_bytes().decode("utf-8-sig"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as err:
            _LOG.warning("the user-level settings are not readable JSON: the effort is set for the default model ids "
                         "only", extra={"data": {"path": paths.posix(path), "error": str(err)[:200]}})
        else:
            models = doc.get("modelSettings") if isinstance(doc, dict) else None
            if isinstance(models, dict):
                ids.update(k for k in models if isinstance(k, str) and k.strip())
    return sorted(ids)


def settings_backup_path(layout: paths.Layout) -> Path:
    return layout.local / SETTINGS_BACKUP


def read_settings_backup(path: Path) -> dict | None:
    """local/settings-backup.json; None when absent. A malformed file stops install and uninstall (E_STATE_INVALID):
    it may be the only record of the owner's previous values, so it is never replaced or deleted silently."""
    if not path.exists():
        return None
    doc = jsonio.read_json(path)
    if not (isinstance(doc, dict) and isinstance(doc.get("models"), dict)
            and isinstance(doc.get("model_settings_present"), bool)):
        raise CheckFailed(f"{paths.posix(path)} is not a settings backup; it was left as it is",
                          code="E_STATE_INVALID", hint="restore modelSettings in .claude/settings.local.json by hand, "
                                                       "then delete the file")
    return doc


def effort_backup(doc: dict, ids: list[str], models: dict | None = None) -> dict:
    """The effort values of the settings `doc` before install touches them: whether `modelSettings` exists and, per
    model id, whether its entry and its `effortLevel` exist and the value. `models` (an existing backup's) is kept as
    is: a value is recorded once, never over our own xhigh."""
    current = doc.get("modelSettings")
    out = dict(models or {})
    for mid in ids:
        if mid in out:
            continue
        entry = current.get(mid) if isinstance(current, dict) else None
        out[mid] = {"entry_present": isinstance(current, dict) and mid in current,
                    "effort_present": isinstance(entry, dict) and "effortLevel" in entry,
                    "effort_value": entry.get("effortLevel") if isinstance(entry, dict) else None}
    return out


def with_effort(doc: dict, ids: list[str]) -> tuple[dict, list[str], list[str]]:
    """`modelSettings.<id>.effortLevel = EFFORT_LEVEL` for each id: (new doc, ids set, ids skipped). A `modelSettings`
    or an entry that is not a JSON object is never replaced: those ids are skipped and the value kept as it is."""
    out = dict(doc)
    current = out.get("modelSettings", {})
    if not isinstance(current, dict):
        return out, [], list(ids)
    models = dict(current)
    done: list[str] = []
    skipped: list[str] = []
    for mid in ids:
        entry = models.get(mid, {})
        if not isinstance(entry, dict):
            skipped.append(mid)
            continue
        models[mid] = {**entry, "effortLevel": EFFORT_LEVEL}
        done.append(mid)
    if done:
        out["modelSettings"] = models
    return out, done, skipped


def without_effort(doc: dict, backup: dict) -> tuple[dict, list[str]]:
    """The effort values of `backup` put back exactly: a recorded value restored in place, an absent `effortLevel`
    removed, an entry or a `modelSettings` that did not exist removed once nothing else is in it. (new doc, ids)."""
    out = dict(doc)
    current = out.get("modelSettings")
    records = backup.get("models") if isinstance(backup.get("models"), dict) else {}
    if not isinstance(current, dict):
        return out, []
    models = dict(current)
    restored: list[str] = []
    for mid in sorted(records):
        rec, entry = records[mid], models.get(mid)
        if not isinstance(rec, dict) or not isinstance(entry, dict):
            continue
        entry = dict(entry)
        if rec.get("effort_present"):
            entry["effortLevel"] = rec.get("effort_value")
        else:
            entry.pop("effortLevel", None)
        if not rec.get("entry_present") and not entry:
            del models[mid]
        else:
            models[mid] = entry
        restored.append(mid)
    if not backup.get("model_settings_present") and not models:
        del out["modelSettings"]
    else:
        out["modelSettings"] = models
    return out, restored


def _fresh_nonce() -> str:
    return secrets.token_hex(8)


def install(ctx: Ctx, prompt_hook: bool) -> dict:
    path = settings_path(ctx)
    repo = ctx.layout.repo
    assert repo is not None
    with hold_lock(ctx.layout, "state", command=ctx.command):
        st = state.load(ctx.layout)
        doc = read_settings(path)  # before any write: an invalid file stops everything
        if st["hooks"].get("installed_utc") is None:
            st["settings_backup"] = {"switchModelsOnFlag_present": "switchModelsOnFlag" in doc,
                                     "switchModelsOnFlag_value": doc.get("switchModelsOnFlag")}
        ids = effort_model_ids()
        # The effort values are backed up before the settings are written, once per value: a recorded value is never
        # replaced by our own xhigh (a second install, or one after a crash), and a model id new to the owner's
        # user-level settings is added with its value as it stands (install never set it).
        bpath = settings_backup_path(ctx.layout)
        old = read_settings_backup(bpath)
        models = effort_backup(doc, ids, old["models"] if old else None)
        if old is None or models != old["models"]:
            jsonio.write_json_atomic(bpath, {
                "schema": "execution.settings-backup/1",
                "recorded_utc": old.get("recorded_utc") if old else clock.format_utc(ctx.now),
                "model_settings_present": old["model_settings_present"] if old else "modelSettings" in doc,
                "models": models})
        new_doc, added = merged(doc, paths.SKILL_DIR, prompt_hook)
        new_doc, effort_models, effort_skipped = with_effort(new_doc, ids)
        write_settings(path, new_doc)
        git = Git(repo)
        excluded = [line for line in EXCLUDES if git.exclude_add(line)]
        marker = state.read_active(ctx.layout)
        if marker is None:
            marker = {"schema": "execution.active/1", "executor": st["executor"], "project": st["project"],
                      "repo": paths.posix(repo), "state_dir": paths.posix(ctx.layout.state), "session_id": None,
                      "bind_nonce": _fresh_nonce(), "previous_session_ids": [],
                      "created_utc": clock.format_utc(ctx.now), "rekey_armed_until_utc": None}
            state.write_active(ctx.layout, marker)
        elif marker.get("session_id") is None:
            marker["bind_nonce"] = _fresh_nonce()
            state.write_active(ctx.layout, marker)
        st["hooks"]["installed_utc"] = clock.format_utc(ctx.now)
        st["hooks"]["settings_path"] = paths.posix(path)
        state.save(ctx, st)
        events_mod.append(ctx, "hooks.installed", {"settings_path": paths.posix(path), "entries": added,
                                                   "prompt_hook": prompt_hook, "bound": marker["session_id"]
                                                   is not None, "effort_models": effort_models,
                                                   "effort_skipped": effort_skipped})
    nonce = marker["bind_nonce"]
    return {"settings_path": paths.posix(path), "entries_added": added, "nonce": nonce, "excluded": excluded,
            "bound": marker["session_id"] is not None, "effort_level": EFFORT_LEVEL, "effort_models": effort_models,
            "effort_skipped": effort_skipped,
            "next": ["arm a wake source: Bash run_in_background 'sleep 5'",
                     f"exec.py hooks canary --nonce {nonce}"]}


def uninstall(ctx: Ctx) -> dict:
    path = settings_path(ctx)
    with hold_lock(ctx.layout, "state", command=ctx.command):
        st = state.load(ctx.layout)
        doc = read_settings(path)
        bpath = settings_backup_path(ctx.layout)
        effort = read_settings_backup(bpath)
        restored = False
        removed: list[str] = []
        effort_restored: list[str] = []
        if path.exists():
            new_doc, removed = unmerged(doc)
            backup = st.get("settings_backup") or {}
            if st["hooks"].get("installed_utc") is not None:
                if backup.get("switchModelsOnFlag_present"):
                    new_doc["switchModelsOnFlag"] = backup.get("switchModelsOnFlag_value")
                else:
                    new_doc.pop("switchModelsOnFlag", None)
                restored = True
            if effort is not None:
                new_doc, effort_restored = without_effort(new_doc, effort)
                restored = True
            if new_doc != doc:
                write_settings(path, new_doc)
        if effort is not None:
            bpath.unlink()  # applied (or nothing to apply it to): the next install records afresh
        st["settings_backup"] = {"switchModelsOnFlag_present": False, "switchModelsOnFlag_value": None}
        st["hooks"]["installed_utc"] = None
        if ctx.layout.active.exists():
            ctx.layout.active.unlink()
        state.save(ctx, st)
        events_mod.append(ctx, "hooks.uninstalled", {"removed": removed, "settings_restored": restored,
                                                     "effort_restored": effort_restored})
    return {"removed": removed, "settings_restored": restored, "effort_restored": effort_restored}


def _canary_events(layout: paths.Layout) -> list[dict]:
    """hooks.canary records not yet imported (local/hook-events/) and already imported (events.jsonl)."""
    found: list[dict] = []
    d = layout.hook_events_dir
    if d.exists():
        for p in sorted(d.glob("*.json")):
            try:
                doc = jsonio.read_json_retry(p)
            except (FileNotFoundError, ValidationFailed):
                continue
            if isinstance(doc, dict) and doc.get("type") == "hooks.canary":
                found.append({"ts": doc.get("ts"), "data": doc.get("data") or {}})
    for _n, doc in jsonio.read_jsonl(layout.events):
        if isinstance(doc, dict) and doc.get("type") == "hooks.canary" and str(doc.get("actor", "")).startswith(
                "hook:"):
            found.append({"ts": doc.get("ts"), "data": doc.get("data") or {}})
    return found


def _parse_ts(text: Any) -> Any:
    try:
        raw = str(text)
        if "." in raw:
            raw = raw.split(".")[0] + "Z"
        return clock.parse_utc(raw)
    except Exception:  # noqa: BLE001 - an unparsable record is skipped (it cannot prove the binding)
        return None


def canary(ctx: Ctx, nonce: str) -> dict:
    """MODULES.md 5: the canary result as one dict. `ok` is True when every check passed; `problems` lists the
    failed checks as error-item dicts (code, message, hint), empty when ok. cmd_canary moves `problems` into the
    envelope's errors and keeps the rest as data."""
    marker = state.read_active(ctx.layout)
    if marker is None:
        raise UsageError("no run marker (local/active)", hint="run exec.py hooks install first")
    env_id = os.environ.get("CLAUDE_CODE_SESSION_ID") or None
    session_id = marker.get("session_id")
    problems: list[ErrorItem] = []
    if nonce != marker.get("bind_nonce"):
        problems.append(ErrorItem("E_CHECK", "the nonce is not the marker's bind nonce",
                                  hint="use the nonce printed by hooks install or resume --takeover"))
    records = [r for r in _canary_events(ctx.layout) if r["data"].get("bound") is True
               and not r["data"].get("probe") and r["data"].get("session_id") == session_id]
    newest = None
    for rec in records:
        ts = _parse_ts(rec["ts"])
        if ts is not None and (newest is None or ts > newest[0]):
            newest = (ts, rec)
    hook_seen = clock.format_utc(newest[0]) if newest else None
    permission = newest[1]["data"].get("permission_mode") if newest else None
    latency = newest[1]["data"].get("latency_ms") if newest else None
    if session_id is None:
        problems.append(ErrorItem("E_CHECK", "the run is not bound yet: hooks are not live",
                                  hint="retry next turn; after two failures restart through launch-exec.ps1 -Resume"))
    elif newest is None or (ctx.now - newest[0]) > timedelta(seconds=CANARY_MAX_AGE_S) or newest[0] > ctx.now + \
            timedelta(seconds=60):
        problems.append(ErrorItem("E_CHECK", "no hooks.canary event of the bound session in the last 5 minutes",
                                  hint="retry next turn; after two failures restart through launch-exec.ps1 -Resume"))
    if session_id is not None and env_id is not None and env_id != session_id:
        problems.append(ErrorItem("E_CHECK", "the run is bound to another session",
                                  hint="run exec.py resume --takeover first"))
    if newest is not None and permission != "bypassPermissions":
        problems.append(ErrorItem("E_CHECK", f"permission mode is {permission!r}, not bypassPermissions",
                                  hint="restart through the launcher (launch-exec.ps1 -Resume)"))
    data = {"bound": session_id is not None, "session_id": session_id, "env_session_id": env_id,
            "permission_mode": permission, "hook_seen_utc": hook_seen, "latency_ms": latency}
    with hold_lock(ctx.layout, "state", command=ctx.command):
        st = state.load(ctx.layout)
        if not problems:
            st["hooks"]["canary_ok_utc"] = clock.format_utc(ctx.now)
            st["hooks"]["permission_mode"] = permission
            state.save(ctx, st)
        events_mod.append(ctx, "hooks.canary", {**data, "ok": not problems})
    return {**data, "ok": not problems, "problems": [p.to_dict() for p in problems]}


def cmd_install(ctx: Ctx, args: Namespace) -> CommandResult:
    return CommandResult(data=install(ctx, not getattr(args, "no_prompt_hook", False)))


def cmd_uninstall(ctx: Ctx, args: Namespace) -> CommandResult:
    return CommandResult(data=uninstall(ctx))


def cmd_canary(ctx: Ctx, args: Namespace) -> CommandResult:
    result = canary(ctx, str(args.nonce))
    problems = [ErrorItem(**item) for item in result.pop("problems")]
    result.pop("ok")
    data = result
    if problems:
        return CommandResult(data=data, exit_code=1, errors=problems)
    return CommandResult(data=data)
