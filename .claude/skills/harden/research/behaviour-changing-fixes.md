# Policy and validation for hardening fixes that intentionally change behaviour
> Code X01 · slug behaviour-changing-fixes · verified 2026-09-23 · counts: verified 7 / corrected 11 / downgraded 1 / dropped 0

## Summary

This dossier resolves a contradiction between other dossiers. "Harden without breaking behaviour" cannot mean "change nothing observable", because timeouts, un-swallowed errors, bounds, config validation and latent-bug fixes all change behaviour on purpose. The mature ecosystems checked here all separate change classes and gate them differently:

- LLVM labels no-functional-change commits "NFC".
- Linux asks for one logical change per patch, uses the `Fixes:` tag, and caps -stable fixes at 100 lines.
- Google puts refactorings in CLs of their own.
- Ruff, ESLint and rustc label fixes safe/unsafe, fix/suggestion, or MachineApplicable/MaybeIncorrect.

The compatibility policies disagree on whether a bug fix may break code that relies on the bug:

- Go and SemVer reserve the right to fix it.
- Linux says a user-visible regression is not acceptable, even from a bug fix. Torvalds 2023 still says to fix the bug with a clean patch and revert it if real users regress.
- Cargo and Rust RFC 1105 call it a judgement call.

Every quote was re-checked against the live source (HTML/PDF text extraction, OpenAlex/Crossref metadata, the HN Algolia API, GitHub raw files). **No finding was dropped. Every cited source exists and every attribution is correct.** The corrections are about precision:

- **Yuan et al. (OSDI 2014):** the 92% and 35% figures cover the **48 catastrophic failures** in a sample of 198, not all 198. The 77% "reproducible by a unit test" figure covers all 198, not only catastrophic ones.
- **Purushothaman & Perry (TSE 2005):** the abstract says "nearly 40 percent of changes to fix faults resulted in further faults". The researcher had inserted "[small]", which the abstract does not say.
- **The two "preprints" are now peer-reviewed:** Liu et al. was published in *Automated Software Engineering* 32(1), 2025. Wang, Pradel & Liu was published at ICSE 2026. The SWE-bench paper also reports that only 28.6% of the behaviourally divergent patches are *certainly incorrect*, so divergence alone does not mean the patch is wrong.
- **Quotes that were not verbatim:**
  - Node.js history: the real text is "v15.0.0 Changed default mode to throw. Previously, a warning was emitted."
  - GitHub Autofix: the real text is "Has the fix changed the output of any of the repository tests?". The old URL now redirects to a combined "Application card".
  - GoReplay README: the real text is "GoReplay increases your confidence in code deployments, configuration and infrastructure changes".
- **URLs replaced with canonical or primary ones:**
  - The LWN SubscriberLink now points to the free canonical article (Corbet, 2 Feb 2023).
  - The Go "Hyrum's law" error string is now verified in the Go source itself, not only through a blog.
  - The Feature Toggles article dates from 2016 (revised 2017), not 2017.
  - GoReplay moved to `probelabs/goreplay`, and its last tagged release is 1.3.3 (Oct 2021).
  - Diffy's README badge declares a CC BY-NC-ND licence.
- **Detection bug:** `git diff --diff-filter=M` selects *files*, not *lines*. It flags a test file that only gained new cases, so it cannot tell whether an existing assertion was edited. The corrected check looks at removed lines (`^-`) in test files.
- **Downgrade:** F16 goes from A to B. The conventions it cites are real, but the mandatory "Behavior change:" paragraph and the class-to-convention mapping come from no source.
- **Open question closed:** two papers the researcher could not reach were checked through OpenAlex abstracts. Gu et al. (ICSE 2010) found that "bad fixes comprise as much as 9% of all bugs" in Ant, AspectJ and Rhino. Bavota et al. (SCAM 2012) found that some refactorings, particularly those involving class hierarchies, "tend to induce faults very frequently". So C1 refactors are not risk-free.

**Decision table.** This is the researcher's synthesis. No single source states it, though each gate is backed by the findings below.

| Class | Definition | Required evidence | Gate | Commit |
|---|---|---|---|---|
| C1 NFC refactor | No observable difference on any input | Existing tests pass unedited. Tool-safe fix or engine refactor. Guard-deletion check. Differential run if the LLM wrote the edit | AUTO | `refactor:`/`style:`/`perf:` + NFC |
| C2 failure-path hardening | Changes behaviour only where code today throws, hangs, crashes, grows without bound or loses errors | New failure-forcing test. Fail mode written down. Escape hatch | APPROVE (batch per failure mode) | `fix(scope):` + behaviour note |
| C3 latent-bug fix | Success-path output changes for some valid inputs | Concrete trigger. Test that fails on the parent and passes on the fix. Search for sibling occurrences | APPROVE, one fix per commit | `fix:` with the test in the same commit |
| C4 contract change | Signature, error type/message, exit code, default, format, fail-open/closed flip, or any edit to an existing assertion | Consumer inventory and a migration path | REPORT ONLY | `type!:` + `BREAKING CHANGE:` |

## Findings

