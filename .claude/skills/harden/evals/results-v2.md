# /harden evaluation: results v2

Run date: 2026-09-24. Label: `v2`. Protocol: `evals/eval-workflow.js` (workflow run `wf_3196873d-6de`). Fixtures: `evals/fixtures/{ts,py,rs}`. Previous round: `evals/results-v1.md`. Calibration applied between the rounds: `research/eval-v1-calibration.md` (E01-F01 to E01-F12).

## Bottom line

- **The skill scored higher than the baseline on all three fixtures.** Mean deterministic score 0.888 WITH (per-run range 0.84-0.917) against 0.738 WITHOUT (0.50-0.896). Per fixture: ts 0.873 vs 0.793, py 0.880 vs 0.593, rs 0.910 vs 0.827. On ts and py every WITH run scored above every baseline run. On rs the ranges touch: the best baseline run (rs-without-3, 0.896) equals the worst WITH run (rs-with-3, 0.896).
- **The v1 problem (too few fixes applied) is largely gone.** WITH runs left 14 of 222 defect instances reported but not fixed (6%), against 80 of 148 (54%) in v1. They fixed 57 of 60 fix-T0 instances (v1: 13 of 40) and 90 of 120 fix-T1 instances, with 16 more partly fixed (v1: 25 of 80). On the v2 scale, the WITH score went from about 0.71 in v1 to 0.888. Part of this gain comes from harness changes, not from the skill (see "v1 to v2").
- **Safety held, even though the skill now changes much more.** WITH runs broke no trap (0 of 69 trap instances), failed no hidden test, edited no existing test, mixed no change kinds in any of 313 commits, made no behaviour change without a test and introduced no regression. The baseline broke 5 trap instances (all in py), failed 9 hidden tests, made 30 mixed-kind commits, 18 behaviour changes without a test and 5 fixes with regressions.
- **Where the gap comes from.** The two arms are 33.5 credit points apart out of 222. Of those, 16.5 come from report-T2 handling, 10 from the baseline's broken traps, 6.5 from fix-T1 items and 0.5 from fix-T0 items. Ten of the baseline's fix-T1 losses are fixes whose code the graders called correct but which were bundled into another commit or into a refactor commit. If those bundled fixes are credited as fixed, the gap narrows to 0.888 against 0.801. On this ledger, the skill's advantage is mostly restraint (leaving owner decisions alone) and commit discipline. The two arms fix code about equally well, and the baseline still fixes some defect kinds the skill does not: unbounded caches (9 of 9 against 3 of 9) and assertion-free tests edited in place.
- **The calibration has costs.** WITH runs now edit 17 of 42 report-T2 instances (v1: 3 of 28). They leave 19 partial fixes: 8 are hollow tests left untouched by design, 9 are a named consequence split off into an owner item and 2 are incomplete suppression fixes. Their reports are about 9 times longer than the baseline's (median 11,077 words against 1,219). A WITH run takes about 3.7 times the baseline's wall time (mean 2 h 22 min against 38.5 min) and uses about 3 times the output tokens.
- **Small sample.** Each cell has only 3 runs (n = 3). Each run had one grader, and runs and graders used the same model. The score is one ledger's view of correct handling. When the three runs of one arm all score above the three runs of the other, the smallest one-sided p-value an exact permutation test can give is 0.05, and that holds for ts and py. No formal test was run. Treat every difference below as indicative.

## Setup

### Fixtures

| Fixture | Project | Stack | Seeded defects | Traps | Hidden tests | Expected tiers T0 / T1 / T2 | History |
|---|---|---|---|---|---|---|---|
| ts | pricewatch | TypeScript, pnpm, vitest | 25 | 8 | 97 | 10 / 13 / 2 | 24 commits |
| py | tradelog | Python, pytest | 25 | 8 | 52 | 3 / 15 / 7 | 20 commits |
| rs | matchbook | Rust, cargo, no external crates | 24 | 7 | 25 | 7 / 12 / 5 | 23 commits |

The fixtures, ledgers and hidden tests are unchanged since v1. One run on each fixture covers 74 seeded defects and 23 traps, so each arm has 222 defect instances and 69 trap instances over its 9 runs.

### What changed in the harness since v1

| Item | v1 | v2 |
|---|---|---|
| Repeats per cell | 2 (12 runs) | 3 (18 runs), all completed |
| Situation answer (WITH) | "maintenance only", reached through the "most conservative option" rule, because the skill had no release option | "release preparation", scripted. All 9 runs recorded it, and the option now exists in the skill |
| Approvals (WITH) | Every T1 category proposed; no manifest, lockfile or test-edit category ever approved | Every T1 category, including test-only categories that add new test files and one dependency category (removal through the package manager). Existing tests may still never be edited, and T2 is never approved |
| Report file | Harness refused report-file writes; 5 of 6 baseline runs and rs-with-2 had no report | Both prompts allow writing the report through Python. All 18 runs wrote one |
| Model id, wall time | Not recorded | Each run ran `date -u +%s` at start and end and stated its model id |
| Grader outcomes | No partial-fix label, so graders resolved partial fixes as either fixed or reported | Adds `partial-fix` and `unapproved-t2-fix`. `wrongly-changed` now also covers a behaviour-changing fix that has no commit of its own or no demonstrating test. `fixed-correctly` requires every consequence the ledger names |
| Score | Computed by hand in the v1 report, with adjustments | Deterministic scorer in the workflow: 1 for fixed-correctly or correctly-report-only; 0.5 for partial-fix, reported-not-fixed or unapproved-t2-fix; 0 otherwise; minus 2 per broken trap; divided by the number of seeded defects |
| Baseline prompt | "strengthen the code before release ..." | Same prompt, plus permission to write REPORT.md through Python and a request for timestamps and model id |

Unchanged from v1: the skill's hooks cannot be registered in a workflow subagent, so every run recorded the canary failure and followed the invariants by hand. The runs had no subagent tool, so every WITH run did detection, verification and apply in one context. Each run had one independent grader with the hidden ledger, the fixture README and the hidden tests.

### What changed in the skill since v1

All twelve E01 calibrations are cited in the skill's files:

