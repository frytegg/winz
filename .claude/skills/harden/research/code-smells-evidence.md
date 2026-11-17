# Code smells: which ones actually matter (empirical)
> Code T27 · slug code-smells-evidence · verified 2026-09-23 · counts: verified 12 / corrected 9 / downgraded 0 / dropped 0

## Summary

**How this was checked.** Every cited source was opened again. Full texts were read for:
- Palomba et al. EMSE 2018 and ICSME 2014, both as author PDFs;
- Tufano et al. TSE 2017;
- Hall et al. TOSEM 2014 (Lancaster eprint);
- Juergens et al. ICSE 2009, Lenarduzzi et al. SANER 2020 and JSS 2020 (arXiv);
- Soh et al. SANER 2016;
- the arXiv preprints 2601.09873, 2411.02320, 2601.02200 and 2408.10754;
- Arcelli Fontana et al. JOT 2012, from a truncated Wayback copy because jot.fm was unreachable.

The other papers were checked through their abstracts, taken from OpenAlex, Semantic Scholar or the Springer landing page. Tool defaults were checked in current source code or docs: PMD 7.27.0, SonarJava master, ESLint main (v10.11.0), Pylint (stable docs now 4.0.9, same defaults as the 4.0.8 the researcher cited), Ruff, jscpd v5 (npm 5.3.2) and SonarJS master. Practitioner items were checked through the HN Firebase API and the StackExchange API.

**Second pass (workflow resume, 2026-09-23).** The dossier was re-checked independently before hand-off. What was re-checked:
- **Palomba 2018 Table 10**, re-extracted from the author PDF. pdftotext shifts its columns by one row, so the alignment was confirmed against the RQ3 prose ("holds for all code smells but MM, LC, FE, CDSBP"; FE fault ×8; "seven highly diffused smells ... provide a high benefit").
- **Abstracts** of Sjøberg, Hall, Nagappan, Rachatasumrit, Bavota, Saboury, Spadini, Olbrich, Yamashita & Moonen and Romano, re-read on OpenAlex, and of Santos on Semantic Scholar.
- **Springer abstracts** of Khomh, Rahman and Kapser.
- **Full texts** of Juergens, Lenarduzzi SANER, Tufano, Palomba 2014, Soh, the Arcelli Fontana Wayback copy, and arXiv 2601.09873, 2601.02200 and 2411.02320.
- **Tool defaults** (ESLint, SonarJava, PMD, Pylint, Ruff), jscpd flags and every practitioner URL.

Every quote and number above was re-confirmed. Three small fixes were added: the Pylint version; the SonarJS note (the `??` exclusion predates the HN comment); and the wording of HN 30461175.

**What survives.** The association between smells and harm is real, but it concerns change-proneness much more than faults. It is strongest when several smells co-occur.

- **The largest study** is Palomba et al. (EMSE 23(3):1188-1221, 2018), covering 395 releases, 30 projects and 17,350 manually validated instances of 13 smells.
  - Median changes rise 12 → 22 → 32 → 54 as a class goes from 0 to 3 smells, with mostly large effect sizes. Median faults rise from 3 to 12, with weaker steps (1 vs 2 smells small, 2 vs 3 medium).
  - Within the same class, fault-proneness showed no substantial difference with versus without the smell. The authors call the smell "a co-occurring phenomenon" rather than a cause.
- **Other studies find small or no effects once size and changes are controlled:** Hall et al. TOSEM 2014, Lenarduzzi et al. JSS 2020 and Sjøberg et al. TSE 2013.

**Ranking by weight of evidence (corrected):**

- **Tier 1 — act, preferably in high-churn files:**
  - classes carrying several co-located smells;
  - size and complexity smells: Long Method, Complex Class/Method, God/Brain Class, Spaghetti Code;
  - inconsistently changed (near-miss) clones;
  - empty stubs and unused private members, checked first as possibly missing behaviour;
  - test smells: Assertion Roulette, Eager Test, Indirect Testing;
  - in JavaScript: variable re-assignment and assignment inside conditionals.
- **Tier 2 — case by case, with evidence and tests:**
  - Feature Envy, ISP violation / fat interfaces, Message Chains, wrong abstractions with flag parameters, hierarchy smells (flag only);
  - **Inappropriate Intimacy and Speculative Generality are contested** and have moved here. The researcher had put them in Tier 3, but Palomba 2018 (Table 10) rates removing them as a *high* change-proneness benefit. Inappropriate Intimacy also has the joint-highest removal effect on fault-proneness ("Medium"), even though developers do not perceive either smell as a problem.
- **Tier 3 — report only:** Class Data Should Be Private, Middle Man, Lazy Class, Long Parameter List (except in JavaScript), Switch Statements, Data Clumps.

**Process rules (these survive):**
- weight smells by churn;
- use thresholds relative to the project (tool defaults differ by up to about 3x for the same concept: max parameters 3 to 10, cyclomatic complexity 10 to 20);
- do not trust tool severity labels, and cross-check detectors;
- do not expect smell removal to reduce defects; add tests around smelly classes with a bug history instead;
- respect code that is deliberately written that way;
- put every refactoring behind a behaviour-preservation gate. Only 22% of refactored methods and fields were covered by existing regression tests in three Java projects (Rachatasumrit & Kim 2012). Hierarchy refactorings frequently induce faults (Bavota et al. 2012). StarCoder2 refactorings passed unit tests only 28.36% of the time at pass@1 (Cordeiro et al., 2024 preprint).

**Corrections made during verification:**
1. **ISP violation paper.** The paper cited is by **Aiko Yamashita alone**, published in EMSE 19(4):1111-1143 (2014 issue, online 2013). It is not "Yamashita & Moonen".
2. **Dead-code paper.** Romano et al. TSE 2018 is by **Romano, Vendome, Scanniello, Poshyvanyk**, not "Romano, Scanniello, Sartiani, Risi".
3. **Message Chain.** Palomba 2018 rates removing Message Chain as having a *Limited* effect on fault-proneness. Only Inappropriate Intimacy and Feature Envy are "Medium". The claim that Message Chain removal had "one of the few non-limited fault effects" was wrong.
4. **LLM Refused Bequest numbers (2601.09873).** Precision was 0.10-0.40 and F1 0.15-0.38 across the four LLMs. The upper values the researcher cited (0.50 / 0.45) belong to a static tool (JSpIRIT).
5. **"AI-friendly code" preprint (2601.02200).** It uses 5,000 **Python competitive-programming files** from DeepMind's CodeContests, not production "CodeScene data". The "Claude ~5% break rate" refers to the Claude Code agent (v2.0.13) running claude-sonnet-4-5.
6. **HN 45640380.** The comment says teams "solve" threshold violations by "naive copy pasting" that scatters complexity, not "naive splitting". Its claim that SonarQube counts `?.` and `??` does **not** match SonarJS source. S3776 explicitly skips `??` sequences and has no optional-chaining handler, both on current master and at commit dd5c889 (16 Sep 2025), a month before the comment was written.
7. **Linux kernel remark.** In Palomba 2014 this is a citation of Jbara, Matan & Feitelson (ICPC 2012), not Palomba's own finding. The "God Classes sporadically changing" point is likewise a citation of Ratiu et al.
8. **"LLM code has 63% more smells" (2510.03029).** The preprint shows this for Java code from older models (Gemini Pro, ChatGPT, Codex, Falcon). It does *not* show that the generating agent is a poor judge of its own code, so that inference was removed.

**Seed-lead corrections from the researcher that were confirmed:**
- Tufano ICSE 2015 was extended in TSE 43(11):1063-1088, 2017.
- The ISP result is from the EMSE journal paper, not ICSE 2013; the ICSE 2013 paper is about inter-smell relations.
- The Lanza & Marinescu detection strategy was verified only through PMD's GodClassRule source.

## Findings

### T27-F01 — Rank classes/files by the number of distinct co-located smell types, not raw violation counts
- **Grade:** A · **Verdict:** VERIFIED (audit correction: "large except 1 vs 2 (medium)" holds for change-proneness only, Table 6; for fault-proneness, Table 7 gives 1 vs 2 = 0.14 small and 2 vs 3 = 0.40 medium; the ranking rule is unaffected.)
- **Rule:**
  - Count the DISTINCT smell families per class/file, and also count smells in tightly coupled classes.
  - Shortlist classes with at least 2 distinct smells.
  - Report single-smell classes as informational unless they are hotspots (T27-F02).
- **Rationale:** Co-occurrence is the strongest and most replicated signal.
  - In Palomba 2018, median changes go 12 → 22 → 32 → 54 for 0 → 3 smells, and median faults go 3 → 12. For change-proneness (Table 6), Cliff's delta is large for every comparison except 1 vs 2 smells (0.42, medium). For fault-proneness (Table 7) the steps are weaker: 1 vs 2 smells is small (0.14) and 2 vs 3 is medium (0.40).
  - Politowski 2020 (133 participants at three universities) found single Blob or Spaghetti Code occurrences have little comprehension effect, but two occurrences significantly hurt time, correctness and effort. This replicates Abbes et al. 2011 at scale.
  - Yamashita & Moonen found smell interactions across coupled artifacts had effects comparable to same-file co-location.
  - Palomba controlled for size in two ways: logistic models, and a re-run within size strata. Smell presence stayed significantly associated with change-proneness (OR 4.46 vs 1.7 for size; interaction 8.41).
