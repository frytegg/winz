# Planning

Read this when the run is in PLAN or AWAIT_APPROVAL, when a validation error must be explained, or when the owner
asks why a plan has the shape it has. It covers the inputs, the planner workflow, the draft the planner writes, the
plan invariants and their usual fixes, scheduling, the approval summary and what happens after approval. The plan of
record is written only by `exec.py`; SKILL.md standing rules 2 and 5 apply.

## Inputs

- **The spec**, validated by the owner: `exec.py ingest --spec <path> --propose-spec-validation` opens a
  `spec-validation` decision that records the spec's sha256. Invariant P-25 refuses a plan against a spec the owner
  has not validated, or whose file changed since (a new hash needs a new validation).
- **profile.json and policy.json**, built by `exec.py ingest` from the drafts you compiled from the workspace; a
  field the workspace does not give is listed in `missing` and becomes a manual task or a decision, never a guess.
- **The two template libraries**: /execution's own `assets/task-templates/execution.json` (bootstrap, CI, contract
  wave, deploy, evidence, factual README, approval, build gate, convergence, replay, /harden parking and review,
  freezes, /hackathon Phase B, deliverables, fix tasks, dev B setup) and, when the profile has a `frontend` block,
  /frontend's `~/.claude/skills/frontend/assets/task-templates/frontend.json` (`references/frontend.md`).
- **Requirement ids**: FR-, SC- and NFR- ids and stories (US1...) come from the spec. Where the spec has none, the
  planner assigns them and lists each in `requirements_assigned` with the spec line it came from; the approval
  summary shows them to the owner.

## Two-step planning before T0

When the event forbids prework (Origins: no code, designs or prototypes before kickoff), the owner's own research
counts as a design anything visual or structural: a CLI shape, a schema, a report layout, a diagram, tokens, a logo,
a mock. So:
- **Before T0** (`/execution pre-t0`): a knowledge-level skeleton only (parts, hours, proofs, gates, owners), stored
  in the owner's private research folder, never in the event repo. /frontend's FE-00 (brief), FE-01 (the owner
  confirms the reference URLs) and FE-02 (reference captures and the written pattern ledger) are research and may run
  with `{state}` = `<private_dir>/frontend/` (`exec.py plan instantiate --pre-t0`, `exec.py wave emit --pre-t0`).
  No visual before T0.
- **At T0**: the product repo and the state repo are created (the bootstrap imports the pre-T0 frontend state:
  `exec.py init --project <slug> --executor A --import-from <dir>`), then the design-level plan in minutes and the
  approval by about T0+30.
Events without such a rule plan whenever the spec is ready, with the full variant.

## The planner workflow

`exec.py plan emit` renders `local/planner/planner.W00.js` and the planning briefs and prints `workflow_call`; call
Workflow with it, then wait for its completion (a wake source). Planning uses the pseudo-wave W00. Each round:
1. **Plan**: `execution-planner` (opus/high) writes the draft at `.execution/local/planner/plan.draft.json`,
   self-checks with `exec.py plan instantiate --dry-run --draft <draft>` and `exec.py validate --plan <candidate>`,
   and records `result-planner`.
2. **Check**: a separate runner (sonnet/low) re-runs both commands; the planner's own self-check is never the
   evidence.
3. **Proofs**: `execution-test-designer` (opus/high) writes a proof object for each candidate task, each with a
   negative control that must fail before implementation, and records `result-test-designer`.
4. **Check with proofs**: the runner again, with `--proofs <test-designer result>`.
5. **Critique**: two fresh `execution-reviewer` agents (completeness critics, burden on "done"), lens coverage and
   lens feasibility, each returning `result-reviewer` in mode convergence.
No in-scope gap and no blocker or major finding → `ready-for-approval`; otherwise another round, or `needs-owner`
after the last one (`--rounds`, default 2). Out-of-scope gaps never trigger a round: they become decisions at
approval.

