# Scope of a one-shot hardening pass on a finished project: whole-codebase cleanup versus 'leave cold code alone' (contradiction resolution)
> Code G101 · slug finished-project-scope · verified 2026-09-23 · counts: verified 8 / corrected 11 / downgraded 0 / dropped 0

Verification method: I opened every cited URL (WebFetch, or curl plus text extraction for PDFs and pages that did not render). PDFs were read locally with pdftotext: Sadowski et al. 2018, Kim et al. TSE 2014, Di Penta et al. 2020, Borg et al. 2026, Petrović et al. 2021, the SEC Knight order and the CodeScene whitepaper. I read the HN comments through the HN Firebase and Algolia APIs, and the StackExchange answers (scores, accepted flags) through the StackExchange API. Venues were checked on arXiv and Semantic Scholar where possible. The WebSearch budget ran out early in this session, so the venues of Petrović et al. and the Kim et al. FSE 2012 PDF were checked only through pages I could fetch directly.

Cross-cutting corrections applied throughout:
- **Google 2024 figures.** The "3.4x to 7.4x lower vulnerability density" for 5-year-old code is **derived from average vulnerability lifetimes**, not measured directly. 3.4x uses the USENIX 2022 FOSS lifetimes; 7.4x uses Android/Chromium lifetimes.
- **Survey vs fixit data.** The 74%-vs-21% "real problems" split comes from **Google's own survey** in Sadowski et al., which compares compile-time errors with patches to checked-in code. It does not come from the Ayewah & Pugh fixit. Sadowski cites Ayewah & Pugh only for the "survivor effect" explanation.
- **Google fix-all.** The whole-codebase fixes were split per project by Rosie, tested, and **reviewed by each owning team** before commit. Google's compiler-check criteria also require that checks "report issues affecting only correctness rather than style or best practices".
- **Stripe rubyfmt.** The post is dated **2026-04-28**; the event happened in 2024. The one-commit flip came **after a gradual per-file opt-in rollout** that started with systems the team owned.
- **Di Penta et al.** The odds ratio is **SZZ-based and associational**. In manual validation of 384 fix-inducing refactoring commits, the refactoring actually triggered the fix in only 38%. The venue is confirmed as ESEC/FSE 2020 (a full 12-page replication paper, pp. 556-567).
- **Borg et al. 2026.** Accepted at FORGE 2026, so this is no longer just a preprint. CodeScene's whitepaper claim of "defect risk rising by at least 60%" **cannot be reproduced** from the paper's reported relative risks, so it is removed as evidence.

## Summary

**RESOLUTION.** The contradiction is about **which change categories** may touch cold code, not **whether** to touch it.

A whole-codebase pass is supported for categories that meet two conditions: their value does not depend on future change, and a machine can verify the fix. These are:
- security findings
- dependency risk
- statically provable dead code
- tool-certified safe autofixes
- compiler-grade correctness checks, fixed everywhere and then made blocking

"Report, don't refactor" is supported for categories whose value only appears when code changes: structural refactoring, complexity reduction, deduplication, renames and polish.

The LLVM Developer Policy states the cold-code half almost verbatim: "Avoid committing formatting- or whitespace-only changes outside of code you plan to make subsequent changes to."

Google's SWE book gives the other half. Untested frozen code becomes a "haunted graveyard", and "the counter to this [is] good, ol'-fashioned testing". So cold code gets tests and a map, not a remodel.

**KEY DATA (verified)**

*Static analysis: batch vs change time*
- **Google FindBugs fixit (May 2009),** as described by Sadowski et al. (CACM 61(4), 2018):
  - 3,954 warnings were reviewed, but only 16% (640) were fixed, even though 44% (1,746) led to a bug report.
  - In Google's own separate developer survey, 74% of issues flagged at compile time were judged "real problems", versus 21% of issues in patches to checked-in code. For "critical", the split was 6% versus 0%.
  - Sadowski et al. explain the gap by the "survivor effect".
- **Infer at Facebook** (Distefano et al., CACM 62(8), 2019):
  - Batch mode had a fix rate "near zero": "We assigned 20-30 issues to developers, and almost none of them were acted on".
  - At diff time, "the fix rate rocketed to over 70%", with the same analysis and the same false-positive rate.
  - The batch figure rests on a small sample.
- **Google compiler-grade checks.** Google "programmatically fix[ed] all existing instances" across the whole codebase and then turned the check into a compile error. Each fix went through review by the owning team. Of surveyed recipients of these patches, 57% were happy, 41% neutral and 2% negative.

*Refactoring risk*
- **Di Penta, Bavota & Zampetti (ESEC/FSE 2020, 103 systems).**
  - A refactoring in a commit raises the odds that the commit is flagged as fix-inducing (SZZ) by e^0.83 = 2.29, controlling for lines added.
  - Manual validation found the refactoring actually caused the fix in 38% of 384 sampled commits.
  - Extract Method alone had an odds ratio of 0.86.

*Vulnerabilities and code age*
- Vulnerabilities live about 4 years on average: about 2 years for Chromium and about 7 for OpenSSL (Alexopoulos et al., USENIX Security 2022).
- Log4Shell's affected range starts at 2.0-beta9, released on Maven Central on 2013-09-14. The fixes were 2.15.0 (2021-12-09) and the 2.12.2 and 2.3.1 backports. The flaw was latent for about 8 years.
- Google (2024) derives from average lifetimes that 5-year-old code has 3.4x to 7.4x lower vulnerability density than new code. Their strategy is to leave existing code "mostly untouched except for bug fixes".
- Conclusion: fix security findings in cold code, but do not rewrite cold code.

*Dead code*
- **Knight Capital (SEC order, 2013).**
  - The Power Peg code had been unused since 2003 but "remained present and callable".
  - A 2005 change around it was never retested.
  - The 2012 release repurposed its flag, and a technician missed one of eight servers.
  - Result: "more than $460 million" lost in about 45 minutes.
- **Automated deletion at scale.** Google Sensenmann has deleted "nearly 5% of all C++ at Google", and Meta SCARF has deleted more than 100M lines in over 370,000 change requests. Meta admits that incorrect deletions "can make it to production".

*Corrections to seed leads*
- **Kim et al.** The TSE 2014 version says the top 5% most-refactored Windows 7 modules "decrease post-release defects by 7% less than the rest", so defect reduction "cannot be contributed to the refactoring changes alone". The FSE 2012 abstract claimed a "significant reduction". The "12.2%" figure from the seed was not found.
- **The T30 gap is confirmed.** No study comparing a one-shot end-of-project cleanup with continuous refactoring was found.

**DECISION TABLE**

The table is a synthesis. Each cell is argued from the findings below and is not directly measured by any source.

Actions:
- **A** = apply in the pass, as small commits that do not change behaviour (NFC)
- **B** = separate batch with explicit human approval and its own verification
- **R** = report or baseline only

Temperature (the 12-month window is a heuristic, not taken from a source):
- **HOT** = changed in the last 12 months, or on the declared future-work list
- **COLD** = neither
- **DORMANT** = present, but reachable only through a flag, config, env var, commented-out code or a disabled path

Default situation S0: finished repo, solo owner, little change expected. Each row gives HOT / COLD / DORMANT [evidence grade].

1. **Confirmed security finding** (vulnerability pattern, secret, injection): A / A (B if the fix changes external behaviour) / B, remove or fix [B]
2. **Compiler-grade correctness check** (tool-certified safe autofix, no effective false positives, correctness only): A / A, then make the rule a blocking error / A [B]
3. **Other static findings** (heuristic, style, "best practice"): A / R with baseline / R [B]
4. **Statically provable dead code** (unreachable statements, unused imports, unused locals and private symbols in statically resolved code; *not* unused parameters, *not* files that may be imported dynamically): A / A / A [B]
5. **Heuristically dead code** (dynamic dispatch, unused exports, unused files in projects with dynamic imports, usage-log evidence): B / B / B [B]
6. **Dormant-but-activatable code** (stale flags, disabled features, commented-out code): n/a / B / B. Remove the flag and its code together, and never repurpose a flag [B]
7. **Tool-certified safe formatting or autofix:** A / A (single-owner repo only) as one isolated commit, checked for AST equivalence and added to .git-blame-ignore-revs / A. In a shared repo, cold-code formatting is R (LLVM policy) [A for keeping it isolated; B for doing the whole repo]
8. **Dependencies:** patch or minor upgrades for known vulnerabilities, A everywhere. Removing unused deps, A. Major upgrades, B. Enable an update bot [B]
9. **Tests** (add-only characterization or regression tests): A / R (A if the module is a handover or agent target) / A if the code will be activated [C]
10. **Structural refactoring or complexity reduction:** A with tests / R / R [B]
11. **Deduplication:** B, only for clones that change together / R / R [C]
12. **Changes to error-handling semantics:** B / R (B if a swallowed error hides a security problem or data loss) / R [C]
13. **Naming, comments, readability:** A / R / R [A for the LLVM policy, C otherwise]

How each situation changes the default:
- **S1 Handover** (to other people or to future-you):
  - Comments, docs and README on cold code become A.
  - Tests on the modules the next maintainer will touch become A.
  - Deliver a ranked hotspot and complexity map instead of refactoring. [C]
- **S2 Open-sourcing:**
  - These become A everywhere: secret scan of the full git history, comment fitness, internal hostnames and paths, licences, and CI token permissions.
  - Rewriting history is B. [B]
- **S3 Before a security audit:**
  - These become A everywhere: all compiler warnings, static analysis, dead code, unused libraries, TODOs, and tests up to the target.
  - Then freeze: no row 10-13 changes after the freeze commit. [C]
- **S4 Maintenance mode:** S0, plus automated dependency updates and a CI gate are mandatory. Rows 10-13 are strictly R. [B]
- **S5 Prototype to product:**
  - The whole codebase is about to be HOT.
  - Rows 10-12 become B everywhere, tests come first, and the pending work goes in a TODO list, as in the kernel's drivers/staging. [C]
- **S6 Before an AI agent starts heavy feature work:**
  - Modules on the agent's target list become HOT: tests A, preparatory structural refactoring B.
  - If the targets are unknown, do tests, dead code and a report only, with no "just in case" refactoring. [C]

Conditions that flip a cell anywhere:
- **(i) Weak tests.** The touched region has no tests able to detect a change (no characterization tests, or mutants survive on the changed lines). A becomes B, and B becomes R, until such tests exist.
- **(ii) Dynamic references.** Dynamic language, reflection, or public library API: row 4 becomes row 5. Support: vulture and knip docs and Meta SCARF for dynamic references; CERT MSC12-EX3 for exported library API and #ifdef'd code only.
- **(iii) Shared repo.** The repo has external contributors or open branches: a whole-repo row 7 pass becomes R (LLVM Developer Policy and Coding Standards; netdev).
- **(iv) Observable behaviour.** The fix changes observable behaviour (exception type, validation strictness, output format, timing): B regardless (Hyrum's law; Ruff's RUF015 example).

**WHICH DOSSIER RULES THE TABLE OVERRIDES** (internal cross-references; the T-dossiers themselves were not re-verified here)
- **T02** ("new lines only; old warnings only for security or significant bugs"): overridden for rows 2, 4, 7 and 8.
  - Row 2: Google's Clang and Error Prone fix-all-then-gate practice.
  - Row 4: Sensenmann, SCARF and CWE-561.
  - Row 7: Stripe rubyfmt, single-owner condition only.
  - Row 8: OpenSSF Scorecard.
  - T02 is upheld for row 3.
