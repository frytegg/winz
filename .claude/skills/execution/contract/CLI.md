# CLI.md — every `exec.py` subcommand

`python "C:/Users/Utilisateur/.claude/skills/execution/scripts/exec.py" <command> [<subcommand>] [options]`
(`python3` on POSIX; the path is this machine's `paths.SKILL_DIR`, so another path on dev B's machine). SKILL.md and
the references write `exec.py <command>` for that EXEC line; every string a script prints for later use (the
SessionStart context, the Stop continuation, the heartbeat prompt, `status` data `exec_cmd`, resume steps, briefs)
carries the absolute command (README.md 3.2). The orchestrator runs exec.py and git through the **Bash tool** (Git
Bash), never PowerShell: one shell grammar for the guard (HOOKS.md 8.5). The launcher exports `MSYS_NO_PATHCONV=1`
so Git Bash never rewrites an argument that starts with `/`.

Conventions shared by every command are in README.md (envelope, exit codes, logging, time, errors); the documents
named here are specified in `assets/schemas/` and SCHEMAS.md. "O" marks orchestrator-only commands (SCHEMAS.md 5.3).

---

## 0. Global behaviour

### 0.1 Global options (accepted before or after the command words)
| option | default | meaning |
|---|---|---|
| `--repo DIR` | the main working tree of the cwd's repository: the parent of `git rev-parse --path-format=absolute --git-common-dir`, so a call from a linked worktree (`<repo>/.claude/worktrees/<name>`, the critique worktree under scratch) resolves to the main repository; refused if it resolves inside `.execution/` | product repository root |
| `--state DIR` | `<repo>/.execution` | state directory (its own git repo); briefs always pass `--repo` and `--state` explicitly |
| `--executor A\|B` | `local/state.json` executor; required by `init` | which orchestrator this call acts for |
| `--now ISO` | env `EXEC_NOW` only when `EXEC_TEST=1` is also set (else `EXEC_NOW` is ignored with W_CLOCK_OVERRIDE), else the system clock | UTC instant override (tests, simulations); recorded as `clock: override` in events and in the digest |
| `--pretty` | off | indent the stdout JSON |
| `--log-level` | env `EXEC_LOG_LEVEL`, else `info` | stderr JSON-lines level |
| `--by ROLE` | `orchestrator` | `orchestrator`, `verifier`, `implementer`, `integrator` (merge's internal proof run), `test-designer`, `planner`, `reviewer`, `replay`: recorded in receipts and events; the PreToolUse guard has already checked the agent type against SCHEMAS.md 5.3 |

### 0.2 Output and exit codes
stdout: exactly one envelope (`envelope.schema.json`): `{ok, command, data, errors, warnings?, exit_code?, contract?}`.
stderr: JSON log lines only. Exit codes: **0** ok · **1** a check or validation failed (the data says which) ·
**2** usage error (bad flags, missing file, unknown id) · **3** internal or environment error (git missing, disk full,
lock timeout, an uncaught exception: logged with its traceback, never swallowed) · **4** refused by policy (a
transition without evidence, a guarded command, a push after the freeze, a never-show hit, an immutable file).

### 0.3 Locks (`execlib.locks`, files under `<state>/local/locks/`)
| lock | protects | wait timeout | stale after |
|---|---|---|---|
| `merge` | the merge queue of this product repo | 5 min (agent-invoked: the 9-minute budget of 0.6 must still fit the merge) | holder dead only; older than 60 min warns |
| `plan` | plan.json, feature catalogue | 60 s | holder dead only; older than 10 min warns |
| `git-state` | git operations in the state repo (commit, pull, push) | 120 s | holder dead only; older than 15 min warns |
| `state` | status/*, events.jsonl, local/state.json, decisions.md, answers/, proofs/, manifests | 30 s | holder dead only; older than 5 min warns |
| `notion` | Notion batches, acks, outbox | 30 s | holder dead only; older than 5 min warns |

Acquisition order is always merge → plan → git-state → state → notion (never the reverse), so no deadlock is
possible. A lock file holds `{pid, process_created, host, command, acquired_utc}`; `process_created` is the
holder's creation time (Windows `GetProcessTimes` through ctypes, POSIX `/proc/<pid>/stat` start time or `ps`), so a
reused pid is not taken for the holder. A lock is broken only when its holder is dead (no process with that pid and
that creation time; `OpenProcess`/`GetExitCodeProcess` on Windows, never `os.kill`, which terminates there; `os.kill
(pid, 0)` on POSIX): `W_LOCK_OLD` is logged when a live holder is older than the age above, and the waiter keeps
waiting. Breaking a dead holder's lock appends an `error` event. Timeout: E_LOCK_TIMEOUT, exit 3 (for an agent-invoked
merge: a rerun, never a failed attempt).

### 0.4 Paths outside the repo
Scratch (clean checkouts, harden-ready dry runs): `<profile.machine.scratch_root>/<project>/...`, never inside a
git work tree. A gates.py `--out-dir` is always a directory whose **parent contains no file named `active`**
(gates.py reads `<out-dir>/../active` as a forbidden-commands marker): proof runs use
`local/proof-runs/<task>/<run_id>/gates`, harden-ready uses `<scratch>/harden-ready-<stamp>/gates`, merge uses
`local/merge-gates/<task>-a<n>r<k>/gates` (keyed by attempt and rerun, so a rerun never meets a previous run's
output). Never `local/gates` (its parent `local/` holds `active`). Every clone outside the repo is made with
`git -c core.longpaths=true clone --no-local --config core.longpaths=true` (git config is not cloned) and
`scratch_root` stays short (e.g. `C:/x`).

### 0.5 Idempotency vocabulary
"Idempotent" = re-running with the same inputs, state and `--now` changes nothing and prints the same data.
"Converging" = re-running applies only what is still missing (reconciliation).

### 0.6 Commands agents run: the 9-minute budget
Agents call exec.py through the Bash tool with `timeout: 600000` (its ceiling; a longer command is killed mid-way).
`merge`, `proof run`, `snapshot` and `proof verdict` therefore finish within 540 s of wall time
(`profile.machine.agent_command_budget_s`, default 540): before each step they compare the remaining budget with that
step's last measured duration (`local/timings.json`, per task kind); a step that cannot fit is not started and the
command exits 3 with E_TIME_BUDGET, writing what it did (the merge intent, the partial receipt) so a rerun continues.
Exit 3 from these commands (E_TIME_BUDGET, E_LOCK_TIMEOUT, E_ENV for disk, RAM or a failed reading, E_ATTESTATION_MISSING)
is classified `rerun` by the wave script and by `wave ingest`, never `failed`. Agents never retry an exit-3 command in
the same run: they return their result with the code (AGENTS.md rule 7).

### 0.7 Untrusted text never reaches a shell
Human text (owner quotes, Notion `Réponse`/`Décision` values, error texts copied from tools) is handed to exec.py
only through files written with the Write tool: `--quote-file`, `--choice-file`, `--text-file`, `--error-file`.
exec.py validates every value against its kind's strict pattern before using it (tx hash `^(0x)?[0-9a-fA-F]{64}$`, sha
`^[0-9a-f]{40}$`, option id `^[a-z0-9][a-z0-9-]{0,30}$`, url `^https?://\S+$`) and passes values to subprocesses
as argv elements (`procutil.run(shell="none")`), never by string substitution into a shell line.

---

## 1. Run setup

### `init` (O)
Create or join a project's state repository.
- Args: `--project SLUG` (required), `--executor A|B` (required), `--state-remote URL` (clone if the remote has
  content, else create and set it as origin), `--pre-t0 --state DIR` (state outside any product repo, before the
  event's start, when a repo may not exist yet), `--import-from DIR` (at T0: copy a pre-T0 state's knowledge files
  and `frontend/` into the new state; plan.json is never imported as approved).
- Reads: product repo git config, an existing `.execution/`.
- Writes: `.execution/` (git init or clone), state-repo `.gitattributes` and `.gitignore` (SCHEMAS.md 1.1), dirs
  `status/ proofs/{history,runs,impl,merge}/ answers/ briefs/ waves/ reports/ fix/ frontend/ local/{locks,results,inbox,proof-runs,notion/batches,planner,merge-gates,merge-pending,hook-events,probe,fix}`,
  `local/state.json` (run_state INIT), product `.git/info/exclude` lines `.execution/`, `.claude/settings.local.json`
  and `.claude/worktrees/` (each added once), `core.longpaths=true` in the product repo config, and the portable
  commit-msg hook: `<repo>/.githooks/commit-msg` from `assets/githooks/commit-msg` (written when absent or different,
  LF, executable bit through `git update-index --chmod=+x` once tracked) plus `core.hooksPath=.githooks` (git config is
  not cloned, so `init --executor B` sets it on dev B's clone too). The hook refuses a message carrying an
  AI-attribution trailer or a "Generated with" line, or whose first line is not a conventional-commit header; the
  EX-BOOT task commits the file (its writes name it). Not with `--pre-t0` (no product repo).
- Remote visibility (owner decision Q2): before cloning from or pushing to `--state-remote`, `gh repo view <remote>
  --json visibility,isPrivate` must report a private repository; a local path or `file://` remote counts as private
  (fixtures, tests). Anything else, or `gh` unable to tell: exit 4 E_STATE_REMOTE_PUBLIC, nothing cloned or pushed.
- Data: `{state_dir, created: bool, cloned: bool, executor, project, excluded: [lines added], state_remote,
  state_remote_private: true, commit_msg_hook: written|current|skipped}`.
- Exit: 0; 1 an existing state belongs to another project or executor (E_STATE_MISMATCH); 2; 3; 4 the remote is not
  private.
- Idempotent (same args: `created: false`, nothing rewritten). Lock: state (after the directory exists).
- Events: `run.init`, `run.state` (→ INIT).

### `preflight` (O)
Prove the machine and session can run unattended; writes nothing but its report.
- Args: `--for rehearsal|event` (event raises floors to the profile's), `--confirm ID[,ID...]` (skipped checks the
  orchestrator or the owner verified by hand in this session: PF-18 after seeing Remote Control connected, PF-22 after
  the owner's answer), `--strict` (accepted; it is the only behaviour: a skipped check is open).
- Checks (each `{id, title, state ok|fail|skipped, detail, fix}`; skipped = cannot be measured by a script; a skipped
  check named in `--confirm` becomes `ok` with detail `confirmed by <orchestrator|owner> at <utc>`): PF-01 `claude
  --version` ≥ 2.1.286 (run with a 30 s timeout; on timeout, the newest entry name under
  `~/.local/share/claude/versions/`) · PF-02 `DISABLE_AUTOUPDATER` or `DISABLE_UPDATES` set ·
  PF-03 `CLAUDE_CODE_RETRY_WATCHDOG=1` · PF-04 `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` = profile
  `machine.workflow_concurrency` · PF-05 `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` ≥ 60000 · PF-06
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset or 0 · PF-07 python ≥ 3.11, node ≥ 20, pnpm, git, `gh auth status` ·
  PF-08 product repo `core.longpaths=true`, `.gitattributes eol=lf` once bootstrapped · PF-09 governor readings
  (disk, RAM, AC, network) above floors · PF-10 Windows time zone and its auto-update setting (report) · PF-11 usage
  snapshot age and weekly headroom (`quota`) · PF-12 `agents status` all current · PF-13 /frontend present when the
  profile has a frontend block: `scripts/frontend-check.mjs`, `assets/task-templates/frontend.json`,
  `assets/schemas/profile-frontend.schema.json`, `assets/schemas/never-show.schema.json`,
  `assets/wave-fragments/{critique,directions}.js`, agents `frontend-critic` and `frontend-probe` (a missing one is
  `fail` with fix "decision for the owner", never a fallback) · PF-14 /harden scripts present (`gates.py`,
  `infer_profile.py`, `prescan.py`, `inventory.py`, `harden_agents.py`) · PF-15 /hackathon present for
  `event.kind hackathon` · PF-16 no `.harden/active` in the repo · PF-17 `agentPushNotifEnabled` and
  `inputNeededNotifEnabled` true in the user's Claude config (read-only) · PF-18 Remote Control connected (skipped
  until confirmed) · PF-19 Notion token (ok when the newest `notion.ack` event of purpose `token-check` in this
  session is ok; else skipped) · PF-20 bypass mode (ok when the newest `hooks.canary` event of this session records
  `permission_mode: bypassPermissions`; fail when it records another mode; skipped before the canary) · PF-21 global
  guard `~/.claude/hooks/guard.py` present; `<repo>/.githooks/commit-msg` present and `core.hooksPath=.githooks` once
  the product repo exists · PF-22 AC standby never (`powercfg /query`) and lid action (skipped until confirmed by the
  owner) · PF-23 Windows activation (report: watermark risk for recordings) · PF-24 free disk vs the event target
  (`--for event`: 25 GB advisory) · PF-25 the state remote is private (as `init`) · PF-26 clock skew: the `Date`
  header of `gh api -i /rate_limit` within 60 s of the local UTC clock · PF-27 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`
  unset (it would hide every per-call model) · PF-28 `EXEC_NOW` unset (or `EXEC_TEST=1`, tests only) · PF-29 the
  launcher's environment: `MSYS_NO_PATHCONV=1` and `CLAUDE_CODE_SESSION_ID` present (the session id source of
  `resume` and `hooks canary`) · PF-30 the orchestrator's effort: the `effort` field of the latest hook payload of the
  orchestrator session (recorded by the hooks) is `xhigh`; lower or unknown → open, with the fix "type `/effort
  xhigh` in the orchestrator session" (revision 4).
- Data: `{ok, for, strict: true, failed: n, skipped: n, open: [ids skipped and not confirmed], checks: [...],
  manual_checklist: [{id, fix}] for the open ids, version}`; `ok` is true iff no check failed and none is open (the
  BNB defect, a skipped check reported as passing, is never copied).
- Exit: 0 iff `ok`; 1 otherwise (a skipped check is open). The start-up (SKILL-OUTLINE.md 2.5) re-runs preflight with
  `--confirm` for every open id the orchestrator or the owner verified, and proceeds to INGEST only on exit 0.
  Idempotent, read-only. Events: `preflight` (data as above, without `checks`), `run.state` (→ PREFLIGHT on success).

### `ingest` (O)
Build `profile.json` and `policy.json` from drafts the orchestrator compiled from the workspace, and check the spec.
- Args: `--spec PATH` (required), `--profile-draft PATH`, `--policy-draft PATH` (JSON files written by the
  orchestrator in `local/`), `--patch PATH --decision D-nnn` (later changes, only under a resolved decision of kind
  policy-exception or scope-change), `--patch PATH --notion-ids` (no decision needed: every patched pointer is under
  `/notion/databases` or `/notion/views` and every patched value was null; NOTION.md 7.3), `--patch PATH --answer KEY`
  (no decision needed: every patched pointer is under `/frontend/references` and KEY is a verified answer of the
  FE-01 task; FRONTEND.md 6.4), `--propose-spec-validation` (opens the spec-validation decision with the spec's
  sha256).
- Reads: drafts, spec, existing profile/policy, decisions.md, /frontend's profile schema (x-external).
- Writes: `profile.json`, `policy.json` (sorted output only when the merge is valid), decisions.md (proposal).
- Never invents a field: a draft field that is null or absent where the schema requires a value is listed in
  `missing` and the files are still written only if the schema allows null there.
- Data: `{profile_path, policy_path, missing: [{field, action: manual-task|decision, why}], spec: {path, sha256,
  validated: bool, validated_decision, requirement_ids: [...], ids_missing: bool}, frontend_schema: present|missing}`.
- Exit: 0; 1 schema/invariant failure or the frontend schema is missing while the profile has a frontend block
  (E_DEPENDENCY_MISSING, with a `dependency-missing` proposal id in data); 4 `--patch` without a resolved decision.
- Idempotent. Locks: state. Events: `ingest`, `decision.proposed`, `run.state` (→ INGEST).

### `hooks install` (O)
- Args: `--no-prompt-hook` (leave UserPromptSubmit out).
- Writes `<repo>/.claude/settings.local.json`: merges the hook entries of HOOKS.md 11.2 (Stop, StopFailure,
  SessionStart with matcher `startup|resume|clear|compact`, SessionEnd, PreToolUse with matcher
  `Bash|PowerShell|Read|Edit|MultiEdit|Write|Grep|Glob|NotebookEdit|NotebookRead|WebFetch|PushNotification|CronCreate|CronDelete|RemoteTrigger|SendMessage|Monitor|Artifact|ArtifactComments|ArtifactData|DesignSync|EnterWorktree|ExitWorktree|mcp__.*`,
  UserPromptSubmit), each command `bash "<skill>/scripts/hooks/py.sh" <hook>.py` and tagged by the trailing comment
  `# execution-hook v1`; keeps every other entry's values and order; sets `switchModelsOnFlag: true` and, for the
  session's model id, `modelSettings.<model id>.effortLevel: "xhigh"` (the orchestrator strategises at xhigh, owner
  policy of 2026-10-02; revision 4) after saving both previous values in local state (`settings_backup`, only when
  none is recorded); ensures `.claude/settings.local.json`
  and `.claude/worktrees/` are in `.git/info/exclude`; writes `local/active` with a fresh `bind_nonce` and
  `session_id: null` when absent or unbound (a bound marker is left as is: a new session takes over only through
  `resume --takeover`).
- Data: `{settings_path, entries_added: [event names], nonce, next: ["arm a wake source: Bash run_in_background
  'sleep 5'", "exec.py hooks canary --nonce <nonce>"]}`: settings are live from the next turn, and nothing else would
  start that turn (the heartbeat is not armed yet), so the orchestrator starts a background `sleep 5` before ending
  the turn; its completion notification is the turn that runs the canary.
- Exit: 0; 1 the settings file is not valid JSON (never overwritten: E_SETTINGS_INVALID); 3.
- Idempotent (existing tagged entries replaced by identical ones; a new nonce only if the marker has no session yet).
- Lock: state. Events: `hooks.installed`.

### `hooks canary --nonce N` (O)
The PreToolUse hook sees this command line, recognises the nonce from the main thread (no `agent_id`) and writes the
session id into `local/active` (binding) plus a `hooks.canary` hook event recording the payload's `session_id` and
`permission_mode`. The command then checks that binding and cross-checks the bound id with its own environment's
`CLAUDE_CODE_SESSION_ID` (exported by Claude Code to the Bash tool; equal to the session's id).
- Data: `{bound: bool, session_id, env_session_id, permission_mode, hook_seen_utc, latency_ms}`.
- Exit: 0 bound, the hook event is less than 5 min old, `session_id == env_session_id` (when the variable is set) and
  `permission_mode == "bypassPermissions"`; 1 otherwise: hooks not live yet (retry next turn; after 2 failures restart
  through `launch-exec.ps1 -Resume`, which keeps the session id: the file watcher can miss a change), bound to another
  session (run `exec.py resume --takeover` first), or not in bypass mode (restart through the launcher).
- Idempotent once bound. Events: `hooks.bound` (imported), `hooks.canary`.

### `hooks uninstall` (O)
Removes only tagged entries, restores `switchModelsOnFlag` and the model's `effortLevel` from the backup, deletes
`local/active`.
- Data: `{removed: [event names], settings_restored: bool}`. Exit 0. Idempotent. Lock: state. Events:
  `hooks.uninstalled`.

### `agents install` / `agents status` (O)
Render `assets/agents/execution-*.md` (absolute paths substituted, a `execution-agent-template: <name> v<n>` marker
line) into `~/.claude/agents/` (or `$CLAUDE_CONFIG_DIR/agents`), atomically, UTF-8 LF.
- `install [--force]`: refuses to overwrite a file without our marker unless `--force`; never installs /frontend's
  agents (reports them). Data `{installed: [names], current: [names], refused: [names]}`. Exit 0; 1 refused.
- `status`: `{agents: [{name, state: current|stale|missing|foreign}], frontend_agents: [{name, present}]}`. Exit 0
  all of ours current; 1 otherwise. Read-only.
- After `install` wrote anything, the session is restarted to load the definitions (Workflow resolves agent types
  from the session's registry): always through `launch-exec.ps1 -Resume` (`claude --resume "<proj>-exec"
  --dangerously-skip-permissions` with the launcher's environment), which keeps the session id, so the hooks binding
  and the session's workflows survive. Install runs before `hooks install` at start-up (SKILL-OUTLINE.md 2.5).
  Events: `agents.installed`.
- `probe` (O): writes `local/probe/probe.js` (a five-agent workflow, the constraints of WAVES.md 2) and prints
  `{workflow_call}`; `probe-check --result PATH` (O) checks the result and the hook events (AGENTS.md 5.3) and records
  `local/state.json.hooks.agent_role_source` (`settings|agent-only|none`) and `agent_session_scoped` (whether the
  probe agents' payload `session_id` equals the bound session id; HOOKS.md 2.2). Exit 0 pass; 1 fail with a
  `dependency-missing` decision. `wave emit` refuses until the session's latest probe-check passed or that decision
  is resolved.

### `heartbeat plan` / `heartbeat record` (O)
- `plan`: prints the CronCreate arguments: `{cron, prompt, recurring: true}` where the minutes are
  `sorted({(minute_offset + k × every_min) % 60 for k in range(60 // every_min)})` from `profile.heartbeat`
  (`every_min` divides 60: 10, 12, 15, 20 or 30), e.g. offset 7 and 20 → `7,27,47 * * * *`, offset 45 → `5,25,45 * * *
  *`; and the prompt, plain text with this machine's absolute paths: `execution heartbeat: run python
  "<SKILL_DIR>/scripts/exec.py" status and follow <SKILL_DIR>/references/tick.md`. A cron can run only
  model-invocable skills and /execution is not, and the cron may fire after a compaction or `/clear` dropped the skill
  body, so the prompt carries everything it needs. Read-only.
- `record --cron-id ID --expr EXPR`: stores them in `local/state.json.heartbeat` with `session_id` =
  `CLAUDE_CODE_SESSION_ID` and `recorded_utc`. The Stop gate trusts `session_crons` when the payload has it; when the
  array is absent it counts the recorded heartbeat only if its `session_id` equals the marker's bound `session_id`
  and it is under 7 days old (crons are session-scoped and expire after 7 days; HOOKS.md 4.2). A re-key on `/clear`
  and `resume --takeover` clear the record. Exit 0. Idempotent.

### `sync` (O)
Commit own state changes, rebase on the remote, re-validate, push. Never `--force`.
- Procedure: (1) `git fetch origin` without the state lock; (2) acquire `state` (allowed order: git-state, then
  state), so no exec.py command appends an event or writes a receipt meanwhile; commit own changed paths of TWO-DEV.md
  2.2 with explicit pathspecs (`git add -- <paths>`, never `-A`) and a message file `chore(state): <executor> <stamp>
  <summary>`, after the **secret scan** of the staged diff (`integrity.scan_secrets` with its positive control): a hit
  refuses the commit (exit 4 E_SECRET_IN_STATE), moves the file to `local/quarantine/` and proposes a decision; (3)
  `git rebase origin/main` (local and fast; union merges for events.jsonl and decisions.md); release `state`;
  (4) re-validate plan.json if it changed (E_PLAN_TAMPERED or E_PLAN_INVALID stops launching); (5) check the remote is
  private (as `init`; exit 4 E_STATE_REMOTE_PUBLIC, nothing pushed), then `git push origin HEAD:main`; a non-fast-forward
  rejection loops to (1), at most 3 times.
- Args: `--pull-only` (steps 1, 3, 4 with nothing committed), `--push-only` (steps 2 and 5; used right after `wave
  launched` so the other executor sees in-flight tasks within minutes, TWO-DEV.md 4.2).
- Data: `{pulled: [sha range], committed: sha|null, pushed: bool, plan_changed: bool, plan_version,
  other_executor_status_seq, other_executor_last_commit_utc}` (the committer date, on the remote, of the newest
  commit by the other executor: the liveness signal of TWO-DEV.md 8.4).
- Exit: 0; 1 a rebase conflict on a non-union file (aborted, E_STATE_CONFLICT: two writers touched one file, a
  contract violation) or the merged plan is invalid; 3 network; 4 a secret in a staged file, or a public remote.
  Locks: git-state, then state for steps 2-3. Converging. Events: `sync`.

---

## 2. Planning

### `plan instantiate` (O; `--dry-run` allowed to planner and test-designer)
Expand the planner's draft into `plan.json` (SCHEMAS.md 6.2).
- Args: `--draft PATH` (default `local/planner/plan.draft.json`), `--dry-run` (writes only
  `local/plan.candidate.json`), `--proofs PATH` (a recorded result-test-designer: its proof objects are applied by
  task id to the candidate, `proof_author: test-designer`, before validation), `--propose-approval` (after a valid
  write: open the approval decision, kind `approval`, with the French summary below, linked to the plan's
  `execution:EX-APPROVE` decision task, which goes planned → running; resolving it with the approve-plan option sets
  `plan.approved` and completes that task), `--pre-t0` (in a pre-T0 state: instantiate only the /frontend templates
  marked `pre_t0` and the knowledge-level skeleton; the result is never approved, FRONTEND.md 11).
- Reads: draft, profile, policy, both template libraries, decisions.md (spec validation).
- Writes: `plan.json` (only while not approved; refused with exit 4 E_PLAN_APPROVED otherwise: use `amend`) with the
  computed `DL-build-complete` deadline (P-24), the feature catalogue, decisions.md (approval proposal). `EXECUTION.md`
  is regenerated by `report --view`.
- Data: `{plan_path, plan_version: 1, tasks: n, ids: {key: id}, requirements_added: [NFR ids], catalogue_path,
  validation: <validate data>, approval: {decision, summary_fr, critical_path, p80_utc, manual_tasks, decision_gates,
  risks} | null}`.
- Exit: 0; 1 invalid (candidate kept for inspection); 4 already approved; 1 E_DEPENDENCY_MISSING (frontend library
  absent) with a proposal id.
- Idempotent: same draft + inputs + `--now` → byte-identical plan. Lock: plan, state. Events:
  `plan.instantiated`, `catalogue.generated`, `decision.proposed`, `run.state` (→ PLAN, → AWAIT_APPROVAL).

### `plan emit` (O)
Render the planner workflow (ARCHITECTURE.md 3.2, WAVES.md 7) into a launchable script.
- Args: `--rounds N` (default 2), `--mode design|pre-t0`.
- Writes: `local/planner/planner.W00.js` from `assets/workflows/planner.template.js` (same placeholder rules, static
  check and syntax check as a wave, WAVES.md 2), the planning briefs under `local/planner/briefs/`. Planning uses the
  reserved pseudo-wave `W00` for inboxes and results; build waves start at W01.
- Data: `{script_path, briefs: [paths], workflow_call: {scriptPath, name, args: {now_utc}}}`. Exit 0; 1
  E_WAVE_FORBIDDEN_TOKEN or a failed syntax check; 1 E_DEPENDENCY_MISSING when a library the draft needs is absent.
  Idempotent (same inputs and `--now` → same bytes). Lock: state. Events: `wave.emitted` with `wave: W00`.

### `validate`
- Args: `--plan PATH` (default plan.json), `--with-status`, `--strict` (warnings fail).
- Data: `{ok, errors: [error], warnings: [error], stats: {tasks, requirements, uncovered: [], by_phase: {},
  by_executor: {}, cross_executor_deps: [[from, to]], lanes: {lane: n}, critical_path_p50_min}}`.
- Exit: 0 valid; 1 invalid. Read-only, idempotent.

### `catalogue` (O)
Regenerate the feature catalogue from plan.json. Data `{path, entries, sha256}`. Exit 0. Idempotent. Lock: plan.

### `schedule` (O)
Deterministic scheduling (ARCHITECTURE.md 7.2): CPM with releases and deadlines, then Monte Carlo through the same
dispatcher, priorities, zones, and the planned → ready transitions.
- Args: `--samples K` (default 800, 500..2000), `--seed N` (default: first 8 hex of the plan digest as an int),
  `--lanes N` (default: governor decision, else profile max).
- Reads: plan, both status files, profile (team availability, machine), local calibration, governor reading.
- Writes: own status file (planned → ready, ready → planned), `local/schedule.json`, the computed `DL-build-complete`
  deadline only through `amend` (schedule proposes it in data when absent or stale).
- Data: `{ready: [{task, rank, lst_utc, slack_min, remaining_path_min, critical: bool}], zones: [{deadline,
  p_on_time, p50_utc, p80_utc, p90_utc, zone: green|yellow|red}], criticality: {task: index}, critical_path: [ids],
  build_complete_deadline_utc, build_complete: {deadline_utc, harden_p80_min, after_harden_min,
  harden_end_latest_utc, deliverables_p80_min}, waiting_on_other: [{task, dep, executor}], quota_projection:
  {agent_hours_p80, weekly_pct_needed|null}, proposals: [decision drafts for red zones: cut candidates in the order
  optional, P3, P2 off the must-have critical path]}` (`harden_end_latest_utc` = submission − `after_harden_min`, the
  P80 of the fix wave, FE-21, recording, /prose, screenshots, submission steps and buffer; HANDOVER.md H9).
- Exit: 0 (a red zone is data, not a failure); 1 plan invalid. Converging; same inputs + seed + `--now` → same
  data. Lock: state. Events: `schedule`, `task.status`.

### `simulate`
Monte Carlo only, no writes; used at planning, for cut options and what-ifs.
- Args: `--plan PATH`, `--samples`, `--seed`, `--lanes`, `--what-if PATH` (JSON patch: tasks to cut, durations to
  scale, lanes to change), `--from-status` (start from current status instead of all planned).
- Data: same zones shape plus `{makespan_min: {p50, p80, p90}, histogram: [[min, count]]}`. Exit 0; 1 invalid input.
  Read-only, deterministic.

### `due` (O)
Clock work computed from UTC anchors at every tick (crons are not deadline alarms).
- Args: `--horizon-min M` (default 120).
- Data: `{now: display_time, due: [{task, kind: anchor|latest-start|deadline|freeze|recurrence, at: display_time,
  overdue_min}], stale: [{what: plan|status|notion|events, last_utc, age_min}], freezes: [{id, kind, at, active}]}`.
- Exit 0. Read-only. Events: `due` only when something is overdue.

### `amend` (O)
Change the approved plan under a resolved decision, with the state repo's push as compare-and-set.
- Args: `--decision D-nnn` (resolved, kind amendment, cut, spec-gap, fix-selection, retry-exhausted or scope-change),
  `--patch PATH` (JSON: `{add_requirements: [...], add_tasks: [draft tasks or instances, as in plan-draft],
  change: [{task, fields: {...}}], supersede: [ids], reassign: [{task, executor, owner}], gates_json: PATH|null,
  proofs: [{task, proof}]}`; changeable fields: title, description, estimate, depends_on (additions, lower ids
  only), writes and resources (re-validated), proof (only from a test-designer result), executor/owner
  (reassignment), release_utc, deadline_utc, anchor, brief_refs, max_attempts).
- Procedure: lock git-state; push any own unpushed state commits first (`sync --push-only` semantics; amend refuses
  while an unpushed non-amend commit remains, exit 3 E_GIT with the hint to run `sync`); `git fetch`; fast-forward or
  `pull --rebase` the state repo; apply the patch to the fresh plan.json; validate (with TWO-DEV.md TD-A1..TD-A6,
  including that every changed, superseded or reassigned task belongs to this executor, except the owner-decided
  reassignment of a silent executor's not-in-flight tasks); bump `plan_version`; append the amendment record (digests
  before/after); commit `chore(plan): amend v<n> (<decision>)` (message from a file, no trailers); `git push origin
  HEAD:main`; on a non-fast-forward rejection: `git reset --keep HEAD~1` (drops only the amend commit just made,
  whose id is known; never a reset to origin, which would discard other unpushed state commits), `git pull --rebase
  origin main`, re-apply the patch from scratch, re-validate, retry up to 3 times.
- Data: `{plan_version, added: [ids], changed: [ids], superseded: [ids], requirements_added: [ids], push: {attempts,
  sha}, catalogue_changed: bool}`.
- Exit: 0; 1 invalid result or E_CAS_REJECTED after 3 attempts (state repo untouched locally); 4 decision missing,
  unresolved or of the wrong kind, a forbidden change (renumbering, deletion, a dependency on a higher id), or
  E_AMEND_IN_FLIGHT (TWO-DEV.md TD-A3/TD-A4/TD-A6).
- Not idempotent by design (each call is a new version); a repeated call for an already-applied decision is refused
  with exit 4 E_AMEND_APPLIED. Locks: plan, git-state, state. Events: `plan.amended`, `task.status`
  (superseded), `catalogue.generated`.

---

## 3. The tick

### `status` (O; `--digest` read-only form allowed to agents)
Reconcile, then print the state digest the orchestrator reads first on every turn.
- Args: `--digest` (no reconciliation, no writes), `--max-chars N` (default 2000).
- Reconciliation (converging): import the files of `local/hook-events/` in name order into events.jsonl (id = first
  16 hex of the file content's sha256; a file is deleted once its event is appended); finalise merge intents whose
  `head_sha` is an ancestor of origin/main (`local/merge-pending/`, CLI.md `merge`); resolve `launching` waves older
  than 10 minutes with no run id (as `resume` R5); apply every transition whose evidence now exists (results, merge
  receipts, proof runs, receipts, file proofs of manual and decision tasks: SCHEMAS.md 4.2); recompute `run_state`
  (RUNNING, AWAITING_HUMAN, AWAITING_DECISION, PAUSED_QUOTA, PAUSED_RESOURCES, STUCK, BUILD_COMPLETE) and
  `flags.mainnet_open`; import the hooks-state stuck record and clear it, dropping a `stop-failure` record that a later
  `stop.*` event of the same session superseded (the turn went on: a helper's error, not the orchestrator's;
  HOOKS.md 7); a `stop.failure` with error `rate_limit` feeds the quota decision (PAUSED_QUOTA), never STUCK.
- Data: `{run_state, since, plan_version, approved: bool, exec_cmd: "python \"<SKILL_DIR>/scripts/exec.py\"",
  clock: "system"|"override", counts: {status: n}, running_waves: [{wave, run_id, launched, tasks}],
  finished_waves_not_ingested: [waves], awaiting: [{ref, kind, since, latest}], ready_next: [ids], due: [...],
  governor: {...}|null, quota: {...}|null, stuck: {...}|null, notion: {outbox, pending_batches, last_ok}, hooks:
  {bound, canary_ok_utc, last_stop_utc, errors_since_tick, agent_role_source, agent_session_scoped}, next_actions:
  [strings, in tick order], digest_text}` where `digest_text` is plain English, at most `--max-chars`, and starts with
  the `exec_cmd` line. Without `--digest`, the same text is written to `local/digest.txt`, which the SessionStart hook
  prints after compaction or resume (hooks never start exec.py).
- Exit 0 (1 only if the plan or a status file is invalid: E_PLAN_INVALID / E_STATUS_INVALID). Lock: state (not with
  `--digest`). Events: `task.status`, `run.state`, imported hook events.

### `governor` (O; read-only form allowed in preflight)
Resource readings and the launch decision (ARCHITECTURE.md 8.1), measured with PowerShell
(`Get-PSDrive`, `Get-CimInstance Win32_OperatingSystem`, `Win32_Battery`, `Test-Connection`/`git ls-remote`), never
Git Bash `du`.
- Args: `--for wave|install|handover`, `--apply-sweep` (kill orphan processes whose command line matches this
  project's scratch or worktree paths and whose parent is dead; delete per-task scratch of done tasks; remove merged
  worktrees link-safely: delete junctions/symlinks inside first, then `git worktree remove --force`), without it the
  sweep is only listed.
- Data: `{readings: {disk_free_gb, scratch_disk_free_gb, ram_free_gb, commit_free_gb, ac_power, network,
  harden_active}, decision: {pause, lanes, verifiers, browser_slots, workspace_mode, reasons}, sweep: {orphans:
  [{pid, cmd}], scratch: [paths], worktrees: [paths], applied: bool}}`. Lanes = min(profile max, floor((disk_free −
  floor) / lane_footprint), 1 if commit_free < 4 GB); pause when disk < floor, RAM < floor, no AC, no network, or
  `.harden/active` exists; workspace_mode = worktrees only for pnpm projects with disk ≥ floor + 3 × footprint.
- Exit: 0 launch allowed; 1 pause (the reasons are the alert); 3 a reading failed (treated as pause by the
  orchestrator). Writes local/state.json governor (lock: state). Events: `governor`.

### `quota` (O)
Read `profile.quota.snapshot_path` (`~/.claude/usage-snapshot.json`): `captured_at_utc`, `five_hour` and
`seven_day` with `used_percentage` and `resets_at` (epoch seconds, converted to UTC).
- Data: `{snapshot_age_s, five_hour: {pct, resets: display_time}, seven_day: {pct, resets: display_time}, decision:
  normal|critical-only|pause|unknown, pause_until_utc|null, override: {mode, until_utc, decision}|null, reasons,
  projection: {plan_agent_hours_p80, pct_per_agent_hour|null, weekly_pct_needed|null}}`. Rules, first match wins:
  1. **Limit evidence newer than the snapshot** (a `stop.failure` event with error `rate_limit`, or a null storm:
     a wave in which every agent returned null or threw; SCHEMAS.md 4.4) → pause until the five-hour `resets_at`
     (UTC), no launch of any class; with an active `extra-usage` override, until the next tick whose snapshot is
     newer than that evidence.
  2. Five-hour `used_percentage` ≥ 100 → pause until its `resets_at`, unless an `extra-usage` override is active
     (then normal: with extra usage the limit does not stop agents).
  3. Age > `max_age_s` → unknown (warning W_SNAPSHOT_STALE; never invented). The statusline cannot refresh while
     the main loop is itself limited, so a stale snapshot after limit evidence keeps rule 1.
  4. Five-hour ≥ `five_hour_critical_only_pct` → critical-only (also when an override of mode `critical-only` is
     active).
  5. The weekly window cannot cover the plan's P80 need plus `weekly_reserve_pct` → pause and a `quota` decision
     proposal whose options are `extra-usage` (« J'achète de l'usage supplémentaire : continuer »), `critical-only`
     and `wait`; resolving it applies the effect `quota-override {mode, until_utc}` (until the weekly `resets_at`
     unless the owner gives another instant), stored in `local/state.json.quota.override` and rebuilt from the
     decision on replay. With an active `extra-usage` override this rule (and a weekly `used_percentage` ≥ 100) is
     normal.
  Launching resumes on the first tick after `pause_until_utc`.
- Exit: 0 normal, critical-only or unknown; 1 pause. Writes local/state.json quota (lock: state). Events: `quota`.

### `manual post` (O)
Notify the owner of ready manual and decision tasks (ARCHITECTURE.md 11).
- Args: `--task T` (repeatable) or `--all-ready`, `--repost` (again, e.g. latest start approaching), `--link URL`
  (a review board or canvas link shown in the push and the Notion row body; FRONTEND.md 10).
- Writes: own status (ready → running, `posted`), local/state.json `awaiting`. For a decision task (H1 direction, H2
  logo, the plan approval, the name decision, EX-FIX-SELECT) it also opens the linked proposal, of the kind named by
  the template's `decision_kind` (default `plan-task`; `fix-selection` for EX-FIX-SELECT, owner-only), with options
  from `manual.options` or the file at `manual.options_source` (e.g. FE-03's board), recorded in the task's status
  `decision` field; resolving that proposal completes the task (SCHEMAS.md 4.2, file proofs included).
- Data: `{posted: [{task, push_text_fr (≤ 200 chars, names the task id), where, latest_start: display_time,
  steps, bring_back}], notion: "run exec.py notion diff"}`. The orchestrator then calls PushNotification with each
  push text and runs the Notion batch.
- Exit 0. Idempotent without `--repost` (already-posted tasks are listed under `already_posted`). Lock: state.
  Events: `manual.posted`, `task.status`.

### `answers ingest` (O)
Turn a human answer into a verified file and unblock what it unblocks.
- Args: one of `--from-notion RESULT_FILE` (the raw result of a `fetch-answer` op) or `--key K --text-file F
  --source terminal|remote-control`; `--task T` or `--decision D-nnn`; `--by devA|devB`; `--attachment PATH`
  (repeatable; photos land in `~/.claude/uploads/`); `--scope-change` (the orchestrator judged that the answer
  widens scope: stored, a decision is proposed, nothing is unblocked); `--relay` (an answer that arrived in the wrong
  orchestrator's session, TWO-DEV.md 6: stored under `<key>-relay-<executor>`, event `answer.relayed`, nothing
  unblocked, no proposal).
- Verification by `bring_back.verify.method`, after the value matched its kind's strict pattern (0.7): chain-reread
  (runs the task's reader with the value as an argv element, shell none; exit 0 required, and its stdout must be one
  JSON object `{chain, network, from, to, value, block_time}` whose `chain` and `network` equal the task's proof spec,
  whose `from`/`to` equal `bring_back.verify.expect` when given, and whose `block_time` is at or after the task's
  `posted.at_utc`: a real but foreign, older or other-network transaction fails), file-exists, choice-in-options,
  regex, sha-on-origin-main (`git merge-base --is-ancestor`), url-resolves (HTTP status, or render for explorers),
  owner-attest (kinds text and transcript only).
- Proven-public values (README.md 8): when a tx-hash value passes chain-reread, `answers ingest` first registers it
  (`integrity.register_public_value`, proven `chain-reread`, source `answers/<key>.md`), then stores it verbatim as the
  header's `value`, so a tx proof reads it from the tracked answer.
- Text hygiene: the answer text passes `log.redact` and the secret scan (with the registered values) before it is
  stored; a hit is replaced by `[redacted:<pattern id>]` in `answers/<key>.md` (tracked, synced), the raw text kept
  only under `local/answers-raw/<key>.txt`, and W_SECRET_REDACTED is emitted. An unproven secret-shaped value is
  stored with `value: null`.
- Writes: `answers/<key>.md` (immutable), own status (running → done when all bring_back keys verified and, for a
  file proof, the proof evaluated ok; else stays running with the failure), queues a `set-ingested` Notion op.
- Data: `{answer_path, verification: {method, ok, detail}, task_status, unblocked: [ids], proposal: id|null,
  frontend_choice: {path, key: "H3", value}|null}` (`frontend_choice` for FE-21: the entry the orchestrator writes into
  `<state>/frontend/choices.json`, FRONTEND.md 6.4).
- Exit: 0 ingested and verified; 1 verification failed (the answer is kept, the task reposted); 2 unknown key;
  4 the key already exists with other content (E_ANSWER_IMMUTABLE). Lock: state. Events: `answer.ingested` or
  `answer.rejected`, `task.status`.

### `decision propose` (O)
- Args: `--kind K` (decision.schema.json kinds), `--title T`, `--options-file F` (JSON array of options with
  effects), `--recommended ID`, `--deadline-utc ISO`, `--task T` (repeatable).
- Writes: decisions.md proposal block; for kind cut: tasks → cut-proposed (saving `previous_status`); local state
  `awaiting`.
- Data: `{id, deduplicated: bool, push_text_fr, notion: "run exec.py notion diff"}`.
- Exit 0. Idempotent: an open proposal with the same dedup is returned (`deduplicated: true`). Lock: state.
  Events: `decision.proposed`, `task.status`.

### `decision resolve` (O)
- Args: `--id D-nnn`, `--choice-file F` (holds the option id; validated against `^[a-z0-9][a-z0-9-]{0,30}$` and the
  proposal's options), `--by devA|devB|owner`, `--source terminal|remote-control|notion`, `--quote-file F` (the
  owner's words verbatim, written by the orchestrator with the Write tool; never typed into a shell command, 0.7), or
  `--from-notion RESULT_FILE` in place of both files (the stored `notion-fetch` result of the row: exec.py reads
  `Décision` as the choice and `Réponse` as the quote itself, NOTION.md 10.2).
- Applies the option's effects: approve-plan (sets `plan.approved` with `plan_digest`, lock plan; run_state →
  RUNNING), validate-spec, cut-tasks / restore-tasks, unblock-tasks, retry-task, amend (returns the `amend` command
  to run; never edits the plan beyond `approved`), policy-patch (returns the `ingest --patch` command),
  quota-override (`{mode: extra-usage|critical-only, until_utc}` into local state, CLI `quota`), none. For a plan
  decision task (H1, H2 and other decision tasks) the task goes running → done (with a file proof: once the proof
  evaluates ok, SCHEMAS.md 4.2).
- Data: `{id, choice, effects_applied: [...], next: [commands], unblocked: [ids], frontend_choice: {path, key:
  "H1"|"H2", value: {pick, change, answered_at, by, channel, source}}|null}` (FE-04/FE-06: the entry the orchestrator
  writes into `<state>/frontend/choices.json` with the Write tool, merging existing keys, per /frontend's
  `choices.schema.json`; FRONTEND.md 6.4).
- Exit: 0; 1 unknown option; 4 already resolved, or `--by` not a dev for an owner-only kind (approval,
  spec-validation, cut, policy-exception, fix-selection). Lock: plan (approval only), state. Events:
  `decision.resolved`, `plan.approved`, `task.status`, `run.state`.

### `task set-status` (O, guarded)
The only manual override (SCHEMAS.md 4.2 last row).
- Args: `--task T --to ready|blocked-manual|blocked-decision --reason TEXT --decision D-nnn`.
- Exit: 0; 4 any transition outside that row, any target of built, verifying or done (E_TRANSITION_REFUSED), or a
  caller detected as an agent (the guard should have denied it). Lock: state. Events: `task.status`.

---

## 4. Waves

### `wave emit` (O)
Write the next wave: the script, the manifest and the briefs (ARCHITECTURE.md 6.1-6.3). **Emit is final**: it ends by
marking the wave `launching` and its tasks `running`, and the orchestrator calls Workflow right after; a crash between
the two never leads to a second launch of the same tasks (`resume` R5 resolves a `launching` wave).
- Args: `--max-tasks N`, `--include T` (repeatable), `--wave Wnn` (re-emit a `launch-failed` or `abandoned` wave:
  same tasks still ready, same bytes for the same inputs), `--force-critical` (emit critical-path tasks only, used
  under quota critical-only), `--pre-t0` (in a pre-T0 state, FRONTEND.md 11: only `pre_t0` template tasks, chain
  `[implementer]`, no merge, no verifier, and no status transition: the manifest records `pre_t0: true`, its tasks
  stay `planned`, and their outputs become done only through a verifier after T0).
- Preconditions (each failure is exit 4 with the reason, nothing written): plan approved (not with `--pre-t0`);
  governor decision not pause (or `--force-critical` under critical-only quota); quota not pause; hooks canary ok
  within the session; the session's agents probe-check passed or its decision resolved; no `.harden/active`; every
  `brief_refs` path exists (E_BRIEF_REF_MISSING); /frontend fragments and agents present when a frontend task needs
  them (exit 1 E_DEPENDENCY_MISSING plus a decision).
- Selection: own executor's agent tasks (manual and decision tasks are never in a wave) that are `ready`, or `built`
  or `verifying` with no live verifier (a verifier returned null after the landing: chain `[verifier]`), plus
  `planned` tasks whose every not-done dependency is selected in this wave (in-wave dependents, `deps_in_wave`; they
  go planned → running here, SCHEMAS.md 4.2); dispatcher order from `schedule`; the runtime overlap rule (SCHEMAS.md
  7.4) applied against this wave **and every `launching` or `launched` wave not yet ingested** (a task of such a
  manifest is never selected again, and its lanes, resources and writes are occupied); at most `--max-tasks`
  (default: what fits the P80 of about 60-90 min of wave time). `limits` = the governor budget minus the writers,
  verifiers and browser slots of the live waves; nothing fits → exit 1 E_NOTHING_READY with the reason.
- Wave ids: `next_wave_id` allocates under the state lock by creating `waves/Wnn.json` with O_EXCL, in the executor's
  range (A: W01-W499, B: W500-W999; W00 is planning); an id outside the range is E_USAGE.
- Gate tasks (kind gate): `merge.record_gate` writes their merge receipt (`mode: gate`, `outcome: landed`,
  `landed_sha` = origin/main after a fetch) and their chain is `[verifier]` (SCHEMAS.md 4.2).
- Writes: `waves/Wnn.js` (from `assets/workflows/wave.template.js`; constants inlined; frontend fragments inlined
  verbatim with their sha256; static check on the text with comments, strings and template literals removed: no
  `Date.now`, `Math.random`, argless `new Date(`, `require(`, `import `, `process.`; a hit is E_WAVE_FORBIDDEN_TOKEN
  with the token and line), `waves/Wnn.json` (manifest, status `launching`, `launching_utc`), `briefs/<task>.a<attempt>.md`
  (from `assets/briefs/*.md`, every exec.py command line with explicit `--repo` and `--state`), the briefs of the
  prepared in-wave fix attempts (`fix_attempts`, WAVES.md 3.7), the inbox directory; own status (ready / planned /
  built → running, evidence `launch-intent:Wnn`).
- Data: `{wave, script_path, manifest_path, tasks: [{task, lane, chain, critical, model, effort}], lanes:
  [{lane, workspace_mode}], limits, estimate: {p50_min, p80_min, usd_list}, workflow_call: {scriptPath, name, args:
  {now_utc, skip: []}}}`. The orchestrator calls `Workflow(workflow_call)` at once, checks the result for `error`,
  then runs `wave launched`, then `sync --push-only` when two executors run.
- Exit: 0; 1 nothing to emit (`E_NOTHING_READY`, not an error for the tick) or E_WAVE_FORBIDDEN_TOKEN; 4 precondition
  refused.
- A launched or launching wave is never re-emitted (relaunch uses its script). Lock: state. Events: `wave.emitted`,
  `task.status`.

### `wave launched` (O)
- Args: `--wave Wnn`, `--run-id ID`, `--transcript-dir DIR`, `--error-file F` (the Workflow tool's `error` text,
  written to a file: a script that fails its syntax check still returns "launched"), `--relaunch` (same script after
  a usage-limit stop; `args.skip` = tasks done since).
- Writes: manifest `launch`/`status` (`launching` → `launched`, or → `launch-failed` on error), own status (tasks
  stay `running`, or go back to `ready` / `planned` on error), local state waves (with this session's id).
- Data: `{wave, status: launched|launch-failed, tasks_running: [ids]}`. Exit: 0; 1 launch error recorded; 4 the
  script bytes differ from `script_sha256`. Lock: state. Events: `wave.launched` / `wave.launch-failed`,
  `task.status`.

### `result put` (agents and orchestrator)
Validate an agent's result and move it from the inbox into `local/results/`.
- Args: `--wave Wnn --task T --role R --attempt N --file PATH` (the agent wrote PATH in its inbox with the Write
  tool; `--task` omitted for planner results).
- Data: `{path, sha256}`. Exit: 0; 1 schema failure (the file stays in the inbox, the error lists the paths); 4 the
  target exists with other bytes (E_RESULT_IMMUTABLE). Idempotent for identical bytes. Lock: state. Events:
  `result.recorded`.

### `wave ingest` (O)
Close a finished wave (or reconcile one partially, after a crash).
- Args: `--wave Wnn`, `--journal PATH` (the workflow's journal.jsonl, to recover results an agent returned through
  its schema but never `put`), `--finished` (the completion notification arrived).
- Reads: manifest, results and merge receipts of the task's (attempt, rerun) in **any** wave (receipts are looked up
  by task and attempt, never by the current wave's path only), merge intents, proof runs, receipts, the script's
  returned `outcomes` (a hint, used only for `skipped-dep` and `infra-error`, which leave no file) and the journal's
  log lines (to quote an `infra-error`).
- Writes: own status (SCHEMAS.md 4.2, the in-wave fix attempts applied in order), manifest status, local calibration
  (recomputed from the full set of ingested results each time: actual/p50 ratios per kind, failure rate per kind,
  quota pct per agent-hour from snapshot deltas; never updated incrementally), DX rows appended to
  `profile.phase_b.dx_journal` and verifier claims rows to the claims ledger, when those paths are set. Appended rows
  are keyed: each carries a trailing HTML comment `<!-- exec:<wave>:<task>:<role>:a<n>:<i> -->` and a row whose key
  is already present is skipped, so a re-ingest appends nothing. DX rows follow /hackathon's `dx-journal.md` columns:
  When (UTC), Who (`<agent type> <task>`), Where, What I tried, What happened (exact text) with the row's `reproduce`
  line, Time lost, and the mark `UNVERIFIED`. Claims rows follow `claims.md`: `#` is `C-nnn` (numbered per project in
  ledger order; the id /frontend's `data-ledger` attribute cites), claim, where, evidence, status `unverified` (the
  EX-HB-CLAIMS-VERIFY gate task re-runs the evidence and marks rows verified before FE-20 renders figures).
- Data: `{wave, outcomes: {task: done|failed|rerun|blocked-manual|blocked-decision|built|verifying|skipped-dep|infra-error|recorded},
  reruns: [ids], proposals: [decision ids], mismatches: [{task, code}], calibration: {kind: ratio}, null_storm: bool,
  next: [commands]}`. A wave whose agents all returned null or threw sets `null_storm` (quota rule 1).
- Exit: 0; 1 a result failed validation or contradicts its receipt (E_RESULT_RECEIPT_MISMATCH; the receipt wins).
- Converging: a second ingest of the same wave changes no byte (tested). Lock: state. Events: `wave.ingested`,
  `task.status`, `decision.proposed`.

### `merge` (implementer as its last step; integrator steps; orchestrator with `--by orchestrator`)
The local merge queue: the not-rocket-science rule (ARCHITECTURE.md 6.3 step 2).
- Args: `--task T`, `--attempt N`, `--wave Wnn`, `--rerun K` (the status `reruns` of this run; keys the counter, the
  gates dir and the intent), `--worktree DIR --branch B` (worktrees mode: the lane worktree and its branch) or
  `--single-tree --message-file F` (single-tree mode: the agent never commits; F is its conventional message).
- **Before anything**: a merge receipt with `outcome: landed` for this task (any wave, any attempt) → exit 4
  E_ALREADY_LANDED, and its data is that receipt (the rerun agent copies it into its result). A merge intent of this
  task whose `head_sha` is now an ancestor of origin/main → the receipt is finalised from the intent (`landed`) and
  returned the same way. A governor reading below the floors → exit 3 E_ENV (`rerun`).
- Procedure under the merge lock (wait at most 5 min, then exit 3 E_LOCK_TIMEOUT: a rerun):
  1. `git fetch origin`.
  2. Build the candidate commit C on top of origin/main.
     - worktrees: in the lane worktree `git rebase origin/main` (conflict: `git rebase --abort`, outcome conflict with
       the files); C = the lane HEAD.
     - single-tree: **never rebase, reset, stash or commit in the shared checkout** (other agents' uncommitted files
       live there). The changed paths are the files matching the task's `writes` whose working-tree content differs
       from origin/main (added, modified, deleted; untracked included). With a temporary index
       (`GIT_INDEX_FILE=<scratch>/idx-<task>-a<n>r<k>`): `git read-tree origin/main`, `git update-index --add
       --remove -- <paths>`, `git write-tree`, `git commit-tree <tree> -p origin/main -F <message file>` = C, stored at
       `refs/exec/<task>/a<n>r<k>`. No path outside the writes can enter C. Empty change set → state-only task (below)
       or outcome `nothing-to-merge`.
     - state-only task (every write under `.execution/`) with an empty product diff: outcome `landed`, `mode:
       state-only`, `landed_sha` = origin/main, `push_attempts: 0`, gates not run (`exit_code: null`, note), scans run
       on the empty diff with their positive controls, the task's proof run as in (5) (FRONTEND.md 3.3).
  3. Scans on `origin/main..C`: writes-scope (every changed path matches the task's writes), protected (no protected
     glob touched unless allowed by P-20), trailers (no AI-attribution trailer or "Generated with Claude" in any new
     commit message; positive control first), conventional (every new commit's first line is a conventional-commit
     header, `type(scope)?!?: subject`; git's default `Revert "..."` and `Merge ...` lines fail: E_NOT_CONVENTIONAL,
     exit 4; positive control), never-show (scope repo|both on added lines **and on the new commit messages**;
     positive control), secrets (added lines and messages; positive control), test-integrity (no new skip/only/xfail
     markers, assertion count not reduced in existing test files, test config unchanged), todo-judge-facing (no
     TODO/TBD/placeholder added to `profile.paths.judge_facing`), push-freeze.
  4. The offline gates on C's tree through /harden's gates.py: `python <harden>/scripts/gates.py --label
     merge-<task>-a<n>r<k> --config <state>/gates.json --repo <tree> --out-dir
     <state>/local/merge-gates/<task>-a<n>r<k>/gates --json`. `<tree>` is the lane worktree (worktrees) or an
     **integration worktree** `git worktree add --detach <scratch_root>/<project>/integ/<task>-a<n>r<k> C`
     (single-tree), whose `node_modules` is a junction to the shared checkout's install when C changes no manifest
     file (SCHEMAS.md 7.3), else a real install (the task holds `manifest` and `disk-heavy`). Before `gates.json` exists
     (the contract wave has not landed it yet) this step is recorded with `exit_code: null` and a note, which is
     allowed only for tasks of phase setup or contract; any other task is refused (exit 1, E_NO_GATES).
  5. The task's own proof on that same tree, in place (`proof run --by integrator --checkout in-place --tree <tree>`;
     no clone and no second install: gates.py already installed it). It is a pre-push check, never a receipt.
  6. Write the intent `local/merge-pending/<task>.a<n>r<k>.json` `{head_sha: C, origin_before, started_utc}`, then
     `git push origin <C>:refs/heads/main` (never `--force`, never a `+refspec`). A non-fast-forward rejection: back to
     (1) (single-tree rebuilds C on the new origin/main from the same paths), at most 3 times.
  7. Best effort, never failing a merge whose push succeeded: worktrees mode fast-forwards the lane branch; single-tree
     mode leaves the shared checkout alone (`git fetch` only; `wave ingest` re-syncs it between waves, below); the
     integration worktree is removed link-safely (junctions first).
  8. Remove the lane worktree only when the lane has no further task in this wave.
  The receipt is written, then the intent deleted. Every step's duration goes into the receipt's `timings`; the
  budget rule of 0.6 applies before each step (E_TIME_BUDGET, exit 3, the intent kept when the push may have started).
- Shared checkout re-sync (single-tree, run by `wave ingest` when no wave of this executor is running, under the merge
  lock): when local `main` is an ancestor of origin/main, `git reset --mixed origin/main` moves the branch and the index
  without touching files, so files equal to origin/main read as clean and anything left is real uncommitted work
  (listed in the digest and in resume notes); otherwise nothing is moved and the digest says why.
- Secret-shaped values in the added lines (README.md 8, revision 3; Q-B10-7): values already in `public-values.jsonl`
  or inside an explorer link are not hits. For a task whose proof type is tx (or of kind tx or deploy, or holding a
  `wallet:*` resource), each remaining `0x`+64-hex value is re-read on chain with the task's reader exactly as `proof
  run` does (argv element, independent provider, chain and network equal to the proof spec, exit 0 and one JSON
  object); a confirmed value is registered (`proven: "chain-reread"`, `source: "merge:<task>:a<n>"`) and the scan is
  re-run; a value the chain does not confirm, a reader failure, or any such value in a task of another kind stays a
  hit (exit 4 E_SECRET_IN_STATE: the evidence a capture task writes is accepted only once the chain proved it).
- Writes: the merge receipt `local/results/<wave>/<task>.merge.a<n>.json` (merge-receipt.schema.json; one per
  attempt, the latest run's), `refs/exec/<task>/*` in the product repo (single-tree), the intent, events,
  `public-values.jsonl` lines for values the chain confirmed.
- Data: the merge receipt.
- Exit: 0 landed; 1 conflict, gate-failed, scan-failed (non-policy scans), push-rejected-exhausted; 4 policy:
  trailers, conventional header, never-show, secrets, push freeze, protected path, a third merge call in one run
  (E_MERGE_ATTEMPTS, counter keyed `a<n>r<k>`), E_ALREADY_LANDED, `--by orchestrator` from an agent; 3 git or
  environment failure, E_LOCK_TIMEOUT, E_TIME_BUDGET (all `rerun`, never a failed attempt). A gate failure whose
  output matches an environment pattern (out of memory, `ENOSPC`, `There is not enough space`, `Filename too long`)
  is exit 3 E_ENV, not `gate-failed`.
- Lock: merge (state briefly for events). Events: `merge.landed`, `merge.conflict`, `merge.failed`.

### `fe-workspace` (execution-implementer: the fragment runner of a feCritique step)
Prepare the exclusive worktree of a /frontend critique task (WAVES.md 6.2), idempotently per run.
- Args: `--task T --attempt N --rerun K`.
- Does: under the merge lock, `git fetch origin`; when `<scratch_root>/<project>/fe/<task>-a<n>r<k>` is a registered,
  clean worktree on branch `exec/<task>-a<n>r<k>`, reuse it; otherwise remove whatever is there link-safely
  (junctions first) and `git worktree add -b exec/<task>-a<n>r<k> <path> origin/main` (a new branch per run key, so a
  dead run's commits are never reset away); then the gates.json install step in it. A governor reading below the
  floors, or an install that fails for an environment reason, is exit 3.
- Data: `{worktree, branch, reused: bool, install: {ran, exit_code}}`. Exit 0; 3 environment. Converging. Lock:
  merge (briefly). Events: none.

### `snapshot` (execution-test-designer)
Record the current content of some paths as a commit without touching any branch, index or file of the checkout, so
a test-designer working in the shared checkout (WAVES.md 4) has a SHA for its negative control and its tamper check.
- Args: `--task T --attempt N --rerun K --paths GLOB...` (each within the task's writes) `--message-file F`.
- Does: with a temporary index, `read-tree origin/main` + the files under the paths + `commit-tree -p origin/main`;
  stores `refs/exec/<task>/td-a<n>r<k>`. Proof runs fetch `refs/exec/*` into their clone (`proof run`).
- Data: `{sha, ref, paths: [{path, blob_sha}]}`. Exit 0; 1 a path outside the task's writes; 3 git. Not idempotent
  (a new commit object each time; same content gives the same tree). Lock: none. Events: `result.recorded`.

---

## 5. Proofs

### `proof run` (verifier; implementer-merge, reviewer, test-designer `--negative-control`, orchestrator replays)
Re-run a task's proof on a clean checkout of a SHA, hash its output, write raw evidence.
- Args: `--task T --sha SHA` (required), `--negative-control` (run the control instead: pre-implementation = the
  proof on the merge receipt's `origin_before` (the main tip before this task's commits, whatever their number), or on
  the test-designer's snapshot base for a fix test; planted-defect = apply `patch_path` (a patch, or a plant file of
  FRONTEND.md 2.8 applied to copies only) then the proof; forgery = the proof against the forged artifact),
  `--checkout clone|in-place` (default clone: `git -c core.longpaths=true clone --no-local --config
  core.longpaths=true <repo> <scratch>/<project>/proof/<run_id>`, then `git fetch origin "+refs/exec/*:refs/exec/*"`
  so snapshot and single-tree commits are reachable, then `git checkout <sha>`; `in-place --tree DIR` only for
  `merge`'s pre-push check), `--keep` (keep the checkout for the verifier's diff review; `proof verdict` deletes it
  once the verdict is written, link-safely), `--by ROLE`.
- Resources: a governor reading first (disk and RAM above the floors, else exit 3 E_ENV: a rerun and a
  PAUSED_RESOURCES derivation, never `failed`); the clone and its install hold the executor's `disk-heavy` slot (a
  file lock `local/locks/disk-heavy`, waited at most 3 min, then exit 3); the 9-minute budget of 0.6.
- By proof type: command (through gates.py with a one-gate config in the run dir, `inherit_env: false` plus the
  allowlist, the install step first when `spec.install`; when the task holds a `wallet:*` resource or is of kind
  tx, the config's `env` sets `EXEC_ENV_FILE=<policy.secrets.env_file>` and the allowlist gains `EXEC_ENV_FILE`: the
  project's programs load that file by the variable, e.g. `node --env-file="$EXEC_ENV_FILE" ...`, so no command ever
  names an env file), tx (the reader command with the hash from the answer file or the checkout file, as an argv
  element, independent provider; the reader's JSON is compared as in `answers ingest`; a confirmed hash is registered
  in `public-values.jsonl` (proven `tx-proof`); a forged control hash is recorded in tracked copies only as its
  sha256), ci (`gh run list --commit <sha>
  --workflow <file> --json conclusion,status,databaseId` then `gh run view`; success required), file (path in the
  checkout or absolute, `must_match`, JSON pointer equality, `min_bytes`, and `json_checks` (plan.schema.json): per
  pointer `utc`, `enum`, `non-empty`, `url`, `equals`, `min-items`, `dir-exists` under a base directory), url (HTTP GET
  with urllib, status and `must_contain`; `render: true` delegates to the browser resource through a command declared
  in the profile), human-attest (the answer file exists and verified).
- Environment failures are exit 3, never a failed expectation: output matching out of memory, `ENOSPC`, `There is not
  enough space` or `Filename too long`, a checkout or install that could not run.
- Writes: `local/proof-runs/<task>/<run_id>/{run.json, config.json, output.log, gates/}`.
- Data: the proof-run document.
- Exit: 0 expectation met (for `--negative-control`: the control failed as required); 1 not met; 3 could not run
  (checkout, install, tool missing, resources, budget); 4 the proof spec names a forbidden command (policy
  deny_commands, mainnet while closed, an env file by name, `--allow-skip`).
- Not idempotent by design (every run is new evidence, new `run_id`). No product-repo writes. Lock: none for the run;
  state to append events. Events: `proof.run`.

### `proof verdict` (execution-verifier only; gate tasks are verified by a verifier agent like any other task)
Write the receipt that `done` rests on.
- Args: `--task T --run RUN_ID --verdict pass|fail --findings PATH` (a JSON file in the verifier's inbox: `{criteria,
  findings, integrity, implementer_result}`), `--attempt N`, `--model M --effort E` (the verifier's own, from its
  agent definition).
- Checks before writing (each failure: exit 4, nothing written): the run belongs to this task; its `sha` is the
  `landed_sha` of the task's latest `outcome: landed` merge receipt for this attempt, looked up in every wave's results
  (exec.py-written, so trusted even while the status still says `running`: the verifier usually runs before any tick
  reconciles), falling back to the status `landed_sha` when set; `proof_hash` equals the current plan's; a pass needs
  the run's `expectation.met` true (E_VERDICT_MISMATCH); `git fetch` then the SHA is an ancestor of origin/main (else a
  pass is refused, E_NOT_ON_MAIN); negative control satisfied when required; integrity fields consistent with a pass.
- Attestation: the PreToolUse guard, when it allows `exec.py proof verdict` from an agent, writes a hook event
  `guard.attest {agent_id, agent_type, command: "proof verdict", task, run, at}` (and for `exec.py merge`, `{...,
  command: "merge", task, attempt}`). `proof verdict` requires an attestation for (task, run) younger than 10 min
  with `agent_type: execution-verifier` (else exit 3 E_ATTESTATION_MISSING: a rerun), records its `agent_id` in the
  receipt (`by.agent_id`) and the merge attestation's in `implementer.agent_id`; the two must differ (SCHEMAS.md 4.3
  condition 5). The guard denies `proof verdict` from the main thread and any `--by` other than `orchestrator` there
  (HOOKS.md 8.4 A10), so the orchestrator can never write a receipt.
- Transitions: under the state lock, `proof verdict` applies the evidence-backed rows of SCHEMAS.md 4.2 for this
  task on this executor's status (running → built → verifying → done or failed), so the status is right even when no
  tick ran in between.
- Writes: `proofs/<task>.json` (the previous one to `proofs/history/`), the tracked evidence copies
  `proofs/runs/<task>/<run_id>.json` (the run, and the negative-control run when one ran), `proofs/impl/<task>.a<n>.json`
  (the implementer result when it exists) and `proofs/merge/<task>.a<n>.json` (the landed merge receipt), own status,
  events; deletes the kept checkout of the cited run (link-safely).
- Data: the receipt plus `receipt_sha256` (the wave script resolves `done` only when it is non-null). Exit: 0
  written; 1 the findings file fails validation; 3 E_ATTESTATION_MISSING; 4 refused. Lock: state. Events:
  `proof.verdict`, `task.status`.

### `completion generate` (O)
Generate `completion-check.mjs` from the plan (ARCHITECTURE.md 9) from `assets/completion-check.template.mjs`.
- Gates (id, phase): `REQ.<req id>` (build, or deliverable when every covering task is deliverable-phase): every
  covering task not cut is done with a receipt whose SHA is an ancestor of HEAD; `DL.<deadline id>` for each
  irrecoverable deadline (its gate_phase): the task anchored to it is done before `at_utc`; `TODO.judge` (build): no
  deferral marker in judge-facing files (BNB pattern, `<!--todo-ok-->` exemption); `NEVERSHOW.repo` (build): active
  repo-scope entries absent from tracked files; `PLAN.chain` (build): plan digest chain intact (P-26);
  `CONVERGENCE` (build): the latest convergence reviewer result for HEAD has no `missing`/`partial` gap within
  scope; `HARDEN.ready` (build): the latest `harden-ready` report for HEAD is ok (profile `pre-harden`, or
  `after-harden` once EX-HARDEN-REVIEW is done); `FRONTEND.build` (build, when the plan has frontend tasks): runs,
  from the repository the check runs in, the FE-20 command of FRONTEND.md 6.2 without its receipt check:
  `<build prefix> node <frontend>/scripts/frontend-check.mjs --json --phase <build|small, by profile.frontend.mode> --profile "<state>/profile.json"
  --root <repo> --state "<state>/frontend" --out "<fs.mkdtempSync(os.tmpdir())>" <serve target>` (the stack's build
  prefix and serve or start target, as instantiated; the gates.json install has run in the clone first, P-18), and
  requires exit 0; `HARDEN.report` (harden): the harden-review manual task is done; `FIX.<id>` (harden): selected fix
  tasks done; `DLV.<task>` (deliverable): each deliverable task done.
- Script properties: Node ≥ 20 built-ins only; reads only the state dir (absolute path embedded at generation) and
  the repository it runs in (the cwd, or `--repo DIR`; a verifier runs it from a clean clone of the landed SHA, so
  HEAD and the scanned tree are that SHA's) — offline; `--json` and `--phase build|harden|deliverable|all` or a comma
  list (`build,harden`; default all); a gate that throws is `fail`; a gate it cannot evaluate is `skipped` and
  therefore open; exit 0 iff ok; human summary otherwise; `--allow-skip` does not exist. Out of CI, always.
- Data: `{path, sha256, gates: [{id, phase}]}`. Exit 0. Idempotent (byte-identical for the same plan). Lock: plan
  (read), state. Events: `completion.generated`.

### `completion run`
- Args: `--phase build|harden|deliverable|all` or a comma list.
- Runs `node <state>/completion-check.mjs --json --phase <p>`, validates the output against
  completion-gates.schema.json and recomputes `ok` from the gates of the selected phases (invalid output, or an `ok`
  that disagrees with its gates: exit 3 E_GATES_OUTPUT), stores it at `local/completion/<stamp>.json`.
- Data: the gate output plus `{report_path}`. Exit: the script's 0/1; 3 node missing or invalid output. Read-only
  toward plan and status. Events: `completion.run`.

### `harden-ready` (O)
Reproduce every condition under which an autonomous /harden degrades to report-only (ARCHITECTURE.md 1.2, H1-H14),
without ever writing `.harden/` or invoking /harden. Exact commands, formulas and evidence: HANDOVER.md 1 (this
section summarises it; on any difference HANDOVER.md 1.4 is the text the core adopts).
- Args: `--only H1,H5,...`, `--scratch DIR` (default `<scratch_root>/<project>/harden-ready-<stamp>`),
  `--after-harden` (the post-harden profile; automatic in run_state FIX or once EX-HARDEN-REVIEW is done): H8 is not
  run (/harden already ran) and H9 becomes "time covers the remaining deliverables' P80" (`now + deliverables_p80_min ≤
  submission deadline`, `local/schedule.json` `build_complete`), so a fix cycle near the deadline can still pass
  EX-FIX-GATE. The report records `profile: pre-harden|after-harden`.
- Checks: H1 HEAD exists, pushed, no `.harden/active` · H2 `git status --porcelain=v1 --untracked-files=all` empty
  outside `.harden/` (positive control: the excludes are in place) · H3 a `git grep` for focus markers only (`.only(`,
  `fit(`, `fdescribe(` and the forms of HANDOVER.md 1.4; skip markers are counted in detail, never failing) over
  tracked test paths · H4 self-setup dry run with every output under the scratch dir:
  `prescan.py --repo <repo> --out <scratch>/prescan.json`, `inventory.py --repo <repo> --out
  <scratch>/inventory.json`, `infer_profile.py infer --repo <repo> --inventory <scratch>/inventory.json --out-dir
  <scratch>/infer`, `infer_profile.py probe --repo <repo> --out-dir <scratch>/infer`, `infer_profile.py finalize
  --repo <repo> --out-dir <scratch>/infer` (never `--install`); pass iff the finalized profile has a test gate, mode
  is not report-only and `live_side_effects` is none · H5 `gates.py --label harden-ready-repeat --repeat 3 --config
  <scratch>/harden-ready.config.json --repo <repo> --out-dir <scratch>/gates --json` where the config is the
  finalized profile's gates (reduced to gates.py's GATE_CONFIG_KEYS) under the top level of
  `<scratch>/infer/profile-probe.config.json` (`env_policy: allowlist`, `inherit_env: false`, `env_allowlist` =
  `profile-inference.json` `config_env.env_allowlist`), so the gates run in /harden's allowlisted environment: exit 0
  and no flaky gate (the shuffled gate is infer_profile's when it produced one; without one, ok only when
  `profile-inference.json` records no `no shuffled gate for` limit, detail "no shuffled run") · H6 `git -c
  core.longpaths=true clone --no-local <repo> <scratch>/fresh`, the lockfile install from
  `profile-install.config.json`, then gates.py `--repo <scratch>/fresh` with the same config: exit 0 · H7 no
  auto-loaded env file in the tree (`git ls-files` and the untracked list matched by name only, never opened;
  `.env.local` and friends: fail, the fix is the owner's parking task) · H8 `harden_agents.py status` exits 0 (not
  with `--after-harden`) · H9 disk above the floor plus twice the fresh clone plus 1 GB, and `now + harden_budget_min
  ≤ harden_end_latest_utc` with `harden_budget_min` = `profile.harden.budget_min_p80` or `1.2 × clamp(60 + 20 × loc /
  1000, 120, 600)` (with `--after-harden`: the remaining deliverables' P80, above) · H10 contract/validator sources
  (`profile.harden.exclude_globs` and `.sol`/`.vy`) frozen (the freeze task done and no commit touching them after
  it) or proposed for exclusion in the hand-over · H11 README factual (the EX-README task's proof replayed on HEAD),
  `.env.example` lists every env name the code reads, no TODO in judge-facing files · H12 `gh run list --commit HEAD
  --workflow <ci> --json conclusion` is success · H13 every done task has a proof run of HEAD in a fresh clone
  with `by.role: replay` and `expectation.met: true` (written by the EX-REPLAY task's verifier agents) · H14 when the
  plan has frontend tasks: the `FRONTEND.build` command (above) from `<scratch>/fresh` after H6's install, with `--out
  <scratch>/fe` (a requested gate that is skipped exits 1).
- Writes: `local/harden-ready/<stamp>.json` (completion-gates shape, `tool: harden-ready`, phase build); the scratch
  dir (removed after unless `--keep`). Never writes `.harden/`, never runs `finalize --install`.
- Data: the gate document. Exit: 0 all ok; 1 any fail or skipped; 4 `.harden/active` exists (H1, refused). Lock:
  none (read-only toward state except its report). Events: `harden-ready.run`.

---

## 6. Notion (the orchestrator executes the emitted ops; exec.py never calls Notion)

### `notion diff` (O)
- Args: `--init` (databases, self-relation, views, in stages), `--wave Wnn` (include the wave report row and the hub
  "Now" text), `--replay-outbox`.
- Builds the ops: create-pages for rows without a page id (one call, ≤ 100 rows, `allow_async: false`), update-page
  for rows whose orchestrator-owned properties hash differs from the last ack (one call each), the self-relation in a
  later stage once page ids exist, the wave report (create-pages in Waves), the hub "Now" text (update_content with
  the last written text as `old_str`); with a non-empty outbox the batch starts with a `token-check` op (one real read)
  and the outbox ops follow; only rows of this executor.
- Writes: `local/notion/batches/<batch_id>.json`, local state `pending_batches`.
- Data: the batch (notion-ops.schema.json) plus `{count}`; an empty `ops` when nothing changed. Exit 0; 1 profile has
  no hub page id (E_NOTION_UNCONFIGURED) or Notion disabled. Idempotent until acked. Lock: notion. Events:
  `notion.batch`.

### `notion ack` (O)
- Args: `--batch ID --op ID` and one of `--result-file PATH` (the raw MCP result), `--failed --error-file PATH` (the
  error text written with the Write tool, 0.7; `--retry-after S` when the error was rate_limited), `--failed
  --error-code CODE` (fixed codes the orchestrator types: `deferred:rate_limited`, `crash-unknown`).
- `notion diff` passes every text property and page body it emits through `log.redact` and the secret scan; a hit is
  replaced by `[redacted:<pattern id>]` (W_SECRET_REDACTED): nothing that left a verifier's output reaches the shared
  hub verbatim.
- Effects: success → capture ids (pages, databases, data sources, views; written to profile.notion ids through
  `ingest --patch` data in `next` when they are profile fields), record `hashes[key]`; an `async_task` result →
  schedules an async-poll stage; failure → appended to `local/notion/outbox.jsonl`; repeated auth failure →
  `token_ok: false` and `next` includes a push text asking for `/login` at the laptop.
- Data: `{op, ok, captured: {name: id}, outbox_count, next: [commands]}`. Exit 0 (a recorded failure is not an exit
  failure); 2 unknown batch/op. Idempotent per op. Lock: notion, state. Events: `notion.ack`, `notion.outbox`.

### `notion poll-plan` (O)
Emit the poll: one `notion-query-data-sources` op in **view mode** on the "To ingest" view (quota-free; rows mode is
metered and never used for polling), plus, for the previous poll's hits, one `notion-fetch` per row to read the
Answer and Decision fields faithfully. Data: the batch. Exit 0. Lock: notion. Events: `notion.poll`. The fetched
results go to `answers ingest --from-notion` or `decision resolve --source notion`.

---

## 7. Reporting, hand-over, fix mode

### `report` (O)
- Args: `--wave Wnn` (default: the last ingested wave), `--view` (regenerate `EXECUTION.md` only).
- Writes: `reports/Wnn.fr.md` (French, single column for the phone, rendered by script from receipts and status,
  never model prose): Fait / Prouvé (avec liens de preuve) / Ouvert / Ta prochaine action / Zone et P80 / Pouls
  (disque, RAM, quota, dernier tick en SGT et à Paris); `EXECUTION.md` (English, TASKLIST style: owner, proof, latest
  date, status per task).
- Data: `{report_path, text_fr (≤ 6000 chars), push_text_fr (≤ 200 chars) | null when the owner has nothing to do,
  notion: "run exec.py notion diff --wave Wnn"}`. Exit 0. Idempotent. Lock: state. Events: `report.written`.

### `handover` (O)
Print the hand-over from receipts and end the run (ARCHITECTURE.md 1.2).
- Args: `--decision D-nnn` (a resolved owner-only `policy-exception` decision whose option is
  `handover-report-only` or `skip-harden`: hands over with the named red gates, HANDOVER.md 3.4), `--final` (the end
  of the run after the deliverables: requires `completion run --phase all` ok for HEAD; writes the final French
  report, uninstalls the hooks, run_state RUNNING → HANDED_OVER with reason `deliverables complete`).
- Preconditions (exit 1 with the open list, nothing changed): the latest `completion run --phase build` for HEAD
  is ok; the latest `harden-ready` for HEAD is ok; both newer than the last commit on origin/main (or `--decision`).
  Exit 4 when `.harden/active` exists.
- Writes: `harden-profile.draft.json` (a time-capped /harden profile candidate in the state dir, outside the product
  tree; the owner promotes it); run_state → HANDED_OVER; `hooks uninstall`; deletes `local/active`.
- Data: `{final_sha, type_this: "/harden" | "/harden <paths>" | "/harden --profile <abs path>" | "/harden <paths>
  --profile <abs path>", why, time_left: {until: display_time, minutes}, harden_budget_min, profile_draft,
  open_after_harden: [deliverable task ids], red_gates: [ids] (with `--decision`), text_fr}`. Exit 0. Idempotent after
  success (prints the same hand-over). Lock: state. Events: `handover`, `hooks.uninstalled`, `run.state`.

### `fix` (O)
Fix mode (ARCHITECTURE.md 18): parse a /harden report and turn the owner's selection into fix tasks.
- Args: `--report PATH` (required), `--list` (parse only), `--select ID,...` or `--select-file PATH` (a JSON list of
  `{id, action, value}` for values with commas or new lines) with `--decision D-nnn` (the owner's resolved
  fix-selection decision quoting the selection), `--reason-unselected-file PATH`.
- Parsing: the report's sections "Applied, review before merge", "Needs your decision", "Open owner items"; each item
  `{id, section, title, file, line, severity}`; unknown structure → exit 1 E_REPORT_FORMAT, never guessed.
- With `--select`: `amend` with fix tasks (phase fix, kind code/test/infra, each with a proof from the item, a
  dependency on the harden-review task, the regression re-run of the build gates as a final gate task); unselected
  items recorded in decisions.md with the reason; run_state → FIX.
- Data: `{items: [...], created_tasks: [ids], recorded_unselected: [ids], next: ["exec.py schedule", "exec.py wave
  emit"]}`. Exit: 0; 1 parse failure; 4 no resolved decision. Locks: as amend. Events: `fix.parsed`,
  `fix.selected`, `plan.amended`, `run.state`.

---

## 8. Recovery and maintenance

### `events replay` (O)
- Args: `--since ISO`, `--rebuild-state` (rewrite local/state.json from events, status, manifests and receipts).
- Data: `{events: n, invalid: [{line, code}], duplicates: n, rebuilt: bool, diff: {field: [old, new]}}`. Exit 0; 1
  invalid lines found (still rebuilt from the valid ones). Lock: state. Events: `resume` when rebuilding.

### `resume` (O)
The script half of the recovery playbook (ARCHITECTURE.md 16); the orchestrator does the tool half (CronList,
CronCreate, re-arming watchers, Workflow relaunch). The recovery restart is always `launch-exec.ps1 -Resume` (or
`launch-exec.sh --resume`): `claude --resume "<proj>-exec" --dangerously-skip-permissions` with the launcher's
environment, which keeps the session id, the bypass mode and the concurrency cap.
- Args: `--takeover` (main thread only; the only O-command the guard's run lease lets a session that is not the bound
  one run): reads `CLAUDE_CODE_SESSION_ID`; when it differs from `marker.session_id`, appends the old id to
  `previous_session_ids` (last 10), sets `session_id: null`, writes a fresh `bind_nonce`, clears the recorded
  heartbeat, and returns the steps to finish: CronDelete the old session's heartbeat if that session still runs (or
  close it), `hooks canary --nonce <new>` next turn, CronCreate a new heartbeat. Without `--takeover` a different
  session id is reported (R1) and nothing is rebound.
- Steps reported, each `{id, done, detail, command?}`: R0 environment: `CLAUDE_CODE_RETRY_WATCHDOG=1`,
  `CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS` = the profile's, `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` ≥ 60000,
  `MSYS_NO_PATHCONV=1` (PF-03..05, PF-29): any missing → "restart through `launch-exec.ps1 -Resume`" · R1 marker and
  session: `CLAUDE_CODE_SESSION_ID` equal to `marker.session_id` → nothing (a `claude --resume` keeps the id); different
  → `next: exec.py resume --takeover`; absent → unknown, reported, treated as different for R5 · R2 hooks entries
  present in settings (reinstall if not) · R3 residue: stale `.git/index.lock` with no live git process removed, ports
  held by dead pids listed · R4 lane worktrees and the shared checkout: uncommitted files listed per lane (resume notes
  written to `briefs/<task>.resume.md`: committed SHAs, uncommitted files, "review as someone else's work") · R5
  waves not ingested: `{wave, status, run_id, same_session: bool|null, action: resumeFromRunId|relaunch|ingest|
  record-launch|abandon|decide}`: `same_session` compares `CLAUDE_CODE_SESSION_ID` with the session id recorded at
  launch (resumeFromRunId only when equal); a `launching` wave with no run id is looked up by its `workflow_name` among
  the session's workflow transcripts and the inbox/results activity under `local/inbox/Wnn`: found → `record-launch`
  (`wave launched --run-id`), no trace at all after 10 minutes → `abandon` (tasks back to ready, never re-emitted),
  activity without a run → `decide` (a `resources` decision) · R6 merge intents: finalise those whose head is on
  origin/main, report the others · R7 `events replay --rebuild-state` · R8 `status` · R9 Notion: every op of a pending
  batch without an ack is acked `--failed --error-code crash-unknown`; its creates go through the `view:board` map
  rebuild before any re-create, no sooner than 60 s after the batch's emit time; a stored batch is never re-executed by
  hand · R10 heartbeat: check with CronList and recreate with `heartbeat plan` if absent.
- Data: `{steps, waves, session: {env_id, bound_id, same: bool|null}, rebind_nonce|null}`. Exit 0. Converging. Lock:
  state. Events: `resume`.

### `fixture new` (O; also used by tests)
Create the neutral rehearsal project "Queue Clock" from `evals/fixture/` (shared with /frontend's A/B evaluation).
- Args: `--dest DIR` (required, must be empty or absent, outside every repo), `--variant a|b`, `--with-remote`
  (create private GitHub repos with `gh repo create --private`; off by default), `--two-dev` (a second full-setup dev
  and a second clone `repo-b`), `--frontend-mode small|full` (default small).
- Writes: the instance of FIXTURE.md 2: `private/` (spec, workspace notes, profile/policy drafts with
  `profile.frontend` paths filled, a never-show file with one live and one expired embargo; the spec stays outside the
  product repository, whose paths the profile names absolutely), `repo/` (a git repo with the synthetic data, one
  `simulated` and one `planned` feature in the spec), local bare remotes; never event content.
- Data: `{dest, spec, drafts: {profile, policy}, never_show, commit}`. Exit 0; 1 dest not empty. Idempotent: no
  (refuses a non-empty dest).

---

## 9. Quick index

| command | O | writes | lock | exit 1 means |
|---|---|---|---|---|
| init | O | state skeleton, excludes | state | state mismatch |
| preflight | O | — | — | a check failed or is open (skipped, unconfirmed) |
| ingest | O | profile, policy | state | invalid / dependency missing |
| hooks install / canary / uninstall | O | settings.local.json, active | state | invalid settings / not live |
| agents install / status / probe / probe-check | O | ~/.claude/agents, local/probe | — | refused / not current / probe failed |
| heartbeat plan / record | O | local state | state | — |
| sync | O | state repo | git-state | conflict / invalid merged plan |
| plan instantiate | O (dry-run: agents) | plan, catalogue | plan, state | invalid |
| plan emit | O | local/planner | state | forbidden token / dependency missing |
| validate | — | — | — | invalid |
| catalogue | O | catalogue | plan | — |
| schedule | O | status, schedule.json | state | invalid plan |
| simulate | — | — | — | bad input |
| due | O | — | — | — |
| amend | O | plan (CAS push) | plan, git-state, state | invalid / CAS exhausted |
| status | O (`--digest`: all) | status, events | state | invalid documents |
| governor | O | local state | state | pause |
| quota | O | local state | state | pause |
| manual post | O | status | state | — |
| answers ingest | O | answers, status | state | verification failed |
| decision propose / resolve | O | decisions, status, plan.approved | state (+plan) | unknown option |
| task set-status | O | status | state | — (refusals are 4) |
| wave emit / launched / ingest | O | waves, briefs, status | state | nothing ready / launch error / invalid results |
| result put | agents | results | state | schema failure |
| merge | implementer | merge receipt, origin/main | merge | conflict / gates / scans |
| snapshot | test-designer | refs/exec/* | — | path outside the writes |
| fe-workspace | implementer (fragment runner) | a scratch worktree | merge | — (3 environment) |
| proof run | verifier et al. | proof-runs | — | expectation not met |
| proof verdict | verifier | proofs | state | findings invalid |
| completion generate / run | O / all | completion-check.mjs | plan, state | gates open |
| harden-ready | O | harden-ready report | — | a check failed or skipped |
| notion diff / ack / poll-plan | O | batches, outbox | notion | unconfigured |
| report | O | reports, EXECUTION.md | state | — |
| handover | O | draft profile, hooks removed | state | gates not green |
| fix | O | plan (amend) | as amend | report unparsable |
| events replay | O | local state | state | invalid lines |
| resume | O | local state, resume notes | state | — |
| fixture new | O | a new repo | — | dest not empty |