After the workflow: `exec.py plan instantiate --proofs <recorded test-designer result> --propose-approval`, `exec.py
completion generate`, `exec.py schedule`. A `needs-owner` summary goes to the owner as a decision with the remaining
errors and gaps; never "fix" the plan yourself.

## Writing the draft

The planner writes `plan-draft.schema.json`; `exec.py plan instantiate` expands it (contract/SCHEMAS.md 6.2):
- **Keys, not ids**: tasks have stable `key`s; ids `T001`... are assigned topologically by `exec.py` and never
  renumbered later.
- **libraries**: whole-library instantiations, e.g. the /frontend library with its parameters `mode` (`small` or
  `full`, confirmed at approval against the rubric's UX weight) and `references` (`on` makes FE-03 wait for FE-02,
  `off` for FE-00).
- **instances**: single templates requested by id (`execution:EX-DEPLOY`, ...). The planner never expands a template
  itself and never writes a generic UI task.
- **Dependency symbols**, resolved at instantiation, never at runtime: `@spec-approved`, `@contract-wave`,
  `@build-complete`, `@harden-review`, `@fix-gate`, `@deliverables-before-screenshots`, `@project-name` (the name
  decision while the name is not owner-confirmed), `@feature-tasks` (the build tasks whose `covers` intersect a
  feature group), `@all-instances:FE-10`.
- **Lanes and globs**: each lane owns disjoint path globs; exactly one lane is the contract lane; every code, test or
  infra task's writes sit inside its lane. Writes are exact repository-relative globs.
- **Resources**: `manifest` for any package manifest or lockfile, `wallet:<name>` for signed transactions,
  `port:<n>`, `browser`, `disk-heavy`, `db:<name>`, `human:<dev>`.
- **Sizing**: one deliverable per task; about 60 human-minutes at most; p90 agent time at most 60 minutes; a proof
  that runs in at most 5 minutes; not split below about 15 minutes unless ownership or the critical path requires it.
  A 36-hour event is about 25 to 60 tasks.
- **Estimates** come from the reference class (build p10/p50/p90 = 6.2/26.7/46.0 min, verify 1.6/6.7/31.1, research
  13.0/24.9/40.6) with source `reference-class:<class>`, unless the planner has a better basis and says why.
- **Human work** is explicit: manual tasks with steps, what to bring back and where, a latest start inside the
  owner's availability (steps in French); decision tasks with at least two options or an options source.

## Validation errors and their fixes

`exec.py validate` (also run by `exec.py plan instantiate` and `exec.py amend`) prints each error with its code.

