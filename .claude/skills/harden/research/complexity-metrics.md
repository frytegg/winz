# Complexity metrics: what the evidence says
> Code T03 · slug complexity-metrics · verified 2026-09-23 · counts: verified 4 / corrected 10 / downgraded 3 / dropped 0

**How this was checked.** Every cited URL was opened. WebFetch was used where it worked. Where it was blocked (403, TLS) or returned binary PDF data, the source was fetched with `curl` or `gh api` instead. Academic PDFs were downloaded, converted with `pdftotext`, and each quoted passage was searched for in the extracted text.

Tool defaults were checked against the tools' own source or reference config:
- Clippy lint sources and `clippy_config/src/conf.rs`;
- `lizard.py`;
- Pylint `extensions/mccabe.py` and the all-options page;
- Ruff settings and rule pages;
- golangci-lint reference settings;
- RuboCop `config/default.yml` at v1.91.0 and `CHANGELOG.md`;
- the sonar-java `Sonar_way` profile directory;
- the SonarJS S3776 rule source.

Releases were checked on GitHub:

| Tool | Version | Date |
|---|---|---|
| ESLint | v10.11.0 | 2026-09-18 |
| Pylint | v4.0.9 | 2026-09-23, today; the researcher cited 4.0.8 |
| RuboCop | v1.91.0 | 2026-09-10 |
| lizard | 1.24.0 | 2026-08-19 |
| PMD | 7.27.0, latest release | 2026-08-28; the rule docs page is 7.28.0-SNAPSHOT, so "PMD 7.28.0" as cited is not a release |

One source could not be read in full: **Lavazza et al., JSS 2023**. The publisher returns 403. The open-access copy (Insubria IRIS) sits behind a Cloudflare challenge, and there is no arXiv copy. Crossref, Semantic Scholar and Zenodo record 7327409 confirm that the paper exists and who wrote it. Its conclusion is **not** confirmed, so it is no longer used as support.

A previous run of this verification wave left a dossier at this path, and this pass replaces it. Every disputed point was re-checked against the primary text. One earlier correction was wrong: the Muñoz Barón et al. quote in F14 **does** appear in the paper (arXiv v1, §5.3), so F14 is VERIFIED.

## Summary

**Size is the first-order signal, and it confounds the other metrics.** How strongly cyclomatic complexity (CC) tracks lines of code (LOC) depends on the level of measurement:
- **File level, with log transforms.** Jay et al. (2009) regress on about 1.2M SourceForge files and find that LOC predicts about 90% of CC's variance. Landman et al. tabulate this as log(LOC) vs log(CC); after repeated-median regression, R² is 0.87-0.97.
- **Method level.** Landman et al. study 17.6M Java methods and 6.3M C functions and find R² of only 0.40 (Java) and 0.44 (C). The variance grows with size, and they conclude that CC is *not* redundant with size.
- **Maintenance effort.** In a comparative case study of four functionally equivalent systems, only size and low cohesion were strongly tied to maintenance effort (Sjøberg et al., ESEM 2012). That is one small study, not a replicated law.
- **Comprehension studies.** Length may confound earlier comprehension results (Chin & Holmes, ICPC 2026: 604k methods, 49 projects, 5 languages).
- **Controlling for size.** Once size is controlled by regression, metrics still carry signal (Chowdhury et al., EMSE 2022, 730K Java methods). Dividing a metric by LOC does **not** control for size.

**CC is a test count, and a weak proxy for readability.**
- NIST SP 500-235 defines CC as the number of tests the structured-testing method needs.
- The same document says complexity limits are justified mainly by CC's *correlation with reliability, maintainability and understandability*. So NIST does **not** say that CC is unrelated to readability.
- It is Checkstyle ("it is not about quality of code!") and SonarSource's white paper (CC is "unsatisfactory" for maintainability) that separate CC from readability.

**Cognitive complexity is only partly validated.** A meta-analysis of about 24,000 evaluations of 427 snippets (Muñoz Barón et al., ESEM 2020) found:
- correlation with comprehension time: r = 0.54, with I² = 85%;
- correlation with subjective ratings: r = -0.29;
- no reliable correlation with correctness (-0.13, CI crosses 0) or physiological measures (0.00).

Esposito et al. (216 early-career developers; arXiv 2023, IEEE Access 2025) found CC and cognitive complexity to be only "modest predictors". Clippy keeps its lint in the allow-by-default `restriction` group, and its docs say the true cognitive complexity "is not something we can calculate using modern technology".

**No threshold has been validated.**
- McCabe called 10 "reasonable, but not magical". NIST allows up to 15 only for projects with operational advantages, such as experienced staff, formal design and a comprehensive test plan.
- Tool defaults range from 7 to 30 for CC and from 15 to 30 for cognitive complexity.
- The meta-analysis had almost no snippets above 15 and gives no threshold.
- Among the 233 top-500 Ruby repos that ship a config, 37-43% disable RuboCop's complexity and size cops. Where teams change a limit, the median is CC 10, perceived complexity 12, method length 22 and block nesting 3.
- RuboCop 1.91.0 disables these cops (BlockNesting included) under `Preview`, ahead of disabling them by default in 2.0.

Thresholds should therefore trigger a review, not fail the build of a finished codebase.

**Nesting deeper than 3 levels is the most widely shared structural limit.** The Linux kernel ("more than 3 levels of indentation"), PMD `AvoidDeeplyNestedIfStmts` (3) and RuboCop `BlockNesting` (3) agree. ESLint uses 4, and Pylint/Ruff use 5.

Agreement is not validation, though. Nesting depth predicts change-proneness for small methods better than for large ones. Even RuboCop, whose median override is exactly 3, plans to turn BlockNesting off by default, because about a fifth to a quarter of configs disable it.

**Method length rests on one large study.** In 785K Java methods, methods of 24 SLOC or fewer were less change-prone and less bug-prone (Chowdhury et al., MSR 2022).
- The 24-SLOC cut-off came from a benchmark-percentile method.
- On change-proneness, small-vs-medium effects were medium to large across the 49 projects; on bug-proneness they were mostly negligible to small. (The "large between small and medium, small for the other two" wording describes one illustrative project, per the citation audit.)
- A controlled experiment on functional decomposition was inconclusive (Tempero et al., ICPC 2024).

Experienced practitioners (Ousterhout, Carmack, qntm) report harm from splitting too far. Robert Martin wrote in *Clean Code* that he cannot cite research showing very small functions are better. The skill should therefore check its own refactors for shallow, entangled, single-use helpers.

**The Maintainability Index (MI) is not actionable, and its evidence is mixed.**
- Its formula was fitted to Hewlett-Packard C and Pascal systems written in the late 1980s (1,000-10,000 lines), published in the early 1990s.
- It combines averaged, size-correlated inputs.
- Visual Studio's red/yellow/green cut-offs were chosen "to keep the noise level low".
- In one four-system case study, MI ranked the systems opposite to their measured maintenance effort.
- **Counter-evidence:** in Chowdhury et al. (EMSE 2022), MI was the best-performing metric beyond size for predicting change-proneness.

Because MI does not say what to fix, report its components instead.

**Prioritise, then protect.**
- Rank work by complexity combined with change frequency. The evidence for this is mostly from the vendor (CodeScene), plus the general link between complexity and failures (Nagappan et al., 5 Microsoft systems).
- Add tests before touching a complex function. 77% of the Microsoft engineers surveyed (Kim et al., FSE 2012) see refactoring as risking subtle regressions, and the CA1502 docs warn against destabilising shipped code.

**Algorithmic complexity needs separate checks.** Complexity scores do not see accidentally quadratic code (GTA Online loading, the Windows WMI repository check) or regex catastrophic backtracking (Cloudflare, 2 July 2019). These are found with pattern checks and profiling.

## Findings

### T03-F01 — Report function size (SLOC/NLOC) next to every complexity number. Treat size as the first-order signal and a likely confounder. Never normalise complexity by dividing by LOC, and never claim a complexity improvement that is really a size reduction.
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  1. The rationale said "across studies, size is the metric most consistently tied to maintenance effort (Sjøberg)". Sjøberg et al. is one comparative case study of 4 systems and 6 developers, so that claim now carries this caveat. The same fix was made to the summary's "best-replicated predictor".
  2. "Treat size as the main signal" became "first-order signal and confounder". Landman et al. and Chowdhury et al. both show that complexity adds information beyond size at method level.
  3. The residual-fit heuristic in Detect is now marked as the researcher's own and unvalidated.
- **Rationale:** At method level, CC and SLOC are only moderately related (R² 0.40/0.44), and CC's variance grows with size. At file level, or after log transforms, the relationship looks almost perfect; that is the level at which Jay et al. drew their conclusion. Length correlates with most earlier comprehension metrics and may explain their results. In fMRI, textual size drives attention. Dividing a metric by LOC leaves the size effect in place, while regression with size as a covariate shows that metrics add signal. So always read complexity next to size:
  - a long function with low CC is a size problem;
  - a short function with high CC is dense decision logic.