- **T19-F08/F20** ("record stable complex code, don't refactor it; gate new code instead of running a campaign"): upheld for rows 10-11 in S0-S4. Overridden only in S5 and for S6 target modules, and always as B.
- **T30** ("don't polish cold code"): upheld for rows 10, 11 and 13, and reinforced by LLVM's "avoid ... formatting-only changes outside of code you plan to make subsequent changes to". Overridden for comments and docs in S1 and S2, and for DORMANT code, because dormant is not cold (Knight Capital).
- **T25/T18** ("baseline old findings, never big-bang"): upheld. "Whole-codebase" here means category-scoped batches that can each be reverted on their own. The only single large commit allowed is a formatter run verified by AST equivalence. Even Stripe's 62,213-file commit came after a gradual opt-in rollout.

**RECOMMENDED DEFAULT FOR A SOLO DEVELOPER'S FINISHED REPO**
1. Build the temperature map from git churn plus a declared list of future work.
2. Pin tool versions and configs, and record a per-rule baseline.
3. Run the batches in this order:
   1. secrets and security
   2. dependency vulnerabilities and unused deps
   3. provable dead code
   4. formatter and safe autofixes, as one commit
   5. compiler-grade checks: fix all, then gate
   6. approval batches: dormant code, heuristic dead code, behaviour-changing fixes
   7. tests on hot and target modules
   8. structural work, only on hot and target modules
4. Put everything else in a findings report and a baseline file.
5. Install CI gates so that new code has to meet the bar.

**MEASURES THAT RESIST GAMING**
- Per-rule counts before and after, with the same pinned config.
- Suppressions reported separately: any added suppression must be justified, and stale ones pruned.
- OSV known-vulnerability count and dependency count.
- Deleted lines of code split by evidence tier, plus any reverts after 30 and 90 days.
- Tests passing, plus AST or bytecode equivalence for mechanical commits.
- Mutation testing limited to touched lines, with the surviving mutants listed.
- An explicit list of behaviour-changing commits, kept separate from NFC commits.
- Bugs later traced back to commits from the pass.

Do not use aggregate "issues fixed", repo-wide coverage %, average complexity, or the agent's own "no functional change" claims. Borg et al. (FORGE 2026) found an agent's "zero functionality changes" statements "overconfident".

## Findings

### G101-F10 — Keep NFC and behaviour changes strictly separate
**Rule:** one logical change per commit. Style and format changes go in their own commit, and moved code is not modified in the commit that moves it. Tag every commit in the pass as NFC or BEHAVIOUR, and add mechanical whole-repo commits to .git-blame-ignore-revs.
- **Grade:** A · **Verdict:** VERIFIED. I added one supporting LLVM sentence and did not change the rule.
- **Rationale:**
  - Official policies of major projects require this, so that each change can be reviewed and history stays traceable.
  - It is what makes a whole-codebase pass reviewable and revertible, and it defines the unit for the measures in F17.
  - LLVM also restricts formatting-only commits to code "you plan to make subsequent changes to". That is the cold-code rule for formatting in shared repos.
