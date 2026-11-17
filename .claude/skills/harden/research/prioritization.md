# Prioritising where to spend cleanup effort
> Code T19 · slug prioritization · verified 2026-09-23 · counts: verified 11 / corrected 8 / downgraded 4 / dropped 0

## Summary

Peer-reviewed studies, official tool documentation, incident reports and practitioners mostly agree. For **maintainability** cleanup, rank work mainly by version-control history: how often and how recently code changes, and how often it gets bug fixes. Static complexity or size is only the second axis. Complex code that is stable and not broken is recorded, not refactored, with explicit exceptions. Security issues, correctness issues and dead code that can still be switched on are ranked by consequence, whatever their churn.

Replicated results behind this (all verified against abstracts or full text):
- **Change history predicts faults better than static metrics.** Graves et al. (IEEE TSE 26(7), 2000; NISS TR 80, 1998), Rahman & Devanbu (ICSE 2013; 85 releases of 12 OSS projects), Nagappan & Ball (ICSE 2005; Windows Server 2003, relative churn only).
- **Faults concentrate in a small share of files.**
  - Ostrand, Weyuker & Bell (TSE 2005; "two large industrial systems", unnamed in the abstract): the top 20% of files by predicted faults held 71-92% of faults, 83% on average.
  - Kim et al. (ICSE 2007; 7 OSS projects): a cache of 10% of files held 73-95% of faults.
- **Architecture-level debt is where much maintenance effort goes.** Xiao et al. (ICSE 2016; 7 OSS projects): the top 5 architectural debts cover 8-25% of error-prone files but take 20-61% of maintenance effort.
- **Business-impact figures from the CodeScene group (Tornhill, Borg et al.).** All of these are vendor-affiliated, use a proprietary metric, and are correlational.
  - Code Red 2022: alert-level code (1.14% of 30,737 files) has 15x more defects than healthy code, 124% more development time, and 9x longer maximum cycle times.
  - TechDebt 2024: returns grow at the high-health end.
  - EASE 2023: marginal owners need 45% more time for small changes and 93% more for large changes in low-quality code.
  - FORGE 2026: low-health code is less safe for AI refactoring.

Important dissent (verified):
- **Walkinshaw & Minku, ESEM 2018 (100 GitHub repos).** The 80/20 rule holds only if multi-file fixes are counted several times, and focusing on the top files alone "would probably be misguided".
- **Sjøberg et al., TSE 2013.** Once file size and number of changes were controlled for, none of 12 code smells predicted extra effort.
- **Lewis et al., ICSE 2013 (Google).** A bug-prediction ranking deployed across Google produced "no identifiable change in developer behavior". Developers wanted a short list, obvious reasoning, actionable output and a bias towards current problems.
- **Tverdal et al., ICSME 2026 Industry Track preprint (3 products, 10 practitioners, CodeScene co-authors).**
  - History-based "friction" misses "files that are rarely modified but still difficult and time-consuming to change".
  - It needs care with test files, isolated files and temporary spikes.
  - Practitioners "did not treat friction as a standalone refactoring signal".
- **Lenarduzzi et al. (systematic review; JSS 171, 2021; 44 primary studies up to 2020, 38 in the 2019 arXiv preprint).** There is "no consensus on what the important factors are and how to measure them".
- **Graves et al. 2000.** Co-change frequency ("changed in tandem") was a poor fault predictor in their telecom system.
- **Knight Capital (SEC order, 2013).** Power Peg had been unused since 2003 but stayed "present and callable". A 2005 change and a repurposed flag, combined with an incomplete deployment (one of eight servers), caused a loss of over $460M in about 45 minutes.
- **Log4Shell.** The JNDI lookup feature dates from 2013 (LOG4J2-313), and `JndiLookup.java` had no commits between July 2017 and the December 2021 disclosure.

