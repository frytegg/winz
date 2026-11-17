# WAVES.md — wave scripts, briefs and the planner workflow

Companion file (README.md 1.2). It refines MODULES.md section 7 (the generated wave script), CLI.md section 4
(`wave emit | launched | ingest`, `result put`, `merge`) and ARCHITECTURE.md 3.2, 6.1-6.3; it never changes them.
Owner lane: B05 (`execlib/{wave,briefs,wavejs}.py`, `assets/workflows/{wave,planner}.template.js`,
`assets/briefs/*.md`, `scripts/tests/js/wave-harness.mjs`). Revision 2 adopted the additions this file proposed
(section 11). The two templates in sections 8 and 9 are complete and were smoke-run under Node 24 with a fake
`agent()` on 2026-10-01 (dependency gating, null → rerun, `args.skip`, semaphore limits, the fragment path, the
in-wave fix loop, the planner's three exits); revision 2 then changed `callAgent` (a throw is `infra-error`), the
merge exit-3 and receipt checks and the fragment counters, so B05 re-runs that smoke (section 10) before copying them.

Contents: 1 launching a wave · 2 rendering · 3 the wave script · 4 chains per task · 5 the brief file ·
6 /frontend fragments · 7 the planner workflow · 8 wave template (full JS) · 9 planner template (full JS) ·
10 what the harness tests · 11 open points.

---

## 1. Launching a wave

### 1.1 What `exec.py wave emit` prints (CLI.md, `data.workflow_call`)
```json
{"scriptPath": "C:/repo/.execution/waves/W03.js", "name": "execution-wave-w03", "args": {"now_utc": "2026-10-06T08:15:00Z", "skip": []}}
```
The orchestrator passes it to the Workflow tool unchanged: `Workflow({scriptPath, args})` (`name` is the script's own
`meta.name`, kept in the data for the log). `args` is a JSON object, never a JSON-encoded string.

### 1.2 `args` (the only runtime input; everything else is inlined)
| field | type | meaning |
|---|---|---|
| `now_utc` | utc string | the clock (the script cannot read one: `Date.now()` and argless `new Date()` throw) |
| `skip` | task ids | tasks already proven since the wave was emitted (a relaunch after a usage-limit stop): they resolve `done` for their dependents and are not run |
Extra keys are ignored. `args` must equal the manifest's `args` at first launch; a relaunch passes `wave launched
--relaunch` the new `skip` list and the same script bytes (`script_sha256` checked).

### 1.3 After the call
`wave emit` already marked the wave `launching` and its tasks `running` (emit is final, CLI.md), so the Workflow call
follows at once, in the same turn.
1. The launch result can say "launched" with an `error` field (a syntax error in the script) [rt missed-6]: the
   orchestrator runs `wave launched --wave Wnn --run-id <runId> --transcript-dir <dir>` plus `--error-file <file>`
   (the error text written with the Write tool) when present, and the tasks go back to `ready`. With two executors it
   then runs `sync --push-only`, so the other orchestrator sees the in-flight tasks within minutes.
2. The turn ends; the completion notification wakes the orchestrator [rt F01]; it runs `wave ingest --wave Wnn
   --finished --journal <transcriptDir>/journal.jsonl`. The script's return value (section 3.8) is only a hint; ingest
   re-reads every fact from files (results, merge receipts, proof runs, receipts).
3. Resume: `resumeFromRunId` replays the longest unchanged prefix of `agent()` calls and works only in the launching
   session [hooks F19]; with concurrent tasks the call order is not stable, and a relaunch after a failure reruns the
   first failed agent and every agent started after it, even completed ones [rt V-F31]. So the script never relies on
   replay: every agent's brief carries an "Already recorded" section (standing rule 13) and `merge` refuses a second
   landing (E_ALREADY_LANDED), so a rerun agent returns the recorded result instead of redoing work. `resume`
   classifies each launched wave (CLI.md R5) as resumeFromRunId (same session), relaunch (new session, with `skip`),
   or ingest only.

---

## 2. Rendering (`execlib.wavejs`)

### 2.1 Placeholders in `assets/workflows/wave.template.js`
| token (exact text in the template) | replaced by |
|---|---|
| `@@WORKFLOW_NAME@@` (inside a single-quoted string) | `execution-wave-<wave lowercased>`; matches `^[a-z0-9][a-z0-9-]{1,60}$` (manifest `workflow_name`) |
| `@@WORKFLOW_DESCRIPTION@@` (inside a single-quoted string) | `Wave W03 of <project>: <n> tasks (<ids, at most 12>)`; characters limited to `[A-Za-z0-9 ,.:()/-]` so no escaping is needed |
| `/*@@MANIFEST@@*/null` | `js_literal(manifest)`: the wave manifest (wave-manifest.schema.json) with `launch: null`, `status: "emitted"` |
| `/*@@EXTRA@@*/null` | `js_literal(extra)` (3.2) |
| `/*@@FRAGMENTS@@*/` | the source of each needed /frontend fragment file, verbatim, in the order feDirections, feCritique, separated by one blank line; an empty string when the wave has no fragment task |

`js_literal(obj)` = `json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))` with U+2028 and U+2029
escaped as `\u2028` / `\u2029`. The `meta` object stays a pure literal after substitution (the Workflow tool requires
it). After rendering no `@@` may remain (checked).

### 2.2 The static check (`wavejs.static_check`)
CLI.md lists the forbidden tokens `Date.now`, `Math.random`, argless `new Date(`, `require(`, `import `, `process.`.
They are searched in the rendered script **after removing comments, string literals and template literals** with a
small JS-aware scanner (`wavejs.strip_js`, same approach as /frontend's `text.stripComments`): /frontend's own
fragment headers contain the words "no import or export, no Date.now, no Math.random" in comments (measured
2026-10-01), so a literal scan would refuse every wave that inlines them. An occurrence in code (outside comments and
strings) is exit 1 `E_WAVE_FORBIDDEN_TOKEN` with the token and line. The fragment files are hashed before inlining;
their sha256 goes into `manifest.fragments` and the inlined text must be byte-identical to the file (test).

### 2.3 Syntax check
`wavejs.node_check(path)`: the rendered script is not a valid module for `node --check` (top-level `return`), so the
check wraps it: it writes `<scratch>/check-Wnn.mjs` containing
`const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor; new AsyncFunction('agent', 'parallel',
'pipeline', 'log', 'phase', 'args', <JSON string of the script with "export const meta" replaced by "const meta">);`
and runs `node <file>` (constructing the function parses the body without running it). Exit 0 required; Node absent
→ warning, the launch-result `error` check then catches a syntax error.

### 2.4 Determinism
Same plan, status, profile, governor reading, fragments and `--now` → byte-identical script, manifest and briefs
(CLI.md idempotency for an unlaunched wave). Nothing time- or machine-dependent is rendered except through `--now` and
the governor decision recorded in the manifest `limits`.

---

## 3. The wave script

### 3.1 Globals it uses
`agent`, `parallel`, `pipeline`, `log`, `args` (the Workflow hooks); `phase` is not called (every agent passes its own
`opts.phase`, race-free inside concurrent tasks). No `budget`, no `workflow()`.

### 3.2 `EXTRA` (rendered next to the manifest; covered by `script_sha256`)
```json
{
  "schemas": {"result-implementer": {}, "result-test-designer": {}, "result-verifier": {}, "result-reviewer": {}, "merge-result": {}},
  "runner": {"agentType": "execution-implementer", "model": "sonnet", "effort": "low"},
  "fe": {
    "T042": {
      "fragment": "feCritique",
      "input": {"task": "T042", "cwd": "C:/scratch/queue-clock/fe/T042-a1", "skill": "C:/Users/Utilisateur/.claude/skills/frontend", "...": "fragment.input of /frontend's template, every placeholder resolved"},
      "prepare": {"command": "python \"C:/Users/Utilisateur/.claude/skills/execution/scripts/exec.py\" --repo \"C:/repo\" --state \"C:/repo/.execution\" fe-workspace --task T042 --attempt 1 --rerun 0", "worktree": "C:/scratch/queue-clock/fe/T042-a1r0", "branch": "exec/T042-a1r0"},
      "receipt_inbox": "C:/repo/.execution/local/inbox/W03/T042.fe-critique.a1r0.json"
    }
  },
  "in_wave_fix": true,
  "fix": {"T012": [{"attempt": 2, "brief_path": "C:/repo/.execution/briefs/T012.a2.md"}]}
}
```
- `schemas`: the role result schemas bundled by `schema.bundle(name)` (every `$ref` inlined; `$schema` and `$id`
  removed), keyed by the names used in `manifest.tasks[].agents[role].schema`. The `agent()` call validates against
  them [workflow `schema` option]. `merge-result` is `result-implementer.schema.json#/properties/merge` (non-null
  branch) bundled on its own: the integrator returns what merge printed, not the full receipt.
- `runner`: options of the command-runner and receipt-writer agents the script itself starts around fragments.
- `fe`: one entry per fragment task (section 6).
- `in_wave_fix` and `fix`: the bounded in-wave fix loop (3.7); `fix[task]` lists the extra attempts the emitter
  prepared (attempt numbers `attempt+1 … max_attempts`, each with a pre-rendered brief), mirrored in the manifest's
  `tasks[].fix_attempts` so `wave ingest` can apply them (SCHEMAS.md 4.2 `failed → running`).

### 3.3 Dependency-driven start (no barrier)
Every task gets a deferred promise (`DONE[id]`) before any task starts; all tasks start at once and each first awaits
the promises of its `deps_in_wave` (dependencies outside the wave are already done: `wave emit` selects only tasks
whose other dependencies are done). A dependency that ended anything but `done` makes the dependent resolve
`skipped-dep` without running: `wave ingest` puts it back to `planned` (it went planned → running at emit), with no
rerun counted (MODULES 7, SCHEMAS.md 4.2). Dependencies always have lower ids
(P-02), so the promises cannot form a cycle. A task waits for its dependencies **before** taking any lock, so a
waiting task never holds a resource.

### 3.4 Priority queue and semaphores
| semaphore | size | held during |
|---|---|---|
| `WRITERS` | `limits.writers` | implementer, test-designer and fragment steps |
| `VERIFIERS` | `limits.verifiers` | verifier and reviewer steps |
| `INTEGRATORS` | `limits.integrators` (1) | integrator steps (merge is also serialised by the merge lock) |
| `BROWSER` | `limits.browser_slots` | the whole task, for tasks holding the `browser` resource |
| one per other resource (`manifest`, `wallet:*`, `port:*`, `db:*`, `human:*`, `disk-heavy`) | 1 | the whole task |
| one per lane | 1 | each writing step (one writing agent per lane at a time [par rec 3]) |
Waiters are served by `priority_rank` (the dispatcher's order from `schedule`: least slack, then longest remaining
path, then successors, then id; SCHEMAS 7.4), ties by task id. **Lock order** (deadlock freedom): a task takes its
whole-task resources in sorted name order, then per step the lane, then the step's semaphore; it releases in reverse.
No holder of a step semaphore ever waits for a resource or a lane, and every task takes resources in one global order,
so no cycle can form. `writers + verifiers + integrators ≤ limits.concurrency_env` (manifest schema); agents started
inside a fragment are not counted by these semaphores (a fragment holds one writer slot) and are queued by the
Workflow tool's own cap (`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS`). A task needing `browser` while
`browser_slots` is 0 resolves `rerun` (the governor withheld browsers for this wave).

### 3.5 Agent calls and null
Every call goes through `callAgent(prompt, opts)`: a `null`/`undefined` return (the agent died, or hit a usage limit
while Remote Control is connected [rt V-F31]) is logged and becomes outcome `rerun`; a **throw** (an agent type that
does not resolve, an unsatisfiable schema, a spent budget, a scheduler error: all deterministic, so a rerun would loop
forever) is logged with its message and becomes outcome `infra-error`, which `wave ingest` turns into
`blocked-decision` with a `dependency-missing` decision (SCHEMAS 4.4). Neither is ever read as a result, and nothing
is ever `done` without a verifier's pass with a receipt. Options come from
`manifest.tasks[].agents[role]` (`label`, `phase` ∈ the meta phase titles, `model`, `effort`, `agentType`, `isolation:
'worktree'` only for the implementer in worktrees mode, `schema`). The prompt is exactly (MODULES 7):
```
Read your brief at <brief_path> and follow it exactly. Role: <role>. Task <id>, wave <wave>, attempt <n>.
```
plus, for verifier and reviewer, `Landed SHA: <sha>.` (or `Landed SHA: as your brief states it under "Landed SHA".`
when no step of this chain landed anything, e.g. gate tasks), and for the integrator `Run only the command of the brief
section "Role: integrator", then return the merge receipt it printed.`

### 3.6 The per-task pipeline (one attempt)
Steps run in the order of `manifest.tasks[].chain`; the first step that decides an outcome ends the attempt.
| step | agent | success | outcome when not |
|---|---|---|---|
| implementer | execution-implementer, in its lane worktree (`isolation: 'worktree'`) or the shared checkout (single-tree, where it never commits: it hands its message file to `merge --single-tree`); ends with `exec.py merge` itself (SCHEMAS 5.3) | `status: built` and `merge.outcome: landed` with `landed_sha` → keep the SHA | null → `rerun`; throw → `infra-error`; merge exit code 3 (budget, lock timeout, environment) → `rerun`; `blocked` → `blocked-manual` (kind manual) or `blocked-decision`; anything else → `failed` |
| test-designer | execution-test-designer, in the shared checkout; records its files with `exec.py snapshot` (no commit) | a result (proofs, `commit` = the snapshot SHA) | null → `rerun`; throw → `infra-error` |
| fe-directions / fe-critique | the inlined fragment (section 6) | receipt `ok: true` | any null agent inside → `rerun`; fragment or input missing → `infra-error` (logged; ingest raises the dependency decision); otherwise `failed` |
| integrator | execution-implementer at sonnet/low, running only the `merge` command of the brief | merge receipt `outcome: landed` → keep `landed_sha` | null or merge exit 3 → `rerun`; throw → `infra-error`; other outcome → `failed` |
| reviewer | execution-reviewer | a result (it never decides the outcome; the gate's proof reads it) | null → `rerun`; throw → `infra-error` |
| verifier | execution-verifier, read-only, fresh context | `verdict: pass` with a non-null `receipt_sha256` (`proof verdict` wrote the receipt) → `done` | null, or pass without a receipt → `rerun`; throw → `infra-error`; `fail` → `failed` |
A chain always ends with `verifier` (checked at emit; the script also refuses to call a chain without one `done`),
except in a pre-T0 manifest (`pre_t0: true`, FRONTEND.md 11): chain `[implementer]`, no merge, outcome `recorded`
(never `done`; `wave ingest` leaves the task `planned`).

### 3.7 Bounded fix loop
- **Across waves (default, the core's rule):** `failed` goes back to `ready` through `wave ingest` while `attempts <
  max_attempts`, and the next `wave emit` renders `briefs/<task>.a<n+1>.md` with the verifier's findings (SCHEMAS
  4.2, 4.4). After `max_attempts` failures: `blocked-decision` and a `retry-exhausted` proposal.
- **Inside the wave (default, ARCHITECTURE 6.3 step 4 places the fix inside the wave):** `EXTRA.in_wave_fix` is
  true; a task whose attempt ended `failed` runs the next prepared attempt at once (fresh implementer with the
  findings, fresh verifier), up to `max_attempts` in total; each attempt has its own brief, inbox files and results,
  and `blocked`, `rerun` or `infra-error` outcomes never trigger a fix. `wave ingest` applies the attempts in order
  with the SCHEMAS 4.2 row `failed → running` (evidence: the manifest's `fix_attempts` lists attempt n+1 and a result
  or merge receipt of attempt n+1 exists). The across-waves path above stays the fallback for a task whose fix
  attempt was not prepared (a rerun relaunch, a wave emitted without room for it).

### 3.8 Returned value (`{wave, outcomes}` only; MODULES 7)
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["wave", "outcomes"],
  "properties": {
    "wave": {"type": "string", "pattern": "^W[0-9]{2,3}$"},
    "outcomes": {
      "type": "object",
      "propertyNames": {"pattern": "^T[0-9]{3,}$"},
      "additionalProperties": {"enum": ["done", "failed", "rerun", "blocked-manual", "blocked-decision", "skipped-dep", "infra-error", "recorded"]}
    }
  }
}
```
Every task of the manifest has an outcome. `log()` writes one line per step (landed SHA prefix, verdict, null, skip),
never a secret or never-show text (agents' prose is not logged).

---

## 4. Chains per task (`wave.build_manifest`, B05)

| task | chain | agents (role → agentType, model/effort) |
|---|---|---|
| kinds code, infra, deploy, tx, research, watch (agent tasks, including /frontend FE-00, FE-05, FE-07, FE-08, FE-09, FE-1x) | implementer, verifier | implementer → execution-implementer (opus/high critical, opus/medium otherwise); verifier → execution-verifier (opus/high or the task's `verify` block) |
| kind test with `proof_author: test-designer` (acceptance checks, the contract wave's checks) | test-designer, integrator, verifier | test-designer → execution-test-designer opus/high, `isolation: null`: it writes in the shared checkout and never commits; it runs `exec.py snapshot` for its negative control; the integrator → execution-implementer sonnet/low runs `merge --single-tree --message-file <the test-designer's message file>`, which builds the commit from the task's write paths (CLI.md `merge`) |
| `execution:EX-FIX-CODE` (FIX-MODE.md 6.3) | test-designer, implementer, verifier | the test-designer writes the fix test in the shared checkout and snapshots it (`refs/exec/<task>/td-a<n>r<k>`); the implementer starts from it (worktrees: `git checkout <snapshot> -- <test path>` in its lane worktree as its first commit; single-tree: the file is already there) |
| `frontend:FE-03` (runner fragment `feDirections`) | fe-directions, integrator, verifier | fragment roles from section 6.2 |
| `frontend:FE-20` (runner fragment `feCritique`) | fe-critique, integrator, verifier | idem |
| `execution:EX-CONVERGE` and milestone reviews | reviewer, verifier | reviewer → execution-reviewer opus/high |
| kind gate (`EX-GATE-BUILD`, `EX-REPLAY`, `EX-FREEZE-*`, `EX-FIX-GATE`, `EX-DEVB-CHECK`, `EX-HB-CLAIMS-VERIFY`) | verifier | the landed SHA is origin/main at emit, recorded by `wave emit` as a gate merge receipt (`results.write_gate_receipt`, SCHEMAS.md 4.2) |
| tasks already `built` or `verifying` whose verifier returned null | verifier | the landed SHA from their merge receipt (any wave) |
Manual and decision tasks are never in a wave (CLI.md wave emit).

---

## 5. The brief file (`briefs/<task>.a<attempt>.md`, rendered by `briefs.render` from `assets/briefs/<role>.md`)

One file per task attempt, holding the common sections and one section per chain role; each agent reads the common
sections and its own role section. English, UTF-8, LF; nothing in it is owner prose except quoted requirement text.
Every path is absolute unless it is a repository-relative glob.

```markdown
# Brief T012 attempt 1 (wave W03)
<!-- execution-brief v1: rendered by exec.py wave emit from <skill>/assets/briefs/; never edited by hand -->

| task | T012 — <title> |
|---|---|
| kind / phase | code / build |
| lane / workspace | L2 / worktrees |
| executor | A |
| attempt | 1 of 2 |
| priority / critical | P1 / yes |
| plan version | 3 (plan sha256 <first 12>) |

## Objective
<task.description, verbatim from plan.json>

## Requirements covered
- FR-003 (P1, required): <requirement title, verbatim> — status expected: live

## Read first
1. <brief_refs[0], absolute>
2. <brief_refs[1], absolute>
(every brief_refs path of the task, in plan order; none may be skipped)

## Workspace
- Product repository: C:/repo (main checkout; integration branch main)
- Mode worktrees: you start in a fresh worktree branched from the local integration HEAD. Confirm with
  `git rev-parse --show-toplevel` and `git log -1 --format=%H`; work only there.
  (single-tree: "You work in C:/repo next to other agents. Never switch branches, never stash, never commit, never
  touch a path outside your writes; write your commit message to the file below and hand it to `exec.py merge
  --single-tree --message-file`, which builds the commit from your write paths.")
- Scratch: C:/scratch/queue-clock/T012-a1/ (commit message file: C:/scratch/queue-clock/msg/T012.a1.txt)

## Writes (the only paths you may change)
- src/queue/**
- tests/unit/queue/**

## Protected (never change; the guard refuses and merge rejects)
- tests/acceptance/**
- .github/workflows/**
- <every plan.protected glob>

## Resources held for you
- port:5173 (no other task uses it while you run)

## Boundaries
- Network: testnet cardano/preprod allowed up to 50 ADA per task; mainnet closed (read-only project policy).
- Denied endpoints: <policy.deny_endpoints patterns and reasons>
- Push freeze: 2026-10-07T15:00:00Z (Wed 7 Oct 23:00 SGT, Wed 7 Oct 17:00 Paris). After it nothing lands.
- Never-show: a never-show list exists for this project; merge scans every added line and refuses a hit, naming
  only the entry id. Do not quote undisclosed findings, embargoed names or internal specs in code, comments, tests or
  commit messages.
- Secrets: the program loads <env file name withheld> by path; you never read it.

## Proof
- Type: command
- Run from: the repository root of a clean checkout of the landed commit (`.`), shell bash, install step first: yes
- Command: `pnpm vitest run tests/acceptance/queue.test.ts`
- Expect: exit 0; "every queue position is computed from the ledger state"
- Max runtime: 3 min
- Negative control: pre-implementation — the same command on main as it was before your commits (the merge
  receipt's `origin_before`) must exit non-zero (recorded: no)

## Acceptance criteria
1. <from the test-designer result for this task; else the requirement text and the proof's expect.summary>

## Landed SHA
(verifier-only chains: "<sha> — recorded by the orchestrator's merge receipt local/results/W03/T012.merge.a1.json";
otherwise: "given in your task message by the wave script")

## Previous attempt
(attempt ≥ 2 only) The verifier of attempt 1 failed this task. Findings: C:/repo/.execution/local/results/W03/
T012.verifier.a1.json (read `findings` and `criteria` only). Address each finding or rebut it in `rebuttals` with
evidence a fresh verifier can re-run. Never rebut by weakening a check.
(resume only) Resume note: C:/repo/.execution/briefs/T012.resume.md — review the listed commits and uncommitted files
as someone else's work.

## Already recorded
If one of these exists, Read it and return it as your final answer without redoing any work (standing rule 13). The
list names this task's results for this attempt in **every** wave so far (a rerun in a later wave must find the
earlier wave's files), newest first:
- implementer: C:/repo/.execution/local/results/W03/T012.implementer.a1.json (and W02/..., if any)
- verifier: C:/repo/.execution/local/results/W03/T012.verifier.a1.json
If a merge receipt of this task with outcome landed exists in any wave (C:/repo/.execution/local/results/*/T012.merge.a*.json
listed here by the emitter), or `exec.py merge` answers E_ALREADY_LANDED, but the implementer result does not: do not
change code; write the implementer result with status built, merge copied from that receipt, own_proof_run {command:
null, exit_code: null, output_tail: "rerun after landing"}, then put it.

## Role: implementer
1. Read every file under "Read first", then the files you will change.
2. Build the objective inside the writes. No stub, no TODO, no simulated value presented as real.
3. Run the proof command exactly, from the worktree root; keep the real exit code and the last 4,000 characters.
4. Write the commit message to C:/scratch/queue-clock/msg/T012.a1.txt (conventional commit, a `cmd:` line naming
   the proof command, no trailer). Worktrees: `git add -- <your paths>` and `git commit -F
   "C:/scratch/queue-clock/msg/T012.a1.txt" -- <your paths>`. Single-tree: do not commit.
5. Land it, with the Bash tool's timeout set to 600000:
   `python "C:/Users/Utilisateur/.claude/skills/execution/scripts/exec.py" --repo "C:/repo" --state "C:/repo/.execution" merge --task T012 --attempt 1 --rerun 0 --wave W03 --worktree "$(git rev-parse --show-toplevel)" --branch "$(git branch --show-current)"`
   (single-tree: `... merge --task T012 --attempt 1 --rerun 0 --wave W03 --single-tree --message-file "C:/scratch/queue-clock/msg/T012.a1.txt"`)
   Exit 1 conflict or gate/scan failure: fix inside your writes, commit (worktrees), run it again (two merge calls
   at most in this run). Exit 3 (time budget, lock timeout, environment): do not retry; put `exit_code: 3` and the
   error code in your result's `merge` field (receipt and outcome null when merge printed none) with status
   `failed`: the wave script reads exit code 3 as a rerun, which never counts as an attempt. Exit 4: stop and report.
6. Result (below).

## Role: integrator
Run exactly, once, with the Bash tool's timeout set to 600000:
`python "C:/Users/Utilisateur/.claude/skills/execution/scripts/exec.py" --repo "C:/repo" --state "C:/repo/.execution" merge --task T042 --attempt 1 --rerun 0 --wave W03 --worktree "C:/scratch/queue-clock/fe/T042-a1r0" --branch "exec/T042-a1r0"`
(after a test-designer step: `... merge --task T030 --attempt 1 --rerun 0 --wave W03 --single-tree --message-file "<the test-designer's message file>"`)
Then return `{receipt_path, outcome, landed_sha, exit_code}` (the `merge-result` schema: the same object as the
implementer result's `merge` field) read from what merge printed; receipt_path, outcome and landed_sha are null when
merge printed no receipt (exit 3: the script reruns the task). Do not change any file and do not retry: a conflict or
a failed gate is the answer.

## Role: verifier
1. `git -C "C:/repo" fetch origin` then `git -C "C:/repo" merge-base --is-ancestor <landed SHA> origin/main`.
2. `python ".../exec.py" --repo "C:/repo" --state "C:/repo/.execution" proof run --task T012 --sha <landed SHA> --keep --by verifier`
3. Negative control required and not recorded: `python ".../exec.py" --repo "C:/repo" --state "C:/repo/.execution" proof run --task T012 --sha <landed SHA> --negative-control --by verifier` (must exit 0, meaning the control failed as required; it runs on the merge receipt's `origin_before`).
4. Review `git -C <kept checkout> diff <origin_before of the merge receipt>..<landed SHA>` against each acceptance
   criterion; scan for stubs, TODOs, weakened tests, skip/only markers, special-casing. For a fix task, check that the
   fix test's blob at the landed SHA equals the blob recorded by the test-designer's snapshot (FIX-MODE.md 6.3).
5. Findings file: C:/repo/.execution/local/inbox/W03/T012.verifier-findings.a1.json
6. `python ".../exec.py" --repo "C:/repo" --state "C:/repo/.execution" proof verdict --task T012 --run <run id> --verdict pass|fail --findings "C:/repo/.execution/local/inbox/W03/T012.verifier-findings.a1.json" --attempt 1 --model opus --effort high`
   (exit 3: do not retry; return your result with `receipt_sha256: null`: the script reruns the task)
7. Result (below), with `receipt_sha256` = the value `proof verdict` printed.

## Result
- Schema: result-implementer (the wave script gives it to you as your output format).
- Write it to: C:/repo/.execution/local/inbox/W03/T012.implementer.a1.json
- Record it: `python "C:/Users/Utilisateur/.claude/skills/execution/scripts/exec.py" result put --wave W03 --task T012 --role implementer --attempt 1 --file "C:/repo/.execution/local/inbox/W03/T012.implementer.a1.json"`
- (one such block per chain role: verifier → result-verifier, T012.verifier.a1.json, `--role verifier`; integrator
  returns the merge receipt and puts nothing; test-designer → result-test-designer; reviewer → result-reviewer)

## Standing rules
<AGENTS.md 4.1 rules 1-16, verbatim (briefs.STANDING_RULES == agents.SHARED_RULES)>

## Interactive habits switched off
You run unattended. Do not ask before deciding, do not remind anyone to commit, do not offer a social-media post, do
not propose a plan and wait. Your own instructions may describe those habits for interactive sessions; they do not
apply here (standing rule 2).
```
Rendering rules: sections with nothing to say are omitted except Objective, Read first (may say "none"), Writes,
Proof, Already recorded, the role sections of the chain, Result and Standing rules. Every `brief_refs` path must exist
(E_BRIEF_REF_MISSING at emit). Inbox names: `<task>.<role>.a<n>.json`, verifier findings
`<task>.verifier-findings.a<n>.json`, fragment receipts `<task>.<fe-role>.a<n>.json`. Times are shown in UTC and in the
profile's display zones.

Planning briefs (section 7) use the same skeleton with Objective = the planning goal, Read first = spec, profile,
policy, libraries, schemas and contract sections, and no Writes/Proof sections beyond the draft path.

---

## 6. /frontend wave fragments

### 6.1 Inlining
For a wave holding `frontend:FE-03` or `frontend:FE-20`, `wave emit` reads
`<frontend>/assets/wave-fragments/directions.js` / `critique.js`, inlines them verbatim at `/*@@FRAGMENTS@@*/` (function
declarations `feDirections`, `feCritique`), and records `{name, source_path, sha256}` in `manifest.fragments`. A
missing file, or a file that does not declare the expected function, is E_DEPENDENCY_MISSING plus a
`dependency-missing` decision for the owner; never a fallback (README 9). The script calls them with
`api = {agent: <tracked callAgent>, parallel, pipeline, log}` and the resolved input; /execution never re-implements
their rounds, acceptance rule or revert-to-best logic (ARCHITECTURE 6.6).

### 6.2 Resolving `EXTRA.fe[task].input`
From the /frontend template's `fragment.input` (its `Run:` and `Stack:` rules): placeholders replaced verbatim,
`{"$from": "<path>"}` read from the profile at emission, then:
- `agents` roles filled with explicit options (effort is always explicit, ARCHITECTURE 6.7): `critic` →
  `{agentType: "frontend-critic", model: "opus", effort: "high"}`; `probe` → `{agentType: "frontend-probe", model:
  "opus", effort: "high"}`; `implementer`, `designer` → `{agentType: "execution-implementer", model: "opus", effort:
  "high"}`; `runner` → `{agentType: "execution-implementer", model: "sonnet", effort: "low"}` (the /frontend template
  gives the runner no agentType; a generic workflow subagent would keep every connector).
- `{workdir}` (the input's `cwd`): for `feCritique`, an **exclusive worktree** `<scratch_root>/<project>/fe/<task>-a<n>r<k>`
  on branch `exec/<task>-a<n>r<k>` created from origin/main by the `prepare` command (the critique commits fix rounds and
  restores the best-so-far with `git revert {sha}..HEAD`, which must never touch other lanes' commits); for
  `feDirections`, the main checkout (it writes only the /frontend state directory).
- `prepare.command`: `exec.py --repo "<repo>" --state "<state>" fe-workspace --task <task> --attempt <n> --rerun <k>`
  (CLI.md `fe-workspace`): idempotent per run key `a<n>r<k>` — a registered, clean worktree at
  `<scratch_root>/<project>/fe/<task>-a<n>r<k>` on branch `exec/<task>-a<n>r<k>` is reused; anything else at that path
  is removed link-safely and recreated from origin/main (never `-B` over a branch that holds a dead run's commits:
  the rerun key gives a new branch); then the gates.json install step (pnpm hard-links keep it near 0.1 GB [par
  F21]). A prepare failure that is environmental (exit 3) is a `rerun`, never `failed`. The integrator step then lands
  the branch with `merge --worktree "<wt>" --branch "exec/<task>-a<n>r<k>"`, and merge removes the worktree link-safely
  (step 8).
- `commands.restore` (feCritique's override input, which the fragment supports): `git revert --no-commit {sha}..HEAD
  && git commit -F "<scratch>/msg/<task>-restore.txt"`, where the emitter writes that message file
  (`revert: restore best-so-far critique round (<task>)`), so the restore commit is a conventional one and the merge's
  conventional scan passes (git's default `Revert "..."` message would fail it).
- `receipt_inbox`: `<state>/local/inbox/<wave>/<task>.<fe-role>.a<n>r<k>.json` — the script copies the returned
  receipt there for `wave ingest` and the report (feCritique also writes its own `{state}/critique/receipt.json`,
  which its proof verifies).

### 6.3 Outcome of a fragment step
Receipt `ok: true` → the chain continues (integrator, verifier). Receipt not ok and at least one agent inside returned
null → `rerun` (usage limit or a dead agent; the attempt does not count). Not ok otherwise → `failed` (the receipt's
`stop_reason` / `error` and the next brief's "Previous attempt" carry why). The FE task is `done` only when its
verifier passes the template's proof (frontend-check or `critique.mjs --verify-receipt`) on the landed SHA.

### 6.4 Publishing boards
The H1 direction board and the H2 logo board are published by the orchestrator in the main thread after the wave
(ARCHITECTURE 11; /frontend `references/03-directions.md` "Publishing the board (orchestrator only)"); no wave agent
publishes anything (guard rule B6/B7).

---

## 7. The planner workflow (`assets/workflows/planner.template.js`)

### 7.1 Launch (`exec.py plan emit`, CLI.md)
`plan emit [--rounds N] [--mode design|pre-t0]` (O) renders the template into `local/planner/planner.W00.js`
(placeholders `@@WORKFLOW_NAME@@` = `execution-planner-<project>`, `@@WORKFLOW_DESCRIPTION@@`,
`/*@@PLANNING@@*/null`), renders the planning briefs into
`local/planner/briefs/{planner,test-designer,critic-coverage,critic-feasibility}.md`, and prints `workflow_call:
{scriptPath, args: {now_utc}}`. Same static and syntax checks as a wave (2.2, 2.3). Planning uses the reserved
pseudo-wave `W00` for inbox and results (`local/inbox/W00/`, `local/results/W00/<role>.a<n>.json`); build waves start
at W01.

### 7.2 `PLANNING` (inlined constant)
```json
{
  "wave": "W00",
  "now_utc": "2026-10-06T00:30:00Z",
  "project": "queue-clock",
  "mode": "design",
  "exec": "python \"C:/Users/Utilisateur/.claude/skills/execution/scripts/exec.py\"",
  "state_dir": "C:/repo/.execution",
  "draft_path": "C:/repo/.execution/local/planner/plan.draft.json",
  "candidate_path": "C:/repo/.execution/local/plan.candidate.json",
  "briefs": {
    "planner": "C:/repo/.execution/local/planner/briefs/planner.md",
    "test_designer": "C:/repo/.execution/local/planner/briefs/test-designer.md",
    "critics": [
      {"lens": "coverage", "path": "C:/repo/.execution/local/planner/briefs/critic-coverage.md"},
      {"lens": "feasibility", "path": "C:/repo/.execution/local/planner/briefs/critic-feasibility.md"}
    ]
  },
  "agents": {
    "planner": {"agentType": "execution-planner", "model": "opus", "effort": "high"},
    "runner": {"agentType": "execution-planner", "model": "sonnet", "effort": "low"},
    "test_designer": {"agentType": "execution-test-designer", "model": "opus", "effort": "high"},
    "critic": {"agentType": "execution-reviewer", "model": "opus", "effort": "high"}
  },
  "limits": {"rounds": 2},
  "schemas": {"result-planner": {}, "result-test-designer": {}, "result-reviewer": {}}
}
```
`mode`: `design` (at or after T0, the full plan) or `pre-t0` (knowledge-level skeleton in the private state, no code
and no design: the test-designer writes proof objects only, `commit: null`) (ARCHITECTURE 3.1).

### 7.3 Stages (per round, at most `limits.rounds`)
1. **Plan** — execution-planner writes the draft, self-checks with `plan instantiate --dry-run`, records
   `result-planner` (attempt = round). From round 2 the prompt lists the previous round's check errors and in-scope
   critic gaps (at most 20 lines).
2. **Check** — a separate agent (execution-planner type at sonnet/low, allowed `plan instantiate --dry-run` and
   `validate` by SCHEMAS 5.3) runs `plan instantiate --dry-run --draft <draft>` then `validate --plan <candidate>` and
   returns both raw results; the planner's own self-check is never the evidence. Failure → next round with the errors,
   or `needs-owner` after the last round.
3. **Proofs** — execution-test-designer writes proof objects and acceptance criteria for the candidate's task ids
   (instantiation is deterministic, so they are final) and records `result-test-designer`.
4. **Check with proofs** — the same runner with `--proofs <test-designer result>` (CLI.md `plan instantiate
   --proofs`: a test-designer result's proof objects applied by task id to the candidate, `proof_author:
   test-designer`, before validation).
5. **Critique** — two fresh execution-reviewer agents in parallel (lens coverage: every requirement covered by tasks
   whose proofs would fail without it; lens feasibility: sizes, the critical path against the deadline, manual tasks
   inside the owner's availability, parallelism that is real), each `result-reviewer` in mode `convergence` with
   `scope.sha` = the state repository's HEAD and `scope.tasks` = every candidate id (no separate `plan` mode: the
   convergence shape already carries gaps and findings). A barrier is right here: the next round needs every
   critic's gaps together.
   Attempt numbers of critics: `(round - 1) × 2 + k` (k = 1, 2), so their result paths never collide.
6. No in-scope gap (type missing, partial or contradicts with `within_approved_scope: true`) and no blocker/major
   finding → `ready-for-approval`. Otherwise the next round, or `needs-owner` after the last one. Out-of-scope gaps
   never trigger a round: they become decisions at approval (owner decision 2, propose-and-wait).

### 7.4 Returned summary
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["status", "round", "stage", "now_utc", "draft_path", "candidate_path", "results", "gaps_in_scope", "gaps_out_of_scope", "blocking_findings", "errors"],
  "properties": {
    "status": {"enum": ["ready-for-approval", "needs-owner", "rerun"]},
    "round": {"type": "integer", "minimum": 1},
    "stage": {"enum": ["planner", "check", "test-designer", "check-proofs", "critics", "rounds"]},
    "now_utc": {"type": "string"},
    "draft_path": {"type": "string"},
    "candidate_path": {"type": "string"},
    "results": {
      "type": "object",
      "required": ["planner", "test_designer", "critics"],
      "properties": {
        "planner": {"type": ["string", "null"]},
        "test_designer": {"type": ["string", "null"]},
        "critics": {"type": "array", "items": {"type": "string"}}
      }
    },
    "gaps_in_scope": {"type": "integer", "minimum": 0},
    "gaps_out_of_scope": {"type": "integer", "minimum": 0},
    "blocking_findings": {"type": "integer", "minimum": 0},
    "errors": {"type": "array", "items": {"type": "string"}, "maxItems": 20}
  }
}
```
Result paths are state-relative. The orchestrator then: `rerun` → relaunch the same script (results already recorded
are returned by rerun agents through "Already recorded"); `needs-owner` → a decision with the errors or gaps (never a
silent re-plan); `ready-for-approval` → `exec.py plan instantiate --draft <draft> --proofs <test-designer result>
--propose-approval` (O), `exec.py schedule`, and the French approval summary.

---

## 8. Wave template (`assets/workflows/wave.template.js`, full)

```js
export const meta = {
  name: '@@WORKFLOW_NAME@@',
  description: '@@WORKFLOW_DESCRIPTION@@',
  phases: [
    {title: 'Implement', detail: 'implementers build one task each and land it with exec.py merge'},
    {title: 'Frontend', detail: '/frontend wave fragments: directions and critique'},
    {title: 'Integrate', detail: 'merge-only steps after test-designer and fragment work'},
    {title: 'Verify', detail: 'independent verifiers re-run each proof on the landed SHA'},
    {title: 'Review', detail: 'milestone and convergence reviewers'},
    {title: 'Fix', detail: 'bounded in-wave fix attempts'}
  ]
}

// /execution wave script, generated by `exec.py wave emit` from assets/workflows/wave.template.js.
// Contract: contract/WAVES.md and MODULES.md section 7. Plain JavaScript run by the Workflow tool: the clock comes
// from args.now_utc, there is no randomness, no module loading and no host API. Every fact the orchestrator acts on
// is re-read from files by `exec.py wave ingest`; this script only sequences agents and returns {wave, outcomes}.

const MANIFEST = /*@@MANIFEST@@*/null;
const EXTRA = /*@@EXTRA@@*/null;

/*@@FRAGMENTS@@*/

const ARGS = (typeof args === 'object' && args !== null) ? args : {};
const SKIP = Array.isArray(ARGS.skip) ? ARGS.skip.filter((id) => typeof id === 'string') : [];
const NOW_UTC = typeof ARGS.now_utc === 'string' ? ARGS.now_utc : MANIFEST.args.now_utc;
const WAVE = MANIFEST.wave;
const OUTCOMES = {};

const RUN_SCHEMA = {
  type: 'object',
  required: ['exit_code', 'json', 'stderr_tail'],
  additionalProperties: false,
  properties: {
    exit_code: {type: 'integer'},
    json: {type: ['object', 'null']},
    stderr_tail: {type: 'string'}
  }
};
const WRITE_SCHEMA = {
  type: 'object',
  required: ['written', 'path'],
  additionalProperties: false,
  properties: {written: {type: 'boolean'}, path: {type: 'string'}}
};

// ---------------------------------------------------------------------------------------------- small helpers

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deferred() {
  let resolve = null;
  const promise = new Promise((r) => { resolve = r; });
  return {promise, resolve};
}

// A counting semaphore whose waiters are served by priority (lower rank first, then task id).
function makeSemaphore(name, size) {
  let free = size;
  const waiting = [];
  function pump() {
    while (free > 0 && waiting.length > 0) {
      waiting.sort((a, b) => (a.rank - b.rank) || (a.task < b.task ? -1 : a.task > b.task ? 1 : 0));
      free -= 1;
      waiting.shift().resolve();
    }
  }
  return {
    name,
    size,
    acquire(rank, task) {
      return new Promise((resolve) => {
        waiting.push({rank, task, resolve});
        pump();
      });
    },
    release() {
      free += 1;
      pump();
    }
  };
}

const LIMITS = MANIFEST.limits;
const WRITERS = makeSemaphore('writers', LIMITS.writers);
const VERIFIERS = makeSemaphore('verifiers', LIMITS.verifiers);
const INTEGRATORS = makeSemaphore('integrators', LIMITS.integrators);
const BROWSER = makeSemaphore('browser', Math.max(LIMITS.browser_slots, 0));
const UNARY = {};      // resource name -> semaphore of 1 (manifest, wallet:*, port:*, db:*, human:*, disk-heavy)
const LANES = {};      // lane id -> semaphore of 1: one writing agent per lane at a time

function unary(name) {
  if (!UNARY[name]) UNARY[name] = makeSemaphore(name, 1);
  return UNARY[name];
}
function laneLock(lane) {
  if (!LANES[lane]) LANES[lane] = makeSemaphore('lane ' + lane, 1);
  return LANES[lane];
}

async function withSlot(sem, t, fn) {
  await sem.acquire(t.priority_rank, t.task);
  try {
    return await fn();
  } finally {
    sem.release();
  }
}

// Resources are held for the whole task (implement to verify), acquired in one global order (sorted names) so two
// tasks can never wait on each other. Lanes and the writer slot are taken per writing step, after the resources.
async function acquireResources(t) {
  const names = t.resources.slice().sort();
  const held = [];
  for (const name of names) {
    const sem = name === 'browser' ? BROWSER : unary(name);
    await sem.acquire(t.priority_rank, t.task);
    held.push(sem);
  }
  return held;
}
function releaseResources(held) {
  for (let i = held.length - 1; i >= 0; i -= 1) held[i].release();
}

// Every agent call goes through here: a null (the agent died, or a usage limit hit while Remote Control is
// connected) is logged and becomes a rerun upstream, never a result. A throw (agent type not found, unsatisfiable
// schema, budget spent, scheduler error) is deterministic: it is logged with its message and becomes infra-error,
// never a rerun (a rerun would loop forever). Result schemas forbid extra keys, so {infraError} is never a result.
async function callAgent(prompt, opts) {
  try {
    const out = await agent(prompt, opts);
    if (out === null || out === undefined) {
      log(opts.label + ': agent returned null (died or hit a usage limit); the task will be rerun');
      return null;
    }
    return out;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    log(opts.label + ': agent call threw (infrastructure, not a usage limit): ' + message);
    return {infraError: message};
  }
}

function isInfra(value) {
  return isObject(value) && typeof value.infraError === 'string';
}

function agentOptions(t, role, attempt) {
  const spec = isObject(t.agents) ? t.agents[role] : null;
  if (!isObject(spec)) return null;      // fragment steps have no agent entry: their agents come from EXTRA.fe
  const opts = {
    label: spec.label + (attempt === t.attempt ? '' : ' a' + attempt),
    phase: attempt === t.attempt ? spec.phase : 'Fix',
    model: spec.model,
    effort: spec.effort
  };
  if (spec.agentType) opts.agentType = spec.agentType;
  if (spec.isolation === 'worktree') opts.isolation = 'worktree';
  if (spec.schema) opts.schema = EXTRA.schemas[spec.schema];
  return opts;
}

function promptFor(t, role, attempt, briefPath, landedSha) {
  const lines = [
    'Read your brief at ' + briefPath + ' and follow it exactly. Role: ' + role + '. Task ' + t.task + ', wave ' +
      WAVE + ', attempt ' + attempt + '.'
  ];
  if (role === 'verifier' || role === 'reviewer') {
    lines.push(landedSha ? 'Landed SHA: ' + landedSha + '.' : 'Landed SHA: as your brief states it under "Landed SHA".');
  }
  if (role === 'integrator') {
    lines.push('Run only the command of the brief section "Role: integrator", then return the merge receipt it printed.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------- fragments

function fragmentFunction(role) {
  if (role === 'fe-critique') return typeof feCritique === 'function' ? feCritique : null;
  if (role === 'fe-directions') return typeof feDirections === 'function' ? feDirections : null;
  return null;
}

async function runCommand(t, command, purpose, label) {
  const prompt = [
    'You run one command for the /execution skill (' + purpose + ') and report its result. Do nothing else.',
    'Run this exactly once with the Bash tool, as one line, with the maximum timeout (600000 ms):',
    command,
    'Do not edit, fix, retry or split the command, do not change any file yourself, and never open a .env file.',
    'Return exit_code (the real exit code), json (stdout parsed as one JSON object, or null) and stderr_tail (the last lines of stderr, at most 2000 characters).'
  ].join('\n');
  const runner = EXTRA.runner;
  return callAgent(prompt, {label: t.task + ' ' + label, phase: 'Frontend', agentType: runner.agentType,
    model: runner.model, effort: runner.effort, schema: RUN_SCHEMA});
}

async function persistReceipt(t, path, receipt) {
  const prompt = [
    'Write one file for the /execution skill exactly as given, then stop.',
    'Path: ' + path,
    'Use the Write tool with the content between the two marker lines, byte for byte, plus one final newline; do not reformat, reorder, translate or fix anything.',
    '----- BEGIN RECEIPT -----',
    JSON.stringify(receipt, null, 2),
    '----- END RECEIPT -----',
    'Return written (true once the file holds exactly that content) and path.'
  ].join('\n');
  const runner = EXTRA.runner;
  const res = await callAgent(prompt, {label: t.task + ' keep receipt', phase: 'Frontend', agentType: runner.agentType,
    model: runner.model, effort: runner.effort, schema: WRITE_SCHEMA});
  return Boolean(res && !isInfra(res) && res.written === true);
}

// Runs one /frontend fragment for task t. Returns {ok, nulls, infra, missing}. The fragment's own agents go through a
// tracked api so that a fragment that failed because its agents died is a rerun, and one whose agents threw is an
// infra-error, not a failed attempt. The fragment itself only ever sees null for both (its documented contract).
async function runFragment(t, role, attempt) {
  const fe = EXTRA.fe[t.task];
  if (!isObject(fe)) {
    log(t.task + ' ' + role + ': no fragment input in this wave script; the task is left for the orchestrator');
    return {ok: false, nulls: 0, infra: 1, missing: true};
  }
  const fn = fragmentFunction(role);
  if (!fn) {
    log(t.task + ' ' + role + ': fragment function not inlined; the task is left for the orchestrator');
    return {ok: false, nulls: 0, infra: 1, missing: true};
  }
  let nulls = 0;
  let infra = 0;
  const api = {
    agent: async (prompt, opts) => {
      const out = await callAgent(prompt, opts || {label: t.task + ' fragment agent'});
      if (out === null) { nulls += 1; return null; }
      if (isInfra(out)) { infra += 1; return null; }
      return out;
    },
    parallel,
    pipeline,
    log
  };
  if (isObject(fe.prepare)) {
    const prep = await runCommand(t, fe.prepare.command, 'prepare the exclusive worktree of ' + t.task, 'prepare a' + attempt);
    if (prep === null) return {ok: false, nulls: nulls + 1, infra};
    if (isInfra(prep)) return {ok: false, nulls, infra: infra + 1};
    if (prep.exit_code === 3) {
      log(t.task + ' prepare hit an environment error (exit 3); the task will be rerun');
      return {ok: false, nulls: nulls + 1, infra};
    }
    if (prep.exit_code !== 0) {
      log(t.task + ' prepare failed with exit ' + prep.exit_code + ': ' + String(prep.stderr_tail).slice(-300));
      return {ok: false, nulls, infra};
    }
  }
  let receipt = null;
  try {
    receipt = await fn(api, fe.input);
  } catch (err) {
    log(t.task + ' ' + role + ' threw: ' + (err && err.message ? err.message : String(err)));
    return {ok: false, nulls, infra: infra + 1};
  }
  if (typeof fe.receipt_inbox === 'string' && fe.receipt_inbox.length > 0 && isObject(receipt)) {
    const kept = await persistReceipt(t, fe.receipt_inbox, receipt);
    if (!kept) log(t.task + ': the fragment receipt could not be copied to ' + fe.receipt_inbox);
  }
  const ok = isObject(receipt) && receipt.ok === true;
  log(t.task + ' ' + role + ': receipt ok=' + ok + (nulls > 0 ? ', ' + nulls + ' null agent(s)' : '') +
    (infra > 0 ? ', ' + infra + ' agent call(s) threw' : ''));
  return {ok, nulls, infra};
}

// ---------------------------------------------------------------------------------------------- one attempt

// Runs the task's chain once for one attempt. Returns {outcome, failedAt}.
// outcome: done | failed | rerun | blocked-manual | blocked-decision | infra-error.
async function runAttempt(t, attempt, briefPath) {
  let landed = null;
  for (const role of t.chain) {
    const opts = agentOptions(t, role, attempt);
    const prompt = promptFor(t, role, attempt, briefPath, landed);
    const isFragment = role === 'fe-directions' || role === 'fe-critique';
    if (!isFragment && opts === null) {
      log(t.task + ': no agent options for chain step ' + role + '; the task is left for the orchestrator');
      return {outcome: 'infra-error', failedAt: role};
    }

    if (role === 'implementer') {
      const lane = t.lane ? laneLock(t.lane) : null;
      const work = () => withSlot(WRITERS, t, () => callAgent(prompt, opts));
      const r = lane ? await withSlot(lane, t, work) : await work();
      if (r === null) return {outcome: 'rerun', failedAt: role};
      if (isInfra(r)) return {outcome: 'infra-error', failedAt: role};
      if (isObject(r.merge) && r.merge.exit_code === 3) {
        log(t.task + ' a' + attempt + ' merge stopped on an environment error (exit 3); the task will be rerun');
        return {outcome: 'rerun', failedAt: role};
      }
      if (r.status === 'blocked') {
        const kind = isObject(r.blocked) ? r.blocked.kind : 'decision';
        log(t.task + ' a' + attempt + ' blocked (' + kind + ')');
        return {outcome: kind === 'manual' ? 'blocked-manual' : 'blocked-decision', failedAt: role};
      }
      if (MANIFEST.pre_t0 === true) {
        // pre-T0 research (FRONTEND.md 11): no product repo, nothing lands and nothing is done before T0
        if (r.status !== 'built') return {outcome: 'failed', failedAt: role};
        log(t.task + ' a' + attempt + ' pre-T0 outputs recorded');
        continue;
      }
      if (r.status !== 'built' || !isObject(r.merge) || r.merge.outcome !== 'landed' || !r.merge.landed_sha) {
        log(t.task + ' a' + attempt + ' implementer: status ' + r.status + ', merge ' +
          (isObject(r.merge) ? r.merge.outcome : 'not reached'));
        return {outcome: 'failed', failedAt: role};
      }
      landed = r.merge.landed_sha;
      log(t.task + ' a' + attempt + ' landed ' + landed.slice(0, 8));
    } else if (role === 'test-designer') {
      const lane = t.lane ? laneLock(t.lane) : null;
      const work = () => withSlot(WRITERS, t, () => callAgent(prompt, opts));
      const r = lane ? await withSlot(lane, t, work) : await work();
      if (r === null) return {outcome: 'rerun', failedAt: role};
      if (isInfra(r)) return {outcome: 'infra-error', failedAt: role};
      log(t.task + ' a' + attempt + ' test-designer: ' + (Array.isArray(r.proofs) ? r.proofs.length : 0) + ' proof(s), snapshot ' +
        (r.commit ? r.commit.slice(0, 8) : 'none'));
    } else if (role === 'fe-directions' || role === 'fe-critique') {
      const lane = t.lane ? laneLock(t.lane) : null;
      const work = () => withSlot(WRITERS, t, () => runFragment(t, role, attempt));
      const res = lane ? await withSlot(lane, t, work) : await work();
      if (res.missing || (!res.ok && res.infra > 0)) return {outcome: 'infra-error', failedAt: role};
      if (!res.ok) return {outcome: res.nulls > 0 ? 'rerun' : 'failed', failedAt: role};
    } else if (role === 'integrator') {
      const r = await withSlot(INTEGRATORS, t, () => callAgent(prompt, opts));
      if (r === null) return {outcome: 'rerun', failedAt: role};
      if (isInfra(r)) return {outcome: 'infra-error', failedAt: role};
      if (r.exit_code === 3) {
        log(t.task + ' a' + attempt + ' merge stopped on an environment error (exit 3); the task will be rerun');
        return {outcome: 'rerun', failedAt: role};
      }
      if (r.outcome !== 'landed' || !r.landed_sha) {
        log(t.task + ' a' + attempt + ' merge outcome ' + r.outcome);
        return {outcome: 'failed', failedAt: role};
      }
      landed = r.landed_sha;
      log(t.task + ' a' + attempt + ' landed ' + landed.slice(0, 8));
    } else if (role === 'reviewer') {
      const r = await withSlot(VERIFIERS, t, () => callAgent(prompt, opts));
      if (r === null) return {outcome: 'rerun', failedAt: role};
      if (isInfra(r)) return {outcome: 'infra-error', failedAt: role};
      log(t.task + ' a' + attempt + ' review: ' + r.verdict + ', ' + (Array.isArray(r.findings) ? r.findings.length : 0) + ' finding(s)');
    } else if (role === 'verifier') {
      const r = await withSlot(VERIFIERS, t, () => callAgent(prompt, opts));
      if (r === null) return {outcome: 'rerun', failedAt: role};
      if (isInfra(r)) return {outcome: 'infra-error', failedAt: role};
      log(t.task + ' a' + attempt + ' verdict ' + r.verdict + (r.receipt_sha256 ? '' : ' (no receipt written)'));
      if (r.verdict === 'pass') {
        // done only when proof verdict wrote the receipt; a refused verdict (exit 3) is a rerun
        return r.receipt_sha256 ? {outcome: 'done', failedAt: null} : {outcome: 'rerun', failedAt: role};
      }
      return {outcome: 'failed', failedAt: role};
    } else {
      log(t.task + ': unknown chain step ' + role + '; the task is left for the orchestrator');
      return {outcome: 'infra-error', failedAt: role};
    }
  }
  if (MANIFEST.pre_t0 === true) return {outcome: 'recorded', failedAt: null};
  log(t.task + ': chain ended without a verifier; nothing is done without one');
  return {outcome: 'failed', failedAt: 'chain'};
}

// ---------------------------------------------------------------------------------------------- one task

const DONE = {};      // task id -> deferred resolved with the task's final outcome

async function runTask(t) {
  if (SKIP.indexOf(t.task) !== -1) {
    log(t.task + ': already proven (args.skip)');
    return 'done';
  }
  for (const dep of t.deps_in_wave) {
    const depOutcome = DONE[dep] ? await DONE[dep].promise : 'done';
    if (depOutcome !== 'done') {
      log(t.task + ': dependency ' + dep + ' ended ' + depOutcome + '; left ready for a later wave');
      return 'skipped-dep';
    }
  }
  if (t.resources.indexOf('browser') !== -1 && BROWSER.size === 0) {
    log(t.task + ': needs a browser slot and this wave has none; left for a later wave');
    return 'rerun';
  }
  const held = await acquireResources(t);
  try {
    let res = await runAttempt(t, t.attempt, t.brief_path);
    const fixes = (EXTRA.in_wave_fix && Array.isArray(EXTRA.fix[t.task])) ? EXTRA.fix[t.task] : [];
    for (const fix of fixes) {
      if (res.outcome !== 'failed') break;
      log(t.task + ': attempt ' + (fix.attempt - 1) + ' failed at ' + res.failedAt + '; in-wave fix attempt ' + fix.attempt);
      res = await runAttempt(t, fix.attempt, fix.brief_path);
    }
    return res.outcome;
  } finally {
    releaseResources(held);
  }
}

// ---------------------------------------------------------------------------------------------- main

for (const t of MANIFEST.tasks) DONE[t.task] = deferred();

log(WAVE + ': ' + MANIFEST.tasks.length + ' task(s), writers ' + LIMITS.writers + ', verifiers ' + LIMITS.verifiers +
  ', browser slots ' + LIMITS.browser_slots + ', now ' + NOW_UTC + (SKIP.length ? ', skipping ' + SKIP.join(' ') : ''));

await Promise.all(MANIFEST.tasks.map(async (t) => {
  let outcome = 'rerun';
  try {
    outcome = await runTask(t);
  } catch (err) {
    log(t.task + ': wave script error: ' + (err && err.message ? err.message : String(err)) + '; left for the orchestrator');
    outcome = 'infra-error';
  }
  OUTCOMES[t.task] = outcome;
  DONE[t.task].resolve(outcome);
}));

log(WAVE + ' finished: ' + MANIFEST.tasks.map((t) => t.task + '=' + OUTCOMES[t.task]).join(' '));
return {wave: WAVE, outcomes: OUTCOMES};
```

---

## 9. Planner template (`assets/workflows/planner.template.js`, full)

```js
export const meta = {
  name: '@@WORKFLOW_NAME@@',
  description: '@@WORKFLOW_DESCRIPTION@@',
  phases: [
    {title: 'Plan', detail: 'the planner drafts the plan from the spec, the profile and the template libraries'},
    {title: 'Check', detail: 'exec.py plan instantiate --dry-run and validate, run by a separate agent'},
    {title: 'Proofs', detail: 'an independent test designer writes every proof and acceptance check'},
    {title: 'Critique', detail: 'fresh completeness critics with the plan as the contract, burden on done'}
  ]
}

// /execution planner workflow, generated by `exec.py plan emit` from assets/workflows/planner.template.js.
// Contract: contract/WAVES.md section 7. Plain JavaScript run by the Workflow tool: the clock comes from args.now_utc,
// no randomness, no module loading, no host API. The orchestrator acts only on files (the draft, the candidate, the
// results recorded with exec.py result put); this script returns a summary that tells it which files to read.

const PLANNING = /*@@PLANNING@@*/null;

const ARGS = (typeof args === 'object' && args !== null) ? args : {};
const NOW_UTC = typeof ARGS.now_utc === 'string' ? ARGS.now_utc : PLANNING.now_utc;
const ROUNDS = PLANNING.limits.rounds;
const SCHEMAS = PLANNING.schemas;
const AGENTS = PLANNING.agents;

const RUN = {
  type: 'object',
  required: ['exit_code', 'json', 'stderr_tail'],
  additionalProperties: false,
  properties: {exit_code: {type: 'integer'}, json: {type: ['object', 'null']}, stderr_tail: {type: 'string'}}
};
const CHECK_SCHEMA = {
  type: 'object',
  required: ['instantiate', 'validate'],
  additionalProperties: false,
  properties: {instantiate: RUN, validate: Object.assign({}, RUN, {type: ['object', 'null']})}
};

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function callAgent(prompt, opts) {
  try {
    const out = await agent(prompt, opts);
    if (out === null || out === undefined) {
      log(opts.label + ': agent returned null (died or hit a usage limit)');
      return null;
    }
    return out;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    log(opts.label + ': agent call threw (infrastructure, not a usage limit): ' + message);
    return {infraError: message};
  }
}

function isInfra(value) {
  return isObject(value) && typeof value.infraError === 'string';
}

function options(role, label, phaseTitle, schemaName, schemaObject) {
  const a = AGENTS[role];
  const opts = {label, phase: phaseTitle, model: a.model, effort: a.effort, schema: schemaObject || SCHEMAS[schemaName]};
  if (a.agentType) opts.agentType = a.agentType;
  return opts;
}

function resultPath(role, attempt) {
  return 'local/results/' + PLANNING.wave + '/' + role + '.a' + attempt + '.json';
}

// Errors the check reports, as short lines for the next planner round (never more than 20).
function checkErrors(check) {
  const lines = [];
  for (const key of ['instantiate', 'validate']) {
    const run = check ? check[key] : null;
    if (!isObject(run) || run.exit_code === 0) continue;
    const data = isObject(run.json) ? run.json : null;
    const errors = data && Array.isArray(data.errors) ? data.errors : [];
    if (errors.length === 0) lines.push(key + ': exit ' + run.exit_code + ' ' + String(run.stderr_tail).slice(-300));
    for (const e of errors.slice(0, 20)) {
      lines.push(key + ': ' + (isObject(e) ? (e.code + ' ' + (e.task ? e.task + ' ' : '') + e.message) : String(e)));
    }
  }
  return lines.slice(0, 20);
}

async function runCheck(round, withProofs) {
  const proofsArg = withProofs ? ' --proofs "' + PLANNING.state_dir + '/' + resultPath('test-designer', round) + '"' : '';
  const prompt = [
    'You run two commands for the /execution skill (the mechanical check of a plan draft) and report their results. Do nothing else.',
    'Run each with the Bash tool, as one line, with the maximum timeout (600000 ms):',
    '1. ' + PLANNING.exec + ' plan instantiate --dry-run --draft "' + PLANNING.draft_path + '"' + proofsArg,
    '2. only when command 1 exited 0: ' + PLANNING.exec + ' validate --plan "' + PLANNING.candidate_path + '"',
    'Do not edit, fix, retry or split a command, do not change any file, and never open a .env file.',
    'Return instantiate and validate (null when command 2 did not run), each with exit_code (the real exit code), json (stdout parsed as one JSON object, or null) and stderr_tail (the last lines of stderr, at most 2000 characters).'
  ].join('\n');
  return callAgent(prompt, options('runner', 'check round ' + round + (withProofs ? ' with proofs' : ''), 'Check', null, CHECK_SCHEMA));
}

function checkPassed(check) {
  return isObject(check) && isObject(check.instantiate) && check.instantiate.exit_code === 0 &&
    isObject(check.validate) && check.validate.exit_code === 0;
}

function summary(status, round, stage, extra) {
  const out = {
    status,
    round,
    stage,
    now_utc: NOW_UTC,
    draft_path: PLANNING.draft_path,
    candidate_path: PLANNING.candidate_path,
    results: {planner: null, test_designer: null, critics: []},
    gaps_in_scope: 0,
    gaps_out_of_scope: 0,
    blocking_findings: 0,
    errors: []
  };
  for (const key of Object.keys(extra || {})) out[key] = extra[key];
  log('planning ' + status + ' at ' + stage + ' (round ' + round + ' of ' + ROUNDS + ')');
  return out;
}

// ---------------------------------------------------------------------------------------------- main

let feedback = [];         // lines handed to the next planner round
let last = {planner: null, test_designer: null, critics: []};

for (let round = 1; round <= ROUNDS; round += 1) {
  // 1. Planner: draft (and its own dry-run self-check), result recorded by the agent with result put.
  const plannerPrompt = [
    'Read your brief at ' + PLANNING.briefs.planner + ' and follow it exactly. Role: planner. Planning round ' + round +
      ' of ' + ROUNDS + ', attempt ' + round + '.'
  ];
  if (feedback.length > 0) {
    plannerPrompt.push('Address these before anything else (they come from the check and the critics of round ' + (round - 1) + '):');
    for (const line of feedback) plannerPrompt.push('- ' + line);
  }
  const planner = await callAgent(plannerPrompt.join('\n'), options('planner', 'planner round ' + round, 'Plan', 'result-planner'));
  if (planner === null) return summary('rerun', round, 'planner', {results: last});
  if (isInfra(planner)) return summary('needs-owner', round, 'planner', {results: last, errors: [planner.infraError.slice(0, 300)]});
  last.planner = resultPath('planner', round);

  // 2. Mechanical check by another agent (the planner's own self-check is never the evidence).
  const check = await runCheck(round, false);
  if (check === null) return summary('rerun', round, 'check', {results: last});
  if (isInfra(check)) return summary('needs-owner', round, 'check', {results: last, errors: [check.infraError.slice(0, 300)]});
  if (!checkPassed(check)) {
    feedback = checkErrors(check);
    if (round < ROUNDS) continue;
    return summary('needs-owner', round, 'check', {results: last, errors: feedback});
  }

  // 3. Independent test designer: proofs and acceptance checks for the candidate's tasks.
  const tdPrompt = [
    'Read your brief at ' + PLANNING.briefs.test_designer + ' and follow it exactly. Role: test-designer. Planning round ' +
      round + ', attempt ' + round + '.',
    'The plan candidate is ' + PLANNING.candidate_path + ' (task ids there are final: instantiation is deterministic).'
  ].join('\n');
  const td = await callAgent(tdPrompt, options('test_designer', 'test designer round ' + round, 'Proofs', 'result-test-designer'));
  if (td === null) return summary('rerun', round, 'test-designer', {results: last});
  if (isInfra(td)) return summary('needs-owner', round, 'test-designer', {results: last, errors: [td.infraError.slice(0, 300)]});
  last.test_designer = resultPath('test-designer', round);

  // 4. Check again with the test designer's proofs applied.
  const check2 = await runCheck(round, true);
  if (check2 === null) return summary('rerun', round, 'check-proofs', {results: last});
  if (isInfra(check2)) return summary('needs-owner', round, 'check-proofs', {results: last, errors: [check2.infraError.slice(0, 300)]});
  if (!checkPassed(check2)) {
    feedback = checkErrors(check2);
    if (round < ROUNDS) continue;
    return summary('needs-owner', round, 'check-proofs', {results: last, errors: feedback});
  }

  // 5. Completeness critics in fresh contexts, one per lens. A barrier is right here: the next round needs every
  //    critic's gaps together.
  const lenses = PLANNING.briefs.critics;
  const critics = await parallel(lenses.map((lens, k) => () => callAgent([
    'Read your brief at ' + lens.path + ' and follow it exactly. Role: reviewer (plan critique, lens ' + lens.lens +
      '). Planning round ' + round + ', attempt ' + ((round - 1) * lenses.length + k + 1) + '.',
    'Plan candidate: ' + PLANNING.candidate_path + '. Test designer result: ' + PLANNING.state_dir + '/' + last.test_designer + '.'
  ].join('\n'), options('critic', 'critic ' + lens.lens + ' round ' + round, 'Critique', 'result-reviewer'))));
  const thrown = critics.filter((c) => isInfra(c));
  if (thrown.length > 0) {
    return summary('needs-owner', round, 'critics', {results: last, errors: thrown.map((c) => c.infraError.slice(0, 300))});
  }
  const returned = critics.filter((c) => isObject(c));
  last.critics = lenses.map((lens, k) => (isObject(critics[k]) ? resultPath('reviewer', (round - 1) * lenses.length + k + 1) : null))
    .filter((p) => p !== null);
  if (returned.length < lenses.length) {
    return summary('rerun', round, 'critics', {results: last,
      errors: [(lenses.length - returned.length) + ' of ' + lenses.length + ' critics returned nothing']});
  }

  let inScope = 0;
  let outOfScope = 0;
  let blocking = 0;
  feedback = [];
  for (const c of returned) {
    for (const g of (Array.isArray(c.gaps) ? c.gaps : [])) {
      if (!isObject(g)) continue;
      if (g.within_approved_scope === true && g.type !== 'unrequested') {
        inScope += 1;
        feedback.push('gap ' + g.type + ' ' + g.requirement + ': ' + String(g.evidence).slice(0, 300));
      } else {
        outOfScope += 1;
      }
    }
    for (const f of (Array.isArray(c.findings) ? c.findings : [])) {
      if (isObject(f) && (f.severity === 'blocker' || f.severity === 'major')) {
        blocking += 1;
        feedback.push('finding ' + f.severity + (f.task ? ' ' + f.task : '') + ': ' + String(f.claim).slice(0, 300));
      }
    }
  }
  feedback = feedback.slice(0, 20);
  const counts = {results: last, gaps_in_scope: inScope, gaps_out_of_scope: outOfScope, blocking_findings: blocking};
  if (inScope === 0 && blocking === 0) return summary('ready-for-approval', round, 'critics', counts);
  if (round === ROUNDS) {
    counts.errors = feedback;
    return summary('needs-owner', round, 'critics', counts);
  }
  log('round ' + round + ': ' + inScope + ' gap(s) in scope and ' + blocking + ' blocking finding(s); planning again');
}

return summary('needs-owner', ROUNDS, 'rounds', {results: last, errors: feedback});
```

---

## 10. What the harness tests (B05, `scripts/tests/js/wave-harness.mjs` driven by `test_wave_harness.py`)

The harness wraps a rendered script as in 2.3, supplies fake `agent`, `parallel` (thunks, a throwing thunk → null),
`pipeline` (per-item stages, no barrier), `log`, `phase`, `args`, runs it and prints `{returned, calls, logs, peaks}`.
Cases (each with a positive control in the same file):
1. A dependency starts only after its prerequisite resolved `done`; a prerequisite ending `rerun` makes the
   dependent `skipped-dep` and its agent is never called.
2. An implementer returning `null` → `rerun`; a verifier returning `null` → `rerun` (never `done`); a fake `agent()`
   that **throws** (`Agent type 'x' not found`) → `infra-error`, never `rerun` (positive control: the same task with
   a null → `rerun`); an implementer result with `merge.exit_code: 3` → `rerun`; a verifier `pass` with
   `receipt_sha256: null` → `rerun`, with a receipt → `done`.
3. `args.skip` tasks are not called and their dependents run.
4. Writers, verifiers, integrators and browser slots never exceed their limits (peaks), two tasks sharing a unary
   resource never overlap, and two tasks of one lane never have writing steps at once.
5. Priority: with one writer slot, waiters start in `priority_rank` order.
6. The return value is exactly `{wave, outcomes}` with an outcome for every task, valid against 3.8.
7. Fake `feCritique` / `feDirections` are called with `api` holding exactly `agent`, `parallel`, `pipeline`, `log`; a
   null inside a fragment → `rerun`; a not-ok receipt without nulls → `failed`; the prepare command runs before the
   fragment and a non-zero prepare exit → `failed`.
8. With `in_wave_fix: true` a verifier `fail` runs the prepared attempt with phase `Fix`; with `false` it does not.
9. Planner template: clean run → `ready-for-approval` in round 1; a failing check feeds its error codes into the
   round-2 planner prompt; in-scope gaps at the last round → `needs-owner`; a null planner → `rerun`; critic result
   paths never collide across rounds.
10. Rendering: the real /frontend fragments inline without tripping the static check (2.2) and the wrapped script
    parses (2.3) — measured on 2026-10-01 with the current `critique.js` and `directions.js`.

---

## 11. Open points
Settled in revision 2 (README.md 10): the implementer runs `merge` itself (integrator agents only after test-designer
and fragment steps; ARCHITECTURE 6.7 allows "no LLM at all" for integration); the in-wave fix loop is on; gate and
state-only tasks reach `built` through gate and state-only merge receipts; built tasks with a dead verifier get a
`[verifier]` chain; the comment-stripped static check and `E_WAVE_FORBIDDEN_TOKEN`; `plan emit`, `plan instantiate
--proofs`, `W00`, no separate `plan` reviewer mode; fragment receipts stay inbox copies validated by `wave ingest`
against /frontend's receipt schemas (done rests on the verifier's proof); fragment runners get `agentType:
execution-implementer`.
- The measured question that remains is runtime, not design: whether `agent()`'s `agentType` resolves to the custom
  definition inside workflows on the pinned version (AGENTS.md 5.3 probe).
