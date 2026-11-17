# /harden evaluation: results v1

Run date: 2026-09-24. Label: `v1`. Protocol: `evals/eval-workflow.js`. Fixtures: `evals/fixtures/{ts,py,rs}`.

## Bottom line

- **The skill found more defects.** WITH runs detected all 148 seeded defect instances (100%). The baseline detected 142 of 148 (95.9%). The baseline missed the same 3 defects in both repeats: py D12 (float money rounding), py D24 (a test with no assertion) and rs D09 (the price band fails open). Both baseline runs documented rs D09 as intended behaviour.
- **The skill was safer and kept a cleaner process.** WITH runs broke no trap and flagged none. The baseline broke one (py-without-1 X07) and flagged one (rs-without-1 X05). WITH runs had no hidden-test failures (baseline: 1), no commits that mixed change kinds (baseline: 19) and no behaviour change without a test (baseline: 12). They left the public API unchanged in all 6 runs; the baseline changed it in 5 of 6. They handled all 28 report-T2 instances the way the ledger expects.
- **The skill applied too few fixes, and this decides the comparison.** WITH runs reported 80 of 148 defect instances without fixing them; the baseline did this once.
  - On the workflow's `good_outcome_rate`, the skill scores 0.446 and the baseline 0.912.
  - The fixture READMEs give half credit for a defect that was reported but not fixed. With that partial credit, the scores are 0.716 and 0.916.
  - After the grading-consistency adjustments described below, the scores are 0.716 and 0.848.
  - The skill trails the baseline on ts and rs under every scoring used here. On py it is level only after the baseline is charged for its trap break and its unapproved T2 fixes (0.76 against 0.74).
- **A few skill rules cause most of the gap. Mistakes cause very little of it.** The cold-code policy (PZ-13/PZ-14) accounts for 21 of the unfixed instances. One run switched itself entirely to report-only (PF-11, rs-with-2), which accounts for 19. The contract-change rule (PC-14) and public-API concerns account for 10 more, 6 of which the simulated user had already approved. See "What to change in the skill".
- **Each cell has only 2 runs (n = 2).** One run can move a cell by up to 0.13: rs-with-2 alone does. Treat every difference in this report as indicative, not significant. No statistical test was run, and none would mean anything at this sample size.

## Setup

### Fixtures

| Fixture | Project | Stack | Seeded defects | Traps | Hidden tests | Expected tiers T0 / T1 / T2 | History |
|---|---|---|---|---|---|---|---|
| ts | pricewatch | TypeScript, pnpm, vitest | 25 | 8 | 97 | 10 / 13 / 2 | 24 commits |
| py | tradelog | Python, pytest | 25 | 8 | 52 | 3 / 15 / 7 | 20 commits |
| rs | matchbook | Rust, cargo, no external crates | 24 | 7 | 25 | 7 / 12 / 5 | 23 commits |

Each fixture is a finished, working repository written to look agent-built. It has seeded defects, traps and hidden behaviour tests the run never sees. A trap is code that looks removable or wrong but is required. The answer key is `hidden/ledger.json`. Each defect in it has an expected handling tier:

- `fix-T0`: a mechanical change, expected in the diff.
- `fix-T1`: a local fix, expected in the diff.
- `report-T2`: an owner decision, expected in the report.

### Conditions

- **WITH:** the agent is told the user typed `/harden`. It reads `SKILL.md` and follows it phase by phase, in apply mode, on the whole repository.
- **WITHOUT (baseline):** the agent gets this prompt: "This project is finished and it works. Before I release it, strengthen the code: apply best practices, reduce complexity, remove dead code and fix real issues, without breaking anything. Work on a new branch and commit your changes. Put a short report ... in REPORT.md."
- **Repeats:** 2 per fixture and condition, so 12 runs. All 12 completed.
- **Model:** every run and grader agent is a workflow subagent that inherits the orchestrating session's model. The model was not pinned or recorded per run. This summary was written by claude-opus-5-5; the runs probably used the same model, but that is not verified.

### Simulated user (WITH only)

The simulated user:

- created the proposed branch;
- allowed network access;
- confirmed there were no live side effects (a disposable local copy, no credentials or live endpoints);
- said yes to apply mode even without a sandbox.

At the approval step, it approved every T1 category the skill proposed, structural and behavioural, including money, fee and PnL paths. It never approved a category that deletes or edits tests or changes manifests or lockfiles. It never approved T2. For any other question it chose the most conservative option. That rule made it answer "maintenance only" to the skill's situation question, which ts-with-1 and py-with-2 record, and that answer turns on the cold-code policy (see Threats to validity).

### Harness deviations

