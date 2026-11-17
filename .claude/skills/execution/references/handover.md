# Build complete and the hand-over

Read this when the run reaches BUILD_COMPLETE, when `exec.py harden-ready` fails a check, when the owner asks what to
type for /harden, after /harden ran, or when the deliverables are finished. The contract is contract/HANDOVER.md.
SKILL.md standing rules 11 and 12 apply: /execution never invokes /harden, never writes `.harden/`, and produces no
deliverable before the build gate, /harden's review and the fix gate.

## Build complete

The build is complete when the build-phase gates of the generated completion check pass: `exec.py completion run
--phase build` exits 0 (`REQ.<id>` for every requirement whose covering tasks are build-phase, `DL.<id>` for each
irrecoverable deadline, `TODO.judge`, `NEVERSHOW.repo`, `PLAN.chain`, `CONVERGENCE`, `HARDEN.ready`, and
`FRONTEND.build` when the plan has frontend tasks: /frontend's checker with `--phase small` in small mode and
`--phase build` in full mode, as `profile.frontend.mode` says). A skipped gate is open, never ok; the harden and
deliverable gates stay open by design at this point. Before it: the convergence pass (EX-CONVERGE: fresh reviewers,
the plan as the contract, the burden on "done") must report no missing or partial requirement in scope for HEAD;
missing work under an approved requirement becomes new tasks through an amendment, anything wider is a decision. The
build-complete gate task (EX-GATE-BUILD) is verified by a verifier like any task, and only after an ok `exec.py
harden-ready` report for the current origin/main HEAD exists and the replay task (EX-REPLAY) for that HEAD is done.

## Harden-ready

`exec.py harden-ready` reproduces every condition under which an autonomous /harden would degrade to report-only,
without running /harden. Run it from this main thread when no wave runs and no merge holds the lock. Each check, what
a failure means, and the usual fix:
| check | fails when | usual fix |
|---|---|---|
| H1 | no HEAD, not pushed, or `.harden/active` exists (exit 4) | push; wait for /harden to finish |
| H2 | the working tree is dirty outside `.harden/` | land or discard the stray files (never the owner's work without asking) |
| H3 | a focus marker (`.only(`, `fit(`, `fdescribe(`) is committed | a fix task removes it |
| H4 | /harden's self-setup dry run finds no test gate, report-only mode, or live side effects | make the test command discoverable; a decision when it cannot be |
| H5 | the gates are flaky over 3 runs (one shuffled) | a fix task for the flaky test |
| H6 | a fresh clone with the lockfile install fails the gates | fix the install or the lockfile |
| H7 | an auto-loaded env file is in the tree (detected by name, never opened) | the owner's parking task EX-HARDEN-PARK moves it out |
| H8 | /harden's agents are not installed (pre-harden only) | the owner installs them |
| H9 | not enough disk, or no time left for /harden's budget before its latest end | free disk; a decision near the deadline |
| H10 | contract or validator sources are not frozen | the freeze task, or the hand-over proposes them as scope exclusions |
| H11 | the README is not factual, `.env.example` is incomplete, or a deferral marker is in judge-facing files | the EX-README task again; complete the template |
| H12 | the CI run of the final SHA is not green | fix the gates; wait for CI |
| H13 | a done task has no replay of HEAD in a fresh clone | run the EX-REPLAY task |
| H14 | `FRONTEND.build` fails on the fresh clone | a frontend fix task |
After /harden (run_state FIX, or once EX-HARDEN-REVIEW is done) the after-harden profile applies by itself: H8 is not
run and H9 checks that the remaining deliverables still fit before the submission deadline.

When a check cannot turn green in time (H9 time, H12 CI outage), propose an owner-only `policy-exception` decision
with the options `wait`, `handover-report-only` (the owner will run `/harden --report-only`) and `skip-harden`; only
that resolved decision lets `exec.py handover --decision <D>` hand over with the red gates named.

## The hand-over

`exec.py handover` refuses (exit 1, with the open list) unless the latest `exec.py completion run --phase build` and
the latest `exec.py harden-ready` are ok for HEAD and newer than the last commit on origin/main. It prints, from
receipts and never from model prose: the final SHA, what to type (`/harden`, `/harden <paths>`, `/harden --profile
"<abs path>"` or both, from the time-capped /harden profile it drafted in the state directory, outside the product
tree, which the owner reviews and promotes), the time left until /harden's latest end in SGT and Paris, the budget,
the open deliverable tasks, and `text_fr`. It writes the profile draft, uninstalls the hooks and moves the run to
HANDED_OVER. Then: CronList and CronDelete the heartbeat (nothing is left to wake for), stop the background watchers,
execute the Notion batch, send the push, and print `text_fr` verbatim. Running it again after success prints the same
hand-over.

## After /harden

1. The owner opens a new session at the repo root and types what the hand-over said.
2. /harden never merges or pushes: the owner reviews `.harden/report.md` and merges the branch its header names into
   main, then pushes (EX-HARDEN-REVIEW, a manual task).
3. The owner types `/execution --fix <repo>/.harden/report.md`: fix mode (`references/fix-mode.md`) proposes the
   fixes, runs the selected ones and the regression gate (EX-FIX-GATE), then the deliverable sub-plan: FE-21 first,
   the recording, /prose, README screenshots last.
4. When every deliverable task is terminal and `exec.py completion run --phase all` exits 0: `exec.py handover
   --final` writes the final French report, removes the hooks and ends the run (HANDED_OVER, deliverables complete).

## Postable moments

Inside a run the owner's habit of offering an X post is switched off (SKILL.md standing rule 17); instead the
hand-over text and the Notion hand-over report list the run's postable moments, for the owner to use or ignore:
- milestones with their receipt: the first proof passing end to end, a deployment on testnet, build complete;
- measured numbers worth sharing: a latency, a cost, a failure rate, the P80 against the real duration, the number
  of proofs replayed on a fresh clone;
- real failures with their lesson: a proof that failed and why, a retracted claim, a rerun storm at a usage limit;
- shipped or submitted, with the link.
Each item cites its evidence (receipt, report or ledger row). Nothing from client or NDA work and nothing that
reveals a trading system's live edge is listed; the owner writes and posts, the run never does.
