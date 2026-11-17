# Evaluation v1 calibration findings
> Code E01 · slug eval-v1-calibration · measured 2026-09-24 · source: evals/results-v1.md (3 fixtures x with/without x 2 repeats, 12 runs, one independent grader per run)

## Summary

The paired evaluation (skill-design T31-F01: keep only the sections that move the numbers) found that the skill
detects more (148/148 seeded defect instances vs 142/148 for the baseline agent; 83 vs 65 valid extra findings) and
is safer (0 vs 1 broken trap, 0 vs 19 mixed-kind commits, 0 vs 12 behaviour changes without a test, public API
unchanged in 6/6 runs vs changed in 5/6), but applied too few fixes: 80 of 148 instances were reported and not fixed
(baseline: 1). Partial-credit handling score 0.716 (with) vs 0.848 (baseline, adjusted). The graders traced the gap
to a handful of over-conservative tiering rules, not to agent mistakes. n = 2 per cell: indicative, not significant.
These findings calibrate existing, externally sourced rules; they never replace the external evidence those rules cite.

## Findings

### E01-F01 — Insufficient history must not make every file "cold"
- **Grade:** B (own measurement, n=2 per cell)
- **Evidence:** 21 of the 80 unfixed instances came from the cold-code policy (PZ-13/PZ-14). With short fixture histories PZ-13 labelled every file `unknown`, treated as cold, and PZ-14 made naming, comments and formatting report-only, so zero-risk items stayed unfixed: commented-out code confirmed by ERA001 (py-with-1 D04), session-narration comments and a README command that exits 2 when replayed (py D21, D22), a verified replacement command (rs-with-1 D20), comment-only changes (ts-with-1 D18, D19).
- **Calibration:** `unknown` caused by insufficient history is not a temperature measurement: treat such files as warm (or ask the user). Commented-out code, session-narration comments, documented commands that fail when replayed, compiler-proven unused imports and missing `await` are fixed at every temperature. The cold-code policy governs structural refactors only and never overrides T0. The situation question needs a "release preparation" answer, the skill's own trigger.

### E01-F02 — A red formatting or lint gate at baseline must not stop the whole run
- **Grade:** B (own measurement)
- **Evidence:** rs-with-2 adopted `cargo fmt --check` (from rustfmt.toml; not a documented or CI gate) as a gate; it was red at base (12 hunks), so the run switched itself to report-only: 0 commits, 19 fix-tier defects unfixed, score 0.60. rs-with-1 on the same repository did not adopt that gate, applied 6 fixes and scored 0.73. Both baseline runs made the formatting drift its own style commit.
- **Calibration:** gates are the project's documented or CI gates. A formatting or lint gate red at base becomes a ratchet (implemented as: its violation count may not rise above the count recorded at the probe, `gates.py --ratchet-from probe`; a total count can mask one new violation behind one removed, so SARIF deltas still apply where the tool writes SARIF); the existing drift is reported or offered as its own style commit (T0 for touched files, T1 with approval for the whole repository, PC-11). Whole-run report-only stays for a red build, test or type-check gate and for flaky tests.

### E01-F03 — Restoring a contract is not breaking one; re-ask instead of silently deferring approved items
- **Grade:** B (own measurement)
- **Evidence:** 10 unfixed instances came from PC-14 treating any change to an error type, message, exit code, default, output format or fail mode as a T2 contract change, including items the simulated user had approved: config read failure should exit 1 (ts D08), AssertionError replaced by ValueError (py D16), a return in `finally` that swallows cancellation (py D17), a failed `--json` write should exit non-zero (rs D08). py-with-2 applied PC-14's own "warn first" staging to D07 and D10 and was credited; py-with-1 proposed the same fix and applied nothing.
- **Calibration:** changes that restore documented or language semantics (an `assert` replaced by the exception it stands for, non-zero exit when requested output was not written, letting cancellation propagate) stay T1 behavioural. A fail-open to fail-closed flip is applied warn-first by default. An item re-tiered after the user approved it goes back to the user; the answer is recorded in approvals.md.

### E01-F04 — A hollow test gets a new pinning test, not a report entry
- **Grade:** B (own measurement)
- **Evidence:** 5 runs left no oracle behind for the seeded test-without-assertion (ts D22 x2, py-with-1 D24, rs D22 x2). py-with-2 added a new characterization test file pinning the contract without touching the hollow test and was graded fixed; rs-with-1 proposed the same test and then demoted it to needs_review.
- **Calibration:** when a hollow or assertion-free test is found, add a new test file that pins the same contract and is shown to fail on a deliberate fault (test-only T1 item). The evaluation report also suggested making "strengthen or delete the existing hollow test" an approvable category like DC-15; that part was not adopted, to keep invariant 2 (existing tests are read-only; sole exception DC-15), so editing the hollow test stays a T2 owner decision.

### E01-F05 — A missing timeout gets a configurable, documented default
- **Grade:** B (own measurement)
- **Evidence:** none of the 6 WITH runs added a timeout to the seeded unbounded network calls (ts D10, py D11, rs D10), citing "no latency data to choose a value" (4 runs), the cold-code policy (1) or the whole-run report-only switch (1). All 6 baseline runs added a finite, mostly configurable 10 s timeout and the hidden suites still passed.
- **Calibration:** when no latency data exists, add a configurable timeout parameter with a generous documented default as a T1 behavioural item, and list the value in the report as owner-tunable. An unbounded call is the defect; the exact value is the owner's tuning.