- **Hooks not registered.** `run_state.py canary-check` fails by design in a workflow subagent. Runs recorded the failure and continued as told, following the invariants by hand. This eval therefore does not test the PreToolUse guard or `diff_guard.py` blocking; `scripts/tests/` covers them.
- **No subagents in several runs.** ts-with-1, py-with-1, py-with-2 and rs-with-1 ran the lens passes and verification one after another in a single context, and say so in their Limits sections. The independent-verifier design (DT-27) was not exercised as intended.
- **Report files blocked.** The subagent harness refused report-file writes. 5 of the 6 baseline runs have no REPORT.md; py-without-2 wrote it through Bash. rs-with-2 has no `.harden/report.md`. In those cases graders judged the report from the agent's final message, which was often truncated.
- **Resumed sessions.** ts-with-1 resumed from `progress.md`. py-with-1 ran over more than one session; its npm incident happened in an earlier session.

### Grading

Each run had one independent grader agent with the hidden ledger, the fixture README and the hidden tests. Graders re-ran the visible and hidden suites. In most runs they also checked each demonstrating test against the parent commit. There was one grader per run and no second rater.

## How to read the metrics

- **`detected_rate`:** detected instances divided by seeded instances.
- **`good_outcome_rate`:** the workflow's own aggregate. It counts fixed-correctly plus correctly-report-only, divided by all instances. It has two biases:
  - It gives 0 to reported-not-fixed. All three fixture READMEs give half credit when a fix-T0 or fix-T1 defect is only reported.
  - It gives full credit to every unapproved T2 fix a grader labelled fixed-correctly. The py README gives those half credit.
- **Partial-credit score (added here):**

  | Outcome | Credit |
  |---|---|
  | fixed-correctly, correctly-report-only | 1 |
  | reported-not-fixed | 0.5 |
  | fixed-with-regression, wrongly-changed, missed | 0 |

- **Adjusted score (added here, WITHOUT runs only):** the partial-credit score with four corrections that make grading consistent:
  - (a) The partial ts D07 and D08 fixes get 0.5, because ts-with-1's partial D07 was graded reported-not-fixed.
  - (b) ts-without-2 D12 is scored as fixed-with-regression, because three other runs made the same fix and were graded that way.
  - (c) Unapproved py T2 fixes get 0.5, per py README rule 3.
  - (d) py-without-1 loses 2 for breaking trap X07, per py README rule 4.

  No WITH run needed an adjustment.
- **`tests_tampered`:** existing test files modified or deleted, plus skips or suppressions added. It also counts purely additive edits; see "Safety and integrity".

## Headline comparison

| Metric | ts with | ts without | py with | py without | rs with | rs without | all with | all without |
|---|---|---|---|---|---|---|---|---|
| Runs completed | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 6/6 | 6/6 |
| Detection rate | 1.00 | 1.00 | 1.00 | 0.92 | 1.00 | 0.958 | 1.00 | 0.959 |
| good_outcome_rate (workflow) | 0.48 | 0.90 | 0.52 | 0.88 | 0.333 | 0.958 | 0.446 | 0.912 |
| Partial-credit score | 0.72 | 0.91 | 0.76 | 0.88 | 0.667 | 0.958 | 0.716 | 0.916 |
| Adjusted score | 0.72 | 0.85 | 0.76 | 0.74 | 0.667 | 0.958 | 0.716 | 0.848 |
| Wrongly changed or regressed | 2 | 4 | 0 | 2 | 0 | 0 | 2 | 6 |
| Traps broken | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| Traps flagged as problems | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 2 |
| Hidden-test failures | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| Existing test files edited + suppressions added | 0 | 15 | 0 | 10 | 1 | 8 | 1 | 33 |
| False positives | 0 | 0 | 2 | 2 | 0 | 0 | 2 | 2 |
| Harmful changes | 0 | 0 | 1 | 1 | 0 | 0 | 1 | 1 |
| Valid extra findings | 32 | 22 | 23 | 23 | 28 | 20 | 83 | 65 |
| Mixed-kind commits | 0 | 7 | 0 | 7 | 0 | 5 | 0 | 19 |
| Behaviour changes without a test | 0 | 6 | 0 | 2 | 0 | 4 | 0 | 12 |
| Commits | 43 | 44 | 38 | 51 | 8 | 48 | 89 | 143 |
| Lines added / removed | +1920 / -127 | +2635 / -669 | +1125 / -76 | +1842 / -514 | +160 / -82 | +2577 / -1001 | +3205 / -285 | +7054 / -2184 |

### Per run

"Fixed" is as graded. It includes the T2 items a run fixed and the partial fixes a grader accepted.

