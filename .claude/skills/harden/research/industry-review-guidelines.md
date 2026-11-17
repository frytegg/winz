# Industry code review and code health guidelines
> Code T02 · slug industry-review-guidelines · verified 2026-09-23 · counts: verified 9 / corrected 9 / downgraded 2 / dropped 0

## Summary

This dossier covers the published review and code-health guidance of these sources:
- Google: eng-practices; *Software Engineering at Google* (O'Reilly 2020, free online); Google Testing Blog "Code Health" and related posts, 2017-2023.
- Chromium, LLVM, the Linux kernel, Mozilla and GitLab.
- Microsoft's Engineering Fundamentals Playbook (reviewer page last updated 22 Aug 2024).
- PEP 8.

That guidance is checked against peer-reviewed studies of modern code review:
- Mäntylä & Lassenius, TSE 2009
- Bacchelli & Bird, ICSE 2013
- Beller et al., MSR 2014
- Czerwonka et al., ICSE 2015 (a 2-page industry paper)
- Bosu et al., MSR 2015
- McIntosh et al., EMSE 2016
- Sadowski et al., ICSE-SEIP 2018
- Spadini et al., ICSE 2019
- Krutauz et al., EMSE 2020
- Paul et al., ICSE 2021

It is also checked against three sources on AI-assisted review: Tufano et al. (ICSE 2025), Crupi et al. (accepted at ICPC 2026) and a Greptile vendor report (Dec 2024).

For this pass the verifier reopened every source. Web pages and PDFs were downloaded and searched for the exact phrases. Paywalled papers were checked through DOI metadata (Crossref) and abstracts (OpenAlex, arXiv). HN comments were checked through the Algolia API, and StackExchange answers through the StackExchange API. The GitHub repositories of the tools cited were checked, and all were active and not archived in Sept 2026.

Seven conclusions hold up:

1. **Design comes first, and the bar is "improves code health", not "perfect".** Google's reviewer checklist runs in this order: design, functionality (including concurrency), complexity and over-engineering, tests, naming, comments, style. Of these, only design is explicitly called "the most important thing". Microsoft points human reviewers at business logic, tests and design readability, without a ranking. *(Correction: the researcher called this an agreed "industry priority order". Only Google publishes an ordered list.)*
2. **Style belongs to formatters and linters.** Reviewers are told not to comment on style by hand and not to bikeshed. LLVM and PEP 8 say not to mass-reformat code you are not otherwise changing.
3. **Every comment says whether it blocks.** Google uses Nit/Optional/FYI; GitLab uses Conventional Comments with "(non-blocking)". AI reviewers over-produce low-value comments:
   - Greptile's own bot (a vendor self-report) was 79% nits, defined as "technically true but not something the dev cared about". Only 19% of its comments were addressed.
   - In Crupi et al., ChatGPT-4 made about 2.4x more comments than humans but caught only 10% of the issues humans raised. About 40% of its extra comments were meaningful.
4. **Changes should be small, single-purpose and bisectable.** Refactorings, moves, formatting and behaviour changes go in separate commits. The numbers:
   - Google: 100 lines is "usually a reasonable size" and 1000 is "usually too large"; a 200-line change "spread across 50 files" would usually be too large. The SWE book puts "small" at about 200 lines.
   - The median change at Google is 24 lines. That describes practice; it does not show that smaller is better.
   - At Microsoft, review usefulness drops only once a review has 20 or more files.
   - In the Chromium OS case-control model, more directories under review were associated with a higher chance of missing a security defect (odds ratio 0.76 for catching it).
5. **Review mostly finds evolvability issues, not functional bugs.** Mäntylä & Lassenius found 75% of review defects did not affect visible functionality; Beller et al. found a similar 75:25 split in two open-source projects. At Microsoft, defects were about 14-15% of review comments.
   - So a reading-based hardening pass needs a test or reproduction for every correctness claim.
   - Reviewers tend to miss security defects that need wider context. In a Chromium OS case-control sample, about 88% of the sampled input-validation (CWE-20) and access-control (CWE-284) defects went unnoticed in review. That is a share of the sample, not a population miss rate.
6. **Google's static-analysis policy fits a finished codebase.** Focus on newly introduced warnings, and fix old warnings in stable working code only if they are security issues or significant bugs. Never "fix" a dead-code warning by calling the dead code. Keep only checks that developers see as pointing at a real issue at least 90% of the time. Make each check an error or hide it; do not leave warnings people ignore.
7. **Delete dead code; do not leave it callable.** The strongest failure case is the SEC order on Knight Capital. Power Peg code, unused since 2003, stayed callable, and it had not been retested after a 2005 change. A new feature reused its flag, one of eight servers missed the deploy, erroneous orders ran for about 45 minutes, and Knight lost over $460 million. The SEC also blames the deployment process (no second technician, no written procedures), so dead code was one cause among several.

Main conflicts, detailed under the contradictions heading:
- Do review measures predict post-release defects? McIntosh found a link; the Krutauz replication found it unstable.
- Should you clean up legacy code as you pass it? The conflict is narrower than the researcher reported: Chromium's "clean up" line covers only pre-rule ownership code.
- Are nits noise or a useful signal?
- Should reviewers read tests first? Practitioners and Microsoft's playbook suggest it. A controlled experiment found it catches the same share of production defects, more test defects, and fewer production maintainability issues.

## Findings

### T02-F13 — Classify findings as functional vs evolvability, and require a failing test or repro for every claimed defect
- **Grade:** A for the descriptive finding. The repro requirement is an engineering inference built on it.
- **Verdict:** CORRECTED.
  - Added the primary Mäntylä & Lassenius source (abstract); the researcher had cited it only second-hand.
  - The studies count different units: Mäntylä counts defects, Beller counts changes, Bacchelli and Czerwonka count comments.
  - "Expect about 3 evolvability findings per functional one" is an extrapolation from human review of diffs to an AI pass, not a measured property of AI output.
  - Beller studied two open-source projects (ConQAT, GROMACS). The industrial and academic data are Mäntylä's: 9 industrial and 23 student reviews.
  - The researcher's line "a skill that asserts bugs without proof will mostly produce false alarms" goes beyond the sources and was removed.
  - Czerwonka et al. is a 2-page ICSE 2015 SEIP paper (pp. 27-28) that summarises Microsoft data without a methods section.
- **Rationale:** Every classification study of review output found here says the same thing: most review outcomes concern evolvability, not visible functionality. Google says correctness checking is not the main benefit of review; review is one element of "defense-in-depth". So a reading-only pass has weak support for asserting bugs. A claimed defect therefore needs a failing test or a concrete repro before any code changes; without one it is reported as a question. The 3:1 ratio describes human review, and using it as a sanity check on an AI pass is a heuristic.
- **Evidence:**
  - [What Types of Defects Are Really Discovered in Code Reviews?](https://doi.org/10.1109/TSE.2008.71) — Mäntylä & Lassenius, IEEE TSE, 2009 (online 2008) — peer_reviewed — "we classified the defects of nine industrial (C/C++) and 23 student (Java) code reviews, detecting 388 and 371 defects, respectively. First, we discovered that 75 percent of defects found during the review do not affect the visible functionality of the software." — verified in the abstract via OpenAlex; full text is paywalled.
  - [Modern Code Reviews in Open-Source Projects: Which Problems Do They Fix?](http://sback.it/publications/msr2014.pdf) — Beller, Bacchelli, Zaidman, Juergens, MSR 2014 — peer_reviewed — "We manually classified over 1,400 changes... strikingly similar to those in the industry and academic systems from literature, featuring the similar 75:25 ratio of maintainability-related to functional problems. We also reveal that 7–35% of review comments are discarded" — verbatim in the PDF.
  - [Expectations, Outcomes, and Challenges of Modern Code Review](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ICSE202013-codereview.pdf) — Bacchelli & Bird, ICSE 2013 — peer_reviewed — "the category 'defect' is the only the fourth most frequent, out of nine items, with 78 (14%) comments" (the doubled "the only the" is sic); defect comments "mostly address 'micro' level and superficial concerns" — verbatim in the PDF. The sample is 570 comments from 200 threads.
  - [Code Reviews Do Not Find Bugs: How the Current Code Review Best Practice Slows Us Down](https://www.microsoft.com/en-us/research/wp-content/uploads/2015/05/PID3556473.pdf) — Czerwonka, Greiler, Tilford (Microsoft), ICSE 2015 SEIP, 2 pages (Crossref 10.1109/ICSE.2015.131) — peer_reviewed (short industry paper) — "Only about 15% of comments provided by reviewers indicate a possible defect, much less a blocking defect. Rather, it is feedback related to the long-term code maintainability that comprises a much larger portion of comments provided by reviewers; at least 50% of all." — verbatim in the PDF.
  - [Software Engineering at Google, Ch. 9 Code Review](https://abseil.io/resources/swe-book/html/ch09.html) — chapter by Tom Manshreck & Caitlin Sadowski; book eds. Winters, Manshreck, Wright; O'Reilly 2020 — book (free online) — "it is an element of a defense-in-depth against such problems in software. As a result, code review does not need to be 'perfect' to achieve results." — verbatim.
- **Detect:**
  - Tag each finding `functional` or `evolvability`.
  - Every `functional` finding must carry a failing test, a repro command or a concrete input and output. Without one, relabel it `question` (Conventional Comments).
  - Heuristic only: if functional findings far outnumber evolvability ones, re-check them for false positives.
- **Tools:** the project's test runner; Conventional Comments labels.
- **Applies to:** All review and hardening reports.
- **When not to apply / counterpoints:** The studies measure human review of diffs, often from older (2000s-2010s) processes, not an AI reading a whole finished codebase. McIntosh et al. (EMSE 2016) found that review coverage, participation and expertise "share a significant link with software quality". The Krutauz et al. replication (EMSE 2020) found that link "highly sensitive to variable selection procedure".
- **Fix risk:** low

### T02-F14 — Run a dedicated whole-program trust-boundary pass (sources to sinks, validation, authorisation, authenticity, logging)
- **Grade:** B
- **Verdict:** CORRECTED. Paul et al. is a case-control study: 516 reviews that caught a security defect vs 374 that missed one. The "88% undetected" figures are shares of that curated sample, not population detection rates, and the wording has been fixed. The quotes and numbers are otherwise exact. The venue is confirmed as ICSE 2021 (Crossref 10.1109/ICSE43902.2021.00124).
- **Rationale:** In the Chromium OS sample, reviewers reliably caught security defects visible in a few lines:
  - No dangerous-function (CWE-676) defect escaped review.
  - Reviewers were "highly efficient" on improper resource shutdown or release (CWE-404).
  - Incorrect calculation, including buffer-size arithmetic (CWE-682), was identified 80% of the time.

  Defects that need wider context mostly escaped:
  - about 88% of the sampled CWE-20 (improper input validation) cases;
  - about 88% of the CWE-284 (improper access control) cases;
  - every CWE-345 case (insufficient verification of data authenticity);
  - most CWE-672 cases (operation on a resource after expiration or release).

  Mozilla's reviewer checklist writes down the matching checks for hostile input, privacy-safe logging and resources. A file-by-file reading pass therefore needs a separate pass over the whole program's trust boundaries.
- **Evidence:**
  - [Why Security Defects Go Unnoticed during Code Reviews? A Case-Control Study of the Chromium OS Project](https://arxiv.org/pdf/2102.06909) — Paul, Turzo, Bosu, ICSE 2021 — peer_reviewed — "Although Improper input validations (CWE-20) were frequent occurrences (i.e., 72), those remained undetected during 88% code reviews"; "Approximately 88% security defects caused by improper access control (CWE-284) also remained undetected"; CWE-345: "all such occurrences remained undetected"; "no occurrences of dangerous functions escaped code reviews" — verbatim in the PDF.
  - [Reviewer Checklist](https://firefox-source-docs.mozilla.org/contributing/reviewer_checklist.html) — Mozilla (Firefox Source Docs), current — official_docs — "Assume that inputs will be too big, too short, empty, malformed, or malicious."; "There should be no logging of URLs or content from which URLs may be inferred."; "Ensure all file handles and other closeable resources are closed appropriately."; "All caught exceptions should be logged at the appropriate level" — verbatim.
- **Detect:**
  - List the entry points: route and handler registrations, CLI arguments, environment reads, deserialisers (`JSON.parse`, `yaml.load(`, `pickle.loads`, `json.loads`), queue consumers.
  - Trace each entry point to its sinks: SQL string building, `exec`/`spawn`/`subprocess`/`system(`, file paths, HTML output, redirects.
  - For every handler, confirm an authorisation check and input bounds (size, length, emptiness, format).
  - Grep log calls for url, token, password, secret, authorization or cookie.
  - Where available, add taint-tracking SAST and fuzz the parsers.
- **Tools:** rg, CodeQL, Semgrep, fuzzers (atheris, `go test -fuzz`, cargo-fuzz; atheris and cargo-fuzz repos active and not archived in Sept 2026).
- **Applies to:** Any code that crosses a trust boundary: web services, CLIs, parsers, bots, off-chain components.
- **When not to apply / counterpoints:** The data come from one C/C++ project and a correlational case-control design. SAST taint tools have false positives of their own. New validation can reject inputs that used to be accepted, which is a behaviour change (see F16).
- **Fix risk:** medium

### T02-F04 — Deliver hardening as small, single-purpose, bisectable change units
- **Grade:** B
- **Verdict:** VERIFIED. Every quote and number was confirmed. Three additions:
  - Google's page also says the number of files matters ("A 200-line change in one file might be okay, but spread across 50 files it would usually be too large").
  - Czerwonka et al. is a 2-page paper.
  - The odds ratio is an association from a case-control model.

  The unlinked StackExchange counterpoint now has a verified URL.
- **Rationale:**
  - Google recommends about 100 lines, calls 1000 "usually too large", and counts file spread as part of size.
  - Google's own data show a median change of 24 lines.
  - At Microsoft, review usefulness fell once a review had 20 or more files.
  - In Chromium OS, more directories under review went with lower odds of catching a security defect.
  - SmartBear's Cisco case study, a vendor study, recommends reviewing under 200 LOC and never over 400, at under 300-500 LOC/hour.
  - The kernel requires every patch in a series to build and run, so that `git bisect` keeps working.
- **Evidence:**
  - [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) — Google eng-practices, undated (accessed 2026-09-23) — official_docs — "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large, but it's up to the judgment of your reviewer." A whole-file deletion counts as about one line; exception for CLs from an automatic refactoring tool "that you trust completely" — verified.
  - [SWE at Google, Ch. 9](https://abseil.io/resources/swe-book/html/ch09.html) — O'Reilly 2020 — book — "'Small' changes should generally be limited to about 200 lines of code." — verbatim.
  - [Modern Code Review: A Case Study at Google](https://sback.it/publications/icse2018seip.pdf) — Sadowski, Söderberg, Church, Sipko, Bacchelli, ICSE-SEIP 2018 — peer_reviewed — "At Google, over 35% of the changes under consideration modify only a single file and about 90% modify fewer than 10 files. Over 10% of changes modify only a single line of code, and the median number of lines modified is 24." — verbatim in the PDF.
  - [Code Reviews Do Not Find Bugs](https://www.microsoft.com/en-us/research/wp-content/uploads/2015/05/PID3556473.pdf) — Czerwonka, Greiler, Tilford, ICSE 2015 SEIP (2 pages) — peer_reviewed (short industry paper) — "the more files there are in a single review, the lower the overall rate of useful feedback. The decrease however only starts to be noticeable for reviews with 20 or more changed files." — verbatim.
  - [Why Security Defects Go Unnoticed during Code Reviews?](https://arxiv.org/pdf/2102.06909) — Paul, Turzo, Bosu, ICSE 2021 — peer_reviewed — "the OR of 'number of directory under review' is 0.76 (i.e. < 1), indicating that, if the 'number of directory under review' increases, a code review is more likely to miss a security defect." — verbatim.
  - [Code Review at Cisco Systems](https://static1.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf) — SmartBear Software, chapter of *Best Kept Secrets of Peer Code Review*, 2006 — industry_report — "LOC under review should be under 200, not to exceed 400... Inspection rates less than 300 LOC/hour result in best defect detection. Rates under 500 are still good... Total review time should be less than 60 minutes, not to exceed 90." — verbatim in the PDF. The study covers 2500 reviews, 3.2M LOC and 50 developers; its outlier filter "cuts out 21% of the reviews". Vendor data, not peer reviewed.
  - [Submitting patches to the Linux kernel](https://docs.kernel.org/process/submitting-patches.html) — kernel docs, current — official_docs — "take special care to ensure that the kernel builds and runs properly after each patch in the series" (for git bisect) — verified.
- **Detect:**
  - Run `git log --shortstat <base>..HEAD`.
  - Flag any commit with more than about 400 non-deletion changed lines, 20 or more files, or several unrelated top-level directories, unless it is a pure deletion or the output of a named codemod. These thresholds are a synthesis of the sources, not a standard.
  - Check bisectability with `git rebase -x '<build && test>' <base>`.
- **Tools:** `git log --shortstat`, `git rebase -x`, `git bisect run`.
- **Applies to:** All projects, and especially the commit series a hardening pass produces.
- **When not to apply / counterpoints:** The thresholds were measured for human attention, not for AI agents. The accepted answer (score 35) to ["How much refactoring is acceptable?"](https://softwareengineering.stackexchange.com/a/280298) says: "The number of affected files during a group of refactoring operations is as irrelevant as the LOC you write per day". Its example is a mechanical rename touching thousands of files.
- **Fix risk:** low

### T02-F17 — Rank the codebase and harden hotspots first (past bug-fixes, size, churn and authorship)
- **Grade:** B (was A)
- **Verdict:** DOWNGRADED.
  - Only one directly relevant source was checked here (Krutauz et al.). It shows that these signals predict post-release defects, and it says this matches "the bulk of prior work".
  - It does not show that hardening hotspots first pays off; that is an inference.
  - The abstract says "authorship" without a direction. The researcher's "files touched by many authors" is an assumption; treat the author count as one signal among several.
  - McIntosh et al. is about review measures, not hotspots. It belongs with the contradictions rather than as support.
- **Rationale:** Krutauz et al. replicated McIntosh et al.'s defect models on Qt and on Google Chrome. Code-review measures were unstable predictors. Prior defects, module size and authorship had the strongest relationship with post-release defects. They are cheap to compute from git, so they are the natural first ranking for where to spend hardening effort.
- **Evidence:**
  - [Do code review measures explain the incidence of post-release defects?](https://arxiv.org/abs/2005.09217) — Krutauz, Dey, Rigby, Mockus, Empirical Software Engineering 2020 (Crossref 10.1007/s10664-020-09837-4) — peer_reviewed — "Replication, however, confirms with the bulk of prior work showing that prior defects, module size, and authorship have the strongest relationship to post-release defects." / "Models without code review predictors had as good or better fit than those with review predictors." — verbatim in the arXiv abstract.
- **Detect:**
  - Churn: `git log --since='2 years ago' --format= --name-only | sort | uniq -c | sort -rn | head -30`.
  - Past fixes: `git log -i -E --grep='fix|bug|hotfix|regression' --format= --name-only | sort | uniq -c | sort -rn | head -30`.
  - Authors per file: `git shortlog -sn -- <file> | wc -l`.
  - Size: `cloc --by-file`.
  - Rank files on these signals combined.
- **Tools:** git log, git shortlog, cloc.
- **Applies to:** Any codebase with version history.
- **When not to apply / counterpoints:** Spotting bug fixes from commit messages is noisy, and squash-merged histories blur every signal. In a solo project the authorship signal disappears, leaving churn, size and past fixes. The skill's own hit rate per hotspot should be measured rather than assumed.
- **Fix risk:** low

### T02-F20 — Do not anchor on tool or AI output: run the high-severity checklist on every module independently
- **Grade:** B
- **Verdict:** VERIFIED. Tufano et al. is confirmed as ICSE 2025 (Crossref 10.1109/ICSE55347.2025.00060). The researcher listed Crupi et al. as a preprint; its arXiv record says "Accepted at the 34th International Conference on Program Comprehension (ICPC 2026)". The model in Crupi et al. is ChatGPT-4.
- **Rationale:** In a controlled experiment, reviewers who were given an LLM review focused on the locations it flagged. They found more low-severity issues, found no more high-severity ones, and saved no time. A mining study found that the LLM caught only 10% of the issues humans raised, while about 40% of its extra comments were meaningful. The two are complementary. Tool output should add to an independent high-severity pass, never define its scope.
- **Evidence:**
  - [Deep Learning-based Code Reviews: A Paradigm Shift or a Double-Edged Sword?](https://arxiv.org/abs/2411.11401) — Tufano, Martin-Lopez, Tayeb, Dabić, Haiduc, Bavota, ICSE 2025 — peer_reviewed — 29 experts and over 50 hours of recorded reviews. "Reviewers tend to focus on the code locations indicated by the LLM rather than searching for additional issues in other parts of the code"; they "identified a higher number of low-severity issues while, however, not identifying more high-severity issues"; "The automated support did not result in saved time and did not increase the reviewers' confidence." — verbatim in the abstract.
  - [Studying Quality Improvements Recommended via Manual and Automated Code Review](https://arxiv.org/abs/2602.11925) — Crupi, Tufano, Bavota, arXiv 12 Feb 2026, accepted at ICPC 2026 — peer_reviewed (accepted) — "it can only spot 10% of the quality issues reported by humans"; DL-based review "should not be considered as a valid alternative to them nor as a mean to save code review time" — verbatim in the abstract.
- **Detect:**
  - Each module gets a table with rows for design, trust boundaries and authorisation, concurrency, data integrity and loss, error handling, and tests.
  - Each row is marked "checked: no issue" or lists its findings.
  - Every finding carries a source tag: `manual` or the tool's name.
  - The pass is incomplete if a hotspot module (F17) lacks these rows.
- **Tools:** manual checklist.
- **Applies to:** Any review that uses linters, SAST or LLMs, including this skill.
- **When not to apply / counterpoints:** This is one controlled experiment on small programs, and LLM review quality is changing fast (both studies used 2023-2024 models). Crupi et al. show that the extra LLM comments have real complementary value.
- **Fix risk:** low

### T02-F15 — Build context before criticising (tests, callers, history); if unclear, say so or ask
- **Grade:** B
- **Verdict:** VERIFIED.
  - The 33% → 67% area-familiarity figure comes from Czerwonka et al., a 2-page paper.
  - The "first year" effect in Bosu et al. is about a reviewer's time at Microsoft, not familiarity with a specific code area.
  - Pascarella et al. appeared in PACM HCI, CSCW issue, 2018 (Crossref 10.1145/3274404).
- **Rationale:** Reviewers new to an area of code make far fewer useful comments, and an AI agent reviewing an unfamiliar project is always new to it. Understanding the change is the central challenge of review. Reviewers need to know how the methods and variables under review are used. When something is unclear, GitLab tells reviewers to say so.
- **Evidence:**
  - [Code Reviews Do Not Find Bugs](https://www.microsoft.com/en-us/research/wp-content/uploads/2015/05/PID3556473.pdf) — Czerwonka et al., ICSE 2015 SEIP (2 pages) — peer_reviewed (short industry paper) — "Without prior exposure to the part of code base being reviewed, on average only 33% of any reviewer's comments are deemed useful by the author of a change... When reviewing the same part of code base for the third time, the usefulness ratio increases to about 67% of their comments." — verbatim. The paper presents this as a correlation.
  - [Characteristics of Useful Code Reviews: An Empirical Study at Microsoft](https://www.microsoft.com/en-us/research/publication/characteristics-of-useful-code-reviews-an-empirical-study-at-microsoft/) — Bosu, Greiler, Bird, MSR 2015 — peer_reviewed — abstract: 1.5 million review comments from five Microsoft projects; "the more files that are in a change, the lower the proportion of comments in the code review that will be of value to the author of the change"; usefulness "increases dramatically in the first year" — verified in the abstract.
  - [Expectations, Outcomes, and Challenges of Modern Code Review](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ICSE202013-codereview.pdf) — Bacchelli & Bird, ICSE 2013 — peer_reviewed — "code and change understanding is the key aspect of code reviewing" — verbatim.
  - [Information Needs in Contemporary Code Review](https://doi.org/10.1145/3274404) — Pascarella, Spadini, Palomba, Bruntink, Bacchelli, CSCW 2018 (PACM HCI) — peer_reviewed — 900 comments from three open-source projects; "seven high-level information needs, such as knowing the uses of methods and variables declared/modified in the code under review" — verified in the abstract via OpenAlex.
  - [Code Review Guidelines](https://docs.gitlab.com/development/code_review/) — GitLab, current — official_docs — "If you don't understand a piece of code, say so."; "Accept that many programming decisions are opinions." — verbatim.
- **Detect:** Each finding records:
  - the callers found (`rg -n '\bsymbol\b'` or IDE find-references);
  - the tests opened;
  - the history checked (`git log -L <start>,<end>:<file>`, `git blame -w -C`).

  A finding without this trail becomes a non-blocking question.
- **Tools:** `git log -L`, `git blame -C`, rg, IDE find-references.
- **Applies to:** Every change proposed on code the agent did not write.
- **When not to apply / counterpoints:** This costs time. Google's single-reviewer model relies on reviewers who already know the code, which a third-party pass cannot copy.
- **Fix risk:** low

### T02-F16 — Pin the behaviour contract before refactoring; prefer tool-driven refactorings; add extra tests around hierarchy moves
- **Grade:** B
- **Verdict:** CORRECTED. The researcher misrepresented the StackExchange example.
  - The asker's code is Python, and the asker states that "every group is disjoint".
  - The answer (score 7, not accepted) says the dict version changes which group matches first. A commenter, the asker, replies that "Python dictionaries are now ordered, so this bug doesn't manifest itself". Another commenter says there is no subtle bug if x appears in only one group.
  - Verifier's own observation, checkable on the page: the proposed rewrite iterates `for group_name, group_elements in GROUPS:` without `.items()`, so it would raise a `ValueError` at runtime. The "readability" rewrite does break behaviour, just not in the way the answer claims.
  - The answer is kept only as a weak, disputed illustration.
  - The sub-rule "check iteration order and overlap when converting if-chains to maps" is weakly sourced. It still holds wherever iteration order is unspecified (Go maps, Java `HashMap`, sets).
  - Bavota et al. measure fault-inducing refactorings via SZZ on three Java systems (correlational). They do not compare tool-driven with manual refactoring. "Prefer tool-driven refactorings" rests on the SE answer in F19 and on Google's LSC practice, not on Bavota.
- **Rationale:** Refactoring carries risk. Bavota et al. found that hierarchy refactorings such as pull-up method "tend to induce faults very frequently". Microsoft developers perceive "substantial cost and risks", yet Windows 7 modules refactored by a dedicated team later had fewer inter-module dependencies and post-release defects. Hyrum's law explains why implementation details become de facto contracts.
- **Evidence:**
  - [Hyrum's Law](https://www.hyrumslaw.com/) — Hyrum Wright (named by Titus Winters) — other (named observation) — "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody." — verbatim.
  - [When Does a Refactoring Induce Bugs? An Empirical Study](https://doi.org/10.1109/SCAM.2012.20) — Bavota, De Carluccio, De Lucia, Di Penta, Oliveto, Strollo, SCAM 2012 — peer_reviewed — 15,008 refactorings of 52 kinds in Ant, Xerces and ArgoUML: "refactorings involving hierarchies (e.g., pull up method), tend to induce faults very frequently" — verified in the abstract via OpenAlex.
  - [A Field Study of Refactoring Challenges and Benefits](https://www.microsoft.com/en-us/research/publication/a-field-study-of-refactoring-challenges-and-benefits/) — Kim, Zimmermann, Nagappan, FSE 2012 — peer_reviewed — "developers perceive that refactoring involves substantial cost and risks"; Windows 7 modules refactored by the team saw a "significant reduction in the number of inter-module dependencies and post-release defects" — verified in the abstract.
  - [Things You Should Never Do, Part I](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/) — Joel Spolsky, 2000 — engineering_blog — "the single worst strategic mistake that any software company can make"; "Each of these bugs took weeks of real-world usage before they were found." — verified. The essay is about full rewrites, not incremental refactoring.
  - [Code reviewing nitpicks for readability [actually for DRY]](https://softwareengineering.stackexchange.com/questions/398897/code-reviewing-nitpicks-for-readability-actually-for-dry) — SE StackExchange, 2019, answer 398935 (score 7) — practitioner_forum — "The proposed change introduces a subtle bug..." — quote verified, but the claim is disputed in the comments (see verdict).
- **Detect:**
  - Before the change, capture golden or snapshot outputs of the public entry points; diff them after.
  - List changes to the public surface (`.d.ts` diffs, `export`, `__all__`, `pub fn`).
  - Flag hierarchy changes (methods moved between base and derived classes, new abstract bases) for extra tests.
  - For if-chain to map rewrites, check key overlap and the target language's iteration-order rules.
- **Tools:** snapshot/golden tests, git diff, rg, IDE automated refactorings.
- **Applies to:** All refactorings of shipped code; strictest for libraries and services with external consumers.
- **When not to apply / counterpoints:** Too much caution means nothing improves, and the Windows 7 result shows that disciplined refactoring can pay off. Internal code with strong tests can be refactored more aggressively.
- **Fix risk:** high

### T02-F08 — Delete dead code; never leave it callable, commented out or repurposed
- **Grade:** B
- **Verdict:** CORRECTED.
  - The Knight Capital case is now stated with its full causes. Power Peg was unused since 2003. In 2005 its cumulative-quantity function was moved and the code "not retest[ed]". The SEC order also cites the deployment process: no second-technician review and no written procedures. Dead code was a necessary cause, not the only one.
  - Vulture's 100% confidence means "guaranteed to be unused within the analyzed files".
- **Rationale:**
  - Google's book calls code "a liability".
  - At Microsoft, 55 of 165 "code improvement" review comments were about removing unnecessary or unused code. That measures what reviewers comment on, not the benefit of removal.
  - Mozilla asks that patches create no unused code.
  - Knight Capital shows what happens when unused code stays callable and its flag is reused.
- **Evidence:**
  - [SEC Order, In the Matter of Knight Capital Americas LLC (Release No. 34-70694)](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 16 Oct 2013 — incident_report — verbatim in the PDF:
    - "Despite the lack of use, the Power Peg functionality remained present and callable at the time of the RLP deployment. The new RLP code also repurposed a flag that was formerly used to activate the Power Peg code."
    - "In 2003, Knight ceased using the Power Peg functionality."
    - "Knight did not retest the Power Peg code after moving the cumulative quantity function"
    - "Knight did not have a second technician review this deployment"
    - Uninstalling the new code from the seven correctly deployed servers "worsened the problem".
    - "Knight lost over $460 million".
  - [Expectations, Outcomes, and Challenges of Modern Code Review](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ICSE202013-codereview.pdf) — Bacchelli & Bird, ICSE 2013 — peer_reviewed — "Code Improvements: The most frequent category, with 165 (29%) comments... among 'code improvements' comments we find 58 on using better code practices, 55 on removing not necessary or unused code, and 52 on improving code readability." — verbatim.
  - [SWE at Google, Ch. 9](https://abseil.io/resources/swe-book/html/ch09.html) — O'Reilly 2020 — book — "code itself is a liability. It might be a necessary liability, but by itself, code is simply a maintenance task to someone somewhere down the line." — verbatim.
  - [Reviewer Checklist](https://firefox-source-docs.mozilla.org/contributing/reviewer_checklist.html) — Mozilla — official_docs — "Make sure the patch doesn't create any unused code (e.g., remove strings when removing a feature)"; "Remove debug logging that is not needed in production." — verbatim.
  - [Vulture README](https://github.com/jendrikseipp/vulture) — Jendrik Seipp (repo active, not archived, Sept 2026) — official_docs — confidence 100% for function/method/class arguments and unreachable code, 90% for imports, 60% for attributes, classes, functions, methods, properties and variables; "Use `--min-confidence 100` to only report code that is guaranteed to be unused within the analyzed files"; "Due to Python's dynamic nature, static code analyzers like Vulture are likely to miss some dead code" — verified in the raw README.
  - [Ruff ERA001 commented-out-code](https://docs.astral.sh/ruff/rules/commented-out-code/) — Astral — official_docs — "Commented-out code is dead code, and is often included inadvertently. It should be removed."; known problem: "Prone to false positives when checking comments that resemble Python code, but are not actually Python code." — verbatim; rule is stable.
- **Detect:**
  - Python: run `vulture <src> --min-confidence 100`, then review the 60% hits by hand; `ruff check --select ERA001`.
  - TS/JS: `knip`, which "finds and fixes unused dependencies, exports and files" (README). It needs correct entry points and plugins.
  - Go: staticcheck `U1000` "Unused code" (confirmed in the go-tools source, `unused/unused.go`).
  - Flags and config keys: confirm that each one has a live reader and writer. Use `git log -S '<FLAG>'` to spot keys whose meaning changed over time.
- **Tools:** vulture, knip, staticcheck (U1000), ruff (ERA001), rg, `git log -S`. All repos active in Sept 2026.
- **Applies to:** All languages; critical for systems with feature flags, multi-server deploys or financial logic.
- **When not to apply / counterpoints:**
  - Reflection, DI containers, plugin entry points, serialisation hooks and framework conventions all produce false "unused" reports.
  - Public library APIs may have external callers (Hyrum's law, F16).
  - Deleting is the safe direction; reviving dead code is not (F07).
  - Knight's loss had several causes. The case illustrates the hazard; it does not prove that dead code alone is catastrophic.
- **Fix risk:** medium

### T02-F03 — Give every finding an explicit blocking status; nits never drown the report; "no findings" is a valid outcome
- **Grade:** B
- **Verdict:** VERIFIED.
  - Greptile's "nit" means "comments that were technically true but not something the dev cared about", judged by whether developers addressed them. It does not mean style comments specifically.
  - Greptile is a vendor self-report on its own product.
  - Crupi et al. used ChatGPT-4 and is accepted at ICPC 2026, not just a preprint.
  - The researcher cited the HN user iamevn without a link; a verified URL has been added.
- **Rationale:** Google, GitLab and Microsoft all separate mandatory comments from optional ones. For automated reviewers, noise is the main failure mode. Greptile's bot was 79% nits with a 19% address rate. Asking the LLM to rate its own comments' severity was "nearly random". Practitioners note that models "have a bias for action" unless "no comment" is an acceptable output. So severity must rest on concrete criteria (behaviour, security, data loss, a demonstrated maintenance cost), not on the model's own severity score.
- **Evidence:**
  - [How to write code review comments](https://google.github.io/eng-practices/review/reviewer/comments.html) — Google eng-practices — official_docs — "Nit: This is a minor thing. Technically you should do it, but it won't hugely impact things."; "Optional (or Consider): I think this may be a good idea, but it's not strictly required."; "FYI: I don't expect you to do this in this CL, but you may find this interesting to think about for the future." — verified.
  - [Conventional Comments](https://conventionalcomments.org/) — conventionalcomments.org, current — other (community spec) — format `<label> [decorations]: <subject>`. Labels: praise, nitpick, suggestion, issue, todo, question, thought, chore, note. Decorations: (non-blocking), (blocking), (if-minor). Verified.
  - [Code Review Guidelines](https://docs.gitlab.com/development/code_review/) — GitLab — official_docs — "Use the Conventional Comment format to convey intent"; mark non-mandatory suggestions as non-blocking; "When only non-blocking suggestions remain, move the MR to the next stage rather than waiting." — verified.
  - [How we made our AI code review bot stop leaving nitpicky comments](https://www.greptile.com/blog/make-llms-shut-up) — Daksh Gupta, Greptile, 18 Dec 2024 — engineering_blog (vendor self-report) — "~19% were good, 2% were flat-out incorrect, and 79% were nits"; "The LLMs judgment of its own output was nearly random"; address rate "(percentage of Greptile's comments that devs address before merging) go from 19% to 55+%" — verbatim.
  - [Studying Quality Improvements Recommended via Manual and Automated Code Review](https://arxiv.org/abs/2602.11925) — Crupi, Tufano, Bavota, ICPC 2026 (accepted) — peer_reviewed (accepted) — 739 human comments in 240 PRs; ChatGPT-4 recommends "~2.4x more" changes but "can only spot 10% of the quality issues reported by humans"; "~40% of the additional comments generated by the LLM point to meaningful quality issues" — verbatim in the abstract.
- **Detect:**
  - Each finding carries exactly one label and one blocking status.
  - Blocking findings come first; nits go in a single collapsed optional list.
  - Every in-scope module appears, if only as "reviewed: no issues".
  - Each blocking finding names its criterion.
- **Tools:** Conventional Comments; manual.
- **Applies to:** Every review or hardening report, human or AI.
- **When not to apply / counterpoints:** "The same comment can be a nitpick on one CR but crucial on another" ([iLoveOncall](https://news.ycombinator.com/item?id=42483156)). Some engineers value nits as a sign the reviewer engaged: "I'd rather see a few small nits on review of my code than just approval" ([iamevn](https://news.ycombinator.com/item?id=26245551)). So nits should be labelled, not always deleted.
- **Fix risk:** low

### T02-F07 — Static analysis on a finished codebase: new and changed lines first, never revive dead code, keep only checks that are ≥90% actionable, ratchet warnings to errors
- **Grade:** B
- **Verdict:** CORRECTED.
  - The researcher's counterpoint said "Chromium encourages opportunistic cleanup", which over-generalises. Chromium's "Try to clean up such code when you find it" refers only to code predating its ownership-passing rules (`T*` taking ownership, `scoped_refptr` conventions). That is a semantic and safety cleanup, and it is consistent with Google's "security issues, significant bug fixes" exception.
  - Added the Knight Capital detail, which directly illustrates item (2): dead Power Peg code was modified in 2005 without a retest and later ran in production.
  - The "ratchet" is an inference from Google's error-or-hide rule, not Google's own term.
- **Rationale:** Google warns that fixing a warning can itself introduce a bug. Its example: fixing a dead-code warning by calling the dead code makes untested code run. So Google focuses on new warnings. It requires checks to be seen as pointing at a real issue at least 90% of the time. Compiler checks are either errors or hidden, because developers ignore warnings.
- **Evidence:**
  - [SWE at Google, Ch. 20 Static Analysis](https://abseil.io/resources/swe-book/html/ch20.html) — chapter by Caitlin Sadowski; O'Reilly 2020 — book — "Fixing a static analysis warning could introduce a bug. For code that is not being frequently modified, why 'fix' code that is running fine in production?"; "Fixing a dead code warning by adding a call to the previously dead code could result in untested (possibly buggy) code suddenly running."; "Instead, we generally focus on newly introduced warnings; existing issues in otherwise working code are typically only worth highlighting (and fixing) if they are particularly important (security issues, significant bug fixes, etc.)." — verbatim.
  - Same chapter — "Produce less than 10% effective false positives. Developers should feel the check is pointing out an actual issue at least 90% of the time."; "We have found repeatedly that developers ignore compiler warnings. We either enable a compiler check as an error (and break the build) or don't show it in compiler output." — verbatim.
  - [LLVM Coding Standards – Treat Compiler Warnings Like Errors](https://llvm.org/docs/CodingStandards.html) — LLVM, current — official_docs — "Compiler warnings are often useful and help improve the code. Those that are not useful, can be often suppressed with a small code change." — verbatim.
  - [SEC Order on Knight Capital](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 2013 — incident_report — "Knight did not retest the Power Peg code after moving the cumulative quantity function to determine whether Power Peg would still function correctly if called." — verbatim.
- **Detect:**
  - Run analysers against a baseline and split the results into "lines changed by this pass" and "pre-existing".
  - Measure how stable each flagged file is: `git log --since='1 year ago' --format= --name-only -- <file> | wc -l`.
  - Sample about 10 hits per rule. If fewer than 9 would lead to a real change, do not make that rule a gate. This is a small-sample heuristic for Google's 90% bar.
  - Ratchet with `-Werror`, `eslint --max-warnings 0`, or `ruff check` with an explicit select list.
- **Tools:** compiler `-Werror`, eslint, ruff, clang-tidy, staticcheck, Error Prone, git log.
- **Applies to:** Any codebase adopting or tightening static analysis after the fact.
- **When not to apply / counterpoints:** Google's policy optimises developer time across a huge monorepo, and a small, well-tested project may find legacy fixes cheap. A hardening pass is partly meant to improve old code, so apply "security or significant bug" plus clear maintainability defects in hotspots (F17).
- **Fix risk:** medium

### T02-F01 — Prioritise findings design-first; accept a change once it definitely improves code health
- **Grade:** B
- **Verdict:** CORRECTED.
  - The researcher's "industry priority order" overstated the sources. The seven-step order is the section order of Google's checklist, and Google explicitly ranks only design ("the most important thing").
  - Microsoft's playbook points human reviewers at business-logic correctness, tests and the readability and maintainability of design decisions, with no ranking.
  - Chapter authorship fixed: SWE book Ch. 9 is by Tom Manshreck and Caitlin Sadowski; Winters, Manshreck and Wright are the book's editors.
- **Rationale:** Google makes design the top review item and "definitely improves the overall code health" the approval bar. It defines "too complex" from the reader's side: code that "can't be understood quickly by code readers", or where "developers are likely to introduce bugs when they try to call or modify this code". A Microsoft interviewee said that reviews stuck on easy formatting issues "doesn't really help" when real mistakes exist. For an automated pass, this rule stops perfectionism loops and keeps cosmetic churn from crowding out findings on design, concurrency and tests.
- **Evidence:**
  - [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html) — Google eng-practices, undated — official_docs — "reviewers should favor approving a CL once it is in a state where it definitely improves the overall code health of the system being worked on, even if the CL isn't perfect."; "there is no such thing as 'perfect' code—there is only better code." — verbatim.
  - [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google eng-practices — official_docs — "The most important thing to cover in a review is the overall design of the CL." Parallel programming that "could theoretically cause deadlocks or race conditions" needs attention. Sections run Design, Functionality, Complexity, Tests, Naming, Comments, Style, Consistency, Documentation. Verified.
  - [Reviewer Guidance](https://microsoft.github.io/code-with-engineering-playbook/code-reviews/process-guidance/reviewer-guidance/) — Microsoft Engineering Fundamentals Playbook, last update 22 Aug 2024 — official_docs — "Human reviewers should focus on: The correctness of the business logic embodied in the code. The correctness of any new or changed tests. The 'readability' and maintainability of the overall design decisions reflected in the code." — verbatim.
  - [Expectations, Outcomes, and Challenges of Modern Code Review](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ICSE202013-codereview.pdf) — Bacchelli & Bird, ICSE 2013 — peer_reviewed — interviewee: "[Some reviewers] focus on formatting mistakes because they are easy [...], but it doesn't really help. [...] In some ways it's kind of embarrassing if someone asks you to do a code review and all you can find are formatting mistakes when there are real mistakes to be found" — verbatim. This is a single interview quote.
  - [SWE at Google, Ch. 9](https://abseil.io/resources/swe-book/html/ch09.html) — Manshreck & Sadowski, O'Reilly 2020 — book — "checking for code correctness is not the primary benefit Google accrues from the process of code review. Checking for code correctness generally ensures that a change works, but more importance is attached to ensuring that a code change is understandable" — verbatim.
- **Detect:**
  - Tag each finding with one dimension.
  - Sort the report: design, then functionality and concurrency, complexity, tests, naming, comments, style.
  - Answer Google's questions explicitly.
  - The pass is mis-prioritised if its top findings are naming or style while design, concurrency or test gaps are unexamined.
- **Tools:** manual checklist.
- **Applies to:** All languages; whole-codebase passes and per-change review.
- **When not to apply / counterpoints:** "Improves code health" is a judgement call. At resource-constrained companies, "quality and velocity are tradeoffs" ([awinter-py](https://news.ycombinator.com/item?id=20893047)). Google's process assumes a human author who can push back.
- **Fix risk:** low

### T02-F12 — Tests must be able to fail: coverage is a floor, mutation testing checks assertions, characterisation tests come before refactoring, and production code has no test-only paths
- **Grade:** B
- **Verdict:** VERIFIED.
  - Pitest and Stryker appear only in a reader comment on the coverage post, as the researcher noted.
  - The "characterisation tests before refactoring" step rests on the Beyoncé Rule by inference. The term itself (from Michael Feathers) is not cited here.
- **Rationale:** Google asks whether tests "actually fail when the code is broken". Its coverage post warns that coverage only proves lines were executed, and it recommends mutation testing. The Beyoncé Rule says to test everything you don't want to break. Chromium discourages test-only paths in production code.
- **Evidence:**
  - [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google — official_docs — "Will the tests actually fail when the code is broken? If the code changes beneath them, will they start producing false positives? Does each test make simple and useful assertions?"; "Don't accept complexity in tests just because they aren't part of the main binary." — verified.
  - [Code Coverage Best Practices](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html) — Arguelles, Ivanković, Bender, Google Testing Blog, Aug 2020 — engineering_blog — verbatim in the post body:
    - "at Google we offer the general guidelines of 60% as 'acceptable', 75% as 'commendable' and 90% as 'exemplary.' However we like to stay away from broad top-down mandates"
    - "While project wide goals above 90% are most likely not worth it, per-commit coverage goals of 99% are reasonable, and 90% is a good lower threshold."
    - "Code coverage does not guarantee that the covered lines or branches have been tested correctly"
    - Mutation testing is called "A better technique to assess whether you're adequately exercising the lines your tests cover".
  - [SWE at Google, Ch. 11 Testing Overview](https://abseil.io/resources/swe-book/html/ch11.html) — O'Reilly 2020 — book — "test everything that you don't want to break"; "If you liked it, then you shoulda put a test on it." — verbatim.
  - [Chromium C++ style guide](https://chromium.googlesource.com/chromium/src/+/HEAD/styleguide/c++/c++.md) — Chromium, current — official_docs — "Try to avoid test-only code paths in production code. Such code paths make production code behave differently in tests. This makes both tests and production code hard to reason about. Consider dependency injection, fake classes, etc to avoid such code paths." — verbatim in the source Markdown.
- **Detect:**
  - Measure diff coverage on changed files: `pytest --cov`, `vitest run --coverage`, `go test -coverprofile`, `cargo llvm-cov`.
  - Run mutation testing on hot modules: PIT, Stryker, mutmut (all repos active Sept 2026).
  - Grep production code for test hooks (`isTest`, `ForTesting`, `NODE_ENV === 'test'`), excluding test files.
- **Tools:** pytest-cov, vitest, go test -cover, cargo-llvm-cov, PIT, Stryker, mutmut, rg.
- **Applies to:** All projects with tests. Where there are none, add characterisation tests first.
- **When not to apply / counterpoints:**
  - Google avoids top-down coverage mandates and says project-wide goals above 90% are likely not worth it.
  - Mutation testing is slow at scale.
  - SWE book Ch. 11 warns that teams treat a coverage bar "like a ceiling" rather than a floor.
  - Spadini et al. (ICSE 2019, 93 developers) found that with test-first review, developers "find the same proportion of defects in production code, but more in test code, at the expenses of fewer maintainability issues in production code" (abstract verified via OpenAlex, DOI 10.1109/ICSE.2019.00110).
- **Fix risk:** low

### T02-F02 — Hand style to tools; never write a manual finding that a configured formatter or linter can check
- **Grade:** B
- **Verdict:** CORRECTED (minor).
  - The Microsoft playbook page shows "Last update: August 22, 2024", not Aug 26.
  - SWE book Ch. 8 is written by Shaindel Schwartz.
- **Rationale:** Google, Chromium, GitLab, Mozilla and Microsoft all move style enforcement out of human review. Tool feedback is objective and impersonal, and it frees review attention for design and correctness.
- **Evidence:**
  - [SWE at Google, Ch. 8 Style Guides and Rules](https://abseil.io/resources/swe-book/html/ch08.html) — Shaindel Schwartz, O'Reilly 2020 — book — "rather than exclusively depending on engineer-based verification, we strongly prefer to automate enforcement with tooling." (clang-format, gofmt, yapf in presubmit) — verified.
  - [Chromium C++ style guide](https://chromium.googlesource.com/chromium/src/+/HEAD/styleguide/c++/c++.md) — Chromium, current — official_docs — "By policy, Clang's formatting of code should always be accepted in code reviews." — verbatim.
  - [Code Review Guidelines](https://docs.gitlab.com/development/code_review/) — GitLab — official_docs — "Enforce code style through automation rather than review comments." — verbatim.
  - [Frontend Code Review Best Practices](https://firefox-source-docs.mozilla.org/browser/FrontendCodeReviewBestPractices.html) — Mozilla (Firefox frontend) — official_docs — "If you identify issues that are routinely cropping up that could be covered by automated linting, please file issues for new rules to be added." — verbatim.
  - [Reviewer Guidance](https://microsoft.github.io/code-with-engineering-playbook/code-reviews/process-guidance/reviewer-guidance/) — Microsoft playbook, 22 Aug 2024 — official_docs — "Since parts of reviews can be automated via linters and such, human reviewers can focus on architectural and functional correctness."; automated styling "like black and prettier" — verified.
  - [Stop Nitpicking in Code Reviews](https://blog.danlew.net/2021/02/23/stop-nitpicking-in-code-reviews/) — Dan Lew, 23 Feb 2021 — engineering_blog — "The main effect wasn't improving the codebase; it was making people upset with their code and angry with me."; "when automation tells you that you're incorrect, it's impersonal and as a result somehow less frustrating" — verbatim.
- **Detect:**
  - Find the formatter and linter configs and the CI steps that run them.
  - Run them in check mode: `prettier --check .`, `ruff format --check`, `clang-format --dry-run --Werror`, `gofmt -l .`, `cargo fmt --check`.
  - Drop any manual finding in a category a configured tool already covers.
  - If there is no formatter, raise one finding: adopt one in an isolated commit.
- **Tools:** prettier, ruff format, black, clang-format, gofmt, rustfmt, eslint, checkpatch.pl.
- **Applies to:** All languages with a formatter or linter; otherwise follow the project's written style guide.
- **When not to apply / counterpoints:** Naming and real readability problems cannot be automated ([BugsJustFindMe](https://news.ycombinator.com/item?id=26245323)). The kernel says the style checker "should be viewed as a guide, not as a replacement for human judgment" (submitting-patches). Introducing a formatter is itself a mass reformat, so do it in one commit and list that commit in `.git-blame-ignore-revs` (F05, F06).
- **Fix risk:** low

### T02-F05 — Never mix behaviour changes, refactorings, formatting and moves in one commit
- **Grade:** B
- **Verdict:** CORRECTED. The researcher said Chromium also asks for this separation, but no Chromium source was cited or found, so Chromium was removed from the rationale. The GitHub `.git-blame-ignore-revs` claim was checked in GitHub Docs.
- **Rationale:** Google, LLVM and the Linux kernel all ask for this separation. Mixed changes hide what changed and complicate merges, rollbacks and history tools. Once separated, the format, rename and move commits can be checked mechanically for "no behaviour change", and scrutiny goes to the behaviour commits. There is no empirical defect data here; the support is guideline-level plus tooling.
- **Evidence:**
  - [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) — Google eng-practices — official_docs — "It's usually best to do refactorings in a separate CL from feature changes or bug fixes." Small cleanups such as renaming a local variable may ride along at the reviewer's discretion. Verified.
  - [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google — official_docs — "The author of the CL should not include major style changes combined with other changes. It makes it hard to see what is being changed in the CL, makes merges and rollbacks more complex" — verified.
  - [LLVM Coding Standards](https://llvm.org/docs/CodingStandards.html) — LLVM — official_docs — "it is reasonable to rename the methods of a class if you're about to change it in some other way. Please commit such changes separately to make code review easier." — verbatim.
  - [Submitting patches](https://docs.kernel.org/process/submitting-patches.html) — Linux kernel — official_docs — when moving code from one file to another, "you should not modify the moved code at all in the same patch which moves it." — verbatim.
  - [git-blame](https://git-scm.com/docs/git-blame) — Git project — official_docs — `--ignore-rev`: "Ignore changes made by the revision when assigning blame, as if the change never happened."; config `blame.ignoreRevsFile` — verbatim.
  - [Viewing and understanding files](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files) — GitHub Docs — official_docs — "All revisions specified in the `.git-blame-ignore-revs` file, which must be in the root directory of your repository, are hidden from the blame view" — verified.
- **Detect:**
  - A formatting-only commit should show an empty `git diff -w --ignore-blank-lines <c>^ <c>`.
  - For moves, run `git diff --color-moved=zebra --color-moved-ws=allow-indentation-change`. Any edited line inside a moved block is a violation.
  - The commit type (fix/refactor/style) must match the diff. A "refactor" that changes test expectations is suspect.
- **Tools:** `git diff -w`, `git diff --color-moved`, `git log -M --follow`, `.git-blame-ignore-revs`.
- **Applies to:** All version-controlled projects.
- **When not to apply / counterpoints:** Google lets minor cleanups travel with feature work. Strict separation creates more commits and temporary intermediate states.
- **Fix risk:** low

### T02-F06 — Style authority: the project guide first, then surrounding code, then the community guide; never restyle untouched code or break compatibility for style
- **Grade:** B (was A)
- **Verdict:** DOWNGRADED.
  - The support is consistent but guideline-only, with no empirical data. The findings with the same kind of evidence (F02, F05) are graded B.
  - PEP 8 is Python-specific.
  - The researcher's Chromium counterpoint was over-generalised. "Try to clean up such code when you find it" sits in the smart-pointer and ownership section and refers to code that predates Chromium's ownership-passing rules. It is not a general licence to restyle legacy code.
- **Rationale:** Google makes the style guide "the absolute authority" on style and ranks technical facts above opinion. PEP 8 ranks consistency within a module highest and allows leaving old code alone when there is no other reason to touch it. LLVM refuses mass-reformatting patches. For a finished project, these rules stop a hardening pass from becoming a large diff with no behavioural value.
- **Evidence:**
  - [The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html) — Google — official_docs — "Technical facts and data overrule opinions and personal preferences."; "On matters of style, the style guide is the absolute authority." — verbatim.
  - [PEP 8](https://peps.python.org/pep-0008/) — van Rossum, Warsaw, Coghlan (Python) — standard — "Consistency within a project is more important. Consistency within one module or function is the most important."; one listed reason to ignore a guideline: "the code in question predates the introduction of the guideline and there is no other reason to be modifying that code"; "do not break backwards compatibility just to comply with this PEP!" — verbatim.
  - [LLVM Coding Standards](https://llvm.org/docs/CodingStandards.html) — LLVM — official_docs — "we explicitly do not want patches that do large-scale reformatting of existing code." — verbatim.
  - [Respectful Code Reviews](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/cr_respect.md) — Chromium — official_docs — "Don't bikeshed... Always ask yourself if this decision really matters in the long run, or if you're enforcing a subjective preference." — verified.
- **Detect:** Ask four questions of each style finding:
  - Is the line changing anyway?
  - Does the project guide or a configured linter require the change?
  - Does the surrounding module already follow the same pattern? If so, keep it.
  - Does the change touch a public name or signature? If so, it is a compatibility break.

  Drop the finding if the code is untouched and nothing requires the change.
- **Tools:** git blame, project linter config, manual.
- **Applies to:** All languages; most valuable in mature codebases.
- **When not to apply / counterpoints:** PEP 8 also calls a style inconsistency "an opportunity to clean up someone else's mess (in true XP style)". Chromium asks for cleanup of pre-rule ownership code, which is a semantic cleanup (see above). Google does large cleanups, but only with automated tooling (F19).
- **Fix risk:** low

### T02-F10 — Reduce nesting with early exits and guard clauses; no else after return; use thresholds as refactor triggers
- **Grade:** B
- **Verdict:** VERIFIED. The thresholds are conventions, not empirically derived, as the researcher already said. The "5–7 items" working-memory figure is the blog's own assertion; it was not traced to a primary psychology source here.
- **Rationale:** LLVM, the kernel and Google's Code Health posts all recommend early exits to reduce how much state a reader must keep in mind. The kernel scales the allowed length of a function inversely with its complexity and nesting. Several of the fixes are automatic.
- **Evidence:**
  - [LLVM Coding Standards](https://llvm.org/docs/CodingStandards.html) — LLVM — official_docs — sections "Use Early Exits and continue to Simplify Code", "Don't use else after a return" and "Turn Predicate Loops into Predicate Functions"; "please do not use 'else' or 'else if' after something that interrupts control flow — like return, break, continue, goto, etc." — verified.
  - [Linux kernel coding style](https://docs.kernel.org/process/coding-style.html) — kernel docs — official_docs — verbatim:
    - "if you need more than 3 levels of indentation, you're screwed anyway"
    - functions "should fit on one or two screenfuls of text (the ISO/ANSI screen size is 80x24...)"
    - "The maximum length of a function is inversely proportional to the complexity and indentation level of that function."
    - a "conceptually simple function that is just one long (but simple) case-statement" may be longer
    - local variables "shouldn't exceed 5-10, or you're doing something wrong."
  - [Write Clean Code to Reduce Cognitive Load](https://testing.googleblog.com/2023/11/write-clean-code-to-reduce-cognitive.html) — Andrew Trenk, Google Testing Blog, 6 Nov 2023 — engineering_blog — "People can typically hold up to 5–7 separate pieces of information in their short-term memory"; "reduce nesting by using early returns to handle special cases. Minimize mutable state."; "over-engineering your code with too many abstractions also causes cognitive load" — verified.
  - [Code Health: Reduce Nesting, Reduce Complexity](https://testing.googleblog.com/2017/06/code-health-reduce-nesting-reduce.html) — Elliott Karpilovsky, 5 Jun 2017 — engineering_blog — "A guard clause checks a criterion and fails fast if it is not met. It decouples the computational logic from the error logic." The example's swapped "unauthorized"/"wrong encoding" errors are "easier to see in the refactored version". Verbatim.
  - [ESLint max-depth](https://eslint.org/docs/latest/rules/max-depth), [complexity](https://eslint.org/docs/latest/rules/complexity) and [no-else-return](https://eslint.org/docs/latest/rules/no-else-return) — ESLint — official_docs — max-depth `"max"` defaults to 4. complexity defaults to 20, with variants "classic" (default) and "modified", where "each `switch` statement only increases the complexity value by `1`". no-else-return is fixable with `--fix`. Verified.
  - [clang-tidy readability-else-after-return](https://clang.llvm.org/extra/clang-tidy/checks/readability/else-after-return.html), [readability-function-size](https://clang.llvm.org/extra/clang-tidy/checks/readability/function-size.html) and [readability-function-cognitive-complexity](https://clang.llvm.org/extra/clang-tidy/checks/readability/function-cognitive-complexity.html) — LLVM — official_docs — else-after-return enforces the LLVM rule, and WarnOnUnfixable covers cases where declarations would be affected. In function-size, NestingThreshold, VariableThreshold and LineThreshold default to "none" and StatementThreshold defaults to 800. Cognitive-complexity has a default Threshold of 25 and follows SonarSource's spec. Verified.
- **Detect:**
  - JS/TS: ESLint `no-else-return`, `max-depth`, `complexity`.
  - Python: Ruff `RET505` (stable; "Fix is sometimes available") and `C901`.
  - C/C++: clang-tidy `readability-else-after-return`, `readability-function-size` (set the thresholds explicitly), `readability-function-cognitive-complexity`.
  - Go: golangci-lint `nestif` ("Reports deeply nested if statements") and `gocognit`.
  - Kernel-style C: checkpatch.pl.
- **Tools:** as listed.
- **Applies to:** All imperative languages. In C without RAII, pair early returns with the kernel's centralised goto-cleanup pattern.
- **When not to apply / counterpoints:** The thresholds disagree with each other (kernel 3 levels with 8-column tabs, ESLint 4, clang-tidy none by default). Early returns can leak resources in languages without RAII, defer or finally. Extracting too many helpers adds cognitive load of its own (Trenk 2023).
- **Fix risk:** low

### T02-F11 — Comments explain why, not what; TODOs reference an issue or owner; every suppression carries a reason
- **Grade:** B
- **Verdict:** VERIFIED. One detection fix: the researcher's TODO regex would flag Google's own preferred forms (`// TODO: bug 12345678 - ...`, `// TODO: example.com/my-design-doc - ...`) as unreferenced. It has been widened to accept `bug \d+` and bare domains.
- **Rationale:** Google and the kernel agree that a comment should not explain badly written code; rewrite the code instead. An explanation left only in a review tool is lost to future readers. Comments that record intent, or warn a future editor off an apparent fix, are the ones worth keeping.
- **Evidence:**
  - [Code Health: To Comment or Not to Comment?](https://testing.googleblog.com/2017/07/code-health-to-comment-or-not-to-comment.html) — Dori Reuveni & Kevin Bourrillion, Google Testing Blog, Jul 2017 — engineering_blog — verbatim in the post body:
    - Alternatives to a comment: "Introduce an explaining variable", "Extract a method", "Use a more descriptive identifier name" (`widthInPixels`), "Add a check in case your code has assumptions" (`checkArgument(height > 0)`).
    - Keep comments that "Reveal your intent: explain why the code does something (as opposed to what it does)" and that "Protect a well-meaning future editor from mistakenly 'fixing' your code".
    - "avoid comments that just repeat what the code does".
  - [Linux kernel coding style – Commenting](https://docs.kernel.org/process/coding-style.html) — kernel — official_docs — "NEVER try to explain HOW your code works in a comment: it's much better to write the code so that the working is obvious, and it's a waste of time to explain badly written code."; "Generally, you want your comments to tell WHAT your code does, not HOW." — verbatim.
  - [How to write code review comments](https://google.github.io/eng-practices/review/reviewer/comments.html) — Google — official_docs — "Explanations written only in the code review tool are not helpful to future code readers." — verbatim.
  - [Google C++ Style Guide – TODO Comments](https://google.github.io/styleguide/cppguide.html) — Google — official_docs — "TODOs should include the string TODO in all caps, followed by the bug ID, name, e-mail address, or other identifier of the person or issue with the best context about the problem referenced by the TODO." — verbatim in the page source.
- **Detect:**
  - Flag TODO/FIXME/XXX/HACK markers that carry none of these references: `#\d+`, `[A-Z]+-\d+`, a URL or bare domain, `b/\d+`, `bug \d+`, or `(owner)`.
  - Grep for suppressions (`eslint-disable`, `# noqa`, `//nolint`, `@SuppressWarnings`, `#pragma warning(disable`, `type: ignore`). Each one needs a reason.
  - By hand, flag comments that restate the next line.
- **Tools:** rg (PCRE2); manual.
- **Applies to:** All languages.
- **When not to apply / counterpoints:** API docs (docstrings, Javadoc, rustdoc) are supposed to say what a function does. The kernel's "WHAT not HOW" and Google's "why not what" use different words, but both reject narrating mechanics. Deleting a comment can delete the only record of a hazard, so check for "do not change" intent first.
- **Fix risk:** low

### T02-F19 — Wide-reaching changes: use AST- or compiler-based tools; add the new API beside the old one, migrate in shards, then delete the old one
- **Grade:** B
- **Verdict:** VERIFIED
- **Rationale:** Google generates large-scale changes with tools and splits them into shards that are tested, reviewed and submitted independently, and it says this depends on good tests. A developer whose one signature change caused 25,000 compile errors got this accepted answer: revert, add a new interface beside the old one, and migrate callers gradually with tool support.
- **Evidence:**
  - [SWE at Google, Ch. 22 Large-Scale Changes](https://abseil.io/resources/swe-book/html/ch22.html) — O'Reilly 2020 — book — verified:
    - An LSC is "any set of changes that are logically related but cannot practically be submitted as a single atomic unit".
    - Rosie shards a master change "into smaller pieces and manages the process of testing, mailing, reviewing, and committing them independently".
    - "Without good tests, such work would be impossible".
  - [I changed one method signature and now have over 25,000 errors. What now?](https://softwareengineering.stackexchange.com/questions/335321/i-changed-one-method-signature-and-now-have-over-25-000-errors-what-now) — SE StackExchange, 2016 — practitioner_forum — verified via the StackExchange API:
    - Accepted answer 335324 (score 349): "25000 errors basically means 'don't touch that'. Change it back. Create a new class that has the desired interface and slowly move the consumers of the class to the new one".
    - Answer 335333 (score 80): "isolate steps that are pure refactorings and can be carried out by tools... you absolutely need tool support".
- **Detect:**
  - Count call sites before any signature or name change: `rg -l '\bsymbol\b' | wc -l`.
  - If the count is large or spans packages, require a migration plan (add, migrate in shards, remove) and a codemod.
  - Confirm zero references before deleting the old API.
- **Tools:** ast-grep, IDE rename, clang-tidy fix-its, OpenRewrite, jscodeshift, LibCST, gopls rename. The GitHub repos of ast-grep, OpenRewrite, jscodeshift and LibCST were active and not archived in Sept 2026.
- **Applies to:** Monorepos and codebases with wide internal APIs.
- **When not to apply / counterpoints:** Small projects can often make the change atomically with an IDE rename. Temporary shims add complexity and must be removed later (F18).
- **Fix risk:** medium

### T02-F09 — Remove speculative generality (YAGNI smells)
- **Grade:** C
- **Verdict:** CORRECTED. The researcher misattributed an HN quote. "The future problem should be solved once it arrives and you can see its actual shape and requirements" is text from Google's own guide, which the commenter petilon quotes. petilon's own contribution is: "Note how Google does NOT say 'make sure the code is properly architected'. Instead they say 'make sure the code is not over-engineered'!" The comment is still the most-replied top-level comment (24 direct replies) on the 1471-point thread.
- **Rationale:** Google tells reviewers to be "especially vigilant about over-engineering". Its YAGNI post lists these smells. Its example is `Sleep(bool hibernate)`: "Code must handle the case when hibernate is true, even though all callers pass false".
- **Evidence:**
  - [Code Health: Eliminate YAGNI Smells](https://testing.googleblog.com/2017/08/code-health-eliminate-yagni-smells.html) — Marc Eaddy, Google Testing Blog, 14 Aug 2017 — engineering_blog — verbatim in the post body:
    - "creating a base class or interface with only one subclass may indicate a speculation that more subclasses will be needed in the future"
    - "Code that has never been executed other than by tests (a.k.a. code that is dead on arrival)"
    - "Classes designed to be subclassed (have virtual methods and/or protected members) that are not actually subclassed"
    - "Public or protected methods or fields that could be private"
    - "Parameters, variables, or flags that always have the same value"
  - [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google — official_docs — "Encourage developers to solve the problem they know needs to be solved now, not the problem that the developer speculates might need to be solved in the future. The future problem should be solved once it arrives and you can see its actual shape and requirements in the physical universe." — verbatim.
  - [HN comment by petilon](https://news.ycombinator.com/item?id=20892191) — HN, 2019 — practitioner_forum — endorses the over-engineering rule (see the verdict for the correct attribution).
- **Detect:**
  - Count the implementations of each interface or abstract class.
  - List the call sites of each internal function parameter and check for constant arguments.
  - Use knip for unused exports.
  - Use coverage to find lines hit only by tests.
- **Tools:** knip, ast-grep, rg, IDE find-implementations, coverage.
- **Applies to:** Internal (unpublished) APIs in object-oriented and module-based code.
- **When not to apply / counterpoints:** Single-implementation interfaces are often deliberate test seams, DI boundaries or adapter contracts. A reader of the Google post asked: "Isn't this exactly opposite to 'Inversion of Control' design principle?" Chromium recommends DI and fakes over test-only paths. Published APIs cannot be narrowed without a breaking change.
- **Fix risk:** medium

### T02-F18 — No silent deferral: every unfixed item gets a tracked issue and a TODO that references it; no open-ended advisory deprecations
- **Grade:** C
- **Verdict:** VERIFIED. "It never happens" is Google's stated experience ("experience shows"), not measured data, which is why the grade stays C.
- **Rationale:** Google reports that cleanups promised for later almost never happen unless done right away. It calls "clean things up later" "a common way for codebases to degenerate". Its deprecation chapter contrasts advisory with compulsory deprecation: "Hope is not a strategy."
- **Evidence:**
  - [Handling pushback in code reviews](https://google.github.io/eng-practices/review/reviewer/pushback.html) — Google — official_docs — verbatim:
    - "usually unless the developer does the clean up immediately after the present CL, it never happens"
    - "a common way for codebases to degenerate"
    - "file a bug for the cleanup and assign it to themselves"
    - "They can optionally also write a TODO comment in the code that references the filed bug."
    - New complexity must be cleaned up before submission "unless it is an emergency".
  - [SWE at Google, Ch. 15 Deprecation](https://abseil.io/resources/swe-book/html/ch15.html) — O'Reilly 2020 — book — "code is a liability, not an asset"; advisory deprecation "often lacks enforcement: we hope that clients move, but can't force them to... 'Hope is not a strategy.'"; a deprecation warning needs "two properties: actionability and relevance" — verbatim.
- **Detect:**
  - Grep for `@deprecated`, `@Deprecated`, `[Obsolete`, `#[deprecated`, `DeprecationWarning`.
  - Count the remaining callers of each deprecated symbol.
  - A deprecated symbol that is still called and has no issue link is a violation.
- **Tools:** rg, issue tracker.
- **Applies to:** All projects; especially internal APIs with in-repo callers.
- **When not to apply / counterpoints:** GitLab allows follow-ups: "If a comment can be addressed in a follow-up issue, work with the maintainer on a path forward"; "Distinguish between doing things right and doing things right now." Removing a deprecated public API is a breaking change.
- **Fix risk:** low

## Practitioner voice

All items below were checked: HN via the Algolia API, StackExchange via its API, and the rest by fetching the page.

- [HN, petilon (2019)](https://news.ycombinator.com/item?id=20892191) — The most-replied top-level comment on the "How to do a code review" thread (1471 points). It quotes Google's over-engineering passage and adds: "Google does NOT say 'make sure the code is properly architected'. Instead they say 'make sure the code is not over-engineered'!" *(Corrected: the "future problem... actual shape" line is Google's text.)*
- [HN, aviraldg (2019)](https://news.ycombinator.com/item?id=20891367) — Has seen newcomers get "hundreds of comments (many of them minor, nitpicky)" and become discouraged. Praises Google's advice to also say what was done right.
- [HN, awinter-py (2019)](https://news.ycombinator.com/item?id=20893047) — "in real companies that don't have G's resources, quality and velocity are tradeoffs". Sometimes nobody left understands the affected module.
- [HN, bt848 (2019)](https://news.ycombinator.com/item?id=20891738) — A decade at Google: "Review code in this order: protocol buffers, unit tests, headers, implementation."
- [HN, BugsJustFindMe (2021)](https://news.ycombinator.com/item?id=26245323) — A confusing variable name is not a nit: "code readability does always matter."
- [HN, iamevn (2021)](https://news.ycombinator.com/item?id=26245551) — Marks nits as non-blocking. Would "rather see a few small nits on review of my code than just approval", as a sign the reviewer engaged.
- [HN, ris (2021)](https://news.ycombinator.com/item?id=26250016) — "The worst kind of nitpicks are ones that address lines that weren't even touched by your PR."
- [HN, nickm12 (2021)](https://news.ycombinator.com/item?id=26246582) — Moved from commenting when "I would have done it differently" to only when "I would have done it better", and always explains why.
- [Greptile blog (18 Dec 2024)](https://www.greptile.com/blog/make-llms-shut-up) — Vendor self-report: 79% of its bot's comments were nits, with a 19% address rate. Prompting and LLM-as-judge both failed ("nearly random"). Filtering against clusters of past downvoted comments raised the address rate to 55+%.
- [HN, jerrygoyal (2024)](https://news.ycombinator.com/item?id=42484498) — Told CodeRabbit to ignore nitpicks, "but it still added such comments"; "only a very small percentage of comments are actually useful."
- [HN, XenophileJKO (2024)](https://news.ycombinator.com/item?id=42482821) — "the models have a bias for action, so you need to give it an accetpable action when there isn't a good comment" ("accetpable" is sic in the original).
- [HN, iLoveOncall (2024)](https://news.ycombinator.com/item?id=42483156) — "The same comment can be a nitpick on one CR but crucial on another."
- [HN, righthand (2024)](https://news.ycombinator.com/item?id=42484584) — An LLM bot built on linter rules (Codacy) "might be the most annoying useless thing". Example: it flagged Opera browser limitations on a backend Node.js PR.
- [Dan Lew (2021)](https://blog.danlew.net/2021/02/23/stop-nitpicking-in-code-reviews/) — His nitpicking made people "upset with their code and angry with me". Put lint checks and style enforcers in CI instead, because automated feedback is impersonal.
- [SE: 25,000 errors after one signature change](https://softwareengineering.stackexchange.com/questions/335321/i-changed-one-method-signature-and-now-have-over-25-000-errors-what-now) — Accepted answer (score 349): revert, add a new class with the desired interface, migrate consumers gradually, and mark the old one deprecated.
- [SE: How much refactoring is acceptable?](https://softwareengineering.stackexchange.com/a/280298) — Accepted answer (score 35): the number of files affected "is as irrelevant as the LOC you write per day"; substance matters.
- [SE: readability nitpick for DRY](https://softwareengineering.stackexchange.com/questions/398897/code-reviewing-nitpicks-for-readability-actually-for-dry) — *Corrected.* An answer claims that a dict rewrite of an if/elif chain changes which group matches first. Commenters rebut it: Python dicts are ordered and the groups are disjoint. The rewrite does contain a different, real bug: it iterates the dict without `.items()`. Either way, it shows that "readability" rewrites need tests.
- [SEC order on Knight Capital (2013)](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — Code unused since 2003 stayed callable and was not retested after a 2005 change. A new feature reused its flag, and one of eight servers was not updated. Erroneous orders ran for about 45 minutes, and the loss exceeded $460M. Rolling back the new code made it worse.
- [Joel Spolsky (2000)](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/) — Rewriting from scratch is "the single worst strategic mistake that any software company can make". Old code holds bug fixes that "took weeks of real-world usage before they were found."

## Contradictions and open questions

**Contradictions**
- **Do review measures predict quality?** McIntosh et al. (EMSE 2016; Qt, VTK, ITK) found that review coverage, participation and expertise "share a significant link with software quality". The Krutauz et al. replication (EMSE 2020; Qt and Chrome) found the effect "highly sensitive to variable selection procedure". Models without review predictors fit as well or better. Prior defects, size and authorship were the stable predictors.
- **Legacy cleanup: narrower than the researcher reported.**
  - LLVM rejects large-scale reformatting.
  - PEP 8 allows leaving pre-guideline code alone, but also calls such code "an opportunity to clean up someone else's mess".
  - Google's static-analysis chapter asks why one would "fix" code "running fine in production".
  - Chromium's "Try to clean up such code when you find it" covers only pre-rule ownership and pointer-passing code, which is a semantic cleanup.

  The synthesis the sources support: do not restyle untouched code, but do fix semantic and safety issues in hotspots and in code you are changing anyway.
- **Nits.** Google, GitLab, Chromium and Dan Lew treat nits as optional or as noise. BugsJustFindMe and iamevn argue that they matter or that they show the reviewer engaged. iLoveOncall says it depends on context. Labelling nits, rather than suppressing them, is the compromise all of these can accept.
- **Review order.** bt848 (HN, ex-Google) recommends reading tests and interfaces first. Microsoft's playbook says "It can be a strategy to look at tests first to help you understand the changes better." Spadini et al. (ICSE 2019, 93 developers) found that test-first review catches the same share of production defects and more test defects, but fewer production maintainability issues. Most developers they surveyed preferred to review production code first.
- **Change size.**
  - Google eng-practices: 100 lines is reasonable and 1000 too large, and file spread counts.
  - SWE book: "small" is about 200 lines.
  - SmartBear/Cisco (vendor data): under 200 LOC, never over 400, after filtering out 21% of reviews.
  - Czerwonka (2-page paper): usefulness drops from 20 files.
  - The accepted StackExchange answer: file and LOC counts matter less than substance.
- **YAGNI vs DI.** Google's TotT post calls a single-implementation interface a smell. A reader asks whether that contradicts Inversion of Control. Chromium recommends DI and fakes instead of test-only paths.
- **Refactoring risk vs payoff.** Bavota et al. found hierarchy refactorings fault-prone, and Microsoft developers perceive "substantial cost and risks". Yet Windows 7 modules refactored by a dedicated team had fewer post-release defects afterwards.
- **AI-assisted review.** Crupi et al. (ICPC 2026) found about 40% of the extra LLM comments meaningful and call LLM review complementary. Tufano et al. (ICSE 2025) found anchoring: more low-severity findings, no more high-severity ones, and no time saved. Greptile (vendor data) found 79% nits.

**Open questions**
- None of the thresholds (CL size, review rate, the 20-file drop, session length) were measured for an AI agent reviewing a whole finished codebase. The skill should measure its own address rate: the share of its findings that the user actually applies.
- Is Google's "under 10% effective false positives" bar the right bar for an LLM-driven skill's findings, and how would a solo developer measure it?
- The complexity thresholds (kernel 3 levels and 5-10 locals; ESLint 4 and 20; clang-tidy none by default, or 25 for cognitive complexity) are conventions. No empirical basis for choosing between them turned up in this topic; the complexity-metrics topic should check.
- No empirical evidence was found that separating refactor, move and format commits reduces defects. The support is guideline-level plus tooling.
- Google's eng-practices pages are undated, and their revision history after 2019 was not checked.
- SmartBear's "70-90% defect discovery" marketing claim was not traced to a primary dataset, and it is not used here.
- How should the pass behave in a solo repository, where authorship signals and second-reviewer assumptions do not apply?
- Resolved during verification:
  - The Mäntylä & Lassenius 75% figure is confirmed from its primary abstract (TSE 2009).
  - Tufano et al. is confirmed as ICSE 2025.
  - Crupi et al. is confirmed as accepted at ICPC 2026.

## Dropped findings

None. All 20 findings were traced to real sources that support them. Corrections and the two grade downgrades (F06, F17) are noted in each finding. No practitioner-voice item was dropped. One (SE 398897) was kept with a corrected gist.
