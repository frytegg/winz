# Test suite quality for a hardening pass
> Code T13 · slug test-quality · verified 2026-09-23 · counts: verified 14 / corrected 5 / downgraded 0 / dropped 0

Verification method: every cited URL was opened on 2026-09-23. PDFs were downloaded and the quoted passages located with `pdftotext`. HTML pages were read with `curl` plus text search wherever the WebFetch summariser was ambiguous (it paraphrased two Google TotT quotes wrongly that turned out to be verbatim on the raw page). arXiv metadata came from the arXiv export API, venues from Crossref, HN items from the Algolia/Firebase APIs, Stack Exchange answers from the SE API and the Lobsters thread from its JSON endpoint. Tool versions were checked against PyPI, npm and crates.io, and repo status with `gh api`. WebSearch hit its session budget partway through, so later checks used direct fetches and APIs only.

**Second pass (the same day, after the workflow resumed).** Every source was downloaded again, and every quoted passage was machine-matched against the raw text. The sources covered were:
- all 31 HTML pages and PDFs;
- the arXiv metadata of all 13 arXiv papers;
- the 6 HN items;
- both Stack Exchange threads;
- the Lobsters thread;
- the registry versions;
- the GitHub repository status.

All the quotes matched. This pass made two further precision fixes, both in F10 and F19 (see below). Neither changes a verdict count.

## Summary

What a third-party hardening pass should check in an existing test suite, and what it must never do. The sources are peer-reviewed studies, Google's published testing guidance, official tool docs and practitioner write-ups, all opened during verification.

1. **The tests are the behaviour oracle, so freeze them while production code is hardened.**
   - Take a baseline first: several runs, including one in random order.
   - Never change test code and production code in the same step (F01, F02).

2. **A flaky test is a possible bug report, not noise.**
   - Google measured about 1.5% of test runs as flaky, and almost 16% of its tests showed some flakiness (2016).
   - In 161 categorised flaky-test fix commits from 51 Apache projects (mostly Java), Async Wait accounted for 45% (Luo et al., FSE 2014).
   - Order dependence caused 59% of 7,571 flaky Python tests (Gruber et al., ICST 2021).
   - A July 2026 Buildkite postmortem traced tests dismissed as "flaky" to a use-after-free in the hiredis C extension of the `redis-client` gem.
   - Retries, skips and deletions must not be used to turn the suite green (F03-F05, F18).

3. **Measure how much the suite actually protects; do not assume it.**
   - Use coverage only to find untested code, never as a target (Inozemtseva & Holmes, ICSE 2014; Google; Khorikov).
   - Then look for tests that cannot fail: tests with no assertions, and "pseudo-tested" methods (6-53% of covered methods in most subjects of one workshop study).
   - Then run mutation testing limited to the changed code. At Google, mutants were coupled to 70% of 1,502 high-priority bugs.
   - Chen et al. (ASE 2020) reconcile the coverage-versus-mutation dispute: coverage-guided test selection is as strong as mutation-guided selection until coverage is satisfied, and mutation adds value after that (F06-F08, F15).

4. **Structural test quality.**
   - Test behaviour through public APIs and assert on state, not on calls.
   - Prefer real objects, then fakes, then mocks.
   - Keep test bodies free of branching logic (DAMP).
   - Keep snapshots small (F09-F11, F13).
   - Use test-smell detectors only for triage:
     - On automatically generated suites, one older detector misclassified over 70% of smells.
     - On developer-written suites, several smells were everywhere yet almost never matched a real flaw (Panichella et al., EMSE 2022).
     - When LLMs refactored smells, they sometimes added new ones, and two of the three models often reduced coverage (F12).

5. **Risks specific to AI-written tests, which matter here because the same kind of agent wrote the code.**
   - Coding agents added mocks in 36% of their test commits, against 26% for non-agents, across TS/JS/Python repositories (Hora & Robbes, MSR 2026).
   - LLM-generated oracles tend to capture what the code actually does rather than what it should do (Konstantinou et al., 2024 preprint). Tests written after the code are therefore characterization tests.
   - Following Feathers, keep them as a refactoring safety net, but label them as characterization tests and report any surprising behaviour to a human instead of treating it as the specification.
   - Every new test must be seen to fail against a deliberately broken version of the code (F14, F15).

6. **Scope limits.**
   - Property-based tests pay off where an obvious property exists: round-trip, comparison against a reference implementation, or invariants (Goldstein et al., ICSE 2024).
   - Automatically generalising mature developer tests into property-based tests with one research prototype added only 0.05-0.07 mutation-score points (Teralizer). That is weak evidence about hand-written PBT in mature suites, not proof that PBT adds nothing.
   - The pyramid-versus-trophy debate is largely about what "unit" means. Don't reshape a suite toward either one (F16, F17).
   - Delete tests only with evidence that other tests already provide the same protection (F19).

**Tool versions** confirmed in the registries on 2026-09-23:

| Tool | Version | Note |
|---|---|---|
| pytest | 9.1.1 | 2026-06-19 |
| pytest-randomly | 5.0.0 | |
| diff-cover | 10.6.0 | |
| mutmut | 3.8.0 | needs fork(), so WSL on Windows |
| pytest-rerunfailures | 16.7 | |
| Hypothesis | 6.168.1 | |
| eslint-plugin-jest | 29.16.6 | |
| @vitest/eslint-plugin | 1.6.27 | |
| @stryker-mutator/core | 10.0.0 | |
| fast-check | 4.10.2 | |
| cargo-mutants | 27.1.0 | |
| PMD | 7.27.0 | docs page dated 2026-08-28 |
| Jest | 30.5 | docs |
| Go | 1.27.1 | docs |
| pitest-descartes | 1.3.4 | 2025-09, repo active |

tsDetect (TestSmells/TestSmellDetector) and PyNose (JetBrains-Research/PyNose) are not archived, but they have had no commits since 2022.

## Findings

### T13-F02 — Record a multi-run, random-order baseline before any edit
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** Before any hardening edit, establish a recorded baseline:
  - Run the full suite several times (time-boxed, e.g. 3-10 runs), at least once in randomized order and once with the parallelism CI uses.
  - Record each test's outcome, the collected-test count, runtime and coverage.
  - Never start refactoring on a red or unstable baseline.
  - List any test that is unstable across runs and exclude it as a behaviour oracle until it is triaged (F03).