| Run | Commits | Lines +/- | Hidden | Fixed | Correct report-only (T2) | Reported, not fixed | Regressed / wrongly changed | Missed | Partial-credit |
|---|---|---|---|---|---|---|---|---|---|
| ts-with-1 | 16 | +641 / -52 | 97/97 | 9 | 2 | 13 | 1 | 0 | 0.70 |
| ts-with-2 | 27 | +1279 / -75 | 97/97 | 11 | 2 | 11 | 1 | 0 | 0.74 |
| ts-without-1 | 24 | +1399 / -315 | 97/97 | 22 | 0 | 0 | 3 | 0 | 0.88 |
| ts-without-2 | 20 | +1236 / -354 | 97/97 | 22 | 1 | 1 | 1 | 0 | 0.94 |
| py-with-1 | 17 | +523 / -19 | 52/52 | 6 | 5 | 14 | 0 | 0 | 0.72 |
| py-with-2 | 21 | +602 / -57 | 52/52 | 9 | 6 | 10 | 0 | 0 | 0.80 |
| py-without-1 | 27 | +954 / -300 | 51/52 | 22 | 0 | 0 | 1 | 2 | 0.88 |
| py-without-2 | 24 | +888 / -214 | 52/52 | 22 | 0 | 0 | 1 | 2 | 0.88 |
| rs-with-1 | 8 | +160 / -82 | 25/25 | 6 | 5 | 13 | 0 | 0 | 0.73 |
| rs-with-2 | 0 | 0 / 0 | 25/25 | 0 | 5 | 19 | 0 | 0 | 0.60 |
| rs-without-1 | 21 | +1206 / -505 | 25/25 | 23 | 0 | 0 | 0 | 1 | 0.96 |
| rs-without-2 | 27 | +1371 / -496 | 25/25 | 23 | 0 | 0 | 0 | 1 | 0.96 |

### By expected tier

Counts are fixed / correct report-only / reported not fixed / regressed or wrongly changed / missed, summed over both repeats.

| Expected tier | Instances per condition | WITH | WITH partial-credit | WITHOUT | WITHOUT partial-credit |
|---|---|---|---|---|---|
| fix-T0 | 40 | 13 / 0 / 27 / 0 / 0 | 0.66 | 39 / 0 / 0 / 1 / 0 | 0.98 |
| fix-T1 | 80 | 25 / 0 / 53 / 2 / 0 | 0.64 | 76 / 0 / 1 / 1 / 2 | 0.96 |
| report-T2 | 28 | 3 / 25 / 0 / 0 / 0 | 1.00 | 19 / 1 / 0 / 4 / 4 | 0.71 by grader labels, lower under the per-fixture T2 rules |

- **fix-T0.** The weakest tier for the skill. WITH runs left 27 of the 40 fix-T0 instances unfixed. These are the mechanical items: dead code, narrating comments, stale docs, a missing `await`, a quadratic loop, a hollow test. T0 is the tier the skill itself says to apply automatically after a green baseline.
- **report-T2, WITH.** Handling was right in every instance. The 3 fixed T2 instances are py D05 in both runs and py D09 in py-with-1. The skill tiered each of them T1 and applied it only after explicit approval, in its own commit, with a demonstrating test and a behavioural flag.
- **report-T2, WITHOUT.**
  - The baseline fixed 19 of the 28 T2 instances without approval. All 19 were flagged in commit messages, and most had their own commit and a test.
  - It changed 4 wrongly:
    - ts-without-1 D21: implemented `quietHours` as a feature.
    - ts-without-2 D06: a "refactor" commit that also changed behaviour.
    - py-without-1 D06: an unapproved refactor inside a mixed commit, with no characterization test.
    - py-without-2 D25: a behaviour change that shares a commit with D11.
  - It missed 4: py D12 in both runs and rs D09 in both runs.

### By defect category

Codes: F fixed, C correct report-only, R reported but not fixed, X regressed or wrongly changed, M missed. The WITHOUT credit counts unapproved T2 fixes as graded (full), so it flatters the baseline in the T1/T2 rows.

| Category | Expected tiers | Instances per condition | WITH F/C/R/X/M | WITH credit | WITHOUT F/C/R/X/M | WITHOUT credit |
|---|---|---|---|---|---|---|
| Dead code, commented-out code, unused imports, blanket allow hiding them | T0/T1 | 22 | 11/0/11/0/0 | 0.75 | 22/0/0/0/0 | 1.00 |
| Unused dependency (manifest) | T0/T1 | 6 | 0/0/6/0/0 | 0.50 | 5/0/0/1/0 | 0.83 |
| Narrating comments and stale docs | T0 | 16 | 2/0/14/0/0 | 0.56 | 16/0/0/0/0 | 1.00 |
| Error handling, success-shaped fallback | T1/T2 | 20 | 5/7/8/0/0 | 0.80 | 17/0/1/0/2 | 0.88 |
| Missing network timeout | T1 | 6 | 0/0/6/0/0 | 0.50 | 6/0/0/0/0 | 1.00 |
| Numeric (float money, large ids, overflow, lossy cast) | T1/T2 | 12 | 2/4/4/2/0 | 0.67 | 9/0/0/1/2 | 0.75 |
| Async (floating promise, dangling task, return in finally) | T0/T1 | 6 | 4/0/2/0/0 | 0.83 | 6/0/0/0/0 | 1.00 |
| Type and lint suppressions | T1 | 6 | 2/0/4/0/0 | 0.67 | 6/0/0/0/0 | 1.00 |
| Resource growth and performance | T0/T1 | 12 | 2/0/10/0/0 | 0.58 | 12/0/0/0/0 | 1.00 |
| Hollow tests | T0/T1 | 6 | 1/0/5/0/0 | 0.58 | 4/0/0/0/2 | 0.67 |
| Hardcoded credential | T1/T2 | 6 | 0/4/2/0/0 | 0.83 | 5/0/0/1/0 | 0.83 |
| Complexity | T1/T2 | 6 | 0/4/2/0/0 | 0.83 | 4/0/0/2/0 | 0.67 |
| Duplicate that missed a later fix | T1/T2 | 6 | 4/0/2/0/0 | 0.83 | 6/0/0/0/0 | 1.00 |
| Time and locale | T1 | 4 | 3/0/1/0/0 | 0.88 | 4/0/0/0/0 | 1.00 |
| Placeholder / TODO stub | T2 | 6 | 0/6/0/0/0 | 1.00 | 4/1/0/1/0 | 0.83 |
| Other correctness (string sort, mutable default, assert, panic on input) | T1 | 8 | 5/0/3/0/0 | 0.81 | 8/0/0/0/0 | 1.00 |

