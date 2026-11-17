# TWO-DEV.md — two developers, two orchestrators, one plan

Companion of ARCHITECTURE.md section 12 (owner decision Q1: two-developer operation in v1, ready for Origins), built
on SCHEMAS.md 3.2 (owner × executor), 4 (status) and 5 (who writes what), CLI.md `init`, `sync`, `amend`, and
NOTION.md 5.3. It refines them and never contradicts them; section 12 lists the contract questions it raises.
Owners: B08 (`init`, `sync`), B02 (`validate` rules TD-V*, `amend` rules TD-A*, `EX-DEVB-*` templates), B04
(reconcile rules TD-R*), B11 (`test_e2e_two_dev.py`).

Vocabulary: **dev A** is the owner (Alexandre), **dev B** the second developer. **Executor A / B** is the orchestrator
session that runs, posts and verifies a task. A dev B with `setup: full` runs his own orchestrator (executor B); a dev
B with `setup: human-only` runs none, and executor A tracks his work.

The only buses between the two machines are git (the product repo and the private state repo) and Notion; Claude Code
cross-session messaging does not cross accounts [rt F18]. Git decides, Notion shows.

---

## 1. Static ownership

### 1.1 What is fixed at approval
Every task has one `executor` and one `owner` in plan.json; every lane has one `executor`; the approved plan fixes
both. An orchestrator launches, posts, verifies and mirrors only its own tasks. Reassignment is a plan amendment
(section 4), decided by the owner.

