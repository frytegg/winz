# /execution — architecture v1

Status: APPROVED by the owner on 2026-10-01 (decisions in §14), and aligned with /frontend's contract (its
ARCHITECTURE.md §12 and scripts/CONTRACTS.md, agreed between the two building sessions on 2026-10-01). Being built
for Sun 4 Oct 12:00 Paris; first real run: TOKEN2049 Origins.
Evidence: the nine dossiers in `research/` (each one's `## Verification` section overrides its body).
Citations such as [hooks F13] point at a finding id in a dossier: loops = prior-art-loops, plan = prior-art-planning,
par = prior-art-parallel, hooks = cc-skills-hooks, rt = cc-runtime, notion = notion-mcp, skills =
local-skills-interlock, past = local-past-builds, origins = target-origins.

---

## 0. What it is, in one paragraph

`/execution` takes a validated spec and the full context of a project (usually a hackathon), derives a task graph
with owners, dependencies, estimates and a mechanical proof per task, gets ONE approval from the owner, then runs
the build as a sequence of background workflows. A task is done only when an agent that did not write it re-ran
its proof on the commit that landed on main. The judged UI is built inside the same plan by /frontend's task
templates (mode A). The run ends when the plan is proven complete and the tree is harden-ready, and hands over to
the owner, who types `/harden`. It stops only for manual tasks and decisions, and keeps running every piece of work
those do not block. One or two developers, each with an identical setup or not.

Non-goals: it never invokes `/harden` (impossible anyway: `disable-model-invocation`) [hooks F03], never invokes
`/prose`, never builds a generic UI (the UI is /frontend's), never produces deliverables (video, pitch, submission
text, README headline claims, public flip) before its build gates pass, and never cuts scope on its own (owner
decision 2).

---

## 1. Pipeline and contracts

```
/hackathon (Phase A) --> validated spec --> /execution plan (includes /frontend templates, mode A)
                                                 |
                       build complete + frontend-check green + harden-ready
                                                 |
      /harden (owner types it) --> review/merge harden branch (manual) --> /execution --fix <report> (§18)
                                                 |
    FE-21 owner sign-off (H3) --> record (manual) --> /prose (owner types it) --> README screenshots LAST --> ship
```

### 1.1 Input contract
- **Spec**: a file with requirement ids (FR-xxx), success criteria (SC-xxx), user stories with priority (P1-P3),
  demo beats when there is a demo, and an out-of-scope list. Missing ids are assigned by the planner and shown in
  the approval. The engine refuses to plan against a spec the owner has not marked validated [origins F09].
- **Event profile** `profile.json`: built at ingest from the workspace (rubric, brief, memory), asking only for
  missing fields (§4.3), including the `frontend` block and /frontend's inputs (customers with official URLs, the
  never-show list, the claims ledger).
- **Policy** `policy.json`: the standing authorisations, narrowed per project (§4.4). Origins, for instance, is
  mainnet read-only whatever decision 3 says [origins F13].

### 1.2 Exit contract ("build complete", phase-tagged)
The generated completion check (§9) exits 0 for `--phase build`, and the **harden-ready gate** passes. That gate
reproduces every condition under which an autonomous `/harden` silently degrades to report-only [skills F02-F06,
F12]:

| id | check (all mechanical) |
|---|---|
| H1 | HEAD exists; no `.harden/active` in the repo |
| H2 | `git status --porcelain=v1 --untracked-files=all` empty outside `.harden/` (run files are excluded) |
| H3 | no committed `.only` / `fit` / `fdescribe` |
| H4 | self-setup dry run (prescan, inventory, `infer_profile infer/probe/finalize --out-dir <outside repo>`, never `--install`) yields a test gate, mode auto, live_side_effects none |
| H5 | `gates.py --repeat 3` (one run shuffled, fixed seed) exits 0, no flaky gate |
| H6 | fresh `git clone --no-local` + lockfile install + `gates.py --repo <clone>` exits 0 |
| H7 | no auto-loaded env file in the tree (`.env.local` parked by the owner: manual task) |
| H8 | `harden_agents.py status` exits 0 |
| H9 | disk above the floor; time left before the deadline covers harden's budget |
| H10 | contract/validator sources frozen, or scoped out of /harden (it knows only .sol/.vy, not Aiken) [skills F09] |
| H11 | README factual (its commands run), `.env.example` complete, no TODO in judge-facing files |
| H12 | latest GitHub Actions run of the offline gates is green on the final SHA |
| H13 | every proof replayed on a fresh clone of main |
| H14 | `frontend-check --json --phase build` (full mode) or `--phase small` (small mode) exits 0 (a requested gate that is skipped exits 1) |

Then a script prints the hand-over from receipts (never from model prose) [skills F17]: the final SHA, what to type
(`/harden`, `/harden <paths>`, or `/harden --profile <path>` with a time-capped profile /execution drafted OUTSIDE
the repo [skills F37]), and the time left.

---

## 2. Operating model: an event-driven orchestrator

The research rules out a Ralph-style loop: it re-feeds one prompt and stops on a string the model prints, it ran
6,239 iterations in one reported runaway, and it traps an honest agent when the goal holds human work [loops
F01-F05]. `/execution` is instead a thin scheduler in the main loop of ONE named interactive session.