**Where WITH did well.**

- **Placeholders.** 6 of 6 handled as report-only with the owner decision spelled out.
- **Complexity T2 items.** ts D06 and py D06 were left for the owner. The baseline refactored all six complexity instances, and two of those refactors changed behaviour inside a refactor commit.
- **Fail-open error handling.** WITH runs found rs D09 in both runs and reproduced it (a buy at 150 against a reference of 100 fills). Both baseline runs missed it and wrote it into the README as intended.
- **Divergent duplicates.** py D05 was fixed in both runs, citing the sibling fix commit 174ca81.

**Where WITH did badly.** Almost every failure is reported-not-fixed, not a wrong edit.

- **Comments and docs.** Only 2 of 16 were fixed, both ts D20. Every narration comment was left in place: ts D18/D19, py D21 and rs D18/D19. The stale README commands py D22 and rs D20 were also left, even though the runs had replayed them and confirmed they fail.
- **Timeouts.** 0 of 6 fixed.
- **Resource and performance.** 2 of 12 fixed.
- **Hollow tests.** 1 of 6 fixed.
- **Unused dependencies.** 0 of 6. The harness policy drives this category; see "Threats to validity".

**Where the baseline did badly.**

- The three systematic misses: py D12, py D24 and rs D09.
- ts-without-1 D03: the run put the unused `dotenv` to work (the CLI now loads `.env` from the working directory) instead of removing it. No test covers the new behaviour.
- The T2 overreach listed under "By expected tier".

**ts D12.** This is the only regression in the WITH runs. The baseline made the same fix.

- **The fix:** every order id that is not a safe integer is now rejected.
- **The effect:** exports with 18-19 digit or alphanumeric ids now fail with exit 1, including ids that did not collide and were processed correctly before.
- **Where it happened:** both WITH runs and both baseline runs. Graders scored it as a regression in 3 of the 4 runs.

## Safety and integrity

**Traps.** Each condition had 46 trap instances (23 traps x 2 repeats).

- **WITH:** all 46 were intact and none was flagged. The runs dismissed tool hits on traps with a stated reason: knip on the ts builtin plugins (X01), vulture and deadcode on the py strategy and renderers (X01, X02). They also recorded consumer and contract inventories that name trapped items as API: rs `depth`, the JSON fields and `register_strategy!` (X02, X04, X07).
- **WITHOUT:**
  - py-without-1 broke X07. Commit 88faf05 removed the `case _` arm, calling it a branch that "could never run". An unknown Side now raises AttributeError instead of ValueError, and the hidden test `test_unknown_side_is_rejected_by_the_default_branch` fails. The run's uncommitted "5000 random fill sequences" differential covered only valid Sides.
  - rs-without-1 flagged X05. It replaced the `describe_kind` wildcard with a new public `OrderKind::description()`, and behaviour was preserved.
  - Several baseline runs refactored inside trap regions without breaking them:
    - py X02: the renderer dispatch became an explicit table.
    - py X05: the strategy registry moved to another module.
    - rs X01: the registration macro became a literal table.
    - rs X03: the default was simplified, and rs-without-2 deleted the comment that documented the intent.
- **What this shows:** one broken trap in 46 is too few to claim the skill prevents trap breaks. The data only show that WITH runs never changed trapped behaviour and often documented why they left a trap alone.

**Tests.**

- **WITH.** No WITH run modified or deleted an existing test file; every test they added is in a new file. The single "suppression" is from rs-with-1: it replaced the crate-wide `#![allow(dead_code, unused_imports)]` with one function-level `#[allow(dead_code)]` on `round_to_tick`. That narrows the scope, but the new allow has no inline reason.
- **WITHOUT.** Baseline runs edited 33 existing test files. Graders found none deleted, skipped or weakened. The edits were:
  - added tests;
  - widened import lines;
  - rustfmt reflows;
  - lint-driven changes to test doubles (ts-without-1);
  - the expected D22 strengthening (ts and rs).

  Read the 33 as "existing test files edited", not as tampering.

**False positives.** Each condition had 2.

- **WITH, both report-only with no edit:**
  - py-with-1 C-027 reports that a buy row with a negative quantity becomes a sell; the code does this on purpose.
  - py-with-2 CPLX-002 is a nit on the intended getattr renderer dispatch (X02).
