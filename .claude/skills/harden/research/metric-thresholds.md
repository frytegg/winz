# Resolving the threshold contradiction: absolute limits vs benchmark-derived vs per-repository relative thresholds for complexity, length and parameters
> Code G208 · slug metric-thresholds · verified 2026-09-23 · counts: verified 7 / corrected 8 / downgraded 4 / dropped 0

## Summary

No verified source supports a single "correct" number for complexity, function length or parameter count. The conflicting limits fall into three groups, and most rest on little evidence.

**1. Conventions: tool defaults are negotiated values.**
- **ESLint `complexity` = 20** (issue #4808, 2015). The issue author wrote "I don't know what a good number would be". He then suggested 20 because ESLint's own code peaked at 36, with only 6 functions above 20. A contributor framed 20 as an "only stop me if I'm approaching insanity" default. He personally leaned towards 10 or 15.
- **golangci-lint gocyclo/gocognit = 30**, with the note "but we recommend 10-20".
- **Sonar S3776 cognitive complexity = 15.** The value lives only in rule code (`DEFAULT_MAX = 15`). The white paper (v1.7, 29 Aug 2023) gives no threshold.
- **Clippy `cognitive_complexity`.** Clippy has disowned this lint ("We used to think it measured how hard a method is to understand"). It moved from `nursery` to `restriction` in Rust 1.91 (2025-10-30).

**2. Benchmark percentiles (the Alves/SIG method).** Thresholds are read at 70/80/90% of code volume.
- **"24 SLOC"** is the 70% quantile of 785K methods from 49 Java projects (Chowdhury et al., MSR 2022). Crossing it has mostly medium-to-large effects on change-proneness across the 49 projects, but only negligible-to-small effects on bug-proneness (F04).
- **SIG's current bands** (Guidance for Producers v18.1, 31 March 2026) are 15/30/60 LOC, CC 5/10/25 and ≥3/≥5/≥7 parameters. They are applied per language as caps on the share of code volume, never as zero tolerance. For example, at most 9.1% of code may sit in units over 60 LOC.

**3. Fault-based thresholds (ROC or logistic).** Where defect data exists, these beat distribution-based ones.
- Shatnawi 2010 shows this from its full abstract. Boucher & Badri 2018 and Lavazza & Morasca 2016 support it only through machine-generated summaries.
- Several peer-reviewed studies found no step "threshold effect" at class or file level. The size–fault relationship is continuous (El Emam et al. 2002) or logarithmic (Koru et al. 2009). Shatnawi 2010, however, reports threshold effects for CK metrics on Eclipse, so the literature is not unanimous.
- Yamashita et al. (QRS 2016) derived Alves thresholds from 1,000 OSS and 205 industrial Java projects. They evaluated them on 3 OSS projects (9 versions) and 4 industrial projects, at file level. Very-high-risk files were more often defective but had uniformly lower defect density. The authors say thresholds should be used "with caution if at all".
- Ranking modules inside a project by size is a strong defect-prediction baseline (Zhou et al., TOSEM 2018).

**Metric definitions differ by tool, variant and version:**
- Ruff C901 ignores `and`/`or` and comprehensions, while Radon counts them.
- ESLint has counted logical assignment since v7.18.0 (January 2021). Since v9.0.0 (April 2024) it also counts `?.` and default values.
- Sonar cognitive complexity ignores null-coalescing and safe-navigation operators.
- ESLint (since v9.12.0, October 2024), lizard (`-m`) and Checkstyle (`switchBlockAsSingleDecisionPoint`) all offer a "switch counts as one" variant.

A number therefore means nothing without its tool, variant and version.

**Resolution: one layered default.**
- **Layer 1: absolute review triggers.**
  - Classic CC >10, with high priority above 25.
  - Sonar-spec cognitive complexity >15.
  - Logical SLOC >60. The Python/Ruby value of 45 is poorly supported and advisory only.
  - ≥7 parameters.

  A trigger must end in either a behaviour-preserving refactor or a written justification, following NIST SP 500-235.
- **Layer 2: a SIG-style risk profile per language**, for reporting only.
- **Layer 3: a relative tail inside the repository**, for prioritisation only. It covers only functions already above an absolute floor and needs ≥200 functions per language. That cut-off is an unvalidated convention.

The project's own configuration takes precedence for enforcement, and inline suppressions count as recorded exceptions. Every report states the tool, version, variant and origin of each threshold. The layered policy as a whole is graded C/D; its parts range from A to D.

## Findings

### G208-F02 — Never cite a tool's shipped default as evidence that code is "too complex". Label every default as a convention and record where it came from
Defaults to label:
- **ESLint:** `complexity` 20, `max-params` 3, `max-lines-per-function` 50.
- **Ruff:** C901 10; `max-args` 5; the Pylint-style `max-branches` 12 and `max-statements` 50.
- **Clippy:** cognitive 25, `too_many_arguments` 7, `too_many_lines` 100.
- **Sonar:** S3776 15.
- **PMD:** CC 10, cognitive 15, NPath 200, ExcessiveParameterList 10, NcssCount 60.
- **lizard:** CCN 15, length 1000.
- **golangci-lint:** gocyclo/gocognit 30, cyclop 10, funlen 60 lines / 40 statements.
- **.NET:** CA1502 25.

- **Grade:** A · **Verdict:** CORRECTED. Three attributions were fixed:
  - The phrase "name squatter" came from a commenter in PR #15094, not from the PR itself.
  - ESLint's 20 came partly from the distribution of ESLint's own code and was framed as an "approaching insanity" default.
  - `eslint:recommended` listed 11 with the rule switched **off**.
- **Rationale:** Where a vendor's reasoning is documented at all, it is ad hoc.
  - **ESLint (2015):** the issue author could not name a number and another maintainer guessed ~4. The author then proposed 20 by looking at ESLint's own worst functions: a maximum of 36, with only 6 above 20. A contributor compiled Microsoft's 25, Aivosto's "above 20 alarming", Checkstyle's "keep it below 20" and McConnell's ranges, and nzakas accepted 20.
  - **golangci-lint** ships 30 while recommending 10–20. Its default limits noise; it does not express quality.
  - **Clippy** has disowned its complexity lint.
  - **Sonar:** the white paper gives no threshold at all.

  Shipped defaults for the same metric range over a factor of 3 (CC 10–30).
- **Evidence:**
  - [ESLint issue #4808 "Complexity has no default" (comments via API)](https://api.github.com/repos/eslint/eslint/issues/4808/comments) — ESLint (GitHub), 2015 — practitioner_forum — IanVS (opening post): "I don't know what a good number would be, though." gyandeeps: "My wild guess would be ~4." IanVS: "The highest we have within ESLint code is 36, but there are only 6 above 20. Maybe `20` is a good number?" SpadeAceman: "an 'only stop me if I'm approaching insanity' sort of default". nzakas: "Sounds like 20 is a good upper bound as the default." Commit 1288ba43 (2015-12-31) sets `: 20`. — Verified by reading the full comment JSON and the commit diff.
  - [golangci-lint linters configuration](https://golangci-lint.run/docs/linters/configuration/) — golangci-lint, 2026 — official_docs — gocyclo/gocognit "Default: 30 (but we recommend 10-20)"; cyclop "Default: 10"; funlen lines "Default: 60", statements "Default: 40". — Verified.
  - [cognitive_complexity.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/cognitive_complexity.rs) — rust-lang/rust-clippy, 2026 — official_docs — "We used to think it measured how hard a method is to understand." / "This lint has been left in `restriction` so as to not mislead users into using this lint as a measurement tool." The docs suggest `excessive_nesting` and `too_many_lines` instead. — Verified in the source.
  - [Clippy PR #15415](https://github.com/rust-lang/rust-clippy/pull/15415) and [CHANGELOG](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/CHANGELOG.md) — rust-lang/rust-clippy, 2025 — official_docs — CHANGELOG, Rust 1.91 (released 2025-10-30): "Moved [`cognitive_complexity`] from `nursery` to `restriction` #15415". — Verified. **Correction:** the earlier deprecation PR #15094 was closed unmerged ("Superseded by #15415"). "Name squatter" was a remark by a commenter (LebedevRI, 2025-07-11) that the lint does not follow the Sonar spec. The PR itself did not say it.
  - [Cognitive Complexity white paper v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — G. Ann Campbell / SonarSource, 29 Aug 2023 — official_docs — The full text contains no threshold, limit or recommendation; it frames the metric as measuring "relative" understandability. — Verified with pdftotext and grep.
  - [CognitiveComplexityMethodCheck.java (S3776)](https://raw.githubusercontent.com/SonarSource/sonar-java/master/java-checks/src/main/java/org/sonar/java/checks/CognitiveComplexityMethodCheck.java) — SonarSource, 2026 — official_docs — `private static final int DEFAULT_MAX = 15;` — Verified.
  - [Ruff settings](https://docs.astral.sh/ruff/settings/) — Astral, 2026 — official_docs — `max-complexity` 10; `max-args` 5; `max-positional-args` 5; `max-branches` 12; `max-statements` 50; `max-returns` 6; `max-locals` 15; `max-nested-blocks` 5. — Verified from page HTML.
  - [PMD Java design rules](https://pmd.github.io/pmd/pmd_rules_java_design.html) — PMD, 2026 — official_docs — CyclomaticComplexity `methodReportLevel` 10; CognitiveComplexity `reportLevel` 15; NPathComplexity `reportLevel` 200 ("A threshold of 200 is generally considered the point where measures should be taken…"); ExcessiveParameterList `minimum` 10; NcssCount `methodReportLevel` 60. — Verified.
  - [lizard README](https://raw.githubusercontent.com/terryyin/lizard/master/README.rst) — terryyin/lizard, 2026 — official_docs — CCN "The default value is 15."; length "The default value is 1000." — Verified; no rationale given.
  - [ESLint max-params](https://eslint.org/docs/latest/rules/max-params) / [max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function) — ESLint, 2026 — official_docs — defaults 3 and 50. `skipBlankLines` and `skipComments` both default to false. — Verified.
- **Detect:** Read each tool's effective configuration. Where a value equals the tool default, label it "vendor default (convention)". Search config files with `complexity|max-complexity|max-args|max-params|max-lines-per-function|too-many-.*-threshold|cognitive-complexity-threshold|min-complexity|funlen|CA1502`.
- **Tools:** ripgrep, `eslint --print-config`, `ruff check --show-settings`, cargo clippy, `golangci-lint config verify`.
- **Applies to:** Every report that mentions a threshold.
- **When not to apply / counterpoints:** Defaults encode accumulated practice and are reproducible, which helps consistency. The aim is to label their provenance, not to discard them.
- **Fix risk:** low

### G208-F09 — A complexity number is meaningless without its tool, version and variant. Measure each language with one named tool and variant, record them, never compare numbers across tools, and never switch variant silently to make findings disappear
- **Grade:** A · **Verdict:** CORRECTED. Two claims were fixed and one tool added: (audit correction: the switch-as-one `variant: "modified"` first shipped in ESLint v9.12.0, published 2024-10-04; 2024-09-25 is only the PR merge date. Logical assignment shipped in v7.18.0 the day PR #13979 merged.)
  - ESLint has counted logical assignment (`&&=`, `||=`, `??=`) since PR #13979, merged 2021-01-15 and shipped in v7.18.0 the same day. v9.0.0 added only `?.` and default values.
  - NIST's "90 → 10" example concerns a *divide-by-branch-count* variant, not the "switch counts as 1" variant that ESLint and lizard offer.
  - Checkstyle's `switchBlockAsSingleDecisionPoint` was added as a further switch-as-one variant.
- **Rationale:** The same function scores differently across tools.
  - **Ruff C901** walks statements only. It adds 1 per `if`, `elif`, `for`, `while`, `except` handler, `try…else`, match `case` (minus 1 for an irrefutable last case) and nested `def`. It never counts `and`/`or`, comprehensions or conditional expressions.
  - **Radon** adds 1 per boolean operator, comprehension, `with` and `assert`.
  - **gocyclo** counts `if`, `for`, `case`, `&&` and `||`.
  - **ESLint** counts logical operators and logical assignment, plus `?.` and default values since v9.
  - **Switch-as-one variants:** ESLint (v9.12.0+, October 2024), lizard `-m` and Checkstyle.

  NIST calls "modified" measures "not recommended". Treating multiway decisions specially means "modules containing several multiway decisions would not be identified as overly complex".
- **Evidence:**
  - [function_is_too_complex.rs (Ruff C901)](https://raw.githubusercontent.com/astral-sh/ruff/main/crates/ruff_linter/src/rules/mccabe/rules/function_is_too_complex.rs) — Astral, 2026 — official_docs — `get_complexity_number` matches only `Stmt::If/For/While/Match/Try/FunctionDef/ClassDef/With`. There is no `BoolOp`, comprehension or expression handling. — Verified by reading the function.
  - [Radon: Introduction to Code Metrics](https://radon.readthedocs.io/en/latest/intro.html) — Radon, 2026 — official_docs — Comprehension +1 ("equivalent to a for loop"); "Every boolean operator (and, or) adds a decision point"; `with` +1; `assert` +1. — Verified.
  - [ESLint v9.0.0 released](https://eslint.org/blog/2024/04/eslint-v9.0.0-released/) — ESLint, 5 Apr 2024 — official_docs — "The `complexity` rule now also takes into account optional chaining and default values in destructuring patterns and parameters." — Verified; logical assignment is not mentioned.
  - [ESLint PR #13979 (search result)](https://api.github.com/search/issues?q=repo:eslint/eslint+complexity+logical+assignment+is:pr+is:merged) — ESLint, 2021 — official_docs — "Update: check logical assignment operators in the complexity rule", merged 2021-01-15 and shipped in v7.18.0 the same day. — Verified via the GitHub search API; release version added by the citation audit.
  - [ESLint complexity rule](https://eslint.org/docs/latest/rules/complexity) and [PR #18896](https://api.github.com/repos/eslint/eslint/pulls/18896) — ESLint, 2024 — official_docs — Default 20; `variant: "modified"`: "each `switch` statement only increases the complexity value by `1`…". PR #18896 was merged 2024-09-25 (commit 2d17453) and first shipped in ESLint v9.12.0, published 2024-10-04. — Verified; release version added by the citation audit.
  - [gocyclo README](https://github.com/fzipp/gocyclo) — fzipp, 2026 — official_docs — "1 is the base complexity of a function +1 for each 'if', 'for', 'case', '&&' or '||'". — Verified.
  - [Checkstyle CyclomaticComplexity](https://checkstyle.org/checks/metrics/cyclomaticcomplexity.html) — Checkstyle, 2026 — official_docs — default max 10; `switchBlockAsSingleDecisionPoint` default false. — Verified (source added by the verifier).
  - [NIST SP 500-235](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — Watson & McCabe / NIST, August 1996 — standard (NIST special publication) — "One developer started reporting a 'modified' complexity in which cyclomatic complexity was divided by the number of multiway decision branches… could take a module with complexity 90 and reduce it to 'modified' complexity 10…"; "Although constructing 'modified' complexity measures is not recommended…" — Verified in the extracted PDF text (§2, pp. 15–16).
- **Detect:** Record `<tool> --version` and the effective variant in the report header: ESLint `variant`, lizard with or without `-m`, Ruff or Radon for Python, and Checkstyle `switchBlockAsSingleDecisionPoint`. When two tools disagree, report the native linter's number and note the other.
- **Tools:** ruff, radon, eslint, lizard, gocyclo, gocognit, pmd, checkstyle
- **Applies to:** All languages. This matters most for Python (Ruff vs Radon), JS/TS (ESLint before and after v9) and Go, where every `if err != nil` counts as an `if`.
- **When not to apply / counterpoints:** Teams may legitimately adopt a switch-as-one variant for dispatch-heavy code if it is declared in config and in the report (F10). What is not legitimate is switching silently.
- **Fix risk:** low

### G208-F10 — Before flagging a CC trigger, check whether the function is a flat dispatch. If it is, exempt it from the CC trigger and re-evaluate it on cognitive or switch-as-one CC. Never exempt a dispatch whose arms contain their own branching
A flat dispatch is a single switch, match or if-elif chain whose arms are trivial: one call, return or assignment, with no nested branching.
- **Grade:** A · **Verdict:** VERIFIED. The principle is well sourced; the CC/3 ratio heuristic is unvalidated.
- **Rationale:** Standards and official guides agree that long, flat multiway decisions are the classic CC false positive.
  - **NIST** exempts modules consisting of a single multiway decision. It withdraws the exemption when the branches contain complexity, and keeps it "if all branches have very low complexity code in them".
  - **The Linux kernel style guide** allows longer functions for "one long (but simple) case-statement".
  - **Microsoft** names large `switch` statements as candidates for suppressing CA1502.
  - **Sonar cognitive complexity** counts a whole switch as +1.
- **Evidence:**
  - [NIST SP 500-235](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — Watson & McCabe / NIST, 1996 — standard — "it is reasonable to exempt modules consisting of a single multiway decision statement from a complexity limit. Note that if the branches of the decision statement contain complexity themselves, the rationale and thus the exemption does not automatically apply. However, if all branches have very low complexity code in them, it may well apply." — Verified verbatim.
  - [Linux kernel coding style §6 Functions](https://www.kernel.org/doc/html/latest/process/coding-style.html) — Linux kernel docs, 2026 — official_docs — "if you have a conceptually simple function that is just one long (but simple) case-statement… it's OK to have a longer function." — Verified.
  - [CA1502: Avoid excessive complexity](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Microsoft Learn, 2026 — official_docs — "In particular, a method that contains a large `switch` (`Select` in Visual Basic) statement is a candidate for exclusion." — Verified.
  - [Cognitive Complexity white paper v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — SonarSource, 2023 — official_docs — `getWords` (a switch with three cases plus a default) scores "Cognitive Complexity 1" against CC 4. `sumOfPrimes` (nested loops with a condition) scores 7 against CC 4. — Verified.
- **Detect:** First, a heuristic: CC above the trigger, but switch-as-one CC ≤10 (ESLint `variant: "modified"` or `lizard -m`), or cognitive ≤ CC/3. The CC/3 ratio is the researcher's own and unvalidated. Then confirm manually: use ast-grep for `switch ($X) { $$$ }` or `match $X { $$$ }` and check that no arm contains `if`, `for`, `while` or `match`.
- **Tools:** eslint, lizard, ast-grep, sonarqube, gocognit, checkstyle
- **Applies to:** Parsers, command dispatchers, reducers, protocol and opcode handlers, enum-to-string maps. All languages.
- **When not to apply / counterpoints:** Very long dispatch tables may still merit a table- or map-driven refactor for readability. That is a design choice, not a complexity finding. A flat dispatch still needs one test per branch (NIST), so the exemption applies to "too complex" claims, not to test-coverage claims.
- **Fix risk:** medium

### G208-F03 — Do not treat a threshold as a cliff. Rank continuously, write "above the review trigger" and never "unmaintainable". At FILE and CLASS level, do not recommend redistributing code into smaller files or classes just to lower a metric
- **Grade:** B · **Verdict:** CORRECTED. Four changes:
  - **Scope narrowed.** The evidence that the largest entities have lower defect density is file- and class-level, not function-level. At method level, Chowdhury et al. found decomposition *reduces* maintenance indicators.
  - **Yamashita's design restated.** Thresholds were derived from 1,000 OSS and 205 industrial projects but evaluated on 3 OSS and 4 industrial projects.
  - **Shatnawi 2010 added** as counter-evidence: it found threshold effects.
  - **Koru's quote completed.**
- **Rationale:** Several studies tested the "threshold effect" (Goldilocks) conjecture and rejected it for OO classes and files.
  - **Benlarbi et al. (2000):** no threshold effects for CK metrics in two C++ telecom systems.
  - **El Emam et al. (2002):** "no threshold effect of class size" across three systems and four size measures, and a "simple continuous relationship between class size and faults".
  - **Koru et al. (2009):** at class level in four large products, the size–defect relationship is logarithmic.
  - **Yamashita et al. (2016):** Java files in the very-high-risk band were more likely to be defective but had uniformly lower defect density. Redistributing code into smaller files "may be counterproductive".

  Shatnawi (2010) is the exception. Using logistic regression on Eclipse, it concluded that "the CK metrics have threshold effects at various risk levels".
- **Evidence:**
  - [Thresholds for Size and Complexity Metrics: A Case Study from the Perspective of Defect Density (QRS 2016)](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Yamashita_QRS2016.pdf) — Yamashita, Huang, Nagappan, Kamei, Mockus, Hassan, Ubayashi, 2016 — peer_reviewed — "Surprisingly, the defect density was uniformly lower in the very high-risk group of files… risk thresholds for size and complexity metrics have to be used with caution if at all… the redistribution of Java code into smaller and less complex files may be counterproductive." — Verified verbatim in the full text. The case study covers 3 OSS projects (9 versions) and 4 industrial Java projects, at file level.
  - [Thresholds for object-oriented measures (ISSRE 2000)](https://api.openalex.org/works/doi:10.1109/ISSRE.2000.885858) — Benlarbi, El Emam, Goel, Rai, 2000 — peer_reviewed — "The results indicate there are no threshold effects for any of the measures studied." — Verified from the full OpenAlex abstract; full text not read.
  - [The optimal class size for object-oriented software (IEEE TSE)](https://api.openalex.org/works/doi:10.1109/TSE.2002.1000452) — El Emam et al., 2002 — peer_reviewed — "Our results provide unambiguous evidence that there is no threshold effect of class size… a simple continuous relationship between class size and faults". — Verified from the OpenAlex abstract.
  - [An Investigation into the Functional Form of the Size-Defect Relationship (IEEE TSE)](https://api.openalex.org/works/doi:10.1109/TSE.2008.90) — Koru, Zhang, El Emam, Liu, 2009 (online 2008) — peer_reviewed — "the size-defect relationship took a logarithmic form, indicating that smaller classes were proportionally more problematic than larger classes." (Mozilla, Cn3d, JBoss, Eclipse) — Verified from the OpenAlex abstract.
  - [A Quantitative Investigation of the Acceptable Risk Levels of OO Metrics (IEEE TSE)](https://api.openalex.org/works/doi:10.1109/TSE.2010.9) — Shatnawi, 2010 — peer_reviewed — "The empirical results indicate that the CK metrics have threshold effects at various risk levels." — Verified from the OpenAlex abstract. Counter-evidence added by the verifier.
- **Detect:** Check the report wording manually. Ban "must be below N", "unmaintainable" and "violates" for metric exceedances. When a proposed refactor only moves code between files or classes without removing logic, flag the proposal itself as low value.
- **Tools:** manual review
- **Applies to:** Report language, and refactor proposals at file and class level, for all languages.
- **When not to apply / counterpoints:**
  - Chowdhury et al. (MSR 2022) found at METHOD level that methods ≤24 SLOC are less change-prone and that decomposing large methods reduced maintenance indicators. The evidence against thresholds is mostly class- and file-level, OO, older, and uses defect density as the outcome.
  - Comprehension studies (Muñoz Barón 2020) support complexity metrics for understandability.
  - Shatnawi 2010 found threshold effects on a single system (Eclipse).
- **Fix risk:** high

### G208-F04 — Report a benchmark-percentile number as "above the p-th percentile of code volume in benchmark X (language, corpus, year)", not as a quality limit. Never transplant the Java-derived "24 SLOC" to other languages as a hard limit
This applies to any number derived with the Alves/SIG method.
- **Grade:** B · **Verdict:** CORRECTED (minor). The Alves corpus is now described as the abstract states it: "100 object-oriented systems, proprietary and open-source". The Java/C# split is not confirmed from an accessible source.
- **Rationale:** How the Alves method works:
  - It pools systems, weights every unit by its SLOC, and reads thresholds at 70/80/90% of code volume.
  - Its stated goal is to "help focus on a reasonable percentage of the source code volume". It makes no claim about harm.
  - On its 100-system benchmark it gave CC 6/8/14. SIG's certification uses 5/10/25 instead, expressed as allowed shares of code.

  Chowdhury et al. applied the method to 49 Java projects (785,606 methods) and got 24/36/63 SLOC.
  - **Bug-proneness**, small (≤24) vs medium: the effect was negligible in 38.78% of projects, small in 57.14%, medium in 4.08% and large in 0%.
  - **Change-proneness**, small vs medium: effects were mostly medium or large. For example, #revisions was medium in 55.1% of projects and large in 34.69%.
- **Evidence:**
  - [An Empirical Study on Maintainable Method Size in Java (MSR 2022)](https://arxiv.org/pdf/2205.01842) — Chowdhury, Uddin, Holmes, 2022 — peer_reviewed — "the first critical value in Figure 3 is 24 (from the x-axis), because it covers 70% of the y-axis. The second and the third values are 36 and 63, because they cover 80% and 90% of the y-axis respectively." Table 5, #BuggyCommits, Small-Medium: N 38.78, S 57.14, M 4.08, L 0.00. — Verified verbatim in the full text.
  - [Deriving metric thresholds from benchmark data (ICSM 2010)](https://api.openalex.org/works/doi:10.1109/ICSM.2010.5609747) — Alves, Ypma, Visser, 2010 — peer_reviewed — thresholds "(i) bring out the metric's variability between systems and (ii) help focus on a reasonable percentage of the source code volume"; "benchmark of 100 object-oriented software systems, both proprietary and open-source". — Verified from the OpenAlex abstract; full text not accessed.
  - [Extracting Relative Thresholds for Source Code Metrics (PhD thesis, UFMG)](https://repositorio.ufmg.br/bitstream/1843/ESBF-AAFJ7Z/1/palomamaira.pdf) — P. M. de Oliveira, Dec 2015 — thesis — describing Alves: "for McCabe metric the extracted thresholds are 6, 8 and 14, which represents 70%, 80%, and 90% quantiles." — Verified in the full text. This is a secondary description of Alves.
  - [SIG/TÜV NORD CERT Guidance for Producers v18.1](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability.pdf) — Software Improvement Group, 31 Mar 2026 — industry_report — McCabe bands >5 / >10 / >25, capped at 20.7% / 7.5% / 1.1% of LOC "for each programming language used". — Verified in the extracted PDF text.
- **Detect:** Search the report for 24, 15, 30 or 60 used as limits, and check that a percentile or benchmark provenance is attached. For each benchmark-derived number, record the corpus (language, number of systems) and the version.
- **Tools:** manual review
- **Applies to:** Function-length and CC thresholds borrowed from SIG or Alves-style studies. This matters most for Python, TS, Go and Rust, for which no function-level benchmark was found.
- **When not to apply / counterpoints:** Chowdhury et al. argue that 24 is both realistic and meaningful, since change-proneness effects for small→medium were medium to large. The effects were weak only for bug-proneness.
- **Fix risk:** low

### G208-F05 — At system level, express the policy as a relative threshold ("at least p% of functions, or of code volume, are within k"). Do not demand 100% compliance, and raise a systemic finding only when the tail exceeds its allowed share
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Source-code metrics are heavy-tailed, so some large or complex entities are normal in healthy systems.
  - Oliveira et al. derived relative thresholds [p, k] from the Qualitas Corpus (106 Java systems). Examples: NOM [80, 16] and SLOC [75, 222].
  - The thesis concluded that relative thresholds and the SIG method "convey similar information".
  - In a Pharo developer validation, only 4 of 9 non-compliant systems were judged harder to maintain.

  SIG certification uses the same logic, capping the share of code in each band.
- **Evidence:**
  - [Extracting Relative Thresholds for Source Code Metrics (PhD thesis)](https://repositorio.ufmg.br/bitstream/1843/ESBF-AAFJ7Z/1/palomamaira.pdf) — P. M. de Oliveira (advisor M. T. Valente), 2015 — thesis — "p% of the entities should have M ≤ k"; "We concluded that both methods convey similar information"; "We found that four out of nine noncompliant systems are harder to maintain. Therefore, noncompliant systems are not largely viewed as requiring more effort to maintain than other systems." — Verified in the full text.
  - [Extracting relative thresholds for source code metrics (CSMR-WCRE 2014)](https://api.openalex.org/works/doi:10.1109/CSMR-WCRE.2014.6747177) — Oliveira, Valente, Lima, 2014 — peer_reviewed — "it is also natural to have a number of entities in the 'long-tail' that do not follow the defined limits… a corpus with 106 systems." — Verified from the OpenAlex abstract.
  - [SIG Guidance for Producers v18.1](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability.pdf) — SIG, 2026 — industry_report — "The percentage in units with more than 60 lines should not exceed 9.1%." — Verified.
  - [SIG Guidance for Producers v17.0 (12 Mar 2025)](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — SIG, 2025 — industry_report — unit size caps 47.1 / 23.1 / 8.3%. — Verified; this shows the yearly recalibration.
- **Detect:** Compute per language from `lizard --csv` or native tool output:
  - the share of functions with the metric ≤ k;
  - the share of NLOC in units above each band.

  Compare with SIG v18.1 and label the comparison as an external benchmark.
- **Tools:** lizard, python/polars over CSV, sonarqube
- **Applies to:** System-level reporting, per language.
- **When not to apply / counterpoints:**
  - Oliveira's thresholds are class-level, cover Java and Pharo only, and were weakly validated against developer judgement (4/9).
  - SIG recalibrates its percentages every year (v17.0 → v18.1), so the comparison must name the version.
- **Fix risk:** low

### G208-F11 — Trigger on size OR complexity, but put functions that exceed both first. Use Sonar-spec cognitive complexity for "hard to understand" claims and CC for "needs at least N tests" claims. Do not use Clippy's `cognitive_complexity` for Rust, and do not use aggregate CC above function level
- **Grade:** B · **Verdict:** VERIFIED. Three notes added:
  - The NASA SATC passage also flags small, highly complex ("terse") modules as a reliability risk.
  - The lizard README says it measures how complex code "looks" rather than "is".
  - Clippy's own docs point to `excessive_nesting` and `too_many_lines` as replacements.
- **Rationale:** Each metric carries its own information:
  - CC and SLOC are only moderately correlated at method level (17.6M Java methods, 6.3M C functions).
  - Microsoft's documentation quotes NASA SATC: the most effective evaluation combines size and complexity.
  - A meta-analysis found cognitive complexity correlates with comprehension time and subjective understandability, with mixed results for correctness.
  - Sonar states that CC "is of little use above the method level".
  - Chowdhury et al. (EMSE 2022) show that "evaluation context is king", including method size.
- **Evidence:**
  - [Empirical analysis of the relationship between CC and SLOC… (JSEP)](https://api.openalex.org/works/doi:10.1002/smr.1760) — Landman, Serebrenik, Bouwers, Vinju, 2015 (journal issue 2016) — peer_reviewed — "Java (17.6 M methods) and C (6.3 M functions)… linear correlation between SLOC and CC is only moderate… not strong enough to conclude that CC is redundant with SLOC." — Verified from the full OpenAlex abstract.
  - [An Empirical Validation of Cognitive Complexity as a Measure of Source Code Understandability (ESEM 2020)](https://arxiv.org/abs/2007.12520) — Muñoz Barón, Wyrich, Wagner, 2020 — peer_reviewed — "about 24,000 understandability evaluations of 427 code snippets… Cognitive Complexity positively correlates with comprehension time and subjective ratings of understandability. The metric showed mixed results for the correlation with the correctness of comprehension tasks and with physiological measures." — Verified in the full text.
  - [Code metrics – Cyclomatic complexity (Visual Studio)](https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-cyclomatic-complexity) — Microsoft Learn, 2024 — official_docs — "The SATC has found the most effective evaluation is a combination of size and (Cyclomatic) complexity. The modules with both a high complexity and a large size tend to have the lowest reliability. Modules with low size and high complexity are also a reliability risk because they tend to be very terse code…" — Verified. The last sentence was added by the verifier.
  - [Revisiting the debate: Are code metrics useful for measuring maintenance effort? (EMSE 27(6), art. 158)](https://repository.tudelft.nl/record/uuid:2b646cf1-788e-4763-b4c7-1148ae664f99) — Chowdhury, Holmes, Zaidman, Kazman, 2022 — peer_reviewed — "∼730K Java methods originating from 47 popular open source projects… We also show that evaluation context is king." — Verified; full abstract read.
  - [Cognitive Complexity white paper v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — SonarSource, 2023 — official_docs — "In other words, Cyclomatic Complexity is of little use above the method level." — Verified.
  - [lizard README](https://raw.githubusercontent.com/terryyin/lizard/master/README.rst) — terryyin, 2026 — official_docs — "This tool actually calculates how complex the code 'looks' rather than how complex the code really 'is'." — Verified (caveat added by the verifier).
- **Detect:** Join tool outputs per function:
  - lizard for NLOC and CCN;
  - a Sonar-spec cognitive score from SonarQube, PMD CognitiveComplexity or gocognit.

  Tag each candidate with the metric(s) that fired, and list "both fired" first. Keep "high CC, small size" as its own secondary bucket; SATC calls this terse code.
- **Tools:** lizard, sonarqube, pmd, gocognit
- **Applies to:** All languages. For Rust, use lizard CCN plus Clippy `too_many_lines` and `excessive_nesting`, not `cognitive_complexity`.
- **When not to apply / counterpoints:** Yamashita et al. found that in industrial projects, files with very high size-based metrics were "two to five times more defect prone" than files with very high complexity-based metrics. Lavazza et al. (JSS 2023) on cognitive complexity could not be accessed, so its conclusion is not reported.
- **Fix risk:** low

### G208-F19 — On a finished, working project, a metric trigger alone never justifies a behaviour-changing edit
Before any complexity- or length-driven refactor, add characterization tests covering every branch; CC gives the size of a basis set of paths. Restrict the change to mechanical extract-function or guard-clause edits. On performance-critical paths, skip or defer it unless benchmarks show no regression.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Microsoft's official guidance says the risk of destabilising shipped code can outweigh the maintainability benefit.
  - Yamashita et al. warn that file-level redistribution can be counterproductive.
  - Replacing a switch with polymorphism can cost measurable performance: Muratori measured 1.5× in a microbenchmark.
  - NIST ties CC to the number of tests needed for basis-path testing.
- **Evidence:**
  - [CA1502](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Microsoft Learn, 2026 — official_docs — "The risk of destabilizing the code base late in the development cycle or introducing an unexpected change in runtime behavior in previously shipped code might outweigh the maintainability benefits of refactoring the code." — Verified.
  - ["Clean" Code, Horrible Performance](https://www.computerenhance.com/p/clean-code-horrible-performance) — Casey Muratori, 28 Feb 2023 — engineering_blog — "gave us an immediate 1.5x performance increase" (switch instead of virtual dispatch); table-driven versions reached about 10× and nearly 15×. — Verified.
  - [Yamashita et al. QRS 2016](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Yamashita_QRS2016.pdf) — 2016 — peer_reviewed — "we did not find support for approaches that would reduce the size of the largest files by moving that code into other smaller or less complex files. On the contrary, such approaches may increase the risk". — Verified verbatim.
  - [NIST SP 500-235](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — 1996 — standard — "Cyclomatic complexity gives the number of tests, which for a multiway decision statement is the number of decision branches." — Verified.
- **Detect:** For each refactor candidate, branch coverage of the function must reach 100% before editing, or the gap must be listed. Use coverage.py `--branch`, c8/istanbul, `go test -cover`, cargo-llvm-cov or JaCoCo. Mark hot paths from profiler output or benchmark files.
- **Tools:** coverage.py, c8/istanbul, `go test -cover`, cargo-llvm-cov, JaCoCo, benchmark harness
- **Applies to:** Any refactor triggered by F01, F15 or F16 on production code.
- **When not to apply / counterpoints:** Chowdhury et al. found method decomposition reduced maintenance indicators, so refactoring is not inherently harmful; this rule adds safety gates without forbidding it. The Muratori figures come from one author's C++ microbenchmark on a toy workload.
- **Fix risk:** high

### G208-F18 — Open every report with a threshold-policy block
The block contains:
- the policy id and version;
- per metric, the tool, tool version and variant;
- the threshold value and its SOURCE: project config at path X, skill default, or vendor default;
- its PROVENANCE class, one of:
  - standard-backed convention (NIST 1996);
  - vendor convention;
  - benchmark percentile, naming corpus and version (e.g. SIG v18.1 of 2026-03-31);
  - fault-calibrated on this repository;
- function counts per language, and whether relative ranking was enabled;
- exemptions applied, with counts: flat dispatch, suppressions, generated code;
- a statement that exceedances are review candidates, not defects.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Most of the conflicts disappear once provenance is visible, because the numbers come from different tools, variants, benchmarks and years. The metrics themselves move between versions:
  - SIG's 4-star percentages changed between v17.0 (2025) and v18.1 (2026).
  - ESLint changed what it counts in 2021 and in v9.0.0.
  - Clippy reclassified its lint in Rust 1.91.

  NIST's policy requires a written explanation for any exceedance.
- **Evidence:**
  - [SIG v18.1](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability.pdf) and [SIG v17.0](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — SIG, 2026 / 2025 — industry_report — v17.0 → v18.1:
    - unit size 47.1 / 23.1 / 8.3% → 48.0 / 24.2 / 9.1%;
    - McCabe >5: 20.2% → 20.7%; >10: 7.3% → 7.5%; >25: 1.1% in both;
    - parameters 15.0 / 3.3 / 0.9% → 15.4 / 3.4 / 0.9%.

    Verified in both extracted PDFs.
  - [ESLint v9.0.0 released](https://eslint.org/blog/2024/04/eslint-v9.0.0-released/) — ESLint, 2024 — official_docs — "The complexity rule now also takes into account optional chaining and default values…" — Verified.
  - [NIST SP 500-235](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — 1996 — standard — "For each module, either limit cyclomatic complexity to 10 (as discussed earlier, an organization can substitute a similar number), or provide a written explanation of why the limit was exceeded." — Verified verbatim.
- **Detect:** Run a checklist on the generated report. Fail it if any threshold lacks its tool, version, variant, source or provenance, or if "violation" or "must" is used for a skill-default exceedance.
- **Tools:** manual review, report template
- **Applies to:** Every report the skill produces.
- **When not to apply / counterpoints:** The block adds length. It can be collapsed into a table, but omitting it re-creates the contradiction.
- **Fix risk:** low

### G208-F13 — Language-specific notes for the triggers
- **Grade:** B for the TS/JS, Rust and Python notes. The Go err-check exemption is the researcher's own policy, graded D. · **Verdict:** CORRECTED. Two fixes:
  - ESLint counts logical assignment since 2021, not since v9.
  - The Go advice was wrong. Sonar-spec cognitive complexity and gocognit also add +1 per flat `if`, so they do **not** discount sequential `if err != nil` checks. The only difference is the higher trigger (15 vs 10).
- **Rule (corrected):**
  - **TS/JS:** ESLint's CC counts logical operators and logical assignment (since 2021), plus `?.` and default values (since v9.0.0). Sonar-spec cognitive complexity ignores null-coalescing and safe-navigation (`?.`). Before calling null-safe TS code "complex", use cognitive complexity or report both.
  - **Go:** each `if err != nil` adds 1 to gocyclo *and* to cognitive complexity. A function whose excess over CC 10 is made up solely of flat, sequential error checks may be downgraded to "review, low priority". This is a policy choice, not a sourced rule. Record the err-check count next to the CC.
  - **Rust:** use lizard CCN plus Clippy `too_many_lines`, `too_many_arguments` and `excessive_nesting`, not Clippy `cognitive_complexity`.
  - **Python:** Ruff C901 under-counts boolean logic and comprehensions compared with Radon, so name the tool used.
- **Rationale:** Language idioms move CC without changing understandability, and tools encode them differently.
  - ESLint maintainers justified counting `?.` because each access creates two branches, as coverage tools also count it.
  - Sonar ignores null-coalescing because it shorthands multiple lines into one.
  - Clippy's maintainers say their lint must not be used as a measurement tool.
- **Evidence:**
  - [ESLint issue #18060 comments](https://api.github.com/repos/eslint/eslint/issues/18060/comments) — ESLint (GitHub), 2024 — practitioner_forum — lo1tuma (16 Feb 2024): "Every access to an optional property via optional chaining creates two possible code branches." bmish (20 Feb 2024): "I'm used to test coverage tools counting them as separate branches." — Verified.
  - [Cognitive Complexity white paper v1.7](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) — SonarSource, 2023 — official_docs — "For that reason, Cognitive Complexity ignores null-coalescing operators." The worked example is `a?.myObj`. The basic rules say to "Increment (add one) for each break in the linear flow of the code", so every `if` gets +1. — Verified.
  - [Clippy lints source](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/functions/mod.rs) and [conf.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_config/src/conf.rs) — rust-lang/rust-clippy, 2026 — official_docs — `too_many_arguments`: group `complexity`, threshold 7; `too_many_lines`: group `pedantic`, threshold 100; `cognitive_complexity`: `restriction`, threshold 25. — Verified in source.
  - [gocognit README](https://github.com/uudashr/gocognit) — uudashr, 2026 — official_docs — A switch scores cognitive 1 against cyclomatic 4. In a flat if/else-if chain each branch adds +1. The usage example is `gocognit -over 25`; no recommended threshold is given. — Verified.
  - [ESLint PR #13979](https://api.github.com/search/issues?q=repo:eslint/eslint+complexity+logical+assignment+is:pr+is:merged) — ESLint, 2021 — official_docs — logical assignment counted from 2021-01-15. — Verified.
- **Detect:**
  - **TS/JS:** run ESLint `complexity` and a Sonar-spec cognitive tool. Flag divergences where CC exceeds the trigger but cognitive is ≤15.
  - **Go:** in a flagged function, run `rg -c 'if err != nil'` and compare the count with CC.
  - **Rust:** `lizard -l rust`.
  - **Python:** record `ruff --version` and whether Radon was used.
- **Tools:** eslint, sonarqube, gocyclo, gocognit, lizard, ruff, radon, ripgrep
- **Applies to:** TypeScript/JavaScript, Go, Rust, Python.
- **When not to apply / counterpoints:** Every branch, including `?.` and err checks, is real test burden, and NIST ties CC to basis-path tests. The downgrade applies only to "hard to understand" claims, not to test-completeness claims.
- **Fix risk:** low

### G208-F01 — Ship ONE layered default threshold policy, and never present a single number as "the limit"
**Layer 1: absolute per-function review triggers,** measured with the language's native tool:
- classic McCabe CC >10, high priority above 25;
- Sonar-spec cognitive complexity >15, only where a Sonar-spec implementation exists;
- logical SLOC >60. The Python/Ruby value of >45 is advisory only (see F12);
- ≥7 declared parameters, excluding `self`, `cls`, `this` and Go receivers.

**Layer 2: a per-language SIG-style profile.** Report the % of code volume in units above the SIG bands against SIG v18.1's 4-star caps. It is for reporting only, never pass/fail.

**Layer 3: a relative tail inside the repository,** used only to order work (F07, F08).

A Layer-1 hit is a review candidate. It must end in a behaviour-preserving refactor proposal or a one-line written justification. The project's own configured thresholds take precedence for enforcement (F14).
- **Grade:** C · **Verdict:** CORRECTED. Three changes:
  - **Clippy off-by-one.** `too-many-arguments-threshold = 7` fires only at ≥8 parameters; to trigger at ≥7, set it to 6. Clippy's default of 7 therefore does not coincide with SIG's ≥7 band.
  - **Overclaim removed.** "CC 10 is the only per-function limit in a government standard" is unverified. NIST SP 500-235 is a 1996 NIST special publication, i.e. guidance rather than a mandatory standard. It also says limits "as high as 15 have been used successfully".
  - **Primary source.** Holzmann's "about 60 lines" is now checked against the original IEEE Computer article, replacing Wikipedia.
- **Rationale:** Each number comes from the most defensible source available, and a trigger flags work rather than asserting a defect.
  - **CC 10** is NIST's recommended limit. NIST allows an organisation-chosen limit or a written explanation of any exceedance, which is exactly the "justify or refactor" outcome. CC 10 is also the default in Ruff C901, PMD, Checkstyle and cyclop.
  - **CC 25** is where SIG's highest band starts and is the CA1502 default.
  - **Cognitive 15** is the Sonar and PMD default, a convention with no published calibration.
  - **SLOC 60** is SIG's top band and golangci funlen's default. It matches Holzmann's "about 60 lines" for safety-critical C.
  - **Seven parameters** is SIG's top band.
  - **Layers 2 and 3** follow the benchmark and relative-threshold literature (F04, F05, F07).
- **Evidence:**
  - [NIST SP 500-235](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — Watson & McCabe / NIST, August 1996 — standard (NIST special publication) — "For each module, either limit cyclomatic complexity to 10 (as discussed earlier, an organization can substitute a similar number), or provide a written explanation of why the limit was exceeded." Also: "The original limit of 10 as proposed by McCabe has significant supporting evidence, but limits as high as 15 have been used successfully as well." — Verified verbatim.
  - [SIG/TÜV NORD CERT Guidance for Producers v18.1 (31 Mar 2026)](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability.pdf) — SIG, 2026 — industry_report — 4-star caps "for each programming language used":
    - LOC in units >15 ≤48.0%, >30 ≤24.2%, >60 ≤9.1%;
    - McCabe >5 ≤20.7%, >10 ≤7.5%, >25 ≤1.1%;
    - ≥3 parameters ≤15.4%, ≥5 ≤3.4%, ≥7 ≤0.9%.

    Verified. The document title reads "SIG/TÜV NORD CERT", not TÜViT.
  - [CA1502](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Microsoft Learn, 2026 — official_docs — "The rule reports a violation when the cyclomatic complexity of a method is more than 25." Default threshold 25; enabled by default in .NET 10: No. — Verified.
  - [CognitiveComplexityMethodCheck.java](https://raw.githubusercontent.com/SonarSource/sonar-java/master/java-checks/src/main/java/org/sonar/java/checks/CognitiveComplexityMethodCheck.java) — SonarSource, 2026 — official_docs — `DEFAULT_MAX = 15`. — Verified.
  - [The Power of 10: Rules for Developing Safety-Critical Code (IEEE Computer, June 2006; mirror copy)](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Gerard J. Holzmann, 2006 — peer_reviewed (magazine column) — Rule 4: "Typically, this means no more than about 60 lines of code per function." — Verified in the primary text via a university mirror. The canonical spinroot.com PDF returned 403. This replaces the Wikipedia citation.
  - [Clippy conf.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_config/src/conf.rs) — rust-lang/rust-clippy, 2026 — official_docs — `too_many_arguments_threshold`: "The maximum number of argument a function or method can have", default 7. — Verified. Hence "≥7" requires threshold 6.
- **Detect:**
  - **Cross-language:** `lizard --csv <src>` gives NLOC, CCN and PARAM per function. Filter on CCN>10, NLOC>60 (Python/Ruby: >45, advisory) and PARAM≥7.
  - **Ruff:** `ruff check --select C901,PLR0913 --config "lint.mccabe.max-complexity = 10"`.
  - **ESLint:** `complexity` max 10; `max-lines-per-function` max 60 with `skipBlankLines`/`skipComments` true; `max-params` 6 (fires at ≥7).
  - **Go:** `gocyclo -over 10 .` and `gocognit -over 15 .`.
  - **PMD:** CyclomaticComplexity, CognitiveComplexity, NcssCount, ExcessiveParameterList.
  - **clippy.toml:** `too-many-lines-threshold = 60` and **`too-many-arguments-threshold = 6`**.
  - **.NET:** CodeMetricsConfig.txt `CA1502: 10`.
- **Tools:** lizard, ruff, radon, eslint, clippy, gocyclo, gocognit, golangci-lint, pmd, checkstyle, sonarqube, .NET analyzers (CA1502)
- **Applies to:** All languages, at function or method level. Exclude generated, vendored and third-party code. Report test code separately.
- **When not to apply / counterpoints:**
  - Yamashita et al. say thresholds should be used "with caution if at all", and El Emam and Benlarbi found no threshold effect (F03).
  - NIST reports that limits up to 15 have been used successfully.
  - Practitioners pull in both directions. Fowler, Metz and TigerBeetle set far lower length limits; Clippy (100 lines) and lizard (CCN 15, length 1000) set far higher ones.
  - This particular combination has never been validated; it is a synthesis.
- **Fix risk:** medium

### G208-F06 — When the repository has usable defect history, check the triggers against it and report the result as local evidence. Without such data, label thresholds "distribution-based / convention, not fault-validated for this repository"
Usable defect history means bug-fix commits, or an issue tracker linked to commits. The check: are functions above each trigger over-represented among bug-touched functions?
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. Why:
  - Only Shatnawi 2010 was read at full-abstract level, and it covers a single system (Eclipse), class-level CK metrics.
  - Boucher & Badri 2018 and Lavazza & Morasca 2016 are supported only by Semantic Scholar's machine-generated TLDRs. The publishers elide their abstracts and the full texts returned 403.
  - None of the four studies tests function-level CC, SLOC or parameter thresholds.
  - The detection procedure is the researcher's own design.
- **Rationale:** Studies comparing derivation methods favour fault-based (ROC or logistic) thresholds over distribution-based ones. A finished project usually has git history, so a lightweight local check is possible. Its result is local evidence only.
- **Evidence:**
  - [A Quantitative Investigation of the Acceptable Risk Levels of OO Metrics (IEEE TSE)](https://api.openalex.org/works/doi:10.1109/TSE.2010.9) — Shatnawi, 2010 — peer_reviewed — "the selected threshold values were more accurate than those were selected based on either intuitive perspectives or on data distribution parameters." Validated on Eclipse 2.0 → 2.1. — Verified from the OpenAlex abstract.
  - [Software metrics thresholds calculation techniques to predict fault-proneness (IST 96:38-67)](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1016/j.infsof.2017.11.005?fields=title,year,abstract,openAccessPdf,tldr) — Boucher, Badri, 2018 (online 2017) — peer_reviewed — machine TLDR only: "The best of the three thresholds calculation techniques for fault-proneness prediction is ROC Curves, but Alves Rankings is a good choice too." — The TLDR exists as quoted. Crossref confirms volume 96, pp. 38–67. The abstract and full text were not accessible, so this is weak.
  - [An Empirical Evaluation of Distribution-based Thresholds for Internal Software Measures (PROMISE 2016)](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1145/2972958.2972965?fields=title,year,abstract,openAccessPdf,tldr) — Lavazza, Morasca, 2016 — peer_reviewed — machine TLDR only: "distribution-based thresholds appear to be unreliable… practitioners should instead use… the ones that take into account data about the presence of faults". — The TLDR exists; OpenAlex has only the Background part of the abstract. Weak.
  - [Calculation and optimization of thresholds for sets of software metrics (EMSE)](https://api.openalex.org/works/doi:10.1007/s10664-011-9162-z) — Herbold, Grabowski, Waack, 2011 — peer_reviewed — "The methodology is independent of the metric set and therefore also independent of any language, paradigm or abstraction level"; case studies on C functions, C++ and C# methods, and Java classes. — Verified from the OpenAlex abstract.
- **Detect:**
  1. Find candidate bug-fix commits: `git log --format=%H%x09%s | rg -i '\b(fix|bug|defect|regression)\b'`.
  2. Map the changed hunks to functions using lizard line ranges and `git show --unified=0 <sha>`.
  3. Compare the bug-touched rate above versus below each trigger. Report the counts and a Fisher exact test.
- **Tools:** git, lizard, python/polars, scipy (`fisher_exact`)
- **Applies to:** Repositories with at least several dozen bug-fix commits. Skip for new or squashed histories.
- **When not to apply / counterpoints:**
  - Keyword-based bug linking is noisy. Chowdhury et al. write that "Capturing bug related keywords from the commit messages for measuring bug-proneness is only 80% accurate". (Verified in the MSR 2022 full text.)
  - Small repositories give underpowered tests.
  - Results are local and must not override the default triggers.
- **Fix risk:** low

### G208-F07 — Use repository-relative ranking only to ORDER review candidates. Never let a percentile alone create a finding
Rank only functions already above an absolute floor (CC >10, Sonar-spec cognitive >15, or SLOC >30) by metric × recent churn, and list the top min(10, 5% of functions) per language.
- **Grade:** C (was B) · **Verdict:** DOWNGRADED, plus a quote fix. Why:
  - The evidence is about defect prediction and vendor hotspot practice, not about choosing refactoring candidates.
  - The scoring formula and the top-min(10, 5%) cut are the researcher's own.
  - Code Red is by CodeScene-affiliated authors using CodeScene's proprietary Code Health metric.
  - Koru's result points the *other* way for effort-aware inspection: prioritise smaller modules. A formula that multiplies by NLOC favours larger ones.
  - The Koru quote was missing "more than" and the "in Mozilla and Eclipse" scope.
- **Rationale:**
  - Within-project ranking by size is a strong, cheap defect-prediction baseline (Zhou et al.).
  - Hotspot practice concentrates refactoring where churn and poor health meet.
  - A fixed absolute floor stops the relative method from flagging trivially simple code.
- **Evidence:**
  - [How Far We Have Progressed in the Journey? (TOSEM)](https://api.openalex.org/works/doi:10.1145/3183339) — Zhou et al., 2018 — peer_reviewed — "ManualDown considers a larger module as more defect-prone, while ManualUp considers a smaller module as more defect-prone… The simple module size models have a prediction performance comparable or even superior to most of the existing CPDP models in the literature". — Verified from the full OpenAlex abstract.
  - [An Investigation into the Functional Form of the Size-Defect Relationship](https://api.openalex.org/works/doi:10.1109/TSE.2008.90) — Koru et al., 2009 — peer_reviewed — "For example, in Mozilla and Eclipse, an inspection strategy investing 80% of available resources on 100-LOC classes and the rest on 1,000-LOC classes would be more than twice as cost effective as the opposite strategy." — Verified; quote corrected.
  - [Hotspots (CodeScene docs)](https://codescene.io/docs/guides/technical/hotspots.html) — CodeScene, 2026 — engineering_blog (vendor) — hotspots are "files with high change frequency and low Code Health"; "the prioritized hotspots only make up 1.2% of the total codebase, yet we spend 12.5% of our development efforts in those hotspots, and 45% of all bugs…" — Verified. This is a single vendor example.
  - [Code Red: The Business Impact of Code Quality (TechDebt 2022)](https://arxiv.org/abs/2203.04374) — Tornhill (CodeScene), Borg, 2022 — peer_reviewed — 39 proprietary codebases, 30,737 files: "low quality code contains 15 times more defects than high quality code… resolving issues in low quality code takes on average 124% more time". — Verified in the full text. Indirect: it concerns code health, not threshold choice.
- **Detect:**
  - Churn per file: `git log --since=12.months --format= --name-only | sort | uniq -c | sort -rn`.
  - Churn per function, for the shortlist only: `git log -L :<func>:<file>`.
  - Score = normalised(CC or cognitive) × normalised(NLOC) × (1 + churn). This formula is unvalidated. Keep only functions above the floor.
- **Tools:** git, lizard, ripgrep, python/polars
- **Applies to:** Prioritising work in any repository with git history. Without history, rank by metric only.
- **When not to apply / counterpoints:**
  - No study compares a relative tail against a fixed limit for choosing refactoring candidates.
  - Churn favours recently active code, and a finished, frozen project may show little churn.
  - For defect-hunting (as opposed to refactoring), Koru suggests weighting small modules.
- **Fix risk:** low

### G208-F14 — Precedence of thresholds
1. **Project configuration is the enforcement line.** Report exceedances of thresholds in ESLint config, pyproject/ruff.toml, .pylintrc, clippy.toml, .golangci.yml, the Sonar quality profile, PMD or Checkstyle rulesets, or CodeMetricsConfig.txt as findings.
2. **Skill defaults are advisory** where they are stricter than the project's configuration.
3. **Inline suppressions are recorded exceptions.** List them and do not "fix" them. Flag one only if the suppressed function also has high churn or bug history.
4. **No project configuration:** skill defaults apply and are labelled as such.
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - NIST lets an organisation substitute its own number, provided exceedances are explained.
  - Microsoft says suppression is appropriate when the method is easy to understand, test and maintain.
  - Fontana et al. warn that thresholds suggested "in literature (or by the tool vendors)" may not suit the context of analysis.
- **Evidence:**
  - [NIST SP 500-235](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication500-235.pdf) — 1996 — standard — "an organization can pick a complexity limit greater than 10, but only if it is sure it knows what it is doing and is willing to devote the additional testing effort required by more complex modules." — Verified verbatim.
  - [CA1502](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Microsoft Learn, 2026 — official_docs — "It is safe to suppress a warning from this rule if the complexity cannot easily be reduced and the method is easy to understand, test, and maintain." — Verified.
  - [Automatic Metric Thresholds Derivation for Code Smell Detection (WETSoM 2015)](https://api.openalex.org/works/doi:10.1109/WETSoM.2015.14) — Arcelli Fontana, Ferme, Zanoni, Yamashita, 2015 — peer_reviewed — "without a clear methodology for deriving thresholds, one is left with those suggested in literature (or by the tool vendors), which may not necessarily be suitable to the context of analysis." — Verified from the OpenAlex abstract.
  - [Sandi Metz' Rules For Developers](https://thoughtbot.com/blog/sandi-metz-rules-for-developers) — Caleb Hearth / thoughtbot, 2013 (updated 2025) — engineering_blog — "You should break these rules only if you have a good reason or your pair lets you." — Verified.
- **Detect:**
  - Find configs: `rg --files --hidden` with globs for `eslint.config.*`, `.eslintrc*`, `ruff.toml`, `pyproject.toml`, `setup.cfg`, `.pylintrc`, `clippy.toml`, `.golangci.y*ml`, `sonar-project.properties`, `CodeMetricsConfig.txt`, `*checkstyle*.xml` and `*pmd*.xml`.
  - Find suppressions: `eslint-disable…(complexity|max-lines-per-function|max-params|max-statements)`, `noqa: C901|PLR09`, `allow(clippy::too_many_arguments|too_many_lines|cognitive_complexity)`, `nolint: gocyclo|gocognit|cyclop|funlen`, `@SuppressWarnings("PMD.…")` and `#pragma warning disable CA1502`.
- **Tools:** ripgrep, `eslint --print-config`, `ruff check --show-settings`, golangci-lint, sonarqube
- **Applies to:** Every repository and all languages.
- **When not to apply / counterpoints:** Project configurations can be stale or set lax just to silence CI (e.g. CC 50). This is why skill defaults stay visible as advisory, and why suppressed functions with high churn are still surfaced.
- **Fix risk:** low

### G208-F15 — Parameter count: trigger at 7 or more declared parameters, and never change a public or exported signature as a "hardening" refactor
- **Counting:** exclude `self`, `cls`, `this` and receivers, and count a destructured options object or dataclass as 1.
- **The 5–6 band:** report it only when at least two adjacent parameters share a type, or when there are boolean flag parameters.
- **Public signatures:** propose any change as a follow-up with a deprecation path.
- **Grade:** C · **Verdict:** CORRECTED. Three fixes:
  - **Clippy off-by-one.** Clippy's default threshold of 7 is the maximum *allowed*, so it fires at ≥8. It is therefore not "aligned" with SIG's ≥7 band; use threshold 6 to trigger at ≥7.
  - **`fn_params_excessive_bools` is a `pedantic` lint,** so it is off by default.
  - **The SIG "same type / wrong order" sentence** is also present in v18.1, not only in v17.
- **Rationale:** Parameter defaults are the most scattered, and no fault-based evidence for them was found:
  - ESLint 3, Metz 4, Ruff/Pylint 5, Clippy >7, PMD ≥10;
  - SIG bands ≥3/≥5/≥7, with 0.9% of code allowed at ≥7.

  SIG's rationale is concrete: same-typed parameters can be passed in the wrong order. The same-type condition targets that failure.
- **Evidence:**
  - [SIG Guidance for Producers v18.1](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability.pdf) — SIG, 2026 — industry_report — "Large interfaces are also error prone, especially if multiple parameters have the same type and can thus be accidentally supplied in the wrong order." ≥3 ≤15.4%, ≥5 ≤3.4%, ≥7 ≤0.9%. — Verified.
  - [Clippy conf.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_config/src/conf.rs) and [excessive_bools.rs](https://raw.githubusercontent.com/rust-lang/rust-clippy/master/clippy_lints/src/excessive_bools.rs) — rust-lang/rust-clippy, 2026 — official_docs — `too_many_arguments_threshold` default 7 ("maximum number of argument a function or method can have"); `max_fn_params_bools` default 3; `FN_PARAMS_EXCESSIVE_BOOLS` is in group `pedantic`. — Verified.
  - [ESLint max-params](https://eslint.org/docs/latest/rules/max-params) — ESLint, 2026 — official_docs — default 3; "requires the memorization of what each parameter is, its type, and the order they should appear in." — Verified.
  - [Sandi Metz' Rules For Developers](https://thoughtbot.com/blog/sandi-metz-rules-for-developers) — thoughtbot, 2013 — engineering_blog — "Pass no more than four parameters into a method. Hash options are parameters." They used rule zero for helpers such as `link_to` and `form_for`. — Verified.
  - [PMD ExcessiveParameterList](https://pmd.github.io/pmd/pmd_rules_java_design.html) — PMD, 2026 — official_docs — `minimum` 10, "Threshold at or above which a node is reported". — Verified.
- **Detect:**
  - lizard: `lizard --csv`, PARAM ≥7.
  - Ruff: `ruff check --select PLR0913,PLR0917`.
  - Clippy: `too-many-arguments-threshold = 6` in clippy.toml, then `cargo clippy -- -W clippy::fn_params_excessive_bools`.
  - ESLint: `max-params` 6.
  - Same-type check: parse signatures with ast-grep for ≥2 adjacent parameters with identical type annotations.
- **Tools:** lizard, ruff, clippy, eslint, ast-grep, pmd
- **Applies to:** Internal functions, which may be refactored. Exported or public APIs are report-only.
- **When not to apply / counterpoints:** Framework-mandated signatures (callbacks, handlers, ORM hooks) and data constructors legitimately take many arguments. Keyword-only or named arguments carry far less order risk than positional ones.
- **Fix risk:** high

### G208-F16 — Function length: trigger at logical SLOC >60 and report 30–60 only in the profile. When splitting, extract only named, self-contained steps
The steps must not become "entangled": you should not need to read the helper to understand the caller. Keep branching in the parent and move non-branching work into leaves. If no such split exists, write the justification instead.
- **Grade:** C (was B) · **Verdict:** DOWNGRADED. Why:
  - The 60 trigger rests on practitioner consensus and SIG's benchmark band, not on outcome data.
  - The one empirical method-level study (Chowdhury, Java) puts the meaningful change-proneness boundary at 24 SLOC. Beyond "medium" (37+), the effects are mostly negligible or small.
  - Martin disputes that Clean Code sets numeric limits.
- **Rationale:** Practitioner and standard guidance clusters around "one screen":
  - Holzmann: about 60 (safety-critical C);
  - TigerBeetle: a hard 70;
  - Google C++: "about 40, think";
  - Linux kernel: one or two 80×24 screenfuls;
  - golangci funlen 60; ESLint 50.

  Over-decomposition has a cost that Martin concedes and Ousterhout stresses.
- **Evidence:**
  - [TIGER_STYLE.md](https://raw.githubusercontent.com/tigerbeetle/tigerbeetle/main/docs/TIGER_STYLE.md) — TigerBeetle, 2026 — engineering_blog — "we enforce a **hard limit of 70 lines per function**"; "There's a sharp discontinuity between a function fitting on a screen, and having to scroll"; "try to keep all switch/if statements in the 'parent' function, and move non-branchy logic fragments to helper functions." — Verified.
  - [Google C++ Style Guide: Write Short Functions](https://google.github.io/styleguide/cppguide.html) — Google, 2026 — official_docs — "no hard limit is placed on functions length. If a function exceeds about 40 lines, think about whether it can be broken up without harming the structure of the program." — Verified.
  - [Linux kernel coding style](https://www.kernel.org/doc/html/latest/process/coding-style.html) — Linux kernel docs, 2026 — official_docs — "They should fit on one or two screenfuls of text (the ISO/ANSI screen size is 80x24…)"; "The maximum length of a function is inversely proportional to the complexity and indentation level of that function." — Verified.
  - [aposd-vs-clean-code](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout & Martin, Sep 2024–Feb 2025 — practitioner_forum — Ousterhout: "Two methods are entangled (or 'conjoined' in APOSD terminology) if, in order to understand how one of them works internally, you also need to read the code of the other." Martin: "It is certainly possible to over-decompose code." Martin also says it is not "fair to say that the book sets arbitrary numerical limits". — Verified.
  - [The Power of 10 (IEEE Computer, 2006)](https://web.eecs.umich.edu/~imarkov/10rules.pdf) — Holzmann, 2006 — peer_reviewed (magazine) — "no more than about 60 lines of code per function." — Verified via mirror.
  - [An Empirical Study on Maintainable Method Size in Java](https://arxiv.org/pdf/2205.01842) — Chowdhury, Uddin, Holmes, 2022 — peer_reviewed — Table 3: Small ≤24, Medium 25–36, Large 37–63, Very Large ≥64. Medium→Large and Large→Very Large effects are mostly negligible or small. — Verified.
- **Detect:**
  - lizard: `lizard -L 60 -w` (NLOC).
  - ESLint: `max-lines-per-function` max 60 with `skipBlankLines`/`skipComments` true.
  - golangci funlen: `lines: 60`.
  - Clippy: `too-many-lines-threshold = 60`.
  - Ruff: PLR0915 (statements) as a proxy.
  - PMD: NcssCount.
- **Tools:** lizard, eslint, golangci-lint (funlen), clippy, ruff, pmd (NcssCount)
- **Applies to:** All languages, at function level.
- **When not to apply / counterpoints:**
  - Fowler: "Any function more than half-a-dozen lines of code starts to smell to me". Metz sets a 5-line limit. Both are far stricter.
  - Clippy's pedantic default is 100 and lizard's is 1000.
  - Holzmann's rule targets safety-critical C.
  - Carmack-style arguments for long inlined code were not fetched.
- **Fix risk:** medium

### G208-F17 — In AI-generated or AI-heavy repositories, do not rely on relative percentiles for complexity, because the "worst decile" may be trivial
Keep the absolute triggers. Give dead, unused or redundant code, and design/framework-practice smells, at least as much review budget as function complexity.
- **Grade:** C · **Verdict:** CORRECTED. "Dead/unused/redundant code dominates LLM smells" was overstated. It is the largest smell category for 3 of 5 models (GPT-4o, Llama 3.2 90B, OpenCoder-8B). For the two Claude models, "Design / Framework best-practices" is larger: 22.26% vs 14.83%, and 18.58% vs 17.43%.
- **Rationale:** One vendor study ran SonarQube on 4,442 Java tasks per model.
  - **Size:** mean function size was small, about 8.0 LOC/function for Claude Sonnet 4, 8.6 for GPT-4o and 14.4 for OpenCoder-8B (computed from Table 1 totals, which include class-level lines).
  - **Complexity:** mean CC was about 1.7–2.3 per function (computed).
  - **Smell mix:** complexity smells were only 2.7–8.4% of each model's smells; dead/unused/redundant code was 14.8–42.7%.
  - **Volume:** total volume varied by 3.1× between models for the same tasks.

  A percentile rule would still flag the top decile of such code, so the absolute floor from F07 is essential.
- **Evidence:**
  - [Assessing the Quality and Security of AI-Generated Code: A Quantitative Analysis](https://arxiv.org/pdf/2508.14727) — Sabra, Schmitt, Tyler (Sonar), Aug 2025 — preprint — Table 1:
    - Claude Sonnet 4: 370,816 LOC, 46,235 functions, CC 81,667, cognitive 47,649;
    - GPT-4o: 209,994 LOC, 24,309 functions, CC 44,387;
    - OpenCoder-8B: 120,288 LOC, 8,338 functions.

    Table 9, "Cognitive / Computational complexity": 4.25 / 8.43 / 3.73 / 2.67 / 2.79%. "Dead / Unused / Redundant code": 14.83 / 17.43 / 26.3 / 34.82 / 42.74%. "Design / Framework best-practices": 22.26 / 18.58 / 20.81 / 18.84 / 12.45%. — Verified in the full text; the ratios were recomputed.
- **Detect:** Check `git log` trailers or commit metadata for AI co-author markers, or ask the user. Inspect the function-metric distribution. If median CC ≤2 and p90 CC ≤5, suppress relative-tail reporting for complexity. This cut-off is the researcher's own heuristic.
- **Tools:** git, lizard, sonarqube
- **Applies to:** Repositories written largely by coding agents.
- **When not to apply / counterpoints:**
  - This is a single study, by a static-analysis vendor, on small benchmark assignments rather than whole repositories.
  - The authors' "local token probability" explanation is a hypothesis.
  - No study links complexity thresholds to defects in agent-written repositories.
- **Fix risk:** low

### G208-F08 — Enable percentile or "worst-tail" language only when a language slice has at least 200 functions (excluding tests and generated code)
Below that, report the Layer-1 absolute triggers only, list at most the 5 worst functions above the floor, and state that relative ranking was disabled because the repository is small.
- **Grade:** D · **Verdict:** VERIFIED. The sources are quoted accurately, and the finding correctly labels 200 as an unvalidated convention.
- **Rationale:** No source validates a per-repository minimum. Every relative-threshold and benchmark method examined derives thresholds from corpora of 49 to 1,000+ systems.
  - **Yamashita's 200** is a cut-off in FILES per project, used to exclude toy projects from a corpus. It is not a function count.
  - **The arithmetic:** with n functions, a 5% tail is n/20 items. At n=200 that tail equals the top-10 list; below that, one or two functions set the percentile.
- **Evidence:**
  - [Yamashita et al. QRS 2016](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Yamashita_QRS2016.pdf) — 2016 — peer_reviewed — "We only included those Java projects that had 200 or more files in our case study to exclude very small projects… a much higher percent of projects in the forges with fewer than 200 files appear to be not real software development projects." — Verified verbatim.
  - [Chowdhury et al. MSR 2022](https://arxiv.org/pdf/2205.01842) — 2022 — peer_reviewed — "Many of our projects, however, do not have enough methods in each size category to make a reliable comparison. Therefore, we also consider only the top 20 projects". For #revisions, significant differences rose from 82.98% to 96.67% of comparisons. — Verified verbatim.
- **Detect:** Count functions per language from `lizard --csv`, excluding `test/`, `__tests__/`, `*_test.go`, `generated/` and `vendor/`. If the count is under 200, disable Layer 3.
- **Tools:** lizard
- **Applies to:** Small libraries, CLIs, hackathon projects and single-service repositories.
- **When not to apply / counterpoints:** Small repositories may still benefit from "look at the worst few functions". The capped top-5 list above the absolute floor preserves that.
- **Fix risk:** low

### G208-F12 — Keep complexity triggers and SIG profile bands uniform across languages, report them per language, and never pool languages into one percentile. A lower line trigger for Python/Ruby (e.g. 45 instead of 60) is optional advisory only
- **Grade:** D (was C) · **Verdict:** DOWNGRADED. The rule is restated so the well-supported part leads: report per language and never pool. Why the number is downgraded:
  - **Direction:** consistent. Python and Ruby are more concise per unit of work.
  - **Magnitude:** unsupported at function level. SIG's table converts system LOC into effort ("rebuild value"), and Rosetta Code compares whole task solutions; neither measures function length.
  - **The 0.75 factor (60 → 45)** is the researcher's own interpolation between sources that disagree by about 2×.
  - **SIG applies the same bands to every language.**
- **Rationale:**
  - SIG v17's volume table puts Python at 25,000 LOC per 3.9 person-years against Java's 35,100 (ratio 0.71) and TypeScript at 31,600 (0.90).
  - Nanz & Furia found shortest Python solutions about 2.8× shorter than Java (ratio ~0.36), with Go ≈ Java.
  - Zhang et al. found programming language affects the distribution of 35 of 39 maintainability metrics, which supports reporting per language.
  - SATT shows that architectural roles (MVC, Android) can need their own thresholds.
- **Evidence:**
  - [SIG/TÜV NORD CERT Guidance for Producers v17.0 (12 Mar 2025)](https://www.softwareimprovementgroup.com/wp-content/uploads/SIG-TUViT-Evaluation-Criteria-Trusted-Product-Maintainability-Guidance-for-producers.pdf) — SIG, 2025 — industry_report — "Lines of code in 3.9 person years": C++ 32,000; C# 39,000; Java 35,100; JavaScript 36,300; Python 25,000; Ruby 24,600; TypeScript 31,600. The table serves the system *volume* (rebuild value) property. — Verified. v18.1 no longer contains this table (grep confirmed).
  - [A Comparative Study of Programming Languages in Rosetta Code (ICSE 2015)](https://arxiv.org/pdf/1409.0252) — Nanz, Furia, 2015 — peer_reviewed — "Functional and scripting languages provide significantly more concise code than procedural and object-oriented languages". Table 5 (LOC by minimum): R Python vs Java 2.8, Python vs Go 3.0, Java vs Go 1.0. "Java programs are on average 2.2–2.9 times longer than programs in functional and scripting languages." — Verified in the full text; 7,087 solutions to 745 tasks.
  - [How Does Context Affect the Distribution of Software Maintainability Metrics? (ICSM 2013)](https://api.openalex.org/works/doi:10.1109/ICSM.2013.46) — Zhang, Mockus, Zou, Khomh, Hassan, 2013 — peer_reviewed — "320 nontrivial software systems from Source Forge… all six context factors affect the distribution of 20 metrics and the programming language factor affects 35 metrics." — Verified from the full OpenAlex abstract.
  - [SATT (SCAM 2016)](https://api.openalex.org/works/doi:10.1109/SCAM.2016.19) — Aniche, Treude, Zaidman, van Deursen, Gerosa, 2016 — peer_reviewed — "current tools and techniques do not take the system architecture (e.g., MVC, Android) into account… SATT can overcome issues that traditional approaches have, especially when some architectural role presents very different metric values than others." — Verified (class-level, more than 400 projects).
  - [Oliveira PhD thesis](https://repositorio.ufmg.br/bitstream/1843/ESBF-AAFJ7Z/1/palomamaira.pdf) — 2015 — thesis — "the impact on RT of context changes is limited". On Ferreira et al.: "thresholds by application domain, size, and system type… They did not find relevant differences among them." — Verified (counter-evidence).
- **Detect:** Group `lizard --csv` rows by file extension. Count logical lines only: lizard NLOC, or ESLint `max-lines-per-function` with `skipBlankLines`/`skipComments` true.
- **Tools:** lizard, eslint, ruff (PLR0915), clippy `too_many_lines`
- **Applies to:** Multi-language repositories.
- **When not to apply / counterpoints:** SIG applies identical unit bands to every language. Oliveira found context effects on relative thresholds "limited". No function-level study quantifies how comprehensions, closures or match arms compress Python, Rust or Kotlin.
- **Fix risk:** low

## Practitioner voice

- [ESLint issue #4808](https://github.com/eslint/eslint/issues/4808) — How ESLint's default of 20 was chosen (2015). The author could not name a number, and a maintainer guessed ~4. The author proposed 20 after noting ESLint's own maximum was 36, with only 6 functions above 20. A contributor framed 20 as an "only stop me if I'm approaching insanity" default. Later it was noted that `eslint:recommended` listed 11 with the rule switched off.
- [golangci-lint linters configuration](https://golangci-lint.run/docs/linters/configuration/) — gocyclo/gocognit ship with min-complexity 30, and the same line says "(but we recommend 10-20)". The shipped default limits noise; it is not a quality recommendation.
- [Clippy PR #15094](https://github.com/rust-lang/rust-clippy/pull/15094) — A 2025 PR proposed deprecating `cognitive_complexity`. A commenter said, after reading its source, that it is a "name squatter" that does not follow the Sonar spec. The PR was closed in favour of #15415, which moved the lint to `restriction` (Rust 1.91). Its docs now read "We used to think it measured how hard a method is to understand."
- [aposd-vs-clean-code](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout vs Martin (Sep 2024–Feb 2025). Both accept that over-decomposition exists. Martin says Clean Code does not set "arbitrary numerical limits"; its 2–4-line examples came from a TDD exercise. Ousterhout warns about shallow, "entangled" methods and rejects numeric thresholds.
- [Fowler — FunctionLength](https://martinfowler.com/bliki/FunctionLength.html) — Fowler (30 Nov 2016): extract when you have to study code to see what it does. "Any function more than half-a-dozen lines of code starts to smell to me." About 45% of the methods in his ~15 KLOC Ruby toolchain are 2 lines or fewer. His criterion is intention vs implementation, not line count.
- [TigerBeetle TIGER_STYLE](https://raw.githubusercontent.com/tigerbeetle/tigerbeetle/main/docs/TIGER_STYLE.md) — A hard 70-line limit per function, justified by the screen/scroll discontinuity. When splitting, keep the branching in the parent and push non-branchy work into leaves.
- [thoughtbot — Sandi Metz' Rules](https://thoughtbot.com/blog/sandi-metz-rules-for-developers) — The team adopted 5-line methods and 4 parameters and found the 5-line rule the most interesting and beneficial. They invoked "rule zero" for Rails helpers such as `link_to` and `form_for`.
- [Linux kernel coding style](https://www.kernel.org/doc/html/latest/process/coding-style.html) — Functions of one or two 80×24 screenfuls, with maximum length "inversely proportional to the complexity and indentation level". Local variables "shouldn't exceed 5-10". A long but simple case statement is explicitly allowed.
- [Checkstyle CyclomaticComplexity](https://checkstyle.org/checks/metrics/cyclomaticcomplexity.html) — The docs soften the default of 10: "Do not be ashamed to have complexity level 15 or even higher, but keep it below 20 to catch really bad-designed code automatically."
- [ESLint issue #18060 comments](https://api.github.com/repos/eslint/eslint/issues/18060/comments) — Maintainers agreed in February 2024 to count optional chaining and default values because coverage tools count them as branches. The change shipped in the v9.0.0 major release and is noted in its release notes. The thread does not discuss how existing thresholds would be affected.
- [Muratori — "Clean" Code, Horrible Performance](https://www.computerenhance.com/p/clean-code-horrible-performance) — In a C++ microbenchmark (2023), a switch beat polymorphism by 1.5×, and table-driven code was about 10–15× faster. A reminder that complexity refactors can have a runtime cost.
- [CodeScene — Hotspots](https://codescene.io/docs/guides/technical/hotspots.html) — Prioritise files with high change frequency and low code health rather than all complex code. The vendor's example: 1.2% of the code took 12.5% of effort and held 45% of bugs.
- [Microsoft — CA1502](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1502) — Default 25, not enabled by default in .NET 10. Suppression is advised for easy-to-understand methods and large switches, with a warning that refactoring shipped code late can destabilise it.
- [Google C++ Style Guide](https://google.github.io/styleguide/cppguide.html) — No hard limit on function length. At about 40 lines, "think about whether it can be broken up without harming the structure of the program".

## Contradictions and open questions

**Contradictions**
- **Fixed defaults for the same metric disagree by a factor of 3 or more.**
  - Cyclomatic: 10 (NIST, Ruff, PMD, Checkstyle, cyclop), 15 (lizard), 20 (ESLint), 25 (CA1502, SIG top band), 30 (golangci).
  - Cognitive: 15 (Sonar, PMD), 25 (Clippy, restriction only), 30 (golangci).
  - Length: 24 (Chowdhury, Java 70% quantile), 40 (Google), 50 (ESLint), 60 (SIG top band, Holzmann, funlen), 70 (TigerBeetle), 100 (Clippy), 1000 (lizard). Fowler and Metz go down to 5–6 lines.
  - Parameters: 3 (ESLint), 4 (Metz), 5 (Ruff/Pylint), >7 (Clippy), ≥7 (SIG top band), ≥10 (PMD).
- **Is there a threshold effect at all?**
  - Benlarbi et al. (2000) and El Emam et al. (2002) found no threshold effect for CK metrics or class size.
  - Shatnawi (2010), using logistic regression on Eclipse, reports that "the CK metrics have threshold effects at various risk levels".
- **Do small classes carry disproportionate risk?**
  - El Emam et al. (2002) attribute earlier claims that small components have greater defect content to a "mathematical artifact".
  - Koru et al. (2009), with El Emam as co-author, find defect-proneness grows logarithmically with size, so smaller classes are "proportionally more problematic".
  - Both reject step thresholds, but they point in different directions for effort-aware prioritisation.
- **Method-level vs file/class-level evidence on decomposition.**
  - Chowdhury et al. (MSR 2022) find methods ≤24 SLOC less change-prone and decomposition beneficial.
  - Yamashita et al. (QRS 2016) find the highest-risk files have lower defect density and warn that redistribution may be counterproductive.
- **Size vs complexity as a signal.**
  - Yamashita et al. found size-based high-risk files 2–5× more defect-prone than complexity-based ones in industrial projects.
  - Landman et al. found CC not redundant with SLOC at method level, and Muñoz Barón et al. found cognitive complexity correlates with understandability.
  - NASA SATC (quoted by Microsoft) flags both "large and complex" and "small and highly complex (terse)" modules.
  - The outcome variables differ (defects vs comprehension), so the skill must not merge them.
- **How much does context matter?**
  - Zhang et al. (2013) find language affects 35 of 39 metric distributions, and SATT (2016) finds architectural roles need their own thresholds.
  - Oliveira (2015) finds context effects on relative thresholds "limited", Ferreira et al. (via Oliveira) find no relevant domain or size differences, and SIG applies identical bands to every language.
- **Per-language line density.** SIG v17's industry averages imply Python ≈ 0.71× Java. Nanz & Furia's Rosetta Code minima imply Python ≈ 0.36× Java, with Go ≈ Java. They agree on direction but differ by about 2×.
- **Which derivation method?**
  - Shatnawi (2010), plus Boucher & Badri (2018) and Lavazza & Morasca (2016) via machine TLDRs only, favour fault-based thresholds.
  - Oliveira (2015) reports that relative thresholds and SIG's benchmark method "convey similar information", and SIG certifies with distribution-derived bands.
- **Multiway decisions.**
  - NIST (1996) exempts single-switch modules but calls "modified" complexity measures "not recommended". Its 90 → 10 example is a divide-by-branches variant.
  - ESLint (2024), lizard `-m` and Checkstyle offer switch-as-one variants, and Sonar cognitive complexity counts a switch as +1.
- **What counts as a branch in modern syntax.**
  - ESLint counts `?.` and default values (since v9) and logical assignment (since 2021), on the grounds that coverage tools count them.
  - Sonar cognitive complexity deliberately ignores null-coalescing and safe navigation.
  - Ruff C901 ignores `and`/`or` and comprehensions, while Radon counts them.
- **Irony in the provenance.** ESLint's "absolute" default of 20 was itself chosen partly from ESLint's own distribution (maximum 36, six functions above 20), i.e. by a per-repository relative method.

**Open questions**
- **Minimum repository size.** No study validates a minimum size for within-repository percentile ranking. The 200-function cut-off is a convention and needs testing, for example the bootstrap stability of the top-10 list as repository size varies.
- **Rust, TypeScript and Go.** No function-level threshold study (benchmark, relative or fault-based) was found for these languages. Any per-language length factor rests on system-level productivity averages and task-level Rosetta Code data.
- **Idioms.** How comprehensions, closures and match arms shift length or complexity distributions has not been quantified.
- **Unread full texts.** Several sources were read only as abstracts or machine TLDRs, because full texts returned 403 or sit behind paywalls: Alves et al. 2010, Boucher & Badri 2018, Lavazza & Morasca 2016, Benlarbi 2000, El Emam 2002, Koru 2009, Zhang 2013, Landman 2015. Lavazza et al. (JSS 2023) on cognitive complexity could not be located.
- **Sonar's 15.** The origin of S3776's default of 15 is undocumented, and no calibration study was found.
- **Parameters.** No fault-based evidence was found for parameter-count thresholds.
- **AI-generated code.** Only one vendor study, on small Java assignments, was found.
- **Relative ranking vs fixed limits.** Whether a relative tail beats fixed limits at picking refactoring candidates that developers accept is untested. The existing evidence (Zhou 2018, Koru 2009) is about defect prediction.
- **Practitioner forums.** Hacker News, Reddit and Stack Exchange were not reachable in research or verification; the web-search budget was exhausted. Practitioner voice comes from GitHub threads, style guides and engineering blogs.

## Dropped findings

None. All 19 findings have real, reachable sources that support at least a corrected or downgraded version of the claim. No practitioner-voice URL was dropped. Three gists were adjusted: ESLint #4808, Clippy #15094 and aposd-vs-clean-code. The ESLint #18060 gist was toned down from "silently".