### E01-F06 — Self-evident items need no needs_review; the nit cap never hides an item
- **Grade:** B (own measurement)
- **Evidence:** rs-with-1 D05 (commented-out code) was approved as T1 and then made report-only because its confidence was needs_review; rs-with-1 and ts-with-2 D18/D19 were listed as nits and not fixed; the 10-nit cap in report.md hid py-with-1 D21 (only in findings.json and SARIF).
- **Calibration:** comments, commented-out code and unused imports have a deterministic evidence path (the text itself plus an AST-identical or compiler-clean check) that ranks at least tool_high_precision. The nit cap limits the main list only; overflow goes to an appendix of report.md.

### E01-F07 — Fixes that restore promised behaviour are T1, not T2
- **Grade:** B (own measurement)
- **Evidence:** domain rules demoted local fixes the code already promised: an exact float comparison left unfixed because "a tolerance is a domain choice" (ts D11, both runs; both baseline runs added a relative tolerance with hidden suites green); an ISO-8601 round trip re-tiered to T2 in one run and fixed with a failing-at-base test in the other (ts D24); a stale copy of a fee formula whose sibling was fixed in history kept report-only as "a published number" (rs-with-1 D06), while py runs used the same history argument to tier py D05 T1; removing a placeholder credential fallback rated undetermined without a live call (ts D23); a helper that never had a caller called "purpose unknown" (py D01); keeping references to fire-and-forget tasks kept report-only in one run and fixed in the other (py D15); an additive public union member deferred (ts D09).
- **Calibration:** one shared test in tiering: does the fix restore behaviour the code, its docs or a sibling fix already promise? If so it is T1 behavioural with approval. In particular: ISO 8601 with Z for a round trip the code controls; "no call site in any commit since introduction" (`git log -S`) is a named reason for dead code; keeping task references is a documented mechanical fix; removing a placeholder credential fallback; additive public union members and options with defaults (T1 with approval).

### E01-F08 — A fix that tightens validation must pin previously valid inputs first
- **Grade:** B (own measurement)
- **Evidence:** both WITH runs fixed ts D12 by rejecting any orderId that is not a safe integer, so exports with 18-19 digit or alphanumeric ids that produced correct PnL before now exit 1; ts-with-2's report claimed the change affected "only inputs currently corrupted", which the grader disproved; ts-with-1 filed no follow-up. The baseline made the same choice.
- **Calibration:** when a fix adds a rejection, its characterization tests include previously accepted valid inputs of the same class; the report lists the newly rejected class as an open owner item; a representation change (e.g. string ids) goes to T2 next to the stop-gap.

### E01-F09 — Each consequence of a finding is tracked separately
- **Grade:** B (own measurement)
- **Evidence:** ts-with-1 H-09 (D07) named two consequences (error dropped at debug level; cooldown recorded when every notifier fails); its commit fixed only the first ("cooldown handling unchanged") and deferred the second inside the finding's notes. ts-with-2 fixed both.
- **Calibration:** every consequence named in a finding gets its own line in the fix plan; any consequence left unaddressed becomes its own finding with its own tier and appears among the report's open items.

### E01-F10 — Tool installs stay inside the run
- **Grade:** B (own measurement)
- **Evidence:** py-with-1 ran `npm install` for jscpd from the wrong directory, which wrote `~/package.json`, `~/package-lock.json` and `~/node_modules` outside the repository; the run reverted and disclosed it.
- **Calibration:** install tools only through pinned ephemeral runners (`pnpm dlx <pkg>@<x.y.z>`, `uvx <tool>@<x.y.z>`, `cargo install --locked --root .harden/tools/<crate> <crate>@<x.y.z>`; the project's own tools through its package manager, e.g. `pnpm exec`) or an explicit prefix under .harden/tools; check the working directory before any package-manager command; refuse a command that would modify a manifest outside the repository.

### E01-F11 — Tier decisions need a deterministic table
- **Grade:** B (own measurement)
- **Evidence:** repeats on the same fixture chose different fixes (ts: D07, D08, D16, D24; py: D02, D04, D07, D08, D15, D17, D20, D24); rs-with-1 applied 6 fixes and rs-with-2 none. Baseline repeats agreed more closely (0.88/0.94, 0.88/0.88, 0.96/0.96).
- **Calibration:** map category and evidence level to a tier with a deterministic table the orchestrator applies without judgement, and log the rule id of every demotion in findings.json.

### E01-F12 — Run the project's linter in each item's gate
- **Grade:** C (own measurement, one run pair)
- **Evidence:** py-with-1 needed 5 commits for D13 (two attempts reverted for new lint hits, UP017 then an EncodingWarning); py-with-2 had one revert for the same fix.
- **Calibration:** the per-item gate set includes the project's lint command, so a fix is linted before it is committed.

## Practitioner voice

None: this dossier records the skill's own measured behaviour on the fixtures in evals/.

## Contradictions and open questions

- The fixture ledgers' tiers are one view of the right handling (for example they expect narration comments fixed as T0); a different ledger would change handling scores but not detection or safety numbers.
- n = 2 per cell; the WITH condition varied more between repeats than the baseline. Re-measure after applying these calibrations with at least 3 runs per cell.

## Dropped findings

None.