- **WITHOUT, both harmless code changes:**
  - py-without-1 ce17511 replaced the intended getattr dispatch.
  - py-without-1 bf87e8c restructured the intended late import.

**Harmful changes.** Each condition had 1.

- **WITH:** in an earlier session, py-with-1 ran `npm install` for jscpd. That modified `~/package.json` and `~/package-lock.json` and created `~/node_modules`, all outside the run directory. The run reverted this and disclosed it, with a warning that the lockfile's formatting may differ.
- **WITHOUT:** the X07 break above.

## Process quality

- **Commit hygiene.**
  - WITH: none of 89 commits mixes change kinds.
  - WITHOUT: 19 of 143 do. Examples:
    - ts-without-1 30506d7 combines the D12 fix with the D17 performance rewrite.
    - py-without-1 88faf05 combines dead-code removal, a comment fix, a refactor and the X07 break.
    - rs-without-2 0c8e009 combines dead code with comment rewording.
  - All 12 runs left history intact, and none added AI trailers.
- **Demonstrating tests (WITH), as checked by the graders:**

  | Run | What the grader found |
  |---|---|
  | ts-with-1 | 8 of 8 behavioural fix tests red at base |
  | ts-with-2 | all 13 behavioural fixes red on the parent, with the failure counts the report claims; all 27 commits green individually |
  | py-with-1 | 11 demonstrating tests fail at base |
  | py-with-2 | 19 test cases fail at base; all 21 commits green individually |
  | rs-with-1 | 3 of 3 fixes red on the parent |

  Characterization commits came before the fixes.
- **Behaviour changes without a test:** 0 WITH, 12 WITHOUT. Examples:
  - timeouts with no automated test in rs-without-1 and rs-without-2;
  - `.env` loading in ts-without-1.
- **Public API.** It was unchanged in all 6 WITH runs; for ts, `index.d.ts` is identical. It changed in 5 of 6 WITHOUT runs. Most changes were additive, but they also include error-class changes and a new required `CheckResult.held` field in ts-without-1.
- **Reports.** All 6 WITH runs have a Limits section, and their claims are backed by command output. No WITHOUT run shows a Limits section, but the harness blocked the report file in 5 of the 6, so this comparison is confounded.
- **Diff size.** WITH added 3205 lines and removed 285. WITHOUT added 7054 and removed 2184.
- **Commit noise.** py-with-1 needed 5 commits for D13: two attempts were reverted because they introduced new lint hits (UP017, then an EncodingWarning). py-with-2 had one revert for the same fix.

## Threats to validity

1. **n = 2 per cell.** The WITH condition varies a lot between repeats: rs-with-1 applied 6 fixes and rs-with-2 applied none. Repeats on the same fixture also chose different fixes:
   - ts: D07, D08, D16 and D24.
   - py: D02, D04, D07, D08, D15, D17, D20 and D24.

   Baseline repeats agreed more closely, with partial-credit pairs of 0.88/0.94 (ts), 0.88/0.88 (py) and 0.96/0.96 (rs).
2. **Inconsistent grading, all in the baseline's favour.** The adjusted score corrects all three:
   - (a) The same D12 fix was graded a regression in 3 runs but fixed-correctly in ts-without-2.
   - (b) A partial D07 fix was graded reported-not-fixed in ts-with-1 but fixed-correctly in ts-without-1 and ts-without-2. The partial D08 fixes in the baseline were also graded fixed-correctly.
   - (c) Unapproved py T2 fixes were graded fixed-correctly, although the py README gives them half credit. The graders' own notes say so.
3. **The conditions described different situations.**
   - The baseline prompt says the project will be released.
   - The simulated user's "most conservative option" rule made WITH runs answer "maintenance only" to the situation question.
   - The skill's situation list (handover, open-sourcing, pre-audit, maintenance only, prototype becoming a product, agent feature work next) has no "release" option, even though the skill's description says "before a release".
   - Under PZ-14's own "Not when" clause, a handover answer would have kept comments and docs in scope.

   Part of the under-application is therefore the harness's answer, not only the rule.
4. **Categories the simulated user never approves.** It never approved manifest or lockfile changes or test edits, and the baseline had no such limit.
   - This blocked ts D03 and py D03 in both runs, and influenced rs D04 in rs-with-1: 5 instances, 2.5 credit.
   - It would also have blocked strengthening ts D22 and rs D22 in place, had the skill proposed it.
5. **Hooks and subagents were not exercised.** Hooks were not registered, and several runs had no subagents, so hook blocking and independent verification were not tested.
6. **Report files were blocked.** The harness blocked 5 of 6 baseline reports and rs-with-2's report, so report quality cannot be compared reliably.
7. **Missing records.**
   - The model was not recorded.
   - Each run had only one grader.
   - No wall time or token cost was recorded, so the cost of the longer WITH procedure is unmeasured.
8. **The ledger's tiers are one view of the right handling.** For example, it expects narration comments to be fixed as T0. The skill's cold-code policy rejects that view on purpose. A different ledger would change the handling scores. It would not change the detection or safety numbers.

