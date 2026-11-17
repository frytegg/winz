# Autonomous pilots 2 to 4 (2026-09-25 to 2026-09-30)

All three ran in a real headless Claude Code session on a disposable clone of the TypeScript fixture
(pricewatch: 25 seeded defects, 8 traps, 97 hidden tests), with no human answer, and were graded by an
independent agent with the hidden ledger and the v3 outcome definitions. Pilot 1 is in
`pilot-auto-2026-09-25.md`. Grades: session scratchpad `pilot-auto{2,3,4}/grade.json`.

| Pilot | Skill version | Profile | Hidden tests | Traps broken | Existing tests edited | Fixed / partial (ledger) | Findings applied | Cost, wall |
|---|---|---|---|---|---|---|---|---|
| 1 | autonomous default (755ff9e) | owner-written, money paths off | 97/97 | 0 | 0 | 6 / 1 | 7 | USD 35, 90 min |
| 2 | + A01 calibration (1c4dc5e) | owner-written + money globs | 96/97 (one regression: a fix changed an exported default untested) | 0 | 0 | 6 / 3 | 13 | USD 102, 97 min |
| 3 | + self-setup, full scope, agents (7d18ca6) | inferred (no profile) | 97/97 | 0 | 0 | 2 / 2 | 5 | USD 69, 80 min |
| 4 | + round 4 and U01-F14 (a3926d8) | inferred (no profile) | 97/97 | 0 | 0 | 4 / 1 | 16 applied + 10 partial | USD 68, 108 min |

What each pilot taught (dossiers: pilot-auto-calibration A01, eval-v3-calibration E03, user-policy-autonomy U01):
- Pilot 2: lens passes borrowed a user agent pinned to Haiku and missed four defects; the orchestrator's
  context was 65% of cost; a fix changed another exported function's output without a test. Led to the
  dedicated harden-lens/harden-verifier agents, persisted passes, PC-24 output pins.
- Pilot 3: first run with no profile; self-setup inferred safe gates and banned every network-reaching CLI
  subcommand on its own. Yield fell because budget windows did not reflow (77 candidates unverified, run
  ended 42 min early), money-path proof was unreachable, test globs were treated as gate configs.
- Pilot 4: reflowed windows and reproduce-before-demote verified 160 of 162 candidates; 67 were approved.
  One self-detected incident: a fix rejected valid order ids above 2^53 under a false "newly rejected: none"
  claim and the run reverted it nine minutes later. 34 approved fixes were left for lack of time within the
  default 2-hour budget of this small repository.

Known limits after pilot 4 (not calibrated; the owner closed calibration here):
- PC-24's "newly rejected" claim is written by the run; contract_check.py checks its form, not its truth.
  Review every behavioural commit listed first in the report before merging.
- Self-setup e2e checks are thin (CLI help and version here, none for a web monorepo): the end-to-end
  verdict rests on the gates run from a fresh clone.
- A repository file that tools load into the environment (for example Next.js/Vitest `.env.local`) makes
  self-setup refuse the test commands that load it; park such files outside the repository for the run.
- Live-effect bans for Hardhat were checked by a read-only self-setup dry run on the owner's monorepo
  (2026-09-30): deploy, verify, evidence, live, account and reveal-key scripts, forked tests and every
  `--network hedera*` form are banned; no pilot has run on a Hardhat repository.
