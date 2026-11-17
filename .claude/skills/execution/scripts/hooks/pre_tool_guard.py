"""PreToolUse guard of /execution (contract/HOOKS.md 8, MODULES.md 6.5).

Order (HOOKS.md 8.2): locate the run; the binding rule (main thread, `exec.py hooks canary --nonce <nonce>`); the run
lease for another main-thread session; the probe rule (agents); the role (8.3); the rules of 8.4 in table order (A
everyone, B every agent, C by role), first deny wins; the attestation of allowed `proof verdict` / `merge` calls of
agents. A deny is one JSON line with `permissionDecision: deny` and exit 0; an allow prints nothing. Not a security
boundary (principle 5): a best-effort shell analysis that fails a mistake early. Fails open.

Usage: py.sh pre_tool_guard.py [--as <agent name>]
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from execlib import hookcore as hc  # noqa: E402

HOOK = "pre-tool-guard"
OURS = ("execution-planner", "execution-test-designer", "execution-implementer", "execution-verifier",
        "execution-reviewer")
THEIRS = ("frontend-critic", "frontend-probe")
READ_ONLY_ROLES = ("execution-verifier", "execution-reviewer", "frontend-critic", "frontend-probe")
WRITE_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "NotebookEdit"})
READ_TOOLS = frozenset({"Read", "Grep", "Glob", "NotebookRead"})
SHELL_TOOLS = frozenset({"Bash", "PowerShell"})
CONNECTOR_TOOLS = frozenset({"PushNotification", "CronCreate", "CronDelete", "RemoteTrigger", "SendMessage", "Monitor",
                             "Artifact", "ArtifactComments", "ArtifactData", "DesignSync", "EnterWorktree",
                             "ExitWorktree"})
CONNECTOR_SERVERS = frozenset({"claude_ai_Notion", "claude_ai_Gmail", "claude_ai_Google_Drive",
                               "claude_ai_Google_Calendar", "claude_ai_Luma", "claude_ai_Claude_Docs"})
MCP_WRITE_RE = re.compile(r"(?i)(create|update|delete|send|add|move|upload|duplicate|trash|label|spawn|stop|track|"
                          r"reply|forward|apply|approve|reject|remove|invite|import|rebuild|batch|write|set)")
ROLE_COMMANDS: dict[str, frozenset[str]] = {
    "execution-implementer": frozenset({"merge", "fe-workspace", "result put", "validate", "status --digest"}),
    "generic": frozenset({"result put", "validate", "status --digest"}),
    "execution-test-designer": frozenset({"result put", "validate", "plan instantiate --dry-run",
                                          "proof run --negative-control", "snapshot"}),
    "execution-verifier": frozenset({"proof run", "proof verdict", "result put", "status --digest"}),
    "execution-reviewer": frozenset({"result put", "proof run", "status --digest"}),
    "execution-planner": frozenset({"result put", "plan instantiate --dry-run", "validate", "simulate"}),
    "frontend-critic": frozenset(),
    "frontend-probe": frozenset(),
}
LEASE_ALLOWED = frozenset({"status --digest", "validate", "simulate", "hooks canary", "resume --takeover"})
DEV_BY_COMMANDS = frozenset({"answers ingest", "decision resolve"})  # their --by names a dev, not a role
DEV_NAMES = frozenset({"devA", "devB", "owner"})
# HOOKS.md 8.4 A8; public-values.jsonl since contract revision 3 (Q-B10-6): exec.py alone appends to it (README.md 8);
# local/settings-backup.json since revision 4 (Q-B08-19): written by `hooks install`, removed by `hooks uninstall`
STATE_OWNED = ("plan.json", "status/**", "proofs/**", "events.jsonl", "decisions.md", "public-values.jsonl",
               "answers/**", "waves/**", "briefs/**", "fix/**", "profile.json", "policy.json", "completion-check.mjs",
               "gates.json", "local/state.json", "local/active", "local/hooks-state.json",
               "local/settings-backup.json", "local/hook-events/**",
               "local/results/**", "local/proof-runs/**", "local/harden-ready/**", "local/completion/**",
               "local/merge-gates/**", "local/merge-pending/**", "local/schedule.json", "local/digest.txt",
               "local/locks/**", "local/probe/**")
READ_VERBS = frozenset({
    "cat", "tac", "type", "less", "more", "head", "tail", "bat", "nl", "grep", "egrep", "fgrep", "rg", "ag", "ack",
    "sed", "awk", "gawk", "cut", "sort", "uniq", "strings", "xxd", "od", "hexdump", "base64", "findstr",
    "get-content", "gc", "select-string", "sls", "scp", "rsync", "tee", "diff", "cmp", "jq", "yq", "openssl", "gpg",
    "zip", "tar", "7z", "clip", "clip.exe", "pbcopy", "xclip", "certutil", "ls", "find", "dir", "get-childitem",
    "gci"})
GIT_READ_ONLY = frozenset({"status", "log", "show", "diff", "rev-parse", "ls-files", "cat-file", "merge-base"})
ROLE_FORBIDDEN_GIT = frozenset({"commit", "push", "rebase", "reset", "checkout", "switch", "stash", "clean", "merge",
                                "cherry-pick", "revert", "am", "apply", "tag"})
EXEC_GLOBALS_WITH_VALUE = frozenset({"--repo", "--state", "--executor", "--now", "--log-level", "--by"})
SKIP_PREFIX_WORDS = frozenset({"sudo", "env", "command", "exec", "time", "nohup", "xargs", "&", "."})
NULL_TARGETS = frozenset({"/dev/null", "nul", "$null", "/dev/stderr", "/dev/stdout"})
BIND_RE = re.compile(r"exec\.py[\"']?\s+hooks\s+canary\s+--nonce\s+([0-9a-f]{16})\b")
GIT_COMMIT_RE = re.compile(r"\bgit(?:\s+-[cC]\s+\S+|\s+--[\w-]+(?:=\S+)?)*\s+commit\b")
HEREDOC_RE = re.compile(r"<<-?\s*([\"']?)(\w+)\1[^\n]*\n.*?\n\s*\2\s*(?=\n|$)", re.S)
MESSAGE_ARG_RE = re.compile(r"(\s(?:-m|--message)[\s=]+)(\"(?:[^\"\\]|\\.)*\"|'[^']*')", re.S)
HEREDOC_OP_RE = re.compile(r"(?<!<)<<-?\s*[\"']?\w+")
PATHISH_RE = re.compile(r"[A-Za-z]:[\\/][^\s'\"`,;()<>|]*|(?:\.{1,2}|~)?[\\/]?[\w.-]+(?:[\\/][\w.-]+)+[\\/]?")
REASON_MAX = 300


class Deny(Exception):
    def __init__(self, code: str, rule: str, what: str) -> None:
        super().__init__(what)
        self.code = code
        self.rule = rule
        self.what = what

    def reason(self) -> str:
        tail = " Do not retry in another form."
        body = f"{self.code}: {self.what}".rstrip()
        if not body.endswith("."):
            body += "."
        if len(body) + len(tail) > REASON_MAX:
            body = body[:REASON_MAX - len(tail) - 3] + "..."
        return body + tail


# --- shell analysis (HOOKS.md 8.5) -----------------------------------------------------------------------------------

class Segment:
    """One shell segment: its text, unquoted words, redirection targets, and the cwd it runs in."""

    __slots__ = ("text", "words", "redirect_targets", "cwd")

    def __init__(self, text: str) -> None:
        self.text = text
        self.words: list[str] = []
        self.redirect_targets: list[str] = []
        self.cwd = ""


def without_commit_message(command: str) -> str:
    """guard.without_commit_message: a git commit's message (heredoc body, -m strings) is prose, never analysed."""
    if not GIT_COMMIT_RE.search(command):
        return command
    stripped = HEREDOC_RE.sub("<<MSG", command)
    return MESSAGE_ARG_RE.sub(lambda m: m.group(1) + "MSG", stripped)


