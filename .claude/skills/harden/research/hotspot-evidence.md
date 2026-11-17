# Independent evidence for churn × complexity hotspot ranking, and how to rank when history is thin, squashed or agent-generated
> Code G104 · slug hotspot-evidence · verified 2026-09-23 · counts: verified 9 / corrected 10 / downgraded 2 / dropped 0

## Summary

**How this was checked.** The verifier re-downloaded every cited paper (curl + pdftotext) or opened it with WebFetch. Metadata came from the arXiv and Crossref APIs, the GitHub API and the Hacker News API. WebSearch was exhausted in this session too, so no verdict rests on it. One source the researcher could not open, Rahman & Devanbu (ICSE 2013), was retrieved from the Wayback Machine and is now verified first-hand.

**Verdict, corrected.**
- Independent evidence supports "change history beats static code metrics" for defect prediction:
  - Rahman & Devanbu 2013: 85 releases, 12 projects.
  - Kamei et al. 2010: Eclipse, effort-aware.
  - Majumder et al. 2022: 700 GitHub projects.
- Adding code metrics to history metrics brought no significant gain in Majumder et al. and in the text of Kamei et al. 2010. Majumder's own tally of Kamei's tables finds the combination better in 5 of 9 versions, so "adds nothing" means "no reliable gain", not "never helps".
- D'Ambros et al. 2012 does **not** show that history beats code metrics:
  - For classification, product metrics (CK+OO) performed "very well" alongside process metrics.
  - For ranking, the best approaches were decayed *churn of source-code metrics*, which are history × code-metric hybrids.
- None of these studies tests the churn × complexity product itself. The only sources that promote it come from the CodeScene vendor. The book (*Your Code as a Crime Scene*) advocates it. Code Red does not test it: it tests CodeScene's "Code Health" score against defects and time.
- **Key correction:** the evidence is for *multi-metric learned models*, not for a simple count score. D'Ambros benchmarked exactly the score the researcher proposed, number of revisions + number of fixes (NFIX+NR). It ranked about 19.8 of 25 approaches on popt: weak, and only just above lines of code alone (LOC 21.4). Only the fixes-only score (NFIX-ONLY, 23.8) ranked below LOC. (An earlier version of this dossier gave LOC as 13.8, which is the OO row's value, and so wrongly claimed all three cheap scores lose to LOC; corrected by the citation audit.) A cheap history score is therefore a convention with no evidence that it beats size by much. It must beat size on the repo itself in a backtest before it is trusted.
- At file level, summed cyclomatic complexity (CC) mostly tracks size:
  - Landman et al.: after log transform, file-level R² is 0.87 (Java) and 0.84 (C).
  - At method level, CC is not redundant with size.
- Size-descending order (ManualDown) is the recommended simple baseline (Zhou et al., TOSEM 2018).
- Smallest-first orderings win LOC-normalised recall only by inspecting 2–3× more *changes* (Huang, Xia & Lo). That study is at change level, not file level.