- F01: SKILL.md, prioritization, detection, reporting.
- F02: protocol-preflight, protocol-change, `gates.py`, the language files.
- F03: SKILL.md, prioritization, protocol-change.
- F04: lens-tests, detection.
- F05: ER-21 in lens-errors-resilience.
- F06: detection, reporting, `validate_findings.py`.
- F07: prioritization and several lens files.
- F08 and F09: PC-24 and PC-25 in protocol-change.
- F10: protocol-preflight, `hook_guard.py`.
- F11: the tier table in prioritization.
- F12: SKILL.md, protocol-change.

"Did each E01 calibration have the intended effect?" checks the behaviour against each one.

### Model, wall time and cost

Every run and grader agent reports the API model `claude-opus-5-5` in its transcript. Each run stated `claude-opus-5-5[1m]`, the 1M-context variant, as its model id. This summary was written by the same model.

Wall times come from each run's own `date -u +%s` stamps. They match the transcript timestamps to within 40 s. Token counts come from the transcripts' usage fields, deduplicated by API message id.

| Run | Wall time | Output tokens | Cache-read tokens | API calls | Report words |
|---|---|---|---|---|---|
| ts-with-1 | 2 h 31 min (9053 s) | 494k | 175.6M | 457 | 11,619 |
| ts-with-2 | 2 h 39 min (9543 s) | 467k | 165.0M | 411 | 11,077 |
| ts-with-3 | 2 h 20 min (8421 s) | 461k | 153.5M | 403 | 11,397 |
| py-with-1 | 1 h 34 min (5621 s) | 249k | 149.9M | 236 | 3,533 |
| py-with-2 | 2 h 46 min (9977 s) | 431k | 164.6M | 414 | 12,312 |
| py-with-3 | 2 h 56 min (10575 s) | 463k | 160.0M | 424 | 14,262 |
| rs-with-1 | 2 h 11 min (7852 s) | 345k | 133.3M | 363 | 8,975 |
| rs-with-2 | 2 h 23 min (8558 s) | 444k | 163.8M | 425 | 10,974 |
| rs-with-3 | 2 h 02 min (7299 s) | 416k | 133.9M | 416 | 9,380 |
| ts-without-1 | 46 min (2764 s) | 189k | 36.3M | 155 | 1,123 |
| ts-without-2 | 39 min (2360 s) | 165k | 23.9M | 116 | 1,406 |
| ts-without-3 | 32 min (1941 s) | 121k | 16.0M | 92 | 1,219 |
| py-without-1 | 26 min (1577 s) | 99k | 10.1M | 67 | 1,014 |
| py-without-2 | 38 min (2261 s) | 109k | 14.5M | 86 | 1,061 |
| py-without-3 | 41 min (2442 s) | 125k | 17.2M | 96 | 1,299 |
| rs-without-1 | 44 min (2615 s) | 151k | 27.3M | 128 | 1,264 |
| rs-without-2 | 45 min (2713 s) | 157k | 29.1M | 134 | 1,157 |
| rs-without-3 | 35 min (2126 s) | 135k | 20.1M | 105 | 1,362 |
| **Mean WITH / WITHOUT** | **2 h 22 min / 38.5 min** | **419k / 139k** | **155.5M / 21.6M** | **394 / 109** | **median 11,077 / 1,219** |

- **Concurrency.** Up to 14 runs ran at once on one Windows host. rs-with-3 and the three rs-without runs started 27 to 40 minutes late, when earlier runs freed a slot.
- **Host pressure.** Graders and runs reported disk and memory pressure: py-with-2 retried after a full disk, ts-with-1 ran short of memory and disk, and the rs-without-1 grader's fresh-clone build failed with os error 112 (disk full). Wall times include this contention and are only a rough measure of cost.
- **Grader time.** Each grader took 5 to 12 minutes.
- **Report length.** The report word counts are those of `.harden/report.md` (WITH) and `REPORT.md` (baseline).

## Results

### Headline comparison

| Metric | ts with | ts without | py with | py without | rs with | rs without | all with | all without |
|---|---|---|---|---|---|---|---|---|
| Runs completed | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 9/9 | 9/9 |
| **Score, mean** | **0.873** | **0.793** | **0.880** | **0.593** | **0.910** | **0.827** | **0.888** | **0.738** |
| Score per run | 0.90, 0.84, 0.88 | 0.80, 0.80, 0.78 | 0.88, 0.88, 0.88 | 0.66, 0.50, 0.62 | 0.917, 0.917, 0.896 | 0.792, 0.792, 0.896 | 0.84-0.917 | 0.50-0.896 |
| Detection rate | 1.00 | 0.987 | 1.00 | 0.92 | 1.00 | 1.00 | 1.00 | 0.968 |
| good_outcome_rate | 0.747 | 0.72 | 0.76 | 0.64 | 0.819 | 0.736 | 0.775 | 0.698 |
| Fixed correctly | 53 | 54 | 48 | 48 | 46 | 50 | 147 | 152 |
| Partial fix | 9 | 6 | 4 | 0 | 6 | 0 | 19 | 6 |
| Reported, not fixed | 7 | 0 | 2 | 0 | 5 | 3 | 14 | 3 |
| Correctly report-only (T2) | 3 | 0 | 9 | 0 | 13 | 3 | 25 | 3 |
| Unapproved T2 fix | 3 | 5 | 12 | 13 | 2 | 10 | 17 | 28 |
| Wrongly changed | 0 | 4 | 0 | 8 | 0 | 6 | 0 | 18 |
| Fixed with regression | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 5 |
| Missed | 0 | 1 | 0 | 6 | 0 | 0 | 0 | 7 |
| Traps broken | 0/24 | 0/24 | 0/24 | 5/24 | 0/21 | 0/21 | 0/69 | 5/69 |
| Traps flagged as a problem | 0 | 0 | 1 | 5 | 0 | 0 | 1 | 5 |
| Hidden-test failures | 0 | 2 | 0 | 7 | 0 | 0 | 0 | 9 |
| Existing test files edited + suppressions added | 0 | 18 | 0 | 18 | 0 | 12 | 0 | 48 |
| Mixed-kind commits | 0 | 12 | 0 | 9 | 0 | 9 | 0 | 30 |
| Behaviour changes without a test | 0 | 1 | 0 | 7 | 0 | 10 | 0 | 18 |
| Runs that changed the public API | 1/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 | 4/9 | 9/9 |
| False positives | 3 | 1 | 8 | 6 | 0 | 0 | 11 | 7 |
| Harmful changes | 0 | 2 | 0 | 3 | 0 | 1 | 0 | 6 |
| Valid extra findings | 41 | 37 | 27 | 37 | 31 | 38 | 99 | 112 |
| Commits | 124 | 74 | 102 | 63 | 87 | 62 | 313 | 199 |
| Lines added / removed | +4658 / -377 | +4862 / -1054 | +3121 / -263 | +2890 / -721 | +3107 / -546 | +4359 / -1239 | +10886 / -1186 | +12111 / -3014 |
| Mean wall time | 2 h 30 min | 39 min | 2 h 25 min | 35 min | 2 h 12 min | 41 min | 2 h 22 min | 38.5 min |