### 2.1 Launch
From the repo root (settings files are read from the starting directory on Windows [hooks V-F22]):
```
claude --remote-control "<proj>-exec" -n "<proj>-exec" --dangerously-skip-permissions
```
through a launcher script that sets `CLAUDE_CODE_RETRY_WATCHDOG=1`,
`CLAUDE_CODE_WORKFLOW_MAX_CONCURRENT_AGENTS=<profile, default 6>`, `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH=60000`
[notion missed-1], and checks that the version is pinned (`DISABLE_AUTOUPDATER=1`, set as a Windows user variable on
2026-10-01; version >= 2.1.286 for the resume fix) [rt F43, rt missed-12]. During a run, the project's
`settings.local.json` also sets `switchModelsOnFlag: true`, so a safety-classifier flag on crypto or key code
switches model instead of pausing for a choice [rt F42]. The owner then types `/execution` alone, first in the
message [hooks V-F03].

### 2.2 The tick
Every turn runs the same idempotent procedure, whatever woke it (a wave finishing, the heartbeat, the owner, a
Stop-gate continuation). Scripts do the reading and print compact digests, so the orchestrator's context stays
small (each tick resends it) [rt F33]:

1. `exec.py status` — state digest (plan, running waves, awaiting items, clock, resources, quota).
2. **Reconcile** every finished wave, not only the one that woke us (completions can arrive together) [rt F01-F02]:
   parse results, turn `null` agents into reruns (never "done") [rt F31], record receipts, update status by script.
3. **Ingest human input**: the owner's message (terminal or phone) and, when a manual task is open, one view-mode
   poll of the Notion "To ingest" view [notion rec 8]. Answers become files, are verified mechanically (e.g. a tx
   hash re-read on chain), then unblock tasks.
4. **Checks**: resource governor (§8), quota (§8.2), clock tasks due (§7.3), plan staleness and overdue latest-starts.
5. **Replan** (`exec.py schedule`): ready set, priorities, P50/P80/P90 zones; a red zone creates a decision
   proposal and the engine keeps running unaffected work (decision 2).
6. **Dispatch**: if slots are free, `exec.py wave emit` writes the next wave script and briefs, and the orchestrator
   launches it with `Workflow({scriptPath})`, then checks the launch result for `error` (a syntax error still
   returns "launched") [rt missed-6].
7. **Report**: after each finished wave, the Notion report (§10) and a push when the owner must act.
8. **End the turn** only when a wake source is armed (a running wave, a watcher, the heartbeat cron) or the run
   is complete. The Stop gate enforces it (§5).

### 2.3 Wake sources
- A workflow finishing re-invokes the model in an idle session [rt F01, verified].
- A **heartbeat**: one recurring CronCreate every ~20 min at an off-minute, session-scoped, restored on resume
  (verified by execution), up to 30 min late [rt F12-F13]. Its prompt is plain text ("execution heartbeat: run
  `exec.py status` and follow references/tick.md"), because a cron can only run model-invocable skills [rt
  missed-3]. It is also the recovery path after a usage-limit stop, since auto-continue never arms while Remote
  Control is connected [rt V-F30].
- CI and chain waits: one background Bash `until …; do sleep 30; done` (up to 2 h) per wait [rt F11, F15].
- The owner's messages, from the terminal or the phone.

### 2.4 State machine
`INIT → PREFLIGHT → INGEST → PLAN → AWAIT_APPROVAL → RUNNING ⇄ {AWAITING_HUMAN, AWAITING_DECISION, PAUSED_QUOTA,
PAUSED_RESOURCES, STUCK} → BUILD_COMPLETE → HANDED_OVER`, plus `FIX` (§18). The state lives in files (§4); the
conversation holds none of it that matters [past F26].

---

## 3. Planning

### 3.1 Two-step planning for events that forbid prework
Origins forbids "code, designs, or prototypes before kickoff", and the owner's own research counts a CLI shape, a
schema, a report layout or a diagram as a design [origins F03-F04]. So:
- **Before T0**: a knowledge-level skeleton only (parts, hours, proofs, gates, owners), stored in the owner's private
  research folder, never in the event repo. /frontend's FE-00 (brief), FE-01 (owner confirms reference URLs) and
  FE-02 (reference captures and the written pattern ledger) are research and may run before T0, with
  `--state <private_dir>/frontend/`; no visual (tokens, logo, mock) before T0.
- **At T0**: product repo and state repo creation (the bootstrap task also imports the pre-T0 frontend state), then
  the design-level plan in minutes (§3.2), approval by about T0+30. The rehearsal uses a neutral fixture, never event
  content.
Events without such a rule plan whenever the spec is ready, with the thorough variant.

### 3.2 The planner (a workflow)
1. **Planner** agent (Opus, high): spec + profile + policy + repo state + the task-template library → draft
   `plan.json`. Library: /execution's own templates in `assets/task-templates/` (bootstrap, CI, contract wave,
   deploy, evidence capture, factual README, /hackathon Phase B tasks, deliverable sub-plan, fix tasks) and
   /frontend's templates (`~/.claude/skills/frontend/assets/task-templates/frontend.json`) instantiated for
   `profile.frontend.mode` (full or small). There is no generic UI template. If /frontend's templates or checker are
   missing at planning time, planning stops with a decision for the owner.
2. **Template instantiation** (`exec.py plan instantiate`, deterministic): FE-xx template ids become T-ids carrying
   `template: "frontend:FE-03"`; FE-1x becomes one task per feature group; parameters resolve every dependency at
   instantiation, never at runtime (`references: on|off` picks FE-02 or FE-00 for FE-03; FE-07 always after FE-06);
   "project name" becomes a dependency on a `decision` task whenever the name is not owner-confirmed (Origins: rename
   pending); "the feature's own task" is the build task(s) whose `covers` intersect the group's FR ids. The feature
   catalogue for /frontend is generated from plan.json requirements in /frontend's format
   `[{id, group, title, priority, status_expected?}]`.
