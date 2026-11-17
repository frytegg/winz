# /harden evaluation: results v3

Run dates: 2026-09-24 to 2026-09-25 (the relaunch that produced these results ran from 20:57 UTC on 24 Sep to 05:19 UTC on 25 Sep). Label: `v3`. Protocol: the v3 workflow script (`eval-skill-v3.js` in the session scratchpad), workflow run `wf_78da5392-15a`. It is installed as `evals/eval-workflow.js` (the v2 script is kept as `evals/eval-workflow-v2.js`). Fixtures: `evals/fixtures/{ts,py,rs}`, unchanged. Previous rounds: `evals/results-v1.md`, `evals/results-v2.md`. Calibrations applied since v2: `research/eval-v2-calibration.md` (E02-F01 to E02-F08), on top of the E01 calibrations.

## Bottom line

- **The skill again scored higher than the baseline overall, but by less, and the difference is clear only on py.** The mean deterministic score was 0.885 WITH (per-run range 0.82-0.92) against 0.783 WITHOUT (0.52-0.896). Per fixture:
  - **ts:** 0.853 against 0.827. The ranges overlap: ts-with-3 scored 0.82, the same as ts-without-2 and ts-without-3.
  - **py:** 0.913 against 0.660. No overlap.
  - **rs:** 0.889 against 0.861. The ranges overlap: rs-without-3 scored 0.896, the same as the two best WITH runs.

  An exact permutation test within each fixture gives one-sided p = 0.20 for ts, 0.05 for py and 0.20 for rs. In v2, ts and py were both at 0.05.
- **v2 to v3 for the skill: no net change.** The WITH score went from 0.888 to 0.885. The E02 calibrations moved about 10 credit points (of 222) in each direction:
  - **Gains:**
    - unbounded caches and histories fixed in 8 of 9 instances (v2: 3 of 9);
    - suppression credit 0.78 to 1.00;
    - the ts D06 T2 refactor left alone (v2 edited it in all 3 runs);
    - warn-first steps on the py T2 items D09/D10 applied in only 1 instance (v2: 6).
  - **Losses:**
    - A new tier rule (row 21 of the tier table: an unpromised fail-open-to-fail-closed flip is T2) turned six ledger fix-T1 instances into reports: py D07 3/3 and ts D09 3/3.
    - The placeholder-credential exception (E02-F04) never fired. It needs a scan that sends the credential to the vendor, and the simulated user declined that scan every time, so ts D23 went from 2 fixed and 1 partial to 3 reported.
    - Three fixes regressed: ts D12 twice, ts D24 once.

  With an unchanged prompt, the baseline's score rose by 0.045, mostly because it broke 1 trap instead of 5. Round-to-round noise is therefore larger than the skill's change.
- **Safety held. Isolation slipped.**
  - **WITH runs:** 0 of 69 trap instances broken, 0 hidden-test failures, 0 existing tests edited, 0 mixed-kind commits in 284, and 0 behaviour changes without a test.
  - **Baseline:** 1 trap broken, 2 hidden failures, 45 existing test files edited and 1 suppression added, 51 mixed commits out of 206, and 16 behaviour changes without a test.
  - **Where the skill slipped:** the skill had 3 fixed-with-regression outcomes (v2: 0). Graders were asked for the first time to check writes outside the run directory, and they counted 5 in WITH runs: tool caches in the user profile, a `/tmp` file and a leftover temp directory.
- **Where the gap comes from.** The arms are 23 credit points apart out of 222:
  - 18.0 come from report-T2 handling;
  - 2.0 from the baseline's broken trap;
  - 2.5 from fix-T1 items;
  - 0.5 from fix-T0 items.

  If the baseline's correct but bundled fixes are credited as fixed ("substance only"), the gap shrinks to 0.885 against 0.848. The baseline is then ahead on ts (0.887 against 0.853) and rs (0.903 against 0.889). Outside py, the skill's advantage on this ledger is restraint and commit discipline, not better fixes.
- **Cost.**
  - A WITH run took 2 h 03 min on average against 26 min for the baseline (4.7 times).
  - It produced 450k output tokens against 138k (3.3 times).
  - The median report was 11,740 words against 1,140.
  - Per-phase timing is available for the first time: Apply takes 44% of a WITH run's wall time, Final check 17% and Detect 18%.
- **Small sample.**
  - Each cell has 3 runs (n = 3).
  - Each run had one grader, and runs and graders used the same model.
  - The score is one ledger's view of correct handling.
  - Two of the nine baseline runs were produced by an earlier, aborted launch and only re-checked in this one.

  Treat every difference below as indicative.

## Setup

### Fixtures

| Fixture | Project | Stack | Seeded defects | Traps | Hidden tests | Expected tiers T0 / T1 / T2 | History |
|---|---|---|---|---|---|---|---|
| ts | pricewatch | TypeScript, pnpm, vitest | 25 | 8 | 97 | 10 / 13 / 2 | 24 commits |
| py | tradelog | Python, pytest | 25 | 8 | 52 | 3 / 15 / 7 | 20 commits |
| rs | matchbook | Rust, cargo, no external crates | 24 | 7 | 25 | 7 / 12 / 5 | 23 commits |

The fixtures, ledgers and hidden tests are unchanged since v1. Each arm has 222 defect instances and 69 trap instances over its 9 runs.

### Harness: v1, v2 and v3

| Item | v1 | v2 | v3 |
|---|---|---|---|
| Repeats per cell | 2 (12 runs) | 3 (18 runs) | 3 (18 runs), all completed |
| Concurrency | all at once | up to 14 runs at once | one fixture at a time: 6 runs at once, then its graders, then the next fixture (host memory) |
| Situation answer (WITH) | "maintenance only" (no release option existed) | "release preparation", scripted | same as v2 |
| Approvals (WITH) | every T1 category; never manifests, lockfiles or test edits | every T1 category, test-adding categories, one dependency category; never edits to existing tests, never T2 | same as v2. For any other question the simulated user takes the most conservative option. In v3 that included declining every verified-mode secret scan, and approving newly rejected input classes when re-asked, since they were T1 items |
| Report file | refused by the harness in 6 of 12 runs | allowed in both prompts | same as v2 |
| Model id, wall time | not recorded | each run states both | same as v2; the skill also writes `.harden/phases.json` (E02-F08) |
| Grader outcomes | no partial-fix label | adds `partial-fix`, `unapproved-t2-fix` and a wider `wrongly-changed` | same labels, plus four worked examples for the labels v2 graders disagreed on (a new pinning test with the hollow test left: partial-fix; split consequences: partial-fix if at least one is fixed; a correct fix bundled in a commit: wrongly-changed only inside a refactor/style/NFC commit or with a T2 item, otherwise counted in mixed commits; a warn-only mitigation on a T2 item: unapproved-t2-fix) |
| Writes outside the run directory | not checked | not checked | graders check the run's parent, the home directory and elsewhere, and count each write as a harmful-change extra |
| Score | computed by hand | deterministic scorer | same scorer as v2 |
| Run prompts | v1 prompts | v2 prompts | identical to v2 (the script diff touches only the grader prompt and the batching) |

Unchanged since v1:

- The skill's hooks cannot be registered in a workflow subagent, so every WITH run recorded the canary failure and followed the invariants by hand.
- The runs had no subagent tool, so every WITH run did detection, verification and apply in one context.

### What changed in the skill since v2

All eight E02 calibrations are cited in the skill's files:

- **F01:** SKILL.md, prioritization, lens-errors-resilience, lens-performance, lang-python.
- **F02:** SKILL.md, protocol-change, reporting, `validate_findings.py` and its tests.
- **F03:** SKILL.md, prioritization (tier table row 21), protocol-change, reporting, lens-security.
- **F04:** prioritization (row 12), protocol-change, lens-security, lens-ops-config.
- **F05:** detection, lens-types-suppressions.
- **F06:** prioritization, protocol-change, lens-complexity-design.
- **F07:** SKILL.md, protocol-change, lens-duplication.
- **F08:** SKILL.md, most references, `gates.py`, `hook_guard.py`, `run_state.py` and their tests.

"Did each E02 calibration have the intended effect?" checks the observed behaviour against each one.

### How this round ran

1. **First launch, 24 Sep from 13:57 UTC.**
   - ts-with-1, ts-with-2, ts-with-3 and ts-without-1 stalled after about 52 minutes of work.
   - The account then hit its usage limit, and after the reset every waiting agent failed with `ENOTFOUND` (network or DNS outage).
   - Only ts-without-2 and ts-without-3 finished. Their commits date from 14:03 to 14:24 UTC, and both were graded at 14:24-14:30 UTC.
   - The four stalled run directories were moved to `runs/v3-failed-network` and are not used. Their work cost about 819k output tokens.