Command-level procedure (git 2.55.0 is the latest release; the git-blame page was last changed in 2.53.0):
1. **Churn.** Take the last 12 months, no merges, with vendored, generated, lock and build files excluded and mass commits removed.
2. **Relative churn** with `--numstat`.
3. **Bug-fix counts** with `--grep`, weighted towards recent fixes (Google's TWR formula).
4. **Complexity** per file or function with lizard (CCN warning default 15) or `scc --by-file -s complexity`. Compare only within one language.
5. **Intersect** the lists and take the high-churn, high-complexity quadrant first. Report about 20 items at most, each with its evidence.
6. **Coupling.** Run code-maat coupling (defaults min-revs 5, min-shared-revs 5, min-coupling 30%, max-changeset-size 30) and report clusters for a human to decide.
7. **Ownership.** Check it, then add characterization tests before refactoring.

Severity scheme: consequence and location are separate labels. The scales are official, but combining them this way is the researcher's own synthesis and has not been validated (grade C).
- **Consequence:** Sonar MQR levels (Blocker, High, Medium, Low, Info) for each software quality, and CVSS v4.0 bands for vulnerabilities. CVSS Base is severity, not risk, per the CVSS v4.0 User Guide.
- **Location:** hotspot rank versus stable long tail.
- **Ordering:**
  - Security and correctness issues at Blocker/High, plus dead code that can still be activated, go first whatever their churn.
  - Maintainability issues are ordered by hotspot rank.
  - Findings in stable code are recorded, not fixed.
  - Nits are non-blocking.
- **Do not order by SQALE/Sonar remediation minutes.** That is the principal; priority should follow the interest.

After cleanup, protect the gains with a quality gate on new code. Keep mechanical commits separate and list them in `.git-blame-ignore-revs`.

**Main caveats:**
- Most primary evidence predicts *faults* or *effort*. That cleanup of the top-ranked files pays back is an inference, supported mainly by the interest argument (Cunningham, Fowler) and by vendor-affiliated studies.
- None of the evidence addresses short, squashed or agent-generated histories. That is exactly the "finished project" case this skill targets.

## Findings

### T19-F01 — For maintainability cleanup, rank candidates primarily with version-control (process) history — change frequency, churn, recent bug fixes — and use static code metrics only as a second axis. Never build the maintainability priority list from static-analysis output alone (security/correctness findings follow T19-F09 instead).
- **Grade:** A · **Verdict:** CORRECTED
  - Scoped the rule to maintainability ranking, so it no longer contradicts T19-F09. Security and correctness findings from static analysis are ranked by consequence.
  - Fixed the Graves citation: NISS TR 80 is dated March 1998, and the IEEE TSE version is 26(7):653-661, 2000. The quotes are from the TSE abstract and the TR body.
- **Rationale:** Several independent peer-reviewed studies found that change history predicts where future faults occur better than a snapshot of the code. Code metrics barely change from release to release ("high stasis"), so they keep flagging the same files, and those files turn out to be less defect-dense. The outcome measured is faults, not cleanup return; applying it to cleanup priority is an inference.
- **Evidence:**
  - [Predicting fault incidence using software change history (NISS TR 80 preprint of IEEE TSE 26(7):653-661)](https://www.niss.org/sites/default/files/technicalreports/tr80.pdf) — Graves, Karr, Marron, Siy; TR March 1998, TSE 2000 — peer_reviewed — TSE abstract: "the number of times code has been changed is a better indication of how many faults it will contain than is its length". TR body: "numbers of lines of code in modules are not helpful in predicting numbers of future faults once one has taken into account numbers of times modules have been changed. This implies that many software complexity metrics are also not useful in this context, because within our data set these metrics are very highly correlated with lines of code." — Verification: TR PDF text-extracted and grepped; TSE abstract reconstructed exactly from the OpenAlex inverted index (DOI 10.1109/32.859533). One large telecom system.
  - [How, and why, process metrics are better (ICSE 2013)](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1109/ICSE.2013.6606589?fields=title,abstract,year,venue,authors,externalIds) — Rahman, Devanbu, 2013 — peer_reviewed — "85 releases of 12 large open source projects… code metrics, despite widespread use in the defect prediction literature, are generally less useful than process metrics for prediction… code metrics have high stasis… leading to the same files being repeatedly predicted as defective; unfortunately, these recurringly defective files turn out to be comparatively less defect-dense." — Verification: abstract confirmed verbatim via Semantic Scholar API.
  - [Use of relative code churn measures to predict system defect density (ICSE 2005)](https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/) — Nagappan, Ball / Microsoft Research, 2005 — peer_reviewed — "able to discriminate between fault and not fault-prone binaries with an accuracy of 89.0 percent" (Windows Server 2003) — Verification: abstract confirmed on the MSR page; one system.
- **Detect:**
  - Check that the repo has usable history first: `git rev-list --count HEAD` and `git log --since=12.month --oneline | wc -l`.
  - If history is squashed, very short, or mostly one initial import, say that the process signal is weak and fall back to static metrics plus criticality plus roadmap (T19-F22).
  - Otherwise compute churn (T19-F02) before any linter-based ranking.
  - Manual check: if the report orders maintainability items by linter issue count, re-sort them by history.
- **Tools:** git; code-maat (not archived, but low activity: last release v1.0.4 in Feb 2023, last push July 2025; its README says the analyses "evolved into CodeScene"); CodeScene (commercial); churn Ruby gem (last push March 2024, low maintenance).
- **Applies to:** All languages; repositories with a real, non-squashed commit history of several months or more.
- **When not to apply / counterpoints:**
  - Process metrics need history, and no source was found on the minimum length that makes them meaningful.
  - Walkinshaw & Minku 2018: churn was reliable "only for extremely high values of Churn".
  - Lewis et al. 2013: an algorithm that predicts well still did not change developer behaviour at Google.
  - Every study here predicts faults, not the benefit of cleanup.
- **Fix risk:** low

### T19-F10 — Add defect history as a third ranking axis: count bug-fix commits per file over the window (time-decayed). Treat files with recent fixes, and files that change with them, as the most likely next fault locations.
- **Grade:** A · **Verdict:** CORRECTED (Ostrand et al.'s predictor is a negative binomial regression on the file's code in the current release plus its fault and modification history, not fault history alone. Also stated that its data comes from two industrial systems.) (audit correction: "works almost as well as FixCache" is Lewis et al. restating Rahman et al.'s earlier result, not a finding at Google; Google's own study found the Rahman algorithm significantly better than FixCache as judged by developers. The Ostrand abstract says "two large industrial systems" and does not name AT&T.)
- **Rationale:** Faults cluster.
  - Kim et al.: a cache of recently fixed, recently changed and co-changed locations covering 10% of files captured 73-95% of faults.
  - Ostrand et al.: a regression model using code plus change and fault history put 83% of faults, on average, in the top 20% of predicted files. A "highly simplified version" still reached 73-74%.
  - Rahman et al., as restated by Lewis et al.: simply ranking files by number of closed bugs "works almost as well as FixCache". At Google, Lewis et al. then found that "The Rahman algorithm performed significantly better than the FixCache algorithms at identifying bug-prone files" as judged by developers, and that its reasoning is obvious to them.
- **Evidence:**
  - [Predicting Faults from Cached History (ICSE 2007)](https://api.openalex.org/works/doi:10.1109/ICSE.2007.66) — Kim, Zimmermann, Whitehead, Zeller, 2007 — peer_reviewed — "In our evaluation of seven open source projects with more than 200,000 revisions, the cache selects 10% of the source code files; these files account for 73%-95% of faults" — Verification: abstract reconstructed exactly from the OpenAlex inverted index.
  - [Predicting the location and number of faults in large software systems (IEEE TSE 31(4))](https://api.openalex.org/works/doi:10.1109/TSE.2005.49) — Ostrand, Weyuker, Bell, 2005 — peer_reviewed — "the 20 percent of the files with the highest predicted number of faults contained between 71 percent and 92 percent of the faults that were actually detected, with the overall average being 83 percent"; "The predictions are based on the code of the file in the current release, and fault and modification history of the file from previous releases" — Verification: exact OpenAlex reconstruction; two industrial systems.
  - [Does Bug Prediction Support Human Developers? (ICSE 2013)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Lewis, Lin, Sadowski, Zhu, Ou, Whitehead (UCSC/Google), 2013 — peer_reviewed — "They present findings that, when bug prediction is used to support human inspection (such as code review), using the number of closed bugs to rank files from most bug-prone to least bug-prone works almost as well as FixCache. We call this the Rahman algorithm." (a restatement of Rahman et al. [6], not a Google result); "The Rahman algorithm performed significantly better than the FixCache algorithms at identifying bug-prone files" (developers' judgement at Google); "Rahman's reasoning is clear and obvious" — Verification: PDF text-extracted and grepped; attribution corrected by the citation audit.
- **Detect:**
  - `git log --since=12.month --no-merges -i --grep=fix --grep=bug --grep=defect --grep=regression --grep=hotfix --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -nr | head -30` (multiple `--grep` patterns are OR'ed).
  - If commits link to an issue tracker (e.g., "Fixes #123"), use that instead of keywords.
  - Apply the TWR decay from T19-F03.
- **Tools:** git; issue tracker; code-maat
- **Applies to:** Repos whose commit messages or issue links identify fixes.
- **When not to apply / counterpoints:**
  - Keyword heuristics miss fixes and catch false positives. Google interviewees' most common question was "What is a bug?".
  - Walkinshaw & Minku: the 80/20 pattern holds only when multi-file fixes are counted several times.
  - Undecayed fault history biases the ranking towards old files.
  - The results come from 2005-2007 Java/C/C++ codebases (industrial and OSS).
- **Fix risk:** low

### T19-F08 — Deprioritise (record, do not refactor) complex code that has not changed within the analysis window and has no open or recent defects, unless an override applies (T19-F09) or planned work will touch it (T19-F22).
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Technical-debt interest is paid only when someone works in that part of the code. In Graves et al.'s data, a module a year older than an otherwise similar one had roughly a third fewer faults. Old code carries accumulated bug fixes. Refactoring stable code carries regression risk for little payoff.
- **Evidence:**
  - [Technical Debt (bliki, first published 2003, rewritten April 2019)](https://martinfowler.com/bliki/TechnicalDebt.html) — Martin Fowler, 2019 — engineering_blog — "I only trigger an interest payment when I have to work with that part of the software"; "So crufty but stable areas of code can be left alone. In contrast, areas of high activity need a zero-tolerance attitude to cruft" — Verification: page fetched and grepped verbatim.
  - [Breaking Up the Behemoth](https://sandimetz.com/blog/2017/9/13/breaking-up-the-behemoth) — Sandi Metz, 13 Sept 2017 — engineering_blog — "if the code never changes, it's not costing us money… Ignore code in this quadrant until it starts to churn." — Verification: verbatim. The churn-vs-complexity chart is credited to Michael Feathers' "Getting Empirical about Refactoring".
  - [Predicting fault incidence using software change history](https://www.niss.org/sites/default/files/technicalreports/tr80.pdf) — Graves et al., TSE 2000 — peer_reviewed — "if a module is, on the average, a year older than an otherwise similar module, the older module will have roughly a third fewer faults" — Verification: exact TSE abstract. The TR body says "roughly two-thirds as many faults".
  - [Things You Should Never Do, Part I](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/) — Joel Spolsky, 6 Apr 2000 — engineering_blog — "Old code has been used. It has been tested. Lots of bugs have been found, and they've been fixed." — Verification: verbatim.
  - [Does Bug Prediction Support Human Developers?](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Lewis et al. / Google, 2013 — peer_reviewed — "a number of developers mentioned that they aren't actually worried about the files they know have technical debt. Instead, developers were more concerned about files that are currently causing problems" — Verification: verbatim in extracted text.
  - [Why I Write Dirty Code: Code Quality in Context](https://www.adamtornhill.com/articles/code-quality-in-context/why-i-write-dirty-code.html) — Adam Tornhill, Oct 2019 — engineering_blog — "most of your code is likely to be in the long tail"; "I only compromise quality in the long tail, and I only do it if I estimate that it will save me time" — Verification: verbatim. Vendor founder.
- **Detect:** Get the last-change date per tracked file with `git ls-files | while read f; do echo "$(git log -1 --format=%cs -- "$f") $f"; done | sort`. Files that were last changed before the window, are absent from churn.txt and have no fix commits go in a "stable, record only" bucket, with their complexity noted.
- **Tools:** git; code-maat (`-a age`)
- **Applies to:** Mature codebases. Less applicable to a project finished in a single burst, where all code is "new".
- **When not to apply / counterpoints:**
  - HN robert_tweed: the changes to fear are to "code nobody has touched for 3 years and whoever wrote it no longer works for the company". He proposes ranking by "frequency of appearance in the runtime call-graph" instead of frequency of modification.
  - Tverdal et al. 2026: friction may miss "files that are rarely modified but still difficult and time-consuming to change".
  - Knight Capital and Log4Shell show catastrophic defects in long-untouched code (T19-F09).
  - HN kbuchanan: long-tail code may be stable because it was well written.
  - Graves's age result comes from one telecom system.
- **Fix risk:** low

### T19-F09 — Rank correctness, security and "dead but still activatable" code by consequence, never by churn. Known vulnerabilities (code or dependencies), data-loss or crash paths, and unused code that can still be switched on by a flag, config, route or reflection go to the top even in files untouched for years.
- **Grade:** B · **Verdict:** CORRECTED
  - Knight Capital: the Power Peg code was not strictly "untouched". A 2005 change moved its cumulative-share tracking, which silently broke it. The 2012 trigger combined a repurposed flag with an incomplete manual deployment (seven of eight servers updated).
  - Log4Shell: the CVSS 10.0 score is a CVSS v3.1 score.
  - Added repository evidence that `JndiLookup.java` had no commits from July 2017 to disclosure.
- **Rationale:** The "stable code is cheap" heuristic is about maintainability interest, not risk. Two well-documented catastrophes came from long-dormant or long-lived code:
  - Knight Capital's Power Peg code: unused since 2003, last modified in 2005, reactivated in 2012.
  - The Log4j JNDI lookup feature: added in 2013, disclosed in December 2021. The `JndiLookup` class had no commits in the 4+ years before disclosure.
- **Evidence:**
  - [In the Matter of Knight Capital Americas LLC, Release No. 34-70694](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 16 Oct 2013 — incident_report — "Power Peg… which Knight had discontinued using many years earlier. Despite the lack of use, the Power Peg functionality remained present and callable at the time of the RLP deployment. The new RLP code also repurposed a flag that was formerly used to activate the Power Peg code"; "In 2003, Knight ceased using the Power Peg functionality. In 2005, Knight moved the tracking of cumulative shares function in the Power Peg code to an earlier point"; "orders sent with the repurposed flag to the eighth server triggered the defective Power Peg code"; "approximately 45 minutes"; "Knight lost over $460 million" — Verification: PDF text-extracted and grepped.
  - [Log4j security vulnerabilities (CVE-2021-44228)](https://logging.apache.org/log4j/2.x/security.html) — Apache Logging Services, 2021 — official_docs — "10.0 CRITICAL (CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H)"; affected "[2.0-beta9, 2.3.1) ∪ [2.4, 2.12.2) ∪ [2.13.0, 2.15.0)" — Verification: confirmed.
  - [LOG4J2-313: JNDI Lookup plugin support](https://issues.apache.org/jira/browse/LOG4J2-313) — Apache JIRA, 2013 — incident_report — created 17 July 2013, resolved 18 July 2013, fix version 2.0-beta9 — Verification: confirmed. The GitHub commit history of `log4j-core/.../lookup/JndiLookup.java` in apache/logging-log4j2 shows its last pre-disclosure commit on 2017-07-05 (checked via the GitHub API).
  - [MQR mode severities (SonarQube Server 2025.2)](https://docs.sonarsource.com/sonarqube-server/2025.2/instance-administration/analysis-functions/instance-mode/mqr-mode.md) — SonarSource, 2025 — official_docs — Blocker: "An issue that has a significant probability of severe unintended consequences on the application that should be fixed immediately." — Verification: confirmed. Identical wording on the unversioned (latest) docs page.
- **Detect:**
  - Run the ecosystem's dependency vulnerability audit and a SAST pass over the whole repo, not just hotspots.
  - Grep for feature flags, config switches and routes whose target code is otherwise unused: `git grep -n -i -E 'flag|toggle|feature|legacy|deprecated'`.
  - For each dormant path, check whether any input can still reach it.
  - Manual check: is any flag or config key reused for a new meaning?
- **Tools:** dependency audit tool per ecosystem; SAST (CodeQL, Semgrep); git grep
- **Applies to:** All projects; mandatory for anything handling money, auth, PII or external input.
- **When not to apply / counterpoints:**
  - Deleting "dead" code in stable areas has its own risks: reflection, dynamic dispatch, external callers, serialized data. Prove it is unreachable before deleting.
  - The CVSS v4.0 User Guide (v1.2, 2025-11-14) has a section titled "CVSS Base Score (CVSS-B) Measures Severity, not Risk".
  - Two incidents are vivid but anecdotal. There is no base-rate study of how often dormant code causes severe incidents.
- **Fix risk:** medium

### T19-F05 — Measure churn relative to file size (lines added+deleted per current LOC, plus number of commits) rather than absolute LOC or absolute churn, and set a minimum number of revisions before a file can rank.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** At Microsoft, absolute churn was a poor predictor of defect density while relative churn was highly predictive. Across 100 GitHub repos, LOC correlated poorly with defect-proneness. In Code Red, added LoC correlated weakly with issue resolution time.
- **Evidence:**
  - [Use of relative code churn measures to predict system defect density](https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/) — Nagappan, Ball / Microsoft Research, 2005 — peer_reviewed — "while absolute measures of code churn are poor predictors of defect density, our set of relative measures of code churn is highly predictive of defect density" — Verification: verbatim in abstract. One system (Windows Server 2003).
  - [Are 20% of files responsible for 80% of defects? (ESEM 2018)](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1145/3239235.3239244?fields=title,abstract,year,venue,authors,externalIds) — Walkinshaw, Minku, 2018 — peer_reviewed — "We found LOC to be poorly correlated with defect proneness, Code Churn was a more reliable indicator, but only for extremely high values of Churn." — Verification: verbatim in abstract.
  - [Code Red: The Business Impact of Code Quality (TechDebt 2022)](https://arxiv.org/pdf/2203.04374) — Tornhill, Borg, 2022 — peer_reviewed — "We found a low Pearson correlation (r=0.13) between added LoC and the average issue resolution time in corresponding files", versus r=-0.58 for Code Health — Verification: PDF grepped. Vendor-affiliated.
- **Detect:** `git log --since=12.month --no-merges --numstat --format=format: | awk 'NF==3 && $1 != "-" {c[$3]+=$1+$2; n[$3]++} END {for (f in c) print c[f], n[f], f}' | sort -nr > numstat.txt`. Divide churned lines by the file's current line count, and drop files with fewer than 5 revisions (code-maat's `--min-revs` default).
- **Tools:** `git --numstat`; awk; code-maat (`abs-churn`, `entity-churn`)
- **Applies to:** All languages.
- **When not to apply / counterpoints:**
  - Sjøberg et al. 2013: file size together with changes explained almost all maintenance effort, so whether size matters depends on the outcome (defects or effort).
  - Relative churn of tiny files is noisy, hence the revision floor.
  - Nagappan & Ball's relative-churn suite has several ratios, not only churned/total LOC.
  - The awk one-liner breaks on file names containing spaces. Add `--no-renames`, or renamed paths appear as `{old => new}` entries.
- **Fix risk:** low

### T19-F11 — Use the ranking to ORDER the work, not to exclude everything else. When cleaning a top-ranked file, also inspect the files that historically change or get fixed together with it.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** In 100 GitHub repos, the "top 20%" files were commonly fixed alongside much less frequently fixed files. The authors conclude that focusing only on the top files "would probably be misguided".
- **Evidence:**
  - [Are 20% of files responsible for 80% of defects?](https://api.semanticscholar.org/graph/v1/paper/DOI:10.1145/3239235.3239244?fields=title,abstract,year,venue,authors,externalIds) — Walkinshaw, Minku, 2018 — peer_reviewed — "the Pareto principle does hold, but only if defects that incur fixes to multiple files count as multiple defects"; "key files (belonging to the top 20%) are commonly fixed alongside other much less frequently-fixed files"; "focussing on them would probably be misguided" — Verification: verbatim in abstract.
  - [Predicting Faults from Cached History](https://api.openalex.org/works/doi:10.1109/ICSE.2007.66) — Kim et al., 2007 — peer_reviewed — the cache includes "any locations changed together with the fault" — Verification: exact OpenAlex reconstruction.
- **Detect:** Find a hotspot's co-change partners with `git log --since=12.month --no-merges --format=%H -- path/to/hot.file | while read h; do git show --name-only --format= "$h"; done | grep -v '^$' | sort | uniq -c | sort -nr | head -20`, and review the top partners together with the hotspot.
- **Tools:** git; code-maat (coupling)
- **Applies to:** All repositories.
- **When not to apply / counterpoints:** Ostrand et al. and Kim et al. report strong concentration, which supports a focused list. The disagreement is about whether the top files are sufficient, not whether they matter. Graves et al. found co-change frequency a poor fault predictor (see T19-F12).
- **Fix risk:** low

### T19-F12 — Run change-coupling analysis and prioritise clusters of files that co-change without a structural reason (across modules or layers), especially where they overlap hotspots. Report them as architectural findings for a human decision rather than auto-refactoring them.
- **Grade:** B · **Verdict:** VERIFIED (added a Graves et al. counterpoint)
- **Rationale:** Architecture-level debt is where large shares of maintenance effort go. The top 5 architectural debts covered 8-25% of error-prone files but took 20-61% of maintenance effort. Practitioners (n=1,831) named architectural decisions as the most important source of technical debt and said existing tools do not help manage the details.
- **Evidence:**
  - [Identifying and quantifying architectural debt (ICSE 2016)](https://api.openalex.org/works/doi:10.1145/2884781.2884822) — Xiao, Cai, Kazman, Mo, Feng, 2016 — peer_reviewed — "The top 5 architectural debts, covering a small portion (8% to 25%) of each project's error-prone files, capture a significant portion (20% to 61%) of each project's maintenance effort." (7 OSS projects) — Verification: exact OpenAlex reconstruction. Their method is a "history coupling probability matrix" with 4 flaw patterns, which is more than raw co-change counts.
  - [Hotspot Patterns: The Formal Definition and Automatic Detection of Architecture Smells (WICSA 2015)](https://api.openalex.org/works/doi:10.1109/WICSA.2015.12) — Mo, Cai, Kazman, Xiao, 2015 — peer_reviewed — "Unstable Interface and Implicit Cross-module Dependency"; "these structure-history integrated patterns contribute more to error- and change-proneness than other hotspot patterns" — Verification: exact OpenAlex reconstruction.
  - [Measure it? Manage it? Ignore it? Software practitioners and technical debt (FSE 2015)](https://www.sei.cmu.edu/library/measure-it-manage-it-ignore-it-software-practitioners-and-technical-debt/) — Ernst, Bellomo, Ozkaya, Nord, Gorton / SEI, 2015 — peer_reviewed — 1,831 participants; "architectural decisions are the most important source of technical debt"; "existing tools are not currently helpful in managing the details" — Verification: confirmed on the SEI page.
  - [code-maat README](https://github.com/adamtornhill/code-maat) — Adam Tornhill — official_docs — coupling reveals "a hidden, implicit dependency"; defaults `--min-revs` 5, `--min-shared-revs` 5, `--min-coupling` 30, `--max-changeset-size` 30 — Verification: confirmed.
- **Detect:**
  - `git log --all --numstat --date=short --pretty=format:'--%h--%ad--%aN' --no-renames --after=<YYYY-MM-DD one year ago> > logfile.log`
  - `java -jar code-maat-<ver>-standalone.jar -l logfile.log -c git2 -a coupling`
  - Treat test↔implementation pairs as expected. CodeScene docs call such coupling "a positive sign that suggests that the tests are being updated as the file evolves".
  - Flag pairs in different top-level directories or layers, and pairs where neither file imports the other.
- **Tools:** code-maat; CodeScene; git
- **Applies to:** Multi-module systems, monorepos, client/server or multi-service repos.
- **When not to apply / counterpoints:**
  - **Graves et al. (TSE 2000):** "A measure of the frequency with which a module was changed in tandem with other modules was also a poor predictor of fault likelihood". That is in tension with using raw co-change as a fault signal.
  - Co-change is often legitimate: tests, interface plus implementation, generated clients, migrations plus models.
  - Architectural refactoring is the riskiest fix class.
  - Tverdal et al. 2026: an isolated, weakly coupled high-friction file was rightly treated as lower priority.
- **Fix risk:** high

### T19-F03 — Restrict history analysis to a recent window (default: the last 12 months, or since the last major redesign) and weight recent changes and fixes more heavily than old ones.
- **Grade:** B · **Verdict:** CORRECTED
  - The Tverdal quote "over typically 12-month periods" does not appear. The paper says "commit activity over the last 12 months" and "commits over the last 12 months".
  - Google normalised TWR time over the whole history (0 = earliest commit, 1 = latest). Normalising over a window is an adaptation.
  - Added Graves's decay estimate.
- **Rationale:** Old history describes design problems that may already be fixed.
  - Graves et al.'s best fault model weighted large, recent changes most. In their fit, a change a year older had about half the influence (e^-0.75 ≈ 0.47).
  - Google's deployed TWR ranking decayed bug-fix commits over about 6-8 months.
- **Evidence:**
  - [Predicting fault incidence using software change history](https://www.niss.org/sites/default/files/technicalreports/tr80.pdf) — Graves et al., TSE 2000 — peer_reviewed — TSE abstract: "Our most successful model measures the fault potential of a module as the sum of contributions from all of the times the module has been changed, with large, recent changes receiving the most weight." TR body: "a change which is a year older than another change of the same size is only half as influential" — Verification: exact OpenAlex abstract plus TR grep.
  - [Does Bug Prediction Support Human Developers? (ICSE 2013)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Lewis et al. / Google, 2013 — peer_reviewed — TWR = Σ 1/(1+e^(−12·t_i+ω)) over bug-fixing commits, "t_i runs between 0 and 1, with 0 being the earliest commit, and 1 being the last submitted commit"; "12 happened to be the value that worked for our purposes at Google" (for ω); "older files that go unchanged should begin to decay"; "the window counts commits for about 6 to 8 months before they start to become inconsequential" — Verification: PDF grepped.
  - [code-maat README](https://github.com/adamtornhill/code-maat) — Adam Tornhill — official_docs — "over time, many design issues do get fixed and we don't want old data to interfere with our current analysis of the code" — Verification: confirmed.
  - [Technical Debt Friction for Maintenance Prioritization: An Industrial Multi-Case Study (ICSME 2026 Industry Track, arXiv 2607.01850)](https://arxiv.org/html/2607.01850v1) — Tverdal, Nguyen, Goknil, Martini, Borg, Tornhill, 2026 — preprint — friction combines "present code health with commit activity over the last 12 months"; hotspots found "through knee-point analysis of the change-frequency distribution" — Verification: HTML grepped.
- **Detect:**
  - Use `git log --since=12.month`, or `--since=<date of last redesign>`.
  - For recency weighting, list bug-fix commit dates per file (`git log --format=%ct -i --grep=fix -- <file>`), normalise to 0..1, and sum `1/(1+exp(-12*t+ω))`.
  - Google used ω = 12 with t normalised over the *whole* repository history, which gave an effective memory of 6-8 months.
  - Arithmetic check by the verifier (not from the source): if t is normalised over a 12-month window instead, ω = 12 puts the half-weight point at t = 1, so a fix 3 months old (t = 0.75) gets about 5% weight. ω ≈ 6 puts half-weight at 6 months and approximates Google's effective window. State the ω used in the report.
  - Manual check: if the window contains a big restructuring or bulk import, start it after that.
- **Tools:** git; code-maat; churn gem (`--start_date`)
- **Applies to:** All repositories with more than a few months of history.
- **When not to apply / counterpoints:**
  - No study was found that compares window lengths. 12 months is practitioner and CodeScene convention, and 6-8 months was Google's tuning.
  - In a young project the window covers the initial build and inflates every file.
  - Google interviewees believed older files were more bug-prone, while Graves found older modules had fewer faults.
- **Fix risk:** low

### T19-F06 — Inside the hotspot list, rank size/complexity problems (very long functions, god classes, deep nesting, tangled conditionals) above other code-smell categories. Interpret any smell or OO metric only after accounting for file size.
- **Grade:** B · **Verdict:** CORRECTED
  - The El Emam and Sjøberg quotes are now the exact abstract wording.
  - Added Sjøberg's full result: Refused Bequest was associated with *decreased* effort. The authors conclude that reducing code size and change-inducing work practices may pay off more than refactoring smells.
  - The El Emam abstract available via OpenAlex does not include the post-adjustment conclusion, so no claim is made about it.
- **Rationale:** Size confounds most code metrics.
  - Sjøberg et al.: in a controlled study with professional developers, none of 12 smells predicted extra effort once file size and number of changes were included.
  - Palomba et al.: a large study found smelly classes more change- and fault-prone, with long/complex-code smells the most widespread.
  - The robust common ground: size and complexity problems in frequently changed files matter most.
- **Evidence:**
  - [Quantifying the Effect of Code Smells on Maintenance Effort (IEEE TSE 39(8):1144-1156)](https://api.openalex.org/works/doi:10.1109/TSE.2012.89) — Sjøberg, Yamashita, Anda, Mockus, Dybå, 2013 — peer_reviewed — "None of the 12 investigated smells was significantly associated with increased effort after we adjusted for file size and the number of changes; Refused Bequest was significantly associated with decreased effort. File size and the number of changes explained almost all of the modeled variation in effort." Conclusion: "a focus on reducing code size and the work practices that limit the number of changes may be more beneficial than refactoring code smells." (6 developers, 4 Java systems, 298 files) — Verification: exact OpenAlex reconstruction. An earlier draft of this dossier paraphrased the quote; it is now verbatim.
  - [The confounding effect of class size on the validity of object-oriented metrics (IEEE TSE 27(7))](https://api.openalex.org/works/doi:10.1109/32.935855) — El Emam, Benlarbi, Goel, Rai, 2001 — peer_reviewed — "We demonstrate a strong size confounding effect and question the results of previous object-oriented metrics validation studies." — Verification: exact OpenAlex reconstruction.
  - [On the diffuseness and the impact on maintainability of code smells (EMSE 23(3))](https://api.openalex.org/works/doi:10.1007/s10664-017-9535-z) — Palomba, Bavota, Di Penta, Fasano, Oliveto, De Lucia, 2018 (online 2017) — peer_reviewed — "395 releases of 30 open source projects… 17,350 manually validated instances of 13 different code smell kinds… smells characterized by long and/or complex code (e.g., Complex Class) are highly diffused, and that smelly classes have a higher change- and fault-proneness than smell-free classes" — Verification: exact reconstruction.
  - [Predicting fault incidence using software change history](https://www.niss.org/sites/default/files/technicalreports/tr80.pdf) — Graves et al., 2000 — peer_reviewed — complexity metrics not useful "because within our data set these metrics are very highly correlated with lines of code" — Verification: TR grep.
- **Detect:** `lizard -C 15 --csv <src>` lists functions over CCN 15 with their NLOC. Sort by NLOC and CCN within hotspot files only. For each linter smell, ask whether it sits in a hotspot and whether it is a size/complexity smell. If neither, downgrade it to Low/Info.
- **Tools:** lizard; scc; language linters' complexity/length rules; CodeScene
- **Applies to:** All languages; OO smell findings in Java/C#/TS/Python classes especially.
- **When not to apply / counterpoints:**
  - Sjøberg's study was small (6 developers, 4 systems); Palomba's is large but correlational.
  - Code Red reports LoC only weakly correlated with resolution time (r=0.13), which is in tension with Sjøberg's size result. The outcomes differ.
  - No source directly compares the payoff of fixing size/complexity smells against other smell types. The ordering is an inference.
- **Fix risk:** medium

### T19-F18 — Output a short prioritised list (about 10-20 items), each showing the evidence that ranked it (churn, fix count, complexity, co-change partners) and a concrete next action. Never flag a fixed percentage of the codebase, and never emit an unexplained score.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Google deployed a bug-prediction ranking and saw no change in developer behaviour. Its lessons:
  - flag few files (FixCache's 10% was "deemed too large"; they showed the top 20);
  - make the reasoning obvious;
  - make messages actionable;
  - favour recent problems.
  Tools that always flag a fixed percentage can never give code a clean bill of health.
- **Evidence:**
  - [Does Bug Prediction Support Human Developers? (ICSE 2013)](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Lewis et al. / Google, 2013 — peer_reviewed — "We deployed a bug prediction algorithm across Google, and found no identifiable change in developer behavior."; "we believed developers would quickly learn to ignore it. To combat this, we settled on showing just the top 20 files"; "both will always flag a certain percentage of files, so the code can never be given a clean bill of health"; FindBugs "most categories of warnings cause over 90% of users to investigate high priority warnings" — Verification: PDF grepped. Two projects (Java 600 kSLOC, C++ 1 MSLOC), 19 interviewees.
  - [Technical Debt Friction for Maintenance Prioritization](https://arxiv.org/html/2607.01850v1) — Tverdal et al., 2026 — preprint — "practitioners did not treat friction as a standalone refactoring signal"; "most effective when used with contextual knowledge and supporting evidence" — Verification: both phrases verbatim in the HTML.
- **Detect:** Self-check the report. It has fewer than about 20 ranked items. Every item cites its numbers and one concrete action. No item is justified only by a proprietary or unexplained score.
- **Tools:** n/a (report format)
- **Applies to:** The skill's output.
- **When not to apply / counterpoints:** A short list can omit important files (Walkinshaw & Minku), so keep an appendix of the next tier. The "top 20" was chosen for projects of 4,000-7,000 files; the 10-20 range here is an extrapolation.
- **Fix risk:** low

### T19-F23 — Present the ranking as decision support, not a verdict. State the heuristics and data window used, and the known blind spots: stable-but-hard files, short or squashed history, temporary spikes, in-progress refactors, test files, isolated files. Ask the human to confirm the top items before any large or architectural refactor.
- **Grade:** B · **Verdict:** DOWNGRADED (A → B)
  - The systematic review directly supports "no consensus on prioritisation factors". The arXiv version covers papers up to 2018 (38 primary studies). The peer-reviewed JSS version covers papers up to 2020 (557 screened, 44 primary studies) and reaches the same conclusion.
  - The specific output behaviour recommended here is inferred, not tested.
  - The industrial study is a vendor-co-authored preprint with 10 participants.
  - Journal venue added.
- **Rationale:** The systematic review found no consensus on prioritisation factors or how to measure them. A 2026 industrial multi-case study found history-based signals useful but context-dependent. In a 1,831-person survey, practitioners found tools unhelpful for managing the details of debt.
- **Evidence:**
  - [Technical Debt Prioritization: State of the Art. A Systematic Literature Review (arXiv 1904.12538)](https://arxiv.org/abs/1904.12538) — Lenarduzzi, Besker, Taibi, Martini, Arcelli Fontana; arXiv v2 2020; published as ["A systematic literature review on Technical Debt prioritization: Strategies, processes, factors, and tools"](https://doi.org/10.1016/j.jss.2020.110827), Journal of Systems and Software 171 (2021) 110827 — peer_reviewed — arXiv: "We included 38 primary studies" (papers up to 2018). JSS: "We conducted a Systematic Literature Review of 557 unique papers published until 2020… We included 44 primary studies… The proposed measures capture only a small part of the plethora of factors used to prioritize Technical Debt qualitatively in practice… there is no consensus on what the important factors are and how to measure them." — Verification: arXiv abstract via the arXiv API; JSS abstract reconstructed exactly from OpenAlex; journal metadata via Crossref. Cite the JSS version (44 studies), not the 38-study preprint.
  - [Technical Debt Friction for Maintenance Prioritization (arXiv 2607.01850)](https://arxiv.org/abs/2607.01850) — Tverdal et al., 2026 — preprint (arXiv comments: 42nd ICSME, Industry Track) — "its practical relevance depended strongly on context"; "High friction may therefore indicate either accumulated burden or ongoing work intended to reduce it"; "it may miss files that are rarely modified but still difficult and time-consuming to change" — Verification: all verbatim in the HTML.
  - [Measure it? Manage it? Ignore it?](https://www.sei.cmu.edu/library/measure-it-manage-it-ignore-it-software-practitioners-and-technical-debt/) — Ernst et al. / SEI, 2015 — peer_reviewed — "existing tools are not currently helpful in managing the details" — Verification: confirmed.
- **Detect:** The report includes a "method and limits" block: window, exclusions, metrics, and which files were not ranked and why. Large or architectural items carry "needs human confirmation".
- **Tools:** n/a (report format)
- **Applies to:** The skill's output.
- **When not to apply / counterpoints:** Too much hedging hurts adoption; Lewis et al. show developers need obvious, actionable reasoning. Keep the limits short and specific.
- **Fix risk:** low

### T19-F02 — Build a hotspot list: files that are both frequently changed in the recent window and complex or large. Work from the top of that list, and inside a large hotspot file drill down to the functions that change most.
- **Grade:** B · **Verdict:** CORRECTED
  - Removed the counterpoint citing a Semantic Scholar *machine-generated TLDR* of Schulte et al. 2014: the claim could not be confirmed from the paper's abstract (see open questions).
  - Credited the churn-vs-complexity quadrant to Michael Feathers, as Metz does.
  - Added CodeScene's "45% of all bugs" figure and Fowler's "zero-tolerance" quote.
- **Rationale:** Development activity is concentrated in a small part of the codebase, so poor code there costs the most. Complex code that never changes costs little. The churn-versus-complexity quadrant, taking high/high first, is the standard practitioner operationalisation. It sits on the independent process-metric evidence in T19-F01, but the combination itself has little independent peer-reviewed validation.
- **Evidence:**
  - [Hotspots (CodeScene documentation)](https://codescene.io/docs/guides/technical/hotspots.html) — CodeScene — official_docs (vendor) — "Most development activity tends to be located in relatively few modules."; "The prioritized hotspots only make up 1.2% of the total codebase, yet we spend 12.5% of our development efforts in those hotspots, and 45% of all bugs that we detect and fix are in that small part of the code."; "Low code health in a development hotspot is expensive. Prioritize improvements here." — Verification: confirmed. This is an example codebase, not a study.
  - [Breaking Up the Behemoth](https://sandimetz.com/blog/2017/9/13/breaking-up-the-behemoth) — Sandi Metz, 2017 — engineering_blog — "The top right quadrant reflects complicated code that changes often… We'd prefer this quadrant to be empty, so code that slithers into it should be refactored right back out of it." — Verification: verbatim. The chart is credited to Feathers' "Getting Empirical about Refactoring".
  - [Technical Debt](https://martinfowler.com/bliki/TechnicalDebt.html) — Martin Fowler, 2019 — engineering_blog — "areas of high activity need a zero-tolerance attitude to cruft, because the interest payments are cripplingly high" — Verification: verbatim.
  - [Focus refactoring on what matters with Hotspots Analysis](https://understandlegacycode.com/blog/focus-refactoring-with-hotspots-analysis/) — Nicolas Carlo, undated — engineering_blog — `git log --format=format: --name-only --since=12.month | egrep -v '^$' | sort | uniq -c | sort -nr | head -50`; "Limit the analysis to the last 12 months, it's good enough"; "The truth is, any complexity metric will do." — Verification: verbatim.
  - [Your Code as a Crime Scene, Second Edition](https://pragprog.com/titles/atcrime2/your-code-as-a-crime-scene-second-edition/) — Adam Tornhill / Pragmatic Bookshelf, Feb 2024, 336 pp. — book — "find development hotspots, prioritize technical debt, and uncover hidden dependencies" — Verification: book, confirmed via the publisher page only; body not read.
  - [Software Design X-Rays key points](https://understandlegacycode.com/blog/key-points-of-software-design-x-rays/) — Nicolas Carlo, undated — engineering_blog (secondary summary of Tornhill's book) — "With the Hotspot + X-Ray techniques, you can take a 400kLOC codebase and focus on the few hundred lines of code that will have the most impact if they are refactored." — Verification: verbatim.
- **Detect:**
  1. Churn: `git log --since=12.month --no-merges --format=format: --name-only -- . ':!vendor/*' ':!dist/*' ':!*.lock' | grep -v '^$' | sort | uniq -c | sort -nr > churn.txt`
  2. Complexity per function or file: `lizard --csv src/ > lizard.csv` (CCN and NLOC per function), or `scc --by-file -s complexity`.
  3. Intersect the top ~50 of each list; files on both are hotspots. Plot churn (x) against complexity (y) and start in the top-right.
  4. For a large hotspot, count commits per function with `git log -L :<function>:<file> --oneline`, and refactor the most-changed, most-complex functions first.
- **Tools:** git; lizard (active, v1.24.0 Aug 2026); scc (active, v4.1.0 Sept 2026); code-maat; CodeScene; churn gem
- **Applies to:** Any language with git history; most valuable in codebases above a few thousand lines, where effort must be rationed.
- **When not to apply / counterpoints:**
  - Churn may reflect volatile business rules rather than bad code (HN greymalik).
  - Tverdal et al. 2026: temporary spikes and in-progress refactoring inflate the signal ("active refactoring can itself inflate friction").
  - Much hotspot advocacy comes from CodeScene's founder, a conflict of interest, although the underlying process-metric evidence (T19-F01) is independent.
- **Fix risk:** low

### T19-F13 — Do not order work by estimated remediation effort (SQALE/Sonar "technical debt" minutes, debt ratio, or rating). Order by interest — the extra cost paid whenever the code is worked on (change frequency × difficulty) — and use remediation effort only to size and schedule the fixes.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** In the original metaphor, the cost of debt is the ongoing time lost working in not-quite-right code, not the one-off cost of fixing it. Sonar's debt metric sums remediation minutes, which is the principal only. An exploratory study quoted in Code Red found no evidence that Sonar rule violations affect issue lead time. A 2024 benchmark cautions about SonarQube's many false positives.
- **Evidence:**
  - [The WyCash Portfolio Management System (OOPSLA 1992 experience report)](http://c2.com/doc/oopsla92.html) — Ward Cunningham, 1992 — talk — "Shipping first time code is like going into debt… Every minute spent on not-quite-right code counts as interest on that debt." — Verification: both sentences verbatim; the ellipsis elides three intermediate sentences.
  - [Metric definitions (SonarQube Cloud)](https://docs.sonarsource.com/sonarqube-cloud/managing-your-projects/metric-definitions.md) — SonarSource — official_docs — "The technical debt is the sum of the maintainability issue remediation costs"; debt ratio = debt / (cost to develop one line, default 30 minutes, × LOC); rating A ≤5%, B 5-10%, C 10-20%, D 20-50%, E ≥50% — Verification: confirmed.
  - [Code Red: The Business Impact of Code Quality](https://arxiv.org/pdf/2203.04374) — Tornhill, Borg, 2022 — peer_reviewed — "The cost of TD is not the time it would take to fix the code – the remediation work – but rather the additional development work due to technical quality issues. That is, the interest"; it quotes Lenarduzzi et al. (SEAA 2021, "Technical Debt Impacting Lead-Times: An Exploratory Study"): "we have not found evidence that either the presence of a single violation or a number of violations affects the lead time for resolving issues." — Verification: PDF grepped. The Lenarduzzi quote is secondary (primary not opened).
  - [Ghost Echoes Revealed (ICSME 2024)](https://arxiv.org/abs/2408.10754) — Borg, Ezzouhri, Tornhill, 2024 — peer_reviewed — "caution is advised with SonarQube due to its tendency to generate many false positives" — Verification: verbatim in the arXiv abstract. Vendor-affiliated authors benchmarking a competitor.
- **Detect:** If a Sonar/SQALE report exists, do not sort by effort, `sqale_index` or rating. Re-sort maintainability issues by the hotspot rank of their file. Keep Sonar's reliability and security severities (T19-F19).
- **Tools:** SonarQube/SonarCloud (as issue source); git hotspot list
- **Applies to:** Any project that already runs Sonar or another remediation-effort model.
- **When not to apply / counterpoints:** Remediation effort is useful for scheduling: cheap fixes inside hotspots are quick wins. The false-positive benchmark has a conflict of interest.
- **Fix risk:** low

### T19-F16 — Before changing any hotspot, make sure tests pin its current behaviour (add characterization tests where missing). Run them green before and after every small step, and treat class-hierarchy refactorings (pull up/push down method, extract super/subclass) as high-risk steps needing extra review.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Refactorings are not automatically safe. Among 15,008 validated refactorings in three Java systems, hierarchy-related kinds induced faults very frequently. Microsoft developers perceive refactoring as carrying substantial cost and risk. Fowler's rule is to refactor only on green tests and to avoid rabbit holes.
- **Evidence:**
  - [When Does a Refactoring Induce Bugs? An Empirical Study (SCAM 2012)](https://api.openalex.org/works/doi:10.1109/SCAM.2012.20) — Bavota, De Carluccio, De Lucia, Di Penta, Oliveto, Strollo, 2012 — peer_reviewed — "we automatically detect (and then manually validate) 15,008 refactoring operations (of 52 different kinds)… others, such as refactorings involving hierarchies (e.g., pull up method), tend to induce faults very frequently" — Verification: exact OpenAlex reconstruction.
  - [An Empirical Study of Refactoring Challenges and Benefits at Microsoft (IEEE TSE 40(7))](https://www.microsoft.com/en-us/research/publication/an-empirical-study-of-refactoring-challenges-and-benefits-at-microsoft/) — Kim, Zimmermann, Nagappan, 2014 — peer_reviewed — developers "perceive that refactoring involves substantial cost and risks"; "the top 5% of preferentially refactored modules experience higher reduction in the number of inter-module dependencies and several complexity measures but increase size more than the bottom 95%" — Verification: confirmed.
  - [Opportunistic Refactoring](https://martinfowler.com/bliki/OpportunisticRefactoring.html) — Martin Fowler, 1 Nov 2011 — engineering_blog — "you should only refactor when your tests are green"; "There is a genuine danger of going down a rabbit hole here" — Verification: confirmed.
- **Detect:** Get line/branch coverage per hotspot file from the project's coverage tool. Check that tests co-change with the hotspot (code-maat coupling between source and test files). Manual: list the planned refactoring kinds and flag hierarchy changes for extra review.
- **Tools:** per-language coverage tools; code-maat; test runner
- **Applies to:** All languages; OO hierarchies especially.
- **When not to apply / counterpoints:** Hard-to-test code may need small seam-creating refactorings before tests can be added, a bootstrapping cost. Bavota's data is Java-only (Ant, Xerces, ArgoUML) and SZZ-based (heuristic bug-introduction attribution).
- **Fix risk:** medium

### T19-F20 — After cleaning the hotspots, protect the gains with a gate on new or changed code (quality gate or CI check on the diff) instead of attempting a whole-codebase cleanup campaign. Improve old code opportunistically when it is touched, with bounded scope.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Focusing standards on new code gradually cleans the old code that changes touch, and stops cleaned hotspots from regressing. Borg et al. recommend diligently preventing new smells in high-churn files. Fowler's camp-site rule comes with a warning about rabbit holes.
- **Evidence:**
  - [About new code (SonarQube Cloud)](https://docs.sonarsource.com/sonarqube-cloud/standards/about-new-code.md) — SonarSource — official_docs — "When you add new code to your projects, you usually touch a portion of the old code in the process. As a consequence, analyzing and cleaning new code allows you to fix issues in your old code and gradually improve the overall quality of your codebase." — Verification: confirmed. The researcher's "overall code quality" is actually "overall quality".
  - [Opportunistic Refactoring](https://martinfowler.com/bliki/OpportunisticRefactoring.html) — Martin Fowler, 2011 — engineering_blog — "always leave the code behind in a better state than you found it"; "There is a genuine danger of going down a rabbit hole here" — Verification: confirmed.
  - [Increasing, not Diminishing (TechDebt 2024)](https://arxiv.org/abs/2401.13407) — Borg, Pruvost, Mones, Tornhill, 2024 — peer_reviewed — "recommend organizations to diligently prevent the introduction of code smells in files with high churn" — Verification: verbatim (arXiv API).
- **Detect:** Check CI for a quality gate scoped to new code or the PR diff: a Sonar new-code gate, or linters and complexity thresholds run on changed files. If there is none, recommend adding one as the final hardening step.
- **Tools:** SonarQube/SonarCloud quality gates; CI linters on changed files; lizard thresholds in CI
- **Applies to:** Projects that will continue to be maintained.
- **When not to apply / counterpoints:** New-code gates do nothing for dormant dangerous code (T19-F09). They can impose large cleanup obligations on small edits to legacy files, and "new code" windows can be gamed.
- **Fix risk:** low

### T19-F21 — Keep mechanical cleanup (formatting, renames, file moves, lint autofixes) in separate commits from behavioural changes. List those commits in .git-blame-ignore-revs and exclude them from future churn and ownership analyses.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Mass mechanical commits distort blame, ownership and churn, which is the very data used to prioritise. Git and GitHub provide an official mechanism to skip such revisions, and code-maat drops oversized changesets by default.
- **Evidence:**
  - [git-blame documentation](https://git-scm.com/docs/git-blame) — Git project (page last changed in 2.53.0; no changes through 2.55.0, released 2026-06-29) — official_docs — `--ignore-rev`: "Ignore changes made by the revision when assigning blame, as if the change never happened"; `blame.ignoreRevsFile`: "one unabbreviated object name per line" — Verification: confirmed.
  - [Ignore commits in the blame view](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files#ignore-commits-in-the-blame-view) — GitHub Docs — official_docs — create `.git-blame-ignore-revs` "In the root directory of your repository"; examples "Removed semi-colons from the entire codebase", "Converted all JavaScript to TypeScript" — Verification: confirmed.
  - [code-maat README](https://raw.githubusercontent.com/adamtornhill/code-maat/master/README.md) — Adam Tornhill — official_docs — `--max-changeset-size` default 30; `--no-renames` in the recommended log command — Verification: confirmed.
- **Detect:** `git config blame.ignoreRevsFile .git-blame-ignore-revs`. Review each cleanup commit with `git show --stat` and reject commits that mix formatting with logic changes. In analysis scripts, filter out the hashes listed in `.git-blame-ignore-revs`.
- **Tools:** git; GitHub blame view; code-maat
- **Applies to:** All git repositories.
- **When not to apply / counterpoints:** Ignoring a commit that was not purely mechanical hides a real behaviour change. Renames break per-file history unless `--follow` or rename detection is used.
- **Fix risk:** low

### T19-F07 — In polyglot repos, or languages without a mature analyzer, rank complexity with a language-independent proxy (indentation statistics, lizard, or scc's branch-count estimate). Compare complexity scores only between files of the same language.
- **Grade:** B · **Verdict:** CORRECTED
  - lizard's README lists 26 languages, not "30+".
  - Hindle et al. validated indentation as a proxy for the complexity of *revisions/diffs* in CVS-era SourceForge projects. Using it for whole files is an extrapolation.
- **Rationale:** Indentation statistics correlate linearly and by rank with McCabe/Halstead measures across 278 projects and need no parser. Tool authors warn that their estimates are not comparable across languages.
- **Evidence:**
  - [Reading Beside the Lines: Indentation as a Proxy for Complexity Metrics (ICPC 2008)](https://api.openalex.org/works/doi:10.1109/ICPC.2008.13) — Hindle, Godfrey, Holt, 2008 — peer_reviewed — "entire CVS histories of the 278 of the most popular and most active SourceForge projects… our results are linearly correlated and rank-correlated with traditional measures of complexity, suggesting that measuring indentation is a cheap and accurate proxy for code complexity of revisions" — Verification: exact OpenAlex reconstruction.
  - [scc README](https://github.com/boyter/scc) — Ben Boyter (v4.1.0, Sept 2026, active) — official_docs — "The complexity estimate is really just a number that is only comparable to files in the same language."; `scc --by-file -s complexity` — Verification: confirmed. The estimate counts branch and loop tokens, not an AST.
  - [lizard README](https://github.com/terryyin/lizard) — Terry Yin (v1.24.0, Aug 2026, active) — official_docs — 26 languages listed; per-function NLOC, CCN, token count, parameter count; `-C` "The default value is 15"; `-L` "The default value is 1000"; `--csv` — Verification: README.rst read directly.
- **Detect:** `scc --by-file -s complexity --format csv > scc.csv` and `lizard --csv . > lizard.csv`. For the indentation proxy per file, expand tabs, then compute the mean and max leading spaces per non-blank line with awk. Rank within each language separately, then merge the per-language top-N lists.
- **Tools:** lizard; scc; awk/expand
- **Applies to:** Polyglot repos, DSLs, templates, shell/SQL-heavy projects.
- **When not to apply / counterpoints:** Indentation depends on formatter settings and breaks on minified or generated code. scc's figure is a file-level approximation that misses recursion. Cross-language ranking remains invalid.
- **Fix risk:** low

### T19-F15 — For each top hotspot, check authorship. If most recent changes come from marginal (minor) contributors, or the main author has left, add characterization tests and short design notes before refactoring, and keep refactoring steps small.
- **Grade:** C · **Verdict:** DOWNGRADED (B → C)
  - The only empirical support is one vendor-affiliated observational study (EASE 2023). It uses a proprietary quality metric and measures *time*, not defects or regressions.
  - The prescription (characterization tests and design notes when ownership is marginal) is an inference from that result, not something any source tested.
  - Graves et al. found that the number of developers did not predict faults.
  - The characterization-test source is a tertiary definition (Wikipedia), used only for the term.
- **Rationale:** Most changes to low-quality code are made by developers with low ownership. In low-quality code, marginal owners needed 45% more time for small changes and 93% more for large ones. That knowledge loss also makes changes *riskier* is plausible but was not measured.
- **Evidence:**
  - [U Owns the Code That Changes and How Marginal Owners Resolve Issues Slower in Low-Quality Source Code (EASE 2023)](https://arxiv.org/abs/2304.11636) — Borg, Tornhill, Mones, 2023 — peer_reviewed — "We mine 40 proprietary software repositories… most changes to low-quality source code are made by developers with low levels of ownership. In low-quality source code, marginal owners need 45% more time for small changes, and 93% more time for large changes." — Verification: verbatim in abstract. Vendor-affiliated; observational.
  - [code-maat README](https://github.com/adamtornhill/code-maat) — Adam Tornhill — official_docs — analyses include authors, main-dev, entity-ownership, fragmentation, age — Verification: confirmed.
  - [Characterization test](https://en.wikipedia.org/wiki/Characterization_test) — Wikipedia (term coined by Michael Feathers, *Working Effectively with Legacy Code*) — other — "a means to describe (characterize) the actual behavior of an existing piece of software" — Verification: confirmed. Tertiary source used only for the definition.
- **Detect:** `git shortlog -sn --no-merges --since=12.month -- <file>`, or `java -jar code-maat-*.jar -l logfile.log -c git2 -a entity-ownership` (also `-a main-dev` and `-a fragmentation`). Compare authors against currently active contributors (`git shortlog -sn --since=3.month`).
- **Tools:** git shortlog; code-maat
- **Applies to:** Team codebases. Not meaningful for solo projects, or where all commits (including AI-agent commits) share one identity.
- **When not to apply / counterpoints:** Graves et al. saw "no evidence of a 'too many cooks' effect": the number of developers did not help predict faults. That is a different outcome (faults, not time).
- **Fix risk:** low

### T19-F19 — Give every finding two independent labels. (1) Consequence severity, per software quality: Blocker/High/Medium/Low/Info (Sonar MQR), with CVSS v4.0 bands for vulnerabilities. (2) Location priority: hotspot rank, or "stable long tail". Order work by severity first, then hotspot rank. Only Blocker/High (plus Medium inside hotspots) are blocking; style issues are non-blocking nits.
- **Grade:** C · **Verdict:** DOWNGRADED (B → C)
  - Every scale cited is real, current and quoted correctly: Sonar MQR, CVSS v4.0, Conventional Comments, Google review practice.
  - The rule itself goes beyond them: the two-axis scheme, "severity first, then hotspot rank", and "Medium inside hotspots is blocking" come from no source and have never been validated.
  - The grade therefore reflects the evidence for the *combination*, not for the individual scales (which are A-grade definitions).
- **Rationale:** Consequence and location are different questions. Official severity scales define consequence, the hotspot evidence defines where maintainability work pays, and review conventions separate blocking from non-blocking comments. Kruchten et al. note that each debt item can be eliminated, reduced or mitigated rather than always removed.
- **Evidence:**
  - [MQR mode (SonarQube Server 2025.2)](https://docs.sonarsource.com/sonarqube-server/2025.2/instance-administration/analysis-functions/instance-mode/mqr-mode.md) — SonarSource, 2025 — official_docs — Blocker "…should be fixed immediately"; High "An issue with a high impact on the application that should be fixed as soon as possible"; Medium "An issue with a medium impact"; Low "An issue with a low impact"; Info "There is no expected impact on the application. For informational purposes only."; severity assigned "for each quality it impacts" — Verification: confirmed. The unversioned latest page has the same definitions.
  - [CVSS v4.0 Specification Document (v1.2)](https://www.first.org/cvss/v4-0/specification-document) — FIRST, 18 June 2024 — standard — None 0.0; Low 0.1-3.9; Medium 4.0-6.9; High 7.0-8.9; Critical 9.0-10.0; "Consumers may use CVSS information as input to an organizational vulnerability management process that also considers factors that are not part of CVSS" — Verification: confirmed. The CVSS v4.0 [User Guide](https://www.first.org/cvss/v4-0/user-guide) v1.2 (2025-11-14) has a section titled "CVSS Base Score (CVSS-B) Measures Severity, not Risk".
  - [Conventional Comments](https://conventionalcomments.org/) — conventionalcomments.org — other — "Nitpicks are trivial preference-based requests. These should be non-blocking by nature."; (blocking): "should prevent the subject under review from being accepted, until it is resolved" — Verification: verbatim.
  - [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html) — Google Engineering Practices — official_docs — "there is no such thing as 'perfect' code—there is only better code"; "prefix it with something like 'Nit: '" — Verification: verbatim.
  - [Managing Technical Debt: Reducing Friction in Software Development](https://www.sei.cmu.edu/library/managing-technical-debt-reducing-friction-in-software-development/) — Kruchten, Nord, Ozkaya, Addison-Wesley 2019 — book — "Choose the right solution for each technical debt item: eliminate, reduce, or mitigate" — Verification: book, confirmed via the SEI library page description only.
- **Detect:** Suggested mapping, a synthesis and not a validated standard. Each item also states its action: eliminate, reduce or mitigate.
  - **BLOCKER:** vulnerability with CVSS ≥ 9.0, data-loss or crash on a main path, or dead-but-activatable code. Fix now regardless of churn.
  - **HIGH:** CVSS 7.0-8.9, a reliability bug on a main path, or alert-level complexity in a top-10 hotspot.
  - **MEDIUM:** maintainability issue in a hotspot, or unexplained cross-module coupling (report it).
  - **LOW:** maintainability issue in stable long-tail code (record only).
  - **INFO/NIT:** style (non-blocking).
- **Tools:** SonarQube/SonarCloud; SAST tools; FIRST CVSS v4.0 calculator
- **Applies to:** The skill's finding schema.
- **When not to apply / counterpoints:**
  - CVSS is severity, not risk.
  - The High/Medium cut-offs for maintainability are not empirically validated, and severity labels are subjective.
  - Sonar's legacy severities (blocker/critical/major/minor/info, Standard Experience mode) differ from MQR levels, so state which scale is used.
  - Many published advisories still carry CVSS v3.1 scores (e.g., Log4Shell), so record the CVSS version.
- **Fix risk:** low

### T19-F04 — Before ranking, strip the noise: exclude generated code, vendored/third-party code, lockfiles, build output and non-code artefacts. Drop mass-change commits (more than ~30 files, formatting sweeps, bulk renames). Report test files in a separate list rather than mixing them with production hotspots.
- **Grade:** C · **Verdict:** VERIFIED (added Google's direct evidence on auto-generated files and Tverdal's caveat on tests)
- **Rationale:** Non-code and bulk commits dominate raw churn counts and push real hotspots down the list. In Google's deployment, unfiltered auto-generated files were repeatedly flagged. Practitioners rank test-file findings below production files with similar scores.
- **Evidence:**
  - [code-maat README](https://raw.githubusercontent.com/adamtornhill/code-maat/master/README.md) — Adam Tornhill — official_docs — "Many codebases include third-party content or non-code artefacts, which might generate noise in the analyses" (exclude with git pathspecs); `--max-changeset-size` default 30 — Verification: confirmed.
  - [Does Bug Prediction Support Human Developers?](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Lewis et al. / Google, 2013 — peer_reviewed — "Auto-generated files were not filtered, and would often be changed, so would end up attached to bug-fixing changes and get flagged"; "Some felt that certain classes of files, such as templates or configuration files, could not even contain bugs by their own definition" — Verification: PDF grepped.
  - [Technical Debt Friction for Maintenance Prioritization](https://arxiv.org/html/2607.01850v1) — Tverdal et al., 2026 — preprint — "participants considered them less relevant and therefore lower priority than production files with similar scores"; friction "reflected a temporary development spike" — Verification: verbatim. The authors add: "We do not interpret the lower priority given to test files as evidence that friction is less meaningful there; rather, it reflects a short-term prioritization choice".
- **Detect:**
  - Pathspec exclusions: `git log ... -- . ':!vendor/*' ':!node_modules/*' ':!dist/*' ':!build/*' ':!*.lock' ':!*.min.js' ':!*.generated.*'`.
  - Find mass commits: `git log --since=12.month --no-merges --format='COMMIT %h' --name-only | awk '/^COMMIT/{if(n>30)print h,n; h=$2; n=0; next} NF{n++} END{if(n>30)print h,n}'`. Filter those hashes out, or pass `--max-changeset-size 30` to code-maat.
  - Split results by path pattern (`test/`, `__tests__`, `*_test.*`, `*.spec.*`).
- **Tools:** git pathspecs; code-maat; awk
- **Applies to:** All repositories; critical in JS/TS (lockfiles, dist), Go (vendor), and anything with codegen.
- **When not to apply / counterpoints:**
  - Config and infrastructure files can be real hotspots: Lewis et al. note that a bug taxonomy includes "configuration faults".
  - A churning test file can signal a fragile test suite.
  - Over-aggressive exclusion hides real problems, so list what was excluded.
  - The 30-file threshold is code-maat's coupling default, not an empirically validated mass-commit cut-off.
- **Fix risk:** low

### T19-F14 — For the few top hotspots, aim for a substantial health improvement (e.g., out of the "alert" band to "healthy") rather than spreading small fixes thinly across many files. Then keep those files from regressing.
- **Grade:** C · **Verdict:** DOWNGRADED (B → C)
  - The specific "deep rather than thin" recommendation rests on a single vendor-affiliated value model (TechDebt 2024).
  - The Code Red numbers are correlational and compare the extreme 1.14% "alert" files with healthy files.
  - CodeScene's "43%" is a projection from its own model, not an observed before/after measurement.
- **Rationale:** The cost of low quality concentrates in the lowest-health code. Alert-level files had about 15x the defects of healthy files (3.70 vs 0.25 Jira defects per file), 124% more development time and 9x longer maximum cycle times. The value model suggests returns increase rather than diminish at the healthy end. Independent survey data puts time lost to technical debt at 23%.
- **Evidence:**
  - [Code Red: The Business Impact of Code Quality (TechDebt 2022)](https://arxiv.org/abs/2203.04374) — Tornhill, Borg, 2022 — peer_reviewed — "By analyzing activity in 30,737 files, we find that low quality code contains 15 times more defects than high quality code… 124% more time in development… 9 times longer maximum cycle times". Cut-offs: "healthy code is 8.0, for alert 4.0", decided "by their internal team via a baseline library of hand-scored code examples". Healthy 27,352 (88.99%), warning 3,035 (9.87%), alert 350 (1.14%) — Verification: abstract plus PDF grep. Vendor-affiliated; 39 proprietary codebases.
  - [Increasing, not Diminishing (TechDebt 2024)](https://arxiv.org/abs/2401.13407) — Borg, Pruvost, Mones, Tornhill, 2024 — peer_reviewed — "the value model suggests strong non-linearities at the extremes of the code quality spectrum. Most importantly, the model suggests amplified returns on investment in the upper end." — Verification: verbatim (arXiv API). Uses two public datasets.
  - [Technical debt cripples software developer productivity (TechDebt 2018)](https://api.openalex.org/works/doi:10.1145/3194164.3194178) — Besker, Martini, Bosch, 2018 — peer_reviewed — "longitudinal study, surveying 43 software developers… developers waste, on average, 23% of their development time due to TD" — Verification: exact OpenAlex reconstruction. Independent of the vendor.
  - [From Tech Debt to Triumph: How Refactoring Speeds Development by 43%](https://codescene.com/blog/benchmarking-code-health-refactoring-roi) — Adam Tornhill / CodeScene, 5 Dec 2024 — industry_report — "27-43% improvement in development speed and between 32-50% reduction in post-release defects", moving from average hotspot Code Health 5.15 to top-5% 9.1 — Verification: confirmed. Derived from CodeScene's statistical model; vendor marketing.
- **Detect:** Without CodeScene, approximate "alert" by functions in top-decile hotspots with lizard CCN > 15 or NLOC far above the repo median. Re-measure after cleanup to confirm real movement, not just a lower issue count.
- **Tools:** CodeScene; lizard; scc
- **Applies to:** Top ~5-20 hotspots of an actively developed codebase.
- **When not to apply / counterpoints:**
  - All impact numbers come from CodeScene founders or staff using a proprietary metric. HN JonChesterfield: "the assessment criteria are opaque".
  - The results are correlational. Ownership is a plausible confounder: Borg et al. 2023 found low-quality code is changed mostly by marginal owners.
  - The lizard-based "alert" proxy is not validated against Code Health.
  - Large refactors raise regression risk (T19-F16).
- **Fix risk:** medium

### T19-F17 — When an AI agent performs the cleanup, treat low-health hotspot files as the highest-risk targets. Work in small, individually verified steps (tests plus diff review), and have a human choose which refactorings to apply. Do not let the agent select and apply refactorings unguided across the codebase.
- **Grade:** C · **Verdict:** CORRECTED (the author of the Thoughtworks article is "CTO for Europe, Middle East and India at Thoughtworks", not "CTO EMEA"; added the article's detail that the codebase was written entirely by agents)
- **Rationale:** A 2026 peer-reviewed study found code health associated with whether AI refactoring preserves semantics, so the worst files are where AI changes are least safe. A 2026 practitioner experiment on an agent-written Rust app found the agent unable to choose refactorings itself, although the refactored code cut the tokens it needed per change by 83%.
- **Evidence:**
  - [Code for Machines, Not Just Humans: Quantifying AI-Friendliness with Code Health Metrics (FORGE 2026)](https://arxiv.org/abs/2601.02200) — Borg, Hagatulah, Tornhill, Söderberg, 2026 — peer_reviewed — "a dataset of 5,000 Python files from competitive programming. We find a meaningful association between CodeHealth… and semantic preservation after AI refactoring"; "organizations can use CodeHealth to guide where AI interventions are lower risk and where additional human oversight is warranted" — Verification: verbatim in abstract. Vendor-affiliated.
  - [The Economic Benefit of Refactoring](https://martinfowler.com/articles/exploring-gen-ai/refactoring-economic-benefit.html) — Giles Edwards-Alexander (Thoughtworks), on martinfowler.com, 30 July 2026 — engineering_blog — The app is "approximately 150,000 lines of code, primarily in Rust… This was entirely written by agents". The data access layer "reached 17,155 lines. In a single Rust file". "input tokens for the same task reduced from 159,564 to 27,360. A saving of 132,204 tokens, or 83%". "Claude was not good at refactoring"; "Claude is unable to look at code, look at refactorings in general and work out which are suitable to apply: a human needs to actively guide it"; "the single most valuable refactoring was missed in the first pass" — Verification: page grepped verbatim.
- **Detect:** After each agent refactoring step, run the full test suite, type check and lint. The diff should touch only the intended function or file, with no public API change unless planned. Reject steps that mix mechanical and behavioural edits.
- **Tools:** test runner; type checker; `git diff --stat`
- **Applies to:** Any cleanup executed by coding agents, which is exactly this skill's use case.
- **When not to apply / counterpoints:**
  - The FORGE study used competitive-programming Python files and vendor-affiliated authors, so external validity is uncertain. The Thoughtworks result is a single experiment.
  - HN dash2: "the value saved was on the order of cents". HN disgruntledphd2's rebuttal: savings "would add up over time".
- **Fix risk:** high

### T19-F22 — Ask for, or infer, where upcoming work will land. Cleanup in a currently stable area is justified when planned changes will touch it repeatedly; otherwise it waits until it starts to churn.
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** Fowler's worked example: removing cruft first is no gain for a single feature, but pays off when two more similar features are coming. For a "finished" project, the roadmap is the best available proxy for future change frequency.
- **Evidence:**
  - [Technical Debt](https://martinfowler.com/bliki/TechnicalDebt.html) — Martin Fowler, 2019 — engineering_blog — "If I only do it for this one feature, that's no gain, as I'd take nine days instead of six. But if I have two more similar features coming up, then I'll end up faster by removing the cruft first." — Verification: verbatim.
  - [Breaking Up the Behemoth](https://sandimetz.com/blog/2017/9/13/breaking-up-the-behemoth) — Sandi Metz, 2017 — engineering_blog — "Ignore code in this quadrant until it starts to churn." — Verification: verbatim.
- **Detect:** Manual: ask the user for planned features and the modules they touch. Also check open issues and TODO density per file: `git grep -n -E 'TODO|FIXME|HACK' | cut -d: -f1 | sort | uniq -c | sort -nr`.
- **Tools:** git grep; issue tracker
- **Applies to:** Projects with a known roadmap; less useful for truly frozen projects.
- **When not to apply / counterpoints:** Roadmaps are often wrong (YAGNI). Fowler's numbers are illustrative, not measured.
- **Fix risk:** low

## Practitioner voice

Each item below was re-checked against the original comment or page. HN comments were checked via the HN Algolia API.

- [HN: "Code quality only matters in context (2019)", giraffe_lady, 28 May 2022](https://news.ycombinator.com/item?id=31537655) — "When you find something real blood-curdling but the last commit in that file was three and a half years ago, you just close it and pretend you didn't see. Better to spend the effort somewhere it will definitely benefit someone soon". Leaving stable cruft alone in practice.
- [Same thread, robert_tweed](https://news.ycombinator.com/item?id=31537655) — "The changes you really need to worry about are to code nobody has touched for 3 years and whoever wrote it no longer works for the company." He proposes ranking by "frequency of appearance in the runtime call-graph" instead of frequency of modification. Pushback: stable code becomes the risk the moment it must change.
- [Same thread, greymalik and kbuchanan](https://news.ycombinator.com/item?id=31537655) — greymalik: code may churn "because it's related to business rules, which are typically more volatile than infrastructure code". kbuchanan: "Long-tail code can also be long tail because it was well-written from the beginning." Churn is not the same as bad code.
- [HN: CodeScene "Code quality: measuring the business impact of unhealthy code", March 2022](https://news.ycombinator.com/item?id=30705584) — JonChesterfield: the tool "rates code on a 1 to 10 scale on a few axes where the assessment criteria are opaque". john-shaffer (the story's submitter, stating "I have no affiliation") found flagged files "definitely overly complex", but "it gave perfect scores to some files with complex jobs that are better-designed".
- [HN: "The Economic Benefit of Refactoring", July 2026](https://news.ycombinator.com/item?id=49111176) — dash2: "the real punchline was that the value saved was on the order of cents". stingraycharles (the researcher wrongly attributed this to danbruc): "Lines of code is a terrible metric for pretty much any goal that refactorings are meant to tackle." pmg101: "LLMs greatly benefit from well factored code, but are not particularly adept at creating such code."
- [The Economic Benefit of Refactoring](https://martinfowler.com/articles/exploring-gen-ai/refactoring-economic-benefit.html) — Thoughtworks CTO for Europe, Middle East and India, 30 July 2026. Refactoring a 17,155-line Rust file in an agent-written app cut agent input tokens per change by 83%. The agent could not choose refactorings itself, and the most valuable refactoring was missed in the first pass.
- [Breaking Up the Behemoth](https://sandimetz.com/blog/2017/9/13/breaking-up-the-behemoth) — Sandi Metz (2017), building on Michael Feathers' churn-vs-complexity chart and Code Climate charts of real apps. Refactor code that "slithers" into the high-churn/high-complexity quadrant, and "Ignore" complex code that never changes "until it starts to churn".
- [Does Bug Prediction Support Human Developers?](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/41145.pdf) — Google (ICSE 2013). A company-wide bug-prediction ranking produced "no identifiable change in developer behavior". Engineers wanted a top-20 list, obvious reasoning, actionable next steps and a bias towards current problems.
- [Technical Debt Friction for Maintenance Prioritization](https://arxiv.org/html/2607.01850v1) — industrial multi-case study (2026; 3 products, 10 practitioners). Practitioners found friction useful but deprioritised flagged test files and an isolated, weakly coupled file (33% friction). They discounted temporary spikes and noted the signal misses rarely changed but hard-to-change files.
- [SEC order on Knight Capital](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — Power Peg was unused since 2003 but "present and callable", modified in 2005, and reactivated in 2012 by a repurposed flag on the one server (of eight) that missed the new code. About 45 minutes of runaway orders and a loss of over $460M. Untouched code is not safe code.
- [Focus refactoring on what matters with Hotspots Analysis](https://understandlegacycode.com/blog/focus-refactoring-with-hotspots-analysis/) — Nicolas Carlo. One `git log` pipeline for the 50 most-changed files over the last 12 months ("it's good enough"), intersected with "any complexity metric".
- [Why I Write Dirty Code](https://www.adamtornhill.com/articles/code-quality-in-context/why-i-write-dirty-code.html) — Adam Tornhill (CodeScene founder), Oct 2019. He compromises quality only in the rarely changed long tail, and only when it saves time. Note the vendor interest.

## Contradictions and open questions

**Contradictions (verified on both sides):**
- **File size as a signal.** The outcome variables differ (effort vs. resolution time vs. defects), so whether size matters depends on what is predicted.
  - Sjøberg et al. 2013: file size plus changes explained almost all maintenance effort.
  - Code Red 2022: added LoC correlates weakly with issue resolution time (r=0.13), versus r=-0.58 for Code Health.
  - Walkinshaw & Minku 2018: LOC is poorly correlated with defect-proneness.
  - Graves 2000: LOC adds nothing once change counts are known.
- **Value of code-smell findings.**
  - Palomba et al. 2018 (30 projects, 17,350 instances): smelly classes are more change- and fault-prone.
  - Sjøberg et al. 2013 (controlled, 6 developers): no smell increased effort after adjusting for size and changes, and Refused Bequest was associated with less effort.
- **Pareto concentration.**
  - Ostrand et al. 2005: 83% of faults on average in the top 20% of predicted files.
  - Kim et al. 2007: 73-95% of faults in 10% of files.
  - Walkinshaw & Minku 2018: 80/20 holds only when multi-file fixes are counted several times, and focusing on the top files alone "would probably be misguided".
- **Co-change as a signal.**
  - Graves 2000: modules "changed in tandem" was a poor fault predictor.
  - Kim et al. 2007 (co-changed locations in the fault cache) and Xiao/Mo et al. (history-coupling architecture debt) find co-change useful.
  - Methods differ: raw tandem-change frequency versus structured patterns.
- **Leave stable code alone?**
  - Yes: Fowler 2019, Metz 2017, Graves 2000 (a year older means roughly a third fewer faults), Spolsky 2000, Tornhill 2019.
  - No: HN robert_tweed, Tverdal et al. 2026, the Knight Capital SEC order and Log4Shell (`JndiLookup.java` untouched from 2017 to 2021) show dormant or long-lived code can hold the most severe risks.
  - Resolution used here: the stable-code discount applies to maintainability only, never to security, correctness or activatable dead code.
- **Old versus new files.**
  - Graves: older modules have fewer faults, and Google's TWR deliberately decays old fix commits.
  - Yet Google interviewees believed older files were more bug-prone.
  - Carlo's summary of Tornhill's X-Rays: code is desirable only when "Very recent" or "Very old".
- **Ownership.** Graves 2000: no "too many cooks" effect on faults. Borg et al. 2023: marginal owners need 45-93% more time in low-quality code (time outcome).
- **Independence of evidence.** Most hotspot and Code Health business-impact numbers come from CodeScene's founder and research staff, using a proprietary metric whose thresholds were set by "hand-scored code examples":
  - Code Red, TechDebt 2024, EASE 2023, ICSME 2024, FORGE 2026, Tverdal 2026, the 43% blog.
  - Independent support exists for the process-metric premise (Graves; Nagappan & Ball; Rahman & Devanbu; Kim et al.; Ostrand et al.), but not for the Code Health thresholds.
- **Measuring debt.**
  - Sonar defines debt as summed remediation minutes, with rating thresholds at 5/10/20/50%.
  - Cunningham, Fowler and Code Red define the cost as interest paid while working in the code.
  - The vendor-affiliated ICSME 2024 benchmark cautions about SonarQube false positives.
- **Opportunistic cleanup.** Sonar's new-code approach and Fowler's camp-site rule encourage improving code when touched. Fowler warns of rabbit holes, and Kim et al. 2014 report developers perceive refactoring as costly and risky.

**Open questions:**
- **Thin or agent-generated history.** No source was found on the minimum history length that makes churn or hotspot ranking meaningful, or on how agent-authored bulk commits and a single git identity distort churn and ownership. This is the core scenario for a "finished project" skill. The fallback (criticality plus static complexity plus roadmap) is unvalidated.
- **Window length.** No study compares analysis windows (6 vs 12 vs 24 months). 12 months is practitioner and CodeScene convention; 6-8 months was Google's decay tuning.
- **Cut-offs.** Hotspot cut-offs (top-N, knee-point) and Code Health thresholds (8.0/4.0) have no independent validation.
- **Schulte, Sajnani, Czerwonka, ICSE Companion 2014 ("Active files as a measure of software maintainability").** Semantic Scholar's *machine-generated* TLDR says "The majority of active files are architectural hub files which change due to feature addition as opposed to fixing defects". The abstract retrievable via OpenAlex does not contain that sentence, and the ACM full text was blocked (403). Treat as unverified.
- **El Emam et al. 2001.** The OpenAlex abstract ends before the paper's post-size-adjustment conclusion, so only the "strong size confounding effect" claim is verified.
- **Not re-read in primary form:**
  - the Lenarduzzi et al. SEAA 2021 lead-time study (quoted only via Code Red);
  - Michael Feathers' 2011 "Getting Empirical about Refactoring" (credited by Metz, not opened);
  - the Stripe Developer Coefficient 42% figure (quoted only via Code Red);
  - Kruchten/Nord/Ozkaya 2019 (description only);
  - *Your Code as a Crime Scene* 2nd ed. (publisher page only).
- **Not assessed.** Whether AI-agent cleanup changes the cost-benefit for stable code: it is cheaper to refactor, but riskier per FORGE 2026. Evidence is limited to one vendor study and one single-app experiment.
- **Research-process limitation.** WebSearch quota was exhausted in both the research and the verification passes. Verification used direct URLs, the arXiv/OpenAlex/Semantic Scholar/Crossref APIs, the HN Algolia API and the GitHub API. Reddit and Software Engineering Stack Exchange perspectives, and failure stories about cleanup campaigns that broke production, are still missing.

## Dropped findings

No finding was dropped outright. Sub-claims removed or replaced during verification:
- **T19-F02 counterpoint:** "most active files are architectural hubs changed for feature additions, not fixes" (Schulte et al. 2014). Dropped as evidence because it is only in a machine-generated Semantic Scholar TLDR and is not in the retrievable abstract. Moved to open questions.
- **T19-F03 quote:** "over typically 12-month periods" (Tverdal et al.). Not in the paper; replaced with the verbatim "commit activity over the last 12 months".
- **Practitioner voice:** "Lines of code is a terrible metric…" was attributed to danbruc. The HN Algolia API shows the author is stingraycharles, so the attribution was corrected. A WebFetch summary had wrongly "confirmed" danbruc, which is why HN attributions were checked against the raw API.
- **T19-F22 counterpoint:** "HN nycticorax asked for evidence comparing feature cost before and after refactoring, which is rarely measured". Removed. nycticorax's comment is in thread 49111176, not 31537655. The article's author (gga) replied that the token figures already *were* the cost of adding the same feature after each refactoring, so "rarely measured" misrepresents the exchange.
- **T19-F07 claim:** lizard supports "30+ languages". The README lists 26; corrected.
- **T19-F09 framing:** Knight Capital's Power Peg as "code nobody had touched". The SEC order shows it was modified in 2005, and the 2012 trigger included a deployment error. The framing was qualified rather than dropped.