3. `exec.py validate`: acyclic, dependencies on lower ids only, every requirement covered, every task has owner,
   estimate, proof, write-set and resources; overlapping writes or resources without a dependency are refused
   [plan rec 1].
4. **Test-designer** agent (not the implementer): writes each proof and the acceptance checks, each with a negative
   control that must fail before implementation [par F45, plan F03]. /frontend tasks bring their own proofs
   (`frontend-check`).
5. **Completeness critic** (fresh context, burden on "done", plan given as the contract) [past F13].
6. `exec.py schedule`: estimates, Monte Carlo, zones, the build-complete deadline (§7).
7. Approval summary in French: critical path, lanes, manual tasks with times, decision gates (including /frontend's
   H1 and H2), risks, P80 dates. The owner approves once; later scope changes go through a decision (decision 2).

---

## 4. State: files, and where they live

### 4.1 A private state repository (owner decision Q2)
The plan must be versioned, shareable with dev B, recoverable after a crash, readable offline by the completion
check [notion rec 1], yet never judge-visible (plans, answers and decisions can hold undisclosed matters
[origins F13]). So each project gets **a private state repository**, cloned at `<repo>/.execution/` and excluded
from the product repo through `.git/info/exclude`. `/harden` sees a clean tree (ignored paths do not count) [skills
F02]; git push is the compare-and-set for two developers [notion F28]; nothing leaks at the public flip.

