# SCHEMAS.md — what JSON Schema cannot say

Companion to `assets/schemas/*.schema.json`. A document is valid only when it passes its schema AND every invariant of
this file that applies to it. `exec.py validate` checks the plan invariants (section 2); the other invariants are
checked by the command that writes the document (section 5 names it). Codes in brackets are the error codes the
checker emits (`E_*` fails, `W_*` warns; full list in README.md section 7).

Contents: 1 documents and digests · 2 plan invariants · 3 phase/kind/owner matrices · 4 task status · 5 who writes
what · 6 task templates and instantiation · 7 writes, lanes and resources · 8 the other documents · 9 schema index.

---

## 1. Documents, encodings, digests

### 1.1 Where each document lives

| document | path (state dir = `<repo>/.execution/`, its own private git repo) | schema | tracked in state repo |
|---|---|---|---|
| plan | `plan.json` | plan | yes |
| planner draft | `local/planner/plan.draft.json` | plan-draft | no |
| status | `status/A.json`, `status/B.json` | status | yes |
| profile, policy | `profile.json`, `policy.json` | profile, policy | yes |
| feature catalogue | `profile.paths.feature_catalogue` (default `feature-catalogue.json`) | feature-catalogue | yes |
| never-show | `profile.paths.never_show` (outside every repo) | never-show | no (owner's file) |
| proof receipts | `proofs/<task>.json`, `proofs/history/<task>.a<n>.json` | proof-receipt | yes |
| tracked evidence copies (for the other executor's done check, 4.3) | `proofs/runs/<task>/<run_id>.json` (run.json without output.log), `proofs/impl/<task>.a<n>.json` (the implementer result, when one exists), `proofs/merge/<task>.a<n>.json` (the landed merge receipt) — written by `proof verdict` in the same state change as the receipt | proof-run / result-implementer / merge-receipt | yes |
| proof runs | `local/proof-runs/<task>/<run_id>/run.json` (+ `config.json`, `gates/`, `output.log`) | proof-run | no |
| agent results | `local/results/<wave>/<task>.<role>.a<attempt>.json` | result-* / merge-receipt | no |
| merge intents | `local/merge-pending/<task>.a<n>r<k>.json` `{head_sha, origin_before, started_utc}`, written before `git push`, removed when the receipt is written | — | no |
| agent inboxes | `local/inbox/<wave>/` (agents Write here, `result put` moves) | — | no |
| fix mode | `fix/<item slug>.md` (item briefs) tracked; `local/fix/<report sha8>.{items,options}.json` local | — | yes / no |
| /frontend gate reports | `frontend/gates/**` (frontend-check always writes `<state>/gates/<UTC>.json`; unique names, machine-local) | /frontend's | no (`.gitignore`) |
| events | `events.jsonl` | event (one per line) | yes, `merge=union` |
| decisions | `decisions.md` | decision (header of each block) | yes, `merge=union` |
| proven-public values | `public-values.jsonl`: one canonical JSON line per value proven public on chain, `{value, kind: "evm-tx-hash" \| "tx-hash", chain, network, proven: "chain-reread" \| "tx-proof", source, at_utc, executor}` (README.md 8, owner decision 2026-10-02) | — | yes, `merge=union` |
| answers | `answers/<key>.md` | answer (fenced header) | yes |
| waves | `waves/Wnn.js`, `waves/Wnn.json` | wave-manifest | yes |
| briefs | `briefs/<task>.a<attempt>.md` | — (template-rendered Markdown) | yes |
| completion check | `completion-check.mjs` | output: completion-gates | yes |
| merge gate config | `gates.json` (harden gates.py config format) | harden's config | yes |
| local cache | `local/state.json`, `local/active`, `local/hooks-state.json`, `local/hook-events/<utc compact>-<pid>-<n>.json` (one file per hook event, created with O_EXCL; imported and deleted by `status`), `local/schedule.json` (schedule's data), `local/digest.txt` (status digest text), `local/probe/` (agents probe), `local/import.json` (pre-T0 import) | local-state (+ `$defs`); schedule data = CLI.md `schedule` | no |
| Notion batches and local files | `local/notion/batches/<batch_id>.json`, `local/notion/outbox.jsonl`, `local/notion/{ids.json, access.json, rate.json, poll.json, queue.jsonl, divergence.json, degraded.json, hub-now.txt, results/}` (NOTION.md 6-11) | notion-ops (batches); the others NOTION.md | no |
| reports | `reports/Wnn.fr.md`, `EXECUTION.md` | — | yes |

The state repo's own files, written once by `exec.py init`: `.gitattributes` = `* text=auto eol=lf`,
`events.jsonl merge=union`, `decisions.md merge=union`, `public-values.jsonl merge=union`; `.gitignore` = `local/`
and `frontend/gates/`. The product
repo excludes `.execution/`, `.claude/settings.local.json` and `.claude/worktrees/` through `.git/info/exclude`
(never `.gitignore`, which is judge-visible).

### 1.2 Encoding
UTF-8 without BOM, LF only, a final newline. JSON files are written by `execlib.jsonio.write_json_atomic`: 2-space
indent, keys in schema order for human-edited documents (profile, policy) and **sorted keys** for every
machine document (plan, status, receipts, manifests, state), so that the same content gives the same bytes.
`events.jsonl` lines are canonical JSON (1.4) followed by `\n`.

### 1.3 Time
Every stored instant is UTC `YYYY-MM-DDTHH:MM:SSZ` (`utc` in common.schema.json); events may carry microseconds
(`utc_precise`). Local wall-clock time is never stored. Display strings (`Wed 7 Oct 23:59 SGT`) are rendered on the
fly by `execlib.clock.display()` from `profile.event.display_zones`; when `zoneinfo` has no tz database (a
stdlib-only machine without `tzdata`), the zone's `fallback_utc_offset_min` is used and `W_TZ_FALLBACK` is emitted.
Anchors and deadlines are always computed in UTC; crons are never used as deadline alarms.

### 1.4 Canonical JSON and digests
- `canonical(obj)` = `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")`.
- `plan_digest(plan)` = sha256 of `canonical(plan)` after removing the keys `approved`, `amendments`, `updated_utc`
  and `plan_version`. It is what the owner approved (`approved.plan_sha256`) and what amendments chain
  (`plan_sha256_before` / `plan_sha256_after`).
- `proof_digest(task)` = sha256 of `canonical(task.proof)` with `negative_control.recorded` removed (recording the
  control must not change the proof's identity). Receipts and proof runs carry it as `proof_hash`.
- `dedup` of a decision = sha256 of `canonical([kind, title, sorted(tasks)])`.
- A file's `sha256` is over its exact bytes.

---

## 2. Plan invariants (checked by `exec.py validate`, run by `plan instantiate` and `amend`)

| id | invariant | code |
|---|---|---|
| P-01 | Task ids match `T\d{3,}`, are unique, and the `tasks` array is sorted by numeric id. | E_TASK_ID |
| P-02 | Every `depends_on` id exists and is numerically lower than the task's own id. The graph is therefore acyclic by construction; a dependency on a higher id is refused even if no cycle results. | E_DEP_ORDER |
| P-03 | Ids are never renumbered or reused. Across plan versions a task id keeps its identity; `amend` never deletes a task (it supersedes it) and only appends ids greater than the current maximum. | E_RENUMBER |
| P-04 | Every `covers` id exists in `requirements`; every requirement is covered by at least one task that is not cut or superseded; a requirement with `required: true` and `surface` other than `none` is covered by at least one task of kind code, test, infra, deploy, tx or gate. | E_UNCOVERED |
| P-05 | Requirement ids are unique. `feature_group` references exist. A `surface: ui` requirement has a group (schema) and that group has at least one ui requirement. A per-group template instance has `params.group` equal to its `feature_group`. | E_GROUP |
| P-06 | Phase and kind follow matrix 3.1. | E_PHASE_KIND |
| P-07 | Owner, executor and team follow 3.2: every executor used by a task has a dev in `profile.team.devs` with that executor; `owner: agent` tasks run on an executor whose dev has `setup: full`; tasks owned by a `human-only` dev are manual or decision tasks executed by A. | E_OWNER |
| P-08 | Lanes: ids unique; exactly one lane has `contract: true`; globs of different lanes are pairwise disjoint (7.1); for kinds code, test and infra every write glob is contained in the task's lane (7.2) and `task.executor == lane.executor`. | E_LANE |
| P-09 | Two tasks that are not cut or superseded and are not joined by a path in the transitive closure of `depends_on` have disjoint write sets (7.1). | E_WRITE_OVERLAP |
| P-10 | Two such tasks share no **ordered** resource: `manifest`, `wallet:*`, `db:*`. **Serialized** resources (`browser`, `disk-heavy`, `port:*`, `human:*`) may be shared: the dispatcher never runs two holders at once (owner-confirmed 2026-10-01). A write glob matching a manifest file (7.3) requires the `manifest` resource. | E_RESOURCE_OVERLAP, E_MANIFEST_UNDECLARED |
| P-11 | `p10_min <= p50_min <= p90_min`; `p50_min > 0` for agent tasks; agent tasks of kind code, test or infra have `p90_min <= 60` (warning above 60, error above 120: split the task). | E_ESTIMATE, W_TASK_TOO_BIG |
| P-12 | Proof type fits the kind (matrix 3.3). Command proofs have `expect.exit_code`; `max_runtime_min` above 5 warns (sizing rule S3). Template-instantiated tasks have `proof_author: template`; code, test and infra tasks never have `proof_author` planner or owner (schema). No proof spec, gate command or `gates.json` command contains `--allow-skip` (frontend-check's flag that counts a skipped gate as ok: skipped is open). | E_PROOF_KIND, W_PROOF_SLOW |
| P-13 | Negative controls: code and test tasks use `pre-implementation` or `planted-defect`; gate tasks and any checker task (a task whose deliverable is a checker) use `forgery` or `planted-defect`; tx tasks use `forgery`; `not-applicable` is allowed only for kinds research, manual, decision, watch and for deploy with a url proof, always with `waived_reason`. | E_NEGATIVE_CONTROL |
| P-14 | Manual and decision tasks: `latest_start_utc <= deadline_utc` when both are set; when the owner's `availability` is non-empty, `latest_start_utc` falls in an `awake` window (warning otherwise); decision tasks have at least two `options` or a non-null `options_source`; `push_text`, when present, names the task id. | E_MANUAL, W_OUTSIDE_AVAILABILITY |
| P-15 | `release_utc <= deadline_utc`; anchors refer to an existing deadline id, task id or event field; an anchored task has no fixed `release_utc` (the anchor computes it). | E_TIME |
| P-16 | Prework: when `profile.prework.code` is false and `until_utc` is set, every task of kind code, test, infra, deploy or tx, and every template task with `prework_class` design or code, has `release_utc >= until_utc`; the product-repo bootstrap task (`execution:EX-BOOT`) is released at or after `until_utc`. Same rule for designs with `prework.designs` (or `frontend.prework_designs` when it overrides). | E_PREWORK |
| P-17 | Deliverables wait for build, harden and fix, in that order (owner rule: build → harden → fix → record → ship). A plan with any deliverable-phase task holds `execution:EX-HARDEN-REVIEW` and at least one non-superseded `execution:EX-FIX-GATE`. Every non-superseded task of phase deliverable (FE-21 included) has as ancestors the build-complete gate task (P-18), `EX-HARDEN-REVIEW` and the newest non-superseded `EX-FIX-GATE`; every recording, flip and tag task also has `frontend:FE-21` as an ancestor when FE-21 exists; `EX-DLV-PROSE` has every recording task as an ancestor; the README-screenshots task has as ancestors every deliverable task except submit, flip and tag (so `EX-DLV-PROSE` too). | E_DELIVERABLE_ORDER |
| P-18 | Exactly one build-complete gate task: template `execution:EX-GATE-BUILD`, kind gate, phase verify, proof `node <state>/completion-check.mjs --json --phase build` with `install: true` (the gates.json install step runs in the verifier's clean clone first, so the `FRONTEND.build` gate can build), whose `HARDEN.ready` gate requires the orchestrator's latest `exec.py harden-ready` report for HEAD to be ok (profile `pre-harden`, or `after-harden` once EX-HARDEN-REVIEW is done, CLI.md `harden-ready`); every required task of phases setup, contract, build, integrate and verify is its ancestor. | E_BUILD_GATE |
| P-19 | No task of kind code, test, infra or deploy has `release_utc` at or after `policy.git.push_freeze_utc`; the tag task's deadline is at or before it. | E_PUSH_FREEZE |
| P-20 | Protected globs: implementer tasks (kinds code and infra) never write a glob intersecting `plan.protected`; only test tasks whose `proof_author` is test-designer, and contract-wave tasks, may. | E_PROTECTED |
| P-21 | `brief_refs` exist on this machine (warning at validate, error at wave emit). | W_BRIEF_REF_MISSING, E_BRIEF_REF_MISSING |
| P-22 | `max_attempts` is 1 to 3 (schema), default 2 (instantiate fills it). | — |
| P-23 | No generic UI: if any requirement has `surface: ui`, then `profile.frontend` exists and every ui requirement is covered by a `frontend:FE-1x` per-group task. If /frontend's template library, checker or fragments are missing, plan-time commands stop with E_DEPENDENCY_MISSING and a `dependency-missing` decision; there is no fallback template. | E_NO_FRONTEND, E_DEPENDENCY_MISSING |
| P-24 | Deadlines: ids are unique; when the profile has a submission deadline, a `DL-build-complete` deadline exists (inserted by `plan instantiate` from `schedule.build_complete_deadline`: submission minus the P80 of /harden, the fix wave, FE-21, recording, /prose, screenshots, submission steps and a buffer; `source: computed:schedule`; refreshed through `amend` when `schedule` reports it stale) and lies before the submission deadline. | E_DEADLINE |
| P-25 | `spec.validated_decision` is a resolved `spec-validation` decision whose `spec_sha256` equals `spec.sha256`, and the spec file still has that hash. | E_SPEC_UNVALIDATED |
| P-26 | Approval and amendment chain: once `approved` is set, `approved.plan_sha256` was `plan_digest` at approval; each amendment's `plan_sha256_before` equals the previous amendment's `after` (or the approved digest for the first); the last `after` equals the current `plan_digest`; `plan_version == 1 + len(amendments)`. Any other change to an approved plan is tampering. | E_PLAN_TAMPERED |
| P-27 | Every completion gate can be generated: each irrecoverable deadline has a task anchored to it (or a deliverable task due by it) for its `DL.<id>` gate; each requirement maps to exactly one `REQ.<id>` gate, phase build unless all its covering tasks are deliverable-phase. | E_GATES |

`validate --with-status` adds the runtime checks: P-04 coverage counts only tasks not cut or superseded in the
status files, and no status file names a task id absent from the plan (E_STATUS_ORPHAN).

---

## 3. Matrices

### 3.1 Phase × kind (P-06)

| kind | allowed phases |
|---|---|
| code | setup, contract, build, integrate, fix, deliverable (README screenshots, factual README pass) |
| test | setup, contract, build, verify, fix |
| infra | setup, contract, integrate, ops, fix, deliverable (tag) |
| deploy | integrate, ops, deliverable, fix |
| tx | build, integrate, ops, deliverable, fix |
| research | setup, recon, audit, build |
| manual | manual, ops, recon, deliverable |
| decision | decision |
| watch | ops, verify, recon |
| gate | build, verify, audit, deliverable, fix |

/frontend's templates as shipped (frontend.json, after the adapter of FRONTEND.md 2.3): FE-00 code/build, FE-01
manual/manual, FE-02 research/build, FE-03, FE-05, FE-07, FE-08, FE-09 and FE-1x code/build, FE-04 and FE-06
decision/decision, FE-20 gate/build, FE-21 manual/deliverable. The execution library's own placements: EX-APPROVE
and EX-NAME decision/decision; EX-BOOT, EX-CI infra/setup; EX-CONTRACT code or test/contract; EX-GATE-BUILD,
EX-REPLAY, EX-CONVERGE gate/verify; EX-HARDEN-PARK and EX-HARDEN-REVIEW manual/manual; EX-FREEZE-VALIDATOR
gate/verify (before /harden, so an ancestor of the build gate) and EX-FREEZE-RECORDING, EX-FREEZE-DOCS,
EX-FREEZE-PUSH-TAG gate/deliverable (a freeze is a check plus a policy flag); EX-HB-* research/recon, watch/ops or
manual/recon, and EX-HB-CLAIMS-VERIFY gate/verify (a verifier re-runs each claims-ledger row's evidence before FE-20
renders figures); EX-DLV-RECORD, -SLIDES, -DRIVE, -FORM, -FLIP, -PROSE manual/deliverable (EX-DLV-PROSE: the owner
types /prose on the README and docs, after the recording); EX-DLV-SCREENSHOTS code/deliverable; EX-DLV-TAG
infra/deliverable; EX-DEVB-SETUP manual/ops; EX-DEVB-CHECK gate/verify; EX-DEVB-INTEGRATE code/build; EX-FIX-SELECT
decision/decision; EX-FIX-CODE and EX-FIX-REVERT code/fix; EX-FIX-GATE gate/fix.

### 3.2 Owner × executor × kind (P-07)
- `owner: agent` ⇔ kind not in {manual, decision}; model and effort set (schema).
- `owner: devA | devB` ⇔ kind in {manual, decision}; model and effort null (schema).
- `executor` is the orchestrator that runs, posts and verifies the task. A task owned by a dev with
  `setup: human-only` is executed by A (A's orchestrator tracks it as manual and verifies the SHA dev B reports).
- Static ownership: an executor launches only its own tasks; reassignment is an amendment (decision kind
  `amendment`, op `amend`).

### 3.3 Proof type × kind (P-12)

| proof type | kinds |
|---|---|
| command | code, test, infra, gate, research, deploy, watch |
| tx | tx (and deploy of a contract, re-read on chain) |
| ci | infra, watch, gate |
| file | research, deliverable-phase tasks of any kind, manual, decision (FE-04, FE-06: `choices.json` checked with `json_checks`) |
| url | deploy, watch, deliverable-phase tasks |
| human-attest | manual, decision (schema) |

A file proof of a manual or decision task names an absolute file outside the product checkout (the state's
`frontend/choices.json`, the profile) and is evaluated by exec.py itself (`proof.check_file`), recorded as a proof run
with `by.role: orchestrator`, `checkout.kind: none` and `sha` = origin/main HEAD after a fetch (4.2).

A proof checker that reads ground truth (chain, CI API, parsed receipts) ships with a planted forgery that must fail
it (its negative control, kind `forgery`).

---

## 4. Task status

### 4.1 States
`planned` (not yet runnable) · `ready` (dependencies done, released, not cut) · `running` (an agent chain is
working on it in a launched wave; for manual and decision tasks: posted to the owner, awaiting the answer) · `built`
(landed on origin/main by merge) · `verifying` (a verifier's proof run of the landed SHA exists, no verdict yet) ·
`done` (terminal; section 4.3) · `failed` (an attempt failed; waits for a fix attempt) · `blocked-manual` /
`blocked-decision` (stopped by something outside the plan; a proposal exists) · `cut-proposed` · `cut` (terminal) ·
`superseded` (terminal; replaced by an amendment).

Dependents of an open manual task simply stay `planned`; `blocked-*` is only for a task that hit a wall itself.

### 4.2 Transition table
Only exec.py performs transitions, each recorded in the task's `history` and as a `task.status` event. "By" is the
subcommand; agents never run the commands marked (O) (orchestrator-only, denied by the PreToolUse guard, section 5.3).

| from | to | by | evidence required |
|---|---|---|---|
| planned | ready | `schedule`, `status` (O) | every dependency `done` (a cross-executor dependency: its receipt in the state repo with `sha` on origin/main), `release_utc` (or the anchor's computed instant) past, plan approved |
| ready | planned | `schedule`, `amend` (O) | a dependency left `done` through supersession, or the release moved later |
| planned | running (the `execution:EX-APPROVE` task only) | `plan instantiate --propose-approval` (O) | the approval proposal written and linked; the only task that runs before the plan is approved |
| ready | running | `wave emit` (O) | launch intent: the manifest lists the task and is written with status `launching` (emit is final: the orchestrator calls Workflow right after; CLI.md `wave emit`) |
| planned | running | `wave emit` (O) | an in-wave dependent: the manifest lists the task, every dependency is `done` or in its `deps_in_wave`, and the release is past |
| ready | running (manual, decision) | `manual post` (O) | push text written and the Notion row op queued |
| running | ready | `wave launched --error`, `wave ingest`, `status`, `resume` (O) | launch error; or the agent result missing or null (rerun: `reruns + 1`, `consecutive_reruns + 1`, attempts unchanged); or a `launching` wave resolved `abandoned` (no run, no inbox or result activity, CLI.md `resume` R5) |
| running | planned | `wave ingest` (O) | outcome `skipped-dep`: an in-wave dependency did not end done; no rerun counted |
| running | built | `wave ingest`, `status`, `proof verdict` | a merge receipt `outcome: landed` for (task, attempt) found in any wave's results (or its finalised intent, CLI.md `merge`), with `landed_sha` an ancestor of origin/main; the receipt is exec.py-written and outranks the implementer result, which may be missing (crash after the push) |
| running | failed | `wave ingest` (O) | implementer `status: failed`, or merge outcome conflict, gate-failed, scan-failed or push-rejected-exhausted (`attempts + 1`, `consecutive_reruns = 0`) |
| running | blocked-manual | `wave ingest` (O) | implementer `blocked.kind: manual`; a decision proposal (kind spec-gap or plan-task) is opened |
| running | blocked-decision | `wave ingest` (O) | implementer `blocked.kind: decision`; or outcome `infra-error` (an `agent()` call threw: unknown agent type, unsatisfiable schema, budget, scheduler; a `dependency-missing` decision quoting the logged error); or `consecutive_reruns` reached 3 with no usage-limit evidence for the window (4.4; a `retry-exhausted` decision titled "relances épuisées") |
| built | verifying | `wave ingest`, `status`, `proof verdict` | a proof run of `landed_sha` by role verifier exists |
| verifying | done | `wave ingest`, `status`, `proof verdict` | 4.3 |
| verifying | failed | `wave ingest`, `status`, `proof verdict` | a receipt with verdict fail for `landed_sha` (`attempts + 1`) |
| failed | ready | `wave ingest`, `schedule` (O) | `attempts < max_attempts`; the next brief carries the verifier's findings |
| failed | running | `wave ingest` (O) | in-wave fix (ARCHITECTURE 6.3 step 4): the manifest's `fix_attempts` lists attempt n+1 for the task and a result or merge receipt of attempt n+1 exists; ingest applies the attempts in order |
| failed | blocked-decision | `wave ingest` (O) | `attempts >= max_attempts`; a `retry-exhausted` decision is opened |
| running (manual) | done | `answers ingest`, `status` (O) | an answer file for every `bring_back` key with `verification.ok: true`, and, when the task's proof is `file`, that proof evaluated ok by exec.py (3.3) |
| running (manual) | running | `answers ingest` (O) | verification failed: the answer is kept, the task is reposted with the failure reason |
| running (decision task) | done | `decision resolve`, `status` (O) | a resolution block with the owner's verbatim quote and a valid option id, and, when the task's proof is `file` (FE-04, FE-06), that proof evaluated ok by exec.py; until the orchestrator has written `choices.json` the task stays `running` and the next `status` re-evaluates it |
| blocked-manual, blocked-decision | ready | `decision resolve`, `answers ingest` (O) | the attached decision resolved with an unblocking option, or the needed answer verified |
| any non-terminal | cut-proposed | `decision propose --kind cut` (O) | the proposal id; `previous_status` saved |
| cut-proposed | cut | `decision resolve` (O) | the owner chose the cut option |
| cut-proposed | previous status | `decision resolve` (O) | the owner refused the cut |
| any non-terminal | superseded | `amend` (O) | a resolved amendment decision listing the task |
| failed, blocked-* | ready | `task set-status` (O) | `--decision <id>` of a resolved decision and `--reason`; the only manual override, and it can never target built, verifying or done |

`done`, `cut` and `superseded` are terminal. A regression found later never reopens a done task: fix mode and the
convergence pass add new tasks.

Gate and state-only tasks reach `built` like any task: for a gate task (kind gate: EX-GATE-BUILD, EX-REPLAY,
EX-FREEZE-*, EX-FIX-GATE, EX-DEVB-CHECK, EX-HB-CLAIMS-VERIFY, FE-20 has its own merge) `wave emit` writes, through
`merge.record_gate`, a merge receipt `{mode: "gate", outcome: "landed", landed_sha: <origin/main after fetch>,
push_attempts: 0}`; a state-only task (every write under `.execution/`, empty product diff: FE-00, FE-02, FE-03, FE-05)
gets `{mode: "state-only", outcome: "landed", landed_sha: <origin/main>}` from `merge` itself (CLI.md `merge`).

### 4.3 The `done` check (`execlib.status.check_done_evidence`)
All of these, re-read at transition time, never taken from an agent's result. The **local** profile reads the
machine-local files; the **cross-executor** profile (a dependency owned by the other orchestrator, TWO-DEV.md 5)
reads the tracked copies under `proofs/runs/`, `proofs/impl/` and `proofs/merge/` that the other machine's `proof
verdict` committed with the receipt (1.1), so every condition is checkable on either machine:
1. `proofs/<task>.json` validates against proof-receipt and has `verdict: pass`.
2. `receipt.sha` equals the landed SHA of the task's latest `outcome: landed` merge receipt for the receipt's attempt
   (local: `local/results/*/<task>.merge.a<n>.json`; cross-executor: `proofs/merge/<task>.a<n>.json`), which is also
   the status `landed_sha` once set; and `git merge-base --is-ancestor <sha> origin/main` succeeds after a fetch (for
   a manual/decision task the receipt is replaced by the answer or resolution and, for a file proof, its run, 4.2).
3. `receipt.proof_hash == proof_digest(plan task)` for the current plan version (a proof changed by an amendment
   voids older receipts).
4. The cited proof run exists (`local/proof-runs/...` or its tracked copy `proofs/runs/<task>/<run_id>.json`), belongs
   to the task and SHA, and its `exit_code` and `expectation.met` agree with the verdict (a pass verdict on a failed
   run is E_VERDICT_MISMATCH, refused by `proof verdict` already).
5. `receipt.by.agent_type` is `execution-verifier`; `receipt.by.agent_id` (from the guard's attestation, CLI.md `proof
   verdict`) is non-null and differs from `receipt.implementer.agent_id` (the merge attestation); the implementer
   result named in the receipt exists (or, after a crash between push and result, `implementer.result` is null and
   the merge receipt stands for it).
6. When the task's negative control is required (P-13 kinds), `negative_control.ran` and `met` are true, either in
   this run (tracked copy included) or recorded in the plan (`negative_control.recorded`) for this proof digest.
7. `integrity.skip_markers_added == 0` and `protected_touched` is empty (schema enforces both on pass).

### 4.4 Attempts, reruns, null
- `attempts` counts real failures only. A `null` agent (died, usage limit, Remote Control at a limit) is a **rerun**:
  `reruns + 1` and `consecutive_reruns + 1`, the task goes back to `ready`, nothing is ever marked done from a missing
  result. `consecutive_reruns` resets to 0 on any landed merge, verdict or counted failure.
- **Rerun cap:** at `consecutive_reruns == 3`, when the window has no usage-limit evidence (snapshot five-hour ≥ 95 %,
  a `stop.failure` rate_limit event, a recorded "usage limit" hint, or a null storm: every agent of the wave null),
  the task goes `blocked-decision` with a `retry-exhausted` proposal ("relances épuisées": options retry with a
  stated change, amend, cut). With usage-limit evidence the task stays `ready` and the run state is PAUSED_QUOTA
  (CLI.md `quota`).
- **Throws are not nulls:** an `agent()` call that throws (unknown agent type, unsatisfiable schema, budget reached,
  scheduler error) is outcome `infra-error`, never a rerun: `blocked-decision` with a `dependency-missing` decision.
  A rerun caused by missing input (a fragment or its input absent) is the same: `infra-error`.
- **Null storm:** a wave in which every agent returned null or threw is a quota or infrastructure event: run state
  PAUSED_QUOTA until the snapshot's `resets_at` (or the next tick showing the snapshot below the limit), never an
  immediate relaunch.
- A fix attempt is a fresh implementer with the verifier's findings in its brief and the right to rebut them with
  evidence (`rebuttals`); the next verifier re-runs every rebutted finding's evidence itself.
- After `max_attempts` failures: `blocked-decision` and a `retry-exhausted` proposal (options: retry with a stated
  change, amend the task, cut). The engine keeps running everything else.

---

## 5. Who writes what

### 5.1 Files

| file | writers (only) | never |
|---|---|---|
| `plan.json` | `plan instantiate` (only while `approved` is null), `decision resolve` (sets `approved`), `amend` | any agent; the orchestrator's Edit/Write |
| `status/<X>.json` | exec.py commands of orchestrator X: `schedule`, `status`, `wave emit`, `wave launched`, `wave ingest`, `manual post`, `answers ingest`, `decision propose`, `decision resolve`, `task set-status`, `amend`, `fix`, `resume`; and `proof verdict` (run by X's verifier agents on X's machine, with `--executor` X from local state) for the evidence-backed rows of 4.2 only | the other orchestrator; any other agent command |
| `proofs/<task>.json`, `proofs/{runs,impl,merge}/**` | `proof verdict`, run by an execution-verifier agent (gate tasks included; the H13 replay wave writes proof runs with `--by replay`, never receipts); the guard denies `proof verdict` from the main thread | implementers, the orchestrator |
| `local/proof-runs/**` | `proof run` | — |
| `local/results/**` | `result put` (agents' own results), `merge` (merge receipts), `wave emit` (gate merge receipts, `merge.record_gate`) | hand edits |
| `local/merge-pending/**` | `merge` (intent before push; finalised by `merge`, `status` or `resume`) | — |
| `local/inbox/<wave>/**` | the wave's agents (Write tool), `result put` (moves out) | — |
| `events.jsonl` | `execlib.events.append` from any exec.py command (under the state lock) | hooks (they write `local/hook-events/`) |
| `<repo>/.githooks/commit-msg` | `init` (from `assets/githooks/commit-msg`; committed by the EX-BOOT task, whose writes name it) | agents' write tools (guard B4) |
| `decisions.md` | `decision propose`, `decision resolve`, `fix`, `plan instantiate` (approval proposal), `ingest` (spec-validation proposal) | — |
| `answers/*.md` | `answers ingest` | — |
| `public-values.jsonl` | `answers ingest` (after a chain-reread verification of a tx hash succeeded) and `proof run` (after a tx proof's reader confirmed the transaction), through `integrity.register_public_value` under the state lock | everyone else, agents included (guard: a write under `.execution/` outside `local/inbox/` is refused) |
| `profile.json`, `policy.json` | `ingest` (initial and `--patch` under a resolved decision) | agents |
| feature catalogue | `plan instantiate`, `amend`, `catalogue` | /frontend (reads only) |
| `waves/*`, `briefs/*` | `wave emit` (manifest launch/status: `wave launched`, `wave ingest`) | — |
| `completion-check.mjs` | `completion generate` | hand edits (regenerate instead) |
| `gates.json` | `amend` (patch `gates_json`), from the config the contract wave's test-designer wrote in its inbox (result field `gates_config`) | implementers; any direct edit |
| `frontend/` | /frontend's own scripts run by FE task agents (mode A state) | /execution's scripts |
| `local/state.json` | exec.py (state lock) | hooks |
| `local/active` | `hooks install`, `hooks uninstall`, `handover`; the hooks write only `session_id`, `previous_session_ids`, `rekey_armed_until_utc` (bind, re-key) | agents |
| `local/hooks-state.json`, `local/hook-events/**` | hook scripts only (`status` deletes event files after importing them) | exec.py (reads; `status` imports hook events) |
| `<repo>/.claude/settings.local.json` | `hooks install`, `hooks uninstall` (only entries tagged `execution-hook v1`, plus `switchModelsOnFlag`) | agents |
| product repo sources | implementer agents within their task's `writes`, committed with pathspecs; `merge` (rebase, push) | verifiers, reviewers, critics, probes |
| anything under `.execution/` by an agent's Write/Edit/Bash | only `local/inbox/<wave>/**` (results to hand to `result put`), `frontend/**` for FE task agents, `local/planner/**` for the execution-planner (its draft) | every other path (guard: E_GUARD_STATE_PATH) |
| `frontend/choices.json` | the orchestrator's Write tool, from `decision resolve` / `answers ingest` data `frontend_choice` (FRONTEND.md 6.4); the only `frontend/` file the orchestrator writes | agents |

### 5.2 Notion fields (orchestrator-only connector; agents have it in `disallowedTools`)
The authoritative list, with the French property names, is NOTION.md 2.1 (properties 1-20 orchestrator-owned, 21-24
owner-owned) and 3 (every Waves property orchestrator-owned). In short: orchestrator-owned (written by `notion diff`
ops): Tâche, Clé, État, Nature, Responsable, Orchestrateur, Phase, Priorité, Dépend de, Dépend de (clés), Échéance,
Échéance (texte), Preuve, Lien de preuve, Vérifiée par, Vague, P80 (min), Options, Ingérée. Owner-owned (never written
by any orchestrator): Réponse, Répondu, Décision, Pièces jointes. A divergence between a
Notion value and the last acknowledged hash of an orchestrator-owned field is reported as a proposal, never applied
and never silently overwritten. Rows are write-partitioned by Executor: orchestrator X writes only rows whose
Executor is X and its own wave rows.

### 5.3 Commands agents may run (enforced by the PreToolUse guard on `agent_type`)

| agent type | exec.py subcommands allowed |
|---|---|
| execution-implementer | `merge` (its own task only, as its last step), `fe-workspace` (fragment runners), `result put`, `validate`, `status --digest` |
| execution-test-designer | `result put`, `validate`, `plan instantiate --dry-run`, `proof run --negative-control`, `snapshot` |
| execution-verifier | `proof run`, `proof verdict`, `result put`, `status --digest` |
| execution-reviewer | `result put`, `proof run`, `status --digest` |
| execution-planner | `result put`, `plan instantiate --dry-run`, `validate`, `simulate` |
| frontend-critic, frontend-probe | none |
| orchestrator (main thread) | every command except `proof verdict` and `snapshot`, and never `--by` other than `orchestrator` |

Everything else (`task set-status`, `wave *`, `amend`, `decision *`, `answers ingest`, `hooks *`, `handover`, `fix`,
`sync`, `init`, `ingest`, `plan instantiate` without `--dry-run`, `plan emit`, `notion *`, `manual post`, `report`,
`agents *`, `resume`) is orchestrator-only (O), and only the bound session may run it (the guard's run lease, HOOKS.md
8.2): another main-thread session in the same repository may run only `status --digest`, `validate`, `simulate`,
`hooks canary` and `resume --takeover`. The integration step is not a separate agent: the implementer ends by running
`exec.py merge --task <its task>`, which is deterministic, holds the merge lock, runs every gate and scan itself and
writes the merge receipt; the agent cannot write under `.execution/` except its inbox (guard), so it cannot forge the
receipt. On a conflict merge exits 1 with the conflicting files; the implementer may resolve them inside its own
`writes` and call merge again, at most twice per run (a third call in the same run is E_MERGE_ATTEMPTS, exit 4; the
counter is keyed by attempt and rerun, `a<n>r<k>`, so a rerun starts at zero). Merges the orchestrator runs itself
(single-tree recovery) use `--by orchestrator`; gate tasks get their receipt from `wave emit` (4.2).

---

## 6. Task templates and instantiation

### 6.1 Placeholders (closed vocabulary; anything else is E_TEMPLATE_PLACEHOLDER)
Built-ins: `{repo}` (absolute product repo), `{state_dir}`, `{profile_abs}` (absolute profile.json),
`{execution_skill}`, `{frontend_skill}`, `{hackathon_skill}`, `{harden_skill}` (absolute skill dirs, forward
slashes), `{python}` (`python` on Windows, else `python3`), `{project}` (slug), `{private_dir}`, `{never_show}`,
`{claims_ledger}`, `{dx_journal}`, `{run_sheet}`, `{feature_catalogue}`. Per-group (only in `per: feature-group`
templates): `{group}` (G1), `{group_title}`, `{features}` (comma-separated ui requirement ids of the group, plan
order). Library-wide: `{features_all}` (every ui requirement id). Library parameters: `{<param name>}`, e.g.
`{ui_root}`, `{port}`, `{serve_dir}`, `{start_cmd}`, `{mode}`. /frontend's placeholders (FRONTEND.md 2.4 step 7, used
by the adapter): `{state}` (absolute `<state_dir>/frontend`), `{profile}` (= `{profile_abs}`), `{design}`,
`{preview}`, `{build_prefix}`, `{serve_target}`, `{references}`, `{implementer_agent}` (`execution-implementer`),
`{task_id}` (substituted after step 8), and `{workdir}` (kept literally in `params.fragment.input`, substituted by
`wave emit`). Tokens: `{latest_start:<anchor_ref>:<offset_min>}` (resolved to a UTC instant). Braces are escaped as
`{{` and `}}`.

### 6.2 Instantiation algorithm (`execlib.templates.instantiate`, deterministic, no LLM)
1. Load the library file and compute its sha256. The execution library is validated against
   task-template.schema.json. /frontend's library is validated against /frontend's own
   `assets/schemas/task-templates.schema.json`, specialised for the plan's parameters and normalised into our shape
   (FRONTEND.md 2.1-2.3, `templates.load_library("frontend")`), then validated against task-template.schema.json; a
   document already in our format (`schema: "execution.task-templates/1"`) goes straight to that last validation. A
   missing or invalid /frontend library (either validation), checker (`scripts/frontend-check.mjs`), wave fragments
   or agent definitions when the draft asks for the frontend library: E_DEPENDENCY_MISSING and a
   `dependency-missing` decision; never a fallback, never a silent translation of an unknown format.
2. Resolve parameters: draft values, else `from_profile`, else `default`; an undeclared or missing required parameter
   is E_TEMPLATE_PARAM.
3. Select templates: `include` true or its condition holds. Expand `per: feature-group` once per plan feature group
   that has at least one ui requirement, in group-id order.
4. Build tasks: substitute placeholders; validate the result against plan.schema.json `#/$defs/task` (id assigned
   later); keys are `<library key>/<template id>` or `<library key>/<template id>.<group>`; `template` =
   `<library>:<id>`, `template_digest` = sha256 of the template object, `params` = the resolved parameters plus
   `group` when per-group, `proof_author: template`, estimate from the mode (`source: template:<library>`),
   `release_utc` from `prework_class` (P-16), `required`/`priority` from the covered requirements when
   `from-requirements` (required = any covered required; priority = the highest).
5. Covers: `ui-requirements` = every ui requirement; `group-requirements` = the group's ui requirements;
   `all-required` = every required requirement; `explicit` = `ids`; `nfr` = the library-standard requirement, added
   once to `requirements` as `NFR-900` upward in library order (`source: <library>:standard`) unless one with the same
   `nfr.key` (recorded in its `title`) exists.
6. Dependencies, all resolved now, never at runtime:
   - `{template: X}` → the instance of X in the same library instantiation (per-group to per-group: same group;
     per-group to single: the single). If X is not included, the dependency is dropped, unless `required: true`
     (then E_TEMPLATE_DEP).
   - `when` conditions are evaluated on the parameters; a false condition drops the dependency. This is how
     `references: on|off` makes FE-03 depend on FE-02 or on FE-00.
   - `@project-name` → the name decision task (created once per plan, template `execution:EX-NAME`) when
     `profile.project.name_owner_confirmed` is false; dropped when true. Origins: rename pending, so FE-05 waits for it.
   - `@feature-tasks` → every non-template task of the draft (and every execution-library build task) whose `covers`
     intersect the instance's group requirements; zero matches is E_TEMPLATE_DEP (a section with nothing to show),
     except for a group whose ui requirements are all `status_expected: planned`: its FE-1x instance renders the
     planned labels and gets no `@feature-tasks` dependency.
   - `@all-instances:FE-10` → every per-group instance of FE-10 (FE-20 critique waits for all sections).
   - `@spec-approved`, `@build-complete`, `@harden-review`, `@contract-wave`, `@deliverables-before-screenshots` →
     the corresponding execution-library tasks (they must be in the plan; else E_TEMPLATE_DEP).
   - `@fix-gate` → the newest non-superseded `execution:EX-FIX-GATE` task (the placeholder at first, the regression
     gate after a fix cycle, FIX-MODE.md 1); FIX-MODE 6.5 remaps it to the new instance when it re-adds the tail.
   - Fixed /frontend rules from the agreement: FE-07 always after FE-06 (the library states it unconditionally);
     FE-21 is phase deliverable and depends on `@harden-review` and `@fix-gate` (the adapter maps
     `manual:harden-review` to both); recording tasks of the execution library depend on `frontend:FE-21` when present.
   - Serial sections: when the profile's stack has `sections: serial` (static-html, existing), the first FE-1x instance
     also depends on FE-09 and the instance of group k on the instance of group k-1, in group-id order (/frontend's
     rule: no two UI proofs share a file or the preview port).
7. Merge with the draft's own tasks; resolve every `depends_on` key; refuse unknown keys (E_DRAFT_KEY).
8. Assign ids: topological order by Kahn's algorithm with ties broken by (phase rank in the order of the `phase`
   enum, priority, key), numbered `T001`, `T002`, ... For an amendment, new tasks get ids above the current maximum
   in the same order. The `key` is kept on the task for traceability.
9. Lanes: each code/test/infra task gets the unique lane whose globs contain its writes (7.2); none or several is
   E_LANE.
10. Write the candidate to `local/plan.candidate.json`, run `validate`; only a valid candidate replaces `plan.json`.
    The same draft, templates, profile and `--now` give byte-identical output.

### 6.3 Feature catalogue (`execlib.catalogue.generate`)
One entry per requirement with `surface: ui`, in `requirements` order: `{id, group: feature_group, title, priority}`
plus `status_expected` when not null. Regenerated by every plan change; byte-identical for the same plan. /frontend
maps each id to a route and renders it as `data-feature="<id>"`.

---

## 7. Writes, lanes and resources

### 7.1 Glob intersection (`execlib.globs.intersects(a, b) -> bool`), conservative
Globs are split on `/`. `**` matches zero or more segments; other segments are fnmatch patterns (`*`, `?`, `[...]`)
that never cross `/`. Two globs intersect if some path matches both. The implementation decides segment by segment
with memoised recursion over the two segment lists; two segments intersect when both are literal and equal, when one
is literal and matches the other's pattern, or when both contain wildcards and they are not provably disjoint
(provably disjoint: different literal prefixes before the first wildcard, or different literal suffixes after the
last wildcard, e.g. `*.ts` vs `*.css`). It may answer true for globs that do not intersect (then the planner adds a
dependency or narrows a glob); it never answers false for globs that do.

### 7.2 Containment (`execlib.globs.contains(lane_glob, task_glob) -> bool`), conservative
True only when every path matching `task_glob` matches `lane_glob`: the lane glob's segments are a prefix of the task
glob's literal segments followed by `**`, or the two are equal, or the lane glob's last segment pattern matches every
expansion (e.g. lane `src/queue/**` contains `src/queue/model/*.ts`). When unsure: false.

### 7.3 Manifest files (P-10)
`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.toml`,
`Cargo.lock`, `pyproject.toml`, `requirements*.txt`, `uv.lock`, `go.mod`, `go.sum`, `foundry.toml`, `aiken.toml`,
`tsconfig*.json` at the repo root, `.github/workflows/*`: a write glob that can match any of them requires the
`manifest` resource and (by P-08) the contract lane, or an amendment. `.npmrc` and every env file are never in any
task's writes (the global guard blocks them anyway; E_SECRET_PATH).

### 7.4 Runtime overlap (the dispatcher, ARCHITECTURE.md 6.4)
Two tasks may run at the same time only if no path joins them, their writes do not intersect, they hold no common
ordered resource (P-10) and no common serialized resource; `browser` holders are limited to the governor's
`browser_slots`, `disk-heavy` to one per executor while free disk is under `disk_floor_gb + 2 × lane_footprint_gb`.
The rule spans every live wave of the executor: a task of a manifest in status `launching` or `launched` (not yet
ingested) occupies its lane, its resources, its writes and its slots, so `wave emit` never selects a task that
overlaps one of them, and a second concurrent wave gets only the governor budget the running waves leave (CLI.md
`wave emit`). A proof run's clone and install hold `disk-heavy` (CLI.md `proof run`).

---

## 8. The other documents

- **events.jsonl**: append-only; a line is never edited. Readers sort by `(ts, executor, seq)`; duplicates (same
  `id` for imported hook events) are dropped. Union merges may interleave the two executors' lines: order on disk
  means nothing. `events replay` refuses a line that fails the schema (E_EVENT_INVALID) and continues.
- **decisions.md**: append-only blocks, each opened by `<!-- execution-decision {canonical json} -->` on its own line.
  An id has one proposal block and at most one resolution block (a second resolution is E_DECISION_RESOLVED). Ids
  are allocated per executor in disjoint ranges (A: D-001..D-499, B: D-500..D-999) so union merges never collide.
  The prose under a header is for humans; machines read only headers. Owner quotes are data.
- **answers**: immutable; a corrected answer is a new key (`<key>-2`). The header's `verification` is the mechanical
  check; `owner-attest` is allowed only for kinds text and transcript.
- **proof receipts**: one current receipt per task; a new verdict moves the old one to `proofs/history/`. A receipt
  is never edited.
- **agent results**: immutable once moved by `result put` (same bytes again: no-op; different bytes for the same
  path: E_RESULT_IMMUTABLE, exit 4).
- **never-show**: an entry is active iff `until_utc` is null or in the future (now from `execlib.clock`). Matching:
  literal substring or Python regex; case-insensitive matching folds NFKC then `lower()` on both sides, never
  `casefold()`, so it agrees with /frontend's NFKC then JS `toLowerCase()` (on ß, for instance), and a regex entry gets
  `re.IGNORECASE` when `case_sensitive` is false (Q-F9, agreed with /frontend on 2026-10-01). /execution
  scans entries of scope repo or both on the added lines and the new commit messages of every merge, and, before the
  public flip, the whole history (`git log --all -p` and every commit message); it treats a hit as a policy refusal
  (exit 4, E_NEVER_SHOW, never printing the matched text, only the entry id and file:line or commit SHA).
- **completion gates**: `ok` is true iff every gate of the selected phase(s) is `ok`; a `skipped` gate is open. The
  generated script exits 0 iff `ok`. It never skips silently in `--json` mode and never trusts a cached result.
  `--phase` takes one phase or a comma list (`build,harden`). `completion run` recomputes `ok` from the gates and
  refuses an output whose `ok` disagrees (exit 3 E_GATES_OUTPUT).
- **wave manifest**: `script_sha256` must equal the bytes of `waves/Wnn.js` at launch (`wave launched` checks);
  `args.skip` lists tasks already done when the wave is relaunched. Status `launching` (written by `wave emit`) →
  `launched` (`wave launched`) → `finished` → `ingested`, or `launch-failed` / `abandoned`; a task id appears in at
  most one manifest that is `launching` or `launched`.
- **local state**: a cache. `events replay --rebuild-state` rebuilds `waves`, `awaiting`, `flags`, `run_state` and
  `calibration` from events, status files, manifests and receipts; the Notion `pages` map is rebuilt by fetching the
  Tasks database once.
- **hooks state**: `consecutive_continuations` is reset to 0 when a Stop fires with `stop_hook_active` false.

---

## 9. Schema index

| schema file | document |
|---|---|
| common | shared `$defs` (enums, id patterns, utc, estimate, error) |
| envelope | stdout of every exec.py command |
| plan, plan-draft | plan-of-record; planner draft |
| status | per-executor task status |
| profile, policy | event profile; narrowed authorisations |
| proof-run, proof-receipt, merge-receipt | raw proof execution; verifier verdict; merge queue receipt |
| event | one events.jsonl line |
| local-state | local/state.json, plus `$defs` active_marker, hooks_state, hook_event |
| task-template | both template libraries |
| feature-catalogue, never-show | /frontend's formats |
| completion-gates | completion-check.mjs and harden-ready output |
| notion-ops | Notion MCP operation batches |
| decision, answer | decisions.md block header; answers/<key>.md header |
| wave-manifest | waves/Wnn.json |
| result-planner, result-test-designer, result-implementer, result-verifier, result-reviewer | agent structured results (self-contained, inlined into agent() calls) |