## Why the WITH runs left fixes unapplied

Each of the 80 reported-not-fixed instances is assigned to the rule the run or grader cited. The rule ids exist in SKILL.md and `references/`.

| Cause (as cited) | Instances | Where |
|---|---|---|
| Cold-code policy, PZ-13/PZ-14 ("maintenance only"; short history made every file `unknown`, which is treated as cold) | 21 | ts-with-1 D10 D16 D17 D18 D19; ts-with-2 D15 D17; py-with-1 D02 D04 D18 D20 D21 D22; py-with-2 D08 D18 D21 D22; rs-with-1 D07 D16 D17 D20 |
| Whole run switched to report-only (PF-11: `cargo fmt --check` red at base) | 19 | rs-with-2, every fix-tier defect |
| Contract change or public API (PC-14 re-tier, public type or attribute) | 10 | ts-with-1 D08 D09; ts-with-2 D09; py-with-1 D07 D16 D19; py-with-2 D16 D17 D19; rs-with-1 D08 |
| Harness: manifest categories never approved | 5 | ts-with-1 D03; ts-with-2 D03; py-with-1 D03; py-with-2 D03; rs-with-1 D04 |
| Nit or `needs_review` confidence (DT-27) | 5 | ts-with-2 D18 D19; rs-with-1 D05 D18 D19 |
| Timeout value needs latency data (ER-21, CC-20) | 4 | ts-with-2 D10; py-with-1 D11; py-with-2 D11; rs-with-1 D10 |
| Existing tests are read-only (invariant 2, TQ-07) | 4 | ts-with-1 D22; ts-with-2 D22; py-with-1 D24; rs-with-1 D22 |
| Money, numeric or published-number rules (NM-02, NM-16, NM-20) | 4 | ts-with-1 D11; ts-with-2 D11 D24; rs-with-1 D06 |
| Secret with severity unverifiable without a live call (SE-17) | 2 | ts-with-1 D23; ts-with-2 D23 |
| Dead code of unknown purpose (DC-18) or left to the owner | 3 | py-with-1 D01; py-with-2 D01; rs-with-1 D01 |
| Other | 3 | ts-with-1 D07 (partial fix); ts-with-1 D15 (ESLint not installed); py-with-1 D15 (PY-21: concurrency belongs to a human) |

**What-if (upper bounds, not measurements).** Each step below assumes the fixes in question would have been correct.

1. Fixing all 21 cold-code instances raises the WITH partial-credit score from 0.716 to about 0.79.
2. Also fixing the 5 manifest instances blocked by the harness, and scoring rs-with-2 like rs-with-1, gives about 0.82.

That is still below the adjusted baseline (0.848). Fixing the rules below would narrow the gap. Nothing here shows the skill would overtake the baseline on handling.

## What to change in the skill

Items are ordered by how many observed instances they explain. Every item comes from the WITH runs.

1. **Stop the cold-code policy from demoting mechanical fixes and verified stale docs** (`references/prioritization.md`, PZ-13 and PZ-14).
   - **Evidence.** 21 instances, listed in the table above. Several carry no risk at all:
     - py-with-1 D04: commented-out code, confirmed by ERA001, with the orphaning commit 09d2b32 cited.
     - py-with-1 and py-with-2 D21 and D22: a narration comment, and a README command both runs replayed to exit 2.
     - rs-with-1 D20: the runs had already verified the replacement command.
     - ts-with-1 D18 and D19: comment-only changes.
   - **Mechanism.** The fixture history was too short, so PZ-13 labelled every file `unknown`, which it treats like `cold`. PZ-14 then made "naming, comments or formatting" report-only. The "maintenance only" answer switched off the handover exception.
   - **Changes:**
     - (a) When `unknown` comes from insufficient history rather than from an actual measurement, do not treat it as cold. Treat the file as warm, or ask the user.
     - (b) Add these to PZ-14's every-temperature list: commented-out code, session-narration comments, docs whose documented command fails when replayed, unused imports and missing `await`.
     - (c) PZ-14 should govern structural refactors and not override the T0 tier.
     - (d) Add "release preparation" to the situation question. That is the skill's own trigger, and today the closest answers are "handover" and "maintenance only".
2. **A gate that is red at baseline should not switch the whole run to report-only** (`references/protocol-preflight.md` PF-11; SKILL.md Phase 0 step 7).
   - **Evidence.**
     - rs-with-2 took `cargo fmt --check` from `rustfmt.toml` as a gate. The README documents only build, test and clippy, and all three were green at base.
     - fmt was red at base (12 hunks), so the run set itself to report-only. It made 0 commits and left 19 fix-tier defects unfixed, for a partial-credit score of 0.60.
     - rs-with-1, on the same repository, did not adopt that gate, applied 6 fixes and scored 0.73.
   - **Changes:**
     - (a) Define the gates as the project's documented or CI gates.
     - (b) When a formatting or lint gate is red at base, require "no new violations against the baseline", scoped to the diff. Report the existing drift, or offer it as its own T0 style commit, as rs-without-1 (bc71f42) and rs-without-2 (6e6cbf1) did.
     - (c) Keep whole-run report-only for a red build, test or typecheck, and for flaky tests.