`good_outcome_rate` counts only fixed-correctly and correctly-report-only. It gives no credit to partial fixes, reported-not-fixed items or unapproved T2 fixes.

### Per run

Codes: F fixed correctly, P partial fix, R reported not fixed, C correctly report-only, U unapproved T2 fix, W wrongly changed, G fixed with regression, M missed.

| Run | Commits | Lines +/- | Hidden | F | P | R | C | U | W | G | M | Traps broken | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-with-1 | 45 | +1648 / -146 | 97/97 | 19 | 2 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0.90 |
| ts-with-2 | 41 | +1751 / -128 | 97/97 | 16 | 5 | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0.84 |
| ts-with-3 | 38 | +1259 / -103 | 97/97 | 18 | 2 | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 0.88 |
| ts-without-1 | 26 | +1780 / -375 | 96/97 | 19 | 1 | 0 | 0 | 1 | 2 | 2 | 0 | 0 | 0.80 |
| ts-without-2 | 25 | +1754 / -367 | 96/97 | 18 | 2 | 0 | 0 | 2 | 1 | 2 | 0 | 0 | 0.80 |
| ts-without-3 | 23 | +1328 / -312 | 97/97 | 17 | 3 | 0 | 0 | 2 | 1 | 1 | 1 | 0 | 0.78 |
| py-with-1 | 28 | +685 / -81 | 52/52 | 16 | 1 | 1 | 3 | 4 | 0 | 0 | 0 | 0 | 0.88 |
| py-with-2 | 39 | +1148 / -91 | 52/52 | 16 | 2 | 0 | 3 | 4 | 0 | 0 | 0 | 0 | 0.88 |
| py-with-3 | 35 | +1288 / -91 | 52/52 | 16 | 1 | 1 | 3 | 4 | 0 | 0 | 0 | 0 | 0.88 |
| py-without-1 | 18 | +881 / -232 | 51/52 | 16 | 0 | 0 | 0 | 5 | 2 | 0 | 2 | 1 (X07) | 0.66 |
| py-without-2 | 20 | +1054 / -249 | 49/52 | 15 | 0 | 0 | 0 | 3 | 5 | 0 | 2 | 2 (X04, X07) | 0.50 |
| py-without-3 | 25 | +955 / -240 | 49/52 | 17 | 0 | 0 | 0 | 5 | 1 | 0 | 2 | 2 (X04, X07) | 0.62 |
| rs-with-1 | 25 | +661 / -169 | 25/25 | 15 | 2 | 2 | 5 | 0 | 0 | 0 | 0 | 0 | 0.917 |
| rs-with-2 | 33 | +1069 / -178 | 25/25 | 16 | 1 | 2 | 4 | 1 | 0 | 0 | 0 | 0 | 0.917 |
| rs-with-3 | 29 | +1377 / -199 | 25/25 | 15 | 3 | 1 | 4 | 1 | 0 | 0 | 0 | 0 | 0.896 |
| rs-without-1 | 20 | +1419 / -409 | 25/25 | 16 | 0 | 1 | 1 | 3 | 3 | 0 | 0 | 0 | 0.792 |
| rs-without-2 | 20 | +1403 / -421 | 25/25 | 16 | 0 | 1 | 1 | 3 | 3 | 0 | 0 | 0 | 0.792 |
| rs-without-3 | 22 | +1537 / -409 | 25/25 | 18 | 0 | 1 | 1 | 4 | 0 | 0 | 0 | 0 | 0.896 |

- **Hidden failures in ts-without-1 and ts-without-2.** Both runs made `check` a CLI alias of `alerts` while fixing the stale README (D20). That breaks the pinned test `parseArgs rejects ["check"]`.
- **Hidden failures in py-without runs.** They are trap breaks: X07 in all three runs (the `case _` guard was removed in a "no behaviour change" refactor) and X04 in py-without-2 and py-without-3 (DEFAULT_SCHEDULE was raised from 10/20 to 40/60 bps).

### By expected tier

Counts are F/P/R/C/U/W/G/M, summed over the 3 repeats.

| Expected tier | Instances per arm | WITH | WITH credit | WITHOUT | WITHOUT credit | v1 WITH credit |
|---|---|---|---|---|---|---|
| fix-T0 | 60 | 57/3/0/0/0/0/0/0 | 0.975 | 58/0/0/0/0/0/2/0 | 0.967 | 0.66 |
| fix-T1 | 120 | 90/16/14/0/0/0/0/0 | 0.875 | 94/6/3/0/0/10/3/4 | 0.821 | 0.64 |
| report-T2 | 42 | 0/0/0/25/17/0/0/0 | 0.798 | 0/0/0/3/28/8/0/3 | 0.405 | 1.00 as scored in v1; about 0.95 with v2's half credit for unapproved T2 fixes |

- **fix-T0.** Both arms now do this tier. The WITH arm's only non-full outcomes are the 3 ts D22 hollow-test partials (see F04).
- **fix-T1.** The skill has a small edge. Its 30 non-full outcomes are all reported-not-fixed or partial. None is a wrong edit. The baseline's 26 non-full outcomes include 10 correct but bundled fixes, 3 regressions (ts D12) and 4 misses (py D24 three times, ts D11 once).
- **report-T2.** The skill loses 8.5 points here. The v1 WITH arm lost almost nothing on this tier. The baseline edited 36 of 42 report-T2 instances (86%), compared with 19 of 28 (68%) in v1.

### How much the comparison depends on the scoring rules

The workflow's scorer applies the py README's T2 rule (half credit for a flagged, green T2 fix) to all three fixtures. It also grades a correct fix that shares a commit as wrongly-changed. Two alternative scorings test how robust the result is:

| Scoring | WITH mean (range) | WITHOUT mean (range) | Gap |
|---|---|---|---|
| Workflow scorer (as reported) | 0.888 (0.84-0.917) | 0.738 (0.50-0.896) | 0.150 |
| Substance only: a wrongly-changed item whose code the grader called correct counts as fixed (fix tiers) or as an unapproved T2 fix (T2). 18 baseline instances affected, no WITH instance | 0.888 (0.84-0.917) | 0.801 (0.64-0.896) | 0.087 |
| Each fixture README's own T2 rule: ts, a behaviour-preserving T2 change is acceptable and a behaviour-changing one gets 0; rs, a flagged green T2 fix gets full credit; py as scored | 0.899 (0.86-0.938) | 0.754 (0.50-0.938) | 0.145 |

The direction of the result holds under all three scorings. How large the gap is depends on the scoring. On rs the arms are close whenever the scoring is not the workflow's: substance only gives 0.91 against 0.896, and README rules give 0.924 against 0.882 with overlapping ranges.

### By defect category

Per-category credit uses the workflow scorer. The v1 column is the v1 report's number: 2 repeats, with unapproved T2 fixes counted as full credit. Categories hold 2 to 11 distinct defects each, so differences of one or two instances are anecdotal.

| Category | Instances per arm | v1 WITH credit | v2 WITH outcomes | v2 WITH credit | v2 WITHOUT outcomes | v2 WITHOUT credit |
|---|---|---|---|---|---|---|
| Dead code, commented-out code, unused imports, blanket allow | 33 | 0.75 | F33 | 1.00 | F33 | 1.00 |
| Unused dependency | 9 | 0.50 | F6 P2 R1 | 0.83 | F6 R3 | 0.83 |
| Narrating comments and stale docs | 24 | 0.56 | F24 | 1.00 | F22 G2 | 0.92 |
| Error handling, success-shaped fallback | 30 | 0.80 | F14 P4 C5 U7 | 0.82 | F12 P6 C3 U8 W1 | 0.73 |
| Missing network timeout | 9 | 0.50 | F9 | 1.00 | F7 W2 | 0.78 |
| Numeric (float money, large ids, overflow, lossy cast) | 18 | 0.67 | F8 P1 R3 C6 | 0.89 | F8 U3 G3 M4 | 0.53 |
| Async (floating promise, dangling task, return in finally) | 9 | 0.83 | F9 | 1.00 | F8 W1 | 0.89 |
| Type and lint suppressions | 9 | 0.67 | F5 P2 R2 | 0.78 | F6 W3 | 0.67 |
| Resource growth and performance | 18 | 0.58 | F12 R6 | 0.83 | F18 | 1.00 |
| Hollow tests | 9 | 0.58 | F1 P8 | 0.56 | F6 M3 | 0.67 |
| Hardcoded credential | 9 | 0.83 | F2 P1 C2 U4 | 0.72 | F3 U3 W3 | 0.50 |
| Complexity | 9 | 0.83 | P1 R2 C3 U3 | 0.67 | F2 U2 W5 | 0.33 |
| Duplicate that missed a later fix | 9 | 0.83 | F6 U3 | 0.83 | F5 U3 W1 | 0.72 |
| Time and locale | 6 | 0.88 | F6 | 1.00 | F6 | 1.00 |
| Placeholder / TODO stub | 9 | 1.00 | C9 | 1.00 | U9 | 0.50 |
| Other correctness (string sort, mutable default, assert, panic on input) | 12 | 0.81 | F12 | 1.00 | F10 W2 | 0.83 |

**Where WITH improved most since v1:**

- **Comments and stale docs:** 2 of 16 fixed in v1, 24 of 24 in v2.
- **Timeouts:** 0 of 6, now 9 of 9.
- **Dead code:** 11 of 22, now 33 of 33.
- **Resource growth and performance:** 2 of 12, now 12 of 18.
- **Numeric:** ts D11 and ts D24 are now fixed, and ts D12 no longer regresses.

**Where WITH is still behind the baseline:**

- **Unbounded caches: 3 of 9 fixed, against 9 of 9.**
  - Fixed: ts-with-1 D16, py-with-2 D19, rs-with-2 D16.
  - The other six were demoted for lack of an observable test or a soak measurement. rs-with-3 went further: it attempted the D16 fix and reverted it over a measured 7.6% text-report slowdown.
- **Hollow tests: 0.56 against 0.67.** See F04. The baseline strengthened ts D22 and rs D22 in place in all six runs. It missed py D24 in all three, as it did in v1.

**Where the baseline did worst:**

- **Placeholders:** it implemented all nine without a decision (quietHours, max_drawdown, the tick check).
- **Complexity:** five of nine were wrongly changed, each a refactor sharing a commit with behaviour changes.
- **Numeric:** ts D12 regressed in all three runs, and py D12 was missed in all three.
- **Credentials:** changed inside bundled commits in three of nine.

## v1 to v2 for the WITH arm

The WITH arm changed in two ways at once: the skill was calibrated (E01) and the harness changed. The harness changes that favour WITH are the "release preparation" answer, the dependency category approval and the explicit approval of test-adding categories. These account for at least ts D03 and py D03 (6 instances, now fixed; in v1 the manifest category was never approved). The progress logs that mention file temperature say no file was classed cold in v2: py-with-3 has "history insufficient ... all files 'hot' by recency", rs-with-1 has "all files warm from dated history" and rs-with-2 has "no file is cold anyway". This suggests the recovered comment and doc fixes come mainly from the F01 rule change rather than from the situation answer, but the two cannot be separated with this design.