def tokenize(command: str, powershell: bool) -> list[Segment]:
    """Quote-aware split into segments (&&, ||, ;, |, & (bash), newlines) and words; redirection targets are
    collected apart. Bash: posix quoting and backslash escapes. PowerShell: single quotes literal, backtick escapes,
    backslashes kept (a Windows path keeps its separators)."""
    segs: list[Segment] = []
    cur = Segment("")
    word: list[str] = []
    has_word = False
    pending_redirect = False
    i = 0
    n = len(command)
    seg_start = 0

    def end_word() -> None:
        nonlocal word, has_word, pending_redirect
        if has_word:
            text = "".join(word)
            if pending_redirect:
                cur.redirect_targets.append(text)
                pending_redirect = False
            else:
                cur.words.append(text)
        word = []
        has_word = False

    def end_segment(at: int) -> None:
        nonlocal cur, seg_start
        end_word()
        cur.text = command[seg_start:at]
        if cur.words or cur.redirect_targets:
            segs.append(cur)
        cur = Segment("")
        seg_start = at

    while i < n:
        c = command[i]
        if c == "'":
            j = i + 1
            buf: list[str] = []
            while j < n:
                if command[j] == "'":
                    if powershell and j + 1 < n and command[j + 1] == "'":
                        buf.append("'")
                        j += 2
                        continue
                    break
                buf.append(command[j])
                j += 1
            word.extend(buf)
            has_word = True
            i = j + 1
            continue
        if c == '"':
            j = i + 1
            buf = []
            while j < n and command[j] != '"':
                ch = command[j]
                if powershell and ch == "`" and j + 1 < n:
                    buf.append(command[j + 1])
                    j += 2
                    continue
                if not powershell and ch == "\\" and j + 1 < n and command[j + 1] in '"\\$`\n':
                    buf.append(command[j + 1])
                    j += 2
                    continue
                buf.append(ch)
                j += 1
            word.extend(buf)
            has_word = True
            i = j + 1
            continue
        if (c == "`" and powershell) or (c == "\\" and not powershell):
            if i + 1 < n:
                if command[i + 1] == "\n":
                    i += 2
                    continue
                word.append(command[i + 1])
                has_word = True
                i += 2
                continue
            i += 1
            continue
        if c == "#" and not has_word:
            j = command.find("\n", i)
            i = n if j < 0 else j
            continue
        if c in " \t\r":
            end_word()
            i += 1
            continue
        if c == "\n" or c == ";":
            end_segment(i)
            i += 1
            seg_start = i
            continue
        if c == "|":
            if i + 1 < n and command[i + 1] == "|":
                end_segment(i)
                i += 2
            else:
                end_segment(i)
                i += 1
            seg_start = i
            continue
        if c == "&":
            if i + 1 < n and command[i + 1] == "&":
                end_segment(i)
                i += 2
                seg_start = i
                continue
            if not powershell and i + 1 < n and command[i + 1] == ">":
                end_word()
                i += 2
                if i < n and command[i] == ">":
                    i += 1
                pending_redirect = True
                continue
            if powershell:
                end_word()
                i += 1
                continue
            end_segment(i)
            i += 1
            seg_start = i
            continue
        if c == ">" or (powershell and c == "*" and i + 1 < n and command[i + 1] == ">" and not has_word):
            if c == "*":
                i += 1
            if has_word and "".join(word).isdigit():
                word = []
                has_word = False
            else:
                end_word()
            i += 1
            if i < n and command[i] == ">":
                i += 1
            if i < n and command[i] == "|":
                i += 1
            if i < n and command[i] == "&":
                i += 1
                while i < n and (command[i].isdigit() or command[i] == "-"):
                    i += 1
                continue
            pending_redirect = True
            continue
        if c == "<":
            end_word()
            j = i
            while j < n and command[j] == "<":
                j += 1
            i = j
            continue
        word.append(c)
        has_word = True
        i += 1
    end_segment(n)
    return segs