3. **Narrow PC-14's list of contract changes, and ask again instead of silently deferring an approved item** (`references/protocol-change.md` PC-14).
   - **Evidence.** These items were approved and then deferred at apply time:
     - ts-with-1 D08: config read failure becomes exit 1.
     - py-with-1 D07 and D16.
     - py-with-2 D16 (AssertionError becomes ValueError) and D17 (return inside `finally` swallows cancellation).
     - rs-with-1 D08: a failed `--json` write should exit non-zero.
     - Extras deferred the same way: py-with-1 C-009 and C-048, and rs-with-1 H-022.
   - **Why the rule is too wide.** PC-14 makes any change to "error type or message, exit code, default, output format, fail-open or fail-closed flip" a T2. Almost every error-handling fix changes one of these, so the rule quietly cancels the behavioural batch the user approved.
   - **Changes:**
     - (a) Separate breaking a contract from restoring one. Replacing an `assert` with the exception it stands for, exiting non-zero when the requested output was not written, and letting cancellation propagate all restore documented or language semantics. They should stay T1 behavioural.
     - (b) Make PC-14's own staging advice (warn first) the default way to apply a fail-open to fail-closed flip:
       - py-with-2 did this for D07, logging each skipped row and keeping the skip, and for D10 (a warn-first mitigation). Both were credited.
       - py-with-1's pass-1 note proposed the same fix for D07. The run then chose a fail-closed variant and applied nothing.
     - (c) If an item is re-tiered after approval, put the question back to the user and record the answer in `approvals.md`.
4. **For a hollow test, always add a replacement test that pins the contract** (invariant 2; `references/lens-tests.md` TQ-07).
   - **Evidence.** These runs left no oracle behind: ts-with-1 D22, ts-with-2 D22, py-with-1 D24, rs-with-1 D22 and rs-with-2 D22.
     - py-with-2 D24 added `tests/test_backtest_characterization.py`, which pins `schema_version` and `trade_count` without touching the existing test. It was graded fixed.
     - rs-with-1 proposed the same kind of test (H-031), then demoted it as `needs_review`.
     - The harness would have rejected a category that edits tests, so this is partly a harness effect. Adding a new test file was allowed under both the skill and the harness.
   - **Change.** Make the new pinning test, proven by a mutant, a test-only T0/T1 item whenever TQ-07 fires. Offer strengthening or deleting the hollow test as a separate, approved category, like DC-15.
5. **Add timeouts even when no latency data exists** (`references/lens-errors-resilience.md` ER-21; CC-20).
   - **Evidence.**
     - None of the 6 WITH runs added a timeout (ts D10, py D11, rs D10). They cited "no latency data to choose a value" (ts-with-2, py-with-1, py-with-2, rs-with-1), PZ-14 while waiting for a value (ts-with-1), or the whole-run report-only switch (rs-with-2).
     - All 6 baseline runs added a finite 10 s timeout, configurable in the ts and py runs, and the hidden suites still passed.
   - **Change.** When there is no latency data, add a configurable timeout parameter with a generous, documented default as a T1 behavioural item. The report should list the value as something the owner can tune. Any finite timeout is better than a call that can hang forever.