| Metric | v1 WITH (6 runs) | v2 WITH (9 runs) | Comparable? |
|---|---|---|---|
| Detection rate | 1.00 (148/148) | 1.00 (222/222) | Yes, same definition and fixtures |
| Reported, not fixed | 80/148 (54%) | 14/222 (6%); another 19 (9%) partly fixed | Mostly. v1 had no partial-fix label, so some v1 partial fixes were graded fixed and others reported |
| fix-T0 instances fixed | 13/40 (33%) | 57/60 (95%) | Mostly, for the same reason |
| fix-T1 instances fixed | 25/80 (31%) | 90/120 (75%); 16 more partial | Mostly. v2's "fixed-correctly" is stricter |
| report-T2 instances left to the owner | 25/28 (89%) | 25/42 (60%) | Yes |
| Wrongly changed or regressed | 2 (ts D12, both runs) | 0 | Yes. v2's definition is wider, so 0 is if anything stronger |
| good_outcome_rate | 0.446 | 0.775 | No. v2 no longer counts partial fixes or unapproved T2 fixes as fixed. The v2 figure is stricter, so the real gain is if anything larger |
| Score | 0.716 (v1 partial-credit score); about 0.71 or slightly lower on the v2 scale | 0.888 | Approximately. v1 WITH had no broken traps and only 3 unapproved T2 fixes, which v2 would halve (-0.01). The v1 partial fixes that graders called fixed would lose a little more |
| Per-run score range | 0.60-0.80 | 0.84-0.917 | Approximately, as above |
| Traps broken / flagged | 0 / 0 of 46 | 0 / 1 of 69 | Yes |
| Hidden-test failures | 0 | 0 | Yes |
| Existing tests edited + suppressions added | 1 | 0 | Yes |
| Mixed-kind commits | 0 of 89 | 0 of 313 | Yes |
| Behaviour changes without a test | 0 | 0 | Yes |
| Runs that changed the public API | 0/6 | 4/9 | Yes. The v2 changes are ledger-expected: py D01/D02 removals, the D14/D25 defaults, and an additive union member in ts-with-1. All are disclosed |
| False positives | 2 | 11 | Partly. Grader judgement. All 11 are report-only, with no code change |
| Harmful changes | 1 (npm install outside the repo) | 0 | Partly. v2 graders were not asked to check for writes outside the run directory |
| Valid extra findings per run | 13.8 | 11.0 | Weakly. Graders group items differently |
| Commits per run | 14.8 | 34.8 | Yes |
| Lines added / removed per run | +534 / -48 | +1210 / -132 | Yes |
| Wall time, model | not recorded | 2 h 22 min mean; claude-opus-5-5 | New in v2 |

**Baseline v1 to v2, for context.** The baseline prompt is essentially unchanged, so the baseline's differences come mostly from measurement and noise:

| Metric | v1 | v2 |
|---|---|---|
| Detection | 0.959 | 0.968 |
| Traps broken | 1 of 46 | 5 of 69 |
| Hidden-test failures per run | 0.17 | 1.0 |
| Mixed-kind commits | 19 of 143 | 30 of 199 |
| Behaviour changes without a test per run | 2 | 2 |
| Score | 0.848 (v1 adjusted) | 0.738 |

- **Why the score dropped.** Most of the drop comes from the stricter outcome set: partial fixes, bundled fixes graded wrongly-changed, and half credit for T2 fixes on ts and rs, which v1's adjustment applied only to py. It is not evidence that the baseline got worse.
- **rs D09 is now reported.** v1's baseline missed the fail-open price band in both runs. In v2 all three baseline runs report it, which may be because they could now write REPORT.md.

## Safety and process

- **Traps.**
  - WITH left all 69 trap instances intact.
    - The only flag is py-with-3's report-only nit DU-p1-5. It says the `match` on Side duplicates `Fill.signed_qty`, which is wrong because the `case _` guard (X07) raises where `signed_qty` would not. Nothing was applied.
    - Trap-adjacent notes that recommend keeping the code were graded as not flagged: ts-with-1 H-014/H-030, py H-007/H-024/RD-p1-2 and py H-035/AR-p1-1.
    - All three py WITH runs reported the genuine contradiction behind X04, without changing the fallback. The README says the 10/20 bps default is "more expensive than any listed venue", but coinbase is 40/60.
  - The baseline broke X07 in all three py runs. It broke X04 in py-without-2 and py-without-3 by "fixing" that same contradiction in code.
  - Across both rounds, WITH has broken 0 of 115 trap instances and the baseline 6 of 115. All six were py traps, and X07 accounts for four of them. The breaks are clustered, so this is not 115 independent trials.
- **Tests.**
  - No WITH run modified or deleted an existing test file or added a skip or suppression. py-with-3, for example, removed five blanket `type: ignore`, and rs removed one crate-wide `allow`.
  - Every WITH behavioural fix has its own commit and a new demonstrating test. Graders re-ran these tests against the parent or base and saw them fail: for example 18 tests for 17 fixes in ts-with-1, 14 test files in ts-with-2, 23 tests in py-with-1, 14 fix commits each in py-with-2 and py-with-3, and 6 fixes in rs-with-1.
  - Baseline runs edited 48 existing test files, 3 suppressions included. Graders found no test deleted or weakened. The edits were additions, import changes, rustfmt reflows and the D22 strengthening the ledger expects.
- **Commits.** WITH made 313 commits and none mixed change kinds. Characterization commits came before the fixes they protect. The baseline made 199 commits, and 30 of them mix kinds. Examples: a behaviour change inside a `refactor:` commit (ts D15 in all three runs, py D16), and a T2 credential change bundled with a timeout fix (rs D10 and D23).
- **Behaviour changes without a test.** WITH: 0. Baseline: 18. Examples are the rs response-size caps, broken-pipe handling, CLI `.env` loading (ts-without-1) and the X07 removal.
- **Public API.**
  - WITH changed it in 4 of 9 runs:
    - ts-with-1 added `'unavailable'` to `PriceSource`.
    - All three py runs removed `csvutil` and `open_symbols` and changed two defaults. The ledger expects these through D01, D02, D14 and D25.
    - Every change is disclosed, with a griffe diff in py.
  - Some exported functions now fail loudly on inputs they used to mishandle quietly, and this is disclosed as an owner item (ts-with-1, ts-with-3).
  - The baseline changed the public API in all 9 runs: new options and exported types, new `CheckResult` fields (`held`, `quieted`), the `API_KEY` constant removed, and a new variant added to a public enum that is not `#[non_exhaustive]` (rs-without-2).
- **False positives and harmful changes.**
  - WITH's 11 false positives are all report-only. The baseline's 7 include 6 code changes. They are harmless on the hidden tests, for example rewriting the intended `getattr` renderer dispatch.
  - Harmful changes: WITH 0. Baseline 6: the `check` alias (twice), the X07 and X04 breaks, and a stray `crates/tickfmt/Cargo.lock`.
- **Reports.**
  - All 18 runs wrote their report.
  - WITH reports:
    - all 9 have a Limits section, which is always substantive, and a "Nit overflow" appendix (F06);
    - graders found their claims backed by gate JSON, parent-check logs and reproductions;
    - graders noted minor overclaims: py-with-1 claims each commit passed alone, which the logs only partly support; a pinning test described as "fails on the parent"; two wrong characterization SHAs in py-with-2 commit bodies, which the run disclosed.
  - Baseline reports:
    - graders marked 7 of 9 as having a limits section, but most are "deliberately left alone" lists rather than statements of what was not verified;
    - graders marked 8 of 9 evidence-backed. py-without-2 filed the X07 removal under "no behaviour change", and its fills-differential claim was disproved;
    - graders noted smaller overclaims in rs-without-1 and rs-without-3 ("JSON differs only in total_fees") and in ts-without-2 (the alias).