- **Rationale:** Flakiness is common enough that one green run is not a trustworthy oracle. Most flaky tests are flaky from the day they are written, so a "finished" project probably contains some. Detecting flakiness exhaustively is expensive, so the baseline is a best-effort lower bound, and the report must say so.
- **Evidence:**
  - [Flaky Tests at Google and How We Mitigate Them](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) — John Micco, Google Testing Blog, 27 May 2016 — industry report — "a continual rate of about 1.5% of all test runs reporting a "flaky" result" ... "Almost 16% of our tests have some level of flakiness" ... "about 84% of the transitions we observe from pass to fail involve a flaky test" — verified verbatim on raw HTML.
  - [An Empirical Analysis of Flaky Tests](https://mir.cs.illinois.edu/lamyaa/publications/fse14.pdf) — Luo, Hariri, Eloussi, Marinov (UIUC), FSE 2014 — peer-reviewed — "F.2 Most flaky tests (78%) are flaky the first time they are written." (126 of 161 categorised tests) — verified in the PDF. Scope: 201 commits from 51 Apache projects, mostly Java.
  - [An Empirical Study of Flaky Tests in Python](https://arxiv.org/abs/2101.09077) — Gruber, Lukasczyk, Kroiß, Fraser, ICST 2021 — peer-reviewed — "22352 open source projects ... 876186 test cases ... A 95% confidence that a passing test case is not flaky on average would require 170 reruns." — verified in the arXiv abstract.
  - [Jest CLI Options](https://jestjs.io/docs/cli) — Jest docs (v30.5) — official docs — "--randomize Shuffle the order of the tests within a file. The shuffling is based on the seed." "Seed value is displayed when this option is set." — verified. Note: "only supported using the default jest-circus test runner."
  - [go command documentation](https://pkg.go.dev/cmd/go) — The Go Authors (go1.27.1) — official docs — "-shuffle off,on,N Randomize the execution order of tests and benchmarks. It is off by default." ... "-race enable data race detection." — verified. Any flag outside the cacheable set, including -count and -shuffle, disables the test cache ("The idiomatic way to disable test caching explicitly is to use -count=1"). -race is supported only on some platforms (windows/amd64 among them).
  - [pytest-randomly README](https://github.com/pytest-dev/pytest-randomly) — pytest-dev / Adam Johnson — official docs — "dependent tests do exist in practice" (citing research); disable with `pytest -p no:randomly`; reproduce with `--randomly-seed=<n>` or `--randomly-seed=last` — verified.
- **Detect:**
  - Python: install pytest-randomly 5.0.0, run `pytest` several times, note the printed seed and reproduce with `--randomly-seed`.
  - JS: `jest --randomize` (or `--seed=<n>` to reproduce).
  - Go: `go test -shuffle=on -count=5 -race ./...`.
  - Save the JUnit/JSON report of each run and diff per-test outcomes.
  - Record the collected count with `pytest --collect-only -q`.
- **Tools:** pytest-randomly, jest --randomize, go test -shuffle/-race/-count, JUnit XML reports.
- **Applies to:** Any project with an automated suite. This is the mandatory first step of the pass.
- **When not to apply / counterpoints:**
  - A few reruns cannot prove a test is not flaky: Gruber et al. estimate about 170 reruns for 95% confidence. The baseline is a lower bound.
  - Random order may expose order dependence at once. That becomes a finding to report, not something to fix silently.
  - Very slow E2E suites may allow only one or two runs.
- **Fix risk:** low

### T13-F04 — Remove nondeterminism sources from tests (sleeps, wall clock, unseeded randomness, real I/O in small tests, exact float equality)
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Replace fixed sleeps with waits on the actual condition, or with fake timers.
  - Inject or freeze clocks instead of reading wall time.
  - Seed or inject random generators.
  - Keep real network, disk and external processes out of small or unit tests.
  - Compare floats with tolerances.
  - Do all of this in test-only steps, one test at a time.
- **Rationale:**
  - Luo et al. found Async Wait to be the top cause of flakiness in their sample (45% of 161 commits).
  - About a third of those tests used plain sleeps or timed waits to enforce ordering, and 54% were fixed with an explicit wait (waitFor).
  - Google bans sleeps, I/O and blocking calls in small tests.
  - In Python, network and randomness APIs account for most of the remaining 13% of flaky tests.
- **Evidence:**
  - [An Empirical Analysis of Flaky Tests](https://mir.cs.illinois.edu/lamyaa/publications/fse14.pdf) — Luo et al., FSE 2014 — peer-reviewed — "74 out of 161 (45%) commits are from the Async Wait category" ... "F.4 About third of Async Wait flaky tests (34%) use a simple method call with time delays to enforce orderings" ... "F.8 Many Async Wait flaky tests (54%) are fixed using waitFor" — verified in the PDF.
  - [Software Engineering at Google, Ch. 11: Testing Overview](https://abseil.io/resources/swe-book/html/ch11.html) — Google / O'Reilly, 2020 — book (free online edition) — "The other important constraints on small tests are that they aren't allowed to sleep, perform I/O operations, or make any other blocking calls." — verified.
  - [An Empirical Study of Flaky Tests in Python](https://arxiv.org/abs/2101.09077) — Gruber et al., ICST 2021 — peer-reviewed — "59% of the 7571 flaky tests ... Another 28% were caused by test infrastructure problems ... The remaining 13% can mostly be attributed to the use of network and randomness APIs" — verified.
  - [Flaky tests (pytest docs)](https://docs.pytest.org/en/stable/explanation/flaky.html) — pytest-dev — official docs — "Overly strict assertions can cause problems with floating point comparison as well as timing issues. pytest.approx() is useful here." — verified.
- **Detect:**
  - In test files, search for `Thread.sleep|time.sleep|asyncio.sleep|\bsleep\(|setTimeout\(|Date.now\(|new Date\(\)|datetime.now|time.Now\(|Math.random|random.(random|randint|choice)|requests.(get|post)|fetch\(|http.Get`.
  - Look for exact equality on floats, such as `assertEquals(double, double)` without a delta, or `==` between floats.
  - Cross-reference the hits with the tests that were unstable in the F02 baseline.
- **Tools:** ripgrep, ast-grep, pytest.approx, Jest/Vitest fake timers, clock injection.
- **Applies to:** Unit and integration tests in any language, and especially async, UI and concurrent code.
- **When not to apply / counterpoints:**
  - Tests that exist to check real timing (TTL expiry, rate limits, performance) or real network contracts stay. Label them as larger or integration tests instead.
  - Fake timers and mocked clocks can hide real concurrency bugs that real scheduling would expose.
- **Fix risk:** medium

### T13-F05 — Tests must pass in any order and in isolation; never pin order to hide dependence
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:** When random-order runs expose a failure, fix the isolation: the polluting test's cleanup, the fixture scope, or shared module-level or global state. Never pin the order with ordering plugins or annotations to hide the dependency.
- **Rationale:** Order dependence is the leading cause of flaky tests in Python (59%) and the third category in Luo et al.'s mostly-Java sample (12%). A pinned order keeps a hidden coupling that breaks as soon as tests are parallelised, sharded or filtered.
- **Evidence:**
  - [An Empirical Study of Flaky Tests in Python](https://arxiv.org/abs/2101.09077) — Gruber et al., ICST 2021 — peer-reviewed — "Order dependency is a much more dominant problem in Python, causing 59% of the 7571 flaky tests" — verified.
  - [An Empirical Analysis of Flaky Tests](https://mir.cs.illinois.edu/lamyaa/publications/fse14.pdf) — Luo et al., FSE 2014 — peer-reviewed — "19 out of 161 (12%) commits are from the Test Order Dependency category." The top three categories are Async Wait, Concurrency and Test Order Dependency — verified.
  - [Flaky tests (pytest docs)](https://docs.pytest.org/en/stable/explanation/flaky.html) — pytest-dev — official docs — "reliant on data from a previous test that doesn't clean up after itself" ... "Tests that modify global state typically cannot be run in parallel." It lists pytest-random-order and pytest-randomly — verified.
- **Detect:**
  - Reuse the random-order runs from F02.
  - Run each suspect test alone (`pytest path::test_name`, `go test -run '^TestName$'`, `jest -t 'name'`).
  - Search for ordering pins: `rg -n "pytest\.mark\.order|@TestMethodOrder|@FixMethodOrder|@Order\(|pytest-order"`.
  - Look for module-level mutable state that tests mutate, and for `setUpClass`/`beforeAll`/session fixtures that individual tests write to.
- **Tools:** pytest-randomly, jest --randomize, go test -shuffle, ripgrep.
- **Applies to:** All languages. Most acute in Python and in suites that share DB or filesystem state.
- **When not to apply / counterpoints:**
  - Deliberate scenario sequences should be merged into one test or an explicit sequence rather than left to runner order.
  - Better isolation can slow tests down.
- **Fix risk:** low

### T13-F06 — Coverage is a negative indicator only; gate the diff, not the project
- **Grade:** A · **Verdict:** CORRECTED (Inozemtseva & Holmes were at the University of Waterloo, not UBC. Their "effectiveness" means mutant-detection rate, not real faults, which is now stated. Author order of the Google post fixed.)
- **Rule:**
  - Use line and branch coverage only as a NEGATIVE indicator: to find untested code, prioritised by criticality and change frequency, and to make sure hardening changes do not reduce it.
  - Never add tests only to raise the percentage.
  - Do not introduce a project-wide target above about 90% as part of hardening.
  - Gate the pass's own diff (diff coverage), not the whole project.
- **Rationale:**
  - When suite size is controlled for, coverage correlates only low to moderately with mutant detection, and stronger coverage criteria add no insight.
  - Google publishes 60/75/90% as guidelines, not mandates, says project-wide goals above 90% are probably not worth it, and warns that fixed bars become ceilings.
  - Khorikov: low coverage (below about 60%) is a certain sign of trouble; high coverage means nothing by itself.
- **Evidence:**
  - [Coverage Is Not Strongly Correlated with Test Suite Effectiveness](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf) — Laura Inozemtseva, Reid Holmes (University of Waterloo), ICSE 2014 — peer-reviewed — "we generated 31,000 test suites for five systems consisting of up to 724,000 lines of source code ... there is a low to moderate correlation between coverage and effectiveness when the number of test cases in the suite is controlled for ... stronger forms of coverage do not provide greater insight ... coverage, while useful for identifying under-tested parts of a program, should not be used as a quality target" — verified in the PDF. Effectiveness was measured by mutation testing.
  - [Code Coverage Best Practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html) — Carlos Arguelles, Marko Ivanković, Adam Bender (Google Testing Blog), 7 Aug 2020 — engineering blog — "Although there is no "ideal code coverage number," at Google we offer the general guidelines of 60% as "acceptable", 75% as "commendable" and 90% as "exemplary."" ... "While project wide goals above 90% are most likely not worth it, per-commit coverage goals of 99% are reasonable, and 90% is a good lower threshold." ... "Code coverage does not guarantee that the covered lines or branches have been tested correctly" — verified verbatim on raw HTML.
  - [Code Coverage at Google](https://homes.cs.washington.edu/~rjust/publ/google_coverage_fse_2019.pdf) — Ivanković, Petrović, Just, Fraser, ESEC/FSE 2019 — peer-reviewed — "Google does not enforce any code coverage thresholds across the entire codebase." ... "60% of responses were generally positive towards coverage, 16% were negative, 24% were neutral." — verified in the PDF.
  - [Software Engineering at Google, Ch. 11](https://abseil.io/resources/swe-book/html/ch11.html) — Google / O'Reilly, 2020 — book — "instead of treating 80% like a floor, engineers treat it like a ceiling. Soon, changes begin landing with no more than 80% coverage." — verified.
  - [Unit Testing Principles, Practices, and Patterns, Ch. 1 excerpt](https://enterprisecraftsmanship.com/files/Unit-Testing-Chapter-1-Excerpt.pdf) — Vladimir Khorikov, Manning 2020 — book (free author excerpt) — "coverage metrics are a good negative indicator, but a bad positive one. Low coverage numbers--say, below 60%--are a certain sign of trouble. ... But high numbers don't mean anything." — verified in the PDF.
  - [Write tests. Not too many. Mostly integration.](https://kentcdodds.com/blog/write-tests) — Kent C. Dodds, 13 Jul 2019 — engineering blog — "you get diminishing returns on your tests as the coverage increases much beyond 70% (I made that number up... no science there)" — verified. By his own statement, not evidence.
  - [diff-cover README](https://github.com/Bachmann1234/diff_cover) — Bachmann1234 — official docs — `diff-cover coverage.xml --fail-under=80`; "This will compare the current git branch to origin/main"; `--compare-branch=origin/release` — verified. Version 10.6.0 on PyPI.
- **Detect:**
  - Python: `coverage run --branch -m pytest && coverage report --show-missing --skip-covered && coverage xml`, then `diff-cover coverage.xml --compare-branch=<baseline> --fail-under=90`.
  - Go: `go test -coverprofile=c.out ./... && go tool cover -func=c.out`.
  - JS/TS: `vitest run --coverage` or `jest --coverage`.
  - Java: JaCoCo.
  - Rank uncovered files by churn with `git log --format= --name-only | sort | uniq -c | sort -rn | head -50`.
- **Tools:** coverage.py, diff-cover, go tool cover, vitest/jest --coverage, JaCoCo.
- **Applies to:** All languages, at the start of the pass (to find gaps) and at the end (to check the diff did not regress).
- **When not to apply / counterpoints:**
  - Chen et al. (ASE 2020, with Holmes as co-author) argue that test-set size should be neither treated as a confound nor manipulated by artificial stratification. They find coverage-guided selection "as strong or stronger" than mutation-guided selection "at least until coverage is satisfied". Coverage is therefore a useful guide to where tests are missing, not noise.
  - Walter Bright (HN) reports that coverage correlated with far fewer field bugs in his experience.
  - Google's own per-commit 99% goal shows that high targets on NEW code have defenders.
- **Fix risk:** low

### T13-F07 — Find tests that cannot fail, then pseudo-tested code
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Find and fix tests that cannot fail:
    - tests with no assertion;
    - assertions swallowed by try/catch;
    - conditional assertions that may never run;
    - async assertions that are never awaited or returned;
    - tests that only assert on their own mocks.
  - Then find pseudo-tested code: methods that are covered, but whose body can be replaced by a default or no-op without any test failing.
- **Rationale:**
  - The number of assertions correlates strongly with suite effectiveness.
  - Extreme-mutation studies find pseudo-tested methods in every subject studied.
  - Khorikov documents teams under a 100% coverage mandate wrapping tests in try/catch with no assertions.
- **Evidence:**
  - [Assertions Are Strongly Correlated with Test Suite Effectiveness](https://people.ece.ubc.ca/amesbah/resources/papers/fse15.pdf) — Yucheng Zhang, Ali Mesbah (UBC), ESEC/FSE 2015 — peer-reviewed — "We compose 6,700 test suites in total, using 24,000 assertions of five real-world Java projects. We find that the number of assertions in a test suite strongly correlates with its effectiveness" — verified in the PDF.
  - [Will My Tests Tell Me If I Break This Code?](https://arxiv.org/pdf/1611.07163) — Niedermayr, Juergens, Wagner, CSED'16 workshop (ICSE 2016) — peer-reviewed workshop paper — "ranged between 6% and 53% for most study objects ... The mean ratio was 11.41% for unit tests and 35.48% for system tests." The authors also judge the ratio "acceptable for unit tests but not for system tests" — verified in the PDF.
  - [A Comprehensive Study of Pseudo-tested Methods](https://arxiv.org/abs/1807.05030) — Vera-Pérez, Danglot, Monperrus, Baudry, Empirical Software Engineering (arXiv 2018, journal 2019) — peer-reviewed — "pseudo-tested methods exist in all our subjects" (28K+ methods) ... "for most of them, the developers would not pay the testing price to fix this situation" — verified in the abstract.
  - [Unit Testing Principles, Practices, and Patterns, Ch. 1 excerpt](https://enterprisecraftsmanship.com/files/Unit-Testing-Chapter-1-Excerpt.pdf) — Khorikov, Manning 2020 — book excerpt — "if you wrap all tests with try/catch blocks and don't introduce any assertions in them, those tests are guaranteed to pass. People started to mindlessly create tests for the sake of meeting the mandatory 100% coverage requirement." — verified.
  - [eslint-plugin-jest](https://github.com/jest-community/eslint-plugin-jest) — jest-community — official docs — expect-expect "Enforce assertion to be made in a test body"; no-conditional-expect "Disallow calling `expect` conditionally"; valid-expect-in-promise "Require promises that have expectations in their chain to be valid" — verified in the README rules table (29.16.6 on npm; repo active).
  - [PMD Java Best Practices](https://docs.pmd-code.org/latest/pmd_rules_java_bestpractices.html) — PMD 7.27.0 — official docs — "Unit tests should include at least one assertion." "This rule was named JUnitTestsShouldIncludeAssert before PMD 7.7.0." It has the property `extraAssertMethodNames` — verified.
  - [pitest-descartes](https://github.com/STAMP-project/pitest-descartes) — STAMP project — official docs — "reporting weak spots in covered code" via extreme mutation (pseudo-tested methods) — verified. Latest release 1.3.4 (2025-09); not archived; last push July 2026.
- **Detect:**
  - JS/TS, ESLint with eslint-plugin-jest: `jest/expect-expect`, `jest/valid-expect`, `jest/valid-expect-in-promise`, `jest/no-conditional-expect`.
  - Vitest equivalents in @vitest/eslint-plugin 1.6.27: `vitest/expect-expect`, `vitest/valid-expect`, `vitest/no-conditional-expect`, `vitest/require-awaited-expect-poll` ("ensure that every `expect.poll` call is awaited").
  - Java: PMD `UnitTestShouldIncludeAssert`, with `extraAssertMethodNames` configured for custom assertion helpers.
  - Python:
    - ast-grep for `def test_` functions with no `assert`, no `pytest.raises` and no `self.assert*`;
    - `rg -n "except.*:\s*(pass|\.\.\.)" tests/`.
  - Pseudo-tested code:
    - Java: PIT with the Descartes engine.
    - By hand: replace a covered function body with a default return, run its tests, then revert.
- **Tools:** eslint-plugin-jest, @vitest/eslint-plugin, PMD, ast-grep, PIT + Descartes.
- **Applies to:** All languages. Highest yield in AI-generated or coverage-driven suites.
- **When not to apply / counterpoints:**
  - Intentional smoke tests ("does not throw") are legitimate. Make them explicit (`expect(fn).not.toThrow()`, `assertDoesNotThrow`) rather than deleting them.
  - Custom assertion helpers cause false positives unless they are configured.
  - Niedermayr et al. judged the unit-test pseudo-tested ratio acceptable, and Vera-Pérez et al. found developers often would not pay to fix pseudo-tested methods. Triage by criticality.
- **Fix risk:** low

### T13-F08 — Scoped mutation testing after coverage; survivors are review prompts, not a score to chase
- **Grade:** A · **Verdict:** CORRECTED (the "Practical Mutation Testing at Scale" journal version is IEEE TSE 2022; arXiv 2021. The Stryker quotes come from three separate docs pages, now cited separately. The PIT practitioner quote was softened to its actual wording.)
- **Rule:**
  - Once coverage has done its job, run mutation testing SCOPED to the code the pass touched and to critical modules.
  - Treat each surviving mutant as a review prompt: add a behaviour-level test, or record the mutant as equivalent or unproductive.
  - Do NOT chase a project-wide mutation score.
  - Do NOT write implementation-coupled tests just to kill a mutant.
- **Rationale:**
  - In an analysis of almost 15 million mutants at Google, developers exposed to mutants wrote more tests and improved their suites.
  - For 1,043 of 1,502 high-priority bugs (70%), a fault-coupled mutant would have been reported on the bug-introducing change, and all of those changes were already covered by tests.
  - Chen et al. conclude that mutation-based selection is most effective after coverage has exhausted its usefulness.
  - Google keeps mutation testing practical by mutating only changed code, filtering unproductive mutants and surfacing them in code review.
- **Evidence:**
  - [Does mutation testing improve testing practices?](https://arxiv.org/pdf/2103.07189) — Petrović, Ivanković, Fraser, Just, ICSE 2021 (Crossref: 43rd ICSE, DOI 10.1109/ICSE43902.2021.00087) — peer-reviewed. Verified in the PDF:
    - "RQ3: Mutants are coupled with 70% of high-priority bugs, for which mutation testing would have reported a live, fault-coupled mutant on the bug-introducing change."
    - "each bug-introducing change was covered by the existing tests, suggesting that code coverage had exhausted its usefulness."
    - "we often see both code authors and reviewers pushing back on a mutant because the kind of test that would kill it is considered low quality or even harmful."
    - The paper also explains that Google does not compute a mutation score and reports mutants as test goals.
  - [Revisiting the Relationship Between Fault Detection, Test Adequacy Criteria, and Test Set Size](https://rahul.gopinath.org/resources/ase2020/chen2020revisiting.pdf) — Chen, Gopinath, Tadakamalla, Ernst, Holmes, Fraser, Ammann, Just, ASE 2020 — peer-reviewed — "adequacy-based test selection is superior to random selection and that mutation-based test selection is most effective when employed after coverage has exhausted its usefulness." — verified in the PDF (2,311 Defects4J-derived fault/test-pool combinations; 231 faults in the main comparison).
  - [Practical Mutation Testing at Scale: A view from Google](https://arxiv.org/abs/2102.11378) — Petrović, Ivanković, Fraser, Just, IEEE TSE 2022 (DOI 10.1109/TSE.2021.3107634; arXiv 2021) — peer-reviewed — "Mutation testing is done incrementally, mutating only changed code during code review" ... evaluation with "more than 24,000 developers on more than 1,000 projects" — verified in the abstract.
  - [StrykerJS incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/) — Stryker Mutator — official docs — "When running in --incremental mode, StrykerJS will track the changes you make to your code and tests and only runs mutation testing on the changed code." — verified. Documented limits: changes outside mutated and test files, dependency upgrades, environment variables and snapshot files are not detected.
  - [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/) — Stryker Mutator — official docs — `thresholds` default `{ high: 80, low: 60, break: null }`; `--mutate` accepts globs and line ranges (`"src/app.js:1-11"`) — verified.
  - [Equivalent mutants](https://stryker-mutator.io/docs/mutation-testing-elements/equivalent-mutants/) — Stryker Mutator — official docs — "There is no definitive way for Stryker to find and ignore them." — verified.
  - [cargo-mutants: --in-diff](https://mutants.rs/in-diff.html) — cargo-mutants (Martin Pool) — official docs — "test only mutants that overlap with regions changed in the diff"; caveat: "edits in one region cause code in a different region or a different file to no longer be well tested" — verified. Version 27.1.0 on crates.io.
  - [mutmut documentation](https://mutmut.readthedocs.io/en/latest/) — mutmut — official docs — "Mutmut must be run on a system with fork support. This means that if you want to run on windows, you must run inside WSL." `mutmut run "my_module*"`, `mutmut browse` — verified. Version 3.8.0 on PyPI.
- **Detect:**
  - JS/TS/C#: `npx stryker run --incremental` (StrykerJS 10.0.0), or `--mutate <files or file:lines>` to scope.
  - Python: `mutmut run "pkg.module*"`, then `mutmut browse` (WSL on Windows).
  - Rust: `git diff <base> > d.diff && cargo mutants --in-diff d.diff`.
  - Java: PIT, with Descartes for a cheap first pass.
  - Review each survivor by hand: equivalent or unproductive (e.g. logging) versus a real test gap.
- **Tools:** StrykerJS / Stryker.NET, mutmut, cargo-mutants, PIT, pitest-descartes.
- **Applies to:** Critical business logic and code changed during the pass, in any language with a mutation tool.
- **When not to apply / counterpoints:**
  - Cost: one practitioner reports a roughly 2-minute TS suite taking 20-25 minutes under Stryker.
  - Another team running PIT says "Not sure it's ever found a bug that's likely to happen in prod".
  - Equivalent mutants cannot be detected automatically.
  - Stryker's 80/60 defaults are conventions, not evidence-based thresholds.
  - Diff-scoped runs miss effects on unchanged code (cargo-mutants docs).
  - Google deliberately reports mutants as test goals and computes no score.
- **Fix risk:** low

### T13-F18 — Audit focused, disabled, commented-out and non-strict xfail tests
- **Grade:** A · **Verdict:** VERIFIED (pytest config naming updated for pytest 9)
- **Rule:**
  - A committed focused test (`.only`, `fit`, `fdescribe`) silently turns off the rest of the suite and must be removed first.
  - Every skip or ignore needs a reason and a ticket.
  - Commented-out tests are either restored (and triaged if they fail) or deleted with a justification.
  - Python xfails should be strict so that an unexpectedly passing test is noticed.
- **Rationale:**
  - Focused tests are a local-debugging tool, and the ESLint rule docs say `.only` must be removed so that all tests run on CI.
  - pytest calls non-strict xfail a manual quarantine that is dangerous to keep permanently.
  - Strict mode turns an unexpected pass into a failure, so fixed bugs and stale markers surface.
- **Evidence:**
  - [jest/no-focused-tests](https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/no-focused-tests.md) — jest-community — official docs — the rule "reminds you to remove `.only` from your tests" to "ensure all tests are executed on your build system". It detects `describe.only`, `it.only`, `test.only`, `fdescribe`, `fit` (plus bracket and `.each` variants) — verified.
  - [How to use skip and xfail](https://docs.pytest.org/en/stable/how-to/skipping.html) — pytest-dev — official docs — "Both XFAIL and XPASS don't fail the test suite by default." `@pytest.mark.xfail(strict=True)` "will make XPASS ("unexpectedly passing") results from this test to fail the test suite." The docs now name the ini option `strict_xfail` — verified.
  - [pytest changelog](https://docs.pytest.org/en/stable/changelog.html) — pytest-dev — official docs — pytest 9.0.0 (2025-11-05) "Added strict_xfail as an alias to the xfail_strict option" and added a `strict` option that enables strict_xfail among other checks. Latest is 9.1.1 — verified.
  - [Flaky tests (pytest docs)](https://docs.pytest.org/en/stable/explanation/flaky.html) — pytest-dev — official docs — "like a manual quarantine, and is rather dangerous to use permanently." — verified.
  - [@vitest/eslint-plugin](https://github.com/vitest-dev/eslint-plugin-vitest) — Vitest — official docs — no-focused-tests "disallow focused tests", no-disabled-tests "disallow disabled tests", no-commented-out-tests "disallow commented out tests" — verified (not archived; 1.6.27 on npm).
- **Detect:**
  - `rg -n "\b(describe|it|test)\.only\(|\bfit\(|\bfdescribe\(|\.(skip)\(|\bxit\(|\bxdescribe\(|@Disabled|@Ignore\b|t\.Skip\(|pytest\.mark\.(skip|skipif|xfail)|#\[ignore\]"`.
  - ESLint: `jest/no-focused-tests` (as an error), `jest/no-disabled-tests`, `jest/no-commented-out-tests`, or the `vitest/*` equivalents.
  - pytest: set `strict_xfail = true` (the older name `xfail_strict` still works), or `strict = true` on pytest ≥ 9.
  - Compare the collected test count with the executed count in CI reports.
- **Tools:** ripgrep, eslint-plugin-jest, @vitest/eslint-plugin, pytest strict_xfail / strict mode.
- **Applies to:** All languages and runners.
- **When not to apply / counterpoints:**
  - Platform- or environment-conditional skips (`skipif(sys.platform == 'win32')`, Rust `#[ignore]` for slow tests run separately) are legitimate when they carry a reason.
  - Re-enabling long-disabled tests can turn CI red. Those failures must be triaged (F03), not re-disabled or deleted.
- **Fix risk:** medium

### T13-F01 — Freeze the tests while hardening production code
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Never modify test files and production files in the same step or commit.
  - A behaviour-preserving refactor (dead-code removal, complexity reduction, restructuring) must pass the UNMODIFIED suite.
  - If an existing test must change to accommodate a "refactor", stop and classify:
    - (a) The change alters observable behaviour, so it is not a hardening refactor. Revert it or escalate to the human.
    - (b) The test is coupled to implementation details. Fix it in a separate test-only step with production code untouched: the suite is green before and after, and the rewritten test is shown to still detect faults (F15).
- **Rationale:** The suite is the only automated oracle that says behaviour did not change. Editing the oracle and the subject in one step makes verification circular, because any behaviour change can be absorbed by editing the assertion.
- **Evidence:**
  - [Software Engineering at Google, Ch. 12: Unit Testing](https://abseil.io/resources/swe-book/html/ch12.html) — Google / O'Reilly, 2020 — book (free online edition) — "Tests that need to be changed during a refactoring indicate that either the change is affecting the system's behavior and isn't a pure refactoring, or that the tests were not written at an appropriate level of abstraction." — verified.
  - [Definition Of Refactoring](https://martinfowler.com/bliki/DefinitionOfRefactoring.html) — Martin Fowler, 1 Sep 2004 — engineering blog — "a change made to the internal structure of software to make it easier to understand and cheaper to modify without changing its observable behavior." — verified.
  - [Testing on the Toilet: Test Behavior, Not Implementation](https://testing.googleblog.com/2013/08/testing-on-toilet-test-behavior-not.html) — Andrew Trenk, Google Testing Blog, 5 Aug 2013 — engineering blog — "None of the existing tests should need to change since you only changed the code's implementation, but its user-facing behavior didn't change." — verified verbatim on raw HTML (the WebFetch summary had misreported it). The same post: "test setup may need to change if the implementation changes (e.g. if you change your class to take a new dependency in its constructor...)".
- **Detect:**
  - Per commit on the hardening branch, run `git log --name-only --format='--%h' <base>..HEAD` and flag any commit that mixes test paths (tests/, test/, src/test/, *_test.go, *.test.ts, *.spec.*, test_*.py) with non-test source paths.
  - For each production-only step, `git diff --quiet <step-base> -- <test globs>` must succeed.
  - The collected-test count must be identical before and after: `pytest --collect-only -q | tail -1`, `go test -list . ./...` (top-level tests only), `jest --listTests` (file count).
- **Tools:** git, pytest --collect-only, go test -list, jest --listTests.
- **Applies to:** All languages. Every refactor, dead-code, complexity or dependency step of the pass.
- **When not to apply / counterpoints:**
  - Deliberate public-API changes (renames, parameter objects) need mechanical test updates. Put those in their own commit and review them as API changes.
  - Test setup can legitimately change when a constructor gains a dependency, even though assertions should not (Trenk 2013).
  - The rule follows from the definition of refactoring and from canonical guidance, not from a controlled experiment.
- **Fix risk:** low

### T13-F03 — Flaky means "unresolved defect report"; no silent retries, skips or deletions
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Never turn the suite green by any of these:
    - adding retries or reruns;
    - raising timeouts;
    - skipping or marking xfail(strict=False);
    - deleting a flaky test.
  - The only exception is when the pass has:
    - (a) classified the root cause (async wait, concurrency, order dependency, time, network, randomness, resource leak, infrastructure);
    - (b) ruled out a production bug;
    - (c) recorded a tracked ticket.
  - Quarantine is allowed only as an explicit, tracked, time-boxed state, never as the fix.
- **Rationale:**
  - Quarantine and reruns hide real bugs, and teams learn to ignore red builds.
  - Google says quarantining "could easily mask a real race condition", and that developers have dismissed legitimate failures as flakes.
  - Buildkite's "flaky" feature tests were caused by a use-after-free in the hiredis C extension, and the fix changed production configuration.
  - pytest calls non-strict xfail a manual quarantine that is dangerous to use permanently.
  - Uber credits tickets carrying the right information with reversing the growth of unstable tests.
- **Evidence:**
  - [Flaky Tests at Google and How We Mitigate Them](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) — John Micco, 2016 — industry report — "Quarantining removes the test from the critical path and files a bug for developers to reduce the flakiness. This prevents it from becoming a problem for developers, but could easily mask a real race condition or some other bug in the code being tested." ... "In some cases, developers dismiss a failing result as flaky only to later realize that it was a legitimate failure caused by the code." — verified verbatim. The same post lists re-runs as a presubmit mitigation.
  - [How a flaky test exposed a Redis client use-after-free](https://buildkite.engineering/how-a-flaky-test-exposed-a-redis-use-after-free/) — Patrick Robinson, Buildkite, 3 Jul 2026 — incident report — "these tests were so flaky they were preventing us deploying code to production ... we worked to exclude the tests from our suite temporarily" ... "Rian disabled using the C extension for Redis connections in test, development and production, and developed a reproducible test case that was reported upstream." — verified verbatim. The root cause was a hiredis use-after-free in the `redis-client` gem, confirmed with AddressSanitizer.
  - [Flaky tests (pytest docs)](https://docs.pytest.org/en/stable/explanation/flaky.html) — pytest-dev — official docs — non-strict xfail "could be considered like a manual quarantine, and is rather dangerous to use permanently." — verified.
  - [Flaky Tests Overhaul at Uber](https://www.uber.com/blog/flaky-tests-overhaul/) — Xiaoyang Tan, Sergey Balabanov, Yushan Lin (Uber), 4 Jun 2024 — engineering blog — "around 1000 flaky tests out of 600K in total" (Go monorepo), "1K/350K" (Java) ... "Nagging developers with Jira tickets containing the right information helped tremendously to reverse the trend of an ever-growing number of unstable tests." — verified.
- **Detect:**
  - Search tests and CI config: `rg -n "@pytest\.mark\.flaky|--reruns|reruns=|jest\.retryTimes|retries:|@RepeatedTest|@Disabled|@Ignore|t\.Skip\(|\bit\.skip|\bxit\(|xfail\("`.
  - Diff the pass's own changes for any added retry, timeout increase or skip.
  - Every unstable test from F02 needs a root-cause category (Luo et al.'s taxonomy).
- **Tools:** ripgrep, pytest-rerunfailures (detect its config; 16.7 current), CI config review.
- **Applies to:** All suites, and especially integration/E2E and concurrent code.
- **When not to apply / counterpoints:**
  - Automatic reruns and quarantine are standard, documented mitigations at Google and Uber.
  - Temporarily excluding a test to unblock main is legitimate (Buildkite did it). The rule forbids hiding a test without a record, not quarantine itself.
- **Fix risk:** medium

### T13-F09 — Test via public API and observable state; flag change-detector tests
- **Grade:** B · **Verdict:** VERIFIED (Khorikov post dated 15 Apr 2020, previously "undated")
- **Rule:**
  - Tests should exercise the system through its public API and assert on observable state or outputs, not on internal call sequences.
  - Flag "change-detector" tests: tests that mirror the implementation (verify-in-order of internal collaborators, reach into private members) and fail on any refactor without checking behaviour.
  - Rewrite them in a separate test-only step (F01).
  - Keep interaction checks only where the interaction IS the behaviour, e.g. an email sent or a message published.
- **Rationale:** Google calls change-detector tests negative value. Implementation-coupled tests break during pure refactors, which are exactly the false alarms a hardening pass would trigger.
- **Evidence:**
  - [TotT: Change-Detector Tests Considered Harmful](https://testing.googleblog.com/2015/01/testing-on-toilet-change-detector-tests.html) — Alex Eagle, Google Testing Blog, 27 Jan 2015 — engineering blog — "it breaks in response to any change to the production code, without verifying correct behavior of either the original or modified production code. Change detectors provide negative value, since the tests do not catch any defects, and the added maintenance cost slows down development." — verified verbatim on raw HTML.
  - [Software Engineering at Google, Ch. 12](https://abseil.io/resources/swe-book/html/ch12.html) — Google / O'Reilly, 2020 — book — TL;DRs: "Strive for unchanging tests. Test via public APIs. Test state, not interactions. ... Test behaviors, not methods." — verified.
  - [Software Engineering at Google, Ch. 13: Test Doubles](https://abseil.io/resources/swe-book/html/ch13.html) — Google / O'Reilly, 2020 — book — "Some people at Google jokingly refer to tests that overuse interaction testing as change-detector tests because they fail in response to any change to the production code, even if the behavior of the system under test remains unchanged." — verified.
  - [When to Mock](https://enterprisecraftsmanship.com/posts/when-to-mock/) — Vladimir Khorikov, 15 Apr 2020 — engineering blog — "Communications with managed dependencies are implementation details; communications with unmanaged dependencies are part of your system's observable behavior." — verified.
- **Detect:**
  - Per test file, count interaction verifications (`verify(`, `InOrder`, `toHaveBeenCalled`, `toHaveBeenCalledWith`, `assert_called`, `assert_called_once_with`, `EXPECT_CALL`) against state assertions.
  - Flag tests where interaction checks dominate and the mocked collaborators are in-process classes of the same codebase.
  - Flag private access from tests: `setAccessible(true)`, `@VisibleForTesting`, `obj._private` in Python, `(x as any).privateField` or `// @ts-expect-error` for private members in TS.
- **Tools:** ripgrep, ast-grep, the mock APIs of Mockito, unittest.mock and Jest (as patterns).
- **Applies to:** Unit tests in OO and service code, in any language.
- **When not to apply / counterpoints:**
  - The mockist (London) school deliberately tests interactions, and SWE ch13 names this "mockist testing".
  - SWE ch13 allows interaction testing when real or fake implementations are infeasible, and when call counts matter (e.g. verifying a cache reduces DB calls).
  - Rewrites can lose coverage. Verify them with F15 or mutation testing.
- **Fix risk:** medium

### T13-F10 — Reduce over-mocking; prefer real, then library-owner fakes, then a wrapper you own
- **Grade:** B · **Verdict:** CORRECTED (the Google TotT preference order is real implementation, then a fake ideally provided by the library owner, and only then a wrapper you own that you mock. The earlier clause "test the adapter against the real library" is NOT in the source: a commenter on the post asks how to test the wrapper and gets no answer. It is kept only as an explicitly unsourced suggestion. The Hora & Robbes scope is TypeScript/JavaScript/Python repositories. Second pass: the researcher's "almost only as plain 'mock' doubles (95%)" overstated exclusivity. Agents also used spies (33%) and fakes (32%); the finding is lower diversity, not mocks-only.) (audit correction: the 36%-vs-28% figure is the per-repository median for the 179 repositories with higher agentic activity, at least 50 agent commits and 10 test commits, Cliff's delta 0.252 small; the 282 lower-activity repositories gave 27% vs 24%, "statistically significant, but not meaningful".)
- **Rule:**
  - Prefer real implementations, then fakes, then stubs or mocks.
  - Mock only out-of-process dependencies whose interactions are externally observable (SMTP, message bus, third-party APIs).
  - For types you don't own:
    - use the real implementation, or a fake provided by the library owner;
    - only if neither is feasible, wrap the type in your own thin class and mock or fake that wrapper.
  - (Unsourced suggestion: cover the wrapper with an integration test against the real library.)
  - Flag tests where stubbing setup outweighs the assertions.
- **Rationale:**
  - Google found that overusing mocking frameworks "had a tendency to pollute tests with repetitive code that got out of sync with the real implementation and made refactoring difficult".
  - Mocks of third-party types hard-code API expectations that go stale on library upgrades and can let tests pass while the code has a bug.
  - Coding agents add mocks more often than non-agents: 36% of their test commits against 26% overall. Within repositories, the per-repository medians were 36% against 28% for the 179 repositories with higher agentic activity (at least 50 agent commits and 10 test commits; Cliff's delta 0.252, small), and 27% against 24% for the 282 lower-activity repositories, a difference the paper calls "statistically significant, but not meaningful" (Cliff's delta 0.002). Agents also use a narrower range of test doubles. The plain "mock" type appears in 95% of agent mock commits, against spy 33% and fake 32%; non-agents use mock 91%, fake 57% and spy 51%. This matters when the same kind of agent wrote the code.
- **Evidence:**
  - [Software Engineering at Google, Ch. 13](https://abseil.io/resources/swe-book/html/ch13.html) — Google / O'Reilly, 2020 — book — "A real implementation should be preferred over a test double." "A fake is often the ideal solution if a real implementation can't be used in a test." "Overuse of stubbing leads to tests that are unclear and brittle." "A test that requires many functions to be stubbed can be a sign that stubbing is being overused, or that the system under test is too complex and should be refactored." Also: "overuse of mocking frameworks had a tendency to pollute tests with repetitive code that got out of sync with the real implementation and made refactoring difficult." — all verified.
  - [TotT: Don't Mock Types You Don't Own](https://testing.googleblog.com/2020/07/testing-on-toilet-dont-mock-types-you.html) — Andrew Trenk, Stefan Kennedy, Google Testing Blog, 16 Jul 2020 — engineering blog. Verified verbatim on raw HTML:
    - "Mocking types you don't own can make maintenance more difficult".
    - "Instead of using a mock, use the real implementation, or if that's not feasible, use a fake implementation that is ideally provided by the library owner."
    - "If you can't use the real implementation and a fake implementation doesn't exist (and library owners aren't able to create one), create a wrapper class that calls the type, and mock this instead."
  - [When to Mock](https://enterprisecraftsmanship.com/posts/when-to-mock/) — Vladimir Khorikov, 15 Apr 2020 — engineering blog — "Only unmanaged dependencies should be replaced with mocks. Use real instances of managed dependencies in tests." — verified.
  - [Are Coding Agents Generating Over-Mocked Tests? An Empirical Study](https://arxiv.org/html/2602.00409v1) — Andre Hora, Romain Robbes, MSR 2026 — peer-reviewed — "over 1.2 million commits made in 2025 in 2,168 TypeScript, JavaScript, and Python repositories" ... "36% of commits made by coding agents add mocks to tests, compared with 26% by non-agents". The body clarifies the denominator: "36% of test commits made by coding agents add mocks to test code, compared with 26% of test commits made by non-agents" (3,934 of 11,035 agent test commits); non-agents "26% (i.e., 40,966 out of 158,326)". The 36% vs 28% figure is the per-repository median for the 179 repositories with higher agentic activity ("at least 50 agent commits and at least 10 test commits", Cliff's delta 0.252, small); the 282 lower-activity repositories gave 27% vs 24%, "statistically significant, but not meaningful" (Cliff's delta 0.002). DOI 10.1145/3793302.3793362. Agent mock commits: "mock type (95%), followed by spy (33%) and fake (32%)"; non-agents: "mock (91%), fake (57%), and spy (51%)" — verified in the arXiv HTML.
- **Detect:**
  - Search for `rg -n "jest\.mock\(|vi\.mock\(|mock\.patch\(|@patch\(|Mockito\.mock\(|@Mock\b|gomock|mockall"` and check what is being mocked.
  - Candidates:
    - third-party packages (`axios`, `requests.`, AWS/Stripe SDK types);
    - the project's own DB or repository in integration tests.
  - Compare stub/mock setup lines with the number of assertions per test.
  - Flag tests where every collaborator is mocked.
- **Tools:** ripgrep, ast-grep, Testcontainers or in-memory fakes (as replacements).
- **Applies to:** Service, backend and SDK-integration code in any language; any suite written largely by coding agents.
- **When not to apply / counterpoints:**
  - Real dependencies and containers slow tests down and can add flakiness: large tests flake more (F17).
  - Some cloud or payment APIs have no usable fake.
  - The mockist school considers heavy mocking a legitimate design style.
  - An SE answer calls realistic temporary test environments "a heresy" in some circles.
  - A commenter on the TotT post notes that wrapping only moves the upgrade problem into the wrapper.
  - Replacing mocks changes which failures a test can detect, so check the new version against the baseline.
- **Fix risk:** medium

### T13-F11 — Straight-line, DAMP test bodies; one behaviour per test
- **Grade:** B · **Verdict:** VERIFIED (counterpoint added from Panichella et al. 2022)
- **Rule:**
  - Keep test bodies free of branching logic and cleverness.
  - Prefer DAMP (Descriptive And Meaningful Phrases) over DRY: a reader must understand a test without leaving its body.
  - Split tests that check several unrelated behaviours of one method into one test per behaviour, named after that behaviour.
  - Table-driven and parameterised tests are fine: the loop belongs to the framework, not to hand-written branching.
- **Rationale:**
  - Tests have no tests of their own, so they must be obviously correct.
  - Spadini et al. link smelly tests to change- and defect-proneness, and link smelly tests to more defect-prone production code.
  - Hora & Zaidman found 44 "method-obsessed" tests in the Python standard library that could be split into 118 focused tests.
- **Evidence:**
  - [Software Engineering at Google, Ch. 12](https://abseil.io/resources/swe-book/html/ch12.html) — Google / O'Reilly, 2020 — book — "stick to straight-line code over clever logic" ... "A little bit of duplication is OK in tests so long as that duplication makes the test simpler and clearer" ... "DAMP is not a replacement for DRY; it is complementary to it" — verified.
  - [TotT: Tests Too DRY? Make Them DAMP!](https://testing.googleblog.com/2019/12/testing-on-toilet-tests-too-dry-make.html) — Derek Snyder, Erik Kuefler, Google Testing Blog, 3 Dec 2019 — engineering blog — "When writing unit tests and faced with a choice between the DRY and DAMP principles, lean more heavily toward DAMP." — verified.
  - [On The Relation of Test Smells to Software Code Quality](https://research.tudelft.nl/en/publications/on-the-relation-of-test-smells-to-software-code-quality) — Spadini, Palomba, Zaidman, Bruntink, Bacchelli, ICSME 2018 — peer-reviewed — "221 releases of ten software systems ... more than a million test cases ... (i) tests with smells are more change- and defect-prone, (ii) 'Indirect Testing', 'Eager Test', and 'Assertion Roulette' are the most significant smells for change-proneness and, (iii) production code is more defect-prone when tested by smelly tests" — verified.
  - [Test Behaviors, Not Methods! Detecting Tests Obsessed by Methods](https://arxiv.org/abs/2602.00761) — Andre Hora, Andy Zaidman, ICPC 2026 — peer-reviewed — 2,054 tests from 12 Python stdlib suites: "We detect 44 Tests Obsessed by Methods ... Each smelly test verifies a median of two behaviors ... could be split into 118 novel tests ... 23% of the smelly tests have code comments recognizing that distinct behaviors are being tested." — verified in the arXiv abstract.
  - [eslint-plugin-jest](https://github.com/jest-community/eslint-plugin-jest) — jest-community — official docs — no-conditional-in-test "Disallow conditional logic in tests" — verified.
- **Detect:**
  - ESLint: `jest/no-conditional-in-test` / `vitest/no-conditional-in-test`.
  - ast-grep for `if`/`for`/`while`/`try` inside `def test_*`, `it(...)`, `test(...)`, `@Test` bodies. Exclude framework parameterisation (`@pytest.mark.parametrize`, `test.each`, Go table-driven `for _, tc := range tests`).
  - Flag tests named after methods (`testProcess`, `test_calculate`) that contain several act/assert phases.
  - Flag assertion-heavy tests that have no failure messages (Assertion Roulette).
- **Tools:** eslint-plugin-jest, @vitest/eslint-plugin, ast-grep, tsDetect (Java; see F12 caveats).
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - On the DAMP TotT post, one commenter "was surprised to find the majority of commenters disagreed with the DAMP approach"; others defend DAMP for readability when a test fails.
  - Google itself says DAMP complements DRY.
  - Splitting tests increases their number and setup cost.
  - Panichella et al. (EMSE 2022) found several smells "ubiquitous on developer-written tests but virtually never correlated with semantic or maintainability flaws", so smell-based refactoring should be driven by an observed cost.
- **Fix risk:** low

### T13-F12 — Test-smell detectors are triage only; never bulk auto-refactor smells
- **Grade:** B · **Verdict:** CORRECTED (the "over 70% misclassified" figure is limited to automatically generated suites (EvoSuite/JTExpert) in Panichella et al. The same paper's finding on developer-written tests, that several smells were everywhere yet almost never matched a real flaw, was added. The claim that detectors "disagree strongly with reality outside their own benchmarks" was narrowed. Both reference tools have had no commits since 2022, which is now noted.)
- **Rule:**
  - Use test-smell detectors (tsDetect, PyNose, lint rules) only for TRIAGE.
  - Confirm every reported smell by hand against its actual cost (flakiness, change-proneness, readability) before touching it.
  - Never bulk auto-refactor smells, by tool or LLM, without re-running coverage and mutation checks on the refactored tests.
- **Rationale:**
  - tsDetect reports 96% precision and 97% recall on its own 65-file benchmark.
  - An independent hand-labelled re-evaluation found that current smell definitions are "highly mismatched to real concerns":
    - several smells were everywhere in developer-written tests but "virtually never correlated with semantic or maintainability flaws";
    - on generated suites, the older tool misclassified over 70% of smells.
  - Developers call detector warnings overly strict and rate individual smells low-severity, while still acknowledging long-term maintenance costs.
  - LLM smell refactoring sometimes introduced new smells, and two of three models often reduced coverage.
- **Evidence:**
  - [Test Smells 20 Years Later: Detectability, Validity, and Reliability](https://research.tudelft.nl/en/publications/test-smells-20-years-later-detectability-validity-and-reliability/) — A. Panichella, S. Panichella, Fraser, Sawant, Hellendoorn, Empirical Software Engineering 27(7), 2022 — peer-reviewed — verified in the TU Delft abstract:
    - "developers perceive warnings raised by detection tools as overly strict and non-representative of the maintainability and quality of test suites".
    - "multiple smells were ubiquitous on developer-written tests but virtually never correlated with semantic or maintainability flaws".
    - "Current test smell detection strategies poorly characterized the issues in these automatically generated test suites; in particular, the older tool's detection strategies misclassified over 70% of test smells".
  - [tsDetect: An Open Source Test Smells Detection Tool](https://2020.esec-fse.org/details/esecfse-2020-tool-demos/4/tsDetect-An-Open-Source-Test-Smells-Detection-Tool) — Peruma, Almalki, Newman, Mkaouer, Ouni, Palomba, ESEC/FSE 2020 Tool Demos — peer-reviewed — "a benchmark of 65 unit test files containing instances of 19 test smell types ... average precision score of 96% and an average recall score of 97%" — verified. The TestSmells/TestSmellDetector repo was last pushed in 2022-10.
  - [Developers perception on the severity of test smells: an empirical study](https://arxiv.org/abs/2107.13902) — Campos, Rocha, Machado, 2021 — arXiv (14 pages; published venue not confirmed) — "most of the interviewed developers considered the test smells as having a low severity to their code, they indicated that test smells might negatively impact the project, particularly in test code maintainability and evolution." — verified. Six projects, interviews only.
  - [Evaluating LLMs Effectiveness in Detecting and Correcting Test Smells](https://arxiv.org/abs/2506.07594) — Santana et al., 2025 — preprint — GPT-4-Turbo, LLaMA 3 70B, Gemini-1.5 Pro with PyNose/tsDetect: "All models could refactor smells, but effectiveness varied, sometimes introducing new smells. Gemini also improved test coverage, unlike GPT-4 and LLaMA, which often reduced it." — verified. The models tested are now older generations.
- **Detect:**
  - Run tsDetect (Java) or PyNose (Python) plus the lint rules from F07 and F11.
  - For every flagged test, record a manual verdict: true smell with a cost, or false positive.
  - Before and after any smell refactor: the same collected-test count, no coverage drop (`diff-cover`), and no newly surviving mutants in the scoped mutation run (F08).
- **Tools:** tsDetect, PyNose (both unmaintained since 2022), eslint-plugin-jest, @vitest/eslint-plugin, diff-cover, a mutation tool.
- **Applies to:** Any suite; especially large legacy or AI-generated suites with hundreds of detector warnings.
- **When not to apply / counterpoints:** Spadini et al. (ICSME 2018) do link certain smells (Indirect Testing, Eager Test, Assertion Roulette) to change- and defect-proneness, so smells are not purely cosmetic. The dispute is about detector accuracy and whether particular smells matter, not about whether test design matters at all.
- **Fix risk:** medium

### T13-F13 — Keep snapshot/golden tests small and reviewed; never bulk-update to go green
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Flag large snapshots (more than a few dozen lines) and, where possible, convert them to explicit assertions on the properties that matter.
  - Never regenerate or update snapshots (`jest -u`, approval "accept all") to make the suite green during a hardening pass.
  - A snapshot that changes during a refactor is a behaviour change to investigate.
- **Rationale:** Jest's docs say snapshots are committed and reviewed like code, and warn against regenerating them instead of investigating failures. Kent C. Dodds describes a 640-line snapshot that nobody reviewed and that was simply retaken on every change.
- **Evidence:**
  - [Snapshot Testing](https://jestjs.io/docs/snapshot-testing) — Jest docs — official docs — "Commit snapshots and review them as part of your regular code review process." ... "fight against the habit of regenerating snapshots when test suites fail instead of examining the root causes of their failure." ... "Ensure that your snapshots are readable by keeping them focused, short" — verified.
  - [Effective Snapshot Testing](https://kentcdodds.com/blog/effective-snapshot-testing) — Kent C. Dodds, 30 Oct 2017 — engineering blog — "When your snapshot is more than a few dozen lines it's going to suffer major maintenance issues" ... "a snapshot that's over 640 lines long. Nobody reviews it" ... "even huge snapshots aren't entirely useless" — verified.
  - [eslint-plugin-jest](https://github.com/jest-community/eslint-plugin-jest) — jest-community — official docs — no-large-snapshots "Disallow large snapshots"; no-interpolation-in-snapshots "Disallow string interpolation inside snapshots" — verified.
- **Detect:**
  - ESLint `jest/no-large-snapshots` (set `maxSize`).
  - `find . -name '*.snap' -exec wc -l {} + | sort -n | tail`.
  - `git log --stat -- '*.snap' '**/__snapshots__/**'` to find commits that only rewrote snapshots.
  - In the pass itself, forbid `-u`/`--updateSnapshot` (Jest: "re-record every snapshot that fails") and running without `--ci` in automation.
- **Tools:** eslint-plugin-jest, git, wc/find.
- **Applies to:** JS/TS UI and serializer tests; golden-file and approval tests in any language.
- **When not to apply / counterpoints:**
  - Dodds notes that huge snapshots can still flag changes with unexpectedly wide impact.
  - Golden-master tests are a recognised characterization technique for legacy code (F14).
  - Converting snapshots can drop incidental checks, so prefer narrowing a snapshot to deleting it.
- **Fix risk:** medium

### T13-F14 — Tests written after the code are characterization tests: label them, keep them as a safety net, report surprises
- **Grade:** B · **Verdict:** CORRECTED (the earlier rule told the agent to leave surprising behaviour "unasserted or marked as a known issue". That contradicts the cited source: Feathers advises that "if you haven't determined that the behavior you've uncovered is a bug, it's often a good idea to leave the test in place." For a behaviour-preserving pass, pinning current behaviour is exactly what is needed. The rule now keeps the pin, labels it, and escalates the surprise. Also added: Konstantinou et al. find LLM oracles still beat EvoSuite's at detecting faults; the Ouedraogo study covers older LLMs and is TOSEM-accepted, July 2026.)
- **Rule:**
  - Treat any test written after the code, including tests generated by an LLM or agent during the pass, as a CHARACTERIZATION test: it records what the code does, not what it should do.
  - Label such tests (name, docstring or tag) so they are never read as a specification.
  - Keep them asserting current behaviour, because that is the safety net for refactoring.
  - When writing one surfaces surprising behaviour (odd edge-case output, a swallowed error, an off-by-one):
    - add it to a "suspected bugs" list in the pass report for a human to decide;
    - do not "fix" the behaviour inside the hardening pass;
    - do not present the assertion as the intended specification.
- **Rationale:**
  - A 2024 controlled study found LLM-generated oracles tend to capture actual rather than expected behaviour, the same weakness as Randoop and EvoSuite.
  - Feathers' characterization tests are valuable precisely because they freeze current behaviour, but whether that behaviour is correct depends on context the code alone does not give.
  - LLM-generated suites also show typical smells (Assertion Roulette, Magic Number Test).
- **Evidence:**
  - [Do LLMs generate test oracles that capture the actual or the expected program behaviour?](https://arxiv.org/abs/2410.21136) — Konstantinou, Degiovanni, Papadakis, 2024 — preprint (controlled experiment, 24 Java repositories) — "LLM-based test generation approaches are also prone on generating oracles that capture the actual program behaviour rather than the expected one." Also: "LLM-generated test oracles have higher fault detection potential than the Evosuite ones." — verified in the arXiv abstract.
  - [Characterization Testing](https://michaelfeathers.silvrback.com/characterization-testing) — Michael Feathers, 8 Aug 2016 — engineering blog — "When you write characterization tests, you often discover behavior you weren't aware of. ... if you haven't determined that the behavior you've uncovered is a bug, it's often a good idea to leave the test in place. ... The purpose of characterization testing is to document your system's actual behavior, not check for the behavior you wish your system had." — verified verbatim on raw HTML. The previously cited "The context determines whether this is or isn't correct behavior." is also on the page.
  - [On the Diffusion of Test Smells in LLM-Generated Unit Tests](https://arxiv.org/abs/2410.10628) — Ouédraogo, Li, Dang, Tang, Koyuncu, Klein, Lo, Bissyandé — accepted at TOSEM (31 Jul 2026) — peer-reviewed — "20,505 class-level suites from four LLMs (GPT-3.5, GPT-4, Mistral 7B, Mixtral 8x7B) ... 779,585 human-written tests from 34,635 open-source Java projects ... LLM-generated tests consistently manifest smells such as Assertion Roulette and Magic Number Test" — verified. It uses tsDetect and JNose, so the F12 detector caveats apply.
  - [Improving AI-generated tests using mutation testing](https://blog.senko.net/improving-ai-generated-tests-using-mutation-testing) — Senko Rašić, 22 Mar 2026 — engineering blog — "a certain percentage of tests written will invariably be tautological" — verified. Single practitioner, single project.
- **Detect:**
  - For each new test, check where its expected value came from:
    - a spec, docs, domain rule or independent calculation (specification test);
    - or copied from running the code (characterization test).
  - Grep new tests for literals that exactly match printed outputs.
  - Grep for assertions only on mock return values: a tautology where the system under test returns what the stub was told to return.
  - Keep a "suspicious behaviour" list in the pass report.
- **Tools:** manual review, git diff of added tests, a mutation tool (F08) to detect tautologies.
- **Applies to:** Every test added by the pass; any AI-generated suite being audited.
- **When not to apply / counterpoints:**
  - For legacy refactoring, freezing current behaviour (bugs included) is exactly what Feathers recommends: change the structure first and fix behaviour deliberately later.
  - The danger is only when characterization tests are later read as a specification.
  - Evidence that LLMs struggle to tell actual from expected behaviour comes from a preprint.
- **Fix risk:** medium

### T13-F15 — Every added or rewritten test must be seen to fail
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Every test added or rewritten during the pass must be seen to FAIL at least once:
    - temporarily break the production behaviour it claims to protect (flip a condition, drop a statement, change a constant, or run a scoped mutation tool);
    - confirm the test fails for the right reason;
    - restore the code.
  - Do this in a scratch worktree or stash so production code cannot be left modified.
  - A test that cannot be made to fail is removed or rewritten, not kept for coverage.
- **Rationale:**
  - A passing test proves nothing about its ability to detect faults.
  - Seemann argues that seeing a test fail is what makes testing an application of the scientific method, and that without it AI-generated tests are "ceremony".
  - In one practitioner experiment, an AI-written suite at 98% coverage caught 30 of 40 AI-designed "realistic" injected bugs.
  - Google recommends mutation testing to check that covered lines are actually asserted.
- **Evidence:**
  - [AI-generated tests as ceremony](https://blog.ploeh.dk/2026/01/26/ai-generated-tests-as-ceremony/) — Mark Seemann, 26 Jan 2026 — engineering blog — "seeing a test fail is an example of the scientific method" ... "even a proper review may fail to unearth problems, such as tautological assertions" — verified.
  - [Improving AI-generated tests using mutation testing](https://blog.senko.net/improving-ai-generated-tests-using-mutation-testing) — Senko Rašić, 22 Mar 2026 — engineering blog — "98% test coverage" ... "30/40 mutations caught (75%)". The mutations were designed by a separate AI session told "do not look at the tests" — verified. One project (Pingu), one run.
  - [Code Coverage Best Practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html) — Arguelles, Ivanković, Bender, Google, 2020 — engineering blog — "A better technique to assess whether you're adequately exercising the lines your tests cover, and adequately asserting on failures, is mutation testing." — verified.
  - [Does mutation testing improve testing practices?](https://arxiv.org/pdf/2103.07189) — Petrović et al., ICSE 2021 — peer-reviewed — "Any surviving mutant that is not detected by the test suite constitutes a concrete test goal, pointing out possible ways to improve the test suite." — verified in the PDF.
- **Detect:**
  - Process check in the pass log: for each added test ID, a recorded red run against a named deliberate fault, then a green run after restoring.
  - Automated alternative: `npx stryker run --mutate <file>`, `mutmut run "module.func*"` or `cargo mutants --in-diff`, scoped to the code under the new test. The new test must kill at least one relevant mutant.
  - Afterwards, `git status` must show production files clean.
- **Tools:** git worktree / git stash, StrykerJS, mutmut, cargo-mutants, PIT.
- **Applies to:** All tests created or modified by the pass, in any language.
- **When not to apply / counterpoints:**
  - It costs time, and some tests (contract, smoke, infrastructure) are hard to break locally.
  - If no change is observable, that may mean the code is dead (link to the dead-code findings).
  - The Seemann and Rašić pieces are practitioner reasoning and a single anecdote. The "see it fail" discipline itself has no controlled study behind it; the Google mutation evidence supports the principle indirectly.
- **Fix risk:** low

### T13-F16 — Property-based tests only where a high-leverage property is obvious
- **Grade:** B · **Verdict:** VERIFIED (the summary's overgeneralisation of Teralizer is corrected; the finding's own wording was already accurate)
- **Rule:**
  - Add property-based tests (Hypothesis, fast-check, proptest, jqwik) opportunistically, only where a high-leverage property is obvious:
    - round-trips (parse/print, encode/decode, serialize/deserialize);
    - differential or model-based checks against a simpler reference implementation;
    - invariants;
    - "never crashes" on valid input.
  - Check that a new property can fail (F15).
  - Do not derive properties by reading the implementation.
- **Rationale:**
  - In 30 interviews at Jane Street, PBT was used mainly when "you have a really good abstraction with a complicated implementation". Differential (17/30) and round-trip (11/30) properties were the most common.
  - The weaknesses were the effort of writing generators and developers not interrogating properties that find no bugs.
  - An LLM-agent workshop study found real bugs in popular Python packages with PBT.
  - Automatically generalising mature developer unit tests into PBTs with one Java prototype added almost no mutation score.
- **Evidence:**
  - [Property-Based Testing in Practice](https://harrisongoldste.in/papers/icse24-pbt-in-practice.pdf) — Goldstein, Cutler, Dickstein (Jane Street), Pierce, Head, ICSE 2024 — peer-reviewed — "30 in-depth interviews" ... "Differential Properties (17/30)" ... "Round-Trip Properties (11/30)" ... "[PBT is] most useful when. . . you have a really good abstraction with a complicated implementation." ... "OB6 Developers may not interrogate properties that do not find bugs" — verified in the PDF. Scope: one firm, mostly OCaml.
  - [Agentic Property-Based Testing: Finding Bugs Across the Python Ecosystem](https://arxiv.org/abs/2510.09907) — Maaz, DeVoe, Hatfield-Dodds, Carlini — NeurIPS 2025 DL4Code workshop (4-page main text) — workshop paper — "100 popular Python packages ... 56% were valid bugs and 32% were valid bugs that we would report ... We reported 5 bugs, 4 with patches, including to NumPy ..., with 3 patches merged" — verified.
  - [Teralizer](https://arxiv.org/abs/2512.14475) — Glock, Bauer, Pinzger, 2025 — preprint — "On EvoSuite-generated tests ... improved mutation scores by 1-4 percentage points. Generalization of mature developer-written tests ... showed only 0.05-0.07 percentage points improvement ... only 1.7% of projects completed the generalization pipeline" — verified. This measures one automated, implementation-derived generalisation tool, not hand-written properties.
- **Detect:**
  - Round-trip candidates: `rg -n "def (to|from)_(json|dict|bytes)|serialize|deserialize|encode|decode|parse|format|dump|load"`.
  - Differential candidates: functions with an `_fast`/`_optimized` twin, or a legacy implementation being replaced.
  - Invariant candidates: pure functions over collections, numbers or money (sum preserved, sorted output, idempotence).
  - Check that existing properties run with enough examples and that a mutation run shows they kill mutants.
- **Tools:** Hypothesis 6.168.1 (Python), fast-check 4.10.2 (JS/TS), proptest (Rust), jqwik (Java), a mutation tool.
- **Applies to:** Parsers, serializers, codecs, numeric and financial calculations, data-structure code, optimised algorithms with a reference version.
- **When not to apply / counterpoints:**
  - Generators are costly to write and maintain.
  - Properties derived from the implementation can be tautological.
  - Randomized tests add nondeterminism unless seeds and example databases are managed (F04).
  - Goldstein et al. cite a Dropbox experience report in which timing dependence made PBT tests flaky.
- **Fix risk:** low

### T13-F17 — Don't reshape the suite toward a pyramid/trophy ratio; act only on demonstrated problems
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:**
  - Don't restructure the test portfolio toward a pyramid, trophy or honeycomb ratio as part of hardening.
  - Judge each test by speed, determinism and clarity of failure, and act only on demonstrated problems:
    - move a logic check down to the smallest test that can express it when a large test is flaky or slow for that check;
    - add a narrow integration test where only mocked unit tests cover a real integration seam.
  - Never delete end-to-end tests to "fix the shape".
- **Rationale:**
  - Fowler shows the pyramid-versus-trophy debate is largely about what "unit" means, and quotes Justin Searls calling the percentage debate a distraction.
  - Google's 80/15/5 mix is "a very rough guideline".
  - Google measured flakiness rising with test size (0.5% small, 1.6% medium, 14% large), a measurable reason to push logic checks down.
- **Evidence:**
  - [On the Diverse And Fantastical Shapes of Testing](https://martinfowler.com/articles/2021-test-shapes.html) — Martin Fowler, 2 Jun 2021 — engineering blog — Searls: "People love debating what percentage of which type of tests to write, but it's a distraction. Nearly zero teams write expressive tests that establish clear boundaries, run quickly & reliably, and only fail for useful reasons. Focus on that instead." Fowler: "it's not clear what people see as the difference between unit and integration tests." — verified.
  - [Software Engineering at Google, Ch. 11](https://abseil.io/resources/swe-book/html/ch11.html) — Google / O'Reilly, 2020 — book — "As a very rough guideline, we tend to aim to have a mix of around 80% of our tests being narrow-scoped unit tests ...; 15% medium-scoped integration tests ...; and 5% end-to-end tests" ... ice cream cone: "Such suites tend to be slow, unreliable, and difficult to work with." — verified.
  - [Where do our flaky tests come from?](https://testing.googleblog.com/2017/04/where-do-our-flaky-tests-come-from.html) — Jeff Listfield, Google Testing Blog, 17 Apr 2017 — industry report — "Over the course of a week, 0.5% of our small tests were flaky, 1.6% of our medium tests were flaky, and 14% of our large tests were flaky" ... "Overwhelmingly, the larger the test (as measured by binary size, RAM use, or number of libraries built), the more likely it is to be flaky." — verified verbatim on raw HTML. The author adds that "correlation is not causation" regarding tool-specific (WebDriver, emulator) flakiness.
  - [Write tests. Not too many. Mostly integration.](https://kentcdodds.com/blog/write-tests) — Kent C. Dodds, 13 Jul 2019 — engineering blog — title phrase quoting Guillermo Rauch — verified.
- **Detect:**
  - Classify tests by what they touch (process, network, disk, DB, browser).
  - Measure runtime: `pytest --durations=25`, `go test -json ./... | jq` on Elapsed, JUnit XML times.
  - Cross with the F02 instability data. The actionable signals are:
    - (a) slow or flaky large tests that assert fine-grained logic;
    - (b) integration seams covered only by mocked tests.
- **Tools:** pytest --durations, go test -json, JUnit XML reports.
- **Applies to:** Whole-suite review at the start of the pass.
- **When not to apply / counterpoints:**
  - Trophy and honeycomb advocates argue integration tests give more confidence per test; pyramid advocates argue unit tests are faster and more deterministic.
  - No controlled study settles the ideal ratio. The consensus is only that ratios themselves are not the goal.
- **Fix risk:** high

### T13-F19 — Delete a test only with evidence that its protection is subsumed
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:**
  - Delete a test only with evidence that it adds no protection:
    - it tests removed code; or
    - its coverage and killed-mutant set are fully subsumed by other tests.
  - Never delete a test because it fails, is flaky or is hard to read. Fix or triage it instead.
  - Put test deletions in their own commit, with the evidence in the message.
- **Rationale:**
  - Tests have upkeep costs, and low-value tests can have near-zero or negative net value, so pruning is legitimate.
  - Deletion removes the oracle, and teams have dismissed legitimate failures as flakes.
  - The asymmetry justifies requiring positive evidence before deleting.
- **Evidence:**
  - [Unit Testing Principles, Practices, and Patterns, Ch. 1 excerpt](https://enterprisecraftsmanship.com/files/Unit-Testing-Chapter-1-Excerpt.pdf) — Khorikov, Manning 2020 — book excerpt — "It's easy to create tests whose net value is close to zero or even is negative due to high maintenance costs." ... "keep in the suite only the tests whose value exceeds their upkeep costs by a good margin." ... "Code is a liability, not an asset." — verified in the PDF.
  - [Flaky tests (pytest docs)](https://docs.pytest.org/en/stable/explanation/flaky.html) — pytest-dev — official docs — "If the functionality is covered by other tests, perhaps the test can be removed. If not, perhaps it can be rewritten at a lower level..." — verified.
  - [Flaky Tests at Google and How We Mitigate Them](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html) — John Micco, 2016 — industry report — "In some cases, developers dismiss a failing result as flaky only to later realize that it was a legitimate failure caused by the code." — verified.
- **Detect:** For a deletion candidate:
  1. Per-test coverage contexts: coverage.py `[run] dynamic_context = test_function`, or pytest-cov `--cov-context=test`, then `coverage html --show-contexts`. Show that every line the test covers is also covered by another test. (`dynamic_context` and `--show-contexts` are verified in the [coverage.py contexts docs](https://coverage.readthedocs.io/en/latest/contexts.html). The exact `--cov-context=test` value is verified in the [pytest-cov contexts docs](https://pytest-cov.readthedocs.io/en/latest/contexts.html): "record coverage data for each test individually, with the --cov-context=test option".)
  2. A scoped mutation run with and without the test: the killed-mutant set must not shrink.
  3. `git log -S '<tested symbol>'` to confirm the tested code was removed.
  4. Reject any deletion whose commit also touches production code (F01).
- **Tools:** coverage.py contexts, a mutation tool, git log -S.
- **Applies to:** Duplicated, obsolete or tautological tests found during the pass; tests of code removed as dead.
- **When not to apply / counterpoints:**
  - The evidence bar costs effort. For obviously tautological tests (asserting that a stub returns its stubbed value), a manual review plus one mutation check is enough.
  - An HN commenter argues that "some dumb little test that you thought was a waste of time" pays off years later on heavily modified code.
  - No empirical study of test-deletion outcomes was found.
- **Fix risk:** medium

## Practitioner voice

- [HN: comment in "The tragedy of 100% code coverage" thread](https://news.ycombinator.com/item?id=14297530) — comment by flukus (2017) in the thread [14297289](https://news.ycombinator.com/item?id=14297289) (534 points, 340 comments): "You can get 100% line coverage and never have a single assert."
- [HN: Walter Bright on coverage](https://news.ycombinator.com/item?id=14298337) — Dissent in the same thread: "in my experience, code covering unit tests have correlated strongly with faster development and far fewer bugs being uncovered in the field". Metrics become useless when people "work the metric".
- [HN: dumb little tests pay off later](https://news.ycombinator.com/item?id=14297924) — Unit tests don't catch much while code is fresh, but "when it's five years old with many modifications ... some dumb little test that you thought was a waste of time is now alerting you to what would have been a horror regression."
- [HN: Stryker cost vs value](https://news.ycombinator.com/item?id=26044356) — Comment on the "Mutation Driven Testing" thread (2021): a TS suite that runs in "2 minutes or so takes about 20-25 with Stryker - but it has definitely found things that our tests weren't really covering".
- [HN: PIT in a scheduled job](https://news.ycombinator.com/item?id=26045186) — "Not sure it's ever found a bug that's likely to happen in prod but definitely gives us a confidence boost".
- [Buildkite: flaky test exposed a use-after-free](https://buildkite.engineering/how-a-flaky-test-exposed-a-redis-use-after-free/) — July 2026. Feature tests dismissed as flaky blocked deploys and were temporarily excluded. The cause was a hiredis use-after-free in the `redis-client` gem, and the fix disabled the C extension in test, development AND production.
- [Uber: Flaky Tests Overhaul](https://www.uber.com/blog/flaky-tests-overhaul/) — 2024. About 1K flaky tests of 600K in the Go monorepo, and 1K of 350K in Java. Tests are classified as unstable from history windows, and Jira tickets "containing the right information" reversed the growth.
- [SE: getting flaky tests fixed after mitigation](https://softwareengineering.stackexchange.com/questions/448510/how-to-get-flaky-tests-fixed-after-having-mitigated-their-flakiness) — The accepted answer recommends a dashboard that sorts tests by failure count. A 16-vote answer says that once the quick fix removed the urgency, management "stopped caring". A lower-voted answer notes that a retry-until-green strategy masks timing, race and memory-corruption bugs.
- [SE: brittle tests from excessive mocking](https://softwareengineering.stackexchange.com/questions/189805/brittle-unit-tests-due-to-need-for-excessive-mocking) — Accepted answer: test pre- and post-conditions, not internal calls; "Hard to write tests don't get written. Fragile tests don't get believed." The second answer calls realistic temporary test environments "a heresy on my part".
- [Senko Rašić: AI-generated tests and mutation testing](https://blog.senko.net/improving-ai-generated-tests-using-mutation-testing) — 2026. Some AI-written tests were tautological. After cleanup the suite reached 98% coverage but caught 30 of 40 AI-designed "realistic" injected bugs (75%), with mutations designed by a separate session told not to read the tests.
- [Mark Seemann: AI-generated tests as ceremony](https://blog.ploeh.dk/2026/01/26/ai-generated-tests-as-ceremony/) — 2026. Tests never seen to fail are "tests as ceremony"; "That all tests pass is hardly a useful criterion"; review can miss tautological assertions.
- [Kent C. Dodds: Effective Snapshot Testing](https://kentcdodds.com/blog/effective-snapshot-testing) — A 640-line snapshot that nobody reviews and that gets retaken on every change.
- [Google TotT DAMP post, comments](https://testing.googleblog.com/2019/12/testing-on-toilet-tests-too-dry-make.html) — One commenter "was surprised to find the majority of commenters disagreed with the DAMP approach". Others defend DAMP for readability at failure time.
- [Lobsters: Chen et al. ASE 2020 discussion](https://lobste.rs/s/nh6rku) — Commenter vrthra (who refers to Gopinath's coverage paper as "my own paper", consistent with co-author Rahul Gopinath) frames the long coverage-versus-mutation controversy. Derek Jones criticises the lack of downloadable data and weak statistics in SE testing research.

## Contradictions and open questions

**Contradictions**

- **Coverage and effectiveness.**
  - Inozemtseva & Holmes (ICSE 2014): only low to moderate correlation with mutant detection once suite size is controlled; advise against coverage targets.
  - Gopinath et al. (ICSE 2014, as summarised in Chen et al.): statement coverage correlated strongly with mutant detection.
  - Chen et al. (ASE 2020, with Holmes as co-author): coverage-guided selection is as strong as mutation-guided selection until coverage is satisfied, and mutation adds value after that.
  - Practical reconciliation: coverage finds untested code; mutation judges tested code.
- **Coverage thresholds.**
  - Google publishes 60/75/90% guidelines and endorses 99% per-commit goals.
  - Its SWE book and Khorikov warn that any fixed bar becomes a ceiling or gets gamed.
  - Dodds' "70%" is, in his own words, made up.
  - No empirical study supports a specific project-wide number.
- **Test smells.**
  - tsDetect reports 96%/97% precision/recall on its own 65-file benchmark.
  - Spadini et al. (ICSME 2018) link several smells to change- and defect-proneness.
  - Panichella et al. (EMSE 2022) found several smells on developer-written tests "virtually never correlated with semantic or maintainability flaws", and >70% misclassification by the older detector on generated suites.
  - The disagreement is real, not just about tool accuracy.
- **Flaky test handling.**
  - Google and Uber use automatic reruns and quarantine as standard mitigation.
  - The same Google post, pytest's docs, the Buildkite 2026 postmortem and SE practitioners show that quarantine and non-strict xfail can hide real product bugs and turn into permanent neglect.
- **Characterization tests.**
  - Feathers: keep tests that pin surprising current behaviour until it is shown to be a bug.
  - Konstantinou et al.: LLM oracles pin actual rather than expected behaviour, which is a defect when the tests are read as specifications.
  - Both hold. The resolution (F14) is to keep, label and escalate.
- **Test portfolio shape.**
  - Google SWE book: roughly 80/15/5, avoid the ice-cream cone.
  - Dodds: "mostly integration".
  - Fowler: the dispute is largely about definitions (solitary vs sociable unit tests).
- **Mocking.**
  - Google (classical style) prefers real implementations and fakes; Khorikov says mock only unmanaged out-of-process dependencies.
  - The mockist/London school deliberately uses interaction-based tests.
  - Agent-generated tests lean heavily toward mocks.
- **DAMP vs DRY.** Google's TotT and SWE book favour DAMP; many commenters on that very post preferred DRY with parameterised tests.
- **Value of mutation testing.**
  - Google data: mutants coupled to 70% of high-priority bugs, and better tests written.
  - Some practitioners report no production bugs found and a roughly 10x runtime cost.
  - Teralizer shows negligible mutation-score gains when automatically generalising mature developer tests into PBTs.

**Open questions**

- **Mutation-score threshold.** There is no empirical basis for a specific mutation-score threshold. Stryker's defaults (80/60) are conventions, and Google deliberately computes no score. What should a hardening pass report as "good enough"?
- **Baseline reruns.** How many reruns are enough for a time-boxed baseline? Gruber et al. estimate about 170 for 95% confidence, which is impractical. The best sampling strategy for a one-off pass (random order, parallel, stress, CPU throttling) is not established.
- **Agent test review.** How reliably can an AI hardening agent tell characterization tests from specification tests, and spot tautological assertions? The evidence (Konstantinou 2024 preprint; Santana 2025 preprint, older models) says LLMs struggle, but no study evaluates a full review-and-repair workflow.
- **Tooling by language.**
  - Mutation-tool maturity differs by language: mutmut needs fork() (WSL on Windows), and Go and C++ mutation tooling were not verified here.
  - The reference test-smell detectors (tsDetect, PyNose) have not been updated since 2022.
- **Test deletion.** There is no empirical study of what happens after test deletion or pruning (F19).
- **PBT in mature suites.** Evidence that hand-written property-based tests add value to MATURE application suites is thin. Teralizer measures only automated generalisation, and Goldstein et al. is one firm (mostly OCaml).
- **Missing sources.** Reddit (HTTP 403 for the researcher) and SonarSource rule pages were not reached, so r/ExperiencedDevs voices and SonarQube rule ids (assertion-less tests, Thread.sleep in tests, skipped tests) are missing. WebSearch was also exhausted during verification, so no replacement was sought.

## Dropped findings

None. All 19 findings survived. Five were corrected (F06, F08, F10, F12, F14); none needed downgrading or dropping.