2. **Relaunch, same workflow, from 20:57 UTC.**
   - ts-with-1, ts-with-2, ts-with-3 and ts-without-1 ran from scratch.
   - The ts-without-2 and ts-without-3 agents found their finished work. Each re-verified it in about one minute, committed nothing and reported that honestly.
   - Both were graded again, and the scores here use the second grading. The two runs therefore ran about seven hours earlier than the other ts runs, with six ts runs at once, four of them skill runs. The prompt and model were the same.
3. **Batches (UTC):**
   - ts: 20:57-23:46;
   - py: 23:46-01:44;
   - rs: 01:44-05:19.
4. **Host pressure in the rs batch.** Graders found 42 to 237 MB free on C:, and graded the rs runs with `CARGO_INCREMENTAL=0` and no debug info. Skill runs lost tools to the full disk:
   - rs-with-1's tool installs failed;
   - rs-with-3 skipped gitleaks, semgrep, coverage and cargo-mutants;
   - rs-with-2 lists "disk full" in its Limits section.

### Model, wall time and cost

Every run stated `claude-opus-5-5[1m]` as its model id. Every run and grader transcript shows the API model `claude-opus-5-5`. This summary was written by the same model.

Wall times come from each run's own `date -u +%s` stamps. They match the transcript timestamps to within 40 s. Token counts come from the transcripts' usage fields, deduplicated by API message id. For ts-without-2 and ts-without-3 they add the one-minute resume to the first-launch run.

| Run | Wall time | Output tokens | Cache-read tokens | API calls | Report words |
|---|---|---|---|---|---|
| ts-with-1 | 1 h 56 min (6936 s) | 461k | 144.3M | 374 | 11,740 |
| ts-with-2 | 2 h 41 min (9636 s) | 498k | 186.9M | 424 | 13,607 |
| ts-with-3 | 1 h 59 min (7133 s) | 451k | 161.5M | 407 | 12,192 |
| py-with-1 | 1 h 47 min (6432 s) | 506k | 176.6M | 406 | 12,007 |
| py-with-2 | 1 h 01 min (3638 s) | 283k | 136.6M | 236 | 9,295 |
| py-with-3 | 1 h 47 min (6435 s) | 446k | 185.3M | 416 | 13,037 |
| rs-with-1 | 2 h 12 min (7914 s) | 492k | 179.7M | 442 | 11,241 |
| rs-with-2 | 3 h 16 min (11739 s) | 510k | 178.0M | 444 | 10,946 |
| rs-with-3 | 1 h 46 min (6340 s) | 400k | 142.1M | 393 | 9,792 |
| ts-without-1 | 27 min (1602 s) | 147k | 18.3M | 89 | 1,117 |
| ts-without-2 | 27 min (1617 s), first launch | 166k | 24.0M | 127 | 1,375 |
| ts-without-3 | 24 min (1462 s), first launch | 159k | 18.6M | 104 | 1,315 |
| py-without-1 | 22 min (1305 s) | 117k | 15.0M | 89 | 997 |
| py-without-2 | 20 min (1217 s) | 107k | 12.5M | 74 | 1,102 |
| py-without-3 | 23 min (1351 s) | 119k | 16.9M | 95 | 1,140 |
| rs-without-1 | 27 min (1617 s) | 148k | 17.8M | 93 | 1,157 |
| rs-without-2 | 34 min (2016 s) | 136k | 21.0M | 106 | 968 |
| rs-without-3 | 30 min (1805 s) | 146k | 20.7M | 106 | 1,342 |
| **Mean WITH / WITHOUT** | **2 h 03 min / 26 min** | **450k / 138k** | **165.7M / 18.3M** | **394 / 98** | **median 11,740 / 1,140** |

Per fixture, WITH / WITHOUT means are: ts 2 h 12 min / 26 min, py 1 h 32 min / 22 min, rs 2 h 24 min / 30 min. v2 means were 2 h 22 min / 38.5 min, with up to 14 runs sharing the host. The v3 batches ran 6 at a time, so the drop in wall time is not evidence that the skill got faster. Each grader took 6 to 21 minutes.

### Where the time goes

All nine WITH runs wrote `.harden/phases.json` (E02-F08). Durations are in minutes. The phases cover each run's whole wall time to within about a minute.

| Run | Preflight | Freeze | Detect | Verify | Prioritise | Report | Approve | Apply | Final check | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| ts-with-1 | 2.3 | 3.9 | 20.6 | 4.7 | 2.5 | 4.9 | 1.3 | 50.1 | 24.4 | 114.7 |
| ts-with-2 | 2.5 | 4.1 | 23.7 | 43.4 | 2.8 | 9.3 | 0.6 | 54.4 | 19.7 | 160.3 |
| ts-with-3 | 2.6 | 3.8 | 20.9 | 3.8 | 1.8 | 3.0 | 0.4 | 57.5 | 24.5 | 118.3 |
| py-with-1 | 3.3 | 3.0 | 27.9 | 3.6 | 10.2 | 7.0 | 0.5 | 39.2 | 12.3 | 106.9 |
| py-with-2 | 2.8 | 2.6 | 22.3 | 3.7 | 2.7 | 1.9 | 0.3 | 18.6 | 5.3 | 60.3 |
| py-with-3 | 2.9 | 4.1 | 21.3 | 4.8 | 1.1 | 8.9 | 0.3 | 43.4 | 20.1 | 106.8 |
| rs-with-1 | 3.2 | 4.7 | 24.2 | 2.7 | 2.7 | 3.9 | 0.7 | 53.4 | 35.2 | 130.6 |
| rs-with-2 | 3.1 | 3.7 | 21.3 | 5.3 | 2.2 | 2.6 | 0.5 | 126.3 | 30.6 | 195.5 |
| rs-with-3 | 3.0 | 6.0 | 19.1 | 18.4 | 2.2 | 4.8 | 0.7 | 40.6 | 10.5 | 105.1 |
| **Median** | 2.9 | 3.9 | 21.3 | 4.7 | 2.5 | 4.8 | 0.5 | 50.1 | 20.1 | 114.7 |
| **Share of all WITH time** | 2% | 3% | 18% | 8% | 3% | 4% | 0.5% | 44% | 17% | 100% |

- **Apply plus Final check take 61% of the time.** Detection is steady at 19 to 28 minutes.
- **Apply varies the most**, from 19 minutes (py-with-2, 28 commits) to 126 minutes (rs-with-2, 30 commits). rs-with-2 had two revert/redo pairs and reported a full disk.
- **Verify has two outliers:** ts-with-2 (43 min) and rs-with-3 (18 min).
- **Reading.** Most of the cost is gating each commit, bisectability and fresh-clone replays, not detection. These data do not break Apply down further.

## Results

### Headline comparison

| Metric | ts with | ts without | py with | py without | rs with | rs without | all with | all without |
|---|---|---|---|---|---|---|---|---|
| Runs completed | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 9/9 | 9/9 |
| **Score, mean** | **0.853** | **0.827** | **0.913** | **0.660** | **0.889** | **0.861** | **0.885** | **0.783** |
| Score per run | 0.86, 0.88, 0.82 | 0.84, 0.82, 0.82 | 0.92, 0.90, 0.92 | 0.76, 0.52, 0.70 | 0.875, 0.896, 0.896 | 0.854, 0.833, 0.896 | 0.82-0.92 | 0.52-0.896 |
| Detection rate | 1.00 | 1.00 | 1.00 | 0.907 | 1.00 | 1.00 | 1.00 | 0.968 |
| good_outcome_rate | 0.747 | 0.787 | 0.827 | 0.573 | 0.778 | 0.778 | 0.784 | 0.712 |
| Fixed correctly | 50 | 59 | 48 | 43 | 46 | 53 | 144 | 155 |
| Partial fix | 8 | 2 | 3 | 1 | 8 | 0 | 19 | 3 |
| Reported, not fixed | 8 | 0 | 3 | 0 | 3 | 2 | 14 | 2 |
| Correctly report-only (T2) | 6 | 0 | 14 | 0 | 10 | 3 | 30 | 3 |
| Unapproved T2 fix | 0 | 4 | 7 | 16 | 5 | 10 | 12 | 30 |
| Wrongly changed | 0 | 7 | 0 | 8 | 0 | 4 | 0 | 19 |
| Fixed with regression | 3 | 3 | 0 | 0 | 0 | 0 | 3 | 3 |
| Missed | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 7 |
| Traps broken | 0/24 | 0/24 | 0/24 | 1/24 | 0/21 | 0/21 | 0/69 | 1/69 |
| Traps flagged as a problem | 0 | 0 | 2 | 1 | 0 | 0 | 2 | 1 |
| Hidden-test failures | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 2 |
| Existing test files edited + suppressions added | 0 | 20 | 0 | 14 | 0 | 12 | 0 | 46 |
| Mixed-kind commits | 0 | 23 | 0 | 18 | 0 | 10 | 0 | 51 |
| Behaviour changes without a test | 0 | 7 | 0 | 2 | 0 | 7 | 0 | 16 |
| Runs that changed the public API | 1/3 | 3/3 | 3/3 | 2/3 | 0/3 | 3/3 | 4/9 | 8/9 |
| False positives | 3 | 1 | 12 | 4 | 0 | 0 | 15 | 5 |
| Harmful changes | 0 | 0 | 1 | 0 | 4 | 0 | 5 | 0 |
| Valid extra findings | 37 | 38 | 39 | 41 | 32 | 35 | 108 | 114 |
| Commits | 106 | 62 | 92 | 79 | 86 | 65 | 284 | 206 |
| Lines added / removed | +4924 / -294 | +4754 / -1112 | +2763 / -263 | +2523 / -663 | +3377 / -696 | +3838 / -1403 | +11064 / -1253 | +11115 / -3178 |
| Mean wall time | 2 h 12 min | 26 min | 1 h 32 min | 22 min | 2 h 24 min | 30 min | 2 h 03 min | 26 min |