| invariant | code | means | usual fix in the draft |
|---|---|---|---|
| P-01 | E_TASK_ID | ids malformed, duplicated or unsorted | never hand-write ids; use keys |
| P-02 | E_DEP_ORDER | a dependency on a higher id | reorder through dependencies: instantiate numbers topologically |
| P-03 | E_RENUMBER | an id renumbered, reused or deleted | supersede instead of deleting; new tasks only append |
| P-04 | E_UNCOVERED | a requirement no live task covers | add a task covering it, or ask the owner (scope decision) |
| P-05 | E_GROUP | a feature group missing or empty | give every ui requirement a group with at least one ui requirement |
| P-06 | E_PHASE_KIND | phase and kind do not fit (SCHEMAS.md 3.1) | change the phase or the kind |
| P-07 | E_OWNER | owner, executor and team disagree | agent tasks on a full-setup dev's executor; human-only devs get manual tasks |
| P-08 | E_LANE | lane globs overlap, or a task writes outside its lane | split or move globs; one contract lane |
| P-09 | E_WRITE_OVERLAP | two unordered tasks write the same paths | add a dependency or narrow the writes |
| P-10 | E_RESOURCE_OVERLAP, E_MANIFEST_UNDECLARED | unordered tasks share an ordered resource; a manifest written without `manifest` | order them; declare the resource |
| P-11 | E_ESTIMATE, W_TASK_TOO_BIG | inconsistent estimate; p90 above 60 min | fix p10 ≤ p50 ≤ p90; split the task |
| P-12 | E_PROOF_KIND, W_PROOF_SLOW | proof type does not fit the kind; a proof over 5 minutes; `--allow-skip` anywhere | pick a fitting proof type; never `--allow-skip` |
| P-13 | E_NEGATIVE_CONTROL | the negative control is missing or of the wrong kind | pre-implementation or planted-defect for code and test; forgery for checkers and tx |
| P-14 | E_MANUAL, W_OUTSIDE_AVAILABILITY | a manual or decision task is incomplete or outside the owner's waking hours | add options; move the latest start into an awake window |
| P-15 | E_TIME | release after deadline, or a bad anchor | fix the instants or the anchor |
| P-16 | E_PREWORK | code or design released before the prework limit | release at or after `prework.until_utc` |
| P-17 | E_DELIVERABLE_ORDER | a deliverable not behind build, harden and fix | depend on `@build-complete`, `@harden-review`, `@fix-gate` |
| P-18 | E_BUILD_GATE | not exactly one build gate, or a required task outside it | keep one `execution:EX-GATE-BUILD` |
| P-19 | E_PUSH_FREEZE | code released after the push freeze | release earlier, or move the freeze through a decision |
| P-20 | E_PROTECTED | an implementer task writes protected globs | acceptance tests belong to test-designer or contract tasks |
| P-21 | W_BRIEF_REF_MISSING, E_BRIEF_REF_MISSING | a `brief_refs` path does not exist on this machine | fix the path |
| P-22 | — | `max_attempts` outside 1-3 | leave the default (2) |
| P-23 | E_NO_FRONTEND, E_DEPENDENCY_MISSING | ui requirements without /frontend, or /frontend missing | cover ui requirements with FE-1x; a missing /frontend is a decision for the owner, never a fallback |
| P-24 | E_DEADLINE | the build-complete deadline is missing or after submission | let instantiate insert `DL-build-complete`; fix the deadline ids |
| P-25 | E_SPEC_UNVALIDATED | the spec is not validated or changed since | have the owner validate the current spec |
| P-26 | E_PLAN_TAMPERED | the approved plan changed outside an amendment | never edit plan.json; `exec.py amend` only |
| P-27 | E_GATES | a completion gate cannot be generated | anchor a task to each irrecoverable deadline |

## Scheduling and the approval summary

`exec.py schedule` runs CPM with releases and deadlines, then a seeded Monte Carlo through the same dispatcher, and
prints the ready set, zones per deadline with P50/P80/P90, the critical path and the build-complete deadline
(submission minus the P80 of /harden, the fix wave, FE-21, recording, /prose, screenshots, submission steps and a
buffer). `exec.py simulate --plan <candidate>` gives the same numbers without writing, and `--what-if <patch>` tests
cut options. Show the owner P80 and P90, never the CPM total. Zones: green when P(on time) ≥ 0.8, yellow from 0.5,
red below (a cut proposal, ordered optional, then P3, then P2, never on the must-have critical path).

The approval summary (`exec.py plan instantiate --propose-approval` data `approval.summary_fr`) is French and has
these sections: critical path, lanes, manual tasks with their times, decision gates (including /frontend's H1
direction and H2 logo), risks, P80 dates, and the requirement ids the planner assigned. Post it with `exec.py manual
post --task <the EX-APPROVE task>`, push the owner, and wait.

## After approval

The owner's approval is resolved with `exec.py decision resolve` (approve-plan): `plan.approved` is set with the plan
digest and the run goes RUNNING. From then on the plan changes only through `exec.py amend --decision <D> --patch
<file>` under a resolved decision of kind amendment, cut, spec-gap, fix-selection, retry-exhausted or scope-change;
each amendment bumps `plan_version` and extends the digest chain (P-26). Never Write or Edit plan.json: the guard
denies it and validation would call it tampering. A scope change the owner asks for is a decision first, an amendment
second.