```
.execution/                      (its own git repo, private remote)
  plan.json                      plan-of-record (structure); changed only through exec.py
  status/A.json, status/B.json   per-orchestrator task status (each written by one orchestrator only)
  profile.json  policy.json      event profile and narrowed authorisations (no secrets)
  feature-catalogue.json         generated for /frontend from plan.json requirements
  proofs/<task>.json             verifier receipts: task, sha, command, exit_code, output_sha256, verdict, by
  events.jsonl                   append-only event log: the resume source [loops F15]
  decisions.md                   proposals and the owner's answers (decision log) [plan F14]
  answers/<key>.md               ingested human reports
  briefs/<task>.md  waves/Wnn.js generated briefs and wave scripts (inspectable, resumable)
  frontend/                      /frontend's mode-A state: brief, pattern ledger, boards, critique history, gate JSON, ui-copy.md
  completion-check.mjs           generated from the plan (§9)
  EXECUTION.md                   generated TASKLIST-style view
  harden-profile.draft.json      time-capped /harden profile candidate (owner promotes it)
  local/                         git-ignored: active marker, state cache, Notion mirror hashes and outbox, scratch
```
`.claude/settings.local.json` (the hooks, §5) is added to `.git/info/exclude` as well: a hand-made one is not
excluded automatically [hooks V-F22]. Reference captures of third-party sites never enter either repo: they stay in
`workspace.private_dir` and are deleted after the event (/frontend's capture policy).

### 4.2 Task schema (plan.json)
Adapted from the planning dossier's D1 [plan rec 1]:
```
id "T012" (topological, deps on lower ids only, never renumbered) | title | description (exact paths)
template "frontend:FE-03" (when instantiated from a template) | params {...} | feature_group "G1"
covers ["FR-003","SC-002"] | story "US1" | priority P1|P2|P3 | required bool
phase setup|contract|build|integrate|verify|ops|recon|audit|manual|decision|deliverable|fix
kind code|test|infra|deploy|tx|research|manual|decision|watch|gate
owner agent|devA|devB | executor A|B (which orchestrator runs it)
depends_on [ids] | release_utc | deadline_utc | anchor {relative_to, offset_min, recurrence}
writes [globs] | resources [manifest, wallet:<name>, port:<n>, db:<name>, browser, human:<dev>, disk-heavy]
estimate {p10_min, p50_min, p90_min, source} | tokens_est {usd_list, basis}
model opus|sonnet|haiku | effort low|medium|high (subagents never above high, owner policy 2026-10-02)
proof {type command|tx|ci|file|url|human-attest, spec, expect, max_runtime_min, negative_control} | proof_author
brief_refs [absolute paths an implementer must read]   (e.g. /frontend references)
manual {steps, bring_back, options_source, where phone|laptop|venue, latest_start_utc}   (manual and decision tasks)
max_attempts 2
```
Status (in `status/<executor>.json`, never in plan.json): planned, ready, running, built, verifying, done, failed,
blocked-manual, blocked-decision, cut-proposed, cut, superseded, plus attempts, actuals and the receipt path.
`done` is set only by `exec.py` after it has checked a verifier receipt whose SHA is on origin/main.

### 4.3 Event profile (profile.json)
project {name, name_owner_confirmed} · event {kind hackathon|bounty|grant|project, presence, start_utc,
deadline_utc, display_zones, judging, demo, deliverables, rubric weights, tracks} · team {devs with availability
windows in UTC, setup full|human-only} · channels {name, kind, access manual-copy|mcp:<server>|fetch} · prework
{code, designs, until_utc} (authoritative; /frontend reads it) · freezes · workspace {private_dir} · paths
{never_show, feature_catalogue} · phase_b {claims_ledger, dx_journal, run_sheet — outside the judge-visible repo when
private} · machine {max_lanes, disk_floor_gb, ram_floor_gb, workspace_mode} · notion {hub_page_id, database ids,
language "fr"} · **frontend** {mode full|small, judged_surface, format, viewports, stack, hosting, external_requests,
prework_designs (override only), review_surface, critique, budget, references, sponsor_allowlist}, validated
against /frontend's `assets/schemas/profile-frontend.schema.json`.

### 4.4 Policy (policy.json), enforced by hooks
git {commit, push, force never, history rewrite never, push_freeze_utc} · networks {testnet {allowed, ceilings},
mainnet {mode read-only|after-setup, setup_flag, ceiling}} · deny_endpoints · fences {deny_read,
deny_write_outside_repo} · secrets {env file loaded by path only; agents never read keys}. The **never-show list** is
ONE JSON file at `paths.never_show`, in /frontend's format: `{version:1, entries:[{id, class
do-not-carry|undisclosed-security|never-public|embargo, pattern, regex, case_sensitive, until_utc, scope
rendered|repo|both, note, source}]}`, an entry inactive once its until_utc has passed. /execution checks entries of
scope repo or both before every commit and before the public flip; /frontend checks rendered text. Signed
transactions follow the owner's KEYRULES: in-process key loading, chain and address asserted, per-task ceiling,
sequential sends, outcome re-read on chain by another agent [past F36]. Mainnet stays manual until the owner's
wallet-setup task is proven (decision 3), then runs under a per-wave spending ceiling, unless the project's policy
makes it read-only.

---

## 5. Hooks: durable, in settings, gated

Skill-frontmatter hooks are the wrong layer: they vanish on `/clear`, a restart or a resume; their SessionStart
and PreCompact never fire; and they do not see tool calls inside workflow agents [hooks F07-F09, verified by
execution]. So `exec.py hooks install` writes them into `<repo>/.claude/settings.local.json` at run start (live
on the next turn, they survive resume and compaction [hooks F22]) and removes them at hand-over. Every hook exits
0 unless the marker `.execution/local/active` exists AND the session id matches the orchestrator's (re-keyed on
SessionStart clear, which changes the id [hooks missed-6]). Scripts are Python, launched with the owner's fail-open
pattern (`py.sh`), in shell form, and kept cheap: they run for every tool call of every agent [hooks F30].

| hook | behaviour |
|---|---|
| **Stop gate** | allow if `background_tasks` has a running workflow/agent/shell (an absent array counts as unknown) [hooks F13, rt V-F17]; allow if an item is awaited AND the heartbeat cron is armed (`session_crons`); allow if the build gates pass. Otherwise continue with `hookSpecificOutput.additionalContext` naming the ready tasks (not `decision:block`, which raises an error notice; never exit 2, which leaks the command line) [hooks V-F11, F11]. Own consecutive-continuation counter: after 4, allow the stop, record STUCK and flag it for the next tick, well before the built-in 8-block cap [hooks F12]. |
| **SessionStart** compact/resume/clear/startup | print at most ~2,000 characters: the state digest and which SKILL.md sections and references to re-read [hooks F16]. |
| **StopFailure** | an API error ends the turn without firing Stop: record STUCK with the reason [hooks missed-7]. |
| **PreToolUse guard** | keyed on `agent_type`: implementers cannot edit acceptance tests, proofs, CI, hooks or test config; verifiers write only their verdict file; policy denies (mainnet broadcast without the owner's flag, denied endpoints, fenced paths, force push, history rewrite, pushes after the freeze). Deny rules and PreToolUse denies bind in bypass mode [hooks F23]. |
| **UserPromptSubmit** (optional) | inject one line of state on real owner prompts; ignore task-notification prompts [hooks missed-5]. |

---

## 6. Waves, lanes, agents

### 6.1 A wave is a reporting epoch, not a barrier
Barriers cost 33-63% of the makespan with 4+ slots in simulation, and the owner's own logs show a median 26% of slot
time idle under them [plan F20]. So one wave = one Workflow run over a subset of the graph, and INSIDE it every task
starts as soon as its own dependencies are verified: the script awaits each dependency's promise and holds its own
priority queue (least slack first, then longest remaining path) under a semaphore sized to the lanes [plan rec 3].
A wave closes when its task set is exhausted or blocked on a manual task; the orchestrator may run a second wave
concurrently for work unblocked by the owner, within the governor's total budget. Workflows take no mid-run input,
so manual tasks and decisions always sit between waves [hooks F19].

### 6.2 Wave 0: the contract wave (serial)
Repo bootstrap (for Origins at T0: created after kickoff, `.gitattributes eol=lf`, main branch, `core.longpaths`,
a portable commit-msg hook refusing AI trailers so dev B's machine is covered too [past F35]), one install by one
agent, public types / schemas / ABIs / env schema, package manifest and lockfile (one shared resource), hub files,
the ownership map from globs to lanes, the acceptance checks (failing first), and a GitHub Actions workflow running
the offline gates literally, with no secrets (it doubles as /harden's evidence) [par rec 2, skills rec 5].

### 6.3 Per task, inside the wave (pipeline, no barrier)
1. **Implement** — `execution-implementer` (Opus, high on the critical path, medium elsewhere), in its lane's
   workspace, from a brief file that names every `brief_refs` path (no reliance on skill auto-loading). Returns a
   schema: commit, files, its own proof run, DX-friction rows, notes.
2. **Integrate** — `exec.py merge` behind a file lock: rebase on origin/main, gates on that exact tree (offline
   install, typecheck, lint, tests, the task's proof, integrity scans, secret scan with a positive control, trailer
   and never-show checks), `push origin HEAD:main` (a non-fast-forward rejection is the CAS), fast-forward local main
   [par rec 8, F34]. A conflict goes back to the lane (max 2 attempts, then BLOCKED and proposed).
3. **Verify** — `execution-verifier` (Opus, high; no CLAUDE.md, read-only except its verdict): `exec.py proof run
   --sha <landed>` re-runs the proof in a clean checkout and hashes the output; the agent then judges the diff against
   the acceptance criteria and scans for stubs, TODOs and weakened tests. It sees the spec, proof, diff and raw
   output, never the implementer's reasoning [par F42]. New tests count only once seen to fail against a planted
   defect [par F47]. /frontend proofs chain the build and the checker (`pnpm -C {ui} build && node
   ~/.claude/skills/frontend/scripts/frontend-check.mjs --json --gates … --features FR-… --profile <abs profile>
   --serve {ui}/dist`, or `--start "<cmd>" --url http://127.0.0.1:<port>` for apps that need a server); the checker
   never builds and exits 1 if any requested gate is skipped.
