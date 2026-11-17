# Real-world experience with cleanup and refactoring passes
> Code T30 · slug cleanup-practice-forums · verified 2026-09-23 · counts: verified 10 / corrected 8 / downgraded 1 / dropped 0

## Summary

**How the sources were checked.** WebSearch was unavailable during both the research pass and this verification pass (the session had used its search budget). Every source was therefore opened directly:

- Web pages were fetched with WebFetch or plain HTTP and searched for the exact quoted text.
- PDFs were converted to text with `pdftotext` and searched: the SEC Knight Capital order and Sadowski et al. 2018.
- Peer-reviewed abstracts were rebuilt from OpenAlex `abstract_inverted_index` records. Preprint abstracts came from the arXiv export API.
- Hacker News comments came from the official HN Firebase API and HN Algolia. For each one, the author, date and parent story were checked.
- Red Hat Bugzilla comments came from its REST API.
- The Google Testing Blog article on Sensenmann was downloaded over HTTP and is now cited as a primary source.
- Tool status came from GitHub pages, and `gh api` where the rate limit allowed.

Reddit, Software Engineering StackExchange and Lobsters could not be reached, so practitioner voice leans on Hacker News.

**Main conclusions after verification.**

1. **The biggest risk in a cleanup pass is an accidental change in behaviour.**
   - Rachatasumrit & Kim (ICSM 2012; JMeter, XMLSecurity, ANT): only 22% of refactored methods and fields were tested by existing regression tests. Refactorings were 8% of atomic changes, yet "38% of affected tests are relevant to refactorings" and "refactorings are involved in almost half of the failed test cases". *Correction: the researcher's "38% of failure-inducing changes" is not what the abstract says.*
   - Refactorings that involve hierarchies (e.g. pull-up method) "tend to induce faults very frequently" (Bavota et al. 2012; three Java systems).
   - LLM-proposed refactorings were unsafe in 13 of 176 cases (ChatGPT) and 9 of 137 (Gemini) (Liu et al., *Automated Software Engineering* 32(1), 2025).
   - On a benchmark of whole-repository migrations, only 28 of 520 agent runs (5.4%) passed all three stages (SWE Refactor Bench, 2026 preprint). This measures migrations, not small cleanups.
2. **Separation and small size are the best-sourced controls.**
   - Google's review guide, LLVM's DeveloperPolicy and the Linux netdev docs all ask for structural or formatting changes to be kept apart from functional change.
   - At Google the median change modifies 24 lines. The review guide calls 100 lines "usually a reasonable size" and 1000 "usually too large", and adds that there are "no hard and fast rules".
   - Tangled commits corrupt history-based analyses: up to 15% of bug fixes in five Java projects were tangled (Herzig & Zeller 2013).
   - In agent patches, tangled refactorings are "strongly associated with reduced compilability" but show "no significant association with functional correctness" (Tian et al. 2026, preprint).
3. **"Unused" is a claim that needs proof.**
   - Knight Capital left "Power Peg" code "present and callable" and repurposed its activation flag. One of eight servers missed the deploy. About 4 million executions happened in about 45 minutes, and Knight "ultimately" lost more than $460M.
   - Atlassian's script to delete a legacy app was given site IDs and deleted 883 sites (775 customers).
   - Meta's SCARF combines a static graph, runtime usage from logs and a text search as a fallback.
   - Google's Sensenmann uses execution logs of binaries as its liveness signal. It does not treat test runs as liveness, and it keeps a blocklist for exceptions.
4. **Hyrum's Law sets the limits of cleanup.**
   - glibc's backwards-copying memcpy was legal under the spec but broke Flash audio. Linus measured and found no clear speed gain, then asked "What's the upside?"
   - Excel keeps the 1900 leap-year behaviour on purpose.
   - Go randomizes internals so that nobody can come to depend on them.
5. **A cleanup must not turn into a rewrite.** Sources: Spolsky (2000) and Fowler's Strangler Fig (updated 2024-08-22). Sonos's 2024 "clean slate" app shipped with features missing, and revenue fell 16% in fiscal Q4 2024; the link to the app is journalistic attribution, not a measurement. The agent benchmarks show agents dropping behaviour or copying the old code.
6. **Cosmetic churn has real costs: blame pollution and merge conflicts.** Official guidance disagrees on the remedy:
   - Django DEP 0008 and Black's author on HN favour one repo-wide formatter commit that blame is told to skip.
   - LLVM and netdev discourage standalone cleanup of code nobody is changing.
7. **Evidence on tech-debt sprints and the boy-scout rule is anecdotal and split.** Practitioners report these constraints as working:
   - small, pre-triaged items with a per-item cap;
   - a timebox;
   - hotspot prioritization (the CodeScene "1.2% of code, 45% of bugs" figure is a single vendor example, not a study);
   - ratchets that stop regression.

## Findings

### T30-F01 — Never mix cleanup with behaviour change
**Rule.** Each cleanup commit contains exactly one kind of change: format-only, move/rename-only, dead-code deletion, or one named refactoring. Label it NFC (no functional change) and order it before any functional change. A bug discovered during the pass gets its own commit, with a test that shows the bug.

- **Grade:** A · **Verdict:** VERIFIED. Two nuances were added from the sources:
  - Google explicitly allows trivial cleanups inside a feature CL.
  - The agent study found no significant link between tangling and functional correctness, only with compilability.