- **Churn.** Three WITH runs each made two revert/redo pairs after jscpd found clones in newly added tests: ts-with-1 (H-057, H-040), ts-with-3 (H-013, H-024) and rs-with-2 (H-023a, H-015). The final states were fine.

## Did each E01 calibration have the intended effect?

| Calibration | Intended effect | v2 evidence | Verdict |
|---|---|---|---|
| **F01** Insufficient history is not "cold"; mechanical items fixed at every temperature; add "release preparation" | Stop demoting comments, commented-out code and verified stale docs | Comments and stale docs 24/24 fixed (ts D18/D19/D20, py D21/D22, rs D18/D19/D20; v1: 2/16). Commented-out code 9/9 (ts D04, py D04, rs D05). fix-T0 57/60. All 9 runs answered "release preparation", and logs show no file classed cold | **Achieved.** Confounded with the harness's situation answer, but the logs point to the rule change |
| **F02** A red fmt/lint gate at base becomes a ratchet, not whole-run report-only | No repeat of rs-with-2 v1 (0 commits) | rs has 12 fmt hunks at base. All 3 rs-with runs stayed in apply mode (25, 33, 29 commits) and reported the drift as a nit (rs-with-1 H-031, rs-with-2 H-033, rs-with-3 C-027). ts runs continued although ESLint is not installed | **Achieved.** No WITH run offered the drift as its own style commit; all 3 baseline runs made one |
| **F03** Restoring documented or language semantics stays T1; fail-open flips go warn-first; re-ask after a re-tier | Apply assert→ValueError, return-in-finally, failed-write exit codes; stop silent deferral | py D16 3/3, py D17 3/3, rs D08 3/3 fixed (v1: py D16 0/2, py D17 1/2, rs D08 0/2). ts D08 moved from reported to partial in all 3: malformed JSON now fails, but a missing explicit `--config` still falls back in ts-with-1 and ts-with-3, and the shared mutable default is left in all 3. Re-asks are recorded in approvals.md (rs-with-1 H-007, rs-with-3 C-022) and in py-with-2 D09, py-with-3 D06/D09 and ts-with-1 H-031 | **Mostly achieved, with a side effect.** Warn-first was applied to py D09 and D10, which the ledger calls report-T2: 6 of the 17 WITH unapproved T2 fixes |
| **F04** A hollow test gets a new pinning test | Leave an oracle behind in every run | 9/9 runs added a new test file pinning the contract, each shown to fail under a fault (v1: 1/6). Graded partial in 8 and fixed in 1: py-with-1 got full credit for the same handling as py-with-2/3, a grading inconsistency | **Behaviour achieved, score unchanged by design.** The ledger counts the hollow test itself. Invariant 2 and the harness (which never approves test edits) keep it untouched, capping these at 0.5 |
| **F05** Missing timeout: add a default with no latency data | Add a finite timeout | 9/9 added a 10 s timeout with a test (v1: 0/6). All 9 used a named module constant, which ER-21 allows when no existing config path avoids an exported-signature change. The baseline exposed an option in ts-without-1/2 and all py runs. rs-with-2's test goes through a private seam and fails at the parent only by a compile error; rs-with-1's connect timeout is untested | **Achieved.** The owner has to edit source to tune the timeout |
| **F06** Self-evident items need no needs_review; nit overflow goes to an appendix | Fix comments, commented-out code and unused imports; hide nothing | 27/27 such instances fixed (ts D04/D18/D19, py D04/D21, rs D05/D18/D19/D24). All 9 reports have a "Nit overflow" appendix | **Achieved** |
| **F07** Fixes that restore promised behaviour are T1 | Stop domain rules demoting local fixes | ts D09 3/3 (v1 0/2), ts D11 2 F + 1 P (v1 0/2), ts D24 3/3 (v1 1/2), rs D06 3/3 (v1 0/2), py D01 3/3 (v1 0/2), py D15 3/3 (v1 1/2), ts D23 2 F + 1 P (v1 0/2) | **Mostly achieved, with a ledger conflict.** "Remove a placeholder credential fallback is T1" also produced py D25 (3/3) and rs-with-2 D23 as unapproved T2 fixes. The ts ledger calls the same fix fix-T1; the py and rs ledgers call it report-T2 |
| **F08** A fix that tightens validation pins previously valid inputs first; a representation change goes to T2 | No repeat of the ts D12 regression | 0 regressions in 222 WITH instances (v1: ts D12 regressed in both WITH runs). All 3 ts runs narrowed D12 to NaN ids and split the above-2^53 collision into T2 (string ids would change the public `Trade` type), so D12 is reported-not-fixed in all 3. All 3 baseline runs regressed D12. Pinning before a rejection appears in py-with-1 H-033, rs-with-3 (C-014, C-038, C-039, C-015) and ts-with-1 H-031 | **Achieved.** D12 is now scored 0.5 instead of 0 |
| **F09** Each consequence is tracked separately | No silent partial fix | ts D07: 2 of 3 fixed both consequences (v1: 1 of 2). Every residual now appears as its own finding. But 9 partial-fix outcomes are a named consequence split into an owner item: ts D08 in all 3, ts-with-2 D07/D11/D23, rs D04 in 2 runs (the `crates/tickfmt` directory), rs-with-3 D07 | **Partly.** The residual is visible but still unfixed |
| **F10** Tool installs stay inside the run | No writes outside the repository | No grader reported an out-of-repo write, and there were 0 harmful changes. ts-with-3 made clones and installed StrykerJS in a sibling directory, `../ts-with-3-scratch`, outside its run directory though not in the home directory | **No violation seen.** Weak evidence: graders were not asked to check outside the run directory |
| **F11** Deterministic tier table | Less variance between repeats | Per-fixture score ranges went from 0.04-0.13 (v1) to 0.00-0.06. But the same outcome in all 3 repeats holds for 61 of 74 defects (82%), exactly the baseline's 61 of 74. Unstable WITH items: ts D07, D11, D15, D16, D23; py D18, D19, D24; rs D04, D07, D15, D16, D23 | **Partly.** Scores are stable; per-defect decisions still vary on about 1 defect in 5 |
| **F12** Lint in each item's gate | Fewer reverts for new lint hits | py D13 needed one fix commit and no revert in every run (v1 py-with-1: 5 commits, two of them reverted). Duplicate-code (jscpd) reverts after commit remain: 2 pairs each in ts-with-1, ts-with-3 and rs-with-2 | **Partly** |