- **`good_outcome_rate`** counts only fixed-correctly and correctly-report-only. On ts it is higher for the baseline (0.787 against 0.747), because the skill's 8 partial fixes and 8 reported items earn nothing on that metric.
- **Harmful changes** are the writes outside the run directory described under "Safety and process". Baseline runs install no tools, so they have fewer such writes to find. Graders did see writes they could not attribute to any one run while baseline runs were active, and did not count those.

### Per run

Codes: F fixed correctly, P partial fix, R reported not fixed, C correctly report-only, U unapproved T2 fix, W wrongly changed, G fixed with regression, M missed.

| Run | Commits | Lines +/- | Hidden | F | P | R | C | U | W | G | M | Traps broken | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ts-with-1 | 31 | +1245 / -98 | 97/97 | 17 | 2 | 3 | 2 | 0 | 0 | 1 | 0 | 0 | 0.86 |
| ts-with-2 | 40 | +1938 / -101 | 97/97 | 18 | 2 | 2 | 2 | 0 | 0 | 1 | 0 | 0 | 0.88 |
| ts-with-3 | 35 | +1741 / -95 | 97/97 | 15 | 4 | 3 | 2 | 0 | 0 | 1 | 0 | 0 | 0.82 |
| ts-without-1 | 18 | +1535 / -375 | 97/97 | 20 | 1 | 0 | 0 | 1 | 2 | 1 | 0 | 0 | 0.84 |
| ts-without-2 | 23 | +1524 / -342 | 97/97 | 19 | 1 | 0 | 0 | 2 | 2 | 1 | 0 | 0 | 0.82 |
| ts-without-3 | 21 | +1695 / -395 | 96/97 | 20 | 0 | 0 | 0 | 1 | 3 | 1 | 0 | 0 | 0.82 |
| py-with-1 | 31 | +1007 / -90 | 52/52 | 16 | 1 | 1 | 5 | 2 | 0 | 0 | 0 | 0 | 0.92 |
| py-with-2 | 28 | +685 / -88 | 52/52 | 16 | 1 | 1 | 4 | 3 | 0 | 0 | 0 | 0 | 0.90 |
| py-with-3 | 33 | +1071 / -85 | 52/52 | 16 | 1 | 1 | 5 | 2 | 0 | 0 | 0 | 0 | 0.92 |
| py-without-1 | 30 | +796 / -211 | 52/52 | 16 | 0 | 0 | 0 | 6 | 0 | 0 | 3 | 0 | 0.76 |
| py-without-2 | 23 | +851 / -226 | 51/52 | 13 | 0 | 0 | 0 | 4 | 6 | 0 | 2 | 1 (X07) | 0.52 |
| py-without-3 | 26 | +876 / -226 | 52/52 | 14 | 1 | 0 | 0 | 6 | 2 | 0 | 2 | 0 | 0.70 |
| rs-with-1 | 32 | +1466 / -240 | 25/25 | 15 | 3 | 1 | 3 | 2 | 0 | 0 | 0 | 0 | 0.875 |
| rs-with-2 | 30 | +1173 / -263 | 25/25 | 15 | 3 | 1 | 4 | 1 | 0 | 0 | 0 | 0 | 0.896 |
| rs-with-3 | 24 | +738 / -193 | 25/25 | 16 | 2 | 1 | 3 | 2 | 0 | 0 | 0 | 0 | 0.896 |
| rs-without-1 | 19 | +1368 / -540 | 25/25 | 18 | 0 | 0 | 1 | 3 | 2 | 0 | 0 | 0 | 0.854 |
| rs-without-2 | 22 | +1209 / -451 | 25/25 | 17 | 0 | 1 | 1 | 3 | 2 | 0 | 0 | 0 | 0.833 |
| rs-without-3 | 24 | +1261 / -412 | 25/25 | 18 | 0 | 1 | 1 | 4 | 0 | 0 | 0 | 0 | 0.896 |

- **The two baseline hidden-test failures.**
  - ts-without-3 made `check` a CLI alias while fixing the stale README (D20). That breaks the pinned test `parseArgs rejects ["check"]`, and two v2 baseline runs made the same change.
  - py-without-2 removed the `case _` guard (trap X07) in a "refactor" commit and did not disclose it.
- **The skill's regressions.**
  - ts-with-1 and ts-with-2 D12 reject the ledger's own 18-19 digit order ids. Both runs disclosed this as a "newly rejected input class", and ts-with-2 asked for approval again.
  - ts-with-3 D24 loses cooldowns when it reads a legacy state file. See "Grading reliability": the other two ts runs have identical code.

### By expected tier

Counts are F/P/R/C/U/W/G/M, summed over the 3 repeats.

| Expected tier | Instances per arm | v2 WITH | v2 WITH credit | v3 WITH | v3 WITH credit | v3 WITHOUT | v3 WITHOUT credit |
|---|---|---|---|---|---|---|---|
| fix-T0 | 60 | 57/3/0/0/0/0/0/0 | 0.975 | 54/5/1/0/0/0/0/0 | 0.950 | 56/1/0/0/0/3/0/0 | 0.942 |
| fix-T1 | 120 | 90/16/14/0/0/0/0/0 | 0.875 | 90/14/13/0/0/0/3/0 | 0.863 | 99/2/2/0/0/10/3/4 | 0.842 |
| report-T2 | 42 | 0/0/0/25/17/0/0/0 | 0.798 | 0/0/0/30/12/0/0/0 | 0.857 | 0/0/0/3/30/6/0/3 | 0.429 |

- **fix-T0.** The losses are:
  - the 3 ts D22 hollow-test partials (by design; see E01-F04);
  - ts-with-3 D13 (partial);
  - rs-with-2 D01 (reported; it kept `round_to_tick` as code "ahead of use" next to the D21 TODO);
  - rs-with-2 D02 (partial; the `allow(dead_code)` stays because it hides D01).
- **fix-T1.** Same fixed count as v2 (90). The non-full outcomes changed:
  - **Reported, not fixed (13).** Row 21 of the tier table accounts for py D07 ×3, ts D09 ×3 and ts-with-1 D08. PC-21 blocked ts D23 ×3. The rest are ts-with-3 D12, rs-with-1 D16 and rs-with-3 D07.
  - **Partial (14).** py D24 ×3 and rs D22 ×3 are hollow tests. rs D04 ×3 kept the unused crate's directory because deleting it would delete its tests. ts D07 ×2 and ts D08 ×2 split a consequence off as a T2 item. rs-with-1 D07 is an incomplete extraction.
  - **Regressions (3):** ts D12 ×2 and ts-with-3 D24.
- **report-T2.** The skill gained 2.5 points on this tier. It left 30 of 42 instances to the owner (v2: 25). The 12 it edited are:
  - py D05 ×3, a sibling-fix divergence;
  - py D25 ×3 and rs-with-2 D23, credential fallbacks removed under row 12;
  - rs D11 ×2 (exact VWAP) and rs-with-3 D21 (the tick check), both tiered T1 because the README promises the behaviour;
  - py-with-2 D10, a warn-only step;
  - rs-with-1 D15, where the report now names the strategy that actually ran.