- **Rationale:** Google, LLVM and kernel guidance all require structural and functional changes to be separable. Mixing them hides what changed and complicates merges and rollbacks. Tangled commits add noise to history-based analyses.
- **Evidence:**
  - [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) — Google, current — official docs
    - Quotes: "It's usually best to do refactorings in a separate CL from feature changes or bug fixes. For example, moving and renaming a class should be in a different CL from fixing a bug in that class." Also: "Small cleanups such as fixing a local variable name can be included inside of a feature change or bug fix CL, though."
    - Verified verbatim (HTML grep).
  - [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google, current — official docs
    - Quote: "The author of the CL should not include major style changes combined with other changes. It makes it hard to see what is being changed in the CL, makes merges and rollbacks more complex, and causes other problems."
    - Verified.
  - [LLVM Developer Policy](https://llvm.org/docs/DeveloperPolicy.html) — LLVM Project, current — official docs
    - Quotes: "try to separate formatting or whitespace changes from functional changes, either by correcting the format first (ideally) or afterward." and "Such changes should be highly localized and the commit message should clearly state that the commit is not intended to change functionality, usually by stating it is NFC."
    - Verified.
  - [The impact of tangled code changes](https://doi.org/10.1109/msr.2013.6624018) — Herzig & Zeller, MSR 2013 — peer reviewed
    - From the abstract: "In an investigation of five open-source Java projects, we found up to 15% of all bug fixes to consist of multiple tangled changes... on average at least 16.6% of all source files are incorrectly associated with bug reports."
    - Abstract confirmed via OpenAlex; full paper not read.
  - ["Refactoring Runaway"](https://arxiv.org/abs/2605.22526) — Tian, Zhang, Xiao, Wang, Kondo, Chen, Kamei, submitted 2026-05-21 — preprint
    - From the abstract: 3,691 patches on Multi-SWE-bench (3 agent frameworks, 12 LLMs). Agents tangle refactorings less than humans (21.43% vs 36.72%). Tangled refactorings "are strongly associated with reduced compilability, while exhibiting no significant association with functional correctness". The authors' refinement "improves compilability from 19.34% to 38.33%".
    - Verified via the arXiv API.
- **Detect:**
  1. `git show --stat <sha>`: the message names exactly one change type.
  2. Format-only commits: `git diff -w <sha>^ <sha>` is empty, or re-running the formatter on the parent reproduces the commit.
  3. Move/rename-only commits: `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change <sha>^ <sha>` shows only moved blocks.
  4. `git rebase -x '<build && test>' <base>` checks that every commit builds and passes on its own.
  5. A commit labelled NFC does not change test assertions (grep the test/spec diff for assert/expect lines). This is a heuristic.
- **Tools:** git diff -w, git diff --color-moved, git rebase -x, CI
- **Applies to:** all languages and repositories; cleanup by humans or AI agents.
- **When not to apply / counterpoints:**
  - Fowler's opportunistic refactoring encourages tidying inline while working.
  - Splitting into separate PRs has real overhead: "the hours wasted by my team in using stacked PRs to separate Boy Scout rule changes to the code from the feature is just abnormal" (HN 33711309, wirrbel, 2022, verified).
  - For a solo, finished project, separate commits inside one PR are usually enough.
  - Google allows trivial cleanups inline, counts deletion of an entire file "as being just one line of change", and accepts CLs from "an automatic refactoring tool that you trust completely".
- **Fix risk:** low

### T30-F09 — Freeze all externally observable behaviour during a cleanup pass
**Rule.** On public or exported interfaces, treat these as frozen: return and iteration order, error types and messages, null/empty handling, default serialization, side-effect order and timing, log and CLI output, exit codes and schemas. Changing any of them is a behaviour change, not a refactor. It needs its own commit and a changelog entry, and for libraries it follows SemVer (deprecate in a minor release, remove in a major one).

- **Grade:** A · **Verdict:** VERIFIED
- **Rationale:** Hyrum's Law: every observable behaviour will be depended on by somebody. Spec-legal but observable changes break real users, and mature products keep known "bugs" rather than break dependents.
- **Evidence:**
  - [Hyrum's Law](https://www.hyrumslaw.com/) — Hyrum Wright — other (named observation)
    - Quote: "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody."
    - Verified.
  - [Software Engineering at Google, Ch. 1](https://abseil.io/resources/swe-book/html/ch01.html) — Winters, Manshreck, Wright (O'Reilly, 2020; free official HTML) — book
    - Quotes: "Per Hyrum's Law, programmers will write programs that depend on the order in which a hash table is traversed, if they have the ability to do so." Even randomized order gets used "as an inefficient random-number generator". Also: "If you liked it, you should have put a CI test on it" (the Beyoncé Rule).
    - Verified verbatim.
  - [Red Hat Bugzilla 638477](https://bugzilla.redhat.com/show_bug.cgi?id=638477) — "Strange sound on mp3 flash website", filed 2010-09-29 — incident report
    - glibc's optimized memcpy copied backwards, which the spec allows, and broke Flash, which relied on overlapping copies.
    - Linus, comment 40 (2010-11-08): "I have yet to hear the actual _reason_ for making the change to memcpy. We know what the downside is. What's the upside?"
    - Linus, comment 46: he measured it and found "glibc wasn't any faster than my trivial version... we know the glibc change resulted in problems for real users. We do _not_ know that it helped anything at all."
    - Linus, comment 101: "just alias memcpy() to memmove()".
    - Verified via the REST API.
  - [Excel incorrectly assumes that the year 1900 is a leap year](https://learn.microsoft.com/en-us/troubleshoot/microsoft-365-apps/excel/wrongly-assumes-1900-is-leap-year) — Microsoft Learn, ms.date 2026-03-30 — official docs
    - Quote: "Although it is technically possible to correct this behavior so that current versions of Microsoft Excel do not assume that 1900 is a leap year, the disadvantages of doing so outweigh the advantages."
    - The listed disadvantages: almost all dates would decrease by one day, WEEKDAY results would change, and serial-date compatibility would break. The behaviour started as Lotus 1-2-3 compatibility.
    - Verified.
  - [Semantic Versioning 2.0.0](https://semver.org/) — semver.org — standard
    - Rule 8: "Major version X (X.y.z | X > 0) MUST be incremented if any backward incompatible changes are introduced to the public API."
    - FAQ: "there should be at least one minor release that contains the deprecation".
    - Verified.
  - [HN comment on "Hyrum's Law in Golang"](https://news.ycombinator.com/item?id=42202326) — FiloSottile (Filippo Valsorda; "I wrote the crypto/rsa comments"), 2024-11-21 — practitioner forum
    - Go uses MaybeReadByte "to avoid having our algorithm locked in". "Iterating over a map uses a randomized order to avoid exposing the internals." "The output of rand.Rand is considered part of the compatibility promise".
    - Verified.
  - [HN comment on a Spring upgrade](https://news.ycombinator.com/item?id=34196523) — Ygg2, 2022-12-31 — practitioner forum
    - A Spring upgrade changed the default so that null fields were written. Only the services that relied on null fields being omitted broke: "Fix was easy but finding the bug was difficult."
    - Verified.
- **Detect:**
  - Enumerate the public surface: exports, routes, CLI flags and output, schemas, environment variables, log formats.
  - Before the pass, snapshot outputs with golden or approval tests (F10).
  - `git diff base...HEAD | grep -E '^-\s*(export |pub |public |module\.exports)'` finds removed or renamed exports.
  - For each changed public function, manually check ordering, error text, null/empty handling and defaults against the snapshot.
- **Tools:** git diff, golden/snapshot tests, the ecosystem's API-diff tools
- **Applies to:** libraries, services with external clients, CLIs and file formats. For a private app with all callers in one repo, the observable surface is its UI, API and stored data.
- **When not to apply / counterpoints:**
  - Private code whose callers all live in one repo can change if every caller is updated atomically.
  - Ecosystems that randomize internals reduce the risk.
  - Linus's position was pragmatic: a measured lack of upside against a real downside. Others in the thread argued the change was meant to make memcpy faster "*on little processors*" (comment 98, davidsen) and "ought to be" faster (comment 43, jakub). The principle was contested, not unanimous.
- **Fix risk:** high

### T30-F02 — Keep every cleanup change reviewable and individually revertible
**Rule (corrected).** Aim for about 100 hand-written changed lines per commit or PR, and treat about 1000 as too large (Google). Review at most about 200–400 LOC per sitting (SmartBear/Cisco). Treat more than about 400 hand-edited lines, or many files, as a signal to split the change or to regenerate it with a reviewed script (F03). This is a heuristic, not a hard limit. Each commit must be revertible on its own.

- **Grade:** A for the principle; the numeric thresholds are heuristics · **Verdict:** CORRECTED
  1. The quote "Easier to roll back" is actually "**Simpler to roll back.**"
  2. The researcher's hard rule ("must be split" above 400 lines or 10 files) is not sourced. Google says "There are no hard and fast rules about how large is 'too large'... it's up to the judgment of your reviewer". "About 90% modify fewer than 10 files" describes Google's changes; it is not a limit.
  3. The SmartBear numbers come from a vendor summary of one Cisco study.
- **Rationale:** Useful review feedback declines as changes grow, and small changes are easier to roll back.
- **Evidence:**
  - [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) — Google, current — official docs
    - Quotes: "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large, but it's up to the judgment of your reviewer."; "A 200-line change in one file might be okay, but spread across 50 files it would usually be too large."; "Simpler to roll back."; "reviewers have discretion to reject your change outright for the sole reason of it being too large."
    - Verified verbatim (HTML grep).
  - [Modern Code Review: A Case Study at Google](https://sback.it/publications/icse2018seip.pdf) — Sadowski, Söderberg, Church, Sipko, Bacchelli, ICSE-SEIP 2018 — peer reviewed
    - About 9 million changes, January 2014 to July 2016. Quotes: "about 90% modify fewer than 10 files... the median number of lines modified is 24"; "developers are strongly encouraged to make small, incremental changes (with the exception of large deletions and automated refactoring)."
    - Verified in the PDF text.
  - [Characteristics of Useful Code Reviews](https://doi.org/10.1109/msr.2015.21) — Bosu, Greiler, Bird, MSR 2015 — peer reviewed
    - About 1.5 million review comments from five Microsoft projects. Quote: "the more files that are in a change, the lower the proportion of comments in the code review that will be of value to the author of the change."
    - Abstract via OpenAlex.
  - [Best Practices for Code Review](https://smartbear.com/learn/code-review/best-practices-for-peer-code-review/) — SmartBear (review-tool vendor), undated — industry report
    - Quotes: "developers should review no more than 200 to 400 lines of code (LOC) at a time"; "a significant drop in defect density at rates faster than 500 LOC per hour". Based on a Cisco team study.
    - Verified. Treat as indicative.
  - [Netdev maintainer process](https://docs.kernel.org/process/maintainer-netdev.html) — Linux kernel, current — official docs
    - Quote: "Avoid sending series longer than 15 patches. Larger series takes longer to review as reviewers will defer looking at it until they find a large chunk of time."
    - Verified.
- **Detect:**
  - `git log --shortstat base..HEAD`: flag hand-written commits over about 400 changed lines, or spread over many files (`git show --name-only --format= <sha> | wc -l`), unless the message records a generating command (F03).
  - `git revert --no-commit <sha>` applies cleanly for each commit.
- **Tools:** git log --shortstat, git revert
- **Applies to:** every project that uses review, including review of an AI agent's output.
- **When not to apply / counterpoints:**
  - Some changes cannot reasonably be split. "Sometimes you have a large change, and you can't reasonably split that up... We have tests to give us confidence" (HN 30680304, Aeolun, 2022, verified).
  - Google exempts whole-file deletions and trusted automated refactorings.
  - Too many tiny patches also frustrate reviewers: Simon Tatham's "The Catch-22" antipattern ("if there are lots of little patches, then some of them make no sense on their own!"), from [Code review antipatterns](https://www.chiark.greenend.org.uk/~sgtatham/quasiblog/code-review-antipatterns/), 2024-08-21, a satirical essay. Verified.
- **Fix risk:** low

### T30-F04 — Isolate formatting-only changes and register them in .git-blame-ignore-revs
**Rule.** Put formatting-only changes in one isolated, formatter-generated commit. After it lands on the main branch, add its full 40-character SHA, with a comment, to `.git-blame-ignore-revs` at the repo root. Document `git config blame.ignoreRevsFile .git-blame-ignore-revs`. Never mix semantic edits into that commit. Add the SHA only after merge, because squash or rebase merges change it.

- **Grade:** A · **Verdict:** VERIFIED
  - Django's DEP names the file "``.gitblameskip`` or similar". The `.git-blame-ignore-revs` name is the GitHub/GitLab convention.
  - The "add after merge" step is sound reasoning, but no source states it.
  - The GitLab version conflict between sources is resolved in favour of GitLab's own docs.
- **Rationale:** Cosmetic churn pollutes blame and breaks in-flight branches. git, GitHub and GitLab all support an ignore list, but it only helps if the commit is purely mechanical and its SHA is stable.
- **Evidence:**
  - [git-blame](https://git-scm.com/docs/git-blame) — Git project, docs as of 2.53.0 — official docs
    - `--ignore-rev`: "Ignore changes made by the revision when assigning blame, as if the change never happened."
    - `blame.ignoreRevsFile`: "one unabbreviated object name per line... Whitespace and comments beginning with `#` are ignored."
    - Verified.
  - [git 2.52.0 release notes](https://raw.githubusercontent.com/git/git/master/Documentation/RelNotes/2.52.0.adoc) — Git project — official docs
    - Quote: "Configuration variables that take a pathname as a value (e.g. blame.ignorerevsfile) can be marked as optional by prefixing ':(optional)' before its value."
    - This allows a global `git config --global blame.ignoreRevsFile ':(optional).git-blame-ignore-revs'`.
    - Verified. It also confirms [Nesbitt, "Git's Magic Files"](https://nesbitt.io/2026/02/05/git-magic-files.html) (2026-02-05).
  - [Viewing and understanding files](https://docs.github.com/en/repositories/working-with-files/using-files/viewing-and-understanding-files) — GitHub Docs, current — official docs
    - Create `.git-blame-ignore-revs` in the repository root. Full SHAs are required, and comments are supported. Limitation: "If the commit was the last to modify a line, it will still appear in blame."
    - Verified.
  - [Git blame](https://docs.gitlab.com/user/project/repository/files/git_blame/) — GitLab Docs, current — official docs
    - "Introduced in GitLab 17.10 with a feature flag named `blame_ignore_revs`. Disabled by default." Then "Generally available in GitLab 17.11."
    - Verified. **Contradicts** nesbitt.io's "GitLab (15.4+)".
  - [DEP 0008: Formatting code with Black](https://github.com/django/deps/blob/main/final/0008-black.rst) — Django (Aymeric Augustin), created 2019-04-27, Final — official docs
    - Quote: "Run Black on the entire Django code repository and make a single commit". The DEP says the change is fully automated with nothing to review, and records the SHA in "``.gitblameskip`` or similar, for use with ``git blame``'s ``--ignore-revs-file`` flag".
    - Verified in the raw .rst.
  - [Converting a Git repo from tabs to spaces](https://eev.ee/blog/2016/06/04/converting-a-git-repo-from-tabs-to-spaces/) — Eevee, 2016-06-04 — engineering blog
    - Quotes: "Rebasing an inflight branch will not work, or more precisely will produce a zillion merge conflicts"; the workaround `git rebase -Xrenormalize origin/master`; "`git blame -w` ignores whitespace-only changes."
    - Verified.
- **Detect:**
  - List candidate commits with `git log --format='%H %s' | grep -iE 'format|prettier|black|clang-format|whitespace|lint'`. Each must be listed in `.git-blame-ignore-revs`.
  - For whitespace-only commits, `git diff -w <sha>^ <sha>` is empty.
  - Each listed SHA exists: `git cat-file -e <sha>`.
- **Tools:** git blame --ignore-revs-file, git diff -w, formatters (black, prettier, clang-format, gofmt, rustfmt)
- **Applies to:** all git repositories; mandatory when a formatter is first introduced or its configuration changes.
- **When not to apply / counterpoints:**
  - LLVM and netdev discourage formatting-only changes in code nobody is changing (F05).
  - Local blame needs the config on every clone (or the `:(optional)` global setting); the forges read the file automatically.
  - In-flight branches still conflict.
- **Fix risk:** low

### T30-F08 — Remove dead code and stale flags; never repurpose a flag
**Rule.** Remove dead code and stale feature flags instead of leaving them present and callable in production. Never repurpose an existing flag, config key or enum value for new behaviour; introduce a new name. After deleting, verify that the deletion reached every deployment target.

- **Grade:** B (was A) · **Verdict:** DOWNGRADED
  - The facts are authoritative (SEC order), but the flag-reuse lesson rests on one incident.
  - The supporting dead-code study (Romano et al.) is based on interviews and four experiments at two universities, and only its abstract was read.
  - Precision fixes:
    - What happened "in approximately 45 minutes" was the 4 million executions. The loss was "ultimately" more than $460 million, from the unwanted positions.
    - The SEC order also blames missing deployment review and controls, not dead code alone.
- **Rationale:**
  - At Knight, code that had been unused for years stayed callable, and a new release repurposed its activation flag. One of eight servers did not get the new code, and no second technician reviewed the deployment.
  - In 2005 Knight had also reused part of that code elsewhere "without taking measures to safeguard against malfunctions". Dead code became dangerous during a later refactor.
  - Uber notes that stale-flag code can be triggered unexpectedly.
- **Evidence:**
  - [SEC Order, Knight Capital Americas LLC, Release No. 34-70694](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — U.S. SEC, 2013-10-16 — incident report
    - Quotes: "Despite the lack of use, the Power Peg functionality remained present and callable at the time of the RLP deployment."; "The new RLP code also repurposed a flag that was formerly used to activate the Power Peg code."; "one of Knight's technicians did not copy the new code to one of the eight SMARS computer servers. Knight did not have a second technician review this deployment".
    - Consequences: "For the 212 incoming parent orders... 4 million executions in 154 stocks for more than 397 million shares in approximately 45 minutes"; "Ultimately, Knight lost over $460 million from these unwanted positions".
    - History: "in 2003, Knight elected to leave the Power Peg code on SMARS's production servers, and, in 2005, accessed this code to use the cumulative quantity functionality in another application without taking measures to safeguard against malfunctions".
    - Verified in the PDF text.
  - [Piranha](https://www.uber.com/blog/piranha/) — Uber Engineering (Barik, Ramanathan, Sridharan, Clapp), 2020-03-17 — engineering blog
    - Stale-flag code "might still be made executable in unexpected cases (e.g. due to a flag management backend error), reducing the overall reliability".
    - Verified. The date is 2020, not "2019/2020".
  - [A Multi-Study Investigation into Dead Code](https://doi.org/10.1109/tse.2018.2842781) — Romano, Vendome, Scanniello, Poshyvanyk, IEEE TSE 2018 — peer reviewed
    - Method: interviews plus "four experiments at the University of Basilicata and the College of William & Mary". Findings: "dead code is harmful" in "the maintenance and evolution phases"; "developers should avoid this smell."
    - Abstract via OpenAlex.
- **Detect:**
  1. Flags: list every flag read (`rg -n 'isEnabled\(|getFlag\(|featureFlag|FEATURE_'`) and compare it with the flag store. Flags pinned at 0% or 100% for N weeks without a kill-switch annotation are candidates.
  2. Unreachable code: compiler warnings, vulture at 100% confidence, `if (false)`, `#if 0`, blocks that are commented out.
  3. Repurposing: run `git log -S'<key>'` on every flag or config key read by new code. A hit with a different older meaning is a violation.
  4. Deployment: check the build hash or version endpoint on every host.
- **Tools:** ripgrep, git log -S, compiler warnings, vulture, a feature-flag audit, Piranha. The repo is not archived; it is now "PolyglotPiranha", and the legacy per-language versions are kept only as a tag.
- **Applies to:** all languages; any system with feature flags, config switches or multiple deployment targets.
- **When not to apply / counterpoints:**
  - Some "stale" flags are deliberate kill switches. Uber: "we wish to keep the feature flag guarding that functionality in the code to act as a safety kill-switch".
  - Deletion is itself a deployment that can fail partially.
- **Fix risk:** medium

### T30-F07 — Delete "dead" code only with two independent proofs
**Rule.** Require two independent proofs before deleting code:

- **Static:** no references in the dependency graph, with dynamic entry points configured.
- **Dynamic:** no runtime use over a window long enough to cover periodic jobs, from logs, telemetry or endpoint metrics. Test executions do not count as runtime use.

Also:

- Run a text search for string references.
- Send each deletion to the code's owner.
- Give intentionally dormant code an explicit exemption.
- Treat low-confidence tool output (for example vulture's 60% items) as leads, not verdicts.

- **Grade:** B · **Verdict:** CORRECTED
  - The primary Sensenmann article was retrieved and added.
  - HN item IDs were fixed: the "owner must approve" quote is Xorlev (35757299), not UncleMeat.
  - Piranha's date was fixed to 2020.
  - The "deleted code is hard to rediscover" counterpoint was re-attributed to Jimmy Koppel's review. The HN commenter who quoted it disagreed with it.
- **Rationale:** Dead-code removal at industrial scale works when static and dynamic evidence are combined and false positives are triaged. The tool authors themselves warn that static analysis both misses dead code and flags live code in dynamic languages.
- **Evidence:**
  - [Automating dead code cleanup (SCARF)](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) — Meta Engineering (Shackleton, Pincombe, Cohn-Gordon), 2023-10-24 — engineering blog
    - Quotes: "SCARF combines static and dynamic analysis"; the graph uses "usage of API endpoints from operational logs"; "automatically deleted more than 100 million lines of code in over 370,000 change requests"; "False-positives caught by engineers during code review are triaged".
    - BigGrep text search is a "fallback safety mechanism".
    - Verified.
  - [Sensenmann: Code Deletion at Scale](https://testing.googleblog.com/2023/04/sensenmann-code-deletion-at-scale.html) — Phil Norman, Google Testing Blog, 2023-04-28 — engineering blog
    - Scale: "It submits over 1000 deletion changelists per week, and has so far deleted nearly 5% of all C++ at Google."
    - Liveness: "a log entry is written when a program runs... If a program hasn't been used for a long time, we try sending a deletion changelist". Example given: "last used over a year ago". "we cannot use test runs as a 'liveness' signal".
    - Exceptions: "it's important to have a blocklisting system so that exceptions can be marked".
    - Verified (HTML download).
  - [HN thread on Sensenmann](https://news.ycombinator.com/item?id=35755841) — 2023-04-29 — practitioner forum
    - Xorlev ([35757299](https://news.ycombinator.com/item?id=35757299)): "the owner of the code (a committer to that directory hierarchy) must approve it, so it's rare there's ever a false deletion".
    - UncleMeat ([35757030](https://news.ycombinator.com/item?id=35757030)): "'This code has been dead for six months' is a very good heuristic... I do occasionally reject the sensenmann CLs, but only very very rarely."
    - lrem ([35760804](https://news.ycombinator.com/item?id=35760804)): a "stop the robot uprising" button whose code "looks dead for all intents and purposes" was exempted by adding a comment.
    - All verified via the HN API.
  - [Piranha](https://www.uber.com/blog/piranha/) — Uber Engineering, 2020-03-17 — engineering blog
    - "around two thousand stale feature flags" removed; staleness is "surprisingly non-trivial"; an example heuristic of 8 weeks.
    - Verified.
  - [Vulture README](https://github.com/jendrikseipp/vulture) — Jendrik Seipp, current — official docs
    - Quote: "Due to Python's dynamic nature, static code analyzers like Vulture are likely to miss some dead code. Also, code that is only called implicitly may be reported as unused."
    - Confidence levels: 60% for attributes, classes, functions and variables; 100% for unreachable code and unused arguments. `--min-confidence 100` means "guaranteed to be unused within the analyzed files".
    - Verified.
  - [Knip: Handling Issues](https://knip.dev/guides/handling-issues) — Knip, current — official docs
    - Dynamic import specifiers are not resolved, so add those files to `entry`. Work top-down: unused files first. "Hiding a result is not the same as resolving it."
    - Verified.
- **Detect:**
  - Python: `vulture <pkg> --min-confidence 100` for certain items; 60–90% items need a runtime check.
  - JS/TS: `knip`, with entry and config hints fixed first.
  - Compiled languages: unused and unreachable-code warnings.
  - Runtime: access logs or metrics for the route, job or handler over at least one full business cycle.
  - Text: `rg -n --hidden '<symbol>'`.
  - Every deletion commit cites both kinds of evidence.
- **Tools:** vulture, knip, compiler warnings, ripgrep, production logs/telemetry, Piranha (flags)
- **Applies to:** all languages. Mandatory for exported or public symbols, HTTP routes, jobs, CLI commands and feature flags.
- **When not to apply / counterpoints:**
  - A finished project without telemetry cannot supply the dynamic proof. Restrict deletions to findings that compilers or tools report with certainty.
  - "Unused in this repo" does not mean unused by consumers of a library (F09).
  - Jimmy Koppel, in his [review of "Tidy First?"](https://www.pathsensitive.com/2024/04/book-review-tidy-first.html) (2024-04-01, verified), has "started to turn against" deleting unused code on the grounds that it is recoverable from version control. The HN commenter who quoted him (39902393) disagreed: "every line of code is a liability".
- **Fix risk:** medium

### T30-F10 — Pin behaviour with tests before touching it
**Rule.** If the code to be refactored is not executed by any test, first add characterization (golden-master) tests that record its current behaviour, bugs included, or record and replay real inputs and outputs. Refactor only on green. If behaviour cannot be pinned, do not refactor that code in this pass.

- **Grade:** B · **Verdict:** CORRECTED. The Rachatasumrit & Kim figures were misreported. The abstract says:
  - refactorings were 8% of atomic changes;
  - "38% of affected tests are relevant to refactorings";
  - "refactorings are involved in almost half of the failed test cases".
  It does **not** say "38% of failure-inducing changes".
- **Rationale:** Refactored code is often untested, and in the one available study refactorings account for a disproportionate share of test failures. Characterization tests document actual behaviour, not intended behaviour.
- **Evidence:**
  - [An Empirical Investigation into the Impact of Refactoring on Regression Testing](https://doi.org/10.1109/icsm.2012.6405293) — Rachatasumrit & Kim, ICSM 2012 — peer reviewed
    - Quote: "The results on three open source projects, JMeter, XMLSecurity, and ANT, show that only 22% of refactored methods and fields are tested by existing regression tests. While refactorings only constitutes 8% of atomic changes, 38% of affected tests are relevant to refactorings. Furthermore, refactorings are involved in almost half of the failed test cases."
    - Abstract via OpenAlex. The open-access PDF (UT repository) returned 403.
  - [Characterization Testing](https://michaelfeathers.silvrback.com/characterization-testing) — Michael Feathers, 2016-08-08 — engineering blog
    - Quotes: "the purpose of characterization testing is to document your system's actual behavior, not check for the behavior you wish your system had."; "When a system goes into production, in a way, it becomes its own specification."
    - Verified.
  - [Opportunistic Refactoring](https://martinfowler.com/bliki/OpportunisticRefactoring.html) — Martin Fowler, 2011 — engineering blog
    - Quote: "do remember that you should only refactor when your tests are green."
    - Verified.
  - [Refactoring Malapropism](https://martinfowler.com/bliki/RefactoringMalapropism.html) — Martin Fowler, 2004-01-03 — engineering blog
    - Quotes: "Refactoring is a very specific technique, founded on using small behavior-preserving transformations"; "If somebody talks about a system being broken for a couple of days while they are refactoring, you can be pretty sure they are not refactoring."
    - Verified verbatim.
- **Detect:**
  - Run coverage restricted to the changed lines. Any changed line that no test executes is a violation, unless the commit is a proven dead-code deletion.
  - Each refactor commit names the tests that pin the behaviour it touches.
  - Golden files predate the refactor: `git log --diff-filter=A -- <golden>`.
- **Tools:** coverage.py, c8/istanbul, JaCoCo, `go test -cover`, approval/golden tests
- **Applies to:** all languages; most valuable for legacy or AI-generated code with thin tests.
- **When not to apply / counterpoints:**
  - Coverage does not prove behaviour is pinned, because tests may not assert anything.
  - Characterization tests lock in bugs on purpose.
  - HN pushback on Spolsky: missing paths are "a problem with testing rather than migration" (39559994, verified).
  - Google's LSC tooling ignores "recently flaky tests".
- **Fix risk:** low

### T30-F03 — Generate large mechanical changes with deterministic tools
**Rule.** Produce large mechanical changes with a deterministic tool: IDE refactoring, codemod, formatter, or a linter's `--fix`. Record the exact command in the commit message. Review the tool or script plus a sample of its output, and never hand-edit inside the generated commit. When an LLM proposes a refactoring, re-apply it with a deterministic engine where one exists.

- **Grade:** B · **Verdict:** VERIFIED
  - Liu et al. is no longer only a preprint: it was published in *Automated Software Engineering* 32(1), 2025, so its type is now peer reviewed.
  - The "never hand-edit inside the generated commit" part is reasoning that follows from reproducibility, not a quoted rule.
- **Rationale:** Google generates almost all large-scale changes with tools and reviews them with pattern-based tooling. LLM-applied refactorings are measurably unsafe, and detecting then re-applying them through tested engines reduces the risk. A recorded command lets anyone check that the commit contains nothing else.
- **Evidence:**
  - [Software Engineering at Google, Ch. 22: Large-Scale Changes](https://abseil.io/resources/swe-book/html/ch22.html) — Hyrum Wright (chapter author), in Winters/Manshreck/Wright, O'Reilly 2020 — book (free official HTML)
    - Quotes: "LSCs at Google are almost always generated using automated tooling."; "if a change requires more than 500 edits, it's usually more efficient for an engineer to learn and execute our change-generation tools rather than manually execute that edit."; "global reviewers use a separate set of pattern-based tooling to review each of the changes and automatically approve ones that meet their expectations."
    - Verified verbatim.
  - [An Empirical Study on the Potential of LLMs in Automated Software Refactoring](https://arxiv.org/abs/2411.04444) — Bo Liu, Yanjie Jiang, Yuxia Zhang, Nan Niu, Guangjie Li, Hui Liu; 2024 preprint, published in *Automated Software Engineering* 32(1), 2025 — peer reviewed
    - Quote: "13 out of the 176 solutions suggested by ChatGPT and 9 out of the 137 solutions suggested by Gemini were unsafe in that they either changed the functionality of the source code or introduced syntax errors". The authors propose RefactoringMirror, a "detect-and-reapply tactic", using "thoroughly tested refactoring engines".
    - Verified.
  - [DEP 0008](https://github.com/django/deps/blob/main/final/0008-black.rst) — Django, 2019 — official docs
    - A single fully automated Black commit with nothing to review.
    - Verified.
  - [HN comment on "The High-Risk Refactoring"](https://news.ycombinator.com/item?id=39737464) — keybored, 2024-03-17 — practitioner forum
    - He committed step by step so that tools could verify each step ("Like line moves: verify with `git diff --color-moved`"). Ideally, reviewers "can look at the script, see if it is reasonable, then run it themselves and verify that it produces the same output".
    - Verified. Re-running a script was his stated ideal, not what he reports having done.
- **Detect:**
  - Flag hand-authored commits with more than about 500 edits (Google's rule of thumb) and no recorded command. The file-count cut-off is a heuristic.
  - To verify a recorded command: `git checkout <sha>^ && <cmd> && git diff --exit-code <sha>`.
- **Tools:** git, formatters, codemods / IDE refactoring engines, `linter --fix`
- **Applies to:** all languages; repo-wide renames, API migrations and autofix runs.
- **When not to apply / counterpoints:**
  - Generators can be wrong too. Google even ignores "recently flaky tests" when submitting LSCs through its tooling.
  - IDE refactorings in dynamic languages are not guaranteed to be safe.
- **Fix risk:** medium

### T30-F05 — Do not polish stable code that nobody is changing; prioritise hotspots
**Rule.** Rank files by change frequency (last 6–12 months) times complexity or poor health, and spend refactoring effort on the top of that list. In cold files, limit the pass to proven dead-code removal and genuine bug or security fixes. No style-only or "modernize the syntax" edits there.

- **Grade:** B · **Verdict:** CORRECTED
  - The CodeScene figure (hotspots were 1.2% of the codebase, 12.5% of effort and 45% of bugs) is **one example in vendor documentation**, not a study result.
  - Code Red (Tornhill & Borg) measures *code health* against defects and time using CodeScene's own tooling. It does not measure churn. Its results are correlational and vendor-affiliated, although it was accepted at TechDebt 2022.
  - The "don't polish cold code" part rests on official guidance (netdev, LLVM, PEP 8) and is well supported.
- **Rationale:** Standards bodies discourage standalone cosmetic cleanups because churn costs more than it returns. Vendor data suggests effort and defects concentrate in frequently changed, unhealthy code.
- **Evidence:**
  - [Netdev maintainer process: Clean-up patches](https://docs.kernel.org/process/maintainer-netdev.html) — Linux kernel, current — official docs
    - Quotes: "Netdev discourages patches which perform simple clean-ups, which are not in the context of other work"; "This is because it is felt that the churn that such changes produce comes at a greater cost than the value of such clean-ups."
    - Verified.
  - [LLVM Developer Policy](https://llvm.org/docs/DeveloperPolicy.html) — LLVM, current — official docs
    - Quote: "Avoid committing formatting- or whitespace-only changes outside of code you plan to make subsequent changes to."
    - Verified.
  - [PEP 8](https://peps.python.org/pep-0008/) — PSF, current — standard
    - A listed reason to ignore a guideline: "Because the code in question predates the introduction of the guideline and there is no other reason to be modifying that code." Also: "do not break backwards compatibility just to comply with this PEP!"
    - Verified.
  - [Hotspots](https://codescene.io/docs/guides/technical/hotspots.html) — CodeScene (vendor), current — official docs
    - Quotes: "Low code health in a development hotspot is expensive. Prioritize improvements here"; "Low code health in stable parts of the codebase, i.e. non-hotspots, has lower priority."
    - The 1.2% / 12.5% / 45% example is present on the page.
    - Verified.
  - [Code Red: The Business Impact of Code Quality](https://arxiv.org/abs/2203.04374) — Tornhill & Borg, TechDebt 2022 — peer reviewed (vendor-affiliated)
    - 39 proprietary codebases, 30,737 files. Quotes: "15 times more defects"; "124% more time in development".
    - Verified via the arXiv abstract. Correlational.
- **Detect:**
  - Churn: `git log --since='12 months ago' --format= --name-only | sort | uniq -c | sort -rn | head -50`.
  - Join the churn list with a complexity metric.
  - Flag non-functional edits (style, syntax modernization, renames) to files outside the top of the churn×complexity list.
- **Tools:** git log, complexity analyzers (linter complexity rules, CodeScene, SonarQube or equivalent)
- **Applies to:** mature codebases with history. Weak for a just-finished project whose churn is thin or uniform.
- **When not to apply / counterpoints:**
  - Churn data may be meaningless in a new project.
  - Boy-scout advocates argue that deferring cleanup compounds its cost:
    - German Velasco, ["Refactoring has a price. Not refactoring has a cost. Either way, you pay."](https://www.germanvelasco.com/blog/refactoring-is-a-habit) (2023-10-20, verified).
    - jillesvangurp (HN [37970107](https://news.ycombinator.com/item?id=37970107), verified): "waiting to refactor has an exponentially higher cost the longer you wait".
  - Security flaws in cold code must still be fixed.
  - Black's author prefers one global reformat to piecemeal style edits (see the contradictions).
- **Fix risk:** low

### T30-F11 — Verify high-stakes refactors differentially
**Rule.** On high-stakes paths (money, auth, data transformation, merge/sync logic), run the old and new implementations on the same inputs. Use offline replay of recorded traffic, or a Scientist-style production experiment that always returns the old result. Investigate every mismatch before switching over and deleting the old code.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Unit tests miss real input distributions. GitHub's differential runs found latent bugs in the old path and performance problems in the new one.
- **Evidence:**
  - [Move Fast and Fix Things](https://github.blog/engineering/engineering-principles/move-fast/) — Vicent Martí, GitHub, 2015-12-15 — engineering blog
    - Quotes: "Scientist verified tens of millions of merge commits to be virtually identical in the old and new paths"; "768 conflicts were being reported as 0 by the shell, because 768 is a multiple of 256!"; users "always receive the result of the old code".
    - The summary: "we've fixed 2 serious merge-related bugs in the original Git implementation which had gone undetected for years, and 3 major performance issues in the new implementation."
    - It depended on deploying "more than 60 times in a day".
    - Verified (HTML grep).
  - [Online migrations at scale](https://stripe.com/blog/online-migrations) — Jacqueline Xu, Stripe, 2017-02-02 — engineering blog
    - Scientist is used "to run experiments and compare the results of two different code paths, alerting you if two expressions ever yield different results in production."
    - Verified.
  - [HN comment on "The High-Risk Refactoring"](https://news.ycombinator.com/item?id=39739015) — sweezyjeezy, 2024-03-17 — practitioner forum
    - Quote: "pull all of the data going in and out of a system for a time period, and rerun it after the refactor. This gave me a lot more confidence than unit tests."
    - Verified.
- **Detect:** List the pass's refactored functions on critical paths. Each needs a corpus of recorded or representative inputs, run through the base version (via a git worktree) and through HEAD, with the outputs compared. No corpus means no refactor on that path.
- **Tools:** Scientist (Ruby; its README lists community ports for Python, .NET, Java, Go, JS and others, so check a port's maintenance before adopting it), a record/replay harness, git worktree
- **Applies to:** code with deterministic or comparable outputs. Code with side effects needs a shadow or read-only mode.
- **When not to apply / counterpoints:**
  - It needs infrastructure; GitHub's approach relied on very frequent deploys.
  - Code with side effects cannot simply be run twice.
  - Small finished projects will mostly use offline replay.
- **Fix risk:** low

### T30-F12 — Extra scrutiny for fault-prone refactoring types
**Rule.** Give extra scrutiny to hierarchy changes (pull up/push down, changing base classes), Extract Method on files other branches are editing, and renames of widely used symbols. Put each in its own commit, late in the pass, with tests that exercise every subclass or override. Avoid them while other branches are in flight.

- **Grade:** B · **Verdict:** VERIFIED. Wording fix: the source says hierarchy refactorings "tend to induce faults very frequently", not "most often".
- **Rationale:** Refactoring types differ in risk. Hierarchy refactorings frequently induce faults, and Extract Method is especially problematic for merges.
- **Evidence:**
  - [When Does a Refactoring Induce Bugs?](https://doi.org/10.1109/scam.2012.20) — Bavota, De Carluccio, De Lucia, Di Penta, Oliveto, Strollo, SCAM 2012 — peer reviewed
    - Method: 15,008 refactorings of 52 kinds in Ant, Xerces and ArgoUML, detected with Ref-Finder, manually validated and analysed with SZZ.
    - Quote: "while some kinds of refactorings are unlikely to be harmful, others, such as refactorings involving hierarchies (e.g., pull up method), tend to induce faults very frequently."
    - Abstract via OpenAlex.
  - [Are Refactorings to Blame?](https://doi.org/10.1109/saner.2019.8668012) — Mahmoudi, Nadi, Tsantalis, SANER 2019 — peer reviewed
    - Almost 3,000 Java repositories and 15 refactoring types. Quotes: "refactoring operations are involved in 22% of merge conflicts"; "EXTRACT METHOD, tend to be more problematic for merge conflicts"; conflicts involving refactored code "are usually more complex".
    - Abstract via OpenAlex.
  - [Opportunistic Refactoring](https://martinfowler.com/bliki/OpportunisticRefactoring.html) — Fowler, 2011 — engineering blog
    - Quote: "when people are working with feature branches, they are discouraged from opportunistic refactoring because it makes merges more difficult - particularly if the branches live longer than a couple of days."
    - Verified.
- **Detect:**
  - Tag each commit with its refactoring type.
  - Grep the diff for hierarchy edits (`extends |implements |super\(|override `).
  - Before starting, run `git branch -r --no-merged main` and `git diff --name-only main...<branch>` for each branch. Defer Extract Method and renames on files those branches touch.
- **Tools:** git diff, git branch --no-merged, a refactoring detector (optional)
- **Applies to:** OO codebases for hierarchy changes; any team repo for merge conflicts.
- **When not to apply / counterpoints:**
  - The evidence covers only Java.
  - SZZ attribution is noisy.
  - Merge-conflict risk is irrelevant for a solo finished project with no open branches.
- **Fix risk:** medium

### T30-F13 — Never turn a cleanup pass into a rewrite
**Rule.** Improve incrementally behind the existing interface (strangler fig): build the new implementation next to the old one, show parity (F10, F11), switch traffic, then delete the old one. Never delete-and-replace a module or app in one step. Do not accept a "simpler" replacement until every behaviour of the original is accounted for.

- **Grade:** B · **Verdict:** VERIFIED
  - The Sonos revenue decline and CEO exit are reported by MacRumors as consequences; the causal share of the app is not measured. The source type is news, not an incident report.
  - Andy Pennell's role at Sonos is not stated in the roundup.
- **Rationale:** Old code embeds years of undocumented bug fixes. Clean-slate rewrites lose them. Coding agents drop behaviour or copy old code to pass tests.
- **Evidence:**
  - [Things You Should Never Do, Part I](https://www.joelonsoftware.com/2000/04/06/things-you-should-never-do-part-i/) — Joel Spolsky, 2000-04-06 — engineering blog
    - Quotes: "Old code has been used. It has been tested. Lots of bugs have been found, and they've been fixed."; "Each of these bugs took weeks of real-world usage before they were found."; "you are throwing away all that knowledge".
    - Verified.
  - [Strangler Fig Application](https://martinfowler.com/bliki/StranglerFigApplication.html) — Martin Fowler, updated 22 August 2024 — engineering blog
    - Quote: "Replacements seem easy to specify, but often it's hard to figure out the details of existing behavior. What's worse, much of that behavior is stuff that isn't really wanted..."
    - Verified.
  - [Sonos CEO Steps Down Following Disastrous App Redesign](https://www.macrumors.com/2025/01/13/sonos-ceo-steps-down-after-app-redesign/) — Hartley Charlton, MacRumors, 2025-01-13 — news
    - The rollout "was marred by widespread technical issues and the removal of features such as sleep timers, alarms, and key accessibility options". Revenue fell 16% in fiscal Q4 2024, and the stock fell about 13%. Patrick Spence stepped down.
    - Verified.
  - [Sonos Apologizes for App Redesign](https://mjtsai.com/blog/2024/07/26/sonos-apologizes-for-app-redesign/) — Michael Tsai, 2024 — link roundup
    - Quoting Andy Pennell: "Sonos threw out all of the old app code, a 'clean slate' approach, replacing the front-end (the UX everyone loves to hate) and also the back-end".
    - Verified.
  - [SWE Refactor Bench](https://arxiv.org/abs/2608.23564) — Deyao Hong et al., submitted 2026-08-24 — preprint
    - Quotes: agents "copy the original implementation to make tests pass. We call this Blindness"; "only 28 of 520 runs (5.4%) pass all three stages". Among the 340 runs that pass the Migration Audit, "58% reach 99% of the fixed checks, yet only 26% reach 100%". Agents score 31.4 on build toolchain rewrites and 5.6 on language rewrites.
    - Verified via the arXiv API. This covers whole-repo migrations, so it is indirect for small cleanups.
  - [HN comment on "AI changes the economics of software rewrites"](https://news.ycombinator.com/item?id=48850481) — jerf, 2026-07-09 — practitioner forum
    - Quote: "at least Opus 4.5 does like to sand off the edges and drop use cases without necessarily drawing it to your attention". He lined up old and new code "to ensure that I could figure out where every line of code in the original ended up in the rewrite", and wrote shared tests that both code bases could run.
    - Verified.
- **Detect:**
  - `git diff --numstat -M base...HEAD`: flag files where deletions are at least 50% of the original and additions are comparable (near-total rewrites), and modules deleted and replaced in the same commit.
  - Each flagged file needs an old-to-new behaviour mapping plus parity tests.
- **Tools:** git diff --numstat, parity/differential tests
- **Applies to:** all projects; especially AI agents, which tend to regenerate files wholesale.
- **When not to apply / counterpoints:**
  - With tests, migration is safe (HN 39559994, verified).
  - Selective rewrites of poor code have succeeded (HN 39558671, neilv, verified).
  - jerf himself: "AI makes these rewrites way, way easier than they used to be", and "trying to sand off some of the rougher edges is itself a valid move sometimes". He still warns the output "is probably missing quite a few of the original features".
  - Small, well-specified components can reasonably be rewritten.
- **Fix risk:** high

### T30-F14 — Guardrails for an AI agent's refactoring pass
**Rule.**

- (a) A refactor commit may not remove or rename public symbols, or change test assertions or expected values.
- (b) Build and run the full test suite after every step.
- (c) Diff-audit old against new so that every branch, special case and error path is accounted for.
- (d) Apply refactorings with deterministic engines where they exist (F03).
- (e) Add no new functionality and "fix" no behaviour inside a refactor.
- (f) Report, rather than silently apply, anything the agent cannot prove preserves behaviour.

- **Grade:** B · **Verdict:** VERIFIED. The GitClear report is context only: it measures trends across all changed code in the AI era (correlational, from a vendor), not the safety of agent refactoring.
- **Rationale:** Several 2024–2026 studies agree that LLM refactorings change behaviour in characteristic ways: hallucinated context, wrong renames, added functionality, removed public methods, altered assertions, and dropped edge cases.
- **Evidence:**
  - [RefactorAssist](https://arxiv.org/abs/2608.00924) — Cordeiro, Noei, Zou, submitted 2026-08-02 (for ACM TOSEM) — preprint
    - Ten Java projects with their native test suites. Causes among the *failed* refactorings: "context misunderstanding/hallucination (24.3%), incorrect or inconsistent renaming (15.3%), adding new functionality or variables (13.7%), code incompleteness (11.3%), syntax and structural errors (9.7%), edge cases not handled (9%)".
    - After static plus agentic repair: "94.2% cumulative pass rate under the best-performing configuration".
    - Verified via the arXiv API.
  - [REFINE](https://arxiv.org/abs/2608.23611) — Waseem, Ahmad, Abrahamsson, submitted 2026-08-21 — preprint
    - 450 Java files from 15 systems. Smell reductions of 68.26%, 72.79% and 68.49%. "preservation checks reveal residual risks, including assert/fail-call changes and public-method removal"; outputs "should be treated as refactoring candidates requiring compilation, testing, dependency analysis, and human review".
    - Verified.
  - [Liu et al.](https://arxiv.org/abs/2411.04444) — *Automated Software Engineering* 2025 — peer reviewed
    - 13 of 176 and 9 of 137 solutions were unsafe.
    - Verified.
  - [HN comment by jerf](https://news.ycombinator.com/item?id=48850481) — 2026-07-09 — practitioner forum
    - Agents drop use cases silently. His remedy was a line-by-line mapping plus shared tests.
    - Verified.
  - [AI Copilot Code Quality 2025](https://www.gitclear.com/ai_assistant_code_quality_2025_research) — GitClear (vendor) — industry report (context only)
    - 211 million changed lines, January 2020 to December 2024. Changed lines "(associated with refactoring) sunk from 25% of changed lines in 2021, to less than 10% in 2024", while copy/pasted lines "rose from 8.3% to 12.3%".
    - Verified. Correlational; says nothing directly about the safety of agent refactoring.
- **Detect:**
  1. For refactor commits, the test diff must not touch assertion lines: `git diff base...HEAD -- '*test*' '*spec*' | grep -E '^[-+].*(assert|expect|should|toEqual|fail\()'` is empty.
  2. Every removed export is justified: `git diff base...HEAD | grep -E '^-\s*(export |pub |public |def [a-z_]+\()'`.
  3. `git rebase -x '<build && test>' base`.
  4. Compare counts of conditionals, early returns and exception handlers before and after each rewritten function. A drop must be explained.
- **Tools:** git diff, git rebase -x, test runner, deterministic refactoring engines
- **Applies to:** any cleanup pass performed or assisted by an LLM agent.
- **When not to apply / counterpoints:**
  - Agents tangle refactorings less than humans (Tian et al. 2026), and tangling there correlates with compile failures rather than functional failures.
  - Repair loops recover most failures (RefactorAssist).
  - The benchmarks are mostly Java, and model behaviour changes quickly.
- **Fix risk:** medium

### T30-F15 — Lock in cleanup gains with a ratchet
**Rule.** Instead of one heroic commit that fixes everything, record the current count of each lint, dead-code or complexity violation. Fail CI if the count rises, and lower the baseline when it falls. Block re-introduction of APIs or patterns the pass removed.

- **Grade:** B · **Verdict:** CORRECTED
  - The counterpoint "New lint rules need a manual baseline bump (HN reply 46858069)" was mis-cited. The question came from NortySpock ([46860948](https://news.ycombinator.com/item?id=46860948)). The original poster's reply ([47017745](https://news.ycombinator.com/item?id=47017745)) is speculative: "I imagine you could just manually bump the ceiling number when adding a new linting rule."
  - Added qntm's primary description of a ratchet.
- **Rationale:** Big-bang cleanups either live on long branches that are hard to merge, or are forgotten. Ratchets reduce violations steadily without blocking work. Google's large-scale-change chapter requires blocking new uses of whatever was removed.
- **Evidence:**
  - [Betterer: Introduction](https://phenomnomnominal.github.io/betterer/docs/introduction) — Betterer (Craig Spence), page updated 2021-11-12; repo not archived, last pushed 2026-07 — official docs
    - Quotes: "If it gets better, the .betterer.results file will be updated... If it gets worse, your test will fail". Otherwise the work ends up on a long-lived branch that is "difficult to maintain and often impossible to merge", or in an agreement that "is forgotten about and never really happens".
    - Verified.
  - [SWE at Google, Ch. 22](https://abseil.io/resources/swe-book/html/ch22.html) — 2020 — book
    - Quote: "In almost all cases, it's important to have a system that prevents additional introductions of the symbol or system that the large-scale change worked hard to remove." Tricorder flags "a new use of a deprecated object" at review time; "this has proven an effective method to prevent backsliding."
    - Verified verbatim.
  - [SWE at Google, Ch. 15: Deprecation](https://abseil.io/resources/swe-book/html/ch15.html) — 2020 — book
    - Quote: "hope is not a strategy." Warnings need "actionability and relevance", or they cause "alert fatigue".
    - Verified.
  - [Ratchets in software development](https://qntm.org/ratchet) — qntm, 2021-11-21 — engineering blog
    - The ratchet is a script run at lint time that "counts all of these 'pattern' instances". Too many raises an error. Too few raises an error that congratulates you and prompts you "to lower the expected number".
    - Verified (HTML download).
  - [HN comment](https://news.ycombinator.com/item?id=46858069) — allannienhuis, 2026-02-02 — practitioner forum
    - On a team of about 50 developers, a lint low-water mark with an optional boy-scout rule: "total number went down to zero over the course of a year or so, without getting in the way of anyone trying to get new work done."
    - Verified.
- **Detect:** After the pass, CI has a committed baseline or threshold gate, plus a rule that bans each removed or deprecated API. A pass that fixes N warnings without such a gate is incomplete.
- **Tools:** Betterer, a linter with baseline or threshold support, a custom count script, CI
- **Applies to:** codebases where not every violation can be fixed in one pass; any deprecated-API removal.
- **When not to apply / counterpoints:**
  - New rules need a baseline decision.
  - A ratchet can fossilize a bad baseline.
  - A small finished project may simply fix everything and turn the rule into an error.
- **Fix risk:** low

### T30-F16 — Remove anything that crosses a deploy boundary with expand/contract
**Rule.** Applies to DB columns and tables, API endpoints, message fields, environment variables and public library APIs. First stop using the item and deploy. Confirm nothing reads it. Then remove it in a later change. Deprecate public APIs before removing them.

- **Grade:** B · **Verdict:** VERIFIED
- **Rationale:** Running processes and external clients hold references that a code search cannot see.
- **Evidence:**
  - [strong_migrations](https://github.com/ankane/strong_migrations) — Andrew Kane, current, not archived — official docs
    - Quote: "Active Record caches database columns at runtime, so if you drop a column, it can cause exceptions until your app reboots."
    - Procedure: add the column to `ignored_columns`; deploy; remove the column inside `safety_assured`; deploy; drop the ignore line.
    - Verified.
  - [Online migrations at scale](https://stripe.com/blog/online-migrations) — Stripe, 2017-02-02 — engineering blog
    - Four steps: dual writing; changing all read paths; changing all write paths; removing old data that relies on the outdated data model.
    - Verified.
  - [Semantic Versioning 2.0.0](https://semver.org/) — standard
    - Quote: "before you completely remove the functionality in a new major release there should be at least one minor release that contains the deprecation".
    - Verified.
- **Detect:**
  - Grep the diff for `drop (column|table)|remove_column|remove_reference|drop_table`. Flag any that ship in the same change or deploy as the code that stops using the item.
  - Flag removed routes, environment-variable reads and exports that had no prior deprecation.
- **Tools:** git diff, strong_migrations or the ecosystem's migration linter
- **Applies to:** services with persistent data or external clients; published libraries.
- **When not to apply / counterpoints:**
  - A pre-production, single-process app can remove in one step.
  - Deprecation cycles are overhead for internal code in an atomically updated monorepo.
- **Fix risk:** low

### T30-F17 — Treat destructive cleanup of data, resources and config as a production change
**Rule.** Validate that each identifier refers to the intended kind of object. Dry-run first. Prefer soft or recoverable deletion. Test with production-shaped identifiers. Never switch off "unneeded" services on belief alone; require the evidence from F07.

- **Grade:** B · **Verdict:** CORRECTED
  - The Twitter 2FA source (HN story 33601910) is only a headline linking to a tweet, with two joke comments. The quoted phrase "accidentally killing the services that handled 2FA" does not appear anywhere in the thread.
  - It is replaced by Android Authority's contemporaneous report. That report is hedged, and on its own it is anecdotal (grade D).
  - Added Atlassian's own "soft deletes" learning.
- **Rationale:** Cleanup scripts and "bloat" removals have caused large self-inflicted outages, because the target was misidentified or a dependency was invisible.
- **Evidence:**
  - [Post-Incident Review on the Atlassian April 2022 outage](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage) — Atlassian, 2022 — incident report
    - Quotes: "Instead of providing the IDs of the intended app being marked for deletion, the team provided the IDs of the entire cloud site where the apps were to be deleted."; the API "accepts both site and app identifiers and assumes the input is correct"; "an immediate deletion of 883 sites (representing 775 customers) between 07:38 UTC and 08:01 UTC"; "The outage spanned up to 14 days for a subset of these customers".
    - Staging "would not have detected that the IDs input were incorrect as the IDs did not exist in the Staging environment".
    - Learning 1: "'Soft deletes' should be universal across all systems."
    - Verified verbatim (HTML grep).
  - [Elon Musk just ended Twitter SMS 2FA (Update: Appears to be back up for some)](https://www.androidauthority.com/twitter-sms-2fa-3234698/) — C. Scott Brown, Android Authority, 2022-11-14 — news
    - Quotes: "Musk tweeted out that he has shut down microservices at Twitter calling them 'bloatware.'"; "Twitter SMS 2FA is apparently part of those microservices"; the update says it "looks like this service is slowly coming back up".
    - Verified. Hedged and anecdotal.
- **Detect:**
  - Scan the pass for scripts or migrations that contain delete/destroy/`rm -rf`/DROP/terminate. Each must take a type-validated ID list, support `--dry-run`, and log what it would delete.
  - Every removed service, job or resource has evidence of zero traffic over a full cycle (F07).
- **Tools:** ripgrep, dry-run flags, cloud/resource inventories
- **Applies to:** projects whose cleanup scope includes ops scripts, migrations or infrastructure-as-code.
- **When not to apply / counterpoints:**
  - Atlassian's failure was also a matter of process (a communication gap) and API design.
  - Soft delete adds storage and complexity.
- **Fix risk:** low

### T30-F06 — Apply Chesterton's fence before deleting code that looks pointless
**Rule.** Before deleting or "simplifying" odd guards, retries, sleeps, magic constants, broad try/catch blocks or special cases, find out why they exist:

- Use `git log -S'<symbol>'`, `git log -L:<func>:<file>`, blame, and linked issues or PRs.
- Search for non-static references: string names, reflection, cron or job configs, templates, SQL, infra config, other repos.
- If no reason is found and the code is reachable, pin its behaviour with a test (F10) before changing it, or leave it.

- **Grade:** C · **Verdict:** CORRECTED
  - The Kondov "quarterly cron job" story is an **illustrative dialogue** ("New Team Member: ... Veteran: ..."), not a reported incident.
  - Added joshstrange's first-hand HN report.
- **Rationale:** Code that looks unreferenced or redundant is often invoked indirectly, or encodes a past incident fix. Reviewers do sign off on "functionally identical" changes that are not.
- **Evidence:**
  - [Chesterton's Fence](https://fs.blog/chestertons-fence/) — Farnam Street, published 2022-09-05, modified 2025-12-08 — other
    - Quote: "Do not remove a fence until you know why it was put up in the first place."
    - Verified.
  - [Legacy Code and Chesterton's Fence](https://alexkondov.com/legacy-code-and-chestersons-fence/) — Alex Kondov, 2020-01-20 — engineering blog
    - The dialogue: "I deleted a method which wasn't referenced anywhere in the codebase" / "No! That method gets dynamically called by a cron job that runs once every quarter!"
    - Verified. Illustrative only.
  - [HN comment](https://news.ycombinator.com/item?id=39641463) — joshstrange, 2024-03-08 — practitioner forum
    - Quote: "Literally just last week I made a mistake that got through multiple code reviews as 'yep, that's functionally identical' but we missed a weird case further down that none of us had expected from reading the code."
    - Verified.
  - [This Fence Has No Farmer](https://adamgreenough.net/blog/this-fence-has-no-farmer/) — Adam Greenough, 2026-08-31 — engineering blog
    - Quotes, for AI-written code: "The reasoning you're looking for might never have existed in the first place, even if something has come to depend on the code since"; "I'm still going to look behind the fence before I knock it down."
    - Verified.
  - [gitdiffcore (pickaxe)](https://git-scm.com/docs/gitdiffcore) — Git project — official docs
    - Quote: "-S<block-of-text> detects filepairs whose preimage and postimage have different number of occurrences of the specified block of text". `-G` matches added or deleted lines against a regex.
    - Verified.
  - [SCARF](https://engineering.fb.com/2023/10/24/data-infrastructure/automating-dead-code-cleanup/) — Meta, 2023 — engineering blog
    - BigGrep is a fallback that prevents deleting MySQL tables referenced by name from other languages, and dynamically invoked code.
    - Verified.
- **Detect:**
  - For each deleted or rewritten symbol, run `git log -S'<name>' --oneline` and `git log -L:<func>:<file>`, and read the introducing commit and its issue.
  - Run `rg -n --hidden '<name>'` over config, SQL, templates, cron and CI files.
  - The PR states why each fence existed, or states that no reason was found and names the pinning test.
- **Tools:** git log -S/-G/-L, git blame, ripgrep
- **Applies to:** all languages; most critical with dynamic languages, reflection/DI frameworks and scheduled jobs.
- **When not to apply / counterpoints:**
  - AI-generated or single-commit projects have little history, and the fence may have no reason at all (Greenough).
  - Excess caution keeps cruft forever.
  - At scale, tooling makes deletions that owners need to reject "very very rare" (F07).
- **Fix risk:** medium

### T30-F18 — Bound the scope of the pass
**Rule.** Apply the boy-scout rule only to code the pass has a documented reason to touch. Every changed file maps to a named finding. Keep a "seen, not fixed" list instead of following rabbit holes. Make no cosmetic modernization of working code, especially mixed into version or dependency upgrades.

- **Grade:** C · **Verdict:** VERIFIED
- **Rationale:** The main proponent of opportunistic cleanup also warns about rabbit holes. Practitioners report scope creep, blown estimates, noisy diffs and bugs they could not attribute when cosmetic edits were mixed with real changes.
- **Evidence:**
  - [Opportunistic Refactoring](https://martinfowler.com/bliki/OpportunisticRefactoring.html) — Fowler, 2011 — engineering blog
    - Quotes: "Always leave the code behind in a better state than you found it"; "There is a genuine danger of going down a rabbit hole here".
    - Verified.
  - [HN comment on "Moving to Java 17"](https://news.ycombinator.com/item?id=40783520) — kelnos, 2024-06-25 — practitioner forum
    - Quotes: "It's noise, and introduces more changes that could cause bugs, and then you end up wondering if the bugs were caused by the big version migration, or by all the little changes that were supposedly cosmetic"; "changing it just so it 'looks more modern' is pointless."
    - Verified.
  - [What to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html) — Google — official docs
    - Quote: "encourage the author to file a bug and add a TODO for cleaning up existing code."
    - Verified.
  - HN comments — practitioner forum, all verified via the HN API:
    - lelanthran ([36768747](https://news.ycombinator.com/item?id=36768747), 2023): the boy-scout rule "can severely throw out (already poor) estimates"; make it optional and timeboxed.
    - wirrbel ([33711309](https://news.ycombinator.com/item?id=33711309), 2022): hours wasted on stacked PRs.
    - fmbb ([42219782](https://news.ycombinator.com/item?id=42219782), 2024): juniors "go overboard with refactoring".
- **Detect:**
  - Produce a findings list first.
  - Every file in `git diff --name-only base...HEAD` maps to a finding ID.
  - Flag commits that mix manifest or lockfile bumps with unrelated source edits.
- **Tools:** git diff --name-only, findings checklist
- **Applies to:** all cleanup passes; especially AI agents, which tend to expand scope.
- **When not to apply / counterpoints:**
  - A ratchet plus an *optional* boy-scout rule took a team to zero lint errors (HN 46858069).
  - MDTHLN credits the boy-scout rule and "make the change easy" for their career success (HN [46505880](https://news.ycombinator.com/item?id=46505880), verified).
  - A rigid scope leaves obvious adjacent defects in place.
- **Fix risk:** low

### T30-F19 — Run scheduled cleanups as pre-triaged, capped, timeboxed lists
**Rule.** Run a scheduled cleanup (tech-debt sprint, fixit week, end-of-project pass) as a pre-triaged list of small, independently shippable items. Set a per-item cap (for example at most 2 days) and an overall timebox, and rank items by impact. Stop at the timebox. Do not measure success by lines or diffs produced.

- **Grade:** C · **Verdict:** CORRECTED
  - The Maganti post's actual title is "We stopped roadmap work for a week and fixed 189 bugs" (2025-11-22). The URL slug is "fixits-are-good-for-the-soul".
  - The "sudoit" Meta quote is from HN item **46040383**, not 46032576. Item 46032576 is a different ex-Meta commenter (etamponi) with a related complaint.
- **Rationale:** Evidence on dedicated cleanup periods is mixed and anecdotal. They worked when items were pre-sized and small. They failed when debt was systemic or incentives rewarded diff counts.
- **Evidence:**
  - [We stopped roadmap work for a week and fixed 189 bugs](https://lalitm.com/fixits-are-good-for-the-soul/) — Lalit Maganti (Perfetto team at Google), 2025-11-22 — engineering blog
    - Results: "189 bugs fixed", "40 people participated", "4 was the median number of bugs closed per person".
    - Rules: "1) no bug should take over 2 days and 2) all work should focus on either small end-user bugs/features or developer productivity". Bugs are pre-tagged during the year and sized beforehand. "fixit scores do not feed into performance reviews."
    - Verified (HTML grep).
  - [HN comment](https://news.ycombinator.com/item?id=46040383) — sudoit, 2025-11 — practitioner forum
    - Quote: "My experience at Meta is that those weeks are spent not fixing bugs but working on refactors which increase your LOC and diff count."
    - Verified. Corrected item ID.
  - [HN comment](https://news.ycombinator.com/item?id=46032576) — etamponi (ex-Meta, Reality Labs), 2025-11-24 — practitioner forum
    - Fix-it weeks turned into "you are allowed to land all the possible crap you want. Then you have one week to 'fix all the bugs'"; "most of the time we couldn't even fix a single bug because we were drown in tech debt."
    - Verified.
  - HN comments — practitioner forum, all verified:
    - tedmiston ([11661559](https://news.ycombinator.com/item?id=11661559), 2016): "Usually that's 10-25% tech debt... It's worked well for us."
    - spion ([32748078](https://news.ycombinator.com/item?id=32748078), 2022): "the tech debt tasks are left to rot forever"; recommends timeboxing the yak-shaving.
    - verdverm ([34527433](https://news.ycombinator.com/item?id=34527433), 2023): a quarterly "tech debt sprint", after which "uptime became better".
- **Detect:** The plan lists each item's size (split anything over the cap), its impact rationale and the linked finding. Each merged change maps to one plan item, and no item is "refactor for its own sake".
- **Tools:** issue tracker / findings list
- **Applies to:** planned cleanup passes, including this skill's end-of-project hardening pass.
- **When not to apply / counterpoints:**
  - Continuous-refactoring advocates (Fowler; Velasco) see dedicated passes as a symptom of not refactoring along the way.
  - HN commenters on the fixit post say a scheduled week "encourages teams to just defer" fixes (Galxeagle, [46030366](https://news.ycombinator.com/item?id=46030366)).
  - All evidence here is anecdotal.
- **Fix risk:** low

## Practitioner voice

Every item was re-opened: HN items via the Firebase API, other pages via WebFetch or HTTP. Gists are corrected where needed.

**Incidents and official records**
- [Knight Capital SEC order](https://www.sec.gov/litigation/admin/2013/34-70694.pdf) — Power Peg code, unused since 2003, stayed "present and callable". A new feature repurposed its flag, and one of eight servers missed the deploy with no second reviewer. About 4M executions happened in about 45 minutes; Knight ultimately lost more than $460M.
- [Atlassian 2022 PIR](https://www.atlassian.com/engineering/post-incident-review-april-2022-outage) — a script to delete a legacy app was given site IDs and deleted 883 sites (775 customers) in 23 minutes. Some customers were down for up to 14 days. Staging could not catch it because the IDs did not exist there.
- [glibc memcpy / Flash, Bugzilla 638477](https://bugzilla.redhat.com/show_bug.cgi?id=638477) — a spec-legal, backwards-copying memcpy broke Flash audio. Linus measured no clear speed gain and asked "What's the upside?"
- [GitHub Scientist merge rewrite](https://github.blog/engineering/engineering-principles/move-fast/) — old and new paths were compared on tens of millions of production merges. They fixed "2 serious merge-related bugs in the original Git implementation" (including 768 conflicts reported as 0) and "3 major performance issues in the new implementation".
- [Sonos app rebuild (MacRumors)](https://www.macrumors.com/2025/01/13/sonos-ceo-steps-down-after-app-redesign/) — a clean-slate rebuild shipped without sleep timers, alarms and accessibility options. Revenue fell 16% in fiscal Q4 2024 and the stock fell about 13%; the CEO stepped down. The causal link is reported, not measured.
- [Twitter SMS 2FA (Android Authority)](https://www.androidauthority.com/twitter-sms-2fa-3234698/) — SMS 2FA "apparently" broke after microservices called "bloatware" were shut down, and was coming back up the same day. Hedged report.

**Rewrites and dropped behaviour**
- [jerf, HN 48850481](https://news.ycombinator.com/item?id=48850481) — two AI-assisted rewrites of "low tens of thousands of lines". "Opus 4.5 does like to sand off the edges and drop use cases". Fixed by mapping every original line to the rewrite, plus shared tests.
- [andrelaszlo, HN 39559814](https://news.ycombinator.com/item?id=39559814) — a team lead replaced the commenter's roughly 300-line tool with ten lines. "Every few weeks someone came to me complaining that something didnt work", and the ten lines "grew to a few hundred again".
- [hamburglar, HN 39558768](https://news.ycombinator.com/item?id=39558768) — hearsay ("I've heard from a couple people"): a Stripe monolith rewrite stalled when its champion left, leaving both apps in production. Unverified.
- [throwthrow5643, HN 39559994](https://news.ycombinator.com/item?id=39559994) — pushback on Spolsky: missed paths are "a problem with testing rather than migration".

**Cosmetic churn and blame**
- [kelnos, HN 40783520](https://news.ycombinator.com/item?id=40783520) — cosmetic modernization during a Java upgrade is noise; afterwards you can't tell which change caused a bug.
- [ambivalence, HN 17156780](https://news.ycombinator.com/item?id=17156780) — the Black-side reply ("we feel") to "does a reformat make blame unusable?": use `git hyper-blame` or `git blame $REV^`, and "a single big 'reformat all' commit is better than a bunch of incremental ones that reformat areas that you also change semantically." *(Corrected ID: the researcher cited the question, 17156596. The handle is widely associated with Black's author Łukasz Langa; the identity was not independently verified here.)*
- [criddell, HN 39898746](https://news.ycombinator.com/item?id=39898746) — tidying edits add "unnecessary noise in version control" for blame on a 28-year-old codebase.

**Ratchets, splitting and review**
- [allannienhuis, HN 46858069](https://news.ycombinator.com/item?id=46858069) — a lint low-water mark plus an optional boy-scout rule reached zero errors in about a year on a team of about 50 developers.
- [wirrbel, HN 33711309](https://news.ycombinator.com/item?id=33711309) — "hours wasted" on stacked PRs to separate boy-scout changes from feature work.
- [keybored, HN 39737464](https://news.ycombinator.com/item?id=39737464) — made step-by-step commits that tools could verify (`git diff --color-moved`) and pointed reviewers to them. The ideal would be reviewers re-running a script instead of reading a 500-line diff.
- [sweezyjeezy, HN 39739015](https://news.ycombinator.com/item?id=39739015) — recorded all data in and out of a system and replayed it after the refactor: "a lot more confidence than unit tests."
- [duncans, HN 8862879](https://news.ycombinator.com/item?id=8862879) — "10 lines of code = 10 issues. 500 lines of code = 'looks fine.'" (quoting a well-known joke tweet).
- [Aeolun, HN 30680304](https://news.ycombinator.com/item?id=30680304) — some large changes cannot reasonably be split; tests provide the confidence instead.

**Hidden behaviour and dependencies**
- [joshstrange, HN 39641463](https://news.ycombinator.com/item?id=39641463) — a change approved in several reviews as "functionally identical" missed "a weird case further down".
- [Kondov, Chesterton's fence](https://alexkondov.com/legacy-code-and-chestersons-fence/) — an *illustrative* dialogue, not an incident: a method with no references is called dynamically by a quarterly cron job.
- [Ygg2, HN 34196523](https://news.ycombinator.com/item?id=34196523) — a Spring upgrade changed a default so null fields were written; only services relying on omitted nulls broke.
- [FiloSottile, HN 42202326](https://news.ycombinator.com/item?id=42202326) — Go reads an extra random byte and randomizes map order to avoid lock-in; rand output is part of the compatibility promise.

**Dead-code deletion at Google**
- [Xorlev, HN 35757299](https://news.ycombinator.com/item?id=35757299) — code owners must approve Sensenmann deletions, "so it's rare there's ever a false deletion".
- [UncleMeat, HN 35757030](https://news.ycombinator.com/item?id=35757030) — "dead for six months" is a very good heuristic; rejections happen "only very very rarely".
- [lrem, HN 35760804](https://news.ycombinator.com/item?id=35760804) — a dormant emergency system was exempted from deletion with a comment.

**Fixit weeks**
- [Lalit Maganti](https://lalitm.com/fixits-are-good-for-the-soul/) — 40 participants closed 189 pre-triaged bugs, with a 2-day cap per bug and no link to performance reviews.
- [sudoit, HN 46040383](https://news.ycombinator.com/item?id=46040383) — at Meta, fix-it weeks became refactors that "increase your LOC and diff count".
- [etamponi, HN 46032576](https://news.ycombinator.com/item?id=46032576) — at Meta Reality Labs, fix-it weeks became a licence to land low-quality code, then too much debt to fix anything.

## Contradictions and open questions

**Contradictions**
- **Mass reformatting.**
  - For one repo-wide formatter commit that blame is told to skip, then enforced in CI: Django DEP 0008 and the Black-side HN reply (17156780).
  - Against formatting-only changes to code nobody is changing: LLVM and netdev.
  - What decides it: whether a formatter will be enforced from then on. Enforcement makes the one-off commit pay back.
- **The boy-scout rule.**
  - For: Fowler, Velasco, jillesvangurp, MDTHLN, allannienhuis.
  - Against: lelanthran (estimates), wirrbel (stacked-PR overhead), fmbb (juniors overdo it), kelnos (noise during migrations).
  - Fowler himself warns about rabbit holes and feature branches. Google allows trivial inline cleanups but wants real refactorings in separate CLs.
- **Rewrites.**
  - Against: Spolsky (2000), Fowler (2024) and the Sonos case.
  - For, when tests exist: HN 2024–2026 says missing tests are the real problem, and AI makes test-backed rewrites much cheaper.
  - Both sides give ground. Fowler notes that much existing behaviour "isn't really wanted". jerf, who is pro-AI, still reports agents silently dropping use cases.
- **Small-change norm versus exemptions.** Google treats 100 lines as reasonable and 1000 as too large ("no hard and fast rules"), but accepts large deletions and trusted automated refactorings, and its LSC tooling ignores recently flaky tests. That conflicts with a strict "only refactor on green" rule.
- **How long before code counts as dead.**
  - Uber: 8 weeks as an example flag-staleness threshold.
  - UncleMeat: six months.
  - Sensenmann's article: "a long time", with the example "over a year".
  - Quarterly jobs imply at least one full quarter.
  - No standard exists.
- **Deleting versus keeping.**
  - For deletion: SCARF, Sensenmann, Romano et al. and Knight.
  - Against: Uber (deliberate kill switches) and Koppel (recoverability). The HN commenter who quoted Koppel disagreed with him.
- **AI agents and tangling.** Agents tangle refactorings *less* often than humans (21.43% vs 36.72%), and tangling there relates to compile failures, not functional failures. Yet other studies show agent refactorings frequently change behaviour.
- **GitLab support for .git-blame-ignore-revs.** nesbitt.io (2026) says GitLab 15.4+. GitLab's own docs say 17.10 (behind a flag) and 17.11 (GA). Use GitLab's docs.
- **glibc memcpy.** Linus: no measured upside and real breakage. davidsen and jakub: the change targeted speed "on little processors", and the software was violating the spec. The thread did not agree.

**Open questions**
- There is no empirical study comparing a one-shot end-of-project cleanup with continuous refactoring. The evidence on scheduled cleanups is anecdotal (C/D).
- How can the dynamic proof of deadness be met in a finished project without production telemetry? Is certainty from the compiler or tool enough? Note that Sensenmann explicitly refuses to count test runs as liveness.
- How do `.git-blame-ignore-revs` entries behave in squash or rebase merge workflows? No official guidance was found; "add after merge" is inference.
- The papers by Herzig & Zeller, Bosu et al., Romano et al., Rachatasumrit & Kim, Bavota et al. and Mahmoudi et al. were checked only through their OpenAlex abstracts. Effect sizes beyond the abstracts are unverified.
- Most agent-refactoring evidence (2024–2026) consists of preprints on Java benchmarks. Transfer to TypeScript or Python projects is untested.
- Practitioner voice is skewed toward Hacker News, because Reddit, SE StackExchange and Lobsters could not be reached and WebSearch was unavailable.

## Dropped findings

None. All 19 findings survived, one of them downgraded (F08). These individual sources or claims were removed or replaced:

- HN 33601910 (Twitter 2FA) — the quoted comment text does not exist; the thread has two joke comments. Replaced by Android Authority (F17).
- HN 42221674 (riehwvfbk) — dropped from practitioner voice. It is an explicit hypothetical ("Imagine a codebase with a wart"), not the reported experience the researcher described.
- Rachatasumrit & Kim "38% of failure-inducing changes" — not in the source. Replaced by the abstract's actual figures (F10).
- Summary: "DORA 2024" is listed as a version used, but no finding cites it. Removed.
- Citations corrected rather than dropped:
  - HN 46032576 → 46040383 for sudoit.
  - HN 17156596 → reply 17156780.
  - The "HN reply 46858069" counterpoint → 47017745, which is speculative.
  - The Sensenmann "owner must approve" quote → Xorlev, 35757299.
  - Google's "Easier to roll back" → "Simpler to roll back".