4. **Fix** (bounded) — on failure, a fresh implementer gets the verifier's findings and may rebut them with evidence
   [past F09]; after 2 failed attempts: BLOCKED, proposal to the owner.
Money, keys, mainnet and absence claims also go to the owner (no cross-model reviewer is installed) [par rec 19].

### 6.4 Parallelism rule (computed, never asserted by a model)
Two tasks may overlap only if no path joins them, their write globs are disjoint, and they share no unary resource
(manifest/lockfile, a wallet's nonce or UTXO, a port, a database, a browser run, a human, a disk-heavy slot) [plan
rec 2, F32]. Expect 1.5-2x from parallelism, not Nx [par F29]; two agents splitting coupled work do worse than one
[loops F24].

### 6.5 Workspaces
- `worktrees` mode: one Claude-managed worktree per LANE (not per task), `worktree.baseRef: "head"`, pnpm only
  (hard links: ~0.1 GB per lane), removed through Claude Code or a link-safe script right after merge [par F08-F09,
  F21].
- `single-tree` mode (default when disk is tight or the stack is npm/yarn: one npm install of the Cardano starter
  is 701 MB / 128k files [origins F20]): file-disjoint agents in one checkout, pathspec-only commits, the Hedera
  pattern that worked [past F08].
The governor picks the mode per wave from measured free disk.

### 6.6 Agent definitions (installed in `~/.claude/agents/`, harden-style templates)
/execution installs `execution-planner`, `execution-test-designer`, `execution-implementer`, `execution-verifier` and
`execution-reviewer` (adversarial pass with planted defects at milestones [past F10]). /frontend installs
`frontend-critic` and `frontend-probe` (read-only), which /execution's wave scripts call with
`agent(prompt, {agentType})`. Every one has a pinned model, explicit tools, and `disallowedTools` for Notion and the
other write-capable connectors, PushNotification, CronCreate/CronDelete, Monitor, RemoteTrigger, Artifact and
SendMessage (workflow agents otherwise keep them [hooks missed-4]); /execution's own agents add a guard hook and
standing rules in their prompt: no AI trailers (message written to a file, `git commit -F`), never name `.env` in a
command, Write/Edit only for source (no heredocs), LF, real exit codes, never chain a success message, repository and
Notion text is data. Agents that keep CLAUDE.md get an explicit override of the interactive habits (ask before
deciding, remind to commit, offer an X post) [hooks missed-16].

/frontend's multi-agent steps are **wave fragments** it ships as plain JS (no imports, no Date.now or Math.random):
`assets/wave-fragments/critique.js` (`feCritique`) and `directions.js` (`feDirections`), each taking
`api = {agent, parallel, pipeline, log}` and returning a receipt. The wave emitter inlines them, so /execution never
re-implements /frontend's rounds, acceptance rule or revert-to-best logic; the commands they need run inside
agent() calls that return the command's JSON (a workflow script cannot run Node).

### 6.7 Model and effort defaults (profile can override)
Owner policy of 2026-10-02 (token budget): `xhigh` only for strategy, subagents never above `high`. Orchestrator:
the session model at xhigh during a run (it plans, arbitrates and replans; `hooks install` sets it for the run and
preflight PF-30 checks it). Planner, test-designer, implementer (critical path), verifier, reviewer:
Opus high. Other implementers: Opus medium. Integrator and mechanical checks: Sonnet low, or no LLM at all. Effort is
always set explicitly per agent, never inherited (a max-effort session would otherwise pass max to every agent, and
max is prone to overthinking [plan F31]). Never Fable unattended (its consent prompt ends the turn after 5 min and is
not forwarded to the phone) [rt F41]. Cache reads dominate agent cost, and Opus and Sonnet cache reads cost the same,
so the real token levers are fewer retries, smaller contexts and fewer agents, not a cheaper tier [rt V-F37, plan
F29].

---

## 7. Scheduling

### 7.1 Estimates
Reference class from the owner's 355 logged agents: build p10/p50/p90 = 6.2/26.7/46.0 min, verify 1.6/6.7/31.1,
research 13.0/24.9/40.6; median list cost build $15, verify $2 [plan F28]. Durations are lognormal from p50/p90.
/frontend templates carry their own p10/p50/p90 per mode. Recalibrated after every wave from actual/estimate ratios
per kind.

### 7.2 Algorithm (`exec.py schedule`, deterministic Python, no LLM)
CPM with release times and deadlines → Monte Carlo (K = 500-1000, seeded) through the same dispatcher (parallel
schedule generation, priority = latest start, then longest remaining path, then successors, then id; resources =
lanes per machine, humans with availability calendars, unary resources) → P50/P80/P90 per deadline and a criticality
index [plan rec 3, F16-F19]. The owner sees P80/P90, never the CPM total (plans from mean durations were late in
56-76% of simulated runs) [plan F19].

### 7.3 Clock, zones and cuts
- **Build-complete deadline** = submission − (/harden P80 + fix wave + FE-21 sign-off + recording + /prose + README
  screenshots + submission steps + buffer). For Origins this lands around Wed 11:59-17:00 SGT [skills F07, origins
  F33].
