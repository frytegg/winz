# How far to trust tool autofixes: one apply / approve / report policy for mechanical changes
> Code X02 · slug autofix-trust · verified 2026-09-23 · counts: verified 11 / corrected 11 / downgraded 2 / dropped 0

## Summary

This dossier checks the researcher's output (topic G105) against the sources it cites. Every GitHub issue (51 of them) was re-read through the GitHub API: title, state, dates, labels and, for the key ones, the body and the maintainer comments. Every documentation quote was re-fetched from the live page or raw source file on 2026-09-23. Every arXiv or PDF paper was downloaded and grepped. The five Hacker News comments were checked through the HN Algolia API. All label counts were re-run through the GitHub search API. Tool versions match what the researcher reported: ESLint 10.11.0, typescript-eslint 8.70.1, Biome 2.5.14, Ruff 0.16.8, Prettier 3.9.9, Black 26.5.1, diff-cover 10.6.0, and clang-tidy docs 24.0.0git.

**What holds up.** The core picture is sound, and every documentation quote exists.
- Each fixer ecosystem declares its own safety tier.
- Each tier has an off-by-default escape hatch that widens it.
- Tool-declared "safe" fixes still break code at a low, continuing rate.
- Tests are an imperfect oracle.
- Large programmes (Google, Uber) grant trust per analyzer, with sharding and owner review.

Every GitHub issue cited exists with the title given, and every numeric count reproduced exactly (Ruff 276/31/46, Clippy 40/12 and 925/238/127, Clippy index 839 lints with 373 MachineApplicable, LLVM 39).

**What had to be corrected.**
1. **The raw tracker counts overstate how often "safe" labels are wrong.**
   - Ruff's `fixes`+`bug` label covers fixes at every tier: preview fixes (21 of 276), unsafe fixes, infinite loops, and syntax errors that Ruff itself reverts.
   - Ruff #26922, the headline "safe fixes that cause runtime errors" example, is about preview-only rules (FURB101/FURB103 need `--preview`).
2. **The Clippy "925 loud vs 40 silent" ratio is partly an artefact of label age.**
   - The `I-suggestion-causes-bug` label has been in steady use only since 2024. `I-suggestion-causes-error` dates from 2016.
   - For issues opened since 2025-01-01, the ratio is 278 vs 33, about 8:1, not about 23:1. The direction of the finding (most defects are loud) survives.
3. **Several cited fix bugs involve fixes that are unsafe or preview upstream, so F01 already excludes them.**
   - Biome `useAtIndex` and Biome `noUnusedImports` (both unsafe today).
   - Ruff UP040, UP046 and UP047 (always unsafe).
   - Ruff FURB101 and FURB103 (preview).