def verb_index(words: list[str]) -> int:
    for idx, w in enumerate(words):
        if re.match(r"^[A-Za-z_]\w*=", w) and not w.startswith("-"):
            continue
        if w.lower() in SKIP_PREFIX_WORDS:
            continue
        return idx
    return -1


def basename_lower(word: str) -> str:
    base = os.path.basename(word.replace("\\", "/")).lower()
    return base[:-4] if base.endswith(".exe") else base


def resolve_path(word: str, cwd: str) -> str | None:
    """Normalise a path token: quotes already stripped; ~ expanded; /c/x -> C:/x; backslashes -> /; relative paths
    joined to cwd. None for an empty token or a null device."""
    w = word.strip()
    if not w or w.lower() in NULL_TARGETS or w.startswith("$") or w.startswith("-"):
        return None
    w = hc.to_native(w).replace("\\", "/")
    if not (re.match(r"^[A-Za-z]:/", w) or w.startswith("/")):
        base = cwd or os.getcwd()
        w = base.replace("\\", "/").rstrip("/") + "/" + w
    return hc.posix(os.path.normpath(w))


def non_flags(words: list[str]) -> list[str]:
    return [w for w in words if not w.startswith("-")]


PS_VALUE_PARAMS = frozenset({"-path", "-literalpath", "-filepath", "-destination", "-value", "-encoding",
                             "-itemtype", "-name", "-include", "-exclude", "-filter", "-target"})


def ps_args(words: list[str]) -> tuple[dict[str, str], list[str]]:
    named: dict[str, str] = {}
    positional: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        low = w.lower()
        if low.startswith("-"):
            key, _sep, val = low.partition(":")
            if key in PS_VALUE_PARAMS:
                if _sep:
                    named[key] = w.split(":", 1)[1]
                elif i + 1 < len(words):
                    named[key] = words[i + 1]
                    i += 1
            i += 1
            continue
        positional.append(w)
        i += 1
    return named, positional


def write_targets(seg: Segment) -> list[str]:
    """Raw write-target tokens of one segment (redirections and the write verbs of HOOKS.md 8.5)."""
    out = list(seg.redirect_targets)
    vi = verb_index(seg.words)
    if vi < 0:
        return out
    verb = basename_lower(seg.words[vi])
    args = seg.words[vi + 1:]
    if verb in ("tee", "tee-object"):
        out += non_flags(args)
    elif verb in ("cp", "mv", "install", "copy", "move", "xcopy"):
        nf = non_flags(args)
        if nf:
            out.append(nf[-1])
    elif verb in ("copy-item", "move-item", "cpi", "mi", "cpp"):
        named, pos = ps_args(args)
        if "-destination" in named:
            out.append(named["-destination"])
        elif len(pos) >= 2:
            out.append(pos[-1])
    elif verb in ("rm", "rmdir", "del", "erase", "rd", "truncate", "touch", "mkdir", "md", "unlink", "shred"):
        out += non_flags(args)
    elif verb in ("remove-item", "ri", "new-item", "ni", "clear-content", "clc"):
        named, pos = ps_args(args)
        out += [named[k] for k in ("-path", "-literalpath") if k in named] + pos[:1]
    elif verb == "sed":
        if any(a == "-i" or a.startswith("-i") or a == "--in-place" or a.startswith("--in-place=") for a in args):
            nf = non_flags(args)
            script_given = any(a in ("-e", "-f", "--expression", "--file") for a in args)
            out += nf if script_given else nf[1:]
    elif verb in ("out-file", "set-content", "add-content", "sc", "ac"):
        named, pos = ps_args(args)
        picked = [named[k] for k in ("-path", "-filepath", "-literalpath") if k in named]
        out += picked if picked else pos[:1]
    return out


def git_info(seg: Segment) -> tuple[str, list[str], list[str]] | None:
    """(subcommand, flags-and-args after it, -C targets) when the segment runs git."""
    vi = verb_index(seg.words)
    if vi < 0 or basename_lower(seg.words[vi]) != "git":
        return None
    words = seg.words[vi + 1:]
    targets: list[str] = []
    i = 0
    while i < len(words):
        w = words[i]
        if w in ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix"):
            if w == "-C" and i + 1 < len(words):
                targets.append(words[i + 1])
            i += 2
            continue
        if w.startswith("-"):
            i += 1
            continue
        return w, words[i + 1:], targets
    return "", [], targets


