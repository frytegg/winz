# The deliverable: severity and confidence humans trust, and an honest before/after account of what the pass changed
> Code G204 · slug final-report-and-impact · verified 2026-09-23 · counts: verified 10 / corrected 9 / downgraded 2 / dropped 0

## Summary

**How this was checked.** Every cited source was opened on 2026-09-23 with WebFetch or with curl plus pdftotext (arXiv PDFs, the Google CACM PDF, the Trail of Bits PDF, Allodi et al.'s open-access PDF, the Bosu et al. PDF, the full OASIS SARIF HTML). Metadata came from the arXiv export API, Crossref, OpenAlex and the HN Algolia API. WebSearch was out of quota, so no search engine was used. The Facebook CACM paper returns 403 on cacm.acm.org, but it was read in full from a Wayback Machine copy. The researcher had only an HN quotation of it.

**Main corrections made:**
- Several SARIF 2.1.0 "quotes" were not verbatim. `semanticVersion` is **MAY**, not SHOULD. `executionSuccessful`, `toolExecutionNotifications` and `baselineGuid` were misworded. They are replaced below with the spec text.
- The Semgrep statement "cross-file analysis is not supported for diff-aware scans" is no longer on the cited page. It now lives on the Semgrep cross-file analysis page ("cross-file analysis does not currently run on diff-aware ... scans").
- Cedrim et al. (FSE 2017) was cited as "2.24% removed / 2.66% introduced" through a secondary source. The FSE 2017 abstract actually says **9.7% of refactorings removed smells and 33.3% introduced new ones**. The 2.24/2.66 figures come from an earlier 2016 version cited by AlOmar.
- "Agentic Refactoring" (Horikawa et al.) is a preprint *submitted to* TOSEM, not a TOSEM paper.
- Allodi et al.'s 30–60% error figure was misattributed to specific metrics. The paper says 30–60% of assessments contained errors (mostly off by one level) on certain metrics, depending on group and metric. Participants had no prior CVSS experience.
- In Wunder et al., documentation use and documentation-case knowledge were the strongest predictors. They were not the *only* significant ones: an attitude item was also significant, and the model explains just 12% of variance.
- The SSVC pilot kappas (0.226 / 0.295) come from a pre-v1 draft pilot with 6 analysts and 9 vulnerabilities. About ten definition changes followed it.

**KEY CONCLUSIONS (after verification)**

(1) **Severity labels are unreliable even among professionals.**
- Wunder et al. (IEEE S&P 2024): in a 9-month follow-up, 68% of 59 participants gave a different severity for the same vulnerability. Agreement on Scope was "far below 0.2" (Finn's coefficient).
- CERT/CC SSVC docs: CVSS is "designed to be accurate only within +/- 0.5" but "in practice, is scored with errors of around +/- 1.5 to 2.5", and these errors "often cross decision boundaries".
- Tian et al. (EMSE): about 51% of duplicate bug reports carry inconsistent human-assigned severity. Coarse ordinal labels are therefore also noisy. They do not remove disagreement; they only stop implying false precision.
- The SEI (Spring et al. 2018) recommends skipping "converting qualitative measurements to numbers".
- SSVC's own pre-v1 pilot reached only fair agreement (Fleiss κ 0.226 supplier, 0.295 deployer). The alternative is not proven more reliable.
- Consequences:
  - Use a small ordinal scale anchored to a written rubric.
  - Record likelihood/conditions on a second axis.
  - Treat a one-level disagreement as noise.
  - Never use decimal scores as the ordering key.

(2) **Confidence/verification is a separate field.**
- GitHub code scanning orders results by level and a rule-level `precision` (very-high/high/medium/low).
- Semgrep rules carry separate `likelihood`, `impact` and `confidence`.
- Bandit filters severity and confidence separately.
- Sonar keeps security hotspots ("a security-sensitive piece of code that the developer needs to review") apart from vulnerabilities.
- Fill the field from an evidence ladder: failing test > reproduction > high-precision rule > needs review > model inference.
- Do not fill it from an LLM's self-reported confidence:
  - Xiong et al. (ICLR 2024) found verbalized confidence overconfident, though calibration improved with model capability.
  - A vendor (Greptile) found an LLM's 1–10 self-rating of its own comments "nearly random".
- High or blocking items need a proof, as in the Sherlock, Code4rena and Immunefi rubrics. Grade C for this part: these are rubric conventions, not an evaluated intervention. At curl, by early July 2025 only about 5% of 2025 bounty submissions were genuine and about 20% were AI slop.

(3) **Report shape.**
- Findings delivered in-workflow get acted on; batch lists do not.
  - Facebook's Infer: an offline list gave "near silence", with 20–30 issues assigned and almost none acted on, versus a fix rate "over 70%" at diff time with the same analysis.
  - Google: issues in already-released code "are unlikely to be addressed", yet 57% of recipients were happy to get ready-made patches to checked-in code (41% neutral, 2% negative).
- The pass therefore ships fixes as small verified commits. Remaining items are grouped by the decision required and ordered blocking → severity → confidence, with nits capped.
- Usefulness falls with change size (Bosu et al., Microsoft, 1.5M comments) and with comment volume in a file (Turzo & Bosu, OpenDev).
- AI-review "resolution rates" depend on definition:
  - 19% → 55% addressed (Greptile, vendor);
  - 19.7% ActionableToApplied (Meta);
  - about 40% estimated (Google AutoCommenter);
  - 26.7% Outdated Rate for Go (ByteDance);
  - 38.7% code-changing (Atlassian RovoDev);
  - 73.8% "resolved" labels at Beko, which the authors themselves question.
  So "fixed" must mean code changed and verification passed.
- A SARIF 2.1.0 companion makes before/after matching and the limits section machine-checkable. Use `partialFingerprints`, `baselineState`, `suppressions[].status/justification`, `invocations[].executionSuccessful` and `toolExecutionNotifications`.

(4) **Before/after deltas.**
- VALID (count-based, verifiable):
  - verified defects fixed, each with a test;
  - vulnerabilities closed (same pinned scanner reports them absent, plus a test);
  - dependencies removed (lockfile diff);
  - suppressions removed (grep count, checked together with a config diff);
  - warnings under an identical pinned tool and config, matched by fingerprint as new/absent/unchanged. Never use a count diff: sarif-tools' README says equal new and resolved occurrences cancel out.
  - mutants killed on touched lines;
  - tests added, each tied to a finding;
  - LOC deleted as a raw count only.
- SUSPECT:
  - **Maintainability Index.** It decreased in 56.1% of 403 AI readability commits (Horikawa et al., MSR 2026). It "improved" in a study where external measures did not (Kannangara 2015). Van Deursen shows it is size-confounded.
  - **Density/ratio metrics.** Sonar's debt ratio, duplicated-lines density and line coverage all divide by LOC or executable lines, so they move when code is added or deleted.
  - **Coverage percentage.** Only a low-to-moderate correlation with effectiveness once suite size is controlled (Inozemtseva & Holmes, ICSE 2014).
  - **Smell totals.** Refactorings rarely remove smells: 7% (Bavota 2015, via a secondary source); 9.7% removed vs 33.3% introducing new ones (Cedrim, FSE 2017).

(5) **A mandatory limits section.** It lists:
- tools that failed or were not run (SARIF `executionSuccessful=false`);
- files not analysed (extraction failures);
- scope exclusions and "Not Considered" categories (Trail of Bits vocabulary), plus "Undetermined" severities and fix statuses;
- analysis blind spots, e.g. no cross-file analysis in Semgrep diff-aware scans;
- the statement that absence of findings is not absence of defects.

**DELIVERABLE A — FINDING SCHEMA.** One record per finding, mirrored in SARIF:
- id; fingerprint (SARIF `partialFingerprints`); title; location(s); rule/category;
- severity: enum critical|high|medium|low|info, plus `rubric_criterion`;
- conditions/difficulty: enum none|some|significant|undetermined, plus a note;
- confidence/verification: enum verified_by_failing_test | reproduced_by_command | tool_high_precision_rule | needs_human_review | model_inference_only;
- evidence: test name, command plus output excerpt, SARIF result ref, trace of the code path;
- action: applied_commit `<sha>` | proposed_patch | decision_needed `<question>` | none;
- blocking: true only for verified correctness, security or data-integrity defects, or behaviour-change risk, with a reason;
- behaviour_change_risk: none|low|medium|high, with a reason;
- fix_status: fixed_verified | partially_fixed | not_fixed | undetermined, with the verification command;
- user_decision: accepted|rejected|pending.

**DELIVERABLE B — REPORT TEMPLATE** for one reader, about 2 screens before the appendices:
0. Header: commit range, tool versions, config hashes, runtime.
1. Summary, 8 lines or fewer:
   - posture in one sentence;
   - a count table of decision group × severity;
   - the top 3 decisions;
   - valid deltas only;
   - one line on the biggest limits.
2. Needs your decision (blocking first).
3. Applied changes: one commit per finding, with the verification command and result.
4. Not fixed / deferred.
5. Nits, capped at about 10.
6. Before/after table: every metric with raw n/N plus a validity note.
7. Limits.
8. Appendix: SARIF path, config hashes.

**Grades after verification:**
- **A:**
  - severity unreliability (F01);
  - SARIF machinery (F11);
  - same-config fingerprint deltas (F12);
  - coverage vs mutation (F15).
- **B:**
  - two-axis rubric (F02);
  - confidence field (F03);
  - effective false-positive tracking (F05);
  - fix delivery (F06);
  - resolution definitions (F07);
  - ordering and volume (F08);
  - MI (F13);
  - density metrics (F14);
  - refactoring claims (F16);
  - limits (F18);
  - fix status (F19).
- **C:**
  - proof for high/blocking findings (F04, downgraded);
  - no LLM self-rated severity (F20, downgraded);
  - decision grouping (F09);
  - summary shape (F10);
  - the valid-delta list (F17);
  - narrow "blocking" (F21).

No finding was dropped. Some sub-claims were removed; they are listed at the end.

## Findings

### G204-F01 — Never use numeric/decimal severity as the priority signal; use a small ordinal scale and treat one-level disagreement as noise
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  - The Allodi et al. paraphrase was fixed; the full text was read (open access, CC-BY).
  - The SSVC pilot was qualified as a pre-v1 draft pilot.
  - Added that ordinal labels are *also* unreliable (Tian), so the scale avoids false precision without curing disagreement.
- **Rationale:** Severity assessment has poor inter- and intra-rater reliability even among professionals, and fine-grained numbers imply precision that does not exist:
  - evaluators disagreed on core CVSS metrics and changed their own severities over time;
  - the measured error spans whole severity bands;
  - NVD and CNAs diverge on the same CVEs;
  - bug-tracker severity is inconsistent for about half of duplicate reports.

  The SEI's proposed fix is to map qualitative measurements directly to decisions instead of numbers. If a CVSS vector is genuinely required (e.g., the project issues CVEs), attach it as metadata with FIRST's CVSS-B/BT/BE/BTE nomenclature, not as the ordering key. The evidence comes from security-vulnerability scoring and bug-tracker severity. Transferring it to code-quality severity is an inference, though a reasonable one.
- **Evidence:**
  - [Shedding Light on CVSS Scoring Inconsistencies (arXiv 2308.15259v2)](https://arxiv.org/abs/2308.15259) — Wunder, Kurtz, Eichenmüller, Gassmann, Benenson, IEEE S&P 2024 — peer_reviewed — "in the follow-up study with 59 participants (volunteers from the main study) conducted 9 months later, evaluations of the same person changed severity for 68% of participants"; Scope: "All Finn's coefficients were far below 0.2, which indicates a very poor agreement"; Holm & Afridi: "38% of evaluations differed in severity from NVD scores" — verified in the PDF full text (196 participants in the main survey).
  - [Measuring the accuracy of software vulnerability assessments (EMSE 25:1063–1094)](https://link.springer.com/article/10.1007/s10664-019-09797-4) — Allodi, Cremonini, Massacci, Shim, 2020 — peer_reviewed — "The large errors we observe on certain metrics (between 30% and 60% of tests, depending on the group of respondents and the metric...) are mostly produced by errors of size 1"; "SEC+PRO is between 30% to 60% less likely than CS in making an error"; "Even experienced professionals in the security field may produce evaluations with high variance, and in some cases not dissimilar to evaluations produced by students trained in security" — verified in the open-access PDF. **Corrected:** the 30–60% figure is not specific to AV/AC/PR; the AV/AC/PR/CIA observation concerns where the *skill gap* was most evident. Participants had no prior CVSS experience.
  - [SSVC: Items With the Same Priority](https://certcc.github.io/SSVC/topics/items_with_same_priority/) — CERT/CC, current docs — standard — "CVSS v3.1 is designed to be accurate only within +/- 0.5, and, in practice, is scored with errors of around +/- 1.5 to 2.5"; "CVSS errors often cross decision boundaries" — verified.
  - [Towards Improving CVSS](https://www.sei.cmu.edu/library/towards-improving-cvss/) — Spring, Hatleback, Householder, Manion, Shick (CMU SEI), Dec 2018 — industry_report — "the CVSS scoring algorithm is not justified, either formally or empirically"; "We suggest that the way to fix this problem is to skip converting qualitative measurements to numbers" — verified in the PDF (sei.cmu.edu/documents/574/2018_019_001_538372.pdf).
  - [The Cathedral and the Bazaar of Software Vulnerabilities: From the NVD to the CNAs (arXiv 2607.05670)](https://arxiv.org/abs/2607.05670) — Siqi Zhang, Fabio Massacci, Mengyuan Zhang, July 2026 — preprint — "Attack Complexity, User Interaction, and Impact are the major metrics where divergence happens"; models trained on one source lose accuracy on another ("accuracy can drop by 40%") — verified in the abstract.
  - [On the unreliability of bug severity data (EMSE 21)](https://link.springer.com/article/10.1007/s10664-015-9409-1) — Tian, Ali, Lo, Hassan, online 2015 / print Dec 2016 — peer_reviewed — "around 51 % of the duplicate bug reports have inconsistent human-assigned severity labels even though they refer to the same software problem" (OpenOffice, Mozilla, Eclipse) — verified in the Springer abstract.
  - [CVSS v4.0 Specification Document](https://www.first.org/cvss/v4.0/specification-document) — FIRST, v1.2, 18 June 2024 — standard — CVSS-B / BT / BE / BTE: "This nomenclature should be used wherever a numerical CVSS value is displayed or communicated." — verified.
- **Detect:**
  - `grep -nE 'CVSS:[34]\.[01]/|(score|severity|risk)[^\n]{0,15}[0-9]+\.[0-9]' REPORT.md`.
  - `jq '[.findings[] | select(.severity | IN("critical","high","medium","low","info") | not)] | length' findings.json` → 0.
  - Any CVSS number present carries its B/BT/BE/BTE suffix.
- **Tools:** grep, jq.
- **Applies to:** every severity field in the report and the SARIF companion, in any language.
- **When not to apply / counterpoints:**
  - In Wunder et al., 80% of evaluators still find CVSS useful and over 70% "clearly agreed" to keep using it.
  - Coarse labels lose ranking information.
  - Ordinal labels are themselves inconsistent (Tian: 51% of duplicates).
  - SSVC, the main alternative, showed only fair agreement in its draft pilot: 6 analysts, 9 vulnerabilities, Fleiss κ 0.226 supplier / 0.295 deployer, 0.122 Safety and 0.146 Mission impact. That pilot preceded SSVC v1, and about ten definition refinements followed ([SSVC evaluation of draft trees](https://certcc.github.io/SSVC/topics/evaluation_of_draft_trees/), verified).
- **Fix risk:** low

### G204-F11 — Ship a SARIF 2.1.0 companion with fingerprints, baselineState, suppressions+justification, and per-invocation success/notifications
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  - The `executionSuccessful` quote was not in the spec; replaced with the spec text.
  - The `baselineState` wording was paraphrased; replaced with the verbatim text.
  - "Sonar export" was removed from applies-to: SonarQube documents *importing* SARIF, and export was not verified.
- **Rationale:** SARIF is the OASIS interchange standard for static-analysis results. It already defines what makes before/after claims and the limits section machine-checkable:
  - fingerprints to match results over time;
  - `baselineState` to classify change against a baseline;
  - suppression status and justification;
  - per-invocation success and runtime notifications.

  GitHub code scanning uses `partialFingerprints` to match results across commits.
- **Evidence:**
  - [SARIF Version 2.1.0 Plus Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html) — OASIS, 28 Aug 2023 — standard — verified in the full HTML:
    - fingerprint: "stable value that can be used by a result management system to uniquely identify a result over time, even if a relevant artifact is modified";
    - baselineState: "new": "This result was detected in the current run but was not detected in the baseline run"; "absent": "This result was detected in the baseline run but was not detected in the current run"; NOTE 1: "The purpose of baselineState is to allow (for example) a measurement of how many new results were introduced in the run, and how many previously existing results no longer appear";
    - §3.20.14: "An invocation object SHALL contain a property named executionSuccessful whose value is a Boolean that is true if the engineering system that started the process knows that the analysis tool succeeded, and false if the engineering system knows that the tool failed";
    - suppression status "accepted" / "underReview" / "rejected";
    - justification: "a user-supplied string that explains why the result was suppressed".
  - [SARIF support for code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning) — GitHub Docs, accessed 2026 — official_docs — "Code scanning uses partialFingerprints to accurately identify which results are the same across commits and branches"; "Note: Code scanning only uses the primaryLocationLineHash"; security-severity "over 9.0 is critical, from 7.0 to 8.9 is high, from 4.0 to 6.9 is medium and from 0.1 to 3.9 is low" — verified.
- **Detect:**
  - `jq '[.runs[].results[] | select(.partialFingerprints == null and .fingerprints == null)] | length' out.sarif` → 0.
  - `jq '[.runs[].invocations[]? | select(.executionSuccessful != true)]' out.sarif` lists failed tools, which must appear in Limits.
  - `jq '[.runs[].results[] | select(.baselineState == null)] | length'` → 0 on the post-pass run.
- **Tools:** jq; GitHub code scanning (optional); microsoft/sarif-tools (summaries only; repo active, not archived, last push April 2026).
- **Applies to:**
  - every tool the pass runs that can emit SARIF natively (e.g., CodeQL, Semgrep, Bandit `-f sarif`, verified in the Bandit manual) or via a converter or formatter (e.g., ESLint, clippy);
  - hand-written findings, under a synthetic `tool.driver`.
- **When not to apply / counterpoints:**
  - Many linters need converters.
  - GitHub honours only `primaryLocationLineHash`.
  - A solo developer may never open the file; its main value is making the before/after claims auditable.
  - The standard defines the encoding; no study shows that shipping SARIF increases reader trust.
- **Fix risk:** low

### G204-F12 — Report a warnings delta only under identical pinned tool version and config, matched by fingerprint (new/absent/unchanged), never by count difference
- **Grade:** A · **Verdict:** CORRECTED. Changes:
  - The spec says a toolComponent "**MAY** contain a property named semanticVersion", not SHOULD.
  - The `baselineGuid` quote was invented wording; replaced with the spec text.
  - The Semgrep diff-aware cross-file limitation moved to a different docs page; the citation was replaced.
- **Rationale:**
  - Count diffs hide churn. sarif-tools' own README warns that equal numbers of new and resolved occurrences cancel out.
  - SARIF provides `baselineState` and fingerprints for result matching.
  - Semgrep's cross-file analysis does not run on diff-aware scans, so a diff-aware "no new findings" is weaker than a full scan.
  - Any tool, rule or config change between runs makes the delta meaningless. Record `version` (always) and `semanticVersion` (when present) plus a config hash.
- **Evidence:**
  - [sarif-tools README](https://raw.githubusercontent.com/microsoft/sarif-tools/main/README.md) — Microsoft, current — official_docs — "When the number of occurrences of an issue code is unchanged, diff will not report this issue code, although it is possible that an equal number of new occurrences of the specific issue have arisen as have been resolved. This is to avoid reporting line number changes." — verified.
  - [SARIF v2.1.0 Plus Errata 01](https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html) — OASIS, 2023 — standard — verified:
    - §3.19.12: "A toolComponent object MAY contain a property named semanticVersion";
    - §3.19.13: `version`, "in whatever format the component natively provides";
    - §3.14.5: `baselineGuid` "SHALL equal the automationDetails.guid property ... of some previous run. NOTE: This ensures that only similar runs are compared".
  - [Semgrep: cross-file analysis](https://semgrep.dev/docs/semgrep-code/semgrep-pro-engine-intro) — Semgrep, accessed 2026-09-23 — official_docs — "Full scans now include cross-file analysis... Note that cross-file analysis does not currently run on diff-aware (pull request or merge request) scans." — verified. **Substituted** for docs.semgrep.dev/deployment/customize-ci-jobs, which no longer contains the quoted sentences. Cross-file analysis is a Semgrep AppSec Platform feature.
- **Detect:**
  - `jq '.runs[].tool.driver | {name, version, semanticVersion}' before.sarif after.sarif` must be identical per tool.
  - `sha256sum` the config files (e.g., `.eslintrc*`, `.semgrep.yml`, `pyproject.toml`) for both runs.
  - Delta: build sets of `ruleId` + `partialFingerprints.primaryLocationLineHash` and report |new|, |absent|, |unchanged|.
- **Tools:** jq, sha256sum, git, microsoft/sarif-tools (coarse check only).
- **Applies to:** any "warnings reduced from X to Y" claim.
- **When not to apply / counterpoints:**
  - Line-hash fingerprints break when code moves heavily; a moved-but-unchanged issue can appear as absent+new. Say so when large refactors happened.
  - Pinning prevents adopting newer rules mid-pass without a separate baseline rerun.
- **Fix risk:** low

### G204-F15 — Don't use coverage % as the test-quality delta; report tests added (linked to findings) and mutation results on touched lines
- **Grade:** A · **Verdict:** VERIFIED (caveats added).
- **Rationale:**
  - Once suite size is controlled, coverage correlates only low-to-moderately with fault-detection effectiveness, and the authors say not to use it as a quality target.
  - At Google, mutation testing run incrementally on changed code during review led developers to write more and better tests, and its mutants were coupled with real high-priority faults.
  - Restricting mutants to changed code and limiting them per line is what made it practical.
  - Fix commits rarely add targeted tests.
- **Evidence:**
  - [Coverage Is Not Strongly Correlated with Test Suite Effectiveness (ICSE 2014)](https://www.cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf) — Inozemtseva & Holmes, 2014 — peer_reviewed — "we generated 31,000 test suites for five systems consisting of up to 724,000 lines of source code"; "there is a low to moderate correlation between coverage and effectiveness when the number of test cases in the suite is controlled for"; coverage "should not be used as a quality target" — verified in the PDF. Note: effectiveness was measured by mutant detection, not real faults.
  - [Does mutation testing improve testing practices? (ICSE 2021)](https://arxiv.org/abs/2103.07189) — Petrović, Ivanković, Fraser, Just (Google) — peer_reviewed — "almost 15 million mutants"; "developers using mutation testing write more tests, and actively improve their test suites"; "mutants are indeed coupled with real faults" (high-priority faults); coverage vs test quality "is a matter of ongoing debate" — verified in the abstract.
  - [Practical Mutation Testing at Scale](https://arxiv.org/abs/2102.11378) — Petrović et al., 2021 — preprint (submitted to IEEE) — "mutating only changed code during code review, rather than the entire code base"; "limiting the number of mutants per line and per code review process"; ">24,000 developers on more than 1,000 projects" — verified in the abstract.
  - [Is Self-Admitted Technical Debt Tested? (arXiv 2609.13485)](https://arxiv.org/abs/2609.13485) — Yoshimoto, Horikawa, Feitosa, Kashiwa, Iida, Sept 2026 — preprint — "only 3.4% of SATD removal commits include new tests specifically targeting the resolved debt (vs. 12.5% that co-add tests in the same commit)" — verified. Note: eight open-source Java projects.
- **Detect:**
  - Run the mutation tool on `git diff --name-only <base>..HEAD` (Stryker for JS/TS, PIT for Java, mutmut for Python, cargo-mutants for Rust). Report killed/total for touched code and list survivors.
  - `jq '[.tests_added[] | select(.finding_id == null)] | length'` → 0.
- **Tools:** Stryker, PIT, mutmut, cargo-mutants, git.
- **Applies to:** the before/after test section. Where no mutation tool exists, state "mutation not run" in Limits.
- **When not to apply / counterpoints:**
  - Other studies (not re-fetched here) report stronger coverage/effectiveness correlations, and Google itself calls the question debated.
  - Equivalent mutants inflate the survivor count.
  - Runtime can be high on large touched areas.
  - Coverage still usefully identifies completely untested code.
- **Fix risk:** low

### G204-F05 — Track the pass's own "effective false positive" rate per category and demote categories above ~10%
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Google defines an effective false positive by developer action, not technical truth.
  - Code-review checks must stay under 10% effective false positives, and analyzers whose "Not useful" ratio exceeds 10% are disabled.
  - FindBugs rollouts that produced unfixed lists failed.
  - AutoCommenter's team stresses that a few bad experiences erode trust, and that suppressing noisy categories raised usefulness.
- **Evidence:**
  - [Lessons from Building Static Analysis Tools at Google (CACM 61(4))](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/) — Sadowski, Aftandilian, Eagle, Miller-Cushon, Jaspan, April 2018 — peer_reviewed (magazine) — verified in the PDF (storage.googleapis.com/.../4365.pdf):
    - "We consider an issue to be an 'effective false positive' if developers did not take positive action after seeing the issue";
    - "Produce less than 10% effective false positives";
    - "If the ratio for an analyzer goes above 10%, the Tricorder team disables the analyzer";
    - footnote: "initially chosen by the first author somewhat arbitrarily";
    - FindBugs Fixit: "3,954 such warnings ... only 16% (640) were actually fixed".
  - [AI-Assisted Assessment of Coding Practices in Modern Code Review (AutoCommenter)](https://arxiv.org/abs/2405.13565) — Vijayvergiya et al. (Google), AIware '24 — peer_reviewed (conference) — verified in the PDF:
    - "the useful ratio plateaued at around 54%";
    - suppressing 17 non-actionable URLs raised it to 66%;
    - further changes were "sufficient to reach our target useful ratio of 80%";
    - "Even a few negative user experiences can erode trust in an automated system."
- **Detect:** Record `user_decision` per finding. Compute rejected/(accepted+rejected) per rule or category and persist it (e.g., `.quality-pass/fp-ledger.json`). On the next run, demote categories above 0.10 when n ≥ 10.
- **Tools:** jq.
- **Applies to:** repeated runs on the same codebase or by the same developer.
- **When not to apply / counterpoints:**
  - A solo developer's reject can mean "not now". Karakaya et al. (EASE 2026) show labels reflect workflow pressure.
  - With few findings the ratio is noise.
  - Google's 10% threshold was chosen "somewhat arbitrarily".
- **Fix risk:** low

### G204-F06 — Deliver fixes as small, individually verified commits (one finding per commit), not as a recommendations list
- **Grade:** B · **Verdict:** CORRECTED. The Facebook CACM primary was verified via a Wayback copy, replacing the HN-only proxy. It is now noted that the batch arm was only 20–30 assigned issues. Added the AutoCommenter observation that developers do not act on unchanged code.
- **Rationale:** Findings on already-written, released code are the worst case for uptake.
  - Facebook's same Infer analysis got near-zero action as an offline list and over 70% fixes at diff time.
  - Google notes developers are hesitant to change tested, released code. AutoCommenter filters comments on unchanged lines because "Developers typically do not take action on unchanged code".
  - Ready-made fixes change this: Google's patches to checked-in code were welcomed by 57% of recipients (2% negative), and Copilot Autofix cut median fix time from 1.5 h to 28 min (vendor data).
  - Routing matters too: Meta's AI patches slowed reviewers by over 5% until they were shown only to authors.
- **Evidence:**
  - [Scaling Static Analyses at Facebook (CACM 62(8), CC-BY)](https://cacm.acm.org/magazines/2019/8/238344-scaling-static-analyses-at-facebook/fulltext) — Distefano, Fähndrich, Logozzo, O'Hearn, Aug 2019 — peer_reviewed (magazine) — "the diff time deployment saw a 70% fix rate, where a more traditional 'offline' or 'batch' deployment ... saw a 0% fix rate"; "We assigned 20-30 issues to developers, and almost none of them were acted on. We had worked hard to get the false positive rate down to what we thought was less than 20%"; "the fix rate rocketed to over 70%. The same program analysis, with same false positive rate, had much greater impact when deployed at diff time" — verified in the full text via a web.archive.org copy (cacm.acm.org and queue.acm.org return 403; Crossref DOI 10.1145/3338112). Also quoted in [HN comment by sqs](https://news.ycombinator.com/item?id=20844718), verified.
  - [Lessons from Building Static Analysis Tools at Google](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/) — Sadowski et al., 2018 — peer_reviewed — verified in the PDF:
    - "Developers are thus hesitant to make additional changes to code that has already been tested and released, and lower severity and less-important issues are unlikely to be addressed";
    - "57% of them who received a proposed fix to checked-in code were happy to have received it, and 41% were neutral. Only 2% responded negatively";
    - "Reviewers clicked 'Please Fix' more than 5,000 times per day, and authors applied the automated fixes approximately 3,000 times per day".
  - [AI-Assisted Assessment of Coding Practices in Modern Code Review](https://arxiv.org/abs/2405.13565) — Vijayvergiya et al. (Google), AIware '24 — peer_reviewed — "80% of comments would have been posted on lines of code not modified by the author. Developers typically do not take action on unchanged code." — verified.
  - [Secure code more than three times faster with Copilot Autofix](https://github.blog/news-insights/product-news/secure-code-more-than-three-times-faster-with-copilot-autofix/) — GitHub Blog, 14 Aug 2024 — industry_report (vendor) — "the median time for developers to use Copilot Autofix to automatically commit the fix for a pull request-time alert was 28 minutes, compared to 1.5 hours to resolve the same alerts manually" (public beta, May–July 2024) — verified.
  - [AI-Assisted Fixes to Code Review Comments at Scale (MetaMateCR)](https://arxiv.org/abs/2507.13499) — Maddila et al. (Meta), July 2025 — preprint — "we see a large regression with reviewers taking over 5% longer to conduct reviews. After investigation, we modify the UX to only show authors the AI patches, and see no regressions"; production ActionableToApplied 19.7% — verified. These are patches for human reviewer comments, not for static-analysis findings.
- **Detect:**
  - `git log --oneline <base>..HEAD`: each commit references exactly one finding id.
  - `git cat-file -e <sha>` for each `applied_commit`.
  - `grep -nE '\b(consider|could|might want to)\b' REPORT.md` for free-floating advice.
- **Tools:** git, grep, jq.
- **Applies to:** all fixable findings in a finished, tested codebase.
- **When not to apply / counterpoints:**
  - Applying fixes carries behaviour-change risk that listing does not.
  - Design or API decisions must stay proposals.
  - The Facebook batch arm was small (20–30 issues). All of this evidence comes from large companies with code-review workflows; its transfer to a solo developer reading one report is plausible but unmeasured.
- **Fix risk:** medium

### G204-F07 — Count a finding as "fixed" only if code changed at (or causally for) the location and verification passed; state the definition behind any resolution rate
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Published industrial resolution rates for LLM review comments span about 19%–74%, largely because of definitions:
  - Beko's 73.8% is a developer-applied label the authors say may be misused;
  - Atlassian's 38.7% counts comments that triggered code changes;
  - Google estimates about 40% from comments absent in the final snapshot;
  - ByteDance tracks an Outdated Rate (26.7% for Go);
  - Greptile's baseline address rate was 19%.

  A 2026 follow-up at Beko shows fixed/wontFix labels are shaped by workflow pressure.
- **Evidence:**
  - [Automated Code Review In Practice (ICSE-SEIP 2025)](https://arxiv.org/abs/2412.18531) — Cihan et al. (Bilkent / Beko) — peer_reviewed — verified in the PDF:
    - "73.8% of the comments are labeled as 'Resolved,' while 21.3% are labeled as 'Won't Fix'";
    - PR closure time rose from "five hours 52 minutes to eight hours 20 minutes";
    - "developers might also disregard the expected labeling policy and use 'Resolved' instead of 'Closed' or 'Won't Fix'".
  - [RovoDev Code Reviewer (ICSE-SEIP 2026)](https://arxiv.org/abs/2601.01129) — Tantithamthavorn et al. (Atlassian) — peer_reviewed — "code resolution for 38.70% (i.e., comments that triggered code changes in the subsequent commits)"; PR cycle time −30.8% — verified.
  - [AutoCommenter](https://arxiv.org/html/2405.13565) — Vijayvergiya et al. (Google), 2024 — peer_reviewed — "in 50% of cases the comment was absent from the submitted snapshot on the lines it was originally posted ... in 80% of cases, a change made by the author directly resolved the issue ... we estimate that the comment-resolution rate is about 40%" — verified.
  - [BitsAI-CR](https://arxiv.org/abs/2501.15134) — Sun et al. (ByteDance), Jan 2025 — preprint — "75.0% precision"; "For the Go language ... we maintain an Outdated Rate of 26.7%"; the metric "can reflect developers' actual adoption of review comments" — verified.
  - [Understanding the Limits of Automated Evaluation for Code Review Bots in Practice (EASE 2026)](https://arxiv.org/abs/2604.24525) — Karakaya, Torun, Uçar, Tüzün — peer_reviewed (accepted) — 2,604 comments; "Agreement ratios range from approximately 0.44 to 0.62"; "Developer actions such as resolving or ignoring comments reflect not only comment quality, but also contextual constraints, prioritization decisions, and workflow dynamics" — verified.
  - [How we made our AI code review bot stop leaving nitpicky comments](https://www.greptile.com/blog/make-llms-shut-up) — Daksh Gupta (Greptile), 18 Dec 2024 — engineering_blog (vendor) — "address rate (percentage of Greptile's comments that devs address before merging) go from 19% to 55+%" — verified.
- **Detect:** For each `fixed_verified`, check two things:
  - `git diff <base>..HEAD -- <file>` touches the flagged range, or the commit explains the causal link;
  - the verification command is present and its output excerpt is in the report.

  jq: `[.findings[] | select(.fix_status=="fixed_verified" and ((.commit // "")=="" or (.verification.command // "")==""))] | length` → 0.
- **Tools:** git, jq.
- **Applies to:** the before/after section and any headline number.
- **When not to apply / counterpoints:**
  - Code at a flagged line can change for unrelated reasons.
  - Valid fixes can land elsewhere.
  - These numbers come from different tools, models and populations and are not benchmarks.
- **Fix risk:** low

### G204-F02 — Every severity cites the written rubric criterion it meets; likelihood/preconditions go on a second axis
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - "Code4rena judges on likelihood and impact" was narrowed: its docs apply that to privilege-escalation and privileged-function scenarios.
  - In Wunder et al., documentation use and documentation-case knowledge are the *strongest* predictors, not the *only* significant ones.
  - Added Sherlock's opposite stance as a counterpoint.
  - Noted that Sonar's Blocker level mixes probability into severity.
- **Rationale:**
  - Mature rubrics define severity by concrete impact, and many judge likelihood separately: Trail of Bits reports Severity × Difficulty, Semgrep records likelihood / impact / confidence, and OWASP WSTG asks for likelihood and impact per finding.
  - In Wunder et al.'s regression, using CVSS documentation and answering documentation cases correctly were the strongest positive predictors of scoring performance, while years of CVSS experience had no effect. Anchoring to written criteria is the one lever that was measured, though only correlationally.
  - Example rubric (a synthesis, not validated):
    - critical = verified data loss, corruption, security compromise or crash on a default path;
    - high = wrong result on a realistic path;
    - medium = failure needing unusual state or input;
    - low = maintainability or evolvability only;
    - info = no expected impact.
- **Evidence:**
  - [SonarQube Server: Software qualities (MQR severities)](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-rules/software-qualities) — SonarSource, 2026 — official_docs — Blocker: "An issue that has a significant probability of severe unintended consequences on the application that should be fixed immediately." High / Medium / Low: high / medium / low "impact". Info: "There is no expected impact on the application." — verified.
  - [Code4rena severity categorization](https://docs.code4rena.com/competitions/severity-categorization) — Code4rena, 2026 — official_docs — High: "Assets can be stolen/lost/compromised directly (or indirectly if there is a valid attack path that does not have hand-wavy hypotheticals)"; "Privilege escalation issues are judged by likelihood and impact" — verified (the likelihood/impact wording is scoped to privileged scenarios).
  - [NATS Server Security Assessment (OSTIF), appendix A](https://github.com/trailofbits/publications/blob/master/reviews/2025-04-ostif-nats-securityreview.pdf) — Trail of Bits, 27 Feb 2025 — industry_report — separate Severity Levels (Informational/Undetermined/Low/Medium/High) and Difficulty Levels; "Undetermined: The difficulty of exploitation was not determined during this engagement." — verified in the PDF.
  - [Contributing to Semgrep rules: metadata](https://docs.semgrep.dev/contributing/contributing-to-semgrep-rules-repository) — Semgrep, 2026 — official_docs — Likelihood: "Specify how likely it is that an attacker can exploit the issue that has been found"; Impact: "Indicate how much damage a vulnerability can cause"; Confidence separate — verified.
  - [Shedding Light on CVSS Scoring Inconsistencies, Table 7](https://arxiv.org/abs/2308.15259) — Wunder et al., 2024 — peer_reviewed — standardized coefficients (t-values): "Using CVSS documents during CVSS assessment 0.423 (2.42)", "Correct answers to CVSS documentation cases 1.163 (3.06)", "Years working with CVSS 0.0133 (0.71)"; "Opinion: CVSS should be used to assess severity 0.369 (2.31)" is also significant; "R2 is 0.118 ... low explanatory power" — verified in the PDF.
  - [HN comment: Remote code execution in OpenSSH's forwarded SSH-agent](https://news.ycombinator.com/item?id=36791701) — tptacek, 19 Jul 2023 — practitioner_forum — "A more reasonable way to look at severity is on a two dimensional scale of lo-hi severity and lo-hi situationality." — verified.
  - [OWASP WSTG 5.1 Reporting Structure](https://raw.githubusercontent.com/OWASP/wstg/master/document/5-Reporting/01-Reporting_Structure.md) — OWASP, master — standard — each finding includes "The likelihood or exploitability of the issue" and its impact — verified.
- **Detect:**
  - `jq '[.findings[] | select((.rubric_criterion // "") == "" or (.conditions // "") == "")] | length'` → 0.
  - Manually read 3 random findings and check that the cited criterion literally matches the described impact.
- **Tools:** jq.
- **Applies to:** all findings except pure style nits (labelled `nit`, no severity).
- **When not to apply / counterpoints:**
  - R² = 0.118: rubrics help but do not solve disagreement.
  - Sherlock states the opposite design choice: "Likelihood is not considered when identifying the severity and the validity of the report" ([Sherlock guidelines](https://docs.sherlock.xyz/audits/judging/guidelines), verified).
  - Fund-loss rubrics do not map directly onto code-quality defects.
  - The example rubric is unvalidated.
- **Fix risk:** low

### G204-F03 — Record confidence/verification as its own field, filled from an evidence ladder, never from the model's self-reported confidence
- **Grade:** B · **Verdict:** VERIFIED. Added the caveat that Xiong et al. tested 2023-era models on general QA tasks and found calibration improves with model capability.
- **Rationale:**
  - Major tools keep "how bad" apart from "how sure": GitHub/SARIF use level plus rule `precision`, Semgrep and Bandit have confidence, and Sonar splits hotspots that need review from vulnerabilities.
  - LLM-verbalized confidence is measurably overconfident.
  - A finding that is severe but unverified must read differently from one that is severe and verified.
  - The ladder, highest first: verified_by_failing_test > reproduced_by_command > tool_high_precision_rule > needs_human_review > model_inference_only. Only the top two may be called "confirmed".
- **Evidence:**
  - [SARIF support for code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning) — GitHub Docs, 2026 — official_docs — `properties.precision`: "Code scanning orders results by precision on GitHub so that the results with the highest level, and highest precision are shown first. Can be one of: very-high, high, medium, or low." — verified (rule-level property).
  - [SonarQube Server: Security hotspots](https://docs.sonarsource.com/sonarqube-server/user-guide/security-hotspots) — SonarSource, 2026 — official_docs — "a security-sensitive piece of code that the developer needs to review"; statuses To review / Acknowledged / Fixed / Safe; review priority set by rule category (OWASP Top 10 / CWE Top 25 ranking) — verified.
  - [Semgrep rule metadata: confidence](https://docs.semgrep.dev/contributing/contributing-to-semgrep-rules-repository) — Semgrep, 2026 — official_docs — HIGH: "Security concern, with high true positives"; LOW: "Expect a fair amount of false positives, similar to audit style rules" — verified.
  - [Bandit manual](https://bandit.readthedocs.io/en/latest/man/bandit.html) — PyCQA, current — official_docs — `--severity-level={all,high,medium,low}` and `--confidence-level={all,high,medium,low}` — verified.
  - [Can LLMs Express Their Uncertainty? (ICLR 2024)](https://arxiv.org/abs/2306.13063) — Xiong, Hu, Lu, Li, Fu, He, Hooi — peer_reviewed — "LLMs, when verbalizing their confidence, tend to be overconfident"; also "As model capability scales up, both calibration and failure prediction performance improve" — verified.
- **Detect:**
  - Every finding's `confidence` is in the ladder enum.
  - `jq '[.findings[] | select(.confidence=="verified_by_failing_test" and (.evidence.test // "")=="")] | length'` → 0.
  - `grep` for bare probabilities ("90% confident", "likely (0.8)").
- **Tools:** jq, grep.
- **Applies to:** all findings; the SARIF companion (map the ladder to `result.rank` or a properties bag).
- **When not to apply / counterpoints:**
  - Tool `precision` is a per-rule estimate by the rule author, not a per-finding measurement.
  - The five-rung ladder is a synthesis.
  - No study compares developer trust across confidence vocabularies.
  - Xiong's evidence predates current models and is not about code review.
- **Fix risk:** low

### G204-F08 — Order the report blocking → severity → confidence, label item types, and cap nits (rest to SARIF only)
- **Grade:** B · **Verdict:** CORRECTED. GitHub's limit is "Only the top 5,000 results will be included, prioritized by severity" (included, not merely displayed). Clarified that Bosu's effect is about change size (files in the change), while Turzo & Bosu's is about comment volume in a file.
- **Rationale:**
  - Comment usefulness falls with change size and comment volume. Both results are correlational.
  - GitHub orders by level and precision and truncates to the top 5,000 results per run.
  - A vendor found it could not prompt an LLM into fewer nits without losing critical comments, so the cap must be structural.
  - Google labels minor comments Nit / Optional / FYI.
- **Evidence:**
  - [Characteristics of Useful Code Reviews: An Empirical Study at Microsoft (MSR 2015)](https://www.microsoft.com/en-us/research/publication/characteristics-of-useful-code-reviews-an-empirical-study-at-microsoft/) — Bosu, Greiler, Bird — peer_reviewed — verified in the PDF:
    - 1.5M comments;
    - "the more files that are in a change, the lower the proportion of comments in the code review that will be of value to the author of the change";
    - "The interviewees rated almost 69% comments as either useful or somewhat useful";
    - nit-picking issues rated "Somewhat useful" or "Useful" because they "help long-term project maintenance".
  - [What Makes a Code Review Useful to OpenDev Developers? (EMSE 2023)](https://arxiv.org/abs/2302.11686) — Turzo & Bosu — peer_reviewed — 2,500 comments; "the number of mutual reviews, comment volume in a file, the total number of lines added /modified, and CR interval has the opposite associations" — verified.
  - [SARIF support for code scanning](https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning) — GitHub Docs — official_docs — "Results per run 25,000 — Only the top 5,000 results will be included, prioritized by severity." — verified.
  - [How we made our AI code review bot stop leaving nitpicky comments](https://www.greptile.com/blog/make-llms-shut-up) — Greptile, 2024 — engineering_blog (vendor) — "we simply could not get the LLM to produce fewer nits without also producing fewer critical comments"; baseline "~19% were good, 2% were flat-out incorrect, and 79% were nits" — verified.
  - [Google Engineering Practices: How to write code review comments](https://google.github.io/eng-practices/review/reviewer/comments.html) — Google — official_docs — "Nit: This is a minor thing. Technically you should do it, but it won't hugely impact things."; "Optional (or Consider)"; "FYI" — verified.
- **Detect:**
  - Count items labelled nit and check the count is ≤ the cap.
  - Ordering check: `jq '.findings | map([(.blocking|not), .severity_rank, .confidence_rank]) as $k | ($k == ($k|sort))'` → true.
- **Tools:** jq, grep.
- **Applies to:** the human report (SARIF keeps everything).
- **When not to apply / counterpoints:**
  - Bosu et al. show nits have some long-term value, so cap and demote rather than ban.
  - "10" is a convention, not a measured threshold.
- **Fix risk:** low

### G204-F13 — Do not report Maintainability Index before/after as evidence of improvement
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - MI was introduced in 1992 (Oman & Hagemeister). It was fitted on HP systems written in C and Pascal in the late 1980s, of 1,000–10,000 LOC.
  - Its components are all size-correlated, and averaging masks high-risk parts.
  - It moves in both directions regardless of intent: AI agents' readability commits lowered MI in 56.1% of cases, and another study saw MI "improve" while no external quality measure did.
- **Evidence:**
  - [Do AI Agents Really Improve Code Readability? (MSR 2026)](https://arxiv.org/abs/2603.13723) — Kyogo Horikawa, Kosei Horikawa, Kashiwa, Uwano, Iida — peer_reviewed (5-page paper) — 403 commits; "the Maintainability Index decreased in 56.1% of commits, while Cyclomatic Complexity increased in 42.7%" — verified.
  - [Think Twice Before Using the Maintainability Index](https://avandeursen.com/2014/08/29/think-twice-before-using-the-maintainability-index/) — Arie van Deursen (TU Delft), 29 Aug 2014 — engineering_blog (academic author) — "all underlying metrics (Halstead, Cyclomatic Complexity, Lines of Code) are directly correlated with size"; metrics "follow a power law, and taking the average tends to mask the presence of high-risk parts"; "you'll be better off looking at lines of code"; HP systems "written in C and Pascal in the late 80s, 'ranging in size from 1000 to 10,000 lines of code'" — verified.
  - [An Empirical Evaluation of Impact of Refactoring On Internal and External Measures of Code Quality (IJSEA 6(1))](https://arxiv.org/abs/1502.03526) — Kannangara & Wijayanayake, 2015 — peer_reviewed (low-tier venue) — "The result of external measures did not show any improvements ... maintainability index indicated an improvement" — verified.
- **Detect:** `grep -niE 'maintainability index|\bMI\b' REPORT.md`. Any hit in the before/after table without an invalidity note is a violation. MI is emitted by `radon mi` and by Visual Studio code metrics.
- **Tools:** grep; radon (Python); Visual Studio code metrics.
- **Applies to:** the before/after section.
- **When not to apply / counterpoints:**
  - MI is familiar to managers and built into common tools.
  - The 56.1% figure is one short MSR study of AI-agent commits.
  - Older validation studies were not re-checked here.
- **Fix risk:** low

### G204-F14 — Never present a density/ratio metric as a before/after improvement without its raw numerator and denominator
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Sonar's definitions divide by LOC or executable lines, so adding code improves these ratios and deleting code changes them with no quality change. For example, deleting uncovered dead code raises line coverage with zero new tests (arithmetic from the formula).
  - Averages over power-law distributions hide the risky tail.
  - Professional audits report raw counts.
- **Evidence:**
  - [SonarQube Server: Metric definitions](https://docs.sonarsource.com/sonarqube-server/user-guide/code-metrics/metrics-definition) — SonarSource, 2026 — official_docs — verified:
    - "sqale_debt_ratio = technical debt /(cost to develop one line of code * number of lines of code)", with a default of 30 minutes per line;
    - rating A ≤ 5% … E ≥ 50%;
    - "duplicated_lines_density = duplicated_lines / lines * 100";
    - "line_coverage = LC / EL".
  - [Think Twice Before Using the Maintainability Index](https://avandeursen.com/2014/08/29/think-twice-before-using-the-maintainability-index/) — van Deursen, 2014 — engineering_blog — power-law / averaging quote — verified.
  - [NATS Server Security Assessment](https://github.com/trailofbits/publications/blob/master/reviews/2025-04-ostif-nats-securityreview.pdf) — Trail of Bits, 2025 — industry_report — "there are 214 of them. There are around 3,600 instances of ignored error values" — verified.
- **Detect:**
  - Every % or ratio row carries n/N for both runs.
  - Coverage: `grep -E '^(LF|LH):' lcov.info | awk -F: '{s[$1]+=$2} END{print s["LH"]"/"s["LF"]}'` before and after. If LF dropped, annotate that the denominator shrank.
- **Tools:** grep, awk, lcov, SonarQube Web API measures.
- **Applies to:** any codebase where the pass added or deleted code.
- **When not to apply / counterpoints:** Densities are legitimate for comparing modules or projects of different sizes at one point in time. The problem is only their use as a delta on a codebase whose size the pass itself changed.
- **Fix risk:** low

### G204-F16 — Don't claim refactoring "reduced smells" / "improved design"; report specific verified structural facts, recomputed with the pinned detector and fingerprint matching
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - Cedrim et al. (FSE 2017) figures replaced with the primary abstract's: 9.7% removed, 33.3% introduced. The 2.24%/2.66% came from AlOmar's summary of an earlier 2016 version.
  - "Agentic Refactoring" re-typed as a preprint submitted to TOSEM.
  - Bavota remains secondary-only.
- **Rationale:** Empirical refactoring studies find that refactoring moves smell counts and metrics little, or in mixed directions:
  - Bavota et al. (via AlOmar): smells removed in only 7% of cases.
  - Cedrim et al. (FSE 2017): 79.4% of refactorings touched smelly elements, but only 9.7% removed smells and 33.3% introduced new ones.
  - Alshayeb (via AlOmar): quality both improved and decreased.
  - Midolo et al.: GPT-4o refactorings reduced smells but decreased readability.
  - Agentic refactoring shows only small structural improvements.
- **Evidence:**
  - [Understanding the impact of refactoring on smells: a longitudinal study of 23 software projects (ESEC/FSE 2017)](https://doi.org/10.1145/3106237.3106259) — Cedrim, Garcia, Mongiovi, Gheyi, Sousa, de Mello, Fonseca, Ribeiro, Chávez — peer_reviewed — abstract (via the OpenAlex API): "16,566 refactorings ... Even though 79.4% of the refactorings touched smelly elements, 57% did not reduce their occurrences. Surprisingly, only 9.7% of refactorings removed smells, while 33.3% induced the introduction of new ones." — verified (ACM full text 403). **Corrected** from 2.24%/2.66%.
  - [An Empirical Study on the Impact of Code Duplication-aware Refactoring Practices on Quality Metrics](https://arxiv.org/abs/2502.04073) — Eman Abdullah AlOmar, Feb 2025 — preprint — secondary: Bavota et al.: "42% of the refactorings performed are affected by code smells, and the refactorings were able to eliminate code smells only in 7% of the cases"; Alshayeb: refactoring "could also decrease software quality to some extent in other classes"; Chávez et al.: root-canal refactorings "either improved or at least did not worsen internal quality attributes"; own conclusion "certain metrics do not fully capture these intentions" — verified in the PDF.
  - [An experimental investigation on the innate relationship between quality and refactoring (JSS, Sept 2015)](https://www.sciencedirect.com/science/article/pii/S0164121215001296) — Bavota, De Lucia, Di Penta, Oliveto, Palomba — peer_reviewed — existence and metadata verified via Crossref and OpenAlex (DOI 10.1016/j.jss.2015.05.024). The abstract is not available (publisher-elided) and ScienceDirect returns 403. The 7% figure is confirmed only via AlOmar's secondary description.
  - [From Human to Machine Refactoring: Assessing GPT-4's Impact on Python Class Quality and Readability](https://arxiv.org/abs/2601.13139) — Midolo, Tramontana, Di Penta, Jan 2026 — preprint — "GPT-4o generally produces behavior-preserving refactorings that reduce code smells and improve quality metrics, albeit at the cost of decreased readability" (100 ClassEval classes) — verified.
  - [Agentic Refactoring: An Empirical Study of AI Coding Agents](https://arxiv.org/abs/2511.04824) — Kosei Horikawa, Li, Kashiwa, Adams, Iida, Hassan, Nov 2025 — **preprint (submitted to TOSEM)** — 15,451 refactorings; "small but statistically significant improvements in structural metrics ... (e.g., Class LOC median Δ = -15.25)"; Rename Variable 8.5% — verified.
- **Detect:** `grep -niE 'reduc(ed|es) (code )?smells|improv(ed|es) (the )?(design|quality|maintainability)' REPORT.md`. Each hit must be backed by a pinned-tool before/after metric and a test reference, or be rewritten.
- **Tools:** grep; the project's smell detector (pinned).
- **Applies to:** refactoring commits and their description in the report.
- **When not to apply / counterpoints:**
  - Chávez et al. (via AlOmar) report that 55% of floss-refactoring operations improved internal attributes, with only 10% degrading them.
  - Horikawa et al. report small significant gains.
  - The rule is about claims, not about refactoring itself.
- **Fix risk:** low

### G204-F18 — Mandatory Limits section (failed/not-run tools, unanalysed files, exclusions, "Not Considered" categories, unresolved items, blind spots, absence ≠ proof)
- **Grade:** B · **Verdict:** CORRECTED. The SARIF `toolExecutionNotifications` quote was not verbatim and was replaced. The Semgrep citation was moved to the page that now holds the cross-file limitation.
- **Rationale:**
  - Professional reviews state coverage and non-coverage explicitly. Trail of Bits lists Project Coverage, rates categories "Not Considered" due to time and scope, uses "Undetermined", and adds a coverage disclaimer.
  - OWASP WSTG lists limitations.
  - SARIF records tool success and runtime notifications.
  - GitHub's tool status page reports per-file extraction success.
- **Evidence:**
  - [NATS Server Security Assessment](https://github.com/trailofbits/publications/blob/master/reviews/2025-04-ostif-nats-securityreview.pdf) — Trail of Bits, 2025 — industry_report — verified in the PDF:
    - "Due to time and scope constraints, patching mechanisms were not considered during this audit." (rated Not Considered);
    - "the findings documented in this report should not be considered a comprehensive list of security issues, flaws, or defects";
    - "a tool may not generate a random edge case that violates a property or may not fully complete its analysis during the allotted time" (Test Coverage Disclaimer).
  - [OWASP WSTG 5.1 Reporting Structure](https://raw.githubusercontent.com/OWASP/wstg/master/document/5-Reporting/01-Reporting_Structure.md) — OWASP — standard — "Limitations can be: Out-of-bounds areas in relation to testing. Broken functionality. Lack of cooperation. Lack of time. Lack of access or credentials." — verified.
  - [About the tool status page](https://docs.github.com/en/code-security/code-scanning/managing-your-code-scanning-configuration/about-the-tool-status-page) — GitHub Docs, 2026 — official_docs — CSV includes "Whether the file was successfully extracted"; "a percentage total of all the files most recently scanned in your repository, organized by programming language" — verified.
  - [SARIF v2.1.0 Plus Errata 01, §3.20.21](https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html) — OASIS, 2023 — standard — "An invocation object MAY contain a property named toolExecutionNotifications whose value is an array of zero or more notification objects (3.58). Each element of the array represents a runtime condition detected by the invoked process" — verified (corrected wording).
  - [Semgrep: cross-file analysis](https://semgrep.dev/docs/semgrep-code/semgrep-pro-engine-intro) — Semgrep, 2026 — official_docs — "cross-file analysis does not currently run on diff-aware (pull request or merge request) scans" — verified (substituted source).
- **Detect:**
  - The report has `## Limits` with subsections (a)–(g).
  - Every invocation with `executionSuccessful != true` is named in Limits.
  - Every language present in `git ls-files` that no tool analysed is listed.
- **Tools:** jq, git ls-files, grep.
- **Applies to:** every run, including clean ones (then state the scope explicitly).
- **When not to apply / counterpoints:**
  - Long limit lists read as hedging, so keep them terse.
  - External-audit disclaimers partly serve legal needs a solo developer does not have.
- **Fix risk:** low

### G204-F19 — Explicit fix status and, for security-sensitive items, a hotspot-style review status; every "safe"/"won't fix" carries a justification mirrored as a SARIF suppression
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Audit practice separates fix status from severity and allows "Undetermined".
  - Sonar hotspots distinguish reviewed-safe from fixed.
  - SARIF standardizes suppression status and justification.
  - The Beko study shows a mandatory single "resolved" label becomes unreliable. The pass should therefore fill statuses from evidence rather than make the human label everything.
- **Evidence:**
  - [NATS Server Security Assessment, appendix G and fix review results](https://github.com/trailofbits/publications/blob/master/reviews/2025-04-ostif-nats-securityreview.pdf) — Trail of Bits, 2025 — industry_report — statuses "Undetermined", "Unresolved", "Partially Resolved", "Resolved"; "Resolved in PR #5790. The HTTP servers have been configured with a five-second read timeout." — verified.
  - [SonarQube Server: Security hotspots](https://docs.sonarsource.com/sonarqube-server/user-guide/security-hotspots) — SonarSource, 2026 — official_docs — To review / Acknowledged / Fixed / Safe — verified.
  - [Automated Code Review In Practice (threats to validity)](https://arxiv.org/html/2412.18531v2) — Cihan et al., ICSE-SEIP 2025 — peer_reviewed — "the mandatory comment resolution policy could be considered time-consuming for practitioners because they do not provide reliable comment resolution labels" — verified.
- **Detect:**
  - `jq '[.findings[] | select(.fix_status | IN("fixed_verified","partially_fixed","not_fixed","undetermined") | not)] | length'` → 0.
  - `jq '[.findings[] | select((.review_status=="safe" or .fix_status=="not_fixed") and ((.justification // "")==""))] | length'` → 0.
  - Every suppressed SARIF result has `suppressions[].justification`.
- **Tools:** jq.
- **Applies to:** all findings, in the report and SARIF.
- **When not to apply / counterpoints:** More bookkeeping; mandatory human labelling degrades label quality.
- **Fix risk:** low

### G204-F04 — High/critical or blocking findings need a concrete proof (failing test, repro command with output, or exact code-path trace); otherwise downgrade confidence, not inflate severity
- **Grade:** C · **Verdict:** DOWNGRADED (B → C). The support is rubric conventions from adversarial audit and bounty platforms plus one maintainer's bounty statistics; no study tests whether requiring proof raises reader trust. Two wordings were also corrected:
  - Sherlock *recommends* a PoC for certain categories rather than requiring it.
  - Immunefi's "theoretical impacts" exclusion is in its Websites and Apps section.
- **Rationale:**
  - Mature rubrics refuse hypothetical impact:
    - Sherlock recommends a PoC "to avoid placing the burden of proof on the judge";
    - Immunefi puts "Theoretical impacts without any proof or demonstration" out of scope for websites and apps;
    - Code4rena's High excludes "hand-wavy hypotheticals".
  - SSVC's Exploitation decision point is evidence-graded (None / Public PoC / Active).
  - When unproven reports flood in, maintainers lose goodwill: at curl, by early July 2025 about 5% of 2025 submissions had proved genuine, and each report engages 3–4 people for 30 minutes to 3 hours.
- **Evidence:**
  - [Sherlock judging guidelines](https://docs.sherlock.xyz/audits/judging/guidelines) — Sherlock, current — official_docs — "A PoC (Proof of Concept) is recommended for issues in any of the following categories to avoid placing the burden of proof on the judge: Non-obvious issues with complex vulnerabilities or attack paths; Issues with non-trivial input constraints...; precision loss; Reentrancy..." — verified.
  - [Immunefi Vulnerability Severity Classification System v2.3](https://immunefi.com/immunefi-vulnerability-severity-classification-system-v2-3/) — Immunefi, v2.3 (no date on page) — official_docs — Websites and Apps out of scope: "Theoretical impacts without any proof or demonstration" — verified.
  - [SSVC deployer decision model](https://certcc.github.io/SSVC/howto/deployer_tree/) — CERT/CC, current — standard — Exploitation (ssvc:E:1.1.0): "None: There is no evidence of active exploitation and no public proof of concept (PoC)"; "Public PoC"; "Active: Shared, observable, reliable evidence that the exploit is being used in the wild" — verified.
  - [Death by a thousand slops](https://daniel.haxx.se/blog/2025/07/14/death-by-a-thousand-slops/) — Daniel Stenberg (curl), 14 Jul 2025 — engineering_blog — AI slop "about 20% of all submissions"; "In early July, about 5% of the submissions in 2025 had turned out to be genuine vulnerabilities"; "Every report thus engages 3-4 persons. Perhaps for 30 minutes, sometimes up to an hour or three. Each." — verified.
  - [There is an AI code review bubble (HN)](https://news.ycombinator.com/item?id=46766961) — The_Fox (about CodeRabbit), 26 Jan 2026 — practitioner_forum — "It regularly finds problems ... It also regularly complains about things that are possible in theory but impossible in practice, so we've gotten used to just resolving those comments without any action." — verified via the Algolia API.
- **Detect:**
  - `jq '[.findings[] | select((.severity=="critical" or .severity=="high" or .blocking==true) and ((.evidence.kind // "") | IN("failing_test","repro_command","code_path_trace") | not))] | length'` → 0.
  - Rerun each repro command and confirm the stated output.
- **Tools:** jq; the project test runner.
- **Applies to:** correctness, security, concurrency, data-loss and behaviour-change findings.
- **When not to apply / counterpoints:**
  - Some real defects (races, environment-specific failures) cannot be reproduced cheaply. Keep them at needs_human_review; do not delete them.
  - Contest rubrics are tuned for fund loss.
  - Writing repro tests costs pass time.
- **Fix risk:** low

### G204-F20 — Don't let the agent self-rate severity/confidence; derive severity from stated rubric facts (impact, trigger conditions, entry point) and confidence from the evidence ladder
- **Grade:** C · **Verdict:** DOWNGRADED (B → C). The support is indirect:
  - Greptile's "nearly random" is a vendor anecdote (1–10 self-rating, threshold 7).
  - Karakaya et al.'s 0.44–0.62 is agreement with developer labels that the same paper says are not objective ground truth.
  - Xiong et al. used 2023-era models on general QA and found calibration improves with scale.
  - Marchiori et al. is a workshop paper on CVSS vectors.
  - The HN statement is from Greptile's founder (a vendor).

  The mechanical-derivation prescription itself is untested.
- **Rationale:** Self-assessed severity by an LLM is poorly calibrated in the available evidence. Forcing the agent to state the impact, trigger conditions and reachable entry point before severity is mapped makes the rating auditable. It reduces variance; it does not guarantee truth.
- **Evidence:**
  - [How we made our AI code review bot stop leaving nitpicky comments](https://www.greptile.com/blog/make-llms-shut-up) — Greptile, 2024 — engineering_blog (vendor) — "add a filtering step where the LLM could rate the severity of a comment+diff pair on a 1-10 scale ... Sadly, this also failed. The LLMs judgment of its own output was nearly random." — verified.
  - [Understanding the Limits of Automated Evaluation for Code Review Bots in Practice (EASE 2026)](https://arxiv.org/abs/2604.24525) — Karakaya et al. — peer_reviewed — "Agreement ratios range from approximately 0.44 to 0.62" (Gemini-2.5-pro, GPT-4.1-mini, GPT-5.2) — verified.
  - [Can LLMs Classify CVEs? (TrustAICyberSec 2025)](https://arxiv.org/abs/2504.10713) — Marchiori, Donadel, Conti — peer_reviewed (workshop) — "embedding-based methods outperform them in scoring more subjective components, particularly confidentiality, integrity, and availability impacts" — verified.
  - [Can LLMs Express Their Uncertainty? (ICLR 2024)](https://arxiv.org/abs/2306.13063) — Xiong et al. — peer_reviewed — "tend to be overconfident"; calibration improves with capability — verified.
  - [There is an AI code review bubble (HN)](https://news.ycombinator.com/item?id=46766961) — dakshgupta (Greptile founder), 27 Jan 2026 — practitioner_forum — "LLMs are reluctant to risk downplaying the severity of an issue and therefore are unable to usefully filter out nits." — verified.
- **Detect:**
  - Every finding has non-empty `impact_fact`, `trigger_conditions` and `entry_point` before severity is set.
  - Grep the pass's prompts and logs for self-rating prompts ("rate the severity", "how confident are you") used as final values.
- **Tools:** jq, grep.
- **Applies to:** any AI-agent-produced finding.
- **When not to apply / counterpoints:**
  - bjackman (same HN thread, verified) reports that heavily customized review prompts took AI review from "pure noise" to valuable.
  - Rubric-driven severity still inherits the agent's misreading of the code.
- **Fix risk:** low

### G204-F09 — Group the report by the decision the reader must take, not by rule or tool
- **Grade:** C · **Verdict:** VERIFIED (SSVC pilot nuance added).
- **Rationale:**
  - SSVC replaced numeric scores with decision outcomes. It argues that same-priority items can be done in any order, and that fine-grained ordering within qualitative categories was "essentially just giving random fine-grained priorities".
  - Audit reports use per-finding fix-status categories.
  - Conventional Comments encodes decision impact.
  - Suggested groups:
    1. Needs your decision now (blocking);
    2. Applied, review the commit;
    3. Deferred / not fixed, with the reason;
    4. Informational.
- **Evidence:**
  - [SSVC deployer decision model (ssvc:DSOI:1.0.0)](https://certcc.github.io/SSVC/howto/deployer_tree/) — CERT/CC — standard — "Defer: Do not act at present"; "Scheduled: Act during regularly scheduled maintenance time"; "Out-of-Cycle"; "Immediate: Act immediately" — verified.
  - [SSVC: Items With the Same Priority](https://certcc.github.io/SSVC/topics/items_with_same_priority/) — CERT/CC — standard — same-priority items "can be patched in any order"; CVSS was "essentially just giving random fine-grained priorities within qualitative categories anyway" — verified.
  - [Conventional Comments](https://conventionalcomments.org/) — conventionalcomments.org — practitioner convention — "(blocking): A comment with this decoration should prevent the subject under review from being accepted, until it is resolved"; "(non-blocking): ... should not prevent the subject under review from being accepted"; "(if-minor)" — verified.
  - [NATS Server Security Assessment, appendix G](https://github.com/trailofbits/publications/blob/master/reviews/2025-04-ostif-nats-securityreview.pdf) — Trail of Bits, 2025 — industry_report — Undetermined / Unresolved / Partially Resolved / Resolved — verified.
- **Detect:**
  - The report's H2 headings match the decision-group set.
  - Each finding has exactly one `decision_group`.
  - No section is titled by tool or rule id.
- **Tools:** jq, grep.
- **Applies to:** the human report; SARIF can stay rule-ordered.
- **When not to apply / counterpoints:**
  - No study shows decision grouping beats rule grouping for readers.
  - SSVC's pre-v1 draft pilot showed only fair agreement on final decisions (κ 0.226 / 0.295; 6 analysts, 9 vulnerabilities).
- **Fix risk:** low

### G204-F10 — Summary ≤ 8 lines: posture, counts by decision group × severity, top 3 decisions, systemic vs isolated, valid deltas only, pointer to limits; no scores/grades/percentages without n/N
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - Trail of Bits' executive summary states posture, severity and category counts, and whether issues indicate systemic flaws, and it reports raw counts.
  - OWASP WSTG asks for the objective, key findings in business context and strategic recommendations, without jargon.
- **Evidence:**
  - [NATS Server Security Assessment](https://github.com/trailofbits/publications/blob/master/reviews/2025-04-ostif-nats-securityreview.pdf) — Trail of Bits, 2025 — industry_report — "the issues described in this report do not appear to indicate systemic flaws in the NATS team's development process; rather, they are more likely to be the result of isolated mistakes"; severity table High 0 / Medium 3 / Low 1 / Informational 6 / Undetermined 0 — verified.
  - [OWASP WSTG 5.1 Reporting Structure](https://raw.githubusercontent.com/OWASP/wstg/master/document/5-Reporting/01-Reporting_Structure.md) — OWASP — standard — "The objective of the test"; "Key findings in a business context"; "The strategic recommendations"; "Avoid jargon and negative speculation." — verified.
- **Detect:**
  - The Summary section has ≤ 8 lines.
  - Every `%` in it has an adjacent n/N.
  - `grep -E 'grade|score|rating [A-E]'` hits are violations.
- **Tools:** grep, awk.
- **Applies to:** the report header of every run.
- **When not to apply / counterpoints:**
  - These templates target multi-reader external audits.
  - No empirical comparison of summary formats was found.
- **Fix risk:** low

### G204-F17 — Only count-based, verifiable before/after deltas, each with a validity note
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - This is a synthesis of F12–F16.
  - The valid list:
    1. verified defects fixed, failing then passing;
    2. vulnerabilities closed (same pinned scanner shows them absent, plus a test or trace);
    3. dependencies removed (lockfile diff);
    4. suppressions removed (grep count, with a config diff);
    5. warnings under identical pinned config (F12);
    6. mutants killed on touched lines (F15);
    7. tests added, linked to findings;
    8. LOC deleted as a raw count, not a quality claim.
  - Mark MI, densities, smell totals and coverage % as "not valid as improvement evidence".
- **Evidence:**
  - [-2000 Lines Of Code](https://www.folklore.org/Negative_2000_Lines_Of_Code.html) — Andy Hertzfeld, folklore.org (event Feb 1982) — engineering anecdote — Bill Atkinson "wrote in the number: -2000"; managers stopped asking him for the form — verified.
  - [Is Self-Admitted Technical Debt Tested?](https://arxiv.org/abs/2609.13485) — Yoshimoto et al., 2026 — preprint — "only 3.4% of SATD removal commits include new tests specifically targeting the resolved debt" — verified (8 Java projects).
  - [SARIF v2.1.0 Plus Errata 01, §3.35](https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html) — OASIS, 2023 — standard — suppression `status` "accepted" / "underReview" / "rejected"; `justification` — verified.
- **Detect:**
  - Suppressions: `git grep -cE 'eslint-disable|# noqa|@SuppressWarnings|#\[allow\(|//nolint|# type: ignore|NOSONAR'` at `<base>` and at HEAD.
  - Lockfile resolved-package diff.
  - `git diff --shortstat <base>..HEAD`.
  - Each defect: test id plus "fails at base, passes at HEAD".
- **Tools:** git, grep, jq.
- **Applies to:** the before/after section of every run.
- **When not to apply / counterpoints:**
  - Counts can be gamed (splitting fixes, weakening rules in config instead of removing suppressions).
  - No study validates this exact list.
- **Fix risk:** low

### G204-F21 — Define "blocking" narrowly (verified correctness/security/data-integrity defect or pass-introduced behaviour change); style/naming/docs/micro-optimizations/"possible in theory" are never blocking
- **Grade:** C · **Verdict:** CORRECTED. Sherlock lists these categories as "not considered valid", not as "invalid/low". Added Code4rena's statement that informational issues are "discouraged".
- **Rationale:**
  - Reviewer conventions and audit rubrics draw this line explicitly: Conventional Comments, Google Nit/Optional/FYI, Sherlock's list of issue categories not considered valid, and Code4rena's QA/Low tier.
  - Over-escalation is what makes practitioners call AI reviewers noise.
  - Every blocking item states what exactly blocks and what unblocks it.
- **Evidence:**
  - [Conventional Comments](https://conventionalcomments.org/) — practitioner convention — "(blocking): ... should prevent the subject under review from being accepted, until it is resolved"; "nitpick: Nitpicks are trivial preference-based requests. These should be non-blocking by nature." — verified.
  - [Sherlock judging guidelines, VII](https://docs.sherlock.xyz/audits/judging/guidelines) — Sherlock — official_docs — "List of Issue categories that are not considered valid: Gas optimizations ... Incorrect Event values ... Zero address checks ... User input validation to prevent user mistakes is not considered a valid issue" (unless it causes major protocol malfunction or fund loss) — verified.
  - [Code4rena severity categorization](https://docs.code4rena.com/competitions/severity-categorization) — Code4rena — official_docs — "QA ... Includes Low risk (e.g. assets are not at risk: state handling, function incorrect as to spec, issues with comments)"; "Informational issues (code style, clarity, syntax, versioning, off-chain monitoring (events, etc) are discouraged" — verified.
  - [HN comment on Greptile](https://news.ycombinator.com/item?id=46777079) — sebra, 27 Jan 2026 — practitioner_forum — "I've tried Greptile and it's pretty much pure noise. I ran it for 3 PRs and then gave up." — verified.
- **Detect:**
  - `jq '[.findings[] | select(.blocking==true and (.category | IN("style","naming","docs","nit","micro-optimization")))] | length'` → 0.
  - Every blocking item has a non-empty `unblock_condition`.
- **Tools:** jq.
- **Applies to:** all findings, especially AI-generated review output.
- **When not to apply / counterpoints:**
  - On public-API or regulated projects, doc or naming errors can be contract-breaking and therefore blocking. Allow project-local overrides.
  - Contest rubrics are analogues only.
- **Fix risk:** low

## Practitioner voice

All items below were opened and checked (HN comments via the Algolia items API).

- [curl: CVSS is dead to us](https://daniel.haxx.se/blog/2025/01/23/cvss-is-dead-to-us/) — Stenberg, 23 Jan 2025. curl stopped using CVSS and uses low/medium/high/critical. CISA's ADP scored CVE-2024-11053 "9.1 CRITICAL" against curl's LOW, because ADP analysts "click some buttons in a CVSS calculator". Scanners then raise needless alarms.
- [Death by a thousand slops](https://daniel.haxx.se/blog/2025/07/14/death-by-a-thousand-slops/) — curl bounty 2025. About 20% of submissions were AI slop, and by early July about 5% were genuine vulnerabilities. Each report engages 3–4 people for 30 minutes to 3 hours.
- [Greptile: make LLMs shut up](https://www.greptile.com/blog/make-llms-shut-up) — vendor, Dec 2024. Of its comments, about 19% were good and 79% nits. Prompting could not cut nits without cutting critical comments, and LLM self-rating was "nearly random". Embedding-based filtering on past downvotes raised the address rate from 19% to 55%+.
- [There is an AI code review bubble (HN, 351 points)](https://news.ycombinator.com/item?id=46766961) — Jan 2026, about 250 comments.
  - zmmmmm: hard to stop it listing "20 highly speculative reasons" alongside the one critical error.
  - The_Fox (about CodeRabbit): real finds plus "possible in theory but impossible in practice" comments.
  - eieio (at Jane Street): reviewers directly changed nitpicky things instead of commenting, and kept blocking comments for things worth discussing.
- [sebra on Greptile](https://news.ycombinator.com/item?id=46777079) — abandoned after 3 PRs as "pure noise": bad exception advice, "python 3.14 does not exist yet", vague architecture advice. The per-PR "confidence" score made reviewers think something was wrong.
- [the__alchemist on CodeRabbit](https://news.ycombinator.com/item?id=46772357) — "We have Code Rabbit at work, and it's made PRs unreadable."
- [tptacek on CVSS (2023)](https://news.ycombinator.com/item?id=36791701) — "CVSS is meaningless, literally a Ouija board that reflects the intuition of whoever's computing the score". Proposes a two-dimensional severity × situationality scale.
- [tptacek (2025)](https://news.ycombinator.com/item?id=43604427) — has come to take very-high-CVSS vulnerabilities less seriously: "Heartbleed was a '7.5'".
- [Arch-TK on the CUPS scores (2024)](https://news.ycombinator.com/item?id=41670183) — says the Red Hat scorer "took the 'fudge it until it looks bad' approach", then re-derives much lower vectors from the spec (5.3 / 4.3 / 3.3 / 8.2). Same facts, very different numbers.
- [sqs quoting Facebook's CACM paper](https://news.ycombinator.com/item?id=20844718) — same Infer analysis and false-positive rate: about 0% action as a batch list vs over 70% at diff time. The primary was verified separately; see F06.
- [KZeillmann on 100% coverage](https://news.ycombinator.com/item?id=28677898) — calls enforced 100% coverage "an application of Goodhart's Law". He wrote tests "only to hit the if blocks" that "didn't mean that the tests I wrote were any good". He is still a fan of 100% coverage "with some leeway".
- [-2000 Lines Of Code](https://www.folklore.org/Negative_2000_Lines_Of_Code.html) — Bill Atkinson reported −2000 lines on Apple Lisa's weekly form (1982), and managers stopped asking. LOC deleted is an activity count, not a value measure.
- [Trail of Bits NATS review (PDF)](https://github.com/trailofbits/publications/blob/master/reviews/2025-04-ostif-nats-securityreview.pdf) — a real audit template, with:
  - severity + difficulty axes;
  - "Undetermined" and "Not Considered";
  - a code-quality appendix;
  - raw counts (214 unchecked type assertions, about 3,600 ignored errors);
  - fix-review statuses;
  - a coverage disclaimer.

## Contradictions and open questions

**Contradictions**
- **SSVC vs CVSS reliability.** SSVC is promoted as the fix for CVSS inconsistency, but its own draft pilot (6 analysts, 9 vulnerabilities, pre-v1) reached only fair agreement: Fleiss κ 0.226 supplier and 0.295 deployer, 0.122 Safety and 0.146 Mission impact. The authors call it "some agreement" and refined about ten definitions afterwards. No post-v1 reliability figure was found.
- **Expertise effects.** Allodi et al. (EMSE 2020) found security-skilled groups made 30–60% fewer errors than CS students, and professionals were better only on User Interaction. Even so, "experienced professionals ... may produce evaluations with high variance". Wunder et al. (S&P 2024) found years of CVSS experience had no effect, while documentation use and knowledge did. *(The researcher's added claim about an Allodi WEIS 2018 version could not be verified and was removed.)*
- **Likelihood in severity.** OWASP WSTG, Trail of Bits (difficulty) and Semgrep (likelihood) record likelihood separately, and Code4rena uses likelihood × impact for privileged scenarios. Sherlock explicitly states "Likelihood is not considered when identifying the severity and the validity of the report."
- **AI-review resolution rates** conflict mostly through definitions:
  - 73.8% "resolved" labels at Beko (labels questioned by the authors);
  - 38.7% code-changing at Atlassian;
  - about 40% estimated at Google;
  - 26.7% Outdated Rate at ByteDance;
  - 19.7% ActionableToApplied at Meta;
  - 19% → 55% addressed at Greptile.

  The same Beko group later showed LLM judges agree only 0.44–0.62 with fixed/wontFix labels, which themselves reflect workflow pressure.
- **Refactoring vs metrics.** Bavota 7% (secondary only) and Cedrim FSE 2017 (9.7% removed vs 33.3% introduced) show little smell reduction. Chávez et al. (via AlOmar) and Horikawa et al. (preprint) report neutral-to-positive internal effects. Midolo et al. find GPT-4o refactoring reduced smells but decreased readability. *(Earlier drafts cited Cedrim at 2.24%/2.66%, figures from a 2016 version; the FSE 2017 abstract gives 9.7%/33.3%.)*
- **The Maintainability Index** moves both ways, disconnected from intent: it improved after refactoring while external quality did not (Kannangara 2015), and it decreased in 56.1% of AI readability commits (Horikawa MSR 2026).
- **Nits.** Bosu et al. found nit-picking rated "somewhat useful" or "useful" for long-term maintenance, while vendors and practitioners call nits the main noise source. Resolution: cap and demote rather than ban.
- **Coverage.** Inozemtseva & Holmes report low-to-moderate correlation with effectiveness at controlled size, with effectiveness measured by mutants. Google's mutation authors call the relationship "a matter of ongoing debate", and other studies (not re-fetched) report stronger correlations.
- **Delivery.** Ready patches help: Google saw 57% of recipients happy and 2% negative, and Facebook's diff-time fix rate exceeded 70%. But Meta's AI patches shown to reviewers slowed reviews by over 5% until shown only to authors. Patches help when routed to the person who acts.
- **Calibration.** Xiong et al. show LLM verbalized confidence is overconfident, yet also that calibration improves with model capability. The finding may be weaker for current models; it has not been re-tested on code-review severity.
- **Densities.** They are legitimate for cross-module comparison at one point in time but invalid as a before/after delta on a codebase whose size the pass changed. The conflict is about use, not about the metric.

**Open questions**
- No study measures inter-rater agreement for non-security code-quality severity labels (e.g., Sonar MQR Blocker/High/Medium/Low). The closest evidence is bug severity (51% inconsistency among duplicates) and CVSS. A small agreement study on the skill's own rubric would be needed.
- No empirical comparison exists of decision-grouped vs rule-grouped reports for a single reader.
- The optimal nit cap and report length are unmeasured; Bosu and Turzo show only that usefulness declines with volume.
- Is a solo developer's accept/reject a valid effective-false-positive signal? Karakaya et al. show labels reflect workflow pressure, and Google's 10% threshold was chosen "somewhat arbitrarily".
- Bavota et al. (JSS 2015) is still verified only through AlOmar's secondary description (the abstract is publisher-elided and ScienceDirect returns 403). Johnson et al. (ICSE 2013) and Imtiaz et al. (2019) were not accessed and are not used.
- Can rubric-driven, checklist-based severity assignment by an LLM agent reach human-level agreement? Untested.
- How often do line-hash fingerprints turn unchanged issues into spurious absent+new pairs after the pass's own refactors? Unmeasured.
- Runtime and equivalent-mutant noise of changed-lines mutation on small solo projects in TS, Python and Rust are unmeasured.
- Whether Sonar publishes any validation of its MQR severity assignments could not be confirmed.

## Dropped findings

No finding was dropped. The following sub-claims were removed or replaced within the surviving findings:
- **F01 / contradictions:** "Allodi's WEIS 2018 version said individual characteristics matter more than years or formal education." It is not in the EMSE paper and could not be verified, so it was removed.
- **F11, F12, F18:** SARIF misquotes were replaced with the spec text: `semanticVersion` is MAY, not SHOULD; `executionSuccessful`, `toolExecutionNotifications` and `baselineGuid` were misworded.
- **F12, F18:** the Semgrep "customize-ci-jobs" page no longer states the cross-file limitation; it was replaced by semgrep.dev/docs/semgrep-code/semgrep-pro-engine-intro.
- **F16:** the Cedrim 2.24%/2.66% figures were replaced by the FSE 2017 primary figures (9.7% / 33.3%).
- **F11:** "Sonar export" was removed from the applies-to list (SonarQube documents importing SARIF only).