- **Evidence:**
  - [Submitting patches](https://www.kernel.org/doc/html/latest/process/submitting-patches.html) — Linux kernel docs (7.3.0-rc4), 2026 — official_docs.
    - Quotes: "Separate each logical change into a separate patch."; when moving code "you should not modify the moved code at all in the same patch which moves it."; "If your code looks better with a violation then its probably best left alone."
    - Verification: all three sentences confirmed verbatim.
  - [LLVM Developer Policy](https://llvm.org/docs/DeveloperPolicy.html) — LLVM Project, 2026 — official_docs.
    - Quote: "Avoid committing formatting- or whitespace-only changes outside of code you plan to make subsequent changes to. Also, try to separate formatting or whitespace changes from functional changes ... the commit message should clearly state that the commit is not intended to change functionality, usually by stating it is NFC."
    - Verification: confirmed verbatim. I added the first sentence; it directly supports T30 for formatting.
  - [LLVM Coding Standards](https://llvm.org/docs/CodingStandards.html) — LLVM Project, 2026 — official_docs.
    - Quote: "we explicitly do not want patches that do large-scale reformatting of existing code." / "it is reasonable to rename the methods of a class if you're about to change it in some other way. Please commit such changes separately to make code review easier."
    - Verification: confirmed verbatim.
  - [Viewing and understanding files](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files) — GitHub Docs, 2026 — official_docs.
    - Data: the example .git-blame-ignore-revs lists "# Removed semi-colons from the entire codebase" and "# Converted all JavaScript to TypeScript". The command is `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
    - Verification: confirmed.
- **Detect:**
  - For each commit in the pass, `git show --stat` must touch one category.
  - A commit message without an NFC or BEHAVIOUR tag is a violation.
  - An NFC commit whose diff changes literals, conditions, exception types or public signatures is a violation.
  - .git-blame-ignore-revs must list the formatter commits.
- **Tools:** git, a commit-msg hook or commitlint, `git blame --ignore-revs-file`.
- **Applies to:** every batch in every situation.
- **When not to apply / counterpoints:**
  - LLVM's ban on large-scale reformatting targets shared repos with many contributors and open branches.
  - In a solo repo with no open branches, one verified formatter commit is acceptable (Stripe precedent, F03).
  - Fine-grained commits increase the number of reviews.
  - Grade A reflects consistent normative policy from major projects, not outcome data.
- **Fix risk:** low

### G101-F02 — Baseline heuristic findings in cold code
**Rule:** for COLD code, do not mass-fix heuristic or static-analysis findings. Record them in a pinned baseline (suppression file or report) and gate new code instead. Exceptions: confirmed security findings (F06), compiler-grade checks (F03), provable dead code (F04), dependency risk (F07).
- **Grade:** B · **Verdict:** VERIFIED (attribution of the survey numbers clarified).
- **Rationale:**
  - Developers judge warnings on code that has already passed testing and review as much less likely to be real (the survivor effect). This is a developer *perception* from a survey, not measured defect severity.
  - Batch reports on existing code are largely ignored, while the same findings shown at change time get fixed.
  - Tool vendors and the kernel's netdev policy both push quality work to the point of change.
- **Evidence:**
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski, Aftandilian, Eagle, Miller-Cushon, Jaspan, CACM 61(4), April 2018 — peer_reviewed.
    - Fixit quote: "They reviewed a total of 3,954 such warnings (42% of 9,473 total), but only 16% (640) were actually fixed, despite the fact that 44% of reviewed issues (1,746) resulted in a bug report being filed."
    - Survey quote: "survey participants deemed 74% of the issues flagged at compile time as 'real problems,' compared to 21% of those found in checked-in code ... 6% ... (vs. 0% in checked-in code) 'critical.' This result is explained by the 'survivor effect'."
    - Verification: read in the PDF. The fixit numbers describe Ayewah & Pugh ISSTA 2010, which is closed access and was not read. The 74/21 numbers come from Google's own survey of developers who hit a compiler error versus developers who received a patch for checked-in code.
  - [Scaling Static Analyses at Facebook](https://cacm.acm.org/magazines/2019/8/238344-scaling-static-analyses-at-facebook/fulltext) — Distefano, Fähndrich, Logozzo, O'Hearn, CACM 62(8), Aug 2019 — peer_reviewed.
    - Quotes: "the diff time deployment saw a 70% fix rate, where a more traditional 'offline' or 'batch' deployment ... saw a 0% fix rate." / "We assigned 20-30 issues to developers, and almost none of them were acted on." / at diff time "the fix rate rocketed to over 70%".
    - Verification: read through a Wayback copy fetched with curl. The batch figure comes from only 20-30 issues.
  - [About new code](https://docs.sonarsource.com/sonarqube-server/user-guide/about-new-code.md) — SonarSource, 2025 — official_docs.
    - Quote: "When you add new code to your projects, you usually touch a portion of the old code in the process. As a consequence, analyzing and cleaning new code allows you to fix issues in your old code and gradually improve the overall quality of your codebase."
    - Verification: confirmed verbatim.
  - [Netdev maintainer handbook](https://www.kernel.org/doc/html/latest/process/maintainer-netdev.html) — Linux kernel docs (7.3.0-rc4), 2026 — official_docs.
    - Quotes: "Netdev discourages patches which perform simple clean-ups, which are not in the context of other work" ... "the churn that such changes produce comes at a greater cost than the value of such clean-ups." / "spelling and grammar fixes are not discouraged."
    - Verification: confirmed. The examples it gives are checkpatch warnings, local variable ordering, and devm_ conversions.
  - [Bulk Suppressions](https://eslint.org/docs/latest/use/suppressions) — ESLint, 2025 — official_docs.
    - [v9.24.0 release notes](https://eslint.org/blog/2025/04/eslint-v9.24.0-released/) (2025-04-04): "This feature allows for enabling new lint rules as 'error' without fixing all violations upfront. While the rule will be enforced for new code, the existing violations will not be reported."
    - Verification: confirmed. Note that only rules set to "error" are suppressed.
- **Detect:**
  1. Run each analyzer with pinned versions over the whole repo.
  2. Split the findings by the F01 temperature.
  3. Write the cold-file findings to a baseline and to the report, grouped by rule id with counts. Baseline options: ESLint `--suppress-all` (writes eslint-suppressions.json; run with `--fix` first), `ruff check --add-noqa`, or the Sonar new-code period.
  4. CI then fails only on new violations.
- **Tools:** ESLint ≥9.24 bulk suppressions, Ruff `--add-noqa`, SonarQube new-code quality gate, Semgrep and CodeQL baselines.
- **Applies to:** S0, S1 and S4 for cold code. Hot code gets its findings fixed in the pass.
- **When not to apply / counterpoints:**
  - The fix-rate data measures human attention in large organisations: context switching and missing ownership.
  - In a dedicated solo or agent pass, the pass itself is the task, so that argument weakens. The survivor-effect gap in perceived value still holds.
  - In S3 (pre-audit), auditors ask for all warnings to be resolved (F11), which flips this rule for compiler warnings.
- **Fix risk:** low

### G101-F03 — Fix-all-then-gate for correctness checks with safe autofixes
**Rule:** when a check meets both conditions below, apply it to the WHOLE codebase (all temperatures) in one isolated batch, verify, then make the rule a blocking error so it never regresses:
- it is correctness-only with no effective false positives;
- it has a tool-certified, behaviour-preserving autofix.

Only fixes the tool labels "safe" qualify. Fixes a tool labels unsafe, or suggestion-only, go to an approval batch.
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - The Ruff quotes now use the page's exact wording.
  - The Google practice included owner review per project and a correctness-only criterion.
  - The Stripe post is dated 2026, the rollout was preceded by gradual opt-in, and "single commit" is now "one merged diff".
  - Added ESLint's author guidance on fixes.
- **Rationale:**
  - This is the one documented case where industry deliberately runs a whole-codebase cleanup and gets a good reception.
  - Google's Clang and Error Prone teams fixed every existing instance, had each project's owners review the split changes, then turned the diagnostic into a compile error.
  - The enabling conditions are three: fixes that apply mechanically, no effective false positives, and correctness rather than style. Together they make triage cheap.
- **Evidence:**
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski et al., CACM, 2018 — peer_reviewed.
    - Quotes: The Clang team would "programmatically fix all existing instances of a problem in the codebase. Once the codebase was cleansed of an issue, the Clang team enabled the new diagnostic as a compiler error". Rosie is used "to split the largescale change into small changes that each affect a single project, test those changes, and send them for code review to the appropriate team." "57% ... were happy to have received it, and 41% were neutral. Only 2% responded negatively, saying, 'It just created busywork for me.'"
    - Criteria: a compiler check should "produce no effective false positives" and "report issues affecting only correctness rather than style or best practices."
    - Verification: all confirmed in the PDF.
  - [Ruff linter: Fix safety](https://docs.astral.sh/ruff/linter/) — Astral, 2026 — official_docs.
    - Quote: "an unsafe fix could lead to a change in runtime behavior, the removal of comments, or both, while safe fixes are intended to preserve runtime behavior".
    - RUF015 example: "when the collection is empty, this raised exception changes from an IndexError to StopIteration ... Since the change in exception type could break error handling upstream, this fix is categorized as unsafe. Ruff only enables safe fixes by default."
    - Verification: corrected to the exact wording. Safe fixes are "intended to" preserve behaviour, which is a claim, not a guarantee.
  - [Custom Rules: fixes and suggestions](https://eslint.org/docs/latest/extend/custom-rules) — ESLint, 2026 — official_docs.
    - Quote: "Avoid any fixes that could change the runtime behavior of code and cause it to stop working." Suggestions are used "if a fix potentially changes functionality".
    - Verification: added. This is guidance to rule authors, so third-party plugins may not follow it.
  - [Formatting an entire 25-million-line codebase overnight: the rubyfmt story](https://stripe.dev/blog/formatting-an-entire-25-million-line-codebase-overnight-the-rubyfmt-story) — Fable Tales & Anna Mason, Stripe, 2026-04-28 (the rollout was in 2024) — engineering_blog.
    - Data:
      - 62,213 files and 25M lines were formatted on "that Saturday morning in 2024"; "We chose a Saturday to format the entire codebase to avoid merge conflicts".
      - First they "built in a per-file opt-in ... started with systems we owned and could observe closely, then expanded coverage gradually".
      - Validation: "a tool to diff `ripper` trees across formatted files", plus the test suite.
      - Files the formatter couldn't handle were "held back", then "we burned down the remaining exceptions".
    - Verification: confirmed. Year and rollout history corrected.
- **Detect:** a rule qualifies only if all three hold:
  - (a) The tool marks its fix safe. For Ruff, the fix is applied without `--unsafe-fixes`. For ESLint, the rule is fixable through `fix`, not `suggest`.
  - (b) A manual sample of the hits shows zero effective false positives. The sample size is a reviewer heuristic, e.g. ≥20 hits; no source sets it.
  - (c) The mechanical changes pass an AST or bytecode equivalence diff plus the full test suite.

  After applying, set the rule to error in CI.
- **Tools:** `ruff check --fix` (safe only), `eslint --fix`, `clang-tidy --fix`, formatters (prettier, black, gofmt, rustfmt, rubyfmt), AST diff scripts.
- **Applies to:** all situations and all temperatures in a single-owner repo. Strongest for S2, S3 and S4.
- **When not to apply / counterpoints:**
  - In shared projects, LLVM and netdev reject large-scale reformatting because of churn (F10). LLVM even limits formatting-only commits to code you are about to change.
  - Stripe's success depended on a custom equivalence checker, a gradual opt-in phase and weekend timing.
  - "Safe" labels are tool claims: RUF015 shows that a fix that looks semantically neutral can change exception behaviour.
  - Google's version still had each owning team review its fixes.
- **Fix risk:** low

### G101-F06 — Fix confirmed security findings everywhere, rewrite nothing
**Rule:** apply confirmed security findings to cold code as well as hot code: known-vulnerable patterns, injection, secrets, unsafe deserialization, authz gaps.
- Do NOT justify rewrites or broad restructuring of old code on security grounds.
- Low-confidence security pattern hits in old, well-exercised code go to the report.
- Fixes that tighten behaviour (stricter validation, changed error responses) go in an approval batch.
- **Grade:** B · **Verdict:** CORRECTED. The Log4j fixed versions now include the backports, and the Google density ratios are marked as derived from lifetimes.
- **Rationale:**
  - Vulnerabilities often sit in stable code for years, so "cold" is not "safe".
  - Estimated vulnerability density falls with code age, so returns on rewriting old code shrink.
  - The resolution: targeted fixes everywhere, rewrites nowhere.
- **Evidence:**
  - [How Long Do Vulnerabilities Live in the Code?](https://www.usenix.org/conference/usenixsecurity22/presentation/alexopoulos) — Alexopoulos, Brack, Wagner, Grube, Mühlhäuser (TU Darmstadt), USENIX Security 2022 — peer_reviewed.
    - Quote: "the average lifetime of a vulnerability is around 4 years, varying significantly between projects (~2 years for Chromium, ~7 years for OpenSSL)"; lifetimes are "approximately described by an exponential distribution".
    - Verification: confirmed on the abstract page.
  - [Eliminating Memory Safety Vulnerabilities at the Source](https://security.googleblog.com/2024/09/eliminating-memory-safety-vulnerabilities-Android.html) — Jeff Vander Stoep & Alex Rebert, Google Security Blog, 2024-09-25 — engineering_blog.
    - Quotes: "Code matures and gets safer with time, exponentially, making the returns on investments like rewrites diminish over time as code gets older." / "leaving existing code mostly untouched except for bug fixes" / "based on the average vulnerability lifetimes, 5-year-old code has a 3.4x (using lifetimes from the study) to 7.4x (using lifetimes observed in Android and Chromium) lower vulnerability density than new code."
    - Verification: confirmed from the raw HTML. The ratios are derived from lifetimes, not measured densities.
  - [Log4j security vulnerabilities](https://logging.apache.org/log4j/2.x/security.html) — Apache Logging Services, 2026 — official_docs.
    - Data for CVE-2021-44228: affected `[2.0-beta9, 2.3.1) ∪ [2.4, 2.12.2) ∪ [2.13.0, 2.15.0)`; fixed in 2.15.0 (Java 8), 2.12.2 (Java 7) and 2.3.1 (Java 6).
    - Maven Central API timestamps: log4j-core 2.0-beta9 on 2013-09-14, 2.15.0 on 2021-12-09, so about 8 years latent.
    - Verification: confirmed. Backport versions added.
- **Detect:**
  - Full-repo SAST with pinned rulesets (Semgrep, CodeQL).
  - Secret scan of the working tree AND the full git history.
  - OSV audit for dependencies (F07).
  - Triage each finding as confirmed (reachable from an input) or pattern-only.
  - Confirmed findings get A (B if the fix changes external behaviour). Pattern-only findings in cold code get R.
- **Tools:** Semgrep, CodeQL, gitleaks or trufflehog (history secret scan), osv-scanner.
- **Applies to:** all situations and temperatures. S2 and S3 widen the scope to the full history and all warnings.
- **When not to apply / counterpoints:**
  - Google's ratios come from lifetimes in heavily exercised or large FOSS code (Android, Chromium, the USENIX study's projects).
  - A finished solo project with few users does not "mature" through exposure in the same way, so age alone should not lower priority there. This is an inference.
  - Security fixes can break callers that depend on lax behaviour (Hyrum's law), hence the approval batch.
- **Fix risk:** medium

### G101-F08 — Structural refactoring only for hot code
**Rule:** structural refactoring and complexity reduction are for HOT code only (with tests), plus cold code that is about to become hot (S5, S6 targets, as approval batches). For COLD code, record complexity and structure findings in the report and leave the code alone.
- **Grade:** B · **Verdict:** CORRECTED. Changes: (audit correction: the Di Penta paper is a full 12-page paper, pp. 556-567 per Crossref, not a "3-page" replication; all numbers stand.)
  - The Di Penta result is reworded as an SZZ-based association, and the 38%/62% manual validation and the Extract Method odds ratio are added.
  - The Di Penta venue is confirmed as ESEC/FSE 2020 (Proceedings of the 28th ACM ESEC/FSE, published 2020-11-08, pp. 556-567).
  - Added Kim's "57% driven by immediate concrete needs".
- **Rationale:**
  - Commits containing refactorings are associated with higher odds of being flagged as fix-inducing. Manual validation shows the refactoring really caused the fix in about 4 of 10 flagged cases.
  - At Microsoft, 76% of surveyed developers see regression risk in refactoring. A multi-year Windows 7 refactoring campaign did reduce dependencies, but the defect reduction could not be attributed to the refactoring.
  - Developers themselves mostly refactor for immediate needs. The payoff of structural work comes when the code changes again.
- **Evidence:**
  - [An Empirical Study of Refactoring Challenges and Benefits at Microsoft](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/kim-tse-2014.pdf) — Miryung Kim, Thomas Zimmermann, Nachiappan Nagappan, IEEE TSE 40(7), 2014 — peer_reviewed.
    - Quotes: "76% of the participants consider that refactoring comes with a risk of introducing subtle bugs and functionality regression"; "The top 5% of preferentially refactored modules decrease post-release defects by 7% less than the rest, indicating that defect reduction cannot be contributed to the refactoring changes alone"; dependencies change by a factor of 0.85 versus 1.10.
    - Added: "57% of the responses indicate that refactoring is driven by immediate concrete, visible needs of changes that they must implement in a short term".
    - Verification: all confirmed in the PDF.
  - [On the Relationship between Refactoring Actions and Bugs: A Differentiated Replication](https://arxiv.org/abs/2009.11685) — Di Penta, Bavota, Zampetti, ESEC/FSE 2020 (DOI 10.1145/3368089.3409695; pp. 556-567, a 12-page paper) — peer_reviewed.
    - Quote: "the presence of a refactoring increases by e^0.83 = 2.29 times the odds that a commit induces a fix".
    - Data:
      - 103 systems and 562,676 observations.
      - Manual validation of 384 commits: the refactoring was responsible in 147 (38%) and unrelated in 62%.
      - Extract Method has an odds ratio of 0.86.
    - Verification: confirmed in the PDF. The venue was confirmed through Semantic Scholar metadata.
  - [Refactoring – Not on the backlog!](https://ronjeffries.com/xprog/articles/refactoring-not-on-the-backlog/) — Ron Jeffries, 2014-07-30 — engineering_blog.
    - Quotes: "A big refactoring session is hard to sell, and if sold, it returns less than we hoped, after a long delay." / "We improve the code where we work, and ignore the code where we don't have to work."
    - Verification: confirmed.
  - [Code Red: The Business Impact of Code Quality](https://arxiv.org/abs/2203.04374) — Adam Tornhill & Markus Borg, TechDebt 2022, pp. 11-20 — peer_reviewed.
    - Data: 39 proprietary codebases and 30,737 files. "low quality code contains 15 times more defects than high quality code"; issue resolution takes "on average 124% more time".
    - Verification: confirmed. The authors are affiliated with CodeScene, the vendor of the metric used.
- **Detect:** compute complexity per function (lizard, radon, ESLint complexity or sonarjs cognitive-complexity, gocyclo), then intersect with the F01 hot list. Only the intersection is eligible. Everything else becomes a ranked report row: file, function, metric, churn.
- **Tools:** lizard, radon, ESLint complexity / eslint-plugin-sonarjs, gocyclo, CodeScene.
- **Applies to:** S0-S4 hot only. S5 and S6 targets as approval batches.
- **When not to apply / counterpoints:**
  - Fowler accepts "setting aside a day or two to attack a gnarly lump of code" — but code "that's been getting in everyone's way for a few months", i.e. hot code.
  - The Windows campaign did reach its structural goal.
  - The FSE 2012 abstract of Kim et al. reported a "significant reduction ... in post-release defects", which contradicts the TSE 2014 reanalysis.
  - Handover readers (S1) pay a comprehension cost even without changing the code.
  - Simple Extract Method is not associated with more fixes (odds ratio 0.86).
- **Fix risk:** high

### G101-F04 — Delete provable dead code, batch heuristic dead code
**Rule:**
- Delete statically provable dead code everywhere: unreachable statements, unused imports, unused locals, and unused private or module-local symbols in statically resolved code.
- Handle heuristically dead code as an approval batch: unused public exports, unused files where dynamic imports exist, functions in dynamic languages, unused parameters, and code judged dead from usage logs.
- Never delete exported library API without a deprecation decision.
- **Grade:** B · **Verdict:** CORRECTED. The tier-1 detection overclaimed:
  - Vulture's 100% tier includes unused *arguments*, and deleting those changes signatures and interface or callback contracts.
  - Knip's "unused files" can be false positives from dynamic imports, which Knip's own guide says.
  - ts-prune reports "potentially unused exports".

  All three move to tier 2.
- **Rationale:**
  - Dead code keeps costing even when no one edits it: tests keep running, migrations keep updating it, readers and agents keep loading it.
  - Google and Meta run automated deletion at scale. Tool confidence drops sharply for dynamic references, and Meta reports wrong deletions reaching production, so the strength of the evidence must decide the action.
- **Evidence:**
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Phil Norman, Google Testing Blog, 2023-04-28 — engineering_blog.
    - Quotes: "It submits over 1000 deletion changelists per week, and has so far deleted nearly 5% of all C++ at Google." / "while this dead code sits around undeleted, it's still incurring a cost: the automated testing system doesn't know it should stop running dead tests" / "it's important to have a blocklisting system so that exceptions can be marked".
    - Liveness comes from binary run logs; the example is a binary "last used over a year ago".
    - Verification: confirmed from the raw HTML.
  - [Automating dead code cleanup](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) — Will Shackleton, Andy Pincombe, Katriel Cohn-Gordon, Meta, 2023-10-24 — engineering_blog.
    - Quotes: "automatically deleted more than 100 million lines of code in over 370,000 change requests." / "misunderstood dynamic references can lead to incorrect deletion of code, and these deletions can make it to production."
    - Verification: confirmed.
  - [CWE-561: Dead Code](https://cwe.mitre.org/data/definitions/561.html) — MITRE, CWE 4.20 — standard.
    - Quote: "Remove dead code before deploying the application."
    - Verification: confirmed. The entry is active.
  - [MSC12-C](https://cmu-sei.github.io/secure-coding-standards/sei-cert-c-coding-standard/recommendations/miscellaneous-msc/msc12-c) — SEI CERT C Coding Standard — standard.
    - Quote: "Code that has no effect or is never executed (that is, dead or unreachable code) is typically the result of a coding error and can cause unexpected behavior."
    - Exceptions: EX1 allows a defensive default label; EX2 allows temporarily removed code with explanatory comments; EX3 allows unused functions of exported libraries and #ifdef'd code.
    - Verification: confirmed.
  - [Vulture README](https://github.com/jendrikseipp/vulture) — Jendrik Seipp — official_docs.
    - Data: 100% confidence for "function/method/class argument, unreachable code"; 90% for imports; 60% for attributes, classes, functions, methods, properties and variables. "code that is only called implicitly may be reported as unused."
    - Verification: confirmed. The repo is not archived.
  - [Knip: Handling issues](https://knip.dev/guides/handling-issues) — Knip — official_docs.
    - Data: fix order is unused files, then unresolved imports, then unused exports, then unused dependencies, because "Findings come in chains". Dynamic import specifiers are a false-positive cause for unused files. "Hiding a result is not the same as resolving it."
    - Verification: confirmed.
- **Detect:**
  - **Tier 1, apply:**
    - compiler or linter unreachable-code, unused-import and unused-local diagnostics (e.g. tsc `noUnusedLocals`, Go vet/staticcheck, the rustc `dead_code` lint);
    - `vulture --min-confidence 100`, *excluding unused-argument items*;
    - Knip unused files only when the project has no dynamic import specifiers and entry points are configured.
  - **Tier 2, approval batch:**
    - vulture 60% items, unused arguments;
    - Knip and ts-prune unused exports;
    - symbols referenced only by string, reflection, DI containers, serializers, plugin registries, CLI entry points, or cron and job configs.
  - Before deleting any tier-2 symbol, grep the whole repo, including configs and templates, for its name as a string. Delete the symbol's tests in the same commit.
- **Tools:** vulture, knip, ts-prune, tsc `noUnusedLocals`, staticcheck, cargo `dead_code` lint, IDE find-usages.
- **Applies to:** all temperatures and situations. Tier 1 is A, tier 2 is B, library public API is R.
- **When not to apply / counterpoints:**
  - Chesterton's fence (HN dissent on the Knight thread): code that looks dead may be reachable dynamically.
  - SCARF admits incorrect deletions reached production.
  - CERT allows documented, temporarily removed code.
  - Code run only where no logs exist needs a blocklist (Sensenmann).
- **Fix risk:** medium

### G101-F05 — Dormant-but-activatable code is its own category
**Rule:** treat DORMANT-BUT-ACTIVATABLE code as its own category, never as "cold". This covers stale feature flags, disabled features, config-reachable legacy paths and commented-out code.
- Remove the flag and the code it guards together, in a separate approval batch, after checking the flag's value in every environment.
- Never repurpose an existing flag, config key or enum value for new behaviour.
- **Grade:** B · **Verdict:** VERIFIED. I added context from the SEC order and did not change the rule.
- **Rationale:**
  - Dormant code is untested, and a config change can switch it on, so it carries the most activation risk.
  - At Knight Capital, Power Peg had been unused since 2003 but was left "present and callable". A 2005 change around it was never retested. In 2012 its flag was repurposed, and a manual deployment missed one of eight servers, which reactivated it: more than $460M lost in about 45 minutes.
  - Feature-flag guidance treats flags as inventory with a carrying cost.
- **Evidence:**
  - [SEC Administrative Proceeding File No. 3-15570, Release No. 70694](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 2013-10-16 — incident_report.
    - Quotes:
      - "Despite the lack of use, the Power Peg functionality remained present and callable at the time of the RLP deployment. The new RLP code also repurposed a flag that was formerly used to activate the Power Peg code."
      - "Knight did not retest the Power Peg code after moving the cumulative quantity function"
      - "one of Knight's technicians did not copy the new code to one of the eight SMARS computer servers"
      - "more than $460 million"; "approximately forty-five minutes".
    - The order also says Knight "intended to delete the Power Peg code".
    - Verification: confirmed in the PDF.
  - [Feature Toggles (aka Feature Flags)](https://martinfowler.com/articles/feature-toggles.html) — Pete Hodgson, martinfowler.com, 2017-10-09 — engineering_blog.
    - Quote: "Savvy teams view the Feature Toggles in their codebase as inventory which comes with a carrying cost and seek to keep that inventory as low as possible." Some teams create "'time bombs' which will fail a test (or even refuse to start an application!) if a feature flag is still around after its expiration date".
    - Verification: confirmed. The article cites Knight Capital's "$460 million dollar mistake".
- **Detect:**
  1. List every flag, config or env read and its value in each environment config. A flag that is constant everywhere means the branches on one side are dead. A stale flag means removal.
  2. Find commented-out code blocks, with Sonar's commented-out-code rule (rule id not verified here) or a script that parses runs of consecutive comment lines as code.
  3. Find routes, jobs, handlers or CLI subcommands that are defined but never registered.
  4. Look for enum values or flag bits whose only users are removed features.
- **Tools:** ripgrep, SonarQube's commented-out-code rule, stale-flag reports from feature-flag platforms, `git log -S` for flag names.
- **Applies to:** all situations. Mandatory in S2, because open-sourcing exposes dormant endpoints, and in S6, because agents may re-enable dormant paths.
- **When not to apply / counterpoints:**
  - Some dormant code is intentional: kill switches, disaster-recovery paths, platform-specific branches (CERT MSC12-EX3 for #ifdef). Keep those, but document them and add a test that exercises them.
  - CERT MSC12-EX2 tolerates commented-out code with an explanation, while the accepted SE answer (Q103031) says to rely on version control.
  - Knight's failure also needed a deployment error. Removing the code in 2003 would have prevented it, but so would a clean deploy. The rule is about removing a latent hazard, not claiming single causation.
- **Fix risk:** high

### G101-F07 — Dependency hygiene applies at every temperature
**Rule:** dependency hygiene applies to every temperature, because dependency risk grows with calendar time, not with code change. In the pass:
- patch or minor upgrades for known-vulnerable dependencies (A);
- removal of unused dependencies (A, after build and tests);
- pinning build and CI dependencies (A);
- enabling an update bot for maintenance mode (A).

Major-version upgrades go in separate approval batches, one dependency per batch.
- **Grade:** B · **Verdict:** CORRECTED. The osv-scanner command is updated to the v2 syntax, and the Ochoa et al. venue is confirmed.
- **Rationale:**
  - Unchanged code still becomes vulnerable as advisories accumulate.
  - Supply-chain scorecards treat unfixed known vulnerabilities and missing update tooling as high risk.
  - Non-major upgrades mostly respect semver, but not always, so upgrades need tests and isolation.
- **Evidence:**
  - [Log4j Vulnerability Resource Center](https://www.sonatype.com/resources/log4j-vulnerability-resource-center) — Sonatype — industry_report.
    - Quote: "Downloads of vulnerable versions of Log4J still greater than 10% nearly three years after fixes were available."
    - Verification: confirmed. The page gives no measurement date.
  - [OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — OpenSSF, 2026 — official_docs.
    - Data:
      - Vulnerabilities: Risk High, "open, unfixed vulnerabilities in its own codebase or its dependencies using the OSV ... service".
      - Dependency-Update-Tool: High (Dependabot or Renovate).
      - Pinned-Dependencies: Medium. Maintained: High.
    - Verification: confirmed from the raw checks.md.
  - [Breaking Bad? Semantic Versioning and Impact of Breaking Changes in Maven Central](https://arxiv.org/abs/2110.07889) — Ochoa, Degueule, Falleri, Vinju, Empirical Software Engineering 27 (DOI 10.1007/s10664-021-10052-y) — peer_reviewed.
    - Data: 119,879 upgrades and 293,817 clients. "83.4% of these upgrades do comply with semantic versioning"; "only 7.9% of all clients are affected by BCs".
    - Verification: confirmed. The venue comes from Semantic Scholar metadata.
  - [How to prepare for a security audit](https://blog.trailofbits.com/2018/04/06/how-to-prepare-for-a-security-audit/) — Garret Reece, Trail of Bits, 2018-04-06 — engineering_blog.
    - Quote: "Remove dead code, stale branches, unused libraries, and other extraneous weight."
    - Verification: confirmed.
- **Detect:**
  - Known vulnerabilities: `osv-scanner scan source -r .` (v2 syntax), or `pnpm audit` / `npm audit` / `pip-audit` / `cargo audit`.
  - Unused or undeclared dependencies: knip (JS/TS) or deptry (Python).
  - `scorecard --repo=...` for Pinned-Dependencies and Dependency-Update-Tool.
  - Check CI files for unpinned actions and images.
- **Tools:** osv-scanner, pnpm/npm audit, pip-audit, cargo audit, knip, deptry, OpenSSF Scorecard, Dependabot or Renovate.
- **Applies to:** all situations. Mandatory setup in S4 (maintenance mode) and S2 (open-sourcing).
- **When not to apply / counterpoints:**
  - 7.9% of clients affected by breaking changes is small but not zero, and transitive upgrades can change runtime behaviour, so upgrades need the test gate (F19).
  - For a truly frozen artefact that is never redeployed, a lockfile refresh may be pointless. Report the risks instead.
- **Fix risk:** medium

### G101-F12 — Open-sourcing: exposure hygiene across the whole history
**Rule:** open-sourcing (S2). The part that must be whole-codebase, and whole-HISTORY, is exposure hygiene, not refactoring. That covers:
- secrets across all commits;
- comments unfit for the public;
- internal hostnames, paths, names and emails;
- third-party code and licences;
- binary artefacts;
- CI workflow permissions.

Structural cleanup stays under the default table.
- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:**
  - Release guidance from a major open-source publisher focuses on what the code discloses and on licensing, not on code quality.
  - Supply-chain scorecards add CI and binary checks.
  - None of this depends on code temperature: an old commit leaks as easily as a new one.
- **Evidence:**
  - [Preparing for release](https://opensource.google/documentation/reference/releasing/preparing) — Google Open Source, 2026 — official_docs.
    - Quote: "Please be very careful when releasing code — read all the comments to ensure they're fit for public viewing and ensure the code has no security implications for Google that haven't been reviewed by the security team." / "Every directory inside third_party (or 'vendor', etc.) needs to have a LICENSE file that includes the full license text and copyright notice for the library."
    - The page also gives scrubbing patterns for internal domains, internal paths and IP addresses.
    - Verification: confirmed.
  - [OpenSSF Scorecard checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md) — OpenSSF, 2026 — official_docs.
    - Data: Dangerous-Workflow is Critical; Token-Permissions is High; Binary-Artifacts is High ("generated executable (binary) artifacts in the source repository").
    - Verification: confirmed.
- **Detect:**
  - Secret scan of the full history (gitleaks, or trufflehog in git mode).
  - `grep -rniE "(internal|corp|localhost:|10\.|192\.168\.|@yourcompany)"` over code and comments.
  - Licence scan (scancode, licensee).
  - `scorecard` on the repo, and a review of .github/workflows permissions.
  - Any history rewrite (filter-repo) is destructive and needs explicit approval.
- **Tools:** gitleaks, trufflehog, git filter-repo (approval only), OpenSSF Scorecard, licence scanners.
- **Applies to:** S2. Also S1 when handing over to an external party.
- **When not to apply / counterpoints:**
  - The Google guidance is written for Google-owned projects.
  - Secret scanners produce false positives.
  - Rewriting history breaks existing clones and signatures, so rotating the credential is usually better than rewriting.
- **Fix risk:** medium

### G101-F18 — Small, revertible, automated batches
**Rule:** execute any whole-codebase category as small, independent, individually revertible batches, produced by automation where possible, each fully tested. Finish each category before starting the next. Build cleanup scripts so that a wrong input cannot widen their scope: typed identifiers, a dry run, confirmation of the object type.
- **Grade:** B · **Verdict:** VERIFIED. I noted that Atlassian is an analogy from operations, not a codebase incident.
- **Rationale:**
  - Google's large-scale-change practice shards changes so that each can be rolled back cheaply.
  - Unfinished migrations are debt of their own.
  - Failed cleanup operations fail at scale. Atlassian's deletion of a legacy app wiped 883 sites because the script was given site IDs instead of app IDs.
- **Evidence:**
  - [Software Engineering at Google, Ch. 22: Large-Scale Changes](https://abseil.io/resources/swe-book/html/ch22.html) — written by Hyrum Wright, edited by Lisa Carey (book eds. Winters, Manshreck, Wright), O'Reilly 2020 — book (free official HTML).
    - Quotes: "we've found it useful to treat specific changes as cattle: nameless and faceless commits that might be rolled back or otherwise rejected at any given time with little cost" / "LSCs really work only when the bulk of the effort for them can be done by computers, not humans".
    - Verification: confirmed.
  - [Post-Incident Review on the Atlassian April 2022 outage](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage) — Atlassian, 2022 — incident_report.
    - Quotes: "Instead of providing the IDs of the intended app being marked for deletion, the team provided the IDs of the entire cloud site"; the API "assumes the input is correct"; "883 sites (representing 775 customers)"; the outage lasted "up to 14 days" for a subset.
    - Verification: confirmed. It was a data-deletion script, not a code change.
  - [Lessons from Building Static Analysis Tools at Google](https://storage.googleapis.com/gweb-research2023-media/pubtools/4365.pdf) — Sadowski et al., 2018 — peer_reviewed.
    - Quote: Rosie is used "to split the largescale change into small changes that each affect a single project, test those changes, and send them for code review to the appropriate team."
    - Verification: confirmed.
  - [Migrating millions of lines of code to TypeScript](https://stripe.dev/blog/migrating-to-typescript) — Andrew Lunny, Stripe, 2022-05-20 — engineering_blog.
    - Counter-example: "In a single pull request, we converted more than 3.7 million lines of code." The reason given: "An incremental migration to TypeScript would force developers to work in both languages". It was validated with CI, deployment to QA and manual tests.
    - Verification: confirmed.
- **Detect:**
  - Each batch covers at most one category and one module group.
  - Each batch reverts cleanly: `git revert --no-commit <sha>` applies on HEAD without conflicts.
  - Every batch has a green CI run.
  - Cleanup scripts support `--dry-run` and print the object type and count before acting.
  - After each migration category, check for leftover uses of the old API.
- **Tools:** git, CI, codemod frameworks (jscodeshift, LibCST, OpenRewrite, Comby).
- **Applies to:** all whole-codebase categories in every situation.
- **When not to apply / counterpoints:**
  - Stripe shows that a single atomic mechanical change can be the right call when half-migrated states are costly and the transformation is automated and validated.
  - The table allows this only for tool-verified mechanical changes.
- **Fix risk:** low

### G101-F17 — Measures that resist gaming
**Rule:** show that the pass helped with measures that resist gaming:
1. Per-rule finding counts before and after, using the SAME pinned tool versions and configs. Count suppressions and baseline entries separately: new suppressions must be zero or justified one by one, and stale ones pruned.
2. Behaviour-preservation evidence per batch: tests pass, AST or bytecode equivalence for mechanical commits, and mutation testing limited to touched lines with the surviving mutants listed.
3. An explicit list of behaviour-changing commits.
4. Deleted lines of code by evidence tier, and reverts after 30 and 90 days.
5. Known-vulnerability and dependency counts.

Do not report aggregate "issues fixed", repo-wide coverage %, average complexity, or agent self-assessments.
- **Grade:** B · **Verdict:** CORRECTED. Changes:
  - The Petrović et al. venue is unconfirmed (arXiv: "submitted to the IEEE"), so it is relabelled a preprint.
  - The PIT diff-scoped option is corrected to Arcmutate's git integration; `scmMutationCoverage` was not found in the current PIT docs.
  - Stryker `--incremental` is described correctly: it compares against the previous run, not a git diff.
- **Rationale:**
  - Single metrics mislead; Kim et al. conclude that refactoring impact needs multidimensional assessment.
  - Suppressing findings looks like fixing them unless suppressions are counted.
  - Coverage does not show whether tests would detect a change in the touched code. Diff-scoped mutation testing does, and Google made it practical by mutating only changed code.
  - The specific list of measures is a synthesis; no source tested it as a set.
- **Evidence:**
  - [Practical Mutation Testing at Scale: A view from Google](https://arxiv.org/abs/2102.11378) — Petrović, Ivanković, Fraser, Just, 2021 — preprint (arXiv comment: "submitted to the IEEE"; final venue not confirmed here).
    - Quotes: "Mutation testing is done incrementally, mutating only changed code during code review, rather than the entire code base"; "developers at Google initially classified 85% of reported mutants as unproductive"; heuristics "improved the ratio of productive mutants from 15% to 89%"; reported mutants are limited to "at most 7 times the number of total files in the changelist".
    - Verification: confirmed in the PDF.
  - [ESLint Bulk Suppressions](https://eslint.org/docs/latest/use/suppressions) — ESLint, 2025 — official_docs.
    - Data: suppressions live in eslint-suppressions.json. Fixed violations surface as unused suppressions, and ESLint "exits with a non-zero exit code". `--prune-suppressions` removes them.
    - Verification: confirmed.
  - [An Empirical Study of Refactoring Challenges and Benefits at Microsoft](https://www.microsoft.com/en-us/research/publication/an-empirical-study-of-refactoring-challenges-and-benefits-at-microsoft/) — Kim, Zimmermann, Nagappan, IEEE TSE 40(7), 2014 — peer_reviewed.
    - Quotes: "measuring the impact of refactoring requires multidimensional assessment"; a developer quote from the PDF: "The value of refactoring is difficult to measure."
    - Verification: confirmed.
  - [Code Coverage at Google](https://research.google/pubs/code-coverage-at-google/) — Ivanković, Petrović, Just, Fraser, ESEC/FSE 2019 — peer_reviewed.
    - Data: coverage is applied "at the level of changesets and code review"; 512 survey responses from 3,000 developers.
    - Verification: confirmed on the abstract page.
  - Tool docs checked for diff-scoped mutation:
    - [cargo-mutants --in-diff](https://mutants.rs/in-diff.html): "tests only mutants that overlap with regions changed in the diff".
    - [StrykerJS incremental mode](https://stryker-mutator.io/docs/stryker-js/incremental/) (since 6.2): "track[s] the changes you make ... and only runs mutation testing on the changed code". It compares against the previous run's report.
    - [PIT](https://pitest.org/quickstart/maven/): diff-scoping is through Arcmutate's `+GIT(from[HEAD~1])` feature, which is commercial.
- **Detect:**
  - Store `tool --version` and config hashes in the report header, and diff per-rule counts.
  - Count baseline and suppression entries before and after (`jq 'length' eslint-suppressions.json`, `grep -c noqa`).
  - Run mutation testing scoped to the diff: `cargo mutants --in-diff`, `stryker run --incremental` after a baseline run, PIT with Arcmutate git, or mutmut restricted to changed files.
  - Keep a CHANGELOG section listing the BEHAVIOUR commits.
- **Tools:** Stryker, mutmut, PIT (+Arcmutate), cargo-mutants, ESLint suppressions, osv-scanner, git.
- **Applies to:** every pass. Mandatory when an AI agent performs the pass.
- **When not to apply / counterpoints:**
  - Mutation testing is expensive and produces unproductive mutants (85% initially at Google), so limit it to touched lines.
  - Revert and defect counts in a low-usage solo repo will be near zero regardless, so they are weak evidence either way.
- **Fix risk:** low

### G101-F01 — Build a temperature map before changing anything
**Rule:** before changing anything, classify every file or module by code temperature:
- **HOT:** changed in the last ~12 months, OR on a declared future-work list.
- **COLD:** neither.
- **DORMANT-BUT-ACTIVATABLE:** present but reachable only through a flag, config, env var, CLI option, disabled route or job, or commented-out code.

Choose the action per change category from the decision table. A "finished" repo is not uniformly cold.
- **Grade:** B · **Verdict:** CORRECTED. The Google 2024 note "(Measured on heavily exercised code.)" is replaced: the ratios are derived from average vulnerability lifetimes. I also flagged the 12-month threshold as a heuristic.
- **Rationale:**
  - The cost of poor internal quality is paid when code is changed, not by its mere existence, so the value of structural cleanup depends on future change.
  - Relative churn predicts defect density.
  - Vendor data shows activity and bugs concentrated in a small share of files; this is an example, not a study.
  - Dormant code does not fit the hot/cold split. It has no change cost until something activates it, and then it is the riskiest code in the repo (F05).
- **Evidence:**
  - [Technical Debt](https://martinfowler.com/bliki/TechnicalDebt.html) — Martin Fowler, 2019-05-21 — engineering_blog.
    - Quotes: "I only trigger an interest payment when I have to work with that part of the software" / "crufty but stable areas of code can be left alone" / "areas of high activity need a zero-tolerance attitude to cruft, because the interest payments are cripplingly high".
    - Verification: confirmed.
  - [The Half-Life of Code](https://sandimetz.com/blog/2017/6/1/the-half-life-of-code) — Sandi Metz, 2017-06-01 — engineering_blog.
    - Quotes: "It's not ugly code that costs money--it's change. Ugly code just exacerbates costs." / "you're not obligated to fix things that aren't costing you money."
    - Verification: confirmed.
  - [Use of Relative Code Churn Measures to Predict System Defect Density](https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/) — Nagappan & Ball, ICSE 2005 — peer_reviewed.
    - Quote: "Our code churn metric suite is able to discriminate between fault and not fault-prone binaries with an accuracy of 89.0 percent" (Windows Server 2003).
    - Verification: confirmed on the abstract page.
  - [CodeScene docs: Hotspots](https://codescene.io/docs/guides/technical/hotspots.html) — CodeScene — official_docs (vendor).
    - Quote: "Low code health in stable parts of the codebase, i.e. non-hotspots, has lower priority." In the example, prioritized hotspots are 1.2% of the code but take 12.5% of development effort and hold 45% of bugs.
    - Verification: confirmed. This is a vendor example, not a study.
  - [Eliminating Memory Safety Vulnerabilities at the Source](https://security.googleblog.com/2024/09/eliminating-memory-safety-vulnerabilities-Android.html) — Vander Stoep & Rebert, Google, 2024-09-25 — engineering_blog.
    - Quote: "based on the average vulnerability lifetimes, 5-year-old code has a 3.4x (using lifetimes from the study) to 7.4x (using lifetimes observed in Android and Chromium) lower vulnerability density than new code."
    - Verification: confirmed. The annotation was corrected.
- **Detect:**
  - **Hot list:** `git log --since='12 months ago' --format= --name-only | sort | uniq -c | sort -rn` (top decile), plus every file on the declared future-work list.
  - **Cold:** no commits in the window and not on the list.
  - **Dormant:**
    - grep for flag, config and env reads (e.g. `grep -rnE "process\.env\.|getenv\(|feature_?flag|isEnabled\(" src`), and check each flag's value in every deployed config;
    - find commented-out code blocks;
    - find routes, jobs and CLI subcommands that are never registered or invoked.
  - Record the classification in the findings report before any edit.
- **Tools:** git log, CodeScene hotspots, code-maat, grep or ripgrep.
- **Applies to:** all languages, every situation (S0-S6).
- **When not to apply / counterpoints:**
  - Churn is backward-looking. In S5 and S6, declared future change overrides history.
  - Age is not maturity. Google's ratios come from lifetimes in heavily used code, while a low-usage finished project does not harden with age.
  - Fowler's and Metz's argument assumes that stable code stays unread, which is false at a handover (S1).
  - The 12-month window has no source. Sensenmann's liveness example uses "over a year" for binaries, which is only a loose anchor.
- **Fix risk:** low

### G101-F13 — Handover and maintenance mode: deliver a map, not a remodel
**Rule:** in handover (S1) and maintenance mode (S4), deliver a MAP, not a remodel:
- a ranked report of hotspots, complexity and findings;
- characterization tests on the modules the next maintainer is expected to touch;
- dead-code removal;
- dependency automation;
- CI gates for new code.

Leave cold code structurally as it is.
- **Grade:** C · **Verdict:** VERIFIED. I added Google's "No Haunted Graveyards" passage as supporting evidence for the tests-first part.
- **Rationale:**
  - Working old code embodies bug fixes that a refactor can silently drop.
  - Practitioners warn against "just in case" refactoring when you don't know what will change, and recommend adding tests to at-risk modules instead.
  - Tests are add-only, so they carry almost no behaviour risk, and they protect the next maintainer.
  - Google names untested frozen code a "haunted graveyard", and its counter is testing, not rewriting.
  - Gating new code is how large codebases improved gradually.
- **Evidence:**
  - [Things You Should Never Do, Part I](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/) — Joel Spolsky, 2000 — engineering_blog.
    - Quote: "Old code has been used. It has been tested. Lots of bugs have been found, and they've been fixed."
    - Verification: confirmed.
  - [Should I refactor the code that is marked as "don't change"?](https://softwareengineering.stackexchange.com/questions/345593/should-i-refactor-the-code-that-is-marked-as-dont-change) — Software Engineering SE, 2017 — practitioner_forum.
    - Accepted answer 345599 (score 225): refactoring "just in case" is "a doomed refactoring strategy"; "use your time to add automatic tests (probably not unit tests, but integration tests) to the modules at risk".
    - Verification: confirmed through the SE API.
  - [SWE at Google, Ch. 22 ("No Haunted Graveyards")](https://abseil.io/resources/swe-book/html/ch22.html) — Hyrum Wright, O'Reilly 2020 — book.
    - Quotes: "A haunted graveyard in this sense is a system that is so ancient, obtuse, or complex that no one dares enter it" / "At Google, we've found the counter to this to be good, ol'-fashioned testing. When software is thoroughly tested, we can make arbitrary changes to it".
    - Verification: added and confirmed.
  - [Our journey to type checking 4 million lines of Python](https://dropbox.tech/application/our-journey-to-type-checking-4-million-lines-of-python) — Jukka Lehtosalo, Dropbox, 2019-09-05 — engineering_blog.
    - Quote: "We gradually increased strictness requirements for new code ... We now require type annotations in new Python files and most existing files." The codebase grew to "almost 4 million lines of statically typed code in about three years".
    - Verification: confirmed. The author, not given in the seed, has been added.
- **Detect:**
  - The report contains a top-N table: file, churn, complexity, findings, test coverage.
  - Characterization tests exist for each module on the declared "likely to change" list; they assert current outputs for recorded inputs.
  - CI fails on new violations (a baseline file is present), and an update bot is configured.
- **Tools:** git churn scripts, complexity tools, coverage tools, approval or snapshot testing libraries, Dependabot or Renovate.
- **Applies to:** S1, S4.
- **When not to apply / counterpoints:**
  - A handover recipient pays a comprehension cost even on cold code they only read. So comments and docs on cold code are A in S1.
  - A high-scoring SE answer argues the opposite: refactor before adding features when the code is brittle (answer 345597, score 140).
  - Google's haunted-graveyard view implies that cold, *untested*, critical code is itself a risk. Tests on it are worth adding even in S0 if it is business-critical.
- **Fix risk:** low

### G101-F11 — Pre-audit sweep, then freeze
**Rule:** before a security audit (S3), run a whole-codebase "easy issues" sweep, then FREEZE at a tagged commit. The sweep covers:
- every compiler warning;
- static-analysis findings;
- dead code, stale branches and unused libraries;
- unresolved TODOs;
- a working test suite at the agreed coverage.

No structural refactoring, deduplication or renames between the freeze and the audit.
- **Grade:** C · **Verdict:** CORRECTED. The OpenZeppelin page shows no date, so the year changed from "2025" to "n.d.".
- **Rationale:**
  - Auditors ask for this explicitly, so that their time goes to hard bugs rather than noise.
  - This is the one situation where auditors' guidance overrides "gate new code only" for warnings.
  - Structural churn right before the audit would invalidate the reviewed baseline and add fresh, less-tested code (F08).
- **Evidence:**
  - [How to prepare for a security audit](https://blog.trailofbits.com/2018/04/06/how-to-prepare-for-a-security-audit/) — Garret Reece, Trail of Bits, 2018-04-06 — engineering_blog.
    - Checklist quotes: "Enable and address every last compiler warning. Increase unit and feature test coverage. Remove dead code, stale branches, unused libraries, and other extraneous weight." / "Handing the code off to the assessment team is a lot like releasing the product: the cleaner the code, the better everything will go."
    - Verification: confirmed.
  - [Audit Readiness Guide](https://learn.openzeppelin.com/security-audits/readiness-guide) — OpenZeppelin, n.d. — official_docs.
    - Quotes: "It is also important to check for 'TODOs' and ensure that they are resolved prior to an audit or large release."; "Does the test suite cover at least 90 percent of the code?"; "developers should consider running a linter on every new line of code."
    - Verification: confirmed. The year is not shown.
- **Detect:**
  - Build with maximum warnings (`-Wall -Wextra`, `tsc --strict`, etc.) and require zero warnings.
  - Run the static analyzers.
  - `grep -rnE "TODO|FIXME|XXX|HACK"`.
  - Delete merged or stale branches (`git branch --merged`).
  - Measure coverage against the agreed target.
  - Tag the freeze commit. Any later commit is an explicit exception agreed with the auditor.
- **Tools:** compiler warning flags, Slither, Semgrep, CodeQL, coverage tools, git tag.
- **Applies to:** S3, and any situation where an external reviewer is about to read the whole code.
- **When not to apply / counterpoints:**
  - The evidence is guidance from two audit firms, not outcome data.
  - The 90% coverage figure is a smart-contract norm.
  - Fixing every warning in unfamiliar code can itself introduce defects, as the Debian OpenSSL case shows (F16). Warning fixes still follow F03 and F19.
- **Fix risk:** medium

### G101-F19 — Test-adequacy gate before non-mechanical changes
**Rule:** before any non-mechanical change to a region, check that tests would detect a behaviour change there: characterization tests exist, and mutants on the lines to be changed are killed. If not, downgrade the action (A becomes B, B becomes R), or first add characterization tests as a separate add-only commit.
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - Refactoring safety rests on the regression suite.
  - Practitioners report that without tests, the right move is not to touch code you don't need to.
  - Diff-scoped mutation testing shows whether tests actually cover the lines being changed.
- **Evidence:**
  - [Opportunistic Refactoring](https://martinfowler.com/bliki/OpportunisticRefactoring.html) — Martin Fowler, 2011-11-01 — engineering_blog.
    - Quote: "Refactoring does depend on having a good regression suite and it's wise to be wary if you think you're about to touch part of an application that's weaker on its tests than it should be." He also mentions "making a deliberate error" to see if a test catches it.
    - Verification: confirmed.
  - [Is it the correct practice to keep more than 10 years old spaghetti legacy code untouched...?](https://softwareengineering.stackexchange.com/questions/416242/is-it-the-correct-practice-to-keep-more-than-10-years-old-spaghetti-legacy-code) — Software Engineering SE, 2020 — practitioner_forum.
    - Answer 416249 (score 102): "If there aren't good tests, you add them first ... Changing code you don't understand is a recipe for disaster unless you are making dead simple changes." Its sequence: first a tests-only PR, then purely mechanical changes.
    - Answer 416272 (score 52): a critical safety system kept as "well-tested and trusted garbage".
    - Verification: confirmed through the SE API.
  - [HN comment by djsumdog](https://news.ycombinator.com/item?id=17581811) — Hacker News, 2018-07-21 — practitioner_forum.
    - Quote: "If there are no unit tests, this truly becomes an impossible task and it's best not to touch anything you don't need to."
    - Verification: confirmed through the HN API.
- **Detect:**
  1. For each region in a planned non-mechanical batch, measure line coverage on the exact lines to change, using a coverage tool with a diff filter.
  2. Then run mutation testing on those lines.
  3. If mutants survive or lines are uncovered, downgrade the action, or add a characterization-test commit first (approval or snapshot tests that record current outputs).
- **Tools:** coverage.py, istanbul, jacoco, llvm-cov; Stryker, mutmut, PIT, cargo-mutants; snapshot or approval testing libraries.
- **Applies to:** every non-mechanical batch in every situation.
- **When not to apply / counterpoints:**
  - Characterization tests lock in current behaviour, including bugs. That is correct for an NFC pass but must be revisited for bug fixes.
  - The cost of mutation testing limits how widely it can be used.
  - Timing and concurrency behaviour is poorly covered by both techniques.
- **Fix risk:** low

### G101-F16 — Error-handling changes are behaviour changes
**Rule:** treat any change to error-handling semantics as a BEHAVIOUR change and never bundle it into NFC batches. This covers catching, swallowing, re-throwing, changing exception types, retry or timeout behaviour, and validation strictness. In cold code, change it only when a swallowed or ignored error hides a security problem or data loss, and then only in an approval batch with a test that shows the old and new behaviour.
- **Grade:** C · **Verdict:** CORRECTED. The Ruff quote now uses the exact wording. The Debian exposure window is corrected from "about two years" to about 20 months (Sept 2006 to the May 2008 disclosure).
- **Rationale:**
  - Callers depend on observable behaviour, including error types.
  - Fixes that a tool labels as fixes can change exception types.
  - In the Debian OpenSSL incident, a maintainer silenced a Valgrind warning in code he knew he did not understand. He had asked on the upstream mailing list first. The change broke key generation from September 2006 until the May 2008 disclosure.
- **Evidence:**
  - [Hyrum's Law](https://www.hyrumslaw.com/) — Hyrum Wright — other.
    - Quote: "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody."
    - Verification: confirmed.
  - [Lessons from the Debian/OpenSSL Fiasco](https://research.swtch.com/openssl) — Russ Cox, 2008-05-21 — incident_report.
    - Quotes: Debian "in September 2006 ... accidentally broke the OpenSSL pseudo-random number generator while trying to silence a Valgrind warning"; "ssh-keygen ... could only generate 32,767 different possible SSH keys". "The Debian maintainer knew he didn't understand the code, so he asked for help on the openssl-dev mailing list".
    - [DSA-1571-1](https://lists.debian.org/debian-security-announce/2008/msg00152.html) (2008-05-13): "an incorrect Debian-specific change to the openssl package (CVE-2008-0166)".
    - Verification: both confirmed.
  - [Ruff linter: Fix safety](https://docs.astral.sh/ruff/linter/) — Astral, 2026 — official_docs.
    - Quote: "when the collection is empty, this raised exception changes from an IndexError to StopIteration ... Since the change in exception type could break error handling upstream, this fix is categorized as unsafe."
    - Verification: corrected to the exact wording.
  - [An Empirical Study of Refactoring Challenges and Benefits at Microsoft](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/kim-tse-2014.pdf) — Kim, Zimmermann, Nagappan, 2014 — peer_reviewed.
    - Developer quote: "The primary risk is regression, mostly from misunderstanding subtle corner cases in the original code and not accounting for them in the refactored code."
    - Verification: confirmed.
- **Detect:**
  - In NFC-tagged commits, flag diffs that touch any of: try/catch/except/rescue, `?`/unwrap/expect, error types, raise or throw statements, retry or timeout constants, validation code. Example: `git diff -U0 | grep -nE "catch|except|rescue|throw|raise|unwrap|expect\(|timeout|retry"`. Any hit in an NFC commit is a violation.
  - Cold-code candidates are empty catch blocks and ignored error returns (ESLint no-empty, errcheck, Ruff and flake8 bare-except rules). They go to the report unless they are relevant to security or data loss.
- **Tools:** ESLint no-empty, errcheck (Go), Ruff and flake8 exception rules, git diff grep.
- **Applies to:** all situations. In cold code: report, unless security or data loss is involved.
- **When not to apply / counterpoints:**
  - Swallowed errors in cold code can hide ongoing data corruption. Then the fix is urgent even though it changes behaviour: an approval batch, not the report.
  - The Debian maintainer asked upstream first and still got it wrong. Even "approved" fixes need a test that proves the property.
- **Fix risk:** high

### G101-F09 — Deduplicate only clones that share a requirement
**Rule:** deduplicate only clones that share a requirement, i.e. clones that historically changed together or must stay in sync. Leave clones in cold code in place and report them. Never merge look-alike code whose callers diverge. If an existing shared abstraction has grown flag parameters for each caller, re-inline it rather than extend it.
- **Grade:** C · **Verdict:** CORRECTED. The HN source URL pointed to the story (item 17578714), not the cited comment. It is now epage's comment, [item 17580306](https://news.ycombinator.com/item?id=17580306).
- **Rationale:**
  - Wrong abstractions cost more than duplication, and practitioners report shared helpers growing conditionals for each caller.
  - Copy/paste is rising in the AI era, which argues for reporting clones, but merging still needs co-change evidence.
- **Evidence:**
  - [The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) — Sandi Metz, 2016-01-20 — engineering_blog.
    - Quotes: "duplication is far cheaper than the wrong abstraction" ... "When the abstraction is wrong, the fastest way forward is back."
    - Verification: confirmed.
  - [AI Copilot Code Quality 2025](https://www.gitclear.com/ai_assistant_code_quality_2025_research) — GitClear, 2025 — industry_report (vendor).
    - Data: "211 million changed lines of code, authored between January 2020 and December 2024". Copy/pasted lines rose from 8.3% to 12.3%. Refactoring-associated ("moved") lines fell from 25% in 2021 to under 10% in 2024.
    - Verification: confirmed. This is a vendor trend and correlational.
  - [HN comment by epage on "The Wrong Abstraction"](https://news.ycombinator.com/item?id=17580306) — Hacker News, 2018 — practitioner_forum.
    - Quote: "we need to focus on whether the code shares requirements or implementation. With one, the duplicated code would evolve hand-in-hand while the other can have the code evolve separately."
    - Verification: found with the Algolia API; URL corrected.
- **Detect:**
  1. Clone detection: jscpd or PMD CPD with a minimum token threshold.
  2. For each clone pair, check co-change with `git log --format=%H --name-only` (count commits touching both files).
  3. Merge only if the files changed together more often than separately AND both are hot. Otherwise, list the pair in the report.
- **Tools:** jscpd, PMD CPD, git log co-change analysis, CodeScene change coupling.
- **Applies to:** hot code in S0-S4. S5 and S6 targets as approval batches. Cold code: report only.
- **When not to apply / counterpoints:**
  - One practitioner argues the opposite timing: extract only once code is stable and has seen varied use ([HN 11043481](https://news.ycombinator.com/item?id=11043481)).
  - If an AI agent will maintain the repo, clones that drift out of sync are a plausible failure mode (inferred from the GitClear trend). That argues for at least reporting them prominently.
- **Fix risk:** medium

### G101-F14 — Prototype to product: treat everything as about to be hot
**Rule:** when a prototype becomes a product (S5, e.g. a hackathon build), treat the whole codebase as about to become HOT:
- keep an explicit promotion TODO list, as in the kernel's drivers/staging;
- write tests first;
- then allow structural refactoring, deduplication and error-handling redesign as approval batches;
- finish each migration you start before starting the next.
- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:**
  - The cold-code argument only holds when change frequency will be near zero.
  - Promotion to product guarantees heavy change, so preparatory refactoring pays off.
  - Unfinished migrations become debt of their own.
- **Evidence:**
  - [How the development process works: Staging trees](https://www.kernel.org/doc/html/latest/process/2.Process.html) — Linux kernel docs (7.3.0-rc4), 2026 — official_docs.
    - Quotes: staging holds "drivers that aren't up to Linux kernel coding or quality standards"; "a TODO file should be present ... The TODO file lists the pending work that the driver needs for acceptance into the kernel proper"; "code in staging which is not seeing regular progress will eventually be removed."
    - Verification: confirmed.
  - [Opportunistic Refactoring](https://martinfowler.com/bliki/OpportunisticRefactoring.html) — Martin Fowler, 2011 — engineering_blog.
    - Quote: "Certainly there is a place for planned efforts at refactoring, even setting aside a day or two to attack a gnarly lump of code that's been getting in everyone's way for a few months."
    - Verification: confirmed. The code in question is hot.
  - [Migrations: the sole scalable fix to tech debt](https://lethain.com/migrations/) — Will Larson, 2018-04-15 — engineering_blog.
    - Quotes: "Derisk, Enable, and then Finish"; "starting but not finishing migrations often incurs significant technical debt".
    - Verification: confirmed.
- **Detect:**
  - A PROMOTION-TODO list exists (a file or an issue list), with each item assigned to a batch.
  - Every structural batch is preceded by a test commit that raises the coverage of the touched module.
  - No batch leaves two parallel implementations. After each migration batch, grep for the old API names.
- **Tools:** test frameworks, coverage tools, ripgrep for leftover legacy API.
- **Applies to:** S5.
- **When not to apply / counterpoints:**
  - Fowler's "sacrificial architecture" view says a prototype may be better rewritten than hardened. Not verified in this task.
  - Kim et al. show that even dedicated campaigns bring perceived regression risk (76%).
  - The evidence is practitioner guidance and kernel process, not outcome data.
- **Fix risk:** high

### G101-F15 — Before AI agent work: health work only where the agent will work
**Rule:** before an AI agent starts heavy feature work (S6), do preparatory health work ONLY in the modules the agent is expected to modify: tests first, then approval-batch refactoring of those modules.
- If the targets are unknown, limit the pass to tests, dead-code removal and a report.
- Never accept an agent's own "no functional change" summary as evidence; require machine checks.
- **Grade:** C · **Verdict:** CORRECTED. Changes:
  - Borg et al. is accepted at FORGE 2026 (peer-reviewed), not only a preprint.
  - The CodeScene whitepaper's "at least 60%" claim is **removed as evidence**. It cannot be reproduced from the paper's reported relative risks: 0.692–0.852, i.e. about 17–45% higher break risk on unhealthy code for mid-sized models, and no significant difference for Sonnet or the Claude agent.
  - Stripe Minions: author and date added.
- **Rationale:**
  - Borg et al. find that mid-sized LLMs break tests more often when refactoring unhealthy code. The effect was not significant for the strongest model (Sonnet).
  - A conservative agentic setup (Claude Code) broke about 5% of test suites regardless of code health, and its "zero functionality changes" summaries were sometimes wrong.
  - So code health in the agent's work area matters for weaker models, and self-reports cannot replace tests.
  - Illustrative arithmetic (inference): if each file independently has a 5% break rate, a 40-file structural pass has a 1 − 0.95^40 ≈ 87% chance of at least one break.
- **Evidence:**
  - [Code for Machines, Not Just Humans: Quantifying AI-Friendliness with Code Health Metrics](https://arxiv.org/abs/2601.02200) — Markus Borg, Nadim Hagatulah, Adam Tornhill, Emma Söderberg, 2026 (arXiv 2601.02200, accepted for FORGE 2026) — peer_reviewed (conference, accepted).
    - Quotes:
      - "All five medium-sized LLMs have significantly lower break rates on healthy code, with relative risk reductions of about 15% for the weakest model and 30% for the strongest."
      - "For the SotA LLM Sonnet, there is no significant difference between Healthy and Unhealthy code."
      - "Claude breaks only about 5% of the test suites regardless of whether the code is Healthy or Unhealthy".
      - "Claude's statements about 'zero functionality changes' ... are overconfident — sometimes the agent indeed breaks behavior."
    - Dataset: 5,000 competitive-programming Python files.
    - Verification: confirmed in the PDF. Tornhill and Borg are affiliated with CodeScene.
  - [Minions: Stripe's one-shot, end-to-end coding agents](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) — Alistair Gray, Stripe, 2026-02-09 — engineering_blog.
    - Quotes: "Over a thousand pull requests merged each week at Stripe are completely minion-produced, and while they're human-reviewed, they contain no human-written code"; "we only have at most two rounds of CI."
    - Verification: confirmed.
- **Detect:**
  - Require a written target-module list before the pass.
  - For each target: a coverage report, a mutation run on the module (F17), and a health or complexity metric before and after.
  - For each batch the agent produces: a full test pass plus a diff review.
  - Reject any batch whose only evidence of preserved behaviour is the agent's own summary.
- **Tools:** CodeScene Code Health (or complexity proxies), mutation testing (Stryker, mutmut, PIT, cargo-mutants), CI.
- **Applies to:** S6, and any pass executed by an AI agent.
- **When not to apply / counterpoints:**
  - The study has vendor-affiliated authors and uses small single-file competitive-programming code, not multi-file repos.
  - For the strongest model the health effect was not significant.
  - The dossier's T06 finding (FSE 2026: defective commented-out code in context raises AI-assistant defects) was not re-verified here. If it holds, it strengthens F05 for S6.
- **Fix risk:** medium

## Practitioner voice

All items opened through the HN Firebase or Algolia API, the StackExchange API, or a direct fetch.

- [HN, lolinder, on the Knight postmortem](https://news.ycombinator.com/item?id=37461828) — The dead code "seems to be exactly the point! ... If they'd done the right thing 8 years prior and removed code they weren't using ... No ancient routines get resurrected, no rogue server." The commenter says programmers resist deleting code even when it is under version control.
- [HN, gumby, dissent](https://news.ycombinator.com/item?id=37460089) — "they have a system that works with dead code in it. If you remove that dead code perhaps it unwittingly breaks something else. That kinds of chesterson's fence is a good practice."
- [HN, lionkor](https://news.ycombinator.com/item?id=37460199) — "in a lot of popular interpreted languages, it's impossible to tell if a given function can be called or not". Supports the split between provably dead and heuristically dead code.
- [HN, mijoharas](https://news.ycombinator.com/item?id=37460476) — "have a two deploys - actually removing the old code that relies on it and then repurposing it." (The seed's claim that "several replies say never to reuse a feature flag" was not checked and has been removed.)
- [HN, alexpotato](https://news.ycombinator.com/item?id=37466396) — Someone who worked at Knight *just after* the outage (corrected from "former Knight employee") says old database columns were reused because "no one had prioritized cleaning up the old code".
- [HN, djsumdog](https://news.ycombinator.com/item?id=17581811) — "If there are no unit tests ... it's best not to touch anything you don't need to. You have to have good tests if you ever want to tackle technical debt."
- [HN, Rapzid](https://news.ycombinator.com/item?id=17580572) — Notes areas to improve, then "During future work that touches that code I will refactor it if a solution has presented itself": the report-now, refactor-when-hot pattern.
- [HN, Chris2048](https://news.ycombinator.com/item?id=11043481) — The opposite timing for dedup: "wait until the code is 'stable' ... connected only to other stable parts ... then refactor."
- [HN, epage](https://news.ycombinator.com/item?id=17580306) — Deduplicate by shared requirements, not shared implementation.
- [SE Q345593](https://softwareengineering.stackexchange.com/questions/345593/should-i-refactor-the-code-that-is-marked-as-dont-change) — Accepted answer 345599 (score 225): refactoring "just in case" is "doomed"; add integration tests to at-risk modules. Answer 345598 (score 60): add characterization tests first. Answer 345597 (score 140) dissents: refactor first.
- [SE Q416242](https://softwareengineering.stackexchange.com/questions/416242/is-it-the-correct-practice-to-keep-more-than-10-years-old-spaghetti-legacy-code) — A critical safety system under third-party sign-off, kept as "well-tested and trusted garbage" (416272). Answer 416249 (score 102) lays out a sequence: tests, then mechanical changes.
- [SE Q103031](https://softwareengineering.stackexchange.com/questions/103031/should-i-remove-unreferenced-code) — Accepted answer (score 225): "If the code isn't used, throw it away- any benefit involved in keeping it can be trivially derived from source control."
- [SE Q190962](https://softwareengineering.stackexchange.com/questions/190962/is-it-a-good-idea-to-schedule-regular-time-to-clean-up-code) — Accepted answer (score 96): "No. Fix it while you're working on it", citing lost context and gold-plating code that is never used. A minority answer (score 22) says scheduled cleanup is "absolutely required for 90% of projects".
- [SE Q25023](https://softwareengineering.stackexchange.com/questions/25023/what-payoffs-have-you-seen-from-taking-care-of-technical-debt) — An inherited nightly report system (5-6 h runs, failing at least 2 nights a week) was stabilised over "2 years or so" of incremental changes. It ended at 45 minutes with no failures for years. This was a hot, failing system, not a one-shot cleanup.
- [Ron Jeffries](https://ronjeffries.com/xprog/articles/refactoring-not-on-the-backlog/) — "A big refactoring session is hard to sell, and if sold, it returns less than we hoped, after a long delay."
- [Meta SCARF](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) — More than 100M lines deleted in more than 370k change requests, but misunderstood dynamic references caused incorrect deletions that reached production.
- [Stripe rubyfmt](https://stripe.dev/blog/formatting-an-entire-25-million-line-codebase-overnight-the-rubyfmt-story) — A whole-codebase formatter merge (62,213 files) after a gradual per-file opt-in, with a ripper-tree diff validator and a held-back list. No incidents are reported.
- [Atlassian PIR](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage) — A legacy-app deletion script was given site IDs instead of app IDs and deleted 883 sites (775 customers), with outages of up to 14 days. Cleanup tooling needs type-checked scope and a dry run.
- [Russ Cox on Debian/OpenSSL](https://research.swtch.com/openssl) — Removing lines to silence Valgrind warnings cut Debian's SSH keys to 32,767 possibilities. It is the canonical case of a "fix the tool warning" cleanup in poorly understood code breaking a security property.

## Contradictions and open questions

**Contradictions (with resolutions)**
1. **Kim, Zimmermann & Nagappan disagree with themselves.**
   - FSE 2012 abstract: the refactored modules showed "significant reduction in the number of inter-module dependencies and post-release defects".
   - TSE 2014: the top 5% most-refactored modules "decrease post-release defects by 7% less than the rest", and the reduction "cannot be contributed to the refactoring changes alone".
   - The "12.2%" seed figure was not found.
   - Resolution: use the TSE 2014 result.
2. **Batch cleanup fails, yet Google fixed everything.**
   - Batch cleanup: FindBugs fixit 16% fixed; Infer batch "near zero" on 20-30 issues vs over 70% at diff time.
   - Yet Google fixed ALL existing instances codebase-wide for Clang and Error Prone checks, with owner review, and 57% of recipients were happy and 2% negative.
   - Resolution: the difference is triage cost and confidence (mechanical fix, no effective false positives, correctness only), not old code versus new code.
3. **Code age and security point both ways.**
   - Google (2024) derives 3.4x to 7.4x lower vulnerability density for 5-year-old code and argues that returns on rewrites shrink.
   - Alexopoulos et al. measure an average vulnerability lifetime of about 4 years (about 7 for OpenSSL), and Log4Shell sat in a stable feature for about 8 years.
   - Resolution: fix confirmed findings everywhere, rewrite nothing on age grounds. The decay model may not transfer to low-usage projects.
4. **Dead code: delete or keep?**
   - Delete: Knight Capital (SEC order) and the SE and HN majorities.
   - Caution: Chesterton's-fence dissenters, Meta SCARF's admitted production incidents, and CERT MSC12-EX2 (documented temporarily removed code is allowed).
   - Resolution: evidence tiers for dead code, and a separate category for dormant code.
5. **Deduplication: when?**
   - Metz: "duplication is far cheaper than the wrong abstraction", so re-inline.
   - One practitioner: deduplicate once code is stable.
   - GitClear: clones are rising in the AI era, which argues for more clone control in agent-maintained repos.
6. **Style churn.**
   - Against: LLVM ("explicitly do not want ... large-scale reformatting"; "avoid ... formatting-only changes outside of code you plan to make subsequent changes to") and netdev (clean-ups discouraged).
   - For: Stripe formatted 25M lines in one merge without reported incidents, after a gradual opt-in.
   - Resolution: repo context (shared vs single owner, open branches) plus verified equivalence.
7. **Planned cleanup.**
   - For: Fowler accepts "a day or two" of planned refactoring (on code "getting in everyone's way", i.e. hot code), and Microsoft set aside MQ milestones for cleanup.
   - Against: Jeffries says big sessions return "less than we hoped". Kim et al. found that more than 95% of developers refactor across all milestones, and that 57% of refactoring is driven by immediate needs.
8. **AI-friendliness.**
   - Borg et al. (FORGE 2026): mid-sized LLMs break tests more on unhealthy code (15-30% relative risk reduction on healthy code), but Sonnet showed no significant difference and the agentic Claude setup broke about 5% regardless.
   - CodeScene's whitepaper summarises the same study as "at least 60%" higher defect risk, which the paper's reported relative risks do not support.
   - Whether "clean before the agent works" pays off depends on the agent's capability.
9. **Leave cold code alone vs "No Haunted Graveyards".**
   - Google SRE/LSC practice treats untested, frozen critical code as an existential risk, to be countered by testing.
   - Resolution: this does not contradict "don't refactor cold code". It argues for adding tests (row 9) to business-critical cold code even in S0.

**Open questions**
- No study was found that compares a one-shot end-of-project cleanup with continuous refactoring. The T30 gap remains, and the decision table transfers evidence from continuous-refactoring, static-analysis-deployment and incident studies.
- Does the code-age vulnerability decay (modelled from Android/Chromium and large-FOSS lifetimes) apply to low-usage finished projects that are not exercised or fuzzed? If not, lowering the priority of security review in cold code because of its age is unjustified for small repos.
- The HOT window (12 months) and the "top decile" churn cut-off have no source.
- What false-positive threshold makes a check "compiler-grade" in a solo or agent pass? Google uses "no effective false positives" for compiler errors and under 10% effective false positives for code-review checks. The sample size needed to certify zero false positives before a fix-all batch is unstudied.
- Agent break rates were measured on single-file competitive-programming code. Break rates for multi-file structural refactors in real repos, and how well test suites detect them, are unknown.
- Ayewah & Pugh ISSTA 2010 is closed access; the fixit numbers come from the secondary account in Sadowski et al. 2018.
- Seeds from the researcher's list that were not verified (the search budget was exhausted in both passes):
  - Besker, Martini & Bosch 2018, "23% wasted time"
  - Zabardast et al., SEAA 2020
  - Ernst et al., FSE 2015
  - the Scrum/SAFe "hardening sprint anti-pattern"
  - the Code4rena and Sherlock audit-readiness guides
  - the failed 280-file AI PR (T09)
  - Airbnb's LLM test migration
- The T06 finding (FSE 2026, defective commented-out code in context) was not re-verified. If confirmed, removing dormant or commented-out code should become A (not B) in S6.
- Practitioner voice comes from HN and SE StackExchange only. Reddit r/ExperiencedDevs and Lobsters threads were not reached.
- The final venue of Petrović et al. (mutation testing at Google) was not confirmed; the arXiv version says "submitted to the IEEE".

## Dropped findings

None of the 19 findings was dropped. Individual sources removed or replaced:
- G101-F15 source — CodeScene whitepaper "AI-Ready Code" (v2, 2026-03-05). Dropped as evidence: its "at least 60%" defect-risk claim is not supported by the relative risks reported in the underlying Borg et al. paper.
- G101-F09 source — HN item 17578714 is the story, not the quoted comment. Replaced with the real comment, item 17580306 (epage).
- Practitioner voice 37460476 — the extra claim "several replies say never to reuse a feature flag" was removed as unchecked. The comment itself is kept.