4. **One LLVM citation is invalid.** #104565 ("use-emplace fix-it leads to compilation error") was closed as *worksforme* after a maintainer showed that the fix compiles.
5. **Ruff maintainers rejected B010 (#28493) as a fix-safety bug.** They wrote that Ruff's fix-safety criteria are "the fix doesn't change runtime behavior and doesn't remove comments", and a type-checker regression is outside them. The skill must know that a Ruff "safe" label says nothing about type-checker compatibility.
6. **Attribution and venue fixes.**
   - "Assured LLM-Based Software Engineering" is by Alshahwan, Harman, Harper and Marginean (InteNSE '24 workshop), not "Harman et al.".
   - TestGen-LLM appeared at FSE 2024.
   - Sorald's 1,610 are "patches", and one of its 7 test failures was a genuine fix defect that the dossier omitted.
   - The Google "700 changes / 15,000 files per day" figure was the peak of one specific migration.
   - The "overload resolution" reason given for Google's NULL→nullptr rejection is not in the source.

**Grades.**
- F11 (cfg and build configurations) is downgraded from A to B: only Rust documents the mechanism, and the other languages are extrapolated.
- F24 (the four-tier policy) is downgraded from B to C: its components are sourced, but its thresholds (100% touched-line coverage, the hunk-sample size, the ≥30-file LSC trigger) are policy choices that no source validates.

**Net policy for the skill.** Only the tool's own highest-safety tier may run unattended, one rule per commit, from a clean tree, gated by parse → compile/type-check → re-lint → tests, with automatic revert on failure. Formatter-only changes to primary-language files are the only near-unconditional auto-apply class. Deletions, imports, evaluation-order and truthiness rewrites, version- or cfg-gated code and public API go to approval or report. Suppressions are never written.

## Findings

### G105-F01 — Only the tool's highest-safety fix tier may run unattended; every escape hatch that widens it is banned
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Each ecosystem defines "safe" differently, and each ships an explicit off-by-default channel for fixes it considers risky. Flipping that switch hands the decision back to whoever flipped it.
  - ESLint gives best-practice advice to rule authors.
  - Ruff says safe fixes are "intended to preserve runtime behavior". Its opening sentence is stronger: "The meaning and intent of your code will be retained".
  - rustc's MachineApplicable admits "what the user intended", which is weaker than meaning-preserving.
  - Biome says "guaranteed".

  Allowed unattended commands:
  - `ruff check --fix` (safe fixes only)
  - `biome lint --write` (safe only)
  - `eslint --fix` (real fixes; suggestions are never applied by `--fix`)
  - `cargo fix` and `cargo clippy --fix` (MachineApplicable only)
  - `clang-tidy -fix` (without `-fix-errors` or `-fix-notes`)
  - `go fix` (the curated suite)

  Banned:
  - `--unsafe-fixes` / `unsafe-fixes = true`
  - `biome … --unsafe`
  - `__CARGO_FIX_YOLO` and `--broken-code`
  - `-fix-errors` and `-fix-notes`
  - react-hooks `enableDangerousAutofixThisMayCauseInfiniteLoops`
  - typescript-eslint `allowPotentiallyUnsafeFixesThatModifyTheReturnTypeIKnowWhatImDoing`
  - agent-added `extend-safe-fixes` (the setting exists in the Ruff settings reference)
  - clang-tidy `modernize-loop-convert.MinConfidence: risky`

  Treat a "safe" label as the tool author's intent, never as proof.
- **Evidence:**
  - [Custom Rules – Best practices for fixes / Providing Suggestions](https://eslint.org/docs/latest/extend/custom-rules) — ESLint, 2026 — official docs — "Avoid any fixes that could change the runtime behavior of code and cause it to stop working." / "In some cases fixes aren't appropriate to be automatically applied, for example, if a fix potentially changes functionality or if there are multiple valid ways to fix a rule…" — both sentences confirmed on the live page.
  - [The Ruff Linter – Fix safety](https://docs.astral.sh/ruff/linter/) — Astral, 2026 (Ruff 0.16.8) — official docs — "The meaning and intent of your code will be retained when applying safe fixes, but the meaning could change when applying unsafe fixes." / "safe fixes are intended to preserve runtime behavior" / "Ruff only enables safe fixes by default." — all three confirmed.
  - [rustc_errors::Applicability](https://doc.rust-lang.org/nightly/nightly-rustc/rustc_errors/enum.Applicability.html) — Rust project, 2026 — official docs — MachineApplicable: "The suggestion is definitely what the user intended, or maintains the exact meaning of the code. This suggestion should be automatically applied." — confirmed verbatim.
  - [cargo src/ops/cargo_fix/mod.rs](https://github.com/rust-lang/cargo/blob/master/src/ops/cargo_fix/mod.rs) — Rust project, 2026 — source code — `.get_env_os("__CARGO_FIX_YOLO")` → `rustfix::Filter::Everything`, otherwise `MachineApplicableOnly` (lines 1011–1013). The rustfix `Filter::Everything` doc comment is "Everything is included. YOLO!". Confirmed in raw source on master.
  - [Biome Linter – Safe fixes / Unsafe fixes](https://biomejs.dev/linter/) — Biome, 2026 — official docs — "Safe fixes are guaranteed to not change the semantic of your code. They can be applied without explicit review." — confirmed verbatim.
  - [ExhaustiveDeps.ts](https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/src/rules/ExhaustiveDeps.ts) — React team (Meta), 2026 — source code — `if (enableDangerousAutofixThisMayCauseInfiniteLoops) { // Used to enable legacy behavior. Dangerous. … problem.fix = problem.suggest[0].fix; }`, default `false`. Confirmed (lines 58, 111–119).
  - [Clang-Tidy](https://clang.llvm.org/extra/clang-tidy/) — LLVM (docs 24.0.0git), 2026 — official docs — `--fix`: "Without -fix-errors clang-tidy will bail out if any compilation errors were found." `--fix-errors`: "…If compiler errors have attached fix-its, clang-tidy will apply them as well." Confirmed.
- **Detect:** Run `rg -n -- '--unsafe-fixes|unsafe-fixes\s*=\s*true|biome .*--unsafe|__CARGO_FIX_YOLO|--broken-code|-fix-errors|-fix-notes|enableDangerousAutofixThisMayCauseInfiniteLoops|allowPotentiallyUnsafeFixesThatModifyTheReturnTypeIKnowWhatImDoing|extend-safe-fixes|MinConfidence:\s*risky'` over package.json, pyproject.toml, ruff.toml, biome.json(c), .clang-tidy, Makefile, .github/workflows and .pre-commit-config.yaml.

  Before applying anything, inventory the applicability of each fix:
  - Ruff: `ruff check --output-format json | jq '.[]|select(.fix)|[.code,.fix.applicability]'`
  - ESLint: `eslint -f json .`, then separate `.fix` from `.suggestions`
  - Clippy: `cargo clippy --message-format=json`, then read `children[].spans[].suggestion_applicability`
- **Tools:** ruff, biome, eslint, typescript-eslint, cargo fix, cargo clippy, clang-tidy, go fix, ripgrep, jq.
- **Applies to:** All languages; every mechanical fix step.
- **When not to apply / counterpoints:**
  - Keep `extend-safe-fixes` entries the project owners configured themselves, and never add entries.
  - Banning `-fix-errors` means clang-tidy cannot fix code that does not compile. Such code is outside a "finished, working" scope anyway.
- **Fix risk:** low

### G105-F02 — "Auto-apply" never means "unverified": gate every batch with build, type-check and tests, and revert the whole batch on failure
- **Grade:** B · **Verdict:** CORRECTED (the tracker counts are re-characterised: they are not "safe-label failure" counts; Ruff #26922 is preview-only)
- **Rationale:** Safe labels come from human-written preconditions, and the trackers show those preconditions failing continuously in 2025–2026. After every automated fix batch, run the project's full build, type-check and test suite before committing, whatever the fix's label. On any failure, revert the batch; do not patch forward. Before trusting a rule, check the fixer's tracker for open behaviour-change issues on that rule id at the pinned version.

  **Correction.** The raw counts are *fix-related bug reports at every tier*, not counts of safe-label failures.
  - Ruff `fixes`+`bug`: 276 total, 31 open, 46 created since 2025-09-23.
    - 21 of the 276 carry the `preview` label (8 of the last 46).
    - Many concern unsafe fixes (UP040/046/047) or syntax errors that Ruff auto-reverts.
    - The recent list (checked title by title) is dominated by syntax errors, infinite loops and comment loss. Silent runtime changes are fewer.
  - Clippy `I-suggestion-causes-error` covers every applicability level and includes ICEs ("cause an ICE/error when applied").
  - Ruff #26922 ("FURB101 and FURB103 apply safe fixes that cause runtime errors") is real and reproduces, but its repro uses `ruff check --preview`. FURB101 and FURB103 are preview-only rules, so a stable, preview-off configuration never applies them.

  **Genuine stable safe-fix failures**, which are better examples:
  - Biome #11351: `useSimplifiedLogicExpression` is a safe fix; bug confirmed and fixed 2026-09-17.
  - Biome #10212: `useConsistentObjectDefinitions` is a safe fix; open, bug confirmed; the named-function `.name` changes from "c" to "b".
  - Biome #11419: `noAdjacentSpacesInRegex` is a safe fix; open, bug confirmed; applied by plain `biome check --fix`.
  - Ruff #18807: the F541 safe fix turns a module-level string into a docstring.
  - ESLint #21279: the prefer-object-has-own autofix; accepted and fixed 2026-09-01.
- **Evidence:**
  - [Ruff issues: label:fixes label:bug](https://github.com/astral-sh/ruff/issues?q=is%3Aissue+label%3Afixes+label%3Abug) — Astral / Ruff users, 2026 — tracker query — 276 total, 31 open, 46 since 2025-09-23 (re-run via the GitHub search API: exact match). Preview-labelled: 21 total, 8 in the last 12 months. Characterisation corrected as above.
  - [Ruff #26922](https://github.com/astral-sh/ruff/issues/26922) — Ruff user, 2026-07-16 — incident report — repro `ruff check --select FURB101 --preview`; `pathlib.Path(b"file.txt").read_text()` raises TypeError. Open, labels bug/fixes/preview. The FURB101 rule page says "This rule is unstable and in preview. The --preview flag is required for use."
  - [Clippy issues: I-suggestion-causes-bug](https://github.com/rust-lang/rust-clippy/issues?q=is%3Aissue+label%3AI-suggestion-causes-bug) — Clippy maintainers, 2026 — tracker query — label text confirmed via the labels API: causes-bug = "The suggestion compiles but changes the code to behave in an unintended way"; causes-error = "…cause an ICE/error when applied". Counts confirmed: causes-bug 40 (12 open); causes-error 925 (238 open, 127 since 2025-09-23).
  - [Biome #11351](https://github.com/biomejs/biome/issues/11351), [#10212](https://github.com/biomejs/biome/issues/10212), [#11419](https://github.com/biomejs/biome/issues/11419) — Biome users, 2026 — incident reports. Titles, versions (2.5.8; 2.4.13; 2.5.9) and states confirmed. The rule pages confirm "This rule has a safe fix" for all three.
  - [ESLint #21279](https://github.com/eslint/eslint/issues/21279) — ESLint user, 2026-08-30 — incident report — title confirmed; closed as completed 2026-09-01; labels bug/accepted.
- **Detect:**
  - Gate after each fix commit: `(build && typecheck && test) || git revert --no-edit HEAD`.
    - Python: pytest.
    - Rust: `cargo test --all-targets`.
    - Go: `go vet ./... && go test ./...`.
    - C++: full build plus ctest.
  - Tracker lookup per rule id:
    - `gh search issues --repo astral-sh/ruff --label fixes --label bug --state open <RULE>`
    - `gh search issues --repo rust-lang/rust-clippy --label I-suggestion-causes-bug <LINT>`
- **Tools:** gh, git, project test runner, tsc, mypy/pyright, cargo, go.
- **Applies to:** All languages; all tool-declared safe fixes.
- **When not to apply / counterpoints:**
  - No tool publishes a denominator (fixes applied), so the per-fix error rate is unknown and probably very low for mature rules.
  - A type-check gate can reject a fix that the tool considers safe by its own criteria (see F15, B010). That is the gate working as intended, not a tool bug.
  - Running the full suite per rule is expensive; batching same-family rules is a cost trade-off.
- **Fix risk:** low

### G105-F03 — Run gates cheapest and loudest first; keep the tools' own self-checks on; spend review effort on the silent residue
- **Grade:** B · **Verdict:** CORRECTED (the Clippy ratio is confounded by label age and restated; the Black count is re-characterised)
- **Rationale:** The gate order is: re-parse or format-check → compile/type-check → re-lint to a fixed point → full tests. Never disable the self-checks: Black's AST check (no `--fast`), Ruff's syntax-error revert, cargo's back-out (no `--broken-code`), and clang-tidy's bail-out on compile errors (no `-fix-errors`).

  Failures skew toward build breakage:
  - The refactoring-engine study (Eclipse, IntelliJ, NetBeans; 518 bugs) reports Compile Error 242, Crash 106 and Behaviour Change 66 as the top three symptoms.

  **Correction on Clippy.** The raw 925 (causes-error) vs 40 (causes-bug) comparison is not like-for-like.
  - The causes-bug label's earliest uses are one 2019 issue and then a steady run from March 2024 onward.
  - causes-error goes back to 2016.
  - For issues opened since 2025-01-01 the comparison is 278 vs 33, about 8:1. Loud failures still dominate, but by roughly 8×, not 23×.
  - Silent behaviour changes in older Clippy issues were often tagged only `I-false-positive`/`C-bug`, so 33 is a floor.

  **Correction on Black.** Searching the tracker for the internal-error text returns 132–137 issues depending on the exact phrase. These are reports where Black's equivalence check fired and refused to write. They show the guard works, and also that the formatter itself regresses (for example Black 26.5.0, #5138).

  cargo re-runs rustc and backs out on failure. Ruff's release-build message is "Fix introduced a syntax error. Reverting all changes. This indicates a bug in Ruff."
- **Evidence:**
  - [An Empirical Study of Refactoring Engine Bugs (arXiv:2409.14610)](https://arxiv.org/abs/2409.14610) — Wang, Xu, Zhang, Tsantalis, Tan (Concordia / PolyU), 2024 — preprint (no journal_ref on arXiv or OpenAlex as of 2026-09-23) — "Finding 2: "Compile Error" (242), "Crash" (106), and "Behavior Change" (66) are the top three most common symptoms…" and "revealed 130 new bugs". Confirmed in the PDF (Table 4, 518 bugs studied).
  - [cargo_fix/mod.rs module docs](https://github.com/rust-lang/cargo/blob/master/src/ops/cargo_fix/mod.rs) — Rust project, 2026 — source code — "rustc is run again to verify the suggestions didn't break anything. The change will be backed out if it fails (unless `--broken-code` is used)." Confirmed (lines 34–37).
  - [ruff_linter/src/linter.rs](https://github.com/astral-sh/ruff/blob/main/crates/ruff_linter/src/linter.rs) — Astral, 2026 — source code — the release-build message is confirmed at line 745. The fix loop returns the original code when a subsequent pass introduces a parse error (lines ~627–640).
  - [Black – AST before and after formatting](https://black.readthedocs.io/en/stable/the_black_code_style/current_style.html) — Black 26.5.1, 2026 — official docs — "When run with --safe (the default), Black checks that the code before and after is semantically equivalent. This check is done by comparing the AST…" Confirmed. The same section lists three tolerated AST differences: docstring whitespace, `del` parentheses, and moved comments.
  - [Clippy label history (search API)](https://github.com/rust-lang/rust-clippy/issues?q=is%3Aissue+label%3AI-suggestion-causes-bug+sort%3Acreated-asc) — Clippy maintainers, 2026 — tracker query — oldest causes-bug issues: #4295 (2019), then #12600 (2024-03-31) onward. The oldest causes-error issue is #739 (2016). Since 2025-01-01: causes-error 278 and causes-bug 33 (computed here).
- **Detect:**
  1. `ruff check` / `black --check` / `prettier --check` / `cargo fmt --check` / `gofmt -l`
  2. `tsc --noEmit` / mypy/pyright / `cargo check --all-targets` / `go build ./...` / full C++ build
  3. Re-run the same linter and require zero new diagnostics.
  4. Full tests.

  Flag any `black --fast`, `--broken-code` or `-fix-errors`.
- **Tools:** black, ruff, cargo, clang-tidy, tsc, mypy, pyright, go build.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - The refactoring study concerns IDE refactorings, which are larger than lint fixes, and it is an unrefereed preprint.
  - In Python and JS without type-checking the compile gate is thin, so more weight falls on tests (F04).
- **Fix risk:** low

### G105-F04 — Unattended fixes only on test-covered lines; on a test failure revert the fix, never the test, and report
- **Grade:** B · **Verdict:** CORRECTED (the Sorald composition is completed and the denominator wording fixed; Silva et al. 2017 is now verified from its own abstract)
- **Rationale:** Tests are the only oracle for silent behaviour change. Measure diff coverage on the fix commit (`diff-cover coverage.xml --compare-branch=HEAD~1 --fail-under=100`). Any touched line that is not covered demotes the batch to approve.
  - In Clippy #16191 a `cargo clippy --fix` let-chain rewrite made unit tests fail.
  - Sorald ran whole test suites after patching. In the paper's words, "there are only 7 cases out of 1,610 patches" (0.4%) where tests failed. The failures fell into three groups:
    - 4 were intentional "violations", such as integer division used for its floor.
    - **1 was a genuine fix defect:** the S2095 try-with-resources fix "eliminated" code that used the resource, breaking functionality. The original dossier omitted this case.
    - 2 were tests enforcing buggy behaviour (S2111).

  Limits of the oracle:
  - A maintainer warned against approving automated patches "as long as the tests are green".
  - Microsoft engineers say an inadequate regression suite means "no safety net".
  - Silva et al. (AST 2017) found that Randoop and EvoSuite suites "missed more than 50% of all injected faults".
- **Evidence:**
  - [Sorald: Automatic Patch Suggestions for SonarQube Static Analysis Violations](https://arxiv.org/abs/2103.12033) — Etemadi, Harrand, Larsén, Adzemovic, Luong Phu, Verma, Madeiral, Wikström, Monperrus, 2022 (IEEE TDSC, DOI 10.1109/TDSC.2022.3167316, issue dated 2023) — peer-reviewed — "Only seven of these (or 0.4%) contain at least one test that fails after being patched by SORALD." / "in four of the seven cases… the rule violation is intentional" / "This means the tests are wrong and enforce the incorrect behavior of the buggy program" / PR22 maintainer: "…just approve it as long as the tests are green". All confirmed in the PDF, plus the S2095 defect case.
  - [Clippy #16191](https://github.com/rust-lang/rust-clippy/issues/16191) — Clippy user, 2025-12-04 — incident report — "I used `cargo clippy --fix` and unittests failed as a result, because the code didn't do the same as before." Confirmed; open; label I-suggestion-causes-bug; rustc 1.91.1.
  - [A Field Study of Refactoring Challenges and Benefits (FSE 2012)](https://thomas-zimmermann.com/publications/files/kim-fse-2012.pdf) — Miryung Kim, Thomas Zimmermann, Nachiappan Nagappan, 2012 — peer-reviewed — "77% of the participants consider that refactoring comes with a risk of introducing subtle bugs and functionality regression" / "when a regression test suite is inadequate, there is no safety net…" Confirmed.
  - [Analyzing Automatic Test Generation Tools for Refactoring Validation (AST 2017)](https://doi.org/10.1109/ast.2017.9) — Indy P. S. C. Silva, Everton L. G. Alves, Wilkerson L. Andrade, 2017 — peer-reviewed workshop paper — abstract (via OpenAlex): "both Randoop and EvoSuite suites missed more than 50% of all injected faults." The abstract was accessed directly, so the source is no longer secondary-only.
  - [diff-cover README](https://github.com/Bachmann1234/diff_cover) — Bachmann1234/diff_cover, 2026 (v10.6.0) — tool docs — "Automatically find diff lines that need test coverage."; accepts Cobertura, Clover, JaCoCo XML and LCov. Confirmed.
- **Detect:** Produce a coverage report (coverage.py XML, vitest/jest lcov, cargo-llvm-cov lcov, JaCoCo, or a Go coverprofile converted to Cobertura). Then run `diff-cover <report> --compare-branch=HEAD~1 --fail-under=100`; if it fails, demote to T2. On a test failure, run `git revert --no-edit HEAD` and log the rule id, the failing test and the hunk.
- **Tools:** diff-cover, coverage.py, vitest, jest, cargo-llvm-cov, JaCoCo, git.
- **Applies to:** All languages with a test suite; projects without tests get no unattended tier.
- **When not to apply / counterpoints:**
  - No study sets a coverage threshold; the 100%-of-touched-lines bar is policy.
  - Line coverage does not prove that an assertion observes the change; mutation testing would be stronger.
  - Google's "more confident in… a single change than a test with any recent history of flakiness" is about flaky tests specifically. Google uses it to justify ignoring recently flaky tests in LSC submission, not to justify skipping tests.
- **Fix risk:** low

### G105-F05 — Never bulk-autofix correctness or bug-category findings; triage each one
- **Grade:** B · **Verdict:** CORRECTED (the detection heuristic "Ruff prefix F" is too broad and contradicts F09 and F21; it is narrowed to named codes)
- **Rationale:** A correctness lint's message is often the symptom of a real mistake, and the mechanical fix can silence the symptom while keeping the mistake. Route to triage:
  - Clippy `correctness` and `suspicious`
  - Ruff logic-error codes (for example F541, F632, F811), PLE*, and the bug-finding B-codes
  - ESLint `meta.type: "problem"` rules
  - clang-tidy `bugprone-*`
  - Sonar bug-type rules

  Supporting evidence:
  - Ruff #22620 (open, `needs-decision`): F541 turns `f"Hello name!"` into `"Hello name!"`, which "hides the bug the developer made".
  - Clippy's own metadata shows authors rarely mark correctness fixes MachineApplicable: 7 of 67 correctness lints, against 110 of 158 style lints and 106 of 143 complexity lints. The counts were re-parsed from the stable index and match exactly.
  - Sorald's S2184 fixes were declined three times as unnecessary.

  **Correction.** The original detection ("Ruff: rule prefix F…") would send F401 and F841 to report-only. That contradicts F09 and F21, which put them in approve. Use named codes, not the whole F prefix.
- **Evidence:**
  - [Ruff #22620](https://github.com/astral-sh/ruff/issues/22620) — Ruff user, 2026-01-16 — incident report — "Yet its autofix hides the bug the developer made". Confirmed; open; labels fixes/needs-decision. The F541 rule page says "Fix is always available." and has no Fix safety section (confirmed).
  - [Clippy Lints (stable index)](https://rust-lang.github.io/rust-clippy/stable/index.html) — Rust Clippy, 2026 — official docs — 839 lints: MachineApplicable 373, Unspecified 328, MaybeIncorrect 117, HasPlaceholders 21. Correctness: 7 MachineApplicable, 11 MaybeIncorrect, 1 HasPlaceholders, 48 Unspecified. Re-parsed here; exact match. The index shows one statically collected applicability per lint; individual diagnostics can differ at runtime.
  - [Sorald (TDSC)](https://arxiv.org/abs/2103.12033) — Etemadi et al., 2022 — peer-reviewed — "we conclude that SORALD's fixes for rule S2184 are not undoubtedly valuable, because violations of this SONARJAVA rule are often false positives." / PR19: "yes you [are] right but … that rule is meant to be interpreted." Confirmed.
  - [Lessons from Building Static Analysis Tools at Google (CACM 61(4))](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski, Aftandilian, Eagle, Miller-Cushon, Jaspan, 2018 — peer-reviewed magazine — "There is an expectation during code review that feedback is not always perfect and that authors evaluate proposed changes before applying them." Confirmed.
- **Detect:**
  - Clippy: lint group from the index.
  - ESLint: `--fix-type suggestion,layout` excludes `problem` (the CLI doc defines problem = "fix potential errors in the code").
  - Ruff: named codes, not a prefix.
  - clang-tidy: `bugprone-`, `cert-`, `clang-analyzer-`.
  - In the diff, look for deleted intent tokens: the `f` prefix, casts, `await`, `==`.
- **Tools:** clippy, ruff, eslint, clang-tidy, SonarQube.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** Google fixed every instance of some new Clang checks automatically with ClangMR before turning them into errors (confirmed in Sadowski 2018). A well-understood correctness rule can be promoted by a human, per rule.
- **Fix risk:** medium

### G105-F06 — Grant trust per rule id, not per tool; keep a project-local allowlist
- **Grade:** B · **Verdict:** VERIFIED (with one clarification)
- **Rationale:** Mature programmes trust analyzers individually:
  - Google's "code janitors" have "high trust in specific analyzers" and apply "all fixes from a given analysis".
  - Biome has a per-rule `fix: none|safe|unsafe` setting (confirmed on the linter page).
  - Ruff has `extend-safe-fixes`/`extend-unsafe-fixes`.
  - ESLint's Node API takes a per-message `fix` predicate.
  - Clippy records applicability per lint.
  - SpongeBugs' curated rules reached 84% acceptance, 95% of it unmodified.

  **Clarification.** Sadowski et al.'s "approximately 3,000 times per day" counts authors clicking *apply* on code-review fixes after a preview (Tricorder). It measures human-previewed application, not unattended trust.

  Selectors for applying one rule:
  - `ruff check --select RULE --fix`
  - `biome lint --only=RULE --write`
  - `new ESLint({ fix: m => m.ruleId === 'RULE' })`
  - `clang-tidy -checks='-*,CHECK' -fix`
  - `cargo clippy --fix -- -A clippy::all -W clippy::LINT`
- **Evidence:**
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski et al., 2018 — peer-reviewed — "…have high trust in specific analyzers. Developers can thus use a commandline tool to automatically apply all fixes from a given analysis and generate cleanup changes" / "authors applied the automated fixes approximately 3,000 times per day." Confirmed.
  - [ESLint Node.js API – options.fix](https://eslint.org/docs/latest/integrate/nodejs-api) — ESLint v10.11.0, 2026 — official docs — "If a predicate function is present, the methods pass each lint message to the function, then use only the lint messages for which the function returned `true`." Confirmed.
  - [Biome CLI reference](https://biomejs.dev/reference/cli/) — Biome, 2026 — official docs — `--write`/`--fix`: "Applies safe lint fixes." `--only`: "Runs only the given lint rule, assist action, group of rules and…" (current wording is slightly broader than the dossier's paraphrase). Per-rule `"fix": "none"|"safe"|"unsafe"` is confirmed on the [linter page](https://biomejs.dev/linter/).
  - [Automatically Generating Fix Suggestions in Response to Static Code Analysis Warnings (SCAM 2019)](https://doi.org/10.1109/scam.2019.00013) — Marcilio, Furia, Bonifácio, Pinto, 2019 — peer-reviewed — abstract (OpenAlex): "We submitted 38 pull requests, including 920 fixes… project maintainers accepted 84% of our fix suggestions (95% of them without any modifications)." Also "less than 10% [1]" of warnings get fixed. Confirmed.
- **Detect:**
  - Allowlist file columns: `tool | version | rule id | tool applicability | semantic class | tracker check date | tier`.
  - Ruff inventory: `ruff check --output-format json | jq -r '.[]|select(.fix)|"\(.code) \(.fix.applicability)"' | sort | uniq -c`
  - clang-tidy: `-export-fixes=fixes.yaml`, grouped by DiagnosticName.
- **Tools:** ruff, eslint, biome, clang-tidy, cargo clippy, jq.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - The allowlist costs setup time and must be keyed to the pinned version (F23).
  - SpongeBugs and Sorald selected their rules deliberately, so their acceptance rates are upper bounds.
- **Fix risk:** low

### G105-F07 — One rule (or tight family) per commit, from a clean tree, re-run to a fixed point (at most 3 passes)
- **Grade:** B · **Verdict:** CORRECTED (the go/analysis quote is restored verbatim; context added to the Ruff and LLVM cases)
- **Rationale:** Fixes interact.
  - clang-tidy's readability-braces-around-statements plus readability-else-after-return, run together through run-clang-tidy, produced broken code (tested on 4.0 and 5.0). Run one after the other, they were fine.
  - Ruff reports that UP047 and UP049 enabled together produce breaking fixes. UP047's fix is itself marked unsafe.
  - The Go team describes both textual and semantic conflicts. go fix discards conflicting edits and asks to be re-run, and the team recommends a clean git state.
  - cargo fix refuses a dirty tree without `--allow-dirty`.
  - Sorald's maintainer feedback: "fixing only one rule per PR is better".

  Record the tool, version, rule id, command and edit count in each commit.
- **Evidence:**
  - [Using go fix to modernize Go code](https://go.dev/blog/gofix) — Alan Donovan (Go team), 17 Feb 2026 — engineering blog — "If a fix conflicts with the list of edits accumulated so far, it is discarded…" / "it may be worth running go fix more than once until it reaches a fixed point; twice is usually enough." / "start from a clean git state so that the change consists only of edits from go fix; your code reviewers will thank you." All confirmed.
  - [llvm/llvm-project #33239](https://github.com/llvm/llvm-project/issues/33239) — Bugzilla 33892 reporter, 2017 — incident report — "Tested on version 4.0 and 5.0" plus the repro. Confirmed. The issue was closed 2026-08-18.
  - [Ruff #21004](https://github.com/astral-sh/ruff/issues/21004) — Ruff user, 2025-10-20 — incident report — title confirmed; open.
  - [go/analysis – SuggestedFix](https://pkg.go.dev/golang.org/x/tools/go/analysis) — Go team, 2026 — official docs — verbatim: "Fixes for different diagnostics should be treated as independent changes to the same baseline file state, analogous to a set of git commits all with the same parent. Combining fixes requires resolving any conflicts that arise, analogous to a git merge." The dossier had dropped "set of".
  - [Sorald – Lessons learned](https://arxiv.org/abs/2103.12033) — Etemadi et al., 2022 — peer-reviewed — "Simple is better. The maintainer reaction on PR1 suggest that fixing only one rule per PR is better…" Confirmed.
  - [cargo fix](https://doc.rust-lang.org/cargo/commands/cargo-fix.html) — Rust project, 2026 — official docs — "--allow-dirty: Fix code even if the working directory has changes (including staged changes)." Confirmed.
- **Detect:**
  1. Precondition: `git status --porcelain` is empty.
  2. Loop at most 3 times: run the fixer for one rule, then `git diff --quiet`, or break.
  3. Commit template: `style(lint): apply <tool>@<ver> <RULE> (<n> edits)` with `cmd:` in the body.

  Violations: a commit touching more than one rule id; `--allow-dirty` or `--allow-staged` in the pass.
- **Tools:** git, ruff, eslint, biome, clang-tidy, cargo fix, go fix.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - Stripe merged a single PR converting more than 3.7M lines after months of codemod iteration, CI and QA (F19).
  - Many tiny commits can be squash-merged as one PR while staying revertable on the branch.
- **Fix risk:** low

### G105-F08 — Formatters are the one near-unconditional auto-apply class (T0), under conditions
- **Grade:** A · **Verdict:** VERIFIED (one more risky clang-format option added; Black's tolerated AST differences noted)
- **Rationale:** Formatters come with the strongest guarantees.
  - Black checks AST equivalence by default.
  - Prettier's "first requirement… is to output valid code that has the exact same behavior", and it offers `--debug-check`.
  - Rob Pike's proverb records the practitioner consensus.
  - ANSSI makes rustfmt a SHOULD recommendation (DENV-FORMAT), separate from its DENV-AUTOFIX rule.

  The guarantee does not cover everything:
  - clang-format warns that several options "could lead to incorrect code formatting due to clang-format's lack of complete semantic information". They are InsertBraces, RemoveBracesLLVM, RemoveSemicolon, RemoveParentheses, EnumTrailingComma, QualifierAlignment, **and also ObjCPropertyAttributeOrder** (missing from the original list).
  - gofmt `-s` "may result in changes that are incompatible with earlier versions of Go".
  - Prettier 3.6 turned Markdown loose lists into tight ones (#17746, fixed and closed 2026-06-04). YAML #16183, where the fix can change meaning, is still open.
  - Black's check tolerates three documented AST differences (docstring whitespace, `del` parentheses, moved comments including type comments). "AST-equivalent" is therefore close to, but not exactly, identity.

  T0 conditions:
  - default printing-only options
  - primary-language files only
  - a formatting-only commit whose sha is added to `.git-blame-ignore-revs`
  - build and tests pass
- **Evidence:**
  - [The Black code style – AST before and after formatting](https://black.readthedocs.io/en/stable/the_black_code_style/current_style.html) and [usage](https://black.readthedocs.io/en/stable/usage_and_configuration/the_basics.html) — Black 26.5.1, 2026 — official docs — "The --fast flag turns off this check and the --safe flag explicitly enables it." Confirmed, along with the three limited AST-difference cases.
  - [Prettier Rationale](https://prettier.io/docs/rationale) / [CLI](https://prettier.io/docs/cli) — Prettier, 2026 — official docs — "The first requirement of Prettier is to output valid code that has the exact same behavior as before formatting." / `--debug-check`: "…print an error message if it detects that code correctness might have changed. Note that --write cannot be used with --debug-check." Confirmed.
  - [Clang-Format Style Options](https://clang.llvm.org/docs/ClangFormatStyleOptions.html) — LLVM (docs 24.0.0git), 2026 — official docs — the warning text was confirmed on 7 options (list above).
  - [gofmt](https://pkg.go.dev/cmd/gofmt) — Go team, 2026 — official docs — "-s Try to simplify code…" / "This may result in changes that are incompatible with earlier versions of Go." Confirmed.
  - [Prettier #17746](https://github.com/prettier/prettier/issues/17746) / [#16183](https://github.com/prettier/prettier/issues/16183) — Prettier users, 2025 / 2024 — incident reports — Prettier 3.6.2 with `--parser markdown`, loose → tight list (closed as completed 2026-06-04). #16183 is open. Confirmed.
  - [Ignore commits in the blame view](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files) — GitHub Docs, 2026 — official docs — "All revisions specified in the .git-blame-ignore-revs file, which must be in the root directory of your repository, are hidden from the blame view". Confirmed.
  - [Go Proverbs](https://go-proverbs.github.io/) — Rob Pike (Gopherfest SV 2015), 2015 — talk — "Gofmt's style is no one's favorite, yet gofmt is everyone's favorite." Confirmed, and the page credits Gopherfest SV 2015.
  - [ANSSI Secure Rust Guidelines – devenv](https://github.com/ANSSI-FR/rust-guide/blob/master/src/en/devenv.md) — ANSSI, 2026 — standard — DENV-FORMAT (Recommendation): "The tool `rustfmt` SHOULD be used…" Confirmed (line 307ff).
- **Detect:**
  - `rg -n 'InsertBraces|RemoveBracesLLVM|QualifierAlignment|RemoveParentheses|RemoveSemicolon|EnumTrailingComma|ObjCPropertyAttributeOrder' .clang-format`
  - `rg -n 'black .*--fast|gofmt .*-(s|r)\b|--experimental|--preview|--unstable'`
  - `prettier --debug-check .`
  - A T0 commit must touch no `*.md *.mdx *.yml *.yaml *.css *.scss`.
  - Then `git rev-parse HEAD >> .git-blame-ignore-revs`.
- **Tools:** black, prettier, gofmt, rustfmt, cargo fmt, clang-format, ruff format, git.
- **Applies to:** All languages; formatter passes.
- **When not to apply / counterpoints:**
  - Ruff's formatter documents ">99.9% of lines are formatted identically" to Black on Django and Zulip (confirmed). No runtime equivalence check like Black's was found, so rely on the build and test gate.
  - A whole-repo format commit is a merge-conflict tax on open branches.
- **Fix risk:** low

### G105-F09 — Import removal, reordering and value→type-only conversion are a semantic-risk class
- **Grade:** A · **Verdict:** VERIFIED (with a status note on the Biome issues)
- **Rationale:** Imports execute code, and the tool authors themselves disagree about safety.
  - Prettier refuses to sort imports ("potentially unsafe because of side effects").
  - simple-import-sort answers "Mostly" and never reorders side-effect-only imports.
  - Ruff F401 removal is safe except in `__init__.py`. Its preview note admits the model follows "the developer's intuition rather than Python's actual execution".
  - Ruff users call side-effect import removal a "footgun" (#9962) and point at `readline` (#20018).
  - typescript-eslint's consistent-type-imports skips files with decorators when both compiler flags are on.
  - Biome's useImportType is a *safe* fix and can break NestJS decorator-metadata DI (#10495, open).
  - Biome's noUnusedImports turned TS modules into ambient contexts (#4888, fixed 2026-02-10). Biome now marks noUnusedImports' fix *unsafe*.

  Put these in T1 only for non-entry-point modules with no import-time side effects. Under `experimentalDecorators` + `emitDecoratorMetadata`, type-only conversions are T3.
- **Evidence:**
  - [Prettier Rationale (docs/rationale.md)](https://github.com/prettier/prettier/blob/main/docs/rationale.md) — Prettier, 2026 — official docs — "…sorting is potentially unsafe because of side effects (for imports, as an example) and makes it difficult to verify the most important correctness goal." Confirmed on prettier.io.
  - [eslint-plugin-simple-import-sort README](https://github.com/lydell/eslint-plugin-simple-import-sort) — Simon Lydell, 2026 — tool docs — "Mostly. Imports and re-exports can have side effects in JavaScript…" / "Imports that are only used for side effects stay in the input order." Confirmed (README lines 564–576).
  - [unused-import (F401)](https://docs.astral.sh/ruff/rules/unused-import/) — Astral, 2026 — official docs — "Fixes to remove unused imports are safe, except in `__init__.py` files." / "…the fix is unsafe because the module's interface changes." / "…designed to conform to the developer's intuition rather than Python's actual execution." Confirmed.
  - [Ruff #9962](https://github.com/astral-sh/ruff/issues/9962) / [#20018](https://github.com/astral-sh/ruff/issues/20018) — Ruff users, 2024 / 2025 — incident reports — "…avoid this footgun which comes up from time to time…" / "`readline` is a funny module in the stdlib that, if you import it, has side effects on `input`." Confirmed. #9962 was closed 2024-10; #20018 is open.
  - [consistent-type-imports](https://typescript-eslint.io/rules/consistent-type-imports/) — typescript-eslint v8.70, 2026 — official docs — "The rule will not report any errors in files that contain decorators when both experimentalDecorators and emitDecoratorMetadata are turned on." Confirmed.
  - [Biome #10495](https://github.com/biomejs/biome/issues/10495) / [#4888](https://github.com/biomejs/biome/issues/4888) — Biome users, 2026 / 2025 — incident reports. #10495 is open (NestJS repro: "If the safe fix changes it to `import type`, the metadata becomes `Function`"). #4888 closed 2026-02-10. Rule pages: useImportType "Safe fix"; noUnusedImports "Unsafe fix".
- **Detect:**
  - `git show HEAD -U0 | rg '^[-+]\s*(import |from \S+ import |use |#include )'`
  - For removed Python imports, grep the target module for top-level registration or patching.
  - JS bare imports: `rg -n "^import ['\"]"`
  - `jq '.compilerOptions|{experimentalDecorators,emitDecoratorMetadata}' tsconfig.json`
  - Flag `__init__.py`, `index.(ts|js)`, `lib.rs`, `mod.rs`.
- **Tools:** ruff (F401, I001), isort, eslint-plugin-simple-import-sort, eslint-plugin-import, biome (noUnusedImports, useImportType, organizeImports), typescript-eslint, clang-format SortIncludes.
- **Applies to:** Python, JS/TS, C/C++ include order, Rust re-exports.
- **When not to apply / counterpoints:**
  - In most application modules, removing a truly unused import is harmless.
  - A one-time audit for import-time side effects can promote F401 outside `__init__.py` to T1.
  - The fix-safety labels of Ruff I001 and clang-format SortIncludes relative to side effects were not verified.
- **Fix risk:** medium

### G105-F10 — Pin the minimum supported language version before any modernizing fixer
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Modernization is correct only relative to a version.
  - Ruff's target-version decides which upgrades to offer.
  - Ruff's PEP 604 fixes are unsafe before 3.10 because of runtime-annotation libraries such as Pydantic.
  - Clippy suppresses or downgrades suggestions per MSRV, and `msrv` defaults to Cargo's `rust-version`.
  - go fix modernizers apply only to files whose go.mod `go` directive or `//go:build` constraint meets the minimum.
  - gofmt `-s` warns of incompatibility with older Go.
  - clang-tidy use-emplace suggested C++20 under C++17 (#68886, fixed 2024).

  If the minimum version is unknown or not enforced in CI, modernizer rules go to T3.
- **Evidence:**
  - [Ruff settings – target-version](https://docs.astral.sh/ruff/settings/) — Astral, 2026 — official docs — "The minimum Python version to target, e.g., when considering automatic code upgrades, like rewriting type annotations." / "If both are specified, target-version takes precedence over requires-python." Confirmed.
  - [non-pep604-annotation (UP007/UP045)](https://docs.astral.sh/ruff/rules/non-pep604-annotation-union/) — Astral, 2026 — official docs — "This rule's fix is marked as unsafe on Python versions prior to 3.10 because using the PEP-604 syntax may lead to runtime errors in libraries that rely on runtime type annotations, like Pydantic…" Confirmed. The dossier cited the .rs source file; the rendered rule page carries the same text.
  - [Clippy Configuration – MSRV](https://doc.rust-lang.org/clippy/configuration.html) and [lint_configuration](https://doc.rust-lang.org/clippy/lint_configuration.html) — Rust Clippy, 2026 — official docs — "Some lints change their behavior depending on the configured MSRV. In some cases, Clippy may suppress a lint entirely…" / msrv "Defaults to the rust-version field in Cargo.toml". Confirmed.
  - [Using go fix to modernize Go code](https://go.dev/blog/gofix) — Alan Donovan, 2026 — engineering blog — "modernizers offer fixes only in files that require at least the minimum appropriate version of Go… either through a go 1.26 directive in the enclosing go.mod file or a //go:build go1.26 build constraint". Confirmed; the dossier's paraphrase is faithful.
  - [llvm/llvm-project #68886](https://github.com/llvm/llvm-project/issues/68886) — LLVM user, 2023 — incident report — title confirmed; closed 2024-03-15.
- **Detect:**
  - `rg -n 'requires-python|target-version' pyproject.toml ruff.toml`
  - `rg -n 'rust-version' Cargo.toml; rg -n 'msrv' clippy.toml .clippy.toml`
  - `rg -n '^go ' go.mod`
  - `-std=` from compile_commands.json
  - `jq .compilerOptions.target tsconfig.json`

  Compare each value with the CI matrix minimum.
- **Tools:** ruff, clippy, go fix, gofmt, clang-tidy, tsc.
- **Applies to:** Python, Rust, Go, C/C++, TS/JS.
- **When not to apply / counterpoints:** Applications that ship their own fixed runtime (a container) can target the deployed version.
- **Fix risk:** low

### G105-F11 — Fixers only see the configuration they run under; verify every shipped build configuration, and send cfg-adjacent fixes to approval
- **Grade:** B · **Verdict:** DOWNGRADED (A → B: the mechanism is documented only for cargo, and the C/C++, Go and Python parts extrapolate from Rust evidence)
- **Rationale:** cargo fix documents that it fixes only the code compiled under the current features and target. The real MachineApplicable failures cited are cfg-driven:
  - #16191: a let-chain rewrite merged an `if` block with a `#[cfg(feature)]` sibling, so behaviour changed only when the feature was on.
  - #12524: `inconsistent_struct_constructor` deletes cfg'd fields and their attributes. The reporter asks for the fix to "be made not MachineApplicable".

  The same logic plausibly applies to clang-tidy (compile_commands.json configurations) and to Go build tags, but no C/C++, Go or Python incident was cited, hence B. Run the fixer and the gates under every configuration CI ships, and treat any fix touching or next to `#[cfg]`, `#if`/`#ifdef` or `//go:build` as T2.
- **Evidence:**
  - [cargo fix](https://doc.rust-lang.org/cargo/commands/cargo-fix.html) — Rust project, 2026 — official docs — "cargo fix is only capable of fixing code that is normally compiled with cargo check. If code is conditionally enabled with optional features, you will need to enable those features…" / "…other cfg expressions like platform-specific code will need to pass --target". Confirmed.
  - [Clippy #16191](https://github.com/rust-lang/rust-clippy/issues/16191) — Clippy user, 2025-12-04 — incident report — repro and quote confirmed; open.
  - [Clippy #12524](https://github.com/rust-lang/rust-clippy/issues/12524) — Clippy user, 2024-03-21 — incident report — "It should preserve all cfgs, not give a suggestion in this case, or be made not MachineApplicable." Confirmed; open; label I-suggestion-causes-error.
- **Detect:**
  - `git show HEAD -U3 | rg 'cfg\(|#\s*if|#ifdef|//go:build|sys\.platform|typing\.TYPE_CHECKING'`. Any hit → T2.
  - Matrix: `cargo test --all-features` and `--no-default-features`, each CI target; each C/C++ configuration; `GOOS=… go vet ./...`.
- **Tools:** cargo, clippy, clang-tidy, go vet, CI matrix.
- **Applies to:** Rust (documented); C/C++, Go, Python, TS with build-time flags (inferred).
- **When not to apply / counterpoints:** Full feature powersets explode combinatorially. The configurations CI actually exercises are a pragmatic bound, not a guarantee.
- **Fix risk:** low

### G105-F12 — Any mechanical fix that changes a public or exported symbol is report-only (T3)
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Mechanical fixes cannot see downstream callers.
  - Clippy's `avoid-breaking-exported-api` (default `true`) exists to "Suppress lints whenever the suggested change would cause breakage for other crates". It covers needless_pass_by_ref_mut, trivially_copy_pass_by_ref, unnecessary_wraps, wrong_self_convention, upper_case_acronyms and others (list confirmed).
  - clang-tidy's performance-unnecessary-value-param says its signature change "may break builds if the function is used in multiple translation units".
  - Ruff F401 in `__init__.py`: "the module's interface changes".
  - Renames can shadow: clang-tidy identifier-naming #42651 (open). Biome useNamingConvention, a safe fix, "unsafely renames interfaces" (#7344, fixed 2025-09).

  Never set `avoid-breaking-exported-api = false` in a hardening pass.
- **Evidence:**
  - [Clippy lint configuration – avoid-breaking-exported-api](https://doc.rust-lang.org/clippy/lint_configuration.html) — Rust Clippy, 2026 — official docs — quote and default confirmed.
  - [clang-tidy performance-unnecessary-value-param](https://clang.llvm.org/extra/clang-tidy/checks/performance/unnecessary-value-param.html) — LLVM, 2026 — official docs — quote confirmed.
  - [llvm/llvm-project #42651](https://github.com/llvm/llvm-project/issues/42651) — LLVM user, 2019 — incident report — title confirmed; open.
  - [Biome #7344](https://github.com/biomejs/biome/issues/7344) — Biome user, 2025-08-27 — incident report — title confirmed; closed 2025-09-04. The rule page says "Safe fix".
  - [unused-import (F401) – Fix safety](https://docs.astral.sh/ruff/rules/unused-import/) — Astral, 2026 — official docs — confirmed.
- **Detect:** Classify each touched symbol as public or private:
  - Rust: `pub` items reachable from lib.rs; cargo-semver-checks.
  - TS/JS: package.json `exports`/`main`.
  - Python: non-underscore names in package modules, or `__all__`.
  - C/C++: installed headers.
  - Go: capitalised names in non-internal packages.

  Also run `rg -n 'avoid-breaking-exported-api\s*=\s*false'`.
- **Tools:** clippy, clang-tidy, ruff, biome, eslint, API-diff tooling (cargo-semver-checks, etc.).
- **Applies to:** All languages; libraries and multi-module applications.
- **When not to apply / counterpoints:** In a closed application with no external consumers, a compiler-verified signature change can be T2.
- **Fix risk:** low

### G105-F13 — Never batch-apply anything below the tool's safe tier (suggestions, MaybeIncorrect, unsafe, IDE "fix all", LLM "apply the suggestions")
- **Grade:** A · **Verdict:** VERIFIED (with current-status notes)
- **Rationale:** Tool authors move risky edits out of the autofix channel on purpose.
  - ESLint reserves suggestions for fixes that might change functionality or that have several valid forms.
  - typescript-eslint prefer-nullish-coalescing is suggestion-only ("💡 … manually fixable by editor suggestions"). Its docs add that converting `||` to `??` inside mixed logical expressions is "not always safe… as we cannot tell the intended precedence".
  - prefer-optional-chain gates return-type-changing fixes behind an option "considered unsafe as it may break the build".
  - no-unnecessary-condition is suggestion-only, and "if the types do not match the runtime behavior, the rule may report inaccurately".
  - await-thenable is currently suggestion-only too (checked on the rule page).
  - ESLint eqeqeq auto-fixes only `typeof` or same-type-literal comparisons, and offers "a suggestion… which can change runtime behavior" otherwise.
  - React's exhaustive-deps promotes its first suggestion to an autofix only under the dangerous legacy option.
  - rustc MaybeIncorrect: "may be what the user intended, but it is uncertain".
  - clang-tidy loop-convert's default `reasonable` converts loops that call `.end()` each iteration, and its docs list cases that "remove information and change semantics".

  For automated clang-tidy runs, set `modernize-loop-convert.MinConfidence: safe`.
- **Evidence:**
  - [prefer-nullish-coalescing](https://typescript-eslint.io/rules/prefer-nullish-coalescing/) — typescript-eslint, 2026 — official docs — both quotes confirmed.
  - [prefer-optional-chain](https://typescript-eslint.io/rules/prefer-optional-chain/) — typescript-eslint, 2026 — official docs — "Allow autofixers that will change the return type of the expression. This option is considered unsafe as it may break the build." plus the `!foo || foo.bar` example. Confirmed.
  - [no-unnecessary-condition](https://typescript-eslint.io/rules/no-unnecessary-condition/) — typescript-eslint, 2026 — official docs — confirmed.
  - [eqeqeq](https://eslint.org/docs/latest/rules/eqeqeq) — ESLint, 2026 — official docs — "A problem is only fixed if one of the operands is a typeof expression, or if both operands are literals with the same type. In other cases a suggestion is offered which can change runtime behavior…" Confirmed.
  - [modernize-loop-convert](https://clang.llvm.org/extra/clang-tidy/checks/modernize/loop-convert.html) — LLVM, 2026 — official docs — risky / reasonable (Default) / safe, and "There are certain situations where the tool may erroneously perform transformations that remove information and change semantics." Confirmed.
  - [rustc_errors::Applicability](https://doc.rust-lang.org/nightly/nightly-rustc/rustc_errors/enum.Applicability.html) — Rust project, 2026 — official docs — the MaybeIncorrect text is confirmed.
- **Detect:**
  - ESLint: group `.suggestions` by rule.
  - Ruff: `select(.fix.applicability!="safe")`.
  - Clippy: count `suggestion_applicability != "MachineApplicable"`.
  - `rg -n 'MinConfidence' .clang-tidy`.
  - In agent prompts, forbid "apply all suggestions / quick fixes".
- **Tools:** eslint, typescript-eslint, eslint-plugin-react-hooks, ruff, biome, cargo clippy, clang-tidy.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - Many suggestions are correct in context. Human review of each one individually is fine; batch application is not.
  - `MinConfidence=safe` leaves loops unconverted, an accepted readability cost.
- **Fix risk:** low

### G105-F14 — Behaviour-changing fix families in JavaScript/TypeScript (always T2 or above)
- **Grade:** B · **Verdict:** CORRECTED (issue states updated; Biome useAtIndex identified as an *unsafe* fix; no-extra-parens deprecation noted; await-thenable is now suggestion-only)
- **Rationale:** JS/TS semantics hinge on truthiness, `this` binding, evaluation order and microtask timing. The families below are always T2 or above, never T1.
  1. `||`→`??` (prefer-nullish-coalescing): suggestion-only upstream.
  2. `a && a.b`→`a?.b` (prefer-optional-chain): return-type change; #11840 open.
  3. `==`→`===` beyond typeof or same-type literals (eqeqeq): suggestion upstream.
  4. Removing "unnecessary" conditions (no-unnecessary-condition): suggestion-only.
  5. `await` / `return await` changes (return-await #8661, fixed 2024-05; await-thenable #12715, closed 2026-09-15; await-thenable is now suggestion-only).
  6. React hook deps (exhaustive-deps): only via the dangerous option.
  7. Value→type-only imports under decorator metadata (F09).
  8. Import sorting or removal (F09).
  9. `Object.hasOwn` when `Object` is shadowed (prefer-object-has-own #21279, fixed 2026-09-01).
  10. no-extra-parens assignment semantics (#16850, fixed 2023). The rule has been deprecated since ESLint v8.53.0, will be removed in v11, and has moved to @stylistic.
  11. Biome useArrowFunction on functions later called with `new` (#9585, open). This is a **safe** fix applied by `biome check --write`, and it broke a test suite.
  12. Biome useConsistentObjectDefinitions (#10212, open; **safe** fix).
  13. Biome useAtIndex dropping the negation (#11896). Closed as completed 2026-09-23, not open as the dossier said. Its fix is **unsafe**, so it only applies under `--unsafe`.
  14. Biome noAdjacentSpacesInRegex (#11419, open; **safe** fix).

  Items 1, 3, 4 and 13 are already outside the safe tier upstream, so F01 excludes them. They matter only when an IDE, an agent or an unsafe flag promotes them. Items 11, 12 and 14 are the genuine safe-tier failures.
- **Evidence:**
  - [typescript-eslint #8661](https://github.com/typescript-eslint/typescript-eslint/issues/8661) — typescript-eslint user, 2024-03-13 — incident report — title confirmed; closed as completed 2024-05-31.
  - [typescript-eslint #12715](https://github.com/typescript-eslint/typescript-eslint/issues/12715) — typescript-eslint user, 2026-08-16 — incident report — title confirmed; closed 2026-09-15. The rule page now shows suggestions only.
  - [typescript-eslint #11840](https://github.com/typescript-eslint/typescript-eslint/issues/11840) — typescript-eslint user, 2025-12-11 — incident report — title confirmed; open.
  - [ESLint #16850](https://github.com/eslint/eslint/issues/16850) — ESLint user, 2023-02-02 — incident report — title confirmed; closed 2023-02-09. The [rule page](https://eslint.org/docs/latest/rules/no-extra-parens) says "This rule was deprecated in ESLint v8.53.0. It will be removed in v11.0.0."
  - [Biome #10212](https://github.com/biomejs/biome/issues/10212), [#11896](https://github.com/biomejs/biome/issues/11896), [#9585](https://github.com/biomejs/biome/issues/9585) — Biome users, 2026 — incident reports. #10212 repro: `obj.b.name` changes from "c" to "b". #11896: "tail.at(GUID_LENGTH + 1)… reads from the wrong end"; closed as completed 2026-09-23. #9585: "The auto-fix was applied by biome check --write and broke a test suite". Fix kinds come from the rule pages: useConsistentObjectDefinitions safe, useAtIndex **unsafe**, useArrowFunction safe.
  - [ExhaustiveDeps.ts](https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/src/rules/ExhaustiveDeps.ts) — React team, 2026 — source code — confirmed (see F01).
- **Detect:** Hold these rule ids at T2 or above:
  - @typescript-eslint: prefer-nullish-coalescing, prefer-optional-chain, no-unnecessary-condition, return-await, await-thenable, consistent-type-imports
  - ESLint core: eqeqeq, prefer-object-has-own, no-extra-parens (or @stylistic/no-extra-parens)
  - react-hooks/exhaustive-deps
  - Biome: useImportType, useArrowFunction, useConsistentObjectDefinitions, useAtIndex, noAdjacentSpacesInRegex, useSimplifiedLogicExpression

  Diff greps: removed `||` paired with added `??`; removed `await`; changed `==`/`!=`; removed hook dependency arrays.

  The dossier also listed strict-boolean-expressions and Biome noUselessReturn without evidence. They can stay on the list as precautions, but they are unsourced.
- **Tools:** eslint, typescript-eslint, eslint-plugin-react-hooks, biome.
- **Applies to:** JavaScript, TypeScript, React.
- **When not to apply / counterpoints:**
  - Several cited issues are fixed at current versions, so re-query at the pinned version (the K input in F24).
  - Plain `eslint --fix` does not apply the suggestion-only families.
- **Fix risk:** high

### G105-F15 — Behaviour-changing fix families in Python (T2 or above even where Ruff says "safe")
- **Grade:** B · **Verdict:** CORRECTED (FURB101/103 are preview-only; UP040/046/047 are already unsafe upstream; B010 was rejected as a fix-safety bug by the maintainers; SIM114 was fixed)
- **Rationale:** Python evaluates imports and annotations at runtime, and libraries introspect them. Corrected list:
  1. **F401** in `__init__.py` or for side-effect modules: a stable safe fix outside `__init__.py`. Real risk; see F09.
  2. **F541** dropping the `f` prefix: a stable safe fix, "Fix is always available". It can hide a missing placeholder (#22620, open) and can turn a module-level string into a docstring (#18807, open, reproduced on 0.12.0). Real stable-safe risk.
  3. **UP006/UP007/UP045 (PEP 585/604):** Ruff itself marks these unsafe below Python 3.9 or 3.10. Risky only when the target version is wrong (F10) or unsafe fixes are enabled.
  4. **UP040/UP046/UP047 (PEP 695):** the rule pages say the fix is "always marked unsafe" (UP040) or "marked unsafe" (UP046/UP047), so F01 already excludes them. The bugs #27008 and #26954 (both open) matter only under `--unsafe-fixes`.
  5. **FURB101/FURB103:** preview-only rules ("The --preview flag is required for use"). #26922 and #26920 reproduce only with `--preview`. F23 already excludes them.
  6. **PTH110/PTH112** (os.path→pathlib): stable rules; #24603 ("can change runtime behaviour") is open. Real risk.
  7. **B010** setattr→assignment (#28493): the fix turns type-clean code into a mypy/ty error when the attribute is a method. **The maintainer closed it without changing the fix's safety:** "this doesn't really fall under our typical fix safety criteria, which are that the fix doesn't change runtime behavior and doesn't remove comments." It was resolved by a documentation PR (#28509). Lesson: Ruff's "safe" does not promise type-checker compatibility, so a type-check gate is needed.
  8. **Comment loss:** Ruff documents that safe fixes may remove comments when deleting whole statements. SIM114 deleted comments (#25470, fixed 2026-06-01). Directives such as `# type: ignore`/`# noqa` can be lost.
  9. **Any `--preview` fix.**
- **Evidence:**
  - [Ruff #18807](https://github.com/astral-sh/ruff/issues/18807) — Ruff user, 2025-06-19 — incident report — "If the string F541 is targeting is in a position where it would become a docstring, it can change behavior." Confirmed; open.
  - [Ruff #26922](https://github.com/astral-sh/ruff/issues/26922) / [#24603](https://github.com/astral-sh/ruff/issues/24603) — Ruff users, 2026 — incident reports — both open. #26922 uses `--preview` (labels include preview). [FURB101](https://docs.astral.sh/ruff/rules/read-whole-file/) and [FURB103](https://docs.astral.sh/ruff/rules/write-whole-file/) pages: "This rule is unstable and in preview."
  - [Ruff #27008](https://github.com/astral-sh/ruff/issues/27008) / [#26954](https://github.com/astral-sh/ruff/issues/26954) — Ruff users, 2026 — incident reports — both open. [UP040](https://docs.astral.sh/ruff/rules/non-pep695-type-alias/): "This fix is always marked unsafe because it can change runtime behavior…"; [UP047](https://docs.astral.sh/ruff/rules/non-pep695-generic-function/): "This fix is marked unsafe…".
  - [Ruff #28493](https://github.com/astral-sh/ruff/issues/28493) — Ruff user and maintainer (ntBre), 2026-09-10 — incident report plus maintainer ruling — closed 2026-09-17 with the `documentation` label. The maintainer quote is given above.
  - [non-pep585-annotation (UP006)](https://docs.astral.sh/ruff/rules/non-pep585-annotation/) — Astral, 2026 — official docs — "This rule's fix is marked as unsafe, as it may lead to runtime errors when alongside libraries that rely on runtime type annotations, like Pydantic, on Python versions prior to Python 3.9." Confirmed. The dossier cited the .rs source; the rule page carries the same text.
  - [Ruff #15584](https://github.com/astral-sh/ruff/issues/15584) / [#25470](https://github.com/astral-sh/ruff/issues/25470) — Ruff maintainers / users, 2025 / 2026 — tracker — #15584 (open, documentation): rules still lacking a Fix safety section. #25470 closed 2026-06-01.
- **Detect:**
  - Hold at T2: F401 (non-trivial modules), F541, PTH*, B010, SIM114, and UP006/UP007/UP045 when the target version is unverified.
  - UP040/046/047 and FURB101/103 are already outside stable-safe; keep them out.
  - Diff greps: removed imports; removed `f` prefixes (`rg '^-\s*f["\x27]'`); lost directives (`rg '^-.*#\s*(type:\s*ignore|noqa|pragma)'`).
  - Check for Pydantic, attrs, FastAPI or typer in the dependencies.
- **Tools:** ruff, pyupgrade, isort, black, mypy/pyright/ty.
- **Applies to:** Python.
- **When not to apply / counterpoints:**
  - Most of these are edge cases (bytes paths, module-level f-strings).
  - On Python ≥3.10 without runtime-annotation libraries, UP006/UP007 are low-risk.
- **Fix risk:** medium

### G105-F16 — Behaviour-changing fix families in Rust (T2 or above even when MachineApplicable)
- **Grade:** B · **Verdict:** VERIFIED (with status notes: several cited issues are fixed; the "33 since 2025" figure reflects the label's recent adoption)
- **Rationale:** Clippy's I-suggestion-causes-bug label has 40 issues, 33 of them since 2025-01-01. The label came into steady use only in 2024. They cluster around laziness and side effects, NaN, panics and cfg:
  - `double_ended_iterator_last` changed `.last()`→`.next_back()`, which skips side effects in impure pipelines (#14444, fixed 2025-04).
  - `manual_range_contains` changed NaN handling (#16706, fixed).
  - `manual_map` removes log statements (#16193, open) and mishandles `#[track_caller]` (#17706, open).
  - `needless_range_loop` removes panics (#16003, open).
  - `manual_div_ceil` changes the evaluation count of a side-effectful divisor (#17467, fixed).
  - `collapsible_match` changed meaning (#16875, fixed).
  - `option_if_let_else` ignores temporary lifetime extension (#15142, open; nursery).

  ANSSI states that cargo fix "provides few guarantees on the soundness of the proposed fixes", and that `--edition-idioms` corrections "are known to break the compilation or change the program semantics in some cases". Its DENV-AUTOFIX Rule says any automatic fix "MUST be verified by the developer". It singles out `clippy::nursery` as "still under development".
- **Evidence:**
  - [Clippy #14444](https://github.com/rust-lang/rust-clippy/issues/14444) — Clippy user, 2025-03-20 — incident report — "…which dramatically changes the behaviour." Confirmed; closed 2025-04-22.
  - [Clippy I-suggestion-causes-bug issues](https://github.com/rust-lang/rust-clippy/issues?q=is%3Aissue+label%3AI-suggestion-causes-bug) — Clippy users, 2026 — tracker query — all seven cited titles confirmed verbatim via the API. States: #16706 closed, #16193 open, #16003 open, #17467 closed, #16875 closed, #17706 open, #15142 open.
  - [ANSSI Secure Rust Guidelines – devenv.md](https://github.com/ANSSI-FR/rust-guide/blob/master/src/en/devenv.md) — ANSSI, 2026 — standard — quotes confirmed in the raw file (lines 343–345, 362, 375–378).
- **Detect:**
  - Hold at T2: double_ended_iterator_last, manual_range_contains, manual_map, option_if_let_else, needless_range_loop, manual_div_ceil, collapsible_match, collapsible_if (let chains), inconsistent_struct_constructor.
  - `rg -n 'clippy::nursery|clippy::restriction'`
  - Diff greps: added `next_back()` / `.contains(&`; removed `log::|tracing::|println!|panic!|assert!`.
- **Tools:** cargo clippy, cargo fix, rustfix.
- **Applies to:** Rust.
- **When not to apply / counterpoints:**
  - A practitioner reports modernizing "a fairly old project in literal 15 minutes by using Cargo Clippy's fix mode + a few small hand-crafted changes" (HN, 2026).
  - Most of these bugs need impure closures or NaNs.
- **Fix risk:** medium

### G105-F17 — Behaviour-changing fix families in C/C++ (T2 or above, never a repo-wide multi-check batch)
- **Grade:** B · **Verdict:** CORRECTED (#104565 citation removed: closed *worksforme*, the fix compiles; closure status added; the "overload resolution" reason for NULL→nullptr marked as not in source)
- **Rationale:** clang-tidy's own docs list semantic limitations for several checks:
  - modernize-loop-convert: `.end()` is evaluated once, overloaded `operator->()` side effects are no longer performed, and comments in loop headers are deleted.
  - modernize-pass-by-value: wrong when the referenced object is modified through a "hidden" reference before the init-list.
  - performance-unnecessary-value-param: the signature change can break other translation units.
  - modernize-use-transparent-functors: "not always a safe transformation".

  Tracker (39 issues match `"clang-tidy" "incorrect fix"`):
  - modernize-use-emplace removed constructor calls with initializer-list parameters (#32243, closed 2021) and suggested C++20 under C++17 (#68886, fixed 2024).
  - make-shared bypasses user-defined `operator new` (#56372, open).
  - use-equals-default semantic change (#57027; no repro on trunk as of 2023).
  - unnecessary-copy-initialization runtime issue (#150189, open, documentation label).
  - logical-not-parentheses fix-it changes behaviour (#47315, closed 2021).
  - misc-unused-parameters: the array-parameter break (#31204) was closed *worksforme* in 2023; the attribute break (#122191) was fixed a day later by PR #122286.

  Google's LSC committee "outright rejected" converting all NULL to nullptr as "dangerous". **The source gives no reason**, so the dossier's "(overload resolution)" is the researcher's inference.

  Note: the current use-emplace doc warns only about a *speed* regression for insert→emplace, not about semantics.
- **Evidence:**
  - [modernize-loop-convert – Limitations](https://clang.llvm.org/extra/clang-tidy/checks/modernize/loop-convert.html) — LLVM, 2026 — official docs — "…this loop will be transformed to call .end() only once during the initialization of the loop, which may affect semantics." / "Therefore any side effect of the overloaded operator->() will no longer be performed." Both confirmed.
  - [modernize-pass-by-value](https://clang.llvm.org/extra/clang-tidy/checks/modernize/pass-by-value.html) / [use-transparent-functors](https://clang.llvm.org/extra/clang-tidy/checks/modernize/use-transparent-functors.html) — LLVM, 2026 — official docs — both quotes confirmed.
  - [Software Engineering at Google, ch. 22 (footnote 13)](https://abseil.io/resources/swe-book/html/ch22.html) — Hyrum Wright (ed. Lisa Carey; book eds. Winters, Manshreck, Wright), O'Reilly, 2020 — book (free online edition) — "The only kinds of changes that the committee has outright rejected have been those that are deemed dangerous, such as converting all NULL instances to nullptr…" Confirmed.
  - [LLVM issues: "clang-tidy" "incorrect fix"](https://github.com/llvm/llvm-project/issues?q=is%3Aissue+%22clang-tidy%22+%22incorrect+fix%22) — LLVM users, 2026 — tracker query — count 39 confirmed. Titles #32243, #56372, #57027, #150189, #47315, #31204 and #122191 confirmed. **#104565 removed:** a maintainer showed the suggestion "does compile (even when automatically fixed with `-fix`)", and the issue was closed with the `worksforme` label.
- **Detect:**
  - Single-check runs only: `clang-tidy -checks='-*,<one-check>' -fix -p build`.
  - `MinConfidence: safe` for loop-convert.
  - Hold at T2: modernize-loop-convert, -pass-by-value, -use-emplace, -make-shared, -make-unique, -use-nullptr, -use-equals-default, -use-transparent-functors; performance-unnecessary-value-param, -unnecessary-copy-initialization; readability-identifier-naming; misc-unused-parameters.
- **Tools:** clang-tidy, run-clang-tidy, clang-apply-replacements, clang-format.
- **Applies to:** C, C++.
- **When not to apply / counterpoints:**
  - Google ran ClangMR fixes codebase-wide with sharding, full tests and owner review.
  - Several cited issues are fixed, so verify at the pinned LLVM version.
  - use-nullptr is locally safe in most code; the Google rejection concerns an unreviewed mass conversion.
- **Fix risk:** high

### G105-F18 — Go and Java fix families
- **Grade:** B · **Verdict:** CORRECTED (the unsourced counterpoint "practitioners report running go fix widely without incident" is removed; the OpenRewrite claim is now sourced)
- **Rationale:**
  - **Go:**
    - Plain gofmt is T0.
    - `gofmt -s` is T1 only when go.mod's version is enforced.
    - `gofmt -r` is always T2 (an arbitrary pattern rewrite).
    - Run `go fix` with `-diff` first, from a clean tree, and rerun it to a fixed point. The curated suite is T1.
    - The Go team requires suite analyzers to "generate fixes that are safe to apply without regression in correctness, performance, or style". It excluded the `slices.Clone` modernizer because Clone returns nil for empty input. It also documents semantic conflicts, such as two fixes that together leave a variable unused.
    - Analyzers outside the suite get no curation and are T2.
  - **Java:**
    - IDE refactorings and Sonar-style template fixes are T2 per rule.
    - S2184 (arithmetic widening) and S2095 (resource closing) are T3.
    - Sorald broke intentional integer division.
    - Maintainers rejected S2095 fixes as context-dependent, and one S2095 fix eliminated code.
    - Eclipse 2023-09 Inline Method dropped `synchronized`, and Make Static silently changed output from "Counter: 15" to "Counter: 5". 97.1% of engine bugs trigger with default options.
- **Evidence:**
  - [Using go fix to modernize Go code](https://go.dev/blog/gofix) — Alan Donovan, 17 Feb 2026 — engineering blog — the slices.Clone quote and the "safe to apply without regression" quote are both confirmed.
  - [gofmt](https://pkg.go.dev/cmd/gofmt) — Go team, 2026 — official docs — "The rewrite rule specified with the -r flag must be a string of the form: pattern -> replacement". Confirmed; the page contains no semantic-preservation statement.
  - [Sorald (TDSC)](https://arxiv.org/abs/2103.12033) — Etemadi et al., 2022 — peer-reviewed — "Here developers intentionally divide bits by an integer "2" to get the floor of this division. SORALD breaks the expected behavior by changing this division to bits/2D". Confirmed.
  - [An Empirical Study of Refactoring Engine Bugs](https://arxiv.org/abs/2409.14610) — Wang, Xu, Zhang, Tsantalis, Tan, 2024 — preprint — "using Eclipse version 2023-09, the keyword "synchronized" is missed…" / "Counter: 15" → "Counter: 5", "Eclipse just silently changes the program behavior without any warning" / "Finding 8: Most of the bugs (97.1%) could be triggered by the default initial input options". Confirmed.
  - [OpenRewrite – Lossless Semantic Trees](https://docs.openrewrite.org/concepts-and-explanations/lossless-semantic-trees) — Moderne / OpenRewrite, 2026 — official docs (added) — LSTs are "type-attributed" and "format-preserving". The page makes no behaviour-preservation guarantee and gives no error rate.
- **Detect:**
  - Go: `go fix -diff ./...` goes into the review artifact; `gofmt -l .` for T0; no `gofmt -r` in automation; check go.mod's `go` directive.
  - Java: tag S2184 and S2095 as T3. For IDE refactorings, run the full tests and review the diff for `synchronized`, receiver changes and annotations.
- **Tools:** gofmt, go fix, go vet, OpenRewrite, Error Prone, SonarQube, Eclipse/IntelliJ refactoring engines.
- **Applies to:** Go, Java/JVM.
- **When not to apply / counterpoints:**
  - The Go suite is the best-documented "safe by construction" fixer found, but that rests on the Go team's own statement; no independent error-rate data was found.
  - The Java part draws on research tools (Sorald) and IDE engines. No fix-safety data was found for mainstream Java autofixers (Error Prone patches, OpenRewrite recipes).
- **Fix risk:** medium

### G105-F19 — For large mechanical changes, emulate the large-scale-change (LSC) trust model: change type approved, sharded, fully tested, pattern-checked, owner-routed
- **Grade:** B · **Verdict:** CORRECTED (the "700 changes / 15,000 files per day" figure is scoped to one migration)
- **Rationale:** The model has five steps:
  1. Write down the change type (rule id, expected rewrite, why it preserves behaviour) and get a human go/no-go.
  2. Shard by ownership.
  3. Run the full transitive tests per shard.
  4. Auto-check each hunk against the expected rewrite pattern and route only anomalies to a human.
  5. Route each shard to its owner, and keep each one revertable.

  How the large programmes do it:
  - Google global reviewers "use a separate set of pattern-based tooling to review each of the changes and automatically approve ones that meet their expectations", examining manually only anomalies. The chapter also stresses a robust testing culture "when applying changes that are not authored by humans".
  - Error Prone's Rosie splits changes per project and sends them to owners.
  - In Tricorder, APPLY FIX appears only after PREVIEW FIX.
  - Uber's Piranha assigns each diff to the flag's author: 65% landed unchanged, and over 85% compiled and passed tests.
  - Stripe merged one PR converting more than 3.7M lines after months of codemod iteration, CI and QA.

  **Correction.** "More than 700 independent changes, touching more than 15,000 files per day" describes the peak of the scoped_ptr→std::unique_ptr migration, not general LSC throughput.
- **Evidence:**
  - [Software Engineering at Google, ch. 22](https://abseil.io/resources/swe-book/html/ch22.html) — Hyrum Wright, O'Reilly, 2020 — book — pattern-based approval quote and testing quote confirmed. The 700/15,000 figure is confirmed in its scoped_ptr context.
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski et al., 2018 — peer-reviewed — Rosie quote confirmed.
  - [Tricorder: Building a Program Analysis Ecosystem (ICSE 2015)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf) — Sadowski, van Gogh, Jaspan, Söderberg, Winter, 2015 — peer-reviewed — "This option can only be seen after using PREVIEW FIX." / 10% probation / "If the rate goes above 25%, we may decide to turn the analyzer off immediately." Confirmed.
  - [Piranha: Reducing Feature Flag Debt at Uber (ICSE-SEIP 2020)](https://manu.sridharan.net/files/ICSE20-SEIP-Piranha.pdf) — Ramanathan, Clapp, Barik, Sridharan, 2020 — peer-reviewed — "(b) 65% of the diffs landed without any changes, (c) over 85% of the generated diffs compile and pass tests successfully" / "The diff is assigned to the author of the flag…" Confirmed.
  - [Migrating millions of lines of code to TypeScript](https://stripe.dev/blog/migrating-to-typescript) — Andrew Lunny (Stripe), 2022-05-20 — engineering blog — "In a single pull request, we converted more than 3.7 million lines of code." / "Over several months we iterated…" / 97,000 → "37,000, or about one per thousand lines of code" / "…passing a build through our CI system and deploying it to our QA environment." Confirmed.
- **Detect:** For a mechanical change over roughly 30 files (policy threshold, unsourced):
  - a plan note with rule id, pattern, rationale and owner map
  - shards by directory or CODEOWNERS
  - affected tests per shard
  - hunks re-derived with an ast-grep/comby rule and compared; mismatches go to a human
- **Tools:** git, CODEOWNERS, ast-grep, comby, Piranha, jscodeshift, OpenRewrite (Rosie/TAP as models only).
- **Applies to:** Large mechanical changes in any language.
- **When not to apply / counterpoints:**
  - Google's model relies on huge test infrastructure; a solo project can only approximate it.
  - Stripe's big-bang merge shows sharding is not the only path.
- **Fix risk:** low

### G105-F20 — Prefer the deterministic fix over an LLM rewrite; LLM-authored mechanical edits are T2 at best, behind the same filters
- **Grade:** B · **Verdict:** CORRECTED (Assured LLMSE authorship and venue fixed; TestGen-LLM venue added)
- **Rationale:** Even the best industrial ML edit systems sit behind human preview and filters.
  - Google's review-comment model "addresses 52% of comments with a target precision of 50%", and "40% to 50% of all previewed suggested edits are applied".
  - Meta's TestGen-LLM: "75%… built correctly, 57% passed reliably, and 25% increased coverage", and 73% of recommendations were accepted.
  - Assured LLMSE "applies a series of semantic filters that discard code that fails to meet these twin guarantees".
  - Getafix "offers them to engineers to approve"; its top suggestion matches the human fix "between 12% and 91% of the time".

  Deterministic engines are fallible too: 130 new bugs in the refactoring-engine study, and 18 more found by RETESTER (7 confirmed, 3 fixed). Never instruct an agent to "apply all suggestions".
- **Evidence:**
  - [Resolving code review comments with ML](https://research.google/blog/resolving-code-review-comments-with-ml/) — Alexander Frömmgen, Lera Kharatyan (Google), 2023-05-23 — engineering blog — quotes confirmed, including the "Show ML-edit" preview button.
  - [Automated Unit Test Improvement using Large Language Models at Meta (arXiv:2402.09171)](https://arxiv.org/abs/2402.09171) — Alshahwan, Chheda, Finegenova, Gokkaya et al. (Meta), 2024 — **peer-reviewed (FSE 2024 per the arXiv comment)**, not only a preprint — figures confirmed.
  - [Assured LLM-Based Software Engineering (arXiv:2402.04380)](https://arxiv.org/abs/2402.04380) — **Nadia Alshahwan, Mark Harman, Inna Harper, Alexandru Marginean**, 2024 — workshop paper (InteNSE '24, per the arXiv comment) — "Assured LLMSE applies a series of semantic filters that discard code that fails to meet these twin guarantees." / "The human plays the role only of final code reviewer". Confirmed. The dossier said "Mark Harman et al.", but the first author is Alshahwan.
  - [Getafix blog](https://engineering.fb.com/2018/11/06/developer-tools/getafix-how-facebook-tools-learn-to-fix-bugs-automatically/) / [arXiv:1902.06111](https://arxiv.org/abs/1902.06111) — Chandra, Bader, Lippert, Scott (blog, 2018); Bader, Scott, Pradel, Chandra (paper, 2019) — engineering blog / paper — both quotes confirmed.
  - [Testing Refactoring Engine via Historical Bug Report driven LLM (arXiv:2501.09879)](https://arxiv.org/abs/2501.09879) — Haibo Wang, Zhuolin Xu, Shin Hwei Tan, 2025 — peer-reviewed (accepted at FORGE 2025 per arXiv) — "seven bugs have been confirmed by their developers, three have been fixed." Confirmed.
- **Detect:**
  - Flag prompts containing "apply all suggestions" / "fix all lint warnings" / "accept quick fixes".
  - Add a commit trailer `Mechanical-Source: <tool@ver RULE>|llm`.
  - LLM commits: tests re-run at least 3 times and a coverage delta of 0 or more (policy choice, unsourced).
- **Tools:** LLM coding agents, IDE refactoring engines, ruff, eslint, clippy, clang-tidy.
- **Applies to:** All languages; agent-driven hardening.
- **When not to apply / counterpoints:**
  - None of the LLM figures come from lint-fix rewriting, and no head-to-head LLM vs deterministic lint-fix study was found.
  - LLMs can handle "squishy" fixes that tools cannot, so the right place for them is T2/T3 with review, not a ban.
- **Fix risk:** low

### G105-F21 — Automated deletions default to T2 at least
- **Grade:** B · **Verdict:** VERIFIED (with issue status notes)
- **Rationale:** Dead code cannot be decided mechanically in general.
  - Piranha: "determining reachability in a sound and complete manner is infeasible", which "necessitates some form of manual intervention by the developer". For Java and Swift, "Piranha encourages developers to delete a significant portion (> 80%) of the lines manually".
  - Deletion fixes break code: clang-tidy misc-unused-parameters broke attributes on parameters (#122191, fixed within a day); Biome noUnusedImports (#4888); Ruff F401 side-effect imports (F09).
  - Ruff documents that safe fixes "will only remove comments when deleting entire statements or expressions (e.g., removing unused imports)".

  Deletions may enter T1 only when the symbol is private, no string or reflective lookup of its name exists, and the surrounding code is covered by tests. Parameter removal and deletions in public modules are T3.
- **Evidence:**
  - [Piranha (ICSE-SEIP 2020)](https://manu.sridharan.net/files/ICSE20-SEIP-Piranha.pdf) — Ramanathan, Clapp, Barik, Sridharan, 2020 — peer-reviewed — both quotes confirmed.
  - [llvm/llvm-project #122191](https://github.com/llvm/llvm-project/issues/122191) / [#31204](https://github.com/llvm/llvm-project/issues/31204) — LLVM users, 2025 / 2017 — incident reports — titles confirmed. #122191 was fixed via PR #122286 (closed 2025-01-09). #31204 was closed *worksforme* in 2023, so it no longer reproduces.
  - [The Ruff Linter – Fix safety](https://docs.astral.sh/ruff/linter/) — Astral, 2026 — official docs — quote confirmed.
- **Detect:**
  - `git show HEAD --numstat` for deletion-dominant commits from F401, F841, ERA001, noUnusedVariables/noUnusedImports, misc-unused-parameters and flag cleanups.
  - For each deleted identifier: `rg -n "\b<name>\b|['\"]<name>['\"]"` across the repo, including templates, configs and reflection/DI registries (getattr, importlib, Class.forName, dlsym).
- **Tools:** ruff, eslint, biome, clang-tidy, clippy, Piranha, vulture, knip.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** Removing a truly unused local or a private import is among the safest edits; a per-project audit can promote narrow rules (for example F841 on locals).
- **Fix risk:** medium

### G105-F22 — A hardening pass never "fixes" a finding by adding a suppression
- **Grade:** C · **Verdict:** VERIFIED (grade C kept: a policy synthesis resting on tool docs and one 2018 anecdote)
- **Rationale:** Suppression tooling defers debt; it does not remove it.
  - ESLint bulk suppressions exist so that "the existing violations will not be reported".
  - Biome `--suppress` "Writes comment suppressions for lint rule violations instead of applying rule fixes."
  - Stripe tracked 37,000 `@ts-expect-error` suppressions as migration debt.
  - An ESLint user's fix-on-save removed `debugger` statements; working around it with disable comments let a debugger statement slip "into production code at least twice". That issue (#10242) was accepted, and the fixer was removed in 2018.

  Reject any hardening commit that adds eslint-disable, biome-ignore, `# noqa`, `# type: ignore`, `#[allow]`, NOLINT, `@ts-expect-error`/`@ts-ignore`, `//nolint`, or bulk-suppression files. Report suppressions of existing unfixable findings as T3.
- **Evidence:**
  - [Bulk Suppressions](https://eslint.org/docs/latest/use/suppressions) — ESLint v10.11.0, 2026 — official docs — quote confirmed. The page adds that only rules configured as "error" are suppressed.
  - [Biome CLI – --suppress](https://biomejs.dev/reference/cli/) — Biome, 2026 — official docs — quote confirmed.
  - [ESLint #10242](https://github.com/eslint/eslint/issues/10242) — ESLint user, 2018-04-19 — incident report — quote confirmed; closed 2018-06-28, labels accepted/archived.
  - [Migrating millions of lines of code to TypeScript](https://stripe.dev/blog/migrating-to-typescript) — Andrew Lunny (Stripe), 2022 — engineering blog — "…tracking TypeScript error suppressions to address after the conversion." Confirmed.
- **Detect:** `git show HEAD | rg '^\+.*(eslint-disable|biome-ignore|#\s*noqa|#\s*type:\s*ignore|#\[allow\(|NOLINT|@ts-expect-error|@ts-ignore|//\s*nolint|pylint:\s*disable)'` plus `git show --stat HEAD | rg 'eslint-suppressions.json'`.
- **Tools:** git, ripgrep, eslint, biome, ruff, clippy, clang-tidy, tsc.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** A narrowly scoped, justified suppression of a true false positive can be right, but the call belongs to a human (via T3).
- **Fix risk:** low

### G105-F23 — Pin exact fixer versions; exclude preview, unstable, nursery and restriction modes from automation
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Fix behaviour is version-specific.
  - Prettier 3.6 introduced a Markdown semantic regression (#17746).
  - Black 26.5.0 had an internal-error regression (#5138: a `# type: ignore` plus `# fmt: skip` combination dropped a TypeIgnore node, and the AST check caught it).
  - Ruff promotes formatter changes from preview across minor releases, and preview changes F401 behaviour.
  - ANSSI singles out `clippy::nursery` ("still under development").
  - Prettier `--experimental-ternaries` with `--no-semi` produces incorrect code (#16330, open).
  - This dossier's own corrections add weight: several headline Ruff bugs (FURB101/103, B006 preview) are preview-only.

  Record the tool version, rule id and command in each commit, and re-validate the allowlist whenever a version changes.
- **Evidence:**
  - [ANSSI – Clippy](https://github.com/ANSSI-FR/rust-guide/blob/master/src/en/devenv.md) — ANSSI, 2026 — standard — quote confirmed.
  - [The Ruff Formatter – Preview style](https://docs.astral.sh/ruff/formatter/) — Astral, 2026 — official docs — "Similar to Black, Ruff implements formatting changes under the preview flag, promoting them to stable through minor releases…" Confirmed.
  - [Prettier #16330](https://github.com/prettier/prettier/issues/16330) / [#17746](https://github.com/prettier/prettier/issues/17746) — Prettier users, 2024 / 2025 — incident reports — titles and states confirmed.
  - [Black #5138](https://github.com/psf/black/issues/5138) — Black user, 2026-05-18 — incident report — "INTERNAL ERROR: Black 26.5.0 on Python (CPython) 3.12.11 produced code that is not equivalent to the source." Confirmed; closed the same day.
- **Detect:**
  - `rg -n 'preview\s*=\s*true|--preview|--unstable|--experimental|clippy::nursery|clippy::restriction'`
  - Version ranges are not pins: `rg -n '"(eslint|prettier|@biomejs/biome|typescript-eslint)":\s*"[\^~]'`
  - Check the `rust-toolchain.toml` channel and the ruff/black lockfile pins.
- **Tools:** ruff, black, prettier, biome, eslint, clippy, clang-tidy.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** Pinning old versions forgoes fixes for known fixer bugs. Pin a recent version, check its open fix-bug issues (F02), then freeze.
- **Fix risk:** low

### G105-F24 — The single tier policy (T0 AUTO / T1 AUTO-PER-RULE / T2 APPROVE / T3 REPORT)
- **Grade:** C · **Verdict:** DOWNGRADED (B → C: every input is sourced in F01–F23, but the policy's boundaries and thresholds are an unvalidated synthesis, as the dossier itself admits)
- **Rationale:** For each (tool@version, rule id), compute four inputs:
  - **A, applicability:**
    - A0 = printing or layout only.
    - A1 = tool-safe: Ruff safe (stable, non-preview), Biome safe, MachineApplicable via cargo fix or clippy --fix, ESLint/typescript-eslint real fixes, clang-tidy fixes at safe confidence, or the curated go fix suite.
    - A2 = everything else, including preview/nursery and LLM-authored edits.
  - **S, semantic class:**
    - S0 = whitespace.
    - S1 = local syntax rewrite.
    - S2 = the risk classes: imports; deletions; evaluation order and laziness; equality, truthiness and nullish; async; numeric/NaN; version-gated; cfg-adjacent; and the F14–F18 lists.
    - S3 = public API, correctness lints, or a suppression.
  - **C, coverage:** every touched line covered.
  - **K, known bugs:** an open fix-bug issue at the pinned version.

  Tiers:
  - **T3 REPORT:** A2 or S3.
  - **T2 APPROVE:** A1 and any of S2, not-C, K, or an unpinned target.
  - **T1 AUTO-PER-RULE:** A1 and S1 and C and not-K, target pinned, all configurations verified. One rule per commit, gates run, automatic revert and demotion on failure.
  - **T0 AUTO:** A0 and S0, primary-language files only, formatting-only commit, blame-ignore, then build and tests.

  In high-assurance mode (security-critical code, the ANSSI context, or projects without tests), T1 folds into T2.

  **Why C.** No source validates the 100%-touched-line bar, the hunk-sample rule (all hunks if under 30, else at least 10 plus every anomaly), or the ≥30-file LSC trigger. The tiers are a defensible reading of the evidence, not a published standard.

  **Inherited corrections.**
  - A1 must exclude preview-rule fixes explicitly, because Ruff preview rules can emit "safe" fixes.
  - The Ruff and Clippy tracker counts should not be quoted as safe-label error rates (F02, F03).
  - A Ruff-safe fix can legitimately fail a type-check gate (B010), so such a failure demotes the rule; it is not a tool bug.
- **Evidence:**
  - [ANSSI – DENV-AUTOFIX](https://github.com/ANSSI-FR/rust-guide/blob/master/src/en/devenv.md) — ANSSI, 2026 — standard — "In a secure Rust development, any automatic fix (for instance, provided by `rustfix` or `clippy`) MUST be verified by the developer." Confirmed (lines 375–378).
  - [Software Engineering at Google, ch. 22](https://abseil.io/resources/swe-book/html/ch22.html) — Hyrum Wright, O'Reilly, 2020 — book — "…we are now much more confident in the correctness of a single change than a test with any recent history of flakiness". Confirmed. Context: this is used to justify ignoring recently flaky tests in LSC submission.
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski et al., 2018 — peer-reviewed — confirmed (see F05, F06).
  - [Sorald (TDSC)](https://arxiv.org/abs/2103.12033) — Etemadi et al., 2022 — peer-reviewed — "This shows the importance of running tests after applying SORALD patches, as it can reveal some potentially unwanted fixes." Confirmed.
  - [ESLint CLI – --fix-type](https://eslint.org/docs/latest/use/command-line-interface) — ESLint, 2026 — official docs — layout = "apply fixes that do not change the program structure (AST)". Confirmed.
  - [Black / Prettier rationale](https://black.readthedocs.io/en/stable/the_black_code_style/current_style.html) — Black; Prettier, 2026 — official docs — confirmed (F08).
- **Detect:**
  - State file with one row per (tool@version, rule id): A, S, C, K, tier, commit sha, gate results.
  - A from the tools' JSON output; S from the rule lists plus diff greps; C from `diff-cover --fail-under=100`; K from `gh search issues`.
  - Audit: one commit per row, and no unreviewed T2 or T3 commit on the main line.
- **Tools:** git, diff-cover, gh, ruff, eslint, biome, cargo clippy, clang-tidy, go fix, black, prettier, ast-grep.
- **Applies to:** All languages; every mechanical change the skill makes.
- **When not to apply / counterpoints:**
  - The thresholds are policy.
  - Organisations with Google- or Stripe-grade infrastructure can be more permissive.
  - ANSSI would reject T1 outright for secure software.
  - The per-language lists go stale, so re-query K for each version.
- **Fix risk:** low

## Practitioner voice

All 17 URLs were opened and the quotes checked. The notes below say what each voice supports and add any status update.

- [Clippy #16191](https://github.com/rust-lang/rust-clippy/issues/16191) — 2025-12-04 — "I used `cargo clippy --fix` and unittests failed as a result, because the code didn't do the same as before." A let-chain rewrite around `#[cfg(feature)]`. Verified; still open.
- [Clippy #14444](https://github.com/rust-lang/rust-clippy/issues/14444) — 2025-03 — "`clippy::double_ended_iterator_last` is dangerous to autoapply"; `.next_back()` "dramatically changes the behaviour". Verified; fixed 2025-04-22.
- [Ruff #22620](https://github.com/astral-sh/ruff/issues/22620) — 2026-01 — F541 autofix "hides the bug the developer made". Verified; open, needs-decision.
- [Ruff #9962](https://github.com/astral-sh/ruff/issues/9962) — 2024 — "…avoid this footgun which comes up from time to time". Verified.
- [Ruff #26922](https://github.com/astral-sh/ruff/issues/26922) — 2026-07 — "`FURB101` and `FURB103` apply safe fixes that cause runtime errors". Verified. **Caveat:** the repro requires `--preview`; these are preview-only rules.
- [Biome #11351](https://github.com/biomejs/biome/issues/11351) — Biome 2.5.8, 2026-08 — "`useSimplifiedLogicExpression` "safe" fix breaks code". Verified; bug confirmed and fixed 2026-09-17. It contradicts the doc's "guaranteed" claim.
- [typescript-eslint #8661](https://github.com/typescript-eslint/typescript-eslint/issues/8661) — 2024 — return-await autofix is unsafe in try/finally lock-release code. Verified; fixed 2024-05-31.
- [LLVM #33239](https://github.com/llvm/llvm-project/issues/33239) — 2017 — two readability checks run together produced broken code, while each alone was fine. Verified; closed 2026-08-18.
- [Prettier #17746](https://github.com/prettier/prettier/issues/17746) — 2025 — "Semantically changes Markdown loose list to tight list". Verified; fixed (closed as completed 2026-06-04).
- [HN 39559307](https://news.ycombinator.com/item?id=39559307) — rurban, 2024-03-01 — "dos2unix, chmod … clang-format -i All in seperate commits. Turns out there was a .h file not a header, but some custom list of algorithm states, broken by fmt." Verified via the Algolia API.
- [HN 39137158](https://news.ycombinator.com/item?id=39137158) — david_allison, 2024-01-25 — "Commits which fix formatting should definitely be a separate commit so they can be added to `.git-blame-ignore-revs`." Verified.
- [HN 47928598](https://news.ycombinator.com/item?id=47928598) — pdimitar, 2026-04-27 — "…modernize a fairly old project in literal 15 minutes by using Cargo Clippy's fix mode + a few small hand-crafted changes." Verified.
- [HN 46514484](https://news.ycombinator.com/item?id=46514484) — vlovich123, 2026-01-06 — `cargo fix --edition` failed only "on some obscure constructs that it couldn't do automatically because the meaning of some trait stuff changed subtly". Verified. Note: "failed" means the tool could not do it automatically, not that it silently miscompiled.
- [HN 47055671](https://news.ycombinator.com/item?id=47055671) — g947o, 2026-02-18 — on LLM-assisted codemods: "make sure to write tests -- a lot of them -- and come up with a way to quickly fix bugs, revert your change and then iterate." Verified.
- [Sorald (arXiv:2103.12033)](https://arxiv.org/abs/2103.12033) — the PR22 maintainer: "…just approve it as long as the tests are green". Verified.
- [Kim, Zimmermann, Nagappan (FSE 2012)](https://thomas-zimmermann.com/publications/files/kim-fse-2012.pdf) — "What we need is a better validation tool that checks correctness of refactoring, not a better refactoring tool." Developers do 86% of refactoring manually. Verified.
- [ESLint #10242](https://github.com/eslint/eslint/issues/10242) — 2018 — fix-on-save removed `debugger`; the workaround let a "debugger statement slipped into production code at least twice". Verified.
- [Piranha (ICSE-SEIP 2020)](https://manu.sridharan.net/files/ICSE20-SEIP-Piranha.pdf) — 65% of diffs landed unchanged; for Java and Swift, more than 80% of lines were deleted manually; diffs are routed to the flag owner. Verified.

## Contradictions and open questions

**Contradictions**
1. **ANSSI vs Google vs Biome on unattended fixes.**
   - ANSSI DENV-AUTOFIX says any automatic fix "MUST be verified by the developer".
   - Google's code janitors "automatically apply all fixes from a given analysis", and LSC global approvers auto-approve pattern-matching hunks.
   - Biome says safe fixes "can be applied without explicit review".

   Resolution: ANSSI is scoped to "secure Rust development", so it becomes the high-assurance mode (T1 folds into T2).
2. **"Guaranteed" labels vs trackers.**
   - Biome says safe fixes are "guaranteed to not change the semantic of your code". Its 2026 tracker has confirmed safe-fix breakages: #11351 (fixed), #10212, #11419 and #9585 (open).
   - Ruff is also more categorical than the researcher credited ("The meaning and intent of your code will be retained when applying safe fixes") before softening to "intended to preserve runtime behavior". Only Biome says "guaranteed", but Ruff's wording is a strong claim too.
3. **Ruff's definition of "safe" excludes type-checker compatibility.** In #28493 the maintainer stated the criteria as "doesn't change runtime behavior and doesn't remove comments". A skill that gates on type-checking will therefore see Ruff-safe fixes fail its gate. That is by design, not a Ruff bug.
4. **Import safety.** Ruff labels unused-import removal safe outside `__init__.py`. Prettier refuses to sort imports at all ("potentially unsafe because of side effects"), and simple-import-sort answers "Mostly". Ruff's own F401 preview note concedes that it models "the developer's intuition rather than Python's actual execution".
5. **One rule per commit vs big-bang.** The Sorald lessons, the Go team's clean-state advice and the clang-tidy and Ruff interaction bugs all favour one rule per commit. Stripe's single 3.7M-line PR succeeded, after months of codemod iteration, CI and QA.
6. **Tests as oracle.**
   - Google is "more confident in the correctness of a single [semantic-preserving machine-generated] change than a test with any recent history of flakiness". That statement is about flaky tests specifically.
   - Against relying on tests: a Sorald maintainer warned against approving "as long as the tests are green"; 2 of Sorald's 7 failures were tests enforcing bugs; and Silva et al. 2017 found that generated suites miss more than 50% of injected refactoring faults.
7. **Developer distrust vs industrial adoption.** Kim et al. report that 86% of refactoring is manual and 77% of developers fear subtle regressions. Google authors apply about 3,000 previewed fixes a day, and 65% of Piranha diffs landed unchanged. The adopting programmes built trust per analyzer, with preview and owner review.
8. **The brief's claims about specific rules** (from the original brief, T20/T23).
   - The brief lists "||→??, ==→===, removing unnecessary conditions" as autofixes. Upstream these are suggestion-only (prefer-nullish-coalescing, no-unnecessary-condition) or partially fixed (eqeqeq only for typeof or same-type literals).
   - The brief says modernize-use-emplace is "documented to change semantics". The current doc warns only about a speed regression, and the semantic and compile problems live in the tracker. One tracker citation, #104565, turned out to be *worksforme*.
9. **Loud vs silent ratio.** The dossier's "925 vs 40" for Clippy overstates loudness because of label age. Since 2025 it is 278 vs 33 (about 8:1). The Ruff sample of the last 12 months is also dominated by syntax errors and infinite loops. Either way, loud failures dominate.
10. **Internal inconsistency fixed.** F05's original detection ("Ruff prefix F → report") conflicted with F09 and F21 (F401 and F841 → approve). It is resolved in favour of named codes.

**Open questions**
- No fixer publishes a denominator (fixes applied vs fixes that were wrong). Tracker counts cannot be turned into a per-fix probability, and the Ruff and Clippy counts mix tiers and preview.
- No empirical study sets a coverage or mutation-score threshold for accepting automated fixes. The 100%-touched-line bar is policy.
- No head-to-head study compares tool-safe lint fixes, manual edits and LLM rewrites on finished code.
- Ruff's formatter has no documented runtime AST-equivalence check (confirmed only by absence in its docs).
- Whether ESLint writes the file when a later fix pass produces a parse error was not verified.
- The fix safety of Ruff I001 and clang-format SortIncludes relative to side-effect imports and includes was not verified.
- Wang et al. 2024 (refactoring-engine bugs) is still an arXiv preprint with no journal reference found (arXiv API and OpenAlex, 2026-09-23).
- Several cited tracker issues are fixed at current versions (Biome #11351 and #11896, typescript-eslint #8661, Clippy #14444, #16706, #16875 and #17467, Ruff #25470, LLVM #122191). K must be re-queried per pinned version at run time.

## Dropped findings

No finding was dropped. Within findings, these source-level removals and corrections were made:
- **Dropped source (F17):** [llvm/llvm-project #104565](https://github.com/llvm/llvm-project/issues/104565) "`modernize-use-emplace` fix-it leads to compilation error". It was closed with the `worksforme` label after a maintainer showed that the suggested code "does compile (even when automatically fixed with `-fix`)". It is not evidence of a bad fix-it.
- **Dropped claim (F17):** the parenthetical "(overload resolution)" as Google's reason for rejecting NULL→nullptr. The source (SWE at Google, ch. 22, footnote 13) calls the change "dangerous" and gives no reason.
- **Dropped claim (F18):** "Practitioners report running [go fix] widely without incident". No source was given and none was found.
- **Re-scoped claim (F02, F15):** Ruff #26922 is no longer an example of a stable safe fix failing. It is a preview-rule failure.
- **Re-scoped claim (F03):** the Clippy "925 build-breaking vs 40 silent" comparison is replaced by the like-for-like 2025+ figures (278 vs 33).