### 1.2 Validation rules for a two-developer plan (`exec.py validate`, added to P-07/P-08 as TD-V1..TD-V9)
| id | rule | code |
|---|---|---|
| TD-V1 | Every executor used by a task or lane has a dev with that executor in `profile.team.devs` (P-07). | E_OWNER |
| TD-V2 | The contract lane (`contract: true`, L0) has executor A. Manifest and lockfile changes are A's (they are one ordered resource across both machines). | E_LANE |
| TD-V3 | Run-level tasks have executor A: `execution:EX-APPROVE`, `EX-NAME`, `EX-BOOT`, `EX-CI`, `EX-GATE-BUILD`, `EX-CONVERGE`, `EX-REPLAY`, every `EX-FREEZE-*`, `EX-HARDEN-PARK`, `EX-HARDEN-REVIEW`, `EX-FIX-SELECT`, `EX-FIX-GATE`, every `EX-HB-*`, every deliverable-phase task, `EX-DEVB-SETUP`, `EX-DEVB-CHECK`. Fix tasks (`EX-FIX-CODE`, `EX-FIX-REVERT`) follow their lane's executor (FIX-MODE.md 6.2). | E_OWNER |
| TD-V4 | Every task whose writes include `.execution/frontend/**` (all `frontend:FE-xx` instances, FRONTEND.md 3.4) has the same executor, so the /frontend state has one writer. | E_LANE |
| TD-V5 | Owner-only decisions belong to dev A: every decision task has `owner: devA`, `executor: A`. | E_OWNER |
| TD-V6 | A manual task owned by devB has executor B when dev B is `full`, executor A when he is `human-only` (P-07). Exception: `execution:EX-DEVB-SETUP` always has executor A (B's orchestrator does not exist until that task is done; TD-V3). | E_OWNER |
| TD-V7 | A cross-executor dependency (`depends_on` whose task has the other executor) is allowed; the validator lists them in `stats.cross_executor_deps` and the approval summary shows each one. | — |
| TD-V8 | Two tasks of different executors that share an ordered resource (`wallet:*`, `db:*`, `manifest`) must be joined by a path (P-10 already enforces it; serialized resources are per machine and never conflict across machines). | E_RESOURCE_OVERLAP |
| TD-V9 | When `profile.team.devs` has a dev B with `setup: full`, the plan has exactly one `EX-DEVB-SETUP` and one `EX-DEVB-CHECK`, and every task of executor B depends on `EX-DEVB-CHECK` (directly or through its lane's first task). | E_OWNER |

### 1.3 Which orchestrator does what
| act | A | B |
|---|---|---|
| ingest, plan instantiate, approval proposal, `completion generate`, `harden-ready`, `handover`, `fix` | yes | never |
| `amend` | yes | yes (CAS, section 4), under a decision resolved by the owner |
| waves, merges, proofs, manual posts of own tasks | own tasks | own tasks |
| `notion diff --init` stages 2-4 (hub skeleton, databases, views) | yes | never (stage 1 only) |
| propose decisions | range D-001..D-499 | range D-500..D-999 |
| resolve decisions | its own range | its own range (owner-only kinds never: TD-V5) |
| `report --view` (EXECUTION.md) | yes | never |

---

## 2. The state repository between two machines

### 2.1 One private repo, two clones
`<repo>/.execution/` on each machine is a clone of the same private remote (`profile.project.state_repo.remote_url`),
default branch `main`. `init` and every `sync` push check that the remote is private (`gh repo view --json
visibility`; exit 4 E_STATE_REMOTE_PUBLIC, nothing pushed). `.gitattributes`: `* text=auto eol=lf`, `events.jsonl
merge=union`, `decisions.md merge=union`; `.gitignore`: `local/` and `frontend/gates/`. Nothing under `local/` is ever
shared (locks, results, inbox, proof runs, Notion page map, hooks state); what the other machine's done check needs
travels as the compact tracked copies under `proofs/runs/`, `proofs/impl/` and `proofs/merge/` (SCHEMAS.md 1.1, 4.3).

### 2.2 Path partition (who may commit what)
| path | writer | merge |
|---|---|---|
| `plan.json`, the feature catalogue, `gates.json` | the orchestrator that ran `plan instantiate` (A) or `amend` (either), in the same commit | CAS push (section 4) |
| `profile.json`, `policy.json` | A (`ingest`) | single writer |
| `status/A.json` / `status/B.json` | executor A / B only | single writer each |
| `proofs/<task>.json`, `proofs/history/<task>.*`, `proofs/runs/<task>/**`, `proofs/impl/<task>.*`, `proofs/merge/<task>.*` | `proof verdict` of the task's executor's verifiers | disjoint by task |
| `fix/**` | A (`fix`) | single writer |
| `answers/<key>.md` | `answers ingest` of the task's or decision's executor | disjoint by key |
| `decisions.md` | both, appends only, id ranges disjoint | `merge=union` |
| `events.jsonl` | both, appends only; every line carries `executor` and `seq` | `merge=union` |
| `waves/Wnn.*`, `reports/Wnn.fr.md` | the executor of the wave; A uses `W01`-`W499`, B uses `W500`-`W999` (`wave.next_wave_id`) | disjoint by id |
| `briefs/<task>.*` | the task's executor | disjoint by task |
| `frontend/**` | FE task agents of the frontend executor (TD-V4) | single writer |
| `completion-check.mjs`, `EXECUTION.md`, `harden-profile.draft.json` | A only | single writer |

Any other path written by both is a contract violation: `sync` stops with E_STATE_CONFLICT (2.4).

### 2.3 Commit and push cadence (`exec.py sync`, CLI.md)
`sync` (lock `git-state`, and `state` for steps 2-3) does, in order:
1. **Fetch.** `git fetch origin`, without the state lock (agents keep appending events and writing receipts).
2. **Commit own changes**, holding the `state` lock so nothing is written meanwhile. `git add -- <the own paths of 2.2
   that changed>` (explicit pathspecs, never `-A` or `.`); the secret scan of the staged diff with its positive
   control (a hit: exit 4 E_SECRET_IN_STATE, the file moved to `local/quarantine/`, a decision proposed); then `git
   commit -F <message file>` with `chore(state): <executor> <yyyymmddThhmmssZ> <summary>` (summary = the event types
   since the last sync, e.g. `wave W03 ingested, 3 done`), no trailer. Nothing to commit: skip.
3. **Rebase**, still under the state lock: `git rebase origin/main` (local and fast). `events.jsonl` and `decisions.md`
   merge by union; any other conflict aborts the rebase (`git rebase --abort`) and stops with E_STATE_CONFLICT (exit
   1), a `STUCK` reason and a `resources` decision naming the file (two writers touched one file: a contract
   violation, never resolved by picking a side). The state lock is released.
4. **Re-validate.** If `plan.json` changed: `validate --with-status` on the merged tree plus the P-26 chain. Invalid →
   E_PLAN_INVALID / E_PLAN_TAMPERED: launching stops (no `wave emit` until resolved), a decision is proposed, the rest of
   the tick (ingest, reports) continues. Valid → the plan version and digest are recorded in local state; tasks of
   this executor affected by the new version are reconciled (TD-R1..R4).
5. **Push.** The private-remote check, then `git push origin HEAD:main` (never `--force`, never a `+refspec`); a
   non-fast-forward rejection loops to step 1 (at most 3 times, then exit 1 E_CAS_REJECTED and retry at the next tick).

When it runs (orchestrator tick, references/tick.md): `sync --pull-only` first thing in every tick (before
`status`), `sync --push-only` right after every `wave launched` (the other orchestrator sees in-flight tasks within
minutes, TD-A3), and `sync` (full) after every command batch that changed shared files: `wave ingest`, `answers
ingest`, `decision propose|resolve`, `manual post`, `report`, and before ending the turn. `amend` runs its own
fetch/commit/push (section 4) and does not wait for `sync`.

### 2.4 Union merges and ordering
Readers sort events by `(ts, executor, seq)` and drop duplicate ids (SCHEMAS.md 8); order on disk means nothing.
`decisions.md` blocks are read by header; a resolution block refers to its proposal by id, so interleaving is
harmless. No transition depends on comparing timestamps across executors (the done check rests on receipts and git
ancestry). The two places where a machine's clock matters are bounded: the push freeze is enforced against each
machine's own clock, so preflight PF-26 fails above 60 s of skew against an HTTPS `Date` header; and B's liveness is
measured on A's clock from the remote's commit dates (8.4), never from B's event timestamps.

---

## 3. Status: `status/A.json` and `status/B.json`

- A task id appears in exactly one status file: its executor's (status.schema.json). Each file is written only by its
  executor's exec.py commands (SCHEMAS.md 5.1); the other side only reads it after `sync --pull-only`.
- `statusio.state_of(task)` reads the executor's file; a task absent from it is `planned`.
- `seq` increases on every write; a reader that cached an older `seq` re-reads.
- **TD-R1 (supersession seen through sync).** When a pulled amendment supersedes one of my tasks, my next `status`
  applies `any non-terminal → superseded` with evidence `amendment:<plan_version>:<decision>`, even though the
  amendment was run by the other executor (the transition is mine to write; the evidence is the plan's amendment
  record).
- **TD-R2 (reassignment out).** When a pulled amendment moves one of my tasks to the other executor (allowed only in
  the states of TD-A3), my next `status` appends a `task.status` event `{task, from: <current>, to: planned, evidence:
  ["reassigned:<decision>", "to:<executor>"]}` and removes the entry from my file. The new executor starts it at
  `planned` and reads `attempts` and `reruns` from those events, so a reassignment never resets the retry budget.
- **TD-R3 (proof changed).** A pulled amendment that changed a task's proof voids receipts with the old `proof_hash`
  (SCHEMAS.md 4.3 condition 3): `done` stays done (terminal), but a task not yet done needs a new verification.
- **TD-R4 (plan version skew in a running wave).** A wave emitted under plan version n keeps running after version n+1
  lands; `wave ingest` records its results and applies only transitions whose evidence holds under the current plan
  (a task superseded meanwhile goes to superseded; its landed commit stays on main and is orphan work: reported in the
  wave report's "Ouvert" **and** raised as an owner decision, `keep-and-verify` (a verifier task is added by
  amendment) or `revert` (an EX-FIX-REVERT task), TD-A6).

---

## 4. Plan amendments through git (compare-and-set)

### 4.1 Procedure (`exec.py amend`, CLI.md)
1. A decision of an amendable kind is resolved by the owner (owner-only kinds by `--by devA`).
2. `amend --decision D --patch P` locks `plan` and `git-state`; pushes its own pending state commits first (it refuses
   while an unpushed non-amend commit remains: those hold status transitions, events, answers and receipts the other
   machine needs); `git fetch origin`; fast-forward (or `pull --rebase`) the state repo to origin/main; applies the
   patch to the **fresh** plan.json; runs `validate --with-status` with **both** status files as fetched and TD-A1..A6;
   bumps `plan_version`; appends the amendment record (digests before/after); regenerates the feature catalogue (and
   `gates.json` when patched) into the same commit; commits `chore(plan): amend v<n> (<decision>)` from a file; `git
   push origin HEAD:main`.
3. A non-fast-forward rejection is the CAS failure: `git reset --keep HEAD~1` drops **only the amend commit just
   made** (its id is known; never a reset to origin, which would also discard state commits whose push had failed),
   then `git pull --rebase origin main`, re-apply the patch to the new plan, re-validate, retry; at most 3 attempts,
   then exit 1 E_CAS_REJECTED with the state repo untouched locally [notion V-F28].
4. After a successful push the other orchestrator sees the amendment at its next `sync --pull-only` and re-validates
   (2.3 step 3) — git can auto-merge semantically conflicting plan edits, so the merged plan is always re-validated.

### 4.2 Amendment rules for two executors (TD-A1..TD-A5)
| id | rule | code |
|---|---|---|
| TD-A1 | New task ids are allocated above the current maximum **of the fetched plan** at each attempt, so two concurrent amendments never mint the same id (the loser re-applies with new ids). | E_RENUMBER |
| TD-A2 | A patch may change tasks of either executor (the owner decides), but `reassign` must name both the new `executor` and the new `owner` consistent with TD-V6. | E_OWNER |
| TD-A3 | A patch may not supersede, reassign, or change `writes`, `resources` or `proof` of a task that either status file shows `running`, `built` or `verifying`: an in-flight task is amended only after its wave is ingested. | E_AMEND_IN_FLIGHT (exit 4) |
| TD-A4 | A cross-executor dependency added by a patch must not create an ordering that the other executor's in-flight wave already violates (the dependent must be `planned` or `ready` in its executor's file). | E_AMEND_IN_FLIGHT |
| TD-A5 | The amendment record's `by` is the executor that pushed it; `decision` is a decision of either range. | — |
| TD-A6 | A patch changes, supersedes or reassigns only tasks whose executor is the amending orchestrator: its own live status file is the only one that cannot lag (the other's is as old as its last push). A change to the other executor's tasks is a second amendment pushed by that executor, after its own TD-A3 check. One exception: the owner-decided reassignment of a silent executor's tasks (8.4, C15/C20), allowed only for tasks that executor's newest pushed status shows `planned` or `ready`, and only when its newest state commit on the remote is older than the liveness threshold. Work that executor nevertheless landed for a reassigned or superseded task is never just a report line: `wave ingest` and `status` raise a decision (`keep-and-verify` or `revert`, owner-only). | E_AMEND_IN_FLIGHT |

---

## 5. Cross-developer dependencies: receipts on origin/main

A task of executor B that depends on a task of executor A becomes `ready` (SCHEMAS.md 4.2, planned → ready) only when,
after `sync --pull-only` and `git fetch` of the product repo:
1. `status/A.json` shows the dependency `done`;
2. `proofs/<dep>.json` (pulled) passes the full done check of SCHEMAS.md 4.3 in its **cross-executor profile**, re-run
   by B's exec.py on the tracked copies A's `proof verdict` committed with the receipt (`proofs/runs/`, `proofs/impl/`,
   `proofs/merge/`; A's machine-local `local/` never leaves A): verdict pass, receipt sha equal to the landed SHA of
   the tracked merge receipt, `git merge-base --is-ancestor <sha> origin/main` in B's product clone, proof hash equal
   to the current plan's, the cited run's copy agreeing with the verdict, verifier `execution-verifier` with an agent
   id different from the implementer's, the negative control's copy when one is required;
3. for a manual or decision dependency: the answer file or the resolution block is present and verified.
A Notion checkbox, a message from dev B, or a status line without its receipt never satisfies a dependency [par rec
13]. B's `schedule` lists cross-executor waits in its data (`waiting_on_other: [{task, dep, executor}]`), and B's
report shows them under "Ouvert".

---

## 6. Human input with two developers

- Pushes go to each developer's own phone: each orchestrator calls PushNotification in its own session (Remote
  Control connected). Owner decisions are posted only by A (TD-V5).
- Dev B's manual tasks (executor B) are posted by B to dev B; dev B answers by Remote Control to B's session or in
  his Notion rows.
- An answer arriving in the wrong session (dev A answers B's decision to A's orchestrator) is not ingested as an
  answer there, and A never writes B's Notion rows. A's orchestrator tells the owner (in French) that the item belongs
  to orchestrator B, and records the text with `answers ingest --key <key>-relay-A --text-file F --source terminal
  --scope-change`, which stores it and unblocks nothing; B's orchestrator reads it after `sync` and asks its own dev to
  confirm through its own channel. The flag is `answers ingest --relay` (CLI.md): stored as `<key>-relay-<executor>`,
an `answer.relayed` event, nothing unblocked, no proposal.

---

## 7. Notion with two developers

- Dev B must be a workspace **member** (guests are refused by the hosted Notion MCP at OAuth), so the workspace must
  be on a paid plan: a Free workspace with two members is capped at 1,000 blocks counted since signup, then refuses new
  rows after a 3-day grace [notion V-F22, V-F23]. Checked by `EX-DEVB-CHECK` (8.3) and at rehearsal R-N6.
- Write partition (NOTION.md 5.3): A's orchestrator writes rows with `Orchestrateur = A`, decisions D-001..D-499, its
  own Waves rows and the A "Now" block; B likewise for B. A creates the hub skeleton, both databases and the views;
  B's orchestrator reads their ids from the shared `profile.json`.
- Both read the same `À ingérer` view and process only their own rows. Relations hold same-executor dependencies only;
  `Dépend de (clés)` shows every dependency.
- Dev B's connector may have another tool prefix (`mcp__notion__*`, `mcp__plugin_Notion_notion__*`): ops name the
  tool by suffix, and agent definitions deny every prefix by suffix.

---

## 8. Dev B's setup: a plan task with a proof

### 8.1 `execution:EX-DEVB-SETUP` (manual, phase ops, owner devB, executor A)
Released at plan approval; latest start = the first B task's latest start minus 60 min; where `laptop`.
Steps (plan text; the Notion row shows them in the French frame of NOTION.md 2.4):
1. Install Claude Code at the version dev A runs (≥ 2.1.286; `claude --version`), set `DISABLE_AUTOUPDATER=1` as a
   user environment variable, and log in with your claude.ai account.
2. Install Python ≥ 3.11 (as `python`), Node ≥ 20, pnpm 10, git, and `gh`; run `gh auth login`.
3. Copy the four skill folders dev A sends you into `~/.claude/skills/` (`execution`, `frontend`, `harden`,
   `hackathon`), and the global guard into `~/.claude/hooks/` (`guard.py`, `py.sh`) with its settings entry; dev A's
   archive includes the exact `settings.json` snippet.
4. Accept the GitHub invitations to the product repo and the private state repo.
5. Accept the Notion workspace invitation as a member (not a guest), then connect the Notion connector in claude.ai.
6. In a terminal: `git clone <product repo url>`, `cd` into it, then
   `python ~/.claude/skills/execution/scripts/exec.py init --project <slug> --executor B --state-remote <state repo url>`
   and `python ~/.claude/skills/execution/scripts/exec.py agents install`.
7. Start the launcher from the repo root (`~/.claude/skills/execution/assets/launcher/launch-exec.ps1` or `.sh`) and
   type `/execution`. Your orchestrator installs its agents and hooks, binds them (canary), runs `preflight --for
   event`, checks Notion, and pushes the state repo.
8. Reply « prêt » with the state repo commit SHA your orchestrator printed after its first `sync`.
`bring_back`: `[{key: "<id>-ready", kind: "sha", description: "state repo commit after B's first sync", verify:
{method: "regex", spec: "^[0-9a-f]{40}$"}}]`. Proof: `human-attest` (`attest`: "dev B ran the steps and his
orchestrator pushed"). The mechanical proof is the next task.

`init --executor B` also sets, in dev B's product clone, `core.longpaths=true` and `core.hooksPath=.githooks` when the
bootstrap's portable commit-msg hook exists (git config is not cloned), so dev B's own commits are refused when they
carry an AI trailer [past F35].

### 8.2 What B's orchestrator does on its first run (references/two-dev.md, B10)
`agents status` (if not current: `agents install`, then restart through `launch-exec.ps1 -Resume`) → `hooks install`
and a background `sleep 5` → next turn `hooks canary --nonce N` → `preflight --for event` (re-run with `--confirm` for
the checks verified by hand) → `notion diff --init` (stage 1 only: token check of its own connection on the hub) →
`sync`. Each step appends an event with `executor: "B"`, pushed by `sync`. (Agents are installed before the hooks are
bound, so the restart never meets a bound marker; a later restart is always `-Resume`, which keeps the session id.)

### 8.3 `execution:EX-DEVB-CHECK` (gate, phase verify, agent, executor A)
Depends on `EX-DEVB-SETUP`. Proof (`proof_author: template`), run by A's verifier from a clean product checkout after
A's `sync --pull-only` brought B's events:
```
python C:/Users/Utilisateur/.claude/skills/execution/assets/checks/devb_setup_check.py --state "{state_dir}" --executor B --require-notion {notion_member} --json
```
`expect.exit_code: 0`. The checker (stdlib, owned by B02, `assets/checks/devb_setup_check.py`) reads `events.jsonl` and passes
only when all of these lines exist from `executor: "B"`, newest per type, all after the EX-DEVB-SETUP answer's
`received_utc` minus 24 h:
- `type: preflight`, `data.for == "event"`, `data.ok == true`, `data.failed == 0`, `data.open == []` (a skipped check
  is open unless confirmed: PF-01 version, PF-02 updater off, PF-07 toolchain, PF-12 agents current, PF-13/14/15 the
  other skills present, PF-20 bypass, PF-21 global guard and repo commit-msg hook, PF-25 private state remote);
- `type: hooks.canary`, `data.bound == true`;
- when `--require-notion true`: `type: notion.ack`, `data.purpose == "token-check"`, `data.ok == true`.
Output `{ok, checks: [{id, state, detail}]}`; exit 0 iff every check ok. Negative control (kind `forgery`): the same
command against a forged state copy whose B preflight line has `"ok": false` and a non-empty `open` must exit 1.
The `preflight`, `hooks.canary` and `notion.ack` event data shapes are fixed in event.schema.json.

### 8.4 B's lifecycle
- **Start**: after EX-DEVB-CHECK is done, B's tasks become ready by their own dependencies (TD-V9).
- **Run**: B ticks like A on its own share. A's `due` watches B's liveness on A's clock: the age of the newest state
  commit by executor B on the remote (its committer date as fetched, `sync` data `other_executor_last_commit_utc`)
  above `2 × heartbeat.every_min + 30` minutes (70 min for a 20-minute heartbeat: crons fire up to 30 min late) while
  `status/B.json` has a task `running` or `ready` → A's report shows `orchestrateur B silencieux depuis <durée>` and A
  proposes a decision (owner-only, kind `amendment`): options `wait` and `reassign` (move B's not-in-flight tasks to
  A, TD-A6's exception; in-flight ones after B's wave is ingested or abandoned by B's `resume`).
- **End of B's share**: when every task of executor B is terminal, B's `status` derives `BUILD_COMPLETE` for B's local
  run state (local state is per machine), B posts its last Waves report and "Now" block (`Part de B terminée`), runs
  `sync`, keeps the heartbeat (an amendment may give it new tasks) and stops launching. A new task assigned to B by an
  amendment brings B back to RUNNING (`state.RUN_TRANSITIONS` holds `BUILD_COMPLETE → RUNNING` with reason
  `amendment:<version>`). A's `handover` event, seen through `sync`, lets B run `hooks uninstall` and end.
- Hand-over, harden-ready and `/harden` are A's only (1.3); dev B's machine never runs them.

---

## 9. Dev B without the setup (`setup: human-only`)

For an on-site recruit or a teammate who does not run Claude Code [origins F11]:
- B's work is modelled as **manual tasks** owned by devB, executor A (P-07): `kind manual`, phase `manual` (or `ops`),
  with `manual.where`, `latest_start_utc` inside B's availability windows, and `human:devB` as a resource.
- Code written by hand: B works on a branch `devb/<task>` of the product repo (never on main), with the repo's
  commit-msg hook installed by hand (`git config core.hooksPath .githooks`). The manual task's `bring_back` is
  `{key: "<id>-sha", kind: "sha", verify: {method: "regex", spec: "^[0-9a-f]{40}$"}}` plus the branch name (`kind:
  text`, `owner-attest`).
- The manual task is followed by an **integration task** (template `execution:EX-DEVB-INTEGRATE`, kind code, owner
  agent, executor A, in a lane of executor A whose globs are B's area): its implementer fetches `devb/<task>`, checks
  that the reported SHA is the branch head, rebases B's commits onto origin/main inside its lane, keeps B's
  authorship, runs `exec.py merge --task <integration task>` (all scans and gates apply: trailers, never-show, secrets,
  writes scope), and its proof is the requirement's proof. A verifier re-runs it on the landed SHA like any task.
- Notion: B's tasks are A's rows (`Orchestrateur = A`, `Responsable = Dev B`); dev B answers in his rows if he is a
  workspace member, else to dev A by voice or message, and dev A relays through `answers ingest --source terminal
  --by devB`.
- No EX-DEVB-SETUP / EX-DEVB-CHECK (TD-V9 applies only to `setup: full`).

---

## 10. The product repo with two orchestrators

- Both machines merge into the same `origin/main` through `exec.py merge` (lock per machine). Cross-machine
  concurrency is resolved by git: a push rejected as non-fast-forward sends merge back to its step 1 (fetch, rebase,
  gates on the exact rebased tree, push), at most 3 times (CLI.md merge) [par rec 8].
- Lanes are disjoint by executor (P-08), so the two machines never write the same files; a rebase conflict across
  executors therefore means a glob was wrong: the task goes back to its lane, then BLOCKED and proposed (TD-A rules
  decide the fix).
- The manifest and lockfile are A's (TD-V2); B's need for a dependency becomes a decision and an A task.
- Machine resources (`browser`, `disk-heavy`, `port:*`) are per machine; ordered resources (`wallet:*`, `db:*`) are
  global and serialized by dependency paths (TD-V8).

---

## 11. Conflict cases and their handling

| # | case | detection | handling |
|---|---|---|---|
| C1 | Both orchestrators push the state repo at once | push rejected non-ff | `sync` pulls (union merges), re-validates, pushes; ≤ 3 loops per tick |
| C2 | Both amend at once | `amend` push rejected | loser drops only its amend commit (`reset --keep HEAD~1`), pulls with rebase, re-applies with ids above the new maximum (TD-A1), re-validates, pushes; E_CAS_REJECTED after 3 |
| C3 | Same non-union state file changed on both sides | rebase conflict outside `events.jsonl`/`decisions.md` | rebase aborted, E_STATE_CONFLICT, STUCK, `resources` decision; never auto-resolved (a contract violation to fix) |
| C4 | An amendment supersedes or reassigns a task the other side is running | TD-A3 at amend time | refused (E_AMEND_IN_FLIGHT); re-proposed after that wave's ingest |
| C5 | A pulled amendment changes a task of a launched wave | TD-R4 at ingest | results kept, transitions applied under the current plan; superseded work reported as orphan |
| C6 | A pulled plan fails validation | `sync` step 3 | launching stops on that machine, decision proposed, ticks continue |
| C7 | Both machines merge product commits at once | product push rejected non-ff | `merge` refetches, rebases, re-gates, re-pushes (≤ 3) |
| C8 | Cross-executor rebase conflict in the product repo | `merge` conflict on files of another lane | task back to lane, then BLOCKED; owner decides (glob error) |
| C9 | B depends on an A task that A marked done | B's own done check (section 5) | ready only if the receipt passes the full check in B's clone; else B waits and reports `en attente de A` |
| C10 | A receipt in status but missing from the pulled state repo (A did not sync yet) | B's done check fails on the missing file | B waits; never trusts the status line alone |
| C11 | Decision id collision | impossible (disjoint ranges); `decisionsio.read_blocks` rejects a duplicate proposal id | E_STATE_INVALID, STUCK |
| C12 | Wave id collision | impossible (A W01-W499, B W500-W999) | `wave emit` refuses an id outside its range (E_USAGE) |
| C13 | Owner answers a decision in the wrong orchestrator's session | the decision id is in the other range | stored as a relay answer (section 6), unblocks nothing; the right orchestrator confirms |
| C14 | A human edits an orchestrator-owned Notion field | hash divergence on fetch (NOTION.md 5.2) | row held, decision proposed; never silently overwritten |
| C15 | Dev B's orchestrator goes silent | A's `due`: no state commit by B on the remote for `2 × every_min + 30` min (A's clock) with B work open | report line + owner decision `wait` / `reassign` (8.4, TD-A6) |
| C16 | Dev B's Notion token rejected | B's ack auth failures | B's outbox; push to dev B asking `/login`; A unaffected |
| C17 | Clock skew between machines | preflight PF-26 (HTTPS `Date` header, 60 s) | events sorted for display only; done rests on receipts and git ancestry; liveness uses A's clock and the remote's commit dates; the push freeze, enforced per machine, is protected by PF-26 |
| C18 | Both write `frontend/**` | TD-V4 at validate; `sync` C3 otherwise | prevented at planning |
| C19 | Dev B's commit carries an AI trailer or a never-show hit | `merge` scans (policy refusal, exit 4) | nothing lands; the attempt fails and the next attempt's brief carries the scan's entry id and file:line (never the matched text) |
| C20 | Dev B leaves mid-event | C15 path, owner chooses `reassign` | amendment moves B's tasks to A; B's lanes get executor A in the same amendment |

---

## 12. Contract questions raised by this file

All settled in revision 2 (README.md 10): `assets/checks/devb_setup_check.py` and the templates `EX-DEVB-CHECK`
(gate/verify) and `EX-DEVB-INTEGRATE` (code/build) are B02's (LANES.md, SCHEMAS.md 3.1); the `preflight`,
`hooks.canary` and `notion.ack` event data shapes are fixed in event.schema.json; E_AMEND_IN_FLIGHT exists (README.md
6); `BUILD_COMPLETE → RUNNING` is in `state.RUN_TRANSITIONS`; `answers ingest --relay` replaces the `--scope-change`
workaround; CLI.md `sync` states its commit step; the wave id ranges are in CLI.md `wave emit`.

## 13. Tests

`test_e2e_two_dev.py` (B11, `EXEC_SLOW=1`): two temp clones A and B of one bare state remote and one bare product
remote; disjoint lanes; a B task depending on an A task becomes ready only after A's receipt is pulled and its SHA is on
origin/main (positive control: the same status line without the receipt keeps it planned); `sync` union-merges
events and decisions from both; a deliberate write of `status/A.json` by B fails `sync` with E_STATE_CONFLICT;
concurrent amends: one wins, the other lands version n+2 with ids above the new maximum; TD-A3 refuses an amendment of
an in-flight task; reassignment carries attempts through events; the dev B setup checker passes on a real B preflight
line and fails on the forged one; a B task whose dependency is an A task becomes ready on B from the pulled receipt
and its tracked copies alone (A's `local/` is absent from B's clone; positive control: the same receipt without its
`proofs/runs/` copy keeps it planned); an unpushed status commit survives a lost amend CAS (`reset --keep HEAD~1`);
`sync` interleaved with a `proof verdict` in another process neither fails nor loses an event line; A amending a
B-owned in-flight task is refused (TD-A6). `test_validate.py` (B02) adds one ok and one bad fixture per TD-V rule.