- **Zones** after every wave: green if P(on time) ≥ 0.8, yellow 0.5-0.8 (report and prepare options), red < 0.5 →
  cut proposal (optional, then P3, then P2), the engine WAITS for the owner and keeps running unaffected tasks. A
  1.5x overrun is detectable by 20-30% completion [plan F21].
- **Clock tasks** (T-6h demo audit, recon passes, freezes, freshness re-runs) are computed from UTC anchors at every
  tick, not from crons, which follow the laptop's local zone (automatic time-zone switching is on) [rt F45].
- **Freezes** are explicit plan rows approved with the plan: validator/contract freeze, code-for-recording freeze,
  docs freeze, and a tag + push freeze at the deadline that overrides the standing push authorisation [skills F20].

### 7.4 Sizing rule
Each task within about 60 human-minutes (the models' 80% horizon), p90 agent time ≤ 60 min, one deliverable, one
proof that runs in ≤ 5 min, not split below ~15 min unless ownership or the critical path requires it. A 36-hour
event is about 25-60 tasks [plan rec 4, F24-F25].

---

## 8. Resources and quota

### 8.1 Resource governor (before every wave; PowerShell readings, not Git Bash du)
Free disk ≥ floor + lanes × footprint (C: swung 1.9-4.8 GB during the research alone [origins F19]); free RAM ≥ 2.5
GB [origins F21]; AC power; network reachable; no `.harden/active`. Default 3 writing lanes + ≤ 2 verifiers + 1
integrator; at most one browser-heavy task (Playwright, frontend-check) at a time while RAM is low. After every wave:
sweep orphan processes by command line, clean per-task scratch, remove merged worktrees. A failed gate lowers the
lane count or pauses launching, and alerts.

### 8.2 Quota
A session can read its 5h/7d usage only from the status-line JSON [rt F32]; since 2026-10-01 the owner's
`statusline.py` also writes it atomically to `~/.claude/usage-snapshot.json` (`captured_at_utc`, `five_hour`,
`seven_day` with `used_percentage` and `resets_at`). Before each wave: above ~85% of the 5-hour window, only
critical-path tasks; if the weekly window cannot cover the plan's P80, propose and wait (the owner may buy extra
usage). Workflow agents fail (return null) at a limit while Remote Control is connected, so null always means rerun,
and the heartbeat relaunches after the reset [rt V-F31]. A "usage limit approaching" system hint stops new launches
[rt missed-5]. The snapshot is stale when no session is rendering; its age is part of every reading.

---

## 9. Proof of completion

- `completion-check.mjs` is **generated from the plan** (the BNB script generalised): one gate per requirement, per
  irrecoverable deadline, the TODO scan of judge-facing files, the harden-ready gate and `frontend-check --phase
  build`; each gate states what would be untrue if it were dropped; each gate is tagged build, harden or deliverable,
  so build-complete can pass while the harden and deliverable gates stay open by design [skills F30]. Out of CI
  [CLAUDE.md rule 2].
- Gate output follows /frontend's shape, `{ok, gates:[{id, title, ifDropped, state, detail}]}`, with three states:
  ok, fail and skipped, where **skipped is open**, never passing (the BNB script reported a skipped gate as ok
  [past F11]).
- Proof checkers re-read ground truth (chain, CI API, parsed receipts), and each ships with a planted forgery that
  must fail it [past F11-F12].
- Before BUILD_COMPLETE: an independent convergence pass (fresh agents, plan as contract, burden on "done") appends
  missing work as tasks; missing work under an approved requirement is added, anything wider is a decision
  [plan F05, past F13].

---

## 10. Notion: mirror and input channel, never the source of truth

Notion has no compare-and-set (per-property last write wins), acts as the owner himself (so it will not notify
him of his own orchestrator's writes), and a token rejected while he is away needs `/login` at the terminal
[notion F16-F18]. So the repo decides and Notion shows [notion rec 1]:

- **One hub page per project or hackathon** (owner decision Q5), shared with dev B when there are two developers;
  **reports in French** (files stay in English).
- **Only the orchestrator** calls Notion, enforced by `disallowedTools` on every agent (agents inherit bypass and
  would not be prompted) [notion V-F14].
- Databases **Tasks** (Key, State as SELECT not STATUS, Owner, Executor, Phase, Priority, dependencies as a
  self-relation, Due + "Due text" with the zone, Proof, Proof link, Verified by, Wave, estimate; owner-writable
  fields Answer, Answered, Decision, Attachments; orchestrator field Ingested) and **Waves** (one report row per
  wave); views Board by State, Needs Dev A, Needs Dev B, To ingest, Waves (newest first) [notion rec 3-7].
- `exec.py notion diff` emits the exact MCP operations for the wave (create/update only changed rows, by hash), so
  the orchestrator spends no tokens composing payloads. Updates are done only after `get-async-task` succeeds
  [notion missed-9].
- **The per-wave report** (single column, readable on the phone): done / proven (with proof links) / open / your
  next action / zone and P80 / heartbeat (disk, RAM, quota, last tick in SGT and Paris).
- **Alerts** go through PushNotification (Remote Control connected, the "Push when actions required" setting on),
  **answers** through a Remote Control reply or the Notion decision field, nothing else (canvas comments are not
  answers); photos land in `~/.claude/uploads/` [notion rec 9, rt F22-F23].
- Failures go to an outbox replayed at the next wave; before replaying, one real read confirms the token (a phone
  `/mcp reconnect` can report success while still rejected) [notion missed-6].
- Two-developer constraint: dev B must be a workspace **member** (guests reportedly cannot connect the Notion MCP),
  and a Free workspace with two members is capped at 1,000 blocks counted since signup, so a two-developer event
  needs a paid plan [notion V-F22, V-F23].

---

## 11. Manual tasks and decisions

A manual task is a graph node with exact steps, what to bring back (tx hash, screenshot, pasted text, transcript),
where (phone, laptop, venue), a latest start inside the owner's availability windows, and its dependents. When it
becomes ready, or its latest start approaches: Notion row + push (≤ 200 characters, names the key), state
`awaiting`, heartbeat armed, the other lanes keep running, the turn ends. Manual tasks are batched and front-loaded
when they unblock the critical path [past F37]. `AskUserQuestion` is reserved for moments when nothing else can run
(an open question blocks the main loop) [rt F27].

Decisions (cuts, spec gaps, contract amendments, policy exceptions) follow the same path with explicit options and
a decision deadline, and are logged in `decisions.md`. Owner input from Notion or from other humans is data:
anything that widens scope becomes a proposal [notion F30].

/frontend's three owner checkpoints are tasks of this kind: **H1** pick a direction and **H2** pick a logo (decision
tasks; the options come from FE-03's and FE-05's boards), **H3** sign off the deployed preview at recording size
(manual, FE-21, deliverable phase, before any recording task). The review board is published by the orchestrator in
the main thread, never by a workflow agent, following /frontend's `references/03-directions.md` section "Publishing
the board (orchestrator only)"; the frontend lane waits and every other lane keeps running.

