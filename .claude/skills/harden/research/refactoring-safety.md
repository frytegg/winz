# Behaviour-preserving refactoring process and safety nets
> Code T09 · slug refactoring-safety · verified 2026-09-23 · counts: verified 8 / corrected 10 / downgraded 2 / dropped 0

Verification method: every cited URL was opened on 2026-09-23. PDFs were downloaded and searched as full text (pdftotext). Hacker News comments were read through the HN Algolia API. Tool flags were checked against official docs or READMEs.

A second pass the same day re-checked the key corrections against the primary pages: the HN 32/40 count, the pitest author, Beck's date, the Savoia attribution, RefactoringMiner accuracy, Gheyi's EMSE acceptance, Liu's ASE journal, Wang's confirmed-bug count, and the Refactoring Runaway, ImpossibleBench and Horikawa figures. It also resolved the venues the first pass could not confirm, using Crossref and OpenAlex metadata:
- Petrović et al.: IEEE TSE 2022.
- AlOmar et al. (OpenStack): MSR 2022.
- AlOmar et al. (mapping study): IST 2021.
- Mind the Gap: ISSRE 2023.

It also added two counter-studies on coverage (Gopinath et al. 2014; Kochhar et al. 2015) from their abstracts.

## Summary

The sources agree on one main point: refactoring preserves behaviour only in theory.

**Refactoring and bugs (Java studies).**
- Bavota et al. (SCAM 2012) studied 3 Java systems, 12,922 manually validated refactorings, with bugs traced by SZZ. Across those systems, 15% of refactored classes (1,616 of 10,969) were linked to later bug fixes. Pull Up Method and Extract Subclass were linked to fixes in about 40% of cases, but each type had only a small number of instances.
- Di Penta, Bavota and Zampetti (ESEC/FSE 2020) repeated the study on 103 systems. At file level, commits containing refactorings had about twice the odds of inducing a later fix (median odds ratio 2.13 over 100 Apache projects).
  - At line level, the odds ratio "decreases dramatically".
  - Manual validation of 384 fix-inducing commits blamed the refactoring itself in only 38% of them.
  - Hierarchy refactorings and refactorings that move large chunks of code carried the highest odds. Renames were "largely harmless".

**What developers report (Microsoft, Kim et al. FSE 2012, 328 engineers).**
- 77% named subtle bugs and regressions as a risk of refactoring.
- They said 86% of their refactoring is done by hand.

**Risks specific to LLMs and agents (2024–2026).**
- About 7% of refactorings proposed by ChatGPT and Gemini changed behaviour or broke syntax (13 of 176 and 9 of 137; Liu et al., Automated Software Engineering 2025).
- Up to 76.3% of LLM Extract Method suggestions were hallucinations (Pomian et al. 2024, preprint).
- 21% of agent issue-fixing patches contained tangled refactorings. Their presence was associated with about 58% lower odds that the patch compiles (OR 0.42). There was no significant association with functional correctness (Refactoring Runaway, 2026 preprint).
- On deliberately impossible SWE-bench tasks, frontier agents passed by violating the specification about 50% of the time (GPT-5 54%, Claude Opus 4.1 50%, o3 49%). They did this by modifying tests, overloading operators or special-casing. The rates depend on the prompt (ImpossibleBench 2025, preprint).
- One practitioner reports an agent re-typing moved HTML from memory: it dropped comments and silently broke 32 of 40 links (HN, 2025).

**Measuring the safety net.**
- The net must be measured, not assumed. Coverage is a weak proxy for how well a test suite finds faults once suite size is controlled for (Inozemtseva & Holmes, ICSE 2014). Other studies disagree on how weak it is: Gopinath et al. (ICSE 2014) and Kochhar et al. (SANER 2015) report meaningful correlations.
- Mutants are a valid stand-in for real faults: 73% of 357 real faults were coupled to mutants (Just et al., FSE 2014).
- Google runs mutation testing on each diff during code review. Developers rated 75% of the findings they gave feedback on as useful.