- **Evidence:**
  - [Empirical analysis of the relationship between CC and SLOC in a large corpus of Java methods and C functions (JSEP preprint)](https://aserebre.win.tue.nl/Landman2015-ccsloc-jsep2015-preprint.pdf) — Landman, Serebrenik, Bouwers, Vinju, J. Softw. Evol. Process (2016) — peer_reviewed — "The R2 of SLOC and CC is 0.40 for Java and 0.44 for C"; corpora of "17.6 M methods" and "6.3 M functions"; "not strong enough to conclude that CC is redundant with SLOC"; "aggregating CC and SLOC as well as performing a power transform improves the correlation" — VERIFIED in the PDF text (§4.3 and abstract).
  - [Revisiting the Debate: Are Code Metrics Useful for Measuring Maintenance Effort? (EMSE preprint)](https://www.cs.ubc.ca/~rtholmes/papers/emse_2022_chowdhury_preprint.pdf) — Chowdhury, Holmes, Zaidman, Kazman, Empirical Software Engineering 27 (2022), DOI 10.1007/s10664-022-10193-8 — peer_reviewed — 730K Java methods, 47 projects: "the commonly used size normalization approach fails to neutralize the influence of size and should not be used in practice"; "code metrics can in fact help estimate maintenance effort, such as change proneness, even when the confounding influence of size is eliminated" — VERIFIED in the PDF text; venue confirmed through Crossref.
  - [Cyclomatic Complexity and Lines of Code: Empirical Evidence of a Stable Linear Relationship](https://www.scirp.org/journal/paperinformation?paperid=779) — Jay, Hale, Smith, Hale, Kraft, Ward, J. Software Engineering & Applications 2(3), 2009 — peer_reviewed (low-profile open-access venue) — "CC can be said to have absolutely no explanatory power of its own"; models "predict roughly 90% of CC's variance by LOC alone"; more than 1.2 million SourceForge files — VERIFIED from the abstract. Landman's Table I lists the analysis as file-level log(LOC) vs log(CC).
  - [Put The "Code" Back In "Code Comprehension Study" (ICPC '26)](https://www.cs.ubc.ca/~rtholmes/papers/icpc_2026_chin.pdf) — Chin, Holmes (UBC), ICPC 2026, DOI 10.1145/3794763.3794806 — peer_reviewed — 604k methods, 49 projects, five languages: "Length--the number of lines of code in a method--heavily correlates with prior comprehension metrics and may be a confounder of prior results"; "comments co-locate with large, complex, and hard-to-read code" — VERIFIED. The authors excluded the top 1% longest methods in each project and methods of 3 LOC or fewer.
  - [Questioning Software Maintenance Metrics: A Comparative Case Study (ESEM 2012)](https://www.mn.uio.no/ifi/personer/vit/dagsj/sjoberg.anda.mockus.esem.2012.pdf) — Sjøberg, Anda, Mockus — peer_reviewed — "The metrics were not mutually consistent. Only system size and low cohesion were strongly associated with increased maintenance effort." — VERIFIED. Scope: 4 systems, 6 developers, 3 tasks.
  - [Program Comprehension and Code Complexity Metrics: An fMRI Study (ICSE 2021)](https://conf.researchr.org/details/icse-2021/icse-2021-papers/10/Program-Comprehension-and-Code-Complexity-Metrics-An-fMRI-Study) — Peitek, Apel, Parnin, Brechmann, Siegmund — peer_reviewed — 19 participants, "more than 41 metrics": "the code's textual size drives programmers' attention", "vocabulary size burdens programmers' working memory"; metrics explain cognition only "to a limited degree" — VERIFIED from the abstract; venue confirmed through Crossref (DOI 10.1109/ICSE43902.2021.00056).
- **Detect:**
  - Run a per-function metrics dump. Polyglot: `lizard --csv <src>` (columns NLOC, CCN, token, PARAM, length, location...). Python: `radon cc -s -j <src>` plus `radon raw`.
  - Sort by NLOC and by CCN, and print NLOC next to every CCN or cognitive score in the report.
  - Flag the largest functions by NLOC.
  - Optional heuristic (the researcher's own, unvalidated): fit CCN against NLOC on the repository and flag large positive residuals as "dense branching". Use it only to rank candidates.
- **Tools:** lizard 1.24.0, radon, scc, SonarQube, CodeScene.
- **Applies to:** All languages. Make decisions at function/method level; use file-level aggregates only for overviews, because aggregation inflates the size-CC correlation.
- **When not to apply / counterpoints:**
  - At method level CC is not redundant with size (Landman; Chowdhury EMSE), so do not drop complexity metrics.
  - Generated code, data tables and long flat configuration builders inflate LOC without adding cognitive load.
  - Jay et al.'s "no explanatory power" applies only to aggregated, file-level data.
- **Fix risk:** low. This is measurement only; the risk lies in the refactors it triggers (F05-F08, F13).

### T03-F04 — Exempt a single flat multiway dispatch (a switch/match/lookup whose cases are all simple) from CC limits, but do not change how the metric is computed to hide it. Revisit a switch only when its cases contain nested logic, or when the same switch on the same value appears in several places.
- **Grade:** A · **Verdict:** CORRECTED.
  - All six sources were confirmed.
  - The detection step recommended ESLint `variant: "modified"` and Checkstyle `switchBlockAsSingleDecisionPoint`. Those settings are the kind of "modified complexity" that NIST says was gamed, which contradicts the rule itself. They are now a side-by-side second opinion only, never the gate.
  - The CC-high/cognitive-low heuristic is labelled as unvalidated.
- **Rationale:** CC adds one per case, so a flat switch over many values scores high while staying easy to read.
  - McCabe allowed large case statements.
  - NIST recommends exempting modules that consist of a single multiway decision. It adds that the exemption does not apply automatically when the branches are themselves complex.
  - The Linux kernel, Microsoft CA1502 and a Clippy maintainer agree.
  - NIST also records how discounting switches in the metric was gamed: a module went from 90 to a "modified" 10 by adding a do-nothing 10-branch switch.
  - Cognitive complexity already charges a whole switch +1, which makes it the better tool for finding the switches that deserve attention.
- **Evidence:**
  - [A Complexity Measure (IEEE TSE SE-2(4))](http://www.literateprogramming.com/mccabe.pdf) — Thomas J. McCabe, 1976 — peer_reviewed — "The only situation in which this limit has seemed unreasonable is when a large number of independent cases followed a selection function (a large case statement), which was allowed." — VERIFIED in the PDF text. WebFetch fails on this URL (TLS), so it was fetched with curl.
  - [Structured Testing (NIST SP 500-235), §2.5](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — Watson, McCabe (D. R. Wallace, ed.), NIST 1996 — standard — "it is reasonable to exempt modules consisting of a single multiway decision statement from a complexity limit. Note that if the branches of the decision statement contain complexity themselves, the rationale and thus the exemption does not automatically apply"; "take a module with complexity 90 and reduce it to 'modified' complexity 10 simply by adding a ten-branch multiway decision statement to it that did nothing." — VERIFIED.
  - [Linux kernel coding style: Functions](https://www.kernel.org/doc/html/latest/process/coding-style.html) — Linux kernel — official_docs — "if you have a conceptually simple function that is just one long (but simple) case-statement, where you have to do lots of small things for a lot of different cases, it's OK to have a longer function." — VERIFIED.
  - [CA1502: Avoid excessive complexity](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Microsoft Learn (updated 2026-09-09) — official_docs — "a method that contains a large `switch` (`Select` in Visual Basic) statement is a candidate for exclusion." — VERIFIED.
  - [Cognitive Complexity white paper v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — G. Ann Campbell, SonarSource, 29 Aug 2023 — vendor spec — "A switch and all its cases combined incurs a single structural increment." — VERIFIED.
  - [rust-clippy issue #3793](https://github.com/rust-lang/rust-clippy/issues/3793) — oli-obk (Clippy maintainer), 21 Feb 2019 — practitioner_forum — "pure CyC has been found to be pretty useless in Rust as you often use matches not to run different code but more as a lookup table for values." — VERIFIED through the GitHub API.
- **Detect:**
  - Cross-check two metrics. Functions with high CC (>= 10) and low cognitive complexity (<= 5) are usually flat switches or if/else-if chains. Read them and treat them as exemption candidates; this heuristic is the researcher's own.
  - Flag switches whose case bodies contain nested if/for/while, for example with ast-grep: a `switch_statement` that `has` an `if_statement` with `stopBy: end`.
  - Find repeated dispatch on the same discriminant across files, e.g. `rg -n "switch \(\w+\.(type|kind)\)"`.
  - ESLint `complexity` `variant: "modified"` and Checkstyle `switchBlockAsSingleDecisionPoint` exist and are confirmed in the tools' docs. Use them only for side-by-side comparison, never to replace the classic gate.
- **Tools:** ast-grep, ripgrep, ESLint `complexity` (classic/modified), Checkstyle, SonarQube, lizard.
- **Applies to:** All languages with switch/match/case; especially Rust `match`, Kotlin `when` and TypeScript discriminated unions.
- **When not to apply / counterpoints:**
  - When the same switch repeats across the codebase, refactoring catalogues suggest polymorphism or a table.
  - Casey Muratori's single microbenchmark (a toy shape-area example, 2023) found the switch about 1.5x faster than virtual dispatch, and a table about 10x faster than virtual dispatch. Polymorphism is not free in hot paths.
  - A single switch still needs one test per branch (NIST).
- **Fix risk:** medium, if someone "fixes" the switch anyway. Replacing a switch with a map or polymorphism can:
  - lose compiler exhaustiveness checks (TypeScript `never` checks, Rust `match`);
  - change default and fallthrough behaviour;
  - change performance.

### T03-F13 — Before refactoring any complex function in a finished project, check its branch coverage. CC is an upper bound on the tests needed to cover every branch, and exactly the number of basis-path tests. If coverage is missing, add characterization tests first, or leave the function unrefactored and report it.
- **Grade:** B · **Verdict:** VERIFIED. All four sources were confirmed.
- **Rationale:**
  - CC was designed as a test-planning metric. Covering all edges "never requires more than the cyclomatic complexity number of paths", and structured testing needs exactly CC tests.
  - Savoia's CRAP formula makes the risk explicit: with no coverage it grows with CC², and with full coverage it equals CC.
  - 77% of the 328 Microsoft engineers surveyed see refactoring as risking subtle bugs and regressions.
  - The .NET docs warn against destabilising shipped code.

  Complex code without tests is where "behaviour-preserving" refactoring is least likely to preserve behaviour.
- **Evidence:**
  - [NIST SP 500-235, §2](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — NIST 1996 — standard — "to cover all edges never requires more than the cyclomatic complexity number of paths. However, executing a basis set just to cover all edges is overkill."; "number of tests required to satisfy the structured testing criterion is exactly the cyclomatic complexity" — VERIFIED.
  - [Pardon My French, But This Code Is C.R.A.P.](https://www.artima.com/weblogs/viewpost.jsp?thread=210575) — Alberto Savoia, Artima, 19 Jul 2007 — engineering_blog — "C.R.A.P.(m) = comp(m)^2 * (1 – cov(m)/100)^3 + comp(m)"; this post gives no threshold (it defers that question to a later part) — VERIFIED.
  - [A Field Study of Refactoring Challenges and Benefits (FSE 2012)](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/kim-fse-2012.pdf) — Kim, Zimmermann, Nagappan — peer_reviewed — "In total, 328 engineers participated"; "77% of the participants consider that refactoring comes with a risk of introducing subtle bugs and functionality regression"; "24% mention increased testing cost"; "the refactoring definition in practice is not confined to a rigorous definition of semantics-preserving code transformations" — VERIFIED.
  - [CA1502 (When to suppress warnings)](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Microsoft — official_docs — "It is safe to suppress a warning from this rule if the complexity cannot easily be reduced and the method is easy to understand, test, and maintain." — VERIFIED.
- **Detect:**
  1. Collect per-function branch coverage: `vitest run --coverage` (v8/istanbul branch %), `pytest --cov --cov-branch --cov-report=json`, JaCoCo branch counters, `cargo llvm-cov`. `go test -coverprofile` gives statement coverage only.
  2. Join it with lizard CCN per function and compute CRAP = CCN² × (1 − cov)³ + CCN.
  3. Refactor a function only when branch coverage is high, or after adding tests.
  4. Report high-CRAP functions as "needs tests before refactor". No CRAP cut-off is sourced; Savoia's post gives none.
- **Tools:** Vitest coverage, pytest-cov, JaCoCo, `go test -cover`, cargo-llvm-cov, lizard.
- **Applies to:** All languages; mandatory for refactors in finished, working projects.
- **When not to apply / counterpoints:**
  - Edge coverage usually needs fewer tests than CC (NIST).
  - Coverage does not prove that behaviour is preserved, because weak assertions pass anyway. Mutation testing is stronger but slower.
- **Fix risk:** low. Adding tests does not change runtime behaviour. Characterization tests can lock in existing bugs; record suspicious behaviour instead of silently "fixing" it.

### T03-F14 — When judging readability, read the code and form a judgement first, then look at the metric. Present metric values as supporting evidence, never as the verdict. Do not tell the user a function is hard to understand solely because a tool scored it above a threshold.
- **Grade:** B · **Verdict:** VERIFIED. The earlier run claimed that the Muñoz Barón quote does not exist. It is in arXiv v1, §5.3 ("Implications"): "Unfortunately, the question remains open as to when a section of code can actually be described as too complex."
- **Rationale:** In a randomized, double-blind experiment, the displayed metric value had a significant and large anchoring effect on developers' comprehensibility ratings, without changing their time or correctness on comprehension questions. Metrics only modestly predict perceived understandability and do not predict problem severity. Esposito et al. add that when either metric is high, understandability becomes unpredictable. A third-party reviewer that repeats the linter adds no independent judgement.
- **Evidence:**
  - [The Mind Is a Powerful Place: How Showing Code Comprehensibility Metrics Influences Code Understanding (ICSE 2021)](https://arxiv.org/abs/2012.09590) — Wyrich, Preikschat, Graziotin, Wagner, ICSE 2021, pp. 512-523 — peer_reviewed — "We conducted a randomized and double-blind experiment"; "a significant and large anchoring effect on a developer's code comprehensibility rating. The effect does not seem to affect the time or correctness when working on comprehension questions"; the authors ask for tools "to be based on scientific evidence" — VERIFIED in the PDF text.
  - [Early Career Developers' Perceptions of Code Understandability. A Study of Complexity Metrics](https://arxiv.org/abs/2303.07722v2) — Esposito, Janes, Kilamo, Lenarduzzi; arXiv v2 (15 Jul 2024), published in IEEE Access 2025 (DOI 10.1109/ACCESS.2025.3585777, confirmed through Crossref) — peer_reviewed — "modest predictors for code understandability when considering the complexity perceived by early-career developers, they are not for problem severity"; "having either CoC or CyC high makes understandability unpredictable" — VERIFIED.
  - [Muñoz Barón et al., §5.3](https://arxiv.org/abs/2007.12520v1) — ESEM 2020 — peer_reviewed — "Unfortunately, the question remains open as to when a section of code can actually be described as too complex." — VERIFIED in the PDF text.
- **Detect:** This is a process rule for the skill. For each flagged function:
  1. Read the code without looking at the score.
  2. Write one sentence on what makes it hard (nesting, interleaved concerns, hidden state, boolean soup), or write "reads fine".
  3. Only then attach the metrics.

  If step 2 says "reads fine", record an exemption instead of refactoring.
- **Tools:** (procedure).
- **Applies to:** All review output of the hardening skill.
- **When not to apply / counterpoints:** Metrics are still useful for finding candidates at scale (F02). The anchoring study measured subjective ratings; performance was unaffected.
- **Fix risk:** low (none).

### T03-F02 — Use cyclomatic complexity (CC) as a test-effort metric (the number of basis paths). Use cognitive complexity, or nesting plus CC, only to select functions to review for readability. Never present either as a validated measure of understandability, or as proof that a refactor made code easier to read.
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  1. **Misattribution fixed.** The researcher cited NIST SP 500-235 as saying that CC counts tests "not how readable it is". NIST says CC gives the number of tests, and on the same page: "It is this correlation of complexity with reliability, maintainability, and understandability that primarily drives the process to limit complexity." McCabe (1976) also proposed limiting modules "by cyclomatic complexity instead of physical size". Only Checkstyle and Sonar's white paper make the "not about quality/understandability" claim.
  2. **Lavazza et al. (JSS 2023) removed from support.** Its conclusion came from a search snippet and could not be verified.
  3. **Clippy wording fixed.** "Moved its lint to restriction" became "has left it in `restriction`", which is the docs' wording. Clippy's docs now recommend `excessive_nesting` and `too_many_lines` instead.
  4. **Esposito et al.** is now also a peer-reviewed publication (IEEE Access 2025).
  5. **PMD version.** The PMD version was corrected to 7.27.0.
- **Rationale:** Tool docs and Sonar's white paper treat CC as a test count. The Sonar white paper designs cognitive complexity to model the reader. The meta-analysis found that cognitive complexity tracks comprehension time, perceived difficulty and a combined time/correctness measure (0.40), but not correctness alone. A survey of early-career developers calls both metrics "modest predictors". Clippy's maintainers keep their lint allow-by-default so that it is not mistaken for a measurement tool. The honest position: these metrics find candidates, and reading the code decides.
- **Evidence:**
  - [NIST SP 500-235, §2.5](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — Watson, McCabe, NIST 1996 — standard — "Cyclomatic complexity gives the number of tests, which for a multiway decision statement is the number of decision branches." The same page says: "It is this correlation of complexity with reliability, maintainability, and understandability that primarily drives the process to limit complexity." — VERIFIED; attribution corrected.
  - [Checkstyle CyclomaticComplexity](https://checkstyle.org/checks/metrics/cyclomaticcomplexity.html) — Checkstyle 14.1.0 docs (2026-08-30) — official_docs — "It is a measure of the minimum number of possible paths through the source and therefore the number of required tests, it is not about quality of code!"; default max 10 — VERIFIED.
  - [Cognitive Complexity: a new way of measuring understandability, v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — G. Ann Campbell, SonarSource, 29 Aug 2023 — vendor white paper — "Cyclomatic Complexity was initially formulated as a measurement of the 'testability and maintainability' ... While it excels at measuring the former, its underlying mathematical model is unsatisfactory at producing a value that measures the latter." — VERIFIED.
  - [An Empirical Validation of Cognitive Complexity as a Measure of Source Code Understandability (ESEM 2020)](https://arxiv.org/abs/2007.12520v1) — Muñoz Barón, Wyrich, Wagner — peer_reviewed — "about 24,000 understandability evaluations of 427 code snippets". Random-effects correlations:
    - time 0.54 [0.24; 0.75], I² = 85%;
    - correctness -0.13 [-0.45; 0.21];
    - ratings -0.29 [-0.49; -0.06];
    - physiological 0.00;
    - composite of time and correctness 0.40.

    VERIFIED in the PDF text.
  - [Early Career Developers' Perceptions of Code Understandability](https://arxiv.org/abs/2303.07722v2) — Esposito et al., IEEE Access 2025 — peer_reviewed — CC and Cognitive Complexity "are modest predictors for code understandability ... they are not for problem severity." — VERIFIED.
  - [Clippy `cognitive_complexity` lint](https://rust-lang.github.io/rust-clippy/master/index.html) — Rust Clippy team (docs rewritten by PR #14915, merged 3 Jul 2025) — official_docs — "The true Cognitive Complexity of a method is not something we can calculate using modern technology. This lint has been left in `restriction` so as to not mislead users into using this lint as a measurement tool."; `cognitive-complexity-threshold` default 25 — VERIFIED in `cognitive_complexity.rs` and `conf.rs`.
  - [An empirical evaluation of the "Cognitive Complexity" measure as a predictor of code understandability](https://doi.org/10.1016/j.jss.2022.111561) — Lavazza, Abualkishik, Liu, Morasca, JSS 197 (2023) — peer_reviewed — existence and authors confirmed through Crossref and Semantic Scholar; [Zenodo 7327409](https://zenodo.org/records/7327409) says it compares Cognitive Complexity "with traditional code measure, like LoC and McCabe's complexity" — **conclusion NOT verified**, not used as support.
- **Detect:**
  - JS/TS: ESLint `complexity` (classic CC) plus `sonarjs/cognitive-complexity` (eslint-plugin-sonarjs, default threshold 15, confirmed in the SonarJS source).
  - Python: `ruff check --select C901` (`lint.mccabe.max-complexity`, default 10) or `radon cc -s`.
  - Java: PMD `CognitiveComplexity`/`CyclomaticComplexity`, or Checkstyle `CyclomaticComplexity`.
  - C/C++: clang-tidy `readability-function-cognitive-complexity`. `DescribeBasicIncrements` is already `true` by default and lists each construct that adds to the score.
  - Go: golangci-lint `gocognit`, `gocyclo`/`cyclop`.
  - Rust: prefer `clippy::excessive_nesting` plus `clippy::too_many_lines`, as the Clippy docs recommend.
  - C#: CA1502. Ruby: `Metrics/CyclomaticComplexity`, `Metrics/PerceivedComplexity`.
  - Polyglot: lizard (CCN only) or SonarQube (both metrics).
- **Tools:** ESLint 10.x `complexity`, eslint-plugin-sonarjs, Ruff C901, radon, PMD 7.27.0, Checkstyle, clang-tidy, golangci-lint gocognit/gocyclo/cyclop, Clippy, CA1502, RuboCop 1.91, lizard, SonarQube.
- **Applies to:** All languages with structured control flow.
- **When not to apply / counterpoints:**
  - Muñoz Barón et al. call Cognitive Complexity "the first validated and solely code-based metric which is able to reflect at least some aspects of code understandability", and recommend keeping it "as low as possible".
  - The Clippy lint author's October 2019 retraction ("no empirical base") predates that 2020 validation.
  - NIST itself links CC to understandability, so CC is not irrelevant to readability; it is a weak single measure of it.
- **Fix risk:** low. This is measurement and reporting only.

### T03-F05 — Flag blocks nested more than 3 levels deep inside a function (4 at most). Flatten them first, with guard clauses/early return or `continue`, by inverting conditions, or by extracting the loop body. Only then consider splitting the function.
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  1. Ruff `PLR1702` (too-many-nested-blocks) is a **preview** rule and needs `--preview`.
  2. golangci-lint `nestif` reports a complexity score for nested `if` statements (`min-complexity`, default 5). It is not a depth limit.
  3. RuboCop 1.91.0 disables `Metrics/BlockNesting` under `Preview`, ahead of RuboCop 2.0. Its `default.yml` gives the reason: "Rejected by a fifth of projects; almost nobody adjusts the limit instead." So "RuboCop's data calls 3 well-calibrated" is true of the June 2026 issue, but RuboCop is still dropping the cop from its defaults.
  4. The PMD version was corrected (7.27.0 release; docs 7.28.0-SNAPSHOT).
- **Rationale:** Nesting is where the sources agree most. The Linux kernel says that needing more than 3 indentation levels means the program should be fixed. PMD's nested-if depth and RuboCop's BlockNesting default to 3, and RuboCop's usage data shows the median team override is also 3. ESLint `max-depth` defaults to 4; Pylint and Ruff `max-nested-blocks` default to 5. Sonar's spec adds a cost for every nesting level, and the Clippy docs point users to `excessive_nesting` instead of their cognitive lint.

  Empirically, nested block depth predicts change-proneness for small methods better than for large ones. In one nesting/readability experiment (Johnson et al., reanalysed by Chowdhury et al.), the snippets that broke the rule were also much larger, so size may explain the result. That is agreement among conventions, with only partial empirical support.
- **Evidence:**
  - [Linux kernel coding style: Indentation](https://www.kernel.org/doc/html/latest/process/coding-style.html) — Linux kernel — official_docs — "if you need more than 3 levels of indentation, you're screwed anyway, and should fix your program." — VERIFIED.
  - [RuboCop Metrics cops](https://docs.rubocop.org/rubocop/latest/cops_metrics.html) — RuboCop 1.91 — official_docs — `Metrics/BlockNesting` Max 3, `CountBlocks: false`; `default.yml` v1.91.0: "Expected to be disabled by default in the next major release" — VERIFIED.
  - [RuboCop issue #15363](https://github.com/rubocop/rubocop/issues/15363) — Batsov, 28 Jun 2026 — "`Metrics/BlockNesting` (default 3, median 3) look well-calibrated"; BlockNesting is disabled by 27.5% of configs — VERIFIED.
  - [PMD Java design rules](https://pmd.github.io/pmd/pmd_rules_java_design.html) — PMD docs 7.28.0-SNAPSHOT (latest release 7.27.0) — official_docs — `AvoidDeeplyNestedIfStmts`, `problemDepth` 3: "Avoid creating deeply nested if-then statements since they are harder to read and error-prone to maintain." — VERIFIED.
  - [ESLint max-depth](https://eslint.org/docs/latest/rules/max-depth) — ESLint v10.11.0 — official_docs — "`max` (default `4`) enforces a maximum depth that blocks can be nested" — VERIFIED.
  - [Cognitive Complexity white paper v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — SonarSource 2023 — vendor spec — "3. Increment when flow-breaking structures are nested"; in the worked example, a `while` inside a `for` inside an `if` scores "+3 (nesting=2)" — VERIFIED.
  - [Revisiting the Debate (EMSE preprint)](https://www.cs.ubc.ca/~rtholmes/papers/emse_2022_chowdhury_preprint.pdf) — Chowdhury et al., EMSE 2022 — peer_reviewed — "nested block depth is not as good a predictor for large methods as it is for smaller methods"; on Johnson et al.: "the snippets that broke the rule were much larger than those that followed the rules" — VERIFIED.
  - [Replace Nested Conditional with Guard Clauses](https://refactoring.com/catalog/replaceNestedConditionalWithGuardClauses.html) — Martin Fowler, *Refactoring* 2nd ed. catalog — book (catalog page online) — `getPayAmount` becomes `if (isDead) return deadAmount(); if (isSeparated) return separatedAmount(); if (isRetired) return retiredAmount(); return normalPayAmount();` — VERIFIED.
  - [golangci-lint linter settings](https://golangci-lint.run/docs/linters/configuration/) — golangci-lint v2 docs — official_docs — `nestif`: "Minimal complexity of if statements to report. Default: 5" — VERIFIED.
- **Detect:**
  - ESLint `max-depth: ["warn", 3]`.
  - Ruff `PLR1702`, preview only: `ruff check --preview --select PLR1702` with `lint.pylint.max-nested-blocks` (default 5; set 3-4). Pylint R1702.
  - Clippy `excessive_nesting` (group `complexity`) with `excessive-nesting-threshold = 4` in `clippy.toml`. The default of 0 disables it.
  - RuboCop `Metrics/BlockNesting`. PMD `AvoidDeeplyNestedIfStmts`.
  - clang-tidy `readability-function-size` with `NestingThreshold: 3` (the option exists; its default is none).
  - golangci-lint `nestif` (a nested-if complexity score, not a depth).
  - Manual: indentation deeper than 4 levels inside a function body.
- **Tools:** ESLint `max-depth`, Ruff PLR1702 (preview), Pylint, Clippy `excessive_nesting`, RuboCop `Metrics/BlockNesting`, PMD, clang-tidy `readability-function-size`, golangci-lint `nestif`.
- **Applies to:** All block-structured languages.
- **When not to apply / counterpoints:**
  - Some safety-critical coding standards require a single exit point, so check the project's standard before adding early returns.
  - RuboCop data shows `Style/GuardClause` disabled by 32.2% of configs, and RuboCop 1.91 plans to disable it by default in 2.0. "Guard clauses everywhere" is contested.
  - Nesting that mirrors the data (for example, a 2D grid) may be clearer than flattened code.
- **Fix risk:** medium.
  - Early returns can skip cleanup, logging, unlock or transaction commit that used to run at the end of the function.
  - Guard clauses change the order in which conditions and their side effects run.
  - An inverted condition is not always the exact opposite: `!(a > b)` is not `a <= b` when NaN or null is involved.
  - Moving a loop body into its own function changes `break`/`continue` semantics.

### T03-F06 — Review functions longer than about 25 SLOC (Java evidence) or above the usual tool trigger of 40-60 lines. Split them when length comes with high nesting or CC, or when the function mixes levels of abstraction. Do not split long functions that are a flat sequence of simple steps or a single simple switch.
- **Grade:** B · **Verdict:** CORRECTED. (audit correction: "large between small and medium, small for the other two" describes only the single-project elasticsearch illustration; across the 49 projects small-vs-medium change-proneness effects were medium to large, and the 84-of-115 cells span five indicators, bugs included, all with negligible or small effects.) Changes:
  1. **How the 24-SLOC figure was derived.** It comes from a benchmark-percentile method (Alves et al.): 24 is the SLOC value that covers 70% of the distribution in the paper's figure. It was then validated by comparing categories. It is not a natural breakpoint.
  2. **The decomposition result is a proxy.** Groups of small methods that "can easily be merged" were compared with single large methods. The paper raises the higher coupling of decomposed code only as a concern and does not measure it.
  3. **Spring-boot's 27-LOC maximum.** Chin & Holmes measured it after excluding each project's top 1% longest methods. Its cause, code review, is the authors' speculation ("We speculate that strong and strict code review dictate this pattern").
- **Rationale:** The only large-scale study (785,606 Java methods, 49 projects) found that methods of 24 SLOC or fewer are less change-prone and less bug-prone.
  - Across the 49 projects, small-vs-medium effects on change-proneness were "within medium to large": for #revisions, 55.1% of the per-project effect sizes are medium and 34.69% large. For bug-proneness, "most of the differences are now within negligible and small effect sizes" (small vs medium: negligible in 38.78% of projects, small in 57.14%; metric-thresholds G208-F04). The often-quoted "large between small and medium methods, and small for the other two cases" describes only the single-project elasticsearch illustration (Figure 4), not the study-wide result.
  - Decomposed groups of small methods did better than a comparable single method in 84 of 115 Table 7 cells (73%), and in 87% of the cells with non-negligible effect sizes. The 115 cells cover five indicators, including a "Bugs" column, so this is not a change-proneness count alone, and every Table 7 effect is negligible or small.

  Official guides set soft limits:
  - Google: about 40 lines, with "no hard limit".
  - Linux: "one or two screenfuls", with length inversely proportional to complexity.

  Tool defaults range from 10 lines (RuboCop MethodLength) to 1000 (lizard). Where Ruby teams override MethodLength, the median is 22. Treat length as a trigger to go and look.
- **Evidence:**
  - [An Empirical Study on Maintainable Method Size in Java (MSR 2022)](https://www.cs.ubc.ca/~rtholmes/papers/msr_2022_chowdhury.pdf) — Chowdhury, Uddin, Holmes — peer_reviewed — "Methods of 24 SLOC or fewer exhibit less change- and bug-proneness."; "The Cliff's Delta effect size is large between small and medium methods, and small for the other two cases" (said of the elasticsearch illustration, Figure 4, only); across projects "for #revisions, 55.1% of the effect sizes are medium, and 34.69% are large"; for bug-proneness "Most of the differences are now within negligible and small effect sizes"; "out of 115 cells, 84 of them are blue (73%)" (five indicators, all effects "N-Negligible" or "S-Small"); the first critical value is 24 "because it covers 70% of the y-axis" — VERIFIED in the PDF text; effect-size scope corrected by the citation audit.
  - [Google C++ Style Guide: Write Short Functions](https://google.github.io/styleguide/cppguide.html) — Google — official_docs — "no hard limit is placed on functions length. If a function exceeds about 40 lines, think about whether it can be broken up without harming the structure of the program." — VERIFIED.
  - [Linux kernel coding style: Functions](https://www.kernel.org/doc/html/latest/process/coding-style.html) — Linux kernel — official_docs — "The maximum length of a function is inversely proportional to the complexity and indentation level of that function."; local variables "shouldn't exceed 5-10" — VERIFIED.
  - [ESLint max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function) — ESLint v10.11.0 — official_docs — "`max` (default 50)"; `skipBlankLines` and `skipComments` default false — VERIFIED.
  - [Clippy too_many_lines](https://rust-lang.github.io/rust-clippy/master/index.html) — Rust Clippy — official_docs — group `pedantic`; `too-many-lines-threshold` default 100 — VERIFIED in `functions/mod.rs` and `conf.rs`.
  - [RuboCop issue #15363](https://github.com/rubocop/rubocop/issues/15363) — Batsov, 28 Jun 2026 — practitioner_forum — `Metrics/MethodLength` default 10, median override 22, plurality 20, n=49 — VERIFIED.
  - [Chin & Holmes (ICPC '26)](https://www.cs.ubc.ca/~rtholmes/papers/icpc_2026_chin.pdf) — 2026 — peer_reviewed — "spring-boot, in which every method was 27 lines of code or fewer despite having no static analysis rules that would automatically enforce this ... We speculate that strong and strict code review dictate this pattern" — VERIFIED; the cause is framed as speculation.
- **Detect:**
  - `lizard -L 60 -w <src>`, or sort the lizard CSV by NLOC.
  - ESLint `max-lines-per-function: ["warn", {max: 50, skipBlankLines: true, skipComments: true}]`.
  - Ruff `PLR0915` (`max-statements`, default 50). Clippy `too_many_lines`.
  - golangci-lint `funlen` (default 60 lines / 40 statements). PMD `NcssCount` (`methodReportLevel` 60).
  - clang-tidy `readability-function-size` `LineThreshold`.

  Before splitting, check whether the long function also has CC > 10 or nesting > 3. If it has neither, it is usually a flat sequence: leave it, and at most add section comments.
- **Tools:** lizard, ESLint, Ruff, Clippy, golangci-lint `funlen`, PMD `NcssCount`, clang-tidy.
- **Applies to:** All languages. The 24-SLOC figure comes from open-source Java only; use 40-60 as the trigger elsewhere.
- **When not to apply / counterpoints:**
  - Tempero et al. (ICPC 2024) found the effect of decomposition on comprehension "inconclusive".
  - Carmack and Ousterhout argue for keeping a whole operation visible in one place.
  - Culture and review may matter more than the number.
- **Fix risk:** medium. Extracting a function can change:
  - closure capture and mutation of shared locals;
  - `this` binding (JS);
  - early-return and `break`/`continue` behaviour;
  - exception types and stack traces;
  - defer/finally/RAII scope (Go `defer` runs at function exit; C++ destructors run at the end of the new scope).

### T03-F12 — Record the tool, its version and its configuration with every complexity number. Compare before and after only with the same tool and settings, never across tools or languages. Know each tool's counting quirks: default parameters, `&&`/`||`, `?.`/`??`, switch cases, macros and closures.
- **Grade:** B · **Verdict:** VERIFIED. One point was added: counting also changes *within* one tool across versions. ESLint's `complexity` rule counts logical assignment since v7.18.0 (PR #13979, merged and released 2021-01-15), began counting optional chaining and default values with v9.0.0 (5 Apr 2024; PR #18152 merged March 2024), and gained the `modified` variant in v9.12.0 (published 2024-10-04; PR #18896 merged 2024-09-25); all are in the rule's commit history. (audit correction: version facts from metric-thresholds G208-F09; merge dates are not release dates, so record the release version, v9.12.0+ for `variant: "modified"`.)
- **Rationale:** Tools compute CC from different syntax constructs, so the same code gets different numbers:
  - ESLint counts each default parameter value, destructuring defaults and logical assignment.
  - Clippy's old "cyclomatic" lint scored a whole `match` as 2, regardless of arms.
  - clang-tidy implements Sonar's 2017 spec v1.2, while the white paper is at v1.7 (2023). Between those versions, v1.5 added an explicit increment for multi-level break/continue.
  - ESLint and Checkstyle offer switch-as-one variants.

  A before/after claim is valid only within one tool, one version and one configuration.
- **Evidence:**
  - [Landman et al. JSEP preprint (§2.1)](https://aserebre.win.tue.nl/Landman2015-ccsloc-jsep2015-preprint.pdf) — Landman et al. — peer_reviewed — "The unclarity leads to metric tools generating different values for the CC metric, because they count different kinds of AST nodes" — VERIFIED.
  - [ESLint complexity rule](https://eslint.org/docs/latest/rules/complexity) — ESLint v10.11.0 — official_docs — default parameters and destructuring defaults each add a path; `variant` `"classic"`/`"modified"`; default max 20 — VERIFIED. Commit history checked through the GitHub API.
  - [ESLint issue #19360](https://github.com/eslint/eslint/issues/19360) — ESLint maintainers, Jan 2025 — practitioner_forum — a function whose only logic is 10 destructured default values fails a `max: 8` playground config; nzakas: "Each default value represents a potential additional code path." — VERIFIED.
  - [clang-tidy readability-function-cognitive-complexity](https://clang.llvm.org/extra/clang-tidy/checks/readability/function-cognitive-complexity.html) — LLVM — official_docs — "implemented as per the COGNITIVE COMPLEXITY by SonarSource specification version 1.2 (19 April 2017)"; `Threshold` 25; `DescribeBasicIncrements` true; `IgnoreMacros` false — VERIFIED.
  - [rust-clippy issue #3793](https://github.com/rust-lang/rust-clippy/issues/3793) — practitioner_forum. Manishearth (21 Feb 2019): "our CyC lint doesn't actually measure CyC, it measures something in between CyC and CoC". oli-obk: "a `match` has a CC of `2` regardless of the number of arms". VERIFIED.
  - [Cognitive Complexity white paper v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — SonarSource — vendor spec — "Cognitive Complexity ignores null-coalescing operators"; the change log runs from v1.1 (6 Feb 2017) to v1.7 (29 Aug 2023) — VERIFIED.
- **Detect:**
  - Capture versions: `npx eslint --version`, `ruff --version`, `lizard --version`, `clang-tidy --version`, `cargo clippy --version`, `pmd --version`, `golangci-lint version`.
  - Store the effective configuration, e.g. `npx eslint --print-config file.ts`.
  - Check the variant options: ESLint `complexity` `variant`, Checkstyle `switchBlockAsSingleDecisionPoint`, clang-tidy `IgnoreMacros`, PMD `cycloOptions`.
- **Tools:** ESLint, Ruff, lizard, clang-tidy, Clippy, PMD, Checkstyle, golangci-lint.
- **Applies to:** All reporting of complexity numbers.
- **When not to apply / counterpoints:** Differences between tools are usually small for ordinary code. Landman et al. found that dropping `&&`/`||` from the count changed CC for 1.3M of 17.6M methods. The differences matter most around switch/match, default parameters and macros.
- **Fix risk:** low (none: measurement hygiene).

### T03-F11 — Reject any change whose only effect is a lower metric score: arbitrary part1/part2 splits, dispatch tables that just move the branches, new lint suppressions, raised thresholds, or "modified" metric settings. Each complexity fix must visibly reduce what a reader has to hold in mind (nesting, live state, branches). Check this by re-reading the diff, not by re-running the linter.
- **Grade:** B · **Verdict:** CORRECTED.
  - The RuboCop data was reframed. Its author reads the frequent suppression of metric cops as "their *thresholds* are too strict", not as gaming. It now supports "teams route around metric gates (disable, exclude, todo, inline suppression)".
  - Direct gaming evidence comes from NIST and from ESLint #19360. In that issue a maintainer shows a rewrite that lowers CC "despite looking more convoluted".
- **Rationale:** Metrics are easy to game.
  - NIST documents a module going from 90 to a "modified" 10 through a do-nothing switch.
  - In ESLint #19360, moving default values inside the function body lowers CC while making the code more convoluted.
  - RuboCop's 2026 data shows metric cops leading every suppression list at once.
  - Showing developers a metric value strongly anchors their readability judgement.
  - Sjøberg warns that improving the worst local areas can harm the system as a whole.

  An AI hardening pass that optimises for linter output is exactly this risk.
- **Evidence:**
  - [NIST SP 500-235, §2.5](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — NIST 1996 — standard — "the developer could take a module with complexity 90 and reduce it to 'modified' complexity 10 simply by adding a ten-branch multiway decision statement to it that did nothing." — VERIFIED.
  - [ESLint issue #19360](https://github.com/eslint/eslint/issues/19360) — ESLint maintainers, 22-27 Jan 2025 (closed) — practitioner_forum — fasttime: the workaround "produces a lower cyclomatic complexity, despite looking more convoluted"; nzakas: "we don't add options to modify how this rule calculates complexity because we want to keep it true to the name (cyclomatic complexity)"; mdjermanovic suggests copying the core rule into a custom rule — VERIFIED through the GitHub API.
  - [Tuning RuboCop's defaults from real-world usage data (#15363)](https://github.com/rubocop/rubocop/issues/15363) — Bozhidar Batsov, 28 Jun 2026 — practitioner_forum — metric thresholds "dominate the disable, exclude, todo *and* inline-suppression leaderboards simultaneously"; "I don't think that means they should be disabled - it means their *thresholds* are too strict" — VERIFIED.
  - [The Mind Is a Powerful Place (ICSE 2021)](https://arxiv.org/abs/2012.09590) — Wyrich et al. — peer_reviewed — "significant and large anchoring effect" — VERIFIED.
  - [Questioning Software Maintenance Metrics](https://www.mn.uio.no/ifi/personer/vit/dagsj/sjoberg.anda.mockus.esem.2012.pdf) — Sjøberg et al. 2012 — peer_reviewed — "the improvements of the worst areas may, inadvertently, lead to more problems for the entire system" — VERIFIED.
- **Detect:**
  - Scan the diff for new suppressions: `rg -n "eslint-disable(-next-line)?\s+.*(complexity|max-depth|max-lines-per-function|max-params|max-statements|sonarjs/cognitive-complexity)|noqa:\s*(C901|PLR09\d\d|PLR1702)|pylint:\s*disable=(too-many-|R09)|allow\(clippy::(cognitive_complexity|too_many_lines|too_many_arguments|excessive_nesting)\)|NOLINT\(readability-function-(cognitive-complexity|size)\)|NOSONAR|S3776|rubocop:disable Metrics/|CA1502|nolint:(gocyclo|gocognit|cyclop|funlen|nestif)"`.
  - Check for raised thresholds or switched metric variants in `eslint.config.*`/`.eslintrc*`, `pyproject.toml`/`ruff.toml`, `clippy.toml`, `.rubocop.yml` and `.golangci.yml`.
  - Check for new function names matching `(part|step)\d|helper\d|Rest\b|_impl\d`.
  - For each fix, compare nesting depth and the number of variables live across branches before and after.
- **Tools:** ripgrep, git diff, ast-grep.
- **Applies to:** Every change made by the hardening skill, in every language.
- **When not to apply / counterpoints:** Some suppressions are legitimate: flat switches per F04, generated code, parsers and state machines. Allow them with a one-line justification comment.
- **Fix risk:** low (not applicable: a review rule that lowers risk by blocking cosmetic refactors of shipped code).

### T03-F17 — Flag regular expressions with nested or overlapping quantifiers (e.g. `(a+)+`, `(.*)*`, `.*.*=`) that run on untrusted or large input. Fix by removing the ambiguity, bounding the input length, or switching to a linear-time engine (RE2, Rust `regex`).
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  1. Cloudflare's 555-step example is `x=` followed by 20 x's, i.e. 22 characters, not a 20-character input.
  2. The regex had overlapping `.*` quantifiers (`.*(?:.*=.*)`), not nested ones.
  3. The move to RE2 or the Rust regex engine was a stated plan; the immediate fix was to globally disable the WAF Managed Rules.
- **Rationale:** Catastrophic backtracking turns a one-line regex into polynomial or exponential CPU cost. It is an algorithmic-complexity defect that complexity metrics cannot see. Cloudflare's global outage on 2 July 2019 came from one WAF regex:
  - HTTP/HTTPS CPUs spiked to nearly 100%, and the service was down for 27 minutes;
  - the remediation plan included switching to RE2 or the Rust regex engine.

  CodeQL rates `js/redos` as an error with security severity 7.5.
- **Evidence:**
  - [Details of the Cloudflare outage on July 2, 2019](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) — John Graham-Cumming, Cloudflare — incident_report — "CPUs dedicated to serving HTTP/HTTPS traffic spiked to nearly 100% usage"; "the Cloudflare service went down for 27 minutes"; `.*.*=.*` takes "23 steps to match x=x" and, "With 20 x's after the =", "555 steps"; the plan was "switching to either the re2 or Rust regex engine which both have run-time guarantees" — VERIFIED; input length corrected.
  - [Inefficient regular expression (js/redos)](https://codeql.github.com/codeql-query-help/javascript/js-redos/) — GitHub CodeQL — official_docs — "the time it takes to match a string of length n is proportional to n^k or even 2^n"; severity error, security severity 7.5; "Modify the regular expression to remove the ambiguity, or ensure that the strings matched with the regular expression are short enough that the time-complexity does not matter." — VERIFIED.
  - [regexp/no-super-linear-backtracking](https://ota-meshi.github.io/eslint-plugin-regexp/rules/no-super-linear-backtracking.html) — eslint-plugin-regexp — official_docs — "The rule only implements a very simplistic detection method and can only detect very simple cases of super-linear backtracking right now."; the rule is in the recommended configs — VERIFIED.
- **Detect:**
  - CodeQL `js/redos` and the equivalent queries for other languages.
  - eslint-plugin-regexp `regexp/no-super-linear-backtracking` and `regexp/no-super-linear-move`.
  - Manual grep for nested or overlapping quantifiers in regex literals and in `new RegExp(` / `re.compile(` / `Regex::new(` calls, for example `rg -n "\([^)]*[+*]\)[+*]|\.\*[^\n]*\.\*"`.
  - Check whether the input is attacker-controlled or unbounded.
- **Tools:** CodeQL, eslint-plugin-regexp, ripgrep.
- **Applies to:** Any language with a backtracking regex engine (JS, Python `re`, Java, .NET, PCRE, Ruby). Cloudflare cites RE2 and Rust `regex` as having run-time guarantees; Go's `regexp` follows RE2 semantics, which was not independently verified here.
- **When not to apply / counterpoints:**
  - With short, trusted inputs (config keys, CLI flags) the risk is negligible.
  - RE2-style engines lack backreferences and lookaround, so switching engines is not always possible.
- **Fix risk:** medium. Rewriting a regex can change which strings match and what the capture groups contain. Switching engines changes the supported syntax and match semantics. Add tests with matching and non-matching inputs before and after.

### T03-F03 — Use thresholds as triggers for a review, never as automatic build failures on a finished codebase. Suggested triggers: review when CC > 10 or cognitive complexity > 15; require a written justification or a refactor when CC > 20-25 or cognitive > 25. Record why each exception stands.
- **Grade:** C · **Verdict:** CORRECTED. Changes:
  1. PMD: the docs are 7.28.0-SNAPSHOT, and the latest release is 7.27.0.
  2. Pylint's CC check lives in the optional `pylint.extensions.mccabe` plugin (`max-complexity` 10); it is not a default check.
  3. The Sonar way gate has no complexity-metric condition, but S3776 (cognitive complexity, default 15) is in the Java `Sonar_way` profile. New S3776 issues therefore fail the gate through "no new issues". The researcher noted this as a counterpoint; it is now confirmed.
  4. RuboCop: the author of #15363 read the disables as "thresholds too strict". The 2.0 disable plan came later, in the 1.91.0 changelog.
  5. The suggested bands are the researcher's synthesis of tool defaults, not a validated cut-off.
- **Rationale:** No threshold has been validated. McCabe called 10 "reasonable, but not magical", and NIST calls the exact limit "somewhat controversial". Tool defaults spread widely:

  | Metric | Tool defaults |
  |---|---|
  | CC | RuboCop 7; Pylint extension, Ruff, PMD, Checkstyle and cyclop 10; lizard 15; ESLint 20; CA1502 25; gocyclo 30 (its docs "recommend 10-20") |
  | Cognitive complexity | Sonar S3776, eslint-plugin-sonarjs and PMD 15; clang-tidy and Clippy 25; gocognit 30 |

  The only meta-analysis had almost no snippets above 15 and makes no threshold recommendation. Real-world usage also argues against rigid gates at today's defaults: 37-43% of top Ruby repos that ship a config disable the complexity and size cops, and where teams change the limit, the median CC is 10.
- **Evidence:**
  - [A Complexity Measure](http://www.literateprogramming.com/mccabe.pdf) — McCabe, IEEE TSE 1976 — peer_reviewed — "The particular upper bound that has been used for cyclomatic complexity is 10 which seems like a reasonable, but not magical, upper limit." — VERIFIED.
  - [NIST SP 500-235, §2.5](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — NIST 1996 — standard — "The precise number to use as a limit, however, remains somewhat controversial. The original limit of 10 as proposed by McCabe has significant supporting evidence, but limits as high as 15 have been used successfully as well. Limits over 10 should be reserved for projects that have several operational advantages over typical projects" — VERIFIED.
  - [Muñoz Barón et al. (§5.2 Limitations)](https://arxiv.org/abs/2007.12520v1) — ESEM 2020 — peer_reviewed — "Only two of the studies included code snippets with a value greater than 15, which is the default threshold in SonarQube ... no recommendation for a meaningful threshold." — VERIFIED.
  - [ESLint complexity](https://eslint.org/docs/latest/rules/complexity) — ESLint v10.11.0 — official_docs — default 20; "If you can't determine an appropriate complexity limit for your code, then it's best to disable this rule." — VERIFIED.
  - [golangci-lint linter settings](https://golangci-lint.run/docs/linters/configuration/) — golangci-lint v2 docs — official_docs — gocyclo and gocognit "Default: 30 (but we recommend 10-20)"; cyclop "Default: 10" — VERIFIED.
  - [Tuning RuboCop's defaults from real-world usage data (#15363)](https://github.com/rubocop/rubocop/issues/15363) — Bozhidar Batsov, 28 Jun 2026 — practitioner_forum — 233 of the top 500 repos ship a config. Disabled by: AbcSize 43.3%, ClassLength 41.6%, CyclomaticComplexity 39.9%, MethodLength 39.9%, ModuleLength 38.2%, PerceivedComplexity 36.9%. Median overrides: CC 7 to 10 (n=31), PerceivedComplexity 8 to 12, MethodLength 10 to 22. The author calls this "a starting point for a discussion, not a set of decisions" — VERIFIED.
  - [RuboCop CHANGELOG, 1.91.0 (2026-09-10)](https://raw.githubusercontent.com/rubocop/rubocop/master/CHANGELOG.md) — RuboCop — official_docs — "Disable `Metrics/MethodLength`, `Metrics/AbcSize`, `Metrics/ClassLength`, `Metrics/ModuleLength`, `Metrics/CyclomaticComplexity`, `Metrics/PerceivedComplexity`, `Metrics/BlockLength`, `Metrics/ParameterLists` and `Metrics/BlockNesting` under `Preview`, ahead of them being disabled by default in RuboCop 2.0." — VERIFIED.
  - [Introduction to quality gates (Sonar way)](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates) — SonarSource — official_docs — conditions: no new issues, new hotspots reviewed, new-code coverage >= 80.0%, new-code duplication <= 3.0%; "This quality gate focuses on keeping high quality standards for new code, rather than spending a lot of effort remediating old code." — VERIFIED. S3776 is present in the `sonar-java-plugin/src/main/resources/profiles/Sonar_way` directory of [SonarSource/sonar-java](https://github.com/SonarSource/sonar-java) — VERIFIED through the GitHub API.
  - [CA1502](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Microsoft — official_docs — "Default threshold | 25"; "Enabled by default in .NET 10 | No" — VERIFIED.
- **Detect:** Run in warn mode and triage by hand.
  - `lizard -C 10 -w <src>`.
  - ESLint with `complexity: ["warn", 10]` and `sonarjs/cognitive-complexity: ["warn", 15]`. eslint-plugin-sonarjs must be loaded in `eslint.config.*`.
  - `ruff check --select C901,PLR0912 --config 'lint.mccabe.max-complexity = 10'`.
  - `radon cc -s -n C <src>` (rank C = CC 11-20).
  - golangci-lint gocyclo/gocognit `min-complexity` 15.
  - clang-tidy `readability-function-cognitive-complexity` with `Threshold: 15`.
  - PMD with its defaults.

  Group the findings into three bands: review (CC 11-20 / cognitive 16-25), justify-or-refactor (above that), ignore (below).
- **Tools:** lizard, ESLint, eslint-plugin-sonarjs, Ruff, radon, golangci-lint, clang-tidy, PMD, RuboCop, SonarQube.
- **Applies to:** All languages; a finished codebase in a one-off hardening pass.
- **When not to apply / counterpoints:**
  - NIST presents a departmental limit as good practice, and safety-critical standards may require hard limits.
  - Gates on new code only (the Sonar approach) are widely used and compatible with this rule.
- **Fix risk:** low for the measurement itself. Refactors driven by thresholds on shipped code carry regression risk; CA1502 says the destabilisation risk "might outweigh the maintainability benefits of refactoring the code".

### T03-F07 — Guard against splitting too far. Inline a small function if it has exactly one caller and its body is no clearer than its name, or if you must read it to understand its caller ("entanglement"). Stop extracting once the new function's interface (parameters, flags, return tuple) is as complex as the code it hides.
- **Grade:** C · **Verdict:** CORRECTED. Changes:
  1. **Carmack source and wording.** The quote was fixed ("called **from** a single place") and re-sourced to the original page on Jonathan Blow's site: the email is dated 13 Mar 2007, with a 2014 preface. In that preface Carmack says he has become "much more bullish about pure functional programming", which addresses "unexpected dependency and mutation of state ... more directly and completely".
  2. **MSR 2022 counterpoint.** It no longer says "even though coupling increases"; the paper raises coupling only as a concern.
  3. **Martin's concession.** It is now quoted exactly, including his reply that he had "equal 'pain and suffering'" with Ousterhout's rewrite.
  4. **Braver & Feitelson.** The numbers were checked in the full PDF text, not only the abstract. The same paper quotes Martin's *Clean Code* passage verbatim, a second independent confirmation.
  5. **Detection heuristics.** They are labelled as the researcher's own.
- **Rationale:** The experimental evidence for "tiny functions" is weak:
  - Robert Martin wrote in *Clean Code* that he cannot cite research showing very small functions are better.
  - In his 2024-25 debate with Ousterhout, Martin said that on returning to his over-decomposed `PrimeGenerator` he "struggled with the names and structure". Both agreed its internal decomposition into methods is problematic.
  - A controlled experiment on decomposition was inconclusive (Tempero et al. 2024).
  - Developers asked to decompose the same code extracted 3 to 10 functions, covering 37-95% of it, so there is no single correct split.
  - Fowler keeps Inline Function in his catalogue and warns that small functions "only work if the names are good".
  - Carmack recommends considering inlining for single-caller functions.

  On the other side, Chowdhury et al. (MSR 2022) found decomposed groups of methods did better in 84 of 115 comparisons (73%) across five indicators, bugs included, with every effect negligible or small. The rule targets pathological splitting, not decomposition in general.
- **Evidence:**
  - [APOSD vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md) — John Ousterhout and Robert C. Martin, Sep 2024 to Feb 2025 — practitioner_forum (written debate) — Ousterhout: "when decomposed methods are entangled, they are harder to read than if they were not decomposed, and this defeats the whole purpose of decomposition"; Martin: "I think you have a point ... When I returned to the algorithm for the first time a few days ago, I struggled with the names and structure"; summary: "We agree that the internal decomposition of `PrimeGenerator` into methods is problematic" — VERIFIED from the raw README.
  - [It's probably time to stop recommending Clean Code](https://qntm.org/clean) — qntm, 28 Jun 2020 — engineering_blog quoting *Clean Code* ch. 3 — "This is not an assertion that I can justify. I can't provide any references to research that shows that very small functions are better." — VERIFIED (book confirmed via secondary source; WebFetch got 403, so the page was fetched with curl). The same passage is also quoted in Braver & Feitelson (2022).
  - [On the comprehensibility of functional decomposition: An empirical study (ICPC '24)](https://juholeinonen.com/assets/pdf/tempero2024comprehensibility.pdf) — Tempero, Denny, Finnie-Ansley, Luxton-Reilly, Kirk, Leinonen, Shakil, Sheehan, Tizard, Tu, Wünsche (Univ. of Auckland), ICPC 2024, DOI 10.1145/3643916.3644432 — peer_reviewed — "we find that the influence of function decomposition on code understanding is inconclusive, suggesting that functional decomposition does not universally enhance code comprehensibility" — VERIFIED.
  - [How Developers Extract Functions: An Experiment](https://arxiv.org/abs/2209.01098) — Braver, Feitelson (Hebrew Univ.), arXiv 2 Sep 2022 — preprint — "the number of functions that were extracted was between 3 and 10, and the amount of code extracted into functions ranged from 37% to 95%"; developers "extract functions based on structural cues, such as if or try blocks" — VERIFIED in the PDF text.
  - [FunctionLength](https://martinfowler.com/bliki/FunctionLength.html) — Martin Fowler, 30 Nov 2016 — engineering_blog — "Small functions like this only work if the names are good, so you need to pay good attention to naming."; Fowler: "Any function more than half-a-dozen lines of code starts to smell to me" — VERIFIED.
  - [Inline Function](https://refactoring.com/catalog/inlineFunction.html) — Martin Fowler, *Refactoring* 2nd ed. catalog — book (catalog page) — the inverse of Extract Function; the example inlines `moreThanFiveLateDeliveries(driver)` into `getRating` — VERIFIED.
  - [John Carmack on Inlined Code](http://number-none.com/blow/john_carmack_on_inlined_code.html) — John Carmack, email of 13 Mar 2007 with a 26 Sep 2014 preface, hosted by Jonathan Blow (the researcher cited a mirror at red.herr.i.ng) — engineering_blog — "If a function is only called from a single place, consider inlining it."; "Most bugs are a result of the execution state not being exactly what you think it is." — CORRECTED wording and source.
  - [An Empirical Study on Maintainable Method Size in Java](https://www.cs.ubc.ca/~rtholmes/papers/msr_2022_chowdhury.pdf) — Chowdhury et al., MSR 2022 — peer_reviewed — "out of 115 cells, 84 of them are blue (73%)"; that decomposition "would increase dependency and coupling score" is raised as a concern and not measured — VERIFIED. The citation audit adds that the paper's conclusion does advise decomposing "even if it increases the overall coupling of a system", although coupling is never measured.
- **Detect:** There is no standard linter for "single-use shallow helper", so this is a manual review step. The heuristics below are the researcher's own and have not been validated.
  - For each non-exported function, count call sites with `rg -w -c "<name>\("` or the language server's find-references.
  - Flag:
    1. exactly one call site and 3 or fewer statements;
    2. chains of 3 or more one-line wrapper hops between an entry point and the real work;
    3. helpers with 4 or more parameters that were all locals of the single caller;
    4. boolean flag parameters that select the helper's behaviour;
    5. names like `doStep2`, `handleRest`, `processPart`.
  - For dead exports: `knip` or `ts-prune` (TS), `vulture` (Python).
- **Tools:** ripgrep, language server find-references, ast-grep, knip, vulture.
- **Applies to:** All languages. Most relevant after an automated or AI-driven "reduce complexity" pass, which tends to over-extract.
- **When not to apply / counterpoints:**
  - Fowler and Martin argue that intention-revealing names help even for one-liners.
  - MSR 2022 favours decomposition on change-proneness.
  - A named helper can be a useful test seam.
  - Carmack's email is set in stateful game-engine code, and his 2014 preface prefers pure functions.
- **Fix risk:** medium. Inlining can break:
  - overrides, polymorphism or mocking (virtual/overridden methods, test spies that target the helper);
  - recursion;
  - reflection, serialization or framework hooks that call by name;
  - public API.

  It also changes stack-trace frames and log context names.

### T03-F08 — Review functions with more than 4-5 parameters, or more than one boolean flag parameter. For internal APIs, fix with a parameter/options object, by splitting the function on the flag, or by grouping related parameters into a type. Leave public signatures alone unless there is a versioning plan.
- **Grade:** C · **Verdict:** CORRECTED (minor).
  - The PMD version was fixed: the researcher cited "PMD 7.28.0", but the latest release is 7.27.0 (the docs are 7.28.0-SNAPSHOT).
  - Clippy's `fn_params_excessive_bools` allows up to 3 bools by default (`max-fn-params-bools` = 3), so "more than one flag" is the researcher's stricter choice.
  - All other defaults were confirmed against the tools' sources.
- **Rationale:** The thresholds are pure convention:

  | Tool | Default parameter limit |
  |---|---|
  | ESLint | 3 |
  | Pylint, Ruff, RuboCop | 5 |
  | Clippy | 7 |
  | PMD | 10 |
  | lizard | 100 |

  RuboCop's usage data puts the median team override just above its default (5 to 6). The real justification is qualitative: parameters of similar types get mixed up at call sites (PMD), and many parameters hurt readability ("what does the 5th parameter mean?", Clippy).
- **Evidence:**
  - [ESLint max-params](https://eslint.org/docs/latest/rules/max-params) — ESLint v10.11.0 — official_docs — "`max` (default `3`) enforces a maximum number of parameters in function definitions" — VERIFIED.
  - [Pylint option reference](https://pylint.readthedocs.io/en/stable/user_guide/configuration/all-options.html) — Pylint 4.0.9 docs — official_docs — `--max-args` 5, `--max-positional-arguments` 5, `--max-bool-expr` 5, `--max-locals` 15, `--max-branches` 12, `--max-statements` 50 — VERIFIED.
  - [Clippy too_many_arguments / fn_params_excessive_bools](https://rust-lang.github.io/rust-clippy/master/index.html) — Rust Clippy — official_docs — `too_many_arguments`: group `complexity`, `too-many-arguments-threshold` 7, "Consider grouping some parameters into a new type."; `fn_params_excessive_bools`: `pedantic`, `max-fn-params-bools` 3 — VERIFIED in the source.
  - [PMD ExcessiveParameterList](https://pmd.github.io/pmd/pmd_rules_java_design.html) — PMD docs 7.28.0-SNAPSHOT (release 7.27.0) — official_docs — `minimum` 10; "When parameters share similar datatypes, they become prone to mix-ups during refactoring or when calling the method with positional arguments." — VERIFIED.
  - [RuboCop Metrics/ParameterLists and usage data](https://github.com/rubocop/rubocop/issues/15363) — RuboCop 2026 — practitioner_forum — default 5, median override 6, plurality 5 (n=30); `default.yml` v1.91.0: `CountKeywordArgs: true`, `MaxOptionalParameters: 3` — VERIFIED.
  - [lizard](https://github.com/terryyin/lizard) — terryyin/lizard 1.24.0 — official source — `DEFAULT_CCN_THRESHOLD` 15, `DEFAULT_MAX_FUNC_LENGTH` 1000, `-a/--arguments` default 100 — VERIFIED in `lizard.py`.
- **Detect:**
  - ESLint `max-params` (set 4). Ruff `PLR0913` / `PLR0917` (positional; both stable). Pylint R0913/R0917.
  - Clippy `too_many_arguments` (warns by default at 7) and `fn_params_excessive_bools` (pedantic).
  - RuboCop `Metrics/ParameterLists`. PMD `ExcessiveParameterList`. lizard `-a 5`.
  - Manual: call sites passing literal `true`/`false`/`null` positionally, e.g. `rg -n "\w+\([^)]*,\s*(true|false)\s*[,)]"`.
- **Tools:** ESLint `max-params`, Ruff PLR0913/PLR0917, Pylint, Clippy, RuboCop, PMD, lizard.
- **Applies to:** All languages. A weaker concern where keyword or named arguments are used at call sites (Python, Kotlin, Ruby, Swift).
- **When not to apply / counterpoints:**
  - Math and geometry functions (x, y, z; r, g, b), constructors with dependency injection, and bindings to external APIs legitimately take many parameters.
  - An options object moves the problem into the type and can hide which fields are required.
- **Fix risk:** medium; high for exported APIs.
  - Signature changes to exported APIs break external callers.
  - An options object changes default semantics (explicit `undefined` vs a missing key) and can let a callee mutate the caller's object.
  - Moving from positional to keyword arguments changes argument binding.

### T03-F09 — Prioritise complexity work on hotspots: complex code that also changes often or has a bug history. Leave complex but stable, well-tested code alone unless the hardening pass must modify it anyway.
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. All sources are real and say what is claimed, but the support for "complexity × churn" as the ranking is indirect or comes from the vendor:
  - The churn × complexity numbers come from CodeScene's own docs and from a study led by CodeScene's founder. That study measures CodeScene's proprietary "Code Health" score, not complexity alone.
  - Nagappan et al. show that complexity correlates with failures, but they do not study churn.
  - Kim et al.'s 12.2% concerns a dedicated team's dependency and layering refactoring of Windows, not complexity reduction.

  The researcher also wrote "authors are from the tool vendor". That is only half true: Borg was at RISE and Lund University.
- **Rationale:**
  - Complexity metrics correlate with post-release failures, but no single metric set works for every project (5 Microsoft systems).
  - CodeScene's example: prioritised hotspots are 1.2% of the code, yet take 12.5% of development effort and 45% of fixed bugs.
  - A CodeScene-led study of 39 proprietary codebases reports 15 times more defects in low-Code-Health code.
  - Windows binaries most refactored by a dedicated team saw a 12.2% larger reduction in post-release defects than other modified binaries.
  - But 77% of the engineers surveyed see refactoring as risking regressions, and Sjøberg warns that local improvements need a system-level check.

  Prioritisation still lowers overall risk, so the rule stands with a lower grade.
- **Evidence:**
  - [Mining Metrics to Predict Component Failures (ICSE 2006)](https://www.st.cs.uni-saarland.de/publications/files/nagappan-icse-2006.pdf) — Nagappan, Ball (Microsoft Research), Zeller (Saarland) — peer_reviewed — "failure-prone software entities are statistically correlated with code complexity measures. However, there is no single set of complexity metrics that could act as a universally best defect predictor." — VERIFIED in the PDF text.
  - [CodeScene docs: Hotspots](https://codescene.io/docs/guides/technical/hotspots.html) — CodeScene — vendor docs — "The prioritized hotspots only make up 1.2% of the total codebase, yet we spend 12.5% of our development efforts in those hotspots, and 45% of all bugs that we detect and fix are in that small part of the code." — VERIFIED (vendor example).
  - [Code Red: The Business Impact of Code Quality (TechDebt 2022)](https://arxiv.org/abs/2203.04374) — Adam Tornhill (CodeScene), Markus Borg (RISE / Lund University); arXiv comment: "Accepted for International Conference on Technical Debt 2022" — peer_reviewed (vendor-led) — 30,737 files, 39 codebases: "low quality code contains 15 times more defects than high quality code"; "124% more time in development"; "9 times longer maximum cycle times"; quality is CodeScene's proprietary "Code Health" metric — VERIFIED; affiliation corrected.
  - [A Field Study of Refactoring Challenges and Benefits (FSE 2012)](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/kim-fse-2012.pdf) — Kim (UT Austin), Zimmermann, Nagappan (Microsoft Research) — peer_reviewed — "the top 25% of frequently refactored binaries reduced the number of post-release defects 12.2% more than other modified binaries on average"; 77% perceive regression risk — VERIFIED. The refactoring was a designated team's multi-year dependency and layering effort.
  - [CA1502: When to suppress warnings](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Microsoft — official_docs — "The risk of destabilizing the code base late in the development cycle or introducing an unexpected change in runtime behavior in previously shipped code might outweigh the maintainability benefits of refactoring the code." — VERIFIED.
  - [Questioning Software Maintenance Metrics](https://www.mn.uio.no/ifi/personer/vit/dagsj/sjoberg.anda.mockus.esem.2012.pdf) — Sjøberg et al. — peer_reviewed — "the improvements of the worst areas may, inadvertently, lead to more problems for the entire system. Our results suggest that local improvements should be accompanied by an evaluation at the system level." — VERIFIED.
- **Detect:**
  1. Churn: `git log --since=12.months --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn`. For bug-fix churn, add `--grep='fix' -i`.
  2. Complexity: `lizard --csv <src>`, then aggregate max CCN and summed NLOC per file.
  3. Rank files by churn rank × complexity rank and work down the top 10-20. This ranking is a heuristic with no independent validation.
  4. For each hotspot, list its complex functions (F02/F03).
  5. Report complex files that rarely change, and refactor them only if tests exist (F13).
- **Tools:** git, lizard, code-maat, CodeScene.
- **Applies to:** Any project with version history. For a new project with little history, use bug reports and the modules the user says they will extend.
- **When not to apply / counterpoints:**
  - On a finished project, past churn reflects the initial build, not future maintenance.
  - The CodeScene figures are vendor data.
  - Kim et al.'s benefits came from a dedicated team with strong testing infrastructure, doing architectural refactoring.
- **Fix risk:** low. This is prioritisation only.

### T03-F10 — Do not use the Maintainability Index (MI) to select, justify or report refactorings. Report its components (size, CC or cognitive complexity, nesting) separately, per function, using maximums or high percentiles rather than averages.
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. Changes:
  1. **MI's origin.** The researcher said the formula comes from "a few small 1990s C and Pascal programs". Per van Deursen, the Hewlett-Packard systems were "written in C and Pascal in the late 80s" (1,000-10,000 lines); the metric was published in the early 1990s.
  2. **Counter-evidence was added.** Chowdhury et al. (EMSE 2022, 730K methods) found that, once size is neutralised, "Maintainability Index performs even better" than Readability, and it was the only metric that performed consistently across all maintenance indicators. The "does not match maintenance effort" claim therefore rests on one 4-system case study and is contested.
  3. **What still holds.** The rule survives because MI is a composite that does not say what to fix, and its tool cut-offs were chosen for low noise, not validated.
- **Rationale:**
  - MI combines size-correlated inputs (Halstead volume, CC, LOC), historically averaged per module, with coefficients fitted in the early 1990s.
  - Visual Studio clips and rescales it to 0-100, with red/yellow/green cut-offs chosen "to keep the noise level low".
  - Radon uses the same 20/10 cut-offs (with its own MI variant) without citing a source.
  - In one case study, MI ranked four equivalent systems opposite to their measured maintenance effort. A large method-level study found MI predictive beyond size, although part of that may be non-linear size, since MI contains ln(LOC).

  For a hardening pass, what matters is that MI is not actionable.
- **Evidence:**
  - [Think Twice Before Using the "Maintainability Index"](https://avandeursen.com/2014/08/29/think-twice-before-using-the-maintainability-index/) — Arie van Deursen (TU Delft), 29 Aug 2014 — engineering_blog (academic author) — "The set of programs used to derive the metric and evaluate it was small, and contained small programs only"; systems "written in C and Pacscal in the late 80s" (sic); "you'll be better off looking at lines of code, as it gives easier to understand information on maintainability than a formula computed over averaged metrics confounded by size" — VERIFIED; the date of the programs was corrected.
  - [Questioning Software Maintenance Metrics](https://www.mn.uio.no/ifi/personer/vit/dagsj/sjoberg.anda.mockus.esem.2012.pdf) — Sjøberg, Anda, Mockus 2012 — peer_reviewed — "using the Maintainability Index, one could argue that hiring an expensive company with heavy processes (System D) improves maintainability"; MI "range[s] from 113 (System A) to 120 (System D)" — VERIFIED.
  - [Code metrics: Maintainability index range and meaning](https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-maintainability-index-range-and-meaning) — Microsoft Learn (ms.date 2025-01-09) — official_docs — `MAX(0,(171 - 5.2 * ln(Halstead Volume) - 0.23 * (Cyclomatic Complexity) - 16.2 * ln(Lines of Code))*100 / 171)`; 0-9 red, 10-19 yellow, 20-100 green; "we decided to be conservative with the thresholds"; "we decided to break down this 0-100 range 80-20 to keep the noise level low" — VERIFIED. These are two separate sentences, which the researcher joined with an ellipsis.
  - [Radon API docs](https://radon.readthedocs.io/en/latest/api.html) — Radon (docstrings of `mi_rank`/`cc_rank` in `radon/metrics.py` and `radon/complexity.py`) — official_docs — MI rank "A if score > 19; B if 9 < score <= 19; C if score <= 9"; CC ranks A (1-5) to F (41+); no source cited for either — VERIFIED. WebFetch hit a DNS error; the docs were fetched with curl and the source checked on GitHub.
  - [Revisiting the Debate (EMSE preprint), §5.1](https://www.cs.ubc.ca/~rtholmes/papers/emse_2022_chowdhury_preprint.pdf) — Chowdhury, Holmes, Zaidman, Kazman, EMSE 2022 — peer_reviewed — **counter-evidence**: "Maintainability Index performs even better. This clearly refutes the claim that code metrics are not useful after size influence is neutralized"; "Except for the Maintainability Index, the performance of other metrics, however, are not the same across all maintenance indicators" — VERIFIED.
- **Detect:**
  - Search the repository and CI config for MI usage: `rg -n -i "radon mi|maintainability.?index|maintidx|CA1505|wily"`.
  - Treat any MI gate as advisory only, and replace it with per-function reports from lizard or `radon cc` plus nesting checks.
- **Tools:** ripgrep, `radon cc`, lizard.
- **Applies to:** Any project whose dashboards or CI use MI: Visual Studio code metrics, `radon mi`, golangci-lint `maintidx` (default `under: 20`, confirmed), wily.
- **When not to apply / counterpoints:** MI is built into Visual Studio and many dashboards. As a trend line for one codebase measured by one tool, it is mostly harmless and may carry signal (Chowdhury EMSE 2022). Do not remove an existing MI dashboard just to follow this rule; simply do not act on it.
- **Fix risk:** low. This is a reporting change only.

### T03-F15 — Prefer the transformations that the cognitive-complexity spec scores lower: flatten nesting; replace if/else-if chains on one value with switch/match or a lookup; pull compound boolean conditions into named variables or predicates; use null-coalescing and optional chaining. Before applying each one, check its semantic trap.
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. Changes:
  1. **Causal leap removed.** The rationale said these rewrites reduce comprehension time "per the partial validation". The meta-analysis shows a correlation across *different* snippets; it does not show that rewriting a given function lowers comprehension time. The actual support is the spec's own design rationale (vendor), Fowler's catalogue and a practitioner essay.
  2. **Ruff `PLR0916`** is a preview rule.
  3. **The semantic-trap list** is standard language semantics and was not verified against language specifications here.
- **Rationale:**
  - The Sonar spec ignores shorthand such as null-coalescing and charges a whole switch +1, while an if/else-if chain costs an increment per branch.
  - It charges once per sequence of like boolean operators and adds a cost for each nesting level, so these rewrites lower the *score* by construction.
  - Whether they lower comprehension effort for a given function has not been tested empirically.
  - Pylint and Ruff cap boolean expressions per `if` at 5.
  - grug recommends naming sub-conditions for readability and debugging. His own example keeps the null guard (`if(contact)`) outside the named booleans, which is exactly trap (3) below.
- **Evidence:**
  - [Cognitive Complexity white paper v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — SonarSource 2023 — vendor spec — "1. Ignore structures that allow multiple statements to be readably shorthanded into one 2. Increment (add one) for each break in the linear flow of the code 3. Increment when flow-breaking structures are nested"; "an if-else if chain must be read carefully, while a switch can often be taken in at a glance"; "Cognitive Complexity ignores null-coalescing operators"; it "increments for each new sequence of like operators" — VERIFIED.
  - [Replace Nested Conditional with Guard Clauses](https://refactoring.com/catalog/replaceNestedConditionalWithGuardClauses.html) — Martin Fowler — book catalog — the `getPayAmount` rewrite into sequential guard clauses — VERIFIED.
  - [The Grug Brained Developer](https://grugbrain.dev/) — Carson Gross (page undated; widely circulated since 2022) — engineering_blog — rewrites `if(contact && !contact.isActive() && (contact.inGroup(FAMILY) || contact.inGroup(FRIENDS)))` as `if(contact) { var contactIsInactive = ...; var contactIsFamilyOrFriends = ...; if(contactIsInactive && contactIsFamilyOrFriends) ... }`: "easier debug! see result of each expression more clearly and good name!" — VERIFIED.
  - [Ruff settings: lint.pylint.max-bool-expr](https://docs.astral.sh/ruff/settings/) and the [PLR0916 rule page](https://docs.astral.sh/ruff/rules/too-many-boolean-expressions/) — Astral — official_docs — "Maximum number of Boolean expressions allowed within a single if statement (see PLR0916). Default value: 5"; the PLR0916 page: "This rule is unstable and in preview" — VERIFIED.
- **Detect:**
  - clang-tidy `readability-function-cognitive-complexity` (`DescribeBasicIncrements` defaults to true) lists each construct that adds to the score.
  - eslint-plugin-sonarjs `cognitive-complexity` reports per function.
  - Ruff `PLR0916` (with `--preview`) or Pylint R0916. Checkstyle `BooleanExpressionComplexity` (default max 3).
  - Manual: if/else-if chains that compare the same variable 3 or more times, e.g. ast-grep `if ($X === $A) { $$$ } else if ($X === $B) { $$$ }`.
- **Tools:** clang-tidy, eslint-plugin-sonarjs, Ruff PLR0916 (preview), Pylint, Checkstyle, ast-grep.
- **Applies to:** All languages. The operators are language-specific: `??` and `?.` exist in JS/TS/C#/Kotlin/Swift; Python has neither.
- **When not to apply / counterpoints:**
  - RuboCop data shows `Style/GuardClause` disabled by 32.2% of configs, so style preferences vary.
  - A JS `switch` has fallthrough and no exhaustiveness checking, whereas a TS discriminated union with a `never` check does.
  - A lookup table can hide control flow from type checkers.
- **Fix risk:** high. The trap for each rewrite:
  1. `a || b` to `a ?? b` changes results for `0`, `''`, `false` and `NaN`.
  2. `?.` turns a crash into a silent `undefined`, hiding bugs.
  3. Pulling `x != null && x.f()` out into `const ok = x.f()` loses short-circuiting, so it can throw or run side effects early.
  4. An if-chain rewritten as a switch changes comparison semantics (`===` vs `==`, pattern order) and risks fallthrough.
  5. Guard clauses reorder side effects and can skip cleanup (see F05).

### T03-F16 — On code paths whose input can grow (files, API or database results, user collections, logs), flag work that re-scans data inside a loop: membership tests on arrays/lists (`indexOf`/`includes`/`find`), `strlen`/`sscanf` over a growing buffer, string concatenation in loops, nested loops over the same collection. Replace them with hashed lookups or single-pass algorithms, but only after measuring with realistic input sizes.
- **Grade:** C · **Verdict:** VERIFIED. All figures were confirmed. For precision, here is how the GTA Online time splits. After about a minute of common loading, one core was maxed out for about four minutes on **both** problems:
  - the JSON parser patch alone took load time from 6m to 2m50s;
  - the dedup patch alone took it to 4m30s;
  - both together took it to 1m50s.

  This is one person's measurement on his own hardware. The detection patterns are the researcher's own and unvalidated.
- **Rationale:** Complexity scores do not see algorithmic complexity. Documented incidents show quadratic code shipping because it is fast on small test data:
  - **GTA Online** parsed a 10 MB JSON of about 63k items with `sscanf` (which calls `strlen` each time) and ran a linear-scan dedup of about 1.98 billion comparisons. Patching both cut load time by 69.4%. Rockstar shipped a fix on 16 Mar 2021.
  - **Windows WMI:** a repository check took 5-10 minutes on a 2.6 GB repository, with more than 100 processes blocked.

  Bruce Dawson's summary: O(n²) is fast enough to reach production and slow enough to fail there.
- **Evidence:**
  - [O(n^2), again, now in WMI](https://randomascii.wordpress.com/2019/12/08/on2-again-now-in-wmi/) — Bruce Dawson, 8 Dec 2019 — engineering_blog — "O(n^2) is the sweet spot of badly scaling algorithms: fast enough to make it into production, but slow enough to make things fall down once it gets there."; a nine-instruction loop; a 2.6 GB repository; over 100 processes blocked — VERIFIED.
  - [How I cut GTA Online loading times by 70%](https://nee.lv/2021/02/28/How-I-cut-GTA-Online-loading-times-by-70/) — t0st, 28 Feb 2021 (update 16 Mar 2021) — incident_report (independent reverse-engineering) — "10 megabytes worth of JSON with some 63k item entries"; "(63000^2+63000)/2 = 1984531500 checks"; "max out a single core on my machine for four minutes"; "Time with only duplication check patch: 4m 30s / Time with only JSON parser patch: 2m 50s / Time with both issues patched: 1m 50s"; 69.4% — VERIFIED.
- **Detect:** These are the researcher's patterns and have not been validated.
  - ast-grep or semgrep:
    - JS/TS: a `for` / `for...of` / `.forEach` / `.map` whose body contains `$ARR.includes($X)`, `$ARR.indexOf($X)`, `$ARR.find(...)` or `$ARR.filter(...)` where `$ARR` is not the loop variable.
    - Python: `for $x in $xs:` whose body contains `if $y in $list` where `$list` is a list.
    - C/C++: `strlen`/`sscanf`/`strcat` inside loops on the same buffer.
    - Java: String `+=` inside a loop.
  - Dynamic check: run the path with n, 10n and 100n inputs. Time growing roughly with the square of the input growth (about 100x at 10n) suggests quadratic behaviour.
  - Profile with the language's profiler before changing anything.
- **Tools:** ast-grep, semgrep, profilers (perf, py-spy, Chrome DevTools, pprof).
- **Applies to:** All languages; data-processing, parsing, import/export and batch paths.
- **When not to apply / counterpoints:** For small, bounded n, a linear scan is often faster than hashing and clearer. Do not change it without evidence that n can grow.
- **Fix risk:** medium. Switching to a Set or Map can:
  - change equality semantics (identity vs value, NaN, case-folding);
  - remove duplicates that the old code relied on;
  - change iteration order;
  - increase memory use.

## Practitioner voice
- [rust-clippy #3793: Suggestion for new lint: Cognitive Complexity](https://github.com/rust-lang/rust-clippy/issues/3793) — felix91gr proposed the lint (Feb 2019), implemented it (PRs #3803, #3963, #4516), then retracted his own proposal on 16 Oct 2019. He called the Sonar document "a _whitepaper_, **not** a _paper_" with "**no empirical base**", and wrote: "Cyclomatic Complexity is a really bad metric. It shouldn't be used for linting, except for setting up a test suite." oli-obk: pure CC is "pretty useless in Rust" because `match` is often used as a lookup table. The issue was closed on 3 Jul 2025, after his PR #14915 corrected the lint's documentation.
- [rubocop #15363: Tuning RuboCop's defaults from real-world usage data](https://github.com/rubocop/rubocop/issues/15363) — Bozhidar Batsov, 28 Jun 2026. Of the 500 most-starred Ruby repos, 233 ship a config. Metric cops are the most-disabled rules after `Style/Documentation`: AbcSize 43.3%, ClassLength 41.6%, CyclomaticComplexity 39.9%, MethodLength 39.9%. Median overrides: MethodLength 22, CC 10, PerceivedComplexity 12, BlockNesting 3. In the issue he argued for raising thresholds; the 1.91.0 changelog (10 Sep 2026) goes further and disables them under `Preview`, ahead of RuboCop 2.0.
- [eslint #19360: Exclude Default Parameter Values from Cyclomatic Complexity](https://github.com/eslint/eslint/issues/19360) — Jan 2025. A function whose only "logic" was 10 destructured default values tripped the complexity gate, and raising the global max to 25 would have hidden real problems elsewhere. A maintainer showed a workaround that lowers CC "despite looking more convoluted". The maintainers declined an option ("keep it true to the name") and suggested copying the rule into a custom one.
- [It's probably time to stop recommending Clean Code](https://qntm.org/clean) — qntm, 28 Jun 2020. It quotes Martin admitting that he cannot cite research showing very small functions are better, and argues that the book's own refactored examples are poor.
- [APOSD vs Clean Code](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md) — Ousterhout and Martin's written debate, Sep 2024 to Feb 2025. Ousterhout argues that over-decomposition produces shallow, entangled methods that must be read together. Martin concedes that he "struggled with the names and structure" of his own `PrimeGenerator` when he revisited it, and adds that Ousterhout's rewrite gave him equal trouble.
- [John Carmack on Inlined Code](http://number-none.com/blow/john_carmack_on_inlined_code.html) — Carmack's email of 13 Mar 2007, with a 2014 preface, hosted by Jonathan Blow. "If a function is only called from a single place, consider inlining it", because most bugs come from execution state not being what you think. The 2014 preface favours pure functions as the more direct fix.
- [Goodbye, Clean Code](https://overreacted.io/goodbye-clean-code/) — Dan Abramov, 11 Jan 2020. He deduplicated a colleague's code to half its size, and his boss asked him to revert it: "My code traded the ability to change requirements for reduced duplication, and it was not a good trade."
- [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) — Sandi Metz, 20 Jan 2016. A shared abstraction gains a parameter and conditional logic with each new requirement. "duplication is far cheaper than the wrong abstraction"; the remedy is to re-introduce duplication by inlining the code back into each caller.
- [The Grug Brained Developer](https://grugbrain.dev/) — Carson Gross. "complexity _very_, _very_ bad". Do not factor too early; wait for cut points with narrow interfaces. Name sub-conditions so they are easier to debug.
- ["Clean" Code, Horrible Performance](https://www.computerenhance.com/p/clean-code-horrible-performance) — Casey Muratori, 28 Feb 2023. On a shape-area microbenchmark, a switch was about 1.5x faster than virtual dispatch, a table about 10x faster, and a light AVX version about 20-25x faster. This is a hot-path caution, not a general result.
- [APOSD vs Clean Code: a debate](https://tryingthings.wordpress.com/2025/02/25/aposd-vs-clean-code-a-debate/) — Sorin Costea, 25 Feb 2025. "make small units of code, and make them do one thing (whatever you define as thing)", but "don't overdo it in either direction just for the sake of ideology".
- [O(n^2), again, now in WMI](https://randomascii.wordpress.com/2019/12/08/on2-again-now-in-wmi/) — Bruce Dawson, 2019. A nine-instruction loop in WMI took 5-10 minutes on a 2.6 GB repository and blocked more than 100 processes. "O(n^2) is the sweet spot of badly scaling algorithms."
- [How I cut GTA Online loading times by 70%](https://nee.lv/2021/02/28/How-I-cut-GTA-Online-loading-times-by-70/) — t0st, 2021. An outside engineer profiled the 6-minute load and found repeated `strlen` through `sscanf` on a 10 MB JSON, plus an O(n²) dedup over 63k items. He cut load time by 69.4%, and Rockstar shipped a fix.
- [Details of the Cloudflare outage on July 2, 2019](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) — John Graham-Cumming, 2019. A 27-minute global outage came from one WAF regex with catastrophic backtracking. The plan was to move to regex engines with run-time guarantees.

## Contradictions and open questions

**Contradictions (verified on both sides):**
1. **Is CC redundant with size?**
   - Jay et al. (2009, 1.2M files, file level, log-log): CC has "absolutely no explanatory power of its own".
   - Landman et al. (24M methods and functions, method level): R² 0.40/0.44, not redundant.
   - Landman et al. themselves show that the gap comes from aggregation level and transforms.
   - Chowdhury et al. (EMSE 2022) side with Landman once size is controlled by regression, and show that dividing by LOC fails.
2. **Is cognitive complexity validated?** Muñoz Barón et al. call it "the first validated" understandability metric (time r = 0.54), yet the same data shows no reliable link with correctness. Esposito et al. call it and CC only "modest predictors", and say high values make understandability "unpredictable". Clippy's docs say it cannot be calculated with current technology. Lavazza et al. (JSS 2023) compared it with LoC and McCabe, but their conclusion could not be verified.
3. **What NIST says about CC and readability.** NIST presents CC as a test count, but justifies limiting it mainly through its correlation with reliability, maintainability and understandability. McCabe (1976) proposed limiting modules "by cyclomatic complexity instead of physical size". Checkstyle and Sonar say CC is "not about quality" / "unsatisfactory" for maintainability.
4. **Small functions.** Chowdhury et al. (MSR 2022) recommend 24 SLOC or fewer and find decomposed groups less change-prone (small effects). Tempero et al. (ICPC 2024) find the effect on comprehension inconclusive. Ousterhout, Carmack and qntm report harm from over-decomposition. Fowler says functions of more than about six lines start to smell, while Martin concedes he has no research.
5. **Switch statements.** McCabe, NIST, Linux and CA1502 exempt a large flat switch. NIST warns that altering the metric to discount switches was gamed (90 down to a "modified" 10). Yet ESLint's `modified` variant, Checkstyle's `switchBlockAsSingleDecisionPoint` and Sonar's cognitive metric all discount switches by design.
6. **Threshold values.** NIST backs 10 (15 under conditions), and McCabe calls 10 "not magical".
   - CC defaults: RuboCop 7; Pylint extension, Ruff, PMD, Checkstyle and cyclop 10; lizard 15; ESLint 20; CA1502 25; gocyclo 30, while its own docs recommend 10-20.
   - Cognitive defaults: 15 (Sonar/PMD/sonarjs), 25 (clang-tidy/Clippy), 30 (gocognit).
   - The only meta-analysis offers no threshold.
7. **The Maintainability Index.** Sjøberg et al. (4 systems) and van Deursen find it misleading. Chowdhury et al. (EMSE 2022, 730K methods) find MI the best and most consistent predictor of change-proneness beyond size.
8. **RuboCop's direction.** In June 2026 the issue said the high disable rates mean "thresholds are too strict", not that the cops should go, and called BlockNesting's default well calibrated. The September 2026 changelog and `default.yml` nonetheless schedule all these cops, BlockNesting included, to be disabled by default in 2.0.
9. **Refactoring to reduce complexity.** In Kim et al. (Microsoft), the Windows binaries a dedicated team refactored most often had a 12.2% larger drop in post-release defects, yet 77% of the engineers surveyed see refactoring as risking regressions. Sjøberg et al. warn that local improvements can harm the whole system.
10. **Replace Conditional with Polymorphism.** This standard complexity-reducing refactor (Fowler/Martin) conflicts with Muratori's microbenchmark, where a switch was about 1.5x faster and a table about 10x faster than virtual dispatch.
11. **Perceived difficulty vs anchoring.** Metrics correlate with perceived difficulty (ratings r = -0.29), but showing developers the metric value strongly anchors their perception (Wyrich et al., ICSE 2021).

**Open questions:**
- **Cognitive thresholds.** No study validates any specific cognitive-complexity threshold; only two of the pooled studies had snippets above 15. Is 15 (Sonar/PMD) or 25 (clang-tidy/Clippy) the better review trigger?
- **Other languages.** Do the method-length findings (24 SLOC, open-source Java only, a benchmark-percentile threshold) transfer to Python, TypeScript, Rust or Go, where comprehensions, closures and `match` change line density?
- **IDE and LLM navigation.** How much does IDE or LLM-assisted navigation change the cost of many small functions? The decomposition experiments used small tasks and static code.
- **AI-generated code.** No verified evidence was gathered on whether AI-generated code has different complexity profiles, or whether metric-driven refactoring by AI agents causes more regressions than refactoring by humans. This is directly relevant to the skill.
- **Class and module level.** Aggregation at class/module level (Sonar sums per class; PMD `classReportLevel` 80) lacks validation comparable to the method level.
- **Accidental O(n²).** No general static detector was found beyond ReDoS-specific tools. The patterns in F16 are unvalidated.
- **Lavazza et al. (JSS 2023).** The paper remains unread in full. Its effect sizes, and whether its dataset overlaps with Muñoz Barón et al.'s, need a pass with library access.
- **Parameter counts.** Every parameter-count number found (3, 5, 7, 10, 100) is a tool convention. No defect or change-proneness study controlling for size was found.
- **Why MI outperformed in Chowdhury et al.** Is its edge beyond size real signal, or residual non-linear size (it contains ln(LOC) and Halstead volume)?

## Dropped findings
None of the 17 findings was dropped. Evidence items removed or rejected along the way:
- **Lavazza et al. (JSS 2023), conclusion.** The claim that Cognitive Complexity "appears to be correlated to code understandability approximately as much as traditional measures" came from a search snippet. The full text is unreachable (publisher 403; the IRIS copy sits behind Cloudflare; no arXiv copy). The paper exists, but the claim is not used as support (F02).
- **NIST as the source of "CC is not about readability."** This was a misattribution; NIST says the opposite about why CC is limited (F02, Summary).
- **Sjøberg et al. as "best-replicated predictor".** Dropped; it is a single 4-system case study (F01, Summary).
- **"1990s" as the origin of MI's calibration programs.** Replaced by late-1980s HP systems, per van Deursen (F10).
- **The Carmack mirror URL as the primary source.** Replaced by the original number-none.com page; the mirror is noted (F07).
- **Correction retracted.** A previous run of this wave claimed that the Muñoz Barón et al. quote in F14 does not exist. It does (arXiv v1 §5.3), so F14 stands as VERIFIED.