class ExecCall:
    """The exec.py command of a segment: command words, flags, `--by`, option values."""

    __slots__ = ("command", "words", "flags", "by", "values")

    def __init__(self, command: str, words: list[str], flags: set[str], by: str | None,
                 values: dict[str, str]) -> None:
        self.command = command
        self.words = words
        self.flags = flags
        self.by = by
        self.values = values


def exec_call(seg: Segment) -> ExecCall | None:
    """The exec.py command of a segment: the command words of CLI.md 9 after the global options."""
    idx = -1
    for i, w in enumerate(seg.words):
        if basename_lower(w) == "exec.py":
            idx = i
            break
    if idx < 0:
        return None
    rest = seg.words[idx + 1:]
    cmd_words: list[str] = []
    values: dict[str, str] = {}
    flags: set[str] = set()
    by: str | None = None
    i = 0
    while i < len(rest):
        w = rest[i]
        if w.startswith("--"):
            name, eq, val = w.partition("=")
            flags.add(name)
            takes_value = name in EXEC_GLOBALS_WITH_VALUE or name in ("--task", "--run", "--attempt", "--wave")
            if eq:
                values[name] = val
            elif takes_value and i + 1 < len(rest):
                values[name] = rest[i + 1]
                i += 1
            elif i + 1 < len(rest) and not rest[i + 1].startswith("-") and len(cmd_words) >= 1 \
                    and name not in ("--dry-run", "--digest", "--negative-control", "--takeover", "--pretty"):
                values[name] = rest[i + 1]
                i += 1
            i += 1
            continue
        if w.startswith("-"):
            i += 1
            continue
        if len(cmd_words) < 2 and re.match(r"^[a-z][a-z-]*$", w) and (not cmd_words or
                                                                      f"{cmd_words[0]} {w}" in hc.COMMAND_WORDS):
            cmd_words.append(w)
        i += 1
    if not cmd_words:
        command = ""
    elif len(cmd_words) == 2:
        command = " ".join(cmd_words)
    else:
        command = cmd_words[0]
    by = values.get("--by")
    return ExecCall(command=command, words=cmd_words, flags=flags, by=by, values=values)


def command_allowed(call: ExecCall, allowed: frozenset[str]) -> bool:
    if call.command in allowed:
        return True
    for entry in allowed:
        base, sep, flag = entry.rpartition(" --")
        if sep and flag and base == call.command and f"--{flag}" in call.flags:
            return True
    return False


# --- paths and globs -------------------------------------------------------------------------------------------------

_GLOB_CACHE: dict[str, "re.Pattern[str]"] = {}


def glob_regex(pattern: str) -> re.Pattern[str]:
    cached = _GLOB_CACHE.get(pattern)
    if cached is None:
        cached = _GLOB_CACHE[pattern] = _glob_compile(pattern)
    return cached


def _glob_compile(pattern: str) -> re.Pattern[str]:
    p = pattern.replace("\\", "/")
    out: list[str] = []
    i = 0
    while i < len(p):
        c = p[i]
        if p.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif p.startswith("**", i):
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c == "{":
            j = p.find("}", i)
            if j < 0:
                out.append(re.escape(c))
                i += 1
            else:
                out.append("(?:" + "|".join(re.escape(x) for x in p[i + 1:j].split(",")) + ")")
                i = j + 1
        elif c == "[":
            j = p.find("]", i)
            if j < 0:
                out.append(re.escape(c))
                i += 1
            else:
                out.append(p[i:j + 1])
                i = j + 1
        else:
            out.append(re.escape(c))
            i += 1
    flags = re.IGNORECASE if hc.IS_WINDOWS else 0
    return re.compile("^" + "".join(out) + "$", flags)


def glob_match(pattern: str, path: str) -> bool:
    p = path.replace("\\", "/")
    if glob_regex(pattern).match(p):
        return True
    if pattern.endswith("/**"):
        return hc.norm(p) == hc.norm(pattern[:-3])
    return False


def checkout_root(path: str) -> str | None:
    cur = Path(path)
    for _ in range(64):
        try:
            if (cur / ".git").exists():
                return hc.posix(cur)
        except OSError:
            return None
        if cur.parent == cur:
            return None
        cur = cur.parent
    return None


def is_worktree_of(root: str, repo: Path) -> bool:
    main = hc._gitdir_main_repo(Path(root))  # noqa: SLF001 - shared helper of the hooks
    return main is not None and hc.norm(main) == hc.norm(repo)


# --- the guard -------------------------------------------------------------------------------------------------------