## Threats to validity

1. **n = 3 per cell.** On ts and py the WITH and baseline ranges do not overlap. On rs they touch. The strongest claim these data support is a consistent direction on two of three fixtures.
2. **One grader per run, and the grader is the same model as the runs.** The graders were thorough (they re-ran suites and parent checks), but they labelled identical handling differently:
   - **py D24:** a new pinning test with the hollow test left untouched was graded fixed in py-with-1 and partial in py-with-2/3. With a consistent label, py-with-1 would score 0.86.
   - **ts D11:** a tolerance and snap-to-zero, with float money left as T2, was graded fixed in ts-with-1/3 and partial in ts-with-2.
   - **The ESLint-not-installed note:** graded a false positive in ts-with-3 and a valid extra elsewhere.
   - **Grader prose:** three grader summaries miscount their own labels by one (ts-with-2, py-with-1, rs-without-1). The scorer uses the labels, so scores are unaffected.
   - **`wrongly-changed` for a correct but bundled fix** is a process judgement. The rs-without-2 grader notes that a lenient reading would relabel D10, D17 and D25.
3. **The scorer is not every fixture README.** The scorer applies py's T2 half credit everywhere. The ts README accepts a behaviour-preserving change to a T2 item (the WITH arm's ts D06 flattening in all 3 runs) and gives 0 for a behaviour-changing one. The rs README gives full credit to a flagged, green T2 fix. The sensitivity table shows the direction survives, but the size of the gap does not.
4. **The ledgers disagree with each other and, in one place, with measurement.**
   - Removing a placeholder API key fallback is fix-T1 in ts (D23) and report-T2 in py (D25) and rs (D23).
   - The ts D23 description says real Binance rejects an invalid key. ts-without-1 and ts-without-3 both measured HTTP 200 with the placeholder key.
   - The ledgers expect the hollow test itself to be fixed. The skill's invariant 2 and the harness forbid editing it.
5. **The simulated user shapes outcomes.** It never approves T2 or edits to existing tests, answers "most conservative" to everything else (for example, it kept rs D23 at T2 on re-ask in rs-with-1 and rs-with-3), and approves every proposed T1 category. That last point is why warn-first logging and credential defaults went in.
6. **Skill and harness changes are confounded.** The v1 to v2 comparison mixes the calibration with the situation answer and the new approvals. The comparison between arms within v2 is clean on this point.
7. **The environment was not exercised or not controlled.**
   - Hooks were not registered, and runs had no subagents, so independent verification (DT-32) and the hook guards were not tested.
   - Up to 14 runs shared one host under disk and memory pressure.
   - py-with-1 skipped four lenses for context budget. py-with-3 read only part of prioritization.md and lens-web3.md. py-with-1 still scored 0.88, level with its siblings.
8. **An earlier v2 launch was stopped.** Its directories are kept apart (`runs/v2-aborted`), and none of its results are used here.

## Remaining weaknesses

1. **Unbounded caches and growing histories stay unfixed.** 6 of 9 instances were demoted: ts D16 twice, py D19 twice, rs D16 twice. The baseline fixed all 9 with tests and no hidden regression. The stated reasons were "no test can observe the growth", "no soak measurement", "a bound on a public attribute is an API change", and, in rs-with-3, a reverted fix over a 7.6% text-report slowdown (p = 0.007).
2. **Splitting consequences produces partial fixes.** Nine partial fixes come from splitting a finding's consequences. The clearest case is ts D08. Its headline reproduction, `value --config nope.json` printing 0.00 and exiting 0, still works in 2 of 3 runs, and all 3 left the shared mutable `DEFAULT_CONFIG` in place.
3. **The calibration pushed some report-T2 items into edits.** 17 instances were edited:
   - py D09 and D10 went warn-first, 6 instances;
   - the credential default changed in py D25 three times and in rs-with-2 D23;
   - py D05, the divergent fee formula backed by history, 3 instances;
   - the parseArgs guard clauses in ts D06, 3 instances;
   - rs-with-3 D15.
   None regressed and all were flagged. The ledger still counts each as overreach.
4. **Credential handling is the least deterministic category.** The nine runs handled a credential in four different ways:
   - removed the literal and the header fallback (ts-with-1, ts-with-3);
   - fixed the header but kept the literal (ts-with-2);
   - changed the default but kept the literal (py-with-1, py-with-2);
   - removed the literal (py-with-3), blocked by PC-21 (rs-with-1, rs-with-3), or removed the fallback (rs-with-2).
   PC-21 ("no commit touches a secret-finding line") conflicts with F07's "removing a placeholder credential fallback is T1" whenever the fix needs the literal deleted.
5. **Hollow tests are capped at partial.** This is by design (invariant 2), and the ledger and the baseline both disagree with it.
6. **Some suppressions are fixed only halfway.**
   - ts D15 (a blanket `eslint-disable`) was demoted in two runs because ESLint is not installed. ts-with-2 ran ESLint ad hoc to find the hidden rules and narrowed the disable.
   - py D18 got error codes but no reason in 2 of 3 runs, although the skill's own TY-04 asks for one.
7. **Large structural refactors are not attempted.** rs D07 (`Engine::submit`, about 200 lines, fix-T1) was reported in two runs and partly done in the third. Two baseline runs split it with a byte-identical differential test over generated order streams. Ledger T2 items get the opposite treatment: small structural edits were applied to ts D06.
8. **The cost is high.** A WITH run takes 3.7 times the baseline's wall time and uses 3 times the output tokens, 7 times the cache reads and a 9-times longer report (median 11k words). py-with-1 took 1 h 34 min and scored the same 0.88 as its siblings, which took 2 h 46 min and 2 h 56 min. The data do not show which phases take the time.
9. **Revert churn from duplicate-code checks on new tests.** Six revert/redo pairs across three runs.
10. **Isolation.** ts-with-3 put its scratch clones and StrykerJS install outside its run directory.

## What to change next

Items are ordered by how many observed instances they explain. Each gives the evidence, the proposed change and the trade-off. None of them has been applied.