- **Baseline.** It edited 36 of 42 report-T2 instances without a decision.

### How much the comparison depends on the scoring rules

Four alternative scorings test how robust the result is. The p-value is from an exact permutation test stratified by fixture: arm labels are permuted within each fixture, which gives 8,000 relabelings, and the statistic is the difference in mean score.

| Scoring | WITH mean (range) | WITHOUT mean (range) | Gap | One-sided p |
|---|---|---|---|---|
| Workflow scorer (as reported) | 0.885 (0.82-0.92) | 0.783 (0.52-0.896) | 0.102 | 0.002 |
| Substance only: a wrongly-changed item whose code the grader called correct counts as fixed (fix tiers) or as an unapproved T2 fix (T2). This affects 17 baseline instances and no WITH instance. ts-without-3 D06 and D20 (the `check` alias) stay at 0 | 0.885 (0.82-0.92) | 0.848 (0.72-0.917) | 0.037 | 0.07 |
| Each fixture README's own T2 rule. ts: a behaviour-preserving T2 change gets full credit and a behaviour-changing one gets 0. rs: a flagged T2 fix with green tests gets full credit, an unflagged one 0 (rs-without-2 D11 counts as unflagged). py: as scored | 0.897 (0.82-0.938) | 0.797 (0.52-0.979) | 0.100 | 0.009 |
| ts D24 graded a regression in all three ts WITH runs (identical code; see "Grading reliability") | 0.876 (0.82-0.92) | 0.783 (0.52-0.896) | 0.094 | 0.009 |
| ts D24 graded fixed in all three ts WITH runs | 0.890 (0.86-0.92) | 0.783 (0.52-0.896) | 0.107 | 0.001 |

- **Per fixture, substance only:** ts 0.853 against 0.887, py 0.913 against 0.753, rs 0.889 against 0.903.
- **Per fixture, README rules:** ts 0.853 against 0.813, rs 0.924 against 0.917.
- **With D24 graded consistently as a regression,** the ts WITH mean (0.827) equals the baseline's.
- **Direction.** The overall direction holds under every scoring. The py gap is large under every scoring. The ts and rs gaps are small, and under substance-only scoring they reverse.
- **What the p-values assume.** They treat runs as exchangeable within a fixture and grader labels as ground truth, with 3 runs per cell and one same-model grader per run. They describe these 18 runs. They do not predict how a new run would score.

### By defect category

Credit is the workflow scorer's. Categories hold 2 to 11 distinct defects each, so differences of one or two instances are anecdotal. The v2 columns are the v2 report's.

| Category | Instances per arm | v2 WITH | v2 WITH credit | v3 WITH | v3 WITH credit | v3 WITHOUT | v3 WITHOUT credit |
|---|---|---|---|---|---|---|---|
| Dead code, commented-out code, unused imports, blanket allow | 33 | F33 | 1.00 | F31 P1 R1 | 0.97 | F33 | 1.00 |
| Unused dependency | 9 | F6 P2 R1 | 0.83 | F6 P3 | 0.83 | F7 R2 | 0.89 |
| Narrating comments and stale docs | 24 | F24 | 1.00 | F24 | 1.00 | F20 P1 W3 | 0.85 |
| Error handling, success-shaped fallback | 30 | F14 P4 C5 U7 | 0.82 | F7 P4 R7 C10 U2 | 0.78 | F16 P2 C3 U9 | 0.82 |
| Missing network timeout | 9 | F9 | 1.00 | F9 | 1.00 | F5 W4 | 0.56 |
| Numeric (float money, large ids, overflow, lossy cast) | 18 | F8 P1 R3 C6 | 0.89 | F9 R1 C4 U2 G2 | 0.81 | F9 U3 G3 M3 | 0.58 |
| Async (floating promise, dangling task, return in finally) | 9 | F9 | 1.00 | F8 P1 | 0.94 | F9 | 1.00 |
| Type and lint suppressions | 9 | F5 P2 R2 | 0.78 | F9 | 1.00 | F4 W5 | 0.44 |
| Resource growth and performance | 18 | F12 R6 | 0.83 | F17 R1 | 0.97 | F16 W1 M1 | 0.89 |
| Hollow tests | 9 | F1 P8 | 0.56 | P9 | 0.50 | F6 M3 | 0.67 |
| Hardcoded credential | 9 | F2 P1 C2 U4 | 0.72 | R3 C2 U4 | 0.61 | F3 U3 W3 | 0.50 |
| Complexity | 9 | P1 R2 C3 U3 | 0.67 | F1 P1 R1 C6 | 0.89 | F3 U3 W3 | 0.50 |
| Duplicate that missed a later fix | 9 | F6 U3 | 0.83 | F6 U3 | 0.83 | F6 U3 | 0.83 |
| Time and locale | 6 | F6 | 1.00 | F5 G1 | 0.83 | F6 | 1.00 |
| Placeholder / TODO stub | 9 | C9 | 1.00 | C8 U1 | 0.94 | U9 | 0.50 |
| Other correctness (string sort, mutable default, assert, panic on input) | 12 | F12 | 1.00 | F12 | 1.00 | F12 | 1.00 |

**Where WITH improved since v2:**

- **Suppressions: 0.78 to 1.00.** All three ts runs ran ESLint at pinned versions and narrowed the blanket disable on ts D15 to named rules with a reason. All three py runs gave py D18's ignores a reason or a typed return.
- **Resource growth: 0.83 to 0.97.** Caches and histories were fixed in 8 of 9 instances.
- **Complexity: 0.67 to 0.89.** ts D06 was left alone in 3 of 3 runs, and rs-with-2 split rs D07 behind a differential.
- **Error-handling T2 restraint:** 10 correct report-only instances against 5 in v2.

**Where WITH got worse since v2:**

- **Error handling.** The fix-T1 items py D07 and ts D09 are now reported in all 6 instances (v2: all fixed).
- **Credentials.** ts D23 is reported in 3 of 3 runs (v2: 2 fixed, 1 partial).
- **Numeric.** ts D12 regressed in 2 of 3 runs (v2: reported in 3 of 3).
- **Time.** ts-with-3 D24 regressed.

**Where the baseline is ahead:**

- **Hollow tests.** The baseline strengthened ts D22 and rs D22 in place in all 6 runs and missed py D24 in all 3. The skill adds a new pinning test and leaves the hollow test alone (invariant 2).
- **Unused dependency.** rs-without-1 deleted the unused `crates/tickfmt` crate. Every skill run kept its directory, because deleting it deletes its tests.
- **Error handling:** 0.82 against 0.78.
- **Time and locale.** All three baseline runs handled legacy state entries (skipped with a warning). The skill runs did not.

**Where the baseline did worst:**

- **Timeouts:** 4 of 9 were bundled with the T2 credential change or had no test.
- **Suppressions:** 5 of 9 were retypes inside `refactor:` commits that changed behaviour.
- **Placeholders:** all 9 were implemented without a decision.
- **Complexity:** py D06 and ts D06 were refactored without a decision.
- **Numeric:** py D12 was missed 3 of 3 times, and ts D12 regressed 3 of 3 times.

## v2 to v3 for the WITH arm

The run prompts are identical to v2's. Between the two rounds, three things changed:

- the E02 calibrations;
- the grader's worked examples and its new check for outside writes;
- concurrency (6 runs at a time instead of up to 14).

The baseline saw only the last two changes, so its movement shows the scale of noise and grading shift.

