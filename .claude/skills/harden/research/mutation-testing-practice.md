# Mutation testing as the safety-net gate of a one-shot pass: per-language tooling, cost control and survivor triage
> Code G108 · slug mutation-testing-practice · verified 2026-09-23 · counts: verified 11 / corrected 9 / downgraded 1 / dropped 0

## Summary

Mutation testing can serve as the safety-net check of a one-shot hardening pass, including on Windows, under three conditions.

1. **Measure before refactoring, on the lines or functions about to change, and judge each survivor instead of a score.** No industrial deployment we found gates on a global mutation score. Kaufman et al. (ICSE 2022) write that "no known industrial application of mutation testing uses or even computes mutation adequacy". Once test-suite size is controlled, the correlation between score and fault detection is weak (Papadakis et al., ICSE 2018). Coverage and mutation levels only start to matter for fault revelation once they are high (Chekam et al., ICSE 2017). Chen et al. (ASE 2020) dispute the "control for size" reading, so the correlation question is still open. The proposed gate, "zero unexplained survivors on lines to be modified", fits how Google and Facebook/Meta use mutants, but no study validates it as a refactoring gate (grade D for the gate itself).
2. **Before triaging any survivor, check that the run actually measured something.** Open StrykerJS issue #6210: with StrykerJS 10.0.0 and Vitest 5, one project's score fell from 47.36 to 2.96. Two independent reproductions show the same thing: 33 killed / 3 survived became 3 / 33, and 24 / 2 became 0 / 26 on Vitest 5.0.1. The research session's own toy run shows the same pattern. The saved Vitest-4 report has 24 mutants: 12 killed, 6 survived, 6 CompileError. On Vitest 5.0.1, all 18 non-CompileError mutants were reported Survived. (The researcher's notes said 11/7, while the saved artifact says 12/6.) Issue #6213, on Stryker 9.6.1 with Vitest 4.1.4, found about 5.5% of mutants scored Survived with `testsCompleted: 0`. Flaky tests move scores by about 4 percentage points between repeated runs (Shi et al., ISSTA 2019, PIT on 30 projects).
3. **Keep the mutant count small.** Suppress unproductive ("arid") mutants and allow one mutant per line, or test the most severe mutant first, before resorting to random sampling. At Google this cut the median from 820 to 7 mutants per changelist and raised the share of mutants developers judged productive from 15% to 89%.

**Windows status.** The researcher ran these tools on 2026-09-23; the saved artifacts partly corroborate the runs.
- **Native:** StrykerJS 10.0.0, cargo-mutants 27.1.0 and cosmic-ray 8.7.0.
- **WSL only:** mutmut 3.8.0. Its README says it needs `fork`, so on Windows it "must run inside WSL".
- **Docker:** gremlins v0.6.0. Its Windows issues are open: 17 minutes on Windows vs about 40 s on Linux, and failed coverage detection.
- **Linux/macOS only, so WSL2:** Mull 0.34.1, dextool and Trail of Bits' mewt. None of these three was run.
- **Solidity:**
  - `forge test --mutate` has been an **opt-in preview** in Foundry since v1.8.0 (2026-08-27) and ships a win32 binary. It was not run here.
  - slither-mutate 0.11.6.
  - Gambit only generates mutants.
  - vertigo-rs is stale (last push 2024-09-05, no releases).

**Survivor triage.**
- **How many are equivalent:** in 7 Java projects, the median share of equivalent mutants is 2.97% of all mutants. Among covered survivors that becomes about 8-24%, derived from Kushigian et al.'s stratified samples.
- **How long each takes:** hand-labelling averaged about 5 minutes per mutant, ranging from under 1 minute to over 1 hour. Earlier work estimated 5-15 minutes.
- **LLM verdicts:** LLM equivalence verdicts are not reliable enough to use alone. GPT-4-0613 zero-shot reached a macro-F1 of about 0.56. Meta's detector had precision 0.79 and recall 0.47 before simple pre-processing, and 0.95 and 0.96 after it.
- **What killing tests assert:** tests written to kill a mutant must assert observable, specified behaviour, never incidental implementation details.
- **LLM-generated killing tests:** a mutant-driven "harden the tests first" step with LLM-generated tests is viable (Meta ACH: 73% of its tests were accepted), provided each generated test:
  - builds;
  - passes repeatedly;
  - kills its mutant;
  - has its oracle reviewed.

The time budget in F11 is a proposal (grade D).

## Findings

### G108-F05 — Python: mutmut in WSL2, cosmic-ray natively on Windows
**Rule:** Run mutmut 3.8.0 inside WSL2, since it refuses to run natively on Windows. Scope it with function globs and `mutate_only_covered_lines`. When a native-Windows run is required, use cosmic-ray 8.7.0 with an absolute forward-slash interpreter path in `test-command`, and check that the incompetent count is zero.

- **Grade:** A · **Verdict:** CORRECTED. Three fixes:
  - The "Both strategies require os.fork" quote comes from the mutmut README, not the 3.8.0 release notes.
  - There is no "hot-fork" mode; the second isolation mode is `forkserver`.
  - The Windows-branch comment in #397 is by contributor Otto-AA, not the maintainer.
  - The cosmic-ray "incompetent" definition lives in `concepts.rst`, not in the intro tutorial.
- **Rationale:** mutmut needs `fork`. Native Windows support is still an open issue, on a side branch that has no timeouts. Local runs, corroborated by the saved `session.sqlite` (23 work results: 16 KILLED, 7 SURVIVED):
  - Native `mutmut run` refused to start.
  - In WSL, 4 mutants ran in 1.16 s.
  - cosmic-ray 8.7.0 ran natively: 23 mutants in 15.6 s, about 0.7 s per mutant, 7 survivors.

  mutmut 3 only mutates code inside functions.