**Ranking recipe (corrected).**
1. **Noise filters, applied first:**
   - `--no-merges --first-parent`.
   - Rename detection (`-M`, default 50% similarity), with renames folded into the current path.
   - `-w --ignore-blank-lines`, except for languages where indentation matters. Verified on git 2.51.1: this drops whitespace-only commits from `--numstat`.
   - Skip the SHAs in `.git-blame-ignore-revs`. Extract 40-hex SHAs first; a blank line in the pattern file makes `grep -v -F -f` drop everything.
   - Exclude generated, vendored, lock, minified and snapshot paths with `:(exclude,glob)` pathspecs. The researcher's plain `':(exclude)**/*.lock'` does **not** exclude top-level lockfiles (verified).
   - Bulk commits (files touched above the repo's 99th percentile) count as one change event with zero line churn. Exclude them from coupling analysis and list them for review.
   - Count squash commits as one event each.
   - After agent config files first appear, count change events rather than lines.
2. **History-sufficiency gate (convention, grade C).** Pass only if all three hold after filtering:
   - ≥150 commits;
   - ≥4 months of history, ≥6 preferred;
   - enough fix-labelled commits (~25 is an analogy, not a validated number).

   These numbers come from ≥1000-star OSS projects that trained commit-level classifiers. Kalliamvakou et al. (2014 data) found the median GitHub project had 6 commits.
3. **Primary ranking when the gate passes:**
   - Score files by recency-weighted change events plus recency-weighted fix commits (a convention; Google's TWR decays bug-fix commits only).
   - Pick refactoring targets inside files by function-level complexity and length.
   - Give each item a visible reason and one action.
   - Backtest against ManualDown (G104-F19). This step is **mandatory**, not optional: in D'Ambros, cheap history scores rank no better than size (NR 19 and NFIX+NR 19.8 just above LOC's 21.4, NFIX-ONLY 23.8 below it), so nothing shows they beat size on a given repo. The mandatory backtest is a convention built on that weakness, not on a proven loss to size.
4. **Fallback ladder when the gate or the backtest fails** (the order is a convention):
   - consequence classes (NIST SSDF PW.1.1);
   - attack surface / entry points;
   - high-precision static findings;
   - largest or most complex functions;
   - uncovered error-handling branches;
   - fan-in as a tie-breaker;
   - surviving change counts.
5. **Security stays consequence-ranked.**
   - Vulnerability prediction models degrade sharply under realistic labelling: MCC 0.77→0.08 on Linux (Jimenez et al.).
   - Microsoft's file-level models reach precision <0.5 and recall <0.2 (Morrison et al.).
   - Churn is only a secondary flag inside the security set. Vulnerability-contributing commits carry more than 2× churn (Meneely et al.).

**Disposition of earlier rules (unchanged in direction, corrected in wording):**
- T03-F09, T25-F10 and T19-F14: amend to a history-first ranking behind a gate and a mandatory backtest against size. Complexity stays the within-file selector. The churn × complexity product stays at grade C, and D'Ambros's hybrid result is noted as a counterpoint.
- T19-F04 ('>30 files'): amend to a repo-relative bulk filter. The 30 matches ROSE's cut-off, but Code Maat does not document where its default comes from.
- T19-F09: keep.

## Findings

### G104-F13 — Keep security work ranked by consequence; use churn and complexity only to order work inside the security-relevant set, never to exclude a file
- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Vulnerability prediction from churn, complexity and developer metrics looks strong in retrospective studies but degrades under realistic conditions. At Microsoft it was not adopted.
  - Shin et al. (Firefox, RHEL kernel): over 80% of vulnerable files found, with under 25% false positives.
  - Zimmermann et al. (Vista): code metrics give high precision but low recall, median ≈0.2 (dependencies: 0.40).
  - Morrison et al. (Windows): file-level precision <0.5 and recall <0.2. Microsoft teams adopted defect models but not vulnerability models.
  - Jimenez et al.: with realistic labelling, MCC drops 0.77/0.65/0.43 → 0.08/0.22/0.10 (Linux, OpenSSL, Wireshark).
  - Meneely et al.: vulnerability-contributing commits (VCCs) carry more than twice the churn of other commits. This supports churn as a secondary flag inside the security set, not as a selector.
- **Evidence:**
  - [Evaluating Complexity, Code Churn, and Developer Activity Metrics as Indicators of Software Vulnerabilities](https://www.se.rit.edu/~andy/pubs) — Shin, Meneely, Williams, Osborne, IEEE TSE 2011 — peer_reviewed — "predicted over 80 percent of the known vulnerable files with less than 25 percent false positives for both projects" — verified on co-author Meneely's publication page (abstract).
  - [Searching for a Needle in a Haystack: Predicting Security Vulnerabilities for Windows Vista](https://thomas-zimmermann.com/publications/files/zimmermann-icst-2010.pdf) — Zimmermann, Nagappan, Williams, ICST 2010 — peer_reviewed — "high precision but low recall values"; "median is now 0.40 (compared to 0.2 for metrics)" — verified in PDF.
  - [Challenges with applying vulnerability prediction models](https://www.microsoft.com/en-us/research/publication/challenges-with-applying-vulnerability-prediction-models/) — Morrison, Herzig, Murphy, Williams, HotSoS 2015 (DOI 10.1145/2746194.2746198) — peer_reviewed — "Our source file level models yield precision below 0.5 and recall below 0.2"; binary level ~0.75 precision / ~0.2 recall — verified on the MSR abstract page. The page lists only the Microsoft authors; Crossref confirms all four.
  - [The Importance of Accounting for Real-World Labelling When Predicting Software Vulnerabilities](https://orbilu.uni.lu/bitstream/10993/40076/1/sample-sigconf%20%283%29.pdf) — Jimenez, Rwemalika, Papadakis, Sarro, Le Traon, Harman, ESEC/FSE 2019 — peer_reviewed — "drop from 0.77, 0.65 and 0.43 to 0.08, 0.22, 0.10 for Linux Kernel, OpenSSL and Wiresark" — verified in PDF ("Wiresark" is the paper's own typo).
  - [When a patch goes bad: Exploring the properties of vulnerability-contributing commits](https://www.se.rit.edu/~andy/pubs) — Meneely et al., ESEM 2013 — peer_reviewed — 124 VCCs for 68 Apache HTTPD vulnerabilities; "more than twice as much code churn on average than non-VCCs, even when normalized against lines of code" — verified on the author page (abstract).
- **Detect:**
  1. Build the security set from T1/T2 of G104-F12.
  2. List the heaviest-churn commits inside it:
     ```
     git log --no-merges --numstat --format='@@%h %s' -- <security paths> | awk -F'\t' '/^@@/{if(h!="")print s, h; h=$0; s=0; next} NF==3{s+=$1+$2} END{if(h!="")print s, h}' | sort -rn | head
     ```
  3. Re-review the top commits in full.
- **Tools:** git, awk, semgrep, codeql
- **Applies to:** All security hardening work, whatever the history sufficiency.
- **When not to apply / counterpoints:**
  - Shin et al.'s retrospective results are positive.
  - Theisen et al. show models improve on an approximated attack surface: file precision 0.5→0.69, but recall only 0.02→0.05.
  - Pure consequence lists can miss vulnerabilities in utility code (parsers, deserialisers). Input parsing belongs in T1.
  - The A grade covers the negative claim (metric-based vulnerability selection is unreliable). The consequence-first ordering itself rests on NIST SSDF, a standard, not an experiment.
- **Fix risk:** low

### G104-F08 — Treat fix-keyword counts as a noisy, weak signal; read the recent fix commits before calling a file a bug hotspot
- **Grade:** A · **Verdict:** CORRECTED (tangling figure qualified: 17–32% of *all* changes in bug-fixing commits fix the bug, but 66–87% when only production-code files are counted. Herzig 2013 concerns issue-report misclassification, not commit keywords.)
- **Rationale:** Independent studies agree that defect labels are noisy.
  - Herzig, Just & Zeller: 33.8% of issue reports misclassified; on average 39% of files marked defective never had a bug.
  - Herzig & Zeller: up to 15% of bug fixes are tangled. Between 6% and 50% of the files ranked most defect-prone do not belong there.
  - Herbold et al. (398 releases, 38 Apache projects): "only half of the bug fixing commits determined by SZZ are actually bug fixing".
  - Herbold et al., tangling: 17–32% of all changes in bug-fixing commits address the bug, 66–87% for production-code files only. 3–47% of data is noisy without manual untangling.

  Solo repos usually lack an issue tracker, so commit-message keywords are the only label and cannot be cross-checked.
- **Evidence:**
  - [It's Not a Bug, It's a Feature: How Misclassification Impacts Bug Prediction](https://www.st.cs.uni-saarland.de/publications/files/herzig-icse-2013.pdf) — Herzig, Just, Zeller, ICSE 2013 — peer_reviewed — "33.8% of all bug reports to be misclassified"; "On average, 39% of files marked as defective actually never had a bug." — verified in PDF.
  - [The Impact of Tangled Code Changes](https://www.st.cs.uni-saarland.de/publications/files/herzig-msr-2013.pdf) — Herzig, Zeller, MSR 2013 — peer_reviewed — "up to 15% of all bug fixes to consist of multiple tangled changes"; "between 6% and 50% (harmonic mean: 17.4%)" — verified in PDF.
  - [Problems with SZZ and Features](https://arxiv.org/abs/1911.08938) — Herbold, Trautsch, Trautsch, Ledel, EMSE (DOI 10.1007/s10664-021-10092-4) — peer_reviewed — "only half of the bug fixing commits determined by SZZ are actually bug fixing"; "the difference of using more features is not significant" — verified in the arXiv abstract.
  - [A Fine-grained Data Set and Analysis of Tangling in Bug Fixing Commits](https://arxiv.org/abs/2011.06244) — Herbold et al., accepted at EMSE — peer_reviewed — "between 17% and 32% of all changes in bug fixing commits modify the source code to fix the underlying problem. However, when we only consider changes to the production code files this ratio increases to 66% to 87%" — verified in the arXiv abstract.
- **Detect:** Use a broader fix regex than the researcher's. Theirs missed "fixing" and "bugs"; verified on a test repo.
  ```
  git log --no-merges -i -E --grep='(^|[^[:alpha:]])(fix(e[sd]|ing)?|bugs?|hotfix|regression)([^[:alpha:]]|$)' --format='%h %cs %s' -- <file> | head -5
  ```
  For each hit, run `git show --stat <sha>` and check whether it touches unrelated files or mixes a refactor into the fix. If the repo consistently uses Conventional Commits, a leading `fix:` or `fix(scope):` is a cleaner label (convention).
- **Tools:** git
- **Applies to:** All repos, especially solo repos with no issue tracker.
- **When not to apply / counterpoints:**
  - Herbold et al. found label noise, not feature choice, to be the main threat, so a simple feature set is fine.
  - Manual reading costs agent budget: cap it at the top 10 files.
- **Fix risk:** low

### G104-F01 — Rank by filtered, recency-weighted change history, not by churn × complexity, and only after it beats size in a backtest
- **Grade:** B (A for "history signals beat static code metrics as model inputs"; C for the specific count score) · **Verdict:** CORRECTED (grade A→B). (audit correction: in D'Ambros Table 6, LOC's popt average rank is 21.4, not 13.8, which is OO's; so NR (19) and NFIX+NR (19.8) rank just above LOC and only NFIX-ONLY (23.8) ranks below it; the popt top performers are LDCHU and LGDHH, tied at 5.2.) Changes:
  - (a) D'Ambros benchmarked the proposed score (NFIX+NR) and it ranked poorly (19.8), only just above LOC (21.4). D'Ambros also found product metrics comparable for classification, and history × code-metric hybrids best for ranking.
  - (b) The "5 of 9 versions" counterpoint is Majumder's reading of the *same* Kamei 2010 paper.
  - (c) Google's TWR decays bug-fix commits only; it is not "changes + fixes".
  - (d) Rahman & Devanbu 2013 retrieved and verified.
  - (e) Code Red tests Code Health, not churn × complexity.
  - (f) Kamei's 74% is "up to" (best model, random forest).
  - (g) The detection pipeline was fixed: renames were dropped, and top-level lockfiles were not excluded.
- **Rationale:** Three independent groups found that change-history metrics beat static code metrics:
  - Rahman & Devanbu, 85 releases of 12 projects: code metrics "generally less useful than process metrics".
  - Kamei et al., Eclipse, effort-aware: up to 74% vs 29% of faults at 20% effort (random forest). Combining both "does not lead to an improved performance".
  - Majumder et al., 700 projects: median recall 98% vs 44%, AUC 95% vs 54%. No case where process + product beat process alone.

  This supports history as the primary signal and gives no evidence that multiplying by complexity helps.

  The same literature also warns against the cheap score the researcher proposed:
  - D'Ambros et al. benchmarked NR (revisions), NFIX-ONLY (fixes) and NFIX+NR (fixes + revisions). All three ranked near the bottom (popt average ranks 19, 23.8 and 19.8 of 25). LOC ranked 21.4, so NR and NFIX+NR sit just above LOC and only NFIX-ONLY sits below it. They are weak, not proven worse than size.
  - D'Ambros's best ranking approaches were *decayed churn of source-code metrics*, which combine history with code metrics: on popt, LDCHU and LGDHH tied at 5.2, with LGDCHU at 5.8.

  So: use history first, keep complexity for the within-file choice, and treat the count score as a convention that must pass G104-F19.
- **Evidence:**
  - [How, and Why, Process Metrics are Better](http://web.archive.org/web/20160304095207/http://macbeth.cs.ucdavis.edu/process-metrics-better.pdf) — Rahman, Devanbu, ICSE 2013 (DOI 10.1109/ICSE.2013.6606589) — peer_reviewed — "code metrics, despite widespread use in the defect prediction literature, are generally less useful than process metrics for prediction"; code metrics "have high stasis", so "the same files being repeatedly predicted as defective" — verified in the Wayback copy (the original host is offline).
  - [Revisiting Common Bug Prediction Findings Using Effort-Aware Models](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Kamei_ICSM2010.pdf) — Kamei, Matsumoto, Monden, Matsumoto, Adams, Hassan, ICSM 2010 — peer_reviewed — "detect 29% of all faults using product metrics and 74% of all faults using process metrics" ("up to 74%" at 20% effort); "combing both types of metrics does not lead to an improved performance" — verified in PDF. The process metrics are Moser's set (revisions, bug fixes, refactorings, churn, age) fed to LM/RT/RF models, not a hand score.
  - [Revisiting Process versus Product Metrics: a Large Scale Analysis](https://arxiv.org/pdf/2008.09569v3) — Majumder, Mody, Menzies, EMSE 27(3), 2022 — peer_reviewed — 722,471 commits, 700 projects; "recalls of 98%/44% and AUCs of 95%/54%, median values"; "there is no case ... where process + product (P+C) metrics do better than just using process (P) metrics" — verified in PDF.
  - [Evaluating Defect Prediction Approaches: A Benchmark and an Extensive Comparison](https://www.inf.usi.ch/faculty/lanza/PUBS/J/DAmb2012a.pdf) — D'Ambros, Lanza, Robbes, EMSE 2012 — peer_reviewed — "For classification, process metrics, entropy of source code and churn of source code are the best performers. They are however undistinguishable from a statistically significant point of view"; "process, churn of source code, and regular source code metrics perform very well"; Table 6 popt average ranks: NR 19, NFIX+NR 19.8, NFIX-ONLY 23.8, OO 13.8, LOC 21.4 (peff: NR 18.2, NFIX+NR 17.6, LOC 21.4); p. 40: "LOC. It features an average ranking ranging from 17.2 for classification (see Table 5) to 21.4 for ranking and effort-aware ranking (see Table 6)"; "sets of metrics relying on few metrics ... perform comparatively badly (ranks 17 or below)" — verified in PDF. The citation audit re-extracted page 25 with `pdftotext -raw`: the earlier "LOC 13.8" was an off-by-one row shift from `-layout` extraction (the OO row has no AR cell). This source **qualifies** the researcher's claim rather than simply supporting it.
  - [Does Bug Prediction Support Human Developers? Findings From a Google Case Study](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Lewis et al., ICSE 2013 — peer_reviewed — "using the number of closed bugs to rank files ... works almost as well as FixCache. We call this the Rahman algorithm"; TWR "only iterates through bug-fixing commits" — verified in PDF.
  - [Code Red: The Business Impact of Code Quality](https://arxiv.org/abs/2203.04374) — Tornhill, Borg (CodeScene), TechDebt 2022 — preprint/vendor — 39 proprietary codebases, 30,737 files, analysed "using the CodeScene tool"; "15 times more defects"; "124% more time" — verified. It measures Code Health, **not** churn × complexity: the full text has no hotspot analysis.
- **Detect:** Recency-weighted change events, with renames folded into the current path. The script was tested on git 2.51.1 with a rename chain. Save it as `hotspot.awk`:
  ```
  function expand(s, which,   pre, mid, post, arr, r) {
    if (match(s, /\{[^{}]* => [^{}]*\}/)) {
      pre = substr(s, 1, RSTART-1); mid = substr(s, RSTART+1, RLENGTH-2); post = substr(s, RSTART+RLENGTH)
      split(mid, arr, " => "); r = (which == 1) ? pre arr[1] post : pre arr[2] post
    } else { split(s, arr, " => "); r = arr[which] }
    gsub(/\/\/+/, "/", r); return r
  }
  function resolve(p,   i) { for (i = 0; (p in alias) && i < 50; i++) p = alias[p]; return p }
  BEGIN { FS = "\t" }
  /^@@/ { t = substr($0, 3); next }
  NF == 3 {
    if ($3 ~ / => /) { o = expand($3, 1); cur = resolve(expand($3, 2)); if (o != cur) alias[o] = cur; p = cur }
    else p = resolve($3)
    w = exp(-(now - t) / hl * log(2)); score[p] += w; events[p]++
  }
  END { for (k in score) printf "%.2f\t%d\t%s\n", score[k], events[k], k }
  ```
  Run it (git log is newest first, which the rename folding needs):
  ```
  LAST=$(git log -1 --format=%ct)
  git log --no-merges --first-parent -M -w --ignore-blank-lines --numstat --format='@@%ct' -- . \
    ':(exclude,glob)**/*.lock' ':(exclude,glob)**/package-lock.json' ':(exclude,glob)**/pnpm-lock.yaml' \
    | awk -v now="$LAST" -v hl=7776000 -f hotspot.awk | sort -rn | head -30
  ```
  Recency-weighted fix commits: use the same pipeline with `-i -E --grep='(^|[^[:alpha:]])(fix(e[sd]|ing)?|bugs?|hotfix|regression)([^[:alpha:]]|$)'` added.

  Manual check: compare the top-10 by this score with the top-10 by LOC (ManualDown). If they overlap by 8 or more, history adds little beyond size.
- **Tools:** git, awk, code-maat (revisions / abs-churn), lizard
- **Applies to:** All languages. Repos that pass G104-F04 **and** G104-F19. File-level ordering of the hardening backlog; not the security backlog (G104-F13).
- **When not to apply / counterpoints:**
  - All cited studies label defects with SZZ or keywords, which are noisy (G104-F08). Past fixes partly predict future fix-labelled commits by construction.
  - Majumder found no Popt20 difference between process, product and combined metrics; Kamei 2010 did find one.
  - Majumder's tally of Kamei 2010's own tables finds process+product better than process alone in 5 of 9 versions. Kamei's text calls the difference negligible.
  - D'Ambros's best ranking approaches mix history with code metrics, so "complexity adds nothing" is not established. What is missing is evidence for the simple *product*.
  - Vendor work (Code Red, *Your Code as a Crime Scene*) promotes combining code health with hotspots; it is not independent.
- **Fix risk:** low

### G104-F02 — Do not treat file-level summed complexity as an independent risk signal; use function-level complexity and length to pick targets inside ranked files
- **Grade:** B · **Verdict:** CORRECTED (the literature figure is R² = 0.94, not R. Landman's own file-level numbers added, including the C caveat. The HN CodeScene comment is re-read as praise, not criticism.)
- **Rationale:** Landman et al. studied 17.6M Java methods and 6.3M C functions.
  - At method level, the linear CC–SLOC correlation is only moderate (R² 0.40 Java, 0.44 C). That is not enough to call CC redundant.
  - After aggregating to files, correlation rises: Java R² 0.64 raw, 0.87 log; C R² 0.84 log.
  - C raw file-level R² *fell* to 0.39, because header code outside functions varies a lot. Summing only function bodies gives R² 0.70–0.73 (0.90 log).

  A file-level churn × summed-CC product is therefore largely churn × size. Complexity keeps its value at function granularity, where refactoring happens.
- **Evidence:**
  - [Empirical analysis of the relationship between CC and SLOC in a large corpus of Java methods and C functions](https://www.win.tue.nl/~aserebre/Landman2015-ccsloc-jsep2015-preprint.pdf) — Landman, Serebrenik, Bouwers, Vinju, J. Softw. Evol. Proc. 2016 (preprint) — peer_reviewed — "linear correlation between SLOC and CC is only moderate"; "higher correlations can only be observed after aggregation to the file level or when we arbitrarily remove the larger elements"; Table VI (file R² Java 0.64/0.87 log, C 0.39/0.84 log); literature Table I gives R² 0.94 for a C file-level study (1.5 MLOC) — verified in PDF.
  - [Revisiting Common Bug Prediction Findings Using Effort-Aware Models](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Kamei_ICSM2010.pdf) — Kamei et al., ICSM 2010 — peer_reviewed — "For product metrics, LM and RT are worse in some cases than the baseline (LOC based file) order, but RF is always better than LOC based file order." — verified in PDF (cross-release analysis). Indirect support.
- **Detect:**
  1. `lizard --csv src` gives NLOC and CCN per function.
  2. Sum per file, then compute Spearman(file NLOC, file summed CCN), e.g. with a `scipy.stats.spearmanr` one-liner. A threshold of ≥0.9 as "adds only size" is a convention; Landman used Pearson R², raw and log.
  3. Flag functions with ESLint `complexity`, SonarJS cognitive complexity, ruff C901 or radon cc. Report raw values and set thresholds per project.
- **Tools:** lizard, scc, eslint (complexity), sonarjs cognitive-complexity, ruff C901, radon
- **Applies to:** All languages with a function-level complexity tool.
- **When not to apply / counterpoints:**
  - Landman argues CC is *not* redundant at method level, which is why it is kept as the within-file selector.
  - Vendor "code health" scores combine several function-level smells and are not independently validated.
  - An unaffiliated HN user found CodeScene's flagged files "definitely overly complex", and said it "gave perfect scores to some files with complex jobs that are better-designed". That reads as the composite score telling necessary complexity apart from poor design, a mild point in favour of composite scores over raw CC.
- **Fix risk:** low

### G104-F03 — Use size-descending order (ManualDown) as the mandatory baseline; do not adopt smallest-first orderings for an agent reviewer
- **Grade:** B · **Verdict:** CORRECTED (grade A→B). Changes:
  - The researcher's "LOC order is near random under effort-aware scoring" was removed; Kamei 2010 does not say it.
  - The LT/ManualUp evidence is change-level (just-in-time, JIT), not file-level.
  - D'Ambros: LOC alone is a weak single predictor.
- **Rationale:**
  - Zhou et al.: simple module-size models (ManualDown: larger first; ManualUp: smaller first) are "comparable or even superior to most of the existing CPDP models". They recommend both as baselines.
  - Yang et al.'s smallest-first LT model found 12–27% more defective changes at 20% of modified LOC. Huang, Xia & Lo replicated it and showed why: LT needs "more than twice or even triple as many" changes inspected, with more context switches and early false alarms, and it does not win on F1. For an agent, each file opened costs a context load.
  - Kamei 2010: LOC-descending order had Popt 0.43–0.60 on Eclipse. Every random-forest model beat it (process RF 0.80–0.94). Size is a floor to beat, not a target.
- **Evidence:**
  - [How Far We Have Progressed in the Journey? An Examination of Cross-Project Defect Prediction](https://api.crossref.org/works/10.1145/3183339) — Zhou, Yang, Lu, Chen, Li, Zhao, Qian, Xu, ACM TOSEM 2018 — peer_reviewed — "The simple module size models have a prediction performance comparable or even superior to most of the existing CPDP models"; "future studies should include ManualDown/ManualUp as the baseline models" — verified in the Crossref abstract (full text not opened).
  - [Revisiting supervised and unsupervised models for effort-aware just-in-time defect prediction](https://xin-xia.github.io/publication/emse182.pdf) — Huang, Xia, Lo, EMSE (DOI 10.1007/s10664-018-9661-2; online 2018, issue 2019) — peer_reviewed — "LT requires developers to inspect more than twice or even triple as many as the number of changes"; "LT does not outperform EALR when the harmonic mean of Recall and Precision (i.e., F1-score) is considered" — verified in PDF.
  - [Revisiting Unsupervised Learning for Defect Prediction](https://arxiv.org/pdf/1703.00132v2) — Fu, Menzies, ESEC/FSE 2017 — peer_reviewed — "repeats and refutes those results ... When we repeat their analysis on a project-by-project basis, supervised predictors are seen to work better" — verified in PDF.
  - [Revisiting Common Bug Prediction Findings Using Effort-Aware Models](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Kamei_ICSM2010.pdf) — Kamei et al., ICSM 2010 — peer_reviewed — Table III LOC-order Popt: 0.49/0.46/0.43 (Platform), 0.50/0.54/0.47 (JDT), 0.53/0.60/0.51 (PDE) — verified in PDF.
- **Detect:**
  - Build the baseline with `lizard --sort nloc` (functions) or `scc --by-file` sorted by code lines (files).
  - Compute the top-10 overlap with the proposed ranking.
  - If the proposed order puts files below the 25th size percentile on top, count the files it needs to cover 20% of LOC. Reject it if that count is more than about 2× ManualDown's (convention).
- **Tools:** lizard, scc, cloc, git
- **Applies to:** Every run: as the default when there is no history, and as the comparator when there is.
- **When not to apply / counterpoints:**
  - Zhou's result is for cross-project prediction. Within-project history models with enough data beat size (Kamei 2010).
  - Smaller modules are proportionally more defect-prone (Koru et al., cited by Huang et al.; not opened). That is why ManualUp wins density metrics: it is not wrong, only costly in context switches.
  - D'Ambros: LOC alone "performed very poorly" as a single-metric predictor for ranking. It is a baseline, not a recommendation.
- **Fix risk:** low

### G104-F05 — When the gate fails, do not import generic cross-project thresholds or weights; compute any threshold from this repo's own percentiles
- **Grade:** B · **Verdict:** CORRECTED (grade A→B). Kamei 2016's own conclusion is that carefully built cross-project JIT models "are a viable solution for projects with limited historical data". The evidence is against *naive* transfer, not against all transfer.
- **Rationale:**
  - Zimmermann et al. 2009, as reported by Kamei et al. 2016: of 622 cross-project combinations, only 21 were acceptable (3.4%).
  - Kamei et al. 2016 (11 projects): JIT models "rarely perform well in a cross-project context". They improve with similarity-selected, pooled or ensembled training data, which a hardening skill does not carry.
  - Zhou 2018: size alone matches most cross-project models.

  Ad-hoc fixed cut-offs ("hotspot if revisions > N") are cruder than any of these trained models.
- **Evidence:**
  - [Studying Just-In-Time Defect Prediction using Cross-Project Models](https://rebels.cs.uwaterloo.ca/papers/emse2016_kamei.pdf) — Kamei, Fukushima, McIntosh, Yamashita, Ubayashi, Hassan, EMSE 2016 — peer_reviewed — "while JIT models rarely perform well in a cross-project context, their performance tends to improve when using approaches that: (1) select models trained using other projects that are similar ... (2) combine the data ... (3) combine the models"; "JIT models learned using other projects are a viable solution for projects with limited historical data"; "of the 622 cross-project combinations, only 21 produce acceptable results" — verified in PDF.
  - [Cross-project defect prediction: a large scale experiment on data vs. domain vs. process](https://doi.org/10.1145/1595696.1595713) — Zimmermann, Nagappan, Gall, Giger, Murphy, ESEC/FSE 2009 — peer_reviewed — existence confirmed via Crossref; the 21/622 figure is secondary via Kamei 2016.
  - [How Far We Have Progressed in the Journey?](https://api.crossref.org/works/10.1145/3183339) — Zhou et al., TOSEM 2018 — peer_reviewed — "the real progress in CPDP is not being achieved as it might have been envisaged" — verified in the Crossref abstract.
- **Detect:** Search the skill's rules and prompts for fixed cut-offs ("revisions > N", "CC > N = high risk", weights "calibrated on" other codebases). Any threshold not recomputed from this repo's percentiles counts as imported.
- **Tools:** ripgrep
- **Applies to:** Skill design; repos that fail G104-F04.
- **When not to apply / counterpoints:**
  - A properly trained cross-project JIT model (similarity selection, pooling, ensembles) is legitimate for young projects (Kamei 2016). It is out of scope for a lightweight skill, not refuted.
  - Online cross-project learning (Tabassum et al., ICSE 2020; not opened) reports early-life benefits.
- **Fix risk:** low

### G104-F06 — Remove non-essential change before computing churn: merges, renames, whitespace-only edits, blame-ignored revisions, and generated or vendored paths
- **Grade:** B · **Verdict:** CORRECTED (three bugs fixed in the detection commands, all verified on a test repo with git 2.51.1):
  - (1) `':(exclude)**/*.lock'` and similar do not exclude top-level `yarn.lock` or `pnpm-lock.yaml`, nor a top-level `dist/`. Use `:(exclude,glob)`.
  - (2) `grep -v -F -f .git-blame-ignore-revs` drops *every* SHA if the file has a blank line, and such files usually contain blank lines and comments.
  - (3) Rename rows (`old => new`) are skipped by `NF==3` under whitespace splitting.
- **Rationale:**
  - Kawrykow & Robillard (7 Java systems, 24,000+ change sets): 2.6–15.5% of method updates were entirely non-essential. These distorted association-rule recommendations in 26% of cases.
  - Google's deployed bug predictor drew complaints that "Auto-generated files were not filtered" and kept getting flagged.
  - Git's own options remove much of this noise: `git log -w --ignore-blank-lines --numstat` emits no numstat rows for a whitespace-only commit (verified). The commit header still appears, so count files from numstat rows, not headers.
- **Evidence:**
  - [Non-Essential Changes in Version Histories](https://www.cs.mcgill.ca/~martin/papers/icse2011.pdf) — Kawrykow, Robillard, ICSE 2011 — peer_reviewed — "between 2.6% and 15.5% of all method updates in a system's change history consisted entirely of non-essential differences"; association-rule interference "in 26% of the cases" — verified in PDF.
  - [git diff-options](https://git-scm.com/docs/diff-options) — Git project, docs version 2.55.0 — official_docs — "-M ... The default similarity index is 50%"; "-w ... Ignore whitespace when comparing lines"; "--ignore-blank-lines ... Ignore changes whose lines are all blank" — verified.
  - [git-log](https://git-scm.com/docs/git-log) — Git project, docs version 2.55.0 — official_docs — `--no-merges`: "Do not print commits with more than one parent"; `--first-parent`: "follow only the first parent commit upon seeing a merge commit" — verified.
  - [git-blame](https://git-scm.com/docs/git-blame) — Git project, page last updated in 2.53.0 — official_docs — `--ignore-rev`: "as if the change never happened"; `blame.ignoreRevsFile`: "one unabbreviated object name per line ... Whitespace and comments beginning with # are ignored" — verified.
  - [Does Bug Prediction Support Human Developers?](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Lewis et al., ICSE 2013 — peer_reviewed — "Auto-generated files were not filtered, and would often be changed, so would end up attached to bug-fixing changes and get flagged" — verified in PDF.
- **Detect:**
  ```
  git log --no-merges --first-parent -M -w --ignore-blank-lines --numstat --format='@@%H %ct' -- . \
    ':(exclude,glob)**/*.lock' ':(exclude,glob)**/package-lock.json' ':(exclude,glob)**/pnpm-lock.yaml' \
    ':(exclude,glob)**/dist/**' ':(exclude,glob)**/build/**' ':(exclude,glob)**/*.min.*' \
    ':(exclude,glob)**/__snapshots__/**' ':(exclude,glob)**/generated/**' ':(exclude,glob)**/vendor/**'
  ```
  Ignore-revs (extract full SHAs first; an empty pattern file then correctly filters nothing):
  ```
  grep -Eo '^[0-9a-f]{40}' .git-blame-ignore-revs > ignore.txt
  git log --no-merges --first-parent --format=%H | grep -v -F -x -f ignore.txt
  ```
  Formatting-only check: `git diff -w --ignore-blank-lines --quiet SHA^ SHA` exits 0 when the change is whitespace-only.

  Renames: fold them with the `hotspot.awk` script in G104-F01. Pure renames show as `0 0` rows; skip those rows if they should not count as events.
- **Tools:** git, awk, grep
- **Applies to:** All repos. Drop `-w` for Python, YAML, Makefiles and other languages where indentation matters.
- **When not to apply / counterpoints:**
  - `-w` can hide meaningful re-indentation (e.g. moving a Python line into a block).
  - `--first-parent` drops branch detail, but the measured effect on defect prediction is modest (Kovalenko et al., G104-F09).
  - Rename detection is heuristic; `-M100%` detects only exact renames.
- **Fix risk:** low

### G104-F09 — Detect squash-merge workflows: count each squash commit as one change event per file, down-weight its line churn, and disable authorship metrics
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - GitHub's documentation says squash merging means "You lose information about when specific changes were originally made and who authored the squashed commits."
  - Kalliamvakou et al. (Peril VII): GitHub "records only the commits that are the result of the peer-review, not the original commits".
  - Kovalenko et al. (1,400+ repos, 2M+ files) compared first-parent with full-branch histories. The two "consistently deliver different results", but full histories improve reviewer recommendation, change recommendation and defect prediction only by an amount that is "rather modest".

  First-parent change counts therefore survive squashing reasonably well; authorship and timing metrics do not.
- **Evidence:**
  - [About merge methods on GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github) — GitHub Docs, accessed 2026 — official_docs — "You lose information about when specific changes were originally made and who authored the squashed commits."; "You can use squash and merge to create a more streamlined Git history" — verified.
  - [The Promises and Perils of Mining GitHub](https://kblincoe.github.io/publications/2014_MSR_Promises_Perils.pdf) — Kalliamvakou, Gousios, Blincoe, Singer, German, Damian, MSR 2014 — peer_reviewed — Peril VII quote — verified in PDF.
  - [Mining File Histories: Should We Consider Branches?](https://sback.it/publications/ase2018.pdf) — Kovalenko, Palomba, Bacchelli, ASE 2018 — peer_reviewed — "considering full file histories leads to an increase in the techniques' performance that is rather modest" — verified in PDF.
- **Detect:** A squash workflow shows both signs:
  - `git rev-list --count --merges --first-parent HEAD` is near 0; and
  - many first-parent subjects end in a PR number: `git log --first-parent --format=%s | grep -cE '[(]#[0-9]+[)]$'`.

  The `(#N)` suffix is a GitHub convention (not stated in the GitHub merge-methods page); check it on the repo. A rebase-only workflow also shows zero merges.
- **Tools:** git, grep
- **Applies to:** Repos merged via GitHub/GitLab squash; rebased or rewritten histories.
- **When not to apply / counterpoints:**
  - Squashing drops work-in-progress commits, which can *reduce* noise in change counts.
  - No study found measures squash-merge impact on churn-based file ranking directly.
- **Fix risk:** low

### G104-F10 — Detect AI-agent-assisted periods and stop trusting line churn inside them
- **Grade:** B · **Verdict:** CORRECTED:
  - (a) In He et al.'s size-controlled models, Cursor adoption had **no significant effect on static-analysis warnings**; only complexity kept a +9% effect.
  - (b) Codex PRs were not larger than human PRs (δ ≈ −0.03).
  - (c) AIDev's "9.1% vs 23.3%" comes from a *single-project case study*, not the whole dataset. The same case shows event-count inflation too: 164 Codex PRs in 5 days.
- **Rationale:** Agent output inflates and reshapes churn.
  - Popescu et al. (MSR 2026, ~110k PRs): median human PR ≈60 lines vs Claude's 376 lines (Cliff's δ ≈ 0.37). Codex was used for smaller changes. Effect sizes are "moderate to fairly negligible", with long tails. Agent contributions are "associated with more churn over time".
  - He et al. (MSR 2026, 806 Cursor repos, difference-in-differences):
    - 3–5× more lines added in the first adoption month;
    - persistent increases in warnings (+30.3%) and cognitive complexity (+41.6%);
    - in dynamic panel models with size controls, codebase growth "absorb[s] most variance". Cursor still raises complexity by 9%, but its effect on warnings is not significant.
  - AIDev case study (OpenHFT/Chronicle-Wire): one developer opened 164 Codex PRs in five days, nearly matching the 176 human PRs of the prior 3.5 years. Commit and PR *counts* inflate too, not only lines.

  In agent-era history, both line churn and event counts partly track generation volume. Adoption can be dated from committed config files, as He et al. did.
