# HOOKS.md — the durable hooks of /execution

Companion file (README.md 1.2). It refines MODULES.md section 6 (`hookcore.py`, `scripts/hooks/*.py`) and CLI.md
`hooks install | canary | uninstall`; it never changes them. Where this file needed something the core does not
define, the gap was listed in section 14; revision 2 settled them (README.md 10), and builders implement this file
as written. Owner lane: B08 (every file named here), except the agent-definition hook entries (section 11.4), rendered
by B10.

Contents: 1 principles · 2 the common gate · 3 payloads · 4 Stop gate · 5 SessionStart · 6 SessionEnd ·
7 StopFailure · 8 PreToolUse guard · 9 UserPromptSubmit · 10 files the hooks write · 11 installation ·
12 launcher · 13 canaries and the start-of-run probe · 14 open points · 15 test fixtures.

---

## 1. Principles

1. **Settings hooks, not skill hooks.** Skill-frontmatter hooks vanish on `/clear`, a restart or a resume, their
   SessionStart and PreCompact never fire, and they do not see workflow agents' tool calls [hooks F07-F09]. Every hook
   below lives in `<repo>/.claude/settings.local.json`, written by `exec.py hooks install` at run start and removed by
   `hooks uninstall` / `handover` [hooks F22]. The repo root is the session's starting directory (Windows reads
   settings from there, not from the git root) [hooks V-F22].
2. **Exit 0, always.** A decision is JSON on stdout; an internal error fails open after a log line (the house pattern
   of `~/.claude/hooks/guard.py`). No hook of ours ever exits 2: for Stop it leaks the command line into the model's
   context and raises an error notice [hooks F11]; for PreToolUse the JSON deny is equivalent and cleaner.
3. **Gated twice.** No `.execution/local/active` → silent exit 0. Then the session id: the orchestrator is the one
   session whose id is in the marker; another main-thread session in the same repository (a second terminal, a probe
   session) gets only the run lease (8.2: it cannot run orchestrator-only commands); an **agent** call (payload
   `agent_id` present) is guarded when it belongs to this run (2.2), so /harden's or /frontend's own subagents in a
   second session are left alone.
4. **Cheap.** No subprocess (git, node, PowerShell are never started by a hook), at most eight small file reads, p95
   ≤ 250 ms per call on this machine including the Git Bash launcher (MODULES.md 6). They run for every matching tool
   call of every agent [hooks F30, risk 11].
5. **Not a security boundary.** The guard sees one tool call with a best-effort tokenizer, like /harden's
   `hook_guard.py`. What stands behind it: `disallowedTools` in the agent definitions (binding in bypass mode
   [hooks F23]), exec.py's own checks (merge scans, verdict checks, the done check), git (push is the CAS), the global
   `guard.py`, and the owner reading the reports. A guard rule never replaces one of those; it only fails a mistake
   earlier.
6. **Stdlib only**, `python -S` (no site import), `from __future__ import annotations`, type hints, dataclasses,
   pathlib. Each hook script is a thin `main()` around `hookcore` functions, wrapped in `hookcore.fail_open`.

---

## 2. The common gate (`hookcore`)

### 2.1 Locating the run (`hookcore.locate(payload) -> HookEnv | None`)
Candidates, in order, the first that yields a marker wins:
1. The tool target's directory for file tools (`tool_input.file_path`, `notebook_path`, `path`), then payload `cwd`.
   From each, walk up parent directories (at most 12 levels) looking for `.execution/local/active`. The walk crosses
   a worktree root: when a directory holds a `.git` **file** (`gitdir: <path>/.git/worktrees/<name>`), the main
   repository is `<path>` and is tried next. Claude-managed agent worktrees live under `<repo>/.claude/worktrees/<name>/`
   [par F08 evidence], so the plain walk reaches `<repo>` anyway; the gitdir rule covers worktrees created elsewhere
   (the /frontend critique worktree under the scratch root, WAVES.md 6.4).
2. `CLAUDE_PROJECT_DIR` (exported to settings hooks [hooks F05]): `<it>/.execution/local/active`.
3. None found → `None` → the hook exits 0 with no output and writes nothing.

`HookEnv = {state_dir, repo, marker, layout_local}` comes from the marker itself (`repo`, `state_dir` are absolute in
it), never from the walk, so a hook started in a worktree still writes to the main state dir.