class Guard:
    def __init__(self, env: hc.HookEnv, payload: dict, as_role: str | None) -> None:
        self.env = env
        self.payload = payload
        self.as_role = as_role
        self.tool = str(payload.get("tool_name") or "")
        self.ti = payload.get("tool_input") if isinstance(payload.get("tool_input"), dict) else {}
        self.cwd = hc.to_native(str(payload.get("cwd") or "")) or hc.posix(env.repo)
        self.S = hc.posix(env.state_dir)
        self.layer = "agent" if as_role else "settings"
        self.role = "orchestrator"
        self._policy = None
        self._profile = None
        self._segments: list[Segment] | None = None

    # lazy reads (HOOKS.md 2.4)
    def policy(self) -> dict:
        if self._policy is None:
            doc = hc.read_json_quiet(self.env.state_dir / "policy.json")
            self._policy = doc if isinstance(doc, dict) else {}
        return self._policy

    def profile(self) -> dict:
        if self._profile is None:
            doc = hc.read_json_quiet(self.env.state_dir / "profile.json")
            self._profile = doc if isinstance(doc, dict) else {}
        return self._profile

    def flags(self) -> dict:
        st = hc.local_state(self.env)
        return st.get("flags") if isinstance(st.get("flags"), dict) else {}

    def scratch_project(self) -> str | None:
        prof = self.profile()
        root = (prof.get("machine") or {}).get("scratch_root") if isinstance(prof.get("machine"), dict) else None
        proj = prof.get("project") if isinstance(prof.get("project"), dict) else {}
        slug = proj.get("slug") or self.env.marker.get("project")
        if not root or not slug:
            return None
        return hc.posix(os.path.normpath(f"{root}/{slug}"))

    def protected_globs(self) -> list[str]:
        doc = hc.read_json_quiet(self.env.state_dir / "plan.json")
        prot = doc.get("protected") if isinstance(doc, dict) else None
        return [g for g in prot if isinstance(g, str)] if isinstance(prot, list) else []

    # shell
    @property
    def is_shell(self) -> bool:
        return self.tool in SHELL_TOOLS

    @property
    def command(self) -> str:
        cmd = self.ti.get("command")
        return cmd if isinstance(cmd, str) else ""

    def segments(self) -> list[Segment]:
        if self._segments is None:
            text = without_commit_message(self.command)
            segs = tokenize(text, self.tool == "PowerShell")
            cwd = self.cwd
            for seg in segs:
                seg.cwd = cwd
                vi = verb_index(seg.words)
                if vi >= 0 and basename_lower(seg.words[vi]) in ("cd", "set-location", "sl", "pushd", "chdir"):
                    args = non_flags(seg.words[vi + 1:])
                    if args:
                        resolved = resolve_path(args[0], cwd)
                        if resolved:
                            cwd = resolved
            self._segments = segs
        return self._segments

    def write_paths(self) -> list[str]:
        """Absolute targets of write tools or of the shell's write analysis."""
        if self.tool in WRITE_TOOLS:
            raw = self.ti.get("file_path") or self.ti.get("notebook_path") or self.ti.get("path")
            p = resolve_path(str(raw), self.cwd) if isinstance(raw, str) else None
            return [p] if p else []
        if not self.is_shell:
            return []
        out: list[str] = []
        for seg in self.segments():
            for tok in write_targets(seg):
                p = resolve_path(tok, seg.cwd)
                if p:
                    out.append(p)
        return out

    def state_rel(self, path: str) -> str | None:
        return hc.rel_to(path, self.S)

    def owned(self, rel: str) -> bool:
        """rel matches an exec.py-owned entry (exact names and `<dir>/**`: no regex needed)."""
        key = rel.lower() if hc.IS_WINDOWS else rel
        for g in STATE_OWNED:
            if g.endswith("/**"):
                if key == g[:-3] or key.startswith(g[:-2]):
                    return True
            elif key == g:
                return True
        return False

    # role (HOOKS.md 8.3)
    def resolve_role(self) -> str:
        agent_type = self.payload.get("agent_type")
        known = OURS + THEIRS
        if self.as_role and self.as_role in known:
            if isinstance(agent_type, str) and agent_type in known and agent_type != self.as_role:
                hc.append_event(self.env, HOOK, "error", self.payload,
                                {"kind": "role-mismatch", "as": self.as_role, "agent_type": agent_type})
                return "generic"
            return self.as_role
        if isinstance(agent_type, str) and agent_type in known:
            return agent_type
        return "generic"

    # rules -----------------------------------------------------------------------------------------------------
    def rules_everyone(self, main_thread: bool) -> None:
        pol = self.policy()
        now = hc.utcnow()
        if self.is_shell:
            for seg in self.segments():
                info = git_info(seg)
                if info is None:
                    continue
                sub, rest, _targets = info
                if sub == "push":
                    for w in rest:
                        if (w in ("-f", "--force", "--mirror", "--delete", "-d") or w.startswith("--force")
                                or w.startswith("+") or (w.startswith(":") and len(w) > 1)
                                or (":+" in w)):
                            raise Deny("E_GUARD_FORCE_PUSH", "A1", f"git push {w} is refused (no force push, no "
                                       "+refspec, no remote deletion)")
                if sub in ("filter-branch", "filter-repo"):
                    raise Deny("E_GUARD_FORCE_PUSH", "A2", f"git {sub} rewrites history and is refused")
                if sub == "reset" and "--hard" in rest and any(w.startswith("origin") for w in rest):
                    raise Deny("E_GUARD_FORCE_PUSH", "A2", "git reset --hard origin... discards local history")
                if sub == "update-ref" and "-d" in rest and any(w in ("refs/heads/main", "refs/heads/master")
                                                                for w in rest):
                    raise Deny("E_GUARD_FORCE_PUSH", "A2", "git update-ref -d on the main branch is refused")
                if sub == "branch" and "-D" in rest and any(w in ("main", "master") for w in rest):
                    raise Deny("E_GUARD_FORCE_PUSH", "A2", "git branch -D main/master is refused")
                if sub == "push":
                    freeze = hc.parse_utc_or_none(((pol.get("git") or {}).get("push_freeze_utc")))
                    if self.flags().get("push_frozen") is True or (freeze is not None and now >= freeze):
                        raise Deny("E_GUARD_PUSH_FROZEN", "A3", "pushes are frozen (policy.git.push_freeze_utc "
                                   "reached or flags.push_frozen set)")
            mainnet = ((pol.get("networks") or {}).get("mainnet") or {})
            if mainnet.get("mode") == "read-only" or self.flags().get("mainnet_open") is not True:
                for pat in mainnet.get("broadcast_patterns") or []:
                    if isinstance(pat, str) and _search(pat, self.command):
                        raise Deny("E_GUARD_MAINNET_CLOSED", "A4", "the command matches a mainnet broadcast "
                                   "pattern while mainnet is closed")
        texts: list[str] = []
        if self.is_shell:
            texts.append(self.command)
        if self.tool == "WebFetch" and isinstance(self.ti.get("url"), str):
            texts.append(self.ti["url"])
        for entry in pol.get("deny_endpoints") or []:
            if not isinstance(entry, dict) or not isinstance(entry.get("pattern"), str):
                continue
            for text in texts:
                hit = _search(entry["pattern"], text) if entry.get("regex") else entry["pattern"] in text
                if hit:
                    raise Deny("E_GUARD_ENDPOINT", "A5", f"a denied endpoint ({str(entry.get('reason'))[:120]})")
        if self.is_shell:
            for entry in pol.get("deny_commands") or []:
                if isinstance(entry, dict) and isinstance(entry.get("pattern"), str) \
                        and _search(entry["pattern"], self.command):
                    raise Deny("E_GUARD_DENY_COMMAND", "A6", f"a denied command ({str(entry.get('reason'))[:120]})")
        self.rule_fence_read()
        for p in self.write_paths():
            rel = self.state_rel(p)
            if rel is not None and self.owned(rel):
                raise Deny("E_GUARD_STATE_PATH", "A8", f"only exec.py writes .execution/{rel}; "
                           + ("use the exec.py command that owns it" if main_thread else
                              "write your result to your inbox and run exec.py result put"))
            for name in ("settings.local.json", "settings.json"):
                if hc.norm(p) == hc.norm(f"{hc.posix(self.env.repo)}/.claude/{name}"):
                    raise Deny("E_GUARD_PROTECTED", "A9", f".claude/{name} is written only by exec.py hooks "
                               "install/uninstall")
        if main_thread and self.is_shell:
            for seg in self.segments():
                call = exec_call(seg)
                if call is None:
                    continue
                if call.command in ("proof verdict", "snapshot"):
                    raise Deny("E_GUARD_COMMAND_ROLE", "A10", f"exec.py {call.command} is run by agents only (the "
                               "orchestrator never writes a receipt)")
                if call.by is not None and call.by != "orchestrator" and not (
                        call.command in DEV_BY_COMMANDS and call.by in DEV_NAMES):
                    raise Deny("E_GUARD_COMMAND_ROLE", "A10", f"exec.py with --by {call.by[:30]} from the main "
                               "thread (the orchestrator acts as orchestrator only)")
            if self.tool == "PowerShell":
                for seg in self.segments():
                    if exec_call(seg) is not None or git_info(seg) is not None:
                        raise Deny("E_GUARD_COMMAND_ROLE", "A11", "run exec.py and git through the Bash tool, never "
                                   "PowerShell")

    def rule_fence_read(self) -> None:
        fences = [g for g in ((self.policy().get("fences") or {}).get("deny_read") or []) if isinstance(g, str)]
        if not fences:
            return
        candidates: list[str] = []
        if self.tool in READ_TOOLS:
            for key in ("file_path", "notebook_path", "path"):
                val = self.ti.get(key)
                if isinstance(val, str) and val:
                    p = resolve_path(val, self.cwd)
                    if p:
                        candidates.append(p)
            if self.tool == "Glob" and isinstance(self.ti.get("pattern"), str):
                pat = self.ti["pattern"].replace("\\", "/")
                root = re.split(r"[*?\[{]", pat, maxsplit=1)[0]
                base = self.ti.get("path") if isinstance(self.ti.get("path"), str) else self.cwd
                p = resolve_path(root or ".", base) if not re.match(r"^([A-Za-z]:/|/)", root) else \
                    resolve_path(root, self.cwd)
                if p:
                    candidates.append(p)
        elif self.is_shell:
            for seg in self.segments():
                vi = verb_index(seg.words)
                if vi < 0 or basename_lower(seg.words[vi]) not in READ_VERBS:
                    continue
                for w in non_flags(seg.words[vi + 1:]):
                    p = resolve_path(w, seg.cwd)
                    if p:
                        candidates.append(p)
        for p in candidates:
            for g in fences:
                if glob_match(g, p) or _under_glob_root(g, p):
                    raise Deny("E_GUARD_FENCE_READ", "A7", f"{p} is under a read fence ({g})")

    def rules_agents(self, role: str) -> None:
        S = self.S
        allowed_state: list[str] = ["local/inbox"]
        if role == "execution-implementer":
            allowed_state.append("frontend")
        if role == "execution-planner":
            allowed_state.append("local/planner")
        writes = self.write_paths()
        for p in writes:
            rel = self.state_rel(p)
            if rel is not None and not any(rel == a or rel.startswith(a + "/") for a in allowed_state):
                raise Deny("E_GUARD_STATE_PATH", "B1", f"agents write under .execution/ only to their inbox "
                           f"(refused: .execution/{rel}); write your result to the inbox and run exec.py result put")
        if self.is_shell:
            for seg in self.segments():
                info = git_info(seg)
                if info is None:
                    continue
                sub, rest, targets = info
                read_only = sub in GIT_READ_ONLY or (sub == "branch" and "--show-current" in rest)
                for t in targets + [seg.cwd]:
                    p = resolve_path(t, seg.cwd) if t != seg.cwd else hc.posix(os.path.normpath(t))
                    if p and hc.under(p, S) and not read_only:
                        raise Deny("E_GUARD_STATE_PATH", "B2", f"git {sub} inside the state repository is run by "
                                   "exec.py only")
        fences = self.policy().get("fences") or {}
        if fences.get("deny_write_outside_repo") is True:
            roots = [hc.posix(self.env.repo)] + [f"{S}/{a}" for a in allowed_state]
            scratch = self.scratch_project()
            if scratch:
                roots.append(scratch)
            roots += [g for g in (fences.get("allow_write_outside") or []) if isinstance(g, str)]
            for p in writes:
                if any(hc.under(p, r) for r in roots):
                    continue
                root = checkout_root(p)
                if root and is_worktree_of(root, self.env.repo):
                    continue
                raise Deny("E_GUARD_WRITE_OUTSIDE", "B3", f"writing {p} outside the repository and the allowed "
                           "directories")
        for p in writes:
            root = checkout_root(p)
            rel = hc.rel_to(p, root) if root else None
            if rel is not None and (glob_match(".claude/**", rel) or glob_match(".githooks/**", rel)
                                    or glob_match(".git/**", rel)):
                raise Deny("E_GUARD_PROTECTED", "B4", f"{rel} is protected (.claude, .githooks and .git are not "
                           "written by agents)")
        if self.is_shell:
            for seg in self.segments():
                call = exec_call(seg)
                if call is None:
                    continue
                if call.by == "orchestrator":
                    raise Deny("E_GUARD_COMMAND_ROLE", "B5", "an agent never runs exec.py with --by orchestrator")
                if not command_allowed(call, ROLE_COMMANDS.get(role, frozenset())):
                    shown = call.command or "(no command)"
                    raise Deny("E_GUARD_COMMAND_ROLE", "B5", f"exec.py {shown} is not allowed for {role} "
                               "(SCHEMAS.md 5.3)")
        if self.tool in CONNECTOR_TOOLS:
            raise Deny("E_GUARD_CONNECTOR", "B6", f"{self.tool} is for the orchestrator only")
        if self.tool.startswith("mcp__"):
            parts = self.tool.split("__")
            server = parts[1] if len(parts) > 1 else ""
            name = "__".join(parts[2:]) if len(parts) > 2 else ""
            if server in CONNECTOR_SERVERS or MCP_WRITE_RE.search(name):
                raise Deny("E_GUARD_CONNECTOR", "B7", f"the connector tool {self.tool[:80]} is for the orchestrator "
                           "only")
        if self.is_shell:
            for line in self.command.split("\n"):
                if not HEREDOC_OP_RE.search(line):
                    continue
                head = HEREDOC_OP_RE.split(line, maxsplit=1)
                rest_line = "".join(head)
                if re.search(r"(?<![0-9&])>(?!&)|\btee\b", rest_line.replace("2>&1", "").replace(">/dev/null", "")):
                    raise Deny("E_GUARD_COMMAND_ROLE", "B8", "files are written with the Write tool, never through "
                               "a here-document")
            for seg in self.segments():
                if exec_call(seg) is not None:
                    continue
                for w in seg.words + seg.redirect_targets:
                    for cand in [w] + PATHISH_RE.findall(w):
                        p = resolve_path(cand.strip("'\"()"), seg.cwd)
                        if not p:
                            continue
                        rel = self.state_rel(p)
                        if rel is not None and rel != "" and not any(rel == a or rel.startswith(a + "/")
                                                                     for a in allowed_state):
                            raise Deny("E_GUARD_STATE_PATH", "B9", f"a shell command names .execution/{rel}; state "
                                       "files are read with the Read tool and written by exec.py only")

    def rules_role(self, role: str) -> None:
        writes = self.write_paths()
        if role in ("execution-implementer", "generic") and writes:
            globs = self.protected_globs()
            for p in writes:
                root = checkout_root(p) or hc.posix(self.env.repo)
                rel = hc.rel_to(p, root)
                if rel is not None and any(glob_match(g, rel) for g in globs):
                    raise Deny("E_GUARD_PROTECTED", "C", f"{rel} matches a protected glob of the plan (written by "
                               "the test designer only)")
        scratch = self.scratch_project()
        review_root = f"{scratch}/review" if scratch else None
        if role in READ_ONLY_ROLES:
            inbox = f"{self.S}/local/inbox"
            for p in writes:
                if hc.under(p, inbox):
                    continue
                if role == "execution-reviewer" and review_root and hc.under(p, review_root):
                    continue
                raise Deny("E_GUARD_PROTECTED", "C", f"{role} writes only its inbox (refused: {p})")
            if self.is_shell:
                for seg in self.segments():
                    info = git_info(seg)
                    if info is None:
                        continue
                    sub, rest, targets = info
                    bad = sub in ROLE_FORBIDDEN_GIT or (sub == "worktree" and rest[:1] and rest[0] in
                                                        ("add", "remove")) or \
                        (sub == "branch" and any(f in rest for f in ("-d", "-D", "-m")))
                    if not bad:
                        continue
                    if role == "execution-reviewer" and review_root:
                        where = [resolve_path(t, seg.cwd) for t in targets] if targets else [seg.cwd]
                        if where and all(w and hc.under(w, review_root) for w in where):
                            continue
                    raise Deny("E_GUARD_COMMAND_ROLE", "C", f"git {sub} is not run by {role}")
        if role == "execution-planner":
            for p in writes:
                if not (hc.under(p, f"{self.S}/local/planner") or hc.under(p, f"{self.S}/local/inbox")):
                    raise Deny("E_GUARD_PROTECTED", "C", "the planner writes only its draft and its inbox")


