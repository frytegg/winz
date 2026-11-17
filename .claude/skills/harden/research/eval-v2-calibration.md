# Evaluation v2 calibration findings
> Code E02 · slug eval-v2-calibration · measured 2026-09-24 · source: evals/results-v2.md (3 fixtures x with/without x 3 repeats, 18 runs, one independent grader per run, deterministic scorer)

## Summary

After the E01 calibration the skill outscored the baseline agent on all three fixtures (deterministic score 0.888,
range 0.84-0.917, vs 0.738, range 0.50-0.896) with detection 222/222 vs 215/222 and no safety regression: 0 of 69 trap
instances broken (baseline 5), 0 hidden-test failures (9), 0 existing test files edited (48), 0 mixed-kind commits
(30), 0 behaviour changes without a test (18), 0 wrongly changed or regressed instances (23). fix-T0 items fixed rose
from 33% to 95% and fix-T1 from 31% to 75%. The remaining gap is a set of specific rule effects the graders traced;
the calibrations below address them. They are not yet re-measured (a v3 evaluation is needed). n = 3 per cell.

## Findings

### E02-F01 — Unbounded in-process caches and histories get a bound with an observable test
- **Grade:** B (own measurement)
- **Evidence:** 6 of 9 WITH instances left unbounded caches or growing histories unfixed (ts D16 x2, py D19 x2, rs D16 x2), citing "no test can observe the growth", "no soak measurement", "a bound on a public attribute is an API change", and in rs-with-3 a fix reverted over a 7.6% text-report slowdown (p = 0.007). The baseline fixed all 9 with tests and no hidden regression.
- **Calibration:** a size-observable demonstrating test (entry count after N simulated TTL buckets or N polls, through existing state or a non-exported seam) is sufficient evidence. Bounding with a documented, configurable cap is T1 behavioural; removing a cache whose output is byte-identical is structural. A bound on a public attribute keeps the behavioural flag and a characterization test. A performance gate on such an item compares against a stated budget, not "any significant slowdown".

### E02-F02 — A finding's headline reproduction must turn green before the item is "applied"
- **Grade:** B (own measurement)
- **Evidence:** 9 partial fixes came from splitting a finding's consequences; the clearest is ts D08: the headline reproduction (`value --config nope.json` prints 0.00 and exits 0) still reproduced in 2 of 3 runs, and all 3 left a shared mutable default in place.
- **Calibration:** when a finding records a headline reproduction, the demonstrating test must turn that exact reproduction green; otherwise the finding stays `partial` in findings.json and heads the report's open items. Apply the E01-F07 "restores promised behaviour" test to each consequence separately.

### E02-F03 — Warn-first steps and credential defaults on T2 items are proposed, not applied
- **Grade:** B (own measurement)
- **Evidence:** 17 report-T2 instances were edited under T1 approvals (none regressed, all flagged): warn-first logging on py D09 and D10 (6 instances), the credential default in py D25 (x3) and rs-with-2 D23, the history-backed fee divergence py D05 (x3), guard-clause flattening in ts D06 (x3), rs-with-3 D15.
- **Calibration:** invariant 8 (T2 is report only, never edited) wins: a warn-first mitigation or a safer default for a T2 item is written into that item's report entry as a proposed first step for the owner, not applied under a T1 category approval. A T1 category approval never covers an item the tier table places in T2. Since 2026-09-25 (user-policy-autonomy U01-F06, U01-F11), an autonomous run whose profile sets `auto_apply.owner_judgement` true decides T2 items with the Owner-judgement lane (prioritization.md, Autonomous mode). The lane may apply an item's most conservative standard option: a lossless variant, a record-only log line with every result unchanged, or a default that the language, the platform or a library the code already uses documents. It never applies an enforce stage. Each such change gets its own commit, listed under the report's Applied, review before merge. With `--interactive`, or with the switch false, this calibration holds unchanged.