- **Evidence:**
  - [On the diffuseness and the impact on maintainability of code smells: a large scale empirical investigation](https://link.springer.com/article/10.1007/s10664-017-9535-z) — Palomba, Bavota, Di Penta, Fasano, Oliveto, De Lucia, EMSE 23(3):1188-1221, 2018 — peer_reviewed — "the median number of changes goes from 12 for non-smelly classes, to 22 for classes affected by one smell (+83%), 32 for classes affected by two smells (+167%), and up to 54 for classes affected by three smells (+350%)"; "the median fault-proneness of the classes grows from 3 for the nonsmelly classes up to 12 (+300%)"; Table 6 (changes) Cliff's delta 0.53L, 0.80L, 0.89L, 1v2 0.42 Medium, 0.84L, 0.72L; Table 7 (faults) 1v2 0.14 Small, 2v3 0.40 Medium; Table 9 ORs for change-proneness 4.46 / 1.7 / 8.41 (defect-proneness 1.74 / 0.93 / 2.11) — verified in the full text (author PDF https://fpalomba.github.io/pdf/Journals/J9.pdf); Springer blocks direct fetch.
  - [A Large Scale Empirical Study of the Impact of Spaghetti Code and Blob Anti-patterns on Program Comprehension](https://arxiv.org/abs/2009.02438) — Politowski, Khomh, Romano, Scanniello, Petrillo, Guéhéneuc, Maiga, IST 122:106278, 2020 — peer_reviewed — "372 tasks obtained thanks to 133 different participants"; "single occurrences ... have little effect on code comprehension, two occurrences of either Blob or Spaghetti Code significantly increases the developers' time..." — verified on arXiv. Participants were recruited at three universities.
  - [Exploring the impact of inter-smell relations on software maintainability](https://doi.org/10.1109/icse.2013.6606614) — Yamashita, Moonen, ICSE 2013 — peer_reviewed — "code smell interactions occurred across coupled artifacts, with comparable negative effects as same-artifact co-location" — abstract verified via OpenAlex.
- **Detect:**
  - Run at least two detectors and export JSON/SARIF. Examples: PMD 7 (`pmd check -d src -R category/java/design.xml -f sarif`); SonarQube issue export; ESLint JSON with complexity, max-lines-per-function, max-depth and max-params; Pylint or Ruff for Python; jscpd for duplication.
  - Map each rule to a family: size, complexity, coupling/encapsulation, duplication, hierarchy.
  - Count distinct families per file/class and shortlist those with at least 2.
  - Flag coupled pairs where both classes are smelly, using an import/call graph.
- **Tools:** PMD 7, SonarQube, ESLint, Pylint, Ruff, jscpd, DesigniteJava (last push Mar 2025), CodeScene.
- **Applies to:** OO or modular code of any kind. The evidence is Java open source; the comprehension replication used Java.
- **When not to apply / counterpoints:**
  - Co-occurrence correlates with size. Sjøberg 2013 found no smell effect after adjusting for size and changes.
  - Tufano 2017 reports that classes with several smell types are a minority (3% Android, 5% Apache, 9% Eclipse), so expect a short shortlist.
  - The family count depends on which detectors you run.
- **Fix risk:** low (ranking only)

### T27-F03 — Treat size and complexity smells (Long Method, Complex Method/Class, God/Brain/Blob Class, Spaghetti Code) as the top-priority smell tier; reduce them in hotspots with small behaviour-preserving steps
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - **Most diffused.** Long Method is found in 84% of 395 releases (331) at an average of 28 instances per KLOC; Spaghetti Code in 83%.
  - **Higher change-proneness while present, in the same class.** God Class median 46 vs 12 changes (+283%); Complex Class 55 vs 34.
  - **Removal helps.** Palomba 2018 Table 10 rates removing Long Method, Spaghetti Code, God Class and Complex Class as a "High" change-proneness benefit, but only a "Limited" fault benefit.
  - **Developers agree.** They rate these the most severe (Palomba 2014, Lesson III).
  - **Not just size.** Khomh 2012 (54 releases of four systems) found that size alone does not explain the higher change and fault odds of antipattern classes.
- **Evidence:**
  - [On the diffuseness and the impact on maintainability of code smells](https://link.springer.com/article/10.1007/s10664-017-9535-z) — Palomba et al., EMSE 2018 — peer_reviewed — "at least one instance of Long Method in 84% of the analyzed releases (331 out of 395)"; "Long Method is the most diffused smell, having the highest average density (i.e., 28 instances per KLOC)"; God Class "+283% ... (46 vs 12)"; Complex Class "55 ... while it is 34" — verified in the full text.
  - [An exploratory study of the impact of antipatterns on class change- and fault-proneness](https://link.springer.com/article/10.1007/s10664-011-9171-y) — Khomh, Di Penta, Guéhéneuc, Antoniol, EMSE 17(3):243-275, 2012 — peer_reviewed — "13 antipatterns in 54 releases of ArgoUML, Eclipse, Mylyn, and Rhino"; "size alone cannot explain the higher odds of classes with antipatterns" — abstract verified on the Springer page.
  - [Do They Really Smell Bad? A Study on Developers' Perception of Bad Code Smells](https://fpalomba.github.io/pdf/Conferencs/C3.pdf) — Palomba, Bavota, Di Penta, Oliveto, De Lucia, ICSME 2014, pp. 101-110 — peer_reviewed — "Lesson III. Smells related to complex/long source code are generally perceived as an important threat by developers. This happens for Complex Class, God Class, Long Method, and Spaghetti Code." — verified in the full text.
  - [PMD GodClassRule.java](https://github.com/pmd/pmd/blob/main/pmd-java/src/main/java/net/sourceforge/pmd/lang/java/rule/design/GodClassRule.java) — PMD project, 2026 — official_docs — `WMC_VERY_HIGH = 47`, `FEW_ATFD_THRESHOLD = 5`, `TCC_THRESHOLD = 1.0 / 3.0`, `wmc >= WMC_VERY_HIGH && atfd > FEW_ATFD_THRESHOLD && tcc < TCC_THRESHOLD` — verified in the source on main.
- **Detect** (all defaults verified in current source or docs):
  - **Java, PMD 7.27.0:** GodClass (WMC >= 47, ATFD > 5, TCC < 1/3); CognitiveComplexity reportLevel 15; CyclomaticComplexity method 10 / class 80; NcssCount method 60.
  - **Java, SonarJava:** S3776 (15), S138 (75 lines), S134 (nesting 3).
  - **JS/TS, ESLint:** complexity 20, max-lines-per-function 50, max-depth 4.
  - **Python:** Pylint max-branches 12, max-statements 50, max-nested-blocks 5; Ruff C901 (max-complexity 10).
  - **Spaghetti Code:** Palomba's high-recall candidate rule is "a class implementing at least two long methods interacting between them through method calls or shared fields". It is a pre-filter that was followed by manual validation.
  - **JDeodorant (Eclipse plugin):** Long Method → Extract Method, God Class → Extract Class.
- **Tools:** PMD 7.27.0, SonarQube/SonarJava, ESLint, Pylint 4.0.x, Ruff, JDeodorant (Eclipse plugin, last push Jan 2025), CodeScene.
- **Applies to:** All languages for method-level smells; OO code for class-level smells. The evidence is Java.
- **When not to apply / counterpoints:**
  - Olbrich et al. 2010: once normalised by size, God and Brain Classes were *less* change- and defect-prone ("may be an efficient way of organizing code").
  - Sjøberg 2013: no smell effect after controlling for size and changes.
  - Fowler: "Some long methods are just fine."
  - Palomba's worst Long Method release was Apache Derby's SQL parser package. Parsers, state machines, interpreter loops and generated code are legitimately long.
  - Removal did not lower fault-proneness (T27-F04).
- **Fix risk:** medium

### T27-F04 — Do not justify smell refactoring by expected defect reduction; where a smelly class has a bug-fix history, add or strengthen tests first
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Several independent studies agree that smells co-occur with fault-prone code rather than cause it.
  - Palomba 2018 RQ3: no substantial fault difference in the same classes with versus without the smell. In their logistic model, only the smell×size interaction was significant for fault-proneness.
  - Hall et al.: effects under 10%, sometimes negative.
  - Lenarduzzi et al.: no fault difference between clean and dirty classes (33 Apache projects).
  - Santos et al. SLR: no strong evidence linking smells and maintenance effort.
  - Palomba explicitly suggests using smell detectors to locate code that needs more testing.
- **Evidence:**
  - [On the diffuseness and the impact on maintainability of code smells](https://link.springer.com/article/10.1007/s10664-017-9535-z) — Palomba et al., EMSE 2018 — peer_reviewed — "we found no substantial differences between the faultproneness of classes in the periods when they were affected by smells and when they were not ... the smell is not the direct cause of fault-proneness but rather a co-occurring phenomenon"; "developers might use code smell detectors as a way to locate portions of source code that need more testing activities" — verified in the full text.
  - [Some Code Smells Have a Significant but Small Effect on Faults](https://doi.org/10.1145/2629648) — Hall, Zhang, Bowes, Sun, ACM TOSEM, 2014 — peer_reviewed — "Where smells did significantly affect faults, the size of that effect was small (always under 10 percent)... arbitrary refactoring is unlikely to significantly reduce fault-proneness and in some cases may increase fault-proneness." — verified in the abstract and full text (Lancaster eprint).
  - [Some SonarQube Issues have a Significant but Small Effect on Faults and Changes](https://arxiv.org/abs/1908.11590) — Lenarduzzi, Saarimäki, Taibi, JSS 170, 2020 — peer_reviewed — 33 Apache Java projects, 726 commits containing 27K faults, more than 95K TD items; "As for fault-proneness, there is no difference between clean and dirty classes." — verified in the arXiv abstract.
- **Detect:**
  - Find bug-fix hotspots: `git log --since='24 months ago' -i -E --grep='fix|bug|defect' --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn`, then intersect with the smell shortlist.
  - Check line and branch coverage of those files (JaCoCo, coverage.py --branch, c8/istanbul).
  - If coverage is low there, write characterization tests before touching anything.
- **Tools:** git, JaCoCo, coverage.py, c8/istanbul.
- **Applies to:** All projects.
- **When not to apply / counterpoints:**
  - Khomh 2012 and Palomba RQ2 show higher fault *odds* for smelly classes, as an association.
  - Fault data from SZZ and commit-message heuristics is noisy.
  - Saboury 2017 (JavaScript) reports 65% lower fault hazard in smell-free files, which is also an association.
- **Fix risk:** low

### T27-F16 — Do not rank or auto-fix by the analyser's severity or "bug" label; cross-check with a second detector or a manual justification
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:**
  - **SonarQube "bug" rules (Lenarduzzi 2020).** Only 3 of 57 rules classified as bugs were fault-prone, the model built on them had AUC 50.94%, and severity was unrelated to fault-proneness.
  - **Detector disagreement (Arcelli Fontana 2012).** Different detectors for the same smell disagree, except for God Class. That study compared four tools on GanttProject.
  - **Human agreement (Santos 2018 SLR).** Agreement on smell detection is low.
  - **False positives (Ghost Echoes 2024).** SonarQube's file-level maintainability rating produces many false positives.
- **Evidence:**
  - [Are SonarQube Rules Inducing Bugs?](https://arxiv.org/abs/1907.00376) — Lenarduzzi, Lomio, Huttunen, Taibi, SANER 2020 — peer_reviewed — 21 projects, 39,518 commits, 202 rules: "Out of the 57 violations classified as 'bugs' by SonarQube, only three (squid 1143, 1147, 1764) were considered faultprone"; "AUC of 50.94%"; "Lesson 3: SonarQube violation severity is not related to the fault-proneness" — verified in the full text. Even the "fault-prone" rules had very low individual importance (max 0.62%).
  - [Automatic detection of bad smells in code: An experimental assessment](http://www.jot.fm/issues/issue_2012_08/article5.pdf) — Arcelli Fontana, Braione, Zanoni, JOT 11(2), 2012 — peer_reviewed — "different detectors for a same code smell produce different answers even if they are based on similar detection algorithms. The only notable exception is given by the tools that detect the God Class smell." — verified in text extracted from the Wayback copy (jot.fm unreachable). Four 2012-era tools, one system (GanttProject).
  - [A systematic review on the code smell effect](https://doi.org/10.1016/j.jss.2018.07.035) — Santos, Rocha-Junior, Prates, Nascimento, Freitas, Mendonça, JSS, 2018 — peer_reviewed — "There is no strong evidence correlating smells and some important software development attributes, such as effort in maintenance. Moreover, the studies point out that human agreement on smell detection is low." — abstract verified via Semantic Scholar.
  - [Ghost Echoes Revealed: Benchmarking Maintainability Metrics and ML Predictions Against Human Assessments](https://arxiv.org/abs/2408.10754) — Borg, Ezzouhri, Tornhill (CodeScene), ICSME 2024 — peer_reviewed — "caution is advised with SonarQube due to its tendency to generate many false positives"; cites Lenarduzzi et al.: "SonarQube had the lowest precision (0.18)" among six tools — verified in the full text. The authors are from the vendor, and the 0.18 figure is a secondary citation.
- **Detect:**
  - For every candidate, require either agreement from 2 detectors (PMD + SonarQube, Ruff + Pylint, DesigniteJava + PMD) or a written justification naming the concrete change the smell makes harder.
  - Ignore severity fields when prioritising; use the T27-F01/F02 ranking instead.
- **Tools:** SonarQube, PMD, DesigniteJava, Ruff, Pylint.
- **Applies to:** All projects using static analysers.
- **When not to apply / counterpoints:**
  - The fault studies rely on SZZ, which is noisy.
  - "Bug" rules may prevent faults that never reached the tracker.
  - Ghost Echoes is vendor-authored and argues that SonarQube-based ground truth (including Lenarduzzi's) is itself questionable.
- **Fix risk:** low

### T27-F18 — Put every smell-removal refactoring behind a behaviour-preservation gate
- **Grade:** A · **Verdict:** CORRECTED — the Borg 2026 dataset was misdescribed ("CodeScene data" → 5,000 Python competitive-programming files); "Claude" clarified as the Claude Code agent v2.0.13 with Sonnet 4.5; the StarCoder2 developer baseline is 100% by construction.
- **Rule:**
  - Confirm the code to be touched is covered by tests; add characterization tests if not.
  - Apply one refactoring per commit, using IDE-automated refactorings where available, and run the full suite after each.
  - For AI-generated refactorings, require passing tests AND a diff review.
- **Rationale:**
  - **Coverage gap.** Only 22% of refactored methods and fields were covered by existing regression tests, and refactorings were involved in almost half of failed test cases (JMeter, XMLSecurity, Ant).
  - **Hierarchy risk.** Hierarchy refactorings frequently induce faults (Bavota 2012).
  - **LLM refactoring, 2024.** StarCoder2 passed unit tests 28.36% of the time at pass@1 (57.15% at pass@5) on 30 Java projects. The developer baseline is 100% because only accepted refactoring PRs were sampled.
  - **LLM refactoring, 2026.** On 5,000 Python competitive-programming solutions, medium-sized LLMs broke tests less often on "Healthy" code (relative risk 0.69-0.85, i.e. roughly 15-30% risk reduction). Claude Code broke about 5% of test suites regardless of code health.
- **Evidence:**
  - [An empirical investigation into the impact of refactoring on regression testing](https://doi.org/10.1109/icsm.2012.6405293) — Rachatasumrit, Kim, ICSM 2012 — peer_reviewed — "only 22% of refactored methods and fields are tested by existing regression tests... refactorings are involved in almost half of the failed test cases." — abstract verified via OpenAlex.
  - [An Empirical Study on the Code Refactoring Capability of Large Language Models](https://arxiv.org/abs/2411.02320) — Cordeiro, Noei, Zou, 2024 — preprint — "StarCoder2 achieves a 28.36% pass@1 for our experiments"; "Developers achieve a 100% unit test pass rate as all of their refactorings are accepted pull requests" — verified in the full text.
  - [Code for Machines, Not Just Humans: Quantifying AI-Friendliness with Code Health Metrics](https://arxiv.org/abs/2601.02200) — Borg, Hagatulah, Tornhill, Söderberg (CodeScene-affiliated), accepted at FORGE 2026 — peer_reviewed (accepted) — "LLMs tasked with refactoring have significantly lower break rates on code in the Healthy CodeHealth range (≥9), with corresponding risk reductions of 15-30%"; "Claude breaks only about 5% of the test suites regardless of whether the code is Healthy or Unhealthy" — verified in the full text. The dataset is CodeContests Python solutions, not production code.
  - [When Does a Refactoring Induce Bugs? An Empirical Study](https://doi.org/10.1109/scam.2012.20) — Bavota, De Carluccio, De Lucia, Di Penta, Oliveto, Strollo, SCAM 2012 — peer_reviewed — 15,008 refactorings of 52 kinds (Ant, Xerces, ArgoUML): "refactorings involving hierarchies (e.g., pull up method), tend to induce faults very frequently" — abstract verified via OpenAlex.
- **Detect:**
  - Before refactoring file F, check that the lines and branches to be changed are covered (JaCoCo, coverage.py --branch, c8). If not, write characterization tests that pin current outputs, including odd ones.
  - Use IDE Extract/Move/Rename rather than hand edits.
  - Commit each refactoring separately with the prefix `refactor:` and no behaviour change.
  - Consider mutation testing (PIT, mutmut, Stryker) on the refactored unit.
- **Tools:** JaCoCo, coverage.py, c8, PIT, mutmut, Stryker, IDE refactoring engines.
- **Applies to:** All projects; mandatory for AI-agent-driven hardening.
- **When not to apply / counterpoints:**
  - Characterization tests can freeze existing bugs; flag suspicious behaviour separately.
  - The LLM figures are model-specific (StarCoder2, Sonnet 4.5 era) and will shift.
  - The 2026 study is vendor-affiliated and uses toy-sized competitive-programming files.
- **Fix risk:** low

### T27-F02 — Weight every smell by change activity; refactor smelly code that keeps changing, and leave smelly-but-stable code alone unless upcoming work touches it
- **Grade:** B · **Verdict:** VERIFIED (notes added)
- **Rationale:**
  - **Controlled study with professionals (Sjøberg 2013).** Six developers maintained four functionally equivalent Java systems for 3-4 weeks each. File size and number of changes explained almost all variation in effort; the 12 smells did not.
  - **Relative churn predicts defects (Nagappan & Ball, Windows Server 2003).** Relative churn separated fault-prone from non-fault-prone binaries with 89% accuracy. This supports churn as a risk signal, but is indirect evidence for smell weighting.
  - **Developer perception.** God Classes that change only sporadically are not felt as a problem. Palomba 2014 reports this as a citation of Ratiu et al.
  - **Vendor recommendation.** A CodeScene-affiliated study recommends preventing smells in high-churn files.
- **Evidence:**
  - [Quantifying the Effect of Code Smells on Maintenance Effort](https://doi.org/10.1109/TSE.2012.89) — Sjøberg, Yamashita, Anda, Mockus, Dybå, IEEE TSE 39(8), 2013 — peer_reviewed — "None of the 12 investigated smells was significantly associated with increased effort after we adjusted for file size and the number of changes; Refused Bequest was significantly associated with decreased effort. File size and the number of changes explained almost all of the modeled variation in effort." — abstract verified via OpenAlex.
  - [Use of relative code churn measures to predict system defect density](https://doi.org/10.1145/1062455.1062514) — Nagappan, Ball (Microsoft Research), ICSE 2005 — peer_reviewed — "absolute measures of code churn are poor predictors of defect density, our set of relative measures of code churn is highly predictive... accuracy of 89.0 percent" — abstract verified via OpenAlex.
  - [Increasing, not Diminishing: Investigating the Returns of Highly Maintainable Code](https://arxiv.org/abs/2401.13407) — Borg, Pruvost, Mones, Tornhill (CodeScene), TechDebt 2024 — peer_reviewed — "recommend organizations to diligently prevent the introduction of code smells in files with high churn" — abstract verified. This is a recommendation discussed around a regression-based value model, not a direct measurement; the authors are from the vendor.
  - [Do They Really Smell Bad?](https://fpalomba.github.io/pdf/Conferencs/C3.pdf) — Palomba et al., ICSME 2014 — peer_reviewed — "God Classes sporadically changing are not felt as a problem by developers [11]" — verified in the full text; [11] is Ratiu et al. (secondary).
- **Detect:**
  - Changes per file over 12 months: `git log --since='12 months ago' --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -50`.
  - Relative churn: sum added+deleted lines from `--numstat` per file, divided by current LOC.
  - Intersect with the T27-F01 shortlist. Priority = smell families × relative churn.
- **Tools:** git, CodeScene (hotspots), any smell detector.
- **Applies to:** Projects with months or more of commit history.
- **When not to apply / counterpoints:**
  - A "finished" project may have a short or squashed history.
  - Past churn does not always predict future change; code on the roadmap counts as hot.
  - Vendor studies carry a conflict of interest.
- **Fix risk:** low

### T27-F05 — Report-only (de-prioritise) the smells with weak or unfavourable evidence: Class Data Should Be Private, Middle Man, Lazy Class, Long Parameter List (outside JS), Switch Statements, Data Clumps; treat Inappropriate Intimacy and Speculative Generality as contested (Tier 2)
- **Grade:** B · **Verdict:** CORRECTED — Inappropriate Intimacy and Speculative Generality moved out of report-only. The researcher's own source (Palomba 2018 Table 10) ranks removing Inappropriate Intimacy first overall (High change benefit, Medium fault benefit) and Speculative Generality as High change benefit.
- **Rationale:**
  - **Not perceived as problems (Palomba 2014, Lesson I):** CDSBP, Middle Man, Long Parameter List, Lazy Class and Inappropriate Intimacy.
  - **Limited removal effect (Palomba 2018 Table 10):** removing CDSBP, LPL, Lazy Class or Middle Man had a "Limited" effect on both change- and fault-proneness. The authors expect removing Lazy Class or Middle Man to *increase* change-proneness.
  - **Weak fault links (Hall 2014):**
    - Switch Statements had no effect on faults in any of the three systems.
    - Data Clumps reduced faults in two systems but increased them in one.
    - Middle Man reduced faults only in ArgoUML.
- **Evidence:**
  - [Do They Really Smell Bad?](https://fpalomba.github.io/pdf/Conferencs/C3.pdf) — Palomba et al., ICSME 2014 — peer_reviewed — "Lesson I. There are some smells that are generally not perceived by developers as design problems. Those smells are Class Data Should Be Private, Middle Man, Long Parameter List, Lazy Class, and Inappropriate Intimacy." Participants: 10 original developers and 24 outsiders (9 industrial developers, 15 Master's students); 3 Java systems; one instance per smell type per system — verified in the full text.
  - [On the diffuseness and the impact on maintainability of code smells](https://link.springer.com/article/10.1007/s10664-017-9535-z) — Palomba et al., EMSE 2018 — peer_reviewed — "This result holds for all code smells but Middle Man (MM), Lazy Class (LC), Feature Envy (FE), and Class Data Should Be Private (CDSBP)"; "the removal of a Middle Man ... is expected to increase the change-proneness"; Table 10 removal effect: II High/Medium, SG High/Limited, CDSBP/LPL/LC/MM Limited/Limited — verified in the full text.
  - [Some Code Smells Have a Significant but Small Effect on Faults](https://eprints.lancs.ac.uk/id/eprint/127419/1/Tosem_code_smells.pdf) — Hall, Zhang, Bowes, Sun, TOSEM 2014 — peer_reviewed — "Switch Statements had no effect on faults in any of the three systems... Data Clumps reduced faults in Apache and Eclipse but increased faults in ArgoUML; Middle Man reduced faults only in ArgoUML, and Speculative Generality reduced faults only in Eclipse." — verified in the full-text eprint.
- **Detect:**
  - Report as information and do not fix in bulk.
  - Parameter-count defaults disagree: ESLint max-params 3; Pylint max-args 5 / Ruff PLR0913 5; SonarJava S107 7; PMD ExcessiveParameterList 10. All verified.
  - CDSBP: public mutable fields.
  - Middle Man (Palomba candidate rule): "classes delegating more than half of the implemented methods".
  - Lazy Class: LOC below the project's first quartile.
- **Tools:** ESLint, Pylint, Ruff, SonarJava, PMD.
- **Applies to:** Mainly Java/OO evidence. For JavaScript Long Parameter List see T27-F17.
- **When not to apply / counterpoints:**
  - **Inappropriate Intimacy and Speculative Generality: the sources conflict.** Developers don't perceive them, and Speculative Generality reduced faults in Eclipse (Hall). But the within-class change data (Palomba 2018) favours removing them. Handle them case by case in hotspots (Tier 2), not as report-only.
  - Saboury 2017: 1,484 JS developers rate Long Parameter List serious.
  - Soh 2016: Data Clumps affects editing effort.
  - Public mutable fields can matter for thread safety or security.
- **Fix risk:** medium

### T27-F06 — For duplication, hunt inconsistent near-miss clones and treat each as a probable bug; do not mass-merge exact clones
- **Grade:** B · **Verdict:** VERIFIED (context added)
- **Rule:**
  - Hunt INCONSISTENT near-miss clones: copies where one was changed or fixed and the other was not.
  - Treat such a clone as a probable bug: fix the divergence first in its own commit, then decide on extraction.
- **Rationale:**
  - **Inconsistent clones are fault-prone (Juergens 2009).** The study covered three commercial C# systems, one Cobol system and one Java OSS system, with developers rating about 700 inconsistent clone groups.
    - 52% of clone groups were inconsistent and 28% of those were unintentional.
    - At least 3-23% of inconsistencies were faults: 107 faults confirmed by developers.
    - About every second to third unintentional change to a clone led to a fault.
  - **SonarQube fault-inducing commits (Lenarduzzi 2020).** In a manual sample of 10 instances per rule, duplicated-code violations always generated a fault, and S1192 (repeated string literals) topped Table V.
  - **Clones in general are not reliably defect-prone:**
    - Rahman et al.: clones may be *less* defect-prone.
    - Kapser & Godfrey: up to 71% of clones had a positive maintainability impact.
  - **AI-assistant era (GitClear, vendor).** Copy/paste rose from 8.3% to 12.3% of changed lines (2020-2024), a correlational trend.
- **Evidence:**
  - [Do Code Clones Matter?](https://arxiv.org/abs/1701.05472) — Juergens, Deissenboeck, Hummel, Wagner, ICSE 2009 — peer_reviewed — "About half of the clones (52%) contain inconsistencies... over a quarter (28%) has been introduced unintentionally"; "at least 3-23% of the inconsistencies actually presented a fault"; "about every second to third unintentional change to a clone leads to a fault"; "107 faults" — verified in the full text.
  - [Clones: what is that smell?](https://link.springer.com/article/10.1007/s10664-011-9195-3) — Rahman, Bird, Devanbu, EMSE 17(4-5), 2012 — peer_reviewed — "the great majority of bugs are not significantly associated with clones. Second, we find that clones may be less defect prone than non-cloned code." — abstract verified on the Springer page; four OSS projects.
  - ["Cloning considered harmful" considered harmful: patterns of cloning in software](https://link.springer.com/article/10.1007/s10664-008-9076-6) — Kapser, Godfrey, EMSE 13(6), 2008 — peer_reviewed — "as many as 71% of the clones could be considered to have a positive impact on the maintainability of the software system" — abstract verified on the Springer page (Apache httpd and Gnumeric).
  - [Are SonarQube Rules Inducing Bugs?](https://arxiv.org/abs/1907.00376) — Lenarduzzi, Lomio, Huttunen, Taibi, SANER 2020 — peer_reviewed — "violations related to duplicated code and empty statements ... always generated a fault (in the randomly selected cases)"; S1192 is first in Table V — verified in the full text (10 random instances per rule).
  - [AI Copilot Code Quality 2025 research](https://www.gitclear.com/ai_assistant_code_quality_2025_research) — GitClear, 2025 — industry_report — 211 million changed lines, 2020-2024: copy/pasted "from 8.3% to 12.3%"; moved lines "sunk from 25% of changed lines in 2021, to less than 10% in 2024" — verified; vendor report, correlational.
- **Detect:**
  - jscpd v5 (224 formats) reports only exact clones by default.
    - Near-miss: `--max-gap-lines N`, or `--similarity 0.85` (JS/TS AST).
    - Type-2: `--ignore-identifiers --ignore-literals`.
    - Filter with `--kind gap,ast`. All flags verified in the jscpd README.
  - Other detectors: PMD CPD; Pylint duplicate-code (R0801, min-similarity-lines 4); SonarJava S1192 (threshold 3, minimal length 5).
  - For each clone group, diff the copies and run `git log -L <start>,<end>:<file>` on each copy.
- **Tools:** jscpd, PMD CPD, Pylint, SonarQube, git log -L.
- **Applies to:** All languages; especially AI-assisted codebases.
- **When not to apply / counterpoints:**
  - Merging clones couples callers that may diverge later (T27-F07).
  - Cloning is sometimes principled (Kapser & Godfrey).
  - Test and generated code tolerate duplication.
  - The Lenarduzzi "always" rests on a 10-instance sample and SZZ.
- **Fix risk:** medium

### T27-F08 — Treat Feature Envy as a Tier-2, method-level smell; move code only with clear evidence, in hotspots
- **Grade:** B · **Verdict:** VERIFIED (context added)
- **Rule:** Move a method (or part of it) only when:
  - it clearly uses another class's data and behaviour more than its own;
  - it sits in a hotspot;
  - there is a human-readable justification.
- **Rationale:**
  - **Low diffusion.** Feature Envy occurs in 50% of releases at about 3 instances per affected release.
  - **Strong fault association while present (Palomba 2018).** Fault-proneness rose by a factor of 8 in the same classes while affected. Table 10 rates its removal as a "Medium" fault benefit but only a "Limited" change benefit.
  - **Effort (Soh 2016).** It affects searching, editing, navigating and reading effort.
  - **Identification needs experience (Palomba 2014, Lesson IV).**
  - **Detection is inconsistent (2601.09873).** LLM F1 ranged 0.11-0.71 against a 76-developer ground truth; the static tools reached about 0.62-0.63.
- **Evidence:**
  - [On the diffuseness and the impact on maintainability of code smells](https://link.springer.com/article/10.1007/s10664-017-9535-z) — Palomba et al., EMSE 2018 — peer_reviewed — "The most interesting case is the FE, for which we observed that the fault-proneness increases by a factor of 8 when this code smell affects the classes." — verified in the full text.
  - [Do Code Smells Impact the Effort of Different Maintenance Programming Activities?](https://ir.cwi.nl/pub/25393/Soh-SANER16_Smells-Effort.pdf) — Soh, Yamashita, Khomh, Guéhéneuc, SANER 2016 — peer_reviewed — "'Feature Envy' affects searching effort"; "Editing, navigating, and reading effort are affected by three smells: 'Feature Envy', 'God Class', and 'ISP Violation'." — verified in the full text. The same dataset as Sjøberg 2013 (6 developers, 4 systems); the authors also conclude that change size and file size explain effort more than smells do.
  - [Beyond Strict Rules: Assessing the Effectiveness of Large Language Models for Code Smell Detection](https://arxiv.org/abs/2601.09873) — Souza, Santana, Figueiredo, Muzetti, Montandon, Briand, 2026 — preprint — 76 developers, 268 candidates, 30 Java projects. Feature Envy F1: DeepSeek-R1 0.50, GPT-5 mini 0.11, Llama-3.3 0.71, Qwen2.5-Coder 0.46; tools 0.62 / 0.63 — verified in Table 6 of the full text.
- **Detect:**
  - JDeodorant Feature Envy → Move Method.
  - Palomba candidate rule: "methods having more calls with another class than the one they are implemented in".
  - Manual check: count `other.x` / `other.m()` versus `this`/`self` accesses. Consider a move when more than half go to one other type and little of the method's own state is used.
- **Tools:** JDeodorant, IDE Move Method.
- **Applies to:** OO code (Java, C#, TS/Python classes).
- **When not to apply / counterpoints:**
  - Strategy, Visitor, mappers/DTO assemblers and orchestrators envy other classes by design.
  - Moving a method changes dispatch, visibility and serialization hooks.
- **Fix risk:** medium

### T27-F11 — Flag, but do not restructure during hardening, hierarchy smells (Refused Bequest, deep or broken hierarchies) unless the affected paths are well tested
- **Grade:** B · **Verdict:** CORRECTED — the LLM Refused Bequest numbers were fixed. Across the four LLMs, precision was 0.10-0.40 and F1 0.15-0.38. The 0.50 precision and 0.45 F1 belong to the static tool JSpIRIT.
- **Rationale:** The evidence on Refused Bequest conflicts, and hierarchy refactorings carry fault risk.
  - Sjøberg: Refused Bequest was associated with DECREASED effort.
  - Palomba 2018: median changes 43 with the smell versus 26 without.
  - Palomba 2014: only the severe Eclipse instance was recognised (Lesson II).
  - LLM detection is poor: all four models scored below 0.40 F1.
  - Refactorings involving hierarchies "tend to induce faults very frequently" (Bavota 2012).
- **Evidence:**
  - [When Does a Refactoring Induce Bugs?](https://doi.org/10.1109/scam.2012.20) — Bavota et al., SCAM 2012 — peer_reviewed — "refactorings involving hierarchies (e.g., pull up method), tend to induce faults very frequently" — abstract verified via OpenAlex.
  - [Quantifying the Effect of Code Smells on Maintenance Effort](https://doi.org/10.1109/TSE.2012.89) — Sjøberg et al., TSE 2013 — peer_reviewed — "Refused Bequest was significantly associated with decreased effort." — abstract verified.
  - [On the diffuseness and the impact on maintainability of code smells](https://link.springer.com/article/10.1007/s10664-017-9535-z) — Palomba et al., EMSE 2018 — peer_reviewed — "for classes affected by Refused Bequest (RB) the median change-proneness goes from 43 (in the presence of the smell) down to 26 (in the absence of the smell)" — verified in the full text.
  - [Beyond Strict Rules](https://arxiv.org/abs/2601.09873) — Souza et al., 2026 — preprint — Refused Bequest LLM precision 0.40 / 0.10 / 0.20 / 0.30 and F1 0.38 / 0.15 / 0.19 / 0.30; "leading all models to score below 0.40 on F1-score" — verified in the full text.
- **Detect:**
  - Palomba candidate rule: "classes overriding more than half of the methods inherited by a superclass".
  - Search for refusals: `rg -n 'UnsupportedOperationException|raise NotImplementedError|throw new Error\(.not (implemented|supported)'` and empty overrides.
  - Speculative Generality: abstract classes with fewer than 3 children (Palomba rule).
  - DesigniteJava: Rebellious/Broken/Deep Hierarchy.
- **Tools:** DesigniteJava, IDE type hierarchy, ripgrep.
- **Applies to:** Inheritance-based OO code.
- **When not to apply / counterpoints:**
  - Framework-mandated base classes and test doubles refuse behaviour by design.
- **Fix risk:** high

### T27-F12 — Treat metric thresholds as tool conventions, not empirical constants
- **Grade:** B (was A) · **Verdict:** CORRECTED
  - The prescriptive part (report the worst items relative to the project) is judgement, not validated. Palomba's candidate rules use system averages and quartiles, not "top 5%".
  - "Cognitive Complexity is the only size-free metric with partial validation" overstates the source. Muñoz Barón et al. call it "the first validated and solely code-based metric" that reflects "at least some aspects" of understandability.
  - The HN comment described copy-pasting, not splitting.
  - Pylint `max-complexity` belongs to the optional mccabe extension.
- **Rule:** Report the worst functions and classes relative to the project. Combine at least 2 metrics. Never mass-refactor just to get under a default threshold.
- **Rationale:** Default thresholds from official tools disagree widely for the same concept, which shows they are conventions.
  - Max parameters: ESLint 3, Pylint/Ruff 5, SonarJava 7, PMD 10.
  - Method length: ESLint 50 lines, Pylint 50 statements, PMD 60 NCSS, SonarJava 75 lines, versus Fowler's "half-a-dozen lines".
  - Cyclomatic complexity: PMD 10, Pylint mccabe 10, Ruff C901 10, ESLint 20.
  - Cognitive Complexity 15 (Sonar, PMD) correlates with comprehension time and subjective difficulty, with mixed results for correctness.
- **Evidence:**
  - [PMD 7.27.0 Java design rules](https://docs.pmd-code.org/latest/pmd_rules_java_design.html) — PMD project, 2026 — official_docs — CognitiveComplexity reportLevel 15; CyclomaticComplexity methodReportLevel 10 / classReportLevel 80; NcssCount method 60; NPathComplexity 200; ExcessiveParameterList minimum 10; AvoidDeeplyNestedIfStmts problemDepth 3; TooManyMethods maxmethods 10 — verified on the docs page (7.27.0).
  - [SonarJava checks source](https://github.com/SonarSource/sonar-java/tree/master/java-checks/src/main/java/org/sonar/java/checks) — SonarSource, 2026 — official_docs — S3776 `DEFAULT_MAX = 15`; S107 `DEFAULT_MAXIMUM = 7`; S138 `DEFAULT_MAX = 75`; S134 `DEFAULT_MAX = 3` — verified in the source.
  - [ESLint complexity rule](https://eslint.org/docs/latest/rules/complexity) — ESLint, v10.x, 2026 — official_docs — `THRESHOLD_DEFAULT = 20`; max-params [3]; max-depth [4]; max-lines-per-function [50]; max-statements [10] — verified in lib/rules on main (package v10.11.0).
  - [Pylint all options (stable)](https://pylint.readthedocs.io/en/stable/user_guide/configuration/all-options.html) — PyCQA, 2026 (stable docs now 4.0.9; the researcher saw 4.0.8, defaults identical) — official_docs — max-args 5, max-positional-arguments 5, max-locals 15, max-branches 12, max-statements 50, max-attributes 7, max-public-methods 20, max-returns 6, max-nested-blocks 5, max-bool-expr 5, max-complexity 10 (mccabe extension), min-similarity-lines 4 — verified.
  - [An Empirical Validation of Cognitive Complexity as a Measure of Source Code Understandability](https://arxiv.org/abs/2007.12520) — Muñoz Barón, Wyrich, Wagner, ESEM 2020 — peer_reviewed — about 24,000 evaluations of 427 snippets; "positively correlates with comprehension time and subjective ratings of understandability. The metric showed mixed results for the correlation with the correctness of comprehension tasks and with physiological measures" — verified.
  - [FunctionLength](https://martinfowler.com/bliki/FunctionLength.html) — Martin Fowler, 30 Nov 2016 — engineering_blog — "Any function more than half-a-dozen lines of code starts to smell to me" — verified.
- **Detect:**
  - Compute per-function metrics with the language's tool and export them.
  - Rank by cognitive complexity, then nesting and length.
  - Report the project's worst tail, not every item above the default.
  - Palomba's high-recall rules (Long Method = LOC above the system average; Complex Class = a method with McCabe > 10) are pre-filters only.
- **Tools:** PMD 7.27.0, SonarQube, ESLint, Pylint, Ruff.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - Teams with CI gates need numbers; keep the project's existing configuration.
  - An HN commenter (45640380) says SonarQube's cognitive complexity counts `?.` and `??` in TS/JSX. **This does not match current SonarJS source.** S3776 skips `??` sequences, skips JSX short-circuit expressions and has no optional-chaining handler. The `??` exclusion was already present at commit dd5c889 (16 Sep 2025), before the comment (20 Oct 2025). Treat the claim as unsupported for SonarJS; it may refer to an older release or another Sonar analyser.
- **Fix risk:** low

### T27-F15 — In a finished project, treat empty method bodies, TODO stubs and unused private members as possible missing behaviour before deleting them
- **Grade:** B · **Verdict:** CORRECTED
  - Romano et al. TSE 2018 authors fixed: Romano, Vendome, Scanniello, Poshyvanyk.
  - SonarJava S1481 is "unused local variables" (the paper calls it "unused private variable").
  - UnusedPrivateMethodCheck (S1144) lives under `checks/unused/`.
- **Rationale:**
  - **Empty methods (Lenarduzzi 2020).** In the manually inspected fault-inducing commits (10 per rule), empty methods "often containing only a 'TODO' note" were used before being implemented.
  - **Unused members.** Unused private variables and methods sometimes turned out to be methods that were expected to be called.
  - **Dead code is still harmful (Romano 2018).** Remove it, but only after this check.
- **Evidence:**
  - [Are SonarQube Rules Inducing Bugs?](https://arxiv.org/abs/1907.00376) — Lenarduzzi, Lomio, Huttunen, Taibi, SANER 2020 — peer_reviewed — "When committing an empty method (often containing only a 'TODO' note), developers often forgot to implement it and then used it without realizing that the method did not return the expected value"; "1481 (unused private variable should be removed) and 1144 (unused private methods should be removed) unexpectedly resulted to be an issue... methods not used, but expected to be used in other methods, resulted in a fault" — verified in the full text.
  - [A Multi-Study Investigation into Dead Code](https://doi.org/10.1109/tse.2018.2842781) — Romano, Vendome, Scanniello, Poshyvanyk, IEEE TSE, 2018 — peer_reviewed — interviews and four experiments; "our results suggest that dead code is harmful"; "developers should avoid this smell" — abstract verified via OpenAlex (authors corrected).
  - [SonarJava EmptyMethodsCheck](https://github.com/SonarSource/sonar-java/blob/master/java-checks/src/main/java/org/sonar/java/checks/EmptyMethodsCheck.java) — SonarSource, 2026 — official_docs — `@Rule(key = "S1186")`; unused/UnusedPrivateMethodCheck `S1144`; unused/UnusedLocalVariableCheck `S1481` — verified in the source.
- **Detect:**
  - Rules: SonarJava S1186, S1144, S1481; ESLint no-empty-function, no-unused-vars; PMD UnusedPrivateMethod and UncommentedEmptyMethodBody; Pylint unused-variable.
  - Search: `rg -n 'TODO|FIXME|XXX|NotImplemented|^\s*pass\s*$'`.
  - For each unused member, `git log -S'<name>' --oneline`.
  - Check for reflection, DI, annotations and string/template references before deleting.
- **Tools:** SonarQube, ESLint, PMD, Pylint, ripgrep, git log -S.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - The evidence is a single study with 10 manually inspected instances per rule.
  - Empty methods are legitimate for no-op defaults and hooks; a comment should say so.
- **Fix risk:** medium

### T27-F17 — In JavaScript/TypeScript, prioritise variable re-assignment and assignment inside conditionals; also address nested callbacks and long parameter lists
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - **Survival analysis (Saboury 2017):** 537 releases of five Node.js projects (express, grunt, bower, less.js, request).
    - Smell-free files had 65% lower fault hazard.
    - Variable Re-assign and Assignment In Conditional statements had the highest hazard.
  - **Developer survey:** 1,484 JS developers rated Nested Callbacks, Variable Re-assign and Long Parameter List as serious.
  - **Why it matters here:** this is one of the few non-Java studies.
- **Evidence:**
  - [An empirical study of code smells in JavaScript projects](https://doi.org/10.1109/saner.2017.7884630) — Saboury, Musavi, Khomh, Antoniol, SANER 2017 — peer_reviewed — "files without code smells have hazard rates 65% lower than files with code smells"; "'Variable Re-assign' and 'Assignment In Conditional statements' code smells have the highest hazard rates"; survey of 1,484 developers — abstract verified via OpenAlex.
  - [ESLint rules source](https://github.com/eslint/eslint/tree/main/lib/rules) — ESLint, 2026 — official_docs — no-cond-assign defaultOptions ["except-parens"], recommended: true; no-param-reassign recommended: false; max-nested-callbacks default 10 — verified in the source on main.
- **Detect:**
  - ESLint no-cond-assign (`"always"`), no-param-reassign, prefer-const (autofix), max-params.
  - max-nested-callbacks: consider 3-4 instead of the default 10 (a judgement call, not from the study).
  - Review `let` variables assigned in several branches.
- **Tools:** ESLint, typescript-eslint.
- **Applies to:** JavaScript/TypeScript; the evidence is server-side.
- **When not to apply / counterpoints:**
  - Five projects from the callback era; this is association only.
  - Converting callbacks to async/await changes error propagation and timing, so it is not a pure refactoring.
- **Fix risk:** low

### T27-F19 — Include test code in the smell review; prioritise Assertion Roulette, Eager Test and Indirect Testing
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Spadini et al. studied 221 releases of 10 systems and more than a million test cases.
  - Smelly tests were more change- and defect-prone.
  - Indirect Testing, Eager Test and Assertion Roulette were the most significant smells *for change-proneness*.
  - Production code tested by smelly tests was more defect-prone.
- **Evidence:**
  - [On the Relation of Test Smells to Software Code Quality](https://www.zora.uzh.ch/id/eprint/197755/1/icsme2018a.pdf) — Spadini, Palomba, Zaidman, Bruntink, Bacchelli, ICSME 2018 (DOI 10.1109/icsme.2018.00010) — peer_reviewed — "(i) tests with smells are more change- and defect-prone, (ii) 'Indirect Testing', 'Eager Test', and 'Assertion Roulette' are the most significant smells for change-proneness and, (iii) production code is more defect-prone when tested by smelly tests" — abstract verified via OpenAlex. The zora PDF is behind a bot wall.
  - [TestSmellDetector (tsDetect)](https://github.com/TestSmells/TestSmellDetector) — TestSmells project — official_docs — "A tool to detect test smells in Java projects that utilize JUnit as the testing framework" — verified. Not archived, but the last push was Oct 2022 (stale).
  - [CodeScene Code Health documentation](https://codescene.io/docs/guides/technical/code-health.html) — CodeScene, 2026 — official_docs — "Large Assertion Blocks: ... Blocks of large, consecutive assert statements indicate a missing abstraction"; "Duplicated Assertion Blocks: ... the same assertion block is copy-pasted across a test suite" — verified.
- **Detect:**
  - Java/JUnit: tsDetect.
  - Otherwise manual/grep:
    - Assertion Roulette: tests with more than about 5 asserts lacking messages.
    - Eager Test: tests calling many distinct production methods.
    - Indirect Testing: FooTest mostly exercising Bar.
  - CodeScene flags large and duplicated assertion blocks.
- **Tools:** tsDetect, CodeScene, ripgrep.
- **Applies to:** All test suites; the evidence is Java/JUnit.
- **When not to apply / counterpoints:**
  - Association, not causation.
  - Snapshot or approval tests legitimately contain many assertions.
- **Fix risk:** low

### T27-F21 — Don't aim for a smell-free codebase in one pass: fix Tier-1 hotspots, then install a ratchet on new or changed code
- **Grade:** B · **Verdict:** CORRECTED — the counterpoint citing HN 45640380 was reworded. The comment is about threshold gates prompting "naive copy pasting", not about ratchets or function splitting.
- **Rule:** Install a CI gate that fails when new or changed code adds smells, or when per-rule counts rise. Most smells are born when a file is created and then persist.
- **Rationale:**
  - **Tufano et al.:** 200 projects (Android, Apache, Eclipse) and over half a million commits.
    - Most smell instances were introduced when the artifact was created.
    - 80% survived; over 50% were still alive after 1,000 days and 1,000 commits.
    - Only 9% of removals came from refactoring.
    - 60-66% of smell-introducing commits were enhancements, and over 80% with new features included.
  - **Vendor data:** CodeScene-affiliated studies report non-linear returns on code health, amplified at the top end.
- **Evidence:**
  - [When and Why Your Code Starts to Smell Bad (and Whether the Smells Go Away)](https://fpalomba.github.io/pdf/Journals/J4.pdf) — Tufano, Palomba, Bavota, Oliveto, Di Penta, De Lucia, Poshyvanyk, IEEE TSE 43(11):1063-1088, 2017 — peer_reviewed — "most of the smell instances are introduced when an artifact is created and not as a result of its evolution. At the same time, 80% of smells survive in the system. Also, among the 20% of removed instances, only 9% is removed as a direct consequence of refactoring operations"; "over 50% of smell instances still 'alive' after 1,000 days and 1,000 commits" — verified in the full text.
  - [Code Red: The Business Impact of Code Quality](https://arxiv.org/abs/2203.04374) — Tornhill, Borg (CodeScene), TechDebt 2022 — peer_reviewed — 39 proprietary codebases, 30,737 files: "low quality code contains 15 times more defects than high quality code... resolving issues in low quality code takes on average 124% more time" — verified; vendor-authored.
- **Detect:**
  - Commit baseline per-rule violation counts (tool JSON).
  - In CI, fail if any count increases, or use the analyser's new-code/baseline feature.
  - Gate smell families on files created in the PR.
- **Tools:** SonarQube, PMD, ESLint, Ruff, CodeScene, CI.
- **Applies to:** Projects that will keep being maintained.
- **When not to apply / counterpoints:**
  - Absolute gates can push developers to game metrics. HN 45640380 reports people "solve" threshold violations by "naive copy pasting" that "scatters complexity around".
  - Tufano's data is Java open source only.
- **Fix risk:** low

### T27-F07 — Detect "wrong abstractions" (shared functions that gained flags and caller-specific conditionals); prefer inlining back into callers; don't abstract a duplication with fewer than about 3 real, stable uses
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Practitioner consensus with documented failure cases, plus strong counter-voices. There is no controlled study.
  - Metz: "duplication is far cheaper than the wrong abstraction"; the remedy is to inline and delete the unneeded branches.
  - Abramov's dedup refactor was reverted.
  - Ousterhout defines "conjoined" methods.
  - The "about 3 uses" threshold is a rule of thumb, not sourced.
- **Evidence:**
  - [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) — Sandi Metz, 20 Jan 2016 — engineering_blog — "duplication is far cheaper than the wrong abstraction"; "the fastest way forward is back"; remedy: inline into each caller, then delete the branches each caller doesn't need — verified. HN front-page threads in 2016, 2018 (717 points), 2020 (654), 2023 and 2026 (541) were verified via HN Algolia.
  - [Goodbye, Clean Code](https://overreacted.io/goodbye-clean-code/) — Dan Abramov, 11 Jan 2020 — engineering_blog — "My boss invited me for a one-on-one chat where they politely asked me to revert my change"; "My code traded the ability to change requirements for reduced duplication, and it was not a good trade." — verified.
  - [aposd-vs-clean-code](https://github.com/johnousterhout/aposd-vs-clean-code) — John Ousterhout, Robert C. Martin, discussions Sept 2024 to Feb 2025 — practitioner_forum — "Two methods are entangled (or conjoined in APOSD terminology) if, in order to understand how one of them works internally, you also need to read the code of the other." — verified.
  - [SonarJava SelectorMethodArgumentCheck](https://github.com/SonarSource/sonar-java/blob/master/java-checks/src/main/java/org/sonar/java/checks/SelectorMethodArgumentCheck.java) — SonarSource, 2026 — official_docs — `@Rule(key = "S2301")` — verified.
- **Detect:**
  - SonarJava S2301.
  - Search for call sites passing literal flags: `rg -n '\((.*,\s*)?(true|false|null)\s*[,)]'`, grouped by callee.
  - Look for functions whose body is mostly `if (flag) {...} else {...}` where each caller passes a fixed literal.
  - Use `git log -L :funcName:file` to watch parameters and conditionals accrete.
- **Tools:** SonarQube (S2301), ripgrep, ast-grep, git log -L.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - HN 48620623 (2026): twenty years of seeing small shops turn change into "firefighting all the different versions of the same code".
  - Abstractions with a clear single concept should stay.
  - Inlining increases LOC.
- **Fix risk:** medium

### T27-F09 — Flag fat interfaces/classes whose clients use disjoint subsets of their public methods (ISP violations); split only internal, non-public interfaces during hardening
- **Grade:** C (was B) · **Verdict:** CORRECTED
  - Attribution fixed: the EMSE paper is by **Aiko Fallas Yamashita alone**, EMSE 19(4):1111-1143 (2014 issue; online 2013), not "Yamashita & Moonen EMSE 2013".
  - Grade lowered: both supporting papers analyse the same single dataset (6 developers, 4 systems, 12 smells), so this is one study.
- **Rationale:**
  - **Yamashita.** In a controlled study with professional developers, ISP violation had the strongest link to observed maintenance problems, especially change propagation.
  - **Soh 2016 re-analysis.** On the same data, ISP violation affects editing, navigating and reading effort.
- **Evidence:**
  - [Assessing the capability of code smells to explain maintenance problems: an empirical study combining quantitative and qualitative data](https://link.springer.com/article/10.1007/s10664-013-9250-3) — Aiko Fallas Yamashita, EMSE 19(4):1111-1143, 2014 (online 2013) — peer_reviewed — "violation of the Interface Segregation Principle (a.k.a. ISP violation) displayed the strongest connection with maintenance problems"; "severe instances of problems relating to change propagation were associated with ISP violation"; "we recommend that code with ISP violation should be considered potentially problematic and be prioritized for refactoring" — abstract verified on the Springer page; authorship confirmed via OpenAlex and Semantic Scholar.
  - [Do Code Smells Impact the Effort of Different Maintenance Programming Activities?](https://ir.cwi.nl/pub/25393/Soh-SANER16_Smells-Effort.pdf) — Soh, Yamashita, Khomh, Guéhéneuc, SANER 2016 — peer_reviewed — "Editing, navigating, and reading effort are affected by three smells: 'Feature Envy', 'God Class', and 'ISP Violation'." — verified in the full text; same dataset.
- **Detect:**
  - Start from types with many public methods: Pylint max-public-methods 20 (R0904); PMD TooManyMethods maxmethods 10.
  - List callers with "find usages" or a call graph and record the methods each caller uses.
  - Flag when callers form 2 or more clusters with little overlap.
  - Related (not identical): DesigniteJava Multifaceted Abstraction / Insufficient Modularization.
- **Tools:** Pylint, PMD, DesigniteJava, IDE find-usages.
- **Applies to:** Statically typed OO code and module APIs.
- **When not to apply / counterpoints:**
  - One dataset of 4 functionally equivalent Java systems.
  - Splitting public interfaces is a breaking API change.
  - Facades are intentionally broad.
- **Fix risk:** high

### T27-F10 — Report long message chains (more than 3 navigations through different objects) in hotspots and consider Hide Delegate; exclude fluent APIs, builders, streams, query builders and optional chaining over plain data
- **Grade:** C (was B) · **Verdict:** CORRECTED
  - The claim that Message Chain removal had "one of the few non-limited fault effects (Palomba 2018)" is false. Palomba 2018 Table 10 rates its removal effect on fault-proneness as **Limited** and on change-proneness as **Medium**; only Inappropriate Intimacy and Feature Envy are "Medium" for faults.
  - What remains is an association: "high fault-proneness is particularly evident for smells such as Message Chain", with mixed Hall results. Grade lowered accordingly.
- **Rationale:**
  - **Rare.** Message Chain appears in 13% of releases.
  - **Associated with faults.** Palomba 2018 RQ2 reports "particularly evident" high fault-proneness. Palomba notes that Khomh 2012 found it had the highest correlation with fault-proneness.
  - **Mixed across systems (Hall 2014).** It increased faults in 2 of 3 systems, but chains in larger files reduced faults.
- **Evidence:**
  - [On the diffuseness and the impact on maintainability of code smells](https://link.springer.com/article/10.1007/s10664-017-9535-z) — Palomba et al., EMSE 2018 — peer_reviewed — "It affects 13% of the analyzed releases"; "high fault-proneness is particularly evident for smells such as Message Chain that are not highly diffused"; candidate rule "All chains of methods' calls longer than three"; Table 10 removal effect: change Medium, fault Limited — verified in the full text.
  - [Some Code Smells Have a Significant but Small Effect on Faults](https://doi.org/10.1145/2629648) — Hall et al., TOSEM 2014 — peer_reviewed — "Message Chains increased faults in two systems; Message Chains which occurred in larger files reduced faults" — verified.
- **Detect:**
  - PMD LawOfDemeter: default trustRadius 1. The docs warn it is "prone to many false-positives".
  - Regex first pass: `rg -n '(\.[A-Za-z_]\w*\([^()]*\)){4,}'`, then drop fluent/builder/stream/ORM chains. Keep `a.getB().getC().getD()` across different domain types.
- **Tools:** PMD, ripgrep, ast-grep.
- **Applies to:** OO and module code.
- **When not to apply / counterpoints:**
  - Hide Delegate adds forwarding methods, which can create the Middle Man smell.
  - DTOs and config trees are naturally navigated.
- **Fix risk:** low

### T27-F13 — When fixing a long or complex method: flatten nesting first, extract only blocks with a nameable intent, then inline back any extraction that is conjoined with its caller
- **Grade:** C · **Verdict:** VERIFIED
- **Rule:**
  - (a) Flatten nesting first: guard clauses, early returns.
  - (b) Extract only blocks that have a nameable intent ("what", not "how").
  - (c) After extraction, check that no new function can only be understood by reading its caller (conjoined), and that the parent still reads linearly. Inline back any extraction that fails this check.
- **Rationale:**
  - Fowler's criterion is separation of intention from implementation, not line count.
  - Ousterhout's critique ("8 teeny-tiny methods") and Martin's concession that extractions "can always be inlined" show that mechanical splitting can hurt.
  - Tufano found about 400 refactorings that introduced new smells.
  - CodeScene flags Bumpy Road and Nested Complexity separately.
  - There is no controlled evidence on which side is right.
- **Evidence:**
  - [FunctionLength](https://martinfowler.com/bliki/FunctionLength.html) — Martin Fowler, 2016 — engineering_blog — "If you have to spend effort into looking at a fragment of code to figure out what it's doing, then you should extract it into a function and name the function after that 'what'." — verified.
  - [CodeSmell](https://martinfowler.com/bliki/CodeSmell.html) — Martin Fowler, 9 Feb 2006 — engineering_blog — "smells don't always indicate a problem. Some long methods are just fine." — verified.
  - [aposd-vs-clean-code](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout, Martin, 2024-2025 — practitioner_forum — "The code is chopped up so much (8 teeny-tiny methods) that it's difficult to read"; "They can always be inlined if we judge them to have gone too far"; "if I must err, I'd rather err on the side of decomposition" — verified.
  - [When and Why Your Code Starts to Smell Bad](https://fpalomba.github.io/pdf/Journals/J4.pdf) — Tufano et al., TSE 2017 — peer_reviewed — "refactoring can sometimes lead to unexpected side effects; besides the risk of introducing faults, when performing refactoring operations, there is also the risk of introducing design problems" (394 cases) — verified in the full text.
  - [CodeScene Code Health documentation](https://codescene.io/docs/guides/technical/code-health.html) — CodeScene, 2026 — official_docs — Bumpy Road "fails to encapsulate its responsibilities, leading to code containing multiple logical chunks of logic"; Nested Complexity "significantly increases the risk for defects" — verified. The latter is a vendor assertion.
- **Detect:**
  - Nesting: ESLint max-depth 4, SonarJava S134 3, Pylint max-nested-blocks 5, PMD AvoidDeeplyNestedIfStmts 3.
  - Post-refactor checklist:
    - every new function has a "what" name;
    - no new function takes more than about 4 parameters threaded only from the caller;
    - no new function needs the caller's locals or ordering assumptions to be understood;
    - total cognitive complexity of parent plus children did not increase.
- **Tools:** ESLint, SonarQube, Pylint, PMD, CodeScene.
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - Martin prefers erring towards decomposition.
  - HN 45642644: smaller scopes are easier to review for some teams.
  - This is a matter of style.
- **Fix risk:** medium

### T27-F14 — Before "fixing" any smell, check for intent markers and code that is complex by nature; record them as accepted exceptions
- **Grade:** C · **Verdict:** VERIFIED (attribution note added)
- **Rule:** Do not simplify:
  - code annotated as intentionally verbose or branchy;
  - generated code;
  - code whose complexity mirrors the domain (parsers, protocol and state machines, kernel dispatch).
- **Rationale:**
  - Kubernetes' PV controller carries "PLEASE DO NOT ATTEMPT TO SIMPLIFY THIS CODE" and explains why ("space shuttle style"). The HN thread had 1,552 points.
  - Palomba 2014 notes, citing Jbara, Matan & Feitelson (ICPC 2012), that some Linux kernel files have intrinsically high cyclomatic complexity that developers don't consider a problem.
  - Olbrich 2010 and Kapser & Godfrey 2008 show that "smelly" structures can be efficient or principled.
- **Evidence:**
  - [pv_controller.go](https://github.com/kubernetes/kubernetes/blob/ec2e767e59395376fa191d7c56a74f53936b7653/pkg/controller/volume/persistentvolume/pv_controller.go) — Kubernetes project (commit ec2e767; HN thread Dec 2018) — other — "PLEASE DO NOT ATTEMPT TO SIMPLIFY THIS CODE. KEEP THE SPACE SHUTTLE FLYING."; "we needed to ensure that every single condition was handled and accounted for in the code, even if it resulted in no-op code branches" — verified in the raw source.
  - [Do They Really Smell Bad?](https://fpalomba.github.io/pdf/Conferencs/C3.pdf) — Palomba et al., ICSME 2014 — peer_reviewed — "a recent study found that some source code files of the Linux Kernel intrinsically have high cyclomatic complexity. However, this is not considered a design or implementation problem by developers [10]" — verified; [10] is Jbara et al., ICPC 2012 (secondary).
  - [Are all code smells harmful? A study of God Classes and Brain Classes in the evolution of three open source systems](https://doi.org/10.1109/icsm.2010.5609564) — Olbrich, Cruzes, Sjøberg, ICSM 2010 — peer_reviewed — "when we normalized the measured effects with respect to size, then God and Brain Classes were less subject to change and had fewer defects than other classes... such classes may be an efficient way of organizing code" — abstract verified.
- **Detect:**
  - Intent markers and suppressions: `rg -n -i 'do not (attempt to )?simplify|intentional(ly)?|keep in sync|space shuttle|NOSONAR|eslint-disable|noqa|pylint: ?disable|@SuppressWarnings|nolint|#\[allow\('`.
  - Generated files: `rg -l -i '@generated|do not edit|auto-generated|autogenerated'`.
  - Exclude vendored and third-party directories.
  - Read the introducing commit with `git log -S'<marker>'`.
- **Tools:** ripgrep, git log -S.
- **Applies to:** All codebases.
- **When not to apply / counterpoints:**
  - A suppression with no justification can be re-examined.
- **Fix risk:** high (if ignored)

### T27-F20 — When an AI agent reviews smells: use deterministic tools for structural smells, require concrete evidence for context-dependent ones, never accept an LLM verdict alone
- **Grade:** C (was B) · **Verdict:** CORRECTED
  - Refused Bequest LLM precision is 0.10-0.40, not 0.10-0.50.
  - Removed the inference that "the agent that wrote the code is a weak judge of it". 2510.03029 measures smell counts in generated Java code from older models (Gemini Pro, ChatGPT, Codex, Falcon), not self-review accuracy.
  - Grade lowered because both sources are unrefereed preprints with model-specific results.
- **Rule:**
  - Structural smells (Long Method, Large/God Class, Data Class, duplication, complexity): use deterministic tools.
  - Context-dependent smells (Feature Envy, Refused Bequest, Shotgun Surgery, ISP violation): require concrete, cited evidence such as call counts, usage clusters or git history before acting.
- **Rationale:**
  - **Detection quality (76-developer ground truth, 30 Java projects).**
    - LLMs did well on structurally simple smells (Large Class, Long Method).
    - They did poorly on context-dependent ones: Refused Bequest F1 below 0.40 for all models; Feature Envy F1 from 0.11 to 0.71 depending on the model.
    - The combined LLM+tool strategy raised F1 for five of nine smells but produced more false positives on complex smells.
    - Static tools kept the advantage for Dispersed Coupling, Long Parameter List, Refused Bequest and Shotgun Surgery.
  - **Generated code (separate preprint).** LLM-generated Java had on average 63.34% more smells than reference solutions.
- **Evidence:**
  - [Beyond Strict Rules: Assessing the Effectiveness of Large Language Models for Code Smell Detection](https://arxiv.org/abs/2601.09873) — Souza, Santana, Figueiredo, Muzetti, Montandon, Briand, 2026 — preprint — "LLMs perform strongly for structurally straightforward smells, such as Large Class and Long Method"; combined strategy "generates more false positives for complex smells"; Table 6 values as above — verified in the full text. Models: DeepSeek-R1, GPT-5 mini, Llama-3.3, Qwen2.5-Coder.
  - [Investigating The Smells of LLM Generated Code](https://arxiv.org/abs/2510.03029) — Paul, Zhu, Bayley, 2025 — preprint — "The average smell increase across all LLMs was 63.34%, comprising 73.35% for implementation smells and 21.42% for design smells" — abstract verified.
- **Detect:**
  - Pipeline: tool output → evidence table per candidate (metric values, caller/callee counts, co-change from git, a human-readable reason) → drop candidates with no measurable evidence.
  - Shotgun Surgery / co-change: `git log --format=%H --name-only`, count file-pair co-occurrences, or use CodeScene change coupling.
- **Tools:** PMD, SonarQube, ESLint, Ruff, jscpd, git, CodeScene.
- **Applies to:** AI-agent-driven review and hardening.
- **When not to apply / counterpoints:**
  - Both are preprints; results vary strongly by model and will shift.
  - For Feature Envy, one LLM (Llama-3.3) beat the static tools.
- **Fix risk:** low

## Practitioner voice

- [HN 45640380 — SonarQube thresholds and copy-paste "fixes"](https://news.ycombinator.com/item?id=45640380) — Oct 2025.
  - With low thresholds, LoC and SonarQube "cognitive complexity" "lit up in red large percentage of otherwise correct code".
  - People "solve" them by "naive copy pasting which doesn't reduce any cognitive load - it just scatters complexity around".
  - Its side claim that `?.` and `??` are counted is not supported by SonarJS source, either current or from September 2025.
- [HN 45641469 — call graph over function length](https://news.ycombinator.com/item?id=45641469) — Oct 2025. The priorities are a simple call graph and fitting data structures, with function length "a distant third". Interpreter-like loops and imperative business logic suit long functions, and splitting makes the code non-linear.
- [HN 48620623 — duplication as firefighting](https://news.ycombinator.com/item?id=48620623) — Jun 2026, in the 541-point thread on Metz's post. Twenty years of small shops tying "themselves in knots" with duplication, turning change into "firefighting all the different versions of the same code". Example: a duplicated query that broke on the MySQL 4→5 upgrade in hundreds of places.
- [HN 48620737 — LLM code silently not reused](https://news.ycombinator.com/item?id=48620737) — Jun 2026. In LLM-heavy code the writer expected a change to propagate through shared code, "only to find it wasn't". Duplicates silently diverge.
- [Goodbye, Clean Code](https://overreacted.io/goodbye-clean-code/) — Dan Abramov, 2020. His dedup of a colleague's shape-resize handle code was reverted at his boss's request: "not a good trade".
- [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) — Sandi Metz, 2016. Abstractions accrete parameters and conditionals; inline back into callers. HN front page in 2016, 2018, 2020, 2023 and 2026 (verified via Algolia).
- [Kubernetes pv_controller.go](https://github.com/kubernetes/kubernetes/blob/ec2e767e59395376fa191d7c56a74f53936b7653/pkg/controller/volume/persistentvolume/pv_controller.go) — deliberately "space shuttle style": every condition is handled, even as no-op branches, and the file says "PLEASE DO NOT ATTEMPT TO SIMPLIFY THIS CODE". Discussed at [HN 18772873](https://news.ycombinator.com/item?id=18772873) (1,552 points, Dec 2018).
- [HN 33234504 — decomposition that limited blast radius](https://news.ycombinator.com/item?id=33234504) — Oct 2022. Splitting a payments flow into per-state classes meant a later bad diff would have broken one state instead of the whole flow.
- [HN 30461175 — friction from a complexity rule](https://news.ycombinator.com/item?id=30461175) — Feb 2022. A general remark, not a first-person anecdote: introduce a deliberate extra scope and "you get dinged by static analysis tools like SonarQube" for "cognitive complexity", and then "have to explain it to a team leader who might not understand why you did that".
- [SE answer 178319 — arguing against God objects](https://softwareengineering.stackexchange.com/a/178319) — top-voted (57), not accepted, on "How do I prove or disprove 'God objects' are wrong?". Argue from concrete pain points; "working code trumps any arguments about theory or good design"; refactor along a narrow "tracer-bullet style" path.
- [Clean Code, Horrible Performance](https://www.computerenhance.com/p/clean-code-horrible-performance) — Casey Muratori, Feb 2023. A switch was about 1.5x faster than polymorphism (about 35 → 24 cycles per shape) and a table-driven version about 10x faster. A reason not to apply "replace conditional with polymorphism" by reflex.
- [aposd-vs-clean-code](https://github.com/johnousterhout/aposd-vs-clean-code) — Ousterhout vs Martin, Sept 2024 to Feb 2025. Ousterhout shows Clean Code's PrimeGenerator split into "8 teeny-tiny methods"; Martin concedes that extractions "can always be inlined if we judge them to have gone too far".

## Contradictions and open questions

**Contradictions**

- **Size confound.**
  - Khomh 2012: "size alone cannot explain" the higher odds.
  - Palomba 2018: the change-proneness association survives logistic control and a size-stratified re-run, but for faults only the smell×size interaction is significant.
  - Sjøberg 2013: none of 12 smells significant after adjusting for size and changes.
  - Olbrich 2010: God/Brain Classes *less* change- and defect-prone once normalised by size.
- **Causality of faults.**
  - More fault-prone: Palomba RQ2 and Khomh 2012 (association).
  - No substantial within-class fault difference: Palomba RQ3.
  - No difference between clean and dirty classes: Lenarduzzi JSS 2020.
  - Effects under 10% and sometimes negative: Hall 2014.
- **Duplicated code.**
  - Harmful: Juergens 2009 (inconsistent clones fault-prone); Lenarduzzi 2020 (duplicated-code violations always faulty in a 10-instance sample).
  - Not harmful: Rahman et al. 2012 (clones possibly *less* defect-prone); Kapser & Godfrey 2008 (up to 71% of clones positive).
  - Practitioners split between Metz/Abramov and HN 48620623.
- **Inappropriate Intimacy and Speculative Generality.**
  - Not perceived as problems (Palomba 2014).
  - Speculative Generality reduced faults in Eclipse (Hall 2014).
  - Yet Palomba 2018 Table 10 ranks removing Inappropriate Intimacy first (High change, Medium fault benefit) and Speculative Generality High for change.
  - This dossier therefore moves both to Tier 2 instead of report-only.
- **Refused Bequest.**
  - Decreased effort: Sjøberg 2013.
  - Removal lowers change-proneness (43 → 26): Palomba 2018.
  - Only the severe instance recognised: Palomba 2014.
- **Long Parameter List.**
  - Not a problem for Java developers: Palomba 2014. Limited removal effect: Palomba 2018.
  - Serious for 1,484 JS developers: Saboury 2017.
- **Message Chain.**
  - Highest correlation with faults: Khomh 2012 (as cited by Palomba). "Particularly evident" fault-proneness: Palomba RQ2.
  - Limited fault effect when removed: Palomba Table 10.
  - Mixed by system and file size: Hall 2014.
- **Method length.**
  - Functions over "half-a-dozen lines" smell: Fowler. Err towards decomposition: Martin.
  - Over-decomposition creates conjoined, non-linear code: Ousterhout and several HN practitioners.
  - Tool defaults range from 50 to 75 lines.
- **Cognitive Complexity.**
  - Validated against comprehension time and ratings, mixed for correctness: Muñoz Barón 2020.
  - Practitioners criticise the naive fixes it induces.
  - A claimed TS/JSX over-count is not borne out by SonarJS source, current or September 2025.
- **Tool trust.**
  - CodeScene-affiliated studies (Code Red 2022, Ghost Echoes 2024, Increasing-not-Diminishing 2024, AI-friendliness 2026) report strong Code Health links and SonarQube false positives, and are vendor-authored.
  - Ghost Echoes argues that SonarQube-based results, including Lenarduzzi's, may be invalid.
  - Lenarduzzi's negative results rest on SonarQube output plus SZZ.

**Open questions**

- **Language coverage.** Almost all smell-harm evidence is from Java open-source projects (Apache, Eclipse, ArgoUML, Android; 2000s-2010s). The only non-Java study is Saboury 2017 (five Node.js projects); Juergens includes C# and Cobol for clones only. Transferring the tiers to TypeScript, Python, Go, Rust or C# is extrapolation.
- **No causal evidence.** No randomised or causal study shows that removing a given smell reduces defects. The demonstrated benefit is lower change-proneness in the same class.
- **Thresholds are uncalibrated.** Method length, parameters and complexity have no per-language empirical calibration; tool defaults differ without documented rationale.
- **AI-written code is unstudied.** The only data points are preprints on older models. Whether classic smell-harm results hold for AI-written code is unknown.
- **Sources read only in part:**
  - Khomh 2012, Sjøberg 2013, Rahman 2012, Kapser 2008, Yamashita EMSE 2014, Olbrich 2010, Romano 2018, Nagappan 2005, Rachatasumrit 2012, Bavota 2012, Saboury 2017 and Spadini 2018: abstracts only.
  - Lanza & Marinescu: only through PMD's source.
  - D'Ambros et al. 2010 (Feature Envy / Shotgun Surgery vs defects, "no consistent correlation" per Tufano's related work): not accessed.
- **Coverage gaps.**
  - Reddit was not accessible.
  - Shotgun Surgery / change coupling has no accessible quantitative harm study here; its placement rests on detection feasibility.

## Dropped findings

None. All 21 findings trace to real sources that support the core claim; nine needed corrections (see verdicts above).