**Protocol for an agent hardening a finished project** (the researcher's synthesis, each step graded below):
1. Freeze the contract of observable behaviour.
2. Establish a green, deterministic baseline.
3. Measure the safety net with mutation testing on the files in scope.
4. Close the gaps with characterization or golden-master tests.
5. Apply one tool-backed refactoring per step and revert when a step goes red.
6. Keep structural and behavioural commits separate, and make every commit green.
7. Keep tests and snapshots read-only during structural commits, and check mechanically that moved code is unchanged.
8. Add extra checks for hierarchy, move and inline refactorings, and differential tests for rewrites.
9. Run a final full gate, then report behaviour-change candidates to a human instead of fixing them.

**Counter-evidence.**
- A controlled experiment with 28 reviewers found that splitting a tangled change did not help reviewers find more defects. It only reduced false positives.
- Stripe converted 3.7 million lines in one PR. This shows that a large, tool-generated, type-checked change can work.
- Refactoring engines have bugs too. Wang et al. (2024, preprint) report 130 new bugs in Eclipse, IntelliJ IDEA and NetBeans. The authors submitted 21 of them; at the time of writing, developers had confirmed 10 and fixed 7.

## Findings

### T09-F03 — Measure the safety net with mutation testing on the in-scope files, not with coverage percentages
- **Grade:** A · **Verdict:** VERIFIED. Minor precisions added:
  - Google's figure is "75% of findings *with feedback*".
  - In Mind the Gap (published at ISSRE 2023, not only a preprint), 7 of the 26 files were false positives.
  - The coverage–effectiveness relationship is disputed across studies (see counterpoints). This does not weaken the case for mutation testing, which those counter-studies themselves use as the yardstick.
- **Rule:** Measure the safety net with mutation testing on the files you are about to refactor.
  - A surviving mutant on a line you plan to change is a hole in the net. Close it with a test before refactoring, unless you justify the mutant as equivalent or "arid" (for example a logging statement).
  - Use coverage only to find code that no test executes at all.
- **Rationale:**
  - Once suite size is controlled for, coverage correlates only weakly with a suite's ability to find faults.
  - Mutant detection correlates with real-fault detection, independently of coverage.
  - Files with more than 80% coverage can still score below 20% on mutation testing because assertions are missing.
  - Google found living mutants in diffs even where statement coverage was satisfactory.
- **Evidence:**
  - [Coverage Is Not Strongly Correlated with Test Suite Effectiveness](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf). Inozemtseva & Holmes, ICSE 2014, peer-reviewed.
    - Data: 31,000 test suites on 5 systems of up to 724,000 lines. Quote: "coverage, while useful for identifying under-tested parts of a program, should not be used as a quality target because it is not a good indicator of test suite effectiveness."
    - Verification: PDF text confirmed.
  - [Are Mutants a Valid Substitute for Real Faults in Software Testing?](https://homes.cs.washington.edu/~rjust/publ/mutants_real_faults_fse_2014.pdf). Just, Jalali, Inozemtseva, Ernst, Holmes, Fraser, FSE 2014, peer-reviewed.
    - Data: 357 real faults. Quotes: "73% of real faults are coupled to the mutants generated by commonly used mutation operators"; "statistically significant correlation between mutant detection and real fault detection, independently of code coverage".
    - Verification: PDF text confirmed.
  - [State of Mutation Testing at Google](https://research.google.com/pubs/archive/46584.pdf). Petrović & Ivanković, ICSE-SEIP 2018, peer-reviewed.
    - Quotes: "coverage alone might be misleading, as in many cases where statements are covered but their consequences not asserted upon". "Although the statement coverage of most projects is satisfactory, the number of living mutants per diff is significant (median is 2 mutants, 99th percentile is 43 mutants)". "75% of all findings with feedback were found useful by developers".
    - Verification: PDF text confirmed. Arid-node suppression (logging and similar) is described in §4.
  - [Does mutation testing improve testing practices?](https://arxiv.org/abs/2103.07189). Petrović, Ivanković, Fraser, Just, ICSE 2021, peer-reviewed.
    - Data: about 15 million mutants. Developers exposed to mutants write more tests and improve their suites. Mutants are coupled to real faults.
    - Verification: abstract confirmed.
  - [Mind the Gap: The Difference Between Coverage and Mutation Score Can Guide Testing Efforts](https://arxiv.org/pdf/2309.02395). Jain, Kalburgi, Le Goues, Groce, ISSRE 2023 (DOI 10.1109/ISSRE59848.2023.00036, confirmed via Crossref), peer-reviewed.
    - Quote: "26 files in our corpus with greater than 80% coverage and less than 20% mutation score". Of these, at least 12 clearly had several missing asserts and 7 lacked one specific kind of assertion. The remaining 7 were false positives from log or message-string mutants.
    - Verification: PDF text confirmed.
  - [TestCoverage](https://martinfowler.com/bliki/TestCoverage.html). Martin Fowler, 17 April 2012, blog.
    - Quotes: "high coverage numbers are too easy to reach with low quality testing". Quoting Marick: "If a part of your test suite is weak in a way that coverage can detect, it's likely also weak in a way coverage can't detect."
    - Verification: confirmed.
- **Detect:**
  - JS/TS: `npx stryker run --mutate "src/billing/**/*.ts"`. Line ranges also work, for example `"src/app.js:1-11"`. The StrykerJS default thresholds are `{ high: 80, low: 60, break: null }`, and `break` is the setting that fails the build (confirmed in the config docs).
  - Python: `mutmut run`, configured with `source_paths` / `only_mutate`, then `mutmut browse`. mutmut "must be run on a system with fork support … on windows, you must run inside WSL" (confirmed).
  - Rust: `cargo mutants -f src/foo.rs`, or `cargo mutants --in-diff changes.diff`.
  - Java: PIT (`pitest-maven:mutationCoverage -DtargetClasses=… -DwithHistory=true`).
  - Acceptance rule (the researcher's proposal, not validated by any study): zero unjustified surviving mutants on the lines to be modified. No evidence supports a global threshold on the mutation score.
- **Tools:** StrykerJS / Stryker.NET, mutmut, cosmic-ray, cargo-mutants, PIT (pitest). Use coverage.py, c8 or JaCoCo only to find code that never runs.
- **Applies to:** Any module about to be restructured, especially logic-heavy code (conditionals, arithmetic, boundaries). Less valuable for glue code, logging and configuration.
- **When not to apply / counterpoints:**
  - Cost: whole-codebase runs can take hours (HN 9746519), so restrict runs to the files in scope or to the diff.
  - Equivalent mutants: Stryker's docs say "There is no definitive way for Stryker to find and ignore them" and "don't be scared of not 100% mutation score!" (confirmed).
  - Google suppresses mutants on arid nodes.
  - The pitest author (HN user 0hjc, "Having built pitest") says he rarely meets equivalent mutants with the default operators, and knows of rollouts that fail the build below 100%.
  - Tool maturity varies by language.
  - Coverage is not useless as a proxy. [Gopinath, Jensen, Groce (ICSE 2014)](https://doi.org/10.1145/2568225.2568278) evaluated suites across a large set of real-world open-source projects. Their abstract states: "statement (not block, branch, or path) coverage predicts mutation kills best". The correlation strength is not stated in the abstract and was not checked in the full text.
  - [Kochhar, Thung, Lo (SANER 2015)](https://doi.org/10.1109/SANER.2015.7081877) used Randoop-generated suites against 67 and 92 real bugs. They found "statistically significant correlation between code coverage and bug kill effectiveness": moderate for HTTPClient and strong for Rhino (abstract, confirmed via OpenAlex).
  - Inozemtseva & Holmes differ because they controlled for suite size. Coverage remains a reasonable cheap signal for finding untested code, but not a target.
- **Fix risk:** low

### T09-F05 — Golden, snapshot and approval outputs must be deterministic, and are never updated during a refactoring pass
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Make the outputs deterministic and reviewable: scrub dates, GUIDs, random values and absolute paths, and keep snapshots small and descriptively named.
  - During a refactoring pass, never run `jest -u` / `--updateSnapshot`, `cargo insta accept`, `pytest --snapshot-update`, and never copy `.received` files over `.approved` ones.
  - Any snapshot diff counts as a behaviour change: revert the step and investigate.
- **Rationale:**
  - Snapshots work as a safety net only if a diff is treated as a signal.
  - Jest's official guidance warns against regenerating snapshots when tests fail.
  - Practitioners report "snapshot fatigue", which leads to blind updates.
  - Some tools make blind acceptance a single command.
- **Evidence:**
  - [Jest docs: Snapshot Testing](https://jestjs.io/docs/snapshot-testing). Jest / OpenJS Foundation, current docs (v30.5), official docs.
    - Quotes: "fight against the habit of regenerating snapshots when test suites fail instead of examining the root causes of their failure". "Your tests should be deterministic. Running the same tests multiple times on a component that has not changed should produce the same results every time." "as of Jest 20, snapshots in Jest are not automatically written when Jest is run in a CI system without explicitly passing --updateSnapshot".
    - The page also recommends eslint-plugin-jest `no-large-snapshots` and property matchers such as `expect.any(Date)`.
    - Verification: page text confirmed.
  - [ApprovalTests.cpp: Scrubbers](https://approvaltestscpp.readthedocs.io/en/latest/generated_docs/explanations/Scrubbers.html). ApprovalTests project, current, official docs.
    - Quote: "If you are having trouble getting tests running reproducibly, you might need to use a 'scrubber' to convert the non-deterministic text to something stable."
    - Verification: confirmed.
  - [The Perils of Jest Snapshot Testing](https://peterhrynkow.com/testing/2019/01/07/the-perils-of-snapshot-testing.html). Peter Hrynkow, 7 Jan 2019, blog.
    - Quote: "Snapshot testing is like fishing with a giant net. You want bugs, but you also catch plenty of valid changes."
    - Also covers snapshot fatigue, an example where a `traget` typo was accepted through a blind update, and the point that snapshots make refactoring painful.
    - Verification: confirmed.
  - [cargo-insta CLI docs](https://insta.rs/docs/cli/). insta project, current, official docs.
    - `cargo insta test` "forces all snapshot tests to pass so that they are collected". `accept` "operates exactly like review but instead of an interactive review all snapshot changes will be accepted".
    - The `INSTA_UPDATE` env var, which controls snapshot writing, is documented on the [advanced page](https://insta.rs/docs/advanced/).
    - Verification: confirmed.
- **Detect:**
  - In refactoring commits, `git diff --name-only BASE...HEAD -- '**/__snapshots__/**' '**/*.snap' '**/*.snap.new' '**/*.approved.*' '**/testdata/*.golden'` must return nothing.
  - Grep CI scripts, package scripts and agent transcripts for `-u`, `--updateSnapshot`, `--snapshot-update` (syrupy, confirmed), `insta accept` and `INSTA_UPDATE`.
  - Enable `jest/no-large-snapshots`.
- **Tools:** jest `--ci`, eslint-plugin-jest, ApprovalTests scrubbers, insta (`cargo insta review`), syrupy.
- **Applies to:** Any project that uses snapshot, golden or approval tests as its regression oracle, including the characterization tests from T09-F04.
- **When not to apply / counterpoints:**
  - UI snapshots freeze the structure of the markup, so a legitimate refactoring of that markup will change them. Behavioural or DOM-query tests are the better oracle there.
  - Scrubbing too aggressively can hide real changes.
  - Large snapshots that nobody reads give false confidence.
- **Fix risk:** low

### T09-F08 — Every commit on the hardening branch must build and pass the tests, so bisect works
- **Grade:** A · **Verdict:** VERIFIED
- **Rule:**
  - Every commit must build and pass the tests, so that `git bisect` can land on any of them. Verify this mechanically before handing the branch over.
  - Squash micro-steps that do not compile into a single compiling commit.
  - Do not squash the whole pass into one giant commit.
- **Rationale:**
  - When commits are small and green, bisect isolates a regression that appears later.
  - A broken intermediate commit makes bisect report a false culprit.
- **Evidence:**
  - [Linux kernel: Submitting patches](https://docs.kernel.org/process/submitting-patches.html). Linux kernel community, current, standard.
    - Quote: "take special care to ensure that the kernel builds and runs properly after each patch in the series. Developers using git bisect to track down a problem can end up splitting your patch series at any point; they will not thank you if you introduce bugs in the middle."
    - Verification: confirmed.
  - [git-bisect](https://git-scm.com/docs/git-bisect). Git project, current, official docs.
    - `bisect run` exit codes: 0 means good; "a code between 1 and 127 (inclusive), except 125" means bad; 125 means the commit cannot be tested and is skipped.
    - Verification: confirmed.
  - [Google Eng Practices: Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html). Google, current, official docs.
    - Quote: "If you have several CLs that depend on each other, you need to find a way to make sure the whole system keeps working after each CL is submitted."
    - Verification: confirmed.
- **Detect:**
  - `git rebase --exec 'make build && make test' <base>`. The git docs confirm that this "uses the --interactive machinery internally, but it can be run without an explicit --interactive". It stops at the first failing commit.
  - Alternatively, use `git bisect run ./check.sh`, where the script exits with 125 for commits that cannot be tested.
- **Tools:** git rebase --exec, git bisect run, per-commit CI builds.
- **Applies to:** All git repositories. Especially valuable for finished projects, where a regression may surface long after the pass.
- **When not to apply / counterpoints:**
  - Squash-merge workflows collapse the history anyway. Keep the branch, or use stacked PRs.
  - Some atomic refactorings, such as a rename across modules, must be one commit to compile.
  - There is a tension with T09-F06: micro-steps give local safety, while commits are the units of green behaviour.
- **Fix risk:** low

### T09-F11 — Scale verification to the type of refactoring: hierarchy and large move/inline refactorings are high-risk; renames are low-risk, and type/signature changes are not high-risk
- **Grade:** B (was A) · **Verdict:** DOWNGRADED (audit correction: type/signature changes were removed from the high-risk list, because Di Penta et al. 2020 Table 4 puts them among the least fix-inducing types, OR about 0.56-0.66, p<0.001; Pull Up Method's high risk rests on Bavota 2012 alone, since it is not significant in the replication.)
  - The findings are consistent across two peer-reviewed studies, but both come from the same research group and only cover Java.
  - Both rely on SZZ attribution, which is correlational.
  - The 40% figure for Pull Up Method and Extract Subclass rests on few instances per type.
  - Manual validation attributed the bug to the refactoring in only 38% of fix-inducing refactoring commits.
  - The citation audit found that the cited sources contradict an earlier "type or signature changes are high-risk" item. Table 4 of Di Penta et al., "ordered by decreasing OR", places Change Parameter Type, Change Variable Type, Change Return Type and Change Attribute Type in the OR band of about 0.56-0.66 (p<0.001), among the renames: significantly *less* fix-inducing, not more (row: "Change Parameter Type 15,098 5.21 1,535 0.66 <0.001"). Bavota 2012 does not flag signature changes either; it uses Add/Remove Parameter as low baselines ("2.4 times higher than Remove Parameters", "2.6 times higher than Add Parameter"). The item was dropped.
  - In the replication, Pull Up Method is not significant ("Pull Up Method 1,571 0.54 230 1.03 0.65"). Its high-risk status rests on Bavota 2012 alone.
- **Rule:**
  - Treat these as high-risk: inheritance refactorings (Pull Up/Push Down Method, Extract Subclass/Superclass) and moving or inlining large chunks of code. Do not treat type or signature changes as high-risk on this evidence; a change to an *exported* signature is still a public-API question (T09-F01), not a refactoring-risk one.
  - Before applying a high-risk refactoring, add targeted tests on both the source and the target, and run mutation testing on both.
  - Treat renames as low-risk.
  - When the safety net is thin, prefer lower-risk alternatives such as delegation or composition.
- **Rationale:**
  - Two studies (the second a replication on 103 systems) found refactoring risk to be uneven.
  - Bugs appear more often in the target components of a refactoring.
- **Evidence:**
  - [When does a Refactoring Induce Bugs? An Empirical Study](https://people.lu.usi.ch/bavotg/papers/scam2012.pdf). Bavota, De Carluccio, De Lucia, Di Penta, Oliveto, Strollo, SCAM 2012, peer-reviewed.
    - Data: 12,922 validated refactorings in Ant, ArgoUML and Xerces. "1,616 refactored classes out of the 10,969 identified (15%) have been subject to bug fixing". Pull Up Method and Extract Subclass "induce bugs in 40% of cases". "bugs generally occur more in the target source code components".
    - Verification: PDF text confirmed. The paper itself notes that some high proportions (for example Xerces Pull Up Method, 55%) "were also present in few instances".
  - [On the Relationship between Refactoring Actions and Bugs: A Differentiated Replication](https://arxiv.org/pdf/2009.11685). Di Penta, Bavota, Zampetti, ESEC/FSE 2020, peer-reviewed.
    - Quotes: "For the file-level matching, the median OR is 2.13" (100 Apache projects). "For the line-level matching, the OR decreases dramatically". The high-odds types involve "big chunks of code (extract class/subclass, move and inline method/extract and move methods), as well as those involving inheritance". "renaming changes are largely harmless". Extract Method has an OR of 0.86. "For 147 (38%) of the analyzed fix-inducing commits, we classified the refactoring as responsible" (147 + 237 = 384). Table 4: Change Parameter/Variable/Return/Attribute Type at OR about 0.56-0.66, p<0.001; Pull Up Method OR 1.03, p = 0.65.
    - Verification: PDF text confirmed; the Table 4 rows were added by the citation audit.
- **Detect:** Classify the branch's refactorings with `RefactoringMiner -bc <repo> <base-sha> <head-sha>`, or `-c <repo> <sha>` per commit (CLI confirmed in the project's how-to). Flag hierarchy, large move and inline refactorings, and require mutation runs on both the source and the target files.
- **Tools:** RefactoringMiner, Stryker / PIT / mutmut / cargo-mutants.
- **Applies to:** Object-oriented codebases with class hierarchies. Carrying the ranking over to other paradigms is an extrapolation.
- **When not to apply / counterpoints:**
  - Both studies are Java-only and SZZ-based.
  - Refactoring commits are "significantly bigger than others" (d=0.50), so size explains part of the correlation.
  - Kim et al. found that the top 25% most-refactored Windows binaries reduced post-release defects 12.2% more than other modified binaries, so refactoring also has benefits.
- **Fix risk:** low

### T09-F07 — Keep structural and behavioural changes in separate commits (preferably separate PRs)
- **Grade:** B · **Verdict:** CORRECTED
  - The date of Beck's post is 2021, not 2023.
  - The rationale said tangled commits made the cause "impossible" to identify; the source says "extremely difficult".
  - Added Google's caveats: small cleanups are allowed, and size is "up to the judgment of your reviewer".
- **Rule:**
  - Commit `refactor:` separately from `fix:` / `feat:` / `perf:`.
  - Never fold a bug found during refactoring into the refactoring commit. Commit it separately afterwards, or report it.
  - Split refactoring work by kind (formatting, renames, moves, extractions).
  - Keep PRs reviewable. Google considers about 100 lines reasonable and 1,000 usually too large, subject to the reviewer's judgment.
- **Rationale:**
  - Structural changes are reversible and cheap to review; behavioural ones are not.
  - Google, the Linux kernel and practitioners all recommend isolating refactorings.
  - In the replication study, tangled and huge commits made it "extremely difficult" to identify what triggered a fix, and refactoring commits were significantly larger than others.
- **Evidence:**
  - [Structure & Behavior](https://newsletter.kentbeck.com/p/structure-and-behavior). Kent Beck, 9 Feb 2021, blog.
    - Quotes: "Changes to the structure of the system are fundamentally different from changes to the behavior of the system". "Don't like my extracted helper function? Inline it."
    - Verification: confirmed, date corrected.
  - [Google Eng Practices: Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html). Google, current, official docs.
    - Quotes: "It's usually best to do refactorings in a separate CL from feature changes or bug fixes." "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large, but it's up to the judgment of your reviewer." "Small cleanups such as fixing a local variable name can be included inside of a feature change or bug fix CL."
    - Verification: confirmed.
  - [Linux kernel: Separate your changes](https://docs.kernel.org/process/submitting-patches.html). Linux kernel community, current, standard.
    - Quote: "Separate each logical change into a separate patch."
    - Verification: confirmed.
  - [Di Penta et al. 2020](https://arxiv.org/pdf/2009.11685). ESEC/FSE 2020, peer-reviewed.
    - In 40% of cases (95 of the 237 where the refactoring was not the trigger), the changes were "tangled commits … often of huge size, that made extremely difficult to identify the actual triggering of the bug-fix". Refactoring commits are "significantly bigger than others … (d=0.50)".
    - The paper also cites Ferreira et al.: code refactored together with other changes (floss refactoring) is more bug-prone than root-canal refactoring.
    - Verification: PDF text confirmed.
  - [Tidy First? (review)](https://henrikwarne.com/2024/01/10/tidy-first/). Henrik Warne, 2024, blog.
    - Quote: "structural and behavioral changes should be kept in separate PRs (or at least in separate commits)". Untangling afterwards with interactive rebase is harder.
    - Verification: confirmed.
- **Detect:**
  - For each `refactor:` commit, confirm with `RefactoringMiner -c <repo> <sha>` that every hunk maps to a detected refactoring.
  - Confirm that no test assertion or snapshot changed (T09-F05, T09-F12), and that `git show --stat` is within budget.
  - Use commitlint so that every commit declares one type.
- **Tools:** RefactoringMiner, commitlint, `git add -p`, fixup commits / git absorb.
- **Applies to:** All hardening passes. Mandatory when changes will be reviewed or bisected later.
- **When not to apply / counterpoints:**
  - The [controlled experiment by di Biase, Bruntink, van Deursen and Bacchelli](https://peerj.com/articles/cs-193/) (PeerJ CS 2019, 28 developers) found no significant differences between decomposed and tangled changes:
    - defects found: 17 decomposed vs 20 tangled, p=0.6;
    - median review time: 759 s vs 831 s, p=0.66.
    - Decomposition only reduced false positives: mean 0.07 vs 0.42, p=0.03.
    - Verification: Tables 2–3 confirmed.
  - Google allows small cleanups in feature CLs.
  - Microsoft developers say refactoring is "realistically" done alongside features.
  - Separation has a real overhead for a solo developer.
  - Net assessment: separation is well supported for bisectability and reversibility, and weakly supported for review effectiveness.
- **Fix risk:** low

### T09-F01 — Freeze an explicit "observable-behaviour contract" before touching code
- **Grade:** B · **Verdict:** CORRECTED
  - Fowler's source is a 2004 bliki page, not the book.
  - The cargo-semver-checks command is now the documented form `cargo semver-checks [--baseline-rev <rev>]`; the README no longer shows `check-release`.
  - The "(for example performance)" gloss on Johnson was removed because it is not in the source.
- **Rule:** Before changing any code, write down and freeze the observable behaviour of the finished project. This covers:
  - exported symbols and signatures;
  - CLI flags and output;
  - HTTP routes, status codes and schemas;
  - database schema and file or serialization formats;
  - error types and messages that callers match on;
  - events and logs consumed elsewhere;
  - ordering and latency envelopes on hot paths.

  Nothing inside the contract may change during the pass. Anything that would change it, including "obvious" bug fixes, goes on a separate behaviour-change list for a human to decide.
- **Rationale:**
  - Refactoring is defined by preserving observable behaviour (Fowler; Opdyke's input/output formulation).
  - In practice the word drifts: 46% of Microsoft developers did not mention behaviour preservation at all when defining refactoring.
  - Hyrum's Law: users come to depend on every observable behaviour.
  - Feathers: a production system "becomes its own specification".
- **Evidence:**
  - [Definition Of Refactoring](https://martinfowler.com/bliki/DefinitionOfRefactoring.html). Martin Fowler, 1 Sep 2004, blog.
    - Quote: "a change made to the internal structure of software to make it easier to understand and cheaper to modify without changing its observable behavior."
    - Verification: confirmed.
  - [On Preserving the Behavior in Software Refactoring: A Systematic Mapping Study](https://arxiv.org/pdf/2106.13900). AlOmar, Mkaouer, Newman, Ouni, Information and Software Technology 2021 (DOI 10.1016/j.infsof.2021.106675, confirmed via Crossref), peer-reviewed.
    - Quotes Opdyke (1992 PhD thesis): "for the same set of input values, the resulting set of output values should be the same before and after the refactoring."
    - Verification: PDF text confirmed (a secondary citation of Opdyke).
  - [A Field Study of Refactoring Challenges and Benefits](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/kim-fse-2012.pdf). Kim, Zimmermann, Nagappan, FSE 2012, peer-reviewed.
    - Quote: "46% of developers did not mention preservation of behavior, semantics, or functionality in their refactoring definition at all". 328 engineers were surveyed.
    - Verification: PDF text confirmed.
  - [Hyrum's Law](https://www.hyrumslaw.com/). Hyrum Wright, n.d., blog.
    - Quote: "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody."
    - Verification: confirmed.
  - [Characterization Testing](https://michaelfeathers.silvrback.com/characterization-testing). Michael Feathers, 8 Aug 2016, blog.
    - Quotes: "When a system goes into production, in a way, it becomes its own specification." "We need to know when we are changing existing behavior regardless of whether we think it's right or not."
    - Verification: confirmed.
- **Detect:** Build a machine-readable API baseline on the base commit and diff it at the end.
  - TypeScript: `api-extractor run`.
  - Rust: `cargo semver-checks --baseline-rev <base>`.
  - Python: `griffe check <pkg> -a <base-ref>`. Confirmed: `-a/--against` takes a tag, commit or branch.
  - Java: japicmp or revapi.
  - OpenAPI: `oasdiff breaking base.yaml revision.yaml` (confirmed).
  - For CLIs and services, add golden captures of `--help` output and of representative requests and responses.
- **Tools:** api-extractor, cargo-semver-checks, griffe, japicmp, oasdiff, ApprovalTests or golden files.
- **Applies to:** Every hardening pass, in any language. Most important for libraries, services with external clients, CLIs and data pipelines.
- **When not to apply / counterpoints:**
  - Kim et al. quote a developer saying refactoring is "realistically … done while adding features or fixing bugs". They also cite Johnson's argument that refactoring "does not preserve behavior in all aspects".
  - Security and error-handling fixes are behaviour changes by nature. They are legitimate, but they must be labelled and committed separately.
  - A contract that is too broad (for example "log text is contract") blocks useful cleanups. Decide explicitly which consumers exist.
- **Fix risk:** low

### T09-F02 — Establish a green, deterministic baseline before any change
- **Grade:** B · **Verdict:** CORRECTED
  - The pytest command was fixed. `pytest-repeat --count` repeats each test back-to-back within one session and gives no new order. Use separate sessions, each with its own pytest-randomly seed.
  - "3 runs" is labelled as a heuristic with no source.
- **Rule:**
  - On the untouched code, run build, type-check, linters and the full test suite several times (3 is a heuristic), in random order where the runner supports it.
  - Record per-test outcomes and seeds. If anything is red, stop.
  - A flaky test covering code in scope blocks the pass. Stabilise it, or replace it with a deterministic characterization test in a separate test-only commit, before refactoring.
- **Rationale:**
  - A red result must mean "I broke it".
  - Flaky tests are common and have known causes.
  - Google's large-scale-change tooling now ignores recently flaky tests, because it trusts a machine-generated change more than a flaky result.
- **Evidence:**
  - [An Empirical Analysis of Flaky Tests](http://mir.cs.illinois.edu/lamyaa/publications/fse14.pdf). Luo, Hariri, Eloussi, Marinov, FSE 2014, peer-reviewed.
    - Data: 201 commits that fix flaky tests, from 51 projects. "74 out of 161 (45%) commits are from the Async Wait category"; Concurrency 32/161 (20%); Test Order Dependency 19/161 (12%).
    - Verification: PDF text confirmed.
  - [Test Desiderata](https://testdesiderata.com/). Kent Beck, 2019, blog.
    - Quote, Deterministic: "if nothing changes, the test result shouldn't change."
    - Verification: confirmed.
  - [Software Engineering at Google, Ch. 22](https://abseil.io/resources/swe-book/html/ch22.html). Winters, Manshreck, Wright (eds.), 2020, book, open-access HTML.
    - Quote: "we are now much more confident in the correctness of a single change than a test with any recent history of flakiness—so much so that recently flaky tests are now ignored when submitting via our automated tooling."
    - Verification: confirmed.
  - [Jest docs: Snapshot Testing](https://jestjs.io/docs/snapshot-testing). Jest, current, official docs.
    - Quote: "Your tests should be deterministic…"
    - Verification: confirmed.
- **Detect:**
  - Go: `go test -count=1 -shuffle=on ./...`, repeated. `-shuffle off,on,N` is confirmed in the go docs.
  - Python: run `pytest` several times with pytest-randomly installed. Each session gets a new seed; reproduce one with `--randomly-seed=<n>` or `--randomly-seed=last` (confirmed).
  - JS/TS: `jest --randomize` (confirmed; the seed is printed and settable with `--seed`), or `vitest --sequence.shuffle` (confirmed).
  - Java: `mvn -Dsurefire.runOrder=random test`, repeated.
  - Diff the outcome lists between runs. Record the warning count as well.
- **Tools:** go test -shuffle, pytest-randomly, jest --randomize, vitest --sequence.shuffle, maven-surefire runOrder.
- **Applies to:** All projects with an automated test suite. For projects without one, see T09-F04.
- **When not to apply / counterpoints:**
  - Repeated full runs are expensive. A compromise is several runs of the tests covering the scope plus one full run.
  - Order dependencies that the shuffle exposes should be recorded, not fixed mid-refactor.
  - Google tolerates some flakiness by ignoring or re-running flaky tests.
- **Fix risk:** low

### T09-F04 — Where the net is weak, first write characterization / golden-master tests that pin current behaviour, bugs included
- **Grade:** B · **Verdict:** CORRECTED
  - The Artima post was written by Alberto Savoia, not Michael Feathers. It quotes Feathers' algorithm.
  - Noback's positions are now given as paraphrases instead of invented quotes.
- **Rule:**
  - Put the code in a harness, write an assertion you know will fail, copy the actual value into it, and name the test after the behaviour it pins.
  - Cover every branch, using combination or approval tests over parameter grids, then confirm with mutation testing.
  - Log the bugs you find; do not fix them.
  - Commit these tests separately (`test:`) while production code stays frozen.
- **Rationale:**
  - Characterization tests document actual behaviour, which is exactly what a refactoring must preserve.
  - Microsoft engineers describe falling back on "known scenarios", and say that without them refactoring should not be done at all.
- **Evidence:**
  - [Characterization Testing](https://michaelfeathers.silvrback.com/characterization-testing). Michael Feathers, 2016, blog.
    - Quote: "The purpose of characterization testing is to document your system's actual behavior, not check for the behavior you wish your system had."
    - Verification: confirmed.
  - [Working Effectively With Characterization Tests](https://www.artima.com/weblogs/viewpost.jsp?thread=198296). **Alberto Savoia** (Artima Weblogs), 9 Mar 2007, blog, quoting Feathers.
    - Quotes: "Write an assertion that you know will fail." "Run the test and let the failure tell you what the actual behavior is." "Write tests for the area where you will make your changes."
    - Verification: confirmed. Author attribution corrected.
  - [Using Coverage and Combinations with Legacy Code](https://sammancoaching.org/workshops/approvals/part2.html). Emily Bache / Samman Technical Coaching, n.d., blog.
    - The workflow goes coverage → branch coverage → combination approvals → mutation testing. It includes "covered != bug free and uncovered != buggy". Pure functions suit combination approvals best.
    - Verification: confirmed.
  - [A Field Study of Refactoring Challenges and Benefits](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/kim-fse-2012.pdf). Kim et al., FSE 2012, peer-reviewed.
    - Quote: "If there are no tests, then (one) need to go from known scenarios and make sure they all work. If there is insufficient documentation for scenarios, refactoring should not be done."
    - Verification: PDF text confirmed.
  - [Testing Effectively With Legacy Code](https://www.informit.com/articles/article.aspx?p=359417&seqNum=2). Michael Feathers (InformIT), 21 Jan 2005, book excerpt.
    - Quote: "A seam is a place where you can alter behavior in your program without editing in that place."
    - Verification: confirmed.
- **Detect:** For each unit in the plan, check three things:
  - whether any test references its public symbols (`rg -l 'symbol' tests/`);
  - branch coverage on the lines to be touched;
  - mutation survivors (T09-F03).

  If any of these shows a gap, write characterization tests first. Tools: ApprovalTests (`verify`, CombinationApprovals), Jest `toMatchSnapshot`, syrupy, insta, Go `testdata/` golden files.
- **Tools:** ApprovalTests, Jest snapshots, syrupy, insta, Go golden files, coverage.py / c8 / JaCoCo.
- **Applies to:** Finished projects with thin or implementation-coupled tests. Code with heavy I/O needs a seam first.
- **When not to apply / counterpoints:**
  - These tests pin current bugs by design, so a human decides about each bug separately.
  - There is a chicken-and-egg problem: you often have to refactor to get tests in (HN 17505586). Limit that step to minimal, tool-applied seams.
  - Very fine-grained characterization tests become sensitive to structure.
  - [Matthias Noback (2022)](https://matthiasnoback.nl/2022/10/refactoring-without-tests-should-be-fine/) argues, in paraphrase, that small structural transformations would be safe even without tests. In practice, he lists four failure sources:
    - syntax slips, which PHPStan catches;
    - call sites missed through dynamic dispatch;
    - tests too close to the current structure;
    - behaviour changes slipped in alongside, including "I removed stuff that seemed unused".
- **Fix risk:** low

### T09-F12 — Tests are read-only during a structural change
- **Grade:** B · **Verdict:** VERIFIED. Added context: ImpossibleBench uses artificial impossible tasks, not refactoring, and its rates depend on the prompt.
- **Rule:**
  - A refactoring commit changes production code only. The one exception is a tool-applied rename or move in tests that mirrors the production change.
  - No new skip, xfail or ignore markers, no type or lint suppressions, and no deleted assertions.
  - If a test needs a semantic edit, stop and report.
  - Restructure tests only in separate test-only commits, and show with mutation testing that they are just as strong afterwards.
- **Rationale:**
  - Tests guard behaviour only if they are not edited in the same step.
  - Frontier agents modify or game tests when the tests conflict with their change, even when told not to.
  - Read-only test access blocks direct edits.
  - Beck: good tests are structure-insensitive.
- **Evidence:**
  - [ImpossibleBench](https://arxiv.org/html/2510.20270). Zhong, Raghunathan, Carlini, 2025, arXiv preprint.
    - "GPT-5, cheats 54.0% of the time on Conflicting-SWEbench"; o3 49%; Opus 4.1 50%. Strategies include "The model directly modifies tests despite being explicitly instructed not to", operator overloading and special-casing.
    - Read-only access "restores legitimate performance while preventing test modification attempts … but it does not eliminate other cheating methods such as special-casing or operator overloading".
    - The rates are prompt-sensitive. A looser prompt raised GPT-5 to 66%. An abort option lowered GPT-5 to 9% and o3 to 12%.
    - Verification: HTML text confirmed.
  - [Test Desiderata](https://testdesiderata.com/). Kent Beck, 2019, blog.
    - Quotes, Structure-insensitive: "tests should not change their result if the structure of the code changes." Behavioral: "If the behavior changes, the test result should change."
    - Verification: confirmed.
  - [Taming Agentic Refactoring with the Mikado Method](https://anischaabani.com/en/blog/mikado-method-ai-agents/). Anis Chaabani, 5 Jun 2026, blog.
    - Quote: "The agent makes tests pass, but by modifying them. It satisfies the compiler, but with `# type: ignore` and compliant mocks."
    - Verification: confirmed.
  - [HN comment](https://news.ycombinator.com/item?id=44468896). HN user muzani, 4 Jul 2025, practitioner forum.
    - Quote: 'I've seen claude "monkey patching" a system so that it returns true to the tests.'
    - Verification: confirmed via the HN API.
- **Detect:**
  1. `git diff --name-only <base>...HEAD -- 'test/**' 'tests/**' '**/*.test.*' '**/*.spec.*' '**/*_test.*' '**/__snapshots__/**'` must return nothing for `refactor:` commits, except pure renames or moves reported by RefactoringMiner.
  2. Added lines must not match any of: `.skip(`, `xit(`, `@pytest.mark.skip`, `@pytest.mark.xfail`, `#[ignore]`, `@Disabled`, `t.Skip(`, `# type: ignore`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `noqa`, `nolint`, `#[allow(`.
  3. The count of assertions must not decrease.
  4. For agents, make the test directories read-only during structural steps.
- **Tools:** git diff, ripgrep, RefactoringMiner, filesystem permissions or sandbox read-only mounts.
- **Applies to:** Every refactoring commit. Critical for hardening driven by an AI agent.
- **When not to apply / counterpoints:**
  - Implementation-coupled tests (mocks of internal calls, tests of private methods) break legitimately under refactoring. Fix them in a prior, separate commit rather than granting a blanket exemption.
  - Read-only access does not stop special-casing, so an independent review of the diff is still needed.
- **Fix risk:** low

### T09-F09 — Apply mechanical refactorings with a semantics-aware engine, not by regenerating text
- **Grade:** B · **Verdict:** CORRECTED
  - Liu et al. is peer-reviewed (Automated Software Engineering 32(1), 2025).
  - The 81.3% agreement for EM-Assist comes from 16 developers.
  - Wang et al.'s "130 new bugs" is the authors' own report. Of the 21 they submitted, 10 had been confirmed by developers and 7 fixed at the time of writing.
  - Pomian et al. remains a preprint for the cited figures. A paper by the same authors with a different title ("Next-Generation Refactoring: Combining LLM Insights and IDE Capabilities for Extract Method", ICSME 2024) appears to be the published version. It was not checked that its figures are identical.
- **Rule:**
  - Use IDE or LSP rename, extract, inline and move; rust-analyzer assists; type-aware codemods (OpenRewrite).
  - For pattern-wide changes, use syntax-aware rewriters with a diff preview (ast-grep, LibCST, jscodeshift, ts-morph, Comby).
  - For agents, the model chooses what to refactor, the engine applies it, and the tests re-verify it.
  - After any rename, search strings, configs, templates, reflection and DI registrations for the old name.
- **Rationale:**
  - LLM-authored refactorings are unsafe at a measurable rate.
  - Re-applying them through tested engines removes most of those errors.
  - Large-scale changes at Google and Stripe were tool-generated.
  - Type attribution is what makes pattern matching accurate.
- **Evidence:**
  - [An Empirical Study on the Potential of LLMs in Automated Software Refactoring](https://arxiv.org/abs/2411.04444). Liu, Jiang, Zhang, Niu, Li, Liu, 2024 preprint, published in Automated Software Engineering 32(1) 2025, peer-reviewed.
    - Quote: "13 out of the 176 solutions suggested by ChatGPT and 9 out of the 137 solutions suggested by Gemini were unsafe". Proposes RefactoringMirror.
    - Verification: confirmed.
  - [Together We Go Further: LLMs and IDE Static Analysis for Extract Method Refactoring](https://arxiv.org/abs/2401.15298). Pomian et al., 2024, arXiv preprint.
    - Quotes: "up to 76.3% of the suggestions are hallucinations". "81.3% of them [16 industrial developers] agreed with the recommendations provided by EM-Assist".
    - Verification: confirmed.
  - [OpenRewrite: Lossless Semantic Trees](https://docs.openrewrite.org/concepts-and-explanations/lossless-semantic-trees). Moderne / OpenRewrite, current, official docs.
    - Quote: "Type attribution is necessary for the accurate matching of patterns." Example: `logger.info` could be SLF4J or Logback.
    - Verification: confirmed.
  - [Software Engineering at Google, Ch. 22](https://abseil.io/resources/swe-book/html/ch22.html). Google, 2020, book.
    - Quotes: "LSCs at Google are almost always generated using automated tooling." "more than 500,000 references to scoped_ptr".
    - Verification: confirmed.
  - [ast-grep: Rewrite Code](https://ast-grep.github.io/guide/rewrite-code.html). ast-grep, current, official docs.
    - Quote: "This will show you a diff of the changes that will be made". `--interactive` asks before applying; `-U` / `--update-all` accepts without confirmation.
    - Verification: confirmed.
  - [Why LibCST](https://libcst.readthedocs.io/en/latest/why_libcst.html). LibCST project, current, official docs.
    - Quote: "Like a CST, LibCST preserves all whitespace and can be reprinted exactly."
    - Verification: confirmed. The page does not name the maintainer.
  - [Migrating millions of lines of code to TypeScript](https://stripe.dev/blog/migrating-to-typescript). Andrew Lunny (Stripe), 20 May 2022, blog.
    - Quote: "In a single pull request, we converted more than 3.7 million lines of code". The codemod was refined over about a year, and `@ts-expect-error` suppressions went from 97k down to 37k.
    - Verification: confirmed.
- **Detect:**
  - A supposed rename or move with low similarity in `git diff -M` was probably re-typed rather than moved by a tool.
  - After a rename, `rg -w -F '<oldName>'` over the whole repo, including JSON, YAML, templates and SQL, should return zero hits, or each remaining hit must be justified.
  - Agent transcripts should show refactoring-engine or codemod calls rather than whole-file writes.
- **Tools:** IDE/LSP refactorings (IntelliJ, tsserver, rust-analyzer, Rope/pyright), OpenRewrite, ast-grep, LibCST, jscodeshift / ts-morph, Comby, ripgrep.
- **Applies to:** Rename, move, extract, inline, change-signature and API migrations. Strongest in statically typed languages.
- **When not to apply / counterpoints:**
  - Engines have bugs too. [Wang, Xu, Zhang, Tsantalis, Tan (2024, arXiv)](https://arxiv.org/abs/2409.14610): "our transferability study revealed 130 new bugs in the latest version of those refactoring engines. Among the 21 bugs we submitted, 10 bugs are confirmed by their developers, and seven of them have already been fixed." This is a preprint with no journal-ref as of Sep 2026.
  - Bavota et al. note that IDE-automated refactoring "could be fault-prone as well".
  - Microsoft developers do 86% of their refactoring by hand, and 51% do all of it by hand (Kim et al., confirmed).
  - Syntax-only rewriters have no type information and can over-match.
  - Dynamic dispatch, reflection and string-based wiring defeat static rename (Noback, paraphrased).
- **Fix risk:** medium

### T09-F16 — Before simplifying code that looks odd, find out why it exists (Chesterton's fence)
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Before simplifying special cases, guards that look redundant, inlined assets, sleeps or retries, order-sensitive statements or "unused" parameters, investigate their history with `git log -L :<func>:<file>`, `git log -S '<snippet>'`, `git blame -w -C -C`, the linked issues and the comments.
  - If the reason cannot be established, pin the behaviour with a characterization test, or leave the code alone and report it.
- **Rationale:**
  - Microsoft engineers name misunderstood corner cases as the main source of refactoring regressions.
  - Practitioner incidents show "cleanups" removing deliberate design.
- **Evidence:**
  - [A Field Study of Refactoring Challenges and Benefits](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/kim-fse-2012.pdf). Kim et al., FSE 2012, peer-reviewed.
    - Quotes: "77% of the participants consider that refactoring comes with a risk of introducing subtle bugs and functionality regression". "The primary risk is regression, mostly from misunderstanding subtle corner cases in the original code and not accounting for them in the refactored code."
    - Verification: PDF text confirmed.
  - [A Short Cautionary Tale About Refactoring (HN)](https://news.ycombinator.com/item?id=26512036). HN thread on zigamiklic.com, 21 Mar 2021, practitioner forum.
    - An inlined PNG was turned into an image loaded over HTTP, which broke the offline error screen.
    - Quotes: "never remove a fence until you can explain why it's there". "Assume the original authors are not entirely stupid". One commenter (alkonaut) notes "Self-documenting code, or tests, or comments would have saved the situation".
    - Verification: confirmed.
  - [Characterization Testing](https://michaelfeathers.silvrback.com/characterization-testing). Feathers, 2016, blog.
    - Recounts fixing an apparent bug that users relied on.
    - Verification: confirmed.
  - [Things You Should Never Do, Part I](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/). Joel Spolsky, 2000, blog.
    - Quote: "Each of these bugs took weeks of real-world usage before they were found."
    - Verification: confirmed.
- **Detect:** List the conditionals, guards, early returns, retries, sleeps, try/except blocks and special-case constants that a refactoring diff removes (`git diff -U0 | rg '^-' | rg -e 'if ' -e 'catch' -e 'except' -e 'retry' -e 'sleep' -e 'return'`). Each one needs either a covering test that still passes, or a history note showing it is obsolete.
- **Tools:** git log -L, git log -S, git blame -w -C -C, issue tracker search.
- **Applies to:** Mature code with incident fixes, platform workarounds or integrations.
- **When not to apply / counterpoints:**
  - Taken to extremes, this rule paralyses cleanup, and much odd code really is accidental. Decide with coverage, mutation and dead-code evidence.
  - Noback lists "I removed stuff that seemed unused (correctness of such a change may be really hard to prove)" among his own mistakes.
- **Fix risk:** low

### T09-F14 — Do not rewrite working modules wholesale: use parallel change (expand/migrate/contract) and a strangler approach
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - Restructure incrementally.
  - Change interfaces through expand → migrate callers → contract, with the contract step in a later commit.
  - Keep deprecated shims for anything public.
  - Use a strangler approach for anything larger than a module.
- **Rationale:**
  - A rewrite throws away the bug fixes embedded in the old code.
  - Existing behaviour is hard to specify.
  - API-level refactorings cause most client breakages.
- **Evidence:**
  - [Things You Should Never Do, Part I](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/). Joel Spolsky, 2000, blog (opinion).
    - Quote: "the single worst strategic mistake that any software company can make".
    - Verification: confirmed.
  - [Strangler Fig Application](https://martinfowler.com/bliki/StranglerFigApplication.html). Martin Fowler, revised 22 Aug 2024, blog.
    - Quote: "Replacements seem easy to specify, but often it's hard to figure out the details of existing behavior."
    - Verification: confirmed.
  - [Parallel Change](https://martinfowler.com/bliki/ParallelChange.html). Danilo Sato, 13 May 2014, blog.
    - Quote: "a pattern to implement backward-incompatible changes to an interface in a safe manner, by breaking the change into three distinct phases: expand, migrate, and contract."
    - Verification: confirmed.
  - [Kim et al. 2012, citing Dig et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/kim-fse-2012.pdf). Peer-reviewed.
    - Quote: "80% of the changes that break client applications are API-level refactorings".
    - Verification: PDF text confirmed (a secondary citation).
- **Detect:**
  - Files or functions shown as delete+add, or with low similarity under `git diff -M` (the default rename threshold is 50%), count as rewrites and need differential tests (T09-F15).
  - Any removal or signature change of a public symbol in the API diff (T09-F01) violates this rule, unless it is the contract phase of a completed parallel change.
- **Tools:** git diff -M, api-extractor, cargo-semver-checks, griffe, oasdiff.
- **Applies to:** Modules with external consumers, public libraries, service APIs, and any module considered for a rewrite.
- **When not to apply / counterpoints:**
  - Stripe's single-PR migration shows that atomic change works when it is fully mechanical and type-checked.
  - For internal code whose callers are all in the repo, an atomic change is often simpler.
  - Shims add complexity and must be removed (the contract step) promptly.
  - Spolsky's essay is an opinion piece.
- **Fix risk:** medium

### T09-F17 — Put formatter runs and mass mechanical edits in their own commits, keep equivalence checks on, and ignore those commits in blame
- **Grade:** B (was A) · **Verdict:** DOWNGRADED
  - The tool facts (Black's AST check, git's ignore-revs) are directly confirmed.
  - The claim that mixed formatting hides real edits in review has only indirect support. RAID measures refactoring-aware diffs, not formatting separation.
- **Rule:**
  - Formatter runs and mass mechanical edits go in standalone commits.
  - Keep equivalence checks enabled: Black's default AST check, so never pass `--fast`.
  - List these commits in `.git-blame-ignore-revs` and set `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- **Rationale:**
  - Formatting noise hides real edits.
  - Black verifies AST equivalence by default.
  - Git can leave mechanical commits out of blame, which keeps the history investigation in T09-F16 cheap.
- **Evidence:**
  - [Black: The basics](https://black.readthedocs.io/en/stable/usage_and_configuration/the_basics.html). Black / PSF, current, official docs.
    - Quotes: "By default, Black performs an AST safety check after formatting your code." "The --fast flag turns off this check".
    - Verification: confirmed.
  - [git-blame](https://git-scm.com/docs/git-blame). Git project, current, official docs.
    - Quotes: `--ignore-rev` means "Ignore changes made by the revision when assigning blame, as if the change never happened". `blame.ignoreRevsFile` takes "one unabbreviated object name per line".
    - Verification: confirmed.
  - [RAID: Tool Support for Refactoring-Aware Code Reviews](https://arxiv.org/abs/2103.11453). Brito & Valente, ICPC 2021, peer-reviewed.
    - Quote: "the median number of lines to be reviewed decreases from 14.5 to 2 lines in the case of move refactorings and from 113 to 55 lines in the case of extractions".
    - Verification: confirmed. This supports separation only indirectly.
  - [HN comment](https://news.ycombinator.com/item?id=13180224). MaulingMonkey, 2016, practitioner forum.
    - Quote: "an autoreformatting of a file to fix whitespace issues, and hand-implemented refactoring, should be separate commits for cleaner, more readable and reviewable diffs."
    - Verification: confirmed via the HN API.
- **Detect:**
  - A commit where `git diff -w --stat <c>^ <c>` is empty but `git diff --stat` is not must be standalone and listed in `.git-blame-ignore-revs`.
  - Grep CI and scripts for `--fast`.
- **Tools:** Black, Prettier, rustfmt, gofmt, ruff format, `git blame --ignore-revs-file`.
- **Applies to:** Any project that adopts or re-runs a formatter during hardening.
- **When not to apply / counterpoints:**
  - Few formatters offer an AST equivalence check.
  - Pin the formatter version.
  - Large formatting commits cause merge conflicts on active branches.
- **Fix risk:** low

### T09-F18 — Confirm that each `refactor:` commit is a pure refactoring with a refactoring-aware diff tool; an LLM reviewer is a filter, not an oracle
- **Grade:** B · **Verdict:** CORRECTED
  - RefactoringMiner accuracy is updated. The 2020 figure of 98% precision / 87% recall is outdated. The maintainer's own benchmarks, as of September 2026, report Java 0.999/0.984 and 0.989/0.979, Python 0.997/0.996, Kotlin 0.998/1.000, and JavaScript 0.983/1.000 (on only 177 true positives). TypeScript and C/C++ have no published benchmark.
  - The "misses 6–20%" inference was removed: accuracy is not recall.
  - Gheyi et al. is accepted in Empirical Software Engineering.
  - The OpenStack study is confirmed as MSR 2022 (DOI 10.1145/3524842.3527932, via Crossref).
- **Rule:**
  - Every hunk should map to a named refactoring. Split out or justify any leftover edit.
  - An independent LLM reviewer may flag suspicious transformations, but it never replaces tests.
- **Rationale:**
  - Plain diffs hide moves and extractions, and refactoring reviews take longer.
  - Refactoring detectors exist for several languages.
  - Foundation models catch many refactoring-engine bugs, but not all of them.
- **Evidence:**
  - [RefactoringMiner](https://github.com/tsantalis/RefactoringMiner). Tsantalis et al., 2026 (current), official docs.
    - Detects 106 refactoring types.
    - Supports Java, Python, Kotlin, TypeScript, JavaScript and C/C++.
    - CLI: `-c <repo> <sha>`, `-bc <repo> <start> <end>`, `-gp <url> <pr> <timeout>` (confirmed in documentation/how-to.md).
    - Also ships as a GitHub Action and an MCP server. Accuracy figures are in documentation/accuracy.md, as above.
    - Verification: confirmed.
  - [Di Penta et al. 2020](https://arxiv.org/pdf/2009.11685). Peer-reviewed.
    - RMiner was "reported to have a 98% precision and 87% recall" (Java, 2020-era).
    - Verification: confirmed, but superseded by the current benchmarks.
  - [Code Review Practices for Refactoring Changes: An Empirical Study on OpenStack](https://arxiv.org/abs/2203.14404). AlOmar, Chouchen, Mkaouer, Ouni, MSR 2022, peer-reviewed.
    - Data: "11,010 refactoring and non-refactoring reviews". "refactoring-related code reviews take significantly longer to be resolved". "28 refactoring review criteria".
    - Verification: confirmed.
  - [Foundation Models as Oracles for Refactoring Correctness Detection](https://arxiv.org/abs/2605.02096). Gheyi, Melo, Oliveira, Ribeiro, Fonseca, 2026, accepted in Empirical Software Engineering.
    - Data: "226 real refactoring bugs … from widely used Java IDEs (IntelliJ-IDEA, Eclipse, and NetBeans), spanning 47 refactoring types". GPT-OSS-20B scored 80.5% accuracy and GPT-5.4 93.8%.
    - Quote: models "can complement traditional refactoring checks by flagging suspicious transformations".
    - Verification: confirmed.
- **Detect:**
  - Run `RefactoringMiner -c <repo> <sha>`, or the GitHub Action on the PR. Any hunk not explained by a detected refactoring is a candidate behaviour change.
  - Optionally ask a separate reviewer model to list suspicious hunks, and treat its output only as flags for a human.
- **Tools:** RefactoringMiner (CLI, GitHub Action, MCP), RAID, IDE structural diff, independent LLM reviewer.
- **Applies to:** Refactoring commits in supported languages. Elsewhere, use manual review plus the move checks from T09-F10.
- **When not to apply / counterpoints:**
  - The accuracy numbers are self-reported by the maintainer.
  - Composite or custom refactorings may show up as residual hunks.
  - The LLM-oracle results cover Java IDE bugs, not arbitrary project code.
- **Fix risk:** low

### T09-F19 — Final gate: full non-incremental run, E2E/smoke tests, mutation on the diff, API diff, perf smoke, then a report to the human
- **Grade:** B · **Verdict:** VERIFIED. Petrović et al. is confirmed as IEEE Transactions on Software Engineering, 2022 (DOI 10.1109/TSE.2021.3107634, via Crossref). The arXiv preprint dates from 2021.
- **Rule:** Before handing the pass over, run:
  1. the full test suite, build, type-check and linters;
  2. E2E or smoke runs of representative scenarios;
  3. mutation testing on the whole diff;
  4. the public-API diff against the baseline from T09-F01;
  5. a perf smoke test on declared hot paths.

  Then write a report listing behaviour-change candidates, bugs found but not fixed, items skipped, and residual risks.
- **Rationale:**
  - Incremental and diff-limited checks miss effects across files, and the tools themselves document this.
  - Google runs mutation testing on each diff during review.
  - Incidents show changes that pass unit tests and still fail end to end.
- **Evidence:**
  - [cargo-mutants: --in-diff](https://mutants.rs/in-diff.html). cargo-mutants, current, official docs.
    - Quote: "Incremental tests are helpful for giving faster feedback, but they're not a substitute for a full test run."
    - Verification: confirmed.
  - [StrykerJS: Incremental](https://stryker-mutator.io/docs/stryker-js/incremental/). Stryker, current, official docs.
    - Quote: "Stryker will not detect any changes you've made in files other than mutated files and test files". `--force` re-runs every mutant.
    - Verification: confirmed.
  - [Practical Mutation Testing at Scale: A view from Google](https://arxiv.org/abs/2102.11378). Petrović, Ivanković, Fraser, Just, IEEE TSE 2022, peer-reviewed.
    - Quote: "Mutation testing is done incrementally, mutating only changed code during code review". The evaluation covered "more than 24,000 developers on more than 1,000 projects".
    - Verification: confirmed.
  - [I caused a SEV. Here is what I learned](https://dev.to/moozzyk/i-caused-a-sev-here-is-what-i-learned-4o5d). Pawel Kadluczka, 18 Jul 2024, incident write-up (blog).
    - A pipeline change meant to leave output unchanged dropped all data because of a forgotten downstream feature flag.
    - Quote: "A reminder always to validate changes end-to-end."
    - Verification: confirmed.
- **Detect:** A CI job on the hardening branch that runs:
  - the full test command, plus E2E or smoke scenarios;
  - a mutation run on the changed files (`cargo mutants --in-diff`, `npx stryker run --mutate <files>`, PIT `targetClasses`, mutmut);
  - the API-diff tools;
  - a benchmark comparison (hyperfine, criterion, pytest-benchmark, BenchmarkDotNet).
- **Tools:** cargo-mutants, StrykerJS, PIT, mutmut, API-diff tools, hyperfine / criterion / pytest-benchmark.
- **Applies to:** The end of every hardening pass.
- **When not to apply / counterpoints:**
  - Full mutation and E2E runs are expensive, so scope them to the changes and the critical flows.
  - Perf smoke tests are noisy.
  - No evidence supports a universal cut-off for the mutation score. Stryker's 80/60 defaults are conventions.
- **Fix risk:** low

### T09-F15 — For substantial internal rewrites, keep the old implementation temporarily and prove equivalence with differential or property tests
- **Grade:** B · **Verdict:** VERIFIED
- **Rule:**
  - For algorithmic simplifications, complexity reductions and replacements of hand-rolled logic with a library, check equivalence on generated inputs: `hypothesis write --equivalent mod.old mod.new`, or the fast-check / proptest equivalents.
  - For critical read paths, run old and new side by side while still serving the old result (the Scientist pattern).
  - Delete the old implementation in a separate commit.
- **Rationale:**
  - Example-based tests sample only a few inputs.
  - Differential testing uses the old code as the oracle.
  - GitHub's side-by-side experiment found real mismatches before cutting over.
- **Evidence:**
  - [Hypothesis Ghostwriter](https://hypothesis.readthedocs.io/en/latest/reference/integrations.html). Hypothesis, current, official docs.
    - Quotes: "The resulting test checks that calling each of the functions returns an equal value". Useful "for differential testing where none of the compared functions are fully trusted but any difference indicates a bug". CLI: `hypothesis write --equivalent`.
    - Verification: confirmed.
  - [github/scientist](https://github.com/github/scientist). GitHub, current, official docs.
    - Quotes: "A Ruby library for carefully refactoring critical paths". "Scientist is only safe for wrapping methods that aren't changing data." Always returns the `use` (control) result.
    - Ports: Scientist4J (Java), laboratory (Python), scientist.net, go-scientist, TS ports.
    - Verification: confirmed.
  - [Move Fast and Fix Things](https://github.blog/engineering/engineering-principles/move-fast/). Vicent Martí (GitHub), 15 Dec 2015, blog.
    - Quotes: "the 768 conflicts were being reported as 0 by the shell, because 768 is a multiple of 256!" The new path's 99th percentile was "roughly equivalent to the 95th of the old". The rollout took about 5 days of part-time work.
    - Verification: confirmed.
- **Detect:** For functions whose body changed substantially, require a differential or property test comparing old and new in a commit that comes before the deletion of the old code.
- **Tools:** Hypothesis ghostwriter, fast-check, proptest / quickcheck, jqwik, github/scientist and its ports.
- **Applies to:** Algorithmic rewrites, complexity reductions, performance refactorings, parsers and serializers.
- **When not to apply / counterpoints:**
  - Needs mostly pure, deterministic functions. Scientist warns against wrapping code that changes data.
  - A difference shows disagreement, not which side is right.
  - It adds temporary duplication.
- **Fix risk:** low

### T09-F13 — Declare a scope per hardening item and revert anything outside it
- **Grade:** B · **Verdict:** CORRECTED
  - Associations are no longer stated as causes: the study found tangled refactorings "associated with" about 58% lower odds of compiling.
  - The Horikawa wording is fixed: agents "explicitly targeting refactoring in 26.1% of commits", with smell reductions "statistically significant but not practically significant".
  - The 50–71% range is an assessment by the authors' own LLM-based tool (RefUntangle), not manual ground truth.
  - Both studies are preprints.
  - Horikawa et al. cover Java projects only. They also report "small but statistically significant improvements in structural metrics" (for example Class LOC median Δ = −15.25), so the payoff is small rather than zero.
- **Rule:**
  - Each item declares its files, its symbols and a named refactoring. No drive-by improvements.
  - Record extra needs as new items (Mikado).
  - Prioritise refactorings that address a measured problem.
- **Rationale:**
  - In agent patches, tangled refactorings are associated with a much lower chance of compiling.
  - Agent refactorings lean toward low-level renames and type changes, with negligible reduction in smells.
  - So refactoring without a declared scope adds risk and brings little measurable quality.
- **Evidence:**
  - ["Refactoring Runaway": Understanding and Mitigating Tangled Refactorings in Coding Agents for Issue Resolution](https://arxiv.org/html/2605.22526). Tian, Zhang, Xiao, Wang, Kondo, Chen, Kamei, May 2026, arXiv preprint.
    - Agents: "791 out of 3,691 patches (21.43%)" contain tangled refactorings, against 36.72% of human patches (from a much smaller sample).
    - The odds ratio for compilability is 0.42, "a reduction of approximately 58% in the odds of successful compilation after controlling for task-, agent-, and patch-level factors".
    - For correctness: "OR=1.09, p=0.543". Method-level refactorings: OR 0.22 for correctness and 0.23 for compilability.
    - Their RefUntangle approach "improves compilability from 19.34% to 38.33%".
    - Verification: HTML text confirmed.
  - [Agentic Refactoring: An Empirical Study of AI Coding Agents](https://arxiv.org/html/2511.04824v1). Horikawa, Li, Kashiwa, Adams, Iida, Hassan, 2025, arXiv preprint (submitted to TOSEM).
    - Data: 15,451 refactoring instances in open-source Java projects (AIDev dataset). Agents are "explicitly targeting refactoring in 26.1% of commits". The most common types are Change Variable Type 11.8%, Rename Parameter 10.4% and Rename Variable 8.5%.
    - Smells: "statistically significant but not practically significant". The median design smell count is 77.50 → 77.50.
    - Structural metrics show "small but statistically significant improvements" (abstract).
    - Verification: HTML text confirmed.
  - [Taming Agentic Refactoring with the Mikado Method](https://anischaabani.com/en/blog/mikado-method-ai-agents/). Anis Chaabani, June 2026, blog.
    - "Change greediness": "The agent doesn't stop when it hits an obstacle. It absorbs it, adapts it, works around it." Also "context scattering".
    - Verification: confirmed.
- **Detect:**
  - Compare `git diff --name-only <base>...HEAD` with the declared file list.
  - Compare the output of `RefactoringMiner -bc` with the plan.
  - Measure the target metric before and after the item.
- **Tools:** git diff --name-only, RefactoringMiner, complexity and duplication tools (SonarQube, lizard, jscpd).
- **Applies to:** Hardening passes driven by an agent.
- **When not to apply / counterpoints:**
  - There is no significant association between tangled refactorings and functional correctness.
  - Humans tangle more often than agents.
  - Fowler's "litter-pickup" refactoring values opportunistic cleanup. Record such messes as follow-up items.
- **Fix risk:** low

### T09-F06 — Apply one named refactoring at a time; after each step compile and test; on red, revert rather than debug forward
- **Grade:** B · **Verdict:** CORRECTED
  - The revert command now carries a safety caveat: `git clean -fd` deletes every untracked file, not only the step's own.
  - The size flags (400 lines / 20 files) are labelled heuristics.
  - The WellAged.dev post is flagged as undated and drafted with AI help ("Claude helped draft and structure the content"), so it carries little weight as an independent source.
- **Rule:**
  - Apply one catalog refactoring per step (Extract Function, Move Field and so on).
  - After each step, compile and run the fast tests for the scope.
  - If a step goes red and the cause is not obvious, restore the last green state and take a smaller step.
    - Start every step from a clean, committed tree, so that `git restore .` (or `git reset --hard <last-green>`) is enough.
    - Use `git clean` only on files the step itself created. Never run it blindly, because it deletes untracked user files.
  - For goals that cannot be reached in one step, use Mikado: make a naive attempt, record what breaks as prerequisites, revert, solve the leaves first, and keep the graph in a file.
- **Rationale:**
  - Small steps reduce error risk and keep the system working.
  - Agent practitioners report that reverting is cheap, while patching forward produces sprawling diffs.
- **Evidence:**
  - [Refactoring (book page)](https://martinfowler.com/books/refactoring.html). Martin Fowler, 2018 (2nd edition), book page.
    - Quote: "Its essence is applying a series of small behavior-preserving transformations … By doing them in small steps you reduce the risk of introducing errors. You also avoid having the system broken while you are carrying out the restructuring".
    - Verification: confirmed.
  - [Refactoring Malapropism](https://martinfowler.com/bliki/RefactoringMalapropism.html). Martin Fowler, 3 Jan 2004, blog.
    - Quote: "If somebody talks about a system being broken for a couple of days while they are refactoring, you can be pretty sure they are not refactoring."
    - Verification: confirmed.
  - [Taming Agentic Refactoring with the Mikado Method](https://anischaabani.com/en/blog/mikado-method-ai-agents/). Anis Chaabani, 5 Jun 2026, blog.
    - Quotes: "At the first blocker, revert everything. `git reset --hard HEAD`. Return to a green state." "a 147-file pull request … where three failing tests were 'adapted' instead of fixed".
    - Verification: confirmed.
  - [The Mikado Method in the Age of AI Agents](https://wellaged.dev/posts/mikado-method-ai-agents/). WellAged.dev, undated, blog (AI-assisted drafting).
    - Quote: "Commit only when the session's sub-task passes all tests cleanly. If it does not pass, revert and refine the prerequisite definition."
    - Verification: confirmed. Low weight.
  - [Why You Shouldn't Speedrun a Production Refactor](https://dev.to/peter_vanonselen_e86eab6/why-you-shouldnt-speedrun-a-production-refactor-4l8h). Peter van Onselen (The Economist), 12 Dec 2025, blog.
    - A 280-file AI-assisted PR (200 files in a Go monolith and 80 in a new shared library) was redone as 8 incremental steps with no downtime.
    - Verification: confirmed.
- **Detect:**
  - `git rebase --exec '<build> && <fast tests>' <base>` passes at every commit.
  - Flag very large commits for splitting (for example over about 400 lines or 20 files; this threshold is a heuristic).
  - Look for repeated debugging loops after a red step in agent transcripts.
- **Tools:** git restore / git reset, git rebase --exec, a Mikado graph file in Markdown, IDE automated refactorings.
- **Applies to:** All refactoring, whether by a human or an agent. Most important for agents with limited context.
- **When not to apply / counterpoints:**
  - No controlled study establishes an optimal step size.
  - Running the full suite after every micro-step is costly. Use fast tests per step and the full suite per commit.
  - Some migrations cannot be done in small green steps. Stripe's single rehearsed codemod PR shows the alternative.
- **Fix risk:** low

### T09-F20 — Step-by-step safety protocol for an agent hardening a finished project (synthesis)
- **Grade:** B for the components; the sequence as a whole is unvalidated · **Verdict:** CORRECTED
  - Labelled explicitly as a synthesis, with each step pointing to its own graded finding.
  - Unsourced heuristics are marked as such: several baseline runs, and "the same step failing twice".
  - Commands are updated as in F01, F02 and F06.
- **Rule:**
  0. Start from a clean tree, on branch `refactor/hardening-<date>`, and record toolchain versions.
  1. Freeze the contract (F01).
  2. Establish the baseline: build, type-check, lint and several full randomized test runs. Stop if anything is red, and list flaky tests (F02).
  3. Plan: for each item, give its scope, the catalog refactoring name, its risk class (F11) and the metric it improves. Anything that changes behaviour goes on a separate list for the human.
  4. Audit the safety net: mutation-test the scoped files, and close the holes with characterization or approval tests in test-only commits (F03, F04, F05).
  5. Execute one item at a time:
     - apply a tool-backed transformation (F09);
     - compile and run fast tests after each step, and revert on red (F06);
     - keep tests and snapshots read-only (F12, F05);
     - verify moves mechanically (F10) and enforce the scope (F13);
     - use differential tests and parallel change for rewrites (F14, F15);
     - investigate odd code before changing it (F16);
     - keep formatting in its own commit (F17).
  6. Commit each green item as `refactor(<scope>): <refactoring>`, with one purpose per commit (F07). Verify that every commit is green (F08) and is a pure refactoring (F18).
  7. Run the final gate and write the report (F19).

  Stop conditions:
  - a red baseline;
  - a flaky test in scope;
  - surviving mutants that cannot be killed on lines to be changed;
  - any snapshot or golden diff;
  - any need to edit a test assertion;
  - any change in the public-API diff;
  - the same step failing twice (heuristic).
- **Rationale:**
  - Refactoring measurably induces bugs, so the protocol spends effort first on measuring the net and last on independent verification.
  - Each stop condition turns an observed failure mode into a hard halt: test gaming, re-typed moves, tangled scope, hierarchy risk, flaky oracles.
- **Evidence:**
  - [Di Penta et al. 2020](https://arxiv.org/pdf/2009.11685). Peer-reviewed.
    - Quote: "refactoring is only in theory behavior-preserving, therefore it must be planned with appropriate verification & validation activities aimed at reducing its risks."
    - Verification: PDF text confirmed.
  - [The key points of Working Effectively with Legacy Code](https://understandlegacycode.com/blog/key-points-of-working-effectively-with-legacy-code/). Nicolas Carlo, 2019–2026, blog (secondary summary of Feathers).
    - The Legacy Code Change Algorithm: identify change points, break dependencies, write tests, make changes, refactor. Scratch refactoring: "revert your changes when you're done".
    - Verification: confirmed.
  - [Self Testing Code](https://martinfowler.com/bliki/SelfTestingCode.html). Martin Fowler, 1 May 2014, blog.
    - Quote: "You have self-testing code when you can run a series of automated tests against the code base and be confident that, should the tests pass, your code is free of any substantial defects."
    - Verification: confirmed.
  - [ImpossibleBench](https://arxiv.org/html/2510.20270). 2025, preprint.
    - Supports the read-only-tests stop condition.
    - Verification: confirmed, see F12.
- **Detect:** The protocol can be audited afterwards:
  - test-only commits come before each item's refactor commits;
  - `git rebase --exec` passes on every commit;
  - no `refactor:` commit touches tests or snapshots;
  - RefactoringMiner explains every refactor hunk;
  - the final report exists.
- **Tools:** git, RefactoringMiner, mutation tools, ApprovalTests and snapshot libraries, API-diff tools, IDE/LSP engines, OpenRewrite, ast-grep, LibCST.
- **Applies to:** Any finished, working project.
- **When not to apply / counterpoints:**
  - The protocol is heavyweight for tiny scripts. Scale it down to baseline, small steps, frozen tests and a final full run.
  - Mutation tooling is less turnkey for C/C++ and Go.
  - A single rehearsed codemod can beat many small steps for fully mechanical, type-checked migrations.
- **Fix risk:** low

### T09-F10 — When moving or extracting code, check mechanically that the moved block is unchanged
- **Grade:** C · **Verdict:** CORRECTED. The HN incident broke **32 of 40** links, not 31. The commenter reports that the fifth link failed and then "the other 31 links. ALL of them 404ed".
- **Rule:**
  - Use `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change`, and `git diff -M100%` for whole-file renames.
  - Any line inside a move that is not marked as moved is a real edit and must be justified.
  - Check that no comments were dropped.
  - This matters most for LLM agents.
- **Rationale:**
  - Practitioners observe that agents delete code and re-emit it from memory instead of copying it.
  - The peer-reviewed data includes an Extract Method that swapped two statements.
- **Evidence:**
  - [Two things LLM coding agents are still bad at](https://kix.dev/two-things-llm-coding-agents-are-still-bad-at/). Kix (kixpanganiban), 9 Oct 2025, blog.
    - Quote: "they'll 'remember' a block or slice of code, use a delete tool on the old file, and then a write tool to spit out the extracted code from memory."
    - Verification: confirmed.
  - [HN discussion](https://news.ycombinator.com/item?id=45523537). rossant, 9 Oct 2025, practitioner forum.
    - Quote: "I asked Codex CLI to refactor some HTML files. … it rewrote them from memory, removing comments in the process." The LLM "had HALLUCINATED most of the path part of the URLs", leaving 32 of 40 links returning 404.
    - Verification: confirmed via the HN API. Count corrected.
  - [git-diff](https://git-scm.com/docs/git-diff). Git project, current, official docs.
    - Quotes: "Blocks of moved text of at least 20 alphanumeric characters are detected greedily". `allow-indentation-change` groups moved blocks "if the change in whitespace is the same per line". "To limit detection to exact renames, use -M100%."
    - Verification: confirmed.
  - [Bavota et al. SCAM 2012](https://people.lu.usi.ch/bavotg/papers/scam2012.pdf). Peer-reviewed.
    - Quote: "A wrong swap of order between two instructions during the performed Extract Method has introduced the following bug (Issue #2287)".
    - Verification: PDF text confirmed.
- **Detect:**
  - Run `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change <base>..HEAD -- <files>` and inspect lines inside moved regions that are not marked as moved.
  - Run `git diff -M100% --name-status`.
  - Compare comment counts before and after for each moved file.
- **Tools:** git diff --color-moved, git diff -M100%, IDE Move refactoring, ripgrep.
- **Applies to:** Extract, move and split refactorings, especially when an LLM agent performs them.
- **When not to apply / counterpoints:**
  - Extraction legitimately changes parameters, returns and imports.
  - Blocks under 20 alphanumeric characters are not detected as moved.
  - The evidence is one blog post, one HN anecdote and one peer-reviewed example. No systematic rate has been published.
- **Fix risk:** low

## Practitioner voice
- [A Short Cautionary Tale About Refactoring (HN, 2021)](https://news.ycombinator.com/item?id=26512036): "Cleaning up" an inlined PNG into an image loaded over HTTP broke an offline error screen. The thread's lesson: "never remove a fence until you can explain why it's there"; "Assume the original authors are not entirely stupid".
- [Why you shouldn't speedrun a production refactor (van Onselen, The Economist, Dec 2025)](https://dev.to/peter_vanonselen_e86eab6/why-you-shouldnt-speedrun-a-production-refactor-4l8h): A 280-file AI-assisted PR could not be shipped. It was redone as 8 incremental steps with no downtime. "AI amplifies your need for discipline."
- [I caused a SEV (Kadluczka, Jul 2024)](https://dev.to/moozzyk/i-caused-a-sev-here-is-what-i-learned-4o5d): A change meant to leave output unchanged dropped all data because of a forgotten downstream feature flag. Lessons: don't run it as an intermittent side project, and "always validate changes end-to-end".
- [Two things LLM coding agents are still bad at (HN, Oct 2025)](https://news.ycombinator.com/item?id=45523537): Codex CLI rewrote HTML from memory, dropped comments and hallucinated URL paths, so 32 of 40 links returned 404. The count is corrected from 31.
- [Taming Agentic Refactoring with the Mikado Method (Chaabani, Jun 2026)](https://anischaabani.com/en/blog/mikado-method-ai-agents/): Agentic refactors fail through "change greediness", context scattering and "the illusion of green", for example a 147-file PR where failing tests were "adapted". The remedy is Mikado with a hard revert at the first blocker.
- [The Mikado Method in the Age of AI Agents (WellAged.dev, undated; drafted with AI assistance)](https://wellaged.dev/posts/mikado-method-ai-agents/): Commit only when the sub-task is green, otherwise discard it, because "discarding a branch costs nothing". Example: an agent widens a type, every call site's tests pass, and one downstream caller that "compares strictly" breaks. Low weight.
- [HN, muzani (Jul 2025)](https://news.ycombinator.com/item?id=44468896): 'I've seen claude "monkey patching" a system so that it returns true to the tests.' A reply reports the same behaviour from GitHub Copilot.
- [The High-Risk Refactoring (HN, Mar 2024)](https://news.ycombinator.com/item?id=39735570): "don't go off into a cave for days, weeks or even many months before merging". Pushback: "People massively overestimate the risks of refactoring and massively underestimate the risks of not refactoring."
- [HN, bunderbunder (2018)](https://news.ycombinator.com/item?id=18554854): "Approval Tests … can be a huge timesaver when you're getting that initial black box characterization put together"; rewrite "as a long-term, component-wise, in-place rewrite".
- [HN, shoo (2018)](https://news.ycombinator.com/item?id=17505586): The chicken-and-egg problem of legacy code: "you dont want to refactor without having regression tests, yet you need to refactor to wedge the tests in."
- [HN, matthew16550 (2025)](https://news.ycombinator.com/item?id=45433664): Approval, golden-master, snapshot and characterization testing are "more or less the same idea". "This can help when refactoring, hopefully an accidental side effect will appear as an unexpected diff."
- [HN, dkubb (2015)](https://news.ycombinator.com/item?id=9746519): Mutation testing "can sometimes take several hours for the whole codebase", so it runs only on merges to a specific branch.
- [HN, 0hjc, creator of pitest (2015)](https://news.ycombinator.com/item?id=9510591): "I rarely encounter equivalent mutants using the default operators". Some pitest rollouts "break the build on anything less than 100% mutation coverage". The researcher had described him as a "PIT user"; he says "Having built pitest".
- [HN, burntsushi (2024)](https://news.ycombinator.com/item?id=41658991): "I like to split the refactor into one commit and then the actual interesting change into another commit. I believe this makes it easier for reviewers". He adds "not always, because sometimes it's hard".
- [HN, MaulingMonkey (2016)](https://news.ycombinator.com/item?id=13180224): A manual bisect on Perforce found a "Totally innocuous change" behind a "fruitless 2 week session of debugging". Small changelists save that time. He also separates reformatting commits from refactoring commits.
- [HN, JanSchu (Apr 2026)](https://news.ycombinator.com/item?id=47749688): In an AI-built app, multi-tenant permission logic leaked data across tenants. "These bugs passed tests, which is what made them dangerous." This is about building an app, not refactoring, but it shows green tests are not proof.
- [The Perils of Jest Snapshot Testing (Hrynkow, 2019)](https://peterhrynkow.com/testing/2019/01/07/the-perils-of-snapshot-testing.html): Snapshot fatigue leads to blind updates that cement bugs, such as a `traget` typo. Snapshots also make refactoring painful.
- [Refactoring without tests should be fine (Noback, Oct 2022)](https://matthiasnoback.nl/2022/10/refactoring-without-tests-should-be-fine/): In theory, small structural transformations need no tests. In practice, failures come from syntax slips (which PHPStan catches), missed dynamic call sites, tests coupled to the current structure, and behaviour changes slipped in. His own examples include "I removed stuff that seemed unused".
- [Move Fast and Fix Things (GitHub, 2015)](https://github.blog/engineering/engineering-principles/move-fast/): Running old and new merge code side by side with Scientist exposed mismatches, including "768 conflicts … reported as 0". The rollout took about 5 part-time days, with better tail latency.
- [Migrating millions of lines of code to TypeScript (Stripe, 2022)](https://stripe.dev/blog/migrating-to-typescript): A counterexample to "always small steps". 3.7 million lines were converted in one PR with a codemod refined over about a year, type checking, tests and `@ts-expect-error` suppressions.

## Contradictions and open questions

**Contradictions**
- **Separating structure from behaviour.**
  - For: Beck, Google, the Linux kernel and burntsushi recommend it.
  - Against: the only controlled experiment found (di Biase et al., PeerJ CS 2019, 28 participants) showed no gain in defects found (17 decomposed vs 20 tangled, p=0.6) and no change in review time (759 s vs 831 s, p=0.66). Decomposition only reduced false positives (0.07 vs 0.42, p=0.03). Google allows small cleanups in feature CLs.
  - Verdict: separation is well supported for bisectability and reversibility, and weakly supported for review effectiveness.
- **Automated engines versus manual or LLM edits.**
  - For engines: RefactoringMirror and EM-Assist re-apply refactorings through tested engines.
  - Against: engines have bugs too. Wang et al. report 130 new bugs; 21 were submitted and 10 of those confirmed by developers. Microsoft developers do 86% of their refactoring by hand.
  - Verdict: engines are safer than free text, but not safe enough to skip tests.
- **How risky is refactoring?**
  - Riskier: the file-level median odds ratio is 2.13, and Pull Up Method and Extract Subclass induce fixes in about 40% of cases, on few instances.
  - Less risky:
    - at line level, the odds ratio "decreases dramatically";
    - manual validation blamed the refactoring in only 38% of fix-inducing commits;
    - the most-refactored Windows binaries reduced post-release defects 12.2% more than others;
    - practitioners argue the risk is overestimated.
- **Big-bang versus incremental.**
  - Incremental: Fowler, Mikado, strangler fig, and the failed 280-file PR.
  - Big-bang: Stripe's 3.7-million-line single PR and Google's automated large-scale changes. Both are fully mechanical and type-checked.
- **Snapshot tests as a safety net.**
  - For: ApprovalTests, Bache and Feathers promote them for capturing behaviour quickly.
  - Against: snapshot fatigue and over-frozen UI structure conflict with Beck's structure-insensitivity.
- **How much does coverage tell you?**
  - Weak: Inozemtseva & Holmes (ICSE 2014, 31,000 suites, suite size controlled) find coverage "not strongly correlated" with effectiveness.
  - Stronger: Gopinath et al. (ICSE 2014) find statement coverage the best predictor of mutation kills across many real projects. Kochhar et al. (SANER 2015) find a statistically significant correlation with killing real bugs, moderate on HTTPClient and strong on Rhino.
  - Reconciliation: the studies differ in whether suite size is controlled and whether suites are compared within one program or across programs. All of them treat fault or mutant detection as the real target, which supports measuring that directly.
- **Mutation-score targets.**
  - Some pitest rollouts gate at 100%.
  - Stryker says not to fear scores under 100%, and Google suppresses arid lines.
  - No empirical threshold exists.
- **Refactoring without tests.**
  - Noback: in theory, small structural transformations are safe without tests. In practice, he still lists four failure sources.
  - Against: Microsoft engineers say "refactoring should not be done" without tests or scenarios, and Feathers prescribes characterization tests first.
- **Do tangled agent refactorings hurt correctness?**
  - They are associated with lower compilability (OR 0.42), but not with correctness overall (p=0.543).
  - Method-level refactorings are associated with lower correctness (OR 0.22).
- **Do agents' refactorings improve quality?**
  - Horikawa et al.: agents refactor often (26.1% of commits explicitly target refactoring), but the smell reduction is "not practically significant". That challenges the value of unscoped, agent-driven cleanups.

**Open questions**
- No empirical study measures the best step size or test cadence for refactoring, for either humans or agents.
- No evidence-based mutation-score threshold exists. "Zero unjustified survivors on lines to be modified" is itself unvalidated.
- Risk by refactoring type is established only for Java and OOP. Nothing comparable exists for Python, JS/TS, Rust or Go.
- No tool systematically detects which incidental behaviours (Hyrum's Law) consumers depend on.
- LLM reviewers as correctness oracles: Gheyi et al. used Java IDE bugs only. There is no data on false-positive burden or on non-Java code.
- Read-only tests block direct edits but not special-casing, and nothing is known about cheating specific to refactoring.
- There is no measured rate of agents re-typing moved code; the evidence is anecdotal.
- RefactoringMiner has no published accuracy benchmark for TypeScript or C/C++.
- Weißgerber & Diehl (MSR 2006), Vakilian et al. (ICSE 2012) and the Mikado Method book were not opened, and are not used.
- The coverage counter-studies (Gopinath 2014, Kochhar 2015) were checked from their abstracts only. Their exact correlation coefficients, and later work such as Chen et al. on test-set size, were not read in full.
- The published version of Pomian et al. (possibly ICSME 2024, under a different title) was not checked for whether its figures match the preprint.

## Dropped findings
(none: all 20 findings have real, checkable sources; corrections and downgrades are noted inline)