### E02-F04 — A verified placeholder credential literal may be deleted with its last use
- **Grade:** C (own measurement; security-sensitive policy)
- **Evidence:** nine runs handled the seeded placeholder credential in four different ways, and PC-21 ("no commit touches a secret-finding line") conflicted with E01-F07 ("removing a placeholder credential fallback is T1") whenever the fix needed the literal deleted. Two baseline runs measured that the exchange accepted the placeholder (HTTP 200).
- **Calibration:** a literal that is verifiably a placeholder (test-shaped markers such as `test`, `fixture`, `example`, `dummy`, `changeme`, `xxx`, `not_a_real`, and no match in a secret scanner's verified mode) may be deleted in the same commit that removes its last use, as part of an approved T1 item. Anything that could be a live credential stays under PC-21: never touched, reported, rotated by the human.

### E02-F05 — Run the missing linter before demoting a suppression
- **Grade:** C (own measurement, 4 instances)
- **Evidence:** ts D15 (a blanket `eslint-disable`) was demoted in two runs because ESLint was not installed; ts-with-2 ran ESLint through an ephemeral runner, found the hidden rules and narrowed the disable. py D18 received error codes but no reason in 2 of 3 runs, although TY-04 requires one.
- **Calibration:** when the tool behind a blanket suppression is not installed, run it through a pinned ephemeral runner (E01-F10) to list the rules the suppression hides, then narrow it; the narrowed suppression carries the reason TY-04 requires in the same commit.

### E02-F06 — A large deterministic function may be split behind a byte-identical differential
- **Grade:** C (own measurement, 3 instances)
- **Evidence:** rs D07 (`Engine::submit`, about 200 lines, fix-T1) was reported in two runs and partly done in the third; two baseline runs split it with a byte-identical differential test over generated order streams (the third bundled a behaviour change into the refactor commit, the failure the skill's commit discipline prevents).
- **Calibration:** when a differential over generated inputs through the public API is feasible and byte-identical before and after (PC-15), Extract Function on a large deterministic function is T1 structural with approval, one extraction per commit.

### E02-F07 — Put the duplicate-code check in the per-item gate
- **Grade:** C (own measurement)
- **Evidence:** six revert/redo pairs across three runs (ts-with-1, ts-with-3, rs-with-2) after jscpd found clones in newly added tests only at batch end.
- **Calibration:** run the duplicate-code detector on the item's diff before committing; new test files may repeat setup code, so report clones inside tests as nits rather than reverting.

### E02-F08 — Report and cost: one-screen summary, per-phase timestamps, a run-managed scratch directory
- **Grade:** C (own measurement)
- **Evidence:** a WITH run took 3.7 times the baseline's wall time (mean 2 h 22 min) with a median 11k-word report; the data could not show which phases took the time. ts-with-3 put scratch clones and a mutation-tool install in a sibling directory outside its run directory.
- **Calibration:** the report opens with a one-screen summary (what changed, what needs a decision, what was not checked); each phase start and end is timestamped in progress.md; scratch clones, worktrees and copies live in one run-managed temp directory outside the repository (the scratch_dir that run_state.py start creates under the OS temp directory, records in .harden/active and prints, and that run_state.py stop removes only while it carries the run's owner marker), never in an existing directory; tool binaries and venvs live under .harden/tools/; detectors run on the git-tracked in-scope file list (.harden/tools/inscope.txt), never on ".".

## Practitioner voice

None: this dossier records the skill's own measured behaviour on the fixtures in evals/.

## Contradictions and open questions

- The three fixture ledgers disagree on the credential tier (ts D23 fix-T1; py D25 and rs D23 report-T2); E02-F04 follows the stricter reading for live-looking values.
- These calibrations are unmeasured until a v3 evaluation runs (5 repeats per cell recommended for rs, where the arms' ranges touch).
- E02-F08 first placed scratch clones and tool installs under .harden/ (results-v2 item 11, as rs-with-2 did); the scratch location was reverted before any v3 run. .harden/ is excluded from git, not from the tools: test runners run on the working tree (vitest and jest do not exclude .harden/ by default) and detectors would discover copies there, and Node in a clone nested in the repository resolves the repository's node_modules, which defeats the fresh-clone check for hidden local state (PF-10). The run-managed directory outside the repository avoids both, and creating it fresh, then removing it only with its owner marker, avoids the other failure seen: writes into an existing directory (the v2 sibling directory above; the v1 write to ~/package.json, eval-v1-calibration E01-F10). These tool behaviours are design reasoning from the decision, not yet verified against the tools' documentation in a dossier, and neither location has been measured.

## Dropped findings

- Giving hollow tests an approvable in-place option (results-v2 item 5): not adopted, invariant 2 stays (see E01-F04).
- ts D12 representation alternative (results-v2 item 8): fixture-specific, not a rule.