- **Evidence:**
  - [Investigating Autonomous Agent Contributions in the Wild](https://arxiv.org/pdf/2604.00917v1) — Popescu, Gros, Botocan, Pandita, Devanbu, Izadi, MSR 2026 — peer_reviewed — "The median human-opened PR was approximately 60 lines ... (Claude median 376 lines), with the exception of Codex"; "δ = 0.37 and about δ = -0.03 between human and Codex"; "associated with more churn over time" — verified in PDF.
  - [Speed at the Cost of Quality: How Cursor AI Increases Short-Term Velocity and Long-Term Complexity](https://arxiv.org/pdf/2511.04427v3) — He, Miller, Agarwal, Kästner, Vasilescu, MSR 2026 — peer_reviewed — "3-5x increases in lines added in the first adoption month"; +30.26% warnings, +41.64% complexity; "Cursor adoption does not have a significant effect on static analysis warnings" (GMM with size controls); "9% baseline increase" in complexity; adoption via ".cursorrules files or .cursor folders"; ".claude folders" robustness check — verified in PDF.
  - [The Rise of AI Teammates in Software Engineering (SE) 3.0](https://arxiv.org/pdf/2507.15003v1) — Li, Zhang, Hassan, 2025 — preprint — 456,535 agentic PRs, 61,453 repos; Finding #8 (single project): "a single developer submitted 164 Codex-assisted PRs, nearly matching the 176 human-authored PRs produced over the preceding three and a half years"; "only 9.1% of the Agentic-PRs introduced changes in cyclomatic complexity, compared to 23.3% for Human-PRs" — verified in PDF.
- **Detect:**
  - Adoption markers: `git log --diff-filter=A --format='%cs %h' -- .cursorrules .cursor .claude CLAUDE.md AGENTS.md .github/copilot-instructions.md .windsurfrules`
  - Post-adoption share: `git rev-list --count --no-merges --first-parent --since=<earliest-date> HEAD`, divided by the total.
  - Compare median lines per commit, and commits per week, before and after that date.
- **Tools:** git, awk
- **Applies to:** AI-assisted repos, especially solo projects without AI attribution trailers.
- **When not to apply / counterpoints:**
  - Missing config files do not prove no agent use: "developers can use Cursor without committing such files".
  - Counting events instead of lines only partly neutralises inflation, because agents also multiply commits and PRs.
  - AIDev's per-PR "simpler" finding (one project) and He et al.'s project-level complexity growth measure different units.
  - GitClear (a vendor) reports similar trends; not independent.
- **Fix risk:** low

### G104-F11 — Make the ranking recency-weighted and explainable: every item carries its evidence and one concrete action
- **Grade:** B · **Verdict:** VERIFIED (supporting Tricorder quote added)
- **Rationale:**
  - Google (Lewis et al.) compared FixCache with "the Rahman algorithm", which ranks files by number of closed bugs. Rahman's list was the only one developers both knew and felt was bug-prone. But deploying a time-weighted variant (TWR) produced "no identifiable change in developer behavior" after three months.
  - Developers asked for "Actionable messages", "Obvious reasoning" and "Bias towards the new". They complained that "Technical debt files would be flagged again and again".
  - TWR's decay window was "about 6 to 8 months", and the decay constant (12) "happened to be the value that worked for our purposes".
  - Google's Tricorder excluded exactly this kind of signal from code review: "cyclomatic complexity or location-based fault prediction does not meet this bar" (clear, actionable warnings).
  - McIntosh & Kamei: model AUC and Brier scores "drop considerably one year after being trained".

  For a finished project, anchor the decay at the last commit, not today. The ~90-day half-life is a convention.
- **Evidence:**
  - [Does Bug Prediction Support Human Developers? Findings From a Google Case Study](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Lewis, Lin, Sadowski, Zhu, Ou, Whitehead, ICSE 2013 — peer_reviewed — quotes above — verified in PDF.
  - [Does bug prediction support human developers? (abstract page)](https://research.google/pubs/does-bug-prediction-support-human-developers-findings-from-a-google-case-study/) — Google Research — official_docs — "found no identifiable change in developer behavior" — same sentence verified in the PDF abstract.
  - [Tricorder: Building a Program Analysis Ecosystem](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf) — Sadowski, van Gogh, Jaspan, Söderberg, Winter, ICSE 2015 — peer_reviewed — "The warning should be easy to understand and the fix should be clear ... For example, cyclomatic complexity or location-based fault prediction does not meet this bar." — verified in PDF (added by the verifier).
  - [Are Fix-Inducing Changes a Moving Target?](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/McIntosh_TSE2017.pdf) — McIntosh, Kamei, IEEE TSE 2018 (DOI 10.1109/TSE.2017.2693980) — peer_reviewed — "drop considerably one year after being trained" — verified in PDF.
- **Detect:**
  - Use the weighted pipeline in G104-F01 (`hl=7776000` s, `now` = last commit timestamp).
  - Every output item must carry its metric values and an action verb ("extract function", "add branch test for catch at L120", "validate input at handler X"). Reject items labelled only "hotspot".
- **Tools:** git, awk
- **Applies to:** All history-based rankings.
- **When not to apply / counterpoints:**
  - Decay constants are environment-specific.
  - Recency weighting can hide old, stable, risky code, so the consequence and size tiers must still run for security and critical paths.
- **Fix risk:** low

### G104-F14 — Approximate the attack surface statically before ranking security work
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Enumerate entry points: HTTP/RPC routes, WebSocket handlers, CLI and env parsing, webhook and queue consumers, file readers. Prioritise files reachable from them, and add any files that appear in crash or error stack traces.
  - Theisen et al. (Windows 8): the stack-trace approximation selected 48.4% of binaries, which held 94.6% of known vulnerabilities. Vulnerability models run on the approximated surface improved file-level precision from 0.5 to 0.69, but file recall only from 0.02 to 0.05.
  - On Vista, dependency data predicted vulnerabilities with higher recall than code metrics.
  - NIST SSDF PW.1.1 names "attack surface mapping" as a form of risk modelling.
- **Evidence:**
  - [Approximating Attack Surfaces with Stack Traces](https://www.microsoft.com/en-us/research/publication/approximating-attack-surfaces-with-stack-traces/) — Theisen, Herzig, Morrison, Murphy, Williams, ICSE 2015 (companion) — peer_reviewed — 48.4% of binaries → 94.6% of vulnerabilities; file precision .5→.69, recall .02→.05; binary recall .07→.1 — verified on the MSR abstract page.
  - [NIST SP 800-218 SSDF v1.1](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf) — NIST, Feb 2022 — standard — PW.1.1 "threat modeling, attack modeling, or attack surface mapping" — verified in PDF.
- **Detect:** Entry points (TS/JS/Python examples):
  - `rg -n '(app|router|server)[.](get|post|put|patch|delete|use)[(]' src`
  - `rg -n '@(Get|Post|Put|Patch|Delete|Controller|MessagePattern)[(]' src`
  - `rg -n '(process[.]argv|yargs|commander|argparse|click[.]command)' src`
  - `rg -n '(new WebSocket|on[(].message.|consumer|subscribe[(])' src`

  Reachability: `npx depcruise src --output-type json` (or madge / pydeps), then walk dependencies from the entry files.
- **Tools:** ripgrep, ast-grep, dependency-cruiser, madge, pydeps
- **Applies to:** Services, APIs, bots and CLIs; less relevant for pure libraries.
- **When not to apply / counterpoints:**
  - Single industrial study (Windows), based on crash-dump traces.
  - Small projects have no crash telemetry, so the static entry-point version is an untested substitute.
- **Fix risk:** low

### G104-F15 — Do not use fan-in or network centrality as a defect predictor; use it only as a blast-radius tie-breaker and as a trigger for characterization tests
- **Grade:** B · **Verdict:** DOWNGRADED (A→B). The negative result rests on one replication (3 Java OSS projects) against a positive industrial original (Windows Server 2003). The blast-radius use is a convention.
- **Rationale:**
  - Zimmermann & Nagappan (Windows Server 2003): network measures raised recall by 10 points over complexity metrics and found 60% of the binaries developers considered critical.
  - Premraj & Herzig replicated this on JRuby, ArgoUML and Eclipse. It held only under random sampling: in forward-release and cross-project setups, "network metrics ... offer no vantage over code metrics". That compared 8 code metrics with about 58 network metrics.
- **Evidence:**
  - [Predicting Defects using Network Analysis on Dependency Graphs](https://thomas-zimmermann.com/publications/files/zimmermann-icse-2008.pdf) — Zimmermann, Nagappan, ICSE 2008 — peer_reviewed — "by 10% points higher"; "60% of the binaries that the Windows developers considered as critical" — verified in PDF.
  - [Network versus Code Metrics to Predict Defects: A Replication Study](https://www.st.cs.uni-saarland.de/publications/files/premraj-esem-2011.pdf) — Premraj, Herzig, ESEM 2011 — peer_reviewed — "offer no vantage over code metrics ... we used only 8 code metrics compared to approximately 58 network metrics" — verified in PDF.
- **Detect:** TS/JS: `npx depcruise src --output-type json` or `npx madge --json src`, then count importers per module. Python: pydeps / import-linter. Flag the top decile by fan-in.
- **Tools:** dependency-cruiser, madge, pydeps, import-linter
- **Applies to:** Tie-breaking and refactoring-safety decisions in all repos.
- **When not to apply / counterpoints:**
  - On Vista, dependency data had higher vulnerability recall (0.40 vs 0.2), so dependencies matter more for security (G104-F14).
  - High-fan-in modules carry higher regression risk when refactored, hence characterization tests first.
- **Fix risk:** low

### G104-F16 — In the fallback, rank by findings from high-precision rules only, not by warning density or a composite score
- **Grade:** B · **Verdict:** CORRECTED:
  - (a) He et al.'s +30% warnings is largely explained by codebase growth: not significant after size controls.
  - (b) A 20-finding sample cannot establish a false-positive rate under 10%. It is only a rough screen: with 0/20 false positives the 95% one-sided upper bound is ≈14%, with 2/20 it is ≈28% (Clopper-Pearson, computed by the verifier).
- **Rationale:**
  - Habib & Pradel: three widely used Java static bug detectors (Error Prone, Infer, SpotBugs) together found 27 of 594 real bugs (4.5%).
  - Trautsch et al. (PMD on Apache Java projects): the warning-density difference between bug-inducing changes and other changes has "negligible" effect size. Bug-inducing files even had *fewer* warnings than the rest of the project.
  - Google's Tricorder keeps analysers only if their "effective false positive" rate stays under 10%, measured on "a statistically sound sample size" and through developer click-through "not useful" rates.
  - He et al.: warnings and complexity reduce later velocity. The warning increase itself tracks code growth.
- **Evidence:**
  - [How Many of All Bugs Do We Find? A Study of Static Bug Detectors](https://software-lab.org/publications/ase2018_static_bug_detectors_study.pdf) — Habib, Pradel, ASE 2018 — peer_reviewed — "The three bug detectors together reveal 27 of the 594 studied bugs (4.5%)." — verified in PDF.
  - [Are automated static analysis tools worth it?](https://api.crossref.org/works/10.1007/s10664-023-10301-2) — Trautsch, Herbold, Grabowski, EMSE 2023 — peer_reviewed — "bug inducing files contain less static analysis warnings than other files"; "the effect size is negligible in all cases" — verified in the Crossref abstract.
  - [Tricorder: Building a Program Analysis Ecosystem](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43322.pdf) — Sadowski et al., ICSE 2015 — peer_reviewed — "We still enforce a very low effective false positive rate here (< 10%)"; "we ... manually check a statistically sound sample size of the results" — verified in PDF.
  - [Speed at the Cost of Quality](https://arxiv.org/pdf/2511.04427v3) — He et al., MSR 2026 — peer_reviewed — "increases in static analysis warnings and code complexity are major factors driving long-term velocity slowdown"; "Cursor adoption does not have a significant effect on static analysis warnings" (with size controls) — verified in PDF.
- **Detect:**
  1. Run the analysers: typescript-eslint type-aware rules, Semgrep, CodeQL, ruff/bandit.
  2. For each rule, sample findings and mark true or false positives. Keep a rule when its sample shows about 10% false positives or fewer, and grow the sample (~30–50) for rules that decide rankings.
  3. Rank files by the remaining findings, T1 files first.
- **Tools:** eslint, typescript-eslint, semgrep, codeql, ruff, bandit
- **Applies to:** All repos in fallback mode; also a within-tier signal in primary mode.
- **When not to apply / counterpoints:**
  - Sampling costs time.
  - Habib and Trautsch studied Java only.
  - Warning fixes are often cheap, so some teams simply fix all high-severity findings instead of ranking by them.
- **Fix risk:** medium

### G104-F17 — Within T1–T4 items, prioritise uncovered branches, especially error handling, and add characterization tests before refactoring those paths
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Use branch coverage, not line coverage.
  - Mockus, Nagappan & Dinh-Trong (two dissimilar industrial projects): higher coverage "is associated with decrease in field reported problems". But test effort "increases exponentially with test coverage", so target coverage rather than maximise it.
  - Dipongkor et al. (4,882 agentic PRs from AIDev): existing tests covered 61.5% of changed executable lines in Java and 27.0% in Python. Error-handling constructs were the most under-tested, with miss rates up to 86.0% (Java) and 81.0% (Python).
- **Evidence:**
  - [Test Coverage and Post-Verification Defects: A Multiple Case Study](https://mockus.org/papers/coverage.pdf) — Mockus, Nagappan, Dinh-Trong, ESEM 2009 — peer_reviewed — "the increase in test coverage is associated with decrease in field reported problems"; "optimal levels of coverage are likely to be well short of 100%" — verified in PDF.
  - [Test Coverage Analysis of Agentic Pull Requests](https://arxiv.org/abs/2607.18057) — Dipongkor, Baral, Lam, Moran, 2026 (arXiv: "to appear" at ICSME 2026) — accepted paper — "cover 61.5% of agents' changed executable lines in Java and only 27.0% in Python"; "miss rates reaching 86.0% in Java and 81.0% in Python" — verified in the arXiv abstract.
- **Detect:**
  - JS/TS: `vitest run --coverage` with a branch report (v8/istanbul).
  - Python: `pytest --cov --cov-branch --cov-report=term-missing`.
  - Intersect uncovered ranges with `rg -n '(catch *[(]|except|[.]catch[(]|finally)' src`.
- **Tools:** vitest, @vitest/coverage-v8, pytest-cov, coverage.py, ripgrep
- **Applies to:** Repos with a runnable test suite. If none exists, adding one is itself a T1 hardening task.
- **When not to apply / counterpoints:**
  - Coverage is a weak proxy for test effectiveness.
  - The Dipongkor data are Java and Python agent PRs only.
  - Async code can mislead coverage tools.
- **Fix risk:** low

### G104-F20 — Do not use change entropy, or any other single-number process score, as a standalone ranking signal
- **Grade:** B · **Verdict:** VERIFIED (note: the two-metric NFIX+NR also ranks near the bottom, 19.8, though just above LOC at 21.4; see G104-F01)
- **Rationale:**
  - D'Ambros et al.'s benchmark: "entropy of change metrics perform quite badly (sometimes worse than LOC)", and simple approximations of process metrics (NR, NFIX-ONLY) "close the march".
  - The authors attribute this to "each approach amount[ing] to a single metric". Entropy of *source-code metrics*, a different construct, ranked well.
- **Evidence:**
  - [Evaluating Defect Prediction Approaches: A Benchmark and an Extensive Comparison](https://www.inf.usi.ch/faculty/lanza/PUBS/J/DAmb2012a.pdf) — D'Ambros, Lanza, Robbes, EMSE 2012 — peer_reviewed — quote above — verified in PDF.
  - [Predicting faults using the complexity of code changes](https://doi.org/10.1109/icse.2009.5070510) — Hassan, ICSE 2009 — peer_reviewed — existence confirmed via Crossref; no open copy found. D'Ambros summarises: "Entropy was compared to the amount of changes and the amount of previous bugs, and was found to be often better" (six open-source systems) — secondary.
- **Detect:** Check whether the skill uses "change entropy", "scatter" or any single process number as its primary score. If so, replace it with the gated, backtested score in G104-F01.
- **Tools:** ripgrep
- **Applies to:** Skill design.
- **When not to apply / counterpoints:** Hassan's original study (secondary report) found entropy often better than prior changes or prior faults. D'Ambros's variants and datasets differ.
- **Fix risk:** low

### G104-F04 — Gate every churn-based ranking on a history-sufficiency test computed after noise filtering
- **Grade:** C · **Verdict:** DOWNGRADED (B→C). All thresholds are transferred. S3 was mis-derived: Shrikanth's "25 defective commits" are SZZ bug-*inducing* commits, not fix-labelled commits. "150 commits / 4 months" describes the median early window, not two independently validated minima. Kalliamvakou's statistics date from 2013–14.
- **Rationale:** PASS requires all of:
  - (S1) ≥150 filtered non-merge commits;
  - (S2) ≥4 months between the first and last filtered commit, ≥6 preferred;
  - (S3) enough fix-labelled commits (~25, an analogy).

  Conventions: (S4) bulk commits carry <50% of filtered churned lines; (S5) <50% of filtered commits come after agent adoption.

  Failing S1–S3 means using the fallback ladder (G104-F12). Failing S4 or S5 means using change counts only as a tie-breaker inside it. Report which criterion failed.

  Sources:
  - Shrikanth, Majumder & Menzies (ICSE 2021, 155 projects): "defect predictors learned from the first 150 commits and four months perform just as well as anything else". The median project had 41 defective commits in its first 150, and the early policy trained on 25 clean + 25 defective commits.
  - McIntosh & Kamei (37,524 changes, Qt and OpenStack): quality-improvement plans need "six months (or more) of historical data".
  - Kalliamvakou et al. (2014): median GitHub project 6 commits; 90% under 50; 71.6% personal. Most solo or hackathon repos will fail the gate, correctly.
- **Evidence:**
  - [Early Life Cycle Software Defect Prediction. Why? How?](https://arxiv.org/pdf/2011.13071v3) — Shrikanth, Majumder, Menzies, ICSE 2021 — peer_reviewed — quote above. Exclusions: <1000 stars, <1% defects, <2 releases, <1 year, no license, <5 defective and 5 clean commits. Commits (265, 3,728, 83,409) min/median/max. "25 clean + 25 defective commits ... based on the work of Nam et al." — verified in PDF.
  - [Are Fix-Inducing Changes a Moving Target?](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/McIntosh_TSE2017.pdf) — McIntosh, Kamei, IEEE TSE 2018 — peer_reviewed — "retrained using recently recorded data (within three months) ... trained using six months (or more) of historical data" — verified in PDF.
  - [The Promises and Perils of Mining GitHub](https://kblincoe.github.io/publications/2014_MSR_Promises_Perils.pdf) — Kalliamvakou et al., MSR 2014 — peer_reviewed — "median number of commits per project is 6, and 90% of projects have less than 50 commits"; "71.6% of repositories are personal" — verified in PDF.
- **Detect:**
  - S1: `git log --no-merges --first-parent --format=%h -- . ':(exclude,glob)**/*.lock' | wc -l`
  - S2: `git log --no-merges --first-parent --reverse --format=%cs | sed -n '1p;$p'`
  - S3: `git log --no-merges --first-parent -i -E --grep='(^|[^[:alpha:]])(fix(e[sd]|ing)?|bugs?|hotfix|regression)([^[:alpha:]]|$)' --format=%h | wc -l`
  - S4: the numstat sum for commits above the p99 files-touched (G104-F07), divided by the total.
  - S5: find the earliest agent-config date (G104-F10), run `git rev-list --count --no-merges --first-parent --since=<date> HEAD`, and divide by the total.
- **Tools:** git, awk
- **Applies to:** Every run, before any churn or ownership signal is used.
- **When not to apply / counterpoints:**
  - The thresholds come from ≥1000-star, ≥1-year OSS projects and were set for training commit classifiers, not for ranking files.
  - No study validates a threshold for solo, squash-merged or agent-authored repos.
  - S3 relies on noisy keyword labels (G104-F08).
- **Fix risk:** low

### G104-F07 — Do not present '>30 files' as an empirical threshold; flag bulk commits relative to the repo (above its 99th percentile of files touched)
- **Grade:** C · **Verdict:** CORRECTED. Code Maat's default of 30 is not documented as coming from ROSE (README and source checked), so "traces to ROSE" becomes "matches ROSE's cut-off". ROSE's "30 entities" counts fine-grained entities (methods, fields, files), not files.
- **Rationale:**
  - ROSE (Zimmermann et al., TSE 2005) ignored "all changes that affect more than 30 entities" to avoid large CVS branch-merge transactions when mining co-change rules.
  - Code Maat's `--max-changeset-size` (default 30) applies to modules "included in a coupling analysis".
  - Neither calibrated the number for churn or defect ranking.
  - Hindle et al. studied "the 1% commits that contained the largest number of files". Mostly merges (19.4%), feature additions (19.2%) and documentation (17.9%), but "in many cases these commits are fundamentally important to the software's very structure". So do not drop them silently.

  Rule:
  - Exclude bulk commits from coupling analysis.
  - For churn, count a bulk commit as one change event per touched file with zero line churn.
  - List bulk commits for manual review.
  - Keep 30 only as a labelled convention for coupling.
- **Evidence:**
  - [Mining Version Histories to Guide Software Changes](https://thomas-zimmermann.com/publications/files/zimmermann-tse-2005.pdf) — Zimmermann, Weißgerber, Diehl, Zeller, IEEE TSE 31(6), 2005 — peer_reviewed — "one must avoid the large merge transactions. ROSE does so by ignoring all changes that affect more than 30 entities." — verified in PDF.
  - [code-maat](https://github.com/adamtornhill/code-maat) — Adam Tornhill (CodeScene founder); repo not archived, last commit 2025-07-03 — official_docs — "--max-changeset-size ... Maximum number of modules in a change set if it shall be included in a coupling analysis" (default 30); `--min-revs` default 5 — verified in the README and `cmd_line.clj`. No provenance for 30 is stated.
  - [What do large commits tell us? A taxonomical study of large commits](https://softwareprocess.es/pubs/hindleMSR2008-large-changes.pdf) — Hindle, German, Holt, MSR 2008 — peer_reviewed — quotes above — verified in PDF.
- **Detect:** Files-per-commit distribution:
  ```
  git log --no-merges --first-parent --format='@@%H' --name-only | awk '/^@@/{if(c!="")print c; c=0; next} NF{c++} END{if(c!="")print c}' | sort -n | awk '{a[NR]=$1} END{i=int(NR*0.99); if(i<1)i=1; print "p50",a[int((NR+1)/2)],"p99",a[i]}'
  ```
  List the largest commits:
  ```
  git log --no-merges --first-parent --format='@@%h %s' --name-only | awk '/^@@/{if(h!="")print c, h; h=$0; c=0; next} NF{c++} END{print c, h}' | sort -rn | head -20
  ```
- **Tools:** git, awk, code-maat (--max-changeset-size for coupling)
- **Applies to:** All repos, for both churn and change-coupling analysis.
- **When not to apply / counterpoints:**
  - Absolute thresholds are repeatable across repos.
  - In repos under ~100 commits, p99 is effectively the maximum. Such repos usually fail G104-F04 anyway.
- **Fix risk:** low

### G104-F12 — When the gate or the backtest fails, order work by a fallback ladder (a labelled convention)
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** The ladder:
  - T1: consequence classes: authentication, access control and credentials; money and monetary arithmetic; persistence and migrations; external I/O and input parsing; crypto and secrets.
  - T2: code reachable from entry points.
  - T3: high-precision static findings in T1–T2 (G104-F16).
  - T4: the largest and most complex functions, T1 first (ManualDown).
  - T5: uncovered branches, especially error handling (G104-F17).
  - T6: fan-in as a blast-radius tie-breaker (G104-F15).
  - T7: surviving change counts as the final tie-breaker.

  Each tier has its own support; the combination is not validated:
  - T1: NIST SSDF 1.1 PW.1.1, Example 2 (text retained verbatim in the SSDF 1.2 Initial Public Draft of Dec 17, 2025, still a draft as of this check).
  - T2: Theisen et al.: 48.4% of binaries held 94.6% of vulnerabilities.
  - T4: Zhou 2018: size matches most cross-project models.
  - T5: Mockus et al.: coverage is associated with fewer field defects.
  - T6: Premraj & Herzig: fan-in has no predictive edge, but it measures blast radius.
- **Evidence:**
  - [NIST SP 800-218 SSDF Version 1.1](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf) — NIST, Feb 2022 — standard — PW.1.1 and Example 2 "Perform more rigorous assessments for high-risk areas, such as protecting sensitive data and safeguarding identification, authentication, and access control, including credential management." — verified in PDF.
  - [NIST SP 800-218 Rev. 1 (SSDF 1.2), Initial Public Draft](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218r1.ipd.pdf) — NIST, Dec 2025 — standard (draft) — PW.1.1 "(e.g., threat modeling, attack modeling, attack surface mapping)" and the same Example 2 — verified in PDF. The CSRC page shows it is still an initial public draft (comments closed Jan 30, 2026).
  - [Approximating Attack Surfaces with Stack Traces](https://www.microsoft.com/en-us/research/publication/approximating-attack-surfaces-with-stack-traces/) — Theisen et al., ICSE 2015 — peer_reviewed — verified.
  - [Test Coverage and Post-Verification Defects](https://mockus.org/papers/coverage.pdf) — Mockus et al., ESEM 2009 — peer_reviewed — verified.
- **Detect:** T1 examples (TS/JS/Python; tune per repo):
  - auth: `rg -n -i '(jwt|session|password|bcrypt|argon2|oauth|authoriz|permission|role)' src`
  - money: `rg -n -i '(amount|price|balance|decimal|bigint|fee|pnl|wei|usd)' src`
  - persistence: `rg -n '(INSERT|UPDATE|DELETE|prisma[.]|knex|sequelize|mongoose|[.]query[(]|migration)' src`
  - external I/O: `rg -n '(fetch[(]|axios|WebSocket|child_process|exec[(]|writeFile|unlink)' src`

  For the other tiers: T2 see G104-F14; T4 `lizard --sort nloc`; T5 see G104-F17; T6 see G104-F15. Record each file's tier in the report.
- **Tools:** ripgrep, ast-grep, lizard, semgrep, codeql, vitest --coverage, pytest-cov, dependency-cruiser
- **Applies to:** Repos that fail G104-F04 or G104-F19; all security work regardless of history.
- **When not to apply / counterpoints:**
  - Consequence classes are judgement calls, and grep over-matches (e.g. "amount" in UI copy); prune by hand.
  - The ladder can starve non-critical but buggy code.
  - No experiment compares this ladder with a hotspot ordering on hardening outcomes.
- **Fix risk:** low

### G104-F18 — Disable ownership, author-count and experience metrics in solo, squash-merged or unattributed agent-assisted repos
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** These metrics need reliable authorship.
  - Squash merges lose "who authored the squashed commits" (GitHub).
  - 71.6% of GitHub repositories were personal in 2014 (Kalliamvakou et al.).
  - Agent commits made under the user's identity are indistinguishable from the user's own.
  - JIT models do use experience features, but their role "fluctuates over time" (McIntosh & Kamei).

  Where these metrics are used, deduplicate identities first (`.mailmap`).
- **Evidence:**
  - [About merge methods on GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github) — GitHub Docs — official_docs — verified.
  - [The Promises and Perils of Mining GitHub](https://kblincoe.github.io/publications/2014_MSR_Promises_Perils.pdf) — Kalliamvakou et al., MSR 2014 — peer_reviewed — "Two thirds of projects (71.6% of repositories) are personal." — verified.
  - [Are Fix-Inducing Changes a Moving Target?](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/McIntosh_TSE2017.pdf) — McIntosh, Kamei, TSE 2018 — peer_reviewed — "the role that code change properties (e.g., Size, Experience) play within JIT models fluctuates over time" — verified.
- **Detect:**
  - `git shortlog -sne --no-merges HEAD | wc -l`: 1 or fewer means disable.
  - Check whether `.mailmap` exists.
  - Combine with the squash signature (G104-F09) and the agent markers (G104-F10).
- **Tools:** git
- **Applies to:** Solo, squash-merged and AI-assisted repos.
- **When not to apply / counterpoints:** In genuine team repos, ownership has independent support (Bird et al. 2011; Greiler et al. 2015; not opened in this check).
- **Fix risk:** low

### G104-F19 — Before trusting a history-based ranking, run a time-split backtest against ManualDown
- **Grade:** C · **Verdict:** VERIFIED. The method is a convention, but it is now the key safeguard: in D'Ambros, cheap history scores rank near LOC rather than clearly above it (NR 19 and NFIX+NR 19.8 vs LOC 21.4; NFIX-ONLY 23.8 below LOC). (audit correction: LOC's popt rank is 21.4, not 13.8, so only the fixes-only score ranks below LOC.)
- **Rationale:**
  1. Let T be the last commit. Compute the ranking from history up to T − 3 months.
  2. Count how many of its top-10 files received fix-labelled commits after that point.
  3. Do the same for ManualDown's top-10.
  4. If history does not beat size, say so and use the fallback.

  Metric importance and performance are unstable across projects and over time:
  - Majumder: "unwise to trust metric importance results from analytics in-the-small studies".
  - D'Ambros: "external validity in defect prediction is still an open problem".
  - Zhou prescribes size baselines.
  - McIntosh & Kamei show models decay within a year.
- **Evidence:**
  - [Revisiting Process versus Product Metrics](https://arxiv.org/pdf/2008.09569v3) — Majumder, Mody, Menzies, EMSE 2022 — peer_reviewed — "we warn that it is unwise to trust metric importance results from analytics in-the-small studies since those change dramatically when moving to analytics in-the-large" — verified.
  - [Evaluating Defect Prediction Approaches](https://www.inf.usi.ch/faculty/lanza/PUBS/J/DAmb2012a.pdf) — D'Ambros, Lanza, Robbes, EMSE 2012 — peer_reviewed — "external validity in defect prediction is still an open problem, as generalizing results to different contexts/learners proved to be a partially unsuccessful endeavor"; Table 6 popt (NFIX+NR 19.8 and NR 19 just above LOC 21.4; NFIX-ONLY 23.8 below it) — verified; LOC rank corrected by the citation audit.
- **Detect:**
  Cut-off (GNU `date`; on macOS use `date -r`):
  ```
  CUT=$(date -d @$(( $(git log -1 --format=%ct) - 7776000 )) +%F)
  ```
  Ranking as of the cut-off: rerun the G104-F01 pipeline with `git log --until=$CUT ...` and `now` set to the cut-off timestamp.

  Outcomes after the cut-off:
  ```
  git log --since=$CUT -i -E --grep='(^|[^[:alpha:]])(fix(e[sd]|ing)?|bugs?|hotfix|regression)([^[:alpha:]]|$)' --name-only --format= | sort -u
  ```
  Compute hits@10 for the history ranking and for ManualDown (lizard/scc on `git worktree add <scratch>/cut $(git rev-list -1 --before=$CUT HEAD)`).
- **Tools:** git, lizard, scc
- **Applies to:** Repos that pass G104-F04.
- **When not to apply / counterpoints:**
  - In small repos the holdout window has few fixes, so hits@10 of 1–3 is not statistically meaningful; treat it as a sanity check.
  - It reuses noisy fix labels (G104-F08).
- **Fix risk:** low

### G104-F21 — Update the skill's work-ordering rules (meta)
- **Grade:** C · **Verdict:** CORRECTED:
  - "No independent study shows combining adds anything" is softened: D'Ambros's best rankers are history × code-metric hybrids, and Majumder reads Kamei 2010 as 5 of 9 versions favouring the combination.
  - The ROSE → Code Maat provenance is stated as a coincidence, not a documented lineage.
  - Code Red is described as a Code Health study, not a hotspot validation.
- **Rationale:**
  - T03-F09 and T25-F10 (churn × complexity): AMEND to history-first ranking (G104-F01) behind the gate (G104-F04) and the mandatory backtest (G104-F19), with function-level complexity as the refactor selector (G104-F02). Keep grade C for the product itself.
  - T19-F14: AMEND the same way and add the ManualDown baseline (G104-F03).
  - T19-F04 ('>30 files'): AMEND to the relative bulk filter (G104-F07).
  - T19-F09 (security consequence-ranked): KEEP, strengthened by G104-F13 and F14.
  - ADD the fallback ladder (G104-F12), the agent-era handling (G104-F10), squash handling (G104-F09) and the ownership disable (G104-F18).

  The first factor of churn × complexity (change history) has independent support as a model input. The product has none, for or against. The cheapest history scores have evidence *against* them as standalone rankers: they rank near the bottom in D'Ambros, around LOC (NR 19, NFIX+NR 19.8 vs LOC 21.4) and, for fixes only, below it (23.8).
- **Evidence:**
  - [Your Code as a Crime Scene, Second Edition](https://pragprog.com/titles/atcrime2/your-code-as-a-crime-scene-second-edition/) — Adam Tornhill (Pragmatic Bookshelf), Feb 2024 — book/vendor — "Intersect Complexity and Effort" and "Drive Refactoring via a Probability Surface" are sections under the chapter "Discover Hotspots: Create an Offender Profile of Code" — book existence and section titles confirmed on the publisher page. The empirical claims are not independently checked.
  - [Code Red: The Business Impact of Code Quality](https://arxiv.org/abs/2203.04374) — Tornhill, Borg, TechDebt 2022 — vendor study — verified (Code Health vs defects/time; no hotspot analysis).
  - [Revisiting Common Bug Prediction Findings Using Effort-Aware Models](https://posl.ait.kyushu-u.ac.jp/~kamei/publications/Kamei_ICSM2010.pdf) — Kamei et al., ICSM 2010 — peer_reviewed — "combing both types of metrics does not lead to an improved performance" — verified.
- **Detect:** Diff the skill's rule text by hand: search for "churn × complexity", "hotspot", ">30 files" and "change frequency", and apply the amendments above.
- **Tools:** ripgrep
- **Applies to:** The hardening skill's own rulebook.
- **When not to apply / counterpoints:**
  - The vendor evidence points the same way. A missing independent replication is not evidence against it.
  - The amended rules still use change history as the primary signal, like the vendor, but add a gate, a baseline and a fallback.
- **Fix risk:** low

## Practitioner voice
All 12 items were opened through the Hacker News API. Authors, dates and thread context were checked.
- [Google bug prediction thread: file length skews scores](https://news.ycombinator.com/item?id=3354734) — 2011, "Bug Prediction at Google" story: "A single 100 line file will be scored to be twice as buggy as the exact same code split into two 50 line files." Per-file scores depend on how code is split into files.
- [Thin history: "Cyclomatic Complexity to the rescue?"](https://news.ycombinator.com/item?id=3356447) — 2011, same thread: "What about files with limited or no history." The thin-history gap was raised at the first public deployment.
- [Algorithm author on gaming fix counts](https://news.ycombinator.com/item?id=3355612) — Chris Lewis, author of the Google work: cheating is "very easy: 1. Just don't file bug tickets. 2. If you do, don't attach the tickets to changes..." Fix-count signals depend on labelling discipline.
- [Google deployment postmortem](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — "Technical debt files would be flagged again and again"; "Auto-generated files were not filtered"; the algorithm was "non-actionable"; no measurable behaviour change after three months.
- [Unaffiliated CodeScene trial](https://news.ycombinator.com/item?id=30716953) — 2022, Code Red blog thread: flagged files were "definitely overly complex", and it "gave perfect scores to some files with complex jobs that are better-designed". This reads as praise for separating necessary complexity from poor design. In the same thread a CodeScene employee (30711303, "Disclaimer: I work at CodeScene") and a Code Red co-author (30711383) comment, so the conflict of interest is visible.
- [Squash-and-merge loses the "why"](https://news.ycombinator.com/item?id=11732500) — 2016: "it just doesn't capture what I need a commit history/git-blame for ... I want to know why".
- [Cursor study: size control quote](https://news.ycombinator.com/item?id=47402998) — 2026, on the Cursor paper: quotes that codebase growth absorbs most variance but Cursor still gives a "9% baseline increase" in complexity. It replies to 47402451, which argued the effect was just growth.
- [Agents don't delete old code](https://news.ycombinator.com/item?id=49659745) — 2026: "agents really don't like deleting code unless you explicitly ask for it ... the old implementation still around in perpetuity. Humans do this too of course."
- [LLM codebase "speedrun"](https://news.ycombinator.com/item?id=49659458) — 2026: an LLM-authored codebase reached a legacy-like state "in only a couple months" and was "riddled with defects". Anecdote.
- [Static signals now, churn later](https://news.ycombinator.com/item?id=49664410) — 2026, a tool builder promoting their own tool: "Some benefits can be reaped immediately (cyclomatic complexity), but others emerge over time (churn)."
- [Review load is nonlinear in diff size](https://news.ycombinator.com/item?id=47406076) — 2026: "reviewing five 30-line diffs is dramatically less taxing than one 150-line diff ... The cognitive load is nonlinear."
- [Net LOC as a sloppiness metric, with Goodhart caveat](https://news.ycombinator.com/item?id=49659123) — 2026: quotes the linked article's "surprisingly effective metric for sloppiness" and its caveat that optimising for it destroys it; reports LLMs code-golfing one-liners when it becomes a hard metric.

## Contradictions and open questions

**Contradictions**
- **Combining history and code metrics.**
  - Kamei 2010's text and Majumder 2022 (700 projects) find no gain from combining.
  - Majumder's tally of Kamei 2010's *own* tables finds process+product better than process alone in 5 of 9 versions.
  - D'Ambros 2012's best ranking approaches are decayed churn of code metrics, a hybrid.
  - Vendor work (Code Red, *Your Code as a Crime Scene*) promotes combining code health with hotspots.
- **Is history better than code metrics at all?** Rahman & Devanbu, Kamei and Majumder say yes. D'Ambros finds product metrics (CK+OO) "perform very well" and statistically tied with process metrics for classification.
- **Cheap history scores.** Rahman et al. (restated by Lewis et al., not a Google finding): ranking by closed-bug count "works almost as well as FixCache"; at Google, developers judged the Rahman algorithm better than FixCache. D'Ambros: NR, NFIX-ONLY and NFIX+NR rank near the bottom on popt (19, 23.8, 19.8); LOC is 21.4, so only NFIX-ONLY ranks below LOC.
- **Effort-aware evaluation.** Kamei 2010: process clearly beats product on Popt. Majumder 2022: no significant Popt20 difference.
- **Simple baselines.**
  - Yang et al. (FSE 2016, via Huang et al. and Fu & Menzies; not opened): smallest-first LT beats supervised effort-aware JIT models.
  - Fu & Menzies refute this project by project.
  - Huang, Xia & Lo attribute LT's win to inspecting 2–3× more changes.
  - Zhou et al.: ManualDown/ManualUp are comparable to most cross-project models.
- **Cross-project transfer.** Zimmermann 2009: 21/622 combinations acceptable. Kamei 2016: carefully built cross-project JIT models are "a viable solution for projects with limited historical data".
- **Entropy.** Hassan 2009 (secondary via D'Ambros) found entropy "often better" than change and bug counts. D'Ambros found entropy of changes "sometimes worse than LOC".
- **Network metrics.** Zimmermann & Nagappan 2008: +10 points of recall. Premraj & Herzig 2011: no advantage in forward-release or cross-project setups.
- **Vulnerability prediction.** Shin 2011: >80% recall with <25% false positives. Morrison 2015: file precision <0.5 and recall <0.2. Jimenez 2019: MCC 0.77→0.08 under realistic labelling.
- **AI code complexity.**
  - AIDev's single-project case (Chronicle-Wire): 9.1% of agent PRs change CC, vs 23.3% of human PRs.
  - He et al.: Cursor adoption raises project cognitive complexity by 41.6%, still +9% after size controls.
  - The units differ (per PR, one project, vs project-level), and the AIDev figure is not dataset-wide.
- **Warnings after agent adoption.** He et al. find +30% warnings in difference-in-differences but no significant Cursor effect on warnings once codebase size is controlled.
- **Large commits.** ROSE, Code Maat and T19-F04 drop commits over 30 entities or modules as noise. Hindle et al. find large commits "fundamentally important to the software's very structure".
- **CC vs SLOC.** Landman: correlation is moderate at method level and high after aggregation to files for Java. For C, raw file-level correlation *fell* because of header code.
- **History length.** Shrikanth: 150 commits and 4 months suffice ("more data" does not help). McIntosh & Kamei: ≥6 months for quality plans, and models decay within a year.

**Open questions**
- No study validates any file ranking (history-, size- or consequence-based) on solo, hackathon-scale (<150 commits), squash-merged or mostly agent-authored repositories. All thresholds are transferred from ≥1000-star OSS projects.
- No study measures how GitHub squash merges change churn-based defect ranking. Kovalenko compares only first-parent with full-branch traversal.
- No validated method identifies agent-authored commits without metadata.
- No study compares hardening outcomes (bugs or vulnerabilities found per review hour) between consequence-first and hotspot-first ordering.
- Is agent-era churn corrective (defect-related) or regeneration? Unknown, so the meaning of churn in AI-assisted repos is unclear. Event counts inflate as well (AIDev case: 164 PRs in 5 days).
- The effort unit for an AI reviewer (tokens read vs files opened) is unstudied. Effort-aware metrics (Popt, PCI@20%) were designed for human inspection.
- No study validates the simple recency-weighted "changes + fixes" score. Its closest benchmarked relative (NFIX+NR) performed poorly in D'Ambros (popt 19.8 of 25, just above LOC at 21.4). Whether recency weighting rescues it is untested; D'Ambros's decayed hybrids suggest decay helps.
- Not opened in this check (claims rest on secondary reports or are only mentioned): Moser et al. 2008, Hassan 2009, Arisholm et al. 2010, Zimmermann et al. 2009, Yang et al. 2016, Tabassum et al. 2020, Koru et al., Walkinshaw & Minku 2018, Kochhar et al. 2017, Bird et al. 2011, Greiler et al. 2015, and the full text of Zhou 2018 and Trautsch 2023 (abstracts only).

## Dropped findings
None. All 21 findings had real, checkable sources. The corrections are listed per finding above.