- **Evidence:**
  - [mutmut README](https://github.com/boxed/mutmut) — boxed/mutmut, 2026 — official_docs.
    - Quotes: "Mutmut must be run on a system with `fork` support. This means that if you want to run on windows, you must run inside WSL." · `mutmut run "my_module.my_function*"` · `mutate_only_covered_lines` (default false) · a `do_not_mutate_patterns` example that disables logger calls · `# pragma: no mutate` · "If you want to mutate code outside of functions, you can try using mutmut 2" · on process isolation (`fork` vs `forkserver`): "Both strategies require `os.fork`, so they are POSIX-only."
    - Verified in the README via the GitHub API.
  - [Windows support (without using WSL) #397](https://github.com/boxed/mutmut/issues/397) — boxed/mutmut issues, opened 2025-06-23, still open — practitioner_forum.
    - Quotes: "We use `fork()` as a performance optimization, which only works on Unix systems." Otto-AA (2025-09-12): "It should work with the windows-support branch … the main difference should be that timeouts are not implemented."
    - Verified.
  - [mutmut 3.8.0 release](https://github.com/boxed/mutmut/releases/tag/3.8.0) — boxed/mutmut, 2026-09-12 — official_docs. Lists "feat: process isolation and fork-safe test runners" (#566) and Python 3.15 support. Verified. The POSIX-only quote is in the README, not here.
  - [Cosmic Ray intro tutorial](https://github.com/sixty-north/cosmic-ray/blob/master/docs/source/tutorials/intro/index.rst) and [concepts](https://github.com/sixty-north/cosmic-ray/blob/master/docs/source/concepts.rst) — sixty-north, 2026 — official_docs.
    - Workflow: `cosmic-ray init`, `cosmic-ray --verbosity=INFO baseline tutorial.toml`, `cosmic-ray exec`, `cr-report`.
    - The tutorial warns: "If the test suite does *not* pass in the absence of mutations, then the results of the mutation testing are essentially useless."
    - Concepts: "if a test of a mutant takes longer than the timeout, the test is killed, and the mutant is marked incompetent."
    - Release/v8.7.0 is dated 2026-08-09. The README has a separate "Python version windows" badge and a 3.9+ badge.
    - Verified.
- **Detect:**
  - **WSL:** copy the project into the Linux filesystem, then run `python3 -m venv .venv && . .venv/bin/activate && pip install mutmut==3.8.0 pytest && mutmut run "pkg.mod.x_func*" && mutmut results && mutmut show <mutant>`.
  - **Native:** write `cfg.toml` with `module-path`, `timeout`, `test-command = "C:/…/.venv/Scripts/python.exe -m pytest -x -q tests"` and distributor `local`. Then run `cosmic-ray init cfg.toml s.sqlite; cosmic-ray baseline cfg.toml; cosmic-ray exec cfg.toml s.sqlite; cr-report s.sqlite`.
  - Reject the run if INCOMPETENT is above 0 and timeouts do not explain it.
- **Tools:** mutmut 3.8.0 (WSL), cosmic-ray 8.7.0 (native), WSL2 Ubuntu 24.04.
- **Applies to:** Python projects on Windows hosts. mutmut 3.8.0 adds Python 3.15; cosmic-ray advertises 3.9+.
- **When not to apply / counterpoints:**
  - The mutmut windows-support branch has no timeouts, so infinite-loop mutants hang.
  - cosmic-ray pays one test-process start-up per mutant. The "10-100x slower per mutant than mutmut" figure comes only from the toy measurements here (0.7 s vs about 0.01 s per mutant).
  - Test setups that are not fork-safe (the README names gevent's `patch_all`, grpc and torch) need `process_isolation = "forkserver"`.
- **Fix risk:** low

### G108-F06 — Rust: cargo-mutants natively on Windows
**Rule:** Use cargo-mutants 27.1.0. Scope it with `-f`/`-F` before the change and `--in-diff <file>` after it. Keep `--jobs` at 2-3 and accept the default timeout. Skip mutants only with `#[mutants::skip]` plus a comment giving the reason.

- **Grade:** A · **Verdict:** CORRECTED. The quoted example `git diff | cargo mutants --in-diff /dev/stdin` does not appear on the current in-diff page or anywhere in the full book (print.html). The book's CI example writes the diff to a file (`git diff origin/$BASE.. | tee git.diff`) and then passes that file. Use a diff file, which the researcher did anyway.
- **Rationale:** Local run (the saved `mutants.out.old` shows 12 mutants, 9 caught, 3 missed): 12 mutants in about 15 s, and `--in-diff` on a saved diff file ran 7 mutants. Two of the 3 missed mutants are equivalent boundary mutants in `clamp()` (`<`→`<=` and `>`→`>=`). The third (`>`→`==`) is a real gap. The book says the runtime is dominated by incremental builds plus tests, and that `-j` should not scale like make.
- **Evidence:**
  - [cargo-mutants: parallelism](https://mutants.rs/parallelism.html) — Martin Pool, cargo-mutants book, 2026 — official_docs. Verified.
    - "You should set the number of jobs very conservatively, starting at -j2 or -j3."
    - "…only likely to be helpful on very large machines, perhaps with >100 cores and >256GB RAM."
    - "Unlike with make, setting -j proportionally to the number of cores is unlikely to work out well."
    - Target directories are "commonly … 2GB or more", one per job.
    - "…tests may be slower with high parallelism … you may see some spurious timeouts".
  - [cargo-mutants: timeouts](https://mutants.rs/timeouts.html) — official_docs — "The default test timeout is 5 times the baseline test time, with a minimum of 20 seconds." Verified.
  - [cargo-mutants: performance](https://mutants.rs/performance.html) — official_docs — "Most of the runtime for cargo-mutants is spent in running the program test suite and in running incremental builds". It suggests a `[profile.mutants]` without debug symbols, and says "On Linux … using Wild cut the time to run cargo-mutants by more than half" on one tree. Verified.
  - [cargo-mutants: skip attributes](https://mutants.rs/attrs.html) — official_docs — `#[mutants::skip]`, `#[mutants::exclude_re("pattern")]`, and "You may want to also add a comment explaining why the item is skipped", with the example `// Returning false would cause a hang`. Verified.
  - [cargo-mutants: --in-diff](https://mutants.rs/in-diff.html) — official_docs. Verified; the `/dev/stdin` quote was removed.
    - "The diff is only matched against the code under test, not the test code. So, a diff that only deletes or changes test code won't cause any mutants to run…"
    - "…edits in one region cause code in a different region … to no longer be well tested … not a substitute for a full test run."
  - The v27.1.0 release (2026-06-02) was confirmed via the GitHub API.
- **Detect:**
  - `cargo install --locked cargo-mutants@27.1.0`.
  - Before the change: `cargo mutants -f src/lib.rs -j2`.
  - After the change: `git diff > change.diff && cargo mutants --in-diff change.diff`.
  - Results land in `mutants.out/` (`missed.txt`, `caught.txt`, `timeout.txt`, `unviable.txt`). The book confirms these files.
  - Grep for `#[mutants::skip]` without an adjacent comment.
- **Tools:** cargo-mutants 27.1.0, cargo-nextest (optional), `#[mutants::skip]` / `exclude_re`.
- **Applies to:** Rust crates and workspaces; Windows native, Linux, macOS.
- **When not to apply / counterpoints:**
  - The Wild speed-up is documented for Linux only. On Windows each mutant rebuilds with the default linker, so large workspaces can take hours; use `-f`/`-F` scoping and `--shard`.
  - The book warns that `--iterate` "is a heuristic, and makes the assumption that any new changes you make won't reduce coverage … you should run again without --iterate to make sure."
- **Fix risk:** low

### G108-F10 — JVM/.NET/PHP: PIT, Stryker.NET, Infection
**Rule:**
- **PIT 1.30.0:** pass an explicit `-Dthreads` (default 1). Set `thresholdPrecision` > 0 if any threshold is kept. Scope with `targetClasses`. The free build has no git-diff scoping (arcmutate needs a licence). Treat `withHistory` incremental results as provisional.
- **Stryker.NET 5.0.0:** use `--since:<ref>`.
- **Infection 0.35.4:** use `--git-diff-lines --git-diff-base=origin/main`.

- **Grade:** A · **Verdict:** VERIFIED. The research session reported pitest.org down; it answered HTTP 200 during verification, but the GitHub source docs match it.
- **Rationale:** Each tool documents the scoping features an agent needs, with different caveats:
  - PIT's incremental analysis rests on an "unproven" assumption, and its thresholds round to integers by default.
  - Stryker.NET's `--since` treats test-file changes as invalidating, unlike cargo-mutants `--in-diff`.
  - Infection warns that more threads do not guarantee speed.
- **Evidence:**
  - [PIT Maven quickstart (source)](https://github.com/hcoles/pitest-site/blob/master/quickstart/maven.markdown) / [pitest.org](https://pitest.org/quickstart/maven/) — pitest, 2026 — official_docs. Verified.
    - threads: "By default a single thread will be used"; timeoutFactor "Defaults to 1.25"; timeoutConstant "Defaults to 4000"; thresholdPrecision "Defaults to 0".
    - "Please bear in mind that your build may contain equivalent mutations. Careful thought must therefore be given when selecting a threshold."
    - "The integer threshold blind spot … coverage can silently regress without triggering a build failure."
    - PIT 1.30.0 was released 2026-08-27 (GitHub API).
  - [PIT incremental analysis](https://github.com/hcoles/pitest-site/blob/master/quickstart/incremental_analysis.markdown) — official_docs — "With the exception of 4), all these optimisations introduce a degree of potential error into the analysis." and "…it is currently **unproven**." Verified.
  - [Stryker.NET configuration: since](https://github.com/stryker-mutator/stryker-net/blob/master/docs/configuration.md) — official_docs. Verified.
    - "Use git information to test only code changes since the given target. Stryker will only report on mutants within the changed code."
    - "For changes on test project files all mutants covered by tests in that file will be seen as changed."
    - dotnet-stryker@5.0.0 was released 2026-09-11.
  - [Infection command-line options](https://infection.github.io/guide/command-line-options.html) — official_docs. Verified.
    - `--git-diff-lines` "Allows mutating only touched lines of code … Base branch can be changed by using --git-diff-base=main".
    - `--threads=max` is documented.
    - "Running Infection with more threads does not necessarily lead to better performance."
    - Infection 0.35.4 was released 2026-09-02.
  - [Arcmutate git integration](https://docs.arcmutate.com/docs/git-integration.html) — official_docs. Verified.
    - "analysis is always performed with the **current code** (not the code as it existed at the point of the commit)".
    - "by default only mutations on lines that have been modified will be analysed".
    - An `arcmutate-licence.txt` licence file is required.
- **Detect:**
  - Maven: `mvn org.pitest:pitest-maven:mutationCoverage -DtargetClasses=com.acme.billing.* -DtargetTests=com.acme.billing.* -Dthreads=4 -DoutputFormats=XML,HTML`.
  - .NET: `dotnet stryker --since:main`.
  - PHP: `vendor/bin/infection --git-diff-lines --git-diff-base=origin/main --threads=max --show-mutations`.
  - Grep `pom.xml`/`build.gradle` for `<mutationThreshold>` without `<thresholdPrecision>`.
- **Tools:** PIT 1.30.0, arcmutate (licensed), Stryker.NET 5.0.0, Infection 0.35.4.
- **Applies to:** Java/Kotlin (JVM), C#/.NET, PHP.
- **When not to apply / counterpoints:** None of these three tools was run in the session. Windows behaviour is assumed from JVM/.NET/PHP portability, not tested.
- **Fix risk:** low

### G108-F15 — Keep relative timeout defaults; distrust timeout clusters
**Rule:** Keep each tool's relative timeout defaults:
- Stryker: net time × 1.5 + 5,000 ms (+ overhead).
- PIT: × 1.25 + 4,000 ms.
- cargo-mutants: 5× baseline, minimum 20 s.
- slither-mutate: 2× the initial run, after `forge clean`.

Leave JS concurrency near Stryker's default (cores if ≤ 4, otherwise cores − 1) and Rust at `-j2`/`-j3`. On Windows or loaded machines, treat a cluster of Timeout results as suspect and re-run those mutants at lower concurrency rather than counting them as kills.

- **Grade:** A (documented defaults) · **Verdict:** VERIFIED. Added a supporting source: the cargo-mutants parallelism page warns about spurious timeouts under high parallelism.
- **Rationale:** Every tool detects infinite-loop mutants with timeouts derived from a baseline run. A cached or warm baseline makes timeouts too short. Heavy parallelism slows tests and causes spurious timeouts. StrykerJS #6213 shows the worker count changing verdicts.
- **Evidence:**
  - [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/) — official_docs — `timeoutForTestRunMs = netTimeMs * timeoutFactor + timeoutMS + overheadMs` (defaults 1.5 / 5000); concurrency default `cpuCoreCount <= 4? cpuCoreCount : cpuCoreCount - 1`. Verified.
  - [cargo-mutants: timeouts](https://mutants.rs/timeouts.html) / [parallelism](https://mutants.rs/parallelism.html) — official_docs — "5 times the baseline test time, with a minimum of 20 seconds"; "…tests may be slower with high parallelism … you may see some spurious timeouts". Verified.
  - [Slither-mutate documentation](https://github.com/crytic/slither/blob/master/docs/src/tools/Mutator.md) — Trail of Bits, 2026 — official_docs — "Make sure you run `forge clean` or similar beforehand to ensure cache usage doesn't cause a timeout that's too short to be used; this could lead to false-negatives." Verified.
  - [PIT Maven quickstart](https://github.com/hcoles/pitest-site/blob/master/quickstart/maven.markdown) — official_docs — timeoutFactor "Defaults to 1.25", timeoutConstant "Defaults to 4000". Verified.
- **Detect:**
  - After the run, count Timeout (Stryker), TIMED OUT (gremlins), `mutants.out/timeout.txt` (cargo-mutants) and INCOMPETENT (cosmic-ray).
  - Infection offers `--with-timeouts` and `--max-timeouts=N` (documented).
  - If timeouts cluster on non-loop code or exceed about 5% of mutants, re-run them with concurrency 1-2.
- **Tools:** StrykerJS, PIT, cargo-mutants, slither-mutate, cosmic-ray, Infection.
- **Applies to:** All tools; especially Windows hosts and shared CI runners.
- **When not to apply / counterpoints:** The ~5% trigger is a heuristic (grade D). Genuine infinite-loop mutants on loop conditions are expected Timeouts and are real detections.
- **Fix risk:** low

### G108-F01 — No global score threshold as the gate; gate on individual survivors
**Rule:** Do not use a global mutation-score threshold as the pass/fail gate of a hardening pass. Gate on the individual survivors in the code about to be modified. Each one gets one of:
- a killing test;
- a written equivalence or unproductive justification;
- an explicit "weakly tested behaviour" report.

A score threshold (`thresholds.break`, `mutationThreshold`, `--min-msi`) may be kept only as a separate non-regression trend check.

- **Grade:** B for the case against score thresholds; D for the per-survivor gate itself · **Verdict:** VERIFIED
- **Rationale:** Industrial systems surface individual survivors on changed code and do not compute adequacy. How strongly scores correlate with fault detection depends on how test-suite size is treated, and the level effect appears only at high coverage. No absolute number (60%, 80%) transfers between projects, and equivalent mutants make the ceiling unknowable. No study validates "zero unexplained survivors on lines to be modified" as a gate.
- **Evidence:**
  - [Prioritizing Mutants to Guide Mutation Testing](https://homes.cs.washington.edu/~rjust/publ/prioritizing_mutants_tcap_icse_2022.pdf) — Kaufman, Featherman, Alvin, Kurtz, Ammann, Just, ICSE 2022 — peer_reviewed — "no known industrial application of mutation testing uses or even computes mutation adequacy, instead focusing on iteratively presenting very few mutants as concrete test goals for developers to write tests." Verified in the PDF abstract.
  - [Practical Mutation Testing at Scale: A view from Google](https://arxiv.org/abs/2102.11378) — Petrović, Ivanković, Fraser, Just. arXiv 2021; published in IEEE TSE 48(10):3900-3912, 2022 — peer_reviewed. Verified in the PDF text.
    - "…it remains infeasibly expensive to compute the absolute mutation score for the codebase at any given fixed point…"
    - "…neither the traditionally computed mutant-detection ratio … nor simply showing all mutants that have evaded detection to a developer would be actionable."
  - [Are Mutation Scores Correlated with Real Fault Detection?](https://mpapad.github.io/publications/pdfs/ICSE2018.pdf) — Papadakis, Shin, Yoo, Bae, ICSE 2018 — peer_reviewed — "all correlations between mutation scores and real fault detection are weak when controlling for test suite size", together with "achieving higher mutation scores improves significantly the fault detection". Verified in the PDF.
  - [An Empirical Study on Mutation, Statement and Branch Coverage Fault Revelation that Avoids the Unreliable Clean Program Assumption](https://mpapad.github.io/publications/pdfs/ICSE2017.pdf) — Titcheu Chekam, Papadakis, Le Traon, Harman, ICSE 2017 — peer_reviewed — "fault revelation starts to increase significantly only once relatively high levels of coverage are attained" and "below this threshold level, the coverage achieved by a test suite is simply irrelevant to its fault-revealing potential". Verified.
  - [PIT Maven quickstart](https://github.com/hcoles/pitest-site/blob/master/quickstart/maven.markdown) — pitest, 2026 — official_docs — the equivalent-mutation warning about thresholds, and "The integer threshold blind spot". Verified.
  - [Does mutation testing improve testing practices?](https://arxiv.org/abs/2103.07189) — Petrović, Ivanković, Fraser, Just, ICSE 2021 — peer_reviewed — "almost 15 million mutants"; "developers using mutation testing write more tests, and actively improve their test suites with high quality tests such that fewer mutants remain"; "mutants are indeed coupled with real faults". Verified.
  - [Revisiting the Relationship Between Fault Detection, Test Adequacy Criteria, and Test Set Size](https://doi.org/10.1145/3324884.3416667) — Chen, Gopinath, Tadakamalla, Ernst, Holmes, Fraser, Ammann, Just, ASE 2020 — peer_reviewed (counterpoint) — "test set size is neither a confounding variable, as previously suggested, nor an independent variable that should be experimentally manipulated." Verified in the PDF.
- **Detect:**
  - Inspect the mutation configs: Stryker `thresholds.break` (default null); PIT `<mutationThreshold>`/`<testStrengthThreshold>`; Infection `--min-msi`/`--min-covered-msi`; gremlins `--threshold-efficacy` (exit code 10, documented); ooze `WithMinimumThreshold` (default 1.0, documented).
  - Flag any plan or CI that treats "score ≥ N" as enough evidence to refactor.
  - Check that a per-survivor disposition list exists for every changed line.
- **Tools:** StrykerJS thresholds, PIT mutationThreshold/thresholdPrecision, Infection --min-msi, gremlins --threshold-efficacy, ooze WithMinimumThreshold.
- **Applies to:** All languages; any pass that uses mutation testing to decide whether tests are strong enough to refactor.
- **When not to apply / counterpoints:** Chen et al. (ASE 2020) weaken the "weak once size is controlled" reading. A project-level score is still useful as a trend or regression signal (PIT's `thresholdPrecision` exists for that). The per-survivor gate itself is unvalidated.
- **Fix risk:** low

### G108-F02 — Measure before refactoring, scoped to the lines to be edited
**Rule:** Run the safety-net measurement BEFORE refactoring, scoped to the lines or functions you plan to modify. Use diff or incremental modes only after the change. Widen the scope when test files, snapshots, dependencies or callers changed, because diff and incremental modes see only the current tree and ignore several kinds of change.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Mutants on the lines about to be edited simulate the faults the refactor could introduce there. Diff modes have documented blind spots. Commit-aware research shows that scoring mutants located on the change correlates only weakly with the score of mutants that are actually commit-relevant.
- **Evidence:**
  - [StrykerJS configuration: mutate](https://stryker-mutator.io/docs/stryker-js/configuration/) — official_docs — `"src/app.js:1-11"`, `"src/app.js:5:4-6:4"`. Verified.
  - [StrykerJS incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/) — official_docs. Verified.
    - "Stryker will not detect any changes you've made in files other than mutated files and test files."
    - "…updated (dev) dependencies, changes to environment variables, changes to `.snap` files…"
    - "Static mutants don't have test coverage; thus, Stryker won't detect test changes for them."
    - Test-location support: Jest/CucumberJS/Vitest full; Command runner "Nothing".
    - `--force` reruns all mutants in scope.
  - [cargo-mutants: --in-diff](https://mutants.rs/in-diff.html) — official_docs — the test-only-diff blind spot. Verified.
  - [PIT incremental analysis](https://github.com/hcoles/pitest-site/blob/master/quickstart/incremental_analysis.markdown) — official_docs — "…it is currently **unproven**." Verified.
  - [Commit-Aware Mutation Testing](https://mpapad.github.io/publications/pdfs/ICSME2020.pdf) — Ma, Laurent, Ojdanić, Titcheu Chekam, Ventresque, Papadakis, ICSME 2020 (Crossref DOI 10.1109/icsme46990.2020.00045) — peer_reviewed. Verified in the PDF.
    - Scale: "83 commits, 2,253,610 mutants from 25 projects".
    - "relatively weak correlation (Kendall/Pearson 0.15-0.4)". The three weakly correlated metrics include "mutants located on the committed code".
    - "loses approximately 50%-60% of the commit-relevant mutants when analysing 5-25 mutants"
    - "approximately 30% lower chances of revealing commit-introducing faults".
  - [Mull incremental mutation testing](https://mull.readthedocs.io/en/latest/IncrementalMutationTesting.html) — official_docs — "Mull does not perform a git checkout to switch to a given commit's state … which can result in a misleading information in the mutation reports." Verified.
  - [Arcmutate git integration](https://docs.arcmutate.com/docs/git-integration.html) — official_docs — current-code analysis only; changed lines by default; licence required. Verified.
  - [Stryker.NET configuration: since](https://github.com/stryker-mutator/stryker-net/blob/master/docs/configuration.md) — official_docs. Verified.
- **Detect:** Before the refactor, list the target line ranges per file.
  - JS/TS: `stryker run --mutate "src/x.ts:40-95"`.
  - Rust: `cargo mutants -f src/x.rs -F "fn_name"`.
  - Python (WSL): `mutmut run "pkg.mod.x_func*"`.
  - Java: PIT `-DtargetClasses=… -DtargetTests=…`.
  - PHP: `infection --git-diff-lines` after the change.
  - If the diff touches tests, `__snapshots__`, lockfiles or env config, re-run without `--incremental`/`--in-diff` (Stryker `--force`).
- **Tools:** StrykerJS `--mutate file:lines` / `--incremental --force`; cargo-mutants `-f/-F/--in-diff`; mutmut function globs; PIT targetClasses/withHistory; Stryker.NET `--since`; Infection `--git-diff-lines`; Mull `gitDiffRef`.
- **Applies to:** All languages; especially behaviour-preserving refactors where the lines to be touched are known in advance.
- **When not to apply / counterpoints:**
  - Google (TSE) argues changed-line scoping "matches a developer's unit of work" (verified).
  - Ma et al. show it misses relevant mutants outside the change, so for risky refactors also mutate the direct callers and callees if affordable.
  - Pre-change scoping cannot measure tests for new code that the refactor adds.
- **Fix risk:** low

### G108-F12 — Suppress unproductive mutants and use one mutant per line before sampling
**Rule:** Cut the mutant count by suppressing unproductive mutants and testing at most one mutant per line (or the most severe first) before resorting to random sampling.
- Default suppressions (arid nodes): logging and tracing calls, collection capacity/reserve arguments, memoisation or cache lookups, sleeps/deadlines/timeouts, metrics counters.
- Each suppression rule gets a one-line reason.

- **Grade:** B · **Verdict:** CORRECTED. Foundry's skipping is span-based: it skips further mutations in a span where any mutation already survived. It does not rank mutants by severity. Slither-mutate (revert/comment mutators first) and mewt (throw replacement first) are the severity-first tools. Also added Google blog data supporting one mutant per line.
- **Rationale:** Google's arid-node heuristics plus 1-per-line selection cut the median from 820 to 7 mutants per changelist. They raised the productive share from 15% to 89%; productivity was 80% at service launch, rising to 89%. The log heuristic was 99/100 correct on a sample. Tools now ship similar ideas. In the session's toy run, StrykerJS reported a survivor for deleting `cache.set(amount, v)` in a function-local memo. This is a textbook arid case and is confirmed by the saved `mutation.json` and `calc.ts`.
- **Evidence:**
  - [Practical Mutation Testing at Scale](https://arxiv.org/abs/2102.11378) — Petrović et al. (Google), IEEE TSE 2022 — peer_reviewed. Verified in the PDF.
    - "developers at Google initially classified 85% of reported mutants as unproductive"
    - "There are more than a hundred rules for arid node detection"
    - "randomly sampling 100 nodes … 99 indeed were correctly marked"
    - "…improved the ratio of productive mutants from 15% to 89%"
    - "median … 820 for traditional mutagenesis, 77 for 1-per-line selection, and only 7 for arid-1-per-line selection"
  - [Mutation Testing (Google Testing Blog)](https://testing.googleblog.com/2021/04/mutation-testing.html) — Goran Petrović, 2021-04-12 — engineering_blog — "surfacing at most a single mutant per line"; "in more than 90% of cases, either all mutants were killed in a line or none was" (with arid suppression applied). Verified.
  - [cargo-mutants: skip_calls](https://mutants.rs/skip_calls.html) — official_docs — "By default, calls to functions called with_capacity are not mutated"; "…worth doing but not worth specifically writing tests or assertions for". Verified.
  - [mewt: how it works](https://github.com/trailofbits/mewt/blob/main/docs/how-it-works.md) — Trail of Bits, 2026 — official_docs — "Skipping less severe mutants when more severe ones are uncaught … can drastically decrease the runtime against poorly tested code. However, this also means the runtime will increase after the test suite is improved…"; `--comprehensive` disables it. Verified.
  - [Slither-mutate documentation](https://github.com/crytic/slither/blob/master/docs/src/tools/Mutator.md) and [source](https://github.com/crytic/slither/blob/master/slither/tools/mutator/__main__.py) — official_docs — "--comprehensive: continue testing minor mutations if severe mutants are uncaught". The source inserts the RR and CR mutators first. Verified at tag 0.11.6.
  - [feat(forge): mutation testing (PR #13091)](https://github.com/foundry-rs/foundry/pull/13091) — foundry-rs, merged 2026-06-03 — official_docs — "Adaptive span skipping … (skip mutations in spans where a mutation already survived)". Verified; this is span-based, not severity-based.
  - [mutmut README](https://github.com/boxed/mutmut) — official_docs — `do_not_mutate_patterns` with "# disable mutations of all logger.info/debug/... statements" and `'raise \w+'`. Verified.
- **Detect:**
  - Suppression config per tool:
    - StrykerJS `ignorers` / `mutator.excludedMutations`
    - cargo-mutants `skip_calls`
    - mutmut `do_not_mutate_patterns`
    - go-mutesting `--blacklist`
  - Grep survivor lines for arid classes: `rg -n "(log|logger|console)\.(debug|info|warn|trace)|with_capacity|reserve\(|sleep\(|setTimeout|deadline|metrics\.|counter\.inc"`.
  - Check that each suppression rule has a comment.
- **Tools:** StrykerJS ignorers/excludedMutations, cargo-mutants skip_calls, mutmut do_not_mutate_patterns, slither-mutate/mewt `--comprehensive`, Foundry span skipping.
- **Applies to:** All languages; most valuable in log-heavy service code.
- **When not to apply / counterpoints:**
  - Google says some of its most valuable heuristics are "unsound" and "can suppress a productive mutant". Its arid rules are "specifically tailored for the environment of the developers who provided the feedback, and a different context will require deriving new, appropriate heuristics" (appendix, verified). A log line carrying an audit requirement is not arid.
  - Severity-first and span skipping hide mutants until the suite improves.
  - Excluding a whole mutator removes signal everywhere.
- **Fix risk:** low

### G108-F16 — One disposition per in-scope survivor, recorded in a triage log
**Rule:** Give every survivor on in-scope lines exactly one disposition:
- **(a) REAL GAP:** write a killing test in a separate test-only commit before the refactor.
- **(b) EQUIVALENT:** suppress it in code with a reason naming which of reachability, infection or propagation fails.
- **(c) UNPRODUCTIVE-KILLABLE:** suppress it with the arid-class reason and write no test.
- **(d) UNCLEAR INTENDED BEHAVIOUR:** write no test. Report it as "weakly tested behaviour" and treat the line as unprotected.

- **Grade:** B for the inputs; D for the four-way protocol, which is a synthesis · **Verdict:** VERIFIED
- **Rationale:** Industrial data shows survivors are a mix of actionable gaps and noise, and real faults are usually coupled to mutants.
- **Evidence:**
  - [Please fix this mutant](https://homes.cs.washington.edu/~rjust/publ/mutation_testing_resolution_icse_2023.pdf) — Petrović, Ivanković, Fraser, Just, ICSE-SEIP 2023 — peer_reviewed. Verified.
    - "1,538 merge requests"
    - "38% of all surfaced mutants are resolved via code changes or test additions. Out of all mutants that are endorsed by a reviewer, 60% are resolved"
    - "for 64% of mutants, the mutated code changes as the merge request evolves"
    - Unresolved endorsed mutants include "false positives (mutants being resolved by tests not considered when creating the mutants, e.g., in integration test suites)"
  - [What It Would Take to Use Mutation Testing in Industry — A Study at Facebook](https://arxiv.org/abs/2010.13464) — Beller, Wong, Bader, Scott, Machalica, Chandra, Meijer, ICSE-SEIP 2021 — peer_reviewed — "more than half of the generated mutants survive Facebook's rigorous test suite"; "almost half of the 26 would actually act on the mutant" (11/26 = 42.3%). Verified.
  - [Are Mutants a Valid Substitute for Real Faults in Software Testing?](https://homes.cs.washington.edu/~rjust/publ/mutants_real_faults_fse_2014.pdf) — Just, Jalali, Inozemtseva, Ernst, Holmes, Fraser, FSE 2014 — peer_reviewed — "357 real faults"; "coupling effect for 73% of real faults"; "10% … require a new or stronger mutation operator"; "17% … are not coupled to mutants". Verified.
  - [Practical Mutation Testing at Scale](https://arxiv.org/abs/2102.11378) — Google, TSE 2022 — peer_reviewed — "An unproductive mutant is either trivially equivalent to the original program or it is detectable, but adding a test for it would not improve the test suite"; example "new ArrayList(64) → new ArrayList(16)". Verified.
- **Detect:**
  - Keep one triage-log row per survivor: tool id, file:line, mutator, disposition (a-d), evidence (test name + commit SHA, or reason text) and a re-run confirmation.
  - Gate: the number of survivors on in-scope lines without a row must be 0.
  - Check that suppression comments carry a reason. `rg -n --pcre2 "Stryker disable(?!.*:)"` is a starting point; PCRE2 is needed for the lookahead.
- **Tools:** StrykerJS disable comments, mutmut pragma, cargo-mutants skip attrs, git (separate test-only commits).
- **Applies to:** Any mutation-guided hardening pass on a finished codebase.
- **When not to apply / counterpoints:**
  - Category (d) will be large in code without specs, and a human must resolve it.
  - Pushing every survivor into (a) risks change-detector tests (F19).
  - 64% of mutants move during review, so survivor lists go stale fast; re-run after each commit.
- **Fix risk:** medium

### G108-F17 — Budget triage time for equivalent mutants
**Rule:** Expect about 3% of all generated mutants (rule-based, Java) and about 8-24% of covered survivors to be equivalent. Budget about 5 minutes on average per survivor for manual classification, ranging from under 1 minute to over 1 hour. LLM-generated mutants include many more trivially equivalent ones (25% syntactically identical in Meta's ACH), so strip comments and diff-compare mutants before analysis.

- **Grade:** B · **Verdict:** CORRECTED. Two fixes:
  - **Covered-survivor range.** Recomputed from Kushigian et al.'s Table 2 ("Cov." sampled stratum, N / Eq), the range is 8.3% (Collections 18/216) to 23.5% (Gson 67/285), not 8.6% (Chart). The other projects: Chart 8.6%, Csv 12.1%, JxPath 12.3%, Math 15.2%, Lang 20.2%.
  - **Wang et al. figures.** The current arXiv v5 (2026-01-22) supersedes the v4 figures quoted by the researcher; see the Wang et al. evidence item.
- **Rationale:** Ground truth from 1,992 labelled Java mutants gives a median equivalent rate of 2.97% (range 1.84%-5.24%). Covered-live strata are far richer in equivalents. TCE on C programs detects more than 7% of mutants as equivalent. Rates depend on language, operators and suite strength.
- **Evidence:**
  - [Equivalent Mutants in the Wild](https://homes.cs.washington.edu/~rjust/publ/equi_mutants_ems_issta_2024.pdf) — Kushigian, Kaufman, Featherman, Potter, Madadi, Just, ISSTA 2024 — peer_reviewed. Verified; the survivor-share range is our derivation from Table 2.
    - "the median equivalent mutant rate across the 7 projects is 2.97%"
    - "if 5% of generated mutants are equivalent and a test suite kills 80% of generated mutants, 25% of the remaining mutants are equivalent"
    - "an average of 5 minutes per mutant, ranging from less than a minute … to over one hour"
    - Prior estimates: "5 to 15 minutes".
  - [Trivial Compiler Equivalence](https://mpapad.github.io/publications/pdfs/ICSE2015B.pdf) — Papadakis, Jia, Harman, Le Traon, ICSE 2015 — peer_reviewed — "TCE can discard more than 7% and 21% of all the mutants as being equivalent and duplicated mutants respectively … approximately 30% of all the existing equivalent mutants." Verified.
  - [Mutation-Guided LLM-based Test Generation at Meta](https://arxiv.org/abs/2501.12862) — Foster, Gulati, Harman, Harper, Mao, Ritchey, Robert, Sengupta, FSE Companion 2025 (industry) — peer_reviewed. Verified.
    - "25% of the mutants generated are trivially syntactically equivalent … typically around 10% to 15% for rule-based approaches"
    - "61% of all equivalent mutants are almost trivially equivalent, because they contain only a single 'misleading' comment"
    - The LLM used was Llama 3.1 70B.
  - [A Comprehensive Study on Large Language Models for Mutation Testing](https://arxiv.org/abs/2406.09843) — Wang, Chen, Deng, Lin, Harman, Papadakis, Zhang, arXiv v5 2026 (formatted for ACM TOSEM) — preprint. Corrected; v4 quoted 26.60 / 10.14 / 3.51 pp.
    - v5 abstract: "the LLM-generated mutants have worse non-compilability, duplication, and equivalent mutant rates by 32.73, 9.38, and 3.64 percentage points, respectively".
    - Weighted equivalent-mutant rate: 4.74% for LLMs vs 1.10% for rule-based.
- **Detect:**
  - Budget = in-scope survivors × about 5 min. This is a human figure; agent wall-clock time is unmeasured.
  - For LLM mutants, normalise first (strip comments, format) and drop mutants textually identical to the original.
  - Where compilation is cheap, apply the TCE idea: compile the original and the mutant with optimisation and compare the output. Identical output means equivalent.
- **Tools:** TCE-style binary/bytecode diff, EMS (research, Java/Major), a comment-stripping pre-processor.
- **Applies to:** Survivor triage in all languages; LLM-generated mutant pipelines.
- **When not to apply / counterpoints:**
  - Sources disagree: 2.97% median (Kushigian, Java, Major); ≥ 7% (TCE, C); "10-15% typical" (ACH, citing others). Gopinath et al. (2015) note that the literature ranges "from 2% … up to 50%".
  - Toy runs in the session had far higher rates on clamping code (2 of 3 cargo-mutants misses were equivalent, confirmed from the saved `missed.txt`).
- **Fix risk:** low

### G108-F18 — Equivalence needs an R/I/P argument; an LLM verdict alone is not enough
**Rule:** Mark a survivor as equivalent only with a written argument naming which property fails:
- **Reachability (R):** the mutated code is unreachable.
- **Infection (I):** the mutation does not change program state.
- **Propagation (P):** the changed state never reaches an observable output.

Use a mechanical check where one exists. Use an LLM "equivalent" verdict to rank candidates, never to close them.

- **Grade:** B · **Verdict:** CORRECTED. The EMS runtime of "325 seconds" is the paper's abstract figure. Its Table 6 and conclusion give 1.26 h, or about 4,546 s, of total EMS runtime. Both are orders of magnitude below TCE's 2,938 h, so the conclusion stands. Report the discrepancy rather than one figure.
- **Rationale:** Zero-shot LLM equivalence detection is mediocre. On 3,302 Java method-level pairs, GPT-4-0613 zero-shot scored about 55.90% macro-F1, while fine-tuned code-embedding models reached about 82-87%. Meta's production detector (Llama 3.1 70B) had precision 0.79 and recall 0.47, rising to 0.95 and 0.96 with pre-processing. Many real equivalents can be caught by AST-level or local-dataflow patterns. These studies used 2023-2024 models.
- **Evidence:**
  - [Large Language Models for Equivalent Mutant Detection: How Far Are We?](https://arxiv.org/abs/2408.01760) — Tian, Shu, Wang, Cao, Kamei, Chen, ISSTA 2024 — peer_reviewed. Verified; the PDF's Table 3 layout is garbled, but the GPT-4 zero-shot F1 of 55.90% is legible.
    - "3,302 method-level Java mutant pairs"
    - "average improvement of 35.69% in terms of F1-score, with the fine-tuned code embedding strategy being the most effective"
    - Metrics are macro-averaged; models were gpt-4-0613 and gpt-3.5-turbo-0125.
  - [Mutation-Guided LLM-based Test Generation at Meta](https://arxiv.org/abs/2501.12862) — Foster et al., FSE Companion 2025 — peer_reviewed — "precision of 0.79 and a recall of 0.47 (rising to 0.95 and 0.96 with simple preprocessing)"; treating "unsure" as non-equivalent "gives precision of 0.97 (and a recall of 0.44)". Verified.
  - [Equivalent Mutants in the Wild](https://homes.cs.washington.edu/~rjust/publ/equi_mutants_ems_issta_2024.pdf) — Kushigian et al., ISSTA 2024 — peer_reviewed — RIP criterion: "R: The mutated code is reachable. I: Executing mutated code infects execution state. P: The infected state propagates to an observable output." The abstract says "EMS detects 8,776 equivalent mutants within 325 seconds; TCE detects 2,124 equivalent mutants in 2,938 hours". Table 6 and the conclusion say EMS took 1.26 h (4,546 s). Verified, with the internal inconsistency noted.
  - [StrykerJS: disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/) — official_docs — "// Stryker [disable|restore] [next-line] mutatorList[: custom reason]"; disabled mutants get the `ignored` status, "don't influence your mutation score but are still visible". Verified.
- **Detect:**
  - Require the letter R, I or P plus one sentence for each equivalence, e.g. "I: x<=lo returns lo and x==lo, identical state".
  - Mechanical checks: diff the compiled output (TCE), or run bounded differential property tests of the original against the mutant (fast-check, Hypothesis, proptest) as a falsification attempt.
  - Grep for suppressions without reasons.
- **Tools:** TCE, fast-check/Hypothesis/proptest differential runs, StrykerJS disable comments, mutmut pragma, cargo-mutants skip.
- **Applies to:** All languages; any agent proposing to close survivors as equivalent.
- **When not to apply / counterpoints:**
  - Differential fuzzing can only refute equivalence, never prove it.
  - Propagation-level equivalents need heap and inter-procedural reasoning.
  - No 2025-2026 replication with newer models was located.
- **Fix risk:** low

### G108-F20 — Optional mutant-driven "harden the tests first" step, with filters
**Rule:** An LLM step that writes tests targeted at survivors on the lines to be modified is worth adding before a refactor only with filters. Each generated test must:
1. build;
2. pass reliably on the original (N ≥ 3 runs);
3. fail on its target mutant;
4. have its oracle reviewed against the specification or docs.

Tests failing check 4 become labelled characterization tests or are dropped. Mutants should come from the rule-based tool unless LLM mutants are pre-filtered.

- **Grade:** B · **Verdict:** CORRECTED. The Wang et al. figures quoted by the researcher came from arXiv v4 (2025-09-12): 87.98% vs 41.64% detection and +26.60 pp non-compilability. The current v5 (2026-01-22) reports:
  - real-bug detection of 76.47% for LLMs vs 44.15% for rule-based;
  - worse non-compilability, duplication and equivalent-mutant rates by 32.73, 9.38 and 3.64 pp.
- **Rationale:** Meta's ACH gives industrial evidence that mutant-guided LLM tests are acceptable to engineers when assurances are enforced. TestGen-LLM shows the attrition without filters. LLM oracles tend to encode actual rather than expected behaviour.
- **Evidence:**
  - [Mutation-Guided LLM-based Test Generation at Meta](https://arxiv.org/abs/2501.12862) — Foster, Gulati, Harman et al., FSE Companion 2025 — peer_reviewed. Verified.
    - "(1) Buildable … (2) Valid Regression Tests: The tests pass and do so consistently … (3) Hardening: The new tests catch faults that no existing test can catch"
    - "engineers accepted 73% of its tests, judging 36% to privacy relevant"
    - "Of these 571 tests, 277 would have been discarded had we chosen to focus solely on the line coverage test adequacy criterion"
    - Acceptance was 56% at WhatsApp vs 89% at Messenger.
  - [Automated Unit Test Improvement using Large Language Models at Meta](https://arxiv.org/abs/2402.09171) — Alshahwan et al., FSE 2024 — peer_reviewed — "75% of TestGen-LLM's test cases built correctly, 57% passed reliably, and 25% increased coverage … 73% of its recommendations being accepted". Verified.
  - [Do LLMs generate test oracles that capture the actual or the expected program behaviour?](https://arxiv.org/abs/2410.21136) — Konstantinou, Degiovanni, Papadakis, 2024 — preprint — "LLM-based test generation approaches are also prone on generating oracles that capture the actual program behaviour rather than the expected one"; accuracy is "less than 50%", so "all LLMs suggestions will need human inspection". Verified.
  - [A Comprehensive Study on Large Language Models for Mutation Testing](https://arxiv.org/abs/2406.09843) — Wang et al., arXiv v5 2026 — preprint — v5 figures as given in the verdict above. Corrected.
- **Detect:**
  - Per generated test:
    - it builds;
    - it passes 3 runs on the original;
    - it fails on the target mutant (single-mutant mode);
    - its oracle provenance is recorded.
  - Reject tests that re-derive expected values by calling the code under test.
- **Tools:** StrykerJS / cargo-mutants / mutmut single-mutant re-runs, an LLM test generator, CI repeat runs.
- **Applies to:** Projects with weak tests on the lines a refactor will touch; any language with a single-mutant re-run mode.
- **When not to apply / counterpoints:**
  - ACH targeted privacy faults, with human reviewers; acceptance by a lone agent is unmeasured.
  - Acceptance varied sharply by team.
  - Characterization tests may freeze bugs.
- **Fix risk:** medium

### G108-F13 — Random sampling estimates a score; it never certifies the per-line gate
**Rule:** Use uniform random mutant sampling only to estimate a module- or project-level score. About 1,000 mutants gives roughly ±2% absolute error empirically. Never use sampling to certify the per-line gate. For estimates, prefer random sampling over hand-picked "sufficient operator" subsets.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Operator-based selection was not better than random selection. A sample of about 1,000 mutants estimated the full score within about ±2% across 158 Java projects; the theoretical bound is ±7% at 95%. A sample cannot say whether a specific line is protected.
- **Evidence:**
  - [Is Operator-Based Mutant Selection Superior to Random Mutant Selection?](https://taoxie.cs.illinois.edu/publications/icse10-mutation.pdf) — Zhang, Hou, Hu, Xie, Mei, ICSE 2010 — peer_reviewed — "operator-based mutant selection is not superior to random mutant selection." Verified.
  - [How Hard Does Mutation Analysis Have to Be, Anyway?](https://rahul.gopinath.org/resources/issre2015/gopinath2015howhard.pdf) — Gopinath, Alipour, Ahmed, Jensen, Groce, ISSRE 2015 — peer_reviewed — "a sample size as low as 1,000 mutants can, with a probability of 95%, provide an approximate mutation score with absolute error as low as ±7%"; empirically "…as low as ±2%" (0.62% on average). Verified.
  - [Gambit README](https://github.com/Certora/gambit) — Certora, v1.0.6 (2025-05-08) — official_docs — "randomly downsample the number of mutants with the `--num_mutants` or `-n` option". Verified.
- **Detect:** Check whether a reported score comes from a sample (Gambit `-n`, vertigo `--sample-ratio`, cargo-mutants `--shard k/n`, custom scripts). Flag per-line claims based on a sample.
- **Tools:** Gambit `-n`, vertigo-rs `--sample-ratio`, cargo-mutants `--shard`, custom random selection.
- **Applies to:** Large codebases where a baseline score estimate is wanted.
- **When not to apply / counterpoints:** Google's context-based selection, informed by history, raised survivability by more than 40% and productivity by almost 50% (verified). Selection for showing mutants to people is a different goal from score estimation.
- **Fix risk:** low

### G108-F14 — Use per-test coverage and the framework-specific runner
**Rule:** Always use per-test coverage and the framework-specific runner. Avoid generic "command" runners. When the runner limits tests to the mutated package (gremlins by default), widen it for cross-package tests, or confirm each survivor with the full suite.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Per-test coverage runs only the covering tests, and the command runner disables most optimisations. Restricting tests too far creates false survivors.
- **Evidence:**
  - [Why Stryker-JS is slower compared to Pitest (#4414)](https://github.com/stryker-mutator/stryker-js/issues/4414) — StrykerJS issues, 2023 — practitioner_forum — the config used `testRunner: "command"` and `coverageAnalysis: "off"`. User: "Pitest takes maximum around 30 min. But Stryker takes many hours". Maintainer (nicojs): "You're using the `command` test runner, which disables almost all performance enhancements that Stryker can use." Verified.
  - [StrykerJS configuration: coverageAnalysis](https://stryker-mutator.io/docs/stryker-js/configuration/) — official_docs — off / all / perTest (default) semantics. Verified.
  - [Please fix this mutant](https://homes.cs.washington.edu/~rjust/publ/mutation_testing_resolution_icse_2023.pdf) — ICSE-SEIP 2023 — peer_reviewed — the "false positives (… tests not considered …, e.g., in integration test suites)" passage. Verified.
  - [gremlins unleash](https://gremlins.dev/latest/usage/commands/unleash/) — official_docs — "In normal mode, Gremlins executes only the tests of the packages where the mutant is found … if a mutation in a package influences the tests of another package, this is not caught". `--integration` runs "all the test suite for each mutation" and "is generally much slower". Verified.
- **Detect:**
  - Grep `stryker.config.*` for `"testRunner": "command"` or `"coverageAnalysis": "off"`.
  - Look for gremlins configs without integration when tests live in separate packages.
  - Before writing a test for a survivor, run the whole suite once against it.
- **Tools:** StrykerJS runners, PIT, gremlins `--integration` / `--coverpkg`, cargo-nextest.
- **Applies to:** All ecosystems; biggest impact in JS/TS and Go.
- **When not to apply / counterpoints:** Per-test coverage has had correctness bugs (StrykerJS #6073, verdicts flip under perTest). Re-check unstable survivors with `coverageAnalysis: "off"`.
- **Fix risk:** low

### G108-F03 — Validate the run before triaging any survivor
**Rule:** Before triaging any survivor, confirm the run is a valid measurement:
- The unmutated baseline passes.
- At least one mutant is killed.
- There is no unexplained mass of Timeout, Incompetent or RuntimeError results.
- Every Survived mutant that has coverage shows `testsCompleted > 0`.
- The tool and runner versions are a known-good combination.

Re-run each survivor alone, with per-test coverage off, before writing a test for it.

- **Grade:** B · **Verdict:** CORRECTED
  - The cosmic-ray "incompetent" quote is from `concepts.rst`; its URL has been added.
  - The session's Vitest-4 counts are now given as in the saved report: 12 killed / 6 survived / 6 CompileError. The researcher's notes said 11/7.
- **Rationale:** Tool defects and flaky tests produce false survivors and false greens. Local observations from the research session, not independently reproduced here:
  - StrykerJS 10.0.0 with Vitest 5.0.1 killed 0 of 18 mutants that Vitest 4 split 12/6. Issue #6210 has an independent reproduction on 5.0.1.
  - Stryker 10 crashed with TypeScript 7.0.2 (`ts.parseConfigFileTextToJson is not a function`). This is consistent with #6111.
  - Under pnpm, the explicit `plugins` list was needed. The docs say that by default all `@stryker-mutator/*` modules in `node_modules` are loaded.
  - A cosmic-ray config with a relative venv path marked all 23 mutants INCOMPETENT, yet `cr-report` printed 0% surviving.
- **Evidence:**
  - [vitest-runner: on Vitest 5 the per-test name filter matches nothing (#6210)](https://github.com/stryker-mutator/stryker-js/issues/6210) — StrykerJS issues, opened 2026-09-04, still open (fix PRs #6214/#6220 unmerged) — practitioner_forum. Verified.
    - "On one project the score went from 47.36 (Vitest 4.1.11) to 2.96 (Vitest 5.0.0), same 2,637 mutants, same 373 tests"
    - Reproductions: 33/3 → 3/33 (funkadelic) and 24/2 → 0/26 on 5.0.1 (steoj).
    - The runner declares the peer range `"vitest": ">=2.0.0"`.
  - [vitest-runner: mutants with testsCompleted: 0 are reported as Survived (#6213)](https://github.com/stryker-mutator/stryker-js/issues/6213) — opened 2026-09-05, open — practitioner_forum. Verified.
    - 515 and 546 of 9,475 covered mutants, "100%" scored Survived, "~5.5%".
    - Versions: core 9.6.1 with vitest 4.1.4. It is triggered by a low Vitest worker count, not by Vitest 5.
  - [non-deterministic mutant verdicts under coverageAnalysis=perTest (#6073)](https://github.com/stryker-mutator/stryker-js/issues/6073) — opened 2026-06-22, open — practitioner_forum — "The same mutant flips `Timeout` ↔ `Survived` and `Killed` ↔ `Survived`, and the global status counts swing run-to-run." A minimal repro repo exists. Verified.
  - [Mitigating the Effects of Flaky Tests on Mutation Testing](http://mir.cs.illinois.edu/marinov/publications/ShiETAL19FlakyMutation.pdf) — Shi, Bell, Marinov, ISSTA 2019 — peer_reviewed — "mutation scores vary by four percentage points on average between repeated executions, and 9% of mutant-test pairs have an unknown status"; reruns reduced unknown mutants "by 79.4%" (PIT, 30 projects). Verified.
  - [Remove reliance of TypeScript 6's API for tsconfig file preprocessing (#6111)](https://github.com/stryker-mutator/stryker-js/issues/6111) — opened 2026-07-09, open — practitioner_forum — "We're currently relying on TypeScript 6's API … `ts.parseConfigFileTextToJson`"; alternative: "Wait for TS7's API to be ready (~3 month wait for TS 7.1)". Verified.
  - [Cosmic Ray tutorial](https://github.com/sixty-north/cosmic-ray/blob/master/docs/source/tutorials/intro/index.rst) and [concepts](https://github.com/sixty-north/cosmic-ray/blob/master/docs/source/concepts.rst) — official_docs — baseline command; "the mutant is marked incompetent" on timeout. Verified.
- **Detect:**
  - **Stryker:**
    - List mutants in `reports/mutation/mutation.json` with `status=='Survived' && testsCompleted===0`.
    - Check that the killed count is above 0.
    - Watch the "Ran N tests per mutant" line; 0.00 is a red flag (see #6210).
    - Pin versions: `npm ls vitest typescript @stryker-mutator/core`.
  - **cosmic-ray:** in `cr-report`, INCOMPETENT should be about 0.
  - **cargo-mutants:** the "Unmutated baseline … ok" line must appear.
  - **Single-survivor re-runs:**
    - `stryker run --mutate "src/f.ts:7:10-7:19" --coverageAnalysis off`
    - `cargo mutants -F "<regex>"`
    - `mutmut run "<mutant name>"`
  - Run the covering tests 3 times to rule out flakiness.
- **Tools:** StrykerJS `mutation.json`, cosmic-ray `cr-report`, cargo-mutants, mutmut, PIT.
- **Applies to:** All tools; highest risk in JS/TS (StrykerJS + Vitest 5, TypeScript 7, pnpm) and in flaky suites.
- **When not to apply / counterpoints:** Tool bugs are version-specific and will be fixed, so the pins will age. Re-running every survivor alone adds cost; limit it to survivors that would lead to new tests.
- **Fix risk:** low

### G108-F04 — JS/TS: StrykerJS natively on Windows
**Rule:** Use StrykerJS 10.0.0 with the Vitest or Jest runner, coverageAnalysis `perTest`, the TypeScript checker and line-range `--mutate`. On StrykerJS 10.0.0, pin `vitest@4` and `typescript@6`. Under pnpm, list the plugins explicitly. Mark equivalents with `// Stryker disable next-line <Mutator>: <reason>`.

- **Grade:** B, down from A · **Verdict:** DOWNGRADED
  - The load-bearing version pins (vitest 4, TypeScript 6) rest on open GitHub issues and one local toy run, not on official docs. The official docs cover only perTest, the checker, line ranges and disable comments.
  - The TypeScript-checker quote was also corrected to the docs' actual wording.
- **Rationale:** Local runs (Windows 11, Node 24.13), partly corroborated by the saved artifacts (`package.json` pins vitest ^4.1.11 and typescript ^6.0.3; the report has 24 mutants):
  - 24 mutants / 4 tests took about 36 s.
  - A line-scoped run of 5 mutants took 27 s.
  - Fixed overhead was about 25 s.

  StrykerJS 10 requires Node ≥ 22 and has only experimental TypeScript 7 support in the checker. The core sandbox preprocessor still depends on the TS6 API (#6111).
- **Evidence:**
  - [StrykerJS v10.0.0 release](https://github.com/stryker-mutator/stryker-js/releases/tag/v10.0.0) — Stryker Mutator, 2026-08-14 — official_docs — "Node.js 20 is no longer supported, please use Node.js 22 or higher."; "typescript-checker: add experimental support for TypeScript@7"; "core: save partial incremental report on unexpected exit". Verified.
  - [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/) — official_docs. Verified.
    - "perTest: Only the tests that cover a specific mutant are executed for each mutant" (the default).
    - ignoreStatic: static mutants "come with a big performance penalty".
    - thresholds default `{ high: 80, low: 60, break: null }`.
    - plugins: "By default, all `node_modules` starting with `@stryker-mutator/*` will be loaded".
  - [StrykerJS TypeScript checker](https://stryker-mutator.io/docs/stryker-js/typescript-checker/) — official_docs — "Invalid mutants will be marked as `CompileError`". `prioritizePerformanceOverAccuracy` defaults to `true`: "The accuracy that is lost comes down to having mutants with a status other than `CompileError` while they should have this status." Corrected wording.
  - [StrykerJS: disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/) — official_docs — "// Stryker disable next-line EqualityOperator: The <= mutant results in an equivalent mutant". Verified.
  - [#6210](https://github.com/stryker-mutator/stryker-js/issues/6210) — practitioner_forum — cause: Vitest 5 "testNamePattern Matches Full Chain with `>`"; the runner joins names with a single space. Verified.
- **Detect:**
  - Install: `pnpm add -D @stryker-mutator/core@10.0.0 @stryker-mutator/vitest-runner@10.0.0 @stryker-mutator/typescript-checker@10.0.0 vitest@4 typescript@6`.
  - `stryker.config.json`: `{"plugins":["@stryker-mutator/vitest-runner","@stryker-mutator/typescript-checker"],"testRunner":"vitest","checkers":["typescript"],"coverageAnalysis":"perTest","reporters":["clear-text","json"]}`.
  - Run: `pnpm exec stryker run --mutate "src/calc.ts:6-8"`, then `--incremental`.
  - The declared peer range `vitest >=2.0.0` is wrong for v5.
- **Tools:** StrykerJS 10.0.0, `@stryker-mutator/vitest-runner`, `@stryker-mutator/jest-runner`, `@stryker-mutator/typescript-checker`.
- **Applies to:** JavaScript/TypeScript (Node ≥ 22), Windows native.
- **When not to apply / counterpoints:**
  - The version pins are a 2026-09-23 snapshot. Issues #6210, #6111 and #6213 are open, and the fix PRs #6214/#6220 are unmerged.
  - Karma/Jasmine and command-runner setups are much slower (F11/F14).
  - With about 25 s of fixed overhead, batch the line ranges into one run.
- **Fix risk:** low

### G108-F07 — Go: gremlins in WSL2 or Docker, not natively
**Rule:** Run gremlins v0.6.0 in WSL2 or Docker, not natively on Windows. Use `unleash --diff <ref>` after changes, and `--integration` (or `--coverpkg`) when a package's tests live in other packages. Treat go-mutesting (avito fork v2.3.1) and ooze as alternatives.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Local Docker run (golang:1.25): 6 mutants, 3 boundary survivors. The Windows-native issues are open. By default gremlins runs only the package's own tests.
- **Evidence:**
  - [gremlins unleash](https://gremlins.dev/latest/usage/commands/unleash/) — go-gremlins, 2026 — official_docs. Verified.
    - `--diff`: "Run tests only for mutants inside code changes between current state and git reference (branch or commit)".
    - `--integration`: runs all the tests for each mutation and "is generally much slower".
    - `--threshold-efficacy`: exits "with an error (code 10)".
    - `--dry-run` is documented.
  - [Gremlins is extremely slow on Windows (#81)](https://github.com/go-gremlins/gremlins/issues/81) — opened 2022-07-30, open — practitioner_forum — "up to 17 minutes on my machine, compared to about 40seconds of Linux on the same machine." Verified.
  - [Gremlins can't detect coverage on Windows (#222)](https://github.com/go-gremlins/gremlins/issues/222) — opened 2024-01-05, open — practitioner_forum — "Killed: 0, Lived: 0, Not covered: 551" while `go test ./...` passes. Verified.
  - [go-mutesting (avito-tech)](https://github.com/avito-tech/go-mutesting) — official_docs — "The blacklist feature is currently badly implemented as a change in the original source code will change all checksums." The latest release, v2.3.1, is dated 2025-12-26. Verified.
  - [ooze](https://github.com/gtramontina/ooze) — official_docs — `WithMinimumThreshold` defaults to `1.0`; runs with `go test -v -tags=mutation`; "Ooze supports Go 1.25 and every stable Go release through the current version." Verified.
  - gremlins README: made for "_smallish_ Go modules"; while in 0.x "only the current minor release will be maintained". Verified. v0.6.0 is dated 2025-12-06.
- **Detect:**
  - `docker run --rm -v <proj>:/src golang:1.25 bash -c "go install github.com/go-gremlins/gremlins/cmd/gremlins@v0.6.0 && cd /src && gremlins unleash --diff origin/main"`.
  - Add `--integration` when `go list -test ./...` shows cross-package test importers.
  - Reject runs where "Not covered" is close to the total while `go test -cover` shows coverage.
- **Tools:** gremlins v0.6.0, go-mutesting v2.3.1, ooze, Docker golang:1.25, WSL2.
- **Applies to:** Go modules.
- **When not to apply / counterpoints:**
  - `--integration` multiplies the cost.
  - Google's TSE paper notes Go mutants often fail to compile, because "any unused variables or imported modules produce compiler errors" (verified), so expect "Not viable" counts.
- **Fix risk:** low

### G108-F08 — C/C++: Mull in WSL2 on a clang build
**Rule:** Run Mull 0.34.1 inside WSL2 on a clang build of the project, using `-fpass-plugin=/usr/lib/mull-ir-frontend-<N>` and `mull-runner-<N>`, with `gitDiffRef` for incremental runs. Consider dextool only for Linux CI, and Trail of Bits mewt for source-level C++ mutation. No native Windows or MSVC option was found.

- **Grade:** B · **Verdict:** VERIFIED. Docs and release assets only; none of these tools was run.
- **Rationale:** Mull ships Linux (.deb/.rpm) and macOS packages only and needs a clang build. dextool documents Ubuntu and LLVM ≥ 14. mewt ships only Linux x86_64 and macOS aarch64 installers.
- **Evidence:**
  - [Mull installation](https://mull.readthedocs.io/en/latest/Installation.html) — official_docs — "Precompiled packages (arm64 and x86_64) are available on Cloudsmith and on GitHub"; sections for Linux (deb and rpm) and macOS only. Verified.
  - [Mull 0.34.1 release](https://github.com/mull-project/mull/releases/tag/0.34.1) — 2026-09-13 — official_docs — assets span LLVM 13-21 for Ubuntu, RHEL and macOS, e.g. `Mull-19-0.34.1-LLVM-19.1.7-ubuntu-amd64-26.04.deb`. Notes: "RHEL now targets LLVM 21". There is no Windows asset. Verified.
  - [Mull Hello World](https://mull.readthedocs.io/en/latest/tutorials/HelloWorld.html) — official_docs — `clang-18 -fpass-plugin=/usr/lib/mull-ir-frontend-18 -g -grecord-command-line main.cpp -o hello-world`, then `mull-runner-18 hello-world`. Verified.
  - [dextool README](https://github.com/joakim-brannstrom/dextool) — official_docs. Verified.
    - "**Mutate**: production ready"; "llvm >= 14.0"
    - "`dextool-mutate.o` consume ~9Gbyte"
    - Ubuntu install instructions.
    - v5.3 is dated 2025-09-09; last push 2026-04-20.
  - [mewt README](https://github.com/trailofbits/mewt) — Trail of Bits — official_docs — supports C++, DAML, Go, JavaScript/TypeScript, Rust, Solidity and Move; "Prebuilt installers are currently provided for macOS (aarch64) and Linux (x86_64). Windows is currently unsupported." v4.0.0 is dated 2026-06-18. Verified.
- **Detect:**
  - In WSL2 Ubuntu, install `mull-<N>` from Cloudsmith and rebuild the tests with clang and the pass plugin.
  - Run `mull-runner-<N> ./tests_binary`.
  - Add `gitDiffRef: origin/main` and `gitProjectRoot: .` to `mull.yml` (documented).
  - For MSVC-only projects, record "no mutation tool available; safety net unmeasured".
- **Tools:** Mull 0.34.1, dextool v5.3, mewt v4.0.0, WSL2, clang/LLVM 13-21.
- **Applies to:** C/C++ code that can be built with clang on Linux or macOS.
- **When not to apply / counterpoints:** Per-mutant cost via WSL is unmeasured. mewt also covers Go, Rust, JS/TS and Solidity, but it is Linux/macOS only.
- **Fix risk:** low

### G108-F09 — Solidity: forge --mutate or slither-mutate
**Rule:** Prefer Foundry's `forge test --mutate <file> --mutation-jobs N` (Foundry ≥ 1.8; an opt-in preview; win32 binary available) or slither-mutate 0.11.6, run after `forge clean`. Use Gambit only as a mutant generator behind your own test loop. Do not adopt vertigo-rs.

- **Grade:** B · **Verdict:** CORRECTED
  - Foundry v1.8.0 (2026-08-27) calls mutation testing an "opt-in preview". PR #13091 was merged 2026-06-03.
  - The #16868 stack-overflow crash was fixed by PR #16872 on 2026-09-15, hours after the v1.8.3 release, so the fix is in nightlies, not v1.8.3.
- **Rationale:** Foundry ships native mutation testing with parallel workers and span skipping. slither-mutate runs the revert and comment mutators first and skips minor mutants where those survive. Gambit only generates mutants. vertigo-rs is stale. None of these was run in the session.
- **Evidence:**
  - [feat(forge): mutation testing (PR #13091)](https://github.com/foundry-rs/foundry/pull/13091) — official_docs — "~2.5x speedup observed with 4 workers on 150 mutants (Vault.sol test contract): 4 workers: 15.3s, 1 worker: 37.9s"; "the number of skipped/invalid mutants may vary with worker count"; `--mutation-jobs` is documented. Verified.
  - [Foundry v1.8.0 release](https://github.com/foundry-rs/foundry/releases/tag/v1.8.0) — 2026-08-27 — official_docs — "an opt-in preview of … mutation testing"; mutation testing "is now available through `forge test --mutate`". It also fixed "Windows source-path normalization, and misleading score reporting". Added.
  - [forge test --mutate: worker thread stack overflow (#16868)](https://github.com/foundry-rs/foundry/issues/16868) — practitioner_forum — forge 1.8.1 on aave-v4: "the whole forge process aborts with a Rust stack overflow, losing all in-flight mutation results". Closed 2026-09-16 via PR #16872 "fix(forge): contain mutation test workers". Verified; the status was updated.
  - [Slither-mutate documentation](https://github.com/crytic/slither/blob/master/docs/src/tools/Mutator.md) — Trail of Bits — official_docs — `slither-mutate src --test-cmd='forge test'`; the timeout default is "double the runtime of it's initial test cmd execution"; `--comprehensive`. The source logs "Test suite fails with mutations, aborting". Version 0.11.6 is dated 2026-07-28. Verified.
  - [Gambit README](https://github.com/Certora/gambit) — Certora — official_docs — "Gambit: Mutant Generation for Solidity"; "prebuilt Gambit binaries for Linux x86-64 and Mac … For Windows and Linux ARM, you must build Gambit from source." v1.0.6 is dated 2025-05-08. Verified.
  - [vertigo-rs README](https://github.com/RareSkills/vertigo-rs) — RareSkills — official_docs — "This is an actively maintained fork of Joran Honig's vertigo". The GitHub API shows it was last pushed 2024-09-05 and has 0 releases. Verified.
  - [Foundry v1.8.3 release](https://github.com/foundry-rs/foundry/releases/tag/v1.8.3) — 2026-09-15 — official_docs — asset `foundry_v1.8.3_win32_amd64.zip`. Verified.
- **Detect:**
  - Foundry: `forge --version` ≥ 1.8, then `forge clean && forge test --mutate src/Vault.sol --mutation-jobs 4`.
  - Slither: `pip install slither-analyzer==0.11.6 && slither-mutate src/Vault.sol --test-cmd="forge test --match-contract VaultTest"`.
  - Check the logs for "Test suite fails with mutations, aborting".
  - On 1.8.x releases up to 1.8.3, expect possible whole-run aborts on large contracts.
- **Tools:** Foundry `forge test --mutate`, slither-mutate 0.11.6, Gambit v1.0.6, mewt v4.0.0 (Linux/macOS).
- **Applies to:** Solidity projects using Foundry.
- **When not to apply / counterpoints:**
  - Native-Windows behaviour was not verified.
  - Skipping makes verdicts depend on execution order and worker count; use `--comprehensive` for audit-grade work.
  - "Preview" status means flags may change.
- **Fix risk:** low

### G108-F11 — Pilot the cost before the full run
**Rule:** Estimate the cost with a pilot: T ≈ fixed overhead + (mutants × covering-test runtime) / effective workers. The proposed budget, which is UNVALIDATED:
- Allow max(10 min, 3 × full-suite runtime) per change set.
- If the estimate exceeds that, apply F12 and then F13 before dropping lines from scope, and record what was left unmeasured.

- **Grade:** C (the budget itself is D) · **Verdict:** CORRECTED. StrykerJS #3320 dates from 2021-12-19, not 2022. Its config also used the Jest runner with `coverageAnalysis: "off"` until a commenter suggested perTest; the 150/5,111 figure is from the perTest retry.
- **Rationale:** Per-mutant cost varies by orders of magnitude.
  - About 0.16 s per mutant: Vitest 4, 2,637 mutants in about 7 min (#6210).
  - About 14 s per mutant: CRA/Jest perTest, 150 mutants in 35 min (#3320).
  - About 34 s per mutant: Karma, 426 mutants estimated at 4 h (#5462).

  Google's traditional generation had a median of 820 mutants per changelist (25th-75th percentile 460-1,734). No study validates any time budget.
- **Evidence:**
  - [Why Stryker is so slow? (#3320)](https://github.com/stryker-mutator/stryker-js/issues/3320) — StrykerJS issues, 2021 — practitioner_forum. Verified.
    - "942 unit tests in 73s"
    - "(elapsed: ~35m, remaining: ~19h 39m) 150/5111" … "still not runnable in any pipeline"
    - Maintainer: "Did you try to focus on one file for starters? With `-m src/file/to/mutate.jsx`?"
  - [Stryker is Slow … Karma & Jasmine (#5462)](https://github.com/stryker-mutator/stryker-js/issues/5462) — 2025 — practitioner_forum — "`ng test` execution takes around 25-30 seconds"; "remaining: ~4h 2m" for 426 mutants; still about 3 h after 45 min. Verified.
  - [#6210 baseline timing](https://github.com/stryker-mutator/stryker-js/issues/6210) — practitioner_forum — "about seven minutes" for 2,637 mutants on Vitest 4.1.11. Verified.
  - [Practical Mutation Testing at Scale](https://arxiv.org/abs/2102.11378) — Google, TSE 2022 — peer_reviewed — "820 … 77 … 7"; "25th and 75th percentiles are 460 and 1734". Verified.
  - [Foundry PR #13091](https://github.com/foundry-rs/foundry/pull/13091) — official_docs — 15.3 s vs 37.9 s (4 vs 1 worker). Verified.
  - [gremlins #81](https://github.com/go-gremlins/gremlins/issues/81) — practitioner_forum — 17 min vs about 40 s. Verified.
- **Detect:**
  - Pilot commands:
    - `stryker run --mutate <one file> --dryRunOnly` ("Execute the initial test run only")
    - `cargo mutants --list`
    - `mutmut run "<module>*"`
    - `gremlins unleash --dry-run`
  - Record overhead, mutants per line and seconds per mutant, then extrapolate.
  - Local reference points (toy projects, one machine):
    - StrykerJS: about 25 s of overhead.
    - cargo-mutants: about 1-2 s per mutant.
    - cosmic-ray: about 0.7 s per mutant.
    - mutmut in WSL: about 0.01 s per mutant.
- **Tools:** stryker `--dryRunOnly`, cargo mutants `--list`, gremlins `--dry-run`, time / Measure-Command.
- **Applies to:** Any mutation run by an agent under a wall-clock limit.
- **When not to apply / counterpoints:** The overhead figures come from toy projects. Per-mutant cost scales with how many tests cover each mutant. Parallel speed-ups are sub-linear.
- **Fix risk:** low

### G108-F19 — Killing tests must assert observable, specified behaviour
**Rule:** A test written to kill a survivor must:
- assert externally observable, specified behaviour;
- fail on the mutant;
- pass on the original three times in a row;
- still pass after the planned refactor.

Reject killing tests that assert log text, the call order of collaborators, internal capacities or private state. Label tests that pin current rather than specified behaviour as characterization tests.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Tests written for many killable mutants would be change-detector tests. A change-detector test breaks on any production-code change and has negative value, which blocks a behaviour-preserving refactor. Characterization tests are legitimate, but they do not imply correctness.
- **Evidence:**
  - [Mutation Testing (Google Testing Blog)](https://testing.googleblog.com/2021/04/mutation-testing.html) — Goran Petrović, 2021-04-12 — engineering_blog — "Yes, the tests did not detect these mutants, but we would not want such tests anyway. Many of them would produce fragile, change-detector tests… writing tests for those mutants would make the test suite worse, not better." Verified.
  - [TotT: Change-Detector Tests Considered Harmful](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html) — Alex Eagle, 2015-01-27 — engineering_blog — "it breaks in response to any change to the production code, without verifying correct behavior … Change detectors provide negative value … These tests should be re-written or deleted." Verified.
  - [Practical Mutation Testing at Scale](https://arxiv.org/abs/2102.11378) — Google, TSE 2022 — peer_reviewed — "…would even have a negative impact because their change-detector nature (specifically testing the current implementation rather than the specification) violates testing best practices and causes brittle tests and false alarms." Verified.
  - [Characterization test](https://en.wikipedia.org/wiki/Characterization_test) — Wikipedia (term by Michael Feathers) — other — "protect existing behavior of legacy code against unintended changes via automated testing"; "Golden Master testing does not imply correctness of the results." Verified.
- **Detect:**
  - Review each killing-test diff. Reject it if it:
    - asserts logger or console output;
    - uses only `verify()` / `toHaveBeenCalledTimes` on internal collaborators as the oracle;
    - reads private fields;
    - asserts collection capacity;
    - snapshots internal structures.
  - Apply the refactor on a scratch worktree; the new test must still pass.
- **Tools:** code review checklist, mutation re-run, git worktree.
- **Applies to:** Any test written in response to a surviving mutant.
- **When not to apply / counterpoints:**
  - One TotT commenter argues that interaction assertions can be the practical oracle in service code (verified).
  - Boundary tests (e.g. `isAdult(18)`) are legitimate.
  - The "three passes" rule is a heuristic.
- **Fix risk:** medium

### G108-F21 — Windows execution policy
**Rule:** Run natively only the tools verified to work there: StrykerJS 10, cargo-mutants 27.1 and cosmic-ray 8.7. PIT, Stryker.NET and Infection work there by portability, but that is untested. Run mutmut, Mull, dextool, mewt and gremlins in WSL2 or Docker, with the project in the Linux filesystem. Never report "no survivors" from a tool known to misbehave natively on Windows.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Microsoft recommends Linux-side storage for Linux tools. mutmut refuses to run natively. Mull, mewt and dextool publish no Windows builds. gremlins on Windows is about 25× slower or misses coverage.
- **Evidence:**
  - [Working across file systems (WSL)](https://learn.microsoft.com/en-us/windows/wsl/filesystems) — Microsoft Learn, updated 2026-06-02 — official_docs — "For the fastest performance speed, store your files in the WSL file system if you are working in a Linux command line"; use `/home/<user name>/Project`, not `/mnt/c/Users/<user name>/Project`. Verified.
  - [mutmut README](https://github.com/boxed/mutmut) — official_docs — "…if you want to run on windows, you must run inside WSL." Verified.
  - [mewt README](https://github.com/trailofbits/mewt) — official_docs — "Windows is currently unsupported." Verified.
  - [Gremlins #222](https://github.com/go-gremlins/gremlins/issues/222) — practitioner_forum — "Killed: 0, Lived: 0, Not covered: 551". Verified.
- **Detect:**
  - `wsl -l -v` must show a VERSION 2 distro; check Docker with `docker info`.
  - Copy the project into `~` inside WSL, or `git clone` there.
  - In MSYS/Git Bash, set `MSYS_NO_PATHCONV=1` and use long Windows paths. 8.3 short names broke `wslpath` in the session.
- **Tools:** WSL2, Docker Desktop, Git Bash.
- **Applies to:** Agents working on Windows hosts.
- **When not to apply / counterpoints:** Results must be mapped back to Windows paths. Windows-only behaviour (paths, line endings) is not reproduced in WSL. Foundry v1.8.0 notes a Windows source-path fix, but native Windows remains untested here.
- **Fix risk:** low

## Practitioner voice
- [StrykerJS #6210](https://github.com/stryker-mutator/stryker-js/issues/6210): with StrykerJS 10 and Vitest 5, zero tests run per covered mutant.
  - Score 47.36 → 2.96 (2,637 mutants, 373 tests).
  - Reproductions: 33/3 → 3/33 on Vitest 5.0.0, and 24/2 → 0/26 on 5.0.1.
  - The only visible signal was "Ran 0.00 tests per mutant". The issue is still open.
- [StrykerJS #6213](https://github.com/stryker-mutator/stryker-js/issues/6213): 515 and 546 of 9,475 covered mutants had `testsCompleted == 0`, and all were scored Survived. This happened on Stryker 9.6.1 / Vitest 4.1.4 with a low worker count, and explained an unexplained drop of about 460 kills.
- [StrykerJS #6073](https://github.com/stryker-mutator/stryker-js/issues/6073): under perTest, the same mutant flips Killed↔Survived and Timeout↔Survived between identical runs. A minimal repro repo is provided.
- [StrykerJS #3320](https://github.com/stryker-mutator/stryker-js/issues/3320) (2021): a CRA/Jest project with 942 tests in 73 s had done only 150 of 5,111 mutants after 35 min, with about 19 h 39 m remaining. The maintainer's advice was to focus on one file with `-m`.
- [StrykerJS #5462](https://github.com/stryker-mutator/stryker-js/issues/5462): Angular/Karma, where `ng test` takes 25-30 s. 426 mutants were estimated at about 4 h and still showed about 3 h remaining after 45 min.
- [StrykerJS #4414](https://github.com/stryker-mutator/stryker-js/issues/4414): a user compared PIT (about 30 min) with Stryker (hours). The maintainer explained that the command runner "disables almost all performance enhancements".
- [gremlins #81](https://github.com/go-gremlins/gremlins/issues/81): up to 17 minutes on Windows vs about 40 s on Linux, same machine. Open since 2022.
- [gremlins #222](https://github.com/go-gremlins/gremlins/issues/222): on Windows, "Not covered: 551" and 0 killed even though `go test ./...` passes.
- [mutmut #397](https://github.com/boxed/mutmut/issues/397): native Windows support is still open. `fork()` is a deliberate performance choice, and the windows-support branch lacks timeouts.
- [Foundry #16868](https://github.com/foundry-rs/foundry/issues/16868): `forge test --mutate` on Aave v4 aborted with a Rust stack overflow, "losing all in-flight mutation results". It was fixed by #16872 after v1.8.3.
- [Foundry PR #13091](https://github.com/foundry-rs/foundry/pull/13091): 2.5× speed-up with 4 workers on 150 mutants. The maintainers note that skipped and invalid counts vary with worker count.
- [Google Testing Blog: Mutation Testing](https://testing.googleblog.com/2021/04/mutation-testing.html): the author was overwhelmed by raw mutants, moved to at most one mutant per line (in more than 90% of lines, either all mutants or none were killed), and warns that tests for many mutants would be "fragile, change-detector tests".
- [Trail of Bits: Mutation testing comes to DAML](https://blog.trailofbits.com/2026/07/08/mutation-testing-comes-to-daml/) (Kamil Chmielewski, 2026-07-08): "Test coverage is the most reassuring lie in smart-contract development." Survivors are either harmless (equivalent, or on a branch no execution reaches) or "a to-do list". A past audit's mutation campaign surfaced a high-severity bug that the tests had missed.
- [StrykerJS #6209](https://github.com/stryker-mutator/stryker-js/issues/6209): on Stryker 10.0.0 (Windows, Node 25.9), static mutants are falsely reported as Survived when `testFiles` is set.
- [StrykerJS #6111](https://github.com/stryker-mutator/stryker-js/issues/6111): StrykerJS relies on TypeScript 6 APIs (`ts.parseConfigFileTextToJson`) for sandbox tsconfig preprocessing, so TypeScript 7 breaks runs until this is removed.

## Contradictions and open questions

**Contradictions**
- **Scores vs real faults.** The four studies disagree:
  - Just et al. (FSE 2014): a significant correlation that holds independently of coverage.
  - Papadakis et al. (ICSE 2018): weak once test-suite size is controlled.
  - Chen et al. (ASE 2020): size is neither a confounder nor a variable to manipulate.
  - Chekam et al. (ICSE 2017): the effect appears only at high levels.

  Net: no absolute score threshold is supported.
- **Equivalent-mutant rate.**
  - 2.97% median (Kushigian 2024, Java, Major).
  - ≥ 7% by TCE (C, 2015).
  - "10-15% typical" for rule-based tools (ACH, citing others).
  - 25% trivially equivalent for LLM mutants (ACH).
  - 1.10% rule-based vs 4.74% LLM, weighted (Wang et al. v5).
  - Literature range 2-50% (Gopinath 2015).

  Among survivors the share depends on suite strength.
- **EMS runtime.** Kushigian et al.'s abstract says 325 s for EMS; their Table 6 and conclusion say 1.26 h (4,546 s).
- **Diff scoping.** Google calls changed-line mutation a match for "a developer's unit of work". Ma et al. show that mutants located on the commit correlate weakly with commit-relevant mutants, and that traditional selection loses 50-60% of the relevant ones.
- **Mutant selection.** Zhang et al. find operator-based selection no better than random for score estimation. Google's context-based selection improves the actionability of surfaced mutants. The two measure different goals.
- **LLM tests.** ACH reports 73% acceptance with filters. TestGen-LLM shows only 57% of raw tests pass reliably. Konstantinou et al. find that LLM oracles capture actual rather than expected behaviour.
- **Skipping.** Severity-first skipping (slither-mutate, mewt) and span skipping (Foundry) cut runtime but trade away completeness and determinism.
- **Declared vs real compatibility.** The StrykerJS vitest-runner declares `vitest >=2.0.0`, yet Vitest 5 silently invalidates results.
- **Arid suppression.** Google found it critical, yet admits its most useful heuristics are "unsound" and specific to its own environment.
- **Researcher numbers superseded.** The researcher's Wang et al. figures came from arXiv v4 and have since been superseded by v5. Any skill text should cite the version.

**Open questions**
- No empirical study validates "zero unexplained survivors on lines to be modified" as a refactoring gate, or any time budget per changed line.
- The equivalent-mutant burden on an autonomous agent is unmeasured: time per survivor and the accuracy of its R/I/P arguments. LLM equivalence accuracy has been published only for 2023-2024 models (GPT-4-0613, Llama 3.1 70B).
- WebSearch was exhausted in both the research and verification sessions. Forum threads (Hacker News, Reddit, Lobsters, StackExchange) were not searched; practitioner voice comes from GitHub issues and engineering blogs.
- Native-Windows behaviour is untested for PIT 1.30, Stryker.NET 5.0, Infection 0.35, `forge test --mutate` and slither-mutate. Mull, dextool and mewt were not run at all.
- No mutation tool was found for MSVC-only C/C++.
- Whether mutating only the pre-change lines is enough, or whether callers and callees must also be mutated, has no refactoring-specific evidence.
- How often tool-induced false survivors occur outside StrykerJS/Vitest has not been quantified beyond flaky-test studies.

## Dropped findings
None. Every finding's sources were located and support the core claim. Two individual quotes were removed or replaced rather than dropping their findings:
- The cargo-mutants `/dev/stdin` example (F06) is not in the book.
- The "hot-fork" mutmut mode (F05) does not exist; the second mode is `forkserver`.