def _search(pattern: str, text: str) -> bool:
    try:
        return re.search(pattern, text) is not None
    except re.error:
        return pattern in text


def _under_glob_root(glob: str, path: str) -> bool:
    """A path inside the literal directory of a `<dir>/**` fence."""
    if not glob.endswith("/**"):
        return False
    root = glob[:-3]
    if re.search(r"[*?\[{]", root):
        return False
    return hc.under(path, root)


def parse_as(argv: list[str]) -> str | None:
    if "--as" in argv:
        i = argv.index("--as")
        if i + 1 < len(argv):
            return argv[i + 1]
    return None


def attest(guard: Guard) -> None:
    for seg in guard.segments():
        call = exec_call(seg)
        if call is None or call.command not in ("proof verdict", "merge"):
            continue
        data = {"agent_id": guard.payload.get("agent_id"), "agent_type": guard.payload.get("agent_type"),
                "role": guard.role, "command": call.command, "task": call.values.get("--task"),
                "at": hc.fmt_utc(hc.utcnow())}
        if call.command == "proof verdict":
            data["run"] = call.values.get("--run")
        else:
            data["attempt"] = call.values.get("--attempt")
        hc.append_event(guard.env, HOOK, "guard.attest", guard.payload, data)


def binding(env: hc.HookEnv, payload: dict, guard: Guard) -> bool:
    """HOOKS.md 8.2 rule 2. True when the call was a binding canary (allowed, nothing else checked)."""
    if guard.tool not in SHELL_TOOLS:
        return False
    m = BIND_RE.search(guard.command)
    if not m or m.group(1) != env.marker.get("bind_nonce"):
        return False
    sid = payload.get("session_id")
    base = {"layer": "settings", "session_id": sid, "permission_mode": payload.get("permission_mode"),
            "hook_seen_utc": hc.fmt_utc(hc.utcnow()), "latency_ms": hc.elapsed_ms()}
    bound_to = env.marker.get("session_id")
    if bound_to is None and sid:
        hc.update_marker(env, {"session_id": sid})
        hc.append_event(env, HOOK, "hooks.bound", payload, {"session_id": sid})
        hc.append_event(env, HOOK, "hooks.canary", payload, {**base, "bound": True})
    elif bound_to == sid:
        hc.append_event(env, HOOK, "hooks.canary", payload, {**base, "bound": True, "rebind": False})
    else:
        hc.append_event(env, HOOK, "hooks.canary", payload, {**base, "bound": False,
                                                             "refused": "bound to another session"})
    return True