### G102-F01 — Classify each hardening change into one class and never mix classes in one commit; put structure before behaviour
- **Grade:** A · **Verdict:** CORRECTED. Every quote checks out. The rationale said tangled commits "corrupt later bisect and revert", but Herzig & Zeller measured damage to mined bug datasets (bug counts, prediction), not bisect or revert, so that clause is now marked as inference. The file-level `--diff-filter=M` detection is replaced by a line-level check. The C1-C4 taxonomy is a synthesis, but the separation rule itself rests on three independent project policies.
- **Rationale:** LLVM, Linux and Google each require structural or formatting changes to land separately from functional ones. Kent Beck argues that structure changes are reversible and behaviour changes are not, so they deserve different scrutiny. Herzig & Zeller show that tangled changes are common (up to 15% of bug fixes) and skew the bug data mined from history. Separation also makes the "NFC" claim checkable.
- **Evidence:**
  - [LLVM Developer Policy](https://llvm.org/docs/DeveloperPolicy.html) — LLVM Project, current — official docs — "try to separate formatting or whitespace changes from functional changes, either by correcting the format first (ideally) or afterward. Such changes should be highly localized and the commit message should clearly state that the commit is not intended to change functionality, usually by stating it is NFC." — verbatim, verified.
  - [LLVM Lexicon: NFC](https://llvm.org/docs/Lexicon.html) — LLVM Project, current — official docs — "'No functional change'. Used in a commit message to indicate that a patch is a pure refactoring/cleanup." — verified.
  - [Submitting patches](https://www.kernel.org/doc/html/latest/process/submitting-patches.html) — Linux kernel docs, current — official docs — "Separate each logical change into a separate patch." — verified.
  - [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) — Google Engineering Practices, current — official docs — "It's usually best to do refactorings in a separate CL from feature changes or bug fixes." / "Small cleanups such as fixing a local variable name can be included inside of a feature change or bug fix CL, though." — verified. It sits under the heading "Separate Out Refactorings".
  - [Structure & Behavior](https://newsletter.kentbeck.com/p/structure-and-behavior) — Kent Beck, 9 Feb 2021 — practitioner newsletter — "Behavior changes are hard to reverse." / "Treat reversible and irreversible decisions differently." — verified. The title uses "&".
  - [The Impact of Tangled Code Changes (MSR 2013)](https://www.st.cs.uni-saarland.de/publications/files/herzig-msr-2013.pdf) — Kim Herzig, Andreas Zeller, 2013 — peer-reviewed — "we found up to 15% of all bug fixes to consist of multiple tangled changes"; "on average at least 16.6% of all source files are incorrectly associated with bug reports"; more than 7,000 change sets classified by hand across 5 open-source Java projects — verified. It measures dataset noise, not bisect or revert harm.
- **Detect:** For every commit in the pass, read `git show --stat <sha>` and the subject line. A commit labelled NFC or `refactor:` is misclassified when:
  - `git diff <sha>^ <sha> -- '*test*' '*spec*' | grep -E '^-[^-]'` shows removed or changed test lines. Do not use `--diff-filter=M`: it selects files and also flags test files that only gained new cases.
  - It changes string literals, exit codes or conditionals on error paths.

  Manual check: if describing the commit needs an "and", split it.
- **Tools:** git, commitlint (`@commitlint/config-conventional`), ast-grep
- **Applies to:** All languages; every commit the hardening pass produces
- **When not to apply / counterpoints:**
  - Google explicitly allows small cleanups inside a fix CL.
  - Squash-merge workflows collapse the separation when the branch is merged.
  - The class boundaries are fuzzy. The Cargo SemVer guide calls most runtime-risk changes "a judgment call".
  - A solo developer may resist the overhead.
- **Fix risk:** low

### G102-F02 — Use the linters' own fix-safety labels as the auto-apply boundary
- **Grade:** A · **Verdict:** VERIFIED. All five quotes are verbatim. I added the rustc-dev-guide statement that only MachineApplicable "can be applied mechanically", and the Ruff nuance on comment removal.
- **Rationale:** Tool authors already record which rewrites preserve runtime behaviour. Several "best-practice" rewrites only look cosmetic, and the tools ship them as suggestions or unsafe fixes:
  - `||` to `??`
  - `==` to `===` on non-literal operands
  - `list(x)[0]` to `next(iter(x))`, which turns an IndexError into a StopIteration

  Auto-apply only Ruff safe fixes, ESLint `--fix` output, and rustc/Clippy MachineApplicable suggestions. Everything else is a C2/C3 item that needs approval.
- **Evidence:**
  - [Ruff: Fix safety](https://docs.astral.sh/ruff/linter/#fix-safety) — Astral, current — official docs — "The meaning and intent of your code will be retained when applying safe fixes, but the meaning could change when applying unsafe fixes." RUF015: "when the collection is empty, this raised exception changes from an IndexError to StopIteration". "Ruff only enables safe fixes by default." — verified. Also verified: safe fixes "will only remove comments when deleting entire statements or expressions", and `lint.extend-safe-fixes`/`extend-unsafe-fixes` let users reclassify a rule.
  - [ESLint: Custom Rules](https://eslint.org/docs/latest/extend/custom-rules) — ESLint, current — official docs — "Avoid any fixes that could change the runtime behavior of code and cause it to stop working." / "In some cases fixes aren't appropriate to be automatically applied, for example, if a fix potentially changes functionality…". Suggestions exist so that "editors" can "expose helpers for users to manually apply a suggestion" — verified.
  - [rustc_errors::Applicability](https://doc.rust-lang.org/nightly/nightly-rustc/rustc_errors/enum.Applicability.html) — Rust project, nightly docs — MachineApplicable: "The suggestion is definitely what the user intended, or maintains the exact meaning of the code. This suggestion should be automatically applied." MaybeIncorrect: "The suggestion may be what the user intended, but it is uncertain." — verified.
  - [rustc dev guide: Diagnostics](https://rustc-dev-guide.rust-lang.org/diagnostics.html) — Rust project, current — official docs — "MachineApplicable: Can be applied mechanically… MaybeIncorrect: Cannot be applied mechanically because the suggestion may or may not be a good one." — added by the verifier.
  - [ESLint eqeqeq](https://eslint.org/docs/latest/rules/eqeqeq) — ESLint, current — official docs — "A problem is only fixed if one of the operands is a typeof expression, or if both operands are literals with the same type. In other cases a suggestion is offered which can change runtime behavior if the operands have different types." — verified.
  - [typescript-eslint prefer-nullish-coalescing](https://typescript-eslint.io/rules/prefer-nullish-coalescing/) — typescript-eslint, current — official docs — "Some problems reported by this rule are manually fixable by editor suggestions"; the `ignoreConditionalTests` rationale says "fixing the operator to the nullish coalesce operator could cause bugs" — verified.
- **Detect:** Run each linter in two modes and compare the output:
  - Ruff: `ruff check --fix` (auto) vs `ruff check --unsafe-fixes --diff` (report only).
  - ESLint: `eslint --fix` (auto) vs suggestions surfaced as report items.
  - Rust: `cargo clippy --fix` for machine-applicable fixes; everything else is reported.

  A hand-written rewrite that matches a rule the tool classes as unsafe or suggestion-only is C3.
- **Tools:** ruff, eslint, typescript-eslint, clippy / cargo fix
- **Applies to:** Python, JS/TS and Rust directly. Other ecosystems by analogy.
- **When not to apply / counterpoints:**
  - "Safe" is the maintainers' judgement, and users can reclassify rules.
  - A rewrite with no linter rule behind it has no safety label at all.
  - The Cargo `cargo fix` page itself does not state the MachineApplicable-only restriction. The restriction is documented in rustc's Applicability and dev-guide pages.
- **Fix risk:** low

### G102-F03 — Do not accept an AI-written "pure refactor" because tests pass: prefer deterministic engines or a differential check, and look for deleted guards
- **Grade:** B · **Verdict:** CORRECTED. Both studies are now peer-reviewed (the source types were wrong). I added the SWE-bench paper's own caveat, and Bavota et al. (SCAM 2012) as independent evidence that some refactoring kinds induce faults.
- **Rationale:** Measured error rates for LLM refactorings and patches are material, and test suites miss the divergence. Two caveats:
  - Divergence is not the same as incorrectness. The authors confirm only 28.6% of the divergent patches as certainly incorrect.
  - Human refactorings are not risk-free either. Hierarchy refactorings "tend to induce faults very frequently".

  Cloudflare's 2019 global outage was made possible by a CPU guard that had been removed during a refactoring weeks earlier.
- **Evidence:**
  - [An Empirical Study on the Potential of LLMs in Automated Software Refactoring](https://arxiv.org/abs/2411.04444) — Bo Liu, Yanjie Jiang, Yuxia Zhang, Nan Niu, Guangjie Li, Hui Liu, 2024/2025 — **peer-reviewed** (journal ref on arXiv: *Automated Software Engineering* 32(1), 2025, DOI 10.1007/s10515-025-00500-0) — "13 out of the 176 solutions suggested by ChatGPT and 9 out of the 137 solutions suggested by Gemini were unsafe in that they either changed the functionality of the source code or introduced syntax errors". Proposes RefactoringMirror, which reapplies refactorings "using thoroughly tested refactoring engines" — verified in the abstract.
  - [Are "Solved Issues" in SWE-bench Really Solved Correctly?](https://arxiv.org/abs/2503.15223) — You Wang, Michael Pradel, Zhongxin Liu, 2025/2026 — **peer-reviewed** (ICSE 2026, DOI 10.1145/3744916.3764576, per Crossref) — "7.8% of all patches to count as correct while failing the developer-written test suite"; "even more (29.6%) plausible patches induce different behavior than the ground truth patches"; "28.6% of behaviorally divergent patches are certainly incorrect" — verified in the abstract. The researcher's quote dropped "even more (…)"; the meaning is unchanged.
  - [When Does a Refactoring Induce Bugs? (SCAM 2012)](https://doi.org/10.1109/scam.2012.20) — Bavota, De Carluccio, De Lucia, Di Penta, Oliveto, Strollo, 2012 — peer-reviewed — 15,008 refactorings in Ant, Xerces and ArgoUML; "some kinds of refactorings… such as refactorings involving hierarchies (e.g., pull up method), tend to induce faults very frequently" — added by the verifier. Checked only through the OpenAlex abstract.
  - [Details of the Cloudflare outage on July 2, 2019](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/) — Cloudflare, 12 Jul 2019 — incident report — "A protection that would have helped prevent excessive CPU use by a regular expression was removed by mistake during a refactoring of the WAF weeks prior"; remediation "Re-introduce the excessive CPU usage protection that got removed." — verified.
- **Detect:**
  1. For each NFC commit, run `git diff -U0 <sha>^ <sha> | grep '^-' | grep -Ei 'timeout|limit|max|retry|assert|valid|check|throw|raise|return err|panic|deadline|cancel'`. Every hit needs a justification.
  2. Differential run: `git worktree add ../pre <sha>^`, run both trees on the same fixtures, and diff stdout, stderr and exit codes.
  3. Prefer IDE/LSP refactoring commands or ast-grep rewrite rules over free-form edits.
- **Tools:** git worktree, ast-grep, IDE/LSP refactorings, PatchDiff-style differential testing
- **Applies to:** All languages; especially large LLM-generated cleanup diffs
- **When not to apply / counterpoints:**
  - The data comes from benchmarks: Java refactorings, and Python on SWE-bench Verified with three agents. The rates may not transfer to newer models.
  - Differential runs need deterministic, representative inputs.
  - Bavota et al. use SZZ, which is itself noisy.
- **Fix risk:** low

### G102-F04 — Treat every behaviour-changing fix (C2/C3) as a risky change: keep it small and single-purpose, review concurrency and allocation changes harder, and search for sibling occurrences
- **Grade:** A · **Verdict:** CORRECTED. The researcher's Purushothaman & Perry quote inserted "[small]", which is not in the abstract. The rule's "likely to be defective" overstates the data: incorrect-fix rates are roughly 1 in 4 to 1 in 7, not over 50%. I added Gu et al. (ICSE 2010) and Torvalds's 2024 statement of why the no-regression rule exists.
- **Rationale:** Several peer-reviewed studies agree:
  - Fixes are incorrect at material rates (Yin: 14.8-24.4%, a lower bound).
  - Concurrency fixes are the worst (39% incorrect).
  - Larger changes induce more fixes.
  - 22-33% of bugs need a second fix (Park).
  - Fixers unfamiliar with the file are over-represented among incorrect fixes.

  The comparison to an AI agent working in unfamiliar code is an analogy, not a measured result. The Linux -stable rule ("obviously correct and tested", at most 100 lines with context) gives a usable size ceiling.
- **Evidence:**
  - [How Do Fixes Become Bugs? (ESEC/FSE 2011)](https://www.eecg.utoronto.ca/~yuan/papers/fse11.pdf) — Zuoning Yin, Ding Yuan, Yuanyuan Zhou, Shankar Pasupathy, Lakshmi Bairavasundaram, 2011 — peer-reviewed — the following are all verified in the PDF:
    - "at least 14.8%~24.4% of sampled fixes for post-release bugs in these large OSes are incorrect". Per-OS 95% confidence intervals are in Table 3, and the paper calls the range a lower bound.
    - "43% of the examined incorrect fixes can cause crashes, hangs, data corruptions or security problems".
    - "39% of concurrency bug fixes are incorrect".
    - "27% of the incorrect fixes are made by developers who have never touched the source code files associated with the fix".
    - "Fixes on data race bugs can easily introduce new deadlock bugs".

    The OSes studied are FreeBSD, Linux, OpenSolaris and one commercial OS.
  - [Toward understanding the rhetoric of small source code changes (IEEE TSE)](https://doi.org/10.1109/tse.2005.74) — Ranjith Purushothaman, Dewayne E. Perry, 2005 — peer-reviewed — abstract via OpenAlex: "there is less than 4 percent probability that a one-line change introduces a fault" and "**nearly 40 percent of changes to fix faults resulted in further faults**". CORRECTED: the abstract does not restrict the 40% figure to small changes. Only the abstract was checked; the "Lucent" data origin was not verifiable from the abstract.
  - [When Do Changes Induce Fixes? (On Fridays.) (MSR 2005)](https://www.st.cs.uni-saarland.de/papers/msr2005/msr2005.pdf) — Jacek Śliwerski, Thomas Zimmermann, Andreas Zeller, 2005 — peer-reviewed — "fix-inducing transactions are roughly three times larger than non fix-inducing transactions"; "the larger a change, the more likely it is to induce a fix"; "in the ECLIPSE project, fixes are three times as likely to induce a later change than ordinary enhancements". Averages: Eclipse P(bug|fix) 23.7% vs P(bug|¬fix) 8.1%; Mozilla 45.2% vs 38.1% (Tables 5-6) — verified.
  - [An empirical study of supplementary bug fixes (MSR 2012)](https://doi.org/10.1109/msr.2012.6224298) — Jihun Park, Miryung Kim, Baishakhi Ray, Doo-Hwan Bae, 2012 — peer-reviewed — abstract via OpenAlex: "a significant portion of resolved bugs (22% to 33%) involves more than one fix attempt"; causes include "missed porting changes, incorrect handling of conditional statements, or incomplete refactorings". Only 12%/25%/9% of supplementary patches resemble the initial patch, so a clone search alone misses most siblings — verified (abstract only).
  - [Has the bug really been fixed? (ICSE 2010)](https://doi.org/10.1145/1806799.1806812) — Zhongxian Gu, Earl T. Barr, David J. Hamilton, Zhendong Su, 2010 — peer-reviewed — "bad fixes comprise as much as 9% of all bugs" (Ant, AspectJ, Rhino) — added by the verifier (OpenAlex abstract).
  - [Linux -stable rules](https://www.kernel.org/doc/html/latest/process/stable-kernel-rules.html) — Linux kernel docs, current — official docs — "It must be obviously correct and tested." "It cannot be bigger than 100 lines, with context." — verified.
  - [Handling regressions](https://www.kernel.org/doc/html/latest/process/handling-regressions.html) — Linux kernel docs (Torvalds, 2024-05-28) — official docs — "The 'no regressions' rule is that we do not introduce NEW bugs. It *literally* came about because we had an endless dance of 'fix two bugs, introduce one new one'" — added by the verifier.
- **Detect:** Flag a C2/C3 diff for extra review when any of these holds:
  - `git diff --shortstat` exceeds about 100 lines.
  - It touches concurrency primitives: `grep -nE 'lock|unlock|mutex|synchronized|atomic|semaphore|await|Promise\.all|go func|chan |thread'`.
  - It changes buffer or allocation sizes.

  Before closing a finding, write an ast-grep or grep pattern for the defect and run it across the repo. Park's data shows that siblings are often not clones, so also check the callers and callees of the fixed site.
- **Tools:** git, ast-grep, grep/ripgrep
- **Applies to:** All languages; all C2/C3 changes
- **When not to apply / counterpoints:**
  - All the data is from 2005-2012 and comes from C/Java OS and IDE codebases.
  - The Mozilla numbers only weakly replicate the Eclipse result.
  - SZZ-style "fix-inducing" labels are noisy.
  - None of these studies measures the net benefit or harm of a proactive hardening pass.
  - The 100-line ceiling comes from backporting to stable kernels, not from a study.
- **Fix risk:** low

### G102-F05 — Fix swallowed or over-broad handlers by narrowing them and propagating to a containing boundary handler, never by switching to a process-wide abort (C2)
- **Grade:** B · **Verdict:** CORRECTED. The Yuan percentages had the wrong denominator. The 92% and 35% figures are shares of the **48 catastrophic failures** among 198 sampled failures, not of all 198. I also added Shore's explicit warning against scattered catch-alls.
- **Rationale:** In Yuan et al., almost all catastrophic failures came from mishandled non-fatal errors. The same paper lists three trivial patterns: empty or log-only handlers, *aborting on an over-caught exception* (8% of catastrophic failures), and TODO handlers. So the fix must not swing to the opposite extreme. Shore pairs fail-fast with a global handler that reports the error and continues, and says to avoid catch-all handlers elsewhere.
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures (OSDI 2014)](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Ding Yuan, Yu Luo, Xin Zhuang, et al. (University of Toronto), 2014 — peer-reviewed — the following are verified:
    - "almost all (92%) of the catastrophic system failures are the result of incorrect handling of non-fatal errors explicitly signaled in software".
    - "in 35% of the catastrophic failures, the faults in the error handling code fall into three trivial patterns: (i) the error handler is simply empty or only contains a log printing statement, (ii) the error handler aborts the cluster on an overly-general exception, and (iii) the error handler contains expressions like 'FIXME' or 'TODO'".
    - Table 1 gives 198 sampled failures, of which 48 are catastrophic. Figure 5 breaks them down as errors ignored 25%, abort in over-caught exceptions 8%, and "TODO" in handler 2%.
  - [Fail Fast](https://martinfowler.com/ieeeSoftware/failFast.pdf) — Jim Shore, IEEE Software "Design" column (ed. Martin Fowler), 2004 — magazine column — "a crash is never appropriate. Fortunately, there's a middle ground." The middle ground is a "global exception handler to gracefully handle unexpected exceptions"; the batch example continues "with the next transaction (see Figure 5)"; "If you use a global exception handler, avoid catch-all exception handlers in the rest of your application." — verified. The last sentence was added by the verifier.
  - [A10:2025 Mishandling of Exceptional Conditions](https://top10.owasp.org/2025/A10_2025-Mishandling_of_Exceptional_Conditions) — OWASP, 2025 — standard — "programs fail to prevent, detect, and respond to unusual and unpredictable situations, which leads to crashes, unexpected behavior, and sometimes vulnerabilities"; catch errors "directly at the place where they occur", plus "a global exception handler"; "This category contains 24 CWEs" — verified.
  - [ESLint no-empty](https://eslint.org/docs/latest/rules/no-empty) — ESLint, current — official docs — `allowEmptyCatch`: "Allows empty catch clauses (that is, which do not contain a comment)". The rule has suggestions ("hasSuggestions") but no auto-fix — verified.
- **Detect:**
  - Python: `ruff check --select BLE001,S110,S112,E722`. The rules are blind-except, try-except-pass, try-except-continue and bare-except; all four codes are verified in the Ruff rules index.
  - JS/TS: ESLint `no-empty` with `allowEmptyCatch: false`.
  - Grep/ast-grep for:
    - `catch\s*\([^)]*\)\s*\{\s*\}`
    - `except Exception:\s*(pass|continue)`
    - `catch (Throwable`
    - TODO/FIXME inside handlers
    - Go `if err != nil {}` and `_ = err`

  For each hit, name the boundary that will catch the propagated error, and confirm it contains the failure rather than exiting.
- **Tools:** ruff (BLE001, S110, S112, E722), eslint (no-empty), ast-grep, semgrep
- **Applies to:** All languages with exceptions or error values; services, workers, CLIs
- **When not to apply / counterpoints:**
  - No study measures the net effect of un-swallowing errors in a working system. Surfacing latent failures can turn silent degradation into visible outages.
  - Some swallows are intentional (best-effort cleanup, telemetry, `close()`). Annotate them rather than removing them.
  - A boundary handler that "continues" hides errors if nobody reads its logs.
  - Yuan's sample is 5 Java/C distributed data systems.
- **Fix risk:** high

### G102-F06 — A C3 fix ships with a test that fails on the parent and passes on the fix, plus a concrete trigger; add tests but never edit existing assertions
- **Grade:** A (reproducer-test requirement); the "existing assertions frozen, otherwise C4" clause is synthesis at B · **Verdict:** CORRECTED. All quotes are verified. The detection step used `--diff-filter=M`, which cannot tell a new test case from an edited assertion; it is replaced by a line-level check.
- **Rationale:**
  - LLVM and Google require tests with fixes.
  - Linux refuses speculative fixes that have no demonstrated trigger.
  - Characterization tests pin actual behaviour before a restructure.
  - Adding tests while freezing existing assertions resolves the conflict between "tests unmodified" and "a fix needs a failing test". Google's text explicitly allows "updated tests", so the freeze is a stricter local policy.
- **Evidence:**
  - [LLVM Developer Policy](https://llvm.org/docs/DeveloperPolicy.html) — LLVM Project, current — official docs — "Bug fixes and new features should include a testcase so we know if the fix/feature ever regresses in the future." / "Developers are required to create test cases for any bugs fixed and any new features added." — verified.
  - [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) — Google, current — official docs — "A CL that adds or changes logic should be accompanied by new or updated tests for the new behavior." / "Pure refactoring CLs (that aren't intended to change behavior) should also be covered by tests; ideally, these tests already exist, but if they don't, you should add them." — verified.
  - [Linux -stable rules](https://www.kernel.org/doc/html/latest/process/stable-kernel-rules.html) — Linux kernel docs, current — official docs — "No 'This could be a problem...' type of things like a 'theoretical race condition', unless an explanation of how the bug can be exploited is also provided." — verified.
  - [Characterization test](https://en.wikipedia.org/wiki/Characterization_test) — Wikipedia, citing Michael Feathers, *Working Effectively with Legacy Code* (ISBN 0-13-117705-2) — encyclopedia — "A characterization test (also known as Golden Master Testing) is a means to describe (characterize) the actual behavior of an existing piece of software, and therefore protect existing behavior of legacy code against unintended changes via automated testing." "This term was coined by Michael Feathers." — verified. The researcher's quote dropped the parenthesis. The Feathers book itself was not opened.
- **Detect:** For each C3 commit:
  1. `git worktree add ../pre <sha>^`.
  2. Copy the new test into `../pre` and run it. It must FAIL there and PASS on `<sha>`.
  3. `git diff <sha>^ <sha> -- '*test*' '*spec*' | grep -E '^-[^-]'` must be empty: no removed or changed lines in existing tests, only additions.
- **Tools:** git worktree; the project's test runner (vitest/pytest/cargo test/go test)
- **Applies to:** All languages; C1 (characterization tests) and C3 (reproducer tests)
- **When not to apply / counterpoints:**
  - Concurrency, timing and environment bugs are often hard to reproduce deterministically. In that case, document the reasoning and approve at a higher bar.
  - Google's own rule allows updated tests.
  - Characterization tests can cement buggy behaviour, so a later C3 fix will look like a regression and must update them. That update is a C4 edit by this policy's own rule, which is a known tension.
- **Fix risk:** low

### G102-F07 — "Without breaking behaviour" means different things per class; inventory consumers before any C2/C3, and treat error types, messages, exit codes and defaults as contract when external consumers exist
- **Grade:** A · **Verdict:** VERIFIED. All seven quotes are verbatim, and the Torvalds dates (2018-08-03 and 2023-06-02) are confirmed. I added the Linux nuance below.
- **Rationale:** Fowler's "observable behavior" defines refactoring only. The compatibility policies diverge on bug fixes:
  - Go reserves the right to fix bugs that break dependents.
  - SemVer says "use your best judgment" and may call for a major version.
  - Linux treats a user-visible regression as unacceptable even from a bug fix. Torvalds 2023 still says to "fix the bug right, with a clean patch… knowing full well… we may have to revert it".
  - Cargo and RFC 1105 call it a judgement call, and RFC 1105 leaves panic to Err unresolved.

  Hyrum's law explains why: the deciding variable is who consumes the behaviour.
- **Evidence:**
  - [Definition Of Refactoring](https://martinfowler.com/bliki/DefinitionOfRefactoring.html) — Martin Fowler, 1 Sep 2004 — practitioner blog — "a change made to the internal structure of software to make it easier to understand and cheaper to modify without changing its observable behavior." — verified.
  - [Go 1 and the Future of Go Programs](https://go.dev/doc/go1compat) — The Go Authors, current — official docs — "If a compiler or library has a bug that violates the specification, a program that depends on the buggy behavior may break if the bug is fixed. We reserve the right to fix such bugs." — verified.
  - [Semantic Versioning 2.0.0](https://semver.org/) — Tom Preston-Werner (original author) — standard — bug fix = "an internal change that fixes incorrect behavior"; FAQ: "Use your best judgment. If you have a huge audience that will be drastically impacted by changing the behavior back to what the public API intended, then it may be best to perform a major version release, even though the fix could strictly be considered a patch release." — verified.
  - [RFC 1105: API Evolution](https://rust-lang.github.io/rfcs/1105-api-evolution.html) — Rust project, 2015 (start date 2015-05-04) — standard — "behavior that is not part of this contract is permitted to change in minor revisions"; unresolved: "Is it permitted to change a contract from 'abort' to 'panic'? What about from 'panic' to 'return an Err'?" — verified.
  - [Cargo Book: SemVer Compatibility](https://doc.rust-lang.org/cargo/reference/semver.html) — Rust project, current — official docs — "Almost every change carries some risk that it will negatively affect the runtime behavior, and for those cases it is usually a judgment call by the project maintainers whether or not it is a SemVer-incompatible change." — verified.
  - [Handling regressions](https://www.kernel.org/doc/html/latest/process/handling-regressions.html) — Linux kernel docs, quoting Linus Torvalds — official docs — 2018-08-03: "whether something was buggy or not DOES NOT MATTER"; 2023-06-02: "once user space depends on kernel bugs, they become features pretty much by definition, however much we might dislike it" — verified with dates.
  - [Hyrum's Law](https://www.hyrumslaw.com/) — Hyrum Wright, site current — practitioner essay — "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody." — verified.
- **Detect:** Build a consumer inventory by hand. A behaviour has external consumers when the project has any of these:
  - A publishable package: package.json without `"private": true`, `[project]` metadata in pyproject, a Cargo `[lib]`.
  - An OpenAPI/GraphQL schema or route files.
  - CLI entry points (`bin`, `console_scripts`).
  - Persisted formats or DB schemas that other programs read.

  For Rust libraries, run `cargo semver-checks`. Grep docs, tests, scripts and the README for literal error messages and exit codes that the pass touches.
- **Tools:** cargo-semver-checks, git grep, ast-grep
- **Applies to:** All languages; most critical for libraries, public APIs and CLIs
- **When not to apply / counterpoints:**
  - The policies genuinely conflict, and nobody defines how many users is "sufficient".
  - The cargo-semver-checks README lists as "areas where cargo-semver-checks currently will not catch semver violations": breaking type changes, generics and lifetimes, and feature-subset breaks. It checks API shape, not runtime behaviour. (Verified in the README.)
  - For a private single-user application, treating every failure-path change as contract would freeze all hardening.
- **Fix risk:** medium

### G102-F08 — Stage changes that make the program stricter when consumers or live data exist: observe or warn first, then enforce with an escape hatch, then remove the hatch
- **Grade:** A · **Verdict:** CORRECTED. The Node.js history quotes were not verbatim in the cited v26.10.0 docs and are replaced below. I added DEP0018 as the earlier warning phase.
- **Rationale:** Platforms that must not break users introduce stricter failure behaviour exactly this way:
  - PEP 479: StopIteration inside generators becomes RuntimeError via a `__future__` import in 3.5, a silent deprecation warning in 3.5, a non-silent warning in 3.6, and the default in 3.7.
  - Node: an unhandled rejection was a deprecation warning (DEP0018) and became a throw by default in v15.
  - Go GODEBUG keeps opt-back-ins for at least 2 years.
  - Kubernetes Pod Security Admission has warn, audit and enforce modes.
  - CSP has a Report-Only header.

  All of this is evidence of the practice, not of how well it works.
- **Evidence:**
  - [PEP 387 – Backwards Compatibility Policy](https://peps.python.org/pep-0387/) — Python, current — standard — "Unless it is going through the deprecation process below, the behavior of an API must not change in an incompatible fashion between any two consecutive releases." "Wait for the warning to appear in at least two minor Python versions…" — verified.
  - [PEP 479](https://peps.python.org/pep-0479/) — Python, 2014 — standard — "An unexpected exception should not result in subtly altered behaviour, but should cause a noisy and easily-debugged traceback." Transition plan: "Python 3.5: Enable new semantics under __future__ import; silent deprecation warning… Python 3.6: Non-silent deprecation warning. Python 3.7: Enable new semantics everywhere." — verified.
  - [Node.js CLI: --unhandled-rejections](https://nodejs.org/api/cli.html) — Node.js v26.10.0 docs, 2026 — official docs — CORRECTED verbatim history: "v15.0.0 Changed default mode to throw. Previously, a warning was emitted." Modes: throw (default), strict, warn, warn-with-error-code ("trigger a warning, and set the process exit code to 1"), none — verified.
  - [Node.js Deprecations](https://nodejs.org/api/deprecations.html) — Node.js v26.10.0 docs — official docs — the staged types (Documentation-only with `--pending-deprecation`, Application, Runtime, End-of-Life) and `--throw-deprecation` are verified; the index also lists "DEP0018: Unhandled promise rejections".
  - [Go GODEBUG](https://go.dev/doc/godebug) — The Go Authors, current — official docs — "we define a new GODEBUG setting that allows individual programs to opt back in to the old behavior." "GODEBUG settings added for compatibility will be maintained for a minimum of two years (four Go releases)." — verified.
  - [Pod Security Admission](https://kubernetes.io/docs/concepts/security/pod-security-admission/) — Kubernetes, current — official docs — enforce: "Policy violations will cause the pod to be rejected."; audit: "…addition of an audit annotation to the event recorded in the audit log, but are otherwise allowed."; warn: "Policy violations will trigger a user-facing warning, but are otherwise allowed." — verified.
  - [Content-Security-Policy-Report-Only](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy-Report-Only) — MDN, current — official docs — "helps to monitor Content Security Policy (CSP) violations and their effects without enforcing the security policies." — verified.
- **Detect:** For every C2/C4 change that makes the program stricter:
  - Check that a mode switch (env var, config key or flag) or a log-only phase exists.
  - Check that warnings go to a channel the owner actually reads.
  - Grep the diff for new `throw`/`raise`/`return Err`/`reject`/validation calls that have no mode check.
- **Tools:** environment/config switch validated at startup (zod / pydantic-settings); structured logging
- **Applies to:** Services with live traffic or data, libraries and CLIs with users; optional for single-user private tools
- **When not to apply / counterpoints:**
  - A warning phase is worthless if nobody reads it. Knight Capital's system sent 97 "Power Peg disabled" emails that staff "generally did not review" (SEC order, verified). That case is only an analogy: the SEC notes those emails were not designed as system alerts, so it was not a deliberate warn phase.
  - Switches add configuration surface and dead code.
  - For a single-user project, a small revertable commit may be a sufficient escape hatch.
- **Fix risk:** medium

### G102-F09 — Without production telemetry, get behavioural evidence by differential execution: parent vs candidate on recorded inputs, noise calibrated by running the parent against itself
- **Grade:** B · **Verdict:** CORRECTED. The GoReplay quote was not in the current README, and the repo has moved and has had no tagged release since 2021. I added the Diffy licence caveat.
- **Rationale:** Diffy compares the candidate with the primary and uses a secondary running the same known-good code to measure noise. Scientist runs control and candidate but always returns the control result, and is safe only on code that does not change data. PatchDiff found divergence in 29.6% of test-passing patches. A solo developer can reproduce this locally with `git worktree` and recorded fixtures.
- **Evidence:**
  - [Diffy README](https://github.com/opendiffy/diffy) — Diffy project (Twitter wrote about it in 2015), repo active (pushed May 2026) — tool docs — multicasts each request to "A **candidate** instance running your new code", "A **primary** instance running your last known-good code", "A **secondary** instance running the same known-good code as the primary"; "Where they don't, your service is exhibiting non-deterministic behavior — Diffy treats that signal as noise." — verified. The README licence badge reads "CC BY NC ND", which matters for commercial use.
  - [Scientist README](https://github.com/github/scientist) — GitHub, MIT, repo active (Sep 2026) — tool docs — "will always return whatever the `use` block returns"; "Scientist is only safe for wrapping methods that aren't changing data." — verified.
  - [GoReplay README](https://github.com/probelabs/goreplay) — GoReplay (moved from buger/goreplay), last push Jan 2026, latest tagged release 1.3.3 (Oct 2021) — tool docs — CORRECTED quote: "GoReplay is an open-source network monitoring tool which can record your live traffic and use it for shadowing, load testing, monitoring and detailed analysis." / "GoReplay increases your confidence in code deployments, configuration and infrastructure changes." The researcher's wording ("…continuously test your system with real data") is not in the current README.
  - [Are "Solved Issues" in SWE-bench Really Solved Correctly? (ICSE 2026)](https://arxiv.org/abs/2503.15223) — Wang, Pradel, Liu — peer-reviewed — "(29.6%) plausible patches induce different behavior than the ground truth patches" — verified.
- **Detect:** For each approved C2/C3 batch:
  1. `git worktree add ../base <base-sha>`.
  2. Run both builds over the same corpus: saved requests, CLI invocations, sample files.
  3. Diff the outputs, errors and exit codes.
  4. Run base against base to measure the noise floor.

  Every diff must map to a behaviour change declared in a commit message. Unexplained diffs block the batch.
- **Tools:** git worktree, snapshot/approval tests, GoReplay, Diffy (mind the licence), GitHub Scientist
- **Applies to:** Services, CLIs, data pipelines; any project whose inputs can be recorded
- **When not to apply / counterpoints:**
  - Edge-path hardening often triggers only on rare inputs that recordings do not contain.
  - Side-effecting paths cannot be dual-run safely.
  - Timestamps, IDs and ordering need normalising.
  - The setup cost is real.
- **Fix risk:** low

### G102-F10 — Every C2 failure-path change needs a test that forces that failure and asserts the new handling, plus a test showing the success path is unchanged
- **Grade:** B · **Verdict:** CORRECTED. The rationale said "most [catastrophic failures] are reproducible by a unit test". Yuan's 77% covers all 198 sampled failures, not only the catastrophic ones.
- **Rationale:** In 58% of the catastrophic failures, simple testing of error-handling code would have caught the fault. Across all sampled failures, 77% could be reproduced by a unit test. Google's June 2025 outage came from a code path that was never exercised with the bad input (blank policy fields). Forcing the failure is the only direct evidence that a hardening change does what it claims.
- **Evidence:**
  - [Simple Testing Can Prevent Most Critical Failures (OSDI 2014)](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf) — Ding Yuan et al., 2014 — peer-reviewed — "in 58% of the catastrophic failures, the underlying faults could easily have been detected through simple testing of error handling code"; "77% of the failures can be reproduced by a unit test" (all failures) — verified.
  - [Google Cloud incident report ow5i3PPK96RduMcb1SsW](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, incident of 12 June 2025 — incident report — "the code path that failed was never exercised during this rollout due to needing a policy change that would trigger the code"; "We will improve our static analysis and testing practices to correctly handle errors and if need be fail open." — verified.
  - [Toxiproxy README](https://github.com/Shopify/toxiproxy) — Shopify, MIT, active (Sep 2026) — tool docs — "Toxiproxy is the tool you need to prove with tests that your application doesn't have single points of failure." Toxics include latency, down, bandwidth, slow_close, timeout, reset_peer, slicer and limit_data; used "in all development and test environments at Shopify since October, 2014" — verified.
- **Detect:** For each C2 commit, list the error branches it changed: catch/except blocks, `if err != nil`, timeout and overflow branches. Run the tests with branch coverage. Every changed error branch must be covered by a test added in the same commit. If a changed branch is not covered, the commit becomes report-only.
- **Tools:** Toxiproxy, test doubles/mocks, branch coverage in the project's test runner
- **Applies to:** All languages; C2 changes
- **When not to apply / counterpoints:**
  - Fault injection is costly for multi-process systems.
  - Mock-based failure tests can pass while the real dependency fails differently.
  - Coverage proves execution, not correct handling.
- **Fix risk:** low

### G102-F11 — Timeouts and retries are C2: derive values from measured latency, know what the timer covers, retry only idempotent calls at one layer with capped jittered backoff, and never lower an existing timeout without approval
- **Grade:** B · **Verdict:** VERIFIED. All AWS quotes are verbatim; the PDF is © 2019. The "covers connection setup and DNS" clause is supported: AWS says there "are also implementations where the timeout doesn't cover all remote calls, like DNS or TLS handshakes".
- **Rationale:** AWS documents three ways timeouts and retries go wrong:
  - Too-low timeouts create retry storms.
  - Retries at several layers multiply load (5 layers × 3 attempts = 243×).
  - Retrying calls with side effects duplicates them.

  Its token-bucket retry limit avoids the "modal behavior" of circuit breakers, which "can be difficult to test". Google's June 2025 remediation adds randomized exponential backoff.
- **Evidence:**
  - [Timeouts, retries, and backoff with jitter](https://d1.awsstatic.com/builderslibrary/pdfs/timeouts-retries-and-backoff-with-jitter.pdf) — Marc Brooker, AWS Builders' Library, 2019 — industry report — the following are verified:
    - "Increased small backend latency leading to a complete outage, because all requests start being retried".
    - "we choose an acceptable rate of false timeouts (such as 0.1%). Then, we look at the corresponding latency percentile on the downstream service (p99.9 in this example)".
    - "If each layer retries independently, the load on the database will increase 243x"; "our best practice is to retry at a single point in the stack".
    - "APIs with side effects aren't safe to retry unless they provide idempotency".
  - [Google Cloud incident report (12 June 2025)](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, 2025 — incident report — "We will audit and ensure our systems employ randomized exponential backoff." — verified.
  - [Ruff S113 request-without-timeout](https://docs.astral.sh/ruff/rules/request-without-timeout/) — Astral, current — official docs — checks `requests`/`httpx` calls that omit `timeout`; the rules index shows no automatic-fix marker — verified.
- **Detect:**
  - Python: `ruff check --select S113`.
  - Grep HTTP/DB client construction for missing timeouts.
  - Grep for nested retry wrappers at more than one layer.
  - Grep for retries around POST/INSERT/payment/send calls.
  - Flag any numeric timeout in the diff that is lower than the previous value.
- **Tools:** ruff (S113), ast-grep, semgrep, Toxiproxy
- **Applies to:** Any code making network, IPC or DB calls
- **When not to apply / counterpoints:**
  - The AWS method assumes latency metrics that a solo developer usually lacks.
  - Legitimately long operations (uploads, batch jobs, streaming) break under blanket timeouts.
- **Fix risk:** high

### G102-F12 — Record the fail mode for every error-path change: closed for authn, authz, integrity and money or data movement; last-known-good or open, with an alert, for non-security enrichment, quota, scoring and config; never flip an existing mode without approval
- **Grade:** B · **Verdict:** VERIFIED. All quotes are verbatim; Cloudflare "Code Orange: Fail Small" is dated 19 Dec 2025. The split by control type is the researcher's synthesis; no source states it. I added a counterpoint showing the security/non-security line is fuzzy even in the cited incident.
- **Rationale:** OWASP 2025 treats failing open on transactions and security controls as a vulnerability class (CWE-636). The biggest recent outages taught the opposite lesson for availability-critical paths: Google's quota checks, and Cloudflare's bot-scoring and config ingestion. Both vendors' remediations ask for isolation, fail-open and sane defaults on those paths. RFC 9413 favours strictness so that faults get attention, but concedes temporary workarounds and denial-of-service concerns.
- **Evidence:**
  - [A10:2025](https://top10.owasp.org/2025/A10_2025-Mishandling_of_Exceptional_Conditions) — OWASP, 2025 — standard — "If you are part way through a transaction of any kind, it is extremely important that you roll back every part of the transaction and start again (also known as failing closed)." Notable CWEs include "CWE-636 Not Failing Securely ('Failing Open')" — verified.
  - [Google Cloud incident report (12 June 2025)](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, 2025 — incident report — "We will modularize Service Control's architecture, so the functionality is isolated and fails open." — verified.
  - [Code Orange: Fail Small](https://blog.cloudflare.com/fail-small-resilience-plan/) — Cloudflare, 19 Dec 2025 — engineering blog — "Instead of panicking, there should have been a sane set of validated defaults which would have allowed traffic to pass through our network"; "we should not have dropped traffic by default. Instead… a more sane default of allowing the traffic to pass with a passable classification." — verified.
  - [Cloudflare outage on December 5, 2025](https://blog.cloudflare.com/5-december-2025-outage/) — Cloudflare, 2025 — incident report — "If a configuration file is corrupt or out-of-range (e.g., exceeding feature caps), the system will log the error and default to a known-good state or pass traffic without scoring, rather than dropping requests." — verified.
  - [RFC 9413: Maintaining Robust Protocols](https://www.rfc-editor.org/rfc/rfc9413.html) — M. Thomson, D. Schinazi, IAB stream, Informational, June 2023 — standard — "Choosing to generate fatal errors for unspecified conditions instead of attempting error recovery can ensure that faults receive attention."; "temporary workarounds following the spirit of the robustness principle might be necessary"; "Stateless protocol endpoints might generate denial-of-service attacks if they send an error message in response to every message" — verified.
- **Detect:**
  - Grep auth and permission code for handlers that return true, allow or `next()`. For example `ast-grep -p 'try { $$$ } catch ($E) { return true }'`, or Python functions named *auth*/*permission*/*allowed* that `return True` in an `except`.
  - Check where authorization middleware sits relative to error handlers.
  - For each changed error branch, check by hand whether it denies, defaults or crashes, and whether that matches the control type.
- **Tools:** ast-grep, semgrep, manual review
- **Applies to:** Services, APIs, trading and financial code, any system with security controls or runtime-loaded config
- **When not to apply / counterpoints:**
  - The sources genuinely conflict.
  - Classifying a control needs judgement. Cloudflare's Bot Management is itself a security feature, yet its own remediation chooses to let traffic pass. Rate limiting is both security and availability.
  - esprehn (HN) notes that an `assert()` in another language would have failed the policy checks too.
- **Fix risk:** high

### G102-F13 — Validate static config once at startup and refuse to start; validate runtime-loaded config before swapping it in, keep last-known-good on failure, and treat internally generated config as untrusted
- **Grade:** B · **Verdict:** VERIFIED. All four sources are verbatim. Shore's config-typo example is split across two PDF columns but is intact.
- **Rationale:** Shore's fail-fast example is a config typo caught at startup, while the previous version is still serving. The 2025 Google and Cloudflare outages were runtime data or config that propagated globally into code that crashed on an unexpected shape. Both remediations treat generated config as user input and prefer known-good defaults. New strict validation of config that was previously accepted needs a warn phase, or a working deployment will refuse to boot.
- **Evidence:**
  - [Fail Fast](https://martinfowler.com/ieeeSoftware/failFast.pdf) — Jim Shore, IEEE Software, 2004 — magazine column — a fail-fast program "stops functioning, saying maxConnections property not found in c:\projects\SuperSoftware\config.properties. The developer slaps his or her forehead and spends 30 seconds fixing the problem." — verified.
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Cloudflare, 2025 — incident report — "thread fl2_worker_thread panicked: called Result::unwrap() on an Err value"; remediation: "Hardening ingestion of Cloudflare-generated configuration files in the same way we would for user-generated input"; "Enabling more global kill switches for features" — verified.
  - [Google Cloud incident report (12 June 2025)](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, 2025 — incident report — "This policy data contained unintended blank fields… exercised the code path that hit the null pointer causing the binaries to go into a crash loop." — verified.
  - [Cloudflare outage on December 5, 2025](https://blog.cloudflare.com/5-december-2025-outage/) — Cloudflare, 2025 — incident report — "We have never before applied a killswitch to a rule with an action of 'execute'"; "attempt to index field 'execute' (a nil value)"; the trigger was a body-parsing change made "while attempting to detect and mitigate an industry-wide vulnerability disclosed this week in React Server Components" — verified.
- **Detect:**
  1. Find the config and data loaders: `process.env`, `os.environ`, `yaml.safe_load`, `serde_json::from_`, `JSON.parse` of files, DB-backed settings.
  2. Separate the startup loaders from reload, refresh and watch paths.
  3. On reload paths, flag `unwrap()`, `expect(`, non-null `!`, unchecked indexing and missing schema validation.
  4. At startup, require a schema (zod/pydantic-settings) that lists every missing key.
- **Tools:** zod, pydantic-settings, clippy (unwrap_used/expect_used), ast-grep
- **Applies to:** Services and bots with config files, env vars, hot-reloaded data or remote settings
- **When not to apply / counterpoints:**
  - Under orchestrators, refusing to start can cause crash loops.
  - Last-known-good can silently run stale config for a long time.
  - Stricter startup validation of previously tolerated config is itself a C4-adjacent change.
- **Fix risk:** medium

### G102-F14 — Any new bound is C2 and must specify and test its overflow behaviour (evict, reject with a typed error, or backpressure), never panic, and be sized from the measured maximum plus headroom
- **Grade:** C · **Verdict:** VERIFIED. The quotes are verbatim. It is correctly graded C: one incident plus adjacent evidence, and no study of what happens when bounds are added.
- **Rationale:** A bound turns unbounded growth into a visible decision:
  - Cloudflare's 200-feature limit sat above normal use (about 60 features), but a doubled feature file met it and hit an `unwrap()`.
  - Yin et al. found that buffer-size fixes are themselves error-prone.
  - OWASP still recommends limits "wherever possible".
- **Evidence:**
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Cloudflare, 2025 — incident report — "Currently that limit is set to 200, well above our current use of ~60 features."; the feature file "doubled in size" — verified.
  - [How Do Fixes Become Bugs? (ESEC/FSE 2011)](https://www.eecg.utoronto.ca/~yuan/papers/fse11.pdf) — Yin et al., 2011 — peer-reviewed — "Fixing buffer overflows by statically increasing the buffer size is still vulnerable to future overflows. Fixing buffer overflows by dynamically allocating memory could introduce null pointer dereference bugs if the allocated memory is used without check." — verified.
  - [A10:2025](https://top10.owasp.org/2025/A10_2025-Mishandling_of_Exceptional_Conditions) — OWASP, 2025 — standard — "add rate limiting, resource quotas, throttling, and other limits wherever possible" — verified.
- **Detect:** Grep the diff for `maxsize|max_size|capacity|MAX_|limit|bounded|LRU|page_size|maxBodyLength|highWaterMark`. For each hit:
  - Locate the overflow branch.
  - Check it has a test.
  - Check it has no `unwrap`/`expect`/assert/`panic`/unhandled `throw`.
  - Record the measured maximum and the headroom in the commit body.
- **Tools:** grep/ripgrep, ast-grep, clippy (unwrap_used)
- **Applies to:** Caches, queues, in-memory collections, pagination, file and request size limits
- **When not to apply / counterpoints:**
  - Without telemetry, the "measured maximum" is a guess. Cloudflare had about 3.3× headroom and still exceeded it.
  - Rejecting on overflow can surface as user-visible errors where silent growth used to "work".
- **Fix risk:** medium

### G102-F15 — Convert panics, unwraps and non-null assertions to handled errors only for values from outside the process; leave real invariant unwraps alone; panic to Result in a public library API is C4
- **Grade:** C · **Verdict:** VERIFIED. All quotes are verbatim; the burntsushi post is dated 8 Aug 2022. I added Clippy's `allow-unwrap-types` as a refinement.
- **Rationale:** Rust's API-evolution RFC leaves panic to Err unresolved. burntsushi holds that panics signal bugs and are fine for invariants, not for error handling. The Cloudflare unwrap was on a Result derived from externally generated data, which is exactly the case to target. Converting to Result without a handler only moves the crash.
- **Evidence:**
  - [Using unwrap() in Rust is Okay](https://burntsushi.net/unwrap/) — Andrew Gallant, 8 Aug 2022 — practitioner blog — "If a Rust program panics, then it signals a bug in the program. That is, correct Rust programs don't panic." / "Panicking should not be used for error handling in either applications or libraries." — verified.
  - [RFC 1105: API Evolution](https://rust-lang.github.io/rfcs/1105-api-evolution.html) — Rust project, 2015 — standard — the unresolved question quoted in F07 — verified.
  - [Clippy lint configuration](https://doc.rust-lang.org/clippy/lint_configuration.html) — Rust project, current — official docs — `allow-unwrap-in-tests`: "Whether unwrap should be allowed in test functions or #[cfg(test)]" (default false; affects `unwrap_used`); `allow-expect-in-tests` likewise affects `expect_used`; `allow-unwrap-types` (e.g. `std::sync::LockResult`) exempts chosen types — verified. The last option was added by the verifier.
  - [Cloudflare outage on November 18, 2025](https://blog.cloudflare.com/18-november-2025-outage/) — Cloudflare, 2025 — incident report — "called Result::unwrap() on an Err value" — verified.
- **Detect:**
  1. Rust: `cargo clippy -- -W clippy::unwrap_used -W clippy::expect_used`, with `allow-unwrap-in-tests = true` and `allow-expect-in-tests = true` in clippy.toml.
  2. Other languages: grep for Kotlin `!!`, TS/Swift postfix `!`, and `assert` on input data.
  3. Trace each hit back to its source. Only values that come from I/O, config, network or users become findings.
  4. Confirm that a caller boundary handles the new error.
- **Tools:** clippy (unwrap_used, expect_used), ast-grep, grep/ripgrep
- **Applies to:** Rust primarily; Kotlin, Swift, TS non-null assertions, and asserts on external data
- **When not to apply / counterpoints:**
  - HN practitioners split. jjice says failing hard may be right "if it was the kind of situation that could revert itself (like an incremental rollout)". burntsushi says "If you're using `slice[i]`, then you're using `unwrap()`." (both verified)
  - A Result with no sane recovery can hide the bug that a panic would have surfaced.
- **Fix risk:** medium

### G102-F16 — Map commit conventions to change classes (NFC for C1; `fix:` plus a behaviour note and `Fixes:` for C2/C3; `!` plus `BREAKING CHANGE:` for C4)
- **Grade:** B (was A) · **Verdict:** DOWNGRADED. Each cited convention is real and quoted verbatim. However, no source prescribes the class-to-convention mapping, the mandatory "Behavior change:" paragraph, or putting NFC inside a Conventional Commits subject. Those are local conventions, so the rule as a whole is a well-grounded synthesis, not an established practice.
- **Rationale:**
  - Conventional Commits ties `fix` to PATCH, and `!`/`BREAKING CHANGE:` to MAJOR.
  - LLVM puts NFC in the first line so reviewers see it without opening the commit.
  - Linux's `Fixes:` links a fix to the commit that introduced the bug.

  A label that asserts "no functional change" makes misclassification checkable (see F01).
- **Evidence:**
  - [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) — conventionalcommits.org — standard — "a commit of the type fix patches a bug in your codebase (this correlates with PATCH in Semantic Versioning)"; "a commit that has a footer BREAKING CHANGE:, or appends a ! after the type/scope, introduces a breaking API change (correlating with MAJOR in Semantic Versioning)". Other types are allowed; "@commitlint/config-conventional (based on the Angular convention) recommends build:, chore:, ci:, docs:, style:, refactor:, perf:, test:" — verified.
  - [Submitting patches: Fixes tag](https://www.kernel.org/doc/html/latest/process/submitting-patches.html) — Linux kernel docs, current — official docs — "If your patch fixes a bug in a specific commit, e.g. you found an issue using git bisect, please use the 'Fixes:' tag with at least the first 12 characters of the SHA-1 ID, and the one line summary." — verified.
  - [LLVM Lexicon: NFC](https://llvm.org/docs/Lexicon.html) — LLVM Project, current — official docs — "Usually used in the first line, so it is visible without opening the actual commit email." — verified.
- **Detect:**
  - Run commitlint with the conventional config.
  - Fail any `fix:` commit that has no behaviour note.
  - Fail any `refactor:`/NFC commit that has removed or changed test lines or error-path literals (use the line-level check from F01).
- **Tools:** commitlint, `git log --format`, `git interpret-trailers`
- **Applies to:** All repositories the hardening pass touches
- **When not to apply / counterpoints:**
  - The user's global rules forbid AI attribution trailers. `Fixes:` and `BREAKING CHANGE:` are content trailers, not attribution.
  - Linux uses `Fixes:` only when the introducing commit is known. For long-standing latent bugs, reference the finding id instead.
- **Fix risk:** low

### G102-F17 — Follow shipping AI review and fix tools: behaviour-changing fixes are suggestions that need acceptance, pre-existing bugs never block, and cleanup-only passes are kept apart from bug hunting. Auto-apply C1 only, apply C2/C3 on approval, report C4
- **Grade:** B · **Verdict:** CORRECTED. The GitHub URL now redirects to "Application card: GitHub security and quality AI features", and the "No test output changes" quote was not verbatim. I added a Claude Code history note: the bug-finding command was called `/simplify` before v2.1.147 and applied fixes by default, and is now `/code-review`, which applies fixes only with `--fix`.
- **Rationale:** GitHub's Copilot Autofix docs warn that its fixes can change semantics and require explicit developer acceptance. Anthropic's managed Code Review:
  - never approves or blocks, and its check run "always completes with a neutral conclusion";
  - tags pre-existing bugs separately;
  - keeps `/simplify` (cleanup only, applies fixes) apart from `/code-review` (bug finding, applies fixes only with `--fix`).

  CodeRabbit is the outlier: it delivers changes "even if verification fails". In a pass over a finished project, every finding is pre-existing.
- **Evidence:**
  - [Application card: GitHub security and quality AI features](https://docs.github.com/en/code-security/responsible-use/security-and-quality-ai-features) — GitHub Docs, current (the old `responsible-use-autofix-code-scanning` URL 301-redirects here) — official docs — the following are verified:
    - "Semantic errors: The system may suggest fixes that are syntactically valid but change the semantics of the program."
    - "The system may suggest fixes that fail to remediate the underlying vulnerability or introduce new vulnerabilities."
    - The test harness uses "over 2,300 alerts", and one check is "Has the fix changed the output of any of the repository tests?" (CORRECTED from the paraphrase).
    - "Human-in-the-loop review: Copilot Autofix presents all suggestions as proposed code changes that require explicit developer review and acceptance before being applied."
  - [Code Review](https://code.claude.com/docs/en/code-review) — Anthropic (Claude Code docs), 2026 — official docs — "🟣 Pre-existing — A bug that exists in the codebase but was not introduced by this PR"; "Findings are tagged by severity and don't approve or block your PR"; "/simplify runs a separate cleanup-only review that applies fixes without hunting for bugs"; `--fix`: "applies the findings to your working tree after the review"; "The command was named /simplify before v2.1.147, when it applied fixes by default." — verified.
  - [CodeRabbit Autofix](https://docs.coderabbit.ai/finishing-touches/autofix) — CodeRabbit, current — official docs — triggered by `@coderabbitai autofix` (or `… stacked pr`); "Even if verification fails, the generated changes are still delivered so you can continue iterating."; "CodeRabbit either pushes a commit to the current branch or opens a stacked PR" — verified. The researcher's quoted fragments were close paraphrases.
- **Detect:** Process check. The skill's output lists each finding with a class (C1-C4) and a gate. Only C1 items may appear in the auto-applied commit set. Any C2-C4 item applied without a recorded approval is a violation.
- **Tools:** ReportFindings-style findings list; git
- **Applies to:** AI-agent hardening passes on any codebase
- **When not to apply / counterpoints:**
  - Vendor docs describe their own products and are not independent evidence of what is optimal.
  - Approval fatigue turns per-item approval into rubber-stamping, so batch by failure mode.
- **Fix risk:** low

### G102-F18 — In a hardening pass, keep error strings, error types, exit codes, output bytes and ordering unchanged unless the change is approved as C4; when wrapping errors, keep the original as the cause
- **Grade:** C · **Verdict:** CORRECTED. Two sources were replaced with better ones:
  - The LWN SubscriberLink became the free canonical article (Jonathan Corbet, 2 Feb 2023).
  - The Go "Hyrum's law" comment is now verified in the Go source (`src/net/http/request.go`) instead of relying only on a third-party blog.
- **Rationale:** Hyrum's law shows up concretely in these fields:
  - Go's standard library freezes the text of an error message.
  - GitHub reverted a Git upgrade about 2 hours after archive checksums changed, even though the tarballs' contents were unchanged.
  - Linux treats relied-upon buggy behaviour as a feature.
  - Windows 95 kept a SimCity use-after-free working.

  Error-handling hardening often rewrites messages and types, and those are observable.
- **Evidence:**
  - [Git archive generation meets Hyrum's law](https://lwn.net/Articles/921787/) — Jonathan Corbet, LWN.net, 2 Feb 2023 — journalism — "the checksums for tarballs generated on the fly abruptly changed"; brian m. carlson: "we've never guaranteed stable checksums for archives"; "it took about two hours" before GitHub said "we're reverting the change, and we'll communicate better about such changes in the future" — verified.
  - [Go source: net/http/request.go](https://github.com/golang/go/blob/master/src/net/http/request.go) — The Go Authors, current — primary source — `func (e *MaxBytesError) Error() string { // Due to Hyrum's law, this text cannot be changed. return "http: request body too large" }` — verified in the raw file. It is also reported by [Abenezer Belachew, 9 Nov 2024](https://www.abenezer.ca/blog/hyrum-law-in-golang) (verified).
  - [Handling regressions](https://www.kernel.org/doc/html/latest/process/handling-regressions.html) — Linux kernel docs (Torvalds 2023-06-02) — official docs — "once user space depends on kernel bugs, they become features pretty much by definition, however much we might dislike it" — verified.
  - [How Microsoft Lost the API War](https://www.joelonsoftware.com/2004/06/13/how-microsoft-lost-the-api-war/) — Joel Spolsky, 13 Jun 2004 — practitioner blog — SimCity "used memory right after freeing it", so Windows 95 "added special code that checked if SimCity was running, and if it did, ran the memory allocator in a special mode in which you could still use memory after freeing it." — verified.
- **Detect:**
  - Grep the diff for modified (not only added) string literals inside `throw|raise|Error\(|errors\.New|fmt\.Errorf|panic\(|log\.(error|warn)`.
  - Flag changed exit codes (`exit(`, `process.exit(`, `sys.exit(`), changed serialization or sort order, and renamed exception classes that callers catch.
  - Grep tests, scripts and docs for the old message text.
- **Tools:** git diff, ast-grep, grep/ripgrep
- **Applies to:** Libraries, CLIs (exit codes, stderr), APIs (error bodies), anything whose output is parsed
- **When not to apply / counterpoints:**
  - A private single-user app may have no consumer of message text, and clearer messages are part of hardening.
  - The practical line is who parses the output, which needs F07's inventory.
- **Fix risk:** medium

### G102-F19 — New enforcement code on a critical path ships behind a new, never-reused flag with a documented default; test both states, set a removal date, never repurpose a flag, and delete dead code
- **Grade:** B · **Verdict:** CORRECTED. The Feature Toggles article was first published in Jan-Feb 2016; 09 Oct 2017 is only a later revision. The SEC order quotes are verified in the order PDF (Release 34-70694, 16 Oct 2013).
- **Rationale:** Google's 2025 outage came from new quota-check code that was not flag-protected. Its remediation makes flags mandatory and "disabled by default" for critical binaries. Knight Capital's $460M loss came from a repurposed flag that reactivated dead code on the one server the new deployment missed. Hodgson describes flags as inventory with a carrying cost that doubles the test matrix. For a low-risk solo project, "default on with a kill switch" is the researcher's adaptation, not what Google prescribes.
- **Evidence:**
  - [Google Cloud incident report (12 June 2025)](https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW) — Google Cloud, 2025 — incident report — "the issue with this change was that it did not have appropriate error handling nor was it feature flag protected."; "We will enforce all changes to critical binaries to be feature flag protected and disabled by default." — verified.
  - [SEC Order: In the Matter of Knight Capital Americas LLC (Release 34-70694)](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 16 Oct 2013 — regulatory order — the following are verified:
    - "orders sent with the repurposed flag to the eighth server triggered the defective Power Peg code still present on that server".
    - "approximately 45 minutes"; "Knight realized a $460 million loss".
    - Knight lacked controls "to prevent the activation of code no longer intended for use".
    - "Knight's system sent 97 of these e-mail messages… Knight did not design these types of messages to be system alerts, and Knight personnel generally did not review them".
  - [Feature Toggles (aka Feature Flags)](https://martinfowler.com/articles/feature-toggles.html) — Pete Hodgson, martinfowler.com, 2016 (revised 09 Oct 2017) — practitioner article — "Savvy teams view their Feature Toggles as inventory which comes with a carrying cost, and work to keep that inventory as low as possible."; test "in both states: with the toggle flipped On and flipped Off." — verified.
- **Detect:**
  - Run `git log -S '<flag_name>'` to catch reused flag names.
  - List flags with no removal date or tracking issue.
  - Check that each flag the pass introduces has tests for both states.
  - Code reachable only through a flag that is permanently off is dead code; hand it to the dead-code findings.
- **Tools:** `git log -S`, grep/ripgrep, config schema (zod/pydantic-settings)
- **Applies to:** Services and trading/financial systems; optional for small single-user tools
- **When not to apply / counterpoints:**
  - For a solo finished project, flags can cost more complexity than the risk justifies. A small revertable commit plus a redeploy may be the better escape hatch.
  - Every flag added becomes future cleanup work.
- **Fix risk:** medium

## Practitioner voice

I fetched every URL (HN comments through the Algolia items API), and every quote below appears in the source.

- [jjice, HN, 19 Nov 2025](https://news.ycombinator.com/item?id=45981274) (thread: "Cloudflare outage on November 18, 2025 post mortem"): "Should a system as critical as the CF proxy fail hard? I don't know. I'd say yes if it was the kind of situation that could revert itself (like an incremental rollout)… it feels like there should've been better logging, deployment, rollback, and parsing/validation capabilities, no matter what the `unwrap`/`Result` option is." — verified.
- [burntsushi, HN, 20 Nov 2025](https://news.ycombinator.com/item?id=45994308) (same thread): "If you're using `slice[i]`, then you're using `unwrap()`. It introduces a panicking branch." / "You use `unwrap()` when you know the failure cannot happen." — verified. It was written as a rebuttal to a "correct code never unwraps" position.
- [esprehn, HN, 14 Jun 2025](https://news.ycombinator.com/item?id=44276338) (thread: "Google Cloud Incident Report – 2025-06-13"; he says he works on Cloud but not on this service): "The code was tested, but not this edge case… it could have just as likely been an assert() in another language making all the requests fail policy checks as well… making sure all policy checks are flag guarded, that all quota policy checks fail open, and that db changes roll out slowly region by region." — verified.
- [kyrra, HN, 14 Jun 2025](https://news.ycombinator.com/item?id=44276128): "There was testing, just not for the bad input (the blank fields in the policy)… just that a flag would have caught it." — verified.
- [mkl95, HN, 14 Jun 2025](https://news.ycombinator.com/item?id=44276065): "The product guy needs the new feature enabled for everyone, and he needs it yesterday. Suggestions of feature flagging are ignored outright." — verified. The researcher dropped "The" and "he needs it yesterday".
- [rkagerer, HN, 14 Jun 2025](https://news.ycombinator.com/item?id=44275849): "All the tools to prevent it were there (feature flags, null handling, basic static analysis tools). Someone just didn't know to use them." — verified.
- [burntsushi, HN, 26 Sep 2024](https://news.ycombinator.com/item?id=41658991) (thread: "Git-absorb"): he splits refactors from behaviour changes so that reviewers do not have to "mentally separate 'okay this change is just refactoring, so no behavior changes' and 'okay this part is where the behavioral change is.'"; "Most of my PRs should be read as a sequence of changes, and not as one single diff." — verified.
- [kazinator, HN, 15 Feb 2022](https://news.ycombinator.com/item?id=30351557) (thread: "The harmful consequences of the robustness principle", the IAB draft that became RFC 9413): "For anything that is multiply implemented and has many dependencies, the robustness principle is deadly in the long run." — verified. The counter-view is [phkahler, same thread](https://news.ycombinator.com/item?id=30330839): "I think robustness is good. But. There needs to be a way to validate your output against a strict spec." — verified; its id was located by the verifier.
- [jcranmer, HN, 14 Feb 2022](https://news.ycombinator.com/item?id=30333751): "Having worked on the email side of things, the problems mentioned here are exactly as painful there as it is for HTTP." He adds that the robustness principle "has often been taken to mean that implementors must try to scavenge as much understanding as possible from flagrant violations of the specification." — verified.
- [LWN: Git archive generation meets Hyrum's law](https://lwn.net/Articles/921787/) (canonical URL replaces the SubscriberLink): GitHub reverted a Git 2.38 upgrade about two hours after tarball checksums changed — verified.
- [Marc Brooker, AWS](https://d1.awsstatic.com/builderslibrary/pdfs/timeouts-retries-and-backoff-with-jitter.pdf): a timeout "set very low, to around 20 milliseconds" fired after deployments because the timer included establishing a new secure connection. The first fix was to raise the timeout when a connection had to be established; later, connections were opened at process start "but before receiving traffic" — verified.
- [SEC order on Knight Capital (2013)](https://www.sec.gov/litigation/admin/2013/34-70694.pdf): a repurposed flag reactivated Power Peg code on the eighth server; $460M loss in about 45 minutes; 97 unreviewed emails — verified (see F19 for the "not designed as alerts" nuance).
- [Cloudflare, 2 July 2019](https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/): the guard was "removed by mistake during a refactoring of the WAF weeks prior", and the process "allowed a non-emergency rule change to go globally into production without a staged rollout" — verified.
- [Joel Spolsky, 2004](https://www.joelonsoftware.com/2004/06/13/how-microsoft-lost-the-api-war/): Windows 95 special-cased SimCity's use-after-free — verified.

## Contradictions and open questions

**Contradictions (all verified as genuine disagreements between sources):**

1. **Behaviour frozen vs hardening changes behaviour.** This is resolved by class: only C1 is frozen. The sources themselves disagree on bug fixes:
   - Go and SemVer permit fixing a bug that dependents rely on. SemVer says to use judgement and possibly bump the major version.
   - Linux forbids user-visible regressions, "whether something was buggy or not DOES NOT MATTER". Its practice is still to land clean fixes and revert them if real users regress (Torvalds 2023-06-02).
   - Cargo and RFC 1105 leave it to judgement, and panic to Err is unresolved.
2. **Fail-fast or fail-closed vs fail-open or last-known-good.** OWASP A10 and RFC 9413 favour strictness. Google (June 2025) and Cloudflare (Nov/Dec 2025) move availability-critical paths to fail-open or known-good, including Cloudflare's own Bot Management, which is a security feature. Shore says "a crash is never appropriate" and pairs fail-fast with a global handler. The resolution (decide by control type and by timing) is a synthesis that no single source states.
3. **"Tests unmodified" vs "a fix needs a test".** Existing assertions are frozen and new tests are required. Google explicitly allows "new or updated tests", so the freeze is stricter than any cited policy.
4. **Un-swallowing errors vs over-eager aborts.** Yuan et al. list empty or log-only handlers (25% of catastrophic failures) and aborts on over-caught exceptions (8%) as failure patterns side by side.
5. **The unwrap debate after Cloudflare Nov 2025.** burntsushi and esprehn argue that the panic was not the root cause; the root cause was bad config propagating globally with no last-known-good.
6. **Flags as risk control vs flags as debt.** Google says protect with flags and disable by default. Hodgson (carrying cost) and Knight (a repurposed flag reactivated dead code) show flags as a hazard.
7. **AI tool defaults differ.** GitHub and Anthropic require acceptance and never block. CodeRabbit delivers changes "even if verification fails". Anthropic's own bug-finding command applied fixes by default before v2.1.147 and now needs `--fix`.
8. **How strongly "fixes are riskier" replicates.** Śliwerski found 23.7% vs 8.1% in Eclipse but 45.2% vs 38.1% in Mozilla. Purushothaman & Perry report "nearly 40%", Yin 14.8-24.4% (a lower bound), and Gu "as much as 9% of all bugs". The direction is consistent; the magnitude varies widely and the definitions differ.

**Open questions:**

- No study measures the net effect of a proactive failure-path hardening pass on a working system.
- All fix-risk data comes from 2005-2012 C/Java systems. The comparison of an AI agent to a fixer who "never touched the file" (Yin's 27%) is an analogy, not a measured result.
- The Gu et al. (ICSE 2010) and Bavota et al. (SCAM 2012) gaps listed by the researcher are now partly closed: bad fixes are up to 9% of all bugs, and hierarchy refactorings "tend to induce faults very frequently". Both were verified only through their OpenAlex abstracts, so C1 is lower-risk but not risk-free.
- There is no sourced method for sizing timeouts and limits without telemetry.
- There is no sourced threshold for when a small project's consumers (scripts, bots) turn a C2 change into a C4 change.
- Whether a warn-then-enforce phase means anything for a solo developer with no log monitoring. Knight is suggestive but only analogous.
- Practitioner voice is dominated by HN. No r/ExperiencedDevs, Software Engineering Stack Exchange or Lobsters perspectives were gathered.

## Dropped findings

None. All 19 findings survive: 7 verified as written, 11 corrected (quote precision, wrong denominators, updated URLs, publication status, a detection-command bug), and 1 downgraded (F16, A to B, because its central convention is unsourced).