### 2.2 Who is calling
| case | test | treatment |
|---|---|---|
| orchestrator | no `agent_id` in the payload AND `marker.session_id` non-null AND equal to payload `session_id` | full hook behaviour |
| binding pending | no `agent_id` AND `marker.session_id` is null | only the binding rule (8.2) and nothing else |
| agent of this run | `agent_id` present AND (payload `session_id` ∈ {`marker.session_id`} ∪ `previous_session_ids`, OR local state `hooks.agent_session_scoped` is false and `<repo>/.harden/active` is absent) | PreToolUse guard (8); every other hook: exit 0 |
| foreign agent | `agent_id` present and not of this run | exit 0, nothing written (a /harden or /frontend session's subagents in the same repository) |
| other session | no `agent_id`, session id differs from a non-null `marker.session_id` | PreToolUse: the run lease only (8.2 rule 2b); every other hook: exit 0, no output, nothing written |

Session ids: a workflow agent's payload carries its parent session's id (observed on 2026-10-01: a workflow agent's
`CLAUDE_CODE_SESSION_ID` equals the launching session's uuid). The start-of-run probe (13.3) measures it on the pinned
version and records `hooks.agent_session_scoped`; until a probe has passed in this run the value is false, so every
agent in the repository is guarded (the conservative reading), except while `.harden/active` exists. `/clear` gives a
new id (re-keyed by 5); `claude --resume` and a compaction keep it; any other restart is a new session that takes over
only through `exec.py resume --takeover` (CLI.md), never by itself.

### 2.3 Failing open (`hookcore.fail_open(main, hook)`)
Any exception (unreadable JSON, corrupt marker, I/O error, a bug) → one JSON line appended to
`<state>/local/hook-errors.log` (else `~/.claude/hooks/execution-hooks.log` when the state dir is unknown) and the
same line on stderr, then exit 0 with nothing on stdout. Line format (README.md 2 logging rules):
```json
{"ts":"2026-10-06T08:15:00.123Z","level":"error","module":"hook.stop-gate","msg":"internal error, failed open","exc":"KeyError: 'tasks'","trace":"<traceback, newlines as \\n, at most 4000 chars, through log.redact>"}
```
A failed-open PreToolUse means the tool call proceeds unguarded; the orchestrator sees it at the next `exec.py
status`, which counts `hook-errors.log` lines newer than the last tick and puts `hooks: N internal errors` in the
digest (B04 reads, B08 writes). A hook never writes stdout before its decision is final (a partial JSON would be
read as output).

### 2.4 Reading files
`hookcore.read_json_quiet(path)` returns `None` for a missing file and raises for a corrupt one (so the caller fails
open with a log instead of acting on half a document). Files a hook may read: `local/active`, `local/state.json`,
`local/hooks-state.json`, `local/schedule.json`, `local/digest.txt`, `policy.json`, `plan.json` (only its `protected`
array and only for agent write tools), `profile.json` (only `machine.scratch_root` and `project`), and the skill's
`assets/report-templates/push.fr.json` (4.3). Never a secret, never the never-show file (its matched text must not
travel through a hook). A read that meets `PermissionError` (exec.py replacing the file at that instant) is retried 3
times 20 ms apart, then the hook fails open.

### 2.5 Time
`hookcore.utcnow()` = `datetime.now(timezone.utc)`, overridable by `EXEC_NOW` only when `EXEC_TEST=1` is also set
(tests; a leaked `EXEC_NOW` alone would freeze the gate's clock). Stored as `YYYY-MM-DDTHH:MM:SSZ`; hook events use
microseconds (`utc_precise`).

### 2.6 Bytes in, ASCII out
Hooks run as `python -S` with stdin and stdout as pipes, which Python 3.13 on Windows decodes as cp1252 (measured).
`hookcore.read_payload` reads `sys.stdin.buffer` and decodes UTF-8; `hookcore.emit` writes
`json.dumps(obj, ensure_ascii=True)` encoded as ASCII to `sys.stdout.buffer`, so French text, emoji, `≤`, `→` or
U+202F in a digest or a reason never meets the code page. The launcher also exports `PYTHONUTF8=1` (12).

---

## 3. Payload fields parsed (exactly these; anything else is ignored)

| event | fields read | notes |
|---|---|---|
| all | `session_id`, `hook_event_name`, `cwd`, `agent_id` (absent on the main thread), `agent_type` | `CLAUDE_PROJECT_DIR` from the environment |
| Stop | `stop_hook_active` (bool), `background_tasks` (array **or absent**), `session_crons` (array **or absent**) | `transcript_path`, `prompt_id`, `permission_mode`, `effort`, `last_assistant_message` are not used; there is no `stop_reason` key [hooks F14] |
| SessionStart | `source` ∈ startup, resume, clear, compact | |
| SessionEnd | `reason` (clear, logout, prompt_input_exit, other) | |
| StopFailure | `error` (string enum: `rate_limit`, `overloaded`, `authentication_failed`, `billing_error`, `max_output_tokens`, ...) and the optional `error_details`, as the hooks documentation states them; plus the sorted list of top-level keys (names only, never values) | the rehearsal captures a real payload into the fixtures (15) |
| PreToolUse | `tool_name`, `tool_input` (`command`, `file_path`, `notebook_path`, `path`, `pattern`, `glob`, `url`), `permission_mode` (recorded by the binding canary: PF-20) | |
| UserPromptSubmit | `prompt` | |

`background_tasks` items are read as the documented `{id, type, status, description, ...}` (also `command`,
`agent_type`, `server`, `tool`, `name`, any of which may be absent); an item counts as **running** when `status` is
one of `running`, `pending`, `queued`, `in_progress` (case-insensitive), whatever its `type` (workflow, agent, shell,
monitor...): every such item is a wake source. `session_crons` items are read as the documented `{id, schedule,
recurring, prompt}` (`cron` accepted as an alias of `schedule`); the heartbeat is found by a string field `prompt`
that starts with `execution heartbeat` (case-insensitive, leading whitespace ignored) and a `recurring` field that is
not `false`. The two arrays may be **absent**: absent means unknown, never empty [rt V-F17].

---

## 4. Stop gate (`scripts/hooks/stop_gate.py`)

### 4.1 Decision table (evaluated in this order; the first matching row decides)
| # | condition | decision | hooks-state / event |
|---|---|---|---|
| 0 | no marker, or not the orchestrator (2.2) | exit 0, no output | nothing |
| 1 | `stop_hook_active` is false | (no decision) set `consecutive_continuations = 0`, continue | — |
| 2 | `background_tasks` present and holds a running item | **allow** | counter 0; `stop.allow {reason: "running", items: [names]}` |
| 3 | `run_state` (local/state.json) ∈ {INIT, PREFLIGHT, INGEST, PLAN} | **allow** (set-up phases are interactive; nothing approved can run) | counter 0; `stop.allow {reason: "setup"}` |
| 4 | `run_state` ∈ {BUILD_COMPLETE, HANDED_OVER, STUCK} | **allow** | counter 0; `stop.allow {reason: "terminal-or-stuck"}` |
| 5 | (`awaiting` non-empty, or `run_state` ∈ {AWAIT_APPROVAL, AWAITING_HUMAN, AWAITING_DECISION, PAUSED_QUOTA, PAUSED_RESOURCES}) AND the heartbeat is armed (4.2) | **allow** | counter 0; `stop.allow {reason: "awaiting", refs: [...]}` |
| 6 | nothing can be launched now — `local/schedule.json` `ready` is empty, or local state's governor decision is `pause`, or its quota decision is `pause` — AND the heartbeat is armed | **allow** (idle and armed: waiting for dev B's receipt, a `due` item, a release instant or a reset; continuing would only produce a false STUCK) | counter 0; `stop.allow {reason: "idle-armed"}` |
| 7 | `background_tasks` **absent** AND local state has a wave with `status: launched` and `finished_utc` null AND the heartbeat is armed | **allow** (unknown, and a launched wave or the heartbeat will wake us; in RUNNING the heartbeat is always armed, so a wave that died with the old process is still caught) | counter 0; `stop.allow {reason: "wave-launched-unknown-bg"}` |
| 8 | otherwise, `consecutive_continuations + 1 > 4` | **allow** and record STUCK | counter 0; `stuck = {at_utc, reason: "stop-gate: 5th consecutive stop with the plan open and nothing armed", source: "stop-gate"}`; `stop.stuck` |
| 9 | otherwise | **continue** (4.3) | counter + 1, `last_continuation_utc`; `stop.continue {n}` |

The gate continues only when runnable work exists and can be launched, or when no wake source is armed [loops rec 5,
rt rec 2].

Every row from 2 on also writes `last_stop_utc` (the Stop-side liveness canary, 13.2). An allow prints nothing.

### 4.2 "The heartbeat is armed"
- `session_crons` present: true iff it holds the heartbeat item (section 3).
- `session_crons` absent: true iff `local/state.json.heartbeat.cron_id` is non-null, `heartbeat.session_id` equals
  `marker.session_id` (crons are session-scoped and restored only by `claude --resume` of that session [rt F12-F13]),
  and `heartbeat.recorded_utc` is within the last 7 days (crons expire after 7 days). This is the only place the gate
  trusts the recorded cron; `exec.py heartbeat record` writes it after the orchestrator's CronCreate, and a re-key
  (5) or `resume --takeover` clears it (CLI.md `heartbeat record`).

### 4.3 The continuation (exact stdout, one line, no other output)
```json
{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"<text>"}}
```
Never `decision: "block"` (it raises a "Stop hook error" notice and blanks a -p result at the cap [hooks V-F11,
V-F12]), never exit 2. `<text>` ≤ 600 characters, English (it addresses the model), built only from local files, with
`<EXEC>` = this machine's absolute `python "<SKILL_DIR>/scripts/exec.py"`. When something can launch:
```
execution: the plan is open and nothing is armed (continuation <n>/4). Ready: <up to 8 ids from local/schedule.json ready[].task>. Awaiting: <up to 5 refs, or "none">. Run <EXEC> status, then <EXEC> wave emit or <EXEC> manual post, and arm the heartbeat (<EXEC> heartbeat plan, then CronCreate, then <EXEC> heartbeat record).
```
When nothing can launch (row 6 failed only because no heartbeat is armed), the text names the heartbeat only:
```
execution: nothing can launch now and no wake source is armed (continuation <n>/4). Arm the heartbeat: <EXEC> heartbeat plan, then CronCreate with its arguments, then <EXEC> heartbeat record.
```
On continuation 4 (the last one before STUCK) the text appends: ` This is the last continuation: if you cannot arm a
wake source now, send PushNotification "<push text>" before ending the turn.`, where `<push text>` is the French
`stuck` entry of `assets/report-templates/push.fr.json` (B09) rendered with the project name, e.g. `execution
BLOQUÉ : <projet> a besoin de toi à l'ordinateur` (≤ 200 characters; it reaches stdout as ASCII-escaped JSON, 2.6).
(The hook cannot push; the orchestrator can, and only on this turn does a stuck stop still reach the phone.)

### 4.4 Counter and STUCK
- `consecutive_continuations` lives in `local/hooks-state.json` (schema `#/$defs/hooks_state`, maximum 8). It is set
  to 0 by row 1 and by every allow; it only grows across consecutive continuation turns (`stop_hook_active` true).
  Our cap (4) stays below the built-in 8-continuation cap, so the platform never overrides silently [hooks F12].
- STUCK is recorded only in hooks-state and as a `stop.stuck` hook event. `exec.py status` imports the event, sets
  `run_state = STUCK` (source stop-gate) and clears `hooks-state.stuck` once imported (CLI.md status). Row 4 then
  allows every later stop until the orchestrator leaves STUCK (`status` derives RUNNING again once a wake source
  exists), so a stuck session does not loop.
- The orchestrator's next tick (heartbeat, owner message or wave completion) reads STUCK in the digest and alerts.

---

## 5. SessionStart (`scripts/hooks/session_start.py`, matcher `startup|resume|clear|compact`)

| source | condition | action | stdout |
|---|---|---|---|
| clear | marker `rekey_armed_until_utc` non-null and in the future | **re-key**: append the old `session_id` to `previous_session_ids` (keep the last 10), set `session_id` = payload id, `rekey_armed_until_utc` = null; `hooks-state.consecutive_continuations` = 0; the recorded heartbeat no longer counts (its `session_id` is the old one, 4.2); event `hooks.rekeyed {from, to}` | then as "orchestrator" below, with the resume line |
| clear | not armed, or expired | nothing (a `/clear` in another session never steals the run) | none |
| any | orchestrator session (after a re-key if any) | event `session.start {source}` | the digest context (5.1) |
| any | binding pending, other session, or agent | nothing | none |

### 5.1 The context (exact stdout)
```json
{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<text>"}}
```
`<text>` ≤ 2,000 characters (platform cap 10,000; target ~2,000 [hooks F16]):
```
/execution run active: project <project>, executor <A|B>, run_state <state> (source <source>).
EXEC = python "<SKILL_DIR>/scripts/exec.py"  (in SKILL.md and the references, "exec.py <command>" means "<EXEC> <command>")
State digest, written <age, e.g. "7 min ago" or "unknown age"> by exec.py status:
<local/digest.txt, cut at a line boundary so the whole text fits>
Before anything else: re-read <SKILL_DIR>/SKILL.md (standing rules, state machine, tick) and <SKILL_DIR>/references/tick.md, then run <EXEC> status. Do not rely on memory of this conversation for task states.
```
`<SKILL_DIR>` is this machine's absolute skill path (`paths.SKILL_DIR`, forward slashes): after `/clear` or a
compaction that dropped the skill body, `${CLAUDE_SKILL_DIR}` in a re-read SKILL.md is literal, and the skill is not
model-invocable, so the absolute command is the only one that works. When `local/digest.txt` is absent: the digest
lines become `No digest yet; run_state from local/state.json: <state>.` For source `resume`, and for source `clear`
after a re-key, the text adds (one line): `After a resume or a /clear: run <EXEC> resume (it classifies launched
waves against the current session id: resumeFromRunId works only in the launching session), then CronList (recreate
the heartbeat with <EXEC> heartbeat plan if it is missing; after a /clear it is not counted until re-recorded), then
<EXEC> hooks canary --nonce <marker bind_nonce>.` — the nonce is printed only to the orchestrator session, which is
the one allowed to bind.

Only SessionStart(compact) proves that a compaction happened; PreCompact is never used [hooks F16].

---

## 6. SessionEnd (`scripts/hooks/session_end.py`)
Orchestrator session with `reason == "clear"` → `marker.rekey_armed_until_utc = now + 120 s` (atomic marker write,
only that field). Anything else → nothing. No stdout (SessionEnd has no output channel). `/clear` can be sent from the
phone [hooks V-F07]; this hand-off keeps the run keyed to the new session id [hooks missed-6].

---

## 7. StopFailure (`scripts/hooks/stop_failure.py`)
An API-error turn ending (rate_limit, overloaded, authentication_failed, billing_error, max_output_tokens) fires
StopFailure instead of Stop, so the gate never sees it [hooks missed-7].
- Payload with `agent_id` (vendor #91419: it also fires for helper and subagent failures) → event
  `stop.failure {agent: true, error}` only; never STUCK.
- Orchestrator session → event `stop.failure {error, error_details, keys: [payload key names]}` always; and, when
  `error` is not `rate_limit`, `hooks-state.stuck = {at_utc, reason: "stop-failure: <error>", source:
  "stop-failure"}`. No stdout (no decision control). Helper calls of the main session (title generation, compaction
  helpers) may arrive without `agent_id`: `exec.py status` therefore drops a `stop-failure` stuck record when a later
  `stop.*` event of the same session exists (the turn went on and ended normally), so a helper's transient
  `overloaded` never becomes a false STUCK. The heartbeat (or the owner) wakes the session; the tick reads STUCK and
  alerts. A `rate_limit` error is quota evidence (CLI.md `quota` rule 1: PAUSED_QUOTA until the reset), never STUCK
  (vendor #98012: rate_limit covers both a resumable limit and a credits condition).

---

## 8. PreToolUse guard (`scripts/hooks/pre_tool_guard.py`)

### 8.1 Invocation layers
| layer | where | command | role source |
|---|---|---|---|
| settings | `<repo>/.claude/settings.local.json` (section 11) | `... py.sh pre_tool_guard.py` | payload `agent_type` |
| agent | each /execution agent definition's `hooks.PreToolUse` (AGENTS.md 3) | `... py.sh pre_tool_guard.py --as <agent name>` | `--as`, cross-checked with `agent_type` |

Both layers may fire for one call; the platform applies the most restrictive decision [hooks F10]. The rules are
pure functions of (role, tool call, files), so the two layers agree whenever they resolve the same role.

### 8.2 Order of evaluation
1. Locate (2.1). No marker → exit 0.
2. **Binding rule** (main thread only: no `agent_id`). Tool Bash or PowerShell, and the command matches
   `exec\.py["']?\s+hooks\s+canary\s+--nonce\s+([0-9a-f]{16})\b` with the captured nonce equal to
   `marker.bind_nonce`:
   - `marker.session_id` null → write `session_id` = payload id (atomic, only that field), events `hooks.bound
     {session_id}` and `hooks.canary {layer: "settings", bound: true, latency_ms}` → **allow** (no output).
   - `session_id` equal to the payload id → event `hooks.canary {bound: true, rebind: false}` → allow.
   - `session_id` different → event `hooks.canary {bound: false, refused: "bound to another session"}` → allow
     (the command itself then reports `bound: false`, exit 1, with the hint `exec.py resume --takeover`).
   Every `hooks.canary` event records the payload's `session_id` and `permission_mode` (PF-20, CLI.md `hooks
   canary`). `bind_nonce` is kept after binding (the canary is re-run at every resume and before each wave);
   `exec.py resume --takeover` and `hooks install` (when the marker has no session) write a fresh one.
2b. **Run lease** (main thread of another session, marker bound to a different id): Bash commands that run an
   orchestrator-only exec.py subcommand (SCHEMAS.md 5.3) are denied with `E_GUARD_RUN_LEASE: this run is bound to
   another session; run exec.py resume --takeover (then close the other session or CronDelete its heartbeat). Do not
   retry in another form.`; allowed there: `status --digest`, `validate`, `simulate`, `hooks canary` and `resume
   --takeover`. Nothing else is checked for that session. Two orchestrators of one executor can therefore never tick
   at once, and a recovery session takes over explicitly.
3. **Probe rule** (agents only): Bash command exactly of the form `echo execution-probe <bind_nonce> <agent name>`
   → event `hooks.canary {probe: true, layer, as_role, agent_type, role_resolved, session_id}` → allow (13.3).
4. **Role** (8.3). Main-thread calls of another session (after 2b), foreign agents, or binding pending: exit 0 here.
5. Rules of 8.4 in table order; the first deny wins. No deny → exit 0, no output.
6. **Attestation** (agents of this run, after an allow): a Bash call running `exec.py proof verdict` or `exec.py merge`
   writes a `guard.attest {agent_id, agent_type, command, task, run|attempt, at}` hook event (the words parsed as in
   8.5), which `proof verdict` requires (CLI.md).

### 8.3 Resolving the role
| caller | role |
|---|---|
| main thread, orchestrator session | `orchestrator` |
| agent, `--as X` given and X ∈ OURS ∪ THEIRS | X; if payload `agent_type` is also one of ours and differs from X → `generic` (a mismatch is suspicious) and a `guard.deny`-free `error` event `{as: X, agent_type}` |
| agent, no `--as`, `agent_type` ∈ OURS ∪ THEIRS | `agent_type` |
| agent, `agent_type` anything else (`workflow-subagent`, `general-purpose`, empty) | `generic` |

OURS = execution-planner, -test-designer, -implementer, -verifier, -reviewer; THEIRS = frontend-critic,
frontend-probe. `generic` gets the strictest agent rules: everything of `execution-implementer` minus `merge` (MODULES
6.5). Whether a workflow agent started with `agentType: X` reports `agent_type: X` to settings hooks is unverified
(the probes only saw `workflow-subagent` for agents started without one [hooks F09]); the start-of-run probe (13.3)
measures it before any wave.

### 8.4 Rules (codes from README.md 6; one-line reasons)
Notation: "write tools" = Write, Edit, MultiEdit, NotebookEdit; "Bash" means Bash and PowerShell (8.5 gives the
shell analysis); `S` = state dir; `R(p)` = path p relative to its checkout root (nearest ancestor holding `.git`).

**A. Everyone (orchestrator and every agent role)**
| # | rule | code |
|---|---|---|
| A1 | `git push` with `-f`, `--force`, `--force-with-lease`, `--force-if-includes`, `--mirror`, `--delete`, `-d`, a refspec starting with `+`, or a refspec starting with `:` (deletion) | E_GUARD_FORCE_PUSH |
| A2 | `git filter-branch`, `git filter-repo`, `git reset --hard origin...`, `git update-ref -d refs/heads/main`, `git branch -D main`/`-D master` | E_GUARD_FORCE_PUSH |
| A3 | any `git push` while `local/state.json.flags.push_frozen` is true or now ≥ `policy.git.push_freeze_utc` | E_GUARD_PUSH_FROZEN |
| A4 | Bash command matching any `policy.networks.mainnet.broadcast_patterns` regex while `mainnet.mode == "read-only"` or `flags.mainnet_open` is false | E_GUARD_MAINNET_CLOSED |
| A5 | a `policy.deny_endpoints` pattern (literal substring, or regex when `regex`) in a Bash command or a WebFetch `url` | E_GUARD_ENDPOINT |
| A6 | a `policy.deny_commands` regex in a Bash command | E_GUARD_DENY_COMMAND |
| A7 | Read / Grep / Glob / NotebookRead on a path (or Grep/Glob `path`, Glob `pattern` root) under a `policy.fences.deny_read` glob; Bash read verbs (the global guard's READ_VERBS plus `ls`, `find`, `dir`, `Get-ChildItem`) with a path token under one | E_GUARD_FENCE_READ |
| A8 | write tools, or a Bash write target (8.5), onto an exec.py-owned state file: `S/plan.json`, `S/status/**`, `S/proofs/**`, `S/events.jsonl`, `S/decisions.md`, `S/public-values.jsonl`, `S/answers/**`, `S/waves/**`, `S/briefs/**`, `S/fix/**`, `S/profile.json`, `S/policy.json`, `S/completion-check.mjs`, `S/gates.json`, `S/local/state.json`, `S/local/active`, `S/local/hooks-state.json`, `S/local/settings-backup.json`, `S/local/hook-events/**`, `S/local/results/**`, `S/local/proof-runs/**`, `S/local/harden-ready/**`, `S/local/completion/**`, `S/local/merge-gates/**`, `S/local/merge-pending/**`, `S/local/schedule.json`, `S/local/digest.txt`, `S/local/locks/**`, `S/local/probe/**` | E_GUARD_STATE_PATH |
| A9 | write tools or a Bash write target onto `<repo>/.claude/settings.local.json` or `<repo>/.claude/settings.json` | E_GUARD_PROTECTED |
| A10 | main thread: an `exec.py proof verdict` or `exec.py snapshot` segment, or any exec.py segment with `--by` other than `orchestrator` (the orchestrator never writes a receipt) | E_GUARD_COMMAND_ROLE |
| A11 | main thread: a PowerShell call that runs `exec.py` or `git` (the orchestrator uses the Bash tool for both, CLI.md preamble; one shell grammar) | E_GUARD_COMMAND_ROLE |

The orchestrator may Write `S/local/*.draft.json`, `S/local/planner/**`, `S/local/notion/results/**`,
`S/local/answers-in/**` (texts, quotes, choices and error texts it hands to exec.py through `--*-file`, CLI.md 0.7),
`S/frontend/choices.json` (from `decision resolve` / `answers ingest` data `frontend_choice`; the only `S/frontend/`
file it writes) and anything outside `S` that no rule above names. exec.py's own writes are subprocess writes the
hooks never see.

**B. Every agent (any role, `generic` included), in addition**
| # | rule | code |
|---|---|---|
| B1 | write tools or a Bash write target under `S/**` except `S/local/inbox/**`; `S/frontend/**` for roles execution-implementer (FE tasks and fragment runners); `S/local/planner/**` for execution-planner | E_GUARD_STATE_PATH |
| B2 | a `git` segment whose `-C` target or preceding `cd` target is inside `S`, unless its subcommand is read-only (`status`, `log`, `show`, `diff`, `rev-parse`, `ls-files`, `cat-file`, `merge-base`, `branch --show-current`) | E_GUARD_STATE_PATH |
| B3 | write tools or a Bash write target outside every allowed root when `policy.fences.deny_write_outside_repo` is true. Allowed roots: `<repo>`, each worktree of it (2.1 gitdir rule), `S/local/inbox/**` (and B1's exceptions), `<profile.machine.scratch_root>/<project>/**`, each `policy.fences.allow_write_outside` directory, the session scratchpad dir when the payload names one | E_GUARD_WRITE_OUTSIDE |
| B4 | write tools or a Bash write target whose `R(p)` matches `.claude/**`, `.githooks/**`, `.git/**` | E_GUARD_PROTECTED |
| B5 | an `exec.py` subcommand outside SCHEMAS.md 5.3 for the role (8.6), or any `--by orchestrator` | E_GUARD_COMMAND_ROLE |
| B6 | tools PushNotification, CronCreate, CronDelete, RemoteTrigger, SendMessage, Monitor, Artifact, ArtifactComments, ArtifactData, DesignSync, EnterWorktree, ExitWorktree | E_GUARD_CONNECTOR |
| B7 | `mcp__*` tools of the servers `claude_ai_Notion`, `claude_ai_Gmail`, `claude_ai_Google_Drive`, `claude_ai_Google_Calendar`, `claude_ai_Luma`, `claude_ai_Claude_Docs`, and any other `mcp__*` tool whose name after the server matches `(?i)(create|update|delete|send|add|move|upload|duplicate|trash|label|spawn|stop|track|reply|forward|apply|approve|reject|remove|invite|import|rebuild|batch|write|set)` | E_GUARD_CONNECTOR |
| B8 | a Bash command that writes a file through a here-document (`<<` with a redirection or `tee` in the same segment): files are written with the Write tool (LF, no backslash loss) | E_GUARD_COMMAND_ROLE |
| B9 | a Bash segment with a path token (absolute or relative to the payload `cwd`) under `S` outside `S/local/inbox/**` (and B1's exceptions for the role), unless the segment is an `exec.py` invocation: catches `python -c`, `node -e`, `cp` or `cat` aimed at state files the write-target analysis cannot see (still not a boundary, principle 5; briefs and receipts are read with the Read tool) | E_GUARD_STATE_PATH |

**C. By role, in addition**
| role | rule | code |
|---|---|---|
| execution-implementer, generic | write tools or Bash write target whose `R(p)` matches a `plan.protected` glob | E_GUARD_PROTECTED |
| generic | `exec.py merge` (B5 applies the implementer list minus merge) | E_GUARD_COMMAND_ROLE |
| execution-verifier, execution-reviewer, frontend-critic, frontend-probe | write tools or Bash write target anywhere except `S/local/inbox/**` and, for execution-reviewer only, `<scratch_root>/<project>/review/**` | E_GUARD_PROTECTED |
| same four | `git` subcommands `commit`, `push`, `rebase`, `reset`, `checkout`, `switch`, `stash`, `clean`, `merge`, `cherry-pick`, `revert`, `am`, `apply`, `tag`, `worktree add`/`remove`, `branch -d/-D/-m` — except, for execution-reviewer, when the `-C` target or `cd` target is under `<scratch_root>/<project>/review/` (planted-defect clones) | E_GUARD_COMMAND_ROLE |
| execution-test-designer | may write `plan.protected` globs (it authors them); B4 still applies | — |
| execution-planner | write tools only under `S/local/planner/**` and `S/local/inbox/**` (product repo read-only) | E_GUARD_PROTECTED |

### 8.5 Shell analysis (Bash and PowerShell)
Best-effort, same tokenizer family as `guard.py`, segments split on `&&`, `||`, `;`, `|`, `&`, newlines; a commit
message (heredoc body, `-m` strings) is stripped first exactly like `guard.without_commit_message`, so a message that
names a path or a rule never triggers a deny. Bash: `shlex` posix, regex fallback. **PowerShell**: `shlex` with
`posix=False` plus PowerShell quoting (single quotes literal, `` ` `` the escape character), never posix mode, so a
backslash path such as `C:\repo\.execution\plan.json` keeps its separators and is normalised below (a posix tokenizer
turns `C:\repo` into `C:repo` and every path rule would miss it).
- **Write targets**: redirections `>`, `>>`, `>|`, `N>` (not `2>&1`, not `>/dev/null`, not `> NUL`); `tee [-a]`
  arguments; destination of `cp`, `mv`, `install`, `Copy-Item`, `Move-Item`; arguments of `rm`, `rmdir`, `del`,
  `Remove-Item`, `truncate`, `touch`, `mkdir`; the file of `sed -i`; `Out-File`, `Set-Content`, `Add-Content`
  `-Path`/positional. Paths are normalised: quotes stripped, `~` expanded, `/c/x` → `C:/x`, backslashes → `/`,
  relative paths joined to payload `cwd` (and to the last `cd` target in the same command).
- **git**: `\bgit(\s+(-C\s+\S+|-c\s+\S+|--[\w-]+(=\S+)?))*\s+(?P<sub>[\w-]+)` per segment; flags are the tokens after
  the subcommand in that segment.
- **exec.py calls**: `exec\.py["']?\s+(?P<w1>[a-z-]+)(\s+(?P<w2>[a-z-]+))?` → the command words of CLI.md 9 (two-word
  commands when `w1 w2` is one, else `w1`); `--dry-run`, `--digest`, `--negative-control`, `--by X` read from the
  same segment.
- Comparison of paths: case-insensitive on Windows (`os.path.normcase` semantics without touching the disk), prefix
  match on whole segments.

### 8.6 exec.py commands per role (SCHEMAS.md 5.3, as the guard applies it)
| role | allowed |
|---|---|
| execution-implementer | `merge`, `fe-workspace`, `result put`, `validate`, `status --digest` |
| generic | `result put`, `validate`, `status --digest` |
| execution-test-designer | `result put`, `validate`, `plan instantiate --dry-run`, `proof run --negative-control`, `snapshot` |
| execution-verifier | `proof run`, `proof verdict`, `result put`, `status --digest` |
| execution-reviewer | `result put`, `proof run`, `status --digest` |
| execution-planner | `result put`, `plan instantiate --dry-run`, `validate`, `simulate` |
| frontend-critic, frontend-probe | none |
| orchestrator | all except `proof verdict` and `snapshot` (A10) |
| another main-thread session | `status --digest`, `validate`, `simulate`, `hooks canary`, `resume --takeover` (rule 2b) |
`merge` "its own task only" cannot be checked by a hook (the guard does not know which task an agent runs); merge
itself refuses a third call per attempt and a second landing (CLI.md merge).

### 8.7 The deny (exact stdout, exit 0)
```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"E_GUARD_STATE_PATH: only exec.py writes .execution/plan.json; write your result to your inbox and run exec.py result put. Do not retry in another form."}}
```
Reason format: `<code>: <what was refused, naming the path or the rule, never a matched secret or never-show text>.
Do not retry in another form.` ≤ 300 characters. Each deny appends a hook event `guard.deny {tool, rule, code, role,
agent_type, layer, command_head}` where `command_head` = the first 120 characters through `log.redact`. The global
`~/.claude/hooks/guard.py` stays the authority on attribution trailers and secret reads; this guard never relaxes it,
never reads a secret path, and never duplicates its patterns.

---

## 9. UserPromptSubmit (`scripts/hooks/user_prompt.py`, optional)
- `prompt.lstrip()` starts with `<task-notification` or `<\task-notification` → nothing (a workflow completion, not
  the owner [hooks missed-5]).
- Orchestrator session → stdout:
```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"execution: <run_state>, <n> waves running, awaiting <refs or none>; run exec.py status first."}}
```
  `n` = local-state waves with status launched; ≤ 200 characters. Installed by default; `hooks install --no-prompt-hook`
  leaves it out.

---

## 10. Files the hooks write

| file | writer | format |
|---|---|---|
| `S/local/hooks-state.json` | Stop, SessionStart (re-key reset), StopFailure | `local-state.schema.json#/$defs/hooks_state`, atomic replace (temp + `os.replace`, 3 retries 20 ms apart on `PermissionError`, then fail open) |
| `S/local/active` | guard (binding: `session_id`), SessionStart (re-key: `session_id`, `previous_session_ids`, `rekey_armed_until_utc`), SessionEnd (`rekey_armed_until_utc`) | `#/$defs/active_marker`, read-modify-write of those fields only, atomic replace |
| `S/local/hook-events/<utc compact with microseconds>-<pid>-<n>.json` | every hook | `#/$defs/hook_event`, one file per event created with `O_CREAT|O_EXCL` (a name collision retries with n+1), `ts` with microseconds. Never an append to a shared file: through the MSVC CRT `O_APPEND` is a seek then a write, so up to 14 concurrent agents' hooks would overwrite each other's lines (canary and `guard.deny` records included) |
| `S/local/hook-errors.log` | `fail_open` | JSON lines (2.3), best effort (a lost line here loses nothing the run needs) |

`exec.py status` imports the event files in name order into `events.jsonl` with `id` = first 16 hex of sha256 of the
file's bytes and actor `hook:<name>@<executor>` (event.schema.json), once each, and deletes each file after its event
is appended (a crash in between is harmless: the id deduplicates). Hook-event `data` never holds a full command, a
secret, an env value or never-show text.

Default hooks-state (absent file): `{"schema":"execution.hooks-state/1","consecutive_continuations":0,
"last_continuation_utc":null,"last_digest_sha256":null,"stuck":null,"last_stop_utc":null}`.

### 10.1 Performance budget
p95 ≤ 250 ms per call on a quiet machine, measured by `test_hook_latency.py` over 30 runs per hook through the real launcher (MODULES 6). Default tier (revision 4, Q-B08-20): the hook's p95 minus the p95 of a no-op script started the same way, in the same run, stays under 130 ms × load (load = the no-op's p95 / 120 ms, at least 1), so the test is stable under machine load; the absolute 250 ms check runs only with `EXEC_LATENCY=1`.
Budget split: Git Bash start + `cygpath` ≈ 80 ms, `python -S` start ≈ 40 ms, file reads and parsing ≤ 30 ms. Rules
that keep it: `python -S`; imports limited to `json`, `os`, `re`, `sys`, `shlex`, `pathlib`, `datetime`,
`dataclasses`, `traceback`, `hashlib` (lazy); no subprocess; `plan.json` read only for agent write tools; the
settings matcher (11.2) keeps hooks off tools no rule concerns.

---

## 11. Installation (`exec.py hooks install | uninstall`, `execlib.hooksinstall`)

### 11.1 Command form
Shell form, run by Git Bash on Windows [hooks F30], absolute paths (CLAUDE_SKILL_DIR is empty in hook commands
[hooks F05]), the tag as a trailing shell comment:
```
bash "C:/Users/Utilisateur/.claude/skills/execution/scripts/hooks/py.sh" stop_gate.py # execution-hook v1
```
The skill path is `paths.SKILL_DIR` rendered with forward slashes (`paths.posix`). `TAG = "# execution-hook v1"`; an
entry is ours iff its `command` ends with the tag.

### 11.2 The entries (exactly; `hooksinstall.entries(skill_dir)`)
```json
{
  "Stop": [
    {"hooks": [{"type": "command", "command": "bash \"<SKILL>/scripts/hooks/py.sh\" stop_gate.py # execution-hook v1", "timeout": 10}]}
  ],
  "StopFailure": [
    {"hooks": [{"type": "command", "command": "bash \"<SKILL>/scripts/hooks/py.sh\" stop_failure.py # execution-hook v1", "timeout": 10}]}
  ],
  "SessionStart": [
    {"matcher": "startup|resume|clear|compact", "hooks": [{"type": "command", "command": "bash \"<SKILL>/scripts/hooks/py.sh\" session_start.py # execution-hook v1", "timeout": 10}]}
  ],
  "SessionEnd": [
    {"hooks": [{"type": "command", "command": "bash \"<SKILL>/scripts/hooks/py.sh\" session_end.py # execution-hook v1", "timeout": 10}]}
  ],
  "PreToolUse": [
    {"matcher": "Bash|PowerShell|Read|Edit|MultiEdit|Write|Grep|Glob|NotebookEdit|NotebookRead|WebFetch|PushNotification|CronCreate|CronDelete|RemoteTrigger|SendMessage|Monitor|Artifact|ArtifactComments|ArtifactData|DesignSync|EnterWorktree|ExitWorktree|mcp__.*", "hooks": [{"type": "command", "command": "bash \"<SKILL>/scripts/hooks/py.sh\" pre_tool_guard.py # execution-hook v1", "timeout": 10}]}
  ],
  "UserPromptSubmit": [
    {"hooks": [{"type": "command", "command": "bash \"<SKILL>/scripts/hooks/py.sh\" user_prompt.py # execution-hook v1", "timeout": 10}]}
  ]
}
```
The PreToolUse matcher includes WebFetch (A5 endpoints) and the tools of rule B6 (CLI.md `hooks install` names the
same list). `--no-prompt-hook` leaves the UserPromptSubmit entry out. All timeouts 10 s (the default is 600 s; a
timed-out hook gives no decision [hooks F15]).

### 11.3 Merge algorithm (idempotent, removable)
1. Read `<repo>/.claude/settings.local.json`. Absent → `{}`. Not valid JSON or not an object → exit 1
   `E_SETTINGS_INVALID`, file untouched (never overwritten).
2. Back up `switchModelsOnFlag` into `local/state.json.settings_backup` **only if no backup is recorded yet** (a
   second install must not back up our own `true`): `{switchModelsOnFlag_present, switchModelsOnFlag_value}`. Set
   `switchModelsOnFlag: true` (owner decision Q3).
3. `hooks` = existing object or `{}`. For every event of 11.2: from the existing array remove every hook entry whose
   `command` ends with the tag; drop matcher groups left with no hooks; append our group. Events we do not use and
   foreign entries keep their values and order.
4. Write back with `json.dumps(obj, indent=2, ensure_ascii=False)` + `\n` (key order preserved, LF, no BOM) through
   `jsonio.write_text_atomic`. Formatting of foreign entries may be normalised to 2-space indentation; their values
   and order never change. Re-running install produces byte-identical output.
5. `.git/info/exclude` (through `git rev-parse --git-common-dir`, so worktrees share it): add once each
   `.execution/`, `.claude/settings.local.json` and `.claude/worktrees/` (Claude-managed agent worktrees live there
   [par F08]; untracked, they would make H2's `git status` dirty).
6. Marker `local/active` (`#/$defs/active_marker`): created with `session_id: null` and a fresh `bind_nonce`
   (`secrets.token_hex(8)`) when absent; when present with `session_id` null, a fresh nonce; when bound, unchanged
   (a different session takes over only through `exec.py resume --takeover`).
7. Event `hooks.installed`, `local/state.json.hooks.installed_utc`, `settings_path`. Data: CLI.md.

Uninstall: step 3 without the append (removes only tagged entries, then empty event arrays, then an empty `hooks`
object), restores `switchModelsOnFlag` from the backup (deletes the key when it was absent) and clears the backup,
deletes `local/active`, keeps the exclude lines (harmless, and a later run needs them). Idempotent.

### 11.4 Agent-definition entries (rendered by `agents install`, AGENTS.md 3)
Each /execution agent template carries:
```yaml
hooks:
  PreToolUse:
    - matcher: "Bash|PowerShell|Read|Edit|MultiEdit|Write|Grep|Glob|NotebookEdit|NotebookRead|WebFetch|PushNotification|CronCreate|CronDelete|RemoteTrigger|SendMessage|Monitor|Artifact|ArtifactComments|ArtifactData|DesignSync|EnterWorktree|ExitWorktree|mcp__.*"
      hooks:
        - type: command
          command: 'bash "C:/Users/Utilisateur/.claude/skills/execution/scripts/hooks/py.sh" pre_tool_guard.py --as execution-implementer # execution-agent-hook v1'
          timeout: 10
```
Gated by the same marker: outside a run the agent hook exits 0. /frontend's agents carry no hook of ours; the
settings layer guards them.

---

## 12. Launcher (`scripts/hooks/py.sh`)
A copy of `~/.claude/hooks/py.sh` with `-S`, so a missing script or a missing Python never blocks (Python exits 2
when it cannot open its script, and 2 means "block"):
```bash
#!/usr/bin/env bash
# /execution hook launcher: run the Python hook script next to this file with a path Windows Python
# can open, fail open when the script is missing, and start Python without site (-S) for speed.
# Usage (settings or agent hooks): bash "<abs>/scripts/hooks/py.sh" <script.py> [args...]
S="$(dirname "$0")/$1"
shift
[ -f "$S" ] || exit 0
if command -v cygpath >/dev/null 2>&1; then
  S="$(cygpath -m "$S")"
elif [[ "$S" =~ ^/([a-zA-Z])/(.*)$ ]]; then
  S="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"
fi
PY=python3
"$PY" -c "" >/dev/null 2>&1 || PY=python
export PYTHONUTF8=1
exec "$PY" -S "$S" "$@"
```
`PYTHONUTF8=1` is belt and braces for 2.6 (the hooks already use bytes I/O); it is read at interpreter start, so
`-S` does not disable it.
LF line endings (the skill's `.gitattributes` pins `eol=lf`); written with the Write tool. Each hook script starts
with `sys.path.insert(0, <scripts dir>)` to import `execlib.hookcore` (stdlib only, MODULES 6) without loading
`execlib/__init__` side effects (it has none beyond constants).

---

## 13. Canaries and the start-of-run probe

### 13.1 Binding canary (PreToolUse, main thread) — CLI.md `hooks canary`
Turn N: `hooks install` (settings are live from the next turn [hooks F22]), then a background Bash `sleep 5`
(`run_in_background`) before the turn ends: while the marker is unbound the Stop gate allows the stop and the
heartbeat is not armed yet, so without it nothing would start turn N+1 [rt F01]. Turn N+1 (the background command's
completion notification): `python "<SKILL>/scripts/exec.py" hooks canary --nonce <nonce>`. The guard binds (8.2 rule
2) before the command runs; the command then reads the marker and the `hooks.canary` event (< 5 min), cross-checks
the bound id with `CLAUDE_CODE_SESSION_ID` and the recorded `permission_mode`, and exits 0 `{bound: true, session_id,
env_session_id, permission_mode, hook_seen_utc, latency_ms}`. Exit 1 twice → the file watcher missed the change: the
orchestrator tells the owner to restart through `launch-exec.ps1 -Resume` (`claude --resume "<proj>-exec"
--dangerously-skip-permissions`, which keeps the session id and so the binding path; a fresh `claude` would be another
session that must take over) [hooks V-F22]. `wave emit` refuses without a canary ok in this session (CLI.md
precondition).

### 13.2 Liveness of the other hooks (read by `exec.py status`, reported in the digest)
| hook | evidence | stale when |
|---|---|---|
| Stop | `hooks-state.last_stop_utc` newer than `hooks.installed_utc` | no Stop seen since install although a turn ended (the digest says "Stop gate not seen yet") |
| SessionStart | a `session.start` event after the last resume/compact | `resume` step R2 reinstalls when entries are missing |
| guard (agents) | the probe (13.3) | — |
Status data field `hooks: {bound, canary_ok_utc, last_stop_utc, errors_since_tick, agent_role_source,
agent_session_scoped}` (CLI.md `status`).

### 13.3 Start-of-run agent probe (`exec.py agents probe` and `agents probe-check`, AGENTS.md 5.3)
Before the first wave of a session (and after `agents install`), a one-agent-per-type workflow proves, for each of
the five /execution agent types: the definition loads with its pinned model; the settings guard sees which
`agent_type`; whether the agent-definition hook layer fires inside a workflow agent; and that a planted forbidden
action is denied. Each probe agent runs, in order:
1. Bash `echo execution-probe <bind_nonce> <agent name>` → rule 3 logs `hooks.canary {probe: true, layer,
   as_role, agent_type, role_resolved}` from each layer that fired.
2. Write `<S>/local/probe/<agent name>.forbidden` with any text → must be denied (B1, E_GUARD_STATE_PATH). If it is
   not, the file exists afterwards: that is the failure evidence, and it is harmless.
3. execution-verifier only: Bash `git commit --allow-empty -F <S>/local/inbox/probe/msg.txt` → must be denied
   (C, E_GUARD_COMMAND_ROLE).
`agents probe-check` passes iff, for every type: a settings-layer canary with `role_resolved` equal to the type OR an
agent-layer canary with `as_role` equal to the type; the forbidden file is absent and a `guard.deny` exists for it;
the verifier's commit was denied. It also records whether every probe canary's payload `session_id` equals the bound
session id (`hooks.agent_session_scoped`, 2.2). A probe where only the agent layer resolved the role fails with a
`dependency-missing` decision whose options are (i) the settings layer trusts the agent layer's `--as` role for
agents of this run, or (ii) the settings layer applies only the A and B rules to `generic` and leaves role rules to
the agent layer (section 14 Q2) — never silently degraded.

---

## 14. Open points
Settled in revision 2 (README.md 10): Stop row 3, the extended matcher, `E_GUARD_DENY_COMMAND`, the
`.claude/worktrees/` exclude, the extra C-row git verbs, B8, `--no-prompt-hook`, the status `hooks` field, and the
StopFailure fields (`error`, `error_details`; the rehearsal captures a real payload).
- Q2 (measured at the start of every run, never assumed) Role identity inside workflow agents: (a) does a settings
  hook see `agent_type: execution-verifier` for `agent(…, {agentType: 'execution-verifier'})`? (b) do
  agent-definition hooks fire inside workflow agents? (c) do workflow agents' payloads carry the parent session id?
  The probe (13.3) answers all three on the pinned version; a failure is an owner decision, never a silent downgrade.

---

## 15. Test fixtures (B08, `scripts/tests/fixtures/B08/payloads/`)
One JSON payload per row, named `<hook>.<row>.<case>.json`, each with an expected stdout (or `""`) and the expected
hooks-state / marker / hook-event deltas:
- Field names follow the hooks documentation (`background_tasks` items `{id, type, status, description}`,
  `session_crons` items `{id, schedule, recurring, prompt}`); payloads captured in the rehearsal replace these files.
- `stop.2.running.json` (background_tasks `[{"id":"bg-1","type":"workflow","status":"running","description":"W03"}]`),
  `stop.2.absent-bg.json` (no key: falls through to rows 5-9, never treated as empty), `stop.5.awaiting-cron.json`,
  `stop.5.awaiting-no-cron.json` (continues), `stop.5.crons-absent-recorded.json`, `stop.5.crons-absent-recorded-other-session.json`
  (a heartbeat recorded by a previous session id: not armed, continues), `stop.6.idle-armed.json` (ready none +
  heartbeat armed: allow), `stop.6.idle-unarmed.json` (ready none + nothing armed: continuation naming only the
  heartbeat), `stop.7.launched-unknown.json`, `stop.7.launched-unknown-unarmed.json` (continues), `stop.9.continue-1..4.json`,
  `stop.8.fifth.json` (allow + stuck; the push text is the French `stuck` entry of push.fr.json),
  `stop.1.reset.json`, `stop.0.other-session.json`, `stop.0.agent.json`, `stop.utf8.json` (a digest and payload with
  emoji, `→` and U+202F, run without `PYTHONIOENCODING`: the output is valid ASCII-escaped JSON).
- `session_start.clear.armed.json` / `.expired.json` / `.unarmed.json`, `.compact.json` (output ≤ 2,000 chars, from a
  3,000-char digest fixture), `.resume.json` (nonce line present), `.other-session.json`.
- `session_end.clear.json`, `stop_failure.orchestrator.json` (`error: overloaded`: stuck),
  `stop_failure.rate-limit.json` (no stuck; event only), `stop_failure.agent.json`, `stop_failure.then-stop.json` (a
  later Stop of the same session: `status` drops the stuck record).
- `guard.bind.null.json`, `.bind.same.json`, `.bind.other.json`, `.bind.agent.json` (an agent cannot bind),
  `guard.lease.other-session.json` (another main-thread session's `exec.py wave emit` → E_GUARD_RUN_LEASE; its
  `exec.py status --digest` and `exec.py resume --takeover` allowed), `guard.A10.verdict-main.json`,
  `guard.A11.powershell-exec.json`, `guard.powershell.backslash-write.json` (`Set-Content
  C:\repo\.execution\plan.json` → E_GUARD_STATE_PATH), `guard.B9.python-c.json` (`python -c "open('.execution/proofs/x','w')"`
  → deny; `exec.py result put ... --file .execution/local/inbox/...` allowed), `guard.foreign-agent.json` (an agent
  whose session id is another session's while `agent_session_scoped` is true: nothing), `guard.harden-active.json`
  (`.harden/active` present, scoping unknown: a foreign agent is not guarded), `guard.attest.verdict.json` (an
  allowed verifier `proof verdict` writes `guard.attest`),
  `guard.A1.force.json` + positive control `guard.A1.plain-push.json`, one deny + one allowed neighbour for every rule
  of 8.4 (e.g. `guard.B1.plan-write.json` / `guard.B1.inbox-write.json`; `guard.A7.fence.json` /
  `guard.A7.env-example-read.json` — this guard never denies reading `.env.example`), `guard.generic.merge.json`,
  `guard.verifier.commit.json` / `guard.reviewer.scratch-apply.json`, `guard.corrupt-marker.json` (fails open, one
  log line), `guard.probe.json`.
- `user_prompt.task-notification.json`, `user_prompt.owner.json`.
Every deny fixture asserts: exit 0, stdout is exactly one JSON object with `permissionDecision: "deny"` and a reason
starting with its code, no `decision` key, and a `guard.deny` hook event.