def run_lease(guard: Guard) -> None:
    if not guard.is_shell:
        return
    for seg in guard.segments():
        call = exec_call(seg)
        if call is None or call.command not in hc.ORCHESTRATOR_ONLY:
            continue
        if command_allowed(call, LEASE_ALLOWED):
            continue
        raise Deny("E_GUARD_RUN_LEASE", "2b", "this run is bound to another session; run exec.py resume --takeover "
                   "(then close the other session or CronDelete its heartbeat).")


def probe(env: hc.HookEnv, payload: dict, guard: Guard) -> bool:
    if guard.tool != "Bash":
        return False
    m = re.match(r"^\s*echo\s+execution-probe\s+([0-9a-f]{16})\s+([a-z-]+)\s*$", guard.command)
    if not m or m.group(1) != env.marker.get("bind_nonce"):
        return False
    role = guard.resolve_role()
    hc.append_event(env, HOOK, "hooks.canary", payload,
                    {"probe": True, "layer": guard.layer, "as_role": guard.as_role, "named": m.group(2),
                     "agent_type": payload.get("agent_type"), "role_resolved": role,
                     "session_id": payload.get("session_id")})
    return True


def deny(guard: Guard, err: Deny) -> None:
    hc.append_event(guard.env, HOOK, "guard.deny", guard.payload, {
        "tool": guard.tool, "rule": err.rule, "code": err.code, "role": guard.role,
        "agent_type": guard.payload.get("agent_type"), "layer": guard.layer,
        "command_head": hc.redact(guard.command)[:120] if guard.command else None})
    hc.emit_deny(err.reason())


def main() -> None:
    payload = hc.read_payload()
    env = hc.locate(payload)
    if env is None:
        return
    guard = Guard(env, payload, parse_as(sys.argv[1:]))
    if not hc.is_agent(payload):
        if binding(env, payload, guard):
            return
        if hc.binding_pending(env, payload):
            return
        if hc.other_session(env, payload):
            guard.role = "other-session"
            try:
                run_lease(guard)
            except Deny as err:
                deny(guard, err)
            return
        guard.role = "orchestrator"
        try:
            guard.rules_everyone(main_thread=True)
        except Deny as err:
            deny(guard, err)
        return
    if not hc.agent_in_run(env, payload):
        return
    if probe(env, payload, guard):
        return
    guard.role = guard.resolve_role()
    try:
        guard.rules_everyone(main_thread=False)
        guard.rules_agents(guard.role)
        guard.rules_role(guard.role)
    except Deny as err:
        deny(guard, err)
        return
    if guard.is_shell:
        attest(guard)


if __name__ == "__main__":
    hc.fail_open(main, HOOK)