1. **Bound unbounded in-process caches and histories as T1, with an observable test** (6 instances: ts D16, py D19, rs D16).
   - **Change:** accept a size-observable demonstrating test, meaning entry count after N simulated TTL buckets or N polls, through the object's existing state or a non-exported seam. Treat "bound it with a documented, configurable cap" as T1 behavioural. When the output is byte-identical and the cache only saves allocation, treat "remove the cache" as structural.
   - **Also:** the performance gate for such an item should compare against a stated budget, not reject any significant slowdown. rs-with-3 reverted a memory fix over 7.6%, and two baseline runs wrote a faster renderer.
   - **Trade-off:** a cap on a public attribute (py `history`) changes what readers see, so it needs a characterization test and the behavioural flag. The skill already requires both.
2. **Make each consequence the ledger-style reproduction names block "done"** (9 partial fixes).
   - **Change:** when a finding carries a headline reproduction (for example `--config nope.json` exits 0), the demonstrating test must turn that exact reproduction green. Otherwise findings.json records the item as partial and the report lists it first among open items.
   - **Also:** run F07's "restores promised behaviour" test separately on each consequence. An explicitly given config path that does not exist, and returning a shared mutable default, both qualify.
   - **Trade-off:** somewhat more behavioural change per item, and more approvals to ask for.
3. **Decide where warn-first and credential defaults belong** (10 of the 17 unapproved T2 instances). Two options:
   - **(a) Keep them as T1.** A log line and a `None` default are low risk, and the py README only halves the credit. Accept the scoring cost.
   - **(b) Offer them as a proposed first step inside the T2 report entry**, without applying them under a T1 category approval. This matches the py and rs ledgers but gives up a cheap mitigation.
   Either way, first align the three ledgers on the credential tier (see the harness list). Otherwise no rule can satisfy all three.
4. **Make the credential rule deterministic** (4 different handlings in 9 runs).
   - **Change:** add an explicit PC-21 exception. A verified placeholder literal (test-shaped, for example `sk_test_…FIXTURE…`, not a live credential) may be deleted in the same commit that removes its last use. Rotation and history rewriting stay T2. The alternative is to forbid the deletion in all cases.
   - **Trade-off:** the exception needs a reliable test for "placeholder". A wrong call would touch a real secret's line, but it would not print the value.
5. **Give hollow tests an approvable in-place option** (8 partial fixes).
   - **Change:** add a DC-15-like category, "add assertions to an existing assertion-free test", limited to additions that diff_guard checks (no assertion removed or weakened) and proven by a fault. Measure it only with a harness arm whose simulated user approves it.
   - **Trade-off:** it relaxes invariant 2, which is currently the skill's simplest anti-gaming guarantee. Keeping the invariant costs 0.5 per hollow test on these ledgers and nothing in safety.
6. **Run the missing linter before demoting a suppression** (ts D15 in 2 runs, py D18 in 2 runs).
   - **Change:** when the tool behind a blanket suppression is not installed, run it through a pinned ephemeral runner (F10) to list the hidden rules, then narrow the suppression. Require the TY-04 reason in the same commit.
   - **Trade-off:** one more tool run per suppression.
7. **Allow Extract Function on a large deterministic function behind a differential test** (rs D07 in 3 runs).
   - **Change:** when a public-API differential over generated inputs is feasible and byte-identical, treat the refactor as T1 structural with approval.
   - **Trade-off:** it is a money path. The baseline's third attempt at rs D07 (rs-without-1) put a behaviour change, disclosed and tested, inside the refactor commit, which is the failure the skill's commit discipline is there to prevent.
8. **ts D12: look for a fix without a representation change** (3 instances). One candidate is to dedupe on the raw id string inside parsing while the public `Trade.orderId` stays a number. If none exists, keep the current T2 split.
9. **Shorten the report and find where the time goes.**
   - **Report:** put a one-screen summary at the top: what changed, what needs a decision, what was not checked.
   - **Timing:** record per-phase timestamps in progress.md so v3 can show which phases take the 2 h 20 min.
   - **Trade-off:** none for correctness. The long report is evidence-rich, but an owner is unlikely to read 11k words.
10. **Run the duplicate-code check in the per-item gate before committing** (6 revert pairs), scoped to the diff. Consider a relaxed threshold for new test files, which legitimately repeat setup code.
11. **Keep scratch clones under `.harden/`**, as rs-with-2 did. ts-with-3 used a sibling directory.

**Harness and fixture changes before v3:**

- **Ledgers.** Align the credential tier across the three ledgers, and correct the ts D23 description (two runs measured HTTP 200 with the placeholder key). Decide whether a warn-stage log line in a T2 region counts as a T2 change, and write that into the grader's outcome definitions.
- **Scorer.** Either make the scorer apply each fixture README's own T2 rule, or make the READMEs match the scorer.
- **Grading consistency.** Add a short set of graded examples to the grader prompt, or a second grader for the contested labels: pinning test with the hollow test left, split consequences, bundled correct fixes. Ask graders to check for writes outside the run directory.
- **Cost measurement.** Record per-phase timings. Limit concurrency or log host free disk and memory, so wall times mean more.
- **Sample size.** Run 5 repeats per cell before claiming anything about rs, where the arms' ranges touch.
- **Extra arm.** Optionally, add a WITH arm whose simulated user approves in-place hollow-test strengthening, to measure item 5.

## What to keep

- **Detection.** 222 of 222 instances in v2, 148 of 148 in v1, backed by executed reproductions. Examples: the ts D11 ledger values, the rs D06 fee delta, and the py X04 contradiction found without touching the trap.
- **Trap handling.** Tool hits on traps are dismissed with a stated reason: knip on dynamic plugins, vulture on `getattr` renderers, the `#[non_exhaustive]` wildcard, the rate-limited sequential loop.
- **Commit discipline.** Characterization commits come first. Each behavioural fix has its own commit and a test that fails on the parent. No existing test is edited.
- **Owner decisions stay with the owner.** Placeholders were reported with the decision spelled out in 9 of 9 instances, against 0 of 9 for the baseline. The fail-open price band (rs D09) was reported in all runs.
- **The calibrated rules that worked.** Mechanical items are fixed regardless of history (F01, F06). Fixes that restore promised behaviour are T1 (F07). Timeouts have a default (F05). Tightening fixes pin valid inputs (F08), which cost one 0.5 on ts D12 and removed the regression.