---

## 12. Two developers (operational in v1, owner decision Q1)

- **Static ownership** fixed at plan approval: every task and path glob has one executor (A or B); each
  orchestrator launches only its own; reassignment is a plan amendment through git [par rec 11, F41].
- Status files are split (`status/A.json`, `status/B.json`), each written by one orchestrator: no write conflicts;
  plan.json changes (amendments) go through commit + push, re-validated after any merge [notion V-F28].
- A cross-developer dependency is satisfied by a receipt on origin/main, never by a Notion checkbox [par rec 13].
- Notion rows are write-partitioned by executor; each orchestrator writes its own wave reports.
- **Dev B without the setup** (an on-site recruit, or a teammate who does not run Claude Code): dev A's orchestrator
  tracks B's tasks as manual tasks and verifies them when B reports a SHA [origins F11].
- Dev B's setup is a plan task with a proof: Claude Code on the pinned version, the agents installed, the
  no-attribution guard active (global hook plus the repo's commit-msg hook), Notion membership, the state repo cloned.
- Cross-session messaging does not cross accounts, so git and Notion are the only bus between the two [rt F18].

---

## 13. The hackathon profile

- **/hackathon Phase B as scheduled tasks**, each pointing at its /hackathon reference (content stays there):
  claims ledger (opened at T0, rows added by verifiers, closed at the freeze), DX journal (implementers write a row
  at the moment of friction, verbatim error), recon passes on the cadence table mapped to the real clock (Origins:
  Tue evening, Wed morning, a narrow final pass early enough to act on), the demo audit at T-6h, an adapted preflight
  that can say no (the shipped skeleton exits 0 on stale state [skills F25]), the visibility calendar for remote
  builds, the judge's fetch run twice before submitting.
- **Prework rule** enforced: the repo is created after T0 (first-commit timestamp checked), fences deny agent reads
  of `research/probes/**` and writes outside the repo [origins F04]; no /frontend visual before T0 (§3.1).
- **UI budget**: /frontend runs in small mode at Origins (1-2 h of UI), to be confirmed by the owner at plan
  approval against the Cardano track's 20% UX & Design weight [origins F07].
- **Deliverable sub-plan** present from the start for scheduling (FE-21 sign-off, deck lock, recording, slides,
  Drive, form, flip, tag) but blocked by the build and harden gates; README screenshots last (decision 5), taken
  headlessly when Windows is not activated [origins F27].
- **Event-shipped tools** (e.g. an organiser's capture hooks) have a slot in the profile and must coexist with ours
  [skills F38].

---

## 14. Owner decisions (2026-10-01)

| | decision |
|---|---|
| Q1 | Full v1 before Origins, two-developer operation included. |
| Q2 | Private state repository per project, cloned at `<repo>/.execution/`. |
| Q3 | Approved: `DISABLE_AUTOUPDATER=1` as a Windows user variable (set 2026-10-01), the usage snapshot in `statusline.py` (done 2026-10-01), `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` in the launcher, `switchModelsOnFlag: true` in the project's settings during runs. |
| Q4 | `--fix` mode in v1 (§18). |
| Q5 | Notion: one hub page per project or hackathon, reports in French. |
| Q6 | Full budget; the owner buys extra usage if needed. |
| /frontend | Mode A from the start of the build; no generic UI path (decided in the /frontend session, 2026-10-01). |

Earlier decisions (2026-09-30) stand: Phase B scheduled by /execution, propose-and-wait, commits/pushes/testnet
authorised, mainnet after the owner's wallet setup, Notion as the shared plan, README screenshots last, general engine,
a report per wave, Origins first.

---

## 15. Skill layout

```
~/.claude/skills/execution/
  SKILL.md               standing rules, state machine and tick summary in the first ~5,000 tokens (the part
                         re-attached after compaction [hooks F25]); disable-model-invocation: true
  ARCHITECTURE.md        this file
  contract/              implementation contract: CLI, schemas, modules, hooks, waves, agents, Notion, two-dev,
                         /frontend, fix mode, tests, fixture, build lanes
  references/            tick.md, planning.md, waves.md, manual-tasks.md, notion.md (formats compiled from the
                         notion://docs resources), hackathon-profile.md, frontend.md, two-dev.md, fix-mode.md,
                         recovery.md, handover.md, agents.md
  assets/                JSON schemas, wave and planner workflow templates, task-templates/, completion-check
                         template, agent templates, launcher
  scripts/               exec.py and the execlib package (status, plan instantiate, validate, schedule, simulate,
                         wave emit/ingest, merge, proof run/verdict, governor, due, notion diff, completion,
                         harden-ready, handover, fix, fixture, hooks install/uninstall), hooks/*.py, tests/
  evals/fixture/         neutral rehearsal template ("Queue Clock"), shared with /frontend's A/B evaluation
  research/              the nine dossiers
```

---

## 16. Recovery playbook (short form; full in references/recovery.md)

| failure | recovery |
|---|---|
| terminal closed or crash | `claude --resume "<proj>-exec" --dangerously-skip-permissions` (bypass is NOT restored otherwise [rt missed-2]); `/execution resume`; tick reconciles; CronList; hooks canary |
| laptop asleep or lid closed | preflight requires AC and "do nothing" on lid; any phone prompt resumes |
| usage limit | agents return null → rerun; the heartbeat relaunches after the reset |
| API error turn | StopFailure hook records STUCK; the next heartbeat or owner message resumes |
| Notion down or token rejected | outbox; push asking for `/login` at the laptop |
| disk or RAM low | governor lowers lanes or pauses, alerts |
| process dead while away | the Notion heartbeat goes stale, visible from the phone; restart at the laptop, or from the phone via a server-mode session in a second terminal |

---

## 17. Building it before Sun 4 Oct

Everything above is v1 (Q1). Order: an implementation contract first (schemas, CLI, modules, hooks, waves, the
/frontend interface, tests, fixture, build lanes), reviewed adversarially; then parallel file-disjoint build lanes,
each implemented, tested and verified by a different agent; then integration and an adversarial review of the whole;
then the rehearsal on the fixture with the owner (phone included), then fixes.

Quota, measured on 2026-10-01 at 10:31 Paris: the weekly window was 65% used and resets Wed 7 Oct 04:00 Paris,
22 h into Origins. With /frontend's build (25-35M tokens) and this one (15-25M) ahead, the hack's first 22 hours will
very likely run on extra usage; the owner accepted that (Q6). Every agent's effort is set explicitly (§6.7).

Rehearsal acceptance criteria (on the fixture, before the flight): plan approved from a spec in under 30 min; a
contract wave then 3 parallel lanes; /frontend small mode with H1/H2 answered from the phone; one proof failing then
fixed; one manual task answered from the phone and one through Notion; a second orchestrator as dev B on its own
tasks; a forced `/compact` and a terminal kill + resume mid-wave; the Stop gate never ending a turn with the plan open
and nothing armed; a report per wave readable on the phone; build complete + harden-ready gate + hand-over printed by
script; `--fix` on a sample /harden report.

---

## 18. Fix mode (`/execution --fix <harden report>`)

After `/harden`, the owner reviews and merges the harden branch (a manual task: /harden never merges or pushes
[skills F08]). `/execution --fix <report>` then parses the report's sections (Applied, review before merge; Needs
your decision; Open owner items), turns the items the owner selects into `phase: fix` tasks with proofs, runs them as
waves under the same rules, re-runs the build gates as a regression check, and hands over to the deliverable
sub-plan (FE-21 first). Items the owner does not select are recorded in `decisions.md` with the reason.

---

## 19. Contract with /frontend (agreed 2026-10-01)

| topic | agreement |
|---|---|
| templates | FE-xx are template ids, instantiated to T-ids with `template`; deps resolved at instantiation (`references: on\|off`; FE-07 after FE-06; name → decision task; feature tasks by `covers` intersection); FE-21 in phase deliverable after the /harden review task |
| template fields | kind, phase, covers rule, writes with {ui_root}/{group} placeholders, resources (manifest, browser, port), estimates per mode, model + effort, proof object, brief_refs, manual/decision fields |
| proof | `frontend-check --json --gates <list> --features <FR ids> --profile <abs path> (--serve <dir> \| --start "<cmd>" --url <url>)`; never builds (the proof spec chains the build); exit 0 iff every requested gate is ok |
| gates | output `{ok, gates:[{id, title, ifDropped, state ok\|fail\|skipped, detail}]}`; skipped is open; `--phase build` (full mode) or `--phase small` (small mode) joins the build-complete gates |
| profile | `.execution/profile.json` → `frontend` block; top-level `prework` authoritative; `phase_b.claims_ledger`; `paths.never_show`; `workspace.private_dir` for captures |
| never-show | one JSON file, /frontend's format (§4.4), used by both skills |
| feature catalogue | generated by /execution: `[{id, group, title, priority, status_expected?}]`; `data-feature` = the requirement id |
| agents | frontend-critic and frontend-probe, read-only, same disallowedTools as /execution's |
| fragments | critique.js (`feCritique`) and directions.js (`feDirections`), inlined by the wave emitter |
| review surface | published by the orchestrator only; answers via Notion or Remote Control only |
| pre-T0 | FE-00..FE-02 with `--state <private_dir>/frontend/`, imported at T0 |
| fixture | shared: "Queue Clock" (Lido; candidate customers Aave, Morpho, EigenLayer, Spark, Euler, Curve), with one feature `simulated`, one `planned`, a never-show file with one live and one expired embargo, `profile.frontend` paths filled; /frontend runs its A/B in mode B on instances of it |