| Metric | v2 WITH (9 runs) | v3 WITH (9 runs) | Comparable? |
|---|---|---|---|
| Score, mean (range) | 0.888 (0.84-0.917) | 0.885 (0.82-0.92) | Yes: same fixtures, run prompts, scorer and outcome set. Re-grading v2 under the worked examples would move py-with-1 D24 from fixed to partial (-0.02) and ts-with-2 D11 from partial to fixed (+0.02), so the v2 mean barely moves |
| Score per fixture | ts 0.873, py 0.880, rs 0.910 | ts 0.853, py 0.913, rs 0.889 | Yes |
| Detection | 222/222 | 222/222 | Yes |
| Fixed / partial / reported / correct report-only / unapproved T2 | 147 / 19 / 14 / 25 / 17 | 144 / 19 / 14 / 30 / 12 | Yes |
| Wrongly changed / fixed with regression | 0 / 0 | 0 / 3 | Yes |
| good_outcome_rate | 0.775 | 0.784 | Yes |
| Same outcome in all 3 repeats (per defect) | 61 of 74 | 60 of 74 | Yes (baseline: 61 and 59) |
| Traps broken / flagged | 0 / 1 of 69 | 0 / 2 of 69 | Yes |
| Hidden-test failures | 0 | 0 | Yes |
| Existing tests edited + suppressions added | 0 | 0 | Yes |
| Mixed-kind commits | 0 of 313 | 0 of 284 | Mostly: v3 graders were told to count a bundled commit here instead of grading the fix wrongly-changed. That affects the baseline, not WITH |
| Behaviour changes without a test | 0 | 0 | Yes |
| Runs that changed the public API | 4/9 | 4/9 | Yes |
| False positives | 11 | 15 | Partly. Grader judgement; all 15 are report-only |
| Harmful changes | 0 | 5 | No. v2 graders did not check for writes outside the run directory |
| Valid extra findings | 99 | 108 | Weakly. Graders group items differently |
| Commits | 313 (34.8 per run) | 284 (31.6 per run) | Yes |
| Lines added / removed | +10886 / -1186 | +11064 / -1253 | Yes |
| Mean wall time | 2 h 22 min | 2 h 03 min | Partly. Concurrency differs |
| Mean output tokens | 419k | 450k | Yes |
| Median report length | 11,077 words | 11,740 words | Yes |

**Per-defect changes (WITH, three repeats each; the sign is the change in credit):**

- **Gains (+9.5):**
  - ts D06 UUU → CCC (+1.5, E02-F03);
  - py D09 UUU → CCC (+1.5, E02-F03);
  - py D10 UUU → CUC (+1.0, E02-F03);
  - ts D15 RFR → FFF (+1.0, E02-F05);
  - py D18 PPF → FFF (+1.0, E02-F05);
  - ts D16 FRR → FFF (+1.0, E02-F01);
  - py D19 RFR → FFF (+1.0, E02-F01);
  - rs D16 RFR → RFF (+0.5, E02-F01);
  - rs D07 RRP → PFR (+0.5, E02-F06);
  - ts D11 FPF → FFF (+0.5, grading consistency).