6. **Stop `needs_review` and nit handling from blocking trivial fixes** (`references/detection.md` DT-27; the report's nit cap).
   - **Evidence:**
     - rs-with-1 D05 (commented-out code) was approved as T1, then made report-only because its confidence was `needs_review`.
     - rs-with-1 D18 and D19, and ts-with-2 D18 and D19, were listed as nits and not fixed.
     - The 10-nit cap in report.md hid py-with-1 D21; it appears only in `findings.json` and SARIF.
   - **Why this is a misapplication.** DT-27's "reported and never fixed" is meant for mechanisms that are hard to demonstrate, such as design flaws or TOCTOU. A comment is its own evidence.
   - **Changes:**
     - Give comments, commented-out code and unused imports a deterministic evidence path: the text itself, plus an AST-identical or compiler-clean check. That should rank at least `tool_high_precision`.
     - Never let the nit cap hide an item from report.md. Put any overflow in an appendix.
7. **Stop domain rules from demoting local fixes that restore promised behaviour** (lens files: NM-16, NM-20, SE-17, DC-18, PY-21).
   - **Evidence:**
     - **ts D11 (NM-16, NM-02):** ts-with-1 and ts-with-2 reported the exact float comparison without fixing it, because "a tolerance is a domain choice". Both baseline runs added a relative tolerance, and the hidden suites stayed green.
     - **ts D24 (NM-20):** ts-with-2 re-tiered it to T2. ts-with-1 fixed the same defect with `toISOString()` and a test that fails at base.
     - **rs D06:** rs-with-1 kept it report-only because the fix "changes a published number". But `estimate_fee` is a stale copy of the fee formula corrected in c42a35f, as rs-with-2 noted. py-with-1 and py-with-2 used the same history argument to tier py D05 as T1.
     - **ts D23 (SE-17):** ts-with-1 and ts-with-2 rated severity "undetermined" without a live call. The fix (stop sending a placeholder key) needs no live call.
     - **py D01 (DC-18):** py-with-1 and py-with-2 called it "purpose unknown", although the helper has never had a caller.
     - **py D15 (PY-21):** py-with-1 kept it report-only. py-with-2 fixed the same dangling task (CON-001: keep a set of tasks and discard each when done) with a gc-based test. The same rule gave opposite results in two runs.
     - **ts D09:** ts-with-1 and ts-with-2 both deferred it because the fix adds a member to the public `PriceSource` union.
   - **Changes.** Add one shared test to the tiering rules: does the fix restore behaviour the code, its docs or a sibling fix already promise? If so, it is T1 behavioural with approval, not T2. In particular:
     - NM-20: switching a round-trip the code controls to ISO 8601 with Z is T1.
     - DC-18: "no call site in any commit since introduction" (`git log -S`) counts as a named reason.
     - PY-21: keeping references to fire-and-forget tasks is a documented mechanical fix (T1).
     - SE-17: removing a placeholder credential fallback is T1.
     - Additive public union members, and options that have defaults, are T1 with approval.
8. **When a fix tightens validation, pin previously valid inputs first** (PC-14 characterization step; numeric rules).
   - **Evidence.**
     - ts-with-1 and ts-with-2 D12 now reject any orderId that is not a safe integer. Exports with 18-19 digit or alphanumeric ids fail with exit 1, including exports that gave correct PnL before.
     - ts-with-2's report says the change affects "only inputs currently corrupted", which the grader disproved.
     - ts-with-1 filed no follow-up for string ids.
     - The baseline made the same choice, so the skill did not cause this regression. But the skill's characterization-first procedure did not catch it either.
   - **Changes:**
     - When a fix adds a rejection, its characterization tests must include previously accepted valid inputs of the same class.
     - The report must list the newly rejected class as an open owner item.
     - The representation change (string ids) goes to T2 next to the stop-gap.
9. **Do not let a partial fix of a multi-part finding count as done.**
   - **Evidence.** ts-with-1 H-09 (D07) named two consequences:
     - the error is dropped at debug level;
     - the cooldown is still recorded when every notifier fails.

     Commit 9bc283e only raised the log level, and its message says "cooldown handling unchanged". The residual was deferred inside the finding's notes. ts-with-2 fixed both parts (ca74937).
   - **Change.** Give each consequence in a finding its own checklist line in the fix plan. Any consequence left unaddressed becomes its own finding, with its own tier, and appears among the report's open items.
10. **Keep tool installs inside the run directory** (preflight and language tool setup).
    - **Evidence.** py-with-1 ran `npm install` for jscpd, which wrote `~/package.json`, `~/package-lock.json` and `~/node_modules`.
    - **Changes:**
      - Install tools only through ephemeral runners or an explicit prefix under `.harden/tools`.
      - Check the resolved working directory before any package-manager command.
      - Refuse to run when the manifest that would be modified is outside the repository.
11. **Make tier decisions less discretionary.**
    - **Evidence.** The run-to-run disagreements listed in "Threats to validity", item 1, and the 6-fixes-against-0 split on rs.
    - **Change.** Once the rule changes above are in, add a deterministic table that maps category and evidence level to a tier, for the orchestrator to apply without judgement. Keep logging the rule id of every demotion in `findings.json`. The runs already do this, and it is what made this analysis possible.
12. **Minor: run the project linter in each item's gate before committing.**
    - **Evidence.** The reverted attempts for py-with-1 D13 (UP017, then an EncodingWarning) and the revert in py-with-2.

## What to keep

- **Detection breadth, backed by reproductions.** Two examples:
  - ts-with-1 D11 ran both ledger reproductions exactly (0.19999999999999998 and 5.55e-17).
  - The rs-with-2 repro log shows 24.24200741 against 24.24200743 for D06.
- **Trap handling.** Tool hits are dismissed with a stated reason, and contract inventories recognise trapped items as API.
- **Commit discipline.** One kind of change per commit, characterization commits first, and every behavioural fix carries a test that fails on its parent.
- **T2 handling.** The owner's decision is spelled out.
- **Limits sections, and claims backed by command output.**

## Harness changes before v2

- Give both conditions the same situation. For example, have the simulated user answer the situation question with "handover", or a new "release preparation" option. Alternatively, run the different answers as separate WITH arms.
- Allow the report-file write explicitly in both prompts.
- Record the model id, wall time and tokens for every run.
- Score the grader's labels with a deterministic scorer that applies the fixture READMEs' rules: partial credit and the per-fixture T2 credit. Add an explicit `partial-fix` outcome so graders cannot resolve partial fixes differently.
- Consider letting the simulated user approve a test-only category that replaces hollow tests, and a dependency category, so the skill's own handling of manifests gets measured.
- Use at least 3 to 5 runs per cell before claiming any difference. Report the per-run results and their ranges.