- **Losses (-10.0):**
  - py D07 FFF → RRR (-1.5, row 21 from E02-F03);
  - ts D09 FFF → RRR (-1.5, row 21);
  - ts D23 FPF → RRR (-1.0, E02-F04's verified-mode precondition);
  - ts D12 RRR → GGR (-1.0, the E01-F08 stop-gap now rejects valid ids in 2 runs);
  - ts D24 FFF → FFG (-1.0, legacy state files);
  - rs D11 CCC → UCU (-1.0, the row 20 promise test);
  - rs D21 CCC → CCU (-0.5, the promise test);
  - ts D07 FPF → PFP (-0.5, consequence split);
  - ts D13 FFF → FFP (-0.5, consequence split);
  - py D24 FPP → PPP (-0.5, grading consistency);
  - rs D01 FFF → FRF (-0.5) and rs D02 FFF → FPF (-0.5), both rs-with-2 keeping `round_to_tick` as code ahead of use.
  - ts D08 PPP → RPP, rs D15 CCU → UCC and rs D23 CUC → CUC change outcomes but not credit.
- **Net:** -0.5 credit points of 222.

**The baseline between v2 and v3,** with an unchanged prompt:

| Metric | v1 | v2 | v3 |
|---|---|---|---|
| Score | 0.848 (v1, adjusted by hand) | 0.738 | 0.783 |
| Detection | 0.959 | 0.968 | 0.968 |
| Traps broken | 1 of 46 | 5 of 69 | 1 of 69 |
| Hidden-test failures per run | 0.17 | 1.0 | 0.22 |
| Mixed-kind commits | 19 of 143 | 30 of 199 | 51 of 206 |
| Behaviour changes without a test, per run | 2.0 | 2.0 | 1.8 |

- **Traps drive most of the baseline's +0.045:**
  - X07 broke in 1 py run instead of 3, and X04 in none instead of 2;
  - that is 8 of the roughly 10 extra credit points.
- **Mixed commits rose** because the worked example moved bundled fixes out of `wrongly-changed` and into the mixed-commit count.

## v1 to v2 to v3 for the WITH arm

Most v1 metrics are only approximately comparable, because v1 had no partial-fix label, was scored by hand, and counted unapproved T2 fixes as good outcomes. v2 and v3 share the scorer.

| Metric | v1 (6 runs) | v2 (9 runs) | v3 (9 runs) | Comparable? |
|---|---|---|---|---|
| Detection | 148/148 | 222/222 | 222/222 | Yes, across all three |
| Reported, not fixed | 80/148 (54%) | 14/222 (6%) | 14/222 (6%) | Mostly. v1 had no partial label, so some v1 partial fixes were graded fixed and others reported |
| Partly fixed | not a label | 19 (9%) | 19 (9%) | v2 and v3 only |
| fix-T0 fixed | 13/40 (33%) | 57/60 (95%) | 54/60 (90%) | Mostly |
| fix-T1 fixed | 25/80 (31%) | 90/120 (75%) | 90/120 (75%) | Mostly. From v2 on, "fixed" requires every named consequence |
| report-T2 left to the owner | 25/28 (89%) | 25/42 (60%) | 30/42 (71%) | Yes |
| Wrongly changed or regressed | 2 (ts D12 ×2) | 0 | 3 (ts D12 ×2, ts D24) | Yes |
| good_outcome_rate | 0.446 | 0.775 | 0.784 | No for v1, which counted T2 fixes as good and had no partial label. Yes for v2 to v3 |
| Score | 0.716 (v1 partial credit); about 0.71 on the v2 scale | 0.888 | 0.885 | Approximately for v1; yes for v2 to v3 |
| Per-run score range | 0.60-0.80 | 0.84-0.917 | 0.82-0.92 | As above |
| Traps broken | 0 of 46 | 0 of 69 | 0 of 69 | Yes |
| Hidden-test failures | 0 | 0 | 0 | Yes |
| Existing tests edited + suppressions added | 1 | 0 | 0 | Yes |
| Mixed-kind commits | 0 of 89 | 0 of 313 | 0 of 284 | Yes |
| Behaviour changes without a test | 0 | 0 | 0 | Yes |
| Runs that changed the public API | 0/6 | 4/9 | 4/9 | Yes |
| Harmful changes | 1 (npm install in home) | 0 | 5 | No. Only v3 graders were asked to look outside the run directory |
| Commits per run | 14.8 | 34.8 | 31.6 | Yes |
| Wall time, model | not recorded | 2 h 22 min; claude-opus-5-5 | 2 h 03 min; claude-opus-5-5 | v2 to v3 partly (concurrency) |

Most of the handling gain came between v1 and v2. It came from the E01 calibrations together with the harness's situation answer and approvals, which cannot be separated. Between v2 and v3 the E02 calibrations changed which items were handled well, not how many.

## Safety and process

- **Traps.**
  - WITH left all 69 trap instances intact.
  - Two report-only notes were graded as mild false positives on traps, both in py-with-3. C-063 calls it a gap that `mean_revert` is not registered (X01), but that strategy is designed to load by `module:Class`. C-062 reports the registration import cycle on X05's line. Nothing was edited.
  - Other trap-adjacent notes recommended keeping the code and were graded as not flagged: ts-with-2 C-DC-05 and C-PE-03, ts-with-1 DC-adapter-exports, the py X04 fee-schedule contradiction in all three py runs, and ts-with-3 C-019. C-019 un-exported `KrakenClient`, which is harmless because registry resolution still works.
  - py-without-2 broke X07 and did not disclose it.
  - Across the three rounds, WITH has broken 0 of 184 trap instances and the baseline 7 of 184. All seven were py traps, and X07 accounts for five. The breaks are clustered, so these are not 184 independent trials.
- **Tests.**
  - No WITH run modified or deleted an existing test file or added a skip or suppression. Suppressions went down: the ts D15 blanket disable was narrowed, and the ts D14 `@ts-ignore` and py D18's bare ignores were fixed.
  - Graders either re-ran each run's demonstrating tests against the parent or base themselves, or checked the parent-check logs the run recorded:
    - ts-with-1 (re-run): 12 fix-test files, 23 of 27 tests red at base;
    - ts-with-2 (run's logs): 17 test files red at base, and all 40 commits green in the run's bisect;
    - ts-with-3 (run's logs): 13 of 13 red at base;
    - py-with-1 and py-with-3 (re-run): 12 of 12 each;
    - py-with-2 (re-run): 29 tests across 14 files;
    - rs-with-2 (re-run): 8 files, with the two exceptions explained;
    - rs-with-3 (run's logs): 8 of 8.
  - Baseline runs edited 45 existing test files and added one suppression, a `# type: ignore[arg-type]` in a py-without-2 test helper. Graders found no assertion removed or weakened. The edits were additions, import changes, rustfmt reflows and the D22 strengthening the ledger expects.
- **Commits.**
  - WITH made 284 commits, none mixing change kinds. Characterization commits came before the fixes they protect.
  - The baseline made 206 commits, 51 of them mixed. Examples:
    - py-without-2 b21fdd8: a "refactor" carrying D21 and the X07 removal;
    - ts-without-3 c38e6a6: the parseArgs refactor plus the `check` alias and the D20 README fix;
    - rs-without-1 40e7b2b: D10 timeouts, the T2 D23 key removal, percent-encoding and a read cap.
- **Behaviour changes without a test.** WITH 0, baseline 16. Examples: untested rs timeouts (rs-without-1 and rs-without-2), 64 KiB response caps, `.env` loading (ts-without-3) and the X07 removal.
- **Public API.**
  - WITH changed it in 4 of 9 runs:
    - ts-with-2 made the timeout a constructor option, an additive change;
    - all three py runs removed `csvutil` and `open_symbols` (ledger D01 and D02) and changed the `action_counts` and `HttpFetcher` defaults (D14 and D25).
  - All of these are disclosed; py includes a griffe diff. The rs rustdoc snapshot is identical to base in all three runs.
  - The baseline changed the public API in 8 of 9 runs.
- **False positives.**
  - WITH has 15, all report-only: 7 in py-with-3, 3 in py-with-1, 2 in py-with-2 and 3 in ts-with-3. Examples: the Kraken negative-sell dialect, the broad CLI catch, "config imports any module", and README-boilerplate preferences.
  - The baseline has 5, three of them code changes: the `getattr` renderer dispatch rewritten in py-without-2 and py-without-3, and `.env` loading added in ts-without-3.
- **Writes outside the run directory (harmful changes).**
  - WITH has 5:
    - py-with-1: pylint wrote its stats cache to `%LOCALAPPDATA%/pylint`;
    - rs-with-1: `/tmp/eng_head.rs`, created and deleted, plus the `~/.cargo` registry index and global cache, both disclosed;
    - rs-with-2: a leftover `%TEMP%/cargo-installLm3NOZ` from a failed `cargo install`, plus the `~/.cargo` registry, both disclosed.
  - rs-with-3's grader saw the same kind of `~/.cargo` and `cargo-install*` writes in that window and did not count them, because six runs were active.
  - Graders did not count the shared `uvx` and `pnpm dlx` caches or `~/.semgrep`.
  - Every skill run's `scratch_dir` under `%TEMP%` was created fresh and removed at stop; graders confirmed each one is absent.
  - Baseline: 0 counted. Graders noted `~/.cargo/.global-cache` touches during rs-without runs as normal cargo bookkeeping.
- **Reports.**
  - All 18 runs wrote a report.
  - WITH reports: all 9 have a Limits section and a 240-320 word Summary at the top (E02-F08), and graders found their claims backed by gate JSON, parent-check logs and reproductions. Minor inaccuracies:
    - ts-with-3 reports "186 removed" where git shows 193, and its C-015 commit landed before its gates ran (disclosed);
    - an rs-with-1 commit body misstated the rebate effect, and the report corrects it.
  - Baseline reports: graders marked 5 of 9 as having a limits section. Overclaims:
    - py-without-2's X07 removal is not disclosed;
    - ts-without-1 and ts-without-2 label behaviour-changing rewrites "no behaviour change";
    - py-without-3's "20k rows agree" claim is false at 81b05fd;
    - ts-without-3's message says 20 commits where there are 21.
- **Churn.**
  - No duplicate-code revert pairs (v2: 6); new-test clones are reported as nits.
  - rs-with-2 made two revert/redo pairs for other reasons: a truncated commit message (H-001) and a clippy `map_err_ignore` hit found after the commit (H-002).

## Did each E02 calibration have the intended effect?

| Calibration | Intended effect | v3 evidence | Verdict |
|---|---|---|---|
| **F01** Bound unbounded caches and histories behind a size-observable test; removing a cache whose output is byte-identical is structural; performance is judged against a budget | Fix ts D16, py D19, rs D16 (v2: 3 of 9) | 8 of 9 fixed:<br>- ts D16: ts-with-1 prunes old TTL buckets, ts-with-2 clears on a bucket change, ts-with-3 keys by pair; each has a new bound test.<br>- py D19: capped at 10,000, 10,000 and 1,000 entries, each flagged owner-tunable, with tests that fail at the parent.<br>- rs D16: rs-with-2 and rs-with-3 removed the cache as an NFC change behind a byte-identical differential.<br>rs-with-1 stated a 10% slowdown budget but demoted H-031 to T2 as `needs_review` (no size-observable reproduction). The baseline fixed 8 of 9 | **Achieved** |
| **F02** The headline reproduction must turn green, or the item stays `partial` and heads the open items; the promise test is applied per consequence | Close split-consequence partial fixes, especially ts D08 | Headline reproductions are recorded and re-run at HEAD (for example rs-with-1 H-017, py-with-1 H-013).<br>But ts D08's headline (`value --config nope.json` exits 0) still reproduces in 3 of 3 runs: ts-with-1 reported the whole item, and ts-with-2 and ts-with-3 fixed malformed JSON only. The per-consequence promise test itself split off the missing-file case as a new T2 finding (C-ER-13, C-054) under row 21, so the parent was marked applied, not partial. `findings.json` uses `partial` only twice (ts-with-3, rs-with-2).<br>Split-consequence partials: ts D07 ×2, ts D08 ×2, ts D13 ×1 (v2: 9, including rs D04). C-ER-13 is among the top three decisions in ts-with-2's Summary | **Not achieved.** Visibility improved. The rule moved the residual into a new finding instead of fixing it |
| **F03** Warn-first steps and safer defaults for T2 items are proposed, never applied | Stop T2 edits under T1 approvals (v2: 17 instances) | Unapproved T2 fixes fell to 12. Warn-first on py D09/D10 fell from 6 to 1; py-with-2 still applied one (H-027), citing the CLI's own fail-closed input policy as the promise. ts D06 was untouched in 3 of 3.<br>Side effect: row 21's "unpromised fail-open flip → T2, warn step proposed" also captured three ledger fix-T1 items:<br>- py D07 ×3. The ledger's fix is exactly "log a warning, keep the skip", which does not flip anything. All three runs proposed it and applied nothing.<br>- ts D09 ×3 (fixed 3/3 in v2).<br>- ts-with-1 D08.<br>Credential defaults were not affected, because row 12 still makes fallback removal T1: py D25 ×3 and rs-with-2 D23 are unchanged from v2. New T2 edits came from the promise test: rs D11 ×2, rs-with-3 D21, rs-with-1 D15 | **Mixed.** +4.0 credit on the targeted T2 items; -3.0 on fix-T1 items the rule should not have covered |
| **F04** A verifiably placeholder credential literal may be deleted with its last use | One deterministic handling; no PC-21 conflict | The exception requires "no match in a secret scanner's verified mode". That scan sends the value to the vendor. ts-with-1, ts-with-2, ts-with-3 and rs-with-3 each asked, and the simulated user declined it as the most conservative option. No run deleted a literal.<br>- ts: the fallback stayed in all 3 runs, so ts D23 (fix-T1) was reported ×3 (v2: 2 fixed, 1 partial).<br>- py: the default was changed and the literal left unused, ×3.<br>- rs-with-2: the fallback was removed and the literal is now a dead constant.<br>- rs-with-3: blocked, because removing the fallback would make rustc print the literal in its dead-code warning once D02 removed the crate allow.<br>Handling is now consistent within each fixture. Category credit fell from 0.72 to 0.61 | **Not achieved; it backfired on ts.** The precondition depends on a risky action a careful user refuses |
| **F05** Run the missing linter before demoting a suppression; the narrowed suppression carries a reason | Fix ts D15 and py D18 fully | ts D15 3 of 3 (v2: 1 of 3). ESLint ran at pinned versions in a scratch clone (ts-with-3 used `--no-inline-config`) and the blanket disable was narrowed to five named rules with a `--` reason. py D18 3 of 3 (v2: 1 fixed, 2 partial): a TypedDict return in py-with-1, codes plus a reason in py-with-2 and py-with-3. Category credit went from 0.78 to 1.00 | **Achieved** |
| **F06** Split a large deterministic function behind a byte-identical differential | Do rs D07 (v2: reported, reported, partial) | rs-with-2: two Extract Function commits behind a 540-session byte-identical differential; `submit` down to about 75 lines (fixed). rs-with-1: two NFC extractions, `submit` still 133 lines (partial). rs-with-3: demoted to T2 because branch coverage was not mapped (CX-15, DT-27); coverage tools did not run on the full disk. All 3 baseline runs split it cleanly this time | **Partly** (1 of 3) |
| **F07** Duplicate-code check in the per-item gate; clones in new tests are nits | No revert/redo churn | 0 duplicate-code revert pairs (v2: 6). New-test clones were recorded as nits (py-with-1 H-076, ts-with-3, py-with-2) | **Achieved** |
| **F08** One-screen summary, per-phase timestamps, a run-managed scratch directory, tools under `.harden/tools/` | A readable top, a cost breakdown, no writes outside the run | 9 of 9 reports open with a Summary (240-320 words: what changed, what needs a decision, what was not checked). 9 of 9 wrote `phases.json`, which gives the table above. 9 of 9 scratch directories were created and removed at stop.<br>But 5 writes to user-level tool caches or temp paths were counted (pylint, cargo registry, a `/tmp` file, a `cargo-install` leftover). The median report length is unchanged (11,740 words) | **Mostly achieved for the summary and the timings; partly for isolation; not for length** |

## Did the E01 calibrations hold?

| Calibration | v3 evidence | Status |
|---|---|---|
| **F01** Mechanical items at every temperature | Comments and stale docs 24/24 (ts D18/D19/D20, py D21/D22, rs D18/D19/D20). Commented-out code 9/9 | Held |
| **F02** A red formatting gate at base is a ratchet | rs has 12 rustfmt hunks at base. All 3 rs runs stayed in apply mode (32, 30, 24 commits) and reported the drift | Held |
| **F03** Restoring language or documented semantics stays T1 | py D16 3/3, py D17 3/3, rs D08 3/3. The warn-first default was replaced by E02-F03, which cost py D07 | Held for restoring semantics. The warn-first part was superseded |
| **F04** A hollow test gets a new pinning test | 9/9 added one, and each was shown to fail under a fault. All graded partial, consistently, per the worked example | Held; capped at 0.5 by design |
| **F05** Missing timeout: add a documented default | 9/9, with tests. ts-with-2 exposed it as a constructor option; the rest used named constants | Held |
| **F06** Self-evident items; nit overflow goes to an appendix | Held (Appendix D in the reports) | Held |
| **F07** Fixes that restore a promise are T1 | ts D11 3/3, rs D06 3/3, py D01 3/3, py D15 3/3, ts D24 fixed in 2 and regressed in 1. Lost: ts D09 (row 21) and ts D23 (E02-F04). The promise test also produced rs D11 ×2 and rs D21 ×1 as T2 overreach | Partly held; its reach now cuts both ways |
| **F08** Pin valid inputs before tightening validation | ts D12 regressed in 2 of 3 runs (v2: 0 of 3). Both disclosed the newly rejected class, and the simulated user approved it when re-asked. ts-with-3 kept to the non-numeric stop-gap (reported). ts-with-3 D24 introduced an upgrade-path regression | **Weakened.** The runs disclose the regression but do not prevent it |
| **F09** Each consequence is tracked | Residuals are visible as their own findings. ts D07 was partial in 2 of 3 (v2: 1 of 3) | Held for visibility, not for fixing |
| **F10** Tool installs stay inside the run | See E02-F08: user-level caches written | Partly |
| **F11** Deterministic tier table | 60 of 74 defects have the same outcome in all 3 repeats (v2: 61; baseline: 59). Unstable: ts D07, D08, D12, D13, D24; py D10; rs D01, D02, D07, D11, D15, D16, D21, D23. Per-fixture score ranges are 0.06 (ts), 0.02 (py) and 0.021 (rs) | Scores stable; per-defect decisions still vary on about 1 defect in 5 |
| **F12** Lint in each item's gate | rs-with-2 reverted H-002 over a clippy `map_err_ignore` hit found only after the commit | Partly |

## Grading reliability

- **Two runs were graded twice.** The first launch graded ts-without-2 and ts-without-3, and the relaunch graded them again with independent graders on the same work.
  - 49 of 50 defect labels agree. The one disagreement is ts-without-3 D11 (partial against fixed), the same label v2 graders disagreed on.
  - Process counts disagree more:
    - ts-without-2: mixed commits 10 against 7, and a limits section yes against no;
    - ts-without-3: one harmful change against none.
  - ts-without-3 scored 0.80 in the first grading and 0.82 in the second.
- **ts D24.** Only ts-with-3's grader probed the upgrade path. A state file written by the base code under fr-FR loads as NaN, `save()` then throws `RangeError`, and the new cooldown is lost. ts-with-1 and ts-with-2 have identical code (`state.ts` lines 26 and 34) and were graded fixed. A consistent grade moves the ts WITH mean to 0.827 (all regressed) or 0.867 (all fixed). All three baseline runs skip legacy entries with a warning.
- **Writes outside the run directory.** Graders applied this check differently. The rs-with-1 and rs-with-2 graders counted `~/.cargo` registry writes. rs-with-3's grader saw the same kind of writes and did not, citing concurrent runs. Nobody counted `uvx` or `pnpm dlx` caches.
- **The worked examples helped.** Hollow tests (9 of 9 partial), split consequences and bundled commits were labelled consistently across runs. In v2, py D24 was graded fixed in one run and partial in two.

## Threats to validity

1. **n = 3 per cell.**
   - The ts and rs ranges overlap, and their within-fixture permutation p is 0.20.
   - py is the only fixture where every WITH run beats every baseline run.
   - The strongest claim these data support: the skill beats the baseline on py and is level on ts and rs, with better process on all three.
2. **One grader per run, and the grader is the same model as the runs.** The reliability checks above show label agreement is high where the rules are explicit (49 of 50), but single judgements move scores by 0.02 to 0.04: ts D24, ts D11, writes outside the run directory.
3. **The scorer is not every fixture README.** The workflow scorer halves an unapproved T2 fix everywhere. The ts README gives 0 to a behaviour-changing T2 fix; the rs README gives full credit to a flagged, green one. The direction survives the README scoring, but the size of the gap does not survive the substance-only scoring.
4. **The ledgers disagree with each other.**
   - A placeholder credential fallback is fix-T1 in ts (D23) and report-T2 in py (D25) and rs (D23).
   - A success-shaped fallback that fabricates a value is fix-T1 in ts (D08, D09) and report-T2 in py (D09, D10) and rs (D09, D15). The skill's row 21 matches the py and rs view and loses on ts.
   - The ledgers expect hollow tests fixed in place, which the skill's invariant 2 forbids.
5. **The simulated user shapes outcomes.** Its "most conservative option" rule:
   - declined every verified-mode secret scan, which made E02-F04 inert;
   - approved newly rejected input classes when re-asked, since they came back as T1 items, which let the ts D12 regressions through;
   - never approves test deletion, which keeps `crates/tickfmt` (rs D04) and the hollow tests at partial.
6. **This round ran in two launches.**
   - Two baseline runs (ts-without-2, ts-without-3) come from the first launch, with different concurrency and about seven hours earlier. Their resumed agents only re-verified.
   - Four first-launch runs stalled and were discarded; they are in `runs/v3-failed-network` and not used.
7. **Host pressure.** The rs batch ran with under 250 MB free on C:. Skill runs skipped tools (secret scanners, coverage, mutation) and rs-with-2's Apply took 126 minutes. This may have cost rs-with-3 D07 (no coverage map) and affects the rs wall times.
8. **Hooks and subagents were not exercised.** Every WITH run did detection, verification and apply in one context and followed the invariants by hand. Only the real-project pilot (`evals/pilot-2026-09-24.md`) tested the hooks.
9. **Skill and harness changes are confounded between rounds.** v2 to v3 mixes the E02 calibrations with the grader's worked examples, its outside-write check and the batching. The comparison between arms within v3 is clean on this point.

## Remaining weaknesses

1. **Row 21 is too broad.** It treats "log the silent drop and keep the result" as the warn stage of an unpromised fail-closed flip. That reported py D07 in 3 of 3 runs, where the ledger's fix is exactly the log line, and ts D09 in 3 of 3. Applied per consequence (E02-F02), it also created the ts D08 splits.
2. **The promise test decides T1 against T2 in both directions.** When a README promises behaviour that is not implemented (rs D21 `off_tick`) or exact arithmetic (rs D11), the skill implements it. The ledgers call both owner decisions. When nothing promises the closed behaviour, the skill reports items the ledger wants fixed (py D07, ts D09).
3. **Credentials.** No run deleted a literal. ts D23 went from mostly fixed to reported. The four handlings of v2 became three, consistent per fixture, but for the wrong reason: a precondition nobody should satisfy.
4. **Tightening fixes still regress valid inputs.** ts D12 rejects real 18-19 digit exchange ids in 2 of 3 runs. The runs pin and disclose the newly rejected class, then apply it once approved. The ts D24 fixes do not read state files written by the old code (reproduced in one run, and identical code in the other two).
5. **Tool caches in the user profile.** Tool runs outside the run directory wrote the pylint cache, the cargo registry, `/tmp` and `%TEMP%`, even though the scratch-directory rule itself worked.
6. **Partial fixes stay at 19.**
   - 9 are hollow tests (by design).
   - 3 are the unused crate directory (rs D04), which can only go if its tests go.
   - 5 are split consequences.
   - 1 is an incomplete extraction (rs-with-1 D07).
   - 1 is rs-with-2 D02, where the allow was narrowed but `dead_code` kept because it hides D01.
7. **Cost.** A WITH run takes 4.7 times the baseline's wall time and 3.3 times its output tokens, and 61% of that time is Apply and Final check. The reports now start with a good summary but are still about 11,700 words.
8. **Per-defect variance.** About 1 defect in 5 still gets different handling across repeats, now concentrated in rs (8 of the 14 unstable defects).

## What to change next

Items are ordered by how many observed instances they explain. Each gives the evidence, the proposed change and the trade-off. None of them has been applied.

1. **Narrow row 21 to changes of existing results** (py D07 ×3, ts D09 ×3, ts D08 ×3: up to 9 instances).
   - **Change:** a log or warning added to a path whose current result stays the same is row 22 (ER-02), T1 behavioural. This covers invalid rows that are still dropped, but no longer silently.
   - **Also:** an additive marker, such as a new enum member flagging an unpriced holding (E01-F07's additive union clause), is T1 with approval.
   - **Also:** extend E01-F03's "requested output not written" to "an explicitly requested input that cannot be read", which covers `--config nope.json`.
   - Keep row 21's T2 for fixes that change an existing value or exit code on an unpromised fail-open path: py D09, py D10, rs D09, rs D15.
   - **Trade-off:** more behavioural commits. The ledgers disagree on fabricated values: ts D09 is fix-T1 and py D10 is report-T2 for the same shape. Align the ledgers first, or this rule will lose on one of them.
2. **Stop making the credential exception depend on a live call** (ts D23 ×3; consistency across 9 runs).
   - **Change:** replace "no match in a scanner's verified mode" with offline evidence:
     - a test-shaped marker;
     - a value that fails the vendor's own key format (a Binance key is 64 alphanumerics, and `sk_test_FIXTURE_NOT_A_REAL_KEY` is not);
     - a non-verified scanner rule that classifies it as generic.
   - Allow removing the fallback without touching the literal's line, and where the compiler would then print the literal (the rs dead-code warning), delete the literal in the same commit.
   - **Trade-off:** an offline check can be wrong. Some vendors issue real keys with a `test` prefix (Stripe's `sk_test_` keys are real test-mode credentials), so the marker list must exclude vendor prefixes that denote real keys. Also align the credential tier across the three ledgers.
3. **Do not apply a tightening fix that rejects inputs the docs or data call real, even after approval, and test the upgrade path of every format change** (ts D12 ×2, ts D24 ×1, latent in all 3 ts runs).
   - **Change:**
     - When the pinned previously valid inputs include values the docs describe as real (18-19 digit exchange ids), the stop-gap must stay lossless: dedupe on the raw string internally, or warn on collision. Otherwise the item stays reported.
     - When a fix changes a persisted format, its characterization includes a file written by the base code, read and re-saved at HEAD.
   - **Trade-off:** ts D12 stays at 0.5 instead of risking 0, and each format change needs one more test.
4. **Point every tool's home and cache at the scratch directory** (5 counted writes).
   - **Change:** set `CARGO_HOME`, `PYLINTHOME`, `XDG_CACHE_HOME`, `UV_CACHE_DIR` and the semgrep settings/log paths to `scratch_dir`. Remove `cargo-install*` leftovers on failure. Never write to `/tmp` directly.
   - **Trade-off:** tools re-download every run, which is slower. Some tools ignore these variables; the report should list the caches it could not redirect.
5. **Decide the promise test's reach for placeholders and money figures** (rs D21, rs D11 ×2, py D05 ×3, py D25 ×3, rs-with-2 D23: 10 of the 12 unapproved T2 instances). Two options:
   - **(a) A TODO or stub that the docs describe as working is always T2**, whatever the docs promise, because the owner chooses between implementing it and correcting the docs. A fix that changes a reported money figure on some valid input stays T2 unless the code pins that exact rounding.
   - **(b) Keep the current reach.** Every such edit was flagged and green. Accept the py scorer's half credit, which the rs README would give in full.
6. **Let a byte-identical differential stand in for missing branch coverage on a structural split, and define "done" by the project's threshold** (rs-with-3 D07, rs-with-1 D07).
   - **Trade-off:** it is a money path. The skill's one-extraction-per-commit rule stays.
7. **An unused crate or module may be deleted together with its own tests, as its own approvable category** (rs D04 ×3).
   - This is distinct from editing tests of live code, which stays forbidden (invariant 2).
   - **Trade-off:** it relaxes the invariant's simplest form. The harness would also have to approve the new category for it to be measured.
8. **Cut the cost of Apply and Final check** (61% of wall time).
   - **Change:** record per-commit gate time in `phases.json` to find out whether per-commit gates, fresh-clone replays or the bisect loop dominate. Then consider one fresh-clone replay per batch instead of per item.
   - **Report length:** move per-finding detail out of the main body into `findings.json` and the appendices.
   - **Trade-off:** coarser verification between commits.
9. **Include the detection-time lint set in each item's gate** (rs-with-2's revert over a clippy `map_err_ignore` hit).

**Harness changes before v4:**

- **Protocol.** Copy the v3 script into `evals/eval-workflow.js`; the skill still ships the v2 script.
- **Ledgers.**
  - Align the credential tier (ts D23 against py D25 and rs D23).
  - Align the fabricated-value fallback tier (ts D08 and D09 against py D09, py D10, rs D09 and rs D15).
  - Decide whether implementing a documented stub (rs D21) is overreach when the rs README gives full credit to a flagged fix.
  - Make the scorer and the READMEs agree.
- **Simulated user.**
  - Script the verified-mode-scan answer explicitly. "No" is the right answer, so the skill must not depend on it.
  - Decide whether a re-asked newly rejected input class is approved.
- **Grading.**
  - Give graders an upgrade-path probe for format changes (D24) and a fixed list of tool-cache paths to check.
  - Give each run its own `HOME`, `TEMP` and `CARGO_HOME`, so writes can be attributed.
  - Add a second grader for G and W labels.
- **Environment.** Require at least 10 GB free before the rs batch. Make an interrupted launch restart every run of the affected cells, rather than mixing resumed runs into the round.
- **Sample size.** Run 5 repeats per cell for ts and rs, where the arms' ranges now overlap.

## What to keep

- **Detection.** 222 of 222 instances in v3 and in v2, and 148 of 148 in v1, backed by executed reproductions. Examples: the rs D06 fee delta, the py X04 contradiction found without touching the trap, and the ts D24 fr-FR reproduction.
- **Trap safety.** 0 of 184 trap instances broken across the three rounds, against 7 for the baseline. Tool hits on traps are dismissed with a stated reason: knip on dynamic plugins, vulture on `getattr` renderers, the `#[non_exhaustive]` wildcard, the rate-limited sequential loop.
- **Commit discipline.** 0 mixed-kind commits in 686 over three rounds (baseline: 100 in 548). Characterization commits come first, each behavioural fix has its own commit and a test that fails on the parent, and no existing test is edited.
- **Owner decisions stay with the owner.** Placeholders were left to the owner in 8 of 9 instances (baseline: 0 of 9). The T2 complexity items were left in 6 of 6 (ts D06, py D06). py D12, the float-money rounding, was reported in 3 of 3 runs; the baseline missed it in 3 of 3.
- **The E02 rules that worked.**
  - Caches bounded or removed behind an observable test or a differential (F01).
  - The missing linter run before a suppression is judged (F05).
  - Clones in new tests reported as nits (F07).
  - The one-screen summary and `phases.json` (F08).
